//! 一路流的写入：每段一个文件，Media Foundation 的 Sink Writer（`MFCreateSinkWriterFromURL`）加一路流，视频从 NV12
//! 压成 H.264，音频从 16 位 PCM 压成 AAC。
//!
//! - 容器：`MF_TRANSCODE_CONTAINERTYPE = MFTranscodeContainerType_FMPEG4`，分片 MP4（Media Foundation 的 fMP4 媒体接收器，
//!   Windows 8 起）。进程崩溃时已经写下的片段读得出来；正常收尾后由 [`super::remux`] 不重新编码地转成普通 MP4（屏幕录制
//!   设计 §7），转不成就留下分片 MP4，它照样可读。
//! - 视频：`MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS` 让 Sink Writer 优先用硬件编码器（「Hardware MFTs」文档），没有时用
//!   微软的软件 H.264 编码器。High profile、8 位 4:2:0（输入 NV12）、宽高偶数（调用方保证）；编码参数经
//!   `SetInputMediaType` 的第三个参数传给编码器（「H.264 Video Encoder」文档的 Codec Properties）：关键帧间隔
//!   `CODECAPI_AVEncMPVGOPSize` 是两秒的帧数，`CODECAPI_AVEncMPVDefaultBPictureCount = 0` 不要 B 帧，
//!   `CODECAPI_AVLowLatencyMode` 开。硬件编码器不认某个参数时 Sink Writer 不报错，这几条要实机核实（§14）。
//! - 色彩：输入标 BT.709、16–235（[`crate::platform::windows_portable::convert::bgra_to_nv12`] 按这个换算）。
//! - 文件在这一段的第一个样本到时才开，日志写 `stream` 行，文件里的时刻从 0 起（第一个样本）。
//! - 段结束时 `Finalize`，转成普通 MP4，再写 `stream-end` 行。
//! - 屏幕的画面静止时 Windows.Graphics.Capture 不送新帧：新的一段开始时把上一帧补到这一段开始的时刻，段结束时把最后
//!   一帧在结尾前一帧的位置再写一次，文件的长度才是这一段的长度（与 macOS 一致）。
//! - 声音按 [`AudioTimeline`] 放：包的时刻比推算的晚就补静音，早就裁掉重叠的部分；回环在没有声音时不送包，由采集线程
//!   调 [`Track::fill_audio`] 补静音到当前时刻。
//!
//! Sink Writer 不设 `MF_SINK_WRITER_DISABLE_THROTTLING`：编码跟不上时 `WriteSample` 会阻塞采集线程。屏幕那一路由
//! Windows.Graphics.Capture 的帧池吸收（池满了丢最旧的帧），声音的缓冲有一秒。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use windows::Win32::Media::MediaFoundation::{
    CODECAPI_AVEncMPVDefaultBPictureCount, CODECAPI_AVEncMPVGOPSize, CODECAPI_AVLowLatencyMode, IMFAttributes, IMFMediaType,
    IMFSinkWriter, MF_LOW_LATENCY, MF_MT_AAC_PAYLOAD_TYPE, MF_MT_ALL_SAMPLES_INDEPENDENT, MF_MT_AUDIO_AVG_BYTES_PER_SECOND,
    MF_MT_AUDIO_BITS_PER_SAMPLE, MF_MT_AUDIO_BLOCK_ALIGNMENT, MF_MT_AUDIO_NUM_CHANNELS, MF_MT_AUDIO_SAMPLES_PER_SECOND,
    MF_MT_AVG_BITRATE, MF_MT_DEFAULT_STRIDE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE,
    MF_MT_MPEG2_PROFILE, MF_MT_PIXEL_ASPECT_RATIO, MF_MT_SUBTYPE, MF_MT_VIDEO_NOMINAL_RANGE, MF_MT_VIDEO_PRIMARIES,
    MF_MT_YUV_MATRIX, MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, MF_TRANSCODE_CONTAINERTYPE, MFAudioFormat_AAC, MFAudioFormat_PCM,
    MFCreateAttributes, MFCreateMediaType, MFCreateMemoryBuffer, MFCreateSample, MFCreateSinkWriterFromURL, MFMediaType_Audio,
    MFMediaType_Video, MFNominalRange_16_235, MFTranscodeContainerType_FMPEG4, MFVideoFormat_H264, MFVideoFormat_NV12,
    MFVideoInterlace_Progressive, MFVideoPrimaries_BT709, MFVideoTransferMatrix_BT709, eAVEncH264VProfile_High,
};
use windows_core::HSTRING;

use crate::platform::windows_portable::timing::{AudioTimeline, file_time, frames_to_ns, ns_to_frames, ns_to_hns};
use crate::protocol::{DeviceRef, JournalLine, Ns, Role, WorkerEvent};
use crate::sink::Sink;

use super::com::Mta;
use super::remux;

/// AAC 的码率：192 kbps（微软 AAC 编码器接受 96/128/160/192 kbps，`MF_MT_AUDIO_AVG_BYTES_PER_SECOND` 文档）。
const AAC_BYTES_PER_SECOND: u32 = 24_000;
/// 写进文件的声音：立体声 16 位。
pub const AUDIO_CHANNELS: u32 = 2;

/// 一帧 NV12 画面（宽高偶数）。
#[derive(Clone)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub data: Arc<Vec<u8>>,
}

struct OpenFile {
    writer: Mta<IMFSinkWriter>,
    stream: u32,
    path: PathBuf,
    /// 第一个样本的时刻（QPC 纳秒）：文件里的 0。
    first: u64,
    /// 最后写下的视频样本的时刻；0 是还没有写过。
    last: u64,
    /// 视频：文件的宽高（与第一帧相同，之后的帧要同样大）。
    size: (u32, u32),
    /// 声音：采样率与时间线。
    rate: u32,
    timeline: AudioTimeline,
}

struct State {
    segment: Option<(String, Ns)>,
    open: Option<OpenFile>,
    lost_at: Option<Ns>,
    broken: bool,
    /// 屏幕：最后一帧完整的画面。
    last_frame: Option<Frame>,
}

pub struct Track {
    role: Role,
    dir: PathBuf,
    sink: Arc<Sink>,
    device: Option<DeviceRef>,
    /// 视频的帧率（屏幕是请求的帧率，摄像头是设备的帧率，打开文件前由 [`Track::set_fps`] 设）。
    fps: Mutex<u32>,
    state: Mutex<State>,
}

impl Track {
    pub fn new(role: Role, dir: PathBuf, sink: Arc<Sink>, device: Option<DeviceRef>, fps: Option<u32>) -> Arc<Self> {
        Arc::new(Self {
            role,
            dir,
            sink,
            device,
            fps: Mutex::new(fps.unwrap_or(30).max(1)),
            state: Mutex::new(State { segment: None, open: None, lost_at: None, broken: false, last_frame: None }),
        })
    }

    pub fn set_fps(&self, fps: u32) {
        if let Ok(mut value) = self.fps.lock() {
            *value = fps.max(1);
        }
    }

    fn fps(&self) -> u32 {
        self.fps.lock().map(|fps| *fps).unwrap_or(30)
    }

    /// 采集线程上的一帧画面。拿不到锁（主线程正在开关段）就丢掉这一帧，不等。
    pub fn push_video(&self, at: Ns, frame: Frame) {
        let Ok(mut state) = self.state.try_lock() else { return };
        self.video_locked(&mut state, at, &frame);
        if self.role == Role::Screen {
            state.last_frame = Some(frame);
        }
    }

    fn video_locked(&self, state: &mut State, at: Ns, frame: &Frame) {
        if state.lost_at.is_some() || state.broken {
            return;
        }
        let Some((segment, start)) = state.segment.clone() else { return };
        if at < start {
            return;
        }
        if state.open.is_none() && !self.open(state, &segment, at, (frame.width, frame.height), 0) {
            return;
        }
        let Some(open) = state.open.as_mut() else { return };
        if (frame.width, frame.height) != open.size {
            // 屏幕那一路的帧总是同样大（[`super::screen`]）；摄像头的格式在会话里不变。尺寸不对就丢掉，不让编码器出错。
            return;
        }
        if at.0 <= open.last {
            return;
        }
        let duration = 10_000_000 / i64::from(self.fps());
        let result = write_sample(&open.writer.0, open.stream, &frame.data, file_time(at.0, open.first), duration);
        match result {
            Ok(()) => open.last = at.0,
            Err(error) => {
                state.broken = true;
                self.fail(format!("cannot write a video sample: {}", error.message()));
            }
        }
    }

    /// 采集线程上的一个声音包：交错的立体声 16 位样本，第一帧在 `at`。
    pub fn push_audio(&self, at: Ns, rate: u32, samples: &[i16]) {
        let Ok(mut state) = self.state.try_lock() else { return };
        if state.lost_at.is_some() || state.broken {
            return;
        }
        let Some((segment, start)) = state.segment.clone() else { return };
        let channels = AUDIO_CHANNELS as usize;
        let mut samples = samples;
        let mut at = at;
        if at < start {
            // 跨过段开始的包：去掉开始之前的部分。
            let skip = (ns_to_frames(start.0 - at.0, rate) as usize * channels).min(samples.len());
            samples = &samples[skip..];
            at = start;
        }
        if samples.is_empty() {
            return;
        }
        if state.open.is_none() && !self.open(&mut state, &segment, at, (0, 0), rate) {
            return;
        }
        let Some(open) = state.open.as_mut() else { return };
        if open.rate != rate {
            return;
        }
        let frames = (samples.len() / channels) as u64;
        let before = open.timeline.written();
        let placement = open.timeline.place(at.0, frames);
        let skip = (placement.skip as usize * channels).min(samples.len());
        let mut pcm: Vec<u8> = Vec::with_capacity((placement.pad as usize * channels + samples.len() - skip) * 2);
        pcm.resize(placement.pad as usize * channels * 2, 0);
        for sample in &samples[skip..] {
            pcm.extend_from_slice(&sample.to_le_bytes());
        }
        if pcm.is_empty() {
            return;
        }
        let written = (pcm.len() / (channels * 2)) as u64;
        let time = ns_to_hns(frames_to_ns(before, rate));
        let duration = ns_to_hns(frames_to_ns(written, rate));
        if let Err(error) = write_sample(&open.writer.0, open.stream, &pcm, time, duration) {
            state.broken = true;
            self.fail(format!("cannot write an audio sample: {}", error.message()));
        }
    }

    /// 回环在静音时不送包：补静音到 `until`。文件还没开（这一段还没有过声音）时什么都不做。
    pub fn fill_audio(&self, until: Ns) {
        let Ok(mut state) = self.state.try_lock() else { return };
        if state.lost_at.is_some() || state.broken {
            return;
        }
        let Some(open) = state.open.as_mut() else { return };
        let before = open.timeline.written();
        let pad = open.timeline.fill_until(until.0);
        if pad == 0 {
            return;
        }
        let pcm = vec![0u8; pad as usize * AUDIO_CHANNELS as usize * 2];
        let time = ns_to_hns(frames_to_ns(before, open.rate));
        let duration = ns_to_hns(frames_to_ns(pad, open.rate));
        if let Err(error) = write_sample(&open.writer.0, open.stream, &pcm, time, duration) {
            state.broken = true;
            self.fail(format!("cannot write silence: {}", error.message()));
        }
    }

    fn open(&self, state: &mut State, segment: &str, at: Ns, size: (u32, u32), rate: u32) -> bool {
        let file = self.role.file_name(segment);
        let path = self.dir.join(&file);
        let _ = std::fs::remove_file(&path);
        let created = if self.role.is_video() {
            open_video(&path, size.0, size.1, self.fps())
        } else {
            open_audio(&path, rate)
        };
        match created {
            Ok((writer, stream)) => {
                state.open = Some(OpenFile {
                    writer: Mta(writer),
                    stream,
                    path,
                    first: at.0,
                    // 还没有写过样本（QPC 的时刻总大于 0）。
                    last: 0,
                    size,
                    rate,
                    timeline: AudioTimeline::new(rate.max(1)),
                });
                let line = JournalLine::Stream { role: self.role, segment_id: segment.to_owned(), file, start_ns: at, device: self.device.clone() };
                if let Err(error) = self.sink.journal(&line, true) {
                    eprintln!("cannot journal the {} stream: {error}", self.role.as_str());
                }
                self.sink.emit(&WorkerEvent::Stream { role: self.role, segment_id: segment.to_owned(), start_ns: at });
                true
            }
            Err(error) => {
                state.broken = true;
                self.fail(format!("cannot create the writer: {} (HRESULT {:#010x})", error.message(), error.code().0 as u32));
                false
            }
        }
    }

    /// 开始一段。屏幕有上一帧完整的画面时，把它补到这一段开始的时刻。
    pub fn begin(&self, segment: &str, start: Ns) {
        let Ok(mut state) = self.state.lock() else { return };
        state.segment = Some((segment.to_owned(), start));
        state.broken = false;
        if self.role != Role::Screen || state.lost_at.is_some() {
            return;
        }
        if let Some(frame) = state.last_frame.clone() {
            self.video_locked(&mut state, start, &frame);
        }
    }

    /// 结束当前段：文件写完、转成普通 MP4 之后写 `stream-end` 行。这一段没有样本时什么都不写。
    pub fn end(&self, end: Ns) {
        let Ok(mut state) = self.state.lock() else { return };
        let segment = state.segment.take();
        let Some(mut open) = state.open.take() else { return };
        let Some((segment, _)) = segment else { return };
        let stop = state.lost_at.map_or(end, |lost| lost.min(end));
        if self.role == Role::Screen
            && !state.broken
            && let Some(frame) = state.last_frame.clone()
        {
            let duration_ns = 1_000_000_000 / u64::from(self.fps());
            let at = stop.0.saturating_sub(duration_ns);
            if at > open.last && (frame.width, frame.height) == open.size {
                let duration = ns_to_hns(duration_ns);
                if write_sample(&open.writer.0, open.stream, &frame.data, file_time(at, open.first), duration).is_ok() {
                    open.last = at;
                }
            }
        }
        if !self.role.is_video() && !state.broken {
            // 声音写到段的结尾：回环在最后一段时间里可能没有包。
            let before = open.timeline.written();
            let pad = open.timeline.fill_until(stop.0);
            if pad > 0 {
                let pcm = vec![0u8; pad as usize * AUDIO_CHANNELS as usize * 2];
                let time = ns_to_hns(frames_to_ns(before, open.rate));
                let _ = write_sample(&open.writer.0, open.stream, &pcm, time, ns_to_hns(frames_to_ns(pad, open.rate)));
            }
        }
        drop(state);
        match unsafe { open.writer.0.Finalize() } {
            Ok(()) => {
                drop(open.writer);
                if let Err(message) = remux::to_plain_mp4(&open.path) {
                    // 分片 MP4 照样可读（Runtime 用 ffprobe 读时长）：留下它，只记一行。
                    eprintln!("kept the fragmented {} file: {message}", self.role.as_str());
                }
            }
            Err(error) => self.fail(format!("cannot finish the file: {}", error.message())),
        }
        let lost = self.state.lock().ok().and_then(|state| state.lost_at).is_some_and(|lost| lost <= end);
        let line = JournalLine::StreamEnd { role: self.role, segment_id: segment, end_ns: stop, lost: lost.then_some(true) };
        if let Err(error) = self.sink.journal(&line, true) {
            eprintln!("cannot journal the end of the {} stream: {error}", self.role.as_str());
        }
    }

    pub fn fail(&self, message: String) {
        let message = format!("{} stream: {message}", self.role.as_str());
        self.sink.emit(&WorkerEvent::Failed { code: "WRITER_FAILED".to_owned(), message });
    }

    /// 设备断开：记下时刻，推送 `device-lost`。只报一次。
    pub fn lose(&self, at: Ns) {
        let Ok(mut state) = self.state.lock() else { return };
        if state.lost_at.is_some() {
            return;
        }
        state.lost_at = Some(at);
        if let Some((segment, _)) = state.segment.clone() {
            self.sink.emit(&WorkerEvent::DeviceLost { role: self.role, segment_id: segment, at_ns: at });
        }
    }
}

fn attributes(count: u32) -> windows_core::Result<IMFAttributes> {
    let mut attributes: Option<IMFAttributes> = None;
    unsafe { MFCreateAttributes(&mut attributes, count) }?;
    attributes.ok_or_else(|| windows_core::Error::from(windows::Win32::Foundation::E_POINTER))
}

fn sink_writer(path: &std::path::Path) -> windows_core::Result<IMFSinkWriter> {
    let attributes = attributes(3)?;
    unsafe {
        attributes.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1)?;
        attributes.SetGUID(&MF_TRANSCODE_CONTAINERTYPE, &MFTranscodeContainerType_FMPEG4)?;
        attributes.SetUINT32(&MF_LOW_LATENCY, 1)?;
        MFCreateSinkWriterFromURL(&HSTRING::from(path.as_os_str()), None, &attributes)
    }
}

fn pack(high: u32, low: u32) -> u64 {
    (u64::from(high) << 32) | u64::from(low)
}

/// 视频的编码目标码率：每像素每帧 0.1 位，至少 1 Mbps（屏幕内容在 1080p 30 帧时约 6 Mbps）。
fn video_bitrate(width: u32, height: u32, fps: u32) -> u32 {
    let bits = u64::from(width) * u64::from(height) * u64::from(fps) / 10;
    bits.clamp(1_000_000, 50_000_000) as u32
}

fn open_video(path: &std::path::Path, width: u32, height: u32, fps: u32) -> windows_core::Result<(IMFSinkWriter, u32)> {
    let writer = sink_writer(path)?;
    unsafe {
        let output: IMFMediaType = MFCreateMediaType()?;
        output.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        output.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
        output.SetUINT32(&MF_MT_AVG_BITRATE, video_bitrate(width, height, fps))?;
        output.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        output.SetUINT64(&MF_MT_FRAME_SIZE, pack(width, height))?;
        output.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1))?;
        output.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1))?;
        output.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High.0 as u32)?;
        let stream = writer.AddStream(&output)?;
        let input: IMFMediaType = MFCreateMediaType()?;
        input.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        input.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)?;
        input.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        input.SetUINT64(&MF_MT_FRAME_SIZE, pack(width, height))?;
        input.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1))?;
        input.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1))?;
        input.SetUINT32(&MF_MT_DEFAULT_STRIDE, width)?;
        input.SetUINT32(&MF_MT_ALL_SAMPLES_INDEPENDENT, 1)?;
        input.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709.0 as u32)?;
        input.SetUINT32(&MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709.0 as u32)?;
        input.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235.0 as u32)?;
        let encoding = attributes(3)?;
        encoding.SetUINT32(&CODECAPI_AVEncMPVGOPSize, fps.saturating_mul(2).max(1))?;
        encoding.SetUINT32(&CODECAPI_AVEncMPVDefaultBPictureCount, 0)?;
        encoding.SetUINT32(&CODECAPI_AVLowLatencyMode, 1)?;
        writer.SetInputMediaType(stream, &input, &encoding)?;
        writer.BeginWriting()?;
        Ok((writer, stream))
    }
}

fn open_audio(path: &std::path::Path, rate: u32) -> windows_core::Result<(IMFSinkWriter, u32)> {
    let writer = sink_writer(path)?;
    unsafe {
        let output: IMFMediaType = MFCreateMediaType()?;
        output.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
        output.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_AAC)?;
        output.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
        output.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, rate)?;
        output.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, AUDIO_CHANNELS)?;
        output.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, AAC_BYTES_PER_SECOND)?;
        output.SetUINT32(&MF_MT_AAC_PAYLOAD_TYPE, 0)?;
        let stream = writer.AddStream(&output)?;
        let input: IMFMediaType = MFCreateMediaType()?;
        input.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
        input.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_PCM)?;
        input.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
        input.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, rate)?;
        input.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, AUDIO_CHANNELS)?;
        input.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, AUDIO_CHANNELS * 2)?;
        input.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, rate * AUDIO_CHANNELS * 2)?;
        writer.SetInputMediaType(stream, &input, None)?;
        writer.BeginWriting()?;
        Ok((writer, stream))
    }
}

/// 一段内存做成一个样本写进去。时刻与时长是 100 纳秒单位。
fn write_sample(writer: &IMFSinkWriter, stream: u32, data: &[u8], time: i64, duration: i64) -> windows_core::Result<()> {
    unsafe {
        let buffer = MFCreateMemoryBuffer(data.len() as u32)?;
        let mut pointer: *mut u8 = std::ptr::null_mut();
        buffer.Lock(&mut pointer, None, None)?;
        std::ptr::copy_nonoverlapping(data.as_ptr(), pointer, data.len());
        buffer.Unlock()?;
        buffer.SetCurrentLength(data.len() as u32)?;
        let sample = MFCreateSample()?;
        sample.AddBuffer(&buffer)?;
        sample.SetSampleTime(time)?;
        sample.SetSampleDuration(duration)?;
        writer.WriteSample(stream, &sample)
    }
}
