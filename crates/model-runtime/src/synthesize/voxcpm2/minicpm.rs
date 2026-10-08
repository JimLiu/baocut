//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/VoxCPM2TTS/MiniCPM4.swift / Sources/VoxCPM2TTS/VoxCPM2TTS.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! MiniCPM4 骨干与 VoxCPM2 的局部模块：LongRoPE、GQA 注意力、解码层、
//! `VoxCPMLocEnc`（逐 patch 取 CLS 的局部编码器）、`VoxCPMLocDiTV2`（局部扩散估计器）、
//! 标量量化层（FSQ）。对照 speech-swift `MiniCPM4.swift` 与 `VoxCPM2TTS.swift`
//! 的 `ScalarQuantizationLayer`。
//!
//! 同一张图同时跑 MLX 与 Candle：RoPE 不走 `fast::rope`（两端对 `freqs` 的口径不同，
//! Candle 版还忽略它），而是在主机侧按 LongRoPE 公式算好 f32 cos/sin 表再用普通算子旋转。

use crate::synthesize::tensor::fast::{self, ScaledDotProductAttentionMask};
use crate::synthesize::tensor::nn::silu;
use crate::synthesize::tensor::ops;
use crate::synthesize::tensor::ops::indexing::IndexOp;
use crate::synthesize::tensor::{Array, Dtype};
use anyhow::Result;

use crate::synthesize::qwen3_tts::layers::{KvCache, Linear, SwigluMlp};
use crate::synthesize::qwen3_tts::weights::Weights;

/// 取一个浮点张量并提升到 f32（speech-swift 在 Apple 上把非量化参数一律提升到 f32：
/// bf16/fp16 会让扩散循环出毛刺）。
pub fn take_f32(weights: &mut Weights, key: &str) -> Result<Array> {
    Ok(weights.take(key)?.as_dtype(Dtype::Float32)?)
}

/// RMSNorm：权重提升到 f32，激活本来就是 f32。
pub struct Norm {
    weight: Array,
    eps: f32,
}

impl Norm {
    pub fn load(weights: &mut Weights, prefix: &str, eps: f32) -> Result<Self> {
        Ok(Self {
            weight: take_f32(weights, &format!("{prefix}.weight"))?,
            eps,
        })
    }

    pub fn forward(&self, x: &Array) -> Result<Array> {
        Ok(fast::rms_norm(x, &self.weight, self.eps)?)
    }
}

/// MiniCPM LongRoPE（`MiniCPMLongRoPE`）：`freq_i = inv_freq_i / factor_i`，
/// `max_position_embeddings > original` 时用 long_factor，否则 short_factor；
/// cos/sin 再乘 `sqrt(1 + ln(scale)/ln(original))`。
#[derive(Clone)]
pub struct LongRope {
    freqs: Vec<f32>,
    scaling: f32,
}

impl LongRope {
    pub fn new(head_dim: usize, theta: f32, max_positions: usize, scaling: Option<&super::config::RopeScaling>) -> Self {
        let half = head_dim / 2;
        let original = scaling.map_or(max_positions, |s| s.original_max_position_embeddings);
        let use_long = max_positions.max(1) > original.max(1);
        let factors: Vec<f32> = scaling
            .map(|s| if use_long { s.long_factor.clone() } else { s.short_factor.clone() })
            .filter(|f| f.len() == half)
            .unwrap_or_else(|| vec![1.0; half]);
        let freqs = (0..half)
            .map(|i| {
                let inv = (-(i as f64 / half as f64) * f64::from(theta).ln()).exp();
                (inv / f64::from(factors[i])) as f32
            })
            .collect();
        let scale = max_positions.max(1) as f64 / original.max(1) as f64;
        let scaling = (1.0 + scale.max(1.0).ln() / (original.max(2) as f64).ln()).sqrt() as f32;
        Self { freqs, scaling }
    }

    /// 位置 `offset..offset+len` 的 `(cos, sin)`，形状 `[1, len, 1, head_dim]`。
    pub fn tables(&self, offset: usize, len: usize) -> (Array, Array) {
        let half = self.freqs.len();
        let dim = half * 2;
        let mut cos = Vec::with_capacity(len * dim);
        let mut sin = Vec::with_capacity(len * dim);
        for p in offset..offset + len {
            for _ in 0..2 {
                for &f in &self.freqs {
                    let angle = p as f32 * f;
                    cos.push(angle.cos() * self.scaling);
                    sin.push(angle.sin() * self.scaling);
                }
            }
        }
        let shape = [1, len as i32, 1, dim as i32];
        (Array::from_slice(&cos, &shape), Array::from_slice(&sin, &shape))
    }
}

/// `x * cos + rotate_half(x) * sin`，`x` 为 `[B, L, H, D]`（非 interleaved）。
fn apply_rope(x: &Array, cos: &Array, sin: &Array) -> Result<Array> {
    let d = x.dim(-1);
    let half = d / 2;
    let x1 = x.index((.., .., .., ..half));
    let x2 = x.index((.., .., .., half..));
    let rotated = ops::concatenate_axis(&[&x2.multiply(Array::from_f32(-1.0))?, &x1], -1)?;
    Ok(x.multiply(cos)?.add(&rotated.multiply(sin)?)?)
}

pub struct Dims {
    pub hidden: usize,
    pub heads: usize,
    pub kv_heads: usize,
    pub head_dim: usize,
    pub layers: usize,
    pub eps: f32,
    /// `use_mup` 时的残差缩放 `scale_depth / sqrt(layers)`，否则 1。
    pub residual_scale: f32,
}

struct Attention {
    heads: i32,
    kv_heads: i32,
    head_dim: i32,
    scale: f32,
    q_proj: Linear,
    k_proj: Linear,
    v_proj: Linear,
    o_proj: Linear,
}

impl Attention {
    fn load(weights: &mut Weights, prefix: &str, dims: &Dims, quant: (usize, u32)) -> Result<Self> {
        let (group, bits) = quant;
        Ok(Self {
            heads: dims.heads as i32,
            kv_heads: dims.kv_heads as i32,
            head_dim: dims.head_dim as i32,
            scale: (dims.head_dim as f32).sqrt().recip(),
            q_proj: Linear::load(weights, &format!("{prefix}.q_proj"), group, bits)?,
            k_proj: Linear::load(weights, &format!("{prefix}.k_proj"), group, bits)?,
            v_proj: Linear::load(weights, &format!("{prefix}.v_proj"), group, bits)?,
            o_proj: Linear::load(weights, &format!("{prefix}.o_proj"), group, bits)?,
        })
    }

    fn forward(&self, x: &Array, rope: Option<&(Array, Array)>, cache: Option<&KvCache>, causal: bool) -> Result<(Array, KvCache)> {
        let batch = x.dim(0);
        let len = x.dim(1);
        let mut q = self.q_proj.forward(x)?.reshape(&[batch, len, self.heads, self.head_dim])?;
        let mut k = self.k_proj.forward(x)?.reshape(&[batch, len, self.kv_heads, self.head_dim])?;
        let v = self
            .v_proj
            .forward(x)?
            .reshape(&[batch, len, self.kv_heads, self.head_dim])?
            .transpose_axes(&[0, 2, 1, 3])?;
        if let Some((cos, sin)) = rope {
            q = apply_rope(&q, cos, sin)?;
            k = apply_rope(&k, cos, sin)?;
        }
        let q = q.transpose_axes(&[0, 2, 1, 3])?;
        let k = k.transpose_axes(&[0, 2, 1, 3])?;
        let (keys, values) = match cache {
            Some(c) => (
                ops::concatenate_axis(&[&c.keys, &k], 2)?,
                ops::concatenate_axis(&[&c.values, &v], 2)?,
            ),
            None => (k, v),
        };
        // 单步解码（len == 1）看全部历史，不需要掩码；prefill 时 cache 为空。
        let mask = (causal && len > 1).then_some(ScaledDotProductAttentionMask::Causal);
        let out = fast::scaled_dot_product_attention(&q, &keys, &values, self.scale, mask, None)?
            .transpose_axes(&[0, 2, 1, 3])?
            .reshape(&[batch, len, self.heads * self.head_dim])?;
        Ok((self.o_proj.forward(&out)?, KvCache { keys, values }))
    }
}

struct Layer {
    attn: Attention,
    mlp: SwigluMlp,
    input_norm: Norm,
    post_norm: Norm,
}

/// MiniCPM 模型（无 lm_head）：`base_lm`、`residual_lm`、局部编码器与 DiT 的骨干。
pub struct MiniCpm {
    layers: Vec<Layer>,
    norm: Norm,
    rope: Option<LongRope>,
    residual_scale: f32,
}

impl MiniCpm {
    pub fn load(weights: &mut Weights, prefix: &str, dims: &Dims, rope: Option<LongRope>, quant: (usize, u32)) -> Result<Self> {
        let mut layers = Vec::with_capacity(dims.layers);
        for i in 0..dims.layers {
            let p = format!("{prefix}.layers.{i}");
            layers.push(Layer {
                attn: Attention::load(weights, &format!("{p}.self_attn"), dims, quant)?,
                mlp: SwigluMlp::load(weights, &format!("{p}.mlp"), quant.0, quant.1)?,
                input_norm: Norm::load(weights, &format!("{p}.input_layernorm"), dims.eps)?,
                post_norm: Norm::load(weights, &format!("{p}.post_attention_layernorm"), dims.eps)?,
            });
        }
        Ok(Self {
            layers,
            norm: Norm::load(weights, &format!("{prefix}.norm"), dims.eps)?,
            rope,
            residual_scale: dims.residual_scale,
        })
    }

    /// `x` `[B, L, H]` → 末层 norm 后的 `[B, L, H]` 与每层新 cache。
    pub fn forward(&self, x: &Array, cache: Option<&[KvCache]>, causal: bool) -> Result<(Array, Vec<KvCache>)> {
        let offset = cache.and_then(|c| c.first()).map_or(0, |c| c.len() as usize);
        let tables = self.rope.as_ref().map(|r| r.tables(offset, x.dim(1) as usize));
        let mut h = x.clone();
        let mut caches = Vec::with_capacity(self.layers.len());
        for (i, layer) in self.layers.iter().enumerate() {
            let normed = layer.input_norm.forward(&h)?;
            let (attn, new_cache) = layer.attn.forward(&normed, tables.as_ref(), cache.map(|c| &c[i]), causal)?;
            h = h.add(&self.scaled(attn)?)?;
            let mlp = layer.mlp.forward(&layer.post_norm.forward(&h)?)?;
            h = h.add(&self.scaled(mlp)?)?;
            caches.push(new_cache);
        }
        Ok((self.norm.forward(&h)?, caches))
    }

    fn scaled(&self, x: Array) -> Result<Array> {
        if self.residual_scale == 1.0 {
            Ok(x)
        } else {
            Ok(x.multiply(Array::from_f32(self.residual_scale))?)
        }
    }
}

/// `VoxCPMLocEnc`：每个 patch 前面拼一个可学习 CLS，非因果编码后取 CLS。
pub struct LocEnc {
    in_proj: Linear,
    special: Array,
    encoder: MiniCpm,
    hidden: i32,
}

impl LocEnc {
    pub fn load(weights: &mut Weights, dims: &Dims, rope: LongRope, quant: (usize, u32)) -> Result<Self> {
        Ok(Self {
            in_proj: Linear::load(weights, "feat_encoder.in_proj", quant.0, quant.1)?,
            special: take_f32(weights, "feat_encoder.special_token")?.reshape(&[1, 1, 1, dims.hidden as i32])?,
            encoder: MiniCpm::load(weights, "feat_encoder.encoder", dims, Some(rope), quant)?,
            hidden: dims.hidden as i32,
        })
    }

    /// `[B, T, P, D]` → `[B, T, hidden]`。
    pub fn forward(&self, x: &Array) -> Result<Array> {
        let (b, t, p) = (x.dim(0), x.dim(1), x.dim(2));
        let h = self.in_proj.forward(x)?;
        let special = ops::broadcast_to(&self.special, &[b, t, 1, self.hidden])?;
        let h = ops::concatenate_axis(&[&special, &h], 2)?.reshape(&[b * t, p + 1, self.hidden])?;
        let (out, _) = self.encoder.forward(&h, None, false)?;
        Ok(out.index((.., 0, ..)).reshape(&[b, t, self.hidden])?)
    }
}

/// `TimestepEmbedding`：`linear_2(silu(linear_1(x)))`。
struct TimeMlp {
    linear_1: Linear,
    linear_2: Linear,
}

impl TimeMlp {
    fn load(weights: &mut Weights, prefix: &str, quant: (usize, u32)) -> Result<Self> {
        Ok(Self {
            linear_1: Linear::load(weights, &format!("{prefix}.linear_1"), quant.0, quant.1)?,
            linear_2: Linear::load(weights, &format!("{prefix}.linear_2"), quant.0, quant.1)?,
        })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        self.linear_2.forward(&silu(self.linear_1.forward(x)?)?)
    }
}

/// `SinusoidalPosEmb(dim)(t, scale=1000)`：`[sin(1000·t·f), cos(1000·t·f)]`，
/// `f_i = exp(-i·ln(10000)/(half-1))`。主机侧算，返回 `[len(ts), dim]`。
pub fn sinusoidal(ts: &[f32], dim: usize) -> Array {
    let half = dim / 2;
    let step = (10000f64).ln() / (half as f64 - 1.0);
    let mut out = Vec::with_capacity(ts.len() * dim);
    for &t in ts {
        let angles: Vec<f32> = (0..half)
            .map(|i| (1000.0 * f64::from(t) * (-(i as f64) * step).exp()) as f32)
            .collect();
        out.extend(angles.iter().map(|a| a.sin()));
        out.extend(angles.iter().map(|a| a.cos()));
    }
    Array::from_slice(&out, &[ts.len() as i32, dim as i32])
}

/// `VoxCPMLocDiTV2`：`[mu tokens, 时间 token, cond patch, x patch]` 非因果编码后取 x 段。
pub struct LocDit {
    in_proj: Linear,
    cond_proj: Linear,
    out_proj: Linear,
    time_mlp: TimeMlp,
    decoder: MiniCpm,
    hidden: i32,
    /// `mean_mode=false` 时 dt 恒为 0，`delta_time_mlp(sinusoidal(0))` 是常量，加载时算好。
    delta_token: Array,
}

impl LocDit {
    pub fn load(weights: &mut Weights, dims: &Dims, rope: LongRope, quant: (usize, u32)) -> Result<Self> {
        let p = "feat_decoder.estimator";
        let delta = TimeMlp::load(weights, &format!("{p}.delta_time_mlp"), quant)?;
        let delta_token = delta.forward(&sinusoidal(&[0.0], dims.hidden))?;
        crate::synthesize::tensor::transforms::eval([&delta_token])?;
        Ok(Self {
            in_proj: Linear::load(weights, &format!("{p}.in_proj"), quant.0, quant.1)?,
            cond_proj: Linear::load(weights, &format!("{p}.cond_proj"), quant.0, quant.1)?,
            out_proj: Linear::load(weights, &format!("{p}.out_proj"), quant.0, quant.1)?,
            time_mlp: TimeMlp::load(weights, &format!("{p}.time_mlp"), quant)?,
            decoder: MiniCpm::load(weights, &format!("{p}.decoder"), dims, Some(rope), quant)?,
            hidden: dims.hidden as i32,
            delta_token,
        })
    }

    /// `x` `[B, C, P]`、`mu` `[B, k·hidden]`、`t` 每个 batch 同一时刻、`cond` `[B, C, Pc]`
    /// → 速度场 `[B, C, P]`。
    pub fn forward(&self, x: &Array, mu: &Array, t: f32, cond: &Array) -> Result<Array> {
        let b = x.dim(0);
        let x_proj = self.in_proj.forward(&x.transpose_axes(&[0, 2, 1])?)?;
        let cond_proj = self.cond_proj.forward(&cond.transpose_axes(&[0, 2, 1])?)?;
        let prefix = cond_proj.dim(1);
        let t_emb = self.time_mlp.forward(&sinusoidal(&[t], self.hidden as usize))?;
        let time_token = t_emb.add(&self.delta_token)?.reshape(&[1, 1, self.hidden])?;
        let time_token = ops::broadcast_to(&time_token, &[b, 1, self.hidden])?;
        let mu_tokens = mu.reshape(&[b, -1, self.hidden])?;
        let mu_len = mu_tokens.dim(1);
        let hidden = ops::concatenate_axis(&[&mu_tokens, &time_token, &cond_proj, &x_proj], 1)?;
        let (decoded, _) = self.decoder.forward(&hidden, None, false)?;
        let trimmed = decoded.index((.., (mu_len + 1 + prefix).., ..));
        Ok(self.out_proj.forward(&trimmed)?.transpose_axes(&[0, 2, 1])?)
    }
}

/// UnifiedCFM 的时间表：`t = linspace(1, 0, n+1)`，再做 sway 采样
/// `t + (cos(π/2·t) − 1 + t)`（系数 1.0）。
pub fn time_span(steps: usize) -> Vec<f32> {
    let steps = steps.max(1);
    (0..=steps)
        .map(|k| {
            let t = 1.0 - k as f64 / steps as f64;
            (t + ((std::f64::consts::FRAC_PI_2 * t).cos() - 1.0 + t)) as f32
        })
        .collect()
}

/// `UnifiedCFM.solveEuler`（CFG-Zero*）：前 `max(1, ⌊0.04·(n+1)⌋)` 步速度置零；其余步
/// 正负两路同批估计，`st* = <v+, v−>/(‖v−‖²+1e-8)`，`v = v−·st* + cfg·(v+ − v−·st*)`。
pub fn solve_euler(dit: &LocDit, noise: Array, mu: &Array, cond: &Array, steps: usize, cfg: f32) -> Result<Array> {
    let span = time_span(steps);
    let zero_init = ((span.len() as f64 * 0.04) as usize).max(1);
    let b = noise.dim(0);
    let mu_in = ops::concatenate_axis(&[mu, &ops::zeros_like(mu)?], 0)?;
    let cond_in = ops::concatenate_axis(&[cond, cond], 0)?;
    let mut x = noise;
    for step in 1..span.len() {
        let t = span[step - 1];
        let dt = span[step - 1] - span[step];
        if step <= zero_init {
            // 速度为零：x 不变，只推进时间。
            continue;
        }
        let x_in = ops::concatenate_axis(&[&x, &x], 0)?;
        let out = dit.forward(&x_in, &mu_in, t, &cond_in)?;
        let positive = out.index((..b, .., ..));
        let negative = out.index((b.., .., ..));
        let pos_flat = positive.reshape(&[b, -1])?;
        let neg_flat = negative.reshape(&[b, -1])?;
        let dot = pos_flat.multiply(&neg_flat)?.sum_axis(1, true)?.reshape(&[b, 1, 1])?;
        let norm = neg_flat
            .square()?
            .sum_axis(1, true)?
            .add(Array::from_f32(1e-8))?
            .reshape(&[b, 1, 1])?;
        let st = dot.divide(&norm)?;
        let base = negative.multiply(&st)?;
        let velocity = base.add(&positive.subtract(&base)?.multiply(Array::from_f32(cfg))?)?;
        x = x.subtract(&velocity.multiply(Array::from_f32(dt))?)?;
    }
    Ok(x)
}

/// 标量量化层：`out_proj(round(tanh(in_proj(x))·s)/s)`。
pub struct Fsq {
    in_proj: Linear,
    out_proj: Linear,
    scale: f32,
}

impl Fsq {
    pub fn load(weights: &mut Weights, scale: usize, quant: (usize, u32)) -> Result<Self> {
        Ok(Self {
            in_proj: Linear::load(weights, "fsq_layer.in_proj", quant.0, quant.1)?,
            out_proj: Linear::load(weights, "fsq_layer.out_proj", quant.0, quant.1)?,
            scale: scale as f32,
        })
    }

    pub fn forward(&self, x: &Array) -> Result<Array> {
        let h = ops::tanh(self.in_proj.forward(x)?)?.multiply(Array::from_f32(self.scale))?;
        let q = ops::round(&h, None)?.divide(Array::from_f32(self.scale))?;
        self.out_proj.forward(&q)
    }
}
