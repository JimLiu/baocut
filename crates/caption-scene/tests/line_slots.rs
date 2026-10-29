use caption_scene::*;
use serde_json::{Value, json};

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/line-slots.json")).unwrap()
}

fn edit(f: impl FnOnce(&mut Value)) -> Result<SceneStyle> {
    let mut body = fixture();
    f(&mut body["scene"]["value"]);
    parse_style(&body)
}

fn rejected(f: impl FnOnce(&mut Value)) -> (String, String) {
    let error = edit(f).unwrap_err();
    (error.code, error.path)
}

#[test]
fn line_slots_validate_round_trip_and_stay_absent_from_old_documents() {
    let style = parse_style(&fixture()).unwrap();
    let pagination = &style.scene().layout.pagination;
    assert_eq!(pagination.line_slots, Some(LineSlots { count: 2, pitch: 1.4 }));
    assert!(pagination.has_fixed_lines());
    assert_eq!(parse_style(&serde_json::to_value(&style).unwrap()).unwrap(), style);
    assert!(CAPABILITIES.contains(&"caption-line-slots/1"));
    let old: Value = serde_json::from_str(include_str!("fixtures/word-line-layout.json")).unwrap();
    let old = parse_style(&old).unwrap();
    let json = serde_json::to_value(&old.scene().layout.pagination).unwrap();
    assert!(json.get("lineSlots").is_none());
    assert_eq!(old.scene().layout.pagination.line_slots, None);
    // Null is the absent value.
    let null = edit(|scene| scene["layout"]["pagination"]["lineSlots"] = Value::Null).unwrap();
    assert_eq!(null.scene().layout.pagination.line_slots, None);
}

#[test]
fn line_slots_need_the_capability() {
    let error = edit(|scene| {
        scene["requiredCapabilities"] = json!(["caption-word-line-layout/1"]);
    })
    .unwrap_err();
    assert_eq!(
        (error.code.as_str(), error.path.as_str()),
        ("CAPTION_CAPABILITY_UNAVAILABLE", "pagination.lineSlots")
    );
}

#[test]
fn line_slots_count_is_two_to_four_and_pitch_is_positive_and_finite() {
    let invalid = ("CAPTION_SCENE_INVALID".to_string(), "pagination.lineSlots".to_string());
    for count in [1, 5, 0] {
        assert_eq!(
            rejected(|s| s["layout"]["pagination"]["lineSlots"]["count"] = json!(count)),
            invalid,
            "{count}"
        );
    }
    for pitch in [json!(0), json!(-1.4), json!(0.0)] {
        assert_eq!(
            rejected(|s| s["layout"]["pagination"]["lineSlots"]["pitch"] = pitch.clone()),
            invalid,
            "{pitch}"
        );
    }
    for count in [2, 3, 4] {
        edit(|s| s["layout"]["pagination"]["lineSlots"]["count"] = json!(count)).unwrap();
    }
    // A fractional or non-numeric count or pitch is not a document at all.
    for (field, value) in [
        ("count", json!(2.5)),
        ("count", json!("2")),
        ("pitch", json!("1")),
        ("pitch", json!(null)),
    ] {
        assert!(edit(|s| s["layout"]["pagination"]["lineSlots"][field] = value).is_err());
    }
    assert!(edit(|s| s["layout"]["pagination"]["lineSlots"]["gap"] = json!(1)).is_err());
    // Non-finite numbers cannot be written as JSON; a hand-built scene still gets rejected.
    let style = parse_style(&fixture()).unwrap();
    for pitch in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 0.0, -0.0] {
        let mut scene = style.scene().clone();
        scene.layout.pagination.line_slots = Some(LineSlots { count: 2, pitch });
        let error = validate_scene(&scene).unwrap_err();
        assert_eq!(
            (error.code.as_str(), error.path.as_str()),
            ("CAPTION_SCENE_INVALID", "pagination.lineSlots"),
            "{pitch}"
        );
    }
}

#[test]
fn line_slots_need_single_row_word_line_pages() {
    let invalid = ("CAPTION_SCENE_INVALID".to_string(), "pagination.lineSlots".to_string());
    assert_eq!(
        rejected(|s| s["layout"]["pagination"]["wordLinePattern"] = json!([[2, 2]])),
        invalid
    );
    assert_eq!(
        rejected(|s| s["layout"]["pagination"]["wordLinePattern"] = json!([[3], [1, 2]])),
        invalid
    );
    assert_eq!(rejected(|s| s["layout"]["pagination"]["wordLinePattern"] = Value::Null), invalid);
    assert_eq!(
        rejected(|s| {
            s["layout"]["pagination"] = json!({"lineSlots": {"count": 2, "pitch": 1.4}});
        }),
        invalid
    );
    // Several single-row pages cycle like any word line pattern.
    edit(|s| s["layout"]["pagination"]["wordLinePattern"] = json!([[3], [2], [4]])).unwrap();
}

#[test]
fn line_slots_exclude_every_other_page_and_row_plan() {
    let invalid = ("CAPTION_SCENE_INVALID".to_string(), "pagination.lineSlots".to_string());
    let fit = json!({"lastLineWidthRatio": 0.5, "lastLineMaxScale": 1.3, "extraLineHeight": 0.1});
    for (field, value) in [
        ("maxUnitsPerPage", json!(3)),
        ("maxUnitsPerLine", json!(2)),
        ("wordPagePattern", json!([3])),
        ("textLinePattern", json!({"unit": "unicode-scalar", "lines": [[6]]})),
        ("lastPageRule", json!({"ifRowCountIs": 1, "previousPageLines": [3]})),
        ("tailWordRule", json!("join-previous-line")),
        ("remainingWordPagePlans", json!([[1], [2]])),
        ("fixedLineOverflow", json!("wrap")),
        ("fixedLineFit", fit),
        (
            "patternSelect",
            json!({"by": "seed", "candidates": [{"id": "one", "wordLinePattern": [[1]]}]}),
        ),
        ("tagRuns", json!({"tag": "keyword", "mode": "line"})),
    ] {
        assert_eq!(rejected(|s| s["layout"]["pagination"][field] = value), invalid, "{field}");
    }
}

#[test]
fn isolation_page_tags_and_page_windows_combine_with_line_slots() {
    let isolated = edit(|s| {
        s["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-keyword-isolation/1"));
        s["layout"]["pagination"]["isolation"] = json!([{"tag": "keyword", "mode": "line"}]);
    })
    .unwrap();
    assert_eq!(isolated.scene().layout.pagination.isolation.len(), 1);
    let tagged = edit(|s| {
        s["requiredCapabilities"].as_array_mut().unwrap().push(json!("caption-page-tag/1"));
        s["layout"]["pagination"]["wordLinePattern"] = json!([[3], [2]]);
        s["layout"]["pagination"]["pageTags"] = json!([1, 2]);
    })
    .unwrap();
    assert_eq!(tagged.scene().layout.pagination.page_tags, Some(vec![1, 2]));
    let windowed = edit(|s| {
        s["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-page-window/1"));
        s["speechState"]["timingPolicy"] = json!("require-word-timing");
        s["layout"]["leadingGap"] = json!("hide");
        s["layout"]["pageWindow"] = json!({
            "gapThreshold": {"ticks": 1000, "timescale": 1000},
            "shortGap": {"before": 0.0, "after": 1.0},
            "longGap": {"before": 0.0, "after": 0.5},
            "boundary": "start-inclusive-end-exclusive"
        });
    })
    .unwrap();
    assert!(windowed.scene().layout.page_window.is_some());
}
