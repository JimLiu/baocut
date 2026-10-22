//! Authored scalar-page origins, independent of glyph visibility or source metadata.
use caption_scene::{Presentation, parse_style};
use render_raster::{TextEngine, drawop::DrawOp};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use subtitle_render::scene::{SceneCue, ScenePlan, SceneWord};
use tiny_skia::Pixmap;
const W: u32 = 192;
const H: u32 = 96;
const COLORS: [[u8; 3]; 8] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [255, 0, 255],
    [0, 255, 255],
    [255, 128, 0],
    [255, 255, 255],
];
fn png() -> Vec<u8> {
    let mut p = Pixmap::new(8, 1).unwrap();
    for (pixel, color) in p.data_mut().chunks_exact_mut(4).zip(COLORS) {
        pixel.copy_from_slice(&[color[0], color[1], color[2], 255]);
    }
    p.encode_png().unwrap()
}
fn image(source: &str) -> Value {
    json!({"id":"texture","paint":{"kind":"image","resourceId":"palette","space":"glyph-normalized",
        "uvTransform":[0.00001,0,0,0.00001,0.0625,0.5],"filter":"nearest","wrap":"repeat",
        "phase":{"period":8,"source":source}}})
}
fn body(source: &str) -> Value {
    let bytes = png();
    let digest: String = Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
        "schema":"baocut.caption-scene/1","evaluationVersion":1,
        "requiredCapabilities":["caption-scene/1","caption-image-paint/1","caption-image-page-phase/1","caption-word-page-layout/1"],
        "layout":{"x":{"value":96,"basis":"absolute"},"y":{"value":48,"basis":"absolute"},
            "width":{"value":180,"basis":"absolute"},"maxLines":4,"overflow":"visible","pagination":{"wordPagePattern":[1]}},
        "speechState":{"gapPolicy":"none","tailPolicy":"none"},
        "resources":[{"id":"palette","assetRef":{"id":"palette-asset","revision":"1"},"contentHash":format!("sha256:{digest}")}],
        "nodes":[{"id":"ink","type":"text","style":{"fontFamily":"Arimo","fontSize":{"value":36,"basis":"absolute"},"paints":[image(source)]}}],
        "selectors":[],"animations":[]
    }}})
}
fn cap(v: &mut Value, name: &str) {
    let c = v["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap();
    if !c.iter().any(|v| v == name) {
        c.push(json!(name));
    }
}
fn words(values: &[&str]) -> Vec<SceneWord> {
    values
        .iter()
        .enumerate()
        .map(|(i, text)| SceneWord {
            id: format!("word-{i}"),
            text: (*text).into(),
            start: i as f64,
            end: (i + 1) as f64,
        })
        .collect()
}
fn compile(v: Value, text: &str, values: &[&str]) -> ScenePlan {
    compile_with_words(v, text, words(values), 2.)
}
fn compile_with_words(v: Value, text: &str, timed: Vec<SceneWord>, duration: f64) -> ScenePlan {
    let mut p = ScenePlan::compile(
        parse_style(&v).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "speech".into(),
            text: text.into(),
            start: 0.,
            end: duration,
            words: timed,
        }],
        (W, H),
        TextEngine::with_document_fonts(&[
            include_bytes!("../../render-raster/assets/fonts/Arimo.ttf").to_vec(),
            include_bytes!("../../render-raster/assets/fonts/Rubik.ttf").to_vec(),
            include_bytes!("../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").to_vec(),
        ]),
        "page-phase-test".into(),
    )
    .unwrap();
    let bytes = png();
    p.load_resources(|r| (r.id == "palette").then(|| bytes.clone()))
        .unwrap();
    assert!(p.diagnostics.is_empty());
    p
}
fn pixels(p: &mut ScenePlan, t: f64) -> Vec<u8> {
    let frame = p.render(t).unwrap();
    assert!(p.diagnostics.is_empty());
    frame.rgba.as_ref().clone()
}
fn opaque_colors(p: &[u8]) -> BTreeSet<[u8; 3]> {
    p.chunks_exact(4)
        .filter(|p| p[3] == 255)
        .map(|p| [p[0], p[1], p[2]])
        .collect()
}
fn expected(indices: &[usize]) -> BTreeSet<[u8; 3]> {
    indices.iter().map(|i| COLORS[*i]).collect()
}

#[test]
fn repeated_logical_word_pages_restart_phase_but_cue_phase_does_not() {
    let mut page = compile(body("page-scalar-index"), "AAAA", &["AA", "AA"]);
    let first = pixels(&mut page, 0.25);
    assert_eq!(opaque_colors(&first), expected(&[0, 1]));
    assert_eq!(first, pixels(&mut page, 1.25));
    let (ops, _) = page.record(1.25).unwrap();
    assert!(
        ops.ops
            .iter()
            .any(|op| matches!(op, DrawOp::DrawBitmap { .. }))
    );
    assert!(ops.bitmaps.iter().all(|p| p.width <= W && p.height <= H));
    assert!(pixels(&mut page, 2.1).iter().all(|v| *v == 0));
    assert_eq!(first, pixels(&mut page, 0.25));
    let mut cue = compile(body("cue-scalar-index"), "AAAA", &["AA", "AA"]);
    assert_ne!(pixels(&mut cue, 0.25), pixels(&mut cue, 1.25));
    assert_eq!(opaque_colors(&pixels(&mut cue, 1.25)), expected(&[2, 3]));
}
#[test]
fn hidden_horizontal_prefix_counts_from_logical_page_start() {
    let mut page = compile(body("page-scalar-index"), "AA  AA", &["AA", "AA"]);
    // The second page starts after the first AA, before its two hidden spaces.
    assert_eq!(opaque_colors(&pixels(&mut page, 1.25)), expected(&[2, 3]));
    let mut cue = compile(body("cue-scalar-index"), "AA  AA", &["AA", "AA"]);
    assert_eq!(opaque_colors(&pixels(&mut cue, 1.25)), expected(&[4, 5]));
    let mut first = compile(body("page-scalar-index"), "  AA", &["AA"]);
    assert_eq!(opaque_colors(&pixels(&mut first, 0.25)), expected(&[2, 3]));
}
#[test]
fn fixed_word_line_topology_uses_its_own_complete_source_range() {
    let mut v = body("page-scalar-index");
    cap(&mut v, "caption-word-line-layout/1");
    v["scene"]["value"]["layout"]["pagination"] = json!({"wordLinePattern":[[1]]});
    let mut p = compile(v, "AA  AA", &["AA", "AA"]);
    // Fixed word-line boundaries precede the next word; these spaces belong to page one.
    assert_eq!(opaque_colors(&pixels(&mut p, 1.25)), expected(&[0, 1]));
}
#[test]
fn utf8_prefix_and_combining_scalars_are_not_byte_or_grapheme_offsets() {
    for (prefix, index) in [("🐋", 1), ("e\u{301}", 2), ("山", 1)] {
        let text = format!("{prefix}AA");
        let mut page = compile(body("page-scalar-index"), &text, &[prefix, "AA"]);
        assert_eq!(opaque_colors(&pixels(&mut page, 1.25)), expected(&[0, 1]));
        let mut cue = compile(body("cue-scalar-index"), &text, &[prefix, "AA"]);
        assert_eq!(
            opaque_colors(&pixels(&mut cue, 1.25)),
            expected(&[index, index + 1]),
            "prefix {prefix:?}"
        );
    }
}
#[test]
fn ligature_phase_uses_cluster_start_and_rtl_keeps_logical_scalar_order() {
    let mut v = body("page-scalar-index");
    v["scene"]["value"]["nodes"][0]["style"]["fontFamily"] = json!("Rubik");
    let mut p = compile(v, "ffff", &["ff", "ff"]);
    assert_eq!(
        opaque_colors(&pixels(&mut p, 0.25)),
        expected(&[0]),
        "known ff substitution must remain one cluster"
    );
    assert_eq!(pixels(&mut p, 0.25), pixels(&mut p, 1.25));
    let mut rtl = compile(body("page-scalar-index"), "אבאב", &["אב", "אב"]);
    let first = pixels(&mut rtl, 0.25);
    assert_eq!(first, pixels(&mut rtl, 1.25));
    assert_eq!(opaque_colors(&first), expected(&[0, 1]));
    let centers: Vec<_> = [COLORS[0], COLORS[1]]
        .map(|rgb| {
            let xs: Vec<_> = first
                .chunks_exact(4)
                .enumerate()
                .filter(|(_, p)| p[3] == 255 && p[..3] == rgb)
                .map(|(i, _)| (i % W as usize) as f64)
                .collect();
            assert!(!xs.is_empty());
            xs.iter().sum::<f64>() / xs.len() as f64
        })
        .into();
    assert!(
        centers[0] > centers[1],
        "RTL visual order must not renumber logical scalar colors"
    );
}
#[test]
fn uppercase_expansion_uses_transformed_page_scalar_boundaries() {
    let mut v = body("page-scalar-index");
    cap(&mut v, "caption-text-transform/1");
    v["scene"]["value"]["nodes"][0]["style"]["textTransform"] = json!("uppercase");
    let mut p = compile(v, "ßß", &["ß", "ß"]);
    let mut plain = compile(body("page-scalar-index"), "SSSS", &["SS", "SS"]);
    for t in [0.25, 1.25, 0.25] {
        assert_eq!(pixels(&mut p, t), pixels(&mut plain, t));
    }
}
#[test]
fn binding_only_phase_and_per_sample_font_reflow_match_static_path() {
    let mut bound = body("page-scalar-index");
    cap(&mut bound, "caption-paint-style-bindings/1");
    bound["scene"]["value"]["nodes"][0]["style"]["paints"] =
        json!([{"id":"texture","paint":{"kind":"solid","color":"#FFFFFFFF"}}]);
    bound["scene"]["value"]["selectors"] =
        json!([{"id":"all","nodeId":"ink","unit":"word","filter":{"kind":"all"}}]);
    bound["scene"]["value"]["paintStyleBindings"] = json!([{"id":"selection","nodeId":"ink","selectorId":"all","style":{"paints":[image("page-scalar-index")]}}]);
    for cap_name in [
        "caption-layout-per-sample/1",
        "caption-unit-font-size/1",
        "caption-unit-font-reflow/1",
    ] {
        cap(&mut bound, cap_name);
    }
    bound["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
    bound["scene"]["value"]["layout"]["fontSizeBindings"] = json!([{"id":"size","nodeId":"ink","selectorId":"all","value":{"kind":"constant","value":36}}]);
    let mut p = compile(bound, "AA  AA", &["AA", "AA"]);
    let mut plain = compile(body("page-scalar-index"), "AA  AA", &["AA", "AA"]);
    for t in [0.25, 1.25, 0.25] {
        assert_eq!(pixels(&mut p, t), pixels(&mut plain, t));
    }
}
#[test]
fn nonzero_node_translation_keeps_page_phase_and_shared_bitmap_transport() {
    let mut moved = body("page-scalar-index");
    moved["scene"]["value"]["nodes"][0]["properties"] = json!({
        "transform.x":{"kind":"constant","value":12},
        "transform.y":{"kind":"constant","value":-8}
    });
    let mut positioned = body("page-scalar-index");
    positioned["scene"]["value"]["layout"]["x"] = json!({"value":108,"basis":"absolute"});
    positioned["scene"]["value"]["layout"]["y"] = json!({"value":40,"basis":"absolute"});
    let mut moved = compile(moved, "AAAA", &["AA", "AA"]);
    let mut positioned = compile(positioned, "AAAA", &["AA", "AA"]);
    for time in [0.25, 1.25, 0.25] {
        assert_eq!(pixels(&mut moved, time), pixels(&mut positioned, time));
        let (frame, _) = moved.record(time).unwrap();
        assert!(
            frame
                .ops
                .iter()
                .any(|op| matches!(op, DrawOp::DrawBitmap { .. }))
        );
    }
}

#[test]
fn page_phase_does_not_restart_global_time_seconds() {
    let mut v = body("page-scalar-index");
    cap(&mut v, "caption-expressions/1");
    v["scene"]["value"]["nodes"][0]["properties"] = json!({"opacity":{"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"lt","args":[{"op":"read","path":"time.seconds"},{"op":"literal","type":"time","value":0.75}]},"then":{"op":"literal","type":"scalar","value":1},"else":{"op":"literal","type":"scalar","value":0.25}}}});
    let mut p = compile(v, "AAAA", &["AA", "AA"]);
    let first = pixels(&mut p, 0.25);
    let later = pixels(&mut p, 1.25);
    let alpha = |p: &[u8]| p.chunks_exact(4).map(|p| p[3] as u64).sum::<u64>();
    assert!(alpha(&later) * 5 > alpha(&first) && alpha(&later) * 3 < alpha(&first));
    assert_eq!(first, pixels(&mut p, 0.25));
}
#[test]
fn static_label_phase_is_its_own_single_logical_page() {
    let mut v = body("page-scalar-index");
    cap(&mut v, "caption-bound-label/1");
    v["scene"]["value"]["selectors"] =
        json!([{"id":"pages","nodeId":"ink","unit":"page","filter":{"kind":"all"}}]);
    v["scene"]["value"]["nodes"][0]["properties"] =
        json!({"opacity":{"kind":"constant","value":0}});
    v["scene"]["value"]["nodes"].as_array_mut().unwrap().push(json!({"id":"labels","type":"repeat","selectorId":"pages","children":[{"id":"label","type":"label","text":{"source":"static","text":"AA"},"style":{"fontFamily":"Arimo","fontSize":{"value":36,"basis":"absolute"},"paints":[image("page-scalar-index")]}}]}));
    let mut p = compile(v, "AAAA", &["AA", "AA"]);
    let first = pixels(&mut p, 0.25);
    assert_eq!(opaque_colors(&first), expected(&[0, 1]));
    assert_eq!(first, pixels(&mut p, 1.25));
}

#[test]
fn empty_or_whitespace_only_cues_do_not_require_a_visible_scalar_origin() {
    for text in ["", "  \t\n"] {
        let mut p = compile(body("page-scalar-index"), text, &[]);
        assert!(pixels(&mut p, 0.25).iter().all(|v| *v == 0));
    }
}

#[test]
fn contour_coverage_image_uses_the_same_page_phase_origin_as_ordinary_image() {
    let mut v = body("page-scalar-index");
    for name in [
        "caption-paint-effects/1",
        "caption-glyph-distance-coverage/1",
        "caption-image-distance-coverage/1",
    ] {
        cap(&mut v, name);
    }
    let layer = &mut v["scene"]["value"]["nodes"][0]["style"]["paints"][0];
    layer["unit"] = json!("em");
    layer["distanceCoverage"] = json!({"source":"glyph-contours",
        "bands":[{"offset":[0.02,-0.01],"threshold":0,"halfWidth":0.015},
            {"offset":[0,0],"threshold":0,"halfWidth":0}],
        "aa":{"kind":"quad-derivative","sourceBand":0,"scale":0.6},
        "combine":"multiply","zeroWidth":"step-inclusive"});
    let mut p = compile(v.clone(), "AAAA", &["AA", "AA"]);
    let first = pixels(&mut p, 0.25);
    assert_eq!(opaque_colors(&first), expected(&[0, 1]));
    assert_eq!(first, pixels(&mut p, 1.25));
    v["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["phase"]["source"] =
        json!("cue-scalar-index");
    let mut cue = compile(v, "AAAA", &["AA", "AA"]);
    assert_eq!(opaque_colors(&pixels(&mut cue, 1.25)), expected(&[2, 3]));
}
fn held_word_window() -> Value {
    let mut v = body("page-scalar-index");
    cap(&mut v, "caption-page-window/1");
    v["scene"]["value"]["layout"]["leadingGap"] = json!("hide");
    v["scene"]["value"]["speechState"]["timingPolicy"] = json!("require-word-timing");
    v["scene"]["value"]["layout"]["pageWindow"] = json!({"gapThreshold":{"ticks":1000,"timescale":1000},"shortGap":{"before":0,"after":1},"longGap":{"before":0,"after":1},"boundary":"first-start-inclusive-end-inclusive"});
    v
}
fn raw_gapped_words() -> Vec<SceneWord> {
    [("A", 0., 0.2), ("B", 0.9, 1.), ("C", 2.9, 3.)]
        .into_iter()
        .enumerate()
        .map(|(i, (text, start, end))| SceneWord {
            id: format!("word-{i}"),
            text: text.into(),
            start,
            end,
        })
        .collect()
}
#[test]
fn word_page_windows_preserve_source_spaces_exact_endpoints_and_global_clock() {
    let body = held_word_window();
    let mut p = compile_with_words(body.clone(), "A B C", raw_gapped_words(), 3.);
    let initial = pixels(&mut p, 0.);
    // The closed shared cuts belong to the preceding page. Gap ownership is
    // explicit and does not stretch the caller's positive word records.
    let samples = [
        (0., 0., 0.9, 0),
        (0.5, 0., 0.9, 0),
        (0.9, 0., 0.9, 0),
        (0.900001, 0.9, 2.9, 1),
        (1.5, 0.9, 2.9, 1),
        (2.9, 0.9, 2.9, 1),
        (2.900001, 2.9, 3., 1),
        (2.999999, 2.9, 3., 1),
    ];
    for (time, start, end, color) in samples {
        let actual = pixels(&mut p, time);
        assert_eq!(opaque_colors(&actual), expected(&[color]), "t={time}");
        // If any exposed page window or global time is wrong, this independent
        // guard makes the control transparent rather than accepting a wrong page.
        let eq = |path: &str, value: f64| json!({"op":"call","function":"eq","args":[{"op":"read","path":path},{"op":"literal","type":"time","value":value}]});
        let mut guarded = body.clone();
        cap(&mut guarded, "caption-expressions/1");
        guarded["scene"]["value"]["nodes"][0]["properties"] = json!({"opacity":{"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"and","args":[eq("time.seconds",time),{"op":"call","function":"and","args":[eq("time.pageDurationSeconds",end-start),eq("time.pageElapsedSeconds",time-start)]}]},"then":{"op":"literal","type":"scalar","value":1},"else":{"op":"literal","type":"scalar","value":0}}}});
        let mut control = compile_with_words(guarded, "A B C", raw_gapped_words(), 3.);
        assert_eq!(
            actual,
            pixels(&mut control, time),
            "window [{start},{end}] at {time}"
        );
    }
    assert_ne!(pixels(&mut p, 0.9), pixels(&mut p, 0.900001));
    assert_ne!(pixels(&mut p, 2.9), pixels(&mut p, 2.900001));
    assert!(
        pixels(&mut p, 3.).iter().all(|v| *v == 0),
        "outer cue EOF stays exclusive"
    );
    assert_eq!(initial, pixels(&mut p, 0.));
}

#[test]
fn ordinary_per_sample_reflow_keeps_packed_line_windows_without_font_bindings() {
    let plain = held_word_window();
    for (time, start, end) in [(0.5, 0., 0.9), (1.5, 0.9, 2.9), (2.95, 2.9, 3.)] {
        let mut guarded = plain.clone();
        cap(&mut guarded, "caption-expressions/1");
        guarded["scene"]["value"]["selectors"] =
            json!([{"id":"lines","nodeId":"ink","unit":"line","filter":{"kind":"all"}}]);
        let eq = |path: &str, value: f64| json!({"op":"call","function":"eq","args":[{"op":"read","path":path},{"op":"literal","type":"time","value":value}]});
        guarded["scene"]["value"]["animations"] = json!([{"id":"line-window","target":{"nodeId":"ink","selectorId":"lines"},"property":"opacity","composite":"replace","value":{"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"and","args":[eq("time.lineDurationSeconds",end-start),eq("time.lineElapsedSeconds",time-start)]},"then":{"op":"literal","type":"scalar","value":1},"else":{"op":"literal","type":"scalar","value":0}}}}]);
        let mut sampled = guarded.clone();
        cap(&mut sampled, "caption-layout-per-sample/1");
        sampled["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
        assert!(
            sampled["scene"]["value"]["layout"]
                .get("fontSizeBindings")
                .is_none()
        );
        let mut reference = compile_with_words(plain.clone(), "A B C", raw_gapped_words(), 3.);
        let expected = pixels(&mut reference, time);
        assert!(expected.iter().any(|v| *v != 0));
        for v in [guarded, sampled] {
            let mut p = compile_with_words(v, "A B C", raw_gapped_words(), 3.);
            assert_eq!(
                expected,
                pixels(&mut p, time),
                "line window [{start},{end}] at {time}"
            );
        }
    }
}
#[test]
fn per_sample_width_cannot_silently_change_packed_line_membership() {
    let mut v = held_word_window();
    for name in ["caption-expressions/1", "caption-layout-per-sample/1"] {
        cap(&mut v, name);
    }
    v["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
    v["scene"]["value"]["layout"]["bindings"] = json!([{"property":"width","value":{"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"lt","args":[{"op":"read","path":"time.seconds"},{"op":"literal","type":"time","value":0.4}]},"then":{"op":"literal","type":"length","value":180},"else":{"op":"literal","type":"length","value":18}}}}]);
    let mut raw = raw_gapped_words();
    for (w, text) in raw.iter_mut().zip(["AAAA", "BBBB", "CCCC"]) {
        w.text = text.into();
    }
    let mut p = compile_with_words(v, "AAAA BBBB CCCC", raw, 3.);
    let first = pixels(&mut p, 0.1);
    assert!(first.iter().any(|v| *v != 0));
    let error = p
        .render(0.5)
        .err()
        .expect("changed line members must reject");
    assert!(
        error.to_string().contains("CAPTION_PAGE_WINDOW_INVALID"),
        "{error}"
    );
    assert_eq!(
        first,
        pixels(&mut p, 0.1),
        "failed reflow must not mutate the prepared source"
    );
}
