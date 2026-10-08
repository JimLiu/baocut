//! `ribbons-v1`：`ribbons`（设计 §7.2）。
//!
//! `ribbonCount` 条正弦丝带横跨盒宽，围绕盒子中线摆动。可用的 bin 等分成
//! `ribbonCount` 段，第 `j` 条丝带的摆幅是第 `j` 段的平均幅度（占半盒高的分数）；
//! 相位随**元素本地时刻**流动（`speed` 是每秒走过的周期数），`cycles` 是横跨盒宽
//! 的周期数，各条丝带的初相等距错开一整圈。摆幅再乘 `sin(π·u)`——丝带在盒子左右
//! 两端收拢到中线，是这类视觉的经典形态。颜色从主色（第一条）到副色（最后一条）
//! 线性插值，标签 `Ribbon A` / `Ribbon B`。
//!
//! 静音时丝带摆幅为零，退化成 `ribbonCount` 条重合的中线。**唯一读时钟的算法**：
//! 同一帧频谱在不同时刻画出不同相位。每条丝带一条 `StrokePath`
//! （宽 `lineWidth × 盒高`），返回 `ribbonCount`。

use motion::preset_registry::VisualizerBody;

use crate::drawop::{FrameBuilder, Mat6};
use crate::source::kernel::{DrawBox, MID_V};
use crate::source::visualizer::{VisualizerParams, VizFrame, freq_row};

use super::common::{band_amplitude, mix_color, polyline, push_stroke};

pub(crate) fn draw(
    builder: &mut FrameBuilder,
    body: &VisualizerBody,
    params: &VisualizerParams,
    viz: &VizFrame,
    time: f64,
    bbox: DrawBox,
    tf: Mat6,
) -> usize {
    let recipe = &body.recipe;
    let (Some(count), Some(samples), Some(line_width), Some(speed), Some(cycles)) = (
        recipe.integer("ribbonCount"),
        recipe.integer("samples"),
        recipe.number("lineWidth"),
        recipe.number("speed"),
        recipe.number("cycles"),
    ) else {
        return 0;
    };
    let (count, samples) = (count as usize, samples as usize);
    if count == 0 || samples < 2 || !(bbox.w > 0.0 && bbox.h > 0.0) {
        return 0;
    }
    let row = freq_row(viz, body.bin_width);
    let width = line_width.clamp(0.0, 1.0) * bbox.h;
    let tau = std::f64::consts::TAU;
    let mut pushed = 0;
    for ribbon in 0..count {
        let from = ribbon as f64 / count as f64;
        let to = (ribbon as f64 + 1.0) / count as f64;
        let amplitude = band_amplitude(row, from, to).clamp(0.0, 1.0);
        let phase = tau * from - tau * speed * time;
        let points: Vec<(f64, f64)> = (0..samples)
            .map(|index| {
                let u = index as f64 / (samples - 1) as f64;
                let window = (std::f64::consts::PI * u).sin();
                let swing = amplitude * window * (tau * cycles * u + phase).sin();
                bbox.at(u, MID_V + swing * MID_V)
            })
            .collect();
        let t = if count > 1 {
            ribbon as f64 / (count - 1) as f64
        } else {
            0.0
        };
        let color = mix_color(params.main_color, params.secondary_color, t);
        pushed += usize::from(push_stroke(
            builder,
            polyline(&points, false),
            color,
            width,
            tf,
        ));
    }
    pushed
}
