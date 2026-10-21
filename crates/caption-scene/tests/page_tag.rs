use caption_scene::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/page-tag.json")).unwrap()
}

fn error(body: &Value) -> (String, String) {
    let error = parse_style(body).unwrap_err();
    (error.code, error.path)
}

#[test]
fn page_tags_parse_round_trip_and_type_their_read() {
    let style = parse_style(&fixture()).unwrap();
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    assert_eq!(style.scene().layout.pagination.page_tags, Some(vec![7, 0, 3]));
    let read = Expression::Read {
        path: "unit.pageTag".into(),
    };
    assert_eq!(infer(&read, style.scene(), &BTreeMap::new()).unwrap(), ValueType::Scalar);
    let mut scene = style.scene().clone();
    scene.required_capabilities.retain(|c| c != "caption-page-tag/1");
    assert_eq!(
        infer(&read, &scene, &BTreeMap::new()).unwrap_err().code,
        "CAPTION_CAPABILITY_UNAVAILABLE"
    );
    let mut scene = style.scene().clone();
    scene.layout.pagination.page_tags = None;
    assert_eq!(infer(&read, &scene, &BTreeMap::new()).unwrap_err().code, "CAPTION_SCENE_INVALID");
}

#[test]
fn page_tags_require_opt_in_and_one_bounded_tag_per_pattern_page() {
    let body = fixture();
    let mut legacy = body.clone();
    legacy["scene"]["value"]["requiredCapabilities"] = json!([
        "caption-scene/1",
        "caption-expressions/1",
        "caption-word-line-layout/1",
        "caption-unit-font-size/1"
    ]);
    legacy["scene"]["value"]["layout"]["fontSizeBindings"] = json!([]);
    legacy["scene"]["value"]["animations"] = json!([]);
    assert_eq!(
        error(&legacy),
        ("CAPTION_CAPABILITY_UNAVAILABLE".into(), "pagination.pageTags".into())
    );
    let path = "pagination.pageTags";
    for tags in [json!([7, 0]), json!([7, 0, 3, 1]), json!([]), json!([7, 0, 65536])] {
        let mut input = body.clone();
        input["scene"]["value"]["layout"]["pagination"]["pageTags"] = tags.clone();
        assert_eq!(error(&input), ("CAPTION_SCENE_INVALID".into(), path.into()), "{tags}");
    }
    let mut largest = body.clone();
    largest["scene"]["value"]["layout"]["pagination"]["pageTags"] = json!([65535, 0, 3]);
    assert!(parse_style(&largest).is_ok());
    for tags in [json!([7, -1, 3]), json!([7, 0.5, 3]), json!("7")] {
        let mut input = body.clone();
        input["scene"]["value"]["layout"]["pagination"]["pageTags"] = tags.clone();
        assert!(parse_style(&input).is_err(), "{tags}");
    }
    for (field, value) in [
        ("remainingWordPagePlans", json!([[1], [2]])),
        ("textLinePattern", json!({"unit": "grapheme", "lines": [[4]]})),
        ("maxUnitsPerPage", json!(2)),
    ] {
        let mut input = body.clone();
        let pagination = &mut input["scene"]["value"]["layout"]["pagination"];
        pagination.as_object_mut().unwrap().remove("wordLinePattern");
        pagination[field] = value;
        input["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .extend([json!("caption-remaining-word-page-plan/1"), json!("caption-text-line-layout/1")]);
        assert_eq!(error(&input), ("CAPTION_SCENE_INVALID".into(), path.into()), "{field}");
    }
    let mut unknown = body.clone();
    unknown["scene"]["value"]["layout"]["pagination"]["pageTag"] = json!([7, 0, 3]);
    assert!(parse_style(&unknown).is_err());
}
