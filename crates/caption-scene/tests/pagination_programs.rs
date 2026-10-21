use caption_scene::*;
use serde_json::{Value, json};

fn fixture(name: &str) -> Value {
    let text = match name {
        "select" => include_str!("fixtures/pattern-select.json"),
        "isolation" => include_str!("fixtures/keyword-isolation.json"),
        _ => include_str!("fixtures/word-line-layout.json"),
    };
    serde_json::from_str(text).unwrap()
}

fn edit(name: &str, f: impl FnOnce(&mut Value)) -> Result<SceneStyle> {
    let mut body = fixture(name);
    f(&mut body["scene"]["value"]);
    parse_style(&body)
}

fn candidates(scene: &mut Value) -> &mut Vec<Value> {
    scene["layout"]["pagination"]["patternSelect"]["candidates"].as_array_mut().unwrap()
}

fn invalid(name: &str, f: impl FnOnce(&mut Value)) -> String {
    edit(name, f).unwrap_err().code
}

#[test]
fn pagination_program_fixtures_validate_and_round_trip() {
    for name in ["select", "isolation"] {
        let style = parse_style(&fixture(name)).unwrap();
        let again: Scene = serde_json::from_str(&serde_json::to_string(style.scene()).unwrap()).unwrap();
        assert_eq!(&again, style.scene(), "{name}");
    }
    let select = parse_style(&fixture("select")).unwrap();
    let program = select.scene().layout.pagination.pattern_select.as_ref().unwrap();
    assert_eq!(program.by, PatternSelectBy::WordCount);
    assert_eq!(program.candidates.len(), 8);
    assert!(select.scene().layout.pagination.has_fixed_lines());
    let isolation = parse_style(&fixture("isolation")).unwrap();
    let modes: Vec<_> = isolation.scene().layout.pagination.isolation.iter().map(|r| r.mode).collect();
    assert_eq!(modes, [IsolationMode::Page, IsolationMode::Line, IsolationMode::None]);
}

#[test]
fn old_word_line_documents_serialize_without_new_fields() {
    let style = parse_style(&fixture("word-line")).unwrap();
    let pagination = serde_json::to_value(&style.scene().layout.pagination).unwrap();
    assert!(pagination.get("patternSelect").is_none());
    assert!(pagination.get("isolation").is_none());
}

#[test]
fn pagination_programs_require_their_capabilities() {
    for (name, capability) in [("select", "caption-pattern-select/1"), ("isolation", "caption-keyword-isolation/1")] {
        let err = edit(name, |scene| {
            scene["requiredCapabilities"].as_array_mut().unwrap().retain(|c| c != capability);
        })
        .unwrap_err();
        assert_eq!((err.code.as_str(), err.detail.as_str()), ("CAPTION_CAPABILITY_REQUIRED", capability));
    }
}

#[test]
fn pattern_select_rejects_ambiguous_or_incomplete_programs() {
    let cases: Vec<Box<dyn FnOnce(&mut Value)>> = vec![
        // Exclusive with a direct pattern or other pagination modes.
        Box::new(|s| s["layout"]["pagination"]["wordLinePattern"] = json!([[2]])),
        Box::new(|s| s["layout"]["pagination"]["maxUnitsPerPage"] = json!(3)),
        Box::new(|s| s["layout"]["pagination"]["lastPageRule"] = json!({"ifRowCountIs": 1, "previousPageLines": [4]})),
        // Word-count programs need a final range-less fallback and disjoint ranges.
        Box::new(|s| {
            candidates(s).pop();
        }),
        Box::new(|s| candidates(s)[1]["minWords"] = json!(2)),
        Box::new(|s| candidates(s)[0]["maxWords"] = Value::Null),
        Box::new(|s| candidates(s)[2]["minWords"] = json!(5)),
        // Candidates obey word line limits and unique ids.
        Box::new(|s| candidates(s)[3]["wordLinePattern"] = json!([[1, 1, 1, 1, 1, 1]])),
        Box::new(|s| candidates(s)[0]["wordLinePattern"] = json!([[0]])),
        Box::new(|s| candidates(s)[1]["id"] = json!("two")),
        Box::new(|s| candidates(s).clear()),
        // Seed programs take no ranges.
        Box::new(|s| s["layout"]["pagination"]["patternSelect"]["by"] = json!("seed")),
    ];
    for (i, case) in cases.into_iter().enumerate() {
        assert_eq!(invalid("select", case), "CAPTION_SCENE_INVALID", "case {i}");
    }
    let seeded = edit("select", |s| {
        s["layout"]["pagination"]["patternSelect"] = json!({"by": "seed", "candidates": [
            {"id": "one", "wordLinePattern": [[1]]},
            {"id": "pair", "wordLinePattern": [[2]], "lastPageRule": {"ifRowCountIs": 1, "previousPageLines": [3]}}
        ]});
    });
    assert!(seeded.is_ok());
    // Unknown selection modes fail schema parsing instead of falling back.
    assert!(edit("select", |s| s["layout"]["pagination"]["patternSelect"]["by"] = json!("random")).is_err());
}

#[test]
fn isolation_needs_a_fixed_word_plan_and_no_tail_rule() {
    let cases: Vec<Box<dyn FnOnce(&mut Value)>> = vec![
        Box::new(|s| {
            s["layout"]["pagination"] = json!({"isolation": [{"tag": "keyword", "mode": "page"}]});
        }),
        Box::new(|s| {
            s["layout"]["pagination"]["lastPageRule"] = json!({"ifRowCountIs": 1, "previousPageLines": [2, 2]});
        }),
        Box::new(|s| {
            s["layout"]["pagination"]["isolation"].as_array_mut().unwrap().push(json!({"tag": "keyword", "mode": "line"}));
        }),
        Box::new(|s| s["layout"]["pagination"]["isolation"][0]["tag"] = json!("")),
        Box::new(|s| {
            s["requiredCapabilities"].as_array_mut().unwrap().push(json!("caption-text-line-layout/1"));
            s["layout"]["pagination"] =
                json!({"textLinePattern": {"unit": "grapheme", "lines": [[4]]}, "isolation": [{"tag": "keyword", "mode": "line"}]});
        }),
    ];
    for (i, case) in cases.into_iter().enumerate() {
        assert_eq!(invalid("isolation", case), "CAPTION_SCENE_INVALID", "case {i}");
    }
    let combined = edit("isolation", |s| {
        s["requiredCapabilities"].as_array_mut().unwrap().push(json!("caption-pattern-select/1"));
        s["layout"]["pagination"]["wordLinePattern"] = Value::Null;
        s["layout"]["pagination"]["patternSelect"] =
            json!({"by": "seed", "candidates": [{"id": "one", "wordLinePattern": [[1]]}]});
    });
    assert!(combined.is_ok(), "{:?}", combined.err());
}

#[test]
fn pagination_programs_are_exclusive_with_the_other_word_plans() {
    let fit = json!({"lastLineWidthRatio": 0.5, "lastLineMaxScale": 1.3, "extraLineHeight": 0.1});
    for name in ["select", "isolation"] {
        for (field, value) in [
            ("wordPagePattern", json!([2])),
            ("maxUnitsPerLine", json!(2)),
            ("tailWordRule", json!("join-previous-line")),
            ("remainingWordPagePlans", json!([[1], [2]])),
            ("fixedLineOverflow", json!("wrap")),
            ("fixedLineFit", fit.clone()),
            ("pageTags", json!([1])),
        ] {
            let err = edit(name, |scene| {
                scene["requiredCapabilities"].as_array_mut().unwrap().extend(
                    [
                        "caption-word-page-layout/1",
                        "caption-line-unit-quota/1",
                        "caption-word-line-tail-join/1",
                        "caption-remaining-word-page-plan/1",
                        "caption-fixed-line-wrap/1",
                        "caption-fixed-line-fit/1",
                        "caption-page-tag/1",
                    ]
                    .map(Value::from),
                );
                scene["layout"]["pagination"][field] = value;
            })
            .unwrap_err();
            assert_eq!(err.code, "CAPTION_SCENE_INVALID", "{name} {field}: {}", err.detail);
        }
    }
}
