use caption_scene::parse_style;
use serde_json::{Value, json};
fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/unit-font-style.json")).unwrap()
}
#[test]
fn static_style_bindings_require_capability_frozen_membership_and_nonempty_typed_patches() {
    let body = fixture();
    let style = parse_style(&body).unwrap();
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    let mut missing = body.clone();
    missing["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c != "caption-unit-font-style/1");
    assert_eq!(parse_style(&missing).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    for (pointer, value) in [
        ("/scene/value/layout/layoutEvaluation", json!("static")),
        ("/scene/value/layout/pagination", json!({"maxUnitsPerPage":3})),
        ("/scene/value/layout/fontStyleBindings/0/nodeId", json!("absent")),
        ("/scene/value/layout/fontStyleBindings/0/selectorId", json!("absent")),
        ("/scene/value/layout/fontStyleBindings/1/id", json!("page-serif")),
        ("/scene/value/selectors/0/unit", json!("grapheme")),
        ("/scene/value/layout/fontStyleBindings/0/style", json!({})),
        ("/scene/value/layout/fontStyleBindings/0/style", json!({"fontFamily":""})),
        ("/scene/value/layout/fontStyleBindings/0/style", json!({"fontFamily":"a\nb"})),
        (
            "/scene/value/layout/fontStyleBindings/0/style",
            json!({"fontFamily":"x".repeat(257)}),
        ),
        ("/scene/value/layout/fontStyleBindings/0/style", json!({"fontWeight":0})),
        ("/scene/value/layout/fontStyleBindings/0/style", json!({"fontWeight":1001})),
        ("/scene/value/layout/fontStyleBindings/0/style", json!({"fontWeight":400.5})),
        ("/scene/value/layout/fontStyleBindings/0/style", json!({"fontFamily":null})),
        ("/scene/value/layout/fontStyleBindings/0/style", json!({"fontWeight":null})),
        ("/scene/value/layout/fontStyleBindings/0/style", json!({"italic":null})),
        (
            "/scene/value/layout/fontStyleBindings/0/style",
            json!({"fontFamily":{"kind":"expression","expression":{"op":"read","path":"params.face"}}}),
        ),
    ] {
        let mut bad = body.clone();
        *bad.pointer_mut(pointer).unwrap() = value;
        assert!(parse_style(&bad).is_err(), "{pointer}: {bad}");
    }
    let mut bad = body;
    let one = bad["scene"]["value"]["layout"]["fontStyleBindings"][0].clone();
    bad["scene"]["value"]["layout"]["fontStyleBindings"] = Value::Array(
        (0..65)
            .map(|i| {
                let mut b = one.clone();
                b["id"] = json!(format!("b{i}"));
                b
            })
            .collect(),
    );
    assert!(parse_style(&bad).is_err());
}
#[test]
fn omitted_and_empty_style_bindings_preserve_old_serialization() {
    let mut body: Value = serde_json::from_str(include_str!("fixtures/unit-font-size.json")).unwrap();
    let before = serde_json::to_value(parse_style(&body).unwrap()).unwrap();
    body["scene"]["value"]["layout"]["fontStyleBindings"] = json!([]);
    let after = serde_json::to_value(parse_style(&body).unwrap()).unwrap();
    assert_eq!(before, after);
    assert!(after["scene"]["value"]["layout"].get("fontStyleBindings").is_none());
}

#[test]
fn source_only_font_patch_is_capability_gated_typed_and_legacy_family_patch_stays_named() {
    let hash = "0123456789abcdef".repeat(4);
    let mut body = fixture();
    let before = serde_json::to_value(parse_style(&body).unwrap()).unwrap();
    assert!(
        before["scene"]["value"]["layout"]["fontStyleBindings"][0]["style"]
            .get("fontSource")
            .is_none()
    );
    let named = parse_style(&body).unwrap();
    assert!(
        named
            .scene()
            .layout
            .font_style_bindings
            .iter()
            .all(|binding| binding.style.font_source.is_none())
    );
    body["scene"]["value"]["layout"]["fontStyleBindings"][0]["style"] = json!({"fontSource":{"sha256":hash}});
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-font-source/1"));
    let parsed = parse_style(&body).unwrap();
    let patch = &parsed.scene().layout.font_style_bindings[0].style;
    assert!(patch.font_family.is_none());
    assert_eq!(patch.font_source.as_ref().unwrap().sha256, hash);
    assert_eq!(patch.font_source.as_ref().unwrap().face_index, 0);
    assert_eq!(parse_style(&serde_json::to_value(&parsed).unwrap()).unwrap(), parsed);
    for reference in [
        Value::Null,
        json!({"sha256":"C".repeat(64)}),
        json!({"sha256":hash,"faceIndex":1024}),
        json!({"sha256":hash,"faceIndex":null}),
        json!({"sha256":hash,"extra":0}),
    ] {
        let mut bad = body.clone();
        bad["scene"]["value"]["layout"]["fontStyleBindings"][0]["style"]["fontSource"] = reference;
        assert!(parse_style(&bad).is_err());
    }
}
