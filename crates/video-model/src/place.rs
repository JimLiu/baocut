//! 画面实例的几何与视觉媒体的公共字段（视频格式规范 §3.5）。
//!
//! 字段名、取值与缺省以 v2 的 `timeline::schema` 为准；这里是不写 `null` 的交换形式，
//! 校验与求值时换成 `timeline` 的同名类型（`to_timeline`）。

use serde::{Deserialize, Serialize};
pub use timeline::schema::{Background, CornerRadii, Fit, VisualMode};

use crate::effect::{Fx, Mask};

/// 几何（§3.5）：按画幅的百分比保存。缺省按种类，见 `timeline::geometry::default_place`。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Place {
    /// 框中心的横坐标，画布宽的百分比，左边为 0。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    /// 框中心的纵坐标，画布高的百分比，上边为 0。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    /// 框宽，宽度基准的百分比。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale_y: Option<f64>,
    /// 度，绕框中心顺时针。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rot: Option<f64>,
    /// [0, 1]，缺省 1。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    /// 四角相同的圆角，540 短边下的像素。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radius: Option<f64>,
    /// 四角各自的圆角，单位同 `radius`；两者都有时它优先。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corner_radii: Option<CornerRadii>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub flip_x: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub flip_y: bool,
}

impl Place {
    pub fn to_timeline(&self) -> timeline::schema::Place {
        timeline::schema::Place {
            x: self.x,
            y: self.y,
            w: self.w,
            scale: self.scale,
            scale_y: self.scale_y,
            rot: self.rot,
            opacity: self.opacity,
            radius: self.radius,
            corner_radii: self.corner_radii,
            flip_x: self.flip_x.then_some(true),
            flip_y: self.flip_y.then_some(true),
        }
    }

    /// 不透明度，缺省 1。
    pub fn opacity(&self) -> f64 {
        self.opacity.unwrap_or(1.0)
    }

    /// 四个角的圆角 `[左上, 右上, 右下, 左下]`，540 短边下的像素。
    pub fn corner_radii(&self) -> [f64; 4] {
        self.to_timeline().corner_radii()
    }
}

/// 平铺（§3.5）：不平铺时整个省略。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tile {
    pub on: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub angle: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap_x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap_y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stagger: Option<bool>,
}

impl Tile {
    pub fn to_timeline(&self) -> timeline::schema::Tile {
        timeline::schema::Tile {
            on: self.on,
            angle: self.angle,
            gap_x: self.gap_x,
            gap_y: self.gap_y,
            stagger: self.stagger,
        }
    }
}

/// 视觉媒体的公共字段（§3.4 `MediaFields`）：视频、图片、占位框、白板与素材贴纸。
/// `mask`、`fx` 也用于合成实例，那里单独写。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFields {
    /// 缺省 `pip`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<VisualMode>,
    /// 缺省 `cover`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fit: Option<Fit>,
    /// 缺省 `black`；只在 `fullscreen` 加 `contain` 时起作用。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<Background>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<Mask>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fx: Option<Fx>,
}

impl MediaFields {
    pub fn is_empty(&self) -> bool {
        *self == MediaFields::default()
    }

    pub fn mode(&self) -> VisualMode {
        self.mode.unwrap_or(VisualMode::Pip)
    }

    pub fn fit(&self) -> Fit {
        self.fit.unwrap_or(Fit::Cover)
    }

    pub fn bg(&self) -> Background {
        self.bg.unwrap_or(Background::Black)
    }
}

pub(crate) fn is_false(value: &bool) -> bool {
    !*value
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn place_omits_absent_fields_and_maps_to_timeline() {
        let value = json!({ "x": 50.0, "w": 34.0, "opacity": 0.5, "flipX": true });
        let place: Place = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(&place).unwrap(), value);
        let v2 = place.to_timeline();
        assert_eq!(v2.flip_x, Some(true));
        assert_eq!(v2.flip_y, None);
        assert!(v2.validate("e").is_ok());
        assert!(serde_json::from_value::<Place>(json!({ "width": 3 })).is_err());
    }

    #[test]
    fn background_reads_any_case_and_writes_upper() {
        let media: MediaFields = serde_json::from_value(json!({ "bg": "#a0b1c2", "fit": "contain" })).unwrap();
        assert_eq!(serde_json::to_value(&media).unwrap(), json!({ "fit": "contain", "bg": "#A0B1C2" }));
    }
}
