//! Effect 词汇（设计 §6.3 / §1.1 的第三条决策：manifest 与效果标识住在
//! **纯函数层** `bcut-motion`，`bcut-render` 只持有 CPU 实现）。
//!
//! 本模块只有**值类型**：效果引用、uniform、确定性等级、颜色契约、混合模式。
//! manifest 解析与内置注册表见同目录的后续文件；CPU 参考实现见
//! `bcut-render::effects`。
//!
//! 三条纪律：
//! 1. `BlendMode` 是**封闭枚举 + 稳定 u8 编号**——DrawOp v3 的
//!    `PushLayer{blend}` 与 `composite/blend.json` 都从这里取号，不许出现第二张表。
//! 2. `UniformMap` 用 `BTreeMap` ⇒ 键序天然有序，编码/指纹无需再排序。
//! 3. 浮点 uniform 在编码时把 `-0.0` 归一到 `+0.0`（与 DrawOp 同规则）。

pub mod manifest;
pub mod registry;

pub use manifest::{EffectDomain, EffectManifest, ParamKind, ParamSpec, parse_manifest};
pub use registry::{
    EffectRegistry, builtin_registry, lookup, registered_effect_files, validate_all_effects,
};

use std::collections::BTreeMap;

/// 效果引用：`(id, version)` 冻结，`pkg_hash` 供第三方包使用（阶段 7）。
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EffectRef {
    pub id: String,
    pub version: u32,
    pub pkg_hash: Option<u64>,
}

impl EffectRef {
    pub fn new(id: impl Into<String>, version: u32) -> Self {
        EffectRef {
            id: id.into(),
            version,
            pkg_hash: None,
        }
    }

    /// `"filter.blur@1"`——诊断与夹具目录名的规范写法。
    pub fn qualified(&self) -> String {
        format!("{}@{}", self.id, self.version)
    }
}

/// uniform 取值。刻意封闭：BCF 里不允许表达式，效果参数只能是这几种字面量。
#[derive(Debug, Clone, PartialEq)]
pub enum UniformValue {
    Scalar(f64),
    Int(i64),
    Bool(bool),
    Vec2([f64; 2]),
    Vec4([f64; 4]),
    /// 非预乘 RGBA，0..1。
    Color([f64; 4]),
    Text(String),
}

impl UniformValue {
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            UniformValue::Scalar(v) => Some(*v),
            UniformValue::Int(v) => Some(*v as f64),
            UniformValue::Bool(v) => Some(if *v { 1.0 } else { 0.0 }),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            UniformValue::Bool(v) => Some(*v),
            UniformValue::Scalar(v) => Some(*v != 0.0),
            UniformValue::Int(v) => Some(*v != 0),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            UniformValue::Text(v) => Some(v.as_str()),
            _ => None,
        }
    }

    /// 编码期的类型标签（进指纹，避免 `Scalar(1.0)` 与 `Int(1)` 撞码）。
    pub fn tag(&self) -> u8 {
        match self {
            UniformValue::Scalar(_) => 0,
            UniformValue::Int(_) => 1,
            UniformValue::Bool(_) => 2,
            UniformValue::Vec2(_) => 3,
            UniformValue::Vec4(_) => 4,
            UniformValue::Color(_) => 5,
            UniformValue::Text(_) => 6,
        }
    }
}

/// 有序 uniform 表。`BTreeMap` ⇒ 迭代序 = 键的字典序，编码天然确定。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct UniformMap(BTreeMap<String, UniformValue>);

impl UniformMap {
    pub fn new() -> Self {
        UniformMap(BTreeMap::new())
    }

    pub fn insert(&mut self, key: impl Into<String>, value: UniformValue) -> &mut Self {
        self.0.insert(key.into(), value);
        self
    }

    pub fn with(mut self, key: impl Into<String>, value: UniformValue) -> Self {
        self.insert(key, value);
        self
    }

    pub fn scalar(&self, key: &str) -> Option<f64> {
        self.0.get(key).and_then(UniformValue::as_f64)
    }

    pub fn bool(&self, key: &str) -> Option<bool> {
        self.0.get(key).and_then(UniformValue::as_bool)
    }

    pub fn text(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(UniformValue::as_str)
    }

    pub fn get(&self, key: &str) -> Option<&UniformValue> {
        self.0.get(key)
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&String, &UniformValue)> {
        self.0.iter()
    }
}

impl FromIterator<(String, UniformValue)> for UniformMap {
    fn from_iter<T: IntoIterator<Item = (String, UniformValue)>>(iter: T) -> Self {
        UniformMap(iter.into_iter().collect())
    }
}

/// 确定性等级（ADR-M05）。`strict` 必须有 CPU reference executor。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub enum Determinism {
    #[default]
    Strict,
    Visual,
    Backend,
}

impl Determinism {
    pub fn as_str(self) -> &'static str {
        match self {
            Determinism::Strict => "strict",
            Determinism::Visual => "visual",
            Determinism::Backend => "backend",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "strict" => Some(Determinism::Strict),
            "visual" => Some(Determinism::Visual),
            "backend" => Some(Determinism::Backend),
            _ => None,
        }
    }

    pub fn code(self) -> u8 {
        match self {
            Determinism::Strict => 0,
            Determinism::Visual => 1,
            Determinism::Backend => 2,
        }
    }
}

/// 效果运算的颜色空间。v1 的迁移配方一律 `srgb-premultiplied`——那是
/// `studio_export` 现有实现的事实，改成 linear 就是改像素（设计 §15 阶段 4 记录）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum ColorSpace {
    #[default]
    SrgbPremultiplied,
    LinearPremultiplied,
}

impl ColorSpace {
    pub fn as_str(self) -> &'static str {
        match self {
            ColorSpace::SrgbPremultiplied => "srgb-premultiplied",
            ColorSpace::LinearPremultiplied => "linear-premultiplied",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "srgb-premultiplied" => Some(ColorSpace::SrgbPremultiplied),
            "linear-premultiplied" => Some(ColorSpace::LinearPremultiplied),
            _ => None,
        }
    }

    pub fn code(self) -> u8 {
        match self {
            ColorSpace::SrgbPremultiplied => 0,
            ColorSpace::LinearPremultiplied => 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Precision {
    #[default]
    U8,
    F32,
}

impl Precision {
    pub fn as_str(self) -> &'static str {
        match self {
            Precision::U8 => "u8",
            Precision::F32 => "f32",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "u8" => Some(Precision::U8),
            "f32" => Some(Precision::F32),
            _ => None,
        }
    }

    pub fn code(self) -> u8 {
        match self {
            Precision::U8 => 0,
            Precision::F32 => 1,
        }
    }
}

/// manifest 必须声明的颜色契约（设计 §6.3）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct ColorContract {
    pub space: ColorSpace,
    pub precision: Precision,
}

impl ColorContract {
    pub const SRGB_U8: ColorContract = ColorContract {
        space: ColorSpace::SrgbPremultiplied,
        precision: Precision::U8,
    };
}

/// 混合模式。**编号是持久契约**：DrawOp v3 的 `PushLayer{blend}` 与
/// `core/presets/builtin/composite/blend.json` 都引用这张表，不许重排。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub enum BlendMode {
    #[default]
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    Difference,
    Exclusion,
    Plus,
}

/// 声明序 = 编号序；`BlendMode::ALL[i].code() == i`（有测试守）。
impl BlendMode {
    pub const ALL: [BlendMode; 9] = [
        BlendMode::Normal,
        BlendMode::Multiply,
        BlendMode::Screen,
        BlendMode::Overlay,
        BlendMode::Darken,
        BlendMode::Lighten,
        BlendMode::Difference,
        BlendMode::Exclusion,
        BlendMode::Plus,
    ];

    pub fn code(self) -> u8 {
        match self {
            BlendMode::Normal => 0,
            BlendMode::Multiply => 1,
            BlendMode::Screen => 2,
            BlendMode::Overlay => 3,
            BlendMode::Darken => 4,
            BlendMode::Lighten => 5,
            BlendMode::Difference => 6,
            BlendMode::Exclusion => 7,
            BlendMode::Plus => 8,
        }
    }

    pub fn from_code(code: u8) -> Option<Self> {
        BlendMode::ALL.get(code as usize).copied()
    }

    pub fn as_str(self) -> &'static str {
        match self {
            BlendMode::Normal => "normal",
            BlendMode::Multiply => "multiply",
            BlendMode::Screen => "screen",
            BlendMode::Overlay => "overlay",
            BlendMode::Darken => "darken",
            BlendMode::Lighten => "lighten",
            BlendMode::Difference => "difference",
            BlendMode::Exclusion => "exclusion",
            BlendMode::Plus => "plus",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        BlendMode::ALL.into_iter().find(|m| m.as_str() == text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blend_codes_are_declaration_order() {
        for (index, mode) in BlendMode::ALL.into_iter().enumerate() {
            assert_eq!(mode.code() as usize, index, "{mode:?} 的编号必须等于声明序");
            assert_eq!(BlendMode::from_code(index as u8), Some(mode));
            assert_eq!(BlendMode::parse(mode.as_str()), Some(mode));
        }
        assert_eq!(BlendMode::from_code(9), None);
    }

    #[test]
    fn uniform_map_iterates_in_key_order() {
        let map = UniformMap::new()
            .with("radius", UniformValue::Scalar(4.0))
            .with("alpha", UniformValue::Scalar(1.0))
            .with("mode", UniformValue::Text("box".to_owned()));
        let keys = map.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>();
        assert_eq!(keys, ["alpha", "mode", "radius"]);
    }

    #[test]
    fn enums_round_trip_through_text() {
        for value in [
            Determinism::Strict,
            Determinism::Visual,
            Determinism::Backend,
        ] {
            assert_eq!(Determinism::parse(value.as_str()), Some(value));
        }
        for value in [
            ColorSpace::SrgbPremultiplied,
            ColorSpace::LinearPremultiplied,
        ] {
            assert_eq!(ColorSpace::parse(value.as_str()), Some(value));
        }
        for value in [Precision::U8, Precision::F32] {
            assert_eq!(Precision::parse(value.as_str()), Some(value));
        }
    }
}
