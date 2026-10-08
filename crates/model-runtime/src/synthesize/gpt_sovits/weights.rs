//! 权重表：读取清单列出的 safetensors，按名字取走张量，并提供 weight-norm 融合。
//!
//! 移植自 v2 `bcut-tts::index_tts2::mlx::weights`（IndexTTS2 与 GPT-SoVITS 共用的那一份），只带
//! GPT-SoVITS 用到的部分、去掉 Candle 分支；读文件改走 [`crate::synthesize::tensor::host::load_safetensors`]。
//! 与 IndexTTS2 的同名权重表同源，两边都移植完可以合并成一份。

use crate::synthesize::tensor::host::load_safetensors;
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
        let map = load_safetensors(&[path]).map_err(|e| anyhow::anyhow!("读取 {} 失败：{e}", path.display()))?;
        Ok(Self {
            map,
            name: path.display().to_string(),
        })
    }

    /// 取走一个张量（原始 dtype）。
    pub fn take(&mut self, key: &str) -> Result<Array> {
        match self.map.remove(key) {
            Some(array) => Ok(array),
            None => bail!("{} 缺少权重 {key}", self.name),
        }
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
