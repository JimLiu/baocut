//! 水平进度擦除（`mask.progress@1`）。
//!
//! **逐行搬自** `core/crates/bcut-kernel/src/cmd/studio_export/raster.rs::apply_horizontal_reveal`：
//! `boundary = progress × width`，`coverage = clamp(boundary - x, 0, 1)`——
//! 边界像素因此得到一条一像素宽的线性过渡带。

use super::mask_shape::multiply_pixel_coverage;

pub fn horizontal_reveal(data: &mut [u8], width: u32, height: u32, reveal: f64) {
    let pixmap_width = width as usize;
    let boundary = reveal.clamp(0.0, 1.0) * f64::from(width);
    for y in 0..height as usize {
        for x in 0..pixmap_width {
            let coverage = (boundary - x as f64).clamp(0.0, 1.0);
            let offset = (y * pixmap_width + x) * 4;
            multiply_pixel_coverage(&mut data[offset..offset + 4], coverage);
        }
    }
}

/// `invert: true` 的形态：从右往左露出。
pub fn horizontal_reveal_inverted(data: &mut [u8], width: u32, height: u32, reveal: f64) {
    let pixmap_width = width as usize;
    let boundary = (1.0 - reveal.clamp(0.0, 1.0)) * f64::from(width);
    for y in 0..height as usize {
        for x in 0..pixmap_width {
            let coverage = (x as f64 + 1.0 - boundary).clamp(0.0, 1.0);
            let offset = (y * pixmap_width + x) * 4;
            multiply_pixel_coverage(&mut data[offset..offset + 4], coverage);
        }
    }
}
