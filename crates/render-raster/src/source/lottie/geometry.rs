//! Lottie 几何：贝塞尔轮廓、形状原语（矩形 / 椭圆 / 星形）、路径修改器
//! （trim / 圆角 / 虚线）与到 DrawOp `PathData` 的转换。
//!
//! 全程 f64，只在最后一步落到 `PathData` 的 f32——中间量用 f32 会让 trim 的
//! 弧长累加在长路径上掉精度，而 trim 的可见结果对长度极其敏感。

use crate::drawop::{PathData, PathSeg};

pub type Pt = [f64; 2];

/// 仿射变换，行序与 `tiny_skia::Transform::from_row` 一致。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Affine {
    pub sx: f64,
    pub ky: f64,
    pub kx: f64,
    pub sy: f64,
    pub tx: f64,
    pub ty: f64,
}

impl Default for Affine {
    fn default() -> Self {
        Affine::IDENTITY
    }
}

impl Affine {
    pub const IDENTITY: Affine = Affine {
        sx: 1.0,
        ky: 0.0,
        kx: 0.0,
        sy: 1.0,
        tx: 0.0,
        ty: 0.0,
    };

    pub fn translate(x: f64, y: f64) -> Affine {
        Affine {
            tx: x,
            ty: y,
            ..Affine::IDENTITY
        }
    }

    pub fn scale(x: f64, y: f64) -> Affine {
        Affine {
            sx: x,
            sy: y,
            ..Affine::IDENTITY
        }
    }

    /// 角度制，顺时针为正（AE 的旋转方向，y 轴向下）。
    pub fn rotate(degrees: f64) -> Affine {
        let r = degrees.to_radians();
        let (s, c) = (r.sin(), r.cos());
        Affine {
            sx: c,
            ky: s,
            kx: -s,
            sy: c,
            tx: 0.0,
            ty: 0.0,
        }
    }

    /// AE 的 skew / skewAxis（角度制）。
    pub fn skew(skew: f64, axis: f64) -> Affine {
        if skew == 0.0 {
            return Affine::IDENTITY;
        }
        let shear = Affine {
            sx: 1.0,
            ky: 0.0,
            kx: -skew.to_radians().tan(),
            sy: 1.0,
            tx: 0.0,
            ty: 0.0,
        };
        Affine::rotate(-axis).then(shear).then(Affine::rotate(axis))
    }

    /// `self` 之后再施加 `outer`（即 `outer ∘ self`）。
    pub fn then(self, outer: Affine) -> Affine {
        Affine {
            sx: outer.sx * self.sx + outer.kx * self.ky,
            ky: outer.ky * self.sx + outer.sy * self.ky,
            kx: outer.sx * self.kx + outer.kx * self.sy,
            sy: outer.ky * self.kx + outer.sy * self.sy,
            tx: outer.sx * self.tx + outer.kx * self.ty + outer.tx,
            ty: outer.ky * self.tx + outer.sy * self.ty + outer.ty,
        }
    }

    pub fn apply(&self, p: Pt) -> Pt {
        [
            self.sx * p[0] + self.kx * p[1] + self.tx,
            self.ky * p[0] + self.sy * p[1] + self.ty,
        ]
    }

    /// 只作用于方向向量（不含平移）——切线用它。
    pub fn apply_vector(&self, p: Pt) -> Pt {
        [
            self.sx * p[0] + self.kx * p[1],
            self.ky * p[0] + self.sy * p[1],
        ]
    }

    pub fn to_mat6(self) -> [f32; 6] {
        [
            self.sx as f32,
            self.ky as f32,
            self.kx as f32,
            self.sy as f32,
            self.tx as f32,
            self.ty as f32,
        ]
    }

    /// 均匀缩放的标量近似（描边宽度换算用；AE 对非均匀缩放的描边本就是近似）。
    pub fn mean_scale(&self) -> f64 {
        let a = (self.sx * self.sx + self.ky * self.ky).sqrt();
        let b = (self.kx * self.kx + self.sy * self.sy).sqrt();
        ((a * b).abs()).sqrt()
    }
}

/// 一条贝塞尔轮廓。`i` / `o` 是**相对 `v` 的**控制点偏移（bodymovin 约定）。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Contour {
    pub v: Vec<Pt>,
    pub i: Vec<Pt>,
    pub o: Vec<Pt>,
    pub closed: bool,
}

impl Contour {
    pub fn len(&self) -> usize {
        self.v.len()
    }

    pub fn is_empty(&self) -> bool {
        self.v.is_empty()
    }

    pub fn transformed(&self, m: &Affine) -> Contour {
        Contour {
            v: self.v.iter().map(|p| m.apply(*p)).collect(),
            i: self.i.iter().map(|p| m.apply_vector(*p)).collect(),
            o: self.o.iter().map(|p| m.apply_vector(*p)).collect(),
            closed: self.closed,
        }
    }

    /// 反向（bodymovin 的 `d: 3`）：顶点倒序，进出切线互换。
    pub fn reversed(&self) -> Contour {
        let mut out = Contour {
            v: self.v.iter().rev().copied().collect(),
            i: self.o.iter().rev().copied().collect(),
            o: self.i.iter().rev().copied().collect(),
            closed: self.closed,
        };
        // 闭合轮廓反向后首点仍应是原首点，否则 trim 的起点会跳一格
        if self.closed && out.v.len() > 1 {
            out.v.rotate_right(1);
            out.i.rotate_right(1);
            out.o.rotate_right(1);
        }
        out
    }

    /// 逐段三次贝塞尔。闭合轮廓多一段回到首点。
    fn segments(&self) -> Vec<CubicSeg> {
        let n = self.v.len();
        if n < 2 {
            return Vec::new();
        }
        let count = if self.closed { n } else { n - 1 };
        let mut out = Vec::with_capacity(count);
        for k in 0..count {
            let a = k;
            let b = (k + 1) % n;
            let p0 = self.v[a];
            let p1 = add(p0, self.o.get(a).copied().unwrap_or([0.0, 0.0]));
            let p3 = self.v[b];
            let p2 = add(p3, self.i.get(b).copied().unwrap_or([0.0, 0.0]));
            out.push(CubicSeg { p0, p1, p2, p3 });
        }
        out
    }
}

/// 一组轮廓 = 一条可填充 / 可描边的路径。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ShapePath(pub Vec<Contour>);

impl ShapePath {
    pub fn single(contour: Contour) -> ShapePath {
        ShapePath(vec![contour])
    }

    pub fn is_empty(&self) -> bool {
        self.0.iter().all(Contour::is_empty)
    }

    pub fn transformed(&self, m: &Affine) -> ShapePath {
        ShapePath(self.0.iter().map(|c| c.transformed(m)).collect())
    }

    pub fn extend(&mut self, other: &ShapePath) {
        self.0.extend(other.0.iter().cloned());
    }

    /// → DrawOp 的路径侧表条目。
    pub fn to_path_data(&self) -> PathData {
        let mut segs = Vec::new();
        for contour in &self.0 {
            if contour.v.len() < 2 {
                continue;
            }
            let start = contour.v[0];
            segs.push(PathSeg {
                verb: 0,
                pts: [start[0] as f32, start[1] as f32, 0.0, 0.0, 0.0, 0.0],
            });
            for seg in contour.segments() {
                segs.push(PathSeg {
                    verb: 3,
                    pts: [
                        seg.p1[0] as f32,
                        seg.p1[1] as f32,
                        seg.p2[0] as f32,
                        seg.p2[1] as f32,
                        seg.p3[0] as f32,
                        seg.p3[1] as f32,
                    ],
                });
            }
            if contour.closed {
                segs.push(PathSeg {
                    verb: 4,
                    pts: [0.0; 6],
                });
            }
        }
        PathData(segs)
    }
}

fn add(a: Pt, b: Pt) -> Pt {
    [a[0] + b[0], a[1] + b[1]]
}

fn sub(a: Pt, b: Pt) -> Pt {
    [a[0] - b[0], a[1] - b[1]]
}

fn mul(a: Pt, k: f64) -> Pt {
    [a[0] * k, a[1] * k]
}

fn dist(a: Pt, b: Pt) -> f64 {
    let d = sub(a, b);
    (d[0] * d[0] + d[1] * d[1]).sqrt()
}

// ── 形状原语 ───────────────────────────────────────────────────────

/// 圆的四段三次贝塞尔近似常量。
const KAPPA: f64 = 0.5519;

/// 椭圆（bodymovin `el`）：中心 `p`、直径 `s`。
pub fn ellipse(center: Pt, size: Pt) -> Contour {
    let (rx, ry) = (size[0] / 2.0, size[1] / 2.0);
    let (cx, cy) = (center[0], center[1]);
    let (ox, oy) = (rx * KAPPA, ry * KAPPA);
    Contour {
        v: vec![[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]],
        o: vec![[ox, 0.0], [0.0, oy], [-ox, 0.0], [0.0, -oy]],
        i: vec![[-ox, 0.0], [0.0, -oy], [ox, 0.0], [0.0, oy]],
        closed: true,
    }
}

/// 矩形（bodymovin `rc`）：中心 `p`、尺寸 `s`、圆角 `r`。
pub fn rect(center: Pt, size: Pt, radius: f64) -> Contour {
    let (hw, hh) = ((size[0] / 2.0).abs(), (size[1] / 2.0).abs());
    let (cx, cy) = (center[0], center[1]);
    let r = radius.max(0.0).min(hw.min(hh));
    if r <= 0.0 {
        return Contour {
            v: vec![
                [cx + hw, cy - hh],
                [cx + hw, cy + hh],
                [cx - hw, cy + hh],
                [cx - hw, cy - hh],
            ],
            i: vec![[0.0, 0.0]; 4],
            o: vec![[0.0, 0.0]; 4],
            closed: true,
        };
    }
    let k = r * KAPPA;
    // 顺序与 AE 一致：右上 → 右下 → 左下 → 左上，每角两个顶点
    Contour {
        v: vec![
            [cx + hw, cy - hh + r],
            [cx + hw, cy + hh - r],
            [cx + hw - r, cy + hh],
            [cx - hw + r, cy + hh],
            [cx - hw, cy + hh - r],
            [cx - hw, cy - hh + r],
            [cx - hw + r, cy - hh],
            [cx + hw - r, cy - hh],
        ],
        o: vec![
            [0.0, 0.0],
            [0.0, k],
            [0.0, 0.0],
            [-k, 0.0],
            [0.0, 0.0],
            [0.0, -k],
            [0.0, 0.0],
            [k, 0.0],
        ],
        i: vec![
            [0.0, -k],
            [0.0, 0.0],
            [k, 0.0],
            [0.0, 0.0],
            [0.0, k],
            [0.0, 0.0],
            [-k, 0.0],
            [0.0, 0.0],
        ],
        closed: true,
    }
}

/// 星形 / 多边形（bodymovin `sr`）。`points` 是**角数**；星形交替内外半径。
#[allow(clippy::too_many_arguments)]
pub fn star(
    center: Pt,
    points: f64,
    rotation: f64,
    outer_radius: f64,
    outer_round: f64,
    inner_radius: f64,
    inner_round: f64,
    is_star: bool,
) -> Contour {
    let n = points.max(2.0).round() as usize;
    let count = if is_star { n * 2 } else { n };
    let step = std::f64::consts::TAU / count as f64;
    // AE 的 0° 指向正上方
    let mut angle = rotation.to_radians() - std::f64::consts::FRAC_PI_2;
    let mut contour = Contour {
        v: Vec::with_capacity(count),
        i: Vec::with_capacity(count),
        o: Vec::with_capacity(count),
        closed: true,
    };
    for k in 0..count {
        let (radius, round) = if !is_star {
            (outer_radius, outer_round)
        } else if k % 2 == 0 {
            (outer_radius, outer_round)
        } else {
            (inner_radius, inner_round)
        };
        let (s, c) = (angle.sin(), angle.cos());
        contour
            .v
            .push([center[0] + radius * c, center[1] + radius * s]);
        // 圆角量：AE 的 roundness 是百分比，落在切线上
        let handle = radius * (round / 100.0) * step / 2.0;
        contour.o.push([-handle * s, handle * c]);
        contour.i.push([handle * s, -handle * c]);
        angle += step;
    }
    contour
}

// ── 路径修改器 ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
struct CubicSeg {
    p0: Pt,
    p1: Pt,
    p2: Pt,
    p3: Pt,
}

/// 每段贝塞尔的弧长采样数。**常量**：迭代次数参与结果，不能随长度自适应，
/// 否则同一条路径在不同缩放下会 trim 到不同位置。
const FLATTEN: usize = 32;

impl CubicSeg {
    fn at(&self, t: f64) -> Pt {
        let u = 1.0 - t;
        [
            u * u * u * self.p0[0]
                + 3.0 * u * u * t * self.p1[0]
                + 3.0 * u * t * t * self.p2[0]
                + t * t * t * self.p3[0],
            u * u * u * self.p0[1]
                + 3.0 * u * u * t * self.p1[1]
                + 3.0 * u * t * t * self.p2[1]
                + t * t * t * self.p3[1],
        ]
    }

    /// 累积弧长表（`FLATTEN + 1` 项，首项为 0）。
    fn lut(&self) -> Vec<f64> {
        let mut out = Vec::with_capacity(FLATTEN + 1);
        out.push(0.0);
        let mut prev = self.p0;
        let mut acc = 0.0;
        for k in 1..=FLATTEN {
            let p = self.at(k as f64 / FLATTEN as f64);
            acc += dist(prev, p);
            out.push(acc);
            prev = p;
        }
        out
    }

    /// 弧长 → 参数 t（在采样表内线性插值）。
    fn t_at_length(&self, lut: &[f64], length: f64) -> f64 {
        let total = *lut.last().unwrap_or(&0.0);
        if total <= 0.0 {
            return 0.0;
        }
        let length = length.clamp(0.0, total);
        let idx = lut.partition_point(|l| *l < length).max(1).min(FLATTEN);
        let (l0, l1) = (lut[idx - 1], lut[idx]);
        let frac = if l1 > l0 {
            (length - l0) / (l1 - l0)
        } else {
            0.0
        };
        (idx as f64 - 1.0 + frac) / FLATTEN as f64
    }

    /// de Casteljau 截取 `[t0, t1]`。
    fn split(&self, t0: f64, t1: f64) -> CubicSeg {
        let right = self.split_after(t0);
        let t = if t0 < 1.0 {
            ((t1 - t0) / (1.0 - t0)).clamp(0.0, 1.0)
        } else {
            0.0
        };
        right.split_before(t)
    }

    fn split_after(&self, t: f64) -> CubicSeg {
        let a = lerp_pt(self.p0, self.p1, t);
        let b = lerp_pt(self.p1, self.p2, t);
        let c = lerp_pt(self.p2, self.p3, t);
        let d = lerp_pt(a, b, t);
        let e = lerp_pt(b, c, t);
        let f = lerp_pt(d, e, t);
        CubicSeg {
            p0: f,
            p1: e,
            p2: c,
            p3: self.p3,
        }
    }

    fn split_before(&self, t: f64) -> CubicSeg {
        let a = lerp_pt(self.p0, self.p1, t);
        let b = lerp_pt(self.p1, self.p2, t);
        let c = lerp_pt(self.p2, self.p3, t);
        let d = lerp_pt(a, b, t);
        let e = lerp_pt(b, c, t);
        let f = lerp_pt(d, e, t);
        CubicSeg {
            p0: self.p0,
            p1: a,
            p2: d,
            p3: f,
        }
    }
}

fn lerp_pt(a: Pt, b: Pt, t: f64) -> Pt {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/// 一条轮廓的可测量形态：分段 + 每段弧长表 + 总长。
struct Measured {
    segs: Vec<CubicSeg>,
    luts: Vec<Vec<f64>>,
    lengths: Vec<f64>,
    total: f64,
}

fn measure(contour: &Contour) -> Measured {
    let segs = contour.segments();
    let luts: Vec<Vec<f64>> = segs.iter().map(CubicSeg::lut).collect();
    let lengths: Vec<f64> = luts.iter().map(|l| *l.last().unwrap_or(&0.0)).collect();
    let total = lengths.iter().sum();
    Measured {
        segs,
        luts,
        lengths,
        total,
    }
}

/// 取 `[from, to]`（弧长）之间的一段，产出**开放**轮廓。
fn slice(m: &Measured, from: f64, to: f64) -> Option<Contour> {
    if m.total <= 0.0 || to <= from {
        return None;
    }
    let from = from.max(0.0);
    let to = to.min(m.total);
    let mut kept: Vec<CubicSeg> = Vec::new();
    let mut cursor = 0.0;
    for (idx, seg) in m.segs.iter().enumerate() {
        let len = m.lengths[idx];
        let (s0, s1) = (cursor, cursor + len);
        cursor = s1;
        if len <= 0.0 || s1 <= from || s0 >= to {
            continue;
        }
        let t0 = if from > s0 {
            seg.t_at_length(&m.luts[idx], from - s0)
        } else {
            0.0
        };
        let t1 = if to < s1 {
            seg.t_at_length(&m.luts[idx], to - s0)
        } else {
            1.0
        };
        if t1 <= t0 {
            continue;
        }
        kept.push(seg.split(t0, t1));
    }
    if kept.is_empty() {
        return None;
    }
    let mut out = Contour {
        closed: false,
        ..Contour::default()
    };
    out.v.push(kept[0].p0);
    out.i.push([0.0, 0.0]);
    out.o.push(sub(kept[0].p1, kept[0].p0));
    for (idx, seg) in kept.iter().enumerate() {
        out.v.push(seg.p3);
        out.i.push(sub(seg.p2, seg.p3));
        out.o.push(if let Some(next) = kept.get(idx + 1) {
            sub(next.p1, next.p0)
        } else {
            [0.0, 0.0]
        });
    }
    Some(out)
}

/// Trim Paths（bodymovin `tm`）。`start` / `end` 是 0..100 的百分比，
/// `offset` 是角度。`individually` 对应 `m: 2`（逐轮廓），否则整条路径连起来算。
pub fn trim(path: &ShapePath, start: f64, end: f64, offset: f64, individually: bool) -> ShapePath {
    let (mut s, mut e) = (start / 100.0, end / 100.0);
    let o = offset / 360.0;
    s += o;
    e += o;
    if s > e {
        std::mem::swap(&mut s, &mut e);
    }
    if e - s >= 1.0 {
        return path.clone();
    }
    if e - s <= 0.0 {
        return ShapePath::default();
    }
    let span = e - s;
    let s = s.rem_euclid(1.0);
    let e = s + span;

    if individually {
        let mut out = Vec::new();
        for contour in &path.0 {
            let m = measure(contour);
            out.extend(trim_measured(&m, s, e, contour));
        }
        return ShapePath(out);
    }

    // 并行模式：全部轮廓首尾相接当作一条来量
    let measured: Vec<Measured> = path.0.iter().map(measure).collect();
    let total: f64 = measured.iter().map(|m| m.total).sum();
    if total <= 0.0 {
        return ShapePath::default();
    }
    let ranges: Vec<(f64, f64)> = if e <= 1.0 {
        vec![(s * total, e * total)]
    } else {
        vec![(s * total, total), (0.0, (e - 1.0) * total)]
    };
    let mut out = Vec::new();
    let mut base = 0.0;
    for (idx, m) in measured.iter().enumerate() {
        let contour = &path.0[idx];
        let (lo, hi) = (base, base + m.total);
        base = hi;
        for (a, b) in &ranges {
            let (a, b) = (a.max(lo) - lo, b.min(hi) - lo);
            if b <= a {
                continue;
            }
            if a <= 0.0 && b >= m.total && contour.closed {
                out.push(contour.clone());
            } else if let Some(piece) = slice(m, a, b) {
                out.push(piece);
            }
        }
    }
    ShapePath(out)
}

fn trim_measured(m: &Measured, s: f64, e: f64, contour: &Contour) -> Vec<Contour> {
    if m.total <= 0.0 {
        return Vec::new();
    }
    if s <= 0.0 && e >= 1.0 && contour.closed {
        return vec![contour.clone()];
    }
    let mut out = Vec::new();
    if e <= 1.0 {
        out.extend(slice(m, s * m.total, e * m.total));
    } else {
        out.extend(slice(m, s * m.total, m.total));
        out.extend(slice(m, 0.0, (e - 1.0) * m.total));
    }
    out
}

/// 圆角（bodymovin `rd`）。只处理**尖角**顶点（进出切线都为零），与
/// lottie-web 的 `RoundCornersModifier` 同一判据——已经带曲率的顶点不动。
pub fn round_corners(path: &ShapePath, radius: f64) -> ShapePath {
    if radius <= 0.0 {
        return path.clone();
    }
    let mut out = Vec::with_capacity(path.0.len());
    for contour in &path.0 {
        let n = contour.v.len();
        if n < 2 {
            out.push(contour.clone());
            continue;
        }
        let mut next = Contour {
            closed: contour.closed,
            ..Contour::default()
        };
        for idx in 0..n {
            let cur = contour.v[idx];
            let ci = contour.i.get(idx).copied().unwrap_or([0.0, 0.0]);
            let co = contour.o.get(idx).copied().unwrap_or([0.0, 0.0]);
            let is_corner = ci == [0.0, 0.0] && co == [0.0, 0.0];
            let first = idx == 0;
            let last = idx + 1 == n;
            if !is_corner || (!contour.closed && (first || last)) {
                next.v.push(cur);
                next.i.push(ci);
                next.o.push(co);
                continue;
            }
            let prev = contour.v[(idx + n - 1) % n];
            let after = contour.v[(idx + 1) % n];
            let (dp, da) = (dist(cur, prev), dist(cur, after));
            if dp <= 0.0 || da <= 0.0 {
                next.v.push(cur);
                next.i.push(ci);
                next.o.push(co);
                continue;
            }
            let rp = radius.min(dp / 2.0);
            let ra = radius.min(da / 2.0);
            let a = add(cur, mul(sub(prev, cur), rp / dp));
            let b = add(cur, mul(sub(after, cur), ra / da));
            next.v.push(a);
            next.i.push([0.0, 0.0]);
            next.o.push(mul(sub(cur, a), KAPPA));
            next.v.push(b);
            next.i.push(mul(sub(cur, b), KAPPA));
            next.o.push([0.0, 0.0]);
        }
        out.push(next);
    }
    ShapePath(out)
}

/// 虚线（bodymovin 描边的 `d`）。`pattern` 是 dash/gap 交替的长度序列，
/// `offset` 是起始偏移。产出一组开放轮廓，交给描边原语。
pub fn dash(path: &ShapePath, pattern: &[f64], offset: f64) -> ShapePath {
    let pattern: Vec<f64> = pattern.iter().copied().filter(|v| *v >= 0.0).collect();
    let cycle: f64 = pattern.iter().sum();
    if pattern.is_empty() || cycle <= 0.0 {
        return path.clone();
    }
    // 奇数长度按 SVG 惯例重复一遍，凑成 dash/gap 成对
    let pattern: Vec<f64> = if pattern.len() % 2 == 1 {
        pattern.iter().chain(pattern.iter()).copied().collect()
    } else {
        pattern
    };
    let cycle: f64 = pattern.iter().sum();
    let mut out = Vec::new();
    for contour in &path.0 {
        let m = measure(contour);
        if m.total <= 0.0 {
            continue;
        }
        let mut position = -offset.rem_euclid(cycle);
        let mut index = 0usize;
        let mut on = true;
        // 上限保护：一条路径最多切 4096 段虚线，病态 pattern 不至于挂住渲染
        for _ in 0..4096 {
            if position >= m.total {
                break;
            }
            let len = pattern[index % pattern.len()];
            let end = position + len;
            if on && end > 0.0 {
                out.extend(slice(&m, position.max(0.0), end.min(m.total)));
            }
            position = end;
            index += 1;
            on = !on;
            if len <= 0.0 && pattern.iter().all(|v| *v <= 0.0) {
                break;
            }
        }
    }
    ShapePath(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square() -> ShapePath {
        ShapePath::single(Contour {
            v: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]],
            i: vec![[0.0, 0.0]; 4],
            o: vec![[0.0, 0.0]; 4],
            closed: true,
        })
    }

    #[test]
    fn affine_composition_matches_manual_application() {
        let m = Affine::scale(2.0, 3.0).then(Affine::translate(5.0, 7.0));
        assert_eq!(m.apply([1.0, 1.0]), [7.0, 10.0]);
        // 向量不吃平移
        assert_eq!(m.apply_vector([1.0, 1.0]), [2.0, 3.0]);
    }

    #[test]
    fn rotation_is_clockwise_in_a_y_down_space() {
        let p = Affine::rotate(90.0).apply([1.0, 0.0]);
        assert!((p[0]).abs() < 1e-12 && (p[1] - 1.0).abs() < 1e-12, "{p:?}");
    }

    #[test]
    fn a_rounded_rect_keeps_its_bounding_box() {
        let contour = rect([0.0, 0.0], [10.0, 6.0], 2.0);
        let xs: Vec<f64> = contour.v.iter().map(|p| p[0]).collect();
        let ys: Vec<f64> = contour.v.iter().map(|p| p[1]).collect();
        assert!((xs.iter().cloned().fold(f64::MIN, f64::max) - 5.0).abs() < 1e-12);
        assert!((ys.iter().cloned().fold(f64::MIN, f64::max) - 3.0).abs() < 1e-12);
        // 半径被夹到短边一半
        assert_eq!(rect([0.0, 0.0], [10.0, 6.0], 99.0).v.len(), 8);
    }

    #[test]
    fn an_ellipse_has_four_cubic_segments() {
        let data = ShapePath::single(ellipse([0.0, 0.0], [10.0, 10.0])).to_path_data();
        assert_eq!(data.0[0].verb, 0);
        assert_eq!(data.0.iter().filter(|s| s.verb == 3).count(), 4);
        assert_eq!(data.0.last().unwrap().verb, 4);
    }

    #[test]
    fn a_polygon_has_one_vertex_per_point_and_a_star_has_two() {
        assert_eq!(
            star([0.0; 2], 5.0, 0.0, 10.0, 0.0, 5.0, 0.0, false).v.len(),
            5
        );
        assert_eq!(
            star([0.0; 2], 5.0, 0.0, 10.0, 0.0, 5.0, 0.0, true).v.len(),
            10
        );
    }

    #[test]
    fn trimming_the_full_range_returns_the_path_untouched() {
        let path = square();
        assert_eq!(trim(&path, 0.0, 100.0, 0.0, false), path);
        assert!(trim(&path, 40.0, 40.0, 0.0, false).is_empty());
    }

    #[test]
    fn trimming_half_a_square_keeps_half_its_perimeter() {
        let trimmed = trim(&square(), 0.0, 50.0, 0.0, false);
        let measured: f64 = trimmed.0.iter().map(|c| measure(c).total).sum();
        assert!(
            (measured - 20.0).abs() < 0.05,
            "半周长应当是 20，实际 {measured}"
        );
        assert!(trimmed.0.iter().all(|c| !c.closed), "trim 结果是开放路径");
    }

    #[test]
    fn a_trim_offset_rotates_the_kept_arc() {
        let a = trim(&square(), 0.0, 25.0, 0.0, false);
        let b = trim(&square(), 0.0, 25.0, 90.0, false);
        assert_ne!(a, b, "offset 必须挪动保留段");
        let la: f64 = a.0.iter().map(|c| measure(c).total).sum();
        let lb: f64 = b.0.iter().map(|c| measure(c).total).sum();
        assert!((la - lb).abs() < 0.05, "长度不变，只是起点变了");
    }

    #[test]
    fn round_corners_only_touches_sharp_vertices() {
        let rounded = round_corners(&square(), 2.0);
        assert_eq!(rounded.0[0].v.len(), 8, "四个尖角各裂成两个顶点");
        // 已经带曲率的椭圆不被改动
        let circle = ShapePath::single(ellipse([0.0, 0.0], [10.0, 10.0]));
        assert_eq!(round_corners(&circle, 3.0), circle);
    }

    #[test]
    fn dashes_cut_the_path_into_alternating_pieces() {
        let dashed = dash(&square(), &[5.0, 5.0], 0.0);
        assert_eq!(dashed.0.len(), 4, "周长 40、5 开 5 关 ⇒ 4 段");
        let kept: f64 = dashed.0.iter().map(|c| measure(c).total).sum();
        assert!((kept - 20.0).abs() < 0.05, "留下一半长度，实际 {kept}");
    }

    #[test]
    fn reversing_a_contour_preserves_its_geometry() {
        let path = ShapePath::single(ellipse([1.0, 2.0], [8.0, 6.0]));
        let back = ShapePath::single(path.0[0].reversed().reversed());
        for (a, b) in path.0[0].v.iter().zip(back.0[0].v.iter()) {
            assert!((a[0] - b[0]).abs() < 1e-12 && (a[1] - b[1]).abs() < 1e-12);
        }
    }
}
