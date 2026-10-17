//! 模板层（格式规范 §3.17）：序列上的模板文档每个打开的层是帧计划里的一个生成器层（`baocut.template`），
//! 按 `timeline` 的模板文档由渲染内核的 `template_layer::raster` 画——画法与 v2 的舞台、导出与缩略图是同一个函数。
//!
//! 章节类的层读序列的章节标记（标记的帧到下一个章节、或到序列的终点），`{title}` 是序列的名字。图片台标画的是
//! 视频里的那份素材（帧计划的 `asset` 参数）：品牌库的图片是拷进来的那份，按路径引用的（`{ file }`）是登记的那份；
//! 没有的报出来，不画。

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use render_raster::TextEngine;
use serde_json::Value;
use subtitle_render::{TemplateFrameParams, TemplateScene};
use timeline::template::{ChapterSpan, LayerKind as TemplateLayerKind, LogoSrc, TemplateDoc};
use tiny_skia::Pixmap;
use video_model::Sequence;

/// 一个模板层画不出来的原因（`None` 是画得出来）。`parameters` 是帧计划里这一层的生成器参数：图片台标的素材在
/// `asset` 里，没有就是视频里没有这张图。
pub fn unsupported_reason(doc: &TemplateDoc, layer_id: &str, parameters: &Value) -> Option<&'static str> {
    let layer = doc.layers.iter().find(|l| l.id == layer_id)?;
    match &layer.kind {
        TemplateLayerKind::Logo {
            src: LogoSrc::BrandLogo { .. },
            ..
        } if parameters.get("asset").is_none_or(Value::is_null) => Some("template-logo-asset-missing"),
        TemplateLayerKind::Logo {
            src: LogoSrc::File { .. }, ..
        } if parameters.get("asset").is_none_or(Value::is_null) => Some("template-logo-file-missing"),
        _ => None,
    }
}

/// 序列的章节：章节标记按帧排序，每章到下一章开始（或标记自己的长度、序列的终点）为止。
pub fn chapters(sequence: &Sequence, fps: f64, end_seconds: f64) -> Vec<ChapterSpan> {
    let mut marks: Vec<_> = sequence.markers.iter().filter(|m| m.is_chapter()).collect();
    marks.sort_by_key(|m| m.frame);
    marks
        .iter()
        .enumerate()
        .map(|(index, mark)| {
            let start = mark.frame as f64 / fps;
            let end = match (mark.duration_frames, marks.get(index + 1)) {
                (Some(d), _) if d > 0 => (mark.frame + d) as f64 / fps,
                (_, Some(next)) => next.frame as f64 / fps,
                _ => end_seconds,
            };
            ChapterSpan {
                id: mark.id.clone(),
                title: mark.label.clone(),
                start,
                end: end.max(start),
            }
        })
        .collect()
}

/// 模板层的场景缓存：按序列版本、层 ID 与台标图片的素材版本记住（场景要算指纹，不逐帧重建）。
#[derive(Default)]
pub struct TemplateScenes {
    scenes: HashMap<(String, String, String), TemplateScene>,
}

impl TemplateScenes {
    /// 画一个模板层：与输出等大的透明画布。`logo` 是图片台标解好的画面与它的 `素材ID@版本`。
    #[allow(clippy::too_many_arguments)]
    pub fn raster(
        &mut self,
        sequence: &Sequence,
        doc: &TemplateDoc,
        layer_id: &str,
        logo: Option<(String, Arc<Pixmap>)>,
        seconds: f64,
        duration: f64,
        fps: f64,
        size: (u32, u32),
        text: &mut TextEngine,
    ) -> Result<Pixmap> {
        let logo_version = logo.as_ref().map(|(version, _)| version.clone()).unwrap_or_default();
        let key = (sequence.revision.clone(), layer_id.to_string(), logo_version);
        if !self.scenes.contains_key(&key) {
            self.scenes.retain(|(revision, _, _), _| *revision == sequence.revision);
            let mut only = doc.clone();
            only.layers.retain(|l| l.id == layer_id);
            // 场景按台标的 key（品牌库条目 ID）找图：`TemplateScene::logo_key`。
            let logos = match (only.layers.first().map(|l| &l.kind), logo) {
                (Some(TemplateLayerKind::Logo { src, .. }), Some((_, pixmap))) => TemplateScene::logo_key(src)
                    .map(|key| vec![(key.to_string(), Arc::unwrap_or_clone(pixmap))])
                    .unwrap_or_default(),
                _ => Vec::new(),
            };
            let scene = TemplateScene::new(only, chapters(sequence, fps, duration), sequence.header.name.clone(), logos);
            self.scenes.insert(key.clone(), scene);
        }
        let scene = &self.scenes[&key];
        subtitle_render::template_layer::raster(
            scene,
            TemplateFrameParams {
                time: seconds,
                duration,
                width: size.0,
                height: size.1,
                fallback_family: render_raster::fonts::BUNDLED_CJK_FAMILY,
            },
            text,
            false,
        )
    }
}
