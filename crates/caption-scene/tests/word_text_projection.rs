use caption_scene::*;
use serde_json::{Value, json};

const CAPABILITY: &str = "caption-word-text-projection/1";
const SHA256: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

fn projection() -> Value {
    json!({
        "textSha256": SHA256,
        "words": [
            {"wordId": "word-a", "start": 0, "end": 2},
            {"wordId": "word-b", "start": 3, "end": 7}
        ]
    })
}

fn presentation_with(projection: Value) -> Presentation {
    serde_json::from_value(json!({
        "cueOverrides": [{"cueId": "cue-a", "parameters": {}, "wordTextProjection": projection}]
    }))
    .unwrap()
}

fn style_with_capability() -> SceneStyle {
    let mut value: Value = serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap();
    value["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!(CAPABILITY));
    parse_style(&value).unwrap()
}

fn invalid_projection(value: Value, expected_path: &str) {
    let presentation = presentation_with(value);
    let style = style_with_capability();
    let error = validate_presentation(&presentation, Some(style.scene())).unwrap_err();
    assert_eq!(error.code, "CAPTION_SCENE_INVALID");
    assert_eq!(error.path, expected_path);
}

#[test]
fn old_cue_override_keeps_exact_serialization_and_no_projection() {
    for input in [
        r#"{"cueId":"cue-a","parameters":{}}"#,
        r#"{"cueId":"cue-a","occurrenceId":null,"parameters":{},"wordTextProjection":null}"#,
    ] {
        let value: CueOverride = serde_json::from_str(input).unwrap();
        assert!(value.word_text_projection.is_none());
        assert_eq!(
            serde_json::to_string(&value).unwrap(),
            r#"{"cueId":"cue-a","occurrenceId":null,"parameters":{}}"#
        );
    }
    let value: CueOverride = serde_json::from_value(json!({
        "cueId": "cue-a", "occurrenceId": "occurrence-a", "parameters": {"accent": "#FFE600"}
    }))
    .unwrap();
    assert_eq!(
        serde_json::to_string(&value).unwrap(),
        r##"{"cueId":"cue-a","occurrenceId":"occurrence-a","parameters":{"accent":"#FFE600"}}"##
    );
}

#[test]
fn word_projection_round_trips_without_rewriting_ranges_or_digest() {
    let value = projection();
    let decoded: WordTextProjection = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(decoded.text_sha256, SHA256);
    assert_eq!(decoded.words[0].start, 0);
    assert_eq!(decoded.words[0].end, 2);
    assert_eq!(decoded.words[1].start, 3);
    assert_eq!(decoded.words[1].end, 7);
    assert_eq!(serde_json::to_value(decoded).unwrap(), value);
    let presentation = presentation_with(value);
    let encoded = serde_json::to_value(&presentation).unwrap();
    assert_eq!(serde_json::from_value::<Presentation>(encoded).unwrap(), presentation);
}

#[test]
fn projection_requires_an_explicit_supported_scene_capability() {
    assert!(CAPABILITIES.contains(&CAPABILITY));
    let presentation = presentation_with(projection());
    let style = style_with_capability();
    assert!(validate_presentation(&presentation, Some(style.scene())).is_ok());
    let mut missing = style.clone();
    let SceneSource::Inline { value } = &mut missing.scene;
    value.required_capabilities.retain(|capability| capability != CAPABILITY);
    let error = validate_presentation(&presentation, Some(missing.scene())).unwrap_err();
    assert_eq!(error.code, "CAPTION_SCENE_INVALID");
    assert_eq!(error.path, "wordTextProjection");
    assert!(error.detail.contains(CAPABILITY));
    assert!(validate_presentation(&Presentation::default(), Some(missing.scene())).is_ok());
    // Persistence can validate structure before resolving a scene capability.
    assert!(validate_presentation(&presentation, None).is_ok());
}

#[test]
fn projection_rejects_unknown_fields_at_every_new_object_boundary() {
    let base = json!({"cueId": "cue-a", "parameters": {}, "wordTextProjection": projection()});
    for pointer in ["", "/wordTextProjection", "/wordTextProjection/words/0"] {
        let mut value = base.clone();
        value
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unexpected".into(), json!(true));
        assert!(serde_json::from_value::<CueOverride>(value).is_err(), "{pointer}");
    }
}

#[test]
fn projection_requires_typed_digest_and_word_fields() {
    let base = projection();
    for pointer in ["/textSha256", "/words", "/words/0/wordId", "/words/0/start", "/words/0/end"] {
        let mut value = base.clone();
        let (parent, field) = pointer.rsplit_once('/').unwrap();
        value.pointer_mut(parent).unwrap().as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<WordTextProjection>(value).is_err(), "missing {pointer}");
        let mut value = base.clone();
        *value.pointer_mut(pointer).unwrap() = Value::Null;
        assert!(serde_json::from_value::<WordTextProjection>(value).is_err(), "null {pointer}");
    }
    for number in [json!(-1), json!(0.5), json!("1")] {
        for pointer in ["/words/0/start", "/words/0/end"] {
            let mut value = base.clone();
            *value.pointer_mut(pointer).unwrap() = number.clone();
            assert!(serde_json::from_value::<WordTextProjection>(value).is_err(), "{pointer}: {number}");
        }
    }
}

#[test]
fn projection_rejects_noncanonical_sha256() {
    for digest in [
        "".to_string(),
        "a".repeat(63),
        "a".repeat(65),
        "A".repeat(64),
        "g".repeat(64),
        format!("{} ", "a".repeat(63)),
    ] {
        let mut value = projection();
        value["textSha256"] = json!(digest);
        invalid_projection(value, "wordTextProjection.textSha256");
    }
}

#[test]
fn projection_word_count_has_a_nonempty_inclusive_budget() {
    let words: Vec<_> = (0..MAX_UNITS)
        .map(|i| json!({"wordId": format!("word-{i}"), "start": i * 2, "end": i * 2 + 1}))
        .collect();
    let mut value = projection();
    value["words"] = json!(words);
    let style = style_with_capability();
    assert!(validate_presentation(&presentation_with(value.clone()), Some(style.scene())).is_ok());
    value["words"].as_array_mut().unwrap().push(json!({
        "wordId": "one-too-many", "start": MAX_UNITS * 2, "end": MAX_UNITS * 2 + 1
    }));
    invalid_projection(value, "wordTextProjection");
    let mut value = projection();
    value["words"] = json!([]);
    invalid_projection(value, "wordTextProjection.words");
}

#[test]
fn projection_word_budget_is_shared_across_scoped_and_unscoped_cues() {
    let count = MAX_UNITS / 2;
    let words: Vec<_> = (0..count)
        .map(|i| json!({"wordId": format!("word-{i}"), "start": i * 2, "end": i * 2 + 1}))
        .collect();
    let mut value = json!({
        "cueOverrides": [
            {"cueId": "cue-a", "parameters": {}, "wordTextProjection": {"textSha256": SHA256, "words": words}},
            {"cueId": "cue-b", "occurrenceId": "occurrence-b", "parameters": {},
             "wordTextProjection": {"textSha256": SHA256, "words": words}}
        ]
    });
    let style = style_with_capability();
    let at_limit: Presentation = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(
        at_limit
            .cue_overrides
            .iter()
            .map(|cue| cue.word_text_projection.as_ref().unwrap().words.len())
            .sum::<usize>(),
        MAX_UNITS
    );
    assert!(validate_presentation(&at_limit, Some(style.scene())).is_ok());

    value["cueOverrides"][1]["wordTextProjection"]["words"]
        .as_array_mut()
        .unwrap()
        .push(json!({"wordId": "one-too-many", "start": count * 2, "end": count * 2 + 1}));
    let over_limit: Presentation = serde_json::from_value(value).unwrap();
    assert!(
        over_limit
            .cue_overrides
            .iter()
            .all(|cue| cue.word_text_projection.as_ref().unwrap().words.len() <= MAX_UNITS)
    );
    let error = validate_presentation(&over_limit, Some(style.scene())).unwrap_err();
    assert_eq!(error.code, "CAPTION_SCENE_INVALID");
    assert_eq!(error.path, "wordTextProjection");
    assert!(error.detail.contains("total projection word budget"));
}

#[test]
fn projection_word_ids_are_unique_nonempty_and_byte_bounded() {
    for word_id in ["".to_string(), "x".repeat(129), "\u{e9}".repeat(65), "word-a".to_string()] {
        let mut value = projection();
        value["words"][1]["wordId"] = json!(word_id);
        invalid_projection(value, "wordTextProjection.words");
    }
    let mut value = projection();
    value["words"][1]["wordId"] = json!("x".repeat(128));
    assert!(validate_presentation(&presentation_with(value), None).is_ok());
    let mut value = projection();
    value["words"][1]["wordId"] = json!("\u{e9}".repeat(64));
    assert!(validate_presentation(&presentation_with(value), None).is_ok());
}

#[test]
fn projection_ranges_are_nonempty_ordered_and_byte_bounded() {
    for (start, end) in [(3, 3), (5, 4), (1, 4), (65535, 65537)] {
        let mut value = projection();
        value["words"][1]["start"] = json!(start);
        value["words"][1]["end"] = json!(end);
        invalid_projection(value, "wordTextProjection.words");
    }
    for (start, end) in [(2, 3), (3, 7), (65535, 65536)] {
        let mut value = projection();
        value["words"][1]["start"] = json!(start);
        value["words"][1]["end"] = json!(end);
        assert!(validate_presentation(&presentation_with(value), None).is_ok(), "{start}..{end}");
    }
    let mut value = projection();
    value["words"].as_array_mut().unwrap().reverse();
    invalid_projection(value, "wordTextProjection.words");
}
