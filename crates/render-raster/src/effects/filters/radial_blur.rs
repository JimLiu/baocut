//! `filter.radialBlur@1`：径向（zoom）模糊——每个像素沿「像素 → 中心」的连线取样
//! 平均，离中心越远拖得越长，中心点本身不动。
//!
//! 实现是三遍对数步长的缩放取样（`filter.godRays` 共用 [`zoom_passes`]）：以中心为原点，
//! 取样点 `c + (p − c)·e^{−o}`，`o` 是对数缩放量。第 k 遍（k = 1, 2, 3）取
//! `o = j·σ/Tᵏ, j = 0..T`，三遍复合后的 `o` 恰好是 `[0, σ)` 上步长 `σ/T³` 的 T³ 个
//! 均匀点——每像素只做 3T 次双线性取样，得到 T³ 个采样点的效果。
//! `σ = −ln(1 − strength)`：`strength` 是最远取样点朝中心走过的比例。
//!
//! 数值：f32 四则运算，`e^{−o}` 与权重在进像素循环前用 `libm` 各算一次（每遍 T 个），
//! native 与 wasm 逐位一致。像素约定与其余滤镜相同：预乘 sRGB / u8。

pub(crate) type Px = [f32; 4];

/// 遍数：T³ 个等效采样点。
const PASSES: u32 = 3;

pub(crate) fn to_planes(data: &[u8]) -> Vec<Px> {
    data.chunks_exact(4)
        .map(|px| {
            [
                f32::from(px[0]),
                f32::from(px[1]),
                f32::from(px[2]),
                f32::from(px[3]),
            ]
        })
        .collect()
}

/// 双线性取样；坐标是像素中心为整数的连续坐标，边缘夹取。
#[inline]
pub(crate) fn bilinear(buf: &[Px], width: usize, height: usize, x: f32, y: f32) -> Px {
    let x = x.clamp(0.0, (width - 1) as f32);
    let y = y.clamp(0.0, (height - 1) as f32);
    let (fx, fy) = (x.floor(), y.floor());
    let (tx, ty) = (x - fx, y - fy);
    let (x0, y0) = (fx as usize, fy as usize);
    let (x1, y1) = ((x0 + 1).min(width - 1), (y0 + 1).min(height - 1));
    let (a, b) = (buf[y0 * width + x0], buf[y0 * width + x1]);
    let (c, d) = (buf[y1 * width + x0], buf[y1 * width + x1]);
    let mut out = [0.0f32; 4];
    for k in 0..4 {
        let top = a[k] + (b[k] - a[k]) * tx;
        let bottom = c[k] + (d[k] - c[k]) * tx;
        out[k] = top + (bottom - top) * ty;
    }
    out
}

/// 三遍对数步长缩放取样。`center` 是像素坐标（像素中心为 `x + 0.5`，可以在画面外），
/// `sigma` 是总对数缩放量，`taps` 是每遍取样数，`far_weight` 是最远取样点相对
/// 最近取样点的权重（1 = 等权平均，越小越偏向近处——光柱的衰减）。各遍权重都归一，
/// 复合后仍是加权平均。
pub(crate) fn zoom_passes(
    buf: &mut Vec<Px>,
    width: usize,
    height: usize,
    center: (f64, f64),
    sigma: f64,
    taps: u32,
    far_weight: f64,
) {
    if width == 0 || height == 0 || sigma <= 0.0 || taps < 2 {
        return;
    }
    let far_weight = far_weight.clamp(1e-4, 1.0);
    let (cx, cy) = (center.0 as f32, center.1 as f32);
    let mut scratch: Vec<Px> = vec![[0.0; 4]; buf.len()];
    let mut step = sigma;
    for _ in 0..PASSES {
        step /= f64::from(taps);
        let mut factors = Vec::with_capacity(taps as usize);
        let mut weights = Vec::with_capacity(taps as usize);
        for j in 0..taps {
            let offset = f64::from(j) * step;
            factors.push(libm::exp(-offset) as f32);
            // (far_weight)^(offset / σ)
            weights.push(libm::exp(libm::log(far_weight) * offset / sigma));
        }
        let total: f64 = weights.iter().sum();
        let weights: Vec<f32> = weights.iter().map(|w| (w / total) as f32).collect();
        for y in 0..height {
            let py = y as f32 + 0.5 - cy;
            for x in 0..width {
                let px = x as f32 + 0.5 - cx;
                let mut acc = [0.0f32; 4];
                for (factor, weight) in factors.iter().zip(&weights) {
                    let sx = cx + px * factor - 0.5;
                    let sy = cy + py * factor - 0.5;
                    let sample = bilinear(buf, width, height, sx, sy);
                    for k in 0..4 {
                        acc[k] += sample[k] * weight;
                    }
                }
                scratch[y * width + x] = acc;
            }
        }
        std::mem::swap(buf, &mut scratch);
    }
}

/// 写回 u8：四舍五入并保持预乘不变量（RGB ≤ alpha）。
pub(crate) fn store(data: &mut [u8], buf: &[Px]) {
    for (out, px) in data.chunks_exact_mut(4).zip(buf) {
        let alpha = px[3].clamp(0.0, 255.0).round();
        out[3] = alpha as u8;
        for k in 0..3 {
            out[k] = px[k].clamp(0.0, alpha).round() as u8;
        }
    }
}

/// 径向模糊。`cx` / `cy` 是画布（= 输入 surface）宽高的比例，`strength` ∈ [0, 0.95]
/// 是最远取样点朝中心走过的比例，`samples` 是每遍取样数（三遍）。
pub fn radial_blur(
    data: &mut [u8],
    width: usize,
    height: usize,
    cx: f64,
    cy: f64,
    strength: f64,
    samples: f64,
) {
    let strength = strength.clamp(0.0, 0.95);
    if width == 0 || height == 0 || strength <= 0.0 {
        return;
    }
    let taps = samples.round().clamp(2.0, 16.0) as u32;
    let sigma = -libm::log(1.0 - strength);
    let mut buf = to_planes(data);
    zoom_passes(
        &mut buf,
        width,
        height,
        (cx * width as f64, cy * height as f64),
        sigma,
        taps,
        1.0,
    );
    store(data, &buf);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dot(size: usize, at: (usize, usize)) -> Vec<u8> {
        let mut data = vec![0u8; size * size * 4];
        let offset = (at.1 * size + at.0) * 4;
        data[offset..offset + 4].copy_from_slice(&[255; 4]);
        data
    }

    #[test]
    fn zero_strength_is_the_identity() {
        let mut data = dot(16, (3, 5));
        let before = data.clone();
        radial_blur(&mut data, 16, 16, 0.5, 0.5, 0.0, 8.0);
        assert_eq!(data, before);
    }

    #[test]
    fn a_dot_smears_toward_the_center_only() {
        let size = 64;
        let mut data = dot(size, (56, 32));
        radial_blur(&mut data, size, size, 0.5, 0.5, 0.4, 8.0);
        let alpha = |x: usize, y: usize| data[(y * size + x) * 4 + 3];
        // 点在中心右侧：外侧（朝中心的反方向）有拖影，内侧没有。
        assert!(alpha(60, 32) > 0, "外侧应有拖影");
        assert_eq!(alpha(50, 32), 0, "内侧不应有拖影");
        assert_eq!(alpha(56, 20), 0, "垂直方向不应扩散");
    }

    #[test]
    fn the_center_pixel_stays_put() {
        let size = 33;
        let mut data = dot(size, (16, 16));
        radial_blur(&mut data, size, size, 0.5, 0.5, 0.6, 8.0);
        assert_eq!(
            &data[(16 * size + 16) * 4..(16 * size + 16) * 4 + 4],
            &[255; 4]
        );
    }
}
