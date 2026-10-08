//! 字幕：字幕文档（`baocut.caption/1`）按样式文档交给渲染内核（`subtitle-render`）排版、画出来。
//!
//! 共用一个样式文档的字幕实例是一组（没有样式文档时是实例自己），在组里第一层的位置画一次，坐标系是整张画布。
//! 一组换成内核的一份字幕文档：原文字幕的句子是 `cues`，译文字幕（`lineKind: translation`）的句子是 `transCues`，
//! 样式是 Studio 样式文档（`baocut.legacy-studio-style/0.1`）的 `style`；组里只有原文时按原文模式，只有译文时按译文模式，
//! 两者都有时按双语模式（上下顺序由样式的 `order` 决定）。显示时机（`displayTiming`）、标点的交付写法、逐词动画与
//! 设计字幕的配方都由内核按样式画，与旧版逐字节一致。一组按第一层的时钟取时刻：文档在序列时钟上时用序列时间，
//! 在源素材时钟上时用作用实例投影出的源时刻。
//!
//! 定位框样式（`baocut.boxed-caption-style/N`，旧的外部工程导入写的）换算成一份等价的 Studio 样式交给同一个内核画
//! （[`boxed_as_studio`]）：框的位置与宽度变成锚点与折行宽度，样式文档画布上的像素按输出尺寸换算。

use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use render_raster::TextEngine;
use serde::Serialize;
use serde_json::{Value, json};
use subtitle_render::{CaptionCompositeMode, OverlayIncludes, OverlayRenderPlan, TemplateScene};
use timeline::template::TemplateDoc;
use tiny_skia::{BlendMode, IntSize, Pixmap};

use crate::caption_words::{Placement, SpeechWords, WordTimes, cue_words_indexed};
use crate::documents::FrozenDocument;

pub const CAPTION_DOCUMENT: &str = "baocut.caption/1";
/// Studio 字幕样式（旧版字幕的样式文档）。
pub const STUDIO_STYLE: &str = "baocut.legacy-studio-style/0.1";

/// 定位框样式：`baocut.boxed-caption-style/` 后面跟版本号。
pub fn is_boxed_style(schema: &str) -> bool {
    video_model::caption_style::is_boxed_style_schema(schema)
}

#[derive(Clone, Debug, PartialEq)]
pub struct CaptionCue {
    /// 文档里的句子 ID（设计字幕的逐句样式按它找）；没写时为空。
    pub id: String,
    /// 在文档时钟上的秒。
    pub start: f64,
    pub end: f64,
    pub text: String,
    /// 句子的 `words`（指向转写里的词），原样。
    pub refs: Option<Value>,
    /// 交给内核的词（[`CaptionTrack::attach_words`] 填）；空时内核按空白切分推算。
    pub words: Vec<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CaptionTrack {
    /// 文档在序列时钟上（否则在源素材时钟上）。
    pub sequence_clock: bool,
    pub cues: Vec<CaptionCue>,
}

/// 读字幕文档的正文；不是 `baocut.caption/1` 时返回 `None`。时间是整数刻度，`timescale` 缺省 1 000 000。
pub fn read_captions(body: &Value) -> Option<CaptionTrack> {
    let body = body.as_object()?;
    if body.get("schema").and_then(Value::as_str) != Some(CAPTION_DOCUMENT) {
        return None;
    }
    let cues = body.get("cues")?.as_array()?;
    let timescale = match body.get("timescale").and_then(Value::as_f64) {
        Some(t) if t > 0.0 && t.is_finite() => t,
        _ => 1_000_000.0,
    };
    let num = |cue: &serde_json::Map<String, Value>, key: &str| cue.get(key).and_then(Value::as_f64).filter(|v| v.is_finite());
    let cues = cues
        .iter()
        .filter_map(Value::as_object)
        .map(|cue| {
            let start = num(cue, "start").unwrap_or(0.0) / timescale;
            CaptionCue {
                id: cue.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
                start,
                end: start.max(num(cue, "end").unwrap_or(0.0) / timescale),
                text: cue.get("text").and_then(Value::as_str).unwrap_or_default().to_string(),
                refs: cue.get("words").filter(|w| w.is_object()).cloned(),
                words: Vec::new(),
            }
        })
        .collect();
    Some(CaptionTrack {
        sequence_clock: body.get("clock").and_then(Value::as_str) == Some("sequence"),
        cues,
    })
}

impl CaptionTrack {
    /// 给每一句配上转写里的词（[`crate::caption_words`]）：剪掉的、隐藏的词不给，拿掉了词的句子按留下的词重拼文字。
    pub fn attach_words(&mut self, speech: &SpeechWords, placement: &Placement) {
        // 没写 `words` 的句子按时刻取词：索引在第一次用到时建，整份字幕共用。
        let mut times: Option<WordTimes> = None;
        for cue in &mut self.cues {
            let refs = cue.refs.as_ref().and_then(|refs| speech.refs(refs));
            let times = match refs {
                Some(_) => None,
                None => Some(&*times.get_or_insert_with(|| WordTimes::new(speech, placement))),
            };
            if let Some(found) = cue_words_indexed(speech, refs.as_deref(), (cue.start, cue.end), self.sequence_clock, placement, times) {
                cue.words = found.words;
                if let Some(text) = found.text {
                    cue.text = text;
                }
            }
        }
    }
}

/// 样式文档读出来的样式。
pub enum CaptionStyle {
    /// Studio 样式的根（v2 的 `style` 对象）。
    Studio(Value),
    /// 定位框样式的正文。
    Boxed(Value),
}

/// 换算给内核的一份 Studio 样式。
pub struct KernelStyle {
    pub root: Value,
    /// 整组字幕的不透明度（定位框样式的 `opacity`；Studio 样式恒为 1）。
    pub opacity: f32,
    /// 换算时照不到的地方（作为渲染提示报出来）。
    pub notes: Vec<String>,
}

impl CaptionStyle {
    /// 交给内核的 Studio 样式（`size` 是输出尺寸）。
    pub fn kernel_style(&self, size: (u32, u32)) -> KernelStyle {
        match self {
            CaptionStyle::Studio(root) => KernelStyle {
                root: root.clone(),
                opacity: 1.0,
                notes: Vec::new(),
            },
            CaptionStyle::Boxed(body) => boxed_as_studio(body, size),
        }
    }
}

/// 定位框样式换算成 Studio 样式。
///
/// 定位框样式的长度都是样式文档 `canvas` 上的像素，`k = 输出宽 / canvas.width` 折成输出像素；Studio 样式的字号按
/// 540 短边量，留白、圆角与字距按自己的字号归一（`REFERENCE_FONT_SIZE` 30），这里反算回去：
/// - 框（`box`：中心相对画布中心的偏移与宽高）→ 锚点 `x/y`（画布百分比）与 `verticalAlign`：靠上时锚在框顶、靠下时
///   锚在框底、否则锚在框心；折行宽度 `width` 是框宽减两侧 `textPadding`。
/// - `textPadding` 同时是底板的横竖留白（`backgroundPadding`、`backgroundPaddingY`），所以文字离框边正好一个留白。
/// - `textShadow` 的偏移换成阴影的方向与距离；`backgroundColor` 不透明度不为 0 时画底板。
/// - 显示时机不前后留白，标点不做交付写法（定位框样式按原文画）。
/// - 逐词动画：`animationPresetId` 是逐词动画目录里的一格（[`subtitle_render::word_animation_catalog`]）时，按那一格的
///   载荷画，与 Studio 样式选中同一格一样；没写时不动画。导入的字幕没有词时间，内核按空白切分推算词（规范 §3.8）。
///   认不出的 id 不动画，报一条提示。
/// - `textAlign`（左、中、右）照抄，并让各行在折行宽度里对齐（[`subtitle_render::ALIGN_WITHIN_WRAP_KEY`]）：左对齐的行
///   贴框的左边（隔一个留白），右对齐贴右边，底板跟着行走。
pub fn boxed_as_studio(body: &Value, size: (u32, u32)) -> KernelStyle {
    let (width, height) = (f64::from(size.0.max(1)), f64::from(size.1.max(1)));
    let object = |value: Option<&Value>| value.filter(|v| v.is_object()).cloned().unwrap_or_else(|| json!({}));
    let style = object(body.get("style"));
    let frame = object(body.get("box"));
    let canvas = object(body.get("canvas"));
    let num =
        |value: &Value, key: &str, fallback: f64| value.get(key).and_then(Value::as_f64).filter(|v| v.is_finite()).unwrap_or(fallback);
    let text = |key: &str| style.get(key).and_then(Value::as_str).map(str::to_string);
    let k = width / num(&canvas, "width", width).max(1.0);
    let pad = num(&style, "textPadding", 0.0).max(0.0) * k;
    let font_px = num(&style, "fontSize", 40.0).max(1.0) * k * num(&style, "scale", 1.0).max(0.05);
    // Studio 样式的字号单位：540 短边上的像素；留白等按 `font_px / 30` 归一。
    let short_edge = width.min(height);
    let size_scale = font_px / 30.0;
    let box_width = (num(&frame, "width", width * 0.8 / k) * k).max(1.0);
    let box_height = (num(&frame, "height", height * 0.2 / k) * k).max(1.0);
    let center_x = width / 2.0 + num(&frame, "x", 0.0) * k;
    let center_y = height / 2.0 + num(&frame, "y", 0.0) * k;
    let (anchor_y, align) = match style.get("verticalAlign").and_then(Value::as_str) {
        Some("top") => (center_y - box_height / 2.0, "top"),
        Some("bottom") => (center_y + box_height / 2.0, "bottom"),
        _ => (center_y, "center"),
    };
    let mut root = json!({
        "x": center_x / width * 100.0,
        "y": anchor_y / height * 100.0,
        "verticalAlign": align,
        "width": ((box_width - pad * 2.0).max(1.0) / width * 100.0),
        "scale": 1.0,
        "fontSize": font_px * timeline::REFERENCE_SHORT_EDGE / short_edge,
        "fontColor": text("color").unwrap_or_else(|| "#FFFFFF".into()),
        "lineHeight": num(&style, "lineHeight", 1.2).max(0.5),
        "letterSpacing": num(&style, "letterSpacing", 0.0) * k / size_scale,
        "backgroundPadding": pad / (size_scale * 0.8),
        "backgroundPaddingY": pad / (size_scale * 0.8),
        "borderRadius": num(&style, "backgroundRadius", 0.0).max(0.0) * k / (size_scale * 0.55),
        "background": text("backgroundColor").and_then(|c| crate::effects::hex_rgba(&c)).is_some_and(|c| c[3] > 0),
        "displayTiming": { "leadIn": 0, "tail": 0 },
        "punct": false,
        // 没选逐词动画时不动画（Studio 样式缺省是逐词变色）。
        "anim": { "name": "None" },
    });
    let mut notes = Vec::new();
    match style.get("animationPresetId") {
        None | Some(Value::Null) => {}
        Some(Value::String(id)) if subtitle_render::word_animation_catalog::word_animation_entry(id).is_some() => {
            root["anim"] = subtitle_render::word_animation_catalog::word_animation_payload(id);
        }
        Some(other) => notes.push(format!("字幕动画预设 {other} 认不出，按不动画画")),
    }
    if let Some(family) = style.get("fontFamily").filter(|v| v.is_string()) {
        root["fontFamily"] = family.clone();
    }
    if let Some(weight) = style.get("fontWeight").filter(|v| v.is_number() || v.is_string()) {
        root["fontWeight"] = weight.clone();
    }
    for (from, to) in [("fontStyle", "fontStyle"), ("backgroundColor", "backgroundColor")] {
        if let Some(value) = text(from) {
            root[to] = json!(value);
        }
    }
    if style.get("underline") == Some(&Value::Bool(true)) {
        root["underline"] = json!(true);
    }
    if style.get("allCaps") == Some(&Value::Bool(true)) {
        root["textTransform"] = json!("uppercase");
    }
    let shadow = object(style.get("textShadow"));
    if let Some([r, g, b, a]) = shadow
        .get("color")
        .and_then(Value::as_str)
        .and_then(crate::effects::hex_rgba)
        .filter(|c| c[3] > 0)
    {
        let (dx, dy) = (num(&shadow, "offsetX", 0.0) * k, num(&shadow, "offsetY", 0.0) * k);
        root["dropShadow"] = json!({
            "on": true,
            "color": format!("#{r:02X}{g:02X}{b:02X}"),
            "opacity": f64::from(a) / 255.0,
            "distance": dx.hypot(dy) / font_px,
            "rotation": dy.atan2(dx).to_degrees(),
            "blur": num(&shadow, "blur", 0.0).max(0.0) * k / font_px,
        });
    } else {
        root["dropShadow"] = json!({ "on": false });
    }
    if let Some(side @ ("left" | "center" | "right")) = style.get("textAlign").and_then(Value::as_str) {
        root["textAlign"] = json!(side);
    }
    root[subtitle_render::ALIGN_WITHIN_WRAP_KEY] = json!(true);
    KernelStyle {
        root,
        opacity: num(&style, "opacity", 1.0).clamp(0.0, 1.0) as f32,
        notes,
    }
}

impl CaptionStyle {
    /// 没有样式文档时按默认预设（规范 §5.6，[`video_model::caption_style::default_studio_style`]）。认不出的样式给出它的
    /// schema。有样式文档时照它画：没写的键按内核的兜底，不拿默认预设去补。
    pub fn read(style: Option<&FrozenDocument>) -> Result<CaptionStyle, Option<String>> {
        let Some(document) = style else {
            return Ok(CaptionStyle::Studio(video_model::caption_style::default_studio_style()));
        };
        match document.body.get("schema").and_then(Value::as_str) {
            Some(STUDIO_STYLE) => Ok(CaptionStyle::Studio(
                document
                    .body
                    .get("style")
                    .filter(|v| v.is_object())
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            )),
            Some(s) if is_boxed_style(s) => Ok(CaptionStyle::Boxed(document.body.clone())),
            other => Err(other.map(str::to_string)),
        }
    }
}

/// 设计字幕的强调（样式根的 `captionEmphasis`）按词 ID 写；多字的 CJK 词画的时候拆成了 `<词 ID>~<k>`，
/// 写在整个词上的强调落到它拆出来的每个字上（字自己写了的不动）。
fn split_emphasis(style: &mut Value, cues: &[Value]) {
    let Some(emphasis) = style.get_mut("captionEmphasis").and_then(Value::as_object_mut) else {
        return;
    };
    let ids = cues
        .iter()
        .flat_map(|cue| cue.get("words").and_then(Value::as_array).into_iter().flatten())
        .filter_map(|word| word.get("id").and_then(Value::as_str));
    for id in ids {
        let Some((parent, _)) = id.rsplit_once('~') else { continue };
        if emphasis.contains_key(id) {
            continue;
        }
        if let Some(value) = emphasis.get(parent).cloned() {
            emphasis.insert(id.to_string(), value);
        }
    }
}

/// 字幕文档的行种类是不是译文。
pub fn is_translation(document: &FrozenDocument) -> bool {
    document.line_kind.as_deref() == Some("translation")
}

/// 渲染器量出的字幕行框（输出像素），绕行中心旋转。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionHit {
    pub layer_id: String,
    pub item_id: String,
    pub document_id: String,
    pub cue_id: String,
    pub cx: f64,
    pub cy: f64,
    pub w: f64,
    pub h: f64,
    pub rotation: f64,
}

/// 一组字幕编好的内核计划。
pub struct CaptionPlan {
    plan: OverlayRenderPlan,
    sources: HashMap<(bool, String), (String, String)>,
    /// 组里第一份文档在序列时钟上。
    pub sequence_clock: bool,
    /// 整组的不透明度（样式给的）。
    pub opacity: f32,
    notes: Vec<String>,
    /// 排字时缺的字体族（常设）。
    missing: std::collections::BTreeSet<String>,
}

impl CaptionPlan {
    /// 编一组字幕：`members` 是组里各层的字幕文档（已确认读得懂），按层的顺序。
    pub fn compile(
        style: &CaptionStyle,
        members: &[(&FrozenDocument, CaptionTrack)],
        size: (u32, u32),
        fps: f64,
        text: TextEngine,
        fonts_loaded: usize,
    ) -> Result<CaptionPlan> {
        let mut sources = HashMap::new();
        let mut cues = |translation: bool| -> Vec<Value> {
            let mut cues: Vec<(&FrozenDocument, &CaptionCue)> = members
                .iter()
                .filter(|(document, _)| is_translation(document) == translation)
                .flat_map(|(document, track)| track.cues.iter().map(move |cue| (*document, cue)))
                .collect();
            cues.retain(|(_, cue)| !cue.text.trim().is_empty());
            cues.sort_by(|(_, a), (_, b)| a.start.total_cmp(&b.start));
            // 句子 ID 照文档里的（逐句样式、强调都按 ID 找）；没写或重复的按次序补一个。
            let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
            cues.iter()
                .enumerate()
                .map(|(index, (document, cue))| {
                    let mut id = if cue.id.is_empty() { format!("c{index}") } else { cue.id.clone() };
                    let mut n = 1;
                    while !seen.insert(id.clone()) {
                        n += 1;
                        id = format!("{}#{n}", if cue.id.is_empty() { format!("c{index}") } else { cue.id.clone() });
                    }
                    sources.insert((translation, id.clone()), (document.document_id.clone(), cue.id.clone()));
                    let mut value = json!({ "id": id, "start": cue.start, "end": cue.end, "text": cue.text });
                    // 同一句在序列上出现几次时 ID 各补后缀，逐句样式仍按文档里的 ID 找。
                    if !cue.id.is_empty() {
                        value["sourceItemId"] = json!(cue.id);
                    }
                    if !cue.words.is_empty() {
                        value["words"] = Value::Array(cue.words.clone());
                    }
                    value
                })
                .collect()
        };
        let KernelStyle {
            root: mut style_root,
            opacity,
            notes,
        } = style.kernel_style(size);
        let (original, translation) = (cues(false), cues(true));
        split_emphasis(&mut style_root, &original);
        let mode = match (original.is_empty(), translation.is_empty()) {
            (false, false) => "bilingual",
            (true, false) => "trans",
            _ => "orig",
        };
        let end = members
            .iter()
            .flat_map(|(_, track)| &track.cues)
            .map(|cue| cue.end)
            .fold(0.0_f64, f64::max);
        let document = json!({
            "style": style_root,
            "cues": original,
            "transCues": translation,
        });
        let includes = OverlayIncludes {
            subtitles: true,
            texts: false,
            media_overlays: false,
            watermarks: false,
        };
        // 时长只决定内核按哪条路取字幕帧；留足显示时机的尾巴。
        let duration = end + 3600.0;
        let plan = OverlayRenderPlan::compile_with_text_engine(
            &document,
            size.0,
            size.1,
            duration,
            fps,
            Some(mode),
            includes,
            fonts_loaded,
            text,
        )?;
        Ok(CaptionPlan {
            plan,
            sources,
            sequence_clock: members.first().is_some_and(|(_, track)| track.sequence_clock),
            opacity,
            notes,
            missing: Default::default(),
        })
    }

    /// 序列的模板层（格式规范 §3.17 的字幕避让）：底部的整宽横条把字幕抬上去。只取避让，模板本身由模板层画。
    pub fn avoid_template(&mut self, template: Option<&TemplateDoc>) {
        if self.plan.template_scene().map(|scene| &scene.doc) == template {
            return;
        }
        self.plan
            .set_template_scene(template.map(|doc| TemplateScene::new(doc.clone(), Vec::new(), "", Vec::new())));
    }

    /// 拆下排版引擎，给下一份计划用。
    pub fn into_text_engine(self) -> TextEngine {
        self.plan.into_text_engine()
    }

    /// 文档时钟上 `seconds` 这一刻的字幕层与它的混合方式；这一刻没有字幕时为 `None`。
    pub fn render(&mut self, seconds: f64) -> Result<Option<(Pixmap, BlendMode)>> {
        let frame = self.plan.render_subtitle_frame(seconds.max(0.0))?;
        if frame.bounds.is_none() {
            return Ok(None);
        }
        let size = IntSize::from_wh(self.plan.width, self.plan.height).ok_or_else(|| anyhow::anyhow!("字幕画布尺寸非法"))?;
        let rgba = Arc::try_unwrap(frame.rgba).unwrap_or_else(|shared| (*shared).clone());
        let pixmap = Pixmap::from_vec(rgba, size).ok_or_else(|| anyhow::anyhow!("字幕层的尺寸不对"))?;
        let blend = match frame.composite {
            CaptionCompositeMode::Normal => BlendMode::SourceOver,
            CaptionCompositeMode::Difference => BlendMode::Difference,
            CaptionCompositeMode::Exclusion => BlendMode::Exclusion,
            CaptionCompositeMode::Screen => BlendMode::Screen,
        };
        Ok(Some((pixmap, blend)))
    }

    /// 与光栅同源的行几何；不在 UI 里估算字宽或重做显示时机。
    pub fn hits(&mut self, seconds: f64) -> Result<Vec<CaptionHit>> {
        let layout = self.plan.subtitle_layout(seconds)?;
        let mut hits = Vec::new();
        let mut push = |translation: bool, cue: &str, cx, cy, w, h, rotation| {
            if let Some((document_id, cue_id)) = self.sources.get(&(translation, cue.to_owned())) {
                hits.push(CaptionHit {
                    layer_id: String::new(),
                    item_id: String::new(),
                    document_id: document_id.clone(),
                    cue_id: cue_id.clone(),
                    cx,
                    cy,
                    w,
                    h,
                    rotation,
                });
            }
        };
        let angle = layout.rotation.to_radians();
        for line in &layout.lines {
            let dx = line.x + line.w / 2.0 - layout.anchor.0;
            let dy = line.y + line.h / 2.0 - layout.anchor.1;
            push(
                line.kind == "trans",
                &line.cue_id,
                layout.anchor.0 + dx * angle.cos() - dy * angle.sin(),
                layout.anchor.1 + dx * angle.sin() + dy * angle.cos(),
                line.w,
                line.h,
                layout.rotation,
            );
        }
        if let Some(sequence) = layout.sequence {
            for row in sequence.rows.iter().filter(|row| row.visible) {
                let [a, b, c, d] = row.quad;
                push(
                    false,
                    &row.cue_id,
                    (a[0] + c[0]) / 2.0,
                    (a[1] + c[1]) / 2.0,
                    (b[0] - a[0]).hypot(b[1] - a[1]),
                    (d[0] - a[0]).hypot(d[1] - a[1]),
                    (b[1] - a[1]).atan2(b[0] - a[0]).to_degrees(),
                );
            }
        }
        Ok(hits)
    }

    /// 这组字幕的提示（样式换算的、内核编译与画字时报的）与排字时缺的字体族。常设：画过的帧内核会缓存、不再报，
    /// 每画一帧都整份给出，由调用方去重。
    pub fn notes(&mut self) -> (Vec<String>, Vec<String>) {
        for note in std::mem::take(&mut self.plan.warnings) {
            if !self.notes.contains(&note) {
                self.notes.push(note);
            }
        }
        self.missing.extend(self.plan.text.take_missing_families());
        (self.notes.clone(), self.missing.iter().cloned().collect())
    }
}

// 显示时机（前后留白、短间隔对半分）与标点的交付写法由内核按样式算，在 `subtitle-render` 的
// `short_gaps_are_split_exactly_between_tail_and_lead_in` 与
// `video_plan_projects_punctuation_in_every_language_and_honors_the_style_switch` 里核对。
#[cfg(test)]
mod tests {
    use super::*;

    fn caption(cues: &[(f64, f64, &str)], clock: &str) -> Value {
        json!({
            "schema": CAPTION_DOCUMENT, "clock": clock, "timescale": 1000,
            "cues": cues.iter().map(|(s, e, t)| json!({ "start": (s * 1000.0) as i64, "end": (e * 1000.0) as i64, "text": t }))
                .collect::<Vec<_>>(),
        })
    }

    #[test]
    fn reads_documents_in_seconds() {
        let track = read_captions(&caption(&[(1.5, 2.0, "你好")], "sequence")).unwrap();
        assert!(track.sequence_clock);
        assert_eq!(
            track.cues[0],
            CaptionCue {
                id: String::new(),
                start: 1.5,
                end: 2.0,
                text: "你好".into(),
                refs: None,
                words: Vec::new(),
            }
        );
        // 结束早于开始时按零长；缺 `timescale` 时按微秒。
        let track = read_captions(&json!({ "schema": CAPTION_DOCUMENT, "cues": [{ "start": 3_000_000, "end": 1, "text": "a" }] })).unwrap();
        assert!(!track.sequence_clock);
        assert_eq!((track.cues[0].start, track.cues[0].end), (3.0, 3.0));
        assert!(read_captions(&json!({ "schema": "other/1", "cues": [] })).is_none());
        assert!(read_captions(&Value::Null).is_none());
    }

    #[test]
    fn boxed_schema_versions() {
        assert!(is_boxed_style("baocut.boxed-caption-style/1"));
        assert!(is_boxed_style("baocut.boxed-caption-style/12"));
        assert!(!is_boxed_style("baocut.boxed-caption-style/"));
        assert!(!is_boxed_style("baocut.boxed-caption-style/1a"));
    }

    #[test]
    fn boxed_styles_become_the_equivalent_studio_style() {
        let body = json!({
            "schema": "baocut.boxed-caption-style/1",
            "canvas": { "width": 3840, "height": 2160 },
            "box": { "x": 192, "y": 540, "width": 1920, "height": 432 },
            "style": {
                "fontFamily": "Noto Sans SC", "fontSize": 96, "color": "#FFEE00", "verticalAlign": "bottom",
                "textPadding": 24, "backgroundColor": "#00000080", "backgroundRadius": 12, "letterSpacing": 4,
                "textShadow": { "color": "#00000040", "offsetX": 0, "offsetY": 8, "blur": 6 },
                "allCaps": true, "opacity": 0.8, "textAlign": "left",
            },
        });
        // 输出 1920×1080：k = 0.5，字 48 像素（540 短边上的 24），按 30 号归一的比例是 1.6。
        let KernelStyle { root, opacity, notes } = boxed_as_studio(&body, (1920, 1080));
        let close = |key: &str, expected: f64| {
            let got = root[key].as_f64().unwrap();
            assert!((got - expected).abs() < 1e-9, "{key}: {got} ≠ {expected}");
        };
        // 框心 (960 + 96, 540 + 270)，高 216：靠下锚在框底 918。
        close("x", 1056.0 / 1920.0 * 100.0);
        close("y", 918.0 / 1080.0 * 100.0);
        assert_eq!(root["verticalAlign"], "bottom");
        // 折行宽度：框宽 960 减两侧留白 12。
        close("width", 936.0 / 1920.0 * 100.0);
        close("fontSize", 24.0);
        close("backgroundPadding", 12.0 / (1.6 * 0.8));
        close("backgroundPaddingY", 12.0 / (1.6 * 0.8));
        close("borderRadius", 6.0 / (1.6 * 0.55));
        close("letterSpacing", 2.0 / 1.6);
        assert_eq!(root["background"], true);
        assert_eq!(root["textTransform"], "uppercase");
        assert_eq!(root["fontFamily"], "Noto Sans SC");
        // 阴影向下 4 像素、模糊 3 像素，都按字号量。
        let shadow = &root["dropShadow"];
        assert_eq!(shadow["color"], "#000000");
        assert!((shadow["opacity"].as_f64().unwrap() - 64.0 / 255.0).abs() < 1e-9);
        assert!((shadow["distance"].as_f64().unwrap() - 4.0 / 48.0).abs() < 1e-9);
        assert!((shadow["rotation"].as_f64().unwrap() - 90.0).abs() < 1e-9);
        assert!((shadow["blur"].as_f64().unwrap() - 3.0 / 48.0).abs() < 1e-9);
        assert_eq!(root["punct"], false);
        assert_eq!(root["anim"]["name"], "None");
        assert!((opacity - 0.8).abs() < 1e-6);
        assert!(notes.is_empty(), "左右对齐照画，不再报提示：{notes:?}");
        assert_eq!(root["textAlign"], "left");
        assert_eq!(root[subtitle_render::ALIGN_WITHIN_WRAP_KEY], true);
    }

    #[test]
    fn boxed_animation_presets_pick_the_catalogue_cell() {
        let boxed = |preset: Value| json!({ "schema": "baocut.boxed-caption-style/18", "style": { "animationPresetId": preset } });
        let KernelStyle { root, notes, .. } = boxed_as_studio(&boxed(json!("reveal")), (1920, 1080));
        assert_eq!(
            root["anim"],
            subtitle_render::word_animation_catalog::word_animation_payload("reveal")
        );
        assert_eq!(root["anim"]["animationName"], "Reveal");
        assert_eq!(root["anim"]["catalogId"], "reveal");
        assert!(notes.is_empty(), "{notes:?}");
        // 认不出的不动画，报一条提示。
        let KernelStyle { root, notes, .. } = boxed_as_studio(&boxed(json!("typewriter")), (1920, 1080));
        assert_eq!(root["anim"]["name"], "None");
        assert_eq!(notes.len(), 1, "{notes:?}");
    }

    #[test]
    fn the_engine_and_the_kernel_share_one_catalogue() {
        let kernel: Vec<_> = subtitle_render::word_animation_catalog::WORD_ANIMATIONS
            .iter()
            .map(|entry| entry.catalog_id)
            .collect();
        assert_eq!(kernel, video_model::caption_style::WORD_ANIMATION_IDS);
    }
}
