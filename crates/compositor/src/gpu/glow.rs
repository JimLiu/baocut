//! Quantized, associated-RGBA glow cascade using retained GPU-only intermediates.
use super::component::ComponentRenderer;
use anyhow::{Result, ensure};
use render_raster::effects::component_filters::{GlowComposite, GlowConfig, Size};
const SHADER: &str = include_str!("glow.wgsl");
const MAX_SLOTS: usize = 8;
const PARAM_BYTES: u64 = 96;
const DEFAULT_BUDGET: u64 = 256 * 1024 * 1024;
struct Surface {
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
    size: Size,
}
struct Slot {
    surfaces: Vec<Surface>,
    params: wgpu::Buffer,
    previous_params: Vec<u8>,
    bindings: Option<(Vec<wgpu::TextureView>, wgpu::BindGroup)>,
}
/// One instance can encode up to eight independent glow layers per submission.
/// Inputs/outputs remain host-owned. All retained intermediates share a byte budget.
pub struct GlowRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    gaussian: ComponentRenderer,
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
    slots: Vec<Slot>,
    budget: u64,
    allocations: u64,
}
impl GlowRenderer {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue) -> Self {
        Self::with_budget(device, queue, DEFAULT_BUDGET)
    }
    pub fn with_budget(device: wgpu::Device, queue: wgpu::Queue, budget: u64) -> Self {
        let mut entries: Vec<_> = (0..8)
            .map(|binding| wgpu::BindGroupLayoutEntry {
                binding,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            })
            .collect();
        entries.push(wgpu::BindGroupLayoutEntry {
            binding: 8,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: wgpu::BufferSize::new(PARAM_BYTES),
            },
            count: None,
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("baocut.glow.layout"),
            entries: &entries,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("baocut.glow.shader"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("baocut.glow.pipeline-layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("baocut.glow.pipeline"),
            layout: Some(&pl),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vertex_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("glow"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        Self {
            gaussian: ComponentRenderer::new(device.clone(), queue.clone()),
            device,
            queue,
            layout,
            pipeline,
            slots: Vec::new(),
            budget,
            allocations: 0,
        }
    }
    pub fn resident_bytes(&self) -> u64 {
        self.slots.iter().flat_map(|s| &s.surfaces).map(|s| bytes(s.size)).sum()
    }
    pub fn surface_allocations(&self) -> u64 {
        self.allocations
    }
    /// Linear RGBA8Unorm, one sample, distinct source and output. Use a different
    /// slot for every call encoded before submission. No queue submit or readback.
    pub fn encode(
        &mut self,
        slot: usize,
        input: &wgpu::TextureView,
        input_size: Size,
        output: &wgpu::TextureView,
        config: &GlowConfig,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        ensure!(slot < MAX_SLOTS, "gpu-glow-slot-limit");
        let gain = config.validate()?;
        ensure!(config.gpu_supported(), "gpu-glow-unsupported-config");
        let sizes: Vec<_> = config.levels.iter().flat_map(|l| [l.x.output, l.y.output]).collect();
        let max = self.device.limits().max_texture_dimension_2d;
        ensure!(
            sizes
                .iter()
                .chain([&input_size, &config.output])
                .all(|s| s.width > 0 && s.height > 0 && s.width <= max && s.height <= max),
            "gpu-glow-size-limit"
        );
        let retained_other: u64 = self
            .slots
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != slot)
            .flat_map(|(_, s)| &s.surfaces)
            .map(|s| bytes(s.size))
            .sum();
        let needed: u64 = sizes.iter().copied().map(bytes).sum();
        ensure!(
            retained_other
                .saturating_add(needed)
                .saturating_add(bytes(input_size))
                .saturating_add(bytes(config.output))
                <= self.budget,
            "gpu-glow-surface-budget"
        );
        // Validate every parameter and aggregate work before changing GPU resources.
        let mut reads = 0u64;
        for level in &config.levels {
            for pass in [level.x, level.y] {
                let count = pass.validate()?;
                reads = reads.saturating_add(bytes(pass.output).saturating_mul(2 * count as u64 + 1));
            }
        }
        reads = reads.saturating_add(bytes(config.output).saturating_mul((config.levels.len() + 1) as u64));
        ensure!(reads <= 256 * 1024 * 1024, "gpu-glow-work-budget");
        let values = [
            config.output.width as f64,
            config.output.height as f64,
            gain,
            0.0,
            config.glow_tint[0],
            config.glow_tint[1],
            config.glow_tint[2],
            config.original_opacity,
            config.glow_color_matrix[0],
            config.glow_color_matrix[1],
            config.glow_color_matrix[2],
            0.0,
            config.glow_color_matrix[3],
            config.glow_color_matrix[4],
            config.glow_color_matrix[5],
            0.0,
            config.glow_color_matrix[6],
            config.glow_color_matrix[7],
            config.glow_color_matrix[8],
            0.0,
        ];
        ensure!(values.iter().all(|v| (*v as f32).is_finite()), "gpu-glow-f32-range");
        let mut params: Vec<u8> = values.iter().flat_map(|v| (*v as f32).to_le_bytes()).collect();
        for v in [
            config.levels.len() as u32,
            u32::from(config.composite == GlowComposite::Screen),
            0,
            0,
        ] {
            params.extend_from_slice(&v.to_le_bytes());
        }
        while self.slots.len() <= slot {
            self.slots.push(Slot {
                surfaces: Vec::new(),
                params: self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("baocut.glow.params"),
                    size: PARAM_BYTES,
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }),
                previous_params: Vec::new(),
                bindings: None,
            });
        }
        let state = &mut self.slots[slot];
        // Release obsolete surfaces before allocation, keeping resize peaks bounded.
        if state.surfaces.iter().map(|s| s.size).collect::<Vec<_>>() != sizes {
            state.bindings = None;
            self.gaussian.clear_sources(slot * 14..slot * 14 + 14);
            state.surfaces.clear();
            for size in sizes {
                let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("baocut.glow.intermediate"),
                    size: wgpu::Extent3d {
                        width: size.width,
                        height: size.height,
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
                state.surfaces.push(Surface {
                    _texture: texture,
                    view,
                    size,
                });
                self.allocations += 1;
            }
        }
        if state.previous_params != params {
            self.queue.write_buffer(&state.params, 0, &params);
            state.previous_params = params;
        }
        let mut previous = input;
        let mut previous_size = input_size;
        for (i, level) in config.levels.iter().enumerate() {
            self.gaussian.encode_gaussian(
                slot * 14 + i * 2,
                previous,
                previous_size,
                &state.surfaces[i * 2].view,
                level.x,
                encoder,
            )?;
            self.gaussian.encode_gaussian(
                slot * 14 + i * 2 + 1,
                &state.surfaces[i * 2].view,
                level.x.output,
                &state.surfaces[i * 2 + 1].view,
                level.y,
                encoder,
            )?;
            previous = &state.surfaces[i * 2 + 1].view;
            previous_size = level.y.output;
        }
        let views: Vec<_> = std::iter::once(input.clone())
            .chain((0..7).map(|i| state.surfaces.get(i * 2 + 1).map_or_else(|| input.clone(), |s| s.view.clone())))
            .collect();
        if state.bindings.as_ref().is_none_or(|(prior, _)| prior != &views) {
            let mut entries: Vec<_> = views
                .iter()
                .enumerate()
                .map(|(i, v)| wgpu::BindGroupEntry {
                    binding: i as u32,
                    resource: wgpu::BindingResource::TextureView(v),
                })
                .collect();
            entries.push(wgpu::BindGroupEntry {
                binding: 8,
                resource: state.params.as_entire_binding(),
            });
            let bindings = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("baocut.glow.bindings"),
                layout: &self.layout,
                entries: &entries,
            });
            state.bindings = Some((views, bindings));
        }
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("baocut.glow.composite"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: output,
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
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &state.bindings.as_ref().unwrap().1, &[]);
        pass.draw(0..3, 0..1);
        Ok(())
    }
    pub fn finish_frame(&mut self, used_slots: usize) {
        self.slots.truncate(used_slots);
        self.gaussian.finish_frame(used_slots.saturating_mul(14));
    }
}
fn bytes(size: Size) -> u64 {
    u64::from(size.width).saturating_mul(u64::from(size.height)).saturating_mul(4)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shader_translates_to_webgl2_without_optional_features() {
        let module = naga::front::wgsl::parse_str(SHADER).unwrap();
        let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
            .validate(&module)
            .unwrap();
        for (shader_stage, entry_point) in [(naga::ShaderStage::Vertex, "vertex_main"), (naga::ShaderStage::Fragment, "glow")] {
            let mut output = String::new();
            let options = naga::back::glsl::Options {
                version: naga::back::glsl::Version::new_gles(300),
                ..Default::default()
            };
            let pipeline = naga::back::glsl::PipelineOptions {
                shader_stage,
                entry_point: entry_point.into(),
                multiview: None,
            };
            naga::back::glsl::Writer::new(&mut output, &module, &info, &options, &pipeline, Default::default())
                .unwrap()
                .write()
                .unwrap();
            assert!(output.starts_with("#version 300 es"));
        }
    }
}
