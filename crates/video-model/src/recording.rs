//! 录制清单的正文（视频格式规范 §4.7，文档 `kind: 'recording'`）：一次录制产生了哪几路流、各自是哪个素材版本、
//! 怎样落到统一的录制时间上。清单记的是录下来的事实，写好之后不再修改；剪辑、布局与取景是别处的编辑意图。
//!
//! 录制时间（`clock: 'recording'`）从 0 开始，暂停的时间不计入。一路流的素材源时间 `s` 对应录制时间 `start + s`。

use std::collections::{BTreeMap, BTreeSet};

use message_ref::{Text, msg};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::key_track::KEY_TRACK_MEDIA_TYPE;
use crate::pointer_track::POINTER_TRACK_MEDIA_TYPE;
use crate::{AssetKind, AssetRecord, Id, VersionRef};

pub const RECORDING_SCHEMA: &str = "baocut.recording/1";
pub const RECORDING_KIND: &str = "recording";
/// 录制时间：清单定义的时钟（§4.6 的 `clock`）。
pub const CLOCK_RECORDING: &str = "recording";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingBody {
    /// `baocut.recording/1`。
    pub schema: String,
    /// 每秒的刻度数。清单里的时刻都是它的整数刻度，写成十进制字符串。
    pub timescale: u64,
    /// `recording`。
    pub clock: String,
    pub recorder: Recorder,
    /// 录制所在的平台：`macos`、`windows`、`linux`……（开放）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    /// 开始录制的时刻，RFC 3339。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    /// 有效录制长度（不含暂停）。
    pub duration: String,
    /// 按 `t0` 排序、首尾相接，铺满 `[0, duration)`。每次暂停后恢复是新的一段。
    pub segments: Vec<RecordingSegment>,
    pub streams: Vec<RecordingStream>,
    pub pointer: RecordingPointer,
    /// 键盘录了什么；有 `keyboard` 流时必须有，没有时不能有。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyboard: Option<RecordingKeyboard>,
}

/// 键盘轨录下的范围（§4.7）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingKeyboard {
    pub scope: KeyboardScope,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyboardScope {
    /// 只有快捷键与功能键：按着 Control、Alt 或 Meta 时的按键，以及不产生字符的键。打出来的字不在里面。
    Shortcuts,
    /// 全部按键，包括打出来的字。
    All,
}

/// 录制后端与导入器：哪个程序录的、哪个程序把它写成清单。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recorder {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// 后端的源码版本（提交）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    /// 把别的录制程序的产物写成清单的导入器与它的版本；BaoCut 自己录的没有。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub importer: Option<String>,
}

/// 一段连续的录制：录制时间上的 `[t0, t1)`。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSegment {
    pub id: String,
    pub t0: String,
    pub t1: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StreamRole {
    Screen,
    Camera,
    Microphone,
    SystemAudio,
    /// 指针轨（§4.8）：鼠标的位置、按键与光标外观。
    Pointer,
    /// 键盘轨（§4.10）：按键的按下与抬起。
    Keyboard,
}

/// 一路流在一段里的素材。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStream {
    pub id: String,
    pub role: StreamRole,
    pub segment_id: String,
    pub asset_ref: VersionRef,
    /// 素材源时间 0 落在录制时间的哪一刻（带符号的整数刻度）：比这一段早开始的流是负的偏移。
    pub start: String,
    /// 录制时间上真正有内容的区间，按 `t0` 排序、互不重叠，落在所在的段里。省略时是素材全长与所在段的交集。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coverage: Option<Vec<TickRange>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device: Option<StreamDevice>,
    /// 捕获的画面，只用于 `screen`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capture: Option<Capture>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TickRange {
    pub t0: String,
    pub t1: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamDevice {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureKind {
    Display,
    Window,
    Area,
}

/// 屏幕流捕获的是什么：整块屏幕、一个窗口或一块区域，以及捕获画面的像素尺寸。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub kind: CaptureKind,
    /// 捕获画面的像素宽高（已摆正）。
    pub width: u32,
    pub height: u32,
    /// 一个逻辑点是几个像素（Retina、Windows 的缩放）；不知道时省略。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PointerMode {
    /// 屏幕画面里没有光标，光标按指针轨另画。
    Separate,
    /// 光标已经录在屏幕画面里：指针轨只用来驱动取景，不能隐藏或替换光标。
    Baked,
    /// 画面里没有光标，也没有指针轨。
    None,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingPointer {
    pub mode: PointerMode,
    /// 光标外观，只在 `separate` 时有；指针轨的 `cursors` 按 `id` 引用。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cursors: Vec<PointerCursor>,
}

/// 一种光标外观：一张图片与它的热点。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointerCursor {
    pub id: String,
    pub asset_ref: VersionRef,
    /// 热点在图片里的位置，图片宽高的比例，各在 [0, 1]。
    pub hotspot: Hotspot,
    /// 图片的几个像素对应捕获画面的一个像素，缺省 1。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
    /// 系统光标的名字（`arrow`、`ibeam`、`pointing-hand`……），开放；认不出的照常按图片画。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Hotspot {
    pub x: f64,
    pub y: f64,
}

/// 整数刻度（十进制字符串）；不是整数或超出安全整数时为 `None`。
pub(crate) fn ticks(text: &str) -> Option<i128> {
    let value = text.parse::<i128>().ok()?;
    (value.abs() <= editor_semantics::MAX_SAFE_INTEGER).then_some(value)
}

pub(crate) fn timescale_ok(timescale: u64) -> bool {
    timescale != 0 && timescale <= editor_semantics::MAX_SAFE_INTEGER as u64
}

pub(crate) fn field_invalid(field: impl Into<String>, rule: &str) -> Text {
    msg!("videoModel.fieldInvalid", "{field} is not valid: {rule}", field = field.into(), rule)
}

pub(crate) fn field_range(field: impl Into<String>, range: &str) -> Text {
    msg!("videoModel.fieldRange", "{field} must be within {range}", field = field.into(), range)
}

pub(crate) fn ids_repeated(field: &str) -> Text {
    msg!("videoModel.idsRepeated", "IDs are repeated in {field}", field)
}

/// 一串区间 `[t0, t1)`：整数刻度、`lower ≤ t0 < t1`、按 `t0` 排序、互不重叠（贴边允许）。返回读得出的区间。
pub(crate) fn check_ranges<'a>(
    field: &str,
    ranges: impl Iterator<Item = (&'a str, &'a str)>,
    lower: i128,
    problems: &mut Vec<Text>,
) -> Vec<(i128, i128)> {
    let mut out = Vec::new();
    let mut previous: Option<i128> = None;
    for (index, (t0, t1)) in ranges.enumerate() {
        let at = format!("{field}[{index}]");
        let (Some(t0), Some(t1)) = (ticks(t0), ticks(t1)) else {
            problems.push(msg!("videoModel.ticksInvalid", "{field} must be integer ticks", field = at));
            continue;
        };
        if t0 < lower || t1 <= t0 {
            problems.push(msg!("videoModel.rangeInvalid", "{field} must satisfy 0 ≤ t0 < t1", field = at));
            continue;
        }
        if previous.is_some_and(|end| t0 < end) {
            problems.push(msg!(
                "videoModel.rangeOrder",
                "{field} overlaps the previous range or is not sorted by t0",
                field = at
            ));
        }
        previous = Some(t1);
        out.push((t0, t1));
    }
    out
}

pub(crate) fn has_repeats<'a>(ids: impl Iterator<Item = &'a str>) -> bool {
    let mut seen = BTreeSet::new();
    ids.into_iter().any(|id| !seen.insert(id))
}

fn parse(body: &Value) -> Result<RecordingBody, Text> {
    serde_json::from_value::<RecordingBody>(body.clone())
        .map_err(|error| msg!("videoModel.bodyShape", "The body has fields of the wrong shape: {error}", error = error.to_string()))
}

/// 正文与 §4.7 不合的地方（空表示合）。素材在不在、种类对不对由 [`recording_resource_problems`] 查。
pub fn recording_body_problems(body: &Value) -> Vec<Text> {
    let parsed = match parse(body) {
        Ok(parsed) => parsed,
        Err(problem) => return vec![problem],
    };
    let mut problems = Vec::new();
    if parsed.schema != RECORDING_SCHEMA {
        problems.push(msg!("videoModel.schemaMismatch", "schema must be {schema}", schema = RECORDING_SCHEMA));
    }
    if parsed.clock != CLOCK_RECORDING {
        problems.push(msg!("videoModel.clockOneOf", "clock must be one of: {clocks}", clocks = CLOCK_RECORDING));
    }
    if !timescale_ok(parsed.timescale) {
        problems.push(msg!("videoModel.timescaleSafeInteger", "timescale must be a positive safe integer"));
        return problems;
    }
    if parsed.recorder.name.trim().is_empty() {
        problems.push(field_invalid("recorder.name", "empty"));
    }

    // 段：从 0 起首尾相接，铺满整个录制。
    let duration = ticks(&parsed.duration).filter(|d| *d > 0);
    if duration.is_none() {
        problems.push(field_invalid("duration", "positive-integer-ticks"));
    }
    if parsed.segments.is_empty() {
        problems.push(field_invalid("segments", "empty"));
    }
    if parsed.segments.iter().any(|s| s.id.is_empty()) || has_repeats(parsed.segments.iter().map(|s| s.id.as_str())) {
        problems.push(ids_repeated("segments"));
    }
    let before = problems.len();
    let ranges = check_ranges("segments", parsed.segments.iter().map(|s| (s.t0.as_str(), s.t1.as_str())), 0, &mut problems);
    let mut segments: BTreeMap<&str, (i128, i128)> = BTreeMap::new();
    if problems.len() == before && ranges.len() == parsed.segments.len() {
        let contiguous = ranges.first().is_some_and(|r| r.0 == 0) && ranges.windows(2).all(|w| w[0].1 == w[1].0);
        if !contiguous || duration.is_some_and(|d| ranges.last().is_some_and(|r| r.1 != d)) {
            problems.push(field_invalid("segments", "not-contiguous-over-duration"));
        }
        segments = parsed.segments.iter().map(|s| s.id.as_str()).zip(ranges).collect();
    }

    // 流：每段每种角色至多一路；一个素材版本只属于一路流。
    if parsed.streams.iter().any(|s| s.id.is_empty()) || has_repeats(parsed.streams.iter().map(|s| s.id.as_str())) {
        problems.push(ids_repeated("streams"));
    }
    let mut roles = BTreeSet::new();
    let mut assets = BTreeSet::new();
    for (index, stream) in parsed.streams.iter().enumerate() {
        let at = |name: &str| format!("streams[{index}].{name}");
        if !roles.insert((stream.segment_id.as_str(), stream.role)) {
            problems.push(field_invalid(at("role"), "repeated-in-segment"));
        }
        if !assets.insert((stream.asset_ref.id.as_str(), stream.asset_ref.revision.as_str())) {
            problems.push(field_invalid(at("assetRef"), "used-by-another-stream"));
        }
        if ticks(&stream.start).is_none() {
            problems.push(msg!("videoModel.ticksInvalid", "{field} must be integer ticks", field = at("start")));
        }
        let segment = segments.get(stream.segment_id.as_str()).copied();
        if segment.is_none() && !segments.is_empty() {
            problems.push(msg!(
                "videoModel.referenceMissing",
                "{field} refers to {id}, which does not exist",
                field = at("segmentId"),
                id = stream.segment_id.clone()
            ));
        }
        if let Some(coverage) = &stream.coverage {
            let ranges = check_ranges(&at("coverage"), coverage.iter().map(|r| (r.t0.as_str(), r.t1.as_str())), 0, &mut problems);
            if let Some((t0, t1)) = segment
                && ranges.iter().any(|r| r.0 < t0 || r.1 > t1)
            {
                problems.push(field_invalid(at("coverage"), "outside-segment"));
            }
        }
        match (&stream.capture, stream.role) {
            (Some(capture), StreamRole::Screen) => {
                if capture.width == 0 || capture.height == 0 {
                    problems.push(field_invalid(at("capture"), "empty-size"));
                }
                if capture.scale.is_some_and(|s| !s.is_finite() || s <= 0.0) {
                    problems.push(field_invalid(at("capture.scale"), "not-positive"));
                }
            }
            (Some(_), _) => problems.push(field_invalid(at("capture"), "screen-only")),
            (None, _) => {}
        }
        if stream.role == StreamRole::Pointer && parsed.pointer.mode == PointerMode::None {
            problems.push(field_invalid(at("role"), "pointer-mode-none"));
        }
    }
    // 键盘录了什么：有键盘流才有，有键盘流就必须有。
    if parsed.streams.iter().any(|s| s.role == StreamRole::Keyboard) != parsed.keyboard.is_some() {
        problems.push(field_invalid("keyboard", "keyboard-streams-only"));
    }

    // 光标外观：只在光标另画时有。
    if parsed.pointer.mode != PointerMode::Separate && !parsed.pointer.cursors.is_empty() {
        problems.push(field_invalid("pointer.cursors", "separate-only"));
    }
    if parsed.pointer.cursors.iter().any(|c| c.id.is_empty()) || has_repeats(parsed.pointer.cursors.iter().map(|c| c.id.as_str())) {
        problems.push(ids_repeated("pointer.cursors"));
    }
    for (index, cursor) in parsed.pointer.cursors.iter().enumerate() {
        let unit = |v: f64| v.is_finite() && (0.0..=1.0).contains(&v);
        if !unit(cursor.hotspot.x) || !unit(cursor.hotspot.y) {
            problems.push(field_range(format!("pointer.cursors[{index}].hotspot"), "0..=1"));
        }
        if cursor.scale.is_some_and(|s| !s.is_finite() || s <= 0.0) {
            problems.push(field_invalid(format!("pointer.cursors[{index}].scale"), "not-positive"));
        }
    }
    problems
}


/// 去掉键盘之后的清单：没有 `keyboard` 流，也没有 `keyboard` 字段。清单写入后唯一允许的改动是把键盘轨拿掉（§4.7），
/// 引擎用它判断新版本是不是只做了这一件事。
pub fn without_keyboard(body: &Value) -> Value {
    let mut body = body.clone();
    if let Some(object) = body.as_object_mut() {
        object.remove("keyboard");
        if let Some(streams) = object.get_mut("streams").and_then(Value::as_array_mut) {
            streams.retain(|s| s.get("role").and_then(Value::as_str) != Some("keyboard"));
        }
    }
    body
}
/// 清单引用的素材版本：各路流，再是光标图片；重复的只留第一次。正文不是清单时为空，形状不对时报错。
pub fn recording_asset_refs(body: &Value) -> Result<Vec<VersionRef>, String> {
    if body.get("schema").and_then(Value::as_str) != Some(RECORDING_SCHEMA) {
        return Ok(vec![]);
    }
    let parsed = serde_json::from_value::<RecordingBody>(body.clone()).map_err(|e| e.to_string())?;
    let mut refs: Vec<VersionRef> = Vec::new();
    for reference in parsed.streams.iter().map(|s| &s.asset_ref).chain(parsed.pointer.cursors.iter().map(|c| &c.asset_ref)) {
        if !refs.contains(reference) {
            refs.push(reference.clone());
        }
    }
    Ok(refs)
}

/// 清单引用的素材版本在不在、种类对不对：屏幕与摄像头是视频，麦克风与系统音频是音频，指针轨是指针轨素材，光标是图片。
pub fn recording_resource_problems(body: &Value, assets: &BTreeMap<Id, AssetRecord>) -> Vec<Text> {
    if body.get("schema").and_then(Value::as_str) != Some(RECORDING_SCHEMA) {
        return vec![];
    }
    let Ok(parsed) = serde_json::from_value::<RecordingBody>(body.clone()) else {
        return vec![];
    };
    let mut problems = Vec::new();
    let mut check = |field: String, reference: &VersionRef, fits: &dyn Fn(&AssetRecord, &str) -> bool| {
        let Some((asset, revision)) = assets.get(&reference.id).and_then(|a| Some((a, a.revisions.get(&reference.revision)?))) else {
            problems.push(msg!(
                "videoModel.referenceMissing",
                "{field} refers to {id}, which does not exist",
                field,
                id = format!("{}@{}", reference.id, reference.revision)
            ));
            return;
        };
        if !fits(asset, &revision.media_type) {
            problems.push(field_invalid(field, "asset-kind"));
        }
    };
    for (index, stream) in parsed.streams.iter().enumerate() {
        let field = format!("streams[{index}].assetRef");
        match stream.role {
            StreamRole::Screen | StreamRole::Camera => check(field, &stream.asset_ref, &|a, _| a.kind == AssetKind::Video),
            StreamRole::Microphone | StreamRole::SystemAudio => check(field, &stream.asset_ref, &|a, _| a.kind == AssetKind::Audio),
            StreamRole::Pointer => check(field, &stream.asset_ref, &|a, media_type| {
                a.kind == AssetKind::Other && media_type == POINTER_TRACK_MEDIA_TYPE
            }),
            StreamRole::Keyboard => check(field, &stream.asset_ref, &|a, media_type| {
                a.kind == AssetKind::Other && media_type == KEY_TRACK_MEDIA_TYPE
            }),
        }
    }
    for (index, cursor) in parsed.pointer.cursors.iter().enumerate() {
        check(format!("pointer.cursors[{index}].assetRef"), &cursor.asset_ref, &|a, _| a.kind == AssetKind::Image);
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn body() -> Value {
        json!({
            "schema": RECORDING_SCHEMA, "timescale": 1000, "clock": "recording",
            "recorder": { "name": "cap", "version": "0.4.0", "importer": "cap-studio/1" },
            "platform": "macos", "duration": "9000",
            "segments": [{ "id": "s0", "t0": "0", "t1": "5000" }, { "id": "s1", "t0": "5000", "t1": "9000" }],
            "streams": [
                { "id": "s0-screen", "role": "screen", "segmentId": "s0", "assetRef": { "id": "a1", "revision": "1" }, "start": "-120",
                  "capture": { "kind": "window", "width": 2560, "height": 1440, "scale": 2.0 } },
                { "id": "s0-camera", "role": "camera", "segmentId": "s0", "assetRef": { "id": "a2", "revision": "1" }, "start": "400",
                  "coverage": [{ "t0": "400", "t1": "3000" }, { "t0": "3500", "t1": "5000" }] },
                { "id": "s0-mic", "role": "microphone", "segmentId": "s0", "assetRef": { "id": "a3", "revision": "1" }, "start": "0" },
                { "id": "s0-pointer", "role": "pointer", "segmentId": "s0", "assetRef": { "id": "a4", "revision": "1" }, "start": "0" },
                { "id": "s1-screen", "role": "screen", "segmentId": "s1", "assetRef": { "id": "a5", "revision": "1" }, "start": "5000" }
            ],
            "pointer": { "mode": "separate", "cursors": [
                { "id": "c0", "assetRef": { "id": "a6", "revision": "1" }, "hotspot": { "x": 0.1, "y": 0.05 }, "shape": "arrow" }
            ] }
        })
    }

    fn with(edit: impl FnOnce(&mut Value)) -> Vec<Text> {
        let mut value = body();
        edit(&mut value);
        recording_body_problems(&value)
    }

    #[test]
    fn body_round_trips_and_lists_its_assets() {
        let value = body();
        let parsed: RecordingBody = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), value);
        assert!(recording_body_problems(&value).is_empty());
        let ids: Vec<String> = recording_asset_refs(&value).unwrap().into_iter().map(|r| r.id).collect();
        assert_eq!(ids, ["a1", "a2", "a3", "a4", "a5", "a6"]);
        assert!(recording_asset_refs(&json!({ "schema": "baocut.cut-set/1" })).unwrap().is_empty());
    }

    #[test]
    fn segments_must_tile_the_recording() {
        assert_eq!(with(|v| v["segments"][1]["t0"] = json!("6000")).len(), 1);
        assert_eq!(with(|v| v["duration"] = json!("9500")).len(), 1);
        assert_eq!(with(|v| v["segments"][0]["t0"] = json!("1")).len(), 1);
        assert!(!with(|v| v["segments"] = json!([])).is_empty());
        assert!(!with(|v| v["segments"][1]["id"] = json!("s0")).is_empty());
    }

    #[test]
    fn streams_are_checked_against_their_segment() {
        // 同一段里同一种角色只有一路。
        assert_eq!(with(|v| v["streams"][1]["role"] = json!("screen")).len(), 1);
        // 一个素材版本只属于一路流。
        assert_eq!(with(|v| v["streams"][2]["assetRef"] = json!({ "id": "a1", "revision": "1" })).len(), 1);
        assert_eq!(with(|v| v["streams"][2]["segmentId"] = json!("nope")).len(), 1);
        assert_eq!(with(|v| v["streams"][1]["coverage"][1]["t1"] = json!("5001")).len(), 1);
        assert_eq!(with(|v| v["streams"][1]["coverage"][1]["t0"] = json!("2000")).len(), 1);
        assert_eq!(with(|v| v["streams"][0]["start"] = json!("1.5")).len(), 1);
        assert_eq!(with(|v| v["streams"][1]["capture"] = json!({ "kind": "display", "width": 1, "height": 1 })).len(), 1);
    }

    #[test]
    fn cursors_need_a_separate_pointer() {
        assert_eq!(with(|v| v["pointer"]["mode"] = json!("baked")).len(), 1);
        // 没有指针时也不能有指针轨。
        assert_eq!(with(|v| v["pointer"] = json!({ "mode": "none" })).len(), 1);
        assert_eq!(with(|v| v["pointer"]["cursors"][0]["hotspot"]["x"] = json!(1.5)).len(), 1);
    }
}
