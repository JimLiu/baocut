//! `snake-v1`：`snake` / `snake_spin`（设计 §7.4）。
//!
//! 参考实现（`progress_snake.frag` / `progress_snake_spin.frag`）的 `circleRing()`
//! 是一个**逐度循环**：自 `startAngleDeg` 起，每 `angleIncrementDeg` 放一个半径
//! `dotRadius` 的软边小圆，把它们的 alpha 累加再 `min(…, 1)`；圈数由
//! `round(进度 × 一整圈的步数)` 决定，上限 `maxIterations`。底环用进度 1 画一次
//! （副色），进度环用当前进度画一次（主色），再 `mix` 叠上去。
//!
//! ## 逐度循环 → 扫掠并集（P4 定案）
//!
//! 圆心间距（0.4 半径上的 1° ≈ 0.007）只有圆半径（0.1）的十四分之一，叠加场在
//! 并集内部**早就饱和**，半覆盖等值线于是就是并集的边界本身。而"圆盘沿圆弧扫过
//! 的并集"有闭式（[`swept_arc_subpath`]），逐度循环因此只剩**定圈数**这一件事。
//! `maxIterations` / `angleIncrementDeg` / `startAngleDeg` 仍是数据真相，一个都
//! 没搬进 Rust；换来的是"圈数 360 时也只有一条 path"而不是 360 个子路径。
//!
//! **`smoothing` 与 `boostSteps` 不读**（P3 记录第 2 条那一类：纯 alpha 过渡带宽）。
//! 密集叠加下并集的边界正是 `dotRadius` 本身，`smoothing` 退化成边缘的抗锯齿；
//! `boostSteps`（圈数 < 1 / < 2 时把 alpha 乘 3 / 2）存在的意义是"圆太少时让它更
//! 显眼"，矢量侧那一两个圆本来就是实心满半径，比参考实现还显眼。P5 的 WGSL 会
//! 逐字用上这两个参数。
//!
//! ## 角度换算
//!
//! 参考实现在 v 向上的 `texCoord` 里算 `pos + (cos a, sin a) · dist`，圆心因此在
//! `0.5 − dist · (cos a, sin a)`；而 [`polar`] 的零角在正上方、顺时针为正。两者的
//! 换算是 `phi = −(π/2 + a)`：`a = 270°` ⇒ `phi = 0`（正上方），`a` 每减 1° ⇒
//! `phi` 加 1°（顺时针）。那个 π/2 是坐标系零角的差，不是样式参数。

use motion::preset_registry::ProgressBody;

use crate::drawop::{Color4, DrawOp, FrameBuilder, Mat6, PathData};
use crate::source::kernel::{DrawBox, sector_subpath, swept_arc_subpath};
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
    let (
        Some(dot_ratio),
        Some(orbit_ratio),
        Some(start_angle),
        Some(increment),
        Some(max_iterations),
        Some(color_mode),
    ) = (
        recipe.number("dotRadius"),
        recipe.number("orbitRadius"),
        recipe.number("startAngleDeg"),
        recipe.number("angleIncrementDeg"),
        recipe.integer("maxIterations"),
        recipe.object("colorMode"),
    )
    else {
        return 0;
    };
    // `colorMode.kind` 按 tag 分派而不是按 id 列黑名单（与 `frame-v1` 同一规矩）。
    let rainbow = color_mode.get("kind").and_then(serde_json::Value::as_str) == Some("rainbow");
    let track_color = match color_mode
        .get("trackColor")
        .and_then(serde_json::Value::as_str)
    {
        Some("main") => params.main_color,
        _ => params.secondary_color,
    };
    // `aspect: "square"` 已经在 `progress_frame` 里取过内切正方形；参考实现的
    // 长度全在归一化 `texCoord` 里，因此以边长为单位。
    let side = bbox.w.min(bbox.h);
    let (center, orbit, dot) = (bbox.center(), orbit_ratio * side, dot_ratio * side);
    if !(dot > 0.0) {
        return 0;
    }
    let increment = increment.to_radians();
    if increment == 0.0 {
        return 0;
    }
    // 自转：`offset = −mod(t · speed, 360°)` 加在 `a` 上（底环与进度环同一个偏移）。
    let spin = recipe
        .object("spin")
        .and_then(|object| object.get("speedDegPerSec"))
        .and_then(serde_json::Value::as_f64)
        .map(|speed| {
            let turn = 360.0;
            -(time * speed).rem_euclid(turn)
        })
        .unwrap_or(0.0);
    // `phi = −(π/2 + a)`（见模块文档）。
    let phi_start = -(std::f64::consts::FRAC_PI_2 + (start_angle + spin).to_radians());

    let before = builder.frame.ops.len();
    // 底环（进度 1）在下，进度环在上——参考实现的 `mix(bot, top, top.a)`。
    let push_arc = |builder: &mut FrameBuilder, from: f64, to: f64, color: Color4| {
        let mut path = Vec::new();
        swept_arc_subpath(&mut path, center, orbit, dot, from, to);
        if !path.is_empty() {
            let path = builder.path_id(PathData(path));
            builder.push(DrawOp::FillPath { path, color, tf });
        }
    };

    let track_dots = dot_count(1.0, increment, max_iterations);
    push_arc(
        builder,
        phi_start,
        phi_start - (track_dots - 1) as f64 * increment,
        track_color,
    );

    let dots = dot_count(progress, increment, max_iterations);
    let phi_end = phi_start - (dots - 1) as f64 * increment;
    if rainbow {
        // ── `visual` 档的近似（§8.7）。参考实现的彩虹是**逐片元**的
        //    `hue = 该点的极角 / 2π + ½`、`saturation = 该点的半径 × 2`——
        //    颜色属于**像素的位置**，不属于哪一颗小圆。矢量侧因此：
        //    ① 把整条进度弧压成一层 `ClipPath`；② 在里面铺一张
        //    `hueSteps × radialSteps` 的极坐标色块网格，每块取自己中心那一色。
        //    这样 hue 与 saturation 都跟着**片元的位置**走，与参考实现同构；
        //    像素真相仍在 WGSL。
        let steps = |key: &str, fallback: u64| {
            color_mode
                .get(key)
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(fallback)
                .max(1)
        };
        let hue_steps = steps("hueSteps", 1);
        let radial_steps = steps("radialSteps", 1);
        let speed = color_mode
            .get("rotationSpeedDegPerSec")
            .and_then(serde_json::Value::as_f64)
            .unwrap_or_default();
        let from_radius = color_mode
            .get("saturationFromRadius")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let alpha = params.main_color[3];

        let mut clip = Vec::new();
        swept_arc_subpath(&mut clip, center, orbit, dot, phi_start, phi_end);
        if !clip.is_empty() {
            let clip = builder.path_id(PathData(clip));
            builder.push(DrawOp::ClipPath { path: clip, tf });
            // 网格只铺到进度弧的角向范围（两端各留一个小圆的张角）。
            let cap = (dot / orbit).clamp(-1.0, 1.0).asin();
            let (lo, hi) = if phi_end >= phi_start {
                (phi_start - cap, phi_end + cap)
            } else {
                (phi_end - cap, phi_start + cap)
            };
            let wedges = ((hi - lo) / std::f64::consts::TAU * hue_steps as f64).ceil() as u64;
            // **相邻色块要叠半个像素**：各自一条 `FillPath` 的话，贴着的两条边
            // 会被光栅器各算一次抗锯齿再 alpha-over（`a + a(1−a) = 0.75`），
            // 一张网格上于是布满暗接缝。叠上去让后画的那块盖住交界，误差从
            // "四分之一的暗线"降成"半个像素的颜色偏移"。（柱状族那边因为整场
            // 同色，用的是"压进同一条 path 求并集"那条更干净的手法。）
            let bleed = 0.5;
            for wedge in 0..wedges.max(1) {
                let from = lo + (hi - lo) * wedge as f64 / wedges.max(1) as f64;
                let to = lo + (hi - lo) * (wedge + 1) as f64 / wedges.max(1) as f64;
                for band in 0..radial_steps {
                    let inner = orbit - dot + 2.0 * dot * band as f64 / radial_steps as f64;
                    let outer = orbit - dot + 2.0 * dot * (band + 1) as f64 / radial_steps as f64;
                    let saturation = if from_radius {
                        ((inner + outer) / side).clamp(0.0, 1.0)
                    } else {
                        1.0
                    };
                    let mut path = Vec::new();
                    sector_subpath(
                        &mut path,
                        center,
                        outer + bleed,
                        (inner - bleed).max(0.0),
                        from - bleed / orbit,
                        to + bleed / orbit,
                    );
                    if path.is_empty() {
                        continue;
                    }
                    let id = builder.path_id(PathData(path));
                    builder.push(DrawOp::FillPath {
                        path: id,
                        color: rainbow_color((from + to) * 0.5, time, speed, saturation, alpha),
                        tf,
                    });
                }
            }
            builder.push(DrawOp::PopClip);
        }
    } else {
        push_arc(builder, phi_start, phi_end, params.main_color);
    }
    builder.frame.ops.len() - before
}

/// 旋转彩虹环上一点的颜色。
///
/// 参考实现算的是 `hsb2rgb(vec3(atan2(y, x) / 2π + ½, |p| · 2, 1))`，其中 `p` 已经
/// 被 `rotate2d(radians(t · speed))` 转过一次。极角 `phi` 是"自正上方顺时针"，
/// 换到那套"自 +x 轴逆时针"的坐标是 `π/2 − phi`，再加上旋转量。
fn rainbow_color(phi: f64, time: f64, speed_deg: f64, saturation: f64, alpha: f32) -> Color4 {
    let angle = std::f64::consts::FRAC_PI_2 - phi + (time * speed_deg).to_radians();
    let hue = angle / std::f64::consts::TAU + 0.5;
    let rgb = hsb_to_rgb(hue, saturation);
    [rgb[0] as f32, rgb[1] as f32, rgb[2] as f32, alpha]
}

/// 参考实现的 `hsb2rgb`（brightness 恒为 1）。
fn hsb_to_rgb(hue: f64, saturation: f64) -> [f64; 3] {
    let channel = |offset: f64| {
        let raw = ((hue * 6.0 + offset).rem_euclid(6.0) - 3.0).abs() - 1.0;
        let clamped = raw.clamp(0.0, 1.0);
        // 参考实现的 `rgb * rgb * (3 − 2 rgb)`：一次 smoothstep 收边。
        let smooth = clamped * clamped * (3.0 - 2.0 * clamped);
        1.0 + (smooth - 1.0) * saturation
    };
    [channel(0.0), channel(4.0), channel(2.0)]
}

/// 参考实现那个循环真正跑了多少圈。
///
/// `angleTotal = round(progress × 一整圈的步数)`，循环体在 `i >= angleTotal` 时
/// **画完这一圈才 break**，因此圈数是 `angleTotal + 1`，上限 `maxIterations`。
/// 进度 0 也有一个圆（参考实现如此，起点上永远留着一颗），这条必须照搬。
fn dot_count(progress: f64, increment: f64, max_iterations: u64) -> u64 {
    let steps_per_turn = std::f64::consts::TAU / increment.abs();
    let total = (progress.clamp(0.0, 1.0) * steps_per_turn).round();
    (total as u64 + 1).min(max_iterations.max(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 圈数逐字复现参考实现的 `round(360·p)` + "画完再 break" + 上限。
    #[test]
    fn the_dot_count_matches_the_reference_loop() {
        let degree = (-1.0f64).to_radians();
        assert_eq!(dot_count(0.0, degree, 360), 1, "进度 0 也留一颗");
        assert_eq!(dot_count(1.0 / 360.0, degree, 360), 2);
        assert_eq!(dot_count(0.5, degree, 360), 181);
        assert_eq!(dot_count(1.0, degree, 360), 360, "上限压住 361");
        // 半度以内四舍五入到同一圈数（`roundf` 是 `floor(x + 0.5)`）。
        assert_eq!(dot_count(0.4 / 360.0, degree, 360), 1);
        assert_eq!(dot_count(0.6 / 360.0, degree, 360), 2);
    }
}
