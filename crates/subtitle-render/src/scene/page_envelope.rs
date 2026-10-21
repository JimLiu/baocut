//! Page-wide post-layout metrics, shared by drawing and material contexts.
use super::*;

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct Metrics {
    y: f64,
    height: f64,
    max_font_size: f64,
    line_count: usize,
    available: bool,
}

pub(super) fn enabled(scene: &Scene) -> bool {
    scene
        .required_capabilities
        .iter()
        .any(|c| c == "caption-page-envelope/1")
}

fn measure(lines: &[Line], budget: &mut Budget) -> Result<Metrics> {
    let mut top = f64::INFINITY;
    let mut bottom = f64::NEG_INFINITY;
    let mut max_font_size = 0.0_f64;
    for line in lines {
        budget.spend()?;
        // Ink bounds already contain the unpainted glyph union. With no ink,
        // Line::new supplies the actual shaped font's ascent/descent fallback.
        top = top.min((line.baseline - line.shape.ascent.max(0.0)).min(line.ink_bounds.y));
        bottom = bottom.max(
            (line.baseline + line.shape.descent.abs())
                .max(line.ink_bounds.y + line.ink_bounds.height),
        );
        max_font_size = max_font_size.max(line.max_font_size);
    }
    Ok(if lines.is_empty() {
        Metrics::default()
    } else {
        Metrics {
            y: top,
            height: bottom - top,
            max_font_size,
            line_count: lines.len(),
            available: true,
        }
    })
}

pub(super) fn bind(
    units: &mut [(Unit, Option<Line>)],
    page: &Page,
    text: &mut TextEngine,
    style: &TextStyle,
    budget: &mut Budget,
) -> Result<()> {
    let mut metrics = measure(&page.lines, budget)?;
    for line in &page.lines {
        // Uniform shaping normalizes a blank source row to an empty string,
        // whose cached shape has no font metrics. Measure a space only for
        // this opt-in context; do not mutate legacy bounds, ink or baselines.
        if line.shape.glyphs.is_empty() && line.shape.ascent == 0.0 && line.shape.descent == 0.0 {
            budget.spend()?;
            let font = text.shape_spaced_with_shaping(
                " ",
                &style.font_family,
                line.max_font_size,
                style.font_weight,
                style.italic,
                style.letter_spacing * line.max_font_size,
                font_shaping::mode(style),
            );
            let top = line.bounds.y;
            let bottom = top + font.ascent.max(0.0) + font.descent.abs();
            let prior_bottom = metrics.y + metrics.height;
            metrics.y = metrics.y.min(top);
            metrics.height = prior_bottom.max(bottom) - metrics.y;
        }
    }
    let metrics = Arc::new(metrics);
    for (unit, _) in units {
        budget.spend()?;
        unit.page_envelope = Some(metrics.clone());
    }
    Ok(())
}

pub(super) fn add_fields(context: &mut Context, unit: &Unit) {
    let metrics = unit.page_envelope.as_deref().copied().unwrap_or_default();
    for (path, value) in [
        ("layout.pageEnvelopeY", metrics.y),
        ("layout.pageEnvelopeHeight", metrics.height),
        ("layout.pageMaxFontSize", metrics.max_font_size),
    ] {
        context
            .fields
            .insert(path.into(), Evaluated::Number(ValueType::Length, value));
    }
    context.fields.insert(
        "unit.pageLineCount".into(),
        Evaluated::Number(ValueType::Scalar, metrics.line_count as f64),
    );
    context.fields.insert(
        "unit.pageEnvelopeAvailable".into(),
        Evaluated::Bool(metrics.available),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    fn line(top: f64, baseline: f64, size: f64, ink: Option<Bounds>) -> Line {
        let mut text = TextEngine::default();
        let mut line = Line::new(
            &mut text,
            0..1,
            ShapedLine {
                width: 20.,
                ascent: 10.,
                descent: 3.,
                glyphs: vec![],
            },
            Bounds {
                x: 0.,
                y: top,
                width: 20.,
                height: 100.,
            },
            baseline,
            size,
        );
        if let Some(ink) = ink {
            line.ink_bounds = ink;
        }
        line
    }
    #[test]
    fn envelope_uses_font_and_ink_extents_and_keeps_interline_distance() {
        let lines = [
            line(
                0.,
                12.,
                18.,
                Some(Bounds {
                    x: 0.,
                    y: -2.,
                    width: 10.,
                    height: 19.,
                }),
            ),
            line(60., 72., 32., None),
        ];
        let metrics = measure(&lines, &mut Budget::default()).unwrap();
        assert_eq!(
            (
                metrics.y,
                metrics.height,
                metrics.max_font_size,
                metrics.line_count
            ),
            (-2., 77., 32., 2)
        );
        assert!(metrics.available);
        // Last line's 100px leading box does not inflate the 75px bottom edge.
        assert!(metrics.height < lines[1].bounds.y + lines[1].bounds.height);
    }
    #[test]
    fn whitespace_font_size_is_retained_and_empty_page_is_explicit() {
        let whitespace = measure(&[line(0., 12., 48., None)], &mut Budget::default()).unwrap();
        assert_eq!(
            (whitespace.y, whitespace.height, whitespace.max_font_size),
            (2., 13., 48.)
        );
        assert!(whitespace.available);
        let empty = measure(&[], &mut Budget::default()).unwrap();
        assert_eq!(
            (empty.y, empty.height, empty.max_font_size, empty.line_count),
            (0., 0., 0., 0)
        );
        assert!(!empty.available);
    }
}
