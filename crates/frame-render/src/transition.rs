//! 转场的画法（格式规范 §3.9）。
//!
//! 每一侧先由内核画成一张与输出等大的透明层（已含自己的几何、遮罩、效果、元素动画与不透明度），再在这里按转场合起来。
//! 入场的画法作用在 B 上，以 B 自己的框、旋转与镜像为准（与 v2 媒体元素的入场转场同一套语义）：
//!
//! - `dissolve`：不透明度 × e；
//! - `wipe`：从框的局部左边揭开到 e；
//! - `slide`：沿框的 x 轴平移 (e − 1) × 框宽，不透明度 × e；
//! - `zoom`：绕框中心缩放 0.75 + 0.25e，不透明度 × e；
//! - `iris`：半径 e × 半对角线的圆。
//!
//! 两侧转场先画满 A，再按入场画法画 B；`dip-to-color` 前半程 A 渐变到颜色、后半程颜色渐变到 B；`push` 按运动方向
//! 整画布推：B 还差 (1 − e) 个画布宽（高），A 已经走了 e。单侧转场缺的一侧是透明的；出场按同一种画法的逆过程，
//! 进度换成 e′ = easing(1 − p)。混合在 sRGB 编码值上做（与 Canvas 2D 一致）。

use render_graph::{LayerTransition, TransitionRole};
use serde_json::{Map, Value};
use subtitle_render::TimelineVisualElement;
use timeline::schema::{ElementKind, VisualMode};
use tiny_skia::{BlendMode, Color, FilterQuality, Pixmap, PixmapPaint, Transform};

use crate::effects::hex_rgba;

/// 一侧的框（输出像素）：中心、宽高、旋转（度，顺时针）与镜像。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BoxGeom {
    pub cx: f64,
    pub cy: f64,
    pub w: f64,
    pub h: f64,
    pub rotation: f64,
    pub flip_x: bool,
    pub flip_y: bool,
}

impl BoxGeom {
    /// 元素在 `size` 输出上的框。`element` 已代入这一刻的关键帧；`natural` 是外部媒体（含 Lottie）源画面的像素尺寸，
    /// 有它时按媒体框算（铺满模式且不平铺时是整张画布），否则按元素的静态框算。
    pub fn of(element: &TimelineVisualElement, natural: Option<(f64, f64)>, size: (f64, f64)) -> BoxGeom {
        let place = &element.place;
        let (cx, cy, w, h) = match natural {
            Some(natural) => {
                let tiled = element.tile.as_ref().is_some_and(|t| t.on);
                let fullscreen = element.mode == VisualMode::Fullscreen && !tiled;
                let natural = if natural.0 > 0.0 && natural.1 > 0.0 { natural } else { size };
                let (mut w, mut h, cx, cy) = timeline::geometry::media_box(element.kind, fullscreen, place, natural, size);
                if !fullscreen {
                    let scale = place.scale.unwrap_or(1.0);
                    w *= scale;
                    h *= scale * place.scale_y.unwrap_or(1.0);
                }
                (cx, cy, w, h)
            }
            None => {
                let view = subtitle_render::element_view(element);
                let geometry = timeline::ElementGeometry {
                    shape: element.shape.as_ref(),
                    sticker: element.sticker.as_ref(),
                    aspect: timeline_render::element::element_aspect(&view),
                };
                let kind = if element.kind == ElementKind::Video {
                    ElementKind::Image
                } else {
                    element.kind
                };
                let (x, y, w, h) = timeline::static_box(kind, &geometry, Some(place), size);
                (x + w / 2.0, y + h / 2.0, w, h)
            }
        };
        let (fx, fy) = place.flip_signs();
        BoxGeom {
            cx,
            cy,
            w: w.abs(),
            h: h.abs(),
            rotation: place.rot.unwrap_or(0.0),
            flip_x: fx < 0.0,
            flip_y: fy < 0.0,
        }
    }

    /// 输出像素中心 `(x, y)` 在框的局部坐标里离框（内容方向的）左边的距离，以及离中心的距离。
    fn local_u(&self, x: f64, y: f64) -> f64 {
        let (sin, cos) = self.rotation.to_radians().sin_cos();
        let (px, py) = (x - self.cx, y - self.cy);
        let lx = px * cos + py * sin;
        let lx = if self.flip_x { -lx } else { lx };
        lx + self.w / 2.0
    }

    /// 框的 x 轴（内容方向）在输出上的单位向量。
    fn axis(&self) -> (f64, f64) {
        let (sin, cos) = self.rotation.to_radians().sin_cos();
        let sign = if self.flip_x { -1.0 } else { 1.0 };
        (cos * sign, sin * sign)
    }
}

/// 这一侧在转场里该用的进度：入场与两侧转场是 `eased`，单侧出场是 easing(1 − p)。
pub fn effective_progress(transition: &LayerTransition, two_sided: bool) -> f64 {
    match (transition.role, two_sided) {
        (TransitionRole::Outgoing, false) => transition.easing.apply(1.0 - transition.progress),
        _ => transition.eased,
    }
    .clamp(0.0, 1.0)
}

/// 把 A、B 按 `kind` 在进度 `e` 合到 `out`（调用方给一张清空的透明画布）。`b_box` 是 B 的框。
pub fn compose(
    kind: &str,
    params: &Map<String, Value>,
    a: Option<&Pixmap>,
    b: Option<&Pixmap>,
    b_box: Option<BoxGeom>,
    e: f64,
    out: &mut Pixmap,
) {
    let e = if e.is_finite() { e.clamp(0.0, 1.0) } else { 1.0 };
    let (w, h) = (out.width() as f64, out.height() as f64);
    match kind {
        "dip-to-color" => {
            let [r, g, bl, _] = params
                .get("color")
                .and_then(Value::as_str)
                .and_then(hex_rgba)
                .unwrap_or([0, 0, 0, 255]);
            // 前半程 A → 颜色（比例 2e），后半程颜色 → B（比例 2e − 1）。
            let (side, colour_weight) = if e < 0.5 { (a, 2.0 * e) } else { (b, 1.0 - (2.0 * e - 1.0)) };
            lerp_to_colour(out, side, [r, g, bl], colour_weight);
        }
        "push" => {
            let (vx, vy) = match params.get("direction").and_then(Value::as_str) {
                Some("right") => (-w, 0.0),
                Some("up") => (0.0, h),
                Some("down") => (0.0, -h),
                _ => (w, 0.0),
            };
            // 运动方向朝左时 B 从右边进来：B 还差 (1 − e)，A 已经朝左走了 e。
            blit(out, a, 1.0, Transform::from_translate((-vx * e) as f32, (-vy * e) as f32));
            blit(
                out,
                b,
                1.0,
                Transform::from_translate((vx * (1.0 - e)) as f32, (vy * (1.0 - e)) as f32),
            );
        }
        _ => {
            blit(out, a, 1.0, Transform::identity());
            let Some(b) = b else { return };
            let geom = b_box.unwrap_or(BoxGeom {
                cx: w / 2.0,
                cy: h / 2.0,
                w,
                h,
                rotation: 0.0,
                flip_x: false,
                flip_y: false,
            });
            incoming(kind, b, geom, e, out);
        }
    }
}

/// B 按入场画法画到 `out` 上。认不出的种类按硬切（调用方已报出来），只画 B。
fn incoming(kind: &str, b: &Pixmap, geom: BoxGeom, e: f64, out: &mut Pixmap) {
    match kind {
        "dissolve" => blit(out, Some(b), e, Transform::identity()),
        "slide" => {
            let (ax, ay) = geom.axis();
            let shift = (e - 1.0) * geom.w;
            blit(out, Some(b), e, Transform::from_translate((ax * shift) as f32, (ay * shift) as f32));
        }
        "zoom" => {
            let s = 0.75 + 0.25 * e;
            let zoom = Transform::from_row(
                s as f32,
                0.0,
                0.0,
                s as f32,
                (geom.cx * (1.0 - s)) as f32,
                (geom.cy * (1.0 - s)) as f32,
            );
            blit(out, Some(b), e, zoom);
        }
        "wipe" => {
            let edge = e * geom.w;
            over_with_coverage(out, b, |x, y| (edge - geom.local_u(x, y) + 0.5).clamp(0.0, 1.0));
        }
        "iris" => {
            let radius = e * (geom.w / 2.0).hypot(geom.h / 2.0);
            over_with_coverage(out, b, |x, y| (radius - (x - geom.cx).hypot(y - geom.cy) + 0.5).clamp(0.0, 1.0));
        }
        _ => blit(out, Some(b), 1.0, Transform::identity()),
    }
}

fn blit(out: &mut Pixmap, side: Option<&Pixmap>, opacity: f64, transform: Transform) {
    let Some(side) = side else { return };
    if opacity <= 0.0 {
        return;
    }
    let quality = if transform.is_identity() || is_integer_translate(transform) {
        FilterQuality::Nearest
    } else {
        FilterQuality::Bilinear
    };
    let paint = PixmapPaint {
        opacity: opacity.min(1.0) as f32,
        blend_mode: BlendMode::SourceOver,
        quality,
    };
    out.draw_pixmap(0, 0, side.as_ref(), &paint, transform, None);
}

fn is_integer_translate(t: Transform) -> bool {
    t.sx == 1.0 && t.sy == 1.0 && t.kx == 0.0 && t.ky == 0.0 && t.tx.fract() == 0.0 && t.ty.fract() == 0.0
}

/// `side` 乘上逐像素的覆盖率盖到 `out` 上（预乘的 SourceOver）。
fn over_with_coverage(out: &mut Pixmap, side: &Pixmap, coverage: impl Fn(f64, f64) -> f64) {
    let width = out.width() as usize;
    if side.width() != out.width() || side.height() != out.height() {
        return;
    }
    for (i, (dst, src)) in out.data_mut().chunks_exact_mut(4).zip(side.data().chunks_exact(4)).enumerate() {
        if src[3] == 0 {
            continue;
        }
        let x = (i % width) as f64 + 0.5;
        let y = (i / width) as f64 + 0.5;
        let k = coverage(x, y);
        if k <= 0.0 {
            continue;
        }
        let sa = f64::from(src[3]) * k;
        let keep = 1.0 - sa / 255.0;
        for c in 0..4 {
            let s = f64::from(src[c]) * k;
            dst[c] = (s + f64::from(dst[c]) * keep).round().clamp(0.0, 255.0) as u8;
        }
    }
}

/// `out = side × (1 − k) + 不透明的颜色 × k`（预乘值上的线性插值；缺的一侧是透明）。
fn lerp_to_colour(out: &mut Pixmap, side: Option<&Pixmap>, [r, g, b]: [u8; 3], k: f64) {
    let k = k.clamp(0.0, 1.0);
    out.fill(Color::TRANSPARENT);
    blit(out, side, 1.0, Transform::identity());
    let colour = [f64::from(r), f64::from(g), f64::from(b), 255.0];
    for px in out.data_mut().chunks_exact_mut(4) {
        for c in 0..4 {
            px[c] = (f64::from(px[c]) * (1.0 - k) + colour[c] * k).round().clamp(0.0, 255.0) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opaque(w: u32, h: u32, rgba: [u8; 4]) -> Pixmap {
        let mut p = Pixmap::new(w, h).unwrap();
        p.fill(Color::from_rgba8(rgba[0], rgba[1], rgba[2], rgba[3]));
        p
    }

    fn px(p: &Pixmap, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * p.width() + x) * 4) as usize;
        p.data()[i..i + 4].try_into().unwrap()
    }

    fn full(w: f64, h: f64) -> BoxGeom {
        BoxGeom {
            cx: w / 2.0,
            cy: h / 2.0,
            w,
            h,
            rotation: 0.0,
            flip_x: false,
            flip_y: false,
        }
    }

    #[test]
    fn wipe_reveals_from_the_box_left_and_follows_the_mirror() {
        let b = opaque(100, 10, [255, 0, 0, 255]);
        let mut out = Pixmap::new(100, 10).unwrap();
        compose("wipe", &Map::new(), None, Some(&b), Some(full(100.0, 10.0)), 0.3, &mut out);
        assert_eq!(px(&out, 10, 5)[3], 255);
        assert_eq!(px(&out, 50, 5)[3], 0);
        let mut out = Pixmap::new(100, 10).unwrap();
        let mirrored = BoxGeom {
            flip_x: true,
            ..full(100.0, 10.0)
        };
        compose("wipe", &Map::new(), None, Some(&b), Some(mirrored), 0.3, &mut out);
        assert_eq!(px(&out, 10, 5)[3], 0);
        assert_eq!(px(&out, 90, 5)[3], 255);
    }

    #[test]
    fn dip_to_colour_passes_through_the_colour_at_the_midpoint() {
        let a = opaque(4, 4, [255, 0, 0, 255]);
        let b = opaque(4, 4, [0, 0, 255, 255]);
        let mut params = Map::new();
        params.insert("color".into(), Value::String("#00FF00".into()));
        let mut out = Pixmap::new(4, 4).unwrap();
        compose("dip-to-color", &params, Some(&a), Some(&b), None, 0.5, &mut out);
        assert_eq!(px(&out, 1, 1), [0, 255, 0, 255]);
        compose("dip-to-color", &params, Some(&a), Some(&b), None, 0.0, &mut out);
        assert_eq!(px(&out, 1, 1), [255, 0, 0, 255]);
        compose("dip-to-color", &params, Some(&a), Some(&b), None, 1.0, &mut out);
        assert_eq!(px(&out, 1, 1), [0, 0, 255, 255]);
    }

    #[test]
    fn push_moves_both_sides_in_the_motion_direction() {
        let a = opaque(10, 2, [255, 0, 0, 255]);
        let b = opaque(10, 2, [0, 0, 255, 255]);
        let mut params = Map::new();
        params.insert("direction".into(), Value::String("left".into()));
        let mut out = Pixmap::new(10, 2).unwrap();
        compose("push", &params, Some(&a), Some(&b), None, 0.5, &mut out);
        assert_eq!(px(&out, 2, 0), [255, 0, 0, 255]);
        assert_eq!(px(&out, 7, 0), [0, 0, 255, 255]);
    }
}
