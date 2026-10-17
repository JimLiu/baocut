//! Canvas 渐变里 tiny-skia 表达不了的部分：一般的两圆锥形径向渐变（起始圆半径 > 0 且圆心不同）
//! 逐像素求解成设备空间位图，再当 `Pattern` 画。

use super::path::{Mat, apply, invert};
use crate::drawop::BitmapData;

/// 色标：`(offset, [r, g, b, a])`，颜色是 0..1 的直通 RGBA，已按 offset 稳定排序。
pub type Stops = [(f64, [f64; 4])];

const LUT_SIZE: usize = 1024;

/// 色标在 `[0, 1]` 上的查找表（直通插值，输出预乘 RGBA8）。
fn lut(stops: &Stops) -> Vec<[u8; 4]> {
    (0..LUT_SIZE)
        .map(|i| {
            let t = i as f64 / (LUT_SIZE - 1) as f64;
            let c = color_at(stops, t);
            let a = c[3].clamp(0.0, 1.0);
            [
                (c[0].clamp(0.0, 1.0) * a * 255.0 + 0.5) as u8,
                (c[1].clamp(0.0, 1.0) * a * 255.0 + 0.5) as u8,
                (c[2].clamp(0.0, 1.0) * a * 255.0 + 0.5) as u8,
                (a * 255.0 + 0.5) as u8,
            ]
        })
        .collect()
}

pub fn color_at(stops: &Stops, t: f64) -> [f64; 4] {
    let Some(first) = stops.first() else {
        return [0.0; 4];
    };
    if t <= first.0 {
        return first.1;
    }
    for pair in stops.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        if t < b.0 {
            let span = b.0 - a.0;
            let f = if span <= 0.0 { 1.0 } else { (t - a.0) / span };
            return std::array::from_fn(|i| a.1[i] + (b.1[i] - a.1[i]) * f);
        }
    }
    stops.last().unwrap().1
}

/// HTML Canvas 的两圆锥形渐变在点 `p` 的参数 ω（取 r(ω) ≥ 0 的最大解），无解返回 `None`。
pub fn conical_omega(
    p: (f64, f64),
    c0: (f64, f64),
    r0: f64,
    c1: (f64, f64),
    r1: f64,
) -> Option<f64> {
    let (cdx, cdy) = (c1.0 - c0.0, c1.1 - c0.1);
    let (pdx, pdy) = (p.0 - c0.0, p.1 - c0.1);
    let dr = r1 - r0;
    let a = cdx * cdx + cdy * cdy - dr * dr;
    let b = pdx * cdx + pdy * cdy + r0 * dr;
    let c = pdx * pdx + pdy * pdy - r0 * r0;
    let valid = |w: f64| r0 + w * dr >= 0.0;
    if a.abs() < 1e-9 {
        if b.abs() < 1e-12 {
            return None;
        }
        let w = c / (2.0 * b);
        return valid(w).then_some(w);
    }
    let disc = b * b - a * c;
    if disc < 0.0 {
        return None;
    }
    let root = disc.sqrt();
    let (w1, w2) = ((b + root) / a, (b - root) / a);
    let (hi, lo) = if w1 >= w2 { (w1, w2) } else { (w2, w1) };
    if valid(hi) {
        Some(hi)
    } else if valid(lo) {
        Some(lo)
    } else {
        None
    }
}

/// 设备空间矩形 `region`（`[x, y, w, h]`，整数像素）里的渐变位图。`user_to_device` 是绘制时的变换。
pub fn conical_bitmap(
    c0: (f64, f64),
    r0: f64,
    c1: (f64, f64),
    r1: f64,
    stops: &Stops,
    user_to_device: &Mat,
    region: [i32; 4],
) -> Option<BitmapData> {
    let inv = invert(user_to_device)?;
    let [x0, y0, w, h] = region;
    if w <= 0 || h <= 0 {
        return None;
    }
    let table = lut(stops);
    let mut rgba = vec![0u8; w as usize * h as usize * 4];
    for (row, line) in rgba.chunks_exact_mut(w as usize * 4).enumerate() {
        let py = f64::from(y0) + row as f64 + 0.5;
        for (col, pixel) in line.chunks_exact_mut(4).enumerate() {
            let px = f64::from(x0) + col as f64 + 0.5;
            let p = apply(&inv, px, py);
            if let Some(omega) = conical_omega(p, c0, r0, c1, r1) {
                let index = (omega.clamp(0.0, 1.0) * (LUT_SIZE - 1) as f64 + 0.5) as usize;
                pixel.copy_from_slice(&table[index]);
            }
        }
    }
    Some(BitmapData {
        width: w as u32,
        height: h as u32,
        rgba: rgba.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concentric_omega_is_linear_in_distance() {
        let w = conical_omega((15.0, 0.0), (0.0, 0.0), 10.0, (0.0, 0.0), 20.0).unwrap();
        assert!((w - 0.5).abs() < 1e-12);
        let w = conical_omega((5.0, 0.0), (0.0, 0.0), 10.0, (0.0, 0.0), 20.0).unwrap();
        assert!((w + 0.5).abs() < 1e-12);
    }

    #[test]
    fn focal_gradient_starts_at_the_focus() {
        let w = conical_omega((3.0, 4.0), (3.0, 4.0), 0.0, (0.0, 0.0), 50.0).unwrap();
        assert!(w.abs() < 1e-12);
    }
}
