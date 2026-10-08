//! `polar-bars-v1`：`ring_bars`（设计 §7.2）。
//!
//! 频谱柱绕成一圈：`barCount` 根柱子沿圆周等角分布（从正上方起顺时针），每根柱子
//! 是一段环形扇区，内沿固定在 `innerRadius × R`，外沿按幅度在 `[innerRadius, 1] × R`
//! 之间伸缩（`R` 是内切正方形的半边长，配方声明 `aspect: square`）。
//!
//! * `gap` 是**角向槽位的分数**，扇区在槽内居中；
//! * `minHeight` 与 `easing` 的语义同 `spectrum-bars-v1`。
//!
//! 每根柱一条 `FillPath`（[`sector_subpath`]），返回 `barCount`。扇区外沿最多到
//! `R`，整体落在盒内，不需要裁剪。

use motion::preset_registry::VisualizerBody;

use crate::drawop::{FrameBuilder, Mat6};
use crate::source::kernel::{DrawBox, sample_row_linear, sector_subpath};
use crate::source::visualizer::{VisualizerParams, VizFrame, freq_row};

use super::common::{easing_of, push_fill};

pub(crate) fn draw(
    builder: &mut FrameBuilder,
    body: &VisualizerBody,
    params: &VisualizerParams,
    viz: &VizFrame,
    bbox: DrawBox,
    tf: Mat6,
) -> usize {
    let recipe = &body.recipe;
    let (Some(bar_count), Some(inner_radius), Some(gap), Some(min_height)) = (
        recipe.integer("barCount"),
        recipe.number("innerRadius"),
        recipe.number("gap"),
        recipe.number("minHeight"),
    ) else {
        return 0;
    };
    let easing = easing_of(recipe);
    let bar_count = bar_count as usize;
    let radius = bbox.w.min(bbox.h) / 2.0;
    if bar_count == 0 || !(radius > 0.0) {
        return 0;
    }
    let row = freq_row(viz, body.bin_width);
    let center = bbox.center();
    let inner = inner_radius.clamp(0.0, 1.0) * radius;
    let slot = std::f64::consts::TAU / bar_count as f64;
    let half_gap = slot * gap.clamp(0.0, 1.0) / 2.0;
    let mut pushed = 0;
    for index in 0..bar_count {
        let u = (index as f64 + 0.5) / bar_count as f64;
        let amplitude = easing
            .apply(sample_row_linear(row, u))
            .max(min_height)
            .clamp(0.0, 1.0);
        let outer = inner + amplitude * (radius - inner);
        if !(outer > inner) {
            continue;
        }
        let from = slot * index as f64 + half_gap;
        let to = slot * (index as f64 + 1.0) - half_gap;
        if !(to > from) {
            continue;
        }
        let mut path = Vec::with_capacity(8);
        sector_subpath(&mut path, center, outer, inner, from, to);
        if push_fill(builder, path, params.main_color, tf) {
            pushed += 1;
        }
    }
    pushed
}
