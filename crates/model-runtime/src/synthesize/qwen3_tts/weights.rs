//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/Qwen3TTS/TTSWeightLoading.swift / Sources/Qwen3TTS/TTSWeightLoading+Encoder.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Qwen3-TTS 权重仓：在 `crate::synthesize::tensor::host::load_safetensors` 之上
//! 提供按前缀取用、F16→BF16 提升与布局校正的能力。
//!
//! 没有直接复用 `crate::backend::mlx::qwen3::WeightStore`：它无法在装入层之前对张量做
//! dtype 提升（CustomVoice-bf16 导出实际存的是 F16，加载时提升为 BF16 才能稳定增量解码）
//! 与卷积布局转置（Speech Tokenizer 权重是 PyTorch 布局）。

use std::collections::HashMap;
use std::path::Path;

use crate::synthesize::tensor::host::load_safetensors;
use crate::synthesize::tensor::{Array, Dtype};
use anyhow::{Context, Result, bail};

/// 已加载的权重集合，按键取走后从表中移除，便于最后检查未消费的键。
pub struct Weights {
    tensors: HashMap<String, Array>,
}

impl Weights {
    /// 加载清单列出的 safetensors；`promote_f16` 为真时把 F16 张量提升为 BF16。
    pub fn load(files: &[&Path], promote_f16: bool) -> Result<Self> {
        let mut tensors = load_safetensors(files)?;
        if promote_f16 {
            let mut promoted = Vec::new();
            for (key, value) in tensors.iter() {
                if value.dtype() == Dtype::Float16 {
                    promoted.push((key.clone(), value.as_dtype(Dtype::Bfloat16)?));
                }
            }
            for (key, value) in promoted {
                tensors.insert(key, value);
            }
            crate::synthesize::tensor::transforms::eval(tensors.values())?;
        }
        Ok(Self { tensors })
    }

    /// 直接由张量表构造（合成权重的单测用；VoxCPM2 / OmniVoice 的单测会用到）。
    #[cfg(test)]
    #[allow(dead_code)]
    pub fn from_tensors(tensors: HashMap<String, Array>) -> Self {
        Self { tensors }
    }

    /// 还没被取走的键（排序后），加载完用来检查有没有漏接的权重（VoxCPM2 用）。
    #[allow(dead_code)]
    pub fn keys(&self) -> Vec<String> {
        let mut keys: Vec<String> = self.tensors.keys().cloned().collect();
        keys.sort();
        keys
    }

    pub fn contains(&self, key: &str) -> bool {
        self.tensors.contains_key(key)
    }

    pub fn take(&mut self, key: &str) -> Result<Array> {
        self.tensors.remove(key).with_context(|| format!("缺少权重：{key}"))
    }

    pub fn take_optional(&mut self, key: &str) -> Option<Array> {
        self.tensors.remove(key)
    }

    /// 取出 PyTorch 布局 `[out, in, k]` 的 Conv1d 权重并转成 MLX 布局 `[out, k, in]`。
    /// 判定：形状为三维且 `k != in` 时才转置，`k == in` 视为已是 MLX 布局
    /// （speaker encoder 的权重导出时已经是 MLX 布局）。
    pub fn take_conv1d(&mut self, key: &str, already_mlx: bool) -> Result<Array> {
        let weight = self.take(key)?;
        if already_mlx || weight.ndim() != 3 {
            return Ok(weight);
        }
        Ok(weight.transpose_axes(&[0, 2, 1])?)
    }

    /// 取出 PyTorch 布局 `[in, out, k]` 的 ConvTranspose1d 权重并转成 MLX 布局 `[out, k, in]`。
    pub fn take_conv_transpose1d(&mut self, key: &str) -> Result<Array> {
        let weight = self.take(key)?;
        if weight.ndim() != 3 {
            bail!("ConvTranspose1d 权重维度错误：{key} {:?}", weight.shape());
        }
        Ok(weight.transpose_axes(&[1, 2, 0])?)
    }

    /// 按前缀拆出子集（去掉前缀），用于把 talker / code_predictor / speaker_encoder 分开。
    pub fn split_prefix(&mut self, prefix: &str) -> Weights {
        let mut taken = HashMap::new();
        let keys: Vec<String> = self.tensors.keys().filter(|key| key.starts_with(prefix)).cloned().collect();
        for key in keys {
            if let Some(value) = self.tensors.remove(&key) {
                taken.insert(key[prefix.len()..].to_string(), value);
            }
        }
        Weights { tensors: taken }
    }
}
