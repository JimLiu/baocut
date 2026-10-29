use caption_scene::{Presentation, parse_style};
use render_raster::TextEngine;
use serde_json::{Value, json};
use subtitle_render::scene::{SceneCue, ScenePlan};

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/gradient-noise-displace.json"
    ))
    .unwrap()
}

fn plan(body: Value) -> ScenePlan {
    ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "Heat".into(),
            start: 0.0,
            end: 4.0,
            words: vec![],
        }],
        (160, 90),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "gradient-noise-displace".into(),
    )
    .unwrap()
}

fn with(body: &Value, edit: impl FnOnce(&mut Value)) -> Value {
    let mut body = body.clone();
    edit(&mut body["scene"]["value"]["materials"][0]);
    body
}

fn constant(value: f64) -> Value {
    json!({"kind": "constant", "value": value})
}

fn loud(body: &Value) -> Value {
    // The template-sized uniforms move content by a fraction of a pixel at this canvas size.
    with(body, |m| {
        m["contrast"] = constant(2.0);
        m["range"] = constant(1.0);
    })
}

#[test]
fn gradient_noise_displacement_is_seekable_animated_and_neutral_uniforms_are_identity() {
    let body = loud(&fixture());
    let mut scene = plan(body.clone());
    let first = scene.render(0.25).unwrap().rgba;
    let later = scene.render(3.0).unwrap().rgba;
    assert!(first.chunks_exact(4).any(|p| p[3] > 0));
    assert_ne!(first, later, "the page clock moves the noise offset");
    for t in [3.0, 0.25] {
        assert_eq!(
            scene.render(t).unwrap().rgba,
            plan(body.clone()).render(t).unwrap().rgba
        );
    }
    let mut plain = body.clone();
    plain["scene"]["value"]["materials"] = json!([]);
    let plain = plan(plain).render(0.25).unwrap().rgba;
    assert_ne!(first, plain);
    for (field, value) in [("contrast", 0.0), ("range", 0.0)] {
        let neutral = with(&body, |m| m[field] = constant(value));
        assert_eq!(plan(neutral).render(0.25).unwrap().rgba, plain, "{field}");
    }
}

#[test]
fn gradient_noise_displacement_is_cpu_only_and_checks_dynamic_ranges() {
    let error = plan(fixture())
        .record_material_plan(0.25)
        .err()
        .expect("GPU material plan must reject gradient-noise-displace");
    assert!(
        error
            .to_string()
            .contains("CAPTION_MATERIAL_PLAN_UNSUPPORTED: material ripple"),
        "{error}"
    );
    for (field, value) in [("contrast", -0.5), ("range", 17.0), ("brightness", -17.0)] {
        let mut body = fixture();
        body["scene"]["value"]["materials"][0][field] = json!({"kind": "expression",
            "expression": {"op": "literal", "type": "scalar", "value": value}});
        let error = plan(body)
            .render(0.25)
            .err()
            .expect("invalid uniform must fail");
        assert!(
            error.to_string().contains("CAPTION_MATERIAL_INVALID"),
            "{field}: {error}"
        );
    }
    let mut body = fixture();
    body["scene"]["value"]["materials"][0]["field"]["scale"] = json!({"kind": "expression",
        "expression": {"op": "literal", "type": "scalar", "value": 0.0}});
    let error = plan(body).render(0.25).err().expect("zero scale must fail");
    assert!(
        error.to_string().contains("CAPTION_MATERIAL_INVALID"),
        "{error}"
    );
}
