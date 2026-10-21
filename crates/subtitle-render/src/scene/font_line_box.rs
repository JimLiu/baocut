//! Explicit font-envelope line sizing. Legacy layout remains on its old path.
use super::*;

pub(super) fn apply(
    text: &mut TextEngine,
    shape: &mut render_raster::fonts::ShapedLine,
    style: &TextStyle,
    size: f64,
    budget: &mut Budget,
) -> Result<()> {
    // Every Text/Label layout route reaches this shared font-policy point.
    // Modify the owned shape, never TextEngine's cached base shape.
    if style.font_hinting == FontHinting::None {
        shape.set_hinting(false);
    }
    let Some(policy) = &style.line_box else {
        return Ok(());
    };
    // A blank row still owns the selected font's line box. This extra shape is
    // only an opt-in measurement, never a display glyph or invented source word.
    let mut blank;
    let glyphs = if shape.glyphs.is_empty() {
        budget.spend()?;
        blank = text.shape_spaced_with_shaping(
            " ",
            &style.font_family,
            size,
            style.font_weight,
            style.italic,
            0.0,
            font_shaping::mode(style),
        );
        if style.font_hinting == FontHinting::None {
            blank.set_hinting(false);
        }
        &blank.glyphs
    } else {
        &shape.glyphs
    };
    let mut up = 0.0f64;
    let mut down = 0.0f64;
    for glyph in glyphs {
        budget.spend()?;
        let font_size = f64::from(f32::from_bits(glyph.cache_key.font_size_bits));
        let (ascent, descent) = text
            .glyph_font_metrics(
                glyph.cache_key,
                policy.metric_source == LineMetricSource::Typographic,
                policy.fallback_probe,
            )
            .ok_or_else(|| {
                anyhow::anyhow!("CAPTION_LAYOUT_INVALID: glyph font metrics unavailable")
            })?;
        up = up.max(ascent.max(policy.min_ascent * font_size));
        down = down.max((-descent).max(policy.min_descent * font_size));
    }
    if !up.is_finite() || !down.is_finite() || up + down <= 0.0 {
        bail!("CAPTION_LAYOUT_INVALID: empty font envelope");
    }
    shape.ascent = up;
    // ShapedLine historically stores positive descent; the metric getter uses
    // signed font coordinates. Keep the existing shaping/render contract.
    shape.descent = down;
    Ok(())
}

pub(super) fn row_height(
    shape: &render_raster::fonts::ShapedLine,
    style: &TextStyle,
    size: f64,
) -> f64 {
    let em_height = size * style.line_height;
    if style.line_box.is_some() {
        em_height.max(shape.ascent + shape.descent.abs())
    } else {
        em_height
    }
}

#[cfg(test)]
mod hinting_tests {
    use super::*;
    #[test]
    fn unhinted_geometry_does_not_mutate_cached_shaping_or_advance() {
        let bytes =
            include_bytes!("../../../render-raster/assets/fonts/Bangers-Regular.ttf").to_vec();
        let mut text = TextEngine::with_document_fonts(&[bytes]);
        let original = text.shape("M", "Bangers", 14., 400);
        let hinted = text.glyph_ink_bounds(original.glyphs[0].cache_key).unwrap();
        let mut unhinted = original.clone();
        let style = TextStyle {
            font_hinting: FontHinting::None,
            ..Default::default()
        };
        apply(
            &mut text,
            &mut unhinted,
            &style,
            14.,
            &mut Budget::default(),
        )
        .unwrap();
        let ink = text.glyph_ink_bounds(unhinted.glyphs[0].cache_key).unwrap();
        assert!((ink.height() - 10.486).abs() < 0.016, "{ink:?}");
        assert!((hinted.height() - ink.height()).abs() > 1.);
        assert_eq!(unhinted.width, original.width);
        assert_eq!(unhinted.glyphs[0].cluster, original.glyphs[0].cluster);
        assert_eq!(unhinted.glyphs[0].x, original.glyphs[0].x);
        let again = text.shape("M", "Bangers", 14., 400);
        assert_eq!(again.glyphs[0].cache_key, original.glyphs[0].cache_key);
        assert_eq!(
            text.glyph_ink_bounds(again.glyphs[0].cache_key).unwrap(),
            hinted
        );
    }
}
