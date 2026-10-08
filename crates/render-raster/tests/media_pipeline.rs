//! `media` 门内：本文件用 `LoadedAssets` / `MediaStore` / `FrameRenderer`
//! （BCF 文档渲染链路与 host 字节层），`wasm-safe` 构建里不存在（设计 §9.1）。
#![cfg(feature = "media")]

//! 媒体管线集成测试（自生成资产，需要 PATH 中有 ffmpeg/ffprobe）：
//! 资源加载 + hash 校验 / 文档字体 strict / image·svg·video 光栅化 /
//! DrawOp 字节级确定性 / 音频混音包络。

use render_raster::{FrameRenderer, MediaStore, TextEngine, drawop, load_assets};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

fn ff(args: &[&str]) {
    let st = Command::new("ffmpeg")
        .args(["-y", "-loglevel", "error"])
        .args(args)
        .status()
        .expect("需要 PATH 中有 ffmpeg");
    assert!(st.success(), "ffmpeg {args:?}");
}

fn find_font() -> PathBuf {
    for c in [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Verdana.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ] {
        if Path::new(c).is_file() {
            return PathBuf::from(c);
        }
    }
    panic!("找不到系统字体");
}

/// 生成一次性测试资产目录（进程内幂等）
fn assets_dir() -> PathBuf {
    static DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    DIR.get_or_init(make_assets_dir).clone()
}

fn make_assets_dir() -> PathBuf {
    // A suite owns its fixture directory; parallel tests never rewrite a loaded asset.
    let dir = tempfile::Builder::new()
        .prefix("bcut-media-fixtures-")
        .tempdir()
        .unwrap()
        .keep();
    let a = dir.join("assets");
    std::fs::create_dir_all(&a).unwrap();
    if !a.join("card.png").exists() {
        ff(&[
            "-f",
            "lavfi",
            "-i",
            "color=c=0x3a6ea5:s=320x240:d=1",
            "-frames:v",
            "1",
            a.join("card.png").to_str().unwrap(),
        ]);
    }
    if !a.join("clip.mp4").exists() {
        ff(&[
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=640x360:rate=30:duration=3",
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "libx264",
            "-crf",
            "20",
            a.join("clip.mp4").to_str().unwrap(),
        ]);
    }
    if !a.join("tone.wav").exists() {
        ff(&[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=6",
            "-ac",
            "2",
            a.join("tone.wav").to_str().unwrap(),
        ]);
    }
    std::fs::write(
        a.join("logo.svg"),
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <rect x="8" y="8" width="104" height="104" rx="24" fill="#e8906a"/></svg>"##,
    )
    .unwrap();
    if !a.join("main.ttf").exists() {
        let font = std::fs::read(find_font()).unwrap();
        std::fs::write(a.join("main.ttf"), font).unwrap();
    }
    dir
}

fn demo_doc() -> Value {
    json!({
        "meta": { "id": "media-demo", "width": 960, "height": 540, "fps": 30, "background": "#101014" },
        "scenes": [
            { "id": "intro",   "dur": 3, "desc": "标题与图片" },
            { "id": "footage", "dur": 4, "desc": "视频素材 + 音量闪避" }
        ],
        "assets": {
            "card": { "type": "image", "src": "assets/card.png" },
            "logo": { "type": "image", "src": "assets/logo.svg" },
            "clip": { "type": "video", "src": "assets/clip.mp4" },
            "tone": { "type": "audio", "src": "assets/tone.wav" },
            "main": { "type": "font",  "src": "assets/main.ttf" }
        },
        "tracks": [
            { "id": "main", "kind": "visual", "clips": [
                { "id": "intro-shot", "start": 0, "end": "@intro.end",
                  "element": { "type": "box", "id": "r1",
                    "style": { "width": 960, "height": 540 },
                    "children": [
                        { "type": "image", "id": "card", "src": "$assets.card",
                          "style": { "x": 100, "y": 100, "width": 320 } },
                        { "type": "image", "id": "logo", "src": "$assets.logo",
                          "style": { "x": 600, "y": 100, "width": 96 } },
                        { "type": "text", "id": "t", "text": "Media Demo",
                          "style": { "x": 100, "y": 420, "fontSize": 48, "color": "#f6f4ef" } }
                    ] } },
                { "id": "footage-shot", "start": "@footage", "end": "@footage.end",
                  "element": { "type": "box", "id": "r2",
                    "style": { "width": 960, "height": 540 },
                    "children": [
                        { "type": "video", "id": "v", "src": "$assets.clip", "mediaStart": 0.5,
                          "style": { "x": 0, "y": 0, "width": 960, "height": 540 } }
                    ] } }
            ] },
            { "id": "sound", "kind": "audio", "clips": [
                { "id": "bgm", "start": 0, "end": "@footage.end",
                  "src": "$assets.tone", "volume": 0.8,
                  "animate": { "keyframes": [ { "prop": "volume", "frames": [
                      { "t": "@footage-0.5", "v": 0.8 },
                      { "t": "@footage+0.5", "v": 0.3, "ease": "easeInOutSine" } ] } ] } }
            ] }
        ]
    })
}

fn build() -> (
    scene_primitives::Ir,
    Arc<render_raster::LoadedAssets>,
    TextEngine,
    FrameRenderer,
) {
    let dir = assets_dir();
    let doc = demo_doc();
    assert!(
        !scene_primitives::lint::lint(&doc)
            .iter()
            .any(|d| d.severity == scene_primitives::lint::Severity::Error),
        "demo doc 应通过 lint"
    );
    let assets = Arc::new(load_assets(&doc, &dir).expect("load_assets"));
    let mut r = scene_primitives::Resolver::new(doc, None).unwrap();
    r.set_host_inputs(assets.inputs.clone());
    let mut ir = r.resolve().unwrap();
    let mut engine = TextEngine::with_document_fonts(&assets.fonts);
    assert!(engine.strict, "有 font 资产 ⇒ strict 模式");
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    (ir, assets, engine, renderer)
}

#[test]
fn drawops_are_byte_deterministic() {
    let (ir, assets, _e, renderer) = build();
    // 两个全新引擎分别录制同一帧 → 编码字节必须完全一致
    let mut e1 = TextEngine::with_document_fonts(&assets.fonts);
    let mut e2 = TextEngine::with_document_fonts(&assets.fonts);
    for t in [1.0, 4.5] {
        let a = drawop::encode(&renderer.record(&ir, &mut e1, t));
        let b = drawop::encode(&renderer.record(&ir, &mut e2, t));
        assert_eq!(a, b, "t={t} 两次录制字节不一致");
        assert_eq!(drawop::fnv1a64(&a), drawop::fnv1a64(&b));
    }
    // 不同帧指纹应不同（视频媒体时刻在变）
    let f1 = drawop::fingerprint(&renderer.record(&ir, &mut e1, 4.5));
    let f2 = drawop::fingerprint(&renderer.record(&ir, &mut e1, 4.6));
    assert_ne!(f1, f2);
}

#[test]
fn media_rasterizes() {
    let (ir, assets, mut engine, renderer) = build();
    let mut media = MediaStore::new(assets.clone(), ir.fps);

    // t=1.0：png 卡片区域应是 #3a6ea5
    let pm = renderer.draw(&ir, &mut engine, &mut media, 1.0).unwrap();
    let px = |pm: &tiny_skia::Pixmap, x: u32, y: u32| {
        let i = ((y * pm.width() + x) * 4) as usize;
        (pm.data()[i], pm.data()[i + 1], pm.data()[i + 2])
    };
    let (r, g, b) = px(&pm, 200, 200); // 卡片内部
    assert!(
        (r as i32 - 0x3a).abs() < 8 && (g as i32 - 0x6e).abs() < 8 && (b as i32 - 0xa5).abs() < 8,
        "卡片像素 {r:02x}{g:02x}{b:02x} ≠ 3a6ea5"
    );
    let (r2, g2, _b2) = px(&pm, 650, 150); // svg logo 圆角矩形内部 #e8906a
    assert!(
        (r2 as i32 - 0xe8).abs() < 8 && (g2 as i32 - 0x90).abs() < 8,
        "svg 像素不符"
    );

    // t=4.5：testsrc 视频铺满画面，中心不可能等于背景色 #101014
    let pm2 = renderer.draw(&ir, &mut engine, &mut media, 4.5).unwrap();
    let (r3, g3, b3) = px(&pm2, 480, 270);
    assert!(
        !(r3 == 0x10 && g3 == 0x10 && b3 == 0x14),
        "t=4.5 中心仍是背景色，视频未画出"
    );
}

#[test]
fn audio_mix_duck() {
    let (ir, assets, _e, _r) = build();
    let bytes = render_raster::audio::mix_audio(&ir, &assets)
        .unwrap()
        .expect("有 audio clip");
    let sr = render_raster::audio::SAMPLE_RATE as f64;
    assert_eq!(
        bytes.len(),
        (ir.total * sr).round() as usize * 2 * 4,
        "PCM 长度"
    );
    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    let rms = |t0: f64, t1: f64| -> f64 {
        let (i0, i1) = ((t0 * sr) as usize * 2, (t1 * sr) as usize * 2);
        let s: f64 = samples[i0..i1]
            .iter()
            .map(|v| (*v as f64) * (*v as f64))
            .sum();
        (s / (i1 - i0) as f64).sqrt()
    };
    let loud = rms(1.8, 2.2); // vol 0.8
    let duck = rms(4.3, 4.7); // vol 0.3
    assert!(
        loud > 0.02,
        "响段 RMS {loud:.4} 异常（lavfi sine 幅度约 1/8 满幅）"
    );
    assert!(
        duck < loud * 0.55,
        "闪避未生效: loud {loud:.3} duck {duck:.3}"
    );
    assert!(samples.iter().all(|s| s.abs() <= 1.0), "混音溢出");
}

#[test]
fn hash_mismatch_rejected() {
    let dir = assets_dir();
    let mut doc = demo_doc();
    doc["assets"]["card"]["hash"] = json!(format!("sha256-{}", "0".repeat(64)));
    let err = match load_assets(&doc, &dir) {
        Ok(_) => panic!("坏 hash 应被拒绝"),
        Err(e) => format!("{e:#}"),
    };
    assert!(err.contains("hash"), "应报 hash 不符: {err}");
}

#[test]
fn strict_fonts_shape() {
    let dir = assets_dir();
    let bytes = std::fs::read(dir.join("assets/main.ttf")).unwrap();
    let mut engine = TextEngine::with_document_fonts(&[bytes]);
    let line = engine.shape("Hello 123", "", 32.0, 400);
    assert!(
        line.width > 0.0 && !line.glyphs.is_empty(),
        "strict 引擎应能 shaping"
    );
}
