//! Two samples of the same immutable input, composed foreground over background.
use super::{Axis, Boundary, ComponentImage, GaussianPass, GaussianSampling, Size};
use anyhow::{Result, ensure};

#[derive(Clone, Debug)]
pub struct Config {
    pub sampling: GaussianSampling,
    pub foreground: [f64; 6],
    pub background: [f64; 6],
    pub background_opacity: f64,
    pub background_rgb_scale: f64,
    pub boundary: Boundary,
    pub output: Size,
}
impl Config {
    pub fn validate(&self, input: Size) -> Result<()> {
        ensure!(
            self.foreground
                .iter()
                .chain(&self.background)
                .all(|v| v.is_finite() && v.abs() <= 10_000.)
                && self.background_opacity.is_finite()
                && (0. ..=1.).contains(&self.background_opacity)
                && self.background_rgb_scale.is_finite()
                && (0. ..=1.).contains(&self.background_rgb_scale)
                && self.boundary != Boundary::Normalize,
            "CAPTION_MATERIAL_INVALID: affine over parameters"
        );
        GaussianPass {
            axis: Axis::X,
            sample_count: 0.,
            step_pixels: 0.,
            sigma_pixels: 0.,
            gamma: None,
            boundary: self.boundary,
            output: self.output,
            spacing_ramp: None,
            sampling: Some(self.sampling),
        }
        .sampling_domains(input)?;
        Ok(())
    }
}

pub fn apply(
    image: &ComponentImage,
    config: &Config,
    mut charge: impl FnMut(u64) -> Result<()>,
) -> Result<ComponentImage> {
    config.validate(image.size())?;
    apply_validated(image, config, &mut charge)
}

fn apply_validated(
    image: &ComponentImage,
    config: &Config,
    charge: &mut impl FnMut(u64) -> Result<()>,
) -> Result<ComponentImage> {
    charge(config.output.pixels()?)?;
    charge(image.support_scan_pixels)?;
    let mut output = ComponentImage::zeroed(config.output)?;
    let Some(support) = image.support else {
        return Ok(output);
    };
    let domain = config.sampling.output;
    let edge = |v: f64, max: u32| libm::ceil(v - 0.5).clamp(0., max as f64) as u32;
    let mut bounds = [
        edge(domain[0], config.output.width),
        edge(domain[1], config.output.height),
        edge(domain[0] + domain[2], config.output.width),
        edge(domain[1] + domain[3], config.output.height),
    ];
    charge(16)?; // Conservative corner transforms for both support footprints.
    let foreground = footprint(config, support, config.foreground, bounds);
    let background = footprint(config, support, config.background, bounds);
    bounds = [
        foreground[0].min(background[0]),
        foreground[1].min(background[1]),
        foreground[2].max(background[2]),
        foreground[3].max(background[3]),
    ];
    let [left, top, right, bottom] = bounds;
    let view = config.sampling.input.map(f64::from);
    for y in top..bottom {
        for x in left..right {
            charge(3)?; // Two affine evaluations and one component composition/write.
            let uv = [
                (x as f64 + 0.5 - domain[0]) / domain[2],
                (y as f64 + 0.5 - domain[1]) / domain[3],
            ];
            let mut values = [[0.; 4]; 2];
            for (value, m) in values
                .iter_mut()
                .zip([config.foreground, config.background])
            {
                let q = [
                    m[0] * uv[0] + m[2] * uv[1] + m[4],
                    m[1] * uv[0] + m[3] * uv[1] + m[5],
                ];
                ensure!(
                    q.iter().all(|v| v.is_finite()),
                    "CAPTION_MATERIAL_INVALID: affine over UV"
                );
                if config.boundary == Boundary::Transparent
                    && q.iter().any(|v| !(0. ..=1.).contains(v))
                {
                    continue;
                }
                let q = q.map(|v| v.clamp(0., 1.));
                let sx = (view[0] + q[0] * view[2] - 0.5).clamp(view[0], view[0] + view[2] - 1.);
                let sy = (view[1] + q[1] * view[3] - 0.5).clamp(view[1], view[1] + view[3] - 1.);
                charge(4)?; // Conservative maximum; before any texel reads.
                *value = sample_bytes(image, sx, sy, config.sampling.input);
            }
            let [fg, bg] = values;
            let remainder = 1. - fg[3] / 255.;
            let mut rgba = [0.; 4];
            for c in 0..3 {
                rgba[c] = fg[c]
                    + bg[c] * config.background_opacity * config.background_rgb_scale * remainder;
            }
            rgba[3] = fg[3] + bg[3] * config.background_opacity * remainder;
            let pixel = rgba.map(|v| libm::floor(0.5 + v.clamp(0., 255.)) as u8);
            let offset = (y as usize * output.width() as usize + x as usize) * 4;
            output.data[offset..offset + 4].copy_from_slice(&pixel);
            if pixel.iter().any(|v| *v != 0) {
                super::include(&mut output.support, x, y);
            }
        }
    }
    Ok(output)
}

// Inverse bounds are only a conservative work reduction. Sampling still uses
// the forward matrices; singular/ill-conditioned or edge-replicating cases
// retain the full output domain, never a guessed or clipped texture transform.
fn footprint(config: &Config, support: super::Support, m: [f64; 6], full: [u32; 4]) -> [u32; 4] {
    let [x, y, w, h] = config.sampling.input;
    let l = support.left.max(x);
    let r = support.right.min(x + w);
    let t = support.top.max(y);
    let b = support.bottom.min(y + h);
    if l >= r || t >= b {
        return [full[2], full[3], full[0], full[1]];
    }
    let det = m[0] * m[3] - m[1] * m[2];
    if det.abs() < 1e-4
        || m.iter().any(|v| v.abs() > 64.)
        || config.output.width > 16384
        || config.output.height > 16384
        || (config.boundary == Boundary::Replicate
            && (l == x || r == x + w || t == y || b == y + h))
    {
        return full;
    }
    let lo = [
        ((l as f64 - x as f64 - 0.5) / w as f64).max(0.),
        ((t as f64 - y as f64 - 0.5) / h as f64).max(0.),
    ];
    let hi = [
        ((r as f64 - x as f64 + 0.5) / w as f64).min(1.),
        ((b as f64 - y as f64 + 0.5) / h as f64).min(1.),
    ];
    let d = config.sampling.output;
    let mut min = [f64::INFINITY; 2];
    let mut max = [f64::NEG_INFINITY; 2];
    for qx in [lo[0], hi[0]] {
        for qy in [lo[1], hi[1]] {
            let a = qx - m[4];
            let b = qy - m[5];
            let p = [
                d[0] + d[2] * (m[3] * a - m[2] * b) / det,
                d[1] + d[3] * (-m[1] * a + m[0] * b) / det,
            ];
            if p.iter().any(|v| !v.is_finite()) {
                return full;
            }
            for axis in 0..2 {
                min[axis] = min[axis].min(p[axis]);
                max[axis] = max[axis].max(p[axis]);
            }
        }
    }
    // Two extra output pixels protect the closed UV endpoints and floating
    // inverse-bound rounding. They affect work only, not any forward sample.
    [
        libm::floor(min[0] - 2.).clamp(full[0] as f64, full[2] as f64) as u32,
        libm::floor(min[1] - 2.).clamp(full[1] as f64, full[3] as f64) as u32,
        libm::ceil(max[0] + 2.).clamp(full[0] as f64, full[2] as f64) as u32,
        libm::ceil(max[1] + 2.).clamp(full[1] as f64, full[3] as f64) as u32,
    ]
}

// Keep interpolation and composition in byte-valued f64 until the final write.
// Normalizing samples and multiplying by 255 again changes half-byte thresholds.
pub(super) fn sample_bytes(image: &ComponentImage, x: f64, y: f64, roi: [u32; 4]) -> [f64; 4] {
    let x0 = libm::floor(x) as u32;
    let y0 = libm::floor(y) as u32;
    let x1 = (x0 + 1).min(roi[0] + roi[2] - 1);
    let y1 = (y0 + 1).min(roi[1] + roi[3] - 1);
    let fx = x - x0 as f64;
    let fy = y - y0 as f64;
    std::array::from_fn(|c| {
        let at = |px: u32, py: u32| {
            image.data[((py as usize * image.width() as usize + px as usize) * 4) + c] as f64
        };
        let top = (1. - fx) * at(x0, y0) + fx * at(x1, y0);
        let bottom = (1. - fx) * at(x0, y1) + fx * at(x1, y1);
        (1. - fy) * top + fy * bottom
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config(w: u32, h: u32) -> Config {
        Config {
            sampling: GaussianSampling {
                input: [0, 0, w, h],
                output: [0., 0., w as f64, h as f64],
            },
            foreground: [1., 0., 0., 1., 0., 0.],
            background: [1., 0., 0., 1., 0., 0.],
            background_opacity: 0.5,
            background_rgb_scale: 1.,
            boundary: Boundary::Transparent,
            output: Size {
                width: w,
                height: h,
            },
        }
    }
    #[test]
    fn associated_components_and_background_attenuation_are_independent() {
        let input = ComponentImage::new(1, 1, vec![128, 64, 32, 128]).unwrap();
        let mut c = config(1, 1);
        assert_eq!(
            apply(&input, &c, |_| Ok(())).unwrap().data(),
            &[160, 80, 40, 160]
        );
        c.background_rgb_scale = 0.25;
        assert_eq!(
            apply(&input, &c, |_| Ok(())).unwrap().data(),
            &[136, 68, 34, 160]
        );
        let emission = ComponentImage::new(1, 1, vec![255, 80, 40, 0]).unwrap();
        c.background_opacity = 1.;
        c.background_rgb_scale = 1.;
        assert_eq!(
            apply(&emission, &c, |_| Ok(())).unwrap().data(),
            &[255, 160, 80, 0]
        );
    }
    #[test]
    fn half_byte_alpha_threshold_is_not_shifted_by_unit_normalization() {
        let input = ComponentImage::new(1, 1, vec![70, 70, 70, 70]).unwrap();
        let mut c = config(1, 1);
        c.foreground[4] = 2.;
        c.background_opacity = 0.35;
        c.background_rgb_scale = 0.65;
        assert_eq!(
            apply(&input, &c, |_| Ok(())).unwrap().data(),
            &[16, 16, 16, 25]
        );
    }
    #[test]
    fn translated_foreground_composites_over_background_and_boundary_is_explicit() {
        let input = ComponentImage::new(2, 1, vec![255, 0, 0, 255, 0, 128, 0, 128]).unwrap();
        let mut c = config(2, 1);
        c.background_opacity = 1.;
        c.foreground[4] = 0.5;
        assert_eq!(
            apply(&input, &c, |_| Ok(())).unwrap().data(),
            &[127, 128, 0, 255, 0, 128, 0, 128]
        );
        c.boundary = Boundary::Replicate;
        assert_eq!(
            apply(&input, &c, |_| Ok(())).unwrap().data(),
            &[127, 128, 0, 255, 0, 192, 0, 192]
        );
    }
    #[test]
    fn roi_edges_never_read_adjacent_pixels_and_fractional_output_is_clipped() {
        let input =
            ComponentImage::new(3, 1, vec![255, 0, 0, 255, 0, 64, 0, 64, 0, 0, 255, 255]).unwrap();
        let mut c = config(3, 1);
        c.background_opacity = 0.;
        c.sampling.input = [1, 0, 1, 1];
        assert_eq!(
            apply(&input, &c, |_| Ok(())).unwrap().data(),
            &[0, 64, 0, 64, 0, 64, 0, 64, 0, 64, 0, 64]
        );
        c.sampling.output = [0.6, 0., 1., 1.];
        assert_eq!(
            apply(&input, &c, |_| Ok(())).unwrap().data(),
            &[0, 0, 0, 0, 0, 64, 0, 64, 0, 0, 0, 0]
        );
    }
    #[test]
    fn sparse_footprints_preserve_dense_forward_pixels_across_affine_and_edge_cases() {
        let mut data = vec![0; 64 * 48 * 4];
        for (x, y, v) in [
            (30usize, 22usize, [200, 30, 80, 0]),
            (31, 23, [40, 80, 20, 120]),
            (32, 24, [255, 200, 80, 255]),
        ] {
            data[(y * 64 + x) * 4..(y * 64 + x + 1) * 4].copy_from_slice(&v);
        }
        let input = ComponentImage::new(64, 48, data).unwrap();
        let mut dense = input.clone();
        dense.support = Some(super::super::Support {
            left: 0,
            top: 0,
            right: 64,
            bottom: 48,
        });
        for boundary in [Boundary::Transparent, Boundary::Replicate] {
            for m in [
                [1., 0., 0., 1., 0., 0.],
                [0.5, 0., 0., 0.5, 0.25, 0.25],
                [0., 1., -1., 0., 1., 0.],
                [-1., 0., 0., 1., 1., 0.],
                [1., 0.3, 0.2, 1., -0.1, 0.],
                [0., 0., 0., 0., 0.5, 0.5],
                [0.0001, 0., 0., 0.0001, 0.5, 0.5],
                [65., 0., 0., 65., -32., -32.],
            ] {
                let mut c = config(64, 48);
                c.boundary = boundary;
                c.background = m;
                let sparse = apply(&input, &c, |_| Ok(())).unwrap();
                let full = apply(&dense, &c, |_| Ok(())).unwrap();
                assert_eq!(sparse.data(), full.data(), "{boundary:?} {m:?}");
            }
        }
        let c = config(64, 48);
        let mut sparse_work = 0;
        let mut dense_work = 0;
        apply(&input, &c, |n| {
            sparse_work += n;
            Ok(())
        })
        .unwrap();
        apply(&dense, &c, |n| {
            dense_work += n;
            Ok(())
        })
        .unwrap();
        assert!(
            sparse_work * 2 < dense_work,
            "sparse work {sparse_work} vs {dense_work}"
        );
    }
    #[test]
    fn invalid_parameters_and_budget_refusal_cannot_return_partial_success() {
        let input = ComponentImage::new(1, 1, vec![40, 20, 10, 80]).unwrap();
        for alter in [0, 1, 2, 3, 4] {
            let mut c = config(1, 1);
            match alter {
                0 => c.foreground[0] = f64::NAN,
                1 => c.background_opacity = 1.01,
                2 => c.boundary = Boundary::Normalize,
                3 => c.sampling.input = [1, 0, 1, 1],
                _ => c.sampling.output[2] = 0.,
            };
            assert!(apply(&input, &c, |_| Ok(())).is_err());
        }
        let c = config(1, 1);
        let mut charged = 0;
        assert!(
            apply(&input, &c, |n| {
                charged += n;
                anyhow::ensure!(charged <= 5, "CAPTION_BUDGET_EXCEEDED");
                Ok(())
            })
            .is_err()
        );
        assert_eq!(apply(&input, &c, |_| Ok(())).unwrap().data().len(), 4);
    }
}
