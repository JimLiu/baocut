//! Explicit image paint domains, lowered to bounded associated RGBA surfaces.
//! The resulting ordinary DrawBitmap has the same CPU/native/WASM/GPU transport.
use super::text_paint::{GlyphPaint, Shape};
use super::*;
use render_raster::effects::filters::gaussian::{MIN_SIGMA, gaussian_blur_premul_u8};
use render_raster::image_pattern::{Filter, Sampler, Wrap, over_base};
use tiny_skia::{FillRule, Paint, Pixmap, Stroke};

pub(super) fn uses_phase(style: &TextStyle) -> bool {
    style
        .paints
        .iter()
        .any(|layer| matches!(layer.paint, ScenePaint::Image { phase: Some(_), .. }))
}

pub(super) fn scalar_map(style: &TextStyle, content: &str, budget: &mut Budget) -> Result<Option<Vec<usize>>> {
    if !uses_phase(style) {
        return Ok(None);
    }
    let count = content.chars().count();
    budget.reserve_image_phase_slots(count)?;
    for _ in 0..count {
        budget.spend()?;
    }
    Ok(Some(content.char_indices().map(|(byte, _)| byte).collect()))
}

pub(super) fn scalar_index(map: &Option<Vec<usize>>, byte: usize) -> Result<usize> {
    match map {
        None => Ok(0),
        Some(map) => map
            .binary_search(&byte)
            .map_err(|_| anyhow::anyhow!("CAPTION_LAYOUT_INVALID: image phase cluster is not a source scalar boundary")),
    }
}

fn glyph_em(g: &GlyphPaint) -> f64 {
    f64::from(f32::from_bits(g.glyph.cache_key.font_size_bits))
}
fn phase_value(phase: ImagePaintPhase, index: usize) -> f64 {
    match phase.arithmetic {
        ImagePhaseArithmetic::IntegerModulo => {
            (index % phase.period as usize) as f64 / f64::from(phase.period)
        }
        ImagePhaseArithmetic::Float32 => {
            let input = index as f32 + phase.index_offset as f32;
            let divided = input / phase.period as f32;
            f64::from(divided - libm::floorf(divided))
        }
    }
}

#[cfg(test)]
mod phase_precision_tests {
    use super::*;
    fn phase(period: u32, arithmetic: ImagePhaseArithmetic, index_offset: f64) -> ImagePaintPhase {
        ImagePaintPhase {
            period,
            source: ImagePaintPhaseSource::CueScalarIndex,
            arithmetic,
            index_offset,
        }
    }
    #[test]
    fn float32_index_rounding_is_distinct_from_modulo_and_static_uv_offset() {
        // Fixed IEEE-754 results independently produced by binary32 packing.
        let cases = [
            (1, 0, 9.999999974752427e-7),
            (1, 3, 9.5367431640625e-7),
            (1, 31, 1.9073486328125e-6),
            (1, 32, 0.),
            (3, 3, 3.5762786865234375e-7),
            (3, 65536, 0.333984375),
            (5, 5, 2.384185791015625e-7),
            (5, 65536, 0.2001953125),
            (5, 131071, 0.19921875),
        ];
        for (period, index, expected) in cases {
            assert_eq!(
                phase_value(phase(period, ImagePhaseArithmetic::Float32, 1e-6), index),
                expected
            );
        }
        assert_eq!(
            phase_value(phase(3, ImagePhaseArithmetic::IntegerModulo, 0.), 65536),
            1. / 3.
        );
        assert_eq!(
            phase_value(phase(5, ImagePhaseArithmetic::IntegerModulo, 0.), 131071),
            0.2
        );
        assert!(phase_value(phase(3, ImagePhaseArithmetic::Float32, -1e-6), 0) > 0.999);
    }
}
fn layer_unit(g: &GlyphPaint, layer: &PaintLayer) -> f64 {
    if layer.unit == PaintUnit::Em { glyph_em(g) } else { 1. }
}

fn domain(space: ImagePaintSpace, g: &GlyphPaint, ink: tiny_skia::Rect, point: [f64; 2]) -> Result<[f64; 2]> {
    let bounds = match space {
        ImagePaintSpace::GlyphEm => {
            let em = glyph_em(g);
            if !em.is_finite() || em <= 0. {
                bail!("CAPTION_LAYOUT_INVALID: image paint font size");
            }
            return Ok([
                (point[0] - f64::from(ink.x() + ink.width() / 2.)) / em,
                (point[1] - f64::from(ink.y() + ink.height() / 2.)) / em,
            ]);
        }
        ImagePaintSpace::GlyphNormalized => Bounds {
            x: f64::from(ink.x()),
            y: f64::from(ink.y()),
            width: f64::from(ink.width()),
            height: f64::from(ink.height()),
        },
        ImagePaintSpace::LineNormalized => Bounds {
            x: g.paint_bounds.x - g.paint_origin.0,
            y: g.paint_bounds.y - g.paint_origin.1,
            ..g.paint_bounds
        },
        ImagePaintSpace::PageNormalized => Bounds {
            x: g.page_bounds.x - g.paint_origin.0,
            y: g.page_bounds.y - g.paint_origin.1,
            ..g.page_bounds
        },
    };
    if bounds.width <= 0. || bounds.height <= 0. {
        bail!("CAPTION_LAYOUT_INVALID: image paint domain bounds");
    }
    Ok([(point[0] - bounds.x) / bounds.width, (point[1] - bounds.y) / bounds.height])
}

enum Base {
    Solid([f64; 4]),
    Linear {
        p0: [f32; 2],
        p1: [f32; 2],
        stops: Vec<GradientStop>,
    },
}
impl Base {
    fn prepare(base: Option<&ScenePaint>, g: &GlyphPaint, path: &tiny_skia::Path) -> Result<Self> {
        let straight = match base {
            None => [0.; 4],
            Some(ScenePaint::NodeFill) => {
                let mut fill = g.fill;
                fill[3] = if g.opacity.clamp(0., 1.) > 0. {
                    (fill[3] / g.opacity.clamp(0., 1.)).clamp(0., 1.)
                } else {
                    0.
                };
                fill
            }
            Some(ScenePaint::Solid { color: c }) => color(c)?,
            Some(paint @ ScenePaint::Linear { .. }) => {
                let bounds = super::text_paint::paint_bounds(paint, g, path);
                let PaintData::Linear { p0, p1, stops } = scene_paint(paint, bounds, g.paint_origin, 1.)? else {
                    unreachable!()
                };
                if stops.is_empty() {
                    bail!("CAPTION_LAYOUT_INVALID: image base gradient");
                }
                let length = tiny_skia::Point::from_xy(p1[0] - p0[0], p1[1] - p0[1]).length();
                if stops.len() == 1 || length <= 1. / 32768. {
                    return Ok(Self::Solid(premultiply(stops.last().unwrap().color.map(f64::from))));
                }
                return Ok(Self::Linear { p0, p1, stops });
            }
            Some(ScenePaint::Image { .. }) => bail!("CAPTION_SCENE_INVALID: recursive image base"),
        };
        Ok(Self::Solid(premultiply(straight)))
    }
    fn sample(&self, point: [f64; 2]) -> [f64; 4] {
        let Self::Linear { p0, p1, stops } = self else {
            let Self::Solid(value) = self else { unreachable!() };
            return *value;
        };
        let dx = f64::from(p1[0] - p0[0]);
        let dy = f64::from(p1[1] - p0[1]);
        let t = (((point[0] - f64::from(p0[0])) * dx + (point[1] - f64::from(p0[1])) * dy) / (dx * dx + dy * dy)).clamp(0., 1.);
        let right = stops.partition_point(|stop| f64::from(stop.offset) <= t);
        let straight = if right == 0 {
            stops[0].color.map(f64::from)
        } else if right == stops.len() {
            stops[right - 1].color.map(f64::from)
        } else {
            let (a, b) = (stops[right - 1], stops[right]);
            let span = f64::from(b.offset - a.offset);
            let fraction = if span > 0. { (t - f64::from(a.offset)) / span } else { 1. };
            std::array::from_fn(|c| f64::from(a.color[c]) * (1. - fraction) + f64::from(b.color[c]) * fraction)
        };
        // The existing gradient contract interpolates straight RGBA, then premultiplies.
        premultiply(straight)
    }
}
fn premultiply(straight: [f64; 4]) -> [f64; 4] {
    let alpha = straight[3].clamp(0., 1.);
    [straight[0] * alpha, straight[1] * alpha, straight[2] * alpha, alpha]
}

pub(super) fn record_layer(
    layer: &PaintLayer,
    glyphs: &[GlyphPaint],
    shapes: &[Shape],
    canvas: (u32, u32),
    images: &BTreeMap<String, BitmapData>,
    builder: &mut FrameBuilder,
    budget: &mut Budget,
) -> Result<()> {
    if layer.spread == 0. && layer.blur == 0. {
        return record_run(layer, glyphs, shapes, canvas, images, builder, budget, None);
    }
    // Effects isolate a continuous common-opacity run before applying that
    // opacity once. Distinct UV maps/phases do not split the silhouette run.
    let mut start = 0;
    while start < glyphs.len() {
        if !matches!(shapes[start], Shape::Outline(_)) {
            start += 1;
            continue;
        }
        let opacity = glyphs[start].opacity.clamp(0., 1.);
        let mut end = start + 1;
        while end < glyphs.len() && (!matches!(shapes[end], Shape::Outline(_)) || glyphs[end].opacity.clamp(0., 1.) == opacity) {
            end += 1;
        }
        if opacity > 0. {
            record_run(
                layer,
                &glyphs[start..end],
                &shapes[start..end],
                canvas,
                images,
                builder,
                budget,
                Some(opacity),
            )?;
        }
        start = end;
    }
    Ok(())
}

fn record_run(
    layer: &PaintLayer,
    glyphs: &[GlyphPaint],
    shapes: &[Shape],
    canvas: (u32, u32),
    images: &BTreeMap<String, BitmapData>,
    builder: &mut FrameBuilder,
    budget: &mut Budget,
    group_opacity: Option<f64>,
) -> Result<()> {
    let ScenePaint::Image {
        resource_id,
        uv_transform,
        space,
        wrap,
        filter,
        opacity,
        composite_opacity,
        base,
        phase,
        phase_offset,
    } = &layer.paint
    else {
        unreachable!()
    };
    let image = images
        .get(resource_id)
        .ok_or_else(|| anyhow::anyhow!("CAPTION_RESOURCE_MISSING: {resource_id}"))?;
    let wrap = match wrap {
        ImagePaintWrap::Clamp => Wrap::Clamp,
        ImagePaintWrap::Repeat => Wrap::Repeat,
        ImagePaintWrap::Mirror => Wrap::Mirror,
    };
    let filter = match filter {
        ImagePaintFilter::Nearest => Filter::Nearest,
        ImagePaintFilter::Bilinear => Filter::Bilinear,
    };
    let sampler = Sampler::from_decoded_premultiplied(&image.rgba, image.width, image.height, wrap, filter)?;
    let mut prepared = Vec::new();
    let mut union: Option<[f64; 4]> = None;
    let mut sigma = 0_f64;
    for (g, shape) in glyphs.iter().zip(shapes) {
        let Shape::Outline(path) = shape else { continue };
        if g.opacity <= 0. {
            continue;
        }
        budget.spend()?;
        let scale = layer_unit(g, layer);
        let transform = g
            .origin
            .pre_translate((layer.offset[0] * scale) as f32, (layer.offset[1] * scale) as f32);
        let Some(inverse) = transform.invert() else {
            bail!("CAPTION_LAYOUT_INVALID: image paint pose inverse")
        };
        let grow = layer.spread.max(layer.stroke_width / 2.) * scale;
        let ink = path.bounds();
        let mut points = [
            tiny_skia::Point::from_xy(ink.left() - grow as f32, ink.top() - grow as f32),
            tiny_skia::Point::from_xy(ink.right() + grow as f32, ink.top() - grow as f32),
            tiny_skia::Point::from_xy(ink.left() - grow as f32, ink.bottom() + grow as f32),
            tiny_skia::Point::from_xy(ink.right() + grow as f32, ink.bottom() + grow as f32),
        ];
        transform.map_points(&mut points);
        if points.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
            bail!("CAPTION_LAYOUT_INVALID: image paint device bounds");
        }
        let bounds = [
            points.iter().map(|p| f64::from(p.x)).fold(f64::INFINITY, f64::min) - 1.,
            points.iter().map(|p| f64::from(p.y)).fold(f64::INFINITY, f64::min) - 1.,
            points.iter().map(|p| f64::from(p.x)).fold(f64::NEG_INFINITY, f64::max) + 1.,
            points.iter().map(|p| f64::from(p.y)).fold(f64::NEG_INFINITY, f64::max) + 1.,
        ];
        let u = union.get_or_insert(bounds);
        *u = [u[0].min(bounds[0]), u[1].min(bounds[1]), u[2].max(bounds[2]), u[3].max(bounds[3])];
        let determinant = f64::from(transform.sx) * f64::from(transform.sy) - f64::from(transform.kx) * f64::from(transform.ky);
        let next_sigma = layer.blur * scale * determinant.abs().sqrt();
        if !next_sigma.is_finite() {
            bail!("CAPTION_LAYOUT_INVALID: image paint blur scale");
        }
        sigma = sigma.max(next_sigma);
        prepared.push((g, path, transform, inverse, bounds, scale));
    }
    let Some(bounds) = union else { return Ok(()) };
    // The shared Gaussian kernel supports sigma <=256 pixels; reject beyond
    // that support instead of silently truncating a requested wider kernel.
    if sigma > 256. {
        bail!("CAPTION_BUDGET_EXCEEDED: image paint blur radius");
    }
    let reach = if sigma >= MIN_SIGMA { (3. * sigma).ceil() + 1. } else { 0. };
    let x0 = (bounds[0] - reach).floor().max(-reach);
    let y0 = (bounds[1] - reach).floor().max(-reach);
    let x1 = (bounds[2] + reach).ceil().min(f64::from(canvas.0) + reach);
    let y1 = (bounds[3] + reach).ceil().min(f64::from(canvas.1) + reach);
    if !(x1 > x0 && y1 > y0) {
        return Ok(());
    }
    if ![x0, y0, x1, y1, sigma].iter().all(|v| v.is_finite()) || x1 - x0 > 65536. || y1 - y0 > 65536. {
        bail!("CAPTION_BUDGET_EXCEEDED: image paint dimensions");
    }
    let width = (x1 - x0) as u32;
    let height = (y1 - y0) as u32;
    let output_pixels = surface_pixels(width, height)?;
    // One live raster surface plus the immutable bitmap copied into FrameOps.
    budget.reserve_image_paint_pixels(
        output_pixels
            .checked_mul(2)
            .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: image paint transfer"))?,
    )?;
    budget.reserve_image_paint_work(output_pixels as u64)?;
    if sigma >= MIN_SIGMA {
        // Reserve the f32 Gaussian row scratch as four RGBA8-equivalent surfaces.
        budget.reserve_image_paint_pixels(
            output_pixels
                .checked_mul(4)
                .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: image paint blur scratch"))?,
        )?;
        let radius = (3. * sigma).ceil() as u64;
        let taps_x = (2 * radius + 1).min(u64::from(width));
        let taps_y = (2 * radius + 1).min(u64::from(height));
        budget.reserve_image_paint_work(output_pixels as u64 * (taps_x + taps_y) * 4)?;
    }
    let mut surface = Pixmap::new(width, height).ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: image paint surface"))?;
    for (g, path, transform, inverse, bounds, scale) in prepared {
        let gx0 = bounds[0].floor().max(x0);
        let gy0 = bounds[1].floor().max(y0);
        let gx1 = bounds[2].ceil().min(x1);
        let gy1 = bounds[3].ceil().min(y1);
        if !(gx1 > gx0 && gy1 > gy0) {
            continue;
        }
        let mw = (gx1 - gx0) as u32;
        let mh = (gy1 - gy0) as u32;
        let mask_pixels = surface_pixels(mw, mh)?;
        budget.reserve_image_paint_pixels(mask_pixels)?;
        // Includes UV/base preparation per covered pixel, up to four image texels
        // and bounded base-gradient stop lookup; charge before scanning the ROI.
        budget.reserve_image_paint_work(mask_pixels as u64 * 32)?;
        let mut mask = Pixmap::new(mw, mh).ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: image paint mask"))?;
        let mut white = Paint::default();
        white.set_color_rgba8(255, 255, 255, 255);
        white.anti_alias = true;
        let shifted = Transform::from_translate(-gx0 as f32, -gy0 as f32).pre_concat(transform);
        let stroke = |width| Stroke {
            width,
            line_cap: tiny_skia::LineCap::Round,
            line_join: tiny_skia::LineJoin::Round,
            ..Stroke::default()
        };
        if layer.stroke_width > 0. {
            mask.stroke_path(path, &white, &stroke((layer.stroke_width * scale) as f32), shifted, None);
        } else {
            mask.fill_path(path, &white, FillRule::Winding, shifted, None);
            if layer.spread > 0. {
                mask.stroke_path(path, &white, &stroke((layer.spread * scale * 2.) as f32), shifted, None);
            }
        }
        let prepared_base = Base::prepare(base.as_deref(), g, path)?;
        let phase = phase
            .as_ref()
            .map_or(0., |p| phase_value(*p, g.source_scalar_index));
        for yy in 0..mh {
            for xx in 0..mw {
                let coverage = f64::from(mask.data()[((yy * mw + xx) * 4 + 3) as usize]) / 255.;
                if coverage == 0. {
                    continue;
                }
                let mut point = tiny_skia::Point::from_xy((gx0 + f64::from(xx) + 0.5) as f32, (gy0 + f64::from(yy) + 0.5) as f32);
                inverse.map_point(&mut point);
                let local = [f64::from(point.x), f64::from(point.y)];
                let coordinate = domain(*space, g, path.bounds(), local)?;
                let m = uv_transform;
                let uv = [
                    m[0] * coordinate[0] + m[2] * coordinate[1] + m[4] + phase + phase_offset,
                    m[1] * coordinate[0] + m[3] * coordinate[1] + m[5],
                ];
                let colour = over_base(
                    sampler.sample(uv)?,
                    prepared_base.sample(local),
                    *opacity,
                    coverage * if group_opacity.is_some() { 1. } else { g.opacity.clamp(0., 1.) * composite_opacity },
                );
                let at = ((((gy0 - y0) as u32 + yy) * width + (gx0 - x0) as u32 + xx) * 4) as usize;
                let dest = &mut surface.data_mut()[at..at + 4];
                let inverse_alpha = 255 - u32::from(colour[3]);
                for c in 0..4 {
                    dest[c] = (u32::from(colour[c]) + (u32::from(dest[c]) * inverse_alpha + 127) / 255).min(255) as u8;
                }
            }
        }
    }
    if sigma >= MIN_SIGMA {
        gaussian_blur_premul_u8(surface.data_mut(), width, height, sigma);
    }
    let bitmap = builder.bitmap_id(BitmapData {
        width,
        height,
        rgba: Arc::from(surface.data()),
    });
    builder.push(DrawOp::DrawBitmap {
        bitmap,
        opacity: group_opacity.map_or(1., |opacity| opacity * composite_opacity) as f32,
        tf: tf(Transform::from_translate(x0 as f32, y0 as f32)),
    });
    Ok(())
}

fn surface_pixels(width: u32, height: u32) -> Result<usize> {
    let count = u64::from(width) * u64::from(height);
    if count > 16 * 1024 * 1024 {
        bail!("CAPTION_BUDGET_EXCEEDED: image paint pixels");
    }
    usize::try_from(count).map_err(|_| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: image paint address space"))
}
