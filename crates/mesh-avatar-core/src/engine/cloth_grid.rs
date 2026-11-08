//! Source-space cloth topology shared by the solver and mesh skinning.
use crate::rig::{Cloth, Point};
use anyhow::{ensure, Result};
use serde::Serialize;

pub fn line_length(line: &[Point]) -> f64 {
    line.windows(2)
        .map(|p| (p[1][0] - p[0][0]).hypot(p[1][1] - p[0][1]))
        .sum()
}
pub fn sample_line(line: &[Point], fraction: f64) -> Point {
    let mut lengths = vec![0.0];
    for p in line.windows(2) {
        lengths.push(lengths.last().unwrap() + (p[1][0] - p[0][0]).hypot(p[1][1] - p[0][1]));
    }
    let distance = fraction.clamp(0.0, 1.0) * lengths.last().unwrap();
    let mut i = 1;
    while i < line.len() - 1 && lengths[i] < distance {
        i += 1;
    }
    let t = (distance - lengths[i - 1]) / (lengths[i] - lengths[i - 1]).max(1e-9);
    std::array::from_fn(|a| line[i - 1][a] + (line[i][a] - line[i - 1][a]) * t)
}
fn crossing_fraction(seam: &[Point], tier: &[Point]) -> Result<f64> {
    let mut walked = 0.0;
    let total = line_length(seam);
    let mut hits: Vec<f64> = vec![];
    for s in seam.windows(2) {
        let [a, b] = [s[0], s[1]];
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let length = dx.hypot(dy);
        for t in tier.windows(2) {
            let [c, d] = [t[0], t[1]];
            let (ex, ey) = (d[0] - c[0], d[1] - c[1]);
            let det = dx * ey - dy * ex;
            if det.abs() < 1e-9 {
                continue;
            }
            let u = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / det;
            let v = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / det;
            if (-1e-8..=1.0 + 1e-8).contains(&u) && (-1e-8..=1.0 + 1e-8).contains(&v) {
                let hit = (walked + u * length) / total;
                if !hits.iter().any(|h| (hit - h).abs() < 1e-7) {
                    hits.push(hit);
                }
            }
        }
        walked += length;
    }
    ensure!(
        hits.len() == 1,
        "Each tier must cross every column exactly once"
    );
    Ok(hits[0])
}
#[derive(Debug, Clone, Serialize)]
pub struct ClothGrid {
    pub custom: bool,
    pub cols: usize,
    pub rows: usize,
    pub rest: Vec<f64>,
    pub seams: Vec<Vec<Point>>,
    pub joints: Vec<Vec<f64>>,
    pub fractions: Vec<Vec<f64>>,
    pub lengths: Vec<f64>,
    pub top: Vec<Point>,
}
pub fn cloth_grid(c: &Cloth) -> Result<ClothGrid> {
    let custom = !c.seams.is_empty() || !c.tiers.is_empty();
    let cols = if c.seams.is_empty() {
        c.columns
    } else {
        c.seams.len()
    };
    ensure!(
        cols >= 2 && c.rows >= 2 && c.waist.len() >= 2 && c.hem.len() >= 2,
        "invalid cloth grid dimensions or lines"
    );
    // Keep malformed rigs from allocating unbounded solver or skinning buffers.
    ensure!(
        cols <= 65535 && c.rows <= 65535,
        "cloth grid dimensions exceed limits"
    );
    let seams: Vec<Vec<Point>> = if !c.seams.is_empty() {
        c.seams.clone()
    } else {
        (0..cols)
            .map(|k| {
                vec![
                    sample_line(&c.waist, k as f64 / (cols - 1) as f64),
                    sample_line(&c.hem, k as f64 / (cols - 1) as f64),
                ]
            })
            .collect()
    };
    ensure!(
        seams.iter().all(|s| s.len() >= 2),
        "cloth seams need at least two points"
    );
    let lengths: Vec<f64> = seams.iter().map(|s| line_length(s)).collect();
    ensure!(
        !custom || lengths.iter().all(|l| *l >= 1.0),
        "Columns must have nonzero source length"
    );
    let joints = seams
        .iter()
        .map(|line| {
            let mut js = vec![0.0];
            if c.tiers.is_empty() {
                js.push(0.5);
            } else {
                for tier in &c.tiers {
                    js.push(crossing_fraction(line, tier)?);
                }
            }
            js.push(1.0);
            ensure!(
                js.windows(2).all(|v| v[1] - v[0] >= 0.001),
                "Tier intersections must be ordered from waist to hem, with nonzero links"
            );
            Ok(js)
        })
        .collect::<Result<Vec<_>>>()?;
    let n = joints[0].len() - 1;
    let subdivisions = if custom {
        ((c.rows - 1) as f64 / n as f64).ceil().max(2.0) as usize
    } else {
        0
    };
    let rows = if custom { n * subdivisions + 1 } else { c.rows };
    let count = rows
        .checked_mul(cols)
        .filter(|n| *n <= 4_000_000)
        .ok_or_else(|| anyhow::anyhow!("cloth grid has too many vertices"))?;
    let mut rest = vec![0.0; count * 2];
    let mut fractions = vec![vec![]; cols];
    for k in 0..cols {
        for r in 0..rows {
            let segment = if custom {
                (r / subdivisions).min(n - 1)
            } else {
                0
            };
            let u = if custom {
                (r - segment * subdivisions) as f64 / subdivisions as f64
            } else {
                r as f64 / (rows - 1) as f64
            };
            let v = if custom {
                joints[k][segment] + (joints[k][segment + 1] - joints[k][segment]) * u
            } else {
                u
            };
            fractions[k].push(v);
            rest[(r * cols + k) * 2..(r * cols + k) * 2 + 2]
                .copy_from_slice(&sample_line(&seams[k], v));
        }
    }
    if custom {
        for r in 0..rows - 1 {
            for k in 0..cols - 1 {
                let a = (r * cols + k) * 2;
                let b = a + 2;
                let d = a + cols * 2;
                let c = d + 2;
                let cross = |i: usize, j: usize, l: usize| {
                    (rest[j] - rest[i]) * (rest[l + 1] - rest[i + 1])
                        - (rest[j + 1] - rest[i + 1]) * (rest[l] - rest[i])
                };
                ensure!(
                    cross(a, b, c) > 1e-6 && cross(a, c, d) > 1e-6,
                    "Columns must be ordered left to right without crossing"
                );
            }
        }
    }
    let top = seams.iter().map(|s| s[0]).collect();
    Ok(ClothGrid {
        custom,
        cols,
        rows,
        rest,
        seams,
        joints,
        fractions,
        lengths,
        top,
    })
}
