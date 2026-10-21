//! Bounded, frame-local averaging along a piecewise affine UV path.
//! All four associated components are sampled independently; boundary rejection
//! never invents coverage or clamps RGB to alpha.
use super::{
    Axis, Boundary, ComponentImage, GaussianPass, GaussianSampling, Size, Support, sample,
    taps_in_support,
};
use anyhow::{Result, ensure};

#[derive(Clone, Debug)]
pub struct Config {
    pub sampling: GaussianSampling,
    /// [a,b,c,d,tx,ty]: (a*u+c*v+tx, b*u+d*v+ty).
    pub transforms: Vec<[f64; 6]>,
    pub sample_range: [u32; 2],
    pub distance_range: [f64; 2],
    pub boundary: Boundary,
    pub output: Size,
}
impl Config {
    pub fn validate(&self, input: Size) -> Result<()> {
        ensure!(
            (2..=32).contains(&self.transforms.len())
                && self
                    .transforms
                    .iter()
                    .flatten()
                    .all(|v| v.is_finite() && v.abs() <= 10_000.0),
            "CAPTION_MATERIAL_INVALID: affine UV transforms"
        );
        ensure!(
            self.sample_range[0] >= 2
                && self.sample_range[0] <= self.sample_range[1]
                && self.sample_range[1] <= 256,
            "CAPTION_MATERIAL_INVALID: affine sample range"
        );
        let [lo, hi] = self.distance_range;
        ensure!(
            lo.is_finite() && hi.is_finite() && lo >= 0.0 && hi > lo && hi <= 16.0,
            "CAPTION_MATERIAL_INVALID: affine distance range"
        );
        GaussianPass {
            axis: Axis::X,
            sample_count: 0.0,
            step_pixels: 0.0,
            sigma_pixels: 0.0,
            gamma: None,
            boundary: self.boundary,
            output: self.output,
            spacing_ramp: None,
            sampling: Some(self.sampling),
        }
        .sampling_domains(input)?;
        Ok(())
    }
    fn point(&self, index: usize, uv: [f64; 2]) -> [f64; 2] {
        let [a, b, c, d, tx, ty] = self.transforms[index];
        [a * uv[0] + c * uv[1] + tx, b * uv[0] + d * uv[1] + ty]
    }
    pub fn sample_count(&self, uv: [f64; 2]) -> u32 {
        libm::floor(self.sample_density(uv)) as u32
    }
    /// Continuous canonical density before the discontinuous floor. The caller
    /// must validate the config; GPU admission uses this same f64 decision.
    pub fn sample_density(&self, uv: [f64; 2]) -> f64 {
        let first = self.point(0, uv);
        let last = self.point(self.transforms.len() - 1, uv);
        let distance = libm::hypot(last[0] - first[0], last[1] - first[1]);
        let p = ((distance - self.distance_range[0])
            / (self.distance_range[1] - self.distance_range[0]))
            .clamp(0.0, 1.0);
        let eased = p * p * (3.0 - 2.0 * p);
        self.sample_range[0] as f64 + (self.sample_range[1] - self.sample_range[0]) as f64 * eased
    }
    fn path_point(&self, uv: [f64; 2], index: u32, count: u32) -> [f64; 2] {
        // Explicit endpoints avoid divide/multiply rounding changing the last
        // segment and preserve the inclusive shutter interval.
        if index == 0 {
            return self.point(0, uv);
        }
        if index == count - 1 {
            return self.point(self.transforms.len() - 1, uv);
        }
        let phase = index as f64 / (count - 1) as f64 * (self.transforms.len() - 1) as f64;
        let segment = libm::floor(phase) as usize;
        let p = phase - segment as f64;
        let first = self.point(segment, uv);
        let last = self.point(segment + 1, uv);
        [
            first[0] * (1.0 - p) + last[0] * p,
            first[1] * (1.0 - p) + last[1] * p,
        ]
    }
}

fn roi(config: &Config) -> Option<Support> {
    let d = config.sampling.output;
    let edge = |v: f64, max: u32| libm::ceil(v - 0.5).clamp(0.0, max as f64) as u32;
    let b = Support {
        left: edge(d[0], config.output.width),
        top: edge(d[1], config.output.height),
        right: edge(d[0] + d[2], config.output.width),
        bottom: edge(d[1] + d[3], config.output.height),
    };
    (b.left < b.right && b.top < b.bottom).then_some(b)
}

/// Charges output allocation, imported support scans, profile/sample operations,
/// and the actual nonzero-support texel fetches before any corresponding reads.
/// A failed charge aborts this frame, including on a warmed renderer.
pub fn apply(
    image: &ComponentImage,
    config: &Config,
    mut charge: impl FnMut(u64) -> Result<()>,
) -> Result<ComponentImage> {
    config.validate(image.size())?;
    charge(config.output.pixels()?)?;
    charge(image.support_scan_pixels)?;
    let mut output = ComponentImage::zeroed(config.output)?;
    let Some(bounds) = roi(config) else {
        return Ok(output);
    };
    let Some(support) = image.support else {
        return Ok(output);
    };
    let view = config.sampling.input.map(f64::from);
    let domain = config.sampling.output;
    for y in bounds.top..bounds.bottom {
        for x in bounds.left..bounds.right {
            let uv = [
                (x as f64 + 0.5 - domain[0]) / domain[2],
                (y as f64 + 0.5 - domain[1]) / domain[3],
            ];
            let count = config.sample_count(uv);
            // Endpoint density and each path sample evaluate at most two affine
            // controls; account for arithmetic even if every UV is rejected.
            charge(2 + 3 * u64::from(count))?;
            let mut sum = [0.0; 4];
            let mut weight = 0u32;
            for i in 0..count {
                let q = config.path_point(uv, i, count);
                let inside = q.iter().all(|v| (0.0..=1.0).contains(v));
                if !inside && config.boundary != Boundary::Replicate {
                    if config.boundary == Boundary::Transparent {
                        weight += 1;
                    }
                    continue;
                }
                let q = q.map(|v| v.clamp(0.0, 1.0));
                // Texture edge filtering clamps to this integer ROI, never to
                // adjacent pixels in the larger backing surface.
                let sx = (q[0] * view[2] + view[0] - 0.5).clamp(view[0], view[0] + view[2] - 1.0);
                let sy = (q[1] * view[3] + view[1] - 0.5).clamp(view[1], view[1] + view[3] - 1.0);
                let reads = taps_in_support(sx, image.width(), support.left, support.right)
                    * taps_in_support(sy, image.height(), support.top, support.bottom);
                charge(reads)?;
                let value = sample(image, sx, sy);
                for (acc, v) in sum.iter_mut().zip(value) {
                    *acc += v;
                }
                weight += 1;
            }
            if weight > 0 {
                output.write(x, y, sum.map(|v| v / weight as f64));
            }
        }
    }
    Ok(output)
}
