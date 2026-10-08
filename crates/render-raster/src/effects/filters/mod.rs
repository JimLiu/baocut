//! Strict CPU 参考滤镜（ADR-M05）。
//!
//! 从 `core/crates/bcut-kernel/src/cmd/studio_export/raster.rs` 逐行搬运过来的部分**位精确**
//! （模糊、颜色调整、SDF 遮罩、水平擦除、预乘合成），新增的部分（对比度、
//! 饱和度、sepia、hueRotate、色键、alpha 阈值、图像遮罩）沿用同一套约定：
//! 预乘 sRGB / u8、反预乘到 f64 运算、clamp 后乘回 alpha 并 `round()`。

pub mod alpha_threshold;
pub mod bloom;
pub mod blur;
pub mod chroma_key;
pub mod color_adjust;
pub mod composite_premul;
pub mod drop_shadow;
pub mod god_rays;
pub mod grade;
pub mod mask_image;
pub mod mask_shape;
pub mod radial_blur;
pub mod reveal;
pub mod stylize;

pub mod studio;
