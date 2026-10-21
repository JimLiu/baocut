use caption_scene::*;
use serde_json::{Value, json};
fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap()
}
#[test]
fn explicit_outline_policy_requires_capability_and_rejects_wrong_nodes() {
    let mut body = fixture();
    body["scene"]["value"]["nodes"][0]["style"]["fontHinting"] = json!("none");
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-font-hinting/1"));
    assert!(parse_style(&body).is_ok());
    body["scene"]["value"]["nodes"].as_array_mut().unwrap().push(json!({
        "id":"bad-font-policy", "type":"group", "style":{"fontHinting":"none"}
    }));
    let error = parse_style(&body).unwrap_err();
    assert!(error.detail.contains("text/style fields require a text node"), "{error:?}");
}
#[test]
fn hinting_defaults_preserve_serialized_styles_and_unknown_modes_fail() {
    let plain: TextStyle = serde_json::from_value(json!({})).unwrap();
    let explicit: TextStyle = serde_json::from_value(json!({"fontHinting":"default"})).unwrap();
    assert_eq!(plain, explicit);
    assert!(serde_json::to_value(&plain).unwrap().get("fontHinting").is_none());
    for value in [json!(null), json!(true), json!("invalid")] {
        assert!(serde_json::from_value::<TextStyle>(json!({"fontHinting":value})).is_err());
    }
}
