//! 标量基 2 复数 FFT（迭代、原地），旋转因子由 `libm` 算。
//!
//! 为什么不用 `rustfft`：见 crate 文档「确定性」一段。这里只做离线渲染用得到的两件事——
//! 塑形噪声（[`crate::noise`]）与分块卷积（[`crate::reverb`]）——长度一律补到 2 的幂。

use crate::math::TAU;

/// 一个长度的 FFT 计划：旋转因子表与位反转表。复用它可以省掉重复的 `sin` / `cos`。
#[derive(Clone, Debug)]
pub struct Fft {
    n: usize,
    cos: Vec<f64>,
    sin: Vec<f64>,
    rev: Vec<u32>,
}

impl Fft {
    /// `n` 必须是 2 的幂且 ≥ 2。
    pub fn new(n: usize) -> Self {
        assert!(
            n >= 2 && n.is_power_of_two(),
            "FFT length must be a power of two, got {n}"
        );
        let half = n / 2;
        let mut cos = Vec::with_capacity(half);
        let mut sin = Vec::with_capacity(half);
        for k in 0..half {
            let (s, c) = libm::sincos(TAU * k as f64 / n as f64);
            cos.push(c);
            sin.push(s);
        }
        let bits = n.trailing_zeros();
        let rev = (0..n as u32)
            .map(|i| i.reverse_bits() >> (32 - bits))
            .collect();
        Self { n, cos, sin, rev }
    }

    pub fn len(&self) -> usize {
        self.n
    }

    pub fn is_empty(&self) -> bool {
        self.n == 0
    }

    /// 正变换：`X[k] = Σ x[n]·e^{-2πikn/N}`（不归一）。
    pub fn forward(&self, re: &mut [f64], im: &mut [f64]) {
        self.transform(re, im, -1.0);
    }

    /// 逆变换，含 `1/N` 归一：`inverse(forward(x)) == x`（浮点误差内）。
    pub fn inverse(&self, re: &mut [f64], im: &mut [f64]) {
        self.transform(re, im, 1.0);
        let scale = 1.0 / self.n as f64;
        for v in re.iter_mut() {
            *v *= scale;
        }
        for v in im.iter_mut() {
            *v *= scale;
        }
    }

    fn transform(&self, re: &mut [f64], im: &mut [f64], sign: f64) {
        let n = self.n;
        assert!(
            re.len() == n && im.len() == n,
            "FFT buffers must have length {n}"
        );
        for i in 0..n {
            let j = self.rev[i] as usize;
            if j > i {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let mut size = 2;
        while size <= n {
            let half = size / 2;
            let step = n / size;
            let mut start = 0;
            while start < n {
                for k in 0..half {
                    let wr = self.cos[k * step];
                    let wi = sign * self.sin[k * step];
                    let a = start + k;
                    let b = a + half;
                    let tr = re[b] * wr - im[b] * wi;
                    let ti = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
                start += size;
            }
            size *= 2;
        }
    }
}

/// 两条实信号一次复数 FFT：把 `a + i·b` 变换后拆开，返回 `(A, B)` 的实部与虚部（全长 N）。
pub fn forward_pair(fft: &Fft, a: &[f64], b: &[f64]) -> ([Vec<f64>; 2], [Vec<f64>; 2]) {
    let n = fft.len();
    let mut re = vec![0.0; n];
    let mut im = vec![0.0; n];
    re[..a.len()].copy_from_slice(a);
    im[..b.len()].copy_from_slice(b);
    fft.forward(&mut re, &mut im);
    let mut ar = vec![0.0; n];
    let mut ai = vec![0.0; n];
    let mut br = vec![0.0; n];
    let mut bi = vec![0.0; n];
    for k in 0..n {
        let m = (n - k) % n;
        // A[k] = (Z[k] + conj Z[N−k]) / 2,  B[k] = (Z[k] − conj Z[N−k]) / 2i
        ar[k] = 0.5 * (re[k] + re[m]);
        ai[k] = 0.5 * (im[k] - im[m]);
        br[k] = 0.5 * (im[k] + im[m]);
        bi[k] = -0.5 * (re[k] - re[m]);
    }
    ([ar, ai], [br, bi])
}

/// 不小于 `n` 的 2 的幂（至少 2）。
pub fn next_pow2(n: usize) -> usize {
    n.max(2).next_power_of_two()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn naive_dft(re: &[f64], im: &[f64]) -> (Vec<f64>, Vec<f64>) {
        let n = re.len();
        let mut or = vec![0.0; n];
        let mut oi = vec![0.0; n];
        for k in 0..n {
            for t in 0..n {
                let (s, c) = libm::sincos(-TAU * (k * t) as f64 / n as f64);
                or[k] += re[t] * c - im[t] * s;
                oi[k] += re[t] * s + im[t] * c;
            }
        }
        (or, oi)
    }

    #[test]
    fn matches_naive_dft_and_round_trips() {
        let n = 64;
        let mut rng = crate::Rng::new(3);
        let re0: Vec<f64> = (0..n).map(|_| rng.normal()).collect();
        let im0: Vec<f64> = (0..n).map(|_| rng.normal()).collect();
        let (er, ei) = naive_dft(&re0, &im0);
        let fft = Fft::new(n);
        let (mut re, mut im) = (re0.clone(), im0.clone());
        fft.forward(&mut re, &mut im);
        for k in 0..n {
            assert!(
                (re[k] - er[k]).abs() < 1e-9 && (im[k] - ei[k]).abs() < 1e-9,
                "bin {k}"
            );
        }
        fft.inverse(&mut re, &mut im);
        for k in 0..n {
            assert!((re[k] - re0[k]).abs() < 1e-12 && (im[k] - im0[k]).abs() < 1e-12);
        }
    }

    #[test]
    fn pair_split_recovers_each_real_spectrum() {
        let n = 32;
        let mut rng = crate::Rng::new(5);
        let a: Vec<f64> = (0..n).map(|_| rng.normal()).collect();
        let b: Vec<f64> = (0..n).map(|_| rng.normal()).collect();
        let fft = Fft::new(n);
        let ([ar, ai], [br, bi]) = forward_pair(&fft, &a, &b);
        let (ea_r, ea_i) = naive_dft(&a, &vec![0.0; n]);
        let (eb_r, eb_i) = naive_dft(&b, &vec![0.0; n]);
        for k in 0..n {
            assert!((ar[k] - ea_r[k]).abs() < 1e-9 && (ai[k] - ea_i[k]).abs() < 1e-9);
            assert!((br[k] - eb_r[k]).abs() < 1e-9 && (bi[k] - eb_i[k]).abs() < 1e-9);
        }
    }
}
