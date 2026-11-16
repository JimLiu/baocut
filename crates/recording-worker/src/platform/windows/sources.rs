//! 能录的来源与权限状态。只问状态，不触发系统的提示。
//!
//! - 显示器：`EnumDisplayMonitors` + `GetMonitorInfoW`（`MONITORINFOEXW`：物理像素的范围、设备名 `\\.\DISPLAYn`、
//!   是不是主显示器）；缩放比例是 `GetDpiForMonitor(MDT_EFFECTIVE_DPI)` ÷ 96；名字取 `EnumDisplayDevicesW` 对这个设备名
//!   的第一个显示器的 `DeviceString`，取不到时用设备名。ID 是设备名（这次登录里不变）。宽高报逻辑单位（÷ 缩放比例）。
//! - 窗口：`EnumWindows`，留可见、没被 DWM 隐藏（`DWMWA_CLOAKED`，例如别的虚拟桌面上的窗口）、不是工具窗口、没有
//!   所有者、有标题、不太小、不属于自己的顶层窗口；大小取 `DWMWA_EXTENDED_FRAME_BOUNDS`（不含阴影）。ID 是窗口句柄的
//!   十进制值，应用名是进程映像文件名去掉 `.exe`。`EnumWindows` 按 Z 序从前到后给出窗口，`order` 就是表里的名次；
//!   `bounds` 是那个范围换到相交最多的显示器上（最小化的窗口不给）。
//! - 摄像头见 [`super::camera`]，麦克风见 [`super::audio`]。
//! - 权限：
//!   - 屏幕：Windows 没有桌面应用的录屏权限；`GraphicsCaptureSession::IsSupported` 为真时报 `granted`，否则 `restricted`。
//!   - 摄像头、麦克风：「设置 › 隐私和安全性」里的开关，`AppCapability::Create("webcam" / "microphone").CheckAccess()`
//!     （Windows.Security.Authorization.AppCapabilityAccess，Windows 10 1809 起）。对没有打包的桌面程序它回答什么，
//!     文档没有写明，待实机核实；调用失败时报 `unknown`。
//!   - 输入监控：Windows 没有对应的权限（低级键盘钩子不需要授权），报 `granted`。权限更高的窗口（管理员运行）里的按键
//!     收不到（UIPI），这不是权限状态能表达的。

use windows::Graphics::Capture::GraphicsCaptureSession;
use windows::Security::Authorization::AppCapabilityAccess::{AppCapability, AppCapabilityAccessStatus};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute};
use windows::Win32::Graphics::Gdi::{
    DISPLAY_DEVICEW, EnumDisplayDevicesW, EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITOR_DEFAULTTONEAREST,
    MONITORINFO, MONITORINFOEXW, MonitorFromWindow,
};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GW_OWNER, GWL_EXSTYLE, GetWindow, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    IsIconic, IsWindowVisible, MONITORINFOF_PRIMARY, WS_EX_TOOLWINDOW,
};
use windows_core::{BOOL, HSTRING, PCWSTR, PWSTR};

use crate::protocol::{Access, Display, Permissions, Rect, Sources, Window, WindowBounds};

use super::com::{from_wide, wide};

/// 一块显示器：句柄、ID（设备名）、物理像素的范围、缩放比例。
#[derive(Clone)]
pub struct Monitor {
    pub handle: HMONITOR,
    pub id: String,
    pub name: String,
    pub rect: RECT,
    pub scale: f64,
    pub primary: bool,
}

impl Monitor {
    pub fn width(&self) -> u32 {
        (self.rect.right - self.rect.left).max(0) as u32
    }

    pub fn height(&self) -> u32 {
        (self.rect.bottom - self.rect.top).max(0) as u32
    }
}

pub fn monitors() -> Vec<Monitor> {
    unsafe extern "system" fn collect(handle: HMONITOR, _dc: HDC, _rect: *mut RECT, data: LPARAM) -> BOOL {
        let list = unsafe { &mut *(data.0 as *mut Vec<HMONITOR>) };
        list.push(handle);
        BOOL(1)
    }
    let mut handles: Vec<HMONITOR> = Vec::new();
    let _ = unsafe { EnumDisplayMonitors(None, None, Some(collect), LPARAM(&mut handles as *mut _ as isize)) };
    handles.into_iter().filter_map(monitor).collect()
}

pub fn monitor(handle: HMONITOR) -> Option<Monitor> {
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if !unsafe { GetMonitorInfoW(handle, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO) }.as_bool() {
        return None;
    }
    let id = from_wide(&info.szDevice);
    let (mut dpi_x, mut dpi_y) = (96u32, 96u32);
    let scale = match unsafe { GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) } {
        Ok(()) if dpi_x > 0 => f64::from(dpi_x) / 96.0,
        _ => 1.0,
    };
    let mut device = DISPLAY_DEVICEW { cb: std::mem::size_of::<DISPLAY_DEVICEW>() as u32, ..Default::default() };
    let device_name = wide(&id);
    let name = if unsafe { EnumDisplayDevicesW(PCWSTR(device_name.as_ptr()), 0, &mut device, 0) }.as_bool() {
        Some(from_wide(&device.DeviceString)).filter(|name| !name.is_empty())
    } else {
        None
    };
    Some(Monitor {
        handle,
        name: name.unwrap_or_else(|| id.clone()),
        id,
        rect: info.monitorInfo.rcMonitor,
        scale,
        primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
    })
}

/// 按 ID 找显示器；没有 ID 时是主显示器。
pub fn find_monitor(id: Option<&str>) -> Option<Monitor> {
    let all = monitors();
    match id {
        Some(id) => all.into_iter().find(|monitor| monitor.id == id),
        None => {
            let primary = all.iter().position(|monitor| monitor.primary).unwrap_or(0);
            all.into_iter().nth(primary)
        }
    }
}

/// 窗口所在的显示器（跨屏时取占得最多的那块）。
pub fn monitor_of(window: HWND) -> Option<Monitor> {
    monitor(unsafe { MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST) })
}

/// 窗口在屏幕上可见的范围（物理像素，不含阴影）。
pub fn window_frame(window: HWND) -> Option<RECT> {
    let mut rect = RECT::default();
    unsafe {
        DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, &mut rect as *mut RECT as *mut _, std::mem::size_of::<RECT>() as u32)
    }
    .ok()?;
    (rect.right > rect.left && rect.bottom > rect.top).then_some(rect)
}

fn is_cloaked(window: HWND) -> bool {
    let mut cloaked = 0u32;
    unsafe { DwmGetWindowAttribute(window, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, std::mem::size_of::<u32>() as u32) }
        .is_ok_and(|()| cloaked != 0)
}

fn window_title(window: HWND) -> String {
    let length = unsafe { GetWindowTextLengthW(window) };
    if length <= 0 {
        return String::new();
    }
    let mut buffer = vec![0u16; length as usize + 1];
    let copied = unsafe { GetWindowTextW(window, &mut buffer) };
    String::from_utf16_lossy(&buffer[..copied.max(0) as usize])
}

fn process_name(pid: u32) -> String {
    let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else { return String::new() };
    let mut buffer = [0u16; 1024];
    let mut size = buffer.len() as u32;
    let path = match unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut size) } {
        Ok(()) => String::from_utf16_lossy(&buffer[..size as usize]),
        Err(_) => String::new(),
    };
    let _ = unsafe { CloseHandle(process) };
    std::path::Path::new(&path).file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default()
}

/// 可选的顶层窗口。
pub fn windows() -> Vec<Window> {
    unsafe extern "system" fn collect(window: HWND, data: LPARAM) -> BOOL {
        let list = unsafe { &mut *(data.0 as *mut Vec<HWND>) };
        list.push(window);
        BOOL(1)
    }
    let mut handles: Vec<HWND> = Vec::new();
    let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut handles as *mut _ as isize)) };
    let own = std::process::id();
    // Coordinates: the process is per-monitor DPI aware (v2), so window frames and monitor rects are physical pixels on
    // the virtual desktop. A window's position relative to its monitor, in logical units (what Electron's `screen`
    // calls DIP), is `(frame.origin - monitor.rect.origin) / monitor.scale`; its size is `frame.size / monitor.scale`.
    let screens: Vec<(String, Rect, f64)> = monitors()
        .into_iter()
        .map(|monitor| {
            let rect = Rect {
                x: f64::from(monitor.rect.left),
                y: f64::from(monitor.rect.top),
                width: f64::from(monitor.width()),
                height: f64::from(monitor.height()),
            };
            (monitor.id, rect, monitor.scale)
        })
        .collect();
    let mut out = Vec::new();
    for window in handles {
        if !unsafe { IsWindowVisible(window) }.as_bool() || is_cloaked(window) {
            continue;
        }
        let style = unsafe { GetWindowLongW(window, GWL_EXSTYLE) } as u32;
        if style & WS_EX_TOOLWINDOW.0 != 0 {
            continue;
        }
        if unsafe { GetWindow(window, GW_OWNER) }.is_ok_and(|owner| !owner.is_invalid()) {
            continue;
        }
        let title = window_title(window);
        if title.is_empty() {
            continue;
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(window, Some(&mut pid)) };
        if pid == own {
            continue;
        }
        let Some(frame) = window_frame(window) else { continue };
        let scale = monitor_of(window).map_or(1.0, |monitor| monitor.scale);
        let width = f64::from(frame.right - frame.left) / scale;
        let height = f64::from(frame.bottom - frame.top) / scale;
        if width < 40.0 || height < 40.0 {
            continue;
        }
        let bounds = if unsafe { IsIconic(window) }.as_bool() {
            None
        } else {
            let frame = Rect {
                x: f64::from(frame.left),
                y: f64::from(frame.top),
                width: f64::from(frame.right - frame.left),
                height: f64::from(frame.bottom - frame.top),
            };
            WindowBounds::locate(frame, screens.iter().map(|(id, rect, scale)| (id.as_str(), *rect, *scale)))
        };
        let order = Some(out.len() as u32);
        out.push(Window { id: (window.0 as usize).to_string(), title, app: process_name(pid), width, height, bounds, order });
    }
    out
}

/// 窗口 ID（句柄的十进制值）换回句柄。
pub fn parse_window(id: &str) -> Option<HWND> {
    id.parse::<usize>().ok().filter(|value| *value != 0).map(|value| HWND(value as *mut _))
}

fn displays() -> Vec<Display> {
    monitors()
        .into_iter()
        .map(|monitor| Display {
            width: f64::from(monitor.width()) / monitor.scale,
            height: f64::from(monitor.height()) / monitor.scale,
            scale: monitor.scale,
            primary: monitor.primary,
            name: monitor.name,
            id: monitor.id,
        })
        .collect()
}

fn capability_access(name: &str) -> Access {
    let status = AppCapability::Create(&HSTRING::from(name)).and_then(|capability| capability.CheckAccess());
    match status {
        Ok(AppCapabilityAccessStatus::Allowed) => Access::Granted,
        Ok(AppCapabilityAccessStatus::DeniedByUser) => Access::Denied,
        Ok(AppCapabilityAccessStatus::DeniedBySystem) => Access::Restricted,
        Ok(AppCapabilityAccessStatus::UserPromptRequired) => Access::NotDetermined,
        _ => Access::Unknown,
    }
}

pub fn permissions() -> Permissions {
    let screen = match GraphicsCaptureSession::IsSupported() {
        Ok(true) => Access::Granted,
        Ok(false) => Access::Restricted,
        Err(_) => Access::Unknown,
    };
    Permissions {
        screen,
        camera: capability_access("webcam"),
        microphone: capability_access("microphone"),
        input_monitoring: Access::Granted,
    }
}

pub fn sources() -> Sources {
    Sources {
        permissions: permissions(),
        displays: displays(),
        windows: windows(),
        cameras: super::camera::list(),
        microphones: super::audio::list_microphones(),
    }
}
