//! Associated RGBA Gaussian passes. No pixel readback or CPU image filtering.
use anyhow::{Result, ensure};
use render_raster::effects::component_filters::{Axis, Boundary, GaussianPass, Size, Support, gaussian_weights};

const SHADER: &str = include_str!("component.wgsl");
use super::material_support::{full_support, gaussian_support, gaussian_texel_reads};

const UNIFORM_BYTES: usize = 128 + 1024 * 4;

/// Executes resolved material parameters; the caller owns the material graph,
/// targets and frame encoder. Each pass within a submission needs a distinct slot.
pub struct ComponentRenderer {
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
impl ComponentRenderer {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("baocut.component.layout"),
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
            label: Some("baocut.component.shader"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("baocut.component.pipeline-layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("baocut.component.gaussian"),
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
                entry_point: Some("gaussian"),
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
    pub fn encode_gaussian(
        &mut self,
        slot: usize,
        source: &wgpu::TextureView,
        input: Size,
        output: &wgpu::TextureView,
        pass: GaussianPass,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        // Preserve the legacy full-output work limit for callers without proven
        // source metadata. Sparse callers use the support-aware entry point.
        let count = pass.validate()?;
        let reads = u64::from(pass.output.width)
            .saturating_mul(u64::from(pass.output.height))
            .saturating_mul(2 * count as u64 + 1)
            .saturating_mul(4);
        ensure!(reads <= 256 * 1024 * 1024, "gpu-component-work-budget");
        self.encode_gaussian_with_support(slot, source, input, full_support(input), output, pass, encoder)
    }

    /// `support` must enclose every nonzero RGBA component in `source`; `None`
    /// is a proven empty image. Metadata is derived before rendering, never by
    /// readback. The output is cleared in full before drawing its active bounds.
    pub fn encode_gaussian_with_support(
        &mut self,
        slot: usize,
        source: &wgpu::TextureView,
        input: Size,
        support: Option<Support>,
        output: &wgpu::TextureView,
        pass: GaussianPass,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        ensure!(slot < 128, "gpu-component-slot-limit");
        let limit = self.device.limits().max_texture_dimension_2d;
        ensure!(
            input.width > 0
                && input.height > 0
                && input.width <= limit
                && input.height <= limit
                && pass.output.width <= limit
                && pass.output.height <= limit,
            "gpu-component-size-limit"
        );
        let weights = gaussian_weights(pass)?;
        let (input_domain, output_domain) = pass.sampling_domains(input)?;
        let active = gaussian_support(input, support, pass)?;
        let reads = gaussian_texel_reads(input, support, pass)?;
        ensure!(reads <= 256 * 1024 * 1024, "gpu-component-work-budget");
        let mut data = vec![0u8; UNIFORM_BYTES];
        for (i, value) in [input.width, input.height, pass.output.width, pass.output.height]
            .into_iter()
            .enumerate()
        {
            data[i * 4..i * 4 + 4].copy_from_slice(&value.to_le_bytes());
        }
        let gamma = if weights.is_empty() { 1.0 } else { pass.gamma.unwrap_or(1.0) };
        for (i, value) in [
            pass.step_pixels,
            gamma,
            if pass.axis == Axis::X { 0.0 } else { 1.0 },
            match pass.boundary {
                Boundary::Normalize => 0.0,
                Boundary::Replicate => 1.0,
                Boundary::Transparent => 2.0,
            },
        ]
        .into_iter()
        .enumerate()
        {
            let value = value as f32;
            ensure!(
                value.is_finite() && (i != 1 || (value > 0.0 && (1.0 / value).is_finite())),
                "gpu-component-f32-range"
            );
            data[16 + i * 4..20 + i * 4].copy_from_slice(&value.to_le_bytes());
        }
        data[32..36].copy_from_slice(&(weights.len() as u32).to_le_bytes());
        let flags = u32::from(pass.spacing_ramp.is_some_and(|r| r.positive_first)) | (u32::from(pass.sampling.is_some()) << 1);
        data[44..48].copy_from_slice(&flags.to_le_bytes());
        if let Some(ramp) = pass.spacing_ramp {
            data[36..40].copy_from_slice(&1u32.to_le_bytes());
            data[40..44].copy_from_slice(&u32::from(ramp.previous_sample).to_le_bytes());
            let values = [
                ramp.domain[0],
                ramp.domain[1],
                ramp.domain[2],
                ramp.domain[3],
                ramp.start,
                ramp.end,
                if ramp.axis == Axis::Y { 1.0 } else { 0.0 },
                if ramp.reverse { 1.0 } else { 0.0 },
            ];
            for (i, value) in values.into_iter().enumerate() {
                let value = value as f32;
                ensure!(value.is_finite(), "gpu-component-f32-range");
                data[48 + i * 4..52 + i * 4].copy_from_slice(&value.to_le_bytes());
            }
            ensure!(
                (ramp.end as f32) > (ramp.start as f32)
                    && ((ramp.end as f32) - (ramp.start as f32)).is_finite()
                    && (ramp.domain[2] as f32) > 0.0
                    && (ramp.domain[3] as f32) > 0.0,
                "gpu-component-f32-range"
            );
        }
        for (i, value) in input_domain.into_iter().chain(output_domain).enumerate() {
            let value = value as f32;
            ensure!(value.is_finite(), "gpu-component-f32-range");
            data[80 + i * 4..84 + i * 4].copy_from_slice(&value.to_le_bytes());
        }
        let source_bounds = support.map_or([0; 4], |s| [s.left, s.top, s.right, s.bottom]);
        for (i, value) in source_bounds.into_iter().enumerate() {
            data[112 + i * 4..116 + i * 4].copy_from_slice(&value.to_le_bytes());
        }
        for (i, value) in weights.into_iter().enumerate() {
            data[128 + i * 4..132 + i * 4].copy_from_slice(&(value as f32).to_le_bytes());
        }
        while self.slots.len() <= slot {
            self.slots.push(Slot {
                buffer: self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("baocut.component.params"),
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
                label: Some("baocut.component.bindings"),
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
            label: Some("baocut.component.pass"),
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
        let Some(active) = active else {
            return Ok(());
        };
        let left = edge(output_domain[0], pass.output.width).max(active.left);
        let top = edge(output_domain[1], pass.output.height).max(active.top);
        let right = edge(output_domain[0] + output_domain[2], pass.output.width).min(active.right);
        let bottom = edge(output_domain[1] + output_domain[3], pass.output.height).min(active.bottom);
        if right > left && bottom > top {
            render.set_scissor_rect(left, top, right - left, bottom - top);
            render.draw(0..3, 0..1);
        }
        Ok(())
    }

    pub(super) fn clear_sources(&mut self, range: std::ops::Range<usize>) {
        for i in range {
            if let Some(slot) = self.slots.get_mut(i) {
                slot.binding = None;
            }
        }
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
        for (shader_stage, entry_point) in [
            (naga::ShaderStage::Vertex, "vertex_main"),
            (naga::ShaderStage::Fragment, "gaussian"),
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
            let mut writer = naga::back::glsl::Writer::new(&mut output, &module, &info, &options, &pipeline, Default::default()).unwrap();
            writer.write().unwrap();
            assert!(output.starts_with("#version 300 es"));
        }
    }
}
