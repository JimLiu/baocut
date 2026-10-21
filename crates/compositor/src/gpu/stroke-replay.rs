//! Destination-aware integer replay of cached ordered AA events, with a small
//! evaluation target followed by an ROI overwrite. No storage-buffer features.
use super::linear_paint::LinearPaint;
use crate::stroke_coverage::StrokeCoverage;
use anyhow::{Result, ensure};
use std::{collections::BTreeMap, sync::Arc};
const SHADER: &str = include_str!("stroke-replay.wgsl");
const BUDGET: u64 = 64 * 1024 * 1024;
struct Resource {
    _events: wgpu::Texture,
    events: wgpu::TextureView,
    _values: wgpu::Texture,
    values: wgpu::TextureView,
    bytes: u64,
    stamp: u64,
}
struct Slot {
    params: wgpu::Buffer,
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
    size: [u32; 2],
}
pub(super) struct StrokeReplayRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    layout: wgpu::BindGroupLayout,
    replay: wgpu::RenderPipeline,
    copy: wgpu::RenderPipeline,
    resources: BTreeMap<[u8; 32], Resource>,
    bytes: u64,
    stamp: u64,
    slots: Vec<Slot>,
}
impl StrokeReplayRenderer {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue) -> Self {
        let texture = |binding, kind| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: kind,
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("baocut.stroke-replay.layout"),
            entries: &[
                texture(0, wgpu::TextureSampleType::Uint),
                texture(1, wgpu::TextureSampleType::Uint),
                texture(2, wgpu::TextureSampleType::Float { filterable: false }),
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: wgpu::BufferSize::new(1280),
                    },
                    count: None,
                },
            ],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("baocut.stroke-replay.shader"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("baocut.stroke-replay.pipeline-layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = |entry| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("baocut.stroke-replay.pipeline"),
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
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        let replay = pipeline("replay");
        let copy = pipeline("copy_roi");
        Self {
            device,
            queue,
            layout,
            replay,
            copy,
            resources: BTreeMap::new(),
            bytes: 0,
            stamp: 0,
            slots: Vec::new(),
        }
    }
    fn upload(&mut self, program: &StrokeCoverage) -> Result<()> {
        self.stamp = self.stamp.wrapping_add(1);
        if let Some(r) = self.resources.get_mut(&program.key) {
            r.stamp = self.stamp;
            return Ok(());
        }
        let [_, _, w, h] = program.region;
        let rows = program.values.len().max(1).div_ceil(2048) as u32;
        let bytes = u64::from(w) * u64::from(h) * 8 + u64::from(rows) * 2048;
        ensure!(bytes <= BUDGET, "gpu-stroke-program-texture-budget");
        while self.bytes.saturating_add(bytes) > BUDGET {
            let key = *self.resources.iter().min_by_key(|(_, r)| r.stamp).unwrap().0;
            self.bytes -= self.resources.remove(&key).unwrap().bytes;
        }
        let create = |width, height, format| {
            self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("baocut.stroke-replay.events"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            })
        };
        let events = create(w, h, wgpu::TextureFormat::Rg32Uint);
        let metadata: Vec<u8> = program
            .index
            .iter()
            .flat_map(|pair| pair.iter().flat_map(|v| v.to_le_bytes()))
            .collect();
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &events,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &metadata,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(w * 8),
                rows_per_image: Some(h),
            },
            wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
        );
        let values = create(2048, rows, wgpu::TextureFormat::R8Uint);
        let mut padded = vec![0; rows as usize * 2048];
        padded[..program.values.len()].copy_from_slice(&program.values);
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &values,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &padded,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(2048),
                rows_per_image: Some(rows),
            },
            wgpu::Extent3d {
                width: 2048,
                height: rows,
                depth_or_array_layers: 1,
            },
        );
        self.resources.insert(
            program.key,
            Resource {
                events: events.create_view(&Default::default()),
                values: values.create_view(&Default::default()),
                _events: events,
                _values: values,
                bytes,
                stamp: self.stamp,
            },
        );
        self.bytes += bytes;
        Ok(())
    }
    pub fn encode(
        &mut self,
        slot: usize,
        program: &Arc<StrokeCoverage>,
        paint: &LinearPaint,
        target: &wgpu::TextureView,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        ensure!(slot < 128, "gpu-stroke-program-slot-limit");
        self.upload(program)?;
        let [x, y, w, h] = program.region;
        let make = || {
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("baocut.stroke-replay.roi"),
                size: wgpu::Extent3d {
                    width: w,
                    height: h,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            });
            Slot {
                params: self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("baocut.stroke-replay.params"),
                    size: 1280,
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }),
                view: texture.create_view(&Default::default()),
                _texture: texture,
                size: [w, h],
            }
        };
        while self.slots.len() <= slot {
            self.slots.push(make());
        }
        if self.slots[slot].size != [w, h] {
            self.slots[slot] = make();
        }
        let s = &self.slots[slot];
        let r = &self.resources[&program.key];
        let mut params = paint.bytes.clone();
        for value in [x as f32, y as f32, w as f32, h as f32] {
            params.extend_from_slice(&value.to_le_bytes());
        }
        self.queue.write_buffer(&s.params, 0, &params);
        let binding = |input: &wgpu::TextureView| {
            self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("baocut.stroke-replay.binding"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&r.events),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(&r.values),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::TextureView(input),
                    },
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: s.params.as_entire_binding(),
                    },
                ],
            })
        };
        let read = binding(target);
        let copy = binding(&s.view);
        {
            let attachments = [Some(wgpu::RenderPassColorAttachment {
                view: &s.view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })];
            let mut p = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("baocut.stroke-replay.evaluate"),
                color_attachments: &attachments,
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
                multiview_mask: None,
            });
            p.set_pipeline(&self.replay);
            p.set_bind_group(0, &read, &[]);
            p.draw(0..3, 0..1);
        }
        {
            let attachments = [Some(wgpu::RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
            })];
            let mut p = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("baocut.stroke-replay.overwrite"),
                color_attachments: &attachments,
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
                multiview_mask: None,
            });
            p.set_scissor_rect(x, y, w, h);
            p.set_pipeline(&self.copy);
            p.set_bind_group(0, &copy, &[]);
            p.draw(0..3, 0..1);
        }
        Ok(())
    }
    pub fn finish_frame(&mut self, count: usize) {
        self.slots.truncate(count);
    }
    pub fn resident_bytes(&self) -> u64 {
        self.bytes
            + self
                .slots
                .iter()
                .map(|s| u64::from(s.size[0]) * u64::from(s.size[1]) * 4)
                .sum::<u64>()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn ordered_replay_translates_to_webgl2_without_optional_features() {
        let module = naga::front::wgsl::parse_str(super::SHADER).unwrap();
        let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
            .validate(&module)
            .unwrap();
        for (shader_stage, entry_point) in [
            (naga::ShaderStage::Vertex, "vertex_main"),
            (naga::ShaderStage::Fragment, "replay"),
            (naga::ShaderStage::Fragment, "copy_roi"),
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
                    shader_stage,
                    entry_point: entry_point.into(),
                    multiview: None,
                },
                Default::default(),
            )
            .unwrap()
            .write()
            .unwrap();
            assert!(output.starts_with("#version 300 es"));
        }
    }
}
