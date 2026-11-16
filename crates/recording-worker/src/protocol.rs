//! Runtime 与 Recording Worker 之间的私有协议（屏幕录制设计 §7）。TypeScript 一侧的同名形状在
//! `packages/runtime-core/src/recordings/worker-protocol.ts`；两边都读 `tests/fixtures/protocol.json`，防止各改各的。
//!
//! 帧：请求 `{id, method, params}`，响应 `{id, result}` / `{id, error: {code, message}}`，推送 `{event, params}`。
//! 时刻是系统单调时钟上的纳秒，写成十进制字符串（[`Ns`]）。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 协议版本：`hello` 报给 Runtime，对不上时 Runtime 不用这个 Worker。
pub const PROTOCOL_VERSION: u32 = 1;

/// 单调时钟上的纳秒，JSON 里是十进制字符串（JavaScript 的数字装不下）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Ns(pub u64);

impl Serialize for Ns {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0.to_string())
    }
}

impl<'de> Deserialize<'de> for Ns {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        if text.is_empty() || text.len() > 20 || !text.bytes().all(|b| b.is_ascii_digit()) {
            return Err(serde::de::Error::custom("expected a decimal nanosecond string"));
        }
        text.parse().map(Ns).map_err(serde::de::Error::custom)
    }
}

#[derive(Deserialize, Debug)]
pub struct Request {
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

/// 请求失败：`code` 是给 Runtime 分支用的稳定代码，`message` 是给日志看的英文说明。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct WorkerError {
    pub code: String,
    pub message: String,
}

impl WorkerError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_owned(), message: message.into() }
    }
}

impl std::fmt::Display for WorkerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for WorkerError {}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Capability {
    pub supported: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reason: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct HelloResult {
    pub protocol: u32,
    pub version: String,
    pub platform: String,
    pub capture: Capability,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Access {
    Granted,
    Denied,
    NotDetermined,
    Restricted,
    Unknown,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    pub screen: Access,
    pub camera: Access,
    pub microphone: Access,
    pub input_monitoring: Access,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Display {
    pub id: String,
    pub name: String,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    pub primary: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Window {
    pub id: String,
    pub title: String,
    pub app: String,
    pub width: f64,
    pub height: f64,
    /// 窗口此刻在屏幕上的位置（逻辑点，相对所在屏幕的左上角）与所在屏幕；问不出时没有。后加的可选字段。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bounds: Option<WindowBounds>,
    /// 窗口从前到后的次序（0 在最前）；问不出时没有。`sources` 的窗口表按它排好。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub order: Option<u32>,
}

/// 窗口所在的屏幕（[`Display::id`]）与相对那块屏幕左上角的位置（逻辑点）；跨屏时是相交面积最大的那块，坐标可以为负或越界。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub display_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl WindowBounds {
    /// 在一组屏幕里给窗口定位。`frame` 与每块屏幕的 `rect` 在同一个全局坐标系里（macOS 是全局的点，Windows 是虚拟桌面的
    /// 物理像素），`scale` 是那块屏幕的全局单位到逻辑点的比例（macOS 传 1）。取相交面积最大的屏幕；与哪块都不相交时 None。
    pub fn locate<'a>(frame: Rect, displays: impl IntoIterator<Item = (&'a str, Rect, f64)>) -> Option<WindowBounds> {
        let area = |display: &Rect| {
            let width = (frame.x + frame.width).min(display.x + display.width) - frame.x.max(display.x);
            let height = (frame.y + frame.height).min(display.y + display.height) - frame.y.max(display.y);
            if width > 0.0 && height > 0.0 { width * height } else { 0.0 }
        };
        let mut best: Option<(&str, Rect, f64, f64)> = None;
        for (id, rect, scale) in displays {
            let overlap = area(&rect);
            if overlap > 0.0 && best.is_none_or(|(_, _, _, top)| overlap > top) {
                best = Some((id, rect, scale, overlap));
            }
        }
        let (id, rect, scale, _) = best?;
        let scale = if scale > 0.0 { scale } else { 1.0 };
        Some(WindowBounds {
            display_id: id.to_owned(),
            x: (frame.x - rect.x) / scale,
            y: (frame.y - rect.y) / scale,
            width: frame.width / scale,
            height: frame.height / scale,
        })
    }
}

/// 按 `order` 从前到后排；没有次序的排在最后，彼此保持原来的先后。
pub fn sort_windows_front_to_back(windows: &mut [Window]) {
    windows.sort_by_key(|window| window.order.unwrap_or(u32::MAX));
}

#[cfg(test)]
mod window_bounds_tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect { x, y, width, height }
    }

    #[test]
    fn picks_the_display_with_the_largest_overlap() {
        // 主屏 1512×982 在 (0,0)，副屏 1920×1080 在右边 (1512,-200)。窗口大半在副屏上。
        let displays = [("1", rect(0.0, 0.0, 1512.0, 982.0), 1.0), ("2", rect(1512.0, -200.0, 1920.0, 1080.0), 1.0)];
        let bounds = WindowBounds::locate(rect(1400.0, 100.0, 800.0, 600.0), displays).unwrap();
        assert_eq!(bounds, WindowBounds { display_id: "2".into(), x: -112.0, y: 300.0, width: 800.0, height: 600.0 });
    }

    #[test]
    fn negative_and_overflowing_coordinates_stay_relative() {
        let displays = [("1", rect(0.0, 0.0, 1000.0, 800.0), 1.0)];
        let bounds = WindowBounds::locate(rect(-50.0, -20.0, 1200.0, 300.0), displays).unwrap();
        assert_eq!(bounds, WindowBounds { display_id: "1".into(), x: -50.0, y: -20.0, width: 1200.0, height: 300.0 });
    }

    #[test]
    fn scale_turns_physical_pixels_into_logical_points() {
        // Windows：副屏在虚拟桌面 (2560,0)，缩放 1.5。
        let displays = [("\\\\.\\DISPLAY1", rect(0.0, 0.0, 2560.0, 1440.0), 1.0), ("\\\\.\\DISPLAY2", rect(2560.0, 0.0, 1920.0, 1080.0), 1.5)];
        let bounds = WindowBounds::locate(rect(2710.0, 300.0, 900.0, 600.0), displays).unwrap();
        assert_eq!(bounds, WindowBounds { display_id: "\\\\.\\DISPLAY2".into(), x: 100.0, y: 200.0, width: 600.0, height: 400.0 });
    }

    #[test]
    fn no_overlap_has_no_bounds() {
        let displays = [("1", rect(0.0, 0.0, 1000.0, 800.0), 1.0)];
        assert_eq!(WindowBounds::locate(rect(-32000.0, -32000.0, 160.0, 28.0), displays), None);
        assert_eq!(WindowBounds::locate(rect(10.0, 10.0, 100.0, 100.0), []), None);
    }

    #[test]
    fn sorts_front_to_back_with_unknown_last() {
        let window = |id: &str, order: Option<u32>| Window {
            id: id.into(),
            title: id.into(),
            app: String::new(),
            width: 100.0,
            height: 100.0,
            bounds: None,
            order,
        };
        let mut windows = vec![window("a", None), window("b", Some(1)), window("c", Some(0)), window("d", None)];
        sort_windows_front_to_back(&mut windows);
        let ids: Vec<&str> = windows.iter().map(|w| w.id.as_str()).collect();
        assert_eq!(ids, ["c", "b", "a", "d"]);
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Device {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub default: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Sources {
    pub permissions: Permissions,
    pub displays: Vec<Display>,
    pub windows: Vec<Window>,
    pub cameras: Vec<Device>,
    pub microphones: Vec<Device>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum Source {
    Display {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        display_id: Option<String>,
    },
    Window {
        window_id: String,
    },
    Area {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        display_id: Option<String>,
        rect: Rect,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CursorMode {
    Separate,
    Baked,
    None,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum KeysMode {
    Off,
    Shortcuts,
    All,
}

/// `start` 的参数：录制目录与 Runtime 已经解析过的选项（`microphone` 是设备 ID 或 `default`）。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StartParams {
    pub dir: String,
    pub source: Source,
    pub camera: Option<String>,
    pub microphone: Option<String>,
    pub system_audio: bool,
    pub cursor: CursorMode,
    pub keys: KeysMode,
    pub fps: u32,
    /// 整屏与区域录制时不录进画面的应用。后加的可选字段，协议版本不变：旧的 Runtime 不发，缺省什么都不排除；选窗口时不起作用。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclude: Option<Exclusion>,
}

/// 按 bundle id 或进程 ID 认的应用（ScreenCaptureKit 的 `SCRunningApplication`）。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Exclusion {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bundle_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pids: Vec<i32>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureKind {
    Display,
    Window,
    Area,
}

/// 捕获画面：像素尺寸与每点的像素数。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Capture {
    pub kind: CaptureKind,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StartResult {
    pub segment_id: String,
    pub at_ns: Ns,
    /// 实际的鼠标模式：拿不到不带光标的画面或光标图片时从 `separate` 退到 `baked`。
    pub cursor: CursorMode,
    pub capture: Capture,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SegmentResult {
    pub segment_id: String,
    pub at_ns: Ns,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct StopResult {
    pub journal: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    Screen,
    Camera,
    Microphone,
    SystemAudio,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Screen => "screen",
            Role::Camera => "camera",
            Role::Microphone => "microphone",
            Role::SystemAudio => "system-audio",
        }
    }

    pub fn is_video(self) -> bool {
        matches!(self, Role::Screen | Role::Camera)
    }

    /// 这一路在录制目录里的文件名（`s1-screen.mp4`）。
    pub fn file_name(self, segment: &str) -> String {
        format!("{segment}-{}.{}", self.as_str(), if self.is_video() { "mp4" } else { "m4a" })
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "event", content = "params", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum WorkerEvent {
    /// 一路流的第一个样本到了。
    Stream { role: Role, segment_id: String, start_ns: Ns },
    /// 设备中途断开：这一路在这一段里从此没有内容。
    DeviceLost { role: Role, segment_id: String, at_ns: Ns },
    DiskLow { free_bytes: u64 },
    /// 采集中途失败（不是某个请求的错误）。
    Failed { code: String, message: String },
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Recorder {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub revision: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Hotspot {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct DeviceRef {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub name: Option<String>,
}

/// `journal.jsonl` 的一行。Runtime 收尾时只读这份日志：正常停止与崩溃之后的恢复是同一条路径。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum JournalLine {
    Begin {
        recorder: Recorder,
        platform: String,
        started_at: String,
        cursor: CursorMode,
        /// `shortcuts` 或 `all`；不录键盘是 null。
        keyboard: Option<KeysMode>,
        capture: Capture,
    },
    Segment {
        id: String,
        start_ns: Ns,
    },
    SegmentEnd {
        id: String,
        end_ns: Ns,
    },
    Stream {
        role: Role,
        segment_id: String,
        file: String,
        start_ns: Ns,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        device: Option<DeviceRef>,
    },
    StreamEnd {
        role: Role,
        segment_id: String,
        end_ns: Ns,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        lost: Option<bool>,
    },
    Pointer {
        segment_id: String,
        file: String,
    },
    Keys {
        segment_id: String,
        file: String,
    },
    Cursor {
        id: String,
        file: String,
        hotspot: Hotspot,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        scale: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        shape: Option<String>,
    },
}
