use mesh_avatar_core::engine::{
    expression::{
        overlay_target, ExpressionMouthSettings, ExpressionOverlay, ExpressionSettings,
        OVERLAY_EXPRESSIONS,
    },
    rig::Parameters,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[test]
fn validates_json_shapes_and_values_with_field_paths() {
    for value in [
        Value::Null,
        json!([]),
        json!("surprise"),
        json!(1),
        json!(false),
    ] {
        assert_eq!(
            ExpressionSettings::parse(&value).unwrap_err().to_string(),
            "expressions: expected an object"
        );
        assert_eq!(
            ExpressionSettings::parse(&json!({"surprise":value}))
                .unwrap_err()
                .to_string(),
            "expressions.surprise: expected an object"
        );
    }
    for value in [
        json!(-0.01),
        json!(1.01),
        json!("0.5"),
        Value::Null,
        json!(false),
        json!([]),
        json!({}),
    ] {
        assert_eq!(
            ExpressionSettings::parse(&json!({"surprise":{"mouthOpen":value}}))
                .unwrap_err()
                .to_string(),
            "expressions.surprise.mouthOpen: expected 0–1"
        );
    }
    for value in [0.0, 0.45, 1.0] {
        let settings = ExpressionSettings::parse(&json!({"surprise":{"mouthOpen":value}})).unwrap();
        assert_eq!(settings.0["surprise"].mouth_open, Some(value));
    }
}

#[test]
fn ignores_neutral_unknown_names_and_unknown_fields() {
    let settings = ExpressionSettings::parse(&json!({
        "neutral":null, "future":false, "toString":[], "__proto__":42, "constructor":null,
        "surprise":{"mouthOpen":0.45,"future":null}, "sad":{}
    }))
    .unwrap();
    assert_eq!(
        serde_json::to_value(settings).unwrap(),
        json!({"surprise":{"mouthOpen":0.45},"sad":{}})
    );
}

#[test]
fn merges_each_expression_and_field_without_erasing_saved_values() {
    let saved = ExpressionSettings::parse(
        &json!({"surprise":{"mouthOpen":0.45},"smile":{"mouthOpen":0.2}}),
    )
    .unwrap();
    let explicit = ExpressionSettings::parse(
        &json!({"surprise":{"mouthOpen":0},"smile":{},"sad":{"mouthOpen":1}}),
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(saved.merge(&explicit).unwrap()).unwrap(),
        json!({
            "surprise":{"mouthOpen":0.0},"smile":{"mouthOpen":0.2},"sad":{"mouthOpen":1.0}
        })
    );
    assert_eq!(saved.merge(&ExpressionSettings::default()).unwrap(), saved);
}

#[test]
fn validates_direct_rust_settings_including_nonfinite_values_before_merging() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -0.01, 1.01] {
        let invalid = ExpressionSettings(BTreeMap::from([(
            "surprise".into(),
            ExpressionMouthSettings {
                mouth_open: Some(value),
            },
        )]));
        let valid = ExpressionSettings::parse(&json!({"surprise":{"mouthOpen":0.45}})).unwrap();
        for result in [invalid.merge(&valid), valid.merge(&invalid)] {
            assert_eq!(
                result.unwrap_err().to_string(),
                "expressions.surprise.mouthOpen: expected 0–1"
            );
        }
        assert!(ExpressionOverlay::with_settings(invalid).is_err());
    }
    let ignored = ExpressionSettings(BTreeMap::from([
        (
            "neutral".into(),
            ExpressionMouthSettings {
                mouth_open: Some(f64::NAN),
            },
        ),
        (
            "unknown".into(),
            ExpressionMouthSettings {
                mouth_open: Some(f64::INFINITY),
            },
        ),
    ]));
    assert_eq!(
        ignored.merge(&ExpressionSettings::default()).unwrap(),
        ExpressionSettings::default()
    );
}

#[test]
fn default_output_is_unchanged_and_configured_mouth_preserves_speech_shape() {
    let input = Parameters {
        mouth_form: 0.5,
        ..Default::default()
    };
    let mut original = ExpressionOverlay::default();
    let mut empty = ExpressionOverlay::with_settings(ExpressionSettings::default()).unwrap();
    for (name, _) in OVERLAY_EXPRESSIONS {
        original.set(name);
        empty.set(name);
        for _ in 0..120 {
            assert_eq!(
                serde_json::to_value(original.apply(&input, 1.0 / 60.0)).unwrap(),
                serde_json::to_value(empty.apply(&input, 1.0 / 60.0)).unwrap()
            );
        }
    }
    assert_eq!(overlay_target("surprise")["mouthOpen"], 0.6);
    for opening in [0.0, 0.45, 1.0] {
        let settings =
            ExpressionSettings::parse(&json!({"surprise":{"mouthOpen":opening}})).unwrap();
        let mut overlay = ExpressionOverlay::with_settings(settings).unwrap();
        overlay.set("surprise");
        let mut out = input.clone();
        for _ in 0..240 {
            out = overlay.apply(&input, 1.0 / 60.0);
        }
        assert!((out.mouth_open - opening).abs() < 1e-12);
        let expected_form = if opening == 0.0 {
            input.mouth_form
        } else {
            overlay_target("surprise")["mouthForm"]
        };
        assert!((out.mouth_form - expected_form).abs() < 1e-12);
        let speech = Parameters {
            mouth_open: 1.0,
            mouth_form: 0.7,
            ..input.clone()
        };
        let out = overlay.apply(&speech, 1.0 / 60.0);
        assert_eq!(out.mouth_open, 1.0);
        assert_eq!(out.mouth_form, 0.7);
        overlay.set("neutral");
        for _ in 0..240 {
            overlay.apply(&input, 1.0 / 60.0);
        }
        assert!(!overlay.active());
        assert_eq!(
            serde_json::to_value(overlay.apply(&input, 0.0)).unwrap(),
            serde_json::to_value(&input).unwrap()
        );
    }
}
