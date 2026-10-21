use caption_scene::*;
use render_raster::TextEngine;
use serde_json::{Value, json};
use subtitle_render::scene::*;

fn plan(body: Value, words: Vec<SceneWord>) -> ScenePlan {
    ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "One two three".into(),
            start: 0.0,
            end: 4.0,
            words,
        }],
        (160, 90),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "caption|occurrence".into(),
    )
    .unwrap()
}

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/speech-phase.json"
    ))
    .unwrap()
}

fn timed() -> Vec<SceneWord> {
    [("One", 0.5, 1.2), ("two", 1.0, 1.8), ("three", 2.0, 3.0)]
        .iter()
        .enumerate()
        .map(|(i, (text, start, end))| SceneWord {
            id: format!("w{i}"),
            text: (*text).into(),
            start: *start,
            end: *end,
        })
        .collect()
}

#[test]
fn speech_phase_changes_pixels_only_through_declared_reads() {
    let mut phase = plan(fixture(), timed());
    assert!(phase.diagnostics.is_empty());
    let before = phase.render(0.2).unwrap().rgba;
    let reading_gap = phase.render(1.9).unwrap().rgba;
    let after = phase.render(3.5).unwrap().rgba;
    assert!(before.chunks_exact(4).any(|p| p[3] > 0));
    assert_ne!(before, after, "before-first and after-last dim differently");
    assert_ne!(before, reading_gap);
    assert_eq!(
        phase.render(0.2).unwrap().rgba,
        before,
        "seek repeats pixels"
    );
    // Same scene without the phase reads renders as the word-pop base.
    let mut base = fixture();
    let scene = &mut base["scene"]["value"];
    scene["animations"].as_array_mut().unwrap().truncate(2);
    let caps = scene["requiredCapabilities"].as_array_mut().unwrap();
    caps.retain(|c| c != "caption-speech-phase/1");
    let mut old = plan(base, timed());
    let reading = phase.render(1.9).unwrap().rgba;
    assert_eq!(
        old.render(1.9).unwrap().rgba,
        reading,
        "reading in a gap with no word in span is neutral"
    );
}

#[test]
fn missing_word_timing_reports_unavailable_or_estimated_by_policy() {
    let required = plan(fixture(), vec![]);
    assert!(
        required
            .diagnostics
            .iter()
            .any(|d| d.code == "CAPTION_TIMING_UNAVAILABLE")
    );
    let mut estimated = fixture();
    estimated["scene"]["value"]["speechState"]["timingPolicy"] = json!("estimated");
    let estimated = plan(estimated, vec![]);
    assert!(
        !estimated
            .diagnostics
            .iter()
            .any(|d| d.code == "CAPTION_TIMING_UNAVAILABLE")
    );
}
