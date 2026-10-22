//! Independent contour-distance coverage. No legacy glyph AA is multiplied in;
//! the associated original-domain paint is sampled once, then covered once.
use super::image_paint::{Base, CoveredImage};
use super::text_paint::{GlyphPaint, PaintViewport, Shape};
use super::*;
use render_raster::fonts::GlyphKey;
use render_raster::glyph_distance::ContourDistance;
use std::collections::HashMap;

#[derive(Default)]
pub(super) struct DistanceCache(HashMap<(GlyphKey, u64), Arc<ContourDistance>>);
#[derive(Clone)]
struct Band {
    offset: [f64; 2],
    threshold: f64,
    half_width: f64,
    threshold_clamp: Option<[f64; 2]>,
    distance_clamp: Option<[f64; 2]>,
    edge_clamp: Option<[f64; 2]>,
}
enum CoveredPaint<'a> {
    Color(Base),
    Image(CoveredImage<'a>),
}
impl CoveredPaint<'_> {
    fn sample(&self, point: [f64; 2], coverage: f64, opacity: f64) -> Result<[u8; 4]> {
        match self {
            Self::Color(base) => Ok(base
                .sample(point)
                .map(|c| (c * coverage * opacity * 255.).round().clamp(0., 255.) as u8)),
            Self::Image(image) => image.sample(point, coverage * opacity),
        }
    }
}
pub(super) struct PreparedGlyph<'a> {
    contours: Arc<ContourDistance>,
    inverse: [f64; 6],
    bands: Vec<Band>,
    reference: usize,
    aa_scale: f64,
    zero_width: GlyphDistanceZeroWidth,
    rectangle: [i64; 4],
    paint: CoveredPaint<'a>,
    opacity: f64,
}

/// Reserve the complete node's distance layers before recording any DrawOps.
/// All geometric, field, allocation and color-sampling work is bounded here.
pub(super) fn prepare<'a>(
    layer: &PaintLayer,
    glyphs: &'a [GlyphPaint],
    shapes: &'a [Shape],
    canvas: PaintViewport,
    images: &'a BTreeMap<String, BitmapData>,
    cache: &mut DistanceCache,
    budget: &mut Budget,
) -> Result<Vec<PreparedGlyph<'a>>> {
    let spec = layer.distance_coverage.as_ref().expect("distance paint");
    if shapes.iter().any(|s| matches!(s, Shape::Bitmap(..))) {
        bail!("CAPTION_SCENE_INVALID: glyph distance requires outline glyphs");
    }
    if u64::from(canvas.size.0) * u64::from(canvas.size.1) > 16 * 1024 * 1024 {
        bail!("CAPTION_BUDGET_EXCEEDED: glyph distance viewport");
    }
    let GlyphDistanceAa::QuadDerivative {
        source_band,
        scale: aa_scale,
    } = spec.aa;
    let mut output = Vec::new();
    for (g, shape) in glyphs.iter().zip(shapes) {
        let Shape::Outline(path) = shape else {
            continue;
        };
        budget.spend()?;
        if g.opacity <= 0.0 {
            continue;
        }
        let m = g.origin;
        let determinant = f64::from(m.sx) * f64::from(m.sy) - f64::from(m.kx) * f64::from(m.ky);
        if determinant == 0.0 {
            continue;
        }
        let inverse = inverse(m, determinant)?;
        let norm = libm::sqrt(
            [m.sx, m.ky, m.kx, m.sy]
                .into_iter()
                .map(|v| f64::from(v).powi(2))
                .sum(),
        );
        if !norm.is_finite() || norm <= 0.0 {
            bail!("CAPTION_LAYOUT_INVALID: glyph distance transform");
        }
        let unit = if layer.unit == PaintUnit::Em {
            f64::from(f32::from_bits(g.glyph.cache_key.font_size_bits))
        } else {
            1.0
        };
        if !unit.is_finite() || unit <= 0.0 {
            bail!("CAPTION_LAYOUT_INVALID: glyph distance unit");
        }
        let bands: Vec<_> = spec
            .bands
            .iter()
            .map(|band| Band {
                offset: band.offset.map(|v| v * unit),
                threshold: band.threshold * unit,
                half_width: band.half_width * unit,
                threshold_clamp: band.threshold_clamp.map(|v| v.map(|n| n * unit)),
                distance_clamp: band.distance_clamp.map(|v| v.map(|n| n * unit)),
                edge_clamp: band.edge_clamp.map(|v| v.map(|n| n * unit)),
            })
            .collect();
        // The signed contour distance is 1-Lipschitz. These inverse-column
        // lengths bound each one-pixel finite difference, independently of ROI.
        let aa_bound =
            aa_scale * (libm::hypot(inverse[0], inverse[1]) + libm::hypot(inverse[2], inverse[3]));
        let ink = path.bounds();
        let mut bounds = [
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
            f64::INFINITY,
            f64::INFINITY,
        ];
        for band in &bands {
            let center = bounded(band.threshold, band.threshold_clamp);
            let lower = bounded(center - band.half_width - aa_bound, band.edge_clamp);
            // A saturated field may remain covered arbitrarily far outside.
            // That band cannot narrow the viewport's conservative support.
            if band.distance_clamp.is_some_and(|range| lower <= range[0]) {
                continue;
            }
            let grow = (-lower).max(0.0);
            let local = [
                f64::from(ink.left()) + band.offset[0] - grow,
                f64::from(ink.top()) + band.offset[1] - grow,
                f64::from(ink.right()) + band.offset[0] + grow,
                f64::from(ink.bottom()) + band.offset[1] + grow,
            ];
            let r = transformed_bounds(m, local)?;
            bounds = [
                bounds[0].max(r[0]),
                bounds[1].max(r[1]),
                bounds[2].min(r[2]),
                bounds[3].min(r[3]),
            ];
        }
        // One extra device pixel covers the fixed flattening error and keeps
        // both lanes of every global 2x2 derivative quad available at an edge.
        let rectangle = [
            (bounds[0] - 1.0).floor().max(canvas.min(0)),
            (bounds[1] - 1.0).floor().max(canvas.min(1)),
            (bounds[2] + 1.0).ceil().min(canvas.max(0)),
            (bounds[3] + 1.0).ceil().min(canvas.max(1)),
        ];
        if !rectangle.iter().all(|v| v.is_finite()) {
            bail!("CAPTION_LAYOUT_INVALID: glyph distance bounds");
        }
        if rectangle[2] <= rectangle[0] || rectangle[3] <= rectangle[1] {
            continue;
        }
        let rectangle = rectangle.map(|v| v as i64);
        let width = rectangle[2] - rectangle[0];
        let height = rectangle[3] - rectangle[1];
        let pixels = u64::try_from(width)?
            .checked_mul(u64::try_from(height)?)
            .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: glyph distance pixels"))?;
        if pixels > 16 * 1024 * 1024 {
            bail!("CAPTION_BUDGET_EXCEEDED: glyph distance surface");
        }
        let tolerance = ((1.0 / 64.0) / norm).min(256.0);
        let key = (g.glyph.cache_key, tolerance.to_bits());
        let contours = if let Some(value) = cache.0.get(&key) {
            value.clone()
        } else {
            let value = Arc::new(ContourDistance::from_path(path, tolerance)?);
            // Segment storage stays live until this node's preparations finish.
            budget.reserve_image_paint_pixels(value.storage_bytes().div_ceil(4))?;
            cache.0.insert(key, value.clone());
            value
        };
        if contours.is_empty() {
            continue;
        }
        let qx = (rectangle[2] - 1).div_euclid(2) - rectangle[0].div_euclid(2) + 1;
        let qy = (rectangle[3] - 1).div_euclid(2) - rectangle[1].div_euclid(2) + 1;
        let samples = u64::try_from(qx)?
            .checked_mul(u64::try_from(qy)?)
            .and_then(|n| n.checked_mul(4 * bands.len() as u64))
            .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: glyph distance samples"))?;
        let work = samples
            .checked_mul(contours.segment_count() as u64)
            .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: glyph distance work"))?;
        budget.reserve_glyph_distance_work(work)?;
        budget.reserve_image_paint_pixels(usize::try_from(pixels.checked_mul(2).ok_or_else(
            || anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: glyph distance transfer"),
        )?)?)?;
        budget.reserve_image_paint_work(pixels.checked_mul(32).ok_or_else(|| {
            anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: glyph distance color work")
        })?)?;
        output.push(PreparedGlyph {
            contours,
            inverse,
            bands,
            reference: source_band,
            aa_scale,
            zero_width: spec.zero_width,
            rectangle,
            paint: if matches!(layer.paint, ScenePaint::Image { .. }) {
                CoveredPaint::Image(CoveredImage::prepare(&layer.paint, g, path, images)?)
            } else {
                CoveredPaint::Color(Base::prepare(Some(&layer.paint), g, path)?)
            },
            opacity: g.opacity.clamp(0.0, 1.0),
        });
    }
    Ok(output)
}

pub(super) fn record(prepared: Vec<PreparedGlyph<'_>>, builder: &mut FrameBuilder) -> Result<()> {
    for glyph in prepared {
        let [x0, y0, x1, y1] = glyph.rectangle;
        let (width, height) = ((x1 - x0) as u32, (y1 - y0) as u32);
        let mut rgba = vec![0_u8; width as usize * height as usize * 4];
        for qy in (y0.div_euclid(2) * 2..y1).step_by(2) {
            for qx in (x0.div_euclid(2) * 2..x1).step_by(2) {
                let mut values = [[0.0; 4]; 2];
                let mut points = [[0.0; 2]; 4];
                for lane in 0..4 {
                    let point = local(
                        glyph.inverse,
                        [
                            qx as f64 + (lane % 2) as f64 + 0.5,
                            qy as f64 + (lane / 2) as f64 + 0.5,
                        ],
                    );
                    points[lane] = point;
                    for (index, band) in glyph.bands.iter().enumerate() {
                        values[index][lane] = bounded(
                            glyph
                                .contours
                                .sample([point[0] - band.offset[0], point[1] - band.offset[1]])?,
                            band.distance_clamp,
                        );
                    }
                }
                for lane in 0..4 {
                    let (x, y) = (qx + (lane % 2) as i64, qy + (lane / 2) as i64);
                    if x < x0 || y < y0 || x >= x1 || y >= y1 {
                        continue;
                    }
                    let reference = values[glyph.reference];
                    let row = (lane / 2) * 2;
                    let column = lane % 2;
                    let aa = glyph.aa_scale
                        * ((reference[row + 1] - reference[row]).abs()
                            + (reference[column + 2] - reference[column]).abs());
                    if !aa.is_finite() {
                        bail!("CAPTION_LAYOUT_INVALID: glyph distance derivative");
                    }
                    let mut coverage = 1.0;
                    for (index, band) in glyph.bands.iter().enumerate() {
                        let center = bounded(band.threshold, band.threshold_clamp);
                        let half = band.half_width + aa;
                        coverage *= linear_step(
                            bounded(center - half, band.edge_clamp),
                            bounded(center + half, band.edge_clamp),
                            values[index][lane],
                            glyph.zero_width,
                        )?;
                    }
                    if coverage == 0.0 {
                        continue;
                    }
                    let color = glyph.paint.sample(points[lane], coverage, glyph.opacity)?;
                    let at = (((y - y0) as u32 * width + (x - x0) as u32) * 4) as usize;
                    rgba[at..at + 4].copy_from_slice(&color);
                }
            }
        }
        let bitmap = builder.bitmap_id(BitmapData {
            width,
            height,
            rgba: Arc::from(rgba),
        });
        builder.push(DrawOp::DrawBitmap {
            bitmap,
            opacity: 1.0,
            tf: tf(Transform::from_translate(x0 as f32, y0 as f32)),
        });
    }
    Ok(())
}
fn bounded(value: f64, range: Option<[f64; 2]>) -> f64 {
    range.map_or(value, |r| value.clamp(r[0], r[1]))
}
fn linear_step(low: f64, high: f64, value: f64, policy: GlyphDistanceZeroWidth) -> Result<f64> {
    if ![low, high, value].iter().all(|v| v.is_finite()) || high < low {
        bail!("CAPTION_LAYOUT_INVALID: glyph distance band");
    }
    if high == low {
        return match policy {
            GlyphDistanceZeroWidth::Error => {
                bail!("CAPTION_LAYOUT_INVALID: zero-width glyph distance band")
            }
            GlyphDistanceZeroWidth::StepInclusive => Ok(if value >= low { 1.0 } else { 0.0 }),
        };
    }
    let result = (value - low) / (high - low);
    if !result.is_finite() {
        bail!("CAPTION_LAYOUT_INVALID: glyph distance band overflow");
    }
    Ok(result.clamp(0.0, 1.0))
}
fn inverse(m: Transform, determinant: f64) -> Result<[f64; 6]> {
    let (a, b, c, d) = (
        f64::from(m.sy) / determinant,
        -f64::from(m.ky) / determinant,
        -f64::from(m.kx) / determinant,
        f64::from(m.sx) / determinant,
    );
    let inverse = [
        a,
        b,
        c,
        d,
        -a * f64::from(m.tx) - c * f64::from(m.ty),
        -b * f64::from(m.tx) - d * f64::from(m.ty),
    ];
    if !inverse.iter().all(|v| v.is_finite()) {
        bail!("CAPTION_LAYOUT_INVALID: glyph distance inverse");
    }
    Ok(inverse)
}
fn local(m: [f64; 6], p: [f64; 2]) -> [f64; 2] {
    [
        m[0] * p[0] + m[2] * p[1] + m[4],
        m[1] * p[0] + m[3] * p[1] + m[5],
    ]
}
fn transformed_bounds(m: Transform, r: [f64; 4]) -> Result<[f64; 4]> {
    let mut result = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for p in [[r[0], r[1]], [r[0], r[3]], [r[2], r[1]], [r[2], r[3]]] {
        let q = local(
            [
                f64::from(m.sx),
                f64::from(m.ky),
                f64::from(m.kx),
                f64::from(m.sy),
                f64::from(m.tx),
                f64::from(m.ty),
            ],
            p,
        );
        result = [
            result[0].min(q[0]),
            result[1].min(q[1]),
            result[2].max(q[0]),
            result[3].max(q[1]),
        ];
    }
    if !result.iter().all(|v| v.is_finite()) {
        bail!("CAPTION_LAYOUT_INVALID: glyph distance transformed bounds");
    }
    Ok(result)
}
