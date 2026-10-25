use caption_scene::parse_style;
use serde_json::{Value, json};
fn body(source: &str) -> Value {
    json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
        "schema":"baocut.caption-scene/1","evaluationVersion":1,
        "requiredCapabilities":["caption-scene/1","caption-image-paint/1","caption-image-page-phase/1"],
        "layout":{"x":{"value":96,"basis":"absolute"},"y":{"value":48,"basis":"absolute"},"width":{"value":180,"basis":"absolute"},"pagination":{}},
        "resources":[{"id":"texture","assetRef":{"id":"texture","revision":"1"},"contentHash":format!("sha256:{}","a".repeat(64))}],
        "nodes":[{"id":"ink","type":"text","style":{"paints":[{"id":"fill","paint":{"kind":"image","resourceId":"texture","space":"glyph-normalized","uvTransform":[1,0,0,1,0,0],"phase":{"period":8,"source":source}}}]}}],
        "selectors":[],"animations":[]
    }}})
}
fn phase(v: &mut Value) -> &mut Value {
    &mut v["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["phase"]
}
#[test]
fn legacy_cue_phase_wire_and_absent_phase_remain_unchanged() {
    let mut v = body("cue-scalar-index");
    v["scene"]["value"]["requiredCapabilities"] = json!(["caption-scene/1", "caption-image-paint/1"]);
    let wire = serde_json::to_value(parse_style(&v).unwrap()).unwrap();
    assert_eq!(
        wire["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["phase"],
        json!({"period":8,"source":"cue-scalar-index"})
    );
    v["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]
        .as_object_mut()
        .unwrap()
        .remove("phase");
    let wire = serde_json::to_value(parse_style(&v).unwrap()).unwrap();
    assert!(
        wire["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]
            .get("phase")
            .is_none()
    );
}
#[test]
fn page_phase_and_float_arithmetic_require_their_separate_capabilities() {
    let mut v = body("page-scalar-index");
    let parsed = parse_style(&v).unwrap();
    assert_eq!(
        parse_style(&serde_json::to_value(parsed).unwrap()).unwrap(),
        parse_style(&v).unwrap()
    );
    v["scene"]["value"]["requiredCapabilities"] = json!(["caption-scene/1", "caption-image-paint/1"]);
    assert_eq!(parse_style(&v).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    v["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-image-page-phase/1"));
    phase(&mut v)["arithmetic"] = json!("float32");
    assert_eq!(parse_style(&v).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    v["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-image-phase-float32/1"));
    parse_style(&v).unwrap();
}
#[test]
fn invalid_or_missing_phase_source_is_not_silently_defaulted() {
    for source in [Value::Null, json!("first-visible-glyph"), json!("page-index"), json!(0)] {
        let mut v = body("page-scalar-index");
        phase(&mut v)["source"] = source;
        assert!(parse_style(&v).is_err());
    }
    let mut v = body("cue-scalar-index");
    phase(&mut v).as_object_mut().unwrap().remove("source");
    assert!(parse_style(&v).is_err());
}
#[test]
fn inactive_binding_page_phase_is_still_capability_checked() {
    let mut v = body("page-scalar-index");
    let selected = v["scene"]["value"]["nodes"][0]["style"]["paints"].clone();
    v["scene"]["value"]["requiredCapabilities"] = json!(["caption-scene/1", "caption-image-paint/1", "caption-paint-style-bindings/1"]);
    v["scene"]["value"]["nodes"][0]["style"]["paints"] = json!([{"id":"fill","paint":{"kind":"solid","color":"#FFFFFFFF"}}]);
    v["scene"]["value"]["selectors"] = json!([{"id":"unused","nodeId":"ink","unit":"word","filter":{"kind":"tag","value":"absent"}}]);
    v["scene"]["value"]["paintStyleBindings"] = json!([{"id":"bound","nodeId":"ink","selectorId":"unused","style":{"paints":selected}}]);
    assert_eq!(parse_style(&v).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
}

#[test]
fn page_window_accepts_explicit_word_pages_and_keeps_automatic_width_pages_rejected() {
    let mut v = body("page-scalar-index");
    v["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([json!("caption-word-page-layout/1"), json!("caption-page-window/1")]);
    v["scene"]["value"]["layout"]["pagination"] = json!({"wordPagePattern":[1]});
    v["scene"]["value"]["layout"]["leadingGap"] = json!("hide");
    v["scene"]["value"]["speechState"] = json!({"timingPolicy":"require-word-timing"});
    v["scene"]["value"]["layout"]["pageWindow"] = json!({"gapThreshold":{"ticks":1000,"timescale":1000},"shortGap":{"before":0,"after":1},"longGap":{"before":0,"after":1},"boundary":"first-start-inclusive-end-inclusive"});
    let parsed = parse_style(&v).unwrap();
    assert_eq!(parsed, parse_style(&serde_json::to_value(&parsed).unwrap()).unwrap());
    for pagination in [json!({}), json!({"maxUnitsPerPage":1})] {
        let mut invalid = v.clone();
        invalid["scene"]["value"]["layout"]["pagination"] = pagination;
        assert!(parse_style(&invalid).is_err());
    }
}

#[test]
fn public_layer_capture_is_not_implicitly_enabled_by_page_phase() {
    let mut v = body("page-scalar-index");
    parse_style(&v).unwrap();
    v["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-render-layers/1"));
    v["scene"]["value"]["renderLayers"] = json!([{
        "id":"local","source":{"kind":"nodes","nodeIds":["ink"]},
        "capture":{"contextNodeId":"ink","rect":{"x":{"kind":"constant","value":0},"y":{"kind":"constant","value":0},"width":{"kind":"constant","value":192},"height":{"kind":"constant","value":96}}},
        "materials":[],"blend":"source-over"
    }]);
    let error = parse_style(&v).unwrap_err();
    assert_eq!(error.code, "CAPTION_CAPABILITY_REQUIRED");
    assert!(error.detail.contains("caption-layer-capture/1"), "{error}");
}
