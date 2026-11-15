//! 系统权限的状态，只问不申请（不弹授权窗口）：
//!
//! - 屏幕：`CGPreflightScreenCaptureAccess`（CoreGraphics `CGWindow.h`）。它只回答「已经允许」或「没有」，分不出
//!   「拒绝过」与「还没问过」；没有允许时报 `not-determined`，真正开始采集时由系统决定弹窗还是拒绝。
//! - 摄像头、麦克风：`AVCaptureDevice.authorizationStatusForMediaType:`（四种状态一一对应）。
//! - 输入监控（只在录键盘时要）：IOKit 的 `IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)`（`IOHIDLib.h`）。

use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio, AVMediaTypeVideo};
use objc2_core_graphics::CGPreflightScreenCaptureAccess;

use crate::protocol::{Access, Permissions};

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOHIDCheckAccess(request: u32) -> u32;
}

/// `kIOHIDRequestTypeListenEvent`。
const IOHID_REQUEST_LISTEN_EVENT: u32 = 1;

pub fn screen() -> Access {
    if CGPreflightScreenCaptureAccess() { Access::Granted } else { Access::NotDetermined }
}

fn media(video: bool) -> Access {
    let kind = if video { unsafe { AVMediaTypeVideo } } else { unsafe { AVMediaTypeAudio } };
    let Some(kind) = kind else { return Access::Unknown };
    match unsafe { AVCaptureDevice::authorizationStatusForMediaType(kind) } {
        AVAuthorizationStatus::Authorized => Access::Granted,
        AVAuthorizationStatus::Denied => Access::Denied,
        AVAuthorizationStatus::Restricted => Access::Restricted,
        AVAuthorizationStatus::NotDetermined => Access::NotDetermined,
        _ => Access::Unknown,
    }
}

pub fn camera() -> Access {
    media(true)
}

pub fn microphone() -> Access {
    media(false)
}

pub fn input_monitoring() -> Access {
    // kIOHIDAccessTypeGranted = 0, kIOHIDAccessTypeDenied = 1, kIOHIDAccessTypeUnknown = 2。
    match unsafe { IOHIDCheckAccess(IOHID_REQUEST_LISTEN_EVENT) } {
        0 => Access::Granted,
        1 => Access::Denied,
        2 => Access::NotDetermined,
        _ => Access::Unknown,
    }
}

pub fn all() -> Permissions {
    Permissions { screen: screen(), camera: camera(), microphone: microphone(), input_monitoring: input_monitoring() }
}
