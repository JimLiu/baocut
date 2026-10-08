//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/Qwen3TTS/Sampling.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Talker / Code Predictor 采样。
//!
//! 参考实现在 MLX 图上做 top-k / top-p / gumbel-max；这里 logits 已拉回主机
//! `f32` 切片，用同样的算子顺序在 CPU 上计算，并用自带的可播种 RNG 做
//! 分类采样（gumbel-max 等价于按 softmax 概率分类采样）。纯逻辑，全平台
//! 编译，可无权重单测。

/// 采样配置。
#[derive(Debug, Clone, PartialEq)]
pub struct SamplingConfig {
    pub temperature: f32,
    pub top_k: usize,
    pub top_p: f32,
    pub repetition_penalty: f32,
    pub max_tokens: usize,
    /// 加到 EOS logit 上的偏置（top-k / top-p 不会滤掉 EOS）。
    pub eos_logit_bias: f32,
}

impl Default for SamplingConfig {
    fn default() -> Self {
        Self {
            temperature: 0.9,
            top_k: 50,
            top_p: 1.0,
            repetition_penalty: 1.05,
            max_tokens: 4096,
            eos_logit_bias: 0.0,
        }
    }
}

impl SamplingConfig {
    /// 由 [`crate::synthesize::types::SamplingOptions`] 覆盖：`None` 字段保持模型默认。
    pub fn from_options(options: &crate::synthesize::types::SamplingOptions) -> Self {
        let mut config = Self::default();
        if let Some(t) = options.temperature {
            config.temperature = t;
        }
        if let Some(k) = options.top_k {
            config.top_k = k;
        }
        if let Some(p) = options.top_p {
            config.top_p = p;
        }
        if let Some(r) = options.repetition_penalty {
            config.repetition_penalty = r;
        }
        if let Some(m) = options.max_tokens {
            config.max_tokens = m;
        }
        config
    }

    /// Code Predictor 是否走贪心：Talker 温度 ≤ 0 时。
    pub fn code_predictor_greedy(&self) -> bool {
        self.temperature <= 0.0
    }
}

/// splitmix64 随机数发生器：确定性、可播种，只用于采样。
#[derive(Debug, Clone)]
pub struct Rng {
    state: u64,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    /// 未指定种子时用时钟播种。
    pub fn from_optional_seed(seed: Option<u64>) -> Self {
        let seed = seed.unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(0x9E37_79B9_7F4A_7C15)
        });
        Self::new(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// `[0, 1)` 均匀分布。
    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
}

const MASKED: f32 = -1e9;

fn argmax(logits: &[f32]) -> i32 {
    let mut best = 0usize;
    for (i, &v) in logits.iter().enumerate() {
        if v > logits[best] {
            best = i;
        }
    }
    best as i32
}

/// 按 softmax(logits) 做分类采样；被掩成 −1e9 的项概率为 0。
fn categorical(logits: &[f32], rng: &mut Rng) -> i32 {
    let max = logits.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let weights: Vec<f64> = logits.iter().map(|&l| ((l - max) as f64).exp()).collect();
    let total: f64 = weights.iter().sum();
    if !(total > 0.0) || !total.is_finite() {
        return argmax(logits);
    }
    let mut target = rng.next_f64() * total;
    for (i, w) in weights.iter().enumerate() {
        target -= w;
        if target < 0.0 {
            return i as i32;
        }
    }
    // 浮点误差兜底：取最后一个非零权重项。
    weights
        .iter()
        .rposition(|&w| w > 0.0)
        .map(|i| i as i32)
        .unwrap_or_else(|| argmax(logits))
}

/// 第 `k` 大的值（k ≥ 1，k ≤ len）。
fn kth_largest(logits: &[f32], k: usize) -> f32 {
    let mut sorted = logits.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    sorted[sorted.len() - k]
}

/// 就地应用 top-k：低于第 k 大值的项掩成 −1e9。
fn apply_top_k(logits: &mut [f32], top_k: usize) {
    if top_k == 0 || top_k >= logits.len() {
        return;
    }
    let threshold = kth_largest(logits, top_k);
    for v in logits.iter_mut() {
        if *v < threshold {
            *v = MASKED;
        }
    }
}

/// 就地应用 top-p（nucleus）：按概率降序累计，保留累计质量首次达到 `top_p`
/// 的最小前缀，其余掩成 −1e9。
///
/// 参考实现在升序序列上用 `cum − p > top_p` 做掩码，会把概率最高的 token
/// 掩掉（默认 `top_p = 1.0` 从不触发，所以未暴露）；这里按标准 nucleus
/// 语义实现，默认值下两者都是空操作。
fn apply_top_p(logits: &mut [f32], top_p: f32) {
    if top_p >= 1.0 {
        return;
    }
    let mut order: Vec<usize> = (0..logits.len()).collect();
    order.sort_by(|&a, &b| logits[b].partial_cmp(&logits[a]).unwrap_or(std::cmp::Ordering::Equal));
    let max = logits.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let mut total = 0f64;
    let probs: Vec<f64> = order
        .iter()
        .map(|&i| {
            let p = ((logits[i] - max) as f64).exp();
            total += p;
            p
        })
        .collect();
    let mut cum = 0f64;
    for (pos, &i) in order.iter().enumerate() {
        if cum >= top_p as f64 {
            logits[i] = MASKED;
        }
        cum += probs[pos] / total;
    }
}

/// Talker 采样：压制区间、重复惩罚、温度、top-k、
/// top-p（EOS 免疫过滤并加偏置）、分类采样。`logits` 会被就地修改。
pub fn sample_token(
    logits: &mut [f32],
    config: &SamplingConfig,
    generated: &[i32],
    suppress: Option<(i32, i32)>,
    eos_token: i32,
    rng: &mut Rng,
) -> i32 {
    let vocab = logits.len();

    if let Some((start, end)) = suppress
        && start < end
        && start >= 0
        && (end as usize) <= vocab
    {
        for (i, v) in logits.iter_mut().enumerate().take(end as usize).skip(start as usize) {
            if i as i32 != eos_token {
                *v = MASKED;
            }
        }
    }

    if config.repetition_penalty != 1.0 && !generated.is_empty() {
        let mut seen = std::collections::HashSet::new();
        for &t in generated {
            if t >= 0 && (t as usize) < vocab && seen.insert(t) {
                let v = &mut logits[t as usize];
                if *v < 0.0 {
                    *v *= config.repetition_penalty;
                } else {
                    *v /= config.repetition_penalty;
                }
            }
        }
    }

    if config.temperature <= 0.0 {
        return argmax(logits);
    }
    for v in logits.iter_mut() {
        *v /= config.temperature;
    }

    let eos_index = (eos_token >= 0 && (eos_token as usize) < vocab).then_some(eos_token as usize);
    let eos_logit = eos_index.map(|i| logits[i]);

    apply_top_k(logits, config.top_k);
    apply_top_p(logits, config.top_p);

    if let (Some(i), Some(saved)) = (eos_index, eos_logit) {
        logits[i] = saved + config.eos_logit_bias;
    }

    categorical(logits, rng)
}

/// Code Predictor 每组采样：贪心或温度 + top-k + 分类采样。
pub fn sample_frame_token(logits: &mut [f32], config: &SamplingConfig, rng: &mut Rng) -> i32 {
    if config.code_predictor_greedy() {
        return argmax(logits);
    }
    for v in logits.iter_mut() {
        *v /= config.temperature;
    }
    apply_top_k(logits, config.top_k);
    categorical(logits, rng)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn greedy() -> SamplingConfig {
        SamplingConfig {
            temperature: 0.0,
            ..Default::default()
        }
    }

    #[test]
    fn rng_is_deterministic() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..8 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
        let x = a.next_f64();
        assert!((0.0..1.0).contains(&x));
    }

    #[test]
    fn suppress_range_keeps_eos() {
        let mut logits = vec![0.0f32; 10];
        logits[5] = 10.0; // 在压制区但不是 EOS
        logits[7] = 5.0; // EOS
        logits[1] = 1.0;
        let t = sample_token(&mut logits, &greedy(), &[], Some((4, 10)), 7, &mut Rng::new(1));
        assert_eq!(t, 7);
        let mut logits = vec![0.0f32; 10];
        logits[5] = 10.0;
        logits[1] = 1.0;
        let t = sample_token(&mut logits, &greedy(), &[], Some((4, 10)), 7, &mut Rng::new(1));
        assert_eq!(t, 1);
    }

    #[test]
    fn repetition_penalty_scales_by_sign() {
        let config = SamplingConfig {
            temperature: 0.0,
            repetition_penalty: 2.0,
            ..Default::default()
        };
        let mut logits = vec![3.0f32, 2.0, -1.0];
        // token 0 已生成：3/2 = 1.5 < 2.0 → 选 1
        let t = sample_token(&mut logits, &config, &[0, 0], None, 99, &mut Rng::new(1));
        assert_eq!(t, 1);
        assert_eq!(logits[0], 1.5);
        let mut logits = vec![3.0f32, 2.0, -1.0];
        sample_token(&mut logits, &config, &[2], None, 99, &mut Rng::new(1));
        assert_eq!(logits[2], -2.0);
    }

    #[test]
    fn top_k_masks_below_threshold() {
        let mut logits = vec![1.0f32, 5.0, 3.0, 4.0, 2.0];
        apply_top_k(&mut logits, 2);
        assert_eq!(logits, vec![MASKED, 5.0, MASKED, 4.0, MASKED]);
        let mut logits = vec![1.0f32, 2.0];
        apply_top_k(&mut logits, 0);
        assert_eq!(logits, vec![1.0, 2.0]);
    }

    #[test]
    fn top_p_keeps_head_of_distribution() {
        // 概率约 [0.665, 0.245, 0.09]：top_p 0.5 只留最大项
        let mut logits = vec![2.0f32, 1.0, 0.0];
        apply_top_p(&mut logits, 0.5);
        assert_eq!(logits[0], 2.0);
        assert_eq!(logits[1], MASKED);
        assert_eq!(logits[2], MASKED);
        // top_p 0.8：前两项累计 0.91 ≥ 0.8，第三项被掩
        let mut logits = vec![2.0f32, 1.0, 0.0];
        apply_top_p(&mut logits, 0.8);
        assert_eq!(logits, vec![2.0, 1.0, MASKED]);
        // top_p 0.95：三项全留
        let mut logits = vec![2.0f32, 1.0, 0.0];
        apply_top_p(&mut logits, 0.95);
        assert_eq!(logits, vec![2.0, 1.0, 0.0]);
    }

    #[test]
    fn eos_survives_filters_with_bias() {
        let config = SamplingConfig {
            temperature: 1.0,
            top_k: 1,
            top_p: 1.0,
            repetition_penalty: 1.0,
            eos_logit_bias: 100.0,
            ..Default::default()
        };
        let mut logits = vec![5.0f32, 4.0, -3.0];
        let t = sample_token(&mut logits, &config, &[], None, 2, &mut Rng::new(3));
        assert_eq!(t, 2);
        assert_eq!(logits[2], 97.0);
    }

    #[test]
    fn categorical_never_picks_masked() {
        let config = SamplingConfig {
            temperature: 1.0,
            top_k: 2,
            top_p: 1.0,
            repetition_penalty: 1.0,
            ..Default::default()
        };
        let mut rng = Rng::new(7);
        for _ in 0..200 {
            let mut logits = vec![0.0f32, 3.0, 3.0, 0.0];
            let t = sample_token(&mut logits, &config, &[], None, 99, &mut rng);
            assert!(t == 1 || t == 2, "sampled {t}");
        }
    }

    #[test]
    fn frame_token_greedy_and_sampled() {
        let mut logits = vec![0.1f32, 0.9, 0.5];
        assert_eq!(sample_frame_token(&mut logits, &greedy(), &mut Rng::new(1)), 1);
        let config = SamplingConfig {
            temperature: 0.5,
            top_k: 1,
            ..Default::default()
        };
        let mut logits = vec![0.1f32, 0.9, 0.5];
        assert_eq!(sample_frame_token(&mut logits, &config, &mut Rng::new(1)), 1);
    }

    #[test]
    fn from_options_keeps_defaults_for_none() {
        let options = crate::synthesize::types::SamplingOptions {
            temperature: Some(0.5),
            top_k: None,
            top_p: None,
            repetition_penalty: None,
            max_tokens: Some(100),
            seed: Some(1),
            ..Default::default()
        };
        let config = SamplingConfig::from_options(&options);
        assert_eq!(config.temperature, 0.5);
        assert_eq!(config.top_k, 50);
        assert_eq!(config.max_tokens, 100);
    }
}
