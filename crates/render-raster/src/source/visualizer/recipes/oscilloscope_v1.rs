//! `oscilloscope-v1`：`oscilloscope` / `ring_wave`（设计 §7.2）。
//!
//! 唯一读**时域行**的算法：把一帧波形按 `samples` 个点采样成一条折线描边。
//! 波形字节以 [`TIME_DOMAIN_SILENCE`]（128）为零点，`amplitude` 是满摆幅占
//! 半盒高（或半径带宽）的分数。
//!
//! | 样式 | `layout` | `samples` | `lineWidth` | `amplitude` | `baseRadius` |
//! | --- | --- | --- | --- | --- | --- |
//! | `oscilloscope` | linear | 128 | 0.02 | 0.9 | 0 |
//! | `ring_wave` | polar | 128 | 0.015 | 0.6 | 0.6 |
//!
//! * `linear`：横跨盒宽，围绕盒子中线上下摆动；
//! * `polar`：绕内切圆一圈（从正上方起顺时针），基圆半径 `baseRadius × R`，
//!   摆幅在 `[baseRadius, 1] × R` 里，路径闭合成环。
//!
//! 静音也画一条直线 / 一个圆——示波器没信号时屏幕上就是那条线。
//! 一条 `StrokePath`（宽 `lineWidth × 盒高`），返回 1。只用主色。

use motion::preset_registry::VisualizerBody;

use crate::drawop::{FrameBuilder, Mat6};
use crate::source::kernel::{DrawBox, MID_V, polar, sample_row_linear};
use crate::source::visualizer::{TIME_DOMAIN_SILENCE, VisualizerParams, VizFrame, time_row};

use super::common::{polyline, push_stroke};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Layout {
    Linear,
    Polar,
}

pub(crate) fn draw(
    builder: &mut FrameBuilder,
    body: &VisualizerBody,
    params: &VisualizerParams,
    viz: &VizFrame,
    bbox: DrawBox,
    tf: Mat6,
) -> usize {
    let recipe = &body.recipe;
    let (Some(layout), Some(samples), Some(line_width), Some(amplitude), Some(base_radius)) = (
        recipe.text("layout").and_then(|name| match name {
            "linear" => Some(Layout::Linear),
            "polar" => Some(Layout::Polar),
            _ => None,
        }),
        recipe.integer("samples"),
        recipe.number("lineWidth"),
        recipe.number("amplitude"),
        recipe.number("baseRadius"),
    ) else {
        return 0;
    };
    let samples = samples as usize;
    if samples < 2 || !(bbox.w > 0.0 && bbox.h > 0.0) {
        return 0;
    }
    let row = time_row(viz, body.bin_width);
    let zero = f64::from(TIME_DOMAIN_SILENCE) / f64::from(u8::MAX);
    // 波形值：以静音电平为零点的 [-1, 1]，再乘摆幅。
    let value = |u: f64| ((sample_row_linear(&row, u) - zero) * 2.0 * amplitude).clamp(-1.0, 1.0);

    let points: Vec<(f64, f64)> = match layout {
        Layout::Linear => (0..samples)
            .map(|index| {
                let u = index as f64 / (samples - 1) as f64;
                bbox.at(u, MID_V + value(u) * MID_V)
            })
            .collect(),
        Layout::Polar => {
            let radius = bbox.w.min(bbox.h) / 2.0;
            let base = base_radius.clamp(0.0, 1.0) * radius;
            let center = bbox.center();
            (0..samples)
                .map(|index| {
                    // 闭环：最后一个点不与第一个点重合，`close` 收口。
                    let u = index as f64 / samples as f64;
                    let r = (base + value(u) * (radius - base)).max(0.0);
                    polar(center, r, u * std::f64::consts::TAU)
                })
                .collect()
        }
    };
    let path = polyline(&points, layout == Layout::Polar);
    let width = line_width.clamp(0.0, 1.0) * bbox.h;
    usize::from(push_stroke(builder, path, params.main_color, width, tf))
}
