//! Stable noise field uploaded once; per-frame reveal, masking and pixels run on GPU.
use anyhow::{Result, ensure};
use render_raster::effects::noisy_sweep::prepare_field;
const SHADER: &str = include_str!("noisy.wgsl");
#[derive(Clone, PartialEq)]
struct Key {
    size: [u32; 2],
    domain: [f64; 4],
    scale: [f64; 2],
    flip_y: bool,
}
struct Field {
    key: Key,
    rect: [u32; 4],
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
    bytes: u64,
}
struct Slot {
    field: Option<Field>,
    params: wgpu::Buffer,
    previous: Vec<u8>,
    binding: Option<(wgpu::TextureView, wgpu::BindGroup)>,
}
pub struct NoisySweepRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
    slots: Vec<Slot>,
    field_uploads: u64,
}
impl NoisySweepRenderer {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue) -> Self {
        let mut entries: Vec<_> = (0..2)
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
            binding: 2,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: wgpu::BufferSize::new(32),
            },
            count: None,
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("baocut.noisy.layout"),
            entries: &entries,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("baocut.noisy.shader"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("baocut.noisy.pipeline-layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("baocut.noisy.pipeline"),
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
                entry_point: Some("noisy"),
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
            device,
            queue,
            layout,
            pipeline,
            slots: Vec::new(),
            field_uploads: 0,
        }
    }
    pub fn field_uploads(&self) -> u64 {
        self.field_uploads
    }
    pub fn resident_bytes(&self) -> u64 {
        self.slots.iter().filter_map(|s| s.field.as_ref()).map(|f| f.bytes).sum()
    }
    pub fn finish_frame(&mut self, used: usize) {
        self.slots.truncate(used);
    }
    #[allow(clippy::too_many_arguments)]
    pub fn encode(
        &mut self,
        slot: usize,
        input: &wgpu::TextureView,
        size: [u32; 2],
        output: &wgpu::TextureView,
        domain: [f64; 4],
        position: f64,
        scale: [f64; 2],
        reveal: bool,
        flip_y: bool,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        ensure!(
            slot < 16 && position.is_finite() && (-1024.0..=1024.0).contains(&position),
            "gpu-noisy-parameters"
        );
        let limit = self.device.limits().max_texture_dimension_2d;
        ensure!(size.iter().all(|n| *n > 0 && *n <= limit), "gpu-noisy-size-limit");
        let key = Key {
            size,
            domain,
            scale,
            flip_y,
        };
        while self.slots.len() <= slot {
            self.slots.push(Slot {
                field: None,
                params: self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("baocut.noisy.params"),
                    size: 32,
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }),
                previous: Vec::new(),
                binding: None,
            });
        }
        if self.slots[slot].field.as_ref().is_none_or(|f| f.key != key) {
            let field = prepare_field(size, domain, scale, flip_y)?;
            let bytes = (field.pixels.len() * 16) as u64;
            let other = self.resident_bytes() - self.slots[slot].field.as_ref().map_or(0, |f| f.bytes);
            ensure!(other.saturating_add(bytes) <= 128 * 1024 * 1024, "gpu-noisy-field-budget");
            self.slots[slot].binding = None;
            self.slots[slot].field = None;
            let width = field.rect[2].max(1);
            let height = field.rect[3].max(1);
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("baocut.noisy.field"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba32Float,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            if !field.pixels.is_empty() {
                let data: Vec<u8> = field.pixels.iter().flat_map(|p| p.iter().flat_map(|v| v.to_le_bytes())).collect();
                self.queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    &data,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(width * 16),
                        rows_per_image: Some(height),
                    },
                    wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                );
            }
            let view = texture.create_view(&Default::default());
            self.slots[slot].field = Some(Field {
                key,
                rect: field.rect,
                _texture: texture,
                view,
                bytes,
            });
            self.field_uploads += 1;
        }
        let state = &mut self.slots[slot];
        let field = state.field.as_ref().unwrap();
        let mut params: Vec<u8> = field.rect.iter().flat_map(|v| v.to_le_bytes()).collect();
        for v in [position as f32, if reveal { 1.0 } else { 0.0 }, 0.0, 0.0] {
            params.extend_from_slice(&v.to_le_bytes());
        }
        if state.previous != params {
            self.queue.write_buffer(&state.params, 0, &params);
            state.previous = params;
        }
        if state.binding.as_ref().is_none_or(|(view, _)| view != input) {
            let binding = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("baocut.noisy.binding"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(input),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(&field.view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: state.params.as_entire_binding(),
                    },
                ],
            });
            state.binding = Some((input.clone(), binding));
        }
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("baocut.noisy.pass"),
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
        if field.rect[2] > 0 && field.rect[3] > 0 {
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &state.binding.as_ref().unwrap().1, &[]);
            pass.set_scissor_rect(field.rect[0], field.rect[1], field.rect[2], field.rect[3]);
            pass.draw(0..3, 0..1);
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shader_translates_to_webgl2() {
        let module = naga::front::wgsl::parse_str(SHADER).unwrap();
        let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
            .validate(&module)
            .unwrap();
        for (shader_stage, entry_point) in [(naga::ShaderStage::Vertex, "vertex_main"), (naga::ShaderStage::Fragment, "noisy")] {
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
        }
    }
}
