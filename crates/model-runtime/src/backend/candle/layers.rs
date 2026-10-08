//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/Qwen3ASR/QuantizedTextDecoder.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! candle 后端的基础层，镜像 mlx 后端 `qwen3/layers.rs` 的数值语义。
//!
//! 计算精度由 `WeightStore::compute_dtype` 决定：CPU 上恒为 f32，CUDA 上沿用
//! checkpoint 自身的半精度（bf16/f16）。需要稳定累加的归约（LayerNorm 的均值
//! 与方差、softmax、RmsNorm）仍在 f32 上完成。

use super::weights::WeightStore;
use anyhow::{Result, anyhow, bail};
use candle_core::{D, DType, Device, Tensor};
use std::sync::Mutex;

/// RoPE cos/sin 表的扩容步长；按需增长，避免解码期反复重建。
const ROPE_TABLE_STEP: usize = 1_024;

/// 精确 GELU：`x * (1 + erf(x / √2)) / 2`，与 mlx 侧 `gelu_same_dtype` 一致。
pub fn gelu(x: &Tensor) -> Result<Tensor> {
    Ok(x.gelu_erf()?)
}

pub struct Dense {
    /// 只保存 [in, out] 一份布局：这是 gemm 直接可用的形状，既不需要像原来那样
    /// 额外保留一份 [out, in]（大投影层是数 GB 的差别），也避免解码期用转置视图
    /// 触发 cuBLAS 的低效 `OP_T` GEMV 路径。
    weight_t: Tensor,
    bias: Option<Tensor>,
}

impl Dense {
    pub fn load(store: &mut WeightStore, prefix: &str) -> Result<Self> {
        let weight = store.take_compute(&format!("{prefix}.weight"))?;
        let bias = store.take_optional_compute(&format!("{prefix}.bias"))?;
        Self::from_weight(weight, bias)
    }

    /// checkpoint 带 `scales` 时反量化加载（对应 mlx 的 `Projection`）。
    pub fn load_dequantized(store: &mut WeightStore, prefix: &str, group_size: usize, bits: usize) -> Result<Self> {
        let weight = store.take_dequantized(prefix, group_size, bits)?;
        let bias = store.take_optional_compute(&format!("{prefix}.bias"))?;
        Self::from_weight(weight, bias)
    }

    /// `weight` 为 checkpoint 的 [out, in]；转置后原张量立即释放。
    pub fn from_weight(weight: Tensor, bias: Option<Tensor>) -> Result<Self> {
        let weight_t = weight.t()?.contiguous()?;
        drop(weight);
        Ok(Self { weight_t, bias })
    }

    pub fn device(&self) -> &Device {
        self.weight_t.device()
    }

    pub fn dtype(&self) -> DType {
        self.weight_t.dtype()
    }

    pub fn forward(&self, input: &Tensor) -> Result<Tensor> {
        let output = input.broadcast_matmul(&self.weight_t)?;
        Ok(match &self.bias {
            Some(bias) => output.broadcast_add(bias)?,
            None => output,
        })
    }
}

pub struct LayerNorm {
    weight: Option<Tensor>,
    bias: Option<Tensor>,
    eps: f64,
}

impl LayerNorm {
    pub fn load(store: &mut WeightStore, prefix: &str, eps: f32) -> Result<Self> {
        // 归一化参数很小，恒定保存为 f32：forward 也在 f32 上累加均值/方差。
        let weight = store.take_optional_f32(&format!("{prefix}.weight"))?;
        let bias = store.take_optional_f32(&format!("{prefix}.bias"))?;
        if weight.is_none() && bias.is_none() {
            bail!("missing LayerNorm weights: {prefix}");
        }
        Ok(Self {
            weight,
            bias,
            eps: eps as f64,
        })
    }

    pub fn forward(&self, input: &Tensor) -> Result<Tensor> {
        let dtype = input.dtype();
        let working = if dtype == DType::F32 {
            input.clone()
        } else {
            input.to_dtype(DType::F32)?
        };
        let mean = working.mean_keepdim(D::Minus1)?;
        let centered = working.broadcast_sub(&mean)?;
        let variance = centered.sqr()?.mean_keepdim(D::Minus1)?;
        let mut output = centered.broadcast_div(&(variance + self.eps)?.sqrt()?)?;
        if let Some(weight) = &self.weight {
            output = output.broadcast_mul(weight)?;
        }
        if let Some(bias) = &self.bias {
            output = output.broadcast_add(bias)?;
        }
        Ok(if dtype == DType::F32 { output } else { output.to_dtype(dtype)? })
    }
}

pub struct RmsNorm {
    weight: Tensor,
    eps: f32,
}

impl RmsNorm {
    pub fn load(store: &mut WeightStore, prefix: &str, eps: f32) -> Result<Self> {
        Ok(Self {
            // candle 的 rms_norm 内部按 f32 累加，权重与输入同精度即可。
            weight: store.take_compute(&format!("{prefix}.weight"))?,
            eps,
        })
    }

    pub fn forward(&self, input: &Tensor) -> Result<Tensor> {
        Ok(candle_nn::ops::rms_norm(&input.contiguous()?, &self.weight, self.eps)?)
    }
}

pub struct TokenEmbedding {
    /// 同样只保存 [hidden, vocab] 一份：tied 输出层是每步都跑的热路径，需要这个
    /// 布局；查表则改成沿 vocab 维 `index_select` 再转置，代价只有取到的那几行。
    weight_t: Tensor,
}

impl TokenEmbedding {
    pub fn load(store: &mut WeightStore, prefix: &str, group_size: usize, bits: usize) -> Result<Self> {
        let weight = store.take_dequantized(prefix, group_size, bits)?;
        let weight_t = weight.t()?.contiguous()?;
        drop(weight);
        Ok(Self { weight_t })
    }

    /// `ids` 为 u32 [batch, sequence]。
    pub fn forward(&self, ids: &Tensor) -> Result<Tensor> {
        let (batch, sequence) = ids.dims2()?;
        let flat = ids.flatten_all()?;
        let columns = self.weight_t.index_select(&flat, 1)?;
        Ok(columns.t()?.contiguous()?.reshape((batch, sequence, ()))?)
    }

    /// tied embedding 作为输出层：`hidden × Wᵀ`。
    pub fn as_linear(&self, hidden: &Tensor) -> Result<Tensor> {
        Ok(hidden.broadcast_matmul(&self.weight_t)?)
    }
}

/// 标准 SDPA：`softmax(q·kᵀ·scale + mask)·v`。支持 GQA（kv 头数少于 q 头数
/// 时把重复的 q 头折进序列维，而不是把 kv 物化成 q 头数）。所有输入为
/// [batch, heads, sequence, head_dim]，且必须是 gemm 可直接消费的布局
/// （连续张量，或 KV cache 的 `narrow` 视图）。
pub fn scaled_dot_product_attention(query: &Tensor, key: &Tensor, value: &Tensor, scale: f64, mask: Option<&Tensor>) -> Result<Tensor> {
    let (batch, heads, sequence, head_dim) = query.dims4()?;
    let kv_heads = key.dim(1)?;
    if kv_heads == 0 || !heads.is_multiple_of(kv_heads) {
        bail!("GQA head count mismatch: {heads} vs {kv_heads}");
    }
    let repeats = heads / kv_heads;
    let grouped_query = if repeats == 1 {
        query.clone()
    } else {
        // [b, kv*rep, seq, d] 的内存顺序就是 [b, kv, rep, seq, d]，
        // 因此这个 reshape 是零拷贝，且与逐组复制 kv 完全等价。
        query.reshape((batch, kv_heads, repeats * sequence, head_dim))?
    };
    let scores = (grouped_query.matmul(&key.transpose(2, 3)?)? * scale)?;
    let total = scores.dim(D::Minus1)?;
    let scores = match mask {
        Some(mask) => {
            let per_head = if repeats == 1 {
                scores
            } else {
                scores.reshape((batch, heads, sequence, total))?
            };
            let masked = per_head.broadcast_add(mask)?;
            if repeats == 1 {
                masked
            } else {
                masked.reshape((batch, kv_heads, repeats * sequence, total))?
            }
        }
        None => scores,
    };
    let probabilities = candle_nn::ops::softmax_last_dim(&scores)?;
    let attended = probabilities.matmul(value)?;
    Ok(if repeats == 1 {
        attended
    } else {
        attended.reshape((batch, heads, sequence, head_dim))?
    })
}

/// 半分裂 RoPE（llama 风格），与 mlx `fast::rope(traditional=false)` 一致。
/// `x` 为 [batch, heads, sequence, head_dim]，`offset` 是 KV cache 长度。
pub fn rope(x: &Tensor, theta: f32, offset: usize) -> Result<Tensor> {
    let (_batch, _heads, sequence, head_dim) = x.dims4()?;
    let (cos, sin) = rope_tables(theta, head_dim, offset, sequence, x.dtype(), x.device())?;
    Ok(candle_nn::rotary_emb::rope(&x.contiguous()?, &cos, &sin)?)
}

/// 常驻设备的 RoPE cos/sin 表。自回归解码时每步只做一次 `narrow`，
/// 取代原来的「host 重建 + 上传」。
pub struct RopeCache {
    theta: f32,
    head_dim: usize,
    dtype: DType,
    device: Device,
    tables: Mutex<Option<RopeTables>>,
}

struct RopeTables {
    length: usize,
    cos: Tensor,
    sin: Tensor,
}

impl RopeCache {
    pub fn new(theta: f32, head_dim: usize, dtype: DType, device: &Device) -> Self {
        Self {
            theta,
            head_dim,
            dtype,
            device: device.clone(),
            tables: Mutex::new(None),
        }
    }

    pub fn apply(&self, x: &Tensor, offset: usize) -> Result<Tensor> {
        let (_batch, _heads, sequence, head_dim) = x.dims4()?;
        if head_dim != self.head_dim || x.dtype() != self.dtype {
            return rope(x, self.theta, offset);
        }
        let required = offset + sequence;
        let mut guard = self.tables.lock().map_err(|_| anyhow!("the RoPE table lock is poisoned"))?;
        if guard.as_ref().is_none_or(|tables| tables.length < required) {
            let length = required.next_multiple_of(ROPE_TABLE_STEP).max(ROPE_TABLE_STEP);
            let (cos, sin) = rope_tables(self.theta, self.head_dim, 0, length, self.dtype, &self.device)?;
            *guard = Some(RopeTables { length, cos, sin });
        }
        let tables = guard.as_ref().expect("the RoPE tables are initialized");
        let cos = tables.cos.narrow(0, offset, sequence)?;
        let sin = tables.sin.narrow(0, offset, sequence)?;
        drop(guard);
        Ok(candle_nn::rotary_emb::rope(&x.contiguous()?, &cos, &sin)?)
    }
}

fn rope_tables(theta: f32, head_dim: usize, offset: usize, length: usize, dtype: DType, device: &Device) -> Result<(Tensor, Tensor)> {
    let half = head_dim / 2;
    let mut cos = Vec::with_capacity(length * half);
    let mut sin = Vec::with_capacity(length * half);
    for position in offset..offset + length {
        for index in 0..half {
            let frequency = (position as f64) * (theta as f64).powf(-2.0 * index as f64 / head_dim as f64);
            cos.push(frequency.cos() as f32);
            sin.push(frequency.sin() as f32);
        }
    }
    let cos = Tensor::from_vec(cos, (length, half), device)?.to_dtype(dtype)?;
    let sin = Tensor::from_vec(sin, (length, half), device)?.to_dtype(dtype)?;
    Ok((cos, sin))
}

/// 注意力掩码使用的负偏置。必须落在目标精度的可表示范围内：f16 下 `-1e9`
/// 会溢出成 `-inf`，再与「未屏蔽」位置的 0 相乘就会产生 NaN，整层输出报废。
pub fn mask_bias(dtype: DType) -> f64 {
    match dtype {
        DType::F16 => -6.0e4,
        _ => -1e9,
    }
}

/// 因果注意力掩码：允许看见全部 cache 与自身及之前的 token。
/// 直接在设备上用 arange 比较生成，避免 prefill 时在 host 上铺 O(seq×total)。
pub fn causal_mask(sequence: usize, cache_length: usize, device: &Device, dtype: DType) -> Result<Tensor> {
    let total = sequence + cache_length;
    let rows = Tensor::arange(cache_length as u32, (cache_length + sequence) as u32, device)?.reshape((sequence, 1))?;
    let columns = Tensor::arange(0_u32, total as u32, device)?.reshape((1, total))?;
    let blocked = columns.broadcast_gt(&rows)?;
    Ok(blocked
        .to_dtype(DType::F32)?
        .affine(mask_bias(dtype), 0.0)?
        .to_dtype(dtype)?
        .reshape((1, 1, sequence, total))?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use candle_core::IndexOp;

    /// GQA 现在把重复的 q 头折进序列维；结果必须与「逐组复制 kv」的朴素实现一致。
    #[test]
    fn grouped_query_attention_matches_repeated_kv() {
        let device = Device::Cpu;
        let (batch, heads, kv_heads, sequence, total, width) = (1, 4, 2, 3, 5, 8);
        let query = Tensor::arange(0.0_f32, (heads * sequence * width) as f32, &device)
            .unwrap()
            .affine(0.01, -0.3)
            .unwrap()
            .reshape((batch, heads, sequence, width))
            .unwrap();
        let key = Tensor::arange(0.0_f32, (kv_heads * total * width) as f32, &device)
            .unwrap()
            .affine(0.013, -0.2)
            .unwrap()
            .reshape((batch, kv_heads, total, width))
            .unwrap();
        let value = Tensor::arange(0.0_f32, (kv_heads * total * width) as f32, &device)
            .unwrap()
            .affine(-0.017, 0.4)
            .unwrap()
            .reshape((batch, kv_heads, total, width))
            .unwrap();
        let mask = causal_mask(sequence, total - sequence, &device, DType::F32).unwrap();

        let repeats = heads / kv_heads;
        let repeated = |tensor: &Tensor| {
            tensor
                .unsqueeze(2)
                .unwrap()
                .expand((batch, kv_heads, repeats, total, width))
                .unwrap()
                .reshape((batch, heads, total, width))
                .unwrap()
        };
        let scores = (query.matmul(&repeated(&key).transpose(2, 3).unwrap()).unwrap() * 0.35)
            .unwrap()
            .broadcast_add(&mask)
            .unwrap();
        let expected = candle_nn::ops::softmax_last_dim(&scores)
            .unwrap()
            .matmul(&repeated(&value))
            .unwrap();

        let actual = scaled_dot_product_attention(&query, &key, &value, 0.35, Some(&mask)).unwrap();
        assert_eq!(actual.dims(), expected.dims());
        let actual = actual.flatten_all().unwrap().to_vec1::<f32>().unwrap();
        let expected = expected.flatten_all().unwrap().to_vec1::<f32>().unwrap();
        for (left, right) in actual.iter().zip(expected.iter()) {
            assert!((left - right).abs() < 1e-5, "{left} vs {right}");
        }
    }

    /// 缓存表跨越扩容边界后，切片结果仍要与逐次重建的 rope 完全一致。
    #[test]
    fn rope_cache_matches_uncached_rope_across_growth() {
        let device = Device::Cpu;
        let cache = RopeCache::new(1_000_000.0, 8, DType::F32, &device);
        for offset in [0_usize, 7, ROPE_TABLE_STEP - 1, ROPE_TABLE_STEP + 5] {
            let input = Tensor::arange(0.0_f32, 16.0, &device).unwrap().reshape((1, 2, 1, 8)).unwrap();
            let cached = cache.apply(&input, offset).unwrap();
            let direct = rope(&input, 1_000_000.0, offset).unwrap();
            let cached = cached.flatten_all().unwrap().to_vec1::<f32>().unwrap();
            let direct = direct.flatten_all().unwrap().to_vec1::<f32>().unwrap();
            assert_eq!(cached, direct, "offset={offset}");
        }
    }

    /// 掩码偏置必须在目标精度下保持有限，否则未屏蔽位置会出现 0 × -inf = NaN。
    #[test]
    fn causal_mask_stays_finite_in_every_dtype() {
        let device = Device::Cpu;
        for dtype in [DType::F32, DType::BF16, DType::F16] {
            let mask = causal_mask(2, 1, &device, dtype).unwrap();
            assert_eq!(mask.dims(), &[1, 1, 2, 3]);
            let values = mask.to_dtype(DType::F32).unwrap().flatten_all().unwrap().to_vec1::<f32>().unwrap();
            assert!(
                values.iter().all(|value| value.is_finite()),
                "{dtype:?} mask has non-finite values: {values:?}"
            );
            // 行 0 只能看到 cache 与自身，行 1 可以多看一格。
            assert_eq!(values[1], 0.0);
            assert!(values[2] < -1.0e3);
            assert_eq!(values[5], 0.0);
        }
    }

    /// LayerNorm 在半精度输入下改走 f32 归约，输出精度必须与 f32 路径接近。
    #[test]
    fn layer_norm_half_precision_tracks_f32() {
        let device = Device::Cpu;
        let input = Tensor::arange(0.0_f32, 12.0, &device).unwrap().reshape((1, 2, 6)).unwrap();
        let norm = LayerNorm {
            weight: None,
            bias: None,
            eps: 1e-5,
        };
        let reference = norm.forward(&input).unwrap();
        let half = norm
            .forward(&input.to_dtype(DType::BF16).unwrap())
            .unwrap()
            .to_dtype(DType::F32)
            .unwrap();
        assert_eq!(half.dims(), reference.dims());
        let reference = reference.flatten_all().unwrap().to_vec1::<f32>().unwrap();
        let half = half.flatten_all().unwrap().to_vec1::<f32>().unwrap();
        for (left, right) in half.iter().zip(reference.iter()) {
            assert!((left - right).abs() < 0.05, "{left} vs {right}");
        }
    }

    /// Dense 只保存转置布局，前向结果必须仍等于 `x · Wᵀ + b`。
    #[test]
    fn dense_forward_matches_row_major_weight() {
        let device = Device::Cpu;
        let weight = Tensor::arange(0.0_f32, 6.0, &device).unwrap().reshape((3, 2)).unwrap();
        let bias = Tensor::from_vec(vec![0.5_f32, -0.5, 1.0], (3,), &device).unwrap();
        let dense = Dense::from_weight(weight, Some(bias)).unwrap();
        let input = Tensor::from_vec(vec![1.0_f32, 2.0], (1, 1, 2), &device).unwrap();
        let output = dense.forward(&input).unwrap().flatten_all().unwrap().to_vec1::<f32>().unwrap();
        // W = [[0,1],[2,3],[4,5]]，x = [1,2] → [2, 8, 14]，再加 bias。
        assert_eq!(output, vec![2.5, 7.5, 15.0]);
    }

    /// tied embedding 只保存 [hidden, vocab]，查表与输出投影都要保持原语义。
    #[test]
    fn token_embedding_lookup_and_projection_agree() {
        let device = Device::Cpu;
        let weight = Tensor::arange(0.0_f32, 12.0, &device).unwrap().reshape((4, 3)).unwrap();
        let embedding = TokenEmbedding {
            weight_t: weight.t().unwrap().contiguous().unwrap(),
        };
        let ids = Tensor::from_vec(vec![2_u32, 0], (1, 2), &device).unwrap();
        let rows = embedding.forward(&ids).unwrap();
        assert_eq!(rows.dims(), &[1, 2, 3]);
        assert_eq!(
            rows.flatten_all().unwrap().to_vec1::<f32>().unwrap(),
            vec![6.0, 7.0, 8.0, 0.0, 1.0, 2.0]
        );
        let logits = embedding.as_linear(&rows.i((.., 0..1, ..)).unwrap()).unwrap();
        assert_eq!(logits.dims(), &[1, 1, 4]);
        // [6,7,8] 与词表各行的点积。
        assert_eq!(
            logits.flatten_all().unwrap().to_vec1::<f32>().unwrap(),
            vec![23.0, 86.0, 149.0, 212.0]
        );
    }
}
