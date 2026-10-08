//! 强类型动画值与属性词汇表（设计 §5.1）。
//!
//! `PropertyId` 优先指向 `MOTION_PROPS` 里的 `'static` 名字；BCF 文档可以写出
//! 不在表内的通道名（例如 camera clip 的 `camera`），因此保留 `Cow` 逃生口，
//! 只有表内属性才有 `PoseBuffer` 槽位。

use std::borrow::Cow;

use serde_json::Value;

/// 可动画属性 allowlist（规范 §6.4）。`bcut-core::lint::ANIM_PROPS` 从这里 re-export。
pub const ANIM_PROPS: &[&str] = &[
    "x",
    "y",
    "scale",
    "scaleX",
    "scaleY",
    "rotation",
    "rotationX",
    "rotationY",
    "skewX",
    "skewY",
    "opacity",
    "blur",
    "color",
    "backgroundColor",
    "borderRadius",
    "clipPath",
    "pathDraw",
    "pathMorph",
    "textCount",
    "text",
    "textReveal",
    "fontWeight",
    "letterSpacing",
    "crop",
    "focalX",
    "focalY",
    "pathStart",
    "pathEnd",
    "dashOffset",
    "pathProgress",
    "volume",
];

/// 效果参数通道（规范 §6.6）：`effects[N].<param>` 拆成 `(N, param)`。
///
/// 只认规范写法：`N` 是不带前导零的十进制下标，`param` 是 manifest 参数名
/// （ASCII 字母数字）。下标是否越界、参数是否存在且为数值，由 lint 对照节点的
/// `effects[]` 检查；渲染期查不到对应条目的通道静默忽略。
pub fn effect_param_channel(prop: &str) -> Option<(usize, &str)> {
    let rest = prop.strip_prefix("effects[")?;
    let (index, param) = rest.split_once("].")?;
    if index.is_empty()
        || !index.bytes().all(|b| b.is_ascii_digit())
        || (index.len() > 1 && index.starts_with('0'))
        || param.is_empty()
        || !param.bytes().all(|b| b.is_ascii_alphanumeric())
    {
        return None;
    }
    Some((index.parse().ok()?, param))
}

/// 可动画属性：`ANIM_PROPS` 里的具名属性，或 `effects[N].<param>` 效果参数通道。
pub fn is_animatable(prop: &str) -> bool {
    ANIM_PROPS.contains(&prop) || effect_param_channel(prop).is_some()
}

/// 「不在可动画属性 allowlist」报错的补充：静态样式键与动画通道不同名的只有背景色
/// （style 写 `background`，通道叫 `backgroundColor`），写成样式键时直接指到通道名。
pub fn not_animatable_hint(prop: &str) -> &'static str {
    match prop {
        "background" => "；背景色的动画通道叫 backgroundColor（style 里仍写 background）",
        _ => "",
    }
}

/// 允许写相对长度的属性（规范 §7.8：相对值只用于 transform、blur 与效果参数，
/// **不得**反向影响布局）。`width/height/gap/padding/layout` 本来就不在
/// `ANIM_PROPS` 里，写进 keyframes 是 schema 硬错误。
pub const RELATIVE_LENGTH_PROPS: &[&str] = &["x", "y", "dx", "dy", "blur", "borderRadius"];

/// Timeline `AnimationPose` 的 8 个通道，顺序即 `PoseBuffer` 前 8 个槽位。
pub const POSE_PROPS: &[&str] = &[
    "opacity", "dx", "dy", "scaleX", "scaleY", "rotation", "blur", "reveal",
];

/// `PoseBuffer` 槽位表：`POSE_PROPS` 在前，其余为 BCF 通道名。顺序是稳定契约。
pub const MOTION_PROPS: &[&str] = &[
    // POSE_PROPS（槽位 0..8）
    "opacity",
    "dx",
    "dy",
    "scaleX",
    "scaleY",
    "rotation",
    "blur",
    "reveal",
    // BCF 通道
    "x",
    "y",
    "scale",
    "rotationX",
    "rotationY",
    "skewX",
    "skewY",
    "color",
    "backgroundColor",
    "borderRadius",
    "clipPath",
    "pathDraw",
    "pathMorph",
    "textCount",
    "volume",
    "cam",
    "camera",
    // Append new slots; existing indices remain stable.
    "text",
    "textReveal",
    "fontWeight",
    "letterSpacing",
    "crop",
    "focalX",
    "focalY",
    "pathStart",
    "pathEnd",
    "dashOffset",
    "pathProgress",
];

pub const MOTION_PROP_COUNT: usize = MOTION_PROPS.len();

/// 属性名。表内名字是 `'static`，表外名字按 BCF 原文保留。
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct PropertyId(Cow<'static, str>);

impl PropertyId {
    /// 表内属性的常量构造（编译期即可用）。
    pub const fn known(name: &'static str) -> Self {
        Self(Cow::Borrowed(name))
    }

    pub fn parse(name: &str) -> Self {
        match MOTION_PROPS.iter().find(|known| **known == name) {
            Some(known) => Self(Cow::Borrowed(known)),
            None => Self(Cow::Owned(name.to_owned())),
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// `PoseBuffer` 槽位；表外属性没有槽位。
    pub fn slot(&self) -> Option<usize> {
        MOTION_PROPS.iter().position(|known| *known == self.0)
    }
}

impl std::fmt::Display for PropertyId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValueKind {
    Scalar,
    LengthPx,
    Vec2,
    AngleDeg,
    Color,
    Discrete,
}

/// 0..255 分量 + 0..1 alpha，镜像 `scene_primitives::color::Rgba`。
///
/// 阶段 1 不产出这个变体：`mix_value` 仍依赖 `bcut-core` 的颜色解析与 CSS 输出，
/// 搬迁会把颜色 golden 拖进同一个 PR（计划 §1.2）。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rgba {
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum MotionValue {
    Scalar(f64),
    LengthPx(f64),
    Vec2([f64; 2]),
    AngleDeg(f64),
    Color(Rgba),
    /// 阶跃值；同时是 BCF 原始 JSON 的无损载体（计划 §4.4）。
    Discrete(Value),
}

/// 设计 §5.1 的属性 → 类型表（阶段 1 子集）。
pub fn property_kind(prop: &str) -> ValueKind {
    match prop {
        "x" | "y" | "scale" | "scaleX" | "scaleY" | "rotation" | "opacity" | "blur"
        | "textCount" | "textReveal" | "fontWeight" | "letterSpacing" | "volume" | "pathDraw"
        | "pathMorph" | "dx" | "dy" | "reveal" | "focalX" | "focalY" | "pathStart" | "pathEnd"
        | "dashOffset" | "pathProgress" => ValueKind::Scalar,
        "rotationX" | "rotationY" | "skewX" | "skewY" => ValueKind::AngleDeg,
        other if effect_param_channel(other).is_some() => ValueKind::Scalar,
        _ => ValueKind::Discrete,
    }
}

impl MotionValue {
    /// JSON → 强类型。
    ///
    /// **只有能逐位往返的数字**才会被识别为标量：`Value::from(n) == *v` 不成立时
    /// （典型是整数 `0` 与 `0.0` 的 serde_json 变体差异）保留 `Discrete(v.clone())`，
    /// 这样 `to_json()` 一定还原原文，`to_channels(to_program(chs)) == chs` 才是
    /// 构造上成立而不是碰巧成立（计划 §4.4）。
    pub fn from_json(prop: &str, v: &Value) -> Self {
        let kind = property_kind(prop);
        match kind {
            ValueKind::Scalar | ValueKind::LengthPx | ValueKind::AngleDeg => {
                // `v.is_f64()` ⟺ `Value::from(n) == *v`：JSON 数字里只有 Float 变体
                // 能被 `Value::from(f64)` 原样还原，整数 `0` 会变成 `0.0`。
                if let Some(n) = v.as_f64()
                    && v.is_f64()
                {
                    return match kind {
                        ValueKind::AngleDeg => Self::AngleDeg(n),
                        ValueKind::LengthPx => Self::LengthPx(n),
                        _ => Self::Scalar(n),
                    };
                }
                Self::Discrete(v.clone())
            }
            _ => Self::Discrete(v.clone()),
        }
    }

    pub fn to_json(&self) -> Value {
        match self {
            Self::Scalar(n) | Self::LengthPx(n) | Self::AngleDeg(n) => Value::from(*n),
            Self::Vec2([x, y]) => Value::Array(vec![Value::from(*x), Value::from(*y)]),
            Self::Color(c) => Value::String(format!("rgba({}, {}, {}, {})", c.r, c.g, c.b, c.a)),
            Self::Discrete(v) => v.clone(),
        }
    }

    /// 标量视角；`Discrete` 里的数字也算（指纹与等价性判定用）。
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Self::Scalar(n) | Self::LengthPx(n) | Self::AngleDeg(n) => Some(*n),
            Self::Discrete(v) => v.as_f64(),
            _ => None,
        }
    }

    pub fn kind(&self) -> ValueKind {
        match self {
            Self::Scalar(_) => ValueKind::Scalar,
            Self::LengthPx(_) => ValueKind::LengthPx,
            Self::Vec2(_) => ValueKind::Vec2,
            Self::AngleDeg(_) => ValueKind::AngleDeg,
            Self::Color(_) => ValueKind::Color,
            Self::Discrete(_) => ValueKind::Discrete,
        }
    }

    /// 同类标量的原地替换，保持变体不变。
    pub fn with_scalar(&self, n: f64) -> Self {
        match self {
            Self::LengthPx(_) => Self::LengthPx(n),
            Self::AngleDeg(_) => Self::AngleDeg(n),
            _ => Self::Scalar(n),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pose_props_are_the_first_slots() {
        for (index, name) in POSE_PROPS.iter().enumerate() {
            assert_eq!(PropertyId::parse(name).slot(), Some(index));
        }
    }

    #[test]
    fn effect_param_channels_parse_only_the_canonical_form() {
        assert_eq!(
            effect_param_channel("effects[0].intensity"),
            Some((0, "intensity"))
        );
        assert_eq!(effect_param_channel("effects[12].tint"), Some((12, "tint")));
        for bad in [
            "effects[].x",
            "effects[01].x",
            "effects[0]x",
            "effects[0].",
            "effects[-1].x",
            "effects[0].a.b",
            "effect[0].x",
        ] {
            assert_eq!(effect_param_channel(bad), None, "{bad}");
        }
        assert!(is_animatable("effects[1].threshold"));
        assert!(is_animatable("opacity"));
        assert!(!is_animatable("width"));
        assert_eq!(property_kind("effects[0].gain"), ValueKind::Scalar);
    }

    #[test]
    fn motion_props_have_no_duplicates() {
        let mut seen = MOTION_PROPS.to_vec();
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), MOTION_PROPS.len());
    }

    #[test]
    fn anim_props_are_all_addressable() {
        for prop in ANIM_PROPS {
            assert!(PropertyId::parse(prop).slot().is_some(), "{prop}");
        }
    }

    #[test]
    fn integers_stay_discrete_so_json_round_trips_verbatim() {
        let v = json!(0);
        let typed = MotionValue::from_json("opacity", &v);
        assert!(matches!(typed, MotionValue::Discrete(_)));
        assert_eq!(typed.to_json(), v);
        assert_eq!(typed.as_f64(), Some(0.0));

        let f = json!(0.0);
        let typed = MotionValue::from_json("opacity", &f);
        assert_eq!(typed, MotionValue::Scalar(0.0));
        assert_eq!(typed.to_json(), f);
    }

    #[test]
    fn unknown_property_keeps_its_name_without_a_slot() {
        let id = PropertyId::parse("notAProperty");
        assert_eq!(id.as_str(), "notAProperty");
        assert_eq!(id.slot(), None);
    }
}
