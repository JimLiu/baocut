//! 几何：捕获范围、取偶、指针的归一化坐标、光标图片的热点与 `scale`、光标位图的透明度。
//!
//! 坐标约定（进程声明了每显示器 DPI 感知 v2，Win32 给的都是物理像素）：
//!
//! - `sources` 报的显示器、窗口宽高与 `start` 里区域的 `rect` 是逻辑单位（物理像素 ÷ 显示器缩放比例），与 macOS 的
//!   「点」同一层意思；区域的 `rect` 相对它所在显示器的左上角。
//! - 捕获范围、指针位置都在虚拟桌面的物理像素上；归一化坐标 = (指针 − 捕获范围左上) ÷ 捕获范围宽高。

use crate::protocol::Rect;

/// 物理像素上的一个矩形。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PixelRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// 向下取偶，至少 2（H.264 要偶数宽高）。
pub fn even(n: u32) -> u32 {
    (n / 2 * 2).max(2)
}

/// 区域录制：显示器内的逻辑矩形换成显示器内的物理像素矩形（相对显示器左上），夹进显示器，宽高取偶。
/// 夹完不足 2 × 2 像素时是 None。
pub fn area_pixels(rect: &Rect, scale: f64, display_width: u32, display_height: u32) -> Option<PixelRect> {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let x0 = (rect.x * scale).round().max(0.0);
    let y0 = (rect.y * scale).round().max(0.0);
    let x1 = ((rect.x + rect.width) * scale).round().min(f64::from(display_width));
    let y1 = ((rect.y + rect.height) * scale).round().min(f64::from(display_height));
    if !(x1 - x0 >= 2.0 && y1 - y0 >= 2.0) {
        return None;
    }
    let width = ((x1 - x0) as u32) / 2 * 2;
    let height = ((y1 - y0) as u32) / 2 * 2;
    Some(PixelRect { x: x0 as i32, y: y0 as i32, width, height })
}

/// 指针在捕获画面里的归一化坐标；捕获范围是空的时候是 None。范围外照算（小于 0 或大于 1）。
pub fn normalize(x: i32, y: i32, capture: PixelRect) -> Option<(f64, f64)> {
    if capture.width == 0 || capture.height == 0 {
        return None;
    }
    Some((f64::from(x - capture.x) / f64::from(capture.width), f64::from(y - capture.y) / f64::from(capture.height)))
}

/// 帧与编码尺寸不一样时（窗口改了大小）拷多大：两边各取小的，左上对齐，余下的是黑。
pub fn copy_size(frame: (u32, u32), target: (u32, u32)) -> (u32, u32) {
    (frame.0.min(target.0), frame.1.min(target.1))
}

/// 光标热点在图片里的比例位置（格式规范 §4.7），夹进 [0, 1]。
pub fn hotspot(x: u32, y: u32, width: u32, height: u32) -> (f64, f64) {
    if width == 0 || height == 0 {
        return (0.0, 0.0);
    }
    ((f64::from(x) / f64::from(width)).clamp(0.0, 1.0), (f64::from(y) / f64::from(height)).clamp(0.0, 1.0))
}

/// 光标的 `scale`（格式规范 §4.7）：图片的几个像素对应捕获画面的一个像素。Windows 把光标位图按物理像素原样画在屏幕上
/// （`GetIconInfo` 取到的就是系统正在画的那张），捕获画面也是物理像素，所以图片像素与画面像素一比一。
/// 系统的「指针大小」放大了光标时，取到的位图本身就是放大后的（待 Windows 实机核实，屏幕录制设计 §14）。
pub fn cursor_scale() -> f64 {
    1.0
}

/// 彩色光标的 BGRA 像素换成 RGBA。整张图的 alpha 都是 0 时（老式没有 alpha 通道的彩色光标），用 AND 掩码定透明：
/// 掩码为 0 的像素不透明。`and_mask` 是每像素一个布尔（真 = 掩码位是 1）。
pub fn color_cursor_rgba(bgra: &[u8], and_mask: Option<&[bool]>) -> Vec<u8> {
    let has_alpha = bgra.chunks_exact(4).any(|pixel| pixel[3] != 0);
    let mut out = Vec::with_capacity(bgra.len());
    for (index, pixel) in bgra.chunks_exact(4).enumerate() {
        let alpha = if has_alpha {
            pixel[3]
        } else {
            match and_mask.and_then(|mask| mask.get(index)) {
                Some(true) => 0,
                _ => 255,
            }
        };
        out.extend_from_slice(&[pixel[2], pixel[1], pixel[0], alpha]);
    }
    out
}

/// 单色光标（没有彩色位图，掩码位图是两倍高：上半 AND、下半 XOR）换成 RGBA。
///
/// | AND | XOR | 屏幕上 | 这里 |
/// | --- | --- | --- | --- |
/// | 0 | 0 | 黑 | 不透明的黑 |
/// | 0 | 1 | 白 | 不透明的白 |
/// | 1 | 0 | 透明 | 透明 |
/// | 1 | 1 | 反色 | 不透明的黑（图片画不出反色；I 形光标多是这种，在浅色背景上看起来一样） |
pub fn mono_cursor_rgba(and_mask: &[bool], xor_mask: &[bool]) -> Vec<u8> {
    let mut out = Vec::with_capacity(and_mask.len() * 4);
    for (and, xor) in and_mask.iter().zip(xor_mask) {
        let pixel = match (and, xor) {
            (false, false) => [0, 0, 0, 255],
            (false, true) => [255, 255, 255, 255],
            (true, false) => [0, 0, 0, 0],
            (true, true) => [0, 0, 0, 255],
        };
        out.extend_from_slice(&pixel);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evens() {
        assert_eq!(even(1921), 1920);
        assert_eq!(even(1080), 1080);
        assert_eq!(even(1), 2);
        assert_eq!(even(0), 2);
    }

    #[test]
    fn area_in_pixels_is_clamped_and_even() {
        // 150% 缩放的 1920×1080 物理像素显示器（逻辑 1280×720）。
        let rect = Rect { x: 10.0, y: 20.0, width: 101.0, height: 51.0 };
        assert_eq!(area_pixels(&rect, 1.5, 1920, 1080), Some(PixelRect { x: 15, y: 30, width: 152, height: 76 }));
        // 越过显示器右下的部分夹掉。
        let rect = Rect { x: 1200.0, y: 700.0, width: 200.0, height: 200.0 };
        assert_eq!(area_pixels(&rect, 1.5, 1920, 1080), Some(PixelRect { x: 1800, y: 1050, width: 120, height: 30 }));
        // 负的起点夹到 0。
        let rect = Rect { x: -10.0, y: -10.0, width: 21.0, height: 21.0 };
        assert_eq!(area_pixels(&rect, 1.0, 100, 100), Some(PixelRect { x: 0, y: 0, width: 10, height: 10 }));
        // 完全在显示器外。
        let rect = Rect { x: 2000.0, y: 0.0, width: 10.0, height: 10.0 };
        assert_eq!(area_pixels(&rect, 1.0, 1920, 1080), None);
        // 缩放比例无效时按 1。
        let rect = Rect { x: 0.0, y: 0.0, width: 5.0, height: 5.0 };
        assert_eq!(area_pixels(&rect, f64::NAN, 100, 100), Some(PixelRect { x: 0, y: 0, width: 4, height: 4 }));
    }

    #[test]
    fn pointer_is_normalized_against_the_capture() {
        let capture = PixelRect { x: -1920, y: 0, width: 1920, height: 1080 };
        assert_eq!(normalize(-960, 540, capture), Some((0.5, 0.5)));
        // 范围外照记。
        assert_eq!(normalize(0, 1080, capture), Some((1.0, 1.0)));
        assert_eq!(normalize(-2112, -108, capture), Some((-0.1, -0.1)));
        assert_eq!(normalize(0, 0, PixelRect::default()), None);
    }

    #[test]
    fn copy_size_keeps_the_smaller_side() {
        assert_eq!(copy_size((800, 600), (640, 480)), (640, 480));
        assert_eq!(copy_size((500, 700), (640, 480)), (500, 480));
    }

    #[test]
    fn hotspots_and_scale() {
        assert_eq!(hotspot(8, 4, 32, 32), (0.25, 0.125));
        assert_eq!(hotspot(40, 0, 32, 32), (1.0, 0.0));
        assert_eq!(hotspot(1, 1, 0, 0), (0.0, 0.0));
        assert_eq!(cursor_scale(), 1.0);
    }

    #[test]
    fn cursor_bitmaps_become_rgba() {
        // 有 alpha 的彩色光标：照用 alpha，BGRA 换成 RGBA。
        assert_eq!(color_cursor_rgba(&[1, 2, 3, 128, 4, 5, 6, 0], None), vec![3, 2, 1, 128, 6, 5, 4, 0]);
        // 没有 alpha 的彩色光标：按 AND 掩码。
        assert_eq!(color_cursor_rgba(&[1, 2, 3, 0, 4, 5, 6, 0], Some(&[false, true])), vec![3, 2, 1, 255, 6, 5, 4, 0]);
        assert_eq!(
            mono_cursor_rgba(&[false, false, true, true], &[false, true, false, true]),
            vec![0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 255]
        );
    }
}
