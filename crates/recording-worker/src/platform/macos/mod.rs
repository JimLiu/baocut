//! macOS：ScreenCaptureKit 录屏幕、窗口或区域与系统声音，AVCaptureSession 录摄像头与麦克风，AVAssetWriter 写文件
//! （视频 H.264，由 VideoToolbox 硬件编码；音频 AAC），CoreGraphics 读指针与键盘，AppKit 取光标图片。
//! 所有时刻都在 CoreMedia 的主机时钟上（[`clock`]）。请求在主线程上处理（`NSScreen`、`NSCursor` 要主线程）。

mod clock;
mod permissions;
mod sources;

use std::sync::Arc;

use objc2::MainThreadMarker;

use crate::protocol::{Capability, Ns, Sources, StartParams, WorkerError};
use crate::sink::Sink;

use super::{Capturer, Platform};

pub struct MacPlatform {
    mtm: MainThreadMarker,
}

impl MacPlatform {
    pub fn new() -> Self {
        let mtm = MainThreadMarker::new().expect("the recording worker handles requests on the main thread");
        Self { mtm }
    }
}

impl Platform for MacPlatform {
    fn name(&self) -> &'static str {
        "darwin"
    }

    fn capability(&self) -> Capability {
        Capability { supported: true, reason: None }
    }

    fn sources(&mut self) -> Result<Sources, WorkerError> {
        Ok(sources::sources(self.mtm))
    }

    fn open(&mut self, _params: &StartParams, _sink: Arc<Sink>) -> Result<Box<dyn Capturer>, WorkerError> {
        Err(WorkerError::new("CAPTURE_UNAVAILABLE", "capture is not wired up yet"))
    }

    fn now(&self) -> Ns {
        clock::now()
    }
}
