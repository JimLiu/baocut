//! Pad linear paint in path-local coordinates, with independently sampled alpha.
use anyhow::{Result, ensure};
use render_raster::{
    drawop::{GradientStop, Mat6},
    effects::component_filters::{Size, Support},
};

const SHADER: &str = include_str!("linear-paint.wgsl");
// 4 vec4 headers + 9 offset vec4s + 33 factors + 33 biases.
// Replay appends one region vec4 (1280 bytes total).
const BYTES: u64 = 1264;
const COEFFICIENTS: usize = 33;
const FACTORS: usize = 52;
const BIASES: usize = FACTORS + COEFFICIENTS * 4;
pub(super) struct LinearPaint {
    pub(super) bytes: Vec<u8>,
}
impl LinearPaint {
    pub(super) fn solid(color: [f32; 4]) -> Self {
        let color = color.map(|v| v.clamp(0., 1.));
        let mut values = vec![0.0_f32; BYTES as usize / 4];
        values[12] = 1.;
        values[13] = if color[3] == 1. { 1. } else { 0. };
        values[BIASES..BIASES + 4].copy_from_slice(&color);
        Self {
            bytes: values.into_iter().flat_map(f32::to_le_bytes).collect(),
        }
    }
    pub(super) fn new(p0: [f32; 2], p1: [f32; 2], stops: &[GradientStop], transform: Mat6) -> Result<Self> {
        ensure!(
            stops.len() <= 32
                && p0.into_iter().chain(p1).chain(transform).all(f32::is_finite)
                && stops.iter().all(|s| s.offset.is_finite() && s.color.iter().all(|c| c.is_finite())),
            "gpu-draw-gradient-invalid"
        );
        let determinant = transform[0] * transform[3] - transform[1] * transform[2];
        ensure!(
            determinant.is_finite() && determinant != 0.,
            "gpu-draw-gradient-transform-unsupported"
        );
        let inverse = tiny_skia::Transform::from_row(transform[0], transform[1], transform[2], transform[3], transform[4], transform[5])
            .invert()
            .ok_or_else(|| anyhow::anyhow!("gpu-draw-gradient-transform-unsupported"))?;
        let mut axis = tiny_skia::Point::from_xy(p1[0] - p0[0], p1[1] - p0[1]);
        let length = axis.length();
        ensure!(
            length.is_finite() && (axis.x * axis.x + axis.y * axis.y).is_finite(),
            "gpu-draw-gradient-invalid"
        );
        if stops.len() <= 1 || length <= 1. / 32768. {
            return Ok(Self::solid(stops.last().map_or([0.; 4], |s| s.color)));
        }
        // Mirror tiny-skia's points_to_unit_ts construction and concatenate with
        // its inverse Transform implementation, including f64 skew products.
        let inv_length = 1. / length;
        axis.scale(inv_length);
        let (sin, cos) = (-axis.y, axis.x);
        let cos_inv = 1. - cos;
        let unit = tiny_skia::Transform::from_row(cos, sin, -sin, cos, sin * p0[1] + cos_inv * p0[0], -sin * p0[0] + cos_inv * p0[1])
            .post_translate(-p0[0], -p0[1])
            .post_scale(inv_length, inv_length);
        let combined = inverse.post_concat(unit);
        ensure!(combined.is_finite(), "gpu-draw-gradient-invalid");
        let mut normalized: Vec<GradientStop> = stops
            .iter()
            .map(|s| GradientStop {
                offset: s.offset.clamp(0., 1.),
                color: s.color.map(|c| c.clamp(0., 1.)),
            })
            .collect();
        let dummy_first = normalized[0].offset != 0.;
        if dummy_first {
            normalized.insert(
                0,
                GradientStop {
                    offset: 0.,
                    color: normalized[0].color,
                },
            );
        }
        if normalized.last().unwrap().offset != 1. {
            normalized.push(GradientStop {
                offset: 1.,
                color: normalized.last().unwrap().color,
            });
        }
        let opaque = normalized.iter().all(|s| s.color[3] == 1.);
        let start = if dummy_first { 0 } else { 1 };
        let step = normalized[start].offset;
        let mut previous = 0.;
        let mut uniform = true;
        let last = normalized.len() - 1;
        for (index, stop) in normalized.iter_mut().enumerate().skip(start) {
            let offset = if index == last { 1. } else { stop.offset.clamp(previous, 1.) };
            uniform &= (step - (offset - previous)).abs() <= 1. / 4096.;
            stop.offset = offset;
            previous = offset;
        }
        // tiny-skia evaluates F*t+B, with f32 coefficients built on the host.
        // Keep its two-stop fast path and upper-bound hard-stop search semantics.
        let mut coefficients = Vec::<(f32, [f32; 4], [f32; 4])>::new();
        if normalized.len() == 2 {
            let c0 = normalized[0].color;
            let c1 = normalized[1].color;
            coefficients.push((0., std::array::from_fn(|i| c1[i] - c0[i]), c0));
        } else {
            let first = if normalized[0].color != normalized[1].color { 0 } else { 1 };
            let last = if normalized[normalized.len() - 2].color != normalized.last().unwrap().color {
                normalized.len() - 1
            } else {
                normalized.len() - 2
            };
            let mut left = normalized[first];
            coefficients.push((0., [0.; 4], left.color));
            for right in &normalized[first + 1..=last] {
                if left.offset < right.offset {
                    let factor = std::array::from_fn(|i| (right.color[i] - left.color[i]) / (right.offset - left.offset));
                    let bias = std::array::from_fn(|i| left.color[i] - factor[i] * left.offset);
                    coefficients.push((left.offset, factor, bias));
                }
                left = *right;
            }
            coefficients.push((left.offset, [0.; 4], left.color));
        }
        ensure!(coefficients.len() <= COEFFICIENTS, "gpu-draw-gradient-invalid");
        let mut values = vec![0.0_f32; BYTES as usize / 4];
        values[..4].copy_from_slice(&[combined.sx, combined.kx, combined.tx, 0.]);
        values[4..8].copy_from_slice(&[combined.ky, combined.sy, combined.ty, 0.]);
        values[12] = coefficients.len() as f32;
        values[13] = if opaque { 1. } else { 0. };
        values[14] = 1.; // Gradient: straight byte quantization before premultiply.
        values[15] = if uniform { 1. } else { 0. }; // CPU PadX1 only for uniform stops.
        for (index, (offset, factor, bias)) in coefficients.into_iter().enumerate() {
            values[16 + index] = offset;
            values[FACTORS + index * 4..FACTORS + index * 4 + 4].copy_from_slice(&factor);
            values[BIASES + index * 4..BIASES + index * 4 + 4].copy_from_slice(&bias);
        }
        ensure!(values.iter().all(|v| v.is_finite()), "gpu-draw-gradient-invalid");
        Ok(Self {
            bytes: values.into_iter().flat_map(f32::to_le_bytes).collect(),
        })
    }
}
struct Slot {
    params: wgpu::Buffer,
    previous: Vec<u8>,
    binding: Option<(wgpu::TextureView, wgpu::BindGroup)>,
}
pub(super) struct LinearPaintRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
    slots: Vec<Slot>,
}
impl LinearPaintRenderer {
    pub(super) fn new(device: wgpu::Device, queue: wgpu::Queue) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("baocut.linear-paint.layout"),
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
                        min_binding_size: wgpu::BufferSize::new(BYTES),
                    },
                    count: None,
                },
            ],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("baocut.linear-paint.shader"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("baocut.linear-paint.pipeline-layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("baocut.linear-paint.pipeline"),
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
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
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
    #[allow(clippy::too_many_arguments)]
    pub(super) fn encode(
        &mut self,
        slot: usize,
        mask: &wgpu::TextureView,
        output: &wgpu::TextureView,
        paint: &LinearPaint,
        support: Option<Support>,
        size: Size,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        ensure!(slot < 128, "gpu-draw-source-composite-limit");
        let Some(support) = support else {
            return Ok(());
        };
        ensure!(
            support.right <= size.width && support.bottom <= size.height && support.left < support.right && support.top < support.bottom,
            "gpu-draw-source-support-invalid"
        );
        while self.slots.len() <= slot {
            let params = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("baocut.linear-paint.params"),
                size: BYTES,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.slots.push(Slot {
                params,
                previous: Vec::new(),
                binding: None,
            });
        }
        let current = &mut self.slots[slot];
        if current.previous != paint.bytes {
            self.queue.write_buffer(&current.params, 0, &paint.bytes);
            current.previous = paint.bytes.clone();
        }
        if !current.binding.as_ref().is_some_and(|(previous, _)| previous == mask) {
            let binding = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("baocut.linear-paint.binding"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(mask),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: current.params.as_entire_binding(),
                    },
                ],
            });
            current.binding = Some((mask.clone(), binding));
        }
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("baocut.linear-paint.pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: output,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &current.binding.as_ref().unwrap().1, &[]);
        pass.set_scissor_rect(
            support.left,
            support.top,
            support.right - support.left,
            support.bottom - support.top,
        );
        pass.draw(0..3, 0..1);
        Ok(())
    }
    pub(super) fn finish_frame(&mut self, count: usize) {
        self.slots.truncate(count);
    }
}

#[cfg(test)]
mod tests {
    fn values(paint: super::LinearPaint) -> Vec<f32> {
        paint
            .bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
            .collect()
    }
    #[test]
    fn combined_gradient_matrix_and_straight_byte_mode_match_cpu_contract() {
        let stops = [
            super::GradientStop {
                offset: 0.,
                color: [1., 0., 0., 1.],
            },
            super::GradientStop {
                offset: 1.,
                color: [0., 1., 0., 0.5],
            },
        ];
        let p = values(super::LinearPaint::new([0., 0.], [0., 10.], &stops, [1., 0., 0., 1., 7., 11.]).unwrap());
        assert_eq!(&p[..3], &[0., 0.1, -1.1]);
        assert_eq!(&p[12..16], &[1., 0., 1., 1.]);
        assert_eq!(&p[super::FACTORS..super::FACTORS + 4], &[-1., 1., 0., -0.5]);
        assert_eq!(&p[super::BIASES..super::BIASES + 4], &[1., 0., 0., 1.]);
        let solid = values(super::LinearPaint::new([0., 0.], [0., 0.], &stops, [1., 0., 0., 1., 0., 0.]).unwrap());
        assert_eq!(&solid[12..16], &[1., 0., 0., 0.]);
        assert_eq!(&solid[super::BIASES..super::BIASES + 4], &[0., 1., 0., 0.5]);
    }
    #[test]
    fn hard_edges_capacity_and_nonfinite_coefficients_are_explicit() {
        let identity = [1., 0., 0., 1., 0., 0.];
        let stop = |offset, value| super::GradientStop {
            offset,
            color: [value, 0., 0., 1.],
        };
        let hard = values(
            super::LinearPaint::new(
                [0., 0.],
                [10., 0.],
                &[stop(0., 0.), stop(0.5, 0.), stop(0.5, 1.), stop(1., 1.)],
                identity,
            )
            .unwrap(),
        );
        assert_eq!(&hard[12..16], &[2., 1., 1., 0.]);
        assert_eq!(hard[17], 0.5);
        let stops: Vec<_> = (0..32).map(|i| stop(i as f32 / 31., (i % 2) as f32)).collect();
        let full = values(super::LinearPaint::new([0., 0.], [10., 0.], &stops, identity).unwrap());
        assert_eq!(full.len() * 4, 1264);
        assert_eq!(full[12], 33.);
        let bad = [stop(0., 0.), stop(f32::from_bits(1), 1.), stop(1., 0.)];
        assert!(super::LinearPaint::new([0., 0.], [10., 0.], &bad, identity).is_err());
    }
    #[test]
    fn shader_translates_to_glsl_es300() {
        let module = naga::front::wgsl::parse_str(super::SHADER).unwrap();
        let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
            .validate(&module)
            .unwrap();
        for (name, stage) in [
            ("vertex_main", naga::ShaderStage::Vertex),
            ("fragment_main", naga::ShaderStage::Fragment),
        ] {
            let mut output = String::new();
            naga::back::glsl::Writer::new(
                &mut output,
                &module,
                &info,
                &naga::back::glsl::Options {
                    version: naga::back::glsl::Version::Embedded {
                        version: 300,
                        is_webgl: true,
                    },
                    ..Default::default()
                },
                &naga::back::glsl::PipelineOptions {
                    shader_stage: stage,
                    entry_point: name.into(),
                    multiview: None,
                },
                naga::proc::BoundsCheckPolicies::default(),
            )
            .unwrap()
            .write()
            .unwrap();
        }
    }
}
