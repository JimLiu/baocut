//! Reference ink is observed through public material uniforms and recorded draw
//! geometry. Static legacy shaping supplies the independent measurement control.
use caption_scene::{Presentation, parse_style};
use render_raster::{
    TextEngine,
    drawop::fingerprint,
    effects::material_plan::{MaterialCommand, MaterialSource},
};
use serde_json::{Value, json};
use subtitle_render::scene::{SceneCue, ScenePlan, SceneWord};

const WIDTH: u32 = 320;
const HEIGHT: u32 = 180;

fn constant(value: f64) -> Value {
    json!({"kind":"constant","value":value})
}
fn read(path: &str) -> Value {
    json!({"op":"read","path":path})
}
fn scalar_length(path: &str) -> Value {
    json!({"kind":"expression","expression":{"op":"call","function":"div","args":[
        read(path),{"op":"literal","type":"length","value":1}]}})
}
fn domain() -> Value {
    json!({"x":constant(0.),"y":constant(0.),
        "width":constant(WIDTH as f64),"height":constant(HEIGHT as f64)})
}
fn size_curve(base: f64) -> Value {
    json!({"kind":"keyframes","clock":{"unit":"cue","origin":"start","duration":{"kind":"unit-span"}},
        "keys":[{"at":0,"value":base},{"at":1,"value":base*2.}],
        "fill":{"before":"hold","after":"hold"}})
}
fn probe_material(reference: bool) -> Value {
    let prefix = if reference {
        "layout.referenceInk"
    } else {
        "layout.ink"
    };
    let available = if reference {
        json!({"kind":"expression","expression":{"op":"if",
            "condition":read("unit.referenceInkAvailable"),
            "then":{"op":"literal","type":"scalar","value":1},
            "else":{"op":"literal","type":"scalar","value":0}}})
    } else {
        constant(1.)
    };
    // These are observation slots only: record_material_plan evaluates them
    // without executing the affine filter or changing the source geometry.
    json!({"kind":"affine-sample-blend","id":"measurement","contextNodeId":"caption",
        "sampling":{"input":domain(),"output":domain()},
        "transforms":[[
            scalar_length(&format!("{prefix}X")),scalar_length(&format!("{prefix}Y")),
            scalar_length(&format!("{prefix}Width")),scalar_length(&format!("{prefix}Height")),
            available,constant(0.)
        ],[
            scalar_length("layout.inkX"),scalar_length("layout.inkY"),
            scalar_length("layout.inkWidth"),scalar_length("layout.inkHeight"),
            scalar_length("layout.width"),scalar_length("layout.height")
        ]],"sampleRange":[2,2],"distanceRange":[0,1],"boundary":"transparent"})
}
fn body() -> Value {
    json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
        "schema":"baocut.caption-scene/1","evaluationVersion":1,
        "requiredCapabilities":["caption-scene/1","caption-expressions/1",
            "caption-unit-font-size/1","caption-word-line-layout/1","caption-layout-per-sample/1",
            "caption-reference-geometry/1","caption-affine-sample-blend/1"],
        "layout":{"width":{"value":300,"basis":"absolute"},"x":{"value":160,"basis":"absolute"},
            "y":{"value":90,"basis":"absolute"},"maxLines":1,"overflow":"visible",
            "layoutEvaluation":"per-sample","pagination":{"wordLinePattern":[[2]]},
            "fontSizeBindings":[{"id":"sizes","nodeId":"caption","selectorId":"words",
                "referenceValue":constant(24.),"value":size_curve(24.)}]},
        "speechState":{"gapPolicy":"hold-previous","tailPolicy":"hold-last","timingPolicy":"estimated"},
        "nodes":[{"id":"caption","type":"text","style":{"fontFamily":"Arimo","fontWeight":400,
            "fontSize":{"value":24,"basis":"absolute"},"lineHeight":1.25,"fill":"#FFFFFFFF"}}],
        "selectors":[{"id":"words","nodeId":"caption","unit":"word","filter":{"kind":"all"}}],
        "animations":[],"materials":[probe_material(true)]
    }}})
}
fn compile(body: Value, content: &str, keywords: &[usize]) -> ScenePlan {
    let mut presentation = Presentation::default();
    for index in keywords {
        presentation
            .word_tags
            .insert(format!("w{index}"), vec!["accent".into()]);
    }
    let tokens = content.split_whitespace().collect::<Vec<_>>();
    let word_count = tokens.len().max(1) as f64;
    let words = tokens
        .into_iter()
        .enumerate()
        .map(|(index, text)| SceneWord {
            id: format!("w{index}"),
            text: text.into(),
            start: 4. * index as f64 / word_count,
            end: 4. * (index + 1) as f64 / word_count,
        })
        .collect();
    ScenePlan::compile(
        parse_style(&body).unwrap(),
        presentation,
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: content.into(),
            start: 0.,
            end: 4.,
            words,
        }],
        (WIDTH, HEIGHT),
        TextEngine::with_document_fonts(&[
            include_bytes!("../../render-raster/assets/fonts/Arimo.ttf").to_vec(),
            include_bytes!("../../render-raster/assets/fonts/Rubik.ttf").to_vec(),
        ]),
        "reference-geometry".into(),
    )
    .unwrap()
}
#[derive(Debug, PartialEq)]
struct Observation {
    reference: [f64; 4],
    available: bool,
    current: [f64; 4],
    source_fingerprint: u64,
}
fn observe(plan: &mut ScenePlan, time: f64) -> Observation {
    let (frame, _) = plan.record_material_plan(time).unwrap();
    assert_eq!(frame.layers.len(), 1);
    let layer = &frame.layers[0];
    let MaterialCommand::AffineSampleBlend(config) = &layer.materials[0] else {
        panic!("measurement command missing")
    };
    let MaterialSource::Draw(ops) = &layer.source else {
        panic!("draw source required")
    };
    let reference = config.transforms[0][..4].try_into().unwrap();
    let current = config.transforms[1][..4].try_into().unwrap();
    Observation {
        reference,
        current,
        available: config.transforms[0][4] == 1.,
        source_fingerprint: fingerprint(ops),
    }
}
fn static_control(mut body: Value) -> Value {
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|cap| cap != "caption-reference-geometry/1");
    for binding in scene["layout"]["fontSizeBindings"].as_array_mut().unwrap() {
        let reference = binding
            .as_object_mut()
            .unwrap()
            .remove("referenceValue")
            .unwrap();
        binding["value"] = reference;
    }
    scene["materials"] = json!([probe_material(false)]);
    body
}
fn keyword_body() -> Value {
    let mut body = body();
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-unit-font-style/1"));
    scene["selectors"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"accent","nodeId":"caption","unit":"word",
        "filter":{"kind":"tag","value":"accent"}}));
    scene["layout"]["fontSizeBindings"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"accent-size","nodeId":"caption",
        "selectorId":"accent","referenceValue":constant(36.),"value":size_curve(36.)}));
    scene["layout"]["fontStyleBindings"] = json!([{"id":"accent-face","nodeId":"caption","selectorId":"accent",
        "style":{"fontFamily":"Rubik","fontWeight":500}}]);
    body
}

#[test]
fn reference_ink_matches_static_shaping_while_actual_font_size_changes() {
    let b = body();
    let mut actual = compile(b.clone(), "AV MW", &[]);
    let expected = observe(&mut compile(static_control(b), "AV MW", &[]), 0.25);
    let early = observe(&mut actual, 0.25);
    let late = observe(&mut actual, 3.25);
    assert!(early.available && late.available);
    assert_eq!(early.reference, expected.reference);
    assert_eq!(late.reference, expected.reference);
    assert!(
        late.current[2] > early.current[2] * 1.5,
        "fixture must change real shaping width"
    );
    assert_ne!(
        early.source_fingerprint, late.source_fingerprint,
        "actual glyph drawing must change"
    );
}

#[test]
fn keyword_reference_size_and_static_face_are_measured_before_dynamic_sizing() {
    let b = keyword_body();
    let mut actual = compile(b.clone(), "AV MW", &[1]);
    let expected = observe(&mut compile(static_control(b.clone()), "AV MW", &[1]), 0.5);
    let early = observe(&mut actual, 0.5);
    let late = observe(&mut actual, 3.5);
    assert_eq!(early.reference, expected.reference);
    assert_eq!(late.reference, expected.reference);
    assert_ne!(early.current, late.current);
    let normal = observe(&mut compile(static_control(b), "AV MW", &[]), 0.5);
    assert_ne!(
        expected.reference, normal.reference,
        "keyword reference typography must not be dropped"
    );
}

#[test]
fn changing_only_reference_typography_never_changes_actual_draw_geometry() {
    let b = keyword_body();
    let mut changed = b.clone();
    changed["scene"]["value"]["layout"]["fontSizeBindings"][1]["referenceValue"] = constant(48.);
    let original = observe(&mut compile(b, "AV MW", &[1]), 1.25);
    let altered = observe(&mut compile(changed, "AV MW", &[1]), 1.25);
    assert_ne!(original.reference, altered.reference);
    assert_eq!(original.current, altered.current);
    assert_eq!(original.source_fingerprint, altered.source_fingerprint);
}

#[test]
fn whitespace_has_no_reference_ink_instead_of_inheriting_advance_geometry() {
    let mut b = body();
    b["scene"]["value"]["layout"]["pagination"] = json!({"wordLinePattern":[[1]]});
    let mut plan = compile(b, "   ", &[]);
    for time in [0.25, 3.25, 0.25] {
        let observation = observe(&mut plan, time);
        assert!(!observation.available);
        assert_eq!(observation.reference, [0.; 4]);
    }
}

#[test]
fn reference_page_cache_survives_reverse_seeks_and_keyword_page_changes() {
    let mut b = keyword_body();
    b["scene"]["value"]["layout"]["pagination"] = json!({"wordLinePattern":[[1]]});
    let mut warm = compile(b.clone(), "MAMA MAMA", &[1]);
    let mut normal_reference = None;
    let mut keyword_reference = None;
    for time in [0.25, 2.75, 1.25, 0.25, 3.75, 2.75] {
        let observation = observe(&mut warm, time);
        let fresh = observe(&mut compile(b.clone(), "MAMA MAMA", &[1]), time);
        assert_eq!(observation, fresh, "warm/fresh seek mismatch at {time}");
        if time < 2. {
            if let Some(reference) = normal_reference {
                assert_eq!(observation.reference, reference);
            } else {
                normal_reference = Some(observation.reference);
            }
        } else if let Some(reference) = keyword_reference {
            assert_eq!(observation.reference, reference);
        } else {
            keyword_reference = Some(observation.reference);
        }
    }
    assert_ne!(normal_reference, keyword_reference);
}

#[test]
fn enabling_reference_metadata_preserves_existing_dynamic_draw_commands() {
    let enabled = keyword_body();
    let mut legacy = enabled.clone();
    let scene = &mut legacy["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|cap| cap != "caption-reference-geometry/1");
    for binding in scene["layout"]["fontSizeBindings"].as_array_mut().unwrap() {
        binding.as_object_mut().unwrap().remove("referenceValue");
    }
    scene["materials"] = json!([probe_material(false)]);
    let mut reference_plan = compile(enabled, "AV MW", &[1]);
    let mut legacy_plan = compile(legacy, "AV MW", &[1]);
    for time in [0.25, 3.25, 1.25, 0.25] {
        let actual = observe(&mut reference_plan, time);
        let expected = observe(&mut legacy_plan, time);
        assert_eq!(actual.current, expected.current);
        assert_eq!(actual.source_fingerprint, expected.source_fingerprint);
    }
}

#[test]
fn static_reference_layout_is_not_resampled_by_dynamic_layout_bindings() {
    let mut b = body();
    b["scene"]["value"]["layout"]["fontSizeBindings"][0]["value"] = constant(24.);
    let mut expected_body = static_control(b.clone());
    b["scene"]["value"]["layout"]["bindings"] = json!([{
        "property":"x","value":{"kind":"keyframes",
            "clock":{"unit":"cue","origin":"start","duration":{"kind":"unit-span"}},
            "keys":[{"at":0,"value":80},{"at":1,"value":240}],
            "fill":{"before":"hold","after":"hold"}}}]);
    expected_body["scene"]["value"]["layout"]
        .as_object_mut()
        .unwrap()
        .remove("bindings");
    let expected = observe(&mut compile(expected_body, "AV MW", &[]), 0.25);
    let mut p = compile(b, "AV MW", &[]);
    let first = observe(&mut p, 0.25);
    let last = observe(&mut p, 3.25);
    assert_eq!(first.reference, expected.reference);
    assert_eq!(last.reference, expected.reference);
    assert!(last.current[0] - first.current[0] > 100.);
    assert_ne!(first.source_fingerprint, last.source_fingerprint);
}

#[test]
fn logical_clusters_keep_combining_glyphs_rtl_and_collapsed_source_spaces() {
    let mut font = TextEngine::with_document_fonts(&[include_bytes!(
        "../../render-raster/assets/fonts/Arimo.ttf"
    )
    .to_vec()]);
    let shape = font.shape_styled("שָׁב", "Arimo", 24., 400, false);
    assert!(
        shape
            .glyphs
            .iter()
            .enumerate()
            .any(|(index, glyph)| shape.glyphs[..index]
                .iter()
                .any(|other| other.cluster.start == glyph.cluster.start)),
        "fixture must contain several glyphs in one logical source cluster"
    );
    let mut b = body();
    b["scene"]["value"]["layout"]["pagination"] = json!({"wordLinePattern":[[1]]});
    let content = "ffi    q\u{307}   שָׁב";
    let mut p = compile(b.clone(), content, &[]);
    let mut expected = compile(static_control(b), content, &[]);
    for time in [0.25, 1.75, 3.25, 1.75, 0.25] {
        let current = observe(&mut p, time);
        let control = observe(&mut expected, time);
        assert!(current.available);
        assert_eq!(
            current.reference, control.reference,
            "source-byte range mismatch at {time}"
        );
    }
}

#[test]
fn reference_caches_are_scoped_to_each_cue_even_with_reused_word_ids() {
    let b = body();
    let mut p = ScenePlan::compile(
        parse_style(&b).unwrap(),
        Presentation::default(),
        vec![
            SceneCue {
                id: "first".into(),
                document_id: "doc".into(),
                text: "AV".into(),
                start: 0.,
                end: 2.,
                words: vec![SceneWord {
                    id: "w0".into(),
                    text: "AV".into(),
                    start: 0.,
                    end: 2.,
                }],
            },
            SceneCue {
                id: "second".into(),
                document_id: "doc".into(),
                text: "MAMA".into(),
                start: 2.,
                end: 4.,
                words: vec![SceneWord {
                    id: "w0".into(),
                    text: "MAMA".into(),
                    start: 2.,
                    end: 4.,
                }],
            },
        ],
        (WIDTH, HEIGHT),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/Arimo.ttf"
        )
        .to_vec()]),
        "reference-cue-scope".into(),
    )
    .unwrap();
    let first = observe(&mut compile(static_control(b.clone()), "AV", &[]), 0.25).reference;
    let second = observe(&mut compile(static_control(b), "MAMA", &[]), 0.25).reference;
    assert_ne!(first, second);
    for (time, expected) in [(0.25, first), (2.75, second), (0.25, first), (3.75, second)] {
        let observation = observe(&mut p, time);
        assert!(observation.available);
        assert_eq!(observation.reference, expected);
    }
}

#[test]
fn captured_surface_can_bind_reference_ink_without_sampling_dynamic_font_geometry() {
    let mut b = body();
    let scene = &mut b["scene"]["value"];
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .extend([
            json!("caption-render-layers/1"),
            json!("caption-layer-capture/1"),
        ]);
    let pixel = json!({"op":"literal","type":"length","value":1});
    let rounded = |path: &str, offset: f64, rounding: &str| {
        json!({"kind":"expression","expression":{
        "op":"call","function":"mul","args":[
            {"op":"call","function":rounding,"args":[{"op":"call","function":"div","args":[
                {"op":"call","function":"add","args":[read(path),{"op":"literal","type":"length","value":offset}]},pixel.clone()]}]},pixel.clone()]}})
    };
    scene["renderLayers"] = json!([{"id":"reference-window","source":{"kind":"nodes","nodeIds":["caption"]},
        "capture":{"contextNodeId":"caption","rect":{
            "x":rounded("layout.referenceInkX",-4.,"floor"),"y":rounded("layout.referenceInkY",-4.,"floor"),
            "width":rounded("layout.referenceInkWidth",8.,"ceil"),"height":rounded("layout.referenceInkHeight",8.,"ceil")}},
        "materials":[],"blend":"source-over"}]);
    scene["materials"] = json!([]);
    let mut p = compile(b, "AV MW", &[]);
    let (early, _) = p.record_material_plan(0.25).unwrap();
    let (late, _) = p.record_material_plan(3.25).unwrap();
    assert_eq!(early.layers.len(), 1);
    assert_eq!(early.layers[0].capture, late.layers[0].capture);
    let (MaterialSource::Draw(a), MaterialSource::Draw(b)) =
        (&early.layers[0].source, &late.layers[0].source)
    else {
        panic!("capture must retain its real draw source")
    };
    assert_ne!(fingerprint(a), fingerprint(b));
    let (again, _) = p.record_material_plan(0.25).unwrap();
    assert_eq!(early.layers[0].capture, again.layers[0].capture);
}
