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
