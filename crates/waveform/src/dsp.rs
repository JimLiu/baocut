//! PCM → BCS1 的派生 DSP。参数全部冻结在 [`crate::bcs1`]，此处不接受覆写。
//!
//! | 参数 | 值 |
//! | --- | --- |
//! | 窗函数 | Blackman（周期式），窗长 = `fft_size` = 1024 |
//! | hop | `sample_rate / analysis_rate` = 800 |
//! | FFT | realfft `plan_fft_forward(1024)` |
//! | 幅度 | `sqrt(re² + im²) / fft_size` → `20 * log10(max(mag, 1e-10))` |
//! | 边界 | 窗口左对齐在 `frame * hop`，越界零填充 |
//!
//! 帧数 = `ceil(duration * analysis_rate)` = `ceil(samples / hop)`，与时长是确定关系。

use anyhow::{Context, Result, bail};
use realfft::RealFftPlanner;

use crate::Fnv1a64;
use crate::bcs1::{
    ANALYSIS_RATE, Bcs1Header, CANONICAL_MAX_DB, CANONICAL_MIN_DB, FFT_SIZE, FRAME_LEN, FREQ_BINS,
    HOP, SAMPLE_RATE, SpectrumBackend, TIME_BINS, encode,
};

/// 幅度下限：`log10(0)` 不可用，且再低的能量在 canonical 窗里也已经是 0。
const MAGNITUDE_FLOOR: f64 = 1e-10;
/// 内容 hash 的算法域分隔符。BCS1 的二进制版号不必随 DSP 调参变化，但任何
/// 会改变频谱字节的算法都必须改这个标识，让缓存内容指纹同步失效。
const DSP_FINGERPRINT: &[u8] = b"bcs1-dsp-blackman-normalized-v2";

/// 给定样本数的帧数：`ceil(samples / hop)`。
pub fn frame_count_for(samples: usize) -> usize {
    samples.div_ceil(HOP as usize)
}

/// BCS1 header 的内容 hash：FNV-1a64(解码 PCM 的 f32 小端字节 ‖ 全部 DSP 参数)。
///
/// **backend 不参与**——它只进 `flags`。同一份 PCM 无论谁解出来的，内容 hash 相同，
/// 渲染因此可复现。
pub fn content_hash(pcm: &[f32]) -> u64 {
    let mut hash = Fnv1a64::new();
    hash.write(DSP_FINGERPRINT);
    for sample in pcm {
        hash.write(&sample.to_le_bytes());
    }
    for parameter in [ANALYSIS_RATE, SAMPLE_RATE, FFT_SIZE, TIME_BINS, FREQ_BINS] {
        hash.write(&parameter.to_le_bytes());
    }
    hash.finish()
}

/// 时域采样点 → 中心化字节：`128 + round(sample * 127)`，钳制 0..255。
/// 语义对齐 Web Audio 的 `getByteTimeDomainData`：静音 = 128。
pub fn time_byte(sample: f32) -> u8 {
    let sample = if sample.is_finite() {
        f64::from(sample)
    } else {
        0.0
    };
    (128.0 + (sample * 127.0).round()).clamp(0.0, 255.0) as u8
}

/// 幅度 → dB：`20 * log10(max(mag, 1e-10))`。
pub fn magnitude_db(magnitude: f64) -> f64 {
    20.0 * magnitude.max(MAGNITUDE_FLOOR).log10()
}

/// dB → canonical 窗字节：`clamp(255 * (dB + 120) / 160, 0, 255)`。
pub fn canonical_byte(decibels: f64) -> u8 {
    let span = CANONICAL_MAX_DB - CANONICAL_MIN_DB;
    (255.0 * (decibels - CANONICAL_MIN_DB) / span)
        .clamp(0.0, 255.0)
        .round() as u8
}

/// 48 kHz 单声道 PCM → 完整 BCS1 文件字节。
pub fn analyze(pcm: &[f32], backend: SpectrumBackend) -> Result<Vec<u8>> {
    let payload = analyze_payload(pcm)?;
    let frame_count = (payload.len() / FRAME_LEN) as u32;
    encode(
        &Bcs1Header::new(backend, frame_count, content_hash(pcm)),
        &payload,
    )
}

/// 只算 payload（`frame_count × 640`），不带 header。
pub fn analyze_payload(pcm: &[f32]) -> Result<Vec<u8>> {
    if pcm.is_empty() {
        bail!("媒体没有可解码的音频样本");
    }
    let frame_count = frame_count_for(pcm.len());
    if u32::try_from(frame_count).is_err() {
        bail!("频谱帧数 {frame_count} 超过 BCS1 上限");
    }
    let mut analyser = FrameAnalyser::new();
    let mut payload = Vec::with_capacity(frame_count * FRAME_LEN);
    for frame in 0..frame_count {
        analyser.frame(pcm, frame * HOP as usize, &mut payload)?;
    }
    Ok(payload)
}

/// 一帧的分析：窗口左对齐在 `start`，越界零填充。
struct FrameAnalyser {
    window: Vec<f64>,
    fft: std::sync::Arc<dyn realfft::RealToComplex<f64>>,
    input: Vec<f64>,
    spectrum: Vec<realfft::num_complex::Complex<f64>>,
    scratch: Vec<realfft::num_complex::Complex<f64>>,
}

impl FrameAnalyser {
    fn new() -> Self {
        let window_len = FFT_SIZE as usize;
        let fft = RealFftPlanner::<f64>::new().plan_fft_forward(window_len);
        Self {
            window: blackman_window(window_len),
            input: fft.make_input_vec(),
            spectrum: fft.make_output_vec(),
            scratch: fft.make_scratch_vec(),
            fft,
        }
    }

    fn frame(&mut self, pcm: &[f32], start: usize, payload: &mut Vec<u8>) -> Result<()> {
        let window_len = FFT_SIZE as usize;
        let stride = window_len / TIME_BINS as usize;
        // 时域行取窗内未加窗的原始样本；加窗只服务频域。
        for point in 0..TIME_BINS as usize {
            payload.push(time_byte(sample_at(pcm, start + point * stride)));
        }
        for (offset, slot) in self.input.iter_mut().enumerate() {
            *slot = f64::from(sample_at(pcm, start + offset)) * self.window[offset];
        }
        self.fft
            .process_with_scratch(&mut self.input, &mut self.spectrum, &mut self.scratch)
            .context("执行 1024 点 real FFT")?;
        for bin in self.spectrum.iter().take(FREQ_BINS as usize) {
            // Web Audio 的 analyser 在 FFT 后先做 1/N 幅度归一化，再进入
            // smoothing / dB 窗。realfft 返回未归一化结果，所以这里显式除 N。
            let magnitude = (bin.re * bin.re + bin.im * bin.im).sqrt() / window_len as f64;
            payload.push(canonical_byte(magnitude_db(magnitude)));
        }
        Ok(())
    }
}

/// 分段送 PCM 的 [`analyze`]：结果与把整段 PCM 一次交给 [`analyze`] 逐字节相同，手里只留一个窗口的样本。
/// 解码与分析不在同一处（编辑器预览按块把浏览器解好的声音送进 WASM）时用它，不必把整段 PCM 放进一块内存。
pub struct SpectrumStream {
    analyser: FrameAnalyser,
    hash: Fnv1a64,
    /// 已送进来的样本数。
    samples: usize,
    /// 还要用到的样本：第一个是全局的第 `offset` 个。
    pending: Vec<f32>,
    offset: usize,
    /// 下一帧的帧号。
    next: usize,
    payload: Vec<u8>,
}

impl Default for SpectrumStream {
    fn default() -> Self {
        Self::new()
    }
}

impl SpectrumStream {
    pub fn new() -> Self {
        let mut hash = Fnv1a64::new();
        hash.write(DSP_FINGERPRINT);
        Self {
            analyser: FrameAnalyser::new(),
            hash,
            samples: 0,
            pending: Vec::new(),
            offset: 0,
            next: 0,
            payload: Vec::new(),
        }
    }

    /// 接着送一段样本。窗口完整的帧当场算掉，用不到的样本随即丢弃。
    pub fn push(&mut self, pcm: &[f32]) -> Result<()> {
        for sample in pcm {
            self.hash.write(&sample.to_le_bytes());
        }
        self.samples += pcm.len();
        self.pending.extend_from_slice(pcm);
        let hop = HOP as usize;
        while self.next * hop + FFT_SIZE as usize <= self.samples {
            let start = self.next * hop - self.offset;
            self.analyser
                .frame(&self.pending, start, &mut self.payload)?;
            self.next += 1;
        }
        let keep = self.next * hop - self.offset;
        if keep > 0 {
            let keep = keep.min(self.pending.len());
            self.pending.drain(..keep);
            self.offset += keep;
        }
        Ok(())
    }

    /// 送完了：算掉末尾越界零填充的帧，交出完整的 BCS1 文件字节。
    pub fn finish(mut self, backend: SpectrumBackend) -> Result<Vec<u8>> {
        if self.samples == 0 {
            bail!("媒体没有可解码的音频样本");
        }
        let frame_count = frame_count_for(self.samples);
        let Ok(frames) = u32::try_from(frame_count) else {
            bail!("频谱帧数 {frame_count} 超过 BCS1 上限");
        };
        while self.next < frame_count {
            let start = self.next * HOP as usize - self.offset;
            self.analyser
                .frame(&self.pending, start, &mut self.payload)?;
            self.next += 1;
        }
        for parameter in [ANALYSIS_RATE, SAMPLE_RATE, FFT_SIZE, TIME_BINS, FREQ_BINS] {
            self.hash.write(&parameter.to_le_bytes());
        }
        encode(
            &Bcs1Header::new(backend, frames, self.hash.finish()),
            &self.payload,
        )
    }
}

/// 越界零填充；非有限样本按静音处理，避免 NaN 顺着 FFT 污染整帧。
fn sample_at(pcm: &[f32], index: usize) -> f32 {
    match pcm.get(index) {
        Some(sample) if sample.is_finite() => *sample,
        _ => 0.0,
    }
}

fn blackman_window(length: usize) -> Vec<f64> {
    (0..length)
        .map(|index| {
            let phase = 2.0 * std::f64::consts::PI * index as f64 / length as f64;
            0.42 - 0.5 * phase.cos() + 0.08 * (2.0 * phase).cos()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bcs1;

    #[test]
    fn frame_count_is_the_ceiling_of_samples_over_hop() {
        assert_eq!(frame_count_for(0), 0);
        assert_eq!(frame_count_for(1), 1);
        assert_eq!(frame_count_for(800), 1);
        assert_eq!(frame_count_for(801), 2);
        assert_eq!(frame_count_for(48_000), 60);
    }

    #[test]
    fn time_bytes_center_on_128() {
        assert_eq!(time_byte(0.0), 128);
        assert_eq!(time_byte(1.0), 255);
        assert_eq!(time_byte(-1.0), 1);
        assert_eq!(time_byte(2.0), 255);
        assert_eq!(time_byte(-2.0), 0);
        assert_eq!(time_byte(f32::NAN), 128);
        assert_eq!(time_byte(0.5), 128 + 64);
    }

    #[test]
    fn canonical_window_endpoints_and_floor() {
        assert_eq!(canonical_byte(-120.0), 0);
        assert_eq!(canonical_byte(40.0), 255);
        assert_eq!(canonical_byte(-200.0), 0);
        assert_eq!(canonical_byte(999.0), 255);
        assert_eq!(canonical_byte(-40.0), 128);
        // 幅度下限：0 与 1e-12 都落在 -200 dB，钳到 0。
        assert_eq!(magnitude_db(0.0), -200.0);
        assert_eq!(magnitude_db(1.0), 0.0);
        assert!((magnitude_db(10.0) - 20.0).abs() < 1e-12);
        assert_eq!(canonical_byte(magnitude_db(0.0)), 0);
    }

    #[test]
    fn silence_produces_centered_time_rows_and_zero_spectrum() {
        let bytes = analyze(&vec![0.0; 1600], SpectrumBackend::Symphonia).unwrap();
        let view = bcs1::parse(&bytes).unwrap();
        assert_eq!(view.frame_count(), 2);
        for frame in 0..2 {
            assert!(view.time_row(frame).unwrap().iter().all(|&b| b == 128));
            assert!(view.freq_row(frame).unwrap().iter().all(|&b| b == 0));
        }
    }

    #[test]
    fn streamed_pcm_matches_one_shot_analysis() {
        // 长度不是 hop 的整数倍，块长也不对齐 hop 与窗长。
        let pcm: Vec<f32> = (0..20_123)
            .map(|i| (i as f32 * 0.031).sin() * 0.6 + (i as f32 * 0.0007).cos() * 0.2)
            .collect();
        let whole = analyze(&pcm, SpectrumBackend::Symphonia).unwrap();
        for chunk in [1, 333, 800, 1024, 4097, 20_123] {
            let mut stream = SpectrumStream::new();
            for part in pcm.chunks(chunk) {
                stream.push(part).unwrap();
            }
            assert_eq!(
                stream.finish(SpectrumBackend::Symphonia).unwrap(),
                whole,
                "块长 {chunk}"
            );
        }
        assert!(
            SpectrumStream::new()
                .finish(SpectrumBackend::Symphonia)
                .is_err()
        );
    }

    #[test]
    fn empty_pcm_is_an_error_not_an_empty_file() {
        assert!(analyze(&[], SpectrumBackend::Symphonia).is_err());
        assert!(analyze_payload(&[]).is_err());
    }

    #[test]
    fn content_hash_tracks_pcm_and_is_backend_independent() {
        let pcm = vec![0.25f32; 800];
        let symphonia = analyze(&pcm, SpectrumBackend::Symphonia).unwrap();
        let ffmpeg = analyze(&pcm, SpectrumBackend::Ffmpeg).unwrap();
        let left = bcs1::parse(&symphonia).unwrap().header();
        let right = bcs1::parse(&ffmpeg).unwrap().header();
        assert_eq!(left.content_hash, right.content_hash);
        assert_ne!(left.backend, right.backend);
        // payload 与 backend 无关，只有 flags 不同。
        assert_eq!(symphonia[bcs1::HEADER_LEN..], ffmpeg[bcs1::HEADER_LEN..]);

        let mut nudged = pcm.clone();
        nudged[7] = 0.2500001;
        assert_ne!(content_hash(&pcm), content_hash(&nudged));
    }

    #[test]
    fn a_pure_tone_peaks_in_its_own_bin() {
        // 48 kHz / 1024 点 → bin 宽 46.875 Hz；3000 Hz 落在 bin 64。
        let pcm: Vec<f32> = (0..9600)
            .map(|index| {
                (0.5 * (2.0 * std::f64::consts::PI * 3000.0 * index as f64 / 48_000.0).sin()) as f32
            })
            .collect();
        let bytes = analyze(&pcm, SpectrumBackend::Symphonia).unwrap();
        let view = bcs1::parse(&bytes).unwrap();
        assert_eq!(view.frame_count(), 12);
        let row = view.freq_row(4).unwrap();
        assert!(row[64] > row[63] && row[64] > row[65], "主瓣应落在 bin 64");
        assert!(row[64] > row[80] + 20, "主瓣应显著高于远端 bin");
    }

    #[test]
    fn windows_are_left_aligned_and_zero_padded_at_the_tail() {
        // 一帧半的素材：第二帧只有前 400 个样本有效，其余零填充。
        let pcm: Vec<f32> = (0..1200)
            .map(|index| if index < 800 { 0.5 } else { -0.5 })
            .collect();
        let bytes = analyze(&pcm, SpectrumBackend::Symphonia).unwrap();
        let view = bcs1::parse(&bytes).unwrap();
        assert_eq!(view.frame_count(), 2);
        assert_eq!(view.time_row(0).unwrap()[0], time_byte(0.5));
        assert_eq!(view.time_row(1).unwrap()[0], time_byte(-0.5));
        // 第二帧第 p 个时域点 = 样本 800 + p*8：p = 49 仍在素材内，p = 50 已越界。
        assert_eq!(view.time_row(1).unwrap()[49], time_byte(-0.5));
        assert_eq!(view.time_row(1).unwrap()[50], 128);
        assert_eq!(view.time_row(1).unwrap()[127], 128);
    }

    #[test]
    fn fft_magnitude_is_normalized_before_db_conversion() {
        // bin-centered 正弦经过周期 Blackman 后，单边复 FFT 的峰值是
        // amplitude * sum(window) / 2。再除 N 后应约为 0.5 * 0.42 / 2 = 0.105，
        // 即 -19.58 dB；若漏掉 1/N 会整体高约 60.2 dB 并贴顶。
        let pcm: Vec<f32> = (0..FFT_SIZE as usize)
            .map(|index| {
                (0.5 * (2.0 * std::f64::consts::PI * 64.0 * index as f64 / f64::from(FFT_SIZE))
                    .sin()) as f32
            })
            .collect();
        let bytes = analyze(&pcm, SpectrumBackend::Symphonia).unwrap();
        let view = bcs1::parse(&bytes).unwrap();
        let peak_db = crate::remap::canonical_db(view.freq_row(0).unwrap()[64]);
        assert!((peak_db - magnitude_db(0.105)).abs() <= 0.7, "{peak_db}");
        assert!(peak_db < -18.0, "归一化后的峰值不应贴顶：{peak_db}");
    }
}
