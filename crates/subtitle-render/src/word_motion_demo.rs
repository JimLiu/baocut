//! Native panel samples use the shared poses and real glyph outlines. No GPUI
//! Div approximation of rotation, no fixed 35% frame while playing.
use render_raster::fonts::TextEngine;
use tiny_skia::{FillRule, Paint, Pixmap, Transform};

pub fn render(
    text: &mut TextEngine,
    id: &str,
    seconds: f64,
    width: u32,
    height: u32,
) -> Option<Pixmap> {
    render_with_color(text, id, seconds, width, height, "#635bff", "#ffffff")
}

pub fn render_with_color(
    text: &mut TextEngine,
    id: &str,
    seconds: f64,
    width: u32,
    height: u32,
    active: &str,
    active_text: &str,
) -> Option<Pixmap> {
    let accent = super::parse_css_color(active)?;
    let mut image = Pixmap::new(width, height)?;
    image.fill(tiny_skia::Color::from_rgba8(240, 240, 240, 255));
    let (w, h) = (f64::from(width) / 2.0, f64::from(height) / 2.0);
    let shapes = ["The", "quick", "brown", "fox"].map(|s| text.shape(s, "Arial", 14.0, 600));
    let line_widths = [
        shapes[0].width + shapes[1].width + 4.0,
        shapes[2].width + shapes[3].width + 4.0,
    ];
    let total = line_widths[0].max(line_widths[1]);
    let fit = ((w - 20.0) / total).min(1.0);
    let frame = super::word_motion::demo_frame(id, seconds);
    let stage = Transform::from_scale((fit * 2.0) as f32, (fit * 2.0) as f32)
        .post_translate(w as f32, h as f32);
    let block = super::group_transform_for_motion(&frame.block, 0.0, 0.0, 18.0).post_concat(stage);
    for (index, shaped) in shapes.iter().enumerate() {
        let pose = &frame.words[index];
        let row = index / 2;
        let center = -line_widths[row] / 2.0
            + if index % 2 == 0 {
                0.0
            } else {
                shapes[index - 1].width + 4.0
            }
            + shaped.width / 2.0;
        let x = if pose.centered { 0.0 } else { center };
        let y = if pose.centered {
            0.0
        } else {
            row as f32 * 20.0 - 10.0
        };
        let pose_transform = super::group_transform_for_motion(pose, 0.0, 0.0, 18.0);
        let place = Transform::from_translate(x as f32, y);
        let local = if pose.block_scaled {
            place.post_concat(pose_transform)
        } else {
            pose_transform.post_concat(place)
        }
        .post_concat(block);
        let opacity = frame.block.opacity * pose.opacity;
        if let Some(chip) = pose.chip {
            let (bw, bh) = ((shaped.width + 8.0) * chip.scale, 20.0 * chip.scale);
            super::fill_round_rect(
                &mut image,
                -bw / 2.0,
                -bh / 2.0,
                bw,
                bh,
                (chip.corner_rounding * 14.0).min(bh / 2.0),
                accent,
                opacity * chip.alpha,
                local,
            );
        }
        let mut paint = Paint::default();
        let color = if pose.chip.is_some() {
            super::parse_css_color(active_text)?
        } else if pose.tint {
            accent
        } else {
            super::parse_css_color("#595650")?
        };
        paint.set_color_rgba8(
            color.r,
            color.g,
            color.b,
            (opacity.clamp(0.0, 1.0) * f64::from(255 - color.a)).round() as u8,
        );
        let baseline = (shaped.ascent - shaped.descent) / 2.0;
        for glyph in &shaped.glyphs {
            if let Some(path) = text.glyph_path(glyph.cache_key) {
                let transform = Transform::from_translate(
                    (glyph.x - shaped.width / 2.0) as f32,
                    (baseline + glyph.y) as f32,
                )
                .post_concat(local);
                image.fill_path(&path, &paint, FillRule::Winding, transform, None);
            }
        }
    }
    Some(image)
}
