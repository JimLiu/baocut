//! Windows：Windows.Graphics.Capture 录屏幕、窗口或区域，WASAPI 录麦克风与系统声音（回环），Media Foundation 的
//! Source Reader 录摄像头，Media Foundation 的 Sink Writer 写文件（视频 H.264、硬件编码优先；音频 AAC；分片 MP4，
//! 正常收尾后转成普通 MP4），Win32 读指针、光标图片与键盘。所有时刻都在 QPC 上（[`clock`]）。
//!
//! **没有在 Windows 上运行过，只通过了交叉编译检查**（屏幕录制设计 §9、§14）。所以缺省不开放：`hello` 回答
//! `supported: false`（`reason` 是 [`UNVERIFIED_REASON`]），`sources` 只报空的来源，`start` 拒绝；设了开发态的
//! 环境变量 [`ENABLE_VAR`]`=1` 才启用。Runtime 只看 `hello.capture.supported`，开关不用动 TypeScript 一侧。

mod audio;
mod camera;
mod clock;
mod com;
mod keys;
mod pointer;
mod remux;
mod screen;
mod sources;
mod writer;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::protocol::{
    Access, Capability, Capture, CaptureKind, CursorMode, KeysMode, Ns, Permissions, Role, Sources, StartParams, WorkerError,
};
use crate::sink::Sink;

use audio::AudioCapture;
use camera::CameraCapture;
use keys::Keys;
use pointer::Monitor;
use screen::ScreenCapture;
use writer::Track;

use super::{Capturer, Platform};

/// 开发态开关：设成 `1` 时 Windows 采集才启用。
pub const ENABLE_VAR: &str = "BAOCUT_RECORDING_WINDOWS_EXPERIMENTAL";
/// 没有打开开关时 `hello` 的 `reason`。
pub const UNVERIFIED_REASON: &str = "windows-capture-unverified";

fn enabled() -> bool {
    std::env::var(ENABLE_VAR).is_ok_and(|value| value == "1")
}

pub struct WinPlatform {
    enabled: bool,
}

impl WinPlatform {
    pub fn new() -> Self {
        let enabled = enabled();
        if enabled {
            // 每显示器 DPI 感知 v2：Win32 给的显示器矩形、窗口矩形与指针位置都是物理像素，与捕获画面同一套。不声明时
            // 系统按 96 DPI 虚拟化这些坐标，缩放比例不是 100% 的显示器上指针会对不上（Windows「High DPI Desktop
            // Application Development」文档）。进程只能设一次；已经设过（清单里声明过）时这次调用失败，照用已有的。
            com::declare_dpi_awareness();
            com::init_thread();
            if let Err(error) = com::media_foundation() {
                eprintln!("Media Foundation did not start: {error}");
            }
        }
        Self { enabled }
    }
}

impl Platform for WinPlatform {
    fn name(&self) -> &'static str {
        "win32"
    }

    fn capability(&self) -> Capability {
        if !self.enabled {
            return Capability { supported: false, reason: Some(UNVERIFIED_REASON.to_owned()) };
        }
        match screen::capture_supported() {
            true => Capability { supported: true, reason: None },
            false => Capability { supported: false, reason: Some("graphics-capture-unsupported".to_owned()) },
        }
    }

    fn sources(&mut self) -> Result<Sources, WorkerError> {
        if !self.enabled {
            return Ok(Sources {
                permissions: Permissions {
                    screen: Access::Unknown,
                    camera: Access::Unknown,
                    microphone: Access::Unknown,
                    input_monitoring: Access::Unknown,
                },
                displays: Vec::new(),
                windows: Vec::new(),
                cameras: Vec::new(),
                microphones: Vec::new(),
            });
        }
        Ok(sources::sources())
    }

    fn open(&mut self, params: &StartParams, sink: Arc<Sink>) -> Result<Box<dyn Capturer>, WorkerError> {
        if !self.enabled {
            return Err(WorkerError::new(
                "UNSUPPORTED_PLATFORM",
                format!("screen recording on Windows has not been verified on a real machine; set {ENABLE_VAR}=1 to try it"),
            ));
        }
        Ok(Box::new(WinCapturer::open(params, sink)?))
    }

    fn now(&self) -> Ns {
        clock::now()
    }
}

/// 一次录制：一个 Windows.Graphics.Capture 会话（屏幕）、每个声音设备一个 WASAPI 客户端、摄像头一个 Source Reader、
/// 指针监视线程与（可选的）键盘钩子。采集从打开起一直在跑，段只决定样本写不写、写进哪个文件。
struct WinCapturer {
    cursor: CursorMode,
    capture: Capture,
    tracks: Vec<Arc<Track>>,
    screen: Option<ScreenCapture>,
    audio: Vec<AudioCapture>,
    camera: Option<CameraCapture>,
    monitor: Option<Monitor>,
    keys: Option<Keys>,
}

impl WinCapturer {
    fn open(params: &StartParams, sink: Arc<Sink>) -> Result<Self, WorkerError> {
        let dir = PathBuf::from(&params.dir);
        if let Some(exclude) = &params.exclude
            && (!exclude.bundle_ids.is_empty() || !exclude.pids.is_empty())
        {
            // Windows.Graphics.Capture 录整块屏幕时没有按应用排除的办法；窗口要自己声明不被捕获
            // （`SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`，只能由窗口所属的进程调用）。见屏幕录制设计 §7。
            eprintln!("the exclusion list is ignored on Windows: Windows.Graphics.Capture cannot exclude other processes' windows");
        }
        let resolved = screen::resolve(&params.source)?;
        // `separate` 与 `none` 要系统不把光标画进画面（`GraphicsCaptureSession.IsCursorCaptureEnabled`，Windows 10 2004
        // 起）。没有这个开关的系统上光标总在画面里：退到 `baked`，指针照记（取景要用）。
        let cursor = if params.cursor != CursorMode::Baked && !screen::cursor_toggle_supported() {
            eprintln!("GraphicsCaptureSession.IsCursorCaptureEnabled is not available; the cursor is baked into the picture");
            CursorMode::Baked
        } else {
            params.cursor
        };
        let capture = Capture { kind: resolved.kind, width: resolved.width, height: resolved.height, scale: resolved.scale };
        let screen_track = Track::new(Role::Screen, dir.clone(), Arc::clone(&sink), None, Some(params.fps));
        let mut capturer = Self {
            cursor,
            capture,
            tracks: vec![Arc::clone(&screen_track)],
            screen: None,
            audio: Vec::new(),
            camera: None,
            monitor: None,
            keys: None,
        };
        // 设备先开：权限被拒绝时在屏幕开始采集之前失败。
        if let Some(id) = params.camera.as_deref() {
            let (activate, reference) = camera::find(id)?;
            let track = Track::new(Role::Camera, dir.clone(), Arc::clone(&sink), Some(reference), None);
            match CameraCapture::start(&activate, Arc::clone(&track)) {
                Ok(camera) => {
                    capturer.tracks.push(track);
                    capturer.camera = Some(camera);
                }
                Err(error) => {
                    capturer.close();
                    return Err(error);
                }
            }
        }
        if let Some(id) = params.microphone.as_deref() {
            let result = audio::find_microphone(id).and_then(|(device, reference)| {
                let track = Track::new(Role::Microphone, dir.clone(), Arc::clone(&sink), Some(reference), None);
                AudioCapture::start(&device, false, Arc::clone(&track)).map(|capture| (capture, track))
            });
            match result {
                Ok((capture, track)) => {
                    capturer.tracks.push(track);
                    capturer.audio.push(capture);
                }
                // 麦克风不在（拔掉了，或者这台电脑没有）不算失败：照常录，只是没有这一路声音。
                Err(error) if error.code == "SOURCE_NOT_FOUND" => {
                    eprintln!("recording-worker: {}; recording without a microphone", error.message);
                }
                Err(error) => {
                    capturer.close();
                    return Err(error);
                }
            }
        }
        if params.system_audio {
            let result = audio::default_render().and_then(|device| {
                let track = Track::new(Role::SystemAudio, dir.clone(), Arc::clone(&sink), None, None);
                AudioCapture::start(&device, true, Arc::clone(&track)).map(|capture| (capture, track))
            });
            match result {
                Ok((capture, track)) => {
                    capturer.tracks.push(track);
                    capturer.audio.push(capture);
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
        let rect = Arc::new(Mutex::new(resolved.global));
        let window = (resolved.kind == CaptureKind::Window).then_some(resolved.window).flatten();
        match ScreenCapture::start(&resolved, params.fps, cursor == CursorMode::Baked, screen_track, Arc::clone(&sink)) {
            Ok(screen) => capturer.screen = Some(screen),
            Err(error) => {
                capturer.close();
                return Err(error);
            }
        }
        match Monitor::start(dir, sink, rect, window, cursor != CursorMode::None, cursor == CursorMode::Separate) {
            Ok(monitor) => capturer.monitor = Some(monitor),
            Err(error) => {
                capturer.close();
                return Err(error);
            }
        }
        Ok(capturer)
    }
}

impl Capturer for WinCapturer {
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
        for audio in self.audio.drain(..) {
            audio.stop();
        }
        if let Some(camera) = self.camera.take() {
            camera.stop();
        }
        if let Some(mut monitor) = self.monitor.take() {
            monitor.stop();
        }
        if let Some(mut keys) = self.keys.take() {
            keys.stop();
        }
    }
}
