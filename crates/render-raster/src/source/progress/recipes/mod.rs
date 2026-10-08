//! progress 的绘制配方（设计 §7.4 的封闭算法名，一个算法名一个模块）。
//!
//! P3 落地三种（覆盖 6 个样式），P4 落地 `snake-v1`（覆盖 2 个）；rainbow /
//! strobe 四种是 P5（它们复用 `frame-v1` / `snake-v1` 的骨架，只换 `colorMode`）。

pub(crate) mod bar_v1;
pub(crate) mod frame_v1;
pub(crate) mod ring_v1;
pub(crate) mod snake_v1;

use crate::drawop::PathSeg;
use crate::source::kernel::DrawBox;

/// 四角等半径的圆角矩形（顺时针，起点在左上角圆弧结束处）。
///
/// 与 `apps/cli` 的 `element_draw::rounded_rect_path` 同形；那一份支持四角独立
/// 半径、服务 `ShapeProps.cornerRadius`，本函数只服务 `bar-v1` 的胶囊遮罩。
/// 设计 §9.1 要把 `element_draw` 整体下沉进本 crate，届时两者合并。
pub(crate) fn rounded_rect(bbox: DrawBox, radius: f64) -> Vec<PathSeg> {
    const KAPPA: f64 = 0.552_284_749_830_793_6;
    let DrawBox { x, y, w, h } = bbox;
    let r = radius.clamp(0.0, (w.min(h) / 2.0).max(0.0));
    let k = KAPPA * r;
    let seg = |verb: u8, pts: [f64; 6]| PathSeg {
        verb,
        pts: [
            pts[0] as f32,
            pts[1] as f32,
            pts[2] as f32,
            pts[3] as f32,
            pts[4] as f32,
            pts[5] as f32,
        ],
    };
    let line = |x: f64, y: f64| seg(1, [x, y, 0.0, 0.0, 0.0, 0.0]);
    let cubic = |c1: (f64, f64), c2: (f64, f64), to: (f64, f64)| {
        seg(3, [c1.0, c1.1, c2.0, c2.1, to.0, to.1])
    };
    let mut out = vec![seg(0, [x + r, y, 0.0, 0.0, 0.0, 0.0])];
    out.push(line(x + w - r, y));
    if r > 0.0 {
        out.push(cubic(
            (x + w - r + k, y),
            (x + w, y + r - k),
            (x + w, y + r),
        ));
    }
    out.push(line(x + w, y + h - r));
    if r > 0.0 {
        out.push(cubic(
            (x + w, y + h - r + k),
            (x + w - r + k, y + h),
            (x + w - r, y + h),
        ));
    }
    out.push(line(x + r, y + h));
    if r > 0.0 {
        out.push(cubic(
            (x + r - k, y + h),
            (x, y + h - r + k),
            (x, y + h - r),
        ));
    }
    out.push(line(x, y + r));
    if r > 0.0 {
        out.push(cubic((x, y + r - k), (x + r - k, y), (x + r, y)));
    }
    out.push(seg(4, [0.0; 6]));
    out
}
