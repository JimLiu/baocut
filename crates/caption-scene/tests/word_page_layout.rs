use caption_scene::*;
use serde_json::{Value, json};

fn body() -> Value {
    let mut body: Value = serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap();
    body["scene"]["value"]["requiredCapabilities"] = json!(["caption-word-page-layout/1"]);
    body["scene"]["value"]["layout"]["pagination"] = json!({"wordPagePattern": [4, 5, 4]});
    body
}

#[test]
fn word_page_pattern_roundtrips_without_fixing_line_membership() {
    let mut input = body();
    input["scene"]["value"]["layout"]["maxLines"] = json!(1);
    let style = parse_style(&input).unwrap();
    let scene = style.scene();
    assert_eq!(scene.layout.pagination.word_page_pattern.as_deref(), Some([4, 5, 4].as_slice()));
    assert!(!scene.layout.pagination.has_fixed_lines());
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    for pattern in [vec![1], vec![MAX_UNITS], vec![1; MAX_UNITS], vec![MAX_UNITS - 1, 1]] {
        input["scene"]["value"]["layout"]["pagination"]["wordPagePattern"] = json!(pattern);
        parse_style(&input).unwrap();
    }
}

#[test]
fn word_page_pattern_requires_capability_and_bounded_integer_quotas() {
    let mut input = body();
    input["scene"]["value"]["requiredCapabilities"] = json!([]);
    assert_eq!(parse_style(&input).unwrap_err().code, "CAPTION_CAPABILITY_UNAVAILABLE");
    for pattern in [
        json!([]),
        json!([0]),
        json!([-1]),
        json!([1.5]),
        json!([MAX_UNITS + 1]),
        json!([MAX_UNITS, 1]),
        json!(vec![1; MAX_UNITS + 1]),
        json!([usize::MAX, usize::MAX]),
        json!([[2]]),
    ] {
        let mut input = body();
        input["scene"]["value"]["layout"]["pagination"]["wordPagePattern"] = pattern;
        assert_eq!(parse_style(&input).unwrap_err().code, "CAPTION_SCENE_INVALID", "{input}");
    }
    let mut input = body();
    input["scene"]["value"]["layout"]["pagination"]["unit"] = json!("grapheme");
    assert_eq!(parse_style(&input).unwrap_err().code, "CAPTION_SCENE_INVALID");
}

#[test]
fn word_page_pattern_rejects_all_other_pagination_plans() {
    for (field, value) in [
        ("maxUnitsPerPage", json!(3)),
        ("maxUnitsPerLine", json!(3)),
        ("wordLinePattern", json!([[2]])),
        ("textLinePattern", json!({"unit": "grapheme", "lines": [[8]]})),
        ("lastPageRule", json!({"ifRowCountIs": 1, "previousPageLines": [5]})),
        ("tailWordRule", json!("join-previous-line")),
    ] {
        let mut input = body();
        input["scene"]["value"]["layout"]["pagination"][field] = value;
        assert_eq!(parse_style(&input).unwrap_err().code, "CAPTION_SCENE_INVALID", "{field}");
    }
}

#[test]
fn word_page_pattern_preserves_legacy_defaults_and_strict_field_names() {
    let input: Value = serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap();
    let output = serde_json::to_value(parse_style(&input).unwrap()).unwrap();
    assert!(output["scene"]["value"]["layout"]["pagination"].get("wordPagePattern").is_none());
    assert_eq!(output["scene"]["value"]["layout"]["pagination"]["maxUnitsPerPage"], 3);
    assert!(Pagination::default().word_page_pattern.is_none());
    let mut input = body();
    input["scene"]["value"]["layout"]["pagination"]["wordPagesPattern"] = json!([2]);
    assert_eq!(parse_style(&input).unwrap_err().code, "CAPTION_SCENE_INVALID");
}

#[test]
fn word_page_pattern_allows_width_based_unit_font_reflow() {
    let mut input: Value = serde_json::from_str(include_str!("fixtures/unit-font-reflow.json")).unwrap();
    input["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-word-page-layout/1"));
    input["scene"]["value"]["layout"]["pagination"] = json!({"wordPagePattern": [4, 5]});
    let style = parse_style(&input).unwrap();
    let scene = style.scene();
    assert!(!scene.layout.pagination.has_fixed_lines());
    assert!(!scene.layout.font_size_bindings.is_empty());
}
