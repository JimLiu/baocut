use caption_scene::parse_style;
use serde_json::{Value, json};

fn fitted_font_box() -> Value {
    let mut body: Value = serde_json::from_str(include_str!("fixtures/fixed-line-fit.json")).unwrap();
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([json!("caption-font-line-box/1"), json!("caption-fixed-line-font-box/1")]);
    scene["nodes"][0]["style"]["lineBox"] = json!({"metricSource":"font","minAscent":1.2,"minDescent":0.3});
    body
}

#[test]
fn fixed_line_font_box_requires_all_three_explicit_capabilities() {
    let body = fitted_font_box();
    let style = parse_style(&body).unwrap();
    assert_eq!(parse_style(&serde_json::to_value(style.clone()).unwrap()).unwrap(), style);
    for (capability, expected_code) in [
        ("caption-fixed-line-font-box/1", "CAPTION_SCENE_INVALID"),
        ("caption-fixed-line-fit/1", "CAPTION_CAPABILITY_UNAVAILABLE"),
        ("caption-font-line-box/1", "CAPTION_CAPABILITY_REQUIRED"),
    ] {
        let mut missing = body.clone();
        missing["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .retain(|value| value.as_str() != Some(capability));
        assert_eq!(parse_style(&missing).unwrap_err().code, expected_code, "{capability}");
    }
    let mut invalid = body;
    invalid["scene"]["value"]["nodes"][0]["style"]["lineBox"]["minDescent"] = json!(-0.1);
    assert_eq!(parse_style(&invalid).unwrap_err().code, "CAPTION_SCENE_INVALID");
}

#[test]
fn fixed_line_font_box_does_not_admit_unit_typography_or_wrapped_rows() {
    for fixture in [
        include_str!("fixtures/unit-font-size.json"),
        include_str!("fixtures/unit-font-style.json"),
    ] {
        let mut body: Value = serde_json::from_str(fixture).unwrap();
        let scene = &mut body["scene"]["value"];
        scene["requiredCapabilities"].as_array_mut().unwrap().extend([
            json!("caption-fixed-line-fit/1"),
            json!("caption-font-line-box/1"),
            json!("caption-fixed-line-font-box/1"),
        ]);
        scene["layout"]["pagination"]["fixedLineFit"] = json!({
            "lastLineWidthRatio":0.5,"lastLineMaxScale":1.3,"extraLineHeight":0.1
        });
        scene["nodes"][0]["style"]["lineBox"] = json!({"minAscent":1.2});
        let error = parse_style(&body).unwrap_err();
        assert_eq!(error.code, "CAPTION_SCENE_INVALID");
        assert_eq!(error.path, "pagination.fixedLineFit");
    }
    let mut wrapped = fitted_font_box();
    wrapped["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-fixed-line-wrap/1"));
    wrapped["scene"]["value"]["layout"]["pagination"]["fixedLineOverflow"] = json!("wrap");
    assert_eq!(parse_style(&wrapped).unwrap_err().code, "CAPTION_SCENE_INVALID");
}
