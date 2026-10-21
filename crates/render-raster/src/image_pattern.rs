//! Bounded premultiplied image sampling in normalized UV coordinates.
//! Wrap and half-texel rules are explicit; callers apply geometry and coverage.
use anyhow::{Result, ensure};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Wrap {
    Clamp,
    Repeat,
    Mirror,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Filter {
    Nearest,
    Bilinear,
}

pub struct Sampler<'a> {
    rgba: &'a [u8],
    width: usize,
    height: usize,
    wrap: Wrap,
    filter: Filter,
}

impl<'a> Sampler<'a> {
    /// Validate once before scanning a paint surface. Pixels are associated
    /// RGBA8, so transparent texels cannot leak unassociated colour at edges.
    pub fn new(rgba: &'a [u8], width: u32, height: u32, wrap: Wrap, filter: Filter) -> Result<Self> {
        let sampler = Self::from_decoded_premultiplied(rgba, width, height, wrap, filter)?;
        ensure!(
            rgba.chunks_exact(4).all(|p| p[..3].iter().all(|c| *c <= p[3])),
            "IMAGE_PATTERN_NOT_PREMULTIPLIED"
        );
        Ok(sampler)
    }

    /// For an immutable PNG decode whose premultiplication is established by
    /// the resource loader. Structural bounds are still checked; colour scanning
    /// is intentionally not repeated in a frame's hot path. Arbitrary byte hosts
    /// must use `new`, which validates the associated-colour invariant.
    pub fn from_decoded_premultiplied(rgba: &'a [u8], width: u32, height: u32, wrap: Wrap, filter: Filter) -> Result<Self> {
        let bytes = u64::from(width)
            .checked_mul(u64::from(height))
            .and_then(|n| n.checked_mul(4))
            .ok_or_else(|| anyhow::anyhow!("IMAGE_PATTERN_RESOURCE_INVALID"))?;
        ensure!(
            width > 0 && height > 0 && bytes <= 64 * 1024 * 1024 && bytes == rgba.len() as u64,
            "IMAGE_PATTERN_RESOURCE_INVALID"
        );
        Ok(Self {
            rgba,
            width: width as usize,
            height: height as usize,
            wrap,
            filter,
        })
    }

    pub fn sample(&self, uv: [f64; 2]) -> Result<[f64; 4]> {
        ensure!(uv.iter().all(|v| v.is_finite()), "IMAGE_PATTERN_COORDINATE_INVALID");
        let axis = |v: f64| match self.wrap {
            Wrap::Clamp => v.clamp(0., 1.),
            Wrap::Repeat => v.rem_euclid(1.),
            Wrap::Mirror => {
                let v = v.rem_euclid(2.);
                if v <= 1. { v } else { 2. - v }
            }
        };
        let u = axis(uv[0]);
        let v = axis(uv[1]);
        if self.filter == Filter::Nearest {
            return Ok(self.texel((u * self.width as f64).floor() as i64, (v * self.height as f64).floor() as i64));
        }
        let x = u * self.width as f64 - 0.5;
        let y = v * self.height as f64 - 0.5;
        let (x0, y0) = (x.floor() as i64, y.floor() as i64);
        let (dx, dy) = (x - x.floor(), y - y.floor());
        let p = [
            self.texel(x0, y0),
            self.texel(x0 + 1, y0),
            self.texel(x0, y0 + 1),
            self.texel(x0 + 1, y0 + 1),
        ];
        Ok(std::array::from_fn(|c| {
            let top = p[0][c] * (1. - dx) + p[1][c] * dx;
            let bottom = p[2][c] * (1. - dx) + p[3][c] * dx;
            top * (1. - dy) + bottom * dy
        }))
    }

    fn texel(&self, x: i64, y: i64) -> [f64; 4] {
        let index = |v: i64, length: usize| match self.wrap {
            Wrap::Repeat => v.rem_euclid(length as i64) as usize,
            // Mirror has already folded UV into 0..1. Its boundary neighbours
            // duplicate the edge texel rather than wrap to the opposite edge.
            Wrap::Clamp | Wrap::Mirror => v.clamp(0, length as i64 - 1) as usize,
        };
        let at = (index(y, self.height) * self.width + index(x, self.width)) * 4;
        std::array::from_fn(|c| f64::from(self.rgba[at + c]) / 255.)
    }
}

/// Sample over a premultiplied base, then apply coverage and glyph opacity once.
/// Image opacity affects the image contribution, including how much base shows.
pub fn over_base(image: [f64; 4], base: [f64; 4], image_opacity: f64, coverage_opacity: f64) -> [u8; 4] {
    let opacity = image_opacity.clamp(0., 1.);
    let alpha = image[3] * opacity;
    let coverage = coverage_opacity.clamp(0., 1.);
    std::array::from_fn(|c| {
        ((image[c] * opacity + base[c] * (1. - alpha)) * coverage * 255.)
            .clamp(0., 255.)
            .round() as u8
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    const PIXELS: [u8; 8] = [255, 0, 0, 255, 0, 0, 128, 128];

    #[test]
    fn half_texel_centres_and_associated_alpha_interpolate_together() {
        let sample = Sampler::new(&PIXELS, 2, 1, Wrap::Clamp, Filter::Bilinear).unwrap();
        assert_eq!(sample.sample([0.25, 0.5]).unwrap(), [1., 0., 0., 1.]);
        assert_eq!(sample.sample([0.75, 0.5]).unwrap(), [0., 0., 128. / 255., 128. / 255.]);
        assert_eq!(sample.sample([0.5, 0.5]).unwrap(), [0.5, 0., 64. / 255., 191.5 / 255.]);
    }

    #[test]
    fn repeat_blends_seam_but_clamp_and_mirror_replicate_edges() {
        let repeat = Sampler::new(&PIXELS, 2, 1, Wrap::Repeat, Filter::Bilinear).unwrap();
        let clamp = Sampler::new(&PIXELS, 2, 1, Wrap::Clamp, Filter::Bilinear).unwrap();
        let mirror = Sampler::new(&PIXELS, 2, 1, Wrap::Mirror, Filter::Bilinear).unwrap();
        assert_eq!(repeat.sample([0., 0.5]).unwrap(), repeat.sample([1., 0.5]).unwrap());
        assert_eq!(repeat.sample([-0.25, 0.5]).unwrap(), repeat.sample([0.75, 0.5]).unwrap());
        assert_eq!(clamp.sample([-8., 0.5]).unwrap(), [1., 0., 0., 1.]);
        assert_eq!(mirror.sample([-0.25, 0.5]).unwrap(), mirror.sample([0.25, 0.5]).unwrap());
        assert_eq!(mirror.sample([1., 0.5]).unwrap(), clamp.sample([1., 0.5]).unwrap());
    }

    #[test]
    fn nearest_and_large_finite_coordinates_are_bounded() {
        let sample = Sampler::new(&PIXELS, 2, 1, Wrap::Repeat, Filter::Nearest).unwrap();
        assert_eq!(sample.sample([0.5, 0.5]).unwrap()[2], 128. / 255.);
        assert_eq!(sample.sample([1e200, -1e200]).unwrap(), [1., 0., 0., 1.]);
        assert!(sample.sample([f64::INFINITY, 0.]).is_err());
    }

    #[test]
    fn base_composition_does_not_apply_edge_coverage_twice() {
        assert_eq!(over_base([0.5, 0., 0., 0.5], [0., 1., 0., 1.], 1., 0.5), [64, 64, 0, 128]);
        assert_eq!(over_base([0.5, 0., 0., 0.5], [0., 1., 0., 1.], 0., 0.5), [0, 128, 0, 128]);
    }

    #[test]
    fn invalid_pixels_and_dimensions_fail_before_sampling() {
        assert!(Sampler::new(&[], 1 << 31, 1 << 31, Wrap::Clamp, Filter::Nearest).is_err());
        assert!(Sampler::from_decoded_premultiplied(&[], u32::MAX, u32::MAX, Wrap::Clamp, Filter::Nearest).is_err());
        assert!(Sampler::new(&PIXELS, 0, 1, Wrap::Clamp, Filter::Nearest).is_err());
        assert!(Sampler::new(&PIXELS, 2, 2, Wrap::Clamp, Filter::Nearest).is_err());
        assert!(Sampler::new(&[255, 0, 0, 0], 1, 1, Wrap::Clamp, Filter::Nearest).is_err());
    }
}
