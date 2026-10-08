//! Box blur 的 CPU 参考实现。
//!
//! 最初逐行搬自 `core/crates/bcut-kernel/src/cmd/studio_export/raster.rs`（`box_blur_rgba`、
//! `box_blur_rgba_bounded`、`box_blur_rgba_content`）与 `render_plan.rs`
//! （`alpha_bbox`）。位精确是硬要求：`studio_export` 的导出像素夹具钉着它。
//! 之后为预览提速改了遍历顺序（纵向一遍改行主序）、除法（定点倒数）与包围盒
//! 扫描（只扫左右边距），不再是逐行搬运；逐字节相同由本文件单测对拍原实现
//! 保证（倒数除法穷举全部取值）。
//!
//! 语义要点（进 `filter.blur@1` 的 manifest）：单遍可分离 box、u8 整数
//! **截断**除法（不是四舍五入）、作用在**预乘 sRGB**、边缘按窗口收缩
//! （除数变小）而不是补零。

use std::ops::Range;

/// 模糊半径的结构性上限。滑动窗口是 O(1)/像素，半径本身不增加计算量，这个上限
/// 只是挡住手写 JSON 的病态值把局部拷贝的边距（`radius * 2`）撑到整幅之外。
/// 4K + 面板最大 glow（0.9·fontSize）也远在其内。
pub const MAX_BLUR_RADIUS: usize = 256;

/// 非零内容的行/列包围盒（半开区间）。
#[derive(Debug, Clone, PartialEq)]
pub struct ContentBox {
    pub rows: Range<usize>,
    pub cols: Range<usize>,
}

/// 非零 alpha 的行/列包围盒（半开区间）。缓冲是预乘 RGBA，任何通道非零都
/// 蕴含 alpha 非零，因此按字节找非零即可。返回 `None` 表示整帧透明。
pub fn alpha_bbox(rgba: &[u8], width: usize, height: usize) -> Option<ContentBox> {
    alpha_bbox_within(
        rgba,
        width,
        height,
        &ContentBox {
            rows: 0..height,
            cols: 0..width,
        },
    )
}

/// [`alpha_bbox`] 的**限定窗口**形态：只扫 `window` 覆盖的行列。
///
/// 调用方常常已经知道内容画在哪（字幕的布局几何、元素的仿射盒），全帧扫描
/// 纯属浪费——1080p 的透明 overlay 每次扫描要读满 8.3MB。契约是：
/// **`window` 必须是非零像素的超集**。满足这一条时返回值与
/// [`alpha_bbox`] 逐字段相同（窗口只是缩小搜索范围，不改变答案）；不满足时
/// 结果会被窗口裁掉，因此窗口只能由「画了什么」的几何上界推出来，不能猜。
pub fn alpha_bbox_within(
    rgba: &[u8],
    width: usize,
    height: usize,
    window: &ContentBox,
) -> Option<ContentBox> {
    let row_bytes = width * 4;
    let row_start = window.rows.start;
    let row_end = window.rows.end.min(height);
    let col_start = window.cols.start;
    let col_end = window.cols.end.min(width);
    if row_start >= row_end || col_start >= col_end {
        return None;
    }
    let row = |y: usize| &rgba[y * row_bytes + col_start * 4..y * row_bytes + col_end * 4];
    // 先从两头找非零行，再只扫每行落在当前左右界**之外**的那一截：盒子只会
    // 变大，中间段不必重看。与逐行全扫取 min/max 的结果相同。
    let min_row = (row_start..row_end).find(|&y| !bytes_are_zero(row(y)))?;
    let max_row = (min_row..row_end)
        .rev()
        .find(|&y| !bytes_are_zero(row(y)))
        .unwrap_or(min_row);
    let span = col_end - col_start;
    let mut first = span; // 相对 col_start 的最左非零像素
    let mut last: Option<usize> = None; // 相对 col_start 的最右非零像素
    for y in min_row..=max_row {
        let pixels = row(y);
        if let Some(x) = pixels[..first * 4]
            .chunks_exact(4)
            .position(|pixel| pixel != [0, 0, 0, 0])
        {
            first = x;
        }
        let from = last.map_or(0, |x| x + 1);
        if let Some(x) = pixels[from * 4..]
            .chunks_exact(4)
            .rposition(|pixel| pixel != [0, 0, 0, 0])
        {
            last = Some(from + x);
        }
        if first == 0 && last == Some(span - 1) {
            break;
        }
    }
    let last = last?;
    Some(ContentBox {
        rows: min_row..max_row + 1,
        cols: col_start + first..col_start + last + 1,
    })
}

/// 整段字节是否全为 0。按 64 字节一块做按位或再判零，比逐字节 `all` 少分支。
fn bytes_are_zero(bytes: &[u8]) -> bool {
    bytes
        .chunks(64)
        .all(|block| block.iter().fold(0_u8, |acc, &byte| acc | byte) == 0)
}

/// `n / d` 的定点倒数：对 `d ≤ 2·MAX_BLUR_RADIUS + 1`、`n ≤ 255·d`（box 窗口
/// 里 `d` 个 u8 之和的上界），`(n · reciprocal(d)) >> 32` 与整数截断除法逐值
/// 相同（误差项 `n / 2³² < 1 / d`；单测穷举全部 (n, d)）。
fn reciprocal(divisor: u32) -> u64 {
    (1_u64 << 32) / u64::from(divisor) + 1
}

fn divide(sum: u32, reciprocal: u64) -> u8 {
    ((u64::from(sum) * reciprocal) >> 32) as u8
}

/// 整幅预乘 RGBA 的单遍可分离 box blur。
///
/// 两遍都按行主序走内存：横向一遍四个通道共用一个窗口，纵向一遍对整行维护
/// `width × 4` 个滑动和。每个 (像素, 通道) 的求和顺序、加减项与除数都与逐列
/// 实现相同，只是换了遍历顺序，除法换成逐值相同的定点倒数，因此逐字节一致
/// （单测对拍逐列参考实现）。
pub fn box_blur_premul_u8(data: &mut [u8], width: u32, height: u32, radius: usize) {
    let width = width as usize;
    let height = height as usize;
    let radius = radius.min(MAX_BLUR_RADIUS);
    if radius == 0 || width == 0 || height == 0 {
        return;
    }
    let row_bytes = width * 4;
    // 窗口大小只有 1..=2·radius+1 这几种，倒数先算成表。
    let reciprocals: Vec<u64> = (0..=2 * radius as u32 + 1)
        .map(|count| if count == 0 { 0 } else { reciprocal(count) })
        .collect();
    let mut horizontal = vec![0_u8; data.len()];
    for (source, target) in data
        .chunks_exact(row_bytes)
        .zip(horizontal.chunks_exact_mut(row_bytes))
    {
        let mut sum = [0_u32; 4];
        for pixel in source[..(radius.min(width - 1) + 1) * 4].chunks_exact(4) {
            for channel in 0..4 {
                sum[channel] += u32::from(pixel[channel]);
            }
        }
        for x in 0..width {
            let left = x.saturating_sub(radius);
            let right = (x + radius).min(width - 1);
            let reciprocal = reciprocals[right - left + 1];
            for channel in 0..4 {
                target[x * 4 + channel] = divide(sum[channel], reciprocal);
            }
            if x >= radius {
                let leaving = &source[(x - radius) * 4..(x - radius) * 4 + 4];
                for channel in 0..4 {
                    sum[channel] -= u32::from(leaving[channel]);
                }
            }
            if x + radius + 1 < width {
                let entering = &source[(x + radius + 1) * 4..(x + radius + 2) * 4];
                for channel in 0..4 {
                    sum[channel] += u32::from(entering[channel]);
                }
            }
        }
    }
    let mut sums = vec![0_u32; row_bytes];
    for row in horizontal
        .chunks_exact(row_bytes)
        .take(radius.min(height - 1) + 1)
    {
        for (sum, &value) in sums.iter_mut().zip(row) {
            *sum += u32::from(value);
        }
    }
    for y in 0..height {
        let top = y.saturating_sub(radius);
        let bottom = (y + radius).min(height - 1);
        let reciprocal = reciprocals[bottom - top + 1];
        for (target, &sum) in data[y * row_bytes..(y + 1) * row_bytes]
            .iter_mut()
            .zip(&sums)
        {
            *target = divide(sum, reciprocal);
        }
        if y >= radius {
            let leaving = &horizontal[(y - radius) * row_bytes..(y - radius + 1) * row_bytes];
            for (sum, &value) in sums.iter_mut().zip(leaving) {
                *sum -= u32::from(value);
            }
        }
        if y + radius + 1 < height {
            let entering = &horizontal[(y + radius + 1) * row_bytes..(y + radius + 2) * row_bytes];
            for (sum, &value) in sums.iter_mut().zip(entering) {
                *sum += u32::from(value);
            }
        }
    }
}

/// 只在非零内容包围盒的邻域内做 box blur，输出与整帧模糊逐字节一致：
/// 单次模糊最多把内容向外扩散 `radius`，包围盒外扩 2×radius 后，子区边缘
/// 像素的窗口读到的全是零（两种算法都得 0）；子区内部像素的窗口不越界，
/// 与整帧的除数语义相同；子区边界与画布边界重合时窗口收缩也一致。
///
/// 返回模糊后的非零包围盒。
pub fn box_blur_bounded(
    data: &mut [u8],
    width: u32,
    height: u32,
    radius: usize,
    content: &ContentBox,
) -> ContentBox {
    let radius = radius.min(MAX_BLUR_RADIUS);
    let width_usize = width as usize;
    let height_usize = height as usize;
    if radius == 0 {
        return content.clone();
    }
    let (rows, cols) = (content.rows.clone(), content.cols.clone());
    let blurred = ContentBox {
        rows: rows.start.saturating_sub(radius)..(rows.end + radius).min(height_usize),
        cols: cols.start.saturating_sub(radius)..(cols.end + radius).min(width_usize),
    };
    let margin = radius * 2;
    let x0 = cols.start.saturating_sub(margin);
    let x1 = (cols.end + margin).min(width_usize);
    let y0 = rows.start.saturating_sub(margin);
    let y1 = (rows.end + margin).min(height_usize);
    // 内容占到半幅以上时局部拷贝不再划算，直接整帧。
    if (x1 - x0) * (y1 - y0) * 2 >= width_usize * height_usize {
        box_blur_premul_u8(data, width, height, radius);
        return blurred;
    }
    let sub_width = x1 - x0;
    let sub_height = y1 - y0;
    let mut scratch = vec![0_u8; sub_width * sub_height * 4];
    for (sub_y, y) in (y0..y1).enumerate() {
        scratch[sub_y * sub_width * 4..(sub_y + 1) * sub_width * 4]
            .copy_from_slice(&data[(y * width_usize + x0) * 4..(y * width_usize + x1) * 4]);
    }
    box_blur_premul_u8(&mut scratch, sub_width as u32, sub_height as u32, radius);
    for (sub_y, y) in (y0..y1).enumerate() {
        data[(y * width_usize + x0) * 4..(y * width_usize + x1) * 4]
            .copy_from_slice(&scratch[sub_y * sub_width * 4..(sub_y + 1) * sub_width * 4]);
    }
    blurred
}

/// [`box_blur_bounded`] 的自动扫描版本（`None` = 整帧透明）。
pub fn box_blur_content(
    data: &mut [u8],
    width: u32,
    height: u32,
    radius: usize,
) -> Option<ContentBox> {
    let content = alpha_bbox(data, width as usize, height as usize)?;
    Some(box_blur_bounded(data, width, height, radius, &content))
}

/// 把 `bounds` 覆盖的像素清零。绘制到全零缓冲上的 source-over 只会在绘制处
/// 产生非零字节，因此清空「非零包围盒」即可让缓冲重新变成整幅全零。
pub fn clear_content_box(data: &mut [u8], width: usize, bounds: &ContentBox) {
    for y in bounds.rows.clone() {
        let start = (y * width + bounds.cols.start) * 4;
        let end = (y * width + bounds.cols.end) * 4;
        data[start..end].fill(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 行主序改写之前的逐列实现（搬自 `studio_export/raster.rs`），作对照组。
    fn reference_box_blur(data: &mut [u8], width: u32, height: u32, radius: usize) {
        let width = width as usize;
        let height = height as usize;
        let radius = radius.min(MAX_BLUR_RADIUS);
        if radius == 0 || width == 0 || height == 0 {
            return;
        }
        let source = data.to_vec();
        let mut horizontal = vec![0_u8; data.len()];
        for y in 0..height {
            for channel in 0..4 {
                let mut sum = 0_u32;
                for x in 0..=radius.min(width - 1) {
                    sum += u32::from(source[(y * width + x) * 4 + channel]);
                }
                for x in 0..width {
                    let left = x.saturating_sub(radius);
                    let right = (x + radius).min(width - 1);
                    horizontal[(y * width + x) * 4 + channel] =
                        (sum / (right - left + 1) as u32) as u8;
                    if x >= radius {
                        sum -= u32::from(source[(y * width + x - radius) * 4 + channel]);
                    }
                    if x + radius + 1 < width {
                        sum += u32::from(source[(y * width + x + radius + 1) * 4 + channel]);
                    }
                }
            }
        }
        for x in 0..width {
            for channel in 0..4 {
                let mut sum = 0_u32;
                for y in 0..=radius.min(height - 1) {
                    sum += u32::from(horizontal[(y * width + x) * 4 + channel]);
                }
                for y in 0..height {
                    let top = y.saturating_sub(radius);
                    let bottom = (y + radius).min(height - 1);
                    data[(y * width + x) * 4 + channel] = (sum / (bottom - top + 1) as u32) as u8;
                    if y >= radius {
                        sum -= u32::from(horizontal[((y - radius) * width + x) * 4 + channel]);
                    }
                    if y + radius + 1 < height {
                        sum += u32::from(horizontal[((y + radius + 1) * width + x) * 4 + channel]);
                    }
                }
            }
        }
    }

    pub(crate) struct Rng(pub(crate) u64);
    impl Rng {
        pub(crate) fn next(&mut self) -> u32 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 >> 32) as u32
        }
    }

    #[test]
    fn reciprocal_division_is_exact_for_every_box_sum() {
        for divisor in 1..=2 * MAX_BLUR_RADIUS as u32 + 1 {
            let reciprocal = reciprocal(divisor);
            for sum in 0..=255 * divisor {
                assert_eq!(
                    u32::from(divide(sum, reciprocal)),
                    sum / divisor,
                    "{sum} / {divisor}"
                );
            }
        }
    }

    /// 改写之前逐行全扫的包围盒实现，作对照组。
    fn reference_alpha_bbox_within(
        rgba: &[u8],
        width: usize,
        height: usize,
        window: &ContentBox,
    ) -> Option<ContentBox> {
        let row_bytes = width * 4;
        let row_start = window.rows.start;
        let row_end = window.rows.end.min(height);
        let col_start = window.cols.start;
        let col_end = window.cols.end.min(width);
        if row_start >= row_end || col_start >= col_end {
            return None;
        }
        let span = col_end - col_start;
        let mut min_row = None;
        let mut max_row = 0_usize;
        let mut min_col = col_end;
        let mut max_col = col_start;
        for y in row_start..row_end {
            let row = &rgba[y * row_bytes + col_start * 4..y * row_bytes + col_end * 4];
            if row.iter().all(|&byte| byte == 0) {
                continue;
            }
            if min_row.is_none() {
                min_row = Some(y);
            }
            max_row = y;
            let first = row
                .chunks_exact(4)
                .position(|pixel| pixel.iter().any(|&byte| byte != 0))
                .unwrap_or(0);
            let last = span
                - row
                    .rchunks_exact(4)
                    .position(|pixel| pixel.iter().any(|&byte| byte != 0))
                    .unwrap_or(span - 1)
                - 1;
            min_col = min_col.min(col_start + first);
            max_col = max_col.max(col_start + last);
        }
        let min_row = min_row?;
        Some(ContentBox {
            rows: min_row..max_row + 1,
            cols: min_col..max_col + 1,
        })
    }

    #[test]
    fn bbox_scan_matches_full_row_reference() {
        let mut rng = Rng(0x5851_f42d_4c95_7f2d);
        let (width, height) = (83_usize, 29_usize);
        for round in 0..600 {
            let mut data = vec![0_u8; width * height * 4];
            let points = [0, 1, 2, 5, 40][round % 5];
            for _ in 0..points {
                let x = rng.next() as usize % width;
                let y = rng.next() as usize % height;
                let channel = rng.next() as usize % 4;
                data[(y * width + x) * 4 + channel] = 1 + (rng.next() % 255) as u8;
            }
            let window = if round % 3 == 0 {
                ContentBox {
                    rows: 0..height,
                    cols: 0..width,
                }
            } else {
                // 窗口可以越出画布（实现会夹取），也可以是空的。
                let r0 = rng.next() as usize % (height + 2);
                let c0 = rng.next() as usize % (width + 2);
                ContentBox {
                    rows: r0..r0 + rng.next() as usize % (height + 4),
                    cols: c0..c0 + rng.next() as usize % (width + 4),
                }
            };
            assert_eq!(
                alpha_bbox_within(&data, width, height, &window),
                reference_alpha_bbox_within(&data, width, height, &window),
                "round {round}"
            );
        }
    }

    #[test]
    fn row_major_blur_matches_column_reference() {
        let mut rng = Rng(0x2545_f491_4f6c_dd1d);
        let sizes = [(1, 1), (1, 9), (9, 1), (5, 3), (37, 23), (64, 48)];
        let radii = [1, 2, 3, 7, 20, 300];
        for &(width, height) in &sizes {
            for &radius in &radii {
                let mut data: Vec<u8> = (0..width * height * 4)
                    .map(|_| (rng.next() % 256) as u8)
                    .collect();
                // 一半的用例留出大片零区，贴近真实的稀疏输入。
                if rng.next() % 2 == 0 {
                    for (index, byte) in data.iter_mut().enumerate() {
                        if (index / 4) % 5 != 0 {
                            *byte = 0;
                        }
                    }
                }
                let mut expected = data.clone();
                reference_box_blur(&mut expected, width, height, radius);
                box_blur_premul_u8(&mut data, width, height, radius);
                assert_eq!(data, expected, "{width}x{height} r={radius}");
            }
        }
    }
}
