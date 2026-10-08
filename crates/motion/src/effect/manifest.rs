//! Effect manifest（设计 §6.3）：效果是**数据配方**，不是代码分支。
//!
//! manifest 必须声明的东西（规范 §14.5）：uniform 类型/默认/范围、输入数、
//! 纹理坐标原点、颜色契约（`colorSpace` + `precision`）、premultiplied alpha、
//! 采样与边缘规则、`resizeMode`、`determinism`、`capabilities`、`fallback`、
//! `version`，以及**具名内核** `kernel`——CPU 参考实现按这个名字注册，
//! 未知内核名在解析期就被拒（与 preset 注册表同一纪律）。
//!
//! 键集是封闭的：多一个键就是 `manifest-invalid`。手滑写错的字段不会被静默忽略。

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use super::{
    BlendMode, ColorContract, ColorSpace, Determinism, EffectRef, Precision, UniformValue,
};
use crate::MotionError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum EffectDomain {
    /// 单输入像素滤镜。
    Filter,
    /// 遮罩：按几何 / 图像的覆盖率乘 alpha。
    Mask,
    /// 合成（blend 表）。
    Composite,
    /// 双画面转场：两张输入 surface + `progress ∈ [0, 1]` 闭区间（规范 §9）。
    Transition,
}

impl EffectDomain {
    pub fn as_str(self) -> &'static str {
        match self {
            EffectDomain::Filter => "filter",
            EffectDomain::Mask => "mask",
            EffectDomain::Composite => "composite",
            EffectDomain::Transition => "transition",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "filter" => Some(EffectDomain::Filter),
            "mask" => Some(EffectDomain::Mask),
            "composite" => Some(EffectDomain::Composite),
            "transition" => Some(EffectDomain::Transition),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParamKind {
    Number,
    /// 相对长度：以 `basis` 为基准，求值后再按 `quantize` 归整。
    Length,
    Bool,
    Enum,
    /// 非预乘 RGBA 0..1。
    Color,
    Vec2,
    Text,
}

impl ParamKind {
    fn parse(text: &str) -> Option<Self> {
        match text {
            "number" => Some(ParamKind::Number),
            "length" => Some(ParamKind::Length),
            "bool" => Some(ParamKind::Bool),
            "enum" => Some(ParamKind::Enum),
            "color" => Some(ParamKind::Color),
            "vec2" => Some(ParamKind::Vec2),
            "text" => Some(ParamKind::Text),
            _ => None,
        }
    }

    fn accepts(self, value: &UniformValue) -> bool {
        matches!(
            (self, value),
            (
                ParamKind::Number | ParamKind::Length,
                UniformValue::Scalar(_) | UniformValue::Int(_)
            ) | (ParamKind::Bool, UniformValue::Bool(_))
                | (ParamKind::Enum | ParamKind::Text, UniformValue::Text(_))
                | (ParamKind::Color, UniformValue::Color(_))
                | (ParamKind::Vec2, UniformValue::Vec2(_))
        )
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParamSpec {
    pub kind: ParamKind,
    /// 缺省值。`None` = 必填（调用方不给就是 `preset-param-missing`）。
    pub default: Option<UniformValue>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// `enum` 的取值闭集。
    pub options: Vec<String>,
    /// `length` 的基准名（`canvasShortEdge` / `inputShortEdge` / `px`）。
    pub basis: Option<String>,
    /// 求值后的归整规则（`round-to-int` / `none`）。
    pub quantize: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EffectManifest {
    pub id: String,
    pub version: u32,
    pub domain: EffectDomain,
    pub inputs: u8,
    pub params: BTreeMap<String, ParamSpec>,
    pub color: ColorContract,
    /// 具名 CPU 内核。`bcut-render::effects` 按这个名字注册实现。
    pub kernel: String,
    /// 纹理坐标原点。当前闭集只有 `top-left`。
    pub origin: String,
    /// alpha 约定。当前闭集只有 `premultiplied`。
    pub alpha: String,
    pub sampling: String,
    pub edge: String,
    pub resize_mode: String,
    pub determinism: Determinism,
    pub capabilities: Vec<String>,
    pub fallback: Option<EffectRef>,
    pub doc: Option<String>,
    /// manifest 源文本的指纹（进 FramePlan 指纹的 `pkg_hash` 用）。
    pub source_hash: u64,
}

impl EffectManifest {
    pub fn effect_ref(&self) -> EffectRef {
        EffectRef {
            id: self.id.clone(),
            version: self.version,
            pkg_hash: None,
        }
    }

    pub fn qualified(&self) -> String {
        format!("{}@{}", self.id, self.version)
    }

    /// 「没有参数 X」报错后面接的可用参数名单：作者没有别处能离线查到效果的参数表，
    /// 所以名单就放在报错里。没有参数的效果写「它不带参数」。
    pub fn params_hint(&self) -> String {
        if self.params.is_empty() {
            return "它不带参数".to_owned();
        }
        let names = self.params.keys().map(String::as_str).collect::<Vec<_>>();
        format!("可用参数：{}", names.join(" / "))
    }

    /// 校验并补全 uniform：未知参数 `preset-param-unknown`、缺必填
    /// `preset-param-missing`、类型不符 / 越界 `preset-param-invalid`。
    pub fn resolve_uniforms(
        &self,
        given: &super::UniformMap,
    ) -> Result<super::UniformMap, MotionError> {
        for (key, _) in given.iter() {
            if !self.params.contains_key(key) {
                return Err(MotionError::PresetParamUnknown(format!(
                    "{} 没有参数 {key}；{}",
                    self.qualified(),
                    self.params_hint()
                )));
            }
        }
        let mut out = super::UniformMap::new();
        for (key, spec) in &self.params {
            let value = match given.get(key) {
                Some(value) => value.clone(),
                None => match &spec.default {
                    Some(value) => value.clone(),
                    None => {
                        return Err(MotionError::PresetParamMissing(format!(
                            "{} 缺必填参数 {key}",
                            self.qualified()
                        )));
                    }
                },
            };
            if !spec.kind.accepts(&value) {
                return Err(MotionError::ManifestInvalid(format!(
                    "{} 的 {key} 类型不符（期望 {:?}）",
                    self.qualified(),
                    spec.kind
                )));
            }
            if let (ParamKind::Enum, Some(text)) = (spec.kind, value.as_str())
                && !spec.options.iter().any(|option| option == text)
            {
                return Err(MotionError::ManifestInvalid(format!(
                    "{} 的 {key} 取值 {text} 不在闭集 {:?}",
                    self.qualified(),
                    spec.options
                )));
            }
            let value = match (spec.min, spec.max, value.as_f64()) {
                (min, max, Some(number))
                    if matches!(spec.kind, ParamKind::Number | ParamKind::Length) =>
                {
                    let clamped = number
                        .max(min.unwrap_or(f64::NEG_INFINITY))
                        .min(max.unwrap_or(f64::INFINITY));
                    UniformValue::Scalar(clamped)
                }
                _ => value,
            };
            out.insert(key.clone(), value);
        }
        Ok(out)
    }
}

// ── 解析 ────────────────────────────────────────────────────────────

const MANIFEST_KEYS: &[&str] = &[
    "id",
    "version",
    "domain",
    "inputs",
    "params",
    "color",
    "kernel",
    "origin",
    "alpha",
    "sampling",
    "edge",
    "resizeMode",
    "determinism",
    "capabilities",
    "fallback",
    "doc",
    "blendModes",
];

const PARAM_KEYS: &[&str] = &[
    "type", "default", "min", "max", "options", "basis", "quantize", "doc",
];

/// `origin` / `alpha` / `sampling` / `edge` / `resizeMode` 的封闭取值。
const ORIGINS: &[&str] = &["top-left"];
const ALPHAS: &[&str] = &["premultiplied", "straight"];
const SAMPLINGS: &[&str] = &["nearest", "linear"];
const EDGES: &[&str] = &["clamp", "clamp-shrink-window", "transparent"];
const RESIZE_MODES: &[&str] = &["same-as-input", "canvas"];

fn invalid(message: impl Into<String>) -> MotionError {
    MotionError::ManifestInvalid(message.into())
}

fn closed_keys(
    object: &Map<String, Value>,
    allowed: &[&str],
    what: &str,
) -> Result<(), MotionError> {
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(invalid(format!("{what} 出现未知键 {key}")));
        }
    }
    Ok(())
}

fn closed_value<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    allowed: &[&str],
    id: &str,
) -> Result<&'a str, MotionError> {
    let text = object
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{id} 缺字符串 {key}")))?;
    if !allowed.contains(&text) {
        return Err(invalid(format!(
            "{id} 的 {key} = {text} 不在闭集 {allowed:?}"
        )));
    }
    Ok(text)
}

fn uniform_from_json(
    kind: ParamKind,
    value: &Value,
    what: &str,
) -> Result<UniformValue, MotionError> {
    let bad = || invalid(format!("{what} 的默认值与类型不符"));
    Ok(match kind {
        ParamKind::Number | ParamKind::Length => {
            UniformValue::Scalar(value.as_f64().ok_or_else(bad)?)
        }
        ParamKind::Bool => UniformValue::Bool(value.as_bool().ok_or_else(bad)?),
        ParamKind::Enum | ParamKind::Text => {
            UniformValue::Text(value.as_str().ok_or_else(bad)?.to_owned())
        }
        ParamKind::Color => {
            let array = value.as_array().ok_or_else(bad)?;
            if array.len() != 4 {
                return Err(bad());
            }
            let mut rgba = [0.0f64; 4];
            for (slot, item) in rgba.iter_mut().zip(array) {
                *slot = item.as_f64().ok_or_else(bad)?;
            }
            UniformValue::Color(rgba)
        }
        ParamKind::Vec2 => {
            let array = value.as_array().ok_or_else(bad)?;
            if array.len() != 2 {
                return Err(bad());
            }
            UniformValue::Vec2([
                array[0].as_f64().ok_or_else(bad)?,
                array[1].as_f64().ok_or_else(bad)?,
            ])
        }
    })
}

/// 解析一份 manifest 源文本。`source_hash` 由调用方按原文算。
pub fn parse_manifest(source: &str, source_hash: u64) -> Result<EffectManifest, MotionError> {
    let value: Value =
        serde_json::from_str(source).map_err(|error| invalid(format!("JSON 解析失败 {error}")))?;
    let object = value.as_object().ok_or_else(|| invalid("顶层必须是对象"))?;
    closed_keys(object, MANIFEST_KEYS, "effect manifest")?;

    let id = object
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("缺 id"))?
        .to_owned();
    let version = object
        .get("version")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid(format!("{id} 缺 version")))? as u32;
    if version == 0 {
        return Err(invalid(format!("{id} 的 version 必须 ≥ 1")));
    }
    let domain_text = object
        .get("domain")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{id} 缺 domain")))?;
    let domain = EffectDomain::parse(domain_text)
        .ok_or_else(|| invalid(format!("{id} 的 domain {domain_text} 未知")))?;
    let inputs = object
        .get("inputs")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid(format!("{id} 缺 inputs")))? as u8;

    let mut params = BTreeMap::new();
    if let Some(raw) = object.get("params") {
        let raw = raw
            .as_object()
            .ok_or_else(|| invalid(format!("{id} 的 params 必须是对象")))?;
        for (key, spec) in raw {
            let spec = spec
                .as_object()
                .ok_or_else(|| invalid(format!("{id}.{key} 的参数定义必须是对象")))?;
            closed_keys(spec, PARAM_KEYS, &format!("{id}.{key}"))?;
            let kind_text = spec
                .get("type")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid(format!("{id}.{key} 缺 type")))?;
            let kind = ParamKind::parse(kind_text)
                .ok_or_else(|| invalid(format!("{id}.{key} 的 type {kind_text} 未知")))?;
            let default = match spec.get("default") {
                Some(Value::Null) | None => None,
                Some(value) => Some(uniform_from_json(kind, value, &format!("{id}.{key}"))?),
            };
            let options: Vec<String> = spec
                .get("options")
                .and_then(Value::as_array)
                .map(|array| {
                    array
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            if kind == ParamKind::Enum && options.is_empty() {
                return Err(invalid(format!("{id}.{key} 是 enum 但没有 options")));
            }
            params.insert(
                key.clone(),
                ParamSpec {
                    kind,
                    default,
                    min: spec.get("min").and_then(Value::as_f64),
                    max: spec.get("max").and_then(Value::as_f64),
                    options,
                    basis: spec.get("basis").and_then(Value::as_str).map(str::to_owned),
                    quantize: spec
                        .get("quantize")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                },
            );
        }
    }

    let color_object = object
        .get("color")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid(format!("{id} 缺 color")))?;
    closed_keys(
        color_object,
        &["colorSpace", "precision"],
        &format!("{id}.color"),
    )?;
    let space_text = color_object
        .get("colorSpace")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{id} 缺 color.colorSpace")))?;
    let precision_text = color_object
        .get("precision")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{id} 缺 color.precision")))?;
    let color = ColorContract {
        space: ColorSpace::parse(space_text)
            .ok_or_else(|| invalid(format!("{id} 的 colorSpace {space_text} 未知")))?,
        precision: Precision::parse(precision_text)
            .ok_or_else(|| invalid(format!("{id} 的 precision {precision_text} 未知")))?,
    };

    let kernel = object
        .get("kernel")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{id} 缺 kernel")))?
        .to_owned();
    if kernel.is_empty() {
        return Err(invalid(format!("{id} 的 kernel 不能为空")));
    }
    let origin = closed_value(object, "origin", ORIGINS, &id)?.to_owned();
    let alpha = closed_value(object, "alpha", ALPHAS, &id)?.to_owned();
    let sampling = closed_value(object, "sampling", SAMPLINGS, &id)?.to_owned();
    let edge = closed_value(object, "edge", EDGES, &id)?.to_owned();
    let resize_mode = closed_value(object, "resizeMode", RESIZE_MODES, &id)?.to_owned();

    let determinism_text = object
        .get("determinism")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{id} 缺 determinism")))?;
    let determinism = Determinism::parse(determinism_text)
        .ok_or_else(|| invalid(format!("{id} 的 determinism {determinism_text} 未知")))?;

    let capabilities: Vec<String> = object
        .get("capabilities")
        .and_then(Value::as_array)
        .map(|array| {
            array
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    if determinism == Determinism::Strict && !capabilities.is_empty() {
        return Err(invalid(format!(
            "{id} 声明 strict 却要求后端能力 {capabilities:?}"
        )));
    }

    let fallback = match object.get("fallback") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => Some(parse_effect_ref(text, &id)?),
        Some(_) => return Err(invalid(format!("{id} 的 fallback 必须是 \"id@version\""))),
    };
    if determinism != Determinism::Strict && fallback.is_none() {
        return Err(invalid(format!(
            "{id} 是 {determinism_text} 等级，必须声明 fallback"
        )));
    }

    // `composite` 域的 blend 表必须与 `BlendMode` 的封闭枚举逐项对齐。
    if let Some(list) = object.get("blendModes") {
        let list = list
            .as_array()
            .ok_or_else(|| invalid(format!("{id} 的 blendModes 必须是数组")))?;
        if list.len() != BlendMode::ALL.len() {
            return Err(invalid(format!(
                "{id} 的 blendModes 有 {} 项，BlendMode 有 {}",
                list.len(),
                BlendMode::ALL.len()
            )));
        }
        for (index, item) in list.iter().enumerate() {
            let name = item
                .as_str()
                .ok_or_else(|| invalid(format!("{id} 的 blendModes[{index}] 不是字符串")))?;
            if BlendMode::ALL[index].as_str() != name {
                return Err(invalid(format!(
                    "{id} 的 blendModes[{index}] = {name}，BlendMode 是 {}",
                    BlendMode::ALL[index].as_str()
                )));
            }
        }
    }

    Ok(EffectManifest {
        id,
        version,
        domain,
        inputs,
        params,
        color,
        kernel,
        origin,
        alpha,
        sampling,
        edge,
        resize_mode,
        determinism,
        capabilities,
        fallback,
        doc: object.get("doc").and_then(Value::as_str).map(str::to_owned),
        source_hash,
    })
}

fn parse_effect_ref(text: &str, id: &str) -> Result<EffectRef, MotionError> {
    let (name, version) = text
        .rsplit_once('@')
        .ok_or_else(|| invalid(format!("{id} 的 fallback {text} 缺 @version")))?;
    let version: u32 = version
        .parse()
        .map_err(|_| invalid(format!("{id} 的 fallback {text} 版本非法")))?;
    Ok(EffectRef::new(name, version))
}
