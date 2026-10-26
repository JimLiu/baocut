use caption_scene::*;
use serde_json::{Value, json};

/// A template with every colour position the summary classifies: a node-fill text with an outer
/// stroke and an offset shadow, an active-word colour, a keyword stack, a word box and a
/// keyframed fill.
fn template() -> Value {
    json!({
        "schema": "baocut.caption-scene-style/1",
        "scene": {"kind": "inline", "value": {
            "schema": "baocut.caption-scene/1",
            "evaluationVersion": 1,
            "requiredCapabilities": ["caption-paint-stack/1", "caption-paint-effects/1", "caption-paint-style-bindings/1"],
            "parameters": [{"id": "accent", "type": "color", "default": "#FFFFFF"}],
            "layout": {
                "width": {"value": 0.8, "basis": "canvasWidth"},
                "x": {"value": 0.5, "basis": "canvasWidth"},
                "y": {"value": 0.8, "basis": "canvasHeight"},
                "maxLines": 2,
                "pagination": {"maxUnitsPerPage": 3}
            },
            "nodes": [
                {"id": "caption", "type": "text", "text": {"source": "cue"},
                 "style": {"fontFamily": "Display Sans", "fontWeight": 800, "letterSpacing": 0.02,
                           "fontSize": {"value": 0.06, "basis": "canvasShortEdge"}, "fill": "#FFFFFF",
                           "paints": [
                               {"id": "outer", "unit": "em", "strokeWidth": 0.2, "paint": {"kind": "solid", "color": "#000000CC"}},
                               {"id": "drop", "unit": "em", "offset": [0.05, 0.08], "paint": {"kind": "solid", "color": "#00000080"}},
                               {"id": "body", "paint": {"kind": "node-fill"}}
                           ]},
                 "stateStyles": {"unit": "word", "active": {"fill": "#FFE600"}}},
                {"id": "boxes", "type": "repeat", "selectorId": "active-words", "children": [
                    {"id": "box", "type": "shape", "properties": {
                        "width": {"kind": "constant", "value": 40}, "height": {"kind": "constant", "value": 20},
                        "fill": {"kind": "constant", "value": "#FF3366"}}}
                ]}
            ],
            "selectors": [
                {"id": "words", "nodeId": "caption", "unit": "word"},
                {"id": "keywords", "nodeId": "caption", "unit": "word", "filter": {"kind": "tag", "value": "keyword"}},
                {"id": "active-words", "nodeId": "caption", "unit": "word", "filter": {"kind": "state", "value": "active"}}
            ],
            "paintStyleBindings": [
                {"id": "kw", "nodeId": "caption", "selectorId": "keywords", "style": {"fill": "#22DDFF", "paints": [
                    {"id": "outer", "unit": "em", "strokeWidth": 0.2, "paint": {"kind": "solid", "color": "#000000CC"}},
                    {"id": "drop", "unit": "em", "offset": [0.05, 0.08], "paint": {"kind": "solid", "color": "#00000080"}},
                    {"id": "body", "paint": {"kind": "node-fill"}}
                ]}}
            ],
            "animations": [
                {"id": "flash", "target": {"nodeId": "box"}, "property": "opacity", "composite": "multiply",
                 "value": {"kind": "keyframes", "clock": {"unit": "word", "origin": "start", "duration": {"kind": "fixed", "ticks": 200, "timescale": 1000}},
                           "keys": [{"at": 0, "value": 0}, {"at": 1, "value": 1}]}}
            ]
        }}
    })
}

fn with(body: &Value, key: &str, value: Value) -> Value {
    let mut out = body.clone();
    out[key] = value;
    out
}

#[test]
fn template_fixture_is_valid() {
    parse_style(&template()).expect("template validates");
}

#[test]
fn summary_lists_colours_by_use_and_skips_parameter_defaults() {
    let style = parse_style(&template()).unwrap();
    let summary = describe(style.scene(), None, None);
    let colors: Vec<(&str, Vec<&str>)> = summary.colors.iter().map(|c| (c.value.as_str(), c.uses.clone())).collect();
    assert_eq!(
        colors,
        vec![
            ("#FFFFFFFF", vec!["text"]),
            ("#000000CC", vec!["stroke"]),
            ("#00000080", vec!["shadow"]),
            ("#FFE600FF", vec!["active"]),
            ("#22DDFFFF", vec!["keyword"]),
            ("#FF3366FF", vec!["word-box"]),
        ]
    );
    assert!(summary.colors.iter().all(|c| !c.animated));
    assert_eq!(summary.fonts.len(), 1);
    assert_eq!(summary.fonts[0].key, "Display Sans");
    assert_eq!(summary.fonts[0].weight, 800);
    assert!(summary.fonts[0].tuned_spacing);
    assert_eq!(summary.word_tags, vec!["keyword".to_string()]);
    for tag in ["active-color", "active-box", "stroke", "shadow", "plate", "keyword"] {
        assert!(summary.behaviors.contains(&tag), "missing {tag}: {:?}", summary.behaviors);
    }
    assert!(summary.needs_word_timing);
    assert!(!summary.seeded);
    assert_eq!(summary.pagination.mode, "auto");
    assert_eq!(summary.pagination.words_per_page, Some(3));
    assert_eq!(summary.adjustable.placement, vec!["x", "y", "width"]);
    assert!(summary.adjustable.colors && summary.adjustable.fonts && summary.adjustable.font_scale);
    let kinds: Vec<&str> = summary.layers.iter().map(|l| l.kind).collect();
    assert_eq!(kinds, vec!["stroke", "shadow", "fill", "box"]);
}

#[test]
fn colour_swap_replaces_every_literal_and_keeps_alpha() {
    let body = with(
        &template(),
        "adjust",
        json!({"colors": [{"from": "#000000CC", "to": "#3355FF"}, {"from": "#ffffff", "to": "#FFEEDD"}]}),
    );
    let style = parse_style(&body).unwrap();
    let rendered = style.rendered().unwrap();
    let scene = serde_json::to_value(rendered.scene()).unwrap();
    // Base stack and the keyword stack both change; the swap kept the original alpha.
    assert_eq!(scene.pointer("/nodes/0/style/paints/0/paint/color"), Some(&json!("#3355FFCC")));
    assert_eq!(
        scene.pointer("/paintStyleBindings/0/style/paints/0/paint/color"),
        Some(&json!("#3355FFCC"))
    );
    assert_eq!(scene.pointer("/nodes/0/style/fill"), Some(&json!("#FFEEDD")));
    // Parameter defaults are left to `parameters`.
    assert_eq!(scene.pointer("/parameters/0/default"), Some(&json!("#FFFFFF")));
    assert!(rendered.adjust.is_none() && rendered.origin.is_none());
    // The summary keys by the template value and carries the adjusted value.
    let summary = describe(style.scene(), style.adjust.as_ref(), None);
    let stroke = summary.colors.iter().find(|c| c.value == "#000000CC").unwrap();
    assert_eq!(stroke.to.as_deref(), Some("#3355FFCC"));
}

#[test]
fn font_swap_replaces_family_and_drops_the_exact_face() {
    let mut body = template();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-font-source/1"));
    body["scene"]["value"]["nodes"][0]["style"]["fontSource"] = json!({"sha256": "a".repeat(64)});
    let body = with(
        &body,
        "adjust",
        json!({"fonts": [{"from": "Display Sans", "to": {"family": "Serif Two", "weight": 600}}]}),
    );
    let style = parse_style(&body).unwrap();
    let scene = style.resolved().unwrap().scene;
    let text = &scene.nodes[0].style;
    assert_eq!(text.font_family, "Serif Two");
    assert_eq!(text.font_weight, 600);
    assert!(text.font_source.is_none());
    let summary = describe(style.scene(), style.adjust.as_ref(), None);
    assert_eq!(summary.fonts[0].to.as_ref().map(|t| t.family.as_str()), Some("Serif Two"));
}

#[test]
fn font_scale_multiplies_sizes_and_wraps_expressions() {
    let mut body = template();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([json!("caption-layout-per-sample/1"), json!("caption-expressions/1")]);
    body["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
    body["scene"]["value"]["layout"]["bindings"] = json!([{"nodeId": "caption", "property": "fontSize", "value": {
        "kind": "expression", "expression": {"op": "literal", "type": "length", "value": 30}}}]);
    let body = with(&body, "adjust", json!({"fontScale": 1.5}));
    let style = parse_style(&body).unwrap();
    let scene = style.resolved().unwrap().scene;
    assert!((scene.nodes[0].style.font_size.value - 0.09).abs() < 1e-12);
    let binding = serde_json::to_value(&scene.layout.bindings[0].value).unwrap();
    assert_eq!(binding.pointer("/expression/function"), Some(&json!("mul")));
    assert_eq!(binding.pointer("/expression/args/1/value"), Some(&json!(1.5)));
}

#[test]
fn placement_overrides_constants_and_reports_computed_keys() {
    let mut body = template();
    body["scene"]["value"]["parameters"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id": "lift", "type": "scalar", "default": 0.8}));
    body["scene"]["value"]["layout"]["y"] = json!({"value": 1, "parameter": "lift", "basis": "canvasHeight"});
    let body = with(&body, "adjust", json!({"placement": {"x": 0.4, "y": 0.2}}));
    let style = parse_style(&body).unwrap();
    let adjusted = style.resolved().unwrap();
    assert_eq!(adjusted.scene.layout.x.value, 0.4);
    assert_eq!(adjusted.scene.layout.y.parameter.as_deref(), Some("lift"));
    assert_eq!(adjusted.diagnostics.len(), 1);
    assert_eq!(adjusted.diagnostics[0].code, ADJUST_UNSUPPORTED);
    assert_eq!(adjusted.diagnostics[0].path, "adjust.placement.y");
    assert_eq!(describe(style.scene(), None, None).adjustable.placement, vec!["x", "width"]);
    // The summary reports the adjusted value, the template's own value, and nothing for computed keys.
    let placement = describe(style.scene(), style.adjust.as_ref(), None).placement;
    assert_eq!((placement.x, placement.y, placement.width), (Some(0.4), None, Some(0.8)));
}

#[test]
fn summary_placement_converts_other_bases_with_the_canvas() {
    let mut body = template();
    body["scene"]["value"]["layout"]["y"] = json!({"value": 0.8, "basis": "canvasWidth"});
    body["scene"]["value"]["layout"]["x"] = json!({"value": 360, "basis": "absolute", "offset": 36});
    let style = parse_style(&body).unwrap();
    let without = describe(style.scene(), None, None).placement;
    assert_eq!((without.x, without.y, without.width), (None, None, Some(0.8)));
    let with_canvas = describe(style.scene(), None, Some((720, 1280))).placement;
    assert_eq!(with_canvas.x, Some(396.0 / 720.0));
    assert_eq!(with_canvas.y, Some(0.8 * 720.0 / 1280.0));
}

#[test]
fn invalid_adjust_and_origin_are_rejected() {
    for adjust in [
        json!({"fontScale": 3}),
        json!({"colors": [{"from": "#FFF", "to": "#000000"}]}),
        json!({"colors": [{"from": "#FFFFFF", "to": "#000000"}, {"from": "#ffffffff", "to": "#111111"}]}),
        json!({"placement": {"y": 1.5}}),
        json!({"unknown": 1}),
    ] {
        assert!(parse_style(&with(&template(), "adjust", adjust.clone())).is_err(), "{adjust}");
    }
    let origin = json!({"template": {"id": "t", "revision": 1}, "sceneSha256": "XYZ"});
    assert!(parse_style(&with(&template(), "origin", origin)).is_err());
    let origin = json!({"pack": {"id": "p", "version": "1.0.0"}, "template": {"id": "t", "revision": 2}, "sceneSha256": "b".repeat(64)});
    let style = parse_style(&with(&template(), "origin", origin.clone())).unwrap();
    assert_eq!(serde_json::to_value(&style).unwrap()["origin"], origin);
}

#[test]
fn an_alpha_swap_that_breaks_a_scene_contract_is_rejected() {
    // Spread layers need opaque gradient stops; making a stop translucent must fail validation.
    let mut body = template();
    body["scene"]["value"]["nodes"][0]["style"]["paints"][0] = json!({"id": "outer", "unit": "em", "spread": 0.1,
        "paint": {"kind": "linear", "from": [0, 0], "to": [0, 1], "stops": [{"at": 0, "color": "#FF0000"}, {"at": 1, "color": "#0000FF"}]}});
    parse_style(&body).expect("opaque stops validate");
    let body = with(&body, "adjust", json!({"colors": [{"from": "#FF0000", "to": "#FF000080"}]}));
    assert!(parse_style(&body).is_err());
}

#[test]
fn styles_without_adjust_serialize_unchanged() {
    let body = template();
    let style = parse_style(&body).unwrap();
    let out = serde_json::to_value(&style).unwrap();
    assert!(out.get("adjust").is_none() && out.get("origin").is_none());
}

#[test]
fn summary_serializes_with_the_protocol_field_names() {
    let style = parse_style(&template()).unwrap();
    let value = serde_json::to_value(describe(style.scene(), None, None)).unwrap();
    let keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
    for key in [
        "colors",
        "fonts",
        "wordTags",
        "behaviors",
        "tiers",
        "needsWordTiming",
        "seeded",
        "pagination",
        "layers",
        "adjustable",
        "placement",
    ] {
        assert!(keys.contains(&key), "{key} in {keys:?}");
    }
    assert_eq!(value.pointer("/pagination/wordsPerPage"), Some(&json!(3)));
    assert_eq!(value.pointer("/fonts/0/tunedSpacing"), Some(&json!(true)));
    assert_eq!(value.pointer("/layers/0/nodeId"), Some(&json!("caption")));
    assert_eq!(value.pointer("/adjustable/fontScale"), Some(&json!(true)));
    assert_eq!(value.pointer("/adjustable/placement"), Some(&json!(["x", "y", "width"])));
    assert_eq!(value.pointer("/placement"), Some(&json!({"x": 0.5, "y": 0.8, "width": 0.8})));
}
