//! Noise UV displacement (`caption-noise-displace/1`): the fixed v1 noise field of
//! `noise_palette` drives one scalar offset applied to both normalized UV axes.
use anyhow::{Result, ensure};
use tiny_skia::Pixmap;

/// Resolved uniforms; ranges are checked by validation and again here.
pub(super) struct NoiseDisplace {
    /// Canvas-space domain `[x, y, width, height]` in output pixels.
    pub(super) domain: [f64; 4],
    pub(super) noise_scale: [f64; 2],
    pub(super) phase: f64,
    pub(super) brightness: f64,
    pub(super) contrast: f64,
    pub(super) strength: f64,
}

/// Per destination pixel center inside the domain:
/// `n = (noise(uv*noiseScale, phase) + brightness - 0.5) * contrast * 10 + 0.5`,
/// `d = (n - 0.5) * strength * width/height`, `uv' = uv + (d, d)`, then one
/// premultiplied bilinear sample of the input with transparent texels outside the
/// surface. Pixels outside the domain become transparent.
pub(super) fn apply(source: &Pixmap, pad: u32, u: &NoiseDisplace) -> Result<Pixmap> {
    ensure!(
        u.domain
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 1_000_000.0)
            && u.domain[2] >= 0.001
            && u.domain[3] >= 0.001
            && u.noise_scale
                .iter()
                .all(|v| v.is_finite() && (0.001..=1000.0).contains(v))
            && u.phase.is_finite()
            && (-1_000_000.0..=1_000_000.0).contains(&u.phase)
            && (-16.0..=16.0).contains(&u.brightness)
            && (0.0..=1000.0).contains(&u.contrast)
            && (-16.0..=16.0).contains(&u.strength),
        "CAPTION_MATERIAL_INVALID: noise displacement uniforms"
    );
    let (width, height) = (source.width(), source.height());
    let mut out = Pixmap::new(width, height)
        .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: noise displacement surface"))?;
    let [dx, dy, dw, dh] = u.domain;
    let aspect = dw / dh;
    let phase = super::noise_palette::normalized_phase(u.phase);
    let origin = f64::from(pad);
    for y in 0..height {
        for x in 0..width {
            let uv = [
                (f64::from(x) + 0.5 - origin - dx) / dw,
                (f64::from(y) + 0.5 - origin - dy) / dh,
            ];
            if uv.iter().any(|v| !(0.0..1.0).contains(v)) {
                continue;
            }
            let field = super::noise_palette::noise(
                [
                    (uv[0] * u.noise_scale[0]) as f32,
                    (uv[1] * u.noise_scale[1]) as f32,
                ],
                phase,
            );
            let n = (f64::from(field) + u.brightness - 0.5) * u.contrast * 10.0 + 0.5;
            let d = (n - 0.5) * u.strength * aspect;
            // Back to texel-center coordinates: zero displacement is the identity.
            let sx = origin + dx + (uv[0] + d) * dw - 0.5;
            let sy = origin + dy + (uv[1] + d) * dh - 0.5;
            ensure!(
                sx.is_finite() && sy.is_finite(),
                "CAPTION_MATERIAL_INVALID: noise displacement coordinate"
            );
            let color = super::materials::bilinear_transparent(source, sx, sy);
            let index = (y as usize * width as usize + x as usize) * 4;
            out.data_mut()[index..index + 4].copy_from_slice(&color);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source() -> Pixmap {
        let mut pixmap = Pixmap::new(12, 8).unwrap();
        for (i, px) in pixmap.data_mut().chunks_exact_mut(4).enumerate() {
            let a = (i * 37 % 256) as u8;
            px.copy_from_slice(&[a / 2, a / 3, a / 4, a]);
        }
        pixmap
    }
    fn uniforms(strength: f64, contrast: f64, brightness: f64) -> NoiseDisplace {
        NoiseDisplace {
            domain: [1.0, 1.0, 10.0, 5.0],
            noise_scale: [3.0, 2.0],
            phase: 4.5,
            brightness,
            contrast,
            strength,
        }
    }

    #[test]
    fn zero_strength_is_identity_inside_and_transparent_outside_the_domain() {
        let src = source();
        let out = apply(&src, 0, &uniforms(0.0, 1.6, 0.0)).unwrap();
        for y in 0..8u32 {
            for x in 0..12u32 {
                let i = (y as usize * 12 + x as usize) * 4;
                let inside = (1..11).contains(&x) && (1..6).contains(&y);
                let expected = if inside {
                    &src.data()[i..i + 4]
                } else {
                    &[0u8; 4][..]
                };
                assert_eq!(&out.data()[i..i + 4], expected, "{x},{y}");
            }
        }
        // contrast 0 gives n = 0.5 and therefore no displacement as well.
        assert_eq!(
            apply(&src, 0, &uniforms(0.7, 0.0, 0.3)).unwrap().data(),
            out.data()
        );
    }

    #[test]
    fn displacement_follows_the_documented_formula_on_both_axes() {
        let src = source();
        let u = uniforms(0.05, 0.016, 0.1);
        let out = apply(&src, 0, &u).unwrap();
        let phase = crate::scene::noise_palette::normalized_phase(u.phase);
        let (x, y) = (5u32, 3u32);
        let uv = [(5.5 - 1.0) / 10.0, (3.5 - 1.0) / 5.0];
        let field =
            crate::scene::noise_palette::noise([(uv[0] * 3.0) as f32, (uv[1] * 2.0) as f32], phase);
        let n = (f64::from(field) + 0.1 - 0.5) * 0.016 * 10.0 + 0.5;
        let d = (n - 0.5) * 0.05 * 2.0;
        let expected = crate::scene::materials::bilinear_transparent(
            &src,
            1.0 + (uv[0] + d) * 10.0 - 0.5,
            1.0 + (uv[1] + d) * 5.0 - 0.5,
        );
        let i = (y as usize * 12 + x as usize) * 4;
        assert_eq!(out.data()[i..i + 4], expected);
        assert_ne!(d, 0.0);
        // Padding shifts the surface without changing the displaced content.
        let mut padded = Pixmap::new(16, 12).unwrap();
        for row in 0..8usize {
            let to = ((row + 2) * 16 + 2) * 4;
            padded.data_mut()[to..to + 48].copy_from_slice(&src.data()[row * 48..row * 48 + 48]);
        }
        let shifted = apply(&padded, 2, &u).unwrap();
        for row in 0..8usize {
            let from = ((row + 2) * 16 + 2) * 4;
            assert_eq!(
                &shifted.data()[from..from + 48],
                &out.data()[row * 48..row * 48 + 48]
            );
        }
    }

    #[test]
    fn large_offsets_sample_transparent_texels_and_invalid_uniforms_fail() {
        let src = source();
        let out = apply(&src, 0, &uniforms(16.0, 1000.0, 16.0)).unwrap();
        assert!(
            out.data().iter().all(|v| *v == 0),
            "everything lands outside the surface"
        );
        let mut bad = uniforms(0.1, 1.0, 0.0);
        bad.contrast = -1.0;
        assert!(apply(&src, 0, &bad).is_err());
        let mut bad = uniforms(0.1, 1.0, 0.0);
        bad.domain[3] = 0.0;
        assert!(apply(&src, 0, &bad).is_err());
    }
}
