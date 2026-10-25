use caption_scene::*;
use serde_json::{Value, json};

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/scan-warp.json")).unwrap()
}

fn edit(f: impl FnOnce(&mut Value)) -> Result<SceneStyle> {
    let mut body = fixture();
    f(&mut body["scene"]["value"]["materials"][0]);
    parse_style(&body)
}

#[test]
fn scan_warp_fixture_validates_and_round_trips() {
    let style = parse_style(&fixture()).unwrap();
    let again: Scene = serde_json::from_str(&serde_json::to_string(style.scene()).unwrap()).unwrap();
    assert_eq!(&again, style.scene());
    assert!(matches!(style.scene().materials[0], CaptionMaterial::ScanWarp { .. }));
}

#[test]
fn scan_warp_requires_capability_text_context_and_bounded_uniforms() {
    let mut body = fixture();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c != "caption-scan-warp/1");
    let err = parse_style(&body).unwrap_err();
    assert_eq!(
        (err.code.as_str(), err.detail.as_str()),
        ("CAPTION_CAPABILITY_REQUIRED", "caption-scan-warp/1")
    );
    let constant = |value: f64| json!({"kind": "constant", "value": value});
    let cases: Vec<Box<dyn FnOnce(&mut Value)>> = vec![
        Box::new(|m| m["contextNodeId"] = json!("missing")),
        Box::new(|m| m["warp"]["scale"] = json!(0)),
        Box::new(|m| m["warp"]["scale"] = json!(1001)),
        Box::new(|m| m["warp"]["complexity"] = json!(0.5)),
        Box::new(|m| m["warp"]["complexity"] = json!(11)),
        Box::new(|m| m["warp"]["subImpact"] = json!(1.5)),
        Box::new(|m| m["warp"]["subScale"] = json!(0.5)),
        Box::new(move |m| m["warp"]["strength"][0] = constant(4.5)),
        Box::new(move |m| m["warp"]["evolution"] = constant(100_001.0)),
        Box::new(move |m| m["stripe"]["amount"] = constant(1.5)),
        Box::new(move |m| m["stripe"]["falloff"] = constant(-1.0)),
        Box::new(move |m| m["stripe"]["center"] = constant(5.0)),
        Box::new(|m| m["scanlines"]["pitch"] = json!(1001)),
        Box::new(move |m| m["scanlines"]["amount"] = constant(2.0)),
        Box::new(move |m| m["gain"] = constant(4.5)),
        Box::new(|m| m["domain"]["width"] = json!({"kind": "constant", "value": 0})),
        Box::new(|m| m["stripe"]["side"] = json!("left")),
        Box::new(|m| m["uvY"] = json!("sideways")),
    ];
    for (i, case) in cases.into_iter().enumerate() {
        assert!(edit(case).is_err(), "case {i}");
    }
    for key in ["warp", "stripe", "scanlines", "gain", "uvY"] {
        assert!(
            edit(|m| {
                m.as_object_mut().unwrap().remove(key);
            })
            .is_err(),
            "{key}"
        );
    }
    assert!(
        edit(|m| {
            m["warp"].as_object_mut().unwrap().remove("swapAxes");
        })
        .is_ok(),
        "swapAxes defaults to false"
    );
}

fn with_backdrop(body: &mut Value, node: Value) {
    let value = &mut body["scene"]["value"];
    value["selectors"] = json!([{"id": "pages", "nodeId": "caption", "unit": "page", "filter": {"kind": "all"}}]);
    value["nodes"].as_array_mut().unwrap().push(node);
}

#[test]
fn scan_warp_accepts_page_backdrops_but_only_one_text() {
    let plate = |fill: &str| json!({"id": "plate", "type": "shape", "properties": {"fill": {"kind": "constant", "value": fill}}});
    let mut body = fixture();
    with_backdrop(
        &mut body,
        json!({"id": "boxes", "type": "repeat", "selectorId": "pages", "children": [plate("#336699")]}),
    );
    assert!(parse_style(&body).is_ok(), "a box repeated per page may be filtered with the text");
    let mut second = fixture();
    with_backdrop(
        &mut second,
        json!({"id": "other", "type": "text", "style": {"fontSize": {"value": 16, "basis": "absolute"}, "fill": "#FFFFFF"}}),
    );
    let err = parse_style(&second).unwrap_err();
    assert_eq!(err.code, "CAPTION_SCENE_INVALID");
    assert!(err.detail.contains("sole visual node"), "{}", err.detail);
}
