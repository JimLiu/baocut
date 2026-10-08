//! Alpha 阈值（`filter.alphaThreshold@1`）。
//!
//! `softness = 0` 是硬二值化；`softness > 0` 时在
//! `[threshold - softness, threshold + softness]` 内线性过渡。
//! 覆盖率乘在预乘四通道上。

use super::mask_shape::multiply_pixel_coverage;

pub fn alpha_threshold(data: &mut [u8], threshold: f64, softness: f64) {
    let threshold = threshold.clamp(0.0, 1.0);
    let softness = softness.clamp(0.0, 1.0);
    for pixel in data.chunks_exact_mut(4) {
        let alpha = f64::from(pixel[3]) / 255.0;
        if alpha <= 0.0 {
            continue;
        }
        let coverage = if softness <= 0.0 {
            if alpha >= threshold { 1.0 } else { 0.0 }
        } else {
            ((alpha - (threshold - softness)) / (2.0 * softness)).clamp(0.0, 1.0)
        };
        if coverage < 1.0 {
            multiply_pixel_coverage(pixel, coverage);
        }
    }
}
