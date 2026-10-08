//! 按帧计划画一帧（架构设计 §9.3）。
//!
//! - 输出是 `width`×`height` 的 RGBA；实例的几何是画布的百分比，内核按输出尺寸排，输出与序列画布同宽高比；
//! - 先铺黑底（成片没有透明通道），再按 `backgroundAlpha` 铺画布的背景色；
//! - 图层从下往上画：每一层由内核画成一张与输出等大的透明层（几何、关键帧、元素动画、遮罩、平铺与不透明度都在里面），
//!   作用描边与阴影，在转场里时按 [`crate::transition`] 与另一侧合起来，再盖到下面；
//! - 视频与位图的源画面由 [`LayerMedia`] 给出；SVG 图片（素材版本的 `mediaType` 是 `image/svg+xml`）由这里从素材字节
//!   按输出的长边光栅，是贴纸时先按 `fillOverrides` 换色（`timeline::svg_fill`）；GIF 图片（`image/gif`）由这里从素材
//!   字节解成动图，按离实例开始过了多久取帧（[`crate::Gif::frame_at`]）。两者预览与导出同一份实现。裁剪之后先作用
//!   `fx` 的 1–10 再注入内核；没有源画面的种类（模板贴纸、空的占位框）在画好的层上作用 1–10；
//! - 字幕按样式文档分组，在组里第一层的位置画一次；模板层由内核的模板光栅画；
//! - 画不出来的东西按 [`crate::support`] 的判断报错，或在跳过模式下不画并记下来；
//! - 混合在 sRGB 编码值上做，与 Canvas 2D 一致。

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::Arc;

use render_graph::audio_plan::AudioSegment;
use render_graph::{FramePlan, LayerContent, LayerKind, TransitionRole, VideoView, VisualLayer};
use render_raster::TextEngine;
use render_raster::fonts::{FaceLog, FaceUse};
use render_raster::source::{Lottie, MediaTime, VizParams, VizSource, VizTrack};
use serde::Serialize;
use serde_json::{Value, json};
use subtitle_render::{OverlayIncludes, OverlayRenderPlan, TimelineVisualElement};
use tiny_skia::{BlendMode, Color, FilterQuality, IntSize, Pixmap, PixmapPaint, Rect, Transform};
use video_model::{AssetRecord, Fx, Id, Sequence, TimelineItem, VersionRef};

use crate::caption_words::{SpeechWords, place};
use crate::captions::{CaptionHit, CaptionPlan, CaptionStyle, is_translation, read_captions};
use crate::documents::Documents;
use crate::effects::{apply_to_layer, apply_to_source, hex_rgba, needs_layer_pass};
use crate::element::{source_id, visual_element};
use crate::spectrum::{self, Route, SpeakerActivity};
use crate::support::{UnsupportedItem, check_layer, check_transition, kind_name};
use crate::template::TemplateScenes;
use crate::text_measure::{TextBox, measure_text_element};
use crate::transition::{BoxGeom, compose, effective_progress};

/// 合成失败。`items` 是不跳过时遇到的画不出来的东西（错误码 `EXPORT_UNSUPPORTED_CONTENT`）。
#[derive(Clone, Debug, PartialEq)]
pub struct RenderError {
    pub code: String,
    pub message: String,
    pub items: Vec<UnsupportedItem>,
}

impl RenderError {
    pub fn new(code: &str, message: impl Into<String>) -> RenderError {
        RenderError {
            code: code.into(),
            message: message.into(),
            items: Vec::new(),
        }
    }

    fn render(error: anyhow::Error) -> RenderError {
        RenderError::new("EXPORT_RENDER_FAILED", format!("画面渲染失败：{error:#}"))
    }
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}：{}", self.code, self.message)
    }
}

impl std::error::Error for RenderError {}

/// 合成时报的警告（不影响画面能不能画出来）。
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RenderWarning {
    pub code: &'static str,
    pub detail: String,
}

/// 渲染内核的提示（字体替换、缺字、没有频谱的声波等）。
pub const RENDER_NOTE: &str = "EXPORT_RENDER_NOTE";

/// 层要的素材从哪里来（导出时是解码器与素材文件，预览时是宿主送进来的帧）。
pub trait LayerMedia {
    /// 视频或图片层这一刻的画面（按源的显示尺寸，预乘的 RGBA）。`None`：这一层的素材在跳过的清单里，不画。
    fn picture(&mut self, layer: &VisualLayer) -> Result<Option<&Pixmap>, RenderError>;

    /// 素材的原始字节（Lottie 贴纸要读它）。缺省没有。
    fn asset_bytes(&mut self, _asset: &VersionRef) -> Option<Vec<u8>> {
        None
    }

    /// 声波实例现成的整轨频谱（BCS1，第 k 帧是序列时刻 `k / 60`）：有就直接用（界面的缩略图给示意的频谱）。缺省没有，
    /// 按声音计划从素材的频谱拼（[`crate::spectrum`]）。
    fn spectrum(&mut self, _item_id: &str) -> Option<Vec<u8>> {
        None
    }

    /// 素材的频谱（BCS1，按素材的源时间排）。缺省没有：用到它的声波按静态的样子画，并报一条提示。
    fn audio_spectrum(&mut self, _asset: &VersionRef) -> Option<Vec<u8>> {
        None
    }
}

#[derive(Clone, Debug)]
pub struct RenderOptions {
    pub width: u32,
    pub height: u32,
    /// 画不出来的东西跳过（不画那一层、跳过那个效果、转场按硬切）并记下来；否则报错。
    pub skip_unsupported: bool,
    /// 画字幕层（`burnCaptions`）。关掉时字幕层不画，也不算画不出来。
    pub captions: bool,
}

/// 画好的一层：与输出等大的透明层，与它的框（转场按框画；模板层没有框）。
struct DrawnLayer {
    pixmap: Pixmap,
    geom: Option<BoxGeom>,
}

pub struct FrameRenderer {
    options: RenderOptions,
    documents: Documents,
    /// 交给内核的字体字节（共享：几台排版引擎只占一份内存）。
    fonts: Vec<Arc<Vec<u8>>>,
    frame: Pixmap,
    /// 画实例用的内核计划：编一次，每层把 `elements` 换成那一个实例。
    elements: Option<OverlayRenderPlan>,
    captions: HashMap<String, CaptionPlan>,
    collect_caption_hits: bool,
    caption_hits: Vec<CaptionHit>,
    templates: TemplateScenes,
    lotties: HashMap<String, Option<Arc<Lottie>>>,
    /// SVG 图片按输出长边光栅好的画面（键是 `素材ID@版本`，换过色的是它的变体 ID）；读不出来的是 `None`。换尺寸时作废。
    svgs: HashMap<String, Option<Arc<Pixmap>>>,
    /// 解好的 GIF（键是 `素材ID@版本`）；读不出来的是 `None`。与输出尺寸无关，换尺寸时留着。
    gifs: HashMap<String, Option<Arc<crate::Gif>>>,
    /// 声波实例 → 它的频谱轨（键变了就重拼）。
    viz: HashMap<String, VizEntry>,
    /// 各说话人在序列上说话的区间（声波的 `speaker` 用）；`None` 是视频里没有转写。
    speakers: Option<Arc<SpeakerActivity>>,
    /// 这一帧用到、还没有的素材频谱（实例与素材）。
    missing_spectra: Vec<(String, VersionRef)>,
    warnings: Vec<RenderWarning>,
    skipped: Vec<UnsupportedItem>,
    skipped_keys: HashSet<String>,
    /// 不铺背景（界面的缩略图要透明底）：帧是预乘的 RGBA。
    transparent: bool,
    /// 换尺寸、换文档时拆下来的排版引擎：下一份内核计划接着用，不再解析一遍字体。
    engines: Vec<TextEngine>,
    /// 各文字实例排字时点了名、字体库里没有的族（常设：内核缓存了排好的字，之后的帧不再排，也要照报）。换字体时清空。
    item_fonts: HashMap<String, BTreeSet<String>>,
    /// 到目前为止画到的层用到、字体库里没有的族（`clear_reports` 清空）。
    missing_fonts: BTreeSet<String>,
    /// 排字时点了名的 face（几台排版引擎共用，常设）：宿主按它去本机字体里找 face（[`Self::used_faces`]）。
    face_log: FaceLog,
}

/// 留几台排版引擎备用（每台都装着全部字体）。
const SPARE_ENGINES: usize = 2;

impl FrameRenderer {
    /// `fonts` 是交给内核的字体字节，第一份是回退字体（原生导出用 [`crate::bundled_fonts`]，预览由宿主注入同一批）。
    pub fn new(options: RenderOptions, documents: Documents, fonts: Vec<Vec<u8>>) -> Result<FrameRenderer, RenderError> {
        Self::with_shared_fonts(options, documents, fonts.into_iter().map(Arc::new).collect())
    }

    /// [`Self::new`]，字体字节与调用方共享（预览留着一份字体，渲染器重建时不再复制）。
    pub fn with_shared_fonts(options: RenderOptions, documents: Documents, fonts: Vec<Arc<Vec<u8>>>) -> Result<FrameRenderer, RenderError> {
        let frame = Pixmap::new(options.width, options.height)
            .ok_or_else(|| RenderError::new("INVALID_PARAMS", format!("输出尺寸 {}×{} 不可用", options.width, options.height)))?;
        if fonts.is_empty() || fonts.iter().any(|bytes| bytes.is_empty()) {
            return Err(RenderError::new("INVALID_PARAMS", "渲染至少要一份回退字体"));
        }
        Ok(FrameRenderer {
            options,
            documents,
            fonts,
            frame,
            elements: None,
            captions: HashMap::new(),
            collect_caption_hits: false,
            caption_hits: Vec::new(),
            templates: TemplateScenes::default(),
            lotties: HashMap::new(),
            svgs: HashMap::new(),
            gifs: HashMap::new(),
            viz: HashMap::new(),
            speakers: None,
            missing_spectra: Vec::new(),
            warnings: Vec::new(),
            skipped: Vec::new(),
            skipped_keys: HashSet::new(),
            transparent: false,
            engines: Vec::new(),
            item_fonts: HashMap::new(),
            missing_fonts: BTreeSet::new(),
            face_log: FaceLog::default(),
        })
    }

    /// 换一份说话人的区间（`render_graph::audio_plan::speaker_activity` 从视频里的转写求出；`None` 是视频里没有转写）。
    /// 与上一份相同时不动，不同时声波的轨作废、下一帧重拼。
    pub fn set_speakers(&mut self, speakers: Option<Arc<SpeakerActivity>>) {
        let same = match (&self.speakers, &speakers) {
            (None, None) => true,
            (Some(a), Some(b)) => Arc::ptr_eq(a, b) || a == b,
            _ => false,
        };
        if !same {
            self.speakers = speakers;
            self.viz.clear();
        }
    }

    /// 换一批冻结的文档（预览里文档会变）。字幕的编译结果随之作废。
    pub fn set_documents(&mut self, documents: Documents) {
        self.documents = documents;
        self.drop_captions();
    }

    /// 一台装好字体的排版引擎：有备用的就用备用的。
    fn take_engine(&mut self) -> TextEngine {
        let mut engine = self
            .engines
            .pop()
            .unwrap_or_else(|| TextEngine::with_shared_document_fonts(&self.fonts));
        // 上一份计划记下的缺字体不算到下一份头上。
        engine.take_missing_families();
        engine.set_face_log(Some(self.face_log.clone()));
        engine
    }

    /// 追加字体（宿主按 [`Self::missing_fonts`] 找来的字体文件）。排版引擎与按字体编的内核计划随之作废，下一帧按新的
    /// 字体库重排；已经报了缺、现在有了的族撤回报告（导出拿到字体后重画这一帧，不留缺字体的提示）。空的字节不收。
    pub fn add_fonts(&mut self, fonts: Vec<Arc<Vec<u8>>>) {
        let before = self.fonts.len();
        self.fonts.extend(fonts.into_iter().filter(|bytes| !bytes.is_empty()));
        if self.fonts.len() == before {
            return;
        }
        self.engines.clear();
        self.elements = None;
        self.captions.clear();
        self.templates = TemplateScenes::default();
        self.item_fonts.clear();
        let engine = self.take_engine();
        let arrived: Vec<String> = self.missing_fonts.iter().filter(|f| engine.has_family(f)).cloned().collect();
        self.spare_engine(engine);
        for family in arrived {
            self.missing_fonts.remove(&family);
            let note = format!("：{}", missing_font_note(&family));
            self.warnings.retain(|w| !(w.code == RENDER_NOTE && w.detail.ends_with(&note)));
        }
    }

    /// 到目前为止画到的层点了名、字体库里没有的字体族（按名字排序；`clear_reports` 清空）。宿主按它去找字体文件，
    /// 找到的用 [`Self::add_fonts`] 送进来再画；找不到的照回退字体画，并报 [`RENDER_NOTE`] 提示。
    pub fn missing_fonts(&self) -> Vec<String> {
        self.missing_fonts.iter().cloned().collect()
    }

    /// 到目前为止排字时点了名的 face（族名、字重、斜体，常设，按名字排序；含字幕与模板层）。宿主拿它与报过缺的族对照，
    /// 去本机字体里找那一个 face（与排版同一套匹配），找到的用 [`Self::add_fonts`] 送进来。
    pub fn used_faces(&self) -> Vec<FaceUse> {
        let mut faces = self.face_log.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone();
        faces.sort();
        faces
    }

    /// 记下一层排字时缺的族（常设），并报这一层缺的全部族。
    fn note_missing_fonts(&mut self, item_id: &str, fresh: Vec<String>) {
        let families = self.item_fonts.entry(item_id.to_string()).or_default();
        families.extend(fresh);
        if families.is_empty() {
            return;
        }
        let families: Vec<String> = families.iter().cloned().collect();
        for family in families {
            self.warn(RENDER_NOTE, format!("{item_id}：{}", missing_font_note(&family)));
            self.missing_fonts.insert(family);
        }
    }

    fn spare_engine(&mut self, engine: TextEngine) {
        if self.engines.len() < SPARE_ENGINES {
            self.engines.push(engine);
        }
    }

    /// 量一段文字作为文字元素在 `canvas`（序列画布）上要多大的框（[`measure_text_element`]），用画字的同一批字体。
    pub fn measure_text(&mut self, text: &str, style: &Value, wrap_width: Option<f64>, canvas: (u32, u32)) -> TextBox {
        let mut engine = self.take_engine();
        let measured = measure_text_element(&mut engine, text, style, wrap_width, canvas);
        self.spare_engine(engine);
        measured
    }

    fn drop_captions(&mut self) {
        for (_, plan) in std::mem::take(&mut self.captions) {
            self.spare_engine(plan.into_text_engine());
        }
    }

    /// 换输出尺寸（预览的画布随窗口变）：按尺寸编的内核计划与按长边光栅的 SVG 随之作废，Lottie 与频谱留着。
    pub fn resize(&mut self, width: u32, height: u32) -> Result<(), RenderError> {
        if (width, height) == (self.options.width, self.options.height) {
            return Ok(());
        }
        self.frame =
            Pixmap::new(width, height).ok_or_else(|| RenderError::new("INVALID_PARAMS", format!("输出尺寸 {width}×{height} 不可用")))?;
        self.options.width = width;
        self.options.height = height;
        if let Some(plan) = self.elements.take() {
            self.spare_engine(plan.into_text_engine());
        }
        self.drop_captions();
        self.templates = TemplateScenes::default();
        self.svgs.clear();
        Ok(())
    }

    /// 画不画字幕层（预览里随「烧字幕」开关变）。
    pub fn set_captions(&mut self, on: bool) {
        self.options.captions = on;
    }

    /// 不铺背景，帧留透明底（界面的元素与字幕样式缩略图）。导出不用。
    pub fn set_transparent(&mut self, on: bool) {
        self.transparent = on;
    }

    /// 清掉记下的警告与跳过的东西（预览每一帧只报这一帧的）。
    pub fn clear_reports(&mut self) {
        self.missing_spectra.clear();
        self.missing_fonts.clear();
        self.warnings.clear();
        self.skipped.clear();
        self.skipped_keys.clear();
    }

    /// 到目前为止的警告（去重）。
    pub fn warnings(&self) -> &[RenderWarning] {
        &self.warnings
    }

    /// 跳过模式下到目前为止跳过的东西（去重）。
    pub fn skipped(&self) -> &[UnsupportedItem] {
        &self.skipped
    }

    /// 到目前为止声波用到、调用方还没给的素材频谱（实例 ID 与素材，去重）。预览按它去算，算好了送进来再画。
    pub fn missing_spectra(&self) -> &[(String, VersionRef)] {
        &self.missing_spectra
    }

    /// 预览需要字幕拾取；导出默认不求交互几何。
    pub fn set_collect_caption_hits(&mut self, on: bool) {
        self.collect_caption_hits = on;
    }

    pub fn caption_hits(&self) -> &[CaptionHit] {
        &self.caption_hits
    }

    pub fn frame(&self) -> &Pixmap {
        &self.frame
    }

    /// 画一帧，返回 RGBA 字节（不透明，预乘与否相同；[`Self::set_transparent`] 时是预乘的）。`seconds` 是这一帧的序列时间。
    pub fn render(&mut self, video: VideoView, plan: &FramePlan, seconds: f64, media: &mut dyn LayerMedia) -> Result<&[u8], RenderError> {
        let sequence = video
            .sequences
            .get(&plan.sequence_id)
            .ok_or_else(|| RenderError::new("INVALID_PARAMS", format!("序列 {} 不在了", plan.sequence_id)))?;
        self.caption_hits.clear();
        self.frame.fill(if self.transparent { Color::TRANSPARENT } else { Color::BLACK });
        // 背景色读不懂时保持黑色。
        let [r, g, b, a] = hex_rgba(&plan.canvas.background).unwrap_or([0, 0, 0, 255]);
        let alpha = (f64::from(a) / 255.0 * plan.canvas.background_alpha.clamp(0.0, 1.0)) as f32;
        if alpha > 0.0 && !self.transparent {
            let colour = Color::from_rgba(f32::from(r) / 255.0, f32::from(g) / 255.0, f32::from(b) / 255.0, alpha).unwrap_or(Color::BLACK);
            fill(&mut self.frame, colour);
        }
        let mut context = SequenceContext::new(sequence, video.assets);
        // 声波按序列的声音计划取素材频谱（整条序列，时间从 0 起）；没有声波的帧不求。
        let visualizer = |layer: &VisualLayer| matches!(&layer.content, Some(LayerContent::Generator { generator, .. }) if generator == "baocut.audio-visualizer");
        if plan
            .layers
            .iter()
            .any(|l| visualizer(l) || l.transition.as_ref().and_then(|t| t.partner.as_deref()).is_some_and(visualizer))
        {
            context.audio = render_graph::audio_plan::plan_audio(video, &plan.sequence_id, None)
                .ok()
                .map(|p| p.segments);
        }

        let mut caption_groups: HashSet<&str> = HashSet::new();
        for layer in &plan.layers {
            if layer.kind == LayerKind::Caption {
                // 共用样式文档的字幕是一组，在组里第一层的位置画一次。
                if self.options.captions && caption_groups.insert(caption_group(layer)) {
                    self.draw_captions(video, sequence, plan, caption_group(layer), context.fps)?;
                }
                continue;
            }
            let Some(skipped_effects) = self.admit(layer, sequence)? else {
                continue;
            };
            let transition = match &layer.transition {
                Some(tr) => match check_transition(layer) {
                    None => Some(tr),
                    Some(item) => {
                        self.refuse_or_skip(vec![item])?;
                        None
                    }
                },
                None => None,
            };
            let Some(own) = self.draw_layer(&context, layer, &skipped_effects, seconds, media)? else {
                continue;
            };
            let Some(tr) = transition else {
                over(&mut self.frame, &own.pixmap);
                continue;
            };
            let partner = match tr.partner.as_deref() {
                Some(partner) => match self.admit(partner, sequence)? {
                    Some(skipped) => self.draw_layer(&context, partner, &skipped, seconds, media)?,
                    None => None,
                },
                None => None,
            };
            let two_sided = partner.is_some();
            let e = effective_progress(tr, two_sided);
            // 两侧：A 是出场的一侧，B 是入场的一侧。单侧：B 是这一层（出场按逆过程 e′ 画）。
            let (a, b) = match (tr.role, &partner) {
                (TransitionRole::Outgoing, Some(other)) => (Some(&own), other),
                (TransitionRole::Incoming, Some(other)) => (Some(other), &own),
                (_, None) => (None, &own),
            };
            let mut out = Pixmap::new(self.options.width, self.options.height).expect("尺寸在构造时检查过");
            compose(&tr.kind, &tr.params, a.map(|l| &l.pixmap), Some(&b.pixmap), b.geom, e, &mut out);
            over(&mut self.frame, &out);
        }
        Ok(self.frame.data())
    }

    /// 画一层（不含转场）。整层不画（素材在跳过清单里、实例不在了）时为 `None`。
    fn draw_layer(
        &mut self,
        context: &SequenceContext,
        layer: &VisualLayer,
        skipped_effects: &HashSet<String>,
        seconds: f64,
        media: &mut dyn LayerMedia,
    ) -> Result<Option<DrawnLayer>, RenderError> {
        let size = (self.options.width, self.options.height);
        if let Some(LayerContent::Generator { generator, parameters, .. }) = &layer.content
            && generator == "baocut.template"
        {
            let layer_id = parameters
                .get("layerId")
                .and_then(Value::as_str)
                .unwrap_or(&layer.item_id)
                .to_string();
            let Some(doc) = context.sequence.header.template.as_ref() else {
                return Ok(None);
            };
            self.element_plan(context)?;
            let plan = self.elements.as_mut().expect("刚编好");
            let pixmap = self
                .templates
                .raster(
                    context.sequence,
                    doc,
                    &layer_id,
                    seconds,
                    context.duration,
                    context.fps,
                    size,
                    &mut plan.text,
                )
                .map_err(RenderError::render)?;
            let missing = plan.text.take_missing_families();
            self.note_missing_fonts(&layer.item_id, missing);
            return Ok(Some(DrawnLayer { pixmap, geom: None }));
        }
        let Some(item) = context.items.get(layer.item_id.as_str()).copied() else {
            return Ok(None);
        };
        let bindings = context
            .sequence
            .header
            .animation_bindings
            .iter()
            .filter(|b| b.target_id == layer.item_id);
        let Some(mut element) = visual_element(item, context.fps, bindings) else {
            return Ok(None);
        };
        // 两侧转场的另一侧在自己的区间之外：几何与动画按区间里最近的一刻求，源画面取计划给的时刻。
        let eval = seconds.clamp(element.start, (element.end - 1e-6).max(element.start));
        let fx = item.fx().map(|fx| without(fx, skipped_effects));
        let short_edge = f64::from(size.0.min(size.1));

        let mut natural = None;
        let mut injected: Option<Pixmap> = None;
        match (&layer.kind, &layer.content) {
            (LayerKind::Video | LayerKind::Image, _) => {
                let decoded = if layer.kind == LayerKind::Image && context.is_svg(layer.asset.as_ref()) {
                    let overrides = element.sticker.as_ref().map(|sticker| &sticker.fill_overrides);
                    let Some(svg) = self.svg(layer, overrides, media)? else {
                        return Ok(None);
                    };
                    Some(svg)
                } else if layer.kind == LayerKind::Image && context.is_gif(layer.asset.as_ref()) {
                    let Some(gif) = self.gif(layer, media)? else {
                        return Ok(None);
                    };
                    // 图片实例的动图一直循环；贴纸按 `sticker.loop`。
                    let mode = element
                        .sticker
                        .as_ref()
                        .map_or(timeline::schema::STICKER_LOOP_LOOP, |sticker| sticker.loop_mode());
                    Some(gif.frame_at(seconds - element.start, mode).map_err(RenderError::render)?)
                } else {
                    None
                };
                let picture = match &decoded {
                    Some(decoded) => decoded.as_ref(),
                    None => match media.picture(layer)? {
                        Some(picture) => picture,
                        None => return Ok(None),
                    },
                };
                let mut source = cropped(picture, crop_of(item))
                    .ok_or_else(|| RenderError::new("EXPORT_RENDER_FAILED", format!("实例 {} 的源画面尺寸不可用", layer.item_id)))?;
                if let Some(fx) = &fx {
                    apply_to_source(fx, &mut source, short_edge);
                }
                natural = Some((f64::from(source.width()), f64::from(source.height())));
                injected = Some(source);
            }
            (LayerKind::Generator, Some(LayerContent::Generator { generator, parameters, .. })) if generator == "baocut.lottie" => {
                let overrides = element.sticker.as_ref().map(|sticker| &sticker.fill_overrides);
                let Some(lottie) = self.lottie(layer, parameters, overrides, media)? else {
                    return Ok(None);
                };
                let meta = lottie.metadata();
                let dims = (f64::from(meta.width.max(1)), f64::from(meta.height.max(1)));
                let mut probe = element.clone();
                probe.keyframe_place(eval);
                let geom = BoxGeom::of(&probe, Some(dims), (f64::from(size.0), f64::from(size.1)));
                let (w, h) = (geom.w.round().clamp(1.0, 4096.0) as u32, geom.h.round().clamp(1.0, 4096.0) as u32);
                let at = lottie_time(parameters, layer.source_seconds.unwrap_or(0.0), meta.duration());
                let frame = lottie.sample_scaled(MediaTime::from_secs(at), w, h).map_err(RenderError::render)?;
                let mut source = Arc::try_unwrap(frame.pixmap).unwrap_or_else(|shared| (*shared).clone());
                if let Some(fx) = &fx {
                    apply_to_source(fx, &mut source, short_edge);
                }
                natural = Some(dims);
                injected = Some(source);
            }
            (LayerKind::Generator, Some(LayerContent::Generator { generator, .. })) if generator == "baocut.audio-visualizer" => {
                self.visualizer_track(&element, context, media);
                if !self.visualizer_shown(&element.id, eval) {
                    return Ok(None);
                }
            }
            _ => {}
        }

        let has_source = injected.is_some();
        let duration = context.duration;
        let fps = context.fps;
        let viz = self.viz.get(&element.id).and_then(|entry| entry.track.clone());
        let plan = self.element_plan(context)?;
        plan.duration = duration;
        plan.fps = fps;
        plan.media.injected.clear();
        if let Some(source) = injected {
            let id = source_id(&element.id);
            plan.media.injected.insert(id.clone(), Arc::new(source));
            element.src_id = Some(id);
        }
        if let Some(track) = viz {
            plan.viz_tracks.insert(element.id.clone(), track);
        }
        plan.elements = vec![element.clone()];
        plan.text.take_missing_families();
        let rendered = plan.render_drawop_overlay_frame(eval, None).map_err(RenderError::render);
        plan.elements.clear();
        plan.media.injected.clear();
        let notes = std::mem::take(&mut plan.warnings);
        let missing = plan.text.take_missing_families();
        for note in notes {
            self.warn(RENDER_NOTE, format!("{}：{note}", layer.item_id));
        }
        self.note_missing_fonts(&layer.item_id, missing);
        let rendered = rendered?;
        let mut pixmap = Pixmap::from_vec(
            rendered.rgba,
            IntSize::from_wh(size.0, size.1).ok_or_else(|| RenderError::new("INVALID_PARAMS", "输出尺寸不可用"))?,
        )
        .ok_or_else(|| RenderError::new("EXPORT_RENDER_FAILED", "内核画出的层尺寸不对"))?;
        if let Some(fx) = &fx {
            if !has_source {
                apply_to_source(fx, &mut pixmap, short_edge);
            }
            if needs_layer_pass(fx) {
                apply_to_layer(fx, &mut pixmap, short_edge).map_err(RenderError::render)?;
            }
        }
        element.keyframe_place(eval);
        let geom = BoxGeom::of(&element, natural, (f64::from(size.0), f64::from(size.1)));
        Ok(Some(DrawnLayer { pixmap, geom: Some(geom) }))
    }

    /// 画实例用的内核计划（第一次用时编）。
    fn element_plan(&mut self, context: &SequenceContext) -> Result<&mut OverlayRenderPlan, RenderError> {
        if self.elements.is_none() {
            let includes = OverlayIncludes {
                subtitles: false,
                texts: true,
                media_overlays: true,
                watermarks: false,
            };
            let engine = self.take_engine();
            let plan = OverlayRenderPlan::compile_with_text_engine(
                &json!({ "style": {}, "cues": [] }),
                self.options.width,
                self.options.height,
                context.duration.max(1.0),
                context.fps,
                None,
                includes,
                self.fonts.len(),
                engine,
            )
            .map_err(RenderError::render)?;
            self.elements = Some(plan);
        }
        Ok(self.elements.as_mut().expect("刚编好"))
    }

    /// Lottie 贴纸的源（按素材版本与换色表缓存，内嵌图片挂好、换好色，见 [`crate::load_lottie`]）。读不到或解不开时
    /// 按选项报错或跳过（`asset`）。
    fn lottie(
        &mut self,
        layer: &VisualLayer,
        parameters: &Value,
        overrides: Option<&BTreeMap<String, String>>,
        media: &mut dyn LayerMedia,
    ) -> Result<Option<Arc<Lottie>>, RenderError> {
        let asset: Option<VersionRef> = parameters.get("asset").cloned().and_then(|v| serde_json::from_value(v).ok());
        let Some(asset) = asset else {
            self.refuse_or_skip(vec![asset_item(layer, "lottie-asset-missing", "Lottie 贴纸没有素材".into())])?;
            return Ok(None);
        };
        let mut key = format!("{}@{}", asset.id, asset.revision);
        if let Some(overrides) = overrides.filter(|o| !o.is_empty()) {
            key = subtitle_render::sticker_fill_variant_id(&key, overrides);
        }
        if !self.lotties.contains_key(&key) {
            let parsed = media
                .asset_bytes(&asset)
                .map(|bytes| crate::load_lottie(&asset.id, &bytes, overrides).map(Arc::new));
            let entry = match parsed {
                Some(Ok(lottie)) => Some(lottie),
                Some(Err((reason, why))) => {
                    self.lotties.insert(key.clone(), None);
                    self.refuse_or_skip(vec![asset_item(layer, reason, format!("Lottie 素材读不出来：{why}"))])?;
                    return Ok(None);
                }
                None => None,
            };
            if entry.is_none() {
                self.refuse_or_skip(vec![asset_item(layer, "lottie-asset-missing", "Lottie 素材读不到".into())])?;
                return Ok(None);
            }
            self.lotties.insert(key.clone(), entry);
        }
        Ok(self.lotties.get(&key).cloned().flatten())
    }

    /// SVG 图片的画面：素材字节按输出的长边光栅（[`crate::decode_svg`]），贴纸带 `fillOverrides` 时先换色
    /// （[`timeline::svg_fill::apply_overrides`]，与贴纸面板的色卡同一份分组）。按素材版本与换色表缓存。读不到或解不开时
    /// 按选项报错或跳过（`asset`、`asset-undecodable`）；不是 UTF-8 的 SVG 换不了色，按原色画并提示。
    fn svg(
        &mut self,
        layer: &VisualLayer,
        overrides: Option<&BTreeMap<String, String>>,
        media: &mut dyn LayerMedia,
    ) -> Result<Option<Arc<Pixmap>>, RenderError> {
        let asset = layer.asset.as_ref().expect("调用方查过是 SVG 素材");
        let overrides = overrides.filter(|o| !o.is_empty());
        let mut key = format!("{}@{}", asset.id, asset.revision);
        if let Some(overrides) = overrides {
            key = subtitle_render::sticker_fill_variant_id(&key, overrides);
        }
        if !self.svgs.contains_key(&key) {
            let Some(bytes) = media.asset_bytes(asset) else {
                self.refuse_or_skip(vec![asset_item(
                    layer,
                    "asset-undecodable",
                    format!("SVG 图片 {} 读不到", asset.id),
                )])?;
                return Ok(None);
            };
            let mut recolour_failed = false;
            let recoloured = overrides.and_then(|overrides| match std::str::from_utf8(&bytes) {
                Ok(text) => Some(timeline::svg_fill::apply_overrides(text, overrides).into_bytes()),
                Err(_) => {
                    recolour_failed = true;
                    None
                }
            });
            if recolour_failed {
                self.warn(
                    RENDER_NOTE,
                    format!("{}：SVG 贴纸不是 UTF-8 文本，换不了色，按原色画", layer.item_id),
                );
            }
            let long_edge = self.options.width.max(self.options.height);
            match crate::decode_svg(recoloured.as_deref().unwrap_or(&bytes), long_edge) {
                Ok(pixmap) => {
                    self.svgs.insert(key.clone(), Some(Arc::new(pixmap)));
                }
                Err(error) => {
                    self.svgs.insert(key.clone(), None);
                    self.refuse_or_skip(vec![asset_item(layer, "asset-undecodable", format!("SVG 图片解不开：{error:#}"))])?;
                    return Ok(None);
                }
            }
        }
        match self.svgs.get(&key).cloned().flatten() {
            Some(svg) => Ok(Some(svg)),
            None => {
                self.refuse_or_skip(vec![asset_item(
                    layer,
                    "asset-undecodable",
                    format!("SVG 图片 {} 解不开", asset.id),
                )])?;
                Ok(None)
            }
        }
    }

    /// GIF 图片：素材字节解成动图（[`crate::load_gif`]），按素材版本缓存。读不到或连第一帧也解不开时按选项报错或跳过
    /// （`asset-undecodable`）；超过上限只画第一帧时给一条提示。
    fn gif(&mut self, layer: &VisualLayer, media: &mut dyn LayerMedia) -> Result<Option<Arc<crate::Gif>>, RenderError> {
        let asset = layer.asset.as_ref().expect("调用方查过是 GIF 素材");
        let key = format!("{}@{}", asset.id, asset.revision);
        if !self.gifs.contains_key(&key) {
            let Some(bytes) = media.asset_bytes(asset) else {
                self.refuse_or_skip(vec![asset_item(
                    layer,
                    "asset-undecodable",
                    format!("GIF 图片 {} 读不到", asset.id),
                )])?;
                return Ok(None);
            };
            match crate::load_gif(&asset.id, &bytes) {
                Ok((gif, note)) => {
                    if let Some(note) = note {
                        self.warn(RENDER_NOTE, format!("{}：{note}", layer.item_id));
                    }
                    self.gifs.insert(key.clone(), Some(Arc::new(gif)));
                }
                Err(error) => {
                    self.gifs.insert(key.clone(), None);
                    self.refuse_or_skip(vec![asset_item(layer, "asset-undecodable", format!("GIF 图片解不开：{error:#}"))])?;
                    return Ok(None);
                }
            }
        }
        match self.gifs.get(&key).cloned().flatten() {
            Some(gif) => Ok(Some(gif)),
            None => {
                self.refuse_or_skip(vec![asset_item(
                    layer,
                    "asset-undecodable",
                    format!("GIF 图片 {} 解不开", asset.id),
                )])?;
                Ok(None)
            }
        }
    }

    /// 声波实例的频谱轨：调用方给了现成的就用它，否则按声音计划从素材频谱拼（[`crate::spectrum`]）。按实例缓存，参数、
    /// 用到的声音段或素材变了才重拼。缺素材频谱时没有轨（内核按静态的样子画并报提示），缺的记进 [`Self::missing_spectra`]。
    /// 写了 `speaker` 时只留这位说话人说话的段（[`spectrum::gate`]），没有转写或转写里没有这位说话人时整条静音并报提示；
    /// `alwaysShow: false` 时另记每一帧有没有声（[`spectrum::audible_frames`]），没声的帧不画。
    fn visualizer_track(&mut self, element: &TimelineVisualElement, context: &SequenceContext, media: &mut dyn LayerMedia) {
        let Some(props) = element.visualizer.as_ref() else {
            return;
        };
        let params = VizParams {
            min_db: props.min_db(),
            max_db: props.max_db(),
            smoothing: props.smoothing(),
            gain: props.gain(),
        };
        let route = Route::of(props.audio());
        let segments = context
            .audio
            .as_deref()
            .map(|all| spectrum::segments_for(all, &route, element.start, element.end))
            .unwrap_or_default();
        let speaker = props.speaker.as_deref().filter(|s| !s.is_empty());
        let key = format!(
            "{}|{}|{}|{}|{:?}|{}|{}|{}|{:?}|{}",
            params.min_db,
            params.max_db,
            params.smoothing,
            params.gain,
            route,
            element.start,
            element.end,
            serde_json::to_string(&segments).unwrap_or_default(),
            speaker,
            props.always_show()
        );
        if let Some(entry) = self.viz.get(&element.id)
            && entry.key == key
        {
            let (missing, notes) = (entry.missing.clone(), entry.notes.clone());
            for asset in missing {
                self.note_missing(&element.id, asset);
            }
            for note in notes {
                self.warn(RENDER_NOTE, note);
            }
            return;
        }
        let derive = |bytes: &[u8]| VizTrack::derive(bytes, params).ok().map(Arc::new);
        let mut missing = Vec::new();
        let track = if let Some(bytes) = media.spectrum(&element.id) {
            derive(&bytes)
        } else {
            let mut sources = BTreeMap::new();
            for asset in spectrum::sources_of(&segments) {
                match media.audio_spectrum(&asset) {
                    Some(bytes) => {
                        sources.insert(spectrum::asset_key(&asset), bytes);
                    }
                    None => missing.push(asset),
                }
            }
            if missing.is_empty() {
                match spectrum::compose(&segments, &route, element.start, element.end, &sources) {
                    Ok(bytes) => derive(&bytes),
                    Err(message) => {
                        self.warn(RENDER_NOTE, format!("{}：{message}", element.id));
                        None
                    }
                }
            } else {
                None
            }
        };
        for asset in &missing {
            self.note_missing(&element.id, asset.clone());
        }
        let mut notes = Vec::new();
        let track = match speaker {
            None => track,
            Some(speaker) => {
                let spans = match self.speakers.as_deref() {
                    None => {
                        notes.push(format!(
                            "{}：视频里没有转写，听不出说话人 {speaker} 什么时候说话，声波按无声画",
                            element.id
                        ));
                        None
                    }
                    Some(speakers) => match speakers.get(speaker) {
                        Some(intervals) => Some(spectrum::speaking_spans(intervals)),
                        None => {
                            notes.push(format!(
                                "{}：转写里没有说话人 {speaker} 在这条序列上说的话，声波按无声画",
                                element.id
                            ));
                            None
                        }
                    },
                };
                track.and_then(|track| spectrum::gate(&track, spans.as_deref())).map(Arc::new)
            }
        };
        for note in &notes {
            self.warn(RENDER_NOTE, note.clone());
        }
        let audible = (!props.always_show()).then(|| track.as_deref().map(spectrum::audible_frames).unwrap_or_default());
        self.viz.insert(
            element.id.clone(),
            VizEntry {
                key,
                track,
                missing,
                notes,
                audible,
            },
        );
    }

    /// 声波这一刻画不画：`alwaysShow: false` 时只有有声的帧画（[`spectrum::audible_frames`]；没有轨就是没有声）。
    fn visualizer_shown(&self, item_id: &str, at: f64) -> bool {
        let Some(entry) = self.viz.get(item_id) else {
            return true;
        };
        let Some(audible) = &entry.audible else {
            return true;
        };
        entry
            .track
            .as_ref()
            .and_then(|track| track.frame_index_at(at))
            .and_then(|index| audible.get(index).copied())
            .unwrap_or(false)
    }

    fn note_missing(&mut self, item_id: &str, asset: VersionRef) {
        let entry = (item_id.to_string(), asset);
        if !self.missing_spectra.contains(&entry) {
            self.missing_spectra.push(entry);
        }
    }

    /// 宿主换了声波或素材的频谱：缓存的频谱轨作废，下一帧重新取、重新拼。
    pub fn clear_spectra(&mut self) {
        self.viz.clear();
    }

    /// 拿另一台渲染器拼好的频谱轨（与输出尺寸无关；预览按尺寸留几台渲染器，长视频的频谱轨拼一次要几百毫秒）。另一台是
    /// 更近画过的那台：它有的实例以它的为准，键对不上的下一帧照样重拼。说话人的区间不同时不拿。
    pub fn share_spectra_from(&mut self, other: &FrameRenderer) {
        let same = match (&self.speakers, &other.speakers) {
            (None, None) => true,
            (Some(a), Some(b)) => Arc::ptr_eq(a, b) || a == b,
            _ => false,
        };
        if !same {
            return;
        }
        for (item_id, entry) in &other.viz {
            self.viz.insert(item_id.clone(), entry.clone());
        }
    }

    /// 画一组字幕：组里画不出来的层按选项报错或跳过，其余的一起排、一起画。
    fn draw_captions(&mut self, video: VideoView, sequence: &Sequence, plan: &FramePlan, group: &str, fps: f64) -> Result<(), RenderError> {
        let mut admitted = Vec::new();
        for layer in plan
            .layers
            .iter()
            .filter(|l| l.kind == LayerKind::Caption && caption_group(l) == group)
        {
            let items = check_layer(layer, &self.documents, None);
            if items.is_empty() {
                admitted.push(layer);
            } else {
                self.refuse_or_skip(items)?;
            }
        }
        let Some(first) = admitted.first() else { return Ok(()) };
        let Some(LayerContent::Caption {
            style_document_id,
            sequence_seconds,
            scope,
            ..
        }) = &first.content
        else {
            return Ok(());
        };
        let document_ids: Vec<&str> = admitted
            .iter()
            .filter_map(|l| match &l.content {
                Some(LayerContent::Caption { document_id, .. }) => Some(document_id.as_str()),
                _ => None,
            })
            .collect();
        let prefix = format!("{group}|{}|", document_ids.join(","));
        let key = format!("{prefix}{}", self.caption_signature(sequence, &document_ids));
        if !self.captions.contains_key(&key) {
            let Ok(style) = CaptionStyle::read(style_document_id.as_deref().and_then(|id| self.documents.get(id))) else {
                return Ok(());
            };
            // 同一组按旧的剪辑编的计划不再用。
            let stale: Vec<String> = self.captions.keys().filter(|k| k.starts_with(&prefix)).cloned().collect();
            for old in stale {
                if let Some(plan) = self.captions.remove(&old) {
                    self.spare_engine(plan.into_text_engine());
                }
            }
            let engine = self.take_engine();
            let mut members = Vec::new();
            for id in &document_ids {
                let Some(document) = self.documents.get(id) else { continue };
                let Some(mut track) = read_captions(&document.body) else { continue };
                // 句子的词（逐词动画、强调）：原文字幕从它指向的转写里取有效词流里的词。
                if !is_translation(document)
                    && let Some(speech) = document.source_document_id.as_deref().and_then(|s| self.documents.get(s))
                    && let Some(words) = SpeechWords::read(&speech.body)
                {
                    let on_sequence = track.sequence_clock && !words.sequence_clock;
                    let placement = place(
                        video,
                        &plan.sequence_id,
                        id,
                        speech,
                        document.source_asset_id.as_deref(),
                        on_sequence,
                    );
                    track.attach_words(&words, &placement);
                }
                members.push((document, track));
            }
            let size = (self.options.width, self.options.height);
            let compiled = CaptionPlan::compile(&style, &members, size, fps, engine, self.fonts.len()).map_err(RenderError::render)?;
            self.captions.insert(key.clone(), compiled);
        }
        let captions = self.captions.get_mut(&key).expect("刚编好");
        captions.avoid_template(sequence.header.template.as_ref());
        // 一组按第一层的时钟取时刻：源素材时钟上没有作用实例时这一刻不画。
        let at = if captions.sequence_clock {
            Some(*sequence_seconds)
        } else {
            scope.as_ref().map(|s| s.source_seconds)
        };
        let rendered = match at {
            Some(at) => captions.render(at).map_err(RenderError::render)?,
            None => None,
        };
        let style_opacity = captions.opacity;
        if self.collect_caption_hits && rendered.is_some() && first.opacity * f64::from(style_opacity) > 0.0 {
            for mut hit in captions.hits(at.unwrap()).map_err(RenderError::render)? {
                let Some(layer) = admitted.iter().find(|layer| {
                    matches!(
                        &layer.content, Some(LayerContent::Caption { document_id, .. }) if document_id == &hit.document_id
                    )
                }) else {
                    continue;
                };
                hit.layer_id = first.item_id.clone();
                hit.item_id = layer.item_id.clone();
                // 统一回序列画布像素：预览质量、设备像素比与缩放不改变拾取位置。
                let kx = f64::from(plan.canvas.width) / f64::from(self.options.width);
                let ky = f64::from(plan.canvas.height) / f64::from(self.options.height);
                hit.cx *= kx;
                hit.cy *= ky;
                hit.w *= kx;
                hit.h *= ky;
                self.caption_hits.push(hit);
            }
        }
        // 字幕的提示是常设的：内核只在编译时报一次，预览每帧清掉报告后也要照报（与导出一致）。
        let (notes, missing) = captions.notes();
        for note in notes {
            self.warn(RENDER_NOTE, format!("{}：{note}", first.item_id));
        }
        self.note_missing_fonts(&first.item_id, missing);
        if let Some((pixmap, blend_mode)) = rendered {
            let opacity = first.opacity.clamp(0.0, 1.0) as f32 * style_opacity;
            // 字幕层大片透明：只在字的外包矩形里叠（与整幅画逐字节相同）。
            if render_raster::plan::composite_bounded(&mut self.frame, &pixmap, opacity, blend_mode).is_none() {
                self.frame.draw_pixmap(
                    0,
                    0,
                    pixmap.as_ref(),
                    &PixmapPaint {
                        opacity,
                        blend_mode,
                        quality: FilterQuality::Nearest,
                    },
                    Transform::identity(),
                    None,
                );
            }
        }
        Ok(())
    }

    /// 字幕编译结果依赖的剪辑：组里有字幕从转写取词时，词的去留与时刻随取用素材的实例与字幕实例变。只看这些实例，
    /// 改文字、贴纸等不让字幕重编。
    fn caption_signature(&self, sequence: &Sequence, document_ids: &[&str]) -> String {
        use std::hash::{DefaultHasher, Hash, Hasher};
        let worded = document_ids.iter().any(|id| {
            self.documents
                .get(id)
                .and_then(|d| d.source_document_id.as_deref())
                .is_some_and(|s| self.documents.get(s).is_some())
        });
        if !worded {
            return String::new();
        }
        let mut hasher = DefaultHasher::new();
        for item in &sequence.items {
            if matches!(
                item,
                TimelineItem::Video(_) | TimelineItem::Audio(_) | TimelineItem::Composition(_) | TimelineItem::Caption(_)
            ) {
                serde_json::to_string(item).unwrap_or_default().hash(&mut hasher);
            }
        }
        format!("{:016x}", hasher.finish())
    }

    /// 这一层画不画：画不出来的部分按选项报错或跳过。整层不画时为 `None`，否则给出跳过的效果种类。
    fn admit(&mut self, layer: &VisualLayer, sequence: &Sequence) -> Result<Option<HashSet<String>>, RenderError> {
        let items = check_layer(layer, &self.documents, sequence.header.template.as_ref());
        if items.is_empty() {
            return Ok(Some(HashSet::new()));
        }
        let drop = items.iter().any(UnsupportedItem::drops_layer);
        let skipped_effects: HashSet<String> = items
            .iter()
            .filter(|i| i.scope == "effect")
            .filter_map(|i| i.kind.clone())
            .collect();
        self.refuse_or_skip(items)?;
        Ok((!drop).then_some(skipped_effects))
    }

    fn refuse_or_skip(&mut self, items: Vec<UnsupportedItem>) -> Result<(), RenderError> {
        if !self.options.skip_unsupported {
            return Err(RenderError {
                code: "EXPORT_UNSUPPORTED_CONTENT".into(),
                message: items.iter().map(|i| i.message.clone()).collect::<Vec<_>>().join("；"),
                items,
            });
        }
        for item in items {
            if self.skipped_keys.insert(item.key()) {
                self.skipped.push(item);
            }
        }
        Ok(())
    }

    fn warn(&mut self, code: &'static str, detail: String) {
        if !self.warnings.iter().any(|w| w.code == code && w.detail == detail) {
            self.warnings.push(RenderWarning { code, detail });
        }
    }
}

/// 一帧里序列的只读上下文。
struct SequenceContext<'a> {
    sequence: &'a Sequence,
    assets: &'a BTreeMap<Id, AssetRecord>,
    items: HashMap<&'a str, &'a TimelineItem>,
    fps: f64,
    /// 序列的终点（秒，格式规范 §2.10：固定长度按帧，派生长度取实例的尾端）：元素动画与模板的进度、章节按它算。
    duration: f64,
    /// 整条序列的声音计划（这一帧有声波时才求）。
    audio: Option<Vec<AudioSegment>>,
}

/// 一个声波实例的频谱轨与它的来历。
#[derive(Clone)]
struct VizEntry {
    key: String,
    track: Option<Arc<VizTrack>>,
    /// 拼它时缺的素材频谱。
    missing: Vec<VersionRef>,
    /// 每一帧都要报的提示（说话人对不上）。
    notes: Vec<String>,
    /// `alwaysShow: false` 时每一帧有没有声；`None` 是一直画。
    audible: Option<Vec<bool>>,
}

impl<'a> SequenceContext<'a> {
    fn new(sequence: &'a Sequence, assets: &'a BTreeMap<Id, AssetRecord>) -> SequenceContext<'a> {
        let rate = sequence.header.fps;
        let fps = if rate.den > 0 && rate.num > 0 {
            rate.num as f64 / rate.den as f64
        } else {
            30.0
        };
        // 帧计划已经按同一份序列算过，这里的溢出只在计划之外调用时出现：退回按帧网格上的实例尾端算。
        let duration = render_graph::audio_plan::sequence_end(sequence)
            .map(|end| end.to_f64())
            .unwrap_or_else(|_| {
                let end = sequence
                    .items
                    .iter()
                    .filter_map(|i| i.span())
                    .map(|s| s.end_frame())
                    .max()
                    .unwrap_or(0);
                end as f64 / fps
            });
        SequenceContext {
            sequence,
            assets,
            items: sequence.items.iter().map(|i| (i.base().id.as_str(), i)).collect(),
            fps,
            duration,
            audio: None,
        }
    }
}

impl SequenceContext<'_> {
    /// 素材版本是不是 SVG 图片（按版本记录的 `mediaType`，不看字节）。
    fn is_svg(&self, asset: Option<&VersionRef>) -> bool {
        self.media_type_is(asset, SVG_MEDIA_TYPE)
    }

    /// 素材版本是不是 GIF 图片（同上）。
    fn is_gif(&self, asset: Option<&VersionRef>) -> bool {
        self.media_type_is(asset, GIF_MEDIA_TYPE)
    }

    fn media_type_is(&self, asset: Option<&VersionRef>, media_type: &str) -> bool {
        asset
            .and_then(|asset| self.assets.get(&asset.id)?.revisions.get(&asset.revision))
            .is_some_and(|revision| revision.media_type.eq_ignore_ascii_case(media_type))
    }
}

/// SVG 图片素材的媒体类型。
pub const SVG_MEDIA_TYPE: &str = "image/svg+xml";

/// GIF 图片素材的媒体类型：画面由帧光栅从素材字节解（动图按时刻取帧）。
pub const GIF_MEDIA_TYPE: &str = "image/gif";

/// 字幕层所在的组：样式文档的 ID，没有样式文档时是实例自己。
fn caption_group(layer: &VisualLayer) -> &str {
    match &layer.content {
        Some(LayerContent::Caption {
            style_document_id: Some(id),
            ..
        }) => id,
        _ => &layer.item_id,
    }
}

fn asset_item(layer: &VisualLayer, reason: &str, message: String) -> UnsupportedItem {
    UnsupportedItem {
        item_id: layer.item_id.clone(),
        scope: "asset",
        layer_kind: kind_name(layer.kind),
        effect_id: None,
        transition_id: None,
        kind: None,
        reason: reason.into(),
        message,
    }
}

/// Lottie 在实例里过了 `elapsed` 秒时取的时刻（`sticker.loop`，格式规范 §3.7）：`loop`（缺省）对时长取模，
/// `once` 播完停在末尾，`hold` 定格第一帧。
fn lottie_time(parameters: &Value, elapsed: f64, duration: f64) -> f64 {
    let elapsed = if elapsed.is_finite() { elapsed.max(0.0) } else { 0.0 };
    let mode = parameters
        .get("loop")
        .and_then(Value::as_str)
        .unwrap_or(timeline::schema::STICKER_LOOP_DEFAULT);
    if !(duration > 0.0) {
        return elapsed;
    }
    match mode {
        timeline::schema::STICKER_LOOP_HOLD => 0.0,
        // 末帧：时长减去不到一毫秒，落在最后一帧里。
        timeline::schema::STICKER_LOOP_ONCE => elapsed.min((duration - 0.0005).max(0.0)),
        _ => elapsed.rem_euclid(duration),
    }
}

/// 视频与图片实例的裁剪。
fn crop_of(item: &TimelineItem) -> Option<[f64; 4]> {
    let crop = match item {
        TimelineItem::Video(v) => v.crop.as_ref(),
        TimelineItem::Image(i) => i.crop.as_ref(),
        _ => None,
    }?;
    (crop.is_valid() && !crop.is_empty()).then(|| crop.rect())
}

/// 源画面按裁剪留下的区域复制一份（没有裁剪时整张复制）。
fn cropped(picture: &Pixmap, rect: Option<[f64; 4]>) -> Option<Pixmap> {
    let Some([u0, v0, u1, v1]) = rect else {
        return Some(picture.clone());
    };
    let (w, h) = (f64::from(picture.width()), f64::from(picture.height()));
    let x = (u0 * w).round().clamp(0.0, w - 1.0);
    let y = (v0 * h).round().clamp(0.0, h - 1.0);
    let cw = ((u1 * w).round() - x).clamp(1.0, w - x);
    let ch = ((v1 * h).round() - y).clamp(1.0, h - y);
    picture.clone_rect(tiny_skia::IntRect::from_xywh(x as i32, y as i32, cw as u32, ch as u32)?)
}

/// 去掉跳过的效果之后的 `fx`。种类名与帧计划的效果种类相同。
fn without(fx: &Fx, skipped: &HashSet<String>) -> Fx {
    let mut fx = fx.clone();
    for kind in skipped {
        match kind.as_str() {
            "filterPreset" => fx.filter_preset = None,
            "effectPreset" => fx.effect_preset = None,
            "colorAdjust" => (fx.grayscale, fx.brightness) = (None, None),
            "exposure" => fx.exposure = None,
            "contrast" => fx.contrast = None,
            "saturation" => fx.saturation = None,
            "hue" => fx.hue = None,
            "temperature" => fx.temperature = None,
            "blur" => fx.blur = None,
            "sharpen" => fx.sharpen = None,
            "noise" => fx.noise = None,
            "vignette" => fx.vignette = None,
            "stroke" => fx.stroke = None,
            "shadow" => fx.shadow = None,
            _ => {}
        }
    }
    fx
}

fn over(target: &mut Pixmap, layer: &Pixmap) {
    // 整幅不透明的层（整幅视频）原样拷过去；别的层（一行字、一张贴纸）只在非零像素的外包矩形里叠。都与下面逐字节相同。
    if render_raster::raster::copy_over(target, layer.as_ref(), Transform::identity())
        || render_raster::plan::composite_bounded(target, layer, 1.0, BlendMode::SourceOver).is_some()
    {
        return;
    }
    target.draw_pixmap(
        0,
        0,
        layer.as_ref(),
        &PixmapPaint {
            opacity: 1.0,
            blend_mode: BlendMode::SourceOver,
            quality: FilterQuality::Nearest,
        },
        Transform::identity(),
        None,
    );
}

fn fill(target: &mut Pixmap, color: Color) {
    let mut paint = tiny_skia::Paint::default();
    paint.set_color(color);
    if let Some(rect) = Rect::from_xywh(0.0, 0.0, target.width() as f32, target.height() as f32) {
        target.fill_rect(rect, &paint, Transform::identity(), None);
    }
}

/// 缺字体的提示（与字幕内核编译时报的同一句）。
pub fn missing_font_note(family: &str) -> String {
    format!("字体 {family:?} 在当前字体库中不可用，将使用 Noto Sans SC fallback")
}
