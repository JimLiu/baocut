//! 元素几何的**单一来源**（ADR-E01）。
//!
//! 这些数字以前在三个地方各写一遍：`apps/mac/.../StageElementHost.swift:144`
//! 的 `width*0.28` / `width*0.62`、`apps/gpui/src/adapters/stage_pose.rs:231-245`
//! 的同一套分支，以及 `skills/baocut/templates/studio` 的 `element-geometry.js`。
//! 高度公式是**契约的一部分**——舞台上的选中框、命中框与导出像素必须画在同一个
//! 盒子里——所以它只能有一个来源，客户端从这里读。
//!
//! 坐标语义沿用 `Place`：`x`/`y` 是画布百分比中心点，`w` 是画幅宽百分比，
//! 不引入第二套单位。**唯一的例外**是 `aspect == Square` 的声波与进度条：
//! 它们的 `w%` 量的是画幅**短边**（[`width_basis`]）——见那个函数的说明。

use crate::schema::{ElementKind, Place, ShapeProps, StickerProps, Tile};

/// 元素宽度百分比缺省（Mac `el.w ?? 20`）。
pub const DEFAULT_ELEMENT_W: f64 = 20.0;
/// 元素中心百分比缺省。
pub const DEFAULT_ELEMENT_X: f64 = 50.0;
pub const DEFAULT_ELEMENT_Y: f64 = 50.0;

/// `template == "box"` 贴纸的高宽比（原 `stage_pose.rs:240-243` 的 `width*0.62`）。
pub const STICKER_BOX_HEIGHT_RATIO: f64 = 0.62;
/// 贴纸模板 id：唯一一个不按正方处理的模板。
pub const STICKER_BOX_TEMPLATE: &str = "box";

/// 平铺媒体/文字的确定性 stamp 中心点。
///
/// 点位以画布中心为原点；调用方再统一应用元素缩放、旋转与动画位移。CPU strict、
/// Web GPU 与 native compositor 必须共用这份网格，不能各自根据可见区裁一套点。
pub fn tile_stamp_points(
    frame_width: u32,
    frame_height: u32,
    stamp_width: u32,
    stamp_height: u32,
    tile: &Tile,
) -> Vec<(f64, f64)> {
    let frame_width = f64::from(frame_width);
    let frame_height = f64::from(frame_height);
    let step_x = f64::from(stamp_width) + frame_width * tile.gap_x.unwrap_or(8.0).max(2.0) / 100.0;
    let step_y =
        f64::from(stamp_height) + frame_height * tile.gap_y.unwrap_or(10.0).max(2.0) / 100.0;
    let diagonal = frame_width.hypot(frame_height);
    let mut points = Vec::new();
    let mut row = 0_i64;
    let mut y = -diagonal / 2.0;
    while y <= diagonal / 2.0 + step_y {
        let offset_x = if tile.stagger.unwrap_or(true) && row.rem_euclid(2) == 1 {
            step_x / 2.0
        } else {
            0.0
        };
        let mut x = -diagonal / 2.0 - step_x + offset_x;
        while x <= diagonal / 2.0 + step_x {
            points.push((x, y));
            x += step_x;
        }
        row += 1;
        y += step_y;
    }
    points
}

/// visualizer 横条类默认几何（`1.0 × 0.2`，贴底）。
pub const VISUALIZER_BAR_W: f64 = 100.0;
pub const VISUALIZER_BAR_H: f64 = 20.0;
pub const VISUALIZER_BAR_Y: f64 = 85.0;
/// visualizer 圆形类（`ring_bars` / `ring_wave` / `pulse_rings`）**强制**正方，UI 锁比例。
///
/// 这个百分比量的是**画幅短边**而不是画幅宽——见 [`width_basis`]。
pub const VISUALIZER_SQUARE_W: f64 = 30.0;

/// progress 横条类（`normal` / `rounded`）默认几何。
pub const PROGRESS_BAR_W: f64 = 80.0;
pub const PROGRESS_BAR_H: f64 = 5.0;
/// progress 圆形类（`circle` / `donut` / `snake*`）。量的也是**画幅短边**
/// （[`width_basis`]）。
pub const PROGRESS_SQUARE_W: f64 = 30.0;
/// progress `*border` 类：跟随画布比铺满边框。
pub const PROGRESS_FRAME_W: f64 = 100.0;
pub const PROGRESS_FRAME_H: f64 = 100.0;

/// 目录型配方声明的纵横比（配方字段 `aspect`，ADR-E05 / §7.2）。
///
/// P0 只登记了 shape 目录，visualizer / progress 的配方在 P2 才进注册表；
/// 在那之前调用方给 `None`，本模块按各自的横条类默认兜底。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElementAspect {
    /// 自由比例（visualizer 横条类）。
    Free,
    /// 强制正方（visualizer / progress 的圆形类）。
    Square,
    /// 细横条（progress 的 `normal` / `rounded`）。
    Bar,
    /// 铺满边框（progress 的 `*border`）。
    Frame,
}

/// 一种 kind + aspect 组合的默认落位（帧百分比）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlaceDefaults {
    /// 宽度（画幅宽 %）。
    pub w: f64,
    /// 高度（画幅高 %）；`None` = 正方形（像素上取宽度）。
    pub h: Option<f64>,
    /// 中心 y（画幅高 %）。
    pub y: f64,
}

/// ADR-E01 的默认几何表。新建元素用它填 `Place`，属性面板用它做"恢复默认"。
pub fn default_place(kind: ElementKind, aspect: Option<ElementAspect>) -> PlaceDefaults {
    match kind {
        ElementKind::Visualizer => match aspect.unwrap_or(ElementAspect::Free) {
            // `h: None` = 像素正方（高取宽度）。**不是** `Some(30)`：那样在
            // 16:9 上是 576×324 的横盒，而配方是内切正方形画的，选中框与画出来
            // 的东西差了一圈（第 213 轮）。
            ElementAspect::Square => PlaceDefaults {
                w: VISUALIZER_SQUARE_W,
                h: None,
                y: DEFAULT_ELEMENT_Y,
            },
            _ => PlaceDefaults {
                w: VISUALIZER_BAR_W,
                h: Some(VISUALIZER_BAR_H),
                y: VISUALIZER_BAR_Y,
            },
        },
        ElementKind::Progress => match aspect.unwrap_or(ElementAspect::Bar) {
            ElementAspect::Square => PlaceDefaults {
                w: PROGRESS_SQUARE_W,
                h: None,
                y: DEFAULT_ELEMENT_Y,
            },
            ElementAspect::Frame => PlaceDefaults {
                w: PROGRESS_FRAME_W,
                h: Some(PROGRESS_FRAME_H),
                y: DEFAULT_ELEMENT_Y,
            },
            _ => PlaceDefaults {
                w: PROGRESS_BAR_W,
                h: Some(PROGRESS_BAR_H),
                y: DEFAULT_ELEMENT_Y,
            },
        },
        ElementKind::Draw => PlaceDefaults {
            w: 100.0,
            h: Some(100.0),
            y: DEFAULT_ELEMENT_Y,
        },
        // confetti 铺满画幅（aspect `frame`）：粒子在盒内生成并被盒裁切，
        // 缩小 place 就是「一柱纸屑」（设计稿 §3.1）。
        ElementKind::Confetti => PlaceDefaults {
            w: PROGRESS_FRAME_W,
            h: Some(PROGRESS_FRAME_H),
            y: DEFAULT_ELEMENT_Y,
        },
        ElementKind::Placeholder => PlaceDefaults {
            w: 42.0,
            h: Some(24.0),
            y: DEFAULT_ELEMENT_Y,
        },
        _ => PlaceDefaults {
            w: DEFAULT_ELEMENT_W,
            h: None,
            y: DEFAULT_ELEMENT_Y,
        },
    }
}

/// 一个元素的几何输入：`kind` + **该 kind 对应的那一组** props，其余为 `None`
/// （互斥规则见 `schema.rs` 的 `element-props-mismatch`）。
#[derive(Debug, Clone, Copy, Default)]
pub struct ElementGeometry<'a> {
    pub shape: Option<&'a ShapeProps>,
    pub sticker: Option<&'a StickerProps>,
    /// visualizer / progress 的纵横比，来自目录型配方的 `aspect` 字段。
    pub aspect: Option<ElementAspect>,
}

/// 元素盒宽度（像素）：`basis * w% * scale`。
///
/// `basis` 常规就是画幅宽；正方款要传 [`width_basis`] 给的短边。
pub fn element_width(place: Option<&Place>, frame_w: f64, scale: f64) -> f64 {
    let percent = place.and_then(|place| place.w).unwrap_or(DEFAULT_ELEMENT_W);
    frame_w * percent / 100.0 * scale
}

/// 这一款是不是**像素正方**（盒子的高恒等于宽）。
///
/// 判据就是 [`default_place`] 那张表里的 `h == None`——不另立一张表，否则
/// 两处迟早说两套话。shape / sticker 的正方走各自的分支，这里只认按 `aspect`
/// 定高的那三类。
pub fn is_pixel_square(kind: ElementKind, geometry: &ElementGeometry<'_>) -> bool {
    matches!(
        kind,
        ElementKind::Visualizer
            | ElementKind::Progress
            | ElementKind::Draw
            | ElementKind::Placeholder
    ) && default_place(kind, geometry.aspect).h.is_none()
}

/// `place.w` 这个百分比量的是哪条边（像素）。
///
/// 常规是画幅宽。**正方款量的是短边**：若尺寸存成 `{width, height}` 两个画布分数，
/// 正方款的 `{0.3, 0.3}` 要把长边那一维按画布比压回去，落在 16:9 上就是
/// `{0.16875, 0.3}`——也就是「短边的 30%」。
///
/// BaoCut 的 `place` 只有 `w` 一个尺寸字段（裁决 D2 不加 `h`），所以这一次换算
/// 不能落在**建元素**那一刻（那样要把画布比一路穿进 `new_element` 与 wasm 接口，
/// 还会在换画布比之后把正方拉扁）；把它放在读几何这一层，正方就永远是正方，
/// 换分辨率也不歪。
pub fn width_basis(kind: ElementKind, geometry: &ElementGeometry<'_>, frame: (f64, f64)) -> f64 {
    if is_pixel_square(kind, geometry) {
        frame.0.min(frame.1)
    } else {
        frame.0
    }
}

/// 元素盒高度（像素）。**唯一实现**，三端从这里读（ADR-E01 表）。
///
/// - Shape：`h` 显式给出用 `frame_h * h/100 * scale`；缺省为正方形（= 像素宽度）。
/// - Sticker：`template == "box"` 用 `width * 0.62`；其余正方。
///   历史上的 `type == "waveform"`（`width * 0.28`）**已废弃**——波形迁出为
///   独立的 [`ElementKind::Visualizer`]，高度改由配方 `aspect` 决定（§5.4）。
/// - Visualizer / Progress：没有显式 `h` 字段，高度来自 `aspect` 的默认表，
///   与 shape 的 `h` 同单位（画幅高 %）。
/// - 其余 kind：正方（沿用 Mac `elementHeight` 的兜底分支）。
pub fn element_height(
    kind: ElementKind,
    geometry: &ElementGeometry<'_>,
    frame_h: f64,
    width: f64,
    scale: f64,
) -> f64 {
    match kind {
        ElementKind::Shape => match geometry.shape.and_then(|shape| shape.h) {
            Some(percent) => frame_h * percent / 100.0 * scale,
            None => width,
        },
        ElementKind::Sticker => {
            let is_box = geometry.sticker.is_some_and(|sticker| {
                sticker.template_id.as_deref() == Some(STICKER_BOX_TEMPLATE)
            });
            if is_box {
                width * STICKER_BOX_HEIGHT_RATIO
            } else {
                width
            }
        }
        ElementKind::Visualizer
        | ElementKind::Progress
        | ElementKind::Draw
        | ElementKind::Placeholder
        | ElementKind::Confetti => match default_place(kind, geometry.aspect).h {
            Some(percent) => frame_h * percent / 100.0 * scale,
            None => width,
        },
        _ => width,
    }
}

/// 元素的静态盒 `(x, y, w, h)`，左上原点、像素单位——舞台选中框、命中框与
/// 导出几何共用同一个函数，避免"环画在一处、像素画在另一处"。
///
/// `place.scale_y` 是**纵向倍率**（第 122 轮裁决 D2）：没有 `place.h` 这个字段，
/// 四边缩放拉出来的高度一律落在这里，公式是 `h = w% × aspect × scaleY`——
/// `aspect` 那一段就是上面 [`element_height`] 给的「自然高」（已含 `scale`），
/// `scale_y` 再乘一次。缺席 = 1（不是回落到 `scale`：那样 `scaleY = 1` 会在
/// `scale ≠ 1` 时把元素压扁，而写回路径 `stage_drag::place_resize` 正是把
/// 「原样不动」算成 1 的）。
pub fn static_box(
    kind: ElementKind,
    geometry: &ElementGeometry<'_>,
    place: Option<&Place>,
    frame: (f64, f64),
) -> (f64, f64, f64, f64) {
    let scale = place.and_then(|place| place.scale).unwrap_or(1.0);
    let scale_y = place.and_then(|place| place.scale_y).unwrap_or(1.0);
    let width_percent = place
        .and_then(|place| place.w)
        .unwrap_or(default_place(kind, geometry.aspect).w);
    let width = width_basis(kind, geometry, frame) * width_percent / 100.0 * scale;
    let height = element_height(kind, geometry, frame.1, width, scale) * scale_y;
    let center_x = frame.0 * place.and_then(|place| place.x).unwrap_or(DEFAULT_ELEMENT_X) / 100.0;
    let center_y = frame.1
        * place
            .and_then(|place| place.y)
            .unwrap_or(default_place(kind, geometry.aspect).y)
        / 100.0;
    (
        center_x - width / 2.0,
        center_y - height / 2.0,
        width,
        height,
    )
}

/// 图片 / 视频 / 占位 / 素材贴纸的媒体盒缺省宽度（画幅宽 %；贴纸与占位走各自的表）。
pub const MEDIA_DEFAULT_W: f64 = 34.0;

/// 媒体盒没写 `place.w` 时的宽（画幅宽 %）：素材贴纸同正方款，占位框按它的缺省落位，其余是 [`MEDIA_DEFAULT_W`]。
pub fn media_default_w(kind: ElementKind) -> f64 {
    match kind {
        ElementKind::Sticker => DEFAULT_ELEMENT_W,
        ElementKind::Placeholder => default_place(kind, None).w,
        _ => MEDIA_DEFAULT_W,
    }
}

/// 外部媒体元素（image / video / placeholder / asset sticker）在画布上的盒：
/// `(宽, 高, 中心 x, 中心 y)`，像素，未含 `scale` / 旋转 / 动画。**唯一实现**：
/// GPU 纹理场景（`bcut-timeline-render::media`）与关键帧露底判定都从这里取。
///
/// `fullscreen` = 铺满模式且没有平铺：盒就是整张画布，`place.x/y/w` 不参与。
/// `natural` 是媒体的像素尺寸（宽高比决定 pip 盒的高）。
pub fn media_box(
    kind: ElementKind,
    fullscreen: bool,
    place: &Place,
    natural: (f64, f64),
    canvas: (f64, f64),
) -> (f64, f64, f64, f64) {
    let (canvas_width, canvas_height) = canvas;
    if fullscreen {
        return (
            canvas_width,
            canvas_height,
            canvas_width / 2.0,
            canvas_height / 2.0,
        );
    }
    let width = canvas_width * place.w.unwrap_or(media_default_w(kind)).max(1.0) / 100.0;
    let height = if kind == ElementKind::Placeholder {
        canvas_height * default_place(kind, None).h.unwrap_or(24.0) / 100.0
    } else {
        width * natural.1 / natural.0
    };
    (
        width,
        height,
        canvas_width * place.x.unwrap_or(50.0) / 100.0,
        canvas_height * place.y.unwrap_or(50.0) / 100.0,
    )
}

/// 一个经 `scale` / `scaleY` / `rot` 变换后的媒体盒，最多差多少像素才盖满画布：
/// 画布四角落在盒外的最远距离（盒的局部坐标里量），`0` = 盖满。
pub fn media_box_uncovered_gap(
    place: &Place,
    media_box: (f64, f64, f64, f64),
    canvas: (f64, f64),
) -> f64 {
    let (width, height, center_x, center_y) = media_box;
    let scale = place.scale.unwrap_or(1.0);
    let half_w = (width * scale).abs() / 2.0;
    let half_h = (height * scale * place.scale_y.unwrap_or(1.0)).abs() / 2.0;
    let angle = place.rot.unwrap_or(0.0).to_radians();
    let (sin, cos) = angle.sin_cos();
    let mut gap: f64 = 0.0;
    for (corner_x, corner_y) in [
        (0.0, 0.0),
        (canvas.0, 0.0),
        (0.0, canvas.1),
        (canvas.0, canvas.1),
    ] {
        let dx = corner_x - center_x;
        let dy = corner_y - center_y;
        // 逆旋转到盒的局部坐标。
        let local_x = dx * cos + dy * sin;
        let local_y = -dx * sin + dy * cos;
        gap = gap.max(local_x.abs() - half_w).max(local_y.abs() - half_h);
    }
    gap.max(0.0)
}

/// `progress = clamp((t - start) / (end - start), 0, 1)`（ADR-E04）。
///
/// progress 元素**不需要** `VisualSource`：它的内容完全由播放头推导，是纯函数。
pub fn progress_at(time: f64, start: f64, end: f64) -> f64 {
    if !(end > start) {
        return 0.0;
    }
    ((time - start) / (end - start)).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn place(w: Option<f64>, scale: Option<f64>) -> Place {
        Place {
            w,
            scale,
            ..Place::default()
        }
    }

    /// ADR-E01 的高度表逐行对照。改这张表就是改契约。
    #[test]
    fn the_height_table_is_the_single_source_of_truth() {
        let frame_h = 1080.0;
        let square = ShapeProps::new("rect");
        let mut tall = ShapeProps::new("rect");
        tall.h = Some(25.0);
        let box_sticker = {
            let mut sticker = StickerProps::new("template");
            sticker.template_id = Some(STICKER_BOX_TEMPLATE.to_owned());
            sticker
        };
        let plain_sticker = StickerProps::new("asset");

        let cases: &[(ElementKind, ElementGeometry<'_>, f64, f64, f64)] = &[
            // kind, geometry, width, scale, expected height
            (
                ElementKind::Shape,
                ElementGeometry {
                    shape: Some(&square),
                    ..Default::default()
                },
                400.0,
                1.0,
                400.0,
            ),
            (
                ElementKind::Shape,
                ElementGeometry {
                    shape: Some(&tall),
                    ..Default::default()
                },
                400.0,
                2.0,
                1080.0 * 0.25 * 2.0,
            ),
            (
                ElementKind::Sticker,
                ElementGeometry {
                    sticker: Some(&box_sticker),
                    ..Default::default()
                },
                400.0,
                1.0,
                400.0 * STICKER_BOX_HEIGHT_RATIO,
            ),
            (
                ElementKind::Sticker,
                ElementGeometry {
                    sticker: Some(&plain_sticker),
                    ..Default::default()
                },
                400.0,
                1.0,
                400.0,
            ),
            (
                ElementKind::Visualizer,
                ElementGeometry::default(),
                400.0,
                1.0,
                1080.0 * 0.20,
            ),
            // 正方款：高恒等于**已经按短边算出来的**宽度，不再乘画幅高。
            (
                ElementKind::Visualizer,
                ElementGeometry {
                    aspect: Some(ElementAspect::Square),
                    ..Default::default()
                },
                400.0,
                1.0,
                400.0,
            ),
            (
                ElementKind::Progress,
                ElementGeometry::default(),
                400.0,
                1.0,
                1080.0 * 0.05,
            ),
            (
                ElementKind::Progress,
                ElementGeometry {
                    aspect: Some(ElementAspect::Square),
                    ..Default::default()
                },
                400.0,
                1.0,
                400.0,
            ),
            (
                ElementKind::Progress,
                ElementGeometry {
                    aspect: Some(ElementAspect::Frame),
                    ..Default::default()
                },
                400.0,
                1.0,
                1080.0,
            ),
            (
                ElementKind::Image,
                ElementGeometry::default(),
                400.0,
                1.0,
                400.0,
            ),
        ];
        for (kind, geometry, width, scale, expected) in cases {
            assert_eq!(
                element_height(*kind, geometry, frame_h, *width, *scale),
                *expected,
                "{kind:?}"
            );
        }
    }

    /// 收编前 gpui 与 Mac 各写一遍的公式：宽度用 `w ?? 20`，`scale` 同时进宽高。
    #[test]
    fn the_static_box_matches_the_two_client_formulas() {
        let frame = (1920.0, 1080.0);
        let props = ShapeProps::new("rect");
        let geometry = ElementGeometry {
            shape: Some(&props),
            ..Default::default()
        };
        let (x, y, w, h) = static_box(ElementKind::Shape, &geometry, None, frame);
        assert_eq!(w, 1920.0 * 20.0 / 100.0);
        assert_eq!(h, w);
        assert_eq!(x, 1920.0 / 2.0 - w / 2.0);
        assert_eq!(y, 1080.0 / 2.0 - h / 2.0);

        let scaled = place(Some(50.0), Some(2.0));
        let (_, _, w, h) = static_box(ElementKind::Shape, &geometry, Some(&scaled), frame);
        assert_eq!(w, 1920.0 * 0.5 * 2.0);
        assert_eq!(h, w);
    }

    /// 第 122 轮 D2：`place.scaleY` 只改高、不改宽，且是**乘在自然高上**的倍率。
    #[test]
    fn scale_y_stretches_the_static_box_vertically_only() {
        let frame = (1920.0, 1080.0);
        let props = ShapeProps::new("rect");
        let geometry = ElementGeometry {
            shape: Some(&props),
            ..Default::default()
        };
        let stretched = Place {
            w: Some(50.0),
            scale: Some(2.0),
            scale_y: Some(1.6),
            ..Place::default()
        };
        let (_, y, w, h) = static_box(ElementKind::Shape, &geometry, Some(&stretched), frame);
        // 宽不动：`scaleY` 不参与宽度那一路。
        assert_eq!(w, 1920.0 * 0.5 * 2.0);
        // 高 = 自然高（正方 = 像素宽，已含 scale）× scaleY。
        assert_eq!(h, w * 1.6);
        // 中心不动，盒子从中心往两边长。
        assert_eq!(y, 1080.0 / 2.0 - h / 2.0);

        // 缺席 = 1，不是回落到 `scale`。
        let plain = Place {
            w: Some(50.0),
            scale: Some(2.0),
            ..Place::default()
        };
        let (_, _, _, plain_h) = static_box(ElementKind::Shape, &geometry, Some(&plain), frame);
        assert_eq!(plain_h, w);
    }

    /// visualizer 横条贴底：缺省 y 走配方默认表，不是画面正中。
    #[test]
    fn the_visualizer_bar_defaults_to_the_bottom_of_the_frame() {
        let defaults = default_place(ElementKind::Visualizer, None);
        assert_eq!(
            (defaults.w, defaults.h, defaults.y),
            (100.0, Some(20.0), 85.0)
        );
        let (_, y, _, h) = static_box(
            ElementKind::Visualizer,
            &ElementGeometry::default(),
            None,
            (1920.0, 1080.0),
        );
        assert_eq!(h, 1080.0 * 0.2);
        assert_eq!(y, 1080.0 * 0.85 - h / 2.0);
    }

    /// 第 213 轮：正方款的盒子必须**是一只像素正方**，而且它的边长
    /// 量在画幅短边上——横画幅、竖画幅各量一次，出来的边长一样。
    #[test]
    fn the_square_aspect_box_is_a_true_pixel_square_on_the_short_side() {
        let geometry = ElementGeometry {
            aspect: Some(ElementAspect::Square),
            ..Default::default()
        };
        for frame in [(1920.0, 1080.0), (1080.0, 1920.0), (1080.0, 1080.0)] {
            let (x, y, w, h) = static_box(ElementKind::Visualizer, &geometry, None, frame);
            assert_eq!(w, h, "{frame:?} 不是正方");
            // 正方款默认边长 = 短边的 30%。
            assert_eq!(w, frame.0.min(frame.1) * 0.30, "{frame:?} 边长");
            assert_eq!(x, frame.0 / 2.0 - w / 2.0);
            assert_eq!(y, frame.1 / 2.0 - h / 2.0);
        }
        // 横条款不吃这条：仍然量画幅宽。
        let (_, _, w, h) = static_box(
            ElementKind::Visualizer,
            &ElementGeometry::default(),
            None,
            (1920.0, 1080.0),
        );
        assert_eq!(w, 1920.0);
        assert_eq!(h, 1080.0 * 0.2);
    }

    #[test]
    fn progress_is_clamped_and_degenerate_spans_read_zero() {
        assert_eq!(progress_at(2.0, 2.0, 6.0), 0.0);
        assert_eq!(progress_at(4.0, 2.0, 6.0), 0.5);
        assert_eq!(progress_at(9.0, 2.0, 6.0), 1.0);
        assert_eq!(progress_at(-1.0, 2.0, 6.0), 0.0);
        assert_eq!(progress_at(4.0, 6.0, 6.0), 0.0);
    }
}
