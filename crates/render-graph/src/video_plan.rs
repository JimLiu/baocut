//! 画面的区间概览（架构设计 §9.11、§9.13 的成片导出）：一段序列范围里会出现哪些画面层、哪些转场，要用哪些素材与文档。
//!
//! 成片导出逐帧调 [`plan_frame`](super::plan_frame)，画面的规则只有那一份；这里只在启动时回答「这段范围要冻结什么、
//! 预检要查什么」：每个在范围里出现的视觉实例取它第一次出现的那一帧的层（含效果栈与内容），转场的另一侧也算；
//! 窗口与范围相交的转场各列一次。层上的 `transition` 去掉了（另一侧单独列出），不代表任何一帧的画面。
//!
//! 输出尺寸与画面在输出里的位置也在这里定（[`output_geometry`]）。

use std::collections::{BTreeSet, HashMap};

use editor_semantics::{Rate, Ratio, frame_time, frames_at};
use serde::{Deserialize, Serialize};
use video_model::{Id, TimelineItem, TransitionKind, VersionRef};

use super::audio_plan::{PlanRange, resolve_range};
use super::{LayerContent, PlanCanvas, PlanError, VideoView, VisualLayer, checked_fps, plan_frame, transition_window};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPlan {
    pub sequence_id: Id,
    pub range: PlanRange,
    pub fps: Rate,
    pub canvas: PlanCanvas,
    /// 范围里出现的画面层，每个实例一次（它第一次出现的那一帧），按实例 ID 排序。
    pub layers: Vec<VisualLayer>,
    /// 窗口与范围相交的转场。
    pub transitions: Vec<PlannedTransition>,
    /// 画面要用的素材版本（视频、图片、预渲染替身与代码包，以及 Lottie 贴纸参数里的素材），去重、排序。
    pub assets: Vec<VersionRef>,
    /// 范围里的字幕实例要读的文档与样式文档，去重、排序。
    pub documents: Vec<Id>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedTransition {
    pub id: Id,
    pub kind: String,
    /// 认不出的种类：画面按硬切。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsupported: Option<String>,
}

/// 序列 `sequence_id` 在 `range`（序列时间）里的画面概览。范围的规则与 [`plan_audio`](super::audio_plan::plan_audio) 相同。
pub fn plan_video(video: VideoView<'_>, sequence_id: &str, range: Option<(Ratio, Ratio)>) -> Result<VideoPlan, PlanError> {
    let sequence = video
        .sequences
        .get(sequence_id)
        .ok_or_else(|| PlanError::new("SEQUENCE_NOT_FOUND", format!("没有序列 {sequence_id}")))?;
    let fps = checked_fps(sequence)?;
    let (start, end) = resolve_range(sequence, range)?;
    // 范围覆盖的帧 `[f0, f1)`：起点所在的帧到终点之前的最后一帧。
    let f0 = frame_index(frames_at(start, fps).map(|f| f.floor()))?;
    let f1 = frame_index(frames_at(end, fps).map(|f| f.ceil()))?;
    let at = |frame: i64| -> Result<Ratio, PlanError> {
        let t = frame_time(frame as i128, fps).ok_or_else(|| PlanError::overflow("frame"))?;
        Ok(t.max(start))
    };

    let items: HashMap<&str, &TimelineItem> = sequence.items.iter().map(|item| (item.base().id.as_str(), item)).collect();
    let mut probes: BTreeSet<i64> = BTreeSet::new();
    let mut documents: BTreeSet<Id> = BTreeSet::new();
    for item in &sequence.items {
        let Some(span) = item.span() else { continue };
        if !item.base().enabled || span.end_frame() <= f0 || span.from_frame >= f1 {
            continue;
        }
        if let TimelineItem::Caption(caption) = item {
            documents.insert(caption.document_id.clone());
            documents.extend(caption.style_document_id.clone());
        }
        probes.insert(span.from_frame.max(f0));
    }
    let mut transitions = Vec::new();
    for tr in &sequence.transitions {
        let Some((_, _, from, to)) = transition_window(&items, tr) else {
            continue;
        };
        if to <= f0 || from >= f1 {
            continue;
        }
        probes.insert(from.max(f0));
        transitions.push(PlannedTransition {
            id: tr.id.clone(),
            kind: tr.kind.name().to_string(),
            unsupported: matches!(tr.kind, TransitionKind::Unsupported { .. }).then(|| "unknown-kind".to_string()),
        });
    }

    let mut layers: Vec<VisualLayer> = Vec::new();
    let mut canvas = None;
    for frame in probes {
        let plan = plan_frame(video, sequence_id, at(frame)?)?;
        for mut layer in plan.layers {
            let partner = layer.transition.take().and_then(|tr| tr.partner);
            for layer in std::iter::once(layer).chain(partner.map(|p| *p)) {
                if !layers.iter().any(|l| l.item_id == layer.item_id) {
                    layers.push(layer);
                }
            }
        }
        canvas.get_or_insert(plan.canvas);
    }
    let canvas = match canvas {
        Some(canvas) => canvas,
        None => plan_frame(video, sequence_id, start)?.canvas,
    };
    layers.sort_by(|a, b| a.item_id.cmp(&b.item_id));
    let assets: BTreeSet<(Id, String)> = layers
        .iter()
        .flat_map(|layer| layer.asset.clone().into_iter().chain(generator_asset(layer)))
        .map(|asset| (asset.id, asset.revision))
        .collect();
    Ok(VideoPlan {
        sequence_id: sequence.id.clone(),
        range: PlanRange::new(start, end)?,
        fps,
        canvas,
        layers,
        transitions,
        assets: assets.into_iter().map(|(id, revision)| VersionRef { id, revision }).collect(),
        documents: documents.into_iter().collect(),
    })
}

/// 生成器层参数里引用的素材（Lottie 贴纸的 `asset`）：层本身不带素材，但导出要冻结它，帧光栅从字节读。
fn generator_asset(layer: &VisualLayer) -> Option<VersionRef> {
    match &layer.content {
        Some(LayerContent::Generator { parameters, .. }) => parameters.get("asset").cloned().and_then(|v| serde_json::from_value(v).ok()),
        _ => None,
    }
}

/// 成片的输出尺寸与画面在其中的位置（像素）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputGeometry {
    pub width: u32,
    pub height: u32,
    /// 画面（按画布画出来的那一块）：与输出同尺寸时铺满；要的宽高比与画布不同时是居中的一块，其余是黑边。
    pub picture: PictureRect,
    /// 输出宽高与要的（或画布的）不一样：取偶数时调过。
    pub adjusted: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PictureRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// 成片的输出尺寸（宽高都取偶数，yuv420p 的要求；不小于 2）。
///
/// - 都不给：画布尺寸；只给高：宽按画布比例；只给宽：高按画布比例。这三种画面铺满输出。
/// - 宽高都给：输出就是这个尺寸；画面是放得下的最大的画布比例的一块（放不满的那一边取偶数），居中，其余是黑边
///   （画布比输出宽是上下黑边，窄是左右黑边）。画面里的排版按画布摆在这一块里，不按输出的比例重排。
pub fn output_geometry(canvas_width: u32, canvas_height: u32, width: Option<u32>, height: Option<u32>) -> OutputGeometry {
    let even = |v: f64| ((v / 2.0).round() * 2.0).max(2.0) as u32;
    let (cw, ch) = (f64::from(canvas_width.max(1)), f64::from(canvas_height.max(1)));
    let full = |width: u32, height: u32, adjusted: bool| OutputGeometry {
        width,
        height,
        picture: PictureRect { x: 0, y: 0, width, height },
        adjusted,
    };
    match (width, height) {
        (Some(w), Some(h)) => {
            let (out_w, out_h) = (even(f64::from(w)), even(f64::from(h)));
            let (fw, fh) = (f64::from(out_w), f64::from(out_h));
            // 画布相对更宽：宽铺满、高按比例；否则高铺满、宽按比例。按比例的一边不超过输出（输出是偶数，就近取偶不会越过）。
            let (pw, ph) = if cw * fh >= ch * fw {
                (out_w, even(ch * fw / cw).min(out_h))
            } else {
                (even(cw * fh / ch).min(out_w), out_h)
            };
            OutputGeometry {
                width: out_w,
                height: out_h,
                picture: PictureRect {
                    x: (out_w - pw) / 2,
                    y: (out_h - ph) / 2,
                    width: pw,
                    height: ph,
                },
                adjusted: out_w != w || out_h != h,
            }
        }
        (Some(w), None) => {
            let out_w = even(f64::from(w));
            let exact = ch * f64::from(out_w) / cw;
            let out_h = even(exact);
            full(out_w, out_h, out_w != w || f64::from(out_h) != exact)
        }
        (None, wanted) => {
            let wanted = wanted.unwrap_or(canvas_height);
            let out_h = even(f64::from(wanted));
            let exact = cw * f64::from(out_h) / ch;
            let out_w = even(exact);
            full(out_w, out_h, out_h != wanted || f64::from(out_w) != exact)
        }
    }
}

fn frame_index(frame: Option<i128>) -> Result<i64, PlanError> {
    frame
        .and_then(|f| i64::try_from(f).ok())
        .ok_or_else(|| PlanError::overflow("range"))
}
