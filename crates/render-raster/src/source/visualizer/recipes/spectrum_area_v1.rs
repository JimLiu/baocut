//! `spectrum-area-v1`：`spectrum_area`（设计 §7.2）。
//!
//! 频谱包络的**面积图**：横跨盒宽按 `samples` 个点取频谱幅度（经 `easing`、与
//! `minHeight` 取大），点连成折线，向下闭合到盒底填主色，再沿同一条折线用副色
//! 描一道边（宽 `lineWidth × 盒高`）。两种颜色标签是 `Fill` / `Line`。
//!
//! 一条 `FillPath` + 一条 `StrokePath`，返回 2。

use motion::preset_registry::VisualizerBody;

use crate::drawop::{FrameBuilder, Mat6};
use crate::source::kernel::{DrawBox, path_seg_close, path_seg_line, sample_row_linear};
use crate::source::visualizer::{VisualizerParams, VizFrame, freq_row};

use super::common::{easing_of, polyline, push_fill, push_stroke};

pub(crate) fn draw(
    builder: &mut FrameBuilder,
    body: &VisualizerBody,
    params: &VisualizerParams,
    viz: &VizFrame,
    bbox: DrawBox,
    tf: Mat6,
) -> usize {
    let recipe = &body.recipe;
    let (Some(samples), Some(min_height), Some(line_width)) = (
        recipe.integer("samples"),
        recipe.number("minHeight"),
        recipe.number("lineWidth"),
    ) else {
        return 0;
    };
    let easing = easing_of(recipe);
    let samples = samples as usize;
    if samples < 2 || !(bbox.w > 0.0 && bbox.h > 0.0) {
        return 0;
    }
    let row = freq_row(viz, body.bin_width);
    let points: Vec<(f64, f64)> = (0..samples)
        .map(|index| {
            let u = index as f64 / (samples - 1) as f64;
            let amplitude = easing
                .apply(sample_row_linear(row, u))
                .max(min_height)
                .clamp(0.0, 1.0);
            bbox.at(u, amplitude)
        })
        .collect();

    let mut area = polyline(&points, false);
    let (left, bottom) = bbox.at(0.0, 0.0);
    let (right, _) = bbox.at(1.0, 0.0);
    area.push(path_seg_line(right, bottom));
    area.push(path_seg_line(left, bottom));
    area.push(path_seg_close());
    let mut pushed = usize::from(push_fill(builder, area, params.main_color, tf));

    let width = line_width.clamp(0.0, 1.0) * bbox.h;
    pushed += usize::from(push_stroke(
        builder,
        polyline(&points, false),
        params.secondary_color,
        width,
        tf,
    ));
    pushed
}
