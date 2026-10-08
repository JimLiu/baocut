//! 成片要用到的本机字体（架构设计 §9.11 的冻结）：导出提交时问一次，Runtime 按结果在本机字体里挑好 face、记下文件与
//! 摘要，执行时 Render Worker 只装这些 face。
//!
//! 做法是把范围里出现的每个画面层（`render_graph::video_plan` 的概览，每个实例一次，按它第一次出现的样子）放进一帧，
//! 用随内核发布的字体排一遍字：不画视频、图片、Lottie 与声波（它们不排字），转场按各自的层画。排字时点了名、随内核的
//! 字体里没有的族连同字重与斜体记下来，就是要去本机找的 face（与预览向宿主要的同一份记录）。字幕在编译时排全部句子，
//! 所以只出现在后面的句子也算在内。

use std::collections::BTreeSet;
use std::sync::Arc;

use render_graph::{FramePlan, LayerContent, LayerKind, VideoView, VisualLayer};
use tiny_skia::Pixmap;

use crate::documents::Documents;
use crate::renderer::{FrameRenderer, LayerMedia, RenderError, RenderOptions};
use render_raster::fonts::FaceUse;

/// 排字用的画面长边：字号随画面缩放，挑哪个 face 与字号无关，小一点省时间。
const CENSUS_LONG_EDGE: u32 = 480;

/// 不给画面：视频与图片层本来就不放进来。
struct NoMedia;

impl LayerMedia for NoMedia {
    fn picture(&mut self, _layer: &VisualLayer) -> Result<Option<&Pixmap>, RenderError> {
        Ok(None)
    }
}

/// 会排字的层：文字、图形、字幕与生成器（声波与 Lottie 贴纸除外）。
fn shapes_text(layer: &VisualLayer) -> bool {
    match layer.kind {
        LayerKind::Text | LayerKind::Shape | LayerKind::Caption => true,
        LayerKind::Generator => !matches!(
            &layer.content,
            Some(LayerContent::Generator { generator, .. }) if generator == "baocut.audio-visualizer" || generator == "baocut.lottie"
        ),
        LayerKind::Video | LayerKind::Image | LayerKind::Unsupported => false,
    }
}

/// 内置与本机都没有、也没下载到的字体族照它画（渲染内核的缺省无衬线族，也是 CJK 回退链的第一个）：缺字体的提示里
/// 说的就是它，`fonts.usage` 也照这个名字告诉界面。
pub const FALLBACK_FAMILY: &str = render_raster::fonts::BUNDLED_CJK_FAMILY;

/// 一次排字清点的结果：排字时点了名的全部 face（含随内核发布的族），以及其中随内核的字体里没有的族。
#[derive(Debug, Clone, Default)]
pub struct FontUsage {
    pub faces: Vec<FaceUse>,
    pub missing: BTreeSet<String>,
}

/// 把 `layers`（概览里的画面层）放进 `frame`（范围开头那一帧的计划，取它的序列与画布）排一遍字，返回要去本机找的
/// face：排字时点了名、`fonts`（随内核发布的那一套）里没有的族的「族名、字重、斜体」，按名字排序。`seconds` 是
/// `frame` 的时刻。
pub fn font_census(
    video: VideoView,
    frame: &FramePlan,
    seconds: f64,
    layers: &[VisualLayer],
    documents: Documents,
    fonts: Vec<Arc<Vec<u8>>>,
    captions: bool,
) -> Result<Vec<FaceUse>, RenderError> {
    let usage = font_usage(video, frame, seconds, layers, documents, fonts, captions)?;
    Ok(usage
        .faces
        .into_iter()
        .filter(|(family, ..)| usage.missing.contains(family))
        .collect())
}

/// 与 [`font_census`] 同一遍排字，但点了名的 face 全部给出（随内核的族也在里面），另给出其中随内核没有的族：
/// 视频用到哪些字体（`fonts.usage`）问的是这一份。
pub fn font_usage(
    video: VideoView,
    frame: &FramePlan,
    seconds: f64,
    layers: &[VisualLayer],
    documents: Documents,
    fonts: Vec<Arc<Vec<u8>>>,
    captions: bool,
) -> Result<FontUsage, RenderError> {
    let (width, height) = (frame.canvas.width.max(1), frame.canvas.height.max(1));
    let scale = f64::from(CENSUS_LONG_EDGE) / f64::from(width.max(height));
    let size = |side: u32| ((f64::from(side) * scale.min(1.0)).round() as u32).max(2);
    let mut renderer = FrameRenderer::with_shared_fonts(
        RenderOptions {
            width: size(width),
            height: size(height),
            skip_unsupported: true,
            captions,
        },
        documents,
        fonts,
    )?;
    let plan = FramePlan {
        layers: layers
            .iter()
            .filter(|layer| shapes_text(layer))
            .map(|layer| VisualLayer {
                transition: None,
                ..layer.clone()
            })
            .collect(),
        voices: Vec::new(),
        ..frame.clone()
    };
    renderer.render(video, &plan, seconds, &mut NoMedia)?;
    let missing: BTreeSet<String> = renderer.missing_fonts().into_iter().collect();
    Ok(FontUsage {
        faces: renderer.used_faces(),
        missing,
    })
}
