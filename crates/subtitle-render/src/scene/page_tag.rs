//! `caption-page-tag/1`: every unit reads the integer tag of its word-line pattern page.
//!
//! Page `p` of a cue is built from pattern entry `p` modulo the pattern length, so it reads
//! the tag at the same position. A last-page rewrite keeps the rewritten page's position and
//! a tail join only removes the final page, so neither shifts the tags.
use super::*;

pub(super) fn add_fields(fields: &mut BTreeMap<String, Evaluated>, scene: &Scene, page_index: usize) {
    let Some(tags) = scene.layout.pagination.page_tags.as_deref().filter(|tags| !tags.is_empty()) else {
        return;
    };
    fields.insert(
        "unit.pageTag".into(),
        Evaluated::Number(ValueType::Scalar, f64::from(tags[page_index % tags.len()])),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{
        Presentation, RenderContext, SceneCue, ScenePlan, SceneWord, UnitKind, context, cue_parameters, resolved_units, sampled_layout,
        units_for,
    };

    fn body() -> serde_json::Value {
        serde_json::from_str(include_str!("../../../caption-scene/tests/fixtures/page-tag.json")).unwrap()
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
            "page-tags".into(),
        )
        .unwrap()
    }

    /// The tag every unit of each page reads, page by page.
    fn page_tags(plan: &ScenePlan) -> Vec<Vec<f64>> {
        let cue = &plan.cues[0];
        let scene = plan.style.scene();
        let params = cue_parameters(&plan.style, &plan.presentation, cue, &plan.instance_id).unwrap();
        let layout = plan.layouts.values().next().unwrap();
        let r = RenderContext {
            paint_viewport: None,
            scene,
            units: &BTreeMap::new(),
            params: &params,
            seconds: 0.1,
            seed: 0,
            instance: "page-tags",
            cue,
            size: (320, 180),
            images: &BTreeMap::new(),
        };
        layout
            .pages
            .iter()
            .map(|page| {
                let units = units_for(cue, layout, page, 0.1, &scene.speech_state, &Presentation::default());
                for kind in [UnitKind::Cue, UnitKind::Page, UnitKind::Line, UnitKind::Word, UnitKind::Grapheme] {
                    assert!(units.iter().any(|(u, _)| u.kind == kind), "{kind:?}");
                }
                units
                    .iter()
                    .map(|(u, _)| context(u, &r).fields["unit.pageTag"].number().unwrap())
                    .collect()
            })
            .collect()
    }

    #[test]
    fn every_unit_reads_its_page_tag_and_tags_cycle_with_the_pattern() {
        let plan = plan_with(body(), "a bb ccc dd e ff ggg h ii jj");
        let layout = plan.layouts.values().next().unwrap();
        let shape: Vec<(usize, usize)> = layout.pages.iter().map(|page| (page.words.len(), page.lines.len())).collect();
        assert_eq!(shape, [(1, 1), (2, 1), (2, 2), (1, 1), (2, 1), (2, 2)]);
        let tags = page_tags(&plan);
        for (page, expected) in tags.iter().zip([7.0, 0.0, 3.0, 7.0, 0.0, 3.0]) {
            assert!(page.iter().all(|tag| *tag == expected), "{page:?} != {expected}");
        }
    }

    fn line_heights(plan: &mut ScenePlan, t: f64) -> Vec<f64> {
        let cue = &plan.cues[0];
        let params = cue_parameters(&plan.style, &plan.presentation, cue, &plan.instance_id).unwrap();
        let mut budget = Budget::default();
        let early = sampled_layout::early_context(cue, 0, 1, t, &params, (320, 180), &plan.instance_id, &plan.presentation.seed).unwrap();
        let sampled = sampled_layout::sample_scene(plan.style.scene(), &early, t, &mut budget).unwrap();
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
        .into_iter()
        .filter(|(u, _)| u.kind == UnitKind::Line)
        .map(|(_, line)| line.unwrap().bounds.height)
        .collect()
    }

    #[test]
    fn font_size_bindings_read_the_tag_and_tags_are_absent_without_the_field() {
        // The fixture sizes lines of tag-7 pages at 32 px and the others at 16 px.
        let mut plan = plan_with(body(), "Alpha Bravo Charlie");
        let tagged = line_heights(&mut plan, 0.1);
        let plain = line_heights(&mut plan, 1.0);
        assert_eq!((tagged.len(), plain.len()), (1, 1));
        assert!(tagged[0] > plain[0] * 1.8, "{tagged:?} vs {plain:?}");
        assert_ne!(plan.render(0.1).unwrap().fingerprint, plan.render(1.0).unwrap().fingerprint);
        let mut fields = BTreeMap::new();
        let mut scene = caption_scene::parse_style(&body()).unwrap().scene().clone();
        scene.layout.pagination.page_tags = None;
        add_fields(&mut fields, &scene, 0);
        assert!(fields.is_empty());
    }
}
