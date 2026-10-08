use crate::schema::{
    Animation, AnimationSlot, ENTER_PRESETS, EXIT_PRESETS, Element, ElementKind, LOOP_PRESETS,
    TimelineError,
};

pub const ANIMATION_PRESET_VERSION: u32 = 1;
pub const DURATION_MIN: f64 = 0.1;
pub const DURATION_MAX: f64 = 2.0;
pub const PERIOD_MIN: f64 = 0.2;
pub const PERIOD_MAX: f64 = 6.0;
pub const INTENSITY_MIN: f64 = 0.0;
pub const INTENSITY_MAX: f64 = 1.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnimationSlotKind {
    Enter,
    Exit,
    Loop,
}

impl AnimationSlotKind {
    pub fn token(self) -> &'static str {
        match self {
            Self::Enter => "in",
            Self::Exit => "out",
            Self::Loop => "loop",
        }
    }

    /// 该槽可供**新写入**的 preset 词表（exit 不含 0.1 兼容名，那些只准读入）。
    pub fn presets(self) -> &'static [&'static str] {
        match self {
            Self::Enter => ENTER_PRESETS,
            Self::Exit => EXIT_PRESETS,
            Self::Loop => LOOP_PRESETS,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct AnimationSlotPlan {
    pub preset: Option<String>,
    pub dur: Option<f64>,
    pub period: Option<f64>,
    pub intensity: Option<f64>,
    pub delay: Option<f64>,
    pub ease: Option<String>,
    pub phase: Option<f64>,
    pub seed: Option<u64>,
}

impl AnimationSlotPlan {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct AnimationPlan {
    pub enter: AnimationSlotPlan,
    pub exit: AnimationSlotPlan,
    pub r#loop: AnimationSlotPlan,
}

impl AnimationPlan {
    pub fn is_empty(&self) -> bool {
        self.enter.is_empty() && self.exit.is_empty() && self.r#loop.is_empty()
    }

    pub fn validate(&self) -> Result<(), TimelineError> {
        if self.is_empty() {
            return Err(TimelineError::Invalid(
                "animation apply 没有任何动画参数".to_owned(),
            ));
        }
        validate_plan_slot(AnimationSlotKind::Enter, &self.enter)?;
        validate_plan_slot(AnimationSlotKind::Exit, &self.exit)?;
        validate_plan_slot(AnimationSlotKind::Loop, &self.r#loop)
    }
}

fn validate_plan_slot(
    kind: AnimationSlotKind,
    plan: &AnimationSlotPlan,
) -> Result<(), TimelineError> {
    if let Some(preset) = &plan.preset
        && !kind.presets().contains(&preset.as_str())
    {
        return Err(TimelineError::Invalid(format!(
            "{} animation preset 不存在：{preset}",
            kind.token()
        )));
    }
    if let Some(value) = plan.dur
        && (!value.is_finite() || !(DURATION_MIN..=DURATION_MAX).contains(&value))
    {
        return Err(TimelineError::Invalid(format!(
            "{}-dur 须在 {DURATION_MIN}..={DURATION_MAX}",
            kind.token()
        )));
    }
    if let Some(value) = plan.period
        && (!value.is_finite() || !(PERIOD_MIN..=PERIOD_MAX).contains(&value))
    {
        return Err(TimelineError::Invalid(format!(
            "{}-period 须在 {PERIOD_MIN}..={PERIOD_MAX}",
            kind.token()
        )));
    }
    if let Some(value) = plan.intensity
        && (!value.is_finite() || !(INTENSITY_MIN..=INTENSITY_MAX).contains(&value))
    {
        return Err(TimelineError::Invalid(format!(
            "{}-strength 须在 0..=1",
            kind.token()
        )));
    }
    if let Some(value) = plan.delay
        && (!value.is_finite() || value < 0.0)
    {
        return Err(TimelineError::Invalid(format!(
            "{}-delay 须为有限非负秒数",
            kind.token()
        )));
    }
    if let Some(value) = plan.phase
        && !value.is_finite()
    {
        return Err(TimelineError::Invalid("loop-phase 须为有限数".to_owned()));
    }
    if kind == AnimationSlotKind::Loop && plan.dur.is_some() {
        return Err(TimelineError::Invalid("loop 不接受 dur".to_owned()));
    }
    if kind != AnimationSlotKind::Loop && (plan.period.is_some() || plan.phase.is_some()) {
        return Err(TimelineError::Invalid(format!(
            "{} 不接受 period/phase",
            kind.token()
        )));
    }
    Ok(())
}

fn slot_mut<'a>(
    animation: &'a mut Animation,
    kind: AnimationSlotKind,
) -> &'a mut Option<AnimationSlot> {
    match kind {
        AnimationSlotKind::Enter => &mut animation.enter,
        AnimationSlotKind::Exit => &mut animation.exit,
        AnimationSlotKind::Loop => &mut animation.r#loop,
    }
}

fn apply_slot(animation: &mut Animation, kind: AnimationSlotKind, plan: &AnimationSlotPlan) {
    let target = slot_mut(animation, kind);
    if let Some(preset) = &plan.preset {
        if preset == "none" && kind != AnimationSlotKind::Exit {
            *target = None;
        } else {
            let previous = target.take();
            *target = Some(AnimationSlot {
                preset: preset.clone(),
                preset_version: Some(ANIMATION_PRESET_VERSION),
                // VoiceInk AnimEdit resets only the slot duration/period when a
                // preset changes; the other tuning knobs survive.
                dur: if kind == AnimationSlotKind::Loop {
                    previous.as_ref().and_then(|slot| slot.dur)
                } else {
                    None
                },
                period: if kind == AnimationSlotKind::Loop {
                    None
                } else {
                    previous.as_ref().and_then(|slot| slot.period)
                },
                delay: previous.as_ref().and_then(|slot| slot.delay),
                intensity: previous.as_ref().and_then(|slot| slot.intensity),
                ease: previous.as_ref().and_then(|slot| slot.ease.clone()),
                stagger: previous.as_ref().and_then(|slot| slot.stagger),
                stagger_from: previous.as_ref().and_then(|slot| slot.stagger_from.clone()),
                phase: previous.as_ref().and_then(|slot| slot.phase),
                seed: previous.as_ref().and_then(|slot| slot.seed),
            });
        }
    }
    // Tuning never materializes a missing slot.
    let Some(target) = target.as_mut() else {
        return;
    };
    if let Some(value) = plan.dur {
        target.dur = Some(snap(value, 0.05));
    }
    if let Some(value) = plan.period {
        target.period = Some(snap(value, 0.05));
    }
    if let Some(value) = plan.intensity {
        target.intensity = Some(value);
    }
    if let Some(value) = plan.delay {
        target.delay = Some(value);
    }
    if let Some(value) = &plan.ease {
        target.ease = Some(value.clone());
    }
    if let Some(value) = plan.phase {
        target.phase = Some(value);
    }
    if let Some(value) = plan.seed {
        target.seed = Some(value);
    }
}

fn snap(value: f64, step: f64) -> f64 {
    (((value / step).round() * step) * 1_000_000.0).round() / 1_000_000.0
}

pub fn apply_animation(element: &mut Element, plan: &AnimationPlan) -> Result<bool, TimelineError> {
    plan.validate()?;
    if element.kind == ElementKind::Audio {
        return Err(TimelineError::Invalid(format!(
            "audio element {} 不支持动画",
            element.id
        )));
    }
    let before = element.animate.clone();
    let mut next = before.clone().unwrap_or(Animation {
        enter: None,
        exit: None,
        r#loop: None,
    });
    apply_slot(&mut next, AnimationSlotKind::Enter, &plan.enter);
    apply_slot(&mut next, AnimationSlotKind::Exit, &plan.exit);
    apply_slot(&mut next, AnimationSlotKind::Loop, &plan.r#loop);
    element.animate = if next.enter.is_none() && next.exit.is_none() && next.r#loop.is_none() {
        None
    } else {
        Some(next)
    };
    // Reuse the schema capability matrix, including text-only presets.
    let mut probe = crate::TimelineDocument::default();
    if let Some(source_id) = element.src_id.as_deref()
        && source_id != "main"
    {
        probe
            .sources
            .insert(source_id.to_owned(), crate::schema::Source::default());
    }
    crate::elements::add_element(&mut probe, "probe", None, element.clone())?;
    Ok(element.animate != before)
}

pub fn clear_animation(
    element: &mut Element,
    slots: &[AnimationSlotKind],
) -> Result<bool, TimelineError> {
    if element.kind == ElementKind::Audio {
        return Err(TimelineError::Invalid(format!(
            "audio element {} 不支持动画",
            element.id
        )));
    }
    let before = element.animate.clone();
    let Some(mut animation) = before.clone() else {
        return Ok(false);
    };
    let all = slots.is_empty();
    for kind in [
        AnimationSlotKind::Enter,
        AnimationSlotKind::Exit,
        AnimationSlotKind::Loop,
    ] {
        if all || slots.contains(&kind) {
            *slot_mut(&mut animation, kind) = None;
        }
    }
    element.animate =
        if animation.enter.is_none() && animation.exit.is_none() && animation.r#loop.is_none() {
            None
        } else {
            Some(animation)
        };
    Ok(element.animate != before)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::schema::Element;

    use super::*;

    fn element(kind: &str) -> Element {
        serde_json::from_value(json!({
            "id": "el-1",
            "kind": kind,
            "text": if kind == "text" { Some("Hello") } else { None },
            "srcId": if kind == "text" { None } else { Some("src-a") }
        }))
        .unwrap()
    }

    #[test]
    fn none_and_tuning_match_voiceink_slot_semantics() {
        let mut value = element("text");
        let plan = AnimationPlan {
            enter: AnimationSlotPlan {
                preset: Some("rise".to_owned()),
                dur: Some(0.37),
                ..AnimationSlotPlan::default()
            },
            exit: AnimationSlotPlan {
                preset: Some("none".to_owned()),
                ..AnimationSlotPlan::default()
            },
            ..AnimationPlan::default()
        };
        assert!(apply_animation(&mut value, &plan).unwrap());
        let animation = value.animate.as_ref().unwrap();
        assert_eq!(animation.enter.as_ref().unwrap().dur, Some(0.35));
        assert_eq!(animation.exit.as_ref().unwrap().preset, "none");

        let tune_missing = AnimationPlan {
            r#loop: AnimationSlotPlan {
                period: Some(2.0),
                ..AnimationSlotPlan::default()
            },
            ..AnimationPlan::default()
        };
        assert!(!apply_animation(&mut value, &tune_missing).unwrap());

        let remove = AnimationPlan {
            enter: AnimationSlotPlan {
                preset: Some("none".to_owned()),
                ..AnimationSlotPlan::default()
            },
            ..AnimationPlan::default()
        };
        apply_animation(&mut value, &remove).unwrap();
        assert!(value.animate.as_ref().unwrap().enter.is_none());
        assert_eq!(
            value
                .animate
                .as_ref()
                .unwrap()
                .exit
                .as_ref()
                .unwrap()
                .preset,
            "none"
        );
    }

    #[test]
    fn text_only_presets_and_audio_are_capability_gated() {
        let typewriter = AnimationPlan {
            enter: AnimationSlotPlan {
                preset: Some("typewriter".to_owned()),
                ..AnimationSlotPlan::default()
            },
            ..AnimationPlan::default()
        };
        assert!(apply_animation(&mut element("image"), &typewriter).is_err());
        let fade = AnimationPlan {
            enter: AnimationSlotPlan {
                preset: Some("fade".to_owned()),
                ..AnimationSlotPlan::default()
            },
            ..AnimationPlan::default()
        };
        assert!(apply_animation(&mut element("audio"), &fade).is_err());
    }

    #[test]
    fn range_validation_is_loud_instead_of_clamping() {
        let plan = AnimationPlan {
            enter: AnimationSlotPlan {
                preset: Some("fade".to_owned()),
                dur: Some(2.01),
                ..AnimationSlotPlan::default()
            },
            ..AnimationPlan::default()
        };
        assert!(plan.validate().is_err());
    }
}
