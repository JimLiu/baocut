//! visualizer 的绘制配方（设计 §7.2 的封闭算法名，一个算法名一个模块）。
//!
//! 2026-09 重设计后声波是 **10 款样式 / 7 个算法名**，全部是 CPU 矢量配方
//! （`determinism: strict`，`shader: null`）：
//!
//! | 算法名 | 样式 | 读什么 |
//! | --- | --- | --- |
//! | [`spectrum_bars_v1`] | `bars` / `bars_rounded` / `bars_bottom` | 频域行 |
//! | [`polar_bars_v1`] | `ring_bars` | 频域行 |
//! | [`oscilloscope_v1`] | `oscilloscope` / `ring_wave` | **时域行** |
//! | [`spectrum_area_v1`] | `spectrum_area` | 频域行 |
//! | [`dot_matrix_v1`] | `dots` | 频域行 |
//! | [`pulse_rings_v1`] | `pulse_rings` | 频域行（分频带） |
//! | [`ribbons_v1`] | `ribbons` | 频域行（分频带）+ **时钟** |
//!
//! 同一算法名下的样式**全靠 manifest 参数区分**，Rust 侧一份实现；跨算法共用的
//! 采样 / 压 path 助手在 [`common`]，几何公式在 [`crate::source::kernel`]。

pub(crate) mod common;
pub(crate) mod dot_matrix_v1;
pub(crate) mod oscilloscope_v1;
pub(crate) mod polar_bars_v1;
pub(crate) mod pulse_rings_v1;
pub(crate) mod ribbons_v1;
pub(crate) mod spectrum_area_v1;
pub(crate) mod spectrum_bars_v1;
