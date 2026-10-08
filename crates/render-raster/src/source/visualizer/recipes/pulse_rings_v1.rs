//! `pulse-rings-v1`：`pulse_rings`（设计 §7.2）。
//!
//! 中央一个随低频呼吸的圆盘（`Core`，主色）+ `bands` 个随各自频带向外扩张的同心
//! 环（`Rings`，副色）。可用的 bin 等分成 `bands` 段，第 `k` 段的平均幅度经 `easing`
//! 驱动第 `k` 个环；圆盘跟着第 0 段（最低频）。
//!
//! 径向布局（`R` 是内切正方形的半边长，配方声明 `aspect: square`）：
//!
//! ```text
//! step   = (ringRadius − coreRadius) / (bands + 1)      // 每个环一个径向槽位，圆盘也占一个
//! core   = R · (coreRadius + step · a₀)                  // 圆盘在自己的槽位里呼吸
//! ring_k = R · (coreRadius + step · (k + 1) + step · a_k) // 静音时等距排开，有声时向外推
//! ```
//!
//! 环宽 `ringWidth × R`（以 `ring_k` 为中线）。静音时圆盘停在 `coreRadius`、环停在
//! 各自的静止位，画面仍然完整。一条圆盘 `FillPath` + `bands` 条环 `FillPath`，
//! 返回 `bands + 1`。

use motion::preset_registry::VisualizerBody;

use crate::drawop::{FrameBuilder, Mat6};
use crate::source::kernel::{DrawBox, ring_subpath};
use crate::source::visualizer::{VisualizerParams, VizFrame, freq_row};

use super::common::{band_amplitude, easing_of, push_fill};

pub(crate) fn draw(
    builder: &mut FrameBuilder,
    body: &VisualizerBody,
    params: &VisualizerParams,
    viz: &VizFrame,
    bbox: DrawBox,
    tf: Mat6,
) -> usize {
    let recipe = &body.recipe;
    let (Some(bands), Some(core_radius), Some(ring_radius), Some(ring_width)) = (
        recipe.integer("bands"),
        recipe.number("coreRadius"),
        recipe.number("ringRadius"),
        recipe.number("ringWidth"),
    ) else {
        return 0;
    };
    let easing = easing_of(recipe);
    let bands = bands as usize;
    let radius = bbox.w.min(bbox.h) / 2.0;
    if bands == 0 || !(radius > 0.0) {
        return 0;
    }
    let row = freq_row(viz, body.bin_width);
    let center = bbox.center();
    let core_radius = core_radius.clamp(0.0, 1.0);
    let ring_radius = ring_radius.clamp(core_radius, 1.0);
    let step = (ring_radius - core_radius) / (bands as f64 + 1.0);
    let amplitude = |band: usize| {
        let from = band as f64 / bands as f64;
        let to = (band as f64 + 1.0) / bands as f64;
        easing.apply(band_amplitude(row, from, to)).clamp(0.0, 1.0)
    };

    let mut pushed = 0;
    let core = radius * (core_radius + step * amplitude(0));
    let mut disc = Vec::with_capacity(8);
    ring_subpath(&mut disc, center, core, 0.0);
    pushed += usize::from(push_fill(builder, disc, params.main_color, tf));

    let half_width = ring_width.clamp(0.0, 1.0) * radius / 2.0;
    for band in 0..bands {
        let middle = radius * (core_radius + step * (band as f64 + 1.0) + step * amplitude(band));
        let outer = middle + half_width;
        let inner = (middle - half_width).max(0.0);
        if !(outer > inner) {
            continue;
        }
        let mut ring = Vec::with_capacity(16);
        ring_subpath(&mut ring, center, outer, inner);
        pushed += usize::from(push_fill(builder, ring, params.secondary_color, tf));
    }
    pushed
}
