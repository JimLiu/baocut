//! 模板层文档（`timeline.json` 顶层 `template` 与品牌库 `templates[]` 的线上形状）。
//!
//! 一套模板是一份**层文档**：`chapters | progress | logo | text` 四类图层按画面百分比落位，
//! 数组顺序即 z 序（后画在上）。这里只放形状，校验、纯派生（分段、变量、命中）和内置
//! 目录见 `bcut-timeline::template`，写路径见 `bcut-workspace::template`。
//!
//! v2 在 `bcut-protocol/src/template.rs`，原样照搬到这里；只去掉了为生成 JSON Schema 的
//! `JsonSchema` 派生与它的测试 `schema_generates`（本 crate 不依赖 `schemars`）。
//!
//! 没有独立的水印格式（2026-09-14，台账 2026-09-14-230340）：水印就是一套只有台标层的
//! 模板，台标层用 `tile`（斜向平铺）与 `opacity`（整层不透明度）表达，`tag: "watermark"`
//! 标出这一类；旧 Brand kit 的水印预设导入后是 `imported: "watermark"` 的品牌库模板。
//!
//! 颜色一律 `#RRGGBB[AA]`；尺寸（`size`）是画面高的百分比；`font` 是字体族名，`None`
//! 表示跟随字幕样式字体；`mono` 文字层固定用内置等宽族，忽略 `font`。

use serde::{Deserialize, Serialize};

/// 图层最小宽度（画面百分比）。
pub const MIN_W: f64 = 4.0;
/// 图层最小高度（画面百分比）。
pub const MIN_H: f64 = 0.6;
/// 文字层可用的 `{变量}` 名。
pub const VAR_NAMES: &[&str] = &[
    "chapter", "n", "count", "time", "remain", "total", "percent", "title",
];
/// 目录卡片色相名（原型第 112 轮的取值集合；2026-09-14 平台款补 red / green / pink）。
pub const HUES: &[&str] = &[
    "purple", "cyan", "orange", "yellow", "magenta", "blue", "gray", "red", "green", "pink",
];
/// 台标层不透明度下限：0 等于关掉这一层，那是 `on` 的事。
pub const MIN_OPACITY: f64 = 0.05;
/// `TemplateDoc::tag` 的水印类取值（内置三款水印与导入的旧水印都带）。
pub const TAG_WATERMARK: &str = "watermark";
/// `TemplateDoc::imported` 的来历取值：由旧 Brand kit 水印预设导入。
pub const IMPORTED_WATERMARK: &str = "watermark";

/// 整层不透明度夹到 `[MIN_OPACITY, 1]`，非数按 1（原型 `clampOpacity`）。
pub fn clamp_opacity(v: f64) -> f64 {
    if v.is_nan() {
        1.0
    } else {
        v.clamp(MIN_OPACITY, 1.0)
    }
}

/// 模板画幅。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum TemplateCanvas {
    #[default]
    #[serde(rename = "16:9")]
    Wide,
    #[serde(rename = "9:16")]
    Tall,
}

impl TemplateCanvas {
    pub fn as_str(self) -> &'static str {
        match self {
            TemplateCanvas::Wide => "16:9",
            TemplateCanvas::Tall => "9:16",
        }
    }

    pub fn ratio(self) -> f64 {
        match self {
            TemplateCanvas::Wide => 16.0 / 9.0,
            TemplateCanvas::Tall => 9.0 / 16.0,
        }
    }
}

/// 图层盒子，单位是画面百分比。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LayerBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl LayerBox {
    pub const fn new(x: f64, y: f64, w: f64, h: f64) -> Self {
        Self { x, y, w, h }
    }
}

/// 章节条的填充方式：`bar` 底部进度条，`dim` 整段染色。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChapterFill {
    #[default]
    Bar,
    Dim,
}

/// 台标形状。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogoShape {
    #[default]
    Badge,
    Plain,
}

/// 水平对齐：文字层缺省靠左（`#[default]`），台标层缺省居中（见 [`LayerKind::Logo`]）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
}

/// `"text"` 字面量的载体（`LogoSrc::Text`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LogoText {
    #[serde(rename = "text")]
    Text,
}

/// 台标来源：文字徽章、品牌库图片 id、或项目相对路径的图片文件。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LogoSrc {
    Text(LogoText),
    BrandLogo {
        #[serde(rename = "brandLogo")]
        brand_logo: String,
    },
    File {
        file: String,
    },
}

impl LogoSrc {
    pub const TEXT: LogoSrc = LogoSrc::Text(LogoText::Text);

    pub fn brand(id: impl Into<String>) -> Self {
        LogoSrc::BrandLogo {
            brand_logo: id.into(),
        }
    }

    pub fn file(path: impl Into<String>) -> Self {
        LogoSrc::File { file: path.into() }
    }

    pub fn is_text(&self) -> bool {
        matches!(self, LogoSrc::Text(_))
    }
}

impl Default for LogoSrc {
    fn default() -> Self {
        LogoSrc::TEXT
    }
}

/// 图层类型与各自的参数；`kind` 与 `TemplateLayer` 的公共字段平铺在同一个对象里。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum LayerKind {
    /// 章节条：按章节时长分段，当前段高亮。
    Chapters {
        #[serde(default)]
        fill: ChapterFill,
        bg: String,
        color: String,
        accent: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        color_done: Option<String>,
        #[serde(default = "default_true")]
        divider: bool,
        #[serde(default = "default_chapters_size")]
        size: f64,
    },
    /// 进度线：一条按播放进度填充的细线。
    Progress { accent: String, track: String },
    /// 台标：文字徽章或图片。
    Logo {
        #[serde(default)]
        src: LogoSrc,
        #[serde(default)]
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bg: Option<String>,
        color: String,
        #[serde(default)]
        shape: LogoShape,
        /// 字 / 图在盒子里的水平对齐，缺省居中且居中不落盘；底色照旧铺满盒子，平铺时不起作用。
        /// 缺省值单独给：`TextAlign` 自己的缺省是文字层用的靠左。
        #[serde(
            default = "default_logo_align",
            skip_serializing_if = "is_center_align"
        )]
        align: TextAlign,
        #[serde(default = "default_logo_size")]
        size: f64,
        /// 字离盒子左右边的内边距，单位与 `size` 相同（画面高的百分比）；缺省按字号推（徽章 0.6em、无底 0）。
        /// 几层字要从同一条竖线起笔时给它们同一个值——按 em 推的内边距跟着各自字号走，
        /// 字号不同就对不齐。图片台标与平铺不看它。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pad: Option<f64>,
        /// 斜向平铺满整个盒子（水印用）；缺省只画一枚。
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        tile: bool,
        /// 整层不透明度，读时经 [`clamp_opacity`] 夹到 `[0.05, 1]`；缺省 1 不落盘。
        #[serde(default = "default_opacity", skip_serializing_if = "is_full_opacity")]
        opacity: f64,
    },
    /// 文字：支持 `{chapter}` 等变量。
    Text {
        text: String,
        color: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bg: Option<String>,
        #[serde(default)]
        align: TextAlign,
        #[serde(default = "default_text_size")]
        size: f64,
        /// 字离盒子左右边的内边距，单位与 `size` 相同；缺省 0.5em（按字号推），语义同台标的 `pad`。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pad: Option<f64>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        mono: bool,
        #[serde(default = "default_weight")]
        weight: u16,
    },
}

impl LayerKind {
    /// 线上 `kind` 名。
    pub fn name(&self) -> &'static str {
        match self {
            LayerKind::Chapters { .. } => "chapters",
            LayerKind::Progress { .. } => "progress",
            LayerKind::Logo { .. } => "logo",
            LayerKind::Text { .. } => "text",
        }
    }

    /// 整宽横条类图层（章节条 / 进度线），字幕避让只看这两类。
    pub fn is_strip(&self) -> bool {
        matches!(
            self,
            LayerKind::Chapters { .. } | LayerKind::Progress { .. }
        )
    }

    /// 生效的整层不透明度：台标层按 `opacity` 夹取，其余类恒为 1。
    pub fn opacity(&self) -> f64 {
        match self {
            LayerKind::Logo { opacity, .. } => clamp_opacity(*opacity),
            _ => 1.0,
        }
    }

    /// 是否是平铺台标。
    pub fn tiled(&self) -> bool {
        matches!(self, LayerKind::Logo { tile: true, .. })
    }
}

/// 一层。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TemplateLayer {
    pub id: String,
    #[serde(default = "default_true")]
    pub on: bool,
    #[serde(rename = "box")]
    pub rect: LayerBox,
    #[serde(flatten)]
    pub kind: LayerKind,
}

/// 一套模板（定义或实例）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDoc {
    pub id: String,
    pub name: String,
    /// 目录卡片色相名，见 [`HUES`]。
    #[serde(default = "default_hue")]
    pub hue: String,
    /// 目录分组键（内置目录才写：`chapters` / `info` / `vertical` / `douyin` / `xhs` /
    /// `youtube` / `bili` / `watermark`）；不认识或缺省归「信息条」，品牌库一律归品牌库组。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default)]
    pub canvas: TemplateCanvas,
    /// 套用时把**项目画幅**改成这个值（可省；缺省只叠层不动画幅）。
    /// 取值与 `bcut canvas --ratio` 同一套语法：`"original"` 跟随源尺寸，或 `W:H`
    /// （`"16:9"`、`"9:16"`、`"2.35:1"`）。与 `canvas`（版面按哪个画幅画）是两件事。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ratio: Option<String>,
    /// 画幅锁（原型第 218 轮）：与 `ratio` 同时为真时，套了这套模板的项目在舞台画幅钮、
    /// 项目设置与 `bcut project canvas` 里都改不了画幅（只允许改成 `ratio` 本身），
    /// 要改先在模板设置里解锁。没有 `ratio` 时该位无效，见 [`ratio_lock`]。
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub lock_ratio: bool,
    /// 内置目录为 `true`；实例与品牌库存入的为 `false`。
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub builtin: bool,
    /// 类别标记：`"watermark"`（[`TAG_WATERMARK`]）表示水印类，目录与品牌页据此出 chip。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    /// 来历标记：`"watermark"`（[`IMPORTED_WATERMARK`]）表示由旧水印预设导入。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub desc: String,
    /// 整套模板的字体族；`None` 跟随字幕样式字体。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    /// 实例来源的定义 id（内置或品牌库）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// 字幕是否避让底部横条。
    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub subs_avoid: bool,
    #[serde(default)]
    pub layers: Vec<TemplateLayer>,
}

impl TemplateDoc {
    pub fn layer(&self, id: &str) -> Option<&TemplateLayer> {
        self.layers.iter().find(|l| l.id == id)
    }

    pub fn layer_mut(&mut self, id: &str) -> Option<&mut TemplateLayer> {
        self.layers.iter_mut().find(|l| l.id == id)
    }

    /// 水印类模板（原型 `isWatermark`）。
    pub fn is_watermark(&self) -> bool {
        self.tag.as_deref() == Some(TAG_WATERMARK)
    }

    /// 由旧水印预设导入的品牌库模板。
    pub fn is_imported_watermark(&self) -> bool {
        self.imported.as_deref() == Some(IMPORTED_WATERMARK)
    }
}

fn default_true() -> bool {
    true
}

fn is_true(v: &bool) -> bool {
    *v
}

fn default_hue() -> String {
    "gray".to_string()
}

fn default_chapters_size() -> f64 {
    2.6
}

fn default_logo_size() -> f64 {
    3.0
}

fn default_logo_align() -> TextAlign {
    TextAlign::Center
}

fn is_center_align(v: &TextAlign) -> bool {
    *v == TextAlign::Center
}

fn default_text_size() -> f64 {
    2.8
}

fn default_weight() -> u16 {
    700
}

fn default_opacity() -> f64 {
    1.0
}

/// 不透明（或非数，读回按 1）就不落盘。
fn is_full_opacity(v: &f64) -> bool {
    v.is_nan() || *v >= 1.0
}

// ---------- 校验 ----------

/// 校验一份层文档的语义约束（id/name/hue/font、层 id 唯一、盒子越界与最小尺寸、
/// 颜色 `#RRGGBB[AA]`、尺寸为正、内边距非负、字重 100..=900、`file` 必须是项目相对路径）。
/// 错误文案面向用户；`bcut-timeline` 与 `bcut-config` 各自包成本层错误类型。
pub fn validate(doc: &TemplateDoc) -> Result<(), String> {
    check_id("template", &doc.id)?;
    if doc.name.trim().is_empty() {
        return Err(format!("template {} 缺少 name", doc.id));
    }
    if !HUES.contains(&doc.hue.as_str()) {
        return Err(format!(
            "template {} 的 hue 不在集合里：{}",
            doc.id, doc.hue
        ));
    }
    if let Some(font) = &doc.font {
        if font.trim().is_empty() {
            return Err(format!("template {} 的 font 不能为空串", doc.id));
        }
    }
    if let Some(ratio) = &doc.ratio {
        check_ratio(ratio).map_err(|error| format!("template {} 的 ratio {error}", doc.id))?;
    }
    let mut seen = std::collections::BTreeSet::new();
    for layer in &doc.layers {
        check_id("template layer", &layer.id)?;
        if !seen.insert(layer.id.as_str()) {
            return Err(format!("template {} 的层 id 重复：{}", doc.id, layer.id));
        }
        check_box(&layer.id, &layer.rect)?;
        check_layer_kind(&layer.id, &layer.kind)?;
    }
    Ok(())
}

/// `ratio` 是否表示「跟随源尺寸」（`original`，不分大小写）。
pub fn ratio_is_original(text: &str) -> bool {
    text.trim().eq_ignore_ascii_case("original")
}

/// 模板锁住的画幅（原型 `ratioLock`）：`lockRatio` 为真且声明了 `ratio` 才算锁。
/// `ratio` 是锁定的目标（`original` 或 `W:H`），`name` 供文案指明是哪套模板锁的。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RatioLock {
    pub ratio: String,
    pub name: String,
}

impl RatioLock {
    /// 锁定目标是否是「跟随源尺寸」。
    pub fn is_original(&self) -> bool {
        ratio_is_original(&self.ratio)
    }

    /// 请求的画幅（`None` = original）是否与锁定目标一致——一致的写入放行，
    /// 这样套用模板本身、撤销/重做与幂等重设都不会被自己的锁拦住。
    pub fn allows(&self, requested: Option<&str>) -> bool {
        ratio_equivalent(Some(self.ratio.as_str()), requested)
    }
}

/// 模板的画幅锁；没锁（`lockRatio` 假或缺 `ratio`）为 `None`。
pub fn ratio_lock(doc: &TemplateDoc) -> Option<RatioLock> {
    if !doc.lock_ratio {
        return None;
    }
    let ratio = doc.ratio.as_deref()?.trim();
    if ratio.is_empty() {
        return None;
    }
    Some(RatioLock {
        ratio: ratio.to_owned(),
        name: doc.name.clone(),
    })
}

/// 模板是否锁着画幅（原型 `ratioLocked`）。
pub fn ratio_locked(doc: &TemplateDoc) -> bool {
    ratio_lock(doc).is_some()
}

/// 两个 `--ratio` 实参是否指同一画幅：`None` 与 `original` 同义；`W:H` 按比值比较
/// （`16:9` 与 `32:18` 同档），解析不了的按文本比较。
pub fn ratio_equivalent(left: Option<&str>, right: Option<&str>) -> bool {
    fn parse(text: Option<&str>) -> Option<Option<f64>> {
        // 缺席（`canvas` 键没写）就是「跟随源尺寸」，与显式 `original` 同义。
        let Some(text) = text.map(str::trim).filter(|t| !t.is_empty()) else {
            return Some(None);
        };
        if ratio_is_original(text) {
            return Some(None);
        }
        let (width, height) = text.split_once(':')?;
        let width = width.trim().parse::<f64>().ok()?;
        let height = height.trim().parse::<f64>().ok()?;
        (width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0)
            .then_some(Some(width / height))
    }
    match (parse(left), parse(right)) {
        (Some(None), Some(None)) => true,
        (Some(Some(a)), Some(Some(b))) => (a - b).abs() < 1e-6,
        (Some(_), Some(_)) => false,
        _ => left.map(str::trim).unwrap_or("") == right.map(str::trim).unwrap_or(""),
    }
}

/// `ratio` 语法：`original` 或 `W:H`（两边都是正的有限数）。与
/// `bcut-workspace::canvas::CanvasInput::parse_ratio` 同一套判据；protocol 不能依赖
/// workspace，所以这里单独写一遍并由测试锁住两边一致。
pub fn check_ratio(text: &str) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("不能为空串（不改画幅请省略该字段）".to_owned());
    }
    if ratio_is_original(text) {
        return Ok(());
    }
    let Some((width, height)) = text.split_once(':') else {
        return Err(format!("使用 original 或 W:H：{text}"));
    };
    for part in [width, height] {
        let ok = part
            .trim()
            .parse::<f64>()
            .map(|v| v.is_finite() && v > 0.0)
            .unwrap_or(false);
        if !ok {
            return Err(format!("W:H 两边都要是正数：{text}"));
        }
    }
    Ok(())
}

fn check_box(layer_id: &str, rect: &LayerBox) -> Result<(), String> {
    const EPS: f64 = 0.051;
    let finite = [rect.x, rect.y, rect.w, rect.h]
        .iter()
        .all(|v| v.is_finite());
    if !finite
        || rect.x < -EPS
        || rect.y < -EPS
        || rect.w < MIN_W - EPS
        || rect.h < MIN_H - EPS
        || rect.x + rect.w > 100.0 + EPS
        || rect.y + rect.h > 100.0 + EPS
    {
        return Err(format!(
            "template layer {layer_id} 的 box 越界或小于最小尺寸：x={} y={} w={} h={}",
            rect.x, rect.y, rect.w, rect.h
        ));
    }
    Ok(())
}

fn positive(layer_id: &str, field: &str, v: f64) -> Result<(), String> {
    if !(v.is_finite() && v > 0.0) {
        return Err(format!(
            "template layer {layer_id} 的 {field} 必须为正数：{v}"
        ));
    }
    Ok(())
}

fn non_negative_pad(layer_id: &str, pad: Option<f64>) -> Result<(), String> {
    match pad {
        Some(v) if !(v.is_finite() && v >= 0.0) => Err(format!(
            "template layer {layer_id} 的 pad 必须是非负数：{v}"
        )),
        _ => Ok(()),
    }
}

fn check_layer_kind(layer_id: &str, kind: &LayerKind) -> Result<(), String> {
    let id = format!("template layer {layer_id}");
    match kind {
        LayerKind::Chapters {
            bg,
            color,
            accent,
            color_done,
            size,
            ..
        } => {
            check_color(&id, "bg", bg)?;
            check_color(&id, "color", color)?;
            check_color(&id, "accent", accent)?;
            if let Some(c) = color_done {
                check_color(&id, "colorDone", c)?;
            }
            positive(layer_id, "size", *size)
        }
        LayerKind::Progress { accent, track } => {
            check_color(&id, "accent", accent)?;
            check_color(&id, "track", track)
        }
        LayerKind::Logo {
            src,
            bg,
            color,
            size,
            pad,
            opacity,
            ..
        } => {
            if !opacity.is_finite() {
                return Err(format!(
                    "template layer {layer_id} 的 opacity 必须是有限数：{opacity}"
                ));
            }
            match src {
                LogoSrc::Text(_) => {}
                LogoSrc::BrandLogo { brand_logo } => check_id("brandLogo", brand_logo)?,
                LogoSrc::File { file } => check_relative_file(layer_id, file)?,
            }
            if let Some(c) = bg {
                check_color(&id, "bg", c)?;
            }
            check_color(&id, "color", color)?;
            positive(layer_id, "size", *size)?;
            non_negative_pad(layer_id, *pad)
        }
        LayerKind::Text {
            color,
            bg,
            size,
            pad,
            weight,
            ..
        } => {
            check_color(&id, "color", color)?;
            if let Some(c) = bg {
                check_color(&id, "bg", c)?;
            }
            positive(layer_id, "size", *size)?;
            non_negative_pad(layer_id, *pad)?;
            if !(100..=900).contains(weight) {
                return Err(format!(
                    "template layer {layer_id} 的 weight 必须在 100..=900：{weight}"
                ));
            }
            Ok(())
        }
    }
}

fn check_relative_file(layer_id: &str, file: &str) -> Result<(), String> {
    let bad = file.is_empty()
        || file.starts_with('/')
        || file.starts_with('\\')
        || file.contains(':')
        || file
            .split(['/', '\\'])
            .any(|seg| seg == ".." || seg.is_empty());
    if bad {
        return Err(format!(
            "template layer {layer_id} 的 file 必须是项目相对路径：{file}"
        ));
    }
    Ok(())
}

fn check_id(kind: &str, id: &str) -> Result<(), String> {
    if id.is_empty() || id.chars().any(char::is_whitespace) {
        Err(format!("{kind} id 非法：{id}"))
    } else {
        Ok(())
    }
}

fn check_color(owner: &str, field: &str, color: &str) -> Result<(), String> {
    let hex = color.strip_prefix('#').unwrap_or("");
    if !matches!(hex.len(), 6 | 8) || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("{owner} 的 {field} 不是 #RRGGBB[AA]：{color}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> TemplateDoc {
        TemplateDoc {
            id: "tpl-x".into(),
            name: "示例".into(),
            hue: "orange".into(),
            group: None,
            canvas: TemplateCanvas::Wide,
            ratio: None,
            lock_ratio: false,
            builtin: true,
            tag: None,
            imported: None,
            desc: "描述".into(),
            font: Some("Noto Sans SC".into()),
            from: None,
            subs_avoid: true,
            layers: vec![
                TemplateLayer {
                    id: "ch".into(),
                    on: true,
                    rect: LayerBox::new(0.0, 91.0, 100.0, 9.0),
                    kind: LayerKind::Chapters {
                        fill: ChapterFill::Bar,
                        bg: "#00000099".into(),
                        color: "#FFFFFF".into(),
                        accent: "#FF7A1A".into(),
                        color_done: None,
                        divider: true,
                        size: 2.6,
                    },
                },
                TemplateLayer {
                    id: "pg".into(),
                    on: false,
                    rect: LayerBox::new(0.0, 98.0, 100.0, 2.0),
                    kind: LayerKind::Progress {
                        accent: "#FF7A1A".into(),
                        track: "#FFFFFF40".into(),
                    },
                },
                TemplateLayer {
                    id: "lg".into(),
                    on: true,
                    rect: LayerBox::new(2.0, 4.0, 14.0, 8.0),
                    kind: LayerKind::Logo {
                        src: LogoSrc::brand("bm2"),
                        text: "科浪访谈".into(),
                        bg: None,
                        color: "#FFFFFF".into(),
                        shape: LogoShape::Badge,
                        align: TextAlign::Center,
                        size: 3.2,
                        pad: None,
                        tile: false,
                        opacity: 1.0,
                    },
                },
                TemplateLayer {
                    id: "tx".into(),
                    on: true,
                    rect: LayerBox::new(4.0, 14.0, 40.0, 6.0),
                    kind: LayerKind::Text {
                        text: "{chapter}".into(),
                        color: "#FFFFFF".into(),
                        bg: Some("#00000073".into()),
                        align: TextAlign::Center,
                        size: 2.8,
                        pad: None,
                        mono: true,
                        weight: 500,
                    },
                },
            ],
        }
    }

    #[test]
    fn round_trips_through_json() {
        let doc = sample();
        let value = serde_json::to_value(&doc).unwrap();
        // kind 与公共字段平铺在同一对象里。
        assert_eq!(value["layers"][0]["kind"], "chapters");
        assert_eq!(value["layers"][0]["box"]["y"], 91.0);
        assert_eq!(value["layers"][0]["fill"], "bar");
        assert_eq!(value["layers"][1]["on"], false);
        assert_eq!(value["layers"][2]["src"]["brandLogo"], "bm2");
        assert_eq!(value["layers"][3]["mono"], true);
        assert_eq!(value["subsAvoid"], serde_json::Value::Null);
        assert_eq!(value["font"], "Noto Sans SC");
        let back: TemplateDoc = serde_json::from_value(value).unwrap();
        assert_eq!(back, doc);
    }

    #[test]
    fn integer_numbers_and_defaults_are_accepted() {
        let raw = json!({
            "id": "tpl-min",
            "name": "最小",
            "layers": [
                {"id": "a", "kind": "text", "box": {"x": 4, "y": 14, "w": 40, "h": 6},
                 "text": "{chapter}", "color": "#FFFFFF"},
                {"id": "b", "kind": "logo", "box": {"x": 2, "y": 4, "w": 14, "h": 8},
                 "src": "text", "text": "T", "color": "#FFFFFF", "bg": "#C0392B", "extra": 1},
                {"id": "c", "kind": "progress", "box": {"x": 0, "y": 98, "w": 100, "h": 2},
                 "accent": "#FF7A1A", "track": "#FFFFFF40"}
            ]
        });
        let doc: TemplateDoc = serde_json::from_value(raw).unwrap();
        assert_eq!(doc.hue, "gray");
        assert_eq!(doc.canvas, TemplateCanvas::Wide);
        assert!(doc.subs_avoid);
        assert!(!doc.builtin);
        assert_eq!(doc.font, None);
        assert_eq!(doc.layers[0].rect.y, 14.0);
        match &doc.layers[0].kind {
            LayerKind::Text {
                align,
                size,
                mono,
                weight,
                ..
            } => {
                assert_eq!(*align, TextAlign::Left);
                assert_eq!(*size, 2.8);
                assert!(!mono);
                assert_eq!(*weight, 700);
            }
            other => panic!("unexpected {other:?}"),
        }
        match &doc.layers[1].kind {
            LayerKind::Logo { src, shape, .. } => {
                assert!(src.is_text());
                assert_eq!(*shape, LogoShape::Badge);
            }
            other => panic!("unexpected {other:?}"),
        }
        assert!(doc.layers.iter().all(|l| l.on));
    }

    #[test]
    fn rejects_unknown_kind_and_missing_required() {
        let raw = json!({"id": "t", "name": "n", "layers": [
            {"id": "a", "kind": "sticker", "box": {"x": 0, "y": 0, "w": 10, "h": 10}}
        ]});
        assert!(serde_json::from_value::<TemplateDoc>(raw).is_err());
        let raw = json!({"id": "t", "name": "n", "layers": [
            {"id": "a", "kind": "progress", "box": {"x": 0, "y": 0, "w": 10, "h": 10}, "accent": "#FFF"}
        ]});
        assert!(serde_json::from_value::<TemplateDoc>(raw).is_err());
    }

    #[test]
    fn logo_src_shapes() {
        assert_eq!(serde_json::to_value(LogoSrc::TEXT).unwrap(), json!("text"));
        assert_eq!(
            serde_json::to_value(LogoSrc::file("assets/template/a.png")).unwrap(),
            json!({"file": "assets/template/a.png"})
        );
        let src: LogoSrc = serde_json::from_value(json!({"brandLogo": "bm1"})).unwrap();
        assert_eq!(src, LogoSrc::brand("bm1"));
        assert!(serde_json::from_value::<LogoSrc>(json!("image")).is_err());
    }

    #[test]
    fn ratio_is_optional_and_follows_canvas_grammar() {
        let mut doc = sample();
        assert!(validate(&doc).is_ok());
        assert!(!serde_json::to_string(&doc).unwrap().contains("ratio"));
        for ok in ["original", "Original", "16:9", "9:16", "2.35:1", " 1:1 "] {
            doc.ratio = Some(ok.into());
            assert!(validate(&doc).is_ok(), "{ok}");
        }
        for bad in ["", " ", "16x9", "0:9", "16:-9", "a:b", "16:9:1", "nan:1"] {
            doc.ratio = Some(bad.into());
            assert!(validate(&doc).is_err(), "{bad:?}");
        }
        let raw = json!({"id": "t", "name": "n", "ratio": "9:16", "layers": []});
        let doc: TemplateDoc = serde_json::from_value(raw).unwrap();
        assert_eq!(doc.ratio.as_deref(), Some("9:16"));
        assert!(ratio_is_original("ORIGINAL"));
        assert!(!ratio_is_original("16:9"));
    }

    #[test]
    fn ratio_lock_needs_both_flag_and_ratio() {
        let mut doc = sample();
        assert!(ratio_lock(&doc).is_none());
        doc.lock_ratio = true;
        assert!(ratio_lock(&doc).is_none(), "没有 ratio 的锁无效");
        assert!(validate(&doc).is_ok());
        doc.ratio = Some("16:9".into());
        let lock = ratio_lock(&doc).expect("锁生效");
        assert_eq!(lock.ratio, "16:9");
        assert_eq!(lock.name, "示例");
        assert!(!lock.is_original());
        assert!(lock.allows(Some("16:9")));
        assert!(lock.allows(Some("32:18")));
        assert!(!lock.allows(Some("9:16")));
        assert!(!lock.allows(None));
        doc.ratio = Some("original".into());
        let lock = ratio_lock(&doc).unwrap();
        assert!(lock.is_original());
        assert!(lock.allows(None));
        assert!(lock.allows(Some("Original")));
        assert!(!lock.allows(Some("1:1")));
        // 落盘：假不写，真写 `lockRatio`；旧文档缺字段读回为假。
        doc.lock_ratio = false;
        assert!(!serde_json::to_string(&doc).unwrap().contains("lockRatio"));
        doc.lock_ratio = true;
        let text = serde_json::to_string(&doc).unwrap();
        assert!(text.contains("\"lockRatio\":true"));
        let back: TemplateDoc = serde_json::from_str(&text).unwrap();
        assert_eq!(back, doc);
        assert!(ratio_equivalent(None, Some("original")));
        assert!(ratio_equivalent(Some("2.35:1"), Some("2.35:1")));
        assert!(!ratio_equivalent(Some("16:9"), Some("16x9")));
    }

    #[test]
    fn logo_tile_and_opacity_round_trip_and_clamp() {
        let mut doc = sample();
        let text = serde_json::to_string(&doc).unwrap();
        assert!(!text.contains("tile"), "缺省不平铺不落盘");
        assert!(!text.contains("opacity"), "缺省不透明不落盘");
        assert_eq!(doc.layers[2].kind.opacity(), 1.0);
        assert!(!doc.layers[2].kind.tiled());
        if let LayerKind::Logo { tile, opacity, .. } = &mut doc.layers[2].kind {
            *tile = true;
            *opacity = 0.2;
        }
        let value = serde_json::to_value(&doc).unwrap();
        assert_eq!(value["layers"][2]["tile"], true);
        assert_eq!(value["layers"][2]["opacity"], 0.2);
        let back: TemplateDoc = serde_json::from_value(value).unwrap();
        assert_eq!(back, doc);
        assert!(back.layers[2].kind.tiled());
        assert_eq!(back.layers[2].kind.opacity(), 0.2);
        assert!(validate(&back).is_ok());
        // 章节条 / 进度 / 文字层没有不透明度，恒为 1。
        assert_eq!(doc.layers[0].kind.opacity(), 1.0);
        assert!(!doc.layers[3].kind.tiled());
        // 读时夹取：0 → 下限，超 1 → 1，非数 → 1；校验只拒非有限数。
        assert_eq!(clamp_opacity(0.0), MIN_OPACITY);
        assert_eq!(clamp_opacity(-2.0), MIN_OPACITY);
        assert_eq!(clamp_opacity(3.0), 1.0);
        assert_eq!(clamp_opacity(f64::NAN), 1.0);
        assert_eq!(clamp_opacity(0.6), 0.6);
        if let LayerKind::Logo { opacity, .. } = &mut doc.layers[2].kind {
            *opacity = 0.0;
        }
        assert!(validate(&doc).is_ok());
        assert_eq!(doc.layers[2].kind.opacity(), MIN_OPACITY);
        if let LayerKind::Logo { opacity, .. } = &mut doc.layers[2].kind {
            *opacity = f64::INFINITY;
        }
        assert!(validate(&doc).is_err());
        let raw = json!({"id": "t", "name": "n", "layers": [
            {"id": "a", "kind": "logo", "box": {"x": 0, "y": 0, "w": 100, "h": 100},
             "text": "T", "color": "#FFFFFF", "tile": true, "opacity": 1.5}
        ]});
        let doc: TemplateDoc = serde_json::from_value(raw).unwrap();
        assert!(doc.layers[0].kind.tiled());
        assert_eq!(doc.layers[0].kind.opacity(), 1.0);
    }

    #[test]
    fn logo_align_defaults_to_center_and_round_trips() {
        let mut doc = sample();
        let value = serde_json::to_value(&doc).unwrap();
        assert!(value["layers"][2].get("align").is_none(), "台标居中不落盘");
        assert_eq!(value["layers"][3]["align"], "center", "文字层照旧落盘");
        for (align, wire) in [(TextAlign::Left, "left"), (TextAlign::Right, "right")] {
            if let LayerKind::Logo { align: slot, .. } = &mut doc.layers[2].kind {
                *slot = align;
            }
            let value = serde_json::to_value(&doc).unwrap();
            assert_eq!(value["layers"][2]["align"], wire);
            let back: TemplateDoc = serde_json::from_value(value).unwrap();
            assert_eq!(back, doc);
        }
        // 旧文档没有这个字段：台标读成居中，文字层仍读成靠左。
        let raw = json!({"id": "t", "name": "n", "layers": [
            {"id": "a", "kind": "logo", "box": {"x": 0, "y": 0, "w": 30, "h": 10},
             "text": "T", "color": "#FFFFFF"},
            {"id": "b", "kind": "text", "box": {"x": 0, "y": 20, "w": 30, "h": 10},
             "text": "T", "color": "#FFFFFF"}
        ]});
        let doc: TemplateDoc = serde_json::from_value(raw).unwrap();
        assert!(matches!(
            doc.layers[0].kind,
            LayerKind::Logo {
                align: TextAlign::Center,
                ..
            }
        ));
        assert!(matches!(
            doc.layers[1].kind,
            LayerKind::Text {
                align: TextAlign::Left,
                ..
            }
        ));
    }

    #[test]
    fn pad_is_optional_non_negative_and_round_trips() {
        let mut doc = sample();
        let text = serde_json::to_string(&doc).unwrap();
        assert!(!text.contains("\"pad\""), "缺省内边距不落盘");
        for (i, v) in [(2, 1.2), (3, 0.0)] {
            match &mut doc.layers[i].kind {
                LayerKind::Logo { pad, .. } | LayerKind::Text { pad, .. } => *pad = Some(v),
                other => panic!("unexpected {other:?}"),
            }
        }
        assert!(validate(&doc).is_ok(), "0 是合法内边距");
        let value = serde_json::to_value(&doc).unwrap();
        assert_eq!(value["layers"][2]["pad"], 1.2);
        assert_eq!(value["layers"][3]["pad"], 0.0);
        let back: TemplateDoc = serde_json::from_value(value).unwrap();
        assert_eq!(back, doc);
        for bad in [-0.5, f64::NAN, f64::INFINITY] {
            let mut doc = doc.clone();
            if let LayerKind::Text { pad, .. } = &mut doc.layers[3].kind {
                *pad = Some(bad);
            }
            assert!(validate(&doc).is_err(), "{bad}");
            let mut doc = sample();
            if let LayerKind::Logo { pad, .. } = &mut doc.layers[2].kind {
                *pad = Some(bad);
            }
            assert!(validate(&doc).is_err(), "{bad}");
        }
    }

    #[test]
    fn group_tag_and_imported_are_optional() {
        let mut doc = sample();
        let text = serde_json::to_string(&doc).unwrap();
        for key in ["group", "tag", "imported"] {
            assert!(!text.contains(&format!("\"{key}\"")), "{key} 缺省不落盘");
        }
        assert!(!doc.is_watermark());
        assert!(!doc.is_imported_watermark());
        doc.group = Some("watermark".into());
        doc.tag = Some(TAG_WATERMARK.into());
        doc.imported = Some(IMPORTED_WATERMARK.into());
        let value = serde_json::to_value(&doc).unwrap();
        assert_eq!(value["group"], "watermark");
        assert_eq!(value["tag"], "watermark");
        assert_eq!(value["imported"], "watermark");
        let back: TemplateDoc = serde_json::from_value(value).unwrap();
        assert_eq!(back, doc);
        assert!(back.is_watermark());
        assert!(back.is_imported_watermark());
        // 分组键不做成员校验：未知组照样合法，由目录归到「信息条」。
        doc.group = Some("somewhere".into());
        assert!(validate(&doc).is_ok());
        // 平台款补的色相。
        for hue in ["red", "green", "pink"] {
            doc.hue = hue.into();
            assert!(validate(&doc).is_ok(), "{hue}");
        }
    }
}
