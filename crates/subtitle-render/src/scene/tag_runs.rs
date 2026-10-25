//! `caption-tag-run-isolation/1`: width-wrapped lines or pages never span a change of tag state.
//!
//! A word is tagged when `presentation.wordTags` lists the rule's tag for it; the first word of
//! every run of equal state (but the very first word) is marked `run_start`. `line` mode rejects
//! any line holding a run start strictly inside it, applied through the line measure like the
//! word quota so frozen pages, per-sample layout and unit font reflow all fold the same lines.
//! `page` mode cuts the page ranges at run starts, so quotas count again in each run.
use super::*;

/// Marks the word that begins a run of the other tag state than its predecessor.
pub(super) fn mark(
    words: &mut [Word],
    pagination: &Pagination,
    word_tags: &BTreeMap<String, Vec<String>>,
) {
    let Some(runs) = &pagination.tag_runs else {
        return;
    };
    let tagged = |word: &Word| {
        word_tags
            .get(&word.id)
            .is_some_and(|tags| tags.contains(&runs.tag))
    };
    let mut previous = None;
    for word in words {
        let state = tagged(word);
        word.run_start = previous.is_some_and(|before| before != state);
        previous = Some(state);
    }
}

/// Run start offsets relative to `content[origin..end]`, ascending.
pub(super) fn starts(words: &[Word], origin: usize, end: usize) -> Vec<usize> {
    words
        .iter()
        .filter(|w| w.run_start && (origin..end).contains(&w.bytes.start))
        .map(|w| w.bytes.start - origin)
        .collect()
}

/// Wraps a line measure so a range holding a run start strictly after its first byte never fits.
/// Containing a start only becomes true as the range end grows, so the fit test of `layout`
/// stays monotone; a single grapheme cannot hold a start after its first byte.
pub(super) fn barrier<'a>(
    starts: Vec<usize>,
    mut measure: impl FnMut(Range<usize>) -> TextMetricsLine + 'a,
) -> impl FnMut(Range<usize>) -> TextMetricsLine + 'a {
    move |r: Range<usize>| {
        let first = starts.partition_point(|s| *s <= r.start);
        let past = starts.partition_point(|s| *s < r.end);
        if past > first {
            return TextMetricsLine {
                width: f64::INFINITY,
                ..TextMetricsLine::default()
            };
        }
        measure(r)
    }
}

/// End of the page range that begins at word `from`: at most `end`, cut before the next run start.
pub(super) fn page_end(words: &[Word], pagination: &Pagination, from: usize, end: usize) -> usize {
    if !pagination
        .tag_runs
        .as_ref()
        .is_some_and(|runs| runs.mode == TagRunMode::Page)
    {
        return end;
    }
    words[from + 1..end]
        .iter()
        .position(|w| w.run_start)
        .map_or(end, |offset| from + 1 + offset)
}

/// Whether page ranges after the first start at a word rather than at the cue start.
pub(super) fn cuts_pages(pagination: &Pagination) -> bool {
    pagination
        .tag_runs
        .as_ref()
        .is_some_and(|runs| runs.mode == TagRunMode::Page)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const TEXT: &str = "Alpha beta gamma delta epsilon zeta";
    const TAGGED: [&str; 3] = ["beta", "gamma", "delta"];

    fn plan(width: f64, mode: Option<&str>, cap: Option<usize>) -> ScenePlan {
        plan_lines(width, mode, cap, 3)
    }
    fn plan_lines(
        width: f64,
        mode: Option<&str>,
        cap: Option<usize>,
        max_lines: usize,
    ) -> ScenePlan {
        let mut body: serde_json::Value = serde_json::from_str(include_str!(
            "../../../caption-scene/tests/fixtures/unit-font-reflow.json"
        ))
        .unwrap();
        let scene = &mut body["scene"]["value"];
        let layout = &mut scene["layout"];
        layout["width"] = json!({"value": width, "basis": "absolute"});
        layout["maxLines"] = json!(max_lines);
        layout["x"] = json!({"value": 160, "basis": "absolute"});
        layout["y"] = json!({"value": 90, "basis": "absolute"});
        layout["pagination"] = json!({});
        if let Some(cap) = cap {
            layout["pagination"]["maxUnitsPerPage"] = json!(cap);
        }
        if let Some(mode) = mode {
            layout["pagination"]["tagRuns"] = json!({"tag": "keyword", "mode": mode});
            scene["requiredCapabilities"]
                .as_array_mut()
                .unwrap()
                .push(json!("caption-tag-run-isolation/1"));
        }
        let words: Vec<_> = TEXT
            .split(' ')
            .enumerate()
            .map(|(i, text)| SceneWord {
                id: format!("w{i}"),
                text: text.into(),
                start: i as f64 * 0.5,
                end: i as f64 * 0.5 + 0.5,
            })
            .collect();
        let word_tags = TEXT
            .split(' ')
            .enumerate()
            .filter(|(_, text)| TAGGED.contains(text))
            .map(|(i, _)| (format!("w{i}"), vec!["keyword".to_string()]))
            .collect();
        ScenePlan::compile(
            caption_scene::parse_style(&body).unwrap(),
            Presentation {
                word_tags,
                ..Presentation::default()
            },
            vec![SceneCue {
                id: "cue".into(),
                document_id: "doc".into(),
                text: TEXT.into(),
                start: 0.0,
                end: 4.0,
                words,
            }],
            (320, 180),
            TextEngine::with_document_fonts(&[include_bytes!(
                "../../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
            )
            .to_vec()]),
            "tag-runs".into(),
        )
        .unwrap()
    }
    fn layout(plan: &ScenePlan) -> &TextLayout {
        plan.layouts.values().next().unwrap()
    }
    fn rows(layout: &TextLayout) -> Vec<Vec<String>> {
        layout
            .pages
            .iter()
            .map(|page| {
                page.lines
                    .iter()
                    .map(|line| layout.content[line.bytes.clone()].to_string())
                    .collect()
            })
            .collect()
    }
    fn members(layout: &TextLayout) -> Vec<Vec<usize>> {
        layout.pages.iter().map(|p| p.words.clone()).collect()
    }
    /// Width at which exactly the tagged run fills one line.
    fn run_width() -> f64 {
        let wide = plan(1000.0, Some("line"), None);
        layout(&wide).pages[0].lines[1].shape.width + 2.0
    }
    /// Every line holds words of a single tag state.
    fn uniform(line: &str) -> bool {
        let states: Vec<bool> = line
            .split_whitespace()
            .map(|word| TAGGED.contains(&word))
            .collect();
        states.windows(2).all(|pair| pair[0] == pair[1])
    }

    #[test]
    fn line_runs_end_the_line_where_the_tag_state_changes() {
        let runs = plan(1000.0, Some("line"), None);
        assert_eq!(
            rows(layout(&runs)),
            [vec!["Alpha", "beta gamma delta", "epsilon zeta"]]
        );
        // Forced lines use up page rows: two rows per page continue on a second page.
        let two = plan_lines(1000.0, Some("line"), None, 2);
        assert_eq!(
            rows(layout(&two)),
            [vec!["Alpha", "beta gamma delta"], vec!["epsilon zeta"]]
        );
        assert_eq!(members(layout(&two)), [vec![0, 1, 2, 3], vec![4, 5]]);
        // The same width keeps a single line without the rule.
        let plain = plan(1000.0, None, None);
        assert_eq!(rows(layout(&plain)), [vec![TEXT]]);
    }

    #[test]
    fn wrapped_runs_stay_apart_where_plain_wrapping_would_join_them() {
        let width = run_width();
        let runs = plan(width, Some("line"), None);
        let lines: Vec<_> = rows(layout(&runs)).concat();
        assert_eq!(lines, ["Alpha", "beta gamma delta", "epsilon zeta"]);
        assert!(lines.iter().all(|line| uniform(line)));
        let plain = plan(width, None, None);
        assert!(
            rows(layout(&plain))
                .concat()
                .iter()
                .any(|line| !uniform(line)),
            "the width must be tight enough to join runs without the rule"
        );
    }

    #[test]
    fn page_runs_cut_pages_and_restart_the_page_cap() {
        let runs = plan(1000.0, Some("page"), None);
        assert_eq!(members(layout(&runs)), [vec![0], vec![1, 2, 3], vec![4, 5]]);
        assert_eq!(
            rows(layout(&runs)),
            [
                vec!["Alpha"],
                vec!["beta gamma delta"],
                vec!["epsilon zeta"]
            ]
        );
        let capped = plan(1000.0, Some("page"), Some(2));
        assert_eq!(
            members(layout(&capped)),
            [vec![0], vec![1, 2], vec![3], vec![4, 5]]
        );
        // Pages never start with the whitespace that precedes their first word.
        assert!(
            rows(layout(&capped))
                .concat()
                .iter()
                .all(|row| row == row.trim())
        );
        let plain = plan(1000.0, None, Some(2));
        assert_eq!(
            members(layout(&plain)),
            [vec![0, 1], vec![2, 3], vec![4, 5]]
        );
    }

    #[test]
    fn marks_only_the_words_that_change_state() {
        let runs = plan(1000.0, Some("line"), None);
        let marks: Vec<_> = layout(&runs).words.iter().map(|w| w.run_start).collect();
        assert_eq!(marks, [false, true, false, false, true, false]);
        let plain = plan(1000.0, None, None);
        assert!(layout(&plain).words.iter().all(|w| !w.run_start));
    }

    #[test]
    fn ranges_holding_a_run_start_after_their_first_byte_never_fit() {
        let mut measure = barrier(vec![6, 11], |r: Range<usize>| TextMetricsLine {
            width: r.len() as f64,
            ..TextMetricsLine::default()
        });
        assert_eq!(measure(0..6).width, 6.0);
        assert!(measure(0..7).width.is_infinite());
        // A line may begin exactly at a start and may begin inside the word before it.
        assert_eq!(measure(6..11).width, 5.0);
        assert!(measure(3..8).width.is_infinite());
        assert_eq!(measure(7..11).width, 4.0);
        assert!(measure(6..12).width.is_infinite());
    }

    #[test]
    fn per_sample_layout_and_unit_font_reflow_keep_runs_apart() {
        let width = run_width();
        // A smaller size leaves room to join neighbouring runs on one line.
        let refolded = |mode: Option<&str>| -> Vec<String> {
            let mut plan = plan(width, mode, None);
            let cue = plan.cues[0].clone();
            let params =
                cue_parameters(&plan.style, &plan.presentation, &cue, &plan.instance_id).unwrap();
            let scene = plan.style.scene().clone();
            let base = layout(&plan).clone();
            let mut node = scene.nodes[0].clone();
            node.style.font_size.value = 10.0;
            let mut out = Vec::new();
            for page in &base.pages {
                let again = sampled_layout::reflow(
                    &mut plan.text,
                    &base,
                    page,
                    &node,
                    &scene.layout,
                    (320, 180),
                    &params,
                    &mut Budget::default(),
                )
                .unwrap();
                out.extend(
                    again
                        .lines
                        .iter()
                        .map(|l| base.content[l.bytes.clone()].to_string()),
                );
            }
            out
        };
        let separated = refolded(Some("line"));
        assert!(separated.iter().all(|line| uniform(line)), "{separated:?}");
        assert!(refolded(None).iter().any(|line| !uniform(line)));
        let mut runs = plan(width, Some("line"), None);
        let sampled_rows = |plan: &mut ScenePlan, t: f64| -> Vec<String> {
            let cue = plan.cues[0].clone();
            let params =
                cue_parameters(&plan.style, &plan.presentation, &cue, &plan.instance_id).unwrap();
            let mut budget = Budget::default();
            let early = sampled_layout::early_context(
                &cue,
                0,
                1,
                t,
                &params,
                (320, 180),
                &plan.instance_id,
                &plan.presentation.seed,
            )
            .unwrap();
            let sampled =
                sampled_layout::sample_scene(plan.style.scene(), &early, t, &mut budget).unwrap();
            let scene = sampled.as_ref().unwrap_or(plan.style.scene());
            let units = resolved_units(
                &mut plan.text,
                &plan.layouts,
                0,
                &cue,
                scene,
                sampled.is_some(),
                t,
                &params,
                &plan.presentation,
                &plan.instance_id,
                (320, 180),
                &mut budget,
            )
            .unwrap();
            let content = &plan.layouts.values().next().unwrap().content;
            units["caption"]
                .iter()
                .filter(|(unit, _)| unit.kind == UnitKind::Line)
                .map(|(unit, _)| content[unit.bytes.clone()].trim().to_string())
                .collect()
        };
        // At 1.25 s the tagged word grows to 24 px, which no longer fits its run on one line.
        let grown = sampled_rows(&mut runs, 1.25);
        assert!(grown.len() > 3, "{grown:?}");
        for t in [0.25, 1.25, 2.25, 3.5] {
            let lines = sampled_rows(&mut runs, t);
            assert!(lines.iter().all(|line| uniform(line)), "{t}: {lines:?}");
        }
        // Without the rule the same growth refolds across runs.
        let mut plain = plan(width, None, None);
        assert!(
            sampled_rows(&mut plain, 3.5)
                .iter()
                .any(|line| !uniform(line))
        );
    }
}
