use caption_scene::*;
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/layer-add.json")).unwrap()
}

#[test]
fn layer_add_fixture_validates_and_round_trips() {
    let style = parse_style(&fixture()).unwrap();
    let again: Scene = serde_json::from_str(&serde_json::to_string(style.scene()).unwrap()).unwrap();
    assert_eq!(&again, style.scene());
    let blends: Vec<_> = style.scene().render_layers.iter().map(|l| l.blend).collect();
    assert_eq!(blends, [CaptionLayerBlend::SourceOver, CaptionLayerBlend::Add]);
    assert_eq!(serde_json::to_value(CaptionLayerBlend::Add).unwrap(), "add");
    assert_eq!(serde_json::to_value(CaptionLayerBlend::Screen).unwrap(), "screen");
}

#[test]
fn layer_add_requires_its_own_capability() {
    let mut body = fixture();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c != "caption-layer-add/1");
    let err = parse_style(&body).unwrap_err();
    assert_eq!(
        (err.code.as_str(), err.detail.as_str()),
        ("CAPTION_CAPABILITY_REQUIRED", "caption-layer-add/1")
    );
    body["scene"]["value"]["renderLayers"][1]["blend"] = "screen".into();
    assert!(parse_style(&body).is_ok(), "screen layers stay gated by render layers only");
    body["scene"]["value"]["renderLayers"][1]["blend"] = "lighten".into();
    assert!(parse_style(&body).is_err());
}
