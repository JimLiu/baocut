//! 指针与设备的监视线程，每秒 120 次：
//!
//! - 位置：`CGEventCreate(NULL)` 的 `CGEventGetLocation`（全局屏幕坐标，点，左上角原点），换成捕获画面里的归一化坐标；
//!   画面外的位置照记（小于 0 或大于 1）。只在变了时写一行。
//! - 按键：`CGEventSourceButtonState`（左、右、中三个键），变了时写一行。轮询不需要任何系统权限。
//! - 光标图片（`separate` 时）：每秒 40 次看 `NSCursor.currentSystemCursor`，图片的 TIFF 字节换了就是新光标：存成
//!   `cursor-<hash>.png`，日志写一行 `cursor`，事件文件写 `c` 行。热点按图片尺寸（点）的比例。`scale` 按格式规范 §4.7
//!   是图片的几个像素对应捕获画面的一个像素：存下的那张位图的像素宽 ÷（光标的点宽 × 捕获画面每点的像素数）。
//!   TIFF 里常有几张不同分辨率的位图，取像素最多的那张存。
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
use objc2_foundation::{NSData, NSDictionary};

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
    /// `pointer` 时记指针，`cursor_images` 时另记光标图片；`capture_scale` 是捕获画面每点的像素数（光标的 `scale` 按它换算）。
    pub fn start(
        dir: PathBuf,
        sink: Arc<Sink>,
        rect: SharedRect,
        capture_scale: f64,
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
            // 1 倍的宽屏缩到每边 4096 以内时每点不到一个像素（screen.rs 的 `fit_scale`），不能夹到 1。
            capture_scale: if capture_scale > 0.0 { capture_scale } else { 1.0 },
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
    capture_scale: f64,
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
    fn save_cursor(&self, id: &str, cursor: &Retained<NSCursor>, tiff: &NSData) -> bool {
        let image = cursor.image();
        let size = image.size();
        if size.width <= 0.0 || size.height <= 0.0 {
            return false;
        }
        let Some(bitmap) = largest_bitmap(tiff) else { return false };
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
            scale: (pixels > 0.0).then(|| cursor_scale(pixels, size.width, self.capture_scale)),
            shape: None,
        };
        self.sink.journal(&line, false).is_ok()
    }
}

/// TIFF 里像素最多的那张位图（光标图片常同时带 1 倍与 2 倍的）。
fn largest_bitmap(tiff: &NSData) -> Option<Retained<NSBitmapImageRep>> {
    NSBitmapImageRep::imageRepsWithData(tiff)
        .iter()
        .filter_map(|rep| rep.downcast::<NSBitmapImageRep>().ok())
        .max_by_key(|bitmap| bitmap.pixelsWide())
}

/// 光标的 `scale`（格式规范 §4.7）：图片的几个像素对应捕获画面的一个像素。光标在屏幕上 `points_wide` 点宽，
/// 捕获画面每点 `capture_scale` 个像素，所以它在画面里占 `points_wide × capture_scale` 个像素。
fn cursor_scale(image_pixels: f64, points_wide: f64, capture_scale: f64) -> f64 {
    image_pixels / (points_wide * capture_scale)
}

#[cfg(test)]
mod tests {
    use super::cursor_scale;

    #[test]
    fn cursor_scale_is_image_pixels_per_capture_pixel() {
        // 2 倍屏上录：32 像素宽的 2 倍光标图片画成 16 点 = 32 个画面像素，一比一。
        assert_eq!(cursor_scale(32.0, 16.0, 2.0), 1.0);
        // 1 倍屏上录同一张 2 倍图片：16 点 = 16 个画面像素，图片两个像素对一个。
        assert_eq!(cursor_scale(32.0, 16.0, 1.0), 2.0);
        // 2 倍屏上只拿到 1 倍图片：图片一个像素对两个画面像素。
        assert_eq!(cursor_scale(16.0, 16.0, 2.0), 0.5);
        // 1 倍的 5120 宽屏缩成 4096 宽（每点 0.8 个像素）：16 点的 1 倍光标在画面里是 12.8 像素。
        assert!((cursor_scale(16.0, 16.0, 0.8) - 1.25).abs() < 1e-9);
    }
}
