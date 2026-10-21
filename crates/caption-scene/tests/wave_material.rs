use caption_scene::parse_style;
use serde_json::{Value, json};
fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/wave-displace.json")).unwrap()
}
#[test]
fn wave_material_roundtrips_and_rejects_invalid_constants_and_types() {
    let body = fixture();
    let style = parse_style(&body).unwrap();
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    for (property, value) in [
        ("amplitude", -257.0),
        ("amplitude", 257.0),
        ("wavelength", 0.0),
        ("wavelength", 0.5),
        ("wavelength", 1_000_001.0),
    ] {
        let mut invalid = body.clone();
        invalid["scene"]["value"]["materials"][0][property] = json!({"kind":"constant", "value":value});
        assert!(parse_style(&invalid).is_err(), "{property}={value}");
    }
    let mut invalid = body.clone();
    invalid["scene"]["value"]["materials"][0]["axis"] = json!("z");
    assert!(parse_style(&invalid).is_err());
    invalid = body;
    invalid["scene"]["value"]["materials"][0]["phase"] =
        json!({"kind":"expression","expression":{"op":"literal","type":"length","value":1}});
    assert!(parse_style(&invalid).is_err());
}

fn page_relative(mut body: Value) -> Value {
    let page_wavelength = json!({"kind":"expression","expression":{"op":"call","function":"mul","args":[
        {"op":"literal","type":"scalar","value":0.4},
        {"op":"call","function":"add","args":[{"op":"read","path":"layout.width"},{"op":"read","path":"canvas.width"}]}
    ]}});
    body["scene"]["value"]["materials"][0]["wavelength"] = page_wavelength;
    body
}

#[test]
fn wave_context_node_reads_page_layout_only_with_its_capability() {
    let body = fixture();
    // The default cue context cannot read post-layout fields.
    assert!(parse_style(&page_relative(body.clone())).is_err());
    let mut contextual = page_relative(body.clone());
    contextual["scene"]["value"]["materials"][0]["contextNodeId"] = json!("caption");
    let err = parse_style(&contextual).unwrap_err();
    assert_eq!(err.code, "CAPTION_CAPABILITY_REQUIRED");
    assert_eq!(err.detail.as_str(), "caption-wave-context/1");
    contextual["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-wave-context/1"));
    let style = parse_style(&contextual).unwrap();
    let saved = serde_json::to_value(&style).unwrap();
    assert_eq!(saved["scene"]["value"]["materials"][0]["contextNodeId"], json!("caption"));
    assert_eq!(parse_style(&saved).unwrap(), style);
    // Omitted stays omitted, so existing scenes serialize unchanged.
    let plain = serde_json::to_value(parse_style(&body).unwrap()).unwrap();
    assert!(plain["scene"]["value"]["materials"][0].get("contextNodeId").is_none());
    for bad in [json!(null), json!("missing"), json!(7)] {
        let mut invalid = contextual.clone();
        invalid["scene"]["value"]["materials"][0]["contextNodeId"] = bad.clone();
        assert!(parse_style(&invalid).is_err(), "{bad}");
    }
}
