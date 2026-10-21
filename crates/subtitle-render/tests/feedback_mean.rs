use caption_scene::{Presentation, parse_style};
use render_raster::TextEngine;
use serde_json::{Value, json};
use subtitle_render::scene::{SceneCue, ScenePlan};

const WIDTH: usize = 160;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/feedback-mean.json"
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
        (WIDTH as u32, 90),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "feedback-mean".into(),
    )
    .unwrap()
}

/// Independent reference: the static plain frame shifted by `i * 2px` for
/// each in-cue sample, averaged per premultiplied byte with round-half-up.
fn expected_mean(plain: &[u8], count: usize) -> Vec<u8> {
    let mut out = vec![0u8; plain.len()];
    for (index, byte) in out.iter_mut().enumerate() {
        let (pixel, channel) = (index / 4, index % 4);
        let (x, y) = (pixel % WIDTH, pixel / WIDTH);
        let sum: usize = (0..count)
            .filter(|i| x >= 2 * i)
            .map(|i| usize::from(plain[(y * WIDTH + x - 2 * i) * 4 + channel]))
            .sum();
        *byte = ((sum + count / 2) / count) as u8;
    }
    out
}

#[test]
fn feedback_mean_averages_in_cue_samples_with_equal_weight() {
    let body = fixture();
    let mut plain = body.clone();
    plain["scene"]["value"]["materials"] = json!([]);
    let plain = plan(plain).render(1.0).unwrap().rgba.to_vec();
    assert!(plain.chunks_exact(4).any(|p| p[3] > 0));
    let mut scene = plan(body.clone());
    // 1.0s: all 11 samples lie inside the cue.
    let full = scene.render(1.0).unwrap().rgba.to_vec();
    assert_eq!(full, expected_mean(&plain, 11));
    // 0.05s: samples at 0.05, 0.025 and 0.0 are inside; earlier ones are skipped
    // and do not count toward the divisor.
    let start = scene.render(0.05).unwrap().rgba.to_vec();
    assert_eq!(start, expected_mean(&plain, 3));
    assert_eq!(plan(body).render(1.0).unwrap().rgba.to_vec(), full);
}

#[test]
fn feedback_mean_is_cpu_only() {
    let error = plan(fixture())
        .record_material_plan(1.0)
        .err()
        .expect("GPU material plan must reject feedback");
    assert!(
        error
            .to_string()
            .contains("CAPTION_MATERIAL_PLAN_UNSUPPORTED: material motion-mean"),
        "{error}"
    );
}
