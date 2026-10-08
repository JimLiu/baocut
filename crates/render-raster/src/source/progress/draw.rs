//! `progress_frame`：配方 + 两个颜色 + 进度值 → DrawOp。
//!
//! 签名与 [`crate::source::visualizer::visualizer_frame`] 同形（`&mut FrameBuilder`
//! + 返回 op 条数），host 的两条分派因此长得一样。
//!
//! ## 像素单位参数的口径（P2 存疑项在此定案）
//!
//! `rounded` 的 `corner.radiusPx = 200` 与 `intervalPx = 5` 在参考实现里是
//! **相对 `u_dstRes` 的绝对像素**。BaoCut 按 P0 已定的长度口径折算：
//! `× short_edge / REFERENCE_SHORT_EDGE(540)`，与 `strokeWidth` / `cornerRadius` /
//! `lower_element_effects` 逐字相同——否则 4K 导出的圆角会退化成近直角。
//! 折算后再夹到"半个短边"以内，于是一条 5% 高的进度条正好是胶囊形。
//! 折算**系数**由 host 传进来（[`ProgressParams::pixel_scale`]）：参考短边 540
//! 的真相住在 `bcut_timeline::REFERENCE_SHORT_EDGE`，而 `bcut-render` 不依赖
//! `bcut-timeline`（§2.3 的依赖图），在这里再写一个 540 就是第二份真相。
//!
//! `intervalPx`（以及 `insetRatio` / `alphaEdge`、ring 的 `featherPx` /
//! `edgeFeatherPx`）描述的是 shader 的 **alpha 过渡带宽**，矢量路径的边由
//! 光栅器抗锯齿，没有对应物，本实现**不读**它们；P5 的 WGSL 会逐字用上。

use motion::preset_registry::{CatalogueRecipe, ProgressAspect, RecipeAlgorithm};

use crate::drawop::{Color4, FrameBuilder, Mat6};

use super::recipes;

pub use crate::source::kernel::DrawBox as ProgressBox;

/// 绘制参数：**已经解析好的**两个颜色 + 像素长度的折算系数。
///
/// 进度值不在这里，它是 [`progress_frame`] 的显式入参——同一个元素在不同时刻
/// 是不同的画面，把它塞进"参数"会让人以为它像颜色一样每元素只算一次。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ProgressParams {
    pub main_color: Color4,
    pub secondary_color: Color4,
    /// `canvas_short_edge / bcut_timeline::REFERENCE_SHORT_EDGE`，由 host 算好
    /// （见模块文档）。传 `1.0` 就是"按 540 短边的原始像素"。
    pub pixel_scale: f64,
}

/// 一帧 progress → 指令流；返回**新压入的 DrawOp 条数**。
///
/// `progress` 由 host 用 `bcut_timeline::geometry::progress_at` 算好，
/// 这里只做一次 clamp 防御（NaN 归 0）。
///
/// `time` 是**元素本地时刻**（`t − element.start`，秒），对应参考实现的
/// `u_time`。读它的有 `snake_spin`（自转相位）与 P5b 的 rainbow / strobe 六种
/// （hue 循环 / 频闪）。取元素本地而不是输出时间轴，是为了让"同一个进度条放在
/// 时间轴的哪里都长一样"——`progress` 本来就只由 `start` / `end` 决定，相位跟着
/// 走才自洽。
pub fn progress_frame(
    builder: &mut FrameBuilder,
    recipe: &CatalogueRecipe,
    params: &ProgressParams,
    progress: f64,
    time: f64,
    bbox: ProgressBox,
    tf: Mat6,
) -> usize {
    let Some(body) = recipe.progress() else {
        // visualizer / shape 的配方走到这里是 host 的分派错误。
        return 0;
    };
    let progress = if progress.is_finite() {
        progress.clamp(0.0, 1.0)
    } else {
        0.0
    };
    let time = if time.is_finite() { time } else { 0.0 };
    // `aspect: "square"` 与 visualizer 同一条规则：盒内取内切正方形，
    // 圆环类因此在任何盒子里都是正圆。`bar` / `frame` 用整只盒子。
    let bbox = match body.aspect {
        ProgressAspect::Square => bbox.inscribed_square(),
        ProgressAspect::Bar | ProgressAspect::Frame => bbox,
    };

    match body.recipe.algorithm {
        RecipeAlgorithm::BarV1 => recipes::bar_v1::draw(builder, body, params, progress, bbox, tf),
        RecipeAlgorithm::FrameV1 => {
            recipes::frame_v1::draw(builder, body, params, progress, time, bbox, tf)
        }
        RecipeAlgorithm::RingV1 => {
            recipes::ring_v1::draw(builder, body, params, progress, bbox, tf)
        }
        RecipeAlgorithm::SnakeV1 => {
            recipes::snake_v1::draw(builder, body, params, progress, time, bbox, tf)
        }
        // visualizer 的七个算法名不可能出现在 progress 配方体里：解析期已按
        // `RecipeAlgorithm::kind()` 拦下（`manifest-invalid`）。
        RecipeAlgorithm::SpectrumBarsV1
        | RecipeAlgorithm::PolarBarsV1
        | RecipeAlgorithm::OscilloscopeV1
        | RecipeAlgorithm::SpectrumAreaV1
        | RecipeAlgorithm::DotMatrixV1
        | RecipeAlgorithm::PulseRingsV1
        | RecipeAlgorithm::RibbonsV1
        | RecipeAlgorithm::ConfettiV1 => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drawop::DrawOp;
    use motion::preset_registry::timeline_progress;

    const BOX: ProgressBox = ProgressBox {
        x: 100.0,
        y: 50.0,
        w: 400.0,
        h: 20.0,
    };
    const TF: Mat6 = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

    fn params() -> ProgressParams {
        ProgressParams {
            main_color: [1.0, 0.0, 0.0, 1.0],
            secondary_color: [0.0, 0.0, 1.0, 1.0],
            pixel_scale: 1.0,
        }
    }

    /// 时刻固定为 0：只有 `snake_spin` 读它，另有专测。
    fn draw(id: &str, progress: f64) -> FrameBuilder {
        draw_at(id, progress, 0.0)
    }

    fn draw_at(id: &str, progress: f64, time: f64) -> FrameBuilder {
        let mut builder = FrameBuilder::default();
        progress_frame(
            &mut builder,
            timeline_progress(id).expect("样式已登记"),
            &params(),
            progress,
            time,
            BOX,
            TF,
        );
        builder
    }

    /// **14 种全部画得出东西**（P5b 之后没有空臂了）。
    #[test]
    fn every_catalogue_style_draws_something() {
        let styles = motion::preset_registry::timeline_progresses();
        assert_eq!(styles.len(), 14, "14 种 progress 全部登记在目录里");
        for recipe in styles {
            let mut builder = FrameBuilder::default();
            let pushed = progress_frame(&mut builder, recipe, &params(), 0.5, 0.0, BOX, TF);
            assert!(pushed > 0, "{} 必须画出东西", recipe.id);
            assert_eq!(pushed, builder.frame.ops.len(), "{}", recipe.id);
        }
    }

    /// `u_time` 的口径：只有读时钟的样式随时刻变。
    ///
    /// `snake_spin`（自转）与 P5b 的 rainbow / strobe 六种读它；其余七种不读。
    #[test]
    fn only_the_time_driven_styles_read_the_clock() {
        let print =
            |id: &str, time: f64| crate::drawop::fingerprint(&draw_at(id, 0.5, time).finish());
        for id in [
            "normal",
            "rounded",
            "border",
            "reverse_border",
            "circle",
            "donut",
            "snake",
        ] {
            assert_eq!(print(id, 0.0), print(id, 1.7), "{id} 不该读时钟");
        }
        for id in [
            "snake_spin",
            "rainbow_border",
            "reverse_rainbow_border",
            "strobe_border",
            "reverse_strobe_border",
            "snake_rainbow",
            "snake_spin_rainbow",
        ] {
            assert_ne!(print(id, 0.0), print(id, 1.7), "{id} 必须读时钟");
        }
    }

    /// 端点精确：0 只剩底色，1 铺满。
    #[test]
    fn the_endpoints_are_exact() {
        for id in ["normal", "rounded", "border", "circle", "donut"] {
            let empty = draw(id, 0.0);
            let full = draw(id, 1.0);
            assert!(!empty.frame.ops.is_empty(), "{id} 的底色总要画");
            assert!(
                full.frame.ops.len() >= empty.frame.ops.len(),
                "{id}: 满进度不该比空进度画得少"
            );
        }
        // `normal` 空进度只有底色一条。
        assert_eq!(draw("normal", 0.0).frame.ops.len(), 1);
        assert_eq!(draw("normal", 1.0).frame.ops.len(), 2);
        // `reverse_border` 反过来：满进度时进度环整个消失。
        assert_eq!(draw("reverse_border", 1.0).frame.ops.len(), 1);
        assert_eq!(draw("reverse_border", 0.0).frame.ops.len(), 2);
    }

    /// 非法进度值不 panic，按 0 处理。
    #[test]
    fn a_non_finite_progress_reads_as_zero() {
        assert_eq!(
            draw("normal", f64::NAN).frame.ops.len(),
            draw("normal", 0.0).frame.ops.len()
        );
        assert_eq!(
            draw("normal", -5.0).frame.ops.len(),
            draw("normal", 0.0).frame.ops.len()
        );
        let over = draw("normal", 5.0);
        let DrawOp::FillRect { w, .. } = over.frame.ops[1] else {
            unreachable!()
        };
        assert!((f64::from(w) - BOX.w).abs() < 1e-6);
    }

    /// `snake` 两条 path：底环（副色，整圈）+ 进度环（主色）。
    /// 进度 0 也留一颗圆点——参考实现的循环"画完这一圈才 break"。
    #[test]
    fn the_snake_draws_a_track_ring_and_a_progress_ring() {
        for progress in [0.0, 0.5, 1.0] {
            let builder = draw("snake", progress);
            assert_eq!(builder.frame.ops.len(), 2, "progress={progress}");
            let DrawOp::FillPath { color: track, .. } = builder.frame.ops[0] else {
                unreachable!()
            };
            let DrawOp::FillPath { color: fill, .. } = builder.frame.ops[1] else {
                unreachable!()
            };
            assert_eq!(track, params().secondary_color, "底环用 trackColor");
            assert_eq!(fill, params().main_color);
        }
        // 进度环随进度变长：路径段数单调不减（每多一段扇区就多几条贝塞尔）。
        let segments = |progress: f64| {
            let builder = draw("snake", progress);
            let DrawOp::FillPath { path, .. } = builder.frame.ops[1] else {
                unreachable!()
            };
            builder.frame.paths[path as usize].0.len()
        };
        assert!(segments(0.0) < segments(0.25));
        assert!(segments(0.25) < segments(1.0));
    }

    /// `aspect: "square"`：`snake` 在横条盒里画的仍是正圆——外沿到内切正方形的
    /// 边（`orbitRadius + dotRadius == 0.5`），横向不会摊成椭圆。
    #[test]
    fn the_snake_stays_circular_in_a_wide_box() {
        let builder = draw("snake", 1.0);
        let DrawOp::FillPath { path, .. } = builder.frame.ops[0] else {
            unreachable!()
        };
        let center = BOX.center();
        // 曲线上的点（`close` 无点位，三次段的端点在 pts[4..6]）。
        let radii: Vec<f64> = builder.frame.paths[path as usize]
            .0
            .iter()
            .filter_map(|seg| match seg.verb {
                0 | 1 => Some((f64::from(seg.pts[0]), f64::from(seg.pts[1]))),
                3 => Some((f64::from(seg.pts[4]), f64::from(seg.pts[5]))),
                _ => None,
            })
            .map(|(x, y)| ((x - center.0).powi(2) + (y - center.1).powi(2)).sqrt())
            .collect();
        let outer = radii.iter().cloned().fold(f64::MIN, f64::max);
        // `orbitRadius + dotRadius == 0.5` ⇒ 外沿正好贴到**内切正方形**的边，
        // 而不是横条盒子的宽边（那样就摊成椭圆了）。
        assert!((outer - BOX.h / 2.0).abs() < 1e-3, "{outer}");
        assert!(outer < BOX.w / 2.0);
    }

    /// `spin: null` 的 `snake` 与时刻无关；`snake_spin` 逐时刻不同，且
    /// 每 `360 / speedDegPerSec` 秒转回原位（`mod` 的周期）。
    #[test]
    fn only_the_spinning_snake_reads_the_clock() {
        let print =
            |id: &str, time: f64| crate::drawop::fingerprint(&draw_at(id, 0.5, time).finish());
        assert_eq!(print("snake", 0.0), print("snake", 1.7));
        assert_ne!(print("snake_spin", 0.0), print("snake_spin", 1.7));
        // 50 °/s ⇒ 7.2 s 一整圈。
        assert_eq!(print("snake_spin", 0.0), print("snake_spin", 7.2));
        // 非有限时刻按 0 处理，不 panic。
        assert_eq!(print("snake_spin", f64::NAN), print("snake_spin", 0.0));
    }

    /// 拿 visualizer 配方来调 progress 绘制是 host 的分派错误：返回 0，不 panic。
    #[test]
    fn a_visualizer_recipe_draws_nothing_instead_of_panicking() {
        let recipe = motion::preset_registry::timeline_visualizer("bars").unwrap();
        let mut builder = FrameBuilder::default();
        assert_eq!(
            progress_frame(&mut builder, recipe, &params(), 0.5, 0.0, BOX, TF),
            0
        );
    }
}
