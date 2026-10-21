use std::collections::HashMap;

use anyhow::{Context, Result, bail};
use timeline_render::{
    GLYPH_RUN_UNIFORM_LIMIT, GlyphCompositeMode, GlyphInstance, GlyphPaint, GlyphPixels, GlyphRun, GlyphTexture, GlyphTextureKey,
    SCENE_GLYPH_STROKE_WIDTH_LIMIT, SCENE_GLYPH_TEXTURE_SIZE_LIMIT, ScenePose, post_concat_mat6,
};

use crate::{AtlasRect, GlyphAtlas, GlyphAtlasStats, GlyphRequest};

const ATLAS_SIZE: u32 = 2048;
const ATLAS_PADDING: u32 = 1;
const GLYPH_STROKE_SPREAD: f32 = SCENE_GLYPH_STROKE_WIDTH_LIMIT * 0.5;
const PATTERN_TEXTURE_CACHE_LIMIT: usize = 16;

const SHADER: &str = r#"
struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) color: vec4f,
    @location(2) @interpolate(flat) color_glyph: u32,
    @location(3) color_opacity: f32,
    @location(4) clip_position: vec2f,
    @location(5) @interpolate(flat) clip_rect: vec4f,
    @location(6) @interpolate(flat) clip_enabled: u32,
    @location(7) paint_position: vec2f,
    @location(8) @interpolate(flat) gradient_points: vec4f,
    @location(9) @interpolate(flat) gradient_first: vec4f,
    @location(10) @interpolate(flat) gradient_middle: vec4f,
    @location(11) @interpolate(flat) mask_rect: vec4f,
    @location(12) @interpolate(flat) stroke_width: f32,
    @location(13) @interpolate(flat) pattern_enabled: u32,
    @location(14) @interpolate(flat) area_coverage: u32,
}

@group(0) @binding(0) var glyph_mask_atlas: texture_2d<f32>;
@group(0) @binding(1) var glyph_color_atlas: texture_2d<f32>;
@group(0) @binding(2) var glyph_sampler: sampler;
@group(0) @binding(3) var glyph_pattern: texture_2d<f32>;
@group(0) @binding(4) var glyph_pattern_sampler: sampler;
@group(1) @binding(0) var run_uniforms: texture_2d<f32>;

@vertex
fn vertex_main(
    @location(0) position: vec2f,
    @location(1) uv: vec2f,
    @location(2) run_index: u32,
    @location(3) color_glyph: u32,
    @location(4) paint_position: vec2f,
    @location(5) mask_rect: vec4f,
) -> VertexOut {
    let row = i32(run_index);
    let clip_x = textureLoad(run_uniforms, vec2i(0, row), 0);
    let clip_y = textureLoad(run_uniforms, vec2i(1, row), 0);
    let color = textureLoad(run_uniforms, vec2i(2, row), 0);
    let clip_rect = textureLoad(run_uniforms, vec2i(3, row), 0);
    let gradient_points = textureLoad(run_uniforms, vec2i(4, row), 0);
    let gradient_first = textureLoad(run_uniforms, vec2i(5, row), 0);
    let gradient_middle = textureLoad(run_uniforms, vec2i(6, row), 0);
    let stroke = textureLoad(run_uniforms, vec2i(7, row), 0);
    let point = vec4f(position, 1.0, 0.0);
    var out: VertexOut;
    out.position = vec4f(dot(clip_x, point), dot(clip_y, point), 0.0, 1.0);
    out.uv = uv;
    out.color = color;
    out.color_glyph = color_glyph;
    out.color_opacity = clip_x.w;
    out.clip_position = position;
    out.clip_rect = clip_rect;
    out.clip_enabled = select(0u, 1u, clip_y.w > 0.5);
    out.paint_position = paint_position;
    out.gradient_points = gradient_points;
    out.gradient_first = gradient_first;
    out.gradient_middle = gradient_middle;
    out.mask_rect = mask_rect;
    out.stroke_width = stroke.x;
    out.pattern_enabled = select(0u, 1u, stroke.y > 0.5);
    out.area_coverage = select(0u, 1u, stroke.z > 0.5);
    return out;
}

fn mask_sample(uv: vec2f, rect: vec4f) -> f32 {
    let inside = uv.x >= rect.x && uv.y >= rect.y && uv.x <= rect.z && uv.y <= rect.w;
    let safe_uv = clamp(uv, rect.xy, rect.zw);
    return select(0.0, textureSampleLevel(glyph_mask_atlas, glyph_sampler, safe_uv, 0.0).r, inside);
}

fn dilated_coverage(uv: vec2f, rect: vec4f, width: f32) -> f32 {
    var coverage = mask_sample(uv, rect);
    let radius = clamp(width * 0.5, 0.0, 8.0);
    if radius <= 0.001 {
        return coverage;
    }
    let texel = 1.0 / vec2f(textureDimensions(glyph_mask_atlas));
    let directions = array<vec2f, 16>(
        vec2f(1.0, 0.0), vec2f(0.923880, 0.382683),
        vec2f(0.707107, 0.707107), vec2f(0.382683, 0.923880),
        vec2f(0.0, 1.0), vec2f(-0.382683, 0.923880),
        vec2f(-0.707107, 0.707107), vec2f(-0.923880, 0.382683),
        vec2f(-1.0, 0.0), vec2f(-0.923880, -0.382683),
        vec2f(-0.707107, -0.707107), vec2f(-0.382683, -0.923880),
        vec2f(0.0, -1.0), vec2f(0.382683, -0.923880),
        vec2f(0.707107, -0.707107), vec2f(0.923880, -0.382683),
    );
    for (var index = 0u; index < 16u; index += 1u) {
        let direction = directions[index] * texel;
        coverage = max(coverage, mask_sample(uv + direction * radius, rect));
        coverage = max(coverage, mask_sample(uv + direction * radius * 0.5, rect));
    }
    return coverage;
}

fn area_coverage(uv: vec2f, rect: vec4f, dx: vec2f, dy: vec2f) -> f32 {
    let dimensions = vec2f(textureDimensions(glyph_mask_atlas));
    let nx = u32(clamp(ceil(length(dx * dimensions) - 0.0001), 1.0, 8.0));
    let ny = u32(clamp(ceil(length(dy * dimensions) - 0.0001), 1.0, 8.0));
    var coverage = 0.0;
    for (var y = 0u; y < ny; y += 1u) {
        for (var x = 0u; x < nx; x += 1u) {
            let offset = dx * ((f32(x) + 0.5) / f32(nx) - 0.5)
                + dy * ((f32(y) + 0.5) / f32(ny) - 0.5);
            coverage += mask_sample(uv + offset, rect);
        }
    }
    return coverage / f32(nx * ny);
}

@fragment
fn fragment_main(input: VertexOut) -> @location(0) vec4f {
    let coverage_dx = dpdx(input.uv);
    let coverage_dy = dpdy(input.uv);
    if input.clip_enabled != 0u
        && (input.clip_rect.z <= input.clip_rect.x
            || input.clip_rect.w <= input.clip_rect.y
            || input.clip_position.x < input.clip_rect.x
            || input.clip_position.x > input.clip_rect.z
            || input.clip_position.y < input.clip_rect.y
            || input.clip_position.y > input.clip_rect.w) {
        discard;
    }
    if input.color_glyph != 0u {
        let color = textureSampleLevel(glyph_color_atlas, glyph_sampler, input.uv, 0.0);
        return color * clamp(input.color_opacity, 0.0, 1.0);
    }
    var coverage = dilated_coverage(input.uv, input.mask_rect, input.stroke_width);
    if input.area_coverage != 0u {
        coverage = area_coverage(input.uv, input.mask_rect, coverage_dx, coverage_dy);
    }
    if input.pattern_enabled != 0u {
        let pattern_size = vec2f(textureDimensions(glyph_pattern));
        let pattern = textureSampleLevel(
            glyph_pattern,
            glyph_pattern_sampler,
            input.paint_position / pattern_size,
            0.0,
        );
        return pattern * (coverage * clamp(input.color_opacity, 0.0, 1.0));
    }
    let gradient_axis = input.gradient_points.zw - input.gradient_points.xy;
    let gradient_length_squared = dot(gradient_axis, gradient_axis);
    var color = input.color;
    if gradient_length_squared > 0.000001 {
        let phase = fract(
            dot(input.paint_position - input.gradient_points.xy, gradient_axis)
                / gradient_length_squared
        );
        let middle_weight = 1.0 - abs(phase * 2.0 - 1.0);
        color = mix(input.gradient_first, input.gradient_middle, middle_weight);
    }
    let alpha = clamp(color.a, 0.0, 1.0) * coverage;
    if input.area_coverage != 0u {
        // DrawOp solid paint is quantized before AA coverage by the CPU lowp
        // pipeline. Keep that order; generic retained scenes use the float path.
        let a = clamp(color.a, 0.0, 1.0);
        let bytes = floor(vec4f(clamp(color.rgb, vec3f(0), vec3f(1)) * a, a) * 255.0 + vec4f(0.5));
        let mask_byte = floor(clamp(coverage, 0.0, 1.0) * 255.0 + 0.5);
        return floor((bytes * mask_byte + vec4f(255.0)) / 256.0) / 255.0;
    }
    return vec4f(clamp(color.rgb, vec3f(0.0), vec3f(1.0)) * alpha, alpha);
}
"#;

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct Vertex {
    position: [f32; 2],
    uv: [f32; 2],
    run_index: u32,
    color_glyph: u32,
    paint_position: [f32; 2],
    mask_rect: [f32; 4],
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct GpuRunUniform {
    clip_x: [f32; 4],
    clip_y: [f32; 4],
    color: [f32; 4],
    clip_rect: [f32; 4],
    gradient_points: [f32; 4],
    gradient_first: [f32; 4],
    gradient_middle: [f32; 4],
    stroke: [f32; 4],
}

pub(super) struct GlyphRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    atlas: GlyphAtlas,
    color_atlas: GlyphAtlas,
    mask_texture: wgpu::Texture,
    color_texture: wgpu::Texture,
    bind_layout: wgpu::BindGroupLayout,
    bind_group: wgpu::BindGroup,
    uniform_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    pattern_sampler: wgpu::Sampler,
    dummy_pattern: wgpu::Texture,
    patterns: HashMap<GlyphTextureKey, CachedPattern>,
    pattern_tick: u64,
    pipelines: HashMap<(wgpu::TextureFormat, GlyphCompositeMode), wgpu::RenderPipeline>,
    meshes: Vec<MeshBuffer>,
    binding_rebuilds: u64,
    atlas_generation: u64,
    geometry_writes: u64,
    uniform_writes: u64,
    source_coverage_sampling: bool,
}

struct CachedPattern {
    width: u32,
    height: u32,
    rgba: std::sync::Arc<[u8]>,
    texture: wgpu::Texture,
    bind_group: wgpu::BindGroup,
    last_used: u64,
}

struct MeshBuffer {
    vertices: wgpu::Buffer,
    vertex_capacity: u64,
    uniforms: wgpu::Texture,
    uniform_bind_group: wgpu::BindGroup,
    geometry: Option<std::sync::Arc<[timeline_render::GlyphInstance]>>,
    atlas_generation: u64,
}

impl GlyphRenderer {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue) -> Self {
        let atlas = GlyphAtlas::new(ATLAS_SIZE, ATLAS_SIZE, ATLAS_PADDING).expect("fixed glyph atlas size is valid");
        let color_atlas = GlyphAtlas::new(ATLAS_SIZE, ATLAS_SIZE, ATLAS_PADDING).expect("fixed color glyph atlas size is valid");
        let bind_layout = bind_layout(&device);
        let uniform_layout = uniform_layout(&device);
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("bcut.glyph.sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });
        let pattern_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("bcut.glyph.pattern-sampler"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::Repeat,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });
        let mask_texture = atlas_texture(&device, false);
        let color_texture = atlas_texture(&device, true);
        let dummy_pattern = pattern_texture(&device, 1, 1);
        let bind_group = atlas_bind_group(
            &device,
            &bind_layout,
            &mask_texture,
            &color_texture,
            &sampler,
            &dummy_pattern,
            &pattern_sampler,
        );
        Self {
            device,
            queue,
            atlas,
            color_atlas,
            mask_texture,
            color_texture,
            bind_layout,
            bind_group,
            uniform_layout,
            sampler,
            pattern_sampler,
            dummy_pattern,
            patterns: HashMap::new(),
            pattern_tick: 0,
            pipelines: HashMap::new(),
            meshes: Vec::new(),
            binding_rebuilds: 0,
            atlas_generation: 0,
            geometry_writes: 0,
            uniform_writes: 0,
            source_coverage_sampling: false,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn encode_to_view(
        &mut self,
        slot: usize,
        run: &GlyphRun,
        view: &wgpu::TextureView,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
        clear: bool,
        presentation_time: Option<f64>,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        validate_run(run)?;
        let masks = run
            .glyphs
            .iter()
            .map(|glyph| (glyph.mask.key, glyph.mask.as_ref()))
            .collect::<HashMap<_, _>>();
        let mask_requests = run
            .glyphs
            .iter()
            .filter(|glyph| !glyph.mask.pixels.is_color())
            .map(glyph_request)
            .collect::<Vec<_>>();
        let color_requests = run
            .glyphs
            .iter()
            .filter(|glyph| glyph.mask.pixels.is_color())
            .map(glyph_request)
            .collect::<Vec<_>>();
        let mask_prepared = self.atlas.prepare(&mask_requests)?;
        let color_prepared = self.color_atlas.prepare(&color_requests)?;
        if mask_prepared.reset {
            // 纹理换代发生在帧边界。wgpu 会把旧纹理的真实销毁推迟到已提交工作
            // 不再引用它；新纹理按 WebGPU 初始化规则为零，padding 不会采到旧 mask。
            self.mask_texture = atlas_texture(&self.device, false);
        }
        if color_prepared.reset {
            self.color_texture = atlas_texture(&self.device, true);
        }
        if mask_prepared.reset || color_prepared.reset {
            self.bind_group = atlas_bind_group(
                &self.device,
                &self.bind_layout,
                &self.mask_texture,
                &self.color_texture,
                &self.sampler,
                &self.dummy_pattern,
                &self.pattern_sampler,
            );
            for pattern in self.patterns.values_mut() {
                pattern.bind_group = atlas_bind_group(
                    &self.device,
                    &self.bind_layout,
                    &self.mask_texture,
                    &self.color_texture,
                    &self.sampler,
                    &pattern.texture,
                    &self.pattern_sampler,
                );
            }
            self.binding_rebuilds += 1;
            self.atlas_generation += 1;
        }
        let mask_placements = mask_requests
            .iter()
            .zip(&mask_prepared.placements)
            .map(|(request, rect)| (request.key, *rect))
            .collect::<HashMap<_, _>>();
        let color_placements = color_requests
            .iter()
            .zip(&color_prepared.placements)
            .map(|(request, rect)| (request.key, *rect))
            .collect::<HashMap<_, _>>();
        let placements = run
            .glyphs
            .iter()
            .map(|glyph| {
                let placements = if glyph.mask.pixels.is_color() {
                    &color_placements
                } else {
                    &mask_placements
                };
                placements
                    .get(&glyph.mask.key)
                    .copied()
                    .with_context(|| format!("glyph-atlas-placement-missing: {:?}", glyph.mask.key))
            })
            .collect::<Result<Vec<_>>>()?;
        for key in mask_prepared.uploads {
            let mask = masks.get(&key).with_context(|| format!("glyph-atlas-upload-missing: {key:?}"))?;
            let rect = mask_placements
                .get(&key)
                .with_context(|| format!("glyph-atlas-placement-missing: {key:?}"))?;
            let GlyphPixels::Alpha(alpha) = &mask.pixels else {
                bail!("glyph-atlas-kind-conflict: {key:?} expected alpha");
            };
            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.mask_texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: rect.x,
                        y: rect.y,
                        z: 0,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                alpha,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(mask.width),
                    rows_per_image: Some(mask.height),
                },
                wgpu::Extent3d {
                    width: mask.width,
                    height: mask.height,
                    depth_or_array_layers: 1,
                },
            );
        }
        for key in color_prepared.uploads {
            let glyph = masks
                .get(&key)
                .with_context(|| format!("color-glyph-atlas-upload-missing: {key:?}"))?;
            let rect = color_placements
                .get(&key)
                .with_context(|| format!("color-glyph-atlas-placement-missing: {key:?}"))?;
            let GlyphPixels::Color(rgba) = &glyph.pixels else {
                bail!("glyph-atlas-kind-conflict: {key:?} expected color");
            };
            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.color_texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: rect.x,
                        y: rect.y,
                        z: 0,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                rgba,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(glyph.width * 4),
                    rows_per_image: Some(glyph.height),
                },
                wgpu::Extent3d {
                    width: glyph.width,
                    height: glyph.height,
                    depth_or_array_layers: 1,
                },
            );
        }

        let geometry_is_current = self.meshes.get(slot).is_some_and(|mesh| {
            mesh.atlas_generation == self.atlas_generation
                && mesh
                    .geometry
                    .as_ref()
                    .is_some_and(|cached| std::sync::Arc::ptr_eq(cached, &run.glyphs))
        });
        let vertices = (!geometry_is_current)
            .then(|| vertices(run, &placements, self.atlas.size()))
            .transpose()?;
        let vertex_byte_len = run.glyphs.len() * 6 * std::mem::size_of::<Vertex>();
        let pose = presentation_time
            .and_then(|time| run.motion.as_ref().map(|motion| motion.sample(time)))
            .unwrap_or(run.pose);
        let mut gpu_uniforms = gpu_run_uniforms(run, pose, width, height)?;
        if self.source_coverage_sampling {
            for uniform in &mut gpu_uniforms {
                uniform.stroke[2] = 1.0;
            }
        }
        let uniform_bytes = uniform_bytes(&gpu_uniforms);
        self.ensure_buffer(slot, vertex_byte_len as u64)?;
        if !uniform_bytes.is_empty() {
            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.meshes[slot].uniforms,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                uniform_bytes,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(std::mem::size_of::<GpuRunUniform>() as u32),
                    rows_per_image: Some(gpu_uniforms.len() as u32),
                },
                wgpu::Extent3d {
                    width: 8,
                    height: gpu_uniforms.len() as u32,
                    depth_or_array_layers: 1,
                },
            );
            self.uniform_writes += 1;
        }
        if let Some(vertices) = vertices {
            let vertex_bytes = vertex_bytes(&vertices);
            if !vertex_bytes.is_empty() {
                self.queue.write_buffer(&self.meshes[slot].vertices, 0, vertex_bytes);
                self.geometry_writes += 1;
            }
            self.meshes[slot].geometry = Some(std::sync::Arc::clone(&run.glyphs));
            self.meshes[slot].atlas_generation = self.atlas_generation;
        }
        let bind_group = self.pattern_bind_group(run.texture.as_ref())?;
        let pipeline = self.pipeline(format, run.composite);
        let mesh = &self.meshes[slot];
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("bcut.compositor.glyph.pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
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
            if !run.glyphs.is_empty() {
                pass.set_pipeline(&pipeline);
                pass.set_bind_group(0, &bind_group, &[]);
                pass.set_bind_group(1, &mesh.uniform_bind_group, &[]);
                pass.set_vertex_buffer(0, mesh.vertices.slice(..vertex_byte_len as u64));
                pass.draw(0..(run.glyphs.len() * 6) as u32, 0..1);
            }
        }
        Ok(())
    }

    pub(super) fn set_source_coverage_sampling(&mut self, enabled: bool) {
        self.source_coverage_sampling = enabled;
    }
    pub fn finish_frame(&mut self, used_slots: usize) {
        self.meshes.truncate(used_slots);
    }

    pub fn binding_rebuilds(&self) -> u64 {
        self.binding_rebuilds
    }

    pub fn atlas_stats(&self) -> GlyphAtlasStats {
        self.atlas.stats()
    }

    pub fn color_atlas_stats(&self) -> GlyphAtlasStats {
        self.color_atlas.stats()
    }

    pub fn geometry_writes(&self) -> u64 {
        self.geometry_writes
    }

    pub fn uniform_writes(&self) -> u64 {
        self.uniform_writes
    }

    fn ensure_buffer(&mut self, slot: usize, vertex_size: u64) -> Result<()> {
        if slot == self.meshes.len() {
            self.meshes.push(MeshBuffer::new(&self.device, &self.uniform_layout));
        } else if slot > self.meshes.len() {
            bail!("gpu-glyph-slot-invalid: requested {slot}, next is {}", self.meshes.len());
        }
        let mesh = &mut self.meshes[slot];
        if vertex_size > mesh.vertex_capacity {
            mesh.vertex_capacity = vertex_size.next_power_of_two();
            mesh.vertices = vertex_buffer(&self.device, mesh.vertex_capacity);
            mesh.geometry = None;
        }
        Ok(())
    }

    fn pattern_bind_group(&mut self, pattern: Option<&std::sync::Arc<GlyphTexture>>) -> Result<wgpu::BindGroup> {
        let Some(pattern) = pattern else {
            return Ok(self.bind_group.clone());
        };
        self.pattern_tick = self.pattern_tick.wrapping_add(1);
        if let Some(cached) = self.patterns.get_mut(&pattern.key) {
            if cached.width != pattern.width || cached.height != pattern.height || cached.rgba.as_ref() != pattern.rgba.as_ref() {
                bail!("glyph-pattern-key-content-conflict: {:?}", pattern.key);
            }
            cached.last_used = self.pattern_tick;
            return Ok(cached.bind_group.clone());
        }
        if self.patterns.len() >= PATTERN_TEXTURE_CACHE_LIMIT
            && let Some(oldest) = self.patterns.iter().min_by_key(|(_, cached)| cached.last_used).map(|(key, _)| *key)
        {
            self.patterns.remove(&oldest);
        }
        let texture = pattern_texture(&self.device, pattern.width, pattern.height);
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &pattern.rgba,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(pattern.width * 4),
                rows_per_image: Some(pattern.height),
            },
            wgpu::Extent3d {
                width: pattern.width,
                height: pattern.height,
                depth_or_array_layers: 1,
            },
        );
        let bind_group = atlas_bind_group(
            &self.device,
            &self.bind_layout,
            &self.mask_texture,
            &self.color_texture,
            &self.sampler,
            &texture,
            &self.pattern_sampler,
        );
        self.patterns.insert(
            pattern.key,
            CachedPattern {
                width: pattern.width,
                height: pattern.height,
                rgba: std::sync::Arc::clone(&pattern.rgba),
                texture,
                bind_group: bind_group.clone(),
                last_used: self.pattern_tick,
            },
        );
        self.binding_rebuilds += 1;
        Ok(bind_group)
    }

    fn pipeline(&mut self, format: wgpu::TextureFormat, composite: GlyphCompositeMode) -> wgpu::RenderPipeline {
        let key = (format, composite);
        if let Some(pipeline) = self.pipelines.get(&key) {
            return pipeline.clone();
        }
        let module = self.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("bcut.compositor.glyph.wgsl"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let layout = self.device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("bcut.compositor.glyph.pipeline-layout"),
            bind_group_layouts: &[Some(&self.bind_layout), Some(&self.uniform_layout)],
            immediate_size: 0,
        });
        let pipeline = self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("bcut.compositor.glyph.pipeline"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vertex_main"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<Vertex>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &[
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x2,
                            offset: 0,
                            shader_location: 0,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x2,
                            offset: 8,
                            shader_location: 1,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Uint32,
                            offset: 16,
                            shader_location: 2,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Uint32,
                            offset: 20,
                            shader_location: 3,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x2,
                            offset: 24,
                            shader_location: 4,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x4,
                            offset: 32,
                            shader_location: 5,
                        },
                    ],
                })],
            },
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fragment_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(super::scene_blend_state(composite)),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        self.pipelines.insert(key, pipeline.clone());
        pipeline
    }
}

impl MeshBuffer {
    fn new(device: &wgpu::Device, uniform_layout: &wgpu::BindGroupLayout) -> Self {
        let uniforms = uniform_texture(device);
        let uniform_bind_group = uniform_bind_group(device, uniform_layout, &uniforms);
        Self {
            vertices: vertex_buffer(device, 4),
            vertex_capacity: 4,
            uniforms,
            uniform_bind_group,
            geometry: None,
            atlas_generation: 0,
        }
    }
}

fn validate_run(run: &GlyphRun) -> Result<()> {
    if run.uniforms.len() > GLYPH_RUN_UNIFORM_LIMIT {
        bail!("glyph-run-uniform-limit: {} > {GLYPH_RUN_UNIFORM_LIMIT}", run.uniforms.len());
    }
    if run.glyphs.len() > u32::MAX as usize / 6 {
        bail!("glyph-run-vertex-limit: {}", run.glyphs.len());
    }
    let uses_pattern = run.uniforms.iter().any(|uniform| uniform.paint == GlyphPaint::RepeatTexture);
    if uses_pattern != run.texture.is_some() {
        bail!("glyph-run-pattern-resource-mismatch");
    }
    if let Some(texture) = &run.texture
        && (texture.width == 0
            || texture.height == 0
            || texture.width > SCENE_GLYPH_TEXTURE_SIZE_LIMIT
            || texture.height > SCENE_GLYPH_TEXTURE_SIZE_LIMIT
            || (texture.width as usize)
                .checked_mul(texture.height as usize)
                .and_then(|pixels| pixels.checked_mul(4))
                != Some(texture.rgba.len()))
    {
        bail!(
            "glyph-run-pattern-invalid: {}x{} bytes={}",
            texture.width,
            texture.height,
            texture.rgba.len()
        );
    }
    for uniform in &run.uniforms {
        if let GlyphPaint::DilatedStroke { width } = uniform.paint
            && (!width.is_finite() || !(0.0..=SCENE_GLYPH_STROKE_WIDTH_LIMIT).contains(&width))
        {
            bail!("glyph-run-stroke-width-invalid: {width} not in 0..={SCENE_GLYPH_STROKE_WIDTH_LIMIT}");
        }
    }
    let mut kinds = HashMap::new();
    for glyph in run.glyphs.iter() {
        if glyph.uniform_index as usize >= run.uniforms.len() {
            bail!("glyph-run-uniform-index: {} >= {}", glyph.uniform_index, run.uniforms.len());
        }
        let color = glyph.mask.pixels.is_color();
        if let Some(previous) = kinds.insert(glyph.mask.key, color)
            && previous != color
        {
            bail!("glyph-atlas-key-kind-conflict: {:?}", glyph.mask.key);
        }
    }
    Ok(())
}

fn glyph_request(glyph: &GlyphInstance) -> GlyphRequest {
    GlyphRequest {
        key: glyph.mask.key,
        width: glyph.mask.width,
        height: glyph.mask.height,
    }
}

fn vertices(run: &GlyphRun, placements: &[AtlasRect], atlas_size: (u32, u32)) -> Result<Vec<Vertex>> {
    if run.glyphs.len() != placements.len() {
        bail!(
            "glyph-atlas-placement-count: {} glyphs, {} placements",
            run.glyphs.len(),
            placements.len()
        );
    }
    let mut out = Vec::with_capacity(run.glyphs.len() * 6);
    for (glyph, rect) in run.glyphs.iter().zip(placements) {
        let spread = if glyph.mask.pixels.is_color() { 0.0 } else { GLYPH_STROKE_SPREAD };
        let left = glyph.mask.left as f32 - spread;
        let top = -(glyph.mask.top as f32) - spread;
        let right = glyph.mask.left as f32 + glyph.mask.width as f32 + spread;
        let bottom = -(glyph.mask.top as f32) + glyph.mask.height as f32 + spread;
        let atlas_width = atlas_size.0 as f32;
        let atlas_height = atlas_size.1 as f32;
        let mask_rect = [
            rect.x as f32 / atlas_width,
            rect.y as f32 / atlas_height,
            (rect.x + rect.width) as f32 / atlas_width,
            (rect.y + rect.height) as f32 / atlas_height,
        ];
        let local = [
            (left, top, rect.x as f32 - spread, rect.y as f32 - spread),
            (right, top, (rect.x + rect.width) as f32 + spread, rect.y as f32 - spread),
            (
                right,
                bottom,
                (rect.x + rect.width) as f32 + spread,
                (rect.y + rect.height) as f32 + spread,
            ),
            (left, bottom, rect.x as f32 - spread, (rect.y + rect.height) as f32 + spread),
        ];
        let quad = local.map(|(x, y, u, v)| Vertex {
            position: affine_position(glyph.transform, x, y),
            uv: [u / atlas_width, v / atlas_height],
            run_index: glyph.uniform_index,
            color_glyph: u32::from(glyph.mask.pixels.is_color()),
            paint_position: [x, y],
            mask_rect,
        });
        out.extend_from_slice(&[quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]]);
    }
    Ok(out)
}

fn affine_position(tf: [f32; 6], x: f32, y: f32) -> [f32; 2] {
    [tf[0] * x + tf[2] * y + tf[4], tf[1] * x + tf[3] * y + tf[5]]
}

fn gpu_run_uniforms(run: &GlyphRun, pose: ScenePose, width: u32, height: u32) -> Result<Vec<GpuRunUniform>> {
    let width = width.max(1) as f32;
    let height = height.max(1) as f32;
    run.uniforms
        .iter()
        .map(|uniform| {
            let transform = post_concat_mat6(uniform.transform, pose.transform);
            let [sx, ky, kx, sy, tx, ty] = transform;
            let (gradient_points, gradient_first, gradient_middle, stroke) = match uniform.paint {
                GlyphPaint::Solid => ([0.0; 4], [0.0; 4], [0.0; 4], [0.0; 4]),
                GlyphPaint::RepeatLinearGradient { start, end, first, middle } => (
                    [start[0], start[1], end[0], end[1]],
                    [first[0], first[1], first[2], first[3] * pose.opacity],
                    [middle[0], middle[1], middle[2], middle[3] * pose.opacity],
                    [0.0; 4],
                ),
                GlyphPaint::DilatedStroke { width } => ([0.0; 4], [0.0; 4], [0.0; 4], [width, 0.0, 0.0, 0.0]),
                GlyphPaint::RepeatTexture => ([0.0; 4], [0.0; 4], [0.0; 4], [0.0, 1.0, 0.0, 0.0]),
            };
            if !uniform
                .transform
                .into_iter()
                .chain(uniform.color)
                .chain([uniform.color_opacity])
                .chain(uniform.clip.into_iter().flatten())
                .chain(gradient_points)
                .chain(gradient_first)
                .chain(gradient_middle)
                .chain(stroke)
                .chain(pose.transform)
                .chain([pose.opacity])
                .all(f32::is_finite)
            {
                bail!("glyph-run-non-finite-uniform");
            }
            Ok(GpuRunUniform {
                clip_x: [
                    2.0 * sx / width,
                    2.0 * kx / width,
                    2.0 * tx / width - 1.0,
                    uniform.color_opacity * pose.opacity,
                ],
                clip_y: [
                    -2.0 * ky / height,
                    -2.0 * sy / height,
                    1.0 - 2.0 * ty / height,
                    if uniform.clip.is_some() { 1.0 } else { 0.0 },
                ],
                color: [
                    uniform.color[0],
                    uniform.color[1],
                    uniform.color[2],
                    uniform.color[3] * pose.opacity,
                ],
                clip_rect: uniform.clip.unwrap_or([0.0; 4]),
                gradient_points,
                gradient_first,
                gradient_middle,
                stroke,
            })
        })
        .collect()
}

fn bind_layout(device: &wgpu::Device) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("bcut.glyph.bind-layout"),
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
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 2,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 3,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 4,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
        ],
    })
}

fn uniform_layout(device: &wgpu::Device) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("bcut.glyph.uniform-layout"),
        entries: &[wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::VERTEX,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        }],
    })
}

fn atlas_texture(device: &wgpu::Device, color: bool) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some(if color { "bcut.glyph.color-atlas" } else { "bcut.glyph.mask-atlas" }),
        size: wgpu::Extent3d {
            width: ATLAS_SIZE,
            height: ATLAS_SIZE,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: if color {
            wgpu::TextureFormat::Rgba8Unorm
        } else {
            wgpu::TextureFormat::R8Unorm
        },
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    })
}

fn atlas_bind_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    mask_texture: &wgpu::Texture,
    color_texture: &wgpu::Texture,
    sampler: &wgpu::Sampler,
    pattern_texture: &wgpu::Texture,
    pattern_sampler: &wgpu::Sampler,
) -> wgpu::BindGroup {
    let mask_view = mask_texture.create_view(&wgpu::TextureViewDescriptor::default());
    let color_view = color_texture.create_view(&wgpu::TextureViewDescriptor::default());
    let pattern_view = pattern_texture.create_view(&wgpu::TextureViewDescriptor::default());
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("bcut.glyph.bind-group"),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(&mask_view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(&color_view),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
            wgpu::BindGroupEntry {
                binding: 3,
                resource: wgpu::BindingResource::TextureView(&pattern_view),
            },
            wgpu::BindGroupEntry {
                binding: 4,
                resource: wgpu::BindingResource::Sampler(pattern_sampler),
            },
        ],
    })
}

fn pattern_texture(device: &wgpu::Device, width: u32, height: u32) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.glyph.pattern"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    })
}

fn uniform_bind_group(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, texture: &wgpu::Texture) -> wgpu::BindGroup {
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("bcut.glyph.uniform-bind-group"),
        layout,
        entries: &[wgpu::BindGroupEntry {
            binding: 0,
            resource: wgpu::BindingResource::TextureView(&view),
        }],
    })
}

fn vertex_buffer(device: &wgpu::Device, size: u64) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("bcut.glyph.vertices"),
        size: size.max(4),
        usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

fn uniform_texture(device: &wgpu::Device) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bcut.glyph.run-uniforms"),
        size: wgpu::Extent3d {
            width: 8,
            height: GLYPH_RUN_UNIFORM_LIMIT as u32,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba32Float,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    })
}

fn vertex_bytes(values: &[Vertex]) -> &[u8] {
    // SAFETY: `Vertex` is repr(C) and contains three f32 arrays plus two u32, without references.
    unsafe { std::slice::from_raw_parts(values.as_ptr().cast::<u8>(), std::mem::size_of_val(values)) }
}

fn uniform_bytes(values: &[GpuRunUniform]) -> &[u8] {
    // SAFETY: `GpuRunUniform` is repr(C) and contains only f32 arrays.
    unsafe { std::slice::from_raw_parts(values.as_ptr().cast::<u8>(), std::mem::size_of_val(values)) }
}

#[cfg(test)]
mod tests {
    use super::{SHADER, affine_position, gpu_run_uniforms};
    use timeline_render::{GlyphCompositeMode, GlyphPaint, GlyphRun, GlyphRunUniform, ScenePose};

    #[test]
    fn affine_position_applies_both_rows_to_the_original_point() {
        let point = affine_position([2.0, 3.0, 5.0, 7.0, 11.0, 13.0], 17.0, 19.0);
        assert_eq!(point, [140.0, 197.0]);
    }

    #[test]
    fn run_uniform_converts_canvas_affine_to_clip_rows() {
        let run = GlyphRun {
            glyphs: Default::default(),
            uniforms: vec![GlyphRunUniform {
                transform: [2.0, 3.0, 5.0, 7.0, 11.0, 13.0],
                color: [0.1, 0.2, 0.3, 0.4],
                color_opacity: 0.6,
                clip: Some([17.0, 19.0, 23.0, 29.0]),
                paint: GlyphPaint::RepeatLinearGradient {
                    start: [-7.0, 0.0],
                    end: [185.0, 0.0],
                    first: [0.9, 0.8, 0.7, 0.6],
                    middle: [0.4, 0.3, 0.2, 0.1],
                },
            }],
            texture: None,
            composite: GlyphCompositeMode::Normal,
            pose: ScenePose::IDENTITY,
            motion: None,
        };
        let gpu = gpu_run_uniforms(&run, ScenePose::IDENTITY, 100, 200).unwrap();
        assert_eq!(gpu[0].clip_x, [0.04, 0.1, -0.78, 0.6]);
        assert_eq!(gpu[0].clip_y, [-0.03, -0.07, 0.87, 1.0]);
        assert_eq!(gpu[0].color, [0.1, 0.2, 0.3, 0.4]);
        assert_eq!(gpu[0].clip_rect, [17.0, 19.0, 23.0, 29.0]);
        assert_eq!(gpu[0].gradient_points, [-7.0, 0.0, 185.0, 0.0]);
        assert_eq!(gpu[0].gradient_first, [0.9, 0.8, 0.7, 0.6]);
        assert_eq!(gpu[0].gradient_middle, [0.4, 0.3, 0.2, 0.1]);
        assert_eq!(gpu[0].stroke, [0.0; 4]);

        let mut stroke = run;
        stroke.uniforms[0].paint = GlyphPaint::DilatedStroke { width: 5.25 };
        let gpu = gpu_run_uniforms(&stroke, ScenePose::IDENTITY, 100, 200).unwrap();
        assert_eq!(gpu[0].stroke, [5.25, 0.0, 0.0, 0.0]);

        stroke.uniforms[0].paint = GlyphPaint::RepeatTexture;
        let gpu = gpu_run_uniforms(&stroke, ScenePose::IDENTITY, 100, 200).unwrap();
        assert_eq!(gpu[0].stroke, [0.0, 1.0, 0.0, 0.0]);
    }

    #[test]
    fn run_uniform_shader_uses_an_es300_compatible_texture_not_storage() {
        assert!(SHADER.contains("textureLoad(run_uniforms"));
        assert!(SHADER.contains("textureSampleLevel("));
        assert!(!SHADER.contains("textureSample("));
        assert!(SHADER.contains("discard;"));
        assert!(SHADER.contains("middle_weight"));
        assert!(SHADER.contains("dilated_coverage"));
        assert!(!SHADER.contains("var<storage"));
    }

    // `render_raster::naga` 只随 `wgsl-validate` 转出，只开 `gpu-webgpu` 时没有。
    #[cfg(any(feature = "gpu", feature = "gpu-webgl"))]
    #[test]
    fn retained_glyph_shader_translates_to_webgl2_glsl_es_300() {
        let module = render_raster::validate_wgsl(SHADER).expect("glyph WGSL must validate");
        let info = render_raster::naga::valid::Validator::new(
            render_raster::naga::valid::ValidationFlags::all(),
            render_raster::naga::valid::Capabilities::default(),
        )
        .validate(&module)
        .expect("glyph WGSL must pass naga validation");

        for (stage, entry_point) in [
            (render_raster::naga::ShaderStage::Vertex, "vertex_main"),
            (render_raster::naga::ShaderStage::Fragment, "fragment_main"),
        ] {
            let options = render_raster::naga::back::glsl::Options {
                version: render_raster::naga::back::glsl::Version::Embedded {
                    version: 300,
                    is_webgl: true,
                },
                ..Default::default()
            };
            let pipeline_options = render_raster::naga::back::glsl::PipelineOptions {
                shader_stage: stage,
                entry_point: entry_point.to_owned(),
                multiview: None,
            };
            let mut output = String::new();
            let mut writer = render_raster::naga::back::glsl::Writer::new(
                &mut output,
                &module,
                &info,
                &options,
                &pipeline_options,
                render_raster::naga::proc::BoundsCheckPolicies::default(),
            )
            .expect("glyph shader must create a WebGL2 GLSL writer");
            writer.write().expect("glyph shader must translate to WebGL2 GLSL ES 300");
            assert!(output.contains("#version 300 es"));
        }
    }

    #[test]
    fn screen_composite_uses_the_premultiplied_closed_form() {
        let blend = super::super::scene_blend_state(GlyphCompositeMode::Screen);
        assert_eq!(blend.color.src_factor, wgpu::BlendFactor::One);
        assert_eq!(blend.color.dst_factor, wgpu::BlendFactor::OneMinusSrc);
        assert_eq!(blend.color.operation, wgpu::BlendOperation::Add);
        assert_eq!(blend.alpha.src_factor, wgpu::BlendFactor::One);
        assert_eq!(blend.alpha.dst_factor, wgpu::BlendFactor::OneMinusSrcAlpha);
        assert_eq!(blend.alpha.operation, wgpu::BlendOperation::Add);
    }
}
