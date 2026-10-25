use caption_scene::*;
use serde_json::{Value, json};

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/radial-warp.json")).unwrap()
}

fn edit(f: impl FnOnce(&mut Value)) -> Result<SceneStyle> {
    let mut body = fixture();
    f(&mut body["scene"]["value"]["materials"][0]);
    parse_style(&body)
}

#[test]
fn radial_warp_fixture_validates_and_round_trips() {
    let style = parse_style(&fixture()).unwrap();
    let again: Scene = serde_json::from_str(&serde_json::to_string(style.scene()).unwrap()).unwrap();
    assert_eq!(&again, style.scene());
    assert!(matches!(style.scene().materials[0], CaptionMaterial::RadialWarp { .. }));
}

#[test]
fn radial_warp_requires_capability_text_context_and_bounded_uniforms() {
    let mut body = fixture();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c != "caption-radial-warp/1");
    let err = parse_style(&body).unwrap_err();
    assert_eq!(
        (err.code.as_str(), err.detail.as_str()),
        ("CAPTION_CAPABILITY_REQUIRED", "caption-radial-warp/1")
    );
    let constant = |value: f64| json!({"kind": "constant", "value": value});
    let cases: Vec<Box<dyn FnOnce(&mut Value)>> = vec![
        Box::new(|m| m["contextNodeId"] = json!("missing")),
        Box::new(move |m| m["strength"] = constant(4.5)),
        Box::new(move |m| m["shift"][0] = constant(-4.5)),
        Box::new(move |m| m["shift"][1] = constant(f64::MAX)),
        Box::new(|m| m["domain"]["height"] = json!({"kind": "constant", "value": 0})),
        Box::new(|m| m["uvY"] = json!("sideways")),
        Box::new(|m| m["shift"] = json!([{"kind": "constant", "value": 0}])),
    ];
    for (i, case) in cases.into_iter().enumerate() {
        assert!(edit(case).is_err(), "case {i}");
    }
    for key in ["strength", "shift", "uvY", "domain"] {
        assert!(
            edit(|m| {
                m.as_object_mut().unwrap().remove(key);
            })
            .is_err(),
            "{key}"
        );
    }
}

#[test]
fn radial_warp_accepts_page_backdrops_but_only_one_text() {
    let mut body = fixture();
    body["scene"]["value"]["selectors"] = json!([{"id": "pages", "nodeId": "caption", "unit": "page", "filter": {"kind": "all"}}]);
    body["scene"]["value"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id": "boxes", "type": "repeat", "selectorId": "pages",
        "children": [{"id": "plate", "type": "shape", "properties": {"fill": {"kind": "constant", "value": "#336699"}}}]}));
    assert!(parse_style(&body).is_ok());
    body["scene"]["value"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id": "other", "type": "text",
        "style": {"fontSize": {"value": 16, "basis": "absolute"}, "fill": "#FFFFFF"}}));
    let err = parse_style(&body).unwrap_err();
    assert_eq!(err.code, "CAPTION_SCENE_INVALID");
}
