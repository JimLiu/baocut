//! 关键帧与元素动画（视频格式规范 §3.15）。
//!
//! 元素动画的三槽是实例的正式字段，原样保存，渲染时由 `motion` 取样；预设名、区间与缓动名以
//! `timeline::schema` 的 `Animation::validate` 为准。关键帧是序列上的 `AnimationBinding`：时刻是实例
//! 局部的帧或实例长度的百分比，校验时换成 `timeline::keyframes::Keyframes` 交给 `timeline`。

use message_ref::{Text, msg};
use serde::{Deserialize, Serialize};

use crate::Id;

/// 元素动画的三槽。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Animation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enter: Option<AnimationSlot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit: Option<AnimationSlot>,
    #[serde(default, rename = "loop", skip_serializing_if = "Option::is_none")]
    pub r#loop: Option<AnimationSlot>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnimationSlot {
    pub preset: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dur: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intensity: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ease: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stagger: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stagger_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub period: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<u64>,
}

impl Animation {
    pub fn is_empty(&self) -> bool {
        self.enter.is_none() && self.exit.is_none() && self.r#loop.is_none()
    }

    pub fn to_timeline(&self) -> timeline::schema::Animation {
        timeline::schema::Animation {
            enter: self.enter.as_ref().map(AnimationSlot::to_timeline),
            exit: self.exit.as_ref().map(AnimationSlot::to_timeline),
            r#loop: self.r#loop.as_ref().map(AnimationSlot::to_timeline),
        }
    }
}

impl AnimationSlot {
    pub fn to_timeline(&self) -> timeline::schema::AnimationSlot {
        timeline::schema::AnimationSlot {
            preset: self.preset.clone(),
            preset_version: self.preset_version,
            dur: self.dur,
            delay: self.delay,
            intensity: self.intensity,
            ease: self.ease.clone(),
            stagger: self.stagger,
            stagger_from: self.stagger_from.clone(),
            period: self.period,
            phase: self.phase,
            seed: self.seed,
        }
    }
}

/// 一条关键帧绑定：一个画面实例的一个属性。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnimationBinding {
    pub id: Id,
    pub target_id: Id,
    pub property_path: KeyframeProperty,
    pub keyframes: Vec<Keyframe>,
}

/// 关键帧的属性：与 `place` 的同名字段一一对应。音量的关键帧是混音的包络（§3.9），不在这里。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum KeyframeProperty {
    #[serde(rename = "x")]
    X,
    #[serde(rename = "y")]
    Y,
    #[serde(rename = "scale")]
    Scale,
    #[serde(rename = "scaleY")]
    ScaleY,
    #[serde(rename = "rot")]
    Rot,
    #[serde(rename = "opacity")]
    Opacity,
    #[serde(rename = "radius")]
    Radius,
}

impl KeyframeProperty {
    /// `timeline::keyframes::KEYFRAME_PROPS` 里的名字。
    pub fn as_str(self) -> &'static str {
        match self {
            KeyframeProperty::X => "x",
            KeyframeProperty::Y => "y",
            KeyframeProperty::Scale => "scale",
            KeyframeProperty::ScaleY => "scaleY",
            KeyframeProperty::Rot => "rot",
            KeyframeProperty::Opacity => "opacity",
            KeyframeProperty::Radius => "radius",
        }
    }
}

/// 一个关键帧。`localFrame` 与 `percent` 二选一。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Keyframe {
    /// 实例局部的帧，序列编辑网格，≥ 0。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_frame: Option<i64>,
    /// 实例长度的百分比，[0, 100]。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub percent: Option<f64>,
    pub value: f64,
    /// 进入这一帧的那一段的缓动，缺省 `linear`；名字取 `motion` 的缓动表。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ease: Option<String>,
}

/// 把一个实例上的绑定换成 v2 的 `Keyframes`：`localFrame` 按 `fps`（帧每秒）换成实例局部的秒，
/// 百分比写成 `"N%"`。同时有 `localFrame` 与 `percent`、或两者都没有的帧返回错误。
pub fn bindings_to_timeline<'a>(
    bindings: impl IntoIterator<Item = &'a AnimationBinding>,
    fps: f64,
) -> Result<timeline::keyframes::Keyframes, Text> {
    use timeline::keyframes::{KeyTime, Keyframe as V2Keyframe, Keyframes};
    let mut out = Keyframes::default();
    for binding in bindings {
        let mut frames = Vec::with_capacity(binding.keyframes.len());
        for key in &binding.keyframes {
            let t = match (key.local_frame, key.percent) {
                (Some(frame), None) => {
                    if frame < 0 {
                        return Err(msg!(
                            "videoModel.bindingNegativeFrame",
                            "localFrame of binding {binding} cannot be negative",
                            binding = binding.id
                        ));
                    }
                    KeyTime::Seconds(frame as f64 / fps)
                }
                (None, Some(percent)) => KeyTime::Percent(format!("{percent}%")),
                _ => {
                    return Err(msg!(
                        "videoModel.bindingFrameOrPercent",
                        "Each keyframe of binding {binding} must give exactly one of localFrame and percent",
                        binding = binding.id
                    ));
                }
            };
            frames.push(V2Keyframe {
                t,
                v: key.value,
                ease: key.ease.clone(),
            });
        }
        let prop = binding.property_path.as_str();
        if out.get(prop).is_some() {
            return Err(msg!(
                "videoModel.bindingDuplicate",
                "{prop} of clip {item} has more than one keyframe binding",
                prop,
                item = binding.target_id
            ));
        }
        out.set(prop, Some(frames));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn animation_round_trips_and_validates_through_timeline() {
        let value = json!({ "enter": { "preset": "fade", "dur": 0.5 }, "loop": { "preset": "pulse", "period": 1.0 } });
        let animation: Animation = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(&animation).unwrap(), value);
        assert!(animation.to_timeline().validate("e").is_ok());
        let bad: Animation = serde_json::from_value(json!({ "enter": { "preset": "no-such-preset" } })).unwrap();
        assert!(bad.to_timeline().validate("e").is_err());
    }

    #[test]
    fn bindings_become_v2_keyframes() {
        let binding: AnimationBinding = serde_json::from_value(json!({
            "id": "kb_1", "targetId": "i", "propertyPath": "opacity",
            "keyframes": [{ "localFrame": 0, "value": 0.0 }, { "localFrame": 30, "value": 1.0, "ease": "easeOutQuad" }]
        }))
        .unwrap();
        let frames = bindings_to_timeline([&binding], 30.0).unwrap();
        assert!(frames.opacity.is_some());
        let caps = timeline::keyframes::KeyframeCaps {
            transform: true,
            radius: false,
            volume: false,
        };
        assert!(frames.validate("i", caps).is_ok());
        assert!(serde_json::from_value::<KeyframeProperty>(json!("volume")).is_err());
    }
}
