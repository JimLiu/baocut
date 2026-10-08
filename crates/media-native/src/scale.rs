//! 与平台无关的尺寸推导与 CPU 重采样。
//!
//! 缩放的**快路径在平台层**：AVFoundation 的 `maximumSize` 与 CoreGraphics 的
//! 位图上下文、Media Foundation 的 advanced video processing 都能在解码链路上
//! 直接给出目标尺寸。本模块是收口：平台没照做（MF 常常只肯给原尺寸）时在 CPU 上
//! 补一次重采样，保证 [`crate::extract_frame_rgba`] 的尺寸契约永远成立。
//!
//! 滤波用**盒式（面积平均）**，缩略图场景足够：降采样时它就是最朴素的 area
//! 平均（比 bilinear 抗锯齿更好），升采样时退化为最近邻。§15.1 下缩略图不是
//! golden，不追求与 swscale 逐像素一致。

use crate::RgbaFrame;

/// 源显示尺寸 + 目标宽度 → 目标高度（偶数对齐、至少 2）。
///
/// 对齐 ffmpeg `scale=<w>:-2`：宽恰为 `target_width`，高按宽高比推出后吸附到
/// 最近的偶数。偶数对齐是 4:2:0 色度采样的历史约束，这里保留它只为了让原生
/// 路径与 ffmpeg 兜底路径给出同一个尺寸——同一个 filmstrip 里两条路径的格子
/// 混着出现时，尺寸不能打架。
pub fn scaled_height(source_width: u32, source_height: u32, target_width: u32) -> u32 {
    if source_width == 0 || source_height == 0 || target_width == 0 {
        return 2;
    }
    let exact = f64::from(source_height) * f64::from(target_width) / f64::from(source_width);
    let even = (exact / 2.0).round().max(1.0);
    // u32 上界：4K 级素材远够，极端宽高比也不会溢出。
    ((even as u32).min(u32::MAX / 2)) * 2
}

/// 盒式重采样到 `(width, height)`；尺寸已相符时直接克隆返回。
pub fn resize_rgba(frame: &RgbaFrame, width: u32, height: u32) -> RgbaFrame {
    if frame.width == width && frame.height == height {
        return frame.clone();
    }
    let (source_width, source_height) = (frame.width as usize, frame.height as usize);
    let (target_width, target_height) = (width.max(1) as usize, height.max(1) as usize);
    let mut data = vec![0_u8; target_width * target_height * 4];
    for y in 0..target_height {
        // 目标行 y 覆盖的源行区间 [y0, y1)；升采样时区间长度为 1（最近邻）。
        let y0 = y * source_height / target_height;
        let y1 = (((y + 1) * source_height).div_ceil(target_height)).max(y0 + 1);
        let y1 = y1.min(source_height);
        for x in 0..target_width {
            let x0 = x * source_width / target_width;
            let x1 = (((x + 1) * source_width).div_ceil(target_width)).max(x0 + 1);
            let x1 = x1.min(source_width);
            let mut sums = [0_u32; 3];
            let mut count = 0_u32;
            for sy in y0..y1 {
                let row = sy * source_width * 4;
                for sx in x0..x1 {
                    let offset = row + sx * 4;
                    sums[0] += u32::from(frame.data[offset]);
                    sums[1] += u32::from(frame.data[offset + 1]);
                    sums[2] += u32::from(frame.data[offset + 2]);
                    count += 1;
                }
            }
            let count = count.max(1);
            let out = (y * target_width + x) * 4;
            data[out] = (sums[0] / count) as u8;
            data[out + 1] = (sums[1] / count) as u8;
            data[out + 2] = (sums[2] / count) as u8;
            data[out + 3] = 255;
        }
    }
    RgbaFrame {
        width: target_width as u32,
        height: target_height as u32,
        data,
    }
}

/// 顺时针旋转 `degrees`（只接受 0 / 90 / 180 / 270）。0 度直接克隆返回。
///
/// 与 Windows 单帧路径 `copy_rows` 的旋转规则同一条：`degrees` 是**把解码出来的
/// 像素摆正到显示方向**需要顺时针转的角度，等价 ffmpeg CLI 的 autorotate。
/// macOS 的顺序帧流用得上它——`AVAssetReaderTrackOutput` 不像
/// `AVAssetImageGenerator` 那样有 `appliesPreferredTrackTransform`，摆正得自己来。
pub fn rotate_rgba(frame: &RgbaFrame, degrees: u16) -> RgbaFrame {
    if degrees % 360 == 0 {
        return frame.clone();
    }
    let (source_width, source_height) = (frame.width as usize, frame.height as usize);
    let (out_width, out_height) = if matches!(degrees % 360, 90 | 270) {
        (source_height, source_width)
    } else {
        (source_width, source_height)
    };
    let mut data = vec![0_u8; out_width * out_height * 4];
    for y in 0..source_height {
        for x in 0..source_width {
            let (tx, ty) = match degrees % 360 {
                90 => (source_height - 1 - y, x),
                180 => (source_width - 1 - x, source_height - 1 - y),
                270 => (y, source_width - 1 - x),
                _ => (x, y),
            };
            let from = (y * source_width + x) * 4;
            let to = (ty * out_width + tx) * 4;
            data[to..to + 4].copy_from_slice(&frame.data[from..from + 4]);
        }
    }
    RgbaFrame {
        width: out_width as u32,
        height: out_height as u32,
        data,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heights_follow_the_source_ratio_and_snap_to_even() {
        // 16:9 的 1920x1080 缩到 168 宽：94.5 → 94（最近偶数）。
        assert_eq!(scaled_height(1920, 1080, 168), 94);
        assert_eq!(scaled_height(1920, 1080, 320), 180);
        assert_eq!(scaled_height(320, 180, 320), 180);
        // 竖屏。
        assert_eq!(scaled_height(1080, 1920, 168), 298);
        // 极端比例仍至少 2 像素高。
        assert_eq!(scaled_height(4000, 10, 84), 2);
        // 退化输入不 panic。
        assert_eq!(scaled_height(0, 0, 168), 2);
        assert_eq!(scaled_height(1920, 1080, 0), 2);
    }

    #[test]
    fn resizing_to_the_same_size_is_a_pass_through() {
        let frame = RgbaFrame::new(2, 1, vec![1, 2, 3, 255, 4, 5, 6, 255]).unwrap();
        assert_eq!(resize_rgba(&frame, 2, 1), frame);
    }

    /// 2x2 四色降到 1x1：盒式滤波给出四像素平均，alpha 强制不透明。
    #[test]
    fn downsampling_averages_the_covered_source_box() {
        let frame = RgbaFrame::new(
            2,
            2,
            vec![
                0, 0, 0, 255, // 黑
                255, 255, 255, 255, // 白
                0, 0, 0, 255, //
                255, 255, 255, 255, //
            ],
        )
        .unwrap();
        let small = resize_rgba(&frame, 1, 1);
        assert_eq!(small.pixel(0, 0), Some([127, 127, 127, 255]));
    }

    /// 顺时针 90 度：宽高互换，左上角像素转到右上角。
    #[test]
    fn rotating_a_quarter_turn_clockwise_swaps_the_axes() {
        // 2x1：左红右蓝。
        let frame = RgbaFrame::new(2, 1, vec![255, 0, 0, 255, 0, 0, 255, 255]).unwrap();
        let turned = rotate_rgba(&frame, 90);
        assert_eq!((turned.width, turned.height), (1, 2));
        // 源 (0,0) → 目标 (0,0)；源 (1,0) → 目标 (0,1)。
        assert_eq!(turned.pixel(0, 0), Some([255, 0, 0, 255]));
        assert_eq!(turned.pixel(0, 1), Some([0, 0, 255, 255]));
        // 转四次回到原图；0 度是恒等。
        let full_circle = rotate_rgba(&rotate_rgba(&rotate_rgba(&turned, 90), 90), 90);
        assert_eq!(full_circle, frame);
        assert_eq!(rotate_rgba(&frame, 0), frame);
    }

    /// 180 与 270 的坐标映射。
    #[test]
    fn half_and_three_quarter_turns_map_corners_as_expected() {
        let frame = RgbaFrame::new(2, 1, vec![255, 0, 0, 255, 0, 0, 255, 255]).unwrap();
        let half = rotate_rgba(&frame, 180);
        assert_eq!((half.width, half.height), (2, 1));
        assert_eq!(half.pixel(0, 0), Some([0, 0, 255, 255]));
        let three = rotate_rgba(&frame, 270);
        assert_eq!((three.width, three.height), (1, 2));
        assert_eq!(three.pixel(0, 0), Some([0, 0, 255, 255]));
        assert_eq!(three.pixel(0, 1), Some([255, 0, 0, 255]));
    }

    /// 升采样：每个目标像素落回唯一一个源像素（最近邻），左右两半各自纯色。
    #[test]
    fn upsampling_keeps_solid_regions_solid() {
        let frame = RgbaFrame::new(2, 1, vec![255, 0, 0, 255, 0, 0, 255, 255]).unwrap();
        let big = resize_rgba(&frame, 4, 2);
        assert_eq!(big.width, 4);
        assert_eq!(big.height, 2);
        for y in 0..2 {
            assert_eq!(big.pixel(0, y), Some([255, 0, 0, 255]));
            assert_eq!(big.pixel(1, y), Some([255, 0, 0, 255]));
            assert_eq!(big.pixel(2, y), Some([0, 0, 255, 255]));
            assert_eq!(big.pixel(3, y), Some([0, 0, 255, 255]));
        }
    }
}
