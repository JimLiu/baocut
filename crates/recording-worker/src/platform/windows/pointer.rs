//! 指针的监视线程，每秒 120 次：
//!
//! - 位置：`GetCursorPos`（进程是每显示器 DPI 感知 v2，给的是虚拟桌面上的物理像素），换成捕获画面里的归一化坐标；
//!   画面外的位置照记。只在变了时写一行。窗口录制时每半秒重新取一次窗口的范围（`DWMWA_EXTENDED_FRAME_BOUNDS`），窗口
//!   挪了指针仍然对得上。
//! - 按键：`GetAsyncKeyState(VK_LBUTTON / VK_RBUTTON / VK_MBUTTON)`。它读的是物理按键（文档），系统设置了左右键互换
//!   （`GetSystemMetrics(SM_SWAPBUTTON)`）时换回来，记的是主键、副键、中键，与 macOS 的左、右、中同义。
//! - 光标图片（`separate` 时）：每秒 40 次看 `GetCursorInfo` 的光标句柄，新句柄就取它的位图（`GetIconInfo` +
//!   `GetDIBits`）：彩色光标用它的 alpha（全为 0 时用 AND 掩码）；单色光标用上下两半的 AND / XOR 掩码（反色的像素画成
//!   不透明的黑）。存成 `cursor-<hash>.png`，日志写一行 `cursor`，事件文件写 `c` 行。热点按位图尺寸的比例；`scale` 见
//!   [`cursor_scale`]。动画光标只取它当前的那一帧。隐藏的光标（`CURSOR_SHOWING` 不在）不换图片。
//!
//! 段外不写事件文件；段开始时开文件、记进日志，先写当前的位置、按着的键与光标，段内的事件从那里接着（与 macOS 一致）。

use std::collections::{HashMap, HashSet};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, DeleteObject, GetDC, GetDIBits, GetObjectW, HBITMAP, HDC, HGDIOBJ,
    ReleaseDC,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON};
use windows::Win32::UI::WindowsAndMessaging::{
    CURSOR_SHOWING, CURSORINFO, GetCursorInfo, GetCursorPos, GetIconInfo, GetSystemMetrics, HICON, ICONINFO, SM_SWAPBUTTON,
};

use crate::platform::windows_portable::geometry::{PixelRect, color_cursor_rgba, cursor_scale, hotspot, mono_cursor_rgba, normalize};
use crate::platform::windows_portable::png::encode_rgba;
use crate::protocol::{Hotspot, JournalLine, Ns, WorkerError};
use crate::sink::{self, Sink, TrackFile};

use super::clock;
use super::sources;

const TICK: Duration = Duration::from_micros(8_333);
const CURSOR_EVERY: u32 = 3;
const WINDOW_EVERY: u32 = 60;

struct Segment {
    start: Ns,
    file: TrackFile,
}

impl Segment {
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

impl Monitor {
    /// `rect` 是捕获范围（虚拟桌面的物理像素）；`window` 是窗口录制时的窗口句柄值。
    pub fn start(
        dir: PathBuf,
        sink: Arc<Sink>,
        rect: Arc<Mutex<PixelRect>>,
        window: Option<isize>,
        pointer: bool,
        cursor_images: bool,
    ) -> Result<Self, WorkerError> {
        let stop = Arc::new(AtomicBool::new(false));
        let state = Arc::new(Mutex::new(State::default()));
        let worker = Worker {
            dir: dir.clone(),
            sink: Arc::clone(&sink),
            rect,
            window,
            cursor_images,
            state: Arc::clone(&state),
            seen: HashSet::new(),
            handles: HashMap::new(),
        };
        let flag = Arc::clone(&stop);
        let thread = if pointer {
            Some(
                std::thread::Builder::new()
                    .name("pointer-monitor".to_owned())
                    .spawn(move || worker.run(&flag))
                    .map_err(|error| WorkerError::new("INTERNAL", format!("cannot start the pointer thread: {error}")))?,
            )
        } else {
            None
        };
        Ok(Self { stop, thread, state, dir, sink, pointer })
    }

    pub fn begin_segment(&self, segment: &str, start: Ns) -> Result<(), WorkerError> {
        if !self.pointer {
            return Ok(());
        }
        let name = format!("{segment}-pointer.jsonl");
        let mut file = TrackFile::create(&self.dir, name.clone())
            .map_err(|error| WorkerError::new("IO_ERROR", format!("cannot create the pointer file: {error}")))?;
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
    rect: Arc<Mutex<PixelRect>>,
    window: Option<isize>,
    cursor_images: bool,
    state: Arc<Mutex<State>>,
    /// 存过的光标图片。
    seen: HashSet<String>,
    /// 光标句柄 → 图片 ID（同一个句柄不再取位图）。
    handles: HashMap<isize, String>,
}

impl Worker {
    fn run(mut self, stop: &AtomicBool) {
        let mut tick: u32 = 0;
        while !stop.load(Ordering::Relaxed) {
            if let Some(window) = self.window
                && tick.is_multiple_of(WINDOW_EVERY)
                && let Some(frame) = sources::window_frame(HWND(window as *mut _))
                && let Ok(mut rect) = self.rect.lock()
            {
                *rect = PixelRect {
                    x: frame.left,
                    y: frame.top,
                    width: (frame.right - frame.left).max(0) as u32,
                    height: (frame.bottom - frame.top).max(0) as u32,
                };
            }
            self.sample_pointer();
            if self.cursor_images && tick.is_multiple_of(CURSOR_EVERY) {
                self.sample_cursor();
            }
            tick = tick.wrapping_add(1);
            std::thread::sleep(TICK);
        }
    }

    fn sample_pointer(&self) {
        let at = clock::now();
        let mut point = POINT::default();
        if unsafe { GetCursorPos(&mut point) }.is_err() {
            // 安全桌面（锁屏、UAC 提示）上取不到：不写。
            return;
        }
        let rect = self.rect.lock().map(|rect| *rect).unwrap_or_default();
        let Some((x, y)) = normalize(point.x, point.y, rect) else { return };
        let pressed = |key: i32| (unsafe { GetAsyncKeyState(key) } as u16) & 0x8000 != 0;
        let (left, right, middle) = (pressed(i32::from(VK_LBUTTON.0)), pressed(i32::from(VK_RBUTTON.0)), pressed(i32::from(VK_MBUTTON.0)));
        let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
        let buttons = if swapped { [right, left, middle] } else { [left, right, middle] };
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

    fn sample_cursor(&mut self) {
        let at = clock::now();
        let mut info = CURSORINFO { cbSize: std::mem::size_of::<CURSORINFO>() as u32, ..Default::default() };
        if unsafe { GetCursorInfo(&mut info) }.is_err() || info.flags.0 & CURSOR_SHOWING.0 == 0 || info.hCursor.is_invalid() {
            return;
        }
        let handle = info.hCursor.0 as isize;
        let id = match self.handles.get(&handle) {
            Some(id) => id.clone(),
            None => {
                let Some(id) = self.save_cursor(HICON::from(info.hCursor)) else { return };
                self.handles.insert(handle, id.clone());
                id
            }
        };
        let Ok(mut state) = self.state.lock() else { return };
        if state.cursor.as_deref() != Some(id.as_str()) {
            state.cursor = Some(id.clone());
            if let Some(segment) = state.segment.as_mut() {
                segment.push(|at| sink::pointer_cursor(at, &id), at);
            }
        }
    }

    /// 取光标的位图，存一张图片，日志写一行 `cursor`；返回图片 ID。
    fn save_cursor(&mut self, icon: HICON) -> Option<String> {
        let mut info = ICONINFO::default();
        unsafe { GetIconInfo(icon, &mut info) }.ok()?;
        let image = cursor_image(&info);
        for bitmap in [info.hbmColor, info.hbmMask] {
            if !bitmap.is_invalid() {
                let _ = unsafe { DeleteObject(HGDIOBJ::from(bitmap)) };
            }
        }
        let (width, height, rgba) = image?;
        let (hx, hy) = hotspot(info.xHotspot, info.yHotspot, width, height);
        let mut hasher = DefaultHasher::new();
        rgba.hash(&mut hasher);
        (width, height, info.xHotspot, info.yHotspot).hash(&mut hasher);
        let id = format!("{:016x}", hasher.finish());
        if self.seen.contains(&id) {
            return Some(id);
        }
        let file = format!("cursor-{id}.png");
        std::fs::write(self.dir.join(&file), encode_rgba(width, height, &rgba)).ok()?;
        let line = JournalLine::Cursor { id: id.clone(), file, hotspot: Hotspot { x: hx, y: hy }, scale: Some(cursor_scale()), shape: None };
        self.sink.journal(&line, false).ok()?;
        self.seen.insert(id.clone());
        Some(id)
    }
}

/// 位图的宽高。
fn bitmap_size(bitmap: HBITMAP) -> Option<(u32, u32)> {
    let mut info = BITMAP::default();
    let read = unsafe { GetObjectW(HGDIOBJ::from(bitmap), std::mem::size_of::<BITMAP>() as i32, Some(&mut info as *mut BITMAP as *mut _)) };
    (read > 0 && info.bmWidth > 0 && info.bmHeight > 0).then_some((info.bmWidth as u32, info.bmHeight as u32))
}

/// 位图读成自上而下的 32 位 BGRA（单色位图里 0 → 黑 0x000000，1 → 白 0xFFFFFF）。
fn read_bits(dc: HDC, bitmap: HBITMAP, width: u32, height: u32) -> Option<Vec<u8>> {
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut pixels = vec![0u8; width as usize * height as usize * 4];
    let lines = unsafe { GetDIBits(dc, bitmap, 0, height, Some(pixels.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS) };
    (lines == height as i32).then_some(pixels)
}

/// 光标的 RGBA 与宽高。
fn cursor_image(info: &ICONINFO) -> Option<(u32, u32, Vec<u8>)> {
    let dc = unsafe { GetDC(None) };
    let result = (|| {
        if !info.hbmColor.is_invalid() {
            let (width, height) = bitmap_size(info.hbmColor)?;
            let color = read_bits(dc, info.hbmColor, width, height)?;
            let mask = (!info.hbmMask.is_invalid())
                .then(|| read_bits(dc, info.hbmMask, width, height))
                .flatten()
                .map(|bits| bits.chunks_exact(4).map(|pixel| pixel[0] != 0).collect::<Vec<bool>>());
            Some((width, height, color_cursor_rgba(&color, mask.as_deref())))
        } else {
            // 单色光标：掩码位图是两倍高，上半 AND，下半 XOR。
            let (width, double) = bitmap_size(info.hbmMask)?;
            let height = double / 2;
            let bits = read_bits(dc, info.hbmMask, width, double)?;
            let flags: Vec<bool> = bits.chunks_exact(4).map(|pixel| pixel[0] != 0).collect();
            let half = width as usize * height as usize;
            Some((width, height, mono_cursor_rgba(&flags[..half], &flags[half..half * 2])))
        }
    })();
    unsafe { ReleaseDC(None, dc) };
    result
}
