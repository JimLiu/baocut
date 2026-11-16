//! 能录的来源。
//!
//! - 屏幕：AppKit 的 `NSScreen.screens`（名字、点尺寸、`backingScaleFactor`；`deviceDescription` 的 `NSScreenNumber`
//!   是 `CGDirectDisplayID`），不需要录屏权限。
//! - 窗口：ScreenCaptureKit 的 `SCShareableContent`。没有录屏权限时取它会引出系统的授权窗口，所以只在
//!   `CGPreflightScreenCaptureAccess` 已经允许时才取，否则窗口列表是空的。位置（`bounds`）由 `SCWindow.frame` 换到所在
//!   屏幕上；前后次序（`order`）取 `CGWindowListCreate` 的顺序（从前到后），窗口表按它排好。
//! - 摄像头、麦克风：`AVCaptureDevice.devicesWithMediaType:`（macOS 14 起的 `AVCaptureDeviceDiscoverySession` 设备种类在
//!   更早的系统上没有，这里用都有的那个）。

use std::collections::HashMap;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2::rc::Retained;
use objc2_app_kit::NSScreen;
use objc2_av_foundation::{AVCaptureDevice, AVMediaTypeAudio, AVMediaTypeVideo};
use objc2_core_foundation::CGRect;
use objc2_core_graphics::{CGDisplayBounds, CGDisplayIsMain, CGWindowListCreate, CGWindowListOption};
use objc2_foundation::{NSError, NSNumber, NSString};
use objc2_screen_capture_kit::SCShareableContent;

use crate::protocol::{Access, Device, Display, Rect, Sources, Window, WindowBounds, WorkerError, sort_windows_front_to_back};

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

fn rect(frame: CGRect) -> Rect {
    Rect { x: frame.origin.x, y: frame.origin.y, width: frame.size.width, height: frame.size.height }
}

/// On-screen window IDs, front to back (`CGWindowListCreate` returns them in z-order, frontmost first). The array holds
/// raw `CGWindowID` values, not CF objects. Needs no screen recording permission.
fn z_order() -> HashMap<u32, usize> {
    let option = CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements;
    let Some(list) = CGWindowListCreate(option, 0) else { return HashMap::new() };
    (0..list.count())
        .map(|index| (unsafe { list.value_at_index(index) } as usize as u32, index as usize))
        .collect()
}

fn windows(displays: &[Display]) -> Vec<Window> {
    let Ok(content) = shareable_content() else { return Vec::new() };
    let own = std::process::id() as i32;
    // Coordinates: `SCWindow.frame` and `CGDisplayBounds` share the CoreGraphics global space — points, origin at the
    // top-left of the main display, y grows downwards, other displays placed around it (negative coordinates allowed).
    // That is the same space as Electron's `screen` display bounds on macOS (DIP = points, primary display at 0,0),
    // so a window's position relative to its display is simply `frame.origin - CGDisplayBounds(display).origin`, and its
    // size is already in points. `NSScreen.frame` is NOT used here: it is bottom-left based with y growing upwards.
    let screens: Vec<(String, Rect)> = displays
        .iter()
        .filter_map(|display| display.id.parse::<u32>().ok().map(|id| (display.id.clone(), rect(CGDisplayBounds(id)))))
        .collect();
    let z = z_order();
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
            let id = window.windowID();
            out.push(Window {
                id: id.to_string(),
                title,
                app: app.map(|app| app.applicationName().to_string()).unwrap_or_default(),
                width: frame.size.width,
                height: frame.size.height,
                bounds: WindowBounds::locate(rect(frame), screens.iter().map(|(id, rect)| (id.as_str(), *rect, 1.0))),
                // 先放全局的名次排序，下面换成表里从 0 起的连续名次。
                order: z.get(&id).map(|index| *index as u32),
            });
        }
    }
    sort_windows_front_to_back(&mut out);
    let mut next = 0;
    for window in &mut out {
        if window.order.is_some() {
            window.order = Some(next);
            next += 1;
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
    let displays = displays(mtm);
    Sources {
        windows: if permissions.screen == Access::Granted { windows(&displays) } else { Vec::new() },
        displays,
        cameras: devices(true),
        microphones: devices(false),
        permissions,
    }
}
