//! 画得出来什么（格式规范 §3.7 的原则：画不出来的要明确报出来，不画成空白）。
//!
//! 预检与逐帧合成用同一份判断：预检把范围里每个画不出来的东西列出来（默认拒绝导出）；跳过模式下合成时不画它们，
//! 各自报一条警告。三种粒度：整层不画（`layer`）、跳过一个效果（`effect`）、转场按硬切（`transition`）；
//! 素材解不出画面是第四种（`asset`，由取画面的一方判断）。

use render_graph::{LayerContent, LayerKind, VisualLayer};
use serde::Serialize;
use serde_json::Value;
use timeline::template::TemplateDoc;

use crate::captions::{CaptionStyle, read_captions};
use crate::documents::Documents;

/// 画不出来的一项。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsupportedItem {
    pub item_id: String,
    /// `layer`：整层不画；`effect`：跳过这个效果；`transition`：按硬切；`asset`：素材解不出来，整层不画。
    pub scope: &'static str,
    pub layer_kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effect_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transition_id: Option<String>,
    /// 种类：效果、转场的种类名，或层的内容种类（生成器、字幕与样式的 schema）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub reason: String,
    pub message: String,
}

impl UnsupportedItem {
    /// 去重用的键：同一实例的同一项只报一次；转场按转场本身（两侧各自的层报的是同一项）。
    pub fn key(&self) -> String {
        if let (Some(transition), "transition") = (&self.transition_id, self.scope) {
            return format!("transition|{transition}");
        }
        format!(
            "{}|{}|{}|{}",
            self.item_id,
            self.scope,
            self.effect_id.as_deref().unwrap_or(""),
            self.transition_id.as_deref().unwrap_or("")
        )
    }

    /// 整层不画（`layer` 与 `asset`）。
    pub fn drops_layer(&self) -> bool {
        matches!(self.scope, "layer" | "asset")
    }

    pub fn layer(layer: &VisualLayer, kind: Option<String>, reason: &str, message: impl Into<String>) -> UnsupportedItem {
        UnsupportedItem {
            item_id: layer.item_id.clone(),
            scope: "layer",
            layer_kind: kind_name(layer.kind),
            effect_id: None,
            transition_id: None,
            kind,
            reason: reason.into(),
            message: message.into(),
        }
    }
}

pub fn kind_name(kind: LayerKind) -> &'static str {
    match kind {
        LayerKind::Video => "video",
        LayerKind::Image => "image",
        LayerKind::Text => "text",
        LayerKind::Shape => "shape",
        LayerKind::Generator => "generator",
        LayerKind::Caption => "caption",
        LayerKind::Unsupported => "unsupported",
    }
}

/// 有画法的生成器。
pub const GENERATORS: &[&str] = &[
    "baocut.counter",
    "baocut.audio-visualizer",
    "baocut.progress",
    "baocut.confetti",
    "baocut.draw",
    "baocut.placeholder",
    "baocut.sticker",
    "baocut.lottie",
    "baocut.template",
];

/// 有画法的转场（格式规范 §3.9 的全部种类）。
pub const SUPPORTED_TRANSITIONS: &[&str] = &["dissolve", "wipe", "slide", "zoom", "iris", "dip-to-color", "push"];

/// 一层（不含它的转场）画不出来的地方。`template` 是序列的模板文档（模板层要查它的台标）。
pub fn check_layer(layer: &VisualLayer, documents: &Documents, template: Option<&TemplateDoc>) -> Vec<UnsupportedItem> {
    check_layer_with(layer, template, &mut |document_id, style_document_id| {
        caption_problem(documents, document_id, style_document_id)
    })
}

/// [`check_layer`]，字幕层画不画得出来问 `caption`（`(字幕文档, 样式文档)` → [`caption_problem`]）：渲染器按文档记住
/// 答案，不必每帧重读整份字幕与样式。
pub fn check_layer_with(
    layer: &VisualLayer,
    template: Option<&TemplateDoc>,
    caption: &mut dyn FnMut(&str, Option<&str>) -> Option<CaptionProblem>,
) -> Vec<UnsupportedItem> {
    let mut items = Vec::new();
    if let Some(item) = check_content(layer, template, caption) {
        items.push(item);
        return items;
    }
    for effect in &layer.effects {
        if let Some(reason) = effect.unsupported.as_deref() {
            items.push(UnsupportedItem {
                item_id: layer.item_id.clone(),
                scope: "effect",
                layer_kind: kind_name(layer.kind),
                effect_id: Some(effect.id.clone()),
                transition_id: None,
                kind: Some(effect.kind.clone()),
                message: format!("效果「{}」画不出来", effect.kind),
                reason: format!("effect-{reason}"),
            });
        }
    }
    items
}

/// 一种转场画不出来的原因（`unsupported` 是计划标的原因）。预检按转场清单、合成按层上的转场，都问这一处。
pub fn transition_problem(kind: &str, unsupported: Option<&str>) -> Option<String> {
    match unsupported {
        Some(reason) => Some(format!("transition-{reason}")),
        None if !SUPPORTED_TRANSITIONS.contains(&kind) => Some("transition-not-implemented".to_string()),
        None => None,
    }
}

/// 层的转场画不出来时的一项（按硬切画）。
pub fn check_transition(layer: &VisualLayer) -> Option<UnsupportedItem> {
    let transition = layer.transition.as_ref()?;
    let reason = transition_problem(&transition.kind, transition.unsupported.as_deref())?;
    Some(UnsupportedItem {
        item_id: layer.item_id.clone(),
        scope: "transition",
        layer_kind: kind_name(layer.kind),
        effect_id: None,
        transition_id: Some(transition.id.clone()),
        kind: Some(transition.kind.clone()),
        message: format!("转场「{}」画不出来，按硬切画", transition.kind),
        reason,
    })
}

/// 形状与生成器引用的目录项（形状、贴纸模板、声波、进度条、彩纸的样式）在不在随内核发布的目录里。
/// 不在、或者根本没写（贴纸的 `templateId` 可以缺）时内核只能跳过不画，所以在这里报出来：`(目录项, 原因, 说明)`。
fn catalogue_problem(layer: &VisualLayer) -> Option<(Option<String>, &'static str, String)> {
    let text = |value: &Value, key: &str| value.get(key).and_then(Value::as_str).map(str::to_string);
    let (id, found, what) = match &layer.content {
        Some(LayerContent::Shape { shape }) => {
            let id = text(shape, "shape");
            let found = id
                .as_deref()
                .is_some_and(|id| motion::preset_registry::timeline_shape(id).is_some());
            (id, found, "形状")
        }
        Some(LayerContent::Generator { generator, parameters, .. }) => {
            let lookup: fn(&str) -> bool = match generator.as_str() {
                "baocut.sticker" => |id| motion::preset_registry::timeline_sticker(id).is_some(),
                "baocut.audio-visualizer" => |id| motion::preset_registry::timeline_visualizer(id).is_some(),
                "baocut.progress" => |id| motion::preset_registry::timeline_progress(id).is_some(),
                "baocut.confetti" => |id| motion::preset_registry::timeline_confetti(id).is_some(),
                _ => return None,
            };
            let key = if generator == "baocut.sticker" { "templateId" } else { "style" };
            let id = text(parameters, key);
            let what = match generator.as_str() {
                "baocut.sticker" => "贴纸模板",
                "baocut.audio-visualizer" => "声波样式",
                "baocut.progress" => "进度条样式",
                _ => "彩纸样式",
            };
            let found = id.as_deref().is_some_and(lookup);
            (id, found, what)
        }
        _ => return None,
    };
    match (found, id) {
        (true, _) => None,
        (false, Some(id)) => {
            let message = format!("{what}「{id}」不在随渲染内核发布的目录里");
            Some((Some(id), "preset-unknown", message))
        }
        (false, None) => Some((None, "preset-missing", format!("没有指定{what}"))),
    }
}

fn check_content(
    layer: &VisualLayer,
    template: Option<&TemplateDoc>,
    caption: &mut dyn FnMut(&str, Option<&str>) -> Option<CaptionProblem>,
) -> Option<UnsupportedItem> {
    if let Some((id, reason, message)) = catalogue_problem(layer) {
        return Some(UnsupportedItem::layer(layer, id, reason, message));
    }
    match (&layer.kind, &layer.content) {
        (LayerKind::Video | LayerKind::Image | LayerKind::Text | LayerKind::Shape, _) => None,
        (LayerKind::Unsupported, Some(LayerContent::Unsupported { reason })) => {
            Some(UnsupportedItem::layer(layer, None, reason, unsupported_message(reason)))
        }
        (LayerKind::Generator, Some(LayerContent::Generator { generator, parameters, .. })) => {
            if !GENERATORS.contains(&generator.as_str()) {
                return Some(UnsupportedItem::layer(
                    layer,
                    Some(generator.clone()),
                    "generator-not-implemented",
                    format!("「{generator}」画不出来"),
                ));
            }
            if generator == "baocut.template" {
                let layer_id = parameters.get("layerId").and_then(Value::as_str).unwrap_or(&layer.item_id);
                let reason = match template {
                    None => Some("template-missing"),
                    Some(doc) if !doc.layers.iter().any(|l| l.id == layer_id) => Some("template-missing"),
                    Some(doc) => crate::template::unsupported_reason(doc, layer_id),
                };
                if let Some(reason) = reason {
                    return Some(UnsupportedItem::layer(
                        layer,
                        Some(generator.clone()),
                        reason,
                        unsupported_message(reason),
                    ));
                }
            }
            None
        }
        (
            LayerKind::Caption,
            Some(LayerContent::Caption {
                document_id,
                style_document_id,
                ..
            }),
        ) => caption(document_id, style_document_id.as_deref())
            .map(|(kind, reason, message)| UnsupportedItem::layer(layer, kind, reason, message)),
        _ => Some(UnsupportedItem::layer(layer, None, "unknown-layer", "不认识这种层")),
    }
}

/// 帧计划或这里标成不支持的原因给人看的说明。
fn unsupported_message(reason: &str) -> &'static str {
    match reason {
        "bundle-without-prerender" => "没有预渲染替身的代码包合成画不出来（先生成预渲染替身）",
        "sticker-asset-not-supported" => "这种素材的贴纸画不出来（贴纸素材要是图片、视频或 Lottie）",
        "placeholder-asset-not-supported" => "占位框填的素材画不出来（要是图片或视频）",
        "template-missing" => "模板层在序列的模板里找不到",
        "template-logo-image-not-supported" => "模板的图片台标画不出来（只画文字台标）",
        _ => "这一层画不出来",
    }
}

/// 字幕层画不出来的原因：`(认出的种类, 原因, 说明)`。
pub type CaptionProblem = (Option<String>, &'static str, String);

/// 字幕层画不画得出来：字幕文档与样式文档都在、认得出，样式有画法。只看文档，与层无关。
/// 认不出的样式不替人换成缺省样式：预览跳过这组字幕并报出来，导出拒绝并说明。
pub fn caption_problem(documents: &Documents, document_id: &str, style_document_id: Option<&str>) -> Option<CaptionProblem> {
    let Some(document) = documents.get(document_id) else {
        return Some((None, "caption-document-missing", format!("字幕文档 {document_id} 不在了")));
    };
    if read_captions(&document.body).is_none() {
        let found = schema(&document.body);
        let message = format!("字幕文档 {} 认不出", found.clone().unwrap_or_else(|| "（没有 schema）".into()));
        return Some((found, "caption-unknown-document", message));
    }
    let style_document = match style_document_id {
        Some(id) => match documents.get(id) {
            Some(style) => Some(style),
            None => return Some((None, "caption-style-missing", format!("字幕样式文档 {id} 不在了"))),
        },
        None => None,
    };
    match CaptionStyle::read(style_document) {
        Ok(_) => None,
        Err(found) => {
            let message = format!(
                "字幕样式 {} 认不出（导出不替换样式）",
                found.clone().unwrap_or_else(|| "（没有 schema）".into())
            );
            Some((found, "caption-unknown-style", message))
        }
    }
}

pub(crate) fn schema(value: &Value) -> Option<String> {
    value.get("schema").and_then(Value::as_str).map(str::to_string)
}
