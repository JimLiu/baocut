//! Layer-major text paint. Each paint layer (or the legacy stroke, then fill)
//! covers every glyph of a node before the next one starts, so an outline or a
//! shadow never paints over a neighbouring glyph's fill. Spread and blurred
//! layers are one coverage per paint and opacity run; a blurred layer is
//! recorded on its own, rasterized once in device space and drawn back as a
//! single bitmap.
use super::materials::EmptyMedia;
use super::*;
use render_raster::effects::filters::gaussian::{MIN_SIGMA, gaussian_blur_premul_u8};
use render_raster::fonts::ShapedGlyph;

/// Largest device surface one blurred paint layer may allocate.
const MAX_BLUR_PIXELS: u64 = 16 * 1024 * 1024;

pub(super) struct GlyphPaint {
    pub glyph: ShapedGlyph,
    /// Resolved fill with the glyph opacity already applied.
    pub fill: [f64; 4],
    pub opacity: f64,
    pub source_scalar_index: usize,
    pub origin: Transform,
    pub paint_bounds: Bounds,
    pub page_bounds: Bounds,
    pub paint_origin: (f64, f64),
}

pub(super) enum Shape {
    Outline(tiny_skia::Path),
    Bitmap(BitmapData, i32, i32),
    Empty,
}

pub(super) fn record_glyphs(
    style: &TextStyle,
    glyphs: &[GlyphPaint],
    canvas: (u32, u32),
    text: &mut TextEngine,
    images: &BTreeMap<String, BitmapData>,
    b: &mut FrameBuilder,
    budget: &mut Budget,
) -> Result<()> {
    let mut shapes = Vec::with_capacity(glyphs.len());
    for g in glyphs {
        shapes.push(match text.glyph_render(g.glyph.cache_key) {
            GlyphRender::Outline(path) => Shape::Outline(path),
            GlyphRender::ColorBitmap {
                width,
                height,
                rgba,
                left,
                top,
            } => Shape::Bitmap(
                BitmapData {
                    width,
                    height,
                    rgba,
                },
                left,
                top,
            ),
            GlyphRender::Empty => Shape::Empty,
        });
    }
    if style.paints.is_empty() {
        if let Some(s) = &style.stroke {
            let base = color(&s.color)?;
            for (g, shape) in glyphs.iter().zip(&shapes) {
                if let Shape::Outline(path) = shape {
                    let mut sc = base;
                    sc[3] *= g.opacity.clamp(0.0, 1.0);
                    let id = b.path_id(path_from_skia(path));
                    b.push(DrawOp::StrokePath {
                        path: id,
                        color: sc.map(|v| v as f32),
                        width: s.width as f32,
                        tf: tf(g.origin),
                    });
                }
            }
        }
        for (g, shape) in glyphs.iter().zip(&shapes) {
            match shape {
                Shape::Outline(path) => {
                    let id = b.path_id(path_from_skia(path));
                    b.push(DrawOp::FillPath {
                        path: id,
                        color: g.fill.map(|v| v.clamp(0.0, 1.0) as f32),
                        tf: tf(g.origin),
                    });
                }
                Shape::Bitmap(..) => draw_bitmap(g, shape, b),
                Shape::Empty => {}
            }
        }
        return Ok(());
    }
    for layer in &style.paints {
        if matches!(layer.paint, ScenePaint::Image { .. }) {
            super::image_paint::record_layer(layer, glyphs, &shapes, canvas, images, b, budget)?;
            continue;
        }
        if layer.coverage.is_some() {
            coverage_layer(layer, glyphs, &shapes, canvas, b, budget)?;
            continue;
        }
        if layer.spread > 0.0 || layer.blur > 0.0 {
            effect_layer(layer, glyphs, &shapes, canvas, b, budget, &mut 0)?;
            continue;
        }
        for (g, shape) in glyphs.iter().zip(&shapes) {
            let Shape::Outline(path) = shape else {
                continue;
            };
            budget.spend()?;
            let em = em(g, layer.unit);
            let paint = match &layer.paint {
                ScenePaint::NodeFill => PaintData::Solid(g.fill.map(|v| v.clamp(0.0, 1.0) as f32)),
                paint => scene_paint(
                    paint,
                    paint_bounds(paint, g, path),
                    g.paint_origin,
                    g.opacity,
                )?,
            };
            let paint = b.paint_id(paint);
            let id = b.path_id(path_from_skia(path));
            let transform = g
                .origin
                .pre_translate((layer.offset[0] * em) as f32, (layer.offset[1] * em) as f32);
            b.push(if layer.stroke_width > 0.0 {
                DrawOp::StrokePathPaint {
                    path: id,
                    paint,
                    width: (layer.stroke_width * em) as f32,
                    cap: 1,
                    join: 1,
                    miter: 4.0,
                    tf: tf(transform),
                }
            } else {
                DrawOp::FillPathPaint {
                    path: id,
                    paint,
                    even_odd: false,
                    tf: tf(transform),
                }
            });
        }
    }
    // Color glyphs carry their own pixels and cannot be outlined or shadowed.
    for (g, shape) in glyphs.iter().zip(&shapes) {
        draw_bitmap(g, shape, b);
    }
    Ok(())
}

fn draw_bitmap(g: &GlyphPaint, shape: &Shape, b: &mut FrameBuilder) {
    if let Shape::Bitmap(bitmap, left, top) = shape {
        let id = b.bitmap_id(bitmap.clone());
        b.push(DrawOp::DrawBitmap {
            bitmap: id,
            opacity: g.opacity.clamp(0.0, 1.0) as f32,
            tf: tf(g.origin.pre_translate(*left as f32, -*top as f32)),
        });
    }
}

fn em(g: &GlyphPaint, unit: PaintUnit) -> f64 {
    match unit {
        PaintUnit::Px => 1.0,
        PaintUnit::Em => f64::from(f32::from_bits(g.glyph.cache_key.font_size_bits)),
    }
}

/// Gradient domain in line coordinates. The glyph domain is the outline's
/// glyph-local control box, moved by the paint origin and grown by
/// `glyphOutset` font-size em per side; it ignores the layer's own spread,
/// stroke and offset, so every layer of a glyph shares one ramp.
pub(super) fn paint_bounds(paint: &ScenePaint, g: &GlyphPaint, path: &tiny_skia::Path) -> Bounds {
    match paint {
        ScenePaint::Linear {
            domain: GradientDomain::Page,
            ..
        } => g.page_bounds,
        ScenePaint::Linear {
            domain: GradientDomain::Glyph,
            glyph_outset,
            ..
        } => {
            let ink = path.bounds();
            let grow = glyph_outset * em(g, PaintUnit::Em);
            Bounds {
                x: g.paint_origin.0 + f64::from(ink.x()) - grow,
                y: g.paint_origin.1 + f64::from(ink.y()) - grow,
                width: f64::from(ink.width()) + 2.0 * grow,
                height: f64::from(ink.height()) + 2.0 * grow,
            }
        }
        _ => g.paint_bounds,
    }
}

fn isolated_paint(
    layer: &PaintLayer,
    g: &GlyphPaint,
    path: &tiny_skia::Path,
) -> Result<(PaintData, f64)> {
    let (paint, alpha) = match &layer.paint {
        ScenePaint::Solid { color: c } => {
            let c = color(c)?;
            (
                PaintData::Solid([c[0] as f32, c[1] as f32, c[2] as f32, 1.0]),
                c[3] * g.opacity,
            )
        }
        ScenePaint::NodeFill => (
            PaintData::Solid([g.fill[0] as f32, g.fill[1] as f32, g.fill[2] as f32, 1.0]),
            g.fill[3],
        ),
        paint => (
            scene_paint(paint, paint_bounds(paint, g, path), g.paint_origin, 1.0)?,
            g.opacity,
        ),
    };
    Ok((paint, alpha.clamp(0.0, 1.0)))
}

/// Gradient endpoints are expressed in each glyph's local coordinates, so
/// their side-table IDs differ even when they describe one declared paint.
/// Only resolved node-fill colours split a paint run; gradients retain each
/// glyph's own coordinates while sharing the silhouette opacity group.
fn paint_run_key(layer: &PaintLayer, g: &GlyphPaint) -> Result<([u32; 3], f64)> {
    let (rgb, alpha) = match &layer.paint {
        ScenePaint::NodeFill => (
            [
                (g.fill[0] as f32).to_bits(),
                (g.fill[1] as f32).to_bits(),
                (g.fill[2] as f32).to_bits(),
            ],
            g.fill[3],
        ),
        ScenePaint::Solid { color: c } => ([0; 3], color(c)?[3] * g.opacity),
        ScenePaint::Linear { .. } => ([0; 3], g.opacity),
        ScenePaint::Image { .. } => bail!("CAPTION_SCENE_INVALID: image paint requires image recording"),
    };
    Ok((rgb, alpha.clamp(0.0, 1.0)))
}

/// Keep opacity out of the coverage transfer. Distinct paint/opacity runs are
/// isolated separately, preserving the existing run order and overlap semantics.
fn coverage_layer(
    layer: &PaintLayer,
    glyphs: &[GlyphPaint],
    shapes: &[Shape],
    canvas: (u32, u32),
    b: &mut FrameBuilder,
    budget: &mut Budget,
) -> Result<()> {
    let mut start = 0;
    let mut surface_pixels = 0;
    while start < glyphs.len() {
        if !matches!(shapes[start], Shape::Outline(_)) {
            start += 1;
            continue;
        }
        let key = paint_run_key(layer, &glyphs[start])?;
        let mut end = start + 1;
        while end < glyphs.len()
            && (!matches!(shapes[end], Shape::Outline(_))
                || paint_run_key(layer, &glyphs[end])? == key)
        {
            end += 1;
        }
        if key.1 > 0.0 {
            b.push(DrawOp::PushLayer {
                opacity: key.1 as f32,
                blend: motion::effect::BlendMode::Normal,
            });
            effect_layer(
                layer,
                &glyphs[start..end],
                &shapes[start..end],
                canvas,
                b,
                budget,
                &mut surface_pixels,
            )?;
            b.push(DrawOp::PopLayer);
        }
        start = end;
    }
    Ok(())
}

/// Spread or blurred layer: the silhouette of each run of glyphs that shares a
/// paint and opacity is drawn opaque inside one opacity group, so overlapping
/// fill, outline and neighbouring glyphs form a single coverage.
fn effect_layer(
    layer: &PaintLayer,
    glyphs: &[GlyphPaint],
    shapes: &[Shape],
    canvas: (u32, u32),
    b: &mut FrameBuilder,
    budget: &mut Budget,
    surface_pixels: &mut u64,
) -> Result<()> {
    let mut device: Option<[f32; 4]> = None;
    let mut sigma = 0.0_f64;
    for (g, shape) in glyphs.iter().zip(shapes) {
        let Shape::Outline(path) = shape else {
            continue;
        };
        let em = em(g, layer.unit);
        let grow = (layer.spread.max(layer.stroke_width / 2.0) * em) as f32;
        let (dx, dy) = ((layer.offset[0] * em) as f32, (layer.offset[1] * em) as f32);
        let r = path.bounds();
        let mut corners = [
            tiny_skia::Point::from_xy(r.left() - grow + dx, r.top() - grow + dy),
            tiny_skia::Point::from_xy(r.right() + grow + dx, r.top() - grow + dy),
            tiny_skia::Point::from_xy(r.left() - grow + dx, r.bottom() + grow + dy),
            tiny_skia::Point::from_xy(r.right() + grow + dx, r.bottom() + grow + dy),
        ];
        g.origin.map_points(&mut corners);
        for p in corners {
            let d = device.get_or_insert([p.x, p.y, p.x, p.y]);
            *d = [d[0].min(p.x), d[1].min(p.y), d[2].max(p.x), d[3].max(p.y)];
        }
        // Blur follows the glyph transform's area scale, like the outline does.
        let t = g.origin;
        let scale = f64::from((t.sx * t.sy - t.kx * t.ky).abs()).sqrt();
        sigma = sigma.max(layer.blur * em * scale);
    }
    let Some(device) = device else {
        return Ok(());
    };
    if sigma < MIN_SIGMA && layer.coverage.is_none() {
        return isolated(layer, glyphs, shapes, Transform::identity(), b, budget);
    }
    // Only the canvas plus the blur reach can contribute visible pixels.
    let pad = (3.0 * sigma).ceil() + 1.0;
    let x0 = (f64::from(device[0]) - pad).floor().max(-pad);
    let y0 = (f64::from(device[1]) - pad).floor().max(-pad);
    let x1 = (f64::from(device[2]) + pad)
        .ceil()
        .min(f64::from(canvas.0) + pad);
    let y1 = (f64::from(device[3]) + pad)
        .ceil()
        .min(f64::from(canvas.1) + pad);
    if !(x1 > x0 && y1 > y0) {
        return Ok(());
    }
    let (width, height) = ((x1 - x0) as u32, (y1 - y0) as u32);
    *surface_pixels += u64::from(width) * u64::from(height);
    if *surface_pixels > MAX_BLUR_PIXELS {
        bail!("CAPTION_BUDGET_EXCEEDED: paint blur surface");
    }
    let mut sub = FrameBuilder::default();
    let shift = Transform::from_translate(-x0 as f32, -y0 as f32);
    isolated(layer, glyphs, shapes, shift, &mut sub, budget)?;
    let mut pixmap = rasterize_with_media(&sub.finish(), width, height, &mut EmptyMedia)?;
    gaussian_blur_premul_u8(pixmap.data_mut(), width, height, sigma);
    if let Some(coverage) = layer.coverage {
        remap_coverage(pixmap.data_mut(), coverage);
    }
    let id = b.bitmap_id(BitmapData {
        width,
        height,
        rgba: Arc::from(pixmap.data()),
    });
    b.push(DrawOp::DrawBitmap {
        bitmap: id,
        opacity: 1.0,
        tf: tf(Transform::from_translate(x0 as f32, y0 as f32)),
    });
    Ok(())
}

fn isolated(
    layer: &PaintLayer,
    glyphs: &[GlyphPaint],
    shapes: &[Shape],
    shift: Transform,
    b: &mut FrameBuilder,
    budget: &mut Budget,
) -> Result<()> {
    let mut open: Option<([u32; 3], u64)> = None;
    for (g, shape) in glyphs.iter().zip(shapes) {
        let Shape::Outline(path) = shape else {
            continue;
        };
        budget.spend()?;
        let em = em(g, layer.unit);
        let (paint, alpha) = isolated_paint(layer, g, path)?;
        let alpha = if layer.coverage.is_some() { 1.0 } else { alpha };
        let paint = b.paint_id(paint);
        let key = (paint_run_key(layer, g)?.0, alpha.to_bits());
        if open != Some(key) {
            if open.is_some() {
                b.push(DrawOp::PopLayer);
            }
            b.push(DrawOp::PushLayer {
                opacity: alpha as f32,
                blend: motion::effect::BlendMode::Normal,
            });
            open = Some(key);
        }
        let id = b.path_id(path_from_skia(path));
        let transform = shift
            .pre_concat(g.origin)
            .pre_translate((layer.offset[0] * em) as f32, (layer.offset[1] * em) as f32);
        let stroke = |width: f64| DrawOp::StrokePathPaint {
            path: id,
            paint,
            width: (width * em) as f32,
            cap: 1,
            join: 1,
            miter: 4.0,
            tf: tf(transform),
        };
        if layer.stroke_width > 0.0 {
            b.push(stroke(layer.stroke_width));
            continue;
        }
        b.push(DrawOp::FillPathPaint {
            path: id,
            paint,
            even_odd: false,
            tf: tf(transform),
        });
        if layer.spread > 0.0 {
            b.push(stroke(layer.spread * 2.0));
        }
    }
    if open.is_some() {
        b.push(DrawOp::PopLayer);
    }
    Ok(())
}

fn remap_coverage(rgba: &mut [u8], coverage: PaintCoverage) {
    for pixel in rgba.chunks_exact_mut(4) {
        let old = pixel[3];
        if old == 0 {
            continue;
        }
        let alpha = (((f64::from(old) / 255.0 - coverage.lo) / (coverage.hi - coverage.lo))
            .clamp(0.0, 1.0)
            * 255.0)
            .round() as u8;
        for c in &mut pixel[..3] {
            *c = ((u32::from(*c) * u32::from(alpha) + u32::from(old) / 2) / u32::from(old))
                .min(u32::from(alpha)) as u8;
        }
        pixel[3] = alpha;
    }
}
