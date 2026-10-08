//! `spectrum-bars-v1`：`bars` / `bars_rounded` / `bars_bottom`（设计 §7.2）。
//!
//! 最经典的频谱柱：把可用的 bin 等分成 `barCount` 个槽位，每根柱子的高度是槽中心
//! 处的频谱幅度经 `easing` 再与 `minHeight` 取大（静音时留一排短柱，元素不会
//! "消失"）。三款样式全靠参数区分：
//!
//! | 样式 | `barCount` | `align` | `gap` | `radius` | `minHeight` |
//! | --- | --- | --- | --- | --- | --- |
//! | `bars` | 48 | mirror | 0.35 | 0 | 0.02 |
//! | `bars_rounded` | 32 | mirror | 0.45 | 1 | 0.06 |
//! | `bars_bottom` | 64 | bottom | 0.25 | 0 | 0.02 |
//!
//! * `align: mirror` 以盒子中线上下对称，`bottom` 贴盒底向上长；
//! * `gap` 是**槽宽的分数**（0 = 柱子铺满槽位），柱子在槽内居中；
//! * `radius` 是圆角占"柱宽与柱高之较小者的一半"的分数——`1` 就是两端全圆的
//!   胶囊，任何柱高下都不会出现自交的圆角。
//!
//! 每根柱一条 `FillRect`，返回 `barCount`。只用主色。

use motion::preset_registry::VisualizerBody;

use crate::drawop::{DrawOp, FrameBuilder, Mat6};
use crate::source::kernel::{DrawBox, sample_row_linear};
use crate::source::visualizer::{VisualizerParams, VizFrame, freq_row};

use super::common::easing_of;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Align {
    Mirror,
    Bottom,
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
    let (Some(bar_count), Some(align), Some(gap), Some(radius), Some(min_height)) = (
        recipe.integer("barCount"),
        recipe.text("align").and_then(|name| match name {
            "mirror" => Some(Align::Mirror),
            "bottom" => Some(Align::Bottom),
            _ => None,
        }),
        recipe.number("gap"),
        recipe.number("radius"),
        recipe.number("minHeight"),
    ) else {
        return 0;
    };
    let easing = easing_of(recipe);
    let bar_count = bar_count as usize;
    if bar_count == 0 || !(bbox.w > 0.0 && bbox.h > 0.0) {
        return 0;
    }
    let row = freq_row(viz, body.bin_width);
    let slot = bbox.w / bar_count as f64;
    let bar_w = slot * (1.0 - gap.clamp(0.0, 1.0));
    if !(bar_w > 0.0) {
        return 0;
    }
    let mut pushed = 0;
    for index in 0..bar_count {
        let u = (index as f64 + 0.5) / bar_count as f64;
        let amplitude = easing
            .apply(sample_row_linear(row, u))
            .max(min_height)
            .clamp(0.0, 1.0);
        let h = amplitude * bbox.h;
        if !(h > 0.0) {
            continue;
        }
        let x = bbox.x + slot * index as f64 + (slot - bar_w) / 2.0;
        let y = match align {
            Align::Mirror => bbox.y + (bbox.h - h) / 2.0,
            Align::Bottom => bbox.y + bbox.h - h,
        };
        let corner = radius.clamp(0.0, 1.0) * (bar_w.min(h) / 2.0);
        builder.push(DrawOp::FillRect {
            x: x as f32,
            y: y as f32,
            w: bar_w as f32,
            h: h as f32,
            radius: corner as f32,
            color: params.main_color,
            tf,
        });
        pushed += 1;
    }
    pushed
}
