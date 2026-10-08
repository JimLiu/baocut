//! 单声道 PCM → 节拍、小节与段落。`bcut beats` 的执行体只负责解码与投影，算法全在这里。
//!
//! 流水线（全部确定性，同一份 PCM 得同一份结果）：
//!
//! 1. **起音包络**：32 ms Hann 窗、10 ms hop 的 STFT，对数幅度的半波整流谱通量；
//!    低频段（< 150 Hz，底鼓）单独一条。
//! 2. **速度**：包络自相关在 `[min_bpm, max_bpm]` 的滞后上取峰，乘以以 120 BPM 为中心、
//!    一个八度标准差的对数正态先验（压住倍速 / 半速），再加半个二倍滞后的支持（取 ±1 帧里的
//!    最大值，整数滞后乘二差出的那一帧不丢峰），抛物线插值出小数滞后。
//! 3. **节拍**：Ellis 动态规划（相邻两拍间隔偏离周期的对数平方惩罚），回溯后裁掉首尾
//!    没有起音支撑的拍。
//! 4. **网格**：把拍按周期编号后做最小二乘，得到恒速网格的周期与相位；残差告诉调用方
//!    这首歌是不是恒速（DAW 做的歌几乎为零，现场录音会大）。
//! 5. **强拍**：按网格编号模 `beats_per_bar` 分组，底鼓强度与拍前后音色变化的 z 分数
//!    之和最大的一组是小节第一拍。
//! 6. **段落**：每小节取能量与三段频带能量、起音密度，前后各四小节的均值差作新颖度，
//!    取峰切段（四小节整数倍处略加权，段长至少四小节）。

use anyhow::{Result, bail};
use realfft::RealFftPlanner;

/// 分析参数。
#[derive(Debug, Clone, PartialEq)]
pub struct BeatOptions {
    /// 每小节几拍。
    pub beats_per_bar: usize,
    pub min_bpm: f64,
    pub max_bpm: f64,
}

impl Default for BeatOptions {
    fn default() -> Self {
        Self {
            beats_per_bar: 4,
            min_bpm: 60.0,
            max_bpm: 200.0,
        }
    }
}

/// 一个小节：`[start, end)`，`energy` 是全曲内归一到 0..1 的响度。
#[derive(Debug, Clone, PartialEq)]
pub struct Bar {
    pub start: f64,
    pub end: f64,
    pub energy: f64,
}

/// 一个段落：`[start, end)`，覆盖小节 `[first_bar, end_bar)`；`energy` 是段内小节能量均值。
#[derive(Debug, Clone, PartialEq)]
pub struct Section {
    pub start: f64,
    pub end: f64,
    pub first_bar: usize,
    pub end_bar: usize,
    pub energy: f64,
}

/// 分析结果。时间单位都是秒。
#[derive(Debug, Clone, PartialEq)]
pub struct BeatAnalysis {
    pub duration: f64,
    /// 恒速网格的 BPM（`60 / period`）。
    pub tempo: f64,
    /// 一拍多少秒。
    pub period: f64,
    /// 网格上第一个 ≥ 0 的拍。
    pub offset: f64,
    /// 追踪到的拍相对网格的均方根残差（秒）。
    pub residual: f64,
    /// 速度峰的显著度，0..1。
    pub confidence: f64,
    /// 追踪到的拍。
    pub beats: Vec<f64>,
    pub beats_per_bar: usize,
    /// 第一个小节第一拍（强拍）。
    pub downbeat: f64,
    /// 强拍相位判定的把握，0..1。
    pub downbeat_confidence: f64,
    pub bars: Vec<Bar>,
    pub sections: Vec<Section>,
}

const HOP_SECONDS: f64 = 0.01;
const WINDOW_SECONDS: f64 = 0.032;
const LOW_BAND_HZ: f64 = 150.0;
const MID_BAND_HZ: f64 = 2000.0;
const MAX_BAND_HZ: f64 = 8000.0;
const PRIOR_BPM: f64 = 120.0;
/// DP 的紧度：越大越不许拍间隔偏离周期（librosa 的缺省值）。
const TIGHTNESS: f64 = 100.0;
/// 段落新颖度的半窗（小节）与最短段长（小节）。
const SECTION_HALF_WINDOW: usize = 4;
const MIN_SECTION_BARS: usize = 4;

/// 逐帧特征。
struct Frames {
    fps: f64,
    /// 全频段谱通量。
    flux: Vec<f64>,
    /// 低频段谱通量（底鼓）。
    low_flux: Vec<f64>,
    /// 三段频带能量（对数），`[low, mid, high]`。
    bands: Vec<[f64; 3]>,
    /// 12 段对数频带的对数幅度，拍前后音色对比用。
    timbre: Vec<[f64; 12]>,
}

pub fn analyze(pcm: &[f32], sample_rate: u32, options: &BeatOptions) -> Result<BeatAnalysis> {
    if sample_rate < 8000 {
        bail!("采样率 {sample_rate} Hz 太低，无法分析节拍");
    }
    if options.beats_per_bar == 0 || options.min_bpm <= 0.0 || options.max_bpm <= options.min_bpm {
        bail!("节拍参数无效：每小节拍数须 ≥ 1，BPM 下限须 > 0 且小于上限");
    }
    let duration = pcm.len() as f64 / f64::from(sample_rate);
    let frames = frames(pcm, sample_rate);
    let n = frames.flux.len();
    let onset = normalized(&frames.flux);
    if n < 4 || onset.iter().all(|value| *value == 0.0) {
        bail!("音频里没有可用的起音（静音或太短），无法分析节拍");
    }
    let (lag, confidence) = tempo_lag(&onset, frames.fps, options);
    let beat_frames = track_beats(&onset, lag);
    if beat_frames.len() < 2 {
        bail!("没能追踪到稳定的节拍");
    }
    let beats: Vec<f64> = beat_frames
        .iter()
        .map(|frame| *frame as f64 / frames.fps)
        .collect();
    let (period, phase, residual) = fit_grid(&beats, lag / frames.fps);
    let mut offset = phase - (phase / period).floor() * period;
    if offset < 0.0 {
        offset += period;
    }
    let grid_index: Vec<i64> = beats
        .iter()
        .map(|beat| ((beat - offset) / period).round() as i64)
        .collect();
    let (downbeat_phase, downbeat_confidence) = downbeat_phase(
        &frames,
        &beat_frames,
        &grid_index,
        lag,
        options.beats_per_bar,
    );
    let per_bar = options.beats_per_bar as i64;
    let bar_starts: Vec<f64> = beats
        .iter()
        .zip(&grid_index)
        .filter(|(_, index)| (*index - downbeat_phase as i64).rem_euclid(per_bar) == 0)
        .map(|(beat, _)| *beat)
        .collect();
    let downbeat = bar_starts.first().copied().unwrap_or(beats[0]);
    let bars = bars(
        pcm,
        sample_rate,
        &bar_starts,
        period * options.beats_per_bar as f64,
        duration,
    );
    let sections = sections(&frames, &onset, &bars, duration);
    Ok(BeatAnalysis {
        duration,
        tempo: 60.0 / period,
        period,
        offset,
        residual,
        confidence,
        beats,
        beats_per_bar: options.beats_per_bar,
        downbeat,
        downbeat_confidence,
        bars,
        sections,
    })
}

fn frames(pcm: &[f32], sample_rate: u32) -> Frames {
    let rate = f64::from(sample_rate);
    let hop = (rate * HOP_SECONDS).round().max(1.0) as usize;
    let fps = rate / hop as f64;
    let window_len = ((rate * WINDOW_SECONDS) as usize).next_power_of_two();
    let window: Vec<f64> = (0..window_len)
        .map(|index| {
            0.5 - 0.5 * (2.0 * std::f64::consts::PI * index as f64 / window_len as f64).cos()
        })
        .collect();
    let bin_hz = rate / window_len as f64;
    let bins = window_len / 2 + 1;
    let top = ((MAX_BAND_HZ.min(rate / 2.0) / bin_hz) as usize).min(bins - 1);
    let low = ((LOW_BAND_HZ / bin_hz).ceil() as usize).clamp(2, top);
    let mid = ((MID_BAND_HZ / bin_hz) as usize).clamp(low + 1, top);
    // 12 段对数频带：100 Hz – 4 kHz。
    let edges: Vec<usize> = (0..=12)
        .map(|k| {
            let hz = 100.0 * (40.0_f64).powf(k as f64 / 12.0);
            ((hz / bin_hz) as usize).clamp(1, top)
        })
        .collect();
    let count = pcm.len().div_ceil(hop);
    let fft = RealFftPlanner::<f64>::new().plan_fft_forward(window_len);
    let mut input = fft.make_input_vec();
    let mut spectrum = fft.make_output_vec();
    let mut scratch = fft.make_scratch_vec();
    let mut previous = vec![0.0_f64; top + 1];
    let mut current = vec![0.0_f64; top + 1];
    let mut out = Frames {
        fps,
        flux: Vec::with_capacity(count),
        low_flux: Vec::with_capacity(count),
        bands: Vec::with_capacity(count),
        timbre: Vec::with_capacity(count),
    };
    let half = (window_len / 2) as isize;
    for frame in 0..count {
        let center = (frame * hop) as isize;
        for (offset, slot) in input.iter_mut().enumerate() {
            let index = center - half + offset as isize;
            let sample = if index < 0 {
                0.0
            } else {
                pcm.get(index as usize)
                    .copied()
                    .filter(|sample| sample.is_finite())
                    .unwrap_or(0.0)
            };
            *slot = f64::from(sample) * window[offset];
        }
        if fft
            .process_with_scratch(&mut input, &mut spectrum, &mut scratch)
            .is_err()
        {
            spectrum
                .iter_mut()
                .for_each(|bin| *bin = Default::default());
        }
        let mut power = [0.0_f64; 3];
        for (bin, slot) in current.iter_mut().enumerate() {
            let value = spectrum[bin];
            let magnitude =
                (value.re * value.re + value.im * value.im).sqrt() * 2.0 / window_len as f64;
            *slot = (1.0 + 1000.0 * magnitude).ln();
            let band = if bin < low {
                0
            } else if bin < mid {
                1
            } else {
                2
            };
            power[band] += magnitude * magnitude;
        }
        let mut flux = 0.0;
        let mut low_flux = 0.0;
        for bin in 1..=top {
            let rise = (current[bin] - previous[bin]).max(0.0);
            flux += rise;
            if bin < low {
                low_flux += rise;
            }
        }
        let mut timbre = [0.0_f64; 12];
        for (k, slot) in timbre.iter_mut().enumerate() {
            let (a, b) = (edges[k], edges[k + 1].max(edges[k] + 1).min(top + 1));
            let span = &current[a..b];
            *slot = span.iter().sum::<f64>() / span.len().max(1) as f64;
        }
        out.flux.push(if frame == 0 { 0.0 } else { flux });
        out.low_flux.push(if frame == 0 { 0.0 } else { low_flux });
        out.bands
            .push(power.map(|value| 10.0 * (value + 1e-12).log10()));
        out.timbre.push(timbre);
        std::mem::swap(&mut previous, &mut current);
    }
    out
}

/// 减去均值后按标准差归一，负值归零。
fn normalized(values: &[f64]) -> Vec<f64> {
    let (mean, std) = mean_std(values);
    if std <= 1e-12 {
        return vec![0.0; values.len()];
    }
    values
        .iter()
        .map(|value| ((value - mean) / std).max(0.0))
        .collect()
}

fn mean_std(values: &[f64]) -> (f64, f64) {
    if values.is_empty() {
        return (0.0, 0.0);
    }
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let variance = values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / values.len() as f64;
    (mean, variance.sqrt())
}

/// 速度：返回拍周期（帧，含小数）与显著度。
fn tempo_lag(onset: &[f64], fps: f64, options: &BeatOptions) -> (f64, f64) {
    let lag_min = ((fps * 60.0 / options.max_bpm).floor() as usize).max(1);
    let lag_max = ((fps * 60.0 / options.min_bpm).ceil() as usize).max(lag_min + 2);
    let n = onset.len();
    let acf = |lag: usize| -> f64 {
        if lag >= n {
            return 0.0;
        }
        let sum: f64 = onset[..n - lag]
            .iter()
            .zip(&onset[lag..])
            .map(|(a, b)| a * b)
            .sum();
        sum / (n - lag) as f64
    };
    let raw: Vec<f64> = (0..=2 * lag_max + 2).map(acf).collect();
    // 二倍滞后取 ±1 帧里的最大值：整数滞后乘二会差出一帧，而起音包络的自相关峰只有一两帧宽——
    // 真速度的二拍峰因此被错过，1.5 拍（3-3-2 切分的连复段）反倒赢（江南 Style 132 → 88）。
    let near = |center: usize| {
        raw[center - 1..=center + 1]
            .iter()
            .copied()
            .fold(0.0, f64::max)
    };
    let weighted: Vec<f64> = (0..=lag_max + 1)
        .map(|lag| {
            if lag < lag_min || lag > lag_max {
                return 0.0;
            }
            let bpm = fps * 60.0 / lag as f64;
            let octave = (bpm / PRIOR_BPM).log2();
            let prior = (-0.5 * octave * octave).exp();
            (raw[lag] + 0.5 * near(2 * lag)) * prior
        })
        .collect();
    let best = (lag_min..=lag_max)
        .max_by(|a, b| weighted[*a].total_cmp(&weighted[*b]).then(b.cmp(a)))
        .unwrap_or(lag_min);
    let mut lag = best as f64;
    if best > lag_min && best < lag_max {
        let (left, mid, right) = (weighted[best - 1], weighted[best], weighted[best + 1]);
        let denominator = left - 2.0 * mid + right;
        if denominator.abs() > 1e-12 {
            lag += (0.5 * (left - right) / denominator).clamp(-0.5, 0.5);
        }
    }
    let mut sorted: Vec<f64> = weighted[lag_min..=lag_max].to_vec();
    sorted.sort_by(f64::total_cmp);
    let median = sorted[sorted.len() / 2];
    let peak = weighted[best];
    let confidence = if peak > 1e-12 {
        ((peak - median) / peak).clamp(0.0, 1.0)
    } else {
        0.0
    };
    (lag, confidence)
}

/// Ellis 动态规划追拍：返回拍所在的帧。
fn track_beats(onset: &[f64], period: f64) -> Vec<usize> {
    let n = onset.len();
    // 局部得分：包络与宽 period/32 的高斯平滑。
    let sigma = (period / 32.0).max(0.5);
    let radius = (sigma * 3.0).ceil() as isize;
    let kernel: Vec<f64> = (-radius..=radius)
        .map(|k| (-0.5 * (k as f64 / sigma).powi(2)).exp())
        .collect();
    let local: Vec<f64> = (0..n as isize)
        .map(|t| {
            (-radius..=radius)
                .map(|k| {
                    let index = t + k;
                    if index < 0 || index >= n as isize {
                        0.0
                    } else {
                        onset[index as usize] * kernel[(k + radius) as usize]
                    }
                })
                .sum()
        })
        .collect();
    let far = (2.0 * period).round() as usize;
    let near = ((period / 2.0).round() as usize).max(1);
    let mut score = vec![0.0_f64; n];
    let mut back: Vec<Option<usize>> = vec![None; n];
    for t in 0..n {
        let mut best: Option<(f64, usize)> = None;
        if t >= near {
            for tau in t.saturating_sub(far)..=t - near {
                let gap = (t - tau) as f64 / period;
                let value = score[tau] - TIGHTNESS * gap.ln().powi(2);
                if best.is_none_or(|(current, _)| value > current) {
                    best = Some((value, tau));
                }
            }
        }
        match best {
            Some((value, tau)) if value > 0.0 => {
                score[t] = local[t] + value;
                back[t] = Some(tau);
            }
            _ => score[t] = local[t],
        }
    }
    // 最后一拍：最后一个周期里得分最高的帧。
    let tail = n.saturating_sub(period.ceil() as usize);
    let mut last = (tail..n)
        .max_by(|a, b| score[*a].total_cmp(&score[*b]).then(b.cmp(a)))
        .unwrap_or(n - 1);
    let mut beats = vec![last];
    while let Some(previous) = back[last] {
        beats.push(previous);
        last = previous;
    }
    beats.reverse();
    // 裁掉首尾没有起音支撑的拍（前奏的静音、结尾的余响）。
    let rms = (local.iter().map(|v| v * v).sum::<f64>() / n as f64).sqrt();
    let threshold = 0.5 * rms;
    let support = |frame: usize| {
        let lo = frame.saturating_sub(2);
        let hi = (frame + 3).min(n);
        local[lo..hi].iter().copied().fold(0.0, f64::max)
    };
    let first = beats.iter().position(|frame| support(*frame) >= threshold);
    let last = beats.iter().rposition(|frame| support(*frame) >= threshold);
    match (first, last) {
        (Some(first), Some(last)) if first <= last => beats[first..=last].to_vec(),
        _ => beats,
    }
}

/// 恒速网格：`(周期, 相位, 均方根残差)`，相位是编号 0 那一拍的时刻。
fn fit_grid(beats: &[f64], period_guess: f64) -> (f64, f64, f64) {
    let origin = beats[0];
    let mut period = period_guess;
    let mut phase = origin;
    let mut kept: Vec<(f64, f64)> = beats
        .iter()
        .map(|beat| (((beat - origin) / period).round(), *beat))
        .collect();
    for _ in 0..3 {
        let count = kept.len() as f64;
        if count < 2.0 {
            break;
        }
        let mean_x = kept.iter().map(|(x, _)| x).sum::<f64>() / count;
        let mean_y = kept.iter().map(|(_, y)| y).sum::<f64>() / count;
        let covariance: f64 = kept.iter().map(|(x, y)| (x - mean_x) * (y - mean_y)).sum();
        let variance: f64 = kept.iter().map(|(x, _)| (x - mean_x).powi(2)).sum();
        if variance <= 1e-12 {
            break;
        }
        period = covariance / variance;
        phase = mean_y - period * mean_x;
        // 重新编号、丢掉离网格超过 1/8 拍的点（追拍偶尔落在反拍上）。
        kept = beats
            .iter()
            .map(|beat| (((beat - phase) / period).round(), *beat))
            .filter(|(x, y)| (y - (phase + period * x)).abs() <= period / 8.0)
            .collect();
    }
    let residual = if beats.is_empty() {
        0.0
    } else {
        (beats
            .iter()
            .map(|beat| {
                let x = ((beat - phase) / period).round();
                (beat - (phase + period * x)).powi(2)
            })
            .sum::<f64>()
            / beats.len() as f64)
            .sqrt()
    };
    (period, phase, residual)
}

/// 强拍相位：`(相位 0..beats_per_bar, 把握)`。
fn downbeat_phase(
    frames: &Frames,
    beat_frames: &[usize],
    grid_index: &[i64],
    period: f64,
    beats_per_bar: usize,
) -> (usize, f64) {
    if beats_per_bar <= 1 {
        return (0, 1.0);
    }
    let n = frames.flux.len();
    let span = (period.round() as usize).max(1);
    let kick: Vec<f64> = beat_frames
        .iter()
        .map(|frame| {
            let lo = frame.saturating_sub(3);
            let hi = (frame + 4).min(n);
            frames.low_flux[lo..hi].iter().copied().fold(0.0, f64::max)
        })
        .collect();
    let change: Vec<f64> = beat_frames
        .iter()
        .map(|frame| {
            let before = mean_timbre(&frames.timbre, frame.saturating_sub(span), *frame);
            let after = mean_timbre(&frames.timbre, *frame, (frame + span).min(n));
            before
                .iter()
                .zip(&after)
                .map(|(a, b)| (a - b).powi(2))
                .sum::<f64>()
                .sqrt()
        })
        .collect();
    let z = |values: &[f64]| -> Vec<f64> {
        let (mean, std) = mean_std(values);
        values
            .iter()
            .map(|value| {
                if std > 1e-12 {
                    (value - mean) / std
                } else {
                    0.0
                }
            })
            .collect()
    };
    let (kick, change) = (z(&kick), z(&change));
    let mut scores = vec![(0.0_f64, 0usize); beats_per_bar];
    for ((index, k), c) in grid_index.iter().zip(&kick).zip(&change) {
        let phase = index.rem_euclid(beats_per_bar as i64) as usize;
        scores[phase].0 += k + c;
        scores[phase].1 += 1;
    }
    let means: Vec<f64> = scores
        .iter()
        .map(|(sum, count)| {
            if *count > 0 {
                sum / *count as f64
            } else {
                f64::NEG_INFINITY
            }
        })
        .collect();
    let best = (0..beats_per_bar)
        .max_by(|a, b| means[*a].total_cmp(&means[*b]).then(b.cmp(a)))
        .unwrap_or(0);
    let mut sorted: Vec<f64> = means.iter().copied().filter(|v| v.is_finite()).collect();
    sorted.sort_by(|a, b| b.total_cmp(a));
    let confidence = match sorted.as_slice() {
        [first, second, .., last] if first - last > 1e-12 => {
            ((first - second) / (first - last)).clamp(0.0, 1.0)
        }
        _ => 0.0,
    };
    (best, confidence)
}

fn mean_timbre(timbre: &[[f64; 12]], from: usize, to: usize) -> [f64; 12] {
    let mut out = [0.0; 12];
    if to <= from {
        return out;
    }
    for row in &timbre[from..to] {
        for (slot, value) in out.iter_mut().zip(row) {
            *slot += value;
        }
    }
    out.map(|value| value / (to - from) as f64)
}

/// 小节：强拍到下一个强拍；最后一小节按一小节时长收在片尾。能量是小节内样本的
/// 均方根 dB，按全曲第 5 / 95 百分位归一到 0..1。
fn bars(
    pcm: &[f32],
    sample_rate: u32,
    starts: &[f64],
    bar_seconds: f64,
    duration: f64,
) -> Vec<Bar> {
    let rate = f64::from(sample_rate);
    let mut bars: Vec<Bar> = starts
        .iter()
        .enumerate()
        .map(|(index, start)| {
            let end = starts
                .get(index + 1)
                .copied()
                .unwrap_or((start + bar_seconds).min(duration))
                .max(*start);
            Bar {
                start: *start,
                end,
                energy: 0.0,
            }
        })
        .filter(|bar| bar.end > bar.start)
        .collect();
    let decibels: Vec<f64> = bars
        .iter()
        .map(|bar| {
            let lo = ((bar.start * rate) as usize).min(pcm.len());
            let hi = ((bar.end * rate) as usize).clamp(lo, pcm.len());
            let slice = &pcm[lo..hi];
            let power = slice
                .iter()
                .map(|sample| f64::from(*sample).powi(2))
                .sum::<f64>()
                / slice.len().max(1) as f64;
            10.0 * (power + 1e-12).log10()
        })
        .collect();
    let (low, high) = (percentile(&decibels, 0.05), percentile(&decibels, 0.95));
    for (bar, db) in bars.iter_mut().zip(&decibels) {
        bar.energy = if high - low > 1e-9 {
            ((db - low) / (high - low)).clamp(0.0, 1.0)
        } else {
            1.0
        };
    }
    bars
}

fn percentile(values: &[f64], q: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    sorted[((sorted.len() - 1) as f64 * q).round() as usize]
}

/// 段落：每小节一条特征向量（能量、三段频带、起音密度，各自 z 分数），前后各
/// [`SECTION_HALF_WINDOW`] 小节的均值差作新颖度，取峰切段。首段从 0 开始、末段收在片尾。
fn sections(frames: &Frames, onset: &[f64], bars: &[Bar], duration: f64) -> Vec<Section> {
    let whole = |energy: f64| Section {
        start: 0.0,
        end: duration,
        first_bar: 0,
        end_bar: bars.len(),
        energy,
    };
    if bars.len() < 2 * MIN_SECTION_BARS {
        let energy = bars.iter().map(|bar| bar.energy).sum::<f64>() / bars.len().max(1) as f64;
        return vec![whole(energy)];
    }
    let n = frames.flux.len();
    let frame_of = |seconds: f64| ((seconds * frames.fps) as usize).min(n);
    let mut columns: Vec<Vec<f64>> = vec![Vec::with_capacity(bars.len()); 5];
    for bar in bars {
        let (lo, hi) = (
            frame_of(bar.start),
            frame_of(bar.end).max(frame_of(bar.start) + 1).min(n),
        );
        let span = (hi - lo).max(1) as f64;
        columns[0].push(bar.energy);
        for band in 0..3 {
            columns[band + 1].push(
                frames.bands[lo..hi]
                    .iter()
                    .map(|row| row[band])
                    .sum::<f64>()
                    / span,
            );
        }
        columns[4].push(onset[lo..hi].iter().sum::<f64>() / span);
    }
    let features: Vec<Vec<f64>> = columns
        .iter()
        .map(|column| {
            let (mean, std) = mean_std(column);
            column
                .iter()
                .map(|value| {
                    if std > 1e-12 {
                        (value - mean) / std
                    } else {
                        0.0
                    }
                })
                .collect()
        })
        .collect();
    let count = bars.len();
    let novelty: Vec<f64> = (0..count)
        .map(|k| {
            if k < 2 || k + 2 > count {
                return 0.0;
            }
            let before = k.saturating_sub(SECTION_HALF_WINDOW)..k;
            let after = k..(k + SECTION_HALF_WINDOW).min(count);
            let distance = features
                .iter()
                .map(|column| {
                    let a = column[before.clone()].iter().sum::<f64>() / before.len() as f64;
                    let b = column[after.clone()].iter().sum::<f64>() / after.len() as f64;
                    (a - b).powi(2)
                })
                .sum::<f64>()
                .sqrt();
            // 四小节乐句的整数倍处略加权。
            if k % 4 == 0 {
                distance * 1.15
            } else {
                distance
            }
        })
        .collect();
    let (mean, std) = mean_std(&novelty);
    let threshold = mean + 0.5 * std;
    let mut candidates: Vec<usize> = (MIN_SECTION_BARS..=count - MIN_SECTION_BARS)
        .filter(|k| {
            let value = novelty[*k];
            value >= threshold
                && (k.saturating_sub(2)..=(k + 2).min(count - 1)).all(|j| novelty[j] <= value)
        })
        .collect();
    candidates.sort_by(|a, b| novelty[*b].total_cmp(&novelty[*a]).then(a.cmp(b)));
    let mut cuts: Vec<usize> = Vec::new();
    for k in candidates {
        if cuts.iter().all(|cut| cut.abs_diff(k) >= MIN_SECTION_BARS) {
            cuts.push(k);
        }
    }
    cuts.sort_unstable();
    sections_from_cuts(bars, &cuts, duration)
}

/// 在已有段落上再按外部信号（比如歌词的长停顿）补切：`cuts` 是小节下标，落在已有
/// 边界 1 小节以内的忽略、距两端不足 2 小节的忽略。返回的段落照旧首段从 0 起、末段到
/// `duration` 止，能量重算。
pub fn split_sections(
    bars: &[Bar],
    sections: &[Section],
    cuts: &[usize],
    duration: f64,
) -> Vec<Section> {
    let count = bars.len();
    let mut edges: Vec<usize> = sections
        .iter()
        .map(|section| section.first_bar)
        .filter(|&bar| bar > 0 && bar < count)
        .collect();
    for &cut in cuts {
        if cut >= 2 && cut + 2 <= count && edges.iter().all(|edge| edge.abs_diff(cut) > 1) {
            edges.push(cut);
        }
    }
    edges.sort_unstable();
    edges.dedup();
    sections_from_cuts(bars, &edges, duration)
}

fn sections_from_cuts(bars: &[Bar], cuts: &[usize], duration: f64) -> Vec<Section> {
    let count = bars.len();
    let mut edges = vec![0usize];
    edges.extend_from_slice(cuts);
    edges.push(count);
    edges
        .windows(2)
        .enumerate()
        .map(|(index, pair)| {
            let (a, b) = (pair[0], pair[1]);
            let energy =
                bars[a..b].iter().map(|bar| bar.energy).sum::<f64>() / (b - a).max(1) as f64;
            Section {
                start: if index == 0 { 0.0 } else { bars[a].start },
                end: if b == count { duration } else { bars[b].start },
                first_bar: a,
                end_bar: b,
                energy,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 16_000;

    /// 合成节拍：每拍一个衰减的正弦「咔哒」，强拍更响、更低；`noise_from` 之后叠一层
    /// 确定性噪声当「副歌」。
    fn click_track(bpm: f64, offset: f64, seconds: f64, loud_from: Option<f64>) -> Vec<f32> {
        let len = (seconds * f64::from(RATE)) as usize;
        let mut pcm = vec![0.0_f32; len];
        let period = 60.0 / bpm;
        let mut beat = 0usize;
        loop {
            let t0 = offset + beat as f64 * period;
            if t0 >= seconds {
                break;
            }
            let downbeat = beat % 4 == 0;
            let (freq, gain) = if downbeat {
                (80.0, 0.9)
            } else {
                (1200.0, 0.35)
            };
            let start = (t0 * f64::from(RATE)) as usize;
            for i in 0..(0.08 * f64::from(RATE)) as usize {
                if start + i >= len {
                    break;
                }
                let t = i as f64 / f64::from(RATE);
                pcm[start + i] +=
                    (gain * (-t * 40.0).exp() * (2.0 * std::f64::consts::PI * freq * t).sin())
                        as f32;
            }
            beat += 1;
        }
        if let Some(from) = loud_from {
            let mut state = 12345u32;
            for (index, sample) in pcm.iter_mut().enumerate() {
                state = state.wrapping_mul(1_103_515_245).wrapping_add(12345);
                if index as f64 / f64::from(RATE) >= from {
                    let noise = (state >> 16) as f32 / 65536.0 - 0.5;
                    *sample += 0.25 * noise;
                }
            }
        }
        pcm
    }

    #[test]
    fn click_track_tempo_offset_and_downbeat() {
        let pcm = click_track(128.0, 0.212, 60.0, None);
        let analysis = analyze(&pcm, RATE, &BeatOptions::default()).unwrap();
        assert!((analysis.tempo - 128.0).abs() < 0.5, "{}", analysis.tempo);
        assert!(
            (analysis.offset - 0.212).abs() < 0.02,
            "{}",
            analysis.offset
        );
        assert!(
            (analysis.downbeat - 0.212).abs() < 0.02,
            "{}",
            analysis.downbeat
        );
        assert!(analysis.residual < 0.01, "{}", analysis.residual);
        assert!(analysis.confidence > 0.3, "{}", analysis.confidence);
        // 每小节四拍：小节起点间隔四拍。
        let bar = 4.0 * 60.0 / 128.0;
        assert!(analysis.bars.len() >= 28, "{}", analysis.bars.len());
        assert!(
            analysis
                .bars
                .windows(2)
                .all(|pair| (pair[1].start - pair[0].start - bar).abs() < 0.03)
        );
        assert!((analysis.beats.len() as f64 - 60.0 / (60.0 / 128.0)).abs() <= 3.0);
    }

    #[test]
    fn slower_track_is_not_doubled() {
        let pcm = click_track(90.0, 0.5, 40.0, None);
        let analysis = analyze(&pcm, RATE, &BeatOptions::default()).unwrap();
        assert!((analysis.tempo - 90.0).abs() < 0.5, "{}", analysis.tempo);
        assert!(
            (analysis.downbeat - 0.5).abs() < 0.02,
            "{}",
            analysis.downbeat
        );
    }

    /// 江南 Style 型：132 BPM 在 100 fps 下一拍是 45.45 帧，每拍一个起音，每小节再压一条 3-3-2 切分
    /// 的连复段。DAW 做的歌起音极准，自相关峰只有一帧宽：二倍滞后的支持若只取整数帧，`2 × 45 = 90`
    /// 错过真速度在 91 的二拍峰，于是整数滞后恰好对上的半速（真曲子里是 1.5 拍的 88 BPM）赢。
    #[test]
    fn a_fractional_beat_period_keeps_its_two_beat_support() {
        const RIFF: f64 = 1.5;
        const SIGMA: f64 = 0.6;
        let fps = 100.0;
        let period = fps * 60.0 / 132.0;
        let mut onset = vec![0.0_f64; 6000];
        // 起音按窄高斯摊开（σ 0.6 帧，和真曲子的峰宽相当）。
        let mut spike = |at: f64, gain: f64| {
            for (frame, slot) in onset.iter_mut().enumerate() {
                *slot += gain * (-0.5 * ((frame as f64 - at) / SIGMA).powi(2)).exp();
            }
        };
        let mut beat = 0usize;
        while 30.0 + beat as f64 * period < 5990.0 {
            let t = 30.0 + beat as f64 * period;
            spike(t, 1.0);
            if beat % 4 == 0 {
                spike(t + 1.5 * period, RIFF);
                spike(t + 3.0 * period, RIFF);
            }
            beat += 1;
        }
        let (lag, _) = tempo_lag(&onset, fps, &BeatOptions::default());
        let bpm = fps * 60.0 / lag;
        assert!((bpm - 132.0).abs() < 1.5, "{bpm}");
    }

    #[test]
    fn external_cuts_split_sections_but_not_next_to_an_edge() {
        let bars: Vec<Bar> = (0..12)
            .map(|k| Bar {
                start: 0.5 + 2.0 * k as f64,
                end: 2.5 + 2.0 * k as f64,
                energy: if k < 6 { 0.2 } else { 0.8 },
            })
            .collect();
        let whole = vec![Section {
            start: 0.0,
            end: 25.0,
            first_bar: 0,
            end_bar: 12,
            energy: 0.5,
        }];
        let split = split_sections(&bars, &whole, &[6, 1, 11, 7], 25.0);
        let spans: Vec<(usize, usize)> = split.iter().map(|s| (s.first_bar, s.end_bar)).collect();
        assert_eq!(spans, vec![(0, 6), (6, 12)], "1、11 离两端太近，7 贴着 6");
        assert_eq!((split[0].start, split[0].end), (0.0, 12.5));
        assert_eq!((split[1].start, split[1].end), (12.5, 25.0));
        assert!((split[0].energy - 0.2).abs() < 1e-9 && (split[1].energy - 0.8).abs() < 1e-9);
    }

    #[test]
    fn a_louder_second_half_is_its_own_section() {
        let bpm = 120.0;
        let bar = 4.0 * 60.0 / bpm;
        // 前 16 小节只有咔哒，后 16 小节叠噪声。
        let pcm = click_track(bpm, 0.0, 32.0 * bar, Some(16.0 * bar));
        let analysis = analyze(&pcm, RATE, &BeatOptions::default()).unwrap();
        assert!(analysis.sections.len() >= 2, "{:?}", analysis.sections);
        let cut = analysis.sections[1].start;
        assert!(
            (cut - 16.0 * bar).abs() <= bar + 0.05,
            "{cut} {:?}",
            analysis.sections
        );
        assert!(analysis.sections[1].energy > analysis.sections[0].energy);
        assert_eq!(analysis.sections[0].start, 0.0);
        assert_eq!(analysis.sections.last().unwrap().end, analysis.duration);
    }

    #[test]
    fn silence_and_bad_options_are_errors() {
        assert!(analyze(&vec![0.0; 16_000 * 5], RATE, &BeatOptions::default()).is_err());
        let pcm = click_track(120.0, 0.0, 10.0, None);
        let bad = BeatOptions {
            beats_per_bar: 0,
            ..BeatOptions::default()
        };
        assert!(analyze(&pcm, RATE, &bad).is_err());
    }

    #[test]
    fn analysis_is_deterministic() {
        let pcm = click_track(128.0, 0.1, 20.0, Some(10.0));
        let a = analyze(&pcm, RATE, &BeatOptions::default()).unwrap();
        let b = analyze(&pcm, RATE, &BeatOptions::default()).unwrap();
        assert_eq!(a, b);
    }
}
