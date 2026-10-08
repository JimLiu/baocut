//! SVG path 解析 → 折线，供描边生长（pathDraw）、填充与路径裁剪采样。
//!
//! 命令集：`M L H V A C S Q T Z` 及各自的相对（小写）形式。弧线按规范 F.6.5
//! 端点参数转圆心参数；贝塞尔在**路径自身坐标系**里按固定规则预采样
//! （[`CURVE_TOLERANCE_VERSION`]），因此拓扑不随输出分辨率变化。
//! 不认识的命令字母不再静默跳过：[`parse_checked`] 把它们收集出来，
//! `bcut lint` 报 `path-command-unsupported`。

/// 曲线预采样规则的版本号。改采样密度会改几何摘要，必须连同 golden 一起升。
pub const CURVE_TOLERANCE_VERSION: u32 = 1;

/// 解析结果：折线子路径 + 不认识的命令字母（按首次出现序去重）。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Parsed {
    pub subpaths: Vec<Vec<(f64, f64)>>,
    pub unsupported: Vec<char>,
}

pub fn parse(d: &str) -> Vec<Vec<(f64, f64)>> {
    parse_checked(d).subpaths
}

/// Arc-length slice across subpaths; gaps never become connecting segments.
pub fn slice(subpaths: &[Vec<(f64, f64)>], start: f64, end: f64) -> Vec<Vec<(f64, f64)>> {
    if end <= start {
        return Vec::new();
    }
    let (mut out, mut distance) = (Vec::new(), 0.0);
    for poly in subpaths {
        let mut piece = Vec::new();
        for pair in poly.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            let len = dist(a, b);
            if len <= 0.0 {
                continue;
            }
            let next = distance + len;
            if end > distance && start < next {
                let at = |d: f64| {
                    if d <= distance {
                        a
                    } else if d >= next {
                        b
                    } else {
                        let u = (d - distance) / len;
                        (a.0 + (b.0 - a.0) * u, a.1 + (b.1 - a.1) * u)
                    }
                };
                if piece.is_empty() {
                    piece.push(at(start));
                }
                piece.push(at(end));
            }
            distance = next;
            if distance >= end {
                break;
            }
        }
        if piece.len() > 1 {
            out.push(piece);
        }
        if distance >= end {
            break;
        }
    }
    out
}

/// Position and unit tangent. Out-of-range distances clamp to the path ends.
pub fn point_at(
    subpaths: &[Vec<(f64, f64)>],
    mut distance: f64,
) -> Option<((f64, f64), (f64, f64))> {
    distance = distance.max(0.0);
    let mut last = None;
    for poly in subpaths {
        for pair in poly.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            let len = dist(a, b);
            if len <= 0.0 {
                continue;
            }
            let tangent = ((b.0 - a.0) / len, (b.1 - a.1) / len);
            if distance <= len {
                let u = distance / len;
                return Some(((a.0 + (b.0 - a.0) * u, a.1 + (b.1 - a.1) * u), tangent));
            }
            distance -= len;
            last = Some((b, tangent));
        }
    }
    last.or_else(|| {
        subpaths
            .iter()
            .find_map(|poly| poly.first().copied())
            .map(|p| (p, (1.0, 0.0)))
    })
}

fn tokenize(d: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut buf = String::new();
    for ch in d.chars() {
        let exp = buf.ends_with('e') || buf.ends_with('E');
        if ch.is_ascii_alphabetic() && !((ch == 'e' || ch == 'E') && !buf.is_empty()) {
            if !buf.is_empty() {
                tokens.push(std::mem::take(&mut buf));
            }
            tokens.push(ch.to_string());
        } else if ch.is_whitespace() || ch == ',' {
            if !buf.is_empty() {
                tokens.push(std::mem::take(&mut buf));
            }
        } else if (ch == '-' || ch == '+') && !buf.is_empty() && !exp {
            tokens.push(std::mem::take(&mut buf));
            buf.push(ch);
        } else if ch == '.' && buf.contains('.') && !exp {
            // "1.5.5" ⇒ 1.5 与 .5
            tokens.push(std::mem::take(&mut buf));
            buf.push(ch);
        } else {
            buf.push(ch);
        }
    }
    if !buf.is_empty() {
        tokens.push(buf);
    }
    tokens
}

fn is_command(token: &str) -> Option<char> {
    let mut chars = token.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) if c.is_ascii_alphabetic() => Some(c),
        _ => None,
    }
}

/// 贝塞尔段数：按控制多边形长度取，夹在 [8, 64]；单位是路径自身坐标。
fn curve_steps(poly_len: f64) -> usize {
    ((poly_len / 3.0).ceil() as usize).clamp(8, 64)
}

fn dist(a: (f64, f64), b: (f64, f64)) -> f64 {
    ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt()
}

fn cubic_points(p0: (f64, f64), p1: (f64, f64), p2: (f64, f64), p3: (f64, f64)) -> Vec<(f64, f64)> {
    let n = curve_steps(dist(p0, p1) + dist(p1, p2) + dist(p2, p3));
    (1..=n)
        .map(|k| {
            let t = k as f64 / n as f64;
            let u = 1.0 - t;
            let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
            (
                a * p0.0 + b * p1.0 + c * p2.0 + d * p3.0,
                a * p0.1 + b * p1.1 + c * p2.1 + d * p3.1,
            )
        })
        .collect()
}

fn quad_points(p0: (f64, f64), p1: (f64, f64), p2: (f64, f64)) -> Vec<(f64, f64)> {
    let n = curve_steps(dist(p0, p1) + dist(p1, p2));
    (1..=n)
        .map(|k| {
            let t = k as f64 / n as f64;
            let u = 1.0 - t;
            (
                u * u * p0.0 + 2.0 * u * t * p1.0 + t * t * p2.0,
                u * u * p0.1 + 2.0 * u * t * p1.1 + t * t * p2.1,
            )
        })
        .collect()
}

pub fn parse_checked(d: &str) -> Parsed {
    let tokens = tokenize(d);
    let mut subpaths: Vec<Vec<(f64, f64)>> = Vec::new();
    let mut unsupported: Vec<char> = Vec::new();
    let mut current: Vec<(f64, f64)> = Vec::new();
    let mut cur = (0.0f64, 0.0f64);
    let mut start = (0.0f64, 0.0f64);
    // 上一段贝塞尔的「反射用」控制点（S / T 用）；非曲线命令后失效。
    let mut last_cubic: Option<(f64, f64)> = None;
    let mut last_quad: Option<(f64, f64)> = None;

    let mut i = 0usize;
    let num = |i: &mut usize| -> f64 {
        let v = tokens.get(*i).and_then(|t| t.parse().ok()).unwrap_or(0.0);
        *i += 1;
        v
    };

    let mut cmd = ' ';
    while i < tokens.len() {
        if let Some(c) = is_command(&tokens[i]) {
            cmd = c;
            i += 1;
            if !"MmLlHhVvAaCcSsQqTtZz".contains(c) {
                if !unsupported.contains(&c) {
                    unsupported.push(c);
                }
                // 跳过它的参数，直到下一个命令字母。
                while i < tokens.len() && is_command(&tokens[i]).is_none() {
                    i += 1;
                }
                cmd = ' ';
                continue;
            }
            if c == 'Z' || c == 'z' {
                if current.len() > 1 {
                    if current.last() != Some(&start) {
                        current.push(start);
                    }
                    subpaths.push(std::mem::take(&mut current));
                } else {
                    current.clear();
                }
                cur = start;
                last_cubic = None;
                last_quad = None;
                cmd = ' ';
                continue;
            }
        } else if cmd == ' ' {
            i += 1; // 命令缺失的游离数字：丢弃，避免死循环
            continue;
        }
        let rel = cmd.is_ascii_lowercase();
        let (ox, oy) = if rel { cur } else { (0.0, 0.0) };
        // Z 之后不带 M 直接续画：从起点新开一条子路径。
        if current.is_empty() && !matches!(cmd, 'M' | 'm') {
            current.push(cur);
        }
        match cmd.to_ascii_uppercase() {
            'M' => {
                if current.len() > 1 {
                    subpaths.push(std::mem::take(&mut current));
                } else {
                    current.clear();
                }
                cur = (ox + num(&mut i), oy + num(&mut i));
                start = cur;
                current.push(cur);
                cmd = if rel { 'l' } else { 'L' }; // M 后续坐标按 L 处理
                last_cubic = None;
                last_quad = None;
            }
            'L' => {
                cur = (ox + num(&mut i), oy + num(&mut i));
                current.push(cur);
                last_cubic = None;
                last_quad = None;
            }
            'H' => {
                cur = (ox + num(&mut i), cur.1);
                current.push(cur);
                last_cubic = None;
                last_quad = None;
            }
            'V' => {
                cur = (cur.0, oy + num(&mut i));
                current.push(cur);
                last_cubic = None;
                last_quad = None;
            }
            'A' => {
                let rx = num(&mut i);
                let ry = num(&mut i);
                let rot = num(&mut i);
                let large_arc = num(&mut i) != 0.0;
                let sweep = num(&mut i) != 0.0;
                let end = (ox + num(&mut i), oy + num(&mut i));
                current.extend(arc_points(cur, end, rx, ry, rot, large_arc, sweep));
                cur = end;
                last_cubic = None;
                last_quad = None;
            }
            'C' | 'S' => {
                let c1 = if cmd.to_ascii_uppercase() == 'C' {
                    (ox + num(&mut i), oy + num(&mut i))
                } else {
                    match last_cubic {
                        Some(prev) => (2.0 * cur.0 - prev.0, 2.0 * cur.1 - prev.1),
                        None => cur,
                    }
                };
                let c2 = (ox + num(&mut i), oy + num(&mut i));
                let end = (ox + num(&mut i), oy + num(&mut i));
                current.extend(cubic_points(cur, c1, c2, end));
                cur = end;
                last_cubic = Some(c2);
                last_quad = None;
            }
            'Q' | 'T' => {
                let c1 = if cmd.to_ascii_uppercase() == 'Q' {
                    (ox + num(&mut i), oy + num(&mut i))
                } else {
                    match last_quad {
                        Some(prev) => (2.0 * cur.0 - prev.0, 2.0 * cur.1 - prev.1),
                        None => cur,
                    }
                };
                let end = (ox + num(&mut i), oy + num(&mut i));
                current.extend(quad_points(cur, c1, end));
                cur = end;
                last_quad = Some(c1);
                last_cubic = None;
            }
            _ => {
                i += 1;
            }
        }
    }
    if current.len() > 1 {
        subpaths.push(current);
    }
    Parsed {
        subpaths,
        unsupported,
    }
}

/// SVG 端点参数 → 圆心参数，采样为折线（不含起点）
fn arc_points(
    p1: (f64, f64),
    p2: (f64, f64),
    rx0: f64,
    ry0: f64,
    rot_deg: f64,
    large_arc: bool,
    sweep: bool,
) -> Vec<(f64, f64)> {
    let (mut rx, mut ry) = (rx0.abs(), ry0.abs());
    if rx == 0.0 || ry == 0.0 || (p1.0 == p2.0 && p1.1 == p2.1) {
        return vec![p2];
    }
    let phi = rot_deg * std::f64::consts::PI / 180.0;
    let (cos_phi, sin_phi) = (phi.cos(), phi.sin());
    let dx = (p1.0 - p2.0) / 2.0;
    let dy = (p1.1 - p2.1) / 2.0;
    let x1p = cos_phi * dx + sin_phi * dy;
    let y1p = -sin_phi * dx + cos_phi * dy;
    let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if lambda > 1.0 {
        let s = lambda.sqrt();
        rx *= s;
        ry *= s;
    }
    let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let mut coef = (num / den).max(0.0).sqrt();
    if large_arc == sweep {
        coef = -coef;
    }
    let cxp = coef * rx * y1p / ry;
    let cyp = -coef * ry * x1p / rx;
    let cx = cos_phi * cxp - sin_phi * cyp + (p1.0 + p2.0) / 2.0;
    let cy = sin_phi * cxp + cos_phi * cyp + (p1.1 + p2.1) / 2.0;

    fn angle(ux: f64, uy: f64, vx: f64, vy: f64) -> f64 {
        let dot = ux * vx + uy * vy;
        let len = ((ux * ux + uy * uy) * (vx * vx + vy * vy)).sqrt();
        let mut a = (dot / len).clamp(-1.0, 1.0).acos();
        if ux * vy - uy * vx < 0.0 {
            a = -a;
        }
        a
    }
    let theta1 = angle(1.0, 0.0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let mut d_theta = angle(
        (x1p - cxp) / rx,
        (y1p - cyp) / ry,
        (-x1p - cxp) / rx,
        (-y1p - cyp) / ry,
    );
    if !sweep && d_theta > 0.0 {
        d_theta -= 2.0 * std::f64::consts::PI;
    }
    if sweep && d_theta < 0.0 {
        d_theta += 2.0 * std::f64::consts::PI;
    }

    let n = ((d_theta.abs() / (std::f64::consts::PI / 64.0)).ceil() as usize).max(8);
    let mut pts = Vec::with_capacity(n);
    for k in 1..=n {
        let th = theta1 + d_theta * k as f64 / n as f64;
        let px = cx + rx * th.cos() * cos_phi - ry * th.sin() * sin_phi;
        let py = cy + rx * th.cos() * sin_phi + ry * th.sin() * cos_phi;
        pts.push((px, py));
    }
    pts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn polyline_len(polys: &[Vec<(f64, f64)>]) -> f64 {
        polys
            .iter()
            .map(|p| {
                p.windows(2)
                    .map(|w| ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt())
                    .sum::<f64>()
            })
            .sum()
    }

    #[test]
    fn full_circle_arc() {
        // 参考文档的 logo 圆环：半径 52 的近整圆
        let polys = parse("M60 8 A52 52 0 1 1 59.9 8");
        assert_eq!(polys.len(), 1);
        let len = polyline_len(&polys);
        let circumference = 2.0 * std::f64::consts::PI * 52.0;
        assert!(
            (len - circumference).abs() / circumference < 0.01,
            "len={len}"
        );
    }

    #[test]
    fn multi_subpath() {
        let polys =
            parse("M46 38 V84 M46 38 H63 A11 11 0 0 1 63 60 H46 M46 60 H66 A12 12 0 0 1 66 84 H46");
        assert_eq!(polys.len(), 3);
        assert!((polyline_len(std::slice::from_ref(&polys[0])) - 46.0).abs() < 1e-9); // V84: 84-38
    }

    #[test]
    fn close_and_relative() {
        let polys = parse("M10 10 l10 0 0 10 -10 0 z m20 0 h5 v5 Z");
        assert_eq!(polys.len(), 2);
        assert_eq!(
            polys[0],
            vec![
                (10.0, 10.0),
                (20.0, 10.0),
                (20.0, 20.0),
                (10.0, 20.0),
                (10.0, 10.0)
            ]
        );
        // m 相对的是 z 回到的起点 (10,10)
        assert_eq!(polys[1].first(), Some(&(30.0, 10.0)));
        assert_eq!(polys[1].last(), Some(&(30.0, 10.0)));
    }

    #[test]
    fn curves_end_on_endpoint_and_are_deterministic() {
        let a = parse("M0 0 C0 50 100 50 100 0 S200 -50 200 0 Q250 80 300 0 T400 0");
        let b = parse("M0 0 C0 50 100 50 100 0 S200 -50 200 0 Q250 80 300 0 T400 0");
        assert_eq!(a, b);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].last(), Some(&(400.0, 0.0)));
        assert!(a[0].len() > 32);
        // 半圆近似：C 的弧长应落在 100..157 之间
        let len = polyline_len(&parse("M0 0 C0 50 100 50 100 0"));
        assert!(len > 100.0 && len < 157.0, "len={len}");
    }

    #[test]
    fn unknown_commands_are_reported_not_skipped() {
        let parsed = parse_checked("M0 0 L10 0 X5 5 L10 10 B1 X2");
        assert_eq!(parsed.unsupported, vec!['X', 'B']);
        assert_eq!(
            parsed.subpaths,
            vec![vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)]]
        );
        assert!(
            parse_checked("M0 0 H5 V5 A1 1 0 0 1 6 6 Z")
                .unsupported
                .is_empty()
        );
    }

    #[test]
    fn compact_numbers() {
        assert_eq!(parse("M1.5.5L-1-2"), vec![vec![(1.5, 0.5), (-1.0, -2.0)]]);
        assert_eq!(
            parse("M1e1 2E0 L3e-1,4"),
            vec![vec![(10.0, 2.0), (0.3, 4.0)]]
        );
    }
}
