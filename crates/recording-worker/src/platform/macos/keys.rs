//! 键盘：一个只听不改的事件监听（`CGEventTapCreate`，`kCGSessionEventTap`、`kCGEventTapOptionListenOnly`，按下、抬起与
//! 修饰键变化三种事件），跑在自己线程的 CFRunLoop 上。监听键盘要系统的「输入监控」权限（CGEvent.h 对监听键盘事件的
//! 说明；IOHIDLib.h 的 `kIOHIDRequestTypeListenEvent`）：没有允许时建不起监听，`start` 失败并说明。系统的安全输入
//! （密码框）期间监听收不到按键，也不补。
//!
//! - `code`：系统的虚拟键码（HIToolbox `Events.h` 的 `kVK_*`）换成 UI Events 的 `KeyboardEvent.code`，认不出的写
//!   `Unidentified`。
//! - `shortcuts`：只记功能键（有名字的键：修饰键、回车、方向键、F 键……）与按着 Control、Option、Command 时的键，
//!   `key` 一律是空字符串。`all`：每个键都记，`key` 是打出来的字（`CGEventKeyboardGetUnicodeString`）或键的名字。
//! - 抬起只记按下记过的键。

use std::collections::HashSet;
use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use objc2_core_foundation::{CFMachPort, CFRetained, CFRunLoop, kCFRunLoopCommonModes};
use objc2_core_graphics::{
    CGEvent, CGEventField, CGEventFlags, CGEventMask, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventTapProxy,
    CGEventType,
};

use crate::protocol::{JournalLine, KeysMode, Ns, WorkerError};
use crate::sink::{self, Sink, TrackFile};

use super::clock;

struct Segment {
    file: TrackFile,
}

struct State {
    mode: KeysMode,
    segment: Option<Segment>,
    /// 按下记过的虚拟键码。
    down: HashSet<u16>,
    /// 按着的修饰键（`FlagsChanged` 只说变了，按下还是抬起看它在不在这里）。
    modifiers: HashSet<u16>,
    tap: Option<CFRetained<CFMachPort>>,
}

// SAFETY: `tap` 只在监听线程的回调里用（重新打开超时关掉的监听）；别的字段是普通数据。
unsafe impl Send for State {}

type Shared = Arc<Mutex<State>>;

pub struct Keys {
    state: Shared,
    run_loop: Option<RunLoopRef>,
    thread: Option<JoinHandle<()>>,
    dir: std::path::PathBuf,
    sink: Arc<Sink>,
}

struct RunLoopRef(CFRetained<CFRunLoop>);
// SAFETY: `CFRunLoopStop` 可以从别的线程调用（CFRunLoop 文档）。
unsafe impl Send for RunLoopRef {}

impl Keys {
    pub fn start(mode: KeysMode, dir: std::path::PathBuf, sink: Arc<Sink>) -> Result<Self, WorkerError> {
        let state: Shared =
            Arc::new(Mutex::new(State { mode, segment: None, down: HashSet::new(), modifiers: HashSet::new(), tap: None }));
        let (tx, rx) = mpsc::sync_channel::<Result<RunLoopRef, WorkerError>>(1);
        let shared = Arc::clone(&state);
        let thread = std::thread::Builder::new()
            .name("key-tap".to_owned())
            .spawn(move || run_tap(shared, tx))
            .map_err(|error| WorkerError::new("INTERNAL", format!("cannot start the key thread: {error}")))?;
        let run_loop = match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(run_loop)) => run_loop,
            Ok(Err(error)) => {
                let _ = thread.join();
                return Err(error);
            }
            Err(_) => return Err(WorkerError::new("INTERNAL", "the key thread did not start")),
        };
        Ok(Self { state, run_loop: Some(run_loop), thread: Some(thread), dir, sink })
    }

    pub fn begin_segment(&self, segment: &str) -> Result<(), WorkerError> {
        let name = format!("{segment}-keys.jsonl");
        let file = TrackFile::create(&self.dir, name.clone())
            .map_err(|error| WorkerError::new("IO_ERROR", format!("cannot create the key file: {error}")))?;
        self.sink
            .journal(&JournalLine::Keys { segment_id: segment.to_owned(), file: name }, true)
            .map_err(|error| WorkerError::new("IO_ERROR", format!("cannot journal the key file: {error}")))?;
        if let Ok(mut state) = self.state.lock() {
            state.down.clear();
            state.segment = Some(Segment { file });
        }
        Ok(())
    }

    pub fn end_segment(&self) {
        let segment = self.state.lock().ok().and_then(|mut state| state.segment.take());
        if let Some(segment) = segment {
            segment.file.finish();
        }
    }

    pub fn stop(&mut self) {
        if let Some(RunLoopRef(run_loop)) = self.run_loop.take() {
            run_loop.stop();
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn run_tap(state: Shared, ready: mpsc::SyncSender<Result<RunLoopRef, WorkerError>>) {
    let mask: CGEventMask =
        (1 << CGEventType::KeyDown.0) | (1 << CGEventType::KeyUp.0) | (1 << CGEventType::FlagsChanged.0);
    // 回调拿到的是这份 Arc 的指针；线程退出前一直活着。
    let user_info = Arc::into_raw(Arc::clone(&state)) as *mut c_void;
    let tap = unsafe {
        CGEvent::tap_create(
            CGEventTapLocation::SessionEventTap,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            mask,
            Some(on_event),
            user_info,
        )
    };
    let Some(tap) = tap else {
        drop(unsafe { Arc::from_raw(user_info as *const Mutex<State>) });
        let _ = ready.send(Err(WorkerError::new(
            "INPUT_MONITORING_UNAVAILABLE",
            "cannot listen to the keyboard: Input Monitoring is not allowed for this process",
        )));
        return;
    };
    let Some(source) = CFMachPort::new_run_loop_source(None, Some(&tap), 0) else {
        drop(unsafe { Arc::from_raw(user_info as *const Mutex<State>) });
        let _ = ready.send(Err(WorkerError::new("INTERNAL", "cannot attach the keyboard listener")));
        return;
    };
    let Some(run_loop) = CFRunLoop::current() else {
        drop(unsafe { Arc::from_raw(user_info as *const Mutex<State>) });
        let _ = ready.send(Err(WorkerError::new("INTERNAL", "no run loop for the keyboard listener")));
        return;
    };
    run_loop.add_source(Some(&source), unsafe { kCFRunLoopCommonModes });
    CGEvent::tap_enable(&tap, true);
    if let Ok(mut state) = state.lock() {
        state.tap = Some(tap.clone());
    }
    let _ = ready.send(Ok(RunLoopRef(run_loop.clone())));
    CFRunLoop::run();
    CGEvent::tap_enable(&tap, false);
    if let Ok(mut state) = state.lock() {
        state.tap = None;
    }
    drop(unsafe { Arc::from_raw(user_info as *const Mutex<State>) });
}

unsafe extern "C-unwind" fn on_event(
    _proxy: CGEventTapProxy,
    kind: CGEventType,
    event: NonNull<CGEvent>,
    user_info: *mut c_void,
) -> *mut CGEvent {
    let state = unsafe { &*(user_info as *const Mutex<State>) };
    let at = clock::now();
    if let Ok(mut state) = state.lock() {
        let event_ref = unsafe { event.as_ref() };
        if kind == CGEventType::TapDisabledByTimeout || kind == CGEventType::TapDisabledByUserInput {
            if let Some(tap) = &state.tap {
                CGEvent::tap_enable(tap, true);
            }
        } else {
            handle(&mut state, kind, event_ref, at);
        }
    }
    event.as_ptr()
}

fn handle(state: &mut State, kind: CGEventType, event: &CGEvent, at: Ns) {
    let vk = CGEvent::integer_value_field(Some(event), CGEventField::KeyboardEventKeycode) as u16;
    let (code, name) = key_code(vk);
    let down = if kind == CGEventType::FlagsChanged {
        // 修饰键：在不在按着的集合里决定这次是按下还是抬起。大写锁定每次变化都记成按下再抬起。
        if vk == 57 {
            push(state, at, vk, code, true, "CapsLock");
            push(state, at, vk, code, false, "CapsLock");
            return;
        }
        let pressed = !state.modifiers.remove(&vk);
        if pressed {
            state.modifiers.insert(vk);
        }
        pressed
    } else {
        kind == CGEventType::KeyDown
    };
    let flags = CGEvent::flags(Some(event));
    let chord = flags.intersects(CGEventFlags::MaskControl | CGEventFlags::MaskAlternate | CGEventFlags::MaskCommand);
    if !down {
        if state.down.remove(&vk) {
            let key = key_value(state.mode, event, name);
            write(state, at, code, false, &key);
        }
        return;
    }
    let wanted = match state.mode {
        KeysMode::Off => false,
        KeysMode::Shortcuts => name.is_some() || chord,
        KeysMode::All => true,
    };
    if !wanted {
        return;
    }
    let key = key_value(state.mode, event, name);
    push(state, at, vk, code, true, &key);
}

fn push(state: &mut State, at: Ns, vk: u16, code: &str, down: bool, key: &str) {
    if down {
        state.down.insert(vk);
    } else {
        state.down.remove(&vk);
    }
    let key = if state.mode == KeysMode::All { key } else { "" };
    write(state, at, code, down, key);
}

fn write(state: &mut State, at: Ns, code: &str, down: bool, key: &str) {
    if let Some(segment) = state.segment.as_mut() {
        segment.file.push(&sink::key_event(at, code, down, key));
    }
}

/// `all` 时的 `key`：有名字的键用名字，别的取这次按键打出来的字（控制字符不算）。
fn key_value(mode: KeysMode, event: &CGEvent, name: Option<&'static str>) -> String {
    if mode != KeysMode::All {
        return String::new();
    }
    if let Some(name) = name {
        return name.to_owned();
    }
    let mut buffer = [0u16; 8];
    let mut length: std::ffi::c_ulong = 0;
    unsafe { CGEvent::keyboard_get_unicode_string(Some(event), buffer.len() as _, &mut length, buffer.as_mut_ptr()) };
    let text = String::from_utf16_lossy(&buffer[..(length as usize).min(buffer.len())]);
    if text.chars().any(char::is_control) { String::new() } else { text.chars().take(16).collect() }
}

/// macOS 虚拟键码 → (`KeyboardEvent.code`, 有名字的键的 `KeyboardEvent.key`)。字符键的名字是 None。
pub fn key_code(vk: u16) -> (&'static str, Option<&'static str>) {
    let named = |code: &'static str, key: &'static str| (code, Some(key));
    match vk {
        0 => ("KeyA", None),
        1 => ("KeyS", None),
        2 => ("KeyD", None),
        3 => ("KeyF", None),
        4 => ("KeyH", None),
        5 => ("KeyG", None),
        6 => ("KeyZ", None),
        7 => ("KeyX", None),
        8 => ("KeyC", None),
        9 => ("KeyV", None),
        10 => ("IntlBackslash", None),
        11 => ("KeyB", None),
        12 => ("KeyQ", None),
        13 => ("KeyW", None),
        14 => ("KeyE", None),
        15 => ("KeyR", None),
        16 => ("KeyY", None),
        17 => ("KeyT", None),
        18 => ("Digit1", None),
        19 => ("Digit2", None),
        20 => ("Digit3", None),
        21 => ("Digit4", None),
        22 => ("Digit6", None),
        23 => ("Digit5", None),
        24 => ("Equal", None),
        25 => ("Digit9", None),
        26 => ("Digit7", None),
        27 => ("Minus", None),
        28 => ("Digit8", None),
        29 => ("Digit0", None),
        30 => ("BracketRight", None),
        31 => ("KeyO", None),
        32 => ("KeyU", None),
        33 => ("BracketLeft", None),
        34 => ("KeyI", None),
        35 => ("KeyP", None),
        36 => named("Enter", "Enter"),
        37 => ("KeyL", None),
        38 => ("KeyJ", None),
        39 => ("Quote", None),
        40 => ("KeyK", None),
        41 => ("Semicolon", None),
        42 => ("Backslash", None),
        43 => ("Comma", None),
        44 => ("Slash", None),
        45 => ("KeyN", None),
        46 => ("KeyM", None),
        47 => ("Period", None),
        48 => named("Tab", "Tab"),
        49 => ("Space", None),
        50 => ("Backquote", None),
        51 => named("Backspace", "Backspace"),
        53 => named("Escape", "Escape"),
        54 => named("MetaRight", "Meta"),
        55 => named("MetaLeft", "Meta"),
        56 => named("ShiftLeft", "Shift"),
        57 => named("CapsLock", "CapsLock"),
        58 => named("AltLeft", "Alt"),
        59 => named("ControlLeft", "Control"),
        60 => named("ShiftRight", "Shift"),
        61 => named("AltRight", "Alt"),
        62 => named("ControlRight", "Control"),
        63 => named("Fn", "Fn"),
        64 => named("F17", "F17"),
        65 => ("NumpadDecimal", None),
        67 => ("NumpadMultiply", None),
        69 => ("NumpadAdd", None),
        71 => named("NumLock", "Clear"),
        72 => named("AudioVolumeUp", "AudioVolumeUp"),
        73 => named("AudioVolumeDown", "AudioVolumeDown"),
        74 => named("AudioVolumeMute", "AudioVolumeMute"),
        75 => ("NumpadDivide", None),
        76 => named("NumpadEnter", "Enter"),
        78 => ("NumpadSubtract", None),
        79 => named("F18", "F18"),
        80 => named("F19", "F19"),
        81 => ("NumpadEqual", None),
        82 => ("Numpad0", None),
        83 => ("Numpad1", None),
        84 => ("Numpad2", None),
        85 => ("Numpad3", None),
        86 => ("Numpad4", None),
        87 => ("Numpad5", None),
        88 => ("Numpad6", None),
        89 => ("Numpad7", None),
        90 => named("F20", "F20"),
        91 => ("Numpad8", None),
        92 => ("Numpad9", None),
        93 => ("IntlYen", None),
        94 => ("IntlRo", None),
        95 => ("NumpadComma", None),
        96 => named("F5", "F5"),
        97 => named("F6", "F6"),
        98 => named("F7", "F7"),
        99 => named("F3", "F3"),
        100 => named("F8", "F8"),
        101 => named("F9", "F9"),
        102 => named("Lang2", "Eisu"),
        103 => named("F11", "F11"),
        104 => named("Lang1", "KanaMode"),
        105 => named("F13", "F13"),
        106 => named("F16", "F16"),
        107 => named("F14", "F14"),
        109 => named("F10", "F10"),
        110 => named("ContextMenu", "ContextMenu"),
        111 => named("F12", "F12"),
        113 => named("F15", "F15"),
        114 => named("Help", "Help"),
        115 => named("Home", "Home"),
        116 => named("PageUp", "PageUp"),
        117 => named("Delete", "Delete"),
        118 => named("F4", "F4"),
        119 => named("End", "End"),
        120 => named("F2", "F2"),
        121 => named("PageDown", "PageDown"),
        122 => named("F1", "F1"),
        123 => named("ArrowLeft", "ArrowLeft"),
        124 => named("ArrowRight", "ArrowRight"),
        125 => named("ArrowDown", "ArrowDown"),
        126 => named("ArrowUp", "ArrowUp"),
        _ => named("Unidentified", "Unidentified"),
    }
}

#[cfg(test)]
mod tests {
    use super::key_code;

    #[test]
    fn codes_are_ui_events_words() {
        let pattern = |code: &str| !code.is_empty() && code.len() <= 64 && code.chars().all(|c| c.is_ascii_alphanumeric());
        for vk in 0..=127u16 {
            let (code, _) = key_code(vk);
            assert!(pattern(code), "key code {vk} maps to {code}");
        }
        assert_eq!(key_code(0), ("KeyA", None));
        assert_eq!(key_code(55), ("MetaLeft", Some("Meta")));
        assert_eq!(key_code(126), ("ArrowUp", Some("ArrowUp")));
        assert_eq!(key_code(52).0, "Unidentified");
    }
}
