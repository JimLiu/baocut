//! 模板层（格式规范 §3.17）：序列上的模板文档每个打开的层是帧计划里的一个生成器层（`baocut.template`），
//! 按 `timeline` 的模板文档由渲染内核的 `template_layer::raster` 画——画法与 v2 的舞台、导出与缩略图是同一个函数。
//!
//! 章节类的层读序列的章节标记（标记的帧到下一个章节、或到序列的终点），`{title}` 是序列的名字。台标只画文字台标：
//! 图片台标（品牌库的台标、项目里的文件）在 v3 没有对应的素材，报出来，不画。

use std::collections::HashMap;

use anyhow::Result;
use render_raster::TextEngine;
use subtitle_render::{TemplateFrameParams, TemplateScene};
use timeline::template::{ChapterSpan, LayerKind as TemplateLayerKind, LogoSrc, TemplateDoc};
use tiny_skia::Pixmap;
use video_model::Sequence;

/// 一个模板层画不出来的原因（`None` 是画得出来）。
pub fn unsupported_reason(doc: &TemplateDoc, layer_id: &str) -> Option<&'static str> {
    let layer = doc.layers.iter().find(|l| l.id == layer_id)?;
    match &layer.kind {
        TemplateLayerKind::Logo {
            src: LogoSrc::BrandLogo { .. } | LogoSrc::File { .. },
            ..
        } => Some("template-logo-image-not-supported"),
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

/// 模板层的场景缓存：按序列版本与层 ID 记住（场景要算指纹，不逐帧重建）。
#[derive(Default)]
pub struct TemplateScenes {
    scenes: HashMap<(String, String), TemplateScene>,
}

impl TemplateScenes {
    /// 画一个模板层：与输出等大的透明画布。
    #[allow(clippy::too_many_arguments)]
    pub fn raster(
        &mut self,
        sequence: &Sequence,
        doc: &TemplateDoc,
        layer_id: &str,
        seconds: f64,
        duration: f64,
        fps: f64,
        size: (u32, u32),
        text: &mut TextEngine,
    ) -> Result<Pixmap> {
        let key = (sequence.revision.clone(), layer_id.to_string());
        if !self.scenes.contains_key(&key) {
            self.scenes.retain(|(revision, _), _| *revision == sequence.revision);
            let mut only = doc.clone();
            only.layers.retain(|l| l.id == layer_id);
            let scene = TemplateScene::new(only, chapters(sequence, fps, duration), sequence.header.name.clone(), Vec::new());
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
