//! 由配音算口型驱动：每个 60 Hz 模拟步取以该时刻为中心的 1024 个样本，算均方根音量，换成 0–1 的
//! 声音强度。公式与 mesh-avatar-studio 实时模式的 `rmsLevel` 相同：`clamp((rms - 0.008) × gain × 5)`。

use std::path::Path;

use anyhow::{Context, Result, ensure};

pub const TICKS_PER_SECOND: f64 = 60.0;
pub const WINDOW: usize = 1024;

/// 读 WAV，混成单声道浮点样本，返回样本与采样率。
pub fn read_mono(path: &Path) -> Result<(Vec<f32>, u32)> {
    let mut reader = hound::WavReader::open(path).with_context(|| format!("cannot read {}", path.display()))?;
    let spec = reader.spec();
    ensure!(spec.channels > 0, "{}: no audio channels", path.display());
    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().collect::<Result<_, _>>()?,
        hound::SampleFormat::Int => {
            let scale = 1.0 / (1u64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 * scale))
                .collect::<Result<_, _>>()?
        }
    };
    let channels = spec.channels as usize;
    let mono = interleaved
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect();
    Ok((mono, spec.sample_rate))
}

/// 实时模式的音量换算。
pub fn rms_level(window: &[f32], gain: f64) -> f64 {
    if window.is_empty() {
        return 0.0;
    }
    let sum: f64 = window.iter().map(|&s| (s as f64) * (s as f64)).sum();
    (((sum / window.len() as f64).sqrt() - 0.008) * gain.clamp(0.0, 10.0) * 5.0).clamp(0.0, 1.0)
}

/// 第 `tick` 个模拟步（从音频开头算）的声音强度；音频之外为 0。
pub fn level_at(samples: &[f32], rate: u32, tick: usize, gain: f64) -> f64 {
    let centre = (tick as f64 / TICKS_PER_SECOND * rate as f64).round() as isize;
    let start = (centre - WINDOW as isize / 2).max(0) as usize;
    let end = ((centre + WINDOW as isize / 2).max(0) as usize).min(samples.len());
    if start >= end {
        return 0.0;
    }
    rms_level(&samples[start..end], gain)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_is_closed_and_loud_speech_is_open() {
        assert_eq!(rms_level(&[0.0; 1024], 1.0), 0.0);
        assert_eq!(rms_level(&[0.5; 1024], 1.0), 1.0);
        let quiet = rms_level(&[0.05; 1024], 1.0);
        assert!((quiet - 0.21).abs() < 1e-6, "{quiet}");
    }

    #[test]
    fn levels_follow_the_audio_clock() {
        let rate = 24_000;
        let mut samples = vec![0.0f32; rate as usize];
        for s in &mut samples[rate as usize / 2..] {
            *s = 0.3;
        }
        assert_eq!(level_at(&samples, rate, 10, 1.0), 0.0);
        assert_eq!(level_at(&samples, rate, 45, 1.0), 1.0);
        assert_eq!(level_at(&samples, rate, 120, 1.0), 0.0);
    }
}
