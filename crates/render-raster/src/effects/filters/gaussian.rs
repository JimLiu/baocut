//! Separable Gaussian blur of premultiplied RGBA8 with transparent borders.
//!
//! Used by caption paint layers whose blur is a standard deviation in pixels,
//! including fractional values that an integer box radius cannot express.
//! Taps cover ±ceil(3σ); weights are normalised over that support, the
//! horizontal pass keeps f32 intermediates and the vertical pass rounds once.

/// Below this σ the kernel is effectively a single tap.
pub const MIN_SIGMA: f64 = 0.25;
/// Structural cap on the kernel half-width (σ ≤ 256 px).
pub const MAX_RADIUS: usize = 768;

pub fn kernel(sigma: f64) -> Vec<f32> {
    let radius = ((3.0 * sigma).ceil() as usize).clamp(1, MAX_RADIUS);
    let denominator = 2.0 * sigma * sigma;
    let raw: Vec<f64> = (0..=radius)
        .map(|i| libm::exp(-((i * i) as f64) / denominator))
        .collect();
    let total = raw[0] + 2.0 * raw[1..].iter().sum::<f64>();
    raw.iter().map(|w| (w / total) as f32).collect()
}

/// Blur `data` (premultiplied RGBA8, `width × height`) in place.
pub fn gaussian_blur_premul_u8(data: &mut [u8], width: u32, height: u32, sigma: f64) {
    let (w, h) = (width as usize, height as usize);
    if !sigma.is_finite() || sigma < MIN_SIGMA || w == 0 || h == 0 || data.len() != w * h * 4 {
        return;
    }
    let weights = kernel(sigma);
    let radius = weights.len() - 1;
    let mut rows = vec![0f32; w * h * 4];
    for y in 0..h {
        let line = &data[y * w * 4..(y + 1) * w * 4];
        let out = &mut rows[y * w * 4..(y + 1) * w * 4];
        for x in 0..w {
            let mut acc = [0f32; 4];
            let lo = x.saturating_sub(radius);
            let hi = (x + radius).min(w - 1);
            for sx in lo..=hi {
                let weight = weights[sx.abs_diff(x)];
                let px = &line[sx * 4..sx * 4 + 4];
                for c in 0..4 {
                    acc[c] += weight * f32::from(px[c]);
                }
            }
            out[x * 4..x * 4 + 4].copy_from_slice(&acc);
        }
    }
    for x in 0..w {
        for y in 0..h {
            let mut acc = [0f32; 4];
            let lo = y.saturating_sub(radius);
            let hi = (y + radius).min(h - 1);
            for sy in lo..=hi {
                let weight = weights[sy.abs_diff(y)];
                let px = &rows[(sy * w + x) * 4..(sy * w + x) * 4 + 4];
                for c in 0..4 {
                    acc[c] += weight * px[c];
                }
            }
            let alpha = acc[3].round().clamp(0.0, 255.0);
            let out = &mut data[(y * w + x) * 4..(y * w + x) * 4 + 4];
            for c in 0..3 {
                // Rounding each channel separately must not break premultiplication.
                out[c] = acc[c].round().clamp(0.0, alpha) as u8;
            }
            out[3] = alpha as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kernel_is_normalised_and_symmetric() {
        for sigma in [0.6, 1.0, 2.5, 7.3] {
            let k = kernel(sigma);
            let total = k[0] + 2.0 * k[1..].iter().sum::<f32>();
            assert!((total - 1.0).abs() < 1e-5, "σ {sigma}: {total}");
            assert!(k.windows(2).all(|w| w[0] >= w[1]));
        }
    }

    #[test]
    fn blur_preserves_mass_and_premultiplication() {
        let (w, h) = (41u32, 41u32);
        let mut data = vec![0u8; (w * h * 4) as usize];
        let center = ((20 * w + 20) * 4) as usize;
        data[center..center + 4].copy_from_slice(&[200, 100, 50, 255]);
        gaussian_blur_premul_u8(&mut data, w, h, 3.0);
        let alpha: u32 = data.chunks_exact(4).map(|p| u32::from(p[3])).sum();
        assert!((alpha as i64 - 255).abs() < 40, "alpha mass {alpha}");
        assert!(data.chunks_exact(4).all(|p| p[0] <= p[3] && p[1] <= p[3] && p[2] <= p[3]));
        // Symmetric spread around the source pixel.
        let at = |x: u32, y: u32| data[((y * w + x) * 4 + 3) as usize];
        assert_eq!(at(17, 20), at(23, 20));
        assert_eq!(at(20, 17), at(20, 23));
        assert!(at(20, 20) > at(23, 20));
    }

    #[test]
    fn tiny_sigma_is_identity() {
        let mut data = vec![9u8, 8, 7, 255, 0, 0, 0, 0];
        let copy = data.clone();
        gaussian_blur_premul_u8(&mut data, 2, 1, 0.1);
        assert_eq!(data, copy);
    }
}
