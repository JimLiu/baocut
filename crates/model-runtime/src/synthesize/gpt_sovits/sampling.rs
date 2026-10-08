//! T2S 语义 token 采样：对照 `GPT_SoVITS/AR/models/utils.py` 的 `logits_to_probs`
//! 与 `multinomial_sample_one_no_sync`。词表只有 1025 项，在 CPU 上做完即可，
//! 两个后端共用同一份实现（也就不依赖张量库的 topk / sort）。

use crate::synthesize::qwen3_tts::sampling::Rng;
use crate::synthesize::types::SamplingOptions;
use anyhow::{Result, ensure};

/// 官方 WebUI 的默认值（`top_k=15, top_p=1, temperature=1`；
/// `infer_panel_naive` 的 `repetition_penalty=1.35`）。
pub const DEFAULT_TOP_K: usize = 15;
pub const DEFAULT_TOP_P: f32 = 1.0;
pub const DEFAULT_TEMPERATURE: f32 = 1.0;
pub const DEFAULT_REPETITION_PENALTY: f32 = 1.35;
/// 每句最多生成的语义 token（25 Hz，一分钟）；`SamplingOptions::max_tokens` 只能调小。
pub const DEFAULT_MAX_TOKENS: usize = 1500;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SamplingParams {
    pub top_k: usize,
    pub top_p: f32,
    pub temperature: f32,
    pub repetition_penalty: f32,
}

impl Default for SamplingParams {
    fn default() -> Self {
        Self {
            top_k: DEFAULT_TOP_K,
            top_p: DEFAULT_TOP_P,
            temperature: DEFAULT_TEMPERATURE,
            repetition_penalty: DEFAULT_REPETITION_PENALTY,
        }
    }
}

impl SamplingParams {
    pub fn from_options(options: &SamplingOptions, engine: &str) -> Result<Self> {
        let defaults = Self::default();
        let params = Self {
            top_k: options.top_k.map(|k| k as usize).unwrap_or(defaults.top_k),
            top_p: options.top_p.unwrap_or(defaults.top_p),
            temperature: options.temperature.unwrap_or(defaults.temperature),
            repetition_penalty: options.repetition_penalty.unwrap_or(defaults.repetition_penalty),
        };
        ensure!(params.top_k >= 1, "{engine} 的 top_k 必须 ≥ 1");
        ensure!(params.top_p > 0.0 && params.top_p <= 1.0, "{engine} 的 top_p 必须在 (0, 1] 内");
        ensure!(
            params.temperature.is_finite() && params.temperature > 0.0,
            "{engine} 的 temperature 必须 > 0"
        );
        ensure!(
            params.repetition_penalty.is_finite() && params.repetition_penalty > 0.0,
            "{engine} 的 repetition_penalty 必须 > 0"
        );
        Ok(params)
    }
}

/// 采样一个 token。与上游一样**就地**施加重复惩罚（`logits.scatter_`），
/// 所以调用方随后对同一个 `logits` 取 argmax 判断 EOS 时看到的是惩罚后的分数。
pub fn sample(logits: &mut [f32], previous: &[u32], params: &SamplingParams, rng: &mut Rng) -> usize {
    let vocab = logits.len();
    if params.repetition_penalty != 1.0 {
        // gather 读原值、scatter 写回：同一 token 出现多次也只惩罚一次。
        let mut seen = vec![false; vocab];
        for &token in previous {
            let token = token as usize;
            if token < vocab && !seen[token] {
                seen[token] = true;
                let score = logits[token];
                logits[token] = if score < 0.0 {
                    score * params.repetition_penalty
                } else {
                    score / params.repetition_penalty
                };
            }
        }
    }

    let mut scores = logits.to_vec();
    if params.top_p < 1.0 {
        let mut order: Vec<usize> = (0..vocab).collect();
        order.sort_by(|&a, &b| scores[b].total_cmp(&scores[a]));
        let sorted: Vec<f32> = order.iter().map(|&i| scores[i]).collect();
        let probs = softmax(&sorted);
        let mut cumulative = 0.0f32;
        for (rank, &index) in order.iter().enumerate() {
            cumulative += probs[rank];
            // `cum_probs > top_p` 的位置被移除，但第一名永远保留。
            if rank > 0 && cumulative > params.top_p {
                scores[index] = f32::NEG_INFINITY;
            }
        }
    }

    let temperature = params.temperature.max(1e-5);
    for score in &mut scores {
        *score /= temperature;
    }

    let k = params.top_k.min(vocab);
    if k < vocab {
        let mut sorted = scores.clone();
        sorted.sort_by(|a, b| b.total_cmp(a));
        let pivot = sorted[k - 1];
        for score in &mut scores {
            if *score < pivot {
                *score = f32::NEG_INFINITY;
            }
        }
    }

    let probs = softmax(&scores);
    // `argmax(probs / Exp(1))` 等价于按 probs 做一次多项式采样；并列时取第一个。
    let mut best = 0usize;
    let mut best_value = f64::NEG_INFINITY;
    for (index, &p) in probs.iter().enumerate() {
        let u = 1.0 - rng.next_f64(); // (0, 1]
        let q = (-u.ln()).max(f64::MIN_POSITIVE);
        let value = p as f64 / q;
        if value > best_value {
            best_value = value;
            best = index;
        }
    }
    best
}

/// 首个最大值的下标（`torch.argmax` 的并列规则）。
pub fn argmax(values: &[f32]) -> usize {
    let mut best = 0usize;
    for (index, value) in values.iter().enumerate() {
        if *value > values[best] {
            best = index;
        }
    }
    best
}

fn softmax(values: &[f32]) -> Vec<f32> {
    let max = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    if !max.is_finite() {
        let mut out = vec![0.0; values.len()];
        if let Some(first) = out.first_mut() {
            *first = 1.0;
        }
        return out;
    }
    let exps: Vec<f64> = values.iter().map(|&v| ((v - max) as f64).exp()).collect();
    let sum: f64 = exps.iter().sum();
    exps.iter().map(|&e| (e / sum) as f32).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(top_k: usize, top_p: f32, penalty: f32) -> SamplingParams {
        SamplingParams {
            top_k,
            top_p,
            temperature: 1.0,
            repetition_penalty: penalty,
        }
    }

    #[test]
    fn repetition_penalty_is_applied_once_in_place() {
        let mut logits = vec![2.0, -1.0, 1.0];
        let mut rng = Rng::new(1);
        sample(&mut logits, &[0, 0, 1], &params(3, 1.0, 2.0), &mut rng);
        assert_eq!(logits, vec![1.0, -2.0, 1.0]);
        // 惩罚后 0 与 2 并列，argmax 取第一个。
        assert_eq!(argmax(&logits), 0);
    }

    #[test]
    fn top_k_one_is_greedy() {
        let mut rng = Rng::new(7);
        for _ in 0..20 {
            let mut logits = vec![0.1, 3.0, 2.9, -5.0];
            assert_eq!(sample(&mut logits, &[], &params(1, 1.0, 1.0), &mut rng), 1);
        }
    }

    #[test]
    fn top_p_keeps_first_candidate() {
        let mut rng = Rng::new(3);
        for _ in 0..20 {
            let mut logits = vec![10.0, 0.0, 0.0, 0.0];
            assert_eq!(sample(&mut logits, &[], &params(4, 0.5, 1.0), &mut rng), 0);
        }
    }

    #[test]
    fn seeded_sampling_is_deterministic_and_covers_top_k() {
        let draw = |seed: u64| -> Vec<usize> {
            let mut rng = Rng::new(seed);
            (0..200)
                .map(|_| {
                    let mut logits = vec![1.0, 1.0, 1.0, -30.0];
                    sample(&mut logits, &[], &params(3, 1.0, 1.0), &mut rng)
                })
                .collect()
        };
        let a = draw(42);
        assert_eq!(a, draw(42));
        for token in 0..3 {
            assert!(a.contains(&token));
        }
        assert!(!a.contains(&3));
    }

    #[test]
    fn options_are_validated() {
        let mut options = SamplingOptions::default();
        assert_eq!(SamplingParams::from_options(&options, "t").unwrap(), SamplingParams::default());
        options.top_p = Some(0.0);
        assert!(SamplingParams::from_options(&options, "t").is_err());
    }
}
