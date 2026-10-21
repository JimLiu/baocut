use caption_scene::*;
use serde_json::{Value, json};

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/feedback-mean.json")).unwrap()
}

#[test]
fn feedback_mean_fixture_validates_and_round_trips() {
    let style = parse_style(&fixture()).unwrap();
    let again: Scene = serde_json::from_str(&serde_json::to_string(style.scene()).unwrap()).unwrap();
    assert_eq!(&again, style.scene());
    assert!(matches!(
        style.scene().materials[0],
        CaptionMaterial::Feedback {
            composite: FeedbackComposite::Mean,
            ..
        }
    ));
}

#[test]
fn feedback_default_composite_is_omitted_from_old_documents() {
    let body: Value = serde_json::from_str(include_str!("fixtures/reflow-feedback.json")).unwrap();
    let style = parse_style(&body).unwrap();
    let feedback = style
        .scene()
        .materials
        .iter()
        .find(|m| matches!(m, CaptionMaterial::Feedback { .. }))
        .unwrap();
    assert!(matches!(
        feedback,
        CaptionMaterial::Feedback {
            composite: FeedbackComposite::DecayOver,
            ..
        }
    ));
    let written = serde_json::to_value(feedback).unwrap();
    assert!(written.get("composite").is_none(), "{written}");
    let original = body["scene"]["value"]["materials"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["kind"] == "feedback")
        .unwrap();
    let keys = |v: &Value| v.as_object().unwrap().keys().cloned().collect::<Vec<_>>();
    assert_eq!(keys(&written), keys(original));
}

#[test]
fn feedback_mean_requires_capability_and_unit_decay() {
    let mut body = fixture();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c != "caption-feedback-mean/1");
    let err = parse_style(&body).unwrap_err();
    assert_eq!(
        (err.code.as_str(), err.detail.as_str()),
        ("CAPTION_CAPABILITY_REQUIRED", "caption-feedback-mean/1")
    );
    for (field, value) in [("decay", json!(0.5)), ("composite", json!("sum")), ("samples", json!(17))] {
        let mut body = fixture();
        body["scene"]["value"]["materials"][0][field] = value;
        assert!(parse_style(&body).is_err(), "{field}");
    }
    let mut body = fixture();
    body["scene"]["value"]["materials"][0]["composite"] = json!("decay-over");
    body["scene"]["value"]["materials"][0]["decay"] = json!(0.5);
    assert!(parse_style(&body).is_ok());
}
