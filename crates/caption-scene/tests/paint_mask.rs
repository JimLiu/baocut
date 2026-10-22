use caption_scene::*;
use serde_json::{Value, json};

fn fixture(mask: Option<Value>) -> Value {
    let mut body: Value = serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap();
    let scene = &mut body["scene"]["value"];
    scene["animations"] = json!([]);
    scene["requiredCapabilities"] = json!([
        "caption-scene/1",
        "caption-expressions/1",
        "caption-paint-stack/1",
        "caption-paint-effects/1",
        "caption-paint-mask/1"
    ]);
    let mut layer = json!({"id":"ink","paint":{"kind":"solid","color":"#FFFFFF80"}});
    if let Some(mask) = mask {
        layer["mask"] = mask;
    }
    scene["nodes"][0]["style"]["paints"] = json!([layer]);
    body
}

#[test]
fn glyph_mask_roundtrips_and_old_layers_omit_it() {
    let style = parse_style(&fixture(Some(json!({"kind":"glyph-fill"})))).unwrap();
    assert_eq!(
        style.scene().nodes[0].style.paints[0].mask,
        Some(PaintMask::GlyphFill {
            spread: 0.0,
            offset: [0.0, 0.0],
            inverted: false
        })
    );
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    let old = parse_style(&fixture(None)).unwrap();
    assert!(
        serde_json::to_value(old).unwrap()["scene"]["value"]["nodes"][0]["style"]["paints"][0]
            .get("mask")
            .is_none()
    );
}

#[test]
fn mask_frame_budget_is_shared_and_failed_reservation_does_not_consume_credit() {
    let mut budget = Budget::default();
    budget.reserve_paint_mask_work(128 * 1024 * 1024 - 1).unwrap();
    assert!(budget.reserve_paint_mask_work(2).is_err());
    budget.reserve_paint_mask_work(1).unwrap();
    assert_eq!(budget.reserve_paint_mask_work(1).unwrap_err().code, "CAPTION_BUDGET_EXCEEDED");
}

#[test]
fn glyph_mask_requires_capability_and_text_scope() {
    let mut body = fixture(Some(json!({"kind":"glyph-fill"})));
    body["scene"]["value"]["requiredCapabilities"].as_array_mut().unwrap().pop();
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    let mut body = fixture(Some(json!({"kind":"glyph-fill"})));
    body["scene"]["value"]["nodes"].as_array_mut().unwrap().push(json!({
        "id":"bad-scope","type":"group","style":{"paints":[{"id":"ink","paint":{"kind":"solid","color":"#FFFFFFFF"},"mask":{"kind":"glyph-fill"}}]}
    }));
    assert!(parse_style(&body).is_err());
}

#[test]
fn glyph_mask_rejects_invalid_objects_and_bounded_spread() {
    for mask in [
        json!(null),
        json!(false),
        json!("glyph-fill"),
        json!({}),
        json!({"kind":"node-union"}),
        json!({"kind":"glyph-fill","spread":-1}),
        json!({"kind":"glyph-fill","spread":257}),
        json!({"kind":"glyph-fill","spread":"1"}),
    ] {
        assert!(parse_style(&fixture(Some(mask.clone()))).is_err(), "{mask}");
    }
    let mut body = fixture(Some(json!({"kind":"glyph-fill","spread":4.01})));
    body["scene"]["value"]["nodes"][0]["style"]["paints"][0]["unit"] = json!("em");
    assert!(parse_style(&body).is_err());
    let mut scene = parse_style(&fixture(Some(json!({"kind":"glyph-fill"})))).unwrap().scene().clone();
    scene.nodes[0].style.paints[0].mask = Some(PaintMask::GlyphFill {
        spread: f64::NAN,
        offset: [0.0, 0.0],
        inverted: false,
    });
    assert!(validate_scene(&scene).is_err());
}

fn transformed_fixture(mask: Value) -> Value {
    let mut body = fixture(Some(mask));
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-mask-transform/1"));
    body
}

#[test]
fn mask_transform_defaults_preserve_old_serialized_fields() {
    let omitted = parse_style(&fixture(Some(json!({"kind":"glyph-fill"})))).unwrap();
    let explicit = parse_style(&fixture(Some(json!({"kind":"glyph-fill","offset":[0,0],"inverted":false})))).unwrap();
    assert_eq!(omitted, explicit);
    let encoded = serde_json::to_value(explicit).unwrap();
    let mask = &encoded["scene"]["value"]["nodes"][0]["style"]["paints"][0]["mask"];
    assert_eq!(mask, &json!({"kind":"glyph-fill"}));
}

#[test]
fn mask_offset_and_inversion_require_transform_and_base_capabilities() {
    for mask in [
        json!({"kind":"glyph-fill","offset":[1,0]}),
        json!({"kind":"glyph-fill","inverted":true}),
    ] {
        assert_eq!(
            parse_style(&fixture(Some(mask.clone()))).unwrap_err().code,
            "CAPTION_CAPABILITY_REQUIRED"
        );
        let body = transformed_fixture(mask);
        let parsed = parse_style(&body).unwrap();
        assert_eq!(parse_style(&serde_json::to_value(parsed.clone()).unwrap()).unwrap(), parsed);
        let mut missing_base = body;
        missing_base["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .retain(|cap| cap != "caption-paint-mask/1");
        assert_eq!(parse_style(&missing_base).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    }
}

#[test]
fn mask_offsets_obey_unit_bounds_and_strict_field_types() {
    for (unit, reach) in [("px", 4096.0), ("em", 16.0)] {
        for sign in [-1.0, 1.0] {
            let mut allowed = transformed_fixture(json!({"kind":"glyph-fill","offset":[sign*reach,-sign*reach]}));
            allowed["scene"]["value"]["nodes"][0]["style"]["paints"][0]["unit"] = json!(unit);
            parse_style(&allowed).unwrap();
            allowed["scene"]["value"]["nodes"][0]["style"]["paints"][0]["mask"]["offset"] = json!([sign * (reach + 0.01), 0]);
            assert!(parse_style(&allowed).is_err(), "unit={unit}, sign={sign}");
        }
    }
    for mask in [
        json!({"kind":"glyph-fill","offset":null}),
        json!({"kind":"glyph-fill","offset":[1]}),
        json!({"kind":"glyph-fill","offset":[1,2,3]}),
        json!({"kind":"glyph-fill","offset":["1",0]}),
        json!({"kind":"glyph-fill","inverted":null}),
        json!({"kind":"glyph-fill","inverted":"true"}),
        json!({"kind":"glyph-fill","inverted":1}),
    ] {
        assert!(parse_style(&transformed_fixture(mask.clone())).is_err(), "{mask}");
    }
    let mut scene = parse_style(&transformed_fixture(json!({"kind":"glyph-fill"})))
        .unwrap()
        .scene()
        .clone();
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        scene.nodes[0].style.paints[0].mask = Some(PaintMask::GlyphFill {
            spread: 0.,
            offset: [value, 0.],
            inverted: false,
        });
        assert!(validate_scene(&scene).is_err());
    }
}
