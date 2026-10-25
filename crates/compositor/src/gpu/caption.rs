//! One GPU submission for ordered caption sources, materials and backdrop blending.
use super::associated_quad::{AssociatedQuadRenderer, QuadBlend};
use super::*;
use anyhow::ensure;
use render_raster::{
    drawop::{AssociatedBlend, BitmapData},
    effects::material_plan::{MaterialCommand, MaterialFrame, MaterialSource},
};
use std::sync::Arc;
const BUDGET: u64 = 256 * 1024 * 1024;
struct Surface {
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
}
struct ImageSlot {
    bitmap: Arc<BitmapData>,
    texture: wgpu::Texture,
    view: wgpu::TextureView,
}
#[derive(Clone, Debug, Default)]
pub struct CaptionGpuStats {
    pub submissions: u32,
    pub material_passes: usize,
    pub prepared_masks: u64,
    /// Cumulative ordered-stroke cache-miss preparations, separate from masks.
    pub prepared_strokes: u64,
    pub noise_field_uploads: u64,
    pub resident_surface_bytes: u64,
}
pub struct CaptionGpuRenderer {
    compositor: Compositor,
    draw_cache: crate::RetainedDrawCache,
    stroke_cache: crate::stroke_coverage::StrokeCoverageCache,
    draw_source: super::draw_source::DrawSourceRenderer,
    glow: super::GlowRenderer,
    noisy: super::NoisySweepRenderer,
    gaussian: super::ComponentRenderer,
    affine: super::AffineSampleRenderer,
    support_cache: super::material_support::MaterialSupportCache,
    quad: AssociatedQuadRenderer,
    surfaces: Vec<Surface>,
    size: (u32, u32),
    images: Vec<Option<ImageSlot>>,
}
impl CaptionGpuRenderer {
    pub fn from_device(device: wgpu::Device, queue: wgpu::Queue, backend: impl Into<String>, adapter: impl Into<String>) -> Self {
        Self {
            compositor: Compositor::from_device(device.clone(), queue.clone(), backend, adapter),
            draw_cache: Default::default(),
            stroke_cache: Default::default(),
            draw_source: super::draw_source::DrawSourceRenderer::new(device.clone(), queue.clone()),
            glow: super::GlowRenderer::new(device.clone(), queue.clone()),
            noisy: super::NoisySweepRenderer::new(device.clone(), queue.clone()),
            gaussian: super::ComponentRenderer::new(device.clone(), queue.clone()),
            affine: super::AffineSampleRenderer::new(device.clone(), queue.clone()),
            support_cache: Default::default(),
            quad: AssociatedQuadRenderer::new(device, queue),
            surfaces: Vec::new(),
            size: (0, 0),
            images: Vec::new(),
        }
    }
    pub fn device(&self) -> &wgpu::Device {
        self.compositor.device()
    }
    pub fn queue(&self) -> &wgpu::Queue {
        self.compositor.queue()
    }
    /// `clear=false` preserves the actual backdrop supplied by the host. All
    /// commands are encoded before one submit; failure never presents half a frame.
    pub fn render(&mut self, frame: &MaterialFrame, target: RenderTarget<'_>, clear: bool) -> Result<CaptionGpuStats> {
        ensure!(
            matches!(target.format, wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Bgra8Unorm),
            "gpu-caption-target-format"
        );
        ensure!(
            frame.width == target.width && frame.height == target.height && frame.width > 0 && frame.height > 0,
            "gpu-caption-target-size"
        );
        ensure!(frame.layers.len() <= 64, "gpu-caption-layer-limit");
        ensure!(
            frame.layers.iter().all(|layer| layer.capture.is_none()),
            "gpu-caption-layer-capture-unsupported"
        );
        let limit = self.device().limits().max_texture_dimension_2d;
        ensure!(frame.width <= limit && frame.height <= limit, "gpu-caption-size-limit");
        let frame_bytes = u64::from(frame.width) * u64::from(frame.height) * 4;
        // Includes three shared full-frame targets and both glyph atlases; material
        // intermediates and static noise fields are added below before allocation.
        let mut estimated = frame_bytes.saturating_mul(3) + 40 * 1024 * 1024;
        let mut work = 0u64;
        let mut glow_count = 0;
        let mut noisy_count = 0;
        let mut affine_count = 0;
        let mut source_surfaces = 0;
        let mut source_paints = 0;
        let mut source_groups = 0;
        let mut source_strokes = 0;
        let mut stroke_resources = crate::stroke_coverage::StrokeFrameResources::default();
        let size = render_raster::effects::component_filters::Size {
            width: frame.width,
            height: frame.height,
        };
        let mut prepared = Vec::with_capacity(frame.layers.len());
        for layer in &frame.layers {
            let source = match &layer.source {
                MaterialSource::Draw(ops) => Some(super::draw_source::DrawSourcePlan::prepare(
                    ops,
                    &mut self.draw_cache,
                    &mut self.stroke_cache,
                    &mut stroke_resources,
                    &mut self.support_cache,
                    size,
                )?),
                MaterialSource::Image(_) => None,
            };
            if let Some(source) = &source {
                source_surfaces = source_surfaces.max(source.surfaces());
                source_paints += source.paint_count;
                source_groups += source.group_count;
                source_strokes += source.stroke_count;
                ensure!(source_strokes <= 128, "gpu-stroke-program-slot-limit");
                estimated = estimated.saturating_add(source.stroke_bytes);
                ensure!(source_paints <= 128 && source_groups <= 128, "gpu-draw-source-composite-limit");
                work = work.saturating_add(source.work(u64::from(frame.width) * u64::from(frame.height)));
                ensure!(work <= 512 * 1024 * 1024, "gpu-caption-work-budget");
            }
            prepared.push(source);
        }
        estimated = estimated.saturating_add(frame_bytes.saturating_mul(source_surfaces as u64));
        // Matte slots share the globally bounded source-composite index. A
        // conservative uniform reserve also covers holes occupied by Groups.
        estimated = estimated.saturating_add(source_groups as u64 * 16);
        // Persistent cached textures can outlive the last frame that used
        // strokes. Encoded bindings also retain evicted active textures, so the
        // cache reserve cannot stand in for this frame's unique event textures.
        if self.stroke_cache.prepared_strokes() != 0 {
            estimated = estimated.saturating_add(crate::stroke_coverage::GPU_CACHE_RESERVE);
        }
        estimated = estimated.saturating_add(stroke_resources.gpu_bytes());
        let supports: Vec<_> = frame
            .layers
            .iter()
            .zip(&prepared)
            .map(|(layer, source)| {
                self.support_cache
                    .source_support(&layer.source, source.as_ref().map(|source| &source.support_frame), size)
            })
            .collect();
        for (layer, source_support) in frame.layers.iter().zip(&supports) {
            let mut support = *source_support;
            ensure!(layer.materials.len() <= 8, "gpu-caption-material-limit");
            if let MaterialSource::Image(image) = &layer.source {
                estimated = estimated.saturating_add(image.bitmap.rgba.len() as u64);
            }
            for material in &layer.materials {
                match material {
                    MaterialCommand::Glow(config) => {
                        config.validate()?;
                        ensure!(config.gpu_supported(), "gpu-glow-unsupported-config");
                        ensure!(
                            config.output.width == frame.width && config.output.height == frame.height,
                            "gpu-caption-material-size"
                        );
                        glow_count += 1;
                        for level in &config.levels {
                            for pass in [level.x, level.y] {
                                let count = pass.validate()? as u64;
                                let pixels = u64::from(pass.output.width) * u64::from(pass.output.height);
                                estimated = estimated.saturating_add(pixels * 4);
                                work = work.saturating_add(pixels.saturating_mul((count * 2 + 1) * 4));
                            }
                        }
                        work = work.saturating_add(frame_bytes.saturating_mul((config.levels.len() + 1) as u64));
                        support = super::material_support::full_support(size);
                    }
                    MaterialCommand::Gaussian(pass) => {
                        pass.validate()?;
                        ensure!(
                            pass.output.width == frame.width && pass.output.height == frame.height,
                            "gpu-caption-material-size"
                        );
                        work = work.saturating_add(super::material_support::gaussian_texel_reads(size, support, *pass)?);
                        support = super::material_support::gaussian_support(size, support, *pass)?;
                    }
                    MaterialCommand::AffineSampleBlend(config) => {
                        config.validate(render_raster::effects::component_filters::Size {
                            width: frame.width,
                            height: frame.height,
                        })?;
                        super::AffineSampleRenderer::validate_precision(config)?;
                        ensure!(
                            config.output.width == frame.width && config.output.height == frame.height,
                            "gpu-caption-material-size"
                        );
                        affine_count += 1;
                        let d = config.sampling.output;
                        let edge = |v: f64, max: u32| libm_ceil(v - 0.5).clamp(0.0, max as f64) as u64;
                        let area = edge(d[0] + d[2], frame.width).saturating_sub(edge(d[0], frame.width))
                            * edge(d[1] + d[3], frame.height).saturating_sub(edge(d[1], frame.height));
                        work = work.saturating_add(area.saturating_mul(u64::from(config.sample_range[1]) * 7 + 2));
                        support = super::material_support::domain_support(size, d);
                    }
                    MaterialCommand::NoisySweep { domain, .. } => {
                        noisy_count += 1;
                        let edge = |v: f64, max: u32| libm_ceil(v - 0.5).clamp(0.0, max as f64) as u64;
                        let w = edge(domain[0] + domain[2], frame.width).saturating_sub(edge(domain[0], frame.width));
                        let h = edge(domain[1] + domain[3], frame.height).saturating_sub(edge(domain[1], frame.height));
                        estimated = estimated.saturating_add(w * h * 16);
                        work = work.saturating_add(w * h * 2);
                        support = super::material_support::full_support(size);
                    }
                }
            }
        }
        ensure!(estimated <= BUDGET, "gpu-caption-surface-budget");
        ensure!(work <= 512 * 1024 * 1024, "gpu-caption-work-budget");
        ensure!(
            glow_count <= 8 && noisy_count <= 16 && affine_count <= 128,
            "gpu-caption-material-slot-limit"
        );
        if self.size != (frame.width, frame.height) {
            self.surfaces.clear();
            self.size = (frame.width, frame.height);
            for _ in 0..3 {
                let texture = self.device().create_texture(&wgpu::TextureDescriptor {
                    label: Some("baocut.caption.surface"),
                    size: wgpu::Extent3d {
                        width: frame.width,
                        height: frame.height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::RENDER_ATTACHMENT,
                    view_formats: &[],
                });
                let view = texture.create_view(&Default::default());
                self.surfaces.push(Surface { _texture: texture, view });
            }
        }
        self.draw_source.allocate(size, source_surfaces);
        let mut encoder = self.device().create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("baocut.caption.frame"),
        });
        if clear {
            encode_clear(&mut encoder, target.view);
        }
        let mut slots = EncodeSlots::default();
        let mut textures = HashMap::new();
        let mut quad_slot = 0;
        let mut gaussian_slot = 0;
        let mut affine_slot = 0;
        let mut glow_slot = 0;
        let mut noisy_slot = 0;
        let mut image_slot = 0;
        let mut source_paint_slot = 0;
        let mut source_group_slot = 0;
        let mut source_stroke_slot = 0;
        for ((layer, prepared), source_support) in frame.layers.iter().zip(prepared).zip(supports) {
            let mut support = source_support;
            let source_view = self.surfaces[0].view.clone();
            match &layer.source {
                MaterialSource::Draw(_) => {
                    self.draw_source.encode(
                        prepared.as_ref().unwrap(),
                        &source_view,
                        &mut self.compositor,
                        &mut slots,
                        &mut textures,
                        &mut source_paint_slot,
                        &mut source_group_slot,
                        &mut source_stroke_slot,
                        &mut encoder,
                    )?;
                }
                MaterialSource::Image(image) => {
                    let view = self.image(image_slot, &image.bitmap)?;
                    image_slot += 1;
                    self.quad.encode(
                        quad_slot,
                        &view,
                        image.domain,
                        image.uv_scale,
                        image.uv_offset,
                        &RenderTarget {
                            view: &source_view,
                            width: frame.width,
                            height: frame.height,
                            format: wgpu::TextureFormat::Rgba8Unorm,
                        },
                        QuadBlend::Copy,
                        1.0,
                        true,
                        &mut encoder,
                    )?;
                    quad_slot += 1;
                }
            }
            let mut current = 0;
            for material in &layer.materials {
                let next = if current == 1 { 2 } else { 1 };
                let input = &self.surfaces[current].view;
                let output = &self.surfaces[next].view;
                match material {
                    MaterialCommand::Glow(config) => {
                        self.glow.encode(
                            glow_slot,
                            input,
                            render_raster::effects::component_filters::Size {
                                width: frame.width,
                                height: frame.height,
                            },
                            output,
                            config,
                            &mut encoder,
                        )?;
                        glow_slot += 1;
                        support = super::material_support::full_support(size);
                    }
                    MaterialCommand::Gaussian(pass) => {
                        self.gaussian.encode_gaussian_with_support(
                            gaussian_slot,
                            input,
                            render_raster::effects::component_filters::Size {
                                width: frame.width,
                                height: frame.height,
                            },
                            support,
                            output,
                            *pass,
                            &mut encoder,
                        )?;
                        gaussian_slot += 1;
                        support = super::material_support::gaussian_support(size, support, *pass)?;
                    }
                    MaterialCommand::AffineSampleBlend(config) => {
                        self.affine.encode(
                            affine_slot,
                            input,
                            render_raster::effects::component_filters::Size {
                                width: frame.width,
                                height: frame.height,
                            },
                            output,
                            config,
                            &mut encoder,
                        )?;
                        affine_slot += 1;
                        support = super::material_support::domain_support(size, config.sampling.output);
                    }
                    MaterialCommand::NoisySweep {
                        domain,
                        position,
                        mask_scale,
                        reveal,
                        flip_y,
                    } => {
                        self.noisy.encode(
                            noisy_slot,
                            input,
                            [frame.width, frame.height],
                            output,
                            *domain,
                            *position,
                            *mask_scale,
                            *reveal,
                            *flip_y,
                            &mut encoder,
                        )?;
                        noisy_slot += 1;
                        support = super::material_support::full_support(size);
                    }
                };
                current = next;
            }
            self.quad.encode(
                quad_slot,
                &self.surfaces[current].view,
                [0.0, 0.0, frame.width as f64, frame.height as f64],
                [1.0, 1.0],
                [0.0, 0.0],
                &target,
                match layer.blend {
                    AssociatedBlend::SourceOver => QuadBlend::Over,
                    AssociatedBlend::Screen => QuadBlend::Screen,
                    AssociatedBlend::Add => QuadBlend::Add,
                },
                1.0,
                false,
                &mut encoder,
            )?;
            quad_slot += 1;
        }
        self.compositor.quad.finish_live_frame(slots.quad);
        self.compositor.vector.finish_frame(slots.vector);
        self.compositor.glyph.finish_frame(slots.glyph);
        self.compositor.rounded_rect.finish_frame(slots.rounded_rect);
        self.compositor
            .source_effect
            .finish_frame(slots.source_effect_output, slots.source_effect_pass);
        self.compositor.blur.finish_frame(slots.blur);
        self.compositor.target_composite.finish_frame(slots.target_composite);
        self.compositor.texture.finish_frame(slots.texture);
        self.glow.finish_frame(glow_slot);
        self.noisy.finish_frame(noisy_slot);
        self.gaussian.finish_frame(gaussian_slot);
        self.affine.finish_frame(affine_slot);
        self.quad.finish_frame(quad_slot);
        self.draw_source
            .finish_frame(source_paint_slot, source_group_slot, source_stroke_slot);
        self.images.truncate(image_slot);
        self.queue().submit(Some(encoder.finish()));
        Ok(CaptionGpuStats {
            submissions: 1,
            material_passes: glow_slot + noisy_slot + gaussian_slot + affine_slot,
            prepared_masks: self.draw_cache.prepared_masks(),
            prepared_strokes: self.stroke_cache.prepared_strokes(),
            noise_field_uploads: self.noisy.field_uploads(),
            resident_surface_bytes: frame_bytes * 3
                + self.draw_source.resident_bytes()
                + self.glow.resident_bytes()
                + self.noisy.resident_bytes()
                + self.images.iter().flatten().map(|i| i.bitmap.rgba.len() as u64).sum::<u64>(),
        })
    }
    fn image(&mut self, slot: usize, bitmap: &Arc<BitmapData>) -> Result<wgpu::TextureView> {
        ensure!(
            bitmap.width > 0
                && bitmap.height > 0
                && bitmap.width <= self.device().limits().max_texture_dimension_2d
                && bitmap.height <= self.device().limits().max_texture_dimension_2d
                && bitmap.rgba.len() as u64 == u64::from(bitmap.width) * u64::from(bitmap.height) * 4,
            "gpu-caption-image-size"
        );
        while self.images.len() <= slot {
            self.images.push(None);
        }
        if self.images[slot]
            .as_ref()
            .is_none_or(|i| i.bitmap.width != bitmap.width || i.bitmap.height != bitmap.height)
        {
            let texture = self.device().create_texture(&wgpu::TextureDescriptor {
                label: Some("baocut.caption.image"),
                size: wgpu::Extent3d {
                    width: bitmap.width,
                    height: bitmap.height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            let view = texture.create_view(&Default::default());
            self.images[slot] = Some(ImageSlot {
                bitmap: Arc::new(BitmapData {
                    width: bitmap.width,
                    height: bitmap.height,
                    rgba: Arc::from([]),
                }),
                texture,
                view,
            });
        }
        let queue = self.queue().clone();
        let image = self.images[slot].as_mut().unwrap();
        if !Arc::ptr_eq(&image.bitmap, bitmap) {
            queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &image.texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                &bitmap.rgba,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(bitmap.width * 4),
                    rows_per_image: Some(bitmap.height),
                },
                wgpu::Extent3d {
                    width: bitmap.width,
                    height: bitmap.height,
                    depth_or_array_layers: 1,
                },
            );
            image.bitmap = bitmap.clone();
        }
        Ok(image.view.clone())
    }
}
// Geometric budgeting only; authoritative mask coordinates use shared libm.
fn libm_ceil(v: f64) -> f64 {
    v.ceil()
}
