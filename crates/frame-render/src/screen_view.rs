//! 屏幕取景的画法（视频格式规范 §3.18 的第 2、3 步）：按求值器（`video_model::screen_view_solver`）给的可见区域 V
//! 把源画面重采样成裁剪 C 的大小，再把光标与点击提示经同一个变换画上去。结果当作源画面，之后照常适配、加效果。
//! 预览（WASM）与导出（原生）都走这里。

use std::sync::Arc;

use tiny_skia::{Color, FillRule, FilterQuality, IntSize, Paint, PathBuilder, Pixmap, PixmapPaint, Stroke, Transform};
use video_model::recording::Capture;
use video_model::screen_view_solver::{
    CLICK_RADIUS_POINTS, CLICK_RING_POINTS, ClickState, CursorState, PointerLook, Rect, ScreenViewFrame,
};

use crate::effects::hex_rgba;

/// 裁剪 C 在源画面上的整像素框 `(x, y, w, h)`：与不取景时裁剪的取法相同。
pub fn crop_pixels(width: u32, height: u32, [u0, v0, u1, v1]: Rect) -> (u32, u32, u32, u32) {
    let (w, h) = (f64::from(width), f64::from(height));
    let x = (u0 * w).round().clamp(0.0, w - 1.0);
    let y = (v0 * h).round().clamp(0.0, h - 1.0);
    let cw = ((u1 * w).round() - x).clamp(1.0, w - x);
    let ch = ((v1 * h).round() - y).clamp(1.0, h - y);
    (x as u32, y as u32, cw as u32, ch as u32)
}

/// 这一刻取景之后的源画面：C 那么大，内容是 V 放大上去的样子，压着光标与点击提示。`cursor_image` 是光标的图片
/// （热点、倍率在 `frame.cursor` 里）；拿不到时不画光标。`capture` 是这路屏幕流的捕获画面（光标与提示按它换算大小），
/// 不知道时当作源画面的一个像素就是捕获画面的一个像素。
pub fn compose(
    picture: &Pixmap,
    crop: Rect,
    frame: &ScreenViewFrame,
    look: &PointerLook,
    capture: Option<&Capture>,
    cursor_image: Option<&Pixmap>,
) -> Option<Pixmap> {
    let (pw, ph) = (f64::from(picture.width()), f64::from(picture.height()));
    let (_, _, cw, ch) = crop_pixels(picture.width(), picture.height(), crop);
    let mut out = Pixmap::new(cw, ch)?;
    let [x0, y0, x1, y1] = frame.view;
    // 源画面的像素 → 输出的像素：V 映到整个输出。
    let sx = f64::from(cw) / ((x1 - x0) * pw);
    let sy = f64::from(ch) / ((y1 - y0) * ph);
    let transform = Transform::from_row(sx as f32, 0.0, 0.0, sy as f32, (-x0 * pw * sx) as f32, (-y0 * ph * sy) as f32);
    let paint = PixmapPaint {
        quality: FilterQuality::Bicubic,
        ..PixmapPaint::default()
    };
    out.draw_pixmap(0, 0, picture.as_ref(), &paint, transform, None);

    // 归一化的源坐标 → 输出的像素。
    let to_out = |x: f64, y: f64| ((x - x0) / (x1 - x0) * f64::from(cw), (y - y0) / (y1 - y0) * f64::from(ch));
    // 捕获画面的一个像素在输出上有多宽。
    let capture_width = capture.map_or(pw, |c| f64::from(c.width.max(1)));
    let per_capture_pixel = f64::from(cw) / ((x1 - x0) * capture_width);
    let points = capture.and_then(|c| c.scale).filter(|s| s.is_finite() && *s > 0.0).unwrap_or(1.0);

    if let Some(color) = look.click_color.as_deref().and_then(hex_rgba) {
        for click in &frame.clicks {
            let (cx, cy) = to_out(click.x, click.y);
            ripple(&mut out, (cx, cy), click, color, points * look.size * per_capture_pixel);
        }
    }
    if let (Some(cursor), Some(image)) = (&frame.cursor, cursor_image) {
        let (px, py) = to_out(cursor.x, cursor.y);
        draw_cursor(&mut out, (px, py), cursor, image, look.size * per_capture_pixel);
    }
    Some(out)
}

/// 光标：图片按 `cursor.scale`（图片的几个像素是捕获画面的一个像素）与 `pointer.size` 缩放，热点落在指针处。
fn draw_cursor(out: &mut Pixmap, (px, py): (f64, f64), state: &CursorState, image: &Pixmap, per_capture_pixel: f64) {
    let scale = state.cursor.scale.filter(|s| s.is_finite() && *s > 0.0).unwrap_or(1.0);
    let k = per_capture_pixel / scale;
    let (w, h) = (f64::from(image.width()) * k, f64::from(image.height()) * k);
    let left = px - state.cursor.hotspot.x * w;
    let top = py - state.cursor.hotspot.y * h;
    let paint = PixmapPaint {
        opacity: state.opacity.clamp(0.0, 1.0) as f32,
        quality: FilterQuality::Bicubic,
        ..PixmapPaint::default()
    };
    out.draw_pixmap(0, 0, image.as_ref(), &paint, Transform::from_row(k as f32, 0.0, 0.0, k as f32, left as f32, top as f32), None);
}

/// 点击提示：一圈从指针处散开（ease-out），实心的淡底加一道外圈，越散越淡。`per_point` 是一个逻辑点（已乘
/// `pointer.size`）在输出上有多宽。
fn ripple(out: &mut Pixmap, (cx, cy): (f64, f64), click: &ClickState, [r, g, b, a]: [u8; 4], per_point: f64) {
    let p = click.progress.clamp(0.0, 1.0);
    let eased = 1.0 - (1.0 - p) * (1.0 - p);
    let radius = (CLICK_RADIUS_POINTS * per_point * eased) as f32;
    let fade = (1.0 - p) * f64::from(a) / 255.0;
    if radius <= 0.0 || fade <= 0.0 {
        return;
    }
    let Some(path) = PathBuilder::from_circle(cx as f32, cy as f32, radius) else { return };
    let mut paint = Paint {
        anti_alias: true,
        ..Paint::default()
    };
    paint.set_color(Color::from_rgba8(r, g, b, (fade * 0.35 * 255.0).round() as u8));
    out.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
    paint.set_color(Color::from_rgba8(r, g, b, (fade * 255.0).round() as u8));
    let stroke = Stroke {
        width: (CLICK_RING_POINTS * per_point) as f32,
        ..Stroke::default()
    };
    out.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
}

/// 光标图片：PNG。读不出来时为 `None`。
pub fn decode_cursor(bytes: &[u8]) -> Option<Arc<Pixmap>> {
    let pixmap = Pixmap::decode_png(bytes).ok()?;
    IntSize::from_wh(pixmap.width(), pixmap.height())?;
    Some(Arc::new(pixmap))
}
