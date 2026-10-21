use caption_scene::*;
use render_raster::TextEngine;
use serde_json::Value;
use subtitle_render::scene::*;

fn plan(body: Value) -> ScenePlan {
    let words = ["One", "two", "three", "four"]
        .iter()
        .enumerate()
        .map(|(i, t)| SceneWord {
            id: format!("w{i}"),
            text: (*t).into(),
            start: i as f64,
            end: i as f64 + 0.7,
        })
        .collect();
    ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "One two three four".into(),
            start: 0.0,
            end: 6.0,
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
        "../../caption-scene/tests/fixtures/clock-tail.json"
    ))
    .unwrap()
}

#[test]
fn repeat_tail_renders_periodic_frames_and_differs_from_unbounded_clock() {
    let mut repeating = plan(fixture());
    // All words are past their pop by 4 s; only the 0.5 s cue pulse varies.
    let frames = [4.0, 4.5, 5.0, 4.25, 4.0].map(|t| repeating.render(t).unwrap().rgba);
    assert!(frames[0].chunks_exact(4).any(|p| p[3] > 0));
    assert_eq!(frames[0], frames[1], "a period end starts the next period");
    assert_eq!(frames[0], frames[2]);
    assert_eq!(frames[0], frames[4], "seek repeats the same pixels");
    assert_ne!(frames[0], frames[3]);
    // Without the tail the pulse finishes once and holds its last key.
    let mut body = fixture();
    let pulse = &mut body["scene"]["value"]["animations"][2]["value"]["clock"];
    pulse.as_object_mut().unwrap().remove("tail");
    let mut once = plan(body);
    assert_eq!(once.render(4.25).unwrap().rgba, frames[0]);
}
