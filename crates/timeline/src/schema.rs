use std::collections::{BTreeMap, HashSet};
use std::error::Error;
use std::fmt::{self, Display, Formatter};

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};

use crate::template::TemplateDoc;

/// 写出版本。读取兼容 [`TIMELINE_VERSIONS`] 的每一个值，写出一律升到这里
/// （设计 `bcut-element-render-foundation-design.md` §5.3）。
pub use crate::protocol::versions::TIMELINE_CURRENT as TIMELINE_VERSION;

/// 可读版本（升序）。`0.1` 是 shape / sticker / visualizer / progress 四种
/// 元素转正之前的文档；它们没有任何新字段，因此升版是纯粹的版本字符串替换，
/// 不需要迁移脚本（ADR-E02「迁移负担为零」）。
pub use crate::protocol::versions::TIMELINE_SUPPORTED as TIMELINE_VERSIONS;

/// `element-props-mismatch`：`kind` 与四组元素 props 必须一一对应。
///
/// 这是 **timeline 侧的 schema 校验码**，不属于 `bcut-core` 的 `LINT_RULES`
/// 体系（那张表只登记 BCF / motion 侧诊断），所以只在本 crate 的测试里钉住。
pub const ELEMENT_PROPS_MISMATCH: &str = "element-props-mismatch";
/// 白板手绘元素引用了非 `image` 源（或 main 源）的诊断码（0.8）。
pub const WHITEBOARD_SOURCE_KIND: &str = "whiteboard-source-kind";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimelineError {
    UnsupportedVersion(String),
    Invalid(String),
    MissingSource(String),
    EmptyClip(String),
    Unmapped(String),
    Ambiguous(String),
}

impl Display for TimelineError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedVersion(version) => {
                write!(formatter, "不支持 timeline 版本 {version}")
            }
            Self::Invalid(message) => formatter.write_str(message),
            Self::MissingSource(id) => write!(formatter, "source 不存在：{id}"),
            Self::EmptyClip(id) => write!(formatter, "clip 扣除 cuts 后为空：{id}"),
            Self::Unmapped(id) => write!(formatter, "对象未映射到时间轴：{id}"),
            Self::Ambiguous(id) => write!(formatter, "对象在时间轴上有多个映射：{id}"),
        }
    }
}

impl Error for TimelineError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TimelineDocument {
    #[serde(rename = "bcutTimeline", deserialize_with = "deserialize_version")]
    pub version: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub sources: BTreeMap<String, Source>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub clips: Vec<Clip>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tracks: Vec<Track>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main: Option<Main>,
    /// 套在画面上的模板实例（0.4 新增）；`None` = 没套模板。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<TemplateDoc>,
}

impl Default for TimelineDocument {
    fn default() -> Self {
        Self {
            version: TIMELINE_VERSION.to_owned(),
            sources: BTreeMap::new(),
            clips: Vec::new(),
            tracks: Vec::new(),
            main: None,
            template: None,
        }
    }
}

/// 读取期就地升版：`0.1` / `0.2` / `0.3` → [`TIMELINE_VERSION`]。
///
/// 升版发生在**反序列化**而不是写盘那一刻，因为写路径散落在 CLI / serve /
/// 客户端里，只有反序列化是所有读者的唯一入口。未知版本原样保留，交给
/// [`TimelineDocument::validate`] 报 [`TimelineError::UnsupportedVersion`]——
/// 换成 serde 层报错会把版本错误从 `TimelineError` 降格成 serde 文本错误。
fn deserialize_version<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let raw = String::deserialize(deserializer)?;
    Ok(if TIMELINE_VERSIONS.contains(&raw.as_str()) {
        TIMELINE_VERSION.to_owned()
    } else {
        raw
    })
}

impl TimelineDocument {
    /// 把与项目主媒体同一文件（`hash` 相同）的已登记音视频源并回 `main`。
    ///
    /// 空白项目先 `clip add narration.wav`（登记成 `src-aN`）、再对同一文件转录
    /// 设成项目媒体时，主轨 clip 仍指着副本源；而 `transcript.json` 的词只属于
    /// `main`，投影找不到承载它们的 clip，字幕在舞台与导出里整层消失。副本源与
    /// `main` 是同一份媒体，改引用不改变画面与声音。两边都有 cuts 时无法无损合并，
    /// 保持原样。返回被并掉的源 id。
    pub fn fold_main_duplicates(&mut self, main_hash: Option<&str>) -> Vec<String> {
        let Some(main_hash) = main_hash.filter(|hash| !hash.is_empty()) else {
            return Vec::new();
        };
        let duplicates: Vec<String> = self
            .sources
            .iter()
            .filter(|(id, source)| {
                id.as_str() != "main"
                    && source.hash.as_deref() == Some(main_hash)
                    && matches!(
                        source.kind,
                        None | Some(SourceKind::Audio) | Some(SourceKind::Video)
                    )
            })
            .map(|(id, _)| id.clone())
            .collect();
        let mut folded = Vec::new();
        for id in duplicates {
            let main_has_cuts = self
                .sources
                .get("main")
                .is_some_and(|main| !main.cuts.is_empty());
            let cuts = self.sources[&id].cuts.clone();
            if main_has_cuts && !cuts.is_empty() {
                continue;
            }
            self.sources.remove(&id);
            if !cuts.is_empty() {
                self.sources.entry("main".to_owned()).or_default().cuts = cuts;
            }
            for clip in &mut self.clips {
                if clip.src_id == id {
                    clip.src_id = "main".to_owned();
                }
            }
            for element in self.tracks.iter_mut().flat_map(|track| &mut track.elements) {
                if element.src_id.as_deref() == Some(id.as_str()) {
                    element.src_id = Some("main".to_owned());
                }
            }
            folded.push(id);
        }
        folded
    }

    pub fn validate(&self) -> Result<(), TimelineError> {
        if self.version != TIMELINE_VERSION {
            return Err(TimelineError::UnsupportedVersion(self.version.clone()));
        }
        let mut ids = HashSet::new();
        for (source_id, source) in &self.sources {
            validate_id("source", source_id)?;
            unique_id(&mut ids, source_id)?;
            if source_id == "main" && source.has_identity_fields() {
                return Err(TimelineError::Invalid(
                    "main source 的媒体身份必须只存在于 project.json".to_owned(),
                ));
            }
            source.validate(source_id, &mut ids)?;
        }
        for clip in &self.clips {
            validate_id("clip", &clip.id)?;
            unique_id(&mut ids, &clip.id)?;
            if !clip.in_time.is_finite()
                || !clip.out.is_finite()
                || clip.in_time < 0.0
                || clip.out <= clip.in_time
                || !clip.rate.is_finite()
                || clip.rate <= 0.0
            {
                return Err(TimelineError::Invalid(format!(
                    "clip {} 的区间或 rate 非法",
                    clip.id
                )));
            }
            if clip.src_id != "main" {
                let Some(source) = self.sources.get(&clip.src_id) else {
                    return Err(TimelineError::MissingSource(clip.src_id.clone()));
                };
                if source.kind == Some(SourceKind::Lottie) {
                    return Err(TimelineError::Invalid(format!(
                        "clip {} 引用的 source {} 是 lottie，Lottie 只能作为贴纸元素的素材",
                        clip.id, clip.src_id
                    )));
                }
            }
        }
        for track in &self.tracks {
            validate_id("track", &track.id)?;
            unique_id(&mut ids, &track.id)?;
            for element in &track.elements {
                element.validate(&mut ids)?;
                let media_kind = matches!(
                    element.kind,
                    ElementKind::Image
                        | ElementKind::Video
                        | ElementKind::Audio
                        | ElementKind::Whiteboard
                );
                if media_kind && element.src_id.is_none() {
                    return Err(TimelineError::Invalid(format!(
                        "媒体元素 {} 缺少 srcId",
                        element.id
                    )));
                }
                if let Some(source_id) = &element.src_id
                    && source_id != "main"
                {
                    let Some(source) = self.sources.get(source_id) else {
                        return Err(TimelineError::MissingSource(source_id.clone()));
                    };
                    if source.kind == Some(SourceKind::Lottie) && !element.is_asset_sticker() {
                        return Err(TimelineError::Invalid(format!(
                            "元素 {} 引用的 source {} 是 lottie，只有 sticker.source=\"asset\" 的贴纸元素可以引用",
                            element.id, source_id
                        )));
                    }
                    if element.kind == ElementKind::Whiteboard
                        && source.kind.is_some_and(|kind| kind != SourceKind::Image)
                    {
                        return Err(TimelineError::Invalid(format!(
                            "元素 {} 引用的 source {} 不是 image，白板手绘只接受静态图片源（{WHITEBOARD_SOURCE_KIND}）",
                            element.id, source_id
                        )));
                    }
                } else if element.kind == ElementKind::Whiteboard {
                    return Err(TimelineError::Invalid(format!(
                        "元素 {} 是白板手绘，不能引用 main 源（{WHITEBOARD_SOURCE_KIND}）",
                        element.id
                    )));
                }
                if (track.kind == TrackKind::Audio) != (element.kind == ElementKind::Audio) {
                    return Err(TimelineError::Invalid(format!(
                        "track {} 的 kind 与 element {} 不匹配",
                        track.id, element.id
                    )));
                }
            }
        }
        for track in &self.tracks {
            for element in &track.elements {
                let Some(duck) = &element.duck else {
                    continue;
                };
                if duck.is_speech() {
                    continue;
                }
                if duck.under == track.id {
                    return Err(TimelineError::Invalid(format!(
                        "element {} 的 duck.under 不能是它自己所在的轨 {}",
                        element.id, track.id
                    )));
                }
                if !self.tracks.iter().any(|other| other.id == duck.under) {
                    return Err(TimelineError::Invalid(format!(
                        "element {} 的 duck.under 指向不存在的轨：{}",
                        element.id, duck.under
                    )));
                }
            }
        }
        if let Some(template) = &self.template {
            crate::template::validate(template)?;
        }
        if self.main.as_ref().is_some_and(|main| {
            main.detached
                && (!main.muted || main.place.as_ref().and_then(|place| place.opacity) != Some(0.0))
        }) {
            return Err(TimelineError::Invalid(
                "detached main 必须 muted=true 且 place.opacity=0；请编辑普通视频元素".into(),
            ));
        }
        if self
            .main
            .as_ref()
            .and_then(|main| main.source_duration)
            .is_some_and(|duration| !duration.is_finite() || duration <= 0.0)
        {
            return Err(TimelineError::Invalid(
                "main.sourceDuration 必须是正有限数".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<SourceKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub natural_w: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub natural_h: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_audio: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cuts: Vec<Cut>,
    /// 素材从哪来（0.11 新增）：目前只有 `"ai"`（图像生成的结果，素材卡出 ✦ 徽标，
    /// 图像生成设计稿 §7.5）。缺省 = 导入的普通素材。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    /// 出处侧车路径（0.11 新增）：与 `path` 同一套相对 / 绝对规则，指向同名 `.json`
    /// （`{"kind":"image-gen","v":1,…}`，`bcut_image::ImageProvenance`）。缺省 = 没有侧车。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<String>,
}

/// `Source.origin` 的闭集（0.11）。
pub const SOURCE_ORIGINS: &[&str] = &["ai"];

impl Source {
    fn has_identity_fields(&self) -> bool {
        self.path.is_some()
            || self.hash.is_some()
            || self.kind.is_some()
            || self.duration.is_some()
            || self.natural_w.is_some()
            || self.natural_h.is_some()
            || self.has_audio.is_some()
            || self.poster.is_some()
    }

    fn validate(&self, source_id: &str, ids: &mut HashSet<String>) -> Result<(), TimelineError> {
        if let Some(origin) = &self.origin
            && !SOURCE_ORIGINS.contains(&origin.as_str())
        {
            return Err(TimelineError::Invalid(format!(
                "source {source_id} 的 origin 只能是 {}",
                SOURCE_ORIGINS.join(" / ")
            )));
        }
        if self
            .provenance
            .as_deref()
            .is_some_and(|path| path.trim().is_empty())
        {
            return Err(TimelineError::Invalid(format!(
                "source {source_id} 的 provenance 不能为空"
            )));
        }
        let mut previous_end = -f64::INFINITY;
        for cut in &self.cuts {
            validate_id("cut", &cut.id)?;
            unique_id(ids, &cut.id)?;
            if !cut.t0.is_finite() || !cut.t1.is_finite() || cut.t0 < 0.0 || cut.t1 <= cut.t0 {
                return Err(TimelineError::Invalid(format!(
                    "source {source_id} 的 cut {} 区间非法",
                    cut.id
                )));
            }
            if cut.t0 < previous_end {
                return Err(TimelineError::Invalid(format!(
                    "source {source_id} 的 cuts 必须排序且不重叠"
                )));
            }
            if let Some(duration) = self.duration
                && cut.t1 > duration
            {
                return Err(TimelineError::Invalid(format!(
                    "cut {} 超过 source {source_id} 时长",
                    cut.id
                )));
            }
            previous_end = cut.t1;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Video,
    Image,
    Audio,
    /// bodymovin / Lottie JSON 动画（0.7 起）。只能被 `kind:"sticker"` +
    /// `sticker.source:"asset"` 的元素引用；不能作主轨 clip，也不能挂到
    /// `image` / `video` / `audio` 元素上。`duration` 取动画帧表末尾，
    /// `naturalW/H` 取 `w`/`h`，`hasAudio` 恒 false。
    Lottie,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Cut {
    pub id: String,
    pub t0: f64,
    pub t1: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#ref: Option<String>,
}

fn default_main() -> String {
    "main".to_owned()
}

fn is_main(value: &str) -> bool {
    value == "main"
}

fn default_rate() -> f64 {
    1.0
}

fn is_one(value: &f64) -> bool {
    (*value - 1.0).abs() <= f64::EPSILON
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Clip {
    pub id: String,
    #[serde(default = "default_main", skip_serializing_if = "is_main")]
    pub src_id: String,
    #[serde(rename = "in")]
    pub in_time: f64,
    pub out: f64,
    #[serde(default = "default_rate", skip_serializing_if = "is_one")]
    pub rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Track {
    pub id: String,
    pub kind: TrackKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub locked: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub muted: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub elements: Vec<Element>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    Overlay,
    Audio,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum TimeValue {
    Seconds(f64),
    Anchor(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Element {
    pub id: String,
    pub kind: ElementKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<ElementRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<TimeValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<TimeValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub place: Option<Place>,
    /// 垂直锚点：`place.y` 钉住文本块的哪条边（`"top" | "center" | "bottom"`）。
    ///
    /// 与 x/y/rot 并排存在元素记录上，**不放进 `style`**——锚点是几何不是外观，
    /// 样式预设不能因为夹带一个锚点就把元素搬走。缺席 = center = 历史行为，
    /// 老文档因此零迁移。（`style.verticalAlign` 是从未被任何渲染路径消费过的
    /// 死字段，不要复活它。）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src_start: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub muted: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<f64>,
    /// 音频淡入 / 淡出秒数。仅 audio / video 消费；缺省为 0。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_fade_in: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_fade_out: Option<f64>,
    /// `kind == "audio"` 且由动画项目旁白导入：认领的 BCF 音频 clip id（0.10 新增，
    /// 配音版设计稿 §7.2）。合成音频（播放与 studio 导出混音）剔掉被认领的 clip，
    /// 元素删掉 / 撤销后 clip 自动回到合成音频里。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bcf_clip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<VisualMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fit: Option<Fit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<Background>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_preset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tile: Option<Tile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<Mask>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fx: Option<Fx>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animate: Option<Animation>,
    /// Independent video entry/exit transitions; never replaces `animate`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transitions: Option<crate::video_transitions::VideoTransitions>,
    /// 关键帧（0.12）：属性 → `{t, v, ease?}` 串，取样值取代该属性的静态值。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyframes: Option<crate::keyframes::Keyframes>,
    /// 闪避（0.12）：仅 audio / video。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duck: Option<crate::duck::Duck>,
    /// 图片水印来源（`file` / `html`）。渲染仍只消费 `srcId`；该字段用于
    /// 编辑器判断能否重新打开 HTML 片段。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// `source == html` 时保留的原始片段；实际逐帧渲染使用已注册的 PNG 源。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai: Option<Value>,
    /// `kind == "text"` 的动态计时文本。与 `text` 严格互斥。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub counter: Option<CounterProps>,
    /// `kind == "shape"` 的形状参数（0.2 新增）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<ShapeProps>,
    /// `kind == "sticker"` 的贴纸来源（0.2 新增）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sticker: Option<StickerProps>,
    /// `kind == "visualizer"` 的音频可视化参数（0.2 新增）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visualizer: Option<VisualizerProps>,
    /// `kind == "progress"` 的进度条参数（0.2 新增）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<ProgressProps>,
    /// `kind == "draw"` 的自由绘制笔迹（0.3 新增）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draw: Option<DrawProps>,
    /// `kind == "placeholder"` 的媒体占位框（0.3 新增）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<PlaceholderProps>,
    /// `kind == "confetti"` 的算法彩纸参数（0.6 新增，设计稿 §3）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confetti: Option<ConfettiProps>,
    /// `kind == "whiteboard"` 的白板手绘参数（0.8 新增，设计稿 §3）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub whiteboard: Option<WhiteboardProps>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub hidden: bool,
}

impl Element {
    /// `kind:"sticker"` 且 `sticker.source:"asset"`：素材贴纸，`srcId` 指向
    /// `sources{}` 里的 image / video / lottie 源（0.7 起 lottie 只能由它引用）。
    pub fn is_asset_sticker(&self) -> bool {
        self.kind == ElementKind::Sticker
            && self
                .sticker
                .as_ref()
                .is_some_and(|props| props.source == STICKER_SOURCE_ASSET)
    }

    /// 单个元素的字段校验（适用范围、props 一一对应、role 与 kind、动画预设表、取值区间），
    /// 不看文档里的其他元素。v3 的 VideoEngine 写入实例时调它，不另写一份。
    pub fn validate_fields(&self) -> Result<(), TimelineError> {
        self.validate(&mut HashSet::new())
    }

    fn validate(&self, ids: &mut HashSet<String>) -> Result<(), TimelineError> {
        validate_id("element", &self.id)?;
        unique_id(ids, &self.id)?;
        for time in [&self.start, &self.end].into_iter().flatten() {
            match time {
                TimeValue::Seconds(value) if !value.is_finite() || *value < 0.0 => {
                    return Err(TimelineError::Invalid(format!(
                        "element {} 的时间非法",
                        self.id
                    )));
                }
                TimeValue::Anchor(anchor) if !valid_anchor(anchor) => {
                    return Err(TimelineError::Invalid(format!(
                        "element {} 的词锚点非法：{anchor}",
                        self.id
                    )));
                }
                _ => {}
            }
        }
        if self.kind == ElementKind::Audio && self.animate.is_some() {
            return Err(TimelineError::Invalid(format!(
                "audio element {} 不支持动画",
                self.id
            )));
        }
        if let (Some(TimeValue::Seconds(start)), Some(TimeValue::Seconds(end))) =
            (&self.start, &self.end)
            && end <= start
        {
            return Err(TimelineError::Invalid(format!(
                "element {} 的 end 必须晚于 start",
                self.id
            )));
        }
        if self.kind == ElementKind::Text && self.text.is_none() && self.counter.is_none() {
            return Err(TimelineError::Invalid(format!(
                "text element {} 必须带 text 或 counter",
                self.id
            )));
        }
        if self.kind == ElementKind::Text && self.text.is_some() && self.counter.is_some() {
            return Err(TimelineError::Invalid(format!(
                "text element {} 的 text 与 counter 必须互斥",
                self.id
            )));
        }
        let is_text = self.kind == ElementKind::Text;
        let is_asset_sticker = self.is_asset_sticker();
        // 白板手绘是一张走 `render_media_element` 的图（0.8）：mode / fit / bg /
        // mask / fx 与 image 同一套消费路径（设计稿 §3：`mode: fullscreen` 铺满画布）。
        let is_visual_media = matches!(
            self.kind,
            ElementKind::Image
                | ElementKind::Video
                | ElementKind::Placeholder
                | ElementKind::Whiteboard
        ) || is_asset_sticker;
        let is_media = matches!(
            self.kind,
            ElementKind::Image | ElementKind::Video | ElementKind::Audio
        );
        if is_media && self.src_id.is_none() {
            return Err(TimelineError::Invalid(format!(
                "{} element {} 缺少 srcId",
                self.kind.as_str(),
                self.id
            )));
        }
        self.validate_props()?;
        if let Some(transitions) = &self.transitions {
            if self.kind != ElementKind::Video {
                return Err(TimelineError::Invalid(
                    "transitions only applies to video elements".into(),
                ));
            }
            transitions.validate()?;
        }
        if is_text
            && (self.src_id.is_some()
                || self.src_start.is_some()
                || self.rate.is_some()
                || self.muted.is_some()
                || self.volume.is_some()
                || self.audio_fade_in.is_some()
                || self.audio_fade_out.is_some()
                || self.mode.is_some()
                || self.fit.is_some()
                || self.bg.is_some()
                || self.mask.is_some()
                || self.fx.is_some())
        {
            return Err(TimelineError::Invalid(format!(
                "text element {} 带有不适用的媒体字段",
                self.id
            )));
        }
        if !is_text
            && (self.text.is_some()
                || self.counter.is_some()
                || self.style.is_some()
                || self.style_preset_id.is_some())
        {
            return Err(TimelineError::Invalid(format!(
                "非 text element {} 带有文本字段",
                self.id
            )));
        }
        if self.kind != ElementKind::Image && (self.source.is_some() || self.html.is_some()) {
            return Err(TimelineError::Invalid(format!(
                "非 image element {} 带有 source/html",
                self.id
            )));
        }
        if self
            .source
            .as_deref()
            .is_some_and(|source| !matches!(source, "file" | "html"))
        {
            return Err(TimelineError::Invalid(format!(
                "image element {} 的 source 不是 file/html",
                self.id
            )));
        }
        if self.html.is_some() && self.source.as_deref() != Some("html") {
            return Err(TimelineError::Invalid(format!(
                "image element {} 的 html 必须配合 source=html",
                self.id
            )));
        }
        if !is_visual_media && (self.mode.is_some() || self.fit.is_some() || self.bg.is_some()) {
            return Err(TimelineError::Invalid(format!(
                "element {} 的 mode/fit/bg 只适用于 image/video",
                self.id
            )));
        }
        if !matches!(self.kind, ElementKind::Text | ElementKind::Image) && self.tile.is_some() {
            return Err(TimelineError::Invalid(format!(
                "element {} 的 tile 只适用于 text/image",
                self.id
            )));
        }
        if !is_visual_media && (self.mask.is_some() || self.fx.is_some()) {
            return Err(TimelineError::Invalid(format!(
                "element {} 的 mask/fx 只适用于 image/video",
                self.id
            )));
        }
        if self.kind == ElementKind::Audio && self.place.is_some() {
            return Err(TimelineError::Invalid(format!(
                "audio element {} 不支持 place",
                self.id
            )));
        }
        if !matches!(self.kind, ElementKind::Audio | ElementKind::Video)
            && (self.audio_fade_in.is_some() || self.audio_fade_out.is_some())
        {
            return Err(TimelineError::Invalid(format!(
                "element {} 的 audioFadeIn/audioFadeOut 只适用于 audio/video",
                self.id
            )));
        }
        if let Some(keyframes) = &self.keyframes {
            keyframes.validate(
                &self.id,
                crate::keyframes::KeyframeCaps::for_kind(&self.kind, is_visual_media),
            )?;
        }
        if let Some(duck) = &self.duck {
            if !matches!(self.kind, ElementKind::Audio | ElementKind::Video) {
                return Err(TimelineError::Invalid(format!(
                    "element {} 的 duck 只适用于 audio/video",
                    self.id
                )));
            }
            duck.validate(&self.id)?;
        }
        if let Some(clip) = &self.bcf_clip
            && (self.kind != ElementKind::Audio || clip.trim().is_empty())
        {
            return Err(TimelineError::Invalid(format!(
                "element {} 的 bcfClip 只适用于 audio，且不能为空",
                self.id
            )));
        }
        for (name, value) in [
            ("audioFadeIn", self.audio_fade_in),
            ("audioFadeOut", self.audio_fade_out),
        ] {
            if let Some(value) = value
                && (!value.is_finite()
                    || !(AUDIO_FADE_RANGE.0..=AUDIO_FADE_RANGE.1).contains(&value))
            {
                return Err(TimelineError::Invalid(format!(
                    "element {} 的 {name} 须在 0..=5 秒",
                    self.id
                )));
            }
        }
        if let Some(role) = self.role {
            let compatible = match role {
                ElementRole::Broll => matches!(self.kind, ElementKind::Image | ElementKind::Video),
                ElementRole::Watermark => matches!(
                    self.kind,
                    ElementKind::Text
                        | ElementKind::Image
                        | ElementKind::Video
                        | ElementKind::Sticker
                ),
                ElementRole::Screentext => self.kind == ElementKind::Text,
                ElementRole::Overlay | ElementRole::Frame => matches!(
                    self.kind,
                    ElementKind::Image | ElementKind::Video | ElementKind::Sticker
                ),
            };
            if !compatible {
                return Err(TimelineError::Invalid(format!(
                    "element {} 的 role 与 kind={} 不匹配",
                    self.id,
                    self.kind.as_str()
                )));
            }
        }
        if self.tile.as_ref().is_some_and(|tile| !tile.on) {
            return Err(TimelineError::Invalid(format!(
                "element {} 的 tile.on=false 应删除整个 tile 字段",
                self.id
            )));
        }
        if self.kind != ElementKind::Text
            && self.animate.as_ref().is_some_and(|animation| {
                [animation.enter.as_ref(), animation.exit.as_ref()]
                    .into_iter()
                    .flatten()
                    .any(|slot| matches!(slot.preset.as_str(), "typewriter" | "riseWords"))
            })
        {
            return Err(TimelineError::Invalid(format!(
                "element {} 的 typewriter/riseWords 只适用于 text",
                self.id
            )));
        }
        if self.counter.is_some()
            && self.animate.as_ref().is_some_and(|animation| {
                [animation.enter.as_ref(), animation.exit.as_ref()]
                    .into_iter()
                    .flatten()
                    .any(|slot| matches!(slot.preset.as_str(), "typewriter" | "riseWords"))
            })
        {
            return Err(TimelineError::Invalid(format!(
                "counter element {} 不支持 typewriter/riseWords",
                self.id
            )));
        }
        if let Some(place) = &self.place {
            place.validate(&self.id)?;
        }
        for (name, value) in [
            ("srcStart", self.src_start),
            ("rate", self.rate),
            ("volume", self.volume),
        ] {
            if let Some(value) = value
                && (!value.is_finite()
                    || (name != "volume" && value < 0.0)
                    || (name == "rate" && value == 0.0))
            {
                return Err(TimelineError::Invalid(format!(
                    "element {} 的 {name} 非法",
                    self.id
                )));
            }
        }
        if let Some(animation) = &self.animate {
            animation.validate(&self.id)?;
        }
        if let Some(fx) = &self.fx {
            fx.validate(&self.id)?;
        }
        Ok(())
    }

    /// `kind` 与六组 props 一一对应（§5.1 互斥规则）。出现不匹配的 props
    /// 直接报错、不静默忽略：静默忽略等于让用户的形状定义消失。
    fn validate_props(&self) -> Result<(), TimelineError> {
        let expected = self.kind.props_field();
        for (field, present) in [
            ("shape", self.shape.is_some()),
            ("sticker", self.sticker.is_some()),
            ("visualizer", self.visualizer.is_some()),
            ("progress", self.progress.is_some()),
            ("draw", self.draw.is_some()),
            ("placeholder", self.placeholder.is_some()),
            ("confetti", self.confetti.is_some()),
            ("whiteboard", self.whiteboard.is_some()),
        ] {
            if present && expected != Some(field) {
                return Err(TimelineError::Invalid(format!(
                    "element {} 的 kind={} 不接受 {field} props（{ELEMENT_PROPS_MISMATCH}）",
                    self.id,
                    self.kind.as_str()
                )));
            }
            if !present && expected == Some(field) {
                return Err(TimelineError::Invalid(format!(
                    "element {} 的 kind={} 缺少 {field} props（{ELEMENT_PROPS_MISMATCH}）",
                    self.id,
                    self.kind.as_str()
                )));
            }
        }
        if let Some(shape) = &self.shape {
            shape.validate(&self.id)?;
        }
        if let Some(sticker) = &self.sticker {
            sticker.validate(&self.id)?;
        }
        if let Some(visualizer) = &self.visualizer {
            visualizer.validate(&self.id)?;
        }
        if let Some(progress) = &self.progress {
            progress.validate(&self.id)?;
        }
        if let Some(draw) = &self.draw {
            draw.validate(&self.id)?;
        }
        if let Some(placeholder) = &self.placeholder {
            placeholder.validate(&self.id)?;
        }
        if let Some(confetti) = &self.confetti {
            confetti.validate(&self.id)?;
        }
        if let Some(whiteboard) = &self.whiteboard {
            whiteboard.validate(&self.id)?;
        }
        if let Some(counter) = &self.counter {
            counter.validate(&self.id)?;
        }
        Ok(())
    }
}

/// 元素种类。**封闭枚举 + 版本门**：未知 kind 在解析期报错，不做 open enum
/// （ADR-E02）——静默把未知 kind 渲染成空会让"我加的形状不见了"变成常态。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ElementKind {
    // 0.1 既有
    Text,
    Image,
    Video,
    Audio,
    // 0.2 新增（ADR-E02）
    Shape,
    Sticker,
    /// 音频频谱可视化。**顶层 kind，不是 sticker 子类型**——数据源与属性面板
    /// 都与贴纸无关（ADR-E02）。
    Visualizer,
    Progress,
    // 0.3 新增
    Draw,
    Placeholder,
    /// 算法彩纸粒子（0.6 新增）。**顶层 kind，不是 sticker 子类型**：无 `srcId`，
    /// 整帧由 `confetti-v1` 运动核按 `(props, t)` 闭式算出（设计稿 ADR-CF01）。
    Confetti,
    /// 白板手绘（0.8 新增）。**顶层 kind**，走 image 同款的宿主光栅路线：必须有
    /// `srcId` 且源是 `image`，像素由内核在渲染期从源图推导揭示场后逐帧求值
    /// （`bcut-whiteboard-animation-design.md` ADR-WB01 / WB02）。
    Whiteboard,
}

impl ElementKind {
    /// serde 名（诊断信息与 JSON Schema 共用同一张表）。
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Image => "image",
            Self::Video => "video",
            Self::Audio => "audio",
            Self::Shape => "shape",
            Self::Sticker => "sticker",
            Self::Visualizer => "visualizer",
            Self::Progress => "progress",
            Self::Draw => "draw",
            Self::Placeholder => "placeholder",
            Self::Confetti => "confetti",
            Self::Whiteboard => "whiteboard",
        }
    }

    /// 带 props 子对象的元素：kind 与同名 props 一一对应。
    pub const fn props_field(self) -> Option<&'static str> {
        match self {
            Self::Shape => Some("shape"),
            Self::Sticker => Some("sticker"),
            Self::Visualizer => Some("visualizer"),
            Self::Progress => Some("progress"),
            Self::Draw => Some("draw"),
            Self::Placeholder => Some("placeholder"),
            Self::Confetti => Some("confetti"),
            Self::Whiteboard => Some("whiteboard"),
            _ => None,
        }
    }
}

pub const ELEMENT_KINDS: &[&str] = &[
    "text",
    "image",
    "video",
    "audio",
    "shape",
    "sticker",
    "visualizer",
    "progress",
    "draw",
    "placeholder",
    // 0.6 新增
    "confetti",
    // 0.8 新增
    "whiteboard",
];

/// `audioFadeIn` / `audioFadeOut` 的区间（秒）。
pub const AUDIO_FADE_RANGE: (f64, f64) = (0.0, 5.0);
/// `verticalAlign` 的封闭取值；缺席 = `center`。
pub const VERTICAL_ALIGNS: &[&str] = &["top", "center", "bottom"];
/// `ShapeProps.strokeWidth` 缺省（`ElementModels.swift:205-215`）。
pub const SHAPE_STROKE_WIDTH_DEFAULT: f64 = 2.0;
/// 首批形状名。P7 分批扩到 23 种基础形状；真相是 preset 注册表的
/// `Domain::TimelineShape` 目录，这里只是给 schema 与诊断用的镜像。
pub const SHAPE_NAMES: &[&str] = &["rect", "ellipse", "line", "arrow"];
/// `ShapeProps.head` 的封闭取值。
pub const SHAPE_HEADS: &[&str] = &["arrow", "none"];
/// `StickerProps.source` 的两个面值。**内置模板库**（`core/presets/builtin/
/// sticker/`，矢量直出）与 **timeline sources 里的资产**（PNG / JPEG / SVG /
/// 带 alpha 的循环 WebM，host 解码）走两条完全不同的渲染通路，所以判断源类型
/// 的地方一律引这两个常量而不是写字面量。
pub const STICKER_SOURCE_TEMPLATE: &str = "template";
pub const STICKER_SOURCE_ASSET: &str = "asset";
/// `StickerProps.source` 的封闭取值。
pub const STICKER_SOURCES: &[&str] = &[STICKER_SOURCE_TEMPLATE, STICKER_SOURCE_ASSET];
/// `StickerProps.loop` 的三个面值（P7b 起真正被消费：资产是视频时决定
/// 媒体时刻怎么取——循环 / 播一次停末帧 / 定格首帧）。
pub const STICKER_LOOP_LOOP: &str = "loop";
pub const STICKER_LOOP_ONCE: &str = "once";
pub const STICKER_LOOP_HOLD: &str = "hold";
/// `StickerProps.loop` 的封闭取值与缺省。
pub const STICKER_LOOPS: &[&str] = &[STICKER_LOOP_LOOP, STICKER_LOOP_ONCE, STICKER_LOOP_HOLD];
pub const STICKER_LOOP_DEFAULT: &str = STICKER_LOOP_LOOP;
/// `VisualizerProps` 的缺省——取**新建默认**这一组（§5.2）。
pub const VISUALIZER_FFT_SIZES: &[u32] = &[256, 512, 1024, 2048];
pub const VISUALIZER_FFT_SIZE_DEFAULT: u32 = 1024;
/// dB 窗的**全表兜底**：注册表里查不到这一款样式时才用。真正的缺省按款取，
/// 见 [`visualizer_db_window`]——10 款里有 2 款（`oscilloscope` / `ring_wave`）
/// 用的是 −120 / −10 那扇窗。
pub const VISUALIZER_MIN_DB_DEFAULT: f64 = -80.0;
pub const VISUALIZER_MAX_DB_DEFAULT: f64 = 40.0;
pub const VISUALIZER_SMOOTHING_DEFAULT: f64 = 0.8;
/// BaoCut 自有字段，来自 Mac `WaveformConfig`；重映射后、绘制前相乘。
pub const VISUALIZER_GAIN_DEFAULT: f64 = 1.0;
pub const VISUALIZER_AUDIO_DEFAULT: &str = "project";

/// 一款声波自带的 dB 窗（`core/presets/builtin/visualizer/*.json` 的
/// `defaultMinDb` / `defaultMaxDb`），也就是元素没写 `minDb` / `maxDb` 时的缺省。
///
/// **按款取而不是全表一个数**，与 `mainColor` 的兜底（`bcut-editor-core` 的
/// `visualizer_defaults`）同一条口径：读时域行的 `oscilloscope-v1` 两款
/// （`oscilloscope` / `ring_wave`）配的是 −120 / −10 这扇窄而热的窗——时域行
/// 逐字节原样搬运，dB 窗对它只是注册表里的标签，但保留这一对能让属性面板的
/// Min / Max dB 读数与配方声明一致；其余 8 款读频域行，用 −80 / 40。
/// 拿错一扇窗去画频谱类样式，同一个 dB 值映射出来的归一化幅度会差一倍上下。
///
/// 注册表里查不到这一款时回落到 [`VISUALIZER_MIN_DB_DEFAULT`] /
/// [`VISUALIZER_MAX_DB_DEFAULT`]——那种元素本来也过不了 `style` 校验。
pub fn visualizer_db_window(style: &str) -> (f64, f64) {
    ::motion::preset_registry::timeline_visualizer(style)
        .and_then(|recipe| recipe.visualizer())
        .map(|body| (body.default_min_db, body.default_max_db))
        .unwrap_or((VISUALIZER_MIN_DB_DEFAULT, VISUALIZER_MAX_DB_DEFAULT))
}

/// `kind == "shape"` 的形状参数（设计 §5.2）。
///
/// `shape` 名的真相是 preset 注册表的目录型配方（ADR-E05）；schema 层只保证
/// 它是非空字符串，"引用了注册表里没有的形状"是 lint / resolve 期的
/// `preset-unknown`，不是这里的解析错误（§5.3 的两个时机两个码）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShapeProps {
    pub shape: String,
    /// `"#RRGGBB"` 或 `"#RRGGBBAA"`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<f64>,
    /// 四角独立（`[0,0,0,0]` 顺序）。Mac 历史上的单值
    /// `radius` 在读取期换算成 `[r,r,r,r]`；与 `Place.radius`（元素级圆角裁切）
    /// 是两件事，不合并。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corner_radius: Option<[f64; 4]>,
    /// 帧高 %；`None` = 正方（见 `geometry::element_height`）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<f64>,
    /// `line` / `arrow` 的端点，元素盒内 %。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x1: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y1: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x2: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y2: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
}

impl ShapeProps {
    pub fn new(shape: impl Into<String>) -> Self {
        Self {
            shape: shape.into(),
            fill: None,
            stroke: None,
            stroke_width: None,
            corner_radius: None,
            h: None,
            x1: None,
            y1: None,
            x2: None,
            y2: None,
            head: None,
        }
    }

    pub fn stroke_width(&self) -> f64 {
        self.stroke_width.unwrap_or(SHAPE_STROKE_WIDTH_DEFAULT)
    }

    pub fn corner_radius(&self) -> [f64; 4] {
        self.corner_radius.unwrap_or([0.0; 4])
    }

    /// `line` / `arrow` 的端点，元素盒内 0..100 %。缺省是盒子的水平中线。
    pub fn endpoints(&self) -> [f64; 4] {
        [
            self.x1.unwrap_or(0.0),
            self.y1.unwrap_or(50.0),
            self.x2.unwrap_or(100.0),
            self.y2.unwrap_or(50.0),
        ]
    }

    fn validate(&self, element_id: &str) -> Result<(), TimelineError> {
        if self.shape.trim().is_empty() {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 shape.shape 为空"
            )));
        }
        for (name, color) in [("fill", &self.fill), ("stroke", &self.stroke)] {
            if let Some(color) = color {
                validate_color(element_id, &format!("shape.{name}"), color)?;
            }
        }
        for (name, value) in [
            ("strokeWidth", self.stroke_width),
            ("h", self.h),
            ("x1", self.x1),
            ("y1", self.y1),
            ("x2", self.x2),
            ("y2", self.y2),
        ] {
            finite(element_id, &format!("shape.{name}"), value)?;
        }
        if self.stroke_width.is_some_and(|width| width < 0.0) {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 shape.strokeWidth 必须非负"
            )));
        }
        if let Some(radius) = self.corner_radius
            && radius
                .iter()
                .any(|value| !value.is_finite() || *value < 0.0)
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 shape.cornerRadius 必须是四个非负有限数"
            )));
        }
        if let Some(head) = &self.head
            && !SHAPE_HEADS.contains(&head.as_str())
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 shape.head 非法：{head}"
            )));
        }
        Ok(())
    }
}

/// `kind == "sticker"` 的贴纸来源（设计 §5.2）。**没有 waveform 子类型**——
/// 波形已经迁出为独立的 [`ElementKind::Visualizer`]（§5.4 废弃清单）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StickerProps {
    /// `"template"` | `"asset"`。
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// `"loop"` | `"once"` | `"hold"`，缺省 `"loop"`。
    #[serde(default, rename = "loop", skip_serializing_if = "Option::is_none")]
    pub r#loop: Option<String>,
    /// SVG 资产的精确颜色替换表：原始 `#RRGGBB[AA]` → 目标颜色。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fill_overrides: BTreeMap<String, String>,
}

impl StickerProps {
    pub fn new(source: impl Into<String>) -> Self {
        Self {
            source: source.into(),
            template_id: None,
            path: None,
            r#loop: None,
            fill_overrides: BTreeMap::new(),
        }
    }

    pub fn loop_mode(&self) -> &str {
        self.r#loop.as_deref().unwrap_or(STICKER_LOOP_DEFAULT)
    }

    fn validate(&self, element_id: &str) -> Result<(), TimelineError> {
        if !STICKER_SOURCES.contains(&self.source.as_str()) {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 sticker.source 非法：{}",
                self.source
            )));
        }
        if let Some(mode) = &self.r#loop
            && !STICKER_LOOPS.contains(&mode.as_str())
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 sticker.loop 非法：{mode}"
            )));
        }
        for (source, target) in &self.fill_overrides {
            validate_color(element_id, "sticker.fillOverrides key", source)?;
            validate_color(element_id, "sticker.fillOverrides value", target)?;
        }
        Ok(())
    }
}

/// `kind == "visualizer"` 的音频频谱参数（设计 §5.2）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisualizerProps {
    /// 样式 id（注册表校验，15 种）。
    pub style: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secondary_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fft_size: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_db: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_db: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smoothing: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gain: Option<f64>,
    /// 音频来源；缺省 `"project"`（整片输出音轨）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<String>,
    /// 可选说话人 id；由 host 注入的说话人时间段判定当前帧是否可见。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    /// 说话人未命中时是否仍显示静音形态；缺省 true。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub always_show: Option<bool>,
}

impl VisualizerProps {
    pub fn new(style: impl Into<String>) -> Self {
        Self {
            style: style.into(),
            main_color: None,
            secondary_color: None,
            fft_size: None,
            min_db: None,
            max_db: None,
            smoothing: None,
            gain: None,
            audio: None,
            speaker: None,
            always_show: None,
        }
    }

    pub fn fft_size(&self) -> u32 {
        self.fft_size.unwrap_or(VISUALIZER_FFT_SIZE_DEFAULT)
    }

    /// 元素**实际生效**的 dB 窗下沿：写过就按写的，没写按这一款样式的缺省
    /// （[`visualizer_db_window`]）。渲染与属性面板读的都是这一条。
    pub fn min_db(&self) -> f64 {
        self.min_db
            .unwrap_or_else(|| visualizer_db_window(&self.style).0)
    }

    /// 同 [`Self::min_db`] 的上沿。
    pub fn max_db(&self) -> f64 {
        self.max_db
            .unwrap_or_else(|| visualizer_db_window(&self.style).1)
    }

    pub fn smoothing(&self) -> f64 {
        self.smoothing.unwrap_or(VISUALIZER_SMOOTHING_DEFAULT)
    }

    pub fn gain(&self) -> f64 {
        self.gain.unwrap_or(VISUALIZER_GAIN_DEFAULT)
    }

    pub fn audio(&self) -> &str {
        self.audio.as_deref().unwrap_or(VISUALIZER_AUDIO_DEFAULT)
    }

    pub fn always_show(&self) -> bool {
        self.always_show.unwrap_or(true)
    }

    fn validate(&self, element_id: &str) -> Result<(), TimelineError> {
        if self.style.trim().is_empty() {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 visualizer.style 为空"
            )));
        }
        for (name, color) in [
            ("mainColor", &self.main_color),
            ("secondaryColor", &self.secondary_color),
        ] {
            if let Some(color) = color {
                validate_color(element_id, &format!("visualizer.{name}"), color)?;
            }
        }
        if let Some(size) = self.fft_size
            && !VISUALIZER_FFT_SIZES.contains(&size)
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 visualizer.fftSize 非法：{size}"
            )));
        }
        for (name, value) in [
            ("minDb", self.min_db),
            ("maxDb", self.max_db),
            ("smoothing", self.smoothing),
            ("gain", self.gain),
        ] {
            finite(element_id, &format!("visualizer.{name}"), value)?;
        }
        // 校验刻意用**全表兜底**而不是 `min_db()` / `max_db()` 的按款缺省：
        // 判据只针对文档里真的写下来的那一对，换一款样式不能把一份此前合法的
        // timeline 变成非法（曲线家族的窗上沿是 −10，−10..0 之间的 `minDb`
        // 在按款缺省下会突然倒置）。真出现倒置窗时 `bcut-waveform` 的
        // `remap_decibels_value` 有退化分支，不会产生 NaN。
        if self.min_db.unwrap_or(VISUALIZER_MIN_DB_DEFAULT)
            >= self.max_db.unwrap_or(VISUALIZER_MAX_DB_DEFAULT)
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 visualizer.minDb 必须小于 maxDb"
            )));
        }
        if self.smoothing.is_some_and(|tau| !(0.0..1.0).contains(&tau)) {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 visualizer.smoothing 须在 [0, 1)"
            )));
        }
        if self.gain.is_some_and(|gain| gain < 0.0) {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 visualizer.gain 必须非负"
            )));
        }
        if self
            .speaker
            .as_deref()
            .is_some_and(|speaker| speaker.trim().is_empty())
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 visualizer.speaker 为空"
            )));
        }
        Ok(())
    }
}

/// `kind == "progress"` 的进度条参数（设计 §5.2）。
///
/// 数据源是播放头而不是音频（`progress = clamp((t-start)/(end-start), 0, 1)`），
/// 因此参数集只有样式与两个颜色（ADR-E04）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgressProps {
    pub style: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secondary_color: Option<String>,
    /// 归一化起止值；允许 `start > end` 表达倒向进度。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_progress: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_progress: Option<f64>,
}

impl ProgressProps {
    pub fn new(style: impl Into<String>) -> Self {
        Self {
            style: style.into(),
            main_color: None,
            secondary_color: None,
            start_progress: None,
            end_progress: None,
        }
    }

    fn validate(&self, element_id: &str) -> Result<(), TimelineError> {
        if self.style.trim().is_empty() {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 progress.style 为空"
            )));
        }
        for (name, color) in [
            ("mainColor", &self.main_color),
            ("secondaryColor", &self.secondary_color),
        ] {
            if let Some(color) = color {
                validate_color(element_id, &format!("progress.{name}"), color)?;
            }
        }
        for (name, value) in [
            ("startProgress", self.start_progress),
            ("endProgress", self.end_progress),
        ] {
            if let Some(value) = value
                && (!value.is_finite() || !(0.0..=1.0).contains(&value))
            {
                return Err(TimelineError::Invalid(format!(
                    "element {element_id} 的 progress.{name} 须在 0..=1"
                )));
            }
        }
        Ok(())
    }
}

impl ProgressProps {
    pub fn remap(&self, progress: f64) -> f64 {
        let start = self.start_progress.unwrap_or(0.0);
        let end = self.end_progress.unwrap_or(1.0);
        (start + (end - start) * progress.clamp(0.0, 1.0)).clamp(0.0, 1.0)
    }
}

/// `confetti.shapes` 的封闭取值（设计稿 §3.3，12 种单位形）。
pub const CONFETTI_SHAPES: &[&str] = &[
    "rect", "strip", "circle", "ellipse", "triangle", "diamond", "star", "starlet", "sparkle",
    "heart", "petal", "ribbon",
];
/// `confetti.colors` 上限（ADR-CF04：面板 8 张色卡封顶）。
pub const CONFETTI_MAX_COLORS: usize = 8;
/// `confetti.emit.rate` 上限（粒/秒）。
pub const CONFETTI_MAX_RATE: f64 = 400.0;
/// `confetti.emit.count` 上限（每次爆发枚数）。
pub const CONFETTI_MAX_COUNT: f64 = 500.0;
/// `confetti.emit.interval` 上限（秒）。
pub const CONFETTI_MAX_INTERVAL: f64 = 60.0;
/// 倍率字段 `size` / `speed` 的区间。
pub const CONFETTI_SCALE_RANGE: (f64, f64) = (0.25, 4.0);
/// `gravity` 倍率区间（负值上浮）。
pub const CONFETTI_GRAVITY_RANGE: (f64, f64) = (-2.0, 4.0);
/// `drift` / `spin` 倍率区间（0＝不摆 / 不转）。
pub const CONFETTI_RATE_SCALE_RANGE: (f64, f64) = (0.0, 3.0);
/// `wind` 区间（参考 540 短边下的 px/s²）。
pub const CONFETTI_WIND_RANGE: (f64, f64) = (-600.0, 600.0);
/// `origin.x` / `origin.y` 区间（盒内 %，可落在画面外）。
pub const CONFETTI_ORIGIN_RANGE: (f64, f64) = (-20.0, 120.0);
/// `opacity` 区间。
pub const CONFETTI_OPACITY_RANGE: (f64, f64) = (0.0, 1.0);
/// `angle` 区间（度）。
pub const CONFETTI_ANGLE_RANGE: (f64, f64) = (-180.0, 180.0);
/// `spread` 区间（度）。
pub const CONFETTI_SPREAD_RANGE: (f64, f64) = (0.0, 360.0);
/// `emit.rate` 区间（粒/秒）。
pub const CONFETTI_RATE_RANGE: (f64, f64) = (1.0, CONFETTI_MAX_RATE);
/// `emit.count` 区间（每次爆发枚数）。
pub const CONFETTI_COUNT_RANGE: (f64, f64) = (1.0, CONFETTI_MAX_COUNT);
/// `emit.interval` 区间（秒，0＝只放一次）。
pub const CONFETTI_INTERVAL_RANGE: (f64, f64) = (0.0, CONFETTI_MAX_INTERVAL);

/// `confetti.emit.mode`：连续发射或成批爆发。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConfettiEmitMode {
    Continuous,
    Burst,
}

impl ConfettiEmitMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Continuous => "continuous",
            Self::Burst => "burst",
        }
    }
}

/// `confetti.emit`：发射方式。写了与 `mode` 不配套的字段允许存在
/// （切换模式时保留另一边的值），渲染只读当前模式用到的那几个。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfettiEmit {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<ConfettiEmitMode>,
    /// `continuous`：粒/秒，`1..=400`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate: Option<f64>,
    /// `burst`：每次枚数，`1..=500`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<f64>,
    /// `burst`：重复间隔秒，`0..=60`，`0`＝只放一次。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interval: Option<f64>,
    /// 元素结束前 `lifeMax` 秒停止发射，让画面自然清空。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settle: Option<bool>,
}

/// `confetti.origin`：把配方的发射器组**替换**成这一枚点（盒内 %）。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfettiOrigin {
    pub x: f64,
    pub y: f64,
}

/// `kind == "confetti"` 的算法彩纸参数（设计稿 §3.2）。
///
/// 只有 `style` 必填；其余全是对配方缺省的覆盖，缺席即取配方值。倍率字段
/// （`size/speed/gravity/drift/spin`）乘在配方的区间基数上；`wind/rate/count/
/// interval/angle/spread` 有天然绝对单位故用绝对值（ADR-CF03）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfettiProps {
    pub style: String,
    /// 随机种子；缺席按 0。新建时写随机值（ADR-CF06）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<u64>,
    /// 粒子调色板 `#RRGGBB(AA)` × 1–8。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colors: Option<Vec<String>>,
    /// 形状混合，[`CONFETTI_SHAPES`] 的子集 × 1–12。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shapes: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speed: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gravity: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drift: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spin: Option<f64>,
    /// 水平常加速度，参考 px/s²（按 `pixelScale` 缩放）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wind: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emit: Option<ConfettiEmit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<ConfettiOrigin>,
    /// 发射方向，度：0 向右、−90 向上、90 向下。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub angle: Option<f64>,
    /// 发射扇面，度 `0..=360`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spread: Option<f64>,
}

impl ConfettiProps {
    pub fn new(style: impl Into<String>) -> Self {
        Self {
            style: style.into(),
            seed: None,
            colors: None,
            shapes: None,
            size: None,
            speed: None,
            gravity: None,
            drift: None,
            spin: None,
            wind: None,
            opacity: None,
            emit: None,
            origin: None,
            angle: None,
            spread: None,
        }
    }

    fn validate(&self, element_id: &str) -> Result<(), TimelineError> {
        if self.style.trim().is_empty() {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 confetti.style 为空"
            )));
        }
        if let Some(colors) = &self.colors {
            if colors.is_empty() || colors.len() > CONFETTI_MAX_COLORS {
                return Err(TimelineError::Invalid(format!(
                    "element {element_id} 的 confetti.colors 须有 1..={CONFETTI_MAX_COLORS} 项"
                )));
            }
            for color in colors {
                validate_color(element_id, "confetti.colors[]", color)?;
            }
        }
        if let Some(shapes) = &self.shapes {
            if shapes.is_empty() || shapes.len() > CONFETTI_SHAPES.len() {
                return Err(TimelineError::Invalid(format!(
                    "element {element_id} 的 confetti.shapes 须有 1..={} 项",
                    CONFETTI_SHAPES.len()
                )));
            }
            if let Some(unknown) = shapes
                .iter()
                .find(|shape| !CONFETTI_SHAPES.contains(&shape.as_str()))
            {
                return Err(TimelineError::Invalid(format!(
                    "element {element_id} 的 confetti.shapes 含未知形状：{unknown}"
                )));
            }
        }
        let ranges: [(&str, Option<f64>, (f64, f64)); 11] = [
            ("size", self.size, CONFETTI_SCALE_RANGE),
            ("speed", self.speed, CONFETTI_SCALE_RANGE),
            ("gravity", self.gravity, CONFETTI_GRAVITY_RANGE),
            ("drift", self.drift, CONFETTI_RATE_SCALE_RANGE),
            ("spin", self.spin, CONFETTI_RATE_SCALE_RANGE),
            ("wind", self.wind, CONFETTI_WIND_RANGE),
            ("opacity", self.opacity, CONFETTI_OPACITY_RANGE),
            ("angle", self.angle, CONFETTI_ANGLE_RANGE),
            ("spread", self.spread, CONFETTI_SPREAD_RANGE),
            ("origin.x", self.origin.map(|o| o.x), CONFETTI_ORIGIN_RANGE),
            ("origin.y", self.origin.map(|o| o.y), CONFETTI_ORIGIN_RANGE),
        ];
        for (name, value, (lo, hi)) in ranges {
            check_confetti_range(element_id, name, value, lo, hi)?;
        }
        if let Some(emit) = &self.emit {
            let ranges = [
                ("emit.rate", emit.rate, CONFETTI_RATE_RANGE),
                ("emit.count", emit.count, CONFETTI_COUNT_RANGE),
                ("emit.interval", emit.interval, CONFETTI_INTERVAL_RANGE),
            ];
            for (name, value, (lo, hi)) in ranges {
                check_confetti_range(element_id, name, value, lo, hi)?;
            }
        }
        Ok(())
    }

    /// 生效的发射模式（缺席交给配方，返回 `None`）。
    pub fn emit_mode(&self) -> Option<ConfettiEmitMode> {
        self.emit.as_ref().and_then(|emit| emit.mode)
    }
}

fn check_confetti_range(
    element_id: &str,
    name: &str,
    value: Option<f64>,
    lo: f64,
    hi: f64,
) -> Result<(), TimelineError> {
    if let Some(value) = value
        && (!value.is_finite() || !(lo..=hi).contains(&value))
    {
        return Err(TimelineError::Invalid(format!(
            "element {element_id} 的 confetti.{name} 须在 {lo}..={hi}"
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CounterMode {
    Countdown,
    Countup,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum CounterFormat {
    #[serde(rename = "s")]
    Seconds,
    #[serde(rename = "mm:ss")]
    MinutesSeconds,
    #[serde(rename = "hh:mm:ss")]
    HoursMinutesSeconds,
}

fn default_counter_format() -> CounterFormat {
    CounterFormat::Seconds
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CounterProps {
    pub mode: CounterMode,
    #[serde(
        default = "default_counter_format",
        skip_serializing_if = "is_counter_seconds"
    )]
    pub format: CounterFormat,
}

fn is_counter_seconds(value: &CounterFormat) -> bool {
    *value == CounterFormat::Seconds
}

impl CounterProps {
    /// 读数在**毫秒栅格**上求值（`docs/design/elements/bcut-counter-element-design.md` §4）：
    /// `end − time` 这类浮点差在换值点上带残差（`8.05 − 1.05 =
    /// 7.000000000000001`），直接 `ceil` 会多显示一秒，且残差方向取决于两端
    /// 各自的浮点表示——不量化的话三端可能在同一帧给出不同读数，违反确定性
    /// 契约（§15）。先折算到毫秒整数（时间码的显示精度），边界归属就是无歧义的。
    pub fn value_at(&self, start: f64, end: f64, time: f64) -> u64 {
        let ms = |value: f64| (value * 1000.0).round() as i64;
        let (t, s0, s1) = (ms(time), ms(start), ms(end));
        let value = match self.mode {
            // 整数上的 ceil / floor：半开窗口的锚定端见 ADR-CT02。
            CounterMode::Countdown => ((s1 - t).max(0) + 999) / 1000,
            CounterMode::Countup => (t - s0).max(0) / 1000,
        };
        value as u64
    }

    pub fn text_at(&self, start: f64, end: f64, time: f64) -> String {
        let value = self.value_at(start, end, time);
        match self.format {
            CounterFormat::Seconds => value.to_string(),
            CounterFormat::MinutesSeconds => format!("{:02}:{:02}", value / 60, value % 60),
            CounterFormat::HoursMinutesSeconds => format!(
                "{:02}:{:02}:{:02}",
                value / 3_600,
                value / 60 % 60,
                value % 60
            ),
        }
    }

    fn validate(&self, _element_id: &str) -> Result<(), TimelineError> {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DrawBrush {
    Round,
    Sliced,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DrawStroke {
    pub points: Vec<[f64; 2]>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DrawProps {
    pub brush: DrawBrush,
    pub color: String,
    pub size: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alpha: Option<f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub strokes: Vec<DrawStroke>,
}

impl DrawProps {
    pub const MAX_STROKES: usize = 256;
    pub const MAX_POINTS: usize = 16_384;

    fn validate(&self, element_id: &str) -> Result<(), TimelineError> {
        validate_color(element_id, "draw.color", &self.color)?;
        if !self.size.is_finite() || !(1.0..=40.0).contains(&self.size) {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 draw.size 须在 1..=40"
            )));
        }
        if self
            .alpha
            .is_some_and(|alpha| !alpha.is_finite() || !(0.0..=1.0).contains(&alpha))
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 draw.alpha 须在 0..=1"
            )));
        }
        if self.strokes.len() > Self::MAX_STROKES {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 draw.strokes 超过 {}",
                Self::MAX_STROKES
            )));
        }
        let mut total = 0usize;
        for stroke in &self.strokes {
            total = total.saturating_add(stroke.points.len());
            for [x, y] in &stroke.points {
                if !x.is_finite()
                    || !y.is_finite()
                    || !(0.0..=100.0).contains(x)
                    || !(0.0..=100.0).contains(y)
                {
                    return Err(TimelineError::Invalid(format!(
                        "element {element_id} 的 draw point 须在 0..=100"
                    )));
                }
            }
        }
        if total > Self::MAX_POINTS {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 draw points 总数超过 {}",
                Self::MAX_POINTS
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlaceholderVariant {
    Camera,
    Media,
    Screen,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaceholderProps {
    pub variant: PlaceholderVariant,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl PlaceholderProps {
    fn validate(&self, element_id: &str) -> Result<(), TimelineError> {
        if self
            .notes
            .as_deref()
            .is_some_and(|notes| notes.len() > 2_048)
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 placeholder.notes 超过 2048 字节"
            )));
        }
        Ok(())
    }
}

fn finite(element_id: &str, field: &str, value: Option<f64>) -> Result<(), TimelineError> {
    match value {
        Some(value) if !value.is_finite() => Err(TimelineError::Invalid(format!(
            "element {element_id} 的 {field} 非法"
        ))),
        _ => Ok(()),
    }
}

/// `"#RRGGBB"` / `"#RRGGBBAA"`。颜色一路走到光栅器，格式在契约层就收口，
/// 免得每个渲染表面各写一份宽松解析。
/// `kind == "whiteboard"` 的白板手绘参数（设计稿 §3；0.9 扩展见旁白同步设计稿 §5）。
///
/// 全部可选：缺席即缺省（`hand=marker`、纸色透明、`draw` 按元素时长与自然时长推算、
/// 先墨线后色块、`pace=stretch`、`strict=false`）。揭示场本身是渲染期派生物，
/// **不在这里持久化**（ADR-WB02）。0.8 文档不含新字段，读入即 0.9 语义。
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WhiteboardProps {
    /// 手的样式：`marker` / `pen` / `none`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hand: Option<WhiteboardHand>,
    /// 纸色 `#RRGGBB(AA)`；缺席透明，让项目背景透出来（ADR-WB06）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paper: Option<String>,
    /// 画完全图的秒数（`> 0`）；缺席按 `min(0.8 × 时长, 自然时长)`，超过时长按时长截断。
    /// 不接受词锚点：完成点由 `bcut whiteboard sync` 算成数字写入，一处真相。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draw: Option<f64>,
    /// 先墨线后色块；缺席 true。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ink_first: Option<bool>,
    /// 0.9：每拍的节奏。`stretch`（缺席）= 组窗撑满，与 0.8 逐字节相同；
    /// `natural` = 按自然速度画完后定格到组窗结束，装不下时压缩并报
    /// `whiteboard-window-too-short`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pace: Option<WhiteboardPace>,
    /// 0.9：`true` 时 `box` 是硬遮罩——像素归属按拍顺序、重叠归后拍、跨 box 的连通域
    /// 按像素切开、未被任何 box 覆盖的前景排到末拍之后；缺席 `false` = 质心分组。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strict: Option<bool>,
    /// 语义顺序提示：落在 `box` 内的连通域归该节拍，从 `at` 画到 `end`（元素本地秒或词锚点）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub beats: Option<Vec<WhiteboardBeat>>,
}

/// `whiteboard.pace` 的封闭枚举（0.9）。
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WhiteboardPace {
    /// 组窗撑满（缺省 = 0.8 的行为）。
    #[default]
    Stretch,
    /// 按自然速度画完后定格到组窗结束。
    Natural,
}

impl WhiteboardPace {
    pub const ALL: [Self; 2] = [Self::Stretch, Self::Natural];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Stretch => "stretch",
            Self::Natural => "natural",
        }
    }
}

/// `whiteboard.hand` 的封闭枚举。
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WhiteboardHand {
    #[default]
    Marker,
    Pen,
    None,
}

impl WhiteboardHand {
    pub const ALL: [Self; 3] = [Self::Marker, Self::Pen, Self::None];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Marker => "marker",
            Self::Pen => "pen",
            Self::None => "none",
        }
    }
}

/// 一个节拍：`at` / `end` 是 [`TimeValue`]——数字为元素本地秒（相对 `start`），字符串为
/// 词锚点（与元素 `start` / `end` 同文法，宿主解析后减元素起点）；`box` 为画面百分比
/// `[x, y, w, h]`。`end` 缺席 = 下一拍的 `at`，末拍缺席 = `draw`。`label` 只做展示与对拍，
/// 不参与渲染（≤ [`WHITEBOARD_MAX_LABEL_CHARS`] 字符）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WhiteboardBeat {
    pub at: TimeValue,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<TimeValue>,
    #[serde(rename = "box")]
    pub rect: [f64; 4],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

impl WhiteboardBeat {
    /// 数字写法的节拍（0.8 的形状）。
    pub fn at_seconds(at: f64, rect: [f64; 4]) -> Self {
        Self {
            at: TimeValue::Seconds(at),
            end: None,
            rect,
            label: None,
        }
    }

    /// `at` 是数字时的本地秒；锚点返回 `None`（要靠宿主解析）。
    pub fn at_local(&self) -> Option<f64> {
        match &self.at {
            TimeValue::Seconds(value) => Some(*value),
            TimeValue::Anchor(_) => None,
        }
    }

    /// `end` 是数字时的本地秒；缺席或锚点返回 `None`。
    pub fn end_local(&self) -> Option<f64> {
        match &self.end {
            Some(TimeValue::Seconds(value)) => Some(*value),
            _ => None,
        }
    }

    /// 任一端是词锚点。
    pub fn is_anchored(&self) -> bool {
        matches!(self.at, TimeValue::Anchor(_)) || matches!(self.end, Some(TimeValue::Anchor(_)))
    }
}

/// `whiteboard.beats` 的上限。
pub const WHITEBOARD_MAX_BEATS: usize = 64;
/// `whiteboard.beats[].label` 的字符上限。
pub const WHITEBOARD_MAX_LABEL_CHARS: usize = 80;

/// 白板节拍时序校验码（0.9）：解析后须 `at_g < end_g ≤ at_{g+1}`。
pub const WHITEBOARD_BEAT_WINDOW: &str = "whiteboard-beat-window";
/// 末拍 `end` 与 `draw` 的关系：`end_末 ≤ draw ≤ 时长`。
pub const WHITEBOARD_BEAT_AFTER_DRAW: &str = "whiteboard-beat-after-draw";
/// `pace: natural` 下某拍自然时长大于组窗（被压缩）。
pub const WHITEBOARD_WINDOW_TOO_SHORT: &str = "whiteboard-window-too-short";
/// `strict` 下有前景像素不在任何 `box` 内（排到末拍之后）。
pub const WHITEBOARD_UNASSIGNED_FOREGROUND: &str = "whiteboard-unassigned-foreground";
/// `strict` 下某个 `box` 被后拍扣空。
pub const WHITEBOARD_EMPTY_BOX: &str = "whiteboard-empty-box";
/// `bcut whiteboard sync` 没拿到对象映射，用了「阅读序连通域 ∝ 句字数」的兜底。
pub const WHITEBOARD_BEATS_HEURISTIC: &str = "whiteboard-beats-heuristic";
/// `label` 与锚点词所在句文本不符（文稿变了、id 漂了）。
pub const WHITEBOARD_LABEL_MISMATCH: &str = "whiteboard-label-mismatch";
/// 元素窗内有语音、连续一段没有揭示推进且不在任何拍的 hold 段。
pub const WHITEBOARD_SPEECH_WITHOUT_PROGRESS: &str = "whiteboard-speech-without-progress";

impl WhiteboardProps {
    /// 缺省 `inkFirst`。
    pub fn ink_first(&self) -> bool {
        self.ink_first.unwrap_or(true)
    }

    /// 缺省 `hand`。
    pub fn hand(&self) -> WhiteboardHand {
        self.hand.unwrap_or_default()
    }

    /// 缺省 `pace`（0.9）。
    pub fn pace(&self) -> WhiteboardPace {
        self.pace.unwrap_or_default()
    }

    /// 缺省 `strict`（0.9）。
    pub fn strict(&self) -> bool {
        self.strict.unwrap_or(false)
    }

    fn validate(&self, element_id: &str) -> Result<(), TimelineError> {
        if let Some(paper) = &self.paper {
            validate_color(element_id, "whiteboard.paper", paper)?;
        }
        if let Some(draw) = self.draw
            && !(draw.is_finite() && draw > 0.0)
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 whiteboard.draw 须为正数：{draw}"
            )));
        }
        if let Some(beats) = &self.beats {
            if beats.len() > WHITEBOARD_MAX_BEATS {
                return Err(TimelineError::Invalid(format!(
                    "element {element_id} 的 whiteboard.beats 至多 {WHITEBOARD_MAX_BEATS} 条"
                )));
            }
            let mut last = f64::NEG_INFINITY;
            let mut last_end: Option<f64> = None;
            for (index, beat) in beats.iter().enumerate() {
                for (field, value) in [("at", Some(&beat.at)), ("end", beat.end.as_ref())] {
                    match value {
                        Some(TimeValue::Seconds(value)) if !value.is_finite() || *value < 0.0 => {
                            return Err(TimelineError::Invalid(format!(
                                "element {element_id} 的 whiteboard.beats[{index}].{field} 须为非负秒数"
                            )));
                        }
                        Some(TimeValue::Anchor(anchor)) if !valid_anchor(anchor) => {
                            return Err(TimelineError::Invalid(format!(
                                "element {element_id} 的 whiteboard.beats[{index}].{field} 词锚点非法：{anchor}"
                            )));
                        }
                        _ => {}
                    }
                }
                if let Some(label) = &beat.label
                    && label.chars().count() > WHITEBOARD_MAX_LABEL_CHARS
                {
                    return Err(TimelineError::Invalid(format!(
                        "element {element_id} 的 whiteboard.beats[{index}].label 至多 {WHITEBOARD_MAX_LABEL_CHARS} 字符"
                    )));
                }
                // 数字写法在契约层就能校验时序；锚点写法要等宿主解析（同码报到 elementId + field）。
                if let Some(at) = beat.at_local() {
                    if at < last {
                        return Err(TimelineError::Invalid(format!(
                            "element {element_id} 的 whiteboard.beats[{index}].at 须单调不减（{WHITEBOARD_BEAT_WINDOW}）"
                        )));
                    }
                    if let Some(prev_end) = last_end
                        && prev_end > at
                    {
                        return Err(TimelineError::Invalid(format!(
                            "element {element_id} 的 whiteboard.beats[{}].end 须不晚于下一拍的 at（{WHITEBOARD_BEAT_WINDOW}）",
                            index - 1
                        )));
                    }
                    last = at;
                }
                last_end = match (beat.at_local(), beat.end_local()) {
                    (Some(at), Some(end)) => {
                        if end <= at {
                            return Err(TimelineError::Invalid(format!(
                                "element {element_id} 的 whiteboard.beats[{index}].end 须晚于 at（{WHITEBOARD_BEAT_WINDOW}）"
                            )));
                        }
                        Some(end)
                    }
                    (None, Some(end)) => Some(end),
                    _ => None,
                };
                if index + 1 == beats.len()
                    && let (Some(end), Some(draw)) = (beat.end_local(), self.draw)
                    && end > draw
                {
                    return Err(TimelineError::Invalid(format!(
                        "element {element_id} 的 whiteboard.beats[{index}].end 须不晚于 draw（{WHITEBOARD_BEAT_AFTER_DRAW}）"
                    )));
                }
                let [x, y, w, h] = beat.rect;
                if ![x, y, w, h].iter().all(|v| v.is_finite())
                    || w <= 0.0
                    || h <= 0.0
                    || !(-100.0..=200.0).contains(&x)
                    || !(-100.0..=200.0).contains(&y)
                    || w > 300.0
                    || h > 300.0
                {
                    return Err(TimelineError::Invalid(format!(
                        "element {element_id} 的 whiteboard.beats[{index}].box 非法：{:?}",
                        beat.rect
                    )));
                }
            }
        }
        Ok(())
    }
}

pub(crate) fn validate_color(
    element_id: &str,
    field: &str,
    color: &str,
) -> Result<(), TimelineError> {
    let hex = color.strip_prefix('#').unwrap_or("");
    if !matches!(hex.len(), 6 | 8) || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(TimelineError::Invalid(format!(
            "element {element_id} 的 {field} 不是 #RRGGBB[AA]：{color}"
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ElementRole {
    Broll,
    Watermark,
    Screentext,
    Overlay,
    Frame,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CornerRadii {
    pub top_left: f64,
    pub top_right: f64,
    pub bottom_right: f64,
    pub bottom_left: f64,
}

impl CornerRadii {
    pub fn values(self) -> [f64; 4] {
        [
            self.top_left,
            self.top_right,
            self.bottom_right,
            self.bottom_left,
        ]
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Place {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub scale: Option<f64>,
    pub scale_y: Option<f64>,
    pub rot: Option<f64>,
    pub opacity: Option<f64>,
    pub radius: Option<f64>,
    /// 四角独立的媒体裁切半径；存在时优先于旧单值 `radius`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corner_radii: Option<CornerRadii>,
    /// 水平/垂直镜像（0.2 新增）。**镜像是几何不是外观**，因此归 `Place`
    /// 而不是无 schema 的 `style`（ADR-E01）。两者都挂 `skip_serializing_if`：
    /// 不含镜像的旧文档序列化后与 0.1 逐字节相同。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flip_x: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flip_y: Option<bool>,
}

impl Place {
    /// 镜像后的缩放符号，直接乘进仿射矩阵的 `sx` / `sy`。
    pub fn flip_signs(&self) -> (f64, f64) {
        (
            if self.flip_x.unwrap_or(false) {
                -1.0
            } else {
                1.0
            },
            if self.flip_y.unwrap_or(false) {
                -1.0
            } else {
                1.0
            },
        )
    }

    pub fn corner_radii(&self) -> [f64; 4] {
        self.corner_radii
            .map(CornerRadii::values)
            .unwrap_or_else(|| [self.radius.unwrap_or(0.0); 4])
    }
}

impl Place {
    pub fn validate(&self, element_id: &str) -> Result<(), TimelineError> {
        for (name, value) in [
            ("x", self.x),
            ("y", self.y),
            ("w", self.w),
            ("scale", self.scale),
            ("scaleY", self.scale_y),
            ("rot", self.rot),
            ("opacity", self.opacity),
            ("radius", self.radius),
        ] {
            if let Some(value) = value
                && (!value.is_finite() || (name == "radius" && value < 0.0))
            {
                return Err(TimelineError::Invalid(format!(
                    "element {element_id} 的 place.{name} 非法"
                )));
            }
        }
        if self.corner_radii.is_some_and(|radii| {
            radii
                .values()
                .iter()
                .any(|value| !value.is_finite() || *value < 0.0)
        }) {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 place.cornerRadii 必须是非负有限数"
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VisualMode {
    Fullscreen,
    Pip,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Fit {
    Cover,
    Contain,
}

/// 媒体元素的留边 / 画布底：`"blur"`、`"black"` 或 `"#RRGGBB"` 纯色（0.12 起）。
///
/// 读入大小写不限，写出一律大写 `#RRGGBB`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Background {
    Blur,
    Black,
    Color([u8; 3]),
}

impl Background {
    /// 解析文档里的取值；认不出返回 `None`。
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "blur" => Some(Self::Blur),
            "black" => Some(Self::Black),
            _ => {
                let hex = text.strip_prefix('#')?;
                if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
                    return None;
                }
                let byte = |index: usize| u8::from_str_radix(&hex[index..index + 2], 16).ok();
                Some(Self::Color([byte(0)?, byte(2)?, byte(4)?]))
            }
        }
    }

    /// 文档里的写法（`blur` / `black` / 大写 `#RRGGBB`）。
    pub fn as_string(&self) -> String {
        match self {
            Self::Blur => "blur".into(),
            Self::Black => "black".into(),
            Self::Color([r, g, b]) => format!("#{r:02X}{g:02X}{b:02X}"),
        }
    }

    /// 实色底的 RGB（`black` 是 `[0, 0, 0]`）；`blur` 返回 `None`。
    pub fn solid_rgb(&self) -> Option<[u8; 3]> {
        match self {
            Self::Blur => None,
            Self::Black => Some([0, 0, 0]),
            Self::Color(rgb) => Some(*rgb),
        }
    }
}

impl Serialize for Background {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.as_string())
    }
}

impl<'de> Deserialize<'de> for Background {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        Self::parse(&text).ok_or_else(|| {
            serde::de::Error::custom(format!(
                "背景须是 \"blur\"、\"black\" 或 \"#RRGGBB\"：{text}"
            ))
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tile {
    pub on: bool,
    pub angle: Option<f64>,
    pub gap_x: Option<f64>,
    pub gap_y: Option<f64>,
    pub stagger: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mask {
    pub shape: MaskShape,
    pub feather: Option<f64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MaskShape {
    Ellipse,
}

/// `fx` 里强度类字段（grayscale / sharpen / noise / vignette / effectIntensity）的区间。
pub const FX_AMOUNT_RANGE: (f64, f64) = (0.0, 1.0);
/// `fx` 里有正负的调色字段（brightness / contrast / exposure / hue / saturation）的区间。
pub const FX_ADJUST_RANGE: (f64, f64) = (-1.0, 1.0);
/// `fx.blur` 的区间。
pub const FX_BLUR_RANGE: (f64, f64) = (0.0, 100.0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Fx {
    pub grayscale: Option<f64>,
    pub blur: Option<f64>,
    pub brightness: Option<f64>,
    pub contrast: Option<f64>,
    pub exposure: Option<f64>,
    pub hue: Option<f64>,
    pub saturation: Option<f64>,
    pub sharpen: Option<f64>,
    pub noise: Option<f64>,
    pub vignette: Option<f64>,
    pub filter_preset: Option<FilterPreset>,
    pub effect_preset: Option<EffectPreset>,
    pub effect_intensity: Option<f64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilterPreset {
    None,
    Calm1,
    Calm2,
    Calm3,
    Clean1,
    Clean2,
    Clean3,
    Cottage1,
    Cottage2,
    Cottage3,
    Peckham1,
    Peckham2,
    Peckham3,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EffectPreset {
    None,
    Invert,
    NightVision,
    ThermalVision,
    Old,
    Polaroid,
    Filmic,
    Snowy,
    BoxBlur,
    BokehBlur,
}

pub const FILTER_PRESETS: &[&str] = &[
    "none", "calm1", "calm2", "calm3", "clean1", "clean2", "clean3", "cottage1", "cottage2",
    "cottage3", "peckham1", "peckham2", "peckham3",
];

pub const EFFECT_PRESETS: &[&str] = &[
    "none",
    "invert",
    "night_vision",
    "thermal_vision",
    "old",
    "polaroid",
    "filmic",
    "snowy",
    "box_blur",
    "bokeh_blur",
];

impl Fx {
    pub fn validate(&self, element_id: &str) -> Result<(), TimelineError> {
        for (name, value) in [
            ("grayscale", self.grayscale),
            ("sharpen", self.sharpen),
            ("noise", self.noise),
            ("vignette", self.vignette),
            ("effectIntensity", self.effect_intensity),
        ] {
            let (lo, hi) = FX_AMOUNT_RANGE;
            if let Some(value) = value
                && (!value.is_finite() || !(lo..=hi).contains(&value))
            {
                return Err(TimelineError::Invalid(format!(
                    "element {element_id} 的 fx.{name} 须在 0..=1"
                )));
            }
        }
        for (name, value) in [
            ("brightness", self.brightness),
            ("contrast", self.contrast),
            ("exposure", self.exposure),
            ("hue", self.hue),
            ("saturation", self.saturation),
        ] {
            let (lo, hi) = FX_ADJUST_RANGE;
            if let Some(value) = value
                && (!value.is_finite() || !(lo..=hi).contains(&value))
            {
                return Err(TimelineError::Invalid(format!(
                    "element {element_id} 的 fx.{name} 须在 -1..=1"
                )));
            }
        }
        let (lo, hi) = FX_BLUR_RANGE;
        if self
            .blur
            .is_some_and(|value| !value.is_finite() || !(lo..=hi).contains(&value))
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 fx.blur 须在 0..=100"
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Animation {
    pub enter: Option<AnimationSlot>,
    pub exit: Option<AnimationSlot>,
    pub r#loop: Option<AnimationSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnimationSlot {
    pub preset: String,
    pub preset_version: Option<u32>,
    pub dur: Option<f64>,
    pub delay: Option<f64>,
    pub intensity: Option<f64>,
    pub ease: Option<String>,
    pub stagger: Option<f64>,
    pub stagger_from: Option<String>,
    pub period: Option<f64>,
    pub phase: Option<f64>,
    pub seed: Option<u64>,
}

/// 入场槽（`animate.enter.preset`）的封闭词表 = `bcut-motion` 的 `timeline.enter.*`
/// 配方表（第 156 轮起两者逐条相等，`preset_lists_frozen` 守住）。
pub const ENTER_PRESETS: &[&str] = &[
    "none",
    "fade",
    "rise",
    "drop",
    "slideL",
    "slideR",
    // 2026-09-05（第 156 轮）：slide 补上下两向（入场 = 从哪一侧来），与注册表
    // 同位；wave/flipboard/dragonfly/billboard 见表尾。
    "slideUp",
    "slideDown",
    "pop",
    "zoomIn",
    "zoomOut",
    "spin",
    "blurIn",
    "typewriter",
    "riseWords",
    "wipe",
    // 2026-08-30 对齐文字动画目录（designs/baocut model-textpresets）：五条
    // 2D pose 可表达的入场（compress/fall/skid/roll 带出场镜像；bounce 有意
    // 无出场——弹跳没有对称的离场动作）。配方在
    // core/presets/builtin/motion/timeline.{enter,exit}.*.json。
    "compress",
    "bounce",
    "fall",
    "skid",
    "roll",
    // 2026-09-05（第 156 轮）补齐到设计稿 In 19 / Out 16 / Loop 9：wave/
    // flipboard/dragonfly/billboard 首次落核；`drop` 同时获得同名出场
    // （设计稿 stomp）。
    "wave",
    "flipboard",
    "dragonfly",
    "billboard",
    // 2026-09-08：元素动画目录（形状/图片/视频，`surface: "element"`，
    // 多关键帧配方）。文字目录不列这些 id；顺序 = 注册表 `order`。
    "elFade",
    "elFloatL",
    "elFloatR",
    "elFloatUp",
    "elFloatDown",
    "elZoom",
    "elKenBurns",
    "elDrop",
    "elSlideL",
    "elSlideR",
    "elSlideUp",
    "elSlideDown",
    "elWipeL",
    "elWipeR",
    "elWipeUp",
    "elWipeDown",
    "elPop",
    "elBounce",
    "elSpinCw",
    "elSpinCcw",
    "elSlideBounceL",
    "elSlideBounceR",
    "elSlideBounceUp",
    "elSlideBounceDown",
    "elGentleFloatL",
    "elGentleFloatR",
    "elGentleFloatUp",
    "elGentleFloatDown",
];

/// 出场槽（`animate.exit.preset`）的封闭词表 = `bcut-motion` 的 `timeline.exit.*`
/// 配方表，顺序即注册表 `order`。2026-09-05（第 156 轮）之前 exit 槽借用入场
/// 词表校验，于是 `sink` / `shrink` 这种只有出场配方的 id 写不进文档——引擎按
/// `mirror` 派生出的「跟随入场」退场一旦被编辑面板实体化（`text_workbench::choose`
/// 保住已派生的退场再改别的槽），保存就被 `validate` 拒掉。出场词表从此独立。
pub const EXIT_PRESETS: &[&str] = &[
    "none",
    "fade",
    "sink",
    "rise",
    "slideL",
    "slideR",
    "slideUp",
    "slideDown",
    "shrink",
    "zoomIn",
    "zoomOut",
    "spin",
    "wipe",
    "compress",
    "fall",
    "skid",
    "roll",
    "drop",
    "flipboard",
    "dragonfly",
    "billboard",
    // 2026-09-08：元素动画目录（形状/图片/视频，`surface: "element"`，
    // 多关键帧配方）。文字目录不列这些 id；顺序 = 注册表 `order`。
    "elFade",
    "elFloatL",
    "elFloatR",
    "elFloatUp",
    "elFloatDown",
    "elZoom",
    "elKenBurns",
    "elDrop",
    "elSlideL",
    "elSlideR",
    "elSlideUp",
    "elSlideDown",
    "elWipeL",
    "elWipeR",
    "elWipeUp",
    "elWipeDown",
    "elPop",
    "elBounce",
    "elSpinCw",
    "elSpinCcw",
    "elSlideBounceL",
    "elSlideBounceR",
    "elSlideBounceUp",
    "elSlideBounceDown",
    "elGentleFloatL",
    "elGentleFloatR",
    "elGentleFloatUp",
    "elGentleFloatDown",
];

/// Timeline 0.1 时代 exit 槽借用入场词表，这几个名字写进 exit 槽合法但没有出场
/// 配方（`lower_timeline::effective_exit` 视作无退场）。已发布的封闭枚举不删词
/// （规范 §19：枚举内加词不升版、删词要升版），所以读入仍接受、语义不变；
/// 编辑写路径不得再产出它们，`bcut-motion` 的 `textpreset` 解析期也按配方表拒。
pub const EXIT_LEGACY_PRESETS: &[&str] = &["pop", "blurIn", "typewriter", "riseWords", "bounce"];

/// exit 槽实际接受的 id：配方表 ∪ 0.1 兼容名。
pub fn exit_preset_accepted(id: &str) -> bool {
    EXIT_PRESETS.contains(&id) || EXIT_LEGACY_PRESETS.contains(&id)
}

pub const LOOP_PRESETS: &[&str] = &[
    "float",
    "pulse",
    "sway",
    "jitter",
    "blink",
    // 第 156 轮：设计稿 Loop 目录（rotate 走 ramp 波、heartBeat 走 heartbeat 波）。
    "rotate",
    "heartBeat",
    "vogue",
    "dragonfly",
    "billboard",
    "roll",
    // 2026-09-08：元素动画目录（形状/图片/视频，`surface: "element"`，
    // 多关键帧配方）。文字目录不列这些 id；顺序 = 注册表 `order`。
    "elSpin",
    "elSpinSmooth",
    "elSpin3d",
    "elBounce",
    "elHeartbeat",
    "elSway",
    "elSway3d",
    "elSqueezy",
    "elJiggle",
];

/// Timeline `ease` 枚举 = 规范附录 A 的封闭表。唯一实现在 `motion::curve`。
pub use ::motion::curve::EASE_NAMES;

impl Animation {
    pub fn validate(&self, element_id: &str) -> Result<(), TimelineError> {
        if let Some(slot) = &self.enter {
            slot.validate(element_id, "enter", |id| ENTER_PRESETS.contains(&id))?;
        }
        if let Some(slot) = &self.exit {
            slot.validate(element_id, "exit", exit_preset_accepted)?;
        }
        if let Some(slot) = &self.r#loop {
            slot.validate(element_id, "loop", |id| LOOP_PRESETS.contains(&id))?;
        }
        Ok(())
    }
}

impl AnimationSlot {
    fn validate(
        &self,
        element_id: &str,
        slot_name: &str,
        accepted: impl Fn(&str) -> bool,
    ) -> Result<(), TimelineError> {
        if !accepted(self.preset.as_str()) {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 {slot_name} preset 非法：{}",
                self.preset
            )));
        }
        use crate::animations::{
            DURATION_MAX, DURATION_MIN, INTENSITY_MAX, INTENSITY_MIN, PERIOD_MAX, PERIOD_MIN,
        };
        if let Some(duration) = self.dur
            && (!duration.is_finite() || !(DURATION_MIN..=DURATION_MAX).contains(&duration))
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 {slot_name}.dur 须在 {DURATION_MIN}..={DURATION_MAX}"
            )));
        }
        if let Some(period) = self.period
            && (!period.is_finite() || !(PERIOD_MIN..=PERIOD_MAX).contains(&period))
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 {slot_name}.period 须在 {PERIOD_MIN}..={PERIOD_MAX}"
            )));
        }
        if let Some(intensity) = self.intensity
            && (!intensity.is_finite() || !(INTENSITY_MIN..=INTENSITY_MAX).contains(&intensity))
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 {slot_name}.intensity 须在 {INTENSITY_MIN}..={INTENSITY_MAX}"
            )));
        }
        for (name, value) in [("delay", self.delay), ("phase", self.phase)] {
            if let Some(value) = value
                && !value.is_finite()
            {
                return Err(TimelineError::Invalid(format!(
                    "element {element_id} 的 {slot_name}.{name} 非法"
                )));
            }
        }
        if let Some(stagger) = self.stagger
            && (!stagger.is_finite() || stagger <= 0.0)
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 {slot_name}.stagger 须为正有限数"
            )));
        }
        if let Some(from) = &self.stagger_from
            && !["start", "end", "center"].contains(&from.as_str())
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 {slot_name}.staggerFrom 非法：{from}"
            )));
        }
        if slot_name == "loop" && (self.stagger.is_some() || self.stagger_from.is_some()) {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 loop 不接受 stagger/staggerFrom"
            )));
        }
        if let Some(ease) = &self.ease
            && !EASE_NAMES.contains(&ease.as_str())
        {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 {slot_name}.ease 非法：{ease}"
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Main {
    /// The source-clock clips remain for transcript mapping; media lives in ordinary elements.
    #[serde(default, skip_serializing_if = "is_false")]
    pub detached: bool,
    pub place: Option<Place>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub muted: bool,
    pub background: Option<Background>,
    /// 分离文档里普通视频元素所对齐的主源时长（0.10 新增）：拆分时落下，读时对账
    /// （[`crate::video_elements::follow_main_duration`]）跟着主源刷新。动画项目的主源是
    /// 现场合成，重渲一次时长就变；源末端正好落在这个值上的 main 视频元素跟到新末端。
    /// 缺席 = 老文档，不跟随、首次读到就记下当前值。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_duration: Option<f64>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn unique_id(ids: &mut HashSet<String>, id: &str) -> Result<(), TimelineError> {
    if ids.insert(id.to_owned()) {
        Ok(())
    } else {
        Err(TimelineError::Invalid(format!("重复 id：{id}")))
    }
}

pub(crate) fn validate_id(kind: &str, id: &str) -> Result<(), TimelineError> {
    if id.is_empty() || id.chars().any(char::is_whitespace) {
        Err(TimelineError::Invalid(format!("{kind} id 非法：{id}")))
    } else {
        Ok(())
    }
}

fn valid_anchor(value: &str) -> bool {
    crate::anchors::is_word_anchor(value)
}

pub fn schema_json() -> Value {
    let exit_presets_accepted = EXIT_PRESETS
        .iter()
        .chain(EXIT_LEGACY_PRESETS.iter())
        .copied()
        .collect::<Vec<_>>();
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "BaoCut timeline.json",
        "type": "object",
        "additionalProperties": false,
        "required": ["bcutTimeline"],
        "properties": {
            "bcutTimeline": {"enum": TIMELINE_VERSIONS},
            "sources": {
                "type": "object",
                "properties": {"main": {"$ref": "#/$defs/mainSource"}},
                "additionalProperties": {"$ref": "#/$defs/source"}
            },
            "clips": {"type": "array", "items": {"$ref": "#/$defs/clip"}},
            "tracks": {"type": "array", "items": {"$ref": "#/$defs/track"}},
            "main": {"$ref": "#/$defs/main"},
            "template": {"$ref": "#/$defs/template"}
        },
        "$defs": {
            "cut": {
                "type": "object", "additionalProperties": false,
                "required": ["id", "t0", "t1"],
                "properties": {"id": {"type": "string"}, "t0": {"type": "number", "minimum": 0}, "t1": {"type": "number", "exclusiveMinimum": 0}, "ref": {"type": "string"}}
            },
            "source": {
                "type": "object", "additionalProperties": false,
                "properties": {"path": {"type": "string"}, "hash": {"type": "string"}, "kind": {"enum": ["video", "image", "audio", "lottie"]}, "duration": {"type": "number", "minimum": 0}, "naturalW": {"type": "integer"}, "naturalH": {"type": "integer"}, "hasAudio": {"type": "boolean"}, "poster": {"type": "string"}, "cuts": {"type": "array", "items": {"$ref": "#/$defs/cut"}}, "origin": {"enum": SOURCE_ORIGINS}, "provenance": {"type": "string", "minLength": 1}}
            },
            "mainSource": {
                "type": "object", "additionalProperties": false,
                "properties": {"cuts": {"type": "array", "items": {"$ref": "#/$defs/cut"}}}
            },
            "clip": {
                "type": "object", "additionalProperties": false,
                "required": ["id", "in", "out"],
                "properties": {"id": {"type": "string"}, "srcId": {"type": "string", "default": "main"}, "in": {"type": "number", "minimum": 0}, "out": {"type": "number", "exclusiveMinimum": 0}, "rate": {"type": "number", "exclusiveMinimum": 0, "default": 1}}
            },
            "timeValue": {
                "oneOf": [
                    {"type": "number", "minimum": 0},
                    {"type": "string", "pattern": "^~[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+(?:(?::(?:start|end))(?:[+-](?:\\d+(?:\\.\\d+)?|\\.\\d+))?|\\+(?:\\d+(?:\\.\\d+)?|\\.\\d+))?$"}
                ]
            },
            "place": {
                "type": "object", "additionalProperties": false,
                "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "w": {"type": "number"}, "scale": {"type": "number"}, "scaleY": {"type": "number"}, "rot": {"type": "number"}, "opacity": {"type": "number"}, "radius": {"type": "number"}, "cornerRadii": {"$ref": "#/$defs/cornerRadii"}, "flipX": {"type": "boolean"}, "flipY": {"type": "boolean"}}
            },
            "cornerRadii": {
                "type": "object", "additionalProperties": false,
                "required": ["topLeft", "topRight", "bottomRight", "bottomLeft"],
                "properties": {
                    "topLeft": {"type": "number", "minimum": 0}, "topRight": {"type": "number", "minimum": 0},
                    "bottomRight": {"type": "number", "minimum": 0}, "bottomLeft": {"type": "number", "minimum": 0}
                }
            },
            "shapeProps": {
                "type": "object", "additionalProperties": false, "required": ["shape"],
                "properties": {
                    "shape": {"type": "string"}, "fill": {"type": "string"}, "stroke": {"type": "string"},
                    "strokeWidth": {"type": "number", "minimum": 0},
                    "cornerRadius": {"type": "array", "items": {"type": "number", "minimum": 0}, "minItems": 4, "maxItems": 4},
                    "h": {"type": "number"},
                    "x1": {"type": "number"}, "y1": {"type": "number"}, "x2": {"type": "number"}, "y2": {"type": "number"},
                    "head": {"enum": SHAPE_HEADS}
                }
            },
            "stickerProps": {
                "type": "object", "additionalProperties": false, "required": ["source"],
                "properties": {"source": {"enum": STICKER_SOURCES}, "templateId": {"type": "string"}, "path": {"type": "string"}, "loop": {"enum": STICKER_LOOPS}, "fillOverrides": {"type": "object", "additionalProperties": {"type": "string"}}}
            },
            "visualizerProps": {
                "type": "object", "additionalProperties": false, "required": ["style"],
                "properties": {
                    "style": {"type": "string"}, "mainColor": {"type": "string"}, "secondaryColor": {"type": "string"},
                    "fftSize": {"enum": VISUALIZER_FFT_SIZES}, "minDb": {"type": "number"}, "maxDb": {"type": "number"},
                    "smoothing": {"type": "number", "minimum": 0, "exclusiveMaximum": 1},
                    "gain": {"type": "number", "minimum": 0}, "audio": {"type": "string"},
                    "speaker": {"type": "string", "minLength": 1}, "alwaysShow": {"type": "boolean"}
                }
            },
            "progressProps": {
                "type": "object", "additionalProperties": false, "required": ["style"],
                "properties": {"style": {"type": "string"}, "mainColor": {"type": "string"}, "secondaryColor": {"type": "string"}, "startProgress": {"type": "number", "minimum": 0, "maximum": 1}, "endProgress": {"type": "number", "minimum": 0, "maximum": 1}}
            },
            "whiteboardProps": {
                "type": "object", "additionalProperties": false,
                "properties": {
                    "hand": {"enum": ["marker", "pen", "none"]}, "paper": {"type": "string"},
                    "draw": {"type": "number", "exclusiveMinimum": 0}, "inkFirst": {"type": "boolean"},
                    "pace": {"enum": ["stretch", "natural"]}, "strict": {"type": "boolean"},
                    "beats": {"type": "array", "maxItems": WHITEBOARD_MAX_BEATS, "items": {"$ref": "#/$defs/whiteboardBeat"}}
                }
            },
            "whiteboardBeat": {
                "type": "object", "additionalProperties": false, "required": ["at", "box"],
                "properties": {
                    "at": {"$ref": "#/$defs/timeValue"},
                    "end": {"$ref": "#/$defs/timeValue"},
                    "box": {"type": "array", "minItems": 4, "maxItems": 4, "items": {"type": "number"}},
                    "label": {"type": "string", "maxLength": WHITEBOARD_MAX_LABEL_CHARS}
                }
            },
            "confettiProps": {
                "type": "object", "additionalProperties": false, "required": ["style"],
                "properties": {
                    "style": {"type": "string"}, "seed": {"type": "integer", "minimum": 0},
                    "colors": {"type": "array", "minItems": 1, "maxItems": CONFETTI_MAX_COLORS, "items": {"type": "string"}},
                    "shapes": {"type": "array", "minItems": 1, "maxItems": CONFETTI_SHAPES.len(), "items": {"enum": CONFETTI_SHAPES}},
                    "size": {"type": "number", "minimum": CONFETTI_SCALE_RANGE.0, "maximum": CONFETTI_SCALE_RANGE.1},
                    "speed": {"type": "number", "minimum": CONFETTI_SCALE_RANGE.0, "maximum": CONFETTI_SCALE_RANGE.1},
                    "gravity": {"type": "number", "minimum": CONFETTI_GRAVITY_RANGE.0, "maximum": CONFETTI_GRAVITY_RANGE.1},
                    "drift": {"type": "number", "minimum": CONFETTI_RATE_SCALE_RANGE.0, "maximum": CONFETTI_RATE_SCALE_RANGE.1},
                    "spin": {"type": "number", "minimum": CONFETTI_RATE_SCALE_RANGE.0, "maximum": CONFETTI_RATE_SCALE_RANGE.1},
                    "wind": {"type": "number", "minimum": CONFETTI_WIND_RANGE.0, "maximum": CONFETTI_WIND_RANGE.1},
                    "opacity": {"type": "number", "minimum": 0, "maximum": 1},
                    "emit": {
                        "type": "object", "additionalProperties": false,
                        "properties": {
                            "mode": {"enum": ["continuous", "burst"]},
                            "rate": {"type": "number", "minimum": 1, "maximum": CONFETTI_MAX_RATE},
                            "count": {"type": "number", "minimum": 1, "maximum": CONFETTI_MAX_COUNT},
                            "interval": {"type": "number", "minimum": 0, "maximum": CONFETTI_MAX_INTERVAL},
                            "settle": {"type": "boolean"}
                        }
                    },
                    "origin": {
                        "type": "object", "additionalProperties": false, "required": ["x", "y"],
                        "properties": {
                            "x": {"type": "number", "minimum": CONFETTI_ORIGIN_RANGE.0, "maximum": CONFETTI_ORIGIN_RANGE.1},
                            "y": {"type": "number", "minimum": CONFETTI_ORIGIN_RANGE.0, "maximum": CONFETTI_ORIGIN_RANGE.1}
                        }
                    },
                    "angle": {"type": "number", "minimum": -180, "maximum": 180},
                    "spread": {"type": "number", "minimum": 0, "maximum": 360}
                }
            },
            "counterProps": {
                "type": "object", "additionalProperties": false, "required": ["mode"],
                "properties": {"mode": {"enum": ["countdown", "countup"]}, "format": {"enum": ["s", "mm:ss", "hh:mm:ss"]}}
            },
            "drawStroke": {
                "type": "object", "additionalProperties": false, "required": ["points"],
                "properties": {"points": {"type": "array", "items": {"type": "array", "items": {"type": "number", "minimum": 0, "maximum": 100}, "minItems": 2, "maxItems": 2}}}
            },
            "drawProps": {
                "type": "object", "additionalProperties": false, "required": ["brush", "color", "size"],
                "properties": {
                    "brush": {"enum": ["round", "sliced"]}, "color": {"type": "string"},
                    "size": {"type": "number", "minimum": 1, "maximum": 40},
                    "alpha": {"type": "number", "minimum": 0, "maximum": 1},
                    "strokes": {"type": "array", "maxItems": 256, "items": {"$ref": "#/$defs/drawStroke"}}
                }
            },
            "placeholderProps": {
                "type": "object", "additionalProperties": false, "required": ["variant"],
                "properties": {"variant": {"enum": ["camera", "media", "screen"]}, "notes": {"type": "string", "maxLength": 2048}}
            },
            "tile": {
                "type": "object", "additionalProperties": false, "required": ["on"],
                "properties": {"on": {"type": "boolean"}, "angle": {"type": "number"}, "gapX": {"type": "number"}, "gapY": {"type": "number"}, "stagger": {"type": "boolean"}}
            },
            "mask": {
                "type": "object", "additionalProperties": false, "required": ["shape"],
                "properties": {"shape": {"const": "ellipse"}, "feather": {"type": "number"}}
            },
            "fx": {
                "type": "object", "additionalProperties": false,
                "properties": {
                    "grayscale": {"type": "number", "minimum": 0, "maximum": 1}, "blur": {"type": "number", "minimum": 0, "maximum": 100},
                    "brightness": {"type": "number", "minimum": -1, "maximum": 1}, "contrast": {"type": "number", "minimum": -1, "maximum": 1},
                    "exposure": {"type": "number", "minimum": -1, "maximum": 1}, "hue": {"type": "number", "minimum": -1, "maximum": 1},
                    "saturation": {"type": "number", "minimum": -1, "maximum": 1}, "sharpen": {"type": "number", "minimum": 0, "maximum": 1},
                    "noise": {"type": "number", "minimum": 0, "maximum": 1}, "vignette": {"type": "number", "minimum": 0, "maximum": 1},
                    "filterPreset": {"enum": FILTER_PRESETS}, "effectPreset": {"enum": EFFECT_PRESETS},
                    "effectIntensity": {"type": "number", "minimum": 0, "maximum": 1}
                }
            },
            "enterAnimation": {
                "type": "object", "additionalProperties": false, "required": ["preset"],
                "properties": {
                    "preset": {"enum": ENTER_PRESETS}, "presetVersion": {"type": "integer", "minimum": 1},
                    "dur": {"type": "number", "minimum": 0.1, "maximum": 2.0}, "delay": {"type": "number"},
                    "intensity": {"type": "number", "minimum": 0, "maximum": 1}, "ease": {"enum": EASE_NAMES},
                    "stagger": {"type": "number", "exclusiveMinimum": 0}, "staggerFrom": {"enum": ["start", "end", "center"]},
                    "period": {"type": "number", "minimum": 0.2, "maximum": 6.0}, "phase": {"type": "number"}, "seed": {"type": "integer", "minimum": 0}
                }
            },
            "exitAnimation": {
                "type": "object", "additionalProperties": false, "required": ["preset"],
                "properties": {
                    "preset": {"enum": exit_presets_accepted}, "presetVersion": {"type": "integer", "minimum": 1},
                    "dur": {"type": "number", "minimum": 0.1, "maximum": 2.0}, "delay": {"type": "number"},
                    "intensity": {"type": "number", "minimum": 0, "maximum": 1}, "ease": {"enum": EASE_NAMES},
                    "stagger": {"type": "number", "exclusiveMinimum": 0}, "staggerFrom": {"enum": ["start", "end", "center"]},
                    "period": {"type": "number", "minimum": 0.2, "maximum": 6.0}, "phase": {"type": "number"}, "seed": {"type": "integer", "minimum": 0}
                }
            },
            "loopAnimation": {
                "type": "object", "additionalProperties": false, "required": ["preset"],
                "properties": {
                    "preset": {"enum": LOOP_PRESETS}, "presetVersion": {"type": "integer", "minimum": 1},
                    "dur": {"type": "number", "minimum": 0.1, "maximum": 2.0}, "delay": {"type": "number"},
                    "intensity": {"type": "number", "minimum": 0, "maximum": 1}, "ease": {"enum": EASE_NAMES},
                    "period": {"type": "number", "minimum": 0.2, "maximum": 6.0}, "phase": {"type": "number"}, "seed": {"type": "integer", "minimum": 0}
                }
            },
            "animation": {
                "type": "object", "additionalProperties": false,
                "properties": {"enter": {"$ref": "#/$defs/enterAnimation"}, "exit": {"$ref": "#/$defs/exitAnimation"}, "loop": {"$ref": "#/$defs/loopAnimation"}}
            },
            "videoTransition": {
                "type": "object", "additionalProperties": false, "required": ["k"],
                "properties": {"k": {"enum": crate::video_transitions::PRESETS}, "dur": {"type": "number", "minimum": 0.1, "maximum": 2.0, "default": 0.5}}
            },
            "videoTransitions": {
                "type": "object", "additionalProperties": false,
                "properties": {"in": {"$ref": "#/$defs/videoTransition"}, "out": {"$ref": "#/$defs/videoTransition"}}
            },
            "element": {
                "type": "object", "additionalProperties": false, "required": ["id", "kind"],
                "properties": {
                    "id": {"type": "string"}, "kind": {"enum": ELEMENT_KINDS}, "name": {"type": "string"},
                    "role": {"enum": ["broll", "watermark", "screentext", "overlay", "frame"]}, "start": {"$ref": "#/$defs/timeValue"}, "end": {"$ref": "#/$defs/timeValue"},
                    "place": {"$ref": "#/$defs/place"}, "verticalAlign": {"enum": ["top", "center", "bottom"]}, "srcId": {"type": "string"}, "srcStart": {"type": "number", "minimum": 0}, "rate": {"type": "number", "exclusiveMinimum": 0}, "muted": {"type": "boolean"}, "volume": {"type": "number"}, "audioFadeIn": {"type": "number", "minimum": 0, "maximum": 5}, "audioFadeOut": {"type": "number", "minimum": 0, "maximum": 5}, "bcfClip": {"type": "string", "minLength": 1},
                    "mode": {"enum": ["fullscreen", "pip"]}, "fit": {"enum": ["cover", "contain"]}, "bg": {"$ref": "#/$defs/background"},
                    "text": {"type": "string"}, "counter": {"$ref": "#/$defs/counterProps"}, "style": {"type": "object"}, "stylePresetId": {"type": "string"}, "source": {"enum": ["file", "html"]}, "html": {"type": "string"}, "tile": {"$ref": "#/$defs/tile"}, "mask": {"$ref": "#/$defs/mask"}, "fx": {"$ref": "#/$defs/fx"}, "animate": {"$ref": "#/$defs/animation"}, "ai": {"type": "object"},
                    "shape": {"$ref": "#/$defs/shapeProps"}, "sticker": {"$ref": "#/$defs/stickerProps"}, "visualizer": {"$ref": "#/$defs/visualizerProps"}, "progress": {"$ref": "#/$defs/progressProps"}, "draw": {"$ref": "#/$defs/drawProps"}, "placeholder": {"$ref": "#/$defs/placeholderProps"}, "confetti": {"$ref": "#/$defs/confettiProps"}, "whiteboard": {"$ref": "#/$defs/whiteboardProps"},
                    "hidden": {"type": "boolean"}, "transitions": {"$ref": "#/$defs/videoTransitions"},
                    "keyframes": {"$ref": "#/$defs/keyframes"}, "duck": {"$ref": "#/$defs/duck"}
                },
                "allOf": [
                    {"if": {"required": ["transitions"]}, "then": {"properties": {"kind": {"const": "video"}}}},
                    {"if": {"properties": {"kind": {"const": "text"}}, "required": ["kind"]}, "then": {"oneOf": [{"required": ["text"], "not": {"required": ["counter"]}}, {"required": ["counter"], "not": {"required": ["text"]}}]}},
                    {"if": {"properties": {"kind": {"enum": ["image", "video", "audio", "whiteboard"]}}, "required": ["kind"]}, "then": {"required": ["srcId"]}},
                    // element-props-mismatch：kind 与八组 props 一一对应（§5.1；0.6 加 confetti，0.8 加 whiteboard）。
                    {"if": {"properties": {"kind": {"const": "shape"}}, "required": ["kind"]},
                     "then": {"required": ["shape"], "not": {"anyOf": [{"required": ["sticker"]}, {"required": ["visualizer"]}, {"required": ["progress"]}, {"required": ["draw"]}, {"required": ["placeholder"]}, {"required": ["confetti"]}, {"required": ["whiteboard"]}]}}},
                    {"if": {"properties": {"kind": {"const": "sticker"}}, "required": ["kind"]},
                     "then": {"required": ["sticker"], "not": {"anyOf": [{"required": ["shape"]}, {"required": ["visualizer"]}, {"required": ["progress"]}, {"required": ["draw"]}, {"required": ["placeholder"]}, {"required": ["confetti"]}, {"required": ["whiteboard"]}]}}},
                    {"if": {"properties": {"kind": {"const": "visualizer"}}, "required": ["kind"]},
                     "then": {"required": ["visualizer"], "not": {"anyOf": [{"required": ["shape"]}, {"required": ["sticker"]}, {"required": ["progress"]}, {"required": ["draw"]}, {"required": ["placeholder"]}, {"required": ["confetti"]}, {"required": ["whiteboard"]}]}}},
                    {"if": {"properties": {"kind": {"const": "progress"}}, "required": ["kind"]},
                     "then": {"required": ["progress"], "not": {"anyOf": [{"required": ["shape"]}, {"required": ["sticker"]}, {"required": ["visualizer"]}, {"required": ["draw"]}, {"required": ["placeholder"]}, {"required": ["confetti"]}, {"required": ["whiteboard"]}]}}},
                    {"if": {"properties": {"kind": {"const": "draw"}}, "required": ["kind"]},
                     "then": {"required": ["draw"], "not": {"anyOf": [{"required": ["shape"]}, {"required": ["sticker"]}, {"required": ["visualizer"]}, {"required": ["progress"]}, {"required": ["placeholder"]}, {"required": ["confetti"]}, {"required": ["whiteboard"]}]}}},
                    {"if": {"properties": {"kind": {"const": "placeholder"}}, "required": ["kind"]},
                     "then": {"required": ["placeholder"], "not": {"anyOf": [{"required": ["shape"]}, {"required": ["sticker"]}, {"required": ["visualizer"]}, {"required": ["progress"]}, {"required": ["draw"]}, {"required": ["confetti"]}, {"required": ["whiteboard"]}]}}},
                    {"if": {"properties": {"kind": {"const": "confetti"}}, "required": ["kind"]},
                     "then": {"required": ["confetti"], "not": {"anyOf": [{"required": ["shape"]}, {"required": ["sticker"]}, {"required": ["visualizer"]}, {"required": ["progress"]}, {"required": ["draw"]}, {"required": ["placeholder"]}, {"required": ["whiteboard"]}]}}},
                    {"if": {"properties": {"kind": {"const": "whiteboard"}}, "required": ["kind"]},
                     "then": {"required": ["whiteboard"], "not": {"anyOf": [{"required": ["shape"]}, {"required": ["sticker"]}, {"required": ["visualizer"]}, {"required": ["progress"]}, {"required": ["draw"]}, {"required": ["placeholder"]}, {"required": ["confetti"]}]}}},
                    {"if": {"properties": {"kind": {"enum": ["text", "image", "video", "audio"]}}, "required": ["kind"]},
                     "then": {"not": {"anyOf": [{"required": ["shape"]}, {"required": ["sticker"]}, {"required": ["visualizer"]}, {"required": ["progress"]}, {"required": ["draw"]}, {"required": ["placeholder"]}, {"required": ["confetti"]}, {"required": ["whiteboard"]}]}}}
                ]
            },
            "track": {
                "type": "object", "additionalProperties": false, "required": ["id", "kind"],
                "properties": {"id": {"type": "string"}, "kind": {"enum": ["overlay", "audio"]}, "name": {"type": "string"}, "hidden": {"type": "boolean"}, "locked": {"type": "boolean"}, "muted": {"type": "boolean"}, "elements": {"type": "array", "items": {"$ref": "#/$defs/element"}}}
            },
            "main": {
                "type": "object", "additionalProperties": false,
                "properties": {"detached": {"type": "boolean"}, "place": {"$ref": "#/$defs/place"}, "muted": {"type": "boolean"}, "background": {"$ref": "#/$defs/background"}, "sourceDuration": {"type": "number", "exclusiveMinimum": 0}}
            },
            "background": {
                "anyOf": [
                    {"enum": ["blur", "black"]},
                    {"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"}
                ]
            },
            "keyframe": {
                "type": "object", "additionalProperties": false, "required": ["t", "v"],
                "properties": {
                    "t": {"oneOf": [
                        {"type": "number", "minimum": 0},
                        {"type": "string", "pattern": "^(?:\\d+(?:\\.\\d+)?|\\.\\d+)%$"}
                    ]},
                    "v": {"type": "number"},
                    "ease": {"enum": EASE_NAMES}
                }
            },
            "keyframeTrack": {"type": "array", "minItems": 1, "maxItems": crate::keyframes::KEYFRAMES_MAX_PER_PROP, "items": {"$ref": "#/$defs/keyframe"}},
            "keyframes": {
                "type": "object", "additionalProperties": false, "minProperties": 1,
                "properties": {
                    "x": {"$ref": "#/$defs/keyframeTrack"}, "y": {"$ref": "#/$defs/keyframeTrack"},
                    "scale": {"$ref": "#/$defs/keyframeTrack"}, "scaleY": {"$ref": "#/$defs/keyframeTrack"},
                    "rot": {"$ref": "#/$defs/keyframeTrack"}, "opacity": {"$ref": "#/$defs/keyframeTrack"},
                    "radius": {"$ref": "#/$defs/keyframeTrack"}, "volume": {"$ref": "#/$defs/keyframeTrack"}
                }
            },
            "duck": {
                "type": "object", "additionalProperties": false, "required": ["under"],
                "properties": {
                    "under": {"type": "string", "minLength": 1},
                    "depth": {"type": "number", "minimum": crate::duck::DUCK_DEPTH_RANGE.0, "maximum": crate::duck::DUCK_DEPTH_RANGE.1, "default": crate::duck::DUCK_DEPTH_DEFAULT},
                    "attack": {"type": "number", "minimum": crate::duck::DUCK_TIME_RANGE.0, "maximum": crate::duck::DUCK_TIME_RANGE.1, "default": crate::duck::DUCK_ATTACK_DEFAULT},
                    "release": {"type": "number", "minimum": crate::duck::DUCK_TIME_RANGE.0, "maximum": crate::duck::DUCK_TIME_RANGE.1, "default": crate::duck::DUCK_RELEASE_DEFAULT}
                }
            },
            "color": {"type": "string", "pattern": "^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$"},
            "layerBox": {
                "type": "object", "additionalProperties": false, "required": ["x", "y", "w", "h"],
                "properties": {"x": {"type": "number", "minimum": 0, "maximum": 100}, "y": {"type": "number", "minimum": 0, "maximum": 100}, "w": {"type": "number", "minimum": 4, "maximum": 100}, "h": {"type": "number", "minimum": 0.6, "maximum": 100}}
            },
            "logoSrc": {
                "oneOf": [
                    {"const": "text"},
                    {"type": "object", "additionalProperties": false, "required": ["brandLogo"], "properties": {"brandLogo": {"type": "string"}}},
                    {"type": "object", "additionalProperties": false, "required": ["file"], "properties": {"file": {"type": "string"}}}
                ]
            },
            "templateLayer": {
                "type": "object", "required": ["id", "kind", "box"],
                "properties": {
                    "id": {"type": "string"}, "on": {"type": "boolean", "default": true}, "box": {"$ref": "#/$defs/layerBox"},
                    "kind": {"enum": ["chapters", "progress", "logo", "text"]}
                },
                "allOf": [
                    {"if": {"properties": {"kind": {"const": "chapters"}}, "required": ["kind"]},
                     "then": {"required": ["bg", "color", "accent"], "properties": {"fill": {"enum": ["bar", "dim"], "default": "bar"}, "bg": {"$ref": "#/$defs/color"}, "color": {"$ref": "#/$defs/color"}, "accent": {"$ref": "#/$defs/color"}, "colorDone": {"$ref": "#/$defs/color"}, "divider": {"type": "boolean", "default": true}, "size": {"type": "number", "exclusiveMinimum": 0, "default": 2.6}}}},
                    {"if": {"properties": {"kind": {"const": "progress"}}, "required": ["kind"]},
                     "then": {"required": ["accent", "track"], "properties": {"accent": {"$ref": "#/$defs/color"}, "track": {"$ref": "#/$defs/color"}}}},
                    {"if": {"properties": {"kind": {"const": "logo"}}, "required": ["kind"]},
                     "then": {"required": ["color"], "properties": {"src": {"$ref": "#/$defs/logoSrc"}, "text": {"type": "string"}, "bg": {"$ref": "#/$defs/color"}, "color": {"$ref": "#/$defs/color"}, "shape": {"enum": ["badge", "plain"], "default": "badge"}, "align": {"enum": ["left", "center", "right"], "default": "center"}, "size": {"type": "number", "exclusiveMinimum": 0, "default": 3}, "pad": {"type": "number", "minimum": 0}}}},
                    {"if": {"properties": {"kind": {"const": "text"}}, "required": ["kind"]},
                     "then": {"required": ["text", "color"], "properties": {"text": {"type": "string"}, "color": {"$ref": "#/$defs/color"}, "bg": {"$ref": "#/$defs/color"}, "align": {"enum": ["left", "center", "right"], "default": "left"}, "size": {"type": "number", "exclusiveMinimum": 0, "default": 2.8}, "pad": {"type": "number", "minimum": 0}, "mono": {"type": "boolean", "default": false}, "weight": {"type": "integer", "minimum": 100, "maximum": 900, "default": 700}}}}
                ]
            },
            "template": {
                "type": "object", "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string"}, "name": {"type": "string"},
                    "hue": {"enum": crate::template::HUES, "default": "gray"},
                    "canvas": {"enum": ["16:9", "9:16"], "default": "16:9"},
                    "ratio": {"type": "string", "description": "套用时把项目画幅改成 original 或 W:H；缺省不改"},
                    "lockRatio": {"type": "boolean", "default": false, "description": "与 ratio 同时为真时锁住项目画幅：舞台 / 项目设置 / bcut project canvas 只允许改成 ratio 本身"},
                    "builtin": {"type": "boolean", "default": false},
                    "desc": {"type": "string"},
                    "font": {"type": "string"},
                    "from": {"type": "string"},
                    "subsAvoid": {"type": "boolean", "default": true},
                    "layers": {"type": "array", "items": {"$ref": "#/$defs/templateLayer"}}
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// §4 的量化裁决：`end − time` 的浮点差带残差、方向随两端各自的浮点表示
    /// 走（`8.05 − 1.05 = 7.000000000000001` 抬、`34.12 − 25.12 =
    /// 8.999999999999996` 压），裸 `ceil` 会在前者上多读一秒，三端可能在
    /// 同一帧给出不同读数。毫秒栅格上边界归属无歧义。
    #[test]
    fn counter_boundaries_are_judged_on_the_millisecond_grid() {
        // 前提真的成立：这一对的裸浮点差会把 7 抬成 8。
        assert_eq!((8.05_f64 - 1.05_f64).ceil(), 8.0);
        let countdown = CounterProps {
            mode: CounterMode::Countdown,
            format: CounterFormat::Seconds,
        };
        assert_eq!(countdown.value_at(1.05, 8.05, 1.05), 7);
        // §3.1 的 24.12…34.12 算例：起点读满长、中途逐秒、临近终点读 1
        //（0 属于窗外，由半开窗口裁掉，ADR-CT02）。
        assert_eq!(countdown.value_at(24.12, 34.12, 24.12), 10);
        assert_eq!(countdown.value_at(24.12, 34.12, 25.12), 9);
        assert_eq!(countdown.value_at(24.12, 34.12, 34.0), 1);
        let countup = CounterProps {
            mode: CounterMode::Countup,
            format: CounterFormat::MinutesSeconds,
        };
        assert_eq!(countup.value_at(24.12, 34.12, 25.12), 1);
        assert_eq!(countup.text_at(24.12, 34.12, 25.12), "00:01");
        // `mm:ss` 不进位到小时（§3）：选了这一档就不该突然冒出小时段。
        assert_eq!(countup.text_at(0.0, 7000.0, 6000.0), "100:00");
    }

    /// 空白项目先 clip add 旁白、再把同一文件转录成项目媒体：主轨 clip 指着副本源，
    /// main 的转录词没有承载 clip，字幕整层消失。同 hash 的音视频源并回 main；
    /// 图片源、别的文件、两边都有 cuts 的源不动。
    #[test]
    fn a_source_identical_to_the_project_media_folds_back_into_main() {
        let mut document: TimelineDocument = serde_json::from_value(json!({
            "bcutTimeline": TIMELINE_VERSION,
            "sources": {
                "src-a1": {"path": "/a/narration.wav", "hash": "sha256-same", "kind": "audio",
                           "duration": 10.0, "cuts": [{"id": "cut-1", "t0": 1.0, "t1": 2.0}]},
                "src-a2": {"path": "/a/other.wav", "hash": "sha256-other", "kind": "audio", "duration": 5.0},
                "src-a3": {"path": "/a/board.png", "hash": "sha256-same", "kind": "image"}
            },
            "clips": [
                {"id": "c2", "srcId": "src-a1", "in": 0.0, "out": 10.0},
                {"id": "c3", "srcId": "src-a2", "in": 0.0, "out": 5.0}
            ]
        }))
        .unwrap();
        document.validate().unwrap();

        assert!(document.fold_main_duplicates(None).is_empty());
        assert_eq!(
            document.fold_main_duplicates(Some("sha256-same")),
            vec!["src-a1"]
        );
        document.validate().unwrap();
        assert_eq!(document.clips[0].src_id, "main");
        assert_eq!(document.clips[1].src_id, "src-a2");
        assert!(!document.sources.contains_key("src-a1"));
        assert!(document.sources.contains_key("src-a3"));
        assert_eq!(document.sources["main"].cuts[0].id, "cut-1");
        // 幂等：再跑一次什么也不改。
        assert!(
            document
                .fold_main_duplicates(Some("sha256-same"))
                .is_empty()
        );
    }

    /// `EASE_NAMES` 迁到 `motion::curve` 之后，Timeline 的 JSON Schema
    /// 契约不得移动：`bcut spec` 的 timelineSchema 是对外承诺。
    #[test]
    fn the_ease_enum_in_the_schema_is_the_frozen_appendix_a_table() {
        let expected = json!([
            "linear",
            "easeInQuad",
            "easeOutQuad",
            "easeInOutQuad",
            "easeInCubic",
            "easeOutCubic",
            "easeInOutCubic",
            "easeInQuart",
            "easeOutQuart",
            "easeInOutQuart",
            "easeInExpo",
            "easeOutExpo",
            "easeInOutExpo",
            "easeInSine",
            "easeOutSine",
            "easeInOutSine",
            "easeInBack",
            "easeOutBack",
            "easeInOutBack",
            "easeOutElastic"
        ]);
        assert_eq!(json!(EASE_NAMES), expected);
        let schema = schema_json();
        for slot in ["enterAnimation", "exitAnimation", "loopAnimation"] {
            assert_eq!(
                schema["$defs"][slot]["properties"]["ease"],
                json!({ "enum": EASE_NAMES }),
                "{slot}"
            );
        }
    }

    /// 三个槽各查各的词表：exit 收 `sink`（第 156 轮之前借入场词表校验会拒），
    /// 0.1 兼容名 `pop` 仍可读入，`wave` 只有入场配方所以 exit 槽拒。
    #[test]
    fn each_animation_slot_validates_against_its_own_vocabulary() {
        let schema = schema_json();
        assert!(
            schema["$defs"]["enterAnimation"]["properties"]["preset"]["enum"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v == "wave")
        );
        let exit_enum = schema["$defs"]["exitAnimation"]["properties"]["preset"]["enum"]
            .as_array()
            .unwrap()
            .clone();
        assert!(exit_enum.iter().any(|v| v == "sink"));
        assert!(exit_enum.iter().any(|v| v == "pop"));
        assert!(!exit_enum.iter().any(|v| v == "wave"));
        let slot = |preset: &str| AnimationSlot {
            preset: preset.to_owned(),
            preset_version: None,
            dur: None,
            delay: None,
            intensity: None,
            ease: None,
            stagger: None,
            stagger_from: None,
            period: None,
            phase: None,
            seed: None,
        };
        let anim = |enter: Option<&str>, exit: Option<&str>| Animation {
            enter: enter.map(slot),
            exit: exit.map(slot),
            r#loop: None,
        };
        assert!(anim(Some("rise"), Some("sink")).validate("el-14").is_ok());
        assert!(anim(None, Some("pop")).validate("el-14").is_ok());
        assert!(anim(Some("sink"), None).validate("el-14").is_err());
        assert!(anim(None, Some("wave")).validate("el-14").is_err());
    }

    #[test]
    fn minimal_document_round_trips_and_unknown_fields_fail() {
        let document: TimelineDocument = serde_json::from_str(r#"{"bcutTimeline":"0.1"}"#).unwrap();
        assert_eq!(document, TimelineDocument::default());
        document.validate().unwrap();
        assert!(
            serde_json::from_str::<TimelineDocument>(r#"{"bcutTimeline":"0.1","unknown":true}"#)
                .is_err()
        );
    }

    /// 0.11：AI 生成的素材带 `origin: "ai"` 与出处侧车路径；缺省时一个键都不写，
    /// 旧文档读入写出只差版本号。
    #[test]
    fn ai_sources_round_trip_origin_and_provenance() {
        let text = format!(
            r#"{{"bcutTimeline":"{TIMELINE_VERSION}","sources":{{"ai1":{{"path":"assets/图片-001-glm-image-7.png","kind":"image","naturalW":1024,"naturalH":1024,"origin":"ai","provenance":"assets/图片-001-glm-image-7.json"}},"s2":{{"path":"b.png","kind":"image"}}}}}}"#
        );
        let doc: TimelineDocument = serde_json::from_str(&text).unwrap();
        doc.validate().unwrap();
        let ai = &doc.sources["ai1"];
        assert_eq!(ai.origin.as_deref(), Some("ai"));
        assert_eq!(
            ai.provenance.as_deref(),
            Some("assets/图片-001-glm-image-7.json")
        );
        assert_eq!(serde_json::to_string(&doc).unwrap(), text);
        let plain = serde_json::to_value(&doc.sources["s2"]).unwrap();
        assert!(plain.get("origin").is_none() && plain.get("provenance").is_none());

        for (field, value) in [("origin", json!("stock")), ("provenance", json!(" "))] {
            let mut bad = serde_json::to_value(&doc).unwrap();
            bad["sources"]["ai1"][field] = value;
            let bad: TimelineDocument = serde_json::from_value(bad).unwrap();
            assert!(bad.validate().is_err(), "{field} 应被拒");
        }
        let schema = schema_json();
        assert_eq!(
            schema["$defs"]["source"]["properties"]["origin"],
            json!({"enum": ["ai"]})
        );
    }

    /// `element` 同时受 `deny_unknown_fields` 与 schema 的 `additionalProperties: false`
    /// 约束，两者必须同进同退：手写 schema 漏掉一个字段，Rust 收得下的文档会被
    /// `bcut spec` 的 timelineSchema 判非法。
    #[test]
    fn the_element_schema_carries_the_vertical_anchor_the_struct_accepts() {
        let element: Element = serde_json::from_str(
            r#"{"id":"e1","kind":"text","text":"hi","verticalAlign":"bottom"}"#,
        )
        .unwrap();
        assert_eq!(element.vertical_align.as_deref(), Some("bottom"));
        assert_eq!(
            schema_json()["$defs"]["element"]["properties"]["verticalAlign"],
            json!({"enum": ["top", "center", "bottom"]})
        );
    }

    #[test]
    fn html_watermark_provenance_is_validated_and_present_in_schema() {
        let element: Element = serde_json::from_str(
            r#"{"id":"e1","kind":"image","srcId":"src-a1","source":"html","html":"<b>hi</b>"}"#,
        )
        .unwrap();
        let mut ids = HashSet::new();
        element.validate(&mut ids).unwrap();
        assert_eq!(
            schema_json()["$defs"]["element"]["properties"]["source"],
            json!({"enum": ["file", "html"]})
        );
        assert_eq!(
            schema_json()["$defs"]["element"]["properties"]["html"],
            json!({"type": "string"})
        );

        let invalid: Element = serde_json::from_str(
            r#"{"id":"e2","kind":"image","srcId":"src-a2","source":"file","html":"<b>hi</b>"}"#,
        )
        .unwrap();
        assert!(invalid.validate(&mut HashSet::new()).is_err());

        let invalid_source: Element = serde_json::from_str(
            r#"{"id":"e3","kind":"image","srcId":"src-a3","source":"remote"}"#,
        )
        .unwrap();
        assert!(invalid_source.validate(&mut HashSet::new()).is_err());
    }

    #[test]
    fn text_watermark_is_a_valid_role_kind_pair() {
        let element: Element = serde_json::from_str(
            r#"{"id":"wm-text","kind":"text","role":"watermark","text":"BaoCut"}"#,
        )
        .unwrap();
        element.validate(&mut HashSet::new()).unwrap();
    }

    #[test]
    fn timeline_0_1_explicitly_rejects_unversioned_clip_transitions() {
        for field in ["transitionIn", "transitionOut"] {
            let source = format!(
                r#"{{
                    "bcutTimeline":"0.1",
                    "clips":[{{
                        "id":"c1","in":0.0,"out":1.0,
                        "{field}":{{"preset":"fade","duration":0.25}}
                    }}]
                }}"#,
            );
            let error = serde_json::from_str::<TimelineDocument>(&source).unwrap_err();
            assert!(error.to_string().contains(field), "{field}: {error}");
        }
    }

    /// 0.7 Lottie 源：`sources[].kind:"lottie"` round-trip，只有素材贴纸能引用；
    /// 主轨 clip 与 image / video / audio 元素引用它都在校验期报错。
    #[test]
    fn lottie_sources_are_only_referenced_by_asset_stickers() {
        let source: Source = serde_json::from_str(
            r#"{"path":"anim.json","kind":"lottie","duration":2.0,"naturalW":200,"naturalH":200,"hasAudio":false}"#,
        )
        .unwrap();
        assert_eq!(source.kind, Some(SourceKind::Lottie));
        assert_eq!(
            serde_json::to_value(SourceKind::Lottie).unwrap(),
            json!("lottie")
        );
        assert_eq!(
            schema_json()["$defs"]["source"]["properties"]["kind"],
            json!({"enum": ["video", "image", "audio", "lottie"]})
        );

        let with_element = |element: &str| -> String {
            format!(
                r#"{{"bcutTimeline":"0.7","sources":{{"s1":{{"path":"anim.json","kind":"lottie","duration":2.0}}}},"tracks":[{{"id":"t1","kind":"overlay","elements":[{element}]}}]}}"#
            )
        };
        let ok: TimelineDocument = serde_json::from_str(&with_element(
            r#"{"id":"e1","kind":"sticker","srcId":"s1","sticker":{"source":"asset","loop":"once"}}"#,
        ))
        .unwrap();
        ok.validate().unwrap();
        assert!(ok.tracks[0].elements[0].is_asset_sticker());

        for (element, why) in [
            (
                r#"{"id":"e1","kind":"image","srcId":"s1"}"#,
                "image 元素不能引用 lottie",
            ),
            (
                r#"{"id":"e1","kind":"video","srcId":"s1"}"#,
                "video 元素不能引用 lottie",
            ),
            (
                r#"{"id":"e1","kind":"placeholder","srcId":"s1","placeholder":{"variant":"camera"}}"#,
                "placeholder 不能引用 lottie",
            ),
            (
                r#"{"id":"e1","kind":"sticker","srcId":"s1","sticker":{"source":"template","templateId":"box"}}"#,
                "模板贴纸不能引用 lottie",
            ),
        ] {
            let document: TimelineDocument = serde_json::from_str(&with_element(element)).unwrap();
            let error = document.validate().unwrap_err();
            assert!(error.to_string().contains("lottie"), "{why}: {error}");
        }

        let clip: TimelineDocument = serde_json::from_str(
            r#"{"bcutTimeline":"0.7","sources":{"s1":{"path":"anim.json","kind":"lottie","duration":2.0}},"clips":[{"id":"c1","srcId":"s1","in":0.0,"out":1.0}]}"#,
        )
        .unwrap();
        let error = clip.validate().unwrap_err();
        assert!(error.to_string().contains("lottie"), "{error}");
    }

    #[test]
    fn main_rejects_duplicated_media_identity() {
        let document: TimelineDocument = serde_json::from_str(
            r#"{"bcutTimeline":"0.1","sources":{"main":{"path":"movie.mp4"}}}"#,
        )
        .unwrap();
        assert!(document.validate().is_err());
    }

    // ── 0.2 元素契约（设计 §5）─────────────────────────────────────────

    fn element(json: &str) -> Element {
        serde_json::from_str(json).unwrap()
    }

    /// 11 值枚举 round-trip：serde 名、`as_str()` 与 JSON Schema 的 enum 是
    /// **同一张表**，三处任一处漏掉一个值都会让另外两处失真。
    #[test]
    fn the_element_kind_enum_round_trips_all_twelve_values() {
        let kinds = [
            ElementKind::Text,
            ElementKind::Image,
            ElementKind::Video,
            ElementKind::Audio,
            ElementKind::Shape,
            ElementKind::Sticker,
            ElementKind::Visualizer,
            ElementKind::Progress,
            ElementKind::Draw,
            ElementKind::Placeholder,
            ElementKind::Confetti,
            ElementKind::Whiteboard,
        ];
        assert_eq!(kinds.len(), ELEMENT_KINDS.len());
        for (kind, name) in kinds.into_iter().zip(ELEMENT_KINDS) {
            assert_eq!(kind.as_str(), *name);
            assert_eq!(serde_json::to_value(kind).unwrap(), json!(name));
            assert_eq!(
                serde_json::from_value::<ElementKind>(json!(name)).unwrap(),
                kind
            );
        }
        assert_eq!(
            schema_json()["$defs"]["element"]["properties"]["kind"],
            json!({"enum": ELEMENT_KINDS})
        );
        // 封闭枚举：未知 kind 在解析期就错，不做 open enum（ADR-E02）。
        assert!(serde_json::from_value::<ElementKind>(json!("motion")).is_err());
        assert!(
            serde_json::from_str::<Element>(r#"{"id":"e1","kind":"motion"}"#).is_err(),
            "未知 kind 必须解析期报错"
        );
    }

    /// 六组 props 的 serde 名一律 camelCase，且缺省字段不出现在输出里。
    #[test]
    fn the_six_props_structs_serialize_as_camel_case() {
        let shape = element(
            r##"{"id":"e1","kind":"shape","shape":{"shape":"rect","fill":"#112233",
                "stroke":"#00000080","strokeWidth":3,"cornerRadius":[1,2,3,4],"h":25,
                "x1":0,"y1":10,"x2":100,"y2":90,"head":"arrow"}}"##,
        );
        let props = shape.shape.as_ref().unwrap();
        assert_eq!(props.shape, "rect");
        assert_eq!(props.stroke_width(), 3.0);
        assert_eq!(props.corner_radius(), [1.0, 2.0, 3.0, 4.0]);
        assert_eq!(props.h, Some(25.0));
        assert_eq!(props.endpoints(), [0.0, 10.0, 100.0, 90.0]);
        assert_eq!(props.head.as_deref(), Some("arrow"));
        let round_tripped = serde_json::to_value(props).unwrap();
        for key in [
            "shape",
            "fill",
            "stroke",
            "strokeWidth",
            "cornerRadius",
            "h",
            "x1",
            "y1",
            "x2",
            "y2",
            "head",
        ] {
            assert!(round_tripped.get(key).is_some(), "缺 {key}");
        }

        let sticker = element(
            r##"{"id":"e2","kind":"sticker","sticker":{"source":"template","templateId":"box","loop":"once","fillOverrides":{"#ffffff":"#112233"}}}"##,
        );
        let props = sticker.sticker.as_ref().unwrap();
        assert_eq!(props.template_id.as_deref(), Some("box"));
        assert_eq!(props.loop_mode(), "once");
        assert_eq!(
            serde_json::to_value(props).unwrap(),
            json!({"source": "template", "templateId": "box", "loop": "once", "fillOverrides": {"#ffffff": "#112233"}})
        );
        // 缺省 loop 不写出，读时补 "loop"。
        assert_eq!(StickerProps::new("asset").loop_mode(), STICKER_LOOP_DEFAULT);
        assert_eq!(
            serde_json::to_value(StickerProps::new("asset")).unwrap(),
            json!({"source": "asset"})
        );

        let visualizer = element(
            r##"{"id":"e3","kind":"visualizer","visualizer":{"style":"bars",
                "mainColor":"#ff0000","secondaryColor":"#00ff00","fftSize":512,
                "minDb":-120,"maxDb":-10,"smoothing":0.5,"gain":1.5,"audio":"src-a",
                "speaker":"spk-1","alwaysShow":false}}"##,
        );
        let props = visualizer.visualizer.as_ref().unwrap();
        assert_eq!(
            (
                props.fft_size(),
                props.min_db(),
                props.max_db(),
                props.smoothing(),
                props.gain(),
                props.audio()
            ),
            (512, -120.0, -10.0, 0.5, 1.5, "src-a")
        );
        assert!(
            serde_json::to_value(props)
                .unwrap()
                .get("fftSize")
                .is_some()
        );
        assert_eq!(props.speaker.as_deref(), Some("spk-1"));
        assert!(!props.always_show());
        // **新建默认**这一组（§5.2）。
        let bare = VisualizerProps::new("bars");
        assert_eq!(
            (
                bare.fft_size(),
                bare.min_db(),
                bare.max_db(),
                bare.smoothing(),
                bare.gain(),
                bare.audio()
            ),
            (1024, -80.0, 40.0, 0.8, 1.0, "project")
        );
        assert_eq!(
            serde_json::to_value(&bare).unwrap(),
            json!({"style": "bars"})
        );
        // dB 窗按款取：示波器两款是 −120 / −10，不是全表那一组。
        for style in ["oscilloscope", "ring_wave"] {
            let bare = VisualizerProps::new(style);
            assert_eq!((bare.min_db(), bare.max_db()), (-120.0, -10.0), "{style}");
        }
        assert_eq!(visualizer_db_window("bars"), (-80.0, 40.0));
        // 旧文档里的旧款名经别名表落到新款，dB 窗跟着新款走。
        assert_eq!(visualizer_db_window("beam"), (-120.0, -10.0));
        assert_eq!(visualizer_db_window("formation"), (-80.0, 40.0));
        // 查不到的样式回落到全表兜底（`style` 校验会先拦下这种元素）。
        assert_eq!(
            visualizer_db_window("nope"),
            (VISUALIZER_MIN_DB_DEFAULT, VISUALIZER_MAX_DB_DEFAULT)
        );
        // 只写了 `minDb` 的老文档不因按款缺省变成非法（校验只看写下来的那一对）。
        assert!(
            element(r#"{"id":"e5","kind":"visualizer","visualizer":{"style":"oscilloscope","minDb":-5}}"#)
                .validate(&mut HashSet::new())
                .is_ok()
        );

        let progress = element(
            r##"{"id":"e4","kind":"progress","progress":{"style":"rounded","mainColor":"#fff000","secondaryColor":"#000fff","startProgress":0.8,"endProgress":0.2}}"##,
        );
        assert_eq!(
            serde_json::to_value(progress.progress.as_ref().unwrap()).unwrap(),
            json!({"style": "rounded", "mainColor": "#fff000", "secondaryColor": "#000fff", "startProgress": 0.8, "endProgress": 0.2})
        );
        assert!((progress.progress.as_ref().unwrap().remap(0.25) - 0.65).abs() < 1e-9);

        let draw = element(
            r##"{"id":"e5","kind":"draw","draw":{"brush":"round","color":"#ff000080","size":12,"alpha":0.5,"strokes":[{"points":[[0,0],[50,75],[100,100]]}]}}"##,
        );
        assert_eq!(draw.draw.as_ref().unwrap().strokes[0].points.len(), 3);
        assert!(
            serde_json::to_value(draw.draw.as_ref().unwrap())
                .unwrap()
                .get("strokes")
                .is_some()
        );

        let placeholder = element(
            r#"{"id":"e6","kind":"placeholder","placeholder":{"variant":"screen","notes":"Demo"}}"#,
        );
        assert_eq!(
            serde_json::to_value(placeholder.placeholder.as_ref().unwrap()).unwrap(),
            json!({"variant": "screen", "notes": "Demo"})
        );
        // 每组 props 自己也 deny_unknown_fields。
        assert!(
            serde_json::from_str::<Element>(
                r#"{"id":"e7","kind":"progress","progress":{"style":"rounded","bars":16}}"#
            )
            .is_err()
        );

        // 0.6 confetti：只写用户改过的字段，缺席即配方缺省；写错模式的 emit
        // 字段允许存在（切换模式时保留另一边的值）。
        let confetti = element(
            r##"{"id":"e8","kind":"confetti","confetti":{"style":"rainbow-paper","seed":7391026451,"colors":["#FF476F","#FFCA3A"],"shapes":["rect","strip"],"size":1.25,"gravity":-0.5,"wind":40,"emit":{"mode":"burst","rate":60,"count":80,"interval":0,"settle":true},"origin":{"x":-10,"y":110},"angle":-90,"spread":45}}"##,
        );
        let props = confetti.confetti.as_ref().unwrap();
        assert_eq!(props.seed, Some(7391026451));
        assert_eq!(props.emit_mode(), Some(ConfettiEmitMode::Burst));
        assert_eq!(
            serde_json::to_value(props).unwrap(),
            json!({"style": "rainbow-paper", "seed": 7391026451u64, "colors": ["#FF476F", "#FFCA3A"], "shapes": ["rect", "strip"], "size": 1.25, "gravity": -0.5, "wind": 40.0, "emit": {"mode": "burst", "rate": 60.0, "count": 80.0, "interval": 0.0, "settle": true}, "origin": {"x": -10.0, "y": 110.0}, "angle": -90.0, "spread": 45.0})
        );
        assert_eq!(
            serde_json::to_value(ConfettiProps::new("pastel-fall")).unwrap(),
            json!({"style": "pastel-fall"})
        );
        assert!(
            serde_json::from_str::<Element>(
                r#"{"id":"e9","kind":"confetti","confetti":{"style":"rainbow-paper","emit":{"mode":"loop"}}}"#
            )
            .is_err(),
            "emit.mode 是封闭枚举"
        );
        assert!(
            serde_json::from_str::<Element>(
                r#"{"id":"e9","kind":"confetti","confetti":{"style":"rainbow-paper","density":3}}"#
            )
            .is_err(),
            "confetti props deny_unknown_fields"
        );
    }

    /// `kind` 与 props 一一对应；两个方向都报 `element-props-mismatch`。
    #[test]
    fn the_props_are_mutually_exclusive_with_the_kind() {
        for (source, why) in [
            (
                r#"{"id":"e1","kind":"shape"}"#,
                "kind=shape 却没有 shape props",
            ),
            (
                r#"{"id":"e1","kind":"text","text":"hi","shape":{"shape":"rect"}}"#,
                "text 带 shape props",
            ),
            (
                r#"{"id":"e1","kind":"shape","shape":{"shape":"rect"},"progress":{"style":"normal"}}"#,
                "shape 同时带 progress props",
            ),
            (
                r#"{"id":"e1","kind":"visualizer","sticker":{"source":"asset"}}"#,
                "visualizer 带 sticker props",
            ),
            (
                r##"{"id":"e1","kind":"draw","draw":{"brush":"round","color":"#ffffff","size":4},"placeholder":{"variant":"media"}}"##,
                "draw 同时带 placeholder props",
            ),
            (
                r#"{"id":"e1","kind":"confetti"}"#,
                "kind=confetti 却没有 confetti props",
            ),
            (
                r#"{"id":"e1","kind":"sticker","sticker":{"source":"asset","path":"a.png"},"confetti":{"style":"rainbow-paper"}}"#,
                "sticker 同时带 confetti props",
            ),
            (
                r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper"},"progress":{"style":"normal"}}"#,
                "confetti 同时带 progress props",
            ),
            (
                r#"{"id":"e1","kind":"whiteboard","srcId":"s1"}"#,
                "kind=whiteboard 却没有 whiteboard props",
            ),
            (
                r#"{"id":"e1","kind":"image","srcId":"s1","whiteboard":{}}"#,
                "image 带 whiteboard props",
            ),
        ] {
            let error = element(source).validate(&mut HashSet::new()).unwrap_err();
            assert!(
                error.to_string().contains(ELEMENT_PROPS_MISMATCH),
                "{why}: {error}"
            );
        }
        // 正例：八种 kind 各带自己的 props 就通过。
        for source in [
            r#"{"id":"e1","kind":"shape","shape":{"shape":"rect"}}"#,
            r#"{"id":"e1","kind":"sticker","sticker":{"source":"asset","path":"a.png"}}"#,
            r#"{"id":"e1","kind":"visualizer","visualizer":{"style":"bars"}}"#,
            r#"{"id":"e1","kind":"progress","progress":{"style":"normal"}}"#,
            r##"{"id":"e1","kind":"draw","draw":{"brush":"sliced","color":"#ffffff","size":1}}"##,
            r#"{"id":"e1","kind":"placeholder","placeholder":{"variant":"camera"}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper"}}"#,
            r##"{"id":"e1","kind":"whiteboard","srcId":"s1","whiteboard":{"hand":"pen","paper":"#F5EBD7","draw":4,"inkFirst":false,"beats":[{"at":0,"box":[0,0,50,100]},{"at":2,"box":[50,0,50,100]}]}}"##,
            // 白板与 image 同路：mode / fit / mask / fx 都收（`bcut element add --mode fullscreen`）。
            r#"{"id":"e1","kind":"whiteboard","srcId":"s1","mode":"fullscreen","fit":"contain","mask":{"shape":"ellipse"},"fx":{"grayscale":1},"whiteboard":{}}"#,
        ] {
            element(source).validate(&mut HashSet::new()).unwrap();
        }
    }

    /// Timeline 0.9 白板节拍：`pace` / `strict` / `end` / `label` 与 `at` / `end` 的词锚点写法；
    /// 0.8 的数字写法原样读入（缺省 = 老行为），不含新字段的元素写出与 0.8 只差 version。
    #[test]
    fn whiteboard_beats_accept_0_9_fields_and_word_anchors() {
        let source = r##"{"id":"e1","kind":"whiteboard","srcId":"s1","whiteboard":{"draw":9.2,"pace":"natural","strict":true,"beats":[{"at":"~main:g1.1:start","end":"~main:g1.4:end","box":[0,0,50,100],"label":"第一步"},{"at":3.2,"end":6.3,"box":[50,0,50,100]},{"at":"~main:g2.1:start","box":[0,50,100,50]}]}}"##;
        let parsed = element(source);
        parsed.validate(&mut HashSet::new()).unwrap();
        let props = parsed.whiteboard.as_ref().unwrap();
        assert_eq!(props.pace(), WhiteboardPace::Natural);
        assert!(props.strict());
        let beats = props.beats.as_ref().unwrap();
        assert!(beats[0].is_anchored());
        assert_eq!(beats[0].at_local(), None);
        assert_eq!(beats[0].label.as_deref(), Some("第一步"));
        assert_eq!(beats[1].at_local(), Some(3.2));
        assert_eq!(beats[1].end_local(), Some(6.3));
        assert!(!beats[1].is_anchored());
        assert!(beats[2].end.is_none());
        // 往返：字段原样、缺席的键不写出
        let value = serde_json::to_value(&parsed).unwrap();
        assert_eq!(value["whiteboard"]["pace"], json!("natural"));
        assert_eq!(value["whiteboard"]["strict"], json!(true));
        assert_eq!(
            value["whiteboard"]["beats"][0]["at"],
            json!("~main:g1.1:start")
        );
        assert_eq!(value["whiteboard"]["beats"][0]["label"], json!("第一步"));
        assert!(value["whiteboard"]["beats"][1].get("label").is_none());
        assert!(value["whiteboard"]["beats"][2].get("end").is_none());

        // 0.8 的数字写法：缺省 pace=stretch / strict=false
        let legacy = element(
            r##"{"id":"e1","kind":"whiteboard","srcId":"s1","whiteboard":{"beats":[{"at":0,"box":[0,0,50,100]},{"at":2,"box":[50,0,50,100]}]}}"##,
        );
        legacy.validate(&mut HashSet::new()).unwrap();
        let props = legacy.whiteboard.as_ref().unwrap();
        assert_eq!(props.pace(), WhiteboardPace::Stretch);
        assert!(!props.strict());
        assert_eq!(
            serde_json::to_value(&legacy).unwrap()["whiteboard"],
            json!({"beats":[{"at":0.0,"box":[0.0,0.0,50.0,100.0]},{"at":2.0,"box":[50.0,0.0,50.0,100.0]}]})
        );
        // 0.8 文档整体读入写出为当前版本
        let doc: TimelineDocument = serde_json::from_str(
            r##"{"bcutTimeline":"0.8","sources":{"s1":{"path":"a.png","kind":"image"}},"tracks":[{"id":"t","kind":"overlay","elements":[{"id":"e1","kind":"whiteboard","srcId":"s1","whiteboard":{"beats":[{"at":1,"box":[0,0,50,100]}]}}]}]}"##,
        )
        .unwrap();
        doc.validate().unwrap();
        assert_eq!(doc.version, TIMELINE_VERSION);
        assert_eq!(
            serde_json::to_value(&doc).unwrap()["bcutTimeline"],
            json!(TIMELINE_VERSION)
        );
    }

    /// 0.9 白板节拍的契约校验：数字写法的时序在这里就报 `whiteboard-beat-window` /
    /// `whiteboard-beat-after-draw`；锚点文法、label 长度、pace 枚举也在这里。
    #[test]
    fn whiteboard_beats_are_time_checked_when_numeric() {
        let cases: [(&str, &str); 8] = [
            (
                r##"{"id":"e1","kind":"whiteboard","srcId":"s1","whiteboard":{"beats":[{"at":2,"box":[0,0,50,100]},{"at":1,"box":[50,0,50,100]}]}}"##,
                WHITEBOARD_BEAT_WINDOW,
            ),
            (
                r##"{"id":"e1","kind":"whiteboard","srcId":"s1","whiteboard":{"beats":[{"at":0,"end":3,"box":[0,0,50,100]},{"at":2,"box":[50,0,50,100]}]}}"##,
                WHITEBOARD_BEAT_WINDOW,
            ),
            (
                r##"{"id":"e1","kind":"whiteboard","srcId":"s1","whiteboard":{"beats":[{"at":2,"end":2,"box":[0,0,50,100]}]}}"##,
                WHITEBOARD_BEAT_WINDOW,
            ),
            (
                r##"{"id":"e1","kind":"whiteboard","srcId":"s1","whiteboard":{"draw":4,"beats":[{"at":0,"end":5,"box":[0,0,50,100]}]}}"##,
                WHITEBOARD_BEAT_AFTER_DRAW,
            ),
            (
                r##"{"id":"e1","kind":"whiteboard","srcId":"s1","whiteboard":{"beats":[{"at":"main:g1:start","box":[0,0,50,100]}]}}"##,
                "词锚点非法",
            ),
            (
                r##"{"id":"e1","kind":"whiteboard","srcId":"s1","whiteboard":{"beats":[{"at":-1,"box":[0,0,50,100]}]}}"##,
                "非负秒数",
            ),
            (
                r##"{"id":"e1","kind":"whiteboard","srcId":"s1","whiteboard":{"beats":[{"at":0,"box":[0,0,50,100],"label":"很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很"}]}}"##,
                "label 至多",
            ),
            (
                r##"{"id":"e1","kind":"whiteboard","srcId":"s1","whiteboard":{"beats":[{"at":0,"box":[0,0,50,100]},{"at":"~main:g1.1:start","box":[50,0,50,100]}]}}"##,
                "",
            ),
        ];
        for (source, expect) in cases {
            let result = element(source).validate(&mut HashSet::new());
            if expect.is_empty() {
                result.unwrap();
                continue;
            }
            let err = result.unwrap_err().to_string();
            assert!(err.contains(expect), "{source}\n{err}");
        }
        assert!(
            serde_json::from_str::<Element>(
                r##"{"id":"e1","kind":"whiteboard","srcId":"s1","whiteboard":{"pace":"fast"}}"##
            )
            .is_err(),
            "pace 是封闭枚举"
        );
        assert!(
            serde_json::from_str::<Element>(
                r##"{"id":"e1","kind":"whiteboard","srcId":"s1","whiteboard":{"beats":[{"at":0,"box":[0,0,50,100],"hold":1}]}}"##
            )
            .is_err(),
            "beat deny_unknown_fields"
        );
    }

    #[test]
    fn the_props_values_are_range_checked() {
        for source in [
            // 颜色必须是 #RRGGBB[AA]
            r#"{"id":"e1","kind":"shape","shape":{"shape":"rect","fill":"red"}}"#,
            r#"{"id":"e1","kind":"shape","shape":{"shape":"rect","strokeWidth":-1}}"#,
            r#"{"id":"e1","kind":"shape","shape":{"shape":"rect","cornerRadius":[0,0,0,-2]}}"#,
            r#"{"id":"e1","kind":"shape","shape":{"shape":"line","head":"circle"}}"#,
            r#"{"id":"e1","kind":"sticker","sticker":{"source":"remote"}}"#,
            r#"{"id":"e1","kind":"sticker","sticker":{"source":"asset","loop":"pingpong"}}"#,
            r#"{"id":"e1","kind":"visualizer","visualizer":{"style":"bars","fftSize":333}}"#,
            r#"{"id":"e1","kind":"visualizer","visualizer":{"style":"bars","minDb":10,"maxDb":-10}}"#,
            r#"{"id":"e1","kind":"visualizer","visualizer":{"style":"bars","smoothing":1}}"#,
            r#"{"id":"e1","kind":"progress","progress":{"style":""}}"#,
            r#"{"id":"e1","kind":"progress","progress":{"style":"normal","startProgress":1.1}}"#,
            r##"{"id":"e1","kind":"draw","draw":{"brush":"round","color":"red","size":4}}"##,
            r##"{"id":"e1","kind":"draw","draw":{"brush":"round","color":"#ffffff","size":0}}"##,
            r##"{"id":"e1","kind":"draw","draw":{"brush":"round","color":"#ffffff","size":4,"strokes":[{"points":[[101,0]]}]}}"##,
            // confetti（设计稿 §3.5）：越界、空表、未知形状、坏颜色全在解析期报错。
            r#"{"id":"e1","kind":"confetti","confetti":{"style":""}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","colors":[]}}"#,
            r##"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","colors":["#111111","#222222","#333333","#444444","#555555","#666666","#777777","#888888","#999999"]}}"##,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","colors":["red"]}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","shapes":[]}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","shapes":["emoji"]}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","size":4.5}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","speed":0.1}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","gravity":-3}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","spin":3.5}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","wind":601}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","opacity":1.5}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","emit":{"rate":0}}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","emit":{"count":501}}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","emit":{"interval":61}}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","origin":{"x":121,"y":50}}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","angle":181}}"#,
            r#"{"id":"e1","kind":"confetti","confetti":{"style":"rainbow-paper","spread":361}}"#,
        ] {
            assert!(
                element(source).validate(&mut HashSet::new()).is_err(),
                "{source}"
            );
        }
        assert!(
            serde_json::from_str::<Element>(
                r#"{"id":"e1","kind":"placeholder","placeholder":{"variant":"recording"}}"#
            )
            .is_err(),
            "placeholder.variant 必须是封闭枚举"
        );
    }

    /// `Place.flipX/flipY`：镜像归几何（ADR-E01），且 `skip_serializing_if`
    /// 保证旧文档序列化字节不变。
    #[test]
    fn the_place_carries_flip_without_changing_old_bytes() {
        let flipped: Place = serde_json::from_str(r#"{"x":50,"flipX":true}"#).unwrap();
        assert_eq!(flipped.flip_signs(), (-1.0, 1.0));
        assert_eq!(Place::default().flip_signs(), (1.0, 1.0));
        let corners: Place = serde_json::from_str(
            r#"{"radius":8,"cornerRadii":{"topLeft":1,"topRight":2,"bottomRight":3,"bottomLeft":4}}"#,
        )
        .unwrap();
        assert_eq!(corners.corner_radii(), [1.0, 2.0, 3.0, 4.0]);
        let plain = serde_json::to_value(Place::default()).unwrap();
        assert!(plain.get("flipX").is_none() && plain.get("flipY").is_none());
        assert_eq!(
            schema_json()["$defs"]["place"]["properties"]["flipX"],
            json!({"type": "boolean"})
        );
    }

    /// 0.1–0.8 版本读取：旧版正常读、写出升当前版本，
    /// **不含新字段的文档序列化后与 0.1 只差 version 字符串**。
    #[test]
    fn all_supported_timeline_versions_read_and_everything_writes_as_the_current_one() {
        let source = r#"{"bcutTimeline":"0.1","clips":[{"id":"c1","in":0.0,"out":1.0}]}"#;
        let old: TimelineDocument = serde_json::from_str(source).unwrap();
        assert_eq!(old.version, TIMELINE_VERSION);
        old.validate().unwrap();
        let previous: TimelineDocument =
            serde_json::from_str(&source.replace("0.1", "0.2")).unwrap();
        let third: TimelineDocument = serde_json::from_str(&source.replace("0.1", "0.3")).unwrap();
        let fourth: TimelineDocument = serde_json::from_str(&source.replace("0.1", "0.4")).unwrap();
        let fifth: TimelineDocument = serde_json::from_str(&source.replace("0.1", "0.5")).unwrap();
        let sixth: TimelineDocument = serde_json::from_str(&source.replace("0.1", "0.6")).unwrap();
        let seventh: TimelineDocument =
            serde_json::from_str(&source.replace("0.1", "0.7")).unwrap();
        let eighth: TimelineDocument = serde_json::from_str(&source.replace("0.1", "0.8")).unwrap();
        let ninth: TimelineDocument = serde_json::from_str(&source.replace("0.1", "0.9")).unwrap();
        let tenth: TimelineDocument = serde_json::from_str(&source.replace("0.1", "0.10")).unwrap();
        let current: TimelineDocument =
            serde_json::from_str(&source.replace("0.1", TIMELINE_VERSION)).unwrap();
        assert_eq!(old, previous);
        assert_eq!(previous, third);
        assert_eq!(third, fourth);
        assert_eq!(fourth, fifth);
        assert_eq!(fifth, sixth);
        assert_eq!(sixth, seventh);
        assert_eq!(seventh, eighth);
        assert_eq!(eighth, ninth);
        assert_eq!(ninth, tenth);
        assert_eq!(tenth, current);
        for version in TIMELINE_VERSIONS {
            let parsed: TimelineDocument =
                serde_json::from_str(&source.replace("0.1", version)).unwrap();
            assert_eq!(parsed, old);
        }
        assert_eq!(
            serde_json::to_string(&old).unwrap(),
            source.replace("0.1", TIMELINE_VERSION),
            "不含新字段的文档只差 version 字符串"
        );
        // 未知版本原样保留，由 validate 报 UnsupportedVersion（不是 serde 文本错误）。
        let future: TimelineDocument = serde_json::from_str(r#"{"bcutTimeline":"9.9"}"#).unwrap();
        assert_eq!(
            future.validate().unwrap_err(),
            TimelineError::UnsupportedVersion("9.9".to_owned())
        );
        assert_eq!(
            schema_json()["properties"]["bcutTimeline"],
            json!({"enum": TIMELINE_VERSIONS})
        );
    }

    /// 0.4 的 `template`：整份层文档挂在根上，读写对称，校验走 `template::validate`。
    #[test]
    fn template_field_round_trips_and_validates() {
        let mut doc = TimelineDocument::default();
        assert!(
            serde_json::to_value(&doc)
                .unwrap()
                .get("template")
                .is_none()
        );
        doc.template = Some(crate::template::instance(
            &crate::template::builtin("tpl-chapter-bar").unwrap(),
        ));
        doc.validate().unwrap();
        let text = serde_json::to_string(&doc).unwrap();
        let back: TimelineDocument = serde_json::from_str(&text).unwrap();
        assert_eq!(back, doc);
        assert_eq!(
            back.template.as_ref().unwrap().from.as_deref(),
            Some("tpl-chapter-bar")
        );
        doc.template.as_mut().unwrap().layers[0].rect.y = 99.0;
        assert!(matches!(doc.validate(), Err(TimelineError::Invalid(_))));
        assert!(schema_json()["$defs"]["template"]["properties"]["layers"].is_object());
    }

    /// 新元素在完整文档里的落地：overlay 轨承载、schema 与 struct 同进同退。
    #[test]
    fn the_new_kinds_survive_a_full_document_round_trip() {
        let source = r##"{
            "bcutTimeline":"0.2",
            "tracks":[{"id":"t1","kind":"overlay","elements":[
                {"id":"e1","kind":"shape","start":1.0,"end":2.0,
                 "place":{"x":50,"y":50,"w":30,"flipX":true},
                 "shape":{"shape":"rect","fill":"#ff0000ff","cornerRadius":[8,8,8,8]}},
                {"id":"e2","kind":"visualizer","start":0.0,"end":5.0,
                 "visualizer":{"style":"bars","mainColor":"#ffffff"}},
                {"id":"e3","kind":"progress","start":0.0,"end":5.0,
                 "progress":{"style":"rounded"}},
                {"id":"e4","kind":"sticker","start":0.0,"end":5.0,
                 "sticker":{"source":"asset","path":"stickers/star.png"}},
                {"id":"e5","kind":"confetti","start":0.0,"end":5.0,
                 "confetti":{"style":"golden-starburst","seed":42}}
            ]}]
        }"##;
        let document: TimelineDocument = serde_json::from_str(source).unwrap();
        document.validate().unwrap();
        let again: TimelineDocument =
            serde_json::from_str(&serde_json::to_string(&document).unwrap()).unwrap();
        assert_eq!(document, again);
        // 音轨只放 audio 元素：新 kind 不能溜进音轨。
        let on_audio_track = source
            .replace("\"kind\":\"overlay\"", "\"kind\":\"audio\"")
            .replace("\"id\":\"e1\"", "\"id\":\"e9\"");
        let document: TimelineDocument = serde_json::from_str(&on_audio_track).unwrap();
        assert!(document.validate().is_err());
    }

    #[test]
    fn anchor_grammar_is_closed() {
        assert!(valid_anchor("~main:g42.0"));
        assert!(valid_anchor("~src-a:g42.0:end+0.4"));
        assert!(!valid_anchor("~g42.0"));
        assert!(!valid_anchor("~main:g42.0+calc(1)"));
    }
}
