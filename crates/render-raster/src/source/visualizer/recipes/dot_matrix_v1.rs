//! `dot-matrix-v1`：`dots`（设计 §7.2）。
//!
//! LED 点阵式频谱：盒子分成 `columns × rows` 个格子，每列的频谱幅度经 `easing`
//! 决定从底部起点亮几行（四舍五入到整行，**至少一行**——静音时留一排底灯，元素
//! 不会消失）。点亮的点用主色（`Dots`），每列最高的那颗用副色（`Peaks`）。
//!
//! `dotRadius` 是点半径占**格子边长（取宽高较小者）**的分数。每颗点一条圆角
//! 全圆的 `FillRect`，返回点亮的总颗数。

use motion::preset_registry::VisualizerBody;

use crate::drawop::{DrawOp, FrameBuilder, Mat6};
use crate::source::kernel::{DrawBox, sample_row_linear};
use crate::source::visualizer::{VisualizerParams, VizFrame, freq_row};

use super::common::easing_of;

pub(crate) fn draw(
    builder: &mut FrameBuilder,
    body: &VisualizerBody,
    params: &VisualizerParams,
    viz: &VizFrame,
    bbox: DrawBox,
    tf: Mat6,
) -> usize {
    let recipe = &body.recipe;
    let (Some(columns), Some(rows), Some(dot_radius)) = (
        recipe.integer("columns"),
        recipe.integer("rows"),
        recipe.number("dotRadius"),
    ) else {
        return 0;
    };
    let easing = easing_of(recipe);
    let (columns, rows) = (columns as usize, rows as usize);
    if columns == 0 || rows == 0 || !(bbox.w > 0.0 && bbox.h > 0.0) {
        return 0;
    }
    let row = freq_row(viz, body.bin_width);
    let cell_w = bbox.w / columns as f64;
    let cell_h = bbox.h / rows as f64;
    let radius = dot_radius.clamp(0.0, 1.0) * cell_w.min(cell_h);
    if !(radius > 0.0) {
        return 0;
    }
    let mut pushed = 0;
    for column in 0..columns {
        let u = (column as f64 + 0.5) / columns as f64;
        let amplitude = easing.apply(sample_row_linear(row, u)).clamp(0.0, 1.0);
        let lit = ((amplitude * rows as f64).round() as usize).clamp(1, rows);
        let cx = bbox.x + cell_w * (column as f64 + 0.5);
        for level in 0..lit {
            let cy = bbox.y + bbox.h - cell_h * (level as f64 + 0.5);
            let color = if level + 1 == lit {
                params.secondary_color
            } else {
                params.main_color
            };
            builder.push(DrawOp::FillRect {
                x: (cx - radius) as f32,
                y: (cy - radius) as f32,
                w: (radius * 2.0) as f32,
                h: (radius * 2.0) as f32,
                radius: radius as f32,
                color,
                tf,
            });
            pushed += 1;
        }
    }
    pushed
}
