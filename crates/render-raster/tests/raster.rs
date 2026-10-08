//! `media` 门内：本文件用 `LoadedAssets` / `MediaStore` / `FrameRenderer`
//! （BCF 文档渲染链路与 host 字节层），`wasm-safe` 构建里不存在（设计 §9.1）。
#![cfg(feature = "media")]

use motion::effect::BlendMode;
use render_raster::drawop::{
    BitmapData, DrawOp, FrameOps, GradientStop, PaintData, PathData, PathSeg,
};
use render_raster::{LoadedAssets, MediaStore};
use std::sync::Arc;

const IDENTITY: [f32; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

fn square_path(x: f32, y: f32, size: f32) -> PathData {
    PathData(vec![
        PathSeg {
            verb: 0,
            pts: [x, y, 0.0, 0.0, 0.0, 0.0],
        },
        PathSeg {
            verb: 1,
            pts: [x + size, y, 0.0, 0.0, 0.0, 0.0],
        },
        PathSeg {
            verb: 1,
            pts: [x + size, y + size, 0.0, 0.0, 0.0, 0.0],
        },
        PathSeg {
            verb: 1,
            pts: [x, y + size, 0.0, 0.0, 0.0, 0.0],
        },
        PathSeg {
            verb: 4,
            pts: [0.0; 6],
        },
    ])
}

fn empty_media() -> MediaStore {
    MediaStore::new(Arc::new(LoadedAssets::default()), 30.0)
}

fn pixel(pm: &tiny_skia::Pixmap, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * pm.width() + x) * 4) as usize;
    pm.data()[i..i + 4].try_into().unwrap()
}

#[test]
fn rounded_rect_path_handles_square_rounded_and_invalid_rectangles() {
    let square = render_raster::raster::rounded_rect_path(0.0, 0.0, 10.0, 8.0, 0.0).unwrap();
    let rounded = render_raster::raster::rounded_rect_path(0.0, 0.0, 10.0, 8.0, 100.0).unwrap();
    assert!(!square.segments().collect::<Vec<_>>().is_empty());
    assert!(
        rounded
            .segments()
            .any(|segment| matches!(segment, tiny_skia::PathSegment::CubicTo(_, _, _)))
    );
    assert!(render_raster::raster::rounded_rect_path(0.0, 0.0, -1.0, 8.0, 0.0).is_none());
}

#[test]
fn rasterize_replays_shapes_strokes_and_translucent_layers() {
    let frame = FrameOps {
        static_prefix: None,
        paths: vec![square_path(11.0, 1.0, 6.0)],
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        ops: vec![
            DrawOp::Clear {
                color: [0.0, 0.0, 0.0, 1.0],
            },
            DrawOp::FillRect {
                x: 1.0,
                y: 1.0,
                w: 8.0,
                h: 8.0,
                radius: 2.0,
                color: [1.0, 0.0, 0.0, 1.0],
                tf: IDENTITY,
            },
            DrawOp::FillPath {
                path: 0,
                color: [0.0, 1.0, 0.0, 1.0],
                tf: IDENTITY,
            },
            DrawOp::StrokePath {
                path: 0,
                color: [1.0, 1.0, 1.0, 1.0],
                width: 1.0,
                tf: IDENTITY,
            },
            DrawOp::PushLayer {
                opacity: 0.5,
                blend: BlendMode::Normal,
            },
            DrawOp::FillRect {
                x: 2.0,
                y: 12.0,
                w: 6.0,
                h: 6.0,
                radius: 0.0,
                color: [0.0, 0.0, 1.0, 1.0],
                tf: IDENTITY,
            },
            DrawOp::PopLayer,
        ],
    };

    let pixmap = render_raster::raster::rasterize(&frame, 20, 20, &mut empty_media()).unwrap();

    let red = pixel(&pixmap, 4, 4);
    assert!(red[0] > 240 && red[1] < 10 && red[2] < 10);
    let green = pixel(&pixmap, 13, 4);
    assert!(green[1] > green[0] && green[1] > green[2]);
    let blue = pixel(&pixmap, 4, 14);
    assert!(blue[2] >= 120 && blue[2] <= 135);
}

#[test]
fn rasterize_draws_loaded_images_and_rejects_unknown_references() {
    let mut image = tiny_skia::Pixmap::new(2, 2).unwrap();
    image.fill(tiny_skia::Color::from_rgba8(12, 34, 56, 255));
    let mut assets = LoadedAssets::default();
    assets.images.insert("logo".into(), Arc::new(image));
    let mut media = MediaStore::new(Arc::new(assets), 30.0);
    let frame = FrameOps {
        static_prefix: None,
        strings: vec!["logo".into()],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![],
        ops: vec![
            DrawOp::Clear {
                color: [0.0, 0.0, 0.0, 1.0],
            },
            DrawOp::DrawMedia {
                asset: 0,
                media_ms: -1,
                src: [0.0; 4],
                tf: IDENTITY,
            },
        ],
    };
    let pixmap = render_raster::raster::rasterize(&frame, 2, 2, &mut media).unwrap();
    assert_eq!(pixel(&pixmap, 0, 0), [12, 34, 56, 255]);

    let unknown_string = FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![],
        ops: vec![DrawOp::DrawMedia {
            asset: 0,
            media_ms: -1,
            src: [0.0; 4],
            tf: IDENTITY,
        }],
    };
    let err = render_raster::raster::rasterize(&unknown_string, 2, 2, &mut empty_media())
        .unwrap_err()
        .to_string();
    assert!(err.contains("未知 string"));
}

#[test]
fn rasterize_reports_unbalanced_layers() {
    let pop = FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![],
        ops: vec![DrawOp::PopLayer],
    };
    assert!(
        render_raster::raster::rasterize(&pop, 2, 2, &mut empty_media())
            .unwrap_err()
            .to_string()
            .contains("无匹配")
    );

    let push = FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![],
        ops: vec![DrawOp::PushLayer {
            opacity: 1.0,
            blend: BlendMode::Normal,
        }],
    };
    assert!(
        render_raster::raster::rasterize(&push, 2, 2, &mut empty_media())
            .unwrap_err()
            .to_string()
            .contains("层栈非空")
    );
}

// ── DrawOp v3：裁剪栈与层混合 ────────────────────────────────────────

fn clear_white() -> DrawOp {
    DrawOp::Clear {
        color: [1.0, 1.0, 1.0, 1.0],
    }
}

fn fill_all(color: [f32; 4]) -> DrawOp {
    DrawOp::FillRect {
        x: 0.0,
        y: 0.0,
        w: 20.0,
        h: 20.0,
        radius: 0.0,
        color,
        tf: IDENTITY,
    }
}

#[test]
fn clip_path_limits_drawing_to_the_clipped_region() {
    let frame = FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![square_path(0.0, 0.0, 10.0)],
        ops: vec![
            clear_white(),
            DrawOp::ClipPath {
                path: 0,
                tf: IDENTITY,
            },
            fill_all([1.0, 0.0, 0.0, 1.0]),
            DrawOp::PopClip,
        ],
    };
    let pixmap = render_raster::raster::rasterize(&frame, 20, 20, &mut empty_media()).unwrap();
    // 裁剪内：红；裁剪外：仍是清屏白
    assert_eq!(pixel(&pixmap, 4, 4), [255, 0, 0, 255]);
    assert_eq!(pixel(&pixmap, 15, 15), [255, 255, 255, 255]);
}

#[test]
fn nested_clip_paths_intersect_and_pop_restores_the_outer_one() {
    let frame = FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![
            square_path(0.0, 0.0, 12.0),
            square_path(6.0, 6.0, 12.0),
            square_path(0.0, 0.0, 20.0),
        ],
        ops: vec![
            clear_white(),
            DrawOp::ClipPath {
                path: 0,
                tf: IDENTITY,
            },
            DrawOp::ClipPath {
                path: 1,
                tf: IDENTITY,
            },
            fill_all([1.0, 0.0, 0.0, 1.0]),
            DrawOp::PopClip,
            // 回到外层裁剪（0..12）：这里画蓝色只应落在 0..12 内
            DrawOp::FillRect {
                x: 0.0,
                y: 0.0,
                w: 4.0,
                h: 20.0,
                radius: 0.0,
                color: [0.0, 0.0, 1.0, 1.0],
                tf: IDENTITY,
            },
            DrawOp::PopClip,
        ],
    };
    let pixmap = render_raster::raster::rasterize(&frame, 20, 20, &mut empty_media()).unwrap();
    // 交集 6..12 内是红
    assert_eq!(pixel(&pixmap, 8, 8), [255, 0, 0, 255]);
    // 只在外层裁剪里、不在内层裁剪里 ⇒ 红没画上，蓝画上了
    assert_eq!(pixel(&pixmap, 2, 2), [0, 0, 255, 255]);
    // 外层裁剪之外（y >= 12）：蓝也没画上
    assert_eq!(pixel(&pixmap, 2, 16), [255, 255, 255, 255]);
}

#[test]
fn clip_path_transform_is_applied() {
    let frame = FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![square_path(0.0, 0.0, 8.0)],
        ops: vec![
            clear_white(),
            DrawOp::ClipPath {
                path: 0,
                tf: [1.0, 0.0, 0.0, 1.0, 10.0, 10.0],
            },
            fill_all([1.0, 0.0, 0.0, 1.0]),
            DrawOp::PopClip,
        ],
    };
    let pixmap = render_raster::raster::rasterize(&frame, 20, 20, &mut empty_media()).unwrap();
    assert_eq!(pixel(&pixmap, 2, 2), [255, 255, 255, 255]);
    assert_eq!(pixel(&pixmap, 13, 13), [255, 0, 0, 255]);
}

#[test]
fn clip_stack_must_be_balanced_and_may_not_cross_a_layer_boundary() {
    let square = || square_path(0.0, 0.0, 8.0);

    let orphan_pop = FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![],
        ops: vec![DrawOp::PopClip],
    };
    assert!(
        render_raster::raster::rasterize(&orphan_pop, 4, 4, &mut empty_media())
            .unwrap_err()
            .to_string()
            .contains("PopClip 无匹配")
    );

    let unbalanced = FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![square()],
        ops: vec![DrawOp::ClipPath {
            path: 0,
            tf: IDENTITY,
        }],
    };
    assert!(
        render_raster::raster::rasterize(&unbalanced, 4, 4, &mut empty_media())
            .unwrap_err()
            .to_string()
            .contains("裁剪栈非空")
    );

    // 层外压入、层内弹出
    let pop_inside_layer = FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![square()],
        ops: vec![
            DrawOp::ClipPath {
                path: 0,
                tf: IDENTITY,
            },
            DrawOp::PushLayer {
                opacity: 1.0,
                blend: BlendMode::Normal,
            },
            DrawOp::PopClip,
            DrawOp::PopLayer,
        ],
    };
    assert!(
        render_raster::raster::rasterize(&pop_inside_layer, 4, 4, &mut empty_media())
            .unwrap_err()
            .to_string()
            .contains("跨越")
    );

    // 层内压入、层外弹出
    let pop_outside_layer = FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![square()],
        ops: vec![
            DrawOp::PushLayer {
                opacity: 1.0,
                blend: BlendMode::Normal,
            },
            DrawOp::ClipPath {
                path: 0,
                tf: IDENTITY,
            },
            DrawOp::PopLayer,
            DrawOp::PopClip,
        ],
    };
    assert!(
        render_raster::raster::rasterize(&pop_outside_layer, 4, 4, &mut empty_media())
            .unwrap_err()
            .to_string()
            .contains("不得跨越层边界")
    );
}

/// `PushLayer{blend}` 的参考语义：`multiply` 下白底上盖 50% 灰应当变暗，
/// 而 `normal` 只是 alpha 合成。
#[test]
fn pop_layer_applies_the_declared_blend_mode() {
    let render = |blend| {
        let frame = FrameOps {
            static_prefix: None,
            strings: vec![],
            bitmaps: Vec::new(),
            paints: Vec::new(),
            paths: vec![],
            ops: vec![
                DrawOp::FillRect {
                    x: 0.0,
                    y: 0.0,
                    w: 4.0,
                    h: 4.0,
                    radius: 0.0,
                    color: [0.5, 0.5, 1.0, 1.0],
                    tf: IDENTITY,
                },
                DrawOp::PushLayer {
                    opacity: 1.0,
                    blend,
                },
                DrawOp::FillRect {
                    x: 0.0,
                    y: 0.0,
                    w: 4.0,
                    h: 4.0,
                    radius: 0.0,
                    color: [1.0, 1.0, 0.5, 1.0],
                    tf: IDENTITY,
                },
                DrawOp::PopLayer,
            ],
        };
        pixel(
            &render_raster::raster::rasterize(&frame, 4, 4, &mut empty_media()).unwrap(),
            1,
            1,
        )
    };
    let normal = render(BlendMode::Normal);
    let multiply = render(BlendMode::Multiply);
    // normal：上层不透明 ⇒ 直接是上层颜色
    assert_eq!(&normal[..3], &[255, 255, 128]);
    // multiply：逐通道相乘 ⇒ 一定更暗，且红/绿通道来自底层
    assert!(
        multiply[0] < normal[0] && multiply[1] < normal[1],
        "{multiply:?}"
    );
    assert_eq!(multiply[3], 255);
}

// ── v4：渐变 paint、even-odd 填充与轨道遮罩（ADR-M11）──────────────

fn ring_path(cx: f32, cy: f32, outer: f32, inner: f32) -> PathData {
    // 两个同心方框，同一绕向：nonzero 填满，even-odd 挖空中心。
    let mut segs = square_path(cx - outer, cy - outer, outer * 2.0).0;
    segs.extend(square_path(cx - inner, cy - inner, inner * 2.0).0);
    PathData(segs)
}

#[test]
fn a_linear_gradient_paint_sweeps_between_its_stops() {
    let frame = FrameOps {
        static_prefix: None,
        paths: vec![square_path(0.0, 0.0, 16.0)],
        strings: vec![],
        bitmaps: Vec::new(),
        paints: vec![PaintData::Linear {
            p0: [0.0, 0.0],
            p1: [16.0, 0.0],
            stops: vec![
                GradientStop {
                    offset: 0.0,
                    color: [1.0, 0.0, 0.0, 1.0],
                },
                GradientStop {
                    offset: 1.0,
                    color: [0.0, 0.0, 1.0, 1.0],
                },
            ],
        }],
        ops: vec![DrawOp::FillPathPaint {
            path: 0,
            paint: 0,
            even_odd: false,
            tf: IDENTITY,
        }],
    };
    let pm = render_raster::raster::rasterize(&frame, 16, 16, &mut empty_media()).unwrap();
    let left = pixel(&pm, 1, 8);
    let right = pixel(&pm, 14, 8);
    assert!(left[0] > 200 && left[2] < 60, "左端应当偏红：{left:?}");
    assert!(right[2] > 200 && right[0] < 60, "右端应当偏蓝：{right:?}");
}

#[test]
fn even_odd_hollows_out_what_nonzero_fills_in() {
    let make = |even_odd| FrameOps {
        static_prefix: None,
        paths: vec![ring_path(8.0, 8.0, 7.0, 3.0)],
        strings: vec![],
        bitmaps: Vec::new(),
        paints: vec![PaintData::Solid([1.0, 1.0, 1.0, 1.0])],
        ops: vec![DrawOp::FillPathPaint {
            path: 0,
            paint: 0,
            even_odd,
            tf: IDENTITY,
        }],
    };
    let nonzero =
        render_raster::raster::rasterize(&make(false), 16, 16, &mut empty_media()).unwrap();
    let evenodd =
        render_raster::raster::rasterize(&make(true), 16, 16, &mut empty_media()).unwrap();
    assert_eq!(pixel(&nonzero, 8, 8)[3], 255, "nonzero 中心应当被填满");
    assert_eq!(pixel(&evenodd, 8, 8)[3], 0, "even-odd 中心应当被挖空");
    // 环带部分两种规则一致
    assert_eq!(pixel(&nonzero, 8, 2)[3], pixel(&evenodd, 8, 2)[3]);
}

#[test]
fn an_alpha_matte_cuts_the_layer_below_it() {
    let frame = FrameOps {
        static_prefix: None,
        paths: vec![square_path(0.0, 0.0, 16.0), square_path(0.0, 0.0, 8.0)],
        strings: vec![],
        bitmaps: Vec::new(),
        paints: vec![PaintData::Solid([1.0, 1.0, 1.0, 1.0])],
        ops: vec![
            DrawOp::PushLayer {
                opacity: 1.0,
                blend: BlendMode::Normal,
            },
            // 内容：整幅白
            DrawOp::FillPathPaint {
                path: 0,
                paint: 0,
                even_odd: false,
                tf: IDENTITY,
            },
            // 遮罩源：左上 8×8
            DrawOp::PushMatte,
            DrawOp::FillPathPaint {
                path: 1,
                paint: 0,
                even_odd: false,
                tf: IDENTITY,
            },
            DrawOp::PopMatte { mode: 0 },
            DrawOp::PopLayer,
        ],
    };
    let pm = render_raster::raster::rasterize(&frame, 16, 16, &mut empty_media()).unwrap();
    assert_eq!(pixel(&pm, 2, 2)[3], 255, "遮罩内保留");
    assert_eq!(pixel(&pm, 13, 13)[3], 0, "遮罩外抹掉");
}

#[test]
fn an_inverted_alpha_matte_keeps_exactly_the_complement() {
    let make = |mode| FrameOps {
        static_prefix: None,
        paths: vec![square_path(0.0, 0.0, 16.0), square_path(0.0, 0.0, 8.0)],
        strings: vec![],
        bitmaps: Vec::new(),
        paints: vec![PaintData::Solid([1.0, 1.0, 1.0, 1.0])],
        ops: vec![
            DrawOp::PushLayer {
                opacity: 1.0,
                blend: BlendMode::Normal,
            },
            DrawOp::FillPathPaint {
                path: 0,
                paint: 0,
                even_odd: false,
                tf: IDENTITY,
            },
            DrawOp::PushMatte,
            DrawOp::FillPathPaint {
                path: 1,
                paint: 0,
                even_odd: false,
                tf: IDENTITY,
            },
            DrawOp::PopMatte { mode },
            DrawOp::PopLayer,
        ],
    };
    let pm = render_raster::raster::rasterize(&make(1), 16, 16, &mut empty_media()).unwrap();
    assert_eq!(pixel(&pm, 2, 2)[3], 0);
    assert_eq!(pixel(&pm, 13, 13)[3], 255);
}

#[test]
fn matte_primitives_refuse_unbalanced_streams() {
    let base = |ops| FrameOps {
        static_prefix: None,
        paths: vec![square_path(0.0, 0.0, 4.0)],
        strings: vec![],
        bitmaps: Vec::new(),
        paints: vec![PaintData::Solid([1.0, 1.0, 1.0, 1.0])],
        ops,
    };
    // PushMatte 必须在某个层里
    let orphan = base(vec![DrawOp::PushMatte, DrawOp::PopMatte { mode: 0 }]);
    assert!(
        render_raster::raster::rasterize(&orphan, 8, 8, &mut empty_media())
            .unwrap_err()
            .to_string()
            .contains("PushMatte")
    );
    // 层里开了遮罩不 PopMatte 就 PopLayer
    let leaked = base(vec![
        DrawOp::PushLayer {
            opacity: 1.0,
            blend: BlendMode::Normal,
        },
        DrawOp::PushMatte,
        DrawOp::PopLayer,
    ]);
    assert!(
        render_raster::raster::rasterize(&leaked, 8, 8, &mut empty_media())
            .unwrap_err()
            .to_string()
            .contains("PopMatte")
    );
}

#[test]
fn a_stroke_paint_honours_cap_and_join() {
    let make = |cap| FrameOps {
        static_prefix: None,
        paths: vec![PathData(vec![
            PathSeg {
                verb: 0,
                pts: [4.0, 8.0, 0.0, 0.0, 0.0, 0.0],
            },
            PathSeg {
                verb: 1,
                pts: [12.0, 8.0, 0.0, 0.0, 0.0, 0.0],
            },
        ])],
        strings: vec![],
        bitmaps: Vec::new(),
        paints: vec![PaintData::Solid([1.0, 1.0, 1.0, 1.0])],
        ops: vec![DrawOp::StrokePathPaint {
            path: 0,
            paint: 0,
            width: 4.0,
            cap,
            join: 1,
            miter: 4.0,
            tf: IDENTITY,
        }],
    };
    let butt = render_raster::raster::rasterize(&make(0), 16, 16, &mut empty_media()).unwrap();
    let square = render_raster::raster::rasterize(&make(2), 16, 16, &mut empty_media()).unwrap();
    // 端点外一像素：butt 是空的，square 把线帽延出去
    assert_eq!(pixel(&butt, 13, 8)[3], 0);
    assert_eq!(pixel(&square, 13, 8)[3], 255);
}

/// `DrawBitmap`（v5，彩色字形）：像素原样（预乘）贴到 `tf` 指定的位置，
/// 不吃任何文字颜色；`opacity` 整张乘上去；裁剪与其它原语一样生效。
#[test]
fn draw_bitmap_places_premultiplied_pixels_with_opacity_and_clip() {
    // 2×2：左上不透明红、右上半透明绿（预乘 128）、下排不透明蓝。
    let rgba: Vec<u8> = [
        [255, 0, 0, 255],
        [0, 128, 0, 128],
        [0, 0, 255, 255],
        [0, 0, 255, 255],
    ]
    .concat();
    let checker = BitmapData {
        width: 2,
        height: 2,
        rgba: rgba.into(),
    };
    let solid = BitmapData {
        width: 2,
        height: 2,
        rgba: [[200, 40, 0, 255]; 4].concat().into(),
    };
    let frame = FrameOps {
        paths: vec![square_path(0.0, 0.0, 14.0)],
        bitmaps: vec![checker, solid],
        ops: vec![
            // 整数平移、单位缩放：逐像素原样。
            DrawOp::DrawBitmap {
                bitmap: 0,
                opacity: 1.0,
                tf: [1.0, 0.0, 0.0, 1.0, 3.0, 4.0],
            },
            // 半透明整张。
            DrawOp::DrawBitmap {
                bitmap: 1,
                opacity: 0.5,
                tf: [1.0, 0.0, 0.0, 1.0, 0.0, 12.0],
            },
            // 2× 放大，右半边被裁掉（裁剪框是 [0,14)²）。
            DrawOp::ClipPath {
                path: 0,
                tf: IDENTITY,
            },
            DrawOp::DrawBitmap {
                bitmap: 1,
                opacity: 1.0,
                tf: [4.0, 0.0, 0.0, 4.0, 10.0, 0.0],
            },
            DrawOp::PopClip,
        ],
        ..FrameOps::default()
    };
    let pm = render_raster::raster::rasterize(&frame, 20, 16, &mut empty_media()).unwrap();
    assert_eq!(pixel(&pm, 3, 4), [255, 0, 0, 255]);
    assert_eq!(pixel(&pm, 4, 4), [0, 128, 0, 128]);
    assert_eq!(pixel(&pm, 3, 5), [0, 0, 255, 255]);
    assert_eq!(pixel(&pm, 2, 4), [0, 0, 0, 0], "位图之外不画");
    let half = pixel(&pm, 0, 12);
    assert!((126..=129).contains(&half[3]), "opacity 0.5：{half:?}");
    assert!(
        (99..=101).contains(&half[0]),
        "预乘红按 opacity 减半：{half:?}"
    );
    assert_eq!(pixel(&pm, 12, 2), [200, 40, 0, 255], "缩放后的内部像素");
    assert_eq!(pixel(&pm, 15, 2), [0, 0, 0, 0], "裁剪框外不画");
}

#[test]
fn draw_bitmap_refuses_unknown_or_malformed_bitmaps() {
    let unknown = FrameOps {
        ops: vec![DrawOp::DrawBitmap {
            bitmap: 3,
            opacity: 1.0,
            tf: IDENTITY,
        }],
        ..FrameOps::default()
    };
    let error = render_raster::raster::rasterize(&unknown, 4, 4, &mut empty_media())
        .unwrap_err()
        .to_string();
    assert!(error.contains("未知 bitmap"), "实际 {error}");

    let short = FrameOps {
        bitmaps: vec![BitmapData {
            width: 2,
            height: 2,
            rgba: vec![0; 12].into(),
        }],
        ops: vec![DrawOp::DrawBitmap {
            bitmap: 0,
            opacity: 1.0,
            tf: IDENTITY,
        }],
        ..FrameOps::default()
    };
    let error = render_raster::raster::rasterize(&short, 4, 4, &mut empty_media())
        .unwrap_err()
        .to_string();
    assert!(error.contains("尺寸与字节不符"), "实际 {error}");
}

/// `static_prefix` 是光栅缓存提示：同一个键第二次出现时直接拷贝缓存的前缀画面，
/// 前缀里的指令不再执行。用「同键不同内容」的两帧把命中暴露出来（录制器保证
/// 同键同内容，这里故意违反它只为观察缓存），并确认前缀之后的指令照常执行、
/// 不设提示的帧不受影响。键取一个本文件独有的值，别的测试不会挤掉它。
#[test]
fn static_prefix_is_rasterized_once_per_key_and_size() {
    use render_raster::drawop::StaticPrefix;
    const KEY: u64 = 0x5a7e_bac0_0000_0001;
    let frame = |bg: [f32; 4], hint: bool| FrameOps {
        paths: vec![square_path(1.0, 1.0, 2.0)],
        ops: vec![
            DrawOp::Clear { color: bg },
            DrawOp::FillPath {
                path: 0,
                color: [0.0, 1.0, 0.0, 1.0],
                tf: IDENTITY,
            },
        ],
        static_prefix: hint.then_some(StaticPrefix { key: KEY, ops: 1 }),
        ..FrameOps::default()
    };
    let red = [1.0, 0.0, 0.0, 1.0];
    let blue = [0.0, 0.0, 1.0, 1.0];
    let draw = |frame: &FrameOps, size: u32| {
        render_raster::raster::rasterize(frame, size, size, &mut empty_media()).unwrap()
    };

    let first = draw(&frame(red, true), 6);
    assert_eq!(
        first.data(),
        draw(&frame(red, false), 6).data(),
        "未命中=从头重放"
    );
    let hit = draw(&frame(blue, true), 6);
    assert_eq!(pixel(&hit, 0, 0), [255, 0, 0, 255], "同键命中：前缀取缓存");
    assert_eq!(pixel(&hit, 2, 2), [0, 255, 0, 255], "前缀之后照常画");
    assert_eq!(hit.data(), first.data());
    // 尺寸是键的一部分；不设提示的帧不查缓存。
    assert_eq!(pixel(&draw(&frame(blue, true), 7), 0, 0), [0, 0, 255, 255]);
    assert_eq!(pixel(&draw(&frame(blue, false), 6), 0, 0), [0, 0, 255, 255]);
    // 越界的提示被忽略（不 panic、不缓存）。
    let mut bogus = frame(blue, false);
    bogus.static_prefix = Some(StaticPrefix {
        key: KEY + 1,
        ops: 9,
    });
    assert_eq!(pixel(&draw(&bogus, 6), 0, 0), [0, 0, 255, 255]);
}
