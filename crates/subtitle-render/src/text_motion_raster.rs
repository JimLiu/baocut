/// Word plates are independent of the animated glyph transforms.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WordBackground {
    pub color: String,
    pub active_color: String,
    pub padding_x_em: f64,
    pub padding_y_em: f64,
    pub radius_em: f64,
}

struct MotionGlyphGroup {
    chunk: GlyphChunk,
    x: f64,
    top: f64,
    height: f64,
    line: usize,
    word: usize,
    grapheme: usize,
    /// This grapheme's place within its word (the karaoke sweep fills a word
    /// grapheme by grapheme).
    in_word: usize,
    /// Horizontal extent in layout space: from the cluster's first glyph to the
    /// next cluster.
    ink: (f64, f64),
    pivot: (f64, f64),
}

fn text_motion_starts(item: &TimedItem, kind: LineKind, fps: f64) -> Vec<f64> {
    text_motion_word_clock(item, kind, fps, |w| w.start)
}

/// Word ends on the same display clock as [`text_motion_starts`]; only the
/// karaoke sweep reads them.
fn text_motion_ends(item: &TimedItem, kind: LineKind, fps: f64) -> Vec<f64> {
    text_motion_word_clock(item, kind, fps, |w| w.end)
}

fn text_motion_word_clock(
    item: &TimedItem,
    kind: LineKind,
    fps: f64,
    at: impl Fn(&Word) -> f64,
) -> Vec<f64> {
    if kind != LineKind::Original {
        return Vec::new();
    }
    item.words
        .iter()
        .map(|w| {
            if w.id.starts_with("derived-") {
                f64::INFINITY
            } else {
                ((at(w) - item.display_start) * fps).round() / fps.max(1.0)
            }
        })
        .collect()
}

/// Render a cue-sized layer. Shaped clusters remain intact: combining marks,
/// ligatures and color emoji are never separately shaped for an animation.
fn draw_text_motion_layout(
    destination: &mut Pixmap,
    text: &mut TextEngine,
    layout: &LineLayout,
    center_x: f64,
    top: f64,
    opacity: f64,
    parent: Transform,
) -> DrawBounds {
    use motion::text_motion::{TextPose, Unit, UnitContext};
    let mut groups = Vec::new();
    let mut line_y = 0.0;
    let mut grapheme = 0;
    let mut untimed_word = 0;
    // Indexed by word; ascending iteration order is the plate paint order.
    let mut word_rects: Vec<Option<(f64, f64, f64, f64)>> = Vec::new();
    let mut word_graphemes: Vec<usize> = Vec::new();
    for (line_index, line) in layout.lines.iter().enumerate() {
        let height = line
            .height
            .max(layout.style.font_size * layout.style.line_height);
        let mut x = line_start_x(layout, line.width, 0.0);
        for chunk in &line.chunks {
            if chunk.text.trim().is_empty() {
                x += chunk.width;
                continue;
            }
            let word = if layout.kind == LineKind::Translation {
                untimed_word
            } else {
                chunk.word.unwrap_or(untimed_word)
            };
            untimed_word += 1;
            if word_rects.len() <= word {
                word_rects.resize(word + 1, None);
            }
            let rect =
                word_rects[word].get_or_insert((x, line_y, x + chunk.width, line_y + height));
            rect.0 = rect.0.min(x);
            rect.1 = rect.1.min(line_y);
            rect.2 = rect.2.max(x + chunk.width);
            rect.3 = rect.3.max(line_y + height);
            let mut clusters = chunk
                .shaped
                .glyphs
                .iter()
                .map(|g| g.cluster.start)
                .collect::<Vec<_>>();
            clusters.sort_unstable();
            clusters.dedup();
            for start in clusters {
                let mut part = chunk.clone();
                part.shaped.glyphs = chunk
                    .shaped
                    .glyphs
                    .iter()
                    .enumerate()
                    .filter(|(_, g)| g.cluster.start == start)
                    .map(|(index, g)| {
                        let mut g = g.clone();
                        g.x += index as f64 * layout.style.letter_spacing;
                        g
                    })
                    .collect();
                let left = part
                    .shaped
                    .glyphs
                    .iter()
                    .map(|g| g.x)
                    .fold(chunk.width, f64::min);
                let right = chunk
                    .shaped
                    .glyphs
                    .iter()
                    .enumerate()
                    .filter(|(_, g)| g.x > left + 0.01)
                    .map(|(index, g)| g.x + index as f64 * layout.style.letter_spacing)
                    .fold(chunk.width, f64::min);
                if word_graphemes.len() <= word {
                    word_graphemes.resize(word + 1, 0);
                }
                groups.push(MotionGlyphGroup {
                    chunk: part,
                    x,
                    top: line_y,
                    height,
                    line: line_index,
                    word,
                    grapheme,
                    in_word: word_graphemes[word],
                    ink: (x + left, x + right),
                    pivot: (x + (left + right) / 2.0, line_y + height / 2.0),
                });
                word_graphemes[word] += 1;
                grapheme += 1;
            }
            x += chunk.width;
        }
        line_y += height + line.gap_after;
    }
    let word_count = word_rects.len();
    let starts = text_motion_starts(&layout.item, layout.kind, layout.render_fps);
    let clock = ((layout.render_time - layout.item.display_start) * layout.render_fps).round()
        / layout.render_fps.max(1.0);
    let cue_duration = layout.item.display_end - layout.item.display_start;
    // A KTV next-line preview is still to come: base fill, no poses, no sweep.
    let motion = layout.style.text_motion.as_ref().filter(|_| !layout.preview);
    let active = motion.and_then(|m| m.active_word(clock, &starts));
    let karaoke = motion.and_then(|m| m.spec.karaoke.as_ref());
    let sung_color = karaoke.and_then(|k| parse_css_color(&k.color));
    let sung = motion.and_then(|m| {
        m.karaoke_sung(
            clock,
            &starts,
            &text_motion_ends(&layout.item, layout.kind, layout.render_fps),
        )
    });
    // A translation has no word timing of its own: it fills across all its
    // graphemes as far as the source words of the same span have been sung.
    let borrowed = motion
        .zip(layout.karaoke_words.as_deref())
        .and_then(|(m, words)| {
            let at = |t: f64| {
                ((t - layout.item.display_start) * layout.render_fps).round()
                    / layout.render_fps.max(1.0)
            };
            let starts = words.iter().map(|w| at(w.0)).collect::<Vec<_>>();
            let ends = words.iter().map(|w| at(w.1)).collect::<Vec<_>>();
            m.karaoke_sung(clock, &starts, &ends)
                .map(|sung| sung / words.len() as f64)
        });
    let total_graphemes = grapheme;
    // How much of one grapheme is sung (0–1): graphemes of a word share its
    // window evenly, so the fill moves character by character.
    let sweep_of = |group: &MotionGlyphGroup| {
        if let Some(part) = borrowed {
            return (part * total_graphemes as f64 - group.grapheme as f64).clamp(0.0, 1.0);
        }
        sung.map_or(0.0, |sung| {
            let count = word_graphemes.get(group.word).copied().unwrap_or(1).max(1) as f64;
            ((sung - group.word as f64) * count - group.in_word as f64).clamp(0.0, 1.0)
        })
    };
    let sung = sung.or(borrowed);
    // Fixed boxes are drawn before glyph poses and never pulse with the letters.
    let mut result = DrawBounds::default();
    if let Some(bg) = &layout.style.word_background {
        let rects = word_rects
            .iter()
            .enumerate()
            .filter_map(|(index, rect)| rect.map(|rect| (index, rect)));
        for (index, (x, y, right, bottom)) in rects {
            let color = if active == Some(index) {
                &bg.active_color
            } else {
                &bg.color
            };
            let f = layout.style.font_size;
            result.merge(fill_round_rect(
                destination,
                center_x + x - bg.padding_x_em * f,
                top + y - bg.padding_y_em * f,
                right - x + 2.0 * bg.padding_x_em * f,
                bottom - y + 2.0 * bg.padding_y_em * f,
                bg.radius_em * f,
                parse_css_color(color).unwrap_or(SubtitleColor::BLACK),
                opacity,
                parent,
            ));
        }
    }
    let (width, height, margin) = text_motion_scratch_size(layout);
    if u64::from(width) * u64::from(height)
        > text_motion_scratch_budget(destination.width(), destination.height())
    {
        // Unusually large text must stay readable even when scratch layers
        // exceed the animation budget. Keep layout and plates; paint static glyphs.
        // Never silently: the export would lose its motion without a trace.
        note_text_motion_static_fallback(width, height);
        let mut fallback = layout.clone();
        fallback.style.text_motion = None;
        fallback.style.word_background = None;
        let none = word_animation(&serde_json::json!({"wordAnimation":{"animationName":"None"}}));
        result.merge(draw_line_layout(
            destination,
            text,
            &fallback,
            &none,
            center_x,
            top,
            opacity,
            parent,
        ));
        return result;
    }
    let Some(mut layer) = MotionScratch::acquire(width, height) else {
        return result;
    };
    // The effect layer is only ever touched when the style has one.
    let mut shadow = if layout.style.effect_on {
        match MotionScratch::acquire(width, height) {
            Some(shadow) => Some(shadow),
            None => {
                layer.release();
                return result;
            }
        }
    } else {
        None
    };
    let (w, h) = (width as usize, height as usize);
    let offset_x = f64::from(width) / 2.0;
    let none = word_animation(&serde_json::json!({"wordAnimation":{"animationName":"None"}}));
    let posed = groups
        .into_iter()
        .map(|group| {
            let ctx = UnitContext {
                cue_time: clock,
                cue_duration,
                fps: layout.render_fps,
                line: group.line,
                lines: layout.lines.len(),
                word: Some(group.word),
                words: word_count,
                grapheme: group.grapheme,
                graphemes: grapheme,
                font_size: layout.style.font_size,
                box_width: layout.align_width,
            };
            let pose = motion.map_or_else(TextPose::default, |m| m.sample(ctx, &starts));
            let sweep = sweep_of(&group);
            (group, pose, sweep)
        })
        .collect::<Vec<_>>();
    // Blur a complete animation unit, not each isolated glyph and not unrelated
    // words together. Reuse two bounded scratch layers for every batch.
    let separate_blur = posed
        .iter()
        .any(|(_, p, _)| p.blur > 0.5 && p.unit != Unit::Cue);
    // The guide dot rides the sweep: the last grapheme it has reached, and how
    // far into that grapheme it is.
    // The dot follows the words actually sung, not a borrowed translation fill.
    let guide = karaoke
        .filter(|k| k.guide && borrowed.is_none())
        .and_then(|_| posed.iter().rev().find(|(_, _, sweep)| *sweep > 0.0))
        .map(|(group, pose, sweep)| {
            (
                group.ink.0 + (group.ink.1 - group.ink.0) * sweep + pose.dx,
                group.top + pose.dy,
                group.top + group.height + pose.dy,
                *sweep,
                pose.opacity,
            )
        });
    let mut batches: Vec<Vec<(MotionGlyphGroup, TextPose, f64)>> = Vec::new();
    let mut indices = HashMap::new();
    for (group, pose, sweep) in posed {
        let key = if separate_blur {
            match pose.unit {
                Unit::Cue => 0,
                Unit::Line => group.line,
                Unit::Word => group.word,
                Unit::Grapheme => group.grapheme,
            }
        } else {
            0
        };
        let index = *indices.entry(key).or_insert_with(|| {
            batches.push(Vec::new());
            batches.len() - 1
        });
        batches[index].push((group, pose, sweep));
    }
    // Where the scratch origin lands on the destination. A pure translation
    // keeps an integer blit (Nearest = exact copy) and moves the fractional
    // part into the glyph raster, so text glides by sub-pixels instead of
    // snapping to whole pixels frame to frame. Scale / rotation from a
    // transition resamples the layer, which needs bilinear filtering.
    let origin = (center_x - offset_x, top - margin);
    let pure_translate =
        parent.sx == 1.0 && parent.sy == 1.0 && parent.kx == 0.0 && parent.ky == 0.0;
    let (shift, place, paint) = if pure_translate {
        let x = origin.0 + f64::from(parent.tx);
        let y = origin.1 + f64::from(parent.ty);
        let (whole_x, whole_y) = (x.floor(), y.floor());
        (
            (x - whole_x, y - whole_y),
            Transform::from_translate(whole_x as f32, whole_y as f32),
            PixmapPaint::default(),
        )
    } else {
        (
            (0.0, 0.0),
            Transform::from_translate(origin.0 as f32, origin.1 as f32).post_concat(parent),
            PixmapPaint {
                quality: tiny_skia::FilterQuality::Bilinear,
                ..PixmapPaint::default()
            },
        )
    };
    // One single-cluster layout per frame; each group swaps in its chunk and
    // colour instead of deep-copying the cue (words, text, part poses) per glyph.
    let mut one = LineLayout {
        kind: layout.kind,
        style: {
            let mut style = layout.style.clone();
            style.text_motion = None;
            style.word_background = None;
            style.letter_spacing = 0.0;
            style
        },
        item: layout.item.clone(),
        lines: Arc::from(vec![LayoutLine::default()]),
        width: 0.0,
        height: 0.0,
        align_width: 0.0,
        text_align: LineTextAlign::Center,
        current_word: layout.current_word,
        render_time: layout.render_time,
        render_fps: layout.render_fps,
        animation_parts: layout.animation_parts.clone(),
        animation_short_edge: layout.animation_short_edge,
        preview: false,
        karaoke_words: None,
        guide_below: false,
    };
    let base_color = one.style.color;
    let emphasis_color = motion
        .and_then(|m| m.spec.emphasis.as_ref())
        .and_then(|e| parse_css_color(&e.color));
    // The grapheme under the sweep boundary is drawn twice: base fill, then the
    // sung fill clipped to the left of the boundary on this third layer.
    let mut sweep_layer = if sung_color.is_some() && sung.is_some() {
        match MotionScratch::acquire(width, height) {
            Some(layer) => Some(layer),
            None => {
                layer.release();
                if let Some(effect) = shadow {
                    effect.release();
                }
                return result;
            }
        }
    } else {
        None
    };
    for batch in batches {
        let mut glyph_bounds = DrawBounds::default();
        let mut shadow_bounds = DrawBounds::default();
        let mut max_blur = 0.0_f64;
        let mut needs_clip = false;
        for (group, pose, sweep) in batch {
            if pose.opacity <= 0.0 {
                continue;
            }
            max_blur = max_blur.max(pose.blur);
            needs_clip |= pose.clip;
            let unit = pose.unit;
            let (px, py) = if pose.active || unit == Unit::Word {
                word_rects
                    .get(group.word)
                    .copied()
                    .flatten()
                    .map_or(group.pivot, |r| ((r.0 + r.2) / 2.0, (r.1 + r.3) / 2.0))
            } else {
                match unit {
                    Unit::Cue => (0.0, layout.height / 2.0),
                    Unit::Line => (0.0, group.top + group.height / 2.0),
                    _ => group.pivot,
                }
            };
            let tf = Transform::from_translate(-px as f32, -py as f32)
                .post_scale(pose.scale as f32, pose.scale as f32)
                .post_rotate(pose.rotation as f32)
                .post_translate(
                    (px + pose.dx + offset_x + shift.0) as f32,
                    (py + pose.dy + margin + shift.1) as f32,
                );
            let mut color = base_color;
            if sweep >= 1.0 {
                color = sung_color.unwrap_or(color);
            }
            if pose.active {
                color = emphasis_color.unwrap_or(color);
            }
            if pose.highlight > 0.0 {
                color = color.mix(SubtitleColor::WHITE, pose.highlight);
            }
            one.style.color = color;
            let chunk_width = group.chunk.width;
            one.width = chunk_width;
            one.height = group.height;
            one.align_width = chunk_width;
            let line = LayoutLine {
                chunks: vec![group.chunk],
                width: chunk_width,
                height: group.height,
                gap_after: 0.0,
            };
            match Arc::get_mut(&mut one.lines) {
                Some([slot]) => *slot = line,
                _ => one.lines = Arc::from(vec![line]),
            }
            if let Some(shadow) = shadow.as_mut() {
                shadow_bounds.merge(draw_line_effect(
                    &mut shadow.pixmap,
                    text,
                    &one,
                    &none,
                    group.x + chunk_width / 2.0,
                    group.top,
                    opacity * pose.opacity,
                    tf,
                ));
            }
            glyph_bounds.merge(draw_line_layout(
                &mut layer.pixmap,
                text,
                &one,
                &none,
                group.x + chunk_width / 2.0,
                group.top,
                opacity * pose.opacity,
                tf,
            ));
            if sweep > 0.0
                && sweep < 1.0
                && let (Some(partial), Some(sung)) = (sweep_layer.as_mut(), sung_color)
            {
                one.style.color = sung;
                let window = draw_line_layout(
                    &mut partial.pixmap,
                    text,
                    &one,
                    &none,
                    group.x + chunk_width / 2.0,
                    group.top,
                    opacity * pose.opacity,
                    tf,
                )
                .window(w, h);
                if let Some(window) = window {
                    let boundary = offset_x
                        + shift.0
                        + pose.dx
                        + group.ink.0
                        + (group.ink.1 - group.ink.0) * sweep;
                    clip_columns(
                        partial.pixmap.data_mut(),
                        w,
                        &window,
                        f64::NEG_INFINITY,
                        boundary,
                    );
                    composite_premultiplied_rgba(
                        layer.pixmap.data_mut(),
                        partial.pixmap.data(),
                        w,
                        &window,
                    );
                    partial.mark(Some(window));
                    partial.clear();
                }
            }
        }
        // From here on every step only visits the rows/columns ink can occupy:
        // `dirty` is a superset of each scratch's non-zero pixels, which is the
        // contract of `alpha_bbox_within` and makes the bounded blur identical
        // to a whole-layer `box_blur_rgba_content`.
        let glyph_window = glyph_bounds.window(w, h);
        layer.mark(glyph_window.clone());
        if let Some(mut effect) = shadow.take() {
            let shadow_window = shadow_bounds.window(w, h);
            effect.mark(shadow_window.clone());
            if layout.style.effect_blur > 0.5
                && let Some(bounds) = shadow_window
                    .and_then(|window| alpha_bbox_within(effect.pixmap.data(), w, h, &window))
            {
                let blurred = box_blur_rgba_bounded(
                    effect.pixmap.data_mut(),
                    width,
                    height,
                    layout.style.effect_blur.round() as usize,
                    &bounds,
                );
                effect.mark(Some(blurred));
            }
            if let Some(bounds) = &glyph_window {
                composite_premultiplied_rgba(
                    effect.pixmap.data_mut(),
                    layer.pixmap.data(),
                    w,
                    bounds,
                );
                effect.mark(Some(bounds.clone()));
            }
            shadow = Some(std::mem::replace(&mut layer, effect));
        }
        if max_blur > 0.5
            && let Some(content) = layer
                .dirty
                .as_ref()
                .and_then(|window| alpha_bbox_within(layer.pixmap.data(), w, h, window))
        {
            let blurred = box_blur_rgba_bounded(
                layer.pixmap.data_mut(),
                width,
                height,
                max_blur.round() as usize,
                &content,
            );
            layer.mark(Some(blurred));
        }
        if needs_clip && let Some(dirty) = layer.dirty.clone() {
            // The mask edges follow the (sub-pixel shifted) layout box; the
            // column a boundary cuts through keeps its covered fraction.
            let left = offset_x + shift.0 - layout.align_width / 2.0;
            let right = offset_x + shift.0 + layout.align_width / 2.0;
            clip_columns(layer.pixmap.data_mut(), w, &dirty, left, right);
        }
        // Crop transparent margins before a transformed blit. A whole scratch
        // rectangle is several times the ink area and is expensive in WASM.
        if let Some(mut bounds) = layer
            .dirty
            .as_ref()
            .and_then(|window| alpha_bbox_within(layer.pixmap.data(), w, h, window))
        {
            if !pure_translate {
                // One transparent pixel around the ink lets bilinear sampling
                // fade the outermost row / column instead of padding it.
                bounds = ContentBox {
                    rows: bounds.rows.start.saturating_sub(1)..(bounds.rows.end + 1).min(h),
                    cols: bounds.cols.start.saturating_sub(1)..(bounds.cols.end + 1).min(w),
                };
            }
            let rect = tiny_skia::IntRect::from_xywh(
                bounds.cols.start as i32,
                bounds.rows.start as i32,
                (bounds.cols.end - bounds.cols.start) as u32,
                (bounds.rows.end - bounds.rows.start) as u32,
            );
            if let Some(cropped) = rect.and_then(|r| layer.pixmap.clone_rect(r)) {
                let transform =
                    Transform::from_translate(bounds.cols.start as f32, bounds.rows.start as f32)
                        .post_concat(place);
                destination.draw_pixmap(0, 0, cropped.as_ref(), &paint, transform, None);
                result.add_pixmap(cropped.width(), cropped.height(), transform);
            }
        }
        layer.clear();
        if let Some(effect) = shadow.as_mut() {
            effect.clear();
        }
    }
    layer.release();
    if let Some(effect) = shadow {
        effect.release();
    }
    if let Some(partial) = sweep_layer {
        partial.release();
    }
    if let (Some((x, line_top, line_bottom, sweep, alpha)), Some(sung)) = (guide, sung_color) {
        // A small dot hops once per grapheme just above the line, or just below
        // it when another line is stacked above (bilingual), hopping away from
        // the text either way.
        let f = layout.style.font_size;
        let radius = f * 0.09;
        let x = x + offset_x + shift.0;
        let hop = f * 0.12 * motion::text_motion::CompiledTextMotion::karaoke_guide_hop(sweep);
        let y = if layout.guide_below {
            line_bottom + margin + shift.1 + f * 0.04 + hop
        } else {
            line_top + margin + shift.1 - f * 0.04 - hop
        };
        let ring = if layout.style.outline_on {
            (layout.style.outline_width * 0.5).min(f * 0.05)
        } else {
            0.0
        };
        if ring > 0.0 {
            let r = radius + ring;
            result.merge(fill_round_rect(
                destination,
                x - r,
                y - r,
                r * 2.0,
                r * 2.0,
                r,
                layout.style.outline_color,
                opacity * alpha,
                place,
            ));
        }
        result.merge(fill_round_rect(
            destination,
            x - radius,
            y - radius,
            radius * 2.0,
            radius * 2.0,
            radius,
            sung,
            opacity * alpha,
            place,
        ));
    }
    result
}

/// Scratch layer size and glyph margin for one cue: `(width, height, margin)`.
/// The margin leaves room for scale / offset / blur poses and the effect layer.
fn text_motion_scratch_size(layout: &LineLayout) -> (u32, u32, f64) {
    let margin = (layout.style.font_size * 3.0
        + layout.style.effect_blur * 3.0
        + layout.style.effect_x.abs()
        + layout.style.effect_y.abs())
    .ceil();
    let width = (layout.align_width.max(layout.width) + margin * 2.0)
        .ceil()
        .clamp(1.0, 8192.0) as u32;
    let height = (layout.height + margin * 2.0).ceil().clamp(1.0, 8192.0) as u32;
    (width, height, margin)
}

/// Largest scratch layer (pixels) a cue may animate in, scaled with the output
/// canvas: 4× its area, never below the 1080p-era 16 Mpx and never above what
/// the 8192-px clamp can produce. A 4K or 8K export therefore animates any
/// cue that fits its canvas instead of quietly dropping to static glyphs.
fn text_motion_scratch_budget(canvas_width: u32, canvas_height: u32) -> u64 {
    (u64::from(canvas_width) * u64::from(canvas_height) * 4).clamp(16_777_216, 8192 * 8192)
}

static TEXT_MOTION_STATIC_FALLBACKS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

/// How many cue draws on this process fell back to static glyphs because
/// their animation scratch exceeded [`text_motion_scratch_budget`]. Hosts and
/// tests can assert on it; the first occurrence is also logged to stderr.
pub fn text_motion_static_fallbacks() -> u64 {
    TEXT_MOTION_STATIC_FALLBACKS.load(std::sync::atomic::Ordering::Relaxed)
}

fn note_text_motion_static_fallback(width: u32, height: u32) {
    if TEXT_MOTION_STATIC_FALLBACKS.fetch_add(1, std::sync::atomic::Ordering::Relaxed) == 0 {
        eprintln!(
            "bcut-subtitle-render: text motion scratch {width}x{height} exceeds the \
             animation budget; drawing static glyphs"
        );
    }
}

/// Zero the columns of `data` outside `[left, right)` within `dirty`; the two
/// boundary columns keep their covered fraction (premultiplied, so all four
/// channels scale together and stay premultiplied-valid).
fn clip_columns(data: &mut [u8], width: usize, dirty: &ContentBox, left: f64, right: f64) {
    let coverage = |column: usize| {
        let column = column as f64;
        ((column + 1.0).min(right) - column.max(left)).clamp(0.0, 1.0)
    };
    // Columns in [inside_from, inside_to) are fully covered and untouched.
    let inside_from = (left.max(0.0).ceil() as usize).clamp(dirty.cols.start, dirty.cols.end);
    let inside_to = (right.max(0.0).floor() as usize).clamp(inside_from, dirty.cols.end);
    for y in dirty.rows.clone() {
        let row = &mut data[y * width * 4..(y + 1) * width * 4];
        for x in (dirty.cols.start..inside_from).chain(inside_to..dirty.cols.end) {
            let cover = coverage(x);
            let pixel = &mut row[x * 4..x * 4 + 4];
            if cover <= 0.0 {
                pixel.fill(0);
            } else if cover < 1.0 {
                for byte in pixel {
                    *byte = (f64::from(*byte) * cover).round() as u8;
                }
            }
        }
    }
}

thread_local! {
    /// All-zero scratch buffers shared by every text-motion draw on this thread
    /// (export workers, the App preview thread, the single wasm thread). Loop
    /// presets re-raster every frame, so allocating and zeroing two cue-sized
    /// layers per call used to dominate the frame.
    ///
    /// Residency: at most [`SCRATCH_POOL_LEN`] buffers, each allocated at a
    /// real layer size (never reserved up to the budget) and never kept above
    /// [`SCRATCH_RETAIN_BYTES`]: a larger layer (a huge cue in a 4K / 8K
    /// export) is allocated for the call and freed afterwards. Worst case
    /// 2 × 64 MiB per rendering thread; typically two 1080p cue layers.
    static TEXT_MOTION_SCRATCH: std::cell::RefCell<Vec<Vec<u8>>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

/// Glyph layer + effect layer + karaoke sweep layer.
const SCRATCH_POOL_LEN: usize = 3;
/// 64 MiB = one 16 Mpx layer, the old fixed per-layer cap.
const SCRATCH_RETAIN_BYTES: usize = 64 << 20;

/// A pooled scratch layer plus a superset of its non-zero pixels. The pool only
/// ever holds all-zero buffers: [`Self::clear`] wipes exactly `dirty`, and a
/// buffer is returned to the pool only through [`Self::release`]. A panic while
/// drawing drops the buffer instead of pooling a dirty one.
struct MotionScratch {
    pixmap: Pixmap,
    dirty: Option<ContentBox>,
}

impl MotionScratch {
    fn acquire(width: u32, height: u32) -> Option<Self> {
        let size = tiny_skia::IntSize::from_wh(width, height)?;
        let len = width as usize * height as usize * 4;
        let pooled = TEXT_MOTION_SCRATCH
            .with(|pool| pool.borrow_mut().pop())
            .filter(|data| data.capacity() >= len);
        let data = match pooled {
            Some(mut data) => {
                // Catches an under-reported `DrawBounds` (a stroke the dirty
                // box missed) before it leaks into the next frame.
                debug_assert!(
                    data.chunks(64)
                        .all(|block| block.iter().fold(0_u8, |acc, byte| acc | byte) == 0),
                    "pooled text-motion scratch must be all zero"
                );
                // Truncation keeps zeros; growth within capacity zero-fills.
                data.resize(len, 0);
                data
            }
            // A too-small pooled buffer is dropped; a fresh zeroed allocation
            // lets the allocator hand out lazily zeroed pages.
            None => vec![0; len],
        };
        Some(Self {
            pixmap: Pixmap::from_vec(data, size)?,
            dirty: None,
        })
    }

    fn mark(&mut self, window: Option<ContentBox>) {
        let Some(window) = window else {
            return;
        };
        self.dirty = Some(match self.dirty.take() {
            None => window,
            Some(dirty) => ContentBox {
                rows: dirty.rows.start.min(window.rows.start)..dirty.rows.end.max(window.rows.end),
                cols: dirty.cols.start.min(window.cols.start)..dirty.cols.end.max(window.cols.end),
            },
        });
    }

    fn clear(&mut self) {
        if let Some(dirty) = self.dirty.take() {
            let width = self.pixmap.width() as usize;
            clear_content_box(self.pixmap.data_mut(), width, &dirty);
        }
    }

    fn release(mut self) {
        self.clear();
        let data = self.pixmap.take();
        if data.capacity() > SCRATCH_RETAIN_BYTES {
            return;
        }
        TEXT_MOTION_SCRATCH.with(|pool| {
            let mut pool = pool.borrow_mut();
            if pool.len() < SCRATCH_POOL_LEN {
                pool.push(data);
            }
        });
    }
}

#[cfg(test)]
mod text_motion_raster_tests {
    use super::*;
    use crate::text_design;

    fn fonts() -> Vec<Vec<u8>> {
        vec![
            include_bytes!("../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").to_vec(),
            include_bytes!("../../render-raster/assets/fonts/Anton-Regular.ttf").to_vec(),
            include_bytes!("../../render-raster/assets/fonts/Inter-Medium.ttf").to_vec(),
        ]
    }

    fn plan(style: &Value, text: &str, width: u32, height: u32) -> OverlayRenderPlan {
        let mut document = text_design::demo_document(style, text);
        if let Some(size) = style.get("testFontSize") {
            document["style"]["fontSize"] = size.clone();
        }
        OverlayRenderPlan::compile_with_injected_fonts(
            &document,
            width,
            height,
            4.0,
            30.0,
            None,
            OverlayIncludes::ALL,
            fonts(),
        )
        .unwrap()
    }

    /// A cue fading up across the canvas: `soft-focus` look, cue-level `fade-up`.
    fn fade_up_style() -> Value {
        let mut style = text_design::designs()
            .iter()
            .find(|d| d["id"] == "soft-focus")
            .unwrap()["style"]
            .clone();
        style["dropShadow"]["on"] = json!(false);
        style["textMotion"] = json!({"version": 1, "in": {"preset": "fade-up", "unit": "cue",
            "durationSeconds": 1.0, "intensity": 1, "easing": "linear"}});
        style
    }

    /// With an identity parent the fractional part of the placement is drawn
    /// into the layer: quarter-pixel phases all differ (no snapping to whole
    /// pixels), and only pixels next to an edge of the phase-0 image change.
    #[test]
    fn sub_pixel_placement_moves_only_glyph_edges() {
        let style = text_design::designs()[0]["style"].clone();
        let mut plan = plan(&style, "Make every word count", 640, 360);
        let layout = plan.active_layouts(2.5).into_iter().next().unwrap();
        assert!(layout.style.text_motion.is_some());
        let mut render = |dy: f64| {
            let mut pixmap = Pixmap::new(640, 360).unwrap();
            draw_text_motion_layout(
                &mut pixmap,
                &mut plan.text,
                &layout,
                320.0,
                140.0 + dy,
                1.0,
                Transform::identity(),
            );
            pixmap.take()
        };
        let base = render(0.0);
        let phases = [0.25, 0.5, 0.75].map(&mut render);
        assert!(base.chunks_exact(4).any(|p| p[3] == 255));
        fn pixel(image: &[u8], x: usize, y: usize) -> &[u8] {
            &image[(y * 640 + x) * 4..][..4]
        }
        for (index, phase) in phases.iter().enumerate() {
            assert_ne!(&base, phase, "phase {index} snapped to phase 0");
            for other in &phases[index + 1..] {
                assert_ne!(phase, other, "sub-pixel phases collapsed");
            }
            for y in 0..360 {
                for x in 0..640 {
                    if pixel(phase, x, y) == pixel(&base, x, y) {
                        continue;
                    }
                    let flat = (y.saturating_sub(1)..(y + 2).min(360)).all(|ny| {
                        (x.saturating_sub(1)..(x + 2).min(640))
                            .all(|nx| pixel(&base, nx, ny) == pixel(&base, x, y))
                    });
                    assert!(!flat, "phase {index} changed ({x},{y}) away from any edge");
                }
            }
        }
    }

    /// 8K export: a full-width cue's scratch exceeds the old fixed 16 Mpx cap
    /// but sits inside the canvas-scaled budget, so it animates (sizing only —
    /// no 8K frame is allocated).
    #[test]
    fn full_width_cue_at_8k_stays_within_the_animation_budget() {
        let mut plan = plan(
            &fade_up_style(),
            "Every single word of this caption spans the whole frame from the left edge \
             to the right edge",
            7680,
            4320,
        );
        let layout = plan.active_layouts(0.5).into_iter().next().unwrap();
        assert!(layout.align_width > 7680.0 * 0.75, "{}", layout.align_width);
        let (width, height, _) = text_motion_scratch_size(&layout);
        let area = u64::from(width) * u64::from(height);
        assert!(area > 16_777_216, "not discriminating: {width}x{height}");
        assert!(area <= text_motion_scratch_budget(7680, 4320));
    }

    /// 4K render of a cue the old fixed cap sent to static glyphs: the
    /// mid-entrance frame must differ from the motionless rendering.
    #[test]
    fn large_4k_cue_animates_instead_of_falling_back() {
        let text = "Every single word of this long caption wraps across several lines \
                    of the frame so that its animation layer grows well past the old cap";
        let mut style = fade_up_style();
        style["testFontSize"] = json!(80);
        let mut motion = plan(&style, text, 3840, 2160);
        let layout = motion.active_layouts(0.5).into_iter().next().unwrap();
        let (width, height, _) = text_motion_scratch_size(&layout);
        let area = u64::from(width) * u64::from(height);
        assert!(area > 16_777_216, "not discriminating: {width}x{height}");
        assert!(area <= text_motion_scratch_budget(3840, 2160));
        let mut still_style = style.clone();
        still_style["textMotion"] = Value::Null;
        let mut still = plan(&still_style, text, 3840, 2160);
        let fallbacks = text_motion_static_fallbacks();
        let moving = motion.render_subtitle_frame(0.5).unwrap().rgba;
        assert_eq!(text_motion_static_fallbacks(), fallbacks);
        assert_ne!(moving, still.render_subtitle_frame(0.5).unwrap().rgba);
    }

    fn ktv_style() -> Value {
        let mut style = text_design::designs()
            .iter()
            .find(|d| d["id"] == "ktv")
            .unwrap()["style"]
            .clone();
        style["fontFamily"] = json!("Inter");
        style["dropShadow"]["on"] = json!(false);
        style
    }

    /// Opaque pixels in the sung (orange) fill and in the base (cream) fill.
    fn sung_and_unsung(rgba: &[u8]) -> (usize, usize) {
        rgba.chunks_exact(4)
            .filter(|p| p[3] == 255 && p[0] > 230)
            .fold((0, 0), |(sung, unsung), p| {
                if (80..150).contains(&p[1]) && p[2] < 80 {
                    (sung + 1, unsung)
                } else if p[1] > 225 && p[2] > 190 {
                    (sung, unsung + 1)
                } else {
                    (sung, unsung)
                }
            })
    }

    /// The fill moves from the base colour to the sung colour along the real
    /// word windows (`demo_document`: word *i* sings from 0.6·i to 0.6·i + 0.4).
    #[test]
    fn karaoke_sweep_fills_sung_graphemes_in_the_sung_color() {
        let mut style = ktv_style();
        style["textMotion"]["karaoke"]["guide"] = json!(false);
        let mut plan = plan(&style, "HOLD ON TIGHT", 640, 360);
        let (sung, unsung) = sung_and_unsung(&plan.render_subtitle_frame(0.0).unwrap().rgba);
        assert_eq!(sung, 0, "nothing is sung at the first word's start");
        assert!(unsung > 200);
        // Half of the first word: part of "HOLD" is orange, the rest waits.
        let (sung, unsung) = sung_and_unsung(&plan.render_subtitle_frame(0.2).unwrap().rgba);
        assert!(sung > 50 && unsung > 200, "{sung} / {unsung}");
        let (sung, unsung) = sung_and_unsung(&plan.render_subtitle_frame(3.9).unwrap().rgba);
        assert!(sung > 200 && unsung == 0, "{sung} / {unsung}");
        // A mid-word frame differs from both neighbours: the sweep is continuous.
        let a = plan.render_subtitle_frame(0.1).unwrap().rgba;
        let b = plan.render_subtitle_frame(0.3).unwrap().rgba;
        assert_ne!(a, b);
    }

    #[test]
    fn karaoke_guide_dot_rides_the_sweep_above_the_line() {
        let render = |guide: bool, time: f64| {
            let mut style = ktv_style();
            style["textMotion"]["karaoke"]["guide"] = json!(guide);
            plan(&style, "HOLD ON TIGHT", 640, 360)
                .render_subtitle_frame(time)
                .unwrap()
        };
        let (with, without) = (render(true, 0.2), render(false, 0.2));
        let top = |frame: &RenderedSubtitleFrame| frame.bounds.as_ref().unwrap().rows.start;
        assert!(top(&with) < top(&without), "the dot sits above the glyphs");
        // Before the first timed word there is nothing to follow.
        let mut style = ktv_style();
        style["textMotion"]["karaoke"]["guide"] = json!(true);
        let mut doc = text_design::demo_document(&style, "HOLD ON TIGHT");
        for word in doc["cues"][0]["words"].as_array_mut().unwrap() {
            word["t0"] = json!(word["t0"].as_f64().unwrap() + 1.0);
            word["t1"] = json!(word["t1"].as_f64().unwrap() + 1.0);
        }
        let mut late = OverlayRenderPlan::compile_with_injected_fonts(
            &doc, 640, 360, 4.0, 30.0, None, OverlayIncludes::ALL, fonts(),
        )
        .unwrap();
        let early = late.render_subtitle_frame(0.5).unwrap();
        let off = render(false, 0.0);
        assert_eq!(top(&early), top(&off));
    }

    fn two_cue_plan(style: &Value, second_start: f64) -> OverlayRenderPlan {
        let mut doc = text_design::demo_document(style, "HOLD ON");
        doc["meta"]["duration"] = json!(20.0);
        doc["cues"][0]["end"] = json!(2.0);
        doc["cues"][0]["words"] = json!([
            {"id": "a0", "text": "HOLD", "t0": 0.0, "t1": 0.8},
            {"id": "a1", "text": "ON", "t0": 0.8, "t1": 1.6}
        ]);
        doc["cues"].as_array_mut().unwrap().push(json!({
            "id": "next", "start": second_start, "end": second_start + 2.0, "text": "LET GO",
            "words": [
                {"id": "b0", "text": "LET", "t0": second_start, "t1": second_start + 0.8},
                {"id": "b1", "text": "GO", "t0": second_start + 0.8, "t1": second_start + 1.6}
            ]
        }));
        OverlayRenderPlan::compile_with_injected_fonts(
            &doc, 640, 360, 20.0, 30.0, None, OverlayIncludes::ALL, fonts(),
        )
        .unwrap()
    }

    /// KTV two-line layout: the line being sung sits on top, the next line
    /// waits underneath in the base fill and never enters the cache key.
    #[test]
    fn karaoke_next_line_previews_the_following_cue_below() {
        let mut plan = two_cue_plan(&ktv_style(), 2.0);
        let layouts = plan.active_layouts(0.5);
        assert_eq!(layouts.len(), 2);
        assert!(!layouts[0].preview && layouts[1].preview);
        assert_eq!(layouts[1].item.id, "next");
        let canvas_scale = 360.0 / REFERENCE_SHORT_EDGE;
        let stack = plan.stack_layout(&layouts, canvas_scale);
        assert!(stack.placements[0].1 < stack.placements[1].1, "current line on top");
        let key = plan.cache_key(&layouts, 0.5, TransitionPose::IDENTITY, false);
        assert_eq!(key, plan.cache_key(&layouts[..1], 0.5, TransitionPose::IDENTITY, false));
        // The preview is all base fill: only the first line sweeps.
        let (sung, _) = sung_and_unsung(&plan.render_subtitle_frame(1.9).unwrap().rgba);
        let mut solo = two_cue_plan(&ktv_style(), 2.0);
        let (_, unsung_two) = sung_and_unsung(&solo.render_subtitle_frame(0.0).unwrap().rgba);
        assert!(sung > 100 && unsung_two > 100);

        let mut off = ktv_style();
        off["textMotion"]["karaoke"]["nextLine"] = json!(false);
        assert_eq!(two_cue_plan(&off, 2.0).active_layouts(0.5).len(), 1);
        // An instrumental break: the next line waits for its own entrance.
        assert_eq!(two_cue_plan(&ktv_style(), 12.0).active_layouts(0.5).len(), 1);
    }

    /// Bilingual KTV: the translation has no word timing of its own, so it
    /// fills across its graphemes as the source words of the same span are
    /// sung. No next-line preview: the screen already holds two lines.
    #[test]
    fn karaoke_translation_follows_the_source_words_in_bilingual_mode() {
        let mut style = ktv_style();
        style["textMotion"]["karaoke"]["guide"] = json!(false);
        style["mode"] = json!("bi");
        style["tracks"] = json!([{"role": "source"}, {"role": "translation"}]);
        let mut doc = text_design::demo_document(&style, "HOLD ON");
        doc["style"]["mode"] = json!("bi");
        doc["style"]["tracks"] = json!([{"role": "source"}, {"role": "translation"}]);
        doc["cues"][0]["end"] = json!(2.0);
        doc["cues"][0]["words"] = json!([
            {"id": "a0", "text": "HOLD", "t0": 0.0, "t1": 0.8},
            {"id": "a1", "text": "ON", "t0": 0.8, "t1": 1.6}
        ]);
        doc["cues"].as_array_mut().unwrap().push(json!({
            "id": "next", "start": 2.0, "end": 4.0, "text": "LET GO",
            "words": [{"id": "b0", "text": "LET", "t0": 2.0, "t1": 3.0}]
        }));
        doc["sentences"] = json!([{"id": "s1", "start": 0.0, "end": 2.0, "trans": "HANG ON"}]);
        doc["transCues"] = json!([{"id": "s1#0", "sid": "s1", "kind": "piece",
            "text": "HANG ON", "start": 0.0, "end": 2.0}]);
        let mut plan = OverlayRenderPlan::compile_with_injected_fonts(
            &doc, 640, 360, 4.0, 30.0, None, OverlayIncludes::ALL, fonts(),
        )
        .unwrap();
        let layouts = plan.active_layouts(0.5);
        assert_eq!(layouts.len(), 2, "no preview line in bilingual mode");
        let translation = layouts
            .iter()
            .find(|line| line.kind == LineKind::Translation)
            .unwrap();
        assert_eq!(translation.karaoke_words.as_deref(), Some(&[(0.0, 0.8), (0.8, 1.6)][..]));
        // Only the lower line puts its guide dot underneath.
        assert!(!layouts[0].guide_below && layouts[1].guide_below);
        let (sung, unsung) = sung_and_unsung(&plan.render_subtitle_frame(0.0).unwrap().rgba);
        assert!(sung == 0 && unsung > 200, "{sung} / {unsung}");
        let (sung, unsung) = sung_and_unsung(&plan.render_subtitle_frame(1.0).unwrap().rgba);
        assert!(sung > 200 && unsung > 50, "{sung} / {unsung}");
        // Both lines finish together once the source line is sung.
        let (sung, unsung) = sung_and_unsung(&plan.render_subtitle_frame(1.8).unwrap().rgba);
        assert!(sung > 300 && unsung == 0, "{sung} / {unsung}");
        // The translation sweep keeps the layer redrawing frame by frame.
        assert_ne!(
            plan.render_subtitle_frame(1.0).unwrap().key,
            plan.render_subtitle_frame(1.1).unwrap().key
        );
    }
}
