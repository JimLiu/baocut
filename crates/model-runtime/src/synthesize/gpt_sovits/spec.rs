//! 参考音频线性幅度谱：对照 `GPT_SoVITS/module/mel_processing.py::spectrogram_torch`
//! （`center=False`，两侧反射填充 `(n_fft - hop) / 2`，periodic Hann 窗，
//! `sqrt(re² + im² + 1e-8)`）。在 CPU 上计算，两个后端共用。

use anyhow::{Context, Result, ensure};
use realfft::RealFftPlanner;

/// `s2G2333k.json` 的 `data.filter_length` / `win_length`。
pub const N_FFT: usize = 2048;
/// `data.hop_length`。
pub const HOP_LENGTH: usize = 640;
/// 单边谱的频点数。
pub const SPEC_BINS: usize = N_FFT / 2 + 1;

/// 线性幅度谱，按 `[bins, frames]` 行优先展平（与 PyTorch `[1, bins, frames]` 布局一致）。
pub struct Spectrogram {
    pub data: Vec<f32>,
    pub frames: usize,
}

/// `F.pad(mode="reflect")`：边界样本本身不重复。
pub fn reflect_pad(samples: &[f32], pad: usize) -> Result<Vec<f32>> {
    ensure!(samples.len() > pad, "反射填充需要至少 {} 个样本，实际 {}", pad + 1, samples.len());
    let n = samples.len();
    let mut out = Vec::with_capacity(n + 2 * pad);
    out.extend((1..=pad).rev().map(|i| samples[i]));
    out.extend_from_slice(samples);
    out.extend((0..pad).map(|i| samples[n - 2 - i]));
    Ok(out)
}

pub fn spectrogram(samples: &[f32]) -> Result<Spectrogram> {
    let padded = reflect_pad(samples, (N_FFT - HOP_LENGTH) / 2)?;
    ensure!(padded.len() >= N_FFT, "参考音频太短，无法计算频谱");
    let frames = (padded.len() - N_FFT) / HOP_LENGTH + 1;
    // torch.hann_window 默认 periodic=True。
    let window: Vec<f32> = (0..N_FFT)
        .map(|n| {
            let phase = 2.0 * std::f64::consts::PI * n as f64 / N_FFT as f64;
            (0.5 - 0.5 * phase.cos()) as f32
        })
        .collect();

    let mut planner = RealFftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(N_FFT);
    let mut input = fft.make_input_vec();
    let mut spectrum = fft.make_output_vec();
    let mut scratch = fft.make_scratch_vec();
    let mut data = vec![0.0f32; SPEC_BINS * frames];
    for frame in 0..frames {
        let start = frame * HOP_LENGTH;
        for (k, slot) in input.iter_mut().enumerate() {
            *slot = padded[start + k] * window[k];
        }
        fft.process_with_scratch(&mut input, &mut spectrum, &mut scratch)
            .context("参考音频 STFT 失败")?;
        for (bin, value) in spectrum.iter().enumerate() {
            data[bin * frames + frame] = (value.norm_sqr() + 1e-8).sqrt();
        }
    }
    Ok(Spectrogram { data, frames })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reflect_pad_matches_torch() {
        let out = reflect_pad(&[0.0, 1.0, 2.0, 3.0, 4.0], 2).unwrap();
        assert_eq!(out, vec![2.0, 1.0, 0.0, 1.0, 2.0, 3.0, 4.0, 3.0, 2.0]);
        assert!(reflect_pad(&[0.0, 1.0], 2).is_err());
    }

    #[test]
    fn spectrogram_shape_and_peak_bin() {
        // 1 秒 32 kHz：(32000 + 1408 - 2048) / 640 + 1 = 50 帧。
        let sample_rate = 32_000.0f32;
        let freq = 1000.0f32; // 恰好落在第 64 个频点
        let samples: Vec<f32> = (0..32_000)
            .map(|n| (2.0 * std::f32::consts::PI * freq * n as f32 / sample_rate).sin())
            .collect();
        let spec = spectrogram(&samples).unwrap();
        assert_eq!(spec.frames, 50);
        assert_eq!(spec.data.len(), SPEC_BINS * 50);
        let frame = 25;
        let column: Vec<f32> = (0..SPEC_BINS).map(|bin| spec.data[bin * spec.frames + frame]).collect();
        let peak = column
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .map(|(bin, _)| bin)
            .unwrap();
        assert_eq!(peak, 64);
        // Hann 窗和为 N/2，单位正弦幅度谱峰值约 N/4。
        assert!((column[64] - 512.0).abs() < 1.0, "{}", column[64]);
        // 静音频点只剩 sqrt(1e-8) 的底噪。
        let silent = spectrogram(&vec![0.0; 4000]).unwrap();
        assert!(silent.data.iter().all(|v| (v - 1e-4).abs() < 1e-6));
    }
}
