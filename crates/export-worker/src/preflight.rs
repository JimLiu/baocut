//! 预检（架构设计 §9.13）：范围里画不出来的东西逐项列出，素材能不能解出画面，编码走原生还是 ffmpeg、走 ffmpeg 时
//! 本机 ffmpeg 有没有要用的编码器。素材探测仍然经 ffprobe。
//! 导出启动时跑一次（不过就不创建任务），执行时再跑一次（拿到每个素材的画面尺寸，并确认冻结之后没有变）。

use std::collections::HashMap;
use std::sync::Arc;

use frame_render::support::{UnsupportedItem, check_layer, kind_name, transition_problem};
use frame_render::{Documents, FaceUse};
use media_core::Tools;
use media_core::probe::{encoders, probe_picture};
use render_graph::video_plan::plan_video;
use render_graph::{LayerContent, LayerKind, VisualLayer, plan_frame};
use serde::Serialize;
use video_model::VersionRef;

use crate::Failure;
use crate::input::Input;
use crate::native::{self, EncoderPlan};

#[derive(Clone, Debug, Serialize)]
pub struct Warning {
    pub code: &'static str,
    pub detail: String,
}

/// 解得出画面的素材：位置与显示尺寸。`svg` 的图片由帧光栅自己按 `width`×`height` 光栅（不经 ffmpeg）。
#[derive(Clone, Debug)]
pub struct AssetPicture {
    pub path: std::path::PathBuf,
    pub width: u32,
    pub height: u32,
    pub svg: bool,
    /// 解出来的画面可能带透明（[`media_core::probe::PictureInfo::alpha`]）；不带时视频帧不用逐像素预乘。
    pub alpha: bool,
}

/// SVG 图片光栅的长边：画面（输出里按画布画的那一块）的长边（画中画放大到整屏时也不糊）。
pub fn svg_long_edge(input: &Input) -> u32 {
    let picture = input.output.picture();
    picture.width.max(picture.height)
}

pub struct Preflight {
    pub frames: u64,
    pub items: Vec<UnsupportedItem>,
    pub warnings: Vec<Warning>,
    /// 要用的编码器里本机 ffmpeg 缺的那些（走原生写入器时为空）。
    pub missing_encoders: Vec<String>,
    /// 改走 ffmpeg 时缺的编码器（原生打不开、回落时用来报 `EXPORT_TOOL_MISSING`）。
    pub ffmpeg_missing: Vec<String>,
    /// 编码走原生还是 ffmpeg（[`native::choose_encoder`]）。
    pub encoder: EncoderPlan,
    pub pictures: HashMap<(String, String), AssetPicture>,
}

/// 一个素材版本的探测结果：解得出画面，或画不出来的原因与说明。
type Probed = Result<AssetPicture, (&'static str, String)>;

pub fn documents(input: &Input) -> Documents {
    Documents::new(input.documents.to_vec())
}

pub fn run(input: &Input, tools: &Tools) -> Result<Preflight, Failure> {
    let frames = input.frame_count()?;
    let range = input.range()?;
    let view = input.document.view();
    let plan = plan_video(view, &input.sequence_id, Some(range)).map_err(|e| Failure::new(&e.code, e.message))?;
    let documents = documents(input);
    let mut items = Vec::new();
    let warnings: Vec<Warning> = Vec::new();
    let mut pictures: HashMap<(String, String), AssetPicture> = HashMap::new();
    let mut probed: HashMap<(String, String), Probed> = HashMap::new();

    let sequence = input.document.sequences.get(&input.sequence_id);
    let template = sequence.and_then(|s| s.header.template.as_ref());
    for layer in &plan.layers {
        if layer.kind == LayerKind::Caption && !input.burn_captions {
            continue;
        }
        let layer_items = check_layer(layer, &documents, template);
        let dropped = layer_items.iter().any(UnsupportedItem::drops_layer);
        items.extend(layer_items);
        if dropped {
            continue;
        }
        if let Some(item) = check_lottie(input, layer) {
            items.push(item);
            continue;
        }
        if !matches!(layer.kind, LayerKind::Video | LayerKind::Image) {
            continue;
        }
        let Some(asset) = &layer.asset else { continue };
        let key = (asset.id.clone(), asset.revision.clone());
        let result = probed.entry(key.clone()).or_insert_with(|| {
            let Some(entry) = input.asset(&asset.id, &asset.revision) else {
                return Err(("asset-not-frozen", format!("素材 {} 没有冻结的位置", asset.id)));
            };
            let media_type = entry.media_type.as_deref().unwrap_or_default();
            if media_type == "image/svg+xml" || entry.path.extension().is_some_and(|e| e.eq_ignore_ascii_case("svg")) {
                let picture = std::fs::read(&entry.path)
                    .map_err(|e| e.to_string())
                    .and_then(|bytes| frame_render::decode_svg(&bytes, svg_long_edge(input)).map_err(|e| format!("{e:#}")));
                return match picture {
                    Ok(pixmap) => Ok(AssetPicture {
                        path: entry.path.clone(),
                        width: pixmap.width(),
                        height: pixmap.height(),
                        svg: true,
                        alpha: true,
                    }),
                    Err(e) => Err(("asset-undecodable", format!("SVG 图片解不开：{e}"))),
                };
            }
            // GIF 由帧光栅从素材字节解（动图按时刻取帧），这里用同一个函数判断解不解得开。
            if media_type.eq_ignore_ascii_case(frame_render::GIF_MEDIA_TYPE) {
                let gif = std::fs::read(&entry.path)
                    .map_err(|e| e.to_string())
                    .and_then(|bytes| frame_render::load_gif(&asset.id, &bytes).map_err(|e| format!("{e:#}")));
                return match gif {
                    Ok((gif, _)) => {
                        let (width, height) = gif.size();
                        Ok(AssetPicture {
                            path: entry.path.clone(),
                            width,
                            height,
                            svg: false,
                            alpha: true,
                        })
                    }
                    Err(e) => Err(("asset-undecodable", format!("GIF 图片解不开：{e}"))),
                };
            }
            match probe_picture(tools, &entry.path) {
                Ok(Some(info)) => Ok(AssetPicture {
                    path: entry.path.clone(),
                    width: info.width,
                    height: info.height,
                    svg: false,
                    alpha: info.alpha,
                }),
                Ok(None) => Err(("no-video-stream", "素材里没有画面".to_string())),
                Err(e) if e.code == "EXPORT_TOOL_MISSING" => Err(("tool-missing", e.message)),
                Err(e) => Err(("asset-undecodable", e.message)),
            }
        });
        match result {
            Ok(picture) => {
                pictures.insert(key, picture.clone());
            }
            Err((reason, message)) => {
                if *reason == "tool-missing" {
                    return Err(Failure::new("EXPORT_TOOL_MISSING", message.clone()));
                }
                items.push(UnsupportedItem {
                    item_id: layer.item_id.clone(),
                    scope: "asset",
                    layer_kind: kind_name(layer.kind),
                    effect_id: None,
                    transition_id: None,
                    kind: Some(asset.id.clone()),
                    reason: reason.to_string(),
                    message: message.clone(),
                });
            }
        }
    }

    for transition in &plan.transitions {
        let Some(reason) = transition_problem(&transition.kind, transition.unsupported.as_deref()) else {
            continue;
        };
        let item_id = sequence
            .and_then(|s| s.transitions.iter().find(|t| t.id == transition.id))
            .and_then(|t| t.left_item_id.clone().or_else(|| t.right_item_id.clone()))
            .unwrap_or_default();
        items.push(UnsupportedItem {
            item_id,
            scope: "transition",
            layer_kind: "transition",
            effect_id: None,
            transition_id: Some(transition.id.clone()),
            kind: Some(transition.kind.clone()),
            reason,
            message: format!("转场「{}」画不出来，按硬切画", transition.kind),
        });
    }

    let settings = input.encode_settings()?;
    let available = encoders(tools).map_err(|e| Failure::new(e.code, e.message))?;
    let mut ffmpeg_missing = Vec::new();
    let mut wanted = vec![settings.codec.encoder()];
    if settings.audio.is_some() {
        wanted.push(settings.container.audio_encoder());
    }
    for name in wanted {
        if !available.contains(name) {
            ffmpeg_missing.push(name.to_string());
        }
    }
    // 走原生写入器时不用 ffmpeg 的编码器，缺了也不拦；原生执行时打不开再回落 ffmpeg 时才要它们。
    let encoder = native::choose_encoder(&settings);
    let missing_encoders = match encoder {
        EncoderPlan::Native(_) => Vec::new(),
        EncoderPlan::Ffmpeg(_) => ffmpeg_missing.clone(),
    };
    let mut seen = std::collections::HashSet::new();
    items.retain(|item| seen.insert(item.key()));
    Ok(Preflight {
        frames,
        items,
        warnings,
        missing_encoders,
        ffmpeg_missing,
        encoder,
        pictures,
    })
}

/// 成片要用到的本机字体 face（架构设计 §9.11 的「字体」）：范围里出现的每个画面层用随内核发布的字体排一遍字
/// （[`frame_render::font_census`]），点了名、随内核的字体里没有的族的「族名、字重、斜体」。Runtime 按它在本机字体里
/// 挑好 face、记下文件与摘要冻结进快照；只在预检命令里求（执行时按冻结的装）。
pub fn font_faces(input: &Input) -> Result<Vec<FaceUse>, Failure> {
    let usage = font_usage(input)?;
    Ok(usage
        .faces
        .into_iter()
        .filter(|(family, ..)| usage.missing.contains(family))
        .collect())
}

/// 视频用到的字体（`fonts.usage`，架构设计 §9.1）：与 [`font_faces`] 同一遍排字，点了名的 face 全部给出（随内核的族也在），
/// 另给出随内核没有的族。不查素材、不查编码器：只排字。
pub fn font_usage(input: &Input) -> Result<frame_render::FontUsage, Failure> {
    let range = input.range()?;
    let view = input.document.view();
    let overview = plan_video(view, &input.sequence_id, Some(range)).map_err(|e| Failure::new(&e.code, e.message))?;
    let frame = plan_frame(view, &input.sequence_id, range.0).map_err(|e| Failure::new(&e.code, e.message))?;
    let fonts = frame_render::bundled_fonts().into_iter().map(Arc::new).collect();
    frame_render::font_usage(
        view,
        &frame,
        range.0.to_f64(),
        &overview.layers,
        documents(input),
        fonts,
        input.burn_captions,
    )
    .map_err(|e| Failure::new(&e.code, e.message))
}

/// Lottie 贴纸的素材有没有冻结、解不解得开（与合成时同一个解析）。
fn check_lottie(input: &Input, layer: &VisualLayer) -> Option<UnsupportedItem> {
    let Some(LayerContent::Generator { generator, parameters, .. }) = &layer.content else {
        return None;
    };
    if layer.kind != LayerKind::Generator || generator != "baocut.lottie" {
        return None;
    }
    let asset: Option<VersionRef> = parameters.get("asset").cloned().and_then(|v| serde_json::from_value(v).ok());
    let problem = match asset.and_then(|a| input.asset(&a.id, &a.revision).cloned()) {
        None => Some(("lottie-asset-missing", "Lottie 贴纸没有冻结的素材".to_string())),
        Some(entry) => match std::fs::read(&entry.path) {
            Err(e) => Some(("lottie-asset-missing", format!("Lottie 素材读不到：{e}"))),
            Ok(bytes) => frame_render::lottie_problem(&bytes).map(|(reason, why)| (reason, format!("Lottie 素材读不出来：{why}"))),
        },
    }?;
    Some(UnsupportedItem {
        item_id: layer.item_id.clone(),
        scope: "asset",
        layer_kind: kind_name(layer.kind),
        effect_id: None,
        transition_id: None,
        kind: None,
        reason: problem.0.to_string(),
        message: problem.1,
    })
}
