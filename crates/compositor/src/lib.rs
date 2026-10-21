//! BaoCut 实时 GPU 合成器。
//!
//! 这个 crate 消费既有 [`render_raster::ShaderQuad`]，把输出直接编码到宿主提供的
//! `TextureView`。它不创建窗口、不读文件、不解码视频，也不在实时路径回读像素。
//! CPU tiny-skia 仍是 strict reference；本 crate 初始化或执行失败时由宿主回退。

mod atlas;
mod device_hairline;
mod retained_draw;
mod scheduler;
#[cfg(any(feature = "gpu", feature = "gpu-webgpu", feature = "gpu-webgl"))]
#[path = "stroke-coverage.rs"]
mod stroke_coverage;
pub use retained_draw::RetainedDrawCache;

pub use atlas::{AtlasPrepare, AtlasRect, GlyphAtlas, GlyphAtlasStats, GlyphRequest};
pub use scheduler::{DirtyReason, FrameScheduler};
pub use timeline_render::{
    BlurredGroup, GLYPH_RUN_UNIFORM_LIMIT, GlyphCompositeMode, GlyphEffect, GlyphInstance, GlyphKey, GlyphMask, GlyphPaint, GlyphPixels,
    GlyphRun, GlyphRunUniform, RoundedRectNode, SCENE_BLUR_RADIUS_LIMIT, SCENE_GLYPH_STROKE_WIDTH_LIMIT, SceneCompositeMode,
    SceneCurveSolver, SceneFrame, SceneMotion, SceneNode, ScenePose, post_concat_mat6,
};

#[cfg(any(feature = "gpu", feature = "gpu-webgpu", feature = "gpu-webgl"))]
mod gpu;
#[cfg(feature = "gpu")]
mod offline;
#[cfg(any(feature = "gpu", feature = "gpu-webgpu", feature = "gpu-webgl"))]
pub use gpu::{
    CaptionGpuRenderer, CaptionGpuStats, ComponentRenderer, Compositor, ExternalTextureDescriptor, ExternalTextureImporter, GlowRenderer,
    GlyphRendererStats, ImportedExternalTexture, NoisySweepRenderer, RenderStats, RenderTarget, RenderTextureTarget,
    RoundedRectRendererStats, TexturePool, VectorRendererStats,
};
#[cfg(feature = "gpu")]
pub use offline::{OfflineCompositor, OfflineTimings};
