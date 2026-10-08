//! Confetti 算法粒子元素的绘制内核（`docs/design/elements/bcut-confetti-element-design.md` §4–§5）。
//!
//! 三个子模块各守一件事：
//!
//! * [`kernel`]——`confetti-v1` 闭式运动核：参数 → 粒子表，纯函数、无状态；
//! * [`shapes`]——十二种单位形的路径；
//! * [`draw`]——[`draw::confetti_frame`]：把粒子表压成 `ClipPath + FillPath × N + PopClip`。
//!
//! 与 visualizer / progress 同一条纪律：**一个样式参数都不自带**，十款配方的
//! 数字住在 `core/presets/builtin/confetti/*.json`。

pub mod draw;
pub mod kernel;
pub mod shapes;

pub use draw::{
    ConfettiBox, ConfettiEmitOverride, ConfettiParams, confetti_frame, confetti_particles,
};
pub use kernel::{EmitMode as ConfettiEmitMode, splitmix64_unit};
pub use shapes::{ConfettiShape, unit_path as confetti_unit_path};
