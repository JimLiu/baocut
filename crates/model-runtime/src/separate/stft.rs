//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/SourceSeparation/HTDemucs/HTDemucsSpec.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! HTDemucs 的 STFT / iSTFT 与 demucs `_spec` / `_ispec` 的 pad / 裁剪算术（CPU，realfft）。
//!
//! 对照 speech-swift `HTDemucsSpec.swift`：模型会用自身输入的 mean/std 归一化幅度谱，
//! 所以整条流水线对 STFT 的全局比例不敏感，只要正逆变换是一对可完美重建的
//! 变换（COLA 周期 Hann，hop = nfft/4），再配上 demucs 精确的 pad / 裁剪，
//! 频域分支与时域分支的长度就能对齐。约定跟随 `torch.stft(center=True,
//! pad_mode="reflect")`，比例差由归一化抵消。
//!
//! 复数谱的布局统一为频率优先 `[freqs][frames]`（与模型的 `[C, Fr, T]` 一致）。

use anyhow::{Result, bail};
use realfft::num_complex::Complex;
use realfft::{ComplexToReal, RealFftPlanner, RealToComplex};
use std::sync::Arc;

pub type Complex32 = Complex<f32>;

/// 单声道 STFT 计划：窗、正逆 FFT 与 demucs 的 pad 参数。
pub struct Spectrogram {
    nfft: usize,
    hop: usize,
    window: Vec<f32>,
    forward: Arc<dyn RealToComplex<f32>>,
    inverse: Arc<dyn ComplexToReal<f32>>,
}

/// `spec` 的输出：`nfft/2` 个频率 bin × `frames` 帧，频率优先。
#[derive(Debug, Clone, PartialEq)]
pub struct Spectrum {
    pub bins: usize,
    pub frames: usize,
    pub data: Vec<Complex32>,
}

impl Spectrum {
    pub fn zeros(bins: usize, frames: usize) -> Self {
        Self {
            bins,
            frames,
            data: vec![Complex32::new(0.0, 0.0); bins * frames],
        }
    }

    #[inline]
    pub fn at(&self, bin: usize, frame: usize) -> Complex32 {
        self.data[bin * self.frames + frame]
    }
}

impl Spectrogram {
    pub fn new(nfft: usize, hop: usize) -> Result<Self> {
        if nfft == 0 || hop == 0 || !nfft.is_multiple_of(hop) || !nfft.is_multiple_of(2) {
            bail!("STFT 参数无效：nfft {nfft} hop {hop}（要求 nfft 为偶数且是 hop 的倍数）");
        }
        // 周期 Hann（torch.hann_window 默认 periodic=True）。
        let window = (0..nfft)
            .map(|i| (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / nfft as f64).cos()) as f32)
            .collect();
        let mut planner = RealFftPlanner::<f32>::new();
        Ok(Self {
            nfft,
            hop,
            window,
            forward: planner.plan_fft_forward(nfft),
            inverse: planner.plan_fft_inverse(nfft),
        })
    }

    pub fn nfft(&self) -> usize {
        self.nfft
    }

    pub fn hop(&self) -> usize {
        self.hop
    }

    /// demucs `_spec` 输出的帧数：`ceil(T / hop)`。
    pub fn frames_for(&self, length: usize) -> usize {
        length.div_ceil(self.hop)
    }

    /// torch "reflect" 填充：左侧取 `x[left..=1]`，右侧取 `x[L-2..=L-1-right]`，不重复边缘样本。
    pub fn reflect_pad(x: &[f32], left: usize, right: usize) -> Result<Vec<f32>> {
        let len = x.len();
        if len < 2 || left >= len || right >= len {
            bail!("reflect 填充超出范围：长度 {len}，左 {left}，右 {right}");
        }
        let mut out = Vec::with_capacity(left + len + right);
        out.extend((1..=left).rev().map(|i| x[i]));
        out.extend_from_slice(x);
        out.extend((0..right).map(|i| x[len - 2 - i]));
        Ok(out)
    }

    /// `torch.stft` 等价：实数序列 → 复数谱 `[nfft/2+1][frames]`，
    /// center=True（两侧 reflect 填充 nfft/2），周期 Hann。
    pub fn stft(&self, x: &[f32]) -> Result<Spectrum> {
        let pad = self.nfft / 2;
        let xp = Self::reflect_pad(x, pad, pad)?;
        let frames = 1 + (xp.len() - self.nfft) / self.hop;
        let bins = self.nfft / 2 + 1;
        let mut out = Spectrum::zeros(bins, frames);
        let mut input = vec![0.0f32; self.nfft];
        let mut output = vec![Complex32::new(0.0, 0.0); bins];
        let mut scratch = self.forward.make_scratch_vec();
        for f in 0..frames {
            let start = f * self.hop;
            for (k, v) in input.iter_mut().enumerate() {
                *v = xp[start + k] * self.window[k];
            }
            self.forward
                .process_with_scratch(&mut input, &mut output, &mut scratch)
                .map_err(|e| anyhow::anyhow!("rfft 失败：{e}"))?;
            for (k, v) in output.iter().enumerate() {
                out.data[k * frames + f] = *v;
            }
        }
        Ok(out)
    }

    /// `stft` 的逆：复数谱 `[nfft/2+1][frames]` → 长度 `length` 的实数序列。
    /// 逐帧 irfft × 窗后 overlap-add，再除以窗² 的 overlap-add（下限 1e-8），最后裁掉 center 填充。
    pub fn istft(&self, z: &Spectrum, length: usize) -> Result<Vec<f32>> {
        let bins = self.nfft / 2 + 1;
        if z.bins != bins {
            bail!("istft 期望 {bins} 个频率 bin，实际 {}", z.bins);
        }
        let frames = z.frames;
        let total = (frames - 1) * self.hop + self.nfft;
        let mut accum = vec![0.0f32; total];
        let mut win_sum = vec![0.0f32; total];
        let mut spectrum = vec![Complex32::new(0.0, 0.0); bins];
        let mut frame = vec![0.0f32; self.nfft];
        let mut scratch = self.inverse.make_scratch_vec();
        let scale = 1.0 / self.nfft as f32;
        for f in 0..frames {
            for (k, v) in spectrum.iter_mut().enumerate() {
                *v = z.data[k * frames + f];
            }
            // 与 torch.irfft 一样忽略直流与 Nyquist 的虚部（realfft 会对此报错）。
            spectrum[0].im = 0.0;
            spectrum[bins - 1].im = 0.0;
            self.inverse
                .process_with_scratch(&mut spectrum, &mut frame, &mut scratch)
                .map_err(|e| anyhow::anyhow!("irfft 失败：{e}"))?;
            let start = f * self.hop;
            for k in 0..self.nfft {
                let w = self.window[k];
                accum[start + k] += frame[k] * scale * w;
                win_sum[start + k] += w * w;
            }
        }
        let pad = self.nfft / 2;
        if pad + length > total {
            bail!("istft 输出长度 {length} 超出可重建范围 {}", total - pad);
        }
        Ok((pad..pad + length).map(|i| accum[i] / win_sum[i].max(1e-8)).collect())
    }

    /// `htdemucs._spec`：实数序列 → `[nfft/2][le]`，`le = ceil(T/hop)`。
    /// 额外 reflect 填充 + 去掉最高频 bin + 两侧各裁 2 帧，保证 `out_size == in_size/hop`
    /// 并与时域分支对齐。
    pub fn spec(&self, x: &[f32]) -> Result<Spectrum> {
        let len = x.len();
        let le = self.frames_for(len);
        let pad = self.hop / 2 * 3;
        let xp = Self::reflect_pad(x, pad, pad + le * self.hop - len)?;
        let z = self.stft(&xp)?;
        if z.frames < 2 + le {
            bail!("spec 帧数不足：{} < {}", z.frames, 2 + le);
        }
        let bins = self.nfft / 2;
        let mut out = Spectrum::zeros(bins, le);
        for k in 0..bins {
            let src = &z.data[k * z.frames + 2..k * z.frames + 2 + le];
            out.data[k * le..(k + 1) * le].copy_from_slice(src);
        }
        Ok(out)
    }

    /// `htdemucs._ispec`：`[nfft/2][le]` → 长度 `length` 的实数序列。
    pub fn ispec(&self, z: &Spectrum, length: usize) -> Result<Vec<f32>> {
        let bins = self.nfft / 2;
        if z.bins != bins {
            bail!("ispec 期望 {bins} 个频率 bin，实际 {}", z.bins);
        }
        let le = z.frames;
        // 补零：频率 nfft/2 → nfft/2+1，帧两侧各补 2 帧。
        let mut zp = Spectrum::zeros(bins + 1, le + 4);
        for k in 0..bins {
            zp.data[k * (le + 4) + 2..k * (le + 4) + 2 + le].copy_from_slice(&z.data[k * le..(k + 1) * le]);
        }
        let pad = self.hop / 2 * 3;
        let le2 = self.hop * length.div_ceil(self.hop) + 2 * pad;
        let wav = self.istft(&zp, le2)?;
        Ok(wav[pad..pad + length].to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 确定性测试信号：多频正弦叠加，`noise` 为真时再加白噪声
    /// （白噪声在 Nyquist bin 有能量，只能用于不丢 bin 的纯 stft/istft 往返）。
    fn test_signal(len: usize, seed: u32, noise: bool) -> Vec<f32> {
        let mut state = seed.wrapping_mul(2_654_435_761).wrapping_add(1);
        let freqs = [440.0f32, 1_234.5, 5_000.0, 9_876.0, 15_000.0];
        (0..len)
            .map(|i| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let n = (state >> 8) as f32 / (1u32 << 24) as f32 - 0.5;
                let t = i as f32 / 44_100.0;
                let mut v = 0.0;
                for (k, f) in freqs.iter().enumerate() {
                    v += 0.4 / (k as f32 + 1.0) * (2.0 * std::f32::consts::PI * f * t).sin();
                }
                if noise { v + 0.3 * n } else { v }
            })
            .collect()
    }

    fn max_abs_diff(a: &[f32], b: &[f32]) -> f32 {
        assert_eq!(a.len(), b.len());
        a.iter().zip(b).map(|(x, y)| (x - y).abs()).fold(0.0, f32::max)
    }

    #[test]
    fn reflect_pad_matches_torch() {
        let x = [1.0, 2.0, 3.0, 4.0, 5.0];
        let padded = Spectrogram::reflect_pad(&x, 2, 3).unwrap();
        assert_eq!(padded, vec![3.0, 2.0, 1.0, 2.0, 3.0, 4.0, 5.0, 4.0, 3.0, 2.0]);
        assert!(Spectrogram::reflect_pad(&x, 5, 0).is_err());
    }

    #[test]
    fn stft_istft_roundtrip_is_exact() {
        let spec = Spectrogram::new(4096, 1024).unwrap();
        let x = test_signal(20_000, 7, true);
        let z = spec.stft(&x).unwrap();
        assert_eq!(z.bins, 2049);
        assert_eq!(z.frames, 1 + (20_000 + 4096 - 4096) / 1024);
        let y = spec.istft(&z, x.len()).unwrap();
        assert!(max_abs_diff(&x, &y) < 1e-4, "重建误差 {}", max_abs_diff(&x, &y));
    }

    #[test]
    fn spec_ispec_roundtrip_matches_demucs_shapes() {
        let spec = Spectrogram::new(4096, 1024).unwrap();
        for len in [343_980usize, 44_100, 12_345] {
            let x = test_signal(len, len as u32, false);
            let z = spec.spec(&x).unwrap();
            assert_eq!(z.bins, 2048);
            assert_eq!(z.frames, len.div_ceil(1024));
            let y = spec.ispec(&z, len).unwrap();
            assert_eq!(y.len(), len);
            // demucs 的 `_spec` 丢掉首尾各 2 帧，而 `_ispec` 的窗归一化仍按全部帧计算，
            // 所以两端约 1536 + hop 个样本会被衰减（首样本约 0.5 倍）——这是原模型的
            // 固有行为，模型端到端训练时已适应。这里只校验内部区间的精确重建，
            // 并确认边缘衰减确实存在（否则说明帧裁剪算术与 demucs 不同）。
            let edge = 3 * 1024;
            let err = max_abs_diff(&x[edge..len - edge], &y[edge..len - edge]);
            assert!(err < 1e-3, "长度 {len} 内部重建误差 {err}");
            assert!(x[10].abs() > 1e-2);
            let ratio = y[10] / x[10];
            assert!((ratio - 0.5).abs() < 0.05, "长度 {len} 边缘衰减比 {ratio}");
        }
    }

    #[test]
    fn spec_is_linear_in_scale() {
        let spec = Spectrogram::new(4096, 1024).unwrap();
        let x = test_signal(8_192, 3, true);
        let scaled: Vec<f32> = x.iter().map(|v| v * 3.0).collect();
        let a = spec.spec(&x).unwrap();
        let b = spec.spec(&scaled).unwrap();
        for (p, q) in a.data.iter().zip(&b.data) {
            assert!((p * 3.0 - q).norm() < 1e-3);
        }
    }
}
