//! 还没有采集实现的平台（Windows 是阶段 4：Windows.Graphics.Capture、WASAPI 回环与 Media Foundation，屏幕录制设计 §7）。
//! `hello` 照实回答不支持，`sources` 只报空的来源与未知的权限，`start` 拒绝；不假装能录。

use std::sync::Arc;
use std::time::Instant;

use crate::protocol::{Access, Capability, Ns, Permissions, Sources, StartParams, WorkerError};
use crate::sink::Sink;

use super::{Capturer, Platform};

pub struct UnsupportedPlatform;

fn platform_name() -> &'static str {
    if cfg!(target_os = "windows") { "win32" } else if cfg!(target_os = "linux") { "linux" } else { "unknown" }
}

impl Platform for UnsupportedPlatform {
    fn name(&self) -> &'static str {
        platform_name()
    }

    fn capability(&self) -> Capability {
        Capability { supported: false, reason: Some("unsupported-platform".to_owned()) }
    }

    fn sources(&mut self) -> Result<Sources, WorkerError> {
        Ok(Sources {
            permissions: Permissions {
                screen: Access::Unknown,
                camera: Access::Unknown,
                microphone: Access::Unknown,
                input_monitoring: Access::Unknown,
            },
            displays: Vec::new(),
            windows: Vec::new(),
            cameras: Vec::new(),
            microphones: Vec::new(),
        })
    }

    fn open(&mut self, _params: &StartParams, _sink: Arc<Sink>) -> Result<Box<dyn Capturer>, WorkerError> {
        Err(WorkerError::new("UNSUPPORTED_PLATFORM", format!("screen recording is not implemented on {} yet", platform_name())))
    }

    fn now(&self) -> Ns {
        static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
        Ns(START.get_or_init(Instant::now).elapsed().as_nanos() as u64)
    }
}
