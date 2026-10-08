//! HTDemucs-FT（Demucs v4 hybrid transformer，4 个各专精一个声部的子模型）：MLX 与 candle 两个后端共用一份模型图。
//!
//! 部分实现移植自 speech-swift（https://github.com/soniqo/speech-swift ，Apache License 2.0，
//! Copyright 2025 Ivan Digital），有修改：改写为 Rust / mlx-rs，并按本仓库的模型包与错误约定接入。
//! SPDX-License-Identifier: Apache-2.0
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 对照 speech-swift `Sources/SourceSeparation/HTDemucs/`：`layers.rs` ↔ `HTDemucsLayers.swift` 与
//! `DemucsPrimitives.swift`，`transformer.rs` ↔ `HTDemucsTransformer.swift`，`model.rs` ↔
//! `HTDemucs.swift`，`separator.rs` ↔ `HTDemucsSeparator.swift`（bag 加载、窗口切分、逐声部推理）。
//! STFT 部分在 `super::stft`（CPU realfft），窗口调度在 `super::segment`。
//!
//! 模型图只用一小套张量词汇（`tensor`）。与 v2 一样，同一份图对着两套词汇编译：[`mlx`] 用 mlx-rs，[`candle`] 用
//! v2 的 candle 适配层（`tensor/candle.rs`，只在卷积边界换布局）。v2 是二选一；这里两个后端可以编进同一个构建
//! （macOS 上开 `backend-candle`），所以各编一份、互不影响。

#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
pub mod mlx;

#[cfg(feature = "backend-candle")]
pub mod candle;
