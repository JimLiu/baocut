//! 确定性随机（规范 §7.3）。
//!
//! **splitmix64 是新配方的唯一 PRNG**。已发布的 `timeline.loop.jitter@1` 继续走
//! `loop_kernel::noise_hash`（murmur3 finalizer 风格，缺省 seed 17）——ADR-M08
//! 「已发布配方冻结」，改它等于移动旧项目的像素。新配方与 `animate.flow` 的
//! `noise` op 一律 splitmix64，缺省 seed **0**（规范 §7.3：省略 seed 时编译期写死
//! 默认值，而不是运行时取随机源）。
//!
//! 本模块没有任何隐藏状态：所有入口都是 `(seed, index) → value` 的纯函数，
//! 乱序采样与顺序采样逐位相同。

/// 规范 §7.3 的 splitmix64：各端位一致的 64 位状态推进器。
///
/// 参考实现（Vigna, public domain）：`state += GOLDEN; z = state;
/// z = (z ^ (z >> 30)) * C1; z = (z ^ (z >> 27)) * C2; return z ^ (z >> 31)`。
pub fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// `(seed, index)` → `[0, 1)`。`index` 是晶格点序号，可为负。
pub fn splitmix64_unit(seed: u64, index: i64) -> f64 {
    let mut state = seed ^ (index as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    let bits = splitmix64(&mut state);
    // 取高 53 位 → 双精度尾数宽度，映到 [0, 1)。
    (bits >> 11) as f64 / (1u64 << 53) as f64
}

/// `(seed, index)` → `[-1, 1)`。
pub fn splitmix64_signed(seed: u64, index: i64) -> f64 {
    splitmix64_unit(seed, index) * 2.0 - 1.0
}

/// 晶格噪声的顶点值（`splitmix64-v1`）。
///
/// 两条与 `lattice-murmur-v1` 共享的契约（[`crate::loop_kernel::noise_hash`]）：
/// 顶点按 `lattice` 取模 ⇒ 一个周期首尾相接（无缝循环）；**0 号顶点钉为 0**
/// ⇒ 相位 0 处的取值恒为 0，噪声轨作为 `add` 通道时从单位元起步、不会在入场瞬间
/// 跳一下。
pub fn splitmix64_lattice(seed: u64, index: i64, lattice: i64) -> f64 {
    let index = index.rem_euclid(lattice.max(1));
    if index == 0 {
        return 0.0;
    }
    splitmix64_signed(seed, index)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vigna 参考实现对 seed 0 的前 8 个输出（其它语言的移植普遍以它对拍）。
    #[test]
    fn splitmix64_matches_the_reference_vector_for_seed_zero() {
        let mut state = 0u64;
        let got: Vec<u64> = (0..8).map(|_| splitmix64(&mut state)).collect();
        assert_eq!(
            got,
            vec![
                0xE220_A839_7B1D_CDAF,
                0x6E78_9E6A_A1B9_65F4,
                0x06C4_5D18_8009_454F,
                0xF88B_B8A8_724C_81EC,
                0x1B39_896A_51A8_749B,
                0x53CB_9F0C_747E_A2EA,
                0x2C82_9ABE_1F45_32E1,
                0xC584_133A_C916_AB3C,
            ]
        );
    }

    #[test]
    fn unit_and_signed_stay_in_range_and_are_deterministic() {
        for index in -64..64 {
            let unit = splitmix64_unit(7, index);
            assert!((0.0..1.0).contains(&unit), "index={index} unit={unit}");
            let signed = splitmix64_signed(7, index);
            assert!((-1.0..1.0).contains(&signed), "index={index}");
            assert_eq!(signed, splitmix64_signed(7, index));
        }
    }

    #[test]
    fn lattice_wraps_and_pins_vertex_zero() {
        assert_eq!(splitmix64_lattice(0, 0, 8), 0.0);
        assert_eq!(splitmix64_lattice(0, 8, 8), 0.0);
        assert_eq!(splitmix64_lattice(0, -8, 8), 0.0);
        assert_eq!(splitmix64_lattice(3, 1, 8), splitmix64_lattice(3, 9, 8));
        assert_ne!(splitmix64_lattice(3, 1, 8), splitmix64_lattice(4, 1, 8));
    }

    /// 不同 seed 必须给出不同序列（否则「同 seed 同输出」是空洞的）。
    #[test]
    fn different_seeds_give_different_sequences() {
        let a: Vec<f64> = (1..16).map(|i| splitmix64_signed(0, i)).collect();
        let b: Vec<f64> = (1..16).map(|i| splitmix64_signed(1, i)).collect();
        assert_ne!(a, b);
    }
}
