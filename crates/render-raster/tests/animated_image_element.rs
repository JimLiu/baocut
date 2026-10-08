//! `media` 门内：本文件用 `LoadedAssets` / `MediaStore` / `FrameRenderer`
//! （BCF 文档渲染链路与 host 字节层），`wasm-safe` 构建里不存在（设计 §9.1）。
#![cfg(feature = "media")]

//! `animatedImage` 元素的端到端语义（规范 §6.5.1）：资产加载 → resolve →
//! 录制期量化 → 光栅化取像素。
//!
//! 与 `video_semantics.rs` 是姊妹篇：那边验的是"按源帧率量化"，这边验的是
//! "按逐帧时长表量化"，其余（`mediaStart` / `playbackRate` / `segment` /
//! `loop` / `fit`）都是同一套公式，测试因此刻意用同样的写法对拍。

use render_raster::drawop::DrawOp;
use render_raster::{FrameRenderer, MediaStore, TextEngine, load_assets};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/animated")
}

/// 8×8 的 `stripes.gif`：4 帧，起点 0 / 100 / 300 / 600ms，总长 1000ms，无限循环。
fn doc(element: Value) -> Value {
    json!({
        "meta": { "id": "ai", "width": 64, "height": 32, "fps": 25 },
        "scenes": [ { "id": "a", "dur": 4, "desc": "动图元素" } ],
        "assets": { "gif": { "type": "animatedImage", "src": "stripes.gif" } },
        "tracks": [
            { "id": "main", "kind": "visual", "clips": [
                { "id": "shot", "start": 0, "end": 4, "element": element }
            ] }
        ]
    })
}

fn element(extra: Value) -> Value {
    let mut el = json!({
        "type": "animatedImage", "id": "g1", "src": "$assets.gif",
        "style": { "x": 0, "y": 0, "width": 16, "height": 16 }
    });
    for (k, v) in extra.as_object().unwrap() {
        el.as_object_mut().unwrap().insert(k.clone(), v.clone());
    }
    el
}

struct Harness {
    ir: scene_primitives::Ir,
    engine: TextEngine,
    renderer: FrameRenderer,
    media: MediaStore,
}

fn build(element: Value) -> Harness {
    let doc = doc(element);
    let lints = scene_primitives::lint::lint(&doc);
    let errors: Vec<String> = lints
        .iter()
        .filter(|d| d.severity == scene_primitives::lint::Severity::Error)
        .map(|d| format!("{} {} {}", d.rule, d.pointer, d.message))
        .collect();
    assert!(errors.is_empty(), "文档应当零 lint 错误：{errors:?}");

    let assets = Arc::new(load_assets(&doc, &fixture_dir()).expect("load_assets"));
    let mut resolver = scene_primitives::Resolver::new(doc, None).unwrap();
    resolver.set_host_inputs(assets.inputs.clone());
    let mut ir = resolver.resolve().unwrap();
    let mut engine = TextEngine::with_document_fonts(&[]);
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let media = MediaStore::new(assets, ir.fps);
    Harness {
        ir,
        engine,
        renderer,
        media,
    }
}

impl Harness {
    /// 该时刻 `DrawMedia` 记录的源毫秒（= 帧起点）。
    fn media_ms(&mut self, t: f64) -> i64 {
        let frame = self.renderer.record(&self.ir, &mut self.engine, t);
        let hits: Vec<i64> = frame
            .ops
            .iter()
            .filter_map(|op| match op {
                DrawOp::DrawMedia { media_ms, .. } => Some(*media_ms),
                _ => None,
            })
            .collect();
        assert_eq!(hits.len(), 1, "t={t} 应恰有一个 DrawMedia");
        hits[0]
    }

    /// 该时刻画布左上角的像素（动图铺在 (0,0)，取样点必落在图内）。
    fn pixel(&mut self, t: f64) -> (u8, u8, u8, u8) {
        let frame = self.renderer.record(&self.ir, &mut self.engine, t);
        let pm = render_raster::rasterize_with_media(
            &frame,
            self.ir.w as u32,
            self.ir.h as u32,
            &mut self.media,
        )
        .expect("光栅化");
        let p = pm.pixel(1, 1).unwrap();
        (p.red(), p.green(), p.blue(), p.alpha())
    }
}

const RED: (u8, u8, u8, u8) = (0xe0, 0x20, 0x20, 255);
const GREEN: (u8, u8, u8, u8) = (0x20, 0xc0, 0x20, 255);
const BLUE: (u8, u8, u8, u8) = (0x20, 0x40, 0xe0, 255);
const YELLOW: (u8, u8, u8, u8) = (0xf0, 0xd0, 0x00, 255);

/// 时长表量化：一帧窗口内的所有时刻都记同一个 `media_ms`，跨帧才跳。
#[test]
fn the_duration_table_drives_the_recorded_source_time() {
    let mut h = build(element(json!({})));
    for (t, want) in [
        (0.0, 0),
        (0.04, 0),
        (0.08, 0),
        (0.1, 100),
        (0.28, 100),
        (0.3, 300),
        (0.56, 300),
        (0.6, 600),
        (0.96, 600),
    ] {
        assert_eq!(h.media_ms(t), want, "t={t}");
    }
}

/// 无 `loop` 声明 ⇒ 沿用素材自带的 loop count；`stripes.gif` 是无限循环，
/// 于是第二遍从头开始。
#[test]
fn the_intrinsic_loop_count_supplies_the_default() {
    let mut h = build(element(json!({})));
    assert_eq!(h.media_ms(1.0), 0, "1.0s 回到第 0 帧");
    assert_eq!(h.media_ms(1.35), 300);
    assert_eq!(h.media_ms(3.7), 600, "第四遍仍在循环");
    assert_eq!(h.pixel(1.05), RED);
    assert_eq!(h.pixel(3.65), YELLOW);
}

/// `loop: false` ⇒ 放完一遍冻结末帧。
#[test]
fn an_explicit_loop_false_freezes_on_the_last_frame() {
    let mut h = build(element(json!({ "loop": false })));
    assert_eq!(h.media_ms(0.65), 600);
    assert_eq!(h.media_ms(1.0), 600, "越过总时长即冻结");
    assert_eq!(h.media_ms(3.9), 600);
    assert_eq!(h.pixel(3.9), YELLOW);
}

/// `mediaStart` / `playbackRate` / `segment` 与 §6.5 视频公式同构。
#[test]
fn media_start_rate_and_segment_fold_like_video() {
    // segment [0.1, 0.6)：只播第 1、2 帧；rate 2 ⇒ 文档 1s 走 2s 源时间
    let mut h = build(element(
        json!({ "segment": [0.1, 0.6], "playbackRate": 2.0 }),
    ));
    // mediaStart 缺省 = segment 起点 = 0.1s
    assert_eq!(h.media_ms(0.0), 100);
    // t=0.1 → src = 0.1 + 0.2 = 0.3 → 第 2 帧
    assert_eq!(h.media_ms(0.1), 300);
    // t=0.25 → src = 0.1 + 0.5 = 0.6 → 折回 segment 起点 0.1 → 第 1 帧
    assert_eq!(h.media_ms(0.25), 100);
    assert_eq!(h.pixel(0.25), GREEN);
    assert_eq!(h.pixel(0.1), BLUE);

    // 显式 mediaStart 落在第 2 帧
    let mut h = build(element(json!({ "mediaStart": 0.35 })));
    assert_eq!(h.media_ms(0.0), 300);
    assert_eq!(h.pixel(0.0), BLUE);
}

/// 有限 loop count 的素材（`disposal.gif` 声明 2 遍）：放完就冻结，
/// 显式 `loop: true` 可以覆盖它。
#[test]
fn a_finite_loop_count_stops_after_its_plays() {
    let with = |el: Value| {
        let mut doc = doc(el);
        doc["assets"]["gif"]["src"] = json!("disposal.gif");
        doc
    };
    let run = |doc: Value| {
        let assets = Arc::new(load_assets(&doc, &fixture_dir()).expect("load_assets"));
        let mut resolver = scene_primitives::Resolver::new(doc, None).unwrap();
        resolver.set_host_inputs(assets.inputs.clone());
        let mut ir = resolver.resolve().unwrap();
        let mut engine = TextEngine::with_document_fonts(&[]);
        let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
        let media = MediaStore::new(assets, ir.fps);
        Harness {
            ir,
            engine,
            renderer,
            media,
        }
    };
    // 总长 300ms、2 遍 ⇒ 600ms 之后冻结在末帧起点 200ms
    let mut h = run(with(element(json!({}))));
    assert_eq!(h.media_ms(0.35), 0, "0.35s 折回第二遍的第 0 帧");
    assert_eq!(h.media_ms(0.45), 100, "第二遍的第 1 帧");
    assert_eq!(h.media_ms(0.6), 200, "两遍放完，冻结末帧");
    assert_eq!(h.media_ms(3.9), 200);
    // 显式 loop: true 覆盖素材声明
    let mut h = run(with(element(json!({ "loop": true }))));
    assert_eq!(h.media_ms(0.6), 0, "第三遍从头开始");
    assert_eq!(h.media_ms(3.88), 200, "第 13 遍的末帧");
}

/// 乱序录制与顺序录制逐字节相同——渲染是乱序 + 并行的，这条不是可选项。
#[test]
fn shuffled_recording_matches_sorted_recording() {
    let mut h = build(element(json!({})));
    let times: Vec<f64> = (0..40).map(|i| i as f64 * 0.1).collect();
    let sorted: Vec<i64> = times.iter().map(|t| h.media_ms(*t)).collect();

    let mut h = build(element(json!({})));
    let mut shuffled = vec![i64::MIN; times.len()];
    let mut state = 0x9e3779b97f4a7c15u64;
    let mut order: Vec<usize> = (0..times.len()).collect();
    for i in (1..order.len()).rev() {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        order.swap(i, (state >> 33) as usize % (i + 1));
    }
    for i in order {
        shuffled[i] = h.media_ms(times[i]);
    }
    assert_eq!(sorted, shuffled);
}

/// 帧指纹：同一动图帧内的两个时刻指纹相同，跨帧必然不同——
/// 静止帧缓存靠这个复用，也靠这个不误用。
#[test]
fn frame_fingerprints_change_exactly_at_frame_boundaries() {
    let mut h = build(element(json!({})));
    let fp = |h: &mut Harness, t: f64| {
        let frame = h.renderer.record(&h.ir, &mut h.engine, t);
        render_raster::fingerprint(&frame)
    };
    assert_eq!(fp(&mut h, 0.0), fp(&mut h, 0.08), "同一帧内指纹不变");
    assert_ne!(fp(&mut h, 0.08), fp(&mut h, 0.12), "跨帧指纹必须变");
    assert_eq!(fp(&mut h, 0.12), fp(&mut h, 0.28));
}

/// 静态图路径未受影响：`image` 元素仍是 `media_ms = -1` + 拉伸（fill）语义。
#[test]
fn the_static_image_path_is_untouched() {
    let doc = json!({
        "meta": { "id": "im", "width": 64, "height": 32, "fps": 25 },
        "scenes": [ { "id": "a", "dur": 1, "desc": "静态图" } ],
        "assets": { "card": { "type": "image", "src": "../assets/card.png" } },
        "tracks": [ { "id": "main", "kind": "visual", "clips": [
            { "id": "shot", "start": 0, "end": 1, "element": {
                "type": "image", "id": "i1", "src": "$assets.card",
                "style": { "x": 0, "y": 0, "width": 16, "height": 16 } } }
        ] } ]
    });
    let assets = load_assets(&doc, &fixture_dir()).expect("load_assets");
    let mut resolver = scene_primitives::Resolver::new(doc, None).unwrap();
    resolver.set_host_inputs(assets.inputs.clone());
    let mut ir = resolver.resolve().unwrap();
    let mut engine = TextEngine::with_document_fonts(&[]);
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let frame = renderer.record(&ir, &mut engine, 0.5);
    let ops: Vec<_> = frame
        .ops
        .iter()
        .filter_map(|op| match op {
            DrawOp::DrawMedia { media_ms, src, .. } => Some((*media_ms, *src)),
            _ => None,
        })
        .collect();
    assert_eq!(ops, vec![(-1, [0.0f32; 4])], "静态图仍是 -1 + 整幅源");
}

/// GIF 声明成 `type: "image"` 时，错误要指路到 `animatedImage`，
/// 而不是甩一句"不支持的图像格式"。
#[test]
fn a_gif_declared_as_a_plain_image_points_at_animated_image() {
    let doc = json!({
        "meta": { "id": "bad", "width": 64, "height": 32, "fps": 25 },
        "scenes": [ { "id": "a", "dur": 1, "desc": "错声明" } ],
        "assets": { "gif": { "type": "image", "src": "stripes.gif" } },
        "tracks": [ { "id": "main", "kind": "visual", "clips": [
            { "id": "shot", "start": 0, "end": 1, "element": {
                "type": "image", "id": "i1", "src": "$assets.gif",
                "style": { "x": 0, "y": 0, "width": 16, "height": 16 } } }
        ] } ]
    });
    let err = match load_assets(&doc, &fixture_dir()) {
        Ok(_) => panic!("静态图解码器不该收下 GIF"),
        Err(e) => e,
    };
    let text = format!("{err:#}");
    assert!(text.contains("animatedImage"), "{text}");
}

/// `asset-kind-mismatch`：`animatedImage` 元素引用 `image` 资产要在 lint 期挡住。
#[test]
fn the_element_and_asset_kinds_must_agree() {
    let mut doc = doc(element(json!({})));
    doc["assets"]["gif"]["type"] = json!("image");
    let codes: Vec<String> = scene_primitives::lint::lint(&doc)
        .iter()
        .map(|d| d.rule.to_string())
        .collect();
    assert!(
        codes.iter().any(|c| c == "asset-kind-mismatch"),
        "应报 asset-kind-mismatch，实际 {codes:?}"
    );
}

/// 动图没有音轨：`withAudio` / `volume` 是写错了。
#[test]
fn an_animated_image_refuses_audio_fields() {
    let doc = doc(element(json!({ "withAudio": true, "volume": 0.5 })));
    let messages: Vec<String> = scene_primitives::lint::lint(&doc)
        .iter()
        .filter(|d| d.message.contains("没有音轨"))
        .map(|d| d.pointer.clone())
        .collect();
    assert_eq!(
        messages.len(),
        2,
        "withAudio 与 volume 各报一条：{messages:?}"
    );
}
