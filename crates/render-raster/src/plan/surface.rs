//! Surface 与 Composite 输入（设计 §6.1）。

use crate::drawop::Color4;
use motion::effect::{BlendMode, ColorContract};

/// Surface 标识。`FramePlan::surfaces` 按 id 升序排列（`validate` 守住）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SurfaceId(pub u32);

impl SurfaceId {
    /// 折叠计划里唯一那张输出 surface。
    pub const OUTPUT: SurfaceId = SurfaceId(0);
}

/// Surface 的生命周期。
///
/// * `Static` —— 允许跨帧留存（转场两侧、静止背景板）；
/// * `PerFrame` —— 每帧重建；
/// * `External` —— **内容由调用方直接提供**，计划里没有产出它的 pass。
///   用于「已经有一张画好的 pixmap，要对它跑一条效果链」：直接把它当输入，
///   而不是先 blit 进一张 surface（blit 有可能改字节）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum SurfaceLifetime {
    Static,
    #[default]
    PerFrame,
    External,
}

impl SurfaceLifetime {
    pub fn code(self) -> u8 {
        match self {
            SurfaceLifetime::Static => 0,
            SurfaceLifetime::PerFrame => 1,
            SurfaceLifetime::External => 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SurfacePlan {
    pub id: SurfaceId,
    pub width: u32,
    pub height: u32,
    pub color: ColorContract,
    /// 执行前的清屏色（非预乘 RGBA 0..1）。`None` = 全透明零缓冲。
    pub clear: Option<Color4>,
    pub lifetime: SurfaceLifetime,
}

impl SurfacePlan {
    /// 画布尺寸的每帧 sRGB/u8 surface——v1 唯一在用的形状。
    pub fn canvas(id: SurfaceId, width: u32, height: u32) -> Self {
        SurfacePlan {
            id,
            width,
            height,
            color: ColorContract::SRGB_U8,
            clear: None,
            lifetime: SurfaceLifetime::PerFrame,
        }
    }

    /// 调用方直接供图的画布尺寸 surface。
    pub fn external(id: SurfaceId, width: u32, height: u32) -> Self {
        SurfacePlan {
            lifetime: SurfaceLifetime::External,
            ..SurfacePlan::canvas(id, width, height)
        }
    }

    pub fn bytes(&self) -> usize {
        self.width as usize * self.height as usize * 4
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompositeInput {
    pub surface: SurfaceId,
    pub blend: BlendMode,
    pub opacity: f32,
    /// 可选 alpha 遮罩 surface（阶段 4B 的 `mask.*` 用）。
    pub mask: Option<SurfaceId>,
}

impl CompositeInput {
    pub fn opaque(surface: SurfaceId) -> Self {
        CompositeInput {
            surface,
            blend: BlendMode::Normal,
            opacity: 1.0,
            mask: None,
        }
    }
}
