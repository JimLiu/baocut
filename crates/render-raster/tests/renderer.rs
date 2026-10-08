//! `media` 门内：本文件用 `LoadedAssets` / `MediaStore` / `FrameRenderer`
//! （BCF 文档渲染链路与 host 字节层），`wasm-safe` 构建里不存在（设计 §9.1）。
#![cfg(feature = "media")]

use render_raster::drawop::{self, DrawOp};
use render_raster::{FrameRenderer, LoadedAssets, MediaStore, TextEngine};
use serde_json::Value;
use std::sync::Arc;

/// 读取 golden IR。JSON 是跟踪进版本库的 fixture，任何 checkout 上都存在，
/// 因此读取失败一律 panic。
fn golden_ir() -> scene_primitives::Ir {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/launch-golden/launch.bcut.json"
    );
    let text = std::fs::read_to_string(path).expect("读取 golden JSON");
    let doc: Value = serde_json::from_str(&text).unwrap();
    scene_primitives::Resolver::new(doc, None)
        .unwrap()
        .resolve()
        .unwrap()
}

#[test]
fn golden_timeline_records_shapes_text_transitions_and_captions() {
    let mut ir = golden_ir();
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let mut saw_fill_rect = false;
    let mut saw_fill_path = false;
    let mut saw_stroke_path = false;
    let mut saw_layer = false;
    let mut fingerprints = Vec::new();

    for t in [0.7, 2.9, 3.0, 4.0, 7.8, 8.0, 9.5, 10.5, 13.6, 16.1, 19.8] {
        let frame = renderer.record(&ir, &mut engine, t);
        assert!(matches!(frame.ops.first(), Some(DrawOp::Clear { .. })));
        saw_fill_rect |= frame
            .ops
            .iter()
            .any(|op| matches!(op, DrawOp::FillRect { .. }));
        saw_fill_path |= frame
            .ops
            .iter()
            .any(|op| matches!(op, DrawOp::FillPath { .. }));
        saw_stroke_path |= frame
            .ops
            .iter()
            .any(|op| matches!(op, DrawOp::StrokePath { .. }));
        saw_layer |= frame
            .ops
            .iter()
            .any(|op| matches!(op, DrawOp::PushLayer { .. }));
        assert!(
            !frame
                .ops
                .iter()
                .any(|op| matches!(op, DrawOp::DrawMedia { .. }))
        );
        fingerprints.push(drawop::fingerprint(&frame));
    }

    assert!(
        saw_fill_rect,
        "box/caption backgrounds should record FillRect"
    );
    assert!(saw_fill_path, "text glyphs should record FillPath");
    assert!(saw_stroke_path, "animated SVGs should record StrokePath");
    assert!(saw_layer, "transitions and opacity should record layers");
    fingerprints.sort_unstable();
    fingerprints.dedup();
    assert!(
        fingerprints.len() > 5,
        "timeline should produce distinct frames"
    );
}

/// region 字幕（§3.6）：core 排定的行盒必须把字形绘制约束在矩形内，且向上增长。
#[test]
fn region_captions_draw_inside_the_rect_growing_up() {
    let doc: Value = serde_json::from_str(
        r#"{
      "meta": { "id": "r", "width": 1920, "height": 1080, "fps": 30 },
      "scenes": [ { "id": "s", "dur": 6, "desc": "x" } ],
      "tracks": [ { "id": "cap", "kind": "captions", "clips": [ {
        "id": "caps", "start": 0, "end": 6,
        "layout": { "region": { "x": 200, "y": 300, "width": 400, "height": 300 },
                    "grow": "up", "gap": 8 },
        "lanes": [ { "id": "zh", "style": { "fontSize": 30 } } ],
        "captions": [ { "at": 0, "until": 5, "lines": { "zh": {
          "text": "region wrapping keeps every glyph inside the declared rectangle"
        } } } ]
      } ] } ]
    }"#,
    )
    .unwrap();
    let mut ir = scene_primitives::Resolver::new(doc, None)
        .unwrap()
        .resolve()
        .unwrap();
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();

    let boxes = ir.caption_clips[0].items[0].lines["zh"]
        .boxes
        .as_ref()
        .expect("core 已排定行盒");
    assert!(boxes.len() > 1, "长行应在 400px 宽的 region 内换行");
    for b in boxes {
        assert!(b.w <= 400.0 + 1e-6, "行宽 {} 超出 region", b.w);
        assert!(b.x >= 200.0 - 1e-6 && b.x + b.w <= 600.0 + 1e-6);
        assert!(b.y >= 300.0 - 1e-6 && b.y + b.h <= 600.0 + 1e-6);
    }
    // grow up：末行底边贴住 region 底边（行盒在行高内垂直居中，故留半个行距）
    let last = boxes.last().unwrap();
    assert!(600.0 - (last.y + last.h) < 30.0 * 1.3);

    let frame = renderer.record(&ir, &mut engine, 1.0);
    let mut glyph_xs = Vec::new();
    for op in &frame.ops {
        if let DrawOp::FillPath { tf, .. } = op {
            glyph_xs.push((tf[4], tf[5]));
        }
    }
    assert!(!glyph_xs.is_empty(), "字幕应记录字形");
    for (x, y) in glyph_xs {
        assert!((199.0..=601.0).contains(&x), "字形 x={x} 越出 region");
        assert!((299.0..=601.0).contains(&y), "字形基线 y={y} 越出 region");
    }
}

/// lane 的 `animate.exit`（§8.4）锚定本条 `until`：声明了就按它的时长退场，
/// 不再被 clip 的整块 `fade`（缺省 0.18 秒）提前压暗；没声明的 lane 照旧按 `fade` 淡出。
#[test]
fn caption_lane_exit_overrides_block_fade() {
    let doc = |exit: Value| -> Value {
        serde_json::json!({
          "meta": { "id": "x", "width": 800, "height": 400, "fps": 24 },
          "scenes": [ { "id": "s", "dur": 4, "desc": "x" } ],
          "tracks": [ { "id": "cap", "kind": "captions", "clips": [ {
            "id": "caps", "start": 0, "end": 4,
            "lanes": [ { "id": "en", "style": { "fontSize": 30 },
                         "animate": { "enter": { "preset": "fadeIn", "dur": 0.04 }, "exit": exit } } ],
            "captions": [ { "at": 0, "until": 2, "lines": { "en": { "text": "exit test" } } } ]
          } ] } ]
        })
    };
    // 首个 PushLayer 的不透明度；没有图层 = 全不透明
    let alpha_at = |doc: Value, t: f64| -> f32 {
        let mut ir = resolve_doc(doc);
        let mut engine = TextEngine::new();
        let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
        let frame = renderer.record(&ir, &mut engine, t);
        assert!(
            frame
                .ops
                .iter()
                .any(|op| matches!(op, DrawOp::FillPath { .. })),
            "t={t} 应画出字幕"
        );
        frame
            .ops
            .iter()
            .find_map(|op| match op {
                DrawOp::PushLayer { opacity, .. } => Some(*opacity),
                _ => None,
            })
            .unwrap_or(1.0)
    };
    let short = serde_json::json!({ "preset": "fadeOut", "dur": 0.04 });
    // until 前 0.1 秒：短退场还没开始
    assert!(alpha_at(doc(short.clone()), 1.9) > 0.999);
    // until 前 0.02 秒：短退场走了一半
    let mid = alpha_at(doc(short), 1.98);
    assert!(mid > 0.05 && mid < 0.95, "fadeOut 0.04 中点不透明度 {mid}");
    // 没声明 exit：按 clip 的 fade（0.18 秒）整块淡出，until 前 0.1 秒已经变暗
    let dim = alpha_at(doc(Value::Null), 1.9);
    assert!(
        dim < 0.9,
        "缺省 fade 下 until 前 0.1 秒应已变暗，得到 {dim}"
    );
}

fn resolve_doc(doc: Value) -> scene_primitives::Ir {
    scene_primitives::Resolver::new(doc, None)
        .unwrap()
        .resolve()
        .unwrap()
}

fn small_doc(children: Value) -> Value {
    serde_json::json!({
        "bcut": "0.2",
        "meta": {"id": "t", "width": 400, "height": 200, "fps": 30, "background": "#ffffff"},
        "scenes": [{"id": "s", "dur": 2}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end",
             "element": {"type": "box", "id": "stage",
                         "style": {"width": 400, "height": 200},
                         "children": children}}
        ]}]
    })
}

fn pixel(pixmap: &tiny_skia::Pixmap, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * pixmap.width() + x) * 4) as usize;
    let d = pixmap.data();
    [d[i], d[i + 1], d[i + 2], d[i + 3]]
}

/// `style.mask`（规范 §6.3）：被遮罩元素只在遮罩源的 alpha 里出画，遮罩源自己
/// 不进正常流；指令流里是 `PushLayer → … → PushMatte → 源 → PopMatte → PopLayer`。
#[test]
fn element_mask_records_a_matte_and_hides_its_source() {
    let mut ir = resolve_doc(small_doc(serde_json::json!([
        {"type": "box", "id": "red",
         "style": {"x": 0, "y": 0, "width": 400, "height": 200, "background": "#ff0000",
                   "mask": {"source": "#hole"}}},
        {"type": "box", "id": "hole",
         "style": {"x": 150, "y": 50, "width": 100, "height": 100, "background": "#0000ff"}}
    ])));
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let frame = renderer.record(&ir, &mut engine, 1.0);
    let matte_at = frame
        .ops
        .iter()
        .position(|op| matches!(op, DrawOp::PushMatte))
        .expect("PushMatte");
    let pop_at = frame
        .ops
        .iter()
        .position(|op| matches!(op, DrawOp::PopMatte { mode: 0 }))
        .expect("PopMatte alpha");
    assert!(matte_at < pop_at);
    let fills = frame
        .ops
        .iter()
        .filter(|op| matches!(op, DrawOp::FillRect { .. }))
        .count();
    assert_eq!(fills, 2, "红盒一次、遮罩源一次；源不再在正常流里画第二遍");

    let assets = Arc::new(LoadedAssets::default());
    let mut media = MediaStore::new(assets, ir.fps);
    let pixmap = renderer.draw(&ir, &mut engine, &mut media, 1.0).unwrap();
    assert_eq!(pixel(&pixmap, 50, 50), [255, 255, 255, 255], "遮罩外是背景");
    assert_eq!(
        pixel(&pixmap, 200, 100),
        [255, 0, 0, 255],
        "遮罩内是红盒而不是蓝色源"
    );
    assert_eq!(pixel(&pixmap, 149, 100), [255, 255, 255, 255]);
}

/// `style.background` 渐变对象（§6.3）→ `FillPathPaint`，两端颜色落在各自的端点。
#[test]
fn gradient_background_fills_with_a_paint_side_table() {
    let mut ir = resolve_doc(small_doc(serde_json::json!([
        {"type": "box", "id": "g",
         "style": {"x": 0, "y": 0, "width": 400, "height": 200,
                   "background": {"kind": "linear", "angle": 90,
                                  "stops": [{"at": 0, "color": "#000000"}, {"at": 1, "color": "#ffffff"}]}}}
    ])));
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let frame = renderer.record(&ir, &mut engine, 1.0);
    assert!(
        frame
            .ops
            .iter()
            .any(|op| matches!(op, DrawOp::FillPathPaint { .. }))
    );
    assert!(matches!(
        frame.paints.first(),
        Some(drawop::PaintData::Linear { .. })
    ));
    let assets = Arc::new(LoadedAssets::default());
    let mut media = MediaStore::new(assets, ir.fps);
    let pixmap = renderer.draw(&ir, &mut engine, &mut media, 1.0).unwrap();
    let left = pixel(&pixmap, 2, 100);
    let right = pixel(&pixmap, 397, 100);
    assert!(left[0] < 20, "左端接近黑 {left:?}");
    assert!(right[0] > 235, "右端接近白 {right:?}");
    let mid = pixel(&pixmap, 200, 100);
    assert!((100..=160).contains(&mid[0]), "中点在中灰 {mid:?}");
}

/// `style.border`（§6.3）：盒内侧一圈 even-odd 填充，跟着圆角；没有背景时中间透出底下的画面。
#[test]
fn border_paints_an_inner_ring_that_follows_the_radius() {
    let mut ir = resolve_doc(small_doc(serde_json::json!([
        {"type": "box", "id": "ring",
         "style": {"x": 100, "y": 50, "width": 200, "height": 100, "borderRadius": 20,
                   "border": {"width": 10, "color": "#ff0000"}}},
        {"type": "box", "id": "square",
         "style": {"x": 320, "y": 50, "width": 60, "height": 60, "background": "#0000ff",
                   "border": {"width": 6, "color": "#000000"}}}
    ])));
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let frame = renderer.record(&ir, &mut engine, 1.0);
    let rings = frame
        .ops
        .iter()
        .filter(|op| matches!(op, DrawOp::FillPathPaint { even_odd: true, .. }))
        .count();
    assert_eq!(rings, 2, "两个盒子各一圈");
    assert!(
        frame
            .paints
            .iter()
            .all(|p| matches!(p, drawop::PaintData::Solid(_)))
    );
    let assets = Arc::new(LoadedAssets::default());
    let mut media = MediaStore::new(assets, ir.fps);
    let pixmap = renderer.draw(&ir, &mut engine, &mut media, 1.0).unwrap();
    assert_eq!(pixel(&pixmap, 104, 100), [255, 0, 0, 255], "左边的圈");
    assert_eq!(pixel(&pixmap, 200, 145), [255, 0, 0, 255], "下边的圈");
    assert_eq!(
        pixel(&pixmap, 115, 100),
        [255, 255, 255, 255],
        "圈内侧透出底色"
    );
    assert_eq!(
        pixel(&pixmap, 200, 100),
        [255, 255, 255, 255],
        "没有背景：中间是空的"
    );
    assert_eq!(
        pixel(&pixmap, 101, 51),
        [255, 255, 255, 255],
        "圆角把盒角切掉"
    );
    assert_eq!(
        pixel(&pixmap, 321, 51),
        [0, 0, 0, 255],
        "没有圆角：盒角是尖的"
    );
    assert_eq!(
        pixel(&pixmap, 350, 80),
        [0, 0, 255, 255],
        "描边画在背景之上、只占内侧一圈"
    );
    assert_eq!(pixel(&pixmap, 316, 80), [255, 255, 255, 255], "不向外扩");
}

/// `skewX`（§6.4）是仿射变换：正角度把盒子下边往右推，上边往左推（CSS 口径）。
#[test]
fn skew_x_channel_shears_the_box() {
    let mut ir = resolve_doc(small_doc(serde_json::json!([
        {"type": "box", "id": "b",
         "style": {"x": 150, "y": 50, "width": 100, "height": 100, "background": "#000000"},
         "animate": {"keyframes": [{"prop": "skewX",
             "frames": [{"t": 0, "v": 30}, {"t": 2, "v": 30}]}]}}
    ])));
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let assets = Arc::new(LoadedAssets::default());
    let mut media = MediaStore::new(assets, ir.fps);
    let pixmap = renderer.draw(&ir, &mut engine, &mut media, 1.0).unwrap();
    // 锚点在盒中心：底边右移 tan(30°)·50 ≈ 29px，顶边左移同样距离。
    assert_eq!(
        pixel(&pixmap, 260, 140),
        [0, 0, 0, 255],
        "底部右侧被推进盒内"
    );
    assert_eq!(
        pixel(&pixmap, 260, 60),
        [255, 255, 255, 255],
        "顶部右侧空出"
    );
    assert_eq!(
        pixel(&pixmap, 140, 60),
        [0, 0, 0, 255],
        "顶部左侧被推进盒内"
    );
}

#[test]
fn golden_frame_rasterizes_without_media_assets() {
    let mut ir = golden_ir();
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let assets = Arc::new(LoadedAssets::default());
    let mut media = MediaStore::new(assets, ir.fps);

    let pixmap = renderer.draw(&ir, &mut engine, &mut media, 10.5).unwrap();

    assert_eq!((pixmap.width(), pixmap.height()), (1920, 1080));
    let first = &pixmap.data()[..4];
    assert!(
        pixmap.data().chunks_exact(4).any(|pixel| pixel != first),
        "rendered frame should contain foreground pixels"
    );
}
