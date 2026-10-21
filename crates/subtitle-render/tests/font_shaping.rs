use caption_scene::{Presentation, parse_style};
use render_raster::{
    TextEngine,
    drawop::{DrawOp, PaintData},
};
use serde_json::{Value, json};
use subtitle_render::scene::{SceneCue, ScenePlan, SceneWord};

fn fonts() -> TextEngine {
    TextEngine::with_document_fonts(&[
        include_bytes!("../../render-raster/assets/fonts/Rubik.ttf").to_vec(),
        include_bytes!("../../render-raster/assets/fonts/Arimo.ttf").to_vec(),
    ])
}

fn paint() -> Value {
    json!([{"id":"ink","paint":{"kind":"linear","space":"normalized",
        "from":[0,0],"to":[1,0],
        "stops":[{"at":0,"color":"#FF0000"},{"at":1,"color":"#0000FF"}]}}])
}

fn style(family: &str, mode: Option<&str>) -> Value {
    let mut body: Value = serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/word-pop.json"
    ))
    .unwrap();
    let scene = &mut body["scene"]["value"];
    scene["animations"] = json!([]);
    scene["layout"] = json!({"width":{"value":300,"basis":"absolute"},
        "x":{"value":160,"basis":"absolute"},"y":{"value":90,"basis":"absolute"},
        "maxLines":8,"overflow":"visible","pagination":{}});
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-gradient-space/1"));
    scene["nodes"][0]["style"] = json!({"fontFamily":family,"fontWeight":400,
        "fontSize":{"value":48,"basis":"absolute"},"paints":paint()});
    if let Some(mode) = mode {
        scene["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-font-shaping/1"));
        scene["nodes"][0]["style"]["fontShaping"] = json!(mode);
    }
    body
}

fn compile_with_fonts(body: Value, text: &str, engine: TextEngine) -> ScenePlan {
    let words = text
        .split_whitespace()
        .enumerate()
        .map(|(i, word)| SceneWord {
            id: format!("w{i}"),
            text: word.into(),
            start: i as f64,
            end: i as f64 + 0.8,
        })
        .collect();
    ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: text.into(),
            start: 0.0,
            end: 4.0,
            words,
        }],
        (320, 180),
        engine,
        "font-shaping".into(),
    )
    .unwrap()
}

fn compile(body: Value, text: &str) -> ScenePlan {
    compile_with_fonts(body, text, fonts())
}

// A normalized horizontal gradient stores the actual measured line domain.
// Read that domain from recorded commands rather than from a shaping helper.
fn glyph_domains(plan: &mut ScenePlan, time: f64) -> Vec<(f64, f64)> {
    let (frame, _) = plan.record(time).unwrap();
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
            let dx = f64::from(p1[0] - p0[0]);
            let dy = f64::from(p1[1] - p0[1]);
            Some((
                f64::from(tf[0]) * dx + f64::from(tf[2]) * dy,
                f64::from(tf[5]),
            ))
        })
        .collect()
}

fn width(body: Value, text: &str) -> f64 {
    let domains = glyph_domains(&mut compile(body, text), 0.25);
    assert!(
        !domains.is_empty(),
        "fixture must record real glyph outlines"
    );
    assert!(
        domains
            .iter()
            .all(|(w, _)| (w - domains[0].0).abs() < 0.0001)
    );
    domains[0].0
}

#[test]
fn omitted_and_explicit_advanced_keep_scene_pixels_layout_and_fingerprints() {
    for (family, text) in [("Rubik", "ff ff"), ("Arimo", "AV AV"), ("Arimo", "AV\nff")] {
        let mut legacy = compile(style(family, None), text);
        let mut explicit = compile(style(family, Some("advanced")), text);
        let mut advertised_body = style(family, None);
        advertised_body["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-font-shaping/1"));
        let mut advertised = compile(advertised_body, text);
        for time in [0.25, 2.5, 1.25, 0.25] {
            let expected = legacy.render(time).unwrap();
            assert!(expected.rgba.iter().any(|v| *v != 0));
            for actual in [
                explicit.render(time).unwrap(),
                advertised.render(time).unwrap(),
            ] {
                assert!(
                    expected.rgba == actual.rgba,
                    "{family}: default shaping pixels changed"
                );
                assert_eq!(expected.fingerprint, actual.fingerprint);
                assert_eq!(expected.hits.len(), actual.hits.len());
                for (a, b) in expected.hits.iter().zip(&actual.hits) {
                    assert_eq!(
                        (a.bounds.x, a.bounds.y, a.bounds.width, a.bounds.height),
                        (b.bounds.x, b.bounds.y, b.bounds.width, b.bounds.height)
                    );
                }
            }
        }
    }
}

#[test]
fn nominal_ff_and_av_have_independent_scalar_advances_in_real_scene_geometry() {
    for (family, text, scalars, advanced_glyphs) in [
        ("Rubik", "ff", ["f", "f"], 1),
        ("Arimo", "AV", ["A", "V"], 2),
    ] {
        let nominal_body = style(family, Some("nominal"));
        let advanced_body = style(family, Some("advanced"));
        // Single-scalar scenes cannot kern or form a cross-scalar ligature.
        let scalar_sum: f64 = scalars
            .into_iter()
            .map(|s| width(style(family, None), s))
            .sum();
        let mut nominal = compile(nominal_body, text);
        let mut advanced = compile(advanced_body, text);
        let nominal_domains = glyph_domains(&mut nominal, 0.25);
        let advanced_domains = glyph_domains(&mut advanced, 0.25);
        assert_eq!(nominal_domains.len(), 2, "{family} nominal scalar glyphs");
        assert_eq!(
            advanced_domains.len(),
            advanced_glyphs,
            "fixture must exercise substitution or kerning"
        );
        assert!(
            (nominal_domains[0].0 - scalar_sum).abs() < 0.001,
            "{family}: nominal width {} != scalar sum {scalar_sum}",
            nominal_domains[0].0
        );
        assert!(
            nominal_domains[0].0 > advanced_domains[0].0 + 0.01,
            "{family}: pair processing must affect measured width"
        );
        let a = nominal.render(0.25).unwrap();
        let b = advanced.render(0.25).unwrap();
        assert!(
            a.rgba != b.rgba,
            "{family}: shaping difference must reach rendered pixels"
        );
        assert_ne!(a.fingerprint, b.fingerprint);
    }
}

#[test]
fn nominal_policy_reaches_wrap_measurement_and_preserves_each_glyph_after_reflow() {
    let text = "AV AV";
    let advanced_width = width(style("Arimo", Some("advanced")), text);
    let nominal_width = width(style("Arimo", Some("nominal")), text);
    assert!(nominal_width > advanced_width + 0.01);
    let limit = (advanced_width + nominal_width) / 2.0;
    let make = |mode| {
        let mut body = style("Arimo", Some(mode));
        body["scene"]["value"]["layout"]["width"]["value"] = json!(limit);
        compile(body, text)
    };
    let mut advanced = make("advanced");
    let mut nominal = make("nominal");
    let joined = advanced.render(0.25).unwrap();
    let wrapped = nominal.render(0.25).unwrap();
    assert_eq!(
        joined.hits.len(),
        1,
        "advanced pair fits the configured line"
    );
    assert_eq!(wrapped.hits.len(), 2, "nominal pair exceeds the same width");
    let domains = glyph_domains(&mut nominal, 0.25);
    assert_eq!(
        domains.len(),
        4,
        "wrapping must preserve all visible scalar glyphs"
    );
    assert!(domains.iter().all(|(w, _)| *w <= limit + 0.001));
    assert!(
        domains
            .iter()
            .any(|(_, baseline)| (baseline - domains[0].1).abs() > 1.0)
    );
    assert!(joined.rgba != wrapped.rgba);
    for time in [2.25, 0.5, 3.5, 0.25] {
        let actual = nominal.render(time).unwrap();
        let fresh = make("nominal").render(time).unwrap();
        assert!(
            actual.rgba == fresh.rgba,
            "wrapped nominal scene changed on seek to {time}"
        );
        assert_eq!(actual.fingerprint, fresh.fingerprint);
    }
}

fn label_style(mode: &str) -> Value {
    let mut body: Value = serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/bound-label.json"
    ))
    .unwrap();
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([
            json!("caption-font-shaping/1"),
            json!("caption-gradient-space/1"),
        ]);
    scene["layout"]["x"]["value"] = json!(160);
    scene["layout"]["y"]["value"] = json!(90);
    scene["nodes"].as_array_mut().unwrap().truncate(2);
    scene["nodes"][0]["style"]["fontFamily"] = json!("Arimo");
    scene["nodes"][0]["properties"] = json!({"opacity":{"kind":"constant","value":0}});
    let label = &mut scene["nodes"][1]["children"][0];
    label["text"]["text"] = json!("ff");
    label["style"] = json!({"fontFamily":"Rubik","fontWeight":400,"fontShaping":mode,
        "fontSize":{"value":32,"basis":"absolute"},"paints":paint()});
    label["properties"] = json!({"fontSize":{"kind":"keyframes",
        "clock":{"unit":"page","origin":"start","duration":{"kind":"unit-span"}},
        "keys":[{"at":0,"value":32},{"at":1,"value":48}],
        "fill":{"before":"hold","after":"hold"}}});
    body
}

#[test]
fn nominal_repeat_label_uses_its_own_policy_and_dynamic_size_on_random_page_seek() {
    let text = "One two three four";
    let body = label_style("nominal");
    let mut nominal = compile(body.clone(), text);
    let mut advanced = compile(label_style("advanced"), text);
    let small = glyph_domains(&mut nominal, 0.1);
    let larger = glyph_domains(&mut nominal, 0.8);
    assert_eq!(
        small.len(),
        2,
        "nominal Label ff must remain two scalar glyphs"
    );
    assert_eq!(larger.len(), 2);
    assert!(
        larger[0].0 > small[0].0,
        "dynamic label font size must reshape with the same policy"
    );
    assert_eq!(
        glyph_domains(&mut advanced, 0.1).len(),
        1,
        "Advanced label retains ff ligature"
    );
    let reference = advanced.render(0.25).unwrap();
    assert!(nominal.render(0.25).unwrap().rgba != reference.rgba);
    for time in [2.25, 0.8, 3.1, 0.1, 2.8, 0.25] {
        let actual = nominal.render(time).unwrap();
        let fresh = compile(body.clone(), text).render(time).unwrap();
        assert!(actual.rgba == fresh.rgba, "label seek to {time}");
        assert_eq!(actual.fingerprint, fresh.fingerprint);
        assert_eq!(glyph_domains(&mut nominal, time).len(), 2);
    }
    // Return the warmed font engine to another scene; cached nominal glyphs
    // must not change the default/Advanced result for the same font and text.
    let mut restored =
        compile_with_fonts(label_style("advanced"), text, nominal.into_text_engine());
    let restored = restored.render(0.25).unwrap();
    assert!(restored.rgba == reference.rgba);
    assert_eq!(restored.fingerprint, reference.fingerprint);
}

#[test]
fn nominal_mixed_hebrew_typography_keeps_whole_line_rtl_order_in_draw_coordinates() {
    let mut body = style("Arimo", Some("nominal"));
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([
            json!("caption-word-line-layout/1"),
            json!("caption-unit-font-size/1"),
        ]);
    scene["layout"]["pagination"] = json!({"wordLinePattern":[[3]]});
    scene["layout"]["layoutEvaluation"] = json!("per-sample");
    scene["nodes"][0]["style"]["fontSize"]["value"] = json!(12);
    scene["nodes"][0]["style"]["paints"] = json!([]);
    scene["selectors"] = json!([
        {"id":"alef","nodeId":"caption","unit":"word","filter":{"kind":"range","start":0,"end":1}},
        {"id":"bet","nodeId":"caption","unit":"word","filter":{"kind":"range","start":1,"end":2}},
        {"id":"gimel","nodeId":"caption","unit":"word","filter":{"kind":"range","start":2,"end":3}}
    ]);
    scene["layout"]["fontSizeBindings"] = json!([
        {"id":"middle-size","nodeId":"caption","selectorId":"bet","value":{"kind":"constant","value":24}}
    ]);
    scene["animations"] = json!([
        {"id":"red","target":{"nodeId":"caption","selectorId":"alef"},"property":"fill","composite":"replace","value":{"kind":"constant","value":"#FF0000"}},
        {"id":"green","target":{"nodeId":"caption","selectorId":"bet"},"property":"fill","composite":"replace","value":{"kind":"constant","value":"#00FF00"}},
        {"id":"blue","target":{"nodeId":"caption","selectorId":"gimel"},"property":"fill","composite":"replace","value":{"kind":"constant","value":"#0000FF"}}
    ]);
    let make = || {
        ScenePlan::compile(
            parse_style(&body).unwrap(),
            Presentation::default(),
            vec![SceneCue {
                id: "cue".into(),
                document_id: "doc".into(),
                text: "אבג".into(),
                start: 0.0,
                end: 4.0,
                words: ["א", "ב", "ג"]
                    .into_iter()
                    .enumerate()
                    .map(|(i, text)| SceneWord {
                        id: format!("w{i}"),
                        text: text.into(),
                        start: i as f64,
                        end: i as f64 + 0.8,
                    })
                    .collect(),
            }],
            (320, 180),
            fonts(),
            "rtl-typography".into(),
        )
        .unwrap()
    };
    let scalar_advance = |text, size| {
        let mut body = style("Arimo", Some("nominal"));
        body["scene"]["value"]["nodes"][0]["style"]["fontSize"]["value"] = json!(size);
        width(body, text)
    };
    let bet_advance = scalar_advance("ב", 24);
    let gimel_advance = scalar_advance("ג", 12);
    let mut reused = make();
    for seconds in [2.5, 0.25, 1.5, 3.25, 0.25] {
        let (frame, _) = reused.record(seconds).unwrap();
        let mut origins = [None; 3];
        for op in &frame.ops {
            let DrawOp::FillPath { color, tf, .. } = op else {
                continue;
            };
            let channel = (0..3)
                .find(|i| color[*i] > 0.9)
                .expect("glyph keeps its source-unit paint");
            assert!(
                origins[channel].replace(f64::from(tf[4])).is_none(),
                "one outline per scalar"
            );
        }
        let [alef, bet, gimel] =
            origins.map(|v| v.expect("all Hebrew source scalars must be drawn"));
        assert!(
            alef > bet && bet > gimel,
            "logical א ב ג must draw RTL across typography boundaries: {origins:?}"
        );
        assert!(
            (alef - bet - bet_advance).abs() < 0.001,
            "24 px middle advance must place the rightmost scalar: {} != {bet_advance}",
            alef - bet
        );
        assert!(
            (bet - gimel - gimel_advance).abs() < 0.001,
            "12 px final advance must place the middle scalar: {} != {gimel_advance}",
            bet - gimel
        );
        let actual = reused.render(seconds).unwrap();
        let fresh = make().render(seconds).unwrap();
        assert!(actual.rgba == fresh.rgba, "mixed RTL seek to {seconds}");
        assert_eq!(actual.fingerprint, fresh.fingerprint);
    }
}
