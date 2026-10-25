//! Reference geometry and local capture are explicit, independent opt-ins.
use caption_scene::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn c(value: f64) -> Value {
    json!({"kind":"constant","value":value})
}
fn read(path: &str) -> Value {
    json!({"op":"read","path":path})
}
fn expr(path: &str) -> Value {
    json!({"kind":"expression","expression":read(path)})
}
fn reference_fixture() -> Value {
    let mut body: Value = serde_json::from_str(include_str!("fixtures/unit-font-size.json")).unwrap();
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-reference-geometry/1"));
    scene["selectors"][2]["filter"] = json!({"kind":"tag","value":"emphasis"});
    for binding in scene["layout"]["fontSizeBindings"].as_array_mut().unwrap() {
        binding["referenceValue"] = c(14.0);
    }
    body
}
fn capture_fixture() -> Value {
    let rect = json!({"x":c(-12.0),"y":c(3.0),"width":c(96.0),"height":c(48.0)});
    json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
        "schema":"baocut.caption-scene/1","evaluationVersion":1,
        "requiredCapabilities":["caption-render-layers/1","caption-layer-capture/1","caption-noisy-sweep/1"],
        "layout":{"x":{"value":48,"basis":"absolute"},"y":{"value":24,"basis":"absolute"},"width":{"value":90,"basis":"absolute"}},
        "nodes":[{"id":"text","type":"text","style":{"fontSize":{"value":14,"basis":"absolute"}}}],
        "renderLayers":[{"id":"letters","source":{"kind":"nodes","nodeIds":["text"]},
            "capture":{"contextNodeId":"text","rect":rect},"materials":[{"kind":"noisy-sweep","id":"sweep","contextNodeId":"text",
                "domain":{"x":expr("material.surfaceX"),"y":expr("material.surfaceY"),"width":expr("material.surfaceWidth"),"height":expr("material.surfaceHeight")},
                "position":c(0.5),"maskScale":[1,1],"reveal":true,"uvY":"up"}],"blend":"source-over"}]
    }}})
}

#[test]
fn reference_values_roundtrip_without_changing_legacy_serialization() {
    let body = reference_fixture();
    let parsed = parse_style(&body).unwrap();
    assert!(
        parsed
            .scene()
            .layout
            .font_size_bindings
            .iter()
            .all(|binding| binding.reference_value.is_some())
    );
    assert_eq!(parse_style(&serde_json::to_value(&parsed).unwrap()).unwrap(), parsed);
    let old: Value = serde_json::from_str(include_str!("fixtures/unit-font-size.json")).unwrap();
    let serialized = serde_json::to_value(parse_style(&old).unwrap()).unwrap();
    assert!(
        serialized["scene"]["value"]["layout"]["fontSizeBindings"]
            .as_array()
            .unwrap()
            .iter()
            .all(|binding| binding.get("referenceValue").is_none())
    );
    for value in [
        Value::Null,
        c(0.0),
        c(4097.0),
        json!({"kind":"expression","expression":{"op":"literal","type":"scalar","value":14}}),
    ] {
        let mut bad = body.clone();
        bad["scene"]["value"]["layout"]["fontSizeBindings"][0]["referenceValue"] = value;
        assert!(parse_style(&bad).is_err());
    }
    let mut bad = body;
    bad["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|cap| cap != "caption-reference-geometry/1");
    assert!(parse_style(&bad).is_err());
}

#[test]
fn reference_capability_requires_fixed_sampled_layout_even_without_size_bindings() {
    let mut body = reference_fixture();
    body["scene"]["value"]["layout"]["fontSizeBindings"] = json!([]);
    parse_style(&body).unwrap();
    for (key, value) in [("layoutEvaluation", json!("static")), ("pagination", json!({"maxUnitsPerPage":3}))] {
        let mut bad = body.clone();
        bad["scene"]["value"]["layout"][key] = value;
        assert!(parse_style(&bad).is_err());
    }
    let mut bad = reference_fixture();
    bad["scene"]["value"]["layout"]["fontSizeBindings"][1]
        .as_object_mut()
        .unwrap()
        .remove("referenceValue");
    assert!(parse_style(&bad).is_err());
}

#[test]
fn reference_sizes_accept_stable_membership_and_reject_time_geometry_state_through_functions() {
    let mut body = reference_fixture();
    body["scene"]["value"]["layout"]["fontSizeBindings"][0]["referenceValue"] = json!({"kind":"expression","expression":{
        "op":"call","function":"mul","args":[{"op":"literal","type":"length","value":14},read("unit.selectedCount")]}});
    parse_style(&body).unwrap();
    for path in [
        "time.progress",
        "layout.width",
        "layout.referenceInkWidth",
        "unit.active",
        "unit.read",
        "unit.unread",
        "unit.referenceInkAvailable",
        "unit.lineEnvelopeAvailable",
        "unit.pageEnvelopeAvailable",
        "material.surfaceWidth",
    ] {
        let mut bad = reference_fixture();
        let scene = &mut bad["scene"]["value"];
        scene["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-layer-capture/1"));
        scene["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-page-envelope/1"));
        let value_type = context_type(path).unwrap();
        let body_expr = if value_type == ValueType::Bool {
            json!({"op":"if","condition":read(path),"then":{"op":"literal","type":"length","value":12},"else":{"op":"literal","type":"length","value":14}})
        } else if value_type == ValueType::Scalar {
            json!({"op":"call","function":"mul","args":[{"op":"literal","type":"length","value":14},read(path)]})
        } else {
            read(path)
        };
        scene["functions"] = json!([{"id":"hidden","arguments":[],"returns":"length","body":body_expr},
            {"id":"outer","arguments":[],"returns":"length","body":{"op":"call","function":"hidden","args":[]}}]);
        scene["layout"]["fontSizeBindings"][0]["referenceValue"] =
            json!({"kind":"expression","expression":{"op":"call","function":"outer","args":[]}});
        assert!(parse_style(&bad).is_err(), "{path}");
    }
    let mut bad = reference_fixture();
    bad["scene"]["value"]["layout"]["fontSizeBindings"][0]["referenceValue"] =
        bad["scene"]["value"]["layout"]["fontSizeBindings"][2]["value"].clone();
    assert!(parse_style(&bad).is_err(), "reference keyframes are time-dependent");
}

#[test]
fn reference_font_size_and_style_selectors_reject_nested_state_membership() {
    for style_only in [false, true] {
        let mut body = reference_fixture();
        let scene = &mut body["scene"]["value"];
        scene["selectors"][0]["filter"] = json!({"kind":"not","filter":{"kind":"or","filters":[{"kind":"state","value":"active"}]}});
        if style_only {
            scene["layout"]["fontSizeBindings"] = json!([]);
            scene["requiredCapabilities"]
                .as_array_mut()
                .unwrap()
                .push(json!("caption-unit-font-style/1"));
            scene["layout"]["fontStyleBindings"] =
                json!([{"id":"static-style","nodeId":"caption","selectorId":"pages","style":{"fontWeight":700}}]);
        }
        assert!(parse_style(&body).is_err());
    }
    let old: Value = serde_json::from_str(include_str!("fixtures/unit-font-size.json")).unwrap();
    parse_style(&old).expect("legacy state-dependent size selection remains supported without reference geometry");
}

#[test]
fn public_reference_and_surface_fields_have_types_and_require_their_capabilities() {
    let body = reference_fixture();
    let style = parse_style(&body).unwrap();
    let scene = style.scene();
    for path in [
        "layout.referenceInkX",
        "layout.referenceInkY",
        "layout.referenceInkWidth",
        "layout.referenceInkHeight",
        "unit.referenceInkAvailable",
    ] {
        let expression = Expression::Read { path: path.into() };
        assert_eq!(
            infer(&expression, scene, &BTreeMap::new()).unwrap(),
            if path.starts_with("unit.") {
                ValueType::Bool
            } else {
                ValueType::Length
            }
        );
        let mut old = scene.clone();
        old.required_capabilities.retain(|cap| cap != "caption-reference-geometry/1");
        assert!(infer(&expression, &old, &BTreeMap::new()).is_err());
        let mut context = Context::default();
        context.fields.insert(
            path.into(),
            if path.starts_with("unit.") {
                Evaluated::Bool(true)
            } else {
                Evaluated::Number(ValueType::Length, 1.0)
            },
        );
        assert!(evaluate(&expression, &old, &context, &mut Budget::default()).is_err());
    }
    let style = parse_style(&capture_fixture()).unwrap();
    for path in [
        "material.surfaceX",
        "material.surfaceY",
        "material.surfaceWidth",
        "material.surfaceHeight",
    ] {
        assert_eq!(
            infer(&Expression::Read { path: path.into() }, style.scene(), &BTreeMap::new()).unwrap(),
            ValueType::Length
        );
    }
}

#[test]
fn capture_model_roundtrips_and_rejects_null_wrong_context_or_unsupported_materials() {
    let body = capture_fixture();
    let parsed = parse_style(&body).unwrap();
    assert!(parsed.scene().render_layers[0].capture.is_some());
    assert_eq!(parse_style(&serde_json::to_value(&parsed).unwrap()).unwrap(), parsed);
    for case in ["null", "missing-cap", "wrong-context", "two-texts", "feedback", "blur"] {
        let mut bad = body.clone();
        let scene = &mut bad["scene"]["value"];
        match case {
            "null" => scene["renderLayers"][0]["capture"] = Value::Null,
            "missing-cap" => scene["requiredCapabilities"]
                .as_array_mut()
                .unwrap()
                .retain(|cap| cap != "caption-layer-capture/1"),
            "wrong-context" => scene["renderLayers"][0]["capture"]["contextNodeId"] = json!("missing"),
            "two-texts" => {
                let mut other = scene["nodes"][0].clone();
                other["id"] = json!("other");
                scene["nodes"].as_array_mut().unwrap().push(other);
                scene["renderLayers"][0]["source"]["nodeIds"] = json!(["text", "other"]);
            }
            "feedback" => {
                scene["requiredCapabilities"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!("caption-feedback/1"));
                scene["renderLayers"][0]["materials"] =
                    json!([{"kind":"feedback","id":"trail","samples":2,"step":{"ticks":1,"timescale":30},"decay":0.5,"offset":[0,0]}])
            }
            "blur" => scene["renderLayers"][0]["materials"] = json!([{"kind":"blur","id":"blur","radius":c(1.0),"passes":1}]),
            _ => unreachable!(),
        }
        assert!(parse_style(&bad).is_err(), "{case}");
    }
    let mut old = body;
    old["scene"]["value"]["renderLayers"][0].as_object_mut().unwrap().remove("capture");
    let serialized = serde_json::to_value(parse_style(&old).unwrap()).unwrap();
    assert!(serialized["scene"]["value"]["renderLayers"][0].get("capture").is_none());
}

#[test]
fn material_surface_fields_allow_material_functions_but_never_capture_or_node_uses() {
    let mut body = capture_fixture();
    let scene = &mut body["scene"]["value"];
    scene["functions"] = json!([{"id":"surface-width","arguments":[],"returns":"length","body":read("material.surfaceWidth")},
        {"id":"outer","arguments":[],"returns":"length","body":{"op":"call","function":"surface-width","args":[]}}]);
    let hidden = json!({"kind":"expression","expression":{"op":"call","function":"outer","args":[]}});
    scene["renderLayers"][0]["materials"][0]["domain"]["width"] = hidden.clone();
    parse_style(&body).unwrap();
    let mut capture = body.clone();
    capture["scene"]["value"]["renderLayers"][0]["capture"]["rect"]["width"] = hidden.clone();
    assert!(
        parse_style(&capture).is_err(),
        "capture cannot read the surface it creates through functions"
    );
    let mut node = body.clone();
    node["scene"]["value"]["nodes"][0]["properties"] = json!({"transform.x":hidden});
    assert!(
        parse_style(&node).is_err(),
        "node pose cannot read a material surface through functions"
    );
    let mut allowed = body;
    allowed["scene"]["value"]["renderLayers"][0]["capture"]["rect"]["x"] = expr("layout.x");
    parse_style(&allowed).expect("capture may consume completed layout");
}
