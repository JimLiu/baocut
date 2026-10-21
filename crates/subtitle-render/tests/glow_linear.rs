use caption_scene::{Presentation, parse_style};
use render_raster::TextEngine;
use render_raster::effects::material_plan::MaterialCommand;
use serde_json::{Value, json};
use subtitle_render::scene::{SceneCue, ScenePlan};

fn fixture(linear: bool) -> Value {
    serde_json::from_str(if linear {
        include_str!("../../caption-scene/tests/fixtures/glow-linear.json")
    } else {
        include_str!("../../caption-scene/tests/fixtures/glow-cascade.json")
    })
    .unwrap()
}
fn plan(body: Value) -> ScenePlan {
    ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "Light".into(),
            start: 0.0,
            end: 4.0,
            words: vec![],
        }],
        (160, 90),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "linear".into(),
    )
    .unwrap()
}

#[test]
fn level_color_glow_renders_on_cpu_outside_the_text_and_keeps_the_text_on_top() {
    let mut body = fixture(true);
    body["scene"]["value"]["materials"][0]["originalOpacity"] = json!({"kind":"constant","value":1});
    let lit = plan(body.clone()).render(0.2).unwrap().rgba;
    let mut dark = body.clone();
    dark["scene"]["value"]["materials"][0]["intensity"] = json!({"kind":"constant","value":0});
    let unlit = plan(dark).render(0.2).unwrap().rgba;
    let (mut halo, mut opaque) = (0, 0);
    for (glow, text) in lit.chunks_exact(4).zip(unlit.chunks_exact(4)) {
        if text[3] == 0 && glow[3] > 8 {
            halo += 1;
            // levelColor #FFD700 replaces the level RGB: warm, blue stays dark.
            assert!(glow[0] >= glow[1] && glow[1] > glow[2], "{glow:?}");
        }
        if text[3] == 255 {
            opaque += 1;
            assert_eq!(glow, text, "opaque original stays over the glow");
        }
    }
    assert!(halo > 0 && opaque > 0);
    // Without levelColor the levels keep the source RGB (white text, white halo).
    let mut uncolored = body;
    uncolored["scene"]["value"]["materials"][0]
        .as_object_mut()
        .unwrap()
        .remove("levelColor");
    let uncolored = plan(uncolored).render(0.2).unwrap().rgba;
    assert!(uncolored
        .chunks_exact(4)
        .zip(unlit.chunks_exact(4))
        .any(|(glow, text)| text[3] == 0 && glow[3] > 8 && glow[2] == glow[0]));
}

#[test]
fn gpu_material_plan_rejects_linear_glow_but_keeps_the_encoded_cascade() {
    let error = plan(fixture(true)).record_material_plan(0.2).unwrap_err();
    assert!(error.to_string().contains("CAPTION_MATERIAL_PLAN_UNSUPPORTED"), "{error}");
    let (frame, _) = plan(fixture(false)).record_material_plan(0.2).unwrap();
    let MaterialCommand::Glow(config) = &frame.layers[0].materials[0] else {
        panic!("glow command required");
    };
    assert!(config.gpu_supported());
    assert!(config.linear.is_none() && !config.gamma_alpha);
}
