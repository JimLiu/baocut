use caption_scene::*;
use render_raster::TextEngine;
use serde_json::{Value, json};
use subtitle_render::scene::*;

/// One word per token of `text`, 400 ms each and back to back.
fn words(text: &str) -> Vec<SceneWord> {
    text.split(' ')
        .enumerate()
        .map(|(i, token)| SceneWord {
            id: format!("w{}", i + 1),
            text: token.into(),
            start: i as f64 * 0.4,
            end: (i + 1) as f64 * 0.4,
        })
        .collect()
}

fn style(capabilities: Value, pagination: Value) -> Value {
    json!({"schema": "baocut.caption-scene-style/1", "scene": {"kind": "inline", "value": {
        "schema": "baocut.caption-scene/1", "evaluationVersion": 1,
        "requiredCapabilities": capabilities,
        "speechState": {"timingPolicy": "require-word-timing"},
        "layout": {
            "width": {"value": 140, "basis": "absolute"}, "x": {"value": 80, "basis": "absolute"},
            "y": {"value": 45, "basis": "absolute"}, "maxLines": 2, "overflow": "visible",
            "leadingGap": "hide", "pagination": pagination
        },
        "nodes": [{"id": "caption", "type": "text", "style": {"fontSize": {"value": 16, "basis": "absolute"}}}]
    }}})
}

fn plan(body: &Value, text: &str, words: Vec<SceneWord>, end: f64) -> ScenePlan {
    ScenePlan::compile(
        parse_style(body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: text.into(),
            start: 0.0,
            end,
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

fn slots(pitch: f64) -> ScenePlan {
    let body = style(
        json!(["caption-word-line-layout/1", "caption-line-slots/1"]),
        json!({"wordLinePattern": [[3]], "lineSlots": {"count": 2, "pitch": pitch}}),
    );
    let text = (1..=14)
        .map(|i| format!("W{i}"))
        .collect::<Vec<_>>()
        .join(" ");
    plan(&body, &text, words(&text), 5.6)
}

/// A plain two-row page showing `text`; line slots at pitch 1 must draw the same pixels.
fn two_rows(text: &str, rows: [usize; 2]) -> ScenePlan {
    let body = style(
        json!(["caption-word-line-layout/1"]),
        json!({"wordLinePattern": [rows]}),
    );
    plan(&body, text, words(text), 6.0)
}

fn frame(plan: &mut ScenePlan, t: f64) -> Vec<u8> {
    plan.render(t).unwrap().rgba.to_vec()
}

/// Rows of the 160 x 90 frame that carry any ink.
fn ink_rows(frame: &[u8]) -> Vec<usize> {
    (0..90)
        .filter(|row| {
            frame[row * 160 * 4..(row + 1) * 160 * 4]
                .chunks_exact(4)
                .any(|pixel| pixel[3] > 0)
        })
        .collect()
}

#[test]
fn two_visible_lines_draw_like_one_two_row_page_in_slot_order() {
    let mut rolling = slots(1.0);
    // Pages 0 and 1 are in slots 0 and 1: the top line is the older one.
    let first = frame(&mut rolling, 2.0);
    assert_eq!(
        first,
        frame(&mut two_rows("W1 W2 W3 W4 W5 W6", [3, 3]), 2.0)
    );
    // Pages 1 and 2: page 2 returns to the top slot, above page 1.
    let second = frame(&mut rolling, 2.5);
    assert_eq!(
        second,
        frame(&mut two_rows("W7 W8 W9 W4 W5 W6", [3, 3]), 2.5)
    );
    assert_ne!(first, second);
    // Pages 3 and 4: the last short line takes the top slot again.
    let last = frame(&mut rolling, 5.0);
    assert_eq!(
        last,
        frame(&mut two_rows("W13 W14 W10 W11 W12", [2, 3]), 5.0)
    );
}

#[test]
fn a_single_visible_line_sits_in_its_own_slot() {
    let mut rolling = slots(1.4);
    let rows = ink_rows(&frame(&mut rolling, 0.2));
    assert!(!rows.is_empty());
    // Slot 0 of two is above the layout centre line (y = 45) and nothing is drawn below it.
    assert!(rows.iter().all(|row| *row < 45), "{rows:?}");
    // With a second line visible, the other one sits below the centre.
    let rows = ink_rows(&frame(&mut rolling, 2.0));
    assert!(rows.iter().any(|row| *row < 45) && rows.iter().any(|row| *row > 45));
}

#[test]
fn the_pitch_scales_the_distance_between_slots() {
    let spread = |pitch: f64| {
        let rows = ink_rows(&frame(&mut slots(pitch), 2.0));
        rows.last().unwrap() - rows.first().unwrap()
    };
    assert!(spread(2.0) > spread(1.0) && spread(1.0) > spread(0.5));
}
