//! Fixed spatial noise and palette mixing over an explicit local texture domain.
#![allow(clippy::excessive_precision)] // Decimal coefficients define the fixed f32 kernel.
use anyhow::{Result, ensure};
use render_raster::drawop::BitmapData;

fn fract(x: f32) -> f32 {
    x - libm::floorf(x)
}
fn mod289(x: f32) -> f32 {
    x - libm::floorf(x * 0.003460207612) * 289.0
}
fn permute(x: f32) -> f32 {
    mod289((x * 34.0 + 1.0) * x)
}

// The coefficients, support radius and gradient construction are part of v1.
// This is deliberately a specified kernel, not an interchangeable noise source.
fn simplex(v: [f32; 2]) -> f32 {
    let c = [
        0.211324865405187_f32,
        0.366025403784439,
        -0.577350269189626,
        0.024390243902439,
    ];
    let skew = v[0] * c[1] + v[1] * c[1];
    let mut i = [libm::floorf(v[0] + skew), libm::floorf(v[1] + skew)];
    let unskew = i[0] * c[0] + i[1] * c[0];
    let x0 = [v[0] - i[0] + unskew, v[1] - i[1] + unskew];
    let i1 = if x0[0] > x0[1] {
        [1.0, 0.0]
    } else {
        [0.0, 1.0]
    };
    let points = [
        x0,
        [x0[0] + c[0] - i1[0], x0[1] + c[0] - i1[1]],
        [x0[0] + c[2], x0[1] + c[2]],
    ];
    i = i.map(mod289);
    let mut contributions = [0.0; 3];
    for j in 0..3 {
        let p = permute(permute(i[1] + [0.0, i1[1], 1.0][j]) + i[0] + [0.0, i1[0], 1.0][j]);
        let x = fract(p * c[3]) - 1.0;
        let h = x.abs() - 0.5;
        let a = x - libm::floorf(x + 0.5);
        let point = points[j];
        let mut m = (0.4 - (point[0] * point[0] + point[1] * point[1])).max(0.0);
        m *= m;
        m *= m;
        m *= 3.79284291400159 - 0.85373472095314 * (a * a + h * h);
        contributions[j] = m * (a * point[0] + h * point[1]);
    }
    130.0 * (contributions[0] + contributions[1] + contributions[2])
}

/// The fixed v1 spatial noise in [0, 1]; `phase` is already normalized to [0, 289).
pub(super) fn noise(uv: [f32; 2], phase: f32) -> f32 {
    let x = uv.map(|v| (v * 0.4 - 103.15) * 2.3 * 1.35);
    let a = simplex([x[0], x[1] + phase]) + simplex([-x[0], -(x[1] - (phase + 2.6))]);
    let m = (a * 0.5 + 0.5).clamp(0.0, 1.0);
    ((m - 0.5) * 1.5 + 0.5).clamp(0.0, 1.0)
}

/// Converts a validated phase to f32 and wraps it to the kernel period 289.
pub(super) fn normalized_phase(phase: f64) -> f32 {
    let phase = phase as f32;
    phase - libm::floorf(phase / 289.0) * 289.0
}

fn palette_rgb(palette: &BitmapData, u: f64) -> [f32; 3] {
    // Normalized coordinates address texel centers; clamp each bilinear tap.
    let px = u * f64::from(palette.width) - 0.5;
    let py = f64::from(palette.height) * 0.5 - 0.5;
    let x = libm::floor(px) as i64;
    let y = libm::floor(py) as i64;
    let fx = (px - x as f64) as f32;
    let fy = (py - y as f64) as f32;
    let tap = |x: i64, y: i64, channel: usize| {
        let x = x.clamp(0, i64::from(palette.width) - 1) as usize;
        let y = y.clamp(0, i64::from(palette.height) - 1) as usize;
        f32::from(palette.rgba[(y * palette.width as usize + x) * 4 + channel]) / 255.0
    };
    std::array::from_fn(|c| {
        let top = tap(x, y, c) * (1.0 - fx) + tap(x + 1, y, c) * fx;
        let bottom = tap(x, y + 1, c) * (1.0 - fx) + tap(x + 1, y + 1, c) * fx;
        top * (1.0 - fy) + bottom * fy
    })
}

pub(super) fn apply(
    pixels: &mut [u8],
    size: (u32, u32),
    pad: u32,
    domain: [f64; 4],
    phase: f64,
    palette: &BitmapData,
    palette_position: f64,
) -> Result<()> {
    ensure!(
        pixels.len() as u64 == u64::from(size.0) * u64::from(size.1) * 4
            && palette.width > 0
            && palette.height > 0
            && palette.rgba.len() as u64
                == u64::from(palette.width) * u64::from(palette.height) * 4
            && phase.is_finite()
            && (-1_000_000.0..=1_000_000.0).contains(&phase)
            && palette_position.is_finite()
            && (0.0..=1.0).contains(&palette_position)
            && domain
                .iter()
                .all(|v| v.is_finite() && v.abs() <= 1_000_000.0)
            && domain[2] >= 0.001
            && domain[3] >= 0.001,
        "CAPTION_MATERIAL_INVALID: noise palette inputs"
    );
    let palette = palette_rgb(palette, palette_position).map(|v| (v - 0.5) * 2.0 + 0.5);
    let phase = normalized_phase(phase);
    for y in 0..size.1 {
        for x in 0..size.0 {
            let offset = (y as usize * size.0 as usize + x as usize) * 4;
            let rgba = &mut pixels[offset..offset + 4];
            let uv = [
                (f64::from(x) + 0.5 - f64::from(pad) - domain[0]) / domain[2],
                (f64::from(y) + 0.5 - f64::from(pad) - domain[1]) / domain[3],
            ];
            if uv.iter().any(|v| !(0.0..1.0).contains(v)) {
                rgba.fill(0);
                continue;
            }
            if rgba.iter().all(|v| *v == 0) {
                continue;
            }
            let n = noise(uv.map(|v| v as f32), phase);
            let alpha = f32::from(rgba[3]) / 255.0;
            for c in 0..3 {
                let input = f32::from(rgba[c]) / 255.0;
                let result = input * palette[c] * (1.0 - n) + alpha * n;
                rgba[c] = libm::floorf(result.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    fn palette() -> BitmapData {
        BitmapData {
            width: 2,
            height: 1,
            rgba: Arc::from([255, 0, 0, 255, 0, 0, 255, 255]),
        }
    }
    #[test]
    fn palette_sampling_clamps_and_interpolates_associated_components() {
        assert_eq!(palette_rgb(&palette(), 0.0), [1.0, 0.0, 0.0]);
        assert_eq!(palette_rgb(&palette(), 1.0), [0.0, 0.0, 1.0]);
        assert_eq!(palette_rgb(&palette(), 0.5), [0.5, 0.0, 0.5]);
    }
    #[test]
    fn alpha_and_domain_are_explicit_and_seek_does_not_read_history() {
        let input = vec![
            80, 30, 20, 128, 0, 0, 0, 0, 200, 50, 10, 255, 90, 90, 90, 255,
        ];
        let mut a = input.clone();
        apply(
            &mut a,
            (4, 1),
            0,
            [0.0, 0.0, 3.0, 1.0],
            0.3,
            &palette(),
            0.5,
        )
        .unwrap();
        assert_eq!([a[3], a[7], a[11], a[15]], [128, 0, 255, 0]);
        assert_eq!(&a[4..8], &[0; 4]);
        let mut b = input.clone();
        apply(
            &mut b,
            (4, 1),
            0,
            [0.0, 0.0, 3.0, 1.0],
            0.5,
            &palette(),
            0.5,
        )
        .unwrap();
        assert_ne!(a, b);
        let mut again = input;
        apply(
            &mut again,
            (4, 1),
            0,
            [0.0, 0.0, 3.0, 1.0],
            0.3,
            &palette(),
            0.5,
        )
        .unwrap();
        assert_eq!(a, again);
    }
    #[test]
    fn kernel_reference_samples_preserve_the_specified_variant() {
        // Independent double-precision transcription, tolerance for f32 coordinates.
        let samples = [
            ([0.0, 0.0], 0.46875, 0.7026513581003313_f32),
            ([0.25, 0.25], 0.15625, 0.31603945083642293),
            ([0.5, 0.5], 0.3125, 0.17879830568064908),
            ([0.75, 0.75], 0.46875, 0.13529141018503738),
        ];
        for (uv, phase, expected) in samples {
            assert!(
                (noise(uv, phase) - expected).abs() < 0.003,
                "{uv:?} {phase}"
            );
        }
    }
}
