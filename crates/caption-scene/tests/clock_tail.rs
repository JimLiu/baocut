use caption_scene::*;
use serde_json::{Value, json};

const CLOCK_TAIL: &str = "caption-clock-tail/1";

fn scene(capabilities: &[&str], clock: Value, fill: Value) -> Result<Scene> {
    let mut body: Value = serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap();
    let value = &mut body["scene"]["value"];
    for capability in capabilities {
        value["requiredCapabilities"].as_array_mut().unwrap().push(json!(capability));
    }
    value["animations"][1]["value"]["clock"] = clock;
    value["animations"][1]["value"]["fill"] = fill;
    value["animations"][1]["value"]["keys"] = json!([{"at": 0, "value": 0}, {"at": 0.5, "value": 2}, {"at": 1, "value": 4}]);
    Ok(parse_style(&body)?.scene().clone())
}

fn clock(tail: Option<&str>, duration: Value) -> Value {
    let mut clock = json!({"unit": "word", "origin": "start", "duration": duration});
    if let Some(tail) = tail {
        clock["tail"] = json!(tail);
    }
    clock
}

fn fixed(ms: i64) -> Value {
    json!({"kind": "fixed", "ticks": ms, "timescale": 1000})
}

fn sampler(scene: &Scene, span: (f64, f64)) -> impl Fn(f64) -> Option<f64> + '_ {
    let mut context = Context::default();
    context.spans.insert(UnitKind::Word, span);
    move |t| {
        sample_value(
            &scene.animations[1].value,
            ValueType::Scalar,
            scene,
            &context,
            t,
            &mut Budget::default(),
        )
        .unwrap()
        .map(|v| v.number().unwrap())
    }
}

#[test]
fn tail_requires_capability_and_none_keeps_old_bytes() {
    let err = scene(&[], clock(Some("clamp"), fixed(1000)), json!({})).unwrap_err();
    assert_eq!(err.code, "CAPTION_CAPABILITY_REQUIRED");
    let err = scene(&[], clock(Some("repeat"), fixed(1000)), json!({})).unwrap_err();
    assert_eq!(err.code, "CAPTION_CAPABILITY_REQUIRED");
    // An explicit `none` is the default and needs no capability.
    let explicit = scene(&[], clock(Some("none"), fixed(1000)), json!({})).unwrap();
    let omitted = scene(&[], clock(None, fixed(1000)), json!({})).unwrap();
    assert_eq!(explicit, omitted);
    let bytes = serde_json::to_string(&omitted).unwrap();
    assert!(!bytes.contains("\"tail\""));
    let old = parse_style(&serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap()).unwrap();
    assert!(!serde_json::to_string(old.scene()).unwrap().contains("\"tail\""));
    let tailed = scene(&[CLOCK_TAIL], clock(Some("repeat"), fixed(1000)), json!({})).unwrap();
    assert!(serde_json::to_string(&tailed).unwrap().contains("\"tail\":\"repeat\""));
}

#[test]
fn tail_rejects_repeat_conflicts_and_zero_period() {
    let mut both = clock(Some("repeat"), fixed(1000));
    both["repeat"] = json!({"iterations": 2, "mode": "loop"});
    assert_eq!(scene(&[CLOCK_TAIL], both, json!({})).unwrap_err().code, "CAPTION_SCENE_INVALID");
    let mut clamp_with_repeat = clock(Some("clamp"), fixed(1000));
    clamp_with_repeat["repeat"] = json!({"iterations": 2, "mode": "yoyo"});
    assert_eq!(
        scene(&[CLOCK_TAIL], clamp_with_repeat, json!({})).unwrap_err().code,
        "CAPTION_SCENE_INVALID"
    );
    let zero = scene(&[CLOCK_TAIL], clock(Some("repeat"), fixed(0)), json!({})).unwrap_err();
    assert_eq!(zero.code, "CAPTION_SCENE_INVALID");
    // Clamp tolerates a zero duration: it stays a one-step jump.
    let step = scene(&[CLOCK_TAIL], clock(Some("clamp"), fixed(0)), json!({"after": "hold"})).unwrap();
    let at = sampler(&step, (1.0, 2.0));
    assert_eq!(at(1.0), Some(4.0));
    // A unit-span period is only known at sampling time.
    let span = scene(&[CLOCK_TAIL], clock(Some("repeat"), json!({"kind": "unit-span"})), json!({})).unwrap();
    let mut context = Context::default();
    context.spans.insert(UnitKind::Word, (1.0, 1.0));
    let err = sample_value(
        &span.animations[1].value,
        ValueType::Scalar,
        &span,
        &context,
        1.0,
        &mut Budget::default(),
    )
    .unwrap_err();
    assert_eq!(err.code, "CAPTION_SCENE_INVALID");
}

#[test]
fn clamp_matches_clamped_progress_and_fill_still_decides_participation() {
    for fill in [json!({}), json!({"after": "hold"}), json!({"before": "hold"})] {
        let none = scene(&[], clock(None, fixed(1000)), fill.clone()).unwrap();
        let clamp = scene(&[CLOCK_TAIL], clock(Some("clamp"), fixed(1000)), fill.clone()).unwrap();
        let (a, b) = (sampler(&none, (2.0, 3.0)), sampler(&clamp, (2.0, 3.0)));
        for t in [1.5, 2.0, 2.25, 2.5, 2.999, 3.0, 3.5, 10.0] {
            assert_eq!(a(t), b(t), "t={t} fill={fill}");
        }
    }
    // Value is the clamped progress; participation after D follows fill.after.
    let hold = scene(&[CLOCK_TAIL], clock(Some("clamp"), fixed(1000)), json!({"after": "hold"})).unwrap();
    let at = sampler(&hold, (2.0, 3.0));
    assert_eq!(at(2.25), Some(1.0));
    assert_eq!(at(3.0), Some(4.0));
    assert_eq!(at(7.5), Some(4.0));
    let open = scene(&[CLOCK_TAIL], clock(Some("clamp"), fixed(1000)), json!({})).unwrap();
    let at = sampler(&open, (2.0, 3.0));
    assert_eq!(at(2.25), Some(1.0));
    assert_eq!(at(7.5), None);
    assert_eq!(at(1.5), None);
}

#[test]
fn repeat_wraps_elapsed_and_period_end_belongs_to_next_period() {
    let looped = scene(&[CLOCK_TAIL], clock(Some("repeat"), fixed(1000)), json!({})).unwrap();
    let at = sampler(&looped, (2.0, 2.5));
    assert_eq!(at(2.0), Some(0.0));
    assert_eq!(at(2.25), Some(1.0));
    assert_eq!(at(2.75), Some(3.0));
    // Right endpoint of a period is the start of the next one, even when fill.after is none.
    assert_eq!(at(3.0), Some(0.0));
    assert_eq!(at(4.0), Some(0.0));
    assert_eq!(at(3.25), Some(1.0));
    assert_eq!(at(1002.75), Some(3.0));
    // The value never stops after D, but time before the origin still follows fill.before.
    assert_eq!(at(1.999), None);
    let held = scene(&[CLOCK_TAIL], clock(Some("repeat"), fixed(1000)), json!({"before": "hold"})).unwrap();
    assert_eq!(sampler(&held, (2.0, 2.5))(1.0), Some(0.0));
    // Unit-span periods wrap by the unit length; offset shifts the phase origin.
    let mut offset = clock(Some("repeat"), json!({"kind": "unit-span"}));
    offset["offset"] = json!({"ticks": 250, "timescale": 1000});
    let span = scene(&[CLOCK_TAIL], offset, json!({})).unwrap();
    let at = sampler(&span, (2.0, 3.0));
    assert_eq!(at(2.25), Some(0.0));
    assert_eq!(at(3.0), Some(3.0));
    assert_eq!(at(3.25), Some(0.0));
    assert_eq!(at(3.5), Some(1.0));
}

#[test]
fn repeat_keeps_fill_after_for_keys_ending_before_period_end() {
    let mut body = scene(&[CLOCK_TAIL], clock(Some("repeat"), fixed(1000)), json!({})).unwrap();
    if let DynamicValue::Keyframes { keys, .. } = &mut body.animations[1].value {
        keys.truncate(2);
    }
    validate_scene(&body).unwrap();
    {
        let at = sampler(&body, (0.0, 1.0));
        assert_eq!(at(0.25), Some(1.0));
        assert_eq!(at(0.75), None);
        assert_eq!(at(1.25), Some(1.0));
    }
    if let DynamicValue::Keyframes { fill, .. } = &mut body.animations[1].value {
        fill.after = FillMode::Hold;
    }
    let at = sampler(&body, (0.0, 1.0));
    assert_eq!(at(0.75), Some(2.0));
    assert_eq!(at(1.0), Some(0.0));
}

#[test]
fn clock_tail_fixture_validates_and_round_trips() {
    let body: Value = serde_json::from_str(include_str!("fixtures/clock-tail.json")).unwrap();
    let style = parse_style(&body).unwrap();
    let scene = style.scene();
    assert!(scene.required_capabilities.iter().any(|c| c == CLOCK_TAIL));
    let again: Scene = serde_json::from_str(&serde_json::to_string(scene).unwrap()).unwrap();
    assert_eq!(&again, scene);
    validate_scene(&again).unwrap();
}
