//! `transition.inkBlot@1`：一团墨从圆心洇开——`circleCrop` 加上带 seed 的毛边。
//!
//! 沿用同一条扫掠式，只把「到圆心的距离」按**方向**取的噪声放缩：
//! `u = d·(1 + r·(2n(dir) − 1))`，`n ∈ [0, 1]`——墨团的形状固定，只是整体变大。噪声是二维 value noise，取样点是单位方向向量，
//! 全程只有加减乘除与 `sqrt`（没有 `sin` / `atan2`），所以跨平台逐字节一致。

use super::{composite_by_coverage, sweep_coverage, sweep_edge};
use motion::rng::splitmix64_unit;

fn lattice(seed: u64, ix: i64, iy: i64) -> f64 {
    // 方向向量乘频率后落在很小的整数范围里，线性编号不会撞格
    splitmix64_unit(seed, ix * 4099 + iy)
}

fn value_noise(seed: u64, x: f64, y: f64) -> f64 {
    let (fx, fy) = (x.floor(), y.floor());
    let (ix, iy) = (fx as i64, fy as i64);
    let (tx, ty) = (x - fx, y - fy);
    let (sx, sy) = (tx * tx * (3.0 - 2.0 * tx), ty * ty * (3.0 - 2.0 * ty));
    let top = lattice(seed, ix, iy) * (1.0 - sx) + lattice(seed, ix + 1, iy) * sx;
    let bottom = lattice(seed, ix, iy + 1) * (1.0 - sx) + lattice(seed, ix + 1, iy + 1) * sx;
    top * (1.0 - sy) + bottom * sy
}

/// 方向噪声，`[0, 1]`。两个倍频：大的管「几瓣」，小的管毛刺。
fn edge_noise(seed: u64, dir_x: f64, dir_y: f64) -> f64 {
    0.65 * value_noise(seed, dir_x * 1.7 + 11.0, dir_y * 1.7 + 11.0)
        + 0.35
            * value_noise(
                seed ^ 0x9e37_79b9_7f4a_7c15,
                dir_x * 5.3 + 23.0,
                dir_y * 5.3 + 23.0,
            )
}

#[allow(clippy::too_many_arguments)]
pub fn ink_blot(
    from: &[u8],
    to: &[u8],
    out: &mut [u8],
    width: u32,
    height: u32,
    cx: f64,
    cy: f64,
    softness: f64,
    roughness: f64,
    seed: u64,
    invert: bool,
    progress: f64,
) {
    let (w, h) = (f64::from(width), f64::from(height));
    let (center_x, center_y) = (cx.clamp(0.0, 1.0) * w, cy.clamp(0.0, 1.0) * h);
    let softness = softness.max(0.0);
    let roughness = roughness.clamp(0.0, 0.9);
    // 每个像素的 u 只算一遍；扫掠跨度取全画面 u 的最大值，这样 progress 均匀地
    // 铺满 [0, 1]，而 progress = 0 / 1 时整幅画面仍然逐字节等于 from / to。
    let mut field = Vec::with_capacity((width as usize) * (height as usize));
    let mut span = 0.0f64;
    for y in 0..height {
        for x in 0..width {
            let (dx, dy) = (f64::from(x) - center_x, f64::from(y) - center_y);
            let distance = (dx * dx + dy * dy).sqrt();
            let noise = if distance > 0.0 {
                edge_noise(seed, dx / distance, dy / distance)
            } else {
                0.5
            };
            let u = distance * (1.0 + roughness * (2.0 * noise - 1.0));
            span = span.max(u);
            field.push(u);
        }
    }
    let edge = sweep_edge(progress, span, softness);
    composite_by_coverage(from, to, out, width, height, |x, y| {
        let u = field[(y * width + x) as usize];
        sweep_coverage(edge, if invert { span - u } else { u }, softness)
    });
}
