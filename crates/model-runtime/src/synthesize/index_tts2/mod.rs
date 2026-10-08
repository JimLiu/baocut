//! IndexTTS2 与 IndexTTS 2.5（mlx-rs 实现，移植自 v2 `bcut-tts::index_tts2`）。
//!
//! 部分实现移植自 speech-swift（https://github.com/soniqo/speech-swift ，Apache License 2.0，
//! Copyright 2025 Ivan Digital），有修改：改写为 Rust / mlx-rs，推理流程按官方 `indextts/infer_v2.py` /
//! `infer_v2_5.py` 校正，并按本仓库的模型包与错误约定接入。
//! SPDX-License-Identifier: Apache-2.0
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 流水线：参考音频 → w2v-BERT 2.0（第 17 层）→ MaskGCT 语义码本量化 →
//! CAMPPlus 192 维音色 → GPT 语义 token 生成 → S2Mel（DiT 流匹配）→ BigVGAN
//! （22.05 kHz）。情感由 feat1/feat2 矩阵或参考音频控制；`qwen0.6bemo4-merge`
//! 文本情感模型不在范围内。
//!
//! IndexTTS 2.5（[`IndexTts25`]）复用同一套模型图：tiktoken 多语言前端在 `v25`，
//! GPT 条件改为 CAM++ 风格投影，语义码经 2.5 码本解码器得到 S2Mel 内容特征，
//! w2v-BERT / CAM++ / BigVGAN 与 2.0 相同。
//!
//! w2v-BERT / CAM++ / BigVGAN 与统计量在 IndexTTS2 仓库里：2.0 的主模型组件就是这个仓库；2.5 的主模型组件
//! 是 2.5 仓库，另带 `aux` 组件指向 IndexTTS2 仓库。引擎只读清单列出的文件。
//!
//! 纯逻辑模块（配置、SentencePiece、文本规范化、分词、切段、情感向量、CPU
//! DSP）不带 cfg 门，全平台编译并带单测；模型图（`mlx`，目录名沿用 MLX 来源）
//! 经 `synthesize::tensor` 门面编译：Apple Silicon 上是 MLX，其余平台开 `backend-candle` 时是 candle CPU/CUDA。

pub mod config;
pub mod dsp;
pub mod emotion;
pub mod normalizer;
pub mod sampling;
pub mod segmenter;
pub mod sentencepiece;
pub mod tokenizer;
pub mod v25;

/// IndexTTS 2.5 语速倍率（`TtsRequest::speed`）的合法区间 `[0.5, 1.5]`。
pub const SPEAKING_RATE_RANGE: (f32, f32) = (0.5, 1.5);

#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
pub(crate) mod mlx;

#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
pub use mlx::engine_impl::IndexTts2;

#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
pub use mlx::engine_v25::IndexTts25;
