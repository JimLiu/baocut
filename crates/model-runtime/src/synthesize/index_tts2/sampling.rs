//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/IndexTTS2TTS/IndexTTS2SemanticGPT.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 语义 GPT 的采样 / 束搜索纯逻辑（对照 speech-swift `IndexTTS2SemanticGPT.swift`
//! 里的宿主端部分：`IndexTTS2SeededRNG`、`sampleToken`、`applyTopK/TopP`、
//! `sampleIndicesWithoutReplacement`、`bestBeams`、`isBeamSampleDone`）。
//!
//! 全部在宿主端 f32 上完成，与后端无关，因此不带 cfg 门并可单元测试。

use std::collections::HashSet;

/// 与 `IndexTTS2SemanticGenerationOptions` 对应的生成选项。
#[derive(Debug, Clone, PartialEq)]
pub struct GenerationOptions {
    pub max_semantic_tokens: usize,
    pub greedy: bool,
    pub temperature: f32,
    pub top_k: usize,
    pub top_p: f32,
    pub repetition_penalty: f32,
    pub seed: u64,
    pub beam_width: usize,
    pub length_penalty: f32,
}

impl Default for GenerationOptions {
    fn default() -> Self {
        Self {
            max_semantic_tokens: 1500,
            greedy: false,
            temperature: 0.8,
            top_k: 30,
            top_p: 0.8,
            repetition_penalty: 10.0,
            seed: 11,
            beam_width: 3,
            length_penalty: 0.0,
        }
    }
}

/// splitmix64（`IndexTTS2SeededRNG`），并复刻 Swift `Double.random(in: lo..<hi, using:)`
/// 的位语义：取 53 位尾数得到 `[0, 1)` 均匀数，命中上界时重抽。
#[derive(Debug, Clone)]
pub struct SeededRng {
    state: u64,
}

impl SeededRng {
    pub fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// `Double.random(in: lo..<hi)`。
    pub fn random_f64(&mut self, lo: f64, hi: f64) -> f64 {
        let delta = hi - lo;
        loop {
            let rand = self.next_u64() & ((1u64 << 53) - 1);
            let unit = rand as f64 * (f64::EPSILON / 2.0);
            let value = delta * unit + lo;
            if value != hi {
                return value;
            }
        }
    }
}

/// 重复惩罚：出现过的 token，负 logit 乘以惩罚、正 logit 除以惩罚。
pub fn apply_repetition_penalty(logits: &mut [f32], previous: &[i32], penalty: f32) {
    if penalty <= 1.0 {
        return;
    }
    let unique: HashSet<i32> = previous.iter().copied().collect();
    for token in unique {
        if token < 0 || token as usize >= logits.len() {
            continue;
        }
        let index = token as usize;
        if logits[index] < 0.0 {
            logits[index] *= penalty;
        } else {
            logits[index] /= penalty;
        }
    }
}

pub fn apply_temperature(logits: &mut [f32], temperature: f32) {
    if temperature <= 1e-4 || temperature == 1.0 {
        return;
    }
    for value in logits.iter_mut() {
        if value.is_finite() {
            *value /= temperature;
        }
    }
}

/// 保留最大的 `max(k, min_tokens_to_keep)` 个，其余置 `-inf`。
pub fn apply_top_k(logits: &mut [f32], k: usize, min_tokens_to_keep: usize) {
    let keep = k.max(min_tokens_to_keep);
    if keep == 0 || keep >= logits.len() {
        return;
    }
    let mut sorted = logits.to_vec();
    sorted.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    let threshold = sorted[keep - 1];
    for value in logits.iter_mut() {
        if *value < threshold {
            *value = f32::NEG_INFINITY;
        }
    }
}

/// 核采样：按 `exp(v - max)` 归一化后累计到 `p`，之外置 `-inf`。
pub fn apply_top_p(logits: &mut [f32], p: f32, min_tokens_to_keep: usize) {
    if !(p > 0.0 && p < 1.0) {
        return;
    }
    let finite: Vec<usize> = (0..logits.len()).filter(|&i| logits[i].is_finite()).collect();
    if finite.len() <= 1 {
        return;
    }
    let max_value = finite.iter().map(|&i| logits[i]).fold(f32::NEG_INFINITY, f32::max);
    let mut scored: Vec<(usize, f32)> = finite.iter().map(|&i| (i, (logits[i] - max_value).exp())).collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let total: f32 = scored.iter().map(|s| s.1).sum();
    if total <= 0.0 {
        return;
    }
    let mut allowed = HashSet::new();
    let mut cumulative = 0f32;
    let mut kept = 0usize;
    for (index, prob) in scored {
        allowed.insert(index);
        kept += 1;
        cumulative += prob / total;
        if cumulative >= p && kept >= min_tokens_to_keep {
            break;
        }
    }
    for (i, value) in logits.iter_mut().enumerate() {
        if value.is_finite() && !allowed.contains(&i) {
            *value = f32::NEG_INFINITY;
        }
    }
}

/// `applyTopP(_:p:temperature:)`：在温度缩放副本上做核采样，再把掩码套回原值。
pub fn apply_top_p_with_temperature(logits: &mut [f32], p: f32, temperature: f32) {
    let mut scaled = logits.to_vec();
    apply_temperature(&mut scaled, temperature);
    apply_top_p(&mut scaled, p, 1);
    for (value, s) in logits.iter_mut().zip(scaled.iter()) {
        if !s.is_finite() {
            *value = f32::NEG_INFINITY;
        }
    }
}

/// 单束采样一个 token（`sampleToken`）：重复惩罚 → 贪心或 top-k / top-p → Gumbel-max。
pub fn sample_token(mut values: Vec<f32>, previous: &[i32], options: &GenerationOptions, rng: &mut SeededRng) -> i32 {
    apply_repetition_penalty(&mut values, previous, options.repetition_penalty);
    if options.greedy || options.temperature <= 1e-4 {
        return argmax(&values) as i32;
    }
    apply_top_k(&mut values, options.top_k, 1);
    apply_top_p_with_temperature(&mut values, options.top_p, options.temperature);

    let temperature = options.temperature.max(1e-4);
    let mut best_score = f32::NEG_INFINITY;
    let mut best_index = 0usize;
    for (i, &value) in values.iter().enumerate() {
        if !value.is_finite() {
            continue;
        }
        let u = (rng.random_f64(f32::EPSILON as f64, 1.0) as f32).max(f32::EPSILON);
        let gumbel = -(-u.ln()).ln();
        let score = value / temperature + gumbel;
        if score > best_score {
            best_score = score;
            best_index = i;
        }
    }
    best_index as i32
}

pub fn argmax(values: &[f32]) -> usize {
    let mut best_value = f32::NEG_INFINITY;
    let mut best_index = 0usize;
    for (i, &value) in values.iter().enumerate() {
        if value > best_value {
            best_value = value;
            best_index = i;
        }
    }
    best_index
}

pub fn log_softmax(values: &[f32]) -> Vec<f32> {
    let finite: Vec<f32> = values.iter().copied().filter(|v| v.is_finite()).collect();
    let Some(max_value) = finite.iter().copied().reduce(f32::max) else {
        return vec![f32::NEG_INFINITY; values.len()];
    };
    let total: f32 = finite.iter().map(|v| (v - max_value).exp()).sum();
    if total <= 0.0 {
        return vec![f32::NEG_INFINITY; values.len()];
    }
    let log_total = total.ln();
    values
        .iter()
        .map(|&v| {
            if v.is_finite() {
                v - max_value - log_total
            } else {
                f32::NEG_INFINITY
            }
        })
        .collect()
}

/// 有限值里最大的 `count` 个 `(token, 值)`。
pub fn top_log_probs(values: &[f32], count: usize) -> Vec<(i32, f32)> {
    let mut indices: Vec<usize> = (0..values.len()).filter(|&i| values[i].is_finite()).collect();
    indices.sort_by(|&a, &b| values[b].partial_cmp(&values[a]).unwrap_or(std::cmp::Ordering::Equal));
    indices.into_iter().take(count).map(|i| (i as i32, values[i])).collect()
}

/// 按 `exp(score - max)` 权重无放回抽 `count` 个下标（`sampleIndicesWithoutReplacement`）。
pub fn sample_indices_without_replacement(scores: &[f32], count: usize, rng: &mut SeededRng) -> Vec<usize> {
    if count == 0 {
        return Vec::new();
    }
    let finite: Vec<usize> = (0..scores.len()).filter(|&i| scores[i].is_finite()).collect();
    let Some(max_score) = finite.iter().map(|&i| scores[i]).reduce(f32::max) else {
        return Vec::new();
    };
    let mut weights = vec![0f32; scores.len()];
    let mut total = 0f32;
    for &index in &finite {
        let weight = (scores[index] - max_score).exp();
        weights[index] = weight;
        total += weight;
    }
    let mut selected = Vec::with_capacity(count.min(finite.len()));
    for _ in 0..count.min(finite.len()) {
        if !(total > 0.0) || !total.is_finite() {
            break;
        }
        let draw = rng.random_f64(0.0, total as f64) as f32;
        let mut cumulative = 0f32;
        let mut chosen = finite.last().copied();
        for &index in &finite {
            if weights[index] <= 0.0 {
                continue;
            }
            cumulative += weights[index];
            if cumulative >= draw {
                chosen = Some(index);
                break;
            }
        }
        let Some(chosen) = chosen else { break };
        selected.push(chosen);
        total -= weights[chosen];
        weights[chosen] = 0.0;
    }
    selected
}

/// 束（`SemanticBeam`）。
#[derive(Debug, Clone, PartialEq)]
pub struct Beam {
    pub tokens: Vec<i32>,
    pub score: f32,
    pub ended: bool,
}

impl Beam {
    pub fn empty() -> Self {
        Self {
            tokens: Vec::new(),
            score: 0.0,
            ended: false,
        }
    }

    pub fn ranking_score(&self, length_penalty: f32) -> f32 {
        if length_penalty == 0.0 {
            return self.score;
        }
        let length = self.tokens.len().max(1) as f64;
        let divisor = length.powf(length_penalty as f64) as f32;
        self.score / divisor.max(f32::EPSILON)
    }
}

/// 按排名分降序（同分时更长者优先）取前 `count` 个。
pub fn best_beams(beams: &[Beam], count: usize, length_penalty: f32) -> Vec<Beam> {
    let mut sorted: Vec<Beam> = beams.to_vec();
    sorted.sort_by(|a, b| {
        let lhs = a.ranking_score(length_penalty);
        let rhs = b.ranking_score(length_penalty);
        if lhs != rhs {
            rhs.partial_cmp(&lhs).unwrap_or(std::cmp::Ordering::Equal)
        } else {
            b.tokens.len().cmp(&a.tokens.len())
        }
    });
    sorted.truncate(count);
    sorted
}

/// 已完成束数达到宽度，且最差的完成束不低于最好的活跃束时停止。
pub fn is_beam_sample_done(active: &[Beam], completed: &[Beam], width: usize, length_penalty: f32) -> bool {
    if completed.len() < width {
        return false;
    }
    let best = best_beams(completed, width, length_penalty);
    let Some(worst_completed) = best.last() else {
        return false;
    };
    let best_active = active
        .iter()
        .map(|b| b.ranking_score(length_penalty))
        .fold(f32::NEG_INFINITY, f32::max);
    worst_completed.ranking_score(length_penalty) >= best_active
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splitmix64_matches_reference_stream() {
        // splitmix64 参考值（seed 0 的前两个输出）。
        let mut rng = SeededRng::new(0);
        assert_eq!(rng.next_u64(), 0xE220_A839_7B1D_CDAF);
        assert_eq!(rng.next_u64(), 0x6E78_9E6A_A1B9_65F4);
    }

    #[test]
    fn random_f64_stays_in_half_open_range() {
        let mut rng = SeededRng::new(11);
        for _ in 0..1000 {
            let v = rng.random_f64(0.25, 0.75);
            assert!((0.25..0.75).contains(&v));
        }
    }

    #[test]
    fn repetition_penalty_scales_by_sign() {
        let mut logits = vec![2.0, -2.0, 1.0];
        apply_repetition_penalty(&mut logits, &[0, 1, 1, 7], 2.0);
        assert_eq!(logits, vec![1.0, -4.0, 1.0]);
        apply_repetition_penalty(&mut logits, &[2], 1.0);
        assert_eq!(logits, vec![1.0, -4.0, 1.0]);
    }

    #[test]
    fn top_k_keeps_threshold_and_ties() {
        let mut logits = vec![0.1, 0.9, 0.5, 0.5, 0.2];
        apply_top_k(&mut logits, 2, 1);
        assert_eq!(logits, vec![f32::NEG_INFINITY, 0.9, 0.5, 0.5, f32::NEG_INFINITY]);
        let mut small = vec![1.0, 2.0];
        apply_top_k(&mut small, 5, 1);
        assert_eq!(small, vec![1.0, 2.0]);
    }

    #[test]
    fn top_p_keeps_nucleus_and_min_tokens() {
        let mut logits = vec![0.0, 0.0, -20.0, -20.0];
        apply_top_p(&mut logits, 0.5, 1);
        assert_eq!(logits[2], f32::NEG_INFINITY);
        assert_eq!(logits[3], f32::NEG_INFINITY);
        assert_eq!(logits[0], 0.0);
        let mut logits = vec![3.0, 0.0, -1.0];
        apply_top_p(&mut logits, 0.1, 2);
        assert!(logits[0].is_finite() && logits[1].is_finite());
        assert_eq!(logits[2], f32::NEG_INFINITY);
    }

    #[test]
    fn greedy_sampling_picks_argmax_after_penalty() {
        let options = GenerationOptions {
            greedy: true,
            ..GenerationOptions::default()
        };
        let mut rng = SeededRng::new(1);
        assert_eq!(sample_token(vec![1.0, 5.0, 2.0], &[], &options, &mut rng), 1);
        assert_eq!(sample_token(vec![1.0, 5.0, 2.0], &[1], &options, &mut rng), 2);
    }

    #[test]
    fn sampling_is_deterministic_for_seed() {
        let options = GenerationOptions::default();
        let logits: Vec<f32> = (0..50).map(|i| (i as f32 * 0.37).sin() * 4.0).collect();
        let mut a = SeededRng::new(11);
        let mut b = SeededRng::new(11);
        let ta: Vec<i32> = (0..8).map(|_| sample_token(logits.clone(), &[], &options, &mut a)).collect();
        let tb: Vec<i32> = (0..8).map(|_| sample_token(logits.clone(), &[], &options, &mut b)).collect();
        assert_eq!(ta, tb);
        assert!(ta.iter().all(|&t| logits[t as usize] > 1.0), "采样应落在 top-k/top-p 核内");
    }

    #[test]
    fn log_softmax_ignores_masked_entries() {
        let out = log_softmax(&[0.0, 0.0, f32::NEG_INFINITY]);
        assert!((out[0] - (0.5f32).ln()).abs() < 1e-6);
        assert_eq!(out[2], f32::NEG_INFINITY);
        assert_eq!(top_log_probs(&out, 1), vec![(0, out[0])]);
    }

    #[test]
    fn without_replacement_sampling_returns_distinct_indices() {
        let mut rng = SeededRng::new(3);
        let scores = vec![0.0, -1.0, f32::NEG_INFINITY, 2.0, -3.0];
        let picked = sample_indices_without_replacement(&scores, 6, &mut rng);
        assert_eq!(picked.len(), 4);
        let unique: HashSet<usize> = picked.iter().copied().collect();
        assert_eq!(unique.len(), 4);
        assert!(!picked.contains(&2));
    }

    #[test]
    fn beam_ranking_prefers_score_then_length() {
        let beams = vec![
            Beam {
                tokens: vec![1],
                score: -1.0,
                ended: true,
            },
            Beam {
                tokens: vec![1, 2],
                score: -1.0,
                ended: true,
            },
            Beam {
                tokens: vec![],
                score: -0.5,
                ended: false,
            },
        ];
        let best = best_beams(&beams, 2, 0.0);
        assert_eq!(best[0].score, -0.5);
        assert_eq!(best[1].tokens, vec![1, 2]);
        assert!(!is_beam_sample_done(&beams[2..], &beams[..2], 3, 0.0));
        assert!(is_beam_sample_done(&beams[..1], &beams[..2], 2, 0.0));
        let penalised = Beam {
            tokens: vec![0; 4],
            score: -2.0,
            ended: true,
        };
        assert!((penalised.ranking_score(1.0) + 0.5).abs() < 1e-6);
    }
}
