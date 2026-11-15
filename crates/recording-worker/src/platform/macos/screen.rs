//! 屏幕、窗口或区域与系统声音：ScreenCaptureKit 的 `SCStream`。
//!
//! - 内容：屏幕用 `SCContentFilter initWithDisplay:excludingApplications:exceptingWindows:`，排除 `start` 的 `exclude`
//!   里的应用（按 `SCShareableContent.applications` 的 `bundleIdentifier` 或 `processID` 认，没有例外窗口；名单空时
//!   什么都不排除），这些应用的窗口不进画面，桌面与程序坞照常录；窗口用
//!   `initWithDesktopIndependentWindow:`（窗口移动时跟着它）；区域是屏幕加 `SCStreamConfiguration.sourceRect`
//!   （屏幕自己的点坐标）。输出的像素尺寸是内容的点尺寸乘 `SCContentFilter.pointPixelScale`（macOS 14）。
//! - 光标：`showsCursor` 只在 `baked` 时打开，`separate` 时由指针线程另记（[`super::pointer`]）。
//! - 系统声音：`capturesAudio`，48 kHz 立体声，`excludesCurrentProcessAudio` 不录自己。
//! - 帧：`SCStreamFrameInfoStatus` 是 `complete` 的才是新画面，别的状态（画面没变、空白、暂停）没有像素，跳过。
//! - 时刻：`SCStream.synchronizationClock` 上的时刻（macOS 13），写日志时换到主机时钟。
//!
//! 系统录屏权限没有允许时，取可录内容或开始采集由系统决定弹授权窗口还是失败；失败照实报告。

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchRetained};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{AnyThread, DefinedClass, define_class, msg_send};
use objc2_core_foundation::{CGPoint, CGRect, CGSize, CFArray, CFDictionary};
use objc2_core_graphics::{CGDisplayBounds, CGMainDisplayID, CGRectMakeWithDictionaryRepresentation};
use objc2_core_media::{CMSampleBuffer, CMTime};
use objc2_foundation::{NSArray, NSDictionary, NSError, NSNumber, NSObject, NSObjectProtocol, NSString};
use objc2_screen_capture_kit::{
    SCContentFilter, SCDisplay, SCFrameStatus, SCRunningApplication, SCShareableContent, SCStream, SCStreamConfiguration,
    SCStreamDelegate, SCStreamFrameInfoScreenRect, SCStreamFrameInfoStatus, SCStreamOutput, SCStreamOutputType, SCWindow,
};

use crate::protocol::{CaptureKind, Exclusion, Rect, Source, WorkerError, WorkerEvent};
use crate::sink::Sink;

use super::sources;
use super::writer::Track;

/// `kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange`（'420v'）：视频编码器直接吃的格式，省一次转换。
const PIXEL_FORMAT_420V: u32 = u32::from_be_bytes(*b"420v");
const START_TIMEOUT: Duration = Duration::from_secs(15);

/// 捕获画面在全局屏幕坐标（点，左上角原点，与 `CGEvent` 的位置同一套）里的位置。窗口移动时由采集线程更新。
pub type SharedRect = Arc<Mutex<CGRect>>;

pub struct Resolved {
    filter: Retained<SCContentFilter>,
    pub kind: CaptureKind,
    /// 全局坐标里的捕获范围（点）。
    pub rect: CGRect,
    /// 区域录制时屏幕内的范围（点）。
    source_rect: Option<CGRect>,
    pub scale: f64,
    pub width: u32,
    pub height: u32,
}

/// 把来源换成内容过滤器与几何；整屏与区域按 `exclude` 排除应用（窗口录制不看它）。
pub fn resolve(source: &Source, exclude: Option<&Exclusion>) -> Result<Resolved, WorkerError> {
    let content = sources::shareable_content()?;
    let display_for = |id: Option<&str>| {
        let wanted = match id {
            Some(id) => id.parse::<u32>().map_err(|_| WorkerError::new("SOURCE_NOT_FOUND", format!("display {id} does not exist")))?,
            None => CGMainDisplayID(),
        };
        let displays = unsafe { content.displays() };
        // 显示器睡着或屏幕锁着时 ScreenCaptureKit 一块屏幕也不给：说清楚，不说成 ID 不对。
        if displays.is_empty() {
            return Err(WorkerError::new("CAPTURE_UNAVAILABLE", "ScreenCaptureKit lists no displays (the display may be asleep or the screen locked)"));
        }
        displays
            .iter()
            .find(|display| unsafe { display.displayID() } == wanted)
            .ok_or_else(|| WorkerError::new("SOURCE_NOT_FOUND", format!("display {wanted} does not exist")))
    };
    match source {
        Source::Display { display_id } => {
            let display = display_for(display_id.as_deref())?;
            let filter = display_filter(&content, &display, exclude);
            let rect = CGDisplayBounds(unsafe { display.displayID() });
            Ok(geometry(filter, CaptureKind::Display, rect, None))
        }
        Source::Window { window_id } => {
            let wanted: u32 =
                window_id.parse().map_err(|_| WorkerError::new("SOURCE_NOT_FOUND", format!("window {window_id} does not exist")))?;
            let window = unsafe { content.windows() }
                .iter()
                .find(|window| unsafe { window.windowID() } == wanted)
                .ok_or_else(|| WorkerError::new("SOURCE_NOT_FOUND", format!("window {window_id} does not exist")))?;
            let filter = unsafe { SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), &window) };
            let rect = unsafe { window.frame() };
            Ok(geometry(filter, CaptureKind::Window, rect, None))
        }
        Source::Area { display_id, rect } => {
            let display = display_for(display_id.as_deref())?;
            let bounds = CGDisplayBounds(unsafe { display.displayID() });
            let inside = clamp(rect, bounds.size).ok_or_else(|| WorkerError::new("INVALID_REQUEST", "the area is outside the display"))?;
            let filter = display_filter(&content, &display, exclude);
            let global = CGRect::new(CGPoint::new(bounds.origin.x + inside.origin.x, bounds.origin.y + inside.origin.y), inside.size);
            Ok(geometry(filter, CaptureKind::Area, global, Some(inside)))
        }
    }
}

/// 整块屏幕减去排除的应用。名单里的应用此刻没在运行（`applications` 里没有）就没有什么要排除；排除表空时与
/// `initWithDisplay:excludingWindows:` 加空表一样。
fn display_filter(content: &SCShareableContent, display: &SCDisplay, exclude: Option<&Exclusion>) -> Retained<SCContentFilter> {
    let excluded: Vec<Retained<SCRunningApplication>> = match exclude {
        Some(exclude) if !exclude.bundle_ids.is_empty() || !exclude.pids.is_empty() => unsafe { content.applications() }
            .iter()
            .filter(|app| {
                let bundle = unsafe { app.bundleIdentifier() }.to_string();
                let pid = unsafe { app.processID() };
                exclude.bundle_ids.iter().any(|id| *id == bundle) || exclude.pids.contains(&pid)
            })
            .collect(),
        _ => Vec::new(),
    };
    let applications = NSArray::from_retained_slice(&excluded);
    let no_windows = NSArray::<SCWindow>::new();
    unsafe {
        SCContentFilter::initWithDisplay_excludingApplications_exceptingWindows(SCContentFilter::alloc(), display, &applications, &no_windows)
    }
}

fn clamp(rect: &Rect, size: CGSize) -> Option<CGRect> {
    let x0 = rect.x.max(0.0);
    let y0 = rect.y.max(0.0);
    let x1 = (rect.x + rect.width).min(size.width);
    let y1 = (rect.y + rect.height).min(size.height);
    (x1 - x0 >= 2.0 && y1 - y0 >= 2.0).then(|| CGRect::new(CGPoint::new(x0, y0), CGSize::new(x1 - x0, y1 - y0)))
}

fn geometry(filter: Retained<SCContentFilter>, kind: CaptureKind, rect: CGRect, source_rect: Option<CGRect>) -> Resolved {
    let scale = f64::from(unsafe { filter.pointPixelScale() }).max(1.0);
    let size = source_rect.map_or_else(|| unsafe { filter.contentRect() }.size, |inside| inside.size);
    // H.264 要偶数尺寸。
    let even = |points: f64| ((points * scale).round() as u32 / 2 * 2).max(2);
    Resolved { filter, kind, rect, source_rect, scale, width: even(size.width), height: even(size.height) }
}

pub struct ScreenIvars {
    screen: Arc<Track>,
    audio: Option<Arc<Track>>,
    sink: Arc<Sink>,
    /// 窗口录制：每帧更新窗口在屏幕上的位置。
    window_rect: Option<SharedRect>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "BaoCutRecordingScreenOutput"]
    #[ivars = ScreenIvars]
    pub struct ScreenOutput;

    unsafe impl NSObjectProtocol for ScreenOutput {}

    unsafe impl SCStreamOutput for ScreenOutput {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        unsafe fn did_output(&self, _stream: &SCStream, sample: &CMSampleBuffer, kind: SCStreamOutputType) {
            let ivars = self.ivars();
            if kind == SCStreamOutputType::Screen {
                if let Some(info) = frame_info(sample) {
                    if !info.complete {
                        return;
                    }
                    if let (Some(shared), Some(rect)) = (&ivars.window_rect, info.screen_rect)
                        && let Ok(mut current) = shared.lock()
                    {
                        *current = rect;
                    }
                    ivars.screen.append(sample);
                }
            } else if kind == SCStreamOutputType::Audio
                && let Some(audio) = &ivars.audio
            {
                audio.append(sample);
            }
        }
    }

    unsafe impl SCStreamDelegate for ScreenOutput {
        #[unsafe(method(stream:didStopWithError:))]
        unsafe fn did_stop(&self, _stream: &SCStream, error: &NSError) {
            self.ivars().sink.emit(&WorkerEvent::Failed {
                code: "CAPTURE_STOPPED".to_owned(),
                message: format!("ScreenCaptureKit stopped the stream: {}", error.localizedDescription()),
            });
        }
    }
);

impl ScreenOutput {
    fn new(ivars: ScreenIvars) -> Retained<Self> {
        let this = Self::alloc().set_ivars(ivars);
        unsafe { msg_send![super(this), init] }
    }
}

struct FrameInfo {
    complete: bool,
    screen_rect: Option<CGRect>,
}

/// 帧的附加信息（`SCStreamFrameInfo` 各键在样本附件数组的第一个字典里）。
fn frame_info(sample: &CMSampleBuffer) -> Option<FrameInfo> {
    let attachments: objc2_core_foundation::CFRetained<CFArray> = unsafe { sample.sample_attachments_array(false) }?;
    // CFArray / CFDictionary 与 NSArray / NSDictionary 免费桥接。
    let array = unsafe { &*(&*attachments as *const CFArray as *const NSArray<NSDictionary<NSString, AnyObject>>) };
    let first = array.firstObject()?;
    let status = first.objectForKey(unsafe { SCStreamFrameInfoStatus })?.downcast::<NSNumber>().ok()?;
    let complete = status.integerValue() == SCFrameStatus::Complete.0;
    let screen_rect = first.objectForKey(unsafe { SCStreamFrameInfoScreenRect }).and_then(|value| {
        let dictionary = unsafe { &*(&*value as *const AnyObject as *const CFDictionary) };
        let mut rect = CGRect::default();
        unsafe { CGRectMakeWithDictionaryRepresentation(Some(dictionary), &mut rect) }.then_some(rect)
    });
    Some(FrameInfo { complete, screen_rect })
}

pub struct ScreenCapture {
    stream: Retained<SCStream>,
    _output: Retained<ScreenOutput>,
    _video_queue: DispatchRetained<DispatchQueue>,
    _audio_queue: DispatchRetained<DispatchQueue>,
}

pub struct ScreenOptions {
    pub fps: u32,
    pub shows_cursor: bool,
}

impl ScreenCapture {
    pub fn start(
        resolved: &Resolved,
        options: ScreenOptions,
        screen: Arc<Track>,
        audio: Option<Arc<Track>>,
        sink: Arc<Sink>,
        window_rect: Option<SharedRect>,
    ) -> Result<Self, WorkerError> {
        let config = unsafe { SCStreamConfiguration::new() };
        unsafe {
            config.setWidth(resolved.width as usize);
            config.setHeight(resolved.height as usize);
            config.setMinimumFrameInterval(CMTime::new(1, options.fps as i32));
            config.setPixelFormat(PIXEL_FORMAT_420V);
            config.setShowsCursor(options.shows_cursor);
            config.setQueueDepth(6);
            if let Some(inside) = resolved.source_rect {
                config.setSourceRect(inside);
            }
            if audio.is_some() {
                config.setCapturesAudio(true);
                config.setSampleRate(48_000);
                config.setChannelCount(2);
                config.setExcludesCurrentProcessAudio(true);
            }
        }
        let has_audio = audio.is_some();
        let output = ScreenOutput::new(ScreenIvars { screen: Arc::clone(&screen), audio: audio.clone(), sink, window_rect });
        let delegate = ProtocolObject::<dyn SCStreamDelegate>::from_ref(&*output);
        let stream = unsafe { SCStream::initWithFilter_configuration_delegate(SCStream::alloc(), &resolved.filter, &config, Some(delegate)) };
        let video_queue = DispatchQueue::new("com.baocut.recording.screen", None);
        let audio_queue = DispatchQueue::new("com.baocut.recording.system-audio", None);
        let as_output = ProtocolObject::<dyn SCStreamOutput>::from_ref(&*output);
        unsafe { stream.addStreamOutput_type_sampleHandlerQueue_error(as_output, SCStreamOutputType::Screen, Some(&video_queue)) }
            .map_err(|error| capture_error("cannot add the screen output", &error))?;
        if has_audio {
            unsafe { stream.addStreamOutput_type_sampleHandlerQueue_error(as_output, SCStreamOutputType::Audio, Some(&audio_queue)) }
                .map_err(|error| capture_error("cannot add the system audio output", &error))?;
        }
        wait_for_error(|done| unsafe { stream.startCaptureWithCompletionHandler(Some(done)) })
            .map_err(|(message, declined)| start_error(message, declined))?;
        let clock = unsafe { stream.synchronizationClock() }.map(super::clock::cf_clock);
        screen.set_clock(clock.clone());
        if let Some(audio) = &audio {
            audio.set_clock(clock);
        }
        Ok(Self { stream, _output: output, _video_queue: video_queue, _audio_queue: audio_queue })
    }

    pub fn stop(&self) {
        if let Err(message) = wait_for(|done| unsafe { self.stream.stopCaptureWithCompletionHandler(Some(done)) }) {
            eprintln!("ScreenCaptureKit did not stop cleanly: {message}");
        }
    }
}

fn capture_error(what: &str, error: &NSError) -> WorkerError {
    WorkerError::new("CAPTURE_UNAVAILABLE", format!("{what}: {}", error.localizedDescription()))
}

/// 调一个带完成回调（参数是可空的 NSError）的方法，等它完成。
fn wait_for(call: impl FnOnce(&block2::DynBlock<dyn Fn(*mut NSError)>)) -> Result<(), String> {
    wait_for_error(call).map_err(|(message, _)| message)
}

/// `SCStreamErrorDomain` 的 `SCStreamErrorUserDeclined`（ScreenCaptureKit `SCError.h`）：用户没有允许录屏。
const SC_STREAM_ERROR_DOMAIN: &str = "com.apple.ScreenCaptureKit.SCStreamErrorDomain";
const SC_STREAM_ERROR_USER_DECLINED: isize = -3801;

/// 开始采集失败时按原因给错误码：没有录屏权限是 `SCREEN_PERMISSION_DENIED`（Runtime 换成缺权限的错误），别的是采集不可用。
fn start_error(message: String, declined: bool) -> WorkerError {
    if declined {
        WorkerError::new("SCREEN_PERMISSION_DENIED", format!("ScreenCaptureKit did not start: {message}"))
    } else {
        WorkerError::new("CAPTURE_UNAVAILABLE", format!("ScreenCaptureKit did not start: {message}"))
    }
}

/// 等一个完成回调；失败时给说明，以及是不是「用户没有允许」。
fn wait_for_error(call: impl FnOnce(&block2::DynBlock<dyn Fn(*mut NSError)>)) -> Result<(), (String, bool)> {
    let (tx, rx) = mpsc::sync_channel::<Option<(String, bool)>>(1);
    let block = RcBlock::new(move |error: *mut NSError| {
        let failure = unsafe { error.as_ref() }.map(|error| {
            let declined = error.domain().to_string() == SC_STREAM_ERROR_DOMAIN && error.code() == SC_STREAM_ERROR_USER_DECLINED;
            (error.localizedDescription().to_string(), declined)
        });
        let _ = tx.try_send(failure);
    });
    call(&block);
    match rx.recv_timeout(START_TIMEOUT) {
        Ok(None) => Ok(()),
        Ok(Some(failure)) => Err(failure),
        Err(_) => Err(("timed out".to_owned(), false)),
    }
}
