use caption_scene::*;
use serde_json::{Value, json};

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/unit-paint-properties.json")).unwrap()
}
fn scene(body: &mut Value) -> &mut Value {
    &mut body["scene"]["value"]
}
fn binding(body: &mut Value, index: usize) -> &mut Value {
    &mut scene(body)["paintPropertyBindings"][index]
}
fn remove_capability(body: &mut Value, capability: &str) {
    scene(body)["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c != capability);
}
fn solid(id: &str) -> Value {
    json!({"id":id,"paint":{"kind":"solid","color":"#000000FF"}})
}
fn gradient() -> Value {
    json!({"kind":"linear","from":[0,0],"to":[1,0],
        "stops":[{"at":0,"color":"#000000FF"},{"at":1,"color":"#FFFFFFFF"}]})
}

#[test]
fn dynamic_paint_properties_roundtrip_and_allow_layers_in_only_some_static_stacks() {
    let parsed = parse_style(&fixture()).unwrap();
    assert_eq!(parsed.scene().paint_property_bindings.len(), 3);
    assert_eq!(parsed.scene().paint_property_bindings[0].property, PaintProperty::Color);
    assert_eq!(parsed.scene().paint_property_bindings[1].property, PaintProperty::Blur);
    assert_eq!(parse_style(&serde_json::to_value(&parsed).unwrap()).unwrap(), parsed);
    assert_eq!(
        paint_style_order(parsed.scene(), "caption").unwrap(),
        ["shade", "accent-shade", "ink"]
    );
    // A property may target an ID found only in a static replacement. Missing
    // IDs in another selected stack are a sample-time no-op, not allocation.
    assert!(parsed.scene().nodes[0].style.paints.iter().all(|layer| layer.id != "accent-shade"));
}

#[test]
fn word_filters_include_dynamic_state_and_existing_recursive_semantic_filters() {
    let mut body = fixture();
    scene(&mut body)["selectors"][0]["filter"] = json!({"kind":"and","filters":[
        {"kind":"state","value":"active"},
        {"kind":"or","filters":[{"kind":"tag","value":"accent"},{"kind":"parity","odd":true}]},
        {"kind":"not","filter":{"kind":"range","start":3,"end":4}},
        {"kind":"all"}
    ]});
    parse_style(&body).unwrap();
    for filter in [json!({"kind":"range","start":3,"end":2}), json!({"kind":"other"})] {
        scene(&mut body)["selectors"][0]["filter"] = filter;
        assert!(parse_style(&body).is_err());
    }
    let mut filter = json!({"kind":"all"});
    for _ in 0..18 {
        filter = json!({"kind":"not","filter":filter});
    }
    scene(&mut body)["selectors"][0]["filter"] = filter;
    assert!(parse_style(&body).is_err());
}

#[test]
fn capability_and_text_word_target_are_required() {
    let mut body = fixture();
    remove_capability(&mut body, "caption-unit-paint-properties/1");
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    let mut body = fixture();
    remove_capability(&mut body, "caption-paint-effects/1");
    // Even a zero-blur px base cannot bypass effects admission via a patch.
    let layer = &mut scene(&mut body)["nodes"][0]["style"]["paints"][0];
    layer.as_object_mut().unwrap().remove("unit");
    layer.as_object_mut().unwrap().remove("blur");
    scene(&mut body)["paintStyleBindings"] = json!([]);
    scene(&mut body)["paintPropertyBindings"].as_array_mut().unwrap().pop();
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    for (pointer, value) in [
        ("/scene/value/paintPropertyBindings/0/nodeId", json!("missing")),
        ("/scene/value/paintPropertyBindings/0/selectorId", json!("missing")),
        ("/scene/value/paintPropertyBindings/0/paintId", json!("missing")),
        ("/scene/value/paintPropertyBindings/0/paintId", json!("invalid.id")),
        ("/scene/value/selectors/0/unit", json!("page")),
        ("/scene/value/selectors/0/unit", json!("line")),
        ("/scene/value/selectors/0/unit", json!("grapheme")),
        ("/scene/value/nodes/0/type", json!("label")),
    ] {
        let mut bad = fixture();
        *bad.pointer_mut(pointer).unwrap() = value;
        assert!(parse_style(&bad).is_err(), "{pointer}");
    }
    let mut body = fixture();
    scene(&mut body)["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"other","type":"text"}));
    scene(&mut body)["selectors"][0]["nodeId"] = json!("other");
    assert!(parse_style(&body).is_err());
}

#[test]
fn target_needs_explicit_base_stack_without_legacy_stroke() {
    for paints in [Value::Null, json!([])] {
        let mut body = fixture();
        scene(&mut body)["nodes"][0]["style"]["paints"] = paints;
        assert!(parse_style(&body).is_err());
    }
    let mut body = fixture();
    scene(&mut body)["nodes"][0]["style"]["stroke"] = json!({"width":1,"color":"#000000FF"});
    assert!(parse_style(&body).is_err());
}

#[test]
fn color_is_replace_only_and_checks_every_possible_definition_even_inactive() {
    for composite in ["add", "multiply"] {
        let mut body = fixture();
        binding(&mut body, 0)["composite"] = json!(composite);
        assert!(parse_style(&body).is_err());
    }
    for paint in [gradient(), json!({"kind":"node-fill"})] {
        let mut body = fixture();
        scene(&mut body)["paintStyleBindings"][0]["style"]["paints"][0]["id"] = json!("shade");
        scene(&mut body)["paintStyleBindings"][0]["style"]["paints"][0]["paint"] = paint;
        // Keep only the color patch, with a static selection that matches no word.
        scene(&mut body)["paintPropertyBindings"].as_array_mut().unwrap().truncate(1);
        scene(&mut body)["selectors"][1]["filter"] = json!({"kind":"range","start":0,"end":0});
        assert!(parse_style(&body).is_err());
    }
}

#[test]
fn blur_accepts_each_numeric_composite_and_defers_composed_range_to_sampling() {
    for composite in ["replace", "add", "multiply"] {
        let mut body = fixture();
        binding(&mut body, 1)["composite"] = json!(composite);
        parse_style(&body).unwrap();
    }
    let mut body = fixture();
    binding(&mut body, 1)["composite"] = json!("add");
    binding(&mut body, 1)["value"] = json!({"kind":"constant","value":-0.01});
    parse_style(&body).unwrap();
    // A replacement uses the selected layer's own unit; the same stable ID
    // may have different units across explicit static stacks.
    scene(&mut body)["paintStyleBindings"][0]["style"]["paints"][0] = solid("shade");
    scene(&mut body)["paintPropertyBindings"].as_array_mut().unwrap().truncate(2);
    parse_style(&body).unwrap();
}

#[test]
fn property_values_share_typed_expressions_functions_and_keyframe_validation() {
    for (index, value) in [
        (0, json!({"kind":"constant","value":0.2})),
        (1, json!({"kind":"constant","value":"#FFFFFF"})),
        (1, json!({"kind":"expression","expression":{"op":"read","path":"canvas.width"}})),
        (
            1,
            json!({"kind":"expression","expression":{"op":"read","path":"layout.paintWidth"}}),
        ),
    ] {
        let mut body = fixture();
        binding(&mut body, index)["value"] = value;
        assert!(parse_style(&body).is_err());
    }
    let mut body = fixture();
    binding(&mut body, 1)["value"] = json!({"kind":"expression","expression":{"op":"call","function":"div","args":[
        {"op":"read","path":"layout.width"},{"op":"literal","type":"length","value":100}
    ]}});
    parse_style(&body).unwrap();
    let mut body = fixture();
    scene(&mut body)["functions"][0]["returns"] = json!("color");
    assert!(parse_style(&body).is_err());
    for (pointer, value) in [
        ("/scene/value/paintPropertyBindings/1/value/clock/unit", json!("grapheme")),
        (
            "/scene/value/paintPropertyBindings/1/value/clock/offset",
            json!({"ticks":0,"timescale":0}),
        ),
        ("/scene/value/paintPropertyBindings/1/value/clock/repeat", json!({"iterations":0})),
        ("/scene/value/paintPropertyBindings/1/value/keys/1/at", json!(0)),
        ("/scene/value/paintPropertyBindings/1/value/keys/1/value", json!("#FFFFFF")),
    ] {
        let mut bad = fixture();
        // offset/repeat are intentionally absent in the authored fixture.
        if let Some(slot) = bad.pointer_mut(pointer) {
            *slot = value;
        } else if let Some((parent, key)) = pointer.rsplit_once('/') {
            bad.pointer_mut(parent).unwrap()[key] = value;
        }
        assert!(parse_style(&bad).is_err(), "{pointer}");
    }
}

#[test]
fn binding_ids_capacity_and_strict_fields_are_checked() {
    let mut body = fixture();
    binding(&mut body, 1)["id"] = json!("shade-color");
    assert!(parse_style(&body).is_err());
    let mut body = fixture();
    let template = binding(&mut body, 0).clone();
    scene(&mut body)["paintPropertyBindings"] = Value::Array(
        (0..64)
            .map(|i| {
                let mut item = template.clone();
                item["id"] = json!(format!("paint-{i}"));
                item
            })
            .collect(),
    );
    parse_style(&body).unwrap();
    scene(&mut body)["paintPropertyBindings"].as_array_mut().unwrap().push(json!({
        "id":"overflow","nodeId":"caption","selectorId":"words","paintId":"shade",
        "property":"color","composite":"replace","value":{"kind":"constant","value":"#FFFFFF"}
    }));
    assert!(parse_style(&body).is_err());
    for (pointer, value) in [
        ("/scene/value/paintPropertyBindings", Value::Null),
        ("/scene/value/paintPropertyBindings/0", Value::Null),
        ("/scene/value/paintPropertyBindings/0/property", json!("spread")),
        ("/scene/value/paintPropertyBindings/0/composite", json!("over")),
        ("/scene/value/paintPropertyBindings/0/value", Value::Null),
    ] {
        let mut bad = fixture();
        *bad.pointer_mut(pointer).unwrap() = value;
        assert!(parse_style(&bad).is_err(), "{pointer}");
    }
    for field in ["id", "nodeId", "selectorId", "paintId", "property", "composite", "value"] {
        let mut bad = fixture();
        binding(&mut bad, 0).as_object_mut().unwrap().remove(field);
        assert!(parse_style(&bad).is_err(), "{field}");
        let mut bad = fixture();
        binding(&mut bad, 0)[field] = Value::Null;
        assert!(parse_style(&bad).is_err(), "null {field}");
    }
    for field in ["priority", "unexpected"] {
        let mut bad = fixture();
        binding(&mut bad, 0)[field] = json!(0);
        assert!(parse_style(&bad).is_err(), "{field}");
    }
}

#[test]
fn all_static_candidate_layer_orders_still_require_one_acyclic_global_order() {
    let mut body = fixture();
    scene(&mut body)["paintStyleBindings"][0]["style"]["paints"] = json!([
        {"id":"ink","paint":{"kind":"node-fill"}},solid("shade")
    ]);
    scene(&mut body)["paintPropertyBindings"].as_array_mut().unwrap().truncate(2);
    assert!(parse_style(&body).unwrap_err().detail.contains("cycle"));
}

#[test]
fn empty_property_bindings_preserve_legacy_serialization() {
    let body: Value = serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap();
    let parsed = parse_style(&body).unwrap();
    assert!(parsed.scene().paint_property_bindings.is_empty());
    let before = serde_json::to_value(parsed).unwrap();
    let mut explicit = body;
    scene(&mut explicit)["paintPropertyBindings"] = json!([]);
    let after = serde_json::to_value(parse_style(&explicit).unwrap()).unwrap();
    assert_eq!(before, after);
    assert!(after["scene"]["value"].get("paintPropertyBindings").is_none());
}
