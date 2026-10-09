// —— 以下内容自 `core/crates/bcut-kernel/src/cmd/studio_export.rs` 原样搬迁（主方案 D2）——
// 来源行区间（合并 e64ed8fc 之后的行号）：:1-229（头部说明、导入、常量、
// 字幕核心类型）与 :407-2063（文档装载、样式解析、逐词动画、排版投影）。
// 中间的 :230-406 是导出专属类型（VideoExportStats / PatchFallback /
// VideoRenderMode / VideoExportTiming / fallback_envelope），留在 CLI。

// Subtitle Studio 与 timeline 元素的统一 overlay 视频导出。
//
// Studio 的 Canvas 预览和这里共用同一份 `studio/data.json` 样式语义：显示窗口、
// 双语字号、逐词状态与入场时长都按 `subtitle-rendering.js` 的纯函数规则计算。
// CLI 将结果编译为类型化逐帧计划，用 cosmic-text + tiny-skia 绘制透明叠加层，
// 并为每帧录制确定性的 DrawOp 指令流，再由当前平台的原生媒体后端解码、
// 合成并编码 H.264/AAC MP4。

use anyhow::{Context, Result, anyhow, bail};
use speech_doc::split::target_delivery_projection;
#[cfg(feature = "host")]
use render_raster::MediaStore;
#[cfg(feature = "host")]
use render_raster::assets::{LoadedAssets, VideoInfo, decode_image, probe_media};
use render_raster::drawop::{DrawOp, FrameBuilder, FrameOps};
use render_raster::{FrameMedia, GlyphAtlasRender, GlyphRender, TextEngine};
#[cfg(feature = "host")]
use timeline::schema::TimelineDocument;
use timeline::schema::{
    Animation, Background, ConfettiProps, CounterProps, DrawProps, Element, ElementKind,
    ElementRole, Fit, Fx, Main, Mask, Place, PlaceholderProps, ProgressProps, ShapeProps,
    StickerProps, Tile, VisualMode, VisualizerProps, WhiteboardProps,
};
use serde_json::{Value, json};
use std::collections::{HashMap, VecDeque};
#[cfg(feature = "host")]
use std::fs;
use std::ops::Range;
use std::path::Path;
#[cfg(feature = "host")]
use std::path::PathBuf;
use std::sync::Arc;
use tiny_skia::{
    Color, FillRule, FilterQuality, GradientStop, IntSize, LinearGradient, Mask as PixmapMask,
    Paint, PathBuilder, Pattern, Pixmap, PixmapPaint, PixmapRef, Point, SpreadMode, Stroke,
    Transform,
};
use unicode_segmentation::UnicodeSegmentation;

// 参考短边（540）的真相只有 `timeline::REFERENCE_SHORT_EDGE` 一处：
// 字幕排版的 canvas_scale 与元素效果 lowering 折算的是同一个基准，搬迁时
// 顺手把 studio_export 里那份同值副本并掉。glob 导出让 CLI 侧 `ass_style.rs`
// 继续按裸名引用。
pub use timeline::REFERENCE_SHORT_EDGE;
pub const DEFAULT_LEAD_IN: f64 = 0.5;
pub const DEFAULT_TAIL: f64 = 1.0;
/// 双语字号缺省比例的权威定义：烧录端 [`resolve_line_style`]、Web
/// `subtitle-rendering.js` `lineFontSize` 与 NLE 可编辑导出
/// `services::editable_export::line_style` 共用同一组常量，任何一端单独改数
/// 都会让三端字号分叉。
/// 参考字号：`root.fontSize` 的默认值，同时是底板留白 / 圆角 / 字距的归一化分母。
///
/// 原型 `designs/baocut/app/panel-substyle.jsx:82-86` 的 `padOf` / `radiusOf` 都是
/// **占字号的百分比**，所以这几样必须跟着**这一行自己的字号**缩放；此前它们乘的是
/// `canvas_scale`（只含画布短边与全局 `scale`），双语译文行的 `transScale` 在它上面
/// 是隐形的，于是译文行的底板与字距与原文行一样大。默认字号的行 `font_size /
/// REFERENCE_FONT_SIZE == canvas_scale`，输出逐像素不变。
pub const REFERENCE_FONT_SIZE: f64 = 30.0;
/// 底板留白的横竖比：原型 `padOf` 竖向 `pad·fz/100`、横向再乘 1.4——「左右比上下宽
/// 一点，字才不贴着板边」。此前核心是竖向 = 横向 × 0.45（块底 0.62），比原型扁一半。
pub const PLATE_PAD_ASPECT: f64 = 1.4;
/// 缺省双语：上行（译文）32、下行（原文）20，与语言无关；根字号 30 为基线。
pub const DEFAULT_BILINGUAL_ORIG_SCALE: f64 = 20.0 / 30.0;
pub const DEFAULT_TRANSLATION_RATIO: f64 = 32.0 / 20.0;

#[derive(Debug, Clone)]
pub struct Word {
    pub id: String,
    pub text: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone)]
pub struct TimedItem {
    pub id: String,
    pub series_index: u32,
    pub text: String,
    pub display_start: f64,
    pub display_end: f64,
    pub words: Vec<Word>,
}

#[derive(Debug, Clone, Copy)]
pub struct TimedInput<'a> {
    pub item: &'a Value,
    pub text_key: &'static str,
    pub language: &'a str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineKind {
    Original,
    Translation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StudioMode {
    Original,
    Translated,
    Bilingual,
}

impl StudioMode {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "orig" | "original" => Some(Self::Original),
            "trans" | "translated" => Some(Self::Translated),
            "bi" | "bilingual" => Some(Self::Bilingual),
            _ => None,
        }
    }

    /// 文档的显示模式一律由字幕轨集派生。`style.mode` 只是兼容投影，所有读点
    /// 都走这里，避免第二处判据。缺席时统一回落 `orig`。
    pub fn of_style(style: &Value) -> Self {
        mode_of(&resolve_track_set(style))
    }
}

/// 字幕轨的角色。一门语言 = 一条轨；本轮两行内核里每个 role 至多一条。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackRole {
    Source,
    Translation,
}

impl TrackRole {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "source" => Some(Self::Source),
            "translation" => Some(Self::Translation),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Source => "source",
            Self::Translation => "translation",
        }
    }

    pub fn line_kind(self) -> LineKind {
        match self {
            Self::Source => LineKind::Original,
            Self::Translation => LineKind::Translation,
        }
    }
}

/// 字幕样式的两个持久上下文（`voiceInkContexts.{sub,bi}`）。
///
/// wire 仍然使用既有的 `"sub"` / `"bi"`，枚举只负责让 App、CLI 与共享写路径
/// 不再靠散落的字符串猜当前在编辑哪一套样式。原来住在 `bcut-workspace` 的
/// `studio::style_sync`；写事务信封（`bcut-editor-core::edits::Mutation`）也要
/// 带它，而纯 crate 不许依赖写路径，所以落到轨集判据同住的这里。
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum StyleContext {
    #[serde(rename = "sub")]
    Subtitle,
    #[serde(rename = "bi")]
    Bilingual,
}

impl StyleContext {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Subtitle => "sub",
            Self::Bilingual => "bi",
        }
    }

    pub fn from_hint(value: &str) -> Option<Self> {
        match value {
            "sub" => Some(Self::Subtitle),
            "bi" => Some(Self::Bilingual),
            _ => None,
        }
    }

    /// 这份 style 的扁平层是哪个上下文拍平出来的——写路径 `selected_context`
    /// 无 `ctx` 提示时的判据。
    ///
    /// **判据刻意不是轨集裁决**（[`resolve_track_set`] 优先信
    /// `voiceInkContexts.bi.mode`）：`bi.mode` 是 `bi` 上下文自己的记录
    /// （「选中我时画双语还是纯译文」），恒等于 `bi`/`trans`，它回答不了「用户此刻
    /// 在哪个 tab」。Mac 在 Subtitle Tab 编辑时扁平层就是 `sub` 的投影、根 `mode`
    /// 就是 `orig`，拿 `bi.mode` 去选上下文会把单行样式写进双语 set 里。
    ///
    /// 1. 根 `mode` 可解析 → 它说了算；
    /// 2. 否则看 `tracks`（新模型客户端可以只写轨集）；
    /// 3. 两者都没有 → `Subtitle`，与 `render_plan` 的缺省 `orig` 同侧。
    pub fn of_style(style: &Value) -> Self {
        let mode = style
            .get("mode")
            .and_then(Value::as_str)
            .and_then(StudioMode::parse)
            .unwrap_or_else(|| mode_of(&parse_track_set(style)));
        match mode {
            StudioMode::Original => Self::Subtitle,
            _ => Self::Bilingual,
        }
    }
}

/// `studio/style.json` 根键 `tracks` 的一条：画面/timeline 上的一条字幕轨。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubtitleTrack {
    pub role: TrackRole,
    pub lang: Option<String>,
    /// 这条轨此刻在画面上被关掉了吗（D10，`tracks[].hidden`，缺省 `false`）。
    ///
    /// 与「拿下」（把轨从 `tracks` 里删掉）是两件事：`hidden` 保留声明，只是
    /// 不烧、不参与生效模式派生。轨集本身仍然是文档真相，所以根 `mode` 依旧按
    /// **声明**的轨集写（[`mode_of`] 不看 `hidden`）；只有渲染/导出侧走
    /// [`effective_track_set`] / [`effective_mode`]。
    pub hidden: bool,
}

impl SubtitleTrack {
    pub fn new(role: TrackRole, lang: Option<String>) -> Self {
        Self {
            role,
            lang,
            hidden: false,
        }
    }

    pub fn source(lang: Option<String>) -> Self {
        Self::new(TrackRole::Source, lang)
    }

    pub fn translation(lang: Option<String>) -> Self {
        Self::new(TrackRole::Translation, lang)
    }

    /// 链式设置 [`hidden`](Self::hidden)。
    pub fn with_hidden(mut self, hidden: bool) -> Self {
        self.hidden = hidden;
        self
    }

    /// 这条轨在协议 lane 键 `subs:<styleTrackId>` 里的 id。
    ///
    /// **唯一一处**构造字幕轨 id 的地方：轨集里同 role 至多一条
    /// （[`parse_track_set`] 去重），所以 role 串就是稳定 id。App 的展示泳道 id
    /// （`tr-subs` / `tr-subs-trans`）是另一套东西，不要混用。
    pub fn track_id(&self) -> &'static str {
        self.role.as_str()
    }
}

/// 轨集 → 兼容 `mode`。唯一一份派生规则。
pub fn mode_of(tracks: &[SubtitleTrack]) -> StudioMode {
    let has_source = tracks.iter().any(|t| t.role == TrackRole::Source);
    let has_translation = tracks.iter().any(|t| t.role == TrackRole::Translation);
    match (has_source, has_translation) {
        (true, true) => StudioMode::Bilingual,
        (false, true) => StudioMode::Translated,
        // 空轨集不该存在；真遇到就按最保守的 orig 兜底。
        _ => StudioMode::Original,
    }
}

/// `mode` → 轨集。重派生时尽量沿用同 role 旧条目的 `lang`。
pub fn track_set_of_mode(mode: StudioMode, previous: &[SubtitleTrack]) -> Vec<SubtitleTrack> {
    // `hidden` 与 `lang` 一样按 role 沿用：重派生只换轨集形状，不该顺手把用户
    // 关掉的轨重新点亮。
    let track_of = |role: TrackRole| {
        let previous = previous.iter().find(|t| t.role == role);
        SubtitleTrack::new(role, previous.and_then(|t| t.lang.clone()))
            .with_hidden(previous.is_some_and(|t| t.hidden))
    };
    match mode {
        StudioMode::Original => vec![track_of(TrackRole::Source)],
        StudioMode::Translated => vec![track_of(TrackRole::Translation)],
        StudioMode::Bilingual => vec![
            track_of(TrackRole::Source),
            track_of(TrackRole::Translation),
        ],
    }
}

/// 只读 `style.tracks`，不看 `mode`。非法条目丢弃，同 role 去重（保留首条）。
pub fn parse_track_set(style: &Value) -> Vec<SubtitleTrack> {
    let Some(items) = style.get("tracks").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut tracks: Vec<SubtitleTrack> = Vec::new();
    for item in items {
        let Some(role) = item
            .get("role")
            .and_then(Value::as_str)
            .and_then(TrackRole::parse)
        else {
            continue;
        };
        if tracks.iter().any(|t| t.role == role) {
            continue;
        }
        let lang = item
            .get("lang")
            .and_then(Value::as_str)
            .filter(|lang| !lang.trim().is_empty())
            .map(str::to_owned);
        let hidden = item.get("hidden").and_then(Value::as_bool).unwrap_or(false);
        tracks.push(SubtitleTrack::new(role, lang).with_hidden(hidden));
    }
    tracks
}

/// 原始 `tracks` 数组里被 [`parse_track_set`] 按 role 去重丢弃的重复条目的角色。
///
/// 契约要求「生效译文轨 >1 条时取文档顺序第一条并告警」。轨集模型同 role 至多
/// 一条，多出来的那条在解析时就被丢了，所以告警判据只能从原始数组上取。
pub fn duplicate_track_roles(style: &Value) -> Vec<TrackRole> {
    let Some(items) = style.get("tracks").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut seen: Vec<TrackRole> = Vec::new();
    let mut duplicates: Vec<TrackRole> = Vec::new();
    for item in items {
        let Some(role) = item
            .get("role")
            .and_then(Value::as_str)
            .and_then(TrackRole::parse)
        else {
            continue;
        };
        if seen.contains(&role) {
            if !duplicates.contains(&role) {
                duplicates.push(role);
            }
        } else {
            seen.push(role);
        }
    }
    duplicates
}

/// 兼容 `mode` 信号：`voiceInkContexts.bi.mode` 优先，其次扁平根 `mode`。
///
/// apps/mac 在 Subtitle Tab 改任何样式都会从被钉死单行的 `.sub` set 刷出一个
/// 根 `mode="orig"`，那不是用户意图；用户真正看到的模式记在 `bi` 上下文里。
/// 按根 `mode` 重派生会把译文轨静默拿掉，所以两个信号里 `bi.mode` 更可信。
pub fn mode_signal(style: &Value) -> Option<StudioMode> {
    style
        .pointer("/voiceInkContexts/bi/mode")
        .and_then(Value::as_str)
        .and_then(StudioMode::parse)
        .or_else(|| {
            style
                .get("mode")
                .and_then(Value::as_str)
                .and_then(StudioMode::parse)
        })
}

/// 读时迁移 + 兼容裁决：给出这份 style 当前画面上的字幕轨集。
///
/// 1. 读 `tracks`（非法丢弃、同 role 去重）；
/// 2. 读兼容 `mode` 信号（[`mode_signal`]：`voiceInkContexts.bi.mode` 优先，
///    其次根 `mode`）；
/// 3. tracks 合法非空且信号存在但与 `mode_of(tracks)` 不一致 → 以信号为准重派生。
///    新模型的写者两者永远一致，不一致只可能来自旧写者（apps/mac 无条件回写
///    `mode` 与 `bi.mode`），旧写者的值更新；
/// 4. tracks 缺失/为空 → 从信号派生；信号也缺失 → `[source]`。
///
/// 纯读函数：绝不写回磁盘。落盘由写路径的 canonicalize 负责，而 canonicalize 的
/// 输出满足 `mode == bi.mode == mode_of(tracks)`，因此读时迁移是幂等的。
pub fn resolve_track_set(style: &Value) -> Vec<SubtitleTrack> {
    let tracks = parse_track_set(style);
    let mode = mode_signal(style);
    match (tracks.is_empty(), mode) {
        (true, Some(mode)) => track_set_of_mode(mode, &tracks),
        (true, None) => vec![SubtitleTrack::source(None)],
        (false, Some(mode)) if mode != mode_of(&tracks) => track_set_of_mode(mode, &tracks),
        (false, _) => tracks,
    }
}

/// 生效轨集：[`resolve_track_set`] 之后去掉 `hidden` 的那几条（D10）。
///
/// 渲染、烧录、导出的字幕语言派生**只看这一份**；`style` 根上的 `mode` 与
/// [`mode_of`] 仍然描述**声明**的轨集（关掉一条轨不改变文档声明，「放回」才能
/// 拿回原样）。生效集可以为空 = 这次一条字幕都不烧。
pub fn effective_track_set(style: &Value) -> Vec<SubtitleTrack> {
    resolve_track_set(style)
        .into_iter()
        .filter(|track| !track.hidden)
        .collect()
}

/// 生效轨集 → 生效模式；生效集为空时 `None`（= 不烧字幕，等价 `--no-subs`）。
pub fn effective_mode(style: &Value) -> Option<StudioMode> {
    let tracks = effective_track_set(style);
    if tracks.is_empty() {
        return None;
    }
    Some(mode_of(&tracks))
}

/// 轨集 → `style.tracks` 的 JSON 形态。
pub fn tracks_json(tracks: &[SubtitleTrack]) -> Value {
    Value::Array(
        tracks
            .iter()
            .map(|track| {
                let mut entry = serde_json::Map::new();
                entry.insert("role".into(), Value::String(track.role.as_str().to_owned()));
                if let Some(lang) = &track.lang {
                    entry.insert("lang".into(), Value::String(lang.clone()));
                }
                // 缺省值不落盘：老文档与「没关过任何轨」的新文档字节一致。
                if track.hidden {
                    entry.insert("hidden".into(), Value::Bool(true));
                }
                Value::Object(entry)
            })
            .collect(),
    )
}

/// `mode` 的兼容写出串（与 [`StudioMode::parse`] 同源的短串）。
pub fn mode_token(mode: StudioMode) -> &'static str {
    match mode {
        StudioMode::Original => "orig",
        StudioMode::Translated => "trans",
        StudioMode::Bilingual => "bi",
    }
}

#[derive(Debug, Clone)]
pub struct LineStyle {
    pub shaped_italic: bool,
    pub text_motion: Option<Arc<motion::text_motion::CompiledTextMotion>>,
    pub word_background: Option<WordBackground>,
    pub font_name: String,
    pub font_size: f64,
    /// Shaping weight. `bold` remains the compatibility projection used by ASS.
    pub font_weight: u16,
    pub color: SubtitleColor,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub letter_spacing: f64,
    pub outline_on: bool,
    pub outline_color: SubtitleColor,
    pub outline_width: f64,
    pub effect_on: bool,
    pub effect_color: SubtitleColor,
    pub effect_x: f64,
    pub effect_y: f64,
    pub effect_blur: f64,
    pub background_on: bool,
    pub background_color: SubtitleColor,
    /// 横向内边距 `backgroundPadding × (font_size / REFERENCE_FONT_SIZE) × 0.8`
    /// （同时用作底板圆角的缺省值）。
    pub background_pad_h: f64,
    /// 纵向内边距 `pad_h / PLATE_PAD_ASPECT`，与原型 `panel-substyle.jsx` 的
    /// `padOf` 同口径（竖 `pad·fz/100`、横再乘 1.4）。
    ///
    /// 与 `background_on` 无关：底板关掉的行照样按这个数撑开自己的槽位。
    pub background_pad_v: f64,
    /// Rounded-corner radius in output pixels. Missing `borderRadius` deliberately
    /// falls back to the legacy `background_pad_h` value for byte compatibility.
    pub background_radius: f64,
    /// `backgroundStyle == "block"`: one plate for the whole wrapped line and a
    /// 28%-of-frame minimum width. Missing or explicit `wrap` paints one plate per
    /// visual line.
    pub block_background: bool,
    /// 整块底板的最小宽（输出像素）。字幕轨由 `resolve_line_style` 定为 28% 画幅；
    /// 文字元素在 `render_plan::text_element_block_plate` 里改成元素盒宽
    /// （`place.w`，没给则 0 = 包住最宽一行）。
    pub background_min_width: f64,
    pub line_height: f64,
    pub text_transform: String,
    /// 普通（非配方）字幕的强调词外观：样式根的 `emphasisLook` 作用在
    /// `captionEmphasis` 里 role 为 emphasis / hero 的词上。设计字幕（配方）
    /// 有自己的强调通道，此处恒为 `None`；没有 `emphasisLook` 时也为 `None`，
    /// 排版与像素与旧行为逐位一致。
    pub emphasis: Option<Arc<EmphasisLook>>,
}

/// `emphasisLook` 的取值范围（缩放绕词的基线中心，夹在这一区间）。
pub const EMPHASIS_LOOK_SCALE_RANGE: (f64, f64) = (0.8, 1.6);
/// hero 词在 `emphasisLook.scale` 之上再放大的倍数（结果仍夹进上面的区间）。
pub const EMPHASIS_LOOK_HERO_FACTOR: f64 = 1.15;

/// 一个被强调的词：`captionEmphasis[<wordId>]`。
#[derive(Debug, Clone, PartialEq)]
pub struct EmphasisWord {
    pub hero: bool,
    /// 逐词颜色，优先于 [`EmphasisLook::color`]。
    pub color: Option<SubtitleColor>,
}

/// 普通字幕强调词的外观（样式根 `emphasisLook`）。
#[derive(Debug, Clone, PartialEq)]
pub struct EmphasisLook {
    pub color: Option<SubtitleColor>,
    /// 已映射成实际 shaping 字族（与 [`font_name`] 同口径）。
    pub font_name: Option<String>,
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    /// 已夹进 [`EMPHASIS_LOOK_SCALE_RANGE`]。
    pub scale: f64,
    pub words: HashMap<String, EmphasisWord>,
}

/// 一个强调词实际用的字形参数。
#[derive(Debug, Clone, PartialEq)]
pub struct EmphasisVariant<'a> {
    pub color: Option<SubtitleColor>,
    pub font_name: Option<&'a str>,
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub scale: f64,
}

impl EmphasisLook {
    /// 词 `id` 的强调外观；不在 `captionEmphasis` 里返回 `None`。
    pub fn variant(&self, id: &str) -> Option<EmphasisVariant<'_>> {
        let word = self.words.get(id)?;
        let (low, high) = EMPHASIS_LOOK_SCALE_RANGE;
        Some(EmphasisVariant {
            color: word.color.or(self.color),
            font_name: self.font_name.as_deref(),
            bold: self.bold,
            italic: self.italic,
            scale: if word.hero {
                (self.scale * EMPHASIS_LOOK_HERO_FACTOR).clamp(low, high)
            } else {
                self.scale
            },
        })
    }
}

/// `captionEmphasis` 里 role 为 emphasis / hero 的词：`(词 ID, role, 逐词颜色, 原条目)`。
/// 设计字幕配方与普通字幕的 `emphasisLook` 共用这一份判据。
pub fn caption_emphasis_words(
    style: &Value,
) -> impl Iterator<Item = (&String, &str, Option<SubtitleColor>, &Value)> {
    style
        .get("captionEmphasis")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(id, value)| {
            let role = value
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("normal");
            matches!(role, "emphasis" | "hero").then(|| {
                (
                    id,
                    role,
                    value
                        .get("color")
                        .and_then(Value::as_str)
                        .and_then(parse_css_color),
                    value,
                )
            })
        })
}

/// 从（合并后的）行样式解出 [`EmphasisLook`]。没有 `emphasisLook`、没有强调词、
/// 或这一行走设计字幕配方时返回 `None`。
pub fn emphasis_look(style: &Value) -> Option<Arc<EmphasisLook>> {
    let look = style.get("emphasisLook")?.as_object()?;
    let animation = style
        .get("wordAnimation")
        .or_else(|| style.get("anim"))
        .unwrap_or(&Value::Null);
    if designed_caption(style, animation).is_some() {
        return None;
    }
    let words = caption_emphasis_words(style)
        .map(|(id, role, color, _)| {
            (
                id.clone(),
                EmphasisWord {
                    hero: role == "hero",
                    color,
                },
            )
        })
        .collect::<HashMap<_, _>>();
    if words.is_empty() {
        return None;
    }
    let (low, high) = EMPHASIS_LOOK_SCALE_RANGE;
    Some(Arc::new(EmphasisLook {
        color: look
            .get("color")
            .and_then(Value::as_str)
            .and_then(parse_css_color),
        font_name: look
            .get("fontFamily")
            .and_then(Value::as_str)
            .filter(|family| !family.trim().is_empty())
            .map(|family| font_name(&serde_json::json!({ "fontFamily": family }))),
        bold: look.get("bold").and_then(Value::as_bool),
        italic: look.get("italic").and_then(Value::as_bool),
        scale: finite(look.get("scale"), 1.0).clamp(low, high),
        words,
    }))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SubtitleColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl SubtitleColor {
    const WHITE: Self = Self {
        r: 255,
        g: 255,
        b: 255,
        a: 0,
    };
    const BLACK: Self = Self {
        r: 0,
        g: 0,
        b: 0,
        a: 0,
    };

    pub fn parse(value: Option<&Value>, fallback: Self) -> Self {
        value
            .and_then(Value::as_str)
            .and_then(parse_css_color)
            .unwrap_or(fallback)
    }

    pub fn with_opacity(mut self, opacity: f64) -> Self {
        self.a = (255.0 * (1.0 - clamp(opacity, 0.0, 1.0))).round() as u8;
        self
    }

    pub fn mix(self, other: Self, amount: f64) -> Self {
        let amount = amount.clamp(0.0, 1.0);
        let channel = |left: u8, right: u8| {
            (f64::from(left) + (f64::from(right) - f64::from(left)) * amount).round() as u8
        };
        Self {
            r: channel(self.r, other.r),
            g: channel(self.g, other.g),
            b: channel(self.b, other.b),
            a: channel(self.a, other.a),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct WordVisual {
    pub color: Option<SubtitleColor>,
    pub opacity: Option<f64>,
    pub background: Option<SubtitleColor>,
    pub border_radius_em: Option<f64>,
    pub underline: Option<bool>,
    pub underline_offset_em: Option<f64>,
    pub bottom_em: Option<f64>,
    pub shadow_off: bool,
    /// 经典逐词高亮块这一帧的缩放倍数（`None` = 恒定 1.0 的旧行为）。块以矩形
    /// **中心**缩放，圆角同倍跟随；文字不受影响。
    pub box_scale: Option<f64>,
    /// 经典逐词高亮块这一帧的 alpha（`None` = 沿用词自身的 opacity）。**块与
    /// 文字分开动画**：块 alpha 一旦借用词 opacity 就会把字一起淡掉。
    pub box_opacity: Option<f64>,
    pub recipe: Option<CaptionRecipeResolvedWord>,
}

/// 逐词高亮块的时间轴（原型 `designs/baocut/app/model-subanim.js` 的
/// `boxHighlightV2` 轨，`group: "word"`）：**一个词的窗口就是一个周期**，块的
/// scale 与 alpha 各走一条关键帧曲线，只画在当前词上。
///
/// 这一层不进 `spoken`/`unspoken` 的三档合并——曲线只对 `active` 有意义，
/// 摊进 [`WordVisual`] 会让 [`merge_visual`] 需要为「覆盖一条曲线」定义语义，
/// 而文档里从来没有第二条曲线可覆盖。
#[derive(Debug, Clone, PartialEq)]
pub struct WordBoxTrack {
    /// `(相位, 倍数)`，相位升序。
    pub scale: Vec<(f64, f64)>,
    /// `(相位, alpha)`，相位升序。
    pub opacity: Vec<(f64, f64)>,
    /// 每段的缓动控制点（`cubic-bezier(x1, y1, x2, y2)`）。
    pub easing: [f64; 4],
}

impl WordBoxTrack {
    pub fn scale_at(&self, phase: f64) -> Option<f64> {
        sample_keyframes(&self.scale, self.easing, phase)
    }

    pub fn opacity_at(&self, phase: f64) -> Option<f64> {
        sample_keyframes(&self.opacity, self.easing, phase)
    }

    /// 曲线是否真的随时间变化。恒定轨（比如 `stack` 的 .92）不该把整条字幕
    /// 拖进逐帧缓存键。
    pub fn is_animated(&self) -> bool {
        let varies = |frames: &[(f64, f64)]| {
            frames
                .first()
                .is_some_and(|(_, first)| frames.iter().any(|(_, value)| value != first))
        };
        varies(&self.scale) || varies(&self.opacity)
    }
}

/// `sinInOut` 的控制点（原型 `EASING` 表：`cubic-bezier(0.37, 0, 0.63, 1)`）。
pub const WORD_BOX_EASING_SIN_IN_OUT: [f64; 4] = [0.37, 0.0, 0.63, 1.0];

/// 缓动名 → `cubic-bezier` 控制点。表与原型
/// `designs/baocut/app/model-subanim.js` 的 `EASING` 同源；`square*` 是阶跃，
/// 块轨用不到，未知名一律落回 `sinInOut`。
pub fn word_box_easing(name: &str) -> [f64; 4] {
    match name {
        "linear" => [0.0, 0.0, 1.0, 1.0],
        "sinIn" => [0.12, 0.0, 0.39, 0.0],
        "sinOut" | "sinout" => [0.61, 1.0, 0.88, 1.0],
        "expoOut" => [0.16, 1.0, 0.3, 1.0],
        "cubicOut" => [0.33, 1.0, 0.68, 1.0],
        "quadOut" => [0.5, 1.0, 0.89, 1.0],
        _ => WORD_BOX_EASING_SIN_IN_OUT,
    }
}

/// `cubic-bezier(x1, y1, x2, y2)` 在 `t` 处的 y。
///
/// 控制点被 CSS 钳在 x∈[0,1]，此时 x(u) 单调，解唯一——二分 32 步的误差已经
/// 小于 f64 在这一带的有效位，且**不依赖初值**，跨平台逐位一致（渲染确定性
/// 红线：牛顿迭代的收敛路径会随 FMA 结果漂）。
pub fn cubic_bezier_ease(curve: [f64; 4], t: f64) -> f64 {
    let [x1, y1, x2, y2] = curve;
    let t = t.clamp(0.0, 1.0);
    let axis = |a: f64, b: f64, u: f64| {
        let v = 1.0 - u;
        3.0 * v * v * u * a + 3.0 * v * u * u * b + u * u * u
    };
    if (x1 - y1).abs() < 1e-12 && (x2 - y2).abs() < 1e-12 {
        return t;
    }
    let (mut low, mut high) = (0.0_f64, 1.0_f64);
    for _ in 0..32 {
        let mid = f64::midpoint(low, high);
        if axis(x1, x2, mid) < t {
            low = mid;
        } else {
            high = mid;
        }
    }
    axis(y1, y2, f64::midpoint(low, high))
}

/// 关键帧线性插值 ＋ 段内缓动。相位钳在 `[0, 1]`，首帧之前取首值、末帧之后取
/// 末值。
pub fn sample_keyframes(frames: &[(f64, f64)], easing: [f64; 4], phase: f64) -> Option<f64> {
    let first = frames.first()?;
    let phase = phase.clamp(0.0, 1.0);
    if phase <= first.0 {
        return Some(first.1);
    }
    for pair in frames.windows(2) {
        let (start, from) = pair[0];
        let (end, to) = pair[1];
        if phase <= end {
            let span = end - start;
            if span <= 0.0 {
                return Some(to);
            }
            let eased = cubic_bezier_ease(easing, (phase - start) / span);
            return Some(from + (to - from) * eased);
        }
    }
    frames.last().map(|(_, value)| *value)
}

/// `active` 载荷里的 `boxScale` / `boxOpacity` / `boxEasing`。三个键都缺席时返回
/// `None`，此时块回到常量矩形——旧文档与其余 preset 的行为一字不变。
pub fn word_box_track(active: &Value) -> Option<WordBoxTrack> {
    fn keyframes(value: &Value) -> Option<Vec<(f64, f64)>> {
        let array = value.as_array()?;
        let mut frames = Vec::with_capacity(array.len());
        for entry in array {
            let pair = entry.as_array()?;
            let time = pair.first()?.as_f64()?;
            let value = pair.get(1)?.as_f64()?;
            if !time.is_finite() || !value.is_finite() {
                return None;
            }
            frames.push((time.clamp(0.0, 1.0), value));
        }
        (!frames.is_empty()).then_some(frames)
    }
    let scale = active.get("boxScale").and_then(keyframes);
    let opacity = active.get("boxOpacity").and_then(keyframes);
    if scale.is_none() && opacity.is_none() {
        return None;
    }
    Some(WordBoxTrack {
        scale: scale.unwrap_or_default(),
        opacity: opacity.unwrap_or_default(),
        easing: word_box_easing(
            active
                .get("boxEasing")
                .and_then(Value::as_str)
                .unwrap_or("sinInOut"),
        ),
    })
}

/// 词 `index` 的窗口在 `time` 处的相位（0–1）。零长或越界返回 0。
pub fn word_phase(item: &TimedItem, index: usize, time: f64) -> f64 {
    let Some(word) = item.words.get(index) else {
        return 0.0;
    };
    let span = word.end - word.start;
    if !span.is_finite() || span <= 0.0 {
        return 0.0;
    }
    ((time - word.start) / span).clamp(0.0, 1.0)
}

/// 经典逐词高亮块的默认圆角（`em`）：`active.borderRadiusEm` 缺席时的口径。
///
/// 舞台/导出与面板小样读**同一个数**——面板那一侧自己写个 0.25，改一次内核
/// 默认值就只有一半界面跟上。
pub const CLASSIC_WORD_BOX_RADIUS_EM: f64 = 0.25;

/// 经典逐词高亮块的矩形。CPU `draw_line_layout` 与 GPU `subtitle_scene_frame`
/// **共用这一份口径**：两处各写一遍就是两种几何意见，对拍必然分叉。
///
/// 几何与 Studio `canvas-stage.jsx` 的 highlight Rect 逐字段同源（0.14em 左右
/// 外扩、0.04em 上外扩、1.08em 高、`borderRadiusEm` 默认 0.25），再按
/// [`WordVisual::box_scale`] 绕矩形中心整体缩放（圆角同倍，药丸才不会在胀缩
/// 途中变成方角）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClassicWordBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub radius: f64,
}

pub fn classic_word_box(
    font_size: f64,
    cursor: f64,
    chunk_width: f64,
    line_top: f64,
    line_height: f64,
    part_dx: f64,
    part_dy: f64,
    bounce: f64,
    visual: &WordVisual,
) -> ClassicWordBox {
    let text_top = line_top + (line_height - font_size) / 2.0;
    let x = cursor - font_size * 0.14 + part_dx;
    let y = text_top - font_size * 0.04 - bounce + part_dy;
    let width = chunk_width + font_size * 0.28;
    let height = font_size * 1.08;
    let radius_em = visual
        .border_radius_em
        .unwrap_or(CLASSIC_WORD_BOX_RADIUS_EM);
    let radius = font_size * radius_em;
    let scale = visual.box_scale.unwrap_or(1.0).max(0.0);
    let (scaled_width, scaled_height) = (width * scale, height * scale);
    ClassicWordBox {
        x: x + (width - scaled_width) / 2.0,
        y: y + (height - scaled_height) / 2.0,
        width: scaled_width,
        height: scaled_height,
        radius: radius * scale,
    }
}

/// 块自己的 alpha 系数。有 `boxOpacity` 轨时块与文字分开——**不再**把块 alpha
/// 等同于词 opacity；没有轨时逐位回到旧行为。
pub fn classic_word_box_alpha(visual: &WordVisual) -> f64 {
    clamp(
        visual
            .box_opacity
            .unwrap_or_else(|| visual.opacity.unwrap_or(1.0)),
        0.0,
        1.0,
    )
}

#[derive(Debug, Clone)]
pub struct WordAnimation {
    pub name: String,
    /// An explicit catalogue selection opts into continuous motion. Old custom
    /// payloads retain their three-state interpretation.
    pub motion_id: Option<String>,
    pub spoken: WordVisual,
    pub active: WordVisual,
    pub unspoken: WordVisual,
    /// 当前词高亮块的时间轴（[`word_box_track`]），只有「药丸高亮」这一档写。
    pub box_track: Option<WordBoxTrack>,
    pub caption: Option<DesignedCaption>,
}

#[derive(Debug, Clone)]
pub struct DesignedCaption {
    pub style_id: String,
    pub style_version: u32,
    pub content: String,
    pub primary: SubtitleColor,
    pub accent: SubtitleColor,
    /// 第三色（倒鸭子的主角词）；没写时跟 `accent`。
    pub secondary: SubtitleColor,
    pub intensity: f64,
    pub speed: f64,
    pub seed: Option<u64>,
    pub options: Vec<Value>,
    pub overrides: HashMap<String, CaptionWordOverride>,
    /// 阶段 C 的编辑意图（样式根键 `captionSequences`，§5.4）。
    pub sequences: CaptionSequenceIntent,
}

/// 用户对「动态排版」做过的手动编辑：断段、按段换版、固定住的行。单位是 540 短边参考
/// 画布（`REFERENCE_SHORT_EDGE`）的像素，输出画布按 `min(w, h) / 540` 换算。
///
/// JSON 形状：
/// ```json
/// "captionSequences": {
///   "schema": 1,
///   "sequenceBreakBefore": ["w-120"],
///   "seeds": { "w-000": 3 },
///   "pins": { "w-052": { "center": [12.5, -40], "rotationDeg": 90 } }
/// }
/// ```
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CaptionSequenceIntent {
    /// 在这些 cue（按 cue 首词 id）前另起一段。
    pub break_before: Vec<String>,
    /// 段键（段首词 id）→ 版号。
    pub seeds: HashMap<String, u64>,
    /// 行键（行首词 id）→ 固定位置。
    pub pins: HashMap<String, CaptionSequencePin>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CaptionSequencePin {
    /// 段局部世界坐标，540 短边单位。
    pub center: [f64; 2],
    pub rot_deg: f64,
}

/// 样式根键 `captionSequences` 的名字。
pub const CAPTION_SEQUENCES_KEY: &str = "captionSequences";

impl CaptionSequenceIntent {
    pub fn from_style(style: &Value) -> Self {
        let Some(root) = style.get(CAPTION_SEQUENCES_KEY).and_then(Value::as_object) else {
            return Self::default();
        };
        let break_before = root
            .get("sequenceBreakBefore")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        let seeds = root
            .get("seeds")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter_map(|(key, value)| {
                let n = value.as_u64().or_else(|| {
                    value
                        .as_f64()
                        .filter(|v| v.is_finite() && *v >= 0.0)
                        .map(|v| v as u64)
                })?;
                Some((key.clone(), n))
            })
            .collect();
        let pins = root
            .get("pins")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter_map(|(key, value)| {
                let center = value.get("center")?.as_array()?;
                let x = center.first()?.as_f64().filter(|v| v.is_finite())?;
                let y = center.get(1)?.as_f64().filter(|v| v.is_finite())?;
                let rot_deg = finite(value.get("rotationDeg"), 0.0);
                Some((
                    key.clone(),
                    CaptionSequencePin {
                        center: [x, y],
                        rot_deg,
                    },
                ))
            })
            .collect();
        Self {
            break_before,
            seeds,
            pins,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.break_before.is_empty() && self.seeds.is_empty() && self.pins.is_empty()
    }
}

impl DesignedCaption {
    pub fn number_option(&self, key: &str) -> Option<f64> {
        self.options.iter().find_map(|option| {
            (option.get("kind").and_then(Value::as_str) == Some("number")
                && option.get("key").and_then(Value::as_str) == Some(key))
            .then(|| option.get("number").and_then(Value::as_f64))
            .flatten()
        })
    }

    pub fn text_option(&self, key: &str) -> Option<&str> {
        self.options.iter().find_map(|option| {
            (option.get("kind").and_then(Value::as_str) == Some("text")
                && option.get("key").and_then(Value::as_str) == Some(key))
            .then(|| option.get("text").and_then(Value::as_str))
            .flatten()
        })
    }
}

#[derive(Debug, Clone)]
pub struct CaptionWordOverride {
    pub role: String,
    pub color: Option<SubtitleColor>,
    pub emoji: Option<String>,
}

pub fn finite(value: Option<&Value>, fallback: f64) -> f64 {
    value
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite())
        .unwrap_or(fallback)
}

pub fn clamp(value: f64, low: f64, high: f64) -> f64 {
    value.max(low).min(high)
}

pub fn parse_css_color(raw: &str) -> Option<SubtitleColor> {
    let input = raw.trim();
    if input.eq_ignore_ascii_case("transparent") {
        return Some(SubtitleColor {
            a: 255,
            ..SubtitleColor::BLACK
        });
    }
    if let Some(hex) = input.strip_prefix('#') {
        let expanded = match hex.len() {
            3 | 4 => hex.chars().flat_map(|c| [c, c]).collect::<String>(),
            6 | 8 => hex.to_owned(),
            _ => return None,
        };
        let r = u8::from_str_radix(&expanded[0..2], 16).ok()?;
        let g = u8::from_str_radix(&expanded[2..4], 16).ok()?;
        let b = u8::from_str_radix(&expanded[4..6], 16).ok()?;
        let alpha = if expanded.len() == 8 {
            u8::from_str_radix(&expanded[6..8], 16).ok()?
        } else {
            255
        };
        return Some(SubtitleColor {
            r,
            g,
            b,
            a: 255 - alpha,
        });
    }
    let open = input.find('(')?;
    let close = input.rfind(')')?;
    let name = input[..open].trim().to_ascii_lowercase();
    if name != "rgb" && name != "rgba" {
        return None;
    }
    let parts: Vec<f64> = input[open + 1..close]
        .split(',')
        .map(str::trim)
        .map(str::parse)
        .collect::<std::result::Result<_, _>>()
        .ok()?;
    if parts.len() < 3 {
        return None;
    }
    let alpha = parts.get(3).copied().unwrap_or(1.0);
    Some(SubtitleColor {
        r: clamp(parts[0], 0.0, 255.0).round() as u8,
        g: clamp(parts[1], 0.0, 255.0).round() as u8,
        b: clamp(parts[2], 0.0, 255.0).round() as u8,
        a: (255.0 * (1.0 - clamp(alpha, 0.0, 1.0))).round() as u8,
    })
}

#[cfg(feature = "host")]
pub fn project_media(project: &Path) -> Result<PathBuf> {
    let manifest_path = project.join("project.json");
    let manifest: Value = serde_json::from_slice(
        &fs::read(&manifest_path)
            .with_context(|| format!("项目缺少 {}", manifest_path.display()))?,
    )
    .with_context(|| format!("解析 {}", manifest_path.display()))?;
    let raw = manifest
        .pointer("/media/path")
        .and_then(Value::as_str)
        .filter(|path| !path.is_empty())
        .context("project.json 缺少 media.path")?;
    let path = PathBuf::from(raw);
    let path = if path.is_absolute() {
        path
    } else {
        project.join(path)
    };
    if !path.is_file() {
        bail!("项目媒体不存在：{}", path.display());
    }
    Ok(path)
}

/// 读取 Studio 正文并按页面相同顺序叠加尚未 apply 的编辑，使 CLI 导出与当前预览一致。
#[cfg(feature = "host")]
pub fn load_preview_document(project: &Path) -> Result<Value> {
    if let Some(data) = crate::host::live_document(project)? {
        return apply_pending_edits(project, data);
    }
    let data_path = project.join("studio/data.json");
    let data: Value = serde_json::from_slice(&fs::read(&data_path).with_context(|| {
        format!(
            "项目缺少 {}；先运行 `bcut studio sync`",
            data_path.display()
        )
    })?)
    .with_context(|| format!("解析 {}", data_path.display()))?;
    apply_pending_edits(project, data)
}

/// 按导出请求的译文语言读取 Studio 正文。
///
/// 投影只承载一种目标语言，而 Mac 端刷新投影时从不指定语言，所以项目里除当前
/// 目标语言外的译文本来一律导不出来。语言不一致时这里在内存里按 `lang` 重投影：
/// 保留 `rev`，页面尚未提交的 edits.json 覆盖层照常生效。
#[cfg(feature = "host")]
pub fn load_preview_document_for_lang(project: &Path, lang: Option<&str>) -> Result<Value> {
    let document = load_preview_document(project)?;
    let Some(lang) = lang else {
        return Ok(document);
    };
    if document
        .pointer("/meta/targetLang/code")
        .and_then(Value::as_str)
        == Some(lang)
    {
        return Ok(document);
    }
    match crate::host::reproject_language(project, lang)? {
        Some(data) => apply_pending_edits(project, data),
        None => Ok(document),
    }
}

/// 正文的**进程内**内容指纹：序列化字节流直接喂哈希器，不先拼一整份字符串
/// （七小时项目的正文序列化后是几十 MB，那份中间 `String` 纯属浪费）。
///
/// 只供同进程比较「这份正文和上一份是否一字不差」，不落盘、不跨进程；
/// `DefaultHasher` 跨版本不稳定无所谓。
pub fn document_fingerprint(document: &Value) -> u64 {
    use std::hash::Hasher;
    struct HashSink(std::collections::hash_map::DefaultHasher);
    impl std::io::Write for HashSink {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.write(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut sink = HashSink(std::collections::hash_map::DefaultHasher::new());
    // `Value` 序列化不会失败；万一失败，写进去的前缀仍是确定性的。
    let _ = serde_json::to_writer(&mut sink, document);
    sink.0.finish()
}

#[cfg(feature = "host")]
pub fn apply_pending_edits(project: &Path, mut data: Value) -> Result<Value> {
    let edits_path = project.join("studio/edits.json");
    let overlay: Value = match fs::read(&edits_path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .with_context(|| format!("解析 {}", edits_path.display()))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(data),
        Err(error) => return Err(error).with_context(|| format!("读取 {}", edits_path.display())),
    };
    apply_preview_overlays(&mut data, &overlay);
    Ok(data)
}

/// 从内核共享缓存借来的正文 → 可改写的预览正文：独占时直接拆出，否则深拷
/// 一次，再叠 `studio/edits.json`。
///
/// 深拷与 edits 覆盖放在同一处：调用方只在需要可写副本时才付一次拷贝的价
/// （`Arc` 已独占时零拷贝），不再各自复制一遍正文。`Value::clone` 本身是
/// serde_json 内编译的派生实现，放在哪个 crate 调用对速度没有实测差别。
#[cfg(feature = "host")]
pub fn preview_document_from_shared(
    project: &Path,
    shared: std::sync::Arc<Value>,
) -> Result<Value> {
    let document =
        std::sync::Arc::try_unwrap(shared).unwrap_or_else(|shared| Value::clone(&shared));
    apply_pending_edits(project, document)
}

/// 读取 `bcut export --to mp4 --sub-style` 指定的导出期字幕样式。
///
/// 文件与 `studio/style.json` 同构：一份扁平样式 blob，可带 `origStyle` /
/// `transStyle` 行级局部覆盖。读取失败、JSON 无效或顶层不是对象都直接报错，
/// 绝不静默退回项目样式——静默退回会让用户拿到一份看起来正常、样式却不对的产物。
#[cfg(feature = "host")]
pub fn load_subtitle_style_override(path: &Path) -> Result<Value> {
    let bytes = fs::read(path)
        .with_context(|| format!("读取 --sub-style 字幕样式文件 {}", path.display()))?;
    let style: Value = serde_json::from_slice(&bytes)
        .with_context(|| format!("解析 --sub-style 字幕样式文件 {}", path.display()))?;
    if !style.is_object() {
        bail!(
            "--sub-style 字幕样式文件 {} 顶层必须是 JSON 对象（与 studio/style.json 同构）",
            path.display()
        );
    }
    Ok(style)
}

/// 把导出期样式整体写进内存中的 Studio 正文。
///
/// 这里是**替换**而不是合并：预设导出的语义是「这次就照这份样式渲染」，所以
/// 项目 `studio/style.json` 与 `studio/edits.json` 的 `style` 覆盖层一并作废。
/// [`load_preview_document`] 已经把 edits 覆盖层并进 `document["style"]`，因此
/// 在其之后整体赋值即可同时满足两条语义。文档不落盘，项目状态不受影响。
pub fn apply_subtitle_style_override(document: &mut Value, style: Value) {
    document["style"] = style;
}

#[cfg(feature = "host")]
pub fn load_overlay_document(project: &Path) -> Result<Value> {
    let document = load_preview_document(project)?;
    overlay_document_with_live_timeline(project, &document)
}

/// 把 Studio 正文的整条 cue 流换成一段一次性小样（方案 §5.4 S16）。
///
/// 样式面板的 Designed Caption 配方小样需要「按这份样式跑一段 demo 词」，而
/// 项目 transcript 与它无关：Mac `StylePreviewViews.update` 就是现造一条
/// `Cue(id:"pv")` + `pv0..pvN` 逐词 1 秒交给本地 Presentation 内核。字幕像素
/// 只走 serve（方案 D4），于是同一份构造搬到这里。
///
/// 四件事：① `cues` 换成唯一一条 `pv`（词 id 定死 `pv0..pvN-1`，`sampleEmphasis`
/// 就按这套 id 挂）；② `sentences` / `transCues` / `sourceDocs` 清空——小样没有
/// 译文轴；③ 丢掉 `timeline` 并盖上 `_overlayTimelineFingerprint`，让
/// [`overlay_document_with_live_timeline`] 短路、`load_timeline_elements` 拿到
/// 空轨道：样式小样只画字幕，不画项目的 B-roll/水印/文字元素；④ `captionEmphasis`
/// **整体替换**（项目那份挂在真实词 id 上，对小样毫无意义）。
///
/// 返回小样自身时间轴的终点秒数——调用方据此定这份渲染计划的时长。
pub fn apply_overlay_sample(
    document: &mut Value,
    words: &[(&str, f64, f64)],
    emphasis: &serde_json::Map<String, Value>,
) -> f64 {
    let rows: Vec<Value> = words
        .iter()
        .enumerate()
        .map(|(index, (text, start, end))| {
            json!({"id": format!("pv{index}"), "text": text, "t0": start, "t1": end})
        })
        .collect();
    let start = words.first().map(|word| word.1).unwrap_or(0.0);
    let end = words.last().map(|word| word.2).unwrap_or(0.0);
    let text = speech_doc::atomize::join_word_texts(words.iter().map(|word| word.0));
    document["cues"] = json!([{
        "id": "pv", "start": start, "end": end, "sp": "s1", "text": text, "words": rows,
    }]);
    document["sentences"] = json!([]);
    document["transCues"] = json!([]);
    if let Some(root) = document.as_object_mut() {
        root.remove("sourceDocs");
        root.remove("timeline");
    }
    document["_overlayTimelineFingerprint"] = json!("sample");
    if !document["style"].is_object() {
        document["style"] = json!({});
    }
    if emphasis.is_empty() {
        if let Some(style) = document["style"].as_object_mut() {
            style.remove("captionEmphasis");
        }
    } else {
        document["style"]["captionEmphasis"] = Value::Object(emphasis.clone());
    }
    end
}

/// 把转录中已经落定的那几段换成内存正文里的 cue 流（台账 #219 缺口 ①）。
///
/// 转录跑着的时候项目盘上还没有 `transcript.json`，可 serve 的任务帧已经在给
/// 「已转录到第几秒 + 这几句的文本」（`liveSegments`，累加器在
/// `bcut_editor_core::live_track`）。字幕像素只由内核出（方案 D6：App 内一行
/// 排版都没有），所以实时段也走同一条路——调用方把累加出来的段交到这里，
/// 正文里的 cue 流整份换成它们，再照常编译渲染计划。
///
/// 与 [`apply_overlay_sample`] 的差别：**只换字幕**。`timeline` 原样留着，
/// 元素层（含分离主轨的主视频）照画；时间是项目自己的时间轴秒，不是小样的
/// 0..N 秒钟。`sentences` / `transCues` 清空——实时段没有译文轴，留着只会让
/// 旧稿的词 id 映射到新造的 cue 上。
///
/// 逐词时间没有（任务帧只给整句），词表交给 [`timed_inputs`] 从文本派生，
/// 与「转录稿里没有 `words` 的 cue」走同一条兜底。
pub fn apply_live_cues(document: &mut Value, spans: &[(f64, f64, &str)]) {
    let rows: Vec<Value> = spans
        .iter()
        .enumerate()
        .map(|(index, (start, end, text))| {
            json!({"id": format!("live{index}"), "start": start, "end": end.max(*start), "text": text})
        })
        .collect();
    document["cues"] = Value::Array(rows);
    document["sentences"] = json!([]);
    document["transCues"] = json!([]);
}

/// Studio 正文里是否有可用译文；多源时间轴的译文来自 `sourceDocs`，一并计入。
pub fn document_has_translation(document: &Value) -> bool {
    fn filled(scope: &Value) -> bool {
        let text = |value: &Value| value.as_str().is_some_and(|text| !text.trim().is_empty());
        scope["transCues"]
            .as_array()
            .is_some_and(|cues| cues.iter().any(|cue| text(&cue["text"])))
            || scope["sentences"]
                .as_array()
                .is_some_and(|rows| rows.iter().any(|row| text(&row["trans"])))
    }
    filled(document)
        || document["sourceDocs"]
            .as_object()
            .is_some_and(|docs| docs.values().any(filled))
}

pub fn same_json_base(base: Option<&str>, value: &Value) -> bool {
    base.and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .is_some_and(|base| base == *value)
}

pub fn overlay_ops(data: &Value, overlay: &Value, key: &str) -> Option<Vec<Value>> {
    let entry = overlay.get(key)?;
    let base_revision = entry.get("baseRev")?;
    let data_revision = data.get("rev")?;
    (base_revision == data_revision)
        .then(|| entry.get("ops")?.as_array().cloned())
        .flatten()
}

pub fn source_structure(data: &mut Value, ops: &[Value]) {
    let Some(cues) = data.get_mut("cues").and_then(Value::as_array_mut) else {
        return;
    };
    for operation in ops {
        let Some(id) = operation.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(index) = cues
            .iter()
            .position(|cue| cue.get("id").and_then(Value::as_str) == Some(id))
        else {
            continue;
        };
        match operation.get("kind").and_then(Value::as_str) {
            Some("split") => {
                let cue = cues[index].clone();
                let Some(text) = cue.get("text").and_then(Value::as_str) else {
                    continue;
                };
                if operation.get("baseText").and_then(Value::as_str) != Some(text) {
                    continue;
                }
                let offset = finite(operation.get("offset"), 0.0);
                let length = text.encode_utf16().count().max(1) as f64;
                let fraction = clamp(offset / length, 0.1, 0.9);
                let start = finite(cue.get("start"), 0.0);
                let end = finite(cue.get("end"), start);
                let middle = start + (end - start) * fraction;
                let mut upper = cue.clone();
                let mut lower = cue;
                if let Some(object) = upper.as_object_mut() {
                    object.insert("id".to_owned(), Value::String(format!("{id}a")));
                    object.insert("end".to_owned(), Value::from(middle));
                    object.insert(
                        "text".to_owned(),
                        operation.get("textA").cloned().unwrap_or(Value::Null),
                    );
                    object.remove("words");
                }
                if let Some(object) = lower.as_object_mut() {
                    object.insert("id".to_owned(), Value::String(format!("{id}b")));
                    object.insert("start".to_owned(), Value::from(middle));
                    object.insert(
                        "text".to_owned(),
                        operation.get("textB").cloned().unwrap_or(Value::Null),
                    );
                    object.remove("words");
                }
                cues.splice(index..=index, [upper, lower]);
            }
            Some("merge") if index > 0 => {
                if cues[index - 1].get("sp") != cues[index].get("sp") {
                    continue;
                }
                let previous = cues[index - 1].clone();
                let current = cues[index].clone();
                let merged_text = format!(
                    "{} {}",
                    previous.get("text").and_then(Value::as_str).unwrap_or(""),
                    current.get("text").and_then(Value::as_str).unwrap_or("")
                )
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
                if let Some(object) = cues[index - 1].as_object_mut() {
                    object.insert(
                        "end".to_owned(),
                        current.get("end").cloned().unwrap_or(Value::Null),
                    );
                    object.insert("text".to_owned(), Value::String(merged_text));
                    object.remove("words");
                }
                cues.remove(index);
            }
            _ => {}
        }
    }
}

pub fn integer(value: Option<&Value>) -> Option<i64> {
    value.and_then(|value| {
        value
            .as_i64()
            .or_else(|| value.as_u64().and_then(|number| number.try_into().ok()))
    })
}

pub fn word_span(row: &Value) -> Option<(i64, i64)> {
    Some((integer(row.get("wordFrom"))?, integer(row.get("wordTo"))?))
}

pub fn source_word_fields(words: &[Value]) -> (Value, Value) {
    let ids = words
        .iter()
        .filter_map(|word| word.get("id").cloned())
        .collect::<Vec<_>>();
    let text = words
        .iter()
        .filter_map(|word| word.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(" ");
    (Value::Array(ids), Value::String(text))
}

pub fn retime_translation_piece(
    template: &Value,
    words: Vec<Value>,
    from: i64,
    to: i64,
    text: &str,
) -> Value {
    let mut piece = template.clone();
    let (source_word_ids, source_text) = source_word_fields(&words);
    let start = words
        .first()
        .and_then(|word| word.get("start"))
        .cloned()
        .unwrap_or(Value::Null);
    let end = words
        .last()
        .and_then(|word| word.get("end"))
        .cloned()
        .unwrap_or(Value::Null);
    if let Some(object) = piece.as_object_mut() {
        object.insert("text".to_owned(), Value::String(text.to_owned()));
        object.insert("wordFrom".to_owned(), Value::from(from));
        object.insert("wordTo".to_owned(), Value::from(to));
        object.insert("start".to_owned(), start);
        object.insert("end".to_owned(), end);
        object.insert("sourceWords".to_owned(), Value::Array(words));
        object.insert("sourceWordIds".to_owned(), source_word_ids);
        object.insert("sourceText".to_owned(), source_text);
        object.insert("_edited".to_owned(), Value::Bool(true));
    }
    piece
}

pub fn translation_structure(data: &mut Value, ops: &[Value]) {
    let words_by_id = data["cues"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|cue| cue["words"].as_array().into_iter().flatten())
        .filter_map(|word| {
            let id = word["id"].as_str()?.to_owned();
            Some((
                id.clone(),
                json!({
                    "id": id,
                    "text": word["text"].as_str().unwrap_or_default(),
                    "start": word.get("start").or_else(|| word.get("t0")).cloned().unwrap_or(Value::Null),
                    "end": word.get("end").or_else(|| word.get("t1")).cloned().unwrap_or(Value::Null),
                }),
            ))
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    let sentence_words = data["sentences"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|sentence| {
            let id = sentence["id"].as_str()?.to_owned();
            let words = sentence["sourceWordIds"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter_map(|word_id| words_by_id.get(word_id).cloned())
                .collect::<Vec<_>>();
            Some((id, words))
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    let Some(rows) = data.get_mut("transCues").and_then(Value::as_array_mut) else {
        return;
    };
    for operation in ops {
        let Some(sentence_id) = operation.get("sid").and_then(Value::as_str) else {
            continue;
        };
        let mut candidates = rows
            .iter()
            .enumerate()
            .filter(|(_, row)| {
                row.get("sid").and_then(Value::as_str) == Some(sentence_id)
                    && row.get("kind").and_then(Value::as_str) == Some("piece")
            })
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        candidates.sort_by_key(|index| word_span(&rows[*index]).map_or(0, |span| span.0));
        match operation.get("kind").and_then(Value::as_str) {
            Some("split") => {
                let Some(from) = integer(operation.get("from")) else {
                    continue;
                };
                let Some(to) = integer(operation.get("to")) else {
                    continue;
                };
                let Some(at) = integer(operation.get("at")) else {
                    continue;
                };
                let mut index = candidates.iter().copied().find(|index| {
                    word_span(&rows[*index]) == Some((from, to))
                        && rows[*index].get("text").and_then(Value::as_str)
                            == operation.get("baseText").and_then(Value::as_str)
                });
                let mut seeded_words = None;
                if index.is_none() && operation["seedUnaligned"].as_bool() == Some(true) {
                    let words = sentence_words.get(sentence_id).cloned().unwrap_or_default();
                    let whole = rows.iter().position(|row| {
                        row["sid"].as_str() == Some(sentence_id)
                            && row["kind"] == "sentence"
                            && row["text"].as_str()
                                == operation.get("baseText").and_then(Value::as_str)
                    });
                    if !words.is_empty() && from == 0 && to == words.len() as i64 - 1 {
                        index = whole;
                        seeded_words = Some(words);
                    }
                }
                let Some(index) = index else {
                    continue;
                };
                if at < from || at >= to {
                    continue;
                }
                let words = seeded_words.unwrap_or_else(|| {
                    rows[index]
                        .get("sourceWords")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default()
                });
                let position = (at - from + 1) as usize;
                if position == 0 || position >= words.len() {
                    continue;
                }
                let Some(text_a) = operation.get("textA").and_then(Value::as_str) else {
                    continue;
                };
                let Some(text_b) = operation.get("textB").and_then(Value::as_str) else {
                    continue;
                };
                if text_a.is_empty() || text_b.is_empty() {
                    continue;
                }
                let mut template = rows[index].clone();
                template["kind"] = Value::String("piece".to_owned());
                let upper = retime_translation_piece(
                    &template,
                    words[..position].to_vec(),
                    from,
                    at,
                    text_a,
                );
                let lower = retime_translation_piece(
                    &template,
                    words[position..].to_vec(),
                    at + 1,
                    to,
                    text_b,
                );
                rows.splice(index..=index, [upper, lower]);
            }
            Some("merge") => {
                let Some(upper_span) =
                    integer(operation.get("upperFrom")).zip(integer(operation.get("upperTo")))
                else {
                    continue;
                };
                let Some(lower_span) =
                    integer(operation.get("lowerFrom")).zip(integer(operation.get("lowerTo")))
                else {
                    continue;
                };
                let upper_index = candidates.iter().copied().find(|index| {
                    word_span(&rows[*index]) == Some(upper_span)
                        && rows[*index].get("text").and_then(Value::as_str)
                            == operation.get("upperText").and_then(Value::as_str)
                });
                let lower_index = candidates.iter().copied().find(|index| {
                    word_span(&rows[*index]) == Some(lower_span)
                        && rows[*index].get("text").and_then(Value::as_str)
                            == operation.get("lowerText").and_then(Value::as_str)
                });
                let (Some(upper_index), Some(lower_index)) = (upper_index, lower_index) else {
                    continue;
                };
                if upper_span.1 + 1 != lower_span.0 {
                    continue;
                }
                let mut words = rows[upper_index]
                    .get("sourceWords")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                words.extend(
                    rows[lower_index]
                        .get("sourceWords")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default(),
                );
                if words.is_empty() {
                    continue;
                }
                let text = join_pieces([
                    rows[upper_index]
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                    rows[lower_index]
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                ]);
                let mut merged = retime_translation_piece(
                    &rows[upper_index],
                    words,
                    upper_span.0,
                    lower_span.1,
                    &text,
                );
                if let Some(object) = merged.as_object_mut() {
                    object.insert(
                        "start".to_owned(),
                        rows[upper_index]
                            .get("start")
                            .cloned()
                            .unwrap_or(Value::Null),
                    );
                    object.insert(
                        "end".to_owned(),
                        rows[lower_index].get("end").cloned().unwrap_or(Value::Null),
                    );
                }
                let high = upper_index.max(lower_index);
                let low = upper_index.min(lower_index);
                rows.remove(high);
                rows.splice(low..=low, [merged]);
            }
            _ => {}
        }
        let mut updated = rows
            .iter()
            .enumerate()
            .filter(|(_, row)| {
                row.get("sid").and_then(Value::as_str) == Some(sentence_id)
                    && row.get("kind").and_then(Value::as_str) == Some("piece")
            })
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        updated.sort_by_key(|index| word_span(&rows[*index]).map_or(0, |span| span.0));
        for (piece_index, row_index) in updated.into_iter().enumerate() {
            rows[row_index]["id"] = Value::String(format!("{sentence_id}#{piece_index}"));
        }
    }
    rows.sort_by(|left, right| {
        finite(left.get("start"), 0.0).total_cmp(&finite(right.get("start"), 0.0))
    });
}

/// 两片之间不加空格的字符对：汉字 / 假名 / 全角标点相邻，或谚文挨着汉字 /
/// 假名。两侧都是谚文时加空格——韩文按空格分词（`bcut-flow-core` 的
/// `sep_len` 同一条规则）。
pub fn unspaced_pair(left: char, right: char) -> bool {
    speech_doc::atomize::unspaced_pair(left, right)
}

pub fn join_pieces<'a>(parts: impl IntoIterator<Item = &'a str>) -> String {
    let mut output = String::new();
    for part in parts.into_iter().filter(|part| !part.is_empty()) {
        let separated = output
            .chars()
            .last()
            .zip(part.chars().next())
            .is_some_and(|(left, right)| !unspaced_pair(left, right));
        if separated {
            output.push(' ');
        }
        output.push_str(part);
    }
    output
}

pub fn apply_preview_overlays(data: &mut Value, overlay: &Value) {
    let source_ops = overlay_ops(data, overlay, "struct");
    let translation_ops = overlay_ops(data, overlay, "transStruct");
    let base_starts = data["cues"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|cue| {
            Some((
                cue.get("id")?.as_str()?.to_owned(),
                cue.get("start")?.as_f64()?,
            ))
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    if let Some(ops) = source_ops.as_deref() {
        source_structure(data, ops);
    }

    if let (Some(cues), Some(edits)) = (data["cues"].as_array_mut(), overlay["edits"].as_object()) {
        for cue in cues {
            let Some(id) = cue["id"].as_str() else {
                continue;
            };
            let Some(edit) = edits.get(id).and_then(|entry| entry.get("text")) else {
                continue;
            };
            if cue["text"].as_str() == edit["base"].as_str()
                && let Some(value) = edit["value"].as_str()
            {
                cue["text"] = Value::String(value.to_owned());
                cue.as_object_mut().map(|object| object.remove("words"));
            }
        }
    }

    if let (Some(cues), Some(timing)) = (data["cues"].as_array_mut(), overlay["timing"].as_object())
    {
        for cue in cues {
            let Some(id) = cue["id"].as_str() else {
                continue;
            };
            let Some(edit) = timing.get(id) else {
                continue;
            };
            let Some(base) = edit["base"].as_array() else {
                continue;
            };
            let Some(value) = edit["value"].as_array() else {
                continue;
            };
            if base.len() == 2
                && value.len() == 2
                && base_starts.get(id).copied() == base[0].as_f64()
                && let (Some(start), Some(end)) = (value[0].as_f64(), value[1].as_f64())
            {
                cue["start"] = Value::from(start);
                cue["end"] = Value::from(end);
                cue.as_object_mut().map(|object| object.remove("words"));
            }
        }
    }

    let trans = overlay["trans"].as_object();
    if let (Some(rows), Some(trans)) = (data["transCues"].as_array_mut(), trans) {
        for row in rows.iter_mut() {
            let Some(id) = row["id"].as_str() else {
                continue;
            };
            let Some(edit) = trans.get(id) else {
                continue;
            };
            if edit["kind"] == "piece"
                && row["text"].as_str() == edit["base"].as_str()
                && let Some(value) = edit["value"].as_str()
            {
                row["text"] = Value::String(value.to_owned());
                row["_edited"] = Value::Bool(true);
            }
        }
    }
    if let Some(ops) = translation_ops.as_deref() {
        translation_structure(data, ops);
    }

    let sentence_ids = data["sentences"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|sentence| sentence["id"].as_str().map(str::to_owned))
        .collect::<Vec<_>>();
    for id in sentence_ids {
        let sentence_index = data["sentences"].as_array().and_then(|sentences| {
            sentences
                .iter()
                .position(|sentence| sentence["id"].as_str() == Some(id.as_str()))
        });
        let Some(sentence_index) = sentence_index else {
            continue;
        };
        let edit = trans.and_then(|trans| trans.get(&id));
        let sentence_edit = edit.is_some_and(|edit| {
            edit["kind"] == "sentence"
                && data["sentences"][sentence_index]["trans"].as_str() == edit["base"].as_str()
        });
        if sentence_edit {
            let edit = edit.unwrap();
            if let Some(value) = edit["value"].as_str() {
                let value = value.to_owned();
                let sentence = &mut data["sentences"][sentence_index];
                sentence["trans"] = Value::String(value.clone());
                sentence["aligned"] = Value::Bool(false);
                sentence["_editedTrans"] = Value::Bool(true);
                let start = finite(sentence.get("start"), 0.0);
                let end = finite(sentence.get("end"), start);
                if let Some(rows) = data["transCues"].as_array_mut() {
                    rows.retain(|row| row["sid"].as_str() != Some(id.as_str()));
                    rows.push(serde_json::json!({
                        "id": id, "sid": id, "kind": "sentence", "text": value,
                        "start": start, "end": end, "_edited": true,
                    }));
                    rows.sort_by(|left, right| {
                        finite(left.get("start"), 0.0).total_cmp(&finite(right.get("start"), 0.0))
                    });
                }
            }
            continue;
        }
        let pieces = data["transCues"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|row| row["sid"].as_str() == Some(id.as_str()) && row["kind"] == "piece")
            .collect::<Vec<_>>();
        if pieces
            .iter()
            .any(|row| row["_edited"].as_bool() == Some(true))
        {
            data["sentences"][sentence_index]["trans"] = Value::String(join_pieces(
                pieces.iter().filter_map(|row| row["text"].as_str()),
            ));
            data["sentences"][sentence_index]["_editedTrans"] = Value::Bool(true);
        }
    }

    if let Some(style) = overlay.get("style")
        && same_json_base(style["base"].as_str(), &data["style"])
        && let (Some(current), Some(patch)) =
            (data["style"].as_object_mut(), style["value"].as_object())
    {
        current.extend(patch.clone());
    }
}

pub fn timing(style: &Value) -> (f64, f64) {
    let value = style.get("displayTiming").unwrap_or(&Value::Null);
    (
        finite(value.get("leadIn"), DEFAULT_LEAD_IN).max(0.0),
        finite(value.get("tail"), DEFAULT_TAIL).max(0.0),
    )
}

pub fn display_padding(buffer: f64, gap: f64, lead_in: f64, tail: f64) -> f64 {
    let cap = lead_in + tail;
    if cap <= 0.0 {
        return 0.0;
    }
    buffer.max(0.0).min(gap.max(0.0) * buffer.max(0.0) / cap)
}

/// 显示间距不依赖标点开关或语言标签：源字幕、译文和导入字幕都可能混排。
/// 仅在汉字/假名与 ASCII 字母数字的直接邻接处补空格，不改正文、大小写或词时刻。
pub fn projected_text(text: &str, language: &str, enabled: bool) -> String {
    let text = if enabled {
        target_delivery_projection(text, language)
    } else {
        text.to_owned()
    };
    speech_doc::autocorrect::display_spacing(&text)
}

pub fn derived_words(
    item: &Value,
    text: &str,
    start: f64,
    end: f64,
    language: &str,
    project_punctuation: bool,
) -> Vec<Word> {
    let explicit: Vec<Word> = item["words"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, word)| {
            Some(Word {
                id: word
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("word-{index}")),
                text: projected_text(word.get("text")?.as_str()?, language, project_punctuation),
                start: word
                    .get("t0")
                    .or_else(|| word.get("start"))
                    .and_then(Value::as_f64)
                    .unwrap_or(start),
                end: word.get("t1").or_else(|| word.get("end"))?.as_f64()?,
            })
        })
        .collect();
    if !explicit.is_empty() {
        return explicit;
    }
    // 没有逐词时间时，按显示间距切分；否则无空格的混排句会被当成一个词，
    // 折行与推算高亮和显式带空格的同一句不同。已有词的 ID 与时间不动。
    let spaced = speech_doc::autocorrect::display_spacing(text);
    let tokens: Vec<&str> = spaced
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .collect();
    let weights: Vec<f64> = tokens
        .iter()
        .map(|token| {
            token
                .chars()
                .filter(|character| character.is_alphanumeric() || *character == '\'')
                .count()
                .max(2) as f64
                + 1.4
        })
        .collect();
    let total = weights.iter().sum::<f64>().max(1.0);
    let duration = (end - start).max(0.01);
    let mut elapsed = 0.0;
    tokens
        .iter()
        .zip(weights)
        .enumerate()
        .map(|(index, (token, weight))| {
            let word_start = start + duration * elapsed / total;
            elapsed += weight;
            Word {
                id: format!("derived-{index}"),
                text: projected_text(token, language, project_punctuation),
                start: word_start,
                end: start + duration * elapsed / total,
            }
        })
        .collect()
}

pub fn timed_items(
    values: &[Value],
    text_key: &'static str,
    style: &Value,
    language: &str,
) -> Vec<TimedItem> {
    let values = values
        .iter()
        .map(|item| TimedInput {
            item,
            text_key,
            language,
        })
        .collect::<Vec<_>>();
    timed_inputs(&values, style)
}

/// 一条绘制输入落成 [`TimedItem`] 时的 id：`id`，没有就 `sid`，再没有按它在输入
/// 切片里的位置编号（`index` 是**过滤前**的下标）。逐条样式要从原始条目反查到
/// 这个 id，两处必须走同一个函数。
pub fn timed_input_id(item: &Value, text_key: &str, index: usize) -> String {
    item.get("id")
        .or_else(|| item.get("sid"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{text_key}-{index}"))
}

pub fn timed_inputs(values: &[TimedInput<'_>], style: &Value) -> Vec<TimedItem> {
    let (lead_in, tail) = timing(style);
    let project_punctuation = style.get("punct").and_then(Value::as_bool).unwrap_or(true);
    let mut base: Vec<(String, String, f64, f64, Vec<Word>)> = values
        .iter()
        .enumerate()
        .filter_map(|(index, input)| {
            let item = input.item;
            let raw_text = item.get(input.text_key)?.as_str()?.to_owned();
            let text = projected_text(&raw_text, input.language, project_punctuation);
            if text.trim().is_empty() {
                return None;
            }
            let start = finite(item.get("start"), 0.0);
            let end = finite(item.get("end"), start).max(start);
            Some((
                timed_input_id(item, input.text_key, index),
                text.clone(),
                start,
                end,
                derived_words(
                    item,
                    &raw_text,
                    start,
                    end,
                    input.language,
                    project_punctuation,
                ),
            ))
        })
        .collect();
    base.sort_by(|left, right| left.2.total_cmp(&right.2));
    (0..base.len())
        .map(|index| {
            let previous_gap = if index > 0 {
                base[index].2 - base[index - 1].3
            } else {
                f64::INFINITY
            };
            let next_gap = if index + 1 < base.len() {
                base[index + 1].2 - base[index].3
            } else {
                f64::INFINITY
            };
            TimedItem {
                id: base[index].0.clone(),
                series_index: index as u32,
                text: base[index].1.clone(),
                display_start: base[index].2
                    - display_padding(lead_in, previous_gap, lead_in, tail),
                display_end: base[index].3 + display_padding(tail, next_gap, lead_in, tail),
                words: base[index].4.clone(),
            }
        })
        .collect()
}

pub fn active_at(items: &[TimedItem], time: f64) -> Option<&TimedItem> {
    let next = items.partition_point(|item| item.display_start <= time);
    next.checked_sub(1)
        .and_then(|index| items.get(index))
        .filter(|item| time < item.display_end)
}

pub fn merged_line_style(root: &Value, kind: LineKind) -> Value {
    let mut merged = root.as_object().cloned().unwrap_or_default();
    let key = match kind {
        LineKind::Original => "origStyle",
        LineKind::Translation => "transStyle",
    };
    if let Some(overrides) = root.get(key).and_then(Value::as_object) {
        merged.extend(overrides.clone());
    }
    Value::Object(merged)
}

/// 行级位置覆盖：`origStyle.x/y`、`transStyle.x/y` 是该行文本块中心的帧百分比。
///
/// 必须显式读 partial，不能走 [`merged_line_style`]——合并结果永远带着根节点的
/// 锚点 `x`/`y`，那样每行都会被判成「有覆盖」，堆栈会整体塌到锚点上。
/// x、y 必须同时存在且有限才算覆盖（契约：两者都在才脱离堆栈），所以这里也不能
/// 用 `finite()`：它会把 `null`/NaN 补成默认值，凭空造出覆盖。
///
/// 行级位置只在双语上下文有意义。单行导出必须忽略残留覆盖，否则一次双语摆放会
/// 把 orig/trans 单行模式下唯一那行也搬走。
pub fn line_position_override(
    root: &Value,
    kind: LineKind,
    mode: StudioMode,
) -> Option<(f64, f64)> {
    if mode != StudioMode::Bilingual {
        return None;
    }
    let overrides = match kind {
        LineKind::Original => root.get("origStyle"),
        LineKind::Translation => root.get("transStyle"),
    }?;
    let coordinate = |key: &str| {
        overrides
            .get(key)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
    };
    Some((coordinate("x")?, coordinate("y")?))
}

/// 垂直锚点：文本块（或槽位内的一行）挂在锚线上的哪条边。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerticalAlign {
    Top,
    Center,
    Bottom,
}

/// 严格白名单：只认 `"top" | "center" | "bottom"` 三个字符串，其余一律缺席。
///
/// 缺席不是 center 的同义词——它还意味着「用接缝规则」。所以这里必须返回
/// `Option`，把「显式写了 center」和「什么都没写」分开；数字、布尔、拼错的字符串
/// 都当没写，与 JS 预览的 `typeof === 'string'` 判据同构。
pub fn vertical_align_from_str(value: &str) -> Option<VerticalAlign> {
    match value {
        "top" => Some(VerticalAlign::Top),
        "center" => Some(VerticalAlign::Center),
        "bottom" => Some(VerticalAlign::Bottom),
        _ => None,
    }
}

/// JSON 侧的 [`vertical_align_from_str`]：非字符串一律当没写。
pub fn parse_vertical_align(value: Option<&Value>) -> Option<VerticalAlign> {
    vertical_align_from_str(value?.as_str()?)
}

/// 行级垂直锚点：`origStyle.verticalAlign` / `transStyle.verticalAlign`。
///
/// 与 [`line_position_override`] 同构，两条纪律照抄：
/// - 只读 partial，不走 [`merged_line_style`]——合并结果会带上根节点的块级锚点，
///   那样每一行都会被判成「显式指定」，接缝规则就永远轮不到。
/// - 只在双语上下文消费。单行导出必须忽略残留的行级锚点，否则一次双语摆放会把
///   orig/trans 单行模式下唯一那行也搬走。
pub fn line_vertical_align(
    root: &Value,
    kind: LineKind,
    mode: StudioMode,
) -> Option<VerticalAlign> {
    if mode != StudioMode::Bilingual {
        return None;
    }
    let overrides = match kind {
        LineKind::Original => root.get("origStyle"),
        LineKind::Translation => root.get("transStyle"),
    }?;
    parse_vertical_align(overrides.get("verticalAlign"))
}

/// 逐条样式覆盖表在根样式上的键（§16.3.1）：
/// `style.cueStyles[源条目 id]["source" | "translation"] = {…稀疏字段}`。
///
/// 缺席 = 跟随整条轨；`{}` = 已脱离但一项没改，画出来与跟随逐像素相同。
pub const CUE_STYLES_KEY: &str = "cueStyles";

/// 覆盖表里区分原文 / 译文那一层的键。
pub fn cue_style_track(kind: LineKind) -> &'static str {
    match kind {
        LineKind::Original => "source",
        LineKind::Translation => "translation",
    }
}

/// 某一条源条目在某一行上的覆盖表；没脱离时是 `None`。
pub fn cue_style_partial<'a>(
    root: &'a Value,
    kind: LineKind,
    source_id: &str,
) -> Option<&'a serde_json::Map<String, Value>> {
    root.get(CUE_STYLES_KEY)?
        .get(source_id)?
        .get(cue_style_track(kind))?
        .as_object()
}

/// 这一条字幕画出来用的根样式：整条轨的样式叠上它自己的覆盖表。
///
/// 覆盖表为空或缺席时返回 `None`，调用方直接用整条轨那一份，不白拷一次根样式。
/// 叠法与 [`merged_line_style`] / [`resolve_line_style`] 的读法配套：
/// - 双语：覆盖写进这一行自己的 partial（`origStyle` / `transStyle`），另一行不受
///   影响。行级位置要 x、y 成对才算脱离堆栈，只给了一半时另一半取整条轨此刻的值。
/// - 单行：覆盖同时写进根节点（锚点 x/y/verticalAlign 与根字号从根上读），并压过
///   两份 partial 里已有的同名键，否则 partial 会把覆盖又盖回去。
///
/// 结果里去掉了 `cueStyles` 本身：每条覆盖各拷一份整张表是 O(n²)。
pub fn cue_root(root: &Value, kind: LineKind, source_id: &str, mode: StudioMode) -> Option<Value> {
    let partial = cue_style_partial(root, kind, source_id).filter(|partial| !partial.is_empty())?;
    let mut next = root.as_object().cloned().unwrap_or_default();
    next.remove(CUE_STYLES_KEY);
    if mode == StudioMode::Bilingual {
        let line_key = match kind {
            LineKind::Original => "origStyle",
            LineKind::Translation => "transStyle",
        };
        let mut line = next
            .get(line_key)
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let (has_x, has_y) = (partial.contains_key("x"), partial.contains_key("y"));
        if has_x != has_y {
            let (missing, fallback) = if has_x { ("y", 86.0) } else { ("x", 50.0) };
            if !line.contains_key(missing) {
                let merged = merged_line_style(root, kind);
                line.insert(
                    missing.to_owned(),
                    json!(finite(merged.get(missing), fallback)),
                );
            }
        }
        line.extend(partial.clone());
        next.insert(line_key.to_owned(), Value::Object(line));
    } else {
        for line_key in ["origStyle", "transStyle"] {
            if let Some(line) = next.get_mut(line_key).and_then(Value::as_object_mut) {
                for (key, value) in partial {
                    if line.contains_key(key) {
                        line.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        next.extend(partial.clone());
    }
    Some(Value::Object(next))
}

pub fn font_name(style: &Value) -> String {
    let value = style
        .get("fontFamily")
        .and_then(|value| {
            value
                .as_str()
                .or_else(|| value.get("fontFamily").and_then(Value::as_str))
        })
        .unwrap_or("system");
    let mapped = match value {
        "system" => "Noto Sans SC",
        "montserrat" => "Montserrat",
        "bebas" => "Bebas Neue",
        "lexend" => "Lexend Deca",
        "serif" => "Source Serif 4",
        // SwiftPM 为 UI 字体写入稳定的内部 family；样式模型仍保留用户
        // 看到的产品名，MP4 shaping 在这里落到实际打包 family。
        "Source Sans 3" => "VK Sans",
        "Source Code Pro" => "VK Code",
        other => other,
    };
    let sanitized = mapped
        .chars()
        .filter(|character| !matches!(character, '\\' | '{' | '}' | '\r' | '\n'))
        .collect::<String>();
    (!sanitized.trim().is_empty())
        .then_some(sanitized)
        .unwrap_or_else(|| "Noto Sans SC".to_owned())
}

pub fn resolve_line_style(
    root: &Value,
    kind: LineKind,
    width: u32,
    height: u32,
    compact_original: bool,
) -> LineStyle {
    let style = merged_line_style(root, kind);
    let size_basis = if style.get("fontSizeBasis").and_then(Value::as_str) == Some("height") {
        height
    } else {
        width.min(height)
    };
    let canvas_scale =
        (f64::from(size_basis) / REFERENCE_SHORT_EDGE) * finite(root.get("scale"), 1.0).max(0.05);
    let explicit_size = match kind {
        LineKind::Original => root.get("origStyle"),
        LineKind::Translation => root.get("transStyle"),
    }
    .and_then(Value::as_object)
    .and_then(|value| value.get("fontSize"))
    .and_then(Value::as_f64)
    .map(|size| size.max(1.0));
    let base = finite(root.get("fontSize"), REFERENCE_FONT_SIZE).max(1.0);
    let bilingual_scale =
        finite(root.get("bilingualOrigScale"), DEFAULT_BILINGUAL_ORIG_SCALE).max(0.1);
    let logical_size = explicit_size.unwrap_or_else(|| match kind {
        LineKind::Translation => {
            base * bilingual_scale
                * finite(root.get("transScale"), DEFAULT_TRANSLATION_RATIO).max(0.1)
        }
        LineKind::Original if compact_original => base * bilingual_scale,
        LineKind::Original => base,
    });
    let font_size = logical_size * canvas_scale;
    let outline = style.get("textOutline").unwrap_or(&Value::Null);
    let outline_color = SubtitleColor::parse(
        outline.get("color"),
        SubtitleColor {
            r: 0,
            g: 0,
            b: 0,
            a: 31,
        },
    );
    let outline_on = outline
        .get("on")
        .and_then(Value::as_bool)
        .or_else(|| style.get("outline").and_then(Value::as_bool))
        .unwrap_or_else(|| finite(outline.get("width"), 0.0) > 0.0 && outline_color.a < 252);
    // 持久化的 `textOutline.width` 是**可见外扩量**占字号的百分比，不是线宽：
    // Mac `StagePaneView` 写的是 `.strokeWidth = -width * 0.5`（AppKit 的负值描边
    // 跨轮廓居中，单位是字号百分比），线宽 = width/100·fontSize·0.5，外扩量正好是
    // 它的一半。这里存整条居中线宽，`raster` 的 tiny-skia stroke 与 `ass_style`
    // 的外扩量都从它派生。漏掉 0.5 会让烧录描边比预览粗一倍。
    let outline_width = finite(
        outline.get("width"),
        if style.get("outline").and_then(Value::as_bool) == Some(true) {
            14.0
        } else {
            0.0
        },
    )
    .max(0.0)
        * font_size
        / 100.0
        * 0.5;
    let shadow = style.get("dropShadow").unwrap_or(&Value::Null);
    let legacy_outline = style.get("outline").and_then(Value::as_bool) == Some(true);
    let shadow_on = shadow
        .get("on")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| {
            finite(shadow.get("blur"), 0.0) > 0.0 || finite(shadow.get("distance"), 0.0) > 0.0
        });
    let shadow_distance = finite(shadow.get("distance"), 0.04).max(0.0) * font_size;
    let shadow_angle = finite(shadow.get("rotation"), 90.0).to_radians();
    let shadow_color = SubtitleColor::parse(shadow.get("color"), SubtitleColor::BLACK)
        .with_opacity(finite(
            shadow.get("opacity"),
            if legacy_outline { 0.48 } else { 0.6 },
        ));
    let glow = style.get("glow").unwrap_or(&Value::Null);
    let glow_on = glow
        .get("on")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| finite(glow.get("intensity"), 0.0) > 0.0);
    // 模糊半径**不夹上限**：原型与 Web 预览都不夹（`panel-substyle.jsx` 的
    // `filter: drop-shadow()` 直接吃 range），夹一道就等于「预览里柔、烧录里硬」。
    // 面板的 glow range 最大 100（⇒ 0.9·fontSize）、shadow blur 最大 0.5
    // （⇒ 0.5·fontSize），可调范围本来就落在旧上限之内——夹取只对手写 JSON 生效，
    // 而那正是 Bulb / Vegas 这类大模糊配方被削掉的地方。下限仍保 1px：0 半径的
    // box blur 没有意义。
    // 已知缺口：发光与阴影共用同一个 effect 槽位，`glow_on` 时阴影被整个丢掉，
    // 而 Mac 预览是发光轮次（`SubtitleFrameDrawing.swift:544-551`）之后照常画
    // 带阴影的描边，两者可以叠加。拆成两个槽位要动 render_plan 的 DrawOp 结构，
    // 不在本次修复范围内。
    let (effect_on, effect_color, effect_x, effect_y, effect_blur) = if glow_on {
        (
            true,
            SubtitleColor::parse(glow.get("color"), SubtitleColor::WHITE)
                .with_opacity(finite(glow.get("intensity"), 50.0) / 100.0),
            0.0,
            0.0,
            (finite(glow.get("range"), 40.0) / 100.0 * font_size * 0.9).max(1.0),
        )
    } else if shadow_on {
        (
            true,
            shadow_color,
            shadow_angle.cos() * shadow_distance,
            shadow_angle.sin() * shadow_distance,
            finite(shadow.get("blur"), if legacy_outline { 0.12 } else { 0.08 }).max(0.0)
                * font_size,
        )
    } else {
        (false, SubtitleColor::BLACK, 0.0, 0.0, 0.0)
    };
    let background_on = style
        .get("background")
        .and_then(Value::as_bool)
        .or_else(|| style.get("bgOn").and_then(Value::as_bool))
        .unwrap_or_else(|| {
            style
                .get("backgroundColor")
                .and_then(Value::as_str)
                .and_then(parse_css_color)
                .is_some_and(|color| color.a < 252)
        });
    // `block` 底板只影响最小宽度（下面的 `background_min_width`），**不再另调纵向
    // 留白**：原型 `padOf` 只有一个 `pad`，横竖之比恒为 [`PLATE_PAD_ASPECT`]。
    let block_background =
        style.get("backgroundStyle").and_then(Value::as_str) == Some("block") && background_on;
    // 底板留白 / 圆角 / 字距都归一化到**这一行自己的字号**（见 [`REFERENCE_FONT_SIZE`]）。
    let size_scale = font_size / REFERENCE_FONT_SIZE;
    let background_pad_h = finite(style.get("backgroundPadding"), 10.0).max(0.0) * size_scale * 0.8;
    let font_weight = style
        .get("fontWeight")
        .and_then(|value| {
            value.as_u64().map(|value| value as u16).or_else(|| {
                value.as_str().map(|value| {
                    value.parse::<u16>().unwrap_or_else(|_| match value {
                        "medium" => 500,
                        "semibold" => 600,
                        "bold" => 700,
                        "extrabold" | "heavy" => 800,
                        "black" => 900,
                        _ => 400,
                    })
                })
            })
        })
        .unwrap_or(400)
        .clamp(100, 900);
    let bold = style.get("bold").and_then(Value::as_bool).unwrap_or(false);
    let font_weight = if bold {
        font_weight.max(700)
    } else {
        font_weight
    };
    LineStyle {
        shaped_italic: size_basis == height
            && style.get("fontSizeBasis").and_then(Value::as_str) == Some("height")
            && style
                .get("italic")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        text_motion: style
            .get("textMotion")
            .filter(|v| !v.is_null())
            .and_then(|v| {
                serde_json::from_value::<motion::text_motion::TextMotion>(v.clone()).ok()
            })
            .and_then(|m| m.compile().ok())
            .map(Arc::new),
        word_background: style
            .get("wordBackground")
            .filter(|v| !v.is_null())
            .and_then(|v| serde_json::from_value(v.clone()).ok()),
        font_name: font_name(&style),
        font_size,
        font_weight,
        color: SubtitleColor::parse(
            style.get("fontColor").or_else(|| root.get("fontColor")),
            SubtitleColor::WHITE,
        ),
        bold: font_weight >= 700,
        italic: style
            .get("italic")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || style.get("fontStyle").and_then(Value::as_str) == Some("italic"),
        underline: style
            .get("underline")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        letter_spacing: finite(style.get("letterSpacing"), 0.0) * size_scale,
        outline_on,
        outline_color,
        outline_width,
        effect_on,
        effect_color,
        effect_x,
        effect_y,
        effect_blur,
        background_on,
        background_color: SubtitleColor::parse(
            style
                .get("backgroundColor")
                .or_else(|| root.get("backgroundColor")),
            SubtitleColor {
                r: 0,
                g: 0,
                b: 0,
                a: 51,
            },
        ),
        background_pad_h,
        background_pad_v: style
            .get("backgroundPaddingY")
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite() && *v >= 0.0)
            .map_or(background_pad_h / PLATE_PAD_ASPECT, |v| {
                v * size_scale * 0.8
            }),
        background_radius: style
            .get("borderRadius")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
            .map_or(background_pad_h, |value| value.max(0.0) * size_scale * 0.55),
        block_background,
        background_min_width: if block_background {
            f64::from(width) * 0.28
        } else {
            0.0
        },
        line_height: finite(style.get("lineHeight"), 1.2).max(0.5),
        text_transform: style
            .get("textTransform")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        emphasis: emphasis_look(&style),
    }
}

fn transform_text_chunk(text: &str, transform: &str, capitalize_next: &mut bool) -> String {
    match transform {
        "uppercase" => text.to_uppercase(),
        "lowercase" => text.to_lowercase(),
        // CSS `text-transform: capitalize` uppercases the first character after the start or
        // whitespace and preserves every remaining character verbatim. In particular, ACME
        // stays `ACME`; forcing the tail to lowercase would diverge from the Web preview.
        "title" | "capitalize" => {
            let mut output = String::with_capacity(text.len());
            for character in text.chars() {
                if *capitalize_next && !character.is_whitespace() {
                    output.extend(character.to_uppercase());
                } else {
                    output.push(character);
                }
                *capitalize_next = character.is_whitespace();
            }
            output
        }
        _ => text.to_owned(),
    }
}

pub fn transform_text(text: &str, transform: &str) -> String {
    transform_text_chunk(text, transform, &mut true)
}

pub fn transition_duration(style: &Value) -> f64 {
    let transition = style.get("transition").unwrap_or(&Value::Null);
    let id = transition
        .get("transitionId")
        .or_else(|| transition.get("id"))
        .and_then(Value::as_str)
        .or_else(|| style.get("transitionId").and_then(Value::as_str))
        .unwrap_or("none");
    let speed = clamp(
        finite(
            transition
                .get("transitionSpeed")
                .or_else(|| transition.get("speed"))
                .or_else(|| style.get("transitionSpeed")),
            50.0,
        ),
        0.0,
        100.0,
    );
    let (maximum, minimum) = match id {
        "magic-fade" => (0.15, 0.35),
        "magic-pop" | "magic-flip" => (0.01, 0.19),
        _ => return 0.0,
    };
    maximum + (minimum - maximum) * ((100.0 - speed) / 100.0)
}

pub fn visual_from_json(value: &Value) -> WordVisual {
    WordVisual {
        color: value
            .get("color")
            .and_then(Value::as_str)
            .and_then(parse_css_color),
        opacity: value.get("opacity").and_then(Value::as_f64),
        background: value
            .get("backgroundColor")
            .and_then(Value::as_str)
            .and_then(parse_css_color),
        border_radius_em: value.get("borderRadiusEm").and_then(Value::as_f64),
        underline: value.get("underline").and_then(Value::as_bool),
        underline_offset_em: value.get("underlineOffsetEm").and_then(Value::as_f64),
        bottom_em: value.get("bottomEm").and_then(Value::as_f64),
        shadow_off: value
            .get("shadowOff")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        // 曲线不进三档合并，见 [`WordBoxTrack`]。
        box_scale: None,
        box_opacity: None,
        recipe: None,
    }
}

pub fn merge_visual(base: &mut WordVisual, extra: WordVisual) {
    if extra.color.is_some() {
        base.color = extra.color;
    }
    if extra.opacity.is_some() {
        base.opacity = extra.opacity;
    }
    if extra.background.is_some() {
        base.background = extra.background;
    }
    if extra.border_radius_em.is_some() {
        base.border_radius_em = extra.border_radius_em;
    }
    if extra.underline.is_some() {
        base.underline = extra.underline;
    }
    if extra.underline_offset_em.is_some() {
        base.underline_offset_em = extra.underline_offset_em;
    }
    if extra.bottom_em.is_some() {
        base.bottom_em = extra.bottom_em;
    }
    if extra.box_scale.is_some() {
        base.box_scale = extra.box_scale;
    }
    if extra.box_opacity.is_some() {
        base.box_opacity = extra.box_opacity;
    }
    base.shadow_off |= extra.shadow_off;
}

pub fn designed_caption(style: &Value, animation: &Value) -> Option<DesignedCaption> {
    let caption = animation.get("caption")?.as_object()?;
    let style_id = caption
        .get("style")
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)?
        .to_owned();
    if !style_id.starts_with("caption-") {
        return None;
    }
    let palette = caption.get("palette").unwrap_or(&Value::Null);
    let mut overrides = HashMap::new();
    for (id, role, color, value) in caption_emphasis_words(style) {
        overrides.insert(
            id.clone(),
            CaptionWordOverride {
                role: role.to_owned(),
                color,
                emoji: value
                    .get("emoji")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            },
        );
    }
    Some(DesignedCaption {
        style_id,
        style_version: caption
            .get("style")
            .and_then(|value| value.get("version"))
            .and_then(Value::as_u64)
            .unwrap_or(1) as u32,
        content: caption
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("orig")
            .to_owned(),
        primary: SubtitleColor::parse(palette.get("primary"), SubtitleColor::WHITE),
        accent: SubtitleColor::parse(
            palette.get("accent"),
            parse_css_color("#FFD43B").unwrap_or(SubtitleColor::WHITE),
        ),
        secondary: SubtitleColor::parse(
            palette.get("secondary"),
            SubtitleColor::parse(
                palette.get("accent"),
                parse_css_color("#FFD43B").unwrap_or(SubtitleColor::WHITE),
            ),
        ),
        intensity: (finite(caption.get("intensity"), 60.0) / 100.0).clamp(0.0, 1.0),
        speed: finite(caption.get("speed"), 1.0).clamp(0.35, 2.0),
        seed: caption.get("seed").and_then(|value| {
            value.as_u64().or_else(|| {
                value
                    .as_f64()
                    .filter(|value| value.is_finite() && *value >= 0.0)
                    .map(|value| value as u64)
            })
        }),
        options: caption
            .get("options")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        overrides,
        sequences: CaptionSequenceIntent::from_style(style),
    })
}

pub fn word_animation(style: &Value) -> WordAnimation {
    let value = style
        .get("wordAnimation")
        .or_else(|| style.get("anim"))
        .unwrap_or(&Value::Null);
    let explicit = !value.is_null();
    let name = value
        .get("animationName")
        .or_else(|| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or(if explicit { "None" } else { "Color" })
        .to_owned();
    let caption = designed_caption(style, value);
    let mut animation = WordAnimation {
        motion_id: value
            .get("catalogId")
            .and_then(Value::as_str)
            .filter(|id| word_motion::by_id(id).is_some() && *id != "none")
            .map(str::to_owned),
        name: if caption.is_some() {
            "Designed".to_owned()
        } else {
            name.clone()
        },
        spoken: WordVisual::default(),
        active: WordVisual::default(),
        unspoken: WordVisual::default(),
        box_track: word_box_track(&value["active"]),
        caption,
    };
    match name.as_str() {
        "Color" => {
            animation.active.color = parse_css_color(if explicit {
                "#FFD43B"
            } else {
                style
                    .get("karaokeColor")
                    .and_then(Value::as_str)
                    .unwrap_or("#8CAAFF")
            });
        }
        "Highlight" => {
            animation.active.background = parse_css_color("#FFD43B");
            animation.active.color = parse_css_color("#0D0D0D");
            animation.active.border_radius_em = Some(0.25);
        }
        "Reveal" => {
            animation.unspoken.color = parse_css_color("transparent");
            animation.unspoken.shadow_off = true;
            animation.unspoken.underline = Some(false);
            animation.unspoken.opacity = Some(0.0);
        }
        // 纯不透明度那两档（原型 `model-subanim.js` 的 `karaokeV2` / `highlight`）。
        //
        // **一块底都没有，也不换色**：颜色参数表里拿颜色的只有三条
        // （`colourHighlight` 当字色，`boxHighlight` / `bgHighlight` 当块色），卡拉 OK
        // 与荧光笔一个都不在。它们各只有一条 `colour.a` 曲线，所以这里只写
        // `opacity`——不写 `background` / `color`，`classic_word_box` 就不会画块，
        // 面板那一侧 `accent_bindings` 也就没有颜色行可给。
        "Karaoke" => {
            animation.spoken.opacity = Some(1.0);
            animation.active.opacity = Some(1.0);
            animation.unspoken.opacity = Some(0.5);
        }
        "Highlighter" => {
            animation.spoken.opacity = Some(0.5);
            animation.active.opacity = Some(1.0);
            animation.unspoken.opacity = Some(0.5);
        }
        "Bounce" => animation.active.bottom_em = Some(0.22),
        "Paint" => {
            animation.spoken.color = parse_css_color("#FFD43B");
            animation.spoken.underline = Some(true);
            animation.spoken.underline_offset_em = Some(0.18);
        }
        "Custom" => {
            animation.spoken.color = parse_css_color("#2EC971");
            animation.active.background = parse_css_color("#FFD43B");
            animation.active.color = parse_css_color("#0D0D0D");
            animation.active.border_radius_em = Some(0.25);
            animation.unspoken.opacity = Some(0.5);
        }
        _ => {}
    }
    merge_visual(&mut animation.spoken, visual_from_json(&value["spoken"]));
    merge_visual(&mut animation.active, visual_from_json(&value["active"]));
    merge_visual(
        &mut animation.unspoken,
        visual_from_json(&value["unspoken"]),
    );
    animation
}

/// 经典逐词动画的三档合并。`phase` 是**当前词自己窗口内**的相位（0–1），只被
/// [`WordAnimation::box_track`] 消费；没有轨的效果对它免疫，传什么都一样。
pub fn word_state(
    animation: &WordAnimation,
    index: usize,
    current: usize,
    phase: f64,
) -> WordVisual {
    let mut value = WordVisual::default();
    if index <= current {
        merge_visual(&mut value, animation.spoken.clone());
    }
    if index == current {
        merge_visual(&mut value, animation.active.clone());
    }
    if index > current {
        merge_visual(&mut value, animation.unspoken.clone());
    }
    if index == current
        && let Some(track) = &animation.box_track
    {
        value.box_scale = track.scale_at(phase);
        value.box_opacity = track.opacity_at(phase);
    }
    value
}

/// Designed Caption 的逐词投影。所有时间通道由 Mac 同源 recipe resolver 给出，
/// 这里仅把颜色、透明度和 plate 语义转换成共享光栅层可消费的状态。
pub fn designed_word_state(
    design: &DesignedCaption,
    item: &TimedItem,
    index: usize,
    time: f64,
    fps: f64,
) -> WordVisual {
    let word = &item.words[index];
    let resolved = resolve_caption_recipe_word(design, item, index, time, fps);
    let mut visual = WordVisual {
        color: Some(design.primary),
        recipe: resolved.clone(),
        ..WordVisual::default()
    };
    let marked = design.overrides.get(&word.id);
    if resolved.is_none() {
        // Mac 将冻结但不可用的 recipe 当作显式验证错误；共享烧录层没有错误
        // 回传通道，因此画空而不是退化为无关的 Basic 字幕。
        visual.opacity = Some(0.0);
        return visual;
    }
    let role = resolved.as_ref().map_or_else(
        || marked.map_or("normal", |value| value.role.as_str()),
        |value| value.role.as_str(),
    );
    if let Some(resolved) = &resolved {
        visual.color = Some(
            resolved
                .color
                .unwrap_or(design.primary)
                .mix(design.accent, resolved.color_mix),
        );
    } else if role != "normal" {
        visual.color = Some(
            marked
                .and_then(|value| value.color)
                .unwrap_or(design.accent),
        );
    }
    visual.opacity = resolved.as_ref().map(|value| value.opacity);

    let family =
        caption_recipe_design_descriptor(design).map(|descriptor| descriptor.family.as_str());
    match family {
        Some("highlight")
            if resolved
                .as_ref()
                .is_some_and(|value| value.plate_progress > 0.001) =>
        {
            visual.background = Some(design.accent);
            visual.border_radius_em = resolved.as_ref().map(|value| value.plate_radius);
        }
        Some("pillKaraoke")
            if resolved
                .as_ref()
                .is_some_and(|value| value.plate_progress > 0.001) =>
        {
            visual.background = Some(design.accent);
            visual.border_radius_em = resolved.as_ref().map(|value| value.plate_radius);
        }
        _ => {}
    }
    visual
}

pub fn word_visual(
    animation: &WordAnimation,
    item: &TimedItem,
    index: usize,
    current: usize,
    time: f64,
    fps: f64,
) -> WordVisual {
    if animation.caption.is_none()
        && let Some(id) = animation.motion_id.as_deref()
    {
        let frame = motion_for_item(id, item, time);
        if let Some(pose) = frame.words.get(index) {
            let mut visual = WordVisual::default();
            visual.opacity = Some(pose.opacity);
            if pose.tint {
                visual.color = animation
                    .active
                    .color
                    .or(animation.spoken.color)
                    .or_else(|| parse_css_color("#FFD43B"));
            }
            if let Some(chip) = pose.chip {
                visual.background = animation
                    .active
                    .background
                    .or_else(|| parse_css_color("#FFD43B"));
                visual.box_scale = Some(chip.scale);
                visual.box_opacity = Some(chip.alpha);
                visual.border_radius_em = Some(chip.corner_rounding);
                visual.color = animation.active.color;
            }
            return visual;
        }
    }
    animation.caption.as_ref().map_or_else(
        || word_state(animation, index, current, word_phase(item, index, time)),
        |caption| designed_word_state(caption, item, index, time, fps),
    )
}

pub fn motion_for_item(id: &str, item: &TimedItem, time: f64) -> word_motion::MotionFrame {
    let words = item
        .words
        .iter()
        .map(|word| {
            (
                word.start - item.display_start,
                word.end - item.display_start,
            )
        })
        .collect::<Vec<_>>();
    word_motion::motion_frame_seeded(
        id,
        time - item.display_start,
        item.display_end - item.display_start,
        &words,
        item.series_index,
        word_motion::item_seed(&item.id),
    )
}

#[derive(Debug)]
pub struct TextRun {
    pub text: String,
    pub word: Option<usize>,
    pub start: usize,
}

pub fn timed_runs(text: &str, words: &[Word], transform: &str) -> Vec<TextRun> {
    // Locate timing spans in the original cue first. Searching the transformed cue for each
    // independently transformed word is not stable: title case depends on the preceding cue
    // character, and Unicode case conversion may change byte lengths. Transform the located
    // runs afterwards with one shared capitalize state so their concatenation is byte-for-byte
    // identical to `transform_text(text, transform)` while word timing survives.
    let mut source_runs = Vec::new();
    let mut cursor = 0;
    for (index, word) in words.iter().enumerate() {
        if word.text.is_empty() {
            continue;
        }
        let Some(found) = text[cursor..]
            .find(&word.text)
            .map(|offset| cursor + offset)
        else {
            continue;
        };
        if found > cursor {
            source_runs.push((text[cursor..found].to_owned(), None));
        }
        let end = found + word.text.len();
        source_runs.push((text[found..end].to_owned(), Some(index)));
        cursor = end;
    }
    if cursor < text.len() {
        source_runs.push((text[cursor..].to_owned(), None));
    }
    if source_runs.is_empty() {
        source_runs.push((text.to_owned(), None));
    }

    let mut runs = Vec::with_capacity(source_runs.len());
    let mut output_cursor = 0;
    let mut capitalize_next = true;
    for (source, word) in source_runs {
        let transformed = transform_text_chunk(&source, transform, &mut capitalize_next);
        if !transformed.is_empty() {
            let start = output_cursor;
            output_cursor += transformed.len();
            runs.push(TextRun {
                text: transformed,
                word,
                start,
            });
        }
    }
    if runs.is_empty() {
        runs.push(TextRun {
            text: String::new(),
            word: None,
            start: 0,
        });
    }
    runs
}

// 元素几何 → DrawOp 的纯组装在 P6a 整块下沉进 `bcut-timeline-render`
// （设计 §9.1；`git mv` 搬迁，函数体一字未改）。本文件从此只调用它。
use timeline_render as element_draw;
