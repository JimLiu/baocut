//! `caption-page-line-context/1`: every unit reads the current page's lines by static slot.
//!
//! `layout.pageLineBoxX.<k>` and `layout.pageLineBoxWidth.<k>` are line `k`'s advance/line-box
//! left edge and width in canvas pixels (the line unit's own `layout.x/width`, before animation
//! transforms); `unit.pageLineGraphemeCount.<k>` counts its non-whitespace extended graphemes.
//! Slots past the page's last line read zero.
use super::*;
use unicode_segmentation::UnicodeSegmentation;

#[derive(Debug, Default)]
pub(super) struct Lines {
    boxes: Vec<(f64, f64)>,
    graphemes: Vec<usize>,
}

pub(super) fn enabled(scene: &Scene) -> bool {
    scene
        .required_capabilities
        .iter()
        .any(|c| c == "caption-page-line-context/1")
}

fn measure(page: &Page, content: &str, budget: &mut Budget) -> Result<Lines> {
    let mut lines = Lines::default();
    for line in page.lines.iter().take(PAGE_LINE_SLOTS) {
        budget.spend()?;
        let mut count = 0;
        for grapheme in content
            .get(line.bytes.clone())
            .unwrap_or("")
            .graphemes(true)
        {
            budget.spend()?;
            if !grapheme.chars().all(char::is_whitespace) {
                count += 1;
            }
        }
        lines.boxes.push((line.bounds.x, line.bounds.width));
        lines.graphemes.push(count);
    }
    Ok(lines)
}

pub(super) fn bind(
    units: &mut [(Unit, Option<Line>)],
    page: &Page,
    content: &str,
    budget: &mut Budget,
) -> Result<()> {
    let lines = Arc::new(measure(page, content, budget)?);
    for (unit, _) in units {
        budget.spend()?;
        unit.page_lines = Some(lines.clone());
    }
    Ok(())
}

/// Inserts the slots a validated scene may read: one per line up to `maxLines`.
pub(super) fn add_fields(
    fields: &mut BTreeMap<String, Evaluated>,
    lines: Option<&Lines>,
    slots: usize,
) {
    for k in 0..slots.min(PAGE_LINE_SLOTS) {
        let (x, width) = lines
            .and_then(|l| l.boxes.get(k))
            .copied()
            .unwrap_or_default();
        let graphemes = lines.and_then(|l| l.graphemes.get(k)).copied().unwrap_or(0);
        fields.insert(
            format!("layout.pageLineBoxX.{k}"),
            Evaluated::Number(ValueType::Length, x),
        );
        fields.insert(
            format!("layout.pageLineBoxWidth.{k}"),
            Evaluated::Number(ValueType::Length, width),
        );
        fields.insert(
            format!("unit.pageLineGraphemeCount.{k}"),
            Evaluated::Number(ValueType::Scalar, graphemes as f64),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{
        Presentation, RenderContext, SceneCue, ScenePlan, SceneWord, UnitKind, context,
        cue_parameters, units_for,
    };

    fn body() -> serde_json::Value {
        serde_json::from_str(include_str!(
            "../../../caption-scene/tests/fixtures/page-line-context.json"
        ))
        .unwrap()
    }

    fn plan(text: &str) -> ScenePlan {
        plan_with(body(), text)
    }

    fn plan_with(body: serde_json::Value, text: &str) -> ScenePlan {
        let words: Vec<&str> = text.split(' ').collect();
        let step = 2.0 / words.len() as f64;
        let cue = SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: text.into(),
            start: 0.0,
            end: 2.0,
            words: words
                .iter()
                .enumerate()
                .map(|(i, word)| SceneWord {
                    id: format!("w{i}"),
                    text: (*word).into(),
                    start: i as f64 * step,
                    end: (i + 1) as f64 * step,
                })
                .collect(),
        };
        ScenePlan::compile(
            caption_scene::parse_style(&body).unwrap(),
            Presentation::default(),
            vec![cue],
            (320, 180),
            render_raster::TextEngine::with_document_fonts(&[include_bytes!(
                "../../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
            )
            .to_vec()]),
            "page-lines".into(),
        )
        .unwrap()
    }

    fn fields(plan: &ScenePlan) -> Vec<(UnitKind, BTreeMap<String, Evaluated>)> {
        let cue = &plan.cues[0];
        let scene = plan.style.scene();
        let params =
            cue_parameters(&plan.style, &plan.presentation, cue, &plan.instance_id).unwrap();
        let layout = plan.layouts.values().next().unwrap();
        let page = &layout.pages[0];
        let mut units = units_for(
            cue,
            layout,
            page,
            0.1,
            &scene.speech_state,
            &Presentation::default(),
        );
        bind(&mut units, page, &layout.content, &mut Budget::default()).unwrap();
        let r = RenderContext {
            paint_viewport: None,
            scene,
            units: &BTreeMap::new(),
            params: &params,
            seconds: 0.1,
            seed: 0,
            instance: "page-lines",
            cue,
            size: (320, 180),
            images: &BTreeMap::new(),
        };
        units
            .iter()
            .map(|(u, _)| (u.kind, context(u, &r).fields))
            .collect()
    }

    fn number(fields: &BTreeMap<String, Evaluated>, path: &str) -> f64 {
        fields[path].number().unwrap()
    }

    #[test]
    fn every_unit_reads_the_page_lines_by_slot_and_missing_slots_read_zero() {
        let plan = plan("Alpha be gamma");
        let layout = plan.layouts.values().next().unwrap();
        let page = &layout.pages[0];
        assert_eq!(page.lines.len(), 3, "fixture holds one word per line");
        let all = fields(&plan);
        let first = &all[0].1;
        for (k, line) in page.lines.iter().enumerate() {
            assert_eq!(
                number(first, &format!("layout.pageLineBoxX.{k}")),
                line.bounds.x
            );
            assert_eq!(
                number(first, &format!("layout.pageLineBoxWidth.{k}")),
                line.bounds.width
            );
        }
        assert_eq!(
            (0..3)
                .map(|k| number(first, &format!("unit.pageLineGraphemeCount.{k}")))
                .collect::<Vec<_>>(),
            [5.0, 2.0, 5.0],
            "whitespace is not counted"
        );
        assert_eq!(number(first, "layout.pageLineBoxWidth.3"), 0.0);
        assert_eq!(number(first, "unit.pageLineGraphemeCount.3"), 0.0);
        assert!(
            !first.contains_key("layout.pageLineBoxX.4"),
            "slots stop at maxLines"
        );
        for kind in [
            UnitKind::Cue,
            UnitKind::Page,
            UnitKind::Line,
            UnitKind::Word,
            UnitKind::Grapheme,
        ] {
            let same = all.iter().filter(|(k, _)| *k == kind).collect::<Vec<_>>();
            assert!(!same.is_empty(), "{kind:?}");
            for (_, f) in same {
                for k in 0..4 {
                    for field in [
                        "layout.pageLineBoxX",
                        "layout.pageLineBoxWidth",
                        "unit.pageLineGraphemeCount",
                    ] {
                        let path = format!("{field}.{k}");
                        assert_eq!(number(f, &path), number(first, &path), "{kind:?} {path}");
                    }
                }
            }
        }
    }

    fn resolved(plan: &mut ScenePlan, t: f64) -> Vec<(Unit, Option<Line>)> {
        let cue = &plan.cues[0];
        let params =
            cue_parameters(&plan.style, &plan.presentation, cue, &plan.instance_id).unwrap();
        let mut budget = Budget::default();
        let early = sampled_layout::early_context(
            cue,
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
        resolved_units(
            &mut plan.text,
            &plan.layouts,
            0,
            cue,
            scene,
            sampled.is_some(),
            t,
            &params,
            &plan.presentation,
            &plan.instance_id,
            (320, 180),
            &mut budget,
        )
        .unwrap()
        .remove("caption")
        .unwrap()
    }

    #[test]
    fn unit_sizes_read_sibling_graphemes_and_offsets_read_resized_boxes() {
        // The fixture doubles line 1 only when lines 0 and 1 hold equally many graphemes,
        // then right-aligns line 0 to line 1 and left-aligns line 2 to it.
        let mut equal = plan("Alpha bravo c");
        let mut unequal = plan("Alpha be c");
        let rows = |plan: &mut ScenePlan| {
            resolved(plan, 0.1)
                .into_iter()
                .filter(|(u, _)| u.kind == UnitKind::Line)
                .map(|(u, line)| (u, line.unwrap().bounds))
                .collect::<Vec<_>>()
        };
        let eq = rows(&mut equal);
        let ne = rows(&mut unequal);
        assert_eq!((eq.len(), ne.len()), (3, 3));
        assert!(
            eq[1].1.height > eq[0].1.height * 1.5,
            "equal counts double line 1"
        );
        assert!(
            (ne[1].1.height - ne[0].1.height).abs() < 1.0,
            "unequal counts keep line 1"
        );
        // Geometry slots see the resized middle line, not the frozen base row.
        let lines = eq[0].0.page_lines.as_deref().unwrap();
        assert_eq!(lines.boxes[1], (eq[1].1.x, eq[1].1.width));
        assert!(lines.boxes[1].1 > lines.boxes[0].1);
        let a = equal.render(0.1).unwrap().fingerprint;
        let b = unequal.render(0.1).unwrap().fingerprint;
        assert_ne!(a, b);
        let mut plain = body();
        plain["scene"]["value"]["animations"] = serde_json::json!([]);
        let mut unaligned = plan_with(plain, "Alpha bravo c");
        assert_ne!(
            unaligned.render(0.1).unwrap().fingerprint,
            a,
            "offsets move lines 0 and 2"
        );
    }

    #[test]
    fn missing_lines_read_zero() {
        let mut fields = BTreeMap::new();
        add_fields(&mut fields, None, 2);
        assert_eq!(fields.len(), 6);
        assert!(
            matches!(fields["layout.pageLineBoxWidth.1"], Evaluated::Number(ValueType::Length, v) if v == 0.0)
        );
    }
}
