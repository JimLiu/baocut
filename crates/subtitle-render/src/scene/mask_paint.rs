//! Explicit local mask baking. Paint domains remain in global coordinates;
//! only the final matte replay is translated into an integer device viewport.
use super::text_paint::{GlyphPaint, PaintViewport, Shape, em};
use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) struct Window {
    pub origin: [i32; 2],
    pub size: (u32, u32),
}

pub(super) type Windows = BTreeMap<usize, Vec<Option<Window>>>;

/// Preflight every mask before recording any of the node's output operations.
pub(super) fn prepare(
    style: &TextStyle,
    glyphs: &[GlyphPaint],
    shapes: &[Shape],
    canvas: PaintViewport,
    budget: &mut Budget,
) -> Result<Windows> {
    let mut windows = Windows::new();
    let mut work = 0u64;
    let mut pixels = 0usize;
    let mut transfer = 0u64;
    for (index, layer) in style.paints.iter().enumerate() {
        let Some(PaintMask::GlyphFill { rasterization, .. }) = layer.mask else {
            continue;
        };
        if shapes.iter().any(|s| matches!(s, Shape::Bitmap(..))) {
            bail!("CAPTION_SCENE_INVALID: glyph paint mask requires outline glyphs");
        }
        if rasterization == PaintMaskRasterization::Canvas
            && u64::from(canvas.size.0) * u64::from(canvas.size.1) > 16 * 1024 * 1024
        {
            bail!("CAPTION_BUDGET_EXCEEDED: paint mask surface");
        }
        let mut layer_windows = Vec::with_capacity(glyphs.len());
        for (g, shape) in glyphs.iter().zip(shapes) {
            let Shape::Outline(path) = shape else {
                layer_windows.push(None);
                continue;
            };
            let window = if rasterization == PaintMaskRasterization::GlyphBounds {
                support(layer, g, path, canvas)?
            } else {
                Some(Window {
                    origin: canvas.origin,
                    size: canvas.size,
                })
            };
            if let Some(window) = window {
                let area = u64::from(window.size.0) * u64::from(window.size.1);
                if area > 16 * 1024 * 1024 {
                    bail!("CAPTION_BUDGET_EXCEEDED: paint mask surface");
                }
                work = work
                    .checked_add(area.checked_mul(2).ok_or_else(overflow)?)
                    .ok_or_else(overflow)?;
                if rasterization == PaintMaskRasterization::GlyphBounds {
                    // Base, content and matte pixmaps plus the immutable result.
                    pixels = pixels
                        .checked_add(usize::try_from(area)?.checked_mul(4).ok_or_else(overflow)?)
                        .ok_or_else(overflow)?;
                    transfer = transfer
                        .checked_add(area.checked_mul(8).ok_or_else(overflow)?)
                        .ok_or_else(overflow)?;
                }
            }
            layer_windows.push(window);
        }
        if rasterization == PaintMaskRasterization::GlyphBounds {
            windows.insert(index, layer_windows);
        }
    }
    budget.reserve_paint_mask_rasters(work, pixels, transfer)?;
    Ok(windows)
}

fn overflow() -> anyhow::Error {
    anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: paint mask work")
}

/// Content support, never just the mask bounds: an inverted mask may retain
/// every painted pixel outside the original glyph, including a displaced halo.
fn support(
    layer: &PaintLayer,
    g: &GlyphPaint,
    path: &tiny_skia::Path,
    canvas: PaintViewport,
) -> Result<Option<Window>> {
    let unit = em(g, layer.unit);
    // Solid stroked paths may use the default miter join. Four half-widths
    // conservatively bound it; rounded image/spread paths fit inside as well.
    let grow = layer.spread.max(2.0 * layer.stroke_width) * unit;
    let r = path.bounds();
    let dx = layer.offset[0] * unit;
    let dy = layer.offset[1] * unit;
    let mut corners = [
        tiny_skia::Point::from_xy(
            (f64::from(r.left()) - grow + dx) as f32,
            (f64::from(r.top()) - grow + dy) as f32,
        ),
        tiny_skia::Point::from_xy(
            (f64::from(r.right()) + grow + dx) as f32,
            (f64::from(r.top()) - grow + dy) as f32,
        ),
        tiny_skia::Point::from_xy(
            (f64::from(r.left()) - grow + dx) as f32,
            (f64::from(r.bottom()) + grow + dy) as f32,
        ),
        tiny_skia::Point::from_xy(
            (f64::from(r.right()) + grow + dx) as f32,
            (f64::from(r.bottom()) + grow + dy) as f32,
        ),
    ];
    g.origin.map_points(&mut corners);
    let t = g.origin;
    let sigma = layer.blur * unit * f64::from((t.sx * t.sy - t.kx * t.ky).abs()).sqrt();
    if !sigma.is_finite() || corners.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
        bail!("CAPTION_LAYOUT_INVALID: paint mask bounds");
    }
    // Two extra pixels cover path AA and image edge sampling. Gaussian source
    // preparation retains its own full halo before this output-only crop.
    let pad = (3.0 * sigma).ceil() + 2.0;
    let x0 = (corners
        .iter()
        .map(|p| f64::from(p.x))
        .fold(f64::INFINITY, f64::min)
        - pad)
        .floor()
        .max(canvas.min(0));
    let y0 = (corners
        .iter()
        .map(|p| f64::from(p.y))
        .fold(f64::INFINITY, f64::min)
        - pad)
        .floor()
        .max(canvas.min(1));
    let x1 = (corners
        .iter()
        .map(|p| f64::from(p.x))
        .fold(f64::NEG_INFINITY, f64::max)
        + pad)
        .ceil()
        .min(canvas.max(0));
    let y1 = (corners
        .iter()
        .map(|p| f64::from(p.y))
        .fold(f64::NEG_INFINITY, f64::max)
        + pad)
        .ceil()
        .min(canvas.max(1));
    if x1 <= x0 || y1 <= y0 {
        return Ok(None);
    }
    Ok(Some(Window {
        origin: [x0 as i32, y0 as i32],
        size: ((x1 - x0) as u32, (y1 - y0) as u32),
    }))
}

pub(super) fn record(mut frame: FrameOps, window: Window, output: &mut FrameBuilder) -> Result<()> {
    for op in &mut frame.ops {
        let transform = match op {
            DrawOp::FillPath { tf, .. }
            | DrawOp::StrokePath { tf, .. }
            | DrawOp::FillPathPaint { tf, .. }
            | DrawOp::StrokePathPaint { tf, .. }
            | DrawOp::DrawBitmap { tf, .. } => tf,
            DrawOp::PushLayer { .. }
            | DrawOp::PopLayer
            | DrawOp::PushMatte
            | DrawOp::PopMatte { .. } => continue,
            _ => bail!("CAPTION_SCENE_INVALID: unsupported local mask operation"),
        };
        transform[4] -= window.origin[0] as f32;
        transform[5] -= window.origin[1] as f32;
    }
    let image = rasterize_with_media(
        &frame,
        window.size.0,
        window.size.1,
        &mut super::materials::EmptyMedia,
    )?;
    let bitmap = output.bitmap_id(BitmapData {
        width: window.size.0,
        height: window.size.1,
        rgba: Arc::from(image.data()),
    });
    output.push(DrawOp::DrawBitmap {
        bitmap,
        opacity: 1.0,
        tf: [
            1.,
            0.,
            0.,
            1.,
            window.origin[0] as f32,
            window.origin[1] as f32,
        ],
    });
    Ok(())
}
