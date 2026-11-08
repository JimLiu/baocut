//! CPU 三角形光栅：代替 LivLiv 的 WebGL2 着色器，规则与 GL 相同——顶点吸附到 1/256 像素、像素中心在 (i + 0.5,
//! j + 0.5)、共享边按左上规则只算一次；贴图坐标线性插值，按三角形求 LOD 做三线性 mipmap（CLAMP_TO_EDGE）；
//! 预乘混合 dst = src·α + dst·(1 − src.a·α)，每次混合后舍入到 8 位。

use crate::package::{Level, Texture};

/// 画布：预乘 RGBA8，逐行，w × h。
pub(crate) struct Frame<'a> {
    pub w: usize,
    pub h: usize,
    pub px: &'a mut [u8],
}

/// 模型像素到画布像素：X = x · s + ox，Y = y · s + oy（y 向下）。
#[derive(Clone, Copy, Debug)]
pub(crate) struct View {
    pub s: f64,
    pub ox: f64,
    pub oy: f64,
}

/// 一只眼睛的眼白这一帧在画布上的覆盖（alpha，0–255），盖住它的框之外是 0。
pub(crate) struct Coverage {
    x0: i64,
    y0: i64,
    w: usize,
    h: usize,
    data: Vec<u8>,
}

impl Coverage {
    #[inline]
    fn at(&self, x: i64, y: i64) -> u8 {
        let (u, v) = (x - self.x0, y - self.y0);
        if u < 0 || v < 0 || u >= self.w as i64 || v >= self.h as i64 {
            return 0;
        }
        self.data[v as usize * self.w + u as usize]
    }
}

/// 三角形的 mip 级与两级之间的比例。
#[derive(Clone, Copy, Debug)]
struct Lod {
    l0: usize,
    l1: usize,
    f: f32,
}

/// 设好的三角形：吸附后的顶点（1/256 像素）、包围盒（像素）、u / v 的平面方程与 LOD。
#[derive(Clone, Copy, Debug)]
struct Tri {
    x: [i64; 3],
    y: [i64; 3],
    bias: [i64; 3],
    bx0: i64,
    bx1: i64,
    by0: i64,
    by1: i64,
    /// u = au·X + bu·Y + cu（X、Y 是画布像素）。
    u: [f64; 3],
    v: [f64; 3],
    lod: Lod,
    /// 哪几条边是网格的外边（第 k 位是 k→k+1 那条）：外边按 4 个采样点算覆盖（同 GL 的 4× MSAA），
    /// 共享的内边只看像素中心，相邻两个三角形不留缝也不重叠。
    aa: u8,
}

const SUB: f64 = 256.0;
const HALF: i64 = 128;
/// 4× MSAA 的采样点（相对像素中心，1/256 像素；Metal / D3D 的标准位置）。
const SAMPLES: [(i64, i64); 4] = [(-32, -96), (96, -32), (-96, 32), (32, 96)];

/// 每个三角形哪几条边只属于它自己（网格的外边）：第 k 位是 (t[k], t[k+1]) 那条。
pub(crate) fn boundary_edges(tri: &[u32]) -> Vec<u8> {
    let key = |a: u32, b: u32| if a < b { (a, b) } else { (b, a) };
    let mut count = std::collections::HashMap::<(u32, u32), u32>::with_capacity(tri.len());
    for t in tri.chunks_exact(3) {
        for k in 0..3 {
            *count.entry(key(t[k], t[(k + 1) % 3])).or_default() += 1;
        }
    }
    tri.chunks_exact(3)
        .map(|t| (0..3).fold(0u8, |m, k| if count[&key(t[k], t[(k + 1) % 3])] == 1 { m | 1 << k } else { m }))
        .collect()
}

fn lod_of(tex: &Texture, du: [f64; 2], dv: [f64; 2]) -> Lod {
    let (tw, th) = (f64::from(tex.width()), f64::from(tex.height()));
    let rx = (du[0] * tw).hypot(dv[0] * th);
    let ry = (du[1] * tw).hypot(dv[1] * th);
    let lambda = rx.max(ry).log2();
    let max = tex.levels.len() - 1;
    if !lambda.is_finite() || lambda <= 0.0 {
        return Lod { l0: 0, l1: 0, f: 0.0 };
    }
    let d = lambda.floor();
    if d as usize >= max {
        return Lod { l0: max, l1: max, f: 0.0 };
    }
    Lod {
        l0: d as usize,
        l1: d as usize + 1,
        f: (lambda - d) as f32,
    }
}

/// 设好一个三角形；面积为 0 或完全在画布外时没有。
#[allow(clippy::too_many_arguments)]
fn setup(view: View, verts: &[f32], uv: &[f32], abc: [usize; 3], aa: u8, tex: &Texture, w: usize, h: usize) -> Option<Tri> {
    let snap = |i: usize| -> (i64, i64) {
        let x = f64::from(verts[2 * i]) * view.s + view.ox;
        let y = f64::from(verts[2 * i + 1]) * view.s + view.oy;
        ((x * SUB).round() as i64, (y * SUB).round() as i64)
    };
    let mut idx = abc;
    let mut p = abc.map(snap);
    let mut aa = aa;
    let area = (p[1].0 - p[0].0) * (p[2].1 - p[0].1) - (p[1].1 - p[0].1) * (p[2].0 - p[0].0);
    if area == 0 {
        return None;
    }
    if area < 0 {
        p.swap(1, 2);
        idx.swap(1, 2);
        // a→c、c→b、b→a：新的第 0 条是原来的第 2 条，第 2 条是原来的第 0 条
        aa = (aa & 0b010) | ((aa >> 2) & 1) | ((aa & 1) << 2);
    }
    let x = [p[0].0, p[1].0, p[2].0];
    let y = [p[0].1, p[1].1, p[2].1];
    let minx = *x.iter().min().unwrap();
    let maxx = *x.iter().max().unwrap();
    let miny = *y.iter().min().unwrap();
    let maxy = *y.iter().max().unwrap();
    // 有外边时采样点比像素中心最多再出去 3/8 像素：包围盒各放宽一格
    let grow = i64::from(aa != 0);
    let bx0 = ((minx - HALF + 255).div_euclid(256) - grow).max(0);
    let bx1 = ((maxx - HALF).div_euclid(256) + grow).min(w as i64 - 1);
    let by0 = ((miny - HALF + 255).div_euclid(256) - grow).max(0);
    let by1 = ((maxy - HALF).div_euclid(256) + grow).min(h as i64 - 1);
    if bx0 > bx1 || by0 > by1 {
        return None;
    }
    // 左上规则：y 向下、正面积的环绕下，dy < 0 是左边，dy == 0 且 dx > 0 是上边
    let mut bias = [0i64; 3];
    for k in 0..3 {
        let (dx, dy) = (x[(k + 1) % 3] - x[k], y[(k + 1) % 3] - y[k]);
        bias[k] = i64::from(dy < 0 || (dy == 0 && dx > 0));
    }
    let fx = x.map(|v| v as f64 / SUB);
    let fy = y.map(|v| v as f64 / SUB);
    let det = (fx[1] - fx[0]) * (fy[2] - fy[0]) - (fx[2] - fx[0]) * (fy[1] - fy[0]);
    let plane = |q: [f64; 3]| -> [f64; 3] {
        let a = ((q[1] - q[0]) * (fy[2] - fy[0]) - (q[2] - q[0]) * (fy[1] - fy[0])) / det;
        let b = ((q[2] - q[0]) * (fx[1] - fx[0]) - (q[1] - q[0]) * (fx[2] - fx[0])) / det;
        [a, b, q[0] - a * fx[0] - b * fy[0]]
    };
    let u = plane(idx.map(|i| f64::from(uv[2 * i])));
    let v = plane(idx.map(|i| f64::from(uv[2 * i + 1])));
    let lod = lod_of(tex, [u[0], u[1]], [v[0], v[1]]);
    Some(Tri {
        x,
        y,
        bias,
        bx0,
        bx1,
        by0,
        by1,
        u,
        v,
        lod,
        aa,
    })
}

#[inline]
fn texel(l: &Level, x: i64, y: i64) -> [f32; 4] {
    let x = x.clamp(0, i64::from(l.w) - 1) as usize;
    let y = y.clamp(0, i64::from(l.h) - 1) as usize;
    let k = 4 * (y * l.w as usize + x);
    [
        f32::from(l.px[k]),
        f32::from(l.px[k + 1]),
        f32::from(l.px[k + 2]),
        f32::from(l.px[k + 3]),
    ]
}

/// 一级 mip 上 (u, v) 处的双线性采样（0–255 的预乘值）。
#[inline]
fn bilinear(l: &Level, u: f64, v: f64) -> [f32; 4] {
    let x = u * f64::from(l.w) - 0.5;
    let y = v * f64::from(l.h) - 0.5;
    let (x0, y0) = (x.floor(), y.floor());
    let (ax, ay) = ((x - x0) as f32, (y - y0) as f32);
    let (i, j) = (x0 as i64, y0 as i64);
    let t00 = texel(l, i, j);
    let t10 = texel(l, i + 1, j);
    let t01 = texel(l, i, j + 1);
    let t11 = texel(l, i + 1, j + 1);
    let mut o = [0f32; 4];
    for c in 0..4 {
        let top = t00[c] + (t10[c] - t00[c]) * ax;
        let bot = t01[c] + (t11[c] - t01[c]) * ax;
        o[c] = top + (bot - top) * ay;
    }
    o
}

#[inline]
fn sample(tex: &Texture, lod: Lod, u: f64, v: f64) -> [f32; 4] {
    let a = bilinear(&tex.levels[lod.l0], u, v);
    if lod.l1 == lod.l0 || lod.f == 0.0 {
        return a;
    }
    let b = bilinear(&tex.levels[lod.l1], u, v);
    let f = lod.f;
    [
        a[0] + (b[0] - a[0]) * f,
        a[1] + (b[1] - a[1]) * f,
        a[2] + (b[2] - a[2]) * f,
        a[3] + (b[3] - a[3]) * f,
    ]
}

/// 三角形与 [y0, y1) 行相交的部分，每个盖到的像素调一次 `f(x, y, u, v, n)`：n 是 4 个采样点里盖到几个
/// （没有外边的三角形总是 4）。u、v 取在像素中心（中心在三角形外时外推，与 GL 的多重采样相同）。
#[inline]
fn scan(t: &Tri, y0: i64, y1: i64, mut f: impl FnMut(i64, i64, f64, f64, u32)) {
    let ry0 = t.by0.max(y0);
    let ry1 = t.by1.min(y1 - 1);
    if ry0 > ry1 {
        return;
    }
    let (x, y) = (&t.x, &t.y);
    // E_k(p) = dx·(py − ay) − dy·(px − ax)；px 加一个像素 E 减 dy·256，py 加一个像素 E 加 dx·256
    let edges: [(i64, i64, i64, i64); 3] = std::array::from_fn(|k| {
        let (ax, ay) = (x[k], y[k]);
        let (dx, dy) = (x[(k + 1) % 3] - ax, y[(k + 1) % 3] - ay);
        (ax, ay, dx, dy)
    });
    // 每条外边在每个采样点相对像素中心的增量
    let off: [[i64; 4]; 3] = std::array::from_fn(|k| {
        let (_, _, dx, dy) = edges[k];
        SAMPLES.map(|(ox, oy)| dx * oy - dy * ox)
    });
    let px0 = t.bx0 * 256 + HALF;
    for row in ry0..=ry1 {
        let py = row * 256 + HALF;
        let mut e: [i64; 3] = std::array::from_fn(|k| {
            let (ax, ay, dx, dy) = edges[k];
            dx * (py - ay) - dy * (px0 - ax) + t.bias[k]
        });
        let step: [i64; 3] = std::array::from_fn(|k| -edges[k].3 * 256);
        let fy = row as f64 + 0.5;
        for col in t.bx0..=t.bx1 {
            let n = if t.aa == 0 {
                if e[0] > 0 && e[1] > 0 && e[2] > 0 { 4 } else { 0 }
            } else {
                let inner = (0..3).all(|k| t.aa & (1 << k) != 0 || e[k] > 0);
                if inner {
                    (0..4)
                        .filter(|&s| (0..3).all(|k| t.aa & (1 << k) == 0 || e[k] + off[k][s] > 0))
                        .count() as u32
                } else {
                    0
                }
            };
            if n > 0 {
                let fx = col as f64 + 0.5;
                let u = t.u[0] * fx + t.u[1] * fy + t.u[2];
                let v = t.v[0] * fx + t.v[1] * fy + t.v[2];
                f(col, row, u, v, n);
            }
            e[0] += step[0];
            e[1] += step[1];
            e[2] += step[2];
        }
    }
}

/// 设好一层的三角形，按行带分桶（桶里保持三角形原来的顺序：同一层折叠的地方也按原序混合）。
struct Binned {
    tris: Vec<Tri>,
    start: Vec<usize>,
    list: Vec<u32>,
}

const BAND: usize = 16;

#[allow(clippy::too_many_arguments)]
fn bin(view: View, verts: &[f32], uv: &[f32], tri: &[u32], aa: &[u8], tex: &Texture, w: usize, h: usize) -> Binned {
    let tris: Vec<Tri> = tri
        .chunks_exact(3)
        .enumerate()
        .filter_map(|(i, t)| {
            setup(
                view,
                verts,
                uv,
                [t[0] as usize, t[1] as usize, t[2] as usize],
                aa.get(i).copied().unwrap_or(0),
                tex,
                w,
                h,
            )
        })
        .collect();
    let bands = h.div_ceil(BAND);
    let mut count = vec![0usize; bands + 1];
    for t in &tris {
        for b in (t.by0 as usize / BAND)..=(t.by1 as usize / BAND) {
            count[b + 1] += 1;
        }
    }
    for b in 0..bands {
        count[b + 1] += count[b];
    }
    let mut fill = count.clone();
    let mut list = vec![0u32; count[bands]];
    for (i, t) in tris.iter().enumerate() {
        for b in (t.by0 as usize / BAND)..=(t.by1 as usize / BAND) {
            list[fill[b]] = i as u32;
            fill[b] += 1;
        }
    }
    Binned { tris, start: count, list }
}

/// 逐像素着色：给像素中心的贴图坐标 (u, v) 和一个在任意贴图坐标上按这个三角形的 mip 级采样的函数，返回这一点
/// 的预乘颜色（0–255）。mesh-avatar 角色的脸（画出来的嘴、腮红）、眼珠（被眼睑裁）与半闭的眼睛用它代替直接采样。
pub(crate) type Shade<'a> = &'a (dyn Fn(f64, f64, &dyn Fn(f64, f64) -> [f32; 4]) -> [f32; 4] + Sync);

/// 一次绘制：贴图、不透明度，眼珠的眼白遮罩（遮罩与它的 soft：0 时按 alpha 0.5 一刀切，1 时乘 alpha），以及可选的
/// 逐像素着色。
pub(crate) struct Paint<'a> {
    pub tex: &'a Texture,
    pub alpha: f32,
    pub mask: Option<(&'a Coverage, f32)>,
    pub shade: Option<Shade<'a>>,
}

fn for_bands(frame: &mut Frame, f: impl Fn(usize, &mut [u8]) + Sync + Send) {
    let row = frame.w * 4;
    #[cfg(feature = "parallel")]
    {
        use rayon::prelude::*;
        frame.px.par_chunks_mut(row * BAND).enumerate().for_each(|(b, chunk)| f(b, chunk));
    }
    #[cfg(not(feature = "parallel"))]
    {
        for (b, chunk) in frame.px.chunks_mut(row * BAND).enumerate() {
            f(b, chunk);
        }
    }
}

/// 把一层（或它的一帧、一张遮罩以外的贴图）画进画布。
///
/// `aa`：每个三角形的外边（[`boundary_edges`]）；空表示全按像素中心。
#[allow(clippy::too_many_arguments)]
pub(crate) fn draw(frame: &mut Frame, view: View, verts: &[f32], uv: &[f32], tri: &[u32], aa: &[u8], paint: &Paint) {
    blend(frame, view, verts, uv, tri, aa, paint, false);
}

/// 同 [`draw`]，但盖到的地方按覆盖换成这一层而不是叠上去：dst = src·k + dst·(1 − k)，k 是不透明度、边上的覆盖
/// 与遮罩的乘积。表情自己的眼睛用它把合拢的遮罩里换成不往下合的眼白与眼珠。
#[allow(clippy::too_many_arguments)]
pub(crate) fn draw_replace(frame: &mut Frame, view: View, verts: &[f32], uv: &[f32], tri: &[u32], aa: &[u8], paint: &Paint) {
    blend(frame, view, verts, uv, tri, aa, paint, true);
}

#[allow(clippy::too_many_arguments)]
fn blend(frame: &mut Frame, view: View, verts: &[f32], uv: &[f32], tri: &[u32], aa: &[u8], paint: &Paint, replace: bool) {
    if paint.alpha <= 0.0 || frame.w == 0 || frame.h == 0 {
        return;
    }
    let (w, h) = (frame.w, frame.h);
    let bins = bin(view, verts, uv, tri, aa, paint.tex, w, h);
    if bins.tris.is_empty() {
        return;
    }
    let alpha = paint.alpha;
    for_bands(frame, |b, chunk| {
        let y0 = (b * BAND) as i64;
        let y1 = (y0 + BAND as i64).min(h as i64);
        for &ti in &bins.list[bins.start[b]..bins.start[b + 1]] {
            let t = &bins.tris[ti as usize];
            scan(t, y0, y1, |x, y, u, v, n| {
                let mut c = match paint.shade {
                    Some(shade) => shade(u, v, &|su, sv| sample(paint.tex, t.lod, su, sv)),
                    None => sample(paint.tex, t.lod, u, v),
                };
                let mut k = if n == 4 { alpha } else { alpha * n as f32 / 4.0 };
                if let Some((cov, soft)) = paint.mask {
                    let m = f32::from(cov.at(x, y)) / 255.0;
                    let step = if m >= 0.5 { 1.0 } else { 0.0 };
                    k *= step + (m - step) * soft;
                }
                if k <= 0.0 {
                    return;
                }
                for ch in &mut c {
                    *ch *= k;
                }
                if !replace && c[3] <= 0.0 && c[0] <= 0.0 && c[1] <= 0.0 && c[2] <= 0.0 {
                    return;
                }
                let inv = if replace { 1.0 - k } else { 1.0 - c[3] / 255.0 };
                let o = 4 * ((y - y0) as usize * w + x as usize);
                let d = &mut chunk[o..o + 4];
                for i in 0..4 {
                    d[i] = (c[i] + f32::from(d[i]) * inv).round().clamp(0.0, 255.0) as u8;
                }
            });
        }
    });
}

/// 把另画好的一组（同样大小的预乘 RGBA8）按不透明度 `alpha` 叠到画布上：一组几层合起来淡入淡出，叠在一起的
/// 部分不会各自透出下面。
pub(crate) fn composite(frame: &mut Frame, src: &[u8], alpha: f32) {
    let (w, h) = (frame.w, frame.h);
    composite_at(frame, src, 0, 0, w, h, alpha);
}

/// 眼白这一帧的覆盖：画它的遮罩贴图，覆盖到的像素直接写 alpha（不混合，与 GL 的遮罩通道相同）。
pub(crate) fn coverage(w: usize, h: usize, view: View, verts: &[f32], uv: &[f32], tri: &[u32], mask: &Texture) -> Coverage {
    let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in verts.chunks_exact(2) {
        let x = f64::from(p[0]) * view.s + view.ox;
        let y = f64::from(p[1]) * view.s + view.oy;
        x0 = x0.min(x);
        x1 = x1.max(x);
        y0 = y0.min(y);
        y1 = y1.max(y);
    }
    let empty = Coverage {
        x0: 0,
        y0: 0,
        w: 0,
        h: 0,
        data: Vec::new(),
    };
    if !x0.is_finite() || !y0.is_finite() {
        return empty;
    }
    let cx0 = (x0.floor() as i64 - 2).max(0);
    let cy0 = (y0.floor() as i64 - 2).max(0);
    let cx1 = (x1.ceil() as i64 + 2).min(w as i64);
    let cy1 = (y1.ceil() as i64 + 2).min(h as i64);
    if cx1 <= cx0 || cy1 <= cy0 {
        return empty;
    }
    let (cw, ch) = ((cx1 - cx0) as usize, (cy1 - cy0) as usize);
    let mut cov = Coverage {
        x0: cx0,
        y0: cy0,
        w: cw,
        h: ch,
        data: vec![0; cw * ch],
    };
    for t in tri.chunks_exact(3) {
        let Some(t) = setup(view, verts, uv, [t[0] as usize, t[1] as usize, t[2] as usize], 0, mask, w, h) else {
            continue;
        };
        scan(&t, cy0, cy1, |x, y, u, v, _| {
            if x < cx0 || x >= cx1 {
                return;
            }
            let a = sample(mask, t.lod, u, v)[3];
            cov.data[(y - cy0) as usize * cw + (x - cx0) as usize] = a.round().clamp(0.0, 255.0) as u8;
        });
    }
    cov
}

/// 同 [`composite`]，但叠的是另画好的一小块（`w`×`h` 的预乘 RGBA8，左上角在画布的 (`x0`, `y0`)）；伸出画布的部分
/// 不画。
pub(crate) fn composite_at(frame: &mut Frame, src: &[u8], x0: usize, y0: usize, w: usize, h: usize, alpha: f32) {
    if alpha <= 0.0 || x0 >= frame.w || y0 >= frame.h {
        return;
    }
    let cw = w.min(frame.w - x0);
    for y in 0..h.min(frame.h - y0) {
        let row = &src[4 * y * w..4 * (y * w + cw)];
        let o = 4 * ((y0 + y) * frame.w + x0);
        for (d, s) in frame.px[o..o + 4 * cw].chunks_exact_mut(4).zip(row.chunks_exact(4)) {
            if s[3] == 0 && s[0] == 0 && s[1] == 0 && s[2] == 0 {
                continue;
            }
            let inv = 1.0 - f32::from(s[3]) * alpha / 255.0;
            for i in 0..4 {
                d[i] = (f32::from(s[i]) * alpha + f32::from(d[i]) * inv).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(w: u32, h: u32, rgba: [u8; 4]) -> Texture {
        Texture::from_rgba(w, h, rgba.iter().copied().cycle().take((w * h * 4) as usize).collect())
    }

    /// 两个三角形拼成的方块：共享的对角线上每个像素只画一次（半透明的颜色不会叠两层）。
    #[test]
    fn shared_edges_cover_each_pixel_once() {
        let tex = solid(4, 4, [255, 0, 0, 128]);
        let verts = [1.3f32, 1.1, 9.7, 1.1, 1.3, 8.9, 9.7, 8.9];
        let uv = [0f32, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let tri = [0u32, 1, 2, 1, 3, 2];
        let mut px = vec![0u8; 12 * 12 * 4];
        let mut f = Frame { w: 12, h: 12, px: &mut px };
        draw(
            &mut f,
            View { s: 1.0, ox: 0.0, oy: 0.0 },
            &verts,
            &uv,
            &tri,
            &[],
            &Paint {
                tex: &tex,
                alpha: 1.0,
                mask: None,
                shade: None,
            },
        );
        let mut alphas = std::collections::BTreeSet::new();
        for p in px.chunks_exact(4) {
            alphas.insert(p[3]);
        }
        assert_eq!(alphas.into_iter().collect::<Vec<_>>(), vec![0, 128]);
        // 像素中心 x 1.5..9.5、y 1.5..8.5 在方块里：9 列 × 8 行
        assert_eq!(px.chunks_exact(4).filter(|p| p[3] == 128).count(), 9 * 8);
    }

    #[test]
    fn premultiplied_over() {
        let tex = solid(2, 2, [255, 255, 255, 255]);
        let verts = [0f32, 0.0, 4.0, 0.0, 0.0, 4.0, 4.0, 4.0];
        let uv = [0f32, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let tri = [0u32, 1, 2, 1, 3, 2];
        let mut px = vec![0u8; 4 * 4 * 4];
        for p in px.chunks_exact_mut(4) {
            p.copy_from_slice(&[0, 0, 200, 200]);
        }
        let mut f = Frame { w: 4, h: 4, px: &mut px };
        draw(
            &mut f,
            View { s: 1.0, ox: 0.0, oy: 0.0 },
            &verts,
            &uv,
            &tri,
            &[],
            &Paint {
                tex: &tex,
                alpha: 0.5,
                mask: None,
                shade: None,
            },
        );
        // 0.5 白在预乘 (0, 0, 200, 200) 上：rgb = 127.5 + c·0.5，a = 127.5 + 200·0.5
        assert_eq!(&px[0..4], &[128, 128, 228, 228]);
    }

    /// 外边按 4 个采样点算覆盖：左边在 x = 2.5 的不透明方块，第 2 列盖到一半；共享的对角线照样只画一次。
    #[test]
    fn outer_edges_are_antialiased() {
        let tex = solid(4, 4, [255, 255, 255, 255]);
        let verts = [2.5f32, 1.0, 7.0, 1.0, 2.5, 7.0, 7.0, 7.0];
        let uv = [0f32, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let tri = [0u32, 1, 2, 1, 3, 2];
        let aa = boundary_edges(&tri);
        assert_eq!(aa, vec![0b101, 0b011]);
        let mut px = vec![0u8; 10 * 10 * 4];
        let mut f = Frame { w: 10, h: 10, px: &mut px };
        draw(
            &mut f,
            View { s: 1.0, ox: 0.0, oy: 0.0 },
            &verts,
            &uv,
            &tri,
            &aa,
            &Paint {
                tex: &tex,
                alpha: 1.0,
                mask: None,
                shade: None,
            },
        );
        let a = |x: usize, y: usize| px[4 * (y * 10 + x) + 3];
        assert_eq!((a(1, 3), a(2, 3), a(3, 3), a(6, 3), a(7, 3)), (0, 128, 255, 255, 0));
        assert_eq!((a(4, 0), a(4, 1), a(4, 6), a(4, 7)), (0, 255, 255, 0));
        assert!(px.chunks_exact(4).all(|p| p[3] == 0 || p[3] == 64 || p[3] == 128 || p[3] == 255));
    }

    /// 换上去的一层在遮罩里盖掉底下的颜色（不叠），遮罩外不动，透明的贴图也照样换；小块按位置与不透明度叠回画布。
    #[test]
    fn replace_swaps_inside_the_mask() {
        let verts = [0f32, 0.0, 4.0, 0.0, 0.0, 4.0, 4.0, 4.0];
        let uv = [0f32, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let tri = [0u32, 1, 2, 1, 3, 2];
        let view = View { s: 1.0, ox: 0.0, oy: 0.0 };
        // 遮罩只盖左半边
        let mut m = vec![0u8; 4 * 4 * 4];
        for (i, p) in m.chunks_exact_mut(4).enumerate() {
            if i % 4 < 2 {
                p.copy_from_slice(&[255, 255, 255, 255]);
            }
        }
        let mask = Texture::from_rgba(4, 4, m);
        let cov = coverage(4, 4, view, &verts, &uv, &tri, &mask);
        let mut px = vec![0u8; 4 * 4 * 4];
        for p in px.chunks_exact_mut(4) {
            p.copy_from_slice(&[0, 0, 200, 200]);
        }
        let mut f = Frame { w: 4, h: 4, px: &mut px };
        let clear = solid(2, 2, [0, 0, 0, 0]);
        let paint = Paint {
            tex: &clear,
            alpha: 1.0,
            mask: Some((&cov, 1.0)),
            shade: None,
        };
        draw_replace(&mut f, view, &verts, &uv, &tri, &[], &paint);
        assert_eq!(&px[0..4], &[0, 0, 0, 0]);
        assert_eq!(&px[12..16], &[0, 0, 200, 200]);
        // 伸出画布的部分不画
        let mut big = vec![0u8; 6 * 3 * 4];
        let mut f = Frame { w: 6, h: 3, px: &mut big };
        composite_at(&mut f, &[0, 0, 200, 200].repeat(16), 4, 1, 4, 4, 0.5);
        let a = |x: usize, y: usize| big[4 * (y * 6 + x) + 3];
        assert_eq!((a(3, 1), a(4, 0), a(4, 1), a(5, 2)), (0, 0, 100, 100));
    }
}
