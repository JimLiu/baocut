//! 合成脉冲响应（分频段指数衰减的噪声 + 早期反射）与 FFT 分块卷积（overlap-add）。

use crate::biquad::{bandpass, highpass, lowpass};
use crate::fft::{Fft, next_pow2};
use crate::math::samples;
use crate::rng::Rng;
use crate::stereo::Stereo;

/// 一只混响空间的参数（参考工程 `make_ir`）。
#[derive(Debug, Clone, PartialEq)]
pub struct IrSpec {
    /// 中频 T60（秒）。
    pub t60: f64,
    /// 预延迟（秒），IR 前补这么多零。
    pub pre_delay: f64,
    /// 高频变暗系数：3.2 kHz 以上两个频段的衰减时间除以它（1 = 不变暗）。
    pub dark: f64,
    /// IR 长度（秒）；缺省 `min(1.15·t60, 9)`。
    pub length: Option<f64>,
    /// 额外的二阶低通（Hz），水下这类闷空间用。
    pub lowpass: Option<f64>,
    /// 噪声种子。
    pub seed: u64,
}

impl IrSpec {
    pub fn new(t60: f64, seed: u64) -> Self {
        Self {
            t60,
            pre_delay: 0.018,
            dark: 1.0,
            length: None,
            lowpass: None,
            seed,
        }
    }

    /// 内置空间：`room` / `hall` / `huge` / `water`（与参考工程同参）。
    pub fn preset(name: &str) -> Option<Self> {
        let base = |t60, seed, pre| Self {
            pre_delay: pre,
            ..Self::new(t60, seed)
        };
        Some(match name {
            "room" => base(0.9, 11, 0.008),
            "hall" => base(2.8, 12, 0.022),
            "huge" => Self {
                dark: 1.6,
                ..base(6.0, 13, 0.04)
            },
            "water" => Self {
                dark: 2.5,
                lowpass: Some(1400.0),
                ..base(1.8, 14, 0.01)
            },
            _ => return None,
        })
    }
}

/// 生成立体声 IR：五个频段（0–220、220–1100、1100–3200、3200–7500、7500+ Hz）各自按
/// `exp(−6.9078·t / (t60·m))` 衰减（m = 1.2 / 1.0 / 0.8 / 0.55÷dark / 0.3÷dark），15 ms 渐起，
/// 10 个 6–70 ms 的早期反射；两声道噪声独立。能量归一到两声道平均单位能量，再补预延迟。
pub fn synth_ir(spec: &IrSpec, sr: f64) -> Stereo {
    let mut rng = Rng::new(spec.seed);
    let n = samples(spec.length.unwrap_or((spec.t60 * 1.15).min(9.0)), sr).max(1);
    let bands: [(f64, f64, f64); 5] = [
        (0.0, 220.0, 1.2),
        (220.0, 1100.0, 1.0),
        (1100.0, 3200.0, 0.8),
        (3200.0, 7500.0, 0.55 / spec.dark),
        (7500.0, 0.0, 0.3 / spec.dark),
    ];
    let mut chans: Vec<Vec<f64>> = Vec::with_capacity(2);
    for _ in 0..2 {
        let w = rng.normals(n);
        let mut acc = vec![0.0f64; n];
        for (lo, hi, m) in bands {
            let y = if lo == 0.0 {
                lowpass(&w, sr, hi, 4)
            } else if hi == 0.0 {
                highpass(&w, sr, lo, 4)
            } else {
                bandpass(&w, sr, lo, hi, 3)
            };
            let tau = spec.t60 * m;
            for (i, a) in acc.iter_mut().enumerate() {
                *a += y[i] as f64 * libm::exp(-6.9078 * (i as f64 / sr) / tau);
            }
        }
        for (i, a) in acc.iter_mut().enumerate() {
            *a *= 1.0 - libm::exp(-(i as f64 / sr) / 0.015);
        }
        for _ in 0..10 {
            let d = samples(rng.uniform(0.006, 0.07), sr).min(n - 1);
            acc[d] += rng.uniform(-1.0, 1.0) * 6.0 * libm::exp(-(d as f64) / sr / 0.05);
        }
        if let Some(f) = spec.lowpass {
            let mut v: Vec<f32> = acc.iter().map(|x| *x as f32).collect();
            v = lowpass(&v, sr, f, 2);
            acc = v.into_iter().map(f64::from).collect();
        }
        chans.push(acc);
    }
    let energy: f64 = chans
        .iter()
        .map(|c| c.iter().map(|v| v * v).sum::<f64>())
        .sum::<f64>()
        / 2.0;
    let norm = 1.0 / (libm::sqrt(energy) + 1e-12);
    let pad = samples(spec.pre_delay, sr);
    let make = |c: &Vec<f64>| {
        let mut out = vec![0.0f32; pad];
        out.extend(c.iter().map(|v| (v * norm) as f32));
        out
    };
    Stereo {
        l: make(&chans[0]),
        r: make(&chans[1]),
    }
}

/// 线性卷积 `x * h`，截到 `out_len`。overlap-add：FFT 长度取 `next_pow2(2·len(h))`，块长
/// `fft − len(h) + 1`。纯标量、确定性。
pub fn convolve(x: &[f32], h: &[f32], out_len: usize) -> Vec<f32> {
    let mut out = vec![0.0f64; out_len];
    if x.is_empty() || h.is_empty() || out_len == 0 {
        return vec![0.0; out_len];
    }
    let size = next_pow2(2 * h.len()).max(64);
    let block = size - h.len() + 1;
    let fft = Fft::new(size);
    let mut hr: Vec<f64> = h.iter().map(|v| *v as f64).collect();
    hr.resize(size, 0.0);
    let mut hi = vec![0.0; size];
    fft.forward(&mut hr, &mut hi);
    let mut start = 0;
    let limit = x.len().min(out_len);
    while start < limit {
        let end = (start + block).min(x.len());
        if x[start..end].iter().all(|v| *v == 0.0) {
            start = end;
            continue;
        }
        let mut re = vec![0.0f64; size];
        let mut im = vec![0.0f64; size];
        for (k, v) in x[start..end].iter().enumerate() {
            re[k] = *v as f64;
        }
        fft.forward(&mut re, &mut im);
        for k in 0..size {
            let (a, b) = (re[k], im[k]);
            re[k] = a * hr[k] - b * hi[k];
            im[k] = a * hi[k] + b * hr[k];
        }
        fft.inverse(&mut re, &mut im);
        for (k, v) in re.iter().enumerate().take((end - start) + h.len() - 1) {
            let i = start + k;
            if i >= out_len {
                break;
            }
            out[i] += v;
        }
        start = end;
    }
    out.into_iter().map(|v| v as f32).collect()
}

/// 立体声送出 × 立体声 IR：左进左、右进右（参考工程同口径），截到 `out_len`。
pub fn convolve_stereo(x: &Stereo, ir: &Stereo, out_len: usize) -> Stereo {
    Stereo {
        l: convolve(&x.l, &ir.l, out_len),
        r: convolve(&x.r, &ir.r, out_len),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f64 = 48_000.0;

    fn naive(x: &[f32], h: &[f32], n: usize) -> Vec<f64> {
        (0..n)
            .map(|i| {
                (0..h.len())
                    .filter(|k| *k <= i && i - k < x.len())
                    .map(|k| x[i - k] as f64 * h[k] as f64)
                    .sum()
            })
            .collect()
    }

    #[test]
    fn convolution_matches_direct_sum() {
        let mut rng = Rng::new(3);
        let x = rng.normals(3000);
        let h = rng.normals(257);
        let y = convolve(&x, &h, 3300);
        let z = naive(&x, &h, 3300);
        for (a, b) in y.iter().zip(&z) {
            assert!((*a as f64 - b).abs() < 1e-3, "{a} vs {b}");
        }
    }

    #[test]
    fn ir_decays_at_t60_and_has_unit_energy() {
        let spec = IrSpec::preset("hall").unwrap();
        let ir = synth_ir(&spec, SR);
        let pad = samples(spec.pre_delay, SR);
        assert!(ir.l[..pad].iter().all(|v| *v == 0.0));
        let energy: f64 =
            ir.l.iter()
                .chain(&ir.r)
                .map(|v| (*v as f64).powi(2))
                .sum::<f64>()
                / 2.0;
        assert!((energy - 1.0).abs() < 1e-3, "energy {energy}");
        // 0.1–0.3 s 与 2.4–2.6 s 两窗的能量差大致应是 −60 dB × 2.2/2.8 左右（高频衰减更快，取宽松区间）。
        let win = |a: f64, b: f64| {
            let (i, j) = (pad + samples(a, SR), pad + samples(b, SR));
            ir.l[i..j].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / (j - i) as f64
        };
        let drop = 10.0 * libm::log10(win(2.4, 2.6) / win(0.1, 0.3));
        assert!((-60.0..-35.0).contains(&drop), "drop {drop}");
        assert_eq!(ir, synth_ir(&spec, SR));
    }

    #[test]
    fn dark_and_water_presets_lose_highs() {
        let hall = synth_ir(&IrSpec::preset("hall").unwrap(), SR);
        let water = synth_ir(&IrSpec::preset("water").unwrap(), SR);
        let hf = |x: &[f32]| {
            let y = highpass(x, SR, 4000.0, 4);
            y.iter().map(|v| (*v as f64).powi(2)).sum::<f64>()
                / x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>()
        };
        assert!(hf(&water.l) < hf(&hall.l) * 0.1);
    }
}
