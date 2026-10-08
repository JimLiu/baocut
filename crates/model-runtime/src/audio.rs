//! 音频解码：把素材的一条音轨解成 16 kHz 单声道 f32，分块写进 staging 的 `audio.f32`，
//! 之后用 mmap 读（VAD 与识别只切片，不把整段读进内存）。
//!
//! 主路径是 ffmpeg 管道，解封装器只许白名单里的（与 Runtime 的素材分析 `media-analysis.ts` 一致），
//! 只许读本地文件。16 kHz 的 PCM WAV 另有纯 Rust 路径（hound），不需要 ffmpeg。
//!
//! 合成的参考音频很短，[`decode_mono`] 把它整个解进内存，采样率由调用方定。人声分离要立体声，
//! [`decode_stereo`] 同样整段解进内存。

use std::fs::File;
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use memmap2::Mmap;

use crate::SAMPLE_RATE;

/// 解码缓存的固定文件名（协议规范 §5）。
pub const AUDIO_FILE: &str = "audio.f32";
/// ffmpeg 允许的解封装器。名字按 ffmpeg 的写法：`mov,mp4,m4a,3gp,3g2,mj2` 是一个解封装器。
pub const DEMUXER_ALLOWLIST: &str = "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,aac,mp3,wav,flac,ogg";
/// 覆盖 ffmpeg 可执行文件的环境变量。
pub const FFMPEG_ENV: &str = "BAOCUT_FFMPEG";

const READ_BUFFER_BYTES: usize = 64 * 1024;
const WAV_CHUNK_FRAMES: usize = 16 * 1024;
const STDERR_LIMIT_BYTES: usize = 64 * 1024;
/// 两次进度回调之间至少前进的秒数。
const PROGRESS_STEP_SECONDS: f64 = 10.0;

#[derive(Debug, Clone, PartialEq)]
pub enum DecodeError {
    /// 素材没有所选的音轨。
    NoAudioTrack,
    /// 文件不存在、不可解封装或解封装器不在白名单（还没有解出任何样本）。
    InputUnreadable(String),
    /// 解码中途失败。
    DecodeFailed(String),
    Cancelled,
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoAudioTrack => f.write_str("素材没有所选的音轨"),
            Self::InputUnreadable(detail) => write!(f, "输入不可读：{detail}"),
            Self::DecodeFailed(detail) => write!(f, "解码失败：{detail}"),
            Self::Cancelled => f.write_str("解码已取消"),
        }
    }
}

impl std::error::Error for DecodeError {}

/// 解码哪一段。`duration` 为 `None` 时解到结尾。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DecodeRange {
    pub start: f64,
    pub duration: Option<f64>,
}

impl DecodeRange {
    pub const WHOLE: Self = Self {
        start: 0.0,
        duration: None,
    };
}

pub struct DecodeRequest<'a> {
    pub file: &'a Path,
    pub track: u32,
    pub range: DecodeRange,
}

/// 解码到 `output`，返回写出的样本数。`progress` 收到已解码的秒数。
pub fn decode_to_file(
    request: &DecodeRequest<'_>,
    output: &Path,
    should_cancel: &dyn Fn() -> bool,
    progress: &mut dyn FnMut(f64),
) -> Result<u64, DecodeError> {
    if !request.file.is_file() {
        return Err(DecodeError::InputUnreadable("文件不存在".into()));
    }
    let out = File::create(output).map_err(|e| DecodeError::DecodeFailed(format!("无法写解码缓存：{e}")))?;
    let mut sink = PcmSink::new(BufWriter::new(out), progress);
    let is_wav = request
        .file
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("wav"));
    let wav = if is_wav { hound::WavReader::open(request.file).ok() } else { None };
    match wav {
        Some(reader) if reader.spec().sample_rate == SAMPLE_RATE => decode_wav(reader, request, &mut sink, should_cancel)?,
        _ => decode_ffmpeg(request, &mut sink, should_cancel)?,
    }
    sink.finish()
}

/// 把 f32 样本写进文件，顺带汇报进度。
struct PcmSink<'a> {
    out: BufWriter<File>,
    samples: u64,
    reported: f64,
    progress: &'a mut dyn FnMut(f64),
}

impl<'a> PcmSink<'a> {
    fn new(out: BufWriter<File>, progress: &'a mut dyn FnMut(f64)) -> Self {
        Self {
            out,
            samples: 0,
            reported: 0.0,
            progress,
        }
    }

    fn write_bytes(&mut self, bytes: &[u8]) -> Result<(), DecodeError> {
        debug_assert!(bytes.len().is_multiple_of(4));
        self.out
            .write_all(bytes)
            .map_err(|e| DecodeError::DecodeFailed(format!("无法写解码缓存：{e}")))?;
        self.samples += (bytes.len() / 4) as u64;
        self.tick();
        Ok(())
    }

    fn write_samples(&mut self, samples: &[f32]) -> Result<(), DecodeError> {
        let mut bytes = Vec::with_capacity(samples.len() * 4);
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        self.write_bytes(&bytes)
    }

    fn tick(&mut self) {
        let seconds = self.samples as f64 / f64::from(SAMPLE_RATE);
        if seconds - self.reported >= PROGRESS_STEP_SECONDS {
            self.reported = seconds;
            (self.progress)(seconds);
        }
    }

    fn finish(mut self) -> Result<u64, DecodeError> {
        self.out
            .flush()
            .map_err(|e| DecodeError::DecodeFailed(format!("无法写解码缓存：{e}")))?;
        (self.progress)(self.samples as f64 / f64::from(SAMPLE_RATE));
        Ok(self.samples)
    }
}

fn decode_wav(
    mut reader: hound::WavReader<std::io::BufReader<File>>,
    request: &DecodeRequest<'_>,
    sink: &mut PcmSink<'_>,
    should_cancel: &dyn Fn() -> bool,
) -> Result<(), DecodeError> {
    if request.track != 0 {
        return Err(DecodeError::NoAudioTrack);
    }
    let spec = reader.spec();
    let channels = usize::from(spec.channels.max(1));
    let total_frames = u64::from(reader.duration());
    let first = ((request.range.start * f64::from(SAMPLE_RATE)).round().max(0.0) as u64).min(total_frames);
    let wanted = request
        .range
        .duration
        .map_or(u64::MAX, |duration| (duration * f64::from(SAMPLE_RATE)).round().max(0.0) as u64);
    let mut remaining = wanted.min(total_frames - first);
    reader
        .seek(first as u32)
        .map_err(|e| DecodeError::InputUnreadable(format!("WAV 无法定位：{e}")))?;
    let scale = match spec.sample_format {
        hound::SampleFormat::Float => 1.0,
        hound::SampleFormat::Int => 1.0 / (1_u64 << (spec.bits_per_sample.clamp(1, 32) - 1)) as f32,
    };
    let mut frame = Vec::with_capacity(channels);
    let mut chunk = Vec::with_capacity(WAV_CHUNK_FRAMES);
    let mut decoded_any = false;
    macro_rules! drain {
        ($samples:expr) => {{
            let mut samples = $samples;
            while remaining > 0 {
                frame.clear();
                for _ in 0..channels {
                    match samples.next() {
                        Some(Ok(sample)) => frame.push(sample as f32 * scale),
                        Some(Err(e)) => {
                            let detail = format!("WAV 读取失败：{e}");
                            return Err(if decoded_any {
                                DecodeError::DecodeFailed(detail)
                            } else {
                                DecodeError::InputUnreadable(detail)
                            });
                        }
                        None => break,
                    }
                }
                if frame.len() < channels {
                    break;
                }
                let mixed = frame.iter().sum::<f32>() / channels as f32;
                chunk.push(mixed);
                remaining -= 1;
                if chunk.len() == WAV_CHUNK_FRAMES {
                    if should_cancel() {
                        return Err(DecodeError::Cancelled);
                    }
                    sink.write_samples(&chunk)?;
                    chunk.clear();
                    decoded_any = true;
                }
            }
        }};
    }
    match spec.sample_format {
        hound::SampleFormat::Float => drain!(reader.samples::<f32>()),
        hound::SampleFormat::Int => drain!(reader.samples::<i32>()),
    }
    sink.write_samples(&chunk)
}

fn ffmpeg_executable() -> PathBuf {
    std::env::var_os(FFMPEG_ENV)
        .filter(|value| !value.is_empty())
        .map_or_else(|| PathBuf::from("ffmpeg"), PathBuf::from)
}

/// ffmpeg 的参数：只读本地文件、只许白名单的解封装器、不经 shell。
pub fn ffmpeg_args(request: &DecodeRequest<'_>) -> Vec<String> {
    ffmpeg_args_at(request, SAMPLE_RATE)
}

/// 同 [`ffmpeg_args`]，输出采样率可选。
fn ffmpeg_args_at(request: &DecodeRequest<'_>, sample_rate: u32) -> Vec<String> {
    ffmpeg_args_with(request, sample_rate, 1)
}

/// 同 [`ffmpeg_args`]，输出采样率与声道数可选（声道交错的 f32le）。
fn ffmpeg_args_with(request: &DecodeRequest<'_>, sample_rate: u32, channels: u16) -> Vec<String> {
    let mut args: Vec<String> = [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        DEMUXER_ALLOWLIST,
    ]
    .into_iter()
    .map(String::from)
    .collect();
    if request.range.start > 0.0 {
        args.extend(["-ss".into(), format!("{:.6}", request.range.start)]);
    }
    if let Some(duration) = request.range.duration {
        args.extend(["-t".into(), format!("{duration:.6}")]);
    }
    args.extend(["-i".into(), format!("file:{}", request.file.display())]);
    args.extend(["-map".into(), format!("0:a:{}", request.track)]);
    for arg in ["-vn", "-sn", "-dn", "-f", "f32le", "-ac"] {
        args.push(arg.into());
    }
    args.extend([channels.to_string(), "-ar".into(), sample_rate.to_string(), "-".into()]);
    args
}

/// 把一段短音频（合成的参考音频）整个解进内存：单声道 f32、`sample_rate`。
///
/// PCM / float WAV 走 hound（不需要 ffmpeg），采样率不同时用 [`crate::synthesize::resample`] 的带限插值换算；
/// 其他格式走与 [`decode_to_file`] 同一套受限的 ffmpeg 参数，只是输出采样率换成 `sample_rate`。
/// 只取第一条音轨、整段，不汇报进度。
pub fn decode_mono(path: &Path, sample_rate: u32) -> Result<Vec<f32>, DecodeError> {
    if !path.is_file() {
        return Err(DecodeError::InputUnreadable("文件不存在".into()));
    }
    let is_wav = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("wav"));
    let samples = match is_wav.then(|| hound::WavReader::open(path).ok()).flatten() {
        Some(reader) => {
            let native_rate = reader.spec().sample_rate;
            let samples = read_wav_mono(reader)?;
            crate::synthesize::resample::resample(&samples, native_rate, sample_rate)
        }
        None => decode_ffmpeg_to_memory(path, sample_rate)?,
    };
    if samples.is_empty() {
        return Err(DecodeError::InputUnreadable("没有解出任何样本".into()));
    }
    Ok(samples)
}

/// 整个读入 WAV 并混成单声道。
fn read_wav_mono(mut reader: hound::WavReader<std::io::BufReader<File>>) -> Result<Vec<f32>, DecodeError> {
    let spec = reader.spec();
    let channels = usize::from(spec.channels.max(1));
    let interleaved: Result<Vec<f32>, hound::Error> = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().collect(),
        hound::SampleFormat::Int => {
            let scale = 1.0 / (1_u64 << (spec.bits_per_sample.clamp(1, 32) - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|sample| sample.map(|value| value as f32 * scale))
                .collect()
        }
    };
    let interleaved = interleaved.map_err(|e| DecodeError::InputUnreadable(format!("WAV 读取失败：{e}")))?;
    Ok(interleaved
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect())
}

/// 立体声解码的结果：左右等长，采样率见 `sample_rate`。
#[derive(Debug, Clone, PartialEq)]
pub struct StereoPcm {
    pub left: Vec<f32>,
    pub right: Vec<f32>,
    pub sample_rate: u32,
}

/// 把一条音轨整段解进内存成立体声 f32（人声分离的输入）。
///
/// 单声道或立体声的 PCM / float WAV（轨 0）走 hound，保留原采样率；其他格式走与 [`decode_to_file`] 同一套受限的
/// ffmpeg 参数，输出两路、`fallback_rate`（单声道素材复制成两路，多声道由 ffmpeg 混成两路）。
pub fn decode_stereo(path: &Path, track: u32, fallback_rate: u32) -> Result<StereoPcm, DecodeError> {
    if !path.is_file() {
        return Err(DecodeError::InputUnreadable("文件不存在".into()));
    }
    let is_wav = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("wav"));
    let wav = (is_wav && track == 0)
        .then(|| hound::WavReader::open(path).ok())
        .flatten()
        .filter(|reader| matches!(reader.spec().channels, 1 | 2));
    let pcm = match wav {
        Some(reader) => read_wav_stereo(reader)?,
        None => {
            let request = DecodeRequest {
                file: path,
                track,
                range: DecodeRange::WHOLE,
            };
            let interleaved = run_ffmpeg_to_memory(&request, fallback_rate, 2)?;
            let (left, right) = interleaved.chunks_exact(2).map(|frame| (frame[0], frame[1])).unzip();
            StereoPcm {
                left,
                right,
                sample_rate: fallback_rate,
            }
        }
    };
    if pcm.left.is_empty() {
        return Err(DecodeError::InputUnreadable("没有解出任何样本".into()));
    }
    Ok(pcm)
}

/// 整个读入单声道或立体声 WAV；单声道复制成两路。
fn read_wav_stereo(mut reader: hound::WavReader<std::io::BufReader<File>>) -> Result<StereoPcm, DecodeError> {
    let spec = reader.spec();
    let interleaved: Result<Vec<f32>, hound::Error> = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().collect(),
        hound::SampleFormat::Int => {
            let scale = 1.0 / (1_u64 << (spec.bits_per_sample.clamp(1, 32) - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|sample| sample.map(|value| value as f32 * scale))
                .collect()
        }
    };
    let interleaved = interleaved.map_err(|e| DecodeError::InputUnreadable(format!("WAV 读取失败：{e}")))?;
    let (left, right) = if spec.channels == 1 {
        (interleaved.clone(), interleaved)
    } else {
        interleaved.chunks_exact(2).map(|frame| (frame[0], frame[1])).unzip()
    };
    Ok(StereoPcm {
        left,
        right,
        sample_rate: spec.sample_rate,
    })
}

/// 经 ffmpeg 解到内存（第一条音轨、整段）。
fn decode_ffmpeg_to_memory(path: &Path, sample_rate: u32) -> Result<Vec<f32>, DecodeError> {
    let request = DecodeRequest {
        file: path,
        track: 0,
        range: DecodeRange::WHOLE,
    };
    run_ffmpeg_to_memory(&request, sample_rate, 1)
}

/// 经 ffmpeg 把 `request` 整段解到内存：声道交错的 f32。
fn run_ffmpeg_to_memory(request: &DecodeRequest<'_>, sample_rate: u32, channels: u16) -> Result<Vec<f32>, DecodeError> {
    let output = Command::new(ffmpeg_executable())
        .args(ffmpeg_args_with(request, sample_rate, channels))
        .stdin(Stdio::null())
        .output()
        .map_err(|e| DecodeError::DecodeFailed(format!("无法启动 ffmpeg：{e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("matches no streams") {
            return Err(DecodeError::NoAudioTrack);
        }
        let tail: String = stderr.trim().lines().last().unwrap_or("").chars().take(400).collect();
        return Err(DecodeError::InputUnreadable(format!(
            "ffmpeg 退出码 {}：{tail}",
            output.status.code().unwrap_or(-1)
        )));
    }
    Ok(output
        .stdout
        .chunks_exact(4)
        .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
        .collect())
}

fn decode_ffmpeg(request: &DecodeRequest<'_>, sink: &mut PcmSink<'_>, should_cancel: &dyn Fn() -> bool) -> Result<(), DecodeError> {
    let mut child = Command::new(ffmpeg_executable())
        .args(ffmpeg_args(request))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| DecodeError::DecodeFailed(format!("无法启动 ffmpeg：{e}")))?;
    // stderr 在单独的线程里读（有上限），否则长的错误输出会把管道堵住。
    let mut stderr = child.stderr.take().expect("stderr piped");
    let stderr_reader = std::thread::spawn(move || {
        let mut collected = Vec::new();
        let mut buffer = [0_u8; 4096];
        while let Ok(n) = stderr.read(&mut buffer) {
            if n == 0 {
                break;
            }
            if collected.len() < STDERR_LIMIT_BYTES {
                collected.extend_from_slice(&buffer[..n.min(STDERR_LIMIT_BYTES - collected.len())]);
            }
        }
        String::from_utf8_lossy(&collected).into_owned()
    });
    let mut stdout = child.stdout.take().expect("stdout piped");
    let mut buffer = vec![0_u8; READ_BUFFER_BYTES];
    let mut pending = 0_usize;
    let mut outcome = Ok(());
    loop {
        if should_cancel() {
            outcome = Err(DecodeError::Cancelled);
            break;
        }
        match stdout.read(&mut buffer[pending..]) {
            Ok(0) => break,
            Ok(n) => {
                let available = pending + n;
                let whole = available / 4 * 4;
                if let Err(error) = sink.write_bytes(&buffer[..whole]) {
                    outcome = Err(error);
                    break;
                }
                buffer.copy_within(whole..available, 0);
                pending = available - whole;
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => {
                outcome = Err(DecodeError::DecodeFailed(format!("读取 ffmpeg 输出失败：{e}")));
                break;
            }
        }
    }
    if outcome.is_err() {
        let _ = child.kill();
    }
    drop(stdout);
    let status = child.wait();
    let stderr = stderr_reader.join().unwrap_or_default();
    outcome?;
    let status = status.map_err(|e| DecodeError::DecodeFailed(format!("等待 ffmpeg 失败：{e}")))?;
    if status.success() {
        return Ok(());
    }
    let tail: String = stderr.trim().lines().last().unwrap_or("").chars().take(400).collect();
    if !tail.is_empty() {
        eprintln!("model-worker: ffmpeg 失败（{status}）：{}", stderr.trim());
    }
    if stderr.contains("matches no streams") {
        Err(DecodeError::NoAudioTrack)
    } else if sink.samples == 0 {
        Err(DecodeError::InputUnreadable(format!(
            "ffmpeg 退出码 {}",
            status.code().unwrap_or(-1)
        )))
    } else {
        Err(DecodeError::DecodeFailed(format!("ffmpeg 退出码 {}", status.code().unwrap_or(-1))))
    }
}

/// `audio.f32` 的只读映射。
pub struct PcmFile {
    map: Option<Mmap>,
}

#[cfg(not(target_endian = "little"))]
compile_error!("audio.f32 是 little-endian f32，按原生字节序映射");

impl PcmFile {
    pub fn open(path: &Path) -> std::io::Result<Self> {
        let file = File::open(path)?;
        let length = file.metadata()?.len();
        if length == 0 {
            return Ok(Self { map: None });
        }
        if length % 4 != 0 {
            return Err(std::io::Error::other("解码缓存的长度不是 4 的倍数"));
        }
        // SAFETY: 文件在 staging 里，由本进程写完后只读映射；别的进程不应改动它。
        let map = unsafe { Mmap::map(&file)? };
        Ok(Self { map: Some(map) })
    }

    pub fn samples(&self) -> &[f32] {
        match &self.map {
            // SAFETY: mmap 按页对齐，满足 f32 的对齐；长度是 4 的倍数；任意位型都是合法的 f32。
            Some(map) => unsafe { std::slice::from_raw_parts(map.as_ptr().cast::<f32>(), map.len() / 4) },
            None => &[],
        }
    }

    pub fn duration_seconds(&self) -> f64 {
        self.samples().len() as f64 / f64::from(SAMPLE_RATE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_wav(path: &Path, rate: u32, channels: u16, frames: &[Vec<i16>]) {
        let spec = hound::WavSpec {
            channels,
            sample_rate: rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(path, spec).unwrap();
        for frame in frames {
            for sample in frame {
                writer.write_sample(*sample).unwrap();
            }
        }
        writer.finalize().unwrap();
    }

    fn decode(path: &Path, track: u32, range: DecodeRange) -> (Result<u64, DecodeError>, PathBuf, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join(AUDIO_FILE);
        let request = DecodeRequest { file: path, track, range };
        let result = decode_to_file(&request, &out, &|| false, &mut |_| {});
        (result, out, dir)
    }

    #[test]
    fn wav_decodes_to_mono_f32_without_ffmpeg() {
        let dir = tempfile::tempdir().unwrap();
        let wav = dir.path().join("stereo.wav");
        let frames: Vec<Vec<i16>> = (0..40_000).map(|i| vec![(i % 100) as i16 * 100, -16_384]).collect();
        write_wav(&wav, 16_000, 2, &frames);
        let (count, out, _keep) = decode(&wav, 0, DecodeRange::WHOLE);
        assert_eq!(count.unwrap(), 40_000);
        let pcm = PcmFile::open(&out).unwrap();
        let samples = pcm.samples();
        assert_eq!(samples.len(), 40_000);
        assert!((samples[0] - (-0.25)).abs() < 1e-6);
        assert!((samples[1] - ((100.0 / 32_768.0 - 0.5) / 2.0)).abs() < 1e-6);
        assert!((pcm.duration_seconds() - 2.5).abs() < 1e-9);
    }

    #[test]
    fn wav_range_and_missing_track() {
        let dir = tempfile::tempdir().unwrap();
        let wav = dir.path().join("mono.wav");
        let frames: Vec<Vec<i16>> = (0..32_000).map(|i| vec![(i / 16) as i16]).collect();
        write_wav(&wav, 16_000, 1, &frames);
        let (count, out, _keep) = decode(
            &wav,
            0,
            DecodeRange {
                start: 0.5,
                duration: Some(0.25),
            },
        );
        assert_eq!(count.unwrap(), 4_000);
        let pcm = PcmFile::open(&out).unwrap();
        assert!((pcm.samples()[0] - 500.0 / 32_768.0).abs() < 1e-7);
        // range 越过结尾：只解到结尾。
        let (count, _, _keep) = decode(
            &wav,
            0,
            DecodeRange {
                start: 1.5,
                duration: Some(10.0),
            },
        );
        assert_eq!(count.unwrap(), 8_000);
        let (missing, _, _keep) = decode(&wav, 1, DecodeRange::WHOLE);
        assert_eq!(missing.unwrap_err(), DecodeError::NoAudioTrack);
        let (unreadable, _, _keep) = decode(&dir.path().join("absent.wav"), 0, DecodeRange::WHOLE);
        assert!(matches!(unreadable.unwrap_err(), DecodeError::InputUnreadable(_)));
    }

    #[test]
    fn empty_pcm_maps_to_an_empty_slice() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(AUDIO_FILE);
        std::fs::write(&path, b"").unwrap();
        assert!(PcmFile::open(&path).unwrap().samples().is_empty());
    }

    #[test]
    fn decode_mono_reads_wav_at_any_rate_into_memory() {
        let dir = tempfile::tempdir().unwrap();
        let wav = dir.path().join("stereo-8k.wav");
        // 8 kHz 双声道、0.5 秒：左右声道取平均。
        let frames: Vec<Vec<i16>> = (0..4000).map(|i| vec![if i % 2 == 0 { 8192 } else { -8192 }, 0]).collect();
        write_wav(&wav, 8000, 2, &frames);
        let same = decode_mono(&wav, 8000).unwrap();
        assert_eq!(same.len(), 4000);
        assert!((same[0] - 0.125).abs() < 1e-6, "{}", same[0]);
        let up = decode_mono(&wav, 24_000).unwrap();
        assert!((up.len() as i64 - 12_000).abs() <= 1, "{}", up.len());

        assert_eq!(
            decode_mono(&dir.path().join("missing.wav"), 16_000).unwrap_err(),
            DecodeError::InputUnreadable("文件不存在".into())
        );
        let empty = dir.path().join("empty.wav");
        write_wav(&empty, 16_000, 1, &[]);
        assert!(matches!(decode_mono(&empty, 16_000), Err(DecodeError::InputUnreadable(_))));
    }

    #[test]
    fn ffmpeg_arguments_lock_down_input() {
        let file = Path::new("/media/a.mp4");
        let args = ffmpeg_args(&DecodeRequest {
            file,
            track: 2,
            range: DecodeRange {
                start: 1.5,
                duration: Some(2.0),
            },
        });
        let joined = args.join(" ");
        assert!(joined.contains("-protocol_whitelist file -format_whitelist mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,aac,mp3,wav,flac,ogg"));
        assert!(joined.contains("-ss 1.500000 -t 2.000000 -i file:/media/a.mp4 -map 0:a:2"));
        assert!(joined.ends_with("-f f32le -ac 1 -ar 16000 -"));
        assert!(args.iter().position(|a| a == "-nostdin") == Some(0));
        let at_48k = ffmpeg_args_at(
            &DecodeRequest {
                file,
                track: 0,
                range: DecodeRange::WHOLE,
            },
            48_000,
        )
        .join(" ");
        assert!(
            at_48k.ends_with("-i file:/media/a.mp4 -map 0:a:0 -vn -sn -dn -f f32le -ac 1 -ar 48000 -"),
            "{at_48k}"
        );
        let stereo = ffmpeg_args_with(
            &DecodeRequest {
                file,
                track: 1,
                range: DecodeRange::WHOLE,
            },
            44_100,
            2,
        )
        .join(" ");
        assert!(
            stereo.ends_with("-i file:/media/a.mp4 -map 0:a:1 -vn -sn -dn -f f32le -ac 2 -ar 44100 -"),
            "{stereo}"
        );
    }

    #[test]
    fn decode_stereo_keeps_wav_channels_and_rate() {
        let dir = tempfile::tempdir().unwrap();
        let stereo = dir.path().join("stereo.wav");
        let frames: Vec<Vec<i16>> = (0..480).map(|_| vec![8192, -16384]).collect();
        write_wav(&stereo, 48_000, 2, &frames);
        let pcm = decode_stereo(&stereo, 0, 44_100).unwrap();
        assert_eq!(pcm.sample_rate, 48_000);
        assert_eq!((pcm.left.len(), pcm.right.len()), (480, 480));
        assert!((pcm.left[0] - 0.25).abs() < 1e-6 && (pcm.right[0] + 0.5).abs() < 1e-6);

        // 单声道复制成两路。
        let mono = dir.path().join("mono.wav");
        write_wav(&mono, 16_000, 1, &[vec![4096], vec![-4096]]);
        let pcm = decode_stereo(&mono, 0, 44_100).unwrap();
        assert_eq!(pcm.left, pcm.right);
        assert_eq!(pcm.sample_rate, 16_000);

        assert_eq!(
            decode_stereo(&dir.path().join("missing.wav"), 0, 44_100).unwrap_err(),
            DecodeError::InputUnreadable("文件不存在".into())
        );
        let empty = dir.path().join("empty.wav");
        write_wav(&empty, 44_100, 2, &[]);
        assert!(matches!(decode_stereo(&empty, 0, 44_100), Err(DecodeError::InputUnreadable(_))));
    }
}
