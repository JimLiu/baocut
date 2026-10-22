//! Bounded distances to original vector contours. Winding determines the sign;
//! internal same-direction contours remain distance sources (no Boolean union).
use anyhow::{Result, bail};
use tiny_skia::{Path, PathSegment};

const MAX_SEGMENTS: usize = 8192;
const MAX_INPUT_OPERATIONS: usize = 32768;
const MAX_DEPTH: u8 = 18;
type Point = [f64; 2];

#[derive(Clone, Debug)]
struct Segment {
    a: Point,
    b: Point,
    delta: Point,
    inverse_length_squared: f64,
}
#[derive(Clone, Debug)]
pub struct ContourDistance {
    segments: Vec<Segment>,
    bounds: [f64; 4],
}
impl ContourDistance {
    /// Flatten in the path's local coordinate system. The caller chooses a
    /// tolerance that bounds the desired output-space contour error.
    pub fn from_path(path: &Path, tolerance: f64) -> Result<Self> {
        if !tolerance.is_finite() || tolerance <= 0.0 || tolerance > 256.0 {
            bail!("GLYPH_DISTANCE_INVALID: flattening tolerance");
        }
        let r = path.bounds();
        let mut out = Self {
            segments: Vec::new(),
            bounds: [
                f64::from(r.left()),
                f64::from(r.top()),
                f64::from(r.right()),
                f64::from(r.bottom()),
            ],
        };
        if !out
            .bounds
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 1_000_000.0)
        {
            bail!("GLYPH_DISTANCE_INVALID: contour bounds");
        }
        let mut first = None;
        let mut current = None;
        for (operations, part) in path.segments().enumerate() {
            if operations >= MAX_INPUT_OPERATIONS {
                bail!("GLYPH_DISTANCE_BUDGET_EXCEEDED: input operations");
            }
            let p = |p: tiny_skia::Point| -> Result<Point> {
                let p = [f64::from(p.x), f64::from(p.y)];
                if !p.iter().all(|v| v.is_finite() && v.abs() <= 1_000_000.0) {
                    bail!("GLYPH_DISTANCE_INVALID: contour point");
                }
                Ok(p)
            };
            match part {
                PathSegment::MoveTo(to) => {
                    if let (Some(a), Some(b)) = (current, first) {
                        out.line(a, b)?;
                    }
                    let to = p(to)?;
                    first = Some(to);
                    current = Some(to);
                }
                PathSegment::LineTo(to) => {
                    let to = p(to)?;
                    if let Some(from) = current {
                        out.line(from, to)?;
                    }
                    current = Some(to);
                }
                PathSegment::QuadTo(control, to) => {
                    let (control, to) = (p(control)?, p(to)?);
                    if let Some(from) = current {
                        out.quad(from, control, to, tolerance, 0)?;
                    }
                    current = Some(to);
                }
                PathSegment::CubicTo(c1, c2, to) => {
                    let (c1, c2, to) = (p(c1)?, p(c2)?, p(to)?);
                    if let Some(from) = current {
                        out.cubic(from, c1, c2, to, tolerance, 0)?;
                    }
                    current = Some(to);
                }
                PathSegment::Close => {
                    if let (Some(a), Some(b)) = (current, first) {
                        out.line(a, b)?;
                    }
                    current = first;
                }
            }
        }
        if let (Some(a), Some(b)) = (current, first) {
            out.line(a, b)?;
        }
        Ok(out)
    }
    pub fn segment_count(&self) -> usize {
        self.segments.len()
    }
    pub fn storage_bytes(&self) -> usize {
        self.segments.capacity() * std::mem::size_of::<Segment>()
    }
    pub fn bounds(&self) -> [f64; 4] {
        self.bounds
    }
    pub fn is_empty(&self) -> bool {
        self.segments.is_empty()
    }

    pub fn sample(&self, point: Point) -> Result<f64> {
        if self.is_empty()
            || !point
                .iter()
                .all(|v| v.is_finite() && v.abs() <= 1_000_000.0)
        {
            bail!("GLYPH_DISTANCE_INVALID: empty contour or sample point");
        }
        let mut nearest = f64::INFINITY;
        let mut winding = 0_i32;
        for edge in &self.segments {
            let relative = [point[0] - edge.a[0], point[1] - edge.a[1]];
            let t = ((relative[0] * edge.delta[0] + relative[1] * edge.delta[1])
                * edge.inverse_length_squared)
                .clamp(0.0, 1.0);
            let dx = relative[0] - t * edge.delta[0];
            let dy = relative[1] - t * edge.delta[1];
            nearest = nearest.min(dx * dx + dy * dy);
            let cross = edge.delta[0] * relative[1] - edge.delta[1] * relative[0];
            if edge.a[1] <= point[1] {
                if edge.b[1] > point[1] && cross > 0.0 {
                    winding += 1;
                }
            } else if edge.b[1] <= point[1] && cross < 0.0 {
                winding -= 1;
            }
        }
        if !nearest.is_finite() {
            bail!("GLYPH_DISTANCE_INVALID: sample overflow");
        }
        let distance = libm::sqrt(nearest);
        Ok(if winding == 0 { -distance } else { distance })
    }
    fn line(&mut self, a: Point, b: Point) -> Result<()> {
        if a == b {
            return Ok(());
        }
        if self.segments.len() >= MAX_SEGMENTS {
            bail!("GLYPH_DISTANCE_BUDGET_EXCEEDED: flattened segments");
        }
        let delta = [b[0] - a[0], b[1] - a[1]];
        let length = delta[0] * delta[0] + delta[1] * delta[1];
        if !length.is_finite() || length <= 0.0 || !(1.0 / length).is_finite() {
            bail!("GLYPH_DISTANCE_INVALID: contour segment");
        }
        self.segments.push(Segment {
            a,
            b,
            delta,
            inverse_length_squared: 1.0 / length,
        });
        Ok(())
    }
    fn quad(&mut self, a: Point, c: Point, b: Point, tolerance: f64, depth: u8) -> Result<()> {
        if distance_squared(c, a, b) <= tolerance * tolerance {
            return self.line(a, b);
        }
        if depth >= MAX_DEPTH {
            bail!("GLYPH_DISTANCE_BUDGET_EXCEEDED: curve subdivision");
        }
        let ac = midpoint(a, c);
        let cb = midpoint(c, b);
        let middle = midpoint(ac, cb);
        self.quad(a, ac, middle, tolerance, depth + 1)?;
        self.quad(middle, cb, b, tolerance, depth + 1)
    }
    fn cubic(
        &mut self,
        a: Point,
        c1: Point,
        c2: Point,
        b: Point,
        tolerance: f64,
        depth: u8,
    ) -> Result<()> {
        if distance_squared(c1, a, b).max(distance_squared(c2, a, b)) <= tolerance * tolerance {
            return self.line(a, b);
        }
        if depth >= MAX_DEPTH {
            bail!("GLYPH_DISTANCE_BUDGET_EXCEEDED: curve subdivision");
        }
        let ac = midpoint(a, c1);
        let cc = midpoint(c1, c2);
        let cb = midpoint(c2, b);
        let left = midpoint(ac, cc);
        let right = midpoint(cc, cb);
        let middle = midpoint(left, right);
        self.cubic(a, ac, left, middle, tolerance, depth + 1)?;
        self.cubic(middle, right, cb, b, tolerance, depth + 1)
    }
}
fn midpoint(a: Point, b: Point) -> Point {
    [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]
}
fn distance_squared(p: Point, a: Point, b: Point) -> f64 {
    let d = [b[0] - a[0], b[1] - a[1]];
    let q = [p[0] - a[0], p[1] - a[1]];
    let length = d[0] * d[0] + d[1] * d[1];
    let t = if length == 0.0 {
        0.0
    } else {
        ((q[0] * d[0] + q[1] * d[1]) / length).clamp(0.0, 1.0)
    };
    (q[0] - t * d[0]).powi(2) + (q[1] - t * d[1]).powi(2)
}
