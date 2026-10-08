//! 通用 preset manifest（设计 §5.4.1、规范 §7.4 / 附录 B）。
//!
//! 这是**第五种**配方形状，与 `frozen.rs` 的四种冻结形状并存而不是取代它们
//! （ADR-M08：`timeline.*@1` / `bcf.*@1` 已发布，解析路径不得改写）。
//! 形状：
//!
//! ```jsonc
//! { "id": "motion.backIn", "version": 1, "domain": "motion", "family": "backIn",
//!   "aliases": ["springPop"], "exposedTo": ["bcf"],
//!   "params": { "direction": { "type": "enum", "options": ["left","right","up","down"],
//!                              "default": "up" } },
//!   "compose": [ { "preset": "motion.moveIn", "params": { "direction": "{direction}" } } ],
//!   // 或叶子：
//!   "tracks": [ { "prop": "y", "composite": "add", "order": 0,
//!                 "frames": [ { "t": "0%", "v": "{distance}" },
//!                             { "t": "100%", "v": 0, "ease": "easeOutCubic" } ] } ],
//!   "defaults": { "curve": "easeOutCubic", "dur": 0.5 },
//!   "determinism": "strict", "capabilities": [], "fallback": "bcf.fadeIn" }
//! ```
//!
//! `tracks` 与 `compose` 互斥。帧值 / 参数值里的 `"{param}"` 是唯一的替换语法
//! （`substitute.rs`），只替换不算术。

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use crate::MotionError;
use crate::composite::CompositeMode;
use crate::relative_value::{LengthBasis, RelativeLength};

use super::json::{field, text, version};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ManifestDomain {
    Motion,
    Transition,
    Filter,
}

impl ManifestDomain {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "motion" => Some(Self::Motion),
            "transition" => Some(Self::Transition),
            "filter" => Some(Self::Filter),
            _ => None,
        }
    }
}

/// 确定性等级（规范 §14.6）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Determinism {
    Strict,
    Visual,
    Backend,
}

impl Determinism {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "strict" => Some(Self::Strict),
            "visual" => Some(Self::Visual),
            "backend" => Some(Self::Backend),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Strict => "strict",
            Self::Visual => "visual",
            Self::Backend => "backend",
        }
    }
}

/// 配方对哪些**表面**开放（计划 §0.2）。
///
/// 刻意不复用 `SlotRecipe::available` —— 那是「GPUI/Mac 动画面板里能不能选到」的
/// 目录开关，语义已经被两个客户端消费。新 family 需要表达的是「Timeline 0.1 枚举
/// 与 Mac 舞台都不开放，只对 BCF 开放」，是另一个维度。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Surface {
    Timeline,
    Bcf,
    MacStage,
}

impl Surface {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "timeline" => Some(Self::Timeline),
            "bcf" => Some(Self::Bcf),
            "macStage" => Some(Self::MacStage),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Timeline => "timeline",
            Self::Bcf => "bcf",
            Self::MacStage => "macStage",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum ParamType {
    Number {
        min: Option<f64>,
        max: Option<f64>,
    },
    /// 裸数字（basis=absolute）或 `{value, basis, offset}`（规范 §7.8）。
    Length,
    Enum {
        options: Vec<String>,
    },
    Bool,
    Text,
    /// 曲线名（规范 §7.6 的封闭名称）。
    Curve,
    /// u64，缺省 0（规范 §7.3）。
    Seed,
}

impl ParamType {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Number { .. } => "number",
            Self::Length => "length",
            Self::Enum { .. } => "enum",
            Self::Bool => "bool",
            Self::Text => "text",
            Self::Curve => "curve",
            Self::Seed => "seed",
        }
    }

    /// 类型校验。值必须已经过 `substitute`（不再含 `"{param}"`）。
    pub fn check(&self, id: &str, key: &str, value: &Value) -> Result<(), MotionError> {
        let bad = |detail: String| {
            Err(MotionError::PresetParamUnknown(format!(
                "{id}.{key}: {detail}"
            )))
        };
        match self {
            Self::Number { min, max } => {
                let Some(n) = value.as_f64() else {
                    return bad(format!("expected number, got {value}"));
                };
                if let Some(min) = min {
                    if n < *min {
                        return bad(format!("{n} < min {min}"));
                    }
                }
                if let Some(max) = max {
                    if n > *max {
                        return bad(format!("{n} > max {max}"));
                    }
                }
                Ok(())
            }
            Self::Length => match parse_length_value(value) {
                Some(_) => Ok(()),
                None => bad(format!("expected length, got {value}")),
            },
            Self::Enum { options } => match value.as_str() {
                Some(s) if options.iter().any(|o| o == s) => Ok(()),
                _ => bad(format!("expected one of {options:?}, got {value}")),
            },
            Self::Bool => {
                if value.is_boolean() {
                    Ok(())
                } else {
                    bad(format!("expected bool, got {value}"))
                }
            }
            Self::Text => {
                if value.is_string() {
                    Ok(())
                } else {
                    bad(format!("expected string, got {value}"))
                }
            }
            Self::Curve => match value.as_str() {
                Some(name) if crate::curve::EASE_NAMES.contains(&name) => Ok(()),
                _ => bad(format!("expected an easing name, got {value}")),
            },
            Self::Seed => match value.as_u64() {
                Some(_) => Ok(()),
                None => bad(format!("expected u64 seed, got {value}")),
            },
        }
    }
}

/// 长度值 → `RelativeLength`：裸数字视为 `absolute`（规范 §7.8）。
pub fn parse_length_value(value: &Value) -> Option<RelativeLength> {
    if let Some(n) = value.as_f64() {
        return Some(RelativeLength::absolute(n));
    }
    let object = value.as_object()?;
    let basis = match object.get("basis") {
        Some(v) => LengthBasis::parse(v.as_str()?)?,
        None => LengthBasis::Absolute,
    };
    Some(RelativeLength {
        value: object.get("value")?.as_f64()?,
        basis,
        offset_px: object
            .get("offset")
            .or_else(|| object.get("offsetPx"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
    })
}

/// `{value, basis, …}` 形状（未求值的相对长度）。
pub fn is_relative_length_object(value: &Value) -> bool {
    value
        .as_object()
        .is_some_and(|o| o.contains_key("basis") && o.contains_key("value"))
}

#[derive(Clone, Debug, PartialEq)]
pub struct ParamSpec {
    pub ty: ParamType,
    /// `None` = 必填（缺失时报 `preset-param-missing`）。
    pub default: Option<Value>,
    pub doc: Option<String>,
}

/// manifest 里的帧时间只有两种：窗口百分比与相对秒。TimeExpr 不进配方。
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FrameTime {
    Pct(f64),
    Sec(f64),
}

impl FrameTime {
    pub fn seconds(self, dur: f64) -> f64 {
        match self {
            Self::Pct(p) => p / 100.0 * dur,
            Self::Sec(s) => s,
        }
    }
}

/// 一帧。`v` / `ease` 是**原文 JSON**，可能含 `"{param}"`，展开期才替换。
#[derive(Clone, Debug, PartialEq)]
pub struct FrameSpec {
    pub t: FrameTime,
    pub v: Value,
    pub ease: Option<Value>,
}

/// 叶子配方的一条轨。
#[derive(Clone, Debug, PartialEq)]
pub struct TrackSpec {
    pub prop: String,
    /// `None` = 用 `defaults.composite`，再没有就用 `composite::default_mode(prop)`。
    pub composite: Option<CompositeMode>,
    pub order: u32,
    /// 整轨缺省曲线（逐帧 `ease` 优先）。
    pub curve: Option<Value>,
    pub frames: Vec<FrameSpec>,
}

/// `compose[]` 的一步。
#[derive(Clone, Debug, PartialEq)]
pub struct ComposeStep {
    pub preset: String,
    /// 缺省 = 被引用 id 的最低已发布版本（规范 §7.4，**不静默取最新**）。
    pub version: Option<u32>,
    pub params: Map<String, Value>,
    /// 相对起点（秒），缺省 0。
    pub at: f64,
    /// 时长倍率，缺省 1。
    pub dur_scale: f64,
    /// 条件步：`true` / `false` / `"{boolParam}"` 三种形态之一（不引入表达式，ADR）。
    pub when: Option<Value>,
}

/// 配方作用域（阶段 3）：元素整体，还是文字 part（规范 §7.9）。
///
/// 只影响**词汇预算的统计口径**（`families()` / `part_families()`）——
/// 求值路径是同一条：part 轨与元素轨都写 `x` / `y` / `scale` / `opacity`。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum AppliesTo {
    #[default]
    Element,
    Part,
}

impl AppliesTo {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "element" => Some(Self::Element),
            "part" => Some(Self::Part),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Element => "element",
            Self::Part => "part",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum PresetBody {
    Leaf(Vec<TrackSpec>),
    Compose(Vec<ComposeStep>),
    /// MotionGraph 片段（阶段 3）：`shake` / `drift` / `seededJitter` 的真身是
    /// `oscillate` / `noise` op，写不成定长关键帧表。展开时先做 `"{param}"` 替换，
    /// 再经 `flow::parse_flow` + `graph::compile_flow` 铺成关键帧。
    ///
    /// **不接受 `preset` op**（解析期拒绝）：ops 体的展开会重入 `expand()`，
    /// 而 `expand()` 的环检测栈不跨这一层；禁掉引用就没有环可成。
    Ops(Vec<Value>),
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PresetDefaults {
    pub curve: Option<Value>,
    pub dur: Option<f64>,
    pub composite: Option<CompositeMode>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PresetManifest {
    pub id: String,
    pub version: u32,
    pub domain: ManifestDomain,
    /// UI 家族。内部积木为 `None`——家族预算与 `preset-sprawl` 只数 `Some`。
    pub family: Option<String>,
    pub aliases: Vec<String>,
    pub params: BTreeMap<String, ParamSpec>,
    pub body: PresetBody,
    pub defaults: PresetDefaults,
    pub determinism: Determinism,
    pub capabilities: Vec<String>,
    pub fallback: Option<String>,
    pub exposed_to: Vec<Surface>,
    pub applies_to: AppliesTo,
    pub manifest_hash: u64,
}

pub fn parse_composite(file: &str, name: &str) -> Result<CompositeMode, MotionError> {
    match name {
        "replace" => Ok(CompositeMode::Replace),
        "add" => Ok(CompositeMode::Add),
        "multiply" => Ok(CompositeMode::Multiply),
        other => Err(MotionError::ManifestInvalid(format!(
            "{file}: unknown composite \"{other}\""
        ))),
    }
}

fn parse_param_type(file: &str, key: &str, spec: &Value) -> Result<ParamType, MotionError> {
    let invalid =
        |detail: String| MotionError::ManifestInvalid(format!("{file}: params.{key} {detail}"));
    match text(file, spec, "type")? {
        "number" => Ok(ParamType::Number {
            min: spec.get("min").and_then(Value::as_f64),
            max: spec.get("max").and_then(Value::as_f64),
        }),
        "length" => Ok(ParamType::Length),
        "enum" => {
            let options = spec
                .get("options")
                .and_then(Value::as_array)
                .ok_or_else(|| invalid("missing \"options\"".into()))?
                .iter()
                .map(|v| {
                    v.as_str()
                        .map(str::to_owned)
                        .ok_or_else(|| invalid("non-string option".into()))
                })
                .collect::<Result<Vec<_>, _>>()?;
            if options.is_empty() {
                return Err(invalid("empty \"options\"".into()));
            }
            Ok(ParamType::Enum { options })
        }
        "bool" => Ok(ParamType::Bool),
        "text" => Ok(ParamType::Text),
        "curve" => Ok(ParamType::Curve),
        "seed" => Ok(ParamType::Seed),
        other => Err(invalid(format!("unknown type \"{other}\""))),
    }
}

fn parse_frame_time(file: &str, value: &Value) -> Result<FrameTime, MotionError> {
    if let Some(pct) = value
        .as_str()
        .and_then(|s| s.strip_suffix('%'))
        .and_then(|s| s.parse::<f64>().ok())
    {
        return Ok(FrameTime::Pct(pct));
    }
    value
        .as_f64()
        .map(FrameTime::Sec)
        .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: bad frame time {value}")))
}

fn parse_track(file: &str, value: &Value) -> Result<TrackSpec, MotionError> {
    let prop = text(file, value, "prop")?.to_owned();
    if !crate::value::is_animatable(&prop) {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: \"{prop}\" is not an animatable property"
        )));
    }
    let composite = match value.get("composite").and_then(Value::as_str) {
        Some(name) => Some(parse_composite(file, name)?),
        None => None,
    };
    let mut frames = Vec::new();
    for frame in field(file, value, "frames")?.as_array().ok_or_else(|| {
        MotionError::ManifestInvalid(format!("{file}: \"frames\" is not an array"))
    })? {
        frames.push(FrameSpec {
            t: parse_frame_time(file, field(file, frame, "t")?)?,
            v: field(file, frame, "v")?.clone(),
            ease: frame.get("ease").cloned(),
        });
    }
    if frames.len() < 2 {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: track \"{prop}\" needs at least two frames"
        )));
    }
    Ok(TrackSpec {
        prop,
        composite,
        order: value.get("order").and_then(Value::as_u64).unwrap_or(0) as u32,
        curve: value.get("curve").cloned(),
        frames,
    })
}

fn parse_compose_step(file: &str, value: &Value) -> Result<ComposeStep, MotionError> {
    let when = value.get("when").cloned();
    if let Some(when) = &when {
        let ok = when.is_boolean()
            || when
                .as_str()
                .is_some_and(|s| s.starts_with('{') && s.ends_with('}'));
        if !ok {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: \"when\" must be true / false / \"{{boolParam}}\", got {when}"
            )));
        }
    }
    Ok(ComposeStep {
        preset: text(file, value, "preset")?.to_owned(),
        version: value
            .get("presetVersion")
            .and_then(Value::as_u64)
            .map(|v| v as u32),
        params: value
            .get("params")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default(),
        at: value.get("at").and_then(Value::as_f64).unwrap_or(0.0),
        dur_scale: value.get("durScale").and_then(Value::as_f64).unwrap_or(1.0),
        when,
    })
}

pub fn parse_manifest(
    file: &str,
    doc: &Value,
    manifest_hash: u64,
) -> Result<PresetManifest, MotionError> {
    let id = text(file, doc, "id")?.to_owned();
    let domain = ManifestDomain::parse(text(file, doc, "domain")?).ok_or_else(|| {
        MotionError::ManifestInvalid(format!("{file}: unknown domain for \"{id}\""))
    })?;
    let determinism = Determinism::parse(text(file, doc, "determinism")?).ok_or_else(|| {
        MotionError::ManifestInvalid(format!("{file}: unknown determinism for \"{id}\""))
    })?;

    let mut params = BTreeMap::new();
    if let Some(specs) = doc.get("params").and_then(Value::as_object) {
        for (key, spec) in specs {
            let ty = parse_param_type(file, key, spec)?;
            let default = spec.get("default").cloned();
            if let Some(default) = &default {
                ty.check(&id, key, default).map_err(|error| {
                    MotionError::ManifestInvalid(format!("{file}: bad default — {error}"))
                })?;
            }
            params.insert(
                key.clone(),
                ParamSpec {
                    ty,
                    default,
                    doc: spec.get("doc").and_then(Value::as_str).map(str::to_owned),
                },
            );
        }
    }

    let bodies = ["tracks", "compose", "ops"]
        .into_iter()
        .filter(|key| doc.get(*key).is_some())
        .count();
    if bodies > 1 {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: \"tracks\" / \"compose\" / \"ops\" are mutually exclusive"
        )));
    }
    if let Some(ops) = doc.get("ops") {
        let array = ops.as_array().ok_or_else(|| {
            MotionError::ManifestInvalid(format!("{file}: \"ops\" is not an array"))
        })?;
        if array.is_empty() {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: \"ops\" is empty"
            )));
        }
        for op in array {
            reject_preset_ops(file, op)?;
        }
        if doc
            .get("params")
            .and_then(Value::as_object)
            .is_some_and(|params| params.contains_key("dur"))
        {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: ops 体里的 \"{{dur}}\" 是隐式绑定（引用点时长），不得再声明同名参数"
            )));
        }
    }
    let body = match (doc.get("tracks"), doc.get("compose")) {
        (Some(_), Some(_)) => {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: \"tracks\" and \"compose\" are mutually exclusive"
            )));
        }
        (None, None) => match doc.get("ops") {
            Some(ops) => PresetBody::Ops(ops.as_array().cloned().unwrap_or_default()),
            None => {
                return Err(MotionError::ManifestInvalid(format!(
                    "{file}: needs one of \"tracks\" / \"compose\" / \"ops\""
                )));
            }
        },
        (Some(tracks), None) => {
            let array = tracks.as_array().ok_or_else(|| {
                MotionError::ManifestInvalid(format!("{file}: \"tracks\" is not an array"))
            })?;
            PresetBody::Leaf(
                array
                    .iter()
                    .map(|track| parse_track(file, track))
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
        (None, Some(compose)) => {
            let array = compose.as_array().ok_or_else(|| {
                MotionError::ManifestInvalid(format!("{file}: \"compose\" is not an array"))
            })?;
            if array.is_empty() {
                return Err(MotionError::ManifestInvalid(format!(
                    "{file}: \"compose\" is empty"
                )));
            }
            PresetBody::Compose(
                array
                    .iter()
                    .map(|step| parse_compose_step(file, step))
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
    };

    let defaults = match doc.get("defaults") {
        Some(value) => PresetDefaults {
            curve: value.get("curve").cloned(),
            dur: value.get("dur").and_then(Value::as_f64),
            composite: match value.get("composite").and_then(Value::as_str) {
                Some(name) => Some(parse_composite(file, name)?),
                None => None,
            },
        },
        None => PresetDefaults::default(),
    };

    let exposed_to = match doc.get("exposedTo").and_then(Value::as_array) {
        Some(array) => array
            .iter()
            .map(|v| {
                v.as_str().and_then(Surface::parse).ok_or_else(|| {
                    MotionError::ManifestInvalid(format!("{file}: bad exposedTo {v}"))
                })
            })
            .collect::<Result<Vec<_>, _>>()?,
        None => vec![Surface::Bcf],
    };

    Ok(PresetManifest {
        id,
        version: version(file, doc)?,
        domain,
        family: doc.get("family").and_then(Value::as_str).map(str::to_owned),
        aliases: doc
            .get("aliases")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
        params,
        body,
        defaults,
        determinism,
        capabilities: doc
            .get("capabilities")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
        fallback: doc
            .get("fallback")
            .and_then(Value::as_str)
            .map(str::to_owned),
        exposed_to,
        applies_to: match doc.get("appliesTo").and_then(Value::as_str) {
            None => AppliesTo::Element,
            Some(name) => AppliesTo::parse(name).ok_or_else(|| {
                MotionError::ManifestInvalid(format!("{file}: bad appliesTo \"{name}\""))
            })?,
        },
        manifest_hash,
    })
}

/// ops 体里禁止 `preset` op（见 [`PresetBody::Ops`]）。递归查 `items` / `item`。
fn reject_preset_ops(file: &str, op: &Value) -> Result<(), MotionError> {
    let Some(map) = op.as_object() else {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: ops[] 元素不是对象"
        )));
    };
    if map.get("op").and_then(Value::as_str) == Some("preset") {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: ops 体不接受 \"preset\" op（配方不得经 ops 递归引用配方）"
        )));
    }
    if let Some(items) = map.get("items").and_then(Value::as_array) {
        for item in items {
            reject_preset_ops(file, item)?;
        }
    }
    if let Some(item) = map.get("item") {
        reject_preset_ops(file, item)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn leaf() -> Value {
        json!({
            "id": "motion.test", "version": 1, "domain": "motion", "family": "test",
            "determinism": "strict",
            "tracks": [{"prop": "y", "composite": "add",
                        "frames": [{"t": "0%", "v": "{distance}"}, {"t": "100%", "v": 0}]}]
        })
    }

    #[test]
    fn leaf_manifests_parse_with_defaults() {
        let m = parse_manifest("t.json", &leaf(), 7).unwrap();
        assert_eq!(m.id, "motion.test");
        assert_eq!(m.exposed_to, vec![Surface::Bcf]);
        assert_eq!(m.determinism, Determinism::Strict);
        assert!(matches!(m.body, PresetBody::Leaf(_)));
    }

    #[test]
    fn tracks_and_compose_are_mutually_exclusive() {
        let mut doc = leaf();
        doc["compose"] = json!([{"preset": "bcf.fadeIn"}]);
        assert!(matches!(
            parse_manifest("t.json", &doc, 0),
            Err(MotionError::ManifestInvalid(_))
        ));
        let mut doc = leaf();
        doc.as_object_mut().unwrap().remove("tracks");
        assert!(matches!(
            parse_manifest("t.json", &doc, 0),
            Err(MotionError::ManifestInvalid(_))
        ));
    }

    #[test]
    fn unknown_properties_are_rejected_at_parse_time() {
        let mut doc = leaf();
        doc["tracks"][0]["prop"] = json!("width");
        assert!(matches!(
            parse_manifest("t.json", &doc, 0),
            Err(MotionError::ManifestInvalid(_))
        ));
    }

    #[test]
    fn when_only_accepts_the_three_boolean_shapes() {
        let base = json!({
            "id": "motion.c", "version": 1, "domain": "motion", "determinism": "strict",
            "compose": [{"preset": "bcf.fadeIn", "when": "{fade}"}]
        });
        assert!(parse_manifest("c.json", &base, 0).is_ok());
        let mut bad = base.clone();
        bad["compose"][0]["when"] = json!("fade == true");
        assert!(matches!(
            parse_manifest("c.json", &bad, 0),
            Err(MotionError::ManifestInvalid(_))
        ));
    }

    #[test]
    fn lengths_accept_bare_numbers_and_objects() {
        assert_eq!(
            parse_length_value(&json!(24.0)),
            Some(RelativeLength::absolute(24.0))
        );
        let rel = parse_length_value(&json!({"value": 0.04, "basis": "canvasShortEdge"})).unwrap();
        assert_eq!(rel.basis, LengthBasis::CanvasShortEdge);
        assert_eq!(rel.value, 0.04);
        assert!(parse_length_value(&json!("nope")).is_none());
    }

    #[test]
    fn param_type_checks_reject_out_of_range_and_wrong_kinds() {
        let ty = ParamType::Number {
            min: Some(0.0),
            max: Some(2.0),
        };
        assert!(ty.check("x", "intensity", &json!(1.0)).is_ok());
        assert!(ty.check("x", "intensity", &json!(3.0)).is_err());
        let ty = ParamType::Enum {
            options: vec!["up".into(), "down".into()],
        };
        assert!(ty.check("x", "direction", &json!("up")).is_ok());
        assert!(ty.check("x", "direction", &json!("sideways")).is_err());
    }
}
