use caption_scene::*;
use serde_json::{Value, json};

const CAPABILITY: &str = "caption-glyph-distance-coverage/1";

fn coverage() -> Value {
    json!({
        "source":"glyph-contours",
        "bands":[
            {"offset":[0,0],"threshold":0,"halfWidth":0.05},
            {"offset":[0.2,-0.1],"threshold":0.025,"halfWidth":0.1}
        ],
        "aa":{"kind":"quad-derivative","sourceBand":1,"scale":0.75},
        "combine":"multiply",
        "zeroWidth":"error"
    })
}

fn fixture(value: Option<Value>) -> Value {
    let mut body: Value = serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap();
    let scene = &mut body["scene"]["value"];
    scene["animations"] = json!([]);
    scene["requiredCapabilities"] = json!([
        "caption-scene/1",
        "caption-expressions/1",
        "caption-paint-stack/1",
        "caption-paint-effects/1",
        "caption-paint-mask/1",
        "caption-paint-coverage/1",
        "caption-paint-style-bindings/1",
        CAPABILITY
    ]);
    scene["selectors"] = json!([{"id":"words","nodeId":"caption","unit":"word","filter":{"kind":"all"}}]);
    scene["nodes"][0]["properties"] = json!({});
    let mut layer = json!({"id":"ink","paint":{"kind":"solid","color":"#4080C080"}});
    if let Some(value) = value {
        layer["distanceCoverage"] = value;
    }
    scene["nodes"][0]["style"]["paints"] = json!([layer]);
    body
}

fn layer(body: &mut Value) -> &mut Value {
    &mut body["scene"]["value"]["nodes"][0]["style"]["paints"][0]
}

fn remove_capability(body: &mut Value, capability: &str) {
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|value| value != capability);
}

fn gradient() -> Value {
    json!({"kind":"linear","from":[0,0],"to":[1,1],
        "stops":[{"at":0,"color":"#F0402080"},{"at":1,"color":"#2040C040"}]})
}

#[test]
fn distance_coverage_roundtrips_typed_bands_and_omits_old_defaults() {
    let parsed = parse_style(&fixture(Some(coverage()))).unwrap();
    let distance = parsed.scene().nodes[0].style.paints[0].distance_coverage.as_ref().unwrap();
    assert_eq!(distance.source, GlyphDistanceSource::GlyphContours);
    assert_eq!(distance.combine, GlyphDistanceCombine::Multiply);
    assert_eq!(distance.zero_width, GlyphDistanceZeroWidth::Error);
    assert_eq!(distance.bands.len(), 2);
    assert_eq!(distance.bands[1].offset, [0.2, -0.1]);
    assert_eq!(distance.bands[1].threshold, 0.025);
    assert_eq!(distance.bands[1].half_width, 0.1);
    assert_eq!(distance.bands[0].distance_clamp, None);
    assert_eq!(distance.bands[0].threshold_clamp, None);
    assert_eq!(distance.bands[0].edge_clamp, None);
    assert_eq!(
        distance.aa,
        GlyphDistanceAa::QuadDerivative {
            source_band: 1,
            scale: 0.75
        }
    );
    let encoded = serde_json::to_value(&parsed).unwrap();
    assert_eq!(parse_style(&encoded).unwrap(), parsed);
    let band = &encoded["scene"]["value"]["nodes"][0]["style"]["paints"][0]["distanceCoverage"]["bands"][0];
    assert!(band.get("distanceClamp").is_none());
    assert!(band.get("thresholdClamp").is_none());
    assert!(band.get("edgeClamp").is_none());
    let old = parse_style(&fixture(None)).unwrap();
    assert_eq!(old.scene().nodes[0].style.paints[0].distance_coverage, None);
    assert!(
        serde_json::to_value(old).unwrap()["scene"]["value"]["nodes"][0]["style"]["paints"][0]
            .get("distanceCoverage")
            .is_none()
    );
}

#[test]
fn coverage_and_band_fields_are_required_and_unknown_objects_are_rejected() {
    for value in [json!(null), json!(false), json!("glyph-contours"), json!([]), json!({})] {
        assert!(parse_style(&fixture(Some(value.clone()))).is_err(), "{value}");
    }
    for key in ["source", "bands", "aa", "combine", "zeroWidth"] {
        let mut value = coverage();
        value.as_object_mut().unwrap().remove(key);
        assert!(parse_style(&fixture(Some(value))).is_err(), "missing {key}");
    }
    for key in ["offset", "threshold", "halfWidth"] {
        let mut value = coverage();
        value["bands"][0].as_object_mut().unwrap().remove(key);
        assert!(parse_style(&fixture(Some(value))).is_err(), "missing band {key}");
    }
    for key in ["kind", "sourceBand", "scale"] {
        let mut value = coverage();
        value["aa"].as_object_mut().unwrap().remove(key);
        assert!(parse_style(&fixture(Some(value))).is_err(), "missing aa {key}");
    }
    for (pointer, value) in [
        ("/source", json!("image-alpha")),
        ("/source", json!({"glyph-contours":null})),
        ("/combine", json!({"multiply":null})),
        ("/zeroWidth", json!({"error":null})),
        ("/zeroWidth", json!({"step-inclusive":null})),
        ("/combine", json!("over")),
        ("/zeroWidth", json!(null)),
        ("/zeroWidth", json!("step")),
        ("/zeroWidth", json!(false)),
        ("/aa/kind", json!("fixed")),
        ("/aa/sourceBand", json!(-1)),
        ("/aa/sourceBand", json!(0.5)),
        ("/aa/sourceBand", json!(true)),
        ("/bands", json!(null)),
        ("/bands", json!([])),
        ("/bands/0/offset", json!(null)),
        ("/bands/0/offset", json!([0])),
        ("/bands/0/offset", json!([0, 0, 0])),
        ("/bands/0/offset", json!(["0", 0])),
        ("/bands/0/threshold", json!(null)),
        ("/bands/0/halfWidth", json!("0.1")),
    ] {
        let mut bad = coverage();
        *bad.pointer_mut(pointer).unwrap() = value;
        assert!(parse_style(&fixture(Some(bad))).is_err(), "{pointer}");
    }
    for pointer in ["", "/bands/0", "/aa"] {
        let mut value = coverage();
        value
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unknown".into(), json!(1));
        assert!(parse_style(&fixture(Some(value))).is_err(), "unknown at {pointer}");
    }
}

#[test]
fn explicit_zero_width_policies_roundtrip_independently_of_aa_disable() {
    for (name, policy) in [
        ("error", GlyphDistanceZeroWidth::Error),
        ("step-inclusive", GlyphDistanceZeroWidth::StepInclusive),
    ] {
        let mut body = fixture(Some(coverage()));
        layer(&mut body)["distanceCoverage"]["zeroWidth"] = json!(name);
        layer(&mut body)["distanceCoverage"]["aa"]["scale"] = json!(0);
        let parsed = parse_style(&body).unwrap();
        assert_eq!(
            parsed.scene().nodes[0].style.paints[0]
                .distance_coverage
                .as_ref()
                .unwrap()
                .zero_width,
            policy
        );
        assert_eq!(parse_style(&serde_json::to_value(parsed.clone()).unwrap()).unwrap(), parsed);
    }
}

#[test]
fn optional_clamps_roundtrip_but_explicit_null_or_collapsed_intervals_fail() {
    let mut value = coverage();
    value["bands"][0]["distanceClamp"] = json!([-0.7, 0.8]);
    value["bands"][0]["thresholdClamp"] = json!([-0.3, 0.4]);
    value["bands"][1]["edgeClamp"] = json!([-0.5, 0.6]);
    let parsed = parse_style(&fixture(Some(value))).unwrap();
    let bands = &parsed.scene().nodes[0].style.paints[0].distance_coverage.as_ref().unwrap().bands;
    assert_eq!(bands[0].distance_clamp, Some([-0.7, 0.8]));
    assert_eq!(bands[0].threshold_clamp, Some([-0.3, 0.4]));
    assert_eq!(bands[1].edge_clamp, Some([-0.5, 0.6]));
    assert_eq!(parse_style(&serde_json::to_value(parsed.clone()).unwrap()).unwrap(), parsed);
    for key in ["distanceClamp", "thresholdClamp", "edgeClamp"] {
        for interval in [
            json!(null),
            json!([0]),
            json!([0, 1, 2]),
            json!([0, 0]),
            json!([1, -1]),
            json!([false, 1]),
        ] {
            let mut bad = coverage();
            bad["bands"][0][key] = interval;
            assert!(parse_style(&fixture(Some(bad))).is_err(), "invalid {key}");
        }
    }
}

#[test]
fn capability_is_required_for_base_and_unselected_replacement_stacks() {
    let mut body = fixture(Some(coverage()));
    remove_capability(&mut body, CAPABILITY);
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    let mut body = replacement_fixture(false);
    remove_capability(&mut body, CAPABILITY);
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    let mut body = fixture(Some(coverage()));
    layer(&mut body)["unit"] = json!("em");
    remove_capability(&mut body, "caption-paint-effects/1");
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
}

#[test]
fn band_lengths_and_clamps_obey_the_owning_paint_unit_bounds() {
    for (unit, reach, extent) in [("px", 4096.0, 256.0), ("em", 16.0, 4.0)] {
        let mut allowed = fixture(Some(coverage()));
        let paint = layer(&mut allowed);
        paint["unit"] = json!(unit);
        paint["distanceCoverage"]["bands"][0] = json!({
            "offset":[reach,-reach],"threshold":-extent,"halfWidth":extent,
            "distanceClamp":[-extent,extent],"thresholdClamp":[-extent,extent],"edgeClamp":[-extent,extent]
        });
        parse_style(&allowed).unwrap();
        for (field, invalid) in [
            ("offset", json!([reach + 0.01, 0])),
            ("offset", json!([0, -reach - 0.01])),
            ("threshold", json!(extent + 0.01)),
            ("threshold", json!(-extent - 0.01)),
            ("halfWidth", json!(-0.01)),
            ("halfWidth", json!(extent + 0.01)),
            ("distanceClamp", json!([-extent - 0.01, extent])),
            ("distanceClamp", json!([-extent, extent + 0.01])),
            ("thresholdClamp", json!([-extent - 0.01, extent])),
            ("edgeClamp", json!([-extent, extent + 0.01])),
        ] {
            let mut bad = allowed.clone();
            layer(&mut bad)["distanceCoverage"]["bands"][0][field] = invalid;
            assert!(parse_style(&bad).is_err(), "unit={unit}, field={field}");
        }
    }
    let mut one_band = fixture(Some(coverage()));
    layer(&mut one_band)["distanceCoverage"]["bands"].as_array_mut().unwrap().pop();
    layer(&mut one_band)["distanceCoverage"]["aa"]["sourceBand"] = json!(0);
    parse_style(&one_band).unwrap();
    layer(&mut one_band)["distanceCoverage"]["aa"]["sourceBand"] = json!(1);
    assert!(parse_style(&one_band).is_err());
    let mut three_bands = fixture(Some(coverage()));
    let extra = coverage()["bands"][0].clone();
    layer(&mut three_bands)["distanceCoverage"]["bands"]
        .as_array_mut()
        .unwrap()
        .push(extra);
    assert!(parse_style(&three_bands).is_err());
    for scale in [-0.1, 4.01] {
        let mut bad = fixture(Some(coverage()));
        layer(&mut bad)["distanceCoverage"]["aa"]["scale"] = json!(scale);
        assert!(parse_style(&bad).is_err(), "scale={scale}");
    }
    let mut allowed = fixture(Some(coverage()));
    layer(&mut allowed)["distanceCoverage"]["aa"]["scale"] = json!(4);
    layer(&mut allowed)["distanceCoverage"]["bands"][0]["halfWidth"] = json!(0);
    parse_style(&allowed).unwrap();
    layer(&mut allowed)["distanceCoverage"]["aa"]["scale"] = json!(0);
    parse_style(&allowed).unwrap();
    layer(&mut allowed)["distanceCoverage"]["aa"]["sourceBand"] = json!(2);
    assert!(parse_style(&allowed).is_err());
}

#[test]
fn distance_coverage_rejects_overlapping_legacy_coverage_operations() {
    for (field, value) in [
        ("offset", json!([0.1, 0])),
        ("spread", json!(0.1)),
        ("strokeWidth", json!(0.1)),
        ("blur", json!(0.1)),
        ("mask", json!({"kind":"glyph-fill"})),
        ("coverage", json!({"lo":0,"hi":1})),
    ] {
        let mut bad = fixture(Some(coverage()));
        layer(&mut bad)[field] = value;
        assert!(parse_style(&bad).is_err(), "legacy {field}");
    }
    let mut explicit_zero = fixture(Some(coverage()));
    for field in ["spread", "strokeWidth", "blur"] {
        layer(&mut explicit_zero)[field] = json!(0);
    }
    layer(&mut explicit_zero)["offset"] = json!([0, 0]);
    parse_style(&explicit_zero).unwrap();
}

#[test]
fn solid_node_fill_and_translucent_linear_paints_are_admitted_without_opaque_stop_coercion() {
    for paint in [json!({"kind":"solid","color":"#12345640"}), json!({"kind":"node-fill"}), gradient()] {
        let mut body = fixture(Some(coverage()));
        layer(&mut body)["paint"] = paint;
        let parsed = parse_style(&body).unwrap();
        assert_eq!(parse_style(&serde_json::to_value(parsed.clone()).unwrap()).unwrap(), parsed);
    }
}

#[test]
fn image_paints_and_group_scope_are_rejected_without_changing_their_legacy_admission() {
    let mut image = fixture(None);
    image["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-image-paint/1"));
    image["scene"]["value"]["resources"] = json!([{
        "id":"texture", "assetRef":{"id":"texture-asset","revision":"1"},
        "contentHash":format!("sha256:{}", "0".repeat(64))
    }]);
    layer(&mut image)["paint"] = json!({"kind":"image","resourceId":"texture", "uvTransform":[1,0,0,1,0,0],"space":"glyph-em"});
    parse_style(&image).unwrap();
    layer(&mut image)["distanceCoverage"] = coverage();
    assert!(parse_style(&image).is_err());

    let mut group = fixture(None);
    group["scene"]["value"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"group-paint", "type":"group"}));
    parse_style(&group).unwrap();
    group["scene"]["value"]["nodes"][1]["style"] = json!({"paints":[
        {"id":"group-ink", "paint":{"kind":"solid","color":"#FFFFFFFF"}, "distanceCoverage":coverage()}
    ]});
    assert!(parse_style(&group).is_err());
}

fn replacement_fixture(base_distance: bool) -> Value {
    let mut body = fixture(if base_distance { Some(coverage()) } else { None });
    let mut paint = json!({"id":"ink","paint":gradient()});
    if !base_distance {
        paint["distanceCoverage"] = coverage();
    }
    body["scene"]["value"]["selectors"][0]["filter"] = json!({"kind":"range","start":5,"end":5});
    body["scene"]["value"]["paintStyleBindings"] = json!([{
        "id":"replacement","nodeId":"caption","selectorId":"words","style":{"paints":[paint]}
    }]);
    body
}

#[test]
fn full_replacement_stacks_retain_distance_fields_and_validate_inactive_candidates() {
    let parsed = parse_style(&replacement_fixture(false)).unwrap();
    assert!(parsed.scene().nodes[0].style.paints[0].distance_coverage.is_none());
    assert!(parsed.scene().paint_style_bindings[0].style.paints[0].distance_coverage.is_some());
    assert_eq!(parse_style(&serde_json::to_value(parsed.clone()).unwrap()).unwrap(), parsed);
    let mut bad = replacement_fixture(false);
    bad["scene"]["value"]["paintStyleBindings"][0]["style"]["paints"][0]["distanceCoverage"]["bands"] = json!([]);
    assert!(parse_style(&bad).is_err());
}

#[test]
fn undeclared_dynamic_paint_properties_do_not_expand_distance_schema() {
    for base_distance in [false, true] {
        for (property, value) in [("blur", json!(0)), ("color", json!("#80402040"))] {
            let mut body = replacement_fixture(base_distance);
            // The independently supported static distance/binding contract is valid.
            parse_style(&body).unwrap();
            body["scene"]["value"]["paintPropertyBindings"] = json!([{
                "id":"dynamic-paint","nodeId":"caption","selectorId":"words","paintId":"ink",
                "property":property,"composite":"replace","value":{"kind":"constant","value":value}
            }]);
            let error = parse_style(&body).unwrap_err();
            assert_eq!(error.code, "CAPTION_CAPABILITY_REQUIRED");
            assert!(error.detail.contains("caption-unit-paint-properties/1"), "{error}");
        }
    }
}

#[test]
fn in_memory_nonfinite_distance_data_cannot_bypass_wire_validation() {
    let baseline = parse_style(&fixture(Some(coverage()))).unwrap().scene().clone();
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for field in 0..6 {
            let mut scene = baseline.clone();
            let distance = scene.nodes[0].style.paints[0].distance_coverage.as_mut().unwrap();
            match field {
                0 => distance.bands[0].offset[0] = value,
                1 => distance.bands[0].threshold = value,
                2 => distance.bands[0].half_width = value,
                3 => distance.bands[0].distance_clamp = Some([value, 1.0]),
                4 => distance.bands[0].threshold_clamp = Some([value, 1.0]),
                _ => distance.bands[0].edge_clamp = Some([0.0, value]),
            }
            assert!(validate_scene(&scene).is_err(), "field={field}, value={value}");
        }
        let mut scene = baseline.clone();
        let GlyphDistanceAa::QuadDerivative { scale, .. } = &mut scene.nodes[0].style.paints[0].distance_coverage.as_mut().unwrap().aa;
        *scale = value;
        assert!(validate_scene(&scene).is_err());
    }
}

#[test]
fn distance_work_budget_is_independent_and_failed_reservations_preserve_credit() {
    const LIMIT: u64 = 128 * 1024 * 1024;
    let mut budget = Budget::default();
    budget.reserve_glyph_distance_work(LIMIT - 1).unwrap();
    assert_eq!(budget.reserve_glyph_distance_work(2).unwrap_err().code, "CAPTION_BUDGET_EXCEEDED");
    assert!(budget.reserve_glyph_distance_work(u64::MAX).is_err());
    budget.reserve_glyph_distance_work(1).unwrap();
    assert!(budget.reserve_glyph_distance_work(1).is_err());
    budget.reserve_paint_mask_work(LIMIT).unwrap();
    budget.reserve_image_paint_work(256 * 1024 * 1024).unwrap();
    budget.reserve_image_paint_pixels(16 * 1024 * 1024).unwrap();
    let mut from_old_budgets = Budget::default();
    from_old_budgets.reserve_paint_mask_work(LIMIT).unwrap();
    from_old_budgets.reserve_image_paint_work(256 * 1024 * 1024).unwrap();
    from_old_budgets.reserve_image_paint_pixels(16 * 1024 * 1024).unwrap();
    from_old_budgets.reserve_glyph_distance_work(LIMIT).unwrap();
}

const IMAGE_DISTANCE_CAPABILITY: &str = "caption-image-distance-coverage/1";

fn image_distance_fixture() -> Value {
    let mut body = fixture(Some(coverage()));
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([json!("caption-image-paint/1"), json!(IMAGE_DISTANCE_CAPABILITY)]);
    scene["resources"] = json!([{
        "id":"texture", "assetRef":{"id":"generic-texture","revision":"1"},
        "contentHash":format!("sha256:{}", "0".repeat(64))
    }]);
    layer(&mut body)["paint"] = json!({
        "kind":"image", "resourceId":"texture", "uvTransform":[1,0,0,1,0,0],
        "space":"glyph-em", "wrap":"repeat", "filter":"bilinear", "opacity":0.5,
        "compositeOpacity":0.6, "base":{"kind":"solid","color":"#00FF0080"}
    });
    body
}

#[test]
fn image_distance_roundtrips_only_with_both_original_capabilities_and_explicit_composition() {
    let body = image_distance_fixture();
    let parsed = parse_style(&body).unwrap();
    assert_eq!(parse_style(&serde_json::to_value(&parsed).unwrap()).unwrap(), parsed);
    assert!(matches!(parsed.scene().nodes[0].style.paints[0].paint, ScenePaint::Image { .. }));
    assert!(parsed.scene().nodes[0].style.paints[0].distance_coverage.is_some());
    for capability in [CAPABILITY, "caption-image-paint/1", IMAGE_DISTANCE_CAPABILITY] {
        let mut missing = body.clone();
        remove_capability(&mut missing, capability);
        let error = parse_style(&missing).unwrap_err();
        assert_eq!(error.code, "CAPTION_CAPABILITY_REQUIRED", "{capability}");
    }
    let mut ordinary = image_distance_fixture();
    layer(&mut ordinary).as_object_mut().unwrap().remove("distanceCoverage");
    remove_capability(&mut ordinary, CAPABILITY);
    remove_capability(&mut ordinary, IMAGE_DISTANCE_CAPABILITY);
    parse_style(&ordinary).unwrap();
}

#[test]
fn image_distance_retains_legacy_exclusions_and_strict_image_validation() {
    for (field, value) in [
        ("offset", json!([0.1, 0])),
        ("spread", json!(0.1)),
        ("strokeWidth", json!(0.1)),
        ("blur", json!(0.1)),
        ("mask", json!({"kind":"glyph-fill"})),
        ("coverage", json!({"lo":0,"hi":1})),
    ] {
        let mut body = image_distance_fixture();
        layer(&mut body)[field] = value;
        assert!(parse_style(&body).is_err(), "legacy {field}");
    }
    for (field, value) in [
        ("resourceId", json!("undeclared")),
        ("uvTransform", json!([0, 0, 0, 0, 0, 0])),
        ("opacity", json!(-0.1)),
        ("compositeOpacity", json!(1.01)),
        ("phaseOffset", json!(-0.01)),
        (
            "base",
            json!({"kind":"image","resourceId":"texture","uvTransform":[1,0,0,1,0,0],"space":"glyph-em"}),
        ),
    ] {
        let mut body = image_distance_fixture();
        layer(&mut body)["paint"][field] = value;
        assert!(parse_style(&body).is_err(), "image {field}");
    }
}

#[test]
fn inactive_image_distance_replacements_require_the_same_composition_and_phase_capabilities() {
    let mut body = image_distance_fixture();
    let image_layer = layer(&mut body).clone();
    layer(&mut body)["paint"] = json!({"kind":"solid","color":"#FFFFFF"});
    layer(&mut body).as_object_mut().unwrap().remove("distanceCoverage");
    body["scene"]["value"]["selectors"][0]["filter"] = json!({"kind":"range","start":5,"end":5});
    body["scene"]["value"]["paintStyleBindings"] = json!([{
        "id":"image-choice","nodeId":"caption","selectorId":"words","style":{"paints":[image_layer]}
    }]);
    parse_style(&body).unwrap();
    let mut missing = body.clone();
    remove_capability(&mut missing, IMAGE_DISTANCE_CAPABILITY);
    assert_eq!(parse_style(&missing).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    body["scene"]["value"]["paintStyleBindings"][0]["style"]["paints"][0]["paint"]["phase"] =
        json!({"source":"cue-scalar-index","period":3,"arithmetic":"float32","indexOffset":0.000001});
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-image-phase-float32/1"));
    let parsed = parse_style(&body).unwrap();
    assert_eq!(parse_style(&serde_json::to_value(&parsed).unwrap()).unwrap(), parsed);
}
