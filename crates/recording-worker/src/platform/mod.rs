//! 平台的采集。[`Platform`] 是与系统打交道的全部：枚举来源与权限、打开一次录制、单调时钟；[`Capturer`] 是打开之后的
//! 一次录制，按段开关各路写入。平台专属代码只在各自的 `cfg` 模块里（开发流程 §4）。

use std::sync::Arc;

use crate::protocol::{Capability, Capture, CursorMode, Ns, Sources, StartParams, WorkerError};
use crate::sink::Sink;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(target_os = "macos", windows)))]
mod unsupported;
#[cfg(windows)]
mod windows;
/// Windows 实现里与系统无关的部分（键码表、时刻换算、像素格式与几何）：测试在任何平台上都跑。
#[cfg(any(windows, test))]
mod windows_portable;

pub trait Platform {
    /// `hello` 里的平台名（`darwin`、`win32`、`linux`），与 Node 的 `process.platform` 同一套写法。
    fn name(&self) -> &'static str;
    fn capability(&self) -> Capability;
    /// 来源与权限的状态。只问状态，不触发系统的授权窗口。
    fn sources(&mut self) -> Result<Sources, WorkerError>;
    /// 准备一次录制：解析来源、打开设备、开始采集，但还不写文件（第一段由 [`Capturer::begin_segment`] 开）。
    fn open(&mut self, params: &StartParams, sink: Arc<Sink>) -> Result<Box<dyn Capturer>, WorkerError>;
    /// 各路流共用的单调时钟（纳秒）。
    fn now(&self) -> Ns;
}

pub trait Capturer {
    /// 实际的鼠标模式（可能从 `separate` 退到 `baked`）。
    fn cursor(&self) -> CursorMode;
    fn capture(&self) -> Capture;
    /// 开始一段：各路在这一段的第一个样本到时各自开文件、写 `stream` 行并推送 `stream`。
    fn begin_segment(&mut self, segment: &str, start: Ns) -> Result<(), WorkerError>;
    /// 结束当前段：各路写完、文件可读之后写 `stream-end` 行，再写指针与键盘的事件文件。
    fn end_segment(&mut self, segment: &str, end: Ns) -> Result<(), WorkerError>;
    /// 停止采集、放掉设备。
    fn close(&mut self);
}

/// 这台电脑的平台实现。
pub fn current() -> Box<dyn Platform> {
    #[cfg(target_os = "macos")]
    {
        Box::new(macos::MacPlatform::new())
    }
    #[cfg(windows)]
    {
        Box::new(self::windows::WinPlatform::new())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        Box::new(unsupported::UnsupportedPlatform)
    }
}
