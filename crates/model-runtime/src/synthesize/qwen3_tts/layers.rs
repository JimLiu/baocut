//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/Qwen3TTS/Talker.swift / Sources/Qwen3TTS/CodePredictor.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Qwen3-TTS 共用层：线性 / 量化线性、RMSNorm、LayerNorm、Embedding、
//! GQA 注意力（RoPE + KV cache）、SwiGLU MLP 与因果卷积辅助。

use crate::synthesize::tensor::fast::{self, ScaledDotProductAttentionMask};
use crate::synthesize::tensor::nn::silu;
use crate::synthesize::tensor::ops;
use crate::synthesize::tensor::ops::indexing::IndexOp;
use crate::synthesize::tensor::{Array, Dtype};
use anyhow::{Result, bail};

use super::weights::Weights;

/// 普通或量化线性层，按是否存在 `{prefix}.scales` 自动选择（对应 `makeMaybeQuantizedLinear`
/// 加上 `applyQuantizedLinearWeights`）。
pub enum Linear {
    Float {
        weight: Array,
        bias: Option<Array>,
    },
    #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
    Quantized {
        weight: Array,
        scales: Array,
        biases: Array,
        bias: Option<Array>,
        group_size: i32,
        bits: i32,
    },
}

impl Linear {
    pub fn load(weights: &mut Weights, prefix: &str, group_size: usize, bits: u32) -> Result<Self> {
        let weight = weights.take(&format!("{prefix}.weight"))?;
        let bias = weights.take_optional(&format!("{prefix}.bias"));
        if let Some(scales) = weights.take_optional(&format!("{prefix}.scales")) {
            if bits == 0 {
                bail!("权重 {prefix} 带 scales 但配置未声明量化位数");
            }
            let biases = weights.take(&format!("{prefix}.biases"))?;
            #[cfg(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")))]
            {
                let weight = crate::synthesize::tensor::dequantize(&weight, &scales, &biases, group_size, bits)?;
                return Ok(Self::Float { weight, bias });
            }
            #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
            return Ok(Self::Quantized {
                weight,
                scales,
                biases,
                bias,
                group_size: group_size as i32,
                bits: bits as i32,
            });
        }
        if weight.dtype() == Dtype::Uint32 {
            bail!("权重 {prefix} 是 U32 但缺少 scales");
        }
        Ok(Self::Float { weight, bias })
    }

    pub fn forward(&self, input: &Array) -> Result<Array> {
        match self {
            Self::Float { weight, bias } => {
                let output = ops::matmul(input, weight.t())?;
                Ok(match bias {
                    Some(bias) => output.add(bias)?,
                    None => output,
                })
            }
            #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
            Self::Quantized {
                weight,
                scales,
                biases,
                bias,
                group_size,
                bits,
            } => {
                let output = ops::quantized_matmul(input, weight, scales, biases, true, *group_size, *bits)?;
                Ok(match bias {
                    Some(bias) => output.add(bias)?,
                    None => output,
                })
            }
        }
    }
}

pub struct RmsNorm {
    weight: Array,
    eps: f32,
}

impl RmsNorm {
    pub fn load(weights: &mut Weights, prefix: &str, eps: f32) -> Result<Self> {
        Ok(Self {
            weight: weights.take(&format!("{prefix}.weight"))?,
            eps,
        })
    }

    pub fn forward(&self, input: &Array) -> Result<Array> {
        Ok(fast::rms_norm(input, &self.weight, self.eps)?)
    }
}

pub struct LayerNorm {
    weight: Option<Array>,
    bias: Option<Array>,
    eps: f32,
}

impl LayerNorm {
    pub fn load(weights: &mut Weights, prefix: &str, eps: f32) -> Result<Self> {
        let weight = weights.take_optional(&format!("{prefix}.weight"));
        let bias = weights.take_optional(&format!("{prefix}.bias"));
        if weight.is_none() && bias.is_none() {
            bail!("缺少 LayerNorm 权重：{prefix}");
        }
        Ok(Self { weight, bias, eps })
    }

    pub fn forward(&self, input: &Array) -> Result<Array> {
        Ok(fast::layer_norm(input, self.weight.as_ref(), self.bias.as_ref(), self.eps)?)
    }
}

pub struct Embedding {
    weight: Array,
}

impl Embedding {
    pub fn load(weights: &mut Weights, prefix: &str) -> Result<Self> {
        Ok(Self {
            weight: weights.take(&format!("{prefix}.weight"))?,
        })
    }

    /// `ids` 形状 `[B, S]`（Int32）→ `[B, S, D]`。
    pub fn forward(&self, ids: &Array) -> Array {
        self.weight.index(ids)
    }
}

/// SwiGLU MLP：`down(silu(gate(x)) * up(x))`。
pub struct SwigluMlp {
    gate_proj: Linear,
    up_proj: Linear,
    down_proj: Linear,
}

impl SwigluMlp {
    pub fn load(weights: &mut Weights, prefix: &str, group_size: usize, bits: u32) -> Result<Self> {
        Ok(Self {
            gate_proj: Linear::load(weights, &format!("{prefix}.gate_proj"), group_size, bits)?,
            up_proj: Linear::load(weights, &format!("{prefix}.up_proj"), group_size, bits)?,
            down_proj: Linear::load(weights, &format!("{prefix}.down_proj"), group_size, bits)?,
        })
    }

    pub fn forward(&self, x: &Array) -> Result<Array> {
        let gate = silu(self.gate_proj.forward(x)?)?;
        let up = self.up_proj.forward(x)?;
        self.down_proj.forward(&gate.multiply(&up)?)
    }
}

/// 单层的 KV cache：`[B, KV, T, D]`。
#[derive(Clone)]
pub struct KvCache {
    pub keys: Array,
    pub values: Array,
}

impl KvCache {
    pub fn len(&self) -> i32 {
        self.keys.dim(2)
    }
}

/// Qwen3 风格 GQA 注意力：q/k RMSNorm → RoPE（非 traditional）→ KV cache 拼接 → SDPA。
pub struct Attention {
    num_heads: i32,
    num_kv_heads: i32,
    head_dim: i32,
    rope_theta: f32,
    scale: f32,
    q_proj: Linear,
    k_proj: Linear,
    v_proj: Linear,
    o_proj: Linear,
    q_norm: RmsNorm,
    k_norm: RmsNorm,
}

pub struct AttentionDims {
    pub num_heads: usize,
    pub num_kv_heads: usize,
    pub head_dim: usize,
    pub rope_theta: f32,
    pub rms_norm_eps: f32,
}

impl Attention {
    pub fn load(weights: &mut Weights, prefix: &str, dims: &AttentionDims, group_size: usize, bits: u32) -> Result<Self> {
        Ok(Self {
            num_heads: dims.num_heads as i32,
            num_kv_heads: dims.num_kv_heads as i32,
            head_dim: dims.head_dim as i32,
            rope_theta: dims.rope_theta,
            scale: (dims.head_dim as f32).sqrt().recip(),
            q_proj: Linear::load(weights, &format!("{prefix}.q_proj"), group_size, bits)?,
            k_proj: Linear::load(weights, &format!("{prefix}.k_proj"), group_size, bits)?,
            v_proj: Linear::load(weights, &format!("{prefix}.v_proj"), group_size, bits)?,
            o_proj: Linear::load(weights, &format!("{prefix}.o_proj"), group_size, bits)?,
            q_norm: RmsNorm::load(weights, &format!("{prefix}.q_norm"), dims.rms_norm_eps)?,
            k_norm: RmsNorm::load(weights, &format!("{prefix}.k_norm"), dims.rms_norm_eps)?,
        })
    }

    /// `offset` 是 RoPE 位置偏移；`mask` 为显式加性掩码（`[1,1,S,T]`），为空时
    /// S>1 用因果掩码、S==1 不用掩码（等价于手工构造的 `-1e9` 掩码）。
    pub fn forward(&self, hidden: &Array, offset: i32, mask: Option<&Array>, cache: Option<&KvCache>) -> Result<(Array, KvCache)> {
        let batch = hidden.dim(0);
        let seq_len = hidden.dim(1);
        let queries = self
            .q_proj
            .forward(hidden)?
            .reshape(&[batch, seq_len, self.num_heads, self.head_dim])?;
        let keys = self
            .k_proj
            .forward(hidden)?
            .reshape(&[batch, seq_len, self.num_kv_heads, self.head_dim])?;
        let values = self
            .v_proj
            .forward(hidden)?
            .reshape(&[batch, seq_len, self.num_kv_heads, self.head_dim])?
            .transpose_axes(&[0, 2, 1, 3])?;
        let queries = self.q_norm.forward(&queries)?.transpose_axes(&[0, 2, 1, 3])?;
        let keys = self.k_norm.forward(&keys)?.transpose_axes(&[0, 2, 1, 3])?;
        let queries = fast::rope(&queries, self.head_dim, false, self.rope_theta, 1.0, offset, None)?;
        let keys = fast::rope(&keys, self.head_dim, false, self.rope_theta, 1.0, offset, None)?;
        let (cached_keys, cached_values) = match cache {
            Some(cache) => (
                ops::concatenate_axis(&[&cache.keys, &keys], 2)?,
                ops::concatenate_axis(&[&cache.values, &values], 2)?,
            ),
            None => (keys, values),
        };
        let mask_mode = match mask {
            Some(mask) => Some(ScaledDotProductAttentionMask::Array(mask)),
            None if seq_len > 1 => Some(ScaledDotProductAttentionMask::Causal),
            None => None,
        };
        let attended = fast::scaled_dot_product_attention(&queries, &cached_keys, &cached_values, self.scale, mask_mode, None)?;
        let merged = attended
            .transpose_axes(&[0, 2, 1, 3])?
            .reshape(&[batch, seq_len, self.num_heads * self.head_dim])?;
        Ok((
            self.o_proj.forward(&merged)?,
            KvCache {
                keys: cached_keys,
                values: cached_values,
            },
        ))
    }
}

/// Qwen3 pre-norm 解码层（Talker 与 Code Predictor 共用结构）。
pub struct DecoderLayer {
    self_attn: Attention,
    mlp: SwigluMlp,
    input_layernorm: RmsNorm,
    post_attention_layernorm: RmsNorm,
}

impl DecoderLayer {
    pub fn load(weights: &mut Weights, prefix: &str, dims: &AttentionDims, group_size: usize, bits: u32) -> Result<Self> {
        Ok(Self {
            self_attn: Attention::load(weights, &format!("{prefix}.self_attn"), dims, group_size, bits)?,
            mlp: SwigluMlp::load(weights, &format!("{prefix}.mlp"), group_size, bits)?,
            input_layernorm: RmsNorm::load(weights, &format!("{prefix}.input_layernorm"), dims.rms_norm_eps)?,
            post_attention_layernorm: RmsNorm::load(weights, &format!("{prefix}.post_attention_layernorm"), dims.rms_norm_eps)?,
        })
    }

    pub fn forward(&self, hidden: &Array, offset: i32, mask: Option<&Array>, cache: Option<&KvCache>) -> Result<(Array, KvCache)> {
        let normed = self.input_layernorm.forward(hidden)?;
        let (attn, new_cache) = self.self_attn.forward(&normed, offset, mask, cache)?;
        let hidden = hidden.add(&attn)?;
        let normed = self.post_attention_layernorm.forward(&hidden)?;
        let mlp = self.mlp.forward(&normed)?;
        Ok((hidden.add(&mlp)?, new_cache))
    }
}

/// 因果 Conv1d（左侧补 `(k-1)*dilation`），输入 `[B, T, C]`，权重 MLX 布局 `[out, k, in]`。
pub struct CausalConv1d {
    weight: Array,
    bias: Option<Array>,
    stride: i32,
    dilation: i32,
    groups: i32,
}

impl CausalConv1d {
    pub fn new(weight: Array, bias: Option<Array>, stride: i32, dilation: i32, groups: i32) -> Self {
        Self {
            weight,
            bias,
            stride,
            dilation,
            groups,
        }
    }

    pub fn kernel_size(&self) -> i32 {
        self.weight.dim(1)
    }

    /// 左侧补 `(k-1)*dilation` 个零的因果卷积。
    pub fn forward(&self, x: &Array) -> Result<Array> {
        let pad_total = (self.kernel_size() - 1) * self.dilation;
        if pad_total == 0 {
            return self.forward_padded(x);
        }
        let padded = ops::pad(x, &[(0, 0), (pad_total, 0), (0, 0)], Array::from_f32(0.0), None)?;
        self.forward_padded(&padded)
    }

    /// 不补零，直接卷积（输入已由调用方补好）。
    pub fn forward_padded(&self, x: &Array) -> Result<Array> {
        let out = ops::conv1d(x, &self.weight, self.stride, 0, self.dilation, self.groups)?;
        Ok(match &self.bias {
            Some(bias) => out.add(bias)?,
            None => out,
        })
    }
}

/// 因果 ConvTranspose1d：全量转置卷积后裁掉右侧 `k - stride` 个样本。
pub struct CausalConvTranspose1d {
    weight: Array,
    bias: Option<Array>,
    stride: i32,
}

impl CausalConvTranspose1d {
    pub fn new(weight: Array, bias: Option<Array>, stride: i32) -> Self {
        Self { weight, bias, stride }
    }

    pub fn forward(&self, x: &Array) -> Result<Array> {
        let kernel = self.weight.dim(1);
        let out = ops::conv_transpose1d(x, &self.weight, self.stride, 0, 1, 0, 1)?;
        let out = match &self.bias {
            Some(bias) => out.add(bias)?,
            None => out,
        };
        let trim = kernel - self.stride;
        if trim > 0 {
            let length = out.dim(1);
            Ok(out.index((.., ..(length - trim), ..)))
        } else {
            Ok(out)
        }
    }
}

/// 把 host 侧 i32 序列变成 `[1, S]` Int32 数组。
pub fn token_array(tokens: &[i32]) -> Array {
    Array::from_slice(tokens, &[1, tokens.len() as i32])
}
