//! One-line text decorations. Geometry belongs to the label; semantic context
//! and transform pivot belong to its explicitly selected source unit.
use super::*;

pub(super) fn register_fonts(nodes: &[Node], text: &mut TextEngine) {
    for node in nodes {
        if node.kind == NodeKind::Label {
            text.note_font_face(
                &node.style.font_family,
                node.style.font_weight,
                node.style.italic,
            );
        }
        register_fonts(&node.children, text);
    }
}

pub(super) fn draw(
    node: &Node,
    unit: &Unit,
    parent: Transform,
    r: &RenderContext,
    text: &mut TextEngine,
    b: &mut FrameBuilder,
    budget: &mut Budget,
) -> Result<()> {
    let TextBinding::Static { text: content } = node.text.as_ref().expect("validated label text")
    else {
        bail!("CAPTION_SCENE_INVALID: label text must be static");
    };
    let content = node.style.text_transform.apply(content);
    let content = content.as_ref();
    let size_pose = pose_context(node, unit, r, budget, context(unit, r), Some(true))?;
    let size = number(&size_pose, "fontSize");
    if !size.is_finite() || !(1.0..=4096.0).contains(&size) {
        bail!("CAPTION_LAYOUT_INVALID: label font size must be 1..4096 pixels");
    }
    // Charge even cache hits before cloning/shaping potentially many labels.
    for _ in 0..content.len().max(1) {
        budget.spend()?;
    }
    let style = &node.style;
    let mut shape = text.shape_spaced_with_shaping(
        content,
        &style.font_family,
        size,
        style.font_weight,
        style.italic,
        style.letter_spacing * size,
        font_shaping::mode(style),
    );
    font_line_box::apply(text, &mut shape, style, size, budget)?;
    let (ascent, descent) =
        if shape.glyphs.is_empty() && shape.ascent == 0.0 && shape.descent == 0.0 {
            budget.spend()?;
            let metrics = text.shape_spaced_with_shaping(
                " ",
                &style.font_family,
                size,
                style.font_weight,
                style.italic,
                0.0,
                font_shaping::mode(style),
            );
            (metrics.ascent, metrics.descent)
        } else {
            (shape.ascent, shape.descent)
        };
    let height = ascent.max(0.0) + descent.abs();
    if !shape.width.is_finite()
        || !height.is_finite()
        || !(0.0..=65536.0).contains(&shape.width)
        || !(0.0..=65536.0).contains(&height)
    {
        bail!("CAPTION_BUDGET_EXCEEDED: label geometry");
    }
    let bounds = Bounds {
        x: unit.bounds.x + (unit.bounds.width - shape.width) * 0.5,
        y: unit.bounds.y + (unit.bounds.height - height) * 0.5,
        width: shape.width,
        height,
    };
    let baseline = bounds.y + ascent.max(0.0);
    let mut max_width = 0.0f64;
    let mut max_height = 0.0f64;
    let mut ink_available = false;
    for glyph in &shape.glyphs {
        budget.spend()?;
        if let Some(ink) = text.glyph_ink_bounds(glyph.cache_key) {
            max_width = max_width.max(ink.width() as f64);
            max_height = max_height.max(ink.height() as f64);
            ink_available = true;
        }
    }
    let mut ctx = context(unit, r);
    for (name, value) in [
        ("layout.labelWidth", shape.width),
        ("layout.labelHeight", height),
        ("layout.labelMaxGlyphInkWidth", max_width),
        ("layout.labelMaxGlyphInkHeight", max_height),
    ] {
        ctx.fields
            .insert(name.into(), Evaluated::Number(ValueType::Length, value));
    }
    ctx.fields.insert(
        "unit.labelInkAvailable".into(),
        Evaluated::Bool(ink_available),
    );
    // Size expressions never see the fields above. Remaining pose properties
    // run exactly once, after size and own shape have been resolved.
    let pose = pose_context(node, unit, r, budget, ctx, Some(false))?;
    if number(&pose, "opacity") <= 0.0 {
        return Ok(());
    }
    let transform = parent.pre_concat(matrix(&pose, unit.bounds));
    b.push(DrawOp::PushLayer {
        opacity: number(&pose, "opacity").clamp(0.0, 1.0) as f32,
        blend: motion::effect::BlendMode::Normal,
    });
    let Evaluated::Color(fill) = pose["fill"] else {
        unreachable!()
    };
    let scalar_map = super::image_paint::scalar_map(style, content, budget)?;
    let mut glyphs = Vec::with_capacity(shape.glyphs.len());
    for glyph in &shape.glyphs {
        budget.spend()?;
        let xy = (bounds.x + glyph.x, baseline + glyph.y);
        glyphs.push(text_paint::GlyphPaint {
            glyph: glyph.clone(),
            fill,
            opacity: 1.0,
            source_scalar_index: super::image_paint::scalar_index(
                &scalar_map,
                glyph.cluster.start,
            )?,
            page_scalar_origin: 0,
            origin: transform.pre_translate(xy.0 as f32, xy.1 as f32),
            paint_bounds: bounds,
            page_bounds: bounds,
            paint_origin: xy,
        });
    }
    text_paint::record_glyphs(style, &glyphs, r.size, text, r.images, b, budget)?;
    b.push(DrawOp::PopLayer);
    Ok(())
}
