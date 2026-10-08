//! 播种随机：splitmix64（与 `bcut-motion::rng` 同一算法与常数），外加均匀 / 正态 / 指数分布。
//!
//! 每个合成器都从一个 `u64` 种子起一只 [`Rng`]，顺序抽样；没有全局状态，也不读系统熵。
//! 正态分布用 Box–Muller（`libm::log` / `sqrt` / `sincos`），两个一组、第二个缓存到下一次。

/// splitmix64 推进一步（Vigna 参考实现）。
pub fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// 把一个种子与一个「盐」混成新种子：同一乐器的第 k 个音、同一总线的第 k 次发声各拿一颗，
/// 互不相关，且与抽样顺序无关。
pub fn derive(seed: u64, salt: u64) -> u64 {
    let mut state = seed ^ salt.wrapping_mul(0xD1B5_4A32_D192_ED03);
    splitmix64(&mut state)
}

/// 顺序抽样的随机源。
#[derive(Clone, Debug)]
pub struct Rng {
    state: u64,
    spare: Option<f64>,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self {
            state: seed,
            spare: None,
        }
    }

    pub fn next_u64(&mut self) -> u64 {
        splitmix64(&mut self.state)
    }

    /// `[0, 1)`，53 位精度。
    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// `[lo, hi)` 均匀。
    pub fn uniform(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.unit()
    }

    /// `[lo, hi)` 的整数（`hi > lo`）。
    pub fn int_range(&mut self, lo: i64, hi: i64) -> i64 {
        let span = (hi - lo).max(1) as u64;
        lo + (self.next_u64() % span) as i64
    }

    /// 标准正态。
    pub fn normal(&mut self) -> f64 {
        if let Some(v) = self.spare.take() {
            return v;
        }
        let u1 = 1.0 - self.unit(); // (0, 1]
        let u2 = self.unit();
        let r = libm::sqrt(-2.0 * libm::log(u1));
        let (s, c) = libm::sincos(crate::math::TAU * u2);
        self.spare = Some(r * s);
        r * c
    }

    /// 均值为 `mean` 的指数分布（泊松过程的间隔）。
    pub fn exponential(&mut self, mean: f64) -> f64 {
        -mean * libm::log(1.0 - self.unit())
    }

    /// `n` 个标准正态样本。
    pub fn normals(&mut self, n: usize) -> Vec<f32> {
        (0..n).map(|_| self.normal() as f32).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_reference_vector_for_seed_zero() {
        let mut rng = Rng::new(0);
        assert_eq!(rng.next_u64(), 0xE220_A839_7B1D_CDAF);
        assert_eq!(rng.next_u64(), 0x6E78_9E6A_A1B9_65F4);
    }

    #[test]
    fn normal_moments_are_sane_and_deterministic() {
        let mut a = Rng::new(42);
        let xs: Vec<f64> = (0..200_000).map(|_| a.normal()).collect();
        let mean = xs.iter().sum::<f64>() / xs.len() as f64;
        let var = xs.iter().map(|x| (x - mean) * (x - mean)).sum::<f64>() / xs.len() as f64;
        assert!(mean.abs() < 0.01, "mean {mean}");
        assert!((var - 1.0).abs() < 0.01, "var {var}");
        let mut b = Rng::new(42);
        let ys: Vec<f64> = (0..200_000).map(|_| b.normal()).collect();
        assert_eq!(xs, ys);
    }

    #[test]
    fn derive_separates_salts() {
        assert_ne!(derive(1, 0), derive(1, 1));
        assert_ne!(derive(1, 5), derive(2, 5));
        assert_eq!(derive(9, 3), derive(9, 3));
    }
}
