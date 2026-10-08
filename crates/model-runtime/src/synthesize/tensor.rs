//! Internal tensor vocabulary shared by the synthesis graphs. MLX remains the
//! Apple implementation; Candle executes the same graph on CPU/CUDA elsewhere.
#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
pub use crate::backend::mlx::qwen3::gelu_same_dtype;
#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
pub mod host {
    #[cfg(test)]
    pub(crate) use crate::backend::mlx::runtime::MLX_TEST_LOCK as TEST_LOCK;
    pub use crate::backend::mlx::runtime::{
        ModelMemoryCacheGuard, clear_memory_cache, configure_memory_cache, ensure_metal_device as ensure_device, load_safetensors,
        speech_timing_enabled,
    };
}
#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
pub use mlx_rs::*;

// 开了 candle 就编译适配层（含它自己的单测）；Apple Silicon 同时开 MLX 时合成图仍走 MLX。
#[cfg(feature = "backend-candle")]
#[cfg_attr(
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"),
    allow(dead_code, unused_imports)
)]
pub(crate) mod candle;
#[cfg(all(
    feature = "backend-candle",
    not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))
))]
pub use candle::*;
