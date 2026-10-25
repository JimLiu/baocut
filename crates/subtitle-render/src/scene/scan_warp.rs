//! Scan warp (`caption-scan-warp/1`): one resampling of a page domain that combines
//! an evolving two-field noise warp, a scanning stripe that stretches the content
//! sideways, and a scanline brightness ripple.
use anyhow::{Result, ensure};
use caption_scene::{GradientSmearNoise, MaterialUvY, ScanWarpSide};
use tiny_skia::Pixmap;

/// Resolved uniforms; ranges are checked by validation and again here.
pub(super) struct ScanWarp {
    /// Canvas-space domain `[x, y, width, height]` in output pixels.
    pub(super) domain: [f64; 4],
    pub(super) uv_y: MaterialUvY,
    pub(super) scale: f64,
    pub(super) complexity: f64,
    pub(super) sub_impact: f64,
    pub(super) sub_scale: f64,
    pub(super) evolution: f64,
    pub(super) offset: [f64; 2],
    pub(super) strength: [f64; 2],
    pub(super) swap_axes: bool,
    pub(super) stripe: Stripe,
    pub(super) scanlines: Scanlines,
    pub(super) gain: f64,
}

pub(super) struct Stripe {
    pub(super) center: f64,
    pub(super) core_half_height: f64,
    pub(super) falloff: f64,
    pub(super) gate: f64,
    pub(super) amount: f64,
    pub(super) side: ScanWarpSide,
}

pub(super) struct Scanlines {
    pub(super) amount: f64,
    pub(super) pitch: f64,
    pub(super) phase: f64,
}

/// Work units charged per domain pixel: two noise fields over every octave plus the tap.
pub(super) fn pixel_cost(complexity: f64) -> u64 {
    16 + 16 * (libm::ceil(complexity) as u64 + 1)
}

fn smooth_step(edge0: f64, edge1: f64, x: f64) -> f64 {
    if edge1 <= edge0 {
        return if x >= edge1 { 1.0 } else { 0.0 };
    }
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Sideways shift of the sample point for material coordinate `m` (x across the domain
/// width, y as a fraction of the height): `amount * band^6 * gate * (2x - 1)`.
/// `band` falls linearly from one at the core to zero `falloff` pixels away from it, and
/// `gate` keeps only the chosen side of the band centre.
fn stripe_shift(m: [f64; 2], stripe: &Stripe, height: f64) -> f64 {
    if stripe.amount == 0.0 || stripe.falloff <= 0.0 {
        return 0.0;
    }
    let core = stripe.core_half_height / height;
    let reach = stripe.falloff / height;
    let gate = stripe.gate / height;
    let (center, y) = (stripe.center, m[1]);
    let distance = (center - core - y).max(0.0).max(y - (center + core));
    let band = (1.0 - distance / reach).clamp(0.0, 1.0);
    let side = match stripe.side {
        ScanWarpSide::Above => smooth_step(center - gate, center, y),
        ScanWarpSide::Below => 1.0 - smooth_step(center, center + gate, y),
    };
    stripe.amount * libm::pow(band, 6.0) * side * (2.0 * m[0] - 1.0)
}

/// Per destination pixel center inside the domain, with material coordinates `m`
/// (`m.y` flipped for `uvY: up`) and aspect `a = width / height`:
/// two noise samples at `p = (m.x * a * scale - offset.x, m.y * scale - offset.y)` give
/// `n = 2 * field - 1` for seeds 1 and 3; the sample point becomes
/// `(m.x + n.x * strength.x - stripeShift, m.y + n.y * strength.y)` and is read with one
/// premultiplied bilinear tap (transparent outside the surface). Premultiplied RGB is
/// then multiplied by `gain * (1 - amount * sin(pitch * m.y * height - phase))` and capped
/// at alpha. Pixels outside the domain become transparent.
pub(super) fn apply(
    source: &Pixmap,
    pad: u32,
    u: &ScanWarp,
    mut spend: impl FnMut(u64) -> Result<()>,
) -> Result<Pixmap> {
    let finite = |values: &[f64]| values.iter().all(|v| v.is_finite());
    ensure!(
        u.domain
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 1_000_000.0)
            && u.domain[2] >= 0.001
            && u.domain[3] >= 0.001
            && (0.001..=1000.0).contains(&u.scale)
            && (1.0..=10.0).contains(&u.complexity)
            && (0.0..=1.0).contains(&u.sub_impact)
            && (1.0..=10_000.0).contains(&u.sub_scale)
            && (-100_000.0..=100_000.0).contains(&u.evolution)
            && u.offset
                .iter()
                .all(|v| (-100_000.0..=100_000.0).contains(v))
            && u.strength.iter().all(|v| (-4.0..=4.0).contains(v))
            && (-4.0..=4.0).contains(&u.stripe.center)
            && [u.stripe.core_half_height, u.stripe.falloff, u.stripe.gate,]
                .iter()
                .all(|v| (0.0..=1_000_000.0).contains(v))
            && (-1.0..=1.0).contains(&u.stripe.amount)
            && (-1.0..=1.0).contains(&u.scanlines.amount)
            && (0.0..=1000.0).contains(&u.scanlines.pitch)
            && (-1_000_000.0..=1_000_000.0).contains(&u.scanlines.phase)
            && (0.0..=4.0).contains(&u.gain)
            && finite(&[
                u.scale,
                u.complexity,
                u.sub_impact,
                u.sub_scale,
                u.evolution
            ])
            && finite(&u.offset)
            && finite(&u.strength)
            && finite(&[
                u.stripe.center,
                u.stripe.core_half_height,
                u.stripe.falloff,
                u.stripe.gate,
                u.stripe.amount,
                u.scanlines.amount,
                u.scanlines.pitch,
                u.scanlines.phase,
                u.gain,
            ]),
        "CAPTION_MATERIAL_INVALID: scan warp uniforms"
    );
    let (width, height) = (source.width(), source.height());
    let mut out = Pixmap::new(width, height)
        .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: scan warp surface"))?;
    let [dx, dy, dw, dh] = u.domain;
    let aspect = dw / dh;
    let origin = f64::from(pad);
    let cost = pixel_cost(u.complexity);
    let warped = u.strength.iter().any(|s| *s != 0.0);
    let noise = GradientSmearNoise {
        complexity: u.complexity,
        cycle: 0.0,
        brightness: 0.0,
        range: 0.0,
        scale1: [1.0, 1.0],
        scale2: [1.0, 1.0],
        offset: [0.0, 0.0],
        rotation: 0.0,
        sub_impact: u.sub_impact,
        sub_scale: u.sub_scale,
        sub_rotation: 0.0,
        sub_offset: [0.0, 0.0],
    };
    // A rect scale of two makes the lattice coordinate equal to the noise-space point.
    let field = super::gradient_smear::Uniforms {
        rect_scale: [2.0, 2.0],
        evolution: u.evolution as f32,
        seed: 0.0,
        stretch: 0.0,
        progress: 0.0,
        strength: [0.0, 0.0],
    };
    let flip = u.uv_y == MaterialUvY::Up;
    for y in 0..height {
        for x in 0..width {
            let uv = [
                (f64::from(x) + 0.5 - origin - dx) / dw,
                (f64::from(y) + 0.5 - origin - dy) / dh,
            ];
            if uv.iter().any(|v| !(0.0..1.0).contains(v)) {
                continue;
            }
            spend(cost)?;
            let m = [uv[0], if flip { 1.0 - uv[1] } else { uv[1] }];
            let mut shift = [0.0, 0.0];
            if warped {
                let p = [
                    (m[0] * aspect * u.scale - u.offset[0]) as f32,
                    (m[1] * u.scale - u.offset[1]) as f32,
                ];
                let a = (f64::from(super::gradient_smear::gradient(p, &field, &noise, 1.0)) - 0.5)
                    * 2.0;
                let b = (f64::from(super::gradient_smear::gradient(p, &field, &noise, 3.0)) - 0.5)
                    * 2.0;
                let n = if u.swap_axes { [b, a] } else { [a, b] };
                shift = [n[0] * u.strength[0], n[1] * u.strength[1]];
            }
            let sample = [
                m[0] + shift[0] - stripe_shift(m, &u.stripe, dh),
                m[1] + shift[1],
            ];
            let row = if flip { 1.0 - sample[1] } else { sample[1] };
            // Back to texel-center coordinates: zero displacement is the identity.
            let sx = origin + dx + sample[0] * dw - 0.5;
            let sy = origin + dy + row * dh - 0.5;
            ensure!(
                sx.is_finite() && sy.is_finite(),
                "CAPTION_MATERIAL_INVALID: scan warp coordinate"
            );
            let mut color = super::materials::bilinear_transparent(source, sx, sy);
            let ripple = 1.0
                - u.scanlines.amount * libm::sin(u.scanlines.pitch * m[1] * dh - u.scanlines.phase);
            let factor = u.gain * ripple;
            if factor != 1.0 {
                for channel in 0..3 {
                    let value = libm::floor(f64::from(color[channel]) * factor + 0.5);
                    color[channel] = value.clamp(0.0, f64::from(color[3])) as u8;
                }
            }
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
        let mut pixmap = Pixmap::new(16, 12).unwrap();
        for (i, px) in pixmap.data_mut().chunks_exact_mut(4).enumerate() {
            let a = (i * 37 % 200 + 56) as u8;
            px.copy_from_slice(&[a / 2, a / 3, a / 4, a]);
        }
        pixmap
    }

    fn quiet() -> ScanWarp {
        ScanWarp {
            domain: [2.0, 1.0, 12.0, 10.0],
            uv_y: MaterialUvY::Down,
            scale: 0.25,
            complexity: 3.0,
            sub_impact: 0.85,
            sub_scale: 40.0,
            evolution: 1.5,
            offset: [0.4, 0.1],
            strength: [0.0, 0.0],
            swap_axes: false,
            stripe: Stripe {
                center: 0.5,
                core_half_height: 0.5,
                falloff: 3.0,
                gate: 0.0,
                amount: 0.0,
                side: ScanWarpSide::Above,
            },
            scanlines: Scanlines {
                amount: 0.0,
                pitch: 2.5,
                phase: 0.0,
            },
            gain: 1.0,
        }
    }

    fn run(u: &ScanWarp) -> Pixmap {
        apply(&source(), 0, u, |_| Ok(())).unwrap()
    }

    fn pixel(map: &Pixmap, x: usize, y: usize) -> [u8; 4] {
        let i = (y * map.width() as usize + x) * 4;
        map.data()[i..i + 4].try_into().unwrap()
    }

    #[test]
    fn neutral_uniforms_copy_the_domain_and_clear_the_rest() {
        let src = source();
        let out = run(&quiet());
        for y in 0..12usize {
            for x in 0..16usize {
                let inside = (2..14).contains(&x) && (1..11).contains(&y);
                let expected = if inside { pixel(&src, x, y) } else { [0; 4] };
                assert_eq!(pixel(&out, x, y), expected, "{x},{y}");
            }
        }
    }

    #[test]
    fn padding_shifts_the_surface_without_changing_the_content() {
        let mut u = quiet();
        u.strength = [0.05, 0.04];
        u.stripe.amount = 0.3;
        u.scanlines.amount = 0.05;
        let plain = run(&u);
        let src = source();
        let mut padded = Pixmap::new(20, 16).unwrap();
        for row in 0..12usize {
            let to = ((row + 2) * 20 + 2) * 4;
            padded.data_mut()[to..to + 64].copy_from_slice(&src.data()[row * 64..row * 64 + 64]);
        }
        let shifted = apply(&padded, 2, &u, |_| Ok(())).unwrap();
        for row in 0..12usize {
            let from = ((row + 2) * 20 + 2) * 4;
            assert_eq!(
                &shifted.data()[from..from + 64],
                &plain.data()[row * 64..row * 64 + 64]
            );
        }
    }

    #[test]
    fn warp_moves_the_sample_point_by_noise_times_strength() {
        let mut u = quiet();
        u.strength = [0.08, 0.06];
        let out = run(&u);
        let noise = GradientSmearNoise {
            complexity: 3.0,
            cycle: 0.0,
            brightness: 0.0,
            range: 0.0,
            scale1: [1.0, 1.0],
            scale2: [1.0, 1.0],
            offset: [0.0, 0.0],
            rotation: 0.0,
            sub_impact: 0.85,
            sub_scale: 40.0,
            sub_rotation: 0.0,
            sub_offset: [0.0, 0.0],
        };
        let field = super::super::gradient_smear::Uniforms {
            rect_scale: [2.0, 2.0],
            evolution: 1.5,
            seed: 0.0,
            stretch: 0.0,
            progress: 0.0,
            strength: [0.0, 0.0],
        };
        let (x, y) = (7usize, 4usize);
        let uv = [(x as f64 + 0.5 - 2.0) / 12.0, (y as f64 + 0.5 - 1.0) / 10.0];
        let p = [
            (uv[0] * 1.2 * 0.25 - 0.4) as f32,
            (uv[1] * 0.25 - 0.1) as f32,
        ];
        let a = (f64::from(super::super::gradient_smear::gradient(
            p, &field, &noise, 1.0,
        )) - 0.5)
            * 2.0;
        let b = (f64::from(super::super::gradient_smear::gradient(
            p, &field, &noise, 3.0,
        )) - 0.5)
            * 2.0;
        let sx = 2.0 + (uv[0] + a * 0.08) * 12.0 - 0.5;
        let sy = 1.0 + (uv[1] + b * 0.06) * 10.0 - 0.5;
        let expected = crate::scene::materials::bilinear_transparent(&source(), sx, sy);
        assert_eq!(pixel(&out, x, y), expected);
        assert_ne!((a, b), (0.0, 0.0));
        // Swapping the axes feeds the second field into x.
        u.swap_axes = true;
        let swapped = run(&u);
        let sx = 2.0 + (uv[0] + b * 0.08) * 12.0 - 0.5;
        let sy = 1.0 + (uv[1] + a * 0.06) * 10.0 - 0.5;
        assert_eq!(
            pixel(&swapped, x, y),
            crate::scene::materials::bilinear_transparent(&source(), sx, sy)
        );
    }

    #[test]
    fn stripe_stretches_one_side_of_the_band_about_the_domain_centre() {
        let mut u = quiet();
        u.stripe = Stripe {
            center: 0.5,
            core_half_height: 0.0,
            falloff: 2.0,
            gate: 0.0,
            amount: 0.2,
            side: ScanWarpSide::Above,
        };
        let out = run(&u);
        let src = source();
        // Material y of a row: (row + 0.5 - 1) / 10 in a downward uv. The "above" side is the
        // larger material y: rows from the centre line on shift inside the falloff, the rows
        // before it and the rows beyond the falloff do not.
        for (row, shifted) in [
            (2usize, false),
            (5, false),
            (6, true),
            (7, true),
            (9, false),
        ] {
            let m = [(7.0 + 0.5 - 2.0) / 12.0, (row as f64 + 0.5 - 1.0) / 10.0];
            let shift = stripe_shift(m, &u.stripe, 10.0);
            assert_eq!(shift != 0.0, shifted, "row {row}");
            if !shifted {
                assert_eq!(pixel(&out, 7, row), pixel(&src, 7, row));
            }
        }
        // The shift is odd about the domain centre column (the sample point moves toward the
        // centre, so the content is stretched outward) and strongest at the centre line.
        let near = stripe_shift([0.9, 0.5], &u.stripe, 10.0);
        let far = stripe_shift([0.1, 0.5], &u.stripe, 10.0);
        assert!((near + far).abs() < 1e-12 && near > 0.0);
        assert_eq!(stripe_shift([0.5, 0.5], &u.stripe, 10.0), 0.0);
        let farther = stripe_shift([0.9, 0.5 + 1.0 / 10.0], &u.stripe, 10.0);
        assert!(farther.abs() < near.abs());
        // Beyond the falloff (two pixels, 0.2 of the height) the band is gone.
        assert_eq!(stripe_shift([0.9, 0.75], &u.stripe, 10.0), 0.0);
        // The other side swaps the gate.
        u.stripe.side = ScanWarpSide::Below;
        assert_ne!(stripe_shift([0.9, 0.4], &u.stripe, 10.0), 0.0);
        assert_eq!(stripe_shift([0.9, 0.6], &u.stripe, 10.0), 0.0);
        // A soft gate ramps over its height instead of cutting.
        u.stripe.side = ScanWarpSide::Above;
        u.stripe.gate = 1.0;
        let half = stripe_shift([0.9, 0.45], &u.stripe, 10.0);
        assert!(half != 0.0 && half.abs() < near.abs());
    }

    #[test]
    fn upward_uv_mirrors_the_stripe_across_the_domain_height() {
        let mut down = quiet();
        down.stripe = Stripe {
            center: 0.7,
            core_half_height: 0.5,
            falloff: 3.0,
            gate: 0.0,
            amount: 0.3,
            side: ScanWarpSide::Above,
        };
        let mut up = quiet();
        up.uv_y = MaterialUvY::Up;
        up.stripe = Stripe {
            center: 0.3,
            core_half_height: 0.5,
            falloff: 3.0,
            gate: 0.0,
            amount: 0.3,
            side: ScanWarpSide::Below,
        };
        // Same band geometry read bottom-up instead of top-down.
        assert_eq!(run(&down).data(), run(&up).data());
    }

    #[test]
    fn scanlines_and_gain_scale_premultiplied_color_and_cap_at_alpha() {
        let mut u = quiet();
        u.gain = 0.5;
        let out = run(&u);
        let src = source();
        let (x, y) = (5usize, 4usize);
        let before = pixel(&src, x, y);
        let after = pixel(&out, x, y);
        assert_eq!(after[3], before[3]);
        for c in 0..3 {
            assert_eq!(
                after[c],
                libm::floor(f64::from(before[c]) * 0.5 + 0.5) as u8
            );
        }
        u.gain = 1.0;
        u.scanlines = Scanlines {
            amount: 0.5,
            pitch: 2.5,
            phase: 0.3,
        };
        let out = run(&u);
        let m_y = (y as f64 + 0.5 - 1.0) / 10.0;
        let factor = 1.0 - 0.5 * libm::sin(2.5 * m_y * 10.0 - 0.3);
        let after = pixel(&out, x, y);
        for c in 0..3 {
            let expected =
                libm::floor(f64::from(before[c]) * factor + 0.5).clamp(0.0, f64::from(before[3]));
            assert_eq!(f64::from(after[c]), expected);
        }
        // Boosting brightness never exceeds alpha.
        u.gain = 4.0;
        u.scanlines.amount = 0.0;
        for px in run(&u).data().chunks_exact(4) {
            assert!(px[..3].iter().all(|c| *c <= px[3]));
        }
    }

    #[test]
    fn work_is_charged_per_domain_pixel_and_invalid_uniforms_fail() {
        let mut charged = 0u64;
        apply(&source(), 0, &quiet(), |n| {
            charged += n;
            Ok(())
        })
        .unwrap();
        assert_eq!(charged, 12 * 10 * pixel_cost(3.0));
        assert!(
            apply(&source(), 0, &quiet(), |_| anyhow::bail!(
                "CAPTION_BUDGET_EXCEEDED"
            ))
            .is_err()
        );
        let mut bad = quiet();
        bad.gain = 5.0;
        assert!(apply(&source(), 0, &bad, |_| Ok(())).is_err());
        let mut bad = quiet();
        bad.domain[3] = 0.0;
        assert!(apply(&source(), 0, &bad, |_| Ok(())).is_err());
        let mut bad = quiet();
        bad.complexity = 0.5;
        assert!(apply(&source(), 0, &bad, |_| Ok(())).is_err());
        let mut bad = quiet();
        bad.stripe.amount = f64::NAN;
        assert!(apply(&source(), 0, &bad, |_| Ok(())).is_err());
    }
}
