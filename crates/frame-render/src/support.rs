//! 画得出来什么（格式规范 §3.7 的原则：画不出来的要明确报出来，不画成空白）。
//!
//! 预检与逐帧合成用同一份判断：预检把范围里每个画不出来的东西列出来（默认拒绝导出）；跳过模式下合成时不画它们，
//! 各自报一条警告。三种粒度：整层不画（`layer`）、跳过一个效果（`effect`）、转场按硬切（`transition`）；
//! 素材解不出画面是第四种（`asset`，由取画面的一方判断）。

use message_ref::{MessageRef, Text, msg};
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
    /// 英文说明（缺省与兜底）；界面按 `messageRef` 用自己的语言重新生成（仓库约定 §5）。
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_ref: Option<MessageRef>,
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

    pub fn layer(layer: &VisualLayer, kind: Option<String>, reason: &str, message: impl Into<Text>) -> UnsupportedItem {
        let message = message.into();
        UnsupportedItem {
            item_id: layer.item_id.clone(),
            scope: "layer",
            layer_kind: kind_name(layer.kind),
            effect_id: None,
            transition_id: None,
            kind,
            reason: reason.into(),
            message: message.text,
            message_ref: message.message_ref,
        }
    }

    /// 素材解不出画面的一项（整层不画）。
    pub fn asset(layer: &VisualLayer, kind: Option<String>, reason: &str, message: impl Into<Text>) -> UnsupportedItem {
        UnsupportedItem {
            scope: "asset",
            ..UnsupportedItem::layer(layer, kind, reason, message)
        }
    }
}

/// 素材画不出来的说明，合成与预检共用。`kind` 是格式名（SVG、GIF），`detail` 是解码器或系统的原话，都不翻译。
pub mod asset_text {
    use message_ref::{Text, msg};

    pub fn not_frozen(asset: &str) -> Text {
        msg!("frameRender.assetNotFrozen", "The file for asset {asset} isn’t available", asset)
    }

    pub fn no_picture(asset: &str) -> Text {
        msg!(
            "frameRender.assetNoPicture",
            "Asset {asset} has no picture (no video stream)",
            asset
        )
    }

    pub fn undecodable(asset: &str, detail: &str) -> Text {
        msg!(
            "frameRender.assetUndecodable",
            "Asset {asset} can’t be decoded: {detail}",
            asset,
            detail
        )
    }

    pub fn image_unreadable(kind: &str, asset: &str) -> Text {
        msg!("frameRender.imageUnreadable", "{kind} image {asset} can’t be read", kind, asset)
    }

    pub fn image_undecodable(kind: &str, asset: &str) -> Text {
        msg!("frameRender.imageUndecodable", "{kind} image {asset} can’t be decoded", kind, asset)
    }

    pub fn image_undecodable_detail(kind: &str, asset: &str, detail: &str) -> Text {
        msg!(
            "frameRender.imageUndecodableDetail",
            "{kind} image {asset} can’t be decoded: {detail}",
            kind,
            asset,
            detail
        )
    }

    pub fn template_logo_unreadable(asset: &str) -> Text {
        msg!(
            "frameRender.templateLogoUnreadable",
            "Template logo image {asset} can’t be read",
            asset
        )
    }

    pub fn template_logo_undecodable(asset: &str) -> Text {
        msg!(
            "frameRender.templateLogoUndecodable",
            "Template logo image {asset} can’t be decoded",
            asset
        )
    }

    pub fn template_logo_undecodable_detail(asset: &str, detail: &str) -> Text {
        msg!(
            "frameRender.templateLogoUndecodableDetail",
            "Template logo image {asset} can’t be decoded: {detail}",
            asset,
            detail
        )
    }

    pub fn lottie_no_asset() -> Text {
        msg!("frameRender.lottieNoAsset", "This Lottie sticker has no asset")
    }

    pub fn lottie_unreadable() -> Text {
        msg!("frameRender.lottieUnreadable", "The Lottie asset can’t be read")
    }

    pub fn lottie_unreadable_detail(detail: &str) -> Text {
        msg!(
            "frameRender.lottieUnreadableDetail",
            "The Lottie asset can’t be read: {detail}",
            detail
        )
    }

    pub fn lottie_unparsable(detail: &str) -> Text {
        msg!("frameRender.lottieUnparsable", "The Lottie asset can’t be parsed: {detail}", detail)
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
    let mut problems = check_layer_with(layer, template, &mut |document_id, style_document_id| {
        caption_problem(documents, document_id, style_document_id)
    });
    if let Some(problem) = caption_presentation_problem(layer, documents) {
        problems.push(problem);
    }
    problems
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
            let message = msg!("frameRender.effectUnsupported", "Effect {kind} can’t be drawn", kind = effect.kind);
            items.push(UnsupportedItem {
                item_id: layer.item_id.clone(),
                scope: "effect",
                layer_kind: kind_name(layer.kind),
                effect_id: Some(effect.id.clone()),
                transition_id: None,
                kind: Some(effect.kind.clone()),
                message: message.text,
                message_ref: message.message_ref,
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

/// 转场画不出来的说明（按硬切画），合成与预检共用。
pub fn transition_text(kind: &str) -> Text {
    msg!(
        "frameRender.transitionUnsupported",
        "Transition {kind} can’t be drawn; using a hard cut",
        kind
    )
}

/// 层的转场画不出来时的一项（按硬切画）。
pub fn check_transition(layer: &VisualLayer) -> Option<UnsupportedItem> {
    let transition = layer.transition.as_ref()?;
    let reason = transition_problem(&transition.kind, transition.unsupported.as_deref())?;
    let message = transition_text(&transition.kind);
    Some(UnsupportedItem {
        item_id: layer.item_id.clone(),
        scope: "transition",
        layer_kind: kind_name(layer.kind),
        effect_id: None,
        transition_id: Some(transition.id.clone()),
        kind: Some(transition.kind.clone()),
        message: message.text,
        message_ref: message.message_ref,
        reason,
    })
}

/// 形状与生成器引用的目录项（形状、贴纸模板、声波、进度条、彩纸的样式）在不在随内核发布的目录里。
/// 不在、或者根本没写（贴纸的 `templateId` 可以缺）时内核只能跳过不画，所以在这里报出来：`(目录项, 原因, 说明)`。
fn catalogue_problem(layer: &VisualLayer) -> Option<(Option<String>, &'static str, Text)> {
    let text = |value: &Value, key: &str| value.get(key).and_then(Value::as_str).map(str::to_string);
    let (id, found, what) = match &layer.content {
        Some(LayerContent::Shape { shape }) => {
            let id = text(shape, "shape");
            let found = id
                .as_deref()
                .is_some_and(|id| motion::preset_registry::timeline_shape(id).is_some());
            (id, found, Catalogue::Shape)
        }
        Some(LayerContent::Generator { generator, parameters, .. }) => {
            let (lookup, what): (fn(&str) -> bool, Catalogue) = match generator.as_str() {
                "baocut.sticker" => (|id| motion::preset_registry::timeline_sticker(id).is_some(), Catalogue::Sticker),
                "baocut.audio-visualizer" => (
                    |id| motion::preset_registry::timeline_visualizer(id).is_some(),
                    Catalogue::Visualizer,
                ),
                "baocut.progress" => (|id| motion::preset_registry::timeline_progress(id).is_some(), Catalogue::Progress),
                "baocut.confetti" => (|id| motion::preset_registry::timeline_confetti(id).is_some(), Catalogue::Confetti),
                _ => return None,
            };
            let key = if generator == "baocut.sticker" { "templateId" } else { "style" };
            let id = text(parameters, key);
            let found = id.as_deref().is_some_and(lookup);
            (id, found, what)
        }
        _ => return None,
    };
    match (found, id) {
        (true, _) => None,
        (false, Some(id)) => {
            let message = what.unknown(&id);
            Some((Some(id), "preset-unknown", message))
        }
        (false, None) => Some((None, "preset-missing", what.missing())),
    }
}

/// 随内核发布的目录：各自一整句说明，不拼名词（各语言的语序、性数不同）。
#[derive(Clone, Copy)]
enum Catalogue {
    Shape,
    Sticker,
    Visualizer,
    Progress,
    Confetti,
}

impl Catalogue {
    fn unknown(self, id: &str) -> Text {
        match self {
            Catalogue::Shape => msg!(
                "frameRender.shapeUnknown",
                "Shape {id} isn’t in the catalog shipped with the renderer",
                id
            ),
            Catalogue::Sticker => msg!(
                "frameRender.stickerTemplateUnknown",
                "Sticker template {id} isn’t in the catalog shipped with the renderer",
                id
            ),
            Catalogue::Visualizer => msg!(
                "frameRender.visualizerStyleUnknown",
                "Waveform style {id} isn’t in the catalog shipped with the renderer",
                id
            ),
            Catalogue::Progress => msg!(
                "frameRender.progressStyleUnknown",
                "Progress bar style {id} isn’t in the catalog shipped with the renderer",
                id
            ),
            Catalogue::Confetti => msg!(
                "frameRender.confettiStyleUnknown",
                "Confetti style {id} isn’t in the catalog shipped with the renderer",
                id
            ),
        }
    }

    fn missing(self) -> Text {
        match self {
            Catalogue::Shape => msg!("frameRender.shapeMissing", "No shape is specified"),
            Catalogue::Sticker => msg!("frameRender.stickerTemplateMissing", "No sticker template is specified"),
            Catalogue::Visualizer => msg!("frameRender.visualizerStyleMissing", "No waveform style is specified"),
            Catalogue::Progress => msg!("frameRender.progressStyleMissing", "No progress bar style is specified"),
            Catalogue::Confetti => msg!("frameRender.confettiStyleMissing", "No confetti style is specified"),
        }
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
                    msg!(
                        "frameRender.generatorNotImplemented",
                        "Generator {generator} can’t be drawn",
                        generator
                    ),
                ));
            }
            if generator == "baocut.template" {
                let layer_id = parameters.get("layerId").and_then(Value::as_str).unwrap_or(&layer.item_id);
                let reason = match template {
                    None => Some("template-missing"),
                    Some(doc) if !doc.layers.iter().any(|l| l.id == layer_id) => Some("template-missing"),
                    Some(doc) => crate::template::unsupported_reason(doc, layer_id, parameters),
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
        _ => Some(UnsupportedItem::layer(
            layer,
            None,
            "unknown-layer",
            msg!("frameRender.layerUnknown", "This kind of clip isn’t recognized"),
        )),
    }
}

/// 帧计划或这里标成不支持的原因给人看的说明。
fn unsupported_message(reason: &str) -> Text {
    match reason {
        "bundle-without-prerender" => msg!(
            "frameRender.bundleWithoutPrerender",
            "A code composition without a pre-rendered stand-in can’t be drawn (generate the stand-in first)"
        ),
        "sticker-asset-not-supported" => msg!(
            "frameRender.stickerAssetUnsupported",
            "This sticker’s asset can’t be drawn (sticker assets must be images, videos, or Lottie)"
        ),
        "placeholder-asset-not-supported" => msg!(
            "frameRender.placeholderAssetUnsupported",
            "The asset in this placeholder can’t be drawn (it must be an image or video)"
        ),
        "template-missing" => msg!(
            "frameRender.templateMissing",
            "This template layer isn’t in the sequence’s template"
        ),
        "template-logo-image-not-supported" => msg!(
            "frameRender.templateLogoImage",
            "Image logos referenced by file path can’t be drawn in templates (use a brand kit logo or a text logo)"
        ),
        "template-logo-asset-missing" => msg!(
            "frameRender.templateLogoAssetMissing",
            "The brand kit image used as the template logo isn’t in this video (pick the logo again to copy it in)"
        ),
        _ => msg!("frameRender.layerUnsupported", "This clip can’t be drawn"),
    }
}

/// 字幕层画不出来的原因：`(认出的种类, 原因, 说明)`。
pub type CaptionProblem = (Option<String>, &'static str, Text);

/// 字幕层画不画得出来：字幕文档与样式文档都在、认得出，样式有画法。只看文档，与层无关。
/// 认不出的样式不替人换成缺省样式：预览跳过这组字幕并报出来，导出拒绝并说明。
pub fn caption_problem(documents: &Documents, document_id: &str, style_document_id: Option<&str>) -> Option<CaptionProblem> {
    let Some(document) = documents.get(document_id) else {
        let message = msg!(
            "frameRender.captionDocumentMissing",
            "Subtitle document {document} no longer exists",
            document = document_id
        );
        return Some((None, "caption-document-missing", message));
    };
    if read_captions(&document.body).is_none() {
        let found = schema(&document.body);
        let message = match &found {
            Some(schema) => msg!(
                "frameRender.captionDocumentUnknown",
                "Subtitle document {schema} isn’t recognized",
                schema
            ),
            None => msg!(
                "frameRender.captionDocumentNoSchema",
                "The subtitle document isn’t recognized (it has no schema)"
            ),
        };
        return Some((found, "caption-unknown-document", message));
    }
    let style_document = match style_document_id {
        Some(id) => match documents.get(id) {
            Some(style) => Some(style),
            None => {
                let message = msg!(
                    "frameRender.captionStyleMissing",
                    "Subtitle style document {document} no longer exists",
                    document = id
                );
                return Some((None, "caption-style-missing", message));
            }
        },
        None => None,
    };
    match CaptionStyle::read(style_document) {
        Ok(_) => None,
        Err(found) => {
            let message = match &found {
                Some(schema) => msg!(
                    "frameRender.captionStyleUnknown",
                    "Subtitle style {schema} isn’t recognized (export doesn’t substitute styles)",
                    schema
                ),
                None => msg!(
                    "frameRender.captionStyleNoSchema",
                    "The subtitle style isn’t recognized (it has no schema; export doesn’t substitute styles)"
                ),
            };
            Some((found, "caption-unknown-style", message))
        }
    }
}

pub(crate) fn schema(value: &Value) -> Option<String> {
    value.get("schema").and_then(Value::as_str).map(str::to_string)
}

/// Instance overrides are checked separately from the document-only support cache.
pub fn caption_presentation_problem(layer: &VisualLayer, documents: &Documents) -> Option<UnsupportedItem> {
    let Some(LayerContent::Caption {
        presentation: Some(p),
        style_document_id,
        ..
    }) = &layer.content
    else {
        return None;
    };
    let style = style_document_id.as_deref().and_then(|id| documents.get(id));
    let result = match CaptionStyle::read(style) {
        Ok(CaptionStyle::Scene(s)) => caption_scene::validate_presentation(p, Some(s.scene())),
        _ => Err(caption_scene::Diagnostic::new(
            "CAPTION_SCENE_INVALID",
            "presentation",
            "scene style required",
        )),
    };
    result.err().map(|e| {
        let detail = e.to_string();
        UnsupportedItem::layer(
            layer,
            Some(caption_scene::STYLE_SCHEMA.into()),
            "caption-scene-invalid",
            msg!(
                "frameRender.captionSceneInvalid",
                "This clip’s subtitle style settings are invalid: {detail}",
                detail
            ),
        )
    })
}
