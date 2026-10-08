//! 油画笔触（规范 §6.9 `brush.kind: "paint"` 与 §6.2.1 `texture.finish: "paint"`）。
//!
//! 一笔 = 中心折线 + 线宽 W。沿弧长重采样，按「起笔略窄 → 满宽 → 收笔渐细」的
//! 宽度曲线展开成若干条**鬃毛带**；每条带有自己的明暗与含色（第二种颜料），沿
//! 笔方向按噪声断开（干笔：越到笔尾越断，边上的带先断），首尾按圆笔头缩进。
//! 输出按 `(含色档, 明暗档)` 分桶的多边形——每桶一次 `FillPath`，不论一条
//! path 里有多少笔，指令数至多 `3 × 5` 个。
//!
//! 与 `texture` 同一套纪律：**没有时间参数**，几何只由（折线、线宽、笔刷参数、
//! 可见区间、算法版本）决定；颜色不进生成函数（[`tone_color`] 在录制期上色）。
//! 描进度（`pathDraw` / `pathStart` / `pathEnd`）只改可见区间：宽度曲线始终按
//! 整笔算，所以画到一半的笔没有提前收尖，前沿是一排圆头鬃毛。

use crate::drawop::{PathData, path_from_skia};
use motion::rng::splitmix64_unit;
use scene_primitives::color::Rgba;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use tiny_skia::PathBuilder;

/// 改采样、带数、噪声或分档规则必须升版；它参与缓存键。
pub const PAINT_ALGORITHM_VERSION: u32 = 1;

/// 明暗档：`-TONE_STEPS..=TONE_STEPS`。
pub const TONE_STEPS: i8 = 2;
/// 含色档 0 / 1 / 2 与第二种颜料的混合比例。
const LOAD_MIX: [f64; 3] = [0.0, 0.45, 0.85];
/// 最亮 / 最暗一档相对底色提亮或压暗的比例。
const TONE_SPAN: f64 = 0.2;

const STREAM_WIDTH: u64 = 0x7061_696E_7400_0001;
const STREAM_STREAK: u64 = 0x7061_696E_7400_0002;
const STREAM_RAG: u64 = 0x7061_696E_7400_0003;
const STREAM_WAVE: u64 = 0x7061_696E_7400_0004;
const STREAM_EDGE: u64 = 0x7061_696E_7400_0005;
const STREAM_FILL: u64 = 0x7061_696E_7400_0006;

/// 单条折线的重采样点数上限。
const SAMPLES_MAX: f64 = 800.0;
/// `texture.finish: "paint"` 一条路径至多铺多少笔：超过就按比例放大行距与笔长。
const FILL_STROKES_MAX: f64 = 4000.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PaintParams {
    pub seed: u64,
    /// 0..10，1 = 缺省观感：宽度起伏、鬃毛明暗与毛边都按它缩放，0 = 平涂色带。
    pub rough: f64,
    /// 0..1：干笔程度。0 = 整笔饱满，1 = 笔尾大片露底。
    pub dry: f64,
    /// 有没有第二种颜料。没有时含色档恒为 0，省下两倍的指令。
    pub load: bool,
}

/// 一份笔触几何：`(含色档, 明暗档, 多边形)`，按 `(含色档, 明暗档)` 升序。
#[derive(Debug, Default, PartialEq)]
pub struct PaintGeom {
    pub buckets: Vec<(u8, i8, PathData)>,
}

impl PaintGeom {
    pub fn is_empty(&self) -> bool {
        self.buckets.is_empty()
    }
}

/// 按档上色：先按含色档混入第二种颜料，再按明暗档提亮 / 压暗。alpha 取底色的。
pub fn tone_color(base: &Rgba, load: Option<&Rgba>, load_level: u8, tone: i8) -> Rgba {
    let mut c = *base;
    if let Some(l) = load {
        let m = LOAD_MIX[(load_level as usize).min(2)];
        c.r += (l.r - c.r) * m;
        c.g += (l.g - c.g) * m;
        c.b += (l.b - c.b) * m;
    }
    let f = tone as f64 / TONE_STEPS as f64 * TONE_SPAN;
    let shift = |v: f64| {
        if f >= 0.0 {
            v + (255.0 - v) * f
        } else {
            v * (1.0 + f)
        }
    };
    c.r = shift(c.r);
    c.g = shift(c.g);
    c.b = shift(c.b);
    c
}

/// 描边：`subpaths` 每条是一笔，`vis` 是按**全部子路径首尾相接**的弧长比例区间。
pub fn brush(
    subpaths: &[Vec<(f64, f64)>],
    width: f64,
    params: &PaintParams,
    vis: (f64, f64),
) -> PaintGeom {
    let mut out = Buckets::default();
    let lens: Vec<f64> = subpaths.iter().map(|p| poly_len(p)).collect();
    let total: f64 = lens.iter().sum();
    let (a, b) = (vis.0.clamp(0.0, 1.0) * total, vis.1.clamp(0.0, 1.0) * total);
    let mut offset = 0.0;
    for (index, (poly, len)) in subpaths.iter().zip(&lens).enumerate() {
        let (lo, hi) = ((a - offset).max(0.0), (b - offset).min(*len));
        // 零长的一笔（一个点）：可见区间扫到它所在的弧长位置就画；整条路径都是点时按比例区间判
        let dot_visible = if total > 0.0 {
            b > a && a <= offset && b >= offset
        } else {
            vis.1.clamp(0.0, 1.0) > vis.0.clamp(0.0, 1.0)
        };
        offset += len;
        if poly.is_empty() || (*len > 0.0 && hi <= lo) || (*len <= 0.0 && !dot_visible) {
            continue;
        }
        stroke(poly, width, params, index as u64, (lo, hi), &mut out);
    }
    out.finish()
}

/// 一组整笔（折线, 线宽），全部可见。`texture.finish: "paint"` 用。
pub fn strokes(list: &[(Vec<(f64, f64)>, f64)], params: &PaintParams) -> PaintGeom {
    let mut out = Buckets::default();
    for (index, (poly, width)) in list.iter().enumerate() {
        let len = poly_len(poly);
        stroke(poly, *width, params, index as u64, (0.0, len), &mut out);
    }
    out.finish()
}

/// `texture.finish: "paint"`：沿 `angle` 一行行铺笔，行距 `gap`、笔长 `len`、
/// 笔宽 `width`、端点抖动 `jitter`，`density` 决定每笔去留。调用方裁剪进路径。
pub fn fill_layout(
    bbox: (f64, f64, f64, f64),
    tx: &scene_primitives::pathstyle::PathTexture,
    scale: f64,
) -> Vec<(Vec<(f64, f64)>, f64)> {
    let (x0, y0, x1, y1) = bbox;
    let (bw, bh) = (x1 - x0, y1 - y0);
    let mut out = Vec::new();
    if !(bw > 0.0 && bh > 0.0 && scale > 0.0) || !bw.is_finite() || !bh.is_finite() {
        return out;
    }
    let (cx, cy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
    let half = (bw * bw + bh * bh).sqrt() / 2.0;
    let (ca, sa) = (tx.angle.cos(), tx.angle.sin());
    let to_local = |u: f64, v: f64| (cx + u * ca - v * sa, cy + u * sa + v * ca);
    let mut gap = (tx.gap * scale).max(0.5);
    let mut len = (tx.len * scale).max(1.0);
    let mut width = (tx.width * scale).max(0.5);
    let est = (2.0 * half / gap) * (2.0 * half / (len * 0.78)).max(1.0);
    if est > FILL_STROKES_MAX {
        let k = (est / FILL_STROKES_MAX).sqrt();
        gap *= k;
        len *= k;
        width *= k;
    }
    let jit = tx.jitter * scale;
    let mut index = 0i64;
    let mut unit = || {
        let v = splitmix64_unit(tx.seed ^ STREAM_FILL, index);
        index += 1;
        v
    };
    let mut v = -half;
    let mut row = 0u64;
    while v <= half {
        let mut u = -half - unit() * len;
        while u <= half {
            // 每笔固定消耗七个随机数：`density` 只决定去留，不挪动别的笔
            let keep = unit();
            let l = len * (0.6 + unit() * 0.8);
            let j0 = (unit() - 0.5) * jit;
            let j1 = (unit() - 0.5) * jit;
            let bend = (unit() - 0.5) * jit * 1.5;
            let w = width * (0.8 + unit() * 0.4);
            let lift = unit();
            let mut poly: Vec<(f64, f64)> = (0..=4)
                .map(|i| {
                    let k = i as f64 / 4.0;
                    let off = j0 + (j1 - j0) * k + bend * (std::f64::consts::PI * k).sin();
                    to_local(u + l * k, v + off)
                })
                .collect();
            // 隔行反向：起笔的粗头与收笔的尖交错，不排成一个方向的鱼鳞
            if (row + (lift < 0.3) as u64) % 2 == 1 {
                poly.reverse();
            }
            let (mx, my) = poly[2];
            let cover = tx.density.at((mx - x0) / bw, (my - y0) / bh);
            let pad = w;
            let touches = poly
                .iter()
                .any(|&(x, y)| x >= x0 - pad && x <= x1 + pad && y >= y0 - pad && y <= y1 + pad);
            if keep < cover && touches {
                out.push((poly, w));
            }
            u += l * 0.78;
        }
        v += gap;
        row += 1;
    }
    out
}

#[derive(Default)]
struct Buckets {
    map: BTreeMap<(u8, i8), PathBuilder>,
}

impl Buckets {
    fn push(&mut self, load: u8, tone: i8, left: &[(f64, f64)], right: &[(f64, f64)]) {
        let pb = self.map.entry((load, tone)).or_default();
        pb.move_to(left[0].0 as f32, left[0].1 as f32);
        for p in &left[1..] {
            pb.line_to(p.0 as f32, p.1 as f32);
        }
        for p in right.iter().rev() {
            pb.line_to(p.0 as f32, p.1 as f32);
        }
        pb.close();
    }

    fn finish(self) -> PaintGeom {
        PaintGeom {
            buckets: self
                .map
                .into_iter()
                .filter_map(|((load, tone), pb)| {
                    pb.finish().map(|p| (load, tone, path_from_skia(&p)))
                })
                .collect(),
        }
    }
}

fn poly_len(poly: &[(f64, f64)]) -> f64 {
    poly.windows(2)
        .map(|w| ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt())
        .sum()
}

fn smooth(e0: f64, e1: f64, x: f64) -> f64 {
    if e1 <= e0 {
        return if x >= e1 { 1.0 } else { 0.0 };
    }
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// 一维值噪声，`[0, 1]`。
fn vnoise(seed: u64, x: f64) -> f64 {
    let i = x.floor();
    let f = x - i;
    let a = splitmix64_unit(seed, i as i64);
    let b = splitmix64_unit(seed, i as i64 + 1);
    a + (b - a) * f * f * (3.0 - 2.0 * f)
}

fn derive(seed: u64, a: u64) -> u64 {
    let mut z = seed ^ a.wrapping_add(1).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

#[derive(Clone, Copy)]
struct Sample {
    x: f64,
    y: f64,
    nx: f64,
    ny: f64,
    hw: f64,
}

/// 折线按弧长取点。
struct Line<'a> {
    pts: &'a [(f64, f64)],
    cum: Vec<f64>,
}

impl<'a> Line<'a> {
    fn new(pts: &'a [(f64, f64)]) -> Self {
        let mut cum = Vec::with_capacity(pts.len());
        let mut acc = 0.0;
        cum.push(0.0);
        for w in pts.windows(2) {
            acc += ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt();
            cum.push(acc);
        }
        Line { pts, cum }
    }

    fn len(&self) -> f64 {
        *self.cum.last().unwrap_or(&0.0)
    }

    fn at(&self, s: f64) -> (f64, f64) {
        let s = s.clamp(0.0, self.len());
        let i = self
            .cum
            .partition_point(|&c| c <= s)
            .clamp(1, self.pts.len() - 1);
        let (a, b) = (self.pts[i - 1], self.pts[i]);
        let seg = self.cum[i] - self.cum[i - 1];
        let k = if seg > 0.0 {
            (s - self.cum[i - 1]) / seg
        } else {
            0.0
        };
        (a.0 + (b.0 - a.0) * k, a.1 + (b.1 - a.1) * k)
    }
}

/// 一笔。`vis` 是这条折线上的可见弧长区间（绝对长度）。
fn stroke(
    poly: &[(f64, f64)],
    width: f64,
    p: &PaintParams,
    index: u64,
    vis: (f64, f64),
    out: &mut Buckets,
) {
    if poly.is_empty() || !(width > 0.0) || !width.is_finite() {
        return;
    }
    // 零长的一笔（一个点）画成顺着 x 的一小抹
    let dab;
    let (poly, vis) = if poly_len(poly) <= 1e-9 {
        let (x, y) = poly[0];
        dab = [(x - width * 0.3, y), (x + width * 0.3, y)];
        (&dab[..], (0.0, width * 0.6))
    } else {
        (poly, vis)
    };
    if poly.len() < 2 {
        return;
    }
    let line = Line::new(poly);
    let len = line.len();
    let seed = derive(p.seed, index);
    let rr = p.rough.clamp(0.0, 2.0);
    let dry = p.dry.clamp(0.0, 1.0);

    // 1. 重采样：点距约 W/4
    let mut h = (width / 4.0).clamp(0.5, 12.0);
    if len / h > SAMPLES_MAX {
        h = len / SAMPLES_MAX;
    }
    let m = ((len / h).ceil() as usize).max(2);
    let step = len / m as f64;
    // 起笔 / 收笔渐变段：按笔长的比例，长笔封顶到几倍笔宽
    let ts = (0.14 * len).min(2.0 * width) / len;
    let te = (0.34 * len).min(4.0 * width) / len;
    let reach = (width * 0.5).max(step);
    let mut normal = (0.0, -1.0);
    let samples: Vec<Sample> = (0..=m)
        .map(|k| {
            let s = step * k as f64;
            let (x, y) = line.at(s);
            let (ax, ay) = line.at(s - reach);
            let (bx, by) = line.at(s + reach);
            let (dx, dy) = (bx - ax, by - ay);
            let d = (dx * dx + dy * dy).sqrt();
            if d > 1e-9 {
                normal = (-dy / d, dx / d);
            }
            let t = s / len;
            let prof = (0.62 + 0.38 * smooth(0.0, ts, t)) * (1.0 - 0.72 * smooth(1.0 - te, 1.0, t));
            let wn = vnoise(seed ^ STREAM_WIDTH, s / (3.0 * width)) * 2.0 - 1.0;
            Sample {
                x,
                y,
                nx: normal.0,
                ny: normal.1,
                hw: width * 0.5 * prof * (1.0 + 0.08 * rr * wn),
            }
        })
        .collect();
    let at = |s: f64| -> Sample {
        let f = (s / step).clamp(0.0, m as f64);
        let i = (f.floor() as usize).min(m - 1);
        let k = f - i as f64;
        let (a, b) = (samples[i], samples[i + 1]);
        let l = |u: f64, v: f64| u + (v - u) * k;
        Sample {
            x: l(a.x, b.x),
            y: l(a.y, b.y),
            nx: l(a.nx, b.nx),
            ny: l(a.ny, b.ny),
            hw: l(a.hw, b.hw),
        }
    };

    // 2. 鬃毛带
    let nb = ((width * 0.3).round() as usize).clamp(3, 40);
    let band = 2.0 / nb as f64;
    let half = band * 0.5 * 1.18;
    // 短笔的圆头缩进按比例收，免得整笔被缩没
    let short = (len / (1.5 * width)).min(1.0);
    let (vis_lo, vis_hi) = vis;
    for j in 0..nb {
        let bs = derive(seed, j as u64 + 1);
        let r = |k: i64| splitmix64_unit(bs, k);
        let vc = -1.0 + band * (j as f64 + 0.5);
        let cap = 1.0 - (1.0 - vc * vc).max(0.0).sqrt();
        let (tone_h, load_h, body) = (r(0) * 2.0 - 1.0, r(1), r(2));
        let s0 = (0.5 * width * cap + r(3) * 0.25 * width * rr) * short;
        let s1 = len - (0.35 * width * cap + r(4) * 0.3 * width * rr) * short;
        // 画到一半：前沿与尾沿都是一排圆头
        let front = if vis_hi < len - 1e-9 {
            vis_hi - 0.35 * width * cap * short
        } else {
            f64::INFINITY
        };
        let back = if vis_lo > 1e-9 {
            vis_lo + 0.35 * width * cap * short
        } else {
            f64::NEG_INFINITY
        };
        let (lo, hi) = (s0.max(back), s1.min(front));
        if hi - lo < 0.05 * width {
            continue;
        }
        let edge = smooth(0.55, 1.0, vc.abs());
        let dry_edge = 0.25 * dry * smooth(0.6, 1.0, vc.abs());
        let streak = |s: f64| vnoise(bs ^ STREAM_STREAK, s / (width * 1.1));
        let present = |s: f64, st: f64| {
            let t = s / len;
            let rag = 0.5 * rr * edge * (vnoise(bs ^ STREAM_RAG, s / (width * 0.22)) - 0.5);
            let cov = 0.45 * body + 0.55 * st + rag;
            let thr = dry * (0.1 + 0.95 * smooth(0.35, 1.0, t)) - 0.05 + dry_edge;
            cov > thr
        };
        // 候选位置：区间两端 + 其间的采样点
        let mut stops = vec![lo];
        let first = (lo / step).floor() as usize + 1;
        for k in first..=m {
            let s = step * k as f64;
            if s >= hi {
                break;
            }
            stops.push(s);
        }
        stops.push(hi);
        let mut run: Vec<(f64, f64)> = Vec::new();
        let mut flush = |run: &mut Vec<(f64, f64)>| {
            if run.len() >= 2 && run[run.len() - 1].0 - run[0].0 >= 0.12 * width {
                emit(
                    run, vc, half, width, rr, bs, tone_h, load_h, p.load, &at, out,
                );
            }
            run.clear();
        };
        for &s in &stops {
            let st = streak(s);
            if present(s, st) {
                run.push((s, st));
            } else {
                flush(&mut run);
            }
        }
        flush(&mut run);
    }
}

/// 一段连续的鬃毛带 → 一个多边形。`run` = `(弧长, 该处 streak)`。
#[allow(clippy::too_many_arguments)]
fn emit(
    run: &[(f64, f64)],
    vc: f64,
    half: f64,
    width: f64,
    rr: f64,
    bs: u64,
    tone_h: f64,
    load_h: f64,
    with_load: bool,
    at: &dyn Fn(f64) -> Sample,
    out: &mut Buckets,
) {
    let (start, end) = (run[0].0, run[run.len() - 1].0);
    let mean = run.iter().map(|r| r.1).sum::<f64>() / run.len() as f64;
    let tone = ((0.55 * tone_h + 0.9 * (mean - 0.5)) * rr).clamp(-1.0, 1.0);
    let tone = (tone * TONE_STEPS as f64).round() as i8;
    let load = if with_load {
        let m = smooth(0.4, 0.72, load_h * 0.6 + mean * 0.5);
        if m < 0.33 {
            0
        } else if m < 0.66 {
            1
        } else {
            2
        }
    } else {
        0
    };
    let q = (0.18 * width).max(1e-6);
    let wave_amp = half * 0.5 * rr.min(1.0);
    let mut left = Vec::with_capacity(run.len());
    let mut right = Vec::with_capacity(run.len());
    for &(s, _) in run {
        let smp = at(s);
        let taper = 0.35 + 0.65 * smooth(0.0, q, (s - start).min(end - s));
        let c = vc + wave_amp * (vnoise(bs ^ STREAM_WAVE, s / (width * 1.6)) * 2.0 - 1.0);
        let mut lo = (c - half * taper).max(-1.05);
        let mut hi = (c + half * taper).min(1.05);
        let rag = 1.0 - 0.12 * rr * vnoise(bs ^ STREAM_EDGE, s / (width * 0.3));
        if hi > 0.9 {
            hi *= rag;
        }
        if lo < -0.9 {
            lo *= rag;
        }
        let (ox, oy) = (smp.nx * smp.hw, smp.ny * smp.hw);
        left.push((smp.x + ox * lo, smp.y + oy * lo));
        right.push((smp.x + ox * hi, smp.y + oy * hi));
    }
    out.push(load, tone, &left, &right);
}

/// 描边笔触的几何缓存：键 = 折线逐点位 + 线宽 + 参数 + 可见区间 + 算法版本。
/// 命中与否不影响输出，只影响耗时。
#[derive(Default)]
pub struct PaintCache {
    map: Mutex<HashMap<u64, Arc<PaintGeom>>>,
}

const CACHE_MAX: usize = 2048;

pub fn brush_key(
    subpaths: &[Vec<(f64, f64)>],
    width: f64,
    params: &PaintParams,
    vis: (f64, f64),
) -> u64 {
    let mut bytes: Vec<u8> =
        Vec::with_capacity(64 + subpaths.iter().map(Vec::len).sum::<usize>() * 16);
    bytes.extend(PAINT_ALGORITHM_VERSION.to_le_bytes());
    for v in [width, params.rough, params.dry, vis.0, vis.1] {
        bytes.extend(v.to_bits().to_le_bytes());
    }
    bytes.extend(params.seed.to_le_bytes());
    bytes.push(params.load as u8);
    for poly in subpaths {
        bytes.extend((poly.len() as u64).to_le_bytes());
        for (x, y) in poly {
            bytes.extend(x.to_bits().to_le_bytes());
            bytes.extend(y.to_bits().to_le_bytes());
        }
    }
    crate::drawop::fnv1a64(&bytes)
}

impl PaintCache {
    pub fn brush(
        &self,
        subpaths: &[Vec<(f64, f64)>],
        width: f64,
        params: &PaintParams,
        vis: (f64, f64),
    ) -> Arc<PaintGeom> {
        let key = brush_key(subpaths, width, params, vis);
        if let Ok(map) = self.map.lock()
            && let Some(hit) = map.get(&key)
        {
            return hit.clone();
        }
        let geom = Arc::new(brush(subpaths, width, params, vis));
        if let Ok(mut map) = self.map.lock() {
            if map.len() >= CACHE_MAX {
                map.clear();
            }
            map.insert(key, geom.clone());
        }
        geom
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const P: PaintParams = PaintParams {
        seed: 7,
        rough: 1.0,
        dry: 0.35,
        load: true,
    };

    fn arc() -> Vec<(f64, f64)> {
        (0..=20)
            .map(|i| {
                let a = i as f64 / 20.0 * 2.2;
                (200.0 + 160.0 * a.cos(), 200.0 + 120.0 * a.sin())
            })
            .collect()
    }

    fn area(geom: &PaintGeom) -> usize {
        geom.buckets.iter().map(|b| b.2.0.len()).sum()
    }

    #[test]
    fn generation_is_pure_and_bucketed() {
        let a = brush(&[arc()], 40.0, &P, (0.0, 1.0));
        let b = brush(&[arc()], 40.0, &P, (0.0, 1.0));
        assert_eq!(a, b);
        assert!(!a.is_empty());
        assert!(a.buckets.len() <= 15, "{}", a.buckets.len());
        let keys: Vec<_> = a.buckets.iter().map(|b| (b.0, b.1)).collect();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted);
        assert!(
            a.buckets.iter().any(|b| b.0 > 0),
            "有第二种颜料时要有含色带"
        );
    }

    #[test]
    fn seed_changes_geometry() {
        let a = brush(&[arc()], 40.0, &P, (0.0, 1.0));
        let b = brush(&[arc()], 40.0, &PaintParams { seed: 8, ..P }, (0.0, 1.0));
        assert_ne!(a, b);
    }

    #[test]
    fn no_load_means_single_load_level() {
        let g = brush(
            &[arc()],
            40.0,
            &PaintParams { load: false, ..P },
            (0.0, 1.0),
        );
        assert!(g.buckets.iter().all(|b| b.0 == 0));
        assert!(g.buckets.len() <= 5);
    }

    #[test]
    fn zero_roughness_is_one_flat_tone() {
        let g = brush(
            &[arc()],
            40.0,
            &PaintParams {
                rough: 0.0,
                load: false,
                ..P
            },
            (0.0, 1.0),
        );
        assert_eq!(g.buckets.len(), 1);
        assert_eq!(g.buckets[0].1, 0);
    }

    #[test]
    fn partial_reveal_draws_less_and_nothing_at_zero() {
        let full = brush(&[arc()], 40.0, &P, (0.0, 1.0));
        let half = brush(&[arc()], 40.0, &P, (0.0, 0.5));
        let none = brush(&[arc()], 40.0, &P, (0.0, 0.0));
        assert!(area(&half) < area(&full));
        assert!(none.is_empty());
    }

    #[test]
    fn dryer_brush_breaks_more() {
        let wet = brush(&[arc()], 40.0, &PaintParams { dry: 0.0, ..P }, (0.0, 1.0));
        let dry = brush(&[arc()], 40.0, &PaintParams { dry: 1.0, ..P }, (0.0, 1.0));
        // 断开 = 更多子路径（Move 动词）
        let moves = |g: &PaintGeom| {
            g.buckets
                .iter()
                .map(|b| b.2.0.iter().filter(|s| s.verb == 0).count())
                .sum::<usize>()
        };
        assert!(
            moves(&dry) > moves(&wet),
            "{} vs {}",
            moves(&dry),
            moves(&wet)
        );
    }

    #[test]
    fn dot_becomes_a_dab() {
        let g = brush(&[vec![(10.0, 10.0), (10.0, 10.0)]], 20.0, &P, (0.0, 1.0));
        assert!(!g.is_empty());
    }

    #[test]
    fn tone_color_lifts_and_darkens() {
        let base = Rgba {
            r: 100.0,
            g: 100.0,
            b: 100.0,
            a: 1.0,
        };
        assert!(tone_color(&base, None, 0, 2).r > 100.0);
        assert!(tone_color(&base, None, 0, -2).r < 100.0);
        assert_eq!(tone_color(&base, None, 2, 0), base);
        let load = Rgba {
            r: 255.0,
            g: 0.0,
            b: 0.0,
            a: 1.0,
        };
        let mixed = tone_color(&base, Some(&load), 2, 0);
        assert!(mixed.r > 200.0 && mixed.g < 30.0);
    }

    #[test]
    fn cache_hits_share_geometry() {
        let cache = PaintCache::default();
        let a = cache.brush(&[arc()], 30.0, &P, (0.0, 1.0));
        let b = cache.brush(&[arc()], 30.0, &P, (0.0, 1.0));
        assert!(Arc::ptr_eq(&a, &b));
        assert_eq!(*a, brush(&[arc()], 30.0, &P, (0.0, 1.0)));
    }
}
