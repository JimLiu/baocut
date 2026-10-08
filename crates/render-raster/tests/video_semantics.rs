//! `media` 门内：本文件用 `LoadedAssets` / `MediaStore` / `FrameRenderer`
//! （BCF 文档渲染链路与 host 字节层），`wasm-safe` 构建里不存在（设计 §9.1）。
#![cfg(feature = "media")]

//! video 元素媒体语义（§6.5）的录制期验证：帧精确量化、越界冻结、
//! segment/loop 折叠、fit 三模式的变换与源裁剪。无媒体字节（只查 DrawOp）。

use render_raster::drawop::DrawOp;
use render_raster::{FrameRenderer, TextEngine};
use serde_json::json;

/// nat 40×20、时长 2s、源帧率 4fps 的视频，四个时段各验一个模式。
fn build() -> (scene_primitives::Ir, TextEngine, FrameRenderer) {
    let doc = json!({
        "meta": { "id": "vs", "width": 200, "height": 100, "fps": 10 },
        "scenes": [ { "id": "a", "dur": 10, "desc": "视频语义" } ],
        "assets": { "clip": { "type": "video", "src": "assets/clip.mp4" } },
        "tracks": [
            { "id": "main", "kind": "visual", "clips": [
                { "id": "cover-shot", "start": 0, "end": 3, "element": {
                    "type": "video", "id": "v1", "src": "$assets.clip",
                    "style": { "x": 0, "y": 0, "width": 20, "height": 20 } } },
                { "id": "contain-shot", "start": 3, "end": 6, "element": {
                    "type": "video", "id": "v2", "src": "$assets.clip", "fit": "contain",
                    "style": { "x": 0, "y": 0, "width": 20, "height": 20 } } },
                { "id": "fill-shot", "start": 6, "end": 9, "element": {
                    "type": "video", "id": "v3", "src": "$assets.clip", "fit": "fill",
                    "style": { "x": 0, "y": 0, "width": 20, "height": 20 } } },
                { "id": "rate-shot", "start": 9, "end": 10, "element": {
                    "type": "video", "id": "v4", "src": "$assets.clip",
                    "playbackRate": 2, "segment": [0.5, 1.5], "loop": true,
                    "style": { "x": 0, "y": 0, "width": 40, "height": 20 } } }
            ] }
        ]
    });
    let mut r = scene_primitives::Resolver::new(doc, None).unwrap();
    let mut inputs = scene_primitives::HostInputs::default();
    inputs.insert_video("clip", 40.0, 20.0, 2.0, 4.0);
    r.set_host_inputs(inputs);
    let mut ir = r.resolve().unwrap();
    let mut engine = TextEngine::with_document_fonts(&[]);
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    (ir, engine, renderer)
}

fn draw_media(
    renderer: &FrameRenderer,
    ir: &scene_primitives::Ir,
    engine: &mut TextEngine,
    t: f64,
) -> (i64, [f32; 4], [f32; 6]) {
    let frame = renderer.record(ir, engine, t);
    let media: Vec<_> = frame
        .ops
        .iter()
        .filter_map(|op| match op {
            DrawOp::DrawMedia {
                media_ms, src, tf, ..
            } => Some((*media_ms, *src, *tf)),
            _ => None,
        })
        .collect();
    assert_eq!(media.len(), 1, "t={t} 应恰有一个 DrawMedia");
    media[0]
}

#[test]
fn frame_exact_quantization_and_freeze() {
    let (ir, mut engine, renderer) = build();
    // t=0.9 → srcTime 0.9 → frameIndex floor(0.9×4)=3 → 帧起点 0.75s
    let (ms, _, _) = draw_media(&renderer, &ir, &mut engine, 0.9);
    assert_eq!(ms, 750);
    // t=1.0 → 恰在帧 4 边界 → 1.0s
    let (ms, _, _) = draw_media(&renderer, &ir, &mut engine, 1.0);
    assert_eq!(ms, 1000);
    // t=2.5 > 源时长 2s → clamp 到末帧 (N−1)/fps = 7/4 = 1.75s（冻结）
    let (ms, _, _) = draw_media(&renderer, &ir, &mut engine, 2.5);
    assert_eq!(ms, 1750);
}

#[test]
fn segment_loop_and_playback_rate() {
    let (ir, mut engine, renderer) = build();
    // t=9.5：srcTime = 0.5 + (9.5−9)×2 = 1.5 → loop 折叠回 0.5 → 500ms
    let (ms, _, _) = draw_media(&renderer, &ir, &mut engine, 9.5);
    assert_eq!(ms, 500);
    // t=9.2：srcTime = 0.5 + 0.2×2 = 0.9 → floor(3.6)=3 → 750ms
    let (ms, _, _) = draw_media(&renderer, &ir, &mut engine, 9.2);
    assert_eq!(ms, 750);
}

#[test]
fn fit_modes_transform_and_crop() {
    let (ir, mut engine, renderer) = build();
    // cover（缺省）：box 20×20，nat 40×20 → s = max(0.5, 1) = 1；
    // 源侧居中裁剪 [10, 0, 20, 20]
    let (_, src, tf) = draw_media(&renderer, &ir, &mut engine, 1.0);
    assert_eq!(src, [10.0, 0.0, 20.0, 20.0]);
    assert_eq!(tf, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);

    // contain：s = min(0.5, 1) = 0.5，垂直居中偏移 (20−20×0.5)/2 = 5，无裁剪
    let (_, src, tf) = draw_media(&renderer, &ir, &mut engine, 4.0);
    assert_eq!(src, [0.0; 4]);
    assert_eq!(tf, [0.5, 0.0, 0.0, 0.5, 0.0, 5.0]);

    // fill：非等比拉伸 sx=0.5, sy=1，无裁剪
    let (_, src, tf) = draw_media(&renderer, &ir, &mut engine, 7.0);
    assert_eq!(src, [0.0; 4]);
    assert_eq!(tf, [0.5, 0.0, 0.0, 1.0, 0.0, 0.0]);
}
