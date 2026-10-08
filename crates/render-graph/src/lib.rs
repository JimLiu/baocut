//! 帧计划（架构设计 §9.1、§9.4、§9.10）：视频在某一时刻的画面由哪些层叠成、每层怎么摆、取源的哪一刻，
//! 以及这一刻哪些声音在响。
//!
//! 这是渲染语义的单一实现：编辑器预览经 WASM 调它，原生导出直接链它，两边不各写一套。
//! 计划只描述「画什么、画在哪」，不解码、不合成；像素由各自的后端按计划去画。
//!
//! 覆盖全部实例种类。几何是 v2 元素模型的 `place`（画幅百分比），经 `timeline::geometry` 换成像素框；要解码画面的层
//! （视频、图片，以及素材贴纸、带素材的占位框、白板、有预渲染替身的合成）给出素材与取源的时刻；文字、图形与字幕给出
//! 摆放与时刻，内容是正式字段（文字样式、`ShapeProps`）；进度条、声波、彩纸、计数器、模板贴纸、Lottie 贴纸、手绘、
//! 占位框与模板层按内置生成器给出（参数就是 v2 的 props）。计划给不出画法的——没有预渲染替身的代码包合成、认不出的
//! 素材贴纸——标成 `unsupported`，由后端明确报出来，不画成空白（格式规范 §3.7）。
//! 裁剪折进 `sourceRect`；`fx` 按作用顺序列成效果（格式规范 §3.9）。像素由 `frame-render` 按实例本身的字段画（遮罩、
//! 平铺、元素动画与关键帧都在那里），计划只给层、顺序、时刻与转场。转场与闪避在层与声音上给出（格式规范 §3.5、§3.9）。
//! 章节不进计划。

pub mod audio_plan;
pub mod ducking;
pub mod envelope;
pub mod item_box;
pub mod text_plan;
pub mod video_plan;

use std::collections::{BTreeMap, HashMap};

use editor_semantics::{MediaTime, Rate, Ratio, TimeError, TimeMap, frame_time, frames_at, map_time};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use video_model::{
    AssetKind, AssetRecord, AudioItem, CompositionSource, Crop, Easing, EnvelopePoint, Fit, FrameSpan, Id, MediaFields, Place, Revision,
    Sequence, SoloGroup, TimelineItem, Track, Transition, TransitionKind, VersionRef, VideoSnapshot,
};

use crate::ducking::DuckingEnvelope;
use crate::item_box::{display_size, item_geometry, pixel_box};

/// 一帧的计划。图层按合成顺序排列：先画的在下面。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FramePlan {
    pub sequence_id: Id,
    pub sequence_revision: Revision,
    /// 这一刻所在的视频帧（向下取整）。实例是否在画面上按它判断。
    pub frame: i64,
    pub canvas: PlanCanvas,
    pub layers: Vec<VisualLayer>,
    pub voices: Vec<AudioVoice>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanCanvas {
    pub width: u32,
    pub height: u32,
    pub background: String,
    pub background_alpha: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LayerKind {
    Video,
    Image,
    Text,
    Shape,
    /// 内置生成器按局部时间画出来的画面：进度条、声波、彩纸、计数器、模板贴纸、Lottie 贴纸、手绘、占位框与模板层。
    Generator,
    /// 字幕：铺满画布，位置与外观由样式文档决定。
    Caption,
    /// 这一层该有画面但计划给不出画法（没有预渲染替身的代码包合成、认不出的素材贴纸）：后端要明确报出来，不画成空白。
    Unsupported,
}

/// 一个画面层。
///
/// `matrix` 把单位正方形映到画布像素：`x' = a·u + c·v + e`，`y' = b·u + d·v + f`，即 Canvas 2D 的
/// `setTransform(a, b, c, d, e, f)`。视频与图片把源画面的 `sourceRect`（相对源的显示尺寸归一化的
/// `[u0, v0, u1, v1]`）画进单位正方形；文字、图形、生成器与不支持的层的单位正方形就是实例的布局框（已含翻转）；
/// 字幕的单位正方形是整张画布。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualLayer {
    pub item_id: Id,
    pub kind: LayerKind,
    /// 取画面的素材：视频、图片，或不支持的代码包本身。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset: Option<VersionRef>,
    /// 视频要取的源时刻（秒）；生成器是合成的局部时刻（经过它的时间映射）。其余没有。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_seconds: Option<f64>,
    /// 源时间相对序列时间的速度：播放时媒体元素按它走，定格是 0。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_rate: Option<f64>,
    pub matrix: [f64; 6],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_rect: Option<[f64; 4]>,
    pub opacity: f64,
    /// 文字、图形、生成器、字幕与不支持的层要画的内容；视频与图片没有。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<LayerContent>,
    /// `fx` 的效果，按作用顺序（格式规范 §3.9），长度已从 540 短边换成画布像素。遮罩、平铺、元素动画与关键帧不在这里：
    /// 后端按实例本身的字段画。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<LayerEffect>,
    /// 这一刻这一层在转场里（格式规范 §3.9）。不认识这个字段的后端只画这一层本身，即硬切。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transition: Option<Box<LayerTransition>>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerEffect {
    pub id: Id,
    pub kind: String,
    #[serde(skip_serializing_if = "Map::is_empty")]
    pub params: Map<String, Value>,
    /// 画不出来的原因。眼下 `fx` 的每一步都有画法，计划不再写它；字段留给只在某个后端缺画法的效果。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsupported: Option<String>,
}

/// 层所在的转场。`progress` 是这一刻在转场窗口里的位置（0 到 1，连续），`eased` 是经过缓动之后的值，
/// 画法都按 `eased`。两侧转场的另一侧在 `partner` 里给出（它在自己的区间之外，源时刻在 handles 里）；
/// 单边转场没有 `partner`，另一侧是透明。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerTransition {
    pub id: Id,
    pub kind: String,
    #[serde(skip_serializing_if = "Map::is_empty")]
    pub params: Map<String, Value>,
    pub easing: Easing,
    pub progress: f64,
    pub eased: f64,
    /// 这一层是出场的一侧（`outgoing`）还是入场的一侧（`incoming`）。
    pub role: TransitionRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partner: Option<Box<VisualLayer>>,
    /// 认不出的转场种类：后端按硬切画（只画这一层）并报出来。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsupported: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TransitionRole {
    Outgoing,
    Incoming,
}

/// 层的内容，按 `kind` 区分。样式、几何与参数原样带上：它们的 schema 由后端解释，认不出的要报出来。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged, rename_all_fields = "camelCase")]
pub enum LayerContent {
    Text {
        text: String,
        style: Value,
    },
    Shape {
        shape: Value,
    },
    Generator {
        generator: String,
        version: u32,
        parameters: Value,
        /// 这一刻离实例开始过了多久、实例一共多长（序列时间，秒）：进度条与计数器按它们算。
        elapsed_seconds: f64,
        duration_seconds: f64,
    },
    Caption {
        /// 字幕实例跟随文档的当前版本，所以给的是文档 ID。
        document_id: Id,
        #[serde(skip_serializing_if = "Option::is_none")]
        style_document_id: Option<Id>,
        /// 这一刻的序列时间：文档在序列时钟上时按它找句子。
        sequence_seconds: f64,
        /// 文档在源素材时钟上时，这一刻经过哪个作用实例、落在它的源的哪一刻（§3.8）。没有作用实例时省略。
        #[serde(skip_serializing_if = "Option::is_none")]
        scope: Option<CaptionScope>,
    },
    Unsupported {
        reason: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionScope {
    pub item_id: Id,
    pub asset: VersionRef,
    pub source_seconds: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VoiceSource {
    /// 视频实例自带的声音。
    Embedded,
    /// 音频轨道上的实例。
    Audio,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioVoice {
    pub item_id: Id,
    pub source: VoiceSource,
    pub asset: VersionRef,
    pub source_seconds: f64,
    pub source_rate: f64,
    /// 这一刻的增益：实例的增益、淡入淡出、转场的声音交叉淡化与闪避都已算进去。
    pub gain_db: f64,
    /// 闪避正在压低这个声音时，压低之前的增益（界面据此显示闪避）。没有被压低时省略。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unducked_gain_db: Option<f64>,
    /// 转场的声音交叉淡化里的声音（两侧都带同一个转场 ID）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transition_id: Option<Id>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PlanError {
    pub code: String,
    pub message: String,
}

impl PlanError {
    fn new(code: &str, message: impl Into<String>) -> PlanError {
        PlanError {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl PlanError {
    fn overflow(field: &str) -> PlanError {
        PlanError::new("TIME_ARITHMETIC_OVERFLOW", format!("{field} 超出范围"))
    }
}

impl From<TimeError> for PlanError {
    fn from(error: TimeError) -> PlanError {
        let message = match &error {
            TimeError::Invalid { field, reason } => format!("{field}：{reason}"),
            TimeError::Overflow { field } => format!("{field} 超出范围"),
            TimeError::NotOnFrameGrid { .. } => "时刻不在帧边界上".to_string(),
        };
        PlanError::new(error.code(), message)
    }
}

/// 求计划需要的那部分视频：序列与素材。
#[derive(Clone, Copy)]
pub struct VideoView<'a> {
    pub sequences: &'a BTreeMap<Id, Sequence>,
    pub assets: &'a BTreeMap<Id, AssetRecord>,
}

impl<'a> From<&'a VideoSnapshot> for VideoView<'a> {
    fn from(video: &'a VideoSnapshot) -> VideoView<'a> {
        VideoView {
            sequences: &video.sequences,
            assets: &video.assets,
        }
    }
}

/// 界面送来的视频：与 `VideoSnapshot` 同形，只读计划用得到的字段，其余忽略。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDocument {
    pub root_sequence_id: Id,
    pub sequences: BTreeMap<Id, Sequence>,
    pub assets: BTreeMap<Id, AssetRecord>,
}

impl PlanDocument {
    pub fn view(&self) -> VideoView<'_> {
        VideoView {
            sequences: &self.sequences,
            assets: &self.assets,
        }
    }
}

/// 交互预览（§9.4 Interactive）的入口：宿主时钟给的是浮点秒，先按微秒取近似再求计划。
/// 严格导出不走这里，按输出帧的精确时刻调 [`plan_frame`]（§9.10）。
pub fn plan_interactive(video: VideoView<'_>, sequence_id: &str, seconds: f64) -> Result<FramePlan, PlanError> {
    plan_interactive_with_speech(video, sequence_id, seconds, None)
}

/// 同 [`plan_interactive`]；`speech` 见 [`plan_frame_with_speech`]。
pub fn plan_interactive_with_speech(
    video: VideoView<'_>,
    sequence_id: &str,
    seconds: f64,
    speech: Option<&[(f64, f64)]>,
) -> Result<FramePlan, PlanError> {
    if !seconds.is_finite() {
        return Err(PlanError::new("INVALID_TIME", "时刻必须是有限的数"));
    }
    let micros = libm::round(seconds.max(0.0) * 1_000_000.0);
    let t = Ratio::new(micros as i128, 1_000_000).ok_or_else(|| PlanError::overflow("t"))?;
    // 浮点秒落不到帧边界上（1/30 秒写不成有限小数），离下一个边界不到 1 微秒就算到了：
    // 否则跳到第 n 帧会拿到第 n − 1 帧的画面。
    let fps = match video.sequences.get(sequence_id) {
        Some(sequence) => Some(checked_fps(sequence)?),
        None => None,
    };
    let t = match fps.and_then(|fps| frame_time(frames_at(t, fps)?.ceil(), fps)) {
        Some(boundary)
            if boundary
                .checked_sub(t)
                .is_some_and(|gap| gap <= Ratio::new(1, 1_000_000).expect("常量")) =>
        {
            boundary
        }
        _ => t,
    };
    plan_frame_with_speech(video, sequence_id, t, speech)
}

/// 序列时刻 `t` 的计划。不展开按文稿触发的闪避（没有词流）；要展开时用 [`plan_frame_with_speech`]。
pub fn plan_frame(video: VideoView<'_>, sequence_id: &str, t: Ratio) -> Result<FramePlan, PlanError> {
    plan_frame_with_speech(video, sequence_id, t, None)
}

/// 序列时刻 `t` 的计划。`speech` 是有效词流在序列上的区间（[`audio_plan::speech_activity`]，与导出的声音计划
/// 同一份）：给了时按文稿触发的闪避也展开，声音的 `gainDb` 与导出在同一时刻相同。
pub fn plan_frame_with_speech(
    video: VideoView<'_>,
    sequence_id: &str,
    t: Ratio,
    speech: Option<&[(f64, f64)]>,
) -> Result<FramePlan, PlanError> {
    if t.is_negative() {
        return Err(PlanError::new("INVALID_TIME", "时刻不能为负"));
    }
    let sequence = video
        .sequences
        .get(sequence_id)
        .ok_or_else(|| PlanError::new("SEQUENCE_NOT_FOUND", format!("没有序列 {sequence_id}")))?;
    let header = &sequence.header;
    let fps = checked_fps(sequence)?;
    let frame = frames_at(t, fps).ok_or_else(|| PlanError::overflow("t"))?.floor();
    let frame = i64::try_from(frame).map_err(|_| PlanError::overflow("t"))?;

    let tracks: HashMap<&str, &Track> = sequence.tracks.iter().map(|track| (track.id.as_str(), track)).collect();
    let items: HashMap<&str, &TimelineItem> = sequence.items.iter().map(|item| (item.base().id.as_str(), item)).collect();
    let rules = TrackRules::new(&sequence.tracks);
    let canvas = (header.canvas.width as f64, header.canvas.height as f64);

    let mut layers: Vec<(LayerOrder<'_>, VisualLayer)> = Vec::new();
    let mut voices: Vec<(i64, AudioVoice)> = Vec::new();
    for item in &sequence.items {
        let base = item.base();
        let Some(track) = tracks.get(base.track_id.as_str()) else {
            continue;
        };
        if !base.enabled {
            continue;
        }
        match item {
            TimelineItem::Video(video_item) => {
                if !covers(video_item.span, frame) {
                    continue;
                }
                let start = frame_start(video_item.span, fps)?;
                let rate = source_rate(&video_item.time_map)?;
                let source = map_time(&video_item.time_map, start, t)?.to_f64();
                if rules.visible(track)
                    && let Some(layer) = visual_layer(video, item, t, fps, canvas)?
                {
                    layers.push((
                        LayerOrder::new(track, &video_item.base.id, video_item.base.paint_order, video_item.span),
                        layer,
                    ));
                }
                if video_item.embedded_audio.enabled && rules.audible(track) {
                    let audio = &video_item.embedded_audio;
                    let bounds = span_bounds(video_item.span, fps)?;
                    let fade = fade_db(bounds, t, audio.fade_in.as_ref(), audio.fade_out.as_ref())?;
                    let volume = volume_at(audio.volume, &audio.envelope, bounds, t)?;
                    voices.push((
                        track.order,
                        AudioVoice {
                            item_id: video_item.base.id.clone(),
                            source: VoiceSource::Embedded,
                            asset: video_item.asset_ref.clone(),
                            source_seconds: source,
                            source_rate: rate,
                            gain_db: volume_db(volume) + fade,
                            unducked_gain_db: None,
                            transition_id: None,
                        },
                    ));
                }
            }
            TimelineItem::Audio(audio) => {
                if !rules.audible(track) || audio.mix.muted {
                    continue;
                }
                let Some((source, rate)) = audio_timing(audio, t, fps)? else {
                    continue;
                };
                let bounds = audio_bounds(audio, fps)?;
                let fade = fade_db(bounds, t, audio.mix.fade_in.as_ref(), audio.mix.fade_out.as_ref())?;
                let volume = volume_at(audio.mix.volume, &audio.mix.envelope, bounds, t)?;
                voices.push((
                    track.order,
                    AudioVoice {
                        item_id: audio.base.id.clone(),
                        source: VoiceSource::Audio,
                        asset: audio.asset_ref.clone(),
                        source_seconds: source,
                        source_rate: rate,
                        gain_db: volume_db(volume) + fade,
                        unducked_gain_db: None,
                        transition_id: None,
                    },
                ));
            }
            // 有预渲染替身时按视频出画面与声音；没有时标成不支持。
            TimelineItem::Composition(composition) => {
                if !covers(composition.span, frame) {
                    continue;
                }
                let start = frame_start(composition.span, fps)?;
                let rate = source_rate(&composition.time_map)?;
                let source = map_time(&composition.time_map, start, t)?.to_f64();
                if rules.visible(track)
                    && let Some(layer) = visual_layer(video, item, t, fps, canvas)?
                {
                    let order = LayerOrder::new(track, &composition.base.id, composition.base.paint_order, composition.span);
                    layers.push((order, layer));
                }
                let Some(prerender) = &composition.prerender else {
                    continue;
                };
                if let Some(audio) = composition.audio.as_ref().filter(|a| a.enabled && rules.audible(track)) {
                    let bounds = span_bounds(composition.span, fps)?;
                    let fade = fade_db(bounds, t, audio.fade_in.as_ref(), audio.fade_out.as_ref())?;
                    let volume = volume_at(audio.volume, &audio.envelope, bounds, t)?;
                    voices.push((
                        track.order,
                        AudioVoice {
                            item_id: composition.base.id.clone(),
                            source: VoiceSource::Embedded,
                            asset: prerender.clone(),
                            source_seconds: source,
                            source_rate: rate,
                            gain_db: volume_db(volume) + fade,
                            unducked_gain_db: None,
                            transition_id: None,
                        },
                    ));
                }
            }
            // 其余视觉实例：画得了的给出画法，画不了的给出不支持的层（`visual_layer` 对每个种类都有答案）。
            TimelineItem::Image(_)
            | TimelineItem::Text(_)
            | TimelineItem::Shape(_)
            | TimelineItem::Sticker(_)
            | TimelineItem::Visualizer(_)
            | TimelineItem::Progress(_)
            | TimelineItem::Draw(_)
            | TimelineItem::Placeholder(_)
            | TimelineItem::Confetti(_)
            | TimelineItem::Whiteboard(_) => {
                let span = item.span().expect("视觉实例都在帧网格上");
                if !covers(span, frame) || !rules.visible(track) {
                    continue;
                }
                if let Some(layer) = visual_layer(video, item, t, fps, canvas)? {
                    layers.push((LayerOrder::new(track, &base.id, base.paint_order, span), layer));
                }
            }
            // 字幕只在自己的区间里显示（§3.8）。文档在源素材时钟上时，经过此刻覆盖着的作用实例投影；
            // 有作用实例却没有一个覆盖此刻（剪掉的空隙），这一刻就没有字幕。
            TimelineItem::Caption(caption) => {
                if !covers(caption.span, frame) || !rules.visible(track) {
                    continue;
                }
                let scope = if caption.scope_item_ids.is_empty() {
                    None
                } else {
                    let mut found = None;
                    for id in &caption.scope_item_ids {
                        let Some(scope_item) = items.get(id.as_str()) else {
                            continue;
                        };
                        if let Some(scope) = scope_at(scope_item, frame, t, fps)? {
                            found = Some(scope);
                            break;
                        }
                    }
                    match found {
                        Some(scope) => Some(scope),
                        None => continue,
                    }
                };
                let content = LayerContent::Caption {
                    document_id: caption.document_id.clone(),
                    style_document_id: caption.style_document_id.clone(),
                    sequence_seconds: t.to_f64(),
                    scope,
                };
                let layer = VisualLayer {
                    item_id: caption.base.id.clone(),
                    kind: LayerKind::Caption,
                    asset: None,
                    source_seconds: None,
                    source_rate: None,
                    matrix: [canvas.0, 0.0, 0.0, canvas.1, 0.0, 0.0],
                    source_rect: None,
                    opacity: 1.0,
                    content: Some(content),
                    effects: Vec::new(),
                    transition: None,
                };
                layers.push((
                    LayerOrder::new(track, &caption.base.id, caption.base.paint_order, caption.span),
                    layer,
                ));
            }
        }
    }

    let scene = Scene {
        video,
        sequence,
        items: &items,
        tracks: &tracks,
        rules: &rules,
        frame,
        t,
        fps,
        canvas,
    };
    for (_, layer) in &mut layers {
        layer.transition = scene.layer_transition(&layer.item_id)?;
    }
    scene.crossfade_voices(&mut voices)?;
    if !sequence.ducking.is_empty() {
        for (_, voice) in &mut voices {
            let Some(item) = items.get(voice.item_id.as_str()) else {
                continue;
            };
            let reduction = DuckingEnvelope::for_item_with_speech(sequence, item, fps, speech)?.reduction_db(t.to_f64());
            if reduction > 0.0 {
                voice.unducked_gain_db = Some(voice.gain_db);
                voice.gain_db -= reduction;
            }
        }
    }

    // 轨道 `order` 越大越靠上；同一轨道内按 `paintOrder`（格式规范 §3.3），不依赖存储的返回顺序。
    layers.sort_by(|(a, _), (b, _)| a.cmp(b));
    let mut layers: Vec<VisualLayer> = layers.into_iter().map(|(_, layer)| layer).collect();
    // 模板层（序列上的对象，§3.17）：每个打开的层是一个生成器层，在自己的框里，按文档的顺序盖在最上面。
    // 进度类的变量按序列的长度算（最后一个实例的终点）。
    if let Some(template) = &header.template {
        let end = sequence
            .items
            .iter()
            .filter_map(TimelineItem::span)
            .map(|s| s.end_frame())
            .max()
            .unwrap_or(0);
        let duration = frame_time(end as i128, fps)
            .ok_or_else(|| PlanError::overflow("durationFrames"))?
            .to_f64();
        for layer in template.layers.iter().filter(|l| l.on) {
            let r = layer.rect;
            let pixel = PixelBox {
                cx: canvas.0 * (r.x + r.w / 2.0) / 100.0,
                cy: canvas.1 * (r.y + r.h / 2.0) / 100.0,
                width: canvas.0 * r.w / 100.0,
                height: canvas.1 * r.h / 100.0,
                rotation: 0.0,
                flip_x: false,
                flip_y: false,
            };
            let content = LayerContent::Generator {
                generator: "baocut.template".into(),
                version: 1,
                parameters: serde_json::json!({ "layerId": layer.id }),
                elapsed_seconds: clean(t.to_f64()),
                duration_seconds: clean(duration),
            };
            if let Some(mut planned) = box_layer(&layer.id, LayerKind::Generator, &pixel, 1.0, content) {
                planned.source_seconds = Some(clean(t.to_f64()));
                planned.source_rate = Some(1.0);
                layers.push(planned);
            }
        }
    }
    voices.sort_by(|(a, x), (b, y)| a.cmp(b).then_with(|| x.item_id.cmp(&y.item_id)));

    Ok(FramePlan {
        sequence_id: sequence.id.clone(),
        sequence_revision: sequence.revision.clone(),
        frame,
        canvas: PlanCanvas {
            width: header.canvas.width,
            height: header.canvas.height,
            background: header.canvas.background.clone(),
            background_alpha: 1.0,
        },
        layers,
        voices: voices.into_iter().map(|(_, voice)| voice).collect(),
    })
}

/// 视觉实例在 `t` 的画面层（含效果栈）。不检查它是否覆盖这一刻、是否启用、轨道是否显示：转场的另一侧
/// 要在自己的区间之外取画面（源时刻落在 handles 里）。画不出来（全透明、框没有面积）时为 `None`；音频与字幕没有。
/// 旧画法画不了的种类给出 `Unsupported` 的层，不是 `None`。
fn visual_layer(
    video: VideoView<'_>,
    item: &TimelineItem,
    t: Ratio,
    fps: Rate,
    canvas: (f64, f64),
) -> Result<Option<VisualLayer>, PlanError> {
    let generator = |name: &str, parameters: Value, span: FrameSpan| -> Result<(LayerContent, f64), PlanError> {
        let start = frame_start(span, fps)?;
        let elapsed = t.checked_sub(start).ok_or_else(|| PlanError::overflow("t"))?;
        let duration = frame_time(span.duration_frames as i128, fps).ok_or_else(|| PlanError::overflow("durationFrames"))?;
        let content = LayerContent::Generator {
            generator: name.into(),
            version: 1,
            parameters,
            elapsed_seconds: elapsed.to_f64(),
            duration_seconds: duration.to_f64(),
        };
        Ok((content, elapsed.to_f64()))
    };
    // 生成器的层：局部时刻就是离实例开始过了多久，速度 1。
    let generator_layer = |item_id: &str, pixel: &PixelBox, opacity: f64, (content, elapsed): (LayerContent, f64)| {
        box_layer(item_id, LayerKind::Generator, pixel, opacity, content).map(|mut layer| {
            layer.source_seconds = Some(elapsed);
            layer.source_rate = Some(1.0);
            layer
        })
    };
    let unsupported = |item_id: &str, pixel: &PixelBox, reason: &str| {
        let content = LayerContent::Unsupported { reason: reason.into() };
        box_layer(item_id, LayerKind::Unsupported, pixel, 1.0, content)
    };
    let keyframed = video
        .sequences
        .values()
        .flat_map(|s| &s.header.animation_bindings)
        .any(|b| b.target_id == item.base().id);
    // 有关键帧时静态的不透明度不作数（这一刻的值由后端求），层不能因为静态的 0 被丢掉。
    let op = |opacity: f64| if keyframed { 1.0 } else { opacity };
    // 框只有一份推法（`item_box`）：舞台的选中框与这里画的是同一个。
    let Some(geometry) = item_geometry(item, video.assets) else {
        return Ok(None);
    };
    let (pixel, _) = pixel_box(&geometry, canvas);
    let layer = match item {
        TimelineItem::Video(v) => {
            let start = frame_start(v.span, fps)?;
            let timing = (map_time(&v.time_map, start, t)?.to_f64(), source_rate(&v.time_map)?);
            let dims = display_size(video.assets, &v.asset_ref);
            let fit = fit_of(&v.media);
            media_layer(
                &v.base.id,
                LayerKind::Video,
                &v.asset_ref,
                Some(timing),
                &pixel,
                fit,
                op(v.place.opacity()),
                dims,
                v.crop.as_ref(),
            )
        }
        TimelineItem::Image(i) => {
            let dims = display_size(video.assets, &i.asset_ref);
            let fit = fit_of(&i.media);
            media_layer(
                &i.base.id,
                LayerKind::Image,
                &i.asset_ref,
                None,
                &pixel,
                fit,
                op(i.place.opacity()),
                dims,
                i.crop.as_ref(),
            )
        }
        TimelineItem::Text(text) => {
            let style = text.style.clone().unwrap_or_else(|| Value::Object(Map::new()));
            match &text.counter {
                // 计数器：旧画法的 `baocut.counter` 读 v2 的 counter 字段、文字与样式。
                Some(counter) => {
                    let mut parameters = match serde_json::to_value(counter) {
                        Ok(Value::Object(map)) => map,
                        _ => Map::new(),
                    };
                    parameters.insert("text".into(), Value::String(text.text.clone().unwrap_or_default()));
                    parameters.insert("style".into(), style);
                    let made = generator("baocut.counter", Value::Object(parameters), text.span)?;
                    generator_layer(&text.base.id, &pixel, op(text.place.opacity()), made)
                }
                None => {
                    let content = LayerContent::Text {
                        text: text.text.clone().unwrap_or_default(),
                        style,
                    };
                    box_layer(&text.base.id, LayerKind::Text, &pixel, op(text.place.opacity()), content)
                }
            }
        }
        TimelineItem::Shape(shape) => {
            let content = LayerContent::Shape {
                shape: serde_json::to_value(&shape.shape).unwrap_or(Value::Null),
            };
            box_layer(&shape.base.id, LayerKind::Shape, &pixel, op(shape.place.opacity()), content)
        }
        TimelineItem::Sticker(sticker) => {
            let asset_kind = sticker.asset_ref.as_ref().and_then(|r| video.assets.get(&r.id)).map(|a| a.kind);
            match (&sticker.asset_ref, asset_kind) {
                // 视频贴纸（动图转成的带透明的视频）按视频画，取源的时刻按 `sticker.loop`（格式规范 §3.7）。
                (Some(asset), Some(AssetKind::Video)) => {
                    let dims = display_size(video.assets, asset);
                    let start = frame_start(sticker.span, fps)?;
                    let elapsed = t.checked_sub(start).ok_or_else(|| PlanError::overflow("t"))?.to_f64();
                    let timing = sticker_timing(video.assets, asset, sticker.sticker.r#loop.as_deref(), elapsed);
                    media_layer(
                        &sticker.base.id,
                        LayerKind::Video,
                        asset,
                        Some(timing),
                        &pixel,
                        Fit::Contain,
                        op(sticker.place.opacity()),
                        dims,
                        None,
                    )
                }
                // 图片贴纸按图片画，框按图片的宽高比。
                (Some(asset), Some(AssetKind::Image)) => {
                    let dims = display_size(video.assets, asset);
                    media_layer(
                        &sticker.base.id,
                        LayerKind::Image,
                        asset,
                        None,
                        &pixel,
                        Fit::Contain,
                        op(sticker.place.opacity()),
                        dims,
                        None,
                    )
                }
                (Some(asset), Some(AssetKind::Lottie)) => {
                    let parameters = serde_json::json!({
                        "asset": asset,
                        "loop": sticker.sticker.r#loop.clone().unwrap_or_else(|| "loop".into()),
                    });
                    let made = generator("baocut.lottie", parameters, sticker.span)?;
                    generator_layer(&sticker.base.id, &pixel, op(sticker.place.opacity()), made)
                }
                (Some(_), _) => unsupported(&sticker.base.id, &pixel, "sticker-asset-not-supported"),
                (None, _) => {
                    let mut parameters = Map::new();
                    if let Some(id) = &sticker.sticker.template_id {
                        parameters.insert("templateId".into(), Value::String(id.clone()));
                    }
                    if !sticker.sticker.fill_overrides.is_empty() {
                        parameters.insert(
                            "fillOverrides".into(),
                            serde_json::to_value(&sticker.sticker.fill_overrides).unwrap_or(Value::Null),
                        );
                    }
                    let made = generator("baocut.sticker", Value::Object(parameters), sticker.span)?;
                    generator_layer(&sticker.base.id, &pixel, op(sticker.place.opacity()), made)
                }
            }
        }
        TimelineItem::Visualizer(v) => {
            let parameters = serde_json::to_value(&v.visualizer).unwrap_or(Value::Null);
            let made = generator("baocut.audio-visualizer", parameters, v.span)?;
            generator_layer(&v.base.id, &pixel, op(v.place.opacity()), made)
        }
        TimelineItem::Progress(p) => {
            let parameters = serde_json::to_value(&p.progress).unwrap_or(Value::Null);
            let made = generator("baocut.progress", parameters, p.span)?;
            generator_layer(&p.base.id, &pixel, op(p.place.opacity()), made)
        }
        TimelineItem::Confetti(c) => {
            let parameters = serde_json::to_value(&c.confetti).unwrap_or(Value::Null);
            let made = generator("baocut.confetti", parameters, c.span)?;
            generator_layer(&c.base.id, &pixel, op(c.place.opacity()), made)
        }
        TimelineItem::Draw(d) => {
            let parameters = serde_json::to_value(&d.draw).unwrap_or(Value::Null);
            let made = generator("baocut.draw", parameters, d.span)?;
            generator_layer(&d.base.id, &pixel, op(d.place.opacity()), made)
        }
        // 占位框：有素材时按视觉媒体画（图片或视频，框是占位框的缺省落位），没有时画占位的外观。
        TimelineItem::Placeholder(p) => {
            let asset_kind = p.asset_ref.as_ref().and_then(|r| video.assets.get(&r.id)).map(|a| a.kind);
            match (&p.asset_ref, asset_kind) {
                (Some(asset), Some(kind @ (AssetKind::Image | AssetKind::Video))) => {
                    let dims = display_size(video.assets, asset);
                    let timing = if kind == AssetKind::Video {
                        let start = frame_start(p.span, fps)?;
                        Some((clean(t.checked_sub(start).ok_or_else(|| PlanError::overflow("t"))?.to_f64()), 1.0))
                    } else {
                        None
                    };
                    let layer_kind = if kind == AssetKind::Video {
                        LayerKind::Video
                    } else {
                        LayerKind::Image
                    };
                    media_layer(
                        &p.base.id,
                        layer_kind,
                        asset,
                        timing,
                        &pixel,
                        p.media.fit(),
                        op(p.place.opacity()),
                        dims,
                        None,
                    )
                }
                (Some(_), _) => unsupported(&p.base.id, &pixel, "placeholder-asset-not-supported"),
                (None, _) => {
                    let parameters = serde_json::to_value(&p.placeholder).unwrap_or(Value::Null);
                    let made = generator("baocut.placeholder", parameters, p.span)?;
                    generator_layer(&p.base.id, &pixel, op(p.place.opacity()), made)
                }
            }
        }
        // 白板：图片素材按揭示顺序画出来；要解码的是那张图片。
        TimelineItem::Whiteboard(w) => {
            let dims = display_size(video.assets, &w.asset_ref);
            media_layer(
                &w.base.id,
                LayerKind::Image,
                &w.asset_ref,
                None,
                &pixel,
                w.media.fit(),
                op(w.place.opacity()),
                dims,
                None,
            )
        }
        TimelineItem::Composition(composition) => {
            let start = frame_start(composition.span, fps)?;
            let rate = source_rate(&composition.time_map)?;
            let source = map_time(&composition.time_map, start, t)?.to_f64();
            match &composition.prerender {
                Some(prerender) => {
                    let dims = display_size(video.assets, prerender);
                    media_layer(
                        &composition.base.id,
                        LayerKind::Video,
                        prerender,
                        Some((source, rate)),
                        &pixel,
                        Fit::Contain,
                        op(composition.place.opacity()),
                        dims,
                        None,
                    )
                }
                None => {
                    let CompositionSource::Bundle { asset_ref } = &composition.source;
                    unsupported(&composition.base.id, &pixel, "bundle-without-prerender").map(|mut layer| {
                        layer.asset = Some(asset_ref.clone());
                        layer
                    })
                }
            }
        }
        TimelineItem::Audio(_) | TimelineItem::Caption(_) => None,
    };
    let Some(mut layer) = layer else {
        return Ok(None);
    };
    if layer.kind != LayerKind::Unsupported {
        layer.effects = layer_effects(item, canvas);
    }
    Ok(Some(layer))
}

/// 视频贴纸在实例里过了 `elapsed` 秒时取源的时刻与速度（`sticker.loop`，格式规范 §3.7）：`loop`（缺省）对素材时长
/// 取模，`once` 播完停在末尾，`hold` 定格第一帧。不知道素材时长时按经过的时间取。
fn sticker_timing(assets: &BTreeMap<Id, AssetRecord>, asset: &VersionRef, mode: Option<&str>, elapsed: f64) -> (f64, f64) {
    let duration = assets
        .get(&asset.id)
        .and_then(|a| a.revisions.get(&asset.revision))
        .and_then(|r| r.duration.as_ref())
        .and_then(|d| d.to_ratio("duration").ok())
        .map(Ratio::to_f64)
        .filter(|d| *d > 0.0);
    let elapsed = elapsed.max(0.0);
    match (mode.unwrap_or(timeline::schema::STICKER_LOOP_DEFAULT), duration) {
        (timeline::schema::STICKER_LOOP_HOLD, _) => (0.0, 0.0),
        (timeline::schema::STICKER_LOOP_ONCE, Some(d)) => (clean(elapsed.min(d)), 1.0),
        (_, Some(d)) => (clean(elapsed.rem_euclid(d)), 1.0),
        (_, None) => (clean(elapsed), 1.0),
    }
}

/// 层的效果：`fx` 的每一步按作用顺序（格式规范 §3.9 的 1–14，遮罩与揭示除外）列出，省略或恒等值的不列；
/// 长度从 540 短边换成画布像素，色相从 [-1, 1] 换成度。
fn layer_effects(item: &TimelineItem, canvas: (f64, f64)) -> Vec<LayerEffect> {
    let Some(fx) = item.fx() else {
        return Vec::new();
    };
    let unit = canvas.0.min(canvas.1) / timeline::REFERENCE_SHORT_EDGE;
    let on = |v: Option<f64>| v.filter(|v| v.is_finite() && *v != 0.0);
    let mut steps: Vec<(&str, Value)> = Vec::new();
    if let Some(preset) = fx.filter_preset.filter(|p| *p != video_model::FilterPreset::None) {
        steps.push(("filterPreset", serde_json::json!({ "preset": preset })));
    }
    if let Some(preset) = fx.effect_preset.filter(|p| *p != video_model::EffectPreset::None) {
        steps.push((
            "effectPreset",
            serde_json::json!({ "preset": preset, "intensity": fx.effect_intensity.unwrap_or(1.0) }),
        ));
    }
    if on(fx.grayscale).is_some() || on(fx.brightness).is_some() {
        steps.push((
            "colorAdjust",
            serde_json::json!({ "grayscale": fx.grayscale.unwrap_or(0.0), "brightness": fx.brightness.unwrap_or(0.0) }),
        ));
    }
    for (kind, value) in [("exposure", fx.exposure), ("contrast", fx.contrast), ("saturation", fx.saturation)] {
        if let Some(value) = on(value) {
            steps.push((kind, serde_json::json!({ "amount": value })));
        }
    }
    if let Some(hue) = on(fx.hue) {
        steps.push(("hue", serde_json::json!({ "degrees": hue * 180.0 })));
    }
    if let Some(temperature) = on(fx.temperature) {
        steps.push(("temperature", serde_json::json!({ "amount": temperature })));
    }
    if let Some(blur) = on(fx.blur) {
        steps.push(("blur", serde_json::json!({ "radius": blur * unit })));
    }
    for (kind, value) in [("sharpen", fx.sharpen), ("noise", fx.noise), ("vignette", fx.vignette)] {
        if let Some(value) = on(value) {
            steps.push((kind, serde_json::json!({ "amount": value })));
        }
    }
    if let Some(stroke) = &fx.stroke {
        steps.push(("stroke", serde_json::json!({ "width": stroke.width * unit, "color": stroke.color })));
    }
    if let Some(shadow) = &fx.shadow {
        steps.push((
            "shadow",
            serde_json::json!({
                "offsetX": shadow.offset_x * unit,
                "offsetY": shadow.offset_y * unit,
                "blur": shadow.blur * unit,
                "color": shadow.color,
                "opacity": shadow.opacity,
            }),
        ));
    }
    steps
        .into_iter()
        .map(|(kind, params)| LayerEffect {
            id: format!("fx.{kind}"),
            kind: kind.into(),
            params: match params {
                Value::Object(map) => map,
                _ => Map::new(),
            },
            unsupported: None,
        })
        .collect()
}

/// 求转场与声音交叉淡化时要用到的这一帧的上下文。
struct Scene<'a> {
    video: VideoView<'a>,
    sequence: &'a Sequence,
    items: &'a HashMap<&'a str, &'a TimelineItem>,
    tracks: &'a HashMap<&'a str, &'a Track>,
    rules: &'a TrackRules,
    frame: i64,
    t: Ratio,
    fps: Rate,
    canvas: (f64, f64),
}

/// 覆盖这一帧的转场：两侧实例与窗口里的进度。
struct Active<'a> {
    left: Option<&'a TimelineItem>,
    right: Option<&'a TimelineItem>,
    progress: f64,
}

impl<'a> Scene<'a> {
    /// 转场在这一帧是否生效（窗口见 [`transition_window`]）。
    fn active(&self, tr: &Transition) -> Result<Option<Active<'a>>, PlanError> {
        let Some((left, right, start, end)) = transition_window(self.items, tr) else {
            return Ok(None);
        };
        if self.frame < start || self.frame >= end {
            return Ok(None);
        }
        let from = frame_time(start as i128, self.fps).ok_or_else(|| PlanError::overflow("transition"))?;
        let to = frame_time(end as i128, self.fps).ok_or_else(|| PlanError::overflow("transition"))?;
        let elapsed = self.t.checked_sub(from).ok_or_else(|| PlanError::overflow("t"))?;
        let length = to.checked_sub(from).ok_or_else(|| PlanError::overflow("transition"))?;
        let progress = elapsed.checked_div(length).ok_or_else(|| PlanError::overflow("t"))?.to_f64();
        Ok(Some(Active {
            left,
            right,
            progress: clean(progress.clamp(0.0, 1.0)),
        }))
    }

    /// 实例的层这一刻所在的转场（格式规范 §3.9）。两侧转场的另一侧画不出来（停用、全透明）时按硬切，没有转场。
    fn layer_transition(&self, item_id: &str) -> Result<Option<Box<LayerTransition>>, PlanError> {
        for tr in &self.sequence.transitions {
            if !tr.item_ids().any(|id| id == item_id) {
                continue;
            }
            let Some(active) = self.active(tr)? else {
                continue;
            };
            let outgoing = tr.left_item_id.as_deref() == Some(item_id);
            let unsupported = matches!(tr.kind, TransitionKind::Unsupported { .. }).then(|| "unknown-kind".to_string());
            let other = if outgoing { active.right } else { active.left };
            let partner = match other {
                Some(other) if unsupported.is_none() => {
                    let visible = self
                        .tracks
                        .get(other.base().track_id.as_str())
                        .is_some_and(|t| self.rules.visible(t));
                    if !other.base().enabled || !visible {
                        continue;
                    }
                    match visual_layer(self.video, other, self.t, self.fps, self.canvas)? {
                        Some(layer) => Some(Box::new(layer)),
                        None => continue,
                    }
                }
                _ => None,
            };
            return Ok(Some(Box::new(LayerTransition {
                id: tr.id.clone(),
                kind: tr.kind.name().to_string(),
                params: tr.kind.params(),
                easing: tr.easing,
                progress: active.progress,
                eased: clean(tr.easing.apply(active.progress)),
                role: if outgoing {
                    TransitionRole::Outgoing
                } else {
                    TransitionRole::Incoming
                },
                partner,
                unsupported,
            })));
        }
        Ok(None)
    }

    /// 带 `audioCrossfade` 的两侧转场：两段视频自带的声音在窗口里等功率交叉淡化——出场乘 cos(p·π/2)，
    /// 入场乘 sin(p·π/2)，p 是线性进度（不经缓动）。另一侧在自己的区间之外，按它的时间映射取 handles 里的声音，
    /// 不套它自己的淡入淡出。两侧都启用才淡化；某一侧关掉了自带声音时，那一侧是静音，另一侧照样按曲线淡入或淡出。
    fn crossfade_voices(&self, voices: &mut Vec<(i64, AudioVoice)>) -> Result<(), PlanError> {
        for tr in self.sequence.transitions.iter().filter(|tr| tr.audio_crossfade) {
            let Some(active) = self.active(tr)? else {
                continue;
            };
            let (Some(TimelineItem::Video(left)), Some(TimelineItem::Video(right))) = (active.left, active.right) else {
                continue;
            };
            // 有一侧停用时按硬切：另一侧照常发声，不做淡化。
            if !left.base.enabled || !right.base.enabled {
                continue;
            }
            let Some(track) = self.tracks.get(left.base.track_id.as_str()) else {
                continue;
            };
            if !self.rules.audible(track) {
                continue;
            }
            let angle = active.progress * std::f64::consts::FRAC_PI_2;
            for (side, amplitude) in [(left, libm::cos(angle)), (right, libm::sin(angle))] {
                let db = 20.0 * libm::log10(amplitude.max(1e-5));
                let existing = voices
                    .iter_mut()
                    .find(|(_, v)| v.item_id == side.base.id && v.source == VoiceSource::Embedded);
                if let Some((_, voice)) = existing {
                    voice.gain_db += db;
                    voice.transition_id = Some(tr.id.clone());
                } else if side.embedded_audio.enabled {
                    let start = frame_start(side.span, self.fps)?;
                    let audio = &side.embedded_audio;
                    let volume = volume_at(audio.volume, &audio.envelope, span_bounds(side.span, self.fps)?, self.t)?;
                    voices.push((
                        track.order,
                        AudioVoice {
                            item_id: side.base.id.clone(),
                            source: VoiceSource::Embedded,
                            asset: side.asset_ref.clone(),
                            source_seconds: map_time(&side.time_map, start, self.t)?.to_f64(),
                            source_rate: source_rate(&side.time_map)?,
                            gain_db: volume_db(volume) + db,
                            unducked_gain_db: None,
                            transition_id: Some(tr.id.clone()),
                        },
                    ));
                }
            }
        }
        Ok(())
    }
}

/// 转场在时间线上的窗口 `[start, end)`（帧）与两侧实例。计划不信任送进来的视频：实例不在、不在帧网格上、两侧不在同一轨道上
/// 首尾相接、窗口越出实例的，都当作没有这个转场（硬切）。handles 不在这里查：源时刻越出素材时由后端夹到素材的两端。
/// 帧计划与音频导出的区间计划（[`audio_plan`]）共用这一份判断。
pub(crate) fn transition_window<'a>(
    items: &HashMap<&'a str, &'a TimelineItem>,
    tr: &Transition,
) -> Option<(Option<&'a TimelineItem>, Option<&'a TimelineItem>, i64, i64)> {
    let lookup = |id: &Option<Id>| match id {
        None => Some(None),
        Some(id) => items.get(id.as_str()).map(|item| Some(*item)),
    };
    let (Some(left), Some(right)) = (lookup(&tr.left_item_id), lookup(&tr.right_item_id)) else {
        return None;
    };
    let (ls, rs) = (left.and_then(TimelineItem::span), right.and_then(TimelineItem::span));
    if (left.is_some() && ls.is_none()) || (right.is_some() && rs.is_none()) {
        return None;
    }
    if let (Some(l), Some(r), Some(ls), Some(rs)) = (left, right, ls, rs)
        && (l.base().track_id != r.base().track_id || ls.end_frame() != rs.from_frame)
    {
        return None;
    }
    let (start, end) = tr.window(ls, rs)?;
    let lo = ls.or(rs).map_or(0, |s| s.from_frame);
    let hi = rs.or(ls).map_or(0, |s| s.end_frame());
    if start >= end || start < lo || end > hi {
        return None;
    }
    Some((left, right, start, end))
}

/// 轨道的显示与发声规则：隐藏只影响画面，静音只影响声音；Solo 分视觉组与音频组各自生效。
pub(crate) struct TrackRules {
    visual_solo: bool,
    audio_solo: bool,
}

impl TrackRules {
    pub(crate) fn new(tracks: &[Track]) -> TrackRules {
        let solo = |group| tracks.iter().any(|t| t.solo.enabled && t.solo.group == group);
        TrackRules {
            visual_solo: solo(SoloGroup::Visual),
            audio_solo: solo(SoloGroup::Audio),
        }
    }

    fn visible(&self, track: &Track) -> bool {
        track.visible && (!self.visual_solo || (track.solo.enabled && track.solo.group == SoloGroup::Visual))
    }

    pub(crate) fn audible(&self, track: &Track) -> bool {
        !track.muted && (!self.audio_solo || (track.solo.enabled && track.solo.group == SoloGroup::Audio))
    }
}

#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct LayerOrder<'a> {
    track_order: i64,
    track_id: &'a str,
    paint_order: i64,
    from_frame: i64,
    item_id: &'a str,
}

impl<'a> LayerOrder<'a> {
    fn new(track: &'a Track, item_id: &'a str, paint_order: i64, span: FrameSpan) -> LayerOrder<'a> {
        LayerOrder {
            track_order: track.order,
            track_id: &track.id,
            paint_order,
            from_frame: span.from_frame,
            item_id,
        }
    }
}

/// 视觉实例占 `[fromFrame, fromFrame + durationFrames)`。
fn covers(span: FrameSpan, frame: i64) -> bool {
    span.from_frame <= frame && frame < span.end_frame()
}

fn frame_start(span: FrameSpan, fps: Rate) -> Result<Ratio, PlanError> {
    frame_time(span.from_frame as i128, fps).ok_or_else(|| PlanError::overflow("fromFrame"))
}

/// 计划不信任送进来的视频：帧率与速度先校验，非法的分母在下面的有理数运算里会 panic，在 WASM 里就是陷阱。
fn checked_fps(sequence: &Sequence) -> Result<Rate, PlanError> {
    sequence.header.fps.validate("fps")?;
    Ok(sequence.header.fps)
}

/// 源时间相对序列时间的速度。
fn source_rate(time_map: &TimeMap) -> Result<f64, PlanError> {
    match time_map {
        TimeMap::Linear { rate, .. } => {
            rate.validate("timeMap.rate")?;
            Ok(rate.ratio().to_f64())
        }
        TimeMap::Hold { .. } => Ok(0.0),
    }
}

/// 音频实例响的区间 `[start, end)`：开始与长度在采样级（格式规范 §2.10），不按帧判断。
pub(crate) fn audio_bounds(audio: &AudioItem, fps: Rate) -> Result<(Ratio, Ratio), PlanError> {
    let offset = audio.subframe_offset.to_ratio("subframeOffset")?;
    let start = frame_time(audio.from_frame as i128, fps)
        .and_then(|s| s.checked_add(offset))
        .ok_or_else(|| PlanError::overflow("fromFrame"))?;
    let end = start
        .checked_add(audio.play_duration.to_ratio("playDuration")?)
        .ok_or_else(|| PlanError::overflow("playDuration"))?;
    Ok((start, end))
}

/// 帧网格上的实例占的区间 `[start, end)`。
pub(crate) fn span_bounds(span: FrameSpan, fps: Rate) -> Result<(Ratio, Ratio), PlanError> {
    let end = frame_time(span.end_frame() as i128, fps).ok_or_else(|| PlanError::overflow("durationFrames"))?;
    Ok((frame_start(span, fps)?, end))
}

/// 实例在 `t` 这一刻的音量（线性倍数）：有包络时是包络的取样值（取代 `volume`），没有时是 `volume`
/// （格式规范 §3.9，[`envelope::VolumeCurve`]）。`t` 可以在实例的区间之外（转场取 handles 时），包络在两端外延。
fn volume_at(volume: f64, points: &[EnvelopePoint], (start, end): (Ratio, Ratio), t: Ratio) -> Result<f64, PlanError> {
    if points.is_empty() {
        return Ok(volume);
    }
    let duration = end.checked_sub(start).ok_or_else(|| PlanError::overflow("duration"))?.to_f64();
    let local = t.checked_sub(start).ok_or_else(|| PlanError::overflow("t"))?.to_f64();
    Ok(envelope::VolumeCurve::new(volume, points, duration).at(local))
}

/// 淡入淡出在 `t` 这一刻折成的增益（dB，叠在 `gainDb` 上）：振幅在淡入段从 0 线性升到 1，在淡出段线性降到 0
/// （格式规范 §3.9）。两段重叠时取较小的振幅；不在淡变里是 0 dB。
fn fade_db((start, end): (Ratio, Ratio), t: Ratio, fade_in: Option<&MediaTime>, fade_out: Option<&MediaTime>) -> Result<f64, PlanError> {
    let since = t.checked_sub(start).ok_or_else(|| PlanError::overflow("t"))?.to_f64();
    let until = end.checked_sub(t).ok_or_else(|| PlanError::overflow("t"))?.to_f64();
    let mut amplitude: f64 = 1.0;
    for (fade, distance, field) in [(fade_in, since, "fadeIn"), (fade_out, until, "fadeOut")] {
        let length = fade.map(|f| f.to_ratio(field)).transpose()?.map_or(0.0, Ratio::to_f64);
        if length > 0.0 {
            amplitude = amplitude.min((distance / length).max(0.0));
        }
    }
    // -100 dB 已经听不见；不写 -∞，计划要能序列化成 JSON。
    Ok(if amplitude >= 1.0 {
        0.0
    } else {
        20.0 * amplitude.max(1e-5).log10()
    })
}

/// 音频实例在 `t` 的源时刻与速度；不在它响的区间里时为 `None`。
fn audio_timing(audio: &AudioItem, t: Ratio, fps: Rate) -> Result<Option<(f64, f64)>, PlanError> {
    let (start, end) = audio_bounds(audio, fps)?;
    if t < start || t >= end {
        return Ok(None);
    }
    let rate = source_rate(&audio.time_map)?;
    Ok(Some((map_time(&audio.time_map, start, t)?.to_f64(), rate)))
}

/// 字幕的作用实例在 `t` 覆盖着时，它的源在这一刻的位置。只有带时间映射的实例（视频、音频、合成）能投影；
/// 实例停用或所在轨道隐藏、静音不影响投影，那只决定它自己出不出画面与声音。
fn scope_at(item: &TimelineItem, frame: i64, t: Ratio, fps: Rate) -> Result<Option<CaptionScope>, PlanError> {
    let (id, asset, seconds) = match item {
        TimelineItem::Video(video) => {
            if !covers(video.span, frame) {
                return Ok(None);
            }
            let start = frame_start(video.span, fps)?;
            (&video.base.id, &video.asset_ref, map_time(&video.time_map, start, t)?.to_f64())
        }
        TimelineItem::Composition(composition) => {
            let CompositionSource::Bundle { asset_ref } = &composition.source;
            let asset = composition.prerender.as_ref().unwrap_or(asset_ref);
            if !covers(composition.span, frame) {
                return Ok(None);
            }
            let start = frame_start(composition.span, fps)?;
            (&composition.base.id, asset, map_time(&composition.time_map, start, t)?.to_f64())
        }
        TimelineItem::Audio(audio) => match audio_timing(audio, t, fps)? {
            Some((seconds, _)) => (&audio.base.id, &audio.asset_ref, seconds),
            None => return Ok(None),
        },
        _ => return Ok(None),
    };
    Ok(Some(CaptionScope {
        item_id: id.clone(),
        asset: asset.clone(),
        source_seconds: seconds,
    }))
}

/// 实例在画布上的像素框：中心、宽高、旋转（度，绕中心顺时针）与翻转。由 v2 的 `place`（画幅百分比）经
/// `timeline::geometry` 换算，旧画法按它画。
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct PixelBox {
    cx: f64,
    cy: f64,
    width: f64,
    height: f64,
    rotation: f64,
    flip_x: bool,
    flip_y: bool,
}

impl PixelBox {
    pub(crate) fn new(place: &Place, (x, y, width, height): (f64, f64, f64, f64)) -> PixelBox {
        PixelBox {
            cx: x + width / 2.0,
            cy: y + height / 2.0,
            width,
            height,
            rotation: place.rot.unwrap_or(0.0),
            flip_x: place.flip_x,
            flip_y: place.flip_y,
        }
    }
}

/// 源画面在框里怎么放（v2 缺省 `cover`）。不知道源的尺寸时 [`media_layer`] 铺满框，不看它。
fn fit_of(media: &MediaFields) -> Fit {
    media.fit()
}

/// 视频与图片层（格式规范 §3.5）：源画面按 `fit` 放进实例的像素框里。不知道源的尺寸时铺满。
#[allow(clippy::too_many_arguments)]
fn media_layer(
    item_id: &str,
    kind: LayerKind,
    asset: &VersionRef,
    timing: Option<(f64, f64)>,
    pixel: &PixelBox,
    fit: Fit,
    opacity: f64,
    source: Option<(f64, f64)>,
    crop: Option<&Crop>,
) -> Option<VisualLayer> {
    let opacity = drawable(pixel, opacity)?;
    let (bw, bh) = (pixel.width, pixel.height);
    // 裁剪在适配之前：留下的区域当作源画面去适配，取源的区域再换回整个源的坐标（格式规范 §3.5）。
    let [cl, ct, cr, cb] = crop.filter(|c| c.is_valid()).map_or([0.0, 0.0, 1.0, 1.0], Crop::rect);
    let source = source.map(|(sw, sh)| (sw * (cr - cl), sh * (cb - ct)));

    // 内容在框里的矩形（相对框左上角）与取源的区域。
    let (cw, ch, ox, oy, rect) = match (fit, source) {
        (_, None) => (bw, bh, 0.0, 0.0, [0.0, 0.0, 1.0, 1.0]),
        (Fit::Contain, Some((sw, sh))) => {
            let scale = (bw / sw).min(bh / sh);
            let (w, h) = (sw * scale, sh * scale);
            (w, h, (bw - w) / 2.0, (bh - h) / 2.0, [0.0, 0.0, 1.0, 1.0])
        }
        (Fit::Cover, Some((sw, sh))) => {
            let scale = (bw / sw).max(bh / sh);
            let (u, v) = (bw / (sw * scale), bh / (sh * scale));
            (
                bw,
                bh,
                0.0,
                0.0,
                [(1.0 - u) / 2.0, (1.0 - v) / 2.0, (1.0 + u) / 2.0, (1.0 + v) / 2.0],
            )
        }
    };

    Some(VisualLayer {
        item_id: item_id.to_string(),
        kind,
        asset: Some(asset.clone()),
        source_seconds: timing.map(|(seconds, _)| seconds),
        source_rate: timing.map(|(_, rate)| rate),
        matrix: placement(pixel, (cw, ch, ox, oy)),
        source_rect: Some(
            [
                cl + rect[0] * (cr - cl),
                ct + rect[1] * (cb - ct),
                cl + rect[2] * (cr - cl),
                ct + rect[3] * (cb - ct),
            ]
            .map(clean),
        ),
        opacity,
        content: None,
        effects: Vec::new(),
        transition: None,
    })
}

/// 内容就是整个像素框的层：文字、图形、生成器与不支持的层。
fn box_layer(item_id: &str, kind: LayerKind, pixel: &PixelBox, opacity: f64, content: LayerContent) -> Option<VisualLayer> {
    let opacity = drawable(pixel, opacity)?;
    Some(VisualLayer {
        item_id: item_id.to_string(),
        kind,
        asset: None,
        source_seconds: None,
        source_rate: None,
        matrix: placement(pixel, (pixel.width, pixel.height, 0.0, 0.0)),
        source_rect: None,
        opacity,
        content: Some(content),
        effects: Vec::new(),
        transition: None,
    })
}

/// 画得出来的实例的不透明度：框要是有限的数、要有面积、不能全透明。
fn drawable(pixel: &PixelBox, opacity: f64) -> Option<f64> {
    let opacity = if opacity.is_finite() { opacity.clamp(0.0, 1.0) } else { 0.0 };
    let finite = [pixel.width, pixel.height, pixel.cx, pixel.cy, pixel.rotation]
        .iter()
        .all(|v| v.is_finite());
    (opacity > 0.0 && finite && pixel.width > 0.0 && pixel.height > 0.0).then_some(opacity)
}

/// 单位正方形 → 画布像素的矩阵（格式规范 §3.5）：框绕自己的中心旋转（角度，顺时针）。
/// `content` 是内容在框里的矩形（宽、高与相对框左上角的偏移）。翻转是内容绕自己的中心镜像，
/// 先于旋转生效；内容在框里居中，所以和翻转整个框是一回事。
fn placement(pixel: &PixelBox, content: (f64, f64, f64, f64)) -> [f64; 6] {
    let (cw, ch, ox, oy) = content;
    let (bw, bh) = (pixel.width, pixel.height);
    let (sin, cos) = rotation(pixel.rotation);
    let (px, py) = (pixel.cx, pixel.cy);
    let (qx, qy) = (ox - 0.5 * bw, oy - 0.5 * bh);
    let [mut a, mut b, mut c, mut d, mut e, mut f] = [
        cw * cos,
        cw * sin,
        -ch * sin,
        ch * cos,
        px + qx * cos - qy * sin,
        py + qx * sin + qy * cos,
    ];
    // u → 1 − u：矩阵右乘 [−1, 0, 0, 1, 1, 0]。
    if pixel.flip_x {
        (e, f) = (e + a, f + b);
        (a, b) = (-a, -b);
    }
    // v → 1 − v：矩阵右乘 [1, 0, 0, −1, 0, 1]。
    if pixel.flip_y {
        (e, f) = (e + c, f + d);
        (c, d) = (-c, -d);
    }
    [a, b, c, d, e, f].map(clean)
}

/// 线性音量倍数折成 dB：0 记作 -100 dB（听不见；不写 -∞，计划要能序列化成 JSON）。
pub(crate) fn volume_db(volume: f64) -> f64 {
    if !volume.is_finite() {
        return -100.0;
    }
    clean(20.0 * libm::log10(volume.max(1e-5)))
}

/// 角度的正弦与余弦。90° 的倍数给精确值，其余经 libm 求，原生与 wasm32 结果一致。
fn rotation(degrees: f64) -> (f64, f64) {
    let normalized = libm::fmod(degrees, 360.0);
    let normalized = if normalized < 0.0 { normalized + 360.0 } else { normalized };
    match normalized {
        0.0 => (0.0, 1.0),
        90.0 => (1.0, 0.0),
        180.0 => (0.0, -1.0),
        270.0 => (-1.0, 0.0),
        _ => {
            let radians = normalized * std::f64::consts::PI / 180.0;
            (libm::sin(radians), libm::cos(radians))
        }
    }
}

/// 去掉 `-0.0`：输出要稳定，同一个计划只有一种写法。
pub(crate) fn clean(value: f64) -> f64 {
    if value == 0.0 { 0.0 } else { value }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotation_is_exact_on_right_angles() {
        assert_eq!(rotation(0.0), (0.0, 1.0));
        assert_eq!(rotation(-90.0), (-1.0, 0.0));
        assert_eq!(rotation(450.0), (1.0, 0.0));
        let (sin, cos) = rotation(30.0);
        assert!((sin - 0.5).abs() < 1e-12 && (cos - 3f64.sqrt() / 2.0).abs() < 1e-12);
    }

    #[test]
    fn clean_drops_negative_zero() {
        assert!(clean(-0.0).is_sign_positive());
        assert_eq!(clean(-1.5), -1.5);
    }
}
