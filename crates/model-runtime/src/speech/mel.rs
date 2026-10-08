//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/Qwen3ASR/AudioPreprocessing.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Whisper 风格的 128-mel 前端（Qwen3-ASR 用）：16 kHz、n_fft 400、hop 160、补零到 512 点 FFT、
//! 功率乘 4（对齐 Swift vDSP 的振幅约定）、Slaney 滤波器组。常量与旧实现逐位一致，不要改。

use std::sync::Arc;

use anyhow::{Context, Result};
use realfft::{RealFftPlanner, RealToComplex};

#[derive(Debug, Clone, PartialEq)]
pub struct TimeMajorMelFeatures {
    pub data: Vec<f32>,
    pub mel_bins: usize,
    pub time_frames: usize,
}

/// 与 Swift `WhisperFeatureExtractor` 数值语义一致的 Whisper mel 前端。
pub struct WhisperFeaturePipeline {
    pub sample_rate: usize,
    pub n_fft: usize,
    pub hop_length: usize,
    pub n_mels: usize,
    pub padded_fft: usize,
    pub maximum_frames: usize,
    power_scale: f32,
    hann_window: Vec<f32>,
    mel_filterbank: Vec<f32>,
    fft: Arc<dyn RealToComplex<f32>>,
}

impl std::fmt::Debug for WhisperFeaturePipeline {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WhisperFeaturePipeline")
            .field("sample_rate", &self.sample_rate)
            .field("n_fft", &self.n_fft)
            .field("hop_length", &self.hop_length)
            .field("n_mels", &self.n_mels)
            .field("padded_fft", &self.padded_fft)
            .field("maximum_frames", &self.maximum_frames)
            .field("power_scale", &self.power_scale)
            .finish()
    }
}

impl Default for WhisperFeaturePipeline {
    fn default() -> Self {
        Self::new(128)
    }
}

impl WhisperFeaturePipeline {
    /// Qwen3-ASR / forced aligner 使用的 Swift vDSP 兼容前端。
    pub fn new(n_mels: usize) -> Self {
        Self::with_config(16_000, 400, 160, n_mels, 512, 120_000)
    }

    /// MOSS 的标准 Whisper 前端：400 点 FFT，不做 vDSP 振幅补偿。
    pub fn moss(n_mels: usize) -> Self {
        Self::build(16_000, 400, 160, n_mels, 400, 120_000, 1.0)
    }

    pub fn with_config(
        sample_rate: usize,
        n_fft: usize,
        hop_length: usize,
        n_mels: usize,
        padded_fft: usize,
        maximum_frames: usize,
    ) -> Self {
        Self::build(sample_rate, n_fft, hop_length, n_mels, padded_fft, maximum_frames, 4.0)
    }

    fn build(
        sample_rate: usize,
        n_fft: usize,
        hop_length: usize,
        n_mels: usize,
        padded_fft: usize,
        maximum_frames: usize,
        power_scale: f32,
    ) -> Self {
        assert!(sample_rate > 0);
        assert!(n_fft > 0 && hop_length > 0);
        assert!(padded_fft >= n_fft);
        assert!(n_mels > 0);
        assert!(power_scale.is_finite() && power_scale > 0.0);
        let hann_window = (0..n_fft)
            .map(|index| 0.5 * (1.0 - (2.0 * std::f32::consts::PI * index as f32 / n_fft as f32).cos()))
            .collect();
        let mel_filterbank = make_slaney_filterbank(sample_rate, padded_fft, n_mels);
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(padded_fft);
        Self {
            sample_rate,
            n_fft,
            hop_length,
            n_mels,
            padded_fft,
            maximum_frames,
            power_scale,
            hann_window,
            mel_filterbank,
            fft,
        }
    }

    pub fn maximum_analyzed_samples(&self) -> usize {
        self.maximum_frames * self.hop_length + (self.n_fft - self.n_fft / 2).saturating_sub(self.hop_length)
    }

    pub fn analyzed_sample_count(&self, input_count: usize) -> usize {
        input_count.min(self.maximum_analyzed_samples())
    }

    pub fn filterbank(&self) -> &[f32] {
        &self.mel_filterbank
    }

    pub fn extract(&self, audio: &[f32]) -> Result<TimeMajorMelFeatures> {
        if audio.is_empty() {
            return Ok(TimeMajorMelFeatures {
                data: Vec::new(),
                mel_bins: self.n_mels,
                time_frames: 0,
            });
        }

        let analyzed_count = self.analyzed_sample_count(audio.len());
        let pad_length = self.n_fft / 2;
        let mut padded_audio = vec![0.0; pad_length + analyzed_count + pad_length];
        for (index, target) in padded_audio[..pad_length].iter_mut().enumerate() {
            let source = (pad_length - index).min(analyzed_count.saturating_sub(1));
            *target = audio[source];
        }
        padded_audio[pad_length..pad_length + analyzed_count].copy_from_slice(&audio[..analyzed_count]);
        for index in 0..pad_length {
            let source = analyzed_count.saturating_sub(2 + index);
            padded_audio[pad_length + analyzed_count + index] = audio[source];
        }

        let frame_count = (padded_audio.len() - self.n_fft) / self.hop_length + 1;
        let frequency_bins = self.padded_fft / 2 + 1;
        let mut padded_frame = vec![0.0; self.padded_fft];
        let mut spectrum = self.fft.make_output_vec();
        let mut scratch = self.fft.make_scratch_vec();
        let mut magnitude = vec![0.0; frame_count * frequency_bins];

        for frame in 0..frame_count {
            let start = frame * self.hop_length;
            for index in 0..self.n_fft {
                padded_frame[index] = padded_audio[start + index] * self.hann_window[index];
            }
            self.fft
                .process_with_scratch(&mut padded_frame, &mut spectrum, &mut scratch)
                .context("执行 512 点 real FFT")?;
            let base = frame * frequency_bins;
            for (bin, value) in spectrum.iter().enumerate() {
                // Qwen 的 Swift vDSP 路径需要 4 倍功率补偿；MOSS 使用标准 DFT。
                magnitude[base + bin] = self.power_scale * (value.re * value.re + value.im * value.im);
            }
        }

        let mut mel = vec![0.0; frame_count * self.n_mels];
        for frame in 0..frame_count {
            let magnitude_row = &magnitude[frame * frequency_bins..(frame + 1) * frequency_bins];
            let output_row = &mut mel[frame * self.n_mels..(frame + 1) * self.n_mels];
            for (frequency, power) in magnitude_row.iter().copied().enumerate() {
                let filter_row = &self.mel_filterbank[frequency * self.n_mels..(frequency + 1) * self.n_mels];
                for mel_bin in 0..self.n_mels {
                    output_row[mel_bin] += power * filter_row[mel_bin];
                }
            }
        }
        normalize_log_mel(&mut mel);

        // Swift 与 Whisper 一致地丢弃最后一帧，再应用 1200 秒上限。
        let retained_frames = frame_count.saturating_sub(1).min(self.maximum_frames);
        mel.truncate(retained_frames * self.n_mels);
        Ok(TimeMajorMelFeatures {
            data: mel,
            mel_bins: self.n_mels,
            time_frames: retained_frames,
        })
    }
}

pub fn make_slaney_filterbank(sample_rate: usize, fft_size: usize, mel_bins: usize) -> Vec<f32> {
    const MIN_LOG_HERTZ: f32 = 1_000.0;
    const MIN_LOG_MEL: f32 = 15.0;
    let hertz_to_mel_step = 27.0 / 6.4f32.ln();
    let mel_to_hertz_step = 6.4f32.ln() / 27.0;
    let hertz_to_mel = |hertz: f32| {
        if hertz < MIN_LOG_HERTZ {
            3.0 * hertz / 200.0
        } else {
            MIN_LOG_MEL + (hertz / MIN_LOG_HERTZ).ln() * hertz_to_mel_step
        }
    };
    let mel_to_hertz = |mel: f32| {
        if mel < MIN_LOG_MEL {
            200.0 * mel / 3.0
        } else {
            MIN_LOG_HERTZ * ((mel - MIN_LOG_MEL) * mel_to_hertz_step).exp()
        }
    };

    let frequency_bins = fft_size / 2 + 1;
    let point_count = mel_bins + 2;
    let minimum_mel = hertz_to_mel(0.0);
    let maximum_mel = hertz_to_mel(sample_rate as f32 / 2.0);
    let frequencies: Vec<f32> = (0..point_count)
        .map(|index| {
            let mel = minimum_mel + index as f32 * (maximum_mel - minimum_mel) / (point_count - 1) as f32;
            mel_to_hertz(mel)
        })
        .collect();
    let differences: Vec<f32> = frequencies.windows(2).map(|pair| pair[1] - pair[0]).collect();
    let mut matrix = vec![0.0; frequency_bins * mel_bins];
    for bin in 0..frequency_bins {
        let hertz = bin as f32 * sample_rate as f32 / fft_size as f32;
        for mel in 0..mel_bins {
            let rising = (hertz - frequencies[mel]) / differences[mel];
            let falling = (frequencies[mel + 2] - hertz) / differences[mel + 1];
            let normalization = 2.0 / (frequencies[mel + 2] - frequencies[mel]);
            matrix[bin * mel_bins + mel] = rising.min(falling).max(0.0) * normalization;
        }
    }
    matrix
}

fn normalize_log_mel(values: &mut [f32]) {
    if values.is_empty() {
        return;
    }
    for value in values.iter_mut() {
        *value = value.max(1e-10).log10();
    }
    let peak = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let floor = peak - 8.0;
    for value in values {
        *value = value.max(floor) * 0.25 + 1.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qwen_front_end_constants_are_fixed() {
        let pipeline = WhisperFeaturePipeline::new(128);
        assert_eq!(
            (pipeline.sample_rate, pipeline.n_fft, pipeline.hop_length, pipeline.padded_fft),
            (16_000, 400, 160, 512)
        );
        assert_eq!(pipeline.filterbank().len(), 257 * 128);
        assert!(format!("{pipeline:?}").contains("power_scale: 4.0"));
    }

    #[test]
    fn moss_front_end_uses_the_plain_400_point_dft() {
        let pipeline = WhisperFeaturePipeline::moss(128);
        assert_eq!(
            (pipeline.sample_rate, pipeline.n_fft, pipeline.hop_length, pipeline.padded_fft),
            (16_000, 400, 160, 400)
        );
        assert_eq!(pipeline.filterbank().len(), 201 * 128);
        assert!(format!("{pipeline:?}").contains("power_scale: 1.0"));
    }

    #[test]
    fn one_second_gives_one_hundred_frames() {
        let pipeline = WhisperFeaturePipeline::new(128);
        let audio: Vec<f32> = (0..16_000).map(|i| (i as f32 * 0.05).sin() * 0.1).collect();
        let features = pipeline.extract(&audio).unwrap();
        assert_eq!(features.time_frames, 100);
        assert_eq!(features.data.len(), 100 * 128);
        assert!(features.data.iter().all(|value| value.is_finite()));
        assert!(pipeline.extract(&[]).unwrap().data.is_empty());
    }

    // ---- 以下三个移植自 v2 `bcut-speech/tests/frontend.rs` ----

    fn assert_close(actual: f32, expected: f32, tolerance: f32) {
        assert!((actual - expected).abs() <= tolerance, "{actual} != {expected} ± {tolerance}");
    }

    #[test]
    fn mel_matches_reference_shape_and_values() -> Result<()> {
        let extractor = WhisperFeaturePipeline::default();
        let audio: Vec<f32> = (0..640)
            .map(|index| {
                let phase = 2.0 * std::f32::consts::PI * index as f32 / 16_000.0;
                0.5 * (440.0 * phase).sin() + 0.1 * (880.0 * phase).cos()
            })
            .collect();
        let features = extractor.extract(&audio)?;
        assert_eq!(features.time_frames, 4);
        assert_eq!(features.mel_bins, 128);
        let bins = [0, 10, 20, 40, 80, 127];
        let times = [0, 1, 3];
        let mut actual = Vec::new();
        for bin in bins {
            for time in times {
                actual.push(features.data[time * features.mel_bins + bin]);
            }
        }
        let expected = [
            1.147207,
            0.6311569,
            0.6384567,
            1.2349797,
            0.7076531,
            0.71311843,
            1.4889886,
            1.3172512,
            1.3163909,
            0.86986357,
            0.7364866,
            0.7464911,
            0.42519808,
            -0.08413434,
            -0.026718974,
            0.095237315,
            -0.3798976,
            -0.36192143,
        ];
        for (actual, expected) in actual.into_iter().zip(expected) {
            // 两套 FFT 实现的浮点累加次序不同，逐值容差 1e-4。
            assert_close(actual, expected, 1e-4);
        }
        Ok(())
    }

    #[test]
    fn mel_empty_silence_filterbank_and_limit_are_stable() -> Result<()> {
        let extractor = WhisperFeaturePipeline::default();
        let empty = extractor.extract(&[])?;
        assert_eq!(empty.time_frames, 0);
        assert_eq!(empty.mel_bins, 128);
        let silent = extractor.extract(&[0.0; 320])?;
        assert_eq!(silent.time_frames, 2);
        assert_eq!(silent.data.len(), 256);
        for value in silent.data {
            assert_close(value, -1.5, 1e-6);
        }
        assert_eq!(extractor.maximum_frames, 120_000);
        assert_eq!(extractor.maximum_analyzed_samples(), 19_200_040);
        assert_eq!(extractor.filterbank().len(), 257 * 128);
        assert!(extractor.filterbank().iter().filter(|value| **value > 0.0).count() > 128);
        Ok(())
    }

    #[test]
    fn moss_mel_uses_standard_400_point_whisper_frontend() -> Result<()> {
        let extractor = WhisperFeaturePipeline::moss(80);
        assert_eq!(extractor.n_fft, 400);
        assert_eq!(extractor.padded_fft, 400);
        assert_eq!(extractor.filterbank().len(), 201 * 80);

        let silent = extractor.extract(&[0.0; 320])?;
        assert_eq!(silent.time_frames, 2);
        assert_eq!(silent.mel_bins, 80);
        assert!(silent.data.iter().all(|value| (*value + 1.5).abs() < 1e-6));

        let tone: Vec<f32> = (0..640)
            .map(|index| {
                let phase = 2.0 * std::f32::consts::PI * index as f32 / 16_000.0;
                0.5 * (440.0 * phase).sin()
            })
            .collect();
        let features = extractor.extract(&tone)?;
        assert_eq!(features.time_frames, 4);
        assert!(features.data.iter().all(|value| value.is_finite()));
        Ok(())
    }
}
