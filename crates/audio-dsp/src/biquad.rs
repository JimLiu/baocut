//! RBJ（Audio EQ Cookbook）双二阶滤波器，与由它级联出的 Butterworth 低通 / 高通 / 带通。
//!
//! 每次调用都从零状态开始（离线渲染没有「上一块」）；状态与系数是 `f64`，DF-II 转置结构。
//! 截止频率夹在 `(0, 0.49·sr)` 之内——参考工程的 `lp()` 也把上限钉在 `0.45·sr`，避开
//! 双线性变换在奈奎斯特附近的畸变（低通按 `0.45·sr` 夹）。

use crate::math::TAU;

/// 归一化（`a0 = 1`）的双二阶系数。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Biquad {
    pub b0: f64,
    pub b1: f64,
    pub b2: f64,
    pub a1: f64,
    pub a2: f64,
}

fn clamp_freq(f: f64, sr: f64) -> f64 {
    f.clamp(1e-3, 0.49 * sr)
}

fn w0(f: f64, sr: f64) -> (f64, f64) {
    libm::sincos(TAU * clamp_freq(f, sr) / sr)
}

impl Biquad {
    /// 直通。
    pub const IDENTITY: Biquad = Biquad {
        b0: 1.0,
        b1: 0.0,
        b2: 0.0,
        a1: 0.0,
        a2: 0.0,
    };

    fn normalized(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) -> Self {
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }

    /// 二阶低通，`q = 1/√2` 为 Butterworth。
    pub fn lowpass(sr: f64, f: f64, q: f64) -> Self {
        let (s, c) = w0(f.min(0.45 * sr), sr);
        let alpha = s / (2.0 * q);
        Self::normalized(
            (1.0 - c) / 2.0,
            1.0 - c,
            (1.0 - c) / 2.0,
            1.0 + alpha,
            -2.0 * c,
            1.0 - alpha,
        )
    }

    /// 二阶高通。
    pub fn highpass(sr: f64, f: f64, q: f64) -> Self {
        let (s, c) = w0(f, sr);
        let alpha = s / (2.0 * q);
        Self::normalized(
            (1.0 + c) / 2.0,
            -(1.0 + c),
            (1.0 + c) / 2.0,
            1.0 + alpha,
            -2.0 * c,
            1.0 - alpha,
        )
    }

    /// 带通，中心增益 0 dB（等同 scipy `iirpeak`：共振器）。
    pub fn bandpass(sr: f64, f: f64, q: f64) -> Self {
        let (s, c) = w0(f, sr);
        let alpha = s / (2.0 * q);
        Self::normalized(alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * c, 1.0 - alpha)
    }

    /// 峰值 EQ：中心 `gain_db`，宽度 `q`。
    pub fn peak(sr: f64, f: f64, q: f64, gain_db: f64) -> Self {
        let (s, c) = w0(f, sr);
        let a = libm::pow(10.0, gain_db / 40.0);
        let alpha = s / (2.0 * q);
        Self::normalized(
            1.0 + alpha * a,
            -2.0 * c,
            1.0 - alpha * a,
            1.0 + alpha / a,
            -2.0 * c,
            1.0 - alpha / a,
        )
    }

    /// 低架：`f` 以下提升 / 衰减 `gain_db`。
    pub fn low_shelf(sr: f64, f: f64, q: f64, gain_db: f64) -> Self {
        let (s, c) = w0(f, sr);
        let a = libm::pow(10.0, gain_db / 40.0);
        let alpha = s / (2.0 * q);
        let k = 2.0 * libm::sqrt(a) * alpha;
        Self::normalized(
            a * ((a + 1.0) - (a - 1.0) * c + k),
            2.0 * a * ((a - 1.0) - (a + 1.0) * c),
            a * ((a + 1.0) - (a - 1.0) * c - k),
            (a + 1.0) + (a - 1.0) * c + k,
            -2.0 * ((a - 1.0) + (a + 1.0) * c),
            (a + 1.0) + (a - 1.0) * c - k,
        )
    }

    /// 高架：`f` 以上提升 / 衰减 `gain_db`。
    pub fn high_shelf(sr: f64, f: f64, q: f64, gain_db: f64) -> Self {
        let (s, c) = w0(f, sr);
        let a = libm::pow(10.0, gain_db / 40.0);
        let alpha = s / (2.0 * q);
        let k = 2.0 * libm::sqrt(a) * alpha;
        Self::normalized(
            a * ((a + 1.0) + (a - 1.0) * c + k),
            -2.0 * a * ((a - 1.0) + (a + 1.0) * c),
            a * ((a + 1.0) + (a - 1.0) * c - k),
            (a + 1.0) - (a - 1.0) * c + k,
            2.0 * ((a - 1.0) - (a + 1.0) * c),
            (a + 1.0) - (a - 1.0) * c - k,
        )
    }

    /// 一阶低通（双线性变换）。
    pub fn lowpass1(sr: f64, f: f64) -> Self {
        let k = libm::tan(core::f64::consts::PI * clamp_freq(f.min(0.45 * sr), sr) / sr);
        Self {
            b0: k / (1.0 + k),
            b1: k / (1.0 + k),
            b2: 0.0,
            a1: (k - 1.0) / (k + 1.0),
            a2: 0.0,
        }
    }

    /// 一阶高通（双线性变换）。
    pub fn highpass1(sr: f64, f: f64) -> Self {
        let k = libm::tan(core::f64::consts::PI * clamp_freq(f, sr) / sr);
        Self {
            b0: 1.0 / (1.0 + k),
            b1: -1.0 / (1.0 + k),
            b2: 0.0,
            a1: (k - 1.0) / (k + 1.0),
            a2: 0.0,
        }
    }

    /// 就地滤波（零初始状态）。
    pub fn process(&self, x: &mut [f32]) {
        let (mut z1, mut z2) = (0.0f64, 0.0f64);
        for v in x.iter_mut() {
            let input = *v as f64;
            let out = self.b0 * input + z1;
            z1 = self.b1 * input - self.a1 * out + z2;
            z2 = self.b2 * input - self.a2 * out;
            *v = out as f32;
        }
    }

    /// `f` Hz 处的幅度响应（线性）。
    pub fn magnitude(&self, sr: f64, f: f64) -> f64 {
        let (s1, c1) = libm::sincos(TAU * f / sr);
        let (s2, c2) = libm::sincos(2.0 * TAU * f / sr);
        let nr = self.b0 + self.b1 * c1 + self.b2 * c2;
        let ni = -(self.b1 * s1 + self.b2 * s2);
        let dr = 1.0 + self.a1 * c1 + self.a2 * c2;
        let di = -(self.a1 * s1 + self.a2 * s2);
        libm::sqrt((nr * nr + ni * ni) / (dr * dr + di * di))
    }
}

/// 双二阶级联。
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Cascade(pub Vec<Biquad>);

impl Cascade {
    pub fn process(&self, x: &mut [f32]) {
        for section in &self.0 {
            section.process(x);
        }
    }

    pub fn magnitude(&self, sr: f64, f: f64) -> f64 {
        self.0.iter().map(|s| s.magnitude(sr, f)).product()
    }

    /// `order` 阶 Butterworth 低通（1..=8）。
    pub fn butter_lowpass(sr: f64, f: f64, order: usize) -> Self {
        Self::butter(sr, f, order, false)
    }

    /// `order` 阶 Butterworth 高通（1..=8）。
    pub fn butter_highpass(sr: f64, f: f64, order: usize) -> Self {
        Self::butter(sr, f, order, true)
    }

    fn butter(sr: f64, f: f64, order: usize, high: bool) -> Self {
        let order = order.clamp(1, 8);
        let mut sections = Vec::new();
        if order % 2 == 1 {
            sections.push(if high {
                Biquad::highpass1(sr, f)
            } else {
                Biquad::lowpass1(sr, f)
            });
        }
        // 极点对 k 的 Q：1 / (2·sin((2k+1)π / 2n))，奇数阶跳过实极点那一个。
        let pairs = order / 2;
        for k in 0..pairs {
            let index = if order % 2 == 1 { k + 1 } else { k };
            let angle = if order % 2 == 1 {
                core::f64::consts::PI * index as f64 / order as f64
            } else {
                core::f64::consts::PI * (2 * index + 1) as f64 / (2 * order) as f64
            };
            let q = if order % 2 == 1 {
                1.0 / (2.0 * libm::cos(angle))
            } else {
                1.0 / (2.0 * libm::sin(angle))
            };
            sections.push(if high {
                Biquad::highpass(sr, f, q)
            } else {
                Biquad::lowpass(sr, f, q)
            });
        }
        Self(sections)
    }
}

/// Butterworth 低通（`order` 阶），返回新向量。
pub fn lowpass(x: &[f32], sr: f64, f: f64, order: usize) -> Vec<f32> {
    let mut y = x.to_vec();
    Cascade::butter_lowpass(sr, f, order).process(&mut y);
    y
}

/// Butterworth 高通（`order` 阶）。
pub fn highpass(x: &[f32], sr: f64, f: f64, order: usize) -> Vec<f32> {
    let mut y = x.to_vec();
    Cascade::butter_highpass(sr, f, order).process(&mut y);
    y
}

/// 带通 = `order` 阶高通（`lo`）串 `order` 阶低通（`hi`）。
pub fn bandpass(x: &[f32], sr: f64, lo: f64, hi: f64, order: usize) -> Vec<f32> {
    let mut y = x.to_vec();
    Cascade::butter_highpass(sr, lo, order).process(&mut y);
    Cascade::butter_lowpass(sr, hi, order).process(&mut y);
    y
}

/// 共振器：中心 `f`、品质因数 `q`、峰值增益 0 dB 的带通（共振峰、琴体）。
pub fn resonator(x: &[f32], sr: f64, f: f64, q: f64) -> Vec<f32> {
    let mut y = x.to_vec();
    Biquad::bandpass(sr, f, q).process(&mut y);
    y
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f64 = 48_000.0;

    fn sine(f: f64, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| libm::sin(TAU * f * i as f64 / SR) as f32)
            .collect()
    }

    /// 稳态 RMS（跳过前 1/4 的瞬态）。
    fn steady_rms(x: &[f32]) -> f64 {
        let tail = &x[x.len() / 4..];
        libm::sqrt(tail.iter().map(|v| (*v as f64) * (*v as f64)).sum::<f64>() / tail.len() as f64)
    }

    fn gain_db(filter: impl Fn(&[f32]) -> Vec<f32>, f: f64) -> f64 {
        let x = sine(f, 48_000);
        crate::math::gain_to_db(steady_rms(&filter(&x)) / steady_rms(&x))
    }

    #[test]
    fn lowpass_passes_low_and_cuts_high() {
        let lp = |x: &[f32]| lowpass(x, SR, 1000.0, 4);
        assert!(gain_db(lp, 100.0).abs() < 0.1);
        assert!((gain_db(lp, 1000.0) + 3.01).abs() < 0.2);
        assert!(gain_db(lp, 8000.0) < -70.0);
    }

    #[test]
    fn highpass_and_bandpass_directions() {
        let hp = |x: &[f32]| highpass(x, SR, 1000.0, 2);
        assert!(gain_db(hp, 100.0) < -38.0);
        assert!(gain_db(hp, 8000.0).abs() < 0.1);
        let bp = |x: &[f32]| bandpass(x, SR, 500.0, 2000.0, 2);
        assert!(gain_db(bp, 1000.0).abs() < 1.0);
        assert!(gain_db(bp, 60.0) < -30.0);
        assert!(gain_db(bp, 15000.0) < -30.0);
    }

    #[test]
    fn resonator_peaks_at_center() {
        let r = |x: &[f32]| resonator(x, SR, 1000.0, 5.0);
        assert!(gain_db(r, 1000.0).abs() < 0.1);
        assert!(gain_db(r, 3000.0) < -10.0);
    }

    #[test]
    fn shelves_and_peak_hit_their_gain() {
        let ls = Biquad::low_shelf(SR, 200.0, 0.707, 6.0);
        assert!((crate::math::gain_to_db(ls.magnitude(SR, 20.0)) - 6.0).abs() < 0.2);
        assert!(crate::math::gain_to_db(ls.magnitude(SR, 10_000.0)).abs() < 0.1);
        let hs = Biquad::high_shelf(SR, 4000.0, 0.707, -9.0);
        assert!((crate::math::gain_to_db(hs.magnitude(SR, 18_000.0)) + 9.0).abs() < 0.3);
        let pk = Biquad::peak(SR, 1000.0, 2.0, 4.0);
        assert!((crate::math::gain_to_db(pk.magnitude(SR, 1000.0)) - 4.0).abs() < 1e-6);
    }

    #[test]
    fn odd_orders_are_butterworth() {
        for order in 1..=8 {
            let c = Cascade::butter_lowpass(SR, 2000.0, order);
            let at_cut = crate::math::gain_to_db(c.magnitude(SR, 2000.0));
            assert!((at_cut + 3.01).abs() < 0.1, "order {order}: {at_cut}");
            let an_octave_up = crate::math::gain_to_db(c.magnitude(SR, 4000.0));
            assert!(
                an_octave_up < -5.5 * order as f64,
                "order {order}: {an_octave_up}"
            );
        }
    }

    #[test]
    fn deterministic() {
        let mut rng = crate::Rng::new(1);
        let x = rng.normals(10_000);
        assert_eq!(
            bandpass(&x, SR, 300.0, 3000.0, 3),
            bandpass(&x, SR, 300.0, 3000.0, 3)
        );
    }
}
