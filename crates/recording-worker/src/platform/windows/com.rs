//! COM、Media Foundation 与 DPI 的初始化，宽字符串与错误的小工具。
//!
//! - 每个碰 COM 的线程先 `CoInitializeEx(COINIT_MULTITHREADED)`（多线程单元：Media Foundation、WASAPI 与
//!   Windows.Graphics.Capture 的自由线程帧池都可以在 MTA 里用）。已经初始化过（`S_FALSE`）或别人选了单线程单元
//!   （`RPC_E_CHANGED_MODE`）时照用，不报错。
//! - Media Foundation 进程里 `MFStartup` 一次，进程退出时不 `MFShutdown`（Worker 退出就是进程结束）。

use std::sync::OnceLock;

use windows::Win32::Foundation::E_ACCESSDENIED;
use windows::Win32::Media::MediaFoundation::{MFSTARTUP_FULL, MFStartup, MF_VERSION};
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};
use windows::Win32::UI::HiDpi::{DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext};
use windows_core::PWSTR;

use crate::protocol::WorkerError;

pub fn init_thread() {
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
}

pub fn media_foundation() -> Result<(), String> {
    static STARTED: OnceLock<Result<(), String>> = OnceLock::new();
    STARTED.get_or_init(|| unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL) }.map_err(|error| error.message())).clone()
}

pub fn declare_dpi_awareness() {
    if let Err(error) = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) } {
        eprintln!("cannot declare per-monitor DPI awareness (it may already be set): {}", error.message());
    }
}

/// 以 0 结尾的 UTF-16。
pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 定长的 UTF-16 缓冲（到第一个 0 为止）换成字符串。
pub fn from_wide(buffer: &[u16]) -> String {
    let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..end])
}

/// 系统分配的宽字符串（`CoTaskMemAlloc`）读出来再放掉。
pub fn take_pwstr(text: PWSTR) -> String {
    if text.is_null() {
        return String::new();
    }
    let value = unsafe { text.to_string() }.unwrap_or_default();
    unsafe { windows::Win32::System::Com::CoTaskMemFree(Some(text.0 as *const _)) };
    value
}

pub fn is_access_denied(error: &windows_core::Error) -> bool {
    error.code() == E_ACCESSDENIED
}

/// 系统调用失败：带上 HRESULT，日志里查得到原因。
pub fn error(code: &str, what: &str, error: &windows_core::Error) -> WorkerError {
    WorkerError::new(code, format!("{what}: {} (HRESULT {:#010x})", error.message(), error.code().0 as u32))
}

/// 只在一个线程上用、但要放进 `Send` 结构里的 COM 对象（Media Foundation 与 WASAPI 的接口在绑定里不是 `Send`）。
/// 这些对象都在多线程单元里创建，可以跨线程调用；本 crate 里每个这样的对象同一时刻只有一个线程在用（各自的锁或线程）。
pub struct Mta<T>(pub T);
// SAFETY: 见上。
unsafe impl<T> Send for Mta<T> {}
