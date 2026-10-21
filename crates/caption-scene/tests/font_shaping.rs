use caption_scene::*;
use serde_json::{Value, json};
fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap()
}
#[test]
fn nominal_is_explicit_and_not_a_nontext_style() {
    let mut body = fixture();
    body["scene"]["value"]["nodes"][0]["style"]["fontShaping"] = json!("nominal");
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-font-shaping/1"));
    assert!(parse_style(&body).is_ok());
    body["scene"]["value"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"invalid-mode","type":"group","style":{"fontShaping":"nominal"}}));
    assert!(parse_style(&body).unwrap_err().detail.contains("text/style fields"));
}
#[test]
fn old_styles_remain_advanced_and_invalid_modes_fail() {
    let old: TextStyle = serde_json::from_value(json!({})).unwrap();
    let explicit: TextStyle = serde_json::from_value(json!({"fontShaping":"advanced"})).unwrap();
    assert_eq!(old, explicit);
    assert!(serde_json::to_value(old).unwrap().get("fontShaping").is_none());
    for value in [json!(null), json!("auto"), json!(true)] {
        assert!(serde_json::from_value::<TextStyle>(json!({"fontShaping":value})).is_err());
    }
}
