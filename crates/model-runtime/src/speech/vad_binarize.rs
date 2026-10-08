//! 整段概率 → 语音区间的批量二值化（滞回 + 时长过滤）与重叠窗口的帧聚合。移植自 v2 `bcut-speech-core`。
//!
//! [`VadConfig`] 的结构体沿用 [`super::vad_stream`] 里的那一份，这里只补 v2 的预设与帧长；流式转写路径
//! 用的是 [`super::segmenter::VAD_CONFIG`]，与这里的 [`VadConfig::SILERO_DEFAULT`] 是两组参数。

use super::SpeechSegment;
use super::vad_stream::VadConfig;

impl VadConfig {
    pub const SILERO_DEFAULT: Self = Self {
        onset: 0.5,
        offset: 0.35,
        min_speech_duration: 0.25,
        min_silence_duration: 0.1,
        window_duration: 0.032,
        step_ratio: 1.0,
    };

    pub const PYANNOTE_DEFAULT: Self = Self {
        onset: 0.767,
        offset: 0.377,
        min_speech_duration: 0.136,
        min_silence_duration: 0.067,
        window_duration: 10.0,
        step_ratio: 0.1,
    };

    pub fn frame_duration(self) -> f32 {
        self.window_duration * self.step_ratio
    }
}

pub fn binarize(probs: &[f32], config: VadConfig) -> Vec<SpeechSegment> {
    binarize_until(probs, config, None)
}

/// Exclude model-only padding from a partial final inference frame before
/// applying minimum speech duration. Earlier frame timestamps stay unchanged.
pub fn binarize_with_audio_len(probs: &[f32], config: VadConfig, samples: usize, sample_rate: u32) -> Vec<SpeechSegment> {
    if samples == 0 || sample_rate == 0 {
        return Vec::new();
    }
    let exact_end = samples as f64 / f64::from(sample_rate);
    let mut end = exact_end as f32;
    // SpeechSegment stores f32 seconds. Rounding upward can place the endpoint
    // one project tick beyond the actual PCM even after bounding the frame.
    if f64::from(end) > exact_end {
        end = end.next_down();
    }
    binarize_until(probs, config, Some(end))
}

fn binarize_until(probs: &[f32], config: VadConfig, audio_end: Option<f32>) -> Vec<SpeechSegment> {
    let duration = config.frame_duration();
    if !duration.is_finite() || duration <= 0.0 {
        return Vec::new();
    }

    let mut raw = Vec::new();
    let mut in_speech = false;
    let mut speech_start = 0.0;
    for (frame, probability) in probs.iter().copied().enumerate() {
        let time = frame as f32 * duration;
        if !in_speech && probability >= config.onset {
            in_speech = true;
            speech_start = time;
        } else if in_speech && probability < config.offset {
            in_speech = false;
            raw.push(SpeechSegment {
                start: speech_start,
                end: time,
            });
        }
    }
    if in_speech {
        raw.push(SpeechSegment {
            start: speech_start,
            end: probs.len() as f32 * duration,
        });
    }
    if let Some(end) = audio_end {
        for segment in &mut raw {
            segment.end = segment.end.min(end);
        }
        raw.retain(|segment| segment.start < segment.end);
    }
    filter_durations(&raw, config)
}

pub fn filter_durations(segments: &[SpeechSegment], config: VadConfig) -> Vec<SpeechSegment> {
    let mut out: Vec<SpeechSegment> = Vec::with_capacity(segments.len());
    for segment in segments
        .iter()
        .copied()
        .filter(|segment| segment.duration() >= config.min_speech_duration)
    {
        if let Some(last) = out.last_mut()
            && segment.start - last.end < config.min_silence_duration
        {
            last.end = last.end.max(segment.end);
            continue;
        }
        out.push(segment);
    }
    out
}

/// 把相互重叠的窗口概率平均投影到全局帧轴。
pub fn aggregate_frames(
    window_probs: &[Vec<f32>],
    positions: &[(usize, usize)],
    num_samples: usize,
    sample_rate: u32,
    frame_duration: f32,
) -> Vec<f32> {
    if sample_rate == 0 || num_samples == 0 || !frame_duration.is_finite() || frame_duration <= 0.0 {
        return Vec::new();
    }
    let total_duration = num_samples as f32 / sample_rate as f32;
    let frame_count = (total_duration / frame_duration).ceil() as usize;
    if frame_count == 0 {
        return Vec::new();
    }

    let mut sums = vec![0.0; frame_count];
    let mut counts = vec![0usize; frame_count];
    for (probabilities, position) in window_probs.iter().zip(positions) {
        let window_start = position.0 as f32 / sample_rate as f32;
        for (local_frame, probability) in probabilities.iter().copied().enumerate() {
            let frame_time = window_start + local_frame as f32 * frame_duration;
            let global_frame = (frame_time / frame_duration) as usize;
            if global_frame < frame_count {
                sums[global_frame] += probability;
                counts[global_frame] += 1;
            }
        }
    }
    for (sum, count) in sums.iter_mut().zip(counts) {
        if count > 0 {
            *sum /= count as f32;
        }
    }
    sums
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vad_hysteresis_duration_and_aggregation_match_reference() {
        let config = VadConfig {
            onset: 0.5,
            offset: 0.35,
            min_speech_duration: 0.19,
            min_silence_duration: 0.15,
            window_duration: 0.1,
            step_ratio: 1.0,
        };
        let output = binarize(&[0.1, 0.7, 0.6, 0.2, 0.1, 0.8, 0.8, 0.2], config);
        assert_eq!(output.len(), 2);
        assert_eq!(output[0], SpeechSegment { start: 0.1, end: 0.3 });
        assert_eq!(output[1], SpeechSegment { start: 0.5, end: 0.7 });

        let merged = filter_durations(
            &[SpeechSegment { start: 0.0, end: 0.4 }, SpeechSegment { start: 0.5, end: 0.9 }],
            config,
        );
        assert_eq!(merged, vec![SpeechSegment { start: 0.0, end: 0.9 }]);

        let frames = aggregate_frames(&[vec![0.2, 0.4], vec![0.6, 0.8]], &[(0, 320), (160, 480)], 480, 1_600, 0.1);
        assert_eq!(frames, vec![0.2, 0.5, 0.8]);
        assert!(aggregate_frames(&[], &[], 1, 16_000, f32::NAN).is_empty());
    }

    #[test]
    fn vad_partial_frame_ends_at_pcm_boundary_without_rescaling_earlier_speech() {
        let mut probabilities = vec![0.0; 129];
        probabilities[33..112].fill(0.9);
        probabilities[116..129].fill(0.9);
        let old = binarize(&probabilities, VadConfig::SILERO_DEFAULT);
        assert!(f64::from(old.last().unwrap().end) > 4.12);
        let actual = binarize_with_audio_len(&probabilities, VadConfig::SILERO_DEFAULT, 65920, 16000);
        assert_eq!(actual.len(), old.len());
        assert_eq!(actual[0], old[0]);
        assert_eq!(actual[1].start, old[1].start);
        assert!(f64::from(actual[1].end) <= 4.12);
        assert!((f64::from(actual[1].end) - 4.12).abs() < 1.0 / 48000.0);
    }

    #[test]
    fn vad_padding_cannot_make_subthreshold_speech_long_enough_to_keep() {
        let probabilities = vec![0.9; 8]; // 256 ms model input, only 249 ms real PCM.
        assert_eq!(binarize(&probabilities, VadConfig::SILERO_DEFAULT).len(), 1);
        assert!(binarize_with_audio_len(&probabilities, VadConfig::SILERO_DEFAULT, 3984, 16000).is_empty());
        let full = binarize_with_audio_len(&probabilities, VadConfig::SILERO_DEFAULT, 4096, 16000);
        assert_eq!(full.len(), 1);
        assert_eq!((f64::from(full[0].end) * 16000.0).round(), 4096.0);
        assert!(f64::from(full[0].end) <= 0.256);
        assert!(binarize_with_audio_len(&probabilities, VadConfig::SILERO_DEFAULT, 0, 16000).is_empty());
        // This true endpoint rounds upward in f32 and must remain within PCM.
        let rounded = binarize_with_audio_len(&[0.9; 35], VadConfig::SILERO_DEFAULT, 17600, 16000);
        assert!(f64::from(rounded.last().unwrap().end) <= 1.1);
    }
}
