//! `visualizer_frame`：配方 + 参数 + 一帧频谱 → DrawOp（ADR-E04 的「纯绘制函数」）。
//!
//! 2026-09 重设计后声波是 **10 款样式 / 7 个算法名**，全部是 CPU 矢量配方
//! （目录见 [`recipes`] 的模块文档）。没有 GPU 侧的 visualizer shader：设计 §8.6
//! 的 visualizer WGSL 清单整体退役，wgpu 后端把声波当普通矢量层合成。
//!
//! ## 三个签名上的取舍
//!
//! 1. **`&mut FrameBuilder` 而不是 `-> Vec<DrawOp>`**（ADR-E04 写的是后者）：
//!    `DrawOp::FillPath` / `StrokePath` 的 `path` 是**侧表下标**，只有 builder
//!    能发号。柱状类只用 `FillRect`，其余六个算法都要 path。已落地的孪生
//!    `element_draw::push_shape_ops` 也是这个形状，两者保持一致。
//! 2. **配方类型直接用 `motion::preset_registry::CatalogueRecipe`**：
//!    `bcut-render` 本来就依赖 `bcut-motion`，配方是数据不是代码，再抄一份
//!    「渲染侧配方」就等于让 10 份 manifest 有两个读法。
//! 3. **参数类型是本 crate 自己的 [`VisualizerParams`]，不是
//!    `bcut_timeline::schema::VisualizerProps`**：`bcut-render` **不依赖**
//!    `bcut-timeline`（方案 §2.3 记载的依赖图），加这条边会让渲染层反过来知道
//!    产品时间轴的 schema。映射（含缺省回落到配方的 `defaultMainColor` 等）是
//!    host 的活，`apps/cli` 的 `element_draw` 做这一步。
//!
//! 颜色与坐标约定跟 `element_draw` 逐字相同：路径点是**画布绝对像素**，
//! `tf` 只承载绕元素盒中心的旋转 / 镜像 / 动画位姿；`Color4` 非预乘、0..1。
//!
//! ## 静音语义
//!
//! 静音（频域行全 0、时域行 128）时**每一款仍然画得出东西**：柱状留 `minHeight`
//! 的短柱、点阵留一排底灯、示波器画一条直线 / 一个圆、脉冲环停在静止位、丝带
//! 退化成中线。元素在无声段不会从画面上消失，`alwaysShow` 的显隐由合成（`frame-render`）决定。

use motion::preset_registry::{CatalogueRecipe, RecipeAlgorithm, VisualizerAspect};

use crate::drawop::{Color4, FrameBuilder, Mat6};

use super::VizFrame;
use super::recipes;

pub use crate::source::kernel::DrawBox as VizBox;

/// 绘制参数：**已经解析好的**颜色（host 负责从 `VisualizerProps` 取值，
/// 缺省回落到配方的 `defaultMainColor` / `defaultSecondaryColor`）。
///
/// dB 窗 / smoothing / gain **不在这里**——它们在 preflight 就烘进
/// [`super::VizTrack`] 了（ADR-E04 数据流第 2 步），绘制期再读一次就会出现
/// 「派生用一套、绘制用另一套」。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VisualizerParams {
    pub main_color: Color4,
    pub secondary_color: Color4,
}

/// 一帧 visualizer → 指令流；返回**新压入的 DrawOp 条数**。
///
/// 返回 `0` 的含义是「这个样式这一帧没有可画的东西」（例如零尺寸的盒子）——
/// 10 种全部有绘制实现，host 的占位分支只剩"没有频谱轨"这一种真实故障。
///
/// `time` 是**元素本地时刻**（`t − element.start`，秒），对应参考实现的 `u_time`
/// ——口径与 [`crate::source::progress::progress_frame`] 逐字相同（§13 P4 偏离 9）：
/// 同一个元素搬到时间轴别处，画出来的东西不变。当前只有 `ribbons-v1`
/// （丝带相位）读它。
pub fn visualizer_frame(
    builder: &mut FrameBuilder,
    recipe: &CatalogueRecipe,
    params: &VisualizerParams,
    viz: &VizFrame,
    time: f64,
    bbox: VizBox,
    tf: Mat6,
) -> usize {
    let Some(body) = recipe.visualizer() else {
        // progress / shape 的配方走到这里是 host 的分派错误，不是数据错误。
        return 0;
    };
    // `aspect: "square"` 是**配方声明的**几何约束：在盒内取内切正方形再画，
    // 圆形类样式因此在任何元素盒里都是正圆而不是椭圆（几何默认表给的
    // 「画幅宽 30% × 画幅高 30%」在 16:9 上并不是像素正方）。
    let bbox = match body.aspect {
        VisualizerAspect::Square => bbox.inscribed_square(),
        VisualizerAspect::Free => bbox,
    };

    match body.recipe.algorithm {
        RecipeAlgorithm::SpectrumBarsV1 => {
            recipes::spectrum_bars_v1::draw(builder, body, params, viz, bbox, tf)
        }
        RecipeAlgorithm::PolarBarsV1 => {
            recipes::polar_bars_v1::draw(builder, body, params, viz, bbox, tf)
        }
        RecipeAlgorithm::OscilloscopeV1 => {
            recipes::oscilloscope_v1::draw(builder, body, params, viz, bbox, tf)
        }
        RecipeAlgorithm::SpectrumAreaV1 => {
            recipes::spectrum_area_v1::draw(builder, body, params, viz, bbox, tf)
        }
        RecipeAlgorithm::DotMatrixV1 => {
            recipes::dot_matrix_v1::draw(builder, body, params, viz, bbox, tf)
        }
        RecipeAlgorithm::PulseRingsV1 => {
            recipes::pulse_rings_v1::draw(builder, body, params, viz, bbox, tf)
        }
        RecipeAlgorithm::RibbonsV1 => {
            recipes::ribbons_v1::draw(builder, body, params, viz, time, bbox, tf)
        }
        // progress / confetti 的算法名不可能出现在 visualizer 配方体里：配方解析期
        // 已经按 `RecipeAlgorithm::kind()` 拦下了（`manifest-invalid`）。
        RecipeAlgorithm::BarV1
        | RecipeAlgorithm::FrameV1
        | RecipeAlgorithm::RingV1
        | RecipeAlgorithm::SnakeV1
        | RecipeAlgorithm::ConfettiV1 => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drawop::DrawOp;

    fn frame() -> VizFrame {
        VizFrame {
            time: vec![128; 128].into_boxed_slice(),
            freq: vec![200; 512].into_boxed_slice(),
        }
    }

    fn silence() -> VizFrame {
        VizFrame {
            time: vec![128; 128].into_boxed_slice(),
            freq: vec![0; 512].into_boxed_slice(),
        }
    }

    /// 一帧有起伏的波形 + 前半段高、后半段低的频谱。
    fn shaped() -> VizFrame {
        let time: Vec<u8> = (0..128)
            .map(|i| {
                let phase = f64::from(i) / 128.0 * std::f64::consts::TAU;
                (128.0 + 100.0 * phase.sin()).round() as u8
            })
            .collect();
        let freq: Vec<u8> = (0..512).map(|i| if i < 32 { 240 } else { 20 }).collect();
        VizFrame {
            time: time.into_boxed_slice(),
            freq: freq.into_boxed_slice(),
        }
    }

    fn params() -> VisualizerParams {
        VisualizerParams {
            main_color: [1.0, 1.0, 1.0, 1.0],
            secondary_color: [0.0, 0.0, 0.0, 1.0],
        }
    }

    const BOX: VizBox = VizBox {
        x: 10.0,
        y: 20.0,
        w: 100.0,
        h: 50.0,
    };
    const TF: Mat6 = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

    fn style(id: &str) -> &'static CatalogueRecipe {
        motion::preset_registry::timeline_visualizer(id).expect("样式已登记")
    }

    fn draw(id: &str, viz: &VizFrame) -> FrameBuilder {
        draw_at(id, viz, 0.0)
    }

    fn draw_at(id: &str, viz: &VizFrame, time: f64) -> FrameBuilder {
        let mut builder = FrameBuilder::default();
        visualizer_frame(&mut builder, style(id), &params(), viz, time, BOX, TF);
        builder
    }

    fn rects(builder: &FrameBuilder) -> Vec<(f32, f32, f32, f32, f32)> {
        builder
            .frame
            .ops
            .iter()
            .filter_map(|op| match op {
                DrawOp::FillRect {
                    x, y, w, h, radius, ..
                } => Some((*x, *y, *w, *h, *radius)),
                _ => None,
            })
            .collect()
    }

    fn count<F: Fn(&DrawOp) -> bool>(builder: &FrameBuilder, pred: F) -> usize {
        builder.frame.ops.iter().filter(|op| pred(op)).count()
    }

    /// **10 种全部画得出东西**，且返回值就是压入的条数；静音也不例外。
    #[test]
    fn every_catalogue_style_draws_something_even_in_silence() {
        let styles = motion::preset_registry::timeline_visualizers();
        assert_eq!(styles.len(), 10, "10 种 sound wave 全部登记在目录里");
        for recipe in styles {
            for viz in [frame(), silence(), shaped()] {
                let mut builder = FrameBuilder::default();
                let pushed = visualizer_frame(&mut builder, recipe, &params(), &viz, 0.0, BOX, TF);
                assert!(pushed > 0, "{} 必须画出东西", recipe.id);
                assert_eq!(pushed, builder.frame.ops.len(), "{}", recipe.id);
            }
        }
    }

    /// 旧 id 经别名表折到新样式，画出来的东西逐条相同。
    #[test]
    fn legacy_ids_draw_through_the_alias_table() {
        for (old, new) in [
            ("trio_wave", "bars"),
            ("formation_rounded", "bars_rounded"),
            ("static", "bars_bottom"),
            ("formation_circle", "ring_bars"),
            ("beam", "oscilloscope"),
            ("harmony", "ribbons"),
            ("frequency_lines", "dots"),
            ("ripple_wave", "pulse_rings"),
        ] {
            let a = crate::drawop::fingerprint(&draw(old, &shaped()).finish());
            let b = crate::drawop::fingerprint(&draw(new, &shaped()).finish());
            assert_eq!(a, b, "{old} → {new}");
        }
    }

    /// `u_time` 的口径（§13 P4 偏离 9）：只有 `ribbons` 随时刻变。
    #[test]
    fn only_the_ribbons_read_the_clock() {
        let print =
            |id: &str, time: f64| crate::drawop::fingerprint(&draw_at(id, &frame(), time).finish());
        for recipe in motion::preset_registry::timeline_visualizers() {
            let id = recipe.id.as_str();
            let same = print(id, 0.0) == print(id, 1.3);
            assert_eq!(same, id != "ribbons", "{id}");
        }
    }

    /// 柱数、圆角与对齐全部来自 manifest。
    #[test]
    fn the_bar_family_follows_the_manifest() {
        let bars = rects(&draw("bars", &frame()));
        assert_eq!(bars.len(), 48);
        assert!(bars.iter().all(|r| r.4 == 0.0), "bars 没有圆角");
        // mirror：柱子以盒子中线对称。
        for (_, y, _, h, _) in &bars {
            assert!((y + h / 2.0 - 45.0).abs() < 1e-3, "y={y} h={h}");
        }

        let rounded = rects(&draw("bars_rounded", &frame()));
        assert_eq!(rounded.len(), 32);
        for (_, _, w, h, radius) in &rounded {
            assert!(
                (radius - w.min(*h) / 2.0).abs() < 1e-4,
                "胶囊：半径 = 短边一半"
            );
        }

        let bottom = rects(&draw("bars_bottom", &frame()));
        assert_eq!(bottom.len(), 64);
        for (_, y, _, h, _) in &bottom {
            assert!((y + h - 70.0).abs() < 1e-3, "贴底：y+h = 盒底");
        }
    }

    /// 静音只剩 `minHeight` 的短柱；有声时柱子变高，且不超出盒子。
    #[test]
    fn silence_leaves_the_minimum_bars() {
        let quiet = rects(&draw("bars", &silence()));
        assert!(
            quiet.iter().all(|r| (r.3 - 1.0).abs() < 1e-4),
            "0.02 × 50 = 1"
        );
        let loud = rects(&draw("bars", &frame()));
        assert!(loud.iter().all(|r| r.3 > 30.0 && r.3 <= 50.0), "{loud:?}");
    }

    /// `gap` 是槽宽的分数：柱宽 = 槽宽 × (1 − gap)，柱子在槽内居中。
    #[test]
    fn the_gap_is_a_fraction_of_the_slot() {
        let bottom = rects(&draw("bars_bottom", &frame()));
        let slot = 100.0 / 64.0;
        for (index, (x, _, w, _, _)) in bottom.iter().enumerate() {
            assert!((w - slot * 0.75).abs() < 1e-4);
            let expected = 10.0 + slot * index as f32 + slot * 0.125;
            assert!((x - expected).abs() < 1e-3, "{index}: {x} vs {expected}");
        }
    }

    /// `square` 配方在内切正方形里画：`ring_bars` 的扇区全部落在 x ∈ [35, 85]。
    #[test]
    fn the_square_aspect_draws_inside_the_inscribed_square() {
        let builder = draw("ring_bars", &frame());
        assert_eq!(
            count(&builder, |op| matches!(op, DrawOp::FillPath { .. })),
            72
        );
        for path in &builder.frame.paths {
            for seg in &path.0 {
                if seg.verb == 4 {
                    continue;
                }
                let xs = [seg.pts[0], seg.pts[2], seg.pts[4]];
                let ys = [seg.pts[1], seg.pts[3], seg.pts[5]];
                let n = match seg.verb {
                    0 | 1 => 1,
                    3 => 3,
                    _ => 0,
                };
                for i in 0..n {
                    assert!(
                        (34.9..=85.1).contains(&xs[i]) && (19.9..=70.1).contains(&ys[i]),
                        "({}, {})",
                        xs[i],
                        ys[i]
                    );
                }
            }
        }
    }

    /// 示波器读时域行：静音是一条平直的中线，有波形就离开中线。
    #[test]
    fn the_oscilloscope_reads_the_time_row() {
        let flat = draw("oscilloscope", &silence());
        assert_eq!(
            count(&flat, |op| matches!(op, DrawOp::StrokePath { .. })),
            1
        );
        let path = &flat.frame.paths[0].0;
        assert_eq!(path.len(), 128, "samples 来自 manifest");
        assert!(path.iter().all(|seg| (seg.pts[1] - 45.0).abs() < 1e-3));

        let wavy = draw("oscilloscope", &shaped());
        let path = &wavy.frame.paths[0].0;
        let (min, max) = path.iter().fold((f32::MAX, f32::MIN), |(lo, hi), seg| {
            (lo.min(seg.pts[1]), hi.max(seg.pts[1]))
        });
        assert!(min < 30.0 && max > 60.0, "min={min} max={max}");
        assert!(min >= 20.0 && max <= 70.0, "不出盒子");
    }

    /// `ring_wave` 是闭合的极坐标示波器：静音是基圆，路径以 close 收口。
    #[test]
    fn the_ring_wave_closes_around_the_base_circle() {
        let flat = draw("ring_wave", &silence());
        let path = &flat.frame.paths[0].0;
        assert_eq!(path.last().map(|seg| seg.verb), Some(4));
        assert_eq!(path.len(), 129);
        let (cx, cy) = (60.0f32, 45.0f32);
        for seg in path.iter().filter(|seg| seg.verb != 4) {
            let r = ((seg.pts[0] - cx).powi(2) + (seg.pts[1] - cy).powi(2)).sqrt();
            assert!(
                (r - 15.0).abs() < 1e-2,
                "baseRadius 0.6 × 25 = 15，读到 {r}"
            );
        }
    }

    /// 面积图：一条填充 + 一条描边，填充闭合到盒底。
    #[test]
    fn the_spectrum_area_fills_down_to_the_bottom_edge() {
        let builder = draw("spectrum_area", &frame());
        assert!(
            matches!(builder.frame.ops[0], DrawOp::FillPath { color, .. } if color == [1.0; 4])
        );
        assert!(matches!(
            builder.frame.ops[1],
            DrawOp::StrokePath { color, width, .. } if color == [0.0, 0.0, 0.0, 1.0] && (width - 1.0).abs() < 1e-5
        ));
        let area = &builder.frame.paths[0].0;
        assert_eq!(area.len(), 64 + 3);
        assert_eq!(area[64].pts[1], 70.0);
        assert_eq!(area[65].pts[1], 70.0);
        assert_eq!(area[66].verb, 4);
    }

    /// 点阵：列数来自 manifest，每列最高一颗用副色，静音仍留一排底灯。
    #[test]
    fn the_dot_matrix_lights_a_peak_per_column() {
        let loud = draw("dots", &frame());
        let peaks = count(
            &loud,
            |op| matches!(op, DrawOp::FillRect { color, .. } if *color == [0.0, 0.0, 0.0, 1.0]),
        );
        assert_eq!(peaks, 32);
        assert!(
            loud.frame.ops.len() > 32 * 4,
            "200/255 经 easeOutQuad 点亮大半"
        );

        let quiet = draw("dots", &silence());
        assert_eq!(quiet.frame.ops.len(), 32, "每列一颗底灯");
        assert!(
            rects(&quiet)
                .iter()
                .all(|r| (r.1 + r.3 / 2.0 - (70.0 - 50.0 / 16.0)).abs() < 1e-3)
        );
    }

    /// 脉冲环：圆盘 + `bands` 个环，静音停在静止位，有声向外推。
    #[test]
    fn the_pulse_rings_expand_with_the_bands() {
        let radius_of = |builder: &FrameBuilder, index: usize| -> f32 {
            let seg = &builder.frame.paths[index].0[0];
            // 环从正上方起：圆心 (60, 45)，move 点在 (60, 45 − r)。
            45.0 - seg.pts[1]
        };
        let quiet = draw("pulse_rings", &silence());
        assert_eq!(quiet.frame.ops.len(), 5);
        assert!(
            (radius_of(&quiet, 0) - 0.22 * 25.0).abs() < 1e-3,
            "圆盘停在 coreRadius"
        );
        let loud = draw("pulse_rings", &frame());
        assert!(radius_of(&loud, 0) > radius_of(&quiet, 0));
        for band in 1..=4 {
            assert!(radius_of(&loud, band) > radius_of(&quiet, band), "{band}");
            assert!(radius_of(&loud, band) <= 0.9 * 25.0 + 0.035 * 25.0 / 2.0 + 1e-3);
        }
    }

    /// 丝带：条数与采样点来自 manifest，颜色从主色渐变到副色。
    #[test]
    fn the_ribbons_blend_from_main_to_secondary() {
        let builder = draw("ribbons", &shaped());
        let colors: Vec<Color4> = builder
            .frame
            .ops
            .iter()
            .filter_map(|op| match op {
                DrawOp::StrokePath { color, .. } => Some(*color),
                _ => None,
            })
            .collect();
        assert_eq!(
            colors,
            vec![[1.0; 4], [0.5, 0.5, 0.5, 1.0], [0.0, 0.0, 0.0, 1.0]]
        );
        assert!(builder.frame.paths.iter().all(|path| path.0.len() == 96));
    }

    /// progress 的配方走到 visualizer 入口：返回 0，不 panic。
    #[test]
    fn a_progress_recipe_draws_nothing_instead_of_panicking() {
        let recipe = motion::preset_registry::timeline_progress("normal").expect("已登记");
        let mut builder = FrameBuilder::default();
        assert_eq!(
            visualizer_frame(&mut builder, recipe, &params(), &frame(), 0.0, BOX, TF),
            0
        );
        assert!(builder.frame.ops.is_empty());
    }
}
