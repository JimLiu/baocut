//! 舞台的框：界面摆实例、改框、属性面板的位置与尺寸都经这里，算法是帧计划画层用的那一份（`render_graph::item_box`）。
//!
//! 输入只读推框要看的字段，别的字段（`span`、文字、样式……）不管，新建之前的草稿层也能算。素材只传实例引用的那一个，
//! 合成传预渲染：`{ kind, video?: { displayWidth, displayHeight, pixelAspectRatio } }`。

use editor_semantics::Rate;
use render_graph::item_box::{
    AssetFacts, BoxPose, ItemBox, ItemGeometry, PlaceChange, VisualKind, display_dims, item_box, place_defaults, place_from_box,
};
use serde::{Deserialize, Serialize};
use video_model::{AssetKind, Crop, Place, ShapeProps, StickerProps, VisualMode};

use crate::{EntryError, invalid_input};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItemInput {
    #[serde(rename = "type")]
    kind: VisualKind,
    #[serde(default)]
    place: Place,
    #[serde(default)]
    mode: Option<VisualMode>,
    #[serde(default)]
    shape: Option<ShapeInput>,
    #[serde(default)]
    sticker: Option<StickerInput>,
    #[serde(default)]
    crop: Option<Crop>,
}

/// 图形与贴纸只有一个字段参与框：图形的 `h`（画幅高 %），贴纸的 `templateId`（`box` 的高是宽的 0.62）。
#[derive(Deserialize)]
struct ShapeInput {
    #[serde(default)]
    h: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StickerInput {
    #[serde(default)]
    template_id: Option<String>,
}

/// 推框用的图形与贴纸属性：只填参与框的那个字段，别的留空。
struct Props {
    shape: Option<ShapeProps>,
    sticker: Option<StickerProps>,
}

impl Props {
    fn of(item: &ItemInput) -> Props {
        Props {
            shape: item.shape.as_ref().map(|input| ShapeProps {
                h: input.h,
                ..ShapeProps::new("")
            }),
            sticker: item.sticker.as_ref().map(|input| StickerProps {
                template_id: input.template_id.clone(),
                ..StickerProps::new("")
            }),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetInput {
    kind: AssetKind,
    #[serde(default)]
    video: Option<VideoInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoInput {
    display_width: u32,
    display_height: u32,
    pixel_aspect_ratio: Rate,
}

#[derive(Clone, Copy, Deserialize)]
struct Canvas {
    width: f64,
    height: f64,
}

/// 界面的框：中心、未旋转的宽高（画布像素）、角度（度）。
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Pose {
    cx: f64,
    cy: f64,
    w: f64,
    h: f64,
    rotation: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoxRequest {
    item: ItemInput,
    #[serde(default)]
    asset: Option<AssetInput>,
    canvas: Canvas,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaceRequest {
    item: ItemInput,
    #[serde(default)]
    asset: Option<AssetInput>,
    canvas: Canvas,
    pose: Pose,
}

#[derive(Deserialize)]
struct DefaultsRequest {
    #[serde(rename = "type")]
    kind: VisualKind,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoxOutput {
    #[serde(flatten)]
    pose: Pose,
    flip_x: bool,
    flip_y: bool,
    /// 铺满画布：框不看 `place` 的位置与大小，只能转。
    fullscreen: bool,
}

fn geometry<'a>(item: &'a ItemInput, props: &'a Props, asset: Option<&AssetInput>) -> ItemGeometry<'a> {
    ItemGeometry {
        kind: item.kind,
        place: &item.place,
        mode: item.mode,
        shape: props.shape.as_ref(),
        sticker: props.sticker.as_ref(),
        crop: item.crop.as_ref(),
        asset: asset.map(|asset| AssetFacts {
            kind: asset.kind,
            display: asset
                .video
                .as_ref()
                .and_then(|v| display_dims(v.display_width, v.display_height, v.pixel_aspect_ratio)),
        }),
    }
}

fn output(b: ItemBox) -> BoxOutput {
    BoxOutput {
        pose: Pose {
            cx: b.cx,
            cy: b.cy,
            w: b.width,
            h: b.height,
            rotation: b.rotation,
        },
        flip_x: b.flip_x,
        flip_y: b.flip_y,
        fullscreen: b.fullscreen,
    }
}

/// `{ item, asset?, canvas }` → `{ cx, cy, w, h, rotation, flipX, flipY, fullscreen }`。
pub fn stage_box(input: &[u8]) -> Result<String, EntryError> {
    let request: BoxRequest = serde_json::from_slice(input).map_err(invalid_input)?;
    let b = item_box(
        &geometry(&request.item, &Props::of(&request.item), request.asset.as_ref()),
        (request.canvas.width, request.canvas.height),
    );
    Ok(serde_json::to_string(&output(b)).expect("框总能序列化"))
}

/// `{ item, asset?, canvas, pose }` → 要写进 `place` 的字段（`x` / `y` / `w` / `scaleY` / `rot`，只有变了的）。
pub fn stage_place(input: &[u8]) -> Result<String, EntryError> {
    let request: PlaceRequest = serde_json::from_slice(input).map_err(invalid_input)?;
    let pose = BoxPose {
        cx: request.pose.cx,
        cy: request.pose.cy,
        width: request.pose.w,
        height: request.pose.h,
        rotation: request.pose.rotation,
    };
    let change: PlaceChange = place_from_box(
        &geometry(&request.item, &Props::of(&request.item), request.asset.as_ref()),
        pose,
        (request.canvas.width, request.canvas.height),
    );
    Ok(serde_json::to_string(&change).expect("字段总能序列化"))
}

/// `{ type }` → 这个种类的缺省落位 `{ x, y, w }`。
pub fn place_default(input: &[u8]) -> Result<String, EntryError> {
    let request: DefaultsRequest = serde_json::from_slice(input).map_err(invalid_input)?;
    Ok(serde_json::to_string(&place_defaults(request.kind)).expect("落位总能序列化"))
}
