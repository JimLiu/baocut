//! Explicit display windows; original word/grapheme timing remains unchanged.
use super::*;

pub(super) fn contains(config: Option<&PageWindow>, page: &Page, index: usize, time: f64) -> bool {
    match config.map(|window| window.boundary) {
        Some(PageWindowBoundary::FirstStartInclusiveEndInclusive) => {
            (if index == 0 {
                time >= page.start
            } else {
                time > page.start
            }) && time <= page.end
        }
        _ => time >= page.start && time < page.end,
    }
}
/// Gaps between consecutive packed word spans: the time a page window leaves between one
/// word's packed end and the next word's packed start. Empty when the allocation leaves no gap.
pub(super) fn hidden_spans(
    words: &[Word],
    content: &str,
    config: &PageWindow,
) -> Result<Vec<(f64, f64)>> {
    let packed = packed_spans(words, content, config)?;
    Ok(packed
        .windows(2)
        .filter(|pair| pair[0].1 < pair[1].0)
        .map(|pair| (pair[0].1, pair[1].0))
        .collect())
}
/// Whether `time` lies in one of `spans`, with the boundary ownership of `contains`: the earlier
/// word's packed end belongs to the shown side (end-inclusive) or the gap (end-exclusive).
pub(super) fn hidden(config: Option<&PageWindow>, spans: &[(f64, f64)], time: f64) -> bool {
    let inclusive = matches!(
        config.map(|window| window.boundary),
        Some(PageWindowBoundary::FirstStartInclusiveEndInclusive)
    );
    spans.iter().any(|&(from, to)| {
        if inclusive {
            time > from && time <= to
        } else {
            time >= from && time < to
        }
    })
}
fn packed_spans(words: &[Word], content: &str, config: &PageWindow) -> Result<Vec<(f64, f64)>> {
    let mut original = Vec::with_capacity(words.len());
    for word in words {
        let Some((start, end)) = word.span.filter(|_| word.input_timed) else {
            bail!("CAPTION_PAGE_WINDOW_INVALID: every word requires input timing");
        };
        if !start.is_finite()
            || !end.is_finite()
            || end <= start
            || !(end - start).is_finite()
            || content
                .get(word.bytes.clone())
                .is_none_or(|text| text.trim().is_empty())
        {
            bail!("CAPTION_PAGE_WINDOW_INVALID: finite nonempty input word required");
        }
        if original
            .last()
            .is_some_and(|&(_, previous_end)| start < previous_end)
        {
            bail!("CAPTION_PAGE_WINDOW_INVALID: overlapping or nonmonotonic input words");
        }
        original.push((start, end));
    }
    let mut packed = original.clone();
    for index in 0..original.len().saturating_sub(1) {
        let end = original[index].1;
        let start = original[index + 1].0;
        let gap = start - end;
        if !gap.is_finite() {
            bail!("CAPTION_PAGE_WINDOW_INVALID: nonfinite gap");
        }
        let ratios = if gap <= config.gap_threshold.seconds() {
            config.short_gap
        } else {
            config.long_gap
        };
        // Endpoint ratios retain the actual word boundary without cancellation.
        let cut = if ratios.after == 1.0 {
            start
        } else if ratios.after == 0.0 {
            end
        } else {
            end + gap * ratios.after
        };
        let next = if ratios.before + ratios.after == 1.0 {
            cut
        } else if ratios.before == 1.0 {
            end
        } else if ratios.before == 0.0 {
            start
        } else {
            start - gap * ratios.before
        };
        if !cut.is_finite() || !next.is_finite() || cut > next {
            bail!("CAPTION_PAGE_WINDOW_INVALID: ambiguous gap allocation");
        }
        packed[index].1 = cut;
        packed[index + 1].0 = next;
    }
    Ok(packed)
}
fn positive(span: (f64, f64)) -> Result<(f64, f64)> {
    if !span.0.is_finite()
        || !span.1.is_finite()
        || span.1 <= span.0
        || !(span.1 - span.0).is_finite()
    {
        bail!("CAPTION_PAGE_WINDOW_INVALID: display windows require positive finite duration");
    }
    Ok(span)
}
pub(super) fn apply(
    pages: &mut [Page],
    words: &[Word],
    content: &str,
    config: &PageWindow,
) -> Result<()> {
    let packed = packed_spans(words, content, config)?;
    let mut previous_end = None;
    for page in pages {
        let first = *page
            .words
            .first()
            .ok_or_else(|| anyhow::anyhow!("CAPTION_PAGE_WINDOW_INVALID: empty page"))?;
        let last = *page.words.last().unwrap();
        let start = packed
            .get(first)
            .ok_or_else(|| anyhow::anyhow!("CAPTION_PAGE_WINDOW_INVALID: page member"))?
            .0;
        let end = packed
            .get(last)
            .ok_or_else(|| anyhow::anyhow!("CAPTION_PAGE_WINDOW_INVALID: page member"))?
            .1;
        let (start, end) = positive((start, end))?;
        if previous_end.is_some_and(|previous| start < previous) {
            bail!("CAPTION_PAGE_WINDOW_INVALID: page windows overlap");
        }
        previous_end = Some(end);
        page.start = start;
        page.end = end;
        let mut previous_line_end = None;
        for line in &mut page.lines {
            let members = page
                .words
                .iter()
                .copied()
                .filter(|index| {
                    words[*index].bytes.start < line.bytes.end
                        && words[*index].bytes.end > line.bytes.start
                })
                .collect::<Vec<_>>();
            let first = *members
                .first()
                .ok_or_else(|| anyhow::anyhow!("CAPTION_PAGE_WINDOW_INVALID: empty line"))?;
            let last = *members.last().unwrap();
            let span = positive((packed[first].0, packed[last].1))?;
            if previous_line_end.is_some_and(|previous| span.0 < previous) {
                bail!("CAPTION_PAGE_WINDOW_INVALID: line windows overlap");
            }
            previous_line_end = Some(span.1);
            line.display_span = Some(span);
        }
    }
    Ok(())
}
/// Geometry may change per sample, but the frozen line membership/window cannot.
pub(super) fn inherit_lines(target: &mut [Line], original: &[Line]) -> Result<()> {
    if !original.iter().any(|line| line.display_span.is_some()) {
        return Ok(());
    }
    if target.len() != original.len()
        || target
            .iter()
            .zip(original)
            .any(|(new, old)| new.bytes != old.bytes)
    {
        bail!("CAPTION_PAGE_WINDOW_INVALID: sampled line membership changed");
    }
    for (new, old) in target.iter_mut().zip(original) {
        new.display_span = old.display_span;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    fn config() -> PageWindow {
        serde_json::from_value(json!({"gapThreshold":{"ticks":1000,"timescale":1000},"shortGap":{"before":0.5,"after":0.5},"longGap":{"before":0.25,"after":0.25},"boundary":"first-start-inclusive-end-inclusive"})).unwrap()
    }
    fn words(spans: &[(f64, f64)]) -> Vec<Word> {
        spans
            .iter()
            .enumerate()
            .map(|(i, span)| Word {
                id: format!("w{i}"),
                bytes: i * 2..i * 2 + 1,
                span: Some(*span),
                input_timed: true,
                run_start: false,
            })
            .collect()
    }
    #[test]
    fn short_long_and_equal_threshold_use_explicit_ratios_and_shared_fractional_cut() {
        let raw = words(&[(0.1, 0.3), (0.7, 0.9), (2.3, 2.5), (2.9, 3.1)]);
        let packed = packed_spans(&raw, "A B C D", &config()).unwrap();
        for (actual, expected) in
            packed
                .iter()
                .zip([(0.1, 0.5), (0.5, 1.25), (1.95, 2.7), (2.7, 3.1)])
        {
            assert!((actual.0 - expected.0).abs() < 1e-12);
            assert!((actual.1 - expected.1).abs() < 1e-12);
        }
        assert_eq!(packed[0].1.to_bits(), packed[1].0.to_bits());
        assert_eq!(
            raw[0].span,
            Some((0.1, 0.3)),
            "raw timing must not be changed"
        );
        let equal = packed_spans(&words(&[(0.1, 0.3), (1.3, 1.5)]), "A B", &config()).unwrap();
        assert!((equal[0].1 - 0.8).abs() < 1e-12);
        let long =
            packed_spans(&words(&[(0.1, 0.3), (1.300000001, 1.5)]), "A B", &config()).unwrap();
        assert!(long[0].1 < 0.6);
        let mut one_sided = config();
        one_sided.short_gap = GapRatios {
            before: 0.,
            after: 1.,
        };
        let result = packed_spans(&words(&[(0.1, 0.3), (0.7, 0.9)]), "A B", &one_sided).unwrap();
        assert_eq!(result[0].1.to_bits(), result[1].0.to_bits());
        assert_eq!(result[1].0, 0.7);
    }
    fn body() -> Value {
        serde_json::from_str(include_str!(
            "../../../caption-scene/tests/fixtures/page-window.json"
        ))
        .unwrap()
    }
    fn plan(mut body: Value, spans: &[(f64, f64)]) -> Result<ScenePlan> {
        body["scene"]["value"]["layout"]["width"] = json!({"value":140,"basis":"absolute"});
        let tokens = ["Alpha", "Beta", "Gamma", "Delta"];
        let cue = SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: tokens[..spans.len()].join(" "),
            start: 0.,
            end: 4.,
            words: spans
                .iter()
                .enumerate()
                .map(|(i, (start, end))| SceneWord {
                    id: format!("w{i}"),
                    text: tokens[i].into(),
                    start: *start,
                    end: *end,
                })
                .collect(),
        };
        ScenePlan::compile(
            parse_style(&body).unwrap(),
            Presentation::default(),
            vec![cue],
            (160, 90),
            TextEngine::with_document_fonts(&[include_bytes!(
                "../../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
            )
            .to_vec()]),
            "window-instance".into(),
        )
    }
    fn resolved(plan: &mut ScenePlan, t: f64, reflow: bool) -> Vec<(Unit, Option<Line>)> {
        let scene = plan.style.scene();
        let params = parameters(scene, &[]).unwrap();
        resolved_units(
            &mut plan.text,
            &plan.layouts,
            0,
            &plan.cues[0],
            scene,
            reflow,
            t,
            &params,
            &plan.presentation,
            &plan.instance_id,
            (160, 90),
            &mut Budget::default(),
        )
        .unwrap()
        .remove("caption")
        .unwrap_or_default()
    }
    #[test]
    fn endpoint_ownership_includes_earlier_end_but_excludes_later_isolated_start() {
        let mut p = plan(body(), &[(0.1, 0.3), (0.7, 0.9), (2.3, 2.5)]).unwrap();
        let pages = p.layouts[&(0, "caption".into())].pages.clone();
        let index = |units: Vec<(Unit, Option<Line>)>| {
            units
                .iter()
                .find(|(u, _)| u.kind == UnitKind::Page)
                .map(|(u, _)| u.page_index)
        };
        assert_eq!(index(resolved(&mut p, 0.1, false)), Some(0));
        assert_eq!(index(resolved(&mut p, pages[0].end, false)), Some(0));
        assert_eq!(
            index(resolved(&mut p, pages[1].start + 1e-9, false)),
            Some(1)
        );
        assert_eq!(
            index(resolved(
                &mut p,
                (pages[1].end + pages[2].start) / 2.,
                false
            )),
            None
        );
        assert_eq!(index(resolved(&mut p, pages[2].start, false)), None);
        assert_eq!(
            index(resolved(&mut p, pages[2].start + 1e-9, false)),
            Some(2)
        );
        assert_eq!(index(resolved(&mut p, pages[2].end, false)), Some(2));
        assert_eq!(index(resolved(&mut p, pages[2].end + 1e-9, false)), None);
        let mut half = body();
        half["scene"]["value"]["layout"]["pageWindow"]["boundary"] =
            json!("start-inclusive-end-exclusive");
        let mut half = plan(half, &[(0.1, 0.3), (0.7, 0.9), (2.3, 2.5)]).unwrap();
        assert_eq!(index(resolved(&mut half, pages[0].end, false)), Some(1));
        assert_eq!(index(resolved(&mut half, pages[2].start, false)), Some(2));
    }
    #[test]
    fn packed_page_and_line_clocks_leave_words_and_input_boundaries_unchanged_after_reflow() {
        let mut p = plan(body(), &[(0.1, 0.3), (0.7, 0.9), (2.3, 2.5)]).unwrap();
        for reflow in [false, true] {
            let units = resolved(&mut p, 0.6, reflow);
            let line = &units
                .iter()
                .find(|(u, _)| u.kind == UnitKind::Line)
                .unwrap()
                .0;
            assert_eq!(line.spans[&UnitKind::Line], (0.5, 1.25));
            let word = &units
                .iter()
                .find(|(u, _)| u.kind == UnitKind::Word)
                .unwrap()
                .0;
            assert_eq!(word.spans[&UnitKind::Word], (0.7, 0.9));
            assert_eq!(word.page_input.first_start, Some(0.7));
            assert_eq!(word.page_last_word_span, Some((0.7, 0.9)));
            let grapheme = &units
                .iter()
                .find(|(u, _)| u.kind == UnitKind::Grapheme && !u.whitespace)
                .unwrap()
                .0;
            assert_eq!(grapheme.spans[&UnitKind::Grapheme], (0.7, 0.9));
        }
    }
    #[test]
    fn invalid_input_timing_is_rejected_instead_of_patched() {
        for spans in [
            &[(0.1, 0.4), (0.3, 0.7)][..],
            &[(0.5, 0.6), (0.1, 0.2)][..],
            &[(0.1, 0.1), (0.3, 0.7)][..],
        ] {
            assert!(
                plan(body(), spans)
                    .err()
                    .unwrap()
                    .to_string()
                    .contains("CAPTION_PAGE_WINDOW_INVALID")
            );
        }
        let mut raw = words(&[(0.1, 0.3)]);
        raw[0].input_timed = false;
        assert!(packed_spans(&raw, "A", &config()).is_err());
        raw[0].input_timed = true;
        assert!(packed_spans(&raw, " ", &config()).is_err());
        let missing = SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: "Alpha".into(),
            start: 0.,
            end: 4.,
            words: vec![],
        };
        assert!(
            ScenePlan::compile(
                parse_style(&body()).unwrap(),
                Presentation::default(),
                vec![missing],
                (160, 90),
                TextEngine::with_document_fonts(&[include_bytes!(
                    "../../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
                )
                .to_vec()]),
                "missing".into()
            )
            .err()
            .unwrap()
            .to_string()
            .contains("CAPTION_PAGE_WINDOW_INVALID")
        );
    }
    #[test]
    fn rendering_hides_gaps_and_cue_end_and_is_seek_deterministic() {
        let spans = [(0.1, 0.3), (0.7, 0.9), (2.3, 2.5)];
        let b = body();
        let mut p = plan(b.clone(), &spans).unwrap();
        for t in [0., 1.5, 3., 4.] {
            assert!(p.render(t).unwrap().rgba.iter().all(|v| *v == 0));
        }
        assert!(p.render(0.6).unwrap().rgba.iter().any(|v| *v != 0));
        for t in [0.6, 2.1, 0.5, 0.1, 0.6] {
            assert_eq!(
                p.render(t).unwrap().rgba,
                plan(b.clone(), &spans).unwrap().render(t).unwrap().rgba
            );
        }
        let mut ends_at_cue = plan(b, &[(0.1, 4.)]).unwrap();
        assert!(ends_at_cue.render(4.).unwrap().rgba.iter().all(|v| *v == 0));
    }
}
