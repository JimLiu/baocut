//! `caption-line-slots/1`: rolling single-row pages stacked on `count` slots.
//!
//! Page `k` is the global line index. It sits in slot `k mod count` (slot 0 topmost), shifted
//! from the layout centre by `(slot - (count - 1) / 2) * pitch * H` pixels, where `H` is the
//! line-box height of that single line. Its window starts at the page's own start and ends where
//! page `k + count` starts, or at the end of the last page when there is none, so neighbouring
//! windows overlap and up to `count` lines are visible together.
use super::*;

/// Vertical shift of page `index` in layout pixels (y grows downwards); `None` without slots.
pub(super) fn shift(cfg: &Layout, index: usize, line_height: f64) -> Result<Option<f64>> {
    let Some(slots) = cfg.pagination.line_slots else {
        return Ok(None);
    };
    let slot = (index % slots.count) as f64;
    let offset = (slot - (slots.count as f64 - 1.0) / 2.0) * slots.pitch * line_height;
    if !offset.is_finite() {
        bail!("CAPTION_LAYOUT_INVALID: line slot offset");
    }
    Ok(Some(offset))
}

/// Stretches every window to the start of the page `count` places later. This must follow
/// `page_window::apply`, which rejects overlapping windows. A line's display span is a window
/// only when a page window produced one; without it the line keeps the span of its words.
pub(super) fn extend_windows(pages: &mut [Page], count: usize) {
    let starts = pages.iter().map(|page| page.start).collect::<Vec<_>>();
    let last_end = pages.last().map_or(0.0, |page| page.end);
    for (index, page) in pages.iter_mut().enumerate() {
        let end = starts
            .get(index + count)
            .copied()
            .unwrap_or(last_end)
            .max(page.end);
        page.end = end;
        for line in &mut page.lines {
            if let Some(span) = &mut line.display_span {
                span.1 = span.1.max(end);
            }
        }
    }
}

/// Pages shown at `seconds`, in page order. Without slots this is the first page whose window
/// contains the time, exactly as before. With slots it is every such page, unless the time lies
/// in a hidden gap of the page window: a gap between two consecutive packed word spans draws
/// nothing, lingering lines included. (Without slots a gap inside one page keeps showing, since
/// that page's window runs from its first packed start to its last packed end.)
pub(super) fn active_pages(scene: &Scene, layout: &TextLayout, seconds: f64) -> Vec<usize> {
    let window = scene.layout.page_window.as_ref();
    let contains =
        |(index, page): &(usize, &Page)| page_window::contains(window, page, *index, seconds);
    let mut pages = layout.pages.iter().enumerate();
    if scene.layout.pagination.line_slots.is_none() {
        return pages
            .find(contains)
            .map(|(index, _)| index)
            .into_iter()
            .collect();
    }
    if page_window::hidden(window, &layout.hidden, seconds) {
        return Vec::new();
    }
    pages.filter(contains).map(|(index, _)| index).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    const FONT: &[u8] =
        include_bytes!("../../../render-raster/assets/fonts/NotoSansSC-Variable.ttf");

    fn style(pagination: Value, window: Option<Value>) -> Value {
        let mut caps = vec!["caption-word-line-layout/1", "caption-line-slots/1"];
        let mut layout = json!({
            "width": {"value": 140, "basis": "absolute"}, "x": {"value": 80, "basis": "absolute"},
            "y": {"value": 45, "basis": "absolute"}, "maxLines": 2, "overflow": "visible",
            "leadingGap": "hide", "pagination": pagination
        });
        if let Some(window) = window {
            caps.push("caption-page-window/1");
            layout["pageWindow"] = window;
        }
        json!({"schema": "baocut.caption-scene-style/1", "scene": {"kind": "inline", "value": {
            "schema": "baocut.caption-scene/1", "evaluationVersion": 1,
            "requiredCapabilities": caps,
            "speechState": {"timingPolicy": "require-word-timing"},
            "layout": layout,
            "nodes": [{"id": "text", "type": "text", "style": {"fontSize": {"value": 12, "basis": "absolute"}, "lineHeight": 1.25}}]
        }}})
    }
    fn window() -> Value {
        json!({"gapThreshold": {"ticks": 1000, "timescale": 1000},
            "shortGap": {"before": 0.0, "after": 1.0}, "longGap": {"before": 0.0, "after": 0.5},
            "boundary": "start-inclusive-end-exclusive"})
    }
    /// Words spanning `[start, end)` milliseconds, labelled `w1`, `w2`, ...
    fn plan(body: Value, spans: &[(u32, u32)], tags: &[(&str, &str)]) -> ScenePlan {
        let words = spans
            .iter()
            .enumerate()
            .map(|(i, (start, end))| SceneWord {
                id: format!("w{}", i + 1),
                text: format!("W{}", i + 1),
                start: f64::from(*start) / 1000.0,
                end: f64::from(*end) / 1000.0,
            })
            .collect::<Vec<_>>();
        let presentation = Presentation {
            word_tags: tags
                .iter()
                .map(|(id, tag)| ((*id).to_string(), vec![(*tag).to_string()]))
                .collect(),
            ..Presentation::default()
        };
        let text = words
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let end = words.last().unwrap().end;
        ScenePlan::compile(
            parse_style(&body).unwrap(),
            presentation,
            vec![SceneCue {
                id: "cue".into(),
                document_id: "doc".into(),
                start: 0.0,
                end,
                text,
                words,
            }],
            (160, 90),
            TextEngine::with_document_fonts(&[FONT.to_vec()]),
            "id".into(),
        )
        .unwrap()
    }
    fn contiguous(count: u32) -> Vec<(u32, u32)> {
        (0..count).map(|i| (i * 400, (i + 1) * 400)).collect()
    }
    fn resolved(plan: &mut ScenePlan, t: f64) -> Vec<(Unit, Option<Line>)> {
        resolved_with(plan, t, false)
    }
    fn resolved_with(plan: &mut ScenePlan, t: f64, reflow: bool) -> Vec<(Unit, Option<Line>)> {
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
        .remove("text")
        .unwrap_or_default()
    }
    /// Starting word numbers (`W<n>`) and top y of each visible line, in unit order.
    fn lines(plan: &mut ScenePlan, t: f64) -> Vec<(usize, f64)> {
        lines_with(plan, t, false)
    }
    fn lines_with(plan: &mut ScenePlan, t: f64, reflow: bool) -> Vec<(usize, f64)> {
        let content = plan.layouts[&(0, "text".to_string())].content.clone();
        resolved_with(plan, t, reflow)
            .into_iter()
            .filter(|(unit, _)| unit.kind == UnitKind::Line)
            .map(|(unit, line)| {
                let first = content[unit.bytes.clone()]
                    .trim_start_matches('W')
                    .split(' ')
                    .next()
                    .unwrap()
                    .parse()
                    .unwrap();
                (first, line.unwrap().bounds.y)
            })
            .collect()
    }
    fn two_slots() -> Value {
        style(
            json!({"wordLinePattern": [[3]], "lineSlots": {"count": 2, "pitch": 1.4}}),
            None,
        )
    }

    #[test]
    fn windows_overlap_until_the_page_count_places_later_starts() {
        let mut plan = plan(two_slots(), &contiguous(14), &[]);
        let layout = &plan.layouts[&(0, "text".to_string())];
        let windows = layout
            .pages
            .iter()
            .map(|page| (page.start, page.end))
            .collect::<Vec<_>>();
        assert_eq!(
            windows,
            vec![(0.0, 2.4), (1.2, 3.6), (2.4, 4.8), (3.6, 5.6), (4.8, 5.6)]
        );
        assert!(layout.hidden.is_empty());
        let first =
            |plan: &mut ScenePlan, t| lines(plan, t).iter().map(|l| l.0).collect::<Vec<_>>();
        assert_eq!(first(&mut plan, 2.0), vec![1, 4]);
        assert_eq!(first(&mut plan, 2.5), vec![4, 7]);
        assert_eq!(first(&mut plan, 5.0), vec![10, 13]);
        assert_eq!(first(&mut plan, 0.2), vec![1]);
    }

    #[test]
    fn slots_alternate_by_global_line_index_around_the_layout_centre() {
        let mut plan = plan(two_slots(), &contiguous(14), &[]);
        let row = 12.0 * 1.25;
        let at_2000 = lines(&mut plan, 2.0);
        let at_2500 = lines(&mut plan, 2.5);
        let at_5000 = lines(&mut plan, 5.0);
        // The single line is centred on y = 45 when it has no shift: top = 45 - row / 2.
        let centre = 45.0 - row / 2.0;
        let up = centre - 0.7 * row;
        let down = centre + 0.7 * row;
        let near = |a: f64, b: f64| (a - b).abs() < 1e-9;
        // Pages 0 and 1 are slots 0 and 1: line 1 above line 4.
        assert!(
            near(at_2000[0].1, up) && near(at_2000[1].1, down),
            "{at_2000:?}"
        );
        // Page 2 returns to the top slot above page 1.
        assert!(
            near(at_2500[0].1, down) && near(at_2500[1].1, up),
            "{at_2500:?}"
        );
        // Page 4 is slot 0 again.
        assert!(
            near(at_5000[0].1, down) && near(at_5000[1].1, up),
            "{at_5000:?}"
        );
        assert!(at_2500[1].1 < at_2500[0].1);
    }

    #[test]
    fn three_slots_are_centred_and_the_pitch_is_a_line_height_multiple() {
        let body = style(
            json!({"wordLinePattern": [[1]], "lineSlots": {"count": 3, "pitch": 1.0}}),
            None,
        );
        let mut plan = plan(body, &contiguous(5), &[]);
        let row = 12.0 * 1.25;
        let centre = 45.0 - row / 2.0;
        // Pages 0..=2 are all visible at t = 1.0 s? Page 0 [0, 1.2), 1 [0.4, 1.6), 2 [0.8, 2.0).
        let shown = lines(&mut plan, 1.0);
        assert_eq!(shown.iter().map(|l| l.0).collect::<Vec<_>>(), vec![1, 2, 3]);
        for (slot, (_, y)) in shown.iter().enumerate() {
            assert!(
                (y - (centre + (slot as f64 - 1.0) * row)).abs() < 1e-9,
                "{shown:?}"
            );
        }
    }

    #[test]
    fn units_keep_global_context_and_one_root() {
        let mut plan = plan(two_slots(), &contiguous(14), &[]);
        let units = resolved(&mut plan, 2.5);
        assert_eq!(
            units
                .iter()
                .filter(|(u, _)| u.kind == UnitKind::Cue)
                .count(),
            1
        );
        assert_eq!(units[0].0.kind, UnitKind::Cue);
        let pages = units
            .iter()
            .filter(|(u, _)| u.kind == UnitKind::Page)
            .map(|(u, _)| (u.index, u.count, u.spans[&UnitKind::Page]))
            .collect::<Vec<_>>();
        assert_eq!(pages, vec![(1, 5, (1.2, 3.6)), (2, 5, (2.4, 4.8))]);
        let words = units
            .iter()
            .filter(|(u, _)| u.kind == UnitKind::Word)
            .map(|(u, _)| u.word_position.unwrap())
            .collect::<Vec<_>>();
        assert_eq!(words, vec![3, 4, 5, 6, 7, 8]);
    }

    #[test]
    fn a_page_window_gap_hides_everything_including_lingering_lines() {
        let spans = [(0, 400), (400, 800), (3000, 3400), (3400, 3800)];
        let body = style(
            json!({"wordLinePattern": [[3]], "lineSlots": {"count": 2, "pitch": 1.4}}),
            Some(window()),
        );
        let mut plan = plan(body, &spans, &[]);
        let layout = &plan.layouts[&(0, "text".to_string())];
        assert_eq!(layout.hidden.len(), 1);
        assert!((layout.hidden[0].0 - 1.9).abs() < 1e-9 && layout.hidden[0].1 == 3.0);
        assert_eq!(layout.pages.len(), 2);
        let first =
            |plan: &mut ScenePlan, t| lines(plan, t).iter().map(|l| l.0).collect::<Vec<_>>();
        assert_eq!(first(&mut plan, 1.0), vec![1]);
        // Page 0 still lingers in its window, but the gap draws nothing.
        assert!(resolved(&mut plan, 2.0).is_empty());
        assert!(resolved(&mut plan, 1.95).is_empty());
        assert!(resolved(&mut plan, 2.999).is_empty());
        assert_eq!(first(&mut plan, 1.85), vec![1]);
        assert_eq!(first(&mut plan, 3.0), vec![1]);
        assert_eq!(first(&mut plan, 3.5), vec![1, 4]);
    }

    #[test]
    fn an_isolated_keyword_line_takes_the_next_global_slot() {
        let mut body = style(
            json!({"wordLinePattern": [[3]], "lineSlots": {"count": 2, "pitch": 1.4},
                "isolation": [{"tag": "keyword", "mode": "line"}]}),
            None,
        );
        body["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-keyword-isolation/1"));
        let mut plan = plan(body, &contiguous(6), &[("w2", "keyword")]);
        let layout = &plan.layouts[&(0, "text".to_string())];
        // The keyword is alone on page 1, so the plain pages after it shift: [W1] [W2] [W3 W4 W5] [W6].
        let members = layout
            .pages
            .iter()
            .map(|p| p.words.clone())
            .collect::<Vec<_>>();
        assert_eq!(members, vec![vec![0], vec![1], vec![2, 3, 4], vec![5]]);
        let windows = layout
            .pages
            .iter()
            .map(|p| (p.start, p.end))
            .collect::<Vec<_>>();
        assert_eq!(
            windows,
            vec![(0.0, 0.8), (0.4, 2.0), (0.8, 2.4), (2.0, 2.4)]
        );
        let row = 12.0 * 1.25;
        let centre = 45.0 - row / 2.0;
        let (top, bottom) = (centre - 0.7 * row, centre + 0.7 * row);
        let near = |a: f64, b: f64| (a - b).abs() < 1e-9;
        // Pages 0 and 1: slots 0 and 1.
        let shown = lines(&mut plan, 0.5);
        assert_eq!(shown.iter().map(|l| l.0).collect::<Vec<_>>(), vec![1, 2]);
        assert!(
            near(shown[0].1, top) && near(shown[1].1, bottom),
            "{shown:?}"
        );
        // Pages 1 and 2: the isolated line stays in slot 1, the next plain line takes slot 0.
        let shown = lines(&mut plan, 1.0);
        assert_eq!(shown.iter().map(|l| l.0).collect::<Vec<_>>(), vec![2, 3]);
        assert!(
            near(shown[0].1, bottom) && near(shown[1].1, top),
            "{shown:?}"
        );
        // Pages 2 and 3: slots 0 and 1 again.
        let shown = lines(&mut plan, 2.2);
        assert_eq!(shown.iter().map(|l| l.0).collect::<Vec<_>>(), vec![3, 6]);
        assert!(
            near(shown[0].1, top) && near(shown[1].1, bottom),
            "{shown:?}"
        );
    }

    #[test]
    fn sampled_relayout_keeps_each_page_in_its_slot() {
        let mut plan = plan(two_slots(), &contiguous(14), &[]);
        for t in [2.0, 2.5, 5.0] {
            let prepared = lines(&mut plan, t);
            let sampled = lines_with(&mut plan, t, true);
            assert_eq!(prepared.len(), 2);
            assert_eq!(prepared.len(), sampled.len());
            for (a, b) in prepared.iter().zip(&sampled) {
                assert_eq!(a.0, b.0);
                assert!((a.1 - b.1).abs() < 1e-9, "{prepared:?} {sampled:?}");
            }
        }
    }

    #[test]
    fn unit_font_size_relayout_offsets_by_the_sampled_line_height() {
        let mut body = two_slots();
        let scene = &mut body["scene"]["value"];
        scene["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-unit-font-size/1"));
        scene["selectors"] = json!([{"id": "pages", "nodeId": "text", "unit": "page"}]);
        scene["layout"]["layoutEvaluation"] = json!("per-sample");
        scene["layout"]["fontSizeBindings"] = json!([
            {"id": "size", "nodeId": "text", "selectorId": "pages", "value": {"kind": "constant", "value": 20}}
        ]);
        let mut plan = plan(body, &contiguous(14), &[]);
        let units = resolved_with(&mut plan, 2.5, true);
        let boxes = units
            .iter()
            .filter(|(u, _)| u.kind == UnitKind::Line)
            .map(|(_, line)| line.as_ref().unwrap().bounds)
            .collect::<Vec<_>>();
        assert_eq!(boxes.len(), 2);
        let height = boxes[0].height;
        assert!(height > 20.0 && (boxes[1].height - height).abs() < 1e-9);
        // Page 1 is in the lower slot and page 2 in the upper one, 1.4 line heights apart,
        // symmetric about the layout centre.
        assert!(
            (boxes[0].y - boxes[1].y - 1.4 * height).abs() < 1e-9,
            "{boxes:?}"
        );
        assert!(
            ((boxes[0].y + boxes[1].y + height) / 2.0 - 45.0).abs() < 1e-9,
            "{boxes:?}"
        );
    }
}
