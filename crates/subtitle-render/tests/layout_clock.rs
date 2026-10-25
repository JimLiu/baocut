use caption_scene::*;
use render_raster::TextEngine;
use render_raster::effects::material_plan::MaterialCommand;
use serde_json::{Value, json};
use subtitle_render::scene::*;

fn literal(ty: &str, value: f64) -> Value {
    json!({"op":"literal","type":ty,"value":value})
}
fn read(path: &str) -> Value {
    json!({"op":"read","path":path})
}
fn call(name: &str, args: Vec<Value>) -> Value {
    json!({"op":"call","function":name,"args":args})
}
fn expression(value: Value) -> Value {
    json!({"kind":"expression","expression":value})
}
fn capability(body: &mut Value, name: &str) {
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!(name));
}
fn loop_time() -> Value {
    let period = call(
        "sub",
        vec![
            read("time.inputLastWordEndSeconds"),
            read("time.inputFirstWordStartSeconds"),
        ],
    );
    call(
        "sub",
        vec![
            read("time.seconds"),
            call(
                "mul",
                vec![
                    period.clone(),
                    call(
                        "floor",
                        vec![call("div", vec![read("time.seconds"), period])],
                    ),
                ],
            ),
        ],
    )
}
fn fixture() -> Value {
    let mut body: Value = serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/page-window.json"
    ))
    .unwrap();
    capability(&mut body, "caption-layout-clock/1");
    capability(&mut body, "caption-expressions/1");
    body["scene"]["value"]["layout"]["clock"] = json!({"time":loop_time()});
    for gap in ["shortGap", "longGap"] {
        body["scene"]["value"]["layout"]["pageWindow"][gap] = json!({"before":0,"after":1});
    }
    body["scene"]["value"]["animations"] = json!([]);
    body
}
fn words() -> Vec<SceneWord> {
    vec![
        SceneWord {
            id: "first".into(),
            text: "MMMM".into(),
            start: 2.0,
            end: 2.75,
        },
        SceneWord {
            id: "last".into(),
            text: "II".into(),
            start: 3.0,
            end: 4.0,
        },
    ]
}
fn plan_with_cue(body: Value, start: f64, end: f64, words: Vec<SceneWord>) -> ScenePlan {
    ScenePlan::compile(
        parse_style(&body).unwrap(),
        Presentation::default(),
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "MMMM II".into(),
            start,
            end,
            words,
        }],
        (160, 90),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "layout-clock-occurrence".into(),
    )
    .unwrap()
}
fn plan(body: Value) -> ScenePlan {
    plan_with_cue(body, 2.0, 8.0, words())
}
fn has_ink(frame: &SceneFrame) -> bool {
    frame.rgba.chunks_exact(4).any(|pixel| pixel[3] != 0)
}
fn cue_keys(first: f64, last: f64) -> Value {
    json!({"kind":"keyframes","clock":{"unit":"cue","origin":"start","duration":{"kind":"fixed","ticks":1,"timescale":1}},"keys":[{"at":0,"value":first},{"at":1,"value":last}],"fill":{"before":"hold","after":"hold"}})
}

#[test]
fn actual_pages_loop_across_multiple_periods_inside_the_original_nonzero_cue_window() {
    let body = fixture();
    let mut scene = plan(body.clone());
    let first = scene.render(2.25).unwrap();
    let second = scene.render(3.25).unwrap();
    assert!(has_ink(&first) && has_ink(&second));
    assert_ne!(
        first.rgba, second.rgba,
        "the real selected page must change"
    );
    for (time, expected) in [
        (4.25, &first),
        (6.25, &first),
        (5.25, &second),
        (7.25, &second),
    ] {
        assert_eq!(
            scene.render(time).unwrap().rgba,
            expected.rgba,
            "loop at {time}"
        );
    }
    for time in [7.25, 2.25, 5.25, 6.25, 3.25, 4.25] {
        let reused = scene.render(time).unwrap();
        let fresh = plan(body.clone()).render(time).unwrap();
        assert_eq!(reused.rgba, fresh.rgba, "reverse seek at {time}");
        assert_eq!(reused.fingerprint, fresh.fingerprint);
    }
    for time in [0.25, 1.999, 8.0, 10.25] {
        assert!(
            !has_ink(&scene.render(time).unwrap()),
            "outer cue activation at {time}"
        );
    }
    // A shared display boundary belongs to the earlier page, while a period
    // boundary wraps before page selection instead of leaving the last page.
    assert_eq!(scene.render(3.0).unwrap().rgba, first.rgba);
    assert_eq!(
        scene
            .render(f64::from_bits(3.0f64.to_bits() + 1))
            .unwrap()
            .rgba,
        second.rgba
    );
    assert_eq!(scene.render(4.0).unwrap().rgba, first.rgba);
}

#[test]
fn full_gap_allocation_reuses_the_exact_input_endpoint_including_its_next_ulp() {
    let mut body = fixture();
    body["scene"]["value"]["layout"]
        .as_object_mut()
        .unwrap()
        .remove("clock");
    let mut timing = words();
    timing[0].start = 0.0;
    timing[0].end = 0.001;
    timing[1].start = 0.009;
    timing[1].end = 0.02;
    assert_ne!(
        timing[0].end + (timing[1].start - timing[0].end),
        timing[1].start
    );
    let mut scene = plan_with_cue(body, 0.0, 0.1, timing);
    let first = scene.render(0.0005).unwrap();
    let last = scene.render(0.015).unwrap();
    assert!(has_ink(&first) && has_ink(&last));
    assert_ne!(first.rgba, last.rgba);
    assert_eq!(scene.render(0.009).unwrap().rgba, first.rgba);
    let next = f64::from_bits(0.009f64.to_bits() + 1);
    assert_eq!(
        scene.render(next).unwrap().rgba,
        last.rgba,
        "the single ULP after the exact source boundary must select the next page"
    );
}

#[test]
fn remapped_word_state_real_font_size_reflow_and_pose_share_the_same_clock() {
    let mut body = fixture();
    capability(&mut body, "caption-unit-font-size/1");
    capability(&mut body, "caption-layout-per-sample/1");
    let scene = &mut body["scene"]["value"];
    scene["layout"]["layoutEvaluation"] = json!("per-sample");
    scene["layout"]["overflow"] = json!("visible");
    scene["selectors"] = json!([
        {"id":"words","nodeId":"caption","unit":"word"},
        {"id":"active","nodeId":"caption","unit":"word","filter":{"kind":"state","value":"active"}}
    ]);
    scene["layout"]["fontSizeBindings"] = json!([{"id":"active-size","nodeId":"caption","selectorId":"active","value":{"kind":"constant","value":24}}]);
    let mut pop = cue_keys(0.75, 1.25);
    pop["clock"]["unit"] = json!("word");
    scene["animations"] = json!([
        {"id":"state","target":{"nodeId":"caption","selectorId":"words"},"property":"fill","composite":"replace","value":expression(json!({"op":"if","condition":read("unit.active"),"then":{"op":"literal","type":"color","value":"#00FF00"},"else":{"op":"literal","type":"color","value":"#FF0000"}}))},
        {"id":"pose","target":{"nodeId":"caption","selectorId":"words"},"property":"transform.scale","composite":"multiply","value":pop}
    ]);
    let mut rendered = plan(body.clone());
    let active = rendered.render(2.25).unwrap();
    let held = rendered.render(2.875).unwrap();
    assert!(active.rgba.chunks_exact(4).any(|p| p[1] > 0 && p[0] == 0));
    assert!(held.rgba.chunks_exact(4).any(|p| p[0] > 0 && p[1] == 0));
    assert_ne!(active.rgba, held.rgba);
    for time in [2.25, 2.5, 2.875, 3.25] {
        assert_eq!(
            rendered.render(time).unwrap().rgba,
            rendered.render(time + 2.0).unwrap().rgba,
            "state, shaping and keyframes at {time}"
        );
    }
    let mut smaller = body;
    smaller["scene"]["value"]["layout"]
        .as_object_mut()
        .unwrap()
        .remove("fontSizeBindings");
    let smaller = plan(smaller).render(2.25).unwrap();
    assert_ne!(
        active.rgba, smaller.rgba,
        "font size must actually reshape glyphs"
    );
    assert!(active.hits[0].bounds.width > smaller.hits[0].bounds.width);
}

#[test]
fn ordinary_material_expressions_and_keyframes_use_the_mapped_early_context() {
    let mut body = fixture();
    capability(&mut body, "caption-blur/1");
    capability(&mut body, "caption-wave-displace/1");
    body["scene"]["value"]["materials"] = json!([
        {"kind":"blur","id":"soften","radius":cue_keys(0.0, 4.0),"passes":1},
        {"kind":"wave-displace","id":"wave","axis":"y","amplitude":{"kind":"constant","value":3},"wavelength":{"kind":"constant","value":24},"phase":expression(call("mul", vec![literal("angle", 4.0), call("div", vec![read("time.seconds"), literal("time", 1.0)])]))}
    ]);
    let mut rendered = plan(body);
    let first = rendered.render(2.25).unwrap();
    assert!(has_ink(&first));
    assert_ne!(first.rgba, rendered.render(2.5).unwrap().rgba);
    for time in [2.25, 2.5, 3.25] {
        assert_eq!(
            rendered.render(time).unwrap().rgba,
            rendered.render(time + 2.0).unwrap().rgba,
            "ordinary materials at {time}"
        );
    }
}

#[test]
fn page_material_cpu_pixels_and_recorded_gpu_uniforms_use_the_mapped_page_context() {
    let mut body = fixture();
    capability(&mut body, "caption-gaussian-axis/1");
    let gaussian: Value = serde_json::from_str(include_str!(
        "../../caption-scene/tests/fixtures/gaussian-axis.json"
    ))
    .unwrap();
    body["scene"]["value"]["materials"] = gaussian["scene"]["value"]["materials"].clone();
    // The sample count is a page-clock keyframe; UV step is a cue-clock
    // expression. Raw endpoint fields must still be present after layout.
    body["scene"]["value"]["materials"][0]["stepUv"] = expression(call(
        "mul",
        vec![
            literal("scalar", 0.003),
            call(
                "div",
                vec![read("time.seconds"), read("time.inputLastWordEndSeconds")],
            ),
        ],
    ));
    let mut rendered = plan(body);
    let first = rendered.render(2.25).unwrap();
    assert!(has_ink(&first));
    assert_ne!(first.rgba, rendered.render(2.5).unwrap().rgba);
    let uniforms = |rendered: &mut ScenePlan, time: f64| {
        let (frame, _) = rendered.record_material_plan(time).unwrap();
        assert_eq!(frame.layers.len(), 1);
        let MaterialCommand::Gaussian(pass) = &frame.layers[0].materials[0] else {
            panic!("expected resolved gaussian command")
        };
        (pass.sample_count, pass.step_pixels, pass.sigma_pixels)
    };
    for time in [2.25, 2.5, 3.25] {
        assert_eq!(
            rendered.render(time).unwrap().rgba,
            rendered.render(time + 2.0).unwrap().rgba
        );
        assert_eq!(
            uniforms(&mut rendered, time),
            uniforms(&mut rendered, time + 2.0)
        );
    }
    assert_ne!(uniforms(&mut rendered, 2.25), uniforms(&mut rendered, 2.5));
}

#[test]
fn absent_raw_word_timing_is_zero_and_false_in_both_clock_and_postlayout_contexts() {
    let mut body = fixture();
    let scene = &mut body["scene"]["value"];
    scene["layout"]
        .as_object_mut()
        .unwrap()
        .remove("pageWindow");
    scene["speechState"]["timingPolicy"] = json!("estimated");
    scene["layout"]["clock"]["time"] = json!({"op":"if","condition":read("unit.inputLastWordTimed"),"then":read("time.inputLastWordEndSeconds"),"else":literal("time", 0.0)});
    scene["selectors"] = json!([{"id":"pages","nodeId":"caption","unit":"page"}]);
    let mut condition = call("not", vec![read("unit.inputFirstWordTimed")]);
    condition = call(
        "and",
        vec![
            condition,
            call("not", vec![read("unit.inputLastWordTimed")]),
        ],
    );
    for path in [
        "time.inputFirstWordStartSeconds",
        "time.inputFirstWordEndSeconds",
        "time.inputLastWordStartSeconds",
        "time.inputLastWordEndSeconds",
    ] {
        condition = call(
            "and",
            vec![
                condition,
                call("eq", vec![read(path), literal("time", 0.0)]),
            ],
        );
    }
    scene["animations"] = json!([{"id":"availability","target":{"nodeId":"caption","selectorId":"pages"},"property":"fill","composite":"replace","value":expression(json!({"op":"if","condition":condition,"then":{"op":"literal","type":"color","value":"#00FF00"},"else":{"op":"literal","type":"color","value":"#FF0000"}}))}]);
    let mut rendered = plan_with_cue(body, 2.0, 8.0, vec![]);
    for time in [2.25, 5.25, 7.5] {
        let frame = rendered.render(time).unwrap();
        assert!(has_ink(&frame));
        assert!(frame.rgba.chunks_exact(4).all(|p| p[0] == 0 && p[2] == 0));
        assert!(frame.rgba.chunks_exact(4).any(|p| p[1] > 0));
    }
}

#[test]
fn identity_clock_preserves_legacy_pixels_and_seek_results_when_omitted() {
    let mut clocked = fixture();
    clocked["scene"]["value"]["layout"]["clock"]["time"] = read("time.seconds");
    let mut legacy = clocked.clone();
    legacy["scene"]["value"]["layout"]
        .as_object_mut()
        .unwrap()
        .remove("clock");
    let mut actual = plan(clocked);
    let mut expected = plan(legacy);
    for time in [1.5, 2.0, 2.25, 2.875, 3.0, 3.25, 4.0, 6.0, 2.25, 8.0] {
        assert_eq!(
            actual.render(time).unwrap().rgba,
            expected.render(time).unwrap().rgba,
            "identity at {time}"
        );
    }
}

#[test]
fn invalid_dynamic_clock_values_fail_instead_of_silently_clamping_or_falling_back() {
    for time in [
        literal("time", 1_000_001.0),
        call("div", vec![literal("time", 1.0), literal("scalar", 0.0)]),
    ] {
        let mut body = fixture();
        body["scene"]["value"]["layout"]["clock"]["time"] = time;
        assert!(plan(body).render(2.25).is_err());
    }
}

#[test]
fn page_wave_context_uses_one_clock_mapping_for_the_surface_and_uniforms() {
    let mut clocked = fixture();
    capability(&mut clocked, "caption-wave-displace/1");
    capability(&mut clocked, "caption-wave-context/1");
    clocked["scene"]["value"]["layout"]["clock"]["time"] =
        call("mul", vec![read("time.seconds"), literal("scalar", 0.5)]);
    clocked["scene"]["value"]["materials"] = json!([{
        "kind":"wave-displace","id":"page-wave","contextNodeId":"caption","axis":"y",
        "amplitude":{"kind":"constant","value":3},"wavelength":{"kind":"constant","value":24},
        "phase":expression(call("mul",vec![literal("angle",4.0),call("div",vec![read("time.seconds"),literal("time",1.0)])]))
    }]);
    let mut identity = clocked.clone();
    identity["scene"]["value"]["layout"]
        .as_object_mut()
        .unwrap()
        .remove("clock");
    let mut actual = plan(clocked);
    let mut expected = plan(identity);
    for (timeline, mapped) in [(2.25, 2.125), (4.5, 3.25), (2.25, 2.125)] {
        let a = actual.render(timeline).unwrap();
        assert!(has_ink(&a));
        assert_eq!(a.rgba, expected.render(mapped).unwrap().rgba);
    }
}

#[test]
fn feedback_samples_original_timeline_history_before_mapping_each_sample() {
    let mut body = fixture();
    capability(&mut body, "caption-feedback/1");
    body["scene"]["value"]["materials"] = json!([{
        "kind":"feedback","id":"trail","samples":1,
        "step":{"ticks":250,"timescale":1000},"decay":0.5,"offset":[15,0]
    }]);
    let mut reused = plan(body.clone());
    let early = reused.render(2.125).unwrap();
    let later = reused.render(4.125).unwrap();
    assert!(has_ink(&early) && has_ink(&later));
    assert_ne!(
        early.rgba, later.rgba,
        "only the later sample has in-cue history across the period boundary"
    );
    assert_eq!(later.rgba, reused.render(6.125).unwrap().rgba);
    for time in [6.125, 2.125, 4.125] {
        assert_eq!(
            reused.render(time).unwrap().rgba,
            plan(body.clone()).render(time).unwrap().rgba
        );
    }
}

#[test]
fn capability_only_exposes_raw_input_endpoints_without_remapping_time() {
    let mut body = fixture();
    let scene = &mut body["scene"]["value"];
    scene["layout"].as_object_mut().unwrap().remove("clock");
    scene["selectors"] = json!([{"id":"pages","nodeId":"caption","unit":"page"}]);
    let condition = call(
        "and",
        vec![
            read("unit.inputFirstWordTimed"),
            call(
                "eq",
                vec![read("time.inputLastWordEndSeconds"), literal("time", 2.0)],
            ),
        ],
    );
    scene["animations"] = json!([{"id":"input-endpoint-colour","target":{"nodeId":"caption","selectorId":"pages"},
        "property":"fill","composite":"replace","value":expression(json!({"op":"if","condition":condition,
        "then":{"op":"literal","type":"color","value":"#00FF00"},"else":{"op":"literal","type":"color","value":"#FF0000"}}))}]);
    let mut rendered = plan(body);
    for time in [2.25, 3.25] {
        let frame = rendered.render(time).unwrap();
        assert!(has_ink(&frame));
        assert!(frame.rgba.chunks_exact(4).all(|p| p[0] == 0 && p[2] == 0));
    }
    assert!(!has_ink(&rendered.render(4.25).unwrap()));
}
