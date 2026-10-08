//! 视频的交换 DTO（视频格式规范 §3、§4）。画面元素的种类与参数采用 v2 的元素模型（`crates/timeline`）：
//! 种类与 `ElementKind` 一一对应，参数的字段名、取值与范围以它为准；实例的身份、所在的轨道与时间是
//! v3 的容器。各种类的 props 直接用 `timeline::schema` 的类型；几何、效果、动画等在 v2 里会写出
//! `null` 的类型，这里另有不写 `null` 的交换形式，校验时换成 `timeline` 的同名类型。
//! 文稿类内容（转写、翻译、字幕样式、剪口集合等）是版本化的文档：快照里只有文档头，正文按版本另取；
//! 转写、译文与剪口集合正文的 DTO 在 [`speech`]、[`translation`] 与 [`cut_set`]（§5.2、§5.3、§6.7），字幕样式正文的
//! 核对在 [`caption_style`]（§5.6）。

use std::collections::BTreeMap;

use editor_semantics::{MediaTime, Rate, TimeMap};
use serde::{Deserialize, Serialize};
use serde_json::Value;

mod animation;
pub mod caption_style;
pub mod cut_set;
mod ducking;
pub mod editorial_proposal;
mod effect;
mod marker;
mod place;
pub mod speech;
mod transition;
pub mod translation;

pub use animation::{Animation, AnimationBinding, AnimationSlot, Keyframe, KeyframeProperty, bindings_to_timeline};
pub use ducking::{DuckingGroup, DuckingRule, DuckingTrigger};
pub use effect::{
    Crop, EffectPreset, FX_SHADOW_BLUR_RANGE, FX_SHADOW_OPACITY_RANGE, FX_STROKE_WIDTH_MAX, FX_TEMPERATURE_RANGE, FilterPreset, Fx,
    FxShadow, FxStroke, Mask, MaskShape, is_color,
};
pub use marker::{Marker, MarkerKind};
pub use place::{Background, CornerRadii, Fit, MediaFields, Place, Tile, VisualMode};
pub use timeline::protocol::template::TemplateDoc as TemplateLayers;
pub use timeline::schema::{
    ConfettiProps, CounterProps, DrawProps, PlaceholderProps, ProgressProps, ShapeProps, StickerProps, VisualizerProps, WhiteboardProps,
};
pub use transition::{Direction, Easing, SINGLE_SIDED_KINDS, TWO_SIDED_ONLY_KINDS, Transition, TransitionKind, TransitionPlacement};

pub type Id = String;
pub type Revision = String;

pub const VIDEO_FORMAT: &str = "baocut.video";
/// 当前的格式版本。3 起画面元素采用 v2 的元素模型（§1.4）；只接受这一个版本，旧版本的视频要重新导入。
pub const SCHEMA_VERSION: u32 = 3;
/// 画布底色的缺省值（§3.2）。
pub const DEFAULT_CANVAS_BACKGROUND: &str = "#000000";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionRef {
    pub id: Id,
    pub revision: Revision,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameSpan {
    pub from_frame: i64,
    pub duration_frames: i64,
}

impl FrameSpan {
    pub fn end_frame(&self) -> i64 {
        self.from_frame + self.duration_frames
    }
}

/// 视频快照（§3.1）。工作态由 VideoStore 持有；快照不是第二个写入端。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSnapshot {
    pub format: String,
    pub schema_version: u32,
    pub time_contract_version: u32,
    pub id: Id,
    pub name: String,
    pub revision: Revision,
    pub root_sequence_id: Id,
    pub sequences: BTreeMap<Id, Sequence>,
    pub assets: BTreeMap<Id, AssetRecord>,
    /// 文档头（§4.4）。正文不在快照里。
    pub documents: BTreeMap<Id, DocumentRecord>,
    pub fonts: BTreeMap<Id, Value>,
    pub localization_sets: BTreeMap<Id, Value>,
    pub canvas_variants: BTreeMap<Id, Value>,
    pub sync_groups: BTreeMap<Id, Value>,
    pub protections: BTreeMap<Id, ProtectionRecord>,
    pub checkpoints: BTreeMap<Id, Checkpoint>,
    pub links: Vec<Value>,
}

/// 序列（§3.2）。`tracks` 与 `items` 在存储里是各自的实体，快照时按顺序组装；`animationBindings` 在 [`SequenceHeader`] 里。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sequence {
    pub id: Id,
    pub revision: Revision,
    #[serde(flatten)]
    pub header: SequenceHeader,
    pub tracks: Vec<Track>,
    pub items: Vec<TimelineItem>,
    /// 转场（§3.9），按 ID 排序。
    #[serde(default)]
    pub transitions: Vec<Transition>,
    /// 标记与章节（§3.13），按帧排序。
    #[serde(default)]
    pub markers: Vec<Marker>,
    /// 闪避规则（§3.9），按 ID 排序。
    #[serde(default)]
    pub ducking: Vec<DuckingRule>,
}

/// 序列自身的字段（不含轨道与实例），作为一个实体保存。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceHeader {
    pub name: String,
    pub fps: Rate,
    pub canvas: Canvas,
    pub duration_policy: DurationPolicy,
    /// 关键帧绑定（§3.15）。和序列的其余字段一起保存，所以在这里而不在 [`Sequence`] 上；交换形式一样。
    #[serde(default)]
    pub animation_bindings: Vec<AnimationBinding>,
    /// 模板层（§3.17）；没有时省略。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<TemplateLayers>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Canvas {
    pub width: u32,
    pub height: u32,
    pub working_space: String,
    /// 画布底色：不透明的纯色 `#RRGGBB`，写出一律大写（§3.2）。
    pub background: String,
}

/// 画布底色：`#RRGGBB`（大小写不限），返回大写的写法；其他写法返回 `None`。
pub fn canvas_background(text: &str) -> Option<String> {
    (text.len() == 7 && text.starts_with('#') && text[1..].chars().all(|c| c.is_ascii_hexdigit())).then(|| text.to_ascii_uppercase())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DurationPolicy {
    Derived,
    Fixed { frames: i64 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    Visual,
    Audio,
    Subtitle,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: Id,
    pub order: i64,
    pub kind: TrackKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub locked: bool,
    pub visible: bool,
    pub muted: bool,
    pub solo: Solo,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Solo {
    pub enabled: bool,
    pub group: SoloGroup,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SoloGroup {
    Audio,
    Visual,
}

/// 所有实例共用的字段（§3.4）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemBase {
    pub id: Id,
    pub track_id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub enabled: bool,
    pub locked: bool,
    pub paint_order: i64,
    /// 没有这个字段的实例（早先的版本没有写）读作缺省的 `follow-cuts`（§3.16）。
    #[serde(default)]
    pub follow_policy: FollowPolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lineage: Option<ItemLineage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_group_id: Option<Id>,
    /// 实例在视频里的作用（开放词表）。`broll`、`watermark`、`screentext`、`overlay`、`frame` 写入时校验与种类的搭配。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// 生成来源的说明；引擎不解释，原样保留。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai: Option<Value>,
    /// 终点跟着序列末尾（§3.16）；不是时省略。
    #[serde(default, skip_serializing_if = "place::is_false")]
    pub until_sequence_end: bool,
    /// 命名空间下的扩展（§1.4）：引擎不解释，写回时保留。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extensions: BTreeMap<String, Value>,
}

/// 实例跟着什么移动（§3.16）。缺省 `follow-cuts`：按时刻放置的实例跟着剪口走；`sequence-fixed` 要显式选择。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
// 语义锚两头放在原处，读写与匹配都直接；实例数量不大，不为省内存装箱。
#[allow(clippy::large_enum_variant)]
pub enum FollowPolicy {
    /// 固定在序列时间上。
    SequenceFixed,
    /// 跟着剪口移动与缩短。
    #[default]
    FollowCuts,
    /// 跟着指定的片段移动与裁切。
    ItemLocal { item_id: Id },
    /// 起点、终点挂在词或句上，至少一个。
    SpeechAnchor {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        start: Option<SemanticAnchor>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        end: Option<SemanticAnchor>,
    },
    /// 音画成组，按规则联动。
    ExplicitLinkGroup { group_id: Id },
}

/// 语义锚（§3.16）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum SemanticAnchor {
    Word {
        speech_ref: VersionRef,
        word_id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        occurrence_id: Option<Id>,
        edge: AnchorEdge,
        /// 带符号的精确时长，映射到序列时间之后加上。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        offset: Option<MediaTime>,
    },
    Sentence {
        speech_ref: VersionRef,
        sentence_id: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        occurrence_id: Option<Id>,
        edge: AnchorEdge,
    },
    Item {
        item_id: Id,
        local_offset: MediaTime,
    },
    Sequence {
        sequence_id: Id,
        frame: i64,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnchorEdge {
    Start,
    End,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemLineage {
    pub origin_item_id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_item_id: Option<Id>,
    pub via_transaction_id: Id,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoItem {
    #[serde(flatten)]
    pub base: ItemBase,
    pub span: FrameSpan,
    pub place: Place,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animate: Option<Animation>,
    #[serde(flatten)]
    pub media: MediaFields,
    pub asset_ref: VersionRef,
    pub time_map: TimeMap,
    /// 源画面的裁剪，在 `fit` 之前生效（§3.5）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop: Option<Crop>,
    /// 内嵌音频的路由。拆开成独立音频实例之前，跟着画面播放。
    pub embedded_audio: EmbeddedAudio,
}

/// 视频实例的内嵌音频、合成实例自己的声音（§3.9）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedAudio {
    pub enabled: bool,
    /// 线性倍数，[0, 4]。
    pub volume: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fade_in: Option<MediaTime>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fade_out: Option<MediaTime>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub envelope: Vec<EnvelopePoint>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageItem {
    #[serde(flatten)]
    pub base: ItemBase,
    pub span: FrameSpan,
    pub place: Place,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animate: Option<Animation>,
    #[serde(flatten)]
    pub media: MediaFields,
    pub asset_ref: VersionRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop: Option<Crop>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tile: Option<Tile>,
    /// 图片的编辑来源（`file` / `html`）；渲染只用 `assetRef`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// `source` 为 `html` 时保留的原始片段。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
}

/// 文字实例：一段文字或计时读数，加文字样式（§3.6）。样式是 v2 的文字样式对象，引擎按对象保存。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextItem {
    #[serde(flatten)]
    pub base: ItemBase,
    pub span: FrameSpan,
    pub place: Place,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animate: Option<Animation>,
    /// 与 `counter` 二选一，必须有其一。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub counter: Option<CounterProps>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_preset_id: Option<String>,
    /// `top` / `center` / `bottom`：`place.y` 钉住文字块的哪一处，缺省 `center`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tile: Option<Tile>,
}

/// 图形实例（§3.6）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeItem {
    #[serde(flatten)]
    pub base: ItemBase,
    pub span: FrameSpan,
    pub place: Place,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animate: Option<Animation>,
    pub shape: ShapeProps,
}

/// 贴纸（§3.7）：模板贴纸画目录里的矢量，素材贴纸画 `assetRef` 指向的图片、视频或 Lottie。
/// `MediaFields` 只用于素材贴纸。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerItem {
    #[serde(flatten)]
    pub base: ItemBase,
    pub span: FrameSpan,
    pub place: Place,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animate: Option<Animation>,
    #[serde(flatten)]
    pub media: MediaFields,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_ref: Option<VersionRef>,
    pub sticker: StickerProps,
}

impl StickerItem {
    pub fn is_asset(&self) -> bool {
        self.sticker.source == timeline::schema::STICKER_SOURCE_ASSET
    }
}

/// 声波（§3.7）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualizerItem {
    #[serde(flatten)]
    pub base: ItemBase,
    pub span: FrameSpan,
    pub place: Place,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animate: Option<Animation>,
    pub visualizer: VisualizerProps,
}

/// 进度条（§3.7）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressItem {
    #[serde(flatten)]
    pub base: ItemBase,
    pub span: FrameSpan,
    pub place: Place,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animate: Option<Animation>,
    pub progress: ProgressProps,
}

/// 手绘（§3.7）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawItem {
    #[serde(flatten)]
    pub base: ItemBase,
    pub span: FrameSpan,
    pub place: Place,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animate: Option<Animation>,
    pub draw: DrawProps,
}

/// 占位框（§3.7）：没有 `assetRef` 时画占位的外观，有时按视觉媒体画。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceholderItem {
    #[serde(flatten)]
    pub base: ItemBase,
    pub span: FrameSpan,
    pub place: Place,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animate: Option<Animation>,
    #[serde(flatten)]
    pub media: MediaFields,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_ref: Option<VersionRef>,
    pub placeholder: PlaceholderProps,
}

/// 彩纸（§3.7）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfettiItem {
    #[serde(flatten)]
    pub base: ItemBase,
    pub span: FrameSpan,
    pub place: Place,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animate: Option<Animation>,
    pub confetti: ConfettiProps,
}

/// 白板手绘（§3.7）：一个图片素材按推导出的顺序画出来。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhiteboardItem {
    #[serde(flatten)]
    pub base: ItemBase,
    pub span: FrameSpan,
    pub place: Place,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animate: Option<Animation>,
    #[serde(flatten)]
    pub media: MediaFields,
    pub asset_ref: VersionRef,
    pub whiteboard: WhiteboardProps,
}

/// 合成实例：由代码包按局部时间画出来的画面（§3.7）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositionItem {
    #[serde(flatten)]
    pub base: ItemBase,
    pub span: FrameSpan,
    pub place: Place,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animate: Option<Animation>,
    pub source: CompositionSource,
    pub parameter_values: Value,
    pub time_map: TimeMap,
    /// 预渲染替身：把这段合成渲染好的视频素材，与合成共用一条时间映射。
    /// 合成的运行环境不可用或来不及实时渲染时，预览与导出用它代替。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prerender: Option<VersionRef>,
    /// 合成自己发出的声音的路由；没有声音的合成不写。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<EmbeddedAudio>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<Mask>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fx: Option<Fx>,
}

/// 合成的来源：代码包素材的一个版本（§4.3、代码包规范）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum CompositionSource {
    Bundle { asset_ref: VersionRef },
}

/// 字幕实例：在一段序列时间里显示一份字幕文档（§3.8）。它跟随文档的当前版本，所以引用的是文档 ID。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionItem {
    #[serde(flatten)]
    pub base: ItemBase,
    pub span: FrameSpan,
    pub document_id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_document_id: Option<Id>,
    /// 字幕的词时间经过哪些实例的 timeMap 投影到序列上。空表示文档里的时间已经是序列时间。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scope_item_ids: Vec<Id>,
}

/// 音频实例：精确的开始位置是 `fromFrame` + `subframeOffset`，长度是 `playDuration`（§2.10）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioItem {
    #[serde(flatten)]
    pub base: ItemBase,
    pub asset_ref: VersionRef,
    pub from_frame: i64,
    pub subframe_offset: MediaTime,
    pub play_duration: MediaTime,
    pub time_map: TimeMap,
    pub mix: AudioMix,
}

/// 混音（§3.9）。实例上保存的增益只有线性倍数 `volume`。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMix {
    /// 线性倍数，[0, 4]，缺省 1。
    pub volume: f64,
    #[serde(default, skip_serializing_if = "place::is_false")]
    pub muted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fade_in: Option<MediaTime>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fade_out: Option<MediaTime>,
    /// 音量包络；有它时取代 `volume`。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub envelope: Vec<EnvelopePoint>,
}

/// 音量包络的一个点：时刻是实例局部的精确时间或实例长度的百分比，二选一。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvelopePoint {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<MediaTime>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub percent: Option<f64>,
    /// 线性倍数，[0, 4]。
    pub volume: f64,
    /// 进入这一点的那一段的缓动，缺省 `linear`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ease: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TimelineItem {
    Video(VideoItem),
    Image(ImageItem),
    Audio(AudioItem),
    Text(TextItem),
    Shape(ShapeItem),
    Sticker(StickerItem),
    Visualizer(VisualizerItem),
    Progress(ProgressItem),
    Draw(DrawItem),
    Placeholder(PlaceholderItem),
    Confetti(ConfettiItem),
    Whiteboard(WhiteboardItem),
    Composition(CompositionItem),
    Caption(CaptionItem),
}

/// 对每个画面实例（有 `span` 与 `place` 的种类）展开同一段代码。
macro_rules! visual_items {
    ($value:expr, $item:ident => $body:expr, $other:pat => $fallback:expr) => {
        match $value {
            TimelineItem::Video($item) => $body,
            TimelineItem::Image($item) => $body,
            TimelineItem::Text($item) => $body,
            TimelineItem::Shape($item) => $body,
            TimelineItem::Sticker($item) => $body,
            TimelineItem::Visualizer($item) => $body,
            TimelineItem::Progress($item) => $body,
            TimelineItem::Draw($item) => $body,
            TimelineItem::Placeholder($item) => $body,
            TimelineItem::Confetti($item) => $body,
            TimelineItem::Whiteboard($item) => $body,
            TimelineItem::Composition($item) => $body,
            $other => $fallback,
        }
    };
}

impl TimelineItem {
    pub fn base(&self) -> &ItemBase {
        match self {
            TimelineItem::Audio(a) => &a.base,
            TimelineItem::Caption(c) => &c.base,
            other => visual_items!(other, item => &item.base, _ => unreachable!()),
        }
    }

    pub fn base_mut(&mut self) -> &mut ItemBase {
        match self {
            TimelineItem::Audio(a) => &mut a.base,
            TimelineItem::Caption(c) => &mut c.base,
            other => visual_items!(other, item => &mut item.base, _ => unreachable!()),
        }
    }

    /// `type` 的写法，同 v2 的 `ElementKind::as_str`（另有 `composition`、`caption`）。
    pub fn kind_name(&self) -> &'static str {
        match self {
            TimelineItem::Video(_) => "video",
            TimelineItem::Image(_) => "image",
            TimelineItem::Audio(_) => "audio",
            TimelineItem::Text(_) => "text",
            TimelineItem::Shape(_) => "shape",
            TimelineItem::Sticker(_) => "sticker",
            TimelineItem::Visualizer(_) => "visualizer",
            TimelineItem::Progress(_) => "progress",
            TimelineItem::Draw(_) => "draw",
            TimelineItem::Placeholder(_) => "placeholder",
            TimelineItem::Confetti(_) => "confetti",
            TimelineItem::Whiteboard(_) => "whiteboard",
            TimelineItem::Composition(_) => "composition",
            TimelineItem::Caption(_) => "caption",
        }
    }

    /// 实例引用的素材版本。文字、图形、字幕、模板贴纸与多数生成类元素没有。
    pub fn asset_ref(&self) -> Option<&VersionRef> {
        match self {
            TimelineItem::Video(v) => Some(&v.asset_ref),
            TimelineItem::Image(i) => Some(&i.asset_ref),
            TimelineItem::Audio(a) => Some(&a.asset_ref),
            TimelineItem::Sticker(s) => s.asset_ref.as_ref(),
            TimelineItem::Placeholder(p) => p.asset_ref.as_ref(),
            TimelineItem::Whiteboard(w) => Some(&w.asset_ref),
            TimelineItem::Composition(CompositionItem {
                source: CompositionSource::Bundle { asset_ref },
                ..
            }) => Some(asset_ref),
            _ => None,
        }
    }

    /// 实例引用的全部素材版本：内容本身，加上合成的预渲染替身。
    pub fn asset_refs(&self) -> impl Iterator<Item = &VersionRef> {
        let prerender = match self {
            TimelineItem::Composition(c) => c.prerender.as_ref(),
            _ => None,
        };
        self.asset_ref().into_iter().chain(prerender)
    }

    /// 帧网格上的区间。音频实例在采样级定位，没有。
    pub fn span(&self) -> Option<FrameSpan> {
        match self {
            TimelineItem::Audio(_) => None,
            TimelineItem::Caption(c) => Some(c.span),
            other => visual_items!(other, item => Some(item.span), _ => None),
        }
    }

    pub fn span_mut(&mut self) -> Option<&mut FrameSpan> {
        match self {
            TimelineItem::Audio(_) => None,
            TimelineItem::Caption(c) => Some(&mut c.span),
            other => visual_items!(other, item => Some(&mut item.span), _ => None),
        }
    }

    /// 画面实例的几何。音频与字幕没有。
    pub fn place(&self) -> Option<&Place> {
        visual_items!(self, item => Some(&item.place), _ => None)
    }

    pub fn place_mut(&mut self) -> Option<&mut Place> {
        visual_items!(self, item => Some(&mut item.place), _ => None)
    }

    /// 元素动画的三槽。音频与字幕没有。
    pub fn animate(&self) -> Option<&Animation> {
        visual_items!(self, item => item.animate.as_ref(), _ => None)
    }

    /// 画面实例的 `animate` 字段本身（可写）。音频与字幕没有。
    pub fn animate_mut(&mut self) -> Option<&mut Option<Animation>> {
        visual_items!(self, item => Some(&mut item.animate), _ => None)
    }

    /// 视觉媒体的公共字段：视频、图片、占位框、白板与素材贴纸。贴纸不分来源都给出（字段本身只对素材贴纸适用，写入时校验）。
    pub fn media(&self) -> Option<&MediaFields> {
        match self {
            TimelineItem::Video(v) => Some(&v.media),
            TimelineItem::Image(i) => Some(&i.media),
            TimelineItem::Sticker(s) => Some(&s.media),
            TimelineItem::Placeholder(p) => Some(&p.media),
            TimelineItem::Whiteboard(w) => Some(&w.media),
            _ => None,
        }
    }

    pub fn media_mut(&mut self) -> Option<&mut MediaFields> {
        match self {
            TimelineItem::Video(v) => Some(&mut v.media),
            TimelineItem::Image(i) => Some(&mut i.media),
            TimelineItem::Sticker(s) => Some(&mut s.media),
            TimelineItem::Placeholder(p) => Some(&mut p.media),
            TimelineItem::Whiteboard(w) => Some(&mut w.media),
            _ => None,
        }
    }

    /// 是否视觉媒体（§3.4）：视频、图片、占位框、白板，以及素材贴纸。
    pub fn is_visual_media(&self) -> bool {
        match self {
            TimelineItem::Video(_) | TimelineItem::Image(_) | TimelineItem::Placeholder(_) | TimelineItem::Whiteboard(_) => true,
            TimelineItem::Sticker(s) => s.is_asset(),
            _ => false,
        }
    }

    /// 效果（§3.9）：视觉媒体与合成实例有。
    pub fn fx(&self) -> Option<&Fx> {
        match self {
            TimelineItem::Composition(c) => c.fx.as_ref(),
            other => other.media().and_then(|m| m.fx.as_ref()),
        }
    }

    /// `fx` 字段本身（可写）：视觉媒体（含贴纸）与合成实例有。
    pub fn fx_mut(&mut self) -> Option<&mut Option<Fx>> {
        match self {
            TimelineItem::Composition(c) => Some(&mut c.fx),
            other => other.media_mut().map(|m| &mut m.fx),
        }
    }

    /// 遮罩（§3.9）：视觉媒体与合成实例有。
    pub fn mask(&self) -> Option<&Mask> {
        match self {
            TimelineItem::Composition(c) => c.mask.as_ref(),
            other => other.media().and_then(|m| m.mask.as_ref()),
        }
    }

    /// `mask` 字段本身（可写）：视觉媒体（含贴纸）与合成实例有。
    pub fn mask_mut(&mut self) -> Option<&mut Option<Mask>> {
        match self {
            TimelineItem::Composition(c) => Some(&mut c.mask),
            other => other.media_mut().map(|m| &mut m.mask),
        }
    }

    /// 平铺（§3.5）：图片与文字有。
    pub fn tile_mut(&mut self) -> Option<&mut Option<Tile>> {
        match self {
            TimelineItem::Image(i) => Some(&mut i.tile),
            TimelineItem::Text(t) => Some(&mut t.tile),
            _ => None,
        }
    }

    /// 实例时间到源时间的映射。没有源时间的实例（图片、文字、图形、生成类元素、字幕）没有。
    pub fn time_map_mut(&mut self) -> Option<&mut TimeMap> {
        match self {
            TimelineItem::Video(v) => Some(&mut v.time_map),
            TimelineItem::Audio(a) => Some(&mut a.time_map),
            TimelineItem::Composition(c) => Some(&mut c.time_map),
            _ => None,
        }
    }

    /// 实例时间到源时间的映射（只读）。
    pub fn time_map(&self) -> Option<&TimeMap> {
        match self {
            TimelineItem::Video(v) => Some(&v.time_map),
            TimelineItem::Audio(a) => Some(&a.time_map),
            TimelineItem::Composition(c) => Some(&c.time_map),
            _ => None,
        }
    }

    pub fn track_kind(&self) -> TrackKind {
        match self {
            TimelineItem::Audio(_) => TrackKind::Audio,
            TimelineItem::Caption(_) => TrackKind::Subtitle,
            _ => TrackKind::Visual,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Video,
    Audio,
    Image,
    /// Lottie 动画（JSON），只由素材贴纸引用（§3.7）。
    Lottie,
    Font,
    Caption,
    Document,
    /// 代码包：一个目录（§4.3）。
    Bundle,
    Other,
}

/// 素材记录（§4.1）：身份与它的各个版本。版本一旦写入不再修改。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRecord {
    pub id: Id,
    pub kind: AssetKind,
    pub name: String,
    pub current_revision: Revision,
    pub revisions: BTreeMap<Revision, AssetRevision>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRevision {
    pub revision: Revision,
    pub content_hash: String,
    pub byte_length: u64,
    pub media_type: String,
    pub storage: AssetStorage,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<MediaTime>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timebase: Option<Rate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<VideoInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<AudioInfo>,
    /// 素材是一个目录时的文件清单概要。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tree: Option<TreeInfo>,
    /// 代码包的清单（代码包规范 §2）。引擎按对象保存。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle: Option<Value>,
    pub provenance: Provenance,
}

/// bytes 放在哪里（§4.2）。位置不属于版本的身份：收纳与重新链接不产生新版本。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum AssetStorage {
    /// 在视频目录的 `blobs/` 里，按内容寻址。
    Managed,
    /// 留在原处，视频只记下去哪里找。
    Linked { locator: FileLocator, frozen: bool },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLocator {
    /// 绝对路径，或相对视频目录的路径（文件在项目目录里时）。
    pub path: String,
    /// 链接时文件的修改时间，用来便宜地发现「文件可能变了」。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
    /// 所在卷的名字，文件找不到时用来提示「请接上某个盘」。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeInfo {
    pub file_count: u32,
    /// 只收目录里的这些文件或子目录（相对路径）。省略表示整个目录。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub display_width: u32,
    pub display_height: u32,
    pub rotation: u32,
    pub pixel_aspect_ratio: Rate,
    pub frame_rate: FrameRateInfo,
    pub pts_origin: MediaTime,
    pub has_alpha: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FrameRateInfo {
    Cfr {
        rate: Rate,
    },
    Vfr {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        nominal: Option<Rate>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInfo {
    pub sample_rate: u32,
    pub channels: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
}

/// 来源（§4.5）。本机路径只出现在 `storage.locator` 里，这里留原始文件名与出处。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    pub origin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_from: Option<ImportedFrom>,
    /// 已知的出处：来源网址、原平台的元数据、生成记录等。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFrom {
    pub original_name: String,
    pub imported_at: String,
}

/// 文档头（§4.4）：身份与各个版本的指纹。正文按版本保存在存储里，不随快照下发。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRecord {
    pub id: Id,
    /// 文档的种类：`speech`、`translation`、`caption`、`caption-style`……（开放词表，§5）。
    pub kind: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// 这份文档描述的素材（例如转写对应的录音）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_asset_id: Option<Id>,
    /// 这份文档派生自哪份文档（例如译文对应的转写）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_document_id: Option<Id>,
    pub current_revision: Revision,
    pub revisions: BTreeMap<Revision, DocumentRevision>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extensions: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRevision {
    pub revision: Revision,
    pub content_hash: String,
    pub byte_length: u64,
    pub created_at: String,
    /// 写入这个版本的事务。
    pub created_by: Id,
    /// 正文的概要（词数、句数等），让列表与智能体不必读正文。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub id: Id,
    pub name: String,
    pub video_revision: Revision,
    pub created_at: String,
    pub origin: CheckpointOrigin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointOrigin {
    pub by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<Id>,
}

/// 保护（§3.10）。0.4 只读取与校验；设置保护的操作随任务合同出现。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionRecord {
    pub id: Id,
    pub level: String,
    pub target: Value,
    pub origin: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// 操作者：由 Runtime 从已认证的连接构造，客户端不能声明（命令与协议规范 §2.2）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Actor {
    pub kind: ActorKind,
    pub id: Id,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActorKind {
    User,
    Agent,
    System,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 早先的版本没有写 `followPolicy` 的实例读作缺省的 `follow-cuts`；写了的照原样。
    #[test]
    fn a_missing_follow_policy_reads_as_follow_cuts() {
        let base = |extra: serde_json::Value| -> ItemBase {
            let mut value = serde_json::json!({ "id": "i", "trackId": "t", "enabled": true, "locked": false, "paintOrder": 1 });
            value.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            serde_json::from_value(value).unwrap()
        };
        assert_eq!(base(serde_json::json!({})).follow_policy, FollowPolicy::FollowCuts);
        assert_eq!(
            base(serde_json::json!({ "followPolicy": { "kind": "sequence-fixed" } })).follow_policy,
            FollowPolicy::SequenceFixed
        );
    }
}
