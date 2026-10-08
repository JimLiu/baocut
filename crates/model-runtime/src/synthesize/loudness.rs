//! 合成结果的峰值上限：每只引擎的输出都经 [`PeakLimited`]（[`crate::synthesize::load`] 套的最外层），
//! 整段峰值高于 [`PEAK_CEILING`]（−1 dBFS）时等比缩小到它。只缩不放：安静的输出原样交出；不做压缩。
//!
//! Qwen3-TTS Base 的 codec 解码器原样输出常到满幅之上（v2 在解码器末尾硬裁到 [-1, 1]，约 3% 的样本削平），
//! 所以解码器不再裁、由这里按裁之前的峰值整段缩小；分块合成的各块用同一个增益，块与块之间音量不跳。

use anyhow::Result;

use super::readings::{Annotated, Rendered};
use super::types::{TtsAudio, TtsEngineKind, TtsRequest};
use super::{ProgressSink, TtsEngine};

/// −1 dBFS（满幅为 1）：`10^(−1/20)`。
pub const PEAK_CEILING: f32 = 0.891_250_9;

/// 把非有限的样本置零，峰值高于 [`PEAK_CEILING`] 时整段等比缩到它。返回乘上去的增益（没缩时 `None`）。
pub fn limit_peak(samples: &mut [f32]) -> Option<f32> {
    for sample in samples.iter_mut() {
        if !sample.is_finite() {
            *sample = 0.0;
        }
    }
    let peak = samples.iter().fold(0.0_f32, |max, s| max.max(s.abs()));
    if peak <= PEAK_CEILING {
        return None;
    }
    let gain = PEAK_CEILING / peak;
    for sample in samples.iter_mut() {
        *sample = (*sample * gain).clamp(-PEAK_CEILING, PEAK_CEILING);
    }
    Some(gain)
}

/// [`crate::synthesize::load`] 返回的最外层包装：合成结果过一遍 [`limit_peak`]。
pub struct PeakLimited {
    inner: Box<dyn TtsEngine>,
}

impl PeakLimited {
    pub fn new(inner: Box<dyn TtsEngine>) -> Self {
        Self { inner }
    }
}

impl TtsEngine for PeakLimited {
    fn kind(&self) -> TtsEngineKind {
        self.inner.kind()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn preset_speakers(&self) -> Vec<String> {
        self.inner.preset_speakers()
    }

    fn render_readings(&self, annotated: &Annotated) -> Rendered {
        self.inner.render_readings(annotated)
    }

    fn synthesize(&mut self, request: &TtsRequest, progress: ProgressSink<'_>) -> Result<TtsAudio> {
        let mut audio = self.inner.synthesize(request, progress)?;
        if let Some(gain) = limit_peak(&mut audio.samples) {
            eprintln!(
                "[{}] 峰值超过 −1 dBFS，整段乘 {gain:.3}（{:.2} dB）",
                self.inner.kind().as_str(),
                20.0 * gain.log10()
            );
        }
        Ok(audio)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peak(samples: &[f32]) -> f32 {
        samples.iter().fold(0.0_f32, |max, s| max.max(s.abs()))
    }

    #[test]
    fn hot_audio_is_scaled_down_to_the_ceiling() {
        let mut samples: Vec<f32> = (0..1000).map(|i| (i as f32 / 10.0).sin() * 1.4).collect();
        let original = samples.clone();
        let gain = limit_peak(&mut samples).expect("应当缩小");
        assert!((peak(&samples) - PEAK_CEILING).abs() < 1e-6, "峰值 {}", peak(&samples));
        assert!((gain - PEAK_CEILING / peak(&original)).abs() < 1e-6);
        // 等比缩小：波形形状不变，没有削平。
        for (out, before) in samples.iter().zip(&original) {
            assert!((out - before * gain).abs() < 1e-6);
        }
    }

    #[test]
    fn quiet_audio_is_untouched() {
        let mut samples: Vec<f32> = (0..1000).map(|i| (i as f32 / 10.0).sin() * 0.3).collect();
        let original = samples.clone();
        assert_eq!(limit_peak(&mut samples), None);
        assert_eq!(samples, original);
        // 正好在上限上也不动。
        let mut edge = vec![0.1, -PEAK_CEILING, 0.2];
        assert_eq!(limit_peak(&mut edge), None);
        assert_eq!(edge, vec![0.1, -PEAK_CEILING, 0.2]);
        assert_eq!(limit_peak(&mut []), None);
    }

    #[test]
    fn non_finite_samples_are_zeroed_without_silencing_the_rest() {
        let mut samples = vec![0.5, f32::NAN, -0.25, f32::INFINITY, f32::NEG_INFINITY, 0.75];
        assert_eq!(limit_peak(&mut samples), None);
        assert_eq!(samples, vec![0.5, 0.0, -0.25, 0.0, 0.0, 0.75]);

        let mut hot = vec![1.2, f32::INFINITY, -0.6, f32::NAN];
        let gain = limit_peak(&mut hot).expect("应当缩小");
        assert!((gain - PEAK_CEILING / 1.2).abs() < 1e-6);
        assert!((hot[0] - PEAK_CEILING).abs() < 1e-6);
        assert_eq!(hot[1], 0.0);
        assert!((hot[2] + 0.6 * gain).abs() < 1e-6);
        assert_eq!(hot[3], 0.0);
    }

    struct Hot;

    impl TtsEngine for Hot {
        fn kind(&self) -> TtsEngineKind {
            TtsEngineKind::Qwen3Tts
        }

        fn sample_rate(&self) -> u32 {
            24_000
        }

        fn synthesize(&mut self, _request: &TtsRequest, _progress: ProgressSink<'_>) -> Result<TtsAudio> {
            Ok(TtsAudio {
                samples: vec![0.2, -2.0, 1.0],
                sample_rate: 24_000,
                readings_dropped: Vec::new(),
            })
        }
    }

    #[test]
    fn the_wrapper_limits_what_the_engine_returns() {
        let mut engine = PeakLimited::new(Box::new(Hot));
        let audio = engine
            .synthesize(&TtsRequest::new("hi", super::super::VoiceSpec::Default), &mut |_| true)
            .unwrap();
        assert!((peak(&audio.samples) - PEAK_CEILING).abs() < 1e-6);
        assert!((audio.samples[0] - 0.1 * PEAK_CEILING).abs() < 1e-6);
    }
}
