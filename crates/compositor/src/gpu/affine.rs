//! Associated RGBA affine UV path averaging; no readback or CPU density fields.
use anyhow::{Result, ensure};
use render_raster::effects::component_filters::{Boundary, Size, affine_samples::Config};

const SHADER: &str = include_str!("affine.wgsl");
const UNIFORM_BYTES: usize = 80 + 32 * 64;

/// Executes resolved material parameters; the caller owns the material graph,
/// targets and frame encoder. Each pass within a submission needs a distinct slot.
pub struct AffineSampleRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
    slots: Vec<Slot>,
}
struct Slot {
    buffer: wgpu::Buffer,
    params: Vec<u8>,
    binding: Option<(wgpu::TextureView, wgpu::BindGroup)>,
}
impl AffineSampleRenderer {
    /// Reject ambiguous discrete densities before submitting any GPU work.
    /// This is a canonical decision check, never a CPU image/density upload.
    pub(super) fn validate_precision(config: &Config) -> Result<()> {
        if config.sample_range[0] == config.sample_range[1] {
            return Ok(());
        }
        let d = config.sampling.output;
        let edge = |v: f64, max: u32| (v - 0.5).ceil().clamp(0.0, max as f64) as u32;
        let first = config.transforms.first().unwrap();
        let last = config.transforms.last().unwrap();
        if first == last {
            return Ok(());
        }
        let norm = first.iter().chain(last).fold(1.0_f64, |n, v| n.max(v.abs()));
        let uncertainty =
            (config.sample_range[1] - config.sample_range[0]) as f64 * norm * 1e-13 / (config.distance_range[1] - config.distance_range[0]);
        for y in edge(d[1], config.output.height)..edge(d[1] + d[3], config.output.height) {
            for x in edge(d[0], config.output.width)..edge(d[0] + d[2], config.output.width) {
                let density = config.sample_density([(x as f64 + 0.5 - d[0]) / d[2], (y as f64 + 0.5 - d[1]) / d[3]]);
                if density <= config.sample_range[0] as f64 || density >= config.sample_range[1] as f64 {
                    continue;
                }
                ensure!((density - density.round()).abs() > uncertainty, "gpu-affine-density-precision");
            }
        }
        Ok(())
    }
    pub fn new(device: wgpu::Device, queue: wgpu::Queue) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("baocut.affine.layout"),
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
                        min_binding_size: wgpu::BufferSize::new(UNIFORM_BYTES as u64),
                    },
                    count: None,
                },
            ],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("baocut.affine.shader"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("baocut.affine.pipeline-layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("baocut.affine.blend"),
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
                entry_point: Some("affine"),
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

    /// Source/output are linear-suffix-free RGBA8Unorm, single-sampled and distinct.
    /// The host supplies TEXTURE_BINDING / RENDER_ATTACHMENT usages respectively.
    pub fn encode(
        &mut self,
        slot: usize,
        source: &wgpu::TextureView,
        input: Size,
        output: &wgpu::TextureView,
        config: &Config,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        ensure!(slot < 128, "gpu-affine-slot-limit");
        let limit = self.device.limits().max_texture_dimension_2d;
        ensure!(
            input.width > 0
                && input.height > 0
                && input.width <= limit
                && input.height <= limit
                && config.output.width <= limit
                && config.output.height <= limit,
            "gpu-affine-size-limit"
        );
        config.validate(input)?;
        Self::validate_precision(config)?;
        let input_domain = config.sampling.input.map(f64::from);
        let output_domain = config.sampling.output;
        let edge = |v: f64, max: u32| (v - 0.5).ceil().clamp(0.0, max as f64) as u64;
        let pixels = (edge(output_domain[0] + output_domain[2], config.output.width) - edge(output_domain[0], config.output.width))
            * (edge(output_domain[1] + output_domain[3], config.output.height) - edge(output_domain[1], config.output.height));
        ensure!(
            pixels.saturating_mul(u64::from(config.sample_range[1]) * 7 + 2) <= 256 * 1024 * 1024,
            "gpu-affine-work-budget"
        );
        let mut data = vec![0u8; UNIFORM_BYTES];
        let write = |data: &mut [u8], offset: usize, value: f64| -> Result<()> {
            let high = value as f32;
            let low = (value - high as f64) as f32;
            ensure!(
                high.is_finite()
                    && low.is_finite()
                    && (value == 0.0 || high != 0.0 || low != 0.0)
                    && (high == 0.0 || high.is_normal())
                    && (low == 0.0 || low.is_normal()),
                "gpu-affine-f32-range"
            );
            data[offset..offset + 4].copy_from_slice(&high.to_le_bytes());
            data[offset + 16..offset + 20].copy_from_slice(&low.to_le_bytes());
            Ok(())
        };
        for (i, value) in input_domain.into_iter().enumerate() {
            data[i * 4..i * 4 + 4].copy_from_slice(&(value as f32).to_le_bytes());
        }
        for (i, value) in output_domain.into_iter().enumerate() {
            write(&mut data, 16 + i * 4, value)?;
        }
        ensure!(
            (output_domain[0] as f32 + output_domain[2] as f32) > output_domain[0] as f32
                && (output_domain[1] as f32 + output_domain[3] as f32) > output_domain[1] as f32,
            "gpu-affine-f32-domain"
        );
        for (i, value) in [
            config.transforms.len() as u32,
            config.sample_range[0],
            config.sample_range[1],
            match config.boundary {
                Boundary::Normalize => 0,
                Boundary::Replicate => 1,
                Boundary::Transparent => 2,
            },
        ]
        .into_iter()
        .enumerate()
        {
            data[48 + i * 4..52 + i * 4].copy_from_slice(&value.to_le_bytes());
        }
        ensure!(
            config.distance_range[1] as f32 > config.distance_range[0] as f32
                && config.distance_range[1] - config.distance_range[0] >= 1e-12,
            "gpu-affine-f32-distance"
        );
        for (i, value) in config.distance_range.into_iter().enumerate() {
            let high = value as f32;
            let low = (value - high as f64) as f32;
            data[64 + i * 4..68 + i * 4].copy_from_slice(&high.to_le_bytes());
            data[72 + i * 4..76 + i * 4].copy_from_slice(&low.to_le_bytes());
        }
        for (i, matrix) in config.transforms.iter().enumerate() {
            let [a, b, c, d, tx, ty] = *matrix;
            for (j, value) in [a, c, tx, 0.0, b, d, ty, 0.0].into_iter().enumerate() {
                let row = j / 4;
                let column = j % 4;
                let offset = 80 + i * 64 + row * 32 + column * 4;
                write(&mut data, offset, value)?;
            }
        }
        while self.slots.len() <= slot {
            self.slots.push(Slot {
                buffer: self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("baocut.affine.params"),
                    size: UNIFORM_BYTES as u64,
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }),
                params: Vec::new(),
                binding: None,
            });
        }
        let state = &mut self.slots[slot];
        if state.params != data {
            self.queue.write_buffer(&state.buffer, 0, &data);
            state.params = data;
        }
        if state.binding.as_ref().is_none_or(|(view, _)| view != source) {
            let bindings = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("baocut.affine.bindings"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(source),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: state.buffer.as_entire_binding(),
                    },
                ],
            });
            state.binding = Some((source.clone(), bindings));
        }
        let mut render = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("baocut.affine.pass"),
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
        render.set_pipeline(&self.pipeline);
        render.set_bind_group(0, &state.binding.as_ref().unwrap().1, &[]);
        let edge = |v: f64, max: u32| (v - 0.5).ceil().clamp(0.0, max as f64) as u32;
        let left = edge(output_domain[0], config.output.width);
        let top = edge(output_domain[1], config.output.height);
        let right = edge(output_domain[0] + output_domain[2], config.output.width);
        let bottom = edge(output_domain[1] + output_domain[3], config.output.height);
        if right > left && bottom > top {
            render.set_scissor_rect(left, top, right - left, bottom - top);
            render.draw(0..3, 0..1);
        }
        Ok(())
    }

    pub fn finish_frame(&mut self, used_slots: usize) {
        self.slots.truncate(used_slots);
    }
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
        for (shader_stage, entry_point) in [(naga::ShaderStage::Vertex, "vertex_main"), (naga::ShaderStage::Fragment, "affine")] {
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
            let mut writer = naga::back::glsl::Writer::new(&mut output, &module, &info, &options, &pipeline, Default::default()).unwrap();
            writer.write().unwrap();
            assert!(output.starts_with("#version 300 es"));
        }
    }
}
