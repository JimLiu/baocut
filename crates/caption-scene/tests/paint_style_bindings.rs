use caption_scene::*;
use serde_json::{Value, json};

fn layer(id: &str, color: &str) -> Value {
    json!({"id":id,"paint":{"kind":"solid","color":color}})
}

fn binding(id: &str, paints: Vec<Value>) -> Value {
    json!({"id":id,"nodeId":"caption","selectorId":"words","style":{"paints":paints}})
}

fn fixture() -> Value {
    let mut body: Value = serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap();
    let scene = &mut body["scene"]["value"];
    scene["animations"] = json!([]);
    scene["requiredCapabilities"] = json!([
        "caption-scene/1",
        "caption-expressions/1",
        "caption-paint-stack/1",
        "caption-paint-style-bindings/1"
    ]);
    scene["nodes"][0]["style"]["paints"] = json!([layer("ink", "#FFFFFFFF")]);
    scene["paintStyleBindings"] = json!([binding("accent", vec![layer("ink", "#FF0000FF")])]);
    body
}

fn scene(body: &mut Value) -> &mut Value {
    &mut body["scene"]["value"]
}

fn patch(body: &mut Value) -> &mut Value {
    &mut scene(body)["paintStyleBindings"][0]["style"]
}

fn bound_layer(body: &mut Value) -> &mut Value {
    &mut patch(body)["paints"][0]
}

fn add_capability(body: &mut Value, capability: &str) {
    scene(body)["requiredCapabilities"].as_array_mut().unwrap().push(json!(capability));
}

fn remove_capability(body: &mut Value, capability: &str) {
    scene(body)["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c != capability);
}

fn inactive_fixture() -> Value {
    let mut body = fixture();
    scene(&mut body)["selectors"][0]["filter"] = json!({"kind":"range","start":3,"end":3});
    body
}

fn gradient() -> Value {
    json!({"kind":"linear","from":[0,0],"to":[1,0],
        "stops":[{"at":0,"color":"#FF0000FF"},{"at":1,"color":"#0000FFFF"}]})
}

fn image() -> Value {
    json!({"kind":"image","resourceId":"texture","uvTransform":[1,0,0,1,0,0],"space":"glyph-em"})
}

fn image_fixture() -> Value {
    let mut body = inactive_fixture();
    add_capability(&mut body, "caption-image-paint/1");
    scene(&mut body)["resources"] = json!([{
        "id":"texture","assetRef":{"id":"texture-asset","revision":"1"},
        "contentHash":format!("sha256:{}", "0".repeat(64))
    }]);
    bound_layer(&mut body)["paint"] = image();
    body
}

#[test]
fn complete_stacks_roundtrip_with_changed_shared_layers_and_added_or_removed_layers() {
    let mut body = fixture();
    scene(&mut body)["nodes"][0]["style"]["paints"] = json!([layer("shadow", "#00000080"), layer("ink", "#FFFFFFFF")]);
    scene(&mut body)["paintStyleBindings"] = json!([
        binding("accent", vec![layer("halo", "#FFFF0080"), layer("ink", "#FF0000FF")]),
        binding("plain", vec![layer("ink", "#00FF00FF")])
    ]);
    patch(&mut body)["fill"] = json!("#123456FF");
    patch(&mut body)["paints"][1]["paint"] = json!({"kind":"node-fill"});
    add_capability(&mut body, "caption-paint-effects/1");
    let parsed = parse_style(&body).unwrap();
    assert_eq!(parse_style(&serde_json::to_value(&parsed).unwrap()).unwrap(), parsed);
    assert_eq!(paint_style_order(parsed.scene(), "caption").unwrap(), ["shadow", "halo", "ink"]);
    let encoded = serde_json::to_value(parsed).unwrap();
    assert_eq!(
        encoded["scene"]["value"]["paintStyleBindings"][0]["style"]["paints"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        encoded["scene"]["value"]["paintStyleBindings"][1]["style"]["paints"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(encoded["scene"]["value"]["paintStyleBindings"][1]["style"].get("fill").is_none());
}

#[test]
fn static_word_membership_accepts_boolean_filters_and_ordinary_pagination() {
    for filter in [
        json!({"kind":"all"}),
        json!({"kind":"tag","value":"accent"}),
        json!({"kind":"range","start":0,"end":2}),
        json!({"kind":"parity","odd":true}),
        json!({"kind":"and","filters":[{"kind":"tag","value":"accent"},{"kind":"range","start":0,"end":2}]}),
        json!({"kind":"or","filters":[{"kind":"all"},{"kind":"parity","odd":false}]}),
        json!({"kind":"not","filter":{"kind":"or","filters":[{"kind":"tag","value":"skip"},{"kind":"parity","odd":true}]}}),
    ] {
        let mut body = fixture();
        scene(&mut body)["selectors"][0]["filter"] = filter.clone();
        assert!(parse_style(&body).is_ok(), "{filter}");
    }
}

#[test]
fn layer_order_uses_all_stack_constraints_and_first_declaration_to_break_ties() {
    let mut body = fixture();
    scene(&mut body)["nodes"][0]["style"]["paints"] = json!([layer("a", "#FFFFFF"), layer("d", "#FFFFFF")]);
    scene(&mut body)["paintStyleBindings"] = json!([
        binding("first", vec![layer("b", "#FFFFFF"), layer("d", "#FFFFFF")]),
        binding("second", vec![layer("c", "#FFFFFF"), layer("d", "#FFFFFF")])
    ]);
    let parsed = parse_style(&body).unwrap();
    assert_eq!(paint_style_order(parsed.scene(), "caption").unwrap(), ["a", "b", "c", "d"]);
    let mut body = fixture();
    scene(&mut body)["nodes"][0]["style"]["paints"] = json!([layer("a", "#FFFFFF"), layer("d", "#FFFFFF")]);
    scene(&mut body)["paintStyleBindings"] = json!([binding("first", vec![layer("b", "#FFFFFF"), layer("c", "#FFFFFF")])]);
    let parsed = parse_style(&body).unwrap();
    assert_eq!(paint_style_order(parsed.scene(), "caption").unwrap(), ["a", "d", "b", "c"]);
}

#[test]
fn cycles_and_the_union_layer_budget_are_rejected_even_for_inactive_bindings() {
    let mut body = inactive_fixture();
    scene(&mut body)["nodes"][0]["style"]["paints"] = json!([layer("a", "#FFFFFF"), layer("b", "#FFFFFF")]);
    scene(&mut body)["paintStyleBindings"] = json!([
        binding("first", vec![layer("b", "#FFFFFF"), layer("c", "#FFFFFF")]),
        binding("second", vec![layer("c", "#FFFFFF"), layer("a", "#FFFFFF")])
    ]);
    assert!(parse_style(&body).is_err());
    let invalid_scene: Scene = serde_json::from_value(body["scene"]["value"].clone()).unwrap();
    assert!(paint_style_order(&invalid_scene, "caption").is_err());
    let mut body = inactive_fixture();
    scene(&mut body)["paintStyleBindings"] = Value::Array(
        (0..15)
            .map(|i| binding(&format!("binding-{i}"), vec![layer(&format!("layer-{i}"), "#FFFFFF")]))
            .collect(),
    );
    let parsed = parse_style(&body).unwrap();
    assert_eq!(paint_style_order(parsed.scene(), "caption").unwrap().len(), 16);
    scene(&mut body)["paintStyleBindings"]
        .as_array_mut()
        .unwrap()
        .push(binding("overflow", vec![layer("seventeenth", "#FFFFFF")]));
    assert!(parse_style(&body).is_err());
}

#[test]
fn bindings_require_capability_same_text_word_selector_and_nonempty_base_stack() {
    let mut body = fixture();
    remove_capability(&mut body, "caption-paint-style-bindings/1");
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    for (pointer, bad) in [
        ("/scene/value/paintStyleBindings/0/nodeId", json!("missing")),
        ("/scene/value/paintStyleBindings/0/selectorId", json!("missing")),
        ("/scene/value/selectors/0/unit", json!("grapheme")),
        ("/scene/value/selectors/0/unit", json!("page")),
        ("/scene/value/selectors/0/unit", json!("line")),
        ("/scene/value/nodes/0/style/paints", json!([])),
    ] {
        let mut body = fixture();
        *body.pointer_mut(pointer).unwrap() = bad;
        assert!(parse_style(&body).is_err(), "{pointer}: {body}");
    }
    let mut body = fixture();
    scene(&mut body)["nodes"].as_array_mut().unwrap().push(json!({
        "id":"other","type":"text","style":{"paints":[layer("ink", "#FFFFFF")]}
    }));
    scene(&mut body)["paintStyleBindings"][0]["nodeId"] = json!("other");
    assert!(parse_style(&body).is_err(), "selector belongs to another text node");
    let mut body = fixture();
    scene(&mut body)["nodes"][0]["style"]["stroke"] = json!({"color":"#000000","width":1});
    assert!(parse_style(&body).is_err(), "legacy stroke cannot coexist with bound stacks");
}

#[test]
fn state_filters_are_rejected_at_every_boolean_nesting_position() {
    for state in ["active", "read", "unread"] {
        let state = json!({"kind":"state","value":state});
        for filter in [
            state.clone(),
            json!({"kind":"and","filters":[{"kind":"all"},state.clone()]}),
            json!({"kind":"or","filters":[{"kind":"all"},state.clone()]}),
            json!({"kind":"not","filter":state.clone()}),
            json!({"kind":"not","filter":{"kind":"and","filters":[{"kind":"all"},{"kind":"or","filters":[state.clone()]}]}}),
        ] {
            let mut body = fixture();
            scene(&mut body)["selectors"][0]["filter"] = filter.clone();
            assert!(parse_style(&body).is_err(), "{filter}");
        }
    }
}

#[test]
fn binding_ids_are_unique_and_binding_count_is_bounded_inclusively() {
    let mut body = fixture();
    let one = scene(&mut body)["paintStyleBindings"][0].clone();
    scene(&mut body)["paintStyleBindings"].as_array_mut().unwrap().push(one);
    assert!(parse_style(&body).is_err());
    let mut body = fixture();
    scene(&mut body)["paintStyleBindings"] = Value::Array(
        (0..64)
            .map(|i| binding(&format!("binding-{i}"), vec![layer("ink", "#FF0000")]))
            .collect(),
    );
    assert!(parse_style(&body).is_ok());
    scene(&mut body)["paintStyleBindings"]
        .as_array_mut()
        .unwrap()
        .push(binding("overflow", vec![layer("ink", "#FF0000")]));
    assert!(parse_style(&body).is_err());
}

#[test]
fn patch_requires_one_to_sixteen_layers_and_rejects_nulls_unknowns_and_dynamic_fill() {
    for (pointer, bad) in [
        ("/scene/value/paintStyleBindings", Value::Null),
        ("/scene/value/paintStyleBindings/0", Value::Null),
        ("/scene/value/paintStyleBindings/0/id", Value::Null),
        ("/scene/value/paintStyleBindings/0/nodeId", Value::Null),
        ("/scene/value/paintStyleBindings/0/selectorId", Value::Null),
        ("/scene/value/paintStyleBindings/0/style", Value::Null),
        ("/scene/value/paintStyleBindings/0/style/paints", Value::Null),
        ("/scene/value/paintStyleBindings/0/style/paints", json!([])),
        ("/scene/value/paintStyleBindings/0/style", json!({"fill":"#FFFFFF"})),
        ("/scene/value/paintStyleBindings/0/style", json!({})),
    ] {
        let mut body = fixture();
        *body.pointer_mut(pointer).unwrap() = bad;
        assert!(parse_style(&body).is_err(), "{pointer}: {body}");
    }
    for fill in [
        Value::Null,
        json!(false),
        json!(12),
        json!("bad-color"),
        json!({"kind":"constant","value":"#FFFFFF"}),
    ] {
        let mut body = fixture();
        patch(&mut body)["fill"] = fill;
        assert!(parse_style(&body).is_err());
    }
    for pointer in ["/scene/value/paintStyleBindings/0", "/scene/value/paintStyleBindings/0/style"] {
        let mut body = fixture();
        body.pointer_mut(pointer).unwrap()["extra"] = json!(true);
        assert!(parse_style(&body).is_err(), "{pointer}");
    }
    for field in ["id", "nodeId", "selectorId", "style"] {
        let mut body = fixture();
        scene(&mut body)["paintStyleBindings"][0].as_object_mut().unwrap().remove(field);
        assert!(parse_style(&body).is_err(), "missing {field}");
    }
    let mut body = fixture();
    patch(&mut body)["paints"] = Value::Array((0..16).map(|i| layer(&format!("p{i}"), "#FFFFFF")).collect());
    // Keep the base id in the replacement so the cross-stack union is also exactly sixteen.
    patch(&mut body)["paints"][0]["id"] = json!("ink");
    assert!(parse_style(&body).is_ok());
    patch(&mut body)["paints"]
        .as_array_mut()
        .unwrap()
        .push(layer("overflow", "#FFFFFF"));
    assert!(parse_style(&body).is_err());
}

#[test]
fn inactive_stacks_validate_all_layer_fields_and_duplicate_layer_ids() {
    for (field, bad) in [
        ("id", json!("")),
        ("id", Value::Null),
        ("paint", Value::Null),
        ("paint", json!({"kind":"solid","color":"invalid"})),
        ("strokeWidth", json!(-1)),
        ("strokeWidth", Value::Null),
        ("offset", json!([4097, 0])),
        ("offset", Value::Null),
        ("unit", json!("unknown")),
        ("unit", Value::Null),
        ("spread", json!(257)),
        ("spread", Value::Null),
        ("blur", json!(-1)),
        ("blur", Value::Null),
        ("coverage", Value::Null),
        ("coverage", json!({"lo":0.8,"hi":0.2})),
        ("mask", Value::Null),
        ("mask", json!({"kind":"unknown"})),
        ("extra", json!(true)),
    ] {
        let mut body = inactive_fixture();
        bound_layer(&mut body)[field] = bad;
        assert!(parse_style(&body).is_err(), "{field}: {}", bound_layer(&mut body));
    }
    let mut body = inactive_fixture();
    patch(&mut body)["paints"] = json!([layer("ink", "#FFFFFF"), layer("ink", "#FF0000")]);
    assert!(parse_style(&body).is_err());
    let mut body = inactive_fixture();
    add_capability(&mut body, "caption-paint-effects/1");
    bound_layer(&mut body)["spread"] = json!(1);
    bound_layer(&mut body)["strokeWidth"] = json!(1);
    assert!(parse_style(&body).is_err());
}

#[test]
fn typed_inactive_layers_reject_nonfinite_effect_and_coverage_values() {
    let mut body = inactive_fixture();
    add_capability(&mut body, "caption-paint-effects/1");
    add_capability(&mut body, "caption-paint-coverage/1");
    let valid = parse_style(&body).unwrap().scene().clone();
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for field in ["stroke", "offset", "spread", "blur", "coverage"] {
            let mut scene = valid.clone();
            let layer = &mut scene.paint_style_bindings[0].style.paints[0];
            match field {
                "stroke" => layer.stroke_width = bad,
                "offset" => layer.offset[0] = bad,
                "spread" => layer.spread = bad,
                "blur" => layer.blur = bad,
                "coverage" => layer.coverage = Some(PaintCoverage { lo: 0.0, hi: bad }),
                _ => unreachable!(),
            }
            assert!(validate_scene(&scene).is_err(), "{field}: {bad}");
        }
    }
}

#[test]
fn inactive_stacks_still_require_effect_coverage_mask_and_gradient_capabilities() {
    for (field, value, capabilities) in [
        ("blur", json!(1), vec!["caption-paint-effects/1"]),
        ("unit", json!("em"), vec!["caption-paint-effects/1"]),
        ("coverage", json!({"lo":0.1,"hi":0.8}), vec!["caption-paint-coverage/1"]),
        ("mask", json!({"kind":"glyph-fill"}), vec!["caption-paint-mask/1"]),
        (
            "mask",
            json!({"kind":"glyph-fill","offset":[1,0],"inverted":true}),
            vec!["caption-paint-mask/1", "caption-paint-mask-transform/1"],
        ),
    ] {
        let mut body = inactive_fixture();
        bound_layer(&mut body)[field] = value;
        for cap in &capabilities {
            add_capability(&mut body, cap);
        }
        assert!(parse_style(&body).is_ok(), "{field}");
        for cap in capabilities {
            let mut bad = body.clone();
            remove_capability(&mut bad, cap);
            assert_eq!(parse_style(&bad).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED", "{field}: {cap}");
        }
    }
    for (field, value, cap) in [
        ("space", json!("normalized"), "caption-gradient-space/1"),
        ("domain", json!("page"), "caption-gradient-space/1"),
        ("domain", json!("glyph"), "caption-gradient-glyph/1"),
    ] {
        let mut body = inactive_fixture();
        bound_layer(&mut body)["paint"] = gradient();
        bound_layer(&mut body)["paint"][field] = value;
        assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
        add_capability(&mut body, cap);
        assert!(parse_style(&body).is_ok());
    }
}

#[test]
fn inactive_image_stacks_validate_resources_matrix_phase_and_extra_capabilities() {
    let body = image_fixture();
    assert!(parse_style(&body).is_ok());
    let mut missing_capability = body.clone();
    remove_capability(&mut missing_capability, "caption-image-paint/1");
    assert_eq!(parse_style(&missing_capability).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    for (pointer, bad) in [
        ("/scene/value/resources", json!([])),
        (
            "/scene/value/paintStyleBindings/0/style/paints/0/paint/resourceId",
            json!("missing"),
        ),
        (
            "/scene/value/paintStyleBindings/0/style/paints/0/paint/uvTransform",
            json!([1, 0, 0, 0, 0, 0]),
        ),
    ] {
        let mut bad_body = body.clone();
        *bad_body.pointer_mut(pointer).unwrap() = bad;
        assert!(parse_style(&bad_body).is_err(), "{pointer}");
    }
    let mut body = image_fixture();
    bound_layer(&mut body)["paint"]["phase"] = json!({"period":3,"source":"cue-scalar-index","arithmetic":"float32","indexOffset":0.5});
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    add_capability(&mut body, "caption-image-phase-float32/1");
    assert!(parse_style(&body).is_ok());
    bound_layer(&mut body)["paint"]["phase"]["period"] = json!(0);
    assert!(parse_style(&body).is_err());
    let mut body = image_fixture();
    add_capability(&mut body, "caption-paint-coverage/1");
    bound_layer(&mut body)["coverage"] = json!({"lo":0,"hi":1});
    assert!(parse_style(&body).is_err(), "image paint cannot use silhouette coverage remapping");
}

#[test]
fn inactive_gradient_spread_and_coverage_retain_opaque_stop_restrictions() {
    for effect in ["spread", "coverage"] {
        let mut body = inactive_fixture();
        add_capability(&mut body, "caption-paint-effects/1");
        add_capability(&mut body, "caption-paint-coverage/1");
        bound_layer(&mut body)["paint"] = gradient();
        bound_layer(&mut body)[effect] = if effect == "spread" { json!(1) } else { json!({"lo":0,"hi":0.5}) };
        assert!(parse_style(&body).is_ok());
        bound_layer(&mut body)["paint"]["stops"][0]["color"] = json!("#FF000080");
        assert!(parse_style(&body).is_err(), "{effect}");
        bound_layer(&mut body).as_object_mut().unwrap().remove(effect);
        assert!(
            parse_style(&body).is_ok(),
            "translucent gradient without spread or coverage stays valid"
        );
    }
}

#[test]
fn node_fill_guard_covers_every_inactive_stack_and_binding_fill_override() {
    let mut body = inactive_fixture();
    bound_layer(&mut body)["paint"] = gradient();
    assert!(parse_style(&body).is_ok(), "color stacks need no node-fill without an override");
    patch(&mut body)["fill"] = json!("#FF0000");
    assert!(parse_style(&body).is_err(), "binding fill must have a node-fill destination");
    bound_layer(&mut body)["paint"] = json!({"kind":"node-fill"});
    add_capability(&mut body, "caption-paint-effects/1");
    assert!(parse_style(&body).is_ok());

    for (field, value) in [
        ("stateStyles", json!({"active":{"fill":"#FF0000"}})),
        ("properties", json!({"fill":{"kind":"constant","value":"#FF0000"}})),
        (
            "animations",
            json!([{
                "id":"color","target":{"nodeId":"caption","selectorId":"words"},
                "property":"fill","composite":"replace","value":{"kind":"constant","value":"#FF0000"}
            }]),
        ),
    ] {
        let mut body = inactive_fixture();
        add_capability(&mut body, "caption-paint-effects/1");
        scene(&mut body)["nodes"][0]["style"]["paints"][0]["paint"] = json!({"kind":"node-fill"});
        bound_layer(&mut body)["paint"] = json!({"kind":"node-fill"});
        if field == "animations" {
            scene(&mut body)[field] = value;
        } else {
            scene(&mut body)["nodes"][0][field] = value;
        }
        assert!(parse_style(&body).is_ok(), "{field} with node-fill in every stack");
        bound_layer(&mut body)["paint"] = gradient();
        assert!(
            parse_style(&body).is_err(),
            "{field} cannot be discarded by an inactive replacement"
        );
        bound_layer(&mut body)["paint"] = json!({"kind":"node-fill"});
        scene(&mut body)["nodes"][0]["style"]["paints"][0]["paint"] = gradient();
        assert!(parse_style(&body).is_err(), "{field} also requires node-fill in the base stack");
    }
}

#[test]
fn omitted_and_empty_bindings_leave_old_serialization_unchanged() {
    let mut body = fixture();
    scene(&mut body).as_object_mut().unwrap().remove("paintStyleBindings");
    remove_capability(&mut body, "caption-paint-style-bindings/1");
    let before = serde_json::to_value(parse_style(&body).unwrap()).unwrap();
    scene(&mut body)["paintStyleBindings"] = json!([]);
    let after = serde_json::to_value(parse_style(&body).unwrap()).unwrap();
    assert_eq!(before, after);
    assert!(after["scene"]["value"].get("paintStyleBindings").is_none());
}
