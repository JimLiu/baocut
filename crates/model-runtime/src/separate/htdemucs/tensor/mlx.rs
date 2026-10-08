//! HTDemucs 图用到的张量词汇：MLX 的数组与算子，加上本 crate 的 Metal 设备、缓存与权重读取。
//! 这一层让 `layers` / `transformer` / `model` 保持与 v2 相同的写法。

pub use crate::backend::mlx::qwen3::gelu_same_dtype;
pub use crate::backend::mlx::runtime::{MemoryCacheGuard, configure_memory_cache, ensure_metal_device as ensure_device};
pub use mlx_rs::*;

use anyhow::Result;
use std::collections::HashMap;
use std::path::Path;

/// 读取 safetensors 但不立即求值（与 v2 一致：权重在首次前向时才物化，fp16 → f32 的上转换也在那时发生）。
pub fn load_safetensors_deferred(files: &[&Path], keep: impl Fn(&str) -> bool) -> Result<HashMap<String, Array>> {
    crate::backend::mlx::runtime::load_safetensors_filtered_deferred(files, keep)
}
