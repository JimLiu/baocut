use caption_scene::*;
use serde_json::{Value, json};

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/gradient-noise-displace.json")).unwrap()
}

fn edit(f: impl FnOnce(&mut Value)) -> Result<SceneStyle> {
    let mut body = fixture();
    f(&mut body["scene"]["value"]["materials"][0]);
    parse_style(&body)
}

#[test]
fn gradient_noise_displace_fixture_validates_and_round_trips() {
    let style = parse_style(&fixture()).unwrap();
    let again: Scene = serde_json::from_str(&serde_json::to_string(style.scene()).unwrap()).unwrap();
    assert_eq!(&again, style.scene());
    assert!(matches!(style.scene().materials[0], CaptionMaterial::GradientNoiseDisplace { .. }));
}

#[test]
fn gradient_noise_displace_requires_capability_text_context_and_bounded_parameters() {
    let mut body = fixture();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c != "caption-gradient-noise-displace/1");
    let err = parse_style(&body).unwrap_err();
    assert_eq!(
        (err.code.as_str(), err.detail.as_str()),
        ("CAPTION_CAPABILITY_REQUIRED", "caption-gradient-noise-displace/1")
    );
    let constant = |value: f64| json!({"kind": "constant", "value": value});
    let cases: Vec<Box<dyn FnOnce(&mut Value)>> = vec![
        Box::new(|m| m["contextNodeId"] = json!("missing")),
        Box::new(|m| m["field"]["complexity"] = json!(0.5)),
        Box::new(|m| m["field"]["complexity"] = json!(10.5)),
        Box::new(|m| m["field"]["cycle"] = json!(1)),
        Box::new(|m| m["field"]["subImpact"] = json!(1.5)),
        Box::new(|m| m["field"]["subScale"] = json!(0.5)),
        Box::new(|m| m["field"]["subRotation"] = json!(361)),
        Box::new(|m| m["field"]["subOffset"] = json!([0, 100_001])),
        Box::new(|m| m["field"]["rotation"] = json!(-361)),
        Box::new(move |m| m["field"]["scale"] = constant(0.0)),
        Box::new(move |m| m["field"]["scale"] = constant(1001.0)),
        Box::new(move |m| m["field"]["offset"][1] = constant(100_001.0)),
        Box::new(move |m| m["field"]["evolution"] = constant(-100_001.0)),
        Box::new(move |m| m["brightness"] = constant(17.0)),
        Box::new(move |m| m["contrast"] = constant(-1.0)),
        Box::new(move |m| m["range"] = constant(16.5)),
        Box::new(|m| m["domain"]["width"] = json!({"kind": "constant", "value": 0})),
    ];
    for (i, case) in cases.into_iter().enumerate() {
        assert!(edit(case).is_err(), "case {i}");
    }
    for field in ["field", "brightness", "contrast", "range", "uvY"] {
        assert!(
            edit(|m| {
                m.as_object_mut().unwrap().remove(field);
            })
            .is_err(),
            "{field} is required"
        );
    }
    assert!(
        edit(|m| m["field"]["strength"] = json!(1)).is_err(),
        "unknown field names are refused"
    );
}

#[test]
fn gradient_noise_displace_needs_exactly_one_text_node() {
    let mut body = fixture();
    let nodes = body["scene"]["value"]["nodes"].as_array_mut().unwrap();
    let mut second = nodes[0].clone();
    second["id"] = json!("second");
    nodes.push(second);
    assert!(parse_style(&body).is_err());
}
