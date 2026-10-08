//! `frame-v1`：`border` / `reverse_border`（设计 §7.4）。
//!
//! 参考实现 `progress_border.frag` / `progress_reverse_border.frag` 用四个
//! box SDF 拼边框，`clamp(b1 + b2 + b3 + b4, 0, 1)` 求并集。矢量侧把四条边
//! 放进**同一条 path 的四个子路径**、按 nonzero 填充——同向子路径的并集正是
//! `clamp(..., 0, 1)` 的意思，而拆成四条 `FillRect` 会在拐角处把半透明色叠两次。
//!
//! ## 边框粗细
//!
//! `barSize = BORDER_SIZE · sourceAspect.yx`，两个轴换算到像素后都等于
//! `borderSize · max(w, h)`——参考实现绕这一圈就是为了让横竖两条边**一样粗**。
//! 矢量侧直接用这个结论。
//!
//! ## 两种填充方向（`fill` 参数）
//!
//! * `"forward"`：周长按 `w : h = srcRes.x : srcRes.y`（两者之和归一）分成两段，
//!   **两条臂同时从左下角出发**——一条沿下边向右再沿右边向上，另一条沿左边向上
//!   再沿上边向右，`progress == 1` 时在右上角会合。
//! * `"reverse"`：用 `1 − progress` 当长度，从**左下**与**右上**两个角各伸出一个
//!   L 形，长度在两个轴上都直接是归一化的 `1 − progress`（参考实现在这一支
//!   **没有**做周长归一化，如实照搬）。
//!
//! ## 三种 `colorMode`（P5b 补齐后两种，determinism = `visual`）
//!
//! * `"solid"`：进度框整条用主色，strict。
//! * `"rainbow"`：四角基色各走一趟 **hue 循环**（`hue += sin(t) · hueSpeed`），
//!   再按归一化位置双线性插值，最后与白色按 `mixBias + (sin t·½+½)·mixGain` 相混。
//!   颜色**逐点不同**，而 DrawOp 的 `FillPath` 只有一枚纯色——CPU 参照因此走
//!   "压一层进度框的 `ClipPath`，再铺一张 `gradientSteps × gradientSteps` 的
//!   色块网格"这条降采样近似（§8.7 visual 档）。像素真相在 WGSL。
//! * `"strobe"`：四角是 `main / secondary / main / secondary`，采样点是**常数**
//!   `(s, −s)`，因此 `fourCornerGradient` 退化成 `mix(main, secondary, s)`——
//!   整框同色，CPU 侧一条 `FillPath` 就够，**没有近似**。
//!
//! 参考实现的 `progressColour *= u_mainColor.a` 里那个 `a` 与四角基色自带的
//! alpha 是两回事：前者是元素透明度（host 已经折进 `params.main_color`），
//! 后者恒为 1。两边都按"alpha = 主色 alpha"读。

use motion::preset_registry::ProgressBody;
use serde_json::Value;

use crate::drawop::{Color4, DrawOp, FrameBuilder, Mat6, PathData, PathSeg};
use crate::source::kernel::{DrawBox, rect_subpath};
use crate::source::progress::ProgressParams;

pub(crate) fn draw(
    builder: &mut FrameBuilder,
    body: &ProgressBody,
    params: &ProgressParams,
    progress: f64,
    time: f64,
    bbox: DrawBox,
    tf: Mat6,
) -> usize {
    let recipe = &body.recipe;
    let (Some(border_size), Some(fill), Some(background), Some(mode)) = (
        recipe.number("borderSize"),
        recipe.text("fill"),
        recipe.flag("background"),
        recipe.object("colorMode"),
    ) else {
        return 0;
    };
    // 按**数据**分派（`colorMode.kind`），不按 id 列黑名单。
    let kind = mode.get("kind").and_then(Value::as_str).unwrap_or("solid");
    let thickness = border_size * bbox.w.max(bbox.h);
    if !(thickness > 0.0) {
        return 0;
    }
    let before = builder.frame.ops.len();

    if background {
        let mut path = Vec::new();
        push_edge(&mut path, bbox, thickness, Edge::Bottom, 0.0, 1.0);
        push_edge(&mut path, bbox, thickness, Edge::Top, 0.0, 1.0);
        push_edge(&mut path, bbox, thickness, Edge::Left, 0.0, 1.0);
        push_edge(&mut path, bbox, thickness, Edge::Right, 0.0, 1.0);
        if !path.is_empty() {
            let path = builder.path_id(PathData(path));
            builder.push(DrawOp::FillPath {
                path,
                color: params.secondary_color,
                tf,
            });
        }
    }

    let mut path = Vec::new();
    if fill == "reverse" {
        // 满进度时整圈消失：参考实现的 `if (progress > 0.0)` 守卫。
        let reach = 1.0 - progress;
        if reach > 0.0 {
            push_edge(&mut path, bbox, thickness, Edge::Bottom, 0.0, reach);
            push_edge(&mut path, bbox, thickness, Edge::Left, 0.0, reach);
            push_edge(&mut path, bbox, thickness, Edge::Top, 1.0 - reach, 1.0);
            push_edge(&mut path, bbox, thickness, Edge::Right, 1.0 - reach, 1.0);
        }
    } else if progress > 0.0 {
        // 周长归一：横向段占 w/(w+h)，纵向段占 h/(w+h)。
        let span = bbox.w + bbox.h;
        let (across, up) = (bbox.w / span, bbox.h / span);
        let leg = |from: f64, to: f64| -> f64 {
            if to <= from {
                0.0
            } else {
                ((progress - from) / (to - from)).clamp(0.0, 1.0)
            }
        };
        push_edge(
            &mut path,
            bbox,
            thickness,
            Edge::Bottom,
            0.0,
            leg(0.0, across),
        );
        push_edge(&mut path, bbox, thickness, Edge::Left, 0.0, leg(0.0, up));
        push_edge(&mut path, bbox, thickness, Edge::Top, 0.0, leg(up, 1.0));
        push_edge(
            &mut path,
            bbox,
            thickness,
            Edge::Right,
            0.0,
            leg(across, 1.0),
        );
    }
    if !path.is_empty() {
        let id = builder.path_id(PathData(path));
        match kind {
            // hue 循环：进度框当裁剪面，色块网格填进去（见模块文档）。
            "rainbow" => push_gradient_fill(builder, mode, params, time, bbox, id, tf),
            // 频闪：整框同色，一条 `FillPath`。
            "strobe" => builder.push(DrawOp::FillPath {
                path: id,
                color: strobe_color(mode, params, time),
                tf,
            }),
            _ => builder.push(DrawOp::FillPath {
                path: id,
                color: params.main_color,
                tf,
            }),
        }
    }
    builder.frame.ops.len() - before
}

/// `mixBias + (sin t · ½ + ½) · mixGain`：白色与渐变色的混合量。
fn mix_amount(mode: &serde_json::Map<String, Value>, time: f64) -> f64 {
    let number = |key: &str| mode.get(key).and_then(Value::as_f64).unwrap_or_default();
    number("mixBias") + (time.sin() * 0.5 + 0.5) * number("mixGain")
}

/// `mix(vec3(1), rgb, amount)`，alpha 取主色的 alpha（元素透明度）。
fn toward_white(rgb: [f64; 3], amount: f64, alpha: f32) -> Color4 {
    [
        (1.0 + (rgb[0] - 1.0) * amount) as f32,
        (1.0 + (rgb[1] - 1.0) * amount) as f32,
        (1.0 + (rgb[2] - 1.0) * amount) as f32,
        alpha,
    ]
}

fn strobe_color(
    mode: &serde_json::Map<String, Value>,
    params: &ProgressParams,
    time: f64,
) -> Color4 {
    let speed = mode
        .get("speed")
        .and_then(Value::as_f64)
        .unwrap_or_default();
    let s = (time * speed).sin() * 0.5 + 0.5;
    // 四角是 `main / secondary / main / secondary` 且采样点是常数 `(s, −s)`：
    // 上下两条边插出来的是同一枚颜色，纵向那次 `mix` 因此退化。
    let blend = |slot: usize| {
        f64::from(params.main_color[slot])
            + (f64::from(params.secondary_color[slot]) - f64::from(params.main_color[slot])) * s
    };
    toward_white(
        [blend(0), blend(1), blend(2)],
        mix_amount(mode, time),
        params.main_color[3],
    )
}

/// hue 循环的四角渐变：`gradientSteps × gradientSteps` 的色块网格，压在进度框的
/// `ClipPath` 里。这是本样式**唯一**的近似点（§8.7 visual 档）。
fn push_gradient_fill(
    builder: &mut FrameBuilder,
    mode: &serde_json::Map<String, Value>,
    params: &ProgressParams,
    time: f64,
    bbox: DrawBox,
    clip: u32,
    tf: Mat6,
) {
    let steps = mode
        .get("gradientSteps")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .max(1) as usize;
    let hue_speed = mode
        .get("hueSpeed")
        .and_then(Value::as_f64)
        .unwrap_or_default();
    let shift = time.sin() * hue_speed;
    let corners: Vec<[f64; 3]> = mode
        .get("corners")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .map(|entry| {
                    let channel = |slot: usize| {
                        entry
                            .as_array()
                            .and_then(|rgba| rgba.get(slot))
                            .and_then(Value::as_f64)
                            .unwrap_or_default()
                    };
                    hue_cycled([channel(0), channel(1), channel(2)], shift)
                })
                .collect()
        })
        .unwrap_or_default();
    if corners.len() < 4 {
        return;
    }
    let amount = mix_amount(mode, time);
    builder.push(DrawOp::ClipPath { path: clip, tf });
    for row in 0..steps {
        for column in 0..steps {
            // 色块取自己中心那一点的渐变色；uv 是 **v 向上**（与 WGSL 侧同一套）。
            let u = (column as f64 + 0.5) / steps as f64;
            let v = (row as f64 + 0.5) / steps as f64;
            let blend = |slot: usize| {
                let top = corners[0][slot] + (corners[1][slot] - corners[0][slot]) * u;
                let bottom = corners[2][slot] + (corners[3][slot] - corners[2][slot]) * u;
                top + (bottom - top) * v
            };
            let color = toward_white([blend(0), blend(1), blend(2)], amount, params.main_color[3]);
            let (x, y) = bbox.at(u - 0.5 / steps as f64, v + 0.5 / steps as f64);
            builder.push(DrawOp::FillRect {
                x: x as f32,
                y: y as f32,
                // 相邻色块多铺半格：整数像素上不留缝（裁剪面挡住外溢）。
                w: (bbox.w / steps as f64 + 1.0) as f32,
                h: (bbox.h / steps as f64 + 1.0) as f32,
                radius: 0.0,
                color,
                tf,
            });
        }
    }
    builder.push(DrawOp::PopClip);
}

/// 一枚 rgb 沿 hue 轴平移 `shift`（参考实现的 `animate()`：rgb → hsv → rgb）。
fn hue_cycled(rgb: [f64; 3], shift: f64) -> [f64; 3] {
    let (mut h, s, v) = rgb_to_hsv(rgb);
    h += shift;
    hsv_to_rgb(h, s, v)
}

fn rgb_to_hsv(rgb: [f64; 3]) -> (f64, f64, f64) {
    let max = rgb[0].max(rgb[1]).max(rgb[2]);
    let min = rgb[0].min(rgb[1]).min(rgb[2]);
    let delta = max - min;
    // 与参考实现同一条防零除的 ε。
    let epsilon = 1.0e-10;
    let hue = if delta <= epsilon {
        0.0
    } else if max == rgb[0] {
        ((rgb[1] - rgb[2]) / delta).rem_euclid(6.0) / 6.0
    } else if max == rgb[1] {
        ((rgb[2] - rgb[0]) / delta + 2.0) / 6.0
    } else {
        ((rgb[0] - rgb[1]) / delta + 4.0) / 6.0
    };
    (hue, delta / (max + epsilon), max)
}

fn hsv_to_rgb(h: f64, s: f64, v: f64) -> [f64; 3] {
    let channel = |offset: f64| {
        let p = ((h + offset).rem_euclid(1.0) * 6.0 - 3.0).abs();
        v * (1.0 + ((p - 1.0).clamp(0.0, 1.0) - 1.0) * s)
    };
    [channel(1.0), channel(2.0 / 3.0), channel(1.0 / 3.0)]
}

/// 四条边。`from` / `to` 是沿该边的归一化区间，方向与参考实现的四个 box 一致：
/// 下边与上边**自左向右**、左边与右边**自下向上**。
#[derive(Clone, Copy)]
enum Edge {
    Bottom,
    Top,
    Left,
    Right,
}

fn push_edge(
    out: &mut Vec<PathSeg>,
    bbox: DrawBox,
    thickness: f64,
    edge: Edge,
    from: f64,
    to: f64,
) {
    if !(to > from) {
        return;
    }
    match edge {
        Edge::Bottom => rect_subpath(
            out,
            bbox.x + bbox.w * from,
            bbox.y + bbox.h - thickness,
            bbox.w * (to - from),
            thickness,
        ),
        Edge::Top => rect_subpath(
            out,
            bbox.x + bbox.w * from,
            bbox.y,
            bbox.w * (to - from),
            thickness,
        ),
        Edge::Left => rect_subpath(
            out,
            bbox.x,
            bbox.y + bbox.h * (1.0 - to),
            thickness,
            bbox.h * (to - from),
        ),
        Edge::Right => rect_subpath(
            out,
            bbox.x + bbox.w - thickness,
            bbox.y + bbox.h * (1.0 - to),
            thickness,
            bbox.h * (to - from),
        ),
    }
}
