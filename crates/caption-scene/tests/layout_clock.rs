use caption_scene::*;
use serde_json::{Value, json};

fn literal(ty: &str, value: f64) -> Value {
    json!({"op":"literal","type":ty,"value":value})
}
fn read(path: &str) -> Value {
    json!({"op":"read","path":path})
}
fn call(name: &str, args: Vec<Value>) -> Value {
    json!({"op":"call","function":name,"args":args})
}
fn fixture(time: Value) -> Value {
    let mut body: Value = serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap();
    body["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-layout-clock/1"));
    body["scene"]["value"]["layout"]["clock"] = json!({"time":time});
    body
}
fn relative_loop() -> Value {
    let period = call(
        "sub",
        vec![read("time.inputLastWordEndSeconds"), read("time.inputFirstWordStartSeconds")],
    );
    call(
        "sub",
        vec![
            read("time.seconds"),
            call(
                "mul",
                vec![period.clone(), call("floor", vec![call("div", vec![read("time.seconds"), period])])],
            ),
        ],
    )
}

#[test]
fn layout_clock_roundtrips_a_typed_input_timing_expression() {
    let body = fixture(relative_loop());
    let style = parse_style(&body).unwrap();
    assert!(style.scene().layout.clock.is_some());
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    assert_eq!(
        serde_json::to_value(&style).unwrap()["scene"]["value"]["layout"]["clock"],
        body["scene"]["value"]["layout"]["clock"]
    );
}

#[test]
fn clock_is_optional_and_does_not_change_the_legacy_serialized_shape() {
    let body: Value = serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap();
    let style = parse_style(&body).unwrap();
    assert!(style.scene().layout.clock.is_none());
    assert!(
        serde_json::to_value(&style).unwrap()["scene"]["value"]["layout"]
            .get("clock")
            .is_none()
    );
    let mut declared = body;
    declared["scene"]["value"]["requiredCapabilities"]
        .as_array_mut()
        .unwrap()
        .push(json!("caption-layout-clock/1"));
    assert!(parse_style(&declared).unwrap().scene().layout.clock.is_none());
}

#[test]
fn clock_requires_its_capability_a_time_result_and_the_exact_object_shape() {
    let mut missing = fixture(literal("time", 0.0));
    missing["scene"]["value"]["requiredCapabilities"] = json!(["caption-scene/1", "caption-expressions/1"]);
    assert_eq!(parse_style(&missing).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
    assert_eq!(
        parse_style(&fixture(literal("scalar", 1.0))).unwrap_err().code,
        "CAPTION_EXPRESSION_TYPE"
    );
    for clock in [
        json!({"time":literal("time", 0.0),"repeat":true}),
        json!({"time":{"kind":"expression","expression":literal("time", 0.0)}}),
        json!({"time":{"kind":"keyframes","keys":[]}}),
        json!({}),
    ] {
        let mut body = fixture(literal("time", 0.0));
        body["scene"]["value"]["layout"]["clock"] = clock;
        assert!(parse_style(&body).is_err());
    }
}

#[test]
fn prelayout_input_fields_and_parameters_are_allowed_through_pure_functions() {
    for path in [
        "time.seconds",
        "time.elapsedSeconds",
        "time.durationSeconds",
        "time.cueDurationSeconds",
        "time.inputFirstWordStartSeconds",
        "time.inputFirstWordEndSeconds",
        "time.inputLastWordStartSeconds",
        "time.inputLastWordEndSeconds",
    ] {
        parse_style(&fixture(read(path))).unwrap();
    }
    for path in ["unit.inputFirstWordTimed", "unit.inputLastWordTimed"] {
        parse_style(&fixture(
            json!({"op":"if","condition":read(path),"then":read("time.inputLastWordEndSeconds"),"else":literal("time", 0.0)}),
        ))
        .unwrap();
    }
    let mut body = fixture(call("identity", vec![read("params.period")]));
    body["scene"]["value"]["parameters"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"period","type":"time","default":2}));
    body["scene"]["value"]["functions"] =
        json!([{"id":"identity","arguments":[{"name":"offset","type":"time"}],"returns":"time","body":read("args.offset")}]);
    parse_style(&body).unwrap();
}

#[test]
fn clock_rejects_layout_or_sampled_state_feedback_without_hiding_a_type_error() {
    let time_from_length = |path: &str| {
        call(
            "mul",
            vec![literal("time", 1.0), call("div", vec![read(path), literal("length", 1.0)])],
        )
    };
    for expression in [
        time_from_length("layout.width"),
        time_from_length("layout.height"),
        read("time.pageElapsedSeconds"),
        read("time.pageDurationSeconds"),
        json!({"op":"if","condition":read("unit.active"),"then":literal("time", 1.0),"else":literal("time", 0.0)}),
    ] {
        let mut body = fixture(expression);
        body["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-text-context/1"));
        assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
    }
}

#[test]
fn hidden_function_bodies_and_unused_arguments_cannot_bypass_clock_dependencies() {
    for dag in [false, true] {
        let mut hidden = fixture(call("outer", vec![]));
        hidden["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-text-context/1"));
        if dag {
            hidden["scene"]["value"]["requiredCapabilities"]
                .as_array_mut()
                .unwrap()
                .push(json!("caption-function-dag/1"));
        }
        hidden["scene"]["value"]["functions"] = json!([
            {"id":"outer","arguments":[],"returns":"time","body":call("inner", vec![])},
            {"id":"inner","arguments":[],"returns":"time","body":read("time.pageDurationSeconds")}
        ]);
        assert_eq!(parse_style(&hidden).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
        hidden["scene"]["value"]["functions"] =
            json!([{"id":"ignore","arguments":[{"name":"unused","type":"time"}],"returns":"time","body":literal("time", 0.0)}]);
        hidden["scene"]["value"]["layout"]["clock"]["time"] = call("ignore", vec![read("time.pageDurationSeconds")]);
        assert_eq!(parse_style(&hidden).unwrap_err().code, "CAPTION_DEPENDENCY_CYCLE");
    }
}

#[test]
fn raw_input_context_fields_are_capability_gated_even_without_a_layout_clock() {
    let mut body: Value = serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap();
    for path in ["unit.inputFirstWordTimed", "unit.inputLastWordTimed"] {
        body["scene"]["value"]["animations"][0]["value"]["expression"]["condition"] = read(path);
        assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_UNAVAILABLE");
    }
    for path in [
        "time.inputFirstWordStartSeconds",
        "time.inputFirstWordEndSeconds",
        "time.inputLastWordStartSeconds",
        "time.inputLastWordEndSeconds",
    ] {
        body["scene"]["value"]["animations"][0]["value"]["expression"]["condition"] = call("gt", vec![read(path), literal("time", 0.0)]);
        assert_eq!(parse_style(&body).unwrap_err().code, "CAPTION_CAPABILITY_UNAVAILABLE");
    }
}
