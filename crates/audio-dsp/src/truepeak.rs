//! 真峰值（4× 过采样）与前瞻限幅器。
//!
//! 过采样用 Kaiser 窗 sinc 插值：每个相位（1/4、1/2、3/4）32 个抽头（前后各 16），
//! β = 8，截止在原奈奎斯特，每个相位的直流增益各自归一到 1。整数相位就是原样本本身。
//! 第 `i` 组 = 原样本 `i` 与它后面三个插值点，组内取绝对值最大（参考工程 `resample_poly`
//! 之后 `reshape(-1, 4).max` 同口径）。

use crate::math::{db_to_gain, gain_to_db, samples};
use crate::stereo::Stereo;

const HALF: usize = 16;

/// [`oversampled_peaks`] 第 `i` 个值只看 `x[i − HALF + 1 ..= i + HALF]`：分窗处理整片时，
/// 每侧多带这么多采样的上下文，窗内结果就与整条信号一次算逐位相同。
pub const PEAK_CONTEXT: usize = HALF;
const BETA: f64 = 8.0;

fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let q = x * x / 4.0;
    for k in 1..64 {
        term *= q / (k as f64 * k as f64);
        sum += term;
        if term < sum * 1e-17 {
            break;
        }
    }
    sum
}

/// 三个分数相位的插值抽头：`taps[p][k]` 乘以 `x[i + k − HALF + 1]`，得到 `i + (p+1)/4` 处的值。
fn phase_taps() -> [[f64; 2 * HALF]; 3] {
    let mut taps = [[0.0; 2 * HALF]; 3];
    let i0b = bessel_i0(BETA);
    for (p, row) in taps.iter_mut().enumerate() {
        let frac = (p + 1) as f64 / 4.0;
        let mut sum = 0.0;
        for (k, t) in row.iter_mut().enumerate() {
            // 抽头 k 对应的原样本相对插值点的距离。
            let d = (k as f64 - HALF as f64 + 1.0) - frac;
            let sinc = if d == 0.0 {
                1.0
            } else {
                libm::sin(core::f64::consts::PI * d) / (core::f64::consts::PI * d)
            };
            let r = d / (HALF as f64);
            let w = if r.abs() >= 1.0 {
                0.0
            } else {
                bessel_i0(BETA * libm::sqrt(1.0 - r * r)) / i0b
            };
            *t = sinc * w;
            sum += *t;
        }
        for t in row.iter_mut() {
            *t /= sum;
        }
    }
    taps
}

/// 每个原样本位置（含其后三个插值点）的绝对值峰（线性）。
pub fn oversampled_peaks(x: &[f32]) -> Vec<f64> {
    let taps = phase_taps();
    // 两端补零，内层循环就是定长切片点积。
    let mut padded = vec![0.0f64; x.len() + 2 * HALF];
    for (p, v) in padded[HALF..].iter_mut().zip(x) {
        *p = *v as f64;
    }
    (0..x.len())
        .map(|i| {
            let mut m = (x[i] as f64).abs();
            // 抽头 k 乘 x[i + k − HALF + 1] = padded[i + k + 1]。
            let win = &padded[i + 1..i + 1 + 2 * HALF];
            for row in &taps {
                let v: f64 = row.iter().zip(win).map(|(t, s)| t * s).sum();
                m = m.max(v.abs());
            }
            m
        })
        .collect()
}

/// 多声道真峰值（线性）。
pub fn true_peak(chans: &[&[f32]]) -> f64 {
    chans
        .iter()
        .map(|c| oversampled_peaks(c).into_iter().fold(0.0, f64::max))
        .fold(0.0, f64::max)
}

/// 多声道真峰值（dBTP）。
pub fn true_peak_db(chans: &[&[f32]]) -> f64 {
    gain_to_db(true_peak(chans))
}

/// 限幅器参数。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Limiter {
    pub ceiling_db: f64,
    /// 平滑窗（秒），须小于 `hold`。
    pub look: f64,
    /// 保持窗（秒），居中：既往前看 `hold/2`，也保持 `hold/2`。
    pub hold: f64,
}

impl Default for Limiter {
    fn default() -> Self {
        Self {
            ceiling_db: -1.2,
            look: 0.03,
            hold: 0.06,
        }
    }
}

/// 居中滑动最小值（窗 `2·half + 1`，边界处只看界内）。单调队列，O(n)。
fn min_filter(g: &[f64], half: usize) -> Vec<f64> {
    let n = g.len();
    let mut out = vec![0.0; n];
    let mut dq: std::collections::VecDeque<usize> = std::collections::VecDeque::new();
    let mut next = 0;
    for (i, o) in out.iter_mut().enumerate() {
        let hi = (i + half).min(n - 1);
        while next <= hi {
            while dq.back().is_some_and(|b| g[*b] >= g[next]) {
                dq.pop_back();
            }
            dq.push_back(next);
            next += 1;
        }
        let lo = i.saturating_sub(half);
        while dq.front().is_some_and(|f| *f < lo) {
            dq.pop_front();
        }
        *o = g[*dq.front().expect("window is never empty")];
    }
    out
}

/// 居中滑动平均（窗 `2·half + 1`，边界处取界内均值）。
fn box_filter(g: &[f64], half: usize) -> Vec<f64> {
    let n = g.len();
    let mut prefix = vec![0.0f64; n + 1];
    for i in 0..n {
        prefix[i + 1] = prefix[i] + g[i];
    }
    (0..n)
        .map(|i| {
            let (lo, hi) = (i.saturating_sub(half), (i + half + 1).min(n));
            (prefix[hi] - prefix[lo]) / (hi - lo) as f64
        })
        .collect()
}

/// [`limiter_gain`] 第 `i` 个值依赖的输入半径（采样）：保持窗半宽 + 平均窗半宽 + 过采样上下文。
/// 分窗限幅时每侧带这么多上下文，窗内增益与整条信号一次算逐位相同。
pub fn limiter_context(sr: f64, lim: Limiter) -> usize {
    let hold = samples(lim.hold, sr) / 2;
    hold + (samples(lim.look, sr) / 2).min(hold) + PEAK_CONTEXT
}

/// 限幅增益曲线：所需增益 `min(1, ceiling / tp[i])` → 居中最小值（hold）→ 居中平均（look）。
/// 平均窗比最小值窗短，所以平均后的每个值都不高于该样本所需的增益。
pub fn limiter_gain(chans: &[&[f32]], sr: f64, lim: Limiter) -> Vec<f64> {
    let n = chans.iter().map(|c| c.len()).min().unwrap_or(0);
    if n == 0 {
        return Vec::new();
    }
    let ceiling = db_to_gain(lim.ceiling_db);
    let mut pk = vec![0.0f64; n];
    for c in chans {
        for (p, v) in pk.iter_mut().zip(oversampled_peaks(&c[..n])) {
            *p = p.max(v);
        }
    }
    let need: Vec<f64> = pk
        .iter()
        .map(|p| (ceiling / (p + 1e-12)).min(1.0))
        .collect();
    let held = min_filter(&need, samples(lim.hold, sr) / 2);
    box_filter(
        &held,
        (samples(lim.look, sr) / 2).min(samples(lim.hold, sr) / 2),
    )
}

/// 就地限幅立体声。单遍不保证插值峰也压住（增益曲线本身会改变插值），母带链跑三遍再静态兜底。
pub fn limit(x: &mut Stereo, sr: f64, lim: Limiter) {
    let g = limiter_gain(&x.channels(), sr, lim);
    let g: Vec<f32> = g.into_iter().map(|v| v as f32).collect();
    x.apply_gain(&g);
}

/// 静态兜底：真峰值高于上限时整体降到上限。返回施加的增益（dB，≤ 0）。
pub fn trim_to_ceiling(x: &mut Stereo, ceiling_db: f64) -> f64 {
    let tp = true_peak_db(&x.channels());
    if tp <= ceiling_db {
        return 0.0;
    }
    // 多留 0.001 dB，免得 f32 舍入把结果推回上限之上。
    let g = ceiling_db - tp - 0.001;
    x.scale(db_to_gain(g));
    g
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::TAU;
    use crate::rng::Rng;

    const SR: f64 = 48_000.0;

    #[test]
    fn quarter_rate_sine_at_45_degrees_reads_zero_dbtp() {
        let x: Vec<f32> = (0..48_000)
            .map(|i| libm::sin(TAU * i as f64 / 4.0 + TAU / 8.0) as f32)
            .collect();
        let sample_peak = gain_to_db(crate::stereo::peak(&x));
        assert!((sample_peak + 3.01).abs() < 0.02, "{sample_peak}");
        // 取中段：信号在两端被硬截断，截断处的吉布斯过冲不是被测对象。
        let tp = gain_to_db(
            oversampled_peaks(&x)[1000..47_000]
                .iter()
                .fold(0.0, |m, v| v.max(m)),
        );
        assert!(tp.abs() < 0.02, "{tp}");
    }

    #[test]
    fn matches_libebur128_true_peak() {
        let mut rng = Rng::new(11);
        let l = crate::biquad::lowpass(&rng.normals(96_000), SR, 15_000.0, 4);
        let r = rng.normals(96_000);
        let s = Stereo {
            l: l.iter().map(|v| v * 0.2).collect(),
            r: r.iter().map(|v| v * 0.2).collect(),
        };
        let mine = true_peak_db(&s.channels());
        let mut m = ebur128::EbuR128::new(2, 48_000, ebur128::Mode::TRUE_PEAK).unwrap();
        m.add_frames_f32(&s.interleaved()).unwrap();
        let theirs = gain_to_db(m.true_peak(0).unwrap().max(m.true_peak(1).unwrap()));
        assert!((mine - theirs).abs() < 0.3, "{mine} vs {theirs}");
    }

    #[test]
    fn limiter_keeps_true_peak_under_ceiling_and_leaves_quiet_parts() {
        let mut rng = Rng::new(12);
        let n = 5 * 48_000;
        let quiet: Vec<f32> = rng.normals(n).iter().map(|v| v * 0.05).collect();
        let mut s = Stereo::dual_mono(&quiet);
        for k in 0..20 {
            let at = 48_000 + k * 7_000;
            for i in 0..400 {
                let v = (1.8 * libm::sin(TAU * 900.0 * i as f64 / SR)) as f32;
                s.l[at + i] += v;
                s.r[at + i] -= v * 0.7;
            }
        }
        let before = s.clone();
        let lim = Limiter::default();
        for _ in 0..3 {
            limit(&mut s, SR, lim);
        }
        // 离冲击足够远的安静段增益恰好是 1（静态兜底之前）。
        assert_eq!(s.l[..20_000], before.l[..20_000]);
        trim_to_ceiling(&mut s, lim.ceiling_db);
        assert!(true_peak_db(&s.channels()) <= lim.ceiling_db + 1e-6);
        let mut again = before.clone();
        for _ in 0..3 {
            limit(&mut again, SR, lim);
        }
        trim_to_ceiling(&mut again, lim.ceiling_db);
        assert_eq!(s, again);
    }

    #[test]
    fn filters_behave() {
        let g = [1.0, 0.5, 1.0, 1.0, 0.2, 1.0, 1.0];
        assert_eq!(min_filter(&g, 1), vec![0.5, 0.5, 0.5, 0.2, 0.2, 0.2, 1.0]);
        let b = box_filter(&[0.0, 3.0, 0.0], 1);
        assert_eq!(b, vec![1.5, 1.0, 1.5]);
    }
}
