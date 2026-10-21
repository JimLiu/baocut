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
fn word_line_tail_join_requires_opt_in_and_a_word_line_pattern() {
    let body: Value = serde_json::from_str(include_str!("fixtures/word-line-tail-join.json")).unwrap();
    let style = parse_style(&body).unwrap();
    assert_eq!(style.scene().layout.pagination.tail_word_rule, Some(TailWordRule::JoinPreviousLine));
    let mut legacy = body.clone();
    legacy["scene"]["value"]["requiredCapabilities"] = json!(["caption-word-line-layout/1"]);
    let error = parse_style(&legacy).unwrap_err();
    assert_eq!(
        (error.code.as_str(), error.path.as_str()),
        ("CAPTION_CAPABILITY_UNAVAILABLE", "pagination.tailWordRule")
    );
    let mut both = body.clone();
    both["scene"]["value"]["layout"]["pagination"]["lastPageRule"] = json!({"ifRowCountIs": 1, "previousPageLines": [4, 3, 3]});
    assert_eq!(parse_style(&both).unwrap_err().code, "CAPTION_SCENE_INVALID");
    let mut wrapped = body.clone();
    wrapped["scene"]["value"]["layout"]["pagination"] = json!({"unit": "word", "maxUnitsPerPage": 9, "tailWordRule": "join-previous-line"});
    assert_eq!(parse_style(&wrapped).unwrap_err().code, "CAPTION_SCENE_INVALID");
    let mut unknown = body.clone();
    unknown["scene"]["value"]["layout"]["pagination"]["tailWordRule"] = json!("drop");
    assert!(parse_style(&unknown).is_err());
}

#[test]
fn fixed_line_wrap_requires_opt_in_fixed_rows_and_one_line_per_row_features_absent() {
    let body: Value = serde_json::from_str(include_str!("fixtures/fixed-line-wrap.json")).unwrap();
    let style = parse_style(&body).unwrap();
    let pagination = &style.scene().layout.pagination;
    assert_eq!(pagination.fixed_line_overflow, Some(FixedLineOverflow::Wrap));
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    let path = "pagination.fixedLineOverflow";
    let mut legacy = body.clone();
    legacy["scene"]["value"]["requiredCapabilities"] = json!(["caption-word-line-layout/1"]);
    let error = parse_style(&legacy).unwrap_err();
    assert_eq!((error.code.as_str(), error.path.as_str()), ("CAPTION_CAPABILITY_UNAVAILABLE", path));
    let mut unknown = body.clone();
    unknown["scene"]["value"]["layout"]["pagination"]["fixedLineOverflow"] = json!("shrink");
    assert_eq!(parse_style(&unknown).unwrap_err().code, "CAPTION_SCENE_INVALID");
    let mut width_wrapped = body.clone();
    width_wrapped["scene"]["value"]["layout"]["pagination"] = json!({"maxUnitsPerPage": 4, "fixedLineOverflow": "wrap"});
    let error = parse_style(&width_wrapped).unwrap_err();
    assert_eq!((error.code.as_str(), error.path.as_str()), ("CAPTION_SCENE_INVALID", path));
    // Font size or style bindings and page windows need one display line per fixed row.
    for fixture in [
        include_str!("fixtures/unit-font-size.json"),
        include_str!("fixtures/unit-font-style.json"),
        include_str!("fixtures/page-window.json"),
    ] {
        let mut input: Value = serde_json::from_str(fixture).unwrap();
        parse_style(&input).unwrap();
        let scene = &mut input["scene"]["value"];
        scene["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-fixed-line-wrap/1"));
        scene["layout"]["pagination"]["fixedLineOverflow"] = json!("wrap");
        let error = parse_style(&input).unwrap_err();
        assert_eq!((error.code.as_str(), error.path.as_str()), ("CAPTION_SCENE_INVALID", path));
    }
    // Text and remaining-count fixed rows wrap the same way.
    let mut text_rows = body.clone();
    text_rows["scene"]["value"]["requiredCapabilities"] = json!(["caption-text-line-layout/1", "caption-fixed-line-wrap/1"]);
    text_rows["scene"]["value"]["layout"]["pagination"] =
        json!({"textLinePattern": {"unit": "grapheme", "lines": [[8]]}, "fixedLineOverflow": "wrap"});
    parse_style(&text_rows).unwrap();
}

#[test]
fn fixed_line_fit_requires_opt_in_fixed_rows_bounded_factors_and_single_line_rows() {
    let body: Value = serde_json::from_str(include_str!("fixtures/fixed-line-fit.json")).unwrap();
    let style = parse_style(&body).unwrap();
    let fit = style.scene().layout.pagination.fixed_line_fit.unwrap();
    assert_eq!(
        (fit.last_line_width_ratio, fit.last_line_max_scale, fit.extra_line_height),
        (0.5, 1.3, 0.1)
    );
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    let path = "pagination.fixedLineFit";
    let code = |input: &Value| {
        let error = parse_style(input).unwrap_err();
        (error.code, error.path)
    };
    let invalid = ("CAPTION_SCENE_INVALID".to_string(), path.to_string());
    let mut legacy = body.clone();
    legacy["scene"]["value"]["requiredCapabilities"] = json!(["caption-word-line-layout/1"]);
    assert_eq!(code(&legacy), ("CAPTION_CAPABILITY_UNAVAILABLE".to_string(), path.to_string()));
    for (field, value) in [
        ("lastLineWidthRatio", json!(1.5)),
        ("lastLineWidthRatio", json!(-0.1)),
        ("lastLineMaxScale", json!(0.5)),
        ("lastLineMaxScale", json!(101)),
        ("extraLineHeight", json!(-0.1)),
        ("extraLineHeight", json!(11)),
    ] {
        let mut bad = body.clone();
        bad["scene"]["value"]["layout"]["pagination"]["fixedLineFit"][field] = value;
        assert_eq!(code(&bad), invalid, "{field}");
    }
    let mut extra_field = body.clone();
    extra_field["scene"]["value"]["layout"]["pagination"]["fixedLineFit"]["scale"] = json!(1);
    assert!(parse_style(&extra_field).is_err());
    let mut missing = body.clone();
    missing["scene"]["value"]["layout"]["pagination"]["fixedLineFit"]
        .as_object_mut()
        .unwrap()
        .remove("extraLineHeight");
    assert!(parse_style(&missing).is_err());
    let mut width_paged = body.clone();
    width_paged["scene"]["value"]["layout"]["pagination"] = json!({"maxUnitsPerPage": 4, "fixedLineFit": fit});
    assert_eq!(code(&width_paged), invalid);
    // Fitted rows never wrap, and unit font size or style bindings would change the measured rows.
    let mut wrapped = body.clone();
    wrapped["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-fixed-line-wrap/1"));
    wrapped["scene"]["value"]["layout"]["pagination"]["fixedLineOverflow"] = json!("wrap");
    assert_eq!(code(&wrapped), invalid);
    let with_fit = |fixture: &str| {
        let mut input: Value = serde_json::from_str(fixture).unwrap();
        parse_style(&input).unwrap();
        let scene = &mut input["scene"]["value"];
        scene["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-fixed-line-fit/1"));
        scene["layout"]["pagination"]["fixedLineFit"] = json!(fit);
        input
    };
    for fixture in [
        include_str!("fixtures/unit-font-size.json"),
        include_str!("fixtures/unit-font-style.json"),
    ] {
        assert_eq!(code(&with_fit(fixture)), invalid);
    }
    // Fitted row heights come from the page scale, so a text font line box is rejected.
    let mut boxed = body.clone();
    boxed["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-font-line-box/1"));
    boxed["scene"]["value"]["nodes"][0]["style"]["lineBox"] = json!({"minAscent": 0.8});
    assert_eq!(parse_style(&boxed).unwrap_err().code, "CAPTION_SCENE_INVALID");
    // Page windows keep one display line per row, so they combine with fit.
    parse_style(&with_fit(include_str!("fixtures/page-window.json"))).unwrap();
    let mut text_rows = body.clone();
    text_rows["scene"]["value"]["requiredCapabilities"] = json!(["caption-text-line-layout/1", "caption-fixed-line-fit/1"]);
    text_rows["scene"]["value"]["layout"]["pagination"] =
        json!({"textLinePattern": {"unit": "grapheme", "lines": [[8, 6]]}, "fixedLineFit": fit});
    parse_style(&text_rows).unwrap();
}

#[test]
fn remaining_word_page_plans_require_opt_in_bounded_entries_and_exclusivity() {
    let body: Value = serde_json::from_str(include_str!("fixtures/remaining-word-page-plan.json")).unwrap();
    let style = parse_style(&body).unwrap();
    let plans = style.scene().layout.pagination.remaining_word_page_plans.clone().unwrap();
    assert_eq!(plans[3], vec![1, 1, 1, 1]);
    assert!(style.scene().layout.pagination.has_fixed_lines());
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    let mut legacy = body.clone();
    legacy["scene"]["value"]["requiredCapabilities"] = json!(["caption-word-line-layout/1"]);
    let error = parse_style(&legacy).unwrap_err();
    assert_eq!(
        (error.code.as_str(), error.path.as_str()),
        ("CAPTION_CAPABILITY_UNAVAILABLE", "pagination.remainingWordPagePlans")
    );
    let plan_path = "pagination.remainingWordPagePlans";
    for (field, value, path) in [
        // Entry i may hold at most i + 1 words.
        ("remainingWordPagePlans", json!([[1], [3]]), plan_path),
        ("remainingWordPagePlans", json!([[2]]), plan_path),
        ("remainingWordPagePlans", json!([]), plan_path),
        ("remainingWordPagePlans", json!([[1], []]), plan_path),
        ("remainingWordPagePlans", json!([[1], [1, 1], [1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1, 1]]), plan_path),
        ("remainingWordPagePlans", json!([[1], [0, 2]]), plan_path),
        ("maxUnitsPerPage", json!(4), plan_path),
        ("wordLinePattern", json!([[2]]), plan_path),
        ("textLinePattern", json!({"unit": "grapheme", "lines": [[4]]}), plan_path),
        ("maxUnitsPerLine", json!(2), "pagination.maxUnitsPerLine"),
        ("wordPagePattern", json!([2]), "pagination.wordPagePattern"),
    ] {
        let mut input = body.clone();
        input["scene"]["value"]["requiredCapabilities"] = json!([
            "caption-remaining-word-page-plan/1",
            "caption-word-line-layout/1",
            "caption-word-page-layout/1",
            "caption-text-line-layout/1",
            "caption-line-unit-quota/1"
        ]);
        input["scene"]["value"]["layout"]["pagination"][field] = value;
        let error = parse_style(&input).unwrap_err();
        assert_eq!((error.code.as_str(), error.path.as_str()), ("CAPTION_SCENE_INVALID", path), "{field}");
    }
    let mut over = body.clone();
    over["scene"]["value"]["layout"]["pagination"]["remainingWordPagePlans"] = json!(vec![vec![1]; 257]);
    assert_eq!(parse_style(&over).unwrap_err().code, "CAPTION_SCENE_INVALID");
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
fn shape_paint_requires_opt_in_a_shape_and_no_fill_override() {
    let body: Value = serde_json::from_str(include_str!("fixtures/shape-paint.json")).unwrap();
    let style = parse_style(&body).unwrap();
    let box_node = &style.scene().nodes[1].children[0];
    assert!(matches!(box_node.fill_paint, Some(ScenePaint::Linear { .. })));
    // Shapes without a paint keep serializing exactly as before.
    let plain = serde_json::to_value(&style.scene().nodes[0]).unwrap();
    assert!(plain.get("fillPaint").is_none());
    let reject = |edit: &dyn Fn(&mut Value), code: &str| {
        let mut changed = body.clone();
        edit(&mut changed["scene"]["value"]);
        assert_eq!(parse_style(&changed).unwrap_err().code, code);
    };
    reject(&|s| s["requiredCapabilities"] = json!([]), "CAPTION_CAPABILITY_REQUIRED");
    // Text, group and image nodes do not take a fill paint.
    reject(
        &|s| s["nodes"][0]["fillPaint"] = json!({"kind":"solid","color":"#FFFFFF"}),
        "CAPTION_SCENE_INVALID",
    );
    reject(
        &|s| s["nodes"][1]["children"][0]["properties"]["fill"] = json!({"kind":"constant","value":"#FFFFFF"}),
        "CAPTION_SCENE_INVALID",
    );
    reject(
        &|s| {
            s["animations"] = json!([{"id":"tint","target":{"nodeId":"box"},"property":"fill","composite":"replace",
                "value":{"kind":"constant","value":"#FFFFFF"}}])
        },
        "CAPTION_SCENE_INVALID",
    );
    // The same fill overrides are valid on a shape without a paint.
    let mut solid = body.clone();
    let scene = &mut solid["scene"]["value"];
    scene["nodes"][1]["children"][0].as_object_mut().unwrap().remove("fillPaint");
    scene["nodes"][1]["children"][0]["properties"]["fill"] = json!({"kind":"constant","value":"#FFFFFF"});
    scene["animations"] = json!([{"id":"tint","target":{"nodeId":"box"},"property":"fill","composite":"replace",
        "value":{"kind":"constant","value":"#FFFFFF"}}]);
    assert!(parse_style(&solid).is_ok());
    reject(
        &|s| s["nodes"][1]["children"][0]["fillPaint"]["stops"][1]["at"] = json!(0),
        "CAPTION_SCENE_INVALID",
    );
    reject(
        &|s| s["nodes"][1]["children"][0]["fillPaint"]["to"] = json!([0, 0.5]),
        "CAPTION_SCENE_INVALID",
    );
    // Shape style stays text-only.
    reject(
        &|s| s["nodes"][1]["children"][0]["style"] = json!({"paints":[{"id":"p","paint":{"kind":"solid","color":"#FFFFFF"}}]}),
        "CAPTION_SCENE_INVALID",
    );
    // Shape fills take solid or plain linear paints; text-only paint kinds and gradient options are rejected.
    let stops = json!([{"at":0,"color":"#000000"},{"at":1,"color":"#FFFFFF"}]);
    for paint in [
        json!({"kind":"node-fill"}),
        json!({"kind":"image","resourceId":"img","uvTransform":[1,0,0,1,0,0],"space":"glyph-em"}),
        json!({"kind":"linear","from":[0,0],"to":[1,0],"stops":stops,"space":"normalized"}),
        json!({"kind":"linear","from":[0,0],"to":[1,0],"stops":stops,"domain":"page"}),
        json!({"kind":"linear","from":[0,0],"to":[1,0],"stops":stops,"glyphOutset":0.5}),
    ] {
        reject(&|s| s["nodes"][1]["children"][0]["fillPaint"] = paint.clone(), "CAPTION_SCENE_INVALID");
    }
}

#[test]
fn line_box_context_requires_opt_in_and_cannot_size_or_place_layout() {
    let body: Value = serde_json::from_str(include_str!("fixtures/line-box-context.json")).unwrap();
    let style = parse_style(&body).unwrap();
    for path in ["layout.lineBoxX", "layout.lineBoxY", "layout.lineBoxWidth", "layout.lineBoxHeight"] {
        let read = json!({"op":"read","path":path});
        assert_eq!(infer(&expr(read.clone()), style.scene(), &BTreeMap::new()).unwrap(), ValueType::Length);
        let mut legacy = style.scene().clone();
        legacy.required_capabilities.retain(|cap| cap != "caption-line-box-context/1");
        assert_eq!(
            infer(&expr(read.clone()), &legacy, &BTreeMap::new()).unwrap_err().code,
            "CAPTION_CAPABILITY_UNAVAILABLE"
        );
        let scalar = json!({"op":"call","function":"div","args":[read,{"op":"literal","type":"length","value":1}]});
        let mut early = body.clone();
        early["scene"]["value"]["layout"]["layoutEvaluation"] = json!("per-sample");
        early["scene"]["value"]["layout"]["bindings"] =
            json!([{"nodeId":"caption","property":"lineHeight","value":{"kind":"expression","expression":scalar}}]);
        assert_eq!(parse_style(&early).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
    }
    // The line box exists only after wrapping, so unit font sizes cannot read it either.
    let mut sized: Value = serde_json::from_str(include_str!("fixtures/unit-font-reflow.json")).unwrap();
    let scene = &mut sized["scene"]["value"];
    scene["requiredCapabilities"].as_array_mut().unwrap().push(json!("caption-line-box-context/1"));
    scene["layout"]["fontSizeBindings"][0]["value"] = json!({"kind":"expression","expression":{"op":"call","function":"div","args":[{"op":"read","path":"layout.lineBoxWidth"},{"op":"literal","type":"scalar","value":10}]}});
    assert_eq!(parse_style(&sized).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
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

#[test]
fn page_line_context_reads_bounded_slots_and_keeps_geometry_out_of_sizing() {
    let body: Value = serde_json::from_str(include_str!("fixtures/page-line-context.json")).unwrap();
    let style = parse_style(&body).unwrap();
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    let scene = style.scene();
    for (path, ty) in [
        ("layout.pageLineBoxX.0", ValueType::Length),
        ("layout.pageLineBoxWidth.3", ValueType::Length),
        ("unit.pageLineGraphemeCount.2", ValueType::Scalar),
    ] {
        let read = json!({"op":"read","path":path});
        assert_eq!(infer(&expr(read.clone()), scene, &BTreeMap::new()).unwrap(), ty);
        let mut legacy = scene.clone();
        legacy.required_capabilities.retain(|cap| cap != "caption-page-line-context/1");
        assert_eq!(
            infer(&expr(read), &legacy, &BTreeMap::new()).unwrap_err().code,
            "CAPTION_CAPABILITY_UNAVAILABLE"
        );
    }
    // Slots are canonical decimals below maxLines (4 here) and the 16-slot ceiling.
    for path in [
        "layout.pageLineBoxX.4",
        "layout.pageLineBoxX.01",
        "layout.pageLineBoxX.16",
        "layout.pageLineBoxX.x",
        "layout.pageLineBoxX",
        "unit.pageLineGraphemeCount.",
    ] {
        let read = json!({"op":"read","path":path});
        assert_eq!(infer(&expr(read), scene, &BTreeMap::new()).unwrap_err().code, "CAPTION_EXPRESSION_TYPE", "{path}");
    }
    assert_eq!(page_line_slot("unit.pageLineGraphemeCount.15"), Some(("unit.pageLineGraphemeCount", 15)));
    // Line geometry exists only after sizing and wrapping; grapheme counts come from frozen lines.
    let mut sized = body.clone();
    sized["scene"]["value"]["layout"]["fontSizeBindings"][0]["value"] = json!({"kind":"expression","expression":
        {"op":"read","path":"layout.pageLineBoxWidth.1"}});
    assert_eq!(parse_style(&sized).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
    let mut early = body.clone();
    early["scene"]["value"]["layout"]["bindings"] = json!([{"nodeId":"caption","property":"lineHeight","value":{"kind":"expression","expression":
        {"op":"read","path":"unit.pageLineGraphemeCount.0"}}}]);
    assert_eq!(parse_style(&early).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
}

#[test]
fn paint_effects_need_their_capability_and_keep_bounded_layers() {
    let shadow = json!({"id":"shadow","unit":"em","offset":[0.05,0.05],"blur":0.1,"paint":{"kind":"solid","color":"#00000080"}});
    let fill = json!({"id":"fill","paint":{"kind":"node-fill"}});
    let with = |paints: Value, capability: bool| {
        let mut v = fixture();
        v["scene"]["value"]["nodes"][0]["style"]["paints"] = paints;
        if capability {
            v["scene"]["value"]["requiredCapabilities"]
                .as_array_mut()
                .unwrap()
                .push(json!("caption-paint-effects/1"));
        }
        v
    };
    // node-fill is where the word-color animation lands, so the stack is no longer exclusive.
    let style = parse_style(&with(json!([shadow.clone(), fill.clone()]), true)).unwrap();
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    assert_eq!(
        parse_style(&with(json!([shadow.clone(), fill.clone()]), false)).unwrap_err().code,
        "CAPTION_CAPABILITY_REQUIRED"
    );
    let solid = json!({"id":"fill","paint":{"kind":"solid","color":"#FFFFFF"}});
    assert!(parse_style(&with(json!([shadow.clone(), solid]), true)).is_err());
    for (field, value) in [
        ("blur", json!(4.5)),
        ("blur", json!(-0.1)),
        ("spread", json!(5)),
        ("offset", json!([17, 0])),
        ("unit", json!("pt")),
        ("glow", json!(1)),
    ] {
        let mut layer = shadow.clone();
        layer[field] = value;
        assert!(parse_style(&with(json!([layer, fill.clone()]), true)).is_err(), "{field}");
    }
    let mut both = shadow.clone();
    both["spread"] = json!(0.1);
    both["strokeWidth"] = json!(0.1);
    assert!(parse_style(&with(json!([both, fill.clone()]), true)).is_err());
    let translucent = json!({"id":"edge","spread":0.1,"unit":"em","paint":{"kind":"linear","from":[0,0],"to":[1,0],"stops":[{"at":0,"color":"#FF000080"},{"at":1,"color":"#0000FF"}]}});
    assert!(parse_style(&with(json!([translucent, fill.clone()]), true)).is_err());
    let mut legacy = with(json!([shadow, fill]), true);
    legacy["scene"]["value"]["nodes"][0]["style"]["stroke"] = json!({"width":2,"color":"#000000"});
    assert!(parse_style(&legacy).is_err());
}
#[test]
fn text_transform_needs_its_capability_and_known_case() {
    let mut v = fixture();
    v["scene"]["value"]["nodes"][0]["style"]["textTransform"] = json!("uppercase");
    assert_eq!(parse_style(&v).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    v["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-text-transform/1"));
    let style = parse_style(&v).unwrap();
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    v["scene"]["value"]["nodes"][0]["style"]["textTransform"] = json!("capitalize");
    assert!(parse_style(&v).is_err());
    assert_eq!(TextTransform::Uppercase.apply("straße"), "STRASSE");
}

fn coverage_contract_style(coverage: Option<Value>) -> Value {
    let mut body = fixture();
    let scene = &mut body["scene"]["value"];
    scene["animations"] = json!([]);
    scene["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-paint-coverage/1"));
    let mut layer = json!({"id":"ink","paint":{"kind":"solid","color":"#FFFFFF80"}});
    if let Some(coverage) = coverage {
        layer["coverage"] = coverage;
    }
    scene["nodes"][0]["style"]["paints"] = json!([layer]);
    body
}

#[test]
fn coverage_contract_is_explicit_roundtrippable_and_omitted_for_legacy_layers() {
    let body = coverage_contract_style(Some(json!({"lo":0.03,"hi":0.2})));
    let style = parse_style(&body).unwrap();
    assert_eq!(
        style.scene().nodes[0].style.paints[0].coverage,
        Some(PaintCoverage { lo: 0.03, hi: 0.2 })
    );
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    let mut unadvertised = body;
    unadvertised["scene"]["value"]["requiredCapabilities"] = json!(["caption-scene/1", "caption-expressions/1"]);
    assert_eq!(parse_style(&unadvertised).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    let legacy = parse_style(&coverage_contract_style(None)).unwrap();
    assert!(legacy.scene().nodes[0].style.paints[0].coverage.is_none());
    assert!(
        serde_json::to_value(legacy).unwrap()["scene"]["value"]["nodes"][0]["style"]["paints"][0]
            .get("coverage")
            .is_none()
    );
}

#[test]
fn coverage_contract_rejects_bad_ranges_types_unknown_fields_and_nonfinite_numbers() {
    for coverage in [
        json!({"lo":-0.01,"hi":0.2}),
        json!({"lo":0,"hi":1.01}),
        json!({"lo":0.3,"hi":0.2}),
        json!({"lo":0.2,"hi":0.2}),
        json!({"lo":0,"hi":0}),
        json!({"lo":1,"hi":1}),
        json!({"lo":0,"hi":"0.2"}),
        json!({"lo":0}),
        json!({"hi":0.2}),
        json!({"lo":0,"hi":0.2,"gamma":2}),
        json!([0, 0.2]),
        json!(null),
        json!(false),
    ] {
        assert!(parse_style(&coverage_contract_style(Some(coverage.clone()))).is_err(), "{coverage}");
    }
    for coverage in [json!({"lo":0,"hi":1}), json!({"lo":0.999,"hi":1})] {
        assert!(parse_style(&coverage_contract_style(Some(coverage))).is_ok());
    }
    let mut scene = parse_style(&coverage_contract_style(Some(json!({"lo":0,"hi":0.2}))))
        .unwrap()
        .scene()
        .clone();
    for (lo, hi) in [(f64::NAN, 0.2), (0.0, f64::NAN), (f64::NEG_INFINITY, 0.2), (0.0, f64::INFINITY)] {
        scene.nodes[0].style.paints[0].coverage = Some(PaintCoverage { lo, hi });
        assert!(validate_scene(&scene).is_err());
    }
}

#[test]
fn coverage_gradients_require_opaque_stops_even_without_blur_or_spread() {
    let mut body = coverage_contract_style(Some(json!({"lo":0,"hi":0.2})));
    let gradient = json!({"kind":"linear","from":[0,0],"to":[1,0],"stops":[{"at":0,"color":"#FF0000"},{"at":1,"color":"#0000FF"}]});
    body["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"] = gradient;
    assert!(parse_style(&body).is_ok());
    for color in ["#FF000080", "#FF000000", "#FF0000FE"] {
        body["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["stops"][0]["color"] = json!(color);
        assert!(parse_style(&body).is_err(), "{color}");
    }
    body["scene"]["value"]["nodes"][0]["style"]["paints"][0]
        .as_object_mut()
        .unwrap()
        .remove("coverage");
    assert!(parse_style(&body).is_ok(), "legacy translucent gradient remains supported");
}

fn gradient_space_contract_style(space: Option<Value>) -> Value {
    let mut body = fixture();
    body["scene"]["value"]["animations"] = json!([]);
    let mut paint =
        json!({"kind":"linear","from":[0.2,-0.1],"to":[0.8,0.9],"stops":[{"at":0,"color":"#FF0000"},{"at":1,"color":"#0000FF80"}]});
    if let Some(space) = space {
        paint["space"] = space;
    }
    body["scene"]["value"]["nodes"][0]["style"]["paints"] = json!([{"id":"ink","paint":paint}]);
    body
}

#[test]
fn gradient_space_local_defaults_preserve_the_legacy_serialized_contract() {
    let legacy = parse_style(&gradient_space_contract_style(None)).unwrap();
    let explicit = parse_style(&gradient_space_contract_style(Some(json!("local")))).unwrap();
    assert_eq!(legacy, explicit);
    assert!(matches!(
        &legacy.scene().nodes[0].style.paints[0].paint,
        ScenePaint::Linear {
            space: GradientSpace::Local,
            ..
        }
    ));
    let serialized = serde_json::to_value(&explicit).unwrap();
    assert!(
        serialized["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]
            .get("space")
            .is_none()
    );
    assert_eq!(parse_style(&serialized).unwrap(), explicit);
}

#[test]
fn normalized_gradient_space_requires_its_capability_and_roundtrips() {
    let mut body = gradient_space_contract_style(Some(json!("normalized")));
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-gradient-space/1"));
    let style = parse_style(&body).unwrap();
    assert!(matches!(
        &style.scene().nodes[0].style.paints[0].paint,
        ScenePaint::Linear {
            space: GradientSpace::Normalized,
            ..
        }
    ));
    let serialized = serde_json::to_value(&style).unwrap();
    assert_eq!(
        serialized["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["space"],
        json!("normalized")
    );
    assert_eq!(parse_style(&serialized).unwrap(), style);
    let mut unadvertised = style.scene().clone();
    unadvertised.required_capabilities.retain(|cap| cap != "caption-gradient-space/1");
    assert_eq!(validate_scene(&unadvertised).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
}

#[test]
fn gradient_space_rejects_null_unknown_enum_values_and_unknown_fields() {
    for space in [
        json!(null),
        json!(false),
        json!(1),
        json!([]),
        json!({}),
        json!(""),
        json!("Normalized"),
        json!("uv"),
        json!("canvas"),
    ] {
        assert!(parse_style(&gradient_space_contract_style(Some(space.clone()))).is_err(), "{space}");
    }
    let mut body = gradient_space_contract_style(Some(json!("local")));
    body["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["aspect"] = json!(true);
    assert!(parse_style(&body).is_err());
}

#[test]
fn normalized_gradient_retains_endpoint_and_coverage_alpha_validation() {
    let mut body = gradient_space_contract_style(Some(json!("normalized")));
    body["scene"]["value"]["requiredCapabilities"].as_array_mut().unwrap().extend([
        json!("caption-gradient-space/1"),
        json!("caption-paint-coverage/1"),
        json!("caption-paint-effects/1"),
    ]);
    assert!(parse_style(&body).is_ok(), "translucent fill stops remain valid");
    for property in ["coverage", "spread"] {
        let mut effect = body.clone();
        effect["scene"]["value"]["nodes"][0]["style"]["paints"][0][property] = if property == "coverage" {
            json!({"lo":0,"hi":0.2})
        } else {
            json!(2)
        };
        assert!(parse_style(&effect).is_err(), "{property} requires opaque stops");
        effect["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["stops"][1]["color"] = json!("#0000FF");
        assert!(parse_style(&effect).is_ok(), "{property}");
    }
    for to in [json!([0.2, -0.1]), json!([17, 1]), json!([1, "1"])] {
        let mut bad = body.clone();
        bad["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["to"] = to;
        assert!(parse_style(&bad).is_err());
    }
    let mut scene = parse_style(&body).unwrap().scene().clone();
    if let ScenePaint::Linear { to, .. } = &mut scene.nodes[0].style.paints[0].paint {
        to[1] = f64::NAN;
    }
    assert!(validate_scene(&scene).is_err());
}

#[test]
fn gradient_page_domain_requires_capability_and_line_defaults_stay_omitted() {
    let legacy = parse_style(&gradient_space_contract_style(None)).unwrap();
    let mut body = gradient_space_contract_style(None);
    body["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["domain"] = json!("line");
    assert_eq!(parse_style(&body).unwrap(), legacy);
    let serialized = serde_json::to_value(&legacy).unwrap();
    assert!(
        serialized["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]
            .get("domain")
            .is_none()
    );
    body["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["domain"] = json!("page");
    assert_eq!(
        parse_style(&body).unwrap_err().code,
        "CAPTION_CAPABILITY_REQUIRED",
        "page requires opt-in even with local space"
    );
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-gradient-space/1"));
    for space in ["local", "normalized"] {
        body["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["space"] = json!(space);
        let style = parse_style(&body).unwrap();
        assert!(matches!(
            &style.scene().nodes[0].style.paints[0].paint,
            ScenePaint::Linear {
                domain: GradientDomain::Page,
                ..
            }
        ));
        let roundtrip = serde_json::to_value(&style).unwrap();
        assert_eq!(
            roundtrip["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["domain"],
            json!("page")
        );
        assert_eq!(parse_style(&roundtrip).unwrap(), style);
    }
    for domain in [
        json!(null),
        json!(false),
        json!(1),
        json!([]),
        json!({}),
        json!("all"),
        json!("Page"),
        json!("canvas"),
    ] {
        body["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["domain"] = domain.clone();
        assert!(parse_style(&body).is_err(), "{domain}");
    }
}

fn linear_paint(body: &mut Value) -> &mut Value {
    &mut body["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]
}

#[test]
fn gradient_glyph_domain_requires_its_capability_and_bounds_its_outset() {
    let mut body = gradient_space_contract_style(None);
    linear_paint(&mut body)["domain"] = json!("glyph");
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-gradient-glyph/1"));
    let style = parse_style(&body).unwrap();
    assert!(matches!(
        &style.scene().nodes[0].style.paints[0].paint,
        ScenePaint::Linear {
            domain: GradientDomain::Glyph,
            glyph_outset: 0.0,
            ..
        }
    ));
    let roundtrip = serde_json::to_value(&style).unwrap();
    let written = &roundtrip["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"];
    assert_eq!(written["domain"], json!("glyph"));
    assert!(written.get("glyphOutset").is_none(), "zero outset stays omitted");

    linear_paint(&mut body)["glyphOutset"] = json!(0.4);
    let style = parse_style(&body).unwrap();
    let roundtrip = serde_json::to_value(&style).unwrap();
    assert_eq!(
        roundtrip["scene"]["value"]["nodes"][0]["style"]["paints"][0]["paint"]["glyphOutset"],
        json!(0.4)
    );
    assert_eq!(parse_style(&roundtrip).unwrap(), style);

    linear_paint(&mut body)["space"] = json!("normalized");
    assert_eq!(
        parse_style(&body).unwrap_err().code,
        "CAPTION_CAPABILITY_REQUIRED",
        "normalized still needs the gradient space capability"
    );
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-gradient-space/1"));
    assert!(parse_style(&body).is_ok());

    for outset in [json!(-0.1), json!(4.5), json!(null), json!("0.4")] {
        let mut bad = body.clone();
        linear_paint(&mut bad)["glyphOutset"] = outset.clone();
        assert!(parse_style(&bad).is_err(), "{outset}");
    }
    for domain in ["line", "page"] {
        let mut bad = body.clone();
        linear_paint(&mut bad)["domain"] = json!(domain);
        assert_eq!(
            parse_style(&bad).unwrap_err().code,
            "CAPTION_SCENE_INVALID",
            "{domain} with an outset"
        );
    }
    let mut scene = parse_style(&body).unwrap().scene().clone();
    if let ScenePaint::Linear { glyph_outset, .. } = &mut scene.nodes[0].style.paints[0].paint {
        *glyph_outset = f64::INFINITY;
    }
    assert!(validate_scene(&scene).is_err());
}

fn font_line_box_contract_style(line_box: Value) -> Value {
    let mut body = fixture();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-font-line-box/1"));
    body["scene"]["value"]["nodes"][0]["style"]["lineBox"] = line_box;
    body
}

fn font_source_contract_style(source: Value) -> Value {
    let mut body = fixture();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-font-source/1"));
    body["scene"]["value"]["nodes"][0]["style"]["fontSource"] = source;
    body
}

#[test]
fn font_source_contract_requires_capability_defaults_face_and_preserves_legacy_serialization() {
    let legacy = parse_style(&fixture()).unwrap();
    assert!(legacy.scene().nodes[0].style.font_source.is_none());
    let serialized = serde_json::to_value(&legacy).unwrap();
    assert!(serialized["scene"]["value"]["nodes"][0]["style"].get("fontSource").is_none());
    assert_eq!(parse_style(&serialized).unwrap(), legacy);
    let hash = "0123456789abcdef".repeat(4);
    for source in [json!({"sha256":hash}), json!({"sha256":hash,"faceIndex":1023})] {
        let mut body = font_source_contract_style(source.clone());
        // This is persistent identity, not a filesystem/family lookup at parse.
        body["scene"]["value"]["nodes"][0]["style"]["fontFamily"] = json!("Human display family");
        let parsed = parse_style(&body).unwrap();
        let expected_face = source.get("faceIndex").and_then(Value::as_u64).unwrap_or(0) as u32;
        assert_eq!(
            parsed.scene().nodes[0].style.font_source,
            Some(FontSource {
                sha256: hash.clone(),
                face_index: expected_face
            })
        );
        assert_eq!(parsed.scene().nodes[0].style.font_family, "Human display family");
        assert_eq!(parse_style(&serde_json::to_value(&parsed).unwrap()).unwrap(), parsed);
        body["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .retain(|cap| cap != "caption-font-source/1");
        assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
        let mut scene = parsed.scene().clone();
        scene.required_capabilities.retain(|cap| cap != "caption-font-source/1");
        assert_eq!(validate_scene(&scene).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    }
}

#[test]
fn font_source_contract_rejects_null_hash_case_unknown_fields_and_face_bounds() {
    let hash = "a".repeat(64);
    for source in [
        Value::Null,
        json!([]),
        json!("family"),
        json!({}),
        json!({"sha256":null}),
        json!({"sha256":"a".repeat(63)}),
        json!({"sha256":"a".repeat(65)}),
        json!({"sha256":"A".repeat(64)}),
        json!({"sha256":"g".repeat(64)}),
        json!({"sha256":"é".repeat(32)}),
        json!({"sha256":hash,"path":"font.ttf"}),
        json!({"sha256":hash,"faceIndex":null}),
        json!({"sha256":hash,"faceIndex":-1}),
        json!({"sha256":hash,"faceIndex":0.5}),
        json!({"sha256":hash,"faceIndex":1024}),
        json!({"sha256":hash,"faceIndex":4294967296_u64}),
    ] {
        assert!(parse_style(&font_source_contract_style(source.clone())).is_err(), "{source}");
    }
    // Typed callers must observe the same validation as JSON callers.
    let mut scene = parse_style(&font_source_contract_style(json!({"sha256":hash})))
        .unwrap()
        .scene()
        .clone();
    scene.nodes[0].style.font_source.as_mut().unwrap().face_index = 1024;
    assert!(validate_scene(&scene).is_err());
}

#[test]
fn font_source_contract_is_text_or_label_only() {
    let hash = "b".repeat(64);
    let mut label: Value = serde_json::from_str(include_str!("fixtures/bound-label.json")).unwrap();
    label["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-font-source/1"));
    label["scene"]["value"]["nodes"][1]["children"][0]["style"]["fontSource"] = json!({"sha256":hash});
    let parsed = parse_style(&label).unwrap();
    assert_eq!(
        parsed.scene().nodes[1].children[0].style.font_source.as_ref().unwrap().face_index,
        0
    );
    for node in [json!({"id":"plain","type":"group"}), json!({"id":"plain","type":"shape"})] {
        let mut body = fixture();
        body["scene"]["value"]["nodes"].as_array_mut().unwrap().push(node);
        assert!(parse_style(&body).is_ok(), "non-text baseline must be valid");
        body["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-font-source/1"));
        body["scene"]["value"]["nodes"][1]["style"]["fontSource"] = json!({"sha256":hash});
        assert!(parse_style(&body).is_err());
    }
    let mut image: Value = serde_json::from_str(include_str!("fixtures/image-paint.json")).unwrap();
    assert!(parse_style(&image).is_ok());
    image["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-font-source/1"));
    image["scene"]["value"]["nodes"][1]["children"][0]["style"]["fontSource"] = json!({"sha256":hash});
    assert!(parse_style(&image).is_err());
}

#[test]
fn font_line_box_contract_requires_capability_roundtrips_and_preserves_omitted_default() {
    let legacy = parse_style(&fixture()).unwrap();
    assert!(legacy.scene().nodes[0].style.line_box.is_none());
    assert!(
        serde_json::to_value(&legacy).unwrap()["scene"]["value"]["nodes"][0]["style"]
            .get("lineBox")
            .is_none()
    );
    let minimal = parse_style(&font_line_box_contract_style(json!({}))).unwrap();
    assert_eq!(
        minimal.scene().nodes[0].style.line_box,
        Some(FontLineBox {
            min_ascent: 0.0,
            min_descent: 0.0,
            metric_source: LineMetricSource::Font,
            fallback_probe: None
        })
    );
    for line_box in [
        json!({}),
        json!({"metricSource":"font","minAscent":1.25,"minDescent":0.35}),
        json!({"metricSource":"typographic","minAscent":0.7,"minDescent":0.2,"fallbackProbe":"Å"}),
        json!({"metricSource":"typographic","fallbackProbe":"😀"}),
    ] {
        let mut body = font_line_box_contract_style(line_box);
        let style = parse_style(&body).unwrap();
        assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
        body["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .retain(|cap| cap != "caption-font-line-box/1");
        assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
        let mut scene = style.scene().clone();
        scene.required_capabilities.retain(|cap| cap != "caption-font-line-box/1");
        assert_eq!(validate_scene(&scene).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    }
}

#[test]
fn font_line_box_contract_rejects_invalid_objects_sources_ranges_and_multiscalar_probes() {
    for line_box in [
        json!(null),
        json!(false),
        json!([]),
        json!("font"),
        json!({"unknown":1}),
        json!({"metricSource":null}),
        json!({"metricSource":"Font"}),
        json!({"metricSource":"ink"}),
        json!({"minAscent":-0.01}),
        json!({"minDescent":4.01}),
        json!({"minAscent":"1.25"}),
        json!({"minDescent":null}),
        json!({"metricSource":"font","fallbackProbe":"A"}),
        json!({"metricSource":"typographic","fallbackProbe":null}),
        json!({"metricSource":"typographic","fallbackProbe":""}),
        json!({"metricSource":"typographic","fallbackProbe":"AB"}),
        json!({"metricSource":"typographic","fallbackProbe":"e\u{301}"}),
        json!({"metricSource":"typographic","fallbackProbe":"👩‍💻"}),
        json!({"metricSource":"typographic","fallbackProbe":65}),
    ] {
        assert!(parse_style(&font_line_box_contract_style(line_box.clone())).is_err(), "{line_box}");
    }
    assert!(parse_style(&font_line_box_contract_style(json!({"minAscent":0,"minDescent":4}))).is_ok());
    let mut scene = parse_style(&font_line_box_contract_style(json!({}))).unwrap().scene().clone();
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        scene.nodes[0].style.line_box.as_mut().unwrap().min_ascent = value;
        assert!(validate_scene(&scene).is_err());
        scene.nodes[0].style.line_box.as_mut().unwrap().min_ascent = 0.0;
        scene.nodes[0].style.line_box.as_mut().unwrap().min_descent = value;
        assert!(validate_scene(&scene).is_err());
    }
}

fn affine_sample_blend_style() -> Value {
    let mut body = fixture();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-affine-sample-blend/1"));
    let constant = |value: f64| json!({"kind":"constant","value":value});
    let domain = json!({"x":constant(0.0),"y":constant(0.0),"width":constant(160.0),"height":constant(90.0)});
    let identity: Vec<_> = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0].into_iter().map(constant).collect();
    body["scene"]["value"]["materials"] = json!([{
        "kind":"affine-sample-blend","id":"path-blend","contextNodeId":"caption",
        "sampling":{"input":domain,"output":domain}, "transforms":[identity,identity],
        "sampleRange":[2,256],"distanceRange":[0.0,1.0],"boundary":"transparent"
    }]);
    body
}

#[test]
fn affine_sample_blend_roundtrips_all_boundaries_without_implicit_fields() {
    for boundary in ["normalize", "transparent", "replicate"] {
        let mut body = affine_sample_blend_style();
        body["scene"]["value"]["materials"][0]["boundary"] = json!(boundary);
        let style = parse_style(&body).unwrap();
        let encoded = serde_json::to_value(&style).unwrap();
        assert_eq!(encoded["scene"]["value"]["materials"], body["scene"]["value"]["materials"]);
        assert_eq!(parse_style(&encoded).unwrap(), style);
    }
}

#[test]
fn affine_sample_blend_requires_its_capability_for_parsed_and_typed_scenes() {
    let mut body = affine_sample_blend_style();
    let mut scene = parse_style(&body).unwrap().scene().clone();
    scene.required_capabilities.retain(|c| c != "caption-affine-sample-blend/1");
    assert_eq!(validate_scene(&scene).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    body["scene"]["value"]["requiredCapabilities"] = json!(["caption-scene/1", "caption-expressions/1"]);
    assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
}

#[test]
fn affine_sample_blend_rejects_missing_null_and_unknown_contract_fields() {
    for field in [
        "sampling",
        "transforms",
        "sampleRange",
        "distanceRange",
        "boundary",
        "contextNodeId",
    ] {
        let mut body = affine_sample_blend_style();
        body["scene"]["value"]["materials"][0].as_object_mut().unwrap().remove(field);
        assert!(parse_style(&body).is_err(), "missing {field}");
        body["scene"]["value"]["materials"][0][field] = Value::Null;
        assert!(parse_style(&body).is_err(), "null {field}");
    }
    for path in [
        "/scene/value/materials/0",
        "/scene/value/materials/0/sampling",
        "/scene/value/materials/0/sampling/input",
    ] {
        let mut body = affine_sample_blend_style();
        body.pointer_mut(path).unwrap()["unexpected"] = json!(1);
        assert!(parse_style(&body).is_err(), "{path}");
    }
}

#[test]
fn affine_sample_blend_bounds_control_points_and_matrix_arity() {
    let mut body = affine_sample_blend_style();
    let identity = body["scene"]["value"]["materials"][0]["transforms"][0].clone();
    for count in [0, 1, 2, 32, 33] {
        body["scene"]["value"]["materials"][0]["transforms"] = json!(vec![identity.clone(); count]);
        assert_eq!(parse_style(&body).is_ok(), (2..=32).contains(&count), "{count}");
    }
    for count in [0, 5, 7] {
        body["scene"]["value"]["materials"][0]["transforms"] = json!([vec![json!({"kind":"constant","value":0}); count], identity]);
        assert!(parse_style(&body).is_err(), "matrix length {count}");
    }
}

#[test]
fn affine_sample_blend_bounds_all_six_scalar_coefficients() {
    for index in 0..6 {
        for (n, valid) in [(-10000.0, true), (10000.0, true), (-10000.1, false), (10000.1, false)] {
            let mut body = affine_sample_blend_style();
            body["scene"]["value"]["materials"][0]["transforms"][0][index] = json!({"kind":"constant","value":n});
            assert_eq!(parse_style(&body).is_ok(), valid, "coefficient {index}: {n}");
        }
    }
}

#[test]
fn affine_sample_blend_checks_keyframe_coefficients_and_preserves_missing_sample_policy() {
    for (value, valid) in [(10000.0, true), (10000.1, false)] {
        let mut body = affine_sample_blend_style();
        body["scene"]["value"]["materials"][0]["transforms"][0][0] = json!({
            "kind":"keyframes", "clock":{"unit":"page","origin":"start","duration":{"kind":"fixed","ticks":1,"timescale":1}},
            "keys":[{"at":0,"value":1},{"at":1,"value":value}], "fill":{"before":"none", "after":"none"}
        });
        assert_eq!(parse_style(&body).is_ok(), valid, "{value}");
    }
}

#[test]
fn affine_sample_blend_accepts_page_scalar_expressions_and_rejects_other_types() {
    for (expression, valid) in [
        (json!({"op":"read","path":"time.progress"}), true),
        (json!({"op":"literal","type":"length","value":1}), false),
        (json!({"op":"literal","type":"angle","value":1}), false),
        (json!({"op":"literal","type":"color","value":"#FFFFFF"}), false),
        (json!({"op":"literal","type":"bool","value":true}), false),
    ] {
        let mut body = affine_sample_blend_style();
        body["scene"]["value"]["materials"][0]["transforms"][0][0] = json!({"kind":"expression","expression":expression});
        assert_eq!(parse_style(&body).is_ok(), valid, "{expression}");
    }
}

#[test]
fn affine_sample_blend_requires_static_bounded_integer_sample_range() {
    for (range, valid) in [
        (json!([2, 2]), true),
        (json!([256, 256]), true),
        (json!([1, 2]), false),
        (json!([3, 2]), false),
        (json!([2, 257]), false),
        (json!([2, 2.5]), false),
        (json!([-2, 4]), false),
        (json!([2]), false),
        (json!([2, 3, 4]), false),
        (json!([2,{"kind":"constant","value":4}]), false),
    ] {
        let mut body = affine_sample_blend_style();
        body["scene"]["value"]["materials"][0]["sampleRange"] = range.clone();
        assert_eq!(parse_style(&body).is_ok(), valid, "{range}");
    }
}

#[test]
fn affine_sample_blend_requires_static_ordered_bounded_distance_range() {
    for (range, valid) in [
        (json!([0, 16]), true),
        (json!([1, 2]), true),
        (json!([-0.01, 1]), false),
        (json!([1, 1]), false),
        (json!([2, 1]), false),
        (json!([0, 16.01]), false),
        (json!([0]), false),
        (json!([0, 1, 2]), false),
        (json!([0, "1"]), false),
        (json!([0,{"kind":"constant","value":1}]), false),
    ] {
        let mut body = affine_sample_blend_style();
        body["scene"]["value"]["materials"][0]["distanceRange"] = range.clone();
        assert_eq!(parse_style(&body).is_ok(), valid, "{range}");
    }
}

#[test]
fn affine_sample_blend_rejects_typed_nonfinite_distance_values() {
    let mut scene = parse_style(&affine_sample_blend_style()).unwrap().scene().clone();
    for index in 0..2 {
        for n in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let CaptionMaterial::AffineSampleBlend { distance_range, .. } = &mut scene.materials[0] else {
                unreachable!()
            };
            *distance_range = [0.0, 1.0];
            distance_range[index] = n;
            assert!(validate_scene(&scene).is_err(), "index {index}: {n}");
        }
    }
}

#[test]
fn affine_sample_blend_requires_nonnegative_integer_input_roi() {
    for field in ["x", "y", "width", "height"] {
        for n in [-1.0, 0.5] {
            let mut body = affine_sample_blend_style();
            body["scene"]["value"]["materials"][0]["sampling"]["input"][field] = json!({"kind":"constant","value":n});
            assert!(parse_style(&body).is_err(), "{field}: {n}");
        }
    }
    for field in ["width", "height"] {
        let mut body = affine_sample_blend_style();
        body["scene"]["value"]["materials"][0]["sampling"]["input"][field] = json!({"kind":"constant","value":0});
        assert!(parse_style(&body).is_err(), "zero {field}");
    }
}

#[test]
fn affine_sample_blend_allows_fractional_and_canvas_clipped_output_with_positive_size() {
    let mut body = affine_sample_blend_style();
    for (field, n) in [("x", -12.25), ("y", -0.5), ("width", 0.001), ("height", 91.5)] {
        body["scene"]["value"]["materials"][0]["sampling"]["output"][field] = json!({"kind":"constant","value":n});
    }
    assert!(parse_style(&body).is_ok());
    for field in ["width", "height"] {
        for n in [0.0, -1.0, 0.0009, 1_000_001.0] {
            let mut invalid = body.clone();
            invalid["scene"]["value"]["materials"][0]["sampling"]["output"][field] = json!({"kind":"constant","value":n});
            assert!(parse_style(&invalid).is_err(), "{field}: {n}");
        }
    }
}

#[test]
fn affine_sample_blend_requires_explicit_unique_text_context_even_for_hidden_nodes() {
    let mut body = affine_sample_blend_style();
    body["scene"]["value"]["materials"][0]["contextNodeId"] = json!("missing");
    assert!(parse_style(&body).is_err());
    for extra in [
        json!({"id":"other-text","type":"text","properties":{"opacity":{"kind":"constant","value":0}}}),
        json!({"id":"shape","type":"shape","properties":{"opacity":{"kind":"constant","value":0}}}),
    ] {
        let mut body = affine_sample_blend_style();
        body["scene"]["value"]["nodes"].as_array_mut().unwrap().push(extra);
        assert!(parse_style(&body).is_err());
    }
    let mut body = affine_sample_blend_style();
    let text = body["scene"]["value"]["nodes"][0].clone();
    body["scene"]["value"]["nodes"] = json!([{"id":"group","type":"group","children":[text]}, {"id":"empty-group","type":"group"}]);
    assert!(parse_style(&body).is_ok());
}

#[test]
fn affine_sample_blend_rejects_duplicate_material_ids_and_unknown_boundary() {
    let mut body = affine_sample_blend_style();
    let material = body["scene"]["value"]["materials"][0].clone();
    body["scene"]["value"]["materials"].as_array_mut().unwrap().push(material);
    assert!(parse_style(&body).is_err());
    for boundary in [json!("clamp"), json!("Transparent"), json!(0)] {
        let mut body = affine_sample_blend_style();
        body["scene"]["value"]["materials"][0]["boundary"] = boundary;
        assert!(parse_style(&body).is_err());
    }
}

fn affine_over_style() -> Value {
    let mut body = affine_sample_blend_style();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-affine-over/1"));
    let m = body["scene"]["value"]["materials"][0].as_object_mut().unwrap();
    let controls = m.remove("transforms").unwrap();
    m.remove("sampleRange");
    m.remove("distanceRange");
    m.insert("kind".into(), json!("affine-over"));
    m.insert("foreground".into(), controls[0].clone());
    m.insert("background".into(), controls[1].clone());
    m.insert("backgroundOpacity".into(), json!({"kind":"constant","value":0.35}));
    m.insert("backgroundRgbScale".into(), json!({"kind":"constant","value":0.8}));
    body
}
#[test]
fn affine_over_requires_explicit_capability_fields_and_two_scalar_matrices() {
    let body = affine_over_style();
    let style = parse_style(&body).unwrap();
    let encoded = serde_json::to_value(&style).unwrap();
    assert_eq!(parse_style(&encoded).unwrap(), style);
    for key in [
        "foreground",
        "background",
        "backgroundOpacity",
        "backgroundRgbScale",
        "boundary",
        "sampling",
    ] {
        let mut invalid = body.clone();
        invalid["scene"]["value"]["materials"][0].as_object_mut().unwrap().remove(key);
        assert!(parse_style(&invalid).is_err(), "missing {key}");
        let mut invalid = body.clone();
        invalid["scene"]["value"]["materials"][0][key] = Value::Null;
        assert!(parse_style(&invalid).is_err(), "null {key}");
    }
    let mut invalid = body.clone();
    invalid["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|v| v != "caption-affine-over/1");
    assert!(parse_style(&invalid).is_err());
    for boundary in ["normalize", "guess"] {
        let mut invalid = body.clone();
        invalid["scene"]["value"]["materials"][0]["boundary"] = json!(boundary);
        assert!(parse_style(&invalid).is_err());
    }
    for field in ["foreground", "background"] {
        for count in [0, 5, 7] {
            let mut invalid = body.clone();
            invalid["scene"]["value"]["materials"][0][field] = json!(vec![json!({"kind":"constant","value":1}); count]);
            assert!(parse_style(&invalid).is_err());
        }
    }
}
#[test]
fn affine_over_bounds_literals_keyframes_and_scalar_expression_types() {
    let body = affine_over_style();
    for field in ["backgroundOpacity", "backgroundRgbScale"] {
        for value in [-0.01, 1.01] {
            let mut invalid = body.clone();
            invalid["scene"]["value"]["materials"][0][field] = json!({"kind":"constant","value":value});
            assert!(parse_style(&invalid).is_err());
            invalid["scene"]["value"]["materials"][0][field] = json!({"kind":"keyframes","clock":{"unit":"page","origin":"start","duration":{"kind":"fixed","ticks":1,"timescale":1}},"keys":[{"at":0,"value":0},{"at":1,"value":value}],"fill":{"before":"hold","after":"hold"}});
            assert!(parse_style(&invalid).is_err());
        }
    }
    for field in ["foreground", "background"] {
        for index in 0..6 {
            let mut invalid = body.clone();
            invalid["scene"]["value"]["materials"][0][field][index] = json!({"kind":"constant","value":10001});
            assert!(parse_style(&invalid).is_err());
            invalid["scene"]["value"]["materials"][0][field][index] =
                json!({"kind":"expression","expression":{"op":"read","path":"canvas.width"}});
            assert!(parse_style(&invalid).is_err());
        }
    }
}

fn gaussian_uv_style() -> Value {
    let mut body = affine_over_style();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-gaussian-uv/1"));
    let sampling = body["scene"]["value"]["materials"][0]["sampling"].clone();
    body["scene"]["value"]["materials"] = json!([{"kind":"gaussian-uv","id":"vector","contextNodeId":"caption","sampling":sampling,"samples":{"kind":"constant","value":2.5},"stepUv":[{"kind":"constant","value":0.1},{"kind":"constant","value":-0.1}],"sigmaUv":{"kind":"constant","value":0.1},"rgbGain":{"kind":"constant","value":1},"boundary":"normalize"}]);
    body
}
#[test]
fn gaussian_uv_contract_requires_capability_vector_arity_and_bounded_parameters() {
    let b = gaussian_uv_style();
    let style = parse_style(&b).unwrap();
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    for k in ["samples", "stepUv", "sigmaUv", "rgbGain", "sampling", "boundary"] {
        let mut x = b.clone();
        x["scene"]["value"]["materials"][0].as_object_mut().unwrap().remove(k);
        assert!(parse_style(&x).is_err());
    }
    let mut x = b.clone();
    x["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c != "caption-gaussian-uv/1");
    assert!(parse_style(&x).is_err());
    for (k, v) in [
        ("samples", 1025.),
        ("sigmaUv", 0.),
        ("sigmaUv", 16.01),
        ("rgbGain", -0.01),
        ("rgbGain", 10.01),
    ] {
        let mut x = b.clone();
        x["scene"]["value"]["materials"][0][k] = json!({"kind":"constant","value":v});
        assert!(parse_style(&x).is_err(), "{k} {v}");
    }
    for len in [0, 1, 3] {
        let mut x = b.clone();
        x["scene"]["value"]["materials"][0]["stepUv"] = json!(vec![json!({"kind":"constant","value":0}); len]);
        assert!(parse_style(&x).is_err());
    }
    for idx in 0..2 {
        let mut x = b.clone();
        x["scene"]["value"]["materials"][0]["stepUv"][idx] = json!({"kind":"constant","value":-1.01});
        assert!(parse_style(&x).is_err());
    }
}
