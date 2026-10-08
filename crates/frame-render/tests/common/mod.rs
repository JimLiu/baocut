//! 像素测试的公共部分：按 JSON 片段拼一份最小的视频快照（160×90、30 fps、一条画面轨），按实例 ID 给源画面，
//! 求帧计划再画出来。字体用内核随带的那一批（与原生导出相同）。

#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::OnceLock;

use frame_render::{Documents, FrameRenderer, LayerMedia, RenderError, RenderOptions, premultiplied};
use render_graph::{FramePlan, VideoView, VisualLayer, plan_interactive};
use serde_json::{Value, json};
use tiny_skia::Pixmap;
use video_model::{VersionRef, VideoSnapshot};

pub const W: u32 = 160;
pub const H: u32 = 90;

pub const RED: [u8; 4] = [255, 0, 0, 255];
pub const GREEN: [u8; 4] = [0, 255, 0, 255];
pub const BLUE: [u8; 4] = [0, 0, 255, 255];
pub const BLACK: [u8; 4] = [0, 0, 0, 255];
pub const WHITE: [u8; 4] = [255, 255, 255, 255];
pub const YELLOW: [u8; 4] = [255, 255, 0, 255];

pub fn fonts() -> Vec<Vec<u8>> {
    static FONTS: OnceLock<Vec<Vec<u8>>> = OnceLock::new();
    FONTS.get_or_init(frame_render::bundled_fonts).clone()
}

/// 一个图片素材（`displayWidth`×`displayHeight`）。
pub fn image_asset(id: &str, width: u32, height: u32) -> (String, Value) {
    asset(id, "image", "image/png", width, height)
}

/// 一个 SVG 图片素材（`image/svg+xml`，画面由内核从素材字节光栅）。
pub fn svg_asset(id: &str, width: u32, height: u32) -> (String, Value) {
    asset(id, "image", "image/svg+xml", width, height)
}

/// 一个 GIF 图片素材（`image/gif`，画面由内核从素材字节解，动图按时刻取帧）。
pub fn gif_asset(id: &str, width: u32, height: u32) -> (String, Value) {
    asset(id, "image", "image/gif", width, height)
}

/// 8×8 的四帧 GIF：整幅纯色，依次是 [`STRIPES`] 的四色，各停 100、200、300、400 ms（总长 1 秒，无限循环）。
pub const STRIPES_GIF: &[u8] = include_bytes!("../../../render-raster/tests/fixtures/animated/stripes.gif");
pub const STRIPES: [[u8; 4]; 4] = [
    [0xe0, 0x20, 0x20, 255],
    [0x20, 0xc0, 0x20, 255],
    [0x20, 0x40, 0xe0, 255],
    [0xf0, 0xd0, 0x00, 255],
];

/// 1×1 的 GIF：`frames` 帧，第 i 帧是调色板的第 `i % 4` 色（红、绿、蓝、白），每帧停 `delay_cs` 个 10 ms。
pub fn tiny_gif(frames: usize, delay_cs: u16) -> Vec<u8> {
    let mut out = b"GIF89a".to_vec();
    out.extend([1, 0, 1, 0, 0b1000_0001, 0, 0]);
    out.extend([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    out.extend([0x21, 0xFF, 11]);
    out.extend(b"NETSCAPE2.0");
    out.extend([3, 1, 0, 0, 0]);
    for i in 0..frames {
        out.extend([0x21, 0xF9, 4, 0]);
        out.extend(delay_cs.to_le_bytes());
        out.extend([0, 0]);
        out.extend([0x2C, 0, 0, 0, 0, 1, 0, 1, 0, 0]);
        // LZW 最小码长 2：清除码 4、像素、结束码 5，各 3 位，低位在前。
        let codes = 4u16 | ((i % 4) as u16) << 3 | 5 << 6;
        out.extend([2, 2]);
        out.extend(codes.to_le_bytes());
        out.push(0);
    }
    out.push(0x3B);
    out
}

pub fn video_asset(id: &str, width: u32, height: u32) -> (String, Value) {
    asset(id, "video", "video/mp4", width, height)
}

pub fn lottie_asset(id: &str) -> (String, Value) {
    (
        id.to_string(),
        json!({
            "id": id, "kind": "lottie", "name": format!("{id}.json"), "currentRevision": "rev_1",
            "revisions": { "rev_1": {
                "revision": "rev_1", "contentHash": format!("sha256:{id}"), "byteLength": 1000, "mediaType": "application/json",
                "storage": { "mode": "managed" }, "provenance": { "origin": "import" }
            }}
        }),
    )
}

/// 一个声音素材（48 kHz 立体声）。
pub fn audio_asset(id: &str) -> (String, Value) {
    (
        id.to_string(),
        json!({
            "id": id, "kind": "audio", "name": format!("{id}.wav"), "currentRevision": "rev_1",
            "revisions": { "rev_1": {
                "revision": "rev_1", "contentHash": format!("sha256:{id}"), "byteLength": 1000, "mediaType": "audio/wav",
                "storage": { "mode": "managed" }, "provenance": { "origin": "import" },
                "audio": { "sampleRate": 48000, "channels": 2 }
            }}
        }),
    )
}

fn asset(id: &str, kind: &str, media_type: &str, width: u32, height: u32) -> (String, Value) {
    (
        id.to_string(),
        json!({
            "id": id, "kind": kind, "name": id, "currentRevision": "rev_1",
            "revisions": { "rev_1": {
                "revision": "rev_1", "contentHash": format!("sha256:{id}"), "byteLength": 1000, "mediaType": media_type,
                "storage": { "mode": "managed" }, "provenance": { "origin": "import" },
                "video": {
                    "displayWidth": width, "displayHeight": height, "rotation": 0,
                    "pixelAspectRatio": { "num": 1, "den": 1 },
                    "frameRate": { "kind": "cfr", "rate": { "num": 30, "den": 1 } },
                    "ptsOrigin": { "ticks": "0", "timescale": 1 }, "hasAlpha": kind == "image"
                }
            }}
        }),
    )
}

/// 画面实例的公共字段：轨道 `trk_v1`、从第 0 帧起 `frames` 帧。`body` 并进去（类型、几何与各自的字段）。
pub fn item(id: &str, order: i64, frames: i64, body: Value) -> Value {
    let mut base = json!({
        "id": id, "trackId": "trk_v1", "enabled": true, "locked": false, "paintOrder": order,
        "followPolicy": { "kind": "sequence-fixed" },
        "span": { "fromFrame": 0, "durationFrames": frames },
    });
    merge(&mut base, body);
    base
}

/// 视频实例：源时间与序列时间相同。
pub fn video_item(id: &str, asset: &str, from: i64, frames: i64, body: Value) -> Value {
    let mut value = item(
        id,
        0,
        frames,
        json!({
            "type": "video", "assetRef": { "id": asset, "revision": "rev_1" },
            "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
            "embeddedAudio": { "enabled": false, "volume": 1 },
            "place": {}, "mode": "fullscreen", "fit": "cover"
        }),
    );
    value["span"]["fromFrame"] = json!(from);
    merge(&mut value, body);
    value
}

/// 图片实例：素材是 `a_<id>`，从 `from` 帧起 `frames` 帧，`body` 并进去（缺省按画中画摆在 `place`）。
pub fn image(id: &str, order: i64, from: i64, frames: i64, body: Value) -> Value {
    let mut value = item(
        id,
        order,
        frames,
        json!({ "type": "image", "assetRef": { "id": format!("a_{id}"), "revision": "rev_1" }, "place": {}, "fit": "cover" }),
    );
    value["span"]["fromFrame"] = json!(from);
    merge(&mut value, body);
    value
}

/// 铺满画布的图片实例。
pub fn full_image(id: &str, order: i64, from: i64, frames: i64) -> Value {
    image(id, order, from, frames, json!({ "mode": "fullscreen" }))
}

/// 一个线性、居中摆放的转场。
pub fn transition(id: &str, left: Option<&str>, right: Option<&str>, kind: &str, params: Value, frames: i64) -> Value {
    let mut value = json!({
        "id": id, "kind": kind, "params": params, "durationFrames": frames,
        "easing": "linear", "placement": "center", "audioCrossfade": false
    });
    if let Some(left) = left {
        value["leftItemId"] = json!(left);
    }
    if let Some(right) = right {
        value["rightItemId"] = json!(right);
    }
    value
}

fn merge(base: &mut Value, extra: Value) {
    if let (Some(base), Value::Object(extra)) = (base.as_object_mut(), extra) {
        for (k, v) in extra {
            base.insert(k, v);
        }
    }
}

/// 拼一份视频快照。`sequence` 并进序列（转场、模板、关键帧绑定、标记等）。
pub fn video(items: Vec<Value>, assets: Vec<(String, Value)>, sequence: Value) -> VideoSnapshot {
    let mut seq = json!({
        "id": "seq", "revision": "1", "name": "测试序列", "fps": { "num": 30, "den": 1 },
        "canvas": { "width": W, "height": H, "workingSpace": "srgb", "background": "#000000" },
        "durationPolicy": { "kind": "derived" },
        "tracks": [
            { "id": "trk_v1", "order": 0, "kind": "visual", "locked": false, "visible": true, "muted": false,
              "solo": { "enabled": false, "group": "visual" } },
            { "id": "trk_s1", "order": 1, "kind": "subtitle", "locked": false, "visible": true, "muted": false,
              "solo": { "enabled": false, "group": "visual" } }
        ],
        "items": items, "animationBindings": [], "transitions": [], "markers": [], "ducking": []
    });
    merge(&mut seq, sequence);
    let assets: serde_json::Map<String, Value> = assets.into_iter().collect();
    let value = json!({
        "format": "baocut.video", "schemaVersion": 3, "timeContractVersion": 1, "id": "video_test", "name": "测试",
        "revision": "1", "rootSequenceId": "seq", "sequences": { "seq": seq }, "assets": assets,
        "fonts": {}, "documents": {}, "localizationSets": {}, "canvasVariants": {}, "syncGroups": {},
        "protections": {}, "checkpoints": {}, "links": []
    });
    serde_json::from_value(value).expect("测试视频是完整的快照")
}

/// 按实例 ID 给源画面与声波频谱、按素材 ID 给素材字节、按 `素材ID@版本` 给素材频谱。
#[derive(Default)]
pub struct Media {
    pub pictures: HashMap<String, Pixmap>,
    pub assets: HashMap<String, Vec<u8>>,
    pub spectra: HashMap<String, Vec<u8>>,
    pub audio_spectra: HashMap<String, Vec<u8>>,
}

impl Media {
    pub fn with(mut self, item_id: &str, picture: Pixmap) -> Media {
        self.pictures.insert(item_id.into(), picture);
        self
    }
}

impl LayerMedia for Media {
    fn picture(&mut self, layer: &VisualLayer) -> Result<Option<&Pixmap>, RenderError> {
        Ok(self.pictures.get(&layer.item_id))
    }

    fn asset_bytes(&mut self, asset: &VersionRef) -> Option<Vec<u8>> {
        self.assets.get(&asset.id).cloned()
    }

    fn spectrum(&mut self, item_id: &str) -> Option<Vec<u8>> {
        self.spectra.get(item_id).cloned()
    }

    fn audio_spectrum(&mut self, asset: &VersionRef) -> Option<Vec<u8>> {
        self.audio_spectra.get(&format!("{}@{}", asset.id, asset.revision)).cloned()
    }
}

/// 一份 BCS1 频谱：`frames` 帧都一样，频域行是 `level(bin)`（canonical 字节），时域行是一段正弦。
pub fn spectrum(frames: u32, level: impl Fn(usize) -> u8) -> Vec<u8> {
    spectrum_by_frame(frames, |_, bin| level(bin))
}

/// 一份 BCS1 频谱：第 `frame` 帧的频域行是 `level(frame, bin)`，时域行是一段正弦。
pub fn spectrum_by_frame(frames: u32, level: impl Fn(usize, usize) -> u8) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend(b"BCS1");
    out.extend(1u16.to_le_bytes());
    out.extend(0u16.to_le_bytes());
    for value in [60u32, 48_000, 1024, 128, 512, frames] {
        out.extend(value.to_le_bytes());
    }
    out.extend(0u64.to_le_bytes());
    for frame in 0..frames as usize {
        out.extend((0..128).map(|i| (128.0 + 90.0 * (i as f64 / 128.0 * std::f64::consts::TAU * 3.0).sin()) as u8));
        out.extend((0..512).map(|bin| level(frame, bin)));
    }
    out
}

pub fn solid(w: u32, h: u32, color: [u8; 4]) -> Pixmap {
    premultiplied(w, h, color.repeat((w * h) as usize)).unwrap()
}

/// 左半一种颜色、右半另一种颜色。
pub fn halves(w: u32, h: u32, left: [u8; 4], right: [u8; 4]) -> Pixmap {
    let mut data = Vec::new();
    for _ in 0..h {
        for x in 0..w {
            data.extend(if x < w / 2 { left } else { right });
        }
    }
    premultiplied(w, h, data).unwrap()
}

pub fn renderer(skip: bool, documents: Documents) -> FrameRenderer {
    FrameRenderer::new(
        RenderOptions {
            width: W,
            height: H,
            skip_unsupported: skip,
            captions: true,
        },
        documents,
        fonts(),
    )
    .unwrap()
}

pub fn plan(video: &VideoSnapshot, seconds: f64) -> FramePlan {
    plan_interactive(VideoView::from(video), "seq", seconds).expect("求计划")
}

/// 画 `seconds` 这一帧。
pub fn render(video: &VideoSnapshot, seconds: f64, media: &mut Media) -> Vec<u8> {
    render_with(&mut renderer(false, Documents::default()), video, seconds, media)
}

pub fn render_with(renderer: &mut FrameRenderer, video: &VideoSnapshot, seconds: f64, media: &mut Media) -> Vec<u8> {
    try_render(renderer, video, seconds, media).unwrap()
}

pub fn try_render(renderer: &mut FrameRenderer, video: &VideoSnapshot, seconds: f64, media: &mut Media) -> Result<Vec<u8>, RenderError> {
    let plan = plan(video, seconds);
    renderer.render(VideoView::from(video), &plan, seconds, media).map(<[u8]>::to_vec)
}

/// 帧 `frame`（30 fps）的秒。
pub fn at(frame: f64) -> f64 {
    frame / 30.0
}

pub fn px(frame: &[u8], x: u32, y: u32) -> [u8; 4] {
    let i = ((y * W + x) * 4) as usize;
    frame[i..i + 4].try_into().unwrap()
}

#[track_caller]
pub fn near(actual: [u8; 4], expected: [u8; 4], tolerance: i32) {
    let close = actual.iter().zip(expected).all(|(a, e)| (*a as i32 - e as i32).abs() <= tolerance);
    assert!(close, "{actual:?} ≠ {expected:?}");
}

/// 不是背景黑色的像素的包围盒 `(x0, y0, x1, y1)`（含两端）。
pub fn painted_bounds(frame: &[u8]) -> Option<(u32, u32, u32, u32)> {
    let mut bounds: Option<(u32, u32, u32, u32)> = None;
    for y in 0..H {
        for x in 0..W {
            let p = px(frame, x, y);
            if p[0] > 8 || p[1] > 8 || p[2] > 8 {
                bounds = Some(match bounds {
                    None => (x, y, x, y),
                    Some((x0, y0, x1, y1)) => (x0.min(x), y0.min(y), x1.max(x), y1.max(y)),
                });
            }
        }
    }
    bounds
}

/// 不是背景黑色的像素个数。
pub fn painted(frame: &[u8]) -> usize {
    frame.chunks_exact(4).filter(|p| p[0] > 8 || p[1] > 8 || p[2] > 8).count()
}

/// `.lottie` 素材（压缩包）：kind 仍是 lottie，字节是 zip。
pub fn dotlottie_asset(id: &str) -> (String, Value) {
    let (id, mut value) = lottie_asset(id);
    value["name"] = json!(format!("{id}.lottie"));
    value["revisions"]["rev_1"]["mediaType"] = json!("application/zip");
    (id, value)
}

/// 手拼一个只用「存储」方式的 zip（`(名字, 内容)`），CRC 用内核自己的那一份。
pub fn stored_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
    let crc32 = render_raster::source::lottie::archive::crc32;
    let (mut out, mut central) = (Vec::new(), Vec::new());
    for (name, data) in files {
        let (offset, crc, len) = (out.len() as u32, crc32(data), data.len() as u32);
        out.extend(0x0403_4b50u32.to_le_bytes());
        out.extend([20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        out.extend(crc.to_le_bytes());
        out.extend(len.to_le_bytes());
        out.extend(len.to_le_bytes());
        out.extend((name.len() as u16).to_le_bytes());
        out.extend([0, 0]);
        out.extend(name.as_bytes());
        out.extend(*data);
        central.extend(0x0201_4b50u32.to_le_bytes());
        central.extend([20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        central.extend(crc.to_le_bytes());
        central.extend(len.to_le_bytes());
        central.extend(len.to_le_bytes());
        central.extend((name.len() as u16).to_le_bytes());
        central.extend([0u8; 12]);
        central.extend(offset.to_le_bytes());
        central.extend(name.as_bytes());
    }
    let cd_offset = out.len() as u32;
    out.extend(&central);
    out.extend(0x0605_4b50u32.to_le_bytes());
    out.extend([0, 0, 0, 0]);
    out.extend((files.len() as u16).to_le_bytes());
    out.extend((files.len() as u16).to_le_bytes());
    out.extend((central.len() as u32).to_le_bytes());
    out.extend(cd_offset.to_le_bytes());
    out.extend([0, 0]);
    out
}

/// 一份 `.lottie`：120×90 的合成，左边一张包里的 PNG（8×8 红，放大 4 倍，从上往下移），右边一张内嵌的 SVG
/// （data URI，6×6 的绿圆声明成 24×24）。
pub fn dotlottie_fixture() -> Vec<u8> {
    let mut red = Pixmap::new(8, 8).unwrap();
    red.fill(tiny_skia::Color::from_rgba8(255, 0, 0, 255));
    let png = red.encode_png().unwrap();
    let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="6" height="6"><circle cx="3" cy="3" r="3" fill="%2300c853"/></svg>"#;
    let still = |v: Value| json!({ "a": 0, "k": v });
    let layer = |ind: u32, image: &str, p: Value, s: f64| {
        json!({ "ty": 2, "ind": ind, "refId": image, "ip": 0, "op": 30, "st": 0,
                "ks": { "a": still(json!([0, 0])), "o": still(json!(100)), "p": p, "r": still(json!(0)), "s": still(json!([s, s])) } })
    };
    let moving = json!({ "a": 1, "k": [
        { "t": 0, "s": [10, 10], "o": { "x": [0], "y": [0] }, "i": { "x": [1], "y": [1] } },
        { "t": 30, "s": [10, 50] } ] });
    let doc = json!({
        "v": "5.7.4", "fr": 30, "ip": 0, "op": 30, "w": 120, "h": 90,
        "assets": [
            { "id": "png", "w": 8, "h": 8, "u": "/images/", "p": "red.png" },
            { "id": "svg", "w": 24, "h": 24, "e": 1, "p": format!("data:image/svg+xml;utf8,{svg}") }
        ],
        "layers": [layer(1, "png", moving, 400.0), layer(2, "svg", still(json!([80, 30])), 100.0)]
    });
    let manifest = br#"{"version":"1","activeAnimationId":"main","animations":[{"id":"main"}]}"#;
    stored_zip(&[
        ("manifest.json", manifest),
        ("animations/main.json", &serde_json::to_vec(&doc).unwrap()),
        ("images/red.png", &png),
    ])
}
