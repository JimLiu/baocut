//! Independent video entry/exit transitions. Sampling is shared by preview and export.
use crate::{AnimationPose, TimelineError};
use serde::{Deserialize, Serialize};

pub const PRESETS: &[&str] = &["none", "dissolve", "wipe", "slide", "zoom", "iris"];
/// 一侧转场时长的区间（秒）；schema 校验、渲染的夹取与命令行参数共用。
pub const DURATION_RANGE: (f64, f64) = (0.1, 2.0);
/// 没写时长时的缺省（秒）。
pub const DURATION_DEFAULT: f64 = 0.5;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct VideoTransitions {
    #[serde(rename = "in", default, skip_serializing_if = "Option::is_none")]
    pub enter: Option<Transition>,
    #[serde(rename = "out", default, skip_serializing_if = "Option::is_none")]
    pub exit: Option<Transition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Transition {
    pub k: String,
    #[serde(default = "default_duration")]
    pub dur: f64,
}
fn default_duration() -> f64 {
    DURATION_DEFAULT
}

impl VideoTransitions {
    pub fn validate(&self) -> Result<(), TimelineError> {
        for slot in [&self.enter, &self.exit].into_iter().flatten() {
            if !PRESETS.contains(&slot.k.as_str())
                || !slot.dur.is_finite()
                || !(DURATION_RANGE.0..=DURATION_RANGE.1).contains(&slot.dur)
            {
                return Err(TimelineError::Invalid(
                    "video transitions require a known preset and duration 0.1..=2 seconds".into(),
                ));
            }
        }
        Ok(())
    }

    /// Half-open element span; each side is capped to half its resolved length.
    pub fn sample(&self, time: f64, length: f64) -> TransitionFrame {
        let mut frame = TransitionFrame::default();
        if !time.is_finite() || !length.is_finite() || length <= 0.0 || time < 0.0 || time >= length
        {
            frame.opacity = 0.0;
            return frame;
        }
        for (slot, elapsed) in [(&self.enter, time), (&self.exit, length - time)] {
            let Some(slot) = slot else { continue };
            let duration = slot
                .dur
                .clamp(DURATION_RANGE.0, DURATION_RANGE.1)
                .min(length / 2.0);
            let p = (elapsed / duration).clamp(0.0, 1.0);
            match slot.k.as_str() {
                "dissolve" => frame.opacity *= p,
                "wipe" => frame.reveal *= p,
                "slide" => {
                    frame.x += p - 1.0;
                    frame.opacity *= p;
                }
                "zoom" => {
                    frame.scale *= 0.75 + p * 0.25;
                    frame.opacity *= p;
                }
                "iris" => frame.iris *= p,
                _ => {}
            }
        }
        frame
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TransitionFrame {
    pub opacity: f64,
    /// Translation in fractions of the element's local width.
    pub x: f64,
    pub scale: f64,
    pub reveal: f64,
    /// Circular reveal radius as a fraction of the local half-diagonal.
    pub iris: f64,
}
impl Default for TransitionFrame {
    fn default() -> Self {
        Self {
            opacity: 1.0,
            x: 0.0,
            scale: 1.0,
            reveal: 1.0,
            iris: 1.0,
        }
    }
}
impl TransitionFrame {
    pub fn compose_in_place(
        self,
        pose: AnimationPose,
        local_width: f64,
        short_edge: f64,
        place: &crate::schema::Place,
    ) -> AnimationPose {
        let (flip_x, _) = place.flip_signs();
        let shift = self.x * local_width / short_edge.max(1.0)
            * place.scale.unwrap_or(1.0)
            * pose.scale_x
            * flip_x;
        let angle = (place.rot.unwrap_or(0.0) + pose.rotation).to_radians();
        let mut result = Self { x: 0.0, ..self }.compose(pose, local_width, short_edge);
        result.dx += shift * angle.cos();
        result.dy += shift * angle.sin();
        result
    }
    pub fn compose(
        self,
        mut pose: AnimationPose,
        local_width: f64,
        short_edge: f64,
    ) -> AnimationPose {
        pose.opacity *= self.opacity;
        pose.dx += self.x * local_width / short_edge.max(1.0);
        pose.scale_x *= self.scale;
        pose.scale_y *= self.scale;
        if self.reveal < 1.0 {
            pose.reveal = Some(pose.reveal.unwrap_or(1.0) * self.reveal);
        }
        pose
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pair(a: &str, b: &str) -> VideoTransitions {
        VideoTransitions {
            enter: Some(Transition {
                k: a.into(),
                dur: 2.0,
            }),
            exit: Some(Transition {
                k: b.into(),
                dur: 2.0,
            }),
        }
    }
    #[test]
    fn independent_slots_short_spans_and_half_open_boundaries() {
        let a = pair("dissolve", "wipe");
        assert_eq!(a.sample(0.0, 0.2).opacity, 0.0);
        assert_eq!(a.sample(0.1, 0.2), TransitionFrame::default());
        let tail = a.sample(0.15, 0.2);
        assert_eq!(tail.opacity, 1.0);
        assert!((tail.reveal - 0.5).abs() < 1e-9);
        assert_eq!(a.sample(0.2, 0.2).opacity, 0.0);
    }
    #[test]
    fn transitions_compose_with_animation_without_replacing_it() {
        let mut pose = AnimationPose::IDENTITY;
        pose.opacity = 0.5;
        pose.scale_x = 2.0;
        let out = pair("zoom", "none")
            .sample(0.0, 4.0)
            .compose(pose, 100.0, 200.0);
        assert_eq!(out.opacity, 0.0);
        assert_eq!(out.scale_x, 1.5);
        let slide = pair("slide", "none")
            .sample(0.0, 4.0)
            .compose(pose, 100.0, 200.0);
        assert_eq!(slide.dx, -0.5);
    }
    #[test]
    fn presets_validate_and_round_trip() {
        for preset in PRESETS {
            let value = pair(preset, "none");
            value.validate().unwrap();
            assert_eq!(
                serde_json::from_str::<VideoTransitions>(&serde_json::to_string(&value).unwrap())
                    .unwrap(),
                value
            );
        }
        assert!(pair("bogus", "none").validate().is_err());
        let mut bad = pair("iris", "none");
        bad.enter.as_mut().unwrap().dur = 0.0;
        assert!(bad.validate().is_err());
    }
    #[test]
    fn slide_follows_the_rotated_scaled_video_local_axis() {
        let place: crate::schema::Place =
            serde_json::from_value(serde_json::json!({"rot":90,"scale":2})).unwrap();
        let pose = pair("slide", "none").sample(0.0, 4.0).compose_in_place(
            AnimationPose::IDENTITY,
            100.0,
            200.0,
            &place,
        );
        assert!(pose.dx.abs() < 1e-9);
        assert!((pose.dy + 1.0).abs() < 1e-9);
    }
}
