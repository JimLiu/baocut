//! `transition.slide@1`：两张画面一起朝 `direction` 推走一整屏。
//!
//! 每个输出像素是**整像素拷贝**（没有混合、没有重采样），因此这条转场在
//! 任何 progress 上都不引入新颜色，端点自然逐字节等于输入。

use super::Direction;

pub fn slide(
    from: &[u8],
    to: &[u8],
    out: &mut [u8],
    width: u32,
    height: u32,
    direction: Direction,
    progress: f64,
) {
    let progress = progress.clamp(0.0, 1.0);
    let span = if direction.is_horizontal() {
        f64::from(width)
    } else {
        f64::from(height)
    };
    // 位移取整：整像素拷贝的前提。
    let shift = (progress * span).round() as i64;
    let (w, h) = (width as i64, height as i64);

    for y in 0..h {
        for x in 0..w {
            // `u` 是沿推进方向的坐标，`span_i` 是该轴长度。
            let (u, span_i) = match direction {
                Direction::Left => (x, w),
                Direction::Right => (w - 1 - x, w),
                Direction::Up => (y, h),
                Direction::Down => (h - 1 - y, h),
            };
            let out_offset = ((y * w + x) * 4) as usize;
            // 前 `span − shift` 列还是离场画面（整体前移 shift），其后是入场画面。
            let (source, source_u) = if u < span_i - shift {
                (from, u + shift)
            } else {
                (to, u - (span_i - shift))
            };
            let (sx, sy) = match direction {
                Direction::Left => (source_u, y),
                Direction::Right => (w - 1 - source_u, y),
                Direction::Up => (x, source_u),
                Direction::Down => (x, h - 1 - source_u),
            };
            let source_offset = ((sy * w + sx) * 4) as usize;
            out[out_offset..out_offset + 4]
                .copy_from_slice(&source[source_offset..source_offset + 4]);
        }
    }
}
