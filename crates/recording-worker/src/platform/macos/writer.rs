//! 一路流的写入：每段一个文件，`AVAssetWriter` 加一个带输出设置的输入，视频压成 H.264（VideoToolbox，硬件优先），
//! 音频压成 AAC。输入声明实时源（`expectsMediaDataInRealTime`），跟不上时 `isReadyForMoreMediaData` 是假，这一帧丢掉，
//! 不在采集线程上等（AVAssetWriterInput 文档对实时源的要求）。
//!
//! - 文件在这一段的第一个样本到时才开：格式取自样本的格式描述（`sourceFormatHint`），会话从这个样本的时刻开始
//!   （`startSessionAtSourceTime`），日志写 `stream` 行。设备晚启动就是晚开，不补帧。
//! - `movieFragmentInterval` 设一秒：进程崩溃时文件里已经写下的片段仍然读得出来（AVAssetWriter 文档）。视频不重排帧
//!   （`AVVideoAllowFrameReorderingKey` 为假）：实测带 B 帧又分片写时，写到第一片常常失败（OSStatus -16341）。
//! - 段结束时 `endSessionAtSourceTime` 定在段的结尾，`finishWriting` 等完成，再写 `stream-end` 行。
//! - 屏幕的画面静止时 ScreenCaptureKit 不送新帧。新的一段开始时把上一帧完整的画面改成这一段开始的时刻补进去，
//!   静止的画面在新段里也有内容。
//!
//! 样本的时刻在采集的同步时钟上（ScreenCaptureKit 与 AVCaptureSession 各自的 `synchronizationClock`）；日志里的
//! 时刻都换到主机时钟上（[`clock`]），文件里保留原来的时刻。

use std::path::PathBuf;
use std::ptr::{self, NonNull};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use block2::RcBlock;
use objc2::AnyThread;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_av_foundation::{
    AVAssetWriter, AVAssetWriterInput, AVAssetWriterStatus, AVFileTypeAppleM4A, AVFileTypeMPEG4, AVMediaTypeAudio, AVMediaTypeVideo,
    AVVideoAllowFrameReorderingKey, AVVideoCodecKey, AVVideoCodecTypeH264, AVVideoCompressionPropertiesKey, AVVideoHeightKey,
    AVVideoMaxKeyFrameIntervalDurationKey, AVVideoWidthKey,
};
use objc2_avf_audio::{AVFormatIDKey, AVNumberOfChannelsKey, AVSampleRateKey};
use objc2_core_foundation::CFRetained;
use objc2_core_media::{
    CMAudioFormatDescriptionGetStreamBasicDescription, CMClock, CMSampleBuffer, CMSampleTimingInfo, CMTime,
    CMVideoFormatDescriptionGetDimensions, kCMTimeInvalid,
};
use objc2_foundation::{NSDictionary, NSError, NSNumber, NSString, NSURL};

use crate::protocol::{DeviceRef, JournalLine, Ns, Role, WorkerEvent};
use crate::sink::Sink;

use super::clock;

/// `kAudioFormatMPEG4AAC`（CoreAudioTypes）。
const AUDIO_FORMAT_AAC: u32 = u32::from_be_bytes(*b"aac ");
const FINISH_TIMEOUT: Duration = Duration::from_secs(20);

struct OpenFile {
    writer: Retained<AVAssetWriter>,
    input: Retained<AVAssetWriterInput>,
    /// 最后追加的样本的时刻（采集时钟），段的结尾不早于它。
    last: CMTime,
}

struct State {
    /// 开着的段与它开始的时刻（主机时钟）。
    segment: Option<(String, Ns)>,
    open: Option<OpenFile>,
    /// 设备断开的时刻：此后这一路没有内容，直到录制结束。
    lost_at: Option<Ns>,
    /// 写入出错过：这一段不再写，推送过一次 `failed`。
    broken: bool,
    /// 屏幕：最后一帧完整的画面。
    last_frame: Option<CFRetained<CMSampleBuffer>>,
    /// 样本的时钟；None 是主机时钟。
    clock: Option<CFRetained<CMClock>>,
}

// SAFETY: AVAssetWriter 与 AVAssetWriterInput 允许在任意线程上调用，只要调用是串行的；这里所有访问都在
// `Track` 的互斥锁里。CoreMedia 的对象（样本、时钟）本身是线程安全的。
unsafe impl Send for State {}

pub struct Track {
    role: Role,
    dir: PathBuf,
    sink: Arc<Sink>,
    device: Option<DeviceRef>,
    state: Mutex<State>,
}

impl Track {
    pub fn new(role: Role, dir: PathBuf, sink: Arc<Sink>, device: Option<DeviceRef>) -> Arc<Self> {
        Arc::new(Self {
            role,
            dir,
            sink,
            device,
            state: Mutex::new(State { segment: None, open: None, lost_at: None, broken: false, last_frame: None, clock: None }),
        })
    }

    /// 采集的同步时钟（会话开起来之后才知道）。
    pub fn set_clock(&self, clock: Option<CFRetained<CMClock>>) {
        if let Ok(mut state) = self.state.lock() {
            state.clock = clock;
        }
    }

    pub fn is_lost(&self) -> bool {
        self.state.lock().map(|state| state.lost_at.is_some()).unwrap_or(false)
    }

    /// 采集线程上的一个样本。拿不到锁（主线程正在开关段）就丢掉这个样本，不等。
    pub fn append(&self, sample: &CMSampleBuffer) {
        let Ok(mut state) = self.state.try_lock() else { return };
        objc2::rc::autoreleasepool(|_| self.append_locked(&mut state, sample));
        if self.role == Role::Screen {
            state.last_frame = Some(unsafe { CFRetained::retain(NonNull::from(sample)) });
        }
    }

    fn append_locked(&self, state: &mut State, sample: &CMSampleBuffer) {
        if state.lost_at.is_some() || state.broken {
            return;
        }
        let Some((segment, start)) = state.segment.clone() else { return };
        let native = unsafe { sample.presentation_time_stamp() };
        let Some(host) = clock::to_ns(self.to_host(state, native)) else { return };
        if host < start {
            return;
        }
        if state.open.is_none() {
            match self.open_file(&segment, sample, native) {
                Ok(open) => {
                    state.open = Some(open);
                    let file = self.role.file_name(&segment);
                    let line =
                        JournalLine::Stream { role: self.role, segment_id: segment.clone(), file, start_ns: host, device: self.device.clone() };
                    if let Err(error) = self.sink.journal(&line, true) {
                        eprintln!("cannot journal the {} stream: {error}", self.role.as_str());
                    }
                    self.sink.emit(&WorkerEvent::Stream { role: self.role, segment_id: segment.clone(), start_ns: host });
                }
                Err(message) => {
                    state.broken = true;
                    self.fail(message);
                    return;
                }
            }
        }
        let Some(open) = state.open.as_mut() else { return };
        if !unsafe { open.input.isReadyForMoreMediaData() } {
            return;
        }
        if unsafe { open.input.appendSampleBuffer(sample) } {
            open.last = native;
        } else if unsafe { open.writer.status() } == AVAssetWriterStatus::Failed {
            state.broken = true;
            let message = writer_error(&open.writer);
            self.fail(message);
        }
    }

    fn to_host(&self, state: &State, time: CMTime) -> CMTime {
        match state.clock.as_deref() {
            Some(from) => clock::to_host(time, from),
            None => time,
        }
    }

    fn from_host(&self, state: &State, at: Ns) -> CMTime {
        match state.clock.as_deref() {
            Some(to) => clock::from_host(clock::from_ns(at), to),
            None => clock::from_ns(at),
        }
    }

    fn open_file(&self, segment: &str, sample: &CMSampleBuffer, native: CMTime) -> Result<OpenFile, String> {
        let video = self.role.is_video();
        let path = self.dir.join(self.role.file_name(segment));
        // AVAssetWriter 不写已经存在的路径。
        let _ = std::fs::remove_file(&path);
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let file_type = if video { unsafe { AVFileTypeMPEG4 } } else { unsafe { AVFileTypeAppleM4A } }.ok_or("no file type")?;
        let writer = unsafe { AVAssetWriter::assetWriterWithURL_fileType_error(&url, file_type) }
            .map_err(|error| format!("cannot create the {} writer: {}", self.role.as_str(), error.localizedDescription()))?;
        unsafe { writer.setMovieFragmentInterval(CMTime::new(1, 1)) };
        let format = unsafe { sample.format_description() };
        let settings = unsafe { output_settings(video, format.as_deref()) }.ok_or("cannot build the output settings")?;
        let media = if video { unsafe { AVMediaTypeVideo } } else { unsafe { AVMediaTypeAudio } }.ok_or("no media type")?;
        let input = unsafe {
            AVAssetWriterInput::initWithMediaType_outputSettings_sourceFormatHint(
                AVAssetWriterInput::alloc(),
                media,
                Some(&settings),
                format.as_deref(),
            )
        };
        unsafe { input.setExpectsMediaDataInRealTime(true) };
        if !unsafe { writer.canAddInput(&input) } {
            return Err(format!("the {} writer does not accept its input", self.role.as_str()));
        }
        unsafe { writer.addInput(&input) };
        if !unsafe { writer.startWriting() } {
            return Err(writer_error(&writer));
        }
        unsafe { writer.startSessionAtSourceTime(native) };
        Ok(OpenFile { writer, input, last: native })
    }

    /// 开始一段。屏幕有上一帧完整的画面时，把它改到这一段开始的时刻先写进去。
    pub fn begin(&self, segment: &str, start: Ns) {
        let Ok(mut state) = self.state.lock() else { return };
        state.segment = Some((segment.to_owned(), start));
        state.broken = false;
        if self.role != Role::Screen || state.lost_at.is_some() {
            return;
        }
        let Some(frame) = state.last_frame.clone() else { return };
        let at = self.from_host(&state, start);
        if let Some(retimed) = retime(&frame, at) {
            objc2::rc::autoreleasepool(|_| self.append_locked(&mut state, &retimed));
        }
    }

    /// 结束当前段：文件写完、可读之后写 `stream-end` 行。这一段没有样本时什么都不写。
    pub fn end(&self, end: Ns) {
        let Ok(mut state) = self.state.lock() else { return };
        let segment = state.segment.take();
        let Some(open) = state.open.take() else { return };
        let Some((segment, _)) = segment else { return };
        let stop = state.lost_at.map_or(end, |lost| lost.min(end));
        let mut at = self.from_host(&state, stop);
        if unsafe { CMTime::compare(at, open.last) } < 0 {
            at = open.last;
        }
        if self.role == Role::Screen
            && unsafe { CMTime::compare(at, open.last) } > 0
            && let Some(frame) = state.last_frame.clone()
            && let Some(retimed) = retime(&frame, at)
            && unsafe { open.input.isReadyForMoreMediaData() }
        {
            // 画面静止时 ScreenCaptureKit 不送新帧，AVAssetWriter 也不把最后一帧拉长到会话结尾：把最后的画面在段的
            // 结尾再写一次，文件的长度才是这一段的长度。
            unsafe { open.input.appendSampleBuffer(&retimed) };
        }
        drop(state);
        let finished = objc2::rc::autoreleasepool(|_| finish(&open, at));
        if let Err(message) = &finished {
            self.fail(message.clone());
        }
        let lost = self.state.lock().ok().and_then(|state| state.lost_at).is_some_and(|lost| lost <= end);
        let line = JournalLine::StreamEnd { role: self.role, segment_id: segment, end_ns: stop, lost: lost.then_some(true) };
        if let Err(error) = self.sink.journal(&line, true) {
            eprintln!("cannot journal the end of the {} stream: {error}", self.role.as_str());
        }
    }

    fn fail(&self, message: String) {
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

fn finish(open: &OpenFile, at: CMTime) -> Result<(), String> {
    unsafe {
        open.writer.endSessionAtSourceTime(at);
        open.input.markAsFinished();
    }
    let (tx, rx) = mpsc::sync_channel::<()>(1);
    let done = RcBlock::new(move || {
        let _ = tx.try_send(());
    });
    unsafe { open.writer.finishWritingWithCompletionHandler(&done) };
    if rx.recv_timeout(FINISH_TIMEOUT).is_err() {
        return Err("the writer did not finish in time".to_owned());
    }
    if unsafe { open.writer.status() } != AVAssetWriterStatus::Completed {
        return Err(writer_error(&open.writer));
    }
    Ok(())
}

fn writer_error(writer: &AVAssetWriter) -> String {
    match unsafe { writer.error() } {
        // 本地化描述常常只有「操作无法完成」；带上域、错误码与底层错误，才查得到原因。
        Some(error) => format!("AVAssetWriter failed: {}", describe(&error)),
        None => "AVAssetWriter failed".to_owned(),
    }
}

/// 描述、域与错误码，再接上底层错误（`NSUnderlyingErrorKey`）。
fn describe(error: &NSError) -> String {
    let mut text = format!("{} ({} {})", error.localizedDescription(), error.domain(), error.code());
    let key = NSString::from_str("NSUnderlyingError");
    if let Some(inner) = error.userInfo().objectForKey(&key).and_then(|inner| inner.downcast::<NSError>().ok()) {
        text.push_str("; ");
        text.push_str(&describe(&inner));
    }
    text
}

/// 输出设置。视频：H.264，尺寸取自样本；音频：AAC，采样率取自样本，声道数取样本的（多于两路时压成立体声）。
unsafe fn output_settings(
    video: bool,
    format: Option<&objc2_core_media::CMFormatDescription>,
) -> Option<Retained<NSDictionary<NSString, AnyObject>>> {
    let format = format?;
    if video {
        let size = unsafe { CMVideoFormatDescriptionGetDimensions(format) };
        let codec = unsafe { AVVideoCodecTypeH264 }?;
        let width = NSNumber::numberWithInt(size.width);
        let height = NSNumber::numberWithInt(size.height);
        // 不重排帧（没有 B 帧）：分片写入时每一片自成一段，崩溃后读得出来的部分不缺参考帧；关键帧至少两秒一个，
        // 编辑时定位快。
        let no_reorder = NSNumber::numberWithBool(false);
        let key_interval = NSNumber::numberWithDouble(2.0);
        let compression_keys = [unsafe { AVVideoAllowFrameReorderingKey }?, unsafe { AVVideoMaxKeyFrameIntervalDurationKey }?];
        let compression_values: [&AnyObject; 2] = [no_reorder.as_ref(), key_interval.as_ref()];
        let compression = NSDictionary::<NSString, AnyObject>::from_slices(&compression_keys, &compression_values);
        let keys = [
            unsafe { AVVideoCodecKey }?,
            unsafe { AVVideoWidthKey }?,
            unsafe { AVVideoHeightKey }?,
            unsafe { AVVideoCompressionPropertiesKey }?,
        ];
        let values: [&AnyObject; 4] = [codec.as_ref(), width.as_ref(), height.as_ref(), compression.as_ref()];
        Some(NSDictionary::from_slices(&keys, &values))
    } else {
        let description = unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(format).as_ref() }?;
        let id = NSNumber::numberWithUnsignedInt(AUDIO_FORMAT_AAC);
        let rate = NSNumber::numberWithDouble(description.mSampleRate);
        let channels = NSNumber::numberWithUnsignedInt(description.mChannelsPerFrame.clamp(1, 2));
        let keys = [unsafe { AVFormatIDKey }?, unsafe { AVSampleRateKey }?, unsafe { AVNumberOfChannelsKey }?];
        let values: [&AnyObject; 3] = [id.as_ref(), rate.as_ref(), channels.as_ref()];
        Some(NSDictionary::from_slices(&keys, &values))
    }
}

/// 同一个画面，换一个呈现时刻。
fn retime(sample: &CMSampleBuffer, at: CMTime) -> Option<CFRetained<CMSampleBuffer>> {
    let timing = CMSampleTimingInfo { duration: unsafe { kCMTimeInvalid }, presentationTimeStamp: at, decodeTimeStamp: unsafe { kCMTimeInvalid } };
    let mut out: *mut CMSampleBuffer = ptr::null_mut();
    let status = unsafe { CMSampleBuffer::create_copy_with_new_timing(None, sample, 1, &timing, NonNull::from(&mut out)) };
    if status != 0 {
        return None;
    }
    NonNull::new(out).map(|out| unsafe { CFRetained::from_raw(out) })
}
