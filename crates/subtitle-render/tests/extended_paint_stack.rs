//! Extended stacks keep one text shape and layer-major order. The oracle uses
//! one legacy text node per layer, with no extended-stack execution.
use caption_scene::{Presentation, parse_style};
use render_raster::{FrameMedia, TextEngine, drawop::DrawOp, rasterize_with_media};
use serde_json::{Value, json};
use std::sync::Arc;
use subtitle_render::scene::{SceneCue, ScenePlan, SceneWord};
use tiny_skia::Pixmap;

fn layer(i: usize) -> Value {
    let color = if i % 2 == 0 { "#F0206040" } else { "#2080E060" };
    json!({"id":format!("p{i}"),"unit":"px","offset":[(i%5) as f64-2.,(i%3) as f64-1.],
        "strokeWidth":if i%3==0 {12.} else {0.},"paint":{"kind":"solid","color":color}})
}
fn body(count: usize, mixed: bool) -> Value {
    let paints: Vec<_> = (0..count).map(layer).collect();
    let mut out = json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
        "schema":"baocut.caption-scene/1","evaluationVersion":1,
        "requiredCapabilities":["caption-scene/1","caption-paint-stack/1","caption-paint-effects/1","caption-paint-stack-extended/1"],
        "layout":{"width":{"value":300,"basis":"absolute"},"x":{"value":160,"basis":"absolute"},
            "y":{"value":80,"basis":"absolute"},"maxLines":1,"overflow":"visible",
            "pagination":{"unit":"word","maxUnitsPerPage":8}},
        "nodes":[{"id":"ink","type":"text","style":{"fontFamily":"Arimo","fontWeight":400,
            "fontSize":{"value":48,"basis":"absolute"},"fill":"#FFFFFF","paints":paints}}],
        "selectors":[],"animations":[]
    }}});
    if mixed {
        let s = &mut out["scene"]["value"];
        s["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-paint-style-bindings/1"));
        s["selectors"] = json!([{"id":"accent","nodeId":"ink","unit":"word","filter":{"kind":"range","start":1,"end":2}}]);
        let patches: Vec<_> = (0..count)
            .filter(|i| i % 7 != 0)
            .map(|i| {
                let mut p = layer(i);
                p["paint"]["color"] = json!("#50FF3090");
                p
            })
            .collect();
        s["paintStyleBindings"] = json!([{"id":"alternate","nodeId":"ink","selectorId":"accent","style":{"paints":patches}}]);
    }
    out
}
fn oracle(mut body: Value) -> Value {
    let s = &mut body["scene"]["value"];
    let original = s["nodes"][0].clone();
    let layers = original["style"]["paints"].as_array().unwrap().clone();
    let mut nodes = vec![];
    let mut selectors = vec![];
    let mut bindings = vec![];
    let mixed = s["paintStyleBindings"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    for (i, paint) in layers.iter().enumerate() {
        let id = format!("layer{i}");
        let mut node = original.clone();
        node["id"] = json!(id);
        node["zIndex"] = json!(i);
        node["style"]["paints"] = json!([paint]);
        nodes.push(node);
        for (j, binding) in mixed.iter().enumerate() {
            let sid = format!("select{i}-{j}");
            let mut selected = s["selectors"][j].clone();
            selected["id"] = json!(sid);
            selected["nodeId"] = json!(id);
            selectors.push(selected);
            let layer = binding["style"]["paints"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["id"] == paint["id"])
                .cloned()
                .unwrap_or_else(
                    || json!({"id":paint["id"],"paint":{"kind":"solid","color":"#00000000"}}),
                );
            bindings.push(json!({"id":format!("binding{i}-{j}"),"nodeId":id,"selectorId":sid,"style":{"paints":[layer]}}));
        }
    }
    s["nodes"] = json!(nodes);
    s["selectors"] = json!(selectors);
    if !mixed.is_empty() {
        s["paintStyleBindings"] = json!(bindings);
    }
    s["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c != "caption-paint-stack-extended/1");
    body
}
fn compile(value: &Value, text: &str, size: (u32, u32)) -> ScenePlan {
    let words = text
        .split_whitespace()
        .enumerate()
        .map(|(i, w)| SceneWord {
            id: format!("w{i}"),
            text: w.into(),
            start: i as f64,
            end: i as f64 + 1.,
        })
        .collect();
    ScenePlan::compile(
        parse_style(value).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "speech".into(),
            text: text.into(),
            start: 0.,
            end: 4.,
            words,
        }],
        size,
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/Arimo.ttf"
        )
        .to_vec()]),
        "extended-paints".into(),
    )
    .unwrap()
}
fn pixels(value: &Value, text: &str) -> Vec<u8> {
    compile(value, text, (320, 160))
        .render(0.25)
        .unwrap()
        .rgba
        .as_ref()
        .clone()
}
struct NoMedia;
impl FrameMedia for NoMedia {
    fn frame(&mut self, _: &str, _: i64) -> anyhow::Result<Arc<Pixmap>> {
        anyhow::bail!("unexpected media")
    }
}
fn oracle_pixels(value: Value, text: &str) -> Vec<u8> {
    let mut plan = compile(&oracle(value), text, (320, 160));
    let (mut frame, _) = plan.record(0.25).unwrap();
    // Each independent legacy node adds an extra neutral isolation. Remove only
    // these outer wrappers, then restore the one Text isolation of the subject.
    // Keeping them would add RGBA8 rounding and is not an equality oracle.
    let mut depth = 0usize;
    let mut ops = vec![];
    for op in frame.ops {
        match op {
            DrawOp::PushLayer { opacity, blend } => {
                if depth == 0 {
                    assert_eq!(opacity, 1.);
                    assert_eq!(blend, motion::effect::BlendMode::Normal);
                } else {
                    ops.push(DrawOp::PushLayer { opacity, blend });
                }
                depth += 1;
            }
            DrawOp::PopLayer => {
                assert!(depth > 0);
                depth -= 1;
                if depth > 0 {
                    ops.push(DrawOp::PopLayer);
                }
            }
            DrawOp::Clear { .. } => {
                panic!("oracle requires a transparent source without canvas clears")
            }
            other => ops.push(other),
        }
    }
    assert_eq!(depth, 0);
    let mut one = vec![DrawOp::PushLayer {
        opacity: 1.,
        blend: motion::effect::BlendMode::Normal,
    }];
    one.extend(ops);
    one.push(DrawOp::PopLayer);
    frame.ops = one;
    rasterize_with_media(&frame, 320, 160, &mut NoMedia)
        .unwrap()
        .data()
        .to_vec()
}
fn check_pixels(actual: &[u8], expected: &[u8], label: &str) {
    if actual != expected {
        let changed = actual.iter().zip(expected).filter(|(a, b)| a != b).count();
        for (name, rgba) in [("actual", actual), ("oracle", expected)] {
            tiny_skia::Pixmap::from_vec(
                rgba.to_vec(),
                tiny_skia::IntSize::from_wh(320, 160).unwrap(),
            )
            .unwrap()
            .save_png(format!("/tmp/extended-paints-{label}-{name}.png"))
            .unwrap();
        }
        panic!(
            "{label}: {changed} changed bytes, first {:?}",
            actual.iter().zip(expected).position(|(a, b)| a != b)
        );
    }
}
#[test]
fn seventeen_thirty_two_and_sixty_four_layers_match_independent_legacy_nodes() {
    for count in [1, 2, 17, 32, 64] {
        let value = body(count, false);
        let actual = pixels(&value, "AVA VA");
        assert!(actual.chunks_exact(4).any(|p| p[3] > 0));
        check_pixels(
            &actual,
            &oracle_pixels(value, "AVA VA"),
            &format!("count-{count}"),
        );
    }
}
#[test]
fn mixed_stacks_preserve_global_order_and_missing_layers() {
    let value = body(32, true);
    check_pixels(
        &pixels(&value, "AVA VA"),
        &oracle_pixels(value, "AVA VA"),
        "mixed",
    );
}
#[test]
fn legacy_sixteen_pixels_and_serialized_scene_are_unchanged_without_opt_in() {
    let legacy = oracle(body(1, false));
    let mut extended = legacy.clone();
    extended["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-stack-extended/1"));
    assert_eq!(pixels(&legacy, "AVA"), pixels(&extended, "AVA"));
    let mut value = body(16, false);
    let expected = pixels(&value, "AVA");
    value["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c != "caption-paint-stack-extended/1");
    assert_eq!(expected, pixels(&value, "AVA"));
}
#[test]
fn extended_blur_surfaces_accumulate_under_the_existing_frame_cap() {
    fn blurred(count: usize) -> Value {
        let mut value = body(count, false);
        let s = &mut value["scene"]["value"];
        s["layout"]["x"]["value"] = json!(240);
        s["layout"]["y"]["value"] = json!(180);
        s["nodes"][0]["style"]["fontSize"]["value"] = json!(300);
        for p in s["nodes"][0]["style"]["paints"].as_array_mut().unwrap() {
            p["strokeWidth"] = json!(0);
            p["offset"] = json!([0, 0]);
            p["blur"] = json!(0.25);
        }
        value
    }
    compile(&blurred(17), "W", (480, 360)).render(0.25).unwrap();
    let error = compile(&blurred(64), "W", (480, 360))
        .render(0.25)
        .err()
        .expect("accumulated surfaces must reject");
    assert!(
        error.to_string().contains("CAPTION_BUDGET_EXCEEDED"),
        "{error}"
    );
}
#[test]
fn extended_bound_stacks_still_charge_the_original_operation_budget() {
    let mut value = body(64, true);
    value["scene"]["value"]["selectors"][0]["filter"] = json!({"kind":"all"});
    value["scene"]["value"]["layout"]["width"]["value"] = json!(6000);
    value["scene"]["value"]["nodes"][0]["style"]["fontSize"]["value"] = json!(1);
    let error = compile(&value, &"A".repeat(1000), (320, 160))
        .render(0.25)
        .err()
        .expect("shared work budget must reject");
    assert!(error.to_string().contains("operation budget"), "{error}");
}
