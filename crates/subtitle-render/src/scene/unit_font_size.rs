//! Typography runs are sampled from frozen semantic membership before rich shaping.
//! No resulting geometry is available while selecting or evaluating a typography run.
use super::*;
use scene_primitives::text_layout::{FontStyle, Run};
use serde_json::{Map, Value, json};

const MAX_RUNS: usize = 8192;
#[derive(Clone, Debug)]
struct TypographyRun {
    bytes: Range<usize>,
    size: f64,
    family: Arc<str>,
    weight: u16,
    italic: bool,
}

impl TypographyRun {
    fn same_font(&self, other: &Self) -> bool {
        self.size.to_bits() == other.size.to_bits()
            && self.family == other.family
            && self.weight == other.weight
            && self.italic == other.italic
    }
    fn patch(&mut self, style: &FontStylePatch) {
        if let Some(family) = &style.font_family {
            self.family = Arc::from(family.as_str());
        }
        if let Some(weight) = style.font_weight {
            self.weight = weight;
        }
        if let Some(italic) = style.italic {
            self.italic = italic;
        }
    }
}
pub(super) fn applies(scene: &Scene, node: &str) -> bool {
    scene
        .layout
        .font_size_bindings
        .iter()
        .any(|b| b.node_id == node)
        || scene
            .layout
            .font_style_bindings
            .iter()
            .any(|b| b.node_id == node)
}
pub(super) fn style_needs_word_timing(scene: &Scene) -> bool {
    fn reads_state(filter: &Filter) -> bool {
        match filter {
            Filter::State { .. } => true,
            Filter::And { filters } | Filter::Or { filters } => filters.iter().any(reads_state),
            Filter::Not { filter } => reads_state(filter),
            _ => false,
        }
    }
    scene.layout.font_style_bindings.iter().any(|binding| {
        scene.selectors.iter().any(|selector| {
            selector.id == binding.selector_id
                && selector.unit == UnitKind::Word
                && reads_state(&selector.filter)
        })
    })
}
/// Conservatively enumerate conditional patches before the first census frame.
/// Each patch may be inactive; retaining both choices catches face combinations
/// formed by family-only, weight-only and italic-only rules without guessing tags.
pub(super) fn note_faces(text: &mut TextEngine, scene: &Scene, node: &Node) -> Result<()> {
    let bindings = scene
        .layout
        .font_style_bindings
        .iter()
        .filter(|b| b.node_id == node.id)
        .collect::<Vec<_>>();
    if bindings.is_empty() {
        return Ok(());
    }
    let mut faces = std::collections::BTreeSet::from([(
        node.style.font_family.clone(),
        node.style.font_weight,
        node.style.italic,
    )]);
    for binding in bindings {
        let changed = faces
            .iter()
            .map(|(family, weight, italic)| {
                (
                    binding.style.font_family.as_ref().unwrap_or(family).clone(),
                    binding.style.font_weight.unwrap_or(*weight),
                    binding.style.italic.unwrap_or(*italic),
                )
            })
            .collect::<Vec<_>>();
        faces.extend(changed);
        if faces.len() > 4096 {
            bail!("CAPTION_BUDGET_EXCEEDED: declared font faces");
        }
    }
    for (family, weight, italic) in faces {
        text.note_font_face(&family, weight, italic);
    }
    Ok(())
}

fn matches(filter: &Filter, unit: &Unit, budget: &mut Budget) -> Result<bool> {
    budget.spend()?;
    Ok(match filter {
        Filter::And { filters } => {
            for filter in filters {
                if !matches(filter, unit, budget)? {
                    return Ok(false);
                }
            }
            true
        }
        Filter::Or { filters } => {
            for filter in filters {
                if matches(filter, unit, budget)? {
                    return Ok(true);
                }
            }
            false
        }
        Filter::Not { filter } => !matches(filter, unit, budget)?,
        _ => filter.matches(unit.index, unit.state, &unit.tags),
    })
}
fn assign(
    runs: &mut Vec<TypographyRun>,
    range: Range<usize>,
    size: Option<f64>,
    style: Option<&FontStylePatch>,
    budget: &mut Budget,
) -> Result<()> {
    if range.is_empty() {
        return Ok(());
    }
    let mut output: Vec<TypographyRun> = Vec::with_capacity(runs.len() + 2);
    let mut push = |mut run: TypographyRun, bytes: Range<usize>| -> Result<()> {
        if bytes.is_empty() {
            return Ok(());
        }
        run.bytes = bytes;
        if let Some(last) = output.last_mut() {
            if last.bytes.end == run.bytes.start && last.same_font(&run) {
                last.bytes.end = run.bytes.end;
                return Ok(());
            }
        }
        if output.len() == MAX_RUNS {
            bail!("CAPTION_BUDGET_EXCEEDED: typography runs");
        }
        output.push(run);
        Ok(())
    };
    for run in runs.iter() {
        budget.spend()?;
        let start = run.bytes.start.max(range.start);
        let end = run.bytes.end.min(range.end);
        if start >= end {
            push(run.clone(), run.bytes.clone())?;
            continue;
        }
        push(run.clone(), run.bytes.start..start)?;
        let mut selected = run.clone();
        if let Some(size) = size {
            selected.size = size;
        }
        if let Some(style) = style {
            selected.patch(style);
        }
        push(selected, start..end)?;
        push(run.clone(), end..run.bytes.end)?;
    }
    *runs = output;
    Ok(())
}

fn sample_runs(
    base: &TextLayout,
    page_index: usize,
    cue: &SceneCue,
    node: &Node,
    scene: &Scene,
    t: f64,
    size: (u32, u32),
    params: &BTreeMap<String, Evaluated>,
    presentation: &Presentation,
    instance: &str,
    budget: &mut Budget,
) -> Result<Vec<TypographyRun>> {
    let page = &base.pages[page_index];
    let base_size = node.style.font_size.resolve(size.0, size.1, params)?;
    if !(1.0..=4096.0).contains(&base_size) {
        bail!("CAPTION_LAYOUT_INVALID: base font size");
    }
    let mut runs = vec![TypographyRun {
        bytes: page.source_range.clone(),
        size: base_size,
        family: Arc::from(node.style.font_family.as_str()),
        weight: node.style.font_weight,
        italic: node.style.italic,
    }];
    let mut units = units_for(cue, base, page, t, &scene.speech_state, presentation);
    if cue_unit_context::enabled(scene) {
        cue_unit_context::bind(
            scene,
            &node.id,
            base,
            page_index,
            &mut units,
            presentation,
            budget,
        )?;
    }
    let empty_units = BTreeMap::new();
    let images = BTreeMap::new();
    let rendering = RenderContext {
        scene,
        units: &empty_units,
        params,
        seconds: t,
        seed: u64::from_str_radix(&presentation.seed, 16)?,
        instance,
        cue,
        size,
        images: &images,
    };
    for binding in scene
        .layout
        .font_size_bindings
        .iter()
        .filter(|binding| binding.node_id == node.id)
    {
        let selector = scene
            .selectors
            .iter()
            .find(|selector| selector.id == binding.selector_id)
            .expect("validated font selector");
        let mut selected = Vec::new();
        for (unit, _) in &units {
            budget.spend()?;
            if unit.kind == selector.unit && matches(&selector.filter, unit, budget)? {
                selected.push(unit);
            }
        }
        for (rank, unit) in selected.iter().enumerate() {
            let mut context = context(unit, &rendering);
            context.fields.retain(|path, _| {
                !path.starts_with("layout.")
                    && !matches!(
                        path.as_str(),
                        "unit.lineEnvelopeAvailable"
                            | "unit.rangeInkAvailable"
                            | "unit.pageEnvelopeAvailable"
                            | "unit.pageLineCount"
                    )
            });
            context.fields.insert(
                "unit.selectedIndex".into(),
                Evaluated::Number(ValueType::Scalar, rank as f64),
            );
            context.fields.insert(
                "unit.selectedCount".into(),
                Evaluated::Number(ValueType::Scalar, selected.len() as f64),
            );
            cue_unit_context::select(&mut context, unit, Some(&selector.id));
            context
                .stable_key
                .push_str(&format!("|font-size|{}|{}", node.id, binding.id));
            if let DynamicValue::Keyframes { clock, .. } = &binding.value {
                if !context.spans.contains_key(&clock.unit) {
                    continue;
                }
            }
            let Some(value) = sample_value(
                &binding.value,
                ValueType::Length,
                scene,
                &context,
                t,
                budget,
            )?
            else {
                continue;
            };
            let value = value.number()?;
            if !value.is_finite() || !(1.0..=4096.0).contains(&value) {
                bail!("CAPTION_LAYOUT_INVALID: unit font size");
            }
            assign(&mut runs, unit.bytes.clone(), Some(value), None, budget)?;
        }
    }
    for binding in scene
        .layout
        .font_style_bindings
        .iter()
        .filter(|b| b.node_id == node.id)
    {
        let selector = scene
            .selectors
            .iter()
            .find(|s| s.id == binding.selector_id)
            .expect("validated font style selector");
        for (unit, _) in &units {
            budget.spend()?;
            if unit.kind == selector.unit && matches(&selector.filter, unit, budget)? {
                assign(
                    &mut runs,
                    unit.bytes.clone(),
                    None,
                    Some(&binding.style),
                    budget,
                )?;
            }
        }
    }
    if scene
        .layout
        .font_style_bindings
        .iter()
        .any(|b| b.node_id == node.id)
    {
        let mut boundaries = std::collections::BTreeSet::from([base.content.len()]);
        for (at, _) in base.content.grapheme_indices(true) {
            budget.spend()?;
            boundaries.insert(at);
        }
        if runs.iter().any(|run| {
            !boundaries.contains(&run.bytes.start) || !boundaries.contains(&run.bytes.end)
        }) {
            bail!("CAPTION_LAYOUT_INVALID: typography boundary splits a grapheme");
        }
    }
    Ok(runs)
}
fn rich_row(
    text: &mut TextEngine,
    content: &str,
    bytes: Range<usize>,
    style: &TextStyle,
    base_size: f64,
    sizes: &[TypographyRun],
    budget: &mut Budget,
) -> Result<(ShapedLine, f64)> {
    let source = &content[bytes.clone()];
    for _ in source.graphemes(true) {
        budget.spend()?;
    }
    let (normalized, mapping) = word_line_layout::normalized_row(source);
    if normalized.is_empty() {
        let max_size = sizes
            .iter()
            .filter(|run| run.bytes.start < bytes.end && run.bytes.end > bytes.start)
            .map(|run| run.size)
            .fold(0.0_f64, f64::max);
        let max_size = if max_size > 0.0 { max_size } else { base_size };
        let changed_faces = sizes
            .iter()
            .filter(|run| run.bytes.start < bytes.end && run.bytes.end > bytes.start)
            .any(|run| {
                run.family.as_ref() != style.font_family
                    || run.weight != style.font_weight
                    || run.italic != style.italic
            });
        let mut shape = if changed_faces {
            let mut measured = ShapedLine::default();
            for run in sizes
                .iter()
                .filter(|run| run.bytes.start < bytes.end && run.bytes.end > bytes.start)
            {
                budget.spend()?;
                let metrics = text.shape_spaced(
                    " ",
                    &run.family,
                    run.size,
                    run.weight,
                    run.italic,
                    style.letter_spacing * run.size,
                );
                measured.ascent = measured.ascent.max(metrics.ascent);
                measured.descent = measured.descent.max(metrics.descent);
            }
            measured
        } else {
            text.shape_spaced(
                " ",
                &style.font_family,
                max_size,
                style.font_weight,
                style.italic,
                style.letter_spacing * max_size,
            )
        };
        shape.width = 0.0;
        shape.glyphs.clear();
        return Ok((shape, max_size));
    }
    let mut spans: Vec<TypographyRun> = Vec::new();
    let mut max_size = 0.0_f64;
    for (at, character) in normalized.char_indices() {
        budget.spend()?;
        let original = bytes.start + mapping[at].start;
        let index = sizes.partition_point(|run| run.bytes.end <= original);
        let mut font = sizes
            .get(index)
            .filter(|run| run.bytes.contains(&original))
            .cloned()
            .unwrap_or_else(|| TypographyRun {
                bytes: 0..0,
                size: base_size,
                family: Arc::from(style.font_family.as_str()),
                weight: style.font_weight,
                italic: style.italic,
            });
        max_size = max_size.max(font.size);
        let end = at + character.len_utf8();
        if let Some(previous) = spans.last_mut() {
            if previous.bytes.end == at && previous.same_font(&font) {
                previous.bytes.end = end;
                continue;
            }
        }
        if spans.len() == MAX_RUNS {
            bail!("CAPTION_BUDGET_EXCEEDED: normalized typography runs");
        }
        font.bytes = at..end;
        spans.push(font);
    }

    let base_font = FontStyle {
        family: &style.font_family,
        size: base_size,
        weight: style.font_weight,
        italic: style.italic,
        spacing: style.letter_spacing * base_size,
    };
    let mut shape = if spans.iter().all(|run| {
        run.size.to_bits() == base_size.to_bits()
            && run.family.as_ref() == style.font_family
            && run.weight == style.font_weight
            && run.italic == style.italic
    }) {
        // Empty run list preserves the existing uniform-font shaping path.
        text.shape_rich(&normalized, 0..normalized.len(), base_font, &[])
    } else {
        let spans = spans
            .into_iter()
            .map(|run| {
                let mut style = Map::<String, Value>::new();
                style.insert("fontSize".into(), json!(run.size));
                style.insert("font".into(), json!(run.family.as_ref()));
                style.insert("fontWeight".into(), json!(run.weight));
                style.insert(
                    "fontStyle".into(),
                    json!(if run.italic { "italic" } else { "normal" }),
                );
                style.insert(
                    "letterSpacing".into(),
                    json!(base_font.spacing / base_size * run.size),
                );
                Run {
                    bytes: run.bytes,
                    style,
                }
            })
            .collect::<Vec<_>>();
        text.shape_rich(&normalized, 0..normalized.len(), base_font, &spans)
    };
    for glyph in &mut shape.glyphs {
        if let (Some(first), Some(last)) = (
            mapping.get(glyph.cluster.start),
            glyph
                .cluster
                .end
                .checked_sub(1)
                .and_then(|end| mapping.get(end)),
        ) {
            glyph.cluster = first.start..last.end;
        }
    }
    Ok((shape, max_size))
}
pub(super) fn reflow(
    text: &mut TextEngine,
    base: &TextLayout,
    page_index: usize,
    cue: &SceneCue,
    node: &Node,
    scene: &Scene,
    t: f64,
    size: (u32, u32),
    params: &BTreeMap<String, Evaluated>,
    presentation: &Presentation,
    instance: &str,
    budget: &mut Budget,
) -> Result<Page> {
    let page = &base.pages[page_index];
    let cfg = &scene.layout;
    let sizes = sample_runs(
        base,
        page_index,
        cue,
        node,
        scene,
        t,
        size,
        params,
        presentation,
        instance,
        budget,
    )?;
    let base_size = node.style.font_size.resolve(size.0, size.1, params)?;
    let width = cfg.width.resolve(size.0, size.1, params)?;
    if !(1.0..=65536.0).contains(&width) {
        bail!("CAPTION_LAYOUT_INVALID: width");
    }
    let line_bytes = if unit_font_reflow::enabled(scene) {
        unit_font_reflow::line_bytes(
            page,
            &base.content,
            &base.words,
            cfg,
            width,
            base_size * node.style.line_height,
            |bytes| {
                rich_row(
                    text,
                    &base.content,
                    bytes,
                    &node.style,
                    base_size,
                    &sizes,
                    budget,
                )
                .map(|(shape, _)| shape)
            },
        )?
    } else {
        page.lines.iter().map(|line| line.bytes.clone()).collect()
    };
    let mut rows = Vec::new();
    let mut height = 0.0;
    for bytes in line_bytes {
        let (shape, max_size) = rich_row(
            text,
            &base.content,
            bytes.clone(),
            &node.style,
            base_size,
            &sizes,
            budget,
        )?;
        if cfg.overflow == LayoutOverflow::Error && shape.width > width + 0.001 {
            bail!("CAPTION_LAYOUT_OVERFLOW: unit font size fixed line");
        }
        let row_height =
            (shape.ascent + shape.descent.abs()).max(max_size * node.style.line_height);
        height += row_height;
        let mut page_metric_size = max_size;
        if page_envelope::enabled(scene) {
            // Retain assigned sizes of source whitespace even when normalized
            // shaping removes its glyph. This metadata must not alter row height.
            let first = sizes.partition_point(|run| run.bytes.end <= bytes.start);
            for run in sizes[first..]
                .iter()
                .take_while(|run| run.bytes.start < bytes.end)
            {
                budget.spend()?;
                page_metric_size = page_metric_size.max(run.size);
            }
        }
        rows.push((bytes, shape, row_height, page_metric_size));
    }
    let x = cfg.x.resolve(size.0, size.1, params)?;
    let y = cfg.y.resolve(size.0, size.1, params)?;
    let mut top = y - height / 2.0;
    let mut lines = Vec::with_capacity(rows.len());
    for (bytes, shape, row_height, max_size) in rows {
        let left = match cfg.align {
            Align::Left => x - width / 2.0,
            Align::Center => x - shape.width / 2.0,
            Align::Right => x + width / 2.0 - shape.width,
        };
        let baseline = top + shape.ascent;
        let bounds = Bounds {
            x: left,
            y: top,
            width: shape.width,
            height: row_height,
        };
        lines.push(Line::new(text, bytes, shape, bounds, baseline, max_size));
        top += row_height;
    }
    page_window::inherit_lines(&mut lines, &page.lines)?;
    Ok(Page {
        source_range: page.source_range.clone(),
        paint_start: page.paint_start,
        words: page.words.clone(),
        start: page.start,
        end: page.end,
        bounds: union(lines.iter().map(|line| line.bounds)),
        lines,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn body() -> Value {
        serde_json::from_str(include_str!(
            "../../../caption-scene/tests/fixtures/unit-font-size.json"
        ))
        .unwrap()
    }
    fn plan(mut body: Value, content: &str) -> ScenePlan {
        body["scene"]["value"]["layout"]["width"] = json!({"value":300,"basis":"absolute"});
        body["scene"]["value"]["layout"]["x"] = json!({"value":160,"basis":"absolute"});
        body["scene"]["value"]["layout"]["y"] = json!({"value":90,"basis":"absolute"});
        ScenePlan::compile(
            parse_style(&body).unwrap(),
            Presentation::default(),
            vec![SceneCue {
                id: "cue".into(),
                document_id: "doc".into(),
                text: content.into(),
                start: 0.,
                end: 4.,
                words: vec![],
            }],
            (320, 180),
            TextEngine::with_document_fonts(&[include_bytes!(
                "../../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
            )
            .to_vec()]),
            "size-instance".into(),
        )
        .unwrap()
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
    fn configured(page: f64, line: f64, word: f64) -> Value {
        let mut body = body();
        let bindings = &mut body["scene"]["value"]["layout"]["fontSizeBindings"];
        for (i, size) in [page, line, word].into_iter().enumerate() {
            bindings[i]["value"] = json!({"kind":"constant","value":size});
        }
        body
    }
    fn glyph_sizes(units: &[(Unit, Option<Line>)]) -> Vec<(usize, f64)> {
        units
            .iter()
            .filter_map(|(_, line)| line.as_ref())
            .flat_map(|line| {
                line.shape.glyphs.iter().map(|glyph| {
                    (
                        line.bytes.start + glyph.cluster.start,
                        f64::from(f32::from_bits(glyph.cache_key.font_size_bits)),
                    )
                })
            })
            .collect()
    }
    #[test]
    fn replacement_runs_cover_gaps_keep_order_and_merge_equal_neighbors() {
        let mut runs = vec![TypographyRun {
            bytes: 0..10,
            size: 12.,
            family: "Noto Sans SC".into(),
            weight: 700,
            italic: false,
        }];
        let mut budget = Budget::default();
        assign(&mut runs, 2..7, Some(20.), None, &mut budget).unwrap();
        assign(&mut runs, 5..9, Some(30.), None, &mut budget).unwrap();
        assert_eq!(
            runs.iter()
                .map(|run| (run.bytes.clone(), run.size))
                .collect::<Vec<_>>(),
            vec![(0..2, 12.), (2..5, 20.), (5..9, 30.), (9..10, 12.)]
        );
        assign(&mut runs, 0..10, Some(12.), None, &mut budget).unwrap();
        assert_eq!(runs.len(), 1);
        assert!(assign(&mut runs, 0..1, Some(14.), None, &mut Budget::new(0)).is_err());
    }
    #[test]
    fn page_line_word_precedence_really_shapes_each_size_and_preserves_space_mapping() {
        let content = "One   e\u{301}  中";
        let mut p = plan(configured(12., 20., 30.), content);
        let units = resolved(&mut p, 0.2);
        let sizes = glyph_sizes(&units);
        assert!(sizes.iter().any(|(at, size)| *at == 0 && *size == 30.));
        let accent = content.find("e\u{301}").unwrap();
        assert!(sizes.iter().any(|(at, size)| *at == accent && *size == 12.));
        let cjk = content.find('中').unwrap();
        assert!(sizes.iter().any(|(at, size)| *at == cjk && *size == 20.));
        assert!(
            sizes.iter().any(|(at, size)| *at == 3 && *size == 12.),
            "collapsed whitespace retains its covered base size and source byte offset"
        );
        let lines = units
            .iter()
            .filter_map(|(_, line)| line.as_ref())
            .collect::<Vec<_>>();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].bounds.height >= lines[0].shape.ascent + lines[0].shape.descent.abs());
        assert_eq!(lines[0].baseline, lines[0].bounds.y + lines[0].shape.ascent);
        assert!((lines[1].bounds.y - (lines[0].bounds.y + lines[0].bounds.height)).abs() < 1e-8);
        assert!(
            (lines[0].bounds.y + lines.iter().map(|line| line.bounds.height).sum::<f64>() / 2.
                - 90.)
                .abs()
                < 1e-8
        );
        assert!(
            units
                .iter()
                .filter(|(unit, _)| unit.kind == UnitKind::Word)
                .all(|(unit, _)| unit.envelope.as_ref().unwrap().line_available)
        );
    }
    #[test]
    fn previous_word_growth_repositions_neighbors_without_draw_scale() {
        let mut small = plan(configured(12., 12., 12.), "One two three");
        let mut large = plan(configured(12., 12., 30.), "One two three");
        let a = resolved(&mut small, 0.2);
        let b = resolved(&mut large, 0.2);
        let widths = |units: &[(Unit, Option<Line>)]| {
            units
                .iter()
                .filter_map(|(_, line)| line.as_ref())
                .next()
                .unwrap()
                .shape
                .width
        };
        assert!(widths(&b) > widths(&a));
        let gap = |units: &[(Unit, Option<Line>)]| {
            let words = units
                .iter()
                .filter(|(u, _)| u.kind == UnitKind::Word)
                .map(|(u, _)| u)
                .collect::<Vec<_>>();
            words[1].bounds.x - words[0].bounds.x
        };
        assert!(gap(&b) > gap(&a));
        assert!(large.style.scene().animations.is_empty());
    }
    #[test]
    fn selected_counts_are_semantic_and_reordering_bindings_changes_last_winner() {
        let mut b = configured(12., 20., 30.);
        b["scene"]["value"]["selectors"][2]["filter"] = json!({"kind":"all"});
        b["scene"]["value"]["layout"]["fontSizeBindings"][2]["value"] = json!({"kind":"expression","expression":{"op":"call","function":"mul","args":[{"op":"literal","type":"length","value":5},{"op":"read","path":"unit.selectedCount"}]}});
        let mut p = plan(b.clone(), "A B C");
        assert!(
            glyph_sizes(&resolved(&mut p, 0.2))
                .iter()
                .filter(|(at, _)| [0, 2, 4].contains(at))
                .all(|(_, size)| *size == 15.)
        );
        b["scene"]["value"]["layout"]["fontSizeBindings"]
            .as_array_mut()
            .unwrap()
            .swap(1, 2);
        let mut p = plan(b, "A B C");
        assert!(
            glyph_sizes(&resolved(&mut p, 0.2))
                .iter()
                .any(|(at, size)| *at == 4 && *size == 20.)
        );
    }
    #[test]
    fn per_sample_feedback_is_seekable_and_freezes_rows_words_and_windows() {
        let mut b = body();
        b["scene"]["value"]["materials"] = json!([{"kind":"feedback","id":"tail","samples":2,"step":{"ticks":100,"timescale":1000},"decay":0.5,"offset":[-2,0]}]);
        let mut p = plan(b.clone(), "One two three four five six");
        let early = resolved(&mut p, 0.1);
        let later = resolved(&mut p, 1.5);
        let membership = |units: &[(Unit, Option<Line>)]| {
            units
                .iter()
                .filter(|(u, _)| matches!(u.kind, UnitKind::Line | UnitKind::Word))
                .map(|(u, _)| (u.kind, u.bytes.clone(), u.page_index))
                .collect::<Vec<_>>()
        };
        assert_eq!(membership(&early), membership(&later));
        assert_ne!(p.render(0.1).unwrap().rgba, p.render(0.4).unwrap().rgba);
        for time in [0.1, 2.7, 0.4, 0.1] {
            assert_eq!(
                p.render(time).unwrap().rgba,
                plan(b.clone(), "One two three four five six")
                    .render(time)
                    .unwrap()
                    .rgba
            );
        }
    }
    #[test]
    fn legacy_no_binding_path_stays_pixel_identical_and_runtime_ranges_are_checked() {
        let mut b = body();
        b["scene"]["value"]["layout"]["fontSizeBindings"] = json!([]);
        let mut no_cap = b.clone();
        no_cap["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .retain(|cap| cap.as_str() != Some("caption-unit-font-size/1"));
        assert_eq!(
            plan(b.clone(), "One two three").render(0.4).unwrap().rgba,
            plan(no_cap, "One two three").render(0.4).unwrap().rgba
        );
        b = body();
        b["scene"]["value"]["layout"]["fontSizeBindings"][0]["value"] =
            json!({"kind":"expression","expression":{"op":"literal","type":"length","value":4097}});
        assert!(
            plan(b, "One two three")
                .render(0.2)
                .err()
                .unwrap()
                .to_string()
                .contains("CAPTION_LAYOUT_INVALID")
        );
    }
    #[test]
    fn cue_wide_size_precedes_unit_rules_and_unselected_text_keeps_it() {
        let mut b = configured(12., 20., 30.);
        let only = b["scene"]["value"]["layout"]["fontSizeBindings"][2].clone();
        b["scene"]["value"]["layout"]["fontSizeBindings"] = json!([only]);
        b["scene"]["value"]["layout"]["bindings"] = json!([{"nodeId":"caption","property":"fontSize","value":{"kind":"constant","value":18}}]);
        let mut p = plan(b, "One two three");
        let sizes = glyph_sizes(&resolved(&mut p, 0.2));
        assert!(sizes.iter().any(|(at, size)| *at == 0 && *size == 30.));
        assert!(sizes.iter().any(|(at, size)| *at == 3 && *size == 18.));
        assert!(sizes.iter().any(|(at, size)| *at == 4 && *size == 18.));
    }
    #[test]
    fn unit_sizes_never_repaginate_and_respect_overflow_policy() {
        let mut b = body();
        b["scene"]["value"]["layout"]["overflow"] = json!("error");
        b["scene"]["value"]["layout"]["bindings"] =
            json!([{"property":"width","value":{"kind":"constant","value":1}}]);
        assert!(
            plan(b.clone(), "One two three")
                .render(0.2)
                .err()
                .unwrap()
                .to_string()
                .contains("CAPTION_LAYOUT_OVERFLOW")
        );
        b["scene"]["value"]["layout"]["overflow"] = json!("visible");
        let mut p = plan(b, "One two three");
        let units = resolved(&mut p, 0.2);
        assert_eq!(
            units
                .iter()
                .filter(|(u, _)| u.kind == UnitKind::Line)
                .count(),
            2
        );
        assert_eq!(
            units
                .iter()
                .filter(|(u, _)| u.kind == UnitKind::Word)
                .count(),
            3
        );
    }
    #[test]
    fn unsampled_large_base_font_does_not_reject_valid_sized_rows() {
        let mut b = configured(12., 12., 12.);
        b["scene"]["value"]["nodes"][0]["style"]["fontSize"] =
            json!({"value":4096,"basis":"absolute"});
        b["scene"]["value"]["layout"]["overflow"] = json!("error");
        let mut p = plan(b, "One two three");
        assert!(
            glyph_sizes(&resolved(&mut p, 0.2))
                .iter()
                .all(|(_, size)| *size == 12.)
        );
    }
    #[test]
    fn selected_blank_row_uses_sampled_font_metrics_without_inventing_glyphs() {
        let mut small = plan(configured(12., 20., 12.), "   ");
        let mut large = plan(configured(12., 20., 30.), "   ");
        let a = resolved(&mut small, 0.2);
        let b = resolved(&mut large, 0.2);
        let a = a.iter().find_map(|(_, line)| line.as_ref()).unwrap();
        let b = b.iter().find_map(|(_, line)| line.as_ref()).unwrap();
        assert!(a.shape.glyphs.is_empty() && b.shape.glyphs.is_empty());
        assert_eq!((a.shape.width, b.shape.width), (0., 0.));
        assert!(b.bounds.height > a.bounds.height);
        assert!(b.bounds.height >= 30. * 1.3);
    }
    #[test]
    fn page_envelope_is_inherited_and_preserves_whitespace_run_sizes() {
        let mut body = body();
        body["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-page-envelope/1"));
        body["scene"]["value"]["selectors"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":"all-words","nodeId":"caption","unit":"word"}));
        body["scene"]["value"]["layout"]["fontSizeBindings"] = json!([
            {"id":"space-size","nodeId":"caption","selectorId":"pages","value":{"kind":"constant","value":48}},
            {"id":"word-size","nodeId":"caption","selectorId":"all-words","value":{"kind":"constant","value":12}}
        ]);
        let mut p = plan(body.clone(), "A B");
        let units = resolved(&mut p, 0.2);
        let mut first = None;
        for (unit, _) in &units {
            let mut c = Context::default();
            page_envelope::add_fields(&mut c, unit);
            assert!(c.fields["unit.pageEnvelopeAvailable"].boolean().unwrap());
            assert_eq!(c.fields["layout.pageMaxFontSize"].number().unwrap(), 48.0);
            assert_eq!(c.fields["unit.pageLineCount"].number().unwrap(), 1.0);
            if let Some(previous) = &first {
                assert_eq!(previous, &c.fields);
            } else {
                first = Some(c.fields);
            }
        }
        body["scene"]["value"]["layout"]["fontSizeBindings"]
            .as_array_mut()
            .unwrap()
            .truncate(1);
        let mut blank = plan(body.clone(), " ");
        let blank_units = resolved(&mut blank, 0.2);
        assert!(!blank_units.is_empty());
        for (unit, _) in blank_units {
            let mut c = Context::default();
            page_envelope::add_fields(&mut c, &unit);
            assert!(c.fields["unit.pageEnvelopeAvailable"].boolean().unwrap());
            assert_eq!(c.fields["layout.pageMaxFontSize"].number().unwrap(), 48.0);
            assert!(c.fields["layout.pageEnvelopeHeight"].number().unwrap() > 0.0);
        }
        // Uniform no-size-binding rows have empty normalized shapes. New
        // page metrics query the actual font without modifying those shapes.
        body["scene"]["value"]["layout"]["fontSizeBindings"] = json!([]);
        body["scene"]["value"]["nodes"][0]["style"]["fontSize"] =
            json!({"value":48,"basis":"absolute"});
        let mut uniform = plan(body, " ");
        let units = resolved(&mut uniform, 0.2);
        assert!(!units.is_empty());
        for (unit, _) in units {
            let mut c = Context::default();
            page_envelope::add_fields(&mut c, &unit);
            assert!(c.fields["unit.pageEnvelopeAvailable"].boolean().unwrap());
            assert_eq!(c.fields["layout.pageMaxFontSize"].number().unwrap(), 48.0);
            assert!(c.fields["layout.pageEnvelopeHeight"].number().unwrap() > 0.0);
        }
    }
    fn style_body() -> Value {
        serde_json::from_str(include_str!(
            "../../../caption-scene/tests/fixtures/unit-font-style.json"
        ))
        .unwrap()
    }
    fn mixed_fonts() -> Vec<Vec<u8>> {
        vec![
            include_bytes!("../../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").to_vec(),
            include_bytes!("../../../render-raster/assets/fonts/Rubik.ttf").to_vec(),
            include_bytes!("../../../render-raster/assets/fonts/PlayfairDisplay-Regular.ttf")
                .to_vec(),
            include_bytes!("../../../render-raster/assets/fonts/PlayfairDisplay-Italic.ttf")
                .to_vec(),
        ]
    }
    fn style_plan(mut b: Value, content: &str) -> ScenePlan {
        b["scene"]["value"]["layout"]["width"] = json!({"value":300,"basis":"absolute"});
        b["scene"]["value"]["layout"]["x"] = json!({"value":160,"basis":"absolute"});
        b["scene"]["value"]["layout"]["y"] = json!({"value":90,"basis":"absolute"});
        ScenePlan::compile(
            parse_style(&b).unwrap(),
            Presentation::default(),
            vec![SceneCue {
                id: "cue".into(),
                document_id: "doc".into(),
                text: content.into(),
                start: 0.,
                end: 4.,
                words: vec![],
            }],
            (320, 180),
            TextEngine::with_document_fonts(&mixed_fonts()),
            "style-instance".into(),
        )
        .unwrap()
    }
    #[test]
    fn font_patch_fields_compose_with_size_and_only_last_provided_field_wins() {
        let mut runs = vec![TypographyRun {
            bytes: 0..6,
            size: 12.,
            family: "Rubik".into(),
            weight: 400,
            italic: false,
        }];
        let mut budget = Budget::default();
        assign(&mut runs, 0..3, Some(30.), None, &mut budget).unwrap();
        let family = FontStylePatch {
            font_family: Some("Playfair Display".into()),
            font_weight: None,
            italic: Some(true),
        };
        assign(&mut runs, 0..6, None, Some(&family), &mut budget).unwrap();
        let weight = FontStylePatch {
            font_family: None,
            font_weight: Some(700),
            italic: None,
        };
        assign(&mut runs, 2..5, None, Some(&weight), &mut budget).unwrap();
        assert_eq!(
            runs.iter()
                .map(|r| (r.bytes.clone(), r.size, r.weight, r.italic))
                .collect::<Vec<_>>(),
            vec![
                (0..2, 30., 400, true),
                (2..3, 30., 700, true),
                (3..5, 12., 700, true),
                (5..6, 12., 400, true)
            ]
        );
        assert!(runs.iter().all(|r| r.family.as_ref() == "Playfair Display"));
    }
    #[test]
    fn mixed_faces_and_sizes_change_real_shaping_and_neighbor_positions() {
        let mut b = style_body();
        b["scene"]["value"]["layout"]["fontSizeBindings"][2]["value"] =
            json!({"kind":"constant","value":30});
        b["scene"]["value"]["layout"]["fontStyleBindings"]
            .as_array_mut()
            .unwrap()
            .truncate(2);
        let mut mixed = style_plan(b.clone(), "WWW AV text");
        let units = resolved(&mut mixed, 0.2);
        let line = units.iter().find_map(|(_, l)| l.as_ref()).unwrap();
        let first = line
            .shape
            .glyphs
            .iter()
            .find(|g| g.cluster.start == 0)
            .unwrap();
        let last = line
            .shape
            .glyphs
            .iter()
            .find(|g| g.cluster.start >= 7)
            .unwrap();
        assert_ne!(first.cache_key.font_id, last.cache_key.font_id);
        assert_eq!(f32::from_bits(first.cache_key.font_size_bits), 30.);
        assert_eq!(f32::from_bits(last.cache_key.font_size_bits), 12.);
        b["scene"]["value"]["layout"]["fontStyleBindings"]
            .as_array_mut()
            .unwrap()
            .truncate(1);
        let mut same_face = style_plan(b, "WWW AV text");
        let uniform = resolved(&mut same_face, 0.2);
        let word_x = |units: &[(Unit, Option<Line>)]| {
            units
                .iter()
                .find(|(u, _)| u.kind == UnitKind::Word && u.index == 1)
                .unwrap()
                .0
                .bounds
                .x
        };
        assert_ne!(word_x(&units), word_x(&uniform));
        assert_eq!(line.baseline, line.bounds.y + line.shape.ascent);
        let first = mixed.render(0.2).unwrap().rgba;
        assert_ne!(first, mixed.render(1.8).unwrap().rgba);
        assert_eq!(first, mixed.render(0.2).unwrap().rgba);
    }
    #[test]
    fn complete_rich_shaping_preserves_arabic_context_and_latin_kerning() {
        let mut text = TextEngine::with_document_fonts(&mixed_fonts());
        let content = "سلام AV";
        let split = "سلام ".len();
        let mut style = TextStyle::default();
        style.font_family = "Rubik".into();
        style.font_weight = 400;
        let runs = vec![
            TypographyRun {
                bytes: 0..split,
                size: 18.,
                family: "Rubik".into(),
                weight: 400,
                italic: false,
            },
            TypographyRun {
                bytes: split..content.len(),
                size: 24.,
                family: "Playfair Display".into(),
                weight: 400,
                italic: false,
            },
        ];
        let (actual, max) = rich_row(
            &mut text,
            content,
            0..content.len(),
            &style,
            18.,
            &runs,
            &mut Budget::default(),
        )
        .unwrap();
        let expected=text.shape_rich(content,0..content.len(),FontStyle {family:"Rubik",size:18.,weight:400,italic:false,spacing:0.},
            &[Run {bytes:0..split,style:serde_json::from_value(json!({"font":"Rubik","fontSize":18,"fontWeight":400,"fontStyle":"normal","letterSpacing":0})).unwrap()},
              Run {bytes:split..content.len(),style:serde_json::from_value(json!({"font":"Playfair Display","fontSize":24,"fontWeight":400,"fontStyle":"normal","letterSpacing":0})).unwrap()}]);
        assert_eq!(max, 24.);
        assert_eq!(
            (actual.width, actual.ascent, actual.descent),
            (expected.width, expected.ascent, expected.descent)
        );
        assert_eq!(
            actual
                .glyphs
                .iter()
                .map(|g| (g.cache_key, g.cluster.clone(), g.x, g.y))
                .collect::<Vec<_>>(),
            expected
                .glyphs
                .iter()
                .map(|g| (g.cache_key, g.cluster.clone(), g.x, g.y))
                .collect::<Vec<_>>()
        );
        assert!(
            actual
                .glyphs
                .iter()
                .any(|g| g.rtl && g.cluster.start < split)
        );
    }
    #[test]
    fn selected_whitespace_uses_its_face_metrics_not_base_face_at_largest_size() {
        let mut text = TextEngine::with_document_fonts(&mixed_fonts());
        let style = TextStyle::default();
        let runs = vec![TypographyRun {
            bytes: 0..3,
            size: 32.,
            family: "Playfair Display".into(),
            weight: 400,
            italic: true,
        }];
        let (actual, max) = rich_row(
            &mut text,
            "   ",
            0..3,
            &style,
            12.,
            &runs,
            &mut Budget::default(),
        )
        .unwrap();
        let expected = text.shape_spaced(" ", "Playfair Display", 32., 400, true, 0.);
        assert_eq!(
            (actual.ascent, actual.descent),
            (expected.ascent, expected.descent)
        );
        assert_eq!(max, 32.);
        assert_eq!(actual.width, 0.);
        assert!(actual.glyphs.is_empty());
    }
    #[test]
    fn static_font_dependencies_include_inactive_patches_and_composed_faces() {
        let mut body = style_body();
        body["scene"]["value"]["layout"]["fontStyleBindings"] = json!([
            {"id":"face","nodeId":"caption","selectorId":"active-word","style":{"fontFamily":"Missing Future Family"}},
            {"id":"weight","nodeId":"caption","selectorId":"first-word","style":{"fontWeight":600}},
            {"id":"slant","nodeId":"caption","selectorId":"pages","style":{"italic":true}}
        ]);
        let scene = parse_style(&body).unwrap();
        let mut text = TextEngine::with_document_fonts(&mixed_fonts());
        let log = render_raster::fonts::FaceLog::default();
        text.set_face_log(Some(log.clone()));
        note_faces(&mut text, scene.scene(), &scene.scene().nodes[0]).unwrap();
        assert!(
            log.lock()
                .unwrap()
                .contains(&("Missing Future Family".into(), 600, true))
        );
        assert!(
            text.take_missing_families()
                .contains(&"Missing Future Family".into())
        );
    }
    #[test]
    fn identity_style_binding_keeps_old_size_only_pixels() {
        let base = body();
        let mut changed = base.clone();
        changed["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-unit-font-style/1"));
        changed["scene"]["value"]["layout"]["fontStyleBindings"] = json!([{"id":"same","nodeId":"caption","selectorId":"pages","style":{"fontFamily":"Noto Sans SC","fontWeight":700,"italic":false}}]);
        for t in [0.2, 1.5, 3.2] {
            assert_eq!(
                plan(base.clone(), "One two three").render(t).unwrap().rgba,
                plan(changed.clone(), "One two three")
                    .render(t)
                    .unwrap()
                    .rgba
            );
        }
    }
}
