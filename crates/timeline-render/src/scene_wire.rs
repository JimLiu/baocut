//! `bcut-wasm-subtitle` → `bcut-wasm-gpu` 的紧凑 SceneFrame 线格式。
//!
//! 两个 wasm 实例不能共享 Rust `Arc` 或线性内存；浏览器字幕规划器因此把
//! renderer-neutral scene 编成字节，GPU 会话解回同一组类型后仍由 compositor
//! 单 canvas / 单 encoder 提交。格式只覆盖字幕当前会产出的
//! vector/glyph/procedural-rounded-rect/blur 节点；ShaderQuad 属于元素求值，
//! 不允许从这条边界偷偷绕进来。

use std::sync::Arc;

use anyhow::{Context, Result, anyhow, bail};
use motion::curve::StepPosition;
use motion::{CurveSpec, EaseId};

use crate::{
    BlurredGroup, GlyphCompositeMode, GlyphEffect, GlyphInstance, GlyphKey, GlyphMask, GlyphPaint,
    GlyphPixels, GlyphRun, GlyphRunUniform, GlyphTexture, GlyphTextureKey, RoundedRectNode,
    SCENE_NODE_LIMIT, SceneCurveSolver, SceneFrame, SceneMotion, SceneNode, ScenePose,
};

const MAGIC: &[u8; 4] = b"BCS2";
const VERSION: u32 = 11;
const MIN_VERSION: u32 = 2;
const MAX_PACKET_BYTES: usize = 32 * 1024 * 1024;
const MAX_GLYPHS: usize = 100_000;
const MAX_FRAME_OPS_BYTES: usize = 8 * 1024 * 1024;
const MAX_GLYPH_PIXELS_BYTES: usize = 16 * 1024 * 1024;
const MAX_GLYPH_TEXTURE_PIXELS_BYTES: usize = 16 * 1024 * 1024;
const MAX_DEPTH: usize = 8;

pub fn encode_scene_frame(scene: &SceneFrame) -> Result<Vec<u8>> {
    encode_scene_frame_version(scene, VERSION)
}

fn encode_scene_frame_version(scene: &SceneFrame, version: u32) -> Result<Vec<u8>> {
    if !(MIN_VERSION..=VERSION).contains(&version) {
        bail!("subtitle-scene-version-unsupported: {version}");
    }
    let mut writer = Writer::default();
    writer.bytes(MAGIC);
    writer.u32(version);
    writer.optional_f64(scene.next_change);
    writer.optional_f64(scene.active_until);
    writer.u64(scene.fingerprint);
    encode_nodes(&mut writer, &scene.nodes, 0, version)?;
    if writer.output.len() > MAX_PACKET_BYTES {
        bail!("subtitle-scene-packet-too-large: {}", writer.output.len());
    }
    Ok(writer.output)
}

pub fn decode_scene_frame(bytes: &[u8]) -> Result<SceneFrame> {
    if bytes.len() > MAX_PACKET_BYTES {
        bail!("subtitle-scene-packet-too-large: {}", bytes.len());
    }
    let mut reader = Reader::new(bytes);
    if reader.take(4)? != MAGIC {
        bail!("subtitle-scene-magic-invalid");
    }
    let version = reader.u32()?;
    if !(MIN_VERSION..=VERSION).contains(&version) {
        bail!("subtitle-scene-version-unsupported: {version}");
    }
    let scene = SceneFrame {
        next_change: reader.optional_f64()?,
        active_until: reader.optional_f64()?,
        fingerprint: reader.u64()?,
        nodes: decode_nodes(&mut reader, 0, version)?,
    };
    if !reader.remaining().is_empty() {
        bail!(
            "subtitle-scene-trailing-bytes: {}",
            reader.remaining().len()
        );
    }
    Ok(scene)
}

fn encode_nodes(
    writer: &mut Writer,
    nodes: &[SceneNode],
    depth: usize,
    version: u32,
) -> Result<()> {
    if depth > MAX_DEPTH || nodes.len() > SCENE_NODE_LIMIT {
        bail!("subtitle-scene-node-limit");
    }
    writer.u32(nodes.len() as u32);
    for node in nodes {
        match node {
            SceneNode::Vectors(frame) => {
                writer.u8(0);
                writer.frame_ops(frame)?;
            }
            SceneNode::AnimatedVectors {
                frame,
                pose,
                motion,
            } => {
                writer.u8(1);
                writer.frame_ops(frame)?;
                writer.pose(*pose);
                writer.motion(motion.as_ref());
            }
            SceneNode::Glyphs(run) => {
                writer.u8(2);
                encode_glyph_run(writer, run, version)?;
            }
            SceneNode::RoundedRect(rect) => {
                if version < 5 {
                    bail!("subtitle-scene-rounded-rect-requires-v5");
                }
                writer.u8(5);
                for value in rect.rect.into_iter().chain(rect.color) {
                    writer.f32(value);
                }
                writer.f32(rect.radius);
                writer.pose(rect.pose);
                writer.motion(rect.motion.as_ref());
            }
            SceneNode::BlurredGlyphs(effect) => {
                writer.u8(3);
                writer.u32(effect.radius);
                writer.u32(effect.layers.len() as u32);
                for layer in &effect.layers {
                    encode_glyph_run(writer, layer, version)?;
                }
            }
            SceneNode::BlurredGroup(group) => {
                if version < 7 && group.composite != GlyphCompositeMode::Normal {
                    bail!("subtitle-scene-group-composite-requires-v7");
                }
                if version < 10
                    && matches!(
                        group.composite,
                        GlyphCompositeMode::Difference | GlyphCompositeMode::Exclusion
                    )
                {
                    bail!("subtitle-scene-target-composite-requires-v10");
                }
                if version < 11 && group.reveal.is_some() {
                    bail!("subtitle-scene-group-reveal-requires-v11");
                }
                writer.u8(4);
                writer.f32(group.radius);
                writer.motion(group.motion.as_ref());
                encode_nodes(writer, &group.nodes, depth + 1, version)?;
                if version >= 7 {
                    writer.u8(match group.composite {
                        GlyphCompositeMode::Normal => 0,
                        GlyphCompositeMode::Screen => 1,
                        GlyphCompositeMode::Difference => 2,
                        GlyphCompositeMode::Exclusion => 3,
                    });
                }
                if version >= 11 {
                    writer.optional_f32(group.reveal);
                }
            }
            SceneNode::ShaderQuad { .. } => {
                bail!("subtitle-scene-shader-node-forbidden");
            }
            SceneNode::Texture(_) => {
                bail!("subtitle-scene-texture-node-forbidden");
            }
        }
    }
    Ok(())
}

fn decode_nodes(reader: &mut Reader<'_>, depth: usize, version: u32) -> Result<Vec<SceneNode>> {
    if depth > MAX_DEPTH {
        bail!("subtitle-scene-depth-limit");
    }
    let count = reader.count(SCENE_NODE_LIMIT, "node")?;
    let mut nodes = Vec::with_capacity(count);
    for _ in 0..count {
        nodes.push(match reader.u8()? {
            0 => SceneNode::Vectors(Arc::new(reader.frame_ops()?)),
            1 => SceneNode::AnimatedVectors {
                frame: Arc::new(reader.frame_ops()?),
                pose: reader.pose()?,
                motion: reader.motion()?,
            },
            2 => SceneNode::Glyphs(Arc::new(decode_glyph_run(reader, version)?)),
            3 => {
                let radius = reader.u32()?;
                let layer_count = reader.count(SCENE_NODE_LIMIT, "glyph-layer")?;
                let mut layers = Vec::with_capacity(layer_count);
                for _ in 0..layer_count {
                    layers.push(Arc::new(decode_glyph_run(reader, version)?));
                }
                SceneNode::BlurredGlyphs(Arc::new(GlyphEffect { layers, radius }))
            }
            4 => {
                let radius = reader.f32()?;
                let motion = reader.motion()?;
                let nodes = decode_nodes(reader, depth + 1, version)?;
                let composite = if version >= 7 {
                    match reader.u8()? {
                        0 => GlyphCompositeMode::Normal,
                        1 => GlyphCompositeMode::Screen,
                        2 if version >= 10 => GlyphCompositeMode::Difference,
                        3 if version >= 10 => GlyphCompositeMode::Exclusion,
                        tag => bail!("subtitle-scene-group-composite-unknown: {tag}"),
                    }
                } else {
                    GlyphCompositeMode::Normal
                };
                let reveal = if version >= 11 {
                    reader.optional_f32()?
                } else {
                    None
                };
                SceneNode::BlurredGroup(Arc::new(BlurredGroup {
                    nodes,
                    radius,
                    motion,
                    reveal,
                    composite,
                }))
            }
            5 if version >= 5 => SceneNode::RoundedRect(Arc::new(RoundedRectNode {
                rect: [reader.f32()?, reader.f32()?, reader.f32()?, reader.f32()?],
                color: [reader.f32()?, reader.f32()?, reader.f32()?, reader.f32()?],
                radius: reader.f32()?,
                pose: reader.pose()?,
                motion: reader.motion()?,
            })),
            tag => bail!("subtitle-scene-node-unknown: {tag}"),
        });
    }
    Ok(nodes)
}

fn encode_glyph_run(writer: &mut Writer, run: &GlyphRun, version: u32) -> Result<()> {
    if run.glyphs.len() > MAX_GLYPHS || run.uniforms.len() > crate::GLYPH_RUN_UNIFORM_LIMIT {
        bail!("subtitle-scene-glyph-limit");
    }
    if version < 6 && run.composite != GlyphCompositeMode::Normal {
        bail!("subtitle-scene-glyph-composite-requires-v6");
    }
    if matches!(
        run.composite,
        GlyphCompositeMode::Difference | GlyphCompositeMode::Exclusion
    ) {
        bail!("subtitle-scene-glyph-target-composite-forbidden");
    }
    let uses_texture = run
        .uniforms
        .iter()
        .any(|uniform| uniform.paint == GlyphPaint::RepeatTexture);
    if uses_texture != run.texture.is_some() {
        bail!("subtitle-scene-glyph-texture-resource-mismatch");
    }
    if version < 9 && uses_texture {
        bail!("subtitle-scene-glyph-texture-requires-v9");
    }
    writer.u32(run.glyphs.len() as u32);
    for glyph in run.glyphs.iter() {
        writer.u64(glyph.mask.key.0[0]);
        writer.u64(glyph.mask.key.0[1]);
        writer.u32(glyph.mask.width);
        writer.u32(glyph.mask.height);
        writer.i32(glyph.mask.left);
        writer.i32(glyph.mask.top);
        match &glyph.mask.pixels {
            GlyphPixels::Alpha(alpha) => {
                writer.u8(0);
                writer.sized_bytes(alpha)?;
            }
            GlyphPixels::Color(rgba) => {
                writer.u8(1);
                writer.sized_bytes(rgba)?;
            }
        }
        writer.mat6(glyph.transform);
        writer.u32(glyph.uniform_index);
    }
    writer.u32(run.uniforms.len() as u32);
    for uniform in &run.uniforms {
        writer.mat6(uniform.transform);
        for value in uniform.color {
            writer.f32(value);
        }
        writer.f32(uniform.color_opacity);
        if version >= 3 {
            match uniform.clip {
                Some(clip) => {
                    writer.u8(1);
                    for value in clip {
                        writer.f32(value);
                    }
                }
                None => writer.u8(0),
            }
        }
        if version >= 4 {
            match uniform.paint {
                GlyphPaint::Solid => writer.u8(0),
                GlyphPaint::RepeatLinearGradient {
                    start,
                    end,
                    first,
                    middle,
                } => {
                    writer.u8(1);
                    for value in start.into_iter().chain(end).chain(first).chain(middle) {
                        writer.f32(value);
                    }
                }
                GlyphPaint::DilatedStroke { width } => {
                    if version < 8 {
                        bail!("subtitle-scene-glyph-stroke-requires-v8");
                    }
                    writer.u8(2);
                    writer.f32(width);
                }
                GlyphPaint::RepeatTexture => {
                    if version < 9 {
                        bail!("subtitle-scene-glyph-texture-requires-v9");
                    }
                    writer.u8(3);
                }
            }
        } else {
            match uniform.paint {
                GlyphPaint::Solid => {}
                GlyphPaint::DilatedStroke { .. } => {
                    bail!("subtitle-scene-glyph-stroke-requires-v8")
                }
                // v3/v2 的既有兼容语义：渐变降级为 solid paint。
                GlyphPaint::RepeatLinearGradient { .. } => {}
                GlyphPaint::RepeatTexture => {
                    bail!("subtitle-scene-glyph-texture-requires-v9")
                }
            }
        }
    }
    if version >= 9 {
        writer.u8(u8::from(run.texture.is_some()));
        if let Some(texture) = &run.texture {
            writer.u64(texture.key.0[0]);
            writer.u64(texture.key.0[1]);
            writer.u32(texture.width);
            writer.u32(texture.height);
            writer.sized_bytes(&texture.rgba)?;
        }
    }
    if version >= 6 {
        writer.u8(match run.composite {
            GlyphCompositeMode::Normal => 0,
            GlyphCompositeMode::Screen => 1,
            GlyphCompositeMode::Difference | GlyphCompositeMode::Exclusion => {
                unreachable!("target-sampling glyph mode 已拒绝")
            }
        });
    }
    writer.pose(run.pose);
    writer.motion(run.motion.as_ref());
    Ok(())
}

fn decode_glyph_run(reader: &mut Reader<'_>, version: u32) -> Result<GlyphRun> {
    let glyph_count = reader.count(MAX_GLYPHS, "glyph")?;
    let mut glyphs = Vec::with_capacity(glyph_count);
    for _ in 0..glyph_count {
        let key = GlyphKey([reader.u64()?, reader.u64()?]);
        let width = reader.u32()?;
        let height = reader.u32()?;
        let left = reader.i32()?;
        let top = reader.i32()?;
        let kind = reader.u8()?;
        let channels = match kind {
            0 => 1,
            1 => 4,
            tag => bail!("subtitle-scene-glyph-pixels-unknown: {tag}"),
        };
        let expected = (width as usize)
            .checked_mul(height as usize)
            .and_then(|pixels| pixels.checked_mul(channels))
            .ok_or_else(|| anyhow!("subtitle-scene-mask-size-overflow"))?;
        let pixels = reader.sized_bytes(MAX_GLYPH_PIXELS_BYTES, "glyph-pixels")?;
        if pixels.len() != expected {
            bail!(
                "subtitle-scene-glyph-size-mismatch: {}x{}x{} != {}",
                width,
                height,
                channels,
                pixels.len()
            );
        }
        let mask = match kind {
            0 => GlyphMask::new(key, width, height, left, top, pixels.to_vec()),
            1 => GlyphMask::new_color(key, width, height, left, top, pixels.to_vec()),
            _ => unreachable!("kind 已验证"),
        }
        .ok_or_else(|| anyhow!("subtitle-scene-mask-invalid"))?;
        glyphs.push(GlyphInstance {
            mask: Arc::new(mask),
            transform: reader.mat6()?,
            uniform_index: reader.u32()?,
        });
    }
    let uniform_count = reader.count(crate::GLYPH_RUN_UNIFORM_LIMIT, "glyph-uniform")?;
    let mut uniforms = Vec::with_capacity(uniform_count);
    for _ in 0..uniform_count {
        uniforms.push(GlyphRunUniform {
            transform: reader.mat6()?,
            color: [reader.f32()?, reader.f32()?, reader.f32()?, reader.f32()?],
            color_opacity: reader.f32()?,
            clip: if version >= 3 {
                match reader.u8()? {
                    0 => None,
                    1 => Some([reader.f32()?, reader.f32()?, reader.f32()?, reader.f32()?]),
                    tag => bail!("subtitle-scene-glyph-clip-unknown: {tag}"),
                }
            } else {
                None
            },
            paint: if version >= 4 {
                match reader.u8()? {
                    0 => GlyphPaint::Solid,
                    1 => GlyphPaint::RepeatLinearGradient {
                        start: [reader.f32()?, reader.f32()?],
                        end: [reader.f32()?, reader.f32()?],
                        first: [reader.f32()?, reader.f32()?, reader.f32()?, reader.f32()?],
                        middle: [reader.f32()?, reader.f32()?, reader.f32()?, reader.f32()?],
                    },
                    2 if version >= 8 => GlyphPaint::DilatedStroke {
                        width: reader.f32()?,
                    },
                    3 if version >= 9 => GlyphPaint::RepeatTexture,
                    tag => bail!("subtitle-scene-glyph-paint-unknown: {tag}"),
                }
            } else {
                GlyphPaint::Solid
            },
        });
    }
    let texture = if version >= 9 {
        match reader.u8()? {
            0 => None,
            1 => {
                let key = GlyphTextureKey([reader.u64()?, reader.u64()?]);
                let width = reader.u32()?;
                let height = reader.u32()?;
                let expected = (width as usize)
                    .checked_mul(height as usize)
                    .and_then(|pixels| pixels.checked_mul(4))
                    .ok_or_else(|| anyhow!("subtitle-scene-glyph-texture-size-overflow"))?;
                let rgba =
                    reader.sized_bytes(MAX_GLYPH_TEXTURE_PIXELS_BYTES, "glyph-texture-pixels")?;
                if rgba.len() != expected {
                    bail!(
                        "subtitle-scene-glyph-texture-size-mismatch: {}x{}x4 != {}",
                        width,
                        height,
                        rgba.len()
                    );
                }
                Some(Arc::new(
                    GlyphTexture::new(key, width, height, rgba.to_vec())
                        .ok_or_else(|| anyhow!("subtitle-scene-glyph-texture-invalid"))?,
                ))
            }
            tag => bail!("subtitle-scene-glyph-texture-presence-unknown: {tag}"),
        }
    } else {
        None
    };
    let uses_texture = uniforms
        .iter()
        .any(|uniform| uniform.paint == GlyphPaint::RepeatTexture);
    if uses_texture != texture.is_some() {
        bail!("subtitle-scene-glyph-texture-resource-mismatch");
    }
    Ok(GlyphRun {
        glyphs: glyphs.into(),
        uniforms,
        texture,
        composite: if version >= 6 {
            match reader.u8()? {
                0 => GlyphCompositeMode::Normal,
                1 => GlyphCompositeMode::Screen,
                tag => bail!("subtitle-scene-glyph-composite-unknown: {tag}"),
            }
        } else {
            GlyphCompositeMode::Normal
        },
        pose: reader.pose()?,
        motion: reader.motion()?,
    })
}

#[derive(Default)]
struct Writer {
    output: Vec<u8>,
}

impl Writer {
    fn bytes(&mut self, value: &[u8]) {
        self.output.extend_from_slice(value);
    }

    fn u8(&mut self, value: u8) {
        self.output.push(value);
    }

    fn u32(&mut self, value: u32) {
        self.bytes(&value.to_le_bytes());
    }

    fn i32(&mut self, value: i32) {
        self.bytes(&value.to_le_bytes());
    }

    fn u64(&mut self, value: u64) {
        self.bytes(&value.to_le_bytes());
    }

    fn f32(&mut self, value: f32) {
        self.bytes(&value.to_bits().to_le_bytes());
    }

    fn f64(&mut self, value: f64) {
        self.bytes(&value.to_bits().to_le_bytes());
    }

    fn optional_f64(&mut self, value: Option<f64>) {
        self.u8(u8::from(value.is_some()));
        if let Some(value) = value {
            self.f64(value);
        }
    }

    fn optional_f32(&mut self, value: Option<f32>) {
        self.u8(u8::from(value.is_some()));
        if let Some(value) = value {
            self.f32(value);
        }
    }

    fn sized_bytes(&mut self, value: &[u8]) -> Result<()> {
        self.u32(u32::try_from(value.len()).context("subtitle scene byte block exceeds u32")?);
        self.bytes(value);
        Ok(())
    }

    fn mat6(&mut self, value: [f32; 6]) {
        for value in value {
            self.f32(value);
        }
    }

    fn pose(&mut self, pose: ScenePose) {
        self.mat6(pose.transform);
        self.f32(pose.opacity);
        self.f32(pose.blur);
    }

    fn motion(&mut self, motion: Option<&SceneMotion>) {
        self.u8(u8::from(motion.is_some()));
        let Some(motion) = motion else { return };
        self.f64(motion.start);
        self.f64(motion.end);
        self.pose(motion.from);
        self.pose(motion.to);
        self.curve(&motion.curve);
        self.u8(match motion.solver {
            SceneCurveSolver::Standard => 0,
            SceneCurveSolver::Caption => 1,
        });
    }

    fn curve(&mut self, curve: &CurveSpec) {
        match curve {
            CurveSpec::Default => self.u8(0),
            CurveSpec::Named(id) => {
                self.u8(1);
                self.string(id.name());
            }
            CurveSpec::Unknown(name) => {
                self.u8(2);
                self.string(name);
            }
            CurveSpec::CubicBezier { x1, y1, x2, y2 } => {
                self.u8(3);
                for value in [x1, y1, x2, y2] {
                    self.f64(*value);
                }
            }
            CurveSpec::Steps { count, position } => {
                self.u8(4);
                self.u32(*count);
                self.u8(match position {
                    StepPosition::Start => 0,
                    StepPosition::End => 1,
                });
            }
            CurveSpec::Spring { response, damping } => {
                self.u8(5);
                self.f64(*response);
                self.f64(*damping);
            }
        }
    }

    fn string(&mut self, value: &str) {
        self.u32(value.len() as u32);
        self.bytes(value.as_bytes());
    }

    fn frame_ops(&mut self, frame: &render_raster::drawop::FrameOps) -> Result<()> {
        self.sized_bytes(&render_raster::drawop::encode(frame))
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    cursor: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, cursor: 0 }
    }

    fn remaining(&self) -> &'a [u8] {
        &self.bytes[self.cursor..]
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8]> {
        let end = self
            .cursor
            .checked_add(length)
            .filter(|end| *end <= self.bytes.len())
            .ok_or_else(|| anyhow!("subtitle-scene-truncated"))?;
        let value = &self.bytes[self.cursor..end];
        self.cursor = end;
        Ok(value)
    }

    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }

    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn i32(&mut self) -> Result<i32> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }

    fn f32(&mut self) -> Result<f32> {
        Ok(f32::from_bits(self.u32()?))
    }

    fn f64(&mut self) -> Result<f64> {
        Ok(f64::from_bits(self.u64()?))
    }

    fn optional_f64(&mut self) -> Result<Option<f64>> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.f64()?)),
            value => bail!("subtitle-scene-option-invalid: {value}"),
        }
    }

    fn optional_f32(&mut self) -> Result<Option<f32>> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.f32()?)),
            value => bail!("subtitle-scene-option-invalid: {value}"),
        }
    }

    fn count(&mut self, limit: usize, label: &str) -> Result<usize> {
        let value = self.u32()? as usize;
        if value > limit {
            bail!("subtitle-scene-{label}-limit: {value}");
        }
        Ok(value)
    }

    fn sized_bytes(&mut self, limit: usize, label: &str) -> Result<&'a [u8]> {
        let length = self.u32()? as usize;
        if length > limit {
            bail!("subtitle-scene-{label}-limit: {length}");
        }
        self.take(length)
    }

    fn mat6(&mut self) -> Result<[f32; 6]> {
        Ok([
            self.f32()?,
            self.f32()?,
            self.f32()?,
            self.f32()?,
            self.f32()?,
            self.f32()?,
        ])
    }

    fn pose(&mut self) -> Result<ScenePose> {
        Ok(ScenePose {
            transform: self.mat6()?,
            opacity: self.f32()?,
            blur: self.f32()?,
        })
    }

    fn motion(&mut self) -> Result<Option<SceneMotion>> {
        match self.u8()? {
            0 => return Ok(None),
            1 => {}
            value => bail!("subtitle-scene-motion-option-invalid: {value}"),
        }
        let start = self.f64()?;
        let end = self.f64()?;
        let from = self.pose()?;
        let to = self.pose()?;
        let curve = self.curve()?;
        let solver = match self.u8()? {
            0 => SceneCurveSolver::Standard,
            1 => SceneCurveSolver::Caption,
            value => bail!("subtitle-scene-solver-invalid: {value}"),
        };
        Ok(Some(SceneMotion {
            start,
            end,
            from,
            to,
            curve,
            solver,
        }))
    }

    fn curve(&mut self) -> Result<CurveSpec> {
        Ok(match self.u8()? {
            0 => CurveSpec::Default,
            1 => {
                let name = self.string()?;
                CurveSpec::Named(
                    EaseId::parse(&name)
                        .ok_or_else(|| anyhow!("subtitle-scene-ease-unknown: {name}"))?,
                )
            }
            2 => CurveSpec::Unknown(self.string()?),
            3 => CurveSpec::CubicBezier {
                x1: self.f64()?,
                y1: self.f64()?,
                x2: self.f64()?,
                y2: self.f64()?,
            },
            4 => CurveSpec::Steps {
                count: self.u32()?,
                position: match self.u8()? {
                    0 => StepPosition::Start,
                    1 => StepPosition::End,
                    value => bail!("subtitle-scene-step-position-invalid: {value}"),
                },
            },
            5 => CurveSpec::Spring {
                response: self.f64()?,
                damping: self.f64()?,
            },
            value => bail!("subtitle-scene-curve-invalid: {value}"),
        })
    }

    fn string(&mut self) -> Result<String> {
        let bytes = self.sized_bytes(64 * 1024, "string")?;
        String::from_utf8(bytes.to_vec()).context("subtitle-scene-string-utf8")
    }

    fn frame_ops(&mut self) -> Result<render_raster::drawop::FrameOps> {
        let bytes = self.sized_bytes(MAX_FRAME_OPS_BYTES, "frame-ops")?;
        let (_, frame) = render_raster::drawop::decode(bytes)?;
        Ok(frame)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use render_raster::drawop::{DrawOp, FrameBuilder};

    #[test]
    fn subtitle_scene_wire_round_trips_nested_vectors_glyphs_and_motion() {
        let mut builder = FrameBuilder::default();
        builder.push(DrawOp::FillRect {
            x: 2.0,
            y: 3.0,
            w: 40.0,
            h: 12.0,
            radius: 4.0,
            color: [0.1, 0.2, 0.3, 0.8],
            tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        });
        let vector = Arc::new(builder.finish());
        let mask = Arc::new(
            GlyphMask::new(GlyphKey([7, 11]), 2, 2, -1, 2, [0, 80, 160, 255].as_slice()).unwrap(),
        );
        let color = Arc::new(
            GlyphMask::new_color(GlyphKey([8, 12]), 1, 1, 0, 1, [128, 0, 0, 128].as_slice())
                .unwrap(),
        );
        let motion = SceneMotion {
            start: 0.0,
            end: 0.4,
            from: ScenePose {
                transform: [0.8, 0.0, 0.0, 0.8, 10.0, 20.0],
                opacity: 0.2,
                blur: 4.0,
            },
            to: ScenePose::IDENTITY,
            curve: CurveSpec::CubicBezier {
                x1: 0.2,
                y1: 0.1,
                x2: 0.8,
                y2: 1.0,
            },
            solver: SceneCurveSolver::Caption,
        };
        let run = Arc::new(GlyphRun {
            glyphs: vec![
                GlyphInstance {
                    mask,
                    transform: [1.0, 0.0, 0.0, 1.0, 5.0, 6.0],
                    uniform_index: 0,
                },
                GlyphInstance {
                    mask: color,
                    transform: [1.0, 0.0, 0.0, 1.0, 9.0, 6.0],
                    uniform_index: 0,
                },
            ]
            .into(),
            uniforms: vec![GlyphRunUniform {
                transform: [1.0, 0.0, 0.0, 1.0, 1.0, 2.0],
                color: [1.0, 0.5, 0.25, 0.75],
                color_opacity: 0.9,
                clip: Some([3.0, 4.0, 31.0, 19.0]),
                paint: GlyphPaint::RepeatLinearGradient {
                    start: [-7.0, 0.0],
                    end: [185.0, 0.0],
                    first: [1.0, 0.0, 0.0, 0.75],
                    middle: [0.0, 0.5, 1.0, 0.5],
                },
            }],
            texture: None,
            composite: GlyphCompositeMode::Normal,
            pose: ScenePose::IDENTITY,
            motion: Some(motion.clone()),
        });
        let scene = SceneFrame {
            nodes: vec![SceneNode::BlurredGroup(Arc::new(BlurredGroup {
                nodes: vec![
                    SceneNode::AnimatedVectors {
                        frame: vector,
                        pose: motion.from,
                        motion: Some(motion.clone()),
                    },
                    SceneNode::Glyphs(run),
                ],
                radius: 4.0,
                motion: Some(motion),
                reveal: Some(0.625),
                composite: GlyphCompositeMode::Normal,
            }))],
            next_change: Some(1.25),
            active_until: Some(0.4),
            fingerprint: 99,
        };

        let decoded = decode_scene_frame(&encode_scene_frame(&scene).unwrap()).unwrap();
        assert_eq!(decoded.next_change, scene.next_change);
        assert_eq!(decoded.active_until, scene.active_until);
        assert_eq!(decoded.fingerprint, 99);
        let SceneNode::BlurredGroup(group) = &decoded.nodes[0] else {
            panic!("expected blurred group")
        };
        assert_eq!(group.radius, 4.0);
        assert_eq!(group.reveal, Some(0.625));
        assert_eq!(
            group.motion.as_ref().unwrap().solver,
            SceneCurveSolver::Caption
        );
        let SceneNode::Glyphs(run) = &group.nodes[1] else {
            panic!("expected glyph run")
        };
        assert_eq!(run.glyphs[0].mask.key, GlyphKey([7, 11]));
        let GlyphPixels::Alpha(alpha) = &run.glyphs[0].mask.pixels else {
            panic!("expected alpha glyph")
        };
        assert_eq!(&**alpha, &[0, 80, 160, 255]);
        let GlyphPixels::Color(rgba) = &run.glyphs[1].mask.pixels else {
            panic!("expected color glyph")
        };
        assert_eq!(&**rgba, &[128, 0, 0, 128]);
        assert_eq!(run.uniforms[0].color, [1.0, 0.5, 0.25, 0.75]);
        assert_eq!(run.uniforms[0].clip, Some([3.0, 4.0, 31.0, 19.0]));
        assert_eq!(
            run.uniforms[0].paint,
            GlyphPaint::RepeatLinearGradient {
                start: [-7.0, 0.0],
                end: [185.0, 0.0],
                first: [1.0, 0.0, 0.0, 0.75],
                middle: [0.0, 0.5, 1.0, 0.5],
            }
        );
        assert_eq!(run.uniforms[0].color_opacity, 0.9);
        assert_eq!(run.composite, GlyphCompositeMode::Normal);
        assert!(
            encode_scene_frame_version(&scene, 10)
                .unwrap_err()
                .to_string()
                .contains("group-reveal-requires-v11")
        );

        let mut legacy_scene = scene.clone();
        let SceneNode::BlurredGroup(group) = &legacy_scene.nodes[0] else {
            unreachable!()
        };
        legacy_scene.nodes[0] = SceneNode::BlurredGroup(Arc::new(BlurredGroup {
            reveal: None,
            ..group.as_ref().clone()
        }));
        let legacy =
            decode_scene_frame(&encode_scene_frame_version(&legacy_scene, 5).unwrap()).unwrap();
        let SceneNode::BlurredGroup(group) = &legacy.nodes[0] else {
            panic!("expected v5 blurred group")
        };
        let SceneNode::Glyphs(run) = &group.nodes[1] else {
            panic!("expected v5 glyph run")
        };
        assert_eq!(run.composite, GlyphCompositeMode::Normal);

        let legacy =
            decode_scene_frame(&encode_scene_frame_version(&legacy_scene, 4).unwrap()).unwrap();
        let SceneNode::BlurredGroup(group) = &legacy.nodes[0] else {
            panic!("expected v4 blurred group")
        };
        let SceneNode::Glyphs(run) = &group.nodes[1] else {
            panic!("expected v4 glyph run")
        };
        assert!(matches!(
            run.uniforms[0].paint,
            GlyphPaint::RepeatLinearGradient { .. }
        ));

        let legacy =
            decode_scene_frame(&encode_scene_frame_version(&legacy_scene, 3).unwrap()).unwrap();
        let SceneNode::BlurredGroup(group) = &legacy.nodes[0] else {
            panic!("expected legacy blurred group")
        };
        let SceneNode::Glyphs(run) = &group.nodes[1] else {
            panic!("expected legacy glyph run")
        };
        assert_eq!(run.uniforms[0].clip, Some([3.0, 4.0, 31.0, 19.0]));
        assert_eq!(run.uniforms[0].paint, GlyphPaint::Solid);

        let legacy =
            decode_scene_frame(&encode_scene_frame_version(&legacy_scene, 2).unwrap()).unwrap();
        let SceneNode::BlurredGroup(group) = &legacy.nodes[0] else {
            panic!("expected v2 blurred group")
        };
        let SceneNode::Glyphs(run) = &group.nodes[1] else {
            panic!("expected v2 glyph run")
        };
        assert_eq!(run.uniforms[0].clip, None, "BCS2 v2 没有 clip 字段");
        assert_eq!(run.uniforms[0].paint, GlyphPaint::Solid);
    }

    #[test]
    fn subtitle_scene_wire_keeps_v5_procedural_rounded_rect() {
        let rect = RoundedRectNode {
            rect: [12.0, 34.0, 56.0, 18.0],
            radius: 7.5,
            color: [1.0, 0.25, 0.0, 0.8],
            pose: ScenePose {
                transform: [0.9, 0.1, -0.1, 0.9, 4.0, 5.0],
                opacity: 0.75,
                blur: 0.0,
            },
            motion: None,
        };
        let scene = SceneFrame {
            nodes: vec![SceneNode::RoundedRect(Arc::new(rect.clone()))],
            fingerprint: 101,
            ..SceneFrame::default()
        };

        let packet = encode_scene_frame(&scene).unwrap();
        assert_eq!(u32::from_le_bytes(packet[4..8].try_into().unwrap()), 11);
        let decoded = decode_scene_frame(&packet).unwrap();
        let [SceneNode::RoundedRect(decoded)] = decoded.nodes.as_slice() else {
            panic!("expected rounded rect")
        };
        assert_eq!(decoded.as_ref(), &rect);
        assert!(
            encode_scene_frame_version(&scene, 4)
                .unwrap_err()
                .to_string()
                .contains("requires-v5")
        );
    }

    #[test]
    fn subtitle_scene_wire_v8_round_trips_retained_glyph_stroke() {
        let mask = Arc::new(
            GlyphMask::new(GlyphKey([81, 8]), 2, 2, 0, 2, [0, 96, 192, 255].as_slice()).unwrap(),
        );
        let scene = SceneFrame {
            nodes: vec![SceneNode::Glyphs(Arc::new(GlyphRun {
                glyphs: vec![GlyphInstance {
                    mask,
                    transform: ScenePose::IDENTITY.transform,
                    uniform_index: 0,
                }]
                .into(),
                uniforms: vec![GlyphRunUniform {
                    transform: ScenePose::IDENTITY.transform,
                    color: [0.2, 0.8, 1.0, 0.7],
                    color_opacity: 0.7,
                    clip: None,
                    paint: GlyphPaint::DilatedStroke { width: 5.25 },
                }],
                ..GlyphRun::default()
            }))],
            ..SceneFrame::default()
        };

        let packet = encode_scene_frame(&scene).unwrap();
        assert_eq!(u32::from_le_bytes(packet[4..8].try_into().unwrap()), 11);
        let decoded = decode_scene_frame(&packet).unwrap();
        let [SceneNode::Glyphs(run)] = decoded.nodes.as_slice() else {
            panic!("expected glyph run")
        };
        assert_eq!(
            run.uniforms[0].paint,
            GlyphPaint::DilatedStroke { width: 5.25 }
        );
        assert!(
            encode_scene_frame_version(&scene, 7)
                .unwrap_err()
                .to_string()
                .contains("glyph-stroke-requires-v8")
        );
    }

    #[test]
    fn subtitle_scene_wire_v9_round_trips_one_retained_glyph_texture() {
        let texture = Arc::new(
            GlyphTexture::new(
                GlyphTextureKey([91, 9]),
                2,
                2,
                [
                    255, 0, 0, 255, 0, 128, 0, 128, 0, 0, 64, 64, 255, 255, 255, 255,
                ]
                .as_slice(),
            )
            .unwrap(),
        );
        let scene = SceneFrame {
            nodes: vec![SceneNode::Glyphs(Arc::new(GlyphRun {
                uniforms: vec![GlyphRunUniform {
                    transform: ScenePose::IDENTITY.transform,
                    color: [1.0; 4],
                    color_opacity: 1.0,
                    clip: None,
                    paint: GlyphPaint::RepeatTexture,
                }],
                texture: Some(Arc::clone(&texture)),
                ..GlyphRun::default()
            }))],
            ..SceneFrame::default()
        };

        let packet = encode_scene_frame(&scene).unwrap();
        assert_eq!(u32::from_le_bytes(packet[4..8].try_into().unwrap()), 11);
        let decoded = decode_scene_frame(&packet).unwrap();
        let [SceneNode::Glyphs(run)] = decoded.nodes.as_slice() else {
            panic!("expected textured glyph run")
        };
        assert_eq!(run.uniforms[0].paint, GlyphPaint::RepeatTexture);
        let decoded_texture = run.texture.as_ref().unwrap();
        assert_eq!(decoded_texture.key, texture.key);
        assert_eq!(decoded_texture.rgba.as_ref(), texture.rgba.as_ref());
        assert!(
            encode_scene_frame_version(&scene, 8)
                .unwrap_err()
                .to_string()
                .contains("glyph-texture-requires-v9")
        );

        let missing = SceneFrame {
            nodes: vec![SceneNode::Glyphs(Arc::new(GlyphRun {
                uniforms: vec![GlyphRunUniform {
                    transform: ScenePose::IDENTITY.transform,
                    color: [1.0; 4],
                    color_opacity: 1.0,
                    clip: None,
                    paint: GlyphPaint::RepeatTexture,
                }],
                ..GlyphRun::default()
            }))],
            ..SceneFrame::default()
        };
        assert!(
            encode_scene_frame(&missing)
                .unwrap_err()
                .to_string()
                .contains("resource-mismatch")
        );
    }

    #[test]
    fn subtitle_scene_wire_v7_round_trips_screen_group_without_legacy_downgrade() {
        let group = BlurredGroup {
            nodes: vec![SceneNode::RoundedRect(Arc::new(RoundedRectNode {
                rect: [12.0, 34.0, 56.0, 18.0],
                radius: 7.5,
                color: [1.0, 0.25, 0.0, 0.8],
                pose: ScenePose::IDENTITY,
                motion: None,
            }))],
            radius: 0.0,
            motion: None,
            reveal: None,
            composite: GlyphCompositeMode::Screen,
        };
        let scene = SceneFrame {
            nodes: vec![SceneNode::BlurredGroup(Arc::new(group.clone()))],
            ..SceneFrame::default()
        };
        let decoded = decode_scene_frame(&encode_scene_frame(&scene).unwrap()).unwrap();
        let [SceneNode::BlurredGroup(decoded)] = decoded.nodes.as_slice() else {
            panic!("expected screen group")
        };
        assert_eq!(decoded.composite, GlyphCompositeMode::Screen);
        assert_eq!(decoded.nodes.len(), group.nodes.len());
        assert!(
            encode_scene_frame_version(&scene, 6)
                .unwrap_err()
                .to_string()
                .contains("composite-requires-v7")
        );

        let normal = BlurredGroup {
            composite: GlyphCompositeMode::Normal,
            ..group
        };
        let legacy = SceneFrame {
            nodes: vec![SceneNode::BlurredGroup(Arc::new(normal))],
            ..SceneFrame::default()
        };
        let decoded = decode_scene_frame(&encode_scene_frame_version(&legacy, 6).unwrap()).unwrap();
        let [SceneNode::BlurredGroup(decoded)] = decoded.nodes.as_slice() else {
            panic!("expected legacy group")
        };
        assert_eq!(decoded.composite, GlyphCompositeMode::Normal);
    }

    #[test]
    fn subtitle_scene_wire_v10_round_trips_target_sampling_groups_only() {
        for composite in [
            GlyphCompositeMode::Difference,
            GlyphCompositeMode::Exclusion,
        ] {
            let scene = SceneFrame {
                nodes: vec![SceneNode::BlurredGroup(Arc::new(BlurredGroup {
                    nodes: vec![SceneNode::RoundedRect(Arc::new(RoundedRectNode {
                        rect: [1.0, 2.0, 3.0, 4.0],
                        radius: 0.0,
                        color: [0.1, 0.2, 0.3, 0.4],
                        pose: ScenePose::IDENTITY,
                        motion: None,
                    }))],
                    radius: 0.0,
                    motion: None,
                    reveal: None,
                    composite,
                }))],
                ..SceneFrame::default()
            };
            let packet = encode_scene_frame(&scene).unwrap();
            assert_eq!(u32::from_le_bytes(packet[4..8].try_into().unwrap()), 11);
            let decoded = decode_scene_frame(&packet).unwrap();
            let [SceneNode::BlurredGroup(group)] = decoded.nodes.as_slice() else {
                panic!("expected target-sampling group")
            };
            assert_eq!(group.composite, composite);
            let legacy_packet = encode_scene_frame_version(&scene, 10).unwrap();
            let legacy = decode_scene_frame(&legacy_packet).unwrap();
            let [SceneNode::BlurredGroup(group)] = legacy.nodes.as_slice() else {
                panic!("expected v10 target-sampling group")
            };
            assert_eq!(group.composite, composite);
            assert_eq!(group.reveal, None);
            assert!(
                encode_scene_frame_version(&scene, 9)
                    .unwrap_err()
                    .to_string()
                    .contains("target-composite-requires-v10")
            );

            let glyph_scene = SceneFrame {
                nodes: vec![SceneNode::Glyphs(Arc::new(GlyphRun {
                    composite,
                    ..GlyphRun::default()
                }))],
                ..SceneFrame::default()
            };
            assert!(
                encode_scene_frame(&glyph_scene)
                    .unwrap_err()
                    .to_string()
                    .contains("glyph-target-composite-forbidden")
            );
        }
    }

    #[test]
    fn subtitle_scene_wire_v6_round_trips_screen_glyphs_without_legacy_downgrade() {
        let run = GlyphRun {
            composite: GlyphCompositeMode::Screen,
            ..GlyphRun::default()
        };
        let scene = SceneFrame {
            nodes: vec![SceneNode::Glyphs(Arc::new(run))],
            ..SceneFrame::default()
        };
        let decoded = decode_scene_frame(&encode_scene_frame(&scene).unwrap()).unwrap();
        let [SceneNode::Glyphs(run)] = decoded.nodes.as_slice() else {
            panic!("expected screen glyph run")
        };
        assert_eq!(run.composite, GlyphCompositeMode::Screen);
        assert!(
            encode_scene_frame_version(&scene, 5)
                .unwrap_err()
                .to_string()
                .contains("composite-requires-v6")
        );
    }

    #[test]
    fn subtitle_scene_wire_enforces_the_shared_node_limit() {
        let node = SceneNode::RoundedRect(Arc::new(RoundedRectNode {
            rect: [1.0, 2.0, 3.0, 4.0],
            radius: 1.0,
            color: [0.1, 0.2, 0.3, 0.4],
            pose: ScenePose::IDENTITY,
            motion: None,
        }));
        let boundary = SceneFrame {
            nodes: vec![node.clone(); SCENE_NODE_LIMIT],
            ..SceneFrame::default()
        };
        assert!(encode_scene_frame(&boundary).is_ok());

        let overflow = SceneFrame {
            nodes: vec![node; SCENE_NODE_LIMIT + 1],
            ..SceneFrame::default()
        };
        assert!(
            encode_scene_frame(&overflow)
                .unwrap_err()
                .to_string()
                .contains("subtitle-scene-node-limit")
        );
    }

    #[test]
    fn subtitle_scene_wire_rejects_shader_nodes_and_trailing_bytes() {
        let recipe = motion::preset_registry::timeline_progress("normal").unwrap();
        let quad = render_raster::ShaderQuad::progress(
            recipe,
            &render_raster::source::ProgressParams {
                main_color: [1.0, 1.0, 1.0, 1.0],
                secondary_color: [0.0, 0.0, 0.0, 1.0],
                pixel_scale: 1.0,
            },
            0.5,
            0.0,
            render_raster::source::kernel::DrawBox {
                x: 0.0,
                y: 0.0,
                w: 100.0,
                h: 20.0,
            },
            (1920.0, 1080.0),
        )
        .unwrap();
        let scene = SceneFrame {
            nodes: vec![SceneNode::shader_quad(quad, (1.0, 1.0))],
            ..SceneFrame::default()
        };
        assert!(
            encode_scene_frame(&scene)
                .unwrap_err()
                .to_string()
                .contains("shader-node-forbidden")
        );

        let texture_scene = SceneFrame {
            nodes: vec![SceneNode::Texture(Arc::new(crate::TextureNode {
                texture: "image-a".to_owned(),
                media_ms: -1,
                source_width: 2,
                source_height: 2,
                rect: [0.0, 0.0, 2.0, 2.0],
                transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                opacity: 1.0,
                radius: 0.0,
                mask_shape: crate::TextureMaskShape::RoundedRect,
                mask_feather: 0.0,
                source_effects: Arc::from([]),
                reveal: 1.0,
                iris: 1.0,
                fit: crate::TextureFit::Cover,
                background: crate::TextureBackground::Transparent,
            }))],
            ..SceneFrame::default()
        };
        assert!(
            encode_scene_frame(&texture_scene)
                .unwrap_err()
                .to_string()
                .contains("texture-node-forbidden")
        );

        let mut packet = encode_scene_frame(&SceneFrame::default()).unwrap();
        packet.push(1);
        assert!(
            decode_scene_frame(&packet)
                .unwrap_err()
                .to_string()
                .contains("trailing-bytes")
        );
    }
}
