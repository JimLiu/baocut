use caption_scene::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;
fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap()
}
fn expr(v: Value) -> Expression {
    serde_json::from_value(v).unwrap()
}
#[test]
fn contract_rejects_unknowns_units_cycles_and_versions() {
    let input = fixture();
    let style = parse_style(&input).unwrap();
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    for (path, value) in [
        ("/scene/value/evaluationVersion", json!(2)),
        ("/scene/value/nodes/0/type", json!("image")),
        ("/scene/value/animations/0/property", json!("fontSize")),
        ("/scene/value/animations/1/value/keys/1/at", json!(0)),
    ] {
        let mut v = input.clone();
        *v.pointer_mut(path).unwrap() = value;
        assert!(parse_style(&v).is_err(), "{path}");
    }
    let mut v = input.clone();
    v["scene"]["value"]["unexpected"] = json!(true);
    assert!(parse_style(&v).is_err());
    let mut v = input.clone();
    v["scene"]["value"]["functions"] =
        json!([{"id":"recursive","arguments":[],"returns":"scalar","body":{"op":"call","function":"recursive","args":[]}}]);
    assert_eq!(parse_style(&v).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
    let bad = expr(
        json!({"op":"call","function":"add","args":[{"op":"literal","type":"time","value":1},{"op":"literal","type":"length","value":2}]}),
    );
    assert!(infer(&bad, style.scene(), &BTreeMap::new()).is_err());
}
#[test]
fn continuous_function_is_seek_and_frame_rate_independent() {
    let style = parse_style(&fixture()).unwrap();
    let wave = expr(
        json!({"op":"call","function":"sin","args":[{"op":"call","function":"phase","args":[{"op":"read","path":"time.seconds"},{"op":"literal","type":"scalar","value":2}]}]}),
    );
    assert_eq!(infer(&wave, style.scene(), &BTreeMap::new()).unwrap(), ValueType::Scalar);
    let at = |t| {
        let mut c = Context::default();
        c.fields.insert("time.seconds".into(), Evaluated::Number(ValueType::Time, t));
        evaluate(&wave, style.scene(), &c, &mut Budget::default())
            .unwrap()
            .number()
            .unwrap()
    };
    for t in [0.01, 0.1, 0.125, 0.234567, 1.0, 0.01] {
        assert!((at(t) - libm::sin(t * 2.0 * std::f64::consts::TAU)).abs() < 1e-14);
    }
    assert!((at(0.125) - 1.0).abs() < 1e-14);
}
#[test]
fn conditions_are_lazy_and_arithmetic_errors_are_not_zero() {
    let style = parse_style(&fixture()).unwrap();
    let bad = json!({"op":"call","function":"div","args":[{"op":"literal","type":"scalar","value":1},{"op":"literal","type":"scalar","value":0}]});
    assert!(evaluate(&expr(bad.clone()), style.scene(), &Context::default(), &mut Budget::default()).is_err());
    let choose = expr(
        json!({"op":"if","condition":{"op":"literal","type":"bool","value":true},"then":{"op":"literal","type":"scalar","value":7},"else":bad}),
    );
    assert_eq!(
        evaluate(&choose, style.scene(), &Context::default(), &mut Budget::default())
            .unwrap()
            .number()
            .unwrap(),
        7.0
    );
    assert!(evaluate(&choose, style.scene(), &Context::default(), &mut Budget::new(0)).is_err());
}
#[test]
fn fill_and_word_clock_use_exact_window_not_cue_duration() {
    let style = parse_style(&fixture()).unwrap();
    let v = &style.scene().animations[1].value;
    let mut c = Context::default();
    c.spans.insert(UnitKind::Word, (2.0, 3.5));
    let sample = |t| sample_value(v, ValueType::Scalar, style.scene(), &c, t, &mut Budget::default()).unwrap();
    assert!(sample(1.999).is_none());
    assert_eq!(sample(2.0).unwrap().number().unwrap(), 0.85);
    assert!((sample(2.081).unwrap().number().unwrap() - 1.18).abs() < 1e-12);
    assert!(sample(2.181).is_none());
}
#[test]
fn parameters_are_checked_and_seeded_noise_is_repeatable() {
    let style = parse_style(&fixture()).unwrap();
    assert!(parameters(style.scene(), &[&BTreeMap::from([("absent".into(), json!(3))])]).is_err());
    assert!(validate_presentation(&Presentation::default(), Some(style.scene())).is_ok());
    let e = expr(json!({"op":"call","function":"noise","args":[{"op":"literal","type":"scalar","value":0.32}]}));
    let run = |seed| {
        evaluate(
            &e,
            style.scene(),
            &Context {
                seed,
                stable_key: "cue|word|channel".into(),
                ..Default::default()
            },
            &mut Budget::default(),
        )
        .unwrap()
    };
    assert_eq!(run(2), run(2));
    assert_ne!(run(2), run(3));
}

#[test]
fn yoyo_stagger_and_bezier_share_motion_semantics() {
    let style = parse_style(&fixture()).unwrap();
    let value:DynamicValue=serde_json::from_value(json!({
        "kind":"keyframes","clock":{"unit":"cue","origin":"start","stagger":{"ticks":100,"timescale":1000},"duration":{"kind":"fixed","ticks":1,"timescale":1},"repeat":{"iterations":2,"mode":"yoyo"}},
        "keys":[{"at":0,"value":0},{"at":1,"value":10}],"fill":{"after":"hold"},
        "interpolation":{"cubic-bezier":{"x1":0.25,"y1":0.1,"x2":0.25,"y2":1}}
    })).unwrap();
    let mut c = Context::default();
    c.spans.insert(UnitKind::Cue, (0.0, 4.0));
    c.fields.insert("unit.index".into(), Evaluated::Number(ValueType::Scalar, 2.0));
    let at = |t| sample_value(&value, ValueType::Length, style.scene(), &c, t, &mut Budget::default()).unwrap();
    assert!(at(0.1).is_none());
    assert!((at(0.7).unwrap().number().unwrap() - 10.0 * motion::curve::cubic_bezier(0.25, 0.1, 0.25, 1.0, 0.5)).abs() < 1e-12);
    assert_eq!(at(1.2).unwrap().number().unwrap(), 10.0);
    assert_eq!(at(2.3).unwrap().number().unwrap(), 0.0);
}

#[test]
fn reusable_pure_function_preserves_units() {
    let mut body = fixture();
    body["scene"]["value"]["functions"] = json!([{"id":"double","arguments":[{"name":"x","type":"length"}],"returns":"length","body":{"op":"call","function":"mul","args":[{"op":"read","path":"args.x"},{"op":"literal","type":"scalar","value":2}]}}]);
    let style = parse_style(&body).unwrap();
    let call = expr(json!({"op":"call","function":"double","args":[{"op":"literal","type":"length","value":8}]}));
    assert_eq!(infer(&call, style.scene(), &BTreeMap::new()).unwrap(), ValueType::Length);
    assert_eq!(
        evaluate(&call, style.scene(), &Context::default(), &mut Budget::default()).unwrap(),
        Evaluated::Number(ValueType::Length, 16.0)
    );
    assert_eq!(
        builtin_type("div", &[ValueType::Integer, ValueType::Integer]),
        Some(ValueType::Scalar)
    );
}

#[test]
fn repeated_decoration_inherits_its_word_clock() {
    let mut input = fixture();
    input["scene"]["value"]["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"boxes","type":"repeat","selectorId":"words","children":[{"id":"plate","type":"shape"}]}));
    let mut track = input["scene"]["value"]["animations"][1].clone();
    track["id"] = json!("plate-pop");
    track["target"] = json!({"nodeId":"plate"});
    input["scene"]["value"]["animations"].as_array_mut().unwrap().push(track);
    assert!(parse_style(&input).is_ok());
}

#[test]
fn sampled_layout_rejects_cycles_through_functions_and_page_clocks() {
    let mut body = fixture();
    body["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
    body["scene"]["value"]["functions"] =
        json!([{"id":"width","arguments":[],"returns":"length","body":{"op":"read","path":"layout.width"}}]);
    body["scene"]["value"]["layout"]["bindings"] =
        json!([{"property":"width","value":{"kind":"expression","expression":{"op":"call","function":"width","args":[]}}}]);
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
    body["scene"]["value"]["layout"]["bindings"][0]["value"] = json!({"kind":"keyframes","clock":{"unit":"page","origin":"start","duration":{"kind":"unit-span"}},"keys":[{"at":0,"value":40},{"at":1,"value":120}]});
    assert!(parse_style(&body).is_err());
    body["scene"]["value"]["layout"]["bindings"][0]["value"] = json!({"kind":"constant","value":50});
    assert!(parse_style(&body).is_ok());
    body["scene"]["value"]["layout"]["layoutEvaluation"] = json!("static");
    assert!(parse_style(&body).is_err());
}
#[test]
fn material_validation_limits_nested_history_and_blur() {
    let mut body = fixture();
    let root = &mut body["scene"]["value"];
    root["materials"] = json!([{"kind":"blur","id":"blur","radius":{"kind":"constant","value":65}}]);
    assert!(parse_style(&body).is_err());
    body["scene"]["value"]["materials"] = json!([
        {"kind":"feedback","id":"a","samples":8,"step":{"ticks":100,"timescale":1000},"decay":0.5},
        {"kind":"feedback","id":"b","samples":8,"step":{"ticks":100,"timescale":1000},"decay":0.5}
    ]);
    assert!(parse_style(&body).is_err());
    body["scene"]["value"]["materials"].as_array_mut().unwrap().pop();
    assert!(parse_style(&body).is_ok());
    body["scene"]["value"]["materials"][0]["step"]["ticks"] = json!(0);
    assert!(parse_style(&body).is_err());
}

#[test]
fn bezier_expression_supports_duration_dependent_progress_and_overshoot() {
    let mut input = fixture();
    input["scene"]["value"]["requiredCapabilities"] = json!(["caption-bezier-expression/1"]);
    let style = parse_style(&input).unwrap();
    let curve = expr(json!({"op":"call","function":"cubic-bezier","args":[
        {"op":"call","function":"div","args":[
            {"op":"read","path":"time.elapsedSeconds"},
            {"op":"call","function":"min","args":[
                {"op":"read","path":"time.durationSeconds"},
                {"op":"literal","type":"time","value":0.1}
            ]}
        ]},
        {"op":"literal","type":"scalar","value":0.2},
        {"op":"literal","type":"scalar","value":1.6},
        {"op":"literal","type":"scalar","value":0.4},
        {"op":"literal","type":"scalar","value":1.2}
    ]}));
    assert_eq!(infer(&curve, style.scene(), &BTreeMap::new()).unwrap(), ValueType::Scalar);
    let sample = |elapsed, duration| {
        let mut context = Context::default();
        context
            .fields
            .insert("time.elapsedSeconds".into(), Evaluated::Number(ValueType::Time, elapsed));
        context
            .fields
            .insert("time.durationSeconds".into(), Evaluated::Number(ValueType::Time, duration));
        evaluate(&curve, style.scene(), &context, &mut Budget::default())
            .unwrap()
            .number()
            .unwrap()
    };
    assert_eq!(sample(-0.1, 1.0), 0.0);
    assert_eq!(sample(0.2, 1.0), 1.0);
    assert!(sample(0.06, 1.0) > 1.0);
    assert_eq!(sample(0.025, 0.05), sample(0.05, 1.0));
    for time in [0.001, 0.07, 0.03, 0.099, 0.001] {
        assert_eq!(sample(time, 1.0), motion::curve::cubic_bezier(0.2, 1.6, 0.4, 1.2, time / 0.1));
    }
    let make = |x| {
        expr(json!({"op":"call","function":"cubic-bezier","args":[
            {"op":"literal","type":"scalar","value":0.5},
            {"op":"literal","type":"scalar","value":x},
            {"op":"literal","type":"scalar","value":0},
            {"op":"literal","type":"scalar","value":1},
            {"op":"literal","type":"scalar","value":1}
        ]}))
    };
    assert!(evaluate(&make(-0.1), style.scene(), &Context::default(), &mut Budget::default()).is_err());
    assert!(evaluate(&make(1.1), style.scene(), &Context::default(), &mut Budget::default()).is_err());
    assert!(evaluate(&make(0.2), style.scene(), &Context::default(), &mut Budget::new(0)).is_err());
    assert!(builtin_type("cubic-bezier", &[ValueType::Time; 5]).is_none());
    input["scene"]["value"]["functions"] =
        json!([{"id":"cubic-bezier","arguments":[],"returns":"scalar","body":{"op":"literal","type":"scalar","value":1}}]);
    assert!(parse_style(&input).is_err());
}

#[test]
fn text_context_types_and_sqrt_reject_invalid_dependencies() {
    let scene = parse_style(&fixture()).unwrap();
    for path in ["time.cueDurationSeconds", "time.pageElapsedSeconds", "time.pageDurationSeconds"] {
        assert_eq!(context_type(path), Some(ValueType::Time));
    }
    for path in ["unit.textIndex", "unit.textCount", "unit.pageTextIndex", "unit.pageTextCount"] {
        assert_eq!(context_type(path), Some(ValueType::Scalar));
    }
    let sample = |value| {
        evaluate(
            &expr(json!({"op":"call","function":"sqrt","args":[{"op":"literal","type":"scalar","value":value}]})),
            scene.scene(),
            &Context::default(),
            &mut Budget::default(),
        )
    };
    assert_eq!(sample(9.0).unwrap().number().unwrap(), 3.0);
    assert!(sample(-1.0).is_err());
    assert!(builtin_type("sqrt", &[ValueType::Time]).is_none());
    let mut body = fixture();
    body["scene"]["value"]["selectors"][0]["includeWhitespace"] = json!(true);
    assert!(parse_style(&body).is_err());
    body = fixture();
    body["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
    body["scene"]["value"]["layout"]["bindings"] = json!([{"property":"width","value":{"kind":"expression","expression":{"op":"call","function":"mul","args":[{"op":"literal","type":"length","value":20},{"op":"call","function":"div","args":[{"op":"read","path":"time.pageDurationSeconds"},{"op":"literal","type":"time","value":1}]}]}}}]);
    assert!(parse_style(&body).is_err(), "page clock is unavailable before layout");
}

#[test]
fn ink_context_is_length_typed_and_unavailable_before_layout() {
    let mut body = fixture();
    body["scene"]["value"]["requiredCapabilities"] = json!(["caption-ink-context/1"]);
    let style = parse_style(&body).unwrap();
    for field in ["inkX", "inkY", "inkWidth", "inkHeight", "lineInkY", "lineInkHeight"] {
        let read = expr(json!({"op":"read", "path":format!("layout.{field}")}));
        assert_eq!(infer(&read, style.scene(), &BTreeMap::new()).unwrap(), ValueType::Length);
        let mut early = body.clone();
        early["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
        early["scene"]["value"]["layout"]["bindings"] = json!([{
            "property":"width", "value":{"kind":"expression", "expression": read}
        }]);
        assert_eq!(parse_style(&early).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
    }
    parse_style(&serde_json::from_str(include_str!("fixtures/ink-context.json")).unwrap()).unwrap();
}

#[test]
fn unit_context_types_and_pre_layout_restrictions_are_explicit() {
    let mut body = fixture();
    body["scene"]["value"]["requiredCapabilities"] = json!(["caption-unit-context/1"]);
    let style = parse_style(&body).unwrap();
    for (path, ty) in [
        ("unit.pageIndex", ValueType::Scalar),
        ("unit.pageCount", ValueType::Scalar),
        ("time.lineElapsedSeconds", ValueType::Time),
        ("time.lineDurationSeconds", ValueType::Time),
    ] {
        let read = expr(json!({"op":"read", "path":path}));
        assert_eq!(infer(&read, style.scene(), &BTreeMap::new()).unwrap(), ty);
        let scalar = if ty == ValueType::Time {
            json!({"op":"call","function":"div","args":[read,{"op":"literal","type":"time","value":1}]})
        } else {
            json!(read)
        };
        let mut early = body.clone();
        early["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
        early["scene"]["value"]["layout"]["bindings"] = json!([{
            "nodeId":"caption", "property":"lineHeight", "value":{"kind":"expression", "expression":scalar}
        }]);
        assert_eq!(parse_style(&early).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
    }
    parse_style(&serde_json::from_str(include_str!("fixtures/unit-context.json")).unwrap()).unwrap();
}

#[test]
fn soft_band_requires_one_explicit_text_and_scalar_post_layout_uniforms() {
    let original: Value = serde_json::from_str(include_str!("fixtures/soft-band.json")).unwrap();
    parse_style(&original).unwrap();
    for (field, value) in [
        ("center", 4.1),
        ("center", -4.1),
        ("halfWidth", -0.1),
        ("halfWidth", 4.1),
        ("feather", -0.1),
        ("amount", 1.1),
        ("opacity", -0.1),
    ] {
        let mut bad = original.clone();
        bad["scene"]["value"]["materials"][0][field] = json!({"kind":"constant","value":value});
        assert!(parse_style(&bad).is_err(), "{field}={value}");
    }
    for node in [
        json!({"id":"extra","type":"text"}),
        json!({"id":"extra","type":"shape"}),
        json!({"id":"extra","type":"image"}),
    ] {
        let mut bad = original.clone();
        bad["scene"]["value"]["nodes"].as_array_mut().unwrap().push(node);
        assert!(parse_style(&bad).is_err());
    }
    let mut bad = original.clone();
    bad["scene"]["value"]["materials"][0]["contextNodeId"] = json!("missing");
    assert!(parse_style(&bad).is_err());
    let mut grouped = original.clone();
    let node = grouped["scene"]["value"]["nodes"][0].clone();
    grouped["scene"]["value"]["nodes"] = json!([{"id":"wrapper","type":"group","children":[node]}]);
    parse_style(&grouped).unwrap();
    let style = parse_style(&original).unwrap();
    assert_eq!(
        infer(
            &expr(json!({"op":"read","path":"unit.pageLastWordTimed"})),
            style.scene(),
            &BTreeMap::new()
        )
        .unwrap(),
        ValueType::Bool
    );
    for field in ["time.pageLastWordElapsedSeconds", "time.pageLastWordDurationSeconds"] {
        assert_eq!(
            infer(&expr(json!({"op":"read","path":field})), style.scene(), &BTreeMap::new()).unwrap(),
            ValueType::Time
        );
        let mut bad = original.clone();
        bad["scene"]["value"]["layout"]["bindings"][0]["value"] = json!({"kind":"expression","expression":{
            "op":"call","function":"mul","args":[{"op":"literal","type":"length","value":10},{"op":"call","function":"div","args":[{"op":"read","path":field},{"op":"literal","type":"time","value":1}]}]}});
        assert_eq!(parse_style(&bad).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
    }
}

#[test]
fn cue_word_input_context_types_and_early_read_rejection_are_explicit() {
    let body: Value = serde_json::from_str(include_str!("fixtures/cue-word-context.json")).unwrap();
    let style = parse_style(&body).unwrap();
    for (path, ty) in [
        ("time.cueFirstWordStartSeconds", ValueType::Time),
        ("time.cueFirstWordEndSeconds", ValueType::Time),
        ("time.cueSecondWordStartSeconds", ValueType::Time),
        ("time.nextWordStartSeconds", ValueType::Time),
        ("unit.cueFirstWordTimed", ValueType::Bool),
        ("unit.cueSecondWordTimed", ValueType::Bool),
        ("unit.wordTimed", ValueType::Bool),
        ("unit.nextWordTimed", ValueType::Bool),
    ] {
        let read = json!({"op":"read","path":path});
        assert_eq!(infer(&expr(read.clone()), style.scene(), &BTreeMap::new()).unwrap(), ty);
        let scalar = if ty == ValueType::Time {
            json!({"op":"call","function":"div","args":[read,{"op":"literal","type":"time","value":1}]})
        } else {
            json!({"op":"if","condition":read,"then":{"op":"literal","type":"scalar","value":1},"else":{"op":"literal","type":"scalar","value":2}})
        };
        let mut bad = body.clone();
        bad["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
        bad["scene"]["value"]["layout"]["bindings"] =
            json!([{"nodeId":"caption","property":"lineHeight","value":{"kind":"expression","expression":scalar}}]);
        assert_eq!(parse_style(&bad).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE", "{path}");
    }
}

#[test]
fn first_page_input_context_is_typed_and_rejected_before_layout() {
    let body: Value = serde_json::from_str(include_str!("fixtures/first-page-context.json")).unwrap();
    let style = parse_style(&body).unwrap();
    for field in [
        "firstPageFirstWordStartSeconds",
        "firstPageLastWordEndSeconds",
        "firstPageNextWordStartSeconds",
        "pageFirstWordStartSeconds",
        "pageNextWordStartSeconds",
    ] {
        let read = json!({"op":"read","path":format!("time.{field}")});
        assert_eq!(
            infer(&expr(read.clone()), style.scene(), &BTreeMap::new()).unwrap(),
            ValueType::Time
        );
        let mut bad = body.clone();
        bad["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
        bad["scene"]["value"]["layout"]["bindings"] = json!([{"nodeId":"caption","property":"lineHeight","value":{"kind":"expression","expression":{"op":"call","function":"div","args":[read,{"op":"literal","type":"time","value":1}]}}}]);
        assert_eq!(parse_style(&bad).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
    }
    for field in [
        "firstPageFirstWordTimed",
        "firstPageLastWordTimed",
        "firstPageNextWordTimed",
        "pageFirstWordTimed",
        "pageNextWordTimed",
    ] {
        let read = json!({"op":"read","path":format!("unit.{field}")});
        assert_eq!(
            infer(&expr(read.clone()), style.scene(), &BTreeMap::new()).unwrap(),
            ValueType::Bool
        );
        let mut bad = body.clone();
        bad["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
        bad["scene"]["value"]["layout"]["bindings"] = json!([{"nodeId":"caption","property":"lineHeight","value":{"kind":"expression","expression":{"op":"if","condition":read,"then":{"op":"literal","type":"scalar","value":1},"else":{"op":"literal","type":"scalar","value":2}}}}]);
        assert_eq!(parse_style(&bad).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
    }
}

#[test]
fn cue_unit_context_requires_opt_in_and_cannot_be_read_before_layout() {
    let body: Value = serde_json::from_str(include_str!("fixtures/cue-unit-context.json")).unwrap();
    let style = parse_style(&body).unwrap();
    let paths = [
        ("unit.cueWordIndex", ValueType::Scalar),
        ("unit.cueWordCount", ValueType::Scalar),
        ("unit.cueLineIndex", ValueType::Scalar),
        ("unit.cueLineCount", ValueType::Scalar),
        ("unit.cueSelectedIndex", ValueType::Scalar),
        ("unit.cueSelectedCount", ValueType::Scalar),
        ("unit.cueWordBound", ValueType::Bool),
        ("unit.cueLineBound", ValueType::Bool),
        ("unit.cueSelectionAvailable", ValueType::Bool),
    ];
    for (path, ty) in paths {
        let read = json!({"op":"read","path":path});
        assert_eq!(infer(&expr(read.clone()), style.scene(), &BTreeMap::new()).unwrap(), ty);
        let mut legacy = style.scene().clone();
        legacy.required_capabilities.retain(|cap| cap != "caption-cue-unit-context/1");
        assert_eq!(
            infer(&expr(read.clone()), &legacy, &BTreeMap::new()).unwrap_err().code,
            "CAPTION_CAPABILITY_UNAVAILABLE"
        );
        legacy.required_capabilities.push("caption-function-dag/1".into());
        assert_eq!(
            infer(&expr(read.clone()), &legacy, &BTreeMap::new()).unwrap_err().code,
            "CAPTION_CAPABILITY_UNAVAILABLE"
        );
        let scalar = if ty == ValueType::Bool {
            json!({"op":"if","condition":read,"then":{"op":"literal","type":"scalar","value":1},"else":{"op":"literal","type":"scalar","value":2}})
        } else {
            read
        };
        let mut early = body.clone();
        early["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
        early["scene"]["value"]["layout"]["bindings"] =
            json!([{"nodeId":"caption","property":"lineHeight","value":{"kind":"expression","expression":scalar}}]);
        assert_eq!(parse_style(&early).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
    }
}

#[test]
fn active_word_context_requires_opt_in_and_cannot_be_read_before_layout() {
    let body: Value = serde_json::from_str(include_str!("fixtures/active-word-context.json")).unwrap();
    let style = parse_style(&body).unwrap();
    let paths = [
        ("unit.activeWordAvailable", ValueType::Bool),
        ("unit.activeWordIndexInPage", ValueType::Scalar),
        ("time.activeWordElapsedSeconds", ValueType::Time),
        ("time.activeWordDurationSeconds", ValueType::Time),
    ];
    for (path, ty) in paths {
        let read = json!({"op":"read","path":path});
        assert_eq!(infer(&expr(read.clone()), style.scene(), &BTreeMap::new()).unwrap(), ty);
        let mut legacy = style.scene().clone();
        legacy.required_capabilities.retain(|cap| cap != "caption-active-word-context/1");
        assert_eq!(
            infer(&expr(read.clone()), &legacy, &BTreeMap::new()).unwrap_err().code,
            "CAPTION_CAPABILITY_UNAVAILABLE"
        );
        let scalar = match ty {
            ValueType::Bool => {
                json!({"op":"if","condition":read,"then":{"op":"literal","type":"scalar","value":1},"else":{"op":"literal","type":"scalar","value":2}})
            }
            ValueType::Time => json!({"op":"call","function":"div","args":[read,{"op":"literal","type":"time","value":1}]}),
            _ => read,
        };
        let mut early = body.clone();
        early["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
        early["scene"]["value"]["layout"]["bindings"] =
            json!([{"nodeId":"caption","property":"lineHeight","value":{"kind":"expression","expression":scalar}}]);
        assert_eq!(parse_style(&early).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
    }
}

#[test]
fn unit_font_reflow_admits_width_wrapped_font_sizes_without_line_identity() {
    let body: Value = serde_json::from_str(include_str!("fixtures/unit-font-reflow.json")).unwrap();
    parse_style(&body).unwrap();
    let rejected = |edit: &dyn Fn(&mut Value)| {
        let mut bad = body.clone();
        edit(&mut bad["scene"]["value"]);
        let error = parse_style(&bad).unwrap_err();
        format!("{} {}", error.code, error.detail)
    };
    // Without the capability, width-wrapped pages keep refusing unit font sizes.
    assert_eq!(
        rejected(&|scene| scene["requiredCapabilities"] = json!(["caption-unit-font-size/1"])),
        "CAPTION_SCENE_INVALID at most 64 bindings require per-sample and fixed word/text line membership or caption-unit-font-reflow/1"
    );
    // Fixed-line pages already reflow; the capability only names width-wrapped pages.
    assert_eq!(
        rejected(&|scene| {
            scene["requiredCapabilities"]
                .as_array_mut()
                .unwrap()
                .push(json!("caption-word-line-layout/1"));
            scene["layout"]["pagination"] = json!({"unit":"word","wordLinePattern":[[2]]});
        }),
        "CAPTION_SCENE_INVALID caption-unit-font-reflow/1 needs width-wrapped pages with fontSizeBindings"
    );
    assert_eq!(
        rejected(&|scene| scene["layout"]["fontSizeBindings"] = json!([])),
        "CAPTION_SCENE_INVALID caption-unit-font-reflow/1 needs width-wrapped pages with fontSizeBindings"
    );
    assert_eq!(
        rejected(&|scene| scene["selectors"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":"lines","nodeId":"caption","unit":"line"}))),
        "CAPTION_SCENE_INVALID rewrapped lines have no stable line or in-line word position"
    );
    assert_eq!(
        rejected(&|scene| scene["selectors"][1]["filter"] =
            json!({"kind":"and","filters":[{"kind":"state","value":"active"},{"kind":"parity","odd":true}]})),
        "CAPTION_SCENE_INVALID rewrapped lines have no stable line or in-line word position"
    );
    let line_clock = json!({"id":"fade","target":{"nodeId":"caption","selectorId":"active-word"},"property":"opacity","composite":"replace","value":{"kind":"keyframes","clock":{"unit":"line","origin":"start","duration":{"kind":"unit-span"}},"keys":[{"at":0,"value":0},{"at":1,"value":1}]}});
    assert_eq!(
        rejected(&|scene| scene["animations"] = json!([line_clock])),
        "CAPTION_SCENE_INVALID rewrapped lines have no stable clock"
    );
    let line_read = json!({"id":"fade","target":{"nodeId":"caption","selectorId":"page"},"property":"opacity","composite":"replace","value":{"kind":"expression","expression":{"op":"call","function":"div","args":[{"op":"read","path":"time.lineElapsedSeconds"},{"op":"literal","type":"time","value":1}]}}});
    assert_eq!(
        rejected(&|scene| scene["animations"] = json!([line_read])),
        "CAPTION_SCENE_INVALID rewrapped lines have no stable clock"
    );
    // Page sizes and word clocks stay available.
    let mut page = body.clone();
    page["scene"]["value"]["layout"]["fontSizeBindings"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"page-base","nodeId":"caption","selectorId":"page","value":{"kind":"constant","value":14}}));
    page["scene"]["value"]["animations"] = json!([{"id":"pop","target":{"nodeId":"caption","selectorId":"active-word"},"property":"transform.scale","composite":"multiply","value":{"kind":"keyframes","clock":{"unit":"word","origin":"start","duration":{"kind":"unit-span"}},"keys":[{"at":0,"value":0.9},{"at":1,"value":1}]}}]);
    parse_style(&page).unwrap();
}

#[test]
fn line_unit_quota_requires_opt_in_and_width_wrapped_pages() {
    let body: Value = serde_json::from_str(include_str!("fixtures/line-unit-quota.json")).unwrap();
    let style = parse_style(&body).unwrap();
    assert_eq!(style.scene().layout.pagination.max_units_per_line, Some(2));
    let mut legacy = body.clone();
    legacy["scene"]["value"]["requiredCapabilities"] = json!(["caption-scene/1"]);
    let error = parse_style(&legacy).unwrap_err();
    assert_eq!((error.code.as_str(), error.path.as_str()), ("CAPTION_CAPABILITY_UNAVAILABLE", "pagination.maxUnitsPerLine"));
    for quota in [0, 4097] {
        let mut bad = body.clone();
        bad["scene"]["value"]["layout"]["pagination"]["maxUnitsPerLine"] = json!(quota);
        assert_eq!(parse_style(&bad).unwrap_err().code, "CAPTION_SCENE_INVALID");
    }
    // Fixed line patterns already decide every line.
    let mut fixed = body.clone();
    let scene = &mut fixed["scene"]["value"];
    scene["requiredCapabilities"].as_array_mut().unwrap().push(json!("caption-word-line-layout/1"));
    scene["layout"]["pagination"]["wordLinePattern"] = json!([[2, 2]]);
    assert_eq!(parse_style(&fixed).unwrap_err().code, "CAPTION_SCENE_INVALID");
    // A page quota may still cut pages before the line quota folds them.
    let mut paged = body.clone();
    paged["scene"]["value"]["layout"]["pagination"]["maxUnitsPerPage"] = json!(3);
    assert!(parse_style(&paged).is_ok());
}

#[test]
fn line_neighbor_context_requires_opt_in_and_cannot_size_or_place_layout() {
    let body: Value = serde_json::from_str(include_str!("fixtures/line-neighbor-context.json")).unwrap();
    let style = parse_style(&body).unwrap();
    let paths = [
        ("unit.previousWordInLine", ValueType::Bool),
        ("layout.previousWordX", ValueType::Length),
        ("layout.previousWordY", ValueType::Length),
        ("layout.previousWordWidth", ValueType::Length),
        ("layout.previousWordHeight", ValueType::Length),
    ];
    for (path, ty) in paths {
        let read = json!({"op":"read","path":path});
        assert_eq!(infer(&expr(read.clone()), style.scene(), &BTreeMap::new()).unwrap(), ty);
        let mut legacy = style.scene().clone();
        legacy.required_capabilities.retain(|cap| cap != "caption-line-neighbor-context/1");
        assert_eq!(
            infer(&expr(read.clone()), &legacy, &BTreeMap::new()).unwrap_err().code,
            "CAPTION_CAPABILITY_UNAVAILABLE"
        );
        let scalar = match ty {
            ValueType::Bool => {
                json!({"op":"if","condition":read,"then":{"op":"literal","type":"scalar","value":1},"else":{"op":"literal","type":"scalar","value":2}})
            }
            _ => json!({"op":"call","function":"div","args":[read,{"op":"literal","type":"length","value":1}]}),
        };
        let mut early = body.clone();
        early["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
        early["scene"]["value"]["layout"]["bindings"] =
            json!([{"nodeId":"caption","property":"lineHeight","value":{"kind":"expression","expression":scalar}}]);
        assert_eq!(parse_style(&early).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
    }
    // A neighbour exists only after wrapping, so unit font sizes cannot read it either.
    let mut sized: Value = serde_json::from_str(include_str!("fixtures/unit-font-reflow.json")).unwrap();
    let scene = &mut sized["scene"]["value"];
    scene["requiredCapabilities"].as_array_mut().unwrap().push(json!("caption-line-neighbor-context/1"));
    scene["layout"]["fontSizeBindings"][0]["value"] = json!({"kind":"expression","expression":{"op":"if","condition":{"op":"read","path":"unit.previousWordInLine"},"then":{"op":"literal","type":"length","value":12},"else":{"op":"literal","type":"length","value":14}}});
    assert_eq!(parse_style(&sized).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
}
