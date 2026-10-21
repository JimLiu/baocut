use caption_scene::{Presentation, parse_style};
use render_raster::TextEngine;
use serde_json::{Value, json};
use subtitle_render::scene::{SceneCue, ScenePlan};

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/noise-displace.json"
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
        "noise-displace".into(),
    )
    .unwrap()
}

#[test]
fn noise_displacement_is_seekable_animated_and_zero_strength_is_identity() {
    let body = fixture();
    let mut scene = plan(body.clone());
    let first = scene.render(0.25).unwrap().rgba;
    let later = scene.render(3.0).unwrap().rgba;
    assert!(first.chunks_exact(4).any(|p| p[3] > 0));
    assert_ne!(first, later, "phase changes the noise field");
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
    let mut zero = body;
    zero["scene"]["value"]["materials"][0]["strength"] = json!({"kind": "constant", "value": 0});
    assert_eq!(plan(zero).render(0.25).unwrap().rgba, plain);
}

#[test]
fn noise_displacement_is_cpu_only_and_checks_dynamic_ranges() {
    let error = plan(fixture())
        .record_material_plan(0.25)
        .err()
        .expect("GPU material plan must reject noise-displace");
    assert!(
        error
            .to_string()
            .contains("CAPTION_MATERIAL_PLAN_UNSUPPORTED: material heat-shimmer"),
        "{error}"
    );
    for (field, value) in [
        ("contrast", -0.5),
        ("strength", 17.0),
        ("brightness", -17.0),
    ] {
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
}
