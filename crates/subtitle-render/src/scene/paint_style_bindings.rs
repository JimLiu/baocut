//! Frozen semantic paint choices, recorded in one node's global layer order.
use super::*;
use std::borrow::Cow;

pub(super) fn applies(scene: &Scene, node: &Node) -> bool {
    scene
        .paint_style_bindings
        .iter()
        .any(|binding| binding.node_id == node.id)
}

pub(super) fn binding_index(
    scene: &Scene,
    node: &Node,
    word: &Unit,
    budget: &mut Budget,
) -> Result<Option<usize>> {
    for (index, binding) in scene.paint_style_bindings.iter().enumerate().rev() {
        budget.spend()?;
        if binding.node_id != node.id {
            continue;
        }
        let mut found = None;
        for selector in &scene.selectors {
            budget.spend()?;
            if selector.id == binding.selector_id {
                found = Some(selector);
                break;
            }
        }
        let Some(selector) = found else {
            continue;
        };
        if word.kind == selector.unit
            && (!word.whitespace || selector.include_whitespace)
            && unit_font_size::matches(&selector.filter, word, budget)?
        {
            return Ok(Some(index));
        }
    }
    Ok(None)
}

/// Scalar phase belongs to the same text view for all static paint choices.
/// An inactive image choice still requires a valid complete source-scalar map.
pub(super) fn phase_style<'a>(scene: &'a Scene, node: &'a Node) -> Cow<'a, TextStyle> {
    if image_paint::uses_phase(&node.style) {
        return Cow::Borrowed(&node.style);
    }
    for binding in scene
        .paint_style_bindings
        .iter()
        .filter(|binding| binding.node_id == node.id)
    {
        if binding
            .style
            .paints
            .iter()
            .any(|layer| matches!(layer.paint, ScenePaint::Image { phase: Some(_), .. }))
        {
            let mut style = node.style.clone();
            style.paints = binding.style.paints.clone();
            style.stroke = None;
            return Cow::Owned(style);
        }
    }
    Cow::Borrowed(&node.style)
}

/// Include inactive paint choices: their phase can become selected at a later sample.
pub(super) fn uses_page_phase(scene: &Scene, node: &Node) -> bool {
    let uses = |paints: &[PaintLayer]| {
        paints.iter().any(|layer| {
            matches!(
                layer.paint,
                ScenePaint::Image {
                    phase: Some(ImagePaintPhase {
                        source: ImagePaintPhaseSource::PageScalarIndex,
                        ..
                    }),
                    ..
                }
            )
        })
    };
    uses(&node.style.paints)
        || scene
            .paint_style_bindings
            .iter()
            .filter(|binding| binding.node_id == node.id)
            .any(|binding| uses(&binding.style.paints))
}

pub(super) fn record(
    node: &Node,
    scene: &Scene,
    glyphs: &[text_paint::GlyphPaint],
    choices: &[Option<usize>],
    canvas: (u32, u32),
    text: &mut TextEngine,
    images: &BTreeMap<String, BitmapData>,
    builder: &mut FrameBuilder,
    budget: &mut Budget,
) -> Result<()> {
    if glyphs.len() != choices.len() {
        bail!("CAPTION_SCENE_INVALID: paint choice count");
    }
    if choices.iter().all(Option::is_none) {
        return text_paint::record_glyphs(
            &node.style,
            glyphs,
            canvas,
            text,
            images,
            builder,
            budget,
        );
    }
    // Color glyphs have one final bitmap pass, independent of stack length.
    // Validate masks against the selected stack before emitting any operations.
    let mut bitmap_glyphs = Vec::new();
    let mut outline_glyphs = Vec::with_capacity(glyphs.len());
    for (glyph, choice) in glyphs.iter().zip(choices) {
        budget.spend()?;
        let bitmap = matches!(
            text.glyph_render(glyph.glyph.cache_key),
            GlyphRender::ColorBitmap { .. }
        );
        if bitmap {
            let layers = match choice {
                Some(index) => &scene.paint_style_bindings[*index].style.paints,
                None => &node.style.paints,
            };
            if layers.iter().any(|layer| layer.mask.is_some()) {
                bail!("CAPTION_SCENE_INVALID: glyph paint mask requires outline glyphs");
            }
            if layers.iter().any(|layer| layer.distance_coverage.is_some()) {
                bail!("CAPTION_SCENE_INVALID: glyph distance requires outline glyphs");
            }
            bitmap_glyphs.push(glyph.clone());
        }
        outline_glyphs.push(!bitmap);
    }
    // Never record one complete style after another: its outline could cover
    // the previous style's fill. Every glyph completes a layer before the next.
    for id in caption_scene::paint_style_order(scene, &node.id)? {
        budget.spend()?;
        let mut groups: Vec<(PaintLayer, Vec<text_paint::GlyphPaint>)> = Vec::new();
        for ((glyph, choice), outline) in glyphs.iter().zip(choices).zip(&outline_glyphs) {
            budget.spend()?;
            if !outline {
                continue;
            }
            let layers = match choice {
                Some(index) => &scene.paint_style_bindings[*index].style.paints,
                None => &node.style.paints,
            };
            let mut selected_layer = None;
            for layer in layers {
                budget.spend()?;
                if layer.id == id {
                    selected_layer = Some(layer);
                    break;
                }
            }
            let Some(layer) = selected_layer else {
                continue;
            };
            let mut equal_group = None;
            for (index, (paint, _)) in groups.iter().enumerate() {
                budget.spend()?;
                if paint == layer {
                    equal_group = Some(index);
                    break;
                }
            }
            if let Some(index) = equal_group {
                groups[index].1.push(glyph.clone());
            } else {
                groups.push((layer.clone(), vec![glyph.clone()]));
            }
        }
        // Equal paint definitions share coverage even across nonadjacent words.
        // Different definitions keep deterministic first-glyph batch order.
        let mut surface_pixels = 0;
        for (layer, members) in groups {
            let mut style = node.style.clone();
            style.stroke = None;
            style.paints = vec![layer];
            text_paint::record_glyphs_with_surfaces(
                &style,
                &members,
                canvas,
                text,
                images,
                builder,
                budget,
                Some(&mut surface_pixels),
            )?;
        }
    }
    if !bitmap_glyphs.is_empty() {
        let mut style = node.style.clone();
        style.stroke = None;
        style.paints.clear();
        text_paint::record_glyphs(
            &style,
            &bitmap_glyphs,
            canvas,
            text,
            images,
            builder,
            budget,
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod selection_budget_tests {
    use super::*;
    use serde_json::{Value, json};

    fn scene(filter: Value) -> Scene {
        let stack = json!([{"id":"ink","paint":{"kind":"solid","color":"#FFFFFF"}}]);
        let body = json!({
            "schema":"baocut.caption-scene-style/1", "scene":{"kind":"inline","value":{
                "schema":"baocut.caption-scene/1", "evaluationVersion":1,
                "requiredCapabilities":["caption-paint-style-bindings/1"],
                "layout":{"width":{"value":100,"basis":"absolute"},
                          "x":{"value":0,"basis":"absolute"},"y":{"value":0,"basis":"absolute"}},
                "nodes":[{"id":"caption","type":"text","style":{"paints":stack.clone()}}],
                "selectors":[
                    {"id":"unused","nodeId":"caption","unit":"word","filter":{"kind":"all"}},
                    {"id":"words","nodeId":"caption","unit":"word","filter":filter}
                ],
                "paintStyleBindings":[
                    {"id":"first","nodeId":"caption","selectorId":"unused","style":{"paints":stack.clone()}},
                    {"id":"last","nodeId":"caption","selectorId":"words","style":{"paints":stack}}
                ]
            }}
        });
        caption_scene::parse_style(&body).unwrap().scene().clone()
    }

    fn word() -> Unit {
        Unit {
            envelope: None,
            page_envelope: None,
            page_lines: None,
            active_word: None,
            previous_word_in_line: None,
            line_box: None,
            cue_speech: None,
            word_position: Some(1),
            line_position: Some(0),
            cue_bindings: None,
            cue_selector: None,
            whitespace: false,
            text_index: 1,
            text_count: 2,
            page_text_index: 1,
            page_text_count: 2,
            first_page_input: PageWordInput::default(),
            page_input: PageWordInput::default(),
            cue_first_word_span: None,
            cue_second_word_start: None,
            word_timed: false,
            next_word_start: None,
            page_source_start: 0,
            page_index: 0,
            page_count: 1,
            page_last_word_span: None,
            kind: UnitKind::Word,
            id: "word".into(),
            index: 1,
            count: 2,
            bytes: 0..1,
            bounds: Bounds::default(),
            ink_bounds: Bounds::default(),
            line_ink_bounds: Bounds::default(),
            baseline: 0.0,
            spans: BTreeMap::new(),
            state: WordState::Unread,
            tags: vec!["accent".into()],
        }
    }

    #[test]
    fn binding_selector_search_and_recursive_filter_each_consume_operations() {
        let mut scene = scene(json!({"kind":"and","filters":[
            {"kind":"tag","value":"accent"},
            {"kind":"not","filter":{"kind":"tag","value":"skip"}},
            {"kind":"range","start":0,"end":2},
            {"kind":"parity","odd":true}
        ]}));
        scene.paint_style_bindings.remove(0);
        // One binding + two selector comparisons + six visited filter nodes.
        let mut exact = Budget::new(9);
        assert_eq!(
            binding_index(&scene, &scene.nodes[0], &word(), &mut exact).unwrap(),
            Some(0)
        );
        assert_eq!(exact.remaining(), 0);
        let error =
            binding_index(&scene, &scene.nodes[0], &word(), &mut Budget::new(8)).unwrap_err();
        assert!(error.to_string().contains("CAPTION_BUDGET_EXCEEDED"));
    }

    #[test]
    fn last_match_and_short_circuit_keep_the_existing_selection_semantics() {
        let scene = scene(json!({"kind":"tag","value":"accent"}));
        // The later match short-circuits before examining the earlier binding.
        let mut exact = Budget::new(4);
        assert_eq!(
            binding_index(&scene, &scene.nodes[0], &word(), &mut exact).unwrap(),
            Some(1)
        );
        assert_eq!(exact.remaining(), 0);
        let mut untagged = word();
        untagged.tags.clear();
        let mut exact = Budget::new(7);
        assert_eq!(
            binding_index(&scene, &scene.nodes[0], &untagged, &mut exact).unwrap(),
            Some(0)
        );
        assert_eq!(exact.remaining(), 0);
    }

    #[test]
    fn repeated_word_choices_share_the_callers_operation_budget() {
        let scene = scene(json!({"kind":"all"}));
        let mut budget = Budget::new(7);
        assert_eq!(
            binding_index(&scene, &scene.nodes[0], &word(), &mut budget).unwrap(),
            Some(1)
        );
        assert!(binding_index(&scene, &scene.nodes[0], &word(), &mut budget).is_err());
        assert_eq!(budget.remaining(), 0);
    }
}
