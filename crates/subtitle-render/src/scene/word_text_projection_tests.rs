//! Explicit display membership preserves source identity and timing through layout.
use super::*;
use serde_json::{Value, json};

fn source_cue(content: &str, words: &[(&str, &str, f64, f64)]) -> SceneCue {
    SceneCue {
        id: "cue".into(),
        document_id: "doc".into(),
        text: content.into(),
        start: 0.0,
        end: 2.0,
        words: words
            .iter()
            .map(|(id, text, start, end)| SceneWord {
                id: (*id).into(),
                text: (*text).into(),
                start: *start,
                end: *end,
            })
            .collect(),
    }
}
fn projection(content: &str, ranges: &[(&str, usize, usize)]) -> WordTextProjection {
    WordTextProjection {
        text_sha256: Sha256::digest(content.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>(),
        words: ranges
            .iter()
            .map(|(id, start, end)| WordTextRange {
                word_id: (*id).into(),
                start: *start,
                end: *end,
            })
            .collect(),
    }
}
fn override_row(occurrence: Option<&str>, value: Option<WordTextProjection>) -> CueOverride {
    CueOverride {
        cue_id: "cue".into(),
        occurrence_id: occurrence.map(str::to_owned),
        parameters: BTreeMap::new(),
        word_text_projection: value,
    }
}
fn source_snapshot(cue: &SceneCue) -> Vec<(String, String, f64, f64)> {
    cue.words
        .iter()
        .map(|w| (w.id.clone(), w.text.clone(), w.start, w.end))
        .collect()
}

#[test]
fn explicit_range_selects_second_repeated_display_word_without_searching_source_text() {
    let cue = source_cue("B B B", &[("source-id", "A", 0.25, 1.75)]);
    let before = source_snapshot(&cue);
    let mapped = projection(&cue.text, &[("source-id", 2, 3)]);
    assert!(bind_words(&cue, &cue.text, TimingPolicy::RequireWordTiming, false).is_err());
    let words = word_text_projection::bind(&cue, &cue.text, &mapped).unwrap();
    assert_eq!(words.len(), 1);
    assert_eq!(words[0].bytes, 2..3);
    assert_eq!(&cue.text[words[0].bytes.clone()], "B");
    assert_eq!(words[0].id, "source-id");
    assert_eq!(words[0].span, Some((0.25, 1.75)));
    assert!(words[0].input_timed);
    assert_eq!(source_snapshot(&cue), before);
}

#[test]
fn utf8_byte_ranges_allow_length_changes_and_skip_only_empty_source_records() {
    let cue = source_cue(
        "ββ X",
        &[
            ("w0", "A", 0.1, 0.5),
            ("empty", "", 0.5, 0.5),
            ("w1", "LONG", 0.8, 1.5),
        ],
    );
    let before = source_snapshot(&cue);
    let mapped = projection(&cue.text, &[("w0", 0, 4), ("w1", 5, 6)]);
    let words = word_text_projection::bind(&cue, &cue.text, &mapped).unwrap();
    assert_eq!(
        words.iter().map(|w| w.bytes.clone()).collect::<Vec<_>>(),
        vec![0..4, 5..6]
    );
    assert_eq!(
        words.iter().map(|w| w.id.as_str()).collect::<Vec<_>>(),
        vec!["w0", "w1"]
    );
    assert_eq!(
        words.iter().map(|w| w.span).collect::<Vec<_>>(),
        vec![Some((0.1, 0.5)), Some((0.8, 1.5))]
    );
    assert_eq!(source_snapshot(&cue), before);
}

#[test]
fn stale_hash_split_utf8_overlapping_wrong_id_and_incomplete_source_binding_are_rejected() {
    let cue = source_cue("é B", &[("w0", "A", 0.1, 0.5), ("w1", "C", 0.8, 1.5)]);
    let correct = projection(&cue.text, &[("w0", 0, 2), ("w1", 3, 4)]);
    assert!(word_text_projection::bind(&cue, &cue.text, &correct).is_ok());
    let mut bad = Vec::new();
    let mut stale = correct.clone();
    stale.text_sha256 = "0".repeat(64);
    bad.push(stale);
    for ranges in [
        vec![("w0", 1, 2), ("w1", 3, 4)],
        vec![("w0", 0, 1), ("w1", 3, 4)],
        vec![("w0", 0, 2), ("w1", 3, 5)],
        vec![("w0", 0, 4), ("w1", 3, 4)],
        vec![("w0", 0, 2), ("w1", 0, 2)],
        vec![("foreign", 0, 2), ("w1", 3, 4)],
        vec![("w1", 0, 2), ("w0", 3, 4)],
        vec![("w0", 0, 2)],
        vec![("w0", 0, 2), ("w1", 3, 4), ("extra", 4, 5)],
        vec![],
    ] {
        bad.push(projection(&cue.text, &ranges));
    }
    for mapped in bad {
        assert!(
            word_text_projection::bind(&cue, &cue.text, &mapped).is_err(),
            "{mapped:?}"
        );
    }
    let no_source = source_cue("B", &[]);
    assert!(
        word_text_projection::bind(
            &no_source,
            &no_source.text,
            &projection("B", &[("w0", 0, 1)])
        )
        .is_err()
    );
}

#[test]
fn invalid_source_times_and_duplicate_source_ids_do_not_gain_validity_from_display_ranges() {
    for (start, end) in [(f64::NAN, 1.0), (0.0, f64::INFINITY), (0.9, 0.8)] {
        let cue = source_cue("B", &[("w0", "A", start, end)]);
        assert!(
            word_text_projection::bind(&cue, &cue.text, &projection("B", &[("w0", 0, 1)])).is_err()
        );
    }
    let cue = source_cue("B C", &[("same", "A", 0.1, 0.5), ("same", "A", 0.8, 1.5)]);
    assert!(
        word_text_projection::bind(
            &cue,
            &cue.text,
            &projection("B C", &[("same", 0, 1), ("same", 2, 3)])
        )
        .is_err()
    );
}

#[test]
fn occurrence_scope_overrides_unscoped_projection_independent_of_vector_order() {
    let cue = source_cue("B B B", &[("w0", "A", 0.1, 0.5)]);
    let unscoped = projection(&cue.text, &[("w0", 0, 1)]);
    let scoped = projection(&cue.text, &[("w0", 2, 3)]);
    let other = projection(&cue.text, &[("w0", 4, 5)]);
    let mut wrong_cue = override_row(Some("cut"), Some(other.clone()));
    wrong_cue.cue_id = "different-cue".into();
    let presentation = Presentation {
        cue_overrides: vec![
            override_row(Some("cut"), Some(scoped.clone())),
            override_row(Some("other"), Some(other)),
            wrong_cue,
            override_row(None, Some(unscoped.clone())),
        ],
        ..Default::default()
    };
    for instance in ["item|cut", "cut"] {
        assert_eq!(
            word_text_projection::for_cue(&presentation, &cue, instance),
            Some(&scoped)
        );
    }
    assert_eq!(
        word_text_projection::for_cue(&presentation, &cue, "item|absent"),
        Some(&unscoped)
    );
    let no_scoped_value = Presentation {
        cue_overrides: vec![
            override_row(None, Some(unscoped.clone())),
            override_row(Some("cut"), None),
        ],
        ..Default::default()
    };
    assert_eq!(
        word_text_projection::for_cue(&no_scoped_value, &cue, "item|cut"),
        Some(&unscoped)
    );
    let other_cue = SceneCue {
        id: "unrelated".into(),
        ..cue.clone()
    };
    assert!(word_text_projection::for_cue(&presentation, &other_cue, "item|cut").is_none());
}

fn body() -> Value {
    let font = include_bytes!("../../../render-raster/assets/fonts/VKSans-400.ttf");
    json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
        "schema":"baocut.caption-scene/1","evaluationVersion":1,
        "requiredCapabilities":["caption-scene/1","caption-font-source/1","caption-font-shaping/1","caption-word-text-projection/1","caption-text-transform/1"],
        "layout":{"width":{"value":160,"basis":"absolute"},"x":{"value":100,"basis":"absolute"},"y":{"value":60,"basis":"absolute"},"maxLines":2,"overflow":"visible"},
        "nodes":[{"id":"text","type":"text","style":{"fontFamily":"projection-fixture","fontSource":{"sha256":Sha256::digest(font).iter().map(|byte| format!("{byte:02x}")).collect::<String>(),"faceIndex":0},"fontWeight":400,"fontShaping":"nominal","fontSize":{"value":40,"basis":"absolute"},"fill":"#FFFFFF"}}]
    }}})
}
fn plan(body: &Value, cue: SceneCue, mapped: Option<WordTextProjection>) -> Result<ScenePlan> {
    ScenePlan::compile(
        parse_style(body).unwrap(),
        Presentation {
            cue_overrides: mapped
                .map(|p| vec![override_row(None, Some(p))])
                .unwrap_or_default(),
            ..Default::default()
        },
        vec![cue],
        (200, 120),
        TextEngine::with_document_fonts(&[include_bytes!(
            "../../../render-raster/assets/fonts/VKSans-400.ttf"
        )
        .to_vec()]),
        "item|cut".into(),
    )
}

#[test]
fn native_nominal_scene_renders_projected_glyph_identically_to_the_same_display_text_baseline() {
    let source = source_cue("B", &[("stable-source-id", "A", 0.1, 1.5)]);
    let before = source_snapshot(&source);
    let mut projected = plan(
        &body(),
        source,
        Some(projection("B", &[("stable-source-id", 0, 1)])),
    )
    .unwrap();
    let layout = &projected.layouts[&(0, "text".into())];
    assert_eq!(layout.content, "B");
    assert_eq!(layout.words[0].id, "stable-source-id");
    assert_eq!(layout.words[0].span, Some((0.1, 1.5)));
    assert_eq!(source_snapshot(&projected.cues[0]), before);
    let mut baseline = plan(
        &body(),
        source_cue("B", &[("stable-source-id", "B", 0.1, 1.5)]),
        None,
    )
    .unwrap();
    let actual = projected.render(0.5).unwrap();
    let expected = baseline.render(0.5).unwrap();
    assert!(actual.rgba.chunks_exact(4).any(|pixel| pixel[3] != 0));
    assert_eq!(actual.rgba.as_ref(), expected.rgba.as_ref());
    assert_eq!(source_snapshot(&projected.cues[0]), before);
}

#[test]
fn scene_compile_checks_stale_projection_before_render_and_preserves_legacy_binding_without_it() {
    let source = source_cue("B", &[("w0", "A", 0.1, 1.5)]);
    assert!(plan(&body(), source.clone(), None).is_err());
    let stale = projection("A", &[("w0", 0, 1)]);
    let error = plan(&body(), source, Some(stale))
        .err()
        .expect("stale projection must fail");
    assert!(
        error
            .to_string()
            .contains("stale word text projection hash")
    );
}

#[test]
fn static_text_ignores_cue_projection_while_cue_bound_nonidentity_transform_is_rejected() {
    let source = source_cue("C", &[("w0", "A", 0.1, 1.5)]);
    let mut static_body = body();
    static_body["scene"]["value"]["nodes"][0]["text"] = json!({"source":"static","text":"B"});
    let stale = projection("unrelated", &[("w0", 0, 1)]);
    let mut static_plan = plan(&static_body, source.clone(), Some(stale)).unwrap();
    assert_eq!(static_plan.layouts[&(0, "text".into())].content, "B");
    assert!(
        static_plan
            .render(0.5)
            .unwrap()
            .rgba
            .chunks_exact(4)
            .any(|pixel| pixel[3] != 0)
    );
    let mut transformed = body();
    transformed["scene"]["value"]["nodes"][0]["style"]["textTransform"] = json!("uppercase");
    let error = plan(&transformed, source, Some(projection("C", &[("w0", 0, 1)])))
        .err()
        .expect("conflicting transform must fail");
    assert!(error.to_string().contains("identity node textTransform"));
    let mut legacy = plan(
        &transformed,
        source_cue("b", &[("w0", "b", 0.1, 1.5)]),
        None,
    )
    .unwrap();
    assert_eq!(legacy.layouts[&(0, "text".into())].content, "B");
    assert!(
        legacy
            .render(0.5)
            .unwrap()
            .rgba
            .chunks_exact(4)
            .any(|pixel| pixel[3] != 0)
    );
}
