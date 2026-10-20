use caption_scene::*;
use serde_json::{Value, json};

fn image() -> Value {
    json!({"kind":"image","resourceId":"texture","uvTransform":[1,0,0,1,0,0],"space":"glyph-em"})
}
fn resources() -> Value {
    json!([{"id":"texture","assetRef":{"id":"image-asset","revision":"1"},"contentHash":format!("sha256:{}", "0".repeat(64))}])
}
fn body(paint: Value) -> Value {
    let mut value: Value = serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap();
    let scene = &mut value["scene"]["value"];
    scene["animations"] = json!([]);
    scene["resources"] = resources();
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-image-paint/1"));
    scene["nodes"][0]["style"]["paints"] = json!([{"id":"texture","paint":paint}]);
    value
}
fn paint(value: &mut Value) -> &mut Value {
    &mut value["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]
}

#[test]
fn image_paint_defaults_and_explicit_spaces_are_roundtrippable() {
    for space in ["glyph-em", "glyph-normalized", "line-normalized", "page-normalized"] {
        let mut declaration = image();
        declaration["space"] = json!(space);
        let parsed = parse_style(&body(declaration)).unwrap();
        assert!(matches!(
            &parsed.scene().nodes[0].style.paints[0].paint,
            ScenePaint::Image {
                wrap: ImagePaintWrap::Clamp,
                filter: ImagePaintFilter::Bilinear,
                opacity: 1.0,
                composite_opacity: 1.0,
                base: None,
                phase: None,
                phase_offset: 0.0,
                glyph_outset: 0.0,
                ..
            }
        ));
        let serialized = serde_json::to_value(&parsed).unwrap();
        assert_eq!(parse_style(&serialized).unwrap(), parsed);
        let declaration = &serialized["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"];
        for field in [
            "wrap",
            "filter",
            "opacity",
            "compositeOpacity",
            "base",
            "phase",
            "phaseOffset",
            "glyphOutset",
        ] {
            assert!(declaration.get(field).is_none(), "{field}");
        }
        assert_eq!(declaration["space"], json!(space));
        assert_eq!(declaration["uvTransform"], json!([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]));
    }
    let mut explicit = image();
    explicit["wrap"] = json!("mirror");
    explicit["filter"] = json!("nearest");
    explicit["opacity"] = json!(0.25);
    explicit["phase"] = json!({"period":4096,"source":"cue-scalar-index"});
    explicit["phaseOffset"] = json!(1);
    let parsed = parse_style(&body(explicit)).unwrap();
    assert_eq!(parse_style(&serde_json::to_value(&parsed).unwrap()).unwrap(), parsed);
}

#[test]
fn float32_image_phase_is_explicit_bounded_and_capability_gated() {
    let mut declaration = image();
    declaration["phase"] = json!({"period":3,"source":"cue-scalar-index","arithmetic":"float32","indexOffset":1e-6});
    let mut value = body(declaration);
    assert_eq!(parse_style(&value).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    value["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-image-phase-float32/1"));
    let parsed = parse_style(&value).unwrap();
    assert_eq!(parse_style(&serde_json::to_value(&parsed).unwrap()).unwrap(), parsed);
    for phase in [
        json!({"period":3,"source":"cue-scalar-index","indexOffset":1}),
        json!({"period":3,"source":"cue-scalar-index","arithmetic":"float32","indexOffset":131073}),
        json!({"period":3,"source":"cue-scalar-index","arithmetic":null}),
        json!({"period":3,"source":"cue-scalar-index","arithmetic":"float32","indexOffset":null}),
        json!({"period":3,"source":"cue-scalar-index","arithmetic":"double"}),
    ] {
        paint(&mut value)["phase"] = phase;
        assert!(parse_style(&value).is_err());
    }
    let old: ImagePaintPhase = serde_json::from_value(json!({"period":3,"source":"cue-scalar-index"})).unwrap();
    assert_eq!(old.arithmetic, ImagePhaseArithmetic::IntegerModulo);
    assert_eq!(serde_json::to_value(old).unwrap(), json!({"period":3,"source":"cue-scalar-index"}));
}

#[test]
fn image_paint_rejects_missing_required_fields_capability_resources_and_nontext_scope() {
    let mut value = body(image());
    value["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|cap| cap != "caption-image-paint/1");
    assert_eq!(parse_style(&value).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    for field in ["resourceId", "uvTransform", "space"] {
        let mut declaration = image();
        declaration.as_object_mut().unwrap().remove(field);
        assert!(parse_style(&body(declaration)).is_err(), "missing {field}");
    }
    let mut value = body(image());
    paint(&mut value)["resourceId"] = json!("unregistered");
    assert!(parse_style(&value).is_err());
    value["scene"]["value"]["resources"] = json!([]);
    assert!(parse_style(&value).is_err());
    for kind in ["shape", "group", "image", "repeat"] {
        let mut value = body(image());
        value["scene"]["value"]["nodes"][0]["type"] = json!(kind);
        assert!(parse_style(&value).is_err(), "{kind}");
    }
    let mut label: Value = serde_json::from_str(include_str!("fixtures/bound-label.json")).unwrap();
    label["scene"]["value"]["resources"] = resources();
    label["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-image-paint/1"));
    label["scene"]["value"]["nodes"][1]["children"][0]["style"]["paints"] = json!([{"id":"texture","paint":image()}]);
    assert!(parse_style(&label).is_ok());
}

#[test]
fn image_paint_rejects_unknowns_null_enums_matrix_and_phase_bounds() {
    for (field, bad) in [
        ("extra", json!(true)),
        ("resourceId", Value::Null),
        ("uvTransform", Value::Null),
        ("space", Value::Null),
        ("space", json!("device")),
        ("wrap", Value::Null),
        ("wrap", json!("border")),
        ("filter", Value::Null),
        ("filter", json!("bicubic")),
        ("base", Value::Null),
        ("phase", Value::Null),
        ("opacity", Value::Null),
        ("opacity", json!(-0.01)),
        ("opacity", json!(1.01)),
        ("compositeOpacity", Value::Null),
        ("compositeOpacity", json!(-0.01)),
        ("compositeOpacity", json!(1.01)),
        ("compositeOpacity", json!("0.5")),
        ("compositeOpacity", json!(true)),
        ("phaseOffset", Value::Null),
        ("phaseOffset", json!(-0.01)),
        ("phaseOffset", json!(1.01)),
        ("uvTransform", json!([1, 0, 0, 1, 0])),
        ("uvTransform", json!([1, 0, 0, 0, 0, 0])),
        ("uvTransform", json!([1, 1, 1, 1.0000000000001, 0, 0])),
        ("uvTransform", json!([4097, 0, 0, 1, 0, 0])),
        ("phase", json!({"period":0,"source":"cue-scalar-index"})),
        ("phase", json!({"period":4097,"source":"cue-scalar-index"})),
        ("phase", json!({"period":1.5,"source":"cue-scalar-index"})),
        ("phase", json!({"period":1,"source":"glyph-index"})),
        ("phase", json!({"period":1,"source":null})),
        ("phase", json!({"period":1,"source":"cue-scalar-index","extra":true})),
    ] {
        let mut value = body(image());
        paint(&mut value)[field] = bad;
        assert!(parse_style(&value).is_err(), "{field}: {}", paint(&mut value));
    }
    let mut value = body(image());
    value["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-coverage/1"));
    value["scene"]["value"]["nodes"][0]["style"]["paints"][0]["coverage"] = json!({"lo":0,"hi":1});
    assert!(parse_style(&value).is_err());

    let mut scene = parse_style(&body(image())).unwrap().scene().clone();
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        if let ScenePaint::Image { uv_transform, .. } = &mut scene.nodes[0].style.paints[0].paint {
            uv_transform[0] = bad;
        }
        assert!(validate_scene(&scene).is_err());
        if let ScenePaint::Image { uv_transform, opacity, .. } = &mut scene.nodes[0].style.paints[0].paint {
            uv_transform[0] = 1.;
            *opacity = bad;
        }
        assert!(validate_scene(&scene).is_err());
        if let ScenePaint::Image { opacity, phase_offset, .. } = &mut scene.nodes[0].style.paints[0].paint {
            *opacity = 1.;
            *phase_offset = bad;
        }
        assert!(validate_scene(&scene).is_err());
        if let ScenePaint::Image { phase_offset, .. } = &mut scene.nodes[0].style.paints[0].paint {
            *phase_offset = 0.;
        }
    }
}

#[test]
fn image_base_is_one_color_paint_and_node_fill_keeps_override_rules() {
    let mut value = body(image());
    paint(&mut value)["base"] = image();
    assert!(parse_style(&value).is_err());
    paint(&mut value)["base"] = json!({"kind":"solid","color":"invalid"});
    assert!(parse_style(&value).is_err());
    paint(&mut value)["base"] = json!({"kind":"solid","color":"#11223380"});
    assert!(parse_style(&value).is_ok());
    let linear = json!({"kind":"linear","from":[0,0],"to":[1,1],"space":"normalized","domain":"page",
        "stops":[{"at":0,"color":"#FF000080"},{"at":1,"color":"#0000FF40"}]});
    paint(&mut value)["base"] = linear;
    assert_eq!(parse_style(&value).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    value["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([json!("caption-gradient-space/1"), json!("caption-paint-effects/1")]);
    value["scene"]["value"]["nodes"][0]["style"]["paints"][0]["spread"] = json!(1);
    value["scene"]["value"]["nodes"][0]["style"]["paints"][0]["blur"] = json!(2);
    assert!(
        parse_style(&value).is_ok(),
        "one sampled bitmap supports translucent base after spread/blur"
    );
    paint(&mut value)["base"]["stops"][1]["at"] = json!(0);
    assert!(parse_style(&value).is_err());

    let mut value = body(image());
    value["scene"]["value"]["animations"] =
        serde_json::from_str::<Value>(include_str!("fixtures/word-pop.json")).unwrap()["scene"]["value"]["animations"].clone();
    assert!(parse_style(&value).is_err(), "no fill target without node-fill base");
    paint(&mut value)["base"] = json!({"kind":"node-fill"});
    assert_eq!(parse_style(&value).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    value["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-effects/1"));
    assert!(parse_style(&value).is_ok());
    value["scene"]["value"]["nodes"][0]["style"]["stroke"] = json!({"width":1,"color":"#FFFFFF"});
    assert!(parse_style(&value).is_err(), "legacy stroke remains exclusive");
}

#[test]
fn image_composite_opacity_is_independent_and_default_serialization_stays_unchanged() {
    let absent = parse_style(&body(image())).unwrap();
    let absent_bytes = serde_json::to_vec(&absent).unwrap();
    let absent_json = serde_json::to_value(&absent).unwrap();
    let declaration = &absent_json["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"];
    assert_eq!(
        declaration,
        &json!({"kind":"image","resourceId":"texture","uvTransform":[1.0,0.0,0.0,1.0,0.0,0.0],"space":"glyph-em"}),
        "omission must retain the exact legacy paint schema"
    );
    let mut explicit_default = image();
    explicit_default["compositeOpacity"] = json!(1);
    assert_eq!(
        serde_json::to_vec(&parse_style(&body(explicit_default)).unwrap()).unwrap(),
        absent_bytes
    );

    for composite in [0.0, 0.5, 1.0] {
        for texture in [0.0, 0.25, 1.0] {
            let mut declaration = image();
            declaration["opacity"] = json!(texture);
            declaration["compositeOpacity"] = json!(composite);
            declaration["base"] = json!({"kind":"solid","color":"#11223380"});
            let parsed = parse_style(&body(declaration)).unwrap();
            let ScenePaint::Image {
                opacity,
                composite_opacity,
                base: Some(base),
                ..
            } = &parsed.scene().nodes[0].style.paints[0].paint
            else {
                panic!("image and its base must remain declared paints");
            };
            assert_eq!((*opacity, *composite_opacity), (texture, composite));
            assert!(
                matches!(base.as_ref(), ScenePaint::Solid { color } if color == "#11223380"),
                "neither opacity may be folded into the base color"
            );
            let serialized = serde_json::to_value(&parsed).unwrap();
            let paint = &serialized["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"];
            if composite == 1.0 {
                assert!(paint.get("compositeOpacity").is_none());
            } else {
                assert_eq!(paint["compositeOpacity"], json!(composite));
            }
            if texture == 1.0 {
                assert!(paint.get("opacity").is_none());
            } else {
                assert_eq!(paint["opacity"], json!(texture));
            }
            assert_eq!(parse_style(&serialized).unwrap(), parsed);
        }
    }
}

#[test]
fn image_composite_opacity_rejects_nonfinite_values_in_programmatic_scenes() {
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut scene = parse_style(&body(image())).unwrap().scene().clone();
        let ScenePaint::Image { composite_opacity, .. } = &mut scene.nodes[0].style.paints[0].paint else {
            unreachable!()
        };
        *composite_opacity = bad;
        assert_eq!(validate_scene(&scene).unwrap_err().code, "CAPTION_SCENE_INVALID");
    }
}

#[test]
fn image_glyph_outset_zero_keeps_the_exact_legacy_schema_in_every_space() {
    for space in ["glyph-em", "glyph-normalized", "line-normalized", "page-normalized"] {
        let mut absent = image();
        absent["space"] = json!(space);
        let old = parse_style(&body(absent.clone())).unwrap();
        absent["glyphOutset"] = json!(0);
        let explicit_zero = parse_style(&body(absent)).unwrap();
        assert_eq!(explicit_zero, old, "{space} must not require the new capability");
        assert_eq!(
            serde_json::to_vec(&explicit_zero).unwrap(),
            serde_json::to_vec(&old).unwrap(),
            "{space} zero must not change serialized legacy scenes"
        );
        let serialized = serde_json::to_value(explicit_zero).unwrap();
        assert!(
            serialized["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]
                .get("glyphOutset")
                .is_none()
        );
    }
}

#[test]
fn image_glyph_outset_is_capability_gated_and_roundtrips_font_em_bounds() {
    for outset in [0.000001, 0.4, 4.0] {
        let mut declaration = image();
        declaration["space"] = json!("glyph-normalized");
        declaration["glyphOutset"] = json!(outset);
        let mut value = body(declaration);
        assert_eq!(parse_style(&value).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
        value["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-image-glyph-outset/1"));
        let parsed = parse_style(&value).unwrap();
        let ScenePaint::Image { glyph_outset, space, .. } = &parsed.scene().nodes[0].style.paints[0].paint else {
            unreachable!()
        };
        assert_eq!(*glyph_outset, outset);
        assert_eq!(*space, ImagePaintSpace::GlyphNormalized);
        let serialized = serde_json::to_value(&parsed).unwrap();
        assert_eq!(
            serialized["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["glyphOutset"],
            json!(outset)
        );
        assert_eq!(parse_style(&serialized).unwrap(), parsed);
    }
}

#[test]
fn image_glyph_outset_rejects_wrong_spaces_bad_types_range_and_nonfinite_values() {
    let mut declaration = image();
    declaration["space"] = json!("glyph-normalized");
    declaration["glyphOutset"] = json!(0.4);
    let mut valid = body(declaration);
    valid["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-image-glyph-outset/1"));
    for space in ["glyph-em", "line-normalized", "page-normalized"] {
        let mut bad = valid.clone();
        paint(&mut bad)["space"] = json!(space);
        assert_eq!(parse_style(&bad).unwrap_err().code, "CAPTION_SCENE_INVALID", "{space}");
    }
    for bad_outset in [json!(-0.000001), json!(4.000001), Value::Null, json!("0.4"), json!(true)] {
        let mut bad = valid.clone();
        paint(&mut bad)["glyphOutset"] = bad_outset.clone();
        assert!(parse_style(&bad).is_err(), "{bad_outset}");
    }
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut scene = parse_style(&valid).unwrap().scene().clone();
        let ScenePaint::Image { glyph_outset, .. } = &mut scene.nodes[0].style.paints[0].paint else {
            unreachable!()
        };
        *glyph_outset = bad;
        assert_eq!(validate_scene(&scene).unwrap_err().code, "CAPTION_SCENE_INVALID");
    }
}

#[test]
fn inactive_replacement_image_stack_still_validates_outset_and_capability() {
    let mut value = body(image());
    let scene = &mut value["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-style-bindings/1"));
    scene["selectors"][0]["filter"] = json!({"kind":"range","start":5,"end":5});
    scene["paintStyleBindings"] = json!([{
        "id":"replacement","nodeId":"caption","selectorId":"words",
        "style":{"paints":[{"id":"replacement-texture","paint":{
            "kind":"image","resourceId":"texture","uvTransform":[1,0,0,1,0,0],
            "space":"glyph-normalized","glyphOutset":0.4
        }}]}
    }]);
    assert_eq!(parse_style(&value).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    value["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-image-glyph-outset/1"));
    assert!(parse_style(&value).is_ok(), "declared unselected stacks must be valid");
    for (key, bad) in [("space", json!("page-normalized")), ("glyphOutset", json!(4.01))] {
        let mut invalid = value.clone();
        invalid["scene"]["value"]["paintStyleBindings"][0]["style"]["paints"][0]["paint"][key] = bad;
        assert_eq!(parse_style(&invalid).unwrap_err().code, "CAPTION_SCENE_INVALID");
    }
}

#[test]
fn distance_image_and_glyph_outset_capabilities_are_independent() {
    let mut declaration = image();
    declaration["space"] = json!("glyph-normalized");
    declaration["glyphOutset"] = json!(0.4);
    let mut value = body(declaration);
    value["scene"]["value"]["nodes"][0]["style"]["paints"][0]["distanceCoverage"] = json!({
        "source":"glyph-contours",
        "bands":[{"offset":[2,-1],"threshold":0,"halfWidth":0.5}],
        "aa":{"kind":"quad-derivative","sourceBand":0,"scale":0.5},
        "combine":"multiply","zeroWidth":"step-inclusive"
    });
    value["scene"]["value"]["requiredCapabilities"].as_array_mut().unwrap().extend([
        json!("caption-glyph-distance-coverage/1"),
        json!("caption-image-distance-coverage/1"),
        json!("caption-image-glyph-outset/1"),
    ]);
    assert!(parse_style(&value).is_ok());
    for missing in [
        "caption-glyph-distance-coverage/1",
        "caption-image-distance-coverage/1",
        "caption-image-glyph-outset/1",
    ] {
        let mut bad = value.clone();
        bad["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .retain(|cap| cap != missing);
        assert_eq!(parse_style(&bad).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED", "{missing}");
    }
}
