//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/OmniVoiceTTS/OmniVoiceBackbone.swift / Sources/OmniVoiceTTS/OmniVoiceDiffusion.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! OmniVoice 主干：Qwen3 双向注意力（无因果掩码）+ 文本 / 8 码本音频两张嵌入表 +
//! 音频输出头。对照官方 `OmniVoice._prepare_embed_inputs` / `forward` 与
//! `_predict_tokens_with_scoring`。
//!
//! 嵌入表在 MLX 端保持量化：按 id 先取行、再只反量化取出的行（整表 151676×1024 反量化成
//! F32 要 600 MB）；Candle 端同样取行后反量化（`ops::dequantize` 按 MLX 语义实现）。

use crate::synthesize::qwen3_tts::layers::{Linear, RmsNorm, SwigluMlp};
use crate::synthesize::qwen3_tts::weights::Weights;
use crate::synthesize::tensor::fast;
use crate::synthesize::tensor::ops;
use crate::synthesize::tensor::ops::indexing::{IndexOp, argmax_axis};
use crate::synthesize::tensor::transforms::eval;
use crate::synthesize::tensor::{Array, Dtype};
use anyhow::{Result, bail, ensure};

use super::config::OmniVoiceConfig;

/// 嵌入表：普通浮点，或 MLX 仿射量化（U32 打包 + scales / biases）。
enum Embedding {
    Float(Array),
    Quantized {
        weight: Array,
        scales: Array,
        biases: Array,
        group_size: i32,
        bits: i32,
    },
}

impl Embedding {
    fn load(weights: &mut Weights, prefix: &str, group_size: usize, bits: u32) -> Result<Self> {
        let weight = weights.take(&format!("{prefix}.weight"))?;
        match weights.take_optional(&format!("{prefix}.scales")) {
            Some(scales) => {
                ensure!(bits > 0, "权重 {prefix} 带 scales 但配置未声明量化位数");
                Ok(Self::Quantized {
                    weight,
                    scales,
                    biases: weights.take(&format!("{prefix}.biases"))?,
                    group_size: group_size as i32,
                    bits: bits as i32,
                })
            }
            None if weight.dtype() == Dtype::Uint32 => bail!("权重 {prefix} 是 U32 但缺少 scales"),
            None => Ok(Self::Float(weight)),
        }
    }

    /// `ids`（一维）→ `[N, D]`，F32。
    fn forward(&self, ids: &Array) -> Result<Array> {
        Ok(match self {
            Self::Float(weight) => weight.take_axis(ids, 0)?.as_dtype(Dtype::Float32)?,
            Self::Quantized {
                weight,
                scales,
                biases,
                group_size,
                bits,
            } => ops::dequantize(
                weight.take_axis(ids, 0)?,
                scales.take_axis(ids, 0)?,
                &biases.take_axis(ids, 0)?,
                *group_size,
                *bits,
            )?
            .as_dtype(Dtype::Float32)?,
        })
    }
}

struct Layer {
    q: Linear,
    k: Linear,
    v: Linear,
    o: Linear,
    q_norm: RmsNorm,
    k_norm: RmsNorm,
    mlp: SwigluMlp,
    input_norm: RmsNorm,
    post_norm: RmsNorm,
}

pub struct Backbone {
    embed_tokens: Embedding,
    audio_embeddings: Embedding,
    layers: Vec<Layer>,
    norm: RmsNorm,
    audio_heads: Linear,
    heads: i32,
    kv_heads: i32,
    head_dim: i32,
    rope_theta: f32,
    pub codebooks: usize,
    pub audio_vocab: usize,
    pub mask_id: usize,
}

impl Backbone {
    pub fn load(weights: &mut Weights, config: &OmniVoiceConfig) -> Result<Self> {
        let (group, bits) = config.quant();
        let llm = &config.llm_config;
        ensure!(
            config.audio_mask_id + 1 == config.audio_vocab_size,
            "OmniVoice 的 audio_mask_id 必须是音频词表最后一项（{} / {}）",
            config.audio_mask_id,
            config.audio_vocab_size
        );
        let eps = llm.rms_norm_eps;
        let mut layers = Vec::with_capacity(llm.num_hidden_layers);
        for i in 0..llm.num_hidden_layers {
            let p = format!("llm.layers.{i}");
            let a = format!("{p}.self_attn");
            layers.push(Layer {
                q: Linear::load(weights, &format!("{a}.q_proj"), group, bits)?,
                k: Linear::load(weights, &format!("{a}.k_proj"), group, bits)?,
                v: Linear::load(weights, &format!("{a}.v_proj"), group, bits)?,
                o: Linear::load(weights, &format!("{a}.o_proj"), group, bits)?,
                q_norm: RmsNorm::load(weights, &format!("{a}.q_norm"), eps)?,
                k_norm: RmsNorm::load(weights, &format!("{a}.k_norm"), eps)?,
                mlp: SwigluMlp::load(weights, &format!("{p}.mlp"), group, bits)?,
                input_norm: RmsNorm::load(weights, &format!("{p}.input_layernorm"), eps)?,
                post_norm: RmsNorm::load(weights, &format!("{p}.post_attention_layernorm"), eps)?,
            });
        }
        Ok(Self {
            embed_tokens: Embedding::load(weights, "llm.embed_tokens", group, bits)?,
            audio_embeddings: Embedding::load(weights, "audio_embeddings", group, bits)?,
            layers,
            norm: RmsNorm::load(weights, "llm.norm", eps)?,
            audio_heads: Linear::load(weights, "audio_heads", group, bits)?,
            heads: llm.num_attention_heads as i32,
            kv_heads: llm.num_key_value_heads as i32,
            head_dim: llm.head_dim() as i32,
            rope_theta: llm.rope_theta(),
            codebooks: config.num_audio_codebook,
            audio_vocab: config.audio_vocab_size,
            mask_id: config.audio_mask_id,
        })
    }

    /// 文本位置：`embed_tokens(ids)` → `[1, N, D]`。
    pub fn embed_text(&self, ids: &[u32]) -> Result<Array> {
        let n = ids.len() as i32;
        Ok(self.embed_tokens.forward(&Array::from_slice(ids, &[n]))?.reshape(&[1, n, -1])?)
    }

    /// 音频位置：8 个码本各自偏移 `i·audio_vocab` 后查表再求和 → `[1, frames, D]`。
    /// `codes` 为 `[codebooks, frames]` 行主序（掩码位是 `mask_id`，有自己的嵌入）。
    pub fn embed_audio(&self, codes: &[u32], frames: usize) -> Result<Array> {
        ensure!(
            codes.len() == self.codebooks * frames && frames > 0,
            "OmniVoice 音频 token 数 {} 与 {} 码本 × {frames} 帧不符",
            codes.len(),
            self.codebooks
        );
        let shifted: Vec<u32> = codes
            .iter()
            .enumerate()
            .map(|(i, &c)| c + (i / frames * self.audio_vocab) as u32)
            .collect();
        let rows = self
            .audio_embeddings
            .forward(&Array::from_slice(&shifted, &[shifted.len() as i32]))?;
        Ok(rows.reshape(&[self.codebooks as i32, frames as i32, -1])?.sum_axis(0, true)?)
    }

    fn attention(&self, layer: &Layer, x: &Array) -> Result<Array> {
        let len = x.dim(1);
        let heads = |h: Array, n: i32| -> Result<Array> { Ok(h.reshape(&[1, len, n, self.head_dim])?) };
        let q = layer
            .q_norm
            .forward(&heads(layer.q.forward(x)?, self.heads)?)?
            .transpose_axes(&[0, 2, 1, 3])?;
        let k = layer
            .k_norm
            .forward(&heads(layer.k.forward(x)?, self.kv_heads)?)?
            .transpose_axes(&[0, 2, 1, 3])?;
        let v = heads(layer.v.forward(x)?, self.kv_heads)?.transpose_axes(&[0, 2, 1, 3])?;
        let q = fast::rope(&q, self.head_dim, false, self.rope_theta, 1.0, 0, None)?;
        let k = fast::rope(&k, self.head_dim, false, self.rope_theta, 1.0, 0, None)?;
        let scale = (self.head_dim as f32).sqrt().recip();
        // 官方推理给整段全 True 的注意力掩码：双向、无因果。
        let out = fast::scaled_dot_product_attention(&q, &k, &v, scale, None, None)?;
        let merged = out.transpose_axes(&[0, 2, 1, 3])?.reshape(&[1, len, self.heads * self.head_dim])?;
        layer.o.forward(&merged)
    }

    /// 整段嵌入 `[1, L, D]` 过主干，只对最后 `tail` 个位置出音频 logits：
    /// `[codebooks, tail, audio_vocab]`（F32）。位置 id 从 0 起。
    pub fn logits(&self, embeds: &Array, tail: usize) -> Result<Array> {
        let mut h = embeds.clone();
        for layer in &self.layers {
            let attn = self.attention(layer, &layer.input_norm.forward(&h)?)?;
            h = h.add(&attn)?;
            let mlp = layer.mlp.forward(&layer.post_norm.forward(&h)?)?;
            h = h.add(&mlp)?;
        }
        let len = h.dim(1);
        let tail = tail as i32;
        ensure!(tail > 0 && tail <= len, "OmniVoice 目标长度 {tail} 超出序列 {len}");
        let h = self.norm.forward(&h.index((.., len - tail.., ..)))?;
        Ok(self
            .audio_heads
            .forward(&h)?
            .reshape(&[tail, self.codebooks as i32, self.audio_vocab as i32])?
            .transpose_axes(&[1, 0, 2])?
            .as_dtype(Dtype::Float32)?)
    }
}

/// 官方 `_predict_tokens_with_scoring`（`class_temperature = 0`，贪心）：
/// 有引导时 `log_softmax(lp_c + g·(lp_c − lp_u))`，否则 `lp_c`；屏蔽掩码 id 后取
/// argmax 作预测、最大对数概率作置信度。返回按 `[codebooks, T]` 行主序展开的两组值。
pub fn predict(cond: &Array, uncond: Option<&Array>, guidance: f32, mask_id: usize) -> Result<(Vec<u32>, Vec<f32>)> {
    let log_softmax = |x: &Array| -> Result<Array> { Ok(x.subtract(&x.logsumexp_axis(-1, true)?)?) };
    let lp_c = log_softmax(cond)?;
    let lp = match uncond {
        Some(uncond) if guidance != 0.0 => {
            let lp_u = log_softmax(uncond)?;
            let guided = lp_c.add(&lp_c.subtract(&lp_u)?.multiply(Array::from_f32(guidance))?)?;
            log_softmax(&guided)?
        }
        _ => lp_c,
    };
    // 掩码 id 是最后一项：切掉它等价于把它置成 −inf。
    let lp = lp.index((.., .., ..mask_id as i32));
    let pred = argmax_axis(&lp, -1, false)?.as_dtype(Dtype::Uint32)?;
    let score = lp.max_axis(-1, false)?;
    eval([&pred, &score])?;
    Ok((pred.as_slice::<u32>().to_vec(), score.as_slice::<f32>().to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 8 bit、组长 32（MLX 支持的最小组长）：量化嵌入表按 id 取行后反量化，与直接查浮点表一致。
    #[test]
    fn quantized_embedding_matches_float_rows() {
        let _mlx = super::super::tests::mlx_lock();
        let rows = 3usize;
        let dim = 64usize;
        let q: Vec<u32> = (0..rows * dim).map(|i| ((i * 37) % 256) as u32).collect();
        let scales: Vec<f32> = (0..rows * 2).map(|i| 0.01 * (i + 1) as f32).collect();
        let biases: Vec<f32> = (0..rows * 2).map(|i| -0.5 + 0.1 * i as f32).collect();
        let packed: Vec<u32> = q
            .chunks(4)
            .map(|c| c.iter().enumerate().fold(0u32, |acc, (j, &v)| acc | (v << (8 * j))))
            .collect();
        let float: Vec<f32> = (0..rows * dim)
            .map(|i| {
                let g = i / 32;
                q[i] as f32 * scales[g] + biases[g]
            })
            .collect();
        let quantized = Embedding::Quantized {
            weight: Array::from_slice(&packed, &[rows as i32, 16]),
            scales: Array::from_slice(&scales, &[rows as i32, 2]),
            biases: Array::from_slice(&biases, &[rows as i32, 2]),
            group_size: 32,
            bits: 8,
        };
        let plain = Embedding::Float(Array::from_slice(&float, &[rows as i32, dim as i32]));
        let ids = Array::from_slice(&[2u32, 0, 2], &[3]);
        let a = quantized.forward(&ids).unwrap();
        let b = plain.forward(&ids).unwrap();
        assert_eq!(a.shape(), vec![3, 64]);
        let (a, b) = (a.as_slice::<f32>().to_vec(), b.as_slice::<f32>().to_vec());
        for (x, y) in a.iter().zip(&b) {
            assert!((x - y).abs() < 1e-5, "{a:?} vs {b:?}");
        }
    }
}
