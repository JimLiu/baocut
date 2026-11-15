//! 能录的来源。
//!
//! - 屏幕：AppKit 的 `NSScreen.screens`（名字、点尺寸、`backingScaleFactor`；`deviceDescription` 的 `NSScreenNumber`
//!   是 `CGDirectDisplayID`），不需要录屏权限。
//! - 窗口：ScreenCaptureKit 的 `SCShareableContent`。没有录屏权限时取它会引出系统的授权窗口，所以只在
//!   `CGPreflightScreenCaptureAccess` 已经允许时才取，否则窗口列表是空的。
//! - 摄像头、麦克风：`AVCaptureDevice.devicesWithMediaType:`（macOS 14 起的 `AVCaptureDeviceDiscoverySession` 设备种类在
//!   更早的系统上没有，这里用都有的那个）。

use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2::rc::Retained;
use objc2_app_kit::NSScreen;
use objc2_av_foundation::{AVCaptureDevice, AVMediaTypeAudio, AVMediaTypeVideo};
use objc2_core_graphics::CGDisplayIsMain;
use objc2_foundation::{NSError, NSNumber, NSString};
use objc2_screen_capture_kit::SCShareableContent;

use crate::protocol::{Access, Device, Display, Sources, Window, WorkerError};

use super::permissions;

/// 从 `SCShareableContent` 取一份可录的内容（同步等完成回调）。调用方先确认录屏权限已经允许。
pub fn shareable_content() -> Result<Retained<SCShareableContent>, WorkerError> {
    struct Reply(Result<Retained<SCShareableContent>, String>);
    // SAFETY: 回调里拿到的对象只交给等待的线程，回调本身之后不再碰它。
    unsafe impl Send for Reply {}
    let (tx, rx) = mpsc::sync_channel::<Reply>(1);
    let block = RcBlock::new(move |content: *mut SCShareableContent, error: *mut NSError| {
        let reply = match unsafe { Retained::retain(content) } {
            Some(content) => Ok(content),
            None => Err(unsafe { error.as_ref() }.map_or_else(|| "no shareable content".to_owned(), |e| e.localizedDescription().to_string())),
        };
        let _ = tx.try_send(Reply(reply));
    });
    unsafe { SCShareableContent::getShareableContentWithCompletionHandler(&block) };
    match rx.recv_timeout(Duration::from_secs(15)) {
        Ok(Reply(Ok(content))) => Ok(content),
        Ok(Reply(Err(message))) => Err(WorkerError::new("CAPTURE_UNAVAILABLE", format!("ScreenCaptureKit: {message}"))),
        Err(_) => Err(WorkerError::new("CAPTURE_UNAVAILABLE", "ScreenCaptureKit did not list the shareable content in time")),
    }
}

fn displays(mtm: MainThreadMarker) -> Vec<Display> {
    let mut out = Vec::new();
    for screen in NSScreen::screens(mtm).iter() {
        let description = screen.deviceDescription();
        let Some(number) = description.objectForKey(&NSString::from_str("NSScreenNumber")) else { continue };
        let Ok(number) = number.downcast::<NSNumber>() else { continue };
        let id = number.unsignedIntValue();
        let frame = screen.frame();
        let scale = screen.backingScaleFactor();
        out.push(Display {
            id: id.to_string(),
            name: screen.localizedName().to_string(),
            width: frame.size.width,
            height: frame.size.height,
            scale,
            primary: CGDisplayIsMain(id),
        });
    }
    out
}

fn windows() -> Vec<Window> {
    let Ok(content) = shareable_content() else { return Vec::new() };
    let own = std::process::id() as i32;
    let mut out = Vec::new();
    for window in unsafe { content.windows() }.iter() {
        unsafe {
            // 普通应用窗口（第 0 层）、在屏幕上、有标题、不太小；不列自己。
            if window.windowLayer() != 0 || !window.isOnScreen() {
                continue;
            }
            let Some(title) = window.title().map(|t| t.to_string()).filter(|t| !t.is_empty()) else { continue };
            let frame = window.frame();
            if frame.size.width < 40.0 || frame.size.height < 40.0 {
                continue;
            }
            let app = window.owningApplication();
            if app.as_ref().is_some_and(|app| app.processID() == own) {
                continue;
            }
            out.push(Window {
                id: window.windowID().to_string(),
                title,
                app: app.map(|app| app.applicationName().to_string()).unwrap_or_default(),
                width: frame.size.width,
                height: frame.size.height,
            });
        }
    }
    out
}

#[allow(deprecated)]
fn devices(video: bool) -> Vec<Device> {
    let kind = if video { unsafe { AVMediaTypeVideo } } else { unsafe { AVMediaTypeAudio } };
    let Some(kind) = kind else { return Vec::new() };
    let default = unsafe { AVCaptureDevice::defaultDeviceWithMediaType(kind) }.map(|device| unsafe { device.uniqueID() }.to_string());
    unsafe { AVCaptureDevice::devicesWithMediaType(kind) }
        .iter()
        .map(|device| {
            let id = unsafe { device.uniqueID() }.to_string();
            Device { default: Some(default.as_deref() == Some(id.as_str())), name: unsafe { device.localizedName() }.to_string(), id }
        })
        .collect()
}

/// `default` 或设备 ID 换成设备；找不到是 None。
#[allow(deprecated)]
pub fn capture_device(video: bool, id: &str) -> Option<Retained<AVCaptureDevice>> {
    let kind = if video { unsafe { AVMediaTypeVideo } } else { unsafe { AVMediaTypeAudio } }?;
    if id == "default" {
        return unsafe { AVCaptureDevice::defaultDeviceWithMediaType(kind) };
    }
    unsafe { AVCaptureDevice::deviceWithUniqueID(&NSString::from_str(id)) }
}

pub fn sources(mtm: MainThreadMarker) -> Sources {
    let permissions = permissions::all();
    Sources {
        displays: displays(mtm),
        windows: if permissions.screen == Access::Granted { windows() } else { Vec::new() },
        cameras: devices(true),
        microphones: devices(false),
        permissions,
    }
}
