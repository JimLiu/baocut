use caption_scene::{Presentation, parse_style};
use render_raster::TextEngine;
use serde_json::{Value, json};
use subtitle_render::scene::{SceneCue, ScenePlan};

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/radial-warp.json"
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
        "radial-warp".into(),
    )
    .unwrap()
}

fn constant(value: f64) -> Value {
    json!({"kind": "constant", "value": value})
}

fn plain() -> Vec<u8> {
    let mut body = fixture();
    body["scene"]["value"]["materials"] = json!([]);
    plan(body).render(0.25).unwrap().rgba.to_vec()
}

/// The material with the radial term and the offset switched off: a pure copy of the domain.
fn neutral(mut body: Value) -> Value {
    let m = &mut body["scene"]["value"]["materials"][0];
    m["strength"] = constant(0.0);
    m["shift"] = json!([constant(0.0), constant(0.0)]);
    body
}

fn ink_rows(rgba: &[u8], width: usize) -> (usize, usize) {
    let rows: Vec<usize> = rgba
        .chunks_exact(4)
        .enumerate()
        .filter(|(_, p)| p[3] > 0)
        .map(|(i, _)| i / width)
        .collect();
    (*rows.iter().min().unwrap(), *rows.iter().max().unwrap())
}

#[test]
fn radial_warp_is_seekable_animated_and_neutral_uniforms_are_identity() {
    let body = fixture();
    let mut scene = plan(body.clone());
    let first = scene.render(0.25).unwrap().rgba;
    let later = scene.render(3.0).unwrap().rgba;
    assert!(first.chunks_exact(4).any(|p| p[3] > 0));
    assert_ne!(first, later, "the offset moves over the page");
    for t in [3.0, 0.25] {
        assert_eq!(
            scene.render(t).unwrap().rgba,
            plan(body.clone()).render(t).unwrap().rgba
        );
    }
    let plain = plain();
    assert_ne!(*first, plain);
    assert_eq!(
        plan(neutral(body)).render(0.25).unwrap().rgba.to_vec(),
        plain
    );
}

#[test]
fn radial_warp_offset_moves_the_ink_vertically() {
    let mut low = neutral(fixture());
    low["scene"]["value"]["materials"][0]["shift"] = json!([constant(0.0), constant(0.1)]);
    let mut high = neutral(fixture());
    high["scene"]["value"]["materials"][0]["shift"] = json!([constant(0.0), constant(-0.1)]);
    let (low, high) = (
        plan(low).render(0.25).unwrap().rgba,
        plan(high).render(0.25).unwrap().rgba,
    );
    let (top_low, _) = ink_rows(&low, 160);
    let (top_high, _) = ink_rows(&high, 160);
    assert!(
        top_low < top_high,
        "a positive offset samples lower rows, so the ink rises"
    );
}

#[test]
fn radial_warp_is_cpu_only_and_checks_dynamic_ranges() {
    let error = plan(fixture())
        .record_material_plan(0.25)
        .err()
        .expect("GPU material plan must reject radial-warp");
    assert!(
        error
            .to_string()
            .contains("CAPTION_MATERIAL_PLAN_UNSUPPORTED: material lens"),
        "{error}"
    );
    let literal = |value: f64| {
        json!({"kind": "expression",
            "expression": {"op": "literal", "type": "scalar", "value": value}})
    };
    let cases: Vec<(&str, Box<dyn Fn(&mut Value)>)> = vec![
        ("strength", Box::new(|m| m["strength"] = literal(4.5))),
        ("shift", Box::new(|m| m["shift"][1] = literal(-5.0))),
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
