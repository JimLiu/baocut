use caption_scene::*;
use serde_json::json;
use std::collections::BTreeMap;

fn scene(dag: bool, precondition: bool) -> Scene {
    let style = parse_style(&serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap()).unwrap();
    let mut scene = style.scene().clone();
    if dag {
        scene.required_capabilities.push("caption-function-dag/1".into());
    }
    if precondition {
        scene.required_capabilities.push("caption-expression-precondition/1".into());
    }
    scene
}
fn literal(value_type: ValueType, value: serde_json::Value) -> Expression {
    Expression::Literal { value_type, value }
}
fn boolean(value: bool) -> Expression {
    literal(ValueType::Bool, json!(value))
}
fn call(function: &str, args: Vec<Expression>) -> Expression {
    Expression::Call {
        function: function.into(),
        args,
    }
}
fn require(condition: bool, value: Expression) -> Expression {
    call("require", vec![boolean(condition), value])
}
fn run(expression: &Expression, scene: &Scene) -> Result<Evaluated> {
    evaluate(expression, scene, &Context::default(), &mut Budget::default())
}
fn custom_require() -> PureFunction {
    PureFunction {
        id: "require".into(),
        arguments: vec![
            Argument {
                name: "condition".into(),
                value_type: ValueType::Bool,
            },
            Argument {
                name: "value".into(),
                value_type: ValueType::Scalar,
            },
        ],
        returns: ValueType::Scalar,
        body: literal(ValueType::Scalar, json!(7)),
    }
}

#[test]
fn enabled_require_preserves_numeric_length_color_and_boolean_types() {
    for dag in [false, true] {
        let scene = scene(dag, true);
        validate_scene(&scene).unwrap();
        for (ty, value) in [
            (ValueType::Scalar, json!(2.5)),
            (ValueType::Integer, json!(3)),
            (ValueType::Length, json!(12)),
            (ValueType::Time, json!(0.8)),
            (ValueType::Angle, json!(-0.2)),
            (ValueType::Color, json!("#89ABCDEF")),
            (ValueType::Bool, json!(false)),
        ] {
            let expression = require(true, literal(ty, value.clone()));
            assert_eq!(infer(&expression, &scene, &BTreeMap::new()).unwrap(), ty);
            assert_eq!(run(&expression, &scene).unwrap(), typed_value(ty, &value).unwrap());
        }
    }
}

#[test]
fn false_is_lazy_and_true_propagates_real_value_failures() {
    for dag in [false, true] {
        let scene = scene(dag, true);
        for value in [
            Expression::Read {
                path: "canvas.width".into(),
            },
            call(
                "div",
                vec![literal(ValueType::Length, json!(1)), literal(ValueType::Scalar, json!(0))],
            ),
        ] {
            let skipped = require(false, value.clone());
            assert_eq!(infer(&skipped, &scene, &BTreeMap::new()).unwrap(), ValueType::Length);
            assert_eq!(run(&skipped, &scene).unwrap_err().code, "CAPTION_PRECONDITION_FAILED");
            let demanded = require(true, value);
            let error = run(&demanded, &scene).unwrap_err();
            assert_ne!(error.code, "CAPTION_PRECONDITION_FAILED");
        }
        let indirect = call("guarded", vec![]);
        let mut indirect_scene = scene;
        indirect_scene.functions.push(PureFunction {
            id: "guarded".into(),
            arguments: vec![],
            returns: ValueType::Length,
            body: require(
                false,
                Expression::Read {
                    path: "canvas.width".into(),
                },
            ),
        });
        validate_scene(&indirect_scene).unwrap();
        assert_eq!(run(&indirect, &indirect_scene).unwrap_err().code, "CAPTION_PRECONDITION_FAILED");
    }
}

#[test]
fn capability_and_signature_are_explicit_in_both_inference_paths_and_evaluation() {
    for dag in [false, true] {
        let old = scene(dag, false);
        let expression = require(true, literal(ValueType::Scalar, json!(1)));
        assert_eq!(
            infer(&expression, &old, &BTreeMap::new()).unwrap_err().code,
            "CAPTION_CAPABILITY_REQUIRED"
        );
        assert_eq!(run(&expression, &old).unwrap_err().code, "CAPTION_CAPABILITY_REQUIRED");
        let enabled = scene(dag, true);
        for args in [
            vec![],
            vec![boolean(true)],
            vec![literal(ValueType::Scalar, json!(1)), boolean(true)],
            vec![boolean(true), boolean(true), boolean(true)],
        ] {
            let expression = call("require", args);
            assert!(infer(&expression, &enabled, &BTreeMap::new()).is_err());
            assert!(run(&expression, &enabled).is_err());
        }
    }
}

#[test]
fn legacy_custom_require_keeps_its_body_and_eager_arguments_until_new_capability_is_declared() {
    for dag in [false, true] {
        let mut legacy = scene(dag, false);
        legacy.functions.push(custom_require());
        validate_scene(&legacy).unwrap();
        let expression = require(false, literal(ValueType::Scalar, json!(2)));
        assert_eq!(infer(&expression, &legacy, &BTreeMap::new()).unwrap(), ValueType::Scalar);
        assert_eq!(run(&expression, &legacy).unwrap(), Evaluated::Number(ValueType::Scalar, 7.0));
        let divide = call(
            "div",
            vec![literal(ValueType::Scalar, json!(1)), literal(ValueType::Scalar, json!(0))],
        );
        assert_ne!(
            run(&require(false, divide), &legacy).unwrap_err().code,
            "CAPTION_PRECONDITION_FAILED"
        );
        legacy.required_capabilities.push("caption-expression-precondition/1".into());
        assert!(validate_scene(&legacy).is_err(), "only the opted-in builtin reserves this name");
    }
}

#[test]
fn lazy_runtime_check_does_not_hide_static_type_or_layout_dependency_failures() {
    for dag in [false, true] {
        let mut scene = scene(dag, true);
        let bad_type = call(
            "require",
            vec![
                boolean(false),
                call("add", vec![boolean(true), literal(ValueType::Length, json!(1))]),
            ],
        );
        assert!(
            infer(&bad_type, &scene, &BTreeMap::new()).is_err(),
            "both operands remain statically checked"
        );
        scene.functions.push(PureFunction {
            id: "geometry".into(),
            arguments: vec![],
            returns: ValueType::Length,
            body: Expression::Read {
                path: "layout.width".into(),
            },
        });
        scene.layout.layout_evaluation = LayoutEvaluation::PerSample;
        scene.layout.bindings.push(LayoutBinding {
            node_id: None,
            property: "width".into(),
            value: DynamicValue::Expression {
                expression: require(false, call("geometry", vec![])),
            },
        });
        assert_eq!(
            validate_scene(&scene).unwrap_err().code,
            "CAPTION_DEPENDENCY_CYCLE",
            "false cannot hide a cycle through a user function"
        );
    }
}
