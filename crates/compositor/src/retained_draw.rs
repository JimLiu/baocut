//! DrawOp geometry -> retained GPU glyphs. Cache misses prepare individual glyph
//! coverage/paint in bounded CPU scratch; only cropped glyph tiles are uploaded.
//! Scene composition and materials are GPU work, not uploaded CPU-rendered frames.
use anyhow::{Result, bail, ensure};
use render_raster::{
    drawop::{self, DrawOp, FrameBuilder, FrameOps, Mat6, PaintData},
    raster::{FrameMedia, paint_from, rasterize_with_media, to_skia_path},
};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::Arc};
use timeline_render::{
    GlyphInstance, GlyphKey, GlyphMask, GlyphPaint, GlyphRun, GlyphRunUniform, RoundedRectNode, SceneFrame, SceneNode, ScenePose,
    post_concat_mat6,
};
const IDENTITY: Mat6 = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
const SCALE: f32 = 4.0;
const MAX_BYTES: usize = 64 * 1024 * 1024;
#[derive(Clone, Copy)]
enum PathMask {
    Fill { even_odd: bool },
    Stroke { width: f32 },
    PaintedStroke { width: f32, cap: u8, join: u8, miter: f32 },
}
struct Entry {
    mask: Arc<GlyphMask>,
    local: Mat6,
    stamp: u64,
}
#[derive(Default)]
pub struct RetainedDrawCache {
    entries: BTreeMap<[u8; 32], Entry>,
    bytes: usize,
    stamp: u64,
    prepared: u64,
    runs: BTreeMap<[u8; 32], std::sync::Weak<[GlyphInstance]>>,
    alpha_scratch: Option<tiny_skia::Mask>,
    color_scratch: Option<tiny_skia::Pixmap>,
}
impl RetainedDrawCache {
    pub fn prepared_masks(&self) -> u64 {
        self.prepared
    }
    pub fn resident_bytes(&self) -> usize {
        self.bytes
    }
    /// CPU preparation scratch, separate from cached/uploaded glyph pixels.
    pub fn preparation_bytes(&self) -> usize {
        self.alpha_scratch.as_ref().map_or(0, |m| m.data().len()) + self.color_scratch.as_ref().map_or(0, |p| p.data().len())
    }
    fn alpha_scratch(&mut self, size: [u32; 2]) -> Result<&mut tiny_skia::Mask> {
        let bytes = u64::from(size[0]) * u64::from(size[1]);
        ensure!(bytes <= MAX_BYTES as u64, "gpu-draw-preparation-budget");
        if bytes + self.color_scratch.as_ref().map_or(0, |p| p.data().len() as u64) > MAX_BYTES as u64 {
            self.color_scratch = None;
        }
        if !self.alpha_scratch.as_ref().is_some_and(|m| [m.width(), m.height()] == size) {
            self.alpha_scratch = None;
            self.alpha_scratch =
                Some(tiny_skia::Mask::new(size[0], size[1]).ok_or_else(|| anyhow::anyhow!("gpu-draw-preparation-budget"))?);
        }
        let mask = self.alpha_scratch.as_mut().unwrap();
        mask.data_mut().fill(0);
        Ok(mask)
    }
    fn color_scratch(&mut self, size: [u32; 2]) -> Result<&mut tiny_skia::Pixmap> {
        let pixels = u64::from(size[0]) * u64::from(size[1]);
        ensure!(pixels <= (MAX_BYTES / 4) as u64, "gpu-draw-preparation-budget");
        let bytes = pixels * 4;
        if bytes + self.alpha_scratch.as_ref().map_or(0, |m| m.data().len() as u64) > MAX_BYTES as u64 {
            self.alpha_scratch = None;
        }
        if !self.color_scratch.as_ref().is_some_and(|p| [p.width(), p.height()] == size) {
            self.color_scratch = None;
            self.color_scratch =
                Some(tiny_skia::Pixmap::new(size[0], size[1]).ok_or_else(|| anyhow::anyhow!("gpu-draw-preparation-budget"))?);
        }
        let pixmap = self.color_scratch.as_mut().unwrap();
        pixmap.data_mut().fill(0);
        Ok(pixmap)
    }
    /// Unsupported operations fail explicitly; callers must use the CPU reference.
    /// Geometric masks reuse transform/color uniforms. Device hairlines retain
    /// their complete transform and paint in the cache key instead.
    /// This entry point has no canvas clip; render-target sources should use
    /// `prepare_for_canvas` to preserve device hairline endpoint coverage.
    pub fn prepare(&mut self, frame: &FrameOps) -> Result<SceneFrame> {
        self.prepare_in_viewport(frame, None)
    }
    /// Preserve the CPU's device-coordinate subdivision, clipping and scanning
    /// grid. Cache misses prepare/crop individual glyphs in bounded CPU scratch.
    pub fn prepare_for_canvas(&mut self, frame: &FrameOps, width: u32, height: u32) -> Result<SceneFrame> {
        ensure!(width > 0 && height > 0, "gpu-draw-canvas-size-invalid");
        self.prepare_in_viewport(frame, Some([width, height]))
    }
    fn prepare_in_viewport(&mut self, frame: &FrameOps, viewport: Option<[u32; 2]>) -> Result<SceneFrame> {
        ensure!(frame.ops.len() <= 65536, "gpu-draw-operation-limit");
        self.stamp = self.stamp.wrapping_add(1);
        let mut nodes = Vec::new();
        let mut stack = Vec::new();
        let mut hidden = false;
        let mut run = GlyphRun::default();
        let mut instances = Vec::new();
        for op in &frame.ops {
            if !hidden && crate::device_hairline::is_hairline(op)? {
                self.hairline(frame, op, viewport, &mut run, &mut instances)?;
                if instances.len() >= 1024 {
                    flush(&mut nodes, &mut run, &mut instances);
                }
                continue;
            }
            match op {
                DrawOp::PushLayer { opacity, blend } => {
                    ensure!(*blend == motion::effect::BlendMode::Normal, "gpu-draw-layer-blend-unsupported");
                    ensure!(*opacity == 0.0 || *opacity == 1.0, "gpu-draw-group-opacity-unsupported");
                    stack.push(hidden);
                    hidden |= *opacity == 0.0;
                }
                DrawOp::PopLayer => {
                    hidden = stack.pop().ok_or_else(|| anyhow::anyhow!("gpu-draw-layer-stack-invalid"))?;
                }
                _ if hidden => {}
                DrawOp::FillRect {
                    x,
                    y,
                    w,
                    h,
                    radius,
                    color,
                    tf,
                } => {
                    flush(&mut nodes, &mut run, &mut instances);
                    nodes.push(SceneNode::RoundedRect(Arc::new(RoundedRectNode {
                        rect: [*x, *y, *w, *h],
                        radius: *radius,
                        color: *color,
                        pose: ScenePose {
                            transform: *tf,
                            ..Default::default()
                        },
                        motion: None,
                    })));
                }
                DrawOp::FillPath { path, color, tf } => self.path(
                    frame,
                    *path,
                    PathMask::Fill { even_odd: false },
                    *color,
                    *tf,
                    viewport,
                    &mut run,
                    &mut instances,
                )?,
                DrawOp::StrokePath { path, color, width, tf } => self.path(
                    frame,
                    *path,
                    PathMask::Stroke { width: *width },
                    *color,
                    *tf,
                    viewport,
                    &mut run,
                    &mut instances,
                )?,
                DrawOp::FillPathPaint { path, paint, even_odd, tf } => {
                    let Some(PaintData::Solid(color)) = frame.paints.get(*paint as usize) else {
                        bail!("gpu-draw-paint-unsupported")
                    };
                    self.path(
                        frame,
                        *path,
                        PathMask::Fill { even_odd: *even_odd },
                        *color,
                        *tf,
                        viewport,
                        &mut run,
                        &mut instances,
                    )?;
                }
                DrawOp::StrokePathPaint {
                    path,
                    paint,
                    width,
                    cap,
                    join,
                    miter,
                    tf,
                } => {
                    let Some(PaintData::Solid(color)) = frame.paints.get(*paint as usize) else {
                        bail!("gpu-draw-paint-unsupported")
                    };
                    ensure!(
                        width.is_finite() && *width >= 0.0 && miter.is_finite() && *cap <= 2 && *join <= 2,
                        "gpu-draw-stroke-invalid"
                    );
                    self.path(
                        frame,
                        *path,
                        PathMask::PaintedStroke {
                            width: *width,
                            cap: *cap,
                            join: *join,
                            miter: *miter,
                        },
                        *color,
                        *tf,
                        viewport,
                        &mut run,
                        &mut instances,
                    )?;
                }
                DrawOp::DrawBitmap { bitmap, opacity, tf } => {
                    let bitmap = frame
                        .bitmaps
                        .get(*bitmap as usize)
                        .ok_or_else(|| anyhow::anyhow!("gpu-draw-bitmap-index"))?;
                    let mut hasher = Sha256::new();
                    hasher.update(b"rgba/1");
                    hasher.update(bitmap.width.to_le_bytes());
                    hasher.update(bitmap.height.to_le_bytes());
                    hasher.update(&bitmap.rgba);
                    let key: [u8; 32] = hasher.finalize().into();
                    let mask = if let Some(entry) = self.entries.get_mut(&key) {
                        entry.stamp = self.stamp;
                        entry.mask.clone()
                    } else {
                        ensure!(bitmap.width <= 2046 && bitmap.height <= 2046, "gpu-draw-bitmap-atlas-size");
                        let mask = Arc::new(
                            GlyphMask::new_color(glyph_key(key), bitmap.width, bitmap.height, 0, 0, bitmap.rgba.clone())
                                .ok_or_else(|| anyhow::anyhow!("gpu-draw-bitmap-bytes"))?,
                        );
                        self.insert(key, mask.clone(), IDENTITY)?;
                        mask
                    };
                    append(&mut run, &mut instances, mask, *tf, [1.0, 1.0, 1.0, *opacity], *opacity);
                }
                _ => bail!("gpu-draw-operation-unsupported"),
            }
            if instances.len() >= 1024 {
                flush(&mut nodes, &mut run, &mut instances);
            }
        }
        ensure!(stack.is_empty(), "gpu-draw-layer-stack-invalid");
        flush(&mut nodes, &mut run, &mut instances);
        ensure!(nodes.len() <= 4096, "gpu-draw-node-limit");
        if self.runs.len() > 4096 {
            self.runs.retain(|_, v| v.strong_count() > 0);
        }
        for node in &mut nodes {
            if let SceneNode::Glyphs(run) = node {
                let mut hash = Sha256::new();
                for glyph in run.glyphs.iter() {
                    hash.update(glyph.mask.key.0[0].to_le_bytes());
                    hash.update(glyph.mask.key.0[1].to_le_bytes());
                    hash.update(glyph.uniform_index.to_le_bytes());
                }
                let key: [u8; 32] = hash.finalize().into();
                if let Some(previous) = self.runs.get(&key).and_then(std::sync::Weak::upgrade) {
                    Arc::make_mut(run).glyphs = previous;
                }
                self.runs.insert(key, Arc::downgrade(&run.glyphs));
            }
        }
        Ok(SceneFrame {
            nodes,
            ..Default::default()
        })
    }
    fn path(
        &mut self,
        frame: &FrameOps,
        index: u32,
        shape: PathMask,
        color: [f32; 4],
        tf: Mat6,
        viewport: Option<[u32; 2]>,
        run: &mut GlyphRun,
        instances: &mut Vec<GlyphInstance>,
    ) -> Result<()> {
        if color[3] == 0.0 {
            return Ok(());
        }
        if let Some(size) = viewport {
            return self.device_path(frame, index, shape, color, tf, size, run, instances);
        }
        let path = frame
            .paths
            .get(index as usize)
            .ok_or_else(|| anyhow::anyhow!("gpu-draw-path-index"))?;
        let mut builder = FrameBuilder::default();
        let id = builder.path_id(path.clone());
        let mask_paint = if matches!(shape, PathMask::Fill { even_odd: true } | PathMask::PaintedStroke { .. }) {
            builder.paint_id(PaintData::Solid([1.0; 4]))
        } else {
            0
        };
        builder.push(match shape {
            PathMask::Fill { even_odd: false } => DrawOp::FillPath {
                path: id,
                color: [1.0; 4],
                tf: IDENTITY,
            },
            PathMask::Stroke { width } => DrawOp::StrokePath {
                path: id,
                width,
                color: [1.0; 4],
                tf: IDENTITY,
            },
            PathMask::Fill { even_odd: true } => DrawOp::FillPathPaint {
                path: id,
                paint: mask_paint,
                even_odd: true,
                tf: IDENTITY,
            },
            PathMask::PaintedStroke { width, cap, join, miter } => DrawOp::StrokePathPaint {
                path: id,
                paint: mask_paint,
                width,
                cap,
                join,
                miter,
                tf: IDENTITY,
            },
        });
        let mut normalized = builder.finish();
        let key: [u8; 32] = Sha256::digest(drawop::encode(&normalized)).into();
        if !self.entries.contains_key(&key) {
            let path = to_skia_path(path).ok_or_else(|| anyhow::anyhow!("gpu-draw-path-invalid"))?;
            let bounds = path.bounds();
            let pad = match shape {
                PathMask::Fill { .. } => 1.0,
                PathMask::Stroke { width } => width * 0.5 + 1.0,
                PathMask::PaintedStroke { width, cap, join, miter } => {
                    let reach = if join == 0 { miter.max(1.0) } else { 1.0 };
                    let reach = if cap == 2 { reach.max(std::f32::consts::SQRT_2) } else { reach };
                    width * 0.5 * reach + 1.0
                }
            };
            let x = (bounds.left() - pad).floor();
            let y = (bounds.top() - pad).floor();
            let w = ((bounds.right() + pad - x) * SCALE).ceil();
            let h = ((bounds.bottom() + pad - y) * SCALE).ceil();
            ensure!(
                w.is_finite() && h.is_finite() && w > 0.0 && h > 0.0 && w <= 2046.0 && h <= 2046.0,
                "gpu-draw-path-atlas-size"
            );
            let transform = [SCALE, 0.0, 0.0, SCALE, -x * SCALE, -y * SCALE];
            match &mut normalized.ops[0] {
                DrawOp::FillPath { tf, .. }
                | DrawOp::StrokePath { tf, .. }
                | DrawOp::FillPathPaint { tf, .. }
                | DrawOp::StrokePathPaint { tf, .. } => *tf = transform,
                _ => unreachable!(),
            };
            let raster = rasterize_with_media(&normalized, w as u32, h as u32, &mut NoMedia)?;
            let alpha: Vec<u8> = raster.data().chunks_exact(4).map(|p| p[3]).collect();
            let mask = Arc::new(GlyphMask::new(glyph_key(key), w as u32, h as u32, 0, 0, alpha).unwrap());
            self.insert(key, mask, [1.0 / SCALE, 0.0, 0.0, 1.0 / SCALE, x, y])?;
        }
        let entry = self.entries.get_mut(&key).unwrap();
        entry.stamp = self.stamp;
        append(
            run,
            instances,
            entry.mask.clone(),
            post_concat_mat6(entry.local, tf),
            color,
            color[3],
        );
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    fn device_path(
        &mut self,
        frame: &FrameOps,
        index: u32,
        shape: PathMask,
        color: [f32; 4],
        tf: Mat6,
        size: [u32; 2],
        run: &mut GlyphRun,
        instances: &mut Vec<GlyphInstance>,
    ) -> Result<()> {
        ensure!(tf.iter().all(|v| v.is_finite()), "gpu-draw-path-transform-invalid");
        let source = frame
            .paths
            .get(index as usize)
            .ok_or_else(|| anyhow::anyhow!("gpu-draw-path-index"))?;
        let mut builder = FrameBuilder::default();
        let path = builder.path_id(source.clone());
        let paint = builder.paint_id(PaintData::Solid([1.0; 4]));
        builder.push(match shape {
            PathMask::Fill { even_odd } => DrawOp::FillPathPaint { path, paint, even_odd, tf },
            PathMask::Stroke { width } => DrawOp::StrokePath {
                path,
                color: [1.0; 4],
                width,
                tf,
            },
            PathMask::PaintedStroke { width, cap, join, miter } => DrawOp::StrokePathPaint {
                path,
                paint,
                width,
                cap,
                join,
                miter,
                tf,
            },
        });
        let mut hash = Sha256::new();
        hash.update(b"device-path-coverage/1");
        for value in size {
            hash.update(value.to_le_bytes());
        }
        hash.update(drawop::encode(&builder.finish()));
        let key: [u8; 32] = hash.finalize().into();
        if !self.entries.contains_key(&key) {
            let ts = tiny_skia::Transform::from_row(tf[0], tf[1], tf[2], tf[3], tf[4], tf[5]);
            let mut path = to_skia_path(source).ok_or_else(|| anyhow::anyhow!("gpu-draw-path-invalid"))?;
            let stroke = match shape {
                PathMask::Fill { .. } => None,
                PathMask::Stroke { width } => Some(tiny_skia::Stroke {
                    width,
                    line_cap: tiny_skia::LineCap::Round,
                    line_join: tiny_skia::LineJoin::Round,
                    ..Default::default()
                }),
                PathMask::PaintedStroke { width, cap, join, miter } => Some(tiny_skia::Stroke {
                    width,
                    line_cap: match cap {
                        0 => tiny_skia::LineCap::Butt,
                        1 => tiny_skia::LineCap::Round,
                        _ => tiny_skia::LineCap::Square,
                    },
                    line_join: match join {
                        0 => tiny_skia::LineJoin::Miter,
                        1 => tiny_skia::LineJoin::Round,
                        _ => tiny_skia::LineJoin::Bevel,
                    },
                    miter_limit: miter.max(1.0),
                    ..Default::default()
                }),
            };
            if let Some(stroke) = stroke {
                // Stroke the original local path with the original resolution
                // scale, then map the outline. Stroking a transformed centerline
                // changes nonuniform transforms and curve flattening.
                let Some(outline) = path.stroke(&stroke, tiny_skia::PathStroker::compute_resolution_scale(&ts)) else {
                    return Ok(());
                };
                path = outline;
            }
            let path = path.transform(ts).ok_or_else(|| anyhow::anyhow!("gpu-draw-path-invalid"))?;
            let bounds = path.bounds();
            let x = (bounds.left() - 2.0).floor().max(0.0);
            let y = (bounds.top() - 2.0).floor().max(0.0);
            let right = (bounds.right() + 2.0).ceil().min(size[0] as f32);
            let bottom = (bounds.bottom() + 2.0).ceil().min(size[1] as f32);
            if right <= x || bottom <= y {
                return Ok(());
            }
            let w = right - x;
            let h = bottom - y;
            ensure!(
                w.is_finite() && h.is_finite() && w <= 2046.0 && h <= 2046.0,
                "gpu-draw-path-atlas-size"
            );
            let rule = if matches!(shape, PathMask::Fill { even_odd: true }) {
                tiny_skia::FillRule::EvenOdd
            } else {
                tiny_skia::FillRule::Winding
            };
            // Curve subdivision itself is f32 translation-sensitive. Scan the
            // original device coordinates/viewport, then crop the immutable
            // coverage; never translate curves before flattening. Only the
            // bounded glyph tile is uploaded, not this preparation scratch.
            let scratch = self.alpha_scratch(size)?;
            scratch.fill_path(&path, rule, true, tiny_skia::Transform::identity());
            let mut alpha = Vec::with_capacity((w * h) as usize);
            for row in y as u32..bottom as u32 {
                let start = row as usize * size[0] as usize + x as usize;
                alpha.extend_from_slice(&scratch.data()[start..start + w as usize]);
            }
            let mask = Arc::new(GlyphMask::new(glyph_key(key), w as u32, h as u32, 0, 0, alpha).unwrap());
            self.insert(key, mask, [1.0, 0.0, 0.0, 1.0, x, y])?;
        }
        let entry = self.entries.get_mut(&key).unwrap();
        entry.stamp = self.stamp;
        append(run, instances, entry.mask.clone(), entry.local, color, color[3]);
        Ok(())
    }
    fn hairline(
        &mut self,
        frame: &FrameOps,
        op: &DrawOp,
        viewport: Option<[u32; 2]>,
        run: &mut GlyphRun,
        instances: &mut Vec<GlyphInstance>,
    ) -> Result<()> {
        let (path_index, data, width, cap, join, miter, tf) = match op {
            DrawOp::StrokePath { path, color, width, tf } => (*path, PaintData::Solid(*color), *width, 1, 1, 4.0, *tf),
            DrawOp::StrokePathPaint {
                path,
                paint,
                width,
                cap,
                join,
                miter,
                tf,
            } => (
                *path,
                frame
                    .paints
                    .get(*paint as usize)
                    .ok_or_else(|| anyhow::anyhow!("gpu-draw-paint-index"))?
                    .clone(),
                *width,
                *cap,
                *join,
                *miter,
                *tf,
            ),
            _ => unreachable!(),
        };
        ensure!(cap <= 2 && join <= 2 && miter.is_finite(), "gpu-draw-stroke-invalid");
        ensure!(
            matches!(data, PaintData::Solid(_) | PaintData::Linear { .. }),
            "gpu-draw-paint-unsupported"
        );
        let coverage = crate::device_hairline::coverage(width, tf)?.unwrap();
        let source = frame
            .paths
            .get(path_index as usize)
            .ok_or_else(|| anyhow::anyhow!("gpu-draw-path-index"))?;
        let mut builder = FrameBuilder::default();
        let path_id = builder.path_id(source.clone());
        let paint_id = builder.paint_id(data.clone());
        builder.push(DrawOp::StrokePathPaint {
            path: path_id,
            paint: paint_id,
            width,
            cap,
            join,
            miter,
            tf,
        });
        // Include the original f32 transform, paint and geometry. Integer
        // translation can change fixed-point phase after f32 mapping, so it is
        // deliberately not normalized out of this key.
        let mut hasher = Sha256::new();
        hasher.update(b"device-hairline/2");
        hasher.update([u8::from(viewport.is_some())]);
        if let Some([width, height]) = viewport {
            hasher.update(width.to_le_bytes());
            hasher.update(height.to_le_bytes());
        }
        hasher.update(drawop::encode(&builder.finish()));
        let key: [u8; 32] = hasher.finalize().into();
        if !self.entries.contains_key(&key) {
            let ts = tiny_skia::Transform::from_row(tf[0], tf[1], tf[2], tf[3], tf[4], tf[5]);
            let path = to_skia_path(source)
                .and_then(|p| p.transform(ts))
                .ok_or_else(|| anyhow::anyhow!("gpu-draw-path-invalid"))?;
            let bounds = path.bounds();
            let mut x = (bounds.left() - 2.0).floor();
            let mut y = (bounds.top() - 2.0).floor();
            let mut right = (bounds.right() + 2.0).ceil();
            let mut bottom = (bounds.bottom() + 2.0).ceil();
            if let Some([width, height]) = viewport {
                x = x.max(0.0);
                y = y.max(0.0);
                right = right.min(width as f32);
                bottom = bottom.min(height as f32);
                if right <= x || bottom <= y {
                    return Ok(());
                }
            }
            let w = right - x;
            let h = bottom - y;
            ensure!(
                w.is_finite() && h.is_finite() && w > 0.0 && h > 0.0 && w <= 2046.0 && h <= 2046.0,
                "gpu-draw-path-atlas-size"
            );
            if let Some(size) = viewport {
                let original = to_skia_path(source).ok_or_else(|| anyhow::anyhow!("gpu-draw-path-invalid"))?;
                let stroke = tiny_skia::Stroke {
                    width,
                    line_cap: match cap {
                        0 => tiny_skia::LineCap::Butt,
                        1 => tiny_skia::LineCap::Round,
                        _ => tiny_skia::LineCap::Square,
                    },
                    line_join: match join {
                        0 => tiny_skia::LineJoin::Miter,
                        1 => tiny_skia::LineJoin::Round,
                        _ => tiny_skia::LineJoin::Bevel,
                    },
                    miter_limit: miter.max(1.0),
                    ..Default::default()
                };
                let scratch = self.color_scratch(size)?;
                scratch.stroke_path(&original, &paint_from(&data, &[])?, &stroke, ts, None);
                let mut rgba = Vec::with_capacity((w * h * 4.0) as usize);
                for row in y as u32..bottom as u32 {
                    let start = (row as usize * size[0] as usize + x as usize) * 4;
                    rgba.extend_from_slice(&scratch.data()[start..start + w as usize * 4]);
                }
                let mask = Arc::new(GlyphMask::new_color(glyph_key(key), w as u32, h as u32, 0, 0, rgba).unwrap());
                self.insert(key, mask, [1.0, 0.0, 0.0, 1.0, x, y])?;
                let entry = self.entries.get_mut(&key).unwrap();
                entry.stamp = self.stamp;
                append(run, instances, entry.mask.clone(), entry.local, [1.0; 4], 1.0);
                return Ok(());
            }
            let offset = tiny_skia::Transform::from_translate(-x, -y);
            let path = path.transform(offset).ok_or_else(|| anyhow::anyhow!("gpu-draw-path-invalid"))?;
            let mut paint = paint_from(&data, &[])?;
            if coverage != 1.0 {
                let alpha = (255 * (coverage * 256.0) as i32) >> 8;
                paint.shader.apply_opacity(alpha as f32 / 255.0);
            }
            paint.shader.transform(ts);
            paint.shader.transform(offset);
            let stroke = tiny_skia::Stroke {
                width: 0.0,
                line_cap: match cap {
                    0 => tiny_skia::LineCap::Butt,
                    1 => tiny_skia::LineCap::Round,
                    _ => tiny_skia::LineCap::Square,
                },
                ..Default::default()
            };
            let mut tile = tiny_skia::Pixmap::new(w as u32, h as u32).ok_or_else(|| anyhow::anyhow!("gpu-draw-path-atlas-size"))?;
            tile.stroke_path(&path, &paint, &stroke, tiny_skia::Transform::identity(), None);
            let mask = Arc::new(GlyphMask::new_color(glyph_key(key), w as u32, h as u32, 0, 0, tile.data().to_vec()).unwrap());
            self.insert(key, mask, [1.0, 0.0, 0.0, 1.0, x, y])?;
        }
        let entry = self.entries.get_mut(&key).unwrap();
        entry.stamp = self.stamp;
        append(run, instances, entry.mask.clone(), entry.local, [1.0; 4], 1.0);
        Ok(())
    }
    fn insert(&mut self, key: [u8; 32], mask: Arc<GlyphMask>, local: Mat6) -> Result<()> {
        let size = mask.pixels.data().len();
        ensure!(size <= MAX_BYTES, "gpu-draw-cache-budget");
        while self.bytes + size > MAX_BYTES {
            let oldest = *self.entries.iter().min_by_key(|(_, e)| e.stamp).unwrap().0;
            self.bytes -= self.entries.remove(&oldest).unwrap().mask.pixels.data().len();
        }
        self.bytes += size;
        self.prepared += 1;
        self.entries.insert(
            key,
            Entry {
                mask,
                local,
                stamp: self.stamp,
            },
        );
        Ok(())
    }
}
fn glyph_key(key: [u8; 32]) -> GlyphKey {
    GlyphKey([
        u64::from_le_bytes(key[..8].try_into().unwrap()),
        u64::from_le_bytes(key[8..16].try_into().unwrap()),
    ])
}
fn append(run: &mut GlyphRun, instances: &mut Vec<GlyphInstance>, mask: Arc<GlyphMask>, transform: Mat6, color: [f32; 4], opacity: f32) {
    let index = run.uniforms.len() as u32;
    instances.push(GlyphInstance {
        mask,
        transform: IDENTITY,
        uniform_index: index,
    });
    run.uniforms.push(GlyphRunUniform {
        transform,
        color,
        color_opacity: opacity,
        clip: None,
        paint: GlyphPaint::Solid,
    });
}
fn flush(nodes: &mut Vec<SceneNode>, run: &mut GlyphRun, instances: &mut Vec<GlyphInstance>) {
    if instances.is_empty() {
        return;
    }
    run.glyphs = std::mem::take(instances).into();
    nodes.push(SceneNode::Glyphs(Arc::new(std::mem::take(run))));
}
struct NoMedia;
impl FrameMedia for NoMedia {
    fn frame(&mut self, _: &str, _: i64) -> Result<Arc<tiny_skia::Pixmap>> {
        bail!("gpu-draw-media-unsupported")
    }
}
