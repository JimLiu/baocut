//! 七个声波配方共用的小件：频带幅度、颜色插值、压 path。
//!
//! 这里只有**换算**，没有任何样式参数（与 [`crate::source::kernel`] 同一纪律）。

use crate::drawop::{Color4, DrawOp, FrameBuilder, Mat6, PathData, PathSeg};
use crate::source::kernel::{Easing, path_seg_close, path_seg_line, path_seg_move};

/// 频域行在归一化区间 `[from, to)` 上的**平均幅度**（0..1）。
///
/// 分频带的样式（`pulse-rings-v1` / `ribbons-v1`）把可用的 bin 等分成 N 段，
/// 每段一个数；取平均而不是取峰值，是为了让一段里的单个尖峰不把整条环 / 丝带
/// 打满。区间至少覆盖一个 bin（`to` 向上取整、且不小于 `from + 1`）。
pub(crate) fn band_amplitude(row: &[u8], from: f64, to: f64) -> f64 {
    if row.is_empty() {
        return 0.0;
    }
    let len = row.len();
    let start = ((from * len as f64).floor().max(0.0) as usize).min(len - 1);
    let end = ((to * len as f64).ceil().max(0.0) as usize).clamp(start + 1, len);
    let sum: f64 = row[start..end].iter().map(|&b| f64::from(b)).sum();
    sum / ((end - start) as f64 * f64::from(u8::MAX))
}

/// 配方的 `easing` 字段 → 曲线；缺失或未知名按恒等处理。
///
/// 未知名在注册表解析期就被拦下（`manifest-invalid`），绘制端读到 `None` 只可能
/// 是有人绕过了注册表，此时不 panic。
pub(crate) fn easing_of(recipe: &motion::preset_registry::Recipe) -> Easing {
    recipe
        .text("easing")
        .and_then(Easing::parse)
        .unwrap_or(Easing::None)
}

/// 两色线性插值（逐通道，含 alpha），`t` 夹在 `[0, 1]`。
pub(crate) fn mix_color(a: Color4, b: Color4, t: f64) -> Color4 {
    let t = t.clamp(0.0, 1.0) as f32;
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
    ]
}

/// 一串画布点 → 折线子路径（`closed` 时收口）。少于两个点什么都不产生。
pub(crate) fn polyline(points: &[(f64, f64)], closed: bool) -> Vec<PathSeg> {
    let mut out = Vec::with_capacity(points.len() + 1);
    let Some((first, rest)) = points.split_first() else {
        return out;
    };
    if rest.is_empty() {
        return out;
    }
    out.push(path_seg_move(first.0, first.1));
    for point in rest {
        out.push(path_seg_line(point.0, point.1));
    }
    if closed {
        out.push(path_seg_close());
    }
    out
}

/// 压一条 `FillPath`；空 path 不压（返回 `false`）。
pub(crate) fn push_fill(
    builder: &mut FrameBuilder,
    path: Vec<PathSeg>,
    color: Color4,
    tf: Mat6,
) -> bool {
    if path.is_empty() {
        return false;
    }
    let id = builder.path_id(PathData(path));
    builder.push(DrawOp::FillPath {
        path: id,
        color,
        tf,
    });
    true
}

/// 压一条 `StrokePath`；空 path 或非正线宽不压（返回 `false`）。
pub(crate) fn push_stroke(
    builder: &mut FrameBuilder,
    path: Vec<PathSeg>,
    color: Color4,
    width: f64,
    tf: Mat6,
) -> bool {
    if path.is_empty() || !(width > 0.0) {
        return false;
    }
    let id = builder.path_id(PathData(path));
    builder.push(DrawOp::StrokePath {
        path: id,
        color,
        width: width as f32,
        tf,
    });
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn band_amplitude_averages_at_least_one_bin() {
        let row = [0u8, 255, 255, 0];
        assert_eq!(band_amplitude(&row, 0.0, 0.25), 0.0);
        assert_eq!(band_amplitude(&row, 0.25, 0.75), 1.0);
        assert_eq!(band_amplitude(&row, 0.0, 1.0), 0.5);
        // 区间退化到零宽也至少读一个 bin。
        assert_eq!(band_amplitude(&row, 0.5, 0.5), 1.0);
        assert_eq!(band_amplitude(&[], 0.0, 1.0), 0.0);
    }

    #[test]
    fn mix_color_interpolates_every_channel() {
        let mixed = mix_color([0.0, 0.0, 0.0, 0.0], [1.0, 0.5, 0.0, 1.0], 0.5);
        assert_eq!(mixed, [0.5, 0.25, 0.0, 0.5]);
        assert_eq!(
            mix_color([0.0; 4], [1.0; 4], 2.0),
            [1.0; 4],
            "t 夹在 [0, 1]"
        );
    }

    #[test]
    fn polyline_needs_two_points() {
        assert!(polyline(&[], false).is_empty());
        assert!(polyline(&[(0.0, 0.0)], true).is_empty());
        assert_eq!(polyline(&[(0.0, 0.0), (1.0, 1.0)], false).len(), 2);
        assert_eq!(polyline(&[(0.0, 0.0), (1.0, 1.0)], true).len(), 3);
    }
}
