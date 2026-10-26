//! Template adjustments render exactly like the equivalent hand-edited scene.
use caption_scene::{ADJUST_UNSUPPORTED, Presentation, parse_style};
use render_raster::TextEngine;
use serde_json::{Value, json};
use subtitle_render::scene::{SceneCue, ScenePlan};

fn template() -> Value {
    json!({
        "schema": "baocut.caption-scene-style/1",
        "scene": {"kind": "inline", "value": {
            "schema": "baocut.caption-scene/1",
            "evaluationVersion": 1,
            "requiredCapabilities": ["caption-paint-stack/1", "caption-paint-effects/1"],
            "parameters": [{"id": "lift", "type": "scalar", "default": 0.7}],
            "layout": {
                "width": {"value": 0.9, "basis": "canvasWidth"},
                "x": {"value": 0.5, "basis": "canvasWidth"},
                "y": {"value": 1, "parameter": "lift", "basis": "canvasHeight"},
                "maxLines": 2
            },
            "nodes": [
                {"id": "caption", "type": "text", "text": {"source": "cue"},
                 "style": {"fontWeight": 700, "fontSize": {"value": 0.18, "basis": "canvasHeight"}, "fill": "#FFFFFF",
                           "paints": [
                               {"id": "outer", "unit": "em", "strokeWidth": 0.12, "paint": {"kind": "solid", "color": "#000000CC"}},
                               {"id": "body", "paint": {"kind": "node-fill"}}
                           ]}}
            ]
        }}
    })
}

fn plan(body: &Value) -> ScenePlan {
    ScenePlan::compile(
        parse_style(body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "Adjust 调整".into(),
            start: 0.0,
            end: 4.0,
            words: vec![],
        }],
        (192, 108),
        TextEngine::with_document_fonts(&[include_bytes!("../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").to_vec()]),
        "adjust".into(),
    )
    .unwrap()
}
fn pixels(body: &Value) -> Vec<u8> {
    plan(body).render(1.0).unwrap().rgba.to_vec()
}
fn adjusted(adjust: Value) -> Value {
    let mut body = template();
    body["adjust"] = adjust;
    body
}

#[test]
fn colour_swap_matches_the_hand_edited_scene() {
    let mut edited = template();
    edited["scene"]["value"]["nodes"][0]["style"]["fill"] = json!("#FF3366");
    edited["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["color"] = json!("#2244FFCC");
    let swapped = pixels(&adjusted(json!({"colors": [
        {"from": "#FFFFFF", "to": "#FF3366"},
        {"from": "#000000CC", "to": "#2244FF"}
    ]})));
    assert_eq!(swapped, pixels(&edited));
    assert_ne!(swapped, pixels(&template()));
}

#[test]
fn font_scale_and_font_swap_match_the_hand_edited_scene() {
    let mut edited = template();
    edited["scene"]["value"]["nodes"][0]["style"]["fontSize"]["value"] = json!(0.18 * 0.75);
    edited["scene"]["value"]["nodes"][0]["style"]["fontWeight"] = json!(400);
    let body = adjusted(json!({
        "fontScale": 0.75,
        "fonts": [{"from": "Noto Sans SC", "to": {"family": "Noto Sans SC", "weight": 400}}]
    }));
    assert_eq!(pixels(&body), pixels(&edited));
}

#[test]
fn placement_moves_constant_keys_and_reports_parameter_driven_ones() {
    let mut edited = template();
    edited["scene"]["value"]["layout"]["x"] = json!({"value": 0.4, "basis": "canvasWidth"});
    let body = adjusted(json!({"placement": {"x": 0.4, "y": 0.2}}));
    let mut plan = plan(&body);
    assert_eq!(plan.diagnostics.len(), 1);
    assert_eq!(plan.diagnostics[0].code, ADJUST_UNSUPPORTED);
    assert_eq!(plan.diagnostics[0].path, "adjust.placement.y");
    assert_eq!(plan.render(1.0).unwrap().rgba.to_vec(), pixels(&edited));
}

#[test]
fn origin_and_empty_adjust_render_the_template_as_is() {
    let mut body = adjusted(json!({}));
    body["origin"] = json!({"template": {"id": "outline", "revision": 1}, "sceneSha256": "c".repeat(64)});
    let mut plan = plan(&body);
    assert!(plan.diagnostics.is_empty());
    assert_eq!(plan.render(1.0).unwrap().rgba.to_vec(), pixels(&template()));
}
