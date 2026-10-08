//! Qwen3-TTS 12 Hz（mlx-rs 实现，移植自 v2 `bcut-tts::qwen3_tts`）。
//!
//! 部分实现移植自 speech-swift（https://github.com/soniqo/speech-swift ，Apache License 2.0，
//! Copyright 2025 Ivan Digital），有修改：改写为 Rust / mlx-rs，并按本仓库的模型包与错误约定接入。
//! SPDX-License-Identifier: Apache-2.0
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 组件：Talker（28 层 Qwen3，`talker.rs`）→ Code Predictor（5 层、15 个
//! lm head，`code_predictor.rs`）→ Speech Tokenizer 解码器（RVQ → transformer
//! → SEANet 上采样，24 kHz，`codec_decoder.rs`）；克隆路径还需要 Speaker
//! Encoder（ECAPA-TDNN x-vector，`speaker_encoder.rs`）与 Speech Tokenizer
//! 编码器（ICL 模式把参考音频编成 codec token，`codec_encoder.rs`）。
//! Speech Tokenizer（`Qwen/Qwen3-TTS-Tokenizer-12Hz`）是各尺寸、各变体共用的伴随组件。
//!
//! 纯逻辑子模块（`config` / `tokens` / `prompt` / `sampling` / `mel`）不带 cfg 门，全平台编译并带单测；
//! 模型图与 [`Qwen3Tts`] 经 `synthesize::tensor` 门面编译：Apple Silicon 上是 MLX，其余平台开 `backend-candle` 时是 candle CPU/CUDA。

pub mod config;
pub mod mel;
pub mod prompt;
pub mod sampling;
pub mod tokens;

#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod code_predictor;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod codec_decoder;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod codec_encoder;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod engine;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
pub(crate) mod layers;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod speaker_encoder;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod talker;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
pub(crate) mod weights;

#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
pub use engine::Qwen3Tts;
