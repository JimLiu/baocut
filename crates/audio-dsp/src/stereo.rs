//! 立体声容器（planar）、等功率声像、淡入淡出、峰值 / RMS 归一化、去直流。

use crate::math::samples;

/// 平面立体声：两条等长的声道。所有 DSP 都按声道分开处理；需要交错时在编码处自行拼。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Stereo {
    pub l: Vec<f32>,
    pub r: Vec<f32>,
}

impl Stereo {
    /// `n` 个采样的静音。
    pub fn zeros(n: usize) -> Self {
        Self {
            l: vec![0.0; n],
            r: vec![0.0; n],
        }
    }

    /// 两声道都是 `x`（不做声像补偿）。
    pub fn dual_mono(x: &[f32]) -> Self {
        Self {
            l: x.to_vec(),
            r: x.to_vec(),
        }
    }

    /// 从交错的 `[l0, r0, l1, r1, …]` 拆开。
    pub fn from_interleaved(x: &[f32]) -> Self {
        Self {
            l: x.iter().step_by(2).copied().collect(),
            r: x.iter().skip(1).step_by(2).copied().collect(),
        }
    }

    /// 交错成 `[l0, r0, l1, r1, …]`。
    pub fn interleaved(&self) -> Vec<f32> {
        self.l
            .iter()
            .zip(&self.r)
            .flat_map(|(a, b)| [*a, *b])
            .collect()
    }

    pub fn len(&self) -> usize {
        self.l.len()
    }

    pub fn is_empty(&self) -> bool {
        self.l.is_empty()
    }

    /// 截断或补零到 `n`。
    pub fn resize(&mut self, n: usize) {
        self.l.resize(n, 0.0);
        self.r.resize(n, 0.0);
    }

    /// 两声道都乘 `g`。
    pub fn scale(&mut self, g: f64) {
        for v in self.l.iter_mut().chain(self.r.iter_mut()) {
            *v = (*v as f64 * g) as f32;
        }
    }

    /// 两声道逐采样乘增益曲线 `g`（长度须相同）。
    pub fn apply_gain(&mut self, g: &[f32]) {
        assert_eq!(g.len(), self.len(), "gain curve length");
        for ((l, r), g) in self.l.iter_mut().zip(self.r.iter_mut()).zip(g) {
            *l *= *g;
            *r *= *g;
        }
    }

    /// 把 `other × gain` 叠到 `offset` 起（`offset` 可为负，越界部分丢弃）。
    pub fn add_at(&mut self, other: &Stereo, offset: isize, gain: f64) {
        add_into(&mut self.l, &other.l, offset, gain);
        add_into(&mut self.r, &other.r, offset, gain);
    }

    /// 样本峰值（线性，两声道取大）。
    pub fn peak(&self) -> f64 {
        peak(&self.l).max(peak(&self.r))
    }

    /// `(l + r) / 2`。
    pub fn to_mono(&self) -> Vec<f32> {
        self.l
            .iter()
            .zip(&self.r)
            .map(|(a, b)| ((*a as f64 + *b as f64) * 0.5) as f32)
            .collect()
    }

    /// 两声道的切片视图，给多声道入口用。
    pub fn channels(&self) -> [&[f32]; 2] {
        [&self.l, &self.r]
    }
}

/// `dst[offset..] += src × gain`，越界截断。
pub fn add_into(dst: &mut [f32], src: &[f32], offset: isize, gain: f64) {
    let n = dst.len() as isize;
    let a = offset.max(0);
    let b = (offset + src.len() as isize).min(n);
    for i in a..b {
        let v = &mut dst[i as usize];
        *v = (*v as f64 + src[(i - offset) as usize] as f64 * gain) as f32;
    }
}

/// 样本峰值（线性）。
pub fn peak(x: &[f32]) -> f64 {
    x.iter().fold(0.0f64, |m, v| m.max((*v as f64).abs()))
}

/// RMS（线性）。
pub fn rms(x: &[f32]) -> f64 {
    if x.is_empty() {
        return 0.0;
    }
    libm::sqrt(x.iter().map(|v| (*v as f64) * (*v as f64)).sum::<f64>() / x.len() as f64)
}

/// 等功率声像的左右增益：`p ∈ [−1, 1]`，θ = (p+1)·π/4，`(cos θ, sin θ)·√2`（居中时两边都是 1，
/// 与参考工程 `pan2` 同口径：单声道放中间不掉电平）。
pub fn pan_gains(p: f64) -> (f64, f64) {
    let a = (p.clamp(-1.0, 1.0) + 1.0) * core::f64::consts::FRAC_PI_4;
    let (s, c) = libm::sincos(a);
    (c * core::f64::consts::SQRT_2, s * core::f64::consts::SQRT_2)
}

/// 单声道 → 立体声（等功率声像）。
pub fn pan_mono(x: &[f32], p: f64) -> Stereo {
    let (gl, gr) = pan_gains(p);
    Stereo {
        l: x.iter().map(|v| (*v as f64 * gl) as f32).collect(),
        r: x.iter().map(|v| (*v as f64 * gr) as f32).collect(),
    }
}

/// 立体声整体偏移：左右各乘 [`pan_gains`]（`p = 0` 不变）。
pub fn pan_stereo(x: &mut Stereo, p: f64) {
    if p == 0.0 {
        return;
    }
    let (gl, gr) = pan_gains(p);
    for v in x.l.iter_mut() {
        *v = (*v as f64 * gl) as f32;
    }
    for v in x.r.iter_mut() {
        *v = (*v as f64 * gr) as f32;
    }
}

/// 线性淡入 `a` 秒、淡出 `b` 秒（就地）。淡入包络 `linspace(0, 1, na)`，淡出 `linspace(1, 0, nb)`，
/// 与参考工程 `fade` 相同。
pub fn fade(x: &mut [f32], sr: f64, a: f64, b: f64) {
    let n = x.len();
    let na = samples(a, sr).min(n);
    let nb = samples(b, sr).min(n);
    let ramp = |i: usize, m: usize| {
        if m <= 1 {
            0.0
        } else {
            i as f64 / (m - 1) as f64
        }
    };
    for i in 0..na {
        x[i] = (x[i] as f64 * ramp(i, na)) as f32;
    }
    for i in 0..nb {
        let k = n - nb + i;
        x[k] = (x[k] as f64 * (1.0 - ramp(i, nb))) as f32;
    }
}

/// 立体声两声道同一淡入淡出。
pub fn fade_stereo(x: &mut Stereo, sr: f64, a: f64, b: f64) {
    fade(&mut x.l, sr, a, b);
    fade(&mut x.r, sr, a, b);
}

/// 峰值归一到 `v`（线性）。
pub fn peak_normalize(x: &mut [f32], v: f64) {
    let g = v / (peak(x) + 1e-12);
    for s in x.iter_mut() {
        *s = (*s as f64 * g) as f32;
    }
}

/// RMS 归一到 `v`（线性）。
pub fn rms_normalize(x: &mut [f32], v: f64) {
    let g = v / (rms(x) + 1e-12);
    for s in x.iter_mut() {
        *s = (*s as f64 * g) as f32;
    }
}

/// 减去整条均值（去直流）。
pub fn remove_dc(x: &mut [f32]) {
    if x.is_empty() {
        return;
    }
    let mean = x.iter().map(|v| *v as f64).sum::<f64>() / x.len() as f64;
    for s in x.iter_mut() {
        *s = (*s as f64 - mean) as f32;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pan_is_equal_power_and_unity_at_centre() {
        let (l, r) = pan_gains(0.0);
        assert!((l - 1.0).abs() < 1e-12 && (r - 1.0).abs() < 1e-12);
        for p in [-1.0, -0.4, 0.3, 1.0] {
            let (l, r) = pan_gains(p);
            assert!((l * l + r * r - 2.0).abs() < 1e-12);
        }
        let (l, r) = pan_gains(1.0);
        assert!(l.abs() < 1e-12 && r > 1.4);
    }

    #[test]
    fn fades_and_normalizers() {
        let mut x = vec![1.0f32; 1000];
        fade(&mut x, 1000.0, 0.1, 0.2);
        assert_eq!(x[0], 0.0);
        assert_eq!(x[999], 0.0);
        assert_eq!(x[500], 1.0);
        assert!((x[50] - 50.0 / 99.0).abs() < 1e-6);
        let mut y = vec![0.5f32, -2.0, 1.0];
        peak_normalize(&mut y, 1.0);
        assert!((peak(&y) - 1.0).abs() < 1e-6);
        rms_normalize(&mut y, 0.1);
        assert!((rms(&y) - 0.1).abs() < 1e-6);
        let mut z = vec![1.0f32, 3.0];
        remove_dc(&mut z);
        assert_eq!(z, vec![-1.0, 1.0]);
    }

    #[test]
    fn add_at_clips_both_ends_and_interleave_roundtrips() {
        let mut a = Stereo::zeros(4);
        let b = Stereo::dual_mono(&[1.0, 2.0, 3.0]);
        a.add_at(&b, -1, 1.0);
        a.add_at(&b, 3, 2.0);
        assert_eq!(a.l, vec![2.0, 3.0, 0.0, 2.0]);
        assert_eq!(Stereo::from_interleaved(&a.interleaved()), a);
    }
}
