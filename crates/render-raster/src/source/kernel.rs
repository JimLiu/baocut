//! 目录型配方绘制内核的**共用件**（元素方案 §7.2 / §7.4）。
//!
//! visualizer 与 progress 的配方内核都只描述"怎么把参数变成几何"，
//! **一个样式参数都不自带**（与 motion 文档阶段 1 的 `loop_kernel` 同一纪律）。
//! 本模块住着两类东西：
//!
//! 1. **换算规则本身**：[`smoothstep`] / [`Easing`] / [`sample_row_linear`]。
//!    这些是公式，不是配方数据。
//! 2. **矢量几何工具**：[`DrawBox`] 的坐标换算与 [`rect_subpath`] /
//!    [`sector_subpath`] / [`ring_subpath`] / [`swept_arc_subpath`] 几个 path
//!    组装器。
//!
//! 这里的每一件都同时服务 CPU 矢量配方（visualizer 10 款、progress 的 CPU 参照）
//! 与 progress 的 WGSL 打包（[`Easing::code`]）：两侧共用同一份换算，对拍才有
//! 意义。只被某一个配方用到的东西不进本模块，放在配方自己的文件里。

use crate::drawop::PathSeg;

/// path 段构造（`verb` 编码见 [`PathSeg`]）。f64 → f32 的截断只发生在这里。
pub(crate) fn seg(verb: u8, pts: [f64; 6]) -> PathSeg {
    PathSeg {
        verb,
        pts: [
            pts[0] as f32,
            pts[1] as f32,
            pts[2] as f32,
            pts[3] as f32,
            pts[4] as f32,
            pts[5] as f32,
        ],
    }
}

pub(crate) fn path_seg_move(x: f64, y: f64) -> PathSeg {
    seg(0, [x, y, 0.0, 0.0, 0.0, 0.0])
}

pub(crate) fn path_seg_line(x: f64, y: f64) -> PathSeg {
    seg(1, [x, y, 0.0, 0.0, 0.0, 0.0])
}

pub(crate) fn path_seg_cubic(c1: (f64, f64), c2: (f64, f64), to: (f64, f64)) -> PathSeg {
    seg(3, [c1.0, c1.1, c2.0, c2.1, to.0, to.1])
}

pub(crate) fn path_seg_close() -> PathSeg {
    seg(4, [0.0; 6])
}

/// 元素盒的**纵向中线**（归一化 v）。
///
/// 示波器 / 丝带这类"围绕中线摆动"的配方以它为零位。几何常量，不是样式参数
/// （柱状家族的 `align: bottom` 形态把零位挪到盒底，那是配方自己的事）。
pub const MID_V: f64 = 0.5;

/// 元素盒（画布像素，左上原点）。
///
/// 配方在归一化的 `(u, v)` 里工作，且 **v 轴向上**（progress 的环"从正上方
/// 顺时针"、柱状家族的"贴底对齐"两处互相印证，见 [`DrawBox::at`]）；画布是
/// y 向下的，因此换算必须翻一次 v。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DrawBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl DrawBox {
    pub fn center(&self) -> (f64, f64) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }

    /// 盒内居中的最大正方形。
    ///
    /// `aspect: "square"` 的配方（`ring_bars` / `ring_wave` / `pulse_rings` /
    /// `circle` / `donut` …）用它把圆画成**圆**而不是椭圆。BaoCut 的几何表把
    /// 这类元素的默认盒写成"画幅宽 30% × 画幅高 30%"（`bcut_timeline::geometry`），
    /// 在 16:9 上**不是**像素正方。配方既然显式声明了 `square`，绘制端就按它办。
    pub fn inscribed_square(&self) -> DrawBox {
        let side = self.w.min(self.h);
        DrawBox {
            x: self.x + (self.w - side) / 2.0,
            y: self.y + (self.h - side) / 2.0,
            w: side,
            h: side,
        }
    }

    /// 归一化 `(u, v)`（左下原点、v 向上）→ 画布像素（左上原点、y 向下）。
    pub fn at(&self, u: f64, v: f64) -> (f64, f64) {
        (self.x + self.w * u, self.y + self.h * (1.0 - v))
    }
}

/// GLSL 的 `smoothstep`：`edge0 == edge1` 时退化成阶跃（GLSL 未定义，这里定死）。
pub fn smoothstep(edge0: f64, edge1: f64, x: f64) -> f64 {
    if edge0 == edge1 {
        return if x < edge0 { 0.0 } else { 1.0 };
    }
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// 配方 `easing` 的封闭取值（注册表解析期已按 `ENUM_KEYS` 校验过取值域）。
///
/// visualizer 与 progress 共用一个枚举：它们的取值**同族**（都是 `easeOut*`，
/// 都作用在一个 0..1 的幅度上），取值域的差别是注册表的事，绘制端只需要
/// "名字 → 曲线"。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Easing {
    None,
    OutQuad,
    OutSine,
    OutCubic,
    OutExpo,
}

impl Easing {
    /// 未知名在**注册表解析期**就被拦下（`manifest-invalid`），绘制端读到
    /// `None` 只可能是有人绕过了注册表；此时按恒等处理，不 panic。
    pub fn parse(name: &str) -> Option<Easing> {
        match name {
            "none" => Some(Easing::None),
            "easeOutQuad" => Some(Easing::OutQuad),
            "easeOutSine" => Some(Easing::OutSine),
            "easeOutCubic" => Some(Easing::OutCubic),
            "easeOutExpo" => Some(Easing::OutExpo),
            _ => None,
        }
    }

    pub fn apply(self, x: f64) -> f64 {
        match self {
            Easing::None => x,
            Easing::OutQuad => 1.0 - (1.0 - x) * (1.0 - x),
            Easing::OutSine => (x * std::f64::consts::PI / 2.0).sin(),
            Easing::OutCubic => 1.0 - (1.0 - x).powi(3),
            // `exp2` 比 `pow(2, −10x)` 少一次 `exp(ln 2 · ·)` 的往返，
            // 两边（CPU / WGSL）都用它。
            Easing::OutExpo => {
                if x >= 1.0 {
                    1.0
                } else {
                    1.0 - (-10.0 * x).exp2()
                }
            }
        }
    }

    /// 送进 WGSL 的**数值编码**（`common.wgsl` 的 `applyEasing` 按它分派）。
    ///
    /// 编码表的唯一真相在这里：shader 里因此没有"哪个样式用哪条缓动"的知识，
    /// 配方的字符串名也不必进 WGSL。改这里必须同步改 `applyEasing`，
    /// `tests/shader_wgsl.rs` 用一条对拍钉住两边。
    pub fn code(self) -> u32 {
        match self {
            Easing::None => 0,
            Easing::OutQuad => 1,
            Easing::OutSine => 2,
            Easing::OutCubic => 3,
            Easing::OutExpo => 4,
        }
    }
}

/// 一条字节行的**双线性等价采样**：`GL_LINEAR` + `CLAMP_TO_EDGE`，还 `0..1`。
///
/// 与 §8.3 的音频纹理（`w × 2` 的 `R8Unorm`，采样器 linear / clamp-to-edge）
/// 同一套换算：纹素中心在 `(i + 0.5) / w`，所以归一化坐标 `u` 对应的纹素坐标是
/// `u·w − 0.5`。声波配方读频谱行都经这里，将来若有 GPU 声波配方也按同一条采样。
pub fn sample_row_linear(row: &[u8], u: f64) -> f64 {
    if row.is_empty() {
        return 0.0;
    }
    let last = row.len() - 1;
    let position = u * row.len() as f64 - 0.5;
    let base = position.floor();
    let fraction = position - base;
    let index = |offset: f64| -> f64 {
        let clamped = (base + offset).clamp(0.0, last as f64) as usize;
        f64::from(row[clamped.min(last)]) / f64::from(u8::MAX)
    };
    index(0.0) * (1.0 - fraction) + index(1.0) * fraction
}

// ── path 组装 ─────────────────────────────────────────────────────

/// 一个矩形子路径（画布顺时针）。
///
/// 多个子路径同向叠在一条 path 里，用 **nonzero** 填充就是并集；分成多条
/// `FillRect` 画会在重叠处把半透明色叠两次。
pub fn rect_subpath(out: &mut Vec<PathSeg>, x: f64, y: f64, w: f64, h: f64) {
    if !(w > 0.0 && h > 0.0) {
        return;
    }
    out.push(path_seg_move(x, y));
    out.push(path_seg_line(x + w, y));
    out.push(path_seg_line(x + w, y + h));
    out.push(path_seg_line(x, y + h));
    out.push(path_seg_close());
}

/// 极角 → 画布点：`phi` 自**正上方**起、**顺时针**为正。
///
/// 与 `progress_circle` / `progress_donut` 的 `atan(-centred.x, -centred.y) + PI`
/// 同一朝向（那条公式在 v 向上的 `texCoord` 里给出"从正上方顺时针"）。
pub fn polar(center: (f64, f64), radius: f64, phi: f64) -> (f64, f64) {
    (center.0 + radius * phi.sin(), center.1 - radius * phi.cos())
}

/// 一段圆弧的三次贝塞尔近似，追加到 `out`（不含 move）。
fn arc_segments(out: &mut Vec<PathSeg>, center: (f64, f64), radius: f64, from: f64, to: f64) {
    let sweep = to - from;
    if sweep == 0.0 || radius <= 0.0 {
        return;
    }
    // 每段不超过四分之一圆：贝塞尔近似的误差在 π/2 以内可以忽略。
    let count = (sweep.abs() / (std::f64::consts::FRAC_PI_2))
        .ceil()
        .max(1.0);
    let step = sweep / count;
    let handle = 4.0 / 3.0 * (step / 4.0).tan();
    let mut angle = from;
    for _ in 0..(count as usize) {
        let next = angle + step;
        let start = polar(center, radius, angle);
        let end = polar(center, radius, next);
        // dP/dφ = r·(cos φ, sin φ)
        let c1 = (
            start.0 + handle * radius * angle.cos(),
            start.1 + handle * radius * angle.sin(),
        );
        let c2 = (
            end.0 - handle * radius * next.cos(),
            end.1 - handle * radius * next.sin(),
        );
        out.push(path_seg_cubic(c1, c2, end));
        angle = next;
    }
}

/// 完整的圆环（`inner <= 0` 时是实心圆盘）。
///
/// 外圈顺时针、内圈逆时针 ⇒ nonzero 填充自然挖空，不需要 even-odd。
pub fn ring_subpath(out: &mut Vec<PathSeg>, center: (f64, f64), outer: f64, inner: f64) {
    if outer <= 0.0 {
        return;
    }
    let full = std::f64::consts::TAU;
    let start = polar(center, outer, 0.0);
    out.push(path_seg_move(start.0, start.1));
    arc_segments(out, center, outer, 0.0, full);
    out.push(path_seg_close());
    if inner > 0.0 {
        hole_subpath(out, center, inner);
    }
}

/// **反向绕**的整圆子路径：追加在正向子路径（[`rect_subpath`] / [`ring_subpath`]
/// 的外圈）后面，nonzero 填充下就是一个**洞**。
///
/// [`polar`] 的 φ=0 在顶点、φ 增大往右——在 y 向下的画布上是顺时针，与
/// [`rect_subpath`] 同向，因此洞必须反着扫一圈。
pub fn hole_subpath(out: &mut Vec<PathSeg>, center: (f64, f64), radius: f64) {
    if radius <= 0.0 {
        return;
    }
    let start = polar(center, radius, 0.0);
    out.push(path_seg_move(start.0, start.1));
    arc_segments(out, center, radius, 0.0, -std::f64::consts::TAU);
    out.push(path_seg_close());
}

/// 环形扇区：`[from, to]` 角区间 × `[inner, outer]` 半径区间。
/// `inner <= 0` 时退化成饼形。
pub fn sector_subpath(
    out: &mut Vec<PathSeg>,
    center: (f64, f64),
    outer: f64,
    inner: f64,
    from: f64,
    to: f64,
) {
    if outer <= 0.0 || to == from {
        return;
    }
    if (to - from).abs() >= std::f64::consts::TAU {
        ring_subpath(out, center, outer, inner);
        return;
    }
    let start = polar(center, outer, from);
    out.push(path_seg_move(start.0, start.1));
    arc_segments(out, center, outer, from, to);
    if inner > 0.0 {
        let back = polar(center, inner, to);
        out.push(path_seg_line(back.0, back.1));
        arc_segments(out, center, inner, to, from);
    } else {
        out.push(path_seg_line(center.0, center.1));
    }
    out.push(path_seg_close());
}

/// 半径 `dot` 的圆盘沿半径 `orbit` 的圆弧 `[from, to]` 扫过的**并集**。
///
/// `snake` 系列的参考实现是「逐度累加一个个小圆的 alpha 再 `min(…, 1)`」。
/// 圆心间距（1° 上的 0.4 半径 ≈ 0.007）只有圆半径（0.1）的十四分之一，叠加场
/// 因此在整个并集内部早就饱和，半覆盖等值线就是**并集的边界**本身。
///
/// 而这个并集有闭式：到圆弧距离 ≤ `dot` 的点集 = `[orbit − dot, orbit + dot]`
/// 的环形扇区 ∪ 两个端点圆盘。角度落在扇区内的点，最近的弧上点与它同角；
/// 角度在扇区外的点，最近的弧上点是端点——两种情形正好穷尽，没有第三种。
/// 于是逐度循环只剩下**定圈数**这一件事（`maxIterations` / `angleIncrementDeg`
/// 仍是数据真相），几何本身一条 [`sector_subpath`] + 两条 [`ring_subpath`] 说完。
///
/// 三段一律按 [`ring_subpath`] 的朝向（`phi` 增加）压入：nonzero 填充求并集的
/// 前提是同向，反向的扇区会把端点圆盘**挖掉**。
pub fn swept_arc_subpath(
    out: &mut Vec<PathSeg>,
    center: (f64, f64),
    orbit: f64,
    dot: f64,
    from: f64,
    to: f64,
) {
    if dot <= 0.0 {
        return;
    }
    let (outer, inner) = (orbit + dot, (orbit - dot).max(0.0));
    let (low, high) = if to >= from { (from, to) } else { (to, from) };
    sector_subpath(out, center, outer, inner, low, high);
    ring_subpath(out, polar(center, orbit, from), dot, 0.0);
    if to != from {
        ring_subpath(out, polar(center, orbit, to), dot, 0.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `edge0 == edge1` 退化成阶跃；其余处与 GLSL 同式。
    #[test]
    fn the_smoothstep_degenerates_to_a_step() {
        assert_eq!(smoothstep(0.5, 0.5, 0.4), 0.0);
        assert_eq!(smoothstep(0.5, 0.5, 0.5), 1.0);
        assert!((smoothstep(0.0, 1.0, 0.5) - 0.5).abs() < 1e-12);
        assert_eq!(smoothstep(0.0, 1.0, -1.0), 0.0);
        assert_eq!(smoothstep(0.0, 1.0, 2.0), 1.0);
    }

    /// 纹素中心在 `(i + 0.5)/w`：`u = 0` 与 `u = 1` 落在 clamp-to-edge 上。
    #[test]
    fn the_row_sampler_matches_gl_linear_clamp_to_edge() {
        let row = [0u8, 255, 0, 255];
        assert!((sample_row_linear(&row, 0.0) - 0.0).abs() < 1e-12);
        assert!((sample_row_linear(&row, 1.0) - 1.0).abs() < 1e-12);
        // 第 0 与第 1 个纹素的正中间 = 两者平均。
        let middle = sample_row_linear(&row, 0.25);
        assert!((middle - 0.5).abs() < 1e-9, "{middle}");
        // 纹素中心处取到纹素本身。
        assert!((sample_row_linear(&row, 0.375) - 1.0).abs() < 1e-12);
        assert_eq!(sample_row_linear(&[], 0.5), 0.0);
    }

    #[test]
    fn the_easings_match_the_reference_formulas() {
        assert_eq!(Easing::parse("easeOutQuad").unwrap().apply(0.0), 0.0);
        assert_eq!(Easing::parse("easeOutQuad").unwrap().apply(1.0), 1.0);
        assert!((Easing::parse("easeOutQuad").unwrap().apply(0.5) - 0.75).abs() < 1e-12);
        assert!((Easing::parse("easeOutCubic").unwrap().apply(0.5) - 0.875).abs() < 1e-12);
        assert!(
            (Easing::parse("easeOutSine").unwrap().apply(0.5)
                - (0.25 * std::f64::consts::PI).sin())
            .abs()
                < 1e-12
        );
        assert_eq!(Easing::parse("none").unwrap().apply(0.3), 0.3);
        assert!(Easing::parse("easeInBounce").is_none());
    }

    /// v 轴翻转：归一化 `v = 0` 是盒子**底边**。
    #[test]
    fn the_box_flips_v_from_bottom_up_to_canvas_down() {
        let bbox = DrawBox {
            x: 10.0,
            y: 20.0,
            w: 100.0,
            h: 50.0,
        };
        assert_eq!(bbox.at(0.0, 0.0), (10.0, 70.0));
        assert_eq!(bbox.at(1.0, 1.0), (110.0, 20.0));
        assert_eq!(bbox.center(), (60.0, 45.0));
        let square = bbox.inscribed_square();
        assert_eq!((square.w, square.h), (50.0, 50.0));
        assert_eq!(square.center(), bbox.center());
    }

    /// 极角自正上方顺时针：π/2 在右、π 在下。
    #[test]
    fn the_polar_helper_starts_at_the_top_and_turns_clockwise() {
        let center = (0.0, 0.0);
        let top = polar(center, 1.0, 0.0);
        assert!(top.0.abs() < 1e-12 && (top.1 + 1.0).abs() < 1e-12);
        let right = polar(center, 1.0, std::f64::consts::FRAC_PI_2);
        assert!((right.0 - 1.0).abs() < 1e-12 && right.1.abs() < 1e-12);
        let bottom = polar(center, 1.0, std::f64::consts::PI);
        assert!(bottom.0.abs() < 1e-12 && (bottom.1 - 1.0).abs() < 1e-12);
    }

    /// 扫掠并集：单点退化成一个圆盘；反向区间与正向区间画出同一条路径。
    #[test]
    fn the_swept_arc_is_direction_independent_and_degenerates_to_a_disc() {
        let center = (0.0, 0.0);
        let mut dot = Vec::new();
        swept_arc_subpath(&mut dot, center, 0.4, 0.1, 0.0, 0.0);
        let mut disc = Vec::new();
        ring_subpath(&mut disc, polar(center, 0.4, 0.0), 0.1, 0.0);
        assert_eq!(dot, disc, "零跨度只剩一个端点圆盘");

        let mut forward = Vec::new();
        swept_arc_subpath(&mut forward, center, 0.4, 0.1, 0.0, 1.0);
        let mut expected = Vec::new();
        sector_subpath(&mut expected, center, 0.5, 0.3, 0.0, 1.0);
        expected.extend(disc.iter().copied());
        ring_subpath(&mut expected, polar(center, 0.4, 1.0), 0.1, 0.0);
        assert_eq!(forward, expected);
        // 反向区间：扇区的朝向被扶正（否则 nonzero 会把端点圆盘挖掉），
        // 只有两个端点圆盘的先后次序不同。
        let mut backward = Vec::new();
        swept_arc_subpath(&mut backward, center, 0.4, 0.1, 1.0, 0.0);
        let sector_len = expected.len() - 2 * disc.len();
        assert_eq!(forward[..sector_len], backward[..sector_len]);
        let mut nothing = Vec::new();
        swept_arc_subpath(&mut nothing, center, 0.4, 0.0, 0.0, 1.0);
        assert!(nothing.is_empty());
    }

    #[test]
    fn a_full_sweep_sector_degenerates_to_a_ring() {
        let mut sector = Vec::new();
        sector_subpath(
            &mut sector,
            (0.0, 0.0),
            10.0,
            4.0,
            0.0,
            std::f64::consts::TAU,
        );
        let mut ring = Vec::new();
        ring_subpath(&mut ring, (0.0, 0.0), 10.0, 4.0);
        assert_eq!(sector, ring);
    }
}
