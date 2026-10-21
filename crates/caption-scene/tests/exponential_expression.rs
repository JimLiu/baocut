use caption_scene::*;
use serde_json::json;
use std::collections::BTreeMap;

fn scene(dag: bool, exponential: bool) -> Scene {
    let style = parse_style(&serde_json::from_str(include_str!("fixtures/word-pop.json")).unwrap()).unwrap();
    let mut scene = style.scene().clone();
    if dag {
        scene.required_capabilities.push("caption-function-dag/1".into());
    }
    if exponential {
        scene.required_capabilities.push("caption-exponential-expression/1".into());
    }
    scene
}

fn exp(value_type: ValueType, value: serde_json::Value) -> Expression {
    Expression::Call {
        function: "exp".into(),
        args: vec![Expression::Literal { value_type, value }],
    }
}

#[test]
fn exponential_requires_its_capability_in_both_inference_paths_and_direct_evaluation() {
    let expression = exp(ValueType::Scalar, json!(-2.0));
    for dag in [false, true] {
        let mut scene = scene(dag, false);
        assert_eq!(
            infer(&expression, &scene, &BTreeMap::new()).unwrap_err().code,
            "CAPTION_CAPABILITY_UNAVAILABLE"
        );
        assert_eq!(
            evaluate(&expression, &scene, &Context::default(), &mut Budget::default())
                .unwrap_err()
                .code,
            "CAPTION_CAPABILITY_UNAVAILABLE"
        );
        // Even unused function bodies must declare their builtin's capability.
        scene.functions.push(PureFunction {
            id: "decay".into(),
            arguments: vec![],
            returns: ValueType::Scalar,
            body: expression.clone(),
        });
        assert_eq!(validate_scene(&scene).unwrap_err().code, "CAPTION_CAPABILITY_UNAVAILABLE");
        scene.required_capabilities.push("caption-exponential-expression/1".into());
        validate_scene(&scene).unwrap();
        let encoded = serde_json::to_value(&scene).unwrap();
        let decoded: Scene = serde_json::from_value(encoded).unwrap();
        assert_eq!(decoded, scene);
        validate_scene(&decoded).unwrap();
        let indirect = Expression::Call {
            function: "decay".into(),
            args: vec![],
        };
        assert_eq!(infer(&indirect, &scene, &BTreeMap::new()).unwrap(), ValueType::Scalar);
        assert_eq!(
            evaluate(&indirect, &scene, &Context::default(), &mut Budget::default())
                .unwrap()
                .number()
                .unwrap(),
            libm::exp(-2.0)
        );
    }
}

#[test]
fn exponential_composes_with_trigonometry_at_arbitrary_unsampled_times() {
    let expression: Expression = serde_json::from_value(json!({
        "op":"call", "function":"mul", "args":[
            {"op":"call", "function":"exp", "args":[
                {"op":"call", "function":"mul", "args":[
                    {"op":"literal", "type":"scalar", "value":-3.7},
                    {"op":"read", "path":"time.progress"}
                ]}
            ]},
            {"op":"call", "function":"cos", "args":[
                {"op":"call", "function":"mul", "args":[
                    {"op":"literal", "type":"angle", "value":19.3},
                    {"op":"read", "path":"time.progress"}
                ]}
            ]}
        ]
    }))
    .unwrap();
    for dag in [false, true] {
        let scene = scene(dag, true);
        assert_eq!(infer(&expression, &scene, &BTreeMap::new()).unwrap(), ValueType::Scalar);
        for time in [0.0, 0.017391, 0.203457, 0.73123, 1.0, 0.203457, 0.0] {
            let mut context = Context::default();
            context
                .fields
                .insert("time.progress".into(), Evaluated::Number(ValueType::Scalar, time));
            let actual = evaluate(&expression, &scene, &context, &mut Budget::default())
                .unwrap()
                .number()
                .unwrap();
            assert_eq!(actual, libm::exp(-3.7 * time) * libm::cos(19.3 * time));
        }
    }
}

#[test]
fn exponential_accepts_only_one_scalar_and_its_name_cannot_be_shadowed() {
    assert_eq!(builtin_type("exp", &[ValueType::Scalar]), Some(ValueType::Scalar));
    for types in [
        vec![],
        vec![ValueType::Scalar; 2],
        vec![ValueType::Time],
        vec![ValueType::Integer],
        vec![ValueType::Length],
    ] {
        assert!(builtin_type("exp", &types).is_none());
    }
    for dag in [false, true] {
        let mut scene = scene(dag, true);
        for (ty, value) in [
            (ValueType::Time, json!(1)),
            (ValueType::Integer, json!(1)),
            (ValueType::Bool, json!(true)),
        ] {
            let expression = exp(ty, value);
            assert!(infer(&expression, &scene, &BTreeMap::new()).is_err());
            assert!(evaluate(&expression, &scene, &Context::default(), &mut Budget::default()).is_err());
        }
        scene.functions.push(PureFunction {
            id: "exp".into(),
            arguments: vec![],
            returns: ValueType::Scalar,
            body: Expression::Literal {
                value_type: ValueType::Scalar,
                value: json!(1),
            },
        });
        assert!(validate_scene(&scene).is_err());
    }
}

#[test]
fn exponential_has_continuous_seek_independent_values_and_rejects_overflow() {
    let scene = scene(false, true);
    let expression = Expression::Call {
        function: "exp".into(),
        args: vec![Expression::Read {
            path: "time.progress".into(),
        }],
    };
    assert_eq!(infer(&expression, &scene, &BTreeMap::new()).unwrap(), ValueType::Scalar);
    let sample = |value| {
        let mut context = Context::default();
        context
            .fields
            .insert("time.progress".into(), Evaluated::Number(ValueType::Scalar, value));
        evaluate(&expression, &scene, &context, &mut Budget::default())
    };
    for (value, expected) in [
        (0.0, 1.0),
        (-1.0, 0.36787944117144233),
        (-2.3, 0.10025884372280375),
        (-1000.0, 0.0),
        (-1.0, 0.36787944117144233),
    ] {
        assert!((sample(value).unwrap().number().unwrap() - expected).abs() < 1e-15);
    }
    assert_eq!(sample(1.0).unwrap().number().unwrap(), libm::exp(1.0));
    let overflow = sample(1000.0).unwrap_err();
    assert_eq!(overflow.code, "CAPTION_SCENE_INVALID");
    assert!(overflow.detail.contains("non-finite result"));
    assert!(sample(f64::NAN).is_err());
    assert!(sample(f64::INFINITY).is_err());
    assert!(sample(f64::NEG_INFINITY).is_err());
    assert_eq!(
        evaluate(&exp(ValueType::Scalar, json!(-1)), &scene, &Context::default(), &mut Budget::new(0))
            .unwrap_err()
            .code,
        "CAPTION_BUDGET_EXCEEDED"
    );
}
