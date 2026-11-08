//! Layer grids matching the JavaScript renderer's buildGrid.

use crate::rig::FineGrid;
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Grid {
    pub rect: [f64; 4],
    pub cols: usize,
    pub rows: usize,
    pub rest: Vec<f32>,
    pub uv: Vec<f32>,
    pub pos: Vec<f32>,
    pub tris: Vec<u32>,
    pub lines: Vec<u32>,
}

fn axis(start: f64, len: f64, cell: f64, fine: Option<(f64, f64, f64)>) -> Result<Vec<f64>> {
    let mut out = vec![start];
    let mut v = start;
    while v < start + len - 0.5 {
        let c = fine
            .filter(|&(from, to, _)| v >= from && v < to)
            .map_or(cell, |(_, _, cell)| cell);
        let next = (start + len).min(v + c);
        ensure!(next > v, "grid step is below coordinate precision");
        v = next;
        out.push(v);
    }
    Ok(out)
}

pub fn build_grid(
    rect: [f64; 4],
    cell: f64,
    alpha: &[u8],
    alpha_width: usize,
    fine: Option<&FineGrid>,
) -> Result<Grid> {
    let [rx, ry, rw, rh] = rect;
    ensure!(
        rect.iter().all(|v| v.is_finite()) && rw > 0.0 && rh > 0.0,
        "invalid grid rectangle"
    );
    ensure!(
        cell.is_finite() && cell >= 1.0,
        "grid cell must be at least one pixel"
    );
    ensure!(
        alpha_width > 0 && !alpha.is_empty() && alpha.len().is_multiple_of(alpha_width),
        "invalid alpha dimensions"
    );
    if let Some(fine) = fine {
        ensure!(fine.cell > 0, "fine cell must be positive");
    }
    // Bound allocation and ensure every index fits the JS Uint32Array representation.
    ensure!(
        rw <= 65535.0 && rh <= 65535.0,
        "grid dimensions exceed limits"
    );
    let xs = axis(
        rx,
        rw,
        cell,
        fine.map(|f| (f.x0 as f64, f.x1 as f64, f.cell as f64)),
    )?;
    let ys = axis(
        ry,
        rh,
        cell,
        fine.map(|f| (f.y0 as f64, f.y1 as f64, f.cell as f64)),
    )?;
    let cols = xs.len() - 1;
    let rows = ys.len() - 1;
    let count = xs
        .len()
        .checked_mul(ys.len())
        .filter(|&n| n <= 4_000_000)
        .ok_or_else(|| anyhow::anyhow!("grid has too many vertices"))?;
    let mut rest = Vec::with_capacity(count * 2);
    let mut uv = Vec::with_capacity(count * 2);
    for &y in &ys {
        for &x in &xs {
            rest.extend([x as f32, y as f32]);
            uv.extend([((x - rx) / rw) as f32, ((y - ry) / rh) as f32]);
        }
    }
    let mut tris = Vec::new();
    let mut lines = Vec::new();
    let alpha_height = alpha.len() / alpha_width;
    let ax = if alpha_width == 1 { 0.0 } else { 1.0 };
    for j in 0..rows {
        for i in 0..cols {
            let x0 = (((xs[i] - rx).floor() * ax - 2.0).max(0.0) as usize).min(alpha_width);
            let x1 = (((xs[i + 1] - rx).ceil() * ax + 2.0).max(0.0) as usize).min(alpha_width);
            let y0 = (((ys[j] - ry).floor() * ax - 2.0).max(0.0) as usize).min(alpha_height);
            let y1 = (((ys[j + 1] - ry).ceil() * ax + 2.0).max(0.0) as usize).min(alpha_height);
            let any = (y0..y1).any(|y| {
                alpha[y * alpha_width + x0..y * alpha_width + x1]
                    .iter()
                    .any(|&a| a > 3)
            });
            if !any {
                continue;
            }
            let a = (j * (cols + 1) + i) as u32;
            let b = a + 1;
            let c = a + cols as u32 + 1;
            let d = c + 1;
            tris.extend([a, b, c, b, d, c]);
            lines.extend([a, b, a, c, b, c]);
            if i == cols - 1 {
                lines.extend([b, d]);
            }
            if j == rows - 1 {
                lines.extend([c, d]);
            }
        }
    }
    Ok(Grid {
        rect,
        cols,
        rows,
        pos: rest.clone(),
        rest,
        uv,
        tris,
        lines,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_standin_and_alpha_threshold() {
        let grid = build_grid([10.0, 20.0, 4.0, 4.0], 2.0, &[255], 1, None).unwrap();
        assert_eq!((grid.cols, grid.rows), (2, 2));
        assert_eq!(grid.tris.len(), 24);
        assert_eq!(&grid.tris[..6], &[0, 1, 3, 1, 4, 3]);
        assert_eq!(grid.pos, grid.rest);
        assert!(build_grid([0.0, 0.0, 4.0, 4.0], 2.0, &[3], 1, None)
            .unwrap()
            .tris
            .is_empty());
        assert_eq!(
            build_grid([0.0, 0.0, 4.0, 4.0], 2.0, &[4], 1, None)
                .unwrap()
                .tris
                .len(),
            24
        );
    }

    #[test]
    fn rejects_invalid_input() {
        assert!(build_grid([0.0, 0.0, 4.0, 4.0], 0.0, &[255], 1, None).is_err());
        assert!(build_grid([0.0, 0.0, 4.0, 4.0], 2.0, &[255], 0, None).is_err());
        assert!(build_grid([1e16, 0.0, 4.0, 4.0], 1.0, &[255], 1, None).is_err());
    }
}
