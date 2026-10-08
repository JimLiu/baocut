//! 转场（视频格式规范 §3.9）：同一轨道上首尾相接的两个视觉实例之间，或单个实例的入场、出场。
//! 单侧转场生效的长度随实例变短（[`Transition::effective_frames`]），种类与时长区间取 v2 的
//! `timeline::video_transitions`。
//!
//! 转场只用实例的 handles（源素材在实例区间之外的部分），不让实例重叠：同一轨道的实例本来就不重叠（§3.4），
//! 所以没有「真实重叠」这一种。种类是闭集；读到不认识的种类原样保留，计划里当作硬切并报告（§1.4）。

use message_ref::{Text, msg};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{FrameSpan, Id};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "RawTransition", into = "RawTransition")]
pub struct Transition {
    pub id: Id,
    /// 画面从它离开（出场的一侧）。只有它时是这个实例的出场转场。
    pub left_item_id: Option<Id>,
    /// 画面进入它（入场的一侧）。只有它时是这个实例的入场转场。
    pub right_item_id: Option<Id>,
    pub kind: TransitionKind,
    pub duration_frames: i64,
    pub easing: Easing,
    pub placement: TransitionPlacement,
    /// 两侧实例自带的声音同时做等功率交叉淡化。
    pub audio_crossfade: bool,
}

/// 转场的种类与它的参数（§3.9）。前五种可以单侧也可以两侧，`dip-to-color`、`push` 只用于两侧。
#[derive(Clone, Debug, PartialEq)]
pub enum TransitionKind {
    /// 不透明度乘进度。
    Dissolve,
    /// 从框的左边起露出进度那么多。
    Wipe,
    /// 沿框自己的横轴从左边移入，同时淡入。
    Slide,
    /// 以框中心缩放 0.75 + 0.25 × 进度，同时淡入。
    Zoom,
    /// 以框中心为圆心的圆形揭示。
    Iris,
    /// 先混向一种颜色，再从这种颜色混向新画面。只用于两侧。
    DipToColor { color: String },
    /// 新画面沿 `direction` 推入，同时把旧画面推出去。只用于两侧。
    Push { direction: Direction },
    /// 这个版本不认识的种类（或认识但参数读不懂）：原样保留，渲染成硬切并报告。
    Unsupported { kind: String, params: Map<String, Value> },
}

/// 可以单侧也可以两侧的种类，与 `timeline::video_transitions::PRESETS`（去掉 `none`）一致。
pub const SINGLE_SIDED_KINDS: &[&str] = &["dissolve", "wipe", "slide", "zoom", "iris"];
/// 只用于两侧的种类。
pub const TWO_SIDED_ONLY_KINDS: &[&str] = &["dip-to-color", "push"];

impl TransitionKind {
    pub fn name(&self) -> &str {
        match self {
            TransitionKind::Dissolve => "dissolve",
            TransitionKind::Wipe => "wipe",
            TransitionKind::Slide => "slide",
            TransitionKind::Zoom => "zoom",
            TransitionKind::Iris => "iris",
            TransitionKind::DipToColor { .. } => "dip-to-color",
            TransitionKind::Push { .. } => "push",
            TransitionKind::Unsupported { kind, .. } => kind,
        }
    }

    /// 只用于两侧的种类。
    pub fn two_sided_only(&self) -> bool {
        matches!(self, TransitionKind::DipToColor { .. } | TransitionKind::Push { .. })
    }

    pub fn params(&self) -> Map<String, Value> {
        let mut map = Map::new();
        match self {
            TransitionKind::DipToColor { color } => {
                map.insert("color".into(), Value::String(color.clone()));
            }
            TransitionKind::Push { direction } => {
                map.insert("direction".into(), serde_json::to_value(direction).expect("枚举总能序列化"));
            }
            TransitionKind::Unsupported { params, .. } => return params.clone(),
            _ => {}
        }
        map
    }

    /// 按名字与参数构造。名字不认识时返回 `None`；参数不合法时返回错误说明。
    pub fn parse(kind: &str, params: &Map<String, Value>) -> Option<Result<TransitionKind, Text>> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Empty {}
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Color {
            color: String,
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Directed {
            direction: Direction,
        }
        let value = Value::Object(params.clone());
        let err = |e: serde_json::Error| {
            msg!("videoModel.transitionParamsInvalid", "Invalid parameters for {kind}: {error}", kind, error = e.to_string())
        };
        let plain = |made: TransitionKind| serde_json::from_value::<Empty>(value.clone()).map(|_| made).map_err(err);
        Some(match kind {
            "dissolve" => plain(TransitionKind::Dissolve),
            "wipe" => plain(TransitionKind::Wipe),
            "slide" => plain(TransitionKind::Slide),
            "zoom" => plain(TransitionKind::Zoom),
            "iris" => plain(TransitionKind::Iris),
            "dip-to-color" => serde_json::from_value::<Color>(value).map_err(err).and_then(|c| {
                if is_hex_color(&c.color) {
                    Ok(TransitionKind::DipToColor { color: c.color })
                } else {
                    Err(msg!("videoModel.dipColorInvalid", "color of dip-to-color must be #RRGGBB"))
                }
            }),
            "push" => serde_json::from_value::<Directed>(value)
                .map_err(err)
                .map(|d| TransitionKind::Push { direction: d.direction }),
            _ => return None,
        })
    }
}

/// 运动的方向：画面或边沿朝哪边走。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Left,
    Right,
    Up,
    Down,
}

/// 缓动曲线（与音量包络共用一个词表，§3.9）：把线性进度 `p ∈ [0, 1]` 映成缓动后的进度。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Easing {
    #[default]
    Linear,
    EaseIn,
    EaseOut,
    EaseInOut,
}

impl Easing {
    pub fn parse(text: &str) -> Option<Easing> {
        serde_json::from_value(Value::String(text.to_string())).ok()
    }

    pub fn apply(self, p: f64) -> f64 {
        let p = if p.is_finite() { p.clamp(0.0, 1.0) } else { 0.0 };
        match self {
            Easing::Linear => p,
            Easing::EaseIn => p * p,
            Easing::EaseOut => 1.0 - (1.0 - p) * (1.0 - p),
            Easing::EaseInOut => p * p * (3.0 - 2.0 * p),
        }
    }
}

/// 两侧转场的窗口相对剪切点放在哪里。单边转场总在实例之内，不看它。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransitionPlacement {
    /// 以剪切点为中心：`[cut − ⌊D/2⌋, cut − ⌊D/2⌋ + D)`。
    #[default]
    Center,
    /// 从剪切点开始：`[cut, cut + D)`，用左侧实例尾部的 handles。
    StartAtCut,
    /// 在剪切点结束：`[cut − D, cut)`，用右侧实例头部的 handles。
    EndAtCut,
}

impl Transition {
    /// 转场在序列上占的帧区间 `[start, end)`。两侧转场的剪切点是左侧实例的终点；
    /// 两侧是否首尾相接由调用方检查。两侧都没有时为 `None`。
    pub fn window(&self, left: Option<FrameSpan>, right: Option<FrameSpan>) -> Option<(i64, i64)> {
        let d = self.effective_frames(left, right);
        let start = match (left, right) {
            (Some(l), Some(_)) => {
                let cut = l.end_frame();
                match self.placement {
                    TransitionPlacement::Center => cut - d / 2,
                    TransitionPlacement::StartAtCut => cut,
                    TransitionPlacement::EndAtCut => cut - d,
                }
            }
            (None, Some(r)) => r.from_frame,
            (Some(l), None) => l.end_frame() - d,
            (None, None) => return None,
        };
        Some((start, start + d))
    }

    /// 是否单侧（入场或出场）。
    pub fn is_single_sided(&self) -> bool {
        self.left_item_id.is_none() || self.right_item_id.is_none()
    }

    /// 生效的长度（帧）。两侧转场是写入的长度；单侧转场是 min(D, ⌊L / 2⌋)，L 是实例的帧数（§3.9），
    /// 实例变短时随之变短；为 0 时这一头按硬切画。
    pub fn effective_frames(&self, left: Option<FrameSpan>, right: Option<FrameSpan>) -> i64 {
        match (left, right) {
            (Some(_), Some(_)) => self.duration_frames,
            (Some(span), None) | (None, Some(span)) => self.duration_frames.min(span.duration_frames / 2).max(0),
            (None, None) => 0,
        }
    }

    /// 转场涉及的实例。
    pub fn item_ids(&self) -> impl Iterator<Item = &Id> {
        self.left_item_id.iter().chain(&self.right_item_id)
    }
}

pub(crate) fn is_hex_color(text: &str) -> bool {
    text.len() == 7 && text.starts_with('#') && text[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// 存储与交换的形式：`kind` 是字符串，参数放在 `params` 里。
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawTransition {
    id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    left_item_id: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    right_item_id: Option<Id>,
    kind: String,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    params: Map<String, Value>,
    duration_frames: i64,
    #[serde(default)]
    easing: Easing,
    #[serde(default)]
    placement: TransitionPlacement,
    #[serde(default, skip_serializing_if = "is_false")]
    audio_crossfade: bool,
}

impl TryFrom<RawTransition> for Transition {
    type Error = String;

    fn try_from(raw: RawTransition) -> Result<Transition, String> {
        if raw.left_item_id.is_none() && raw.right_item_id.is_none() {
            return Err(format!("transition {} has no clip on either side", raw.id));
        }
        let kind = match TransitionKind::parse(&raw.kind, &raw.params) {
            Some(Ok(kind)) => kind,
            // 不认识的种类与读不懂的参数都原样保留（§1.4）。
            _ => TransitionKind::Unsupported {
                kind: raw.kind,
                params: raw.params,
            },
        };
        Ok(Transition {
            id: raw.id,
            left_item_id: raw.left_item_id,
            right_item_id: raw.right_item_id,
            kind,
            duration_frames: raw.duration_frames,
            easing: raw.easing,
            placement: raw.placement,
            audio_crossfade: raw.audio_crossfade,
        })
    }
}

impl From<Transition> for RawTransition {
    fn from(t: Transition) -> RawTransition {
        RawTransition {
            params: t.kind.params(),
            kind: t.kind.name().to_string(),
            id: t.id,
            left_item_id: t.left_item_id,
            right_item_id: t.right_item_id,
            duration_frames: t.duration_frames,
            easing: t.easing,
            placement: t.placement,
            audio_crossfade: t.audio_crossfade,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn known_kinds_round_trip_and_unknown_kinds_are_kept() {
        let value = json!({
            "id": "tr_1", "leftItemId": "a", "rightItemId": "b", "kind": "push", "params": { "direction": "left" },
            "durationFrames": 12, "easing": "ease-in-out", "placement": "start-at-cut", "audioCrossfade": true
        });
        let t: Transition = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(
            t.kind,
            TransitionKind::Push {
                direction: Direction::Left
            }
        );
        assert_eq!(serde_json::to_value(&t).unwrap(), value);

        let future = json!({ "id": "tr_2", "rightItemId": "b", "kind": "spiral", "params": { "shape": "star" }, "durationFrames": 5, "easing": "linear", "placement": "center" });
        let t: Transition = serde_json::from_value(future.clone()).unwrap();
        assert!(matches!(&t.kind, TransitionKind::Unsupported { kind, .. } if kind == "spiral"));
        assert_eq!(serde_json::to_value(&t).unwrap(), future);
        // 认识的种类带了读不懂的参数，同样原样保留。
        let odd = json!({ "id": "tr_3", "rightItemId": "b", "kind": "wipe", "params": { "direction": "left" }, "durationFrames": 5, "easing": "linear", "placement": "center" });
        let t: Transition = serde_json::from_value(odd.clone()).unwrap();
        assert!(matches!(&t.kind, TransitionKind::Unsupported { kind, .. } if kind == "wipe"));
        assert_eq!(serde_json::to_value(&t).unwrap(), odd);
    }

    #[test]
    fn windows_follow_the_placement() {
        let left = FrameSpan {
            from_frame: 0,
            duration_frames: 90,
        };
        let right = FrameSpan {
            from_frame: 90,
            duration_frames: 60,
        };
        let mut t = Transition {
            id: "t".into(),
            left_item_id: Some("a".into()),
            right_item_id: Some("b".into()),
            kind: TransitionKind::Dissolve,
            duration_frames: 15,
            easing: Easing::Linear,
            placement: TransitionPlacement::Center,
            audio_crossfade: false,
        };
        assert_eq!(t.window(Some(left), Some(right)), Some((83, 98)));
        t.placement = TransitionPlacement::StartAtCut;
        assert_eq!(t.window(Some(left), Some(right)), Some((90, 105)));
        t.placement = TransitionPlacement::EndAtCut;
        assert_eq!(t.window(Some(left), Some(right)), Some((75, 90)));
        assert_eq!(t.window(None, Some(right)), Some((90, 105)));
        assert_eq!(t.window(Some(left), None), Some((75, 90)));
        // 单侧转场生效的长度不超过实例的一半。
        let short = FrameSpan {
            from_frame: 90,
            duration_frames: 20,
        };
        assert_eq!(t.effective_frames(None, Some(short)), 10);
        assert_eq!(t.window(None, Some(short)), Some((90, 100)));
        assert_eq!(t.effective_frames(Some(left), Some(right)), 15);
    }

    #[test]
    fn easing_curves_meet_their_ends() {
        for e in [Easing::Linear, Easing::EaseIn, Easing::EaseOut, Easing::EaseInOut] {
            assert_eq!(e.apply(0.0), 0.0);
            assert_eq!(e.apply(1.0), 1.0);
        }
        assert_eq!(Easing::EaseIn.apply(0.5), 0.25);
        assert_eq!(Easing::EaseOut.apply(0.5), 0.75);
        assert_eq!(Easing::EaseInOut.apply(0.5), 0.5);
    }
}
