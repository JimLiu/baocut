//! 语音区间 → 识别段：超过 [`MAX_SPAN`] 的区间在最后 [`CUT_SEARCH`] 秒里能量最低的 60 ms 窗口处切开，
//! 每段至少 [`MIN_PIECE`]；之后两侧各补 [`PAD`]（不越过相邻区间）。

use super::vad_stream::VadConfig;

/// 相对解码起点的语音区间（f64 秒）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpeechSpan {
    pub start: f64,
    pub end: f64,
}

impl SpeechSpan {
    pub fn duration(self) -> f64 {
        self.end - self.start
    }
}

pub const VAD_CONFIG: VadConfig = VadConfig {
    onset: 0.5,
    offset: 0.35,
    min_speech_duration: 0.25,
    min_silence_duration: 0.5,
    window_duration: 0.032,
    step_ratio: 1.0,
};
pub const MAX_SPAN: f64 = 14.5;
pub const PAD: f64 = 0.15;
pub const MIN_PIECE: f64 = 2.0;
pub const CUT_SEARCH: f64 = 4.0;

pub fn split(spans: &[SpeechSpan], samples: &[f32], sample_rate: f64) -> Vec<SpeechSpan> {
    let mut out = Vec::new();
    for span in spans.iter().copied() {
        if span.duration() <= MAX_SPAN {
            out.push(span);
            continue;
        }
        if samples.is_empty() {
            out.extend(equal_split(span));
            continue;
        }

        let mut start = span.start;
        while span.end - start > MAX_SPAN {
            let hi = (start + MAX_SPAN).min(span.end - MIN_PIECE);
            let lo = (start + MIN_PIECE).max(hi - CUT_SEARCH);
            let cut = quietest_cut(samples, lo, hi, sample_rate);
            out.push(SpeechSpan { start, end: cut });
            start = cut;
        }
        out.push(SpeechSpan { start, end: span.end });
    }
    out
}

pub fn equal_split(span: SpeechSpan) -> Vec<SpeechSpan> {
    let count = (span.duration() / MAX_SPAN).ceil() as usize;
    let step = span.duration() / count as f64;
    (0..count)
        .map(|index| SpeechSpan {
            start: span.start + index as f64 * step,
            end: if index + 1 == count {
                span.end
            } else {
                span.start + (index + 1) as f64 * step
            },
        })
        .collect()
}

pub fn quietest_cut(samples: &[f32], lo: f64, hi: f64, sample_rate: f64) -> f64 {
    let window = (0.06 * sample_rate) as usize;
    let hop = ((0.01 * sample_rate) as usize).max(1);
    let first = ((lo * sample_rate) as usize).min(samples.len());
    let last = ((hi * sample_rate) as usize).min(samples.len());
    if window == 0 || last.saturating_sub(first) <= window {
        return (lo + hi) / 2.0;
    }

    let mut prefix = vec![0.0f64; last - first + 1];
    for index in first..last {
        let value = samples[index] as f64;
        prefix[index - first + 1] = prefix[index - first] + value * value;
    }

    let mut best = f64::INFINITY;
    let mut cut = (lo + hi) / 2.0;
    let mut offset = 0;
    while offset + window <= last - first {
        let energy = prefix[offset + window] - prefix[offset];
        if energy < best {
            best = energy;
            cut = (first + offset + window / 2) as f64 / sample_rate;
        }
        offset += hop;
    }
    cut
}

pub fn padded(spans: &[SpeechSpan], duration: f64) -> Vec<SpeechSpan> {
    spans
        .iter()
        .copied()
        .enumerate()
        .map(|(index, span)| {
            let lo = if index == 0 { 0.0 } else { spans[index - 1].end };
            let hi = if index + 1 == spans.len() {
                duration
            } else {
                spans[index + 1].start
            };
            SpeechSpan {
                start: lo.max(0.0f64.max(span.start - PAD)),
                end: hi.min(duration.min(span.end + PAD)),
            }
        })
        .collect()
}

/// 补边之后相邻段可能重叠（前一段的补边上限是后一段补边前的起点，反之亦然）。输出合同要求段不重叠：
/// 在重叠区的中点把两段分开。中点落在两段补边前的静音之间，不会让任何一段变空。
pub fn resolve_overlaps(spans: &mut [SpeechSpan]) {
    for index in 1..spans.len() {
        let (left, right) = spans.split_at_mut(index);
        let previous = &mut left[index - 1];
        let current = &mut right[0];
        if current.start < previous.end {
            let middle = (current.start + previous.end) / 2.0;
            previous.end = middle;
            current.start = middle;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn span(start: f64, end: f64) -> SpeechSpan {
        SpeechSpan { start, end }
    }

    #[test]
    fn vad_config_matches_the_pipeline_tuning() {
        assert_eq!((VAD_CONFIG.onset, VAD_CONFIG.offset), (0.5, 0.35));
        assert_eq!((VAD_CONFIG.min_speech_duration, VAD_CONFIG.min_silence_duration), (0.25, 0.5));
        assert_eq!((MAX_SPAN, MIN_PIECE, PAD, CUT_SEARCH), (14.5, 2.0, 0.15, 4.0));
    }

    #[test]
    fn long_spans_are_cut_at_the_quietest_window() {
        let rate = 16_000.0;
        let mut samples = vec![0.5_f32; (40.0 * rate) as usize];
        // 12.0–12.1 s 是静音：第一刀应当落在这里（搜索区间 [10.5, 14.5]）。
        for sample in &mut samples[(12.0 * rate) as usize..(12.1 * rate) as usize] {
            *sample = 0.0;
        }
        let pieces = split(&[span(0.0, 40.0)], &samples, rate);
        assert!(pieces.len() >= 3);
        assert!((pieces[0].end - 12.05).abs() < 0.03, "{pieces:?}");
        for pair in pieces.windows(2) {
            assert_eq!(pair[0].end, pair[1].start);
        }
        assert!(
            pieces
                .iter()
                .all(|piece| piece.duration() <= MAX_SPAN + 1e-9 && piece.duration() >= MIN_PIECE - 1e-9)
        );
        assert_eq!(pieces.last().unwrap().end, 40.0);
    }

    #[test]
    fn short_spans_pass_through_and_equal_split_without_samples() {
        assert_eq!(split(&[span(1.0, 5.0)], &[], 16_000.0), vec![span(1.0, 5.0)]);
        let equal = split(&[span(0.0, 30.0)], &[], 16_000.0);
        assert_eq!(equal.len(), 3);
        assert!((equal[1].start - 10.0).abs() < 1e-9);
    }

    #[test]
    fn padding_stays_inside_the_media_and_overlaps_are_resolved() {
        let mut padded = padded(&[span(0.05, 1.0), span(1.1, 2.0), span(3.0, 3.95)], 4.0);
        assert_eq!(padded[0].start, 0.0);
        assert_eq!(padded[2].end, 4.0);
        assert!(padded[1].start < padded[0].end, "补边后相邻段重叠：{padded:?}");
        resolve_overlaps(&mut padded);
        for pair in padded.windows(2) {
            assert!(pair[0].end <= pair[1].start);
            assert!(pair[0].start < pair[0].end);
        }
        assert!((padded[0].end - 1.05).abs() < 1e-9);
        assert_eq!(padded[1].end, 2.15);
        assert_eq!(padded[2].start, 2.85);
    }
}
