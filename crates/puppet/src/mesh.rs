//! 每层的静态网格与权重（移植自 LivLiv `Puppet.buildLayer`、`alphaGrid`、`coverAt`、`closedLashLine`、
//! `nasalRoom`、`skinOf`）：所有层的顶点落在同一张格子上；跟头、跟身体、跟头发弹簧、跟下巴、跟眉毛的权重都只是
//! 位置的函数，所以重叠的两层在接缝处移动完全一致，不会撕开。

use crate::model::{Anchors, BrowLine, Group, LayerDef, Model, Rig};
use crate::package::Texture;
use crate::rig::ChainRun;
use crate::smooth;

/// 下巴的影子在脖子上能往下伸多远，以脸高计（LivLiv 的 `NECK_SHADOW`）。
const NECK_SHADOW: f64 = 0.3;
/// 下巴下面的脖子跟头走多远（脸高）与多宽（脸宽的两段），以及脖子两侧的肩膀跟头的侧倾多少（chinFollow /
/// neckFollow，LivLiv 的缺省值）。
pub(crate) const CHIN_NECK: f64 = 0.08;
pub(crate) const CHIN_NECK_X: [f64; 2] = [0.2, 0.34];
const NECK_FOLLOW: f64 = 0.2;
const NECK_FOLLOW_Y: f64 = 0.6;
const NECK_FOLLOW_X: [f64; 2] = [0.6, 1.3];

/// 链对一层每个顶点的蒙皮：每个顶点 × 每条链（B 条），链的序号、最近点所在的段与段内位置、顶点相对那一点的偏移、权重。
#[derive(Clone, Debug)]
pub(crate) struct Skin {
    pub b: usize,
    pub c: Vec<usize>,
    pub seg: Vec<usize>,
    pub t: Vec<f32>,
    pub ux: Vec<f32>,
    pub uy: Vec<f32>,
    pub w: Vec<f32>,
    pub sum: Vec<f32>,
}

/// 一层的网格：静止位置（模型像素）、贴图坐标、三角形，以及每个顶点的各种权重。
#[derive(Clone, Debug)]
pub(crate) struct Mesh {
    pub rest: Vec<f32>,
    pub uv: Vec<f32>,
    pub tri: Vec<u32>,
    /// 每个三角形的外边（见 `raster::boundary_edges`）。
    pub aa: Vec<u8>,
    pub w_head: Vec<f32>,
    pub w_phys1: Vec<f32>,
    pub w_phys2: Vec<f32>,
    pub dep: Vec<f32>,
    pub w_front: Vec<f32>,
    pub w_brow: Vec<f32>,
    pub brow_side: Vec<i8>,
    pub brow_cap: Vec<f32>,
    pub w_jaw: Vec<f32>,
    pub w_neck: Option<Vec<f32>>,
    pub w_twist: Option<Vec<f32>>,
    /// 画在刘海上面的眉毛：每个顶点有多少跟刘海走（fol；表情画的眉毛 browTex 用 folB），以及刘海在这一点的权重
    /// （alt：每个顶点 dep、wHead、wPhys1、wPhys2、wFront 五个）。
    pub fol: Option<Vec<f32>>,
    pub fol_b: Option<Vec<f32>>,
    pub alt: Option<Vec<f32>>,
    /// 眼白与眼珠（lidCurve）：每个顶点那一列压向的高度，以及眼珠中心那一列的高度。
    pub piv_y: Option<Vec<f32>>,
    pub piv_c: Option<f64>,
    pub skin: Option<Skin>,
    pub alt_skin: Option<Skin>,
}

impl Mesh {
    pub fn len(&self) -> usize {
        self.rest.len() / 2
    }
}

/// 建网格要用的模型级信息。
pub(crate) struct Ctx<'a> {
    pub model: &'a Model,
    pub rig: &'a Rig,
    /// 有任何一帧嘴带下巴下移。
    pub jaw_moves: bool,
    /// 模型有 `brows` 层（眉毛单独成层，只动它）。
    pub brow_layer: bool,
    pub chains: &'a [ChainRun],
}

/// 刘海：第一张 `hair_front` 层与它的贴图（画在它上面的眉毛层跟它走）。
pub(crate) struct Bangs<'a> {
    pub def: &'a LayerDef,
    pub tex: &'a Texture,
}

/// LivLiv 用的 `Math.round`：.5 往正无穷进。
#[inline]
fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

pub(crate) fn interp(xs: &[f64], ys: &[f64], x: f64) -> f64 {
    if xs.is_empty() || ys.is_empty() {
        return 0.0;
    }
    if x <= xs[0] {
        return ys[0];
    }
    for i in 1..xs.len().min(ys.len()) {
        if x <= xs[i] {
            return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
        }
    }
    ys[ys.len().min(xs.len()) - 1]
}

pub(crate) fn brow_wx(b: &[f64; 4], x: f64) -> f64 {
    1.0 - smooth(0.0, (b[2] - b[0]) * 0.45, (b[0] - x).max(x - b[2]).max(0.0))
}

pub(crate) fn brow_up(b: &[f64; 4]) -> f64 {
    (b[3] - b[1]) * 1.6 + 6.0
}

/// (x, y) 处的抬眉权重：眉框上方渐弱，往下到这一列眉毛最低的像素都是满的，到睫毛最高处消失。
fn brow_weight(b: &[f64; 4], line: &BrowLine, x: f64, y: f64) -> f64 {
    if y < b[1] {
        return brow_wx(b, x) * (1.0 - smooth(0.0, brow_up(b), b[1] - y));
    }
    let bot = interp(&line.x, &line.bottom, x);
    if y <= bot {
        brow_wx(b, x)
    } else {
        brow_wx(b, x) * (1.0 - smooth(bot, interp(&line.x, &line.lid, x), y))
    }
}

/// 一层贴图（和它的嘴帧）在格子上哪些格子有内容，再向外扩一格（LivLiv 的 `alphaGrid`）。LivLiv 把图缩画到
/// 格子大小的画布上取 alpha > 0；这里取每格里有没有 alpha > 0 的贴图像素，结果是它的超集：多出来的格子只覆盖
/// 透明的地方，画出来一样。
fn occupancy(texs: &[&Texture], l: &LayerDef, gx0: i64, gy0: i64, cols: usize, rows: usize, cell: f64) -> Vec<bool> {
    let mut occ = vec![false; cols * rows];
    for t in texs {
        let (tw, th) = (t.width() as usize, t.height() as usize);
        let span = |i: usize, n: usize, start: f64, len: f64, g0: i64, limit: usize| -> (usize, usize) {
            let a = start + i as f64 * len / n as f64;
            let b = start + (i + 1) as f64 * len / n as f64;
            let c0 = ((a / cell).floor() as i64 - g0).clamp(0, limit as i64 - 1) as usize;
            let c1 = (((b / cell).ceil() as i64 - 1 - g0).max(c0 as i64)).clamp(0, limit as i64 - 1) as usize;
            (c0, c1)
        };
        let xs: Vec<(usize, usize)> = (0..tw).map(|i| span(i, tw, l.x, l.w, gx0, cols)).collect();
        let lv = &t.levels[0];
        for y in 0..th {
            let (r0, r1) = span(y, th, l.y, l.h, gy0, rows);
            let row = &lv.px[4 * y * tw..4 * (y + 1) * tw];
            for (x, &(c0, c1)) in xs.iter().enumerate() {
                if row[4 * x + 3] == 0 {
                    continue;
                }
                for r in r0..=r1 {
                    for c in c0..=c1 {
                        occ[r * cols + c] = true;
                    }
                }
            }
        }
    }
    let mut out = occ.clone();
    for r in 0..rows {
        for q in 0..cols {
            if occ[r * cols + q] {
                continue;
            }
            'near: for dr in -1i64..=1 {
                for dq in -1i64..=1 {
                    let (rr, qq) = (r as i64 + dr, q as i64 + dq);
                    if rr >= 0 && rr < rows as i64 && qq >= 0 && qq < cols as i64 && occ[rr as usize * cols + qq as usize] {
                        out[r * cols + q] = true;
                        break 'near;
                    }
                }
            }
        }
    }
    out
}

/// 一张贴图按层框拉伸后，层框里 (x, y) 处像素（整数，左上角起）的 alpha，0–1。
fn alpha_in_box(t: &Texture, w: f64, h: f64, x: f64, y: f64) -> f64 {
    let u = ((x + 0.5) * f64::from(t.width()) / w).floor() as i64;
    let v = ((y + 0.5) * f64::from(t.height()) / h).floor() as i64;
    f64::from(t.alpha(u, v)) / 255.0
}

/// 一层每个顶点附近一个格子内，它画的东西有多少落在 `under`（另一层，框 U）上面：以本层 alpha 加权的 under alpha；
/// 本层在那里什么也不画时取 under 的平均（LivLiv 的 `coverAt`）。
fn cover_at(img: &Texture, l: &LayerDef, under: &Texture, u: &LayerDef, rest: &[f32], cell: f64) -> Vec<f32> {
    let (lw, lh) = (l.w.floor(), l.h.floor());
    let mut out = vec![0f32; rest.len() / 2];
    for (i, o) in out.iter_mut().enumerate() {
        let cx = f64::from(rest[2 * i]) - l.x;
        let cy = f64::from(rest[2 * i + 1]) - l.y;
        let (mut sa, mut sab, mut sb, mut k) = (0.0, 0.0, 0.0, 0usize);
        let y0 = js_round(cy - cell).max(0.0) as i64;
        let y1 = js_round(cy + cell).min(lh) as i64;
        let x0 = js_round(cx - cell).max(0.0) as i64;
        let x1 = js_round(cx + cell).min(lw) as i64;
        for y in y0..y1 {
            for x in x0..x1 {
                let wa = alpha_in_box(img, l.w, l.h, x as f64, y as f64);
                // under 画在本层画布的 (U.x - L.x, U.y - L.y)
                let ux = x as f64 + 0.5 - (u.x - l.x);
                let uy = y as f64 + 0.5 - (u.y - l.y);
                let wb = if ux < 0.0 || uy < 0.0 || ux >= u.w || uy >= u.h {
                    0.0
                } else {
                    alpha_in_box(under, u.w, u.h, ux - 0.5, uy - 0.5)
                };
                sa += wa;
                sab += wa * wb;
                sb += wb;
                k += 1;
            }
        }
        *o = if sa > 1.0 {
            (sab / sa) as f32
        } else if k > 0 {
            (sb / k as f64) as f32
        } else {
            0.0
        };
    }
    out
}

/// 闭眼那一层画的睫毛线，按模型 x 给模型 y（lidCurve）。
#[derive(Clone, Debug)]
pub(crate) struct LashLine {
    m: f64,
    sc: f64,
    co: [f64; 3],
    x0: f64,
    x1: f64,
}

impl LashLine {
    pub fn at(&self, x: f64) -> f64 {
        let u = (x.clamp(self.x0, self.x1) - self.m) / self.sc;
        self.co[0] + self.co[1] * u + self.co[2] * u * u
    }
}

fn det3(a: &[[f64; 3]; 3]) -> f64 {
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
        + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
}

/// 最小二乘 y = a + b u + c u²，u 居中并缩放。
fn fit_parabola(p: &[(f64, f64)]) -> Option<(f64, f64, [f64; 3])> {
    let m = p.iter().map(|q| q.0).sum::<f64>() / p.len() as f64;
    let sc = ((p[p.len() - 1].0 - p[0].0) / 2.0).max(1.0);
    let mut s = [0.0; 5];
    let mut t = [0.0; 3];
    for &(x, y) in p {
        let u = (x - m) / sc;
        let mut q = 1.0;
        for k in 0..5 {
            s[k] += q;
            if k < 3 {
                t[k] += q * y;
            }
            q *= u;
        }
    }
    let mm = [[s[0], s[1], s[2]], [s[1], s[2], s[3]], [s[2], s[3], s[4]]];
    let d = det3(&mm);
    if d.abs() <= 1e-9 || !d.is_finite() {
        return None;
    }
    let mut co = [0.0; 3];
    for (j, c) in co.iter_mut().enumerate() {
        let mut a = mm;
        for (i, row) in a.iter_mut().enumerate() {
            row[j] = t[i];
        }
        *c = det3(&a) / d;
    }
    co.iter().all(|v| v.is_finite()).then_some((m, sc, co))
}

/// 闭眼层每一列最暗的不透明像素（够暗才算睫毛），再拟合两次抛物线（第二次去掉离得远的列）。少于五分之一的列
/// 有睫毛时没有（LivLiv 的 `closedLashLine`）。
pub(crate) fn closed_lash_line(t: &Texture, l: &LayerDef) -> Option<LashLine> {
    let (w, h) = (t.width() as usize, t.height() as usize);
    let lv = &t.levels[0];
    let mut pts = Vec::new();
    for x in 0..w {
        let (mut best, mut by) = (255.0, -1i64);
        for y in 0..h {
            let k = 4 * (y * w + x);
            let a = f64::from(lv.px[k + 3]);
            if a < 200.0 {
                continue;
            }
            // 贴图是预乘的：还原成画布 getImageData 读到的直通颜色
            let c = |i: usize| (f64::from(lv.px[k + i]) * 255.0 / a).round().min(255.0);
            let lum = 0.3 * c(0) + 0.59 * c(1) + 0.11 * c(2);
            if lum < best {
                best = lum;
                by = y as i64;
            }
        }
        if by >= 0 && best < 110.0 {
            pts.push((
                l.x + (x as f64 + 0.5) * (l.w / w as f64),
                l.y + (by as f64 + 0.5) * (l.h / h as f64),
            ));
        }
    }
    if (pts.len() as f64) < 0.2 * w as f64 || pts.is_empty() {
        return None;
    }
    let eval = |(m, sc, co): (f64, f64, [f64; 3]), x: f64| {
        let u = (x - m) / sc;
        co[0] + co[1] * u + co[2] * u * u
    };
    let mut f = fit_parabola(&pts)?;
    let mut res: Vec<f64> = pts.iter().map(|&(x, y)| (y - eval(f, x)).abs()).collect();
    res.sort_by(f64::total_cmp);
    let tol = (2.5 * res[res.len() >> 1]).max(1.5);
    let kept: Vec<(f64, f64)> = pts.iter().copied().filter(|&(x, y)| (y - eval(f, x)).abs() <= tol).collect();
    let mut used = &pts;
    if kept.len() as f64 >= 0.6 * pts.len() as f64
        && let Some(r) = fit_parabola(&kept)
    {
        f = r;
        used = &kept;
    }
    let (m, sc, co) = f;
    Some(LashLine {
        m,
        sc,
        co,
        x0: used[0].0,
        x1: used[used.len() - 1].0,
    })
}

/// 眼珠往鼻子那边还有多少眼白（模型像素）、鼻子在哪边（+1：+x）、静止时内侧可见的边，以及可见宽度（nasalRoom）。
#[derive(Clone, Copy, Debug)]
pub(crate) struct Nasal {
    pub room: f64,
    pub sign: f64,
    pub inner: f64,
    pub w: f64,
}

pub(crate) fn nasal_room(iris: &Texture, i: &LayerDef, mask: &Texture, e: &LayerDef, sign: f64) -> Option<Nasal> {
    let (aw, ah) = (iris.width() as usize, iris.height() as usize);
    let (mw, mh) = (f64::from(mask.width()), f64::from(mask.height()));
    let ux = i.w / aw as f64;
    let uy = i.h / ah as f64;
    let white = |x: f64, y: f64| {
        let u = (((x - e.x) / e.w) * mw).floor();
        let v = (((y - e.y) / e.h) * mh).floor();
        u >= 0.0 && v >= 0.0 && u < mw && v < mh && mask.alpha(u as i64, v as i64) >= 128
    };
    let mut rows: Vec<(f64, usize, f64, f64)> = Vec::new();
    for v in 0..ah {
        let y = i.y + (v as f64 + 0.5) * uy;
        let (mut n, mut lo, mut hi) = (0usize, f64::INFINITY, f64::NEG_INFINITY);
        for u in 0..aw {
            let x = i.x + (u as f64 + 0.5) * ux;
            if iris.alpha(u as i64, v as i64) < 200 || !white(x, y) {
                continue;
            }
            n += 1;
            lo = lo.min(x);
            hi = hi.max(x);
        }
        if n > 0 {
            rows.push((y, n, if sign > 0.0 { hi } else { lo }, if sign > 0.0 { lo } else { hi }));
        }
    }
    let top = rows.iter().map(|r| r.1).max()?;
    let (mut room, mut inner, mut width) = (Vec::new(), Vec::new(), Vec::new());
    for &(y, n, near, far) in &rows {
        if (n as f64) < 0.9 * top as f64 {
            continue;
        }
        let mut k = 0.0;
        while k < 10_000.0 && white(near + sign * (k + 1.0) * ux, y) {
            k += 1.0;
        }
        room.push(k * ux);
        inner.push(near + sign * ux / 2.0);
        width.push((near - far).abs() + ux);
    }
    let med = |mut v: Vec<f64>| {
        v.sort_by(f64::total_cmp);
        v[v.len() >> 1]
    };
    Some(Nasal {
        room: med(room),
        sign,
        inner: med(inner),
        w: med(width),
    })
}

/// 睫毛线能用的模型：正面的日漫半身与厚涂角色，不戴眼镜（LivLiv 的 `lidCurveFits`）。
pub(crate) fn lid_curve_fits(m: &Model) -> bool {
    let Some(p) = &m.profile else { return false };
    (p.id == "anime_half" || p.id == "painterly")
        && p.facing.as_deref() == Some("front")
        && p.glasses != Some(true)
        && !m.layers.iter().any(|l| l.id == "glasses")
}

/// 顶点在链 `ids` 上的位置与按距离的权重（LivLiv 的 `skinOf`）。
fn skin_of(ids: &[String], rest: &[f32], chains: &[ChainRun]) -> Option<Skin> {
    let cs: Vec<usize> = ids.iter().filter_map(|id| chains.iter().position(|c| &c.def.id == id)).collect();
    if cs.is_empty() {
        return None;
    }
    let n = rest.len() / 2;
    let b = cs.len();
    let mut s = Skin {
        b,
        c: vec![0; n * b],
        seg: vec![0; n * b],
        t: vec![0.0; n * b],
        ux: vec![0.0; n * b],
        uy: vec![0.0; n * b],
        w: vec![0.0; n * b],
        sum: vec![0.0; n],
    };
    for i in 0..n {
        let (x, y) = (f64::from(rest[2 * i]), f64::from(rest[2 * i + 1]));
        let mut sum = 0.0f64;
        for (bi, &ci) in cs.iter().enumerate() {
            let c = &chains[ci];
            let r = &c.rest;
            let m = r.len() / 2;
            let (mut best, mut bk, mut bt) = (f64::INFINITY, 0usize, 0.0f64);
            for k in 0..m - 1 {
                let (ax, ay) = (r[2 * k], r[2 * k + 1]);
                let (dx, dy) = (r[2 * k + 2] - ax, r[2 * k + 3] - ay);
                let l2 = {
                    let v = dx * dx + dy * dy;
                    if v == 0.0 { 1.0 } else { v }
                };
                let mut t = ((x - ax) * dx + (y - ay) * dy) / l2;
                // 根之前与尖之后，线照直延伸：根周围的地方也跟着转
                if k > 0 {
                    t = t.max(0.0);
                }
                if k < m - 2 {
                    t = t.min(1.0);
                }
                let (px, py) = (ax + dx * t, ay + dy * t);
                let d = (x - px).hypot(y - py);
                if d < best {
                    best = d;
                    bk = k;
                    bt = t;
                }
            }
            let j = i * b + bi;
            let k = bk;
            let tt = bt.min(1.0);
            let px = r[2 * k] + (r[2 * k + 2] - r[2 * k]) * tt;
            let py = r[2 * k + 1] + (r[2 * k + 3] - r[2 * k + 1]) * tt;
            let sg = c.def.sigma.unwrap_or(40.0);
            s.c[j] = ci;
            s.seg[j] = k;
            s.t[j] = bt as f32;
            s.ux[j] = (x - px) as f32;
            s.uy[j] = (y - py) as f32;
            s.w[j] = ((-(best / sg).powi(2)).exp() + 1e-6) as f32;
            sum += f64::from(s.w[j]);
        }
        let (mut near, mut reach) = (f64::INFINITY, f64::INFINITY);
        for bi in 0..b {
            let j = i * b + bi;
            let c = &chains[s.c[j]];
            s.w[j] = (f64::from(s.w[j]) / sum) as f32;
            if let Some(r) = c.def.reach {
                reach = reach.min(r);
            }
            near = near.min(f64::from(s.ux[j]).hypot(f64::from(s.uy[j])));
        }
        if reach < f64::INFINITY {
            let k = 1.0 - smooth(reach, 1.6 * reach, near);
            for bi in 0..b {
                s.w[i * b + bi] = (f64::from(s.w[i * b + bi]) * k) as f32;
            }
        }
        for bi in 0..b {
            s.sum[i] += s.w[i * b + bi];
        }
    }
    Some(s)
}

/// 建一层的网格与权重（LivLiv 的 `buildLayer`）。`brows`：表情画的眉毛（brow_tex）的贴图。
pub(crate) fn build(ctx: &Ctx, l: &LayerDef, img: &Texture, frames: &[&Texture], brows: Option<&Texture>, bangs: Option<&Bangs>) -> Mesh {
    let a: &Anchors = &ctx.model.anchors;
    let [mw, mh] = ctx.model.canvas;
    let cell = f64::from(crate::model::lattice_cell(mw, mh));
    let gx0 = (l.x / cell).floor() as i64;
    let gy0 = (l.y / cell).floor() as i64;
    let cols = (((l.x + l.w) / cell).ceil() as i64 - gx0).max(0) as usize;
    let rows = (((l.y + l.h) / cell).ceil() as i64 - gy0).max(0) as usize;
    let mut texs = vec![img];
    texs.extend_from_slice(frames);
    let occ = occupancy(&texs, l, gx0, gy0, cols, rows, cell);
    let mut vid = vec![u32::MAX; (cols + 1) * (rows + 1)];
    let (mut pos, mut uv, mut idx): (Vec<f32>, Vec<f32>, Vec<u32>) = (Vec::new(), Vec::new(), Vec::new());
    let mut vert = |c: usize, r: usize, pos: &mut Vec<f32>, uv: &mut Vec<f32>| -> u32 {
        let k = r * (cols + 1) + c;
        if vid[k] == u32::MAX {
            vid[k] = (pos.len() / 2) as u32;
            let x = (gx0 + c as i64) as f64 * cell;
            let y = (gy0 + r as i64) as f64 * cell;
            pos.extend([x as f32, y as f32]);
            // [0, 1] 之外采到的是贴图边缘之外透明的那一圈
            uv.extend([((x - l.x) / l.w) as f32, ((y - l.y) / l.h) as f32]);
        }
        vid[k]
    };
    for r in 0..rows {
        for c in 0..cols {
            if !occ[r * cols + c] {
                continue;
            }
            let p0 = vert(c, r, &mut pos, &mut uv);
            let p1 = vert(c + 1, r, &mut pos, &mut uv);
            let p3 = vert(c, r + 1, &mut pos, &mut uv);
            let p4 = vert(c + 1, r + 1, &mut pos, &mut uv);
            idx.extend([p0, p1, p3, p1, p4, p3]);
        }
    }
    let n = pos.len() / 2;
    let rest = pos;
    let mut w_head = vec![0f32; n];
    let mut w_phys1 = vec![0f32; n];
    let mut w_phys2 = vec![0f32; n];
    let mut dep = vec![0f32; n];
    let mut w_brow = vec![0f32; n];
    let mut brow_side = vec![-1i8; n];
    let mut w_front = vec![0f32; n];
    let mut brow_cap = vec![f32::INFINITY; n];
    let mut w_jaw = vec![0f32; n];
    let mut w_neck = (NECK_FOLLOW > 0.0 && l.group == Group::Body).then(|| vec![0f32; n]);
    let nt = ctx.rig.neck;
    let mut w_twist = nt.filter(|t| t.twist > 0.0 && l.group == Group::Body).map(|_| vec![0f32; n]);
    let role = l.role();
    let fol = match bangs {
        Some(b) if l.id == "brows" || role == "expr_brows" => Some(cover_at(img, l, b.tex, b.def, &rest, cell)),
        _ => None,
    };
    let fol_b = match (bangs, brows) {
        (Some(b), Some(t)) => Some(cover_at(t, l, b.tex, b.def, &rest, cell)),
        _ => None,
    };
    let mut alt = (fol.is_some() || fol_b.is_some()).then(|| vec![0f32; 5 * n]);
    let fw = a.face_width();
    let fh = a.face_height();
    let h = a.head;
    // 长发到下巴以下才开始甩：头这一高度的东西（帽子、鬓角）不动
    let hair_top = a.neck_y - 0.1 * h.ry;
    let hair_len = (a.bottom_y - hair_top).max(1.0);
    let hair_front = l.group == Group::HairSide || l.group == Group::HairFront;
    let mouth_copy = role == "mouth";
    for i in 0..n {
        let x = f64::from(rest[2 * i]);
        let y = f64::from(rest[2 * i + 1]);
        let rr = ((x - h.cx) / h.rx).hypot((y - h.cy) / h.ry);
        dep[i] = match l.group {
            Group::Head => l.depth,
            Group::HairFront => l.depth * smooth(l.fall_end.unwrap_or(1.0), l.fall.unwrap_or(0.55), rr),
            _ => {
                let start = if l.fall_end.is_none() { 0.7 } else { l.fall.unwrap_or(0.7) };
                l.depth * smooth(l.fall_end.unwrap_or(1.0), start, rr)
            }
        } as f32;
        let long_head = 1.0 - smooth(a.neck_y + 0.05 * h.ry, a.neck_y + 1.1 * h.ry, y);
        let tl = ((y - hair_top) / hair_len).clamp(0.0, 1.0);
        let lp1 = smooth(0.0, 0.55, tl);
        let lp2 = smooth(0.25, 1.0, tl).powf(1.3);
        // 所有头发层共用一个只由位置决定的权重场：接缝两边的两层跟头、跟弹簧的权重一样，转头侧倾都不会撕开
        let f = smooth(0.95, 0.7, rr) * (1.0 - smooth(a.neck_y - 0.2 * h.ry, a.neck_y + 0.3 * h.ry, y));
        let tb = smooth(a.hair_root_y + 0.25 * h.ry, h.cy + 0.7 * h.ry, y);
        match l.group {
            Group::Head => w_head[i] = 1.0,
            Group::Body => w_head[i] = 0.0,
            _ => {
                let (mut wh, mut p1, mut p2) = (f + (1.0 - f) * long_head, f * tb + (1.0 - f) * lp1, f * tb * tb + (1.0 - f) * lp2);
                if l.group == Group::HairInner {
                    wh *= 0.5;
                    p1 *= 0.35;
                    p2 *= 0.35;
                }
                w_head[i] = wh as f32;
                w_phys1[i] = p1 as f32;
                w_phys2[i] = p2 as f32;
                w_front[i] = f as f32;
            }
        }
        if let (Some(alt), Some(b)) = (alt.as_mut(), bangs) {
            // 刘海在这一点自己的权重：同一个格点按同样的方式动
            let k = 5 * i;
            alt[k] = (b.def.depth * smooth(1.0, b.def.fall.unwrap_or(0.55), rr)) as f32;
            alt[k + 1] = (f + (1.0 - f) * long_head) as f32;
            alt[k + 2] = (f * tb + (1.0 - f) * lp1) as f32;
            alt[k + 3] = (f * tb * tb + (1.0 - f) * lp2) as f32;
            alt[k + 4] = f as f32;
        }
        if let Some(j) = a
            .jaw
            .filter(|_| ctx.jaw_moves && (l.id == "face" || role == "expr" || hair_front || mouth_copy || role == "neck_shadow"))
        {
            // 张嘴时下半张脸跟下巴走；同一个位置函数用于每一层带着下半张脸的层
            let vy = smooth(j.top - 0.02 * h.ry, j.chin, y)
                * if hair_front {
                    1.0 - smooth(j.chin, j.chin + 0.15 * h.ry, y)
                } else {
                    1.0
                };
            let vx = 1.0 - smooth(0.22 * fw, 0.5 * fw, (x - h.cx).abs());
            w_jaw[i] = (vy * vx) as f32;
        }
        if let Some(j) = a.jaw.filter(|_| role == "neck_shadow") {
            let k = 1.0 - smooth(j.chin, j.chin + NECK_SHADOW * fh, y);
            w_head[i] = k as f32;
            w_jaw[i] = (f64::from(w_jaw[i]) * k) as f32;
        }
        if let Some(j) = a.jaw.filter(|_| l.group == Group::Body) {
            // 下巴正下方的脖子跟头和下巴走：下巴的影子画在身体上
            let wy = 1.0 - smooth(j.chin, j.chin + CHIN_NECK * fh, y);
            let wx = 1.0 - smooth(CHIN_NECK_X[0] * fw, CHIN_NECK_X[1] * fw, (x - h.cx).abs());
            let w = wy * wx;
            if w > 0.0 {
                w_head[i] = w as f32;
                if ctx.jaw_moves {
                    let vy = smooth(j.top - 0.02 * h.ry, j.chin, y);
                    w_jaw[i] = (vy * (1.0 - smooth(0.22 * fw, 0.5 * fw, (x - h.cx).abs())) * w) as f32;
                }
            }
        }
        if let Some(wn) = w_neck.as_mut() {
            // 脖子两侧的肩膀与领口跟头的侧倾转一点
            let v = NECK_FOLLOW
                * (1.0 - smooth(a.neck_y, a.neck_y + NECK_FOLLOW_Y * fh, y))
                * (1.0 - smooth(NECK_FOLLOW_X[0] * fw, NECK_FOLLOW_X[1] * fw, (x - h.cx).abs()))
                - f64::from(w_head[i]);
            wn[i] = v.max(0.0) as f32;
        }
        if let (Some(wt), Some(t)) = (w_twist.as_mut(), nt) {
            let cy = a.jaw.map_or(a.neck_y, |j| j.chin);
            let v = t.twist
                * (1.0 - smooth(cy, cy + t.reach.unwrap_or(0.45) * fh, y))
                * (1.0 - smooth(CHIN_NECK_X[0] * fw, CHIN_NECK_X[1] * fw, (x - h.cx).abs()))
                - f64::from(w_head[i]);
            wt[i] = v.max(0.0) as f32;
        }
        if let Some(brows) = &a.brows
            && l.group == Group::Head
            && !role.starts_with("iris_")
            && (!ctx.brow_layer || l.id == "brows")
        {
            // 所有头部层共用一个眉毛场；眉毛单独成层时只动它
            for (side, b) in brows.iter().enumerate() {
                let line = a.brow_lines.as_ref().and_then(|v| v.get(side)).and_then(|v| v.as_ref());
                let (Some(b), Some(line)) = (b, line) else { continue };
                let w = brow_weight(b, line, x, y);
                if w > f64::from(w_brow[i]) {
                    w_brow[i] = w as f32;
                    brow_side[i] = side as i8;
                    brow_cap[i] = line.cap.as_ref().map_or(f32::INFINITY, |c| interp(&line.x, c, x) as f32);
                }
            }
        }
    }
    // 有链的层：链代替头发弹簧（只弯一部分的链除外）
    let bones = l.bones.as_deref().unwrap_or(&[]);
    let skin = if bones.is_empty() {
        None
    } else {
        skin_of(bones, &rest, ctx.chains)
    };
    if skin.is_some()
        && !bones
            .iter()
            .all(|id| ctx.chains.iter().find(|c| &c.def.id == id).is_some_and(|c| c.def.reach.is_some()))
    {
        w_phys1.fill(0.0);
        w_phys2.fill(0.0);
    }
    if l.rigid.is_some() {
        w_phys1.fill(0.0);
        w_phys2.fill(0.0);
    }
    let alt_skin = match (alt.as_ref(), bangs) {
        (Some(_), Some(b)) => b
            .def
            .bones
            .as_deref()
            .filter(|v| !v.is_empty())
            .and_then(|ids| skin_of(ids, &rest, ctx.chains)),
        _ => None,
    };
    if let (Some(alt), Some(_)) = (alt.as_mut(), alt_skin.as_ref()) {
        for i in 0..n {
            alt[5 * i + 2] = 0.0;
            alt[5 * i + 3] = 0.0;
        }
    }
    let aa = crate::raster::boundary_edges(&idx);
    Mesh {
        rest,
        uv,
        tri: idx,
        aa,
        w_head,
        w_phys1,
        w_phys2,
        dep,
        w_front,
        w_brow,
        brow_side,
        brow_cap,
        w_jaw,
        w_neck,
        w_twist,
        fol,
        fol_b,
        alt,
        piv_y: None,
        piv_c: None,
        skin,
        alt_skin,
    }
}
