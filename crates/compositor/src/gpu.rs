use std::collections::HashMap;
#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;

use anyhow::{Result, bail};
use render_raster::GpuExecutor;
use timeline_render::{SceneCompositeMode, TextureBackground, TextureEffect, TextureFit, TextureMaskShape, TextureNode};

use crate::{SceneFrame, SceneNode};

mod associated_quad;
mod blur;
mod caption;
#[path = "gpu/draw-source.rs"]
mod draw_source;
#[path = "gpu/linear-paint.rs"]
mod linear_paint;
mod noisy;
#[path = "gpu/stroke-replay.rs"]
mod stroke_replay;
pub use caption::{CaptionGpuRenderer, CaptionGpuStats};
pub use noisy::NoisySweepRenderer;
mod component;
#[path = "gpu/material-support.rs"]
mod material_support;
pub use component::ComponentRenderer;
mod affine;
pub use affine::AffineSampleRenderer;
mod glow;
mod glyph;
pub use glow::GlowRenderer;
mod rounded_rect;
mod source_effect;
mod target_composite;
mod texture;
mod vector;
use blur::BlurRenderer;
use glyph::GlyphRenderer;
use rounded_rect::RoundedRectRenderer;
use source_effect::SourceEffectRenderer;
use target_composite::TargetCompositeRenderer;
use texture::TextureRenderer;
use vector::VectorRenderer;

fn scene_blend_state(composite: SceneCompositeMode) -> wgpu::BlendState {
    match composite {
        SceneCompositeMode::Normal => wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING,
        // 对预乘 source S=As*Cs，W3C screen source-over 可化简为
        // S + D*(1-S)。alpha 仍是普通 source-over；无需采样目标纹理。
        SceneCompositeMode::Screen => wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::OneMinusSrc,
                operation: wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                operation: wgpu::BlendOperation::Add,
            },
        },
        SceneCompositeMode::Difference | SceneCompositeMode::Exclusion => {
            unreachable!("target-sampling composite 不使用 fixed-function blend")
        }
    }
}

/// `std::time::Instant` 在裸 `wasm32-unknown-unknown` 上会直接 panic；浏览器
/// 的提交耗时由 JS host 的 `performance.now()` 量，合成器统计在该目标上记 0。
/// native 继续保留精确 encode 计时，不为 Web 额外引入一套时钟依赖。
struct EncodeTimer {
    #[cfg(not(target_arch = "wasm32"))]
    started: Instant,
}

impl EncodeTimer {
    fn start() -> Self {
        Self {
            #[cfg(not(target_arch = "wasm32"))]
            started: Instant::now(),
        }
    }

    fn elapsed_ms(&self) -> f64 {
        #[cfg(not(target_arch = "wasm32"))]
        {
            return self.started.elapsed().as_secs_f64() * 1_000.0;
        }
        #[cfg(target_arch = "wasm32")]
        {
            0.0
        }
    }
}

/// 宿主提供的目标；必须与创建 [`Compositor`] 的 device 属于同一设备。
pub struct RenderTarget<'a> {
    pub view: &'a wgpu::TextureView,
    pub width: u32,
    pub height: u32,
    pub format: wgpu::TextureFormat,
}

/// 显式携带底层纹理的目标。只有这条入口可以执行需要复制并采样真实 backdrop 的
/// `Difference` / `Exclusion`；纹理必须与 `view` 指向同一资源并声明 `COPY_SRC`。
pub struct RenderTextureTarget<'a> {
    pub texture: &'a wgpu::Texture,
    pub view: &'a wgpu::TextureView,
    pub width: u32,
    pub height: u32,
    pub format: wgpu::TextureFormat,
}

struct PresentTarget<'a> {
    target: RenderTarget<'a>,
    source_generation: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RenderStats {
    pub nodes: usize,
    pub submissions: usize,
    pub binding_rebuilds: u64,
    pub encode_ms: f64,
}

/// glyph 实时路径的累计诊断计数。稳定场景的逐词/入场更新应只增加
/// `uniform_writes`，不得增加 `geometry_writes`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GlyphRendererStats {
    pub atlas: crate::GlyphAtlasStats,
    pub color_atlas: crate::GlyphAtlasStats,
    pub geometry_writes: u64,
    pub uniform_writes: u64,
}

/// vector retained scene 的累计诊断计数。连续 pose motion 只能增加
/// `uniform_writes`；只有 `Arc<FrameOps>` 身份变化才允许重新 tessellate 并增加
/// `geometry_writes`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VectorRendererStats {
    pub geometry_writes: u64,
    pub uniform_writes: u64,
}

/// 程序化圆角矩形没有逐节点几何上传；每个活跃节点每帧只写一份 uniform。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoundedRectRendererStats {
    pub uniform_writes: u64,
}

/// 平台外部纹理导入面。CoreVideo / DXGI / Web external texture 的具体句柄只在
/// 宿主实现里出现，合成器本身不认识任何平台类型。
pub trait ExternalTextureImporter {
    type Handle;
    /// 阻止平台解码器在 GPU 仍采样时复用 backing surface。
    type Lease: Send + 'static;

    fn import(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        handle: &Self::Handle,
        descriptor: ExternalTextureDescriptor,
    ) -> Result<ImportedExternalTexture<Self::Lease>>;
}

pub struct ImportedExternalTexture<L> {
    pub texture: wgpu::Texture,
    pub lease: L,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExternalTextureDescriptor {
    pub width: u32,
    pub height: u32,
    pub format: wgpu::TextureFormat,
    pub usage: wgpu::TextureUsages,
}

/// 小型持久纹理池。只接纳尺寸/格式/usage 完全一致的纹理；宿主 resize 后旧规格
/// 按规格和总字节数同时限额，resize 不会积累无限多种闲置规格。
pub struct TexturePool {
    device: wgpu::Device,
    max_per_key: usize,
    max_idle_bytes: u64,
    idle_bytes: u64,
    idle: HashMap<TextureKey, Vec<wgpu::Texture>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct TextureKey {
    width: u32,
    height: u32,
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
    sample_count: u32,
}

impl TextureKey {
    fn bytes(self) -> u64 {
        let (block_width, block_height) = self.format.block_dimensions();
        u64::from(self.width.div_ceil(block_width))
            .saturating_mul(u64::from(self.height.div_ceil(block_height)))
            .saturating_mul(u64::from(self.format.block_copy_size(None).unwrap_or(16)))
            .saturating_mul(u64::from(self.sample_count))
    }
}

impl TexturePool {
    pub fn new(device: wgpu::Device, max_per_key: usize) -> Self {
        Self::with_idle_budget(device, max_per_key, 64 * 1024 * 1024)
    }

    /// Bounds cached idle textures across all resize keys (not live attachments).
    pub fn with_idle_budget(device: wgpu::Device, max_per_key: usize, bytes: u64) -> Self {
        Self {
            device,
            max_per_key: max_per_key.max(1),
            max_idle_bytes: bytes,
            idle_bytes: 0,
            idle: HashMap::new(),
        }
    }

    pub fn acquire(
        &mut self,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
        usage: wgpu::TextureUsages,
        sample_count: u32,
    ) -> wgpu::Texture {
        let key = TextureKey {
            width: width.max(1),
            height: height.max(1),
            format,
            usage,
            sample_count: sample_count.max(1),
        };
        if let Some(texture) = self.idle.get_mut(&key).and_then(Vec::pop) {
            self.idle_bytes = self.idle_bytes.saturating_sub(key.bytes());
            if self.idle.get(&key).is_some_and(Vec::is_empty) {
                self.idle.remove(&key);
            }
            return texture;
        }
        self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("bcut.compositor.pool"),
            size: wgpu::Extent3d {
                width: key.width,
                height: key.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: key.sample_count,
            dimension: wgpu::TextureDimension::D2,
            format: key.format,
            usage: key.usage,
            view_formats: &[],
        })
    }

    pub fn recycle(
        &mut self,
        texture: wgpu::Texture,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
        usage: wgpu::TextureUsages,
        sample_count: u32,
    ) {
        // A stale host descriptor must neither poison reuse nor undercount bytes.
        if texture.width() != width
            || texture.height() != height
            || texture.format() != format
            || texture.usage() != usage
            || texture.sample_count() != sample_count
        {
            return;
        }
        let key = TextureKey {
            width: width.max(1),
            height: height.max(1),
            format,
            usage,
            sample_count: sample_count.max(1),
        };
        let bytes = key.bytes();
        if bytes > self.max_idle_bytes {
            return;
        }
        if self.idle_bytes.saturating_add(bytes) > self.max_idle_bytes {
            self.idle.clear();
            self.idle_bytes = 0;
        }
        let entries = self.idle.entry(key).or_default();
        if entries.len() < self.max_per_key {
            self.idle_bytes += bytes;
            entries.push(texture);
        }
    }

    pub fn idle_bytes(&self) -> u64 {
        self.idle_bytes
    }

    pub fn idle_len(&self) -> usize {
        self.idle.values().map(Vec::len).sum()
    }
}

/// 持久 pipeline/bind-layout/纹理池的实时执行器。整帧的所有 scene node 编进
/// 同一个 command encoder，只做一次 queue submit。
pub struct Compositor {
    quad: GpuExecutor,
    vector: VectorRenderer,
    glyph: GlyphRenderer,
    rounded_rect: RoundedRectRenderer,
    texture: TextureRenderer,
    source_effect: SourceEffectRenderer,
    blur: BlurRenderer,
    target_composite: TargetCompositeRenderer,
    textures: TexturePool,
    pending_external_leases: Vec<Box<dyn Send>>,
}

#[derive(Default)]
struct EncodeSlots {
    quad: usize,
    vector: usize,
    glyph: usize,
    rounded_rect: usize,
    texture: usize,
    source_effect_output: usize,
    source_effect_pass: usize,
    blur: usize,
    target_composite: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct PreparedTextureKey {
    texture: String,
    source_width: u32,
    source_height: u32,
    source_effects: Vec<PreparedTextureEffectKey>,
    kind: PreparedTextureKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum PreparedTextureEffectKey {
    ColorAdjust(u32, u32),
    Grayscale(u32),
    Brightness(u32),
    Contrast(u32),
    Saturation(u32),
    Sepia(u32),
    HueRotate(u32),
    Invert(u32),
    Blur(u32),
    Sharpen(u32),
    Noise(u32),
    Vignette(u32),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum PreparedTextureKind {
    SourceEffects,
    ContainBlur { width: u32, height: u32 },
}

#[derive(Clone)]
struct PreparedTexture {
    binding_key: String,
    generation: u64,
    view: wgpu::TextureView,
}

impl Compositor {
    pub fn from_device(device: wgpu::Device, queue: wgpu::Queue, backend: impl Into<String>, adapter_name: impl Into<String>) -> Self {
        let textures = TexturePool::new(device.clone(), 2);
        let vector = VectorRenderer::new(device.clone(), queue.clone());
        let glyph = GlyphRenderer::new(device.clone(), queue.clone());
        let rounded_rect = RoundedRectRenderer::new(device.clone(), queue.clone());
        let texture = TextureRenderer::new(device.clone(), queue.clone());
        let source_effect = SourceEffectRenderer::new(device.clone(), queue.clone());
        let blur = BlurRenderer::new(device.clone(), queue.clone());
        let target_composite = TargetCompositeRenderer::new(device.clone());
        let quad = GpuExecutor::from_device(device, queue, backend, adapter_name);
        Self {
            quad,
            vector,
            glyph,
            rounded_rect,
            texture,
            source_effect,
            blur,
            target_composite,
            textures,
            pending_external_leases: Vec::new(),
        }
    }

    pub fn device(&self) -> &wgpu::Device {
        self.quad.device()
    }

    pub fn queue(&self) -> &wgpu::Queue {
        self.quad.queue()
    }

    pub fn textures(&mut self) -> &mut TexturePool {
        &mut self.textures
    }

    /// 宿主纹理上传目标。Web 在可见节点提交前用
    /// `copy_external_image_to_texture` 写入；native host 可用平台 importer 或
    /// `Queue::write_texture` 写入。尺寸变化会换代并让对应 bind group 失效一次。
    pub fn external_texture_target(&mut self, key: &str, width: u32, height: u32) -> Result<&wgpu::Texture> {
        self.texture.target(key, width, height)
    }

    /// 让宿主把平台共享句柄包装成 wgpu 纹理并注册为 scene texture。
    ///
    /// importer 同时拿到 queue，是因为 DX12 共享纹理在采样前必须把 shared
    /// fence wait 排到**下一次** submit 前；CPU wait 会阻塞 UI，且不满足实时路径
    /// 零回读/零停顿契约。平台句柄与同步原语仍只出现在宿主实现中。
    pub fn import_external_texture<I: ExternalTextureImporter>(
        &mut self,
        key: &str,
        importer: &mut I,
        handle: &I::Handle,
        descriptor: ExternalTextureDescriptor,
    ) -> Result<()> {
        let imported = importer.import(self.quad.device(), self.quad.queue(), handle, descriptor)?;
        self.texture.install(key, imported.texture, descriptor)?;
        self.pending_external_leases.push(Box::new(imported.lease));
        Ok(())
    }

    /// 把 host 已解码的 premultiplied RGBA8 帧写进持久外部纹理槽。native 离屏
    /// 导出与测试走此入口；Web 仍用 `copyExternalImageToTexture` 直接拉浏览器源。
    pub fn upload_external_rgba(&mut self, key: &str, width: u32, height: u32, rgba: &[u8]) -> Result<()> {
        let expected = u64::from(width)
            .checked_mul(u64::from(height))
            .and_then(|pixels| pixels.checked_mul(4))
            .and_then(|bytes| usize::try_from(bytes).ok())
            .ok_or_else(|| anyhow::anyhow!("gpu-texture-source-too-large: {width}x{height}"))?;
        if rgba.len() != expected {
            bail!(
                "gpu-texture-source-bytes-invalid: {key:?} {width}x{height} expected={expected} actual={}",
                rgba.len()
            );
        }
        let row_bytes = width
            .checked_mul(4)
            .ok_or_else(|| anyhow::anyhow!("gpu-texture-source-too-wide: {width}"))?;
        let queue = self.quad.queue().clone();
        let texture = self.external_texture_target(key, width, height)?;
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            rgba,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row_bytes),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        Ok(())
    }

    pub fn remove_external_texture(&mut self, key: &str) {
        self.texture.remove(key);
    }

    pub fn glyph_atlas_stats(&self) -> crate::GlyphAtlasStats {
        self.glyph.atlas_stats()
    }

    pub fn color_glyph_atlas_stats(&self) -> crate::GlyphAtlasStats {
        self.glyph.color_atlas_stats()
    }

    pub fn glyph_renderer_stats(&self) -> GlyphRendererStats {
        GlyphRendererStats {
            atlas: self.glyph.atlas_stats(),
            color_atlas: self.glyph.color_atlas_stats(),
            geometry_writes: self.glyph.geometry_writes(),
            uniform_writes: self.glyph.uniform_writes(),
        }
    }

    pub fn vector_renderer_stats(&self) -> VectorRendererStats {
        VectorRendererStats {
            geometry_writes: self.vector.geometry_writes(),
            uniform_writes: self.vector.uniform_writes(),
        }
    }

    pub fn rounded_rect_renderer_stats(&self) -> RoundedRectRendererStats {
        RoundedRectRendererStats {
            uniform_writes: self.rounded_rect.uniform_writes(),
        }
    }

    /// 直接写调用方 target；函数体没有 COPY_SRC / MAP_READ / `map_async`。
    pub fn render(&mut self, scene: &SceneFrame, target: RenderTarget<'_>) -> Result<RenderStats> {
        self.render_with_time(scene, target, None, None, true, None)
    }

    /// 复用同一 scene，在显示刷新时刻只重采样合成期 motion。调用方必须在
    /// `scene.active_until` / `next_change` 边界重新求值，不能让离散词状态越界。
    pub fn render_at(&mut self, scene: &SceneFrame, target: RenderTarget<'_>, presentation_time: f64) -> Result<RenderStats> {
        if !presentation_time.is_finite() {
            bail!("compositor-presentation-time-invalid: {presentation_time}");
        }
        self.render_with_time(scene, target, None, Some(presentation_time), true, None)
    }

    /// 在宿主已经填好的 target 上做 premultiplied source-over，不清除底图。
    ///
    /// AVFoundation / Media Foundation 可先把平台解码帧放进编码 surface，再让
    /// compositor 直接写同一 surface；实时预览也可用它把 overlay 叠到宿主舞台。
    /// 这条入口与 [`Self::render_at`] 一样只有一次 submit，且不包含任何回读。
    pub fn render_over_at(&mut self, scene: &SceneFrame, target: RenderTarget<'_>, presentation_time: f64) -> Result<RenderStats> {
        if !presentation_time.is_finite() {
            bail!("compositor-presentation-time-invalid: {presentation_time}");
        }
        self.render_with_time(scene, target, None, Some(presentation_time), false, None)
    }

    /// 清空并直接写入显式纹理目标。与 [`Self::render_at`] 相同，但允许 scene 的
    /// 顶层 group 读取 target backdrop；实时路径仍只有一次 queue submit。
    pub fn render_texture_at(
        &mut self,
        scene: &SceneFrame,
        target: RenderTextureTarget<'_>,
        presentation_time: f64,
    ) -> Result<RenderStats> {
        if !presentation_time.is_finite() {
            bail!("compositor-presentation-time-invalid: {presentation_time}");
        }
        let RenderTextureTarget {
            texture,
            view,
            width,
            height,
            format,
        } = target;
        self.render_with_time(
            scene,
            RenderTarget {
                view,
                width,
                height,
                format,
            },
            Some(texture),
            Some(presentation_time),
            true,
            None,
        )
    }

    /// 在宿主预填的显式纹理上合成。`Difference` / `Exclusion` 先在同一 encoder
    /// 内复制当前 target，再用全屏 pass 写回；不做 CPU 回读。
    pub fn render_over_texture_at(
        &mut self,
        scene: &SceneFrame,
        target: RenderTextureTarget<'_>,
        presentation_time: f64,
    ) -> Result<RenderStats> {
        if !presentation_time.is_finite() {
            bail!("compositor-presentation-time-invalid: {presentation_time}");
        }
        let RenderTextureTarget {
            texture,
            view,
            width,
            height,
            format,
        } = target;
        self.render_with_time(
            scene,
            RenderTarget {
                view,
                width,
                height,
                format,
            },
            Some(texture),
            Some(presentation_time),
            false,
            None,
        )
    }

    /// 在可采样中间 target 中完成整帧 scene，再在同一 encoder 内把结果
    /// 绘制到不支持 `COPY_SRC` 的展示 surface。WebGL2 swap-chain 只允许
    /// `RENDER_ATTACHMENT`，Difference / Exclusion 因而必须经这条单 encoder /
    /// 单 submit 路径，不能向 surface 强行申请不支持的 usage。
    /// `source_generation` 由持有中间纹理的宿主在资源替换时递增，
    /// 稳定帧不重建 present bind group。
    pub fn render_texture_to_view_at(
        &mut self,
        scene: &SceneFrame,
        target: RenderTextureTarget<'_>,
        present: RenderTarget<'_>,
        presentation_time: f64,
        source_generation: u64,
    ) -> Result<RenderStats> {
        if !presentation_time.is_finite() {
            bail!("compositor-presentation-time-invalid: {presentation_time}");
        }
        if target.width != present.width || target.height != present.height {
            bail!(
                "compositor-present-target-size-mismatch: scene={}x{} present={}x{}",
                target.width,
                target.height,
                present.width,
                present.height
            );
        }
        let RenderTextureTarget {
            texture,
            view,
            width,
            height,
            format,
        } = target;
        self.render_with_time(
            scene,
            RenderTarget {
                view,
                width,
                height,
                format,
            },
            Some(texture),
            Some(presentation_time),
            true,
            Some(PresentTarget {
                target: present,
                source_generation,
            }),
        )
    }

    fn render_with_time(
        &mut self,
        scene: &SceneFrame,
        target: RenderTarget<'_>,
        target_texture: Option<&wgpu::Texture>,
        presentation_time: Option<f64>,
        clear_target: bool,
        present_target: Option<PresentTarget<'_>>,
    ) -> Result<RenderStats> {
        let max_dimension = self.device().limits().max_texture_dimension_2d;
        if target.width == 0 || target.height == 0 || target.width > max_dimension || target.height > max_dimension {
            bail!("compositor-target-invalid: {}x{}", target.width, target.height);
        }
        if let Some(texture) = target_texture {
            let mut required = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC;
            if present_target.is_some() {
                required |= wgpu::TextureUsages::TEXTURE_BINDING;
            }
            if texture.width() != target.width
                || texture.height() != target.height
                || texture.format() != target.format
                || !texture.usage().contains(required)
            {
                bail!(
                    "compositor-texture-target-mismatch: texture={}x{} {:?} {:?}, target={}x{} {:?}, required={required:?}",
                    texture.width(),
                    texture.height(),
                    texture.format(),
                    texture.usage(),
                    target.width,
                    target.height,
                    target.format,
                );
            }
        }
        validate_scene_composites(&scene.nodes, target_texture.is_some(), 0)?;
        let started = EncodeTimer::start();
        let rebuilds_before = self.quad.live_binding_rebuilds()
            + self.glyph.binding_rebuilds()
            + self.blur.binding_rebuilds()
            + self.source_effect.binding_rebuilds()
            + self.target_composite.binding_rebuilds()
            + self.texture.binding_rebuilds();
        let mut encoder = self.quad.device().create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("bcut.compositor.frame.encoder"),
        });
        if scene.nodes.is_empty() && present_target.is_none() {
            if clear_target {
                encode_clear(&mut encoder, target.view);
            }
            self.quad.finish_live_frame(0);
            self.vector.finish_frame(0);
            self.glyph.finish_frame(0);
            self.rounded_rect.finish_frame(0);
            self.source_effect.finish_frame(0, 0);
            self.blur.finish_frame(0);
            self.target_composite.finish_frame(0);
            self.texture.finish_frame(0);
            self.quad.queue().submit(Some(encoder.finish()));
            self.retire_external_leases_after_submit();
            return Ok(RenderStats {
                nodes: 0,
                submissions: 1,
                binding_rebuilds: 0,
                encode_ms: started.elapsed_ms(),
            });
        }

        let mut slots = EncodeSlots::default();
        let mut prepared_textures = HashMap::new();
        self.encode_nodes(
            &scene.nodes,
            target.view,
            target.width,
            target.height,
            target.format,
            target_texture,
            clear_target,
            presentation_time,
            &mut slots,
            &mut prepared_textures,
            &mut encoder,
        )?;
        if let Some(present) = present_target {
            let node = TextureNode {
                texture: "\0bcut.present-target".to_owned(),
                media_ms: -1,
                source_width: target.width,
                source_height: target.height,
                rect: [0.0, 0.0, present.target.width as f32, present.target.height as f32],
                transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                opacity: 1.0,
                radius: 0.0,
                mask_shape: TextureMaskShape::RoundedRect,
                mask_feather: 0.0,
                source_effects: std::sync::Arc::from([]),
                reveal: 1.0,
                iris: 1.0,
                fit: TextureFit::Cover,
                background: TextureBackground::Transparent,
            };
            self.texture.encode_texture_view_to_view(
                slots.texture,
                &node,
                "\0bcut.present-target",
                present.source_generation,
                target.view,
                0.0,
                present.target.view,
                present.target.width,
                present.target.height,
                present.target.format,
                true,
                &mut encoder,
            )?;
            slots.texture += 1;
        }
        self.quad.finish_live_frame(slots.quad);
        self.vector.finish_frame(slots.vector);
        self.glyph.finish_frame(slots.glyph);
        self.rounded_rect.finish_frame(slots.rounded_rect);
        self.source_effect
            .finish_frame(slots.source_effect_output, slots.source_effect_pass);
        self.blur.finish_frame(slots.blur);
        self.target_composite.finish_frame(slots.target_composite);
        self.texture.finish_frame(slots.texture);
        self.quad.queue().submit(Some(encoder.finish()));
        self.retire_external_leases_after_submit();
        Ok(RenderStats {
            nodes: scene.nodes.len(),
            submissions: 1,
            binding_rebuilds: self.quad.live_binding_rebuilds()
                + self.glyph.binding_rebuilds()
                + self.blur.binding_rebuilds()
                + self.source_effect.binding_rebuilds()
                + self.target_composite.binding_rebuilds()
                + self.texture.binding_rebuilds()
                - rebuilds_before,
            encode_ms: started.elapsed_ms(),
        })
    }

    fn retire_external_leases_after_submit(&mut self) {
        if self.pending_external_leases.is_empty() {
            return;
        }
        let leases = std::mem::take(&mut self.pending_external_leases);
        self.quad.queue().on_submitted_work_done(move || drop(leases));
    }

    #[allow(clippy::too_many_arguments)]
    fn encode_nodes(
        &mut self,
        nodes: &[SceneNode],
        view: &wgpu::TextureView,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
        target_texture: Option<&wgpu::Texture>,
        mut clear_target: bool,
        presentation_time: Option<f64>,
        slots: &mut EncodeSlots,
        prepared_textures: &mut HashMap<PreparedTextureKey, PreparedTexture>,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<bool> {
        if nodes.is_empty() {
            if clear_target {
                encode_clear(encoder, view);
                clear_target = false;
            }
            return Ok(clear_target);
        }
        for node in nodes {
            match node {
                SceneNode::Vectors(frame) => {
                    self.vector.encode_to_view(
                        slots.vector,
                        frame,
                        view,
                        width,
                        height,
                        format,
                        clear_target,
                        crate::ScenePose::IDENTITY,
                        encoder,
                    )?;
                    slots.vector += 1;
                    clear_target = false;
                }
                SceneNode::AnimatedVectors { frame, pose, motion } => {
                    let pose = presentation_time
                        .and_then(|time| motion.as_ref().map(|motion| motion.sample(time)))
                        .unwrap_or(*pose);
                    self.vector
                        .encode_to_view(slots.vector, frame, view, width, height, format, clear_target, pose, encoder)?;
                    slots.vector += 1;
                    clear_target = false;
                }
                SceneNode::ShaderQuad { quad: source, transform } => {
                    let mut quad = source.as_ref().clone();
                    quad.transform = *transform;
                    self.quad
                        .encode_quad_to_view(slots.quad, &quad, view, format, clear_target, encoder)?;
                    slots.quad += 1;
                    clear_target = false;
                }
                SceneNode::Texture(node) => {
                    self.encode_texture_node(node, view, width, height, format, clear_target, slots, prepared_textures, encoder)?;
                    clear_target = false;
                }
                SceneNode::Glyphs(run) => {
                    self.glyph.encode_to_view(
                        slots.glyph,
                        run,
                        view,
                        width,
                        height,
                        format,
                        clear_target,
                        presentation_time,
                        encoder,
                    )?;
                    slots.glyph += 1;
                    clear_target = false;
                }
                SceneNode::RoundedRect(node) => {
                    self.rounded_rect.encode_to_view(
                        slots.rounded_rect,
                        node,
                        view,
                        width,
                        height,
                        format,
                        clear_target,
                        presentation_time,
                        encoder,
                    )?;
                    slots.rounded_rect += 1;
                    clear_target = false;
                }
                SceneNode::BlurredGlyphs(effect) => {
                    if effect.layers.is_empty() {
                        bail!("glyph-effect-empty");
                    }
                    let blur_slot = slots.blur;
                    slots.blur += 1;
                    let layer_view = self.blur.layer_view(blur_slot, width, height)?;
                    for (layer_index, run) in effect.layers.iter().enumerate() {
                        self.glyph.encode_to_view(
                            slots.glyph,
                            run,
                            &layer_view,
                            width,
                            height,
                            wgpu::TextureFormat::Rgba8Unorm,
                            layer_index == 0,
                            presentation_time,
                            encoder,
                        )?;
                        slots.glyph += 1;
                    }
                    self.blur.encode_to_view(
                        blur_slot,
                        effect.radius,
                        view,
                        width,
                        height,
                        format,
                        clear_target,
                        SceneCompositeMode::Normal,
                        encoder,
                    )?;
                    clear_target = false;
                }
                SceneNode::BlurredGroup(group) => {
                    let radius = presentation_time
                        .and_then(|time| group.motion.as_ref().map(|motion| motion.sample(time).blur))
                        .unwrap_or(group.radius)
                        .round()
                        .clamp(0.0, crate::SCENE_BLUR_RADIUS_LIMIT as f32) as u32;
                    let reveal = group.reveal.unwrap_or(1.0).clamp(0.0, 1.0);
                    let reveals_full_layer = reveal >= 1.0;
                    if radius == 0 && reveals_full_layer && group.composite == SceneCompositeMode::Normal {
                        clear_target = self.encode_nodes(
                            &group.nodes,
                            view,
                            width,
                            height,
                            format,
                            target_texture,
                            clear_target,
                            presentation_time,
                            slots,
                            prepared_textures,
                            encoder,
                        )?;
                        continue;
                    }
                    let blur_slot = slots.blur;
                    slots.blur += 1;
                    let (layer_view, layer_generation) = self.blur.layer_view_with_generation(blur_slot, width, height)?;
                    self.encode_nodes(
                        &group.nodes,
                        &layer_view,
                        width,
                        height,
                        wgpu::TextureFormat::Rgba8Unorm,
                        None,
                        true,
                        presentation_time,
                        slots,
                        prepared_textures,
                        encoder,
                    )?;
                    if matches!(group.composite, SceneCompositeMode::Difference | SceneCompositeMode::Exclusion) {
                        if clear_target {
                            encode_clear(encoder, view);
                        }
                        let (source_view, source_generation) = if radius == 0 && reveals_full_layer {
                            (layer_view, layer_generation)
                        } else {
                            let (result_view, result_generation) = self.blur.result_view(blur_slot, width, height)?;
                            if radius == 0 {
                                self.blur.encode_layer_to_view_with_reveal(
                                    blur_slot,
                                    reveal,
                                    &result_view,
                                    width,
                                    height,
                                    wgpu::TextureFormat::Rgba8Unorm,
                                    true,
                                    SceneCompositeMode::Normal,
                                    encoder,
                                )?;
                            } else {
                                self.blur.encode_to_view_with_reveal(
                                    blur_slot,
                                    radius,
                                    reveal,
                                    &result_view,
                                    width,
                                    height,
                                    wgpu::TextureFormat::Rgba8Unorm,
                                    true,
                                    SceneCompositeMode::Normal,
                                    encoder,
                                )?;
                            }
                            (result_view, result_generation)
                        };
                        self.target_composite.encode(
                            slots.target_composite,
                            group.composite,
                            target_texture.expect("scene composite 已预验证 target texture"),
                            view,
                            &source_view,
                            source_generation,
                            radius != 0 || !reveals_full_layer,
                            width,
                            height,
                            format,
                            encoder,
                        )?;
                        slots.target_composite += 1;
                    } else if radius == 0 {
                        self.blur.encode_layer_to_view_with_reveal(
                            blur_slot,
                            reveal,
                            view,
                            width,
                            height,
                            format,
                            clear_target,
                            group.composite,
                            encoder,
                        )?;
                    } else {
                        self.blur.encode_to_view_with_reveal(
                            blur_slot,
                            radius,
                            reveal,
                            view,
                            width,
                            height,
                            format,
                            clear_target,
                            group.composite,
                            encoder,
                        )?;
                    }
                    clear_target = false;
                }
            }
        }
        Ok(clear_target)
    }

    #[allow(clippy::too_many_arguments)]
    fn encode_texture_node(
        &mut self,
        node: &timeline_render::TextureNode,
        view: &wgpu::TextureView,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
        clear: bool,
        slots: &mut EncodeSlots,
        prepared_textures: &mut HashMap<PreparedTextureKey, PreparedTexture>,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        let source = self.prepare_source_texture(node, slots, prepared_textures, encoder)?;
        if node.background == TextureBackground::Blur {
            return self.encode_contain_blur_texture(
                node,
                source.as_ref(),
                view,
                width,
                height,
                format,
                clear,
                slots,
                prepared_textures,
                encoder,
            );
        }

        let mut final_node = node.clone();
        if source.is_some() {
            clear_texture_source_effects(&mut final_node);
        }
        self.encode_texture_source(
            &final_node,
            source.as_ref(),
            0.0,
            view,
            width,
            height,
            format,
            clear,
            slots,
            encoder,
        )
    }

    fn prepare_source_texture(
        &mut self,
        node: &timeline_render::TextureNode,
        slots: &mut EncodeSlots,
        prepared_textures: &mut HashMap<PreparedTextureKey, PreparedTexture>,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<Option<PreparedTexture>> {
        if node.source_effects.is_empty() {
            return Ok(None);
        }
        let key = prepared_texture_key(node, PreparedTextureKind::SourceEffects);
        if let Some(prepared) = prepared_textures.get(&key) {
            return Ok(Some(prepared.clone()));
        }
        let steps = source_effect_steps(&node.source_effects);
        let output_slot = slots.source_effect_output;
        slots.source_effect_output += 1;
        let (result_view, generation) = self.source_effect.output_view(output_slot, node.source_width, node.source_height)?;
        let scratch = if steps.len() > 1 {
            let (view, generation) = self.source_effect.scratch_view(node.source_width, node.source_height)?;
            Some(PreparedTexture {
                binding_key: format!("\0bcut.source-effect-scratch:{}x{}", node.source_width, node.source_height),
                generation,
                view,
            })
        } else {
            None
        };
        let (source_key, source_generation, source_view) = self.texture.source_view(node)?;
        let mut source = PreparedTexture {
            binding_key: source_key,
            generation: source_generation,
            view: source_view,
        };
        for (index, step) in steps.iter().enumerate() {
            let remaining = steps.len() - index;
            let target = if remaining % 2 == 1 {
                PreparedTexture {
                    binding_key: format!("\0bcut.source-effects:{output_slot}"),
                    generation,
                    view: result_view.clone(),
                }
            } else {
                scratch.as_ref().expect("多步 source effect 必须有 scratch").clone()
            };
            match *step {
                SourceEffectStep::Point { start, end } => {
                    self.source_effect.encode_to_view(
                        slots.source_effect_pass,
                        &node.source_effects[start..end],
                        &source.binding_key,
                        source.generation,
                        &source.view,
                        &target.view,
                        node.source_width,
                        node.source_height,
                        encoder,
                    )?;
                    slots.source_effect_pass += 1;
                }
                SourceEffectStep::Blur(radius) => {
                    self.blur.encode_source_to_view(
                        slots.blur,
                        radius,
                        &source.binding_key,
                        source.generation,
                        &source.view,
                        &target.view,
                        node.source_width,
                        node.source_height,
                        encoder,
                    )?;
                    slots.blur += 1;
                }
            }
            source = target;
        }
        let prepared = PreparedTexture {
            binding_key: format!("\0bcut.source-effects:{output_slot}"),
            generation,
            view: result_view,
        };
        prepared_textures.insert(key, prepared.clone());
        Ok(Some(prepared))
    }

    #[allow(clippy::too_many_arguments)]
    fn encode_contain_blur_texture(
        &mut self,
        node: &timeline_render::TextureNode,
        source: Option<&PreparedTexture>,
        view: &wgpu::TextureView,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
        clear: bool,
        slots: &mut EncodeSlots,
        prepared_textures: &mut HashMap<PreparedTextureKey, PreparedTexture>,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        if node.fit != TextureFit::Contain {
            bail!("gpu-texture-blur-background-requires-contain");
        }
        let local_width = texture_extent(node.rect[2], "width")?;
        let local_height = texture_extent(node.rect[3], "height")?;
        let key = prepared_texture_key(
            node,
            PreparedTextureKind::ContainBlur {
                width: local_width,
                height: local_height,
            },
        );
        let composite = if let Some(prepared) = prepared_textures.get(&key) {
            prepared.clone()
        } else {
            // CPU strict：先把已经应用 colorAdjust/source blur 的源图 cover 到元素
            // 局部画布，再按局部短边 4% 做 box blur，最后额外压暗 0.15。
            let background_blur_slot = slots.blur;
            slots.blur += 1;
            let background_view = self.blur.layer_view(background_blur_slot, local_width, local_height)?;
            let mut background_node = local_texture_node(node, local_width, local_height);
            background_node.fit = TextureFit::Cover;
            if source.is_some() {
                clear_texture_source_effects(&mut background_node);
            }
            self.encode_texture_source(
                &background_node,
                source,
                0.0,
                &background_view,
                local_width,
                local_height,
                wgpu::TextureFormat::Rgba8Unorm,
                true,
                slots,
                encoder,
            )?;
            let (blurred_view, blurred_generation) = self.blur.result_view(background_blur_slot, local_width, local_height)?;
            let radius = ((local_width.min(local_height) as f64) * 0.04)
                .round()
                .max(1.0)
                .min(f64::from(crate::SCENE_BLUR_RADIUS_LIMIT)) as u32;
            self.blur.encode_to_view(
                background_blur_slot,
                radius,
                &blurred_view,
                local_width,
                local_height,
                wgpu::TextureFormat::Rgba8Unorm,
                true,
                SceneCompositeMode::Normal,
                encoder,
            )?;
            let blurred = PreparedTexture {
                binding_key: format!("\0bcut.contain-background:{background_blur_slot}"),
                generation: blurred_generation,
                view: blurred_view,
            };

            // 背景与清晰 contain 前景必须先在 opacity=1 的局部层里压平，之后
            // 再统一应用 mask/reveal/元素 opacity；分两次直接 source-over 到主
            // target 会把前景区域的 alpha 算两遍。
            let composite_slot = slots.blur;
            slots.blur += 1;
            let (composite_view, composite_generation) = self.blur.layer_view_with_generation(composite_slot, local_width, local_height)?;
            let mut blurred_node = local_texture_node(node, local_width, local_height);
            blurred_node.source_width = local_width;
            blurred_node.source_height = local_height;
            clear_texture_source_effects(&mut blurred_node);
            self.encode_texture_source(
                &blurred_node,
                Some(&blurred),
                -0.15,
                &composite_view,
                local_width,
                local_height,
                wgpu::TextureFormat::Rgba8Unorm,
                true,
                slots,
                encoder,
            )?;
            let mut foreground_node = local_texture_node(node, local_width, local_height);
            foreground_node.fit = TextureFit::Contain;
            if source.is_some() {
                clear_texture_source_effects(&mut foreground_node);
            }
            self.encode_texture_source(
                &foreground_node,
                source,
                0.0,
                &composite_view,
                local_width,
                local_height,
                wgpu::TextureFormat::Rgba8Unorm,
                false,
                slots,
                encoder,
            )?;
            let prepared = PreparedTexture {
                binding_key: format!("\0bcut.contain-composite:{composite_slot}"),
                generation: composite_generation,
                view: composite_view,
            };
            prepared_textures.insert(key, prepared.clone());
            prepared
        };

        let mut final_node = node.clone();
        final_node.source_width = local_width;
        final_node.source_height = local_height;
        clear_texture_source_effects(&mut final_node);
        final_node.fit = TextureFit::Cover;
        final_node.background = TextureBackground::Transparent;
        self.encode_texture_source(
            &final_node,
            Some(&composite),
            0.0,
            view,
            width,
            height,
            format,
            clear,
            slots,
            encoder,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn encode_texture_source(
        &mut self,
        node: &timeline_render::TextureNode,
        source: Option<&PreparedTexture>,
        sample_brightness: f32,
        view: &wgpu::TextureView,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
        clear: bool,
        slots: &mut EncodeSlots,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        if let Some(source) = source {
            self.texture.encode_texture_view_to_view(
                slots.texture,
                node,
                &source.binding_key,
                source.generation,
                &source.view,
                sample_brightness,
                view,
                width,
                height,
                format,
                clear,
                encoder,
            )?;
        } else {
            self.texture
                .encode_to_view(slots.texture, node, sample_brightness, view, width, height, format, clear, encoder)?;
        }
        slots.texture += 1;
        Ok(())
    }
}

fn validate_scene_composites(nodes: &[SceneNode], target_texture_available: bool, depth: usize) -> Result<()> {
    for node in nodes {
        match node {
            SceneNode::Glyphs(run) => validate_glyph_composite(run.composite)?,
            SceneNode::BlurredGlyphs(effect) => {
                for run in &effect.layers {
                    validate_glyph_composite(run.composite)?;
                }
            }
            SceneNode::BlurredGroup(group) => {
                if group.reveal.is_some_and(|reveal| !reveal.is_finite()) {
                    bail!("compositor-group-reveal-non-finite");
                }
                if matches!(group.composite, SceneCompositeMode::Difference | SceneCompositeMode::Exclusion)
                    && (!target_texture_available || depth != 0)
                {
                    bail!("compositor-target-sampling-unavailable");
                }
                validate_scene_composites(&group.nodes, false, depth + 1)?;
            }
            SceneNode::Vectors(_)
            | SceneNode::AnimatedVectors { .. }
            | SceneNode::ShaderQuad { .. }
            | SceneNode::RoundedRect(_)
            | SceneNode::Texture(_) => {}
        }
    }
    Ok(())
}

fn validate_glyph_composite(composite: SceneCompositeMode) -> Result<()> {
    if matches!(composite, SceneCompositeMode::Difference | SceneCompositeMode::Exclusion) {
        bail!("compositor-glyph-target-composite-forbidden");
    }
    Ok(())
}

fn prepared_texture_key(node: &timeline_render::TextureNode, kind: PreparedTextureKind) -> PreparedTextureKey {
    PreparedTextureKey {
        texture: node.texture.clone(),
        source_width: node.source_width,
        source_height: node.source_height,
        source_effects: node.source_effects.iter().map(prepared_texture_effect_key).collect(),
        kind,
    }
}

fn prepared_texture_effect_key(effect: &TextureEffect) -> PreparedTextureEffectKey {
    match *effect {
        TextureEffect::ColorAdjust { grayscale, brightness } => {
            PreparedTextureEffectKey::ColorAdjust(grayscale.to_bits(), brightness.to_bits())
        }
        TextureEffect::Grayscale(amount) => PreparedTextureEffectKey::Grayscale(amount.to_bits()),
        TextureEffect::Brightness(amount) => PreparedTextureEffectKey::Brightness(amount.to_bits()),
        TextureEffect::Contrast(amount) => PreparedTextureEffectKey::Contrast(amount.to_bits()),
        TextureEffect::Saturation(amount) => PreparedTextureEffectKey::Saturation(amount.to_bits()),
        TextureEffect::Sepia(amount) => PreparedTextureEffectKey::Sepia(amount.to_bits()),
        TextureEffect::HueRotate(degrees) => PreparedTextureEffectKey::HueRotate(degrees.to_bits()),
        TextureEffect::Invert(amount) => PreparedTextureEffectKey::Invert(amount.to_bits()),
        TextureEffect::Blur(radius) => PreparedTextureEffectKey::Blur(radius),
        TextureEffect::Sharpen(amount) => PreparedTextureEffectKey::Sharpen(amount.to_bits()),
        TextureEffect::Noise(amount) => PreparedTextureEffectKey::Noise(amount.to_bits()),
        TextureEffect::Vignette(amount) => PreparedTextureEffectKey::Vignette(amount.to_bits()),
    }
}

#[derive(Debug, Clone, Copy)]
enum SourceEffectStep {
    Point { start: usize, end: usize },
    Blur(u32),
}

fn source_effect_steps(effects: &[TextureEffect]) -> Vec<SourceEffectStep> {
    let mut steps = Vec::new();
    let mut point_start = 0;
    for (index, effect) in effects.iter().enumerate() {
        if let TextureEffect::Blur(radius) = effect {
            if point_start < index {
                steps.push(SourceEffectStep::Point {
                    start: point_start,
                    end: index,
                });
            }
            steps.push(SourceEffectStep::Blur(*radius));
            point_start = index + 1;
        }
    }
    if point_start < effects.len() {
        steps.push(SourceEffectStep::Point {
            start: point_start,
            end: effects.len(),
        });
    }
    steps
}

/// 清除已经烘进天然尺寸中间纹理的全部效果。source/contain 预处理出口共用
/// 这一处，避免 preset 或显式效果在最终 fit pass 被重复执行。
fn clear_texture_source_effects(node: &mut timeline_render::TextureNode) {
    node.source_effects = std::sync::Arc::from([]);
}

fn texture_extent(value: f32, axis: &str) -> Result<u32> {
    let rounded = value.round();
    if !rounded.is_finite() || rounded < 1.0 || rounded > u32::MAX as f32 {
        bail!("gpu-texture-local-{axis}-invalid: {value}");
    }
    Ok(rounded as u32)
}

fn local_texture_node(node: &timeline_render::TextureNode, width: u32, height: u32) -> timeline_render::TextureNode {
    let mut local = node.clone();
    local.rect = [0.0, 0.0, width as f32, height as f32];
    local.transform = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
    local.opacity = 1.0;
    local.radius = 0.0;
    local.mask_shape = TextureMaskShape::RoundedRect;
    local.mask_feather = 0.0;
    clear_texture_source_effects(&mut local);
    local.reveal = 1.0;
    local.fit = TextureFit::Cover;
    local.background = TextureBackground::Transparent;
    local
}

fn encode_clear(encoder: &mut wgpu::CommandEncoder, view: &wgpu::TextureView) {
    {
        let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("bcut.compositor.clear.pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
    }
}
