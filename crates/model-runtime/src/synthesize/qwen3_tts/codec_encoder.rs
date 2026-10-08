//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/Qwen3TTS/SpeechTokenizerEncoder.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 语音分词器编码器（HF `MimiModel` 结构）：24 kHz 波形 → 16 组 codebook。
//! 权重是 Qwen3-TTS-Tokenizer-12Hz 里的 `encoder.*`（F32，PyTorch 布局）。
//! 只在 ICL 音色克隆时用来把参考音频编成 codec 前缀。

use crate::synthesize::tensor::fast::{self, ScaledDotProductAttentionMask};
use crate::synthesize::tensor::ops;
use crate::synthesize::tensor::ops::PadMode;
use crate::synthesize::tensor::ops::indexing::{IndexOp, argmin_axis};
use crate::synthesize::tensor::{Array, Dtype};
use anyhow::{Result, bail};

use crate::synthesize::tensor::gelu_same_dtype;

use super::layers::{LayerNorm, Linear};
use super::tokens::NUM_CODEBOOKS;
use super::weights::Weights;

const RATIOS: [i32; 4] = [8, 6, 5, 4];
const NUM_LAYERS: usize = 8;
const NUM_HEADS: i32 = 8;
const HEAD_DIM: i32 = 64;
const ROPE_THETA: f32 = 10_000.0;
const LAYER_NORM_EPS: f32 = 1e-5;
const CODEBOOK_USAGE_EPS: f32 = 1e-5;

/// `elu(x) = x (x>0) / exp(x)-1`，自己展开避免 mlx-rs 每次调用都重新 compile。
fn elu(x: &Array) -> Result<Array> {
    let zero = Array::from_f32(0.0);
    let one = Array::from_f32(1.0);
    let negative = ops::exp(x)?.subtract(&one)?;
    Ok(ops::which(&x.gt(&zero)?, x, &negative)?)
}

/// Mimi 的流式因果卷积：左侧补 `k_eff - stride`，右侧补齐到整帧的 `extra`。
struct MimiConv1d {
    weight: Array,
    bias: Option<Array>,
    kernel: i32,
    stride: i32,
    dilation: i32,
    pad_edge: bool,
}

impl MimiConv1d {
    fn load(weights: &mut Weights, prefix: &str, stride: i32, dilation: i32, pad_edge: bool) -> Result<Self> {
        let weight = weights.take_conv1d(&format!("{prefix}.weight"), false)?;
        let bias = weights.take_optional(&format!("{prefix}.bias"));
        let kernel = weight.dim(1);
        Ok(Self {
            weight,
            bias,
            kernel,
            stride,
            dilation,
            pad_edge,
        })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let len = x.dim(1);
        let k_eff = (self.kernel - 1) * self.dilation + 1;
        let padding_total = k_eff - self.stride;
        let n_frames = ((len + padding_total - k_eff).max(0) as f64) / (self.stride as f64) + 1.0;
        let ideal_len = (n_frames.ceil() as i32 - 1) * self.stride + k_eff - padding_total;
        let extra = (ideal_len - len).max(0);
        let padded = if padding_total == 0 && extra == 0 {
            x.clone()
        } else {
            let mode = if self.pad_edge { PadMode::Edge } else { PadMode::Constant };
            ops::pad(x, &[(0, 0), (padding_total, extra), (0, 0)], Array::from_f32(0.0), mode)?
        };
        let out = ops::conv1d(&padded, &self.weight, self.stride, 0, self.dilation, 1)?;
        Ok(match &self.bias {
            Some(bias) => out.add(bias)?,
            None => out,
        })
    }
}

/// `x + convB(elu(convA(elu(x))))`。
struct ResnetBlock {
    conv_a: MimiConv1d,
    conv_b: MimiConv1d,
}

impl ResnetBlock {
    fn forward(&self, x: &Array) -> Result<Array> {
        let h = self.conv_a.forward(&elu(x)?)?;
        let h = self.conv_b.forward(&elu(&h)?)?;
        Ok(h.add(x)?)
    }
}

struct EncoderLayer {
    residual: ResnetBlock,
    downsample: MimiConv1d,
}

impl EncoderLayer {
    fn forward(&self, x: &Array) -> Result<Array> {
        let h = self.residual.forward(x)?;
        self.downsample.forward(&elu(&h)?)
    }
}

/// SEANet 卷积编码器：`[B, N, 1]` → `[B, N/960, 512]`。
struct SeanetEncoder {
    init_conv: MimiConv1d,
    layers: Vec<EncoderLayer>,
    final_conv: MimiConv1d,
}

impl SeanetEncoder {
    /// 权重是扁平 `layers` 列表：0 = 初始卷积；第 k 阶段残差块在 1+3k、下采样在 3+3k；14 = 末卷积。
    fn load(weights: &mut Weights) -> Result<Self> {
        let init_conv = MimiConv1d::load(weights, "encoder.layers.0.conv", 1, 1, false)?;
        let mut layers = Vec::with_capacity(RATIOS.len());
        for (k, ratio) in RATIOS.iter().rev().enumerate() {
            let res_index = 1 + 3 * k;
            let down_index = 3 + 3 * k;
            let residual = ResnetBlock {
                conv_a: MimiConv1d::load(weights, &format!("encoder.layers.{res_index}.block.1.conv"), 1, 1, false)?,
                conv_b: MimiConv1d::load(weights, &format!("encoder.layers.{res_index}.block.3.conv"), 1, 1, false)?,
            };
            let downsample = MimiConv1d::load(weights, &format!("encoder.layers.{down_index}.conv"), *ratio, 1, false)?;
            layers.push(EncoderLayer { residual, downsample });
        }
        let final_conv = MimiConv1d::load(weights, "encoder.layers.14.conv", 1, 1, false)?;
        Ok(Self {
            init_conv,
            layers,
            final_conv,
        })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let mut h = self.init_conv.forward(x)?;
        for layer in &self.layers {
            h = layer.forward(&h)?;
        }
        self.final_conv.forward(&elu(&h)?)
    }
}

/// HF Mimi transformer 层：LayerNorm(带偏置) + 8×64 头注意力 + fc1/gelu/fc2，各带 LayerScale。
struct TransformerLayer {
    input_layernorm: LayerNorm,
    post_attention_layernorm: LayerNorm,
    q_proj: Linear,
    k_proj: Linear,
    v_proj: Linear,
    o_proj: Linear,
    fc1: Linear,
    fc2: Linear,
    self_attn_scale: Array,
    mlp_scale: Array,
}

impl TransformerLayer {
    fn load(weights: &mut Weights, prefix: &str) -> Result<Self> {
        Ok(Self {
            input_layernorm: LayerNorm::load(weights, &format!("{prefix}.input_layernorm"), LAYER_NORM_EPS)?,
            post_attention_layernorm: LayerNorm::load(weights, &format!("{prefix}.post_attention_layernorm"), LAYER_NORM_EPS)?,
            q_proj: Linear::load(weights, &format!("{prefix}.self_attn.q_proj"), 0, 0)?,
            k_proj: Linear::load(weights, &format!("{prefix}.self_attn.k_proj"), 0, 0)?,
            v_proj: Linear::load(weights, &format!("{prefix}.self_attn.v_proj"), 0, 0)?,
            o_proj: Linear::load(weights, &format!("{prefix}.self_attn.o_proj"), 0, 0)?,
            fc1: Linear::load(weights, &format!("{prefix}.mlp.fc1"), 0, 0)?,
            fc2: Linear::load(weights, &format!("{prefix}.mlp.fc2"), 0, 0)?,
            self_attn_scale: weights.take(&format!("{prefix}.self_attn_layer_scale.scale"))?,
            mlp_scale: weights.take(&format!("{prefix}.mlp_layer_scale.scale"))?,
        })
    }

    fn attention(&self, x: &Array, mask: &Array) -> Result<Array> {
        let batch = x.dim(0);
        let seq_len = x.dim(1);
        let heads = |proj: &Linear| -> Result<Array> {
            Ok(proj
                .forward(x)?
                .reshape(&[batch, seq_len, NUM_HEADS, HEAD_DIM])?
                .transpose_axes(&[0, 2, 1, 3])?)
        };
        let q = fast::rope(&heads(&self.q_proj)?, HEAD_DIM, false, ROPE_THETA, 1.0, 0, None)?;
        let k = fast::rope(&heads(&self.k_proj)?, HEAD_DIM, false, ROPE_THETA, 1.0, 0, None)?;
        let v = heads(&self.v_proj)?;
        let scale = (HEAD_DIM as f32).powf(-0.5);
        let out = fast::scaled_dot_product_attention(&q, &k, &v, scale, ScaledDotProductAttentionMask::Array(mask), None)?;
        let merged = out
            .transpose_axes(&[0, 2, 1, 3])?
            .reshape(&[batch, seq_len, NUM_HEADS * HEAD_DIM])?;
        self.o_proj.forward(&merged)
    }

    fn forward(&self, x: &Array, mask: &Array) -> Result<Array> {
        let attn = self.attention(&self.input_layernorm.forward(x)?, mask)?;
        let h = x.add(&self.self_attn_scale.multiply(&attn)?)?;
        let normed = self.post_attention_layernorm.forward(&h)?;
        let mlp = self.fc2.forward(&gelu_same_dtype(&self.fc1.forward(&normed)?)?)?;
        Ok(h.add(&self.mlp_scale.multiply(&mlp)?)?)
    }
}

struct EncoderTransformer {
    layers: Vec<TransformerLayer>,
}

impl EncoderTransformer {
    fn load(weights: &mut Weights) -> Result<Self> {
        let mut layers = Vec::with_capacity(NUM_LAYERS);
        for index in 0..NUM_LAYERS {
            layers.push(TransformerLayer::load(weights, &format!("encoder_transformer.layers.{index}"))?);
        }
        Ok(Self { layers })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let t = x.dim(1);
        let rows = ops::arange::<i32, i32>(None, t, None)?.reshape(&[t, 1])?;
        let cols = ops::arange::<i32, i32>(None, t, None)?.reshape(&[1, t])?;
        let mask = ops::which(&cols.gt(&rows)?, &Array::from_f32(-f32::MAX), &Array::from_f32(0.0))?;
        let mut h = x.clone();
        for layer in &self.layers {
            h = layer.forward(&h, &mask)?;
        }
        Ok(h)
    }
}

/// EMA 码本：`embedding = embed_sum / max(cluster_usage, 1e-5)`。
struct Codebook {
    embedding: Array,
    /// `‖e‖² / 2`，形状 `[size]`。
    half_norms: Array,
}

impl Codebook {
    fn load(weights: &mut Weights, prefix: &str) -> Result<Self> {
        let embed_sum = weights.take(&format!("{prefix}.embed_sum"))?;
        let usage = weights.take(&format!("{prefix}.cluster_usage"))?;
        let _ = weights.take_optional(&format!("{prefix}.initialized"));
        let denom = ops::maximum(&usage, &Array::from_f32(CODEBOOK_USAGE_EPS))?.reshape(&[-1, 1])?;
        let embedding = embed_sum.divide(&denom)?;
        let half_norms = ops::sum_axis(&embedding.multiply(&embedding)?, -1, false)?.divide(&Array::from_f32(2.0))?;
        Ok(Self { embedding, half_norms })
    }

    /// `x [B, T, dim]` → `(indices [B, T], quantized [B, T, dim])`。
    fn encode(&self, x: &Array) -> Result<(Array, Array)> {
        let batch = x.dim(0);
        let t = x.dim(1);
        let dim = x.dim(2);
        let flat = x.reshape(&[batch * t, dim])?;
        let dot = ops::matmul(&flat, &self.embedding.t())?;
        let indices = argmin_axis(&self.half_norms.subtract(&dot)?, -1, false)?;
        let quantized = self.embedding.index(&indices).reshape(&[batch, t, dim])?;
        Ok((indices.reshape(&[batch, t])?, quantized))
    }
}

struct ResidualVq {
    input_proj: MimiConv1d,
    codebooks: Vec<Codebook>,
}

impl ResidualVq {
    fn load(weights: &mut Weights, prefix: &str, count: usize) -> Result<Self> {
        let input_proj = MimiConv1d::load(weights, &format!("{prefix}.input_proj"), 1, 1, false)?;
        let mut codebooks = Vec::with_capacity(count);
        for index in 0..count {
            codebooks.push(Codebook::load(weights, &format!("{prefix}.layers.{index}.codebook"))?);
        }
        // 编码用不到 output_proj，丢弃以免残留计数误报。
        let _ = weights.take_optional(&format!("{prefix}.output_proj.weight"));
        Ok(Self { input_proj, codebooks })
    }

    /// `h [B, T, 512]` → `[B, nq, T]`（Int32）。
    fn encode(&self, h: &Array) -> Result<Array> {
        let mut residual = self.input_proj.forward(h)?;
        let mut codes = Vec::with_capacity(self.codebooks.len());
        for codebook in &self.codebooks {
            let (indices, quantized) = codebook.encode(&residual)?;
            residual = residual.subtract(&quantized)?;
            codes.push(ops::expand_dims(&indices, 1)?.as_dtype(Dtype::Int32)?);
        }
        let refs: Vec<&Array> = codes.iter().collect();
        Ok(ops::concatenate_axis(&refs, 1)?)
    }
}

pub struct CodecEncoder {
    seanet: SeanetEncoder,
    transformer: EncoderTransformer,
    downsample: MimiConv1d,
    semantic: ResidualVq,
    acoustic: ResidualVq,
}

impl CodecEncoder {
    /// `weights` 已剥掉 `encoder.` 前缀。
    pub fn load(weights: &mut Weights) -> Result<Self> {
        Ok(Self {
            seanet: SeanetEncoder::load(weights)?,
            transformer: EncoderTransformer::load(weights)?,
            downsample: MimiConv1d::load(weights, "downsample.conv", 2, 1, true)?,
            semantic: ResidualVq::load(weights, "quantizer.semantic_residual_vector_quantizer", 1)?,
            acoustic: ResidualVq::load(weights, "quantizer.acoustic_residual_vector_quantizer", NUM_CODEBOOKS - 1)?,
        })
    }

    /// 24 kHz 单声道样本 → `[1, 16, T]` Int32 codes。
    pub fn encode(&self, samples: &[f32]) -> Result<Array> {
        if samples.is_empty() {
            bail!("参考音频为空，无法编码");
        }
        let audio = Array::from_slice(samples, &[1, samples.len() as i32, 1]);
        let h = self.seanet.forward(&audio)?;
        let h = self.transformer.forward(&h)?;
        let h = self.downsample.forward(&h)?;
        let semantic = self.semantic.encode(&h)?;
        let acoustic = self.acoustic.encode(&h)?;
        let codes = ops::concatenate_axis(&[&semantic, &acoustic], 1)?;
        codes.eval()?;
        Ok(codes)
    }
}
