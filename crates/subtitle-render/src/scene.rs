//! Declarative caption scenes. Layout, animation and recording are shared by native and WASM.
mod active_word_clock;
mod angular_samples;
mod bound_label;
mod cue_unit_context;
mod glyph_envelope;
mod gradient_smear;
mod image_sequences;
mod line_neighbor;
mod materials;
mod noise_palette;
mod noisy_sweep;
mod page_envelope;
mod page_window;
mod sampled_layout;
mod scalar_cluster;
mod text_line_layout;
mod unit_font_reflow;
mod unit_font_size;
mod word_line_layout;
use anyhow::{Result, bail};
use caption_scene::*;
use render_raster::drawop::{
    BitmapData, DrawOp, FrameBuilder, GradientStop, PaintData, path_from_skia,
};
use render_raster::fonts::{GlyphRender, ShapedLine};
use render_raster::{FrameMedia, FrameOps, TextEngine, rasterize_with_media};
use scene_primitives::{
    layout::TextMetricsLine,
    text_layout::{Wrap, layout},
};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, ops::Range, sync::Arc};
use tiny_skia::{Pixmap, Transform};
use unicode_segmentation::UnicodeSegmentation;

#[derive(Clone, Debug)]
pub struct SceneWord {
    pub id: String,
    pub text: String,
    pub start: f64,
    pub end: f64,
}
#[derive(Clone, Debug)]
pub struct SceneCue {
    pub id: String,
    pub document_id: String,
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub words: Vec<SceneWord>,
}
#[derive(Clone, Debug)]
struct Word {
    id: String,
    bytes: Range<usize>,
    span: Option<(f64, f64)>,
    input_timed: bool,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Clone)]
struct Line {
    bytes: Range<usize>,
    shape: ShapedLine,
    bounds: Bounds,
    baseline: f64,
    max_font_size: f64,
    display_span: Option<(f64, f64)>,
    glyph_ink: Vec<Option<Bounds>>,
    ink_bounds: Bounds,
}
impl Line {
    fn new(
        text: &mut TextEngine,
        bytes: Range<usize>,
        shape: ShapedLine,
        bounds: Bounds,
        baseline: f64,
        max_font_size: f64,
    ) -> Self {
        let glyph_ink = shape
            .glyphs
            .iter()
            .map(|glyph| {
                text.glyph_ink_bounds(glyph.cache_key).map(|ink| Bounds {
                    x: bounds.x + glyph.x + ink.x() as f64,
                    y: baseline + glyph.y + ink.y() as f64,
                    width: ink.width() as f64,
                    height: ink.height() as f64,
                })
            })
            .collect::<Vec<_>>();
        let ink_bounds = if glyph_ink.iter().any(Option::is_some) {
            union(glyph_ink.iter().copied().flatten())
        } else {
            Bounds {
                x: bounds.x,
                y: baseline - shape.ascent,
                width: bounds.width,
                height: shape.ascent + shape.descent.abs(),
            }
        };
        Self {
            bytes,
            shape,
            bounds,
            baseline,
            max_font_size,
            display_span: None,
            glyph_ink,
            ink_bounds,
        }
    }
    fn ink_for(&self, range: &Range<usize>, advance: Bounds) -> Bounds {
        let ink = self
            .shape
            .glyphs
            .iter()
            .zip(&self.glyph_ink)
            .filter_map(|(glyph, ink)| {
                range
                    .contains(&(self.bytes.start + glyph.cluster.start))
                    .then_some(*ink)
                    .flatten()
            })
            .collect::<Vec<_>>();
        if ink.is_empty() {
            // Whitespace retains its caret/advance horizontally and inherits the
            // visual line vertically, including trailing unshaped whitespace.
            Bounds {
                x: advance.x,
                width: advance.width,
                y: self.ink_bounds.y,
                height: self.ink_bounds.height,
            }
        } else {
            union(ink.into_iter())
        }
    }
}
#[derive(Clone)]
struct Page {
    source_range: Range<usize>,
    // Artificial word-quota separators retain source identity but are not indentation.
    paint_start: usize,
    lines: Vec<Line>,
    words: Vec<usize>,
    start: f64,
    end: f64,
    bounds: Bounds,
}
#[derive(Clone)]
struct TextLayout {
    pages: Vec<Page>,
    words: Vec<Word>,
    content: String,
}
#[derive(Clone, Copy, Default)]
struct PageWordInput {
    first_start: Option<f64>,
    last_end: Option<f64>,
    next_start: Option<f64>,
}
fn page_word_input(layout: &TextLayout, page: Option<&Page>) -> PageWordInput {
    let Some(page) = page else {
        return PageWordInput::default();
    };
    let span = |index: usize| {
        layout
            .words
            .get(index)
            .filter(|word| word.input_timed)
            .and_then(|word| word.span)
    };
    PageWordInput {
        first_start: page
            .words
            .first()
            .and_then(|index| span(*index).map(|s| s.0)),
        last_end: page
            .words
            .last()
            .and_then(|index| span(*index).map(|s| s.1)),
        next_start: page
            .words
            .last()
            .and_then(|index| span(*index + 1).map(|s| s.0)),
    }
}
#[derive(Clone)]
struct Unit {
    envelope: Option<Arc<glyph_envelope::Metrics>>,
    page_envelope: Option<Arc<page_envelope::Metrics>>,
    word_position: Option<usize>,
    line_position: Option<usize>,
    cue_bindings: Option<Arc<cue_unit_context::CueBindings>>,
    cue_selector: Option<String>,
    whitespace: bool,
    text_index: usize,
    text_count: usize,
    page_text_index: usize,
    page_text_count: usize,
    page_index: usize,
    page_count: usize,
    page_last_word_span: Option<(f64, f64)>,
    active_word: Option<active_word_clock::Clock>,
    previous_word_in_line: Option<Bounds>,
    first_page_input: PageWordInput,
    page_input: PageWordInput,
    cue_first_word_span: Option<(f64, f64)>,
    cue_second_word_start: Option<f64>,
    word_timed: bool,
    next_word_start: Option<f64>,
    kind: UnitKind,
    id: String,
    index: usize,
    count: usize,
    bytes: Range<usize>,
    bounds: Bounds,
    ink_bounds: Bounds,
    line_ink_bounds: Bounds,
    baseline: f64,
    spans: BTreeMap<UnitKind, (f64, f64)>,
    state: WordState,
    tags: Vec<String>,
}
#[derive(Clone, Debug)]
pub struct SceneHit {
    pub cue_id: String,
    pub document_id: String,
    pub bounds: Bounds,
}
pub struct SceneOutput {
    pub rgba: Arc<Vec<u8>>,
    pub blend: render_raster::drawop::AssociatedBlend,
}
pub struct SceneFrame {
    /// Associated RGBA8. Component materials may emit RGB above alpha; use an
    /// emission-aware compositor or checked conversion before straight export.
    pub rgba: Arc<Vec<u8>>,
    pub hits: Vec<SceneHit>,
    pub fingerprint: u64,
}

pub struct ScenePlan {
    pub text: TextEngine,
    pub diagnostics: Vec<Diagnostic>,
    style: SceneStyle,
    presentation: Presentation,
    cues: Vec<SceneCue>,
    layouts: BTreeMap<(usize, String), TextLayout>,
    pub width: u32,
    pub height: u32,
    instance_id: String,
    images: BTreeMap<String, BitmapData>,
    sequences: image_sequences::ImageSequenceCache,
}
impl ScenePlan {
    pub fn compile(
        style: SceneStyle,
        presentation: Presentation,
        cues: Vec<SceneCue>,
        size: (u32, u32),
        text: TextEngine,
        instance_id: String,
    ) -> Result<Self> {
        validate_style(&style)?;
        validate_presentation(&presentation, Some(style.scene()))?;
        if size.0 == 0 || size.1 == 0 || u64::from(size.0) * u64::from(size.1) > 16_777_216 {
            bail!("CAPTION_BUDGET_EXCEEDED: canvas");
        }
        if cues.len() > MAX_UNITS {
            bail!("CAPTION_BUDGET_EXCEEDED: cues");
        }
        let mut p = Self {
            text,
            diagnostics: vec![],
            style,
            presentation,
            cues,
            layouts: BTreeMap::new(),
            width: size.0,
            height: size.1,
            instance_id,
            images: BTreeMap::new(),
            sequences: Default::default(),
        };
        let mut nodes = Vec::new();
        text_nodes(&p.style.scene().nodes, &mut nodes);
        bound_label::register_fonts(&p.style.scene().nodes, &mut p.text);
        for node in &nodes {
            unit_font_size::note_faces(&mut p.text, p.style.scene(), node)?;
        }
        let mut glyph_count = 0usize;
        for i in 0..p.cues.len() {
            let cue = &p.cues[i];
            if !cue.start.is_finite()
                || !cue.end.is_finite()
                || cue.end < cue.start
                || cue.text.len() > 65536
            {
                bail!("CAPTION_SCENE_INVALID: cue span or text");
            }
            if cue.words.is_empty() && p.style.scene().speech_state.timing_policy==TimingPolicy::RequireWordTiming &&
                (nodes.iter().any(|n|!n.state_styles.is_empty()) || p.style.scene().animations.iter().any(|a|matches!(&a.value,DynamicValue::Keyframes{clock,..} if matches!(clock.unit,UnitKind::Word|UnitKind::Grapheme))) || p.style.scene().layout.font_size_bindings.iter().any(|b|matches!(&b.value,DynamicValue::Keyframes{clock,..} if clock.unit==UnitKind::Word)) || unit_font_size::style_needs_word_timing(p.style.scene())) {
                p.diagnostics.push(Diagnostic::new("CAPTION_TIMING_UNAVAILABLE",&cue.id,"word"));
            }
            let params = cue_parameters(&p.style, &p.presentation, cue, &p.instance_id)?;
            for n in &nodes {
                // Unit sizes are sampled later; freeze membership even if the unsampled
                // base font would overflow. Each actual rich reflow enforces overflow.
                let preparation_layout =
                    unit_font_size::applies(p.style.scene(), &n.id).then(|| {
                        let mut layout = p.style.scene().layout.clone();
                        layout.overflow = LayoutOverflow::Visible;
                        layout
                    });
                let l = prepare(
                    &mut p.text,
                    cue,
                    n,
                    preparation_layout
                        .as_ref()
                        .unwrap_or(&p.style.scene().layout),
                    &p.style.scene().speech_state,
                    size,
                    &params,
                )?;
                glyph_count += l
                    .pages
                    .iter()
                    .flat_map(|p| &p.lines)
                    .map(|l| l.shape.glyphs.len())
                    .sum::<usize>();
                if glyph_count > 131072 {
                    bail!("CAPTION_BUDGET_EXCEEDED: prepared glyphs");
                }
                p.layouts.insert((i, n.id.clone()), l);
            }
        }
        Ok(p)
    }
    /// Resolve frozen PNG resources atomically before recording frames.
    pub fn load_resources(
        &mut self,
        mut read: impl FnMut(&ImageResource) -> Option<Vec<u8>>,
    ) -> Result<()> {
        let mut images = BTreeMap::new();
        let mut decoded = 0usize;
        for r in &self.style.scene().resources {
            let bytes =
                read(r).ok_or_else(|| anyhow::anyhow!("CAPTION_RESOURCE_MISSING: {}", r.id))?;
            if bytes.len() > 16 * 1024 * 1024 {
                bail!("CAPTION_BUDGET_EXCEEDED: encoded image");
            }
            if format!(
                "sha256:{}",
                Sha256::digest(&bytes)
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect::<String>()
            ) != r.content_hash
            {
                bail!("CAPTION_RESOURCE_DIGEST: {}", r.id);
            }
            if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR"
            {
                bail!("CAPTION_RESOURCE_FORMAT: {}", r.id);
            }
            let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
            let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
            let size = u64::from(width)
                .checked_mul(u64::from(height))
                .and_then(|n| n.checked_mul(4))
                .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: image dimensions"))?;
            if width == 0
                || height == 0
                || size > 64 * 1024 * 1024
                || decoded as u64 + size > 64 * 1024 * 1024
            {
                bail!("CAPTION_BUDGET_EXCEEDED: decoded images");
            }
            let image = Pixmap::decode_png(&bytes)?;
            decoded += size as usize;
            images.insert(
                r.id.clone(),
                BitmapData {
                    width: image.width(),
                    height: image.height(),
                    rgba: Arc::from(image.data()),
                },
            );
        }
        let sequences = image_sequences::ImageSequenceCache::load(
            &self.style.scene().sequences,
            decoded as u64,
            &mut read,
        )?;
        self.images = images;
        self.sequences = sequences;
        Ok(())
    }
    pub fn into_text_engine(self) -> TextEngine {
        self.text
    }
    pub fn record(&mut self, seconds: f64) -> Result<(FrameOps, Vec<SceneHit>)> {
        let mut budget = Budget::default();
        if !self.style.scene().render_layers.is_empty() {
            self.record_layered_materials(seconds, &mut budget)
        } else if self.style.scene().materials.is_empty() {
            self.record_base(seconds, None, &mut budget)
        } else {
            self.record_materials(seconds, &mut budget)
        }
    }
    fn record_base(
        &mut self,
        seconds: f64,
        only_cue: Option<usize>,
        budget: &mut Budget,
    ) -> Result<(FrameOps, Vec<SceneHit>)> {
        self.record_selected_nodes(seconds, only_cue, None, budget)
    }
    fn record_selected_nodes(
        &mut self,
        seconds: f64,
        only_cue: Option<usize>,
        selected: Option<&[String]>,
        budget: &mut Budget,
    ) -> Result<(FrameOps, Vec<SceneHit>)> {
        if !seconds.is_finite() {
            bail!("CAPTION_SCENE_INVALID: sample time");
        }
        if self.images.len() != self.style.scene().resources.len() {
            bail!("CAPTION_RESOURCE_MISSING: unresolved scene images");
        }
        let mut builder = FrameBuilder::default();
        let mut hits = Vec::new();
        let base_scene = self.style.scene();
        for (ci, cue) in self.cues.iter().enumerate().filter(|(i, c)| {
            only_cue.is_none_or(|id| id == *i) && seconds >= c.start && seconds < c.end
        }) {
            let params = cue_parameters(&self.style, &self.presentation, cue, &self.instance_id)?;
            let context = sampled_layout::early_context(
                cue,
                ci,
                self.cues.len(),
                seconds,
                &params,
                (self.width, self.height),
                &self.instance_id,
                &self.presentation.seed,
            )?;
            let sampled = sampled_layout::sample_scene(base_scene, &context, seconds, budget)?;
            let scene = sampled.as_ref().unwrap_or(base_scene);
            let units = resolved_units(
                &mut self.text,
                &self.layouts,
                ci,
                cue,
                scene,
                sampled.is_some(),
                seconds,
                &params,
                &self.presentation,
                &self.instance_id,
                (self.width, self.height),
                budget,
            )?;
            if units.is_empty() {
                continue;
            }
            let context = RenderContext {
                scene,
                units: &units,
                params: &params,
                seconds,
                seed: u64::from_str_radix(&self.presentation.seed, 16)?,
                instance: &self.instance_id,
                cue,
                size: (self.width, self.height),
                images: &self.images,
            };
            let selected_nodes = selected.map(|ids| {
                scene
                    .nodes
                    .iter()
                    .filter(|n| ids.contains(&n.id))
                    .cloned()
                    .collect::<Vec<_>>()
            });
            draw_nodes(
                selected_nodes.as_deref().unwrap_or(&scene.nodes),
                Transform::identity(),
                None,
                &context,
                &mut self.text,
                &mut builder,
                &mut hits,
                budget,
            )?;
        }
        Ok((builder.finish(), hits))
    }
    /// Preserve ordered blend planes for composition against the actual video backdrop.
    pub fn render_outputs(&mut self, seconds: f64) -> Result<(Vec<SceneOutput>, Vec<SceneHit>)> {
        if self.style.scene().render_layers.is_empty() {
            let frame = self.render(seconds)?;
            return Ok((
                vec![SceneOutput {
                    rgba: frame.rgba,
                    blend: render_raster::drawop::AssociatedBlend::SourceOver,
                }],
                frame.hits,
            ));
        }
        let (ops, hits) = self.record(seconds)?;
        let mut outputs = Vec::new();
        for op in &ops.ops {
            let DrawOp::DrawEmissiveBitmap { bitmap, blend, .. } = op else {
                bail!("CAPTION_SCENE_INVALID: layered output operation");
            };
            let bitmap = &ops.bitmaps[*bitmap as usize];
            outputs.push(SceneOutput {
                rgba: Arc::new(bitmap.rgba.to_vec()),
                blend: *blend,
            });
        }
        Ok((outputs, hits))
    }
    pub fn render(&mut self, seconds: f64) -> Result<SceneFrame> {
        if self
            .style
            .scene()
            .render_layers
            .iter()
            .any(|l| l.blend == CaptionLayerBlend::Screen)
        {
            bail!("CAPTION_BACKDROP_REQUIRED: use render_outputs for screen layers");
        }
        let (ops, hits) = self.record(seconds)?;
        struct NoMedia;
        impl FrameMedia for NoMedia {
            fn frame(&mut self, _: &str, _: i64) -> Result<Arc<Pixmap>> {
                bail!("CAPTION_RESOURCE_MISSING")
            }
        }
        let image = rasterize_with_media(&ops, self.width, self.height, &mut NoMedia)?;
        Ok(SceneFrame {
            rgba: Arc::new(image.data().to_vec()),
            hits,
            fingerprint: render_raster::fingerprint(&ops),
        })
    }
}
fn cue_parameters(
    style: &SceneStyle,
    presentation: &Presentation,
    cue: &SceneCue,
    instance: &str,
) -> Result<BTreeMap<String, Evaluated>> {
    let mut layers = vec![&style.parameters, &presentation.parameters];
    let overrides = presentation
        .cue_overrides
        .iter()
        .filter(|o| o.occurrence_id.is_none())
        .chain(
            presentation
                .cue_overrides
                .iter()
                .filter(|o| o.occurrence_id.is_some()),
        );
    for o in overrides {
        if o.cue_id == cue.id
            && o.occurrence_id
                .as_ref()
                .is_none_or(|id| instance.split_once('|').map_or(instance, |(_, s)| s) == id)
        {
            layers.push(&o.parameters);
        }
    }
    Ok(parameters(style.scene(), &layers)?)
}

// Shared post-layout unit resolution for text recording and page-bound materials.
fn resolved_units(
    text: &mut TextEngine,
    layouts: &BTreeMap<(usize, String), TextLayout>,
    ci: usize,
    cue: &SceneCue,
    scene: &Scene,
    relayout_needed: bool,
    seconds: f64,
    params: &BTreeMap<String, Evaluated>,
    presentation: &Presentation,
    instance: &str,
    size: (u32, u32),
    budget: &mut Budget,
) -> Result<BTreeMap<String, Vec<(Unit, Option<Line>)>>> {
    let mut units = BTreeMap::new();
    for ((idx, id), l) in layouts.iter().filter(|((idx, _), _)| *idx == ci) {
        let _ = idx;
        if let Some(pi) = l
            .pages
            .iter()
            .enumerate()
            .find(|(index, page)| {
                page_window::contains(scene.layout.page_window.as_ref(), page, *index, seconds)
            })
            .map(|(index, _)| index)
        {
            let global = cue_unit_context::enabled(scene);
            let sampled_text_layout;
            let resolved = if relayout_needed {
                let node =
                    sampled_layout::find_text(&scene.nodes, id).expect("validated text node");
                let mut relayout = l.clone();
                let reflow_all = global && !scene.layout.pagination.has_fixed_lines();
                for page_index in 0..l.pages.len() {
                    if page_index != pi && !reflow_all {
                        continue;
                    }
                    relayout.pages[page_index] = if unit_font_size::applies(scene, id) {
                        unit_font_size::reflow(
                            text,
                            l,
                            page_index,
                            cue,
                            node,
                            scene,
                            seconds,
                            size,
                            params,
                            presentation,
                            instance,
                            budget,
                        )?
                    } else {
                        sampled_layout::reflow(
                            text,
                            l,
                            &l.pages[page_index],
                            node,
                            &scene.layout,
                            size,
                            params,
                            budget,
                        )?
                    };
                }
                sampled_text_layout = relayout;
                &sampled_text_layout
            } else {
                l
            };
            let mut resolved_units = units_for(
                cue,
                resolved,
                &resolved.pages[pi],
                seconds,
                &scene.speech_state,
                presentation,
            );
            if page_envelope::enabled(scene) {
                let node =
                    sampled_layout::find_text(&scene.nodes, id).expect("validated text node");
                page_envelope::bind(
                    &mut resolved_units,
                    &resolved.pages[pi],
                    text,
                    &node.style,
                    budget,
                )?;
            }
            if glyph_envelope::enabled(scene) {
                glyph_envelope::bind(&mut resolved_units, &resolved.pages[pi], budget)?;
            }
            if global {
                cue_unit_context::bind(
                    scene,
                    id,
                    resolved,
                    pi,
                    &mut resolved_units,
                    presentation,
                    budget,
                )?;
            }
            units.insert(id.clone(), resolved_units);
        }
    }
    Ok(units)
}

fn text_nodes(nodes: &[Node], out: &mut Vec<Node>) {
    for n in nodes {
        if n.kind == NodeKind::Text {
            out.push(n.clone());
        }
        text_nodes(&n.children, out);
    }
}
fn bind_words(
    cue: &SceneCue,
    content: &str,
    timing: TimingPolicy,
    static_text: bool,
) -> Result<Vec<Word>> {
    let mut words = Vec::new();
    let mut at = 0;
    if !static_text {
        for w in &cue.words {
            if w.text.is_empty() {
                continue;
            }
            let offset = content[at..].find(&w.text).ok_or_else(|| {
                anyhow::anyhow!(
                    "CAPTION_SCENE_INVALID: word {} does not map to cue text",
                    w.id
                )
            })?;
            let a = at + offset;
            let b = a + w.text.len();
            if !w.start.is_finite() || !w.end.is_finite() || w.end < w.start {
                bail!("CAPTION_SCENE_INVALID: word time");
            }
            words.push(Word {
                id: w.id.clone(),
                bytes: a..b,
                span: Some((w.start, w.end)),
                input_timed: true,
            });
            at = b;
        }
    }
    if words.is_empty() {
        for (a, w) in content.unicode_word_indices() {
            words.push(Word {
                id: format!("display-{a}"),
                bytes: a..a + w.len(),
                span: None,
                input_timed: false,
            });
        }
        if words.is_empty() && !content.is_empty() {
            words.push(Word {
                id: "display-0".into(),
                bytes: 0..content.len(),
                span: None,
                input_timed: false,
            });
        }
        if timing == TimingPolicy::Estimated {
            let total = words.len().max(1) as f64;
            for (i, w) in words.iter_mut().enumerate() {
                w.span = Some((
                    cue.start + (cue.end - cue.start) * i as f64 / total,
                    cue.start + (cue.end - cue.start) * (i + 1) as f64 / total,
                ));
            }
        }
    }
    if words.len() > MAX_UNITS {
        bail!("CAPTION_BUDGET_EXCEEDED: words");
    }
    Ok(words)
}
fn quota_paint_start(content: &str, range: &Range<usize>) -> usize {
    let mut start = range.start;
    for (offset, ch) in content[range.clone()].char_indices() {
        if !ch.is_whitespace() {
            break;
        }
        if matches!(
            ch,
            '\n' | '\r' | '\u{000b}' | '\u{000c}' | '\u{0085}' | '\u{2028}' | '\u{2029}'
        ) {
            return range.start;
        }
        start = range.start + offset + ch.len_utf8();
    }
    start
}
fn prepare(
    text: &mut TextEngine,
    cue: &SceneCue,
    node: &Node,
    cfg: &Layout,
    speech: &SpeechState,
    size: (u32, u32),
    parameters: &BTreeMap<String, Evaluated>,
) -> Result<TextLayout> {
    let content = match &node.text {
        Some(TextBinding::Static { text }) => text.as_str(),
        _ => cue.text.as_str(),
    };
    let words = bind_words(
        cue,
        content,
        speech.timing_policy,
        matches!(node.text, Some(TextBinding::Static { .. })),
    )?;
    if cfg.pagination.has_fixed_lines() {
        return word_line_layout::prepare(text, cue, content, words, node, cfg, size, parameters);
    }
    let fs = node.style.font_size.resolve(size.0, size.1, parameters)?;
    let width = cfg.width.resolve(size.0, size.1, parameters)?;
    if !(1.0..=4096.0).contains(&fs) || !(1.0..=65536.0).contains(&width) {
        bail!("CAPTION_SCENE_INVALID: resolved font size or width");
    }
    let max = cfg.pagination.max_units_per_page.unwrap_or(MAX_UNITS);
    let mut ranges = Vec::new();
    let mut from = 0;
    for chunk in words.chunks(max) {
        let end = chunk.last().unwrap().bytes.end;
        ranges.push(from..end);
        from = end;
    }
    if let Some(last) = ranges.last_mut() {
        last.end = content.len();
    }
    let mut pages = Vec::new();
    for (quota_index, range) in ranges.into_iter().enumerate() {
        let paint_origin = if quota_index > 0 && cfg.pagination.max_units_per_page.is_some() {
            quota_paint_start(content, &range)
        } else {
            range.start
        };
        let source = &content[paint_origin..range.end];
        let style = &node.style;
        let block = layout(
            source,
            Wrap::Word,
            Some(width),
            fs * style.line_height,
            |r| {
                let sh = text.shape_spaced(
                    &source[r],
                    &style.font_family,
                    fs,
                    style.font_weight,
                    style.italic,
                    style.letter_spacing * fs,
                );
                TextMetricsLine {
                    width: sh.width,
                    ascent: sh.ascent,
                    descent: sh.descent,
                }
            },
        );
        for (rowgroup_index, rowgroup) in block.lines.chunks(cfg.max_lines).enumerate() {
            let x = cfg.x.resolve(size.0, size.1, parameters)?;
            let y = cfg.y.resolve(size.0, size.1, parameters)?;
            let mut lines = Vec::new();
            let height = rowgroup.len() as f64 * fs * style.line_height;
            for (i, line) in rowgroup.iter().enumerate() {
                let bytes = paint_origin + line.bytes.start..paint_origin + line.paint_end;
                let sh = text.shape_spaced(
                    &content[bytes.clone()],
                    &style.font_family,
                    fs,
                    style.font_weight,
                    style.italic,
                    style.letter_spacing * fs,
                );
                let lx = match cfg.align {
                    Align::Left => x - width / 2.0,
                    Align::Center => x - sh.width / 2.0,
                    Align::Right => x + width / 2.0 - sh.width,
                };
                let ly = y - height / 2.0 + i as f64 * fs * style.line_height;
                let baseline = ly + sh.ascent;
                let bounds = Bounds {
                    x: lx,
                    y: ly,
                    width: sh.width,
                    height: fs * style.line_height,
                };
                lines.push(Line::new(text, bytes, sh, bounds, baseline, fs));
            }
            let Some(first) = lines.first() else { continue };
            let Some(last) = lines.last() else { continue };
            let member = words
                .iter()
                .enumerate()
                .filter(|(_, w)| w.bytes.start < last.bytes.end && w.bytes.end > first.bytes.start)
                .map(|(i, _)| i)
                .collect::<Vec<_>>();
            let bounds = union(lines.iter().map(|l| l.bounds));
            let paint_start = paint_origin + rowgroup.first().unwrap().bytes.start;
            let source_start = if rowgroup_index == 0 && paint_origin > range.start {
                range.start
            } else {
                paint_start
            };
            pages.push(Page {
                source_range: source_start..paint_origin + rowgroup.last().unwrap().bytes.end,
                paint_start,
                lines,
                words: member,
                start: cue.start,
                end: cue.end,
                bounds,
            });
        }
    }
    let count = pages.len().max(1) as f64;
    for (i, p) in pages.iter_mut().enumerate() {
        let first = p.words.first().map(|i| &words[*i]);
        p.start = first
            .and_then(|w| {
                w.span.map(|s| {
                    let byte = p
                        .lines
                        .first()
                        .map_or(w.bytes.start, |l| l.bytes.start)
                        .clamp(w.bytes.start, w.bytes.end);
                    let consumed = content[w.bytes.start..byte].graphemes(true).count();
                    let total = content[w.bytes.clone()].graphemes(true).count().max(1);
                    s.0 + (s.1 - s.0) * consumed as f64 / total as f64
                })
            })
            .unwrap_or(cue.start + (cue.end - cue.start) * i as f64 / count)
            .max(cue.start);
    }
    if cfg.leading_gap == LeadingGap::Show {
        if let Some(p) = pages.first_mut() {
            p.start = cue.start;
        }
    }
    for i in 0..pages.len() {
        pages[i].end = pages.get(i + 1).map_or(cue.end, |p| p.start).min(cue.end);
    }
    Ok(TextLayout {
        pages,
        words,
        content: content.into(),
    })
}
fn union(boxes: impl Iterator<Item = Bounds>) -> Bounds {
    let mut b = None;
    for x in boxes {
        b = Some(match b {
            None => x,
            Some(v) => {
                let v: Bounds = v;
                let left = v.x.min(x.x);
                let top = v.y.min(x.y);
                Bounds {
                    x: left,
                    y: top,
                    width: (v.x + v.width).max(x.x + x.width) - left,
                    height: (v.y + v.height).max(x.y + x.height) - top,
                }
            }
        });
    }
    b.unwrap_or_default()
}
fn span(words: &[Word], members: impl Iterator<Item = usize>, fallback: (f64, f64)) -> (f64, f64) {
    let spans = members.filter_map(|i| words[i].span).collect::<Vec<_>>();
    if spans.is_empty() {
        fallback
    } else {
        (
            spans.iter().map(|s| s.0).fold(f64::INFINITY, f64::min),
            spans.iter().map(|s| s.1).fold(f64::NEG_INFINITY, f64::max),
        )
    }
}
fn active_word(words: &[Word], indices: &[usize], t: f64, cfg: &SpeechState) -> Option<usize> {
    let winner = |predicate: &dyn Fn((f64, f64)) -> bool| {
        indices
            .iter()
            .copied()
            .filter(|i| words[*i].span.is_some_and(predicate))
            .max_by(|a, b| {
                words[*a]
                    .span
                    .unwrap()
                    .0
                    .total_cmp(&words[*b].span.unwrap().0)
                    .then(a.cmp(b))
            })
    };
    if let Some(i) = winner(&|s| s.0 <= t && t < s.1) {
        return Some(i);
    }
    let last = indices
        .iter()
        .filter_map(|i| words[*i].span)
        .map(|s| s.1)
        .fold(f64::NEG_INFINITY, f64::max);
    let hold = if t >= last {
        cfg.tail_policy == TailPolicy::HoldLast
    } else {
        cfg.gap_policy == GapPolicy::HoldPrevious
    };
    if hold {
        winner(&|s| s.0 <= t && s.1 > s.0)
    } else {
        None
    }
}
fn units_for(
    cue: &SceneCue,
    layout: &TextLayout,
    page: &Page,
    t: f64,
    cfg: &SpeechState,
    presentation: &Presentation,
) -> Vec<(Unit, Option<Line>)> {
    let mut spans = BTreeMap::from([
        (UnitKind::Cue, (cue.start, cue.end)),
        (UnitKind::Page, (page.start, page.end)),
    ]);
    let page_ink = if page
        .lines
        .iter()
        .any(|l| l.glyph_ink.iter().any(Option::is_some))
    {
        union(
            page.lines
                .iter()
                .filter(|l| l.glyph_ink.iter().any(Option::is_some))
                .map(|l| l.ink_bounds),
        )
    } else {
        union(page.lines.iter().map(|l| l.ink_bounds))
    };
    let page_index = layout
        .pages
        .iter()
        .position(|candidate| candidate.source_range == page.source_range)
        .unwrap_or(0);
    let mut input_words = cue.words.iter().filter(|word| !word.text.is_empty());
    let cue_first_word_span = input_words.next().map(|word| (word.start, word.end));
    let cue_second_word_start = input_words.next().map(|word| word.start);
    let base = Unit {
        envelope: None,
        page_envelope: None,
        word_position: None,
        line_position: None,
        cue_bindings: None,
        cue_selector: None,
        whitespace: false,
        text_index: 0,
        text_count: 0,
        page_text_index: 0,
        page_text_count: 0,
        first_page_input: page_word_input(layout, layout.pages.first()),
        page_input: page_word_input(layout, Some(page)),
        cue_first_word_span,
        cue_second_word_start,
        word_timed: false,
        next_word_start: None,
        page_index,
        page_count: layout.pages.len(),
        page_last_word_span: page.words.last().and_then(|i| {
            let word = &layout.words[*i];
            word.input_timed.then_some(word.span).flatten()
        }),
        active_word: active_word_clock::clock(&layout.words, page, t, cfg),
        previous_word_in_line: None,
        kind: UnitKind::Cue,
        id: cue.id.clone(),
        index: 0,
        count: 1,
        bytes: 0..layout.content.len(),
        bounds: page.bounds,
        ink_bounds: page_ink,
        line_ink_bounds: page_ink,
        baseline: page.lines.first().map_or(0.0, |l| l.baseline),
        spans: spans.clone(),
        state: WordState::Unread,
        tags: vec![],
    };
    let mut all = vec![(base.clone(), None)];
    let mut p = base.clone();
    p.kind = UnitKind::Page;
    p.index = page_index;
    p.count = layout.pages.len();
    p.id = format!("page-{}", page.lines.first().map_or(0, |l| l.bytes.start));
    all.push((p, None));
    let active = active_word(&layout.words, &page.words, t, cfg);
    for (li, line) in page.lines.iter().enumerate() {
        let members = page
            .words
            .iter()
            .copied()
            .filter(|i| {
                layout.words[*i].bytes.start < line.bytes.end
                    && layout.words[*i].bytes.end > line.bytes.start
            })
            .collect::<Vec<_>>();
        let raw_line_span = span(
            &layout.words,
            members.iter().copied(),
            (page.start, page.end),
        );
        spans.insert(UnitKind::Line, line.display_span.unwrap_or(raw_line_span));
        let mut u = base.clone();
        u.kind = UnitKind::Line;
        u.line_position = Some(li);
        u.index = li;
        u.count = page.lines.len();
        u.id = format!("line-{}", line.bytes.start);
        u.bytes = line.bytes.clone();
        u.bounds = line.bounds;
        u.ink_bounds = line.ink_bounds;
        u.line_ink_bounds = line.ink_bounds;
        u.baseline = line.baseline;
        u.spans = spans.clone();
        u.state = if active.is_some_and(|word| members.contains(&word)) {
            WordState::Active
        } else if !members.is_empty()
            && members
                .iter()
                .all(|i| layout.words[*i].span.is_some_and(|(_, end)| t >= end))
        {
            WordState::Read
        } else {
            WordState::Unread
        };
        all.push((u.clone(), Some(line.clone())));
        let mut previous_word = None;
        for (wi, i) in members.iter().enumerate() {
            let w = &layout.words[*i];
            let mut u = u.clone();
            u.kind = UnitKind::Word;
            u.word_position = Some(*i);
            u.id = w.id.clone();
            u.index = wi;
            u.count = members.len();
            u.bytes = w.bytes.clone();
            u.word_timed = w.input_timed;
            u.next_word_start = if w.input_timed {
                layout
                    .words
                    .get(*i + 1)
                    .filter(|word| word.input_timed)
                    .and_then(|word| word.span.map(|span| span.0))
            } else {
                None
            };
            u.state = if active == Some(*i) {
                WordState::Active
            } else if w.span.is_some_and(|s| t >= s.0) {
                WordState::Read
            } else {
                WordState::Unread
            };
            if let Some(s) = w.span {
                u.spans.insert(UnitKind::Word, s);
            }
            u.tags = presentation
                .word_tags
                .get(&w.id)
                .cloned()
                .unwrap_or_default();
            u.bounds = glyph_bounds(line, &w.bytes);
            u.ink_bounds = line.ink_for(&w.bytes, u.bounds);
            u.previous_word_in_line = previous_word.replace(u.bounds);
            all.push((u.clone(), None));
            let content = &layout.content;
            if w.bytes.end <= content.len()
                && content.is_char_boundary(w.bytes.start)
                && content.is_char_boundary(w.bytes.end)
            {
                let gs = content[w.bytes.clone()]
                    .grapheme_indices(true)
                    .collect::<Vec<_>>();
                for (gi, (at, g)) in gs.iter().enumerate() {
                    let start = w.bytes.start + at;
                    if start < line.bytes.start || start >= line.bytes.end {
                        continue;
                    }
                    let mut gu = u.clone();
                    gu.kind = UnitKind::Grapheme;
                    gu.id = format!("{}:{at}", w.id);
                    gu.index = gi;
                    gu.count = gs.len();
                    gu.bytes = w.bytes.start + at..w.bytes.start + at + g.len();
                    gu.bounds = glyph_bounds(line, &gu.bytes);
                    gu.ink_bounds = line.ink_for(&gu.bytes, gu.bounds);
                    if let Some(s) = w.span {
                        gu.spans.insert(UnitKind::Grapheme, s);
                    }
                    all.push((gu, None));
                }
            }
        }
        // Whitespace has layout/caret geometry but no spoken-word timing.
        // It is opt-in at selection time, preserving existing selector sets.
        let start = if li == 0 {
            page.source_range.start
        } else {
            line.bytes.start
        };
        let end = page
            .lines
            .get(li + 1)
            .map_or(page.source_range.end, |next| next.bytes.start);
        for (offset, grapheme) in layout.content[start..end].grapheme_indices(true) {
            if !grapheme.chars().all(char::is_whitespace) {
                continue;
            }
            let bytes = start + offset..start + offset + grapheme.len();
            let next_word = layout
                .words
                .partition_point(|word| word.bytes.end <= bytes.start);
            if layout
                .words
                .get(next_word)
                .is_some_and(|word| word.bytes.start <= bytes.start && bytes.end <= word.bytes.end)
            {
                continue;
            }
            let mut blank = u.clone();
            blank.kind = UnitKind::Grapheme;
            blank.whitespace = true;
            blank.id = format!("space-{}", bytes.start);
            blank.bytes = bytes;
            blank.index = 0;
            blank.count = 1;
            blank.bounds = whitespace_bounds(line, &blank.bytes);
            blank.ink_bounds = line.ink_for(&blank.bytes, blank.bounds);
            blank.spans.insert(UnitKind::Grapheme, raw_line_span);
            all.push((blank, None));
        }
    }
    let starts = layout
        .content
        .grapheme_indices(true)
        .map(|(at, _)| at)
        .collect::<Vec<_>>();
    let page_start = starts.partition_point(|at| *at < page.source_range.start);
    let page_end = starts.partition_point(|at| *at < page.source_range.end);
    for (unit, _) in &mut all {
        let at = if unit.kind == UnitKind::Page {
            page.source_range.start
        } else {
            unit.bytes.start
        };
        unit.text_index = starts.partition_point(|start| *start < at);
        unit.text_count = starts.len();
        unit.page_text_index = unit.text_index.saturating_sub(page_start);
        unit.page_text_count = page_end - page_start;
    }
    all
}
fn selected(selector: &Selector, unit: &Unit) -> bool {
    unit.kind == selector.unit
        && (!unit.whitespace || selector.include_whitespace)
        && selector.filter.matches(unit.index, unit.state, &unit.tags)
}
fn whitespace_bounds(line: &Line, range: &Range<usize>) -> Bounds {
    // A normalized space may cover multiple source graphemes. They all retain
    // the collapsed space geometry instead of jumping to the visual line end.
    if let Some(glyph) = line.shape.glyphs.iter().find(|glyph| {
        line.bytes.start + glyph.cluster.start < range.end
            && line.bytes.start + glyph.cluster.end > range.start
    }) {
        let start = line.bytes.start + glyph.cluster.start;
        return glyph_bounds(line, &(start..line.bytes.start + glyph.cluster.end));
    }
    let next = line
        .shape
        .glyphs
        .iter()
        .filter(|glyph| line.bytes.start + glyph.cluster.start >= range.end)
        .min_by_key(|glyph| glyph.cluster.start);
    let previous = line
        .shape
        .glyphs
        .iter()
        .filter(|glyph| line.bytes.start + glyph.cluster.end <= range.start)
        .max_by_key(|glyph| glyph.cluster.end);
    let edge = |glyph: &render_raster::fonts::ShapedGlyph, before: bool| {
        let start = line.bytes.start + glyph.cluster.start;
        let bounds = glyph_bounds(line, &(start..line.bytes.start + glyph.cluster.end));
        // Existing shaper direction resolves mixed runs and single-glyph RTL;
        // source order is independent of ascending visual x coordinates.
        if before == glyph.rtl {
            bounds.x + bounds.width
        } else {
            bounds.x
        }
    };
    let x = next.map_or_else(
        || previous.map_or(line.bounds.x, |glyph| edge(glyph, false)),
        |glyph| edge(glyph, true),
    );
    Bounds {
        x,
        y: line.bounds.y,
        width: 0.0,
        height: line.bounds.height,
    }
}
fn glyph_bounds(line: &Line, range: &Range<usize>) -> Bounds {
    let mut boxes = Vec::new();
    for g in &line.shape.glyphs {
        let start = line.bytes.start + g.cluster.start;
        if start < range.start || start >= range.end {
            continue;
        }
        let right = line
            .shape
            .glyphs
            .iter()
            .filter(|other| other.x > g.x)
            .map(|other| other.x)
            .fold(line.shape.width, f64::min);
        boxes.push(Bounds {
            x: line.bounds.x + g.x,
            y: line.bounds.y,
            width: (right - g.x).max(0.0),
            height: line.bounds.height,
        });
    }
    union(boxes.into_iter())
}
struct RenderContext<'a> {
    scene: &'a Scene,
    units: &'a BTreeMap<String, Vec<(Unit, Option<Line>)>>,
    params: &'a BTreeMap<String, Evaluated>,
    seconds: f64,
    seed: u64,
    instance: &'a str,
    cue: &'a SceneCue,
    size: (u32, u32),
    images: &'a BTreeMap<String, BitmapData>,
}
fn context(u: &Unit, r: &RenderContext) -> Context {
    let mut fields = r.params.clone();
    let (a, b) = u
        .spans
        .get(&u.kind)
        .copied()
        .unwrap_or((r.cue.start, r.cue.end));
    let progress = if b > a {
        (r.seconds - a) / (b - a)
    } else if r.seconds < a {
        0.0
    } else {
        1.0
    };
    for (k, t, v) in [
        ("time.seconds", ValueType::Time, r.seconds - r.cue.start),
        ("time.elapsedSeconds", ValueType::Time, r.seconds - a),
        ("time.durationSeconds", ValueType::Time, b - a),
        (
            "time.cueDurationSeconds",
            ValueType::Time,
            r.cue.end - r.cue.start,
        ),
        (
            "time.pageElapsedSeconds",
            ValueType::Time,
            r.seconds - u.spans.get(&UnitKind::Page).map_or(r.cue.start, |s| s.0),
        ),
        (
            "time.pageDurationSeconds",
            ValueType::Time,
            u.spans
                .get(&UnitKind::Page)
                .map_or(r.cue.end - r.cue.start, |s| s.1 - s.0),
        ),
        (
            "time.lineElapsedSeconds",
            ValueType::Time,
            r.seconds - u.spans.get(&UnitKind::Line).map_or(a, |s| s.0),
        ),
        (
            "time.lineDurationSeconds",
            ValueType::Time,
            u.spans.get(&UnitKind::Line).map_or(b - a, |s| s.1 - s.0),
        ),
        (
            "time.pageLastWordElapsedSeconds",
            ValueType::Time,
            u.page_last_word_span.map_or(0.0, |s| r.seconds - s.0),
        ),
        (
            "time.pageLastWordDurationSeconds",
            ValueType::Time,
            u.page_last_word_span.map_or(0.0, |s| s.1 - s.0),
        ),
        (
            "time.cueFirstWordStartSeconds",
            ValueType::Time,
            u.cue_first_word_span
                .map_or(0.0, |span| span.0 - r.cue.start),
        ),
        (
            "time.cueFirstWordEndSeconds",
            ValueType::Time,
            u.cue_first_word_span
                .map_or(0.0, |span| span.1 - r.cue.start),
        ),
        (
            "time.cueSecondWordStartSeconds",
            ValueType::Time,
            u.cue_second_word_start
                .map_or(0.0, |start| start - r.cue.start),
        ),
        (
            "time.nextWordStartSeconds",
            ValueType::Time,
            u.next_word_start.map_or(0.0, |start| start - r.cue.start),
        ),
        (
            "time.firstPageFirstWordStartSeconds",
            ValueType::Time,
            u.first_page_input
                .first_start
                .map_or(0.0, |v| v - r.cue.start),
        ),
        (
            "time.firstPageLastWordEndSeconds",
            ValueType::Time,
            u.first_page_input.last_end.map_or(0.0, |v| v - r.cue.start),
        ),
        (
            "time.firstPageNextWordStartSeconds",
            ValueType::Time,
            u.first_page_input
                .next_start
                .map_or(0.0, |v| v - r.cue.start),
        ),
        (
            "time.pageFirstWordStartSeconds",
            ValueType::Time,
            u.page_input.first_start.map_or(0.0, |v| v - r.cue.start),
        ),
        (
            "time.pageNextWordStartSeconds",
            ValueType::Time,
            u.page_input.next_start.map_or(0.0, |v| v - r.cue.start),
        ),
        ("unit.pageIndex", ValueType::Scalar, u.page_index as f64),
        ("unit.pageCount", ValueType::Scalar, u.page_count as f64),
        ("unit.textIndex", ValueType::Scalar, u.text_index as f64),
        ("unit.textCount", ValueType::Scalar, u.text_count as f64),
        (
            "unit.pageTextIndex",
            ValueType::Scalar,
            u.page_text_index as f64,
        ),
        (
            "unit.pageTextCount",
            ValueType::Scalar,
            u.page_text_count as f64,
        ),
        ("time.progress", ValueType::Scalar, progress),
        (
            "time.clampedProgress",
            ValueType::Scalar,
            progress.clamp(0.0, 1.0),
        ),
        ("unit.index", ValueType::Scalar, u.index as f64),
        ("unit.count", ValueType::Scalar, u.count as f64),
        ("unit.selectedIndex", ValueType::Scalar, u.index as f64),
        ("unit.selectedCount", ValueType::Scalar, u.count as f64),
        ("layout.x", ValueType::Length, u.bounds.x),
        ("layout.y", ValueType::Length, u.bounds.y),
        ("layout.width", ValueType::Length, u.bounds.width),
        ("layout.height", ValueType::Length, u.bounds.height),
        ("layout.baseline", ValueType::Length, u.baseline),
        ("layout.inkX", ValueType::Length, u.ink_bounds.x),
        ("layout.inkY", ValueType::Length, u.ink_bounds.y),
        ("layout.inkWidth", ValueType::Length, u.ink_bounds.width),
        ("layout.inkHeight", ValueType::Length, u.ink_bounds.height),
        ("layout.lineInkY", ValueType::Length, u.line_ink_bounds.y),
        (
            "layout.lineInkHeight",
            ValueType::Length,
            u.line_ink_bounds.height,
        ),
        ("canvas.width", ValueType::Length, r.size.0 as f64),
        ("canvas.height", ValueType::Length, r.size.1 as f64),
    ] {
        fields.insert(k.into(), Evaluated::Number(t, v));
    }
    if !u.spans.contains_key(&u.kind) {
        for path in [
            "time.elapsedSeconds",
            "time.durationSeconds",
            "time.progress",
            "time.clampedProgress",
        ] {
            fields.remove(path);
        }
    }
    for (k, s) in [
        ("unit.active", WordState::Active),
        ("unit.read", WordState::Read),
        ("unit.unread", WordState::Unread),
    ] {
        fields.insert(k.into(), Evaluated::Bool(u.state == s));
    }
    for (path, timed) in [
        (
            "unit.firstPageFirstWordTimed",
            u.first_page_input.first_start.is_some(),
        ),
        (
            "unit.firstPageLastWordTimed",
            u.first_page_input.last_end.is_some(),
        ),
        (
            "unit.firstPageNextWordTimed",
            u.first_page_input.next_start.is_some(),
        ),
        (
            "unit.pageFirstWordTimed",
            u.page_input.first_start.is_some(),
        ),
        ("unit.pageNextWordTimed", u.page_input.next_start.is_some()),
        ("unit.cueFirstWordTimed", u.cue_first_word_span.is_some()),
        ("unit.cueSecondWordTimed", u.cue_second_word_start.is_some()),
        ("unit.wordTimed", u.word_timed),
        ("unit.nextWordTimed", u.next_word_start.is_some()),
    ] {
        fields.insert(path.into(), Evaluated::Bool(timed));
    }
    fields.insert(
        "unit.pageLastWordTimed".into(),
        Evaluated::Bool(u.page_last_word_span.is_some()),
    );
    let mut out = Context {
        fields,
        spans: u.spans.clone(),
        seed: r.seed,
        stable_key: format!("{}|{}|{}", r.instance, r.cue.id, u.id),
    };
    if page_envelope::enabled(r.scene) {
        page_envelope::add_fields(&mut out, u);
    }
    if glyph_envelope::enabled(r.scene) {
        glyph_envelope::add_fields(&mut out, u);
    }
    cue_unit_context::add_fields(&mut out, u);
    if active_word_clock::enabled(r.scene) {
        active_word_clock::add_fields(&mut out.fields, u.active_word, r.seconds);
    }
    if line_neighbor::enabled(r.scene) {
        line_neighbor::add_fields(&mut out.fields, u.previous_word_in_line);
    }
    cue_unit_context::select(&mut out, u, u.cue_selector.as_deref());
    out
}
fn pose(
    node: &Node,
    u: &Unit,
    r: &RenderContext,
    budget: &mut Budget,
) -> Result<BTreeMap<String, Evaluated>> {
    pose_context(node, u, r, budget, context(u, r), None)
}
fn pose_context(
    node: &Node,
    u: &Unit,
    r: &RenderContext,
    budget: &mut Budget,
    mut c: Context,
    font_size_only: Option<bool>,
) -> Result<BTreeMap<String, Evaluated>> {
    let accepts = |name: &str| font_size_only.is_none_or(|only| (name == "fontSize") == only);
    c.stable_key.push_str(&format!("|{}", node.id));
    let mut p = BTreeMap::new();
    if u.kind == UnitKind::Cue
        || matches!(
            node.kind,
            NodeKind::Shape | NodeKind::Image | NodeKind::Label
        )
    {
        p.insert("fill".into(), Evaluated::Color(color(&node.style.fill)?));
        if node.kind == NodeKind::Label && accepts("fontSize") {
            p.insert(
                "fontSize".into(),
                Evaluated::Number(
                    ValueType::Length,
                    node.style.font_size.resolve(r.size.0, r.size.1, r.params)?,
                ),
            );
        }
        for (name, value) in &node.properties {
            if !accepts(name) {
                continue;
            }
            if let Some(v) = sample_value(
                value,
                property_type(name).unwrap(),
                r.scene,
                &c,
                r.seconds,
                budget,
            )? {
                p.insert(name.clone(), v);
            }
        }
    }
    if u.kind == UnitKind::Word {
        if let Some(fill) = node.state_styles.get(&u.state) {
            p.insert("fill".into(), Evaluated::Color(color(fill)?));
        }
    }
    let mut tracks = r
        .scene
        .animations
        .iter()
        .filter(|a| a.target.node_id == node.id && accepts(&a.property))
        .collect::<Vec<_>>();
    tracks.sort_by_key(|a| a.priority);
    for a in tracks {
        let matches_target = match &a.target.selector_id {
            None => {
                u.kind == UnitKind::Cue
                    || matches!(
                        node.kind,
                        NodeKind::Shape | NodeKind::Image | NodeKind::Label
                    )
            }
            Some(id) => r
                .scene
                .selectors
                .iter()
                .find(|s| s.id == *id)
                .is_some_and(|s| selected(s, u)),
        };
        if !matches_target {
            continue;
        }
        // Missing real word timing disables spoken tracks; it never manufactures speech times.
        if let DynamicValue::Keyframes { clock, .. } = &a.value {
            if !c.spans.contains_key(&clock.unit) {
                continue;
            }
        }
        if let Some(id) = &a.target.selector_id {
            let sel = r.scene.selectors.iter().find(|s| s.id == *id).unwrap();
            if let Some(units) = r.units.get(&node.id) {
                let selected = units
                    .iter()
                    .filter(|(v, _)| selected(sel, v))
                    .collect::<Vec<_>>();
                let index = selected.iter().position(|(v, _)| v.id == u.id).unwrap_or(0);
                c.fields.insert(
                    "unit.selectedIndex".into(),
                    Evaluated::Number(ValueType::Scalar, index as f64),
                );
                c.fields.insert(
                    "unit.selectedCount".into(),
                    Evaluated::Number(ValueType::Scalar, selected.len() as f64),
                );
            }
        }
        cue_unit_context::select(
            &mut c,
            u,
            a.target
                .selector_id
                .as_deref()
                .or(u.cue_selector.as_deref()),
        );
        c.stable_key = format!("{}|{}|{}|{}|{}", r.instance, r.cue.id, u.id, node.id, a.id);
        if let Some(v) = sample_value(
            &a.value,
            property_type(&a.property).unwrap(),
            r.scene,
            &c,
            r.seconds,
            budget,
        )? {
            let out = if a.composite == Composite::Replace {
                v
            } else {
                let old = p
                    .get(&a.property)
                    .map(|v| v.number())
                    .transpose()?
                    .unwrap_or_else(|| default_number(&a.property));
                Evaluated::Number(
                    v.value_type(),
                    if a.composite == Composite::Add {
                        old + v.number()?
                    } else {
                        old * v.number()?
                    },
                )
                .finite()?
            };
            p.insert(a.property.clone(), out);
        }
    }
    if p.values()
        .any(|v| matches!(v,Evaluated::Number(_,n) if !n.is_finite() || n.abs()>1_000_000.0))
    {
        bail!("CAPTION_BUDGET_EXCEEDED: geometry range");
    }
    Ok(p)
}
fn default_number(name: &str) -> f64 {
    if name.starts_with("transform.scale") || name == "opacity" {
        1.0
    } else {
        0.0
    }
}
fn number(p: &BTreeMap<String, Evaluated>, name: &str) -> f64 {
    p.get(name)
        .and_then(|v| v.number().ok())
        .unwrap_or_else(|| default_number(name))
}
fn matrix(p: &BTreeMap<String, Evaluated>, b: Bounds) -> Transform {
    let x = b.x + b.width / 2.0;
    let y = b.y + b.height / 2.0;
    let sx = number(p, "transform.scale") * number(p, "transform.scaleX");
    let sy = number(p, "transform.scale") * number(p, "transform.scaleY");
    let a = number(p, "transform.rotation");
    let (sin, cos) = (libm_sin(a), libm_cos(a));
    Transform::from_row(
        (cos * sx) as f32,
        (sin * sx) as f32,
        (-sin * sy) as f32,
        (cos * sy) as f32,
        (x + number(p, "transform.x") - cos * sx * x + sin * sy * y) as f32,
        (y + number(p, "transform.y") - sin * sx * x - cos * sy * y) as f32,
    )
}
fn libm_sin(x: f64) -> f64 {
    libm::sin(x)
}
fn libm_cos(x: f64) -> f64 {
    libm::cos(x)
}
fn tf(t: Transform) -> [f32; 6] {
    [t.sx, t.ky, t.kx, t.sy, t.tx, t.ty]
}
fn draw_nodes(
    nodes: &[Node],
    parent: Transform,
    bound: Option<&Unit>,
    r: &RenderContext,
    text: &mut TextEngine,
    b: &mut FrameBuilder,
    hits: &mut Vec<SceneHit>,
    budget: &mut Budget,
) -> Result<()> {
    let mut nodes = nodes.iter().collect::<Vec<_>>();
    nodes.sort_by_key(|n| n.z_index);
    for n in nodes {
        budget.spend()?;
        if n.kind == NodeKind::Repeat {
            let s = r
                .scene
                .selectors
                .iter()
                .find(|s| Some(&s.id) == n.selector_id.as_ref())
                .unwrap();
            if let Some(units) = r.units.get(&s.node_id) {
                for (u, _) in units.iter().filter(|(u, _)| selected(s, u)) {
                    if u.cue_bindings.is_some() {
                        let mut bound = u.clone();
                        bound.cue_selector = Some(s.id.clone());
                        draw_nodes(&n.children, parent, Some(&bound), r, text, b, hits, budget)?;
                    } else {
                        draw_nodes(&n.children, parent, Some(u), r, text, b, hits, budget)?;
                    }
                }
            }
            continue;
        }
        let root = r
            .units
            .get(&n.id)
            .and_then(|u| u.first())
            .or_else(|| r.units.values().next().and_then(|u| u.first()))
            .map(|(u, _)| u)
            .unwrap();
        let u = bound.unwrap_or(root);
        if n.kind == NodeKind::Label {
            let unit =
                bound.ok_or_else(|| anyhow::anyhow!("CAPTION_SCENE_INVALID: unbound label"))?;
            bound_label::draw(n, unit, parent, r, text, b, budget)?;
            continue;
        }
        let p = pose(n, u, r, budget)?;
        // Still evaluate all leaf properties (and their diagnostics), but do not
        // allocate an offscreen surface for an invisible decoration.
        if matches!(n.kind, NodeKind::Shape | NodeKind::Image) && number(&p, "opacity") <= 0.0 {
            continue;
        }
        let t = parent.pre_concat(matrix(&p, u.bounds));
        b.push(DrawOp::PushLayer {
            opacity: number(&p, "opacity").clamp(0.0, 1.0) as f32,
            blend: motion::effect::BlendMode::Normal,
        });
        match n.kind {
            NodeKind::Group => draw_nodes(&n.children, t, bound, r, text, b, hits, budget)?,
            NodeKind::Shape => {
                let Evaluated::Color(c) = p["fill"] else {
                    unreachable!()
                };
                b.push(DrawOp::FillRect {
                    x: u.bounds.x as f32,
                    y: u.bounds.y as f32,
                    w: p.get("width")
                        .map_or(u.bounds.width, |v| v.number().unwrap())
                        .max(0.0) as f32,
                    h: p.get("height")
                        .map_or(u.bounds.height, |v| v.number().unwrap())
                        .max(0.0) as f32,
                    radius: number(&p, "radius").max(0.0) as f32,
                    color: c.map(|x| x.clamp(0.0, 1.0) as f32),
                    tf: tf(t),
                });
            }
            NodeKind::Image => {
                let resource = n.resource_id.as_ref().unwrap();
                let image = r
                    .images
                    .get(resource)
                    .ok_or_else(|| anyhow::anyhow!("CAPTION_RESOURCE_MISSING: {resource}"))?;
                let width = p
                    .get("width")
                    .map_or(u.bounds.width, |v| v.number().unwrap())
                    .max(0.0);
                let height = p
                    .get("height")
                    .map_or(u.bounds.height, |v| v.number().unwrap())
                    .max(0.0);
                if width > 0.0 && height > 0.0 {
                    let sx = width / image.width as f64;
                    let sy = height / image.height as f64;
                    let (sx, sy) = match n.fit {
                        ImageFit::Contain => (sx.min(sy), sx.min(sy)),
                        ImageFit::Cover => (sx.max(sy), sx.max(sy)),
                        ImageFit::Stretch => (sx, sy),
                    };
                    let x = u.bounds.x + (width - image.width as f64 * sx) / 2.0;
                    let y = u.bounds.y + (height - image.height as f64 * sy) / 2.0;
                    if n.fit == ImageFit::Cover {
                        let path = render_raster::raster::rounded_rect_path(
                            u.bounds.x, u.bounds.y, width, height, 0.0,
                        )
                        .ok_or_else(|| anyhow::anyhow!("CAPTION_SCENE_INVALID: image bounds"))?;
                        let id = b.path_id(path_from_skia(&path));
                        b.push(DrawOp::ClipPath {
                            path: id,
                            tf: tf(t),
                        });
                    }
                    let bitmap = b.bitmap_id(image.clone());
                    b.push(DrawOp::DrawBitmap {
                        bitmap,
                        opacity: 1.0,
                        tf: tf(t
                            .pre_translate(x as f32, y as f32)
                            .pre_scale(sx as f32, sy as f32)),
                    });
                    if n.fit == ImageFit::Cover {
                        b.push(DrawOp::PopClip);
                    }
                }
            }
            NodeKind::Text => {
                if let Some(units) = r.units.get(&n.id) {
                    let page = units
                        .iter()
                        .find(|(u, _)| u.kind == UnitKind::Page)
                        .unwrap();
                    let pp = pose(n, &page.0, r, budget)?;
                    let t = t.pre_concat(matrix(&pp, page.0.bounds));
                    for (lineunit, line) in units.iter().filter(|(u, _)| u.kind == UnitKind::Line) {
                        let line = line.as_ref().unwrap();
                        let lp = pose(n, lineunit, r, budget)?;
                        let lt = t.pre_concat(matrix(&lp, lineunit.bounds));
                        let mut hit_boxes = Vec::new();
                        for glyph in &line.shape.glyphs {
                            budget.spend()?;
                            let at = line.bytes.start + glyph.cluster.start;
                            let word = units
                                .iter()
                                .find(|(u, _)| u.kind == UnitKind::Word && u.bytes.contains(&at))
                                .map(|(u, _)| u);
                            let grapheme = units
                                .iter()
                                .find(|(u, _)| {
                                    u.kind == UnitKind::Grapheme && u.bytes.contains(&at)
                                })
                                .map(|(u, _)| u);
                            let mut gt = lt;
                            let mut fill = lp
                                .get("fill")
                                .or_else(|| pp.get("fill"))
                                .unwrap_or(&p["fill"])
                                .clone();
                            let mut opacity = number(&lp, "opacity") * number(&pp, "opacity");
                            for unit in [word, grapheme].into_iter().flatten() {
                                let up = pose(n, unit, r, budget)?;
                                gt = gt.pre_concat(matrix(&up, unit.bounds));
                                if let Some(v) = up.get("fill") {
                                    fill = v.clone();
                                }
                                opacity *= number(&up, "opacity");
                            }
                            if opacity > 0.0 && number(&p, "opacity") > 0.0 {
                                let source = glyph_bounds(line, &(at..at + 1));
                                let mut points = [
                                    tiny_skia::Point::from_xy(source.x as f32, source.y as f32),
                                    tiny_skia::Point::from_xy(
                                        (source.x + source.width) as f32,
                                        source.y as f32,
                                    ),
                                    tiny_skia::Point::from_xy(
                                        source.x as f32,
                                        (source.y + source.height) as f32,
                                    ),
                                    tiny_skia::Point::from_xy(
                                        (source.x + source.width) as f32,
                                        (source.y + source.height) as f32,
                                    ),
                                ];
                                gt.map_points(&mut points);
                                let min_x = points
                                    .iter()
                                    .map(|p| p.x as f64)
                                    .fold(f64::INFINITY, f64::min);
                                let min_y = points
                                    .iter()
                                    .map(|p| p.y as f64)
                                    .fold(f64::INFINITY, f64::min);
                                let max_x = points
                                    .iter()
                                    .map(|p| p.x as f64)
                                    .fold(f64::NEG_INFINITY, f64::max);
                                let max_y = points
                                    .iter()
                                    .map(|p| p.y as f64)
                                    .fold(f64::NEG_INFINITY, f64::max);
                                hit_boxes.push(Bounds {
                                    x: min_x,
                                    y: min_y,
                                    width: max_x - min_x,
                                    height: max_y - min_y,
                                });
                            }
                            let Evaluated::Color(mut c) = fill else {
                                unreachable!()
                            };
                            c[3] *= opacity.clamp(0.0, 1.0);
                            let origin = gt.pre_translate(
                                (line.bounds.x + glyph.x) as f32,
                                (line.baseline + glyph.y) as f32,
                            );
                            bound_label::record_glyph(
                                &n.style,
                                glyph,
                                c,
                                opacity,
                                origin,
                                line.bounds,
                                (line.bounds.x + glyph.x, line.baseline + glyph.y),
                                text,
                                b,
                                budget,
                            )?;
                        }
                        hits.push(SceneHit {
                            cue_id: r.cue.id.clone(),
                            document_id: r.cue.document_id.clone(),
                            bounds: union(hit_boxes.into_iter()),
                        });
                    }
                }
            }
            NodeKind::Repeat | NodeKind::Label => unreachable!(),
        }
        b.push(DrawOp::PopLayer);
    }
    Ok(())
}

fn scene_paint(
    paint: &ScenePaint,
    bounds: Bounds,
    origin: (f64, f64),
    opacity: f64,
) -> Result<PaintData> {
    let rgba = |c: &str| -> Result<[f32; 4]> {
        let mut c = color(c)?;
        c[3] *= opacity.clamp(0.0, 1.0);
        Ok(c.map(|c| c as f32))
    };
    Ok(match paint {
        ScenePaint::Solid { color } => PaintData::Solid(rgba(color)?),
        ScenePaint::Linear { from, to, stops } => {
            let point = |v: [f64; 2]| {
                [
                    (bounds.x + v[0] * bounds.width - origin.0) as f32,
                    (bounds.y + v[1] * bounds.height - origin.1) as f32,
                ]
            };
            PaintData::Linear {
                p0: point(*from),
                p1: point(*to),
                stops: stops
                    .iter()
                    .map(|s| {
                        Ok(GradientStop {
                            offset: s.at as f32,
                            color: rgba(&s.color)?,
                        })
                    })
                    .collect::<Result<Vec<_>>>()?,
            }
        }
    })
}

#[cfg(test)]
mod ink_tests {
    use super::*;
    fn input(
        content: &str,
        line_height: f64,
    ) -> (
        TextEngine,
        SceneStyle,
        SceneCue,
        BTreeMap<String, Evaluated>,
    ) {
        let mut body: serde_json::Value = serde_json::from_str(include_str!(
            "../../caption-scene/tests/fixtures/word-pop.json"
        ))
        .unwrap();
        body["scene"]["value"]["nodes"][0]["style"]["fontSize"] =
            serde_json::json!({"value": 24, "basis":"absolute"});
        body["scene"]["value"]["nodes"][0]["style"]["lineHeight"] = serde_json::json!(line_height);
        body["scene"]["value"]["layout"]["pagination"] = serde_json::json!({"maxUnitsPerPage":128});
        let style = parse_style(&body).unwrap();
        let params = parameters(style.scene(), &[]).unwrap();
        let text = TextEngine::with_document_fonts(&[include_bytes!(
            "../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
        )
        .to_vec()]);
        let cue = SceneCue {
            id: "cue".into(),
            document_id: "doc".into(),
            text: content.into(),
            start: 0.0,
            end: 4.0,
            words: vec![],
        };
        (text, style, cue, params)
    }
    #[test]
    fn ink_line_height_is_independent_of_leading_and_spaces_inherit_it() {
        let measure = |line_height| {
            let (mut text, style, cue, params) = input("Ag e\u{301} ", line_height);
            let scene = style.scene();
            let layout = prepare(
                &mut text,
                &cue,
                &scene.nodes[0],
                &scene.layout,
                &scene.speech_state,
                (160, 90),
                &params,
            )
            .unwrap();
            let page = &layout.pages[0];
            assert_eq!(page.lines.len(), 1);
            let line = &page.lines[0];
            let units = units_for(
                &cue,
                &layout,
                page,
                0.5,
                &scene.speech_state,
                &Presentation::default(),
            );
            let spaces = units
                .iter()
                .filter(|(u, _)| u.whitespace)
                .collect::<Vec<_>>();
            assert_eq!(spaces.len(), 2);
            for (space, _) in spaces {
                assert_eq!(space.ink_bounds.y, line.ink_bounds.y);
                assert_eq!(space.ink_bounds.height, line.ink_bounds.height);
                assert_eq!(space.ink_bounds.x, space.bounds.x);
                assert_eq!(space.ink_bounds.width, space.bounds.width);
            }
            for (unit, _) in &units {
                assert_eq!(unit.line_ink_bounds.y, line.ink_bounds.y);
                assert_eq!(unit.line_ink_bounds.height, line.ink_bounds.height);
            }
            (
                line.ink_bounds.y - line.baseline,
                line.ink_bounds.height,
                line.bounds.height,
            )
        };
        let tight = measure(1.0);
        let loose = measure(3.0);
        assert!((tight.0 - loose.0).abs() < 1e-9);
        assert_eq!(tight.1, loose.1);
        assert_eq!(loose.2, tight.2 * 3.0);
        assert!(loose.1 < loose.2);
    }
    #[test]
    fn whitespace_only_line_uses_font_metrics_not_line_height() {
        let mut text = TextEngine::with_document_fonts(&[]);
        let shape = ShapedLine {
            width: 12.0,
            ascent: 15.0,
            descent: 5.0,
            glyphs: vec![],
        };
        let line = Line::new(
            &mut text,
            0..1,
            shape,
            Bounds {
                x: 10.0,
                y: 20.0,
                width: 12.0,
                height: 100.0,
            },
            35.0,
            20.0,
        );
        assert_eq!(
            (
                line.ink_bounds.x,
                line.ink_bounds.y,
                line.ink_bounds.width,
                line.ink_bounds.height
            ),
            (10.0, 20.0, 12.0, 20.0)
        );
        let space = line.ink_for(&(0..1), line.bounds);
        assert_eq!(space.height, 20.0);
    }
    #[test]
    fn sampled_reflow_refreshes_ink_without_mutating_the_frozen_layout() {
        let (mut text, style, cue, params) = input("Ag", 2.5);
        let scene = style.scene();
        let layout = prepare(
            &mut text,
            &cue,
            &scene.nodes[0],
            &scene.layout,
            &scene.speech_state,
            (160, 90),
            &params,
        )
        .unwrap();
        let before = layout.pages[0].lines[0].ink_bounds.height;
        let mut node = scene.nodes[0].clone();
        node.style.font_size.value *= 2.0;
        let page = sampled_layout::reflow(
            &mut text,
            &layout,
            &layout.pages[0],
            &node,
            &scene.layout,
            (160, 90),
            &params,
            &mut Budget::default(),
        )
        .unwrap();
        assert!((page.lines[0].ink_bounds.height / before - 2.0).abs() < 0.05);
        assert_eq!(layout.pages[0].lines[0].ink_bounds.height, before);
    }

    #[test]
    fn line_state_uses_word_membership_and_respects_gap_tail_and_missing_timing() {
        let (mut text, style, mut cue, params) = input("A\nB", 1.0);
        cue.words = vec![
            SceneWord {
                id: "a".into(),
                text: "A".into(),
                start: 0.0,
                end: 0.5,
            },
            SceneWord {
                id: "b".into(),
                text: "B".into(),
                start: 1.0,
                end: 1.5,
            },
        ];
        let scene = style.scene();
        let layout = prepare(
            &mut text,
            &cue,
            &scene.nodes[0],
            &scene.layout,
            &scene.speech_state,
            (160, 90),
            &params,
        )
        .unwrap();
        let mut cfg = scene.speech_state.clone();
        cfg.gap_policy = GapPolicy::None;
        cfg.tail_policy = TailPolicy::None;
        let states = |t, cfg: &SpeechState| {
            units_for(
                &cue,
                &layout,
                &layout.pages[0],
                t,
                cfg,
                &Presentation::default(),
            )
            .into_iter()
            .filter(|(u, _)| u.kind == UnitKind::Line)
            .map(|(u, _)| u.state)
            .collect::<Vec<_>>()
        };
        assert_eq!(
            states(0.25, &cfg),
            vec![WordState::Active, WordState::Unread]
        );
        assert_eq!(states(0.75, &cfg), vec![WordState::Read, WordState::Unread]);
        cfg.gap_policy = GapPolicy::HoldPrevious;
        assert_eq!(
            states(0.75, &cfg),
            vec![WordState::Active, WordState::Unread]
        );
        assert_eq!(states(1.75, &cfg), vec![WordState::Read, WordState::Read]);
        cfg.tail_policy = TailPolicy::HoldLast;
        assert_eq!(states(1.75, &cfg), vec![WordState::Read, WordState::Active]);
        cue.words.clear();
        let untimed = prepare(
            &mut text,
            &cue,
            &scene.nodes[0],
            &scene.layout,
            &cfg,
            (160, 90),
            &params,
        )
        .unwrap();
        assert!(
            units_for(
                &cue,
                &untimed,
                &untimed.pages[0],
                3.0,
                &cfg,
                &Presentation::default()
            )
            .iter()
            .filter(|(u, _)| u.kind == UnitKind::Line)
            .all(|(u, _)| u.state == WordState::Unread)
        );
    }
    #[test]
    fn stable_page_identity_survives_per_sample_clone_and_is_shared_by_all_units() {
        let (mut text, mut style, cue, params) = input("A B C D", 1.0);
        let SceneSource::Inline { value: scene } = &mut style.scene;
        scene.layout.pagination.max_units_per_page = Some(1);
        let layout = prepare(
            &mut text,
            &cue,
            &scene.nodes[0],
            &scene.layout,
            &scene.speech_state,
            (160, 90),
            &params,
        )
        .unwrap();
        assert_eq!(layout.pages.len(), 4);
        let page = sampled_layout::reflow(
            &mut text,
            &layout,
            &layout.pages[2],
            &scene.nodes[0],
            &scene.layout,
            (160, 90),
            &params,
            &mut Budget::default(),
        )
        .unwrap();
        let units = units_for(
            &cue,
            &layout,
            &page,
            2.5,
            &scene.speech_state,
            &Presentation::default(),
        );
        assert!(
            units
                .iter()
                .all(|(u, _)| u.page_index == 2 && u.page_count == 4)
        );
        assert_eq!(
            units
                .iter()
                .find(|(u, _)| u.kind == UnitKind::Page)
                .unwrap()
                .0
                .index,
            2
        );
    }
    #[test]
    fn line_clock_is_inherited_by_words_and_graphemes_with_explicit_parent_fallback() {
        let (mut text, style, mut cue, params) = input("A\nB", 1.0);
        cue.words = vec![
            SceneWord {
                id: "a".into(),
                text: "A".into(),
                start: 0.0,
                end: 0.5,
            },
            SceneWord {
                id: "b".into(),
                text: "B".into(),
                start: 1.0,
                end: 1.5,
            },
        ];
        let scene = style.scene();
        let layout = prepare(
            &mut text,
            &cue,
            &scene.nodes[0],
            &scene.layout,
            &scene.speech_state,
            (160, 90),
            &params,
        )
        .unwrap();
        let units = units_for(
            &cue,
            &layout,
            &layout.pages[0],
            1.25,
            &scene.speech_state,
            &Presentation::default(),
        );
        let unit_map = BTreeMap::new();
        let images = BTreeMap::new();
        let r = RenderContext {
            scene,
            units: &unit_map,
            params: &params,
            seconds: 1.25,
            seed: 0,
            instance: "test",
            cue: &cue,
            size: (160, 90),
            images: &images,
        };
        for (u, _) in &units {
            let c = context(u, &r);
            let expected = u
                .spans
                .get(&UnitKind::Line)
                .or_else(|| u.spans.get(&u.kind))
                .unwrap();
            assert_eq!(
                c.fields["time.lineElapsedSeconds"].number().unwrap(),
                1.25 - expected.0
            );
            assert_eq!(
                c.fields["time.lineDurationSeconds"].number().unwrap(),
                expected.1 - expected.0
            );
            if matches!(u.kind, UnitKind::Word | UnitKind::Grapheme) && u.bytes.start == 2 {
                assert_eq!(c.fields["time.lineElapsedSeconds"].number().unwrap(), 0.25);
                assert_eq!(c.fields["time.lineDurationSeconds"].number().unwrap(), 0.5);
            }
        }
    }

    fn bound_contexts(
        cue: &SceneCue,
        scene: &Scene,
        layout: &TextLayout,
        page: usize,
        t: f64,
        params: &BTreeMap<String, Evaluated>,
    ) -> Vec<(Unit, Context)> {
        let units = units_for(
            cue,
            layout,
            &layout.pages[page],
            t,
            &scene.speech_state,
            &Presentation::default(),
        );
        let empty_units = BTreeMap::new();
        let images = BTreeMap::new();
        let r = RenderContext {
            scene,
            units: &empty_units,
            params,
            seconds: t,
            seed: 0,
            instance: "word-context",
            cue,
            size: (160, 90),
            images: &images,
        };
        units
            .into_iter()
            .map(|(unit, _)| {
                let c = context(&unit, &r);
                (unit, c)
            })
            .collect()
    }
    #[test]
    fn cue_word_context_preserves_real_gaps_and_next_word_across_pages() {
        let (mut text, mut style, mut cue, params) = input("Alpha Beta Gamma", 1.0);
        cue.start = 10.0;
        cue.end = 14.0;
        cue.words = vec![
            SceneWord {
                id: "empty".into(),
                text: "".into(),
                start: 0.0,
                end: 0.0,
            },
            SceneWord {
                id: "a".into(),
                text: "Alpha".into(),
                start: 9.5,
                end: 10.25,
            },
            SceneWord {
                id: "b".into(),
                text: "Beta".into(),
                start: 11.0,
                end: 11.0,
            },
            SceneWord {
                id: "c".into(),
                text: "Gamma".into(),
                start: 12.4,
                end: 13.4,
            },
        ];
        let SceneSource::Inline { value: scene } = &mut style.scene;
        scene.layout.pagination.max_units_per_page = Some(1);
        let layout = prepare(
            &mut text,
            &cue,
            &scene.nodes[0],
            &scene.layout,
            &scene.speech_state,
            (160, 90),
            &params,
        )
        .unwrap();
        assert_eq!(layout.pages.len(), 3);
        for (page, t, next) in [(0, 10.1, Some(1.0)), (1, 11.2, Some(2.4)), (2, 12.5, None)] {
            for (u, c) in bound_contexts(&cue, scene, &layout, page, t, &params) {
                assert!(c.fields["unit.cueFirstWordTimed"].boolean().unwrap());
                assert!(c.fields["unit.cueSecondWordTimed"].boolean().unwrap());
                assert_eq!(
                    c.fields["time.cueFirstWordStartSeconds"].number().unwrap(),
                    -0.5
                );
                assert_eq!(
                    c.fields["time.cueFirstWordEndSeconds"].number().unwrap(),
                    0.25
                );
                assert_eq!(
                    c.fields["time.cueSecondWordStartSeconds"].number().unwrap(),
                    1.0
                );
                if matches!(u.kind, UnitKind::Word | UnitKind::Grapheme) && !u.whitespace {
                    assert!(c.fields["unit.wordTimed"].boolean().unwrap());
                    assert_eq!(
                        c.fields["unit.nextWordTimed"].boolean().unwrap(),
                        next.is_some()
                    );
                    assert!(
                        (c.fields["time.nextWordStartSeconds"].number().unwrap()
                            - next.unwrap_or(0.0))
                        .abs()
                            < 1e-12
                    );
                    if page == 0 {
                        assert_eq!(u.spans[&UnitKind::Word], (9.5, 10.25));
                    }
                    if page == 1 {
                        assert_eq!(u.spans[&UnitKind::Word], (11.0, 11.0));
                    }
                } else {
                    assert!(!c.fields["unit.wordTimed"].boolean().unwrap());
                    assert!(!c.fields["unit.nextWordTimed"].boolean().unwrap());
                    assert_eq!(c.fields["time.nextWordStartSeconds"].number().unwrap(), 0.0);
                }
            }
        }
    }
    #[test]
    fn cue_word_context_does_not_claim_estimated_or_static_word_binding() {
        let (mut text, mut style, mut cue, params) = input("One two", 1.0);
        let SceneSource::Inline { value: scene } = &mut style.scene;
        scene.speech_state.timing_policy = TimingPolicy::Estimated;
        let layout = prepare(
            &mut text,
            &cue,
            &scene.nodes[0],
            &scene.layout,
            &scene.speech_state,
            (160, 90),
            &params,
        )
        .unwrap();
        assert!(layout.words.iter().all(|word| word.span.is_some()));
        for (_, c) in bound_contexts(&cue, scene, &layout, 0, 0.5, &params) {
            for key in [
                "unit.cueFirstWordTimed",
                "unit.cueSecondWordTimed",
                "unit.wordTimed",
                "unit.nextWordTimed",
            ] {
                assert!(!c.fields[key].boolean().unwrap(), "{key}");
            }
            for key in [
                "time.cueFirstWordStartSeconds",
                "time.cueFirstWordEndSeconds",
                "time.cueSecondWordStartSeconds",
                "time.nextWordStartSeconds",
            ] {
                assert_eq!(c.fields[key].number().unwrap(), 0.0, "{key}");
            }
        }
        cue.words = vec![
            SceneWord {
                id: "a".into(),
                text: "One".into(),
                start: 0.0,
                end: 0.0,
            },
            SceneWord {
                id: "b".into(),
                text: "two".into(),
                start: 2.5,
                end: 3.0,
            },
        ];
        scene.nodes[0].text = Some(TextBinding::Static {
            text: "Standalone".into(),
        });
        let layout = prepare(
            &mut text,
            &cue,
            &scene.nodes[0],
            &scene.layout,
            &scene.speech_state,
            (160, 90),
            &params,
        )
        .unwrap();
        for (_, c) in bound_contexts(&cue, scene, &layout, 0, 0.5, &params) {
            assert!(c.fields["unit.cueFirstWordTimed"].boolean().unwrap());
            assert!(c.fields["unit.cueSecondWordTimed"].boolean().unwrap());
            assert_eq!(
                c.fields["time.cueFirstWordStartSeconds"].number().unwrap(),
                0.0
            );
            assert_eq!(
                c.fields["time.cueFirstWordEndSeconds"].number().unwrap(),
                0.0
            );
            assert_eq!(
                c.fields["time.cueSecondWordStartSeconds"].number().unwrap(),
                2.5
            );
            assert!(!c.fields["unit.wordTimed"].boolean().unwrap());
            assert!(!c.fields["unit.nextWordTimed"].boolean().unwrap());
            assert_eq!(c.fields["time.nextWordStartSeconds"].number().unwrap(), 0.0);
        }
        cue.words.pop();
        for (_, c) in bound_contexts(&cue, scene, &layout, 0, 0.5, &params) {
            assert!(c.fields["unit.cueFirstWordTimed"].boolean().unwrap());
            assert!(!c.fields["unit.cueSecondWordTimed"].boolean().unwrap());
            assert_eq!(
                c.fields["time.cueSecondWordStartSeconds"].number().unwrap(),
                0.0
            );
        }
    }

    #[test]
    fn first_page_input_context_keeps_actual_boundaries_across_page_and_reflow() {
        let (mut text, mut style, mut cue, params) = input("Alpha Beta Gamma", 1.0);
        cue.start = 10.0;
        cue.end = 16.0;
        cue.words = vec![
            SceneWord {
                id: "a".into(),
                text: "Alpha".into(),
                start: 9.5,
                end: 10.5,
            },
            SceneWord {
                id: "b".into(),
                text: "Beta".into(),
                start: 11.0,
                end: 11.25,
            },
            SceneWord {
                id: "c".into(),
                text: "Gamma".into(),
                start: 13.0,
                end: 14.0,
            },
        ];
        let SceneSource::Inline { value: scene } = &mut style.scene;
        scene.layout.pagination.max_units_per_page = Some(2);
        let layout = prepare(
            &mut text,
            &cue,
            &scene.nodes[0],
            &scene.layout,
            &scene.speech_state,
            (160, 90),
            &params,
        )
        .unwrap();
        assert_eq!(layout.pages.len(), 2);
        assert_eq!(layout.pages[0].end, 13.0); // Display window includes the real gap.
        assert_eq!(layout.pages[1].end, 16.0); // Final display window extends to cue end.
        let mut sampled = layout.clone();
        let mut larger = scene.nodes[0].clone();
        larger.style.font_size.value = 25.0;
        sampled.pages[1] = sampled_layout::reflow(
            &mut text,
            &layout,
            &layout.pages[1],
            &larger,
            &scene.layout,
            (160, 90),
            &params,
            &mut Budget::default(),
        )
        .unwrap();
        for current in [&layout, &sampled] {
            for (page, t, first, next) in [(0, 10.2, -0.5, Some(3.0)), (1, 15.0, 3.0, None)] {
                for (_, c) in bound_contexts(&cue, scene, current, page, t, &params) {
                    for key in [
                        "unit.firstPageFirstWordTimed",
                        "unit.firstPageLastWordTimed",
                        "unit.firstPageNextWordTimed",
                        "unit.pageFirstWordTimed",
                    ] {
                        assert!(c.fields[key].boolean().unwrap(), "{key}");
                    }
                    assert_eq!(
                        c.fields["time.firstPageFirstWordStartSeconds"]
                            .number()
                            .unwrap(),
                        -0.5
                    );
                    assert_eq!(
                        c.fields["time.firstPageLastWordEndSeconds"]
                            .number()
                            .unwrap(),
                        1.25
                    );
                    assert_eq!(
                        c.fields["time.firstPageNextWordStartSeconds"]
                            .number()
                            .unwrap(),
                        3.0
                    );
                    assert_eq!(
                        c.fields["time.pageFirstWordStartSeconds"].number().unwrap(),
                        first
                    );
                    assert_eq!(
                        c.fields["unit.pageNextWordTimed"].boolean().unwrap(),
                        next.is_some()
                    );
                    assert_eq!(
                        c.fields["time.pageNextWordStartSeconds"].number().unwrap(),
                        next.unwrap_or(0.0)
                    );
                }
            }
        }
    }
    #[test]
    fn first_page_input_context_keeps_zero_and_does_not_invent_static_or_estimated_inputs() {
        let (mut text, mut style, mut cue, params) = input("A", 1.0);
        cue.words = vec![SceneWord {
            id: "a".into(),
            text: "A".into(),
            start: 0.0,
            end: 0.0,
        }];
        let SceneSource::Inline { value: scene } = &mut style.scene;
        let layout = prepare(
            &mut text,
            &cue,
            &scene.nodes[0],
            &scene.layout,
            &scene.speech_state,
            (160, 90),
            &params,
        )
        .unwrap();
        for (_, c) in bound_contexts(&cue, scene, &layout, 0, 0.5, &params) {
            assert!(c.fields["unit.firstPageFirstWordTimed"].boolean().unwrap());
            assert!(c.fields["unit.firstPageLastWordTimed"].boolean().unwrap());
            assert_eq!(
                c.fields["time.firstPageFirstWordStartSeconds"]
                    .number()
                    .unwrap(),
                0.0
            );
            assert_eq!(
                c.fields["time.firstPageLastWordEndSeconds"]
                    .number()
                    .unwrap(),
                0.0
            );
            assert!(!c.fields["unit.firstPageNextWordTimed"].boolean().unwrap());
        }
        scene.speech_state.timing_policy = TimingPolicy::Estimated;
        for static_text in [false, true] {
            if static_text {
                scene.nodes[0].text = Some(TextBinding::Static { text: "A".into() });
            } else {
                cue.words.clear();
            }
            if static_text {
                cue.words = vec![SceneWord {
                    id: "a".into(),
                    text: "A".into(),
                    start: 0.0,
                    end: 1.0,
                }];
            }
            let layout = prepare(
                &mut text,
                &cue,
                &scene.nodes[0],
                &scene.layout,
                &scene.speech_state,
                (160, 90),
                &params,
            )
            .unwrap();
            for (_, c) in bound_contexts(&cue, scene, &layout, 0, 0.5, &params) {
                for key in [
                    "unit.firstPageFirstWordTimed",
                    "unit.firstPageLastWordTimed",
                    "unit.firstPageNextWordTimed",
                    "unit.pageFirstWordTimed",
                    "unit.pageNextWordTimed",
                ] {
                    assert!(!c.fields[key].boolean().unwrap(), "{key}");
                }
                for key in [
                    "time.firstPageFirstWordStartSeconds",
                    "time.firstPageLastWordEndSeconds",
                    "time.firstPageNextWordStartSeconds",
                    "time.pageFirstWordStartSeconds",
                    "time.pageNextWordStartSeconds",
                ] {
                    assert_eq!(c.fields[key].number().unwrap(), 0.0, "{key}");
                }
            }
        }
    }

    #[test]
    fn word_quota_preserves_source_indices_and_freezes_hidden_horizontal_prefix() {
        for content in ["aa bb aa bb", "  aa bb aa bb", "aa bb\t\u{a0}\u{2003}aa bb"] {
            let (mut text, mut style, mut cue, params) = input(content, 1.0);
            cue.words = [("aa", 0.0), ("bb", 0.8), ("aa", 2.2), ("bb", 3.2)]
                .into_iter()
                .enumerate()
                .map(|(i, (text, start))| SceneWord {
                    id: format!("w{i}"),
                    text: text.into(),
                    start,
                    end: start + 0.3,
                })
                .collect();
            let SceneSource::Inline { value: scene } = &mut style.scene;
            scene.layout.pagination.max_units_per_page = Some(2);
            let base = prepare(
                &mut text,
                &cue,
                &scene.nodes[0],
                &scene.layout,
                &scene.speech_state,
                (160, 90),
                &params,
            )
            .unwrap();
            assert_eq!(base.pages.len(), 2);
            assert_eq!(base.content, content);
            assert_eq!(
                base.pages[0].paint_start, 0,
                "cue indentation is original content"
            );
            let previous_end = content.find("bb").unwrap() + 2;
            let painted = content[previous_end..].find("aa").unwrap() + previous_end;
            let page = &base.pages[1];
            assert_eq!(page.source_range.start, previous_end);
            assert_eq!(page.paint_start, painted);
            assert_eq!(page.lines[0].bytes.start, painted);
            assert_eq!(page.start, 2.2);
            let next = sampled_layout::reflow(
                &mut text,
                &base,
                page,
                &scene.nodes[0],
                &scene.layout,
                (160, 90),
                &params,
                &mut Budget::default(),
            )
            .unwrap();
            assert_eq!(next.source_range, page.source_range);
            assert_eq!(next.paint_start, page.paint_start);
            assert_eq!(next.lines[0].bounds.width, page.lines[0].bounds.width);
            let units = units_for(
                &cue,
                &base,
                page,
                2.4,
                &scene.speech_state,
                &Presentation::default(),
            );
            let word = &units
                .iter()
                .find(|(u, _)| u.kind == UnitKind::Word && u.id == "w2")
                .unwrap()
                .0;
            assert_eq!(word.text_index, content[..painted].graphemes(true).count());
            assert!(
                units
                    .iter()
                    .any(|(u, _)| u.whitespace && u.bytes.start == previous_end)
            );
            if !content.starts_with(' ') {
                assert_eq!(base.pages[0].bounds.width, page.bounds.width);
            }
        }
    }
    #[test]
    fn word_quota_does_not_trim_runs_containing_vertical_separators() {
        for separator in [
            " \n ", "\r\n\t", "\u{000b}", "\u{000c}", "\u{0085}", "\u{2028}", "\u{2029}",
        ] {
            let source = format!("aa bb{separator}aa bb");
            assert_eq!(quota_paint_start(&source, &(5..source.len())), 5);
        }
        let horizontal = " \t\u{a0}\u{2003}x";
        assert_eq!(
            quota_paint_start(horizontal, &(0..horizontal.len())),
            horizontal.find('x').unwrap()
        );
    }
}
