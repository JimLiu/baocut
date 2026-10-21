use anyhow::{Result, ensure};
use std::collections::HashMap;
const SHADER: &str = include_str!("associated_quad.wgsl");
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(super) enum QuadBlend {
    Copy,
    Over,
    SourceGroupOver,
    Screen,
    Add,
}
struct Slot {
    params: wgpu::Buffer,
    previous: Vec<u8>,
    binding: Option<(wgpu::TextureView, wgpu::BindGroup)>,
}
pub(super) struct AssociatedQuadRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    layout: wgpu::BindGroupLayout,
    shader: wgpu::ShaderModule,
    pipelines: HashMap<(wgpu::TextureFormat, QuadBlend), wgpu::RenderPipeline>,
    slots: Vec<Slot>,
}
impl AssociatedQuadRenderer {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("baocut.associated-quad.layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: wgpu::BufferSize::new(48),
                    },
                    count: None,
                },
            ],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("baocut.associated-quad.shader"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        Self {
            device,
            queue,
            layout,
            shader,
            pipelines: HashMap::new(),
            slots: Vec::new(),
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub fn encode(
        &mut self,
        slot: usize,
        source: &wgpu::TextureView,
        domain: [f64; 4],
        uv_scale: [f64; 2],
        uv_offset: [f64; 2],
        target: &super::RenderTarget<'_>,
        blend: QuadBlend,
        opacity: f32,
        clear: bool,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        ensure!(
            slot < 256
                && domain
                    .iter()
                    .chain(uv_scale.iter())
                    .chain(uv_offset.iter())
                    .all(|v| v.is_finite() && (*v as f32).is_finite())
                && domain[2] > 0.0
                && domain[3] > 0.0
                && uv_scale.iter().all(|v| *v > 0.0),
            "gpu-image-quad-invalid"
        );
        ensure!(opacity.is_finite() && (0.0..=1.0).contains(&opacity), "gpu-image-opacity-invalid");
        let key = (target.format, blend);
        if !self.pipelines.contains_key(&key) {
            let pl = self.device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("baocut.associated-quad.pipeline-layout"),
                bind_group_layouts: &[Some(&self.layout)],
                immediate_size: 0,
            });
            let blend = match blend {
                QuadBlend::Copy => None,
                QuadBlend::Over | QuadBlend::SourceGroupOver => Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                QuadBlend::Screen => Some(super::scene_blend_state(timeline_render::SceneCompositeMode::Screen)),
                // Independent associated components: S + D on RGBA, clamped by the UNORM target.
                QuadBlend::Add => {
                    let add = wgpu::BlendComponent {
                        src_factor: wgpu::BlendFactor::One,
                        dst_factor: wgpu::BlendFactor::One,
                        operation: wgpu::BlendOperation::Add,
                    };
                    Some(wgpu::BlendState { color: add, alpha: add })
                }
            };
            let pipeline = self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("baocut.associated-quad.pipeline"),
                layout: Some(&pl),
                vertex: wgpu::VertexState {
                    module: &self.shader,
                    entry_point: Some("vertex_main"),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &self.shader,
                    entry_point: Some("image"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: target.format,
                        blend,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            });
            self.pipelines.insert(key, pipeline);
        }
        let values = [
            domain[0] as f32,
            domain[1] as f32,
            domain[2] as f32,
            domain[3] as f32,
            uv_scale[0] as f32,
            uv_scale[1] as f32,
            uv_offset[0] as f32,
            uv_offset[1] as f32,
            target.width as f32,
            target.height as f32,
            opacity,
            match blend {
                QuadBlend::Copy => 1.0,
                QuadBlend::SourceGroupOver => 2.0,
                _ => 0.0,
            },
        ];
        let params: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
        while self.slots.len() <= slot {
            self.slots.push(Slot {
                params: self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("baocut.associated-quad.params"),
                    size: 48,
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }),
                previous: Vec::new(),
                binding: None,
            });
        }
        let state = &mut self.slots[slot];
        if state.previous != params {
            self.queue.write_buffer(&state.params, 0, &params);
            state.previous = params;
        }
        if state.binding.as_ref().is_none_or(|(view, _)| view != source) {
            let binding = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("baocut.associated-quad.binding"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(source),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: state.params.as_entire_binding(),
                    },
                ],
            });
            state.binding = Some((source.clone(), binding));
        }
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("baocut.associated-quad.pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target.view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: if clear {
                        wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT)
                    } else {
                        wgpu::LoadOp::Load
                    },
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipelines[&key]);
        pass.set_bind_group(0, &state.binding.as_ref().unwrap().1, &[]);
        pass.draw(0..3, 0..1);
        Ok(())
    }
    pub fn finish_frame(&mut self, used: usize) {
        self.slots.truncate(used);
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
        for (shader_stage, entry_point) in [(naga::ShaderStage::Vertex, "vertex_main"), (naga::ShaderStage::Fragment, "image")] {
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
