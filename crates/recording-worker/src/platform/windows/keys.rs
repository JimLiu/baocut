//! 键盘：低级键盘钩子（`SetWindowsHookExW(WH_KEYBOARD_LL)`，「LowLevelKeyboardProc」文档），跑在自己线程的消息循环上。
//! 只听不改：回调总是 `CallNextHookEx` 交下去。不需要权限；权限更高的窗口（以管理员运行）里的按键收不到（UIPI），
//! 安全桌面（锁屏、UAC 提示）上也收不到。回调要快：超过系统的 `LowLevelHooksTimeout`，系统跳过它，Windows 7 起
//! 多次超时后会把钩子摘掉（文档），这时不再有按键，也不报错（屏幕录制设计 §14）。
//!
//! - 时刻：回调里读的 QPC（[`clock::now`]），不用事件里的 `time`（`GetTickCount` 的毫秒）。
//! - `code`：扫描码加 `LLKHF_EXTENDED`（E0 前缀）换成 UI Events 的 `KeyboardEvent.code`
//!   （[`crate::platform::windows_portable::keys::code_for_scan`]）；扫描码是 0（有的程序注入的按键）时用
//!   `MapVirtualKeyW(MAPVK_VK_TO_VSC_EX)` 由虚拟键码推。
//! - `shortcuts`：只记有名字的键与按着 Control、Alt、Windows 键时的键，`key` 一律是空字符串。`all`：每个键都记，`key`
//!   是有名字的键的名字，或前台窗口的键盘布局下打出来的字（`ToUnicodeEx` 带标志 4：不改内核的键盘状态，Windows 10
//!   1607 起；死键不会被吃掉）。按住不放的自动重复照记（与 macOS 一致）。
//! - 抬起只记按下记过的键。

use std::collections::HashSet;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, GetKeyState, GetKeyboardLayout, MAPVK_VK_TO_VSC_EX, MapVirtualKeyW, ToUnicodeEx, VK_CAPITAL, VK_CONTROL,
    VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_EXTENDED, MSG,
    PostThreadMessageW, SetWindowsHookExW, UnhookWindowsHookEx, WH_KEYBOARD_LL, WM_KEYDOWN, WM_QUIT, WM_SYSKEYDOWN,
};
use windows_core::PCWSTR;

use crate::platform::windows_portable::keys::{Chord, code_for_scan, is_shortcut, named_key};
use crate::protocol::{JournalLine, KeysMode, WorkerError};
use crate::sink::{self, Sink, TrackFile};

use super::clock;

/// `ToUnicodeEx` 的 `wFlags`：不改键盘状态（Windows 10 1607 起）。
const TO_UNICODE_NO_STATE_CHANGE: u32 = 0x4;

struct State {
    mode: KeysMode,
    file: Option<TrackFile>,
    down: HashSet<u32>,
}

type Shared = Arc<Mutex<State>>;

/// 钩子的回调没有用户数据：当前的状态放在这里。同一时刻只有一次录制。
static CURRENT: Mutex<Option<Shared>> = Mutex::new(None);

pub struct Keys {
    state: Shared,
    dir: std::path::PathBuf,
    sink: Arc<Sink>,
    thread_id: u32,
    thread: Option<JoinHandle<()>>,
}

impl Keys {
    pub fn start(mode: KeysMode, dir: std::path::PathBuf, sink: Arc<Sink>) -> Result<Self, WorkerError> {
        let state: Shared = Arc::new(Mutex::new(State { mode, file: None, down: HashSet::new() }));
        if let Ok(mut current) = CURRENT.lock() {
            *current = Some(Arc::clone(&state));
        }
        let (tx, rx) = mpsc::sync_channel::<Result<u32, WorkerError>>(1);
        let thread = std::thread::Builder::new()
            .name("key-hook".to_owned())
            .spawn(move || run_hook(tx))
            .map_err(|error| WorkerError::new("INTERNAL", format!("cannot start the key thread: {error}")))?;
        let clear = || {
            if let Ok(mut current) = CURRENT.lock() {
                *current = None;
            }
        };
        let thread_id = match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(id)) => id,
            Ok(Err(error)) => {
                let _ = thread.join();
                clear();
                return Err(error);
            }
            Err(_) => {
                clear();
                return Err(WorkerError::new("INTERNAL", "the key hook did not start in time"));
            }
        };
        Ok(Self { state, dir, sink, thread_id, thread: Some(thread) })
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
            state.file = Some(file);
        }
        Ok(())
    }

    pub fn end_segment(&self) {
        let file = self.state.lock().ok().and_then(|mut state| state.file.take());
        if let Some(file) = file {
            file.finish();
        }
    }

    pub fn stop(&mut self) {
        let _ = unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0)) };
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        if let Ok(mut current) = CURRENT.lock()
            && current.as_ref().is_some_and(|shared| Arc::ptr_eq(shared, &self.state))
        {
            *current = None;
        }
    }
}

fn run_hook(ready: mpsc::SyncSender<Result<u32, WorkerError>>) {
    let module = unsafe { GetModuleHandleW(PCWSTR::null()) }.ok().map(|module| HINSTANCE(module.0));
    let hook = match unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(on_key), module, 0) } {
        Ok(hook) => hook,
        Err(e) => {
            let _ = ready.send(Err(WorkerError::new("INPUT_MONITORING_FAILED", format!("cannot install the keyboard hook: {}", e.message()))));
            return;
        }
    };
    let _ = ready.send(Ok(unsafe { GetCurrentThreadId() }));
    // 低级钩子的回调在装它的线程的消息循环里被调用。
    let mut message = MSG::default();
    while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {}
    let _ = unsafe { UnhookWindowsHookEx(hook) };
}

fn held(key: u16) -> bool {
    let state = unsafe { GetAsyncKeyState(i32::from(key)) };
    state as u16 & 0x8000 != 0
}

unsafe extern "system" fn on_key(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 && lparam.0 != 0 {
        let event = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
        handle(event, down);
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn handle(event: &KBDLLHOOKSTRUCT, down: bool) {
    let at = clock::now();
    let Some(shared) = CURRENT.lock().ok().and_then(|current| current.clone()) else { return };
    let Ok(mut state) = shared.lock() else { return };
    if state.file.is_none() {
        return;
    }
    let vk = event.vkCode;
    let (scan, extended) = if event.scanCode != 0 {
        (event.scanCode, event.flags.0 & LLKHF_EXTENDED.0 != 0)
    } else {
        let mapped = unsafe { MapVirtualKeyW(vk, MAPVK_VK_TO_VSC_EX) };
        (mapped & 0xFF, mapped >> 8 == 0xE0)
    };
    let code = code_for_scan(scan, extended);
    if down {
        let chord = Chord {
            control: held(VK_CONTROL.0),
            alt: held(VK_MENU.0),
            meta: held(VK_LWIN.0) || held(VK_RWIN.0),
        };
        let key = match state.mode {
            KeysMode::Off => return,
            KeysMode::Shortcuts => {
                if !is_shortcut(vk, chord) {
                    return;
                }
                String::new()
            }
            KeysMode::All => named_key(vk).map(str::to_owned).unwrap_or_else(|| typed(vk, scan)),
        };
        state.down.insert(vk);
        if let Some(file) = state.file.as_mut() {
            file.push(&sink::key_event(at, code, true, &key));
        }
    } else if state.down.remove(&vk) {
        let key = match state.mode {
            KeysMode::All => named_key(vk).map(str::to_owned).unwrap_or_else(|| typed(vk, scan)),
            _ => String::new(),
        };
        if let Some(file) = state.file.as_mut() {
            file.push(&sink::key_event(at, code, false, &key));
        }
    }
}

/// 前台窗口的键盘布局下这个键打出来的字；打不出字时是 `Unidentified`。
fn typed(vk: u32, scan: u32) -> String {
    let mut keys = [0u8; 256];
    for key in [VK_SHIFT, VK_CONTROL, VK_MENU] {
        if held(key.0) {
            keys[key.0 as usize] = 0x80;
        }
    }
    if unsafe { GetKeyState(i32::from(VK_CAPITAL.0)) } & 1 != 0 {
        keys[VK_CAPITAL.0 as usize] = 0x01;
    }
    let thread = unsafe { GetWindowThreadProcessId(GetForegroundWindow(), None) };
    let layout = unsafe { GetKeyboardLayout(thread) };
    let mut buffer = [0u16; 8];
    let count = unsafe { ToUnicodeEx(vk, scan, &keys, &mut buffer, TO_UNICODE_NO_STATE_CHANGE, Some(layout)) };
    // 负数是死键（重音符号等，等下一个键才出字）：记它本身的字。
    let length = count.unsigned_abs() as usize;
    let text = String::from_utf16_lossy(&buffer[..length.min(buffer.len())]);
    if text.is_empty() || text.chars().all(char::is_control) { "Unidentified".to_owned() } else { text }
}
