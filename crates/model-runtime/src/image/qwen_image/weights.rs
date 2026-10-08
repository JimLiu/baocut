//! 惰性权重：`Array::load_safetensors` 只解析文件头，每个数组在第一次求值时才从文件读入
//! （MLX 的 `Load` 只在 CPU stream 上实现，GPU 算子通过事件等它）。
//!
//! 不经过 [`crate::backend::mlx::runtime`] 的加载器：那条路（`load_safetensors_impl`）每次进来都先
//! `configure_memory_cache()`，把 MLX 缓存上限重置回 min(2 GiB, 物理内存 / 8)。本机生图按阶段
//! 定上限（DiT 256 MB、VAE 0，见 [`super::engine::CacheLimit`]），文本编码器与 DiT 又是每层
//! 重开惰性表——走那条加载器，阶段上限会在每一层被悄悄改回 2 GiB，footprint 多出整整 2 GB。
//! `qwen3` 的 `WeightStore::from_arrays` / `TextDecoder::load_with_prefix` 不碰缓存上限。
//!
//! 与 v2 唯一的不同：v2 按目录扫 `*.safetensors`，这里读调用方按清单取出的文件
//! （[`crate::bundle::VerifiedFiles::require_extension_in`]）。

use anyhow::{Context, Result, bail};
use mlx_rs::Array;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::backend::mlx::qwen3::WeightStore;

/// 打开给定的 safetensors 分片，只留 `keep` 选中的张量，都不求值。
pub fn lazy(files: &[PathBuf], keep: impl Fn(&str) -> bool) -> Result<HashMap<String, Array>> {
    if files.is_empty() {
        bail!("没有 safetensors 文件");
    }
    let mut map = HashMap::new();
    for (index, f) in files.iter().enumerate() {
        let arrays = Array::load_safetensors(f).with_context(|| format!("读取 safetensors 第 {index} 个文件"))?;
        for (k, v) in arrays {
            if keep(&k) && map.insert(k.clone(), v).is_some() {
                bail!("重复权重键：{k}");
            }
        }
    }
    Ok(map)
}

/// 常驻加载：逐张量求值（每个 command buffer 都短，避开 GPU 看门狗）。
pub fn resident(files: &[PathBuf], keep: impl Fn(&str) -> bool) -> Result<WeightStore> {
    into_resident(lazy(files, keep)?)
}

/// 把 [`lazy`] 打开的表逐张量求值后装进 `WeightStore`。
pub fn into_resident(map: HashMap<String, Array>) -> Result<WeightStore> {
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort();
    for k in keys {
        map[k].eval()?;
    }
    WeightStore::from_arrays(map)
}
