//! 指针与设备的监视线程，每秒 120 次：
//!
//! - 位置：`CGEventCreate(NULL)` 的 `CGEventGetLocation`（全局屏幕坐标，点，左上角原点），换成捕获画面里的归一化坐标；
//!   画面外的位置照记（小于 0 或大于 1）。只在变了时写一行。
//! - 按键：`CGEventSourceButtonState`（左、右、中三个键），变了时写一行。轮询不需要任何系统权限。
//! - 光标图片（`separate` 时）：每秒 40 次看 `NSCursor.currentSystemCursor`，图片的 TIFF 字节换了就是新光标：存成
//!   `cursor-<hash>.png`，日志写一行 `cursor`（热点按图片尺寸的比例，`scale` 是每点的像素数），事件文件写 `c` 行。
//! - 设备：每半秒看一次摄像头、麦克风还连着没有，断了交给 [`Track::lose`]。
//!
//! 段外不写事件文件；段开始时开文件、记进日志，先写当前的位置、按着的键与光标，段内的事件从那里接着。

use std::collections::HashSet;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use objc2::rc::Retained;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSCursor};
use objc2_core_foundation::CGRect;
use objc2_core_graphics::{CGEvent, CGEventSource, CGEventSourceStateID, CGMouseButton};
use objc2_foundation::NSDictionary;

use crate::protocol::{Hotspot, JournalLine, Ns, WorkerError};
use crate::sink::{self, Sink, TrackFile};

use super::av_capture::DeviceCapture;
use super::clock;
use super::screen::SharedRect;

const TICK: Duration = Duration::from_micros(8_333);
const CURSOR_EVERY: u32 = 3;
const DEVICE_EVERY: u32 = 60;

struct Segment {
    start: Ns,
    file: TrackFile,
}

impl Segment {
    /// 采样的时刻可能早于段开始（采样与开段在两个线程上），不早于段的开头。
    fn push(&mut self, row: impl Fn(Ns) -> serde_json::Value, at: Ns) {
        self.file.push(&row(at.max(self.start)));
    }
}

#[derive(Default)]
struct State {
    segment: Option<Segment>,
    position: Option<(f64, f64)>,
    buttons: [bool; 3],
    cursor: Option<String>,
}

pub struct Monitor {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    state: Arc<Mutex<State>>,
    dir: PathBuf,
    sink: Arc<Sink>,
    pointer: bool,
}

/// 设备列表交给监视线程。
struct Devices(Vec<Arc<DeviceCapture>>);
// SAFETY: 监视线程只读 `AVCaptureDevice.connected`（属性读取可以在任意线程上做），并调 `Track` 自己的同步方法。
unsafe impl Send for Devices {}

/// `NSCursor.currentSystemCursor` 现在拿得到吗（拿不到时 `separate` 退到 `baked`）。AppKit 已经把它标成过时，
/// 说以后的系统上会一直是空的。
#[allow(deprecated)]
pub fn system_cursor_available() -> bool {
    NSCursor::currentSystemCursor().is_some()
}

impl Monitor {
    /// `pointer` 时记指针，`cursor_images` 时另记光标图片。
    pub fn start(
        dir: PathBuf,
        sink: Arc<Sink>,
        rect: SharedRect,
        pointer: bool,
        cursor_images: bool,
        devices: Vec<Arc<DeviceCapture>>,
    ) -> Result<Self, WorkerError> {
        let stop = Arc::new(AtomicBool::new(false));
        let state = Arc::new(Mutex::new(State::default()));
        let worker = Worker {
            dir: dir.clone(),
            sink: Arc::clone(&sink),
            rect,
            pointer,
            cursor_images,
            devices: Devices(devices),
            state: Arc::clone(&state),
            seen: HashSet::new(),
        };
        let flag = Arc::clone(&stop);
        let thread = std::thread::Builder::new()
            .name("pointer-monitor".to_owned())
            .spawn(move || worker.run(&flag))
            .map_err(|error| WorkerError::new("INTERNAL", format!("cannot start the pointer thread: {error}")))?;
        Ok(Self { stop, thread: Some(thread), state, dir, sink, pointer })
    }

    pub fn begin_segment(&self, segment: &str, start: Ns) -> Result<(), WorkerError> {
        if !self.pointer {
            return Ok(());
        }
        let name = format!("{segment}-pointer.jsonl");
        let mut file = TrackFile::create(&self.dir, name.clone())
            .map_err(|error| WorkerError::new("IO_ERROR", format!("cannot create the pointer file: {error}")))?;
        // 文件一开就记进日志：每行都即时写盘，崩溃之后恢复时这一段的指针也在。
        self.sink
            .journal(&JournalLine::Pointer { segment_id: segment.to_owned(), file: name }, true)
            .map_err(|error| WorkerError::new("IO_ERROR", format!("cannot journal the pointer file: {error}")))?;
        let Ok(mut state) = self.state.lock() else { return Ok(()) };
        if let Some((x, y)) = state.position {
            file.push(&sink::pointer_move(start, x, y));
        }
        for (button, down) in state.buttons.iter().enumerate() {
            if *down {
                file.push(&sink::pointer_button(start, button as u32, true));
            }
        }
        if let Some(cursor) = &state.cursor {
            file.push(&sink::pointer_cursor(start, cursor));
        }
        state.segment = Some(Segment { start, file });
        Ok(())
    }

    pub fn end_segment(&self) {
        let segment = self.state.lock().ok().and_then(|mut state| state.segment.take());
        if let Some(segment) = segment {
            segment.file.finish();
        }
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct Worker {
    dir: PathBuf,
    sink: Arc<Sink>,
    rect: SharedRect,
    pointer: bool,
    cursor_images: bool,
    devices: Devices,
    state: Arc<Mutex<State>>,
    seen: HashSet<String>,
}

impl Worker {
    fn run(mut self, stop: &AtomicBool) {
        let mut tick: u32 = 0;
        while !stop.load(Ordering::Relaxed) {
            objc2::rc::autoreleasepool(|_| {
                if self.pointer {
                    self.sample_pointer();
                    if self.cursor_images && tick % CURSOR_EVERY == 0 {
                        self.sample_cursor();
                    }
                }
                if tick % DEVICE_EVERY == 0 {
                    for device in &self.devices.0 {
                        if !device.track().is_lost() && !device.is_connected() {
                            device.track().lose(clock::now());
                        }
                    }
                }
            });
            tick = tick.wrapping_add(1);
            std::thread::sleep(TICK);
        }
    }

    fn sample_pointer(&self) {
        let at = clock::now();
        let location = CGEvent::location(CGEvent::new(None).as_deref());
        let rect: CGRect = self.rect.lock().map(|rect| *rect).unwrap_or_default();
        if rect.size.width <= 0.0 || rect.size.height <= 0.0 {
            return;
        }
        let x = (location.x - rect.origin.x) / rect.size.width;
        let y = (location.y - rect.origin.y) / rect.size.height;
        let buttons = [CGMouseButton::Left, CGMouseButton::Right, CGMouseButton::Center]
            .map(|button| CGEventSource::button_state(CGEventSourceStateID::CombinedSessionState, button));
        let Ok(mut state) = self.state.lock() else { return };
        let moved = state.position.is_none_or(|(px, py)| (px - x).abs() > 1e-6 || (py - y).abs() > 1e-6);
        if moved {
            state.position = Some((x, y));
            if let Some(segment) = state.segment.as_mut() {
                segment.push(|at| sink::pointer_move(at, x, y), at);
            }
        }
        for (button, down) in buttons.into_iter().enumerate() {
            if state.buttons[button] != down {
                state.buttons[button] = down;
                if let Some(segment) = state.segment.as_mut() {
                    segment.push(|at| sink::pointer_button(at, button as u32, down), at);
                }
            }
        }
    }

    #[allow(deprecated)]
    fn sample_cursor(&mut self) {
        let at = clock::now();
        let Some(cursor) = NSCursor::currentSystemCursor() else { return };
        let image = cursor.image();
        let Some(tiff) = image.TIFFRepresentation() else { return };
        let bytes = tiff.to_vec();
        let mut hasher = DefaultHasher::new();
        bytes.hash(&mut hasher);
        let id = format!("{:016x}", hasher.finish());
        if !self.seen.contains(&id) && self.save_cursor(&id, &cursor, &tiff) {
            self.seen.insert(id.clone());
        }
        if !self.seen.contains(&id) {
            return;
        }
        let Ok(mut state) = self.state.lock() else { return };
        if state.cursor.as_deref() != Some(id.as_str()) {
            state.cursor = Some(id.clone());
            if let Some(segment) = state.segment.as_mut() {
                segment.push(|at| sink::pointer_cursor(at, &id), at);
            }
        }
    }

    /// 存一张光标图片，日志写一行 `cursor`。
    fn save_cursor(&self, id: &str, cursor: &Retained<NSCursor>, tiff: &objc2_foundation::NSData) -> bool {
        let image = cursor.image();
        let size = image.size();
        if size.width <= 0.0 || size.height <= 0.0 {
            return false;
        }
        let Some(bitmap) = NSBitmapImageRep::imageRepWithData(tiff) else { return false };
        let pixels = bitmap.pixelsWide() as f64;
        let properties = NSDictionary::new();
        let Some(png) = (unsafe { bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties) }) else {
            return false;
        };
        let file = format!("cursor-{id}.png");
        if std::fs::write(self.dir.join(&file), png.to_vec()).is_err() {
            return false;
        }
        let hotspot = cursor.hotSpot();
        let line = JournalLine::Cursor {
            id: id.to_owned(),
            file,
            hotspot: Hotspot { x: (hotspot.x / size.width).clamp(0.0, 1.0), y: (hotspot.y / size.height).clamp(0.0, 1.0) },
            scale: (pixels > 0.0).then(|| pixels / size.width),
            shape: None,
        };
        self.sink.journal(&line, false).is_ok()
    }
}
