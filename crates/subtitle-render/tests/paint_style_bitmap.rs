//! Color glyphs remain one final bitmap pass under static paint-style choices.
//! The checked-in COLR probe is synthetic and does not use system emoji fonts.
use caption_scene::{Presentation, parse_style};
use render_raster::{TextEngine, drawop::DrawOp};
use serde_json::{Value, json};
use subtitle_render::scene::{SceneCue, ScenePlan, SceneWord};

const W: u32 = 320;
const H: u32 = 160;
const COLOR_FONT: &[u8] = include_bytes!("../../render-raster/tests/fixtures/fonts/ColrProbe.ttf");
const MONO_FONT: &[u8] = include_bytes!("../../render-raster/assets/fonts/Arimo.ttf");

fn fill() -> Value {
    json!({"id":"fill","paint":{"kind":"node-fill"}})
}
fn outline() -> Value {
    json!({"id":"outline","strokeWidth":5,"paint":{"kind":"solid","color":"#000000FF"}})
}
fn body() -> Value {
    json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
        "schema":"baocut.caption-scene/1","evaluationVersion":1,
        "requiredCapabilities":["caption-scene/1","caption-paint-stack/1","caption-paint-effects/1","caption-unit-animation/1"],
        "layout":{"width":{"value":300,"basis":"absolute"},"x":{"value":160,"basis":"absolute"},
            "y":{"value":80,"basis":"absolute"},"maxLines":1,"overflow":"visible"},
        "nodes":[{"id":"ink","type":"text","style":{"fontFamily":"ColrProbe","fontSize":{"value":48,"basis":"absolute"},
            "fill":"#FFFFFFFF","paints":[outline(),fill()]}}],
        "selectors":[
            {"id":"words","nodeId":"ink","unit":"word","filter":{"kind":"all"}},
            {"id":"chosen","nodeId":"ink","unit":"word","filter":{"kind":"tag","value":"accent"}}
        ],
        "animations":[{"id":"word-alpha","target":{"nodeId":"ink","selectorId":"words"},
            "property":"opacity","composite":"replace","value":{"kind":"constant","value":0.5}}]
    }}})
}
fn bind_style(style: &mut Value, paints: Value) {
    let scene = &mut style["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-style-bindings/1"));
    scene["paintStyleBindings"] = json!([{
        "id":"accent","nodeId":"ink","selectorId":"chosen","style":{"paints":paints}
    }]);
}
fn plan(style: Value, text: &str, tagged_words: &[&str]) -> ScenePlan {
    let mut presentation = Presentation::default();
    for id in tagged_words {
        presentation
            .word_tags
            .insert((*id).into(), vec!["accent".into()]);
    }
    ScenePlan::compile(
        parse_style(&style).unwrap(),
        presentation,
        vec![SceneCue {
            id: "cue".into(),
            document_id: "speech".into(),
            text: text.into(),
            start: 0.,
            end: 3.,
            words: text
                .split_whitespace()
                .enumerate()
                .map(|(i, word)| SceneWord {
                    id: format!("w{i}"),
                    text: word.into(),
                    start: i as f64,
                    end: i as f64 + 1.,
                })
                .collect(),
        }],
        (W, H),
        TextEngine::with_document_fonts(&[COLOR_FONT.to_vec(), MONO_FONT.to_vec()]),
        "static-paint-color-bitmap".into(),
    )
    .unwrap()
}
fn bitmap_count(style: Value, text: &str, tags: &[&str]) -> usize {
    plan(style, text, tags)
        .record(0.25)
        .unwrap()
        .0
        .ops
        .iter()
        .filter(|op| matches!(op, DrawOp::DrawBitmap { .. }))
        .count()
}

#[test]
fn two_layer_binding_keeps_half_opacity_color_bitmap_at_one_composite() {
    let control = body();
    assert_eq!(
        bitmap_count(control.clone(), "A", &[]),
        1,
        "positive COLR bitmap control"
    );
    let expected = plan(control.clone(), "A", &[]).render(0.25).unwrap();
    let max_alpha = expected.rgba.chunks_exact(4).map(|p| p[3]).max().unwrap();
    assert!(
        max_alpha > 0 && max_alpha <= 128,
        "word alpha .5 must be visible and not .75"
    );
    let mut selected = control;
    bind_style(&mut selected, json!([outline(), fill()]));
    assert_eq!(
        bitmap_count(selected.clone(), "A", &["w0"]),
        1,
        "stack layers must not repeat the color glyph bitmap"
    );
    let actual = plan(selected, "A", &["w0"]).render(0.25).unwrap();
    assert_eq!(actual.rgba, expected.rgba);
}

#[test]
fn selected_and_unselected_color_words_are_each_drawn_once_with_different_stack_lengths() {
    let control = body();
    let expected = plan(control.clone(), "A A", &[]).render(0.25).unwrap();
    let mut selected = control;
    bind_style(&mut selected, json!([fill()]));
    assert_eq!(bitmap_count(selected.clone(), "A A", &["w1"]), 2);
    let actual = plan(selected, "A A", &["w1"]).render(0.25).unwrap();
    assert_eq!(actual.rgba, expected.rgba);
}

#[test]
fn color_bitmaps_follow_all_outline_paints_of_the_same_text() {
    let mut selected = body();
    bind_style(&mut selected, json!([outline(), fill()]));
    let (frame, _) = plan(selected, "A H", &["w0"]).record(0.25).unwrap();
    let paints = frame
        .ops
        .iter()
        .enumerate()
        .filter_map(|(index, op)| {
            matches!(
                op,
                DrawOp::FillPathPaint { .. } | DrawOp::StrokePathPaint { .. }
            )
            .then_some(index)
        })
        .collect::<Vec<_>>();
    let bitmaps = frame
        .ops
        .iter()
        .enumerate()
        .filter_map(|(index, op)| matches!(op, DrawOp::DrawBitmap { .. }).then_some(index))
        .collect::<Vec<_>>();
    assert!(!paints.is_empty(), "positive outline fallback control");
    assert_eq!(bitmaps.len(), 1, "one COLR glyph must remain one bitmap");
    assert!(
        bitmaps[0] > *paints.last().unwrap(),
        "color bitmap must be the final text paint pass"
    );
}

#[test]
fn only_a_color_glyphs_selected_mask_stack_is_rejected() {
    let mut selected = body();
    selected["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-mask/1"));
    let mut masked = fill();
    masked["mask"] = json!({"kind":"glyph-fill"});
    bind_style(&mut selected, json!([masked]));
    let error = plan(selected.clone(), "A", &["w0"])
        .record(0.25)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("glyph paint mask requires outline glyphs"),
        "{error}"
    );
    assert_eq!(
        bitmap_count(selected, "A", &[]),
        1,
        "a static inactive mask is valid metadata and must not mask an unselected bitmap"
    );
}

fn distance_fill() -> Value {
    let mut layer = fill();
    layer["distanceCoverage"] = json!({
        "source":"glyph-contours",
        "bands":[{"offset":[0,0],"threshold":0,"halfWidth":0.1}],
        "aa":{"kind":"quad-derivative","sourceBand":0,"scale":0.5},
        "combine":"multiply","zeroWidth":"error"
    });
    layer
}

#[test]
fn selected_color_glyph_distance_rejects_while_inactive_distance_preserves_bitmap() {
    let control = body();
    let expected = plan(control.clone(), "A", &[]).render(0.25).unwrap();
    assert_eq!(bitmap_count(control.clone(), "A", &[]), 1);
    let mut selected = control;
    selected["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-glyph-distance-coverage/1"));
    bind_style(&mut selected, json!([distance_fill()]));
    let error = plan(selected.clone(), "A", &["w0"])
        .record(0.25)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("glyph distance requires outline glyphs"),
        "{error}"
    );
    assert_eq!(bitmap_count(selected.clone(), "A", &[]), 1);
    assert_eq!(
        plan(selected, "A", &[]).render(0.25).unwrap().rgba,
        expected.rgba
    );
}

#[test]
fn base_color_glyph_distance_rejects_when_another_word_selects_an_ordinary_stack() {
    // A is the synthetic color glyph; H uses the ordinary outline fallback.
    assert_eq!(bitmap_count(body(), "A H", &[]), 1);
    let mut selected = body();
    selected["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-glyph-distance-coverage/1"));
    selected["scene"]["value"]["nodes"][0]["style"]["paints"] = json!([distance_fill()]);
    bind_style(&mut selected, json!([fill()]));
    let error = plan(selected, "A H", &["w1"])
        .record(0.25)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("glyph distance requires outline glyphs"),
        "{error}"
    );
}

#[test]
fn selected_color_stack_with_separate_mask_and_distance_layers_keeps_mask_diagnostic_first() {
    let mut selected = body();
    selected["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([
            json!("caption-paint-mask/1"),
            json!("caption-glyph-distance-coverage/1"),
        ]);
    let mut masked = outline();
    masked["mask"] = json!({"kind":"glyph-fill"});
    bind_style(&mut selected, json!([masked, distance_fill()]));
    let error = plan(selected, "A", &["w0"])
        .record(0.25)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("glyph paint mask requires outline glyphs"),
        "{error}"
    );
    assert!(
        !error.contains("glyph distance requires outline glyphs"),
        "{error}"
    );
}
