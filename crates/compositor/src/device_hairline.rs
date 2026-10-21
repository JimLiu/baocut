//! CPU-compatible device hairlines prepared as bounded, painted glyph tiles.
//! Hairlines composite each flattened segment independently. Retaining only the
//! final white coverage and tinting later loses paint alpha and byte rounding.
use anyhow::{Result, ensure};
use render_raster::drawop::{DrawOp, Mat6};

/// Match tiny-skia's anti-aliased device hairline classification. Translation
/// does not affect width; path coordinates are nevertheless transformed with
/// the complete matrix before a tile origin is subtracted.
pub(crate) fn coverage(width: f32, tf: Mat6) -> Result<Option<f32>> {
    ensure!(width.is_finite() && width >= 0.0, "gpu-draw-stroke-invalid");
    ensure!(tf.iter().all(|v| v.is_finite()), "gpu-draw-stroke-transform-invalid");
    if width == 0.0 {
        return Ok(Some(1.0));
    }
    let mut ts = tiny_skia::Transform::from_row(tf[0], tf[1], tf[2], tf[3], 0.0, 0.0);
    // Keep the CPU implementation's map_points arithmetic, including its fast
    // paths for translation, scaling and skew.
    ts.tx = 0.0;
    ts.ty = 0.0;
    let mut points = [tiny_skia::Point::from_xy(width, 0.0), tiny_skia::Point::from_xy(0.0, width)];
    ts.map_points(&mut points);
    let length = |p: tiny_skia::Point| p.x.abs().max(p.y.abs()) + p.x.abs().min(p.y.abs()) * 0.5;
    let a = length(points[0]);
    let b = length(points[1]);
    Ok((a <= 1.0 && b <= 1.0).then_some((a + b) * 0.5))
}

pub(crate) fn is_hairline(op: &DrawOp) -> Result<bool> {
    match op {
        DrawOp::StrokePath { width, tf, .. } | DrawOp::StrokePathPaint { width, tf, .. } => Ok(coverage(*width, *tf)?.is_some()),
        _ => Ok(false),
    }
}
