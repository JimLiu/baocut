//! Gaussian taps along an explicit two-dimensional normalized-UV vector.
use super::{
    Axis, Boundary, ComponentImage, GaussianPass, GaussianSampling, Size, gaussian_weights,
};
use anyhow::{Result, ensure};
#[derive(Clone, Debug)]
pub struct Config {
    pub sampling: GaussianSampling,
    pub samples: f64,
    pub step_uv: [f64; 2],
    pub sigma_uv: f64,
    pub rgb_gain: f64,
    pub boundary: Boundary,
    pub output: Size,
}
impl Config {
    fn pass(&self) -> GaussianPass {
        GaussianPass {
            axis: Axis::X,
            sample_count: self.samples,
            step_pixels: libm::hypot(self.step_uv[0], self.step_uv[1]),
            sigma_pixels: self.sigma_uv,
            gamma: None,
            boundary: self.boundary,
            output: self.output,
            spacing_ramp: None,
            sampling: Some(self.sampling),
        }
    }
    pub fn validate(&self, input: Size) -> Result<()> {
        ensure!(
            self.step_uv.iter().all(|v| v.is_finite() && v.abs() <= 1.)
                && self.sigma_uv.is_finite()
                && (0. ..=16.).contains(&self.sigma_uv)
                && self.rgb_gain.is_finite()
                && (0. ..=10.).contains(&self.rgb_gain),
            "CAPTION_MATERIAL_INVALID: Gaussian UV parameters"
        );
        self.pass().sampling_domains(input)?;
        Ok(())
    }
}
pub fn apply(
    image: &ComponentImage,
    c: &Config,
    mut charge: impl FnMut(u64) -> Result<()>,
) -> Result<ComponentImage> {
    c.validate(image.size())?;
    charge(c.output.pixels()?)?;
    charge(image.support_scan_pixels)?;
    let mut out = ComponentImage::zeroed(c.output)?;
    charge(libm::floor(c.samples) as u64 * 4)?;
    let weights = gaussian_weights(c.pass())?;
    let Some(support) = image.support else {
        return Ok(out);
    };
    let d = c.sampling.output;
    let view = c.sampling.input.map(f64::from);
    let edge = |v: f64, max: u32| libm::ceil(v - 0.5).clamp(0., max as f64) as u32;
    let mut bounds = [
        edge(d[0], c.output.width),
        edge(d[1], c.output.height),
        edge(d[0] + d[2], c.output.width),
        edge(d[1] + d[3], c.output.height),
    ];
    let l = (support.left as f64).max(view[0]);
    let r = (support.right as f64).min(view[0] + view[2]);
    let t = (support.top as f64).max(view[1]);
    let b = (support.bottom as f64).min(view[1] + view[3]);
    if l >= r || t >= b {
        return Ok(out);
    }
    // Forward taps can only reach this support dilated by the maximum UV step.
    // Replication at a supported ROI edge may extend indefinitely; keep full
    // work bounds in that case. Extra output pixels protect rounding only.
    charge(8)?;
    if c.boundary != Boundary::Replicate
        || (l > view[0] && r < view[0] + view[2] && t > view[1] && b < view[1] + view[3])
    {
        let radius = c.step_uv.map(|v| v.abs() * weights.len() as f64);
        let lo = [
            (l - view[0] - 0.5) / view[2] - radius[0],
            (t - view[1] - 0.5) / view[3] - radius[1],
        ];
        let hi = [
            (r - view[0] + 0.5) / view[2] + radius[0],
            (b - view[1] + 0.5) / view[3] + radius[1],
        ];
        bounds = [
            libm::floor(d[0] + lo[0] * d[2] - 2.).clamp(bounds[0] as f64, bounds[2] as f64) as u32,
            libm::floor(d[1] + lo[1] * d[3] - 2.).clamp(bounds[1] as f64, bounds[3] as f64) as u32,
            libm::ceil(d[0] + hi[0] * d[2] + 2.).clamp(bounds[0] as f64, bounds[2] as f64) as u32,
            libm::ceil(d[1] + hi[1] * d[3] + 2.).clamp(bounds[1] as f64, bounds[3] as f64) as u32,
        ];
    }
    for y in bounds[1]..bounds[3] {
        for x in bounds[0]..bounds[2] {
            let uv = [
                (x as f64 + 0.5 - d[0]) / d[2],
                (y as f64 + 0.5 - d[1]) / d[3],
            ];
            let mut sum = [0.; 4];
            let mut denominator = 0.;
            for (offset, weight) in std::iter::once(([0., 0.], 1.)).chain(
                weights.iter().enumerate().flat_map(|(i, w)| {
                    let n = (i + 1) as f64;
                    [
                        ([-n * c.step_uv[0], -n * c.step_uv[1]], *w),
                        ([n * c.step_uv[0], n * c.step_uv[1]], *w),
                    ]
                }),
            ) {
                charge(1)?;
                let q = [uv[0] + offset[0], uv[1] + offset[1]];
                let inside = q.iter().all(|v| (0. ..=1.).contains(v));
                if !inside && c.boundary != Boundary::Replicate {
                    if c.boundary == Boundary::Transparent {
                        denominator += weight;
                    }
                    continue;
                }
                let q = q.map(|v| v.clamp(0., 1.));
                let sx = (view[0] + q[0] * view[2] - 0.5).clamp(view[0], view[0] + view[2] - 1.);
                let sy = (view[1] + q[1] * view[3] - 0.5).clamp(view[1], view[1] + view[3] - 1.);
                charge(4)?;
                let rgba = super::affine_over::sample_bytes(image, sx, sy, c.sampling.input);
                for k in 0..4 {
                    sum[k] += rgba[k] * weight;
                }
                denominator += weight;
            }
            if denominator > 0. {
                let pixel = std::array::from_fn::<_, 4, _>(|k| {
                    libm::floor(
                        0.5 + (sum[k] / denominator * if k == 3 { 1. } else { c.rgb_gain })
                            .clamp(0., 255.),
                    ) as u8
                });
                let i = (y as usize * out.width() as usize + x as usize) * 4;
                out.data[i..i + 4].copy_from_slice(&pixel);
                if pixel.iter().any(|v| *v != 0) {
                    super::include(&mut out.support, x, y);
                }
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> Config {
        Config {
            sampling: GaussianSampling {
                input: [0, 0, 3, 3],
                output: [0., 0., 3., 3.],
            },
            samples: 1.,
            step_uv: [1. / 3., 1. / 3.],
            sigma_uv: libm::sqrt(2.) / 3.,
            rgb_gain: 1.,
            boundary: Boundary::Normalize,
            output: Size {
                width: 3,
                height: 3,
            },
        }
    }
    #[test]
    fn diagonal_weights_and_boundary_denominators_keep_rgb_and_alpha_separate() {
        let mut bytes = vec![0; 36];
        bytes[16..20].copy_from_slice(&[128, 64, 0, 64]);
        let input = ComponentImage::new(3, 3, bytes).unwrap();
        let mut c = config();
        let n = apply(&input, &c, |_| Ok(())).unwrap();
        assert_eq!(&n.data()[0..4], &[48, 24, 0, 24]);
        assert_eq!(&n.data()[16..20], &[58, 29, 0, 29]);
        c.boundary = Boundary::Transparent;
        let n = apply(&input, &c, |_| Ok(())).unwrap();
        assert_eq!(&n.data()[0..4], &[35, 18, 0, 18]);
        c.rgb_gain = 2.;
        let n = apply(&input, &c, |_| Ok(())).unwrap();
        assert_eq!(&n.data()[16..20], &[116, 58, 0, 29]);
    }
    #[test]
    fn zero_taps_roi_and_emission_are_not_normalized_away() {
        let mut data = vec![255; 36];
        data[16..20].copy_from_slice(&[80, 20, 0, 0]);
        let image = ComponentImage::new(3, 3, data).unwrap();
        let mut c = config();
        c.samples = 0.9;
        c.sigma_uv = 0.;
        c.sampling.input = [1, 1, 1, 1];
        c.rgb_gain = 0.5;
        assert!(
            apply(&image, &c, |_| Ok(()))
                .unwrap()
                .data()
                .chunks_exact(4)
                .all(|p| p == [40, 10, 0, 0])
        );
    }
    #[test]
    fn bad_values_and_work_budget_fail_before_returning_an_image() {
        let image = ComponentImage::new(3, 3, vec![0; 36]).unwrap();
        let mut c = config();
        c.sigma_uv = 0.;
        assert!(apply(&image, &c, |_| Ok(())).is_err());
        c = config();
        c.step_uv[0] = 1.01;
        assert!(apply(&image, &c, |_| Ok(())).is_err());
        c = config();
        c.samples = f64::NAN;
        assert!(apply(&image, &c, |_| Ok(())).is_err());
        c = config();
        let mut work = 0;
        assert!(
            apply(&image, &c, |n| {
                work += n;
                anyhow::ensure!(work <= 20, "CAPTION_BUDGET_EXCEEDED");
                Ok(())
            })
            .is_err()
        );
    }
}
