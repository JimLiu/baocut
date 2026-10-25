//! Whole-cue indices and explicitly static word-selector membership.
use super::*;

struct Selection {
    ranks: Vec<Option<usize>>,
    count: usize,
}
pub(super) struct CueBindings {
    word_count: usize,
    line_prefix: usize,
    line_count: usize,
    selectors: BTreeMap<String, Selection>,
}
pub(super) fn enabled(scene: &Scene) -> bool {
    scene
        .required_capabilities
        .iter()
        .any(|c| c == "caption-cue-unit-context/1")
}
fn static_filter(filter: &Filter, budget: &mut Budget) -> Result<bool> {
    budget.spend()?;
    Ok(match filter {
        Filter::All | Filter::Tag { .. } => true,
        Filter::And { filters } | Filter::Or { filters } => {
            for f in filters {
                if !static_filter(f, budget)? {
                    return Ok(false);
                }
            }
            true
        }
        Filter::Not { filter } => static_filter(filter, budget)?,
        _ => false,
    })
}
fn matches(filter: &Filter, tags: &[String], budget: &mut Budget) -> Result<bool> {
    budget.spend()?;
    Ok(match filter {
        Filter::All => true,
        Filter::Tag { value } => tags.contains(value),
        Filter::And { filters } => {
            for f in filters {
                if !matches(f, tags, budget)? {
                    return Ok(false);
                }
            }
            true
        }
        Filter::Or { filters } => {
            for f in filters {
                if matches(f, tags, budget)? {
                    return Ok(true);
                }
            }
            false
        }
        Filter::Not { filter } => !matches(filter, tags, budget)?,
        _ => false,
    })
}
pub(super) fn bind(
    scene: &Scene,
    node_id: &str,
    layout: &TextLayout,
    page_index: usize,
    units: &mut [(Unit, Option<Line>)],
    presentation: &Presentation,
    budget: &mut Budget,
) -> Result<()> {
    let mut line_count = 0;
    let mut line_prefix = 0;
    for (index, page) in layout.pages.iter().enumerate() {
        budget.spend()?;
        line_count += page.lines.len();
        if index < page_index {
            line_prefix += page.lines.len();
        }
    }
    let mut selectors = BTreeMap::new();
    for selector in scene
        .selectors
        .iter()
        .filter(|s| s.node_id == node_id && s.unit == UnitKind::Word)
    {
        if !static_filter(&selector.filter, budget)? {
            continue;
        }
        let mut ranks = Vec::with_capacity(layout.words.len());
        let mut count = 0;
        for word in &layout.words {
            budget.spend()?;
            let tags = presentation
                .word_tags
                .get(&word.id)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            if matches(&selector.filter, tags, budget)? {
                ranks.push(Some(count));
                count += 1;
            } else {
                ranks.push(None);
            }
        }
        selectors.insert(selector.id.clone(), Selection { ranks, count });
    }
    let bindings = Arc::new(CueBindings {
        word_count: layout.words.len(),
        line_prefix,
        line_count,
        selectors,
    });
    for (unit, _) in units {
        unit.cue_bindings = Some(bindings.clone());
    }
    Ok(())
}
pub(super) fn add_fields(context: &mut Context, unit: &Unit) {
    let word = unit
        .cue_bindings
        .as_ref()
        .and_then(|b| unit.word_position.map(|i| (i, b.word_count)));
    let line = unit.cue_bindings.as_ref().and_then(|b| {
        unit.line_position
            .map(|i| (b.line_prefix + i, b.line_count))
    });
    for (prefix, binding) in [("cueWord", word), ("cueLine", line)] {
        let (index, count) = binding.unwrap_or((0, 0));
        context.fields.insert(
            format!("unit.{prefix}Index"),
            Evaluated::Number(ValueType::Scalar, index as f64),
        );
        context.fields.insert(
            format!("unit.{prefix}Count"),
            Evaluated::Number(ValueType::Scalar, count as f64),
        );
        context.fields.insert(
            format!("unit.{prefix}Bound"),
            Evaluated::Bool(binding.is_some()),
        );
    }
}
pub(super) fn select(context: &mut Context, unit: &Unit, selector_id: Option<&str>) {
    let selected = unit
        .cue_bindings
        .as_ref()
        .and_then(|bindings| selector_id.and_then(|id| bindings.selectors.get(id)))
        .and_then(|selection| {
            unit.word_position
                .and_then(|word| selection.ranks.get(word).copied().flatten())
                .map(|rank| (rank, selection.count))
        });
    let (index, count) = selected.unwrap_or((0, 0));
    context.fields.insert(
        "unit.cueSelectedIndex".into(),
        Evaluated::Number(ValueType::Scalar, index as f64),
    );
    context.fields.insert(
        "unit.cueSelectedCount".into(),
        Evaluated::Number(ValueType::Scalar, count as f64),
    );
    context.fields.insert(
        "unit.cueSelectionAvailable".into(),
        Evaluated::Bool(selected.is_some()),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn body() -> serde_json::Value {
        json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
            "schema":"baocut.caption-scene/1","evaluationVersion":1,"requiredCapabilities":["caption-cue-unit-context/1"],
            "layout":{"width":{"value":120,"basis":"absolute"},"x":{"value":80,"basis":"absolute"},"y":{"value":45,"basis":"absolute"},
                "maxLines":4,"overflow":"visible","pagination":{"maxUnitsPerPage":2}},
            "nodes":[{"id":"text","type":"text","style":{"fontSize":{"value":12,"basis":"absolute"}}}],
            "selectors":[{"id":"all","nodeId":"text","unit":"word"},
                {"id":"keyword","nodeId":"text","unit":"word","filter":{"kind":"tag","value":"keyword"}},
                {"id":"boolean","nodeId":"text","unit":"word","filter":{"kind":"and","filters":[{"kind":"all"},{"kind":"tag","value":"keyword"},{"kind":"not","filter":{"kind":"tag","value":"other"}}]}},
                {"id":"state","nodeId":"text","unit":"word","filter":{"kind":"state","value":"active"}},
                {"id":"range","nodeId":"text","unit":"word","filter":{"kind":"range","start":0,"end":1}},
                {"id":"parity","nodeId":"text","unit":"word","filter":{"kind":"parity","odd":false}},
                {"id":"combined","nodeId":"text","unit":"word","filter":{"kind":"or","filters":[{"kind":"all"},{"kind":"state","value":"active"}]}}]
        }}})
    }
    fn plan(body: serde_json::Value) -> ScenePlan {
        let words = ["AA", "BB", "CC", "DD", "EE", "FF"]
            .iter()
            .enumerate()
            .map(|(i, w)| SceneWord {
                id: format!("w{i}"),
                text: (*w).into(),
                start: i as f64,
                end: i as f64 + 0.7,
            })
            .collect();
        let presentation = serde_json::from_value(
            json!({"wordTags":{"w1":["keyword"],"w4":["keyword"],"w5":["keyword","other"]}}),
        )
        .unwrap();
        ScenePlan::compile(
            parse_style(&body).unwrap(),
            presentation,
            vec![SceneCue {
                id: "cue".into(),
                document_id: "doc".into(),
                text: "AA BB CC DD EE FF".into(),
                start: 0.0,
                end: 6.0,
                words,
            }],
            (160, 90),
            TextEngine::with_document_fonts(&[include_bytes!(
                "../../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
            )
            .to_vec()]),
            "test".into(),
        )
        .unwrap()
    }
    fn units(
        plan: &mut ScenePlan,
        scene: &Scene,
        t: f64,
        reflow: bool,
        budget: &mut Budget,
    ) -> Result<BTreeMap<String, Vec<(Unit, Option<Line>)>>> {
        resolved_units(
            &mut plan.text,
            &plan.layouts,
            0,
            &plan.cues[0],
            scene,
            reflow,
            t,
            &BTreeMap::new(),
            &plan.presentation,
            &plan.instance_id,
            (160, 90),
            budget,
        )
    }
    #[test]
    fn cue_word_and_line_indices_survive_hidden_pages_and_sampled_reflow() {
        let mut p = plan(body());
        let base = p.style.scene().clone();
        let normal = units(&mut p, &base, 4.2, false, &mut Budget::default()).unwrap();
        let word = &normal["text"]
            .iter()
            .find(|(u, _)| u.kind == UnitKind::Word && u.id == "w4")
            .unwrap()
            .0;
        let mut c = Context::default();
        add_fields(&mut c, word);
        assert_eq!(c.fields["unit.cueWordIndex"].number().unwrap(), 4.0);
        assert_eq!(c.fields["unit.cueWordCount"].number().unwrap(), 6.0);
        assert_eq!(c.fields["unit.cueLineIndex"].number().unwrap(), 2.0);
        assert_eq!(c.fields["unit.cueLineCount"].number().unwrap(), 3.0);
        let mut narrow = base.clone();
        narrow.layout.width.value = 18.0;
        for (t, prefix) in [(0.2, 0), (4.2, 4)] {
            let current = units(&mut p, &narrow, t, true, &mut Budget::default()).unwrap();
            for (u, _) in &current["text"] {
                let mut c = Context::default();
                add_fields(&mut c, u);
                if let Some(line) = u.line_position {
                    assert_eq!(
                        c.fields["unit.cueLineIndex"].number().unwrap(),
                        (prefix + line) as f64
                    );
                    assert_eq!(
                        c.fields["unit.cueLineCount"].number().unwrap(),
                        6.0,
                        "future pages also use this sampled width"
                    );
                } else {
                    assert!(!c.fields["unit.cueLineBound"].boolean().unwrap());
                    assert_eq!(c.fields["unit.cueLineCount"].number().unwrap(), 0.0);
                }
                if u.whitespace {
                    assert!(!c.fields["unit.cueWordBound"].boolean().unwrap());
                }
            }
        }
    }
    #[test]
    fn cue_selected_ordinals_use_only_real_tags_and_supported_static_filters() {
        let mut p = plan(body());
        let scene = p.style.scene().clone();
        let current = units(&mut p, &scene, 4.2, false, &mut Budget::default()).unwrap();
        let word = &current["text"]
            .iter()
            .find(|(u, _)| u.kind == UnitKind::Word && u.id == "w4")
            .unwrap()
            .0;
        let mut c = Context::default();
        select(&mut c, word, Some("keyword"));
        assert!(c.fields["unit.cueSelectionAvailable"].boolean().unwrap());
        assert_eq!(c.fields["unit.cueSelectedIndex"].number().unwrap(), 1.0);
        assert_eq!(c.fields["unit.cueSelectedCount"].number().unwrap(), 3.0);
        select(&mut c, word, Some("boolean"));
        assert_eq!(c.fields["unit.cueSelectedCount"].number().unwrap(), 2.0);
        for invalid in [
            None,
            Some("state"),
            Some("range"),
            Some("parity"),
            Some("combined"),
        ] {
            select(&mut c, word, invalid);
            assert!(!c.fields["unit.cueSelectionAvailable"].boolean().unwrap());
            assert_eq!(c.fields["unit.cueSelectedIndex"].number().unwrap(), 0.0);
            assert_eq!(c.fields["unit.cueSelectedCount"].number().unwrap(), 0.0);
        }
        p.presentation.word_tags.clear();
        let untagged = units(&mut p, &scene, 4.2, false, &mut Budget::default()).unwrap();
        let word = &untagged["text"]
            .iter()
            .find(|(u, _)| u.kind == UnitKind::Word && u.id == "w4")
            .unwrap()
            .0;
        select(&mut c, word, Some("keyword"));
        assert!(!c.fields["unit.cueSelectionAvailable"].boolean().unwrap());
    }
    #[test]
    fn repeated_decorations_inherit_global_selection_but_later_tracks_cannot_leak_it() {
        let mut body = body();
        let scene = &mut body["scene"]["value"];
        scene["nodes"].as_array_mut().unwrap().push(json!({"id":"decorations","type":"repeat","selectorId":"keyword","children":[{
            "id":"mark","type":"shape","properties":{"width":{"kind":"expression","expression":{"op":"call","function":"mul","args":[{"op":"literal","type":"length","value":2},{"op":"read","path":"unit.cueSelectedCount"}]}},"height":{"kind":"constant","value":2}}}]}));
        scene["animations"] = json!([
            {"id":"global-rank","target":{"nodeId":"text","selectorId":"keyword"},"property":"transform.x","composite":"replace","value":{"kind":"expression","expression":{"op":"call","function":"mul","args":[{"op":"literal","type":"length","value":10},{"op":"read","path":"unit.cueSelectedIndex"}]}}},
            {"id":"range-no-global","target":{"nodeId":"text","selectorId":"range"},"property":"opacity","composite":"replace","priority":1,"value":{"kind":"expression","expression":{"op":"if","condition":{"op":"read","path":"unit.cueSelectionAvailable"},"then":{"op":"literal","type":"scalar","value":0},"else":{"op":"literal","type":"scalar","value":1}}}}
        ]);
        let mut p = plan(body);
        let scene = p.style.scene().clone();
        let current = units(&mut p, &scene, 4.2, false, &mut Budget::default()).unwrap();
        let word = &current["text"]
            .iter()
            .find(|(u, _)| u.kind == UnitKind::Word && u.id == "w4")
            .unwrap()
            .0;
        let params = BTreeMap::new();
        let images = BTreeMap::new();
        let r = RenderContext {
            paint_viewport: None,
            scene: &scene,
            units: &current,
            params: &params,
            seconds: 4.2,
            seed: 0,
            instance: "test",
            cue: &p.cues[0],
            size: (160, 90),
            images: &images,
        };
        let pose = pose(&scene.nodes[0], word, &r, &mut Budget::default()).unwrap();
        assert_eq!(pose["transform.x"].number().unwrap(), 10.0);
        assert_eq!(pose["opacity"].number().unwrap(), 1.0);
        let (ops, _) = p.record(4.2).unwrap();
        let widths = ops
            .ops
            .iter()
            .filter_map(|op| {
                if let DrawOp::FillRect { w, .. } = op {
                    Some(*w)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        assert_eq!(widths, vec![6.0, 6.0]);
    }
    #[test]
    fn whole_cue_reflow_and_filter_work_are_budgeted_and_legacy_stays_on_one_page() {
        let mut p = plan(body());
        let mut scene = p.style.scene().clone();
        scene.layout.width.value = 18.0;
        let error = units(&mut p, &scene, 4.2, true, &mut Budget::new(12))
            .err()
            .unwrap()
            .to_string();
        assert!(error.contains("CAPTION_BUDGET_EXCEEDED"));
        scene.required_capabilities.clear();
        let old = units(&mut p, &scene, 4.2, true, &mut Budget::new(12)).unwrap();
        assert!(old["text"].iter().all(|(u, _)| u.cue_bindings.is_none()));
        let scene = p.style.scene().clone();
        let error = units(&mut p, &scene, 4.2, false, &mut Budget::new(4))
            .err()
            .unwrap()
            .to_string();
        assert!(error.contains("CAPTION_BUDGET_EXCEEDED"));
    }

    #[test]
    fn split_word_and_graphemes_keep_one_cue_word_ordinal_across_pages() {
        let mut body = body();
        body["scene"]["value"]["layout"]["width"] = json!({"value":18,"basis":"absolute"});
        body["scene"]["value"]["layout"]["maxLines"] = json!(1);
        body["scene"]["value"]["selectors"] = json!([]);
        let mut p = ScenePlan::compile(
            parse_style(&body).unwrap(),
            Presentation::default(),
            vec![SceneCue {
                id: "cue".into(),
                document_id: "doc".into(),
                text: "AAAAAA".into(),
                start: 0.0,
                end: 3.0,
                words: vec![SceneWord {
                    id: "whole".into(),
                    text: "AAAAAA".into(),
                    start: 0.0,
                    end: 3.0,
                }],
            }],
            (160, 90),
            TextEngine::with_document_fonts(&[include_bytes!(
                "../../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
            )
            .to_vec()]),
            "test".into(),
        )
        .unwrap();
        let times = p.layouts[&(0, "text".into())]
            .pages
            .iter()
            .map(|page| (page.start + page.end) / 2.0)
            .collect::<Vec<_>>();
        assert!(times.len() > 1);
        let scene = p.style.scene().clone();
        for (page, t) in times.iter().enumerate() {
            let current = units(&mut p, &scene, *t, false, &mut Budget::default()).unwrap();
            for (u, _) in &current["text"] {
                if !matches!(u.kind, UnitKind::Word | UnitKind::Grapheme) || u.whitespace {
                    continue;
                }
                let mut c = Context::default();
                add_fields(&mut c, u);
                assert!(c.fields["unit.cueWordBound"].boolean().unwrap());
                assert_eq!(c.fields["unit.cueWordIndex"].number().unwrap(), 0.0);
                assert_eq!(c.fields["unit.cueWordCount"].number().unwrap(), 1.0);
                assert_eq!(c.fields["unit.cueLineIndex"].number().unwrap(), page as f64);
                assert_eq!(
                    c.fields["unit.cueLineCount"].number().unwrap(),
                    times.len() as f64
                );
            }
        }
    }
}
