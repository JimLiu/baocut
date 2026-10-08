//! 纯 Rust 音频解码主路径（Symphonia）：任意容器 → 48 kHz 交错立体声 f32。
//!
//! 语义对齐迁移前的
//! `ffmpeg -ss <start> -t <duration> -i <src> -f f32le -ac 2 -ar 48000 -`：
//!
//! - **窗口**：`[start, start + duration)`，在**源采样帧**上取整（`round`），
//!   样本精确；源不够长就自然截短（ffmpeg 的 `-t` 同样只是上界）。
//! - **编辑表**：MP4 / M4A / MOV 音轨 `elst` 的起点（AAC 编码器前置帧，ffmpeg 编的
//!   1024 帧、AVFoundation 编的 2112 帧）先从解码帧流里丢掉，`start = 0` 才是
//!   ffmpeg 与播放器眼里的第 0 帧。Symphonia 自己不应用编辑表，漏了这一步整条
//!   音频会晚一个前置帧（`media_probe::audio_edit_start`）。
//! - **声道**：单声道以等功率增益映射到左右（各乘 1/√2），立体声原样。
//!   **三声道及以上直接报错**让调用方回落 ffmpeg——`-ac 2` 的下混矩阵（中置 / 环绕的增益与相位）是有讲究的，
//!   猜一个近似值会让 5.1 素材的混音听起来不一样，宁可不接。
//! - **采样率**：多相加窗 sinc 重采样到 48 kHz；源已是 48 kHz 时直通不滤波。
//!
//! ## 与 `bcut-speech` 那份重采样器的关系
//!
//! `core/crates/bcut-speech/src/audio/symphonia_decode.rs` 里有一份同族实现，
//! 但它是**单声道 → 16 kHz 写死**的 ASR 前端（taps 与截止都按语音调过）。
//! `bcut-render` 不能依赖 `bcut-speech`（那是带 MLX/Candle 的重 crate，方向也
//! 反了），把两者收敛成一个共享 crate 是比 WP6a 更大的一次改动。这里保留同一套
//! 算法（多相加窗 sinc、Blackman 窗、DC 增益归一）但参数按全频段音频重新取，
//! 并在两处互相点名，等有第三个调用点时再抽 crate。

use std::path::Path;

use anyhow::{Context, Result, bail};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::codecs::audio::well_known::CODEC_ID_AAC;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::well_known::FORMAT_ID_ISOMP4;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo, TrackType};
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::Timestamp;

use super::{CHANNELS, SAMPLE_RATE};

/// 相位表大小：小数偏移量化到 1/1024 源样本。
const PHASE_COUNT: usize = 1024;
/// 单侧基准 taps 数。比 ASR 前端那份（16）大一倍：这里要过的是整条可听频带的
/// 音乐/人声，过渡带窄一点才不会在 44.1 → 48 这种常见换算上削掉高频。
const BASE_HALF_TAPS: usize = 32;
/// 低通截止相对 Nyquist 的余量，抑制过渡带附近的混叠。
const CUTOFF_ROLLOFF: f64 = 0.92;

/// 解码 `path` 的第一条音轨在 `[start, start + duration)` 上的样本，
/// 交出 48 kHz 交错立体声 f32。
///
/// `Err` 一律代表"这条片源纯 Rust 路径解不了"，调用方据此回落 ffmpeg。
pub(crate) fn decode_stereo_48k(path: &Path, start: f64, duration: f64) -> Result<Vec<f32>> {
    decode_window(path, start, duration, true).map(|(samples, _)| samples)
}

/// 整条第一音轨 → 48 kHz 单声道 f32：各声道取平均（单声道源原样）。
pub(crate) fn decode_mono_48k(path: &Path) -> Result<Vec<f32>> {
    let (stereo, _, channels) = decode_window_channels(path, 0.0, f64::INFINITY, false)?;
    // 单声道源在立体声里是两边各乘 1/√2：乘回去。
    let scale = if channels == 1 {
        std::f32::consts::SQRT_2
    } else {
        1.0
    };
    Ok(stereo
        .chunks_exact(CHANNELS)
        .map(|frame| {
            if channels == 1 {
                frame[0] * scale
            } else {
                (frame[0] + frame[1]) * 0.5
            }
        })
        .collect())
}

fn open_format(path: &Path) -> Result<Box<dyn FormatReader>> {
    let file = std::fs::File::open(path).with_context(|| format!("打开媒体 {}", path.display()))?;
    let stream = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    symphonia::default::get_probe()
        .probe(
            &hint,
            stream,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .with_context(|| format!("Rust 解复用失败：{}", path.display()))
}

/// The packet count lets regression tests bound work independently of machine speed.
fn decode_window(
    path: &Path,
    start: f64,
    duration: f64,
    allow_seek: bool,
) -> Result<(Vec<f32>, usize)> {
    decode_window_channels(path, start, duration, allow_seek)
        .map(|(samples, packets, _)| (samples, packets))
}

/// 同 [`decode_window`]，另外交出源的声道数。
fn decode_window_channels(
    path: &Path,
    start: f64,
    duration: f64,
    allow_seek: bool,
) -> Result<(Vec<f32>, usize, usize)> {
    let mut format = open_format(path)?;
    let track = format
        .first_track_known_codec(TrackType::Audio)
        .context("Rust 解复用器没有找到音频轨")?;
    let track_id = track.id;
    // MP4 / M4A 的编码器前置帧：Symphonia 不应用 `elst`，这里自己丢。
    let edit = media_probe::audio_edit_start(path, track_id);
    let codec_params = track
        .codec_params
        .as_ref()
        .and_then(|params| params.audio())
        .context("Rust 解复用器没有给出音频编解码参数")?
        .clone();
    // Only indexed ISO-BMFF AAC tracks with one timestamp tick per decoded sample
    // have the exact clock needed here. Other formats keep the sequential path.
    // AAC needs preceding packets to warm its overlap buffer. Seek 0.5 s before
    // the requested window, including elst priming in the media clock, then
    // discard up to the original sample boundary (never reset the resampler).
    // AAC perceptual noise substitution has a running PRNG: seeking preserves
    // its noise energy, but does not reproduce the sequential random samples.
    let seek_frame = codec_params
        .sample_rate
        .filter(|rate| {
            allow_seek
                && start.is_finite()
                && start > 0.5
                && codec_params.codec == CODEC_ID_AAC
                && format.format_info().format == FORMAT_ID_ISOMP4
                && track.start_ts.is_zero()
                && track
                    .time_base
                    .is_some_and(|base| base.numer.get() == 1 && base.denom.get() == *rate)
        })
        .map(|rate| {
            let priming = edit.map_or(0, |edit| edit.frames(rate));
            priming + ((start - 0.5) * f64::from(rate)).round() as u64
        });
    let mut position = 0_u64;
    if let Some(frame) = seek_frame.and_then(|frame| i64::try_from(frame).ok()) {
        match format.seek(
            SeekMode::Accurate,
            SeekTo::Timestamp {
                ts: Timestamp::new(frame),
                track_id,
            },
        ) {
            Ok(seeked) if seeked.actual_ts.get() >= 0 && seeked.actual_ts.get() <= frame => {
                position = seeked.actual_ts.get() as u64;
            }
            // A failed seek can have moved other tracks already. Reopen rather
            // than assuming the demuxer is still at zero (also preserves EOF).
            _ => format = open_format(path)?,
        }
    }
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&codec_params, &AudioDecoderOptions::default())
        .context("Rust 音频解码器不可用")?;

    // 解到文件末尾（`duration` 无穷大）时不预留。
    let reserve = if duration.is_finite() {
        (duration.max(0.0) * f64::from(SAMPLE_RATE)) as usize * CHANNELS
    } else {
        0
    };
    let mut out: Vec<f32> = Vec::with_capacity(reserve);
    // 采样率与声道数要到首个解码帧才确定；届时换算窗口边界并建重采样器。
    let mut state: Option<StreamState> = None;
    let mut reached_end = false;
    let mut decoded_packets = 0;
    // 交织缓冲跨 packet 复用；`copy_to_vec_interleaved` 自己 resize 到本帧大小。
    let mut interleaved: Vec<f32> = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphoniaError::ResetRequired) => {
                bail!("Rust 解码器要求重置，暂不支持动态音轨参数")
            }
            Err(error) => return Err(error).context("Rust 读取音频 packet 失败"),
        };
        if packet.track_id != track_id {
            continue;
        }
        decoded_packets += 1;
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(error) => return Err(error).context("Rust 音频解码失败"),
        };
        let spec = decoded.spec();
        let channels = spec.channels().count();
        if channels == 0 {
            continue;
        }
        if channels > CHANNELS {
            bail!("Rust 解码路径不做 {channels} 声道下混（交给 ffmpeg 的 -ac 2）");
        }
        let state = match state.as_mut() {
            Some(state) if state.sample_rate != spec.rate() => {
                bail!("Rust 解码路径不支持解码期间采样率变化")
            }
            Some(state) if state.channels != channels => {
                bail!("Rust 解码路径不支持解码期间声道数变化")
            }
            Some(state) => state,
            None => state.insert(StreamState::new(
                spec.rate(),
                channels,
                start,
                duration,
                edit.map_or(0, |edit| edit.frames(spec.rate())),
            )?),
        };
        decoded.copy_to_vec_interleaved(&mut interleaved);
        for frame in interleaved.chunks_exact(channels) {
            let index = position;
            position += 1;
            if index < state.first_frame {
                continue;
            }
            if state.end_frame.is_some_and(|end| index >= end) {
                reached_end = true;
                break;
            }
            // Match ffmpeg's default mono-to-stereo matrix. Duplicating at
            // unity gain would double the power and make native output louder.
            let (left, right) = if channels == 1 {
                let value = frame[0] * std::f32::consts::FRAC_1_SQRT_2;
                (value, value)
            } else {
                (frame[0], frame[1])
            };
            state.resampler.push(left, right, &mut out);
        }
        if reached_end {
            break;
        }
    }
    let mut state = state.context("媒体没有可解码的音频帧")?;
    state.resampler.flush(&mut out);
    Ok((out, decoded_packets, state.channels))
}

struct StreamState {
    sample_rate: u32,
    channels: usize,
    /// 窗口在解码帧流中的边界（end 为开区间），已计入编辑表要丢的前置帧。
    first_frame: u64,
    end_frame: Option<u64>,
    resampler: StereoResampler,
}

impl StreamState {
    /// `priming` 是编辑表起点换算成的解码帧数：呈现时间 0 落在解码帧流的这一帧上。
    fn new(
        sample_rate: u32,
        channels: usize,
        start: f64,
        duration: f64,
        priming: u64,
    ) -> Result<Self> {
        if sample_rate == 0 {
            bail!("Rust 解码器报告了 0 采样率");
        }
        let rate = f64::from(sample_rate);
        let first_frame = priming + (start.max(0.0) * rate).round() as u64;
        let end_frame = (duration.is_finite() && duration > 0.0)
            .then(|| first_frame + (duration * rate).round() as u64);
        Ok(Self {
            sample_rate,
            channels,
            first_frame,
            end_frame,
            resampler: StereoResampler::new(sample_rate),
        })
    }
}

/// 立体声多相加窗 sinc 重采样器：任意源采样率 → [`SAMPLE_RATE`]。
///
/// 两个声道共用同一组核与同一个相位游标（同一时刻同一插值点），因此不会引入
/// 声道间相位差。滤波器对称零相位，输出样本 n 恰好对应窗口内源时间
/// `n / SAMPLE_RATE` 秒，与 ffmpeg 兜底路径的时间轴一致。
struct StereoResampler {
    /// 源采样率等于目标时直通，不做任何滤波。
    passthrough: bool,
    /// 每个输出样本对应的源样本步长 = 源采样率 / 48000。
    step: f64,
    /// 单侧 taps 数（源样本）。
    half: usize,
    /// PHASE_COUNT 组核平铺存放，每组 2*half+1 个 taps，DC 增益归一到 1。
    phases: Vec<f32>,
    /// 尚未消费完的窗口内源样本（交错立体声）；只保留仍会被卷积用到的尾部。
    pending: Vec<f32>,
    /// pending 的第 0 帧在窗口内源帧流中的绝对下标。
    pending_start: u64,
    /// 已接收的窗口内源帧总数。
    received: u64,
    /// 下一个待产出的输出帧下标。
    next_output: u64,
}

impl StereoResampler {
    fn new(source_rate: u32) -> Self {
        if source_rate == SAMPLE_RATE {
            return Self {
                passthrough: true,
                step: 1.0,
                half: 0,
                phases: Vec::new(),
                pending: Vec::new(),
                pending_start: 0,
                received: 0,
                next_output: 0,
            };
        }
        let step = f64::from(source_rate) / f64::from(SAMPLE_RATE);
        // 降采样时把截止和 taps 一起按步长缩放，保持阻带衰减；升采样保持基准。
        let scale = step.max(1.0);
        let half = (BASE_HALF_TAPS as f64 * scale).ceil() as usize;
        let cutoff = CUTOFF_ROLLOFF * 0.5 / scale;
        let taps_len = 2 * half + 1;
        let mut phases = vec![0.0f32; PHASE_COUNT * taps_len];
        for phase in 0..PHASE_COUNT {
            let frac = phase as f64 / PHASE_COUNT as f64;
            let row = &mut phases[phase * taps_len..(phase + 1) * taps_len];
            let mut gain = 0.0f64;
            for (tap, slot) in row.iter_mut().enumerate() {
                let distance = tap as f64 - half as f64 - frac;
                let value = 2.0
                    * cutoff
                    * sinc(2.0 * cutoff * distance)
                    * blackman(distance / (half as f64 + 1.0));
                gain += value;
                *slot = value as f32;
            }
            let normalize = (1.0 / gain) as f32;
            for slot in row.iter_mut() {
                *slot *= normalize;
            }
        }
        Self {
            passthrough: false,
            step,
            half,
            phases,
            pending: Vec::new(),
            pending_start: 0,
            received: 0,
            next_output: 0,
        }
    }

    fn push(&mut self, left: f32, right: f32, output: &mut Vec<f32>) {
        if self.passthrough {
            output.push(left);
            output.push(right);
            return;
        }
        self.pending.push(left);
        self.pending.push(right);
        self.received += 1;
        self.drain(false, output);
    }

    /// 输入结束后产出剩余输出；右侧不足的 taps 按零填充。
    fn flush(&mut self, output: &mut Vec<f32>) {
        if self.passthrough {
            return;
        }
        self.drain(true, output);
        self.pending.clear();
    }

    fn drain(&mut self, flushing: bool, output: &mut Vec<f32>) {
        let taps_len = 2 * self.half + 1;
        let frames = |slice: &Vec<f32>| slice.len() / CHANNELS;
        loop {
            let center = self.next_output as f64 * self.step;
            if flushing && center >= self.received as f64 {
                break;
            }
            let center_floor = center.floor() as i64;
            let available_end = self.pending_start as i64 + frames(&self.pending) as i64;
            if !flushing && center_floor + self.half as i64 >= available_end {
                break;
            }
            let frac = center - center_floor as f64;
            let phase = ((frac * PHASE_COUNT as f64) as usize).min(PHASE_COUNT - 1);
            let kernel = &self.phases[phase * taps_len..(phase + 1) * taps_len];
            let first = center_floor - self.half as i64;
            let mut acc = [0.0f32; CHANNELS];
            for (tap, weight) in kernel.iter().enumerate() {
                // 流两端越界按零填充；对应 ffmpeg 在边界的行为差异只有亚毫秒级。
                let index = first + tap as i64 - self.pending_start as i64;
                if index >= 0 && (index as usize) < frames(&self.pending) {
                    let base = index as usize * CHANNELS;
                    acc[0] += self.pending[base] * weight;
                    acc[1] += self.pending[base + 1] * weight;
                }
            }
            output.extend_from_slice(&acc);
            self.next_output += 1;
            // 丢掉再也用不到的前缀，控制驻留内存；攒够一批再挪，摊平搬移成本。
            let keep_from = (self.next_output as f64 * self.step).floor() as i64 - self.half as i64;
            let drop = (keep_from - self.pending_start as i64).max(0) as usize;
            if drop >= 8192 {
                self.pending.drain(..drop * CHANNELS);
                self.pending_start += drop as u64;
            }
        }
    }
}

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-12 {
        1.0
    } else {
        let scaled = std::f64::consts::PI * x;
        scaled.sin() / scaled
    }
}

/// Blackman 窗；|u| >= 1 时为 0。
fn blackman(u: f64) -> f64 {
    if u.abs() >= 1.0 {
        return 0.0;
    }
    let scaled = std::f64::consts::PI * u;
    0.42 + 0.5 * scaled.cos() + 0.08 * (2.0 * scaled).cos()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decoding_preserves_power_when_mapping_mono_and_stereo_to_stereo() {
        for channels in [1_u16, 2] {
            let file = tempfile::NamedTempFile::with_suffix(".wav").unwrap();
            let frames = 4800_u32;
            let size = frames * u32::from(channels) * 2;
            let mut wav = Vec::new();
            wav.extend_from_slice(b"RIFF");
            wav.extend_from_slice(&(size + 36).to_le_bytes());
            wav.extend_from_slice(b"WAVEfmt ");
            wav.extend_from_slice(&16_u32.to_le_bytes());
            wav.extend_from_slice(&1_u16.to_le_bytes());
            wav.extend_from_slice(&channels.to_le_bytes());
            wav.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
            wav.extend_from_slice(&(SAMPLE_RATE * u32::from(channels) * 2).to_le_bytes());
            wav.extend_from_slice(&(channels * 2).to_le_bytes());
            wav.extend_from_slice(&16_u16.to_le_bytes());
            wav.extend_from_slice(b"data");
            wav.extend_from_slice(&size.to_le_bytes());
            for _ in 0..frames {
                wav.extend_from_slice(&8192_i16.to_le_bytes());
                if channels == 2 {
                    wav.extend_from_slice(&(-16384_i16).to_le_bytes());
                }
            }
            std::fs::write(file.path(), wav).unwrap();
            let samples = decode_stereo_48k(file.path(), 0.02, 0.04).unwrap();
            assert_eq!(samples.len(), 1920 * 2);
            let expected_power = if channels == 1 { 0.0625 } else { 0.3125 };
            for frame in samples.chunks_exact(2) {
                let power = frame[0].powi(2) + frame[1].powi(2);
                assert!(
                    (power - expected_power).abs() < 1e-6,
                    "{channels} channels: decoded power {power}, expected {expected_power}"
                );
                if channels == 1 {
                    assert_eq!(frame[0], frame[1]);
                } else {
                    assert_eq!(frame, &[0.25, -0.5]);
                }
            }
        }
    }

    fn native_export_fixture() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/native-export/source.mp4")
    }

    /// MP4 编辑表：入库夹具是 ffmpeg 编的 48 kHz 单声道 AAC 正弦，音轨
    /// `elst media_time 1024`。丢掉前置帧后帧数与 `ffmpeg -f f32le` 一致（48128），
    /// 头 20 ms 里就有正弦；不丢的话多出 1024 帧，开头 21 ms 是编码器垫的近静音
    /// （峰值约 0.0035，这里再乘 1/√2）。
    #[test]
    fn mp4_edit_list_priming_is_dropped_like_ffmpeg() {
        let fixture = native_export_fixture();
        let samples = decode_stereo_48k(&fixture, 0.0, 10.0).unwrap();
        assert_eq!(samples.len() / CHANNELS, 48_128, "帧数应与 ffmpeg 解码一致");
        let head = samples[..960 * CHANNELS]
            .iter()
            .fold(0.0f32, |peak, value| peak.max(value.abs()));
        assert!(head > 0.05, "头 20 ms 峰值 {head}：前置帧没丢掉");
        // 窗口起点同样从呈现时间 0 起算：48 kHz 直通，逐样本相等。
        let window = decode_stereo_48k(&fixture, 0.5, 0.1).unwrap();
        assert_eq!(window, samples[24_000 * CHANNELS..28_800 * CHANNELS]);
    }

    #[test]
    fn indexed_aac_windows_seek_without_changing_samples_or_resampling() {
        let directory = tempfile::tempdir().unwrap();
        for rate in [44_100, 48_000] {
            let path = directory.path().join(format!("indexed-{rate}.m4a"));
            let source = format!("anoisesrc=sample_rate={rate}:duration=12:seed=42");
            let encoded = crate::exec::command("ffmpeg")
                .args(["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i"])
                .arg(source)
                .args(["-ac", "2", "-c:a", "aac", "-b:a", "192k", "-aac_pns", "0"])
                .arg(&path)
                .status();
            if !encoded.is_ok_and(|status| status.success()) {
                eprintln!("跳过：这台机器没有能编 AAC 的 ffmpeg");
                return;
            }
            // Non-packet-aligned boundaries, including the final padded packet
            // and an out-of-range seek which must recover the sequential EOF.
            for (start, duration) in [(10.373, 0.213), (11.873, 1.0), (20.0, 0.1)] {
                let (reference, sequential_packets) =
                    decode_window(&path, start, duration, false).unwrap();
                let (window, seek_packets) = decode_window(&path, start, duration, true).unwrap();
                assert_eq!(window, reference, "{rate} Hz at {start}s");
                if start < 12.0 {
                    assert!(
                        seek_packets * 5 < sequential_packets,
                        "decoded {seek_packets} packets instead of {sequential_packets}"
                    );
                }
            }
        }
    }

    #[test]
    #[ignore = "read-only benchmark; set BCUT_PERF_MEDIA to a long AAC MP4"]
    fn late_audio_window_benchmark() {
        let path = std::env::var("BCUT_PERF_MEDIA").expect("BCUT_PERF_MEDIA");
        let path = Path::new(&path);
        let before = std::time::Instant::now();
        let (reference, sequential_packets) = decode_window(path, 3058.8, 84.7, false).unwrap();
        let sequential_ms = before.elapsed().as_secs_f64() * 1000.0;
        let before = std::time::Instant::now();
        let (window, seek_packets) = decode_window(path, 3058.8, 84.7, true).unwrap();
        let seek_ms = before.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(window.len(), reference.len());
        let max_diff = window
            .iter()
            .zip(&reference)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0_f32, f32::max);
        let difference_power = window
            .iter()
            .zip(&reference)
            .map(|(a, b)| f64::from(a - b).powi(2))
            .sum::<f64>();
        let signal_power = reference
            .iter()
            .map(|value| f64::from(*value).powi(2))
            .sum::<f64>();
        let snr = 10.0 * (signal_power / difference_power).log10();
        assert!(seek_packets * 20 < sequential_packets);
        eprintln!(
            "audio window: sequential={sequential_ms:.1}ms/{sequential_packets} packets, seek={seek_ms:.1}ms/{seek_packets} packets, max_diff={max_diff}, snr={snr:.1}dB"
        );
        // This source uses AAC PNS; exact random samples cannot survive seek.
        // Bound the total deviation and verify zero sample lag independently.
        assert!(snr > 40.0, "snr={snr:.1}dB");
        let from = 10 * SAMPLE_RATE as usize * CHANNELS;
        let length = SAMPLE_RATE as usize * CHANNELS;
        let correlation = |lag: isize| -> f64 {
            (from..from + length)
                .step_by(CHANNELS)
                .map(|index| {
                    f64::from(reference[index])
                        * f64::from(window[(index as isize + lag * CHANNELS as isize) as usize])
                })
                .sum()
        };
        let best = (-32..=32)
            .max_by(|a, b| correlation(*a).total_cmp(&correlation(*b)))
            .unwrap();
        assert_eq!(best, 0, "audio seek introduced a sample offset");
    }

    /// 报告里的原场景：44.1 kHz 源经 `ffmpeg -c:a aac` 编成 M4A（1024 帧前置），
    /// 纯 Rust 路径与 ffmpeg 兜底路径解出的 48 kHz PCM 必须零时差。修之前 Rust
    /// 路径晚 1115 帧（1024 × 48000 / 44100 ≈ 23.2 ms）。没有能编 AAC 的 ffmpeg 就跳过。
    #[test]
    fn an_ffmpeg_aac_m4a_decodes_with_zero_lag_against_ffmpeg() {
        let directory = tempfile::tempdir().unwrap();
        let wav = directory.path().join("noise.wav");
        let m4a = directory.path().join("noise.m4a");
        let rate = 44_100_u32;
        let frames = rate; // 1 秒
        let size = frames * 2;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(size + 36).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&rate.to_le_bytes());
        bytes.extend_from_slice(&(rate * 2).to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&size.to_le_bytes());
        // 固定种子的白噪声：互相关峰又尖又唯一。
        let mut seed = 0x2545_f491_u32;
        for _ in 0..frames {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            bytes.extend_from_slice(&((seed >> 16) as i16 / 4).to_le_bytes());
        }
        std::fs::write(&wav, bytes).unwrap();
        let encoded = crate::exec::command("ffmpeg")
            .args(["-nostdin", "-loglevel", "error", "-y", "-i"])
            .arg(&wav)
            .args(["-c:a", "aac", "-b:a", "192k"])
            .arg(&m4a)
            .status();
        if !encoded.is_ok_and(|status| status.success()) {
            eprintln!("跳过：这台机器没有能编 AAC 的 ffmpeg");
            return;
        }
        let native = decode_stereo_48k(&m4a, 0.0, 1.0).unwrap();
        let reference = super::super::decode_with_ffmpeg("noise", &m4a, 0.0, 1.0, 1.0).unwrap();
        let left =
            |samples: &[f32]| -> Vec<f32> { samples.iter().step_by(CHANNELS).copied().collect() };
        let (native, reference) = (left(&native), left(&reference));
        // 取中段 0.25 s 与参考逐偏移求互相关，搜 ±1500 帧（盖住 1115 与 2112 两种前置）。
        let (from, len, reach) = (12_000_usize, 12_000_usize, 1_500_i64);
        let correlation = |lag: i64| -> f64 {
            (0..len)
                .map(|offset| {
                    let at = from + offset;
                    let shifted = at as i64 + lag;
                    let value = usize::try_from(shifted)
                        .ok()
                        .and_then(|index| native.get(index))
                        .copied()
                        .unwrap_or(0.0);
                    f64::from(reference[at]) * f64::from(value)
                })
                .sum()
        };
        let (best, _) = (-reach..=reach)
            .map(|lag| (lag, correlation(lag)))
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .unwrap();
        assert_eq!(best, 0, "纯 Rust 路径相对 ffmpeg 晚 {best} 帧（48 kHz）");
    }

    /// 目标采样率直通：一个样本都不动，也不引入延迟。
    #[test]
    fn a_matching_sample_rate_passes_samples_through_untouched() {
        let mut resampler = StereoResampler::new(SAMPLE_RATE);
        let mut out = Vec::new();
        resampler.push(0.25, -0.5, &mut out);
        resampler.push(1.0, 0.0, &mut out);
        resampler.flush(&mut out);
        assert_eq!(out, vec![0.25, -0.5, 1.0, 0.0]);
    }

    /// 44.1k → 48k：输出帧数按比例增加（±1 帧的边界余量），直流电平不变。
    #[test]
    fn upsampling_preserves_level_and_scales_the_frame_count() {
        let source_rate = 44_100_u32;
        let frames = source_rate as usize / 10; // 0.1 秒
        let mut resampler = StereoResampler::new(source_rate);
        let mut out = Vec::new();
        for _ in 0..frames {
            resampler.push(0.5, -0.5, &mut out);
        }
        resampler.flush(&mut out);
        let produced = out.len() / CHANNELS;
        let expected = frames * SAMPLE_RATE as usize / source_rate as usize;
        assert!(
            produced.abs_diff(expected) <= 1,
            "输出 {produced} 帧，期望约 {expected} 帧"
        );
        // 两端各有半个窗口的零填充过渡带，取中段验电平。
        let middle = produced / 2 * CHANNELS;
        assert!(
            (out[middle] - 0.5).abs() < 1e-3,
            "左声道电平 {}",
            out[middle]
        );
        assert!(
            (out[middle + 1] + 0.5).abs() < 1e-3,
            "右声道电平 {}",
            out[middle + 1]
        );
    }

    /// 96k → 48k：降采样同样按比例，且左右声道互不串扰。
    #[test]
    fn downsampling_keeps_the_channels_independent() {
        let source_rate = 96_000_u32;
        let frames = source_rate as usize / 10;
        let mut resampler = StereoResampler::new(source_rate);
        let mut out = Vec::new();
        for _ in 0..frames {
            resampler.push(1.0, 0.0, &mut out);
        }
        resampler.flush(&mut out);
        let produced = out.len() / CHANNELS;
        assert!(produced.abs_diff(frames / 2) <= 1, "输出 {produced} 帧");
        let middle = produced / 2 * CHANNELS;
        assert!((out[middle] - 1.0).abs() < 1e-3, "左声道 {}", out[middle]);
        assert!(out[middle + 1].abs() < 1e-3, "右声道应保持静音");
    }

    /// 正弦保真：44.1k 的 1 kHz 正弦重采样到 48k 后 RMS 与理论值一致（不是把
    /// 高频削平或整体衰减）。
    #[test]
    fn a_sine_keeps_its_energy_across_the_rate_change() {
        let source_rate = 44_100_u32;
        let frames = source_rate as usize / 2; // 0.5 秒
        let mut resampler = StereoResampler::new(source_rate);
        let mut out = Vec::new();
        for index in 0..frames {
            let phase = std::f64::consts::TAU * 1000.0 * index as f64 / f64::from(source_rate);
            let value = phase.sin() as f32;
            resampler.push(value, value, &mut out);
        }
        resampler.flush(&mut out);
        // 掐掉两端各 10 ms 的过渡带再量 RMS。
        let skip = SAMPLE_RATE as usize / 100 * CHANNELS;
        let core = &out[skip..out.len() - skip];
        let rms = (core
            .iter()
            .map(|v| f64::from(*v) * f64::from(*v))
            .sum::<f64>()
            / core.len() as f64)
            .sqrt();
        assert!(
            (rms - std::f64::consts::FRAC_1_SQRT_2).abs() < 0.02,
            "重采样后的 RMS {rms:.4} 偏离正弦理论值 0.7071"
        );
    }
}
