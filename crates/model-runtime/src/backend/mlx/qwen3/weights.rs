//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/Qwen3ASR/WeightLoading.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 权重表：读入列出的全部 safetensors，去掉 `thinker.` 前缀，按键取用。
//!
//! `from_arrays` 与 `load_thinker_text*` 移植自 v2，供本地语音合成批次（Qwen2.5-Omni Thinker 文本骨干）使用。

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Result, bail};
use mlx_rs::Array;

use crate::backend::mlx::runtime::{load_safetensors, load_safetensors_filtered, load_safetensors_filtered_deferred};

pub struct WeightStore {
    values: HashMap<String, Array>,
}

impl WeightStore {
    /// 读入 `files` 列出的全部 safetensors 分片。
    pub fn load(files: &[&Path]) -> Result<Self> {
        Self::from_raw(load_safetensors(files)?)
    }

    /// 由调用方自备的数组表构造（例如尚未求值的惰性 safetensors 数组）。
    pub fn from_arrays(values: HashMap<String, Array>) -> Result<Self> {
        Self::from_raw(values)
    }

    /// 只加载 Qwen Thinker 文本骨干：官方 Omni 仓库还包含本路径
    /// 完全不使用的视觉、音频和 Talker 权重。
    pub fn load_thinker_text(files: &[&Path]) -> Result<Self> {
        let raw = load_safetensors_filtered(files, is_thinker_text)?;
        Self::from_raw(raw)
    }

    /// Quantize one lazily loaded matrix at a time, immediately releasing its
    /// original buffer. Uses the exact same MLX affine quantizer as Projection.
    pub fn load_thinker_text_quantized(files: &[&Path], group_size: i32, bits: i32) -> Result<Self> {
        anyhow::ensure!(matches!(bits, 4 | 8), "Qwen quantization bits must be 4 or 8");
        let mut raw = load_safetensors_filtered_deferred(files, is_thinker_text)?;
        let mut keys = raw.keys().cloned().collect::<Vec<_>>();
        keys.sort();
        for key in keys {
            let value = raw.remove(&key).expect("key from map");
            let prefix = key.strip_suffix(".weight");
            if let Some(prefix) = prefix.filter(|prefix| value.ndim() == 2 && !raw.contains_key(&format!("{prefix}.scales"))) {
                let (weight, scales, biases) = mlx_rs::ops::quantize(&value, group_size, bits)?;
                mlx_rs::transforms::eval([&weight, &scales, &biases])?;
                raw.insert(key.clone(), weight);
                raw.insert(format!("{prefix}.scales"), scales);
                raw.insert(format!("{prefix}.biases"), biases);
            } else {
                value.eval()?;
                raw.insert(key, value);
            }
        }
        Self::from_raw(raw)
    }

    fn from_raw(raw: HashMap<String, Array>) -> Result<Self> {
        let mut values = HashMap::with_capacity(raw.len());
        for (key, value) in raw {
            let normalized = key.strip_prefix("thinker.").unwrap_or(&key).to_owned();
            if values.insert(normalized.clone(), value).is_some() {
                bail!("duplicate weight after normalization: {normalized}");
            }
        }
        Ok(Self { values })
    }

    pub fn contains(&self, key: &str) -> bool {
        self.values.contains_key(key)
    }

    pub fn take(&mut self, key: &str) -> Result<Array> {
        self.values.remove(key).ok_or_else(|| anyhow::anyhow!("missing weight: {key}"))
    }

    pub fn take_optional(&mut self, key: &str) -> Option<Array> {
        self.values.remove(key)
    }

    pub fn remaining(&self) -> Vec<String> {
        let mut keys = self.values.keys().cloned().collect::<Vec<_>>();
        keys.sort();
        keys
    }
}

fn is_thinker_text(key: &str) -> bool {
    key.starts_with("thinker.model.embed_tokens.") || key.starts_with("thinker.model.layers.") || key.starts_with("thinker.model.norm.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::mlx::runtime::{MLX_TEST_LOCK, ensure_metal_device};
    use mlx_rs::{Dtype, ops};

    #[test]
    fn strips_the_thinker_prefix_and_rejects_collisions() -> Result<()> {
        let _lock = crate::backend::mlx::runtime::MLX_TEST_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let value = Array::from_slice(&[1.0_f32], &[1]);
        let mut store = WeightStore::from_raw(HashMap::from([("thinker.model.norm.weight".to_owned(), value.clone())]))?;
        assert!(store.contains("model.norm.weight"));
        assert!(store.take("model.norm.weight").is_ok());
        assert!(store.take("model.norm.weight").is_err());
        assert!(store.remaining().is_empty());

        let collision = HashMap::from([("thinker.a".to_owned(), value.clone()), ("a".to_owned(), value)]);
        assert!(WeightStore::from_raw(collision).is_err());
        Ok(())
    }

    // ---- 以下两个移植自 v2：v2 按目录读，这里把夹具文件逐个列出来 ----

    #[test]
    fn streamed_thinker_quantization_matches_original_quantizer() -> Result<()> {
        let _lock = MLX_TEST_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
        if ensure_metal_device().is_err() {
            return Ok(());
        }
        let dir = tempfile::tempdir()?;
        let matrix =
            Array::from_slice(&(0..8 * 64).map(|i| (i as f32 * 0.17).sin()).collect::<Vec<_>>(), &[8, 64]).as_dtype(Dtype::Bfloat16)?;
        let norm = ops::ones::<f32>(&[64])?;
        let source = HashMap::from([
            ("thinker.model.embed_tokens.weight", matrix.clone()),
            ("thinker.model.layers.0.self_attn.q_proj.weight", matrix.clone()),
            ("thinker.model.norm.weight", norm.clone()),
            ("thinker.visual.unused.weight", matrix.clone()),
        ]);
        let file = dir.path().join("model.safetensors");
        Array::save_safetensors(source.iter().map(|(key, value)| (*key, value)), None, &file)?;
        let files = [file.as_path()];
        for bits in [4, 8] {
            let mut loaded = WeightStore::load_thinker_text_quantized(&files, 64, bits)?;
            assert!(!loaded.contains("visual.unused.weight"));
            let (weight, scales, biases) = ops::quantize(&matrix, 64, bits)?;
            for prefix in ["model.embed_tokens", "model.layers.0.self_attn.q_proj"] {
                for (suffix, expected) in [("weight", &weight), ("scales", &scales), ("biases", &biases)] {
                    let actual = loaded.take(&format!("{prefix}.{suffix}"))?;
                    assert_eq!(actual.dtype(), expected.dtype());
                    assert_eq!(actual.shape(), expected.shape());
                    assert!(actual.eq(expected)?.all(None)?.try_item::<bool>()?);
                }
            }
            let actual = loaded.take("model.norm.weight")?;
            assert!(actual.eq(&norm)?.all(None)?.try_item::<bool>()?);
            assert!(loaded.remaining().is_empty());
        }
        assert!(WeightStore::load_thinker_text_quantized(&files, 64, 3).is_err());

        // 不量化的入口同样只留 Thinker 文本骨干。
        let plain = WeightStore::load_thinker_text(&files)?;
        assert_eq!(
            plain.remaining(),
            [
                "model.embed_tokens.weight",
                "model.layers.0.self_attn.q_proj.weight",
                "model.norm.weight"
            ]
        );
        Ok(())
    }

    #[test]
    fn streamed_thinker_preserves_prequantized_matrices_and_rejects_duplicates() -> Result<()> {
        let _lock = MLX_TEST_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
        if ensure_metal_device().is_err() {
            return Ok(());
        }
        let dir = tempfile::tempdir()?;
        let matrix = ops::ones::<f32>(&[8, 64])?;
        let (weight, scales, biases) = ops::quantize(&matrix, 64, 8)?;
        let source = HashMap::from([
            ("thinker.model.embed_tokens.weight", &weight),
            ("thinker.model.embed_tokens.scales", &scales),
            ("thinker.model.embed_tokens.biases", &biases),
        ]);
        let one = dir.path().join("one.safetensors");
        Array::save_safetensors(source.iter().map(|(key, value)| (*key, *value)), None, &one)?;
        let loaded = WeightStore::load_thinker_text_quantized(&[one.as_path()], 64, 8)?;
        for (suffix, expected) in [("weight", &weight), ("scales", &scales), ("biases", &biases)] {
            assert!(
                loaded.values[&format!("model.embed_tokens.{suffix}")]
                    .eq(expected)?
                    .all(None)?
                    .try_item::<bool>()?
            );
        }
        let two = dir.path().join("two.safetensors");
        Array::save_safetensors(source.iter().map(|(key, value)| (*key, *value)), None, &two)?;
        assert!(WeightStore::load_thinker_text_quantized(&[one.as_path(), two.as_path()], 64, 8).is_err());
        Ok(())
    }
}
