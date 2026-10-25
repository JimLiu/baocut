//! Sampled word paint properties use the existing static paint path as oracle.
//! All text, timing and paint choices are authored generic test inputs.
use caption_scene::{Presentation, parse_style};
use render_raster::{TextEngine, drawop::DrawOp};
use serde_json::{Value, json};
use subtitle_render::scene::{SceneCue, ScenePlan, SceneWord};

const W: u32 = 320;
const H: u32 = 160;

fn fill() -> Value {
    json!({"id":"fill","paint":{"kind":"node-fill"}})
}
fn shadow(id: &str, color: &str, blur: f64) -> Value {
    json!({"id":id,"unit":"em","offset":[-0.2,0.05],"spread":0.25,
        "blur":blur,"paint":{"kind":"solid","color":color}})
}
fn body() -> Value {
    json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
        "schema":"baocut.caption-scene/1","evaluationVersion":1,
        "requiredCapabilities":["caption-scene/1","caption-paint-stack/1","caption-paint-effects/1"],
        "layout":{"width":{"value":300,"basis":"absolute"},"x":{"value":160,"basis":"absolute"},
            "y":{"value":80,"basis":"absolute"},"maxLines":1,"overflow":"visible",
            "pagination":{"unit":"word","maxUnitsPerPage":8}},
        "speechState":{"gapPolicy":"none","tailPolicy":"none"},
        "nodes":[{"id":"ink","type":"text","style":{"fontFamily":"Arimo","fontWeight":400,
            "fontSize":{"value":48,"basis":"absolute"},"fill":"#FFFF00FF",
            "paints":[shadow("shadow", "#0000FFFF", 0.0625), fill()]}}],
        "selectors":[
            selector("all", json!({"kind":"all"})),
            selector("first", json!({"kind":"range","start":0,"end":1})),
            selector("second", json!({"kind":"range","start":1,"end":2}))
        ],"animations":[]
    }}})
}
fn scene(body: &mut Value) -> &mut Value {
    &mut body["scene"]["value"]
}
fn selector(id: &str, filter: Value) -> Value {
    json!({"id":id,"nodeId":"ink","unit":"word","filter":filter})
}
fn cap(body: &mut Value, id: &str) {
    let caps = scene(body)["requiredCapabilities"].as_array_mut().unwrap();
    if !caps.iter().any(|c| c == id) {
        caps.push(json!(id));
    }
}
fn property(
    id: &str,
    selected: &str,
    paint: &str,
    name: &str,
    composite: &str,
    value: Value,
) -> Value {
    json!({"id":id,"nodeId":"ink","selectorId":selected,"paintId":paint,
        "property":name,"composite":composite,"value":value})
}
fn constant(value: Value) -> Value {
    json!({"kind":"constant","value":value})
}
fn properties(body: &mut Value, bindings: Value) {
    cap(body, "caption-unit-paint-properties/1");
    scene(body)["paintPropertyBindings"] = bindings;
}
fn static_binding(id: &str, selected: &str, paints: Value) -> Value {
    json!({"id":id,"nodeId":"ink","selectorId":selected,"style":{"paints":paints}})
}
fn sizes(body: &mut Value) {
    cap(body, "caption-unit-font-size/1");
    cap(body, "caption-word-line-layout/1");
    cap(body, "caption-layout-per-sample/1");
    let scene = scene(body);
    scene["layout"]["layoutEvaluation"] = json!("per-sample");
    scene["layout"]["pagination"] = json!({"wordLinePattern":[[2]]});
    scene["layout"]["fontSizeBindings"] = json!([
        {"id":"small","nodeId":"ink","selectorId":"first","value":{"kind":"constant","value":24}},
        {"id":"large","nodeId":"ink","selectorId":"second","value":{"kind":"constant","value":64}}
    ]);
}
fn words(text: &str) -> Vec<SceneWord> {
    text.split_whitespace()
        .enumerate()
        .map(|(i, text)| SceneWord {
            id: format!("w{i}"),
            text: text.into(),
            start: i as f64,
            end: i as f64 + 1.,
        })
        .collect()
}
fn try_compile(
    body: Value,
    text: &str,
    words: Vec<SceneWord>,
    tags: &[(&str, &[&str])],
) -> anyhow::Result<ScenePlan> {
    let mut presentation = Presentation::default();
    for (id, values) in tags {
        presentation
            .word_tags
            .insert((*id).into(), values.iter().map(|s| (*s).into()).collect());
    }
    ScenePlan::compile(
        parse_style(&body).unwrap(),
        presentation,
        vec![SceneCue {
            id: "cue".into(),
            document_id: "speech".into(),
            text: text.into(),
            start: 0.,
            end: 6.,
            words,
        }],
        (W, H),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/Arimo.ttf"
        )
        .to_vec()]),
        "paint-property-bindings".into(),
    )
}
fn compile(body: Value, text: &str) -> ScenePlan {
    try_compile(body, text, words(text), &[]).unwrap()
}
fn pixels(body: Value, text: &str, time: f64) -> Vec<u8> {
    compile(body, text)
        .render(time)
        .unwrap()
        .rgba
        .as_ref()
        .clone()
}
fn without_properties(mut body: Value) -> Value {
    scene(&mut body)
        .as_object_mut()
        .unwrap()
        .remove("paintPropertyBindings");
    body
}
fn static_words(
    mut body: Value,
    left_color: &str,
    left_blur: f64,
    right_color: &str,
    right_blur: f64,
) -> Value {
    // Distinct old layer IDs deliberately force independent blur surfaces. The
    // shared fill ID puts BOTH shadows before ALL fills, even when they overlap.
    body = without_properties(body);
    cap(&mut body, "caption-paint-style-bindings/1");
    scene(&mut body)["nodes"][0]["style"]["paints"] =
        json!([shadow("shadow-left", left_color, left_blur), fill()]);
    scene(&mut body)["paintStyleBindings"] = json!([static_binding(
        "right-stack",
        "second",
        json!([shadow("shadow-right", right_color, right_blur), fill()])
    )]);
    body
}

#[test]
fn same_em_blur_uses_each_real_font_size_and_all_shadows_precede_fills() {
    let mut dynamic = body();
    sizes(&mut dynamic);
    properties(
        &mut dynamic,
        json!([
            property(
                "red",
                "all",
                "shadow",
                "color",
                "replace",
                constant(json!("#FF0000FF"))
            ),
            property(
                "soft",
                "all",
                "shadow",
                "blur",
                "replace",
                constant(json!(0.125))
            )
        ]),
    );
    let expected = static_words(dynamic.clone(), "#FF0000FF", 0.125, "#FF0000FF", 0.125);
    let actual = pixels(dynamic.clone(), "H H", 0.25);
    assert_eq!(actual, pixels(expected, "H H", 0.25));

    let mut old_shared = without_properties(dynamic.clone());
    scene(&mut old_shared)["nodes"][0]["style"]["paints"] =
        json!([shadow("shadow", "#FF0000FF", 0.125), fill()]);
    assert_ne!(
        actual,
        pixels(old_shared, "H H", 0.25),
        "the independent oracle must expose the old shared max-sigma failure"
    );
    let (frame, _) = compile(dynamic, "H H").record(0.25).unwrap();
    assert_eq!(
        frame
            .ops
            .iter()
            .filter(|op| matches!(op, DrawOp::DrawBitmap { .. }))
            .count(),
        2
    );
    let first_fill = frame
        .ops
        .iter()
        .position(|op| matches!(op, DrawOp::FillPathPaint { .. }))
        .unwrap();
    let last_shadow = frame
        .ops
        .iter()
        .rposition(|op| matches!(op, DrawOp::DrawBitmap { .. }))
        .unwrap();
    assert!(
        last_shadow < first_fill,
        "a later word's shadow cannot cover an earlier fill"
    );
}

#[test]
fn declaration_order_composes_blur_and_last_color_replaces() {
    let mut dynamic = body();
    properties(
        &mut dynamic,
        json!([
            property(
                "replace",
                "all",
                "shadow",
                "blur",
                "replace",
                constant(json!(0.25))
            ),
            property(
                "subtract",
                "all",
                "shadow",
                "blur",
                "add",
                constant(json!(-0.125))
            ),
            property(
                "multiply",
                "all",
                "shadow",
                "blur",
                "multiply",
                constant(json!(2))
            ),
            property(
                "red",
                "all",
                "shadow",
                "color",
                "replace",
                constant(json!("#FF0000FF"))
            ),
            property(
                "green",
                "all",
                "shadow",
                "color",
                "replace",
                constant(json!("#00FF00FF"))
            )
        ]),
    );
    let mut expected = without_properties(dynamic.clone());
    scene(&mut expected)["nodes"][0]["style"]["paints"] =
        json!([shadow("shadow", "#00FF00FF", 0.25), fill()]);
    let actual = pixels(dynamic.clone(), "H", 0.25);
    assert_eq!(actual, pixels(expected, "H", 0.25));
    scene(&mut dynamic)["paintPropertyBindings"]
        .as_array_mut()
        .unwrap()
        .swap(1, 2);
    let changed = pixels(dynamic.clone(), "H", 0.25);
    assert_ne!(actual, changed);
    let mut expected = without_properties(dynamic);
    scene(&mut expected)["nodes"][0]["style"]["paints"] =
        json!([shadow("shadow", "#00FF00FF", 0.375), fill()]);
    assert_eq!(changed, pixels(expected, "H", 0.25));
}

#[test]
fn final_composed_blur_range_is_checked_in_the_selected_layers_unit() {
    for (unit, base, composite, operand) in [
        ("em", 0.125, "add", -0.25),
        ("em", 0.125, "replace", 4.125),
        ("em", 0.125, "multiply", 40.),
        ("px", 1., "add", -2.),
        ("px", 1., "replace", 257.),
        ("px", 1., "multiply", 300.),
    ] {
        let mut dynamic = body();
        scene(&mut dynamic)["nodes"][0]["style"]["paints"][0]["unit"] = json!(unit);
        scene(&mut dynamic)["nodes"][0]["style"]["paints"][0]["blur"] = json!(base);
        properties(
            &mut dynamic,
            json!([property(
                "invalid",
                "all",
                "shadow",
                "blur",
                composite,
                constant(json!(operand))
            )]),
        );
        let err = compile(dynamic, "H")
            .render(0.25)
            .err()
            .expect("invalid sampled blur must fail");
        assert!(
            err.to_string().contains("CAPTION_PAINT_INVALID"),
            "{unit} {composite} {operand}: {err}"
        );
    }
}

#[test]
fn selected_stack_without_target_is_noop_and_never_allocates_a_missing_layer() {
    let mut dynamic = body();
    cap(&mut dynamic, "caption-paint-style-bindings/1");
    scene(&mut dynamic)["paintStyleBindings"] =
        json!([static_binding("plain", "all", json!([fill()]))]);
    // This operand is invalid if sampled. Its missing target must skip BOTH
    // sampling and allocation after the complete static stack was selected.
    properties(
        &mut dynamic,
        json!([
            property(
                "absent",
                "all",
                "shadow",
                "blur",
                "replace",
                constant(json!(1000))
            ),
            property(
                "no-resurrection",
                "all",
                "shadow",
                "color",
                "replace",
                constant(json!("#FF0000FF"))
            )
        ]),
    );
    let expected = pixels(without_properties(dynamic.clone()), "H H", 0.25);
    let mut plan = compile(dynamic, "H H");
    assert_eq!(plan.render(0.25).unwrap().rgba.as_ref(), &expected);
    let (frame, _) = plan.record(0.25).unwrap();
    assert!(
        !frame
            .ops
            .iter()
            .any(|op| matches!(op, DrawOp::DrawBitmap { .. }))
    );
}

fn clock_keys(values: [Value; 3]) -> Value {
    json!({"kind":"keyframes","clock":{"unit":"word","origin":"start","duration":{"kind":"unit-span"}},
        "keys":[{"at":0,"value":values[0]},{"at":0.5,"value":values[1]},{"at":1,"value":values[2]}],
        "fill":{"before":"hold","after":"hold"}})
}
fn timed_words() -> Vec<SceneWord> {
    vec![
        SceneWord {
            id: "w0".into(),
            text: "H".into(),
            start: 1.,
            end: 2.,
        },
        SceneWord {
            id: "w1".into(),
            text: "H".into(),
            start: 3.,
            end: 4.,
        },
    ]
}
#[test]
fn word_clock_state_and_reverse_seek_have_independent_static_pixel_oracles() {
    let mut dynamic = body();
    sizes(&mut dynamic);
    scene(&mut dynamic)["selectors"]
        .as_array_mut()
        .unwrap()
        .push(selector("active", json!({"kind":"state","value":"active"})));
    properties(
        &mut dynamic,
        json!([
            property(
                "palette",
                "all",
                "shadow",
                "color",
                "replace",
                clock_keys([json!("#0000FFFF"), json!("#00FF00FF"), json!("#FF0000FF")])
            ),
            property(
                "blur",
                "all",
                "shadow",
                "blur",
                "replace",
                clock_keys([json!(0.0625), json!(0.125), json!(0.1875)])
            ),
            property(
                "active",
                "active",
                "shadow",
                "color",
                "replace",
                constant(json!("#FFFFFFFF"))
            )
        ]),
    );
    let mut actual = try_compile(dynamic.clone(), "H H", timed_words(), &[]).unwrap();
    let mut frames = Vec::new();
    for (time, left, left_blur, right, right_blur) in [
        (3.5, "#FF0000FF", 0.1875, "#FFFFFFFF", 0.125),
        (1.5, "#FFFFFFFF", 0.125, "#0000FFFF", 0.0625),
        (2.5, "#FF0000FF", 0.1875, "#0000FFFF", 0.0625),
        (1.5, "#FFFFFFFF", 0.125, "#0000FFFF", 0.0625),
    ] {
        let expected = static_words(dynamic.clone(), left, left_blur, right, right_blur);
        let expected = try_compile(expected, "H H", timed_words(), &[])
            .unwrap()
            .render(time)
            .unwrap();
        let frame = actual.render(time).unwrap();
        let fresh = try_compile(dynamic.clone(), "H H", timed_words(), &[])
            .unwrap()
            .render(time)
            .unwrap();
        assert_eq!(frame.rgba, expected.rgba, "semantic word sample {time}");
        assert_eq!(frame.rgba, fresh.rgba);
        assert_eq!(frame.fingerprint, fresh.fingerprint);
        frames.push(frame.rgba);
    }
    assert_ne!(frames[0], frames[1]);
    assert_ne!(frames[1], frames[2]);
    assert_eq!(frames[1], frames[3]);
}

#[test]
fn missing_word_timing_reports_diagnostic_and_does_not_invent_spoken_paints() {
    for binding in [
        property(
            "clock",
            "all",
            "shadow",
            "blur",
            "replace",
            clock_keys([json!(0), json!(0.125), json!(0)]),
        ),
        property(
            "state",
            "active",
            "shadow",
            "color",
            "replace",
            constant(json!("#FF0000FF")),
        ),
    ] {
        let mut dynamic = body();
        scene(&mut dynamic)["selectors"]
            .as_array_mut()
            .unwrap()
            .push(selector("active", json!({"kind":"state","value":"active"})));
        properties(&mut dynamic, json!([binding]));
        let mut expected =
            try_compile(without_properties(dynamic.clone()), "H H", vec![], &[]).unwrap();
        let mut actual = try_compile(dynamic, "H H", vec![], &[]).unwrap();
        assert!(
            actual
                .diagnostics
                .iter()
                .any(|d| d.code == "CAPTION_TIMING_UNAVAILABLE")
        );
        for time in [0.25, 2.5, 4.5, 0.25] {
            assert_eq!(
                actual.render(time).unwrap().rgba,
                expected.render(time).unwrap().rgba,
                "missing real timing must disable a spoken paint track at {time}"
            );
        }
    }
}

#[test]
fn no_new_binding_preserves_old_pixels_fingerprint_and_omitted_serialization() {
    let legacy = body();
    let mut empty = legacy.clone();
    scene(&mut empty)["paintPropertyBindings"] = json!([]);
    let old = parse_style(&legacy).unwrap();
    let new = parse_style(&empty).unwrap();
    assert_eq!(old, new);
    let saved = serde_json::to_value(&new).unwrap();
    assert!(
        saved["scene"]["value"]
            .get("paintPropertyBindings")
            .is_none()
    );
    let mut expected = compile(legacy, "H H");
    let mut actual = compile(empty, "H H");
    for time in [4.5, 0.25, 1.75, 0.25] {
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
fn property_targets_the_selected_static_stack_and_uses_that_layers_own_unit() {
    let mut dynamic = body();
    cap(&mut dynamic, "caption-paint-style-bindings/1");
    let mut px = shadow("shadow", "#FF0000FF", 2.0);
    px["unit"] = json!("px");
    scene(&mut dynamic)["paintStyleBindings"] =
        json!([static_binding("px-right", "second", json!([px, fill()]))]);
    // The same ID is em on the first word and px on the second. This is valid
    // in both domains and must never silently use the base layer's em unit.
    properties(
        &mut dynamic,
        json!([
            property(
                "blue",
                "all",
                "shadow",
                "color",
                "replace",
                constant(json!("#0000FFFF"))
            ),
            property(
                "blur",
                "all",
                "shadow",
                "blur",
                "replace",
                constant(json!(0.125))
            )
        ]),
    );
    let mut expected = without_properties(dynamic.clone());
    scene(&mut expected)["nodes"][0]["style"]["paints"][0]["blur"] = json!(0.125);
    scene(&mut expected)["paintStyleBindings"][0]["style"]["paints"][0]["blur"] = json!(0.125);
    scene(&mut expected)["paintStyleBindings"][0]["style"]["paints"][0]["paint"]["color"] =
        json!("#0000FFFF");
    assert_eq!(pixels(dynamic, "H H", 0.25), pixels(expected, "H H", 0.25));
}

#[test]
fn differing_pose_scales_also_use_independent_device_space_sigmas() {
    let mut dynamic = body();
    scene(&mut dynamic)["animations"] = json!([{
        "id":"larger-pose","target":{"nodeId":"ink","selectorId":"second"},
        "property":"transform.scale","composite":"multiply","value":{"kind":"constant","value":1.5}
    }]);
    properties(
        &mut dynamic,
        json!([property(
            "blur",
            "all",
            "shadow",
            "blur",
            "replace",
            constant(json!(0.125))
        )]),
    );
    let expected = static_words(dynamic.clone(), "#0000FFFF", 0.125, "#0000FFFF", 0.125);
    let actual = pixels(dynamic.clone(), "H H", 0.25);
    assert_eq!(actual, pixels(expected, "H H", 0.25));
    let mut shared = without_properties(dynamic);
    scene(&mut shared)["nodes"][0]["style"]["paints"][0]["blur"] = json!(0.125);
    assert_ne!(actual, pixels(shared, "H H", 0.25));
}

#[test]
fn typed_function_values_and_equal_resolved_layers_share_a_single_blur_surface() {
    let mut dynamic = body();
    cap(&mut dynamic, "caption-expressions/1");
    cap(&mut dynamic, "caption-function-dag/1");
    scene(&mut dynamic)["functions"] = json!([{
        "id":"sigma","arguments":[],"returns":"scalar",
        "body":{"op":"call","function":"mul","args":[
            {"op":"literal","type":"scalar","value":0.25},
            {"op":"literal","type":"scalar","value":0.5}
        ]}
    }]);
    properties(
        &mut dynamic,
        json!([property(
            "blur",
            "all",
            "shadow",
            "blur",
            "replace",
            json!({
                "kind":"expression","expression":{"op":"call","function":"sigma","args":[]}
            })
        )]),
    );
    let mut expected = without_properties(dynamic.clone());
    scene(&mut expected)["nodes"][0]["style"]["paints"][0]["blur"] = json!(0.125);
    assert_eq!(
        pixels(dynamic.clone(), "H H", 0.25),
        pixels(expected, "H H", 0.25)
    );
    let (frame, _) = compile(dynamic, "H H").record(0.25).unwrap();
    assert_eq!(
        frame
            .ops
            .iter()
            .filter(|op| matches!(op, DrawOp::DrawBitmap { .. }))
            .count(),
        1,
        "identical sampled effects at one actual font size must share coverage"
    );
}

#[test]
fn expression_selected_rank_and_count_are_relative_to_the_current_selection() {
    let mut dynamic = body();
    cap(&mut dynamic, "caption-expressions/1");
    scene(&mut dynamic)["selectors"]
        .as_array_mut()
        .unwrap()
        .push(selector(
            "last-two",
            json!({"kind":"range","start":1,"end":3}),
        ));
    properties(
        &mut dynamic,
        json!([property(
            "ranked-blur",
            "last-two",
            "shadow",
            "blur",
            "replace",
            json!({
                "kind":"expression","expression":{"op":"call","function":"mul","args":[
                    {"op":"literal","type":"scalar","value":0.25},
                    {"op":"call","function":"div","args":[
                        {"op":"read","path":"unit.selectedIndex"},
                        {"op":"read","path":"unit.selectedCount"}
                    ]}
                ]}
            })
        )]),
    );
    // Global indices 1/3 and 2/3 would give the wrong sigmas. The selected
    // ranks are exactly 0/2 and 1/2; the unselected first word keeps its base.
    let mut expected = without_properties(dynamic.clone());
    cap(&mut expected, "caption-paint-style-bindings/1");
    scene(&mut expected)["selectors"]
        .as_array_mut()
        .unwrap()
        .push(selector("third", json!({"kind":"range","start":2,"end":3})));
    scene(&mut expected)["nodes"][0]["style"]["paints"] =
        json!([shadow("shadow-first", "#0000FFFF", 0.0625), fill()]);
    scene(&mut expected)["paintStyleBindings"] = json!([
        static_binding(
            "middle-zero",
            "second",
            json!([shadow("shadow-middle", "#0000FFFF", 0.0), fill()])
        ),
        static_binding(
            "last-soft",
            "third",
            json!([shadow("shadow-last", "#0000FFFF", 0.125), fill()])
        )
    ]);
    assert_eq!(
        pixels(dynamic, "H H H", 0.25),
        pixels(expected, "H H H", 0.25)
    );
}
