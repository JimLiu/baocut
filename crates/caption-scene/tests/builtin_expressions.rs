use caption_scene::*;
use serde_json::json;
use std::collections::BTreeMap;

const ROUNDING: &str = "caption-rounding-expression/1";
const MODULAR: &str = "caption-modular-expression/1";
const POWER: &str = "caption-power-expression/1";
const LIST_PICK: &str = "caption-list-pick/1";

fn base_scene(dag: bool, capabilities: &[&str]) -> Scene {
    let style = parse_style(&serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap()).unwrap();
    let mut scene = style.scene().clone();
    if dag {
        scene.required_capabilities.push("caption-function-dag/1".into());
    }
    scene.required_capabilities.extend(capabilities.iter().map(|c| c.to_string()));
    scene
}

fn scalar(value: f64) -> Expression {
    Expression::Literal {
        value_type: ValueType::Scalar,
        value: json!(value),
    }
}

fn call(function: &str, args: Vec<Expression>) -> Expression {
    Expression::Call {
        function: function.into(),
        args,
    }
}

fn eval(expression: &Expression, scene: &Scene) -> Result<f64> {
    evaluate(expression, scene, &Context::default(), &mut Budget::default())?.number()
}

fn palette_scene(dag: bool, pick: bool) -> Scene {
    let mut scene = base_scene(dag, if pick { &[LIST_PICK] } else { &[] });
    scene.parameters.push(
        serde_json::from_value(json!({
            "id": "palette", "type": "color", "list": true,
            "default": ["#FF0000", "#00FF00", "#0000FF"]
        }))
        .unwrap(),
    );
    scene
}

fn pick(index: Expression) -> Expression {
    call(
        "pick",
        vec![
            Expression::Read {
                path: "params.palette".into(),
            },
            index,
        ],
    )
}

fn context(scene: &Scene, overrides: &[&BTreeMap<String, serde_json::Value>]) -> Context {
    Context {
        fields: parameters(scene, overrides).unwrap(),
        ..Context::default()
    }
}

#[test]
fn each_builtin_requires_its_capability_in_inference_validation_and_direct_evaluation() {
    let cases = [
        (call("round", vec![scalar(1.5)]), ROUNDING, 2.0),
        (call("mod", vec![scalar(5.5), scalar(2.0)]), MODULAR, 1.5),
        (call("fract", vec![scalar(-0.25)]), MODULAR, 0.75),
        (call("pow", vec![scalar(0.5), scalar(3.0)]), POWER, 0.125),
    ];
    for dag in [false, true] {
        for (expression, capability, expected) in &cases {
            let mut scene = base_scene(dag, &[]);
            assert_eq!(
                infer(expression, &scene, &BTreeMap::new()).unwrap_err().code,
                "CAPTION_CAPABILITY_UNAVAILABLE"
            );
            assert_eq!(eval(expression, &scene).unwrap_err().code, "CAPTION_CAPABILITY_UNAVAILABLE");
            // Unused function bodies must still declare the builtin capability.
            scene.functions.push(PureFunction {
                id: "wrapped".into(),
                arguments: vec![],
                returns: ValueType::Scalar,
                body: expression.clone(),
            });
            assert_eq!(validate_scene(&scene).unwrap_err().code, "CAPTION_CAPABILITY_UNAVAILABLE");
            scene.required_capabilities.push(capability.to_string());
            validate_scene(&scene).unwrap();
            let decoded: Scene = serde_json::from_value(serde_json::to_value(&scene).unwrap()).unwrap();
            assert_eq!(decoded, scene);
            let indirect = call("wrapped", vec![]);
            assert_eq!(infer(&indirect, &scene, &BTreeMap::new()).unwrap(), ValueType::Scalar);
            assert_eq!(eval(&indirect, &scene).unwrap(), *expected);
            // Another builtin's capability never unlocks this one.
            let mut other = base_scene(dag, &[ROUNDING, MODULAR, POWER, LIST_PICK]);
            other.required_capabilities.retain(|c| c != capability);
            assert_eq!(
                infer(expression, &other, &BTreeMap::new()).unwrap_err().code,
                "CAPTION_CAPABILITY_UNAVAILABLE"
            );
        }
    }
}

#[test]
fn rounding_modulo_and_power_have_fixed_f64_golden_values() {
    let scene = base_scene(false, &[ROUNDING, MODULAR, POWER]);
    let round = |x: f64| eval(&call("round", vec![scalar(x)]), &scene);
    for (x, expected) in [
        (2.5, 3.0),
        (-2.5, -3.0),
        (0.5, 1.0),
        (-0.5, -1.0),
        (1.4999999999999998, 1.0),
        (-1.2, -1.0),
        (7.0, 7.0),
    ] {
        assert_eq!(round(x).unwrap(), expected, "round({x})");
    }
    let modulo = |a: f64, b: f64| eval(&call("mod", vec![scalar(a), scalar(b)]), &scene);
    for (a, b, expected) in [
        (5.5, 2.0, 1.5),
        (-1.0, 2.0, 1.0),
        (-4.0, 2.0, 0.0),
        (3.0, -2.0, -1.0),
        (-3.0, -2.0, -1.0),
        (-1e-20, 2.0, 0.0),
        (7.25, 0.5, 0.25),
    ] {
        assert_eq!(modulo(a, b).unwrap(), expected, "mod({a}, {b})");
    }
    let zero = modulo(1.0, 0.0).unwrap_err();
    assert_eq!(zero.code, "CAPTION_SCENE_INVALID");
    assert!(zero.detail.contains("zero divisor"));
    let fract = |x: f64| eval(&call("fract", vec![scalar(x)]), &scene);
    for (x, expected) in [(1.75, 0.75), (-0.25, 0.75), (-1e-20, 0.0), (3.0, 0.0)] {
        assert_eq!(fract(x).unwrap(), expected, "fract({x})");
    }
    let pow = |a: f64, b: f64| eval(&call("pow", vec![scalar(a), scalar(b)]), &scene);
    for (a, b, expected) in [
        (2.0, 10.0, 1024.0),
        (-2.0, 3.0, -8.0),
        (9.0, 0.5, 3.0),
        (0.0, 0.0, 1.0),
        (-0.5, 2.0, 0.25),
    ] {
        assert_eq!(pow(a, b).unwrap(), expected, "pow({a}, {b})");
    }
    // Cubic ease-out 1 - (1 - q)^3 at unsampled positions matches libm exactly.
    for q in [0.0, 0.137, 0.5, 0.91, 1.0] {
        assert_eq!(pow(1.0 - q, 3.0).unwrap(), libm::pow(1.0 - q, 3.0));
    }
    let negative = pow(-2.0, 0.5).unwrap_err();
    assert_eq!(negative.code, "CAPTION_SCENE_INVALID");
    assert!(negative.detail.contains("integer exponent"));
    let pole = pow(0.0, -1.0).unwrap_err();
    assert!(pole.detail.contains("non-finite result"));
    assert!(pow(10.0, 400.0).unwrap_err().detail.contains("non-finite result"));
}

#[test]
fn new_builtins_accept_only_scalars_and_their_names_are_reserved() {
    for (name, arity) in [("round", 1), ("fract", 1), ("mod", 2), ("pow", 2)] {
        assert_eq!(builtin_type(name, &vec![ValueType::Scalar; arity]), Some(ValueType::Scalar));
        for t in [ValueType::Integer, ValueType::Time, ValueType::Length, ValueType::Angle] {
            assert!(builtin_type(name, &vec![t; arity]).is_none(), "{name} {t:?}");
        }
        assert!(builtin_type(name, &vec![ValueType::Scalar; arity + 1]).is_none());
    }
    for name in ["round", "mod", "fract", "pow", "pick"] {
        let mut scene = base_scene(false, &[ROUNDING, MODULAR, POWER, LIST_PICK]);
        scene.functions.push(PureFunction {
            id: name.into(),
            arguments: vec![],
            returns: ValueType::Scalar,
            body: scalar(1.0),
        });
        assert!(validate_scene(&scene).is_err(), "{name} must be reserved");
    }
}

#[test]
fn pick_selects_from_a_declared_list_by_euclidean_index() {
    for dag in [false, true] {
        let scene = palette_scene(dag, true);
        validate_scene(&scene).unwrap();
        let ctx = context(&scene, &[]);
        let at = |index: Expression| evaluate(&pick(index), &scene, &ctx, &mut Budget::default());
        assert_eq!(infer(&pick(scalar(0.0)), &scene, &BTreeMap::new()).unwrap(), ValueType::Color);
        for (index, expected) in [
            (0.0, [1.0, 0.0, 0.0, 1.0]),
            (4.0, [0.0, 1.0, 0.0, 1.0]),
            (-1.0, [0.0, 0.0, 1.0, 1.0]),
        ] {
            assert_eq!(at(scalar(index)).unwrap(), Evaluated::Color(expected), "index {index}");
        }
        let integer = Expression::Literal {
            value_type: ValueType::Integer,
            value: json!(5),
        };
        assert_eq!(at(integer).unwrap(), Evaluated::Color([0.0, 0.0, 1.0, 1.0]));
        assert_eq!(at(scalar(0.5)).unwrap_err().code, "CAPTION_SCENE_INVALID");
        // Composition with the seeded permutation used by keyword palettes.
        let mut shuffled = scene.clone();
        shuffled.required_capabilities.push("caption-permutation/1".into());
        let index = call("shuffle-index", vec![scalar(2.0), scalar(3.0), scalar(7.0)]);
        let expected = evaluate(&index, &shuffled, &ctx, &mut Budget::default()).unwrap().number().unwrap();
        let picked = evaluate(&pick(index), &shuffled, &ctx, &mut Budget::default()).unwrap();
        let direct = evaluate(&pick(scalar(expected)), &shuffled, &ctx, &mut Budget::default()).unwrap();
        assert_eq!(picked, direct);
        // Type checks: the index must be scalar/integer, and the list is not a plain value.
        let bad_index = pick(Expression::Literal {
            value_type: ValueType::Time,
            value: json!(1),
        });
        assert_eq!(
            infer(&bad_index, &scene, &BTreeMap::new()).unwrap_err().code,
            "CAPTION_EXPRESSION_TYPE"
        );
        let direct_read = Expression::Read {
            path: "params.palette".into(),
        };
        assert_eq!(
            infer(&direct_read, &scene, &BTreeMap::new()).unwrap_err().code,
            "CAPTION_EXPRESSION_TYPE"
        );
        assert_eq!(
            evaluate(&direct_read, &scene, &ctx, &mut Budget::default()).unwrap_err().code,
            "CAPTION_EXPRESSION_TYPE"
        );
        let scalar_list = call(
            "pick",
            vec![
                Expression::Read {
                    path: "params.accent".into(),
                },
                scalar(0.0),
            ],
        );
        assert_eq!(
            infer(&scalar_list, &scene, &BTreeMap::new()).unwrap_err().code,
            "CAPTION_EXPRESSION_TYPE"
        );
        let literal_list = call("pick", vec![scalar(0.0), scalar(0.0)]);
        assert_eq!(
            infer(&literal_list, &scene, &BTreeMap::new()).unwrap_err().code,
            "CAPTION_EXPRESSION_TYPE"
        );
        assert!(
            infer(
                &call(
                    "pick",
                    vec![Expression::Read {
                        path: "params.palette".into()
                    }]
                ),
                &scene,
                &BTreeMap::new()
            )
            .is_err()
        );
    }
}

#[test]
fn list_parameters_are_capability_gated_bounded_and_overridable() {
    let without = palette_scene(false, false);
    assert_eq!(validate_scene(&without).unwrap_err().code, "CAPTION_CAPABILITY_UNAVAILABLE");
    assert_eq!(
        infer(&pick(scalar(0.0)), &palette_scene(false, false), &BTreeMap::new())
            .unwrap_err()
            .code,
        "CAPTION_CAPABILITY_UNAVAILABLE"
    );
    let scene = palette_scene(false, true);
    let encoded = serde_json::to_value(&scene).unwrap();
    assert_eq!(encoded["parameters"][1]["list"], json!(true));
    assert_eq!(serde_json::from_value::<Scene>(encoded).unwrap(), scene);
    // Older bodies keep byte-identical serialization: scalar parameters omit the flag.
    let original = include_str!("fixtures/word-pop.json");
    let style = parse_style(&serde_json::from_str(original).unwrap()).unwrap();
    assert!(!serde_json::to_string(&style).unwrap().contains("\"list\""));

    let mut empty = scene.clone();
    empty.parameters[1].default = json!([]);
    assert_eq!(validate_scene(&empty).unwrap_err().code, "CAPTION_SCENE_INVALID");
    let mut mixed = scene.clone();
    mixed.parameters[1].default = json!(["#FF0000", 1]);
    assert!(validate_scene(&mixed).is_err());
    let mut too_long = scene.clone();
    too_long.parameters[1].default = json!(vec!["#FFFFFF"; MAX_LIST_PARAMETER_ITEMS + 1]);
    assert!(validate_scene(&too_long).is_err());
    let mut ranged = base_scene(false, &[LIST_PICK]);
    ranged
        .parameters
        .push(serde_json::from_value(json!({"id":"delays","type":"scalar","list":true,"default":[0, 0.5, 2],"min":0,"max":2})).unwrap());
    validate_scene(&ranged).unwrap();
    ranged.parameters[1].default = json!([0, 3]);
    assert!(validate_scene(&ranged).unwrap_err().detail.contains("out of range"));
    let mut many = base_scene(false, &[LIST_PICK]);
    for i in 0..5 {
        many.parameters.push(
            serde_json::from_value(json!({"id":format!("l{i}"),"type":"scalar","list":true,"default":vec![0; MAX_LIST_PARAMETER_ITEMS]}))
                .unwrap(),
        );
    }
    assert_eq!(validate_scene(&many).unwrap_err().code, "CAPTION_BUDGET_EXCEEDED");

    // Overrides replace the whole list and may change its length.
    let shorter = BTreeMap::from([("palette".to_string(), json!(["#FFFFFF", "#000000"]))]);
    let ctx = context(&scene, &[&shorter]);
    assert_eq!(
        evaluate(&pick(scalar(3.0)), &scene, &ctx, &mut Budget::default()).unwrap(),
        Evaluated::Color([0.0, 0.0, 0.0, 1.0])
    );
    for invalid in [json!("#FFFFFF"), json!([]), json!([true])] {
        let layer = BTreeMap::from([("palette".to_string(), invalid)]);
        assert!(parameters(&scene, &[&layer]).is_err());
    }
    let scalar_as_list = BTreeMap::from([("accent".to_string(), json!(["#FFFFFF"]))]);
    assert!(parameters(&scene, &[&scalar_as_list]).is_err());

    // A list parameter never scales a layout length.
    let mut length = ranged.clone();
    length.parameters[1].default = json!([1]);
    length.layout.width.parameter = Some("delays".into());
    assert!(validate_scene(&length).is_err());
}

#[test]
fn builtin_fixture_validates_and_round_trips_without_extra_fields() {
    let source = include_str!("fixtures/builtin-expressions.json");
    let body: serde_json::Value = serde_json::from_str(source).unwrap();
    let style = parse_style(&body).unwrap();
    let encoded = serde_json::to_value(&style).unwrap();
    let parameters = &encoded["scene"]["value"]["parameters"];
    assert_eq!(parameters[0]["list"], json!(true));
    assert_eq!(parameters[0]["default"], body["scene"]["value"]["parameters"][0]["default"]);
    assert!(parameters[1].get("list").is_none());
    assert_eq!(parse_style(&encoded).unwrap(), style);
    let presentation: Presentation = serde_json::from_value(json!({
        "parameters": {"palette": ["#FFFFFF"]},
        "cueOverrides": [{"cueId": "c", "parameters": {"palette": ["#000000", "#111111"], "blinks": 4}}]
    }))
    .unwrap();
    validate_presentation(&presentation, Some(style.scene())).unwrap();
    let bad: Presentation = serde_json::from_value(json!({"parameters": {"palette": "#FFFFFF"}})).unwrap();
    assert!(validate_presentation(&bad, Some(style.scene())).is_err());
}
