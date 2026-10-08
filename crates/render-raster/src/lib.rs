/*!
 * bcut-render —— host 侧：资源加载（sha256 校验 / 图像解码 / 媒体探测）、
 * 文本引擎（cosmic-text，支持文档字体 strict 模式）、DrawOp 帧指令 IR
 * （确定性二进制编码 + 指纹）、tiny-skia 光栅化重放、媒体帧供给
 * （video 顺序解码）、音频混音、ffmpeg 管道 MP4 合成。
 * core 保持无 I/O，此 crate 拥有全部字节与进程。
 */

// ── 元素方案 §9.1 / §10 P6a 的 feature 门禁。
//
// 门开在 **`target_arch = "wasm32"`** 上而不是「`wasm-safe` 与 `media` 互斥」
// 上，理由是 cargo 的 **feature unification**：`cargo build --workspace` 会把
// `apps/cli`（要 `media`）和 `bcut-wasm`（要 `wasm-safe`）对同一个
// `bcut-render` 的 feature 取并集，纯 feature 级的互斥断言会把整个 workspace
// 构建判死——而那次构建里根本没有 wasm 目标，两个 feature 并存无害
// （`media` 是超集，`wasm-safe` 自己不打开任何东西）。
//
// 真正要防的事只有一件：**别把 ffmpeg 子进程 / host SVG 解码编进浏览器**。
// BCF 文档的布局、录制和帧计划是无 I/O 的共享实现，WASM 同样可用。
#[cfg(all(target_arch = "wasm32", feature = "media"))]
compile_error!(
    "wasm32 目标不得打开 bcut-render 的 `media`（ffmpeg 子进程 / host resvg）：\
     用 `--no-default-features --features wasm-safe`"
);
#[cfg(all(target_arch = "wasm32", feature = "gpu"))]
compile_error!(
    "wasm32 目标不得打开 bcut-render 的 native `gpu`；R3 浏览器产物请用 \
     `gpu-webgpu` / `gpu-webgl`（两者合开即 `gpu-web`）"
);

// v3：`program` 与 GPU 的依赖没有声明（见 Cargo.toml 文件头），feature 只是占位。
// 打开它们时在这里给出可读的原因，而不是一串「找不到 crate」。
#[cfg(feature = "program")]
compile_error!(
    "render-raster 的 `program` 不可用：它要的 bcut-compile（BCF 编译，oxc + rquickjs）\
     不移植（架构设计 §13.6），v3 的代码画面走代码包（§8）"
);
#[cfg(any(feature = "gpu-runtime", feature = "wgsl-validate"))]
compile_error!(
    "render-raster 的 GPU feature 尚不可用：wgpu / naga / pollster 待 GPU 合成那一批引入"
);

#[cfg(feature = "media")]
pub mod assets;
#[cfg(feature = "media")]
pub mod audio;
pub mod bcf;
pub mod drawop;
pub mod effects;
#[cfg(feature = "media")]
pub mod exec;
pub mod fonts;
pub mod imgcmp;
#[cfg(feature = "media")]
pub mod media;
pub mod motion_blur;
pub mod plan;
#[cfg(feature = "program")]
pub mod program;
// 不开 `program` 时 `program` 资产在加载期就报错，`LoadedAssets::programs` 恒为空：这里只留一个
// 无值的 `ProgramSource`，帧供给（`media.rs`）里查 `programs` 的分支原样编译、永远不命中。
#[cfg(all(feature = "media", not(feature = "program")))]
#[path = "program_absent.rs"]
pub mod program;
pub mod raster;
pub mod renderer;
pub mod source;
#[cfg(feature = "svg")]
pub mod svg;
#[cfg(feature = "media")]
pub mod video;

#[cfg(feature = "media")]
pub use assets::{LoadedAssets, load_assets, load_assets_with_vars};
pub use bcf::{BcfFrameWorker, PreparedBcf, SharedBcf};
pub use drawop::{FrameOps, decode, encode, fingerprint};
pub use fonts::{
    GlyphAtlasRender, GlyphColorImage, GlyphMaskImage, GlyphRender, TextEngine, warm_system_fonts,
};
#[cfg(feature = "media")]
pub use media::MediaStore;
#[cfg(feature = "gpu-runtime")]
pub use plan::GpuExecutor;
#[cfg(feature = "wgsl-validate")]
pub use plan::validate_wgsl;
pub use plan::{
    AudioTexture, CapabilityProfile, CpuExecutor, EffectRef, FRAME_PLAN_VERSION, FallbackRecord,
    FramePlan, FramePlanner, GpuBackendReport, GpuFallbackReason, GpuFallbackRecord, PassExecutor,
    PreflightDiagnostic, PreflightReport, QuadUniforms, RenderPass, ShaderDomain, ShaderQuad,
    ShaderSource, SurfaceCache, SurfaceId, SurfaceLifetime, SurfacePlan, execute_plan,
    execute_plan_with_fingerprints, execute_plan_with_inputs, shader_for,
};

/// naga 的转出口（`wgsl-validate` feature，`gpu` 带着它）。
///
/// shader 的静态校验测试住在 `tests/`，而 Cargo 的 dev-dependencies 没法跟着
/// 本 crate 的 feature 走；从这里转出去，测试就与库用同一个 naga 版本——
/// 校验和转译目标不会因为两处版本漂移而对不上。
#[cfg(feature = "wgsl-validate")]
pub use naga;
pub use raster::{FrameMedia, rasterize_with_media};
pub use source::{
    AnimatedImage, ContentHash, MediaTime, PrepareCtx, SourceFrame, SourceKind, SourceLoop,
    SourceMetadata, VisualSource,
};

/// 字幕入场姿态配方（`transition.caption.*@1`）的转出口。与 `effects` 里那两个
/// 值类型同一个理由：host 侧（`apps/cli`）只依赖 `bcut-render`，不必为了取一份
/// 配方再连一条 `bcut-motion` 的边。
pub use motion::preset_registry::{
    CaptionChannel, CaptionTransitionRecipe, caption_transition, caption_transitions,
};
pub use renderer::{FrameLayer, FrameRenderer, RecordedFrame};
