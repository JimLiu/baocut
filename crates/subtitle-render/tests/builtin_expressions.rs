use caption_scene::*;
use render_raster::TextEngine;
use serde_json::{Value, json};
use subtitle_render::scene::*;

fn plan(presentation: Presentation) -> ScenePlan {
    let body: Value = serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/builtin-expressions.json"
    ))
    .unwrap();
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
        presentation,
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "One two three four".into(),
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

#[test]
fn list_pick_and_numeric_builtins_render_seekable_frames_with_instance_overrides() {
    let mut rendered = plan(Presentation::default());
    let times = [0.37, 1.2, 0.05, 2.61, 0.37];
    let frames = times.map(|t| rendered.render(t).unwrap().rgba);
    assert_eq!(frames[0], frames[4], "random seek repeats the same pixels");
    assert_ne!(frames[0], frames[1]);
    assert!(frames[0].chunks_exact(4).any(|p| p[3] > 0));
    // The fill comes from the list parameter: overriding the list changes pixels,
    // while an override equal to the default keeps them byte-identical.
    let same: Presentation = serde_json::from_value(
        json!({"parameters": {"palette": ["#FFE600", "#4DD2FF", "#FF5C8A"]}}),
    )
    .unwrap();
    assert_eq!(plan(same).render(0.37).unwrap().rgba, frames[0]);
    let other: Presentation =
        serde_json::from_value(json!({"parameters": {"palette": ["#20FF20"]}})).unwrap();
    assert_ne!(plan(other).render(0.37).unwrap().rgba, frames[0]);
}
