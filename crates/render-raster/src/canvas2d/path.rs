//! Canvas 2D 路径命令 → 设备空间几何。
//!
//! 录制里每条路径命令都带着加入时的变换（`{tf, cmd}`），与 Canvas 的语义一致：路径在加入时就被当前变换
//! 映射到设备空间，之后改变换不影响已有的部分。这里按命令逐条在**用户空间**算几何（圆弧、`arcTo`、
//! 圆角矩形都先展成三次贝塞尔），再用那条命令的变换映射到设备空间。

use serde_json::Value;

pub type Mat = [f64; 6];

pub const IDENTITY: Mat = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

pub fn apply(m: &Mat, x: f64, y: f64) -> (f64, f64) {
    (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
}

pub fn invert(m: &Mat) -> Option<Mat> {
    let det = m[0] * m[3] - m[1] * m[2];
    if !det.is_finite() || det.abs() < 1e-12 {
        return None;
    }
    let inv = 1.0 / det;
    Some([
        m[3] * inv,
        -m[1] * inv,
        -m[2] * inv,
        m[0] * inv,
        (m[2] * m[5] - m[3] * m[4]) * inv,
        (m[1] * m[4] - m[0] * m[5]) * inv,
    ])
}

/// `a ∘ b`：先 `b` 后 `a`。
pub fn concat(a: &Mat, b: &Mat) -> Mat {
    [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
    ]
}

/// 变换把单位长度放大到的最大倍数（描边外扩、SVG 光栅尺寸用）。
pub fn max_scale(m: &Mat) -> f64 {
    m[0].hypot(m[1]).max(m[2].hypot(m[3]))
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Seg {
    Move(f64, f64),
    Line(f64, f64),
    Quad(f64, f64, f64, f64),
    Cubic(f64, f64, f64, f64, f64, f64),
    Close,
}

impl Seg {
    pub fn map(&self, m: &Mat) -> Seg {
        match *self {
            Seg::Move(x, y) => {
                let (x, y) = apply(m, x, y);
                Seg::Move(x, y)
            }
            Seg::Line(x, y) => {
                let (x, y) = apply(m, x, y);
                Seg::Line(x, y)
            }
            Seg::Quad(a, b, x, y) => {
                let (a, b) = apply(m, a, b);
                let (x, y) = apply(m, x, y);
                Seg::Quad(a, b, x, y)
            }
            Seg::Cubic(a, b, c, d, x, y) => {
                let (a, b) = apply(m, a, b);
                let (c, d) = apply(m, c, d);
                let (x, y) = apply(m, x, y);
                Seg::Cubic(a, b, c, d, x, y)
            }
            Seg::Close => Seg::Close,
        }
    }
}

/// 一条带变换的路径命令（录制格式 `{tf, cmd}` 或帧内的 `['M', …]`）。
#[derive(Debug, Clone)]
pub struct Entry {
    pub tf: Mat,
    pub cmd: Vec<Value>,
}

/// 设备空间路径的构建器：维护 Canvas 的「当前点」与子路径起点。
#[derive(Default)]
pub struct Builder {
    pub segs: Vec<Seg>,
    current: Option<(f64, f64)>,
    start: (f64, f64),
}

const TWO_PI: f64 = std::f64::consts::PI * 2.0;

fn num(cmd: &[Value], i: usize) -> Result<f64, String> {
    cmd.get(i)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("path command argument {i} is not a number"))
}

impl Builder {
    fn move_to(&mut self, p: (f64, f64)) {
        self.segs.push(Seg::Move(p.0, p.1));
        self.current = Some(p);
        self.start = p;
    }

    fn line_to(&mut self, p: (f64, f64)) {
        if self.current.is_none() {
            self.move_to(p);
            return;
        }
        self.segs.push(Seg::Line(p.0, p.1));
        self.current = Some(p);
    }

    fn ensure(&mut self, p: (f64, f64)) {
        if self.current.is_none() {
            self.move_to(p);
        }
    }

    fn cubic(&mut self, c1: (f64, f64), c2: (f64, f64), p: (f64, f64)) {
        self.segs.push(Seg::Cubic(c1.0, c1.1, c2.0, c2.1, p.0, p.1));
        self.current = Some(p);
    }

    fn close(&mut self) {
        if self.current.is_some() {
            self.segs.push(Seg::Close);
            self.current = Some(self.start);
        }
    }

    /// 用户空间的椭圆弧（`sweep` 可正可负）→ 设备空间三次贝塞尔；先连一条线到起点。
    #[allow(clippy::too_many_arguments)]
    fn ellipse_arc(
        &mut self,
        m: &Mat,
        cx: f64,
        cy: f64,
        rx: f64,
        ry: f64,
        rot: f64,
        start: f64,
        sweep: f64,
    ) {
        let (sin_r, cos_r) = rot.sin_cos();
        // 用户空间里椭圆上角度 `a` 的点。
        let local = |a: f64| {
            let (s, c) = a.sin_cos();
            let (x, y) = (rx * c, ry * s);
            (cx + x * cos_r - y * sin_r, cy + x * sin_r + y * cos_r)
        };
        let tangent = |a: f64, k: f64| {
            let (s, c) = a.sin_cos();
            let (x, y) = (-rx * s * k, ry * c * k);
            (x * cos_r - y * sin_r, x * sin_r + y * cos_r)
        };
        let first = local(start);
        self.line_to(apply(m, first.0, first.1));
        if sweep == 0.0 {
            return;
        }
        let pieces = (sweep.abs() / (std::f64::consts::FRAC_PI_2) - 1e-9)
            .ceil()
            .max(1.0) as usize;
        let step = sweep / pieces as f64;
        let k = 4.0 / 3.0 * (step / 4.0).tan();
        for i in 0..pieces {
            let a0 = start + step * i as f64;
            let a1 = if i + 1 == pieces {
                start + sweep
            } else {
                a0 + step
            };
            let (sx0, sy0) = local(a0);
            let (sx1, sy1) = local(a1);
            let (tx0, ty0) = tangent(a0, k);
            let (tx1, ty1) = tangent(a1, k);
            let c1 = apply(m, sx0 + tx0, sy0 + ty0);
            let c2 = apply(m, sx1 - tx1, sy1 - ty1);
            let end = apply(m, sx1, sy1);
            self.cubic(c1, c2, end);
        }
    }

    /// 执行一条命令（`tf` 是它加入时的变换）。
    pub fn push(&mut self, tf: &Mat, cmd: &[Value]) -> Result<(), String> {
        let tag = cmd
            .first()
            .and_then(Value::as_str)
            .ok_or("path command without tag")?;
        match tag {
            "M" => {
                let p = apply(tf, num(cmd, 1)?, num(cmd, 2)?);
                self.move_to(p);
            }
            "L" => {
                let p = apply(tf, num(cmd, 1)?, num(cmd, 2)?);
                self.line_to(p);
            }
            "Q" => {
                let c = apply(tf, num(cmd, 1)?, num(cmd, 2)?);
                let p = apply(tf, num(cmd, 3)?, num(cmd, 4)?);
                self.ensure(c);
                self.segs.push(Seg::Quad(c.0, c.1, p.0, p.1));
                self.current = Some(p);
            }
            "C" => {
                let c1 = apply(tf, num(cmd, 1)?, num(cmd, 2)?);
                let c2 = apply(tf, num(cmd, 3)?, num(cmd, 4)?);
                let p = apply(tf, num(cmd, 5)?, num(cmd, 6)?);
                self.ensure(c1);
                self.cubic(c1, c2, p);
            }
            "Z" => self.close(),
            "A" => {
                let r = num(cmd, 3)?;
                let ccw = num(cmd, 6)? != 0.0;
                let (start, sweep) = arc_sweep(num(cmd, 4)?, num(cmd, 5)?, ccw);
                self.ellipse_arc(tf, num(cmd, 1)?, num(cmd, 2)?, r, r, 0.0, start, sweep);
            }
            "E" => {
                let ccw = num(cmd, 8)? != 0.0;
                let (start, sweep) = arc_sweep(num(cmd, 6)?, num(cmd, 7)?, ccw);
                self.ellipse_arc(
                    tf,
                    num(cmd, 1)?,
                    num(cmd, 2)?,
                    num(cmd, 3)?,
                    num(cmd, 4)?,
                    num(cmd, 5)?,
                    start,
                    sweep,
                );
            }
            "T" => self.arc_to(tf, cmd)?,
            "R" => {
                let (x, y, w, h) = (num(cmd, 1)?, num(cmd, 2)?, num(cmd, 3)?, num(cmd, 4)?);
                self.move_to(apply(tf, x, y));
                self.line_to(apply(tf, x + w, y));
                self.line_to(apply(tf, x + w, y + h));
                self.line_to(apply(tf, x, y + h));
                self.close();
            }
            "RR" => self.round_rect(tf, cmd)?,
            other => return Err(format!("unknown path command {other}")),
        }
        Ok(())
    }

    fn arc_to(&mut self, tf: &Mat, cmd: &[Value]) -> Result<(), String> {
        let (x1, y1, x2, y2, r) = (
            num(cmd, 1)?,
            num(cmd, 2)?,
            num(cmd, 3)?,
            num(cmd, 4)?,
            num(cmd, 5)?,
        );
        let Some(current) = self.current else {
            self.move_to(apply(tf, x1, y1));
            return Ok(());
        };
        // 当前点换回这条命令的用户空间。
        let Some(inv) = invert(tf) else {
            return Ok(());
        };
        let (x0, y0) = apply(&inv, current.0, current.1);
        let same =
            |ax: f64, ay: f64, bx: f64, by: f64| (ax - bx).abs() < 1e-9 && (ay - by).abs() < 1e-9;
        let cross = (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1);
        if same(x0, y0, x1, y1) || same(x1, y1, x2, y2) || r == 0.0 || cross.abs() < 1e-9 {
            self.line_to(apply(tf, x1, y1));
            return Ok(());
        }
        let (v1x, v1y) = normalize(x0 - x1, y0 - y1);
        let (v2x, v2y) = normalize(x2 - x1, y2 - y1);
        let cos = (v1x * v2x + v1y * v2y).clamp(-1.0, 1.0);
        let half = cos.acos() / 2.0;
        let dist = r / half.tan();
        let t1 = (x1 + v1x * dist, y1 + v1y * dist);
        let t2 = (x1 + v2x * dist, y1 + v2y * dist);
        let (bx, by) = normalize(v1x + v2x, v1y + v2y);
        let center_dist = r / half.sin();
        let (cx, cy) = (x1 + bx * center_dist, y1 + by * center_dist);
        let a0 = (t1.1 - cy).atan2(t1.0 - cx);
        let a1 = (t2.1 - cy).atan2(t2.0 - cx);
        let mut sweep = a1 - a0;
        while sweep > std::f64::consts::PI {
            sweep -= TWO_PI;
        }
        while sweep < -std::f64::consts::PI {
            sweep += TWO_PI;
        }
        self.ellipse_arc(tf, cx, cy, r, r, 0.0, a0, sweep);
        Ok(())
    }

    fn round_rect(&mut self, tf: &Mat, cmd: &[Value]) -> Result<(), String> {
        let (mut x, mut y, mut w, mut h) = (num(cmd, 1)?, num(cmd, 2)?, num(cmd, 3)?, num(cmd, 4)?);
        let mut r = [(0.0, 0.0); 4]; // ul, ur, lr, ll
        for (i, corner) in r.iter_mut().enumerate() {
            *corner = (num(cmd, 5 + i * 2)?.max(0.0), num(cmd, 6 + i * 2)?.max(0.0));
        }
        if w < 0.0 {
            x += w;
            w = -w;
            r = [r[1], r[0], r[3], r[2]];
        }
        if h < 0.0 {
            y += h;
            h = -h;
            r = [r[3], r[2], r[1], r[0]];
        }
        let mut scale: f64 = 1.0;
        for (side, a, b) in [
            (w, r[0].0, r[1].0),
            (w, r[3].0, r[2].0),
            (h, r[0].1, r[3].1),
            (h, r[1].1, r[2].1),
        ] {
            if a + b > 0.0 {
                scale = scale.min(side / (a + b));
            }
        }
        for corner in r.iter_mut() {
            corner.0 *= scale;
            corner.1 *= scale;
        }
        let [ul, ur, lr, ll] = r;
        use std::f64::consts::{FRAC_PI_2, PI};
        self.move_to(apply(tf, x + ul.0, y));
        self.line_to(apply(tf, x + w - ur.0, y));
        if ur.0 > 0.0 && ur.1 > 0.0 {
            self.ellipse_arc(
                tf,
                x + w - ur.0,
                y + ur.1,
                ur.0,
                ur.1,
                0.0,
                -FRAC_PI_2,
                FRAC_PI_2,
            );
        }
        self.line_to(apply(tf, x + w, y + h - lr.1));
        if lr.0 > 0.0 && lr.1 > 0.0 {
            self.ellipse_arc(
                tf,
                x + w - lr.0,
                y + h - lr.1,
                lr.0,
                lr.1,
                0.0,
                0.0,
                FRAC_PI_2,
            );
        }
        self.line_to(apply(tf, x + ll.0, y + h));
        if ll.0 > 0.0 && ll.1 > 0.0 {
            self.ellipse_arc(
                tf,
                x + ll.0,
                y + h - ll.1,
                ll.0,
                ll.1,
                0.0,
                FRAC_PI_2,
                FRAC_PI_2,
            );
        }
        self.line_to(apply(tf, x, y + ul.1));
        if ul.0 > 0.0 && ul.1 > 0.0 {
            self.ellipse_arc(tf, x + ul.0, y + ul.1, ul.0, ul.1, 0.0, PI, FRAC_PI_2);
        }
        self.close();
        self.move_to(apply(tf, x, y));
        Ok(())
    }
}

fn normalize(x: f64, y: f64) -> (f64, f64) {
    let len = x.hypot(y);
    if len == 0.0 {
        (0.0, 0.0)
    } else {
        (x / len, y / len)
    }
}

/// Blink 的角度规整（`CanonicalizeAngle` + `AdjustEndAngle`）：返回 (起始角, 扫过的角度)。
pub fn arc_sweep(start: f64, end: f64, ccw: bool) -> (f64, f64) {
    let mut s = start % TWO_PI;
    if s < 0.0 {
        s += TWO_PI;
    }
    let e = end + (s - start);
    let new_end = if !ccw && e - s >= TWO_PI {
        s + TWO_PI
    } else if ccw && s - e >= TWO_PI {
        s - TWO_PI
    } else if !ccw && s > e {
        s + (TWO_PI - (s - e) % TWO_PI)
    } else if ccw && s < e {
        s - (TWO_PI - (e - s) % TWO_PI)
    } else {
        e
    };
    (s, new_end - s)
}

/// 一串命令 → 设备空间路径。
pub fn build(entries: &[Entry]) -> Result<Vec<Seg>, String> {
    let mut builder = Builder::default();
    for entry in entries {
        builder.push(&entry.tf, &entry.cmd)?;
    }
    Ok(builder.segs)
}

/// 控制点包围盒（保守）：`(x0, y0, x1, y1)`。
pub fn bounds(segs: &[Seg]) -> Option<(f64, f64, f64, f64)> {
    let mut b: Option<(f64, f64, f64, f64)> = None;
    let mut add = |x: f64, y: f64| {
        b = Some(match b {
            None => (x, y, x, y),
            Some((x0, y0, x1, y1)) => (x0.min(x), y0.min(y), x1.max(x), y1.max(y)),
        });
    };
    for seg in segs {
        match *seg {
            Seg::Move(x, y) | Seg::Line(x, y) => add(x, y),
            Seg::Quad(a, b, x, y) => {
                add(a, b);
                add(x, y);
            }
            Seg::Cubic(a, b, c, d, x, y) => {
                add(a, b);
                add(c, d);
                add(x, y);
            }
            Seg::Close => {}
        }
    }
    b
}

/// 设备空间路径 → DrawOp 的 `PathData`（先用 `to_local` 换到绘制的局部坐标系）。
pub fn to_path_data(segs: &[Seg], to_local: Option<&Mat>) -> crate::drawop::PathData {
    use crate::drawop::{PathData, PathSeg};
    let mut out = Vec::with_capacity(segs.len());
    for seg in segs {
        let seg = match to_local {
            Some(m) => seg.map(m),
            None => *seg,
        };
        let f = |v: f64| v as f32;
        out.push(match seg {
            Seg::Move(x, y) => PathSeg {
                verb: 0,
                pts: [f(x), f(y), 0.0, 0.0, 0.0, 0.0],
            },
            Seg::Line(x, y) => PathSeg {
                verb: 1,
                pts: [f(x), f(y), 0.0, 0.0, 0.0, 0.0],
            },
            Seg::Quad(a, b, x, y) => PathSeg {
                verb: 2,
                pts: [f(a), f(b), f(x), f(y), 0.0, 0.0],
            },
            Seg::Cubic(a, b, c, d, x, y) => PathSeg {
                verb: 3,
                pts: [f(a), f(b), f(c), f(d), f(x), f(y)],
            },
            Seg::Close => PathSeg {
                verb: 4,
                pts: [0.0; 6],
            },
        });
    }
    PathData(out)
}

/// 段列表 → tiny-skia 路径；退化（没有可画的段）时 `None`。
pub fn to_skia(segs: &[Seg]) -> Option<tiny_skia::Path> {
    let mut pb = tiny_skia::PathBuilder::new();
    for seg in segs {
        let f = |v: f64| v as f32;
        match *seg {
            Seg::Move(x, y) => pb.move_to(f(x), f(y)),
            Seg::Line(x, y) => pb.line_to(f(x), f(y)),
            Seg::Quad(a, b, x, y) => pb.quad_to(f(a), f(b), f(x), f(y)),
            Seg::Cubic(a, b, c, d, x, y) => pb.cubic_to(f(a), f(b), f(c), f(d), f(x), f(y)),
            Seg::Close => pb.close(),
        }
    }
    pb.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cmd(v: Value) -> Vec<Value> {
        v.as_array().unwrap().clone()
    }

    #[test]
    fn blink_angle_rules() {
        let (s, sweep) = arc_sweep(0.0, 7.0, false);
        assert_eq!((s, sweep), (0.0, TWO_PI));
        let (_, sweep) = arc_sweep(0.0, std::f64::consts::PI, true);
        assert!((sweep + std::f64::consts::PI).abs() < 1e-12);
        let (s, sweep) = arc_sweep(-std::f64::consts::FRAC_PI_2, 0.0, false);
        assert!((s - 1.5 * std::f64::consts::PI).abs() < 1e-12);
        assert!((sweep - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
    }

    #[test]
    fn arc_lands_on_its_end_point() {
        let mut b = Builder::default();
        b.push(&IDENTITY, &cmd(json!(["A", 10, 20, 5, 0, 1.5, 0])))
            .unwrap();
        let Seg::Cubic(.., x, y) = *b.segs.last().unwrap() else {
            panic!("{:?}", b.segs)
        };
        assert!((x - (10.0 + 5.0 * 1.5f64.cos())).abs() < 1e-9);
        assert!((y - (20.0 + 5.0 * 1.5f64.sin())).abs() < 1e-9);
    }

    #[test]
    fn arc_to_rounds_a_corner() {
        let mut b = Builder::default();
        b.push(&IDENTITY, &cmd(json!(["M", 0, 0]))).unwrap();
        b.push(&IDENTITY, &cmd(json!(["T", 10, 0, 10, 10, 4])))
            .unwrap();
        let Seg::Line(lx, ly) = b.segs[1] else {
            panic!("{:?}", b.segs)
        };
        assert!((lx - 6.0).abs() < 1e-9 && ly.abs() < 1e-9, "{lx},{ly}");
        let Seg::Cubic(.., x, y) = *b.segs.last().unwrap() else {
            panic!()
        };
        assert!((x - 10.0).abs() < 1e-9 && (y - 4.0).abs() < 1e-9, "{x},{y}");
    }
}
