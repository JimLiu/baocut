//! BaoCut 的 Recording Worker（屏幕录制设计 §7）：与平台无关的部分在这里（协议、日志与事件的落盘、请求的分派），
//! 采集在 [`platform`] 后面。macOS 是 ScreenCaptureKit + AVFoundation；Windows 是 Windows.Graphics.Capture + WASAPI +
//! Media Foundation，但没有在 Windows 上运行过，缺省回答不支持，开发态开关打开才启用（屏幕录制设计 §7、§9）；别的平台
//! `hello` 回答不支持，`start` 拒绝，不假装能录。
//!
//! 错误说明是给 Runtime 日志看的开发者文字（英文），不是界面文字。

pub mod pacing;
pub mod platform;
pub mod protocol;
pub mod server;
pub mod sink;
