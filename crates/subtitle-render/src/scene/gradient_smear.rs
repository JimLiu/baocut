//! Bounded evolving gradient noise followed by 128 independent RGBA samples.
use anyhow::{Result, ensure};
use caption_scene::{GradientSmearNoise, MaterialUvY};
use tiny_skia::Pixmap;

#[derive(Clone, Copy)]
pub(super) struct Uniforms {
    pub rect_scale: [f32; 2],
    pub evolution: f32,
    pub seed: f32,
    pub stretch: f32,
    pub progress: f32,
    pub strength: [f32; 2],
}
fn fract(x: f32) -> f32 {
    x - libm::floorf(x)
}
fn mix(a: f32, b: f32, t: f32) -> f32 {
    a * (1.0 - t) + b * t
}
fn hash(p: [f32; 2]) -> f32 {
    let mut q = p.map(|x| fract(x * 1324.518));
    let d = q[0] * (q[1] + 22.541) + q[1] * (q[0] + 22.541);
    q[0] += d;
    q[1] += d;
    fract((q[0] + q[1]) * q[1])
}
fn random(p: [f32; 2], evolution: f32, seed: f32, cycle: f32) -> [f32; 2] {
    let n = hash(p);
    let e = evolution + n;
    let (mut e0, mut e1) = (libm::floorf(e), libm::floorf(e) + 1.0);
    if cycle >= 2.0 {
        e0 = libm::floorf(e - cycle * libm::floorf(e / cycle));
        e1 = libm::floorf(e + 1.0 - cycle * libm::floorf((e + 1.0) / cycle));
    }
    let at = |index: f32| {
        let mut q = p.map(|x| fract(x * (34.532 + index * 4.412 + seed * 0.8031)));
        let d = q[0] * (q[1] + 15.434) + q[1] * (q[0] + 15.434);
        q[0] += d;
        q[1] += d;
        [
            fract((q[0] + q[1] + 0.523) * q[1] + n),
            fract((q[1] + q[0] + 0.523) * q[0] + n),
        ]
    };
    let (a, b) = (at(e0), at(e1));
    std::array::from_fn(|i| mix(a[i], b[i], fract(e)) * 2.0 - 1.0)
}
fn rotate(mut uv: [f32; 2], angle: f32, scale: [f32; 2]) -> [f32; 2] {
    // The vertical aspect adjustment precedes subtraction of the pivot.
    uv[1] *= scale[1] / scale[0];
    uv[0] -= 0.5;
    uv[1] -= 0.5;
    let (s, c) = (libm::sinf(angle), libm::cosf(angle));
    [
        c * uv[0] - s * uv[1] + 0.5,
        (s * uv[0] + c * uv[1] + 0.5) * scale[0] / scale[1],
    ]
}
fn interpolation(uv: [f32; 2], u: &Uniforms, noise: &GradientSmearNoise, seed: f32) -> f32 {
    let p = std::array::from_fn::<_, 2, _>(|i| uv[i] * (50.0 * u.rect_scale[i]) / 100.0);
    let f = p.map(fract);
    let cell = p.map(libm::floorf);
    let smooth = f.map(|x| x * x * x * (x * (x * 6.0 - 15.0) + 10.0));
    let sample = |x: f32, y: f32| {
        let n = random(
            [cell[0] + x, cell[1] + y],
            u.evolution,
            seed,
            noise.cycle as f32,
        );
        n[0] * (f[0] - x) + n[1] * (f[1] - y)
    };
    mix(
        mix(sample(0.0, 0.0), sample(1.0, 0.0), smooth[0]),
        mix(sample(0.0, 1.0), sample(1.0, 1.0), smooth[0]),
        smooth[1],
    ) * 0.5
        + 0.5
}
/// Fractal gradient noise in [0, 1]; also the displacement field of `scan_warp`.
pub(super) fn gradient(mut uv: [f32; 2], u: &Uniforms, n: &GradientSmearNoise, seed: f32) -> f32 {
    let complexity = n.complexity as f32;
    let mut sum = interpolation(uv, u, n, seed);
    let mut total = 1.0;
    let mut weight = n.sub_impact as f32;
    let step = |p: [f32; 2]| {
        let p = std::array::from_fn(|i| p[i] - n.sub_offset[i] as f32 / (50.0 * u.rect_scale[i]));
        rotate(p, n.sub_rotation as f32, u.rect_scale).map(|v| v * (100.0 / n.sub_scale as f32))
    };
    for i in 2..=10 {
        if i as f32 > libm::floorf(complexity) {
            break;
        }
        uv = step(uv);
        sum += interpolation(uv, u, n, seed) * weight;
        total += weight;
        weight *= n.sub_impact as f32;
    }
    uv = step(uv);
    sum += interpolation(uv, u, n, seed) * weight * fract(complexity);
    total += weight * fract(complexity);
    (sum / total).clamp(0.0, 1.0)
}
fn displacement(uv: [f32; 2], u: &Uniforms, n: &GradientSmearNoise) -> [f32; 2] {
    let shifted = rotate(
        std::array::from_fn(|i| uv[i] - n.offset[i] as f32),
        n.rotation as f32,
        u.rect_scale,
    );
    let a = hash([u.seed + 0.73, u.seed + 1.01]);
    let b = hash([u.seed + 0.79, u.seed + 1.27]);
    let p = std::array::from_fn(|i| shifted[i] * (1.0 / (n.scale1[i] as f32 * (1.0 + a))) - 10.0);
    let q = std::array::from_fn(|i| shifted[i] * (1.0 / (n.scale2[i] as f32 * (1.0 + b))) - 10.0);
    let sign = if u.progress < 0.5 { -1.0 } else { 1.0 };
    let mut x = (gradient(p, u, n, 1.0) - 0.5) * 2.0 * sign * 1.1;
    x *= (1.0 - u.stretch.abs()).clamp(0.0, 1.0);
    x *= ((uv[0] - 0.5).abs() * 5.0 + hash([u.seed, u.seed + 0.43]) + 0.1).clamp(0.0, 1.0);
    let dx = uv[0] - 0.5;
    let direction = if dx > 0.0 {
        1.0
    } else if dx < 0.0 {
        -1.0
    } else {
        0.0
    };
    let stretch = (direction
        * libm::powf(
            (dx * (0.1 + 1.6 * hash([u.seed + 0.73, u.seed]))).abs(),
            0.7,
        ))
    .clamp(-0.3, 0.3);
    x += u.stretch * stretch;
    x = x * 0.5 + 0.5;
    let y = ((gradient(q, u, n, 3.0) - 0.5) * 2.0 * 1.1 * sign) * 0.5 + 0.5;
    let value = [x, y];
    std::array::from_fn(|i| {
        let adjusted = (value[i] + n.brightness as f32 - 0.5) * u.strength[i] + 0.5;
        let scale = if i == 0 { n.scale1[0] } else { n.scale2[0] };
        let extent = if i == 0 { 13.0 } else { 2.6 };
        let influence = (scale as f32).clamp(0.01, 1.0) * n.range as f32;
        uv[i] + (adjusted - 0.5) * influence * extent / u.rect_scale[i]
    })
}

pub(super) fn apply(
    input: &Pixmap,
    pad: u32,
    mut domain: [f64; 4],
    u: &Uniforms,
    noise: &GradientSmearNoise,
    uv_y: MaterialUvY,
    mut spend: impl FnMut(u64) -> Result<()>,
) -> Result<Pixmap> {
    ensure!(
        domain
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 1_000_000.0)
            && domain[2] >= 0.001
            && domain[3] >= 0.001,
        "CAPTION_MATERIAL_INVALID: gradient smear domain"
    );
    domain[0] += f64::from(pad);
    domain[1] += f64::from(pad);
    let mut out = Pixmap::new(input.width(), input.height())
        .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: gradient smear surface"))?;
    let edge = |v: f64, max: u32| libm::ceil(v - 0.5).clamp(0.0, f64::from(max)) as u32;
    let invert = |uv: [f32; 2]| {
        if uv_y == MaterialUvY::Up {
            [uv[0], 1.0 - uv[1]]
        } else {
            uv
        }
    };
    for y in edge(domain[1], input.height())..edge(domain[1] + domain[3], input.height()) {
        for x in edge(domain[0], input.width())..edge(domain[0] + domain[2], input.width()) {
            // Charge noise arithmetic even when every texture sample is outside.
            spend(32 + 64 * (libm::ceil(noise.complexity) as u64 + 1))?;
            let uv = invert([
                ((f64::from(x) + 0.5 - domain[0]) / domain[2]) as f32,
                ((f64::from(y) + 0.5 - domain[1]) / domain[3]) as f32,
            ]);
            let displaced = displacement(uv, u, noise);
            ensure!(
                displaced.iter().all(|v| v.is_finite()),
                "CAPTION_MATERIAL_INVALID: gradient smear arithmetic"
            );
            let mut color = [0.0_f32; 4];
            for i in 0..128 {
                spend(1)?;
                let t = i as f32 / 127.0;
                let point = invert(std::array::from_fn(|c| mix(displaced[c], uv[c], t)));
                let pixel = super::angular_samples::sample(input, point, domain, &mut spend)?;
                for c in 0..4 {
                    color[c] += pixel[c];
                }
            }
            let offset = (y as usize * input.width() as usize + x as usize) * 4;
            for c in 0..4 {
                out.data_mut()[offset + c] =
                    libm::floorf((color[c] / 128.0).clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_rgba8_samples_match_the_independent_reference_with_one_byte_tolerance() {
        let data: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/gradient-smear-field.json"
        ))
        .unwrap();
        let w = data["texture"]["width"].as_u64().unwrap() as u32;
        let h = data["texture"]["height"].as_u64().unwrap() as u32;
        let mut input = Pixmap::new(w, h).unwrap();
        for (out, v) in input
            .data_mut()
            .iter_mut()
            .zip(data["texture"]["rgba8"].as_array().unwrap())
        {
            *out = v.as_u64().unwrap() as u8;
        }
        for v in data["cases"].as_array().unwrap() {
            let pair = |key: &str| std::array::from_fn(|i| v[key][i].as_f64().unwrap() as f32);
            let u = Uniforms {
                rect_scale: pair("rectScale"),
                evolution: v["evolution"].as_f64().unwrap() as f32,
                seed: v["seed"].as_f64().unwrap() as f32,
                stretch: v["stretch"].as_f64().unwrap() as f32,
                progress: v["progress"].as_f64().unwrap() as f32,
                strength: pair("strength"),
            };
            let n = serde_json::from_value(v["noise"].clone()).unwrap();
            let y = serde_json::from_value(v["uvY"].clone()).unwrap();
            let actual = apply(
                &input,
                0,
                [0., 0., f64::from(w), f64::from(h)],
                &u,
                &n,
                y,
                |_| Ok(()),
            )
            .unwrap();
            for (i, (a, b)) in actual
                .data()
                .iter()
                .zip(v["outputRgba8"].as_array().unwrap())
                .enumerate()
            {
                assert!(
                    (i64::from(*a) - b.as_i64().unwrap()).abs() <= 1,
                    "{} byte{i}: {a} vs {b}",
                    v["id"]
                );
            }
        }
    }
    #[test]
    fn field_matches_independently_evaluated_scalar_f32_vectors() {
        let cases: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/gradient-smear-field.json"
        ))
        .unwrap();
        for v in cases["cases"].as_array().unwrap() {
            let pair = |key: &str| std::array::from_fn(|i| v[key][i].as_f64().unwrap() as f32);
            let u = Uniforms {
                rect_scale: pair("rectScale"),
                evolution: v["evolution"].as_f64().unwrap() as f32,
                seed: v["seed"].as_f64().unwrap() as f32,
                stretch: v["stretch"].as_f64().unwrap() as f32,
                progress: v["progress"].as_f64().unwrap() as f32,
                strength: pair("strength"),
            };
            let n = serde_json::from_value(v["noise"].clone()).unwrap();
            let actual = displacement(pair("uv"), &u, &n);
            let expected = pair("expected");
            for i in 0..2 {
                assert!(
                    (actual[i] - expected[i]).abs() < 0.00002,
                    "{} axis{i}: {} vs {}",
                    v["id"],
                    actual[i],
                    expected[i]
                );
            }
        }
    }
    #[test]
    fn transparent_samples_keep_fixed_denominator_and_charge_work_before_reading() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../caption-scene/tests/fixtures/gradient-smear.json"
        ))
        .unwrap();
        let mut n: GradientSmearNoise =
            serde_json::from_value(fixture["scene"]["value"]["materials"][0]["noise"].clone())
                .unwrap();
        n.brightness = 1.0;
        n.range = 1.0;
        let u = Uniforms {
            rect_scale: [1.0, 1.0],
            evolution: 0.,
            seed: 3.,
            stretch: 0.,
            progress: 0.7,
            strength: [16., 16.],
        };
        let mut input = Pixmap::new(1, 1).unwrap();
        input.data_mut().copy_from_slice(&[255, 0, 0, 128]);
        let result = apply(
            &input,
            0,
            [0., 0., 1., 1.],
            &u,
            &n,
            MaterialUvY::Down,
            |_| Ok(()),
        )
        .unwrap();
        assert!(
            result.data()[0] > 0 && result.data()[0] < 10,
            "most of 128 samples are transparent"
        );
        assert!(
            result.data()[0] > result.data()[3],
            "independent emissive RGB survives"
        );
        let mut spent = 0;
        let error = apply(
            &input,
            0,
            [0., 0., 1., 1.],
            &u,
            &n,
            MaterialUvY::Down,
            |cost| {
                spent += cost;
                ensure!(spent < 300, "budget");
                Ok(())
            },
        )
        .unwrap_err();
        assert!(error.to_string().contains("budget"));
    }
}
