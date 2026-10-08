//! k2-fsa OmniVoice：Qwen3 底座的掩码离散扩散 + Higgs 音频分词器，24 kHz（mlx-rs 实现，移植自 v2 `bcut-tts::omnivoice`）。
//! 权重 `aufklarer/OmniVoice-MLX-int8`；音频分词器在同一仓库的 `audio_tokenizer/` 下。
//!
//! 部分实现移植自 speech-swift（https://github.com/soniqo/speech-swift ，Apache License 2.0，
//! Copyright 2025 Ivan Digital），有修改：改写为 Rust / mlx-rs，并按本仓库的模型包与错误约定接入。
//! SPDX-License-Identifier: Apache-2.0
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 纯逻辑子模块（配置解析、分词、文本与音频前后处理、instruct 词表）不带 cfg 门，全平台编译并带单测；
//! 模型图与 [`OmniVoice`] 经 `synthesize::tensor` 门面编译：Apple Silicon 上是 MLX，其余平台开 `backend-candle` 时是 candle CPU/CUDA。

/// 无分类器引导强度的官方默认（`guidance_scale`）。
pub const DEFAULT_CFG: f32 = 2.0;
/// 迭代解码步数的官方默认（`num_step`）。
pub const DEFAULT_STEPS: usize = 32;
/// 单段目标时长上限（秒）。
pub const MAX_TARGET_SECONDS: f64 = 60.0;
/// 界面与参数表的语速 `(最小, 最大, 步长)`（含两端），取官方 Gradio demo（k2-fsa/OmniVoice
/// `omnivoice/cli/demo.py`）的滑杆。模型本身只要求 `speed > 0`、`cfg ≥ 0`（0 = 不做引导）、`steps ≥ 1`，
/// 引擎按这个下限校验，区间不进引擎。
pub const SPEED_RANGE: (f32, f32, f32) = (0.5, 1.5, 0.05);
/// CFG 的 `(最小, 最大, 步长)`，来源同 [`SPEED_RANGE`]。
pub const CFG_RANGE: (f32, f32, f32) = (0.0, 4.0, 0.1);
/// 步数的 `(最小, 最大, 步长)`，来源同 [`SPEED_RANGE`]。
pub const STEPS_RANGE: (usize, usize, usize) = (4, 64, 1);

pub mod audio;
pub mod config;
pub mod instruct;
mod lang_table;
pub mod text;
pub mod tokenizer;

#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod backbone;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod codec;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod engine;
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
pub use engine::{ENGINE_NAME, OmniVoice, SAMPLE_RATE};
