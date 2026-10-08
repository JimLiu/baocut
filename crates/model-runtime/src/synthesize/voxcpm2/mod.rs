//! OpenBMB VoxCPM2：MiniCPM4 底座 + 局部扩散（CFM）+ AudioVAE，48 kHz（mlx-rs 实现，移植自 v2 `bcut-tts::voxcpm2`）。
//! 权重 `aufklarer/VoxCPM2-MLX-int8`。
//!
//! 部分实现移植自 speech-swift（https://github.com/soniqo/speech-swift ，Apache License 2.0，
//! Copyright 2025 Ivan Digital），有修改：改写为 Rust / mlx-rs，并按本仓库的模型包与错误约定接入。
//! SPDX-License-Identifier: Apache-2.0
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 纯逻辑子模块（`config` / `tokenizer`）不带 cfg 门，全平台编译并带单测；模型图与 [`VoxCpm2`]
//! 经 `synthesize::tensor` 门面编译：Apple Silicon 上是 MLX，其余平台开 `backend-candle` 时是 candle CPU/CUDA。

/// 无分类器引导强度的官方默认（`cfg_value`）。
pub const DEFAULT_CFG: f32 = 2.0;
/// 局部扩散步数的官方默认（`inference_timesteps`）。
pub const DEFAULT_STEPS: usize = 10;
/// 界面与参数表的 CFG `(最小, 最大, 步长)`（含两端），取官方 Gradio demo（OpenBMB/VoxCPM `app.py`）的滑杆。
/// 引擎只校验 `cfg > 0`，区间不进引擎。
pub const CFG_RANGE: (f32, f32, f32) = (1.0, 3.0, 0.1);
/// 推理步数（`inference_timesteps`）的 `(最小, 最大, 步长)`，来源同上；引擎只校验 `steps ≥ 1`。
pub const STEPS_RANGE: (usize, usize, usize) = (1, 50, 1);

pub mod config;
pub mod tokenizer;

#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod audio_vae;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod engine;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod minicpm;
#[cfg(all(
    test,
    any(
        feature = "backend-candle",
        all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
    )
))]
mod tests;

#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
pub use engine::{ENGINE_NAME, SAMPLE_RATE, VoxCpm2};
