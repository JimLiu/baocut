//! 字幕样式文档的正文（视频格式规范 §5.6，文档 `kind: 'caption-style'`）。
//!
//! Studio、定位框及动态场景三种正文。旧样式保持既有校验规则；动态场景委托
//! `caption-scene` 严格验证格式、类型、参数和执行能力，预览与导出复用同一合同。

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
        "wordAnimation": { "animationId": "magic-wbw", "animationName": "Color", "catalogId": "colourHighlight", "spoken": {}, "active": { "color": "#18E1D6" }, "unspoken": {} },
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
/// 一个 id；动态场景完整校验。其他 schema 保持既有行为。
pub fn caption_style_body_problems(body: &Value) -> Vec<Text> {
    let schema = body.get("schema").and_then(Value::as_str).unwrap_or_default();
    if schema.starts_with("baocut.caption-scene-style/") {
        return caption_scene::parse_style(body)
            .err()
            .map(|error| {
                msg!(
                    "videoModel.bodyShape",
                    "The body has fields of the wrong shape: {error}",
                    error = error.to_string()
                )
            })
            .into_iter()
            .collect();
    }
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
        assert_eq!(style["wordAnimation"]["catalogId"], json!("colourHighlight"));
        assert_eq!(style["wordAnimation"]["active"]["color"], json!("#18E1D6"));
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

pub fn presentation_problems(value: &caption_scene::Presentation) -> Vec<Text> {
    caption_scene::validate_presentation(value, None)
        .err()
        .map(|error| {
            msg!(
                "videoModel.bodyShape",
                "The body has fields of the wrong shape: {error}",
                error = error.to_string()
            )
        })
        .into_iter()
        .collect()
}

/// Declaration-order image dependencies, including frames not selected by the
/// current sample. A frozen document must remain usable after any later seek.
fn scene_images(scene: &caption_scene::Scene) -> impl Iterator<Item = &caption_scene::ImageResource> {
    scene
        .resources
        .iter()
        .chain(scene.sequences.iter().flat_map(|sequence| &sequence.frames))
}

/// Frozen resources referenced by a supported scene style; other documents have no scene refs.
pub fn scene_asset_refs(body: &Value) -> Result<Vec<crate::VersionRef>, String> {
    if body.get("schema").and_then(Value::as_str) != Some(caption_scene::STYLE_SCHEMA) {
        return Ok(vec![]);
    }
    let style = caption_scene::parse_style(body).map_err(|e| e.to_string())?;
    Ok(scene_images(style.scene())
        .map(|r| crate::VersionRef {
            id: r.asset_ref.id.clone(),
            revision: r.asset_ref.revision.clone(),
        })
        .collect())
}
pub fn scene_resource_problems(body: &Value, assets: &std::collections::BTreeMap<crate::Id, crate::AssetRecord>) -> Vec<Text> {
    if body.get("schema").and_then(Value::as_str) != Some(caption_scene::STYLE_SCHEMA) {
        return vec![];
    }
    let Ok(style) = caption_scene::parse_style(body) else {
        return caption_style_body_problems(body);
    };
    scene_images(style.scene())
        .filter_map(|r| {
            let found = assets.get(&r.asset_ref.id).and_then(|a| a.revisions.get(&r.asset_ref.revision));
            if found.is_some_and(|a| a.content_hash == r.content_hash && a.media_type == "image/png") {
                None
            } else {
                Some(msg!(
                    "videoModel.bodyShape",
                    "The body has fields of the wrong shape: {error}",
                    error = format!("CAPTION_RESOURCE_MISSING_OR_MISMATCH: {}@{}", r.asset_ref.id, r.asset_ref.revision)
                ))
            }
        })
        .collect()
}

#[cfg(test)]
mod scene_resource_tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeMap;

    fn image(id: &str, asset: &str) -> Value {
        json!({"id":id,"assetRef":{"id":asset,"revision":"frozen"},
               "contentHash":format!("sha256:{}", "a".repeat(64))})
    }

    fn style(frames: Vec<Value>) -> Value {
        json!({"schema":caption_scene::STYLE_SCHEMA,"scene":{"kind":"inline","value":{
            "schema":caption_scene::SCENE_SCHEMA,"evaluationVersion":1,
            "requiredCapabilities":["caption-image-sequence/1"],
            "layout":{"width":{"value":100,"basis":"absolute"},"x":{"value":50,"basis":"absolute"},"y":{"value":50,"basis":"absolute"}},
            "nodes":[{"id":"text","type":"text"}],
            "resources":[image("still","still-asset")],
            "sequences":[{"id":"sequence","premultiply":"shifted-byte","frames":frames}]
        }}})
    }

    fn asset(id: &str) -> crate::AssetRecord {
        let revision = |name: &str, hash: char| {
            json!({
                "revision":name,"contentHash":format!("sha256:{}",hash.to_string().repeat(64)),
                "byteLength":100,"mediaType":"image/png","storage":{"mode":"managed"},"provenance":{"origin":"test"}
            })
        };
        serde_json::from_value(json!({"id":id,"kind":"image","name":id,"currentRevision":"newer",
            "revisions":{"frozen":revision("frozen",'a'),"newer":revision("newer",'b')}}))
        .unwrap()
    }

    #[test]
    fn references_include_every_sequence_frame_in_declaration_order() {
        let frames: Vec<_> = (0..213).map(|i| image(&format!("frame{i}"), &format!("asset{i}"))).collect();
        let references = scene_asset_refs(&style(frames)).unwrap();
        assert_eq!(references.len(), 214);
        assert_eq!(references[0].id, "still-asset");
        assert_eq!(references[1].id, "asset0");
        assert_eq!(references[213].id, "asset212");
        assert!(references.iter().all(|r| r.revision == "frozen"));
    }

    #[test]
    fn resource_checks_cover_unselected_frames_and_frozen_revisions() {
        let body = style(vec![image("frame0", "first"), image("frame1", "last")]);
        let mut assets = BTreeMap::from([("still-asset".into(), asset("still-asset")), ("first".into(), asset("first"))]);
        assert_eq!(scene_resource_problems(&body, &assets).len(), 1);
        assets.insert("last".into(), asset("last"));
        assert!(scene_resource_problems(&body, &assets).is_empty());
        assets.get_mut("last").unwrap().revisions.get_mut("frozen").unwrap().media_type = "image/jpeg".into();
        assert_eq!(scene_resource_problems(&body, &assets).len(), 1);
        let revision = assets.get_mut("last").unwrap().revisions.get_mut("frozen").unwrap();
        revision.media_type = "image/png".into();
        revision.content_hash = format!("sha256:{}", "c".repeat(64));
        assert_eq!(scene_resource_problems(&body, &assets).len(), 1);
    }

    #[test]
    fn repeated_asset_dependencies_keep_existing_order_semantics() {
        let body = style(vec![image("frame0", "still-asset"), image("frame1", "other")]);
        let references = scene_asset_refs(&body).unwrap();
        assert_eq!(
            references.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            ["still-asset", "still-asset", "other"]
        );
        let old = json!({"schema":STUDIO_STYLE_SCHEMA,"style":{}});
        assert!(scene_asset_refs(&old).unwrap().is_empty());
        assert!(scene_resource_problems(&old, &BTreeMap::new()).is_empty());
    }

    #[test]
    fn malformed_sequence_resources_are_rejected_before_census() {
        let mut body = style(vec![image("frame0", "first")]);
        body["scene"]["value"]["sequences"][0]["frames"][0]["contentHash"] = json!("sha256:bad");
        assert!(scene_asset_refs(&body).is_err());
        assert!(!scene_resource_problems(&body, &BTreeMap::new()).is_empty());
    }
}
