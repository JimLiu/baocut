//! 视觉媒体与合成实例的效果（视频格式规范 §3.9）、遮罩，以及源画面的裁剪（§3.5）。
//!
//! `fx` 是 v2 元素模型的固定字段，渲染按规范里的固定顺序作用，与字段的书写顺序无关；取值区间以
//! `timeline::schema` 为准（`FX_AMOUNT_RANGE`、`FX_ADJUST_RANGE`、`FX_BLUR_RANGE`）。`temperature`、
//! `shadow`、`stroke` 是 v3 原有的三种效果并进来的字段，v2 没有，区间见这里的常量。

use message_ref::{Text, msg};
use serde::{Deserialize, Serialize};
pub use timeline::schema::{EffectPreset, FilterPreset, MaskShape};

/// `fx.temperature` 的区间。
pub const FX_TEMPERATURE_RANGE: (f64, f64) = (-1.0, 1.0);
/// `fx.shadow.blur` 的区间（540 短边下的像素）。
pub const FX_SHADOW_BLUR_RANGE: (f64, f64) = (0.0, 200.0);
/// `fx.stroke.width` 的上限（540 短边下的像素），下限不含 0。
pub const FX_STROKE_WIDTH_MAX: f64 = 100.0;
/// `fx.shadow.opacity` 的区间。
pub const FX_SHADOW_OPACITY_RANGE: (f64, f64) = (0.0, 1.0);

/// 固定字段的效果（§3.9）。省略或等于恒等值的字段不产生效果。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Fx {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_preset: Option<FilterPreset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effect_preset: Option<EffectPreset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effect_intensity: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grayscale: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brightness: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exposure: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contrast: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saturation: Option<f64>,
    /// [-1, 1]，乘 180 度。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hue: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    /// [0, 100]，540 短边下的像素。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blur: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sharpen: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub noise: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vignette: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<FxShadow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<FxStroke>,
}

/// 阴影：alpha 轮廓平移、模糊、填色，画在画面下面。长度是 540 短边下的像素，向右、向下为正。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FxShadow {
    pub offset_x: f64,
    pub offset_y: f64,
    pub blur: f64,
    pub color: String,
    pub opacity: f64,
}

/// 描边：沿 alpha 轮廓的外侧画一圈。`width` 在 (0, 100]，540 短边下的像素。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FxStroke {
    pub width: f64,
    pub color: String,
}

impl Fx {
    /// v2 的同名字段（不含 v3 并进来的三种），交给 `timeline` 校验与求值。
    pub fn to_timeline(&self) -> timeline::schema::Fx {
        timeline::schema::Fx {
            grayscale: self.grayscale,
            blur: self.blur,
            brightness: self.brightness,
            contrast: self.contrast,
            exposure: self.exposure,
            hue: self.hue,
            saturation: self.saturation,
            sharpen: self.sharpen,
            noise: self.noise,
            vignette: self.vignette,
            filter_preset: self.filter_preset,
            effect_preset: self.effect_preset,
            effect_intensity: self.effect_intensity,
        }
    }

    /// v3 并进来的三种字段的取值检查；v2 的字段由 `timeline::schema::Fx::validate` 检查。
    pub fn check_v3_fields(&self) -> Result<(), Text> {
        let (lo, hi) = FX_TEMPERATURE_RANGE;
        if self.temperature.is_some_and(|v| !v.is_finite() || !(lo..=hi).contains(&v)) {
            return Err(msg!("videoModel.fxTemperatureRange", "fx.temperature must be within -1..=1"));
        }
        if let Some(shadow) = &self.shadow {
            let (lo, hi) = FX_SHADOW_BLUR_RANGE;
            if !shadow.offset_x.is_finite() || !shadow.offset_y.is_finite() {
                return Err(msg!("videoModel.fxShadowOffset", "The fx.shadow offsets must be finite numbers"));
            }
            if !shadow.blur.is_finite() || !(lo..=hi).contains(&shadow.blur) {
                return Err(msg!("videoModel.fxShadowBlurRange", "fx.shadow.blur must be within 0..=200"));
            }
            let (lo, hi) = FX_SHADOW_OPACITY_RANGE;
            if !shadow.opacity.is_finite() || !(lo..=hi).contains(&shadow.opacity) {
                return Err(msg!("videoModel.fxShadowOpacityRange", "fx.shadow.opacity must be within 0..=1"));
            }
            if !is_color(&shadow.color) {
                return Err(msg!("videoModel.fxShadowColor", "fx.shadow.color must be #RRGGBB or #RRGGBBAA"));
            }
        }
        if let Some(stroke) = &self.stroke {
            if !stroke.width.is_finite() || stroke.width <= 0.0 || stroke.width > FX_STROKE_WIDTH_MAX {
                return Err(msg!("videoModel.fxStrokeWidthRange", "fx.stroke.width must be within (0, 100]"));
            }
            if !is_color(&stroke.color) {
                return Err(msg!("videoModel.fxStrokeColor", "fx.stroke.color must be #RRGGBB or #RRGGBBAA"));
            }
        }
        Ok(())
    }

    /// 没有任何字段：等于没有效果。
    pub fn is_empty(&self) -> bool {
        *self == Fx::default()
    }
}

/// 遮罩（§3.9）：内切于框的椭圆，`feather` 是 540 短边下的像素。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mask {
    pub shape: MaskShape,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feather: Option<f64>,
}

impl Mask {
    pub fn to_timeline(&self) -> timeline::schema::Mask {
        timeline::schema::Mask {
            shape: self.shape,
            feather: self.feather,
        }
    }
}

/// 源画面的裁剪（§3.5）：四边各裁掉的比例。
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Crop {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

impl Crop {
    /// 每边在 [0, 1)，左右、上下加起来小于 1（留下的画面有面积）。
    pub fn is_valid(&self) -> bool {
        let sides = [self.left, self.top, self.right, self.bottom];
        sides.iter().all(|v| v.is_finite() && (0.0..1.0).contains(v)) && self.left + self.right < 1.0 && self.top + self.bottom < 1.0
    }

    /// 四边都是 0：等于没有裁剪。
    pub fn is_empty(&self) -> bool {
        self.left == 0.0 && self.top == 0.0 && self.right == 0.0 && self.bottom == 0.0
    }

    /// 留下的区域，相对源的显示尺寸归一化的 `[u0, v0, u1, v1]`。
    pub fn rect(&self) -> [f64; 4] {
        [self.left, self.top, 1.0 - self.right, 1.0 - self.bottom]
    }
}

/// `#RRGGBB` 或 `#RRGGBBAA`（§3.7：颜色一律这两种写法）。
pub fn is_color(text: &str) -> bool {
    matches!(text.len(), 7 | 9) && text.starts_with('#') && text[1..].chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fx_round_trips_without_nulls_and_checks_the_v3_fields() {
        let value = json!({
            "filterPreset": "calm1", "effectPreset": "night_vision", "brightness": 0.2, "temperature": -0.5,
            "shadow": { "offsetX": 4.0, "offsetY": 4.0, "blur": 8.0, "color": "#000000", "opacity": 0.5 },
            "stroke": { "width": 3.0, "color": "#FFFFFF" }
        });
        let fx: Fx = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(&fx).unwrap(), value);
        assert!(fx.check_v3_fields().is_ok());
        assert!(fx.to_timeline().validate("e").is_ok());
        let bad = Fx {
            temperature: Some(2.0),
            ..Fx::default()
        };
        assert!(bad.check_v3_fields().is_err());
        let bad = Fx {
            stroke: Some(FxStroke {
                width: 0.0,
                color: "#FFFFFF".into(),
            }),
            ..Fx::default()
        };
        assert!(bad.check_v3_fields().is_err());
    }

    #[test]
    fn crop_bounds() {
        let crop = Crop {
            left: 0.1,
            top: 0.0,
            right: 0.2,
            bottom: 0.5,
        };
        assert!(crop.is_valid());
        assert_eq!(crop.rect(), [0.1, 0.0, 0.8, 0.5]);
        assert!(
            !Crop {
                left: 0.6,
                top: 0.0,
                right: 0.4,
                bottom: 0.0
            }
            .is_valid()
        );
    }
}
