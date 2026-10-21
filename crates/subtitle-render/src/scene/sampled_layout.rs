use super::*;

pub(super) fn early_context(
    cue: &SceneCue,
    index: usize,
    count: usize,
    t: f64,
    params: &BTreeMap<String, Evaluated>,
    size: (u32, u32),
    instance: &str,
    seed: &str,
) -> Result<Context> {
    let duration = cue.end - cue.start;
    let progress = if duration > 0.0 {
        (t - cue.start) / duration
    } else if t < cue.start {
        0.0
    } else {
        1.0
    };
    let mut c = Context {
        fields: params.clone(),
        spans: BTreeMap::from([(UnitKind::Cue, (cue.start, cue.end))]),
        seed: u64::from_str_radix(seed, 16)?,
        stable_key: format!("{instance}|{}", cue.id),
    };
    for (path, ty, value) in [
        ("time.seconds", ValueType::Time, t - cue.start),
        ("time.elapsedSeconds", ValueType::Time, t - cue.start),
        ("time.durationSeconds", ValueType::Time, duration),
        ("time.cueDurationSeconds", ValueType::Time, duration),
        ("time.progress", ValueType::Scalar, progress),
        (
            "time.clampedProgress",
            ValueType::Scalar,
            progress.clamp(0.0, 1.0),
        ),
        ("unit.index", ValueType::Scalar, index as f64),
        ("unit.count", ValueType::Scalar, count as f64),
        ("canvas.width", ValueType::Length, size.0 as f64),
        ("canvas.height", ValueType::Length, size.1 as f64),
    ] {
        c.fields.insert(path.into(), Evaluated::Number(ty, value));
    }
    Ok(c)
}
pub(super) fn find_text<'a>(nodes: &'a [Node], id: &str) -> Option<&'a Node> {
    for n in nodes {
        if n.id == id {
            return Some(n);
        }
        if let Some(n) = find_text(&n.children, id) {
            return Some(n);
        }
    }
    None
}
fn find_mut<'a>(nodes: &'a mut [Node], id: &str) -> Option<&'a mut Node> {
    for n in nodes {
        if n.id == id {
            return Some(n);
        }
        if let Some(n) = find_mut(&mut n.children, id) {
            return Some(n);
        }
    }
    None
}
fn px(value: f64) -> Length {
    Length {
        value,
        basis: LengthBasis::Absolute,
        parameter: None,
        offset: 0.0,
    }
}
pub(super) fn sample_scene(
    scene: &Scene,
    ctx: &Context,
    t: f64,
    budget: &mut Budget,
) -> Result<Option<Scene>> {
    if scene.layout.layout_evaluation != LayoutEvaluation::PerSample {
        return Ok(None);
    }
    let mut out = scene.clone();
    for binding in &scene.layout.bindings {
        let ty = if matches!(binding.property.as_str(), "lineHeight" | "letterSpacing") {
            ValueType::Scalar
        } else {
            ValueType::Length
        };
        let mut c = ctx.clone();
        c.stable_key.push_str(&format!(
            "|layout|{:?}|{}",
            binding.node_id, binding.property
        ));
        let Some(v) = sample_value(&binding.value, ty, scene, &c, t, budget)? else {
            continue;
        };
        let v = v.number()?;
        if !v.is_finite() || v.abs() > 65536.0 {
            bail!("CAPTION_LAYOUT_INVALID: {}", binding.property);
        }
        if let Some(id) = &binding.node_id {
            let n = find_mut(&mut out.nodes, id).expect("validated layout target");
            match binding.property.as_str() {
                "fontSize" if (1.0..=4096.0).contains(&v) => n.style.font_size = px(v),
                "lineHeight" if (0.1..=10.0).contains(&v) => n.style.line_height = v,
                "letterSpacing" if (-2.0..=10.0).contains(&v) => n.style.letter_spacing = v,
                _ => bail!("CAPTION_LAYOUT_INVALID: {}", binding.property),
            }
        } else {
            match binding.property.as_str() {
                "width" if v >= 1.0 => out.layout.width = px(v),
                "x" => out.layout.x = px(v),
                "y" => out.layout.y = px(v),
                _ => bail!("CAPTION_LAYOUT_INVALID: {}", binding.property),
            }
        }
    }
    Ok(Some(out))
}
pub(super) fn reflow(
    text: &mut TextEngine,
    base: &TextLayout,
    page: &Page,
    node: &Node,
    cfg: &Layout,
    size: (u32, u32),
    params: &BTreeMap<String, Evaluated>,
    budget: &mut Budget,
) -> Result<Page> {
    let range = page.source_range.clone();
    let content = &base.content;
    let source = &content[range.clone()];
    let fs = node.style.font_size.resolve(size.0, size.1, params)?;
    let width = cfg.width.resolve(size.0, size.1, params)?;
    if !(1.0..=4096.0).contains(&fs) || !(1.0..=65536.0).contains(&width) {
        bail!("CAPTION_LAYOUT_INVALID: dimensions");
    }
    // Charge before shaping; no traversal-dependent cache can make an expensive input admissible.
    for _ in source.graphemes(true) {
        budget.spend()?;
    }
    if cfg.pagination.has_fixed_lines() {
        return word_line_layout::reflow(text, base, page, node, cfg, size, params, budget);
    }
    let paint_range = page.paint_start..range.end;
    let source = &content[paint_range.clone()];
    let style = &node.style;
    let block = layout(
        source,
        Wrap::Word,
        Some(width),
        fs * style.line_height,
        line_quota::capped(
            cfg.pagination.max_units_per_line,
            line_quota::word_starts(&base.words, paint_range.start, paint_range.end),
            |r| {
                let sh = text.shape_spaced_with_shaping(
                    &source[r],
                    &style.font_family,
                    fs,
                    style.font_weight,
                    style.italic,
                    style.letter_spacing * fs,
                    font_shaping::mode(style),
                );
                TextMetricsLine {
                    width: sh.width,
                    ascent: sh.ascent,
                    descent: sh.descent,
                }
            },
        ),
    );
    if cfg.overflow == LayoutOverflow::Error
        && (block.lines.len() > cfg.max_lines
            || block.lines.iter().any(|l| l.metrics.width > width + 0.001))
    {
        bail!("CAPTION_LAYOUT_OVERFLOW: fixed page");
    }
    let x = cfg.x.resolve(size.0, size.1, params)?;
    let y = cfg.y.resolve(size.0, size.1, params)?;
    let mut rows = Vec::with_capacity(block.lines.len());
    for line in &block.lines {
        let bytes = paint_range.start + line.bytes.start..paint_range.start + line.paint_end;
        let mut shape = text.shape_spaced_with_shaping(
            &content[bytes.clone()],
            &style.font_family,
            fs,
            style.font_weight,
            style.italic,
            style.letter_spacing * fs,
            font_shaping::mode(style),
        );
        font_line_box::apply(text, &mut shape, style, fs, budget)?;
        let row_height = font_line_box::row_height(&shape, style, fs);
        rows.push((bytes, shape, row_height));
    }
    let height = if style.line_box.is_some() {
        rows.iter().map(|(_, _, height)| height).sum()
    } else {
        block.lines.len() as f64 * fs * style.line_height
    };
    let mut next_y = y - height / 2.0;
    let mut lines = Vec::new();
    for (i, (bytes, shape, row_height)) in rows.into_iter().enumerate() {
        let lx = match cfg.align {
            Align::Left => x - width / 2.0,
            Align::Center => x - shape.width / 2.0,
            Align::Right => x + width / 2.0 - shape.width,
        };
        let ly = if style.line_box.is_some() {
            next_y
        } else {
            y - height / 2.0 + i as f64 * fs * style.line_height
        };
        let bounds = Bounds {
            x: lx,
            y: ly,
            width: shape.width,
            height: row_height,
        };
        let baseline = ly + shape.ascent;
        lines.push(Line::new(text, bytes, shape, bounds, baseline, fs));
        next_y += row_height;
    }
    Ok(Page {
        source_range: range,
        paint_start: page.paint_start,
        bounds: union(lines.iter().map(|l| l.bounds)),
        lines,
        words: page.words.clone(),
        start: page.start,
        end: page.end,
    })
}
