//! 一帧录制的解释：状态、路径与裁剪栈的回放，逐条绘制翻译成 DrawOp。

use super::gradient;
use super::path::{self, Entry, IDENTITY, Mat, Seg};
use super::{ConvertError, Converter};
use crate::drawop::{BitmapData, DrawOp, FrameOps, GradientStop, PaintData};
use motion::effect::BlendMode;
use serde_json::Value;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::rc::Rc;

type Res<T> = Result<T, ConvertError>;

fn invalid(what: impl Into<String>) -> ConvertError {
    ConvertError::Invalid(what.into())
}

fn unsupported(what: impl Into<String>) -> ConvertError {
    ConvertError::Unsupported(what.into())
}

fn arr(v: &Value) -> Res<&Vec<Value>> {
    v.as_array().ok_or_else(|| invalid("expected an array"))
}

fn f(v: &[Value], i: usize) -> Res<f64> {
    v.get(i)
        .and_then(Value::as_f64)
        .ok_or_else(|| invalid(format!("expected a number at {i}")))
}

fn mat_of(v: &[Value], at: usize) -> Res<Mat> {
    Ok([
        f(v, at)?,
        f(v, at + 1)?,
        f(v, at + 2)?,
        f(v, at + 3)?,
        f(v, at + 4)?,
        f(v, at + 5)?,
    ])
}

struct Shadow {
    color: [f32; 4],
    sigma: f64,
    offset: (f64, f64),
}

enum PaintRef {
    Color([f64; 4]),
    Grad(usize),
    Pat(usize),
}

struct StrokeStyle {
    width: f64,
    cap: u8,
    join: u8,
    miter: f64,
    dash: Option<(Vec<f32>, f32)>,
}

struct State {
    alpha: f64,
    blend: Option<BlendMode>,
    shadow: Option<Shadow>,
    paint: Option<PaintRef>,
    stroke: Option<StrokeStyle>,
}

enum GradKind {
    Linear([f64; 4]),
    Radial([f64; 6]),
}

struct Grad {
    kind: GradKind,
    /// 按 offset 稳定排序，颜色 0..1。
    stops: Vec<(f64, [f64; 4])>,
}

struct Pat {
    res: u32,
    m: Option<Mat>,
}

fn parse_blend(op: &str) -> Res<Option<BlendMode>> {
    Ok(match op {
        "source-over" => None,
        "lighter" => Some(BlendMode::Plus),
        "multiply" => Some(BlendMode::Multiply),
        "screen" => Some(BlendMode::Screen),
        "overlay" => Some(BlendMode::Overlay),
        "darken" => Some(BlendMode::Darken),
        "lighten" => Some(BlendMode::Lighten),
        "difference" => Some(BlendMode::Difference),
        "exclusion" => Some(BlendMode::Exclusion),
        other => return Err(unsupported(format!("composite-operation: {other}"))),
    })
}

fn parse_state(v: &Value) -> Res<State> {
    let alpha = v.get("a").and_then(Value::as_f64).unwrap_or(1.0);
    let blend = parse_blend(v.get("op").and_then(Value::as_str).unwrap_or("source-over"))?;
    let shadow = match v.get("sh") {
        Some(sh) => {
            let sh = arr(sh)?;
            Some(Shadow {
                color: [
                    (f(sh, 0)? / 255.0) as f32,
                    (f(sh, 1)? / 255.0) as f32,
                    (f(sh, 2)? / 255.0) as f32,
                    f(sh, 3)? as f32,
                ],
                sigma: f(sh, 4)?.max(0.0) / 2.0,
                offset: (f(sh, 5)?, f(sh, 6)?),
            })
        }
        None => None,
    };
    let paint = match v.get("p") {
        Some(p) => {
            let p = arr(p)?;
            Some(match p.first().and_then(Value::as_str) {
                Some("c") => PaintRef::Color([
                    f(p, 1)? / 255.0,
                    f(p, 2)? / 255.0,
                    f(p, 3)? / 255.0,
                    f(p, 4)?,
                ]),
                Some("g") => PaintRef::Grad(f(p, 1)? as usize),
                Some("p") => PaintRef::Pat(f(p, 1)? as usize),
                _ => return Err(invalid("paint kind")),
            })
        }
        None => None,
    };
    let stroke = match v.get("lw").and_then(Value::as_f64) {
        Some(width) => {
            let cap = match v.get("cap").and_then(Value::as_str) {
                Some("round") => 1,
                Some("square") => 2,
                _ => 0,
            };
            let join = match v.get("join").and_then(Value::as_str) {
                Some("round") => 1,
                Some("bevel") => 2,
                _ => 0,
            };
            let dash = match v.get("dash").and_then(Value::as_array) {
                Some(list) => {
                    let mut values: Vec<f32> = list
                        .iter()
                        .filter_map(Value::as_f64)
                        .map(|d| d as f32)
                        .collect();
                    if values.len() % 2 == 1 {
                        values.extend_from_within(..);
                    }
                    let sum: f32 = values.iter().sum();
                    if values.iter().any(|d| !(d.is_finite() && *d >= 0.0)) {
                        return Err(invalid("line dash"));
                    }
                    (sum > 0.0).then(|| {
                        (
                            values,
                            v.get("do").and_then(Value::as_f64).unwrap_or(0.0) as f32,
                        )
                    })
                }
                None => None,
            };
            Some(StrokeStyle {
                width,
                cap,
                join,
                miter: v.get("ml").and_then(Value::as_f64).unwrap_or(10.0),
                dash,
            })
        }
        None => None,
    };
    Ok(State {
        alpha,
        blend,
        shadow,
        paint,
        stroke,
    })
}

fn parse_grad(v: &Value) -> Res<Grad> {
    let p = arr(v
        .get("p")
        .ok_or_else(|| invalid("gradient without points"))?)?;
    let kind = match v.get("k").and_then(Value::as_str) {
        Some("l") => GradKind::Linear([f(p, 0)?, f(p, 1)?, f(p, 2)?, f(p, 3)?]),
        Some("r") => GradKind::Radial([f(p, 0)?, f(p, 1)?, f(p, 2)?, f(p, 3)?, f(p, 4)?, f(p, 5)?]),
        _ => return Err(unsupported("gradient kind")),
    };
    let mut stops = Vec::new();
    for stop in arr(v
        .get("stops")
        .ok_or_else(|| invalid("gradient without stops"))?)?
    {
        let s = arr(stop)?;
        stops.push((
            f(s, 0)?.clamp(0.0, 1.0),
            [
                f(s, 1)? / 255.0,
                f(s, 2)? / 255.0,
                f(s, 3)? / 255.0,
                f(s, 4)?,
            ],
        ));
    }
    stops.sort_by(|a, b| a.0.total_cmp(&b.0));
    Ok(Grad { kind, stops })
}

/// 裁剪栈的一格：设备空间路径。
struct Clip {
    segs: Vec<Seg>,
    /// 路径退化（没有面积）：之后的绘制全被裁掉。
    empty: bool,
}

fn make_clip(segs: Vec<Seg>) -> Clip {
    let empty = path::to_path_data(&segs, None).0.len() < 2 || skia_path(&segs).is_none();
    Clip { segs, empty }
}

fn skia_path(segs: &[Seg]) -> Option<tiny_skia::Path> {
    path::to_skia(segs)
}

enum Mode {
    Fill { even_odd: bool },
    Stroke,
}

enum PaintSpec {
    State,
    /// drawImage：资源、源矩形与目标矩形（用户空间）。
    Image {
        res: u32,
        src: [f64; 4],
        dst: [f64; 4],
    },
}

struct Interp<'a> {
    conv: &'a Converter,
    out: FrameOps,
    ctm: Mat,
    path: Vec<Entry>,
    levels: Vec<Vec<Rc<Clip>>>,
    emitted: Vec<Rc<Clip>>,
    states: Vec<State>,
    grads: Vec<Grad>,
    pats: Vec<Pat>,
    /// 画布已清空（帧首的整幅 clearRect / 尺寸重设）。
    cleared: bool,
    /// 已经画过第一笔。
    started: bool,
    /// 帧里有非 source-over 的合成：画布内容要先在独立层里合成，再叠到页面底色上。
    needs_layer: bool,
    layer: bool,
    bitmap_ids: HashMap<(u32, u64), u32>,
}

fn rect_segs(x: f64, y: f64, w: f64, h: f64) -> Vec<Seg> {
    vec![
        Seg::Move(x, y),
        Seg::Line(x + w, y),
        Seg::Line(x + w, y + h),
        Seg::Line(x, y + h),
        Seg::Close,
    ]
}

fn entries_of(v: &Value) -> Res<Vec<Entry>> {
    let mut out = Vec::new();
    for e in arr(v)? {
        let tf = mat_of(
            arr(e
                .get("tf")
                .ok_or_else(|| invalid("path entry without tf"))?)?,
            0,
        )?;
        let cmd = arr(e
            .get("cmd")
            .ok_or_else(|| invalid("path entry without cmd"))?)?
        .clone();
        out.push(Entry { tf, cmd });
    }
    Ok(out)
}

fn to_f32(m: &Mat) -> [f32; 6] {
    m.map(|v| v as f32)
}

impl<'a> Interp<'a> {
    fn canvas(&self) -> (f64, f64) {
        (f64::from(self.conv.width), f64::from(self.conv.height))
    }

    /// 用户空间矩形在当前变换下是否盖满画布（只认轴对齐变换）。
    fn covers_canvas(&self, x: f64, y: f64, w: f64, h: f64) -> bool {
        let m = &self.ctm;
        if m[1] != 0.0 || m[2] != 0.0 {
            return false;
        }
        let (ax, ay) = path::apply(m, x, y);
        let (bx, by) = path::apply(m, x + w, y + h);
        let (x0, x1) = (ax.min(bx), ax.max(bx));
        let (y0, y1) = (ay.min(by), ay.max(by));
        let (cw, ch) = self.canvas();
        x0 <= 0.0 && y0 <= 0.0 && x1 >= cw && y1 >= ch
    }

    fn clip_active(&self) -> bool {
        self.levels.last().is_some_and(|l| !l.is_empty())
    }

    fn state(&self, v: &Value) -> Res<&State> {
        let index = v.as_u64().ok_or_else(|| invalid("state index"))? as usize;
        self.states
            .get(index)
            .ok_or_else(|| invalid(format!("unknown state {index}")))
    }

    fn pop_emitted_clips(&mut self) {
        for _ in 0..self.emitted.len() {
            self.out.ops.push(DrawOp::PopClip);
        }
        self.emitted.clear();
    }

    /// 让已发出的 ClipPath 栈等于当前裁剪层；返回 false 表示当前裁剪为空（不必画）。
    fn sync_clips(&mut self) -> bool {
        let desired = self.levels.last().cloned().unwrap_or_default();
        if desired.iter().any(|c| c.empty) {
            return false;
        }
        let common = self
            .emitted
            .iter()
            .zip(&desired)
            .take_while(|(a, b)| Rc::ptr_eq(a, b))
            .count();
        while self.emitted.len() > common {
            self.emitted.pop();
            self.out.ops.push(DrawOp::PopClip);
        }
        for clip in &desired[common..] {
            let id = self.out.paths.len() as u32;
            self.out.paths.push(path::to_path_data(&clip.segs, None));
            self.out.ops.push(DrawOp::ClipPath {
                path: id,
                tf: to_f32(&IDENTITY),
            });
            self.emitted.push(clip.clone());
        }
        true
    }

    /// 绘制前的帧完整性检查：画布必须先整幅清空，或第一笔就是不透明的整幅填充。
    fn begin_draw(&mut self, cover: bool) -> Res<()> {
        if self.started {
            return Ok(());
        }
        if !self.cleared && !cover {
            return Err(unsupported("frame-not-cleared"));
        }
        self.started = true;
        self.cleared = true;
        if self.needs_layer && !cover {
            self.out.ops.push(DrawOp::PushLayer {
                opacity: 1.0,
                blend: BlendMode::Normal,
            });
            self.layer = true;
        }
        Ok(())
    }

    /// 整幅清空（帧首或帧中）。
    fn full_clear(&mut self) {
        if !self.started {
            self.cleared = true;
            return;
        }
        let color = if self.layer {
            [0.0; 4]
        } else {
            self.conv.background
        };
        self.out.ops.push(DrawOp::Clear { color });
    }

    fn paint_opaque(&self, st: &State) -> bool {
        if st.alpha < 1.0 || st.blend.is_some() {
            return false;
        }
        match &st.paint {
            Some(PaintRef::Color(c)) => c[3] >= 1.0,
            Some(PaintRef::Grad(i)) => {
                let Some(g) = self.grads.get(*i) else {
                    return false;
                };
                if g.stops.is_empty() || g.stops.iter().any(|s| s.1[3] < 1.0) {
                    return false;
                }
                match g.kind {
                    GradKind::Linear([x0, y0, x1, y1]) => x0 != x1 || y0 != y1,
                    GradKind::Radial([x0, y0, r0, x1, y1, r1]) => {
                        (x1 - x0).hypot(y1 - y0) + r0 <= r1
                    }
                }
            }
            _ => false,
        }
    }

    fn bitmap_index(&mut self, key: (u32, u64), bitmap: BitmapData) -> u32 {
        if let Some(&id) = self.bitmap_ids.get(&key) {
            return id;
        }
        let id = self.out.bitmaps.len() as u32;
        self.out.bitmaps.push(bitmap);
        self.bitmap_ids.insert(key, id);
        id
    }

    fn stops(stops: &[(f64, [f64; 4])], alpha: f64) -> Vec<GradientStop> {
        stops
            .iter()
            .map(|(o, c)| GradientStop {
                offset: *o as f32,
                color: [c[0] as f32, c[1] as f32, c[2] as f32, (c[3] * alpha) as f32],
            })
            .collect()
    }

    /// 绘制的画笔；`None` = 什么都不画（透明、退化渐变）。`region` 是需要着色的设备像素范围。
    fn paint(&mut self, st: &State, spec: &PaintSpec, region: [i32; 4]) -> Res<Option<PaintData>> {
        let alpha = st.alpha;
        if let PaintSpec::Image { res, src, dst } = spec {
            let kx = dst[2] / src[2];
            let ky = dst[3] / src[3];
            let want = path::max_scale(&self.ctm) * kx.max(ky);
            let (bitmap, scale) = self.conv.image_bitmap(*res, want)?;
            let bitmap = self.bitmap_index((*res, scale.to_bits()), bitmap);
            return Ok(Some(PaintData::Pattern {
                bitmap,
                repeat: false,
                quality: 1,
                opacity: alpha as f32,
                transform: [
                    (kx / scale) as f32,
                    0.0,
                    0.0,
                    (ky / scale) as f32,
                    (dst[0] - src[0] * kx) as f32,
                    (dst[1] - src[1] * ky) as f32,
                ],
            }));
        }
        let Some(paint) = &st.paint else {
            return Err(invalid("draw without paint"));
        };
        Ok(match paint {
            PaintRef::Color(c) => {
                let a = c[3] * alpha;
                (a > 0.0)
                    .then(|| PaintData::Solid([c[0] as f32, c[1] as f32, c[2] as f32, a as f32]))
            }
            PaintRef::Pat(i) => {
                let pat = self
                    .pats
                    .get(*i)
                    .ok_or_else(|| invalid("unknown pattern"))?;
                let (res, m) = (pat.res, pat.m.unwrap_or(IDENTITY));
                let (bitmap, _) = self.conv.image_bitmap(res, 1.0)?;
                let bitmap = self.bitmap_index((res, 1f64.to_bits()), bitmap);
                Some(PaintData::Pattern {
                    bitmap,
                    repeat: true,
                    quality: 1,
                    opacity: alpha as f32,
                    transform: to_f32(&m),
                })
            }
            PaintRef::Grad(i) => {
                let g = self
                    .grads
                    .get(*i)
                    .ok_or_else(|| invalid("unknown gradient"))?;
                if g.stops.is_empty() {
                    return Ok(None);
                }
                match g.kind {
                    GradKind::Linear([x0, y0, x1, y1]) => {
                        if x0 == x1 && y0 == y1 {
                            return Ok(None);
                        }
                        Some(PaintData::Linear {
                            p0: [x0 as f32, y0 as f32],
                            p1: [x1 as f32, y1 as f32],
                            stops: Self::stops(&g.stops, alpha),
                        })
                    }
                    GradKind::Radial([x0, y0, r0, x1, y1, r1]) => {
                        let same_center = (x0 - x1).abs() < 1e-9 && (y0 - y1).abs() < 1e-9;
                        if same_center && (r0 - r1).abs() < 1e-9 {
                            return Ok(None);
                        }
                        if same_center && r0 < r1 {
                            // 同心：把 [r0, r1] 上的色标映射到 [0, r1]，r0 以内是首标颜色。
                            let mut stops = Self::stops(&g.stops, alpha);
                            for stop in &mut stops {
                                stop.offset =
                                    ((r0 + f64::from(stop.offset) * (r1 - r0)) / r1) as f32;
                            }
                            let first = stops[0].color;
                            stops.insert(
                                0,
                                GradientStop {
                                    offset: 0.0,
                                    color: first,
                                },
                            );
                            Some(PaintData::Radial {
                                center: [x1 as f32, y1 as f32],
                                radius: r1 as f32,
                                focus: [x1 as f32, y1 as f32],
                                stops,
                            })
                        } else if r0 == 0.0 && (x1 - x0).hypot(y1 - y0) < r1 {
                            Some(PaintData::Radial {
                                center: [x1 as f32, y1 as f32],
                                radius: r1 as f32,
                                focus: [x0 as f32, y0 as f32],
                                stops: Self::stops(&g.stops, alpha),
                            })
                        } else {
                            // 一般的两圆锥形：逐像素求解成设备空间位图。
                            let Some(inv) = path::invert(&self.ctm) else {
                                return Ok(None);
                            };
                            let stops: Vec<(f64, [f64; 4])> = g
                                .stops
                                .iter()
                                .map(|(o, c)| (*o, [c[0], c[1], c[2], c[3] * alpha]))
                                .collect();
                            let mut hasher = std::collections::hash_map::DefaultHasher::new();
                            for v in [x0, y0, r0, x1, y1, r1, alpha].iter().chain(&self.ctm) {
                                v.to_bits().hash(&mut hasher);
                            }
                            for (o, c) in &stops {
                                o.to_bits().hash(&mut hasher);
                                for v in c {
                                    v.to_bits().hash(&mut hasher);
                                }
                            }
                            region.hash(&mut hasher);
                            let key = hasher.finish();
                            let ctm = self.ctm;
                            let Some(bitmap) = self.conv.gradient_bitmap(key, || {
                                gradient::conical_bitmap(
                                    (x0, y0),
                                    r0,
                                    (x1, y1),
                                    r1,
                                    &stops,
                                    &ctm,
                                    region,
                                )
                            }) else {
                                return Ok(None);
                            };
                            let bitmap = self.bitmap_index((u32::MAX, key), bitmap);
                            let place = path::concat(
                                &inv,
                                &[
                                    1.0,
                                    0.0,
                                    0.0,
                                    1.0,
                                    f64::from(region[0]),
                                    f64::from(region[1]),
                                ],
                            );
                            Some(PaintData::Pattern {
                                bitmap,
                                repeat: false,
                                quality: 0,
                                opacity: 1.0,
                                transform: to_f32(&place),
                            })
                        }
                    }
                }
            }
        })
    }

    /// 一次绘制：`segs` 在当前变换的用户空间里。
    fn draw(&mut self, st_value: &Value, segs: Vec<Seg>, mode: Mode, spec: PaintSpec) -> Res<()> {
        let index = st_value.as_u64().ok_or_else(|| invalid("state index"))? as usize;
        let st = self
            .states
            .get(index)
            .ok_or_else(|| invalid("unknown state"))?;
        if st.alpha <= 0.0 {
            return Ok(());
        }
        if path::invert(&self.ctm).is_none() {
            return Ok(());
        }
        let Some(skia) = skia_path(&segs) else {
            return Ok(());
        };
        // 设备空间包围盒（用户包围盒四角经变换，保守）。
        let b = skia.bounds();
        let corners = [
            path::apply(&self.ctm, f64::from(b.left()), f64::from(b.top())),
            path::apply(&self.ctm, f64::from(b.right()), f64::from(b.top())),
            path::apply(&self.ctm, f64::from(b.left()), f64::from(b.bottom())),
            path::apply(&self.ctm, f64::from(b.right()), f64::from(b.bottom())),
        ];
        let mut x0 = corners.iter().map(|c| c.0).fold(f64::INFINITY, f64::min);
        let mut y0 = corners.iter().map(|c| c.1).fold(f64::INFINITY, f64::min);
        let mut x1 = corners
            .iter()
            .map(|c| c.0)
            .fold(f64::NEG_INFINITY, f64::max);
        let mut y1 = corners
            .iter()
            .map(|c| c.1)
            .fold(f64::NEG_INFINITY, f64::max);
        let mut grow = 1.0;
        if let Mode::Stroke = mode {
            let stroke = st
                .stroke
                .as_ref()
                .ok_or_else(|| invalid("stroke without line style"))?;
            let factor = if stroke.join == 0 {
                stroke.miter.max(1.5)
            } else {
                1.5
            };
            grow += stroke.width / 2.0 * path::max_scale(&self.ctm) * factor;
        }
        x0 -= grow;
        y0 -= grow;
        x1 += grow;
        y1 += grow;
        let (cw, ch) = self.canvas();
        // 阴影窗口：内容外扩 3σ，并只保留落在画布上（或阴影落在画布上）的部分。
        let window = st.shadow.as_ref().map(|sh| {
            let m = (sh.sigma * 3.0).ceil() + 2.0;
            let (dx, dy) = sh.offset;
            let ax0 = 0f64.min(-dx) - m;
            let ay0 = 0f64.min(-dy) - m;
            let ax1 = cw.max(cw - dx) + m;
            let ay1 = ch.max(ch - dy) + m;
            let wx0 = (x0 - m).max(ax0).floor();
            let wy0 = (y0 - m).max(ay0).floor();
            let wx1 = (x1 + m).min(ax1).ceil();
            let wy1 = (y1 + m).min(ay1).ceil();
            [
                wx0 as i32,
                wy0 as i32,
                (wx1 - wx0).max(0.0) as i32,
                (wy1 - wy0).max(0.0) as i32,
            ]
        });
        let region = match window {
            Some(w) => w,
            None => {
                let rx0 = x0.max(0.0).floor();
                let ry0 = y0.max(0.0).floor();
                let rx1 = x1.min(cw).ceil();
                let ry1 = y1.min(ch).ceil();
                if rx1 <= rx0 || ry1 <= ry0 {
                    return Ok(());
                }
                [
                    rx0 as i32,
                    ry0 as i32,
                    (rx1 - rx0) as i32,
                    (ry1 - ry0) as i32,
                ]
            }
        };
        if region[2] <= 0 || region[3] <= 0 {
            return Ok(());
        }
        // 借用：先把需要的状态字段拷出来，再改 `self`。
        let blend = st.blend;
        let shadow = st.shadow.as_ref().map(|sh| DrawOp::PushShadow {
            color: sh.color,
            sigma: sh.sigma as f32,
            offset: [sh.offset.0 as f32, sh.offset.1 as f32],
            window: window.unwrap_or_default(),
        });
        let stroke = match mode {
            Mode::Stroke => st
                .stroke
                .as_ref()
                .map(|s| (s.width, s.cap, s.join, s.miter, s.dash.clone())),
            Mode::Fill { .. } => None,
        };
        // `paint` 要改输出侧表：状态表先借出来，用完放回。
        let states = std::mem::take(&mut self.states);
        let paint = self.paint(&states[index], &spec, region);
        self.states = states;
        let Some(paint) = paint? else {
            return Ok(());
        };
        if !self.sync_clips() {
            return Ok(());
        }
        let path_id = self.out.paths.len() as u32;
        self.out.paths.push(path::to_path_data(&segs, None));
        let paint_id = self.out.paints.len() as u32;
        self.out.paints.push(paint);
        let tf = to_f32(&self.ctm);
        if let Some(blend) = blend {
            self.out.ops.push(DrawOp::PushBlend { blend });
        }
        let shadowed = shadow.is_some();
        if let Some(op) = shadow {
            self.out.ops.push(op);
        }
        self.out.ops.push(match (mode, stroke) {
            (Mode::Fill { even_odd }, _) => DrawOp::FillPathPaint {
                path: path_id,
                paint: paint_id,
                even_odd,
                tf,
            },
            (Mode::Stroke, Some((width, cap, join, miter, Some((dash, dash_offset))))) => {
                DrawOp::StrokePathDash {
                    path: path_id,
                    paint: paint_id,
                    width: width as f32,
                    cap,
                    join,
                    miter: miter as f32,
                    dash,
                    dash_offset,
                    tf,
                }
            }
            (Mode::Stroke, Some((width, cap, join, miter, None))) => DrawOp::StrokePathPaint {
                path: path_id,
                paint: paint_id,
                width: width as f32,
                cap,
                join,
                miter: miter as f32,
                tf,
            },
            (Mode::Stroke, None) => return Err(invalid("stroke without line style")),
        });
        if shadowed {
            self.out.ops.push(DrawOp::PopShadow);
        }
        if blend.is_some() {
            self.out.ops.push(DrawOp::PopBlend);
        }
        Ok(())
    }

    /// 当前路径（设备空间）换到当前变换的用户空间。
    fn current_path_user(&self) -> Res<Vec<Seg>> {
        let device = path::build(&self.path).map_err(invalid)?;
        if self.ctm == IDENTITY {
            return Ok(device);
        }
        let Some(inv) = path::invert(&self.ctm) else {
            return Ok(Vec::new());
        };
        Ok(device.iter().map(|s| s.map(&inv)).collect())
    }

    fn run(&mut self, ops: &[Value]) -> Res<()> {
        for op in ops {
            let op = arr(op)?;
            let tag = op
                .first()
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("op without tag"))?;
            match tag {
                "m" => self.ctm = mat_of(op, 1)?,
                "B" => self.path.clear(),
                "M" | "L" | "Q" | "C" | "Z" | "A" | "T" | "E" | "R" | "RR" => {
                    self.path.push(Entry {
                        tf: self.ctm,
                        cmd: op.clone(),
                    })
                }
                "S" => {
                    let top = self.levels.last().cloned().unwrap_or_default();
                    self.levels.push(top);
                }
                "X" => {
                    if self.levels.len() > 1 {
                        self.levels.pop();
                    }
                }
                "K" => {
                    if f(op, 1)? != 0.0 {
                        return Err(unsupported("clip-evenodd"));
                    }
                    let segs = path::build(&self.path).map_err(invalid)?;
                    let clip = Rc::new(make_clip(segs));
                    if let Some(top) = self.levels.last_mut() {
                        top.push(clip);
                    }
                }
                "RESET" => {
                    self.pop_emitted_clips();
                    self.levels = vec![Vec::new()];
                    self.path.clear();
                    self.ctm = IDENTITY;
                    self.full_clear();
                }
                "CR" => {
                    let (x, y, w, h) = (f(op, 1)?, f(op, 2)?, f(op, 3)?, f(op, 4)?);
                    if self.covers_canvas(x, y, w, h) && !self.clip_active() {
                        self.full_clear();
                    } else if !self.started {
                        // 已清空的画布上局部清除不改变什么；没清空过则帧不完整。
                        if !self.cleared {
                            return Err(unsupported("frame-not-cleared"));
                        }
                    } else {
                        return Err(unsupported("clear-rect-partial"));
                    }
                }
                "F" | "D" => {
                    self.begin_draw(false)?;
                    let segs = self.current_path_user()?;
                    let mode = if tag == "F" {
                        Mode::Fill {
                            even_odd: f(op, 2)? != 0.0,
                        }
                    } else {
                        Mode::Stroke
                    };
                    self.draw(&op[1], segs, mode, PaintSpec::State)?;
                }
                "FR" | "SR" => {
                    let (x, y, w, h) = (f(op, 2)?, f(op, 3)?, f(op, 4)?, f(op, 5)?);
                    let cover = tag == "FR" && {
                        let st = self.state(&op[1])?;
                        self.paint_opaque(st)
                            && self.covers_canvas(x, y, w, h)
                            && !self.clip_active()
                    };
                    self.begin_draw(cover)?;
                    if w == 0.0 && h == 0.0 {
                        continue;
                    }
                    let mode = if tag == "FR" {
                        if w == 0.0 || h == 0.0 {
                            continue;
                        }
                        Mode::Fill { even_odd: false }
                    } else {
                        Mode::Stroke
                    };
                    self.draw(&op[1], rect_segs(x, y, w, h), mode, PaintSpec::State)?;
                }
                "FT" | "ST" => {
                    self.begin_draw(false)?;
                    let text = op
                        .get(2)
                        .and_then(Value::as_str)
                        .ok_or_else(|| invalid("text"))?;
                    let font_id = f(op, 5)? as u32;
                    let style = op.get(8).and_then(Value::as_str).unwrap_or("normal");
                    let font = match self.conv.fonts.get(&font_id) {
                        Some(Ok(font)) => font,
                        Some(Err(reason)) => return Err(unsupported(reason.clone())),
                        None => return Err(invalid(format!("unknown font {font_id}"))),
                    };
                    let segs = font
                        .layout(
                            text,
                            f(op, 6)?,
                            f(op, 7)?,
                            style,
                            f(op, 3)?,
                            f(op, 4)?,
                            f(op, 9)?,
                            f(op, 10)?,
                        )
                        .map_err(unsupported)?;
                    let mode = if tag == "FT" {
                        Mode::Fill { even_odd: false }
                    } else {
                        Mode::Stroke
                    };
                    self.draw(&op[1], segs, mode, PaintSpec::State)?;
                }
                "I" => {
                    self.begin_draw(false)?;
                    let res = f(op, 2)? as u32;
                    let src = [f(op, 3)?, f(op, 4)?, f(op, 5)?, f(op, 6)?];
                    let dst = [f(op, 7)?, f(op, 8)?, f(op, 9)?, f(op, 10)?];
                    let segs = rect_segs(dst[0], dst[1], dst[2], dst[3]);
                    self.draw(
                        &op[1],
                        segs,
                        Mode::Fill { even_odd: false },
                        PaintSpec::Image { res, src, dst },
                    )?;
                }
                other => return Err(invalid(format!("unknown op {other}"))),
            }
        }
        Ok(())
    }
}

pub(super) fn convert(conv: &Converter, frame: &Value) -> Res<FrameOps> {
    let list = |key: &str| -> Res<Vec<Value>> {
        Ok(match frame.get(key) {
            Some(v) => arr(v)?.clone(),
            None => Vec::new(),
        })
    };
    let states = list("states")?
        .iter()
        .map(parse_state)
        .collect::<Res<Vec<_>>>()?;
    let grads = list("grads")?
        .iter()
        .map(parse_grad)
        .collect::<Res<Vec<_>>>()?;
    let pats = list("pats")?
        .iter()
        .map(|p| {
            Ok(Pat {
                res: p
                    .get("r")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| invalid("pattern without resource"))?
                    as u32,
                m: match p.get("m") {
                    Some(Value::Array(m)) => Some(mat_of(m, 0)?),
                    _ => None,
                },
            })
        })
        .collect::<Res<Vec<_>>>()?;
    let needs_layer = states.iter().any(|s| s.blend.is_some());
    let mut interp = Interp {
        conv,
        out: FrameOps::default(),
        ctm: IDENTITY,
        path: Vec::new(),
        levels: vec![Vec::new()],
        emitted: Vec::new(),
        states,
        grads,
        pats,
        cleared: false,
        started: false,
        needs_layer,
        layer: false,
        bitmap_ids: HashMap::new(),
    };
    if let Some(init) = frame.get("init") {
        if let Some(p) = init.get("path") {
            interp.path = entries_of(p)?;
        }
        if let Some(levels) = init.get("levels") {
            // 同一份裁剪会在多层里重复出现：按 JSON 内容共享同一个 `Rc`，换层时不必重新压栈。
            let mut shared: HashMap<String, Rc<Clip>> = HashMap::new();
            let mut out = Vec::new();
            for level in arr(levels)? {
                let mut clips = Vec::new();
                for clip in arr(level)? {
                    if clip.get("rule").and_then(Value::as_u64).unwrap_or(0) != 0 {
                        return Err(unsupported("clip-evenodd"));
                    }
                    let key = clip.to_string();
                    let entry = match shared.get(&key) {
                        Some(hit) => hit.clone(),
                        None => {
                            let segs = path::build(&entries_of(
                                clip.get("path")
                                    .ok_or_else(|| invalid("clip without path"))?,
                            )?)
                            .map_err(invalid)?;
                            let made = Rc::new(make_clip(segs));
                            shared.insert(key, made.clone());
                            made
                        }
                    };
                    clips.push(entry);
                }
                out.push(clips);
            }
            if !out.is_empty() {
                interp.levels = out;
            }
        }
    }
    interp.out.ops.push(DrawOp::Clear {
        color: conv.background,
    });
    let ops = list("ops")?;
    interp.run(&ops)?;
    if !interp.cleared {
        return Err(unsupported("frame-not-cleared"));
    }
    interp.pop_emitted_clips();
    if interp.layer {
        interp.out.ops.push(DrawOp::PopLayer);
    }
    Ok(interp.out)
}
