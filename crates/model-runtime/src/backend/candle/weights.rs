//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/Qwen3ASR/WeightLoading.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! safetensors 权重加载 + MLX 仿射量化的加载期反量化。
//!
//! MLX 量化格式：`weight` 是打包的 uint32（每个 u32 按低位在前存 `32/bits`
//! 个量化值），`scales`/`biases` 按每 `group_size` 个输入维一组。反量化为
//! `w = q * scale + bias`，与 MLX `quantized_matmul` 内部使用的权重逐值一致，
//! 因此可以直接复用现有 MLX 模型仓库而无需重新发布权重。

use anyhow::{Context, Result, bail};
use candle_core::{DType, Device, Tensor};
use std::collections::HashMap;
use std::path::Path;

/// 强制计算精度的环境变量（诊断用）。
pub const COMPUTE_DTYPE_ENV: &str = "BAOCUT_CANDLE_DTYPE";

pub struct WeightStore {
    values: HashMap<String, Tensor>,
    device: Device,
    compute_dtype: DType,
}

impl WeightStore {
    pub(crate) fn from_values(values: HashMap<String, Tensor>, device: &Device, compute_dtype: DType) -> Self {
        Self {
            values,
            device: device.clone(),
            compute_dtype,
        }
    }

    /// 读入 `files` 列出的全部 safetensors 分片，去掉 `thinker.` 前缀。
    pub fn load(files: &[&Path], device: &Device) -> Result<Self> {
        if files.is_empty() {
            bail!("no safetensors files to load");
        }
        let mut values = HashMap::new();
        for path in files {
            for (key, value) in
                candle_core::safetensors::load(path, device).with_context(|| format!("loading weights from {}", path.display()))?
            {
                let normalized = key.strip_prefix("thinker.").unwrap_or(&key).to_owned();
                if values.insert(normalized.clone(), value).is_some() {
                    bail!("duplicate weight after normalization: {normalized}");
                }
            }
        }
        let compute_dtype = resolve_compute_dtype(device, &values)?;
        Ok(Self {
            values,
            device: device.clone(),
            compute_dtype,
        })
    }

    pub fn device(&self) -> &Device {
        &self.device
    }

    /// 本模型的计算精度：CPU 恒为 f32，CUDA 上沿用 checkpoint 自身的半精度。
    pub fn compute_dtype(&self) -> DType {
        self.compute_dtype
    }

    pub fn contains(&self, key: &str) -> bool {
        self.values.contains_key(key)
    }

    pub fn take(&mut self, key: &str) -> Result<Tensor> {
        self.values.remove(key).ok_or_else(|| anyhow::anyhow!("missing weight: {key}"))
    }

    pub fn take_optional(&mut self, key: &str) -> Option<Tensor> {
        self.values.remove(key)
    }

    /// 取权重并转为 f32（bf16/f16 上转换）。
    pub fn take_f32(&mut self, key: &str) -> Result<Tensor> {
        Ok(self.take(key)?.to_dtype(DType::F32)?)
    }

    pub fn take_optional_f32(&mut self, key: &str) -> Result<Option<Tensor>> {
        self.take_optional(key).map(|tensor| Ok(tensor.to_dtype(DType::F32)?)).transpose()
    }

    /// 取权重并转为本模型的计算精度（CPU 上等价于 `take_f32`）。
    pub fn take_compute(&mut self, key: &str) -> Result<Tensor> {
        Ok(self.take(key)?.to_dtype(self.compute_dtype)?)
    }

    pub fn take_optional_compute(&mut self, key: &str) -> Result<Option<Tensor>> {
        let dtype = self.compute_dtype;
        self.take_optional(key).map(|tensor| Ok(tensor.to_dtype(dtype)?)).transpose()
    }

    /// 线性/嵌入层权重：checkpoint 带 `scales` 时反量化，否则直接转精度。
    ///
    /// 与 mlx 后端不同，float 权重不做运行时再量化——反量化结果直接落到本
    /// 模型的计算精度，免去 candle 侧的量化 matmul 依赖。
    pub fn take_dequantized(&mut self, prefix: &str, group_size: usize, bits: usize) -> Result<Tensor> {
        let weight = self.take(&format!("{prefix}.weight"))?;
        if let Some(scales) = self.take_optional(&format!("{prefix}.scales")) {
            let biases = self.take(&format!("{prefix}.biases"))?;
            let dequantized = dequantize_affine(&weight, &scales, &biases, group_size, bits)?;
            Ok(dequantized.to_dtype(self.compute_dtype)?)
        } else {
            Ok(weight.to_dtype(self.compute_dtype)?)
        }
    }

    pub fn remaining(&self) -> Vec<String> {
        let mut keys = self.values.keys().cloned().collect::<Vec<_>>();
        keys.sort();
        keys
    }
}

/// 选择计算精度。CPU 固定 f32；CUDA 上沿用 checkpoint 自身的半精度
/// （MOSS/Qwen3-ASR 为 bf16，对齐器为 f16），既省一半显存又不引入额外的
/// 数值转换。`BAOCUT_CANDLE_DTYPE=f32|bf16|f16` 可强制覆盖，便于排查精度问题。
fn resolve_compute_dtype(device: &Device, values: &HashMap<String, Tensor>) -> Result<DType> {
    if let Some(raw) = std::env::var_os(COMPUTE_DTYPE_ENV) {
        let raw = raw.to_string_lossy().trim().to_lowercase();
        return match raw.as_str() {
            "f32" | "float32" => Ok(DType::F32),
            "bf16" | "bfloat16" => Ok(DType::BF16),
            "f16" | "float16" => Ok(DType::F16),
            other => bail!("invalid {COMPUTE_DTYPE_ENV} value {other} (expected f32, bf16 or f16)"),
        };
    }
    if !device.is_cuda() {
        return Ok(DType::F32);
    }
    let mut float16 = 0_usize;
    let mut bfloat16 = 0_usize;
    for tensor in values.values() {
        match tensor.dtype() {
            DType::F16 => float16 += 1,
            DType::BF16 => bfloat16 += 1,
            _ => {}
        }
    }
    Ok(if float16 == 0 && bfloat16 == 0 {
        DType::F32
    } else if float16 > bfloat16 {
        DType::F16
    } else {
        DType::BF16
    })
}

/// MLX 仿射反量化：`weight` [rows, cols*bits/32] 的 u32，每个 u32 低位在前
/// 存 `32/bits` 个量化值；`scales`/`biases` [rows, cols/group_size]。
pub fn dequantize_affine(weight: &Tensor, scales: &Tensor, biases: &Tensor, group_size: usize, bits: usize) -> Result<Tensor> {
    // 与 mlx 后端的 `Projection` 一致：带 scales 的权重只认 4 或 8 位；配置没声明量化（按 16 位）时解包只会算出乱码。
    if !matches!(bits, 4 | 8) {
        bail!("unsupported quantization width: {bits} bits (weights with scales need a declared 4- or 8-bit quantization)");
    }
    if weight.dtype() != DType::U32 {
        bail!("quantized weights must be uint32, got {:?}", weight.dtype());
    }
    let dims = weight.dims();
    if dims.len() != 2 {
        bail!("quantized weights must be two-dimensional, got {dims:?}");
    }
    let values_per_word = 32 / bits;
    let rows = dims[0];
    let packed_columns = dims[1];
    let columns = packed_columns * values_per_word;
    if !columns.is_multiple_of(group_size) {
        bail!("quantized column count {columns} is not a multiple of the group size {group_size}");
    }
    let groups = columns / group_size;
    let device = weight.device().clone();
    let packed = weight.flatten_all()?.to_vec1::<u32>()?;
    let scales = scales.to_dtype(DType::F32)?.flatten_all()?.to_vec1::<f32>()?;
    let biases = biases.to_dtype(DType::F32)?.flatten_all()?.to_vec1::<f32>()?;
    if scales.len() != rows * groups || biases.len() != rows * groups {
        bail!(
            "scales/biases shape mismatch: expected {}×{groups}, got {} / {}",
            rows,
            scales.len(),
            biases.len()
        );
    }
    let mask = if bits == 32 { u32::MAX } else { (1_u32 << bits) - 1 };
    let mut output = vec![0.0_f32; rows * columns];
    // 逐行独立，按行分片多线程展开：大模型加载期这段标量循环原本是瓶颈。
    let threads = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(1)
        .clamp(1, rows.max(1));
    let rows_per_task = rows.div_ceil(threads).max(1);
    let chunk_length = (rows_per_task * columns).max(1);
    std::thread::scope(|scope| {
        for (task, output_rows) in output.chunks_mut(chunk_length).enumerate() {
            let first_row = task * rows_per_task;
            let task_rows = output_rows.len() / columns;
            let task_scales = &scales[first_row * groups..(first_row + task_rows) * groups];
            let task_biases = &biases[first_row * groups..(first_row + task_rows) * groups];
            let task_packed = &packed[first_row * packed_columns..(first_row + task_rows) * packed_columns];
            scope.spawn(move || {
                for row in 0..task_rows {
                    let row_scales = &task_scales[row * groups..(row + 1) * groups];
                    let row_biases = &task_biases[row * groups..(row + 1) * groups];
                    let row_packed = &task_packed[row * packed_columns..(row + 1) * packed_columns];
                    let row_output = &mut output_rows[row * columns..(row + 1) * columns];
                    for (word_index, word) in row_packed.iter().copied().enumerate() {
                        let base = word_index * values_per_word;
                        for offset in 0..values_per_word {
                            let column = base + offset;
                            let quantized = (word >> (offset * bits)) & mask;
                            let group = column / group_size;
                            row_output[column] = quantized as f32 * row_scales[group] + row_biases[group];
                        }
                    }
                }
            });
        }
    });
    Ok(Tensor::from_vec(output, (rows, columns), &device)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use candle_core::Device;

    /// 按 MLX 语义手工打包一个 4bit 量化矩阵，验证反量化公式与位序。
    #[test]
    fn dequantizes_hand_packed_affine_weights() {
        let device = Device::Cpu;
        // 一行 8 个值（一个 u32），group_size 8：q = [0,1,2,…,7]，低位在前。
        let mut word = 0_u32;
        for (offset, q) in (0..8_u32).enumerate() {
            word |= q << (offset * 4);
        }
        let weight = Tensor::from_vec(vec![word], (1, 1), &device).unwrap();
        let scales = Tensor::from_vec(vec![0.5_f32], (1, 1), &device).unwrap();
        let biases = Tensor::from_vec(vec![-1.0_f32], (1, 1), &device).unwrap();
        let dequantized = dequantize_affine(&weight, &scales, &biases, 8, 4).unwrap();
        let values = dequantized.flatten_all().unwrap().to_vec1::<f32>().unwrap();
        let expected = (0..8).map(|q| q as f32 * 0.5 - 1.0).collect::<Vec<_>>();
        assert_eq!(values, expected);
    }

    #[test]
    fn rejects_unsupported_bit_widths() {
        let device = Device::Cpu;
        let weight = Tensor::from_vec(vec![0_u32], (1, 1), &device).unwrap();
        let scales = Tensor::from_vec(vec![1.0_f32], (1, 1), &device).unwrap();
        let biases = Tensor::from_vec(vec![0.0_f32], (1, 1), &device).unwrap();
        assert!(dequantize_affine(&weight, &scales, &biases, 8, 5).is_err());
        // 配置没声明量化时按 16 位：带 scales 的权重同样拒绝。
        assert!(dequantize_affine(&weight, &scales, &biases, 8, 16).is_err());
    }
}
