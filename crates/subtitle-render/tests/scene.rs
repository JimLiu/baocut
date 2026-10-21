use caption_scene::*;
use render_raster::TextEngine;
use serde_json::{Value, json};
use subtitle_render::scene::*;
fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/word-pop.json"
    ))
    .unwrap()
}
fn plan(body: Value, text: &str, words: Vec<SceneWord>, p: Presentation) -> ScenePlan {
    ScenePlan::compile(
        parse_style(&body).unwrap(),
        p,
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: text.into(),
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
fn words() -> Vec<SceneWord> {
    ["One", "two", "three", "four"]
        .iter()
        .enumerate()
        .map(|(i, t)| SceneWord {
            id: format!("w{i}"),
            text: (*t).into(),
            start: i as f64,
            end: i as f64 + 0.7,
        })
        .collect()
}

#[test]
fn component_materials_keep_emission_and_are_repeatable_with_feedback() {
    for source in [
        include_str!("../../caption-scene/tests/fixtures/gaussian-axis.json"),
        include_str!("../../caption-scene/tests/fixtures/glow-cascade.json"),
    ] {
        let body: Value = serde_json::from_str(source).unwrap();
        let mut rendered = plan(
            body.clone(),
            "One two three four",
            words(),
            Presentation::default(),
        );
        let first = rendered.render(0.2).unwrap();
        assert!(
            first
                .rgba
                .chunks_exact(4)
                .any(|p| p[..3].iter().any(|c| *c > p[3])),
            "emission must not be clamped to alpha"
        );
        assert_ne!(first.rgba, rendered.render(0.9).unwrap().rgba);
        assert_eq!(first.rgba, rendered.render(0.2).unwrap().rgba);
        let (ops, _) = rendered.record(0.2).unwrap();
        assert!(
            ops.ops
                .iter()
                .any(|op| matches!(op, render_raster::drawop::DrawOp::DrawEmissiveBitmap { .. }))
        );
        let mut with_feedback = body;
        with_feedback["scene"]["value"]["materials"].as_array_mut().unwrap().push(json!({"kind":"feedback","id":"trail","samples":2,"step":{"ticks":1,"timescale":5},"decay":0.5,"offset":[2,0]}));
        let mut rendered = plan(
            with_feedback.clone(),
            "One two three four",
            words(),
            Presentation::default(),
        );
        let a = rendered.render(0.8).unwrap();
        let _ = rendered.render(3.1).unwrap();
        assert_eq!(a.rgba, rendered.render(0.8).unwrap().rgba);
        assert_eq!(
            a.rgba,
            plan(
                with_feedback,
                "One two three four",
                words(),
                Presentation::default()
            )
            .render(0.8)
            .unwrap()
            .rgba
        );
    }
}
#[test]
fn component_materials_share_sampled_layout_and_preserve_empty_cue_gaps() {
    let mut body: Value = serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/glow-cascade.json"
    ))
    .unwrap();
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-layout-per-sample/1"));
    scene["layout"]["layoutEvaluation"] = json!("per-sample");
    scene["layout"]["bindings"] = json!([{"nodeId":"caption","property":"fontSize","value":{"kind":"keyframes","clock":{"unit":"cue","origin":"start","duration":{"kind":"unit-span"}},"keys":[{"at":0,"value":12},{"at":1,"value":20}]}}]);
    let cue = |id: &str, start: f64, end: f64| SceneCue {
        id: id.into(),
        document_id: "doc".into(),
        text: "Light".into(),
        start,
        end,
        words: vec![],
    };
    let mut rendered = ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![cue("a", 0., 1.), cue("b", 2., 3.)],
        (160, 90),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "test".into(),
    )
    .unwrap();
    let start = rendered.render(0.2).unwrap();
    assert!(start.rgba.iter().any(|v| *v != 0));
    assert!(rendered.render(1.5).unwrap().rgba.iter().all(|v| *v == 0));
    assert_eq!(start.rgba, rendered.render(2.2).unwrap().rgba);
    assert_eq!(start.rgba, rendered.render(0.2).unwrap().rgba);
}
#[test]
fn real_word_pages_highlight_and_seek_are_shared_pixels() {
    let mut p = plan(
        fixture(),
        "One two three four",
        words(),
        Presentation::default(),
    );
    let a = p.render(0.3).unwrap();
    let b = p.render(1.3).unwrap();
    let last = p.render(3.3).unwrap();
    assert!(
        a.rgba
            .chunks_exact(4)
            .any(|p| p[3] > 0 && p[0] > 100 && p[1] > 70 && p[2] < 20)
    );
    assert_ne!(a.rgba, b.rgba);
    assert_ne!(b.rgba, last.rgba);
    for t in [0.3, 2.4, 1.3, 0.3] {
        let now = p.render(t).unwrap();
        let fresh = plan(
            fixture(),
            "One two three four",
            words(),
            Presentation::default(),
        )
        .render(t)
        .unwrap();
        assert_eq!(now.rgba, fresh.rgba);
        assert_eq!(now.fingerprint, fresh.fingerprint);
    }
    assert!(p.render(4.0).unwrap().rgba.iter().all(|p| *p == 0));
}
#[test]
fn missing_word_times_do_not_create_spoken_highlights() {
    let mut p = plan(fixture(), "One two", vec![], Presentation::default());
    assert!(
        p.diagnostics
            .iter()
            .any(|d| d.code == "CAPTION_TIMING_UNAVAILABLE")
    );
    let frame = p.render(0.4).unwrap();
    assert!(frame.rgba.chunks_exact(4).any(|p| p[3] > 0));
    assert!(
        !frame
            .rgba
            .chunks_exact(4)
            .any(|p| p[3] > 100 && p[0] > 100 && p[1] > 70 && p[2] < 20)
    );
}
#[test]
fn parameter_override_and_continuous_expression_change_actual_frames() {
    let mut body = fixture();
    body["scene"]["value"]["animations"].as_array_mut().unwrap().push(json!({"id":"drift","target":{"nodeId":"caption"},"property":"transform.x","composite":"add","value":{"kind":"expression","expression":{"op":"call","function":"mix","args":[{"op":"literal","type":"length","value":-20},{"op":"literal","type":"length","value":20},{"op":"read","path":"time.clampedProgress"}]}}}));
    let mut p = Presentation::default();
    p.parameters.insert("accent".into(), json!("#00FF00"));
    let mut plan = plan(body, "One two three four", words(), p);
    let a = plan.render(0.3).unwrap();
    assert!(
        a.rgba
            .chunks_exact(4)
            .any(|p| p[3] > 100 && p[1] > 100 && p[0] < 10)
    );
    assert_ne!(a.rgba, plan.render(0.7).unwrap().rgba);
}
#[test]
fn multilingual_clusters_and_repeat_geometry_survive_random_access() {
    let mut body = fixture();
    body["scene"]["value"]["nodes"].as_array_mut().unwrap().insert(0,json!({"id":"boxes","type":"repeat","selectorId":"words","children":[{"id":"plate","type":"shape","properties":{"fill":{"kind":"constant","value":"#123456"},"radius":{"kind":"constant","value":2}}}]}));
    for text in [
        "你好 世界",
        "office e\u{301}",
        "العربية جميلة",
        "हिन्दी भाषा",
        "ภาษาไทย",
    ] {
        let mut p = plan(body.clone(), text, vec![], Presentation::default());
        let a = p.render(0.4).unwrap();
        p.render(3.2).unwrap();
        assert_eq!(a.rgba, p.render(0.4).unwrap().rgba);
        assert!(a.rgba.chunks_exact(4).any(|p| p[3] > 0));
    }
}

#[test]
fn repeated_word_shapes_use_measured_bounds_and_hits_follow_transforms() {
    let mut body = fixture();
    body["scene"]["value"]["nodes"][0]["properties"] =
        json!({"transform.x":{"kind":"constant","value":10}});
    let mut p = plan(body, "One two", vec![], Presentation::default());
    let shifted = p.render(0.3).unwrap();
    let normal = plan(fixture(), "One two", vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    assert!((shifted.hits[0].bounds.x - normal.hits[0].bounds.x - 10.0).abs() < 0.001);
    assert_eq!(shifted.hits[0].bounds.width, normal.hits[0].bounds.width);
}

#[test]
fn state_styles_preserve_whole_source_words_and_zero_time_words() {
    let mut body = fixture();
    body["scene"]["value"]["animations"] = json!([]);
    body["scene"]["value"]["nodes"][0]["stateStyles"] =
        json!({"unit":"word","active":{"fill":"#00FF00"}});
    let words = vec![
        SceneWord {
            id: "first".into(),
            text: "你好".into(),
            start: 0.0,
            end: 1.0,
        },
        SceneWord {
            id: "last".into(),
            text: "世界".into(),
            start: 1.5,
            end: 1.5,
        },
    ];
    let mut p = plan(body, "你好 世界", words, Presentation::default());
    let one = p.render(0.3).unwrap();
    let gap = p.render(1.2).unwrap();
    assert_eq!(one.rgba, gap.rgba); // explicit hold-previous
    assert!(
        one.rgba
            .chunks_exact(4)
            .any(|p| p[1] > 100 && p[0] < 10 && p[3] > 100)
    );
    assert_eq!(p.render(1.5).unwrap().rgba, p.render(1.5).unwrap().rgba);
}

#[test]
fn unsupported_resources_and_invalid_instance_parameters_are_not_silent() {
    let mut body = fixture();
    body["scene"]["value"]["resources"] = json!([{"id":"image"}]);
    assert!(parse_style(&body).is_err());
    let style = parse_style(&fixture()).unwrap();
    let mut p = Presentation::default();
    p.parameters.insert("unknown".into(), json!(3));
    assert!(validate_presentation(&p, Some(style.scene())).is_err());
}

#[test]
fn layout_parameters_are_resolved_before_shaping_with_occurrence_precedence() {
    let mut body = fixture();
    body["scene"]["value"]["parameters"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"size","type":"scalar","default":1,"min":0.5,"max":2}));
    body["scene"]["value"]["nodes"][0]["style"]["fontSize"]["parameter"] = json!("size");
    let base = plan(body.clone(), "One two", vec![], Presentation::default())
        .render(0.4)
        .unwrap();
    let mut p = Presentation::default();
    p.cue_overrides = serde_json::from_value(json!([
        {"cueId":"cue","occurrenceId":"occurrence","parameters":{"size":1.5}},
        {"cueId":"cue","parameters":{"size":0.5}}
    ]))
    .unwrap();
    let larger = plan(body, "One two", vec![], p).render(0.4).unwrap();
    assert!(larger.hits[0].bounds.width > base.hits[0].bounds.width * 1.4);
}

fn png_resource() -> (Vec<u8>, String) {
    use sha2::{Digest, Sha256};
    let mut png = tiny_skia::Pixmap::new(2, 1).unwrap();
    png.data_mut()
        .copy_from_slice(&[255, 0, 0, 255, 0, 0, 128, 128]);
    let bytes = png.encode_png().unwrap();
    let hash = format!(
        "sha256:{}",
        Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    (bytes, hash)
}
fn image_style(hash: &str) -> Value {
    let mut body = fixture();
    body["scene"]["value"]["animations"] = json!([]);
    body["scene"]["value"]["resources"] =
        json!([{"id":"badge","assetRef":{"id":"asset_badge","revision":"r1"},"contentHash":hash}]);
    body["scene"]["value"]["nodes"].as_array_mut().unwrap().push(json!({"id":"icon","type":"image","resourceId":"badge","fit":"cover","properties":{"width":{"kind":"constant","value":24},"height":{"kind":"constant","value":16},"transform.y":{"kind":"constant","value":-20}}}));
    body
}
#[test]
fn frozen_png_images_validate_bytes_and_render_on_random_seek() {
    let (bytes, hash) = png_resource();
    let mut p = plan(
        image_style(&hash),
        "One two",
        vec![],
        Presentation::default(),
    );
    assert!(
        p.render(0.3)
            .err()
            .unwrap()
            .to_string()
            .contains("CAPTION_RESOURCE_MISSING")
    );
    assert!(
        p.load_resources(|_| Some(vec![1, 2, 3]))
            .unwrap_err()
            .to_string()
            .contains("CAPTION_RESOURCE_DIGEST")
    );
    p.load_resources(|_| Some(bytes.clone())).unwrap();
    let frame = p.render(0.3).unwrap();
    assert!(
        frame
            .rgba
            .chunks_exact(4)
            .any(|p| p[0] > 200 && p[1] == 0 && p[2] == 0)
    );
    p.render(2.0).unwrap();
    assert_eq!(frame.rgba, p.render(0.3).unwrap().rgba);
}
#[test]
fn ordered_gradient_and_stroke_keep_native_text_geometry() {
    let mut body = fixture();
    body["scene"]["value"]["animations"] = json!([]);
    body["scene"]["value"]["nodes"][0]["style"]["paints"] = json!([
        {"id":"outline","strokeWidth":2,"paint":{"kind":"solid","color":"#000000"}},
        {"id":"gradient","paint":{"kind":"linear","from":[0,0],"to":[1,0],"stops":[{"at":0,"color":"#FF0000"},{"at":1,"color":"#0000FF"}]}}
    ]);
    let mut p = plan(body, "One two", vec![], Presentation::default());
    let frame = p.render(0.3).unwrap();
    assert!(frame.rgba.chunks_exact(4).any(|p| p[0] > p[2] && p[0] > 40));
    assert!(frame.rgba.chunks_exact(4).any(|p| p[2] > p[0] && p[2] > 40));
    assert_eq!(frame.rgba, p.render(0.3).unwrap().rgba);
}

#[test]
fn png_dimension_overflow_is_rejected_before_decode() {
    use sha2::{Digest, Sha256};
    let (mut bytes, _) = png_resource();
    bytes[16..20].copy_from_slice(&u32::MAX.to_be_bytes());
    bytes[20..24].copy_from_slice(&u32::MAX.to_be_bytes());
    let hash = format!(
        "sha256:{}",
        Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    let mut p = plan(image_style(&hash), "One", vec![], Presentation::default());
    assert!(
        p.load_resources(|_| Some(bytes.clone()))
            .unwrap_err()
            .to_string()
            .contains("CAPTION_BUDGET_EXCEEDED")
    );
}

fn sampled_style() -> Value {
    let mut body = fixture();
    let scene = &mut body["scene"]["value"];
    scene["animations"] = json!([]);
    scene["layout"]["layoutEvaluation"] = json!("per-sample");
    scene["layout"]["overflow"] = json!("visible");
    scene["layout"]["bindings"] = json!([
        {"property":"width","value":{"kind":"expression","expression":{"op":"call","function":"mix","args":[{"op":"literal","type":"length","value":120},{"op":"literal","type":"length","value":40},{"op":"read","path":"time.clampedProgress"}]}}},
        {"nodeId":"caption","property":"fontSize","value":{"kind":"expression","expression":{"op":"call","function":"mix","args":[{"op":"literal","type":"length","value":14},{"op":"literal","type":"length","value":24},{"op":"read","path":"time.clampedProgress"}]}}}
    ]);
    body
}
#[test]
fn sampled_layout_reflows_without_reassigning_pages_and_updates_hits() {
    let body = sampled_style();
    let mut p = plan(
        body.clone(),
        "One two three four",
        words(),
        Presentation::default(),
    );
    let early = p.render(0.1).unwrap();
    let later = p.render(2.5).unwrap();
    assert_ne!(early.rgba, later.rgba);
    assert!(later.hits.len() > early.hits.len());
    for t in [2.5, 0.1, 3.3, 1.23, 3.3] {
        let actual = p.render(t).unwrap();
        let expected = plan(
            body.clone(),
            "One two three four",
            words(),
            Presentation::default(),
        )
        .render(t)
        .unwrap();
        assert_eq!(actual.rgba, expected.rgba);
        assert_eq!(actual.fingerprint, expected.fingerprint);
    }
    let last = p.render(3.3).unwrap();
    assert!(!last.hits.is_empty());
    assert!(last.hits.len() < later.hits.len());
}
#[test]
fn sampled_layout_overflow_is_explicit() {
    let mut body = sampled_style();
    body["scene"]["value"]["layout"]["maxLines"] = json!(1);
    body["scene"]["value"]["layout"]["overflow"] = json!("error");
    let mut p = plan(body, "One two three", vec![], Presentation::default());
    assert!(
        p.render(2.5)
            .err()
            .unwrap()
            .to_string()
            .contains("CAPTION_LAYOUT_OVERFLOW")
    );
}
#[test]
fn blur_spreads_alpha_preserves_premultiplication_and_zero_is_identity() {
    let mut body = fixture();
    body["scene"]["value"]["animations"] = json!([]);
    let plain = plan(body.clone(), "One", vec![], Presentation::default())
        .render(1.0)
        .unwrap();
    body["scene"]["value"]["materials"] =
        json!([{"kind":"blur","id":"soft","radius":{"kind":"constant","value":2},"passes":2}]);
    let blurred = plan(body.clone(), "One", vec![], Presentation::default())
        .render(1.0)
        .unwrap();
    let count = |f: &SceneFrame| f.rgba.chunks_exact(4).filter(|p| p[3] > 0).count();
    assert!(count(&blurred) > count(&plain));
    assert!(
        blurred
            .rgba
            .chunks_exact(4)
            .all(|p| p[0] <= p[3] && p[1] <= p[3] && p[2] <= p[3])
    );
    body["scene"]["value"]["materials"][0]["radius"]["value"] = json!(0);
    assert_eq!(
        plain.rgba,
        plan(body, "One", vec![], Presentation::default())
            .render(1.0)
            .unwrap()
            .rgba
    );
}
#[test]
fn feedback_is_bounded_seekable_and_uses_historical_layout() {
    let mut body = sampled_style();
    body["scene"]["value"]["materials"] = json!([
        {"kind":"blur","id":"soft","radius":{"kind":"constant","value":1}},
        {"kind":"feedback","id":"trail","samples":3,"step":{"ticks":100,"timescale":1000},"decay":0.6,"offset":[-6,0]}
    ]);
    let mut p = plan(
        body.clone(),
        "One two three four",
        words(),
        Presentation::default(),
    );
    let a = p.render(2.5).unwrap();
    p.render(0.2).unwrap();
    assert_eq!(a.rgba, p.render(2.5).unwrap().rgba);
    assert_eq!(
        a.rgba,
        plan(
            body.clone(),
            "One two three four",
            words(),
            Presentation::default()
        )
        .render(2.5)
        .unwrap()
        .rgba
    );
    assert!(p.render(4.0).unwrap().rgba.iter().all(|x| *x == 0));
    body["scene"]["value"]["materials"] = json!([]);
    let no_trail = plan(body, "One two three four", words(), Presentation::default())
        .render(2.5)
        .unwrap();
    assert_ne!(a.rgba, no_trail.rgba);
}

#[test]
fn material_order_and_page_boundary_history_are_observable() {
    let mut a = sampled_style();
    let blur = json!({"kind":"blur","id":"soft","radius":{"kind":"expression","expression":{"op":"call","function":"mix","args":[{"op":"literal","type":"length","value":0},{"op":"literal","type":"length","value":8},{"op":"read","path":"time.clampedProgress"}]}}});
    let trail = json!({"kind":"feedback","id":"trail","samples":3,"step":{"ticks":250,"timescale":1000},"decay":0.75,"offset":[-8,0]});
    a["scene"]["value"]["materials"] = json!([blur.clone(), trail.clone()]);
    let mut b = a.clone();
    b["scene"]["value"]["materials"] = json!([trail, blur]);
    let first = plan(
        a.clone(),
        "One two three four",
        words(),
        Presentation::default(),
    )
    .render(3.05)
    .unwrap();
    let second = plan(b, "One two three four", words(), Presentation::default())
        .render(3.05)
        .unwrap();
    assert_ne!(first.rgba, second.rgba);
    let mut reused = plan(
        a.clone(),
        "One two three four",
        words(),
        Presentation::default(),
    );
    for t in [3.05, 1.17, 0.02, 2.99, 3.01] {
        let actual = reused.render(t).unwrap();
        let fresh = plan(
            a.clone(),
            "One two three four",
            words(),
            Presentation::default(),
        )
        .render(t)
        .unwrap();
        assert_eq!(actual.rgba, fresh.rgba);
    }
}
#[test]
fn materials_guard_surface_budget_and_dynamic_uniform_ranges() {
    let mut body = fixture();
    body["scene"]["value"]["materials"] = json!([{"kind":"blur","id":"soft","radius":{"kind":"expression","expression":{"op":"literal","type":"length","value":65}}}]);
    let mut p = plan(body.clone(), "One", vec![], Presentation::default());
    assert!(
        p.render(1.0)
            .err()
            .unwrap()
            .to_string()
            .contains("CAPTION_MATERIAL_INVALID")
    );
    body["scene"]["value"]["materials"] = json!([{"kind":"feedback","id":"trail","samples":16,"step":{"ticks":100,"timescale":1000},"decay":0.5,"offset":[256,256]}]);
    let mut p = plan(body, "One", vec![], Presentation::default());
    assert!(
        p.render(1.0)
            .err()
            .unwrap()
            .to_string()
            .contains("CAPTION_BUDGET_EXCEEDED")
    );
}

#[test]
fn blur_uses_transparent_padding_before_canvas_crop() {
    let mut body = fixture();
    body["scene"]["value"]["animations"] = json!([]);
    body["scene"]["value"]["layout"]["x"]["value"] = json!(0);
    body["scene"]["value"]["materials"] =
        json!([{"kind":"blur","id":"soft","radius":{"kind":"constant","value":2},"passes":2}]);
    let edge = plan(body.clone(), "One", vec![], Presentation::default())
        .render(1.0)
        .unwrap();
    body["scene"]["value"]["layout"]["x"]["value"] = json!(8);
    body["scene"]["value"]["layout"]["y"]["value"] = json!(53);
    let mut larger = ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "One".into(),
            start: 0.0,
            end: 4.0,
            words: vec![],
        }],
        (176, 106),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "caption|occurrence".into(),
    )
    .unwrap();
    let large = larger.render(1.0).unwrap();
    let mut cropped = Vec::new();
    for y in 8..98 {
        cropped.extend_from_slice(&large.rgba[(y * 176 + 8) * 4..(y * 176 + 168) * 4]);
    }
    assert_eq!(edge.rgba.as_ref(), &cropped);
}
#[test]
fn feedback_never_samples_another_cues_text_or_parameters() {
    let mut body = fixture();
    let s = &mut body["scene"]["value"];
    s["animations"] = json!([]);
    s["nodes"][0]["properties"] =
        json!({"fill":{"kind":"expression","expression":{"op":"read","path":"params.accent"}}});
    s["materials"] = json!([{"kind":"feedback","id":"tail","samples":3,"step":{"ticks":100,"timescale":1000},"decay":0.8,"offset":[-10,0]}]);
    let presentation:Presentation=serde_json::from_value(json!({"cueOverrides":[{"cueId":"first","parameters":{"accent":"#FF0000"}},{"cueId":"second","parameters":{"accent":"#0000FF"}}]})).unwrap();
    let cues = vec![
        SceneCue {
            id: "first".into(),
            document_id: "doc".into(),
            text: "AAAA".into(),
            start: 0.0,
            end: 1.0,
            words: vec![],
        },
        SceneCue {
            id: "second".into(),
            document_id: "doc".into(),
            text: "BBBB".into(),
            start: 1.0,
            end: 2.0,
            words: vec![],
        },
    ];
    let mut p = ScenePlan::compile(
        parse_style(&body).unwrap(),
        presentation,
        cues,
        (160, 90),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "caption|occurrence".into(),
    )
    .unwrap();
    p.render(0.95).unwrap();
    let next = p.render(1.02).unwrap();
    assert!(next.rgba.chunks_exact(4).any(|p| p[2] > 100));
    assert!(next.rgba.chunks_exact(4).all(|p| p[0] == 0));
}

#[test]
fn global_grapheme_context_and_opt_in_space_decoration_are_seekable() {
    let mut body = fixture();
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"] = json!(["caption-text-context/1"]);
    scene["speechState"]["timingPolicy"] = json!("estimated");
    scene["nodes"][0]["style"]["fill"] = json!("#FFFFFF00");
    scene["animations"] = json!([]);
    scene["selectors"] =
        json!([{"id":"letters","nodeId":"caption","unit":"grapheme","includeWhitespace":true}]);
    scene["nodes"].as_array_mut().unwrap().push(json!({
        "id":"cursor","type":"repeat","selectorId":"letters","children":[{
            "id":"pixel","type":"shape","properties":{"fill":{"kind":"constant","value":"#00FF00"},
                "width":{"kind":"constant","value":5},"height":{"kind":"constant","value":5},
                "opacity":{"kind":"expression","expression":{"op":"if","condition":{
                    "op":"call","function":"and","args":[
                        {"op":"call","function":"eq","args":[{"op":"read","path":"unit.textIndex"},{"op":"literal","type":"scalar","value":1}]},
                        {"op":"call","function":"eq","args":[{"op":"read","path":"unit.textCount"},{"op":"literal","type":"scalar","value":3}]}
                    ]},"then":{"op":"call","function":"div","args":[{"op":"read","path":"time.seconds"},{"op":"read","path":"time.cueDurationSeconds"}]},
                    "else":{"op":"literal","type":"scalar","value":0}}}
            }}]
    }));
    let mut enabled = plan(body.clone(), "A e\u{301}", vec![], Presentation::default());
    let first = enabled.render(1.0).unwrap().rgba;
    assert!(first.chunks_exact(4).any(|p| p[1] > 0 && p[3] > 0));
    assert_ne!(first, enabled.render(3.0).unwrap().rgba);
    assert_eq!(first, enabled.render(1.0).unwrap().rgba);
    body["scene"]["value"]["selectors"][0]["includeWhitespace"] = json!(false);
    assert!(
        plan(body, "A e\u{301}", vec![], Presentation::default())
            .render(1.0)
            .unwrap()
            .rgba
            .iter()
            .all(|p| *p == 0)
    );
}

#[test]
fn wrapped_word_grapheme_decorations_do_not_repeat_on_other_lines() {
    let mut body = fixture();
    let scene = &mut body["scene"]["value"];
    scene["layout"]["width"] = json!({"value":30,"basis":"absolute"});
    scene["layout"]["maxLines"] = json!(32);
    scene["layout"]["overflow"] = json!("visible");
    scene["layout"]["y"] = json!({"value":0,"basis":"absolute"});
    scene["nodes"][0]["style"]["fill"] = json!("#FFFFFF00");
    scene["nodes"][0]["style"]["fontSize"] = json!({"value":8,"basis":"absolute"});
    scene["animations"] = json!([]);
    scene["selectors"] =
        json!([{"id":"letters","nodeId":"caption","unit":"grapheme","includeWhitespace":true}]);
    scene["nodes"].as_array_mut().unwrap().push(json!({"id":"decorations","type":"repeat","selectorId":"letters","children":[{
        "id":"mark","type":"shape","properties":{
            "width":{"kind":"constant","value":2},"height":{"kind":"constant","value":2},
            "fill":{"kind":"constant","value":"#00FF00"},
            "opacity":{"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"eq","args":[{"op":"read","path":"unit.textIndex"},{"op":"literal","type":"scalar","value":0}]},"then":{"op":"literal","type":"scalar","value":1},"else":{"op":"literal","type":"scalar","value":0}}}
        }}]}));
    let pixels = plan(
        body,
        "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz",
        vec![],
        Presentation::default(),
    )
    .render(0.5)
    .unwrap()
    .rgba;
    // Duplicated off-line graphemes used to create a second marker at (0,0).
    assert!(
        pixels
            .chunks_exact(4)
            .take(160 * 2)
            .all(|pixel| pixel[3] == 0)
    );
}

#[test]
fn normalized_internal_and_leading_whitespace_keep_caret_pixels_in_source_position() {
    fn marker(content: &str, index: usize) -> Vec<u8> {
        let mut body = fixture();
        let scene = &mut body["scene"]["value"];
        scene["requiredCapabilities"] =
            json!(["caption-word-line-layout/1", "caption-text-context/1"]);
        scene["layout"]["pagination"] = json!({"wordLinePattern":[[2]]});
        scene["layout"]["maxLines"] = json!(1);
        scene["layout"]["width"] = json!({"value":150,"basis":"absolute"});
        scene["nodes"][0]["style"]["fontSize"] = json!({"value":32,"basis":"absolute"});
        scene["nodes"][0]["style"]["fill"] = json!("#FFFFFF00");
        scene["animations"] = json!([]);
        scene["selectors"] = json!([{"id":"graphemes","nodeId":"caption","unit":"grapheme","includeWhitespace":true}]);
        scene["nodes"].as_array_mut().unwrap().push(json!({"id":"carets","type":"repeat","selectorId":"graphemes","children":[{
            "id":"caret","type":"shape","properties":{"width":{"kind":"constant","value":2},"height":{"kind":"constant","value":4},
            "fill":{"kind":"constant","value":"#00FF00"},"opacity":{"kind":"expression","expression":{"op":"if","condition":{
                "op":"call","function":"eq","args":[{"op":"read","path":"unit.textIndex"},{"op":"literal","type":"scalar","value":index}]},
                "then":{"op":"literal","type":"scalar","value":1},"else":{"op":"literal","type":"scalar","value":0}}}}}]}));
        plan(body, content, vec![], Presentation::default())
            .render(1.0)
            .unwrap()
            .rgba
            .as_ref()
            .clone()
    }
    let left = |pixels: &[u8]| {
        pixels
            .chunks_exact(4)
            .enumerate()
            .filter(|(_, p)| p[3] > 4)
            .map(|(i, _)| i % 160)
            .min()
            .unwrap()
    };
    let first = marker("A\t\tB", 1);
    let second = marker("A\t\tB", 2);
    let b = marker("A\t\tB", 3);
    assert_eq!(
        first, second,
        "both source tabs occupy the same collapsed space"
    );
    assert!(
        left(&second) < left(&b),
        "an internal source space must precede B, not jump to line end"
    );
    let leading0 = marker("  AB", 0);
    let leading1 = marker("  AB", 1);
    let a = marker("  AB", 2);
    assert_eq!(leading0, leading1);
    assert_eq!(
        leading0, a,
        "stripped leading spaces retain the start-of-line caret"
    );
}

#[test]
fn repeated_word_quota_pages_have_identical_static_and_sampled_pixels_without_losing_indentation_or_newlines()
 {
    let source_words = || {
        ["aa", "bb", "aa", "bb"]
            .iter()
            .zip([0.0, 0.8, 2.2, 3.2])
            .enumerate()
            .map(|(i, (text, start))| SceneWord {
                id: format!("w{i}"),
                text: (*text).into(),
                start,
                end: start + 0.3,
            })
            .collect::<Vec<_>>()
    };
    for sampled in [false, true] {
        let mut body = fixture();
        let scene = &mut body["scene"]["value"];
        scene["animations"] = json!([]);
        scene["selectors"] = json!([]);
        scene["layout"]["pagination"] = json!({"maxUnitsPerPage":2});
        scene["layout"]["maxLines"] = json!(4);
        if sampled {
            scene["layout"]["layoutEvaluation"] = json!("per-sample");
            scene["layout"]["bindings"] =
                json!([{"property":"width","value":{"kind":"constant","value":140}}]);
        }
        let plain = plan(body.clone(), "aa bb", vec![], Presentation::default())
            .render(0.2)
            .unwrap()
            .rgba;
        let mut repeated = plan(
            body.clone(),
            "aa bb aa bb",
            source_words(),
            Presentation::default(),
        );
        for t in [0.2, 2.4, 1.9, 3.9, 0.2] {
            assert_eq!(
                repeated.render(t).unwrap().rgba,
                plain,
                "sampled={sampled}, t={t}"
            );
        }
        let mut indented = plan(
            body.clone(),
            "  aa bb aa bb",
            source_words(),
            Presentation::default(),
        );
        let expected_indent = plan(body.clone(), "  aa bb", vec![], Presentation::default())
            .render(0.2)
            .unwrap()
            .rgba;
        assert_eq!(indented.render(0.2).unwrap().rgba, expected_indent);
        assert_ne!(expected_indent, plain);
        assert_eq!(indented.render(2.4).unwrap().rgba, plain);
        let mut newline = plan(
            body.clone(),
            "aa bb\n  aa bb",
            source_words(),
            Presentation::default(),
        );
        let explicit_newline = plan(body, "\n  aa bb", vec![], Presentation::default())
            .render(0.2)
            .unwrap()
            .rgba;
        assert_eq!(
            newline.render(2.4).unwrap().rgba,
            explicit_newline,
            "explicit line break and indentation must survive"
        );
    }
}

fn effects_style(paints: Value, keep_animations: bool) -> Value {
    let mut body = fixture();
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-effects/1"));
    if !keep_animations {
        scene["animations"] = json!([]);
    }
    scene["nodes"][0]["style"]["fill"] = json!("#FFFFFF");
    scene["nodes"][0]["style"]["paints"] = paints;
    body
}
fn premul_pixels(frame: &SceneFrame) -> impl Iterator<Item = &[u8]> {
    frame.rgba.chunks_exact(4).filter(|p| p[3] > 0)
}
#[test]
fn blurred_shadow_is_one_soft_coverage_under_the_node_fill() {
    let paints = json!([
        {"id":"shadow","unit":"em","offset":[0.12,0.12],"blur":0.08,"paint":{"kind":"solid","color":"#FF000080"}},
        {"id":"fill","paint":{"kind":"node-fill"}}
    ]);
    let mut p = plan(
        effects_style(paints, false),
        "One two",
        vec![],
        Presentation::default(),
    );
    let frame = p.render(0.3).unwrap();
    // Pure shadow pixels never exceed the layer alpha, even where glyph shadows overlap.
    let shadow: Vec<&[u8]> = premul_pixels(&frame)
        .filter(|p| p[1] == 0 && p[2] == 0)
        .collect();
    assert!(shadow.len() > 40);
    assert!(
        shadow.iter().all(|p| p[3] <= 0x81),
        "{:?}",
        shadow.iter().map(|p| p[3]).max()
    );
    let levels: std::collections::BTreeSet<u8> = shadow.iter().map(|p| p[3]).collect();
    assert!(
        levels.len() > 16,
        "blur should leave a soft ramp, got {levels:?}"
    );
    assert!(premul_pixels(&frame).any(|p| p == [255, 255, 255, 255]));
    assert_eq!(frame.rgba, p.render(0.3).unwrap().rgba);
}
#[test]
fn spread_outline_is_not_double_blended_between_glyphs() {
    let paints = json!([
        {"id":"edge","unit":"em","spread":0.14,"paint":{"kind":"solid","color":"#00000080"}},
        {"id":"fill","paint":{"kind":"node-fill"}}
    ]);
    let mut p = plan(
        effects_style(paints, false),
        "One two",
        vec![],
        Presentation::default(),
    );
    let frame = p.render(0.3).unwrap();
    let edge: Vec<u8> = premul_pixels(&frame)
        .filter(|p| p[0] == 0)
        .map(|p| p[3])
        .collect();
    assert!(edge.len() > 40);
    assert!(edge.iter().all(|a| *a <= 0x81), "{:?}", edge.iter().max());
    assert!(edge.iter().any(|a| *a >= 0x7F));
}
#[test]
fn node_fill_follows_fill_animation_inside_the_stack() {
    let paints = json!([
        {"id":"outline","unit":"em","strokeWidth":0.12,"paint":{"kind":"solid","color":"#000000"}},
        {"id":"fill","paint":{"kind":"node-fill"}}
    ]);
    let plain = plan(
        effects_style(json!([]), true),
        "One two three four",
        words(),
        Presentation::default(),
    )
    .render(0.3)
    .unwrap();
    let mut p = plan(
        effects_style(paints, true),
        "One two three four",
        words(),
        Presentation::default(),
    );
    let frame = p.render(0.3).unwrap();
    // The animated word colour (not the static white) reaches the node-fill layer.
    let colored = |f: &SceneFrame| {
        premul_pixels(f)
            .filter(|p| p[3] == 255 && (p[0].abs_diff(p[1]) > 60 || p[1].abs_diff(p[2]) > 60))
            .count()
    };
    assert!(colored(&plain) > 0);
    assert!(colored(&frame) > 0);
    assert!(premul_pixels(&frame).any(|p| p == [0, 0, 0, 255]));
}
#[test]
fn legacy_stroke_never_covers_a_neighbouring_fill() {
    let style = |stroke: bool| {
        let mut body = fixture();
        body["scene"]["value"]["animations"] = json!([]);
        let node = &mut body["scene"]["value"]["nodes"][0];
        node["style"]["fill"] = json!("#FFFFFF");
        node["style"]["letterSpacing"] = json!(-0.06);
        if stroke {
            node["style"]["stroke"] = json!({"width":5,"color":"#000000"});
        }
        body
    };
    let white = |stroke: bool| {
        plan(style(stroke), "Oooo wwww", vec![], Presentation::default())
            .render(0.3)
            .unwrap()
            .rgba
            .chunks_exact(4)
            .filter(|p| *p == [255, 255, 255, 255])
            .count()
    };
    assert_eq!(white(true), white(false));
}
#[test]
fn uppercase_transform_lays_out_like_uppercase_source_and_keeps_word_timing() {
    let style = |case: Option<&str>| {
        let mut body = fixture();
        if let Some(case) = case {
            body["scene"]["value"]["requiredCapabilities"]
                .as_array_mut()
                .unwrap()
                .push(json!("caption-text-transform/1"));
            body["scene"]["value"]["nodes"][0]["style"]["textTransform"] = json!(case);
        }
        body
    };
    let timed = |text: &str| {
        text.split(' ')
            .enumerate()
            .map(|(i, t)| SceneWord {
                id: format!("w{i}"),
                text: t.into(),
                start: i as f64,
                end: i as f64 + 0.7,
            })
            .collect::<Vec<_>>()
    };
    let source = "Straße two three four";
    let mapped = "STRASSE TWO THREE FOUR";
    for t in [0.3, 1.4, 3.2] {
        let upper = plan(
            style(Some("uppercase")),
            source,
            timed(source),
            Presentation::default(),
        )
        .render(t)
        .unwrap();
        let expected = plan(style(None), mapped, timed(mapped), Presentation::default())
            .render(t)
            .unwrap();
        assert_eq!(upper.rgba, expected.rgba, "t={t}");
        assert_eq!(upper.hits.len(), expected.hits.len());
    }
    let lower = plan(
        style(Some("lowercase")),
        mapped,
        timed(mapped),
        Presentation::default(),
    )
    .render(0.3)
    .unwrap();
    let plain = plan(
        style(None),
        "strasse two three four",
        timed("strasse two three four"),
        Presentation::default(),
    )
    .render(0.3)
    .unwrap();
    assert_eq!(lower.rgba, plain.rgba);
}

fn coverage_style(paint: Value, blur: f64, coverage: Option<Value>) -> Value {
    let mut layer = json!({"id":"ink","paint":paint,"unit":"px","blur":blur});
    if let Some(coverage) = coverage {
        layer["coverage"] = coverage;
    }
    let mut body = effects_style(json!([layer]), false);
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-coverage/1"));
    body
}

#[test]
fn coverage_brightens_soft_edges_after_blur_without_exceeding_paint_alpha() {
    let render = |coverage| {
        plan(
            coverage_style(json!({"kind":"solid","color":"#FF000080"}), 2.0, coverage),
            "OOO",
            vec![],
            Presentation::default(),
        )
        .render(0.3)
        .unwrap()
    };
    let legacy = render(None);
    let amplified = render(Some(json!({"lo":0,"hi":0.2})));
    let mut brightened_edges = 0;
    for (before, after) in legacy
        .rgba
        .chunks_exact(4)
        .zip(amplified.rgba.chunks_exact(4))
    {
        assert!(
            after[3] <= 128,
            "isolated translucent silhouette exceeded paint alpha: {after:?}"
        );
        assert_eq!(after[1], 0);
        assert_eq!(after[2], 0);
        assert_eq!(after[0], after[3], "red remains premultiplied");
        if before[3] > 3 && before[3] < 50 && after[3] > before[3] + 8 {
            brightened_edges += 1;
        }
    }
    assert!(
        brightened_edges > 40,
        "coverage should brighten actual soft edges, got {brightened_edges}"
    );
    assert!(premul_pixels(&amplified).any(|p| p[3] == 128));
}

#[test]
fn coverage_opacity_is_applied_after_the_transfer_for_solid_and_node_fill() {
    for node_fill in [false, true] {
        let paint = if node_fill {
            json!({"kind":"node-fill"})
        } else {
            json!({"kind":"solid","color":"#00FF0080"})
        };
        let mut body = coverage_style(paint, 2.0, Some(json!({"lo":0.05,"hi":0.2})));
        body["scene"]["value"]["nodes"][0]["style"]["fill"] = json!("#00FF0080");
        let full = plan(body.clone(), "OOO", vec![], Presentation::default())
            .render(0.3)
            .unwrap();
        body["scene"]["value"]["nodes"][0]["properties"] =
            json!({"opacity":{"kind":"constant","value":0.5}});
        let half = plan(body, "OOO", vec![], Presentation::default())
            .render(0.3)
            .unwrap();
        assert!(
            premul_pixels(&full).any(|p| p[3] == 128),
            "node_fill={node_fill}"
        );
        assert!(
            premul_pixels(&half).any(|p| p[3] == 64),
            "node_fill={node_fill}"
        );
        for (full, half) in full.rgba.chunks_exact(4).zip(half.rgba.chunks_exact(4)) {
            assert!(half[3] <= 64);
            assert!(
                (i16::from(full[3]) - 2 * i16::from(half[3])).abs() <= 2,
                "opacity changed coverage shape: node_fill={node_fill}, {full:?}, {half:?}"
            );
            assert_eq!(half[0], 0);
            assert_eq!(half[1], half[3]);
            assert_eq!(half[2], 0);
        }
    }
}

#[test]
fn coverage_zero_paint_or_glyph_alpha_cannot_seed_a_halo() {
    for node_fill in [false, true] {
        let paint = if node_fill {
            json!({"kind":"node-fill"})
        } else {
            json!({"kind":"solid","color":"#FF000000"})
        };
        let mut body = coverage_style(paint, 3.0, Some(json!({"lo":0,"hi":0.01})));
        body["scene"]["value"]["nodes"][0]["style"]["fill"] = json!("#FF000000");
        assert!(
            plan(body, "OOO", vec![], Presentation::default())
                .render(0.3)
                .unwrap()
                .rgba
                .iter()
                .all(|c| *c == 0)
        );
    }
    let mut body = coverage_style(
        json!({"kind":"solid","color":"#FFFFFF"}),
        3.0,
        Some(json!({"lo":0,"hi":0.01})),
    );
    body["scene"]["value"]["nodes"][0]["properties"] =
        json!({"opacity":{"kind":"constant","value":0}});
    assert!(
        plan(body, "OOO", vec![], Presentation::default())
            .render(0.3)
            .unwrap()
            .rgba
            .iter()
            .all(|c| *c == 0)
    );
}

#[test]
fn coverage_identity_and_unused_capability_preserve_legacy_opaque_pixels() {
    for blur in [0.0, 2.0] {
        let paint = json!({"kind":"solid","color":"#FFFFFF"});
        let omitted = coverage_style(paint.clone(), blur, None);
        let old = plan(omitted.clone(), "OOO", vec![], Presentation::default())
            .render(0.3)
            .unwrap();
        let mut unadvertised = omitted;
        unadvertised["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .retain(|c| c != "caption-paint-coverage/1");
        let legacy = plan(unadvertised, "OOO", vec![], Presentation::default())
            .render(0.3)
            .unwrap();
        let identity = plan(
            coverage_style(paint, blur, Some(json!({"lo":0,"hi":1}))),
            "OOO",
            vec![],
            Presentation::default(),
        )
        .render(0.3)
        .unwrap();
        assert_eq!(
            old.rgba, legacy.rgba,
            "declaring an unused capability changed old pixels"
        );
        assert_eq!(
            old.rgba, identity.rgba,
            "identity changed opaque pixels at blur={blur}"
        );
    }
}

#[test]
fn coverage_without_blur_changes_antialiasing_but_does_not_grow_the_silhouette() {
    let paint = json!({"kind":"solid","color":"#FFFFFF"});
    let base = plan(
        coverage_style(paint.clone(), 0.0, None),
        "OOO",
        vec![],
        Presentation::default(),
    )
    .render(0.3)
    .unwrap();
    let remapped = plan(
        coverage_style(paint, 0.0, Some(json!({"lo":0.2,"hi":0.5}))),
        "OOO",
        vec![],
        Presentation::default(),
    )
    .render(0.3)
    .unwrap();
    let mut changed = 0;
    let mut suppressed = 0;
    for (before, after) in base.rgba.chunks_exact(4).zip(remapped.rgba.chunks_exact(4)) {
        if before[3] == 0 {
            assert_eq!(after[3], 0, "zero blur expanded beyond glyph support");
        }
        if before[3] > 0 && before[3] < 45 && after[3] == 0 {
            suppressed += 1;
        }
        if before != after {
            changed += 1;
        }
    }
    assert!(changed > 20);
    assert!(
        suppressed > 10,
        "lo threshold did not remove antialiased edge coverage"
    );
    assert!(premul_pixels(&remapped).any(|p| p == [255, 255, 255, 255]));
}

#[test]
fn coverage_animation_is_seek_deterministic_and_preserves_per_word_paint_runs() {
    let mut body = coverage_style(
        json!({"kind":"node-fill"}),
        2.0,
        Some(json!({"lo":0.03,"hi":0.2})),
    );
    // Preserve the fixture's real word-color and word-scale animation, with no extra fill pass.
    body["scene"]["value"]["animations"] = fixture()["scene"]["value"]["animations"].clone();
    let mut rendered = plan(
        body.clone(),
        "One two three four",
        words(),
        Presentation::default(),
    );
    let first = rendered.render(0.3).unwrap();
    assert!(
        premul_pixels(&first).any(|p| p[3] == 255 && p[0] == 255 && p[1] > 200 && p[2] == 0),
        "animated node fill did not reach remapped layer"
    );
    assert!(
        premul_pixels(&first).any(|p| p == [255, 255, 255, 255]),
        "neighboring word's independent paint was lost"
    );
    assert_ne!(first.rgba, rendered.render(1.3).unwrap().rgba);
    for t in [3.3, 0.3, 2.4, 1.3, 0.3] {
        let frame = rendered.render(t).unwrap();
        let fresh = plan(
            body.clone(),
            "One two three four",
            words(),
            Presentation::default(),
        )
        .render(t)
        .unwrap();
        assert_eq!(frame.rgba, fresh.rgba, "t={t}");
        assert_eq!(frame.fingerprint, fresh.fingerprint, "t={t}");
    }
    assert!(rendered.render(4.0).unwrap().rgba.iter().all(|c| *c == 0));
}

#[test]
fn coverage_composites_overlapping_paint_and_opacity_runs_in_source_order() {
    let mut body = coverage_style(
        json!({"kind":"node-fill"}),
        2.0,
        Some(json!({"lo":0,"hi":0.1})),
    );
    body["scene"]["value"]["animations"] = json!([
        {"id":"overlap","target":{"nodeId":"caption","selectorId":"words"},"property":"transform.x","composite":"replace","value":{"kind":"expression","expression":{"op":"call","function":"sub","args":[{"op":"literal","type":"length","value":70},{"op":"read","path":"layout.x"}]}}},
        {"id":"colors","target":{"nodeId":"caption","selectorId":"words"},"property":"fill","composite":"replace","value":{"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"eq","args":[{"op":"read","path":"unit.index"},{"op":"literal","type":"scalar","value":1}]},"then":{"op":"literal","type":"color","value":"#0000FF"},"else":{"op":"literal","type":"color","value":"#FF0000"}}}},
        {"id":"alpha","target":{"nodeId":"caption","selectorId":"words"},"property":"opacity","composite":"replace","value":{"kind":"constant","value":0.5}}
    ]);
    let frame = plan(body.clone(), "O O O", vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    // Three overlapping 50% runs, red then blue then red, reach alpha 7/8.
    // Equal paints on either side of a different run must remain independent.
    assert!(
        premul_pixels(&frame).any(|p| {
            p[0].abs_diff(160) <= 2
                && p[1] == 0
                && p[2].abs_diff(64) <= 2
                && p[3].abs_diff(224) <= 2
        }),
        "overlapping runs did not retain source-over order"
    );
    assert!(premul_pixels(&frame).all(|p| p[3] <= 225));
    body["scene"]["value"]["animations"][1]["value"] = json!({"kind":"constant","value":"#FF0000"});
    body["scene"]["value"]["animations"][2]["value"] = json!({"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"eq","args":[{"op":"read","path":"unit.index"},{"op":"literal","type":"scalar","value":1}]},"then":{"op":"literal","type":"scalar","value":0.25},"else":{"op":"literal","type":"scalar","value":0.5}}});
    let frame = plan(body, "O O O", vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    // Different glyph opacity is also a run boundary: 1-(1/2*3/4*1/2)=13/16.
    assert!(premul_pixels(&frame).any(|p| p[3].abs_diff(207) <= 2));
    assert!(premul_pixels(&frame).all(|p| p[3] <= 209));
}

#[test]
fn coverage_opaque_gradient_keeps_color_and_distinct_glyph_opacity() {
    let mut body = coverage_style(
        json!({"kind":"linear","from":[0,0],"to":[1,0],"stops":[{"at":0,"color":"#FF0000"},{"at":1,"color":"#0000FF"}]}),
        2.0,
        Some(json!({"lo":0,"hi":0.2})),
    );
    body["scene"]["value"]["animations"] = json!([
        {"id":"separate","target":{"nodeId":"caption","selectorId":"words"},"property":"transform.x","composite":"replace","value":{"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"eq","args":[{"op":"read","path":"unit.index"},{"op":"literal","type":"scalar","value":0}]},"then":{"op":"literal","type":"length","value":-20},"else":{"op":"literal","type":"length","value":20}}}},
        {"id":"alpha","target":{"nodeId":"caption","selectorId":"words"},"property":"opacity","composite":"replace","value":{"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"eq","args":[{"op":"read","path":"unit.index"},{"op":"literal","type":"scalar","value":0}]},"then":{"op":"literal","type":"scalar","value":0.25},"else":{"op":"literal","type":"scalar","value":0.75}}}}
    ]);
    let frame = plan(body, "O O", vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    assert!(premul_pixels(&frame).all(|p| p[..3].iter().all(|c| *c <= p[3])));
    let left: Vec<_> = frame
        .rgba
        .chunks_exact(4)
        .enumerate()
        .filter(|(i, p)| i % 160 < 80 && p[3] > 0)
        .map(|(_, p)| p)
        .collect();
    let right: Vec<_> = frame
        .rgba
        .chunks_exact(4)
        .enumerate()
        .filter(|(i, p)| i % 160 >= 80 && p[3] > 0)
        .map(|(_, p)| p)
        .collect();
    assert_eq!(left.iter().map(|p| p[3]).max(), Some(64));
    assert_eq!(right.iter().map(|p| p[3]).max(), Some(191));
    assert!(
        left.iter().any(|p| p[0] > p[2] + 20),
        "red end of gradient was lost"
    );
    assert!(
        right.iter().any(|p| p[2] > p[0] + 20),
        "blue end of gradient was lost"
    );
    assert!(
        left.iter().chain(&right).any(|p| p[0] > 0 && p[2] > 0),
        "gradient became flat solid paint"
    );
}

#[test]
fn coverage_surface_budget_accumulates_across_runs_before_allocating_the_next_bitmap() {
    let mut body = coverage_style(
        json!({"kind":"solid","color":"#FFFFFF"}),
        0.0,
        Some(json!({"lo":0,"hi":0.2})),
    );
    body["scene"]["value"]["animations"] = json!([
        {"id":"scale","target":{"nodeId":"caption","selectorId":"words"},"property":"transform.scale","composite":"replace","value":{"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"eq","args":[{"op":"read","path":"unit.index"},{"op":"literal","type":"scalar","value":0}]},"then":{"op":"literal","type":"scalar","value":1},"else":{"op":"literal","type":"scalar","value":2000}}}},
        {"id":"alpha","target":{"nodeId":"caption","selectorId":"words"},"property":"opacity","composite":"replace","value":{"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"eq","args":[{"op":"read","path":"unit.index"},{"op":"literal","type":"scalar","value":0}]},"then":{"op":"literal","type":"scalar","value":0.25},"else":{"op":"literal","type":"scalar","value":0.5}}}}
    ]);
    let mut rendered = ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "O O".into(),
            start: 0.0,
            end: 4.0,
            words: vec![],
        }],
        (4094, 4094),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "coverage-budget".into(),
    )
    .unwrap();
    // record allocates no canvas. The first run has a tiny bitmap. The second's
    // clipped zero-blur surface is at most (4094+2)^2 = 16M pixels, so only the
    // cumulative limit can reject it; rejection must happen before allocation.
    let error = match rendered.record(0.3) {
        Ok(_) => panic!("paint run surfaces escaped the cumulative budget"),
        Err(error) => error,
    };
    assert!(
        error
            .to_string()
            .contains("CAPTION_BUDGET_EXCEEDED: paint blur surface"),
        "{error}"
    );
}

#[test]
fn coverage_empty_whitespace_does_not_split_equal_overlapping_outline_runs() {
    let mut body = coverage_style(
        json!({"kind":"node-fill"}),
        2.0,
        Some(json!({"lo":0,"hi":0.1})),
    );
    body["scene"]["value"]["selectors"][0]["unit"] = json!("grapheme");
    body["scene"]["value"]["animations"] = json!([
        {"id":"overlap","target":{"nodeId":"caption","selectorId":"words"},"property":"transform.x","composite":"replace","value":{"kind":"expression","expression":{"op":"call","function":"sub","args":[{"op":"literal","type":"length","value":70},{"op":"read","path":"layout.x"}]}}},
        {"id":"red","target":{"nodeId":"caption","selectorId":"words"},"property":"fill","composite":"replace","value":{"kind":"constant","value":"#FF0000"}},
        {"id":"alpha","target":{"nodeId":"caption","selectorId":"words"},"property":"opacity","composite":"replace","value":{"kind":"constant","value":0.5}}
    ]);
    // The unselected space has the node's white/100% paint, but no outline.
    // It must not split red/50% outlines into two source-over paint runs.
    let spaced = plan(body.clone(), "O O", vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    let joined = plan(body, "OO", vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    assert_eq!(spaced.rgba, joined.rgba);
    assert!(premul_pixels(&spaced).all(|p| p[3] <= 128));
    assert!(premul_pixels(&spaced).any(|p| p == [128, 0, 0, 128]));
}

fn gradient_space_style(space: Option<&str>, from: [f64; 2], to: [f64; 2]) -> Value {
    let mut body = fixture();
    let scene = &mut body["scene"]["value"];
    scene["animations"] = json!([]);
    scene["layout"]["pagination"] = json!({});
    scene["nodes"][0]["style"]["fontSize"] = json!({"value":24,"basis":"absolute"});
    let mut paint = json!({"kind":"linear","from":from,"to":to,"stops":[{"at":0,"color":"#FF0000"},{"at":1,"color":"#0000FF"}]});
    if let Some(space) = space {
        paint["space"] = json!(space);
    }
    scene["nodes"][0]["style"]["paints"] = json!([{"id":"ink","paint":paint}]);
    if space == Some("normalized") {
        scene["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-gradient-space/1"));
    }
    body
}

fn recorded_gradient_fields(body: Value, text: &str, seconds: f64) -> Vec<([f64; 2], [f64; 2])> {
    use render_raster::drawop::{DrawOp, PaintData};
    let (frame, _) = plan(body, text, vec![], Presentation::default())
        .record(seconds)
        .unwrap();
    frame
        .ops
        .iter()
        .filter_map(|op| {
            let (paint, tf) = match op {
                DrawOp::FillPathPaint { paint, tf, .. }
                | DrawOp::StrokePathPaint { paint, tf, .. } => (*paint, tf),
                _ => return None,
            };
            let PaintData::Linear { p0, p1, .. } = &frame.paints[paint as usize] else {
                return None;
            };
            let world = |p: [f32; 2]| {
                [
                    f64::from(tf[0]) * f64::from(p[0])
                        + f64::from(tf[2]) * f64::from(p[1])
                        + f64::from(tf[4]),
                    f64::from(tf[1]) * f64::from(p[0])
                        + f64::from(tf[3]) * f64::from(p[1])
                        + f64::from(tf[5]),
                ]
            };
            Some((world(*p0), world(*p1)))
        })
        .collect()
}

// Recover the existing visual-line domain from an unchanged local diagonal
// paint. This probes recorded layout, rather than deriving font metrics or
// copying the normalized endpoint conversion being tested.
fn recorded_gradient_domains(mut body: Value, text: &str, seconds: f64) -> Vec<[f64; 4]> {
    let domain = body["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]
        .get("domain")
        .cloned();
    body["scene"]["value"]["nodes"][0]["style"]["paints"] = json!([{"id":"probe","paint":{"kind":"linear","from":[0,0],"to":[1,1],"stops":[{"at":0,"color":"#FF0000"},{"at":1,"color":"#0000FF"}]}}]);
    if let Some(domain) = domain {
        body["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["domain"] = domain;
    }
    recorded_gradient_fields(body, text, seconds)
        .into_iter()
        .map(|(p0, p1)| [p0[0], p0[1], p1[0] - p0[0], p1[1] - p0[1]])
        .collect()
}

fn projected_gradient_t(field: ([f64; 2], [f64; 2]), point: [f64; 2]) -> f64 {
    let (p0, p1) = field;
    let d = [p1[0] - p0[0], p1[1] - p0[1]];
    ((point[0] - p0[0]) * d[0] + (point[1] - p0[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1])
}

fn normalized_gradient_t(uv: [f64; 2], from: [f64; 2], to: [f64; 2]) -> f64 {
    let d = [to[0] - from[0], to[1] - from[1]];
    ((uv[0] - from[0]) * d[0] + (uv[1] - from[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1])
}

#[test]
fn normalized_gradient_drawops_project_in_uv_for_each_line_aspect_and_arbitrary_endpoints() {
    for text in ["I", "OOOOOO", "I OOO"] {
        for (from, to) in [
            ([0.0, 0.0], [1.0, 1.0]),
            ([0.2, -0.3], [0.7, 0.8]),
            ([1.4, 0.1], [-0.2, 0.9]),
        ] {
            let body = gradient_space_style(Some("normalized"), from, to);
            let domains = recorded_gradient_domains(body.clone(), text, 0.3);
            let fields = recorded_gradient_fields(body, text, 0.3);
            assert!(!fields.is_empty());
            assert_eq!(fields.len(), domains.len());
            for (field, domain) in fields.into_iter().zip(domains) {
                let [x, y, w, h] = domain;
                assert!(w > 0.0 && h > 0.0);
                for uv in [[0.0, 0.0], [1.0, 1.0], [0.6, 0.1], [-0.3, 0.7], [1.2, 0.4]] {
                    let expected = normalized_gradient_t(uv, from, to);
                    let actual = projected_gradient_t(field, [x + uv[0] * w, y + uv[1] * h]);
                    assert!(
                        (actual - expected).abs() < 0.00002,
                        "text={text}, domain={domain:?}, from={from:?}, to={to:?}, uv={uv:?}: {actual} != {expected}"
                    );
                }
            }
        }
    }
}

#[test]
fn normalized_diagonal_pixels_follow_uv_slope_while_local_keeps_pixel_slope() {
    for text in ["I", "OOOOOO"] {
        let from = [0.0, 0.0];
        let to = [1.0, 1.0];
        let normalized = gradient_space_style(Some("normalized"), from, to);
        let domains = recorded_gradient_domains(normalized.clone(), text, 0.3);
        let [x, y, w, h] = domains[0];
        let normalized_frame = plan(normalized, text, vec![], Presentation::default())
            .render(0.3)
            .unwrap();
        let local = gradient_space_style(None, from, to);
        let local_frame = plan(local.clone(), text, vec![], Presentation::default())
            .render(0.3)
            .unwrap();
        assert_ne!(
            normalized_frame.rgba, local_frame.rgba,
            "non-square line must distinguish the spaces: {text}"
        );
        let local_field = recorded_gradient_fields(local, text, 0.3)[0];
        let at = [x + w, y];
        assert!((projected_gradient_t(local_field, at) - w * w / (w * w + h * h)).abs() < 0.00002);
        assert!((projected_gradient_t(local_field, at) - 0.5).abs() > 0.1);
        let mut checked = 0;
        for (i, p) in normalized_frame
            .rgba
            .chunks_exact(4)
            .enumerate()
            .filter(|(_, p)| p[3] >= 32)
        {
            let uv = [
                ((i % 160) as f64 + 0.5 - x) / w,
                ((i / 160) as f64 + 0.5 - y) / h,
            ];
            let t = normalized_gradient_t(uv, from, to).clamp(0.0, 1.0);
            let expected = [
                ((1.0 - t) * f64::from(p[3])).round() as u8,
                (t * f64::from(p[3])).round() as u8,
            ];
            assert!(
                p[0].abs_diff(expected[0]) <= 3 && p[2].abs_diff(expected[1]) <= 3 && p[1] == 0,
                "text={text}, pixel={i}, uv={uv:?}, rgba={p:?}, expected={expected:?}"
            );
            checked += 1;
        }
        assert!(checked > 10, "no usable glyph samples for {text}");
    }
}

#[test]
fn gradient_space_axis_cases_and_unused_capability_preserve_legacy_pixels() {
    for (from, to) in [([0.2, 0.6], [0.8, 0.6]), ([0.3, -0.2], [0.3, 1.1])] {
        let legacy = gradient_space_style(None, from, to);
        let reference = plan(legacy.clone(), "One two", vec![], Presentation::default())
            .render(0.3)
            .unwrap();
        let explicit = plan(
            gradient_space_style(Some("local"), from, to),
            "One two",
            vec![],
            Presentation::default(),
        )
        .render(0.3)
        .unwrap();
        let normalized = plan(
            gradient_space_style(Some("normalized"), from, to),
            "One two",
            vec![],
            Presentation::default(),
        )
        .render(0.3)
        .unwrap();
        assert_eq!(reference.rgba, explicit.rgba);
        assert_eq!(reference.fingerprint, explicit.fingerprint);
        assert_eq!(
            reference.rgba, normalized.rgba,
            "axis projection must be equivalent"
        );
        let mut advertised = legacy;
        advertised["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-gradient-space/1"));
        let advertised = plan(advertised, "One two", vec![], Presentation::default())
            .render(0.3)
            .unwrap();
        assert_eq!(reference.rgba, advertised.rgba);
        assert_eq!(reference.fingerprint, advertised.fingerprint);
    }
}

#[test]
fn normalized_gradient_alpha_is_applied_after_coverage_and_keeps_continuous_runs() {
    for (space, spread, blur, coverage) in [
        ("local", 2, 0, false),
        ("normalized", 2, 0, false),
        ("local", 2, 0, true),
        ("normalized", 2, 0, true),
        ("local", 0, 2, false),
        ("normalized", 0, 2, false),
        ("local", 0, 2, true),
        ("normalized", 0, 2, true),
    ] {
        let mut body = gradient_space_style(Some(space), [0.0, 0.0], [1.0, 1.0]);
        body["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .extend([
                json!("caption-paint-effects/1"),
                json!("caption-paint-coverage/1"),
            ]);
        let layer = &mut body["scene"]["value"]["nodes"][0]["style"]["paints"][0];
        layer["spread"] = json!(spread);
        layer["blur"] = json!(blur);
        if coverage {
            layer["coverage"] = json!({"lo":0,"hi":0.2});
        }
        body["scene"]["value"]["nodes"][0]["style"]["letterSpacing"] = json!(-0.55);
        body["scene"]["value"]["selectors"][0]["unit"] = json!("grapheme");
        body["scene"]["value"]["animations"] = json!([
            {"id":"alpha","target":{"nodeId":"caption","selectorId":"words"},"property":"opacity","composite":"replace","value":{"kind":"constant","value":0.5}}
        ]);
        // Negative spacing overlaps glyphs without moving their gradient field.
        // Every glyph still samples the same visual-line domain.
        let uniform = plan(body.clone(), "OOO", vec![], Presentation::default())
            .render(0.3)
            .unwrap();
        assert!(
            premul_pixels(&uniform).all(|p| p[3] <= 128 && p[..3].iter().all(|c| *c <= p[3])),
            "space={space}, spread={spread}, blur={blur}, coverage={coverage}, max alpha={:?}",
            premul_pixels(&uniform).map(|p| p[3]).max()
        );
        assert!(
            premul_pixels(&uniform).any(|p| p[3] >= 100 && p[0] > 0 && p[2] > 0),
            "equal overlapping gradients must merge into one 50% coverage run"
        );
        body["scene"]["value"]["animations"][0]["value"] = json!({"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"eq","args":[{"op":"read","path":"unit.index"},{"op":"literal","type":"scalar","value":1}]},"then":{"op":"literal","type":"scalar","value":0.25},"else":{"op":"literal","type":"scalar","value":0.5}}});
        let distinct = plan(body, "OOO", vec![], Presentation::default())
            .render(0.3)
            .unwrap();
        assert!(premul_pixels(&distinct).all(|p| p[3] <= 209 && p[..3].iter().all(|c| *c <= p[3])));
        assert!(
            premul_pixels(&distinct).any(|p| if blur > 0 && !coverage {
                p[3] > 128
            } else {
                p[3].abs_diff(207) <= 2
            }),
            "different opacity must preserve three source-over runs: space={space}, spread={spread}, blur={blur}, coverage={coverage}, max alpha={:?}",
            premul_pixels(&distinct).map(|p| p[3]).max()
        );
    }
    let mut translucent = gradient_space_style(Some("normalized"), [0.0, 0.0], [1.0, 1.0]);
    for stop in translucent["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["stops"]
        .as_array_mut()
        .unwrap()
    {
        let color = stop["color"].as_str().unwrap().to_owned() + "80";
        stop["color"] = json!(color);
    }
    let frame = plan(translucent, "OOOO", vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    assert!(premul_pixels(&frame).all(|p| p[3] <= 128 && p[..3].iter().all(|c| *c <= p[3])));
    assert!(premul_pixels(&frame).any(|p| p[3] == 128 && p[0] > 0 && p[2] > 0));
}

#[test]
fn normalized_multiline_gradient_uses_each_visual_line_domain_and_is_seek_deterministic() {
    let from = [0.15, -0.2];
    let to = [0.85, 1.1];
    let body = gradient_space_style(Some("normalized"), from, to);
    let text = "OO\nOOOOOO";
    let domains = recorded_gradient_domains(body.clone(), text, 0.3);
    let mut lines = Vec::<[f64; 4]>::new();
    for domain in domains {
        if !lines.iter().any(|line| {
            line.iter()
                .zip(domain)
                .all(|(a, b)| (*a - b).abs() < 0.0001)
        }) {
            lines.push(domain);
        }
    }
    assert_eq!(lines.len(), 2);
    assert!((lines[0][2] - lines[1][2]).abs() > 20.0);
    let mut rendered = plan(body.clone(), text, vec![], Presentation::default());
    let first = rendered.render(0.3).unwrap();
    let mut checked = [0; 2];
    for (i, p) in first
        .rgba
        .chunks_exact(4)
        .enumerate()
        .filter(|(_, p)| p[3] >= 32)
    {
        let point = [(i % 160) as f64 + 0.5, (i / 160) as f64 + 0.5];
        let Some((line_index, domain)) = lines
            .iter()
            .enumerate()
            .find(|(_, d)| point[1] >= d[1] && point[1] < d[1] + d[3])
        else {
            continue;
        };
        let uv = [
            (point[0] - domain[0]) / domain[2],
            (point[1] - domain[1]) / domain[3],
        ];
        let t = normalized_gradient_t(uv, from, to).clamp(0.0, 1.0);
        assert!(
            p[0].abs_diff(((1.0 - t) * f64::from(p[3])).round() as u8) <= 3
                && p[2].abs_diff((t * f64::from(p[3])).round() as u8) <= 3,
            "line={line_index}, rgba={p:?}, uv={uv:?}"
        );
        checked[line_index] += 1;
    }
    assert!(checked.iter().all(|count| *count > 20), "{checked:?}");
    for seconds in [3.7, 0.3, 1.2, 4.0, 0.3] {
        let replayed = rendered.render(seconds).unwrap();
        let fresh = plan(body.clone(), text, vec![], Presentation::default())
            .render(seconds)
            .unwrap();
        assert_eq!(replayed.rgba, fresh.rgba, "seek to {seconds}");
        assert_eq!(replayed.fingerprint, fresh.fingerprint, "seek to {seconds}");
    }
    assert_eq!(first.rgba, rendered.render(0.3).unwrap().rgba);
}

fn glyph_gradient_style(from: [f64; 2], to: [f64; 2], outset: f64) -> Value {
    let mut body = gradient_space_style(None, from, to);
    let scene = &mut body["scene"]["value"];
    let paint = &mut scene["nodes"][0]["style"]["paints"][0]["paint"];
    paint["domain"] = json!("glyph");
    if outset != 0.0 {
        paint["glyphOutset"] = json!(outset);
    }
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-gradient-glyph/1"));
    body
}

// A diagonal local paint records each glyph's domain as [x, y, w, h].
fn glyph_gradient_domains(body: Value, text: &str) -> Vec<[f64; 4]> {
    recorded_gradient_fields(body, text, 0.3)
        .into_iter()
        .map(|(p0, p1)| [p0[0], p0[1], p1[0] - p0[0], p1[1] - p0[1]])
        .collect()
}

#[test]
fn glyph_gradient_domain_is_each_glyph_ink_box_grown_by_its_outset() {
    let text = "oI";
    let line = recorded_gradient_domains(
        gradient_space_style(None, [0.0, 0.0], [1.0, 1.0]),
        text,
        0.3,
    );
    let glyphs = glyph_gradient_domains(glyph_gradient_style([0.0, 0.0], [1.0, 1.0], 0.0), text);
    let grown = glyph_gradient_domains(glyph_gradient_style([0.0, 0.0], [1.0, 1.0], 0.4), text);
    assert_eq!((line.len(), glyphs.len(), grown.len()), (2, 2, 2));
    assert!(
        (glyphs[0][3] - glyphs[1][3]).abs() > 2.0,
        "a short and a tall glyph keep their own heights: {glyphs:?}"
    );
    assert!(
        glyphs[0][0] + glyphs[0][2] <= glyphs[1][0] + 0.5,
        "glyph boxes follow their glyph positions"
    );
    for (glyph, line) in glyphs.iter().zip(&line) {
        assert!(glyph[2] > 0.0 && glyph[3] > 0.0);
        assert!(
            glyph[2] < line[2] && glyph[3] <= line[3] + 0.5,
            "{glyph:?} inside {line:?}"
        );
    }
    // 0.4 em of the 24 px font on every side, around the same centre.
    for (glyph, grown) in glyphs.iter().zip(&grown) {
        for axis in 0..2 {
            assert!(
                (grown[axis] - (glyph[axis] - 9.6)).abs() < 0.001,
                "{glyph:?} -> {grown:?}"
            );
            assert!(
                (grown[axis + 2] - (glyph[axis + 2] + 19.2)).abs() < 0.001,
                "{glyph:?} -> {grown:?}"
            );
        }
    }
}

#[test]
fn glyph_gradient_pixels_run_over_each_glyph_and_spread_layers_share_the_domain() {
    let text = "oI";
    let glyphs = glyph_gradient_domains(glyph_gradient_style([0.0, 0.0], [1.0, 1.0], 0.0), text);
    let body = glyph_gradient_style([0.0, 0.0], [0.0, 1.0], 0.0);
    let frame = plan(body.clone(), text, vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    let mut checked = [0; 2];
    for (i, p) in frame
        .rgba
        .chunks_exact(4)
        .enumerate()
        .filter(|(_, p)| p[3] == 255)
    {
        let point = [(i % 160) as f64 + 0.5, (i / 160) as f64 + 0.5];
        let Some(index) = glyphs
            .iter()
            .position(|d| point[0] >= d[0] && point[0] < d[0] + d[2])
        else {
            continue;
        };
        let t = ((point[1] - glyphs[index][1]) / glyphs[index][3]).clamp(0.0, 1.0);
        assert!(
            p[0].abs_diff(((1.0 - t) * 255.0).round() as u8) <= 3
                && p[2].abs_diff((t * 255.0).round() as u8) <= 3,
            "glyph={index}, rgba={p:?}, t={t}"
        );
        checked[index] += 1;
    }
    assert!(checked.iter().all(|count| *count > 10), "{checked:?}");

    let mut halo = body;
    let scene = &mut halo["scene"]["value"];
    let ink = scene["nodes"][0]["style"]["paints"][0].clone();
    let mut spread = ink.clone();
    spread["id"] = json!("halo");
    spread["spread"] = json!(2);
    scene["nodes"][0]["style"]["paints"] = json!([spread, ink]);
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-effects/1"));
    let fields = recorded_gradient_fields(halo, text, 0.3);
    assert_eq!(
        fields.len(),
        6,
        "fill and stroke of the spread, then the fill, per glyph"
    );
    let mut distinct = Vec::<([f64; 2], [f64; 2])>::new();
    for field in fields {
        let same = |a: &([f64; 2], [f64; 2])| {
            a.0.iter()
                .chain(&a.1)
                .zip(field.0.iter().chain(&field.1))
                .all(|(x, y)| (x - y).abs() < 0.0001)
        };
        if !distinct.iter().any(same) {
            distinct.push(field);
        }
    }
    assert_eq!(
        distinct.len(),
        2,
        "one domain per glyph whatever the layer reach"
    );
}

fn assert_normalized_page_pixels(body: Value, text: &str, seconds: f64) -> [f64; 4] {
    let paint = &body["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"];
    let from = [
        paint["from"][0].as_f64().unwrap(),
        paint["from"][1].as_f64().unwrap(),
    ];
    let to = [
        paint["to"][0].as_f64().unwrap(),
        paint["to"][1].as_f64().unwrap(),
    ];
    let domains = recorded_gradient_domains(body.clone(), text, seconds);
    let domain = domains[0];
    assert!(
        domains
            .iter()
            .all(|d| d.iter().zip(domain).all(|(a, b)| (*a - b).abs() < 0.0001)),
        "all glyphs must share one page domain"
    );
    let mut line_probe = body.clone();
    line_probe["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["domain"] =
        json!("line");
    let lines = recorded_gradient_domains(line_probe, text, seconds);
    let x = lines.iter().map(|d| d[0]).fold(f64::INFINITY, f64::min);
    let y = lines.iter().map(|d| d[1]).fold(f64::INFINITY, f64::min);
    let right = lines
        .iter()
        .map(|d| d[0] + d[2])
        .fold(f64::NEG_INFINITY, f64::max);
    let bottom = lines
        .iter()
        .map(|d| d[1] + d[3])
        .fold(f64::NEG_INFINITY, f64::max);
    let expected_domain = [x, y, right - x, bottom - y];
    assert!(
        domain
            .iter()
            .zip(expected_domain)
            .all(|(a, b)| (*a - b).abs() < 0.0001),
        "page domain must equal the union of independently probed legacy line bounds: {domain:?} != {expected_domain:?}"
    );
    let frame = plan(body, text, vec![], Presentation::default())
        .render(seconds)
        .unwrap();
    let mut checked = 0;
    for (i, p) in frame
        .rgba
        .chunks_exact(4)
        .enumerate()
        .filter(|(_, p)| p[3] >= 32)
    {
        let uv = [
            ((i % 160) as f64 + 0.5 - domain[0]) / domain[2],
            ((i / 160) as f64 + 0.5 - domain[1]) / domain[3],
        ];
        let t = normalized_gradient_t(uv, from, to).clamp(0.0, 1.0);
        assert!(
            p[0].abs_diff(((1.0 - t) * f64::from(p[3])).round() as u8) <= 3
                && p[2].abs_diff((t * f64::from(p[3])).round() as u8) <= 3,
            "page pixel={i}, rgba={p:?}, uv={uv:?}"
        );
        checked += 1;
    }
    assert!(checked > 20, "no usable page glyph samples");
    domain
}

#[test]
fn normalized_page_gradient_is_continuous_across_lines_while_line_domain_restarts() {
    let mut page = gradient_space_style(Some("normalized"), [0.0, 0.0], [0.0, 1.0]);
    page["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["domain"] = json!("page");
    let text = "OO\nOOOOOO";
    let page_domain = assert_normalized_page_pixels(page.clone(), text, 0.3);
    let mut line = page.clone();
    line["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["domain"] = json!("line");
    let line_domains = recorded_gradient_domains(line.clone(), text, 0.3);
    let page_fields = recorded_gradient_fields(page.clone(), text, 0.3);
    let line_fields = recorded_gradient_fields(line.clone(), text, 0.3);
    let mut saw_lower_line = false;
    for ((page_field, line_field), domain) in
        page_fields.into_iter().zip(line_fields).zip(line_domains)
    {
        let point = [domain[0] + domain[2] / 2.0, domain[1] + domain[3] / 2.0];
        assert!((projected_gradient_t(line_field, point) - 0.5).abs() < 0.00002);
        if domain[1] > page_domain[1] + page_domain[3] / 3.0 {
            assert!(
                projected_gradient_t(page_field, point) > 0.7,
                "page color must continue into lower line"
            );
            saw_lower_line = true;
        }
    }
    assert!(saw_lower_line);
    let page_frame = plan(page, text, vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    let line_frame = plan(line, text, vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    assert_ne!(page_frame.rgba, line_frame.rgba);
}

#[test]
fn normalized_page_gradient_rebases_each_page_and_tracks_sampled_reflow() {
    let mut paged = gradient_space_style(Some("normalized"), [0.2, -0.1], [0.9, 1.1]);
    paged["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["domain"] = json!("page");
    paged["scene"]["value"]["layout"]["pagination"] = json!({"maxUnitsPerPage":2});
    let text = "OO OO OOO OOO";
    let early = assert_normalized_page_pixels(paged.clone(), text, 0.3);
    let later = assert_normalized_page_pixels(paged.clone(), text, 2.3);
    assert!(
        (early[2] - later[2]).abs() > 20.0,
        "page domains did not follow different page text"
    );
    let mut rendered = plan(paged.clone(), text, vec![], Presentation::default());
    for seconds in [2.3, 0.3, 3.8, 0.3] {
        let actual = rendered.render(seconds).unwrap();
        let fresh = plan(paged.clone(), text, vec![], Presentation::default())
            .render(seconds)
            .unwrap();
        assert_eq!(actual.rgba, fresh.rgba);
        assert_eq!(actual.fingerprint, fresh.fingerprint);
    }
    let mut sampled = paged;
    sampled["scene"]["value"]["layout"]["pagination"] = json!({});
    sampled["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
    sampled["scene"]["value"]["layout"]["overflow"] = json!("visible");
    sampled["scene"]["value"]["layout"]["bindings"] = json!([{"property":"width","value":{"kind":"expression","expression":{"op":"call","function":"mix","args":[{"op":"literal","type":"length","value":140},{"op":"literal","type":"length","value":50},{"op":"read","path":"time.clampedProgress"}]}}}]);
    let text = "OO OO OO";
    let early = assert_normalized_page_pixels(sampled.clone(), text, 0.1);
    let later = assert_normalized_page_pixels(sampled.clone(), text, 3.5);
    assert!(
        (early[2] - later[2]).abs() > 20.0 && later[3] > early[3] * 1.5,
        "reflow did not update page width and height: {early:?} -> {later:?}"
    );
    let mut rendered = plan(sampled.clone(), text, vec![], Presentation::default());
    for seconds in [3.5, 0.1, 2.2, 0.1] {
        let actual = rendered.render(seconds).unwrap();
        let fresh = plan(sampled.clone(), text, vec![], Presentation::default())
            .render(seconds)
            .unwrap();
        assert_eq!(actual.rgba, fresh.rgba);
        assert_eq!(actual.fingerprint, fresh.fingerprint);
    }
}

#[test]
fn normalized_label_page_domain_uses_its_own_single_line_bounds() {
    let mut body = gradient_space_style(Some("normalized"), [0.1, -0.2], [0.9, 1.1]);
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-bound-label/1"));
    scene["selectors"] = json!([{"id":"pages","nodeId":"caption","unit":"page"}]);
    let mut style = scene["nodes"][0]["style"].clone();
    scene["nodes"][0]["style"]["paints"] = json!([]);
    scene["nodes"][0]["style"]["fill"] = json!("#FFFFFF00");
    style["fontSize"] = json!({"value":12,"basis":"absolute"});
    style["paints"][0]["paint"]["domain"] = json!("page");
    scene["nodes"].as_array_mut().unwrap().push(json!({"id":"labels","type":"repeat","selectorId":"pages","children":[{"id":"label","type":"label","text":{"source":"static","text":"LABEL"},"style":style}]}));
    let page = plan(body.clone(), "OO\nOOOOOO", vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    body["scene"]["value"]["nodes"][1]["children"][0]["style"]["paints"][0]["paint"]["domain"] =
        json!("line");
    let line = plan(body, "OO\nOOOOOO", vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    assert!(premul_pixels(&page).any(|p| p[3] > 0 && p[0] > 0 && p[2] > 0));
    assert_eq!(
        page.rgba, line.rgba,
        "label page domain must be the label's own line, rather than bound Text page"
    );
    assert_eq!(page.fingerprint, line.fingerprint);
}

fn font_line_box_style(policy: Option<Value>) -> Value {
    let mut body = gradient_space_style(None, [0.0, 0.0], [1.0, 1.0]);
    let scene = &mut body["scene"]["value"];
    scene["layout"]["maxLines"] = json!(10);
    scene["layout"]["overflow"] = json!("visible");
    scene["nodes"][0]["style"]["fontFamily"] = json!("Arimo");
    scene["nodes"][0]["style"]["fontSize"] = json!({"value":20,"basis":"absolute"});
    scene["nodes"][0]["style"]["lineHeight"] = json!(0.25);
    if let Some(policy) = policy {
        scene["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-font-line-box/1"));
        scene["nodes"][0]["style"]["lineBox"] = policy;
    }
    body
}

fn font_line_box_fonts() -> Vec<Vec<u8>> {
    vec![
        include_bytes!("../../render-raster/assets/fonts/Arimo.ttf").to_vec(),
        include_bytes!("../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").to_vec(),
    ]
}

fn font_line_box_plan(body: Value, content: &str, fonts: Vec<Vec<u8>>) -> ScenePlan {
    ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: content.into(),
            start: 0.0,
            end: 4.0,
            words: vec![],
        }],
        (160, 90),
        TextEngine::with_document_fonts(&fonts),
        "font-line-box".into(),
    )
    .unwrap()
}

// Read persisted SFNT numbers directly: the geometry oracle does not call
// the metric getter or recreate its aggregation algorithm.
fn sfnt_table(font: &[u8], tag: &[u8; 4]) -> usize {
    let count = u16::from_be_bytes(font[4..6].try_into().unwrap()) as usize;
    (0..count)
        .find_map(|i| {
            let row = 12 + i * 16;
            (&font[row..row + 4] == tag)
                .then(|| u32::from_be_bytes(font[row + 8..row + 12].try_into().unwrap()) as usize)
        })
        .unwrap()
}

fn metric_test_font(typo: [f64; 2], hhea: [f64; 2]) -> Vec<u8> {
    let mut font = include_bytes!("../../render-raster/assets/fonts/Arimo.ttf").to_vec();
    let head = sfnt_table(&font, b"head");
    let em = u16::from_be_bytes(font[head + 18..head + 20].try_into().unwrap()) as f64;
    for (tag, offsets, metrics) in [(b"OS/2", [68, 70], typo), (b"hhea", [4, 6], hhea)] {
        let table = sfnt_table(&font, tag);
        for (offset, fraction) in offsets.into_iter().zip(metrics) {
            font[table + offset..table + offset + 2]
                .copy_from_slice(&((fraction * em).round() as i16).to_be_bytes());
        }
    }
    let os2 = sfnt_table(&font, b"OS/2");
    font[os2 + 62..os2 + 64].copy_from_slice(&0_u16.to_be_bytes());
    font
}

fn sfnt_envelope(font: &[u8], tag: &[u8; 4], size: f64) -> [f64; 2] {
    let head = sfnt_table(font, b"head");
    let em = u16::from_be_bytes(font[head + 18..head + 20].try_into().unwrap()) as f64;
    let table = sfnt_table(font, tag);
    let offsets = if tag == b"OS/2" { [68, 70] } else { [4, 6] };
    offsets.map(|offset| {
        i16::from_be_bytes(font[table + offset..table + offset + 2].try_into().unwrap()) as f64
            * size
            / em
    })
}

fn font_line_box_geometry(plan: &mut ScenePlan, seconds: f64) -> Vec<([f64; 4], f64)> {
    use render_raster::drawop::{DrawOp, PaintData};
    let (frame, _) = plan.record(seconds).unwrap();
    frame
        .ops
        .iter()
        .filter_map(|op| {
            let DrawOp::FillPathPaint { paint, tf, .. } = op else {
                return None;
            };
            let PaintData::Linear { p0, p1, .. } = &frame.paints[*paint as usize] else {
                return None;
            };
            let world = |p: &[f32; 2]| {
                [
                    f64::from(tf[0]) * f64::from(p[0])
                        + f64::from(tf[2]) * f64::from(p[1])
                        + f64::from(tf[4]),
                    f64::from(tf[1]) * f64::from(p[0])
                        + f64::from(tf[3]) * f64::from(p[1])
                        + f64::from(tf[5]),
                ]
            };
            let (a, b) = (world(p0), world(p1));
            Some(([a[0], a[1], b[0] - a[0], b[1] - a[1]], f64::from(tf[5])))
        })
        .collect()
}

#[test]
fn font_line_box_omission_and_unused_capability_keep_legacy_pixels_and_fingerprint() {
    for text in ["A A", "A\nA", "A\n\nA"] {
        let body = font_line_box_style(None);
        let reference = font_line_box_plan(body.clone(), text, font_line_box_fonts())
            .render(0.3)
            .unwrap();
        let mut advertised = body;
        advertised["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-font-line-box/1"));
        let unchanged = font_line_box_plan(advertised, text, font_line_box_fonts())
            .render(0.3)
            .unwrap();
        assert_eq!(reference.rgba, unchanged.rgba, "{text:?}");
        assert_eq!(reference.fingerprint, unchanged.fingerprint, "{text:?}");
    }
}

#[test]
fn font_line_box_floors_set_actual_baselines_gradient_domains_and_scale_pivot() {
    let policy = json!({"metricSource":"font","minAscent":1.25,"minDescent":0.35});
    let mut body = font_line_box_style(Some(policy));
    let geometry = font_line_box_geometry(
        &mut font_line_box_plan(body.clone(), "A", font_line_box_fonts()),
        0.3,
    );
    assert_eq!(geometry.len(), 1);
    let (domain, baseline) = geometry[0];
    assert!((domain[1] - 29.0).abs() < 0.0001 && (domain[3] - 32.0).abs() < 0.0001);
    assert!(
        (baseline - 54.0).abs() < 0.0001,
        "baseline must be top + 1.25em ascent: {baseline}"
    );
    let mut leading = body.clone();
    leading["scene"]["value"]["nodes"][0]["style"]["lineHeight"] = json!(2.0);
    let leading = font_line_box_geometry(
        &mut font_line_box_plan(leading, "A", font_line_box_fonts()),
        0.3,
    )[0];
    assert!(
        (leading.0[1] - 25.0).abs() < 0.0001 && (leading.0[3] - 40.0).abs() < 0.0001,
        "explicit em leading must remain a minimum row height"
    );
    assert!(
        (leading.1 - 50.0).abs() < 0.0001,
        "leading must not replace the declared font ascent"
    );
    body["scene"]["value"]["nodes"][0]["properties"] =
        json!({"transform.scale":{"kind":"constant","value":2}});
    let transformed = font_line_box_geometry(
        &mut font_line_box_plan(body, "A", font_line_box_fonts()),
        0.3,
    )[0];
    assert!((transformed.0[1] - 13.0).abs() < 0.0001 && (transformed.0[3] - 64.0).abs() < 0.0001);
    assert!(
        (transformed.1 - 63.0).abs() < 0.0001,
        "scale must pivot at the new row center, y=45"
    );
}

#[test]
fn font_line_box_typographic_numbers_and_explicit_probe_change_the_rendered_row() {
    for (typo, probe, tag) in [
        ([0.65, -0.15], None, b"OS/2"),
        ([0.4, -0.1], None, b"OS/2"),
        ([0.4, -0.1], Some("A"), b"hhea"),
    ] {
        let font = metric_test_font(typo, [0.95, -0.25]);
        let [ascent, descent] = sfnt_envelope(&font, tag, 20.0);
        let mut policy = json!({"metricSource":"typographic"});
        if let Some(probe) = probe {
            policy["fallbackProbe"] = json!(probe);
        }
        let body = font_line_box_style(Some(policy));
        let geometry =
            font_line_box_geometry(&mut font_line_box_plan(body, "A", vec![font]), 0.3)[0];
        let expected_height = ascent - descent;
        assert!(
            (geometry.0[3] - expected_height).abs() < 0.0001,
            "typo={typo:?}, probe={probe:?}, domain={:?}",
            geometry.0
        );
        assert!((geometry.1 - (45.0 - expected_height / 2.0 + ascent)).abs() < 0.0001);
    }
    let font = metric_test_font([0.4, -0.1], [0.95, -0.25]);
    let native = font_line_box_style(Some(json!({"metricSource":"font"})));
    let [ascent, descent] = sfnt_envelope(&font, b"hhea", 20.0);
    let native = font_line_box_geometry(&mut font_line_box_plan(native, "A", vec![font]), 0.3)[0];
    assert!((native.0[3] - (ascent - descent)).abs() < 0.0001);
}

#[test]
fn font_line_box_fixed_rows_blank_rows_and_sampled_reflow_use_the_same_envelope() {
    let mut ordinary = font_line_box_style(Some(json!({"minAscent":1.25,"minDescent":0.35})));
    let mut fixed = ordinary.clone();
    fixed["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-word-line-layout/1"));
    fixed["scene"]["value"]["layout"]["pagination"] = json!({"wordLinePattern":[[1,1]]});
    for body in [ordinary.clone(), fixed] {
        let rows = font_line_box_geometry(
            &mut font_line_box_plan(body, "A\nA", font_line_box_fonts()),
            0.3,
        );
        assert_eq!(rows.len(), 2);
        for ((domain, baseline), top) in rows.into_iter().zip([13.0, 45.0]) {
            assert!((domain[1] - top).abs() < 0.0001 && (domain[3] - 32.0).abs() < 0.0001);
            assert!((baseline - top - 25.0).abs() < 0.0001);
        }
    }
    let blank = font_line_box_geometry(
        &mut font_line_box_plan(ordinary.clone(), "A\n\nA", font_line_box_fonts()),
        0.3,
    );
    assert_eq!(
        blank.len(),
        2,
        "blank row must not invent a displayed glyph"
    );
    assert!(
        (blank[1].0[1] - blank[0].0[1] - 64.0).abs() < 0.0001,
        "blank row must reserve the same 32px font envelope"
    );
    ordinary["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
    let text = "A\n\nA";
    let static_frame = font_line_box_plan(
        font_line_box_style(Some(json!({"minAscent":1.25,"minDescent":0.35}))),
        text,
        font_line_box_fonts(),
    )
    .render(0.3)
    .unwrap();
    let mut rendered = font_line_box_plan(ordinary.clone(), text, font_line_box_fonts());
    assert_eq!(
        static_frame.rgba,
        rendered.render(0.3).unwrap().rgba,
        "constant sampled layout must preserve the static font box"
    );
    ordinary["scene"]["value"]["layout"]["bindings"] = json!([{"nodeId":"caption","property":"fontSize","value":{"kind":"expression","expression":{"op":"call","function":"mix","args":[{"op":"literal","type":"length","value":10},{"op":"literal","type":"length","value":20},{"op":"read","path":"time.clampedProgress"}]}}}]);
    let mut rendered = font_line_box_plan(ordinary.clone(), "A", font_line_box_fonts());
    for seconds in [3.6, 0.4, 2.0, 0.4] {
        let size = 10.0 + seconds * 2.5;
        let (domain, baseline) = font_line_box_geometry(&mut rendered, seconds)[0];
        assert!((domain[3] - size * 1.6).abs() < 0.0001);
        assert!((baseline - (45.0 - size * 0.8 + size * 1.25)).abs() < 0.0001);
        let actual = rendered.render(seconds).unwrap();
        let fresh = font_line_box_plan(ordinary.clone(), "A", font_line_box_fonts())
            .render(seconds)
            .unwrap();
        assert_eq!(actual.rgba, fresh.rgba);
        assert_eq!(actual.fingerprint, fresh.fingerprint);
    }
}

#[test]
fn font_line_box_rich_runs_use_each_actual_face_and_size_on_every_seek() {
    let arimo = metric_test_font([0.6, -0.2], [0.95, -0.25]);
    let noto = include_bytes!("../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").to_vec();
    let noto_os2 = sfnt_table(&noto, b"OS/2");
    let flags = u16::from_be_bytes(noto[noto_os2 + 62..noto_os2 + 64].try_into().unwrap());
    let noto_table = if flags & 128 != 0 { b"OS/2" } else { b"hhea" };
    let mut body = font_line_box_style(Some(json!({"minAscent":0.7,"minDescent":0.2})));
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([
            json!("caption-word-line-layout/1"),
            json!("caption-unit-font-size/1"),
            json!("caption-unit-font-style/1"),
        ]);
    scene["layout"]["pagination"] = json!({"wordLinePattern":[[3]]});
    scene["layout"]["layoutEvaluation"] = json!("per-sample");
    scene["selectors"] = json!([
        {"id":"first","nodeId":"caption","unit":"word","filter":{"kind":"range","start":0,"end":1}},
        {"id":"second","nodeId":"caption","unit":"word","filter":{"kind":"range","start":1,"end":2}}
    ]);
    scene["layout"]["fontSizeBindings"] = json!([
        {"id":"first-size","nodeId":"caption","selectorId":"first","value":{"kind":"expression","expression":{"op":"call","function":"mix","args":[{"op":"literal","type":"length","value":20},{"op":"literal","type":"length","value":36},{"op":"call","function":"div","args":[{"op":"read","path":"time.seconds"},{"op":"read","path":"time.cueDurationSeconds"}]}]}}},
        {"id":"second-size","nodeId":"caption","selectorId":"second","value":{"kind":"constant","value":28}}
    ]);
    scene["layout"]["fontStyleBindings"] = json!([
        {"id":"first-face","nodeId":"caption","selectorId":"first","style":{"fontFamily":"Arimo","fontWeight":700}},
        {"id":"second-face","nodeId":"caption","selectorId":"second","style":{"fontFamily":"Noto Sans SC","fontWeight":600}}
    ]);
    let text = "A 漢 A";
    let mut rendered = font_line_box_plan(body.clone(), text, vec![arimo.clone(), noto.clone()]);
    let mut heights = Vec::new();
    for seconds in [0.0, 3.9, 0.0, 2.0] {
        // The binding explicitly uses the cue clock despite missing word times.
        // Compare the requested sizes against independent persisted font data.
        let (frame, _) = rendered.record(seconds).unwrap();
        let mut sizes = Vec::new();
        for op in &frame.ops {
            if let render_raster::drawop::DrawOp::FillPathPaint { tf, .. } = op {
                // Distinct outlines remain real; this must not collapse the
                // three requested words into one font or lose the CJK glyph.
                sizes.push(tf[4]);
            }
        }
        assert_eq!(sizes.len(), 3);
        let first_size = 20.0 + seconds * 4.0;
        let a = sfnt_envelope(&arimo, b"hhea", first_size);
        let n = sfnt_envelope(&noto, noto_table, 28.0);
        let max_size = first_size.max(28.0);
        let up = a[0].max(n[0]).max(0.7 * max_size);
        let down = (-a[1]).max(-n[1]).max(0.2 * max_size);
        let geometry = font_line_box_geometry(&mut rendered, seconds);
        for (domain, baseline) in &geometry {
            assert!(
                (domain[3] - up - down).abs() < 0.0002,
                "seconds={seconds}, domain={domain:?}, envelope={up}/{down}"
            );
            assert!((*baseline - (45.0 - (up + down) / 2.0 + up)).abs() < 0.0002);
        }
        heights.push(geometry[0].0[3]);
        let actual = rendered.render(seconds).unwrap();
        let fresh = font_line_box_plan(body.clone(), text, vec![arimo.clone(), noto.clone()])
            .render(seconds)
            .unwrap();
        assert_eq!(actual.rgba, fresh.rgba);
        assert_eq!(actual.fingerprint, fresh.fingerprint);
    }
    assert_ne!(heights[0], heights[1]);
    assert_eq!(heights[0], heights[2]);
}

#[test]
fn font_line_box_label_keeps_own_gradient_domain_while_dynamic_size_uses_bound_clock() {
    let mut body = font_line_box_style(Some(json!({"minAscent":1.25,"minDescent":0.35})));
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([
            json!("caption-bound-label/1"),
            json!("caption-gradient-space/1"),
        ]);
    scene["selectors"] = json!([{"id":"pages","nodeId":"caption","unit":"page"}]);
    let mut style = scene["nodes"][0]["style"].clone();
    scene["nodes"][0]["style"]["paints"] = json!([]);
    scene["nodes"][0]["style"]["fill"] = json!("#FFFFFF00");
    style["paints"][0]["paint"]["domain"] = json!("page");
    scene["nodes"].as_array_mut().unwrap().push(json!({"id":"labels","type":"repeat","selectorId":"pages","children":[{"id":"label","type":"label","text":{"source":"static","text":"AA"},"style":style,"properties":{"fontSize":{"kind":"expression","expression":{"op":"call","function":"mix","args":[{"op":"literal","type":"length","value":10},{"op":"literal","type":"length","value":20},{"op":"read","path":"time.clampedProgress"}]}}}}]}));
    let mut rendered = font_line_box_plan(body.clone(), "A\nA", font_line_box_fonts());
    for seconds in [3.6, 0.4, 2.0, 0.4] {
        let size = 10.0 + seconds * 2.5;
        let geometry = font_line_box_geometry(&mut rendered, seconds);
        assert_eq!(geometry.len(), 2);
        for (domain, baseline) in geometry {
            assert!(
                (domain[1] - (45.0 - size * 0.8)).abs() < 0.0001
                    && (domain[3] - size * 1.6).abs() < 0.0001
            );
            assert!((baseline - (45.0 + size * 0.45)).abs() < 0.0001);
        }
        let actual = rendered.render(seconds).unwrap();
        let fresh = font_line_box_plan(body.clone(), "A\nA", font_line_box_fonts())
            .render(seconds)
            .unwrap();
        assert_eq!(actual.rgba, fresh.rgba);
        assert_eq!(actual.fingerprint, fresh.fingerprint);
    }
}

#[test]
fn font_line_box_metric_work_is_bounded_even_for_cached_repeated_labels() {
    let mut body = font_line_box_style(None);
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-bound-label/1"));
    let mut style = scene["nodes"][0]["style"].clone();
    style["fontSize"] = json!({"value":1,"basis":"absolute"});
    scene["nodes"][0]["style"]["paints"] = json!([]);
    scene["nodes"][0]["style"]["fill"] = json!("#FFFFFF00");
    scene["nodes"].as_array_mut().unwrap().push(json!({"id":"labels","type":"repeat","selectorId":"words","children":[{"id":"label","type":"label","text":{"source":"static","text":"x".repeat(3400)},"style":style}]}));
    let mut legacy = font_line_box_plan(body.clone(), "A A A A", font_line_box_fonts());
    assert!(
        legacy.record(0.3).is_ok(),
        "control label work should fit below the budget"
    );
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-font-line-box/1"));
    body["scene"]["value"]["nodes"][1]["children"][0]["style"]["lineBox"] =
        json!({"minAscent":1.25,"minDescent":0.35});
    let mut bounded = font_line_box_plan(body, "A A A A", font_line_box_fonts());
    for _ in 0..2 {
        let error = bounded
            .record(0.3)
            .err()
            .expect("metric reads must consume the shared frame budget on cold and warm caches");
        assert!(
            error.to_string().contains("CAPTION_BUDGET_EXCEEDED"),
            "{error}"
        );
    }
}

#[test]
fn font_line_box_preserves_fixed_page_input_clocks_and_rebases_new_wrapped_rows() {
    let mut paged = font_line_box_style(Some(json!({"minAscent":1.25,"minDescent":0.35})));
    paged["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([
            json!("caption-word-line-layout/1"),
            json!("caption-unit-context/1"),
        ]);
    paged["scene"]["value"]["layout"]["pagination"] = json!({"wordLinePattern":[[2]]});
    paged["scene"]["value"]["nodes"][0]["properties"] = json!({"opacity":{"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"lt","args":[{"op":"read","path":"time.pageElapsedSeconds"},{"op":"literal","type":"time","value":0.4}]},"then":{"op":"literal","type":"scalar","value":1},"else":{"op":"literal","type":"scalar","value":0}}}});
    let mut legacy = paged.clone();
    legacy["scene"]["value"]["nodes"][0]["style"]
        .as_object_mut()
        .unwrap()
        .remove("lineBox");
    let text = "One two three four";
    let mut rendered = plan(paged.clone(), text, words(), Presentation::default());
    let mut reference = plan(legacy, text, words(), Presentation::default());
    let mut page_widths = Vec::new();
    for (seconds, visible) in [
        (0.1, true),
        (0.8, false),
        (2.1, true),
        (2.8, false),
        (0.1, true),
    ] {
        let actual = rendered.render(seconds).unwrap();
        let old = reference.render(seconds).unwrap();
        assert_eq!(premul_pixels(&actual).any(|p| p[3] > 0), visible);
        assert_eq!(premul_pixels(&old).any(|p| p[3] > 0), visible);
        if visible {
            assert_eq!(actual.hits.len(), 1);
            assert_eq!(old.hits.len(), 1);
            assert_eq!(
                actual.hits[0].bounds.width, old.hits[0].bounds.width,
                "line sizing must not reassign source words"
            );
            page_widths.push(actual.hits[0].bounds.width);
        }
        let fresh = plan(paged.clone(), text, words(), Presentation::default())
            .render(seconds)
            .unwrap();
        assert_eq!(actual.rgba, fresh.rgba);
        assert_eq!(actual.fingerprint, fresh.fingerprint);
    }
    assert_ne!(page_widths[0], page_widths[1]);
    assert_eq!(page_widths[0], page_widths[2]);
    let mut reflow = font_line_box_style(Some(json!({"minAscent":1.25,"minDescent":0.35})));
    reflow["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
    reflow["scene"]["value"]["layout"]["bindings"] = json!([{"property":"width","value":{"kind":"expression","expression":{"op":"call","function":"mix","args":[{"op":"literal","type":"length","value":140},{"op":"literal","type":"length","value":45},{"op":"read","path":"time.clampedProgress"}]}}}]);
    let mut rendered = font_line_box_plan(reflow.clone(), "OO OO OO", font_line_box_fonts());
    for (seconds, expected_rows) in [(0.1, 1), (3.6, 3), (0.1, 1)] {
        let geometry = font_line_box_geometry(&mut rendered, seconds);
        assert_eq!(
            geometry.len(),
            6,
            "rewrapping must preserve every displayed glyph"
        );
        let mut tops = Vec::<f64>::new();
        for (domain, baseline) in geometry {
            assert!(
                (domain[3] - 32.0).abs() < 0.0001 && (baseline - domain[1] - 25.0).abs() < 0.0001
            );
            if !tops.iter().any(|y| (*y - domain[1]).abs() < 0.0001) {
                tops.push(domain[1]);
            }
        }
        assert_eq!(tops.len(), expected_rows);
        let actual = rendered.render(seconds).unwrap();
        let fresh = font_line_box_plan(reflow.clone(), "OO OO OO", font_line_box_fonts())
            .render(seconds)
            .unwrap();
        assert_eq!(actual.rgba, fresh.rgba);
        assert_eq!(actual.fingerprint, fresh.fingerprint);
    }
}

fn affine_domain(rect: [f64; 4]) -> Value {
    json!({
        "x":{"kind":"constant","value":rect[0]},
        "y":{"kind":"constant","value":rect[1]},
        "width":{"kind":"constant","value":rect[2]},
        "height":{"kind":"constant","value":rect[3]}
    })
}

fn affine_material(input: [f64; 4], output: [f64; 4], transforms: &[[f64; 6]]) -> Value {
    let transforms: Vec<Value> = transforms
        .iter()
        .map(|matrix| {
            json!(
                matrix
                    .iter()
                    .map(|value| json!({"kind":"constant","value":value}))
                    .collect::<Vec<_>>()
            )
        })
        .collect();
    json!({
        "kind":"affine-sample-blend","id":"path","contextNodeId":"caption",
        "sampling":{"input":affine_domain(input),"output":affine_domain(output)},
        "transforms":transforms,"sampleRange":[5,5],"distanceRange":[0,1],
        "boundary":"transparent"
    })
}

fn affine_style() -> Value {
    let mut body: Value = serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/gaussian-axis.json"
    ))
    .unwrap();
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-affine-sample-blend/1"));
    scene["materials"] = json!([]);
    body
}

fn affine_scene_dense_sample(
    bytes: &[u8],
    width: usize,
    view: [usize; 4],
    uv: [f64; 2],
) -> [f64; 4] {
    let x = (view[0] as f64 + uv[0] * view[2] as f64 - 0.5)
        .clamp(view[0] as f64, (view[0] + view[2] - 1) as f64);
    let y = (view[1] as f64 + uv[1] * view[3] as f64 - 0.5)
        .clamp(view[1] as f64, (view[1] + view[3] - 1) as f64);
    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(view[0] + view[2] - 1);
    let y1 = (y0 + 1).min(view[1] + view[3] - 1);
    std::array::from_fn(|channel| {
        let at = |px, py| f64::from(bytes[(py * width + px) * 4 + channel]);
        let top = (1.0 - x.fract()) * at(x0, y0) + x.fract() * at(x1, y0);
        let bottom = (1.0 - x.fract()) * at(x0, y1) + x.fract() * at(x1, y1);
        (1.0 - y.fract()) * top + y.fract() * bottom
    })
}

#[test]
fn affine_identity_and_gaussian_to_fractional_local_quad_match_dense_canvas_oracle() {
    let identity = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
    let canvas = [0.0, 0.0, 160.0, 90.0];
    let mut body = affine_style();
    body["scene"]["value"]["materials"] = json!([{
        "kind":"gaussian-axis","id":"soften","contextNodeId":"caption","axis":"x",
        "samples":{"kind":"constant","value":2},"stepUv":{"kind":"constant","value":0.008},
        "sigmaUv":{"kind":"constant","value":0.012},"gamma":1,"boundary":"transparent"
    }]);
    let source = plan(body.clone(), "One two", vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    assert!(source.rgba.iter().any(|v| *v != 0));
    let mut unchanged = body.clone();
    unchanged["scene"]["value"]["materials"]
        .as_array_mut()
        .unwrap()
        .push(affine_material(canvas, canvas, &[identity; 2]));
    assert_eq!(
        source.rgba,
        plan(unchanged, "One two", vec![], Presentation::default())
            .render(0.3)
            .unwrap()
            .rgba
    );

    let view = [35, 25, 90, 40];
    let quad = [40.25, 18.5, 70.5, 55.25];
    body["scene"]["value"]["materials"]
        .as_array_mut()
        .unwrap()
        .push(affine_material(
            view.map(|v| v as f64),
            quad,
            &[
                identity,
                [1.2, 0.0, 0.0, 0.8, -0.1, 0.1],
                [0.8, 0.0, 0.0, 1.2, 0.1, -0.1],
            ],
        ));
    let actual = plan(body, "One two", vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    let mut checked_nonzero = 0;
    for y in 0..90 {
        for x in 0..160 {
            let point = [x as f64 + 0.5, y as f64 + 0.5];
            let offset = (y * 160 + x) * 4;
            let mut expected = [0; 4];
            if (quad[0]..quad[0] + quad[2]).contains(&point[0])
                && (quad[1]..quad[1] + quad[3]).contains(&point[1])
            {
                let u = (point[0] - quad[0]) / quad[2];
                let v = (point[1] - quad[1]) / quad[3];
                let positions = [
                    [u, v],
                    [1.1 * u - 0.05, 0.9 * v + 0.05],
                    [1.2 * u - 0.1, 0.8 * v + 0.1],
                    [u, v],
                    [0.8 * u + 0.1, 1.2 * v - 0.1],
                ];
                let mut sums = [0.0; 4];
                for uv in positions {
                    if uv.iter().all(|v| (0.0..=1.0).contains(v)) {
                        let sample = affine_scene_dense_sample(&source.rgba, 160, view, uv);
                        for (sum, value) in sums.iter_mut().zip(sample) {
                            *sum += value;
                        }
                    }
                }
                expected = sums.map(|v| (v / 5.0).round() as u8);
            }
            if expected.iter().any(|v| *v != 0) {
                checked_nonzero += 1;
            }
            assert_eq!(
                &actual.rgba[offset..offset + 4],
                expected,
                "pixel ({x},{y})"
            );
        }
    }
    assert!(
        checked_nonzero > 50,
        "oracle must exercise real filtered glyph coverage"
    );
}

#[test]
fn affine_dynamic_page_uniforms_are_cold_warm_and_cue_reset_deterministic() {
    let identity = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
    let canvas = [0.0, 0.0, 160.0, 90.0];
    let mut body = affine_style();
    let mut material = affine_material(canvas, canvas, &[identity; 2]);
    material["sampleRange"] = json!([2, 11]);
    material["distanceRange"] = json!([0, 0.25]);
    material["transforms"][1][4] = json!({"kind":"keyframes",
        "clock":{"unit":"page","origin":"start","duration":{"kind":"unit-span"}},
        "keys":[{"at":0,"value":0},{"at":0.5,"value":0.2},{"at":1,"value":0}],
        "fill":{"before":"hold","after":"hold"}
    });
    body["scene"]["value"]["materials"] = json!([material]);
    let make = || {
        ScenePlan::compile(
            parse_style(&body).unwrap(),
            Presentation::default(),
            [("a", 0.0, 2.0), ("b", 3.0, 5.0)]
                .into_iter()
                .map(|(id, start, end)| SceneCue {
                    id: id.into(),
                    document_id: "doc".into(),
                    text: "One two three four".into(),
                    start,
                    end,
                    words: vec![],
                })
                .collect(),
            (160, 90),
            TextEngine::with_document_fonts(&[include_bytes!(
                "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
            )
            .to_vec()]),
            "affine-repeat".into(),
        )
        .unwrap()
    };
    let mut reused = make();
    let first = reused.render(0.25).unwrap();
    assert!(first.rgba.iter().any(|v| *v != 0));
    assert_ne!(first.rgba, reused.render(0.5).unwrap().rgba);
    assert!(
        first.rgba == reused.render(3.25).unwrap().rgba,
        "the same binary-exact cue offset must reset the page path"
    );
    for seconds in [1.9, 0.5, 3.001, 2.5, 4.4, 1.001, 0.25, 3.25] {
        let actual = reused.render(seconds).unwrap();
        let fresh = make().render(seconds).unwrap();
        assert_eq!(actual.rgba, fresh.rgba, "seek to {seconds}");
        assert_eq!(actual.fingerprint, fresh.fingerprint, "seek to {seconds}");
    }
    assert!(reused.render(2.5).unwrap().rgba.iter().all(|v| *v == 0));
    assert!(reused.render(5.0).unwrap().rgba.iter().all(|v| *v == 0));
}

#[test]
fn affine_material_plan_resolves_the_same_current_page_parameters_for_gpu_commands() {
    let mut body = affine_style();
    body["scene"]["value"]["materials"] = json!([affine_material(
        [0.0, 0.0, 160.0, 90.0],
        [0.0, 0.0, 160.0, 90.0],
        &[[1.0, 0.0, 0.0, 1.0, 0.0, 0.0]; 2],
    )]);
    body["scene"]["value"]["materials"][0]["transforms"][0][4] = json!({"kind":"expression","expression":{
        "op":"call","function":"div","args":[{"op":"read","path":"time.pageElapsedSeconds"},{"op":"literal","type":"time","value":1}]}});
    let mut rendered = plan(body, "One", vec![], Presentation::default());
    for seconds in [0.2, 3.5, 0.2] {
        let (frame, _) = rendered.record_material_plan(seconds).unwrap();
        assert_eq!(frame.layers.len(), 1);
        let render_raster::effects::material_plan::MaterialCommand::AffineSampleBlend(config) =
            &frame.layers[0].materials[0]
        else {
            panic!("resolved affine command required");
        };
        assert_eq!(config.sampling.input, [0, 0, 160, 90]);
        assert_eq!(config.sampling.output, [0.0, 0.0, 160.0, 90.0]);
        assert_eq!(config.transforms.len(), 2);
        assert!((config.transforms[0][4] - seconds).abs() < 1e-12);
    }
    assert!(
        rendered
            .record_material_plan(4.5)
            .unwrap()
            .0
            .layers
            .is_empty()
    );
    assert!(rendered.render(0.2).unwrap().rgba.iter().any(|v| *v != 0));
}

#[test]
fn affine_dynamic_invalid_matrix_and_fractional_input_view_fail_without_implicit_clamping() {
    let identity = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
    let canvas = [0.0, 0.0, 160.0, 90.0];
    for (field, value_type, value) in [("matrix", "scalar", 10000.1), ("input", "length", 0.25)] {
        let mut body = affine_style();
        let mut material = affine_material(canvas, canvas, &[identity; 2]);
        let expression = json!({"kind":"expression","expression":{"op":"literal","type":value_type,"value":value}});
        if field == "matrix" {
            material["transforms"][1][0] = expression;
        } else {
            material["sampling"]["input"]["x"] = expression;
        }
        body["scene"]["value"]["materials"] = json!([material]);
        let mut rendered = plan(body, "One", vec![], Presentation::default());
        for seconds in [0.2, 0.8, 0.2] {
            let error = rendered
                .render(seconds)
                .err()
                .expect("invalid dynamic affine input must fail");
            assert!(
                error.to_string().contains("CAPTION_MATERIAL_INVALID"),
                "{field}: {error}"
            );
        }
    }
}

#[test]
fn affine_frame_budget_charges_dense_profile_work_even_when_all_uvs_are_protected() {
    let canvas = [0.0, 0.0, 768.0, 512.0];
    let mut body = affine_style();
    let mut material = affine_material(canvas, canvas, &[[0.0, 0.0, 0.0, 0.0, -1.0, -1.0]; 2]);
    material["sampleRange"] = json!([256, 256]);
    body["scene"]["value"]["materials"] = json!([material]);
    let mut rendered = ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "One".into(),
            start: 0.0,
            end: 2.0,
            words: vec![],
        }],
        (768, 512),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "affine-budget".into(),
    )
    .unwrap();
    for seconds in [0.2, 0.8, 0.2] {
        let error = rendered
            .render(seconds)
            .err()
            .expect("all rejected UVs still consume frame work");
        assert!(
            error.to_string().contains("CAPTION_BUDGET_EXCEEDED"),
            "{error}"
        );
    }
}

fn affine_over_material() -> Value {
    let mut material = affine_material(
        [0., 0., 160., 90.],
        [0., 0., 160., 90.],
        &[[1., 0., 0., 1., 0., 0.]; 2],
    );
    let m = material.as_object_mut().unwrap();
    let controls = m.remove("transforms").unwrap();
    m.remove("sampleRange");
    m.remove("distanceRange");
    m.insert("kind".into(), json!("affine-over"));
    m.insert("foreground".into(), controls[0].clone());
    m.insert(
        "background".into(),
        json!([0.5, 0., 0., 0.5, 0.25, 0.25].map(|v| json!({"kind":"constant","value":v}))),
    );
    m.insert(
        "backgroundOpacity".into(),
        json!({"kind":"constant","value":0.35}),
    );
    m.insert(
        "backgroundRgbScale".into(),
        json!({"kind":"constant","value":0.65}),
    );
    material
}
fn affine_over_body() -> Value {
    let mut body = affine_style();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-affine-over/1"));
    body
}
#[test]
fn affine_over_real_glyphs_match_independent_dense_over_equation() {
    let mut body = affine_over_body();
    let source = plan(body.clone(), "AV ff", vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    body["scene"]["value"]["materials"] = json!([affine_over_material()]);
    let actual = plan(body, "AV ff", vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    let mut changed = 0;
    for y in 0..90 {
        for x in 0..160 {
            let uv = [(x as f64 + 0.5) / 160., (y as f64 + 0.5) / 90.];
            let fg = affine_scene_dense_sample(&source.rgba, 160, [0, 0, 160, 90], uv);
            let bg = affine_scene_dense_sample(
                &source.rgba,
                160,
                [0, 0, 160, 90],
                uv.map(|v| 0.5 * v + 0.25),
            );
            let expected: [u8; 4] = std::array::from_fn(|c| {
                let gain = if c == 3 { 1. } else { 0.65 };
                (fg[c] + bg[c] * 0.35 * gain * (1. - fg[3] / 255.))
                    .clamp(0., 255.)
                    .round() as u8
            });
            let offset = (y * 160 + x) * 4;
            assert_eq!(&actual.rgba[offset..offset + 4], expected, "({x},{y})");
            if actual.rgba[offset..offset + 4] != source.rgba[offset..offset + 4] {
                changed += 1;
            }
        }
    }
    assert!(changed > 50, "background must exercise real glyph samples");
}
#[test]
fn affine_over_dynamic_validation_seek_and_inactive_cue_are_explicit() {
    let mut body = affine_over_body();
    let mut material = affine_over_material();
    material["backgroundOpacity"] =
        json!({"kind":"expression","expression":{"op":"read","path":"time.progress"}});
    body["scene"]["value"]["materials"] = json!([material]);
    let make = || plan(body.clone(), "AV ff", vec![], Presentation::default());
    let mut reused = make();
    for t in [0.2, 2.7, 0.2, 4.5, 1.1] {
        assert_eq!(
            reused.render(t).unwrap().rgba,
            make().render(t).unwrap().rgba
        );
    }
    assert!(reused.render(4.5).unwrap().rgba.iter().all(|v| *v == 0));
    let mut invalid = body.clone();
    invalid["scene"]["value"]["materials"][0]["foreground"][0] =
        json!({"kind":"expression","expression":{"op":"literal","type":"scalar","value":10001}});
    assert!(
        plan(invalid, "AV", vec![], Presentation::default())
            .render(0.2)
            .is_err()
    );
    let mut invalid = body.clone();
    invalid["scene"]["value"]["materials"][0]["backgroundOpacity"] =
        json!({"kind":"expression","expression":{"op":"literal","type":"scalar","value":2}});
    assert!(
        plan(invalid, "AV", vec![], Presentation::default())
            .render(0.2)
            .is_err()
    );
    let mut invalid = body;
    invalid["scene"]["value"]["materials"][0]["sampling"]["input"]["x"] =
        json!({"kind":"expression","expression":{"op":"literal","type":"length","value":0.5}});
    assert!(
        plan(invalid, "AV", vec![], Presentation::default())
            .render(0.2)
            .is_err()
    );
}

#[test]
fn gaussian_uv_scene_is_directional_deterministic_and_checks_dynamic_ranges() {
    let mut body = affine_over_body();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-gaussian-uv/1"));
    body["scene"]["value"]["materials"] = json!([{"kind":"gaussian-uv","id":"vector","contextNodeId":"caption","sampling":{"input":affine_domain([0.,0.,160.,90.]),"output":affine_domain([0.,0.,160.,90.])},"samples":{"kind":"constant","value":4.7},"stepUv":[{"kind":"constant","value":0.01},{"kind":"constant","value":-0.015}],"sigmaUv":{"kind":"constant","value":0.025},"rgbGain":{"kind":"constant","value":1.3},"boundary":"normalize"}]);
    let mut raw = body.clone();
    raw["scene"]["value"]["materials"] = json!([]);
    let baseline = plan(raw, "AV ff", vec![], Presentation::default())
        .render(0.3)
        .unwrap();
    let mut p = plan(body.clone(), "AV ff", vec![], Presentation::default());
    let frame = p.render(0.3).unwrap();
    assert_ne!(frame.rgba, baseline.rgba);
    assert_eq!(frame.rgba, p.render(1.3).unwrap().rgba);
    assert_eq!(frame.rgba, p.render(0.3).unwrap().rgba);
    assert!(p.render(4.1).unwrap().rgba.iter().all(|v| *v == 0));
    body["scene"]["value"]["materials"][0]["stepUv"][1] =
        json!({"kind":"expression","expression":{"op":"literal","type":"scalar","value":1.1}});
    assert!(
        plan(body, "AV", vec![], Presentation::default())
            .render(0.3)
            .is_err()
    );
}
