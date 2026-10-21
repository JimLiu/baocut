use caption_scene::*;
use render_raster::TextEngine;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use subtitle_render::scene::*;

const TEXT: &str = "One two three four five";

fn words(count: usize) -> Vec<SceneWord> {
    TEXT.split(' ')
        .take(count)
        .enumerate()
        .map(|(i, text)| SceneWord {
            id: format!("w{i}"),
            text: text.into(),
            start: i as f64,
            end: i as f64 + 1.0,
        })
        .collect()
}

fn plan(body: &Value, presentation: Presentation, count: usize) -> ScenePlan {
    let text = TEXT.split(' ').take(count).collect::<Vec<_>>().join(" ");
    ScenePlan::compile(
        parse_style(body).unwrap(),
        presentation,
        vec![SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text,
            start: 0.0,
            end: count as f64,
            words: words(count),
        }],
        (160, 90),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]),
        "caption|occurrence".into(),
    )
    .unwrap()
}

fn fixture(name: &str) -> Value {
    serde_json::from_str(match name {
        "select" => include_str!("../../caption-scene/tests/fixtures/pattern-select.json"),
        _ => include_str!("../../caption-scene/tests/fixtures/keyword-isolation.json"),
    })
    .unwrap()
}

/// The same scene with a plain fixed word line pattern and no program.
fn plain(name: &str, pattern: Value) -> Value {
    let mut body = fixture(name);
    let scene = &mut body["scene"]["value"];
    scene["requiredCapabilities"] = json!(["caption-word-line-layout/1"]);
    scene["layout"]["pagination"] = json!({ "wordLinePattern": pattern });
    body
}

fn tagged(tag: &str) -> Presentation {
    Presentation {
        word_tags: BTreeMap::from([("w1".to_string(), vec![tag.to_string()])]),
        ..Presentation::default()
    }
}

fn frames(plan: &mut ScenePlan, times: &[f64]) -> Vec<Vec<u8>> {
    times
        .iter()
        .map(|&t| plan.render(t).unwrap().rgba.to_vec())
        .collect()
}

const TIMES: [f64; 5] = [0.5, 1.5, 2.5, 3.5, 4.5];

#[test]
fn page_isolation_gives_the_tagged_word_its_own_page() {
    let mut isolated = plan(&fixture("isolation"), tagged("keyword"), 5);
    // [[2,2]] with word 1 isolated: [One] [two] [three four / five].
    let mut expected = plan(
        &plain("isolation", json!([[1], [1], [2, 1]])),
        Presentation::default(),
        5,
    );
    let got = frames(&mut isolated, &TIMES);
    assert_eq!(got, frames(&mut expected, &TIMES));
    assert!(got[1].chunks_exact(4).any(|p| p[3] > 0));
    let mut untagged = plan(&fixture("isolation"), Presentation::default(), 5);
    let mut base = plan(
        &plain("isolation", json!([[2, 2]])),
        Presentation::default(),
        5,
    );
    assert_eq!(frames(&mut untagged, &TIMES), frames(&mut base, &TIMES));
    assert_ne!(got[1], frames(&mut base, &[1.5])[0]);
}

#[test]
fn line_isolation_and_none_mode_only_move_row_boundaries() {
    let mut isolated = plan(&fixture("isolation"), tagged("aside"), 5);
    // [[2,2]] with word 1 on its own row: [One / two] [three four / five].
    let mut expected = plan(
        &plain("isolation", json!([[1, 1], [2, 1]])),
        Presentation::default(),
        5,
    );
    assert_eq!(frames(&mut isolated, &TIMES), frames(&mut expected, &TIMES));
    let mut none = plan(&fixture("isolation"), tagged("plain"), 5);
    let mut base = plan(
        &plain("isolation", json!([[2, 2]])),
        Presentation::default(),
        5,
    );
    assert_eq!(frames(&mut none, &TIMES), frames(&mut base, &TIMES));
}

#[test]
fn word_count_selection_matches_the_frozen_candidate_and_is_reported() {
    for (count, candidate, pattern) in [
        (2, "two", json!([[2]])),
        (3, "three", json!([[3]])),
        (4, "pairs", json!([[2, 2]])),
        (5, "stack", json!([[1, 1, 1, 1, 1]])),
    ] {
        let mut selected = plan(&fixture("select"), Presentation::default(), count);
        let report: Vec<_> = selected
            .diagnostics
            .iter()
            .map(|d| (d.code.as_str(), d.path.as_str(), d.detail.clone()))
            .collect();
        assert_eq!(
            report,
            [(
                "CAPTION_PATTERN_SELECTED",
                "cue",
                format!("node=caption candidate={candidate} words={count}")
            )]
        );
        let mut expected = plan(&plain("select", pattern), Presentation::default(), count);
        assert!(expected.diagnostics.is_empty());
        let times = &TIMES[..count];
        assert_eq!(
            frames(&mut selected, times),
            frames(&mut expected, times),
            "{candidate}"
        );
    }
}

#[test]
fn seeded_selection_is_frozen_by_instance_seed_and_cue() {
    let mut body = fixture("select");
    body["scene"]["value"]["layout"]["pagination"]["patternSelect"] = json!({"by": "seed", "candidates": [
        {"id": "single", "wordLinePattern": [[1]]},
        {"id": "pair", "wordLinePattern": [[2]]},
        {"id": "stack", "wordLinePattern": [[1, 1, 1]]}
    ]});
    let chosen = |seed: &str| {
        let presentation = Presentation {
            seed: seed.into(),
            ..Presentation::default()
        };
        plan(&body, presentation, 5).diagnostics[0].detail.clone()
    };
    let mut seen = std::collections::BTreeSet::new();
    for seed in 0..32u64 {
        let hex = format!("{seed:016x}");
        assert_eq!(chosen(&hex), chosen(&hex));
        seen.insert(chosen(&hex));
    }
    assert_eq!(seen.len(), 3, "{seen:?}");
}
