//! 不靠模型的音色测量：三分之一倍频程的能量分布与尾巴长度。给音效配方写回归测试、比较两段声音的音色用。
//!
//! 为什么要它：拿模型给合成声打分时，参数一路往讨好模型的方向调，模型分数会饱和、不再分得出合成与录音；
//! 频带能量这类直接从采样量出来的数讨好不了（思路参考开源项目 earshot 的 `forge/tone`，MIT 许可，独立实现）。
//!
//! - [`profile`]：28 个三分之一倍频程频带（中心 31.5 Hz – 16 kHz）的能量，单位是相对整段总能量的 dB，
//!   下限 [`FLOOR_DB`]，所以电平高低不影响它；
//! - [`distance_db`]：两条 profile 逐频带差的均方根（dB）；
//! - [`band_db`]：任意 `[lo, hi)` 频段占总能量的 dB；
//! - [`t40`]：从峰值起，5 ms 均方根包络第一次比最大值低 40 dB 用了多少秒（尾巴长度）。
//!
//! 整段一次 FFT（补零到 2 的幂），本 crate 自带的标量实现，跨平台逐位一致。

use crate::fft::{Fft, next_pow2};
use crate::math::samples;

/// 频带数：中心 `1000·2^((k−15)/3)` Hz，k = 0..28，31.5 Hz – 15.9 kHz。
pub const BANDS: usize = 28;
/// profile 的下限（dB）。
pub const FLOOR_DB: f64 = -60.0;

/// 第 `k` 个频带的中心频率（Hz）。
pub fn band_center(k: usize) -> f64 {
    1000.0 * libm::exp2((k as f64 - 15.0) / 3.0)
}

/// 整段的功率谱：`(每个 bin 的 Hz 宽, |X[k]|²（k = 0..=N/2）)`。
fn power_spectrum(x: &[f32], sr: f64) -> (f64, Vec<f64>) {
    let size = next_pow2(x.len().max(2));
    let fft = Fft::new(size);
    let mut re: Vec<f64> = x.iter().map(|v| f64::from(*v)).collect();
    re.resize(size, 0.0);
    let mut im = vec![0.0; size];
    fft.forward(&mut re, &mut im);
    let power = (0..=size / 2)
        .map(|k| re[k] * re[k] + im[k] * im[k])
        .collect();
    (sr / size as f64, power)
}

fn energy_db(power: &[f64], bin_hz: f64, lo: f64, hi: f64, total: f64) -> f64 {
    let sum: f64 = power
        .iter()
        .enumerate()
        .skip(1)
        .filter(|(k, _)| {
            let f = *k as f64 * bin_hz;
            f >= lo && f < hi
        })
        .map(|(_, p)| p)
        .sum();
    if total <= 0.0 || sum <= 0.0 {
        return FLOOR_DB;
    }
    (10.0 * libm::log10(sum / total)).max(FLOOR_DB)
}

fn total_power(power: &[f64]) -> f64 {
    power.iter().skip(1).sum()
}

/// 三分之一倍频程 profile（[`BANDS`] 个值，相对总能量的 dB，下限 [`FLOOR_DB`]）。高于奈奎斯特的频带是下限。
pub fn profile(x: &[f32], sr: f64) -> Vec<f64> {
    let (bin_hz, power) = power_spectrum(x, sr);
    let total = total_power(&power);
    let edge = libm::exp2(1.0 / 6.0);
    (0..BANDS)
        .map(|k| {
            let center = band_center(k);
            energy_db(&power, bin_hz, center / edge, center * edge, total)
        })
        .collect()
}

/// 两条 profile 逐频带差的均方根（dB）。
pub fn distance_db(a: &[f64], b: &[f64]) -> f64 {
    let n = a.len().min(b.len()).max(1);
    let sum: f64 = a.iter().zip(b).map(|(x, y)| (x - y) * (x - y)).sum();
    libm::sqrt(sum / n as f64)
}

/// `[lo, hi)` Hz 的能量占整段总能量的 dB（下限 [`FLOOR_DB`]）。
pub fn band_db(x: &[f32], sr: f64, lo: f64, hi: f64) -> f64 {
    let (bin_hz, power) = power_spectrum(x, sr);
    let total = total_power(&power);
    energy_db(&power, bin_hz, lo, hi, total)
}

/// 尾巴长度：5 ms 窗、1 ms 步进的均方根包络，从最大值所在处起，第一次比最大值低 40 dB 的时刻减去最大值的时刻（秒）。
/// 到结尾都没低 40 dB 时 `None`。
pub fn t40(x: &[f32], sr: f64) -> Option<f64> {
    let win = samples(0.005, sr).max(1);
    let hop = samples(0.001, sr).max(1);
    if x.len() < win {
        return None;
    }
    let env: Vec<f64> = (0..=(x.len() - win) / hop)
        .map(|i| {
            let frame = &x[i * hop..i * hop + win];
            frame.iter().map(|v| f64::from(*v).powi(2)).sum::<f64>() / win as f64
        })
        .collect();
    let (top, max) =
        env.iter().enumerate().fold(
            (0, 0.0_f64),
            |best, (i, v)| if *v > best.1 { (i, *v) } else { best },
        );
    if max <= 0.0 {
        return None;
    }
    // 功率低 40 dB = 乘 1e-4。
    let limit = max * 1e-4;
    env[top..]
        .iter()
        .position(|v| *v < limit)
        .map(|k| (k * hop) as f64 / sr)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::TAU;
    use crate::noise;
    use crate::rng::Rng;

    const SR: f64 = 48_000.0;

    #[test]
    fn a_sine_lands_in_its_band() {
        let x: Vec<f32> = (0..48_000)
            .map(|i| libm::sin(TAU * 1000.0 * i as f64 / SR) as f32)
            .collect();
        let p = profile(&x, SR);
        assert!(p[15] > -0.5, "1 kHz band {}", p[15]);
        assert!(p[12] < -40.0 && p[18] < -40.0);
        assert!(band_db(&x, SR, 900.0, 1100.0) > -0.1);
    }

    #[test]
    fn pink_noise_is_nearly_flat_per_third_octave() {
        let x = noise::colored(1 << 18, SR, 1.0, &mut Rng::new(9));
        let p = profile(&x, SR);
        // 100 Hz – 10 kHz：粉噪声每个三分之一倍频程的能量相同（总共 28 个频带，均分约 −14.5 dB）。
        let mid = &p[5..25];
        let mean = mid.iter().sum::<f64>() / mid.len() as f64;
        assert!(mid.iter().all(|v| (v - mean).abs() < 1.5), "{mid:?}");
        assert!(distance_db(&p, &p) == 0.0);
    }

    #[test]
    fn t40_matches_an_exponential_decay() {
        // 振幅 e^(−t/τ) 低 40 dB 用 τ·ln(100) 秒。
        let tau = 0.05;
        let x: Vec<f32> = (0..48_000)
            .map(|i| {
                let t = i as f64 / SR;
                (libm::exp(-t / tau) * libm::sin(TAU * 440.0 * t)) as f32
            })
            .collect();
        let got = t40(&x, SR).unwrap();
        let want = tau * libm::log(100.0);
        assert!((got - want).abs() < 0.01, "t40 {got} vs {want}");
        assert_eq!(t40(&vec![0.0; 4800], SR), None);
    }
}
