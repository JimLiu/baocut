//! 长文本逐块合成后的拼接：块与块之间的停顿与响度由这里统一定，不交给模型。
//!
//! 每块是一次独立生成：模型在块首尾各留一段长短不一的静音，响度也各不相同。原样首尾相接时，块边界的停顿
//! （实测 0.7–1.1 s）比块内句间的停顿（0.2–0.5 s）长得多，相邻块的响度差 3–5 dB，听起来像「说一段、停很久、
//! 换个人再说一段」。[`Stitcher`] 按块到达的次序拼接：
//!
//! 1. 块边界两侧的首尾静音（10 ms 窗的 RMS 低于 −45 dBFS）去掉，每侧最多留 50 ms，切口做 5 ms 淡入淡出；
//!    整段的开头与结尾不动；
//! 2. 块之间插固定停顿，按上一块之后的边界级别（[`ChunkBreak`]）：句末 0.35 s、段落 0.6 s、句中断开 0.2 s。
//!    停顿量的是「上一块最后的有声窗」到「下一块第一个有声窗」，留下的边缘静音算在里面；
//! 3. 每块的响度（有声窗的 RMS）对齐到第一块，增益限制在 ±6 dB，放大后峰值不超过 −1 dBFS；
//! 4. 只有一块时原样交出，什么都不做。
//!
//! 文本的内容与顺序不变；整段的峰值上限另由 [`super::loudness::PeakLimited`] 管。

use super::loudness::PEAK_CEILING;
use super::text::ChunkBreak;

/// 静音门限：−45 dBFS（`10^(−45/20)`）。
pub const SILENCE_THRESHOLD: f32 = 0.005_623_413;
/// 判静音的窗长（秒）。
pub const WINDOW_SECONDS: f64 = 0.01;
/// 去首尾静音后，每侧最多保留的静音（秒）。
pub const KEEP_EDGE_SECONDS: f64 = 0.05;
/// 切口的淡入淡出（秒）。
pub const FADE_SECONDS: f64 = 0.005;
/// 块以句末标点收尾时的停顿（秒）：取自同一模型块内句间停顿的实测分布。
pub const SENTENCE_PAUSE_SECONDS: f64 = 0.35;
/// 段落（换行）边界的停顿（秒）。
pub const PARAGRAPH_PAUSE_SECONDS: f64 = 0.6;
/// 块在句中断开（分句标点或硬切）时的停顿（秒）。
pub const CLAUSE_PAUSE_SECONDS: f64 = 0.2;
/// 响度对齐的增益上限（dB，正负对称）。
pub const MAX_GAIN_DB: f32 = 6.0;

/// 一级边界之后的停顿（秒）。
pub const fn pause_seconds(after: ChunkBreak) -> f64 {
    match after {
        ChunkBreak::Clause => CLAUSE_PAUSE_SECONDS,
        ChunkBreak::Sentence => SENTENCE_PAUSE_SECONDS,
        ChunkBreak::Paragraph => PARAGRAPH_PAUSE_SECONDS,
    }
}

/// 按次序接上逐块合成的音频。块数在开始时就知道（切块先于合成），所以每块到达时就能处理完，
/// [`Self::seconds`] 在每块之后都是已拼好的累计时长（`TtsProgress::ChunkFinished.seconds`）。
#[derive(Debug)]
pub struct Stitcher {
    sample_rate: u32,
    count: usize,
    pushed: usize,
    samples: Vec<f32>,
    /// 第一块（第一块有声的块）的有声 RMS，后面的块对齐到它。
    reference_rms: Option<f32>,
    /// 上一块之后要插的停顿（秒），与上一块尾部留下的静音样本数。
    pending: Option<(f64, usize)>,
}

impl Stitcher {
    pub fn new(sample_rate: u32, count: usize) -> Self {
        Self {
            sample_rate,
            count,
            pushed: 0,
            samples: Vec::new(),
            reference_rms: None,
            pending: None,
        }
    }

    /// 接上下一块。`after` 是这一块之后的边界级别（最后一块的不用）。
    pub fn push(&mut self, chunk: &[f32], after: ChunkBreak) {
        self.pushed += 1;
        if self.count <= 1 {
            self.samples.extend_from_slice(chunk);
            return;
        }
        let first = self.samples.is_empty() && self.pending.is_none();
        let last = self.pushed >= self.count;
        let pause = pause_seconds(after);
        let Some((voiced_start, voiced_end)) = voiced_span(chunk, self.sample_rate) else {
            // 整块没有声音（模型一开头就收尾）：不接它，也不多插一次停顿，取两级边界里长的那个。
            if let Some((pending, _)) = &mut self.pending {
                *pending = pending.max(pause);
            }
            return;
        };

        let keep = seconds_to_samples(KEEP_EDGE_SECONDS, self.sample_rate);
        let start = if first { 0 } else { voiced_start.saturating_sub(keep) };
        let end = if last { chunk.len() } else { (voiced_end + keep).min(chunk.len()) };
        let mut body = chunk[start..end].to_vec();
        let fade = seconds_to_samples(FADE_SECONDS, self.sample_rate).min(body.len() / 2);
        if start > 0 {
            for (i, sample) in body.iter_mut().take(fade).enumerate() {
                *sample *= i as f32 / fade as f32;
            }
        }
        if end < chunk.len() {
            let len = body.len();
            for (i, sample) in body[len - fade..].iter_mut().enumerate() {
                *sample *= (fade - 1 - i) as f32 / fade as f32;
            }
        }

        let rms = voiced_rms(&body, self.sample_rate);
        match self.reference_rms {
            None => self.reference_rms = Some(rms),
            Some(reference) => {
                let gain = alignment_gain(reference, rms, peak(&body));
                if gain != 1.0 {
                    body.iter_mut().for_each(|sample| *sample *= gain);
                }
            }
        }

        if let Some((pause, kept_tail)) = self.pending.take() {
            let kept_head = voiced_start - start;
            let silence = seconds_to_samples(pause, self.sample_rate).saturating_sub(kept_tail + kept_head);
            self.samples.resize(self.samples.len() + silence, 0.0);
        }
        self.samples.extend_from_slice(&body);
        self.pending = Some((pause, end.saturating_sub(voiced_end)));
    }

    /// 已拼好的时长（秒）。
    pub fn seconds(&self) -> f64 {
        self.samples.len() as f64 / f64::from(self.sample_rate)
    }

    pub fn finish(self) -> Vec<f32> {
        self.samples
    }
}

fn seconds_to_samples(seconds: f64, sample_rate: u32) -> usize {
    (seconds * f64::from(sample_rate)).round() as usize
}

fn window(sample_rate: u32) -> usize {
    seconds_to_samples(WINDOW_SECONDS, sample_rate).max(1)
}

fn mean_square(samples: &[f32]) -> f64 {
    samples.iter().map(|s| f64::from(*s) * f64::from(*s)).sum::<f64>() / samples.len().max(1) as f64
}

/// 第一个有声窗的起点与最后一个有声窗的终点（样本下标，左闭右开）；整块静音时 `None`。
pub fn voiced_span(samples: &[f32], sample_rate: u32) -> Option<(usize, usize)> {
    let window = window(sample_rate);
    let threshold = f64::from(SILENCE_THRESHOLD) * f64::from(SILENCE_THRESHOLD);
    let mut span: Option<(usize, usize)> = None;
    for (index, frame) in samples.chunks(window).enumerate() {
        if mean_square(frame) > threshold {
            let start = index * window;
            let end = start + frame.len();
            span = Some(span.map_or((start, end), |(first, _)| (first, end)));
        }
    }
    span
}

/// 有声窗（RMS 高于静音门限）的 RMS；没有有声窗时是整段的 RMS。
pub fn voiced_rms(samples: &[f32], sample_rate: u32) -> f32 {
    let threshold = f64::from(SILENCE_THRESHOLD) * f64::from(SILENCE_THRESHOLD);
    let (mut sum, mut count) = (0.0f64, 0usize);
    for frame in samples.chunks(window(sample_rate)) {
        if mean_square(frame) > threshold {
            sum += frame.iter().map(|s| f64::from(*s) * f64::from(*s)).sum::<f64>();
            count += frame.len();
        }
    }
    if count == 0 {
        return mean_square(samples).sqrt() as f32;
    }
    (sum / count as f64).sqrt() as f32
}

fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0_f32, |max, s| max.max(s.abs()))
}

/// 把 `rms` 对齐到 `reference` 的增益：限制在 ±[`MAX_GAIN_DB`]；放大时峰值不超过 [`PEAK_CEILING`]
/// （本来就超过的不再放大）。
fn alignment_gain(reference: f32, rms: f32, peak: f32) -> f32 {
    // NaN 与 0 都不对齐。
    if !(rms.is_finite() && reference.is_finite() && rms > 0.0 && reference > 0.0) {
        return 1.0;
    }
    let limit = 10f32.powf(MAX_GAIN_DB / 20.0);
    let mut gain = (reference / rms).clamp(1.0 / limit, limit);
    if gain > 1.0 && peak * gain > PEAK_CEILING {
        gain = (PEAK_CEILING / peak).max(1.0);
    }
    gain
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 24_000;

    fn samples(seconds: f64) -> usize {
        seconds_to_samples(seconds, RATE)
    }

    /// 一个假块：`lead` 秒静音（夹一点低于门限的底噪）、`voiced` 秒幅度 `amplitude` 的 220 Hz 正弦、`trail` 秒静音。
    fn fake_chunk(lead: f64, voiced: f64, trail: f64, amplitude: f32) -> Vec<f32> {
        let noise = |i: usize| if i.is_multiple_of(2) { 0.001 } else { -0.001 };
        let mut out: Vec<f32> = (0..samples(lead)).map(noise).collect();
        out.extend((0..samples(voiced)).map(|i| amplitude * (i as f32 * 220.0 * std::f32::consts::TAU / RATE as f32).sin()));
        out.extend((0..samples(trail)).map(noise));
        out
    }

    /// 输出里按 10 ms 窗找出的有声段 `[start, end)`（样本）。
    fn voiced_runs(samples: &[f32]) -> Vec<(usize, usize)> {
        let window = window(RATE);
        let threshold = f64::from(SILENCE_THRESHOLD).powi(2);
        let mut runs: Vec<(usize, usize)> = Vec::new();
        for (index, frame) in samples.chunks(window).enumerate() {
            if mean_square(frame) > threshold {
                let start = index * window;
                match runs.last_mut() {
                    Some(run) if run.1 == start => run.1 = start + frame.len(),
                    _ => runs.push((start, start + frame.len())),
                }
            }
        }
        runs
    }

    fn stitch(chunks: &[(Vec<f32>, ChunkBreak)]) -> (Vec<f32>, Vec<f64>) {
        let mut stitcher = Stitcher::new(RATE, chunks.len());
        let mut progress = Vec::new();
        for (chunk, after) in chunks {
            stitcher.push(chunk, *after);
            progress.push(stitcher.seconds());
        }
        (stitcher.finish(), progress)
    }

    fn db(ratio: f32) -> f32 {
        20.0 * ratio.log10()
    }

    #[test]
    fn boundaries_get_the_fixed_pause_and_chunks_match_the_first_chunks_level() {
        // 首尾静音各不相同、响度各不相同（−3 dB、+4 dB）的三块。
        let chunks = vec![
            (fake_chunk(0.12, 1.0, 0.9, 0.3), ChunkBreak::Sentence),
            (fake_chunk(0.7, 1.5, 0.4, 0.3 * 10f32.powf(-3.0 / 20.0)), ChunkBreak::Paragraph),
            (fake_chunk(0.3, 0.8, 0.25, 0.3 * 10f32.powf(4.0 / 20.0)), ChunkBreak::Paragraph),
        ];
        let (out, progress) = stitch(&chunks);
        let runs = voiced_runs(&out);
        assert_eq!(runs.len(), 3, "{runs:?}");
        let gap = |i: usize| (runs[i + 1].0 - runs[i].1) as f64 / f64::from(RATE);
        // 停顿按 10 ms 窗量，差不出一个窗。
        assert!(
            (gap(0) - SENTENCE_PAUSE_SECONDS).abs() <= WINDOW_SECONDS + 1e-9,
            "句末停顿 {}",
            gap(0)
        );
        assert!(
            (gap(1) - PARAGRAPH_PAUSE_SECONDS).abs() <= WINDOW_SECONDS + 1e-9,
            "段落停顿 {}",
            gap(1)
        );

        // 各块有声部分的 RMS 都等于第一块。
        let levels: Vec<f32> = runs.iter().map(|(s, e)| voiced_rms(&out[*s..*e], RATE)).collect();
        for level in &levels[1..] {
            assert!(db(level / levels[0]).abs() < 0.1, "{levels:?}");
        }

        // 总长可预期：第一块的开头与最后一块的结尾原样留着，中间是三段有声 + 两个停顿。
        let expected = samples(0.12)
            + samples(1.0)
            + samples(SENTENCE_PAUSE_SECONDS)
            + samples(1.5)
            + samples(PARAGRAPH_PAUSE_SECONDS)
            + samples(0.8)
            + samples(0.25);
        assert!(
            out.len().abs_diff(expected) <= 2 * window(RATE),
            "总长 {} 预期 {expected}",
            out.len()
        );
        // 进度是已拼好的累计时长：单调递增，最后一次等于总长。
        assert!(progress.windows(2).all(|w| w[0] < w[1]), "{progress:?}");
        assert_eq!(*progress.last().unwrap(), out.len() as f64 / f64::from(RATE));
        // 第一块的开头没有动（它是响度基准，也不缩放）。
        assert_eq!(&out[..samples(0.12)], &chunks[0].0[..samples(0.12)]);
    }

    #[test]
    fn a_single_chunk_is_returned_untouched() {
        let chunk = fake_chunk(0.5, 1.0, 0.8, 0.95);
        let (out, progress) = stitch(&[(chunk.clone(), ChunkBreak::Paragraph)]);
        assert_eq!(out, chunk);
        assert_eq!(progress, vec![chunk.len() as f64 / f64::from(RATE)]);
    }

    #[test]
    fn clause_breaks_get_the_short_pause() {
        let (out, _) = stitch(&[
            (fake_chunk(0.1, 0.5, 0.6, 0.3), ChunkBreak::Clause),
            (fake_chunk(0.6, 0.5, 0.1, 0.3), ChunkBreak::Paragraph),
        ]);
        let runs = voiced_runs(&out);
        let gap = (runs[1].0 - runs[0].1) as f64 / f64::from(RATE);
        assert!((gap - CLAUSE_PAUSE_SECONDS).abs() <= WINDOW_SECONDS + 1e-9, "{gap}");
    }

    #[test]
    fn gain_is_limited_to_six_db_and_never_pushes_the_peak_over_the_ceiling() {
        // 低 12 dB 的块只抬 6 dB，仍低 6 dB。
        let (out, _) = stitch(&[
            (fake_chunk(0.1, 0.5, 0.3, 0.4), ChunkBreak::Sentence),
            (fake_chunk(0.3, 0.5, 0.1, 0.1), ChunkBreak::Paragraph),
        ]);
        let runs = voiced_runs(&out);
        let levels: Vec<f32> = runs.iter().map(|(s, e)| voiced_rms(&out[*s..*e], RATE)).collect();
        assert!((db(levels[1] / levels[0]) + 6.0).abs() < 0.1, "{levels:?}");

        // 高 10 dB 的块只压 6 dB，仍高 4 dB。
        let (out, _) = stitch(&[
            (fake_chunk(0.1, 0.5, 0.3, 0.1), ChunkBreak::Sentence),
            (fake_chunk(0.3, 0.5, 0.1, 0.1 * 10f32.powf(10.0 / 20.0)), ChunkBreak::Paragraph),
        ]);
        let runs = voiced_runs(&out);
        let levels: Vec<f32> = runs.iter().map(|(s, e)| voiced_rms(&out[*s..*e], RATE)).collect();
        assert!((db(levels[1] / levels[0]) - 4.0).abs() < 0.1, "{levels:?}");

        // 安静但带一个尖峰的块：要抬约 9 dB，但抬到峰值 −1 dBFS 就停。
        let mut spiky = fake_chunk(0.3, 0.5, 0.1, 0.15);
        let spike = samples(0.5);
        spiky[spike] = 0.8;
        let (out, _) = stitch(&[
            (fake_chunk(0.1, 0.5, 0.3, 0.4), ChunkBreak::Sentence),
            (spiky, ChunkBreak::Paragraph),
        ]);
        assert!((peak(&out) - PEAK_CEILING).abs() < 1e-5, "峰值 {}", peak(&out));
        // 本来就超过 −1 dBFS 的块不再放大（Base 的 codec 输出常到满幅之上，整段由 PeakLimited 缩）。
        assert_eq!(alignment_gain(0.5, 0.2, 1.2), 1.0);
        assert!((alignment_gain(0.1, 0.4, 1.2) - 0.25f32.max(10f32.powf(-0.3))).abs() < 1e-6);
    }

    #[test]
    fn a_silent_chunk_adds_no_second_pause() {
        let (out, progress) = stitch(&[
            (fake_chunk(0.1, 0.5, 0.5, 0.3), ChunkBreak::Sentence),
            (Vec::new(), ChunkBreak::Paragraph),
            (fake_chunk(0.0, 0.0, 0.4, 0.0), ChunkBreak::Sentence),
            (fake_chunk(0.5, 0.5, 0.1, 0.3), ChunkBreak::Paragraph),
        ]);
        let runs = voiced_runs(&out);
        assert_eq!(runs.len(), 2, "{runs:?}");
        // 跳过的块里最长的那一级边界（段落）。
        let gap = (runs[1].0 - runs[0].1) as f64 / f64::from(RATE);
        assert!((gap - PARAGRAPH_PAUSE_SECONDS).abs() <= WINDOW_SECONDS + 1e-9, "{gap}");
        assert_eq!(progress.len(), 4);
        assert_eq!(progress[0], progress[1]);
        assert_eq!(progress[1], progress[2]);
    }

    #[test]
    fn cut_edges_fade_instead_of_clicking() {
        // 有声部分紧贴块边（没有首尾静音可去）时，切口在有声样本上，要淡入淡出。
        let mut first = fake_chunk(0.0, 0.5, 0.0, 0.3);
        first.extend(vec![0.3; samples(0.2)]);
        let mut second = vec![0.3; samples(0.2)];
        second.extend(fake_chunk(0.0, 0.5, 0.0, 0.3));
        let (out, _) = stitch(&[(first, ChunkBreak::Sentence), (second, ChunkBreak::Paragraph)]);
        // 两块的有声部分都贴着块边，没有可去的静音：中间只插停顿，块尾、块首的样本原样（没有切口，不淡）。
        let runs = voiced_runs(&out);
        assert_eq!(runs.len(), 2);
        assert!((out[runs[0].1 - 1] - 0.3).abs() < 1e-3);
        assert!((out[runs[1].0] - 0.3).abs() < 1e-3);

        // 留下 50 ms 后的切口落在静音上：切口两侧都淡到 0。
        let (out, _) = stitch(&[
            (fake_chunk(0.0, 0.5, 0.5, 0.3), ChunkBreak::Sentence),
            (fake_chunk(0.5, 0.5, 0.0, 0.3), ChunkBreak::Paragraph),
        ]);
        let runs = voiced_runs(&out);
        let tail_cut = runs[0].1 + samples(KEEP_EDGE_SECONDS);
        assert_eq!(out[tail_cut - 1].abs(), 0.0);
    }
}
