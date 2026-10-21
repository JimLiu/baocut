use caption_scene::*;
use serde_json::{Value, json};

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/noise-displace.json")).unwrap()
}

fn edit(f: impl FnOnce(&mut Value)) -> Result<SceneStyle> {
    let mut body = fixture();
    f(&mut body["scene"]["value"]["materials"][0]);
    parse_style(&body)
}

#[test]
fn noise_displace_fixture_validates_and_round_trips() {
    let style = parse_style(&fixture()).unwrap();
    let again: Scene = serde_json::from_str(&serde_json::to_string(style.scene()).unwrap()).unwrap();
    assert_eq!(&again, style.scene());
    assert!(matches!(style.scene().materials[0], CaptionMaterial::NoiseDisplace { .. }));
}

#[test]
fn noise_displace_requires_capability_text_context_and_bounded_uniforms() {
    let mut body = fixture();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c != "caption-noise-displace/1");
    let err = parse_style(&body).unwrap_err();
    assert_eq!(
        (err.code.as_str(), err.detail.as_str()),
        ("CAPTION_CAPABILITY_REQUIRED", "caption-noise-displace/1")
    );
    let cases: Vec<Box<dyn FnOnce(&mut Value)>> = vec![
        Box::new(|m| m["contextNodeId"] = json!("missing")),
        Box::new(|m| m["noiseScale"] = json!([0, 1])),
        Box::new(|m| m["noiseScale"] = json!([1, 1001])),
        Box::new(|m| m["contrast"] = json!({"kind": "constant", "value": -1})),
        Box::new(|m| m["strength"] = json!({"kind": "constant", "value": 16.5})),
        Box::new(|m| m["brightness"] = json!({"kind": "constant", "value": 17})),
        Box::new(|m| m["phase"] = json!({"kind": "constant", "value": 1_000_001})),
        Box::new(|m| m["domain"]["width"] = json!({"kind": "constant", "value": 0})),
    ];
    for (i, case) in cases.into_iter().enumerate() {
        assert!(edit(case).is_err(), "case {i}");
    }
    assert!(
        edit(|m| {
            m.as_object_mut().unwrap().remove("noiseScale");
        })
        .is_err()
    );
}
