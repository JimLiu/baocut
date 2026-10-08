//! 值噪声与 fbm：格点哈希 + smoothstep 插值，银河与云共用。无周期、无状态。
use super::unit;

fn lattice(seed: u64, ix: i64, iy: i64) -> f64 {
    unit(
        seed,
        (ix as u64).wrapping_mul(0x9E37_79B1) ^ (iy as u64),
        0x6E6F_6973,
    )
}

fn fade(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

/// 单层值噪声 ∈ [0, 1)。
pub(crate) fn value(seed: u64, x: f64, y: f64) -> f64 {
    let (fx, fy) = (libm::floor(x), libm::floor(y));
    let (ix, iy) = (fx as i64, fy as i64);
    let (tx, ty) = (fade(x - fx), fade(y - fy));
    let a = lattice(seed, ix, iy);
    let b = lattice(seed, ix + 1, iy);
    let c = lattice(seed, ix, iy + 1);
    let d = lattice(seed, ix + 1, iy + 1);
    let top = a + (b - a) * tx;
    let bottom = c + (d - c) * tx;
    top + (bottom - top) * ty
}

/// `octaves` 层分形和，归一到 [0, 1)。
pub(crate) fn fbm(seed: u64, x: f64, y: f64, octaves: u32) -> f64 {
    let (mut sum, mut amp, mut norm, mut freq) = (0.0, 1.0, 0.0, 1.0);
    for octave in 0..octaves {
        sum += amp
            * value(
                seed.wrapping_add(u64::from(octave) * 131),
                x * freq,
                y * freq,
            );
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
    }
    sum / norm
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn value_noise_is_continuous_and_bounded() {
        for i in 0..200 {
            let x = i as f64 * 0.173 - 11.0;
            let y = i as f64 * 0.071 - 3.0;
            let v = fbm(5, x, y, 5);
            assert!((0.0..1.0).contains(&v));
            let dv = (value(5, x + 1e-4, y) - value(5, x, y)).abs();
            assert!(dv < 1e-2, "{dv}");
        }
    }
}
