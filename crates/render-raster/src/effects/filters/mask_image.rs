//! 图像遮罩（`mask.image@1` / `mask.luma@1`）。
//!
//! 第二个输入的 alpha 或亮度作为覆盖率，尺寸必须与主输入一致。
//! 覆盖率乘在预乘四通道上。

use super::color_adjust::LUMA;
use super::mask_shape::multiply_pixel_coverage;
use anyhow::{Result, bail};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaskChannel {
    Alpha,
    Luminance,
}

pub fn image_mask(data: &mut [u8], mask: &[u8], channel: MaskChannel, invert: bool) -> Result<()> {
    if data.len() != mask.len() {
        bail!(
            "effect-input-mismatch: mask 缓冲 {} 字节，输入 {} 字节",
            mask.len(),
            data.len()
        );
    }
    for (pixel, mask_pixel) in data.chunks_exact_mut(4).zip(mask.chunks_exact(4)) {
        let mask_alpha = f64::from(mask_pixel[3]) / 255.0;
        let coverage = match channel {
            MaskChannel::Alpha => mask_alpha,
            MaskChannel::Luminance => {
                if mask_alpha <= 0.0 {
                    0.0
                } else {
                    (f64::from(mask_pixel[0]) / mask_alpha * LUMA[0]
                        + f64::from(mask_pixel[1]) / mask_alpha * LUMA[1]
                        + f64::from(mask_pixel[2]) / mask_alpha * LUMA[2])
                        / 255.0
                }
            }
        };
        let coverage = if invert { 1.0 - coverage } else { coverage };
        multiply_pixel_coverage(pixel, coverage);
    }
    Ok(())
}
