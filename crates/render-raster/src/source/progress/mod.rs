//! progress 元素的绘制（元素方案 §7.4）。
//!
//! progress **没有素材源**：它的内容完全由播放头推导，是
//! `progress = clamp((t − start) / (end − start), 0, 1)` 的纯函数
//! （真相在 `bcut_timeline::geometry::progress_at`；`bcut-render` 不依赖
//! `bcut-timeline`，所以由 host 算好传进来，与 [`crate::source::VisualizerParams`]
//! 的做法一致）。因此本模块与隔壁的 `visualizer` 不同——它**没有 trait**，
//! 只有一个纯绘制函数 [`progress_frame`]。
//!
//! P3 落地 6 种：`bar-v1`（`normal` / `rounded`）、`frame-v1`
//! （`border` / `reverse_border`）、`ring-v1`（`circle` / `donut`）；
//! P4 落地 `snake-v1`（`snake` / `snake_spin`），rainbow / strobe 四种是 P5。

pub mod draw;
pub(crate) mod recipes;

pub use draw::{ProgressBox, ProgressParams, progress_frame};
