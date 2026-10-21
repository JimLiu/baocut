use caption_scene::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const SPEECH_PHASE: &str = "caption-speech-phase/1";
const PATHS: [&str; 5] = [
    "cue.speechPhase.beforeFirst",
    "cue.speechPhase.reading",
    "cue.speechPhase.afterLast",
    "cue.speechPhase.estimated",
    "word.inSpan",
];

fn word_pop() -> Value {
    serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap()
}

fn with_opacity(capability: bool, condition: Value) -> Result<SceneStyle> {
    let mut body = word_pop();
    let scene = &mut body["scene"]["value"];
    if capability {
        scene["requiredCapabilities"].as_array_mut().unwrap().push(json!(SPEECH_PHASE));
    }
    scene["animations"].as_array_mut().unwrap().push(json!({
        "id": "phase", "target": {"nodeId": "caption", "selectorId": "words"},
        "property": "opacity", "composite": "multiply",
        "value": {"kind": "expression", "expression": {"op": "if", "condition": condition,
            "then": {"op": "literal", "type": "scalar", "value": 1},
            "else": {"op": "literal", "type": "scalar", "value": 0.5}}}
    }));
    parse_style(&body)
}

#[test]
fn speech_phase_paths_are_capability_gated_bools() {
    for path in PATHS {
        assert_eq!(context_type(path), Some(ValueType::Bool), "{path}");
        let read = json!({"op": "read", "path": path});
        let err = with_opacity(false, read.clone()).unwrap_err();
        assert_eq!(err.code, "CAPTION_CAPABILITY_UNAVAILABLE", "{path}");
        with_opacity(true, read).unwrap();
    }
    // Phases are three bools, not a fourth word state or a string enum.
    assert_eq!(context_type("cue.speechPhase"), None);
    assert_eq!(context_type("word.state"), None);
    let text = serde_json::to_string(parse_style(&word_pop()).unwrap().scene()).unwrap();
    assert!(!text.contains("speechPhase"));
}

#[test]
fn speech_phase_is_rejected_before_layout_and_in_font_sizing() {
    let size = |path: &str| {
        json!({"kind": "expression", "expression": {"op": "if",
            "condition": {"op": "read", "path": path},
            "then": {"op": "literal", "type": "length", "value": 20},
            "else": {"op": "literal", "type": "length", "value": 16}}})
    };
    for path in PATHS {
        let mut early = word_pop();
        let scene = &mut early["scene"]["value"];
        scene["requiredCapabilities"].as_array_mut().unwrap().push(json!(SPEECH_PHASE));
        scene["layout"]["layoutEvaluation"] = json!("per-sample");
        scene["layout"]["bindings"] = json!([{"property": "width", "value": size(path)}]);
        assert_eq!(parse_style(&early).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE", "{path}");

        let mut sized: Value = serde_json::from_str(include_str!("fixtures/unit-font-size.json")).unwrap();
        let scene = &mut sized["scene"]["value"];
        scene["requiredCapabilities"].as_array_mut().unwrap().push(json!(SPEECH_PHASE));
        scene["layout"]["fontSizeBindings"][0]["value"] = size(path);
        assert_eq!(parse_style(&sized).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE", "{path}");
    }
}

#[test]
fn speech_phase_reads_follow_the_shared_context() {
    let style = with_opacity(true, json!({"op": "read", "path": "cue.speechPhase.reading"})).unwrap();
    let expression = match &style.scene().animations.last().unwrap().value {
        DynamicValue::Expression { expression } => expression.clone(),
        _ => unreachable!(),
    };
    assert_eq!(infer(&expression, style.scene(), &BTreeMap::new()).unwrap(), ValueType::Scalar);
    let mut context = Context::default();
    for (reading, expected) in [(true, 1.0), (false, 0.5)] {
        context.fields.insert("cue.speechPhase.reading".into(), Evaluated::Bool(reading));
        let value = evaluate(&expression, style.scene(), &context, &mut Budget::default()).unwrap();
        assert_eq!(value.number().unwrap(), expected);
    }
}

#[test]
fn speech_phase_fixture_validates_and_round_trips() {
    let body: Value = serde_json::from_str(include_str!("fixtures/speech-phase.json")).unwrap();
    let style = parse_style(&body).unwrap();
    assert!(style.scene().required_capabilities.iter().any(|c| c == SPEECH_PHASE));
    let again: Scene = serde_json::from_str(&serde_json::to_string(style.scene()).unwrap()).unwrap();
    assert_eq!(&again, style.scene());
}
