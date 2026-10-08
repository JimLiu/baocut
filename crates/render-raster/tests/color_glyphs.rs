//! `media` 门内：本文件用 `FrameRenderer` 与 `MediaStore`（BCF 文档渲染链路），
//! `wasm-safe` 构建里不存在（设计 §9.1）。
#![cfg(feature = "media")]

//! BCF `text` 的彩色字形（emoji）：录制期发 `DrawBitmap`（BCOP v5），光栅化
//! 画出位图本来的颜色——不吃文字颜色，也不退化成空白或单色剪影。
//!
//! 无条件的断言都落在 checked-in 的 COLR 探针字体上
//! （`core/fixtures/fonts/ColrProbe.ttf`：`A` 是一块红菱形 + 一块蓝三角，
//! 另带非空单色回退轮廓），任何机器上结果一致。系统 emoji 字体那条按本机
//! 有没有 Apple Color Emoji / Noto Color Emoji / Segoe UI Emoji 决定跑不跑。

use render_raster::drawop::{self, DrawOp, FrameOps};
use render_raster::{FrameRenderer, LoadedAssets, MediaStore, TextEngine};
use serde_json::{Value, json};
use std::sync::Arc;

const PROBE: &[u8] = include_bytes!("fixtures/fonts/ColrProbe.ttf");
const MONO: &[u8] = include_bytes!("../assets/fonts/VKSans-400.ttf");

fn doc(text: &str, style: Value) -> Value {
    json!({
        "meta": {"id": "t", "width": 320, "height": 200, "fps": 30},
        "scenes": [{"id": "s", "dur": 2}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end", "element": {
                "type": "text", "id": "el", "text": text, "style": style
            }}
        ]}]
    })
}

fn probe_style(extra: Value) -> Value {
    let mut style = json!({
        "x": 40, "y": 40, "fontSize": 64, "font": "ColrProbe", "color": "#ffffff"
    });
    style
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    style
}

fn probe_engine() -> TextEngine {
    TextEngine::with_document_fonts(&[PROBE.to_vec()])
}

fn record(doc: Value, engine: &mut TextEngine, t: f64) -> FrameOps {
    let mut ir = scene_primitives::Resolver::new(doc, None)
        .unwrap()
        .resolve()
        .unwrap();
    let renderer = FrameRenderer::new(&mut ir, engine).unwrap();
    renderer.record(&ir, engine, t)
}

fn rasterize(frame: &FrameOps) -> tiny_skia::Pixmap {
    let mut media = MediaStore::new(Arc::new(LoadedAssets::default()), 30.0);
    render_raster::raster::rasterize(frame, 320, 200, &mut media).unwrap()
}

fn draw_bitmaps(frame: &FrameOps) -> Vec<(u32, f32, [f32; 6])> {
    frame
        .ops
        .iter()
        .filter_map(|op| match op {
            DrawOp::DrawBitmap {
                bitmap,
                opacity,
                tf,
            } => Some((*bitmap, *opacity, *tf)),
            _ => None,
        })
        .collect()
}

fn fill_paths(frame: &FrameOps) -> usize {
    frame
        .ops
        .iter()
        .filter(|op| matches!(op, DrawOp::FillPath { .. }))
        .count()
}

/// 探针 `A` 的两块纯色：红菱形、蓝三角。白色像素 = 被文字颜色着色或画成了回退轮廓。
fn count_colours(pm: &tiny_skia::Pixmap) -> (usize, usize, usize) {
    let (mut red, mut blue, mut white) = (0, 0, 0);
    for px in pm.data().chunks_exact(4) {
        let [r, g, b, a] = [px[0], px[1], px[2], px[3]];
        if a < 200 {
            continue;
        }
        if r > 200 && g < 40 && b < 40 {
            red += 1;
        } else if b > 200 && r < 40 && g < 40 {
            blue += 1;
        } else if r > 200 && g > 200 && b > 200 {
            white += 1;
        }
    }
    (red, blue, white)
}

#[test]
fn a_colr_glyph_records_a_bitmap_and_rasterizes_in_colour() {
    let mut engine = probe_engine();
    let frame = record(doc("A", probe_style(json!({}))), &mut engine, 0.5);

    let bitmaps = draw_bitmaps(&frame);
    assert_eq!(bitmaps.len(), 1, "探针 A 是彩色字形：一条 DrawBitmap");
    assert_eq!(fill_paths(&frame), 0, "彩色字形不应再画它的单色回退轮廓");
    assert_eq!(frame.bitmaps.len(), 1);
    assert_eq!(drawop::required_version(&frame), 5);
    let (_, opacity, tf) = bitmaps[0];
    assert_eq!(opacity, 1.0);
    assert_eq!((tf[0], tf[3]), (1.0, 1.0), "未缩放的文字：位图 1:1 上屏");

    let (red, blue, white) = count_colours(&rasterize(&frame));
    assert!(
        red > 40 && blue > 40,
        "应画出红菱形与蓝三角：red={red} blue={blue}"
    );
    assert_eq!(white, 0, "位图不吃文字颜色（#ffffff）");
}

/// 文字颜色的 alpha 乘进位图的 opacity；颜色本身不参与。
#[test]
fn text_colour_alpha_becomes_bitmap_opacity() {
    let mut engine = probe_engine();
    let frame = record(
        doc(
            "A",
            probe_style(json!({"color": "rgba(255, 255, 255, 0.5)"})),
        ),
        &mut engine,
        0.5,
    );
    let bitmaps = draw_bitmaps(&frame);
    assert_eq!(bitmaps.len(), 1);
    assert!(
        (bitmaps[0].1 - 0.5).abs() < 1e-6,
        "opacity={}",
        bitmaps[0].1
    );
}

/// 放大时按 2 的幂档超采样：2× 的文字拿到约 2× 像素的位图，位图到画面仍约 1:1；
/// 缩小到 0.3× 时降到 ½ 档，不拿全尺寸位图去硬缩。
#[test]
fn scaled_text_rasterizes_the_glyph_at_a_matching_size() {
    let mut engine = probe_engine();
    let width_at = |engine: &mut TextEngine, scale: f64| {
        let frame = record(doc("A", probe_style(json!({"scale": scale}))), engine, 0.5);
        let bitmaps = draw_bitmaps(&frame);
        assert_eq!(bitmaps.len(), 1, "scale={scale}");
        let (id, _, tf) = bitmaps[0];
        (frame.bitmaps[id as usize].width, tf[0])
    };
    let (w1, s1) = width_at(&mut engine, 1.0);
    let (w2, s2) = width_at(&mut engine, 2.0);
    let (w_small, s_small) = width_at(&mut engine, 0.3);
    assert_eq!(s1, 1.0);
    assert!(
        (s2 - 1.0).abs() < 1e-5,
        "2× 文字的位图应 1:1 上屏，实际 {s2}"
    );
    assert!(
        w2 >= w1 * 2 - 2 && w2 <= w1 * 2 + 2,
        "2× 文字的位图应约为 2× 宽：w1={w1} w2={w2}"
    );
    assert!(
        (s_small - 0.6).abs() < 1e-5,
        "0.3× 落在 ½ 档：0.3 / 0.5 = 0.6，实际 {s_small}"
    );
    assert!(
        w_small < w1,
        "缩小的文字不应拿全尺寸位图：{w_small} vs {w1}"
    );
}

/// 录制是 `(ir, t)` 的纯函数：换一个全新的字体引擎（字形缓存全空）重录，
/// 指纹逐位相同——位图侧表按内容去重，不依赖缓存状态。
#[test]
fn colour_glyph_recording_is_independent_of_cache_state() {
    let doc = doc("AA A", probe_style(json!({"scale": 1.5})));
    let mut warm = probe_engine();
    let first = record(doc.clone(), &mut warm, 0.5);
    let again = record(doc.clone(), &mut warm, 0.5);
    let cold = record(doc, &mut probe_engine(), 0.5);
    assert_eq!(first.bitmaps.len(), 1, "三个 A 共用一张位图");
    assert_eq!(draw_bitmaps(&first).len(), 3);
    assert_eq!(drawop::fingerprint(&first), drawop::fingerprint(&again));
    assert_eq!(drawop::fingerprint(&first), drawop::fingerprint(&cold));
}

/// 单色字体一条彩色通道都不碰：没有位图、信封仍是 v3，`FillPath` 与
/// `glyph_path` 给出轮廓的字形一一对应——既有 golden 的指令流逐条不变。
#[test]
fn monochrome_text_keeps_its_outline_ops_and_v3_envelope() {
    let mut engine = TextEngine::with_document_fonts(&[MONO.to_vec()]);
    let style = json!({"x": 20, "y": 40, "fontSize": 48, "font": "VK Sans", "color": "#ffffff"});
    let frame = record(doc("Ag A", style), &mut engine, 0.5);
    assert!(draw_bitmaps(&frame).is_empty());
    assert!(frame.bitmaps.is_empty());
    let shaped = engine.shape("Ag A", "VK Sans", 48.0, 400);
    let outlined = shaped
        .glyphs
        .iter()
        .filter(|glyph| engine.glyph_path(glyph.cache_key).is_some())
        .count();
    assert_eq!(fill_paths(&frame), outlined);
    assert_eq!(drawop::required_version(&frame), 3);
}

/// part 动画（打字机）逐 part 出现：彩色字形与轮廓字形同一条 part 语义。
#[test]
fn part_motion_reveals_colour_glyphs_part_by_part() {
    let mut engine = probe_engine();
    let mut style = probe_style(json!({}));
    style["x"] = json!(10);
    let doc = json!({
        "meta": {"id": "t", "width": 320, "height": 200, "fps": 30},
        "scenes": [{"id": "s", "dur": 3}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end", "element": {
                "type": "text", "id": "el", "text": "AAA", "style": style,
                "split": {"by": "grapheme"},
                "animate": {"parts": {
                    "op": "stagger", "gap": 0.3, "order": "start", "parts": true,
                    "item": {"op": "preset", "preset": "motion.typewriter"}
                }}
            }}
        ]}]
    });
    let counts: Vec<usize> = [0.0, 0.35, 0.65, 2.0]
        .into_iter()
        .map(|t| draw_bitmaps(&record(doc.clone(), &mut engine, t)).len())
        .collect();
    assert!(
        counts.windows(2).all(|w| w[0] <= w[1]),
        "彩色字形应随时间逐个出现：{counts:?}"
    );
    assert_eq!(*counts.last().unwrap(), 3, "{counts:?}");
    assert!(counts[0] < 3, "{counts:?}");
}

/// 系统彩色 emoji 字体（macOS `sbix` / Linux `CBDT` / Windows `COLR`）：📎 不再是空白。
#[test]
fn system_colour_emoji_render_in_bcf_text() {
    let mut engine = TextEngine::new();
    let Some(family) = ["Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji"]
        .into_iter()
        .find(|family| engine.has_family(family))
    else {
        eprintln!("跳过：本机没有安装彩色 emoji 字体");
        return;
    };
    let style = json!({"x": 40, "y": 40, "fontSize": 96, "color": "#ffffff"});
    let frame = record(doc("📎", style), &mut engine, 0.5);
    assert!(
        !draw_bitmaps(&frame).is_empty(),
        "📎 应走彩色位图通道（回退字体 {family}）"
    );
    let pm = rasterize(&frame);
    let chromatic = pm
        .data()
        .chunks_exact(4)
        .filter(|px| {
            let max = px[..3].iter().max().unwrap();
            let min = px[..3].iter().min().unwrap();
            px[3] > 128 && max - min > 40
        })
        .count();
    assert!(chromatic > 100, "📎 应画出彩色像素，实际 {chromatic} 个");
}
