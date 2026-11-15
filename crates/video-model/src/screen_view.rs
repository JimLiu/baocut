//! 屏幕取景的正文（视频格式规范 §4.9，文档 `kind: 'screen-view'`）：一段屏幕画面什么时候放大、放大多少、看哪里，
//! 以及另画的光标长什么样。它是编辑意图；由它求出的取景曲线与光标曲线是派生产物，随时可以重算。
//!
//! 时刻写在内容的时钟上，不写在序列上：录制的屏幕用录制时间（`clock: 'recording'`，文档头的 `sourceDocumentId` 是
//! 录制清单），普通视频用素材的源时钟（`clock: 'source-asset'`，文档头的 `sourceAssetId` 是那个素材）。拆分、移动、
//! 修剪与变速都不改它，画面跟着内容走。

use message_ref::{Text, msg};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::Id;
use crate::recording::{CLOCK_RECORDING, PointerMode, check_ranges, field_invalid, field_range, has_repeats, ids_repeated, ticks, timescale_ok};

pub const SCREEN_VIEW_SCHEMA: &str = "baocut.screen-view/1";
pub const SCREEN_VIEW_KIND: &str = "screen-view";
pub const CLOCK_SOURCE_ASSET: &str = "source-asset";
/// 取景与光标曲线的求值算法版本。算法改了加一，旧文档照旧版本求值。
pub const SCREEN_VIEW_SOLVER: u32 = 1;
/// 放大倍率的上限；下限是大于 1。
pub const ZOOM_SCALE_MAX: f64 = 8.0;
pub const POINTER_SIZE_RANGE: (f64, f64) = (0.25, 8.0);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenViewBody {
    /// `baocut.screen-view/1`。
    pub schema: String,
    /// 每秒的刻度数。
    pub timescale: u64,
    /// `recording` 或 `source-asset`。
    pub clock: String,
    /// 求值算法的版本，当前为 1。
    pub solver: u32,
    /// 放大的区间，按 `t0` 排序、互不重叠。区间之外是全景。
    pub zooms: Vec<ZoomRegion>,
    /// 跟随指针时镜头怎么动。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub follow: Option<FollowTuning>,
    /// 另画的光标的样子；只用于光标没有录进画面的录制。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pointer: Option<PointerStyle>,
}

/// 一个放大的区间 `[t0, t1)`。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomRegion {
    pub id: Id,
    pub t0: String,
    pub t1: String,
    /// 放大倍率，(1, 8]：可见区域的宽高是全景的 1 / scale。
    pub scale: f64,
    pub focus: ZoomFocus,
    pub origin: ZoomOrigin,
    /// 自动生成之后被用户改过；重新生成自动区间时保留。只用于 `origin: 'auto'`，为 false 时省略。
    #[serde(default, skip_serializing_if = "crate::place::is_false")]
    pub edited: bool,
    /// 放大的过渡占区间开头多长（整数刻度）；省略时取算法的缺省，0 是直接切过去。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ramp_in: Option<String>,
    /// 回到全景的过渡占区间结尾多长；同上。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ramp_out: Option<String>,
}

/// 放大之后看哪里。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ZoomFocus {
    /// 跟着指针走。
    Pointer,
    /// 固定看一点：源画面（已摆正、裁剪之前）的归一化坐标，各在 [0, 1]。
    Point { x: f64, y: f64 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ZoomOrigin {
    /// 按点击自动生成的。
    Auto,
    /// 用户或智能体加的。
    Manual,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowTuning {
    /// 可见区域中间的安全区占它的比例，[0, 1)：指针在里面移动时镜头不动。缺省 0.5。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub safe_area: Option<f64>,
    /// 镜头移动的平滑程度，[0, 1]，0 是紧跟。缺省 0.5。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smoothing: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointerStyle {
    /// 不画光标；为 false 时省略。
    #[serde(default, skip_serializing_if = "crate::place::is_false")]
    pub hidden: bool,
    /// 光标的倍率，[0.25, 8]，缺省 1：1 是录制时它在屏幕上的大小。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    /// 轨迹的平滑程度，[0, 1]，缺省 0（照录下来的走）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smoothing: Option<f64>,
    /// 指针静止超过这么久就隐去（正的整数刻度）；省略时一直显示。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idle_hide: Option<String>,
    /// 点击提示；省略时没有。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub click: Option<ClickEffect>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClickEffect {
    pub effect: ClickEffectKind,
    /// `#RRGGBB`；省略时取算法的缺省。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClickEffectKind {
    /// 按下时从指针处散开一圈。
    Ripple,
}

/// 文档头与正文的时钟对不对（§4.9）：录制时间要有一份录制清单作来源文档，素材源时钟要有来源素材。
pub fn screen_view_source_problems(body: &Value, source_is_recording: bool, has_source_asset: bool) -> Vec<Text> {
    match body.get("clock").and_then(Value::as_str) {
        Some(CLOCK_RECORDING) if !source_is_recording => vec![field_invalid("sourceDocumentId", "recording-manifest-required")],
        Some(CLOCK_SOURCE_ASSET) if !has_source_asset => vec![field_invalid("sourceAssetId", "required")],
        _ => Vec::new(),
    }
}

/// 正文与 §4.9 不合的地方（空表示合）。`pointer_mode` 是所属录制清单的鼠标模式；不知道时（没有读清单）只查形状。
pub fn screen_view_body_problems(body: &Value, pointer_mode: Option<PointerMode>) -> Vec<Text> {
    let parsed = match serde_json::from_value::<ScreenViewBody>(body.clone()) {
        Ok(parsed) => parsed,
        Err(error) => return vec![msg!("videoModel.bodyShape", "The body has fields of the wrong shape: {error}", error = error.to_string())],
    };
    let mut problems = Vec::new();
    if parsed.schema != SCREEN_VIEW_SCHEMA {
        problems.push(msg!("videoModel.schemaMismatch", "schema must be {schema}", schema = SCREEN_VIEW_SCHEMA));
    }
    let recorded = parsed.clock == CLOCK_RECORDING;
    if !recorded && parsed.clock != CLOCK_SOURCE_ASSET {
        problems.push(msg!(
            "videoModel.clockOneOf",
            "clock must be one of: {clocks}",
            clocks = format!("{CLOCK_RECORDING}, {CLOCK_SOURCE_ASSET}")
        ));
    }
    if !timescale_ok(parsed.timescale) {
        problems.push(msg!("videoModel.timescaleSafeInteger", "timescale must be a positive safe integer"));
        return problems;
    }
    if parsed.solver != SCREEN_VIEW_SOLVER {
        problems.push(field_invalid("solver", "unsupported-version"));
    }
    // 有指针可跟：录制的屏幕，而且清单里有指针轨（光标另画或录进了画面）。
    let has_pointer = recorded && pointer_mode != Some(PointerMode::None);

    if parsed.zooms.iter().any(|z| z.id.is_empty()) || has_repeats(parsed.zooms.iter().map(|z| z.id.as_str())) {
        problems.push(ids_repeated("zooms"));
    }
    check_ranges("zooms", parsed.zooms.iter().map(|z| (z.t0.as_str(), z.t1.as_str())), 0, &mut problems);
    let unit = |v: f64| v.is_finite() && (0.0..=1.0).contains(&v);
    for (index, zoom) in parsed.zooms.iter().enumerate() {
        let at = |name: &str| format!("zooms[{index}].{name}");
        if !zoom.scale.is_finite() || zoom.scale <= 1.0 || zoom.scale > ZOOM_SCALE_MAX {
            problems.push(field_range(at("scale"), "(1, 8]"));
        }
        match zoom.focus {
            ZoomFocus::Pointer if !has_pointer => problems.push(field_invalid(at("focus"), "no-pointer")),
            ZoomFocus::Point { x, y } if !unit(x) || !unit(y) => problems.push(field_range(at("focus"), "0..=1")),
            _ => {}
        }
        if zoom.edited && zoom.origin != ZoomOrigin::Auto {
            problems.push(field_invalid(at("edited"), "auto-only"));
        }
        let ramp = |name: &str, value: &Option<String>, problems: &mut Vec<Text>| match value.as_deref().map(ticks) {
            Some(Some(t)) if t >= 0 => t,
            Some(_) => {
                problems.push(field_invalid(at(name), "non-negative-integer-ticks"));
                0
            }
            None => 0,
        };
        let ramps = ramp("rampIn", &zoom.ramp_in, &mut problems) + ramp("rampOut", &zoom.ramp_out, &mut problems);
        if let (Some(t0), Some(t1)) = (ticks(&zoom.t0), ticks(&zoom.t1))
            && t1 > t0
            && ramps > t1 - t0
        {
            problems.push(field_invalid(at("rampIn"), "ramps-longer-than-region"));
        }
    }

    if let Some(follow) = &parsed.follow {
        if follow.safe_area.is_some_and(|v| !v.is_finite() || !(0.0..1.0).contains(&v)) {
            problems.push(field_range("follow.safeArea", "[0, 1)"));
        }
        if follow.smoothing.is_some_and(|v| !unit(v)) {
            problems.push(field_range("follow.smoothing", "0..=1"));
        }
    }

    if let Some(pointer) = &parsed.pointer {
        // 光标只在另画时可以改样子：录进画面的光标改不了，普通视频没有光标。
        if !recorded || pointer_mode.is_some_and(|mode| mode != PointerMode::Separate) {
            problems.push(field_invalid("pointer", "separate-pointer-only"));
        }
        if pointer.size.is_some_and(|v| !v.is_finite() || v < POINTER_SIZE_RANGE.0 || v > POINTER_SIZE_RANGE.1) {
            problems.push(field_range("pointer.size", "0.25..=8"));
        }
        if pointer.smoothing.is_some_and(|v| !unit(v)) {
            problems.push(field_range("pointer.smoothing", "0..=1"));
        }
        if pointer.idle_hide.as_deref().is_some_and(|t| ticks(t).is_none_or(|t| t <= 0)) {
            problems.push(field_invalid("pointer.idleHide", "positive-integer-ticks"));
        }
        if let Some(color) = pointer.click.as_ref().and_then(|c| c.color.as_deref())
            && crate::canvas_background(color).is_none()
        {
            problems.push(field_invalid("pointer.click.color", "not-rrggbb"));
        }
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn body() -> Value {
        json!({
            "schema": SCREEN_VIEW_SCHEMA, "timescale": 1000, "clock": "recording", "solver": 1,
            "zooms": [
                { "id": "z1", "t0": "1700", "t1": "5200", "scale": 2.0, "focus": { "kind": "pointer" }, "origin": "auto" },
                { "id": "z2", "t0": "5200", "t1": "8000", "scale": 1.5, "focus": { "kind": "point", "x": 0.25, "y": 0.8 },
                  "origin": "auto", "edited": true, "rampIn": "0", "rampOut": "400" },
                { "id": "z3", "t0": "9000", "t1": "9500", "scale": 3.0, "focus": { "kind": "pointer" }, "origin": "manual" }
            ],
            "follow": { "safeArea": 0.5, "smoothing": 0.6 },
            "pointer": { "size": 1.5, "smoothing": 0.3, "idleHide": "3000", "click": { "effect": "ripple", "color": "#FFCC00" } }
        })
    }

    fn with(mode: Option<PointerMode>, edit: impl FnOnce(&mut Value)) -> Vec<Text> {
        let mut value = body();
        edit(&mut value);
        screen_view_body_problems(&value, mode)
    }

    #[test]
    fn body_round_trips() {
        let value = body();
        let parsed: ScreenViewBody = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), value);
        assert!(screen_view_body_problems(&value, None).is_empty());
        assert!(screen_view_body_problems(&value, Some(PointerMode::Separate)).is_empty());
    }

    #[test]
    fn zooms_are_sorted_ranges_with_a_scale_above_one() {
        assert_eq!(with(None, |v| v["zooms"][1]["t0"] = json!("5000")).len(), 1);
        assert_eq!(with(None, |v| v["zooms"][0]["scale"] = json!(1.0)).len(), 1);
        assert_eq!(with(None, |v| v["zooms"][0]["scale"] = json!(8.5)).len(), 1);
        assert_eq!(with(None, |v| v["zooms"][1]["focus"]["x"] = json!(1.2)).len(), 1);
        assert_eq!(with(None, |v| v["zooms"][2]["edited"] = json!(true)).len(), 1);
        assert_eq!(with(None, |v| v["zooms"][2]["rampIn"] = json!("600")).len(), 1);
        assert_eq!(with(None, |v| v["zooms"][2]["id"] = json!("z1")).len(), 1);
        assert_eq!(with(None, |v| v["solver"] = json!(2)).len(), 1);
    }

    #[test]
    fn the_pointer_needs_a_recording_that_has_one() {
        // 普通视频：只能固定看一点，也没有光标可画。
        let plain = with(None, |v| v["clock"] = json!("source-asset"));
        assert_eq!(plain.len(), 3);
        let manual = with(None, |v| {
            v["clock"] = json!("source-asset");
            v["zooms"] = json!([{ "id": "z", "t0": "0", "t1": "1000", "scale": 2.0, "focus": { "kind": "point", "x": 0.5, "y": 0.5 }, "origin": "manual" }]);
            v.as_object_mut().unwrap().remove("pointer");
        });
        assert!(manual.is_empty());
        // 光标录进了画面：可以跟着它取景，不能改它的样子。
        assert_eq!(with(Some(PointerMode::Baked), |_| {}).len(), 1);
        // 没有指针轨：既不能跟随，也不能画。
        assert_eq!(with(Some(PointerMode::None), |_| {}).len(), 3);
    }

    #[test]
    fn pointer_style_ranges() {
        assert_eq!(with(None, |v| v["pointer"]["size"] = json!(0.1)).len(), 1);
        assert_eq!(with(None, |v| v["pointer"]["idleHide"] = json!("0")).len(), 1);
        assert_eq!(with(None, |v| v["pointer"]["click"]["color"] = json!("red")).len(), 1);
        assert_eq!(with(None, |v| v["follow"]["safeArea"] = json!(1.0)).len(), 1);
    }
}
