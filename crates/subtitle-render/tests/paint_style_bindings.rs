//! Static semantic paint choices must preserve one text node's layer ordering.
//! Fixtures use authored text, bundled fonts and generated pixels only.
use caption_scene::{Presentation, parse_style};
use render_raster::{
    FrameMedia, TextEngine,
    drawop::{DrawOp, FrameOps},
    effects::material_plan::MaterialSource,
    rasterize_with_media,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use subtitle_render::scene::{SceneCue, ScenePlan, SceneWord};
use tiny_skia::Pixmap;

const W: u32 = 320;
const H: u32 = 160;

fn body() -> Value {
    json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
        "schema":"baocut.caption-scene/1","evaluationVersion":1,
        "requiredCapabilities":["caption-scene/1","caption-paint-stack/1","caption-paint-effects/1"],
        "layout":{"width":{"value":300,"basis":"absolute"},"x":{"value":160,"basis":"absolute"},
            "y":{"value":80,"basis":"absolute"},"maxLines":1,"overflow":"visible",
            "pagination":{"unit":"word","maxUnitsPerPage":8}},
        "nodes":[{"id":"ink","type":"text","style":{"fontFamily":"Arimo","fontWeight":400,
            "fontSize":{"value":48,"basis":"absolute"},"fill":"#FFFFFF","paints":[fill()]}}],
        "selectors":[],"animations":[]
    }}})
}
fn fill() -> Value {
    json!({"id":"fill","paint":{"kind":"node-fill"}})
}
fn stroke(id: &str, width: f64, color: &str) -> Value {
    json!({"id":id,"unit":"px","strokeWidth":width,"paint":{"kind":"solid","color":color}})
}
fn selector(id: &str, filter: Value) -> Value {
    json!({"id":id,"nodeId":"ink","unit":"word","filter":filter})
}
fn binding(id: &str, selector_id: &str, style: Value) -> Value {
    json!({"id":id,"nodeId":"ink","selectorId":selector_id,"style":style})
}
fn add_bindings(body: &mut Value, selectors: Value, bindings: Value) {
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-style-bindings/1"));
    scene["selectors"] = selectors;
    scene["paintStyleBindings"] = bindings;
}
fn compile(body: Value, text: &str, tags: &[(&str, &[&str])]) -> ScenePlan {
    let mut presentation = Presentation::default();
    for (id, values) in tags {
        presentation
            .word_tags
            .insert((*id).into(), values.iter().map(|v| (*v).into()).collect());
    }
    let words = text
        .split_whitespace()
        .enumerate()
        .map(|(i, text)| SceneWord {
            id: format!("w{i}"),
            text: text.into(),
            start: i as f64,
            end: i as f64 + 1.,
        })
        .collect();
    ScenePlan::compile(
        parse_style(&body).unwrap(),
        presentation,
        vec![SceneCue {
            id: "cue".into(),
            document_id: "speech".into(),
            text: text.into(),
            start: 0.,
            end: 4.,
            words,
        }],
        (W, H),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/Arimo.ttf"
        )
        .to_vec()]),
        "paint-style-bindings".into(),
    )
    .unwrap()
}
fn pixels(body: Value, text: &str, tags: &[(&str, &[&str])]) -> Vec<u8> {
    compile(body, text, tags)
        .render(0.25)
        .unwrap()
        .rgba
        .as_ref()
        .clone()
}
fn legacy_fill(mut body: Value, indices: &[usize], color: &str) -> Value {
    let scene = &mut body["scene"]["value"];
    scene.as_object_mut().unwrap().remove("paintStyleBindings");
    scene["selectors"] = json!(
        indices
            .iter()
            .map(|index| selector(
                &format!("word-{index}"),
                json!({"kind":"range","start":index,"end":index+1})
            ))
            .collect::<Vec<_>>()
    );
    scene["animations"] = json!(indices.iter().map(|index| json!({
        "id":format!("color-{index}"),"target":{"nodeId":"ink","selectorId":format!("word-{index}")},
        "property":"fill","composite":"replace","value":{"kind":"constant","value":color}
    })).collect::<Vec<_>>());
    body
}

#[test]
fn exact_tags_ranges_and_parity_select_only_the_intersection() {
    let mut selected = body();
    add_bindings(
        &mut selected,
        json!([selector(
            "chosen",
            json!({"kind":"and","filters":[
                {"kind":"tag","value":"accent"},
                {"kind":"range","start":1,"end":3},
                {"kind":"parity","odd":true}
            ]})
        )]),
        json!([binding(
            "red",
            "chosen",
            json!({"fill":"#FF0000","paints":[fill()]})
        )]),
    );
    let tags: &[(&str, &[&str])] = &[
        ("w0", &["accent"]),
        ("w1", &["accent"]),
        ("w2", &["Accent"]),
        ("w3", &["accent"]),
    ];
    let actual = pixels(selected.clone(), "H H H H", tags);
    let expected = pixels(
        legacy_fill(selected.clone(), &[1], "#FF0000"),
        "H H H H",
        tags,
    );
    assert_eq!(actual, expected);
    assert_ne!(actual, pixels(body(), "H H H H", tags));
    // Tag spelling is exact; the selected range/parity alone is not a match.
    let changed_tags: &[(&str, &[&str])] = &[("w1", &["Accent"])];
    assert_eq!(
        pixels(selected, "H H H H", changed_tags),
        pixels(body(), "H H H H", changed_tags)
    );
}

#[test]
fn last_matching_binding_replaces_the_entire_stack_and_omitted_fill_uses_base() {
    let mut selected = body();
    add_bindings(
        &mut selected,
        json!([selector("all", json!({"kind":"all"}))]),
        json!([
            binding(
                "first",
                "all",
                json!({"fill":"#FF0000","paints":[stroke("outline",20.,"#000000"),fill()]})
            ),
            binding("last", "all", json!({"paints":[fill()]}))
        ]),
    );
    let actual = pixels(selected.clone(), "H H", &[]);
    assert_eq!(actual, pixels(body(), "H H", &[]));
    selected["scene"]["value"]["paintStyleBindings"]
        .as_array_mut()
        .unwrap()
        .pop();
    assert_ne!(actual, pixels(selected, "H H", &[]));
}

#[test]
fn page_fill_precedes_keyword_paints_but_word_state_and_animation_follow_them() {
    let mut selected = body();
    add_bindings(
        &mut selected,
        json!([
            {"id":"page","nodeId":"ink","unit":"page"},
            selector("keyword", json!({"kind":"tag","value":"accent"})),
            selector("last", json!({"kind":"range","start":2,"end":3})),
            selector("middle", json!({"kind":"range","start":1,"end":2}))
        ]),
        json!([
            binding(
                "purple",
                "keyword",
                json!({"fill":"#8000FF","paints":[fill()]})
            ),
            binding("inherit-page", "last", json!({"paints":[fill()]}))
        ]),
    );
    selected["scene"]["value"]["animations"] = json!([{
        "id":"page-palette","target":{"nodeId":"ink","selectorId":"page"},
        "property":"fill","composite":"replace","value":{"kind":"constant","value":"#00FF00"}
    }]);
    let tags: &[(&str, &[&str])] = &[("w1", &["accent"]), ("w2", &["accent"])];
    // The independent oracle has no page animation, paint bindings, or state:
    // its base is green and its sole constant word fill names the middle color.
    let expected = |middle: &str| {
        let mut fixed = body();
        fixed["scene"]["value"]["nodes"][0]["style"]["fill"] = json!("#00FF00");
        pixels(legacy_fill(fixed, &[1], middle), "H H H", &[])
    };
    let purple = expected("#8000FF");
    let blue = expected("#0000FF");
    let red = expected("#FF0000");
    assert_ne!(purple, blue);
    assert_ne!(blue, red);
    assert_eq!(
        compile(selected.clone(), "H H H", tags)
            .render(1.25)
            .unwrap()
            .rgba
            .as_ref(),
        &purple,
        "normal inherits page green; keyword replaces it; last binding without fill restores page green"
    );

    selected["scene"]["value"]["nodes"][0]["stateStyles"] =
        json!({"unit":"word","active":{"fill":"#0000FF"}});
    assert_eq!(
        compile(selected.clone(), "H H H", tags)
            .render(1.25)
            .unwrap()
            .rgba
            .as_ref(),
        &blue,
        "the active middle word's state fill follows its purple keyword paint"
    );

    selected["scene"]["value"]["animations"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "id":"word-color","target":{"nodeId":"ink","selectorId":"middle"},
            "property":"fill","composite":"replace","value":{"kind":"constant","value":"#FF0000"}
        }));
    assert_eq!(
        compile(selected, "H H H", tags)
            .render(1.25)
            .unwrap()
            .rgba
            .as_ref(),
        &red,
        "a later word fill animation follows both keyword paint and active word state"
    );
}

#[test]
fn unmatched_binding_preserves_previous_paint_pixels_hit_geometry_and_fingerprint() {
    let mut legacy = body();
    legacy["scene"]["value"]["nodes"][0]["style"]["paints"] =
        json!([stroke("outline", 3., "#000000"), fill()]);
    let mut selected = legacy.clone();
    add_bindings(
        &mut selected,
        json!([selector("missing", json!({"kind":"tag","value":"absent"}))]),
        json!([binding(
            "unused",
            "missing",
            json!({"fill":"#00FF00","paints":[stroke("outline",25.,"#FF0000"),fill()]})
        )]),
    );
    let mut expected = compile(legacy, "H H", &[]);
    let mut actual = compile(selected, "H H", &[]);
    for time in [3.5, 0.25, 1.5, 0.25] {
        let a = expected.render(time).unwrap();
        let b = actual.render(time).unwrap();
        assert_eq!(a.rgba, b.rgba);
        assert_eq!(a.fingerprint, b.fingerprint);
        assert_eq!(a.hits.len(), b.hits.len());
        for (a, b) in a.hits.iter().zip(&b.hits) {
            assert_eq!(
                (a.bounds.x, a.bounds.y, a.bounds.width, a.bounds.height),
                (b.bounds.x, b.bounds.y, b.bounds.width, b.bounds.height)
            );
        }
    }
}

#[test]
fn static_paints_compose_with_sampled_font_size_and_same_scene_reverse_seek() {
    let mut selected = body();
    add_bindings(
        &mut selected,
        json!([selector(
            "middle",
            json!({"kind":"range","start":1,"end":2})
        )]),
        json!([binding(
            "accent",
            "middle",
            json!({"fill":"#FF0000","paints":[fill()]})
        )]),
    );
    let scene = &mut selected["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([
            json!("caption-unit-font-size/1"),
            json!("caption-word-line-layout/1"),
        ]);
    scene["layout"]["pagination"] = json!({"wordLinePattern":[[3]]});
    scene["layout"]["layoutEvaluation"] = json!("per-sample");
    scene["layout"]["fontSizeBindings"] = json!([{
        "id":"grow","nodeId":"ink","selectorId":"middle",
        "value":{"kind":"keyframes","clock":{"unit":"word","origin":"start","duration":{"kind":"unit-span"}},
            "keys":[{"at":0,"value":24},{"at":1,"value":60}],
            "fill":{"before":"hold","after":"hold"}}
    }]);
    // The oracle keeps the existing word-color path and the same independent
    // typography binding, so a paint choice cannot silently change layout.
    let mut oracle = selected.clone();
    oracle["scene"]["value"]
        .as_object_mut()
        .unwrap()
        .remove("paintStyleBindings");
    oracle["scene"]["value"]["animations"] = json!([{
        "id":"red","target":{"nodeId":"ink","selectorId":"middle"},"property":"fill",
        "composite":"replace","value":{"kind":"constant","value":"#FF0000"}
    }]);
    let mut actual = compile(selected.clone(), "H H H", &[]);
    let mut expected = compile(oracle, "H H H", &[]);
    let mut frames = Vec::new();
    for time in [1.8, 1.1, 0.2, 1.1] {
        let a = actual.render(time).unwrap();
        let b = expected.render(time).unwrap();
        let fresh = compile(selected.clone(), "H H H", &[])
            .render(time)
            .unwrap();
        assert_eq!(a.rgba, b.rgba);
        assert_eq!(a.rgba, fresh.rgba);
        assert_eq!(a.fingerprint, fresh.fingerprint);
        frames.push(a.rgba);
    }
    assert_ne!(
        frames[0], frames[1],
        "font-size animation must actually run"
    );
    assert_eq!(frames[1], frames[3]);
}

struct NoMedia;
impl FrameMedia for NoMedia {
    fn frame(&mut self, _: &str, _: i64) -> anyhow::Result<Arc<Pixmap>> {
        anyhow::bail!("unexpected external media")
    }
}
fn raster(frame: &FrameOps) -> Vec<u8> {
    rasterize_with_media(frame, W, H, &mut NoMedia)
        .unwrap()
        .data()
        .to_vec()
}
fn paint_ops(frame: &FrameOps) -> Vec<DrawOp> {
    frame
        .ops
        .iter()
        .filter(|op| {
            matches!(
                op,
                DrawOp::StrokePathPaint { .. } | DrawOp::FillPathPaint { .. }
            )
        })
        .cloned()
        .collect()
}
fn with_ops(frame: &FrameOps, ops: Vec<DrawOp>) -> FrameOps {
    FrameOps {
        ops,
        static_prefix: None,
        paths: frame.paths.clone(),
        strings: frame.strings.clone(),
        paints: frame.paints.clone(),
        bitmaps: frame.bitmaps.clone(),
    }
}

#[test]
fn a_later_words_large_outline_never_covers_a_neighbors_fill() {
    let mut small = body();
    small["scene"]["value"]["nodes"][0]["style"]["paints"] =
        json!([stroke("outline", 4., "#000000"), fill()]);
    let mut large = small.clone();
    large["scene"]["value"]["nodes"][0]["style"]["paints"][0] = stroke("outline", 64., "#000000");
    let (base_frame, _) = compile(small.clone(), "H H", &[]).record(0.25).unwrap();
    let (large_frame, _) = compile(large.clone(), "H H", &[]).record(0.25).unwrap();
    assert_eq!(base_frame.paths, large_frame.paths);
    assert_eq!(base_frame.paints, large_frame.paints);
    let a = paint_ops(&base_frame);
    let b = paint_ops(&large_frame);
    assert_eq!((a.len(), b.len()), (4, 4));
    let correct = raster(&with_ops(
        &base_frame,
        vec![a[0].clone(), b[1].clone(), a[2].clone(), a[3].clone()],
    ));
    let complete_stacks = raster(&with_ops(
        &base_frame,
        vec![a[0].clone(), a[2].clone(), b[1].clone(), a[3].clone()],
    ));
    assert_ne!(
        correct, complete_stacks,
        "fixture must expose cross-word outline overlap"
    );
    add_bindings(
        &mut small,
        json!([selector(
            "second",
            json!({"kind":"range","start":1,"end":2})
        )]),
        json!([binding(
            "large",
            "second",
            json!({"paints":large["scene"]["value"]["nodes"][0]["style"]["paints"]})
        )]),
    );
    assert_eq!(pixels(small, "H H", &[]), correct);
}

#[test]
fn different_stack_topologies_follow_the_shared_partial_order() {
    let mut selected = body();
    let base = json!([stroke("under", 64., "#0000FF"), fill()]);
    let richer = json!([
        stroke("under", 64., "#0000FF"),
        stroke("accent", 8., "#FF0000"),
        fill()
    ]);
    selected["scene"]["value"]["nodes"][0]["style"]["paints"] = base;
    let mut oracle = selected.clone();
    oracle["scene"]["value"]["nodes"][0]["style"]["paints"] = richer.clone();
    let (frame, _) = compile(oracle, "H H", &[]).record(0.25).unwrap();
    let ops = paint_ops(&frame);
    assert_eq!(ops.len(), 6);
    // The first word has no accent layer. All under-layers still precede the
    // second word's accent, and all fills come last.
    let expected = raster(&with_ops(
        &frame,
        vec![
            ops[0].clone(),
            ops[1].clone(),
            ops[3].clone(),
            ops[4].clone(),
            ops[5].clone(),
        ],
    ));
    add_bindings(
        &mut selected,
        json!([selector(
            "second",
            json!({"kind":"range","start":1,"end":2})
        )]),
        json!([binding("extra-layer", "second", json!({"paints":richer}))]),
    );
    assert_eq!(pixels(selected, "H H", &[]), expected);
}

#[test]
fn equal_layer_definitions_share_one_blurred_coverage_across_style_choices() {
    let mut selected = body();
    let paints = json!([
        {"id":"shadow","unit":"px","offset":[2,1],"spread":1,"blur":1.5,
            "paint":{"kind":"solid","color":"#0000FF"}},fill()
    ]);
    selected["scene"]["value"]["nodes"][0]["style"]["paints"] = paints.clone();
    add_bindings(
        &mut selected,
        json!([selector(
            "second",
            json!({"kind":"range","start":1,"end":2})
        )]),
        json!([binding(
            "red",
            "second",
            json!({"fill":"#FF0000","paints":paints})
        )]),
    );
    let (frame, _) = compile(selected.clone(), "H H", &[]).record(0.25).unwrap();
    assert_eq!(
        frame
            .ops
            .iter()
            .filter(|op| matches!(op, DrawOp::DrawBitmap { .. }))
            .count(),
        1,
        "equal shadow definitions must not split into one blur per complete style"
    );
    assert_eq!(
        pixels(selected.clone(), "H H", &[]),
        pixels(legacy_fill(selected, &[1], "#FF0000"), "H H", &[])
    );
}

#[test]
fn an_image_paint_referenced_only_by_a_binding_loads_and_keeps_other_words_plain() {
    let mut png = Pixmap::new(1, 1).unwrap();
    png.data_mut().copy_from_slice(&[0, 0, 255, 255]);
    let bytes = png.encode_png().unwrap();
    let digest: String = Sha256::digest(&bytes)
        .iter()
        .map(|v| format!("{v:02x}"))
        .collect();
    let mut selected = body();
    selected["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-image-paint/1"));
    selected["scene"]["value"]["resources"] = json!([{
        "id":"texture","assetRef":{"id":"authored-blue","revision":"1"},"contentHash":format!("sha256:{digest}")
    }]);
    add_bindings(
        &mut selected,
        json!([selector(
            "second",
            json!({"kind":"range","start":1,"end":2})
        )]),
        json!([binding(
            "texture",
            "second",
            json!({"paints":[{
                "id":"fill","paint":{"kind":"image","resourceId":"texture","space":"glyph-normalized",
                    "uvTransform":[0.001,0,0,0.001,0.5,0.5],"filter":"nearest","wrap":"clamp"}
            }]})
        )]),
    );
    let mut plan = compile(selected, "H H", &[]);
    assert!(
        plan.render(0.25).is_err(),
        "binding-only resources must not be silently ignored"
    );
    plan.load_resources(|resource| (resource.id == "texture").then(|| bytes.clone()))
        .unwrap();
    let actual = plan.render(0.25).unwrap();
    let blue = actual
        .rgba
        .chunks_exact(4)
        .filter(|p| p[3] == 255 && p[2] == 255 && p[0] == 0 && p[1] == 0)
        .count();
    let white = actual
        .rgba
        .chunks_exact(4)
        .filter(|p| p[0] == 255 && p[1] == 255 && p[2] == 255 && p[3] == 255)
        .count();
    assert!(
        blue > 20 && white > 20,
        "both the selected texture and unselected fill must remain visible"
    );
}

#[test]
fn a_single_text_material_captures_both_paint_styles_together() {
    let mut selected = body();
    add_bindings(
        &mut selected,
        json!([selector(
            "second",
            json!({"kind":"range","start":1,"end":2})
        )]),
        json!([binding(
            "red",
            "second",
            json!({"fill":"#FF0000","paints":[fill()]})
        )]),
    );
    let expected = pixels(selected.clone(), "H H", &[]);
    let glow: Value = serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/glow-cascade.json"
    ))
    .unwrap();
    let mut material = glow["scene"]["value"]["materials"][0].clone();
    material["contextNodeId"] = json!("ink");
    material["intensity"] = json!({"kind":"constant","value":0.2});
    selected["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-glow-cascade/1"));
    selected["scene"]["value"]["materials"] = json!([material]);
    let mut plan = compile(selected, "H H", &[]);
    let (frame, _) = plan.record_material_plan(0.25).unwrap();
    assert_eq!(
        frame.layers.len(),
        1,
        "one text node must remain one material source"
    );
    assert_eq!(frame.layers[0].materials.len(), 1);
    let MaterialSource::Draw(source) = &frame.layers[0].source else {
        panic!("text draw source required")
    };
    assert_eq!(
        raster(source),
        expected,
        "capture must include both paint styles before material evaluation"
    );
    assert!(
        plan.render(0.25)
            .unwrap()
            .rgba
            .iter()
            .any(|value| *value != 0)
    );
}
