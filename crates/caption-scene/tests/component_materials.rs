use caption_scene::parse_style;
use serde_json::{Value, json};

fn gaussian() -> Value {
    serde_json::from_str(include_str!("fixtures/gaussian-axis.json")).unwrap()
}

#[test]
fn spacing_ramp_requires_capability_a_nonempty_interval_and_an_explicit_typed_field() {
    let old = gaussian();
    assert!(
        serde_json::to_value(parse_style(&old).unwrap()).unwrap()["scene"]["value"]["materials"][0]
            .get("spacingRamp")
            .is_none()
    );
    let mut body = old.clone();
    let c = |v: f64| json!({"kind":"constant","value":v});
    body["scene"]["value"]["materials"][0]["spacingRamp"] = json!({
        "domain":{"x":c(0.0),"y":c(0.0),"width":c(120.0),"height":c(80.0)},
        "axis":"y","start":c(0.2),"end":c(0.8),"reverse":true,"evaluation":"previous-sample"});
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-gaussian-spacing-ramp/1"));
    parse_style(&body).unwrap();
    for (field, value) in [("end", c(0.2)), ("reverse", json!(1)), ("evaluation", json!("frame-history"))] {
        let mut bad = body.clone();
        bad["scene"]["value"]["materials"][0]["spacingRamp"][field] = value;
        assert!(parse_style(&bad).is_err());
    }
    body["scene"]["value"]["materials"][0]["spacingRamp"] = Value::Null;
    assert!(parse_style(&body).is_err());
}
fn glow() -> Value {
    serde_json::from_str(include_str!("fixtures/glow-cascade.json")).unwrap()
}

#[test]
fn gaussian_sampling_and_tap_order_are_explicit_capabilities_with_strict_shapes() {
    let c = |value: f64| json!({"kind":"constant","value":value});
    let domain = |x: f64, y: f64, w: f64, h: f64| json!({"x":c(x),"y":c(y),"width":c(w),"height":c(h)});
    let mut body = gaussian();
    body["scene"]["value"]["materials"][0]["sampling"] = json!({"input":domain(2.0,3.0,80.0,40.0),"output":domain(10.25,-2.0,100.5,60.0)});
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-gaussian-sampling/1"));
    parse_style(&body).unwrap();
    for (field, value) in [("x", c(-1.0)), ("x", c(1.25)), ("width", c(1.5)), ("height", c(0.0))] {
        let mut bad = body.clone();
        bad["scene"]["value"]["materials"][0]["sampling"]["input"][field] = value;
        assert!(parse_style(&bad).is_err(), "{field}");
    }
    let mut null = body.clone();
    null["scene"]["value"]["materials"][0]["sampling"] = Value::Null;
    assert!(parse_style(&null).is_err());
    body["scene"]["value"]["materials"][0].as_object_mut().unwrap().remove("sampling");
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-gaussian-spacing-ramp/1"));
    body["scene"]["value"]["materials"][0]["spacingRamp"] = json!({"domain":domain(0.0,0.0,160.0,90.0),
        "axis":"y","start":c(0.2),"end":c(0.8),"reverse":true,"evaluation":"previous-sample"});
    let serialized = serde_json::to_value(parse_style(&body).unwrap()).unwrap();
    assert!(
        serialized["scene"]["value"]["materials"][0]["spacingRamp"]
            .get("sampleOrder")
            .is_none()
    );
    body["scene"]["value"]["materials"][0]["spacingRamp"]["sampleOrder"] = json!("positive-first");
    parse_style(&body).unwrap();
    let mut missing = body.clone();
    missing["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c != "caption-gaussian-sampling/1");
    assert_eq!(parse_style(&missing).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    for value in [Value::Null, json!("unordered")] {
        body["scene"]["value"]["materials"][0]["spacingRamp"]["sampleOrder"] = value;
        assert!(parse_style(&body).is_err());
    }
}
#[test]
fn component_material_capabilities_and_finite_uniform_contracts_are_explicit() {
    for body in [
        gaussian(),
        glow(),
        serde_json::from_str(include_str!("fixtures/gaussian-local-sampling.json")).unwrap(),
    ] {
        parse_style(&body).unwrap();
        let mut bad = body;
        bad["scene"]["value"]["requiredCapabilities"] = json!([]);
        assert_eq!(parse_style(&bad).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    }
    for (field, value) in [("samples", 1025.), ("samples", -1.), ("stepUv", 1.1), ("sigmaUv", -1.)] {
        let mut bad = gaussian();
        bad["scene"]["value"]["materials"][0][field] = json!({"kind":"constant","value":value});
        assert!(parse_style(&bad).is_err(), "{field}");
    }
    for gamma in [0.0, 8.01] {
        let mut bad = gaussian();
        bad["scene"]["value"]["materials"][0]["gamma"] = json!(gamma);
        assert!(parse_style(&bad).is_err());
    }
    let mut bad = gaussian();
    bad["scene"]["value"]["materials"][0]["samples"] = json!({"kind":"constant","value":1});
    bad["scene"]["value"]["materials"][0]["sigmaUv"] = json!({"kind":"constant","value":0});
    assert!(parse_style(&bad).is_err());
    bad["scene"]["value"]["materials"][0]["samples"] = json!({"kind":"constant","value":0});
    parse_style(&bad).unwrap();
}
#[test]
fn cascade_limits_reject_unbounded_surfaces_and_unrelated_visual_content() {
    for scale in [
        json!({"num":0,"den":1}),
        json!({"num":1,"den":0}),
        json!({"num":2,"den":1}),
        json!({"num":1,"den":4097}),
    ] {
        let mut bad = glow();
        bad["scene"]["value"]["materials"][0]["levels"][0]["horizontal"]["scale"] = scale;
        assert!(parse_style(&bad).is_err());
    }
    for count in [0, 8] {
        let mut bad = glow();
        let level = bad["scene"]["value"]["materials"][0]["levels"][0].clone();
        bad["scene"]["value"]["materials"][0]["levels"] = Value::Array(vec![level; count]);
        assert!(parse_style(&bad).is_err());
    }
    let mut bad = glow();
    bad["scene"]["value"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"other","type":"text"}));
    assert!(parse_style(&bad).is_err());
    let mut bad = gaussian();
    bad["scene"]["value"]["materials"][0]["contextNodeId"] = json!("missing");
    assert!(parse_style(&bad).is_err());
}

#[test]
fn glow_tint_is_optional_color_and_keeps_the_existing_page_context_contract() {
    let old = glow();
    let parsed = parse_style(&old).unwrap();
    let serialized = serde_json::to_value(&parsed).unwrap();
    assert!(serialized["scene"]["value"]["materials"][0].get("glowTint").is_none());
    let mut tinted = old.clone();
    tinted["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-glow-tint/1"));
    let mut missing = old.clone();
    missing["scene"]["value"]["materials"][0]["glowTint"] = json!({"kind":"constant","value":"#FFFFFF"});
    assert_eq!(parse_style(&missing).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    for color in ["#FFFFFFFF", "#00FF8000"] {
        let mut body = tinted.clone();
        body["scene"]["value"]["materials"][0]["glowTint"] = json!({"kind":"constant","value":color});
        let parsed = parse_style(&body).unwrap();
        assert_eq!(
            serde_json::to_value(parsed).unwrap()["scene"]["value"]["materials"][0]["glowTint"]["value"],
            color
        );
    }
    for value in [json!(0.5), json!([1, 1, 1, 1]), json!("red"), json!("#GG0000")] {
        let mut body = tinted.clone();
        body["scene"]["value"]["materials"][0]["glowTint"] = json!({"kind":"constant","value":value});
        assert!(parse_style(&body).is_err());
    }
    let mut null = tinted.clone();
    null["scene"]["value"]["materials"][0]["glowTint"] = Value::Null;
    assert!(parse_style(&null).is_err());
    let mut body = tinted;
    body["scene"]["value"]["materials"][0]["glowTint"] =
        json!({"kind":"expression","expression":{"op":"literal","type":"scalar","value":1}});
    assert!(parse_style(&body).is_err());
    body["scene"]["value"]["materials"][0]["glowTint"] = json!({"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"gt","args":[{"op":"read","path":"layout.lineEnvelopeHeight"},{"op":"literal","type":"length","value":1}]},"then":{"op":"literal","type":"color","value":"#FF0000"},"else":{"op":"literal","type":"color","value":"#00FF00"}}});
    // Legacy ink fields are readable without a separate field gate. The newer
    // envelope fields explicitly require their capability in both infer paths.
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_UNAVAILABLE");
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-glyph-envelope/1"));
    parse_style(&body).unwrap();
    body["scene"]["value"]["materials"][0]["contextNodeId"] = json!("missing");
    assert!(parse_style(&body).is_err());
    body["scene"]["value"]["materials"][0]["contextNodeId"] = json!("caption");
    body["scene"]["value"]["requiredCapabilities"] = json!(["caption-glyph-envelope/1"]);
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
}

#[test]
fn glow_color_matrix_has_its_own_capability_and_exact_finite_row_major_shape() {
    use caption_scene::{CaptionMaterial, SceneSource, validate_scene};
    let original = glow();
    let old = serde_json::to_value(parse_style(&original).unwrap()).unwrap();
    assert!(old["scene"]["value"]["materials"][0].get("glowColorMatrix").is_none());
    let identity = json!([1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]);
    let mut body = original;
    body["scene"]["value"]["materials"][0]["glowColorMatrix"] = identity.clone();
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-glow-color-matrix/1"));
    assert_eq!(
        serde_json::to_value(parse_style(&body).unwrap()).unwrap()["scene"]["value"]["materials"][0]["glowColorMatrix"],
        identity
    );
    for invalid in [
        Value::Null,
        json!([1, 0, 0]),
        json!([1, 0, 0, 0, 1, 0, 0, 0, 1, 0]),
        json!([1, 0, 0, 0, 1, 0, 0, 0, "1"]),
        json!({"kind":"constant","value":[1,0,0,0,1,0,0,0,1]}),
    ] {
        let mut bad = body.clone();
        bad["scene"]["value"]["materials"][0]["glowColorMatrix"] = invalid;
        assert!(parse_style(&bad).is_err());
    }
    let mut typed = parse_style(&body).unwrap();
    let SceneSource::Inline { value: scene } = &mut typed.scene;
    let CaptionMaterial::GlowCascade { glow_color_matrix, .. } = &mut scene.materials[0] else {
        unreachable!()
    };
    *glow_color_matrix = Some([f64::INFINITY; 9]);
    assert!(validate_scene(scene).is_err());
}

#[test]
fn glow_linear_has_its_own_capability_static_gains_and_keeps_old_documents() {
    let old = serde_json::to_value(parse_style(&glow()).unwrap()).unwrap();
    for field in ["gammaChannels", "aggregation", "levelGains", "levelColor"] {
        assert!(old["scene"]["value"]["materials"][0].get(field).is_none(), "{field}");
    }
    let linear: Value = serde_json::from_str(include_str!("fixtures/glow-linear.json")).unwrap();
    let round = serde_json::to_value(parse_style(&linear).unwrap()).unwrap();
    let material = &round["scene"]["value"]["materials"][0];
    assert_eq!(
        (&material["gammaChannels"], &material["aggregation"], &material["levelGains"], &material["composite"]),
        (&json!("rgba"), &json!("linear"), &json!([1.0, 1.5]), &json!("original-over-screen"))
    );
    assert_eq!(material["levelColor"]["value"], "#FFD700FF");

    // Each extension alone needs the capability, including explicit defaults and an eighth level.
    let level = glow()["scene"]["value"]["materials"][0]["levels"][0].clone();
    for (field, value) in [
        ("gammaChannels", json!("rgb")),
        ("aggregation", json!("encoded")),
        ("composite", json!("original-over-screen")),
        ("levels", Value::Array(vec![level.clone(); 8])),
    ] {
        let mut body = glow();
        body["scene"]["value"]["materials"][0][field] = value;
        assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED", "{field}");
        body["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-glow-linear/1"));
        parse_style(&body).unwrap();
    }
    let mut nine = linear.clone();
    nine["scene"]["value"]["materials"][0]["levels"] = Value::Array(vec![level; 9]);
    nine["scene"]["value"]["materials"][0]["levelGains"] = json!([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    assert!(parse_style(&nine).is_err());

    // Gains and color are linear-only; gains are a static per-level array in [0,2].
    for (field, value) in [
        ("aggregation", json!("encoded")),
        ("levelGains", json!([1.0])),
        ("levelGains", json!([1.0, 2.5])),
        ("levelGains", json!([1.0, -0.1])),
        ("levelGains", Value::Null),
        ("levelGains", json!({"kind":"constant","value":[1, 1]})),
        ("levelColor", json!({"kind":"constant","value":0.5})),
        ("levelColor", Value::Null),
        ("gammaChannels", json!("argb")),
        ("aggregation", json!("additive")),
    ] {
        let mut bad = linear.clone();
        bad["scene"]["value"]["materials"][0][field] = value;
        assert!(parse_style(&bad).is_err(), "{field}");
    }
    let mut encoded = linear.clone();
    let material = encoded["scene"]["value"]["materials"][0].as_object_mut().unwrap();
    material.remove("aggregation");
    material.remove("levelGains");
    assert!(parse_style(&encoded).is_err());
    encoded["scene"]["value"]["materials"][0].as_object_mut().unwrap().remove("levelColor");
    parse_style(&encoded).unwrap();
    let mut gains_only = linear;
    gains_only["scene"]["value"]["materials"][0].as_object_mut().unwrap().remove("levelColor");
    gains_only["scene"]["value"]["materials"][0]["levelGains"] = json!([0, 2]);
    parse_style(&gains_only).unwrap();
}
