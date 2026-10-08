//! 预乘 RGBA 的整数 source-over。
//!
//! **逐行搬自** `core/crates/bcut-kernel/src/cmd/studio_export/raster.rs::composite_premultiplied_rgba`。
//! 只遍历 `bounds`：盒外 source 的 alpha 与 RGB 恒为 0（预乘不变式 `rgb ≤ a`），
//! `dst = 0 + dst * 255 / 255 = dst` 是恒等操作，因此跳过与整帧遍历逐字节一致。

use super::blur::ContentBox;

pub fn composite_premultiplied_rgba(
    destination: &mut [u8],
    source: &[u8],
    width: usize,
    bounds: &ContentBox,
) {
    for y in bounds.rows.clone() {
        let start = (y * width + bounds.cols.start) * 4;
        let end = (y * width + bounds.cols.end) * 4;
        composite_premultiplied_row(&mut destination[start..end], &source[start..end]);
    }
}

/// 一段等长像素的 source-over（逐像素同上）；两段缓冲步长不同时按行调用它。
pub fn composite_premultiplied_row(destination: &mut [u8], source: &[u8]) {
    for (destination, source) in destination.chunks_exact_mut(4).zip(source.chunks_exact(4)) {
        let alpha = u16::from(source[3]);
        if alpha == 0 {
            continue;
        }
        let inverse = 255 - alpha;
        for channel in 0..4 {
            destination[channel] = (u16::from(source[channel])
                + u16::from(destination[channel]) * inverse / 255)
                .min(255) as u8;
        }
    }
}
