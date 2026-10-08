//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/Qwen3ASR/QuantizedTextDecoder.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Qwen3 的基础层：稠密与量化投影、LayerNorm、RMSNorm、词嵌入与保持 dtype 的 GELU。

use super::WeightStore;
use anyhow::{Result, bail};
use mlx_rs::Array;
use mlx_rs::fast;
use mlx_rs::ops;
use mlx_rs::ops::indexing::IndexOp;

/// 保持输入 dtype 的精确 GELU：`x * (1 + erf(x / √2)) / 2`。
///
/// `mlx_rs::nn::gelu` 的常量是 f32 数组，会把 bf16 激活提升成 f32，
/// 并顺着音频编码器污染整个解码图（KV cache、逐 token 生成全部变成
/// f32，权重每步被动上转换，实测生成速度掉到 1/4）。这里把常量显式
/// 转成输入 dtype，与 mlx-swift 标量语义对齐。
pub fn gelu_same_dtype(x: &Array) -> Result<Array> {
    let dtype = x.dtype();
    let sqrt_two = Array::from_f32(std::f32::consts::SQRT_2).as_dtype(dtype)?;
    let one = Array::from_f32(1.0).as_dtype(dtype)?;
    let two = Array::from_f32(2.0).as_dtype(dtype)?;
    let erf = ops::erf(&x.divide(&sqrt_two)?)?;
    Ok(x.multiply(one.add(&erf)?)?.divide(&two)?)
}

pub struct Dense {
    weight: Array,
    bias: Option<Array>,
}

impl Dense {
    pub fn load(store: &mut WeightStore, prefix: &str) -> Result<Self> {
        Ok(Self {
            weight: store.take(&format!("{prefix}.weight"))?,
            bias: store.take_optional(&format!("{prefix}.bias")),
        })
    }

    pub fn forward(&self, input: &Array) -> Result<Array> {
        let output = ops::matmul(input, self.weight.t())?;
        Ok(match &self.bias {
            Some(bias) => &output + bias,
            None => output,
        })
    }
}

pub struct QuantizedDense {
    weight: Array,
    scales: Array,
    biases: Array,
    bias: Option<Array>,
    group_size: i32,
    bits: i32,
}

impl QuantizedDense {
    pub fn load(store: &mut WeightStore, prefix: &str, group_size: i32, bits: i32) -> Result<Self> {
        Ok(Self {
            weight: store.take(&format!("{prefix}.weight"))?,
            scales: store.take(&format!("{prefix}.scales"))?,
            biases: store.take(&format!("{prefix}.biases"))?,
            bias: store.take_optional(&format!("{prefix}.bias")),
            group_size,
            bits,
        })
    }

    pub fn forward(&self, input: &Array) -> Result<Array> {
        let output = ops::quantized_matmul(input, &self.weight, &self.scales, &self.biases, true, self.group_size, self.bits)?;
        Ok(match &self.bias {
            Some(bias) => &output + bias,
            None => output,
        })
    }
}

pub enum Projection {
    Float(Dense),
    Quantized(QuantizedDense),
}

impl Projection {
    pub fn load(store: &mut WeightStore, prefix: &str, group_size: i32, bits: i32) -> Result<Self> {
        if store.contains(&format!("{prefix}.scales")) {
            // 预量化的权重要配置里声明位数（`quantization.bits`）；没声明时按 16 位去解包只会算出乱码。
            if !matches!(bits, 4 | 8) {
                bail!("权重 {prefix} 带 scales 但配置未声明 4 或 8 位量化（bits = {bits}）");
            }
            Ok(Self::Quantized(QuantizedDense::load(store, prefix, group_size, bits)?))
        } else if matches!(bits, 4 | 8) {
            let weight = store.take(&format!("{prefix}.weight"))?;
            let bias = store.take_optional(&format!("{prefix}.bias"));
            let (weight, scales, biases) = ops::quantize(&weight, group_size, bits)?;
            Ok(Self::Quantized(QuantizedDense {
                weight,
                scales,
                biases,
                bias,
                group_size,
                bits,
            }))
        } else {
            Ok(Self::Float(Dense::load(store, prefix)?))
        }
    }

    pub fn forward(&self, input: &Array) -> Result<Array> {
        match self {
            Self::Float(layer) => layer.forward(input),
            Self::Quantized(layer) => layer.forward(input),
        }
    }

    pub(crate) fn append_quantized_arrays<'a>(&'a self, arrays: &mut Vec<&'a Array>) {
        if let Self::Quantized(layer) = self {
            arrays.extend([&layer.weight, &layer.scales, &layer.biases]);
        }
    }
}

pub struct LayerNorm {
    weight: Option<Array>,
    bias: Option<Array>,
    eps: f32,
}

impl LayerNorm {
    pub fn load(store: &mut WeightStore, prefix: &str, eps: f32) -> Result<Self> {
        let weight = store.take_optional(&format!("{prefix}.weight"));
        let bias = store.take_optional(&format!("{prefix}.bias"));
        if weight.is_none() && bias.is_none() {
            bail!("missing LayerNorm weights: {prefix}");
        }
        Ok(Self { weight, bias, eps })
    }

    pub fn forward(&self, input: &Array) -> Result<Array> {
        Ok(fast::layer_norm(input, self.weight.as_ref(), self.bias.as_ref(), self.eps)?)
    }
}

pub struct RmsNorm {
    weight: Array,
    eps: f32,
}

impl RmsNorm {
    pub fn load(store: &mut WeightStore, prefix: &str, eps: f32) -> Result<Self> {
        Ok(Self {
            weight: store.take(&format!("{prefix}.weight"))?,
            eps,
        })
    }

    pub fn forward(&self, input: &Array) -> Result<Array> {
        Ok(fast::rms_norm(input, &self.weight, self.eps)?)
    }
}

pub enum TokenEmbedding {
    Float {
        weight: Array,
    },
    Quantized {
        weight: Array,
        scales: Array,
        biases: Array,
        group_size: i32,
        bits: i32,
    },
}

impl TokenEmbedding {
    pub fn load(store: &mut WeightStore, prefix: &str, group_size: i32, bits: i32) -> Result<Self> {
        let weight = store.take(&format!("{prefix}.weight"))?;
        if store.contains(&format!("{prefix}.scales")) {
            Ok(Self::Quantized {
                weight,
                scales: store.take(&format!("{prefix}.scales"))?,
                biases: store.take(&format!("{prefix}.biases"))?,
                group_size,
                bits,
            })
        } else if matches!(bits, 4 | 8) {
            let (weight, scales, biases) = ops::quantize(&weight, group_size, bits)?;
            Ok(Self::Quantized {
                weight,
                scales,
                biases,
                group_size,
                bits,
            })
        } else {
            Ok(Self::Float { weight })
        }
    }

    pub fn forward(&self, input_ids: &Array) -> Result<Array> {
        match self {
            Self::Float { weight } => Ok(weight.index(input_ids)),
            Self::Quantized {
                weight,
                scales,
                biases,
                group_size,
                bits,
            } => {
                let shape = input_ids.shape();
                let flattened = input_ids.flatten(None, None)?;
                let output = ops::dequantize(
                    weight.index(&flattened),
                    scales.index(&flattened),
                    &biases.index(&flattened),
                    *group_size,
                    *bits,
                )?;
                let mut output_shape = shape.to_vec();
                output_shape.push(-1);
                Ok(output.reshape(&output_shape)?)
            }
        }
    }

    pub fn as_linear(&self, input: &Array) -> Result<Array> {
        match self {
            Self::Float { weight } => Ok(ops::matmul(input, weight.t())?),
            Self::Quantized {
                weight,
                scales,
                biases,
                group_size,
                bits,
            } => Ok(ops::quantized_matmul(input, weight, scales, biases, true, *group_size, *bits)?),
        }
    }

    pub(crate) fn append_quantized_arrays<'a>(&'a self, arrays: &mut Vec<&'a Array>) {
        if let Self::Quantized {
            weight, scales, biases, ..
        } = self
        {
            arrays.extend([weight, scales, biases]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::mlx::runtime::MLX_TEST_LOCK;
    use std::collections::HashMap;

    #[test]
    fn pre_quantized_weights_need_declared_bits() {
        let _lock = MLX_TEST_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
        let store = || {
            let value = Array::from_slice(&[0_u32; 8], &[1, 8]);
            let scale = Array::from_slice(&[1.0_f32], &[1, 1]);
            WeightStore::from_arrays(HashMap::from([
                ("p.weight".to_owned(), value),
                ("p.scales".to_owned(), scale.clone()),
                ("p.biases".to_owned(), scale),
            ]))
            .unwrap()
        };
        let error = Projection::load(&mut store(), "p", 64, 16)
            .err()
            .expect("16-bit config with scales");
        assert!(error.to_string().contains("scales"), "{error}");
        assert!(matches!(Projection::load(&mut store(), "p", 64, 4), Ok(Projection::Quantized(_))));
    }
}
