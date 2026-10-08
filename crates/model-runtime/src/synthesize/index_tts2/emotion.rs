//! 情感控制：参数层照官方网页 `webui.py`，向量合成照官方 `infer_v2.py` / `infer_v2_5.py`。
//!
//! 8 维情感向量的顺序是 happy / angry / sad / afraid / disgusted /
//! melancholic / surprised / calm。一次请求给的是八个 0–1 的滑块与情感权重 `alpha`：
//!
//! 1. 网页层 [`normalize_emo_vec`]：逐维乘偏置（官方说是压低容易出怪声的情绪），
//!    合计超过 0.8 时整体缩到 0.8。
//! 2. `infer()` 层 [`scale_emo_vec`]：`alpha` 夹到 [0, 1]，不是 1 时逐维乘它并截到四位小数。
//! 3. 显式向量经 `feat1`（说话人风格矩阵，192 维）的余弦匹配选出每个情感桶里最像
//!    当前音色的一行，按权重混合 `feat2`（情感矩阵，1280 维）的对应行，再加上
//!    `(1 − 权重和) × 参考音频的情感向量`（[`explicit_emotion_vector`] 与引擎的合成步）。

use anyhow::{Result, bail};

pub const EMOTION_ORDER: [&str; 8] = ["happy", "angry", "sad", "afraid", "disgusted", "melancholic", "surprised", "calm"];

/// 官方 `normalize_emo_vec` 的逐维偏置（次序同 [`EMOTION_ORDER`]）。
pub const EMOTION_BIAS: [f32; 8] = [0.9375, 0.875, 1.0, 1.0, 0.9375, 0.9375, 0.6875, 0.5625];

/// 官方 `normalize_emo_vec` 的合计上限。
pub const EMOTION_SUM_CAP: f32 = 0.8;

/// 官方网页 `normalize_emo_vec(vec, apply_bias=True)`：逐维乘 [`EMOTION_BIAS`]，
/// 合计超过 [`EMOTION_SUM_CAP`] 时等比缩到它。与 Python 一样在 f64 上算。
pub fn normalize_emo_vec(sliders: [f64; 8]) -> [f64; 8] {
    let biased: [f64; 8] = std::array::from_fn(|i| sliders[i] * EMOTION_BIAS[i] as f64);
    let sum: f64 = biased.iter().sum();
    let cap = EMOTION_SUM_CAP as f64;
    if sum > cap {
        biased.map(|value| value * (cap / sum))
    } else {
        biased
    }
}

/// 官方 `infer()` 对显式向量的缩放：`alpha` 夹到 [0, 1]；不是 1 时逐维
/// `int(x × alpha × 10000) / 10000`（向零截断到四位小数）。
pub fn scale_emo_vec(vector: [f64; 8], alpha: f64) -> [f64; 8] {
    let scale = alpha.clamp(0.0, 1.0);
    if scale == 1.0 {
        return vector;
    }
    vector.map(|value| (value * scale * 10_000.0).trunc() / 10_000.0)
}

/// f32 按它最短的十进制写法转 f64（`0.65f32` → `0.65`），好让四位截断与官方拿
/// Python 浮点算出的一致：直接 `as f64` 是 `0.6499999761…`，截断会少一位。
fn decimal(value: f32) -> f64 {
    value.to_string().parse().unwrap_or(value as f64)
}

/// 送进 `infer()` 的最终情感向量（已过网页归一化与 `alpha` 缩放）。
#[derive(Debug, Clone, PartialEq)]
pub struct EmotionControl {
    pub vector: [f32; 8],
}

impl EmotionControl {
    /// 网页滑块 + 情感权重 → 最终向量：每维须是 0–1 的有限值（官方滑块的范围），
    /// `alpha` 须是有限值（越界照官方夹到 [0, 1]）。
    pub fn from_sliders(sliders: [f32; 8], alpha: f32) -> Result<Self> {
        for value in sliders {
            if !value.is_finite() || !(0.0..=1.0).contains(&value) {
                bail!("IndexTTS 情感向量每一维须是 0–1 之间的有限值，收到 {value}");
            }
        }
        if !alpha.is_finite() {
            bail!("IndexTTS 情感权重须是有限值，收到 {alpha}");
        }
        let vector = scale_emo_vec(normalize_emo_vec(sliders.map(decimal)), decimal(alpha));
        Ok(Self {
            vector: vector.map(|value| value as f32),
        })
    }

    pub fn from_slice(values: &[f32], alpha: f32) -> Result<Self> {
        if values.len() != 8 {
            bail!("IndexTTS 情感向量必须恰好 8 个值，收到 {}", values.len());
        }
        let mut sliders = [0f32; 8];
        sliders.copy_from_slice(values);
        Self::from_sliders(sliders, alpha)
    }

    /// 官方 `torch.sum(weight_vector)`。
    pub fn weight_sum(&self) -> f32 {
        self.vector.iter().sum()
    }
}

/// 显式情感向量：对每个权重 > 0 的情感桶，在 `speaker_rows`（`[rows, style_dim]`
/// 行主序）里该桶的行区间内找与 `style` 余弦最相似的一行，把 `emotion_rows`
/// （`[rows, emotion_dim]`）对应行按权重累加。返回 `(向量, 权重和)`。
pub fn explicit_emotion_vector(
    control: &EmotionControl,
    style: &[f32],
    speaker_rows: &[f32],
    emotion_rows: &[f32],
    bucket_counts: &[usize],
    style_dim: usize,
    emotion_dim: usize,
) -> Result<(Vec<f32>, f32)> {
    let total: usize = bucket_counts.iter().sum();
    if style.len() != style_dim {
        bail!("风格向量维度 {} 与期望 {style_dim} 不符", style.len());
    }
    if speaker_rows.len() < total * style_dim || emotion_rows.len() < total * emotion_dim {
        bail!(
            "情感矩阵行数不足：需要 {total} 行，feat1 {} 值 / feat2 {} 值",
            speaker_rows.len(),
            emotion_rows.len()
        );
    }
    if bucket_counts.len() != 8 {
        bail!("emo_num 必须有 8 个桶，收到 {}", bucket_counts.len());
    }
    let weights = control.vector;
    let weight_sum = control.weight_sum();
    let mut output = vec![0f32; emotion_dim];
    let mut offset = 0usize;
    for (bucket, &count) in bucket_counts.iter().enumerate() {
        let weight = weights[bucket];
        if weight > 0.0 {
            let row = most_similar_style_row(style, speaker_rows, offset, count, style_dim);
            let source = (offset + row) * emotion_dim;
            for (i, value) in output.iter_mut().enumerate() {
                *value += weight * emotion_rows[source + i];
            }
        }
        offset += count;
    }
    Ok((output, weight_sum))
}

fn most_similar_style_row(style: &[f32], speaker_rows: &[f32], start: usize, count: usize, dim: usize) -> usize {
    let style_norm = style.iter().map(|v| v * v).sum::<f32>().sqrt().max(f32::EPSILON);
    let mut best_index = 0;
    let mut best_score = f32::MIN;
    for row in 0..count {
        let row_start = (start + row) * dim;
        let mut dot = 0f32;
        let mut row_norm_squared = 0f32;
        for i in 0..dim {
            let value = speaker_rows[row_start + i];
            dot += style[i] * value;
            row_norm_squared += value * value;
        }
        let score = dot / (style_norm * row_norm_squared.sqrt().max(f32::EPSILON));
        if score > best_score {
            best_score = score;
            best_index = row;
        }
    }
    best_index
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: [f32; 8], b: [f32; 8]) -> bool {
        a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-6)
    }

    /// 官方网页的两步：偏置后合计不超 0.8 时只乘偏置，超了先缩到 0.8 再乘权重。
    #[test]
    fn webui_normalization_then_infer_scaling() {
        assert_eq!(EMOTION_ORDER[7], "calm");
        let calm = EmotionControl::from_sliders([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0], 0.65).unwrap();
        assert!(close(calm.vector, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.3656]));
        let happy = EmotionControl::from_sliders([1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 0.65).unwrap();
        // 偏置后 0.9375 > 0.8：缩到 0.8，再乘 0.65。
        assert!(close(happy.vector, [0.52, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
        let all = EmotionControl::from_sliders([1.0; 8], 0.65).unwrap();
        assert!(close(all.vector, [0.0702, 0.0655, 0.0749, 0.0749, 0.0702, 0.0702, 0.0515, 0.0421]));
        // 偏置后 1.0 + 0.9375 = 1.9375 > 0.8：先缩到 0.8，再乘 0.5 → 合计 0.4。
        let capped = EmotionControl::from_sliders([0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0], 0.5).unwrap();
        assert!((capped.weight_sum() - 0.4).abs() < 1e-3, "{capped:?}");
        assert!(close(capped.vector, [0.0, 0.0, 0.2064, 0.0, 0.0, 0.1935, 0.0, 0.0]));
        // 0.65 按十进制截：1.0 × 0.65 是 0.65，不是 0.6499。
        let sad = EmotionControl::from_sliders([0.0, 0.0, 0.8, 0.0, 0.0, 0.0, 0.0, 0.0], 0.65).unwrap();
        assert!(close(sad.vector, [0.0, 0.0, 0.52, 0.0, 0.0, 0.0, 0.0, 0.0]));
        // alpha = 1 不截断；越界照官方夹取。
        let full = EmotionControl::from_sliders([0.0, 0.0, 0.3, 0.0, 0.0, 0.0, 0.0, 0.0], 1.0).unwrap();
        assert!(close(full.vector, [0.0, 0.0, 0.3, 0.0, 0.0, 0.0, 0.0, 0.0]));
        let clamped = EmotionControl::from_sliders([0.0, 0.0, 0.3, 0.0, 0.0, 0.0, 0.0, 0.0], 1.5).unwrap();
        assert_eq!(clamped, full);
    }

    #[test]
    fn validation() {
        assert!(EmotionControl::from_sliders([1.0; 8], 0.65).is_ok());
        assert!(EmotionControl::from_sliders([1.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 1.0).is_err());
        assert!(EmotionControl::from_sliders([-0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 1.0).is_err());
        assert!(EmotionControl::from_sliders([0.1; 8], f32::NAN).is_err());
        assert!(EmotionControl::from_slice(&[0.1; 7], 1.0).is_err());
    }

    #[test]
    fn explicit_vector_picks_most_similar_row_per_bucket() {
        // 2 个桶（各 2 行），style_dim 2，emotion_dim 3。
        let style = [1.0, 0.0];
        let speaker_rows = [0.0, 1.0, 1.0, 0.1, 1.0, 0.0, 0.0, 1.0];
        let emotion_rows = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 5.0, 5.0, 5.0];
        let control = EmotionControl {
            vector: [0.5, 0.25, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        };
        let (vector, sum) =
            explicit_emotion_vector(&control, &style, &speaker_rows, &emotion_rows, &[2, 2, 0, 0, 0, 0, 0, 0], 2, 3).unwrap();
        // 桶 0 选第 1 行（[1,0.1]），桶 1 选第 0 行（[1,0]）。
        assert_eq!(vector, vec![0.0, 0.5, 0.25]);
        assert!((sum - 0.75).abs() < 1e-6);
    }
}
