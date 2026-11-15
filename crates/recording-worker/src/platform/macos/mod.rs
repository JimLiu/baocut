//! macOS：ScreenCaptureKit 录屏幕、窗口或区域与系统声音，AVCaptureSession 录摄像头与麦克风，AVAssetWriter 写文件
//! （视频 H.264，由 VideoToolbox 硬件编码；音频 AAC），CoreGraphics 读指针与键盘，AppKit 取光标图片。
//! 所有时刻都在 CoreMedia 的主机时钟上（[`clock`]）。请求在主线程上处理（`NSScreen`、`NSCursor` 要主线程）。

mod av_capture;
mod clock;
mod keys;
mod permissions;
mod pointer;
mod screen;
mod sources;
mod writer;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use objc2::MainThreadMarker;

use crate::protocol::{Capability, Capture, CursorMode, KeysMode, Ns, Role, Sources, StartParams, WorkerError};
use crate::sink::Sink;

use av_capture::DeviceCapture;
use keys::Keys;
use pointer::Monitor;
use screen::{ScreenCapture, ScreenOptions};
use writer::Track;

use super::{Capturer, Platform};

pub struct MacPlatform {
    mtm: MainThreadMarker,
}

impl MacPlatform {
    pub fn new() -> Self {
        let mtm = MainThreadMarker::new().expect("the recording worker handles requests on the main thread");
        Self { mtm }
    }
}

impl Platform for MacPlatform {
    fn name(&self) -> &'static str {
        "darwin"
    }

    fn capability(&self) -> Capability {
        Capability { supported: true, reason: None }
    }

    fn sources(&mut self) -> Result<Sources, WorkerError> {
        Ok(sources::sources(self.mtm))
    }

    fn open(&mut self, params: &StartParams, sink: Arc<Sink>) -> Result<Box<dyn Capturer>, WorkerError> {
        Ok(Box::new(MacCapturer::open(params, sink)?))
    }

    fn now(&self) -> Ns {
        clock::now()
    }
}

/// 一次录制：一个 SCStream（屏幕与系统声音）、每个设备一个 AVCaptureSession、指针监视线程与（可选的）键盘监听。
/// 采集从打开起一直在跑，段只决定样本写不写、写进哪个文件。
struct MacCapturer {
    cursor: CursorMode,
    capture: Capture,
    tracks: Vec<Arc<Track>>,
    screen: Option<ScreenCapture>,
    devices: Vec<Arc<DeviceCapture>>,
    monitor: Option<Monitor>,
    keys: Option<Keys>,
}

impl MacCapturer {
    fn open(params: &StartParams, sink: Arc<Sink>) -> Result<Self, WorkerError> {
        let dir = PathBuf::from(&params.dir);
        let resolved = screen::resolve(&params.source)?;
        // `separate` 要系统的光标图片；拿不到时让 ScreenCaptureKit 把光标画进画面。
        let cursor = match params.cursor {
            CursorMode::Separate if !pointer::system_cursor_available() => CursorMode::Baked,
            other => other,
        };
        let capture = Capture { kind: resolved.kind, width: resolved.width, height: resolved.height, scale: resolved.scale };
        let screen_track = Track::new(Role::Screen, dir.clone(), Arc::clone(&sink), None);
        let audio_track = params.system_audio.then(|| Track::new(Role::SystemAudio, dir.clone(), Arc::clone(&sink), None));
        let mut capturer = Self {
            cursor,
            capture,
            tracks: vec![Arc::clone(&screen_track)],
            screen: None,
            devices: Vec::new(),
            monitor: None,
            keys: None,
        };
        capturer.tracks.extend(audio_track.iter().cloned());
        // 设备先开：系统的授权窗口（还没问过时）在屏幕开始采集之前出现。
        for (video, id, role) in [(true, params.camera.as_deref(), Role::Camera), (false, params.microphone.as_deref(), Role::Microphone)] {
            let Some(id) = id else { continue };
            let (device, reference) = av_capture::find(video, id)?;
            let track = Track::new(role, dir.clone(), Arc::clone(&sink), Some(reference));
            match DeviceCapture::start(video, device, Arc::clone(&track)) {
                Ok(device) => {
                    capturer.tracks.push(track);
                    capturer.devices.push(Arc::new(device));
                }
                Err(error) => {
                    capturer.close();
                    return Err(error);
                }
            }
        }
        if params.keys != KeysMode::Off {
            match Keys::start(params.keys, dir.clone(), Arc::clone(&sink)) {
                Ok(keys) => capturer.keys = Some(keys),
                Err(error) => {
                    capturer.close();
                    return Err(error);
                }
            }
        }
        let rect = Arc::new(Mutex::new(resolved.rect));
        let window_rect = (resolved.kind == crate::protocol::CaptureKind::Window).then(|| Arc::clone(&rect));
        let options = ScreenOptions { fps: params.fps, shows_cursor: cursor == CursorMode::Baked };
        match ScreenCapture::start(&resolved, options, screen_track, audio_track, Arc::clone(&sink), window_rect) {
            Ok(screen) => capturer.screen = Some(screen),
            Err(error) => {
                capturer.close();
                return Err(error);
            }
        }
        match Monitor::start(dir, sink, rect, cursor != CursorMode::None, cursor == CursorMode::Separate, capturer.devices.clone()) {
            Ok(monitor) => capturer.monitor = Some(monitor),
            Err(error) => {
                capturer.close();
                return Err(error);
            }
        }
        Ok(capturer)
    }
}

impl Capturer for MacCapturer {
    fn cursor(&self) -> CursorMode {
        self.cursor
    }

    fn capture(&self) -> Capture {
        self.capture.clone()
    }

    fn begin_segment(&mut self, segment: &str, start: Ns) -> Result<(), WorkerError> {
        if let Some(monitor) = &self.monitor {
            monitor.begin_segment(segment, start)?;
        }
        if let Some(keys) = &self.keys {
            keys.begin_segment(segment)?;
        }
        for track in &self.tracks {
            track.begin(segment, start);
        }
        Ok(())
    }

    fn end_segment(&mut self, _segment: &str, end: Ns) -> Result<(), WorkerError> {
        for track in &self.tracks {
            track.end(end);
        }
        if let Some(monitor) = &self.monitor {
            monitor.end_segment();
        }
        if let Some(keys) = &self.keys {
            keys.end_segment();
        }
        Ok(())
    }

    fn close(&mut self) {
        if let Some(screen) = self.screen.take() {
            screen.stop();
        }
        for device in self.devices.drain(..) {
            device.stop();
        }
        if let Some(mut monitor) = self.monitor.take() {
            monitor.stop();
        }
        if let Some(mut keys) = self.keys.take() {
            keys.stop();
        }
    }
}
