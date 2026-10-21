//! Associated RGBA8 with independent emission components (RGB may exceed alpha).
//! All four UNORM channels use the same opacity and clip coverage. Color is never
//! clamped to alpha; source-over clamps each final component to the UNORM range.
use crate::drawop::{AssociatedBlend, Mat6};
use anyhow::{Result, bail};
use tiny_skia::{Mask, Pixmap, PixmapRef};

/// 有没有颜色分量超过 alpha 的像素。合法的预乘像素（不透明的视频、全零的透明）找不到可以提前收手的地方，
/// 每帧都要整幅扫完：按 64 个像素一块累加、块内不短路，编译器才能把块内的比较向量化（1080p 一幅快五倍多）。
pub fn has_emissive_components(data: &[u8]) -> bool {
    const BLOCK: usize = 64 * 4;
    let mut blocks = data.chunks_exact(BLOCK);
    for block in &mut blocks {
        // 某个分量超过 alpha 时饱和减法非零。
        let excess = block.chunks_exact(4).fold(0u8, |acc, p| {
            acc | p[0].saturating_sub(p[3]) | p[1].saturating_sub(p[3]) | p[2].saturating_sub(p[3])
        });
        if excess != 0 {
            return true;
        }
    }
    blocks
        .remainder()
        .chunks_exact(4)
        .any(|p| p[..3].iter().any(|c| *c > p[3]))
}

/// [`has_emissive_components`]，只看 `width` 像素宽的图里 `(left, top, right, bottom)` 那一块（超出图的部分截掉）。
/// 框外全零的图层（字幕层只在内核给的内容框里有字）不必整幅扫。
pub fn has_emissive_components_within(
    data: &[u8],
    width: usize,
    (left, top, right, bottom): (usize, usize, usize, usize),
) -> bool {
    let height = data.len() / 4 / width.max(1);
    let (right, bottom) = (right.min(width), bottom.min(height));
    left < right
        && (top..bottom).any(|y| {
            has_emissive_components(&data[(y * width + left) * 4..(y * width + right) * 4])
        })
}

/// Affine inverse mapping at destination pixel centers, transparent bilinear
/// sampling, followed by associated source-over. Returns whether pixels changed.
pub fn composite_associated(
    out: &mut Pixmap,
    source: PixmapRef<'_>,
    opacity: f32,
    tf: Mat6,
    clip: Option<&Mask>,
) -> Result<bool> {
    composite_associated_with_blend(out, source, opacity, tf, clip, AssociatedBlend::SourceOver)
}

/// Apply opacity and clip to all source channels, then blend with the current
/// backdrop. Screen computes S + D * (1 - S) and Add computes S + D independently
/// for RGBA; alpha is never used as a multiplier for RGB, including when RGB
/// exceeds alpha.
pub fn composite_associated_with_blend(
    out: &mut Pixmap,
    source: PixmapRef<'_>,
    opacity: f32,
    tf: Mat6,
    clip: Option<&Mask>,
    blend: AssociatedBlend,
) -> Result<bool> {
    if !opacity.is_finite() || tf.iter().any(|v| !v.is_finite()) {
        bail!("EMISSIVE_TRANSFORM_INVALID");
    }
    if clip.is_some_and(|m| m.width() != out.width() || m.height() != out.height()) {
        bail!("EMISSIVE_CLIP_INVALID");
    }
    let opacity = f64::from(opacity.clamp(0.0, 1.0));
    if opacity == 0.0 {
        return Ok(false);
    }
    let [a, b, c, d, tx, ty] = tf.map(f64::from);
    let determinant = a * d - b * c;
    if determinant == 0.0 {
        return Ok(false);
    }
    let inverse = [
        d / determinant,
        -b / determinant,
        -c / determinant,
        a / determinant,
    ];
    if inverse.iter().any(|v| !v.is_finite()) {
        bail!("EMISSIVE_TRANSFORM_INVALID");
    }
    let sw = f64::from(source.width());
    let sh = f64::from(source.height());
    let corners = [
        (-0.5, -0.5),
        (sw + 0.5, -0.5),
        (-0.5, sh + 0.5),
        (sw + 0.5, sh + 0.5),
    ]
    .map(|(x, y)| (a * x + c * y + tx, b * x + d * y + ty));
    let left = corners
        .iter()
        .map(|p| p.0)
        .fold(f64::INFINITY, f64::min)
        .floor()
        .max(0.0)
        .min(f64::from(out.width())) as u32;
    let right = corners
        .iter()
        .map(|p| p.0)
        .fold(f64::NEG_INFINITY, f64::max)
        .ceil()
        .max(0.0)
        .min(f64::from(out.width())) as u32;
    let top = corners
        .iter()
        .map(|p| p.1)
        .fold(f64::INFINITY, f64::min)
        .floor()
        .max(0.0)
        .min(f64::from(out.height())) as u32;
    let bottom = corners
        .iter()
        .map(|p| p.1)
        .fold(f64::NEG_INFINITY, f64::max)
        .ceil()
        .max(0.0)
        .min(f64::from(out.height())) as u32;
    let out_width = out.width() as usize;
    let mut changed = false;
    for y in top..bottom {
        for x in left..right {
            let index = y as usize * out_width + x as usize;
            let coverage = opacity * clip.map_or(1.0, |m| f64::from(m.data()[index]) / 255.0);
            if coverage == 0.0 {
                continue;
            }
            let px = f64::from(x) + 0.5 - tx;
            let py = f64::from(y) + 0.5 - ty;
            let sx = inverse[0] * px + inverse[2] * py - 0.5;
            let sy = inverse[1] * px + inverse[3] * py - 0.5;
            let color = bilinear(source, sx, sy);
            if color.iter().all(|v| *v == 0.0) {
                continue;
            }
            let remaining = 1.0 - color[3] * coverage / 255.0;
            let destination = &mut out.data_mut()[index * 4..index * 4 + 4];
            for channel in 0..4 {
                let factor = match blend {
                    AssociatedBlend::SourceOver => remaining,
                    AssociatedBlend::Screen => 1.0 - color[channel] * coverage / 255.0,
                    AssociatedBlend::Add => 1.0,
                };
                let value = (color[channel] * coverage + f64::from(destination[channel]) * factor)
                    .round()
                    .clamp(0.0, 255.0) as u8;
                changed |= destination[channel] != value;
                destination[channel] = value;
            }
        }
    }
    Ok(changed)
}
fn bilinear(source: PixmapRef<'_>, x: f64, y: f64) -> [f64; 4] {
    if x < -1.0 || y < -1.0 || x > f64::from(source.width()) || y > f64::from(source.height()) {
        return [0.0; 4];
    }
    let left = x.floor() as i64;
    let top = y.floor() as i64;
    let dx = x - left as f64;
    let dy = y - top as f64;
    let mut out = [0.0; 4];
    for (x, y, weight) in [
        (left, top, (1.0 - dx) * (1.0 - dy)),
        (left + 1, top, dx * (1.0 - dy)),
        (left, top + 1, (1.0 - dx) * dy),
        (left + 1, top + 1, dx * dy),
    ] {
        if x < 0 || y < 0 || x >= i64::from(source.width()) || y >= i64::from(source.height()) {
            continue;
        }
        let index = (y as usize * source.width() as usize + x as usize) * 4;
        for channel in 0..4 {
            out[channel] += f64::from(source.data()[index + channel]) * weight;
        }
    }
    out
}
