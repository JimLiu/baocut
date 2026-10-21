//! A fixed sine-noise edge mask with an explicit threshold reveal policy.
//!
//! The mask coordinate transform never changes the input texture coordinate.
//! Components remain independent, including associated colors above alpha.
use anyhow::{Result, ensure};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UvY {
    Up,
    Down,
}
use tiny_skia::Pixmap;

const MASK_WORK: u64 = 64;

fn smoothstep(lo: f32, hi: f32, value: f32) -> f32 {
    let t = ((value - lo) / (hi - lo)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn sine_noise(uv: [f32; 2]) -> f32 {
    let p = uv.map(|v| v * 0.3);
    let value = libm::sinf(p[0] * 12.9898 + p[1] * 78.233) * 333.5453;
    value - libm::floorf(value)
}

fn mask_uv(source_uv: [f32; 2], scale: [f32; 2]) -> [f32; 2] {
    if scale == [1.0, 1.0] {
        source_uv
    } else {
        std::array::from_fn::<_, 2, _>(|i| (source_uv[i] - 0.5) / scale[i] + 0.5)
    }
}

fn visible(source_uv: [f32; 2], position: f32, scale: [f32; 2], reveal: bool) -> bool {
    let uv = mask_uv(source_uv, scale);
    let band = smoothstep(position - 0.09, position, uv[0])
        * smoothstep(1.0 - position - 0.05, 1.0 - position, 1.0 - uv[0]);
    let edge = sine_noise(uv) + band >= 1.2;
    // This is a defined threshold contract, not an equal-edge smoothstep.
    (reveal && uv[0] <= position) || edge
}

/// Apply the mask in an explicit, top-down canvas rectangle.
///
/// `uv_y` selects the noise/mask coordinate convention. The image itself is
/// sampled at the unchanged source coordinate, so retained texels are copied
/// exactly rather than passed through an unnecessary identity resampler.
#[allow(clippy::too_many_arguments)]
pub fn apply(
    input: &Pixmap,
    pad: u32,
    mut domain: [f64; 4],
    position: f64,
    mask_scale: [f64; 2],
    reveal: bool,
    uv_y: UvY,
    mut spend: impl FnMut(u64) -> Result<()>,
) -> Result<Pixmap> {
    ensure!(
        domain
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 1_000_000.0)
            && domain[2] >= 0.001
            && domain[3] >= 0.001,
        "CAPTION_MATERIAL_INVALID: noisy sweep domain"
    );
    ensure!(
        position.is_finite()
            && (-1024.0..=1024.0).contains(&position)
            && mask_scale
                .iter()
                .all(|v| v.is_finite() && (0.001..=1024.0).contains(v)),
        "CAPTION_MATERIAL_INVALID: noisy sweep mask parameters"
    );
    domain[0] += f64::from(pad);
    domain[1] += f64::from(pad);
    // Charge zero initialization before allocating a new surface. Caller owns
    // the aggregate surface-memory budget across all filter/layer operations.
    spend(u64::from(input.width()) * u64::from(input.height()))?;
    let mut output = Pixmap::new(input.width(), input.height())
        .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: noisy sweep surface"))?;
    let edge = |value: f64, max: u32| libm::ceil(value - 0.5).clamp(0.0, f64::from(max)) as u32;
    let x_start = edge(domain[0], input.width());
    let x_end = edge(domain[0] + domain[2], input.width());
    let y_start = edge(domain[1], input.height());
    let y_end = edge(domain[1] + domain[3], input.height());
    let position = position as f32;
    let scale = mask_scale.map(|v| v as f32);
    for y in y_start..y_end {
        for x in x_start..x_end {
            spend(MASK_WORK)?;
            let mut uv = [
                ((f64::from(x) + 0.5 - domain[0]) / domain[2]) as f32,
                ((f64::from(y) + 0.5 - domain[1]) / domain[3]) as f32,
            ];
            if uv_y == UvY::Up {
                uv[1] = 1.0 - uv[1];
            }
            if visible(uv, position, scale, reveal) {
                spend(1)?;
                let offset = (y as usize * input.width() as usize + x as usize) * 4;
                output.data_mut()[offset..offset + 4]
                    .copy_from_slice(&input.data()[offset..offset + 4]);
            }
        }
    }
    Ok(output)
}

/// Static field prepared once for a geometry/scale. Dynamic position/reveal
/// remain GPU uniforms. libm sine is frozen here to avoid backend-dependent
/// transcendental rounding changing the hash before a binary threshold.
#[derive(Clone, Debug)]
pub struct NoiseField {
    pub rect: [u32; 4],
    pub pixels: Vec<[f32; 4]>,
}
pub fn prepare_field(
    size: [u32; 2],
    domain: [f64; 4],
    scale: [f64; 2],
    flip_y: bool,
) -> Result<NoiseField> {
    ensure!(
        size[0] > 0
            && size[1] > 0
            && domain
                .iter()
                .all(|n| n.is_finite() && n.abs() <= 1_000_000.0)
            && domain[2] >= 0.001
            && domain[3] >= 0.001
            && scale
                .iter()
                .all(|n| n.is_finite() && (0.001..=1024.0).contains(n)),
        "CAPTION_MATERIAL_INVALID: noise field"
    );
    let edge = |value: f64, max: u32| libm::ceil(value - 0.5).clamp(0.0, f64::from(max)) as u32;
    let x0 = edge(domain[0], size[0]);
    let y0 = edge(domain[1], size[1]);
    let x1 = edge(domain[0] + domain[2], size[0]);
    let y1 = edge(domain[1] + domain[3], size[1]);
    let width = x1.saturating_sub(x0);
    let height = y1.saturating_sub(y0);
    ensure!(
        u64::from(width) * u64::from(height) * 16 <= 64 * 1024 * 1024,
        "CAPTION_BUDGET_EXCEEDED: noise field"
    );
    let mut pixels = Vec::with_capacity(width as usize * height as usize);
    for y in y0..y1 {
        for x in x0..x1 {
            let mut uv = [
                ((f64::from(x) + 0.5 - domain[0]) / domain[2]) as f32,
                ((f64::from(y) + 0.5 - domain[1]) / domain[3]) as f32,
            ];
            if flip_y {
                uv[1] = 1.0 - uv[1];
            }
            let uv = mask_uv(uv, scale.map(|n| n as f32));
            pixels.push([uv[0], sine_noise(uv), 0.0, 0.0]);
        }
    }
    Ok(NoiseField {
        rect: [x0, y0, width, height],
        pixels,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(width: u32, height: u32) -> Pixmap {
        let mut image = Pixmap::new(width, height).unwrap();
        for (i, pixel) in image.data_mut().chunks_exact_mut(4).enumerate() {
            pixel.copy_from_slice(&[
                (i * 37 % 256) as u8,
                (255 - i * 19 % 256) as u8,
                (i * 71 % 256) as u8,
                (i * 11 % 79) as u8,
            ]);
        }
        image
    }

    #[test]
    fn explicit_reveal_includes_its_boundary() {
        assert!(visible([0.5, 0.8], 0.5, [1.0, 1.0], true));
        assert!(visible([0.1, 0.8], 0.5, [1.0, 1.0], true));
        assert!(!visible([0.9, 0.8], 0.5, [1.0, 1.0], true));
    }

    #[test]
    fn original_components_are_preserved_without_alpha_clamping() {
        let input = image(9, 7);
        let output = apply(
            &input,
            0,
            [0.0, 0.0, 9.0, 7.0],
            1.0,
            [1.0; 2],
            true,
            UvY::Down,
            |_| Ok(()),
        )
        .unwrap();
        assert_eq!(input.data(), output.data());
        assert!(output.data().chunks_exact(4).any(|p| p[0] > p[3]));
        assert_eq!(&output.data()[0..4], &[0, 255, 0, 0]);
    }

    #[test]
    fn mask_scale_never_resamples_the_image() {
        let input = image(63, 29);
        let output = apply(
            &input,
            0,
            [0.0, 0.0, 63.0, 29.0],
            0.51,
            [1.3125; 2],
            false,
            UvY::Down,
            |_| Ok(()),
        )
        .unwrap();
        let mut kept = 0;
        for (a, b) in input
            .data()
            .chunks_exact(4)
            .zip(output.data().chunks_exact(4))
        {
            if b.iter().any(|v| *v != 0) {
                assert_eq!(a, b);
                kept += 1;
            }
        }
        assert!(kept > 0 && kept < 63 * 29 / 2);
    }

    #[test]
    fn transparent_domain_and_padding_follow_pixel_centers() {
        let input = image(7, 5);
        let output = apply(
            &input,
            1,
            [0.5, -0.5, 3.0, 2.0],
            1.0,
            [1.0; 2],
            true,
            UvY::Down,
            |_| Ok(()),
        )
        .unwrap();
        for y in 0..5 {
            for x in 0..7 {
                let at = (y * 7 + x) * 4;
                let inside = (1..4).contains(&x) && y < 2;
                assert_eq!(
                    &output.data()[at..at + 4],
                    if inside {
                        &input.data()[at..at + 4]
                    } else {
                        &[0, 0, 0, 0]
                    }
                );
            }
        }
    }

    #[test]
    fn y_convention_only_reflects_the_noise_field() {
        let mut input = Pixmap::new(48, 32).unwrap();
        input.data_mut().fill(255);
        let up = apply(
            &input,
            0,
            [0.0, 0.0, 48.0, 32.0],
            0.52,
            [1.0; 2],
            false,
            UvY::Up,
            |_| Ok(()),
        )
        .unwrap();
        let down = apply(
            &input,
            0,
            [0.0, 0.0, 48.0, 32.0],
            0.52,
            [1.0; 2],
            false,
            UvY::Down,
            |_| Ok(()),
        )
        .unwrap();
        assert_ne!(up.data(), down.data());
        for y in 0..32usize {
            assert_eq!(
                &up.data()[y * 48 * 4..(y + 1) * 48 * 4],
                &down.data()[(31 - y) * 48 * 4..(32 - y) * 48 * 4]
            );
        }
    }

    #[test]
    fn invalid_inputs_and_budget_failure_do_not_modify_the_source() {
        let input = image(8, 8);
        let original = input.data().to_vec();
        assert!(
            apply(
                &input,
                0,
                [0.0, 0.0, 0.0, 8.0],
                0.5,
                [1.0; 2],
                true,
                UvY::Down,
                |_| Ok(())
            )
            .is_err()
        );
        assert!(
            apply(
                &input,
                0,
                [0.0, 0.0, 8.0, 8.0],
                f64::NAN,
                [1.0; 2],
                true,
                UvY::Down,
                |_| Ok(())
            )
            .is_err()
        );
        assert!(
            apply(
                &input,
                0,
                [0.0, 0.0, 8.0, 8.0],
                0.5,
                [0.0, 1.0],
                true,
                UvY::Down,
                |_| Ok(())
            )
            .is_err()
        );
        let mut spent = 0;
        assert!(
            apply(
                &input,
                0,
                [0.0, 0.0, 8.0, 8.0],
                0.5,
                [1.0; 2],
                true,
                UvY::Down,
                |amount| {
                    spent += amount;
                    ensure!(spent <= 64 + MASK_WORK, "test budget");
                    Ok(())
                }
            )
            .is_err()
        );
        assert_eq!(original, input.data());
        assert!(spent > 64 + MASK_WORK);
    }

    #[test]
    fn allocation_and_visible_texels_are_charged() {
        let input = image(5, 3);
        let mut spent = 0;
        apply(
            &input,
            0,
            [0.0, 0.0, 5.0, 3.0],
            1.0,
            [1.0; 2],
            true,
            UvY::Down,
            |amount| {
                spent += amount;
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(spent, 15 + 15 * MASK_WORK + 15);
    }

    #[test]
    fn fixed_noise_and_edge_match_independent_f32_vectors() {
        // Independent scalar oracle; each expected edge is safely separated
        // from the threshold. Sine backends may differ by a final noise ulp.
        let cases: [([f32; 2], f32, u32, bool); 12] = [
            ([0.5, 0.1], 1.0, 0x3cdf0000, false),
            ([0.5, 0.1], 1.3125, 0x3f369d80, true),
            ([0.5, 0.3], 1.0, 0x3f295100, true),
            ([0.5, 0.3], 1.3125, 0x3f2dc900, true),
            ([0.47, 0.75], 1.0, 0x3cd28000, false),
            ([0.47, 0.75], 1.3125, 0x3e9a0200, false),
            ([0.54, 0.25], 1.0, 0x3e6d9800, false),
            ([0.54, 0.25], 1.3125, 0x3f7dda60, true),
            ([0.1, 0.9], 1.0, 0x3f17d000, false),
            ([0.1, 0.9], 1.3125, 0x3ce8e000, false),
            ([0.95, 0.9], 1.0, 0x3f77e480, false),
            ([0.95, 0.9], 1.3125, 0x3f6cfe80, false),
        ];
        for (uv, scale, noise_bits, edge) in cases {
            let noise = f32::from_bits(noise_bits);
            let mask_uv = if scale == 1.0 {
                uv
            } else {
                uv.map(|v| (v - 0.5) / scale + 0.5)
            };
            assert!(
                (sine_noise(mask_uv) - noise).abs() <= 0.000062,
                "uv={uv:?} scale={scale}"
            );
            assert_eq!(visible(uv, 0.51, [scale; 2], false), edge);
        }
    }
}
