//! 各路流共用的单调时钟：QPC（`QueryPerformanceCounter`，「Acquiring high-resolution time stamps」文档）。
//!
//! - Windows.Graphics.Capture 的帧时刻 `Direct3D11CaptureFrame.SystemRelativeTime` 是 QPC 上的 100 纳秒单位。
//! - WASAPI `IAudioCaptureClient::GetBuffer` 的 `pu64QPCPosition` 也是 QPC 上的 100 纳秒单位。
//! - 摄像头见 [`super::camera`]。
//!
//! 换算在 [`crate::platform::windows_portable::timing`]（与系统无关，测试在任何平台上跑）。

use std::sync::OnceLock;

use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

use crate::platform::windows_portable::timing;
use crate::protocol::Ns;

fn frequency() -> i64 {
    static FREQUENCY: OnceLock<i64> = OnceLock::new();
    *FREQUENCY.get_or_init(|| {
        let mut value = 0i64;
        // Windows XP 起这两个调用总是成功（文档）。
        let _ = unsafe { QueryPerformanceFrequency(&mut value) };
        value
    })
}

pub fn now() -> Ns {
    let mut ticks = 0i64;
    let _ = unsafe { QueryPerformanceCounter(&mut ticks) };
    Ns(timing::qpc_to_ns(ticks, frequency()))
}

/// QPC 上的 100 纳秒单位换成纳秒。
pub fn from_hns(hns: i64) -> Ns {
    Ns(timing::hns_to_ns(hns))
}
