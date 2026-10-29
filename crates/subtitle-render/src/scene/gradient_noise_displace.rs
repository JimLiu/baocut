//! Gradient noise displacement (`caption-gradient-noise-displace/1`): two fractal gradient-noise
//! fields move the sample point of a page domain along both axes.
use anyhow::{Result, ensure};
use caption_scene::{GradientSmearNoise, MaterialUvY};
use tiny_skia::Pixmap;

/// Lattice seeds of the two fields: the first moves x, the second y.
const SEEDS: [f32; 2] = [3.11, 10.71];
/// Side of the shorter domain axis on which the lattice is laid out.
const LATTICE_MINOR_SIDE: f64 = 720.0;
/// Displacement amplitude per unit of `scale * range`.
const AMPLITUDE: f64 = 0.6;

/// Resolved uniforms; ranges are checked by validation and again here.
pub(super) struct GradientNoiseDisplace {
    /// Canvas-space domain `[x, y, width, height]` in output pixels.
    pub(super) domain: [f64; 4],
    pub(super) uv_y: MaterialUvY,
    pub(super) complexity: f64,
    pub(super) cycle: f64,
    pub(super) sub_impact: f64,
    pub(super) sub_scale: f64,
    pub(super) sub_rotation: f64,
    pub(super) sub_offset: [f64; 2],
    pub(super) rotation: f64,
    pub(super) scale: f64,
    pub(super) offset: [f64; 2],
    pub(super) evolution: f64,
    pub(super) brightness: f64,
    pub(super) contrast: f64,
    pub(super) range: f64,
}

/// Work units charged per domain pixel: two noise fields over every octave plus the tap.
pub(super) fn pixel_cost(complexity: f64) -> u64 {
    16 + 16 * (libm::ceil(complexity) as u64 + 1)
}

struct Field {
    uniforms: super::gradient_smear::Uniforms,
    noise: GradientSmearNoise,
    aspect: [f32; 2],
    rotation: f32,
    inverse_scale: f32,
}

impl Field {
    fn new(u: &GradientNoiseDisplace) -> Self {
        let [_, _, dw, dh] = u.domain;
        let minor = dw.min(dh);
        // The lattice step follows a domain whose shorter side is 720 pixels.
        let ratio = [
            LATTICE_MINOR_SIDE * dw / minor,
            LATTICE_MINOR_SIDE * dh / minor,
        ];
        let to_radians = |degrees: f64| degrees as f32 * core::f32::consts::PI / 180.0;
        Self {
            uniforms: super::gradient_smear::Uniforms {
                rect_scale: ratio.map(|v| (v / 50.0) as f32),
                evolution: u.evolution as f32,
                seed: 0.0,
                stretch: 0.0,
                progress: 0.0,
                strength: [0.0, 0.0],
            },
            noise: GradientSmearNoise {
                complexity: u.complexity,
                cycle: u.cycle,
                brightness: 0.0,
                range: 0.0,
                scale1: [1.0, 1.0],
                scale2: [1.0, 1.0],
                offset: [0.0, 0.0],
                rotation: 0.0,
                sub_impact: u.sub_impact,
                sub_scale: u.sub_scale,
                sub_rotation: f64::from(to_radians(u.sub_rotation)),
                sub_offset: u.sub_offset,
            },
            aspect: [dw as f32, dh as f32],
            rotation: to_radians(u.rotation),
            inverse_scale: 1.0 / u.scale as f32,
        }
    }

    /// Both noise values for the material coordinate `m` (y up when `uvY` is `up`).
    fn pair(&self, m: [f64; 2], offset: [f64; 2]) -> [f32; 2] {
        let shifted = [(m[0] - offset[0]) as f32, (m[1] - offset[1]) as f32];
        let turned = super::gradient_smear::rotate(shifted, self.rotation, self.aspect);
        let point = turned.map(|v| v * self.inverse_scale - 10.0);
        SEEDS.map(|seed| {
            super::gradient_smear::gradient_soft(point, &self.uniforms, &self.noise, seed)
        })
    }
}

/// Per destination pixel center inside the domain, with material coordinates `m`
/// (`m.y` flipped for `uvY: up`): the noise point is `((m - offset) turned by rotation) / scale - 10`,
/// two soft-remapped fractal gradient fields `a` and `b` (seeds 3.11 and 10.71) are evaluated there and
/// `c = (v + brightness - 0.5) * contrast * 10 + 0.5`; the sample point becomes
/// `m + (c - 0.5) * clamp(scale, 0.01, 1) * range * 0.6` per axis, read with one premultiplied bilinear
/// tap (transparent outside the surface). Pixels outside the domain become transparent.
pub(super) fn apply(
    source: &Pixmap,
    pad: u32,
    u: &GradientNoiseDisplace,
    mut spend: impl FnMut(u64) -> Result<()>,
) -> Result<Pixmap> {
    ensure!(
        u.domain
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 1_000_000.0)
            && u.domain[2] >= 0.001
            && u.domain[3] >= 0.001
            && (1.0..=10.0).contains(&u.complexity)
            && (2.0..=100_000.0).contains(&u.cycle)
            && (0.0..=1.0).contains(&u.sub_impact)
            && (1.0..=10_000.0).contains(&u.sub_scale)
            && (-360.0..=360.0).contains(&u.sub_rotation)
            && u.sub_offset
                .iter()
                .all(|v| (-100_000.0..=100_000.0).contains(v))
            && (-360.0..=360.0).contains(&u.rotation)
            && (0.001..=1000.0).contains(&u.scale)
            && u.offset
                .iter()
                .all(|v| (-100_000.0..=100_000.0).contains(v))
            && (-100_000.0..=100_000.0).contains(&u.evolution)
            && (-16.0..=16.0).contains(&u.brightness)
            && (0.0..=1000.0).contains(&u.contrast)
            && (-16.0..=16.0).contains(&u.range),
        "CAPTION_MATERIAL_INVALID: gradient noise displacement uniforms"
    );
    let (width, height) = (source.width(), source.height());
    let mut out = Pixmap::new(width, height).ok_or_else(|| {
        anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: gradient noise displacement surface")
    })?;
    let [dx, dy, dw, dh] = u.domain;
    let origin = f64::from(pad);
    let cost = pixel_cost(u.complexity);
    let amount = u.scale.clamp(0.01, 1.0) * u.range * AMPLITUDE;
    let moved = amount != 0.0 && u.contrast != 0.0;
    let field = Field::new(u);
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
            let mut sample = m;
            if moved {
                let noise = field.pair(m, u.offset);
                for axis in 0..2 {
                    let c = (f64::from(noise[axis]) + u.brightness - 0.5) * u.contrast * 10.0 + 0.5;
                    sample[axis] += (c - 0.5) * amount;
                }
            }
            let row = if flip { 1.0 - sample[1] } else { sample[1] };
            // Back to texel-center coordinates: zero displacement is the identity.
            let sx = origin + dx + sample[0] * dw - 0.5;
            let sy = origin + dy + row * dh - 0.5;
            ensure!(
                sx.is_finite() && sy.is_finite(),
                "CAPTION_MATERIAL_INVALID: gradient noise displacement coordinate"
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
        let mut pixmap = Pixmap::new(24, 16).unwrap();
        for (i, px) in pixmap.data_mut().chunks_exact_mut(4).enumerate() {
            let a = (i * 37 % 200 + 56) as u8;
            px.copy_from_slice(&[a / 2, a / 3, a / 4, a]);
        }
        pixmap
    }

    fn uniforms() -> GradientNoiseDisplace {
        GradientNoiseDisplace {
            domain: [2.0, 1.0, 20.0, 14.0],
            uv_y: MaterialUvY::Down,
            complexity: 2.1,
            cycle: 300.0,
            sub_impact: 0.7,
            sub_scale: 56.0,
            sub_rotation: 0.0,
            sub_offset: [0.0, 0.0],
            rotation: 0.0,
            scale: 0.8,
            offset: [0.05, 0.05],
            evolution: 0.0,
            brightness: 0.0,
            contrast: 0.016,
            range: 0.3,
        }
    }

    fn run(u: &GradientNoiseDisplace) -> Pixmap {
        apply(&source(), 0, u, |_| Ok(())).unwrap()
    }

    fn pixel(map: &Pixmap, x: usize, y: usize) -> [u8; 4] {
        let i = (y * map.width() as usize + x) * 4;
        map.data()[i..i + 4].try_into().unwrap()
    }

    #[test]
    fn fields_match_independently_evaluated_scalar_f32_vectors() {
        let data: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/gradient-noise-displace-field.json"
        ))
        .unwrap();
        for case in data["cases"].as_array().unwrap() {
            let number = |key: &str| case[key].as_f64().unwrap();
            let pair =
                |key: &str| -> [f64; 2] { std::array::from_fn(|i| case[key][i].as_f64().unwrap()) };
            let u = GradientNoiseDisplace {
                domain: [0.0, 0.0, number("width"), number("height")],
                uv_y: MaterialUvY::Down,
                complexity: number("complexity"),
                cycle: number("cycle"),
                sub_impact: number("subImpact"),
                sub_scale: number("subScale"),
                sub_rotation: number("subRotation"),
                sub_offset: pair("subOffset"),
                rotation: number("rotation"),
                scale: number("scale"),
                offset: pair("offset"),
                evolution: number("evolution"),
                brightness: 0.0,
                contrast: 1.0,
                range: 1.0,
            };
            let field = Field::new(&u);
            for point in case["points"].as_array().unwrap() {
                let m = [
                    point["uv"][0].as_f64().unwrap(),
                    point["uv"][1].as_f64().unwrap(),
                ];
                let actual = field.pair(m, u.offset);
                for axis in 0..2 {
                    let expected = point["expected"][axis].as_f64().unwrap() as f32;
                    assert!(
                        (actual[axis] - expected).abs() < 0.00005,
                        "{} {m:?} axis{axis}: {} vs {expected}",
                        case["id"],
                        actual[axis]
                    );
                }
            }
        }
    }

    #[test]
    fn zero_contrast_or_range_keeps_the_identity() {
        let src = source();
        let identity = |u: &GradientNoiseDisplace| {
            let out = run(u);
            for y in 0..16usize {
                for x in 0..24usize {
                    let inside = (2..22).contains(&x) && (1..15).contains(&y);
                    let expected = if inside { pixel(&src, x, y) } else { [0; 4] };
                    assert_eq!(pixel(&out, x, y), expected, "{x},{y}");
                }
            }
        };
        let mut u = uniforms();
        u.contrast = 0.0;
        identity(&u);
        let mut u = uniforms();
        u.range = 0.0;
        identity(&u);
    }

    #[test]
    fn displacement_follows_the_documented_formula_on_both_axes() {
        let mut u = uniforms();
        u.contrast = 3.0;
        u.range = 0.4;
        u.brightness = 0.1;
        u.offset = [0.2, 0.1];
        let out = run(&u);
        let src = source();
        let field = Field::new(&u);
        let amount = 0.8_f64.clamp(0.01, 1.0) * 0.4 * 0.6;
        let mut moved = 0;
        for (x, y) in [(5usize, 3usize), (12, 8), (3, 12), (18, 6)] {
            let m = [(x as f64 + 0.5 - 2.0) / 20.0, (y as f64 + 0.5 - 1.0) / 14.0];
            let n = field.pair(m, u.offset);
            let shift: [f64; 2] = std::array::from_fn(|axis| {
                let c = (f64::from(n[axis]) + 0.1 - 0.5) * 3.0 * 10.0 + 0.5;
                (c - 0.5) * amount
            });
            let expected = crate::scene::materials::bilinear_transparent(
                &src,
                2.0 + (m[0] + shift[0]) * 20.0 - 0.5,
                1.0 + (m[1] + shift[1]) * 14.0 - 0.5,
            );
            assert_eq!(pixel(&out, x, y), expected, "{x},{y}");
            if shift.iter().any(|v| v.abs() * 20.0 > 0.2) {
                moved += 1;
            }
        }
        assert!(
            moved > 0,
            "the chosen uniforms must displace at least one probe"
        );
    }

    #[test]
    fn up_orientation_reads_the_field_and_the_tap_with_y_flipped() {
        let mut u = uniforms();
        u.contrast = 3.0;
        u.range = 0.4;
        u.uv_y = MaterialUvY::Up;
        let out = run(&u);
        let src = source();
        let field = Field::new(&u);
        let amount = 0.8_f64.clamp(0.01, 1.0) * 0.4 * 0.6;
        let mut moved = 0;
        for (x, y) in [(5usize, 3usize), (12, 8), (3, 12), (18, 6)] {
            let m = [
                (x as f64 + 0.5 - 2.0) / 20.0,
                1.0 - (y as f64 + 0.5 - 1.0) / 14.0,
            ];
            let n = field.pair(m, u.offset);
            let shift: [f64; 2] = std::array::from_fn(|axis| {
                (((f64::from(n[axis]) - 0.5) * 3.0 * 10.0 + 0.5) - 0.5) * amount
            });
            let expected = crate::scene::materials::bilinear_transparent(
                &src,
                2.0 + (m[0] + shift[0]) * 20.0 - 0.5,
                1.0 + (1.0 - (m[1] + shift[1])) * 14.0 - 0.5,
            );
            assert_eq!(pixel(&out, x, y), expected, "{x},{y}");
            moved += usize::from(shift.iter().any(|v| v.abs() * 20.0 > 0.2));
        }
        assert!(
            moved > 0,
            "the chosen uniforms must displace at least one probe"
        );
        u.uv_y = MaterialUvY::Down;
        assert_ne!(run(&u).data(), out.data());
    }

    #[test]
    fn padding_shifts_the_surface_without_changing_the_content() {
        let mut u = uniforms();
        u.contrast = 3.0;
        u.range = 0.4;
        let plain = run(&u);
        let src = source();
        let mut padded = Pixmap::new(28, 20).unwrap();
        for row in 0..16usize {
            let to = ((row + 2) * 28 + 2) * 4;
            padded.data_mut()[to..to + 96].copy_from_slice(&src.data()[row * 96..row * 96 + 96]);
        }
        let shifted = apply(&padded, 2, &u, |_| Ok(())).unwrap();
        for row in 0..16usize {
            let from = ((row + 2) * 28 + 2) * 4;
            assert_eq!(
                &shifted.data()[from..from + 96],
                &plain.data()[row * 96..row * 96 + 96]
            );
        }
    }

    #[test]
    fn evolution_and_offset_change_the_field_and_work_is_charged_per_pixel() {
        let mut u = uniforms();
        u.contrast = 3.0;
        u.range = 0.4;
        let base = run(&u);
        let mut moved = uniforms();
        moved.contrast = 3.0;
        moved.range = 0.4;
        moved.evolution = 1.37;
        assert_ne!(run(&moved).data(), base.data());
        let mut moved = uniforms();
        moved.contrast = 3.0;
        moved.range = 0.4;
        moved.offset = [0.55, 0.05];
        assert_ne!(run(&moved).data(), base.data());
        let mut spent = 0u64;
        apply(&source(), 0, &u, |n| {
            spent += n;
            Ok(())
        })
        .unwrap();
        assert_eq!(spent, 20 * 14 * pixel_cost(2.1));
        let refused = apply(&source(), 0, &u, |_| anyhow::bail!("budget"));
        assert!(refused.is_err());
    }

    #[test]
    fn invalid_uniforms_fail() {
        let src = source();
        for edit in [
            (|u: &mut GradientNoiseDisplace| u.scale = 0.0) as fn(&mut GradientNoiseDisplace),
            |u| u.complexity = 0.5,
            |u| u.cycle = 1.0,
            |u| u.contrast = -1.0,
            |u| u.range = 17.0,
            |u| u.domain[3] = 0.0,
            |u| u.evolution = f64::NAN,
        ] {
            let mut u = uniforms();
            edit(&mut u);
            assert!(apply(&src, 0, &u, |_| Ok(())).is_err());
        }
    }
}
