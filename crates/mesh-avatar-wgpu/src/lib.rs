//! Premultiplied-alpha rendering into caller-owned wgpu texture views.
use anyhow::{ensure, Context, Result};
use bytemuck::{Pod, Zeroable};
use mesh_avatar_core::{format::Texture, DrawLayer, FaceUniforms, Frame};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::mpsc, time::Duration};
pub use wgpu;
use wgpu::util::DeviceExt;

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Fit {
    #[default]
    Contain,
    Cover,
}
#[derive(Debug, Clone, Copy)]
pub struct ViewOptions {
    pub image_size: [u32; 2],
    pub pad_top: f64,
    pub pad_side: f64,
    pub fit: Fit,
}
impl ViewOptions {
    /// Target sizes are physical pixels; no device-pixel-ratio value is needed.
    pub fn transform(&self, size: [u32; 2]) -> Result<[f32; 4]> {
        ensure!(
            self.image_size.iter().chain(size.iter()).all(|&v| v > 0),
            "image and target dimensions must be positive"
        );
        ensure!(
            self.pad_top.is_finite()
                && self.pad_top > -1.0
                && self.pad_side.is_finite()
                && self.pad_side > -0.5,
            "invalid viewport margins"
        );
        let [iw, ih] = self.image_size.map(f64::from);
        let [w, h] = size.map(f64::from);
        let sx = w / (iw * (1.0 + 2.0 * self.pad_side));
        let sy = h / (ih * (1.0 + self.pad_top));
        let scale = match self.fit {
            Fit::Contain => sx.min(sy),
            Fit::Cover => sx.max(sy),
        };
        let ox = (w - iw * scale) / 2.0;
        let oy = (h - ih * scale)
            / match self.fit {
                Fit::Contain => 1.0,
                Fit::Cover => 2.0,
            };
        Ok([
            2.0 * scale / w,
            -2.0 * scale / h,
            -1.0 + 2.0 * ox / w,
            1.0 - 2.0 * oy / h,
        ]
        .map(|v| v as f32))
    }
}
#[repr(C, align(16))]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    scale_offset: [f32; 4],
    rect: [f32; 4],
    flags: [f32; 4],
    eye_box: [[f32; 4]; 2],
    eye_top: [[f32; 4]; 12],
    eye_bot: [[f32; 4]; 12],
    eyes: [[f32; 4]; 2],
    mouth: [f32; 4],
    mouth_state: [f32; 4],
    cheeks: [f32; 4],
}
impl Uniforms {
    fn new(transform: [f32; 4], layer: &DrawLayer, state: &FaceUniforms) -> Self {
        Self {
            scale_offset: transform,
            rect: layer.rect.map(|v| v as f32),
            flags: [
                match layer.texture.as_str() {
                    "sprites/eyes_half_0.png" => 4.0,
                    "sprites/eyes_half_1.png" => 5.0,
                    _ => layer
                        .eye_ball
                        .map_or(if layer.face { 1.0 } else { 0.0 }, |e| 2.0 + e as f32),
                },
                layer.alpha as f32,
                state.cheek,
                0.0,
            ],
            eye_box: state.eye_box,
            eye_top: std::array::from_fn(|i| {
                std::array::from_fn(|j| state.eye_top[(i * 4 + j) / 24][(i * 4 + j) % 24])
            }),
            eye_bot: std::array::from_fn(|i| {
                std::array::from_fn(|j| state.eye_bot[(i * 4 + j) / 24][(i * 4 + j) % 24])
            }),
            eyes: [
                state.eyes[..4].try_into().unwrap(),
                state.eyes[4..].try_into().unwrap(),
            ],
            mouth: state.mouth,
            mouth_state: state.mouth_state,
            cheeks: state.cheeks,
        }
    }
}
struct LayerBuffers {
    positions: wgpu::Buffer,
    uvs: wgpu::Buffer,
    indices: wgpu::Buffer,
    uniform: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    vertex_len: usize,
    index_len: u32,
}
struct Multisample {
    size: [u32; 2],
    view: wgpu::TextureView,
}

pub struct Renderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    format: wgpu::TextureFormat,
    sample_count: u32,
    pipeline: wgpu::RenderPipeline,
    uniform_layout: wgpu::BindGroupLayout,
    textures: BTreeMap<String, wgpu::BindGroup>,
    layers: BTreeMap<String, LayerBuffers>,
    multisample: Option<Multisample>,
}
fn texture_layout(device: &wgpu::Device) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("avatar texture layout"),
        entries: &[
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
        ],
    })
}
fn texture_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    view: &wgpu::TextureView,
    sampler: &wgpu::Sampler,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("avatar texture"),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    })
}
fn color_attachment<'a>(
    view: &'a wgpu::TextureView,
    resolve_target: Option<&'a wgpu::TextureView>,
) -> wgpu::RenderPassColorAttachment<'a> {
    wgpu::RenderPassColorAttachment {
        view,
        resolve_target,
        depth_slice: None,
        ops: wgpu::Operations {
            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
            store: wgpu::StoreOp::Store,
        },
    }
}
impl Renderer {
    /// Match WebGL's gamma-encoded arithmetic with an Unorm target, such as
    /// Rgba8Unorm or Bgra8Unorm. A swapchain may supply a compatible non-sRGB view.
    pub fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        format: wgpu::TextureFormat,
        sample_count: u32,
        images: &BTreeMap<String, Texture>,
    ) -> Result<Self> {
        ensure!(matches!(sample_count, 1 | 4), "sample count must be 1 or 4");
        ensure!(
            !format.is_srgb(),
            "use a non-sRGB texture view to match WebGL blending"
        );
        let uniform_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("avatar uniform layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: wgpu::BufferSize::new(std::mem::size_of::<Uniforms>() as u64),
                },
                count: None,
            }],
        });
        let texture_layout = texture_layout(device);
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("avatar pipeline layout"),
            bind_group_layouts: &[Some(&uniform_layout), Some(&texture_layout)],
            immediate_size: 0,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("avatar shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("avatar.wgsl").into()),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("avatar pipeline"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[
                    Some(wgpu::VertexBufferLayout {
                        array_stride: 8,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &wgpu::vertex_attr_array![0=>Float32x2],
                    }),
                    Some(wgpu::VertexBufferLayout {
                        array_stride: 8,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &wgpu::vertex_attr_array![1=>Float32x2],
                    }),
                ],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState {
                count: sample_count,
                ..Default::default()
            },
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("avatar linear mip sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        });
        let mip_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("avatar mipmap shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("mipmap.wgsl").into()),
        });
        let mip_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("mipmap layout"),
            bind_group_layouts: &[Some(&texture_layout)],
            immediate_size: 0,
        });
        let mip_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("mipmap pipeline"),
            layout: Some(&mip_layout),
            vertex: wgpu::VertexState {
                module: &mip_shader,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &mip_shader,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("avatar mipmaps"),
        });
        let mut textures = BTreeMap::new();
        for (name, image) in images {
            ensure!(
                image.width > 0
                    && image.height > 0
                    && image.width <= device.limits().max_texture_dimension_2d
                    && image.height <= device.limits().max_texture_dimension_2d,
                "texture {name}: invalid dimensions"
            );
            ensure!(
                image.rgba.len() as u64 == u64::from(image.width) * u64::from(image.height) * 4,
                "texture {name}: invalid RGBA length"
            );
            let levels = 32 - image.width.max(image.height).leading_zeros();
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some(name),
                size: wgpu::Extent3d {
                    width: image.width,
                    height: image.height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: levels,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::COPY_DST
                    | wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            });
            queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &texture,
                    mip_level: 0,
                    origin: Default::default(),
                    aspect: wgpu::TextureAspect::All,
                },
                &image.premultiplied_rgba(),
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(image.width * 4),
                    rows_per_image: Some(image.height),
                },
                texture.size(),
            );
            for level in 1..levels {
                let previous = texture.create_view(&wgpu::TextureViewDescriptor {
                    base_mip_level: level - 1,
                    mip_level_count: Some(1),
                    ..Default::default()
                });
                let target = texture.create_view(&wgpu::TextureViewDescriptor {
                    base_mip_level: level,
                    mip_level_count: Some(1),
                    ..Default::default()
                });
                let bind = texture_group(device, &texture_layout, &previous, &sampler);
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("generate avatar mip"),
                    color_attachments: &[Some(color_attachment(&target, None))],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
                pass.set_pipeline(&mip_pipeline);
                pass.set_bind_group(0, &bind, &[]);
                pass.draw(0..3, 0..1);
            }
            textures.insert(
                name.clone(),
                texture_group(
                    device,
                    &texture_layout,
                    &texture.create_view(&Default::default()),
                    &sampler,
                ),
            );
        }
        queue.submit([encoder.finish()]);
        Ok(Self {
            device: device.clone(),
            queue: queue.clone(),
            format,
            sample_count,
            pipeline,
            uniform_layout,
            textures,
            layers: BTreeMap::new(),
            multisample: None,
        })
    }
    /// Encode a transparent frame into the supplied single-sample texture view.
    /// The view's format must match the format passed to new().
    /// Submit the encoder before rendering another frame with this renderer.
    pub fn render(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        size: [u32; 2],
        frame: &Frame,
        view: &ViewOptions,
    ) -> Result<()> {
        let transform = view.transform(size)?;
        ensure!(
            size.iter()
                .all(|&v| v <= self.device.limits().max_texture_dimension_2d),
            "target exceeds GPU texture limits"
        );
        for layer in &frame.layers {
            if layer.indices.is_empty() {
                continue;
            }
            ensure!(
                self.textures.contains_key(&layer.texture),
                "missing GPU texture: {}",
                layer.texture
            );
            ensure!(
                layer.positions.len() == layer.uvs.len()
                    && layer.positions.len().is_multiple_of(2)
                    && layer
                        .indices
                        .iter()
                        .all(|&i| (i as usize) < layer.positions.len() / 2),
                "invalid mesh: {}",
                layer.name
            );
            if !self.layers.get(&layer.name).is_some_and(|old| {
                old.vertex_len == layer.positions.len()
                    && old.index_len as usize == layer.indices.len()
            }) {
                let buffer = |label, bytes: &[u8], usage| {
                    self.device
                        .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                            label: Some(label),
                            contents: bytes,
                            usage,
                        })
                };
                let uniform = self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("avatar uniforms"),
                    size: std::mem::size_of::<Uniforms>() as u64,
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                });
                let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("avatar uniforms"),
                    layout: &self.uniform_layout,
                    entries: &[wgpu::BindGroupEntry {
                        binding: 0,
                        resource: uniform.as_entire_binding(),
                    }],
                });
                self.layers.insert(
                    layer.name.clone(),
                    LayerBuffers {
                        positions: buffer(
                            "avatar positions",
                            bytemuck::cast_slice(&layer.positions),
                            wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                        ),
                        uvs: buffer(
                            "avatar UVs",
                            bytemuck::cast_slice(&layer.uvs),
                            wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                        ),
                        indices: buffer(
                            "avatar indices",
                            bytemuck::cast_slice(&layer.indices),
                            wgpu::BufferUsages::INDEX | wgpu::BufferUsages::COPY_DST,
                        ),
                        uniform,
                        bind_group,
                        vertex_len: layer.positions.len(),
                        index_len: layer.indices.len() as u32,
                    },
                );
            }
            let gpu = &self.layers[&layer.name];
            self.queue
                .write_buffer(&gpu.positions, 0, bytemuck::cast_slice(&layer.positions));
            self.queue
                .write_buffer(&gpu.uvs, 0, bytemuck::cast_slice(&layer.uvs));
            self.queue
                .write_buffer(&gpu.indices, 0, bytemuck::cast_slice(&layer.indices));
            self.queue.write_buffer(
                &gpu.uniform,
                0,
                bytemuck::bytes_of(&Uniforms::new(transform, layer, &frame.uniforms)),
            );
        }
        if self.sample_count > 1 && !self.multisample.as_ref().is_some_and(|m| m.size == size) {
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("avatar multisample target"),
                size: wgpu::Extent3d {
                    width: size[0],
                    height: size[1],
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: self.sample_count,
                dimension: wgpu::TextureDimension::D2,
                format: self.format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            });
            self.multisample = Some(Multisample {
                size,
                view: texture.create_view(&Default::default()),
            });
        }
        let attachment = if let Some(msaa) = &self.multisample {
            color_attachment(&msaa.view, Some(target))
        } else {
            color_attachment(target, None)
        };
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("avatar frame"),
            color_attachments: &[Some(attachment)],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        for layer in &frame.layers {
            if layer.indices.is_empty() {
                continue;
            }
            let gpu = &self.layers[&layer.name];
            pass.set_bind_group(0, &gpu.bind_group, &[]);
            pass.set_bind_group(1, &self.textures[&layer.texture], &[]);
            pass.set_vertex_buffer(0, gpu.positions.slice(..));
            pass.set_vertex_buffer(1, gpu.uvs.slice(..));
            pass.set_index_buffer(gpu.indices.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..gpu.index_len, 0, 0..1);
        }
        Ok(())
    }
    /// Render and read back straight RGBA, suitable for a PNG encoder.
    pub fn render_rgba(
        &mut self,
        frame: &Frame,
        size: [u32; 2],
        view: &ViewOptions,
    ) -> Result<Vec<u8>> {
        self.read_rgba(frame, size, view, true)
    }
    /// Render and read back tightly packed premultiplied RGBA8, top row first.
    pub fn render_rgba_premultiplied(
        &mut self,
        frame: &Frame,
        size: [u32; 2],
        view: &ViewOptions,
    ) -> Result<Vec<u8>> {
        self.read_rgba(frame, size, view, false)
    }
    fn read_rgba(
        &mut self,
        frame: &Frame,
        size: [u32; 2],
        view: &ViewOptions,
        straight: bool,
    ) -> Result<Vec<u8>> {
        ensure!(
            self.format == wgpu::TextureFormat::Rgba8Unorm,
            "RGBA readback requires Rgba8Unorm"
        );
        view.transform(size)?;
        ensure!(
            size.iter()
                .all(|&v| v <= self.device.limits().max_texture_dimension_2d),
            "target exceeds GPU texture limits"
        );
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("avatar offscreen target"),
            size: wgpu::Extent3d {
                width: size[0],
                height: size[1],
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let stride = (size[0] * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)
            * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("avatar readback"),
            size: u64::from(stride) * u64::from(size[1]),
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        self.render(
            &mut encoder,
            &texture.create_view(&Default::default()),
            size,
            frame,
            view,
        )?;
        encoder.copy_texture_to_buffer(
            texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(stride),
                    rows_per_image: Some(size[1]),
                },
            },
            texture.size(),
        );
        let submission = self.queue.submit([encoder.finish()]);
        let (send, receive) = mpsc::sync_channel(1);
        buffer
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                let _ = send.send(result);
            });
        self.device.poll(wgpu::PollType::Wait {
            submission_index: Some(submission),
            timeout: Some(Duration::from_secs(30)),
        })?;
        receive
            .recv_timeout(Duration::from_secs(30))
            .context("GPU readback timed out")??;
        let bytes = buffer
            .slice(..)
            .get_mapped_range()
            .map_err(|error| anyhow::anyhow!("cannot read the GPU readback buffer: {error}"))?;
        let mut out = Vec::with_capacity((size[0] * size[1] * 4) as usize);
        for row in bytes.chunks_exact(stride as usize) {
            if !straight {
                out.extend_from_slice(&row[..(size[0] * 4) as usize]);
                continue;
            }
            for p in row[..(size[0] * 4) as usize].as_chunks::<4>().0 {
                let alpha = u32::from(p[3]);
                let unpremultiply = |value: u8| {
                    (u32::from(value) * 255 + alpha / 2)
                        .checked_div(alpha)
                        .unwrap_or(0)
                        .min(255) as u8
                };
                out.extend([
                    unpremultiply(p[0]),
                    unpremultiply(p[1]),
                    unpremultiply(p[2]),
                    p[3],
                ]);
            }
        }
        drop(bytes);
        buffer.unmap();
        Ok(out)
    }
}

pub async fn headless_device() -> Result<(wgpu::Device, wgpu::Queue, wgpu::AdapterInfo)> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
            ..Default::default()
        })
        .await
        .context("no compatible GPU adapter")?;
    let info = adapter.get_info();
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("mesh avatar"),
            ..Default::default()
        })
        .await?;
    Ok((device, queue, info))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gpu_transparency_and_dynamic_mesh_updates() {
        let Ok((device, queue, _)) = pollster::block_on(headless_device()) else {
            eprintln!("GPU adapter unavailable; skipping GPU readback check.");
            return;
        };
        let mut images = BTreeMap::from([(
            "quad.png".into(),
            Texture {
                width: 2,
                height: 2,
                rgba: [200, 100, 50, 128].repeat(4),
            },
        )]);
        images.insert(
            "overlays/frame.png".into(),
            Texture {
                width: 2,
                height: 2,
                rgba: [20, 200, 80, 255].repeat(4),
            },
        );
        let mut renderer =
            Renderer::new(&device, &queue, wgpu::TextureFormat::Rgba8Unorm, 1, &images).unwrap();
        let mut frame = Frame {
            layers: vec![DrawLayer {
                name: "quad".into(),
                texture: "quad.png".into(),
                rect: [1.0, 1.0, 2.0, 2.0],
                positions: vec![1.0, 1.0, 3.0, 1.0, 1.0, 3.0, 3.0, 3.0],
                uvs: vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0],
                indices: vec![0, 1, 2, 1, 3, 2],
                alpha: 1.0,
                face: false,
                eye_ball: None,
            }],
            uniforms: FaceUniforms {
                angles: [0.0; 3],
                eye_box: [[0.0; 4]; 2],
                eye_top: [[0.0; 24]; 2],
                eye_bot: [[0.0; 24]; 2],
                eyes: [0.0; 8],
                mouth: [0.0; 4],
                mouth_state: [0.0; 4],
                cheeks: [0.0; 4],
                cheek: 0.0,
            },
            motion_events: vec![],
        };
        let view = ViewOptions {
            image_size: [4, 4],
            pad_top: 0.0,
            pad_side: 0.0,
            fit: Fit::Contain,
        };
        let first = renderer.render_rgba(&frame, [8, 8], &view).unwrap();
        assert_eq!(&first[..4], &[0, 0, 0, 0]);
        let center = (4 * 8 + 4) * 4;
        for (actual, expected) in first[center..center + 4].iter().zip([200_u8, 100, 50, 128]) {
            assert!(actual.abs_diff(expected) <= 1);
        }
        let premultiplied = renderer
            .render_rgba_premultiplied(&frame, [8, 8], &view)
            .unwrap();
        assert_eq!(&premultiplied[..4], &[0, 0, 0, 0]);
        for (actual, expected) in premultiplied[center..center + 4]
            .iter()
            .zip([100_u8, 50, 25, 128])
        {
            assert!(actual.abs_diff(expected) <= 1);
        }
        let mut overlay = frame.layers[0].clone();
        overlay.name = "overlay_glasses".into();
        overlay.texture = "overlays/frame.png".into();
        frame.layers.push(overlay);
        let front = renderer.render_rgba(&frame, [8, 8], &view).unwrap();
        assert_eq!(&front[center..center + 4], &[20, 200, 80, 255]);
        // Later layers (including tassels and the hand) must still draw above overlays.
        frame.layers.swap(0, 1);
        let behind = renderer.render_rgba(&frame, [8, 8], &view).unwrap();
        for (actual, expected) in behind[center..center + 4]
            .iter()
            .zip([110_u8, 150, 65, 255])
        {
            assert!(actual.abs_diff(expected) <= 1);
        }
        frame.layers.remove(0);
        assert_eq!(renderer.render_rgba(&frame, [8, 8], &view).unwrap(), first);
        for position in frame.layers[0].positions.as_chunks_mut::<2>().0 {
            position[0] += 1.0;
        }
        let second = renderer.render_rgba(&frame, [8, 8], &view).unwrap();
        assert_eq!(&second[(3 * 8 + 2) * 4..(3 * 8 + 2) * 4 + 4], &[0, 0, 0, 0]);
        assert_eq!(second[(3 * 8 + 6) * 4 + 3], 128);
    }
    #[test]
    fn contain_bottom_anchor_and_centered_cover_match_js() {
        let mut view = ViewOptions {
            image_size: [1000, 1000],
            pad_top: 0.0,
            pad_side: 0.0,
            fit: Fit::Contain,
        };
        assert_eq!(
            view.transform([1000, 500]).unwrap(),
            [0.001, -0.002, -0.5, 1.0]
        );
        view.fit = Fit::Cover;
        assert_eq!(
            view.transform([1000, 500]).unwrap(),
            [0.002, -0.004, -1.0, 2.0]
        );
        assert!(view.transform([0, 500]).is_err());
        view.pad_side = -0.5;
        assert!(view.transform([1000, 500]).is_err());
        assert_eq!(std::mem::size_of::<Uniforms>(), 544);
    }
}
