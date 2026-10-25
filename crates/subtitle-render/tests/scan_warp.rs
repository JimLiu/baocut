use caption_scene::{Presentation, parse_style};
use render_raster::TextEngine;
use serde_json::{Value, json};
use subtitle_render::scene::{SceneCue, ScenePlan};

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/scan-warp.json"
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
        "scan-warp".into(),
    )
    .unwrap()
}

fn constant(value: f64) -> Value {
    json!({"kind": "constant", "value": value})
}

/// The material with every effect switched off: a pure copy of the domain.
fn neutral(mut body: Value) -> Value {
    let m = &mut body["scene"]["value"]["materials"][0];
    m["warp"]["strength"] = json!([constant(0.0), constant(0.0)]);
    m["stripe"]["amount"] = constant(0.0);
    m["scanlines"]["amount"] = constant(0.0);
    body
}

#[test]
fn scan_warp_is_seekable_animated_and_neutral_uniforms_are_identity() {
    let body = fixture();
    let mut scene = plan(body.clone());
    let first = scene.render(0.25).unwrap().rgba;
    let later = scene.render(3.0).unwrap().rgba;
    assert!(first.chunks_exact(4).any(|p| p[3] > 0));
    assert_ne!(
        first, later,
        "noise offset, stripe and phase move over the page"
    );
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
    assert_eq!(plan(neutral(body)).render(0.25).unwrap().rgba, plain);
}

#[test]
fn scan_warp_gain_scales_the_rendered_color() {
    let mut dim = neutral(fixture());
    dim["scene"]["value"]["materials"][0]["gain"] = constant(0.5);
    let dim = plan(dim).render(0.25).unwrap().rgba;
    let mut plain = fixture();
    plain["scene"]["value"]["materials"] = json!([]);
    let plain = plan(plain).render(0.25).unwrap().rgba;
    let sum = |rgba: &[u8]| {
        rgba.chunks_exact(4)
            .map(|p| u64::from(p[0]) + u64::from(p[1]) + u64::from(p[2]))
            .sum::<u64>()
    };
    assert!(sum(&dim) * 10 < sum(&plain) * 6 && sum(&dim) * 10 > sum(&plain) * 4);
    assert_eq!(
        dim.chunks_exact(4).map(|p| p[3]).collect::<Vec<_>>(),
        plain.chunks_exact(4).map(|p| p[3]).collect::<Vec<_>>()
    );
}

#[test]
fn scan_warp_is_cpu_only_and_checks_dynamic_ranges() {
    let error = plan(fixture())
        .record_material_plan(0.25)
        .err()
        .expect("GPU material plan must reject scan-warp");
    assert!(
        error
            .to_string()
            .contains("CAPTION_MATERIAL_PLAN_UNSUPPORTED: material glitch-scan"),
        "{error}"
    );
    let literal = |value: f64| {
        json!({"kind": "expression",
            "expression": {"op": "literal", "type": "scalar", "value": value}})
    };
    let cases: Vec<(&str, Box<dyn Fn(&mut Value)>)> = vec![
        ("gain", Box::new(|m| m["gain"] = literal(4.5))),
        ("amount", Box::new(|m| m["stripe"]["amount"] = literal(1.5))),
        (
            "strength",
            Box::new(|m| m["warp"]["strength"][1] = literal(5.0)),
        ),
        (
            "phase",
            Box::new(|m| m["scanlines"]["phase"] = literal(2_000_000.0)),
        ),
        (
            "evolution",
            Box::new(|m| m["warp"]["evolution"] = literal(-100_001.0)),
        ),
    ];
    for (name, edit) in cases {
        let mut body = fixture();
        edit(&mut body["scene"]["value"]["materials"][0]);
        let error = plan(body)
            .render(0.25)
            .err()
            .expect("invalid uniform must fail");
        assert!(
            error.to_string().contains("CAPTION_MATERIAL_INVALID"),
            "{name}: {error}"
        );
    }
}
