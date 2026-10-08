//! 字幕样式文档的正文（视频格式规范 §5.6，文档 `kind: 'caption-style'`）。
//!
//! 两种正文：Studio 样式（`baocut.legacy-studio-style/0.1`，v2 字幕样式的 `style` 原样）与定位框样式
//! （`baocut.boxed-caption-style/<N>`，外部工程导入写的）。引擎写入时只核对定位框样式的逐词动画
//! （[`caption_style_body_problems`]），其余字段由渲染内核读，不校验。

use message_ref::{Text, msg};
use serde_json::Value;

pub const CAPTION_STYLE_KIND: &str = "caption-style";
/// Studio 字幕样式。
pub const STUDIO_STYLE_SCHEMA: &str = "baocut.legacy-studio-style/0.1";
const BOXED_STYLE_PREFIX: &str = "baocut.boxed-caption-style/";

/// 定位框样式：`baocut.boxed-caption-style/` 后面跟版本号。
pub fn is_boxed_style_schema(schema: &str) -> bool {
    schema
        .strip_prefix(BOXED_STYLE_PREFIX)
        .is_some_and(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
}

/// 默认预设（视频格式规范 §5.6「默认预设」）：没有样式文档的字幕按它画，新建字幕层种下的 Studio 样式也是它。
///
/// 涂装是新建项目的种子「经典」（原型 `model-defaultsub.js`，编辑器 `caption-presets.ts` 的 `CLASSIC`，逐字段相同）：
/// 白字、700 字重、黑色描边（`textOutline.width` 是字号的百分比，随字号缩放）与投影，浅色画面上也看得清；底板关着。
/// `punct: true`：普通逗号、句号换成空格；转写和导出的字幕文件保留原文。不分语言。
/// 编辑器（`packages/ui/src/model/property-values.ts` 的 `DEFAULT_CAPTION_STYLE`）与流程（`packages/jobs` 的
/// `caption-layer.ts`）各有一份同样的正文，改的时候三处一起改。
pub fn default_studio_style() -> Value {
    serde_json::json!({
        "fontStyle": "normal",
        "underline": false,
        "textAlign": "center",
        "lineHeight": 1.2,
        "letterSpacing": 0,
        "textTransform": "none",
        "background": false,
        "backgroundColor": "#000000B3",
        "backgroundStyle": "wrap",
        "backgroundPadding": 10,
        "borderRadius": 15,
        "fontFamily": "system",
        "fontWeight": 700,
        "bold": true,
        "italic": false,
        "fontColor": "#FFFFFF",
        "textOutline": { "on": true, "color": "#000000", "width": 14 },
        "dropShadow": { "on": true, "blur": 0.12, "distance": 0.08, "rotation": 45, "color": "#000000", "opacity": 0.9 },
        "outline": true,
        "glow": { "on": false },
        "punct": true
    })
}

/// 逐词动画目录的 19 个 id，与渲染内核的目录（`subtitle_render::word_animation_catalog::WORD_ANIMATIONS`）同名同序。
pub const WORD_ANIMATION_IDS: [&str; 19] = [
    "none",
    "boxHighlight",
    "flipClock",
    "highlight",
    "karaoke",
    "impact",
    "reveal",
    "floatInTop",
    "floatInBottom",
    "scaleIn",
    "dropIn",
    "impactPop",
    "colourHighlight",
    "rotateFlipClock",
    "rotateHighlight",
    "stack",
    "stomp",
    "bounce",
    "paint",
];

/// 正文与 §5.6 不合的地方（空表示合）。定位框样式：`style` 是对象；`style.animationPresetId` 出现时是逐词动画目录里的
/// 一个 id。别的 schema 不核对。
pub fn caption_style_body_problems(body: &Value) -> Vec<Text> {
    let schema = body.get("schema").and_then(Value::as_str).unwrap_or_default();
    if !is_boxed_style_schema(schema) {
        return Vec::new();
    }
    let mut problems = Vec::new();
    match body.get("style") {
        None => {}
        Some(Value::Object(style)) => match style.get("animationPresetId") {
            None => {}
            Some(Value::String(id)) if WORD_ANIMATION_IDS.contains(&id.as_str()) => {}
            Some(other) => problems.push(msg!(
                "videoModel.captionAnimationUnknown",
                "style.animationPresetId must be an ID from the word animation catalog, not {value}",
                value = other.to_string()
            )),
        },
        Some(_) => problems.push(msg!("videoModel.captionStyleNotObject", "style must be an object")),
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn boxed_schema_versions() {
        assert!(is_boxed_style_schema("baocut.boxed-caption-style/1"));
        assert!(is_boxed_style_schema("baocut.boxed-caption-style/18"));
        assert!(!is_boxed_style_schema("baocut.boxed-caption-style/"));
        assert!(!is_boxed_style_schema("baocut.boxed-caption-style/1a"));
        assert!(!is_boxed_style_schema(STUDIO_STYLE_SCHEMA));
    }

    #[test]
    fn the_default_preset_outlines_and_projects_punctuation() {
        let style = default_studio_style();
        assert_eq!(style["textOutline"], json!({ "on": true, "color": "#000000", "width": 14 }));
        assert_eq!(style["background"], json!(false));
        assert_eq!(style["punct"], json!(true));
        assert!(caption_style_body_problems(&json!({ "schema": STUDIO_STYLE_SCHEMA, "style": style })).is_empty());
    }

    #[test]
    fn boxed_animation_presets_come_from_the_catalogue() {
        let boxed = |style: Value| json!({ "schema": "baocut.boxed-caption-style/18", "style": style });
        assert!(caption_style_body_problems(&boxed(json!({ "animationPresetId": "reveal" }))).is_empty());
        assert!(caption_style_body_problems(&boxed(json!({ "fontSize": 40 }))).is_empty());
        assert!(caption_style_body_problems(&json!({ "schema": "baocut.boxed-caption-style/1" })).is_empty());
        for bad in [
            json!({ "animationPresetId": "typewriter" }),
            json!({ "animationPresetId": 3 }),
            json!({ "animationPresetId": null }),
        ] {
            assert_eq!(caption_style_body_problems(&boxed(bad.clone())).len(), 1, "{bad}");
        }
        assert_eq!(caption_style_body_problems(&boxed(json!("reveal"))).len(), 1);
        // Studio 样式与别的 schema 不核对：旧文档里的 `catalogId` 可能是内核名。
        let studio = json!({ "schema": STUDIO_STYLE_SCHEMA, "style": { "wordAnimation": { "catalogId": "Color" } } });
        assert!(caption_style_body_problems(&studio).is_empty());
    }
}
