//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/MLXCommon/WeightLoading.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 权重表：按文件 / 目录读取 safetensors，按名字取走张量，并提供
//! weight-norm 融合（对照 speech-swift `MLXCommon/WeightLoading.swift` 的
//! `fuseWeightNorm` 语义）。

use crate::synthesize::tensor::{Array, Dtype};
use anyhow::{Result, bail};
use std::collections::HashMap;
use std::path::Path;

pub struct WeightMap {
    map: HashMap<String, Array>,
    name: String,
}

impl WeightMap {
    /// 读取单个 safetensors 文件。
    pub fn load_file(path: &Path) -> Result<Self> {
        let map = Array::load_safetensors(path).map_err(|e| anyhow::anyhow!("读取 {} 失败：{e}", path.display()))?;
        Ok(Self {
            map,
            name: path.display().to_string(),
        })
    }

    /// 由内存中的张量构造（测试用）。
    #[cfg(test)]
    pub fn from_arrays(name: &str, arrays: impl IntoIterator<Item = (String, Array)>) -> Self {
        Self {
            map: arrays.into_iter().collect(),
            name: name.to_string(),
        }
    }

    pub fn contains(&self, key: &str) -> bool {
        self.map.contains_key(key)
    }

    /// 借看一个张量（不取走）。
    pub fn get(&self, key: &str) -> Option<&Array> {
        self.map.get(key)
    }

    /// 取走一个张量（原始 dtype）。
    pub fn take(&mut self, key: &str) -> Result<Array> {
        match self.map.remove(key) {
            Some(array) => Ok(array),
            None => bail!("{} 缺少权重 {key}", self.name),
        }
    }

    pub fn take_optional(&mut self, key: &str) -> Option<Array> {
        self.map.remove(key)
    }

    /// 取走并转成 f32。
    pub fn take_f32(&mut self, key: &str) -> Result<Array> {
        let array = self.take(key)?;
        Ok(array.as_dtype(Dtype::Float32)?)
    }

    pub fn take_optional_f32(&mut self, key: &str) -> Result<Option<Array>> {
        if self.map.contains_key(key) {
            Ok(Some(self.take(key)?.as_dtype(Dtype::Float32)?))
        } else {
            Ok(None)
        }
    }

    /// 只保留以 `prefix` 开头的键并去掉前缀。
    pub fn retain_prefix(&mut self, prefix: &str) {
        let old = std::mem::take(&mut self.map);
        for (key, value) in old {
            if let Some(rest) = key.strip_prefix(prefix) {
                self.map.insert(rest.to_string(), value);
            }
        }
    }

    /// 取走 weight-norm 的 (g, v) 并融合成 f32 权重；已预融合的检查点
    /// （只有 `{prefix}.weight`）直接取走该权重。
    pub fn take_weight_norm(&mut self, prefix: &str) -> Result<Array> {
        let v_key = format!("{prefix}.weight_v");
        if !self.map.contains_key(&v_key) {
            let fused = format!("{prefix}.weight");
            if self.map.contains_key(&fused) {
                return self.take_f32(&fused);
            }
        }
        let g = self.take(&format!("{prefix}.weight_g"))?;
        let v = self.take(&v_key)?;
        fuse_weight_norm(&g, &v)
    }

    pub fn insert(&mut self, key: impl Into<String>, array: Array) {
        self.map.insert(key.into(), array);
    }

    /// 当前全部键（排序后返回，便于确定性遍历）。
    pub fn keys(&self) -> Vec<String> {
        let mut keys: Vec<String> = self.map.keys().cloned().collect();
        keys.sort();
        keys
    }

    /// 改名；源键不存在时什么都不做。
    pub fn rename(&mut self, from: &str, to: impl Into<String>) {
        if let Some(array) = self.map.remove(from) {
            self.map.insert(to.into(), array);
        }
    }

    /// 对所有键做一次改名映射（返回 `None` 的键保持不变）。
    pub fn rename_all(&mut self, mut rename: impl FnMut(&str) -> Option<String>) {
        let old = std::mem::take(&mut self.map);
        for (key, value) in old {
            let key = rename(&key).unwrap_or(key);
            self.map.insert(key, value);
        }
    }

    /// 对所有键调用 `f`，用返回值替换张量。
    pub fn map_arrays(&mut self, mut f: impl FnMut(&str, Array) -> Result<Array>) -> Result<()> {
        let old = std::mem::take(&mut self.map);
        for (key, value) in old {
            let value = f(&key, value)?;
            self.map.insert(key, value);
        }
        Ok(())
    }
}

/// `w = g * v / ||v||`，范数在除第 0 维以外的所有维上计算（PyTorch `weight_norm(dim=0)`）。
pub fn fuse_weight_norm(g: &Array, v: &Array) -> Result<Array> {
    let v32 = v.as_dtype(Dtype::Float32)?;
    let g32 = g.as_dtype(Dtype::Float32)?;
    let out = v32.dim(0);
    let flat = v32.reshape(&[out, -1])?;
    let norm = flat.square()?.sum_axis(1, true)?.sqrt()?;
    let mut shape = vec![1i32; v32.ndim()];
    shape[0] = out;
    let norm = norm.reshape(&shape)?;
    let g32 = g32.reshape(&shape)?;
    Ok(&v32 * (g32 / (norm + 1e-9f32)))
}
