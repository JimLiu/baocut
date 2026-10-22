use anyhow::{Result, ensure};

const SHADER: &str = include_str!("matte.wgsl");
const MAX_SLOTS: usize = 128;
const PARAM_BYTES: u64 = 16;

struct Slot {
    params: wgpu::Buffer,
    previous_mode: Option<u8>,
    binding: Option<(wgpu::TextureView, wgpu::TextureView, wgpu::BindGroup)>,
}

/// Applies a pixel-aligned matte to associated RGBA8 channels on the GPU.
/// Inputs and output must share dimensions, and the output must be distinct.
pub(super) struct MatteRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
    slots: Vec<Slot>,
}

impl MatteRenderer {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue) -> Self {
        let texture_entry = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("baocut.matte.layout"),
            entries: &[
                texture_entry(0),
                texture_entry(1),
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: wgpu::BufferSize::new(PARAM_BYTES),
                    },
                    count: None,
                },
            ],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("baocut.matte.shader"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("baocut.matte.pipeline-layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("baocut.matte.pipeline"),
            layout: Some(&pipeline_layout),
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
                entry_point: Some("fragment_main"),
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
        }
    }

    /// Each operation within one submission must use a distinct slot: queue
    /// writes update uniforms before submission, rather than between passes.
    #[allow(clippy::too_many_arguments)]
    pub fn encode(
        &mut self,
        slot: usize,
        content: &wgpu::TextureView,
        matte: &wgpu::TextureView,
        target: &wgpu::TextureView,
        mode: u8,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        ensure!(slot < MAX_SLOTS && mode <= 3, "gpu-matte-invalid");
        while self.slots.len() <= slot {
            self.slots.push(Slot {
                params: self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("baocut.matte.params"),
                    size: PARAM_BYTES,
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }),
                previous_mode: None,
                binding: None,
            });
        }
        let state = &mut self.slots[slot];
        if state.previous_mode != Some(mode) {
            let mut params = [0u8; PARAM_BYTES as usize];
            params[..4].copy_from_slice(&u32::from(mode).to_le_bytes());
            self.queue.write_buffer(&state.params, 0, &params);
            state.previous_mode = Some(mode);
        }
        if state
            .binding
            .as_ref()
            .is_none_or(|(previous_content, previous_matte, _)| previous_content != content || previous_matte != matte)
        {
            let binding = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("baocut.matte.binding"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(content),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(matte),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: state.params.as_entire_binding(),
                    },
                ],
            });
            state.binding = Some((content.clone(), matte.clone(), binding));
        }
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("baocut.matte.pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
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
        pass.set_bind_group(0, &state.binding.as_ref().unwrap().2, &[]);
        pass.draw(0..3, 0..1);
        Ok(())
    }

    pub fn finish_frame(&mut self, live_slots: usize) {
        self.slots.truncate(live_slots);
    }

    /// Texture storage is owned and counted by the caller, not by bindings.
    pub fn resident_bytes(&self) -> u64 {
        self.slots.len() as u64 * PARAM_BYTES
    }
}

#[cfg(test)]
mod tests {
    use super::SHADER;

    #[test]
    fn shader_validates_and_translates_to_webgl2() {
        let module = naga::front::wgsl::parse_str(SHADER).unwrap();
        let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
            .validate(&module)
            .unwrap();
        for (shader_stage, entry_point) in [
            (naga::ShaderStage::Vertex, "vertex_main"),
            (naga::ShaderStage::Fragment, "fragment_main"),
        ] {
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
