//! manifest 解析的共享取值助手（阶段 2 从 `preset_registry.rs` 原样搬出）。

use serde_json::Value;

use crate::MotionError;
use crate::curve::CurveSpec;
use crate::relative_value::{LengthBasis, RelativeLength};

pub(crate) fn field<'a>(file: &str, doc: &'a Value, key: &str) -> Result<&'a Value, MotionError> {
    doc.get(key)
        .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: missing \"{key}\"")))
}

pub(crate) fn number(file: &str, doc: &Value, key: &str) -> Result<f64, MotionError> {
    field(file, doc, key)?
        .as_f64()
        .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: \"{key}\" is not a number")))
}

pub(crate) fn text<'a>(file: &str, doc: &'a Value, key: &str) -> Result<&'a str, MotionError> {
    field(file, doc, key)?
        .as_str()
        .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: \"{key}\" is not a string")))
}

pub(crate) fn version(file: &str, doc: &Value) -> Result<u32, MotionError> {
    field(file, doc, "version")?
        .as_u64()
        .map(|v| v as u32)
        .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: bad \"version\"")))
}

pub(crate) fn parse_curve(file: &str, value: &Value) -> Result<CurveSpec, MotionError> {
    match value.get("kind").and_then(Value::as_str) {
        Some("named") => {
            let name = text(file, value, "name")?;
            Ok(CurveSpec::from_name(name))
        }
        Some("spring") => Ok(CurveSpec::Spring {
            response: number(file, value, "response")?,
            damping: number(file, value, "damping")?,
        }),
        other => Err(MotionError::ManifestInvalid(format!(
            "{file}: unknown curve kind {other:?}"
        ))),
    }
}

pub(crate) fn parse_length(file: &str, doc: &Value) -> Result<RelativeLength, MotionError> {
    let basis = LengthBasis::parse(text(file, doc, "basis")?)
        .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: unknown length basis")))?;
    Ok(RelativeLength {
        value: number(file, doc, "value")?,
        basis,
        offset_px: doc.get("offsetPx").and_then(Value::as_f64).unwrap_or(0.0),
    })
}
