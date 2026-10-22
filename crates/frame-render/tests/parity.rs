//! 预览与导出画出同一帧：每个场景按导出的路子（`plan_frame` 求计划、内置字体、原生构建）画出来，帧的摘要与输入
//! 一起记在 `tests/fixtures/parity.json`；界面包的测试（`packages/ui/src/render/parity.test.ts`）把同一份输入送进
//! 编出来的预览 WASM，逐帧比摘要。场景覆盖每种画面实例、每种转场、`fx`、遮罩、平铺、元素动画、关键帧、模板层与字幕，
//! 以及输出缩放、不铺背景与不画字幕三个开关。
//!
//! 内核改了画法时先跑 `BAOCUT_UPDATE_PARITY=1 cargo test -p frame-render --test parity` 重写夹具，再跑界面包的测试。
//! 源画面在夹具里写成竖条（`bands`），两边按同一个规则铺成非预乘的 RGBA，经同一个 `premultiplied` 送进渲染器；
//! 浏览器解码（视频、位图）不在这里，送进来的都是解好的画面。SVG 与 GIF 图片和 Lottie 一样以素材字节送进去，两边各自在内核里
//! 光栅或解码。

mod common;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use common::*;
use editor_semantics::Ratio;
use frame_render::{Documents, FrameRenderer, FrozenDocument, LayerMedia, RenderError, RenderOptions, demultiplied, premultiplied};
use render_graph::audio_plan::speaker_activity;
use render_graph::{VideoView, VisualLayer, plan_frame};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tiny_skia::Pixmap;
use video_model::{DocumentRecord, TimelineItem, VersionRef, VideoSnapshot};

const LOTTIE: &str = include_str!("../../render-raster/tests/fixtures/lottie/cases/shapes.json");
const LOTTIE_IMAGE: &str = include_str!("../../render-raster/tests/fixtures/lottie/cases/image-embedded.json");
const STUDIO: &str = "baocut.legacy-studio-style/0.1";
/// 纯色填充的 SVG 贴纸，带一段 `<text>`：两边的 resvg 都没有字体，文字都不画（预览的 wasm 不带 `text`，导出的字体库是空的）。
const SVG_STICKER: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"><rect width="40" height="15" fill="#FF4000"/><circle cx="20" cy="22" r="7" fill="#2060FF"/><text x="2" y="12" font-size="10" fill="#FFFFFF">Hi</text></svg>"##;

/// 一帧：序列帧号（30 fps）、输出尺寸与两个开关。
#[derive(Clone, Copy)]
struct Shot {
    frame: i64,
    width: u32,
    height: u32,
    captions: bool,
    transparent: bool,
    associated_rgba: bool,
}

fn shot(frame: i64) -> Shot {
    Shot {
        frame,
        width: W,
        height: H,
        captions: true,
        transparent: false,
        associated_rgba: false,
    }
}

fn shots(frames: &[i64]) -> Vec<Shot> {
    frames.iter().map(|&f| shot(f)).collect()
}

struct Scene {
    name: &'static str,
    video: VideoSnapshot,
    documents: Vec<Value>,
    /// 实例 ID → (宽, 高, 从左到右等宽的竖条颜色)。
    pictures: Vec<(&'static str, u32, u32, Vec<[u8; 4]>)>,
    /// `素材ID@版本` → 文本字节。
    assets: Vec<(&'static str, String)>,
    /// `素材ID@版本` → 二进制字节（夹具里写成十六进制）。
    binary_assets: Vec<(&'static str, Vec<u8>)>,
    /// 实例 ID → BCS1。
    spectra: Vec<(&'static str, Vec<u8>)>,
    /// `素材ID@版本` → 素材频谱（BCS1）。
    audio_spectra: Vec<(&'static str, Vec<u8>)>,
    /// 视频里的转写（`{documentId, sourceAssetId?, body}`，与预览的 `bc_set_speech` 相同）：声波的 `speaker` 用。
    speech: Vec<Value>,
    shots: Vec<Shot>,
}

impl Scene {
    fn new(name: &'static str, video: VideoSnapshot, frames: &[i64]) -> Scene {
        Scene {
            name,
            video,
            documents: Vec::new(),
            pictures: Vec::new(),
            assets: Vec::new(),
            binary_assets: Vec::new(),
            spectra: Vec::new(),
            audio_spectra: Vec::new(),
            speech: Vec::new(),
            shots: shots(frames),
        }
    }

    fn picture(mut self, item: &'static str, w: u32, h: u32, bands: &[[u8; 4]]) -> Scene {
        self.pictures.push((item, w, h, bands.to_vec()));
        self
    }
}

/// 竖条画面：第 x 列的颜色是 `bands[x * n / w]`（非预乘 RGBA）。界面包的测试按同一个规则铺。
fn bands_rgba(w: u32, h: u32, bands: &[[u8; 4]]) -> Vec<u8> {
    let n = bands.len() as u32;
    let mut row = Vec::with_capacity(w as usize * 4);
    for x in 0..w {
        row.extend(bands[(x * n / w) as usize]);
    }
    row.repeat(h as usize)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

/// 夹具里的输入原样送进渲染器：按实例给画面与频谱、按 `素材ID@版本` 给素材字节与素材频谱（与预览 WASM 相同）。
#[derive(Default)]
struct FixtureMedia {
    pictures: BTreeMap<String, Arc<Pixmap>>,
    assets: BTreeMap<String, Vec<u8>>,
    spectra: BTreeMap<String, Vec<u8>>,
    audio_spectra: BTreeMap<String, Vec<u8>>,
}

impl LayerMedia for FixtureMedia {
    fn picture(&mut self, layer: &VisualLayer) -> Result<Option<Arc<Pixmap>>, RenderError> {
        Ok(self.pictures.get(&layer.item_id).cloned())
    }

    fn asset_bytes(&mut self, asset: &VersionRef) -> Option<Vec<u8>> {
        self.assets.get(&format!("{}@{}", asset.id, asset.revision)).cloned()
    }

    fn spectrum(&mut self, item_id: &str) -> Option<Vec<u8>> {
        self.spectra.get(item_id).cloned()
    }

    fn audio_spectrum(&mut self, asset: &VersionRef) -> Option<Vec<u8>> {
        self.audio_spectra.get(&format!("{}@{}", asset.id, asset.revision)).cloned()
    }
}

fn with(mut value: Value, extra: Value) -> Value {
    if let (Some(base), Value::Object(extra)) = (value.as_object_mut(), extra) {
        base.extend(extra);
    }
    value
}

/// 画中画红图（16×9），宽 50% 摆在画布中间；`body` 并进实例。
fn pip(name: &'static str, body: Value, frames: &[i64]) -> Scene {
    let item = with(image("a", 0, 0, 90, json!({ "place": { "w": 50 } })), body);
    Scene::new(name, video(vec![item], vec![image_asset("a_a", 16, 9)], json!({})), frames).picture("a", 16, 9, &[RED, YELLOW])
}

/// 生成器一类（不读媒体）的实例：宽 60%，从第 0 帧起 90 帧。
fn generator(name: &'static str, body: Value, frames: &[i64]) -> Scene {
    let item = with(item("g", 0, 90, json!({ "place": { "w": 60 } })), body);
    Scene::new(name, video(vec![item], vec![], json!({})), frames)
}

fn caption_doc(id: &str, clock: &str, cues: &[(f64, f64, &str)], line_kind: &str) -> Value {
    json!({
        "documentId": id, "kind": "caption", "schema": "baocut.caption/1", "lineKind": line_kind,
        "body": {
            "schema": "baocut.caption/1", "clock": clock, "timescale": 1000,
            "cues": cues.iter().enumerate().map(|(i, (s, e, t))| json!({
                "id": format!("c{i}"), "start": (s * 1000.0) as i64, "end": (e * 1000.0) as i64, "text": t
            })).collect::<Vec<_>>(),
        }
    })
}

fn style_doc(id: &str, body: Value) -> Value {
    json!({ "documentId": id, "kind": "caption-style", "schema": body.get("schema").cloned(), "body": body })
}

fn caption(id: &str, document: &str, style: Option<&str>, frames: i64, scopes: &[&str]) -> Value {
    let mut value = item(
        id,
        0,
        frames,
        json!({ "type": "caption", "documentId": document, "scopeItemIds": scopes }),
    );
    value["trackId"] = json!("trk_s1");
    if let Some(style) = style {
        value["styleDocumentId"] = json!(style);
    }
    value
}

/// A [0, 30) 接 B [30, 60)，中间一个 20 帧的两侧转场。
fn two_sided(name: &'static str, kind: &str, params: Value) -> Scene {
    let video = video(
        vec![full_image("a", 0, 0, 30), full_image("b", 0, 30, 30)],
        vec![image_asset("a_a", W, H), image_asset("a_b", W, H)],
        json!({ "transitions": [transition("tr", Some("a"), Some("b"), kind, params, 20)] }),
    );
    Scene::new(name, video, &[22, 30, 37])
        .picture("a", W, H, &[RED, YELLOW])
        .picture("b", W, H, &[BLUE, GREEN, WHITE])
}

fn scenes() -> Vec<Scene> {
    let mut scenes = vec![
        // —— 媒体实例 ——
        Scene::new(
            "image-fullscreen",
            video(vec![full_image("img", 0, 0, 30)], vec![image_asset("a_img", W, H)], json!({})),
            &[0, 15],
        )
        .picture("img", W, H, &[RED, BLUE]),
        Scene::new(
            "image-pip-crop-flip",
            video(
                vec![image(
                    "img",
                    0,
                    0,
                    30,
                    json!({ "place": { "x": 40, "y": 55, "w": 50, "rot": 20, "flipX": true, "opacity": 0.8 },
                            "crop": { "left": 0.1, "top": 0.4, "right": 0, "bottom": 0.05 } }),
                )],
                vec![image_asset("a_img", 160, 90)],
                json!({}),
            ),
            &[10],
        )
        .picture("img", 160, 90, &[GREEN, RED, BLUE]),
        Scene::new(
            "video-source-time",
            video(
                vec![video_item(
                    "v",
                    "a_v",
                    0,
                    60,
                    json!({ "mode": "pip", "place": { "w": 70 }, "fit": "contain", "timeMap": {
                        "kind": "linear", "sourceIn": { "ticks": "2", "timescale": 1 }, "rate": { "num": 1, "den": 1 }
                    } }),
                )],
                vec![video_asset("a_v", 64, 64)],
                json!({}),
            ),
            &[15],
        )
        .picture("v", 64, 64, &[GREEN, BLUE]),
        two_piece_crop()
            .picture("v1", W, H, &[RED, GREEN, BLUE, YELLOW])
            .picture("v2", W, H, &[RED, GREEN, BLUE, YELLOW]),
        Scene::new(
            "stacked-layers",
            video(
                vec![
                    full_image("b", 0, 0, 30),
                    image("a", 1, 0, 30, json!({ "place": { "x": 25, "y": 50, "w": 50 } })),
                ],
                vec![image_asset("a_a", 16, 9), image_asset("a_b", 16, 9)],
                json!({ "canvas": { "width": W, "height": H, "workingSpace": "srgb", "background": "#336699" } }),
            ),
            &[0],
        )
        .picture("a", 16, 9, &[RED])
        .picture("b", 16, 9, &[RED, BLUE]),
        // —— 文字与图形 ——
        generator(
            "text-plain",
            json!({ "type": "text", "text": "Hello 你好", "style": { "fontSize": 60, "color": "#FFFFFF" },
                    "place": { "x": 50, "y": 50, "w": 90, "opacity": 0.7 } }),
            &[15],
        ),
        generator(
            "text-styled",
            json!({ "type": "text", "text": "HHHH",
                    "style": { "fontSize": 60, "fontColor": "#FF0000", "background": true, "backgroundColor": "#0000FF" },
                    "place": { "x": 50, "y": 50, "w": 90 } }),
            &[15],
        ),
        generator(
            "text-typewriter",
            json!({ "type": "text", "text": "TYPE IT", "style": { "fontSize": 50 },
                    "animate": { "enter": { "preset": "typewriter", "dur": 1.5 } } }),
            &[5, 20, 60],
        ),
        generator(
            "shape-rect",
            json!({ "type": "shape", "shape": { "shape": "rect", "fill": "#FF0000", "stroke": "#FFFFFF", "strokeWidth": 12 } }),
            &[0],
        ),
        generator(
            "shape-rounded",
            json!({ "type": "shape", "shape": { "shape": "rect", "fill": "#00FF00", "cornerRadius": [150, 40, 150, 0] } }),
            &[0],
        ),
        generator(
            "shape-ellipse",
            json!({ "type": "shape", "shape": { "shape": "ellipse", "fill": "#0000FF" }, "place": { "w": 60, "rot": 30 } }),
            &[0],
        ),
        // —— fx ——
        pip("fx-colour", json!({ "fx": { "saturation": -1, "temperature": 1 } }), &[15]),
        pip(
            "fx-adjust",
            json!({ "fx": { "grayscale": 0.3, "brightness": -0.2, "exposure": 0.3, "contrast": 0.4, "hue": 0.25 },
                    "place": { "w": 50, "opacity": 0.5 } }),
            &[15],
        ),
        pip(
            "fx-presets",
            json!({ "fx": { "filterPreset": "calm1", "effectPreset": "polaroid", "effectIntensity": 0.7 } }),
            &[15],
        ),
        pip(
            "fx-detail",
            json!({ "fx": { "blur": 20, "sharpen": 0.5, "noise": 0.4, "vignette": 0.6 } }),
            &[15],
        ),
        pip(
            "fx-stroke-shadow",
            json!({ "fx": {
                "stroke": { "width": 20, "color": "#00FF00" },
                "shadow": { "offsetX": 40, "offsetY": 30, "blur": 15, "color": "#FFFFFF", "opacity": 0.8 }
            }, "place": { "w": 50, "rot": 25 } }),
            &[15],
        ),
        // —— 遮罩、平铺、动画、关键帧 ——
        pip("mask-ellipse", json!({ "mask": { "shape": "ellipse", "feather": 0.3 } }), &[15]),
        pip("tile", json!({ "place": { "w": 20, "rot": 10 }, "tile": { "on": true } }), &[15]),
        pip(
            "animate-enter-exit",
            json!({ "animate": { "enter": { "preset": "fade", "dur": 1.0 }, "exit": { "preset": "pop", "dur": 0.8 } } }),
            &[3, 45, 85],
        ),
        pip(
            "animate-reveal",
            json!({ "animate": { "enter": { "preset": "wipe", "dur": 1.5 } } }),
            &[10, 25],
        ),
        pip(
            "animate-loop",
            json!({ "animate": { "loop": { "preset": "rotate" }, "enter": { "preset": "blurIn", "dur": 0.5 } } }),
            &[6, 21, 50],
        ),
    ];

    let mut keyframed = pip("keyframes", json!({}), &[0, 30, 60]);
    for (id, property, from, to) in [("kx", "x", 25.0, 75.0), ("ko", "opacity", 0.2, 1.0), ("kr", "rot", 0.0, 90.0)] {
        let binding = serde_json::from_value(json!({
            "id": id, "targetId": "a", "propertyPath": property,
            "keyframes": [{ "localFrame": 0, "value": from }, { "localFrame": 60, "value": to }]
        }))
        .unwrap();
        keyframed
            .video
            .sequences
            .get_mut("seq")
            .unwrap()
            .header
            .animation_bindings
            .push(binding);
    }
    scenes.push(keyframed);

    // —— 生成器与贴纸 ——
    scenes.extend([
        generator(
            "counter",
            json!({ "type": "text", "counter": { "mode": "countdown" }, "style": { "fontSize": 80 } }),
            &[6, 66],
        ),
        generator(
            "progress",
            json!({ "type": "progress", "progress": { "style": "normal", "mainColor": "#FFFFFF" }, "place": { "y": 90, "w": 80 } }),
            &[9, 81],
        ),
        generator(
            "visualizer-static",
            json!({ "type": "visualizer", "visualizer": { "style": "bars", "mainColor": "#FFFFFF" } }),
            &[15],
        ),
        generator(
            "confetti",
            json!({ "type": "confetti", "confetti": { "style": "pastel-fall", "seed": 7 }, "place": { "w": 100 } }),
            &[15, 30],
        ),
        generator(
            "draw",
            json!({ "type": "draw", "draw": {
                "brush": "round", "color": "#FFFFFF", "size": 8,
                "strokes": [{ "points": [[10, 50], [50, 20], [90, 50]] }, { "points": [[20, 80], [80, 80]] }]
            } }),
            &[20, 87],
        ),
        generator(
            "placeholder-empty",
            json!({ "type": "placeholder", "placeholder": { "variant": "camera" } }),
            &[15],
        ),
        generator(
            "sticker-template",
            json!({ "type": "sticker", "sticker": { "source": "template", "templateId": "heart" } }),
            &[15],
        ),
    ]);

    let mut visualizer = generator(
        "visualizer-spectrum",
        json!({ "type": "visualizer", "visualizer": { "style": "bars", "mainColor": "#FFFFFF", "minDb": -80, "maxDb": 40 } }),
        &[10, 25],
    );
    visualizer.spectra.push(("g", spectrum(30, |bin| if bin < 128 { 220 } else { 40 })));
    scenes.push(visualizer);
    scenes.push(visualizer_audio());
    scenes.push(visualizer_speaker());

    let media_item = |kind: &str, body: Value| item("m", 0, 90, with(json!({ "type": kind, "place": { "w": 50 } }), body));
    let asset = json!({ "assetRef": { "id": "a_m", "revision": "rev_1" } });
    scenes.extend([
        Scene::new(
            "placeholder-filled",
            video(
                vec![media_item(
                    "placeholder",
                    with(json!({ "placeholder": { "variant": "media" } }), asset.clone()),
                )],
                vec![image_asset("a_m", 16, 9)],
                json!({}),
            ),
            &[15],
        )
        .picture("m", 16, 9, &[GREEN, BLUE]),
        Scene::new(
            "sticker-image",
            video(
                vec![media_item(
                    "sticker",
                    with(json!({ "sticker": { "source": "asset" } }), asset.clone()),
                )],
                vec![image_asset("a_m", 10, 10)],
                json!({}),
            ),
            &[15],
        )
        .picture("m", 10, 10, &[[0, 0, 255, 255], [0, 0, 255, 0]]),
        Scene::new(
            "whiteboard",
            video(
                vec![media_item("whiteboard", with(json!({ "whiteboard": {} }), asset.clone()))],
                vec![image_asset("a_m", 32, 18)],
                json!({}),
            ),
            &[3, 40, 87],
        )
        .picture("m", 32, 18, &[WHITE, BLACK, WHITE, RED, WHITE]),
        Scene::new(
            "composition-prerender",
            video(
                vec![item(
                    "comp",
                    0,
                    30,
                    json!({
                        "type": "composition", "source": { "kind": "bundle", "assetRef": { "id": "a_bundle", "revision": "rev_1" } },
                        "prerender": { "id": "a_v", "revision": "rev_1" }, "parameterValues": {},
                        "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
                        "place": {}
                    }),
                )],
                vec![video_asset("a_v", W, H)],
                json!({}),
            ),
            &[15],
        )
        .picture("comp", W, H, &[GREEN, BLACK]),
    ]);

    let mut lottie = Scene::new(
        "sticker-lottie",
        video(
            vec![media_item(
                "sticker",
                json!({ "sticker": { "source": "asset" }, "assetRef": { "id": "a_lottie", "revision": "rev_1" } }),
            )],
            vec![lottie_asset("a_lottie")],
            json!({}),
        ),
        &[3, 18],
    );
    lottie.assets.push(("a_lottie@rev_1", LOTTIE.to_string()));
    scenes.push(lottie);

    // 换色的 Lottie 与内嵌位图的 Lottie：WASM 里同一份解码与换色。
    let mut recoloured = Scene::new(
        "sticker-lottie-recoloured",
        video(
            vec![
                item(
                    "recoloured",
                    0,
                    90,
                    json!({ "type": "sticker", "sticker": { "source": "asset", "fillOverrides": { "#FF4000": "#FF00FF" } },
                            "assetRef": { "id": "a_lottie", "revision": "rev_1" }, "place": { "x": 30, "y": 50, "w": 50 } }),
                ),
                item(
                    "bitmap",
                    1,
                    90,
                    json!({ "type": "sticker", "sticker": { "source": "asset" }, "assetRef": { "id": "a_bitmap", "revision": "rev_1" },
                            "place": { "x": 75, "y": 50, "w": 40 } }),
                ),
            ],
            vec![lottie_asset("a_lottie"), lottie_asset("a_bitmap")],
            json!({}),
        ),
        &[5, 20],
    );
    recoloured.assets.push(("a_lottie@rev_1", LOTTIE.to_string()));
    recoloured.assets.push(("a_bitmap@rev_1", LOTTIE_IMAGE.to_string()));
    scenes.push(recoloured);

    // SVG 贴纸：原色一份、按 `fillOverrides` 换色一份，都由内核从素材字节按输出的长边光栅。
    let mut svg = Scene::new(
        "sticker-svg-recoloured",
        video(
            vec![
                item(
                    "plain",
                    0,
                    90,
                    json!({ "type": "sticker", "sticker": { "source": "asset" },
                            "assetRef": { "id": "a_svg", "revision": "rev_1" }, "place": { "x": 28, "y": 50, "w": 40 } }),
                ),
                item(
                    "recoloured",
                    1,
                    90,
                    json!({ "type": "sticker", "sticker": { "source": "asset", "fillOverrides": { "#ff4000": "#00FF80" } },
                            "assetRef": { "id": "a_svg", "revision": "rev_1" }, "place": { "x": 72, "y": 50, "w": 40, "rot": 10 } }),
                ),
            ],
            vec![svg_asset("a_svg", 40, 30)],
            json!({}),
        ),
        &[10],
    );
    svg.assets.push(("a_svg@rev_1", SVG_STICKER.to_string()));
    svg.shots.push(Shot {
        width: 2 * W,
        height: 2 * H,
        ..shot(10)
    });
    scenes.push(svg);

    // GIF：图片实例的动图一直循环，贴纸按 `loop`（这里播一次停在末帧），都由内核从素材字节解、按时刻取帧。
    let mut gif = Scene::new(
        "gif-image-and-sticker",
        video(
            vec![
                image("im", 0, 0, 90, json!({ "place": { "x": 30, "y": 50, "w": 40 } })),
                item(
                    "once",
                    1,
                    90,
                    json!({ "type": "sticker", "sticker": { "source": "asset", "loop": "once" },
                            "assetRef": { "id": "a_im", "revision": "rev_1" }, "place": { "x": 75, "y": 50, "w": 30 } }),
                ),
            ],
            vec![gif_asset("a_im", 8, 8)],
            json!({}),
        ),
        // 第 4 帧（133 ms）两个都在第二帧；第 40 帧（1333 ms）图片转回来落在第三帧，贴纸停在末帧。
        &[4, 40],
    );
    gif.binary_assets.push(("a_im@rev_1", STRIPES_GIF.to_vec()));
    scenes.push(gif);

    // `.lottie` 压缩包：清单里的动画、包里的 PNG 与内嵌的 SVG 图片，WASM 里同一份解包与光栅。
    let mut archive = Scene::new(
        "sticker-dotlottie",
        video(
            vec![item(
                "archive",
                0,
                90,
                json!({ "type": "sticker", "sticker": { "source": "asset" }, "assetRef": { "id": "a_dotlottie", "revision": "rev_1" },
                        "place": { "w": 75 } }),
            )],
            vec![dotlottie_asset("a_dotlottie")],
            json!({}),
        ),
        &[0, 15],
    );
    archive.binary_assets.push(("a_dotlottie@rev_1", dotlottie_fixture()));
    scenes.push(archive);

    scenes.push(Scene::new(
        "template-layers",
        video(
            vec![],
            vec![],
            json!({
                "durationPolicy": { "kind": "fixed", "frames": 90 },
                "template": { "id": "tpl", "name": "条", "layers": [
                    { "id": "bar", "box": { "x": 0, "y": 90, "w": 100, "h": 10 }, "kind": "progress", "accent": "#FF0000", "track": "#0000FF" },
                    { "id": "logo", "box": { "x": 2, "y": 4, "w": 20, "h": 12 }, "kind": "logo", "src": "text", "text": "T", "color": "#FFFFFF", "bg": "#00FF00" }
                ] }
            }),
        ),
        &[45],
    ));

    // —— 转场 ——
    scenes.extend([
        two_sided("transition-dissolve", "dissolve", json!({})),
        two_sided("transition-wipe", "wipe", json!({})),
        two_sided("transition-slide", "slide", json!({})),
        two_sided("transition-zoom", "zoom", json!({})),
        two_sided("transition-iris", "iris", json!({})),
        two_sided("transition-dip", "dip-to-color", json!({ "color": "#00FF00" })),
        two_sided("transition-push", "push", json!({ "direction": "left" })),
    ]);
    for (name, left, right) in [
        ("transition-single-in", None, Some("top")),
        ("transition-single-out", Some("top"), None),
    ] {
        scenes.push(
            Scene::new(
                name,
                video(
                    vec![
                        full_image("under", 0, 0, 90),
                        image("top", 1, 0, 60, json!({ "place": { "w": 70, "rot": 15 } })),
                    ],
                    vec![image_asset("a_under", W, H), image_asset("a_top", W, H)],
                    json!({ "transitions": [transition("tr", left, right, "wipe", json!({}), 20)] }),
                ),
                &[10, 45],
            )
            .picture("under", W, H, &[BLUE, WHITE])
            .picture("top", W, H, &[RED, YELLOW]),
        );
    }

    // —— 字幕 ——
    for (name, variant) in [
        ("captions-reflow-feedback", 0),
        ("captions-per-sample-layout", 1),
        ("captions-blur", 2),
    ] {
        let mut style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/reflow-feedback.json")).unwrap();
        if variant == 1 {
            style["scene"]["value"]["materials"] = json!([]);
        }
        if variant == 2 {
            style["scene"]["value"]["layout"]["layoutEvaluation"] = json!("static");
            style["scene"]["value"]["layout"]["bindings"] = json!([]);
            style["scene"]["value"]["materials"].as_array_mut().unwrap().truncate(1);
        }
        let mut scene = Scene::new(
            name,
            video(vec![caption("dynamic", "doc", Some("style"), 120, &[])], vec![], json!({})),
            &[0, 3, 37, 75, 89, 91, 111],
        );
        scene.documents = vec![
            caption_doc("doc", "sequence", &[(0.0, 4.0, "One two three four")], "original"),
            style_doc("style", style),
        ];
        scenes.push(scene);
    }

    let badge = include_bytes!("../../caption-scene/tests/fixtures/badge.png").to_vec();
    let hash = format!(
        "sha256:{}",
        Sha256::digest(&badge).iter().map(|b| format!("{b:02x}")).collect::<String>()
    );
    let mut image_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/word-pop.json")).unwrap();
    let scene = &mut image_style["scene"]["value"];
    scene["speechState"]["timingPolicy"] = json!("estimated");
    scene["resources"] = json!([{"id":"badge","assetRef":{"id":"badge","revision":"rev_1"},"contentHash":hash}]);
    scene["animations"].as_array_mut().unwrap().remove(0);
    scene["nodes"][0]["style"]["paints"] = json!([
        {"id":"edge","strokeWidth":2,"paint":{"kind":"solid","color":"#000000"}},
        {"id":"gradient","paint":{"kind":"linear","from":[0,0],"to":[1,1],"stops":[{"at":0,"color":"#FF0000"},{"at":1,"color":"#00FFFF"}]}}
    ]);
    scene["nodes"].as_array_mut().unwrap().push(json!({"id":"icons","type":"repeat","selectorId":"words","children":[{"id":"badge-image","type":"image","resourceId":"badge","properties":{"width":{"kind":"constant","value":12},"height":{"kind":"constant","value":8},"transform.y":{"kind":"constant","value":-12}}}]}));
    let mut asset = image_asset("badge", 2, 1);
    asset.1["revisions"]["rev_1"]["contentHash"] = json!(hash);
    let mut rich = Scene::new(
        "captions-dynamic-image-paint",
        video(vec![caption("rich", "doc", Some("style"), 120, &[])], vec![asset], json!({})),
        &[0, 2, 9, 32, 65],
    );
    rich.documents = vec![
        caption_doc("doc", "sequence", &[(0.0, 4.0, "One two three")], "original"),
        style_doc("style", image_style),
    ];
    rich.binary_assets.push(("badge@rev_1".into(), badge));
    scenes.push(rich);

    let mut dynamic_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/word-pop.json")).unwrap();
    dynamic_style["scene"]["value"]["speechState"]["timingPolicy"] = json!("estimated");
    let mut dynamic = Scene::new(
        "captions-dynamic-scene",
        video(vec![caption("cap", "doc", Some("style"), 120, &[])], vec![], json!({})),
        &[0, 2, 9, 32, 39, 65, 99, 119],
    );
    dynamic.documents = vec![
        caption_doc("doc", "sequence", &[(0.0, 4.0, "One two three four")], "original"),
        style_doc("style", dynamic_style),
    ];
    scenes.push(dynamic);
    let mut bezier_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/word-pop.json")).unwrap();
    bezier_style["scene"]["value"]["speechState"]["timingPolicy"] = json!("estimated");
    bezier_style["scene"]["value"]["requiredCapabilities"] = json!(["caption-bezier-expression/1"]);
    bezier_style["scene"]["value"]["animations"][1]["value"] = json!({
        "kind":"expression","expression":{"op":"call","function":"cubic-bezier","args":[
            {"op":"call","function":"div","args":[
                {"op":"read","path":"time.elapsedSeconds"},
                {"op":"call","function":"min","args":[
                    {"op":"read","path":"time.durationSeconds"},
                    {"op":"literal","type":"time","value":0.2}
                ]}
            ]},
            {"op":"literal","type":"scalar","value":0.2},
            {"op":"literal","type":"scalar","value":1.6},
            {"op":"literal","type":"scalar","value":0.4},
            {"op":"literal","type":"scalar","value":1.2}
        ]}
    });
    let mut bezier = Scene::new(
        "captions-dynamic-bezier-expression",
        video(vec![caption("bezier", "doc", Some("style"), 120, &[])], vec![], json!({})),
        &[0, 1, 2, 3, 5, 9, 32, 39, 65, 99],
    );
    bezier.documents = vec![
        caption_doc("doc", "sequence", &[(0.0, 4.0, "One two three four")], "original"),
        style_doc("style", bezier_style),
    ];
    scenes.push(bezier);
    let text_context_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/text-context.json")).unwrap();
    let mut text_context = Scene::new(
        "captions-text-context",
        video(vec![caption("text-context", "doc", Some("style"), 120, &[])], vec![], json!({})),
        &[0, 1, 4, 12, 20, 35, 55, 80, 100, 119],
    );
    text_context.documents = vec![
        caption_doc("doc", "sequence", &[(0.0, 4.0, "One é two three")], "original"),
        style_doc("style", text_context_style),
    ];
    scenes.push(text_context);
    let ink_context_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/ink-context.json")).unwrap();
    let mut ink_context = Scene::new(
        "captions-ink-context",
        video(vec![caption("ink-context", "doc", Some("style"), 120, &[])], vec![], json!({})),
        &[0, 1, 4, 12, 20, 35, 55, 80, 100, 119],
    );
    ink_context.documents = vec![
        caption_doc("doc", "sequence", &[(0.0, 4.0, "Ag é two three")], "original"),
        style_doc("style", ink_context_style),
    ];
    scenes.push(ink_context);
    let unit_context_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/unit-context.json")).unwrap();
    let mut unit_context = Scene::new(
        "captions-unit-context",
        video(vec![caption("unit-context", "doc", Some("style"), 120, &[])], vec![], json!({})),
        &[0, 5, 20, 35, 60, 75, 90, 105, 119],
    );
    unit_context.documents = vec![
        caption_doc("doc", "sequence", &[(0.0, 4.0, "One two three four")], "original"),
        style_doc("style", unit_context_style),
    ];
    scenes.push(unit_context);
    let soft_band_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/soft-band.json")).unwrap();
    let mut soft_band = Scene::new(
        "captions-soft-band",
        video(vec![caption("soft-band", "doc", Some("style"), 120, &[])], vec![], json!({})),
        &[0, 4, 15, 28, 45, 58, 61, 75, 98, 115, 28],
    );
    let mut soft_band_doc = caption_doc("doc", "sequence", &[(0.0, 4.0, "One two three four")], "original");
    soft_band_doc["sourceDocumentId"] = json!("speech");
    soft_band_doc["body"]["cues"][0]["words"] = json!({"first":"w0","last":"w3"});
    soft_band.documents = vec![soft_band_doc, style_doc("style", soft_band_style)];
    soft_band.speech.push(
        json!({"documentId":"speech","body":{"schema":"baocut.speech/1","clock":"sequence","timescale":1000,
        "words":[{"id":"w0","text":"One","start":0,"end":800},{"id":"w1","text":"two","start":1000,"end":1800},
                 {"id":"w2","text":"three","start":2000,"end":2800},{"id":"w3","text":"four","start":3000,"end":3800}]}}),
    );
    scenes.push(soft_band);
    for (name, style) in [
        (
            "captions-gaussian-components",
            include_str!("../../caption-scene/tests/fixtures/gaussian-axis.json"),
        ),
        (
            "captions-glow-components",
            include_str!("../../caption-scene/tests/fixtures/glow-cascade.json"),
        ),
    ] {
        let mut component = Scene::new(
            name,
            video(vec![caption("components", "doc", Some("style"), 120, &[])], vec![], json!({})),
            &[3, 15, 30, 61, 100, 15],
        );
        component.documents = vec![
            caption_doc("doc", "sequence", &[(0., 4., "One two three four")], "original"),
            style_doc("style", serde_json::from_str(style).unwrap()),
        ];
        component.shots.push(Shot {
            transparent: true,
            associated_rgba: true,
            ..shot(15)
        });
        scenes.push(component);
    }
    for (name, matrix) in [("captions-glow-tint", false), ("captions-glow-color-matrix", true)] {
        let mut style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/glow-cascade.json")).unwrap();
        let scene = &mut style["scene"]["value"];
        scene["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!("caption-glow-tint/1"));
        scene["materials"][0]["glowTint"] = json!({"kind":"keyframes","clock":{"unit":"page","origin":"start","duration":{"kind":"fixed","ticks":2000,"timescale":1000}},"keys":[{"at":0,"value":"#FF206000"},{"at":1,"value":"#2080FFFF"}],"interpolation":"linear","fill":{"before":"hold","after":"hold"}});
        if matrix {
            scene["requiredCapabilities"]
                .as_array_mut()
                .unwrap()
                .push(json!("caption-glow-color-matrix/1"));
            scene["materials"][0]["glowColorMatrix"] = json!([1., 0., 0., -0.15, 1.4, -0.2, 0.2, -0.1, 1.1]);
        }
        let mut component = Scene::new(
            name,
            video(vec![caption("colored-glow", "doc", Some("style"), 120, &[])], vec![], json!({})),
            &[3, 15, 30, 61, 100, 15],
        );
        component.documents = vec![
            caption_doc("doc", "sequence", &[(0., 4., "Glow 字幕")], "original"),
            style_doc("style", style),
        ];
        component.shots.push(Shot {
            transparent: true,
            associated_rgba: true,
            ..shot(15)
        });
        scenes.push(component);
    }
    let noise_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/noise-palette-mix.json")).unwrap();
    let mut noise = Scene::new(
        "captions-noise-palette",
        video(vec![caption("noise-palette", "doc", Some("style"), 120, &[])], vec![], json!({})),
        &[0, 3, 15, 30, 61, 100, 15],
    );
    noise.documents = vec![
        caption_doc("doc", "sequence", &[(0., 4., "Palette 字幕")], "original"),
        style_doc("style", noise_style),
    ];
    noise.binary_assets.push((
        "noise-palette@rev_1",
        include_bytes!("../../caption-scene/tests/fixtures/noise-palette.png").to_vec(),
    ));
    noise.shots.push(Shot {
        transparent: true,
        associated_rgba: true,
        ..shot(15)
    });
    scenes.push(noise);
    let mut typography = Scene::new(
        "captions-unit-font-style",
        video(vec![caption("mixed-type", "doc", Some("style"), 120, &[])], vec![], json!({})),
        &[0, 8, 20, 45, 65, 100, 8],
    );
    typography.documents = vec![
        caption_doc("doc", "sequence", &[(0., 4., "Wide AV text")], "original"),
        style_doc(
            "style",
            serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/unit-font-style.json")).unwrap(),
        ),
    ];
    typography.shots.push(Shot {
        transparent: true,
        ..shot(20)
    });
    scenes.push(typography);
    for (name, axis, zero) in [
        ("captions-gradient-smear-up", "up", false),
        ("captions-gradient-smear-down", "down", false),
        ("captions-gradient-smear-zero", "up", true),
    ] {
        let mut style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/gradient-smear.json")).unwrap();
        style["scene"]["value"]["materials"][0]["uvY"] = json!(axis);
        if zero {
            style["scene"]["value"]["materials"][0]["strength"] = json!([{"kind":"constant","value":0},{"kind":"constant","value":0}]);
        }
        let mut smear = Scene::new(
            name,
            video(vec![caption("smear", "doc", Some("style"), 120, &[])], vec![], json!({})),
            &[0, 6, 15, 60, 100, 15],
        );
        smear.documents = vec![
            caption_doc("doc", "sequence", &[(0., 4., "Flow 字幕")], "original"),
            style_doc("style", style),
        ];
        smear.shots.push(Shot {
            transparent: true,
            associated_rgba: true,
            ..shot(15)
        });
        scenes.push(smear);
    }
    // Original 2x2 indexed PNGs: PLTE+tRNS, packed 1-bit and 4-bit rows.
    // Include partial alpha, opaque color, and hidden RGB at alpha zero.
    let indexed_one = unhex(
        "89504e470d0a1a0a0000000d494844520000000200000002010300000048789f6700000006504c5445c97f0311c8fab918a1400000000274524e5365006e1952da0000000c49444154789c637060680000014400c13a7a1c560000000049454e44ae426082",
    );
    let indexed_four = unhex(
        "89504e470d0a1a0a0000000d4948445200000002000000020403000000809810170000000c504c5445ff01c8c97f031600ff08f064a21009e70000000474524e538065ff0083f224180000000c49444154789c636064500600002a002502b7ffdb0000000049454e44ae426082",
    );
    let indexed_resource = |id: &str, bytes: &[u8]| {
        json!({
            "id":id,"assetRef":{"id":id,"revision":"1"},"contentHash":format!("sha256:{}",hex(&Sha256::digest(bytes)))
        })
    };
    let scalar = |value: f64| json!({"op":"literal","type":"scalar","value":value});
    let progress = json!({"op":"read","path":"time.progress"});
    let constant = |value: f64| json!({"kind":"constant","value":value});
    let indexed_domain = json!({"x":constant(20.),"y":constant(10.),"width":constant(120.),"height":constant(70.)});
    let indexed_style = json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
        "schema":"baocut.caption-scene/1","evaluationVersion":1,
        "requiredCapabilities":["caption-render-layers/1","caption-image-sequence/1","caption-noisy-sweep/1","caption-expressions/1"],
        "layout":{"x":{"value":80,"basis":"absolute"},"y":{"value":45,"basis":"absolute"},"width":{"value":145,"basis":"absolute"}},
        "nodes":[{"id":"text","type":"text","style":{"fontFamily":"Noto Sans SC","fontSize":{"value":24,"basis":"absolute"},"fill":"#FFFFCC"}}],
        "sequences":[{"id":"indexed","premultiply":"shifted-byte","frames":[indexed_resource("indexed-one",&indexed_one),indexed_resource("indexed-four",&indexed_four)]}],
        "renderLayers":[
            {"id":"sweep","source":{"kind":"nodes","nodeIds":["text"]},"blend":"source-over","materials":[{
                "kind":"noisy-sweep","id":"mask","contextNodeId":"text","domain":indexed_domain,
                "position":{"kind":"expression","expression":{"op":"call","function":"add","args":[scalar(0.1),{"op":"call","function":"mul","args":[scalar(0.82),progress]}]}},
                "maskScale":[1.3125,1.3125],"reveal":true,"uvY":"up"
            }]},
            {"id":"indexed-plane","source":{"kind":"image-sequence","contextNodeId":"text","sequenceId":"indexed",
                "frame":{"kind":"expression","expression":{"op":"if","condition":{"op":"call","function":"lt","args":[progress,scalar(0.5)]},"then":scalar(0.),"else":scalar(1.)}},
                "domain":indexed_domain,"uvScale":[0.75,0.75],"uvOffset":[0.12,-0.06]},"blend":"screen"}
        ]
    }}});
    let mut indexed = Scene::new(
        "captions-noisy-sweep-indexed-sequence",
        video(
            vec![caption("indexed", "doc", Some("style"), 150, &[])],
            vec![],
            json!({"canvas":{"width":W,"height":H,"workingSpace":"srgb","background":"#273B59"}}),
        ),
        &[0, 6, 15, 30, 59, 60, 90, 119, 135, 60, 15],
    );
    indexed.documents = vec![
        caption_doc("doc", "sequence", &[(0., 4., "Wave 字幕")], "original"),
        style_doc("style", indexed_style),
    ];
    indexed.binary_assets.push(("indexed-one@1", indexed_one));
    indexed.binary_assets.push(("indexed-four@1", indexed_four));
    indexed.shots.push(Shot {
        width: W * 2,
        height: H * 2,
        ..shot(30)
    });
    indexed.shots.push(Shot {
        width: W / 2,
        height: H / 2,
        ..shot(90)
    });
    indexed.shots.push(Shot {
        transparent: true,
        associated_rgba: true,
        ..shot(30)
    });
    indexed.shots.push(Shot {
        transparent: true,
        associated_rgba: true,
        ..shot(90)
    });
    scenes.push(indexed);
    let plane = |id: &str, fill: &str, x: f64| {
        json!({
            "id":id,"type":"text","style":{"fontFamily":"Noto Sans SC","fontSize":{"value":28,"basis":"absolute"},"fill":fill},
            "properties":{"transform.x":{"kind":"constant","value":x}}
        })
    };
    let layered_style = json!({"schema":"baocut.caption-scene-style/1","scene":{"kind":"inline","value":{
        "schema":"baocut.caption-scene/1","evaluationVersion":1,"requiredCapabilities":["caption-render-layers/1"],
        "layout":{"x":{"value":80,"basis":"absolute"},"y":{"value":45,"basis":"absolute"},"width":{"value":150,"basis":"absolute"}},
        "nodes":[plane("base","#2266EE80",-8.),plane("middle","#44CC7740",0.),plane("light","#FF330060",8.)],
        "renderLayers":[
            {"id":"first","source":{"kind":"nodes","nodeIds":["base"]},"blend":"source-over"},
            {"id":"second","source":{"kind":"nodes","nodeIds":["middle"]},"blend":"source-over"},
            {"id":"third","source":{"kind":"nodes","nodeIds":["light"]},"blend":"screen"}
        ]
    }}});
    let mut layered = Scene::new(
        "captions-ordered-associated-screen",
        video(
            vec![caption("ordered", "doc", Some("style"), 120, &[])],
            vec![],
            json!({"canvas":{"width":W,"height":H,"workingSpace":"srgb","background":"#334D66"}}),
        ),
        &[0, 6, 15, 45, 75, 110, 15],
    );
    layered.documents = vec![
        caption_doc("doc", "sequence", &[(0., 3., "H 字幕")], "original"),
        style_doc("style", layered_style),
    ];
    layered.shots.push(Shot {
        transparent: true,
        associated_rgba: true,
        ..shot(15)
    });
    layered.shots.push(Shot {
        width: W * 2,
        height: H * 2,
        ..shot(45)
    });
    scenes.push(layered);
    for (name, zero_angle) in [("captions-angular-sample-blend", false), ("captions-angular-zero-angle", true)] {
        let mut style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/angular-sample-blend.json")).unwrap();
        if zero_angle {
            style["scene"]["value"]["materials"][0]["angle"] = json!({"kind":"constant","value":0});
        }
        let mut angular = Scene::new(
            name,
            video(vec![caption("angular", "doc", Some("style"), 120, &[])], vec![], json!({})),
            &[0, 6, 15, 60, 100, 15],
        );
        angular.documents = vec![
            caption_doc("doc", "sequence", &[(0., 4., "Arc 字幕")], "original"),
            style_doc("style", style),
        ];
        angular.shots.push(Shot {
            transparent: true,
            associated_rgba: true,
            ..shot(15)
        });
        scenes.push(angular);
    }
    for (name, style) in [
        (
            "captions-page-envelope",
            include_str!("../../caption-scene/tests/fixtures/page-envelope.json"),
        ),
        (
            "captions-page-envelope-whitespace",
            include_str!("../../caption-scene/tests/fixtures/page-envelope-whitespace.json"),
        ),
    ] {
        let mut component = Scene::new(
            name,
            video(vec![caption("page-envelope", "doc", Some("style"), 120, &[])], vec![], json!({})),
            &[0, 8, 15, 30, 50, 75, 95, 115, 15],
        );
        let mut doc = caption_doc("doc", "sequence", &[(0., 4., "One two three four five")], "original");
        doc["sourceDocumentId"] = json!("speech");
        doc["body"]["cues"][0]["words"] = json!({"first":"w0","last":"w4"});
        component.documents = vec![doc, style_doc("style", serde_json::from_str(style).unwrap())];
        let words: Vec<Value> = ["One", "two", "three", "four", "five"]
            .iter()
            .enumerate()
            .map(|(i, text)| json!({"id":format!("w{i}"),"text":text,"start":i*800,"end":(i+1)*800}))
            .collect();
        component
            .speech
            .push(json!({"documentId":"speech","body":{"schema":"baocut.speech/1","clock":"sequence","timescale":1000,"words":words}}));
        scenes.push(component);
    }
    for (name, boundary) in [
        ("captions-page-window-closed", "first-start-inclusive-end-inclusive"),
        ("captions-page-window-half-open", "start-inclusive-end-exclusive"),
    ] {
        let mut style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/page-window.json")).unwrap();
        style["scene"]["value"]["layout"]["pageWindow"]["boundary"] = json!(boundary);
        let mut window = Scene::new(
            name,
            video(vec![caption("page-window", "doc", Some("style"), 120, &[])], vec![], json!({})),
            &[15, 0, 3, 14, 16, 37, 38, 58, 59, 75, 76, 119, 16],
        );
        let mut doc = caption_doc("doc", "sequence", &[(0., 4., "One two three")], "original");
        doc["sourceDocumentId"] = json!("speech");
        doc["body"]["cues"][0]["words"] = json!({"first":"w0","last":"w2"});
        window.documents = vec![doc, style_doc("style", style)];
        window.speech.push(
            json!({"documentId":"speech","body":{"schema":"baocut.speech/1","clock":"sequence","timescale":1000,
            "words":[{"id":"w0","text":"One","start":100,"end":300},
                {"id":"w1","text":"two","start":700,"end":900},
                {"id":"w2","text":"three","start":2300,"end":2500}]}}),
        );
        scenes.push(window);
    }
    for (name, feedback) in [("captions-bound-label", false), ("captions-bound-label-feedback", true)] {
        let mut style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/bound-label.json")).unwrap();
        if feedback {
            style["scene"]["value"]["requiredCapabilities"]
                .as_array_mut()
                .unwrap()
                .push(json!("caption-feedback/1"));
            style["scene"]["value"]["materials"] =
                json!([{"kind":"feedback","id":"label-trail","samples":2,"step":{"ticks":1,"timescale":10},"decay":0.5,"offset":[2,0]}]);
        }
        let mut label = Scene::new(
            name,
            video(vec![caption("bound-label", "doc", Some("style"), 120, &[])], vec![], json!({})),
            &[3, 18, 36, 63, 93, 3],
        );
        let mut doc = caption_doc("doc", "sequence", &[(0.0, 4.0, "One two three four")], "original");
        doc["sourceDocumentId"] = json!("speech");
        doc["body"]["cues"][0]["words"] = json!({"first":"w0","last":"w3"});
        label.documents = vec![doc, style_doc("style", style)];
        label.speech.push(
            json!({"documentId":"speech","body":{"schema":"baocut.speech/1","clock":"sequence","timescale":1000,
            "words":[{"id":"w0","text":"One","start":0,"end":800},{"id":"w1","text":"two","start":1000,"end":1800},
            {"id":"w2","text":"three","start":2000,"end":2800},{"id":"w3","text":"four","start":3000,"end":3800}]}}),
        );
        scenes.push(label);
    }
    let cue_word_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/cue-word-context.json")).unwrap();
    let mut cue_word = Scene::new(
        "captions-cue-word-context",
        video(vec![caption("cue-word-context", "doc", Some("style"), 120, &[])], vec![], json!({})),
        &[0, 4, 15, 25, 36, 55, 76, 98, 115, 25],
    );
    let mut cue_word_doc = caption_doc("doc", "sequence", &[(0.0, 4.0, "One two three four")], "original");
    cue_word_doc["sourceDocumentId"] = json!("speech");
    cue_word_doc["body"]["cues"][0]["words"] = json!({"first":"w0","last":"w3"});
    cue_word.documents = vec![cue_word_doc, style_doc("style", cue_word_style)];
    cue_word.speech.push(
        json!({"documentId":"speech","body":{"schema":"baocut.speech/1","clock":"sequence","timescale":1000,
        "words":[{"id":"w0","text":"One","start":0,"end":400},{"id":"w1","text":"two","start":1200,"end":1450},
                 {"id":"w2","text":"three","start":1700,"end":2450},{"id":"w3","text":"four","start":3200,"end":3800}]}}),
    );
    scenes.push(cue_word);
    let first_page_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/first-page-context.json")).unwrap();
    let mut first_page = Scene::new(
        "captions-first-page-context",
        video(
            vec![caption("first-page-context", "doc", Some("style"), 120, &[])],
            vec![],
            json!({}),
        ),
        &[0, 4, 15, 28, 40, 60, 80, 100, 115, 28],
    );
    let mut first_page_doc = caption_doc("doc", "sequence", &[(0.0, 4.0, "One two three four")], "original");
    first_page_doc["sourceDocumentId"] = json!("speech");
    first_page_doc["body"]["cues"][0]["words"] = json!({"first":"w0","last":"w3"});
    first_page.documents = vec![first_page_doc, style_doc("style", first_page_style)];
    first_page.speech.push(
        json!({"documentId":"speech","body":{"schema":"baocut.speech/1","clock":"sequence","timescale":1000,
        "words":[{"id":"w0","text":"One","start":0,"end":400},{"id":"w1","text":"two","start":900,"end":1300},
                 {"id":"w2","text":"three","start":2100,"end":2450},{"id":"w3","text":"four","start":3000,"end":3500}]}}),
    );
    scenes.push(first_page);
    let cue_unit_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/cue-unit-context.json")).unwrap();
    let mut cue_unit_item = caption("cue-unit-context", "doc", Some("style"), 180, &[]);
    cue_unit_item["presentation"] = json!({"wordTags":{"w1":["keyword"],"w4":["keyword"],"w5":["keyword"]}});
    let mut cue_unit = Scene::new(
        "captions-cue-unit-context",
        video(vec![cue_unit_item], vec![], json!({})),
        &[0, 10, 35, 59, 65, 90, 119, 125, 150, 179, 35],
    );
    let mut cue_unit_doc = caption_doc("doc", "sequence", &[(0.0, 6.0, "One two three four five six")], "original");
    cue_unit_doc["sourceDocumentId"] = json!("speech");
    cue_unit_doc["body"]["cues"][0]["words"] = json!({"first":"w0","last":"w5"});
    cue_unit.documents = vec![cue_unit_doc, style_doc("style", cue_unit_style)];
    cue_unit.speech.push(
        json!({"documentId":"speech","body":{"schema":"baocut.speech/1","clock":"sequence","timescale":1000,
        "words":[{"id":"w0","text":"One","start":0,"end":700},{"id":"w1","text":"two","start":1000,"end":1700},
                 {"id":"w2","text":"three","start":2000,"end":2700},{"id":"w3","text":"four","start":3000,"end":3700},
                 {"id":"w4","text":"five","start":4000,"end":4700},{"id":"w5","text":"six","start":5000,"end":5700}]}}),
    );
    scenes.push(cue_unit);
    let wave_material_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/wave-displace.json")).unwrap();
    let mut wave_material = Scene::new(
        "captions-wave-displace-material",
        video(vec![caption("wave-material", "doc", Some("style"), 120, &[])], vec![], json!({})),
        &[0, 1, 4, 12, 35, 80, 119, 7, 35, 0],
    );
    wave_material.documents = vec![
        caption_doc("doc", "sequence", &[(0.0, 4.0, "Ripple over pixels")], "original"),
        style_doc("style", wave_material_style),
    ];
    scenes.push(wave_material);
    let permutation_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/permutation.json")).unwrap();
    let mut permutation = Scene::new(
        "captions-permutation",
        video(vec![caption("permutation", "doc", Some("style"), 120, &[])], vec![], json!({})),
        &[12, 0, 1, 30, 65, 100, 119, 30, 12],
    );
    permutation.documents = vec![
        caption_doc("doc", "sequence", &[(0.0, 4.0, "Shuffle é rhythm")], "original"),
        style_doc("style", permutation_style),
    ];
    scenes.push(permutation);
    let word_line_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/word-line-layout.json")).unwrap();
    let mut word_line = Scene::new(
        "captions-word-line-layout",
        video(vec![caption("word-line", "doc", Some("style"), 120, &[])], vec![], json!({})),
        &[0, 15, 45, 50, 82, 103, 119, 15],
    );
    word_line.documents = vec![
        caption_doc("doc", "sequence", &[(0.0, 4.0, "A  B C D E\nF G H I J K L M")], "original"),
        style_doc("style", word_line_style),
    ];
    scenes.push(word_line);
    for (name, unit) in [
        ("captions-text-lines-scalar", "unicode-scalar"),
        ("captions-text-lines-grapheme", "grapheme"),
    ] {
        let mut style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/text-line-layout.json")).unwrap();
        style["scene"]["value"]["layout"]["pagination"]["textLinePattern"]["unit"] = json!(unit);
        let mut counted = Scene::new(
            name,
            video(vec![caption("counted", "doc", Some("style"), 120, &[])], vec![], json!({})),
            &[0, 15, 45, 82, 103, 119, 15],
        );
        counted.documents = vec![
            caption_doc("doc", "sequence", &[(0.0, 4.0, "é é é AB CD\nEF LONGWORD I J")], "original"),
            style_doc("style", style),
        ];
        scenes.push(counted);
    }
    let mut cluster_style: Value =
        serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/scalar-cluster-layout.json")).unwrap();
    cluster_style["scene"]["value"]["layout"]["pagination"]["textLinePattern"]["clusterRules"] = json!({
        "attachments":[{"next":[[120,120]]}], "consumeFollowingAfter":[[82,82]], "joiners":[98]
    });
    let mut cluster = Scene::new(
        "captions-scalar-cluster-lines",
        video(vec![caption("cluster", "doc", Some("style"), 120, &[])], vec![], json!({})),
        &[0, 15, 45, 82, 103, 119, 15],
    );
    cluster.documents = vec![
        caption_doc("doc", "sequence", &[(0.0, 4.0, "Axxx AbC D E RQ FG LONGWORD HI")], "original"),
        style_doc("style", cluster_style),
    ];
    scenes.push(cluster);
    let envelope_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/glyph-envelope.json")).unwrap();
    let mut envelope = Scene::new(
        "captions-glyph-envelope",
        video(vec![caption("envelope", "doc", Some("style"), 120, &[])], vec![], json!({})),
        &[0, 15, 45, 82, 103, 119, 15],
    );
    envelope.documents = vec![
        caption_doc("doc", "sequence", &[(0.0, 4.0, "HÉLLO   ffi\nAg é j")], "original"),
        style_doc("style", envelope_style),
    ];
    scenes.push(envelope);
    for (name, feedback) in [("captions-unit-font-size", false), ("captions-unit-font-size-feedback", true)] {
        let mut style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/unit-font-size.json")).unwrap();
        if feedback {
            style["scene"]["value"]["materials"] = json!([{
                "kind":"feedback", "id":"font-trail", "samples":3,
                "step":{"ticks":100,"timescale":1000}, "decay":0.6, "offset":[-4,0]
            }]);
        }
        let mut sized = Scene::new(
            name,
            video(vec![caption("unit-font", "doc", Some("style"), 120, &[])], vec![], json!({})),
            &[3, 15, 28, 45, 63, 82, 103, 119, 15, 3],
        );
        sized.documents = vec![
            caption_doc("doc", "sequence", &[(0.0, 4.0, "Aé   office ffi BIG tiny End")], "original"),
            style_doc("style", style),
        ];
        scenes.push(sized);
    }
    let mut wave_style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/word-pop.json")).unwrap();
    let wave_scene = &mut wave_style["scene"]["value"];
    wave_scene["speechState"]["timingPolicy"] = json!("estimated");
    wave_scene["selectors"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"letters","nodeId":"caption","unit":"grapheme"}));
    wave_scene["animations"].as_array_mut().unwrap().push(json!({
        "id":"wave","target":{"nodeId":"caption","selectorId":"letters"},"property":"transform.y","composite":"add",
        "value":{"kind":"expression","expression":{"op":"call","function":"mul","args":[
            {"op":"literal","type":"length","value":4},
            {"op":"call","function":"sin","args":[{"op":"call","function":"add","args":[
                {"op":"call","function":"phase","args":[{"op":"read","path":"time.seconds"},{"op":"literal","type":"scalar","value":2}]},
                {"op":"call","function":"mul","args":[{"op":"read","path":"unit.index"},{"op":"literal","type":"angle","value":0.8}]}
            ]}]}
        ]}}
    }));
    let mut wave = Scene::new(
        "captions-dynamic-wave",
        video(vec![caption("wave", "doc", Some("style"), 120, &[])], vec![], json!({})),
        &[1, 3, 8, 19, 35],
    );
    wave.documents = vec![
        caption_doc("doc", "sequence", &[(0.0, 4.0, "Wave é office")], "original"),
        style_doc("style", wave_style),
    ];
    scenes.push(wave);

    let mut studio = Scene::new(
        "captions-studio",
        video(vec![caption("cap", "doc", Some("style"), 240, &[])], vec![], json!({})),
        &[45, 75],
    );
    studio.documents = vec![
        caption_doc("doc", "sequence", &[(1.0, 2.0, "AB 字幕"), (2.0, 3.0, "Next line")], "original"),
        style_doc(
            "style",
            json!({ "schema": STUDIO, "style": { "fontSize": 100, "displayTiming": { "leadIn": 0.5, "tail": 1.0 } } }),
        ),
    ];
    studio.shots.push(Shot {
        captions: false,
        ..shot(45)
    });
    scenes.push(studio);

    let mut bilingual = Scene::new(
        "captions-bilingual",
        video(
            vec![
                caption("a", "orig", Some("style"), 60, &[]),
                caption("b", "trans", Some("style"), 60, &[]),
            ],
            vec![],
            json!({}),
        ),
        &[30],
    );
    bilingual.documents = vec![
        caption_doc("orig", "sequence", &[(0.0, 2.0, "AB")], "original"),
        caption_doc("trans", "sequence", &[(0.0, 2.0, "一二")], "translation"),
        style_doc(
            "style",
            json!({ "schema": STUDIO, "style": {
                "y": 50, "order": "trans", "fontSize": 90, "anim": { "name": "None" },
                "origStyle": { "fontColor": "#FFFFFF" }, "transStyle": { "fontColor": "#FF0000" }
            } }),
        ),
    ];
    scenes.push(bilingual);

    let mut source_clock = Scene::new(
        "captions-source-clock",
        video(
            vec![
                video_item(
                    "clip",
                    "a_clip",
                    0,
                    60,
                    json!({ "timeMap": { "kind": "linear", "sourceIn": { "ticks": "10", "timescale": 1 }, "rate": { "num": 1, "den": 1 } } }),
                ),
                caption("cap", "doc", Some("style"), 60, &["clip"]),
            ],
            vec![video_asset("a_clip", 16, 9)],
            json!({}),
        ),
        &[15],
    )
    .picture("clip", 16, 9, &[BLUE]);
    source_clock.documents = vec![
        caption_doc("doc", "source-asset", &[(10.0, 11.0, "AB")], "original"),
        style_doc(
            "style",
            json!({ "schema": STUDIO, "style": { "fontSize": 120, "anim": { "name": "None" } } }),
        ),
    ];
    scenes.push(source_clock);

    // 字幕的词来自转写（文档头的 `sourceDocumentId`）：没有空格的中文逐字变色，剪掉的字（源 10.5–11.0 的「的」）与
    // 隐藏的字（「再」）不画。导出把转写冻结进 `documents`，预览经 `bc_set_speech` 送同一份。
    let clip_from = |id: &str, from: i64, frames: i64, source_ms: i64| {
        video_item(
            id,
            "a_clip",
            from,
            frames,
            json!({ "timeMap": { "kind": "linear", "sourceIn": { "ticks": source_ms.to_string(), "timescale": 1000 },
                                 "rate": { "num": 1, "den": 1 } } }),
        )
    };
    let mut words = Scene::new(
        "captions-transcript-words",
        video(
            vec![
                clip_from("left", 0, 15, 10_000),
                clip_from("right", 15, 45, 11_000),
                caption("cap", "doc", Some("style"), 60, &["left", "right"]),
            ],
            vec![video_asset("a_clip", 16, 9)],
            json!({}),
        ),
        &[4, 20, 35, 50],
    )
    .picture("left", 16, 9, &[BLUE])
    .picture("right", 16, 9, &[BLUE]);
    words.documents = vec![
        json!({
            "documentId": "doc", "kind": "caption", "schema": "baocut.caption/1", "lineKind": "original",
            "sourceDocumentId": "doc_speech", "sourceAssetId": "a_clip",
            "body": { "schema": "baocut.caption/1", "clock": "source-asset", "timescale": 1000,
                      "cues": [{ "id": "q-w1", "start": 10_000, "end": 13_000, "text": "真的别再说了",
                                 "words": { "first": "w1", "last": "w5" } }] }
        }),
        style_doc(
            "style",
            json!({ "schema": STUDIO, "style": { "fontSize": 90, "anim": { "name": "Color" }, "displayTiming": { "leadIn": 0, "tail": 0 } } }),
        ),
    ];
    let word = |id: &str, text: &str, start: i64, end: i64| json!({ "id": id, "text": text, "start": start, "end": end });
    let mut hidden = word("w4", "再", 11_500, 12_000);
    hidden["hidden"] = json!(true);
    words.speech.push(json!({
        "documentId": "doc_speech", "sourceAssetId": "a_clip",
        "body": { "schema": "baocut.speech/1", "clock": "source-asset", "timescale": 1000,
                  "words": [word("w1", "真", 10_000, 10_500), word("w2", "的", 10_500, 11_000), word("w3", "别", 11_000, 11_500),
                            hidden, word("w5", "说了", 12_000, 13_000)] }
    }));
    scenes.push(words);

    // 设计字幕的强调按转写的词 ID（写在多字词上的落到拆出来的每个字上），底部模板横条把字幕抬上去。
    let mut emphasis = Scene::new(
        "captions-emphasis-template",
        video(
            vec![
                clip_from("clip", 0, 60, 10_000),
                caption("cap", "doc", Some("style"), 60, &["clip"]),
            ],
            vec![video_asset("a_clip", 16, 9)],
            json!({ "template": { "id": "tpl", "name": "条", "layers": [
                { "id": "bar", "box": { "x": 0, "y": 85, "w": 100, "h": 15 }, "kind": "progress", "accent": "#FF0000", "track": "#0000FF" }
            ] } }),
        ),
        &[8, 40],
    )
    .picture("clip", 16, 9, &[BLUE]);
    emphasis.documents = vec![
        json!({
            "documentId": "doc", "kind": "caption", "schema": "baocut.caption/1", "lineKind": "original",
            "sourceDocumentId": "doc_speech", "sourceAssetId": "a_clip",
            "body": { "schema": "baocut.caption/1", "clock": "source-asset", "timescale": 1000,
                      "cues": [{ "id": "q-w1", "start": 10_000, "end": 12_000, "text": "真的说了",
                                 "words": { "first": "w1", "last": "w3" } }] }
        }),
        style_doc(
            "style",
            json!({ "schema": STUDIO, "style": {
                "fontSize": 90, "verticalAlign": "bottom", "displayTiming": { "leadIn": 0, "tail": 0 },
                "wordAnimation": { "caption": { "schema": 1, "style": { "id": "caption-highlight", "version": 1 }, "content": "orig",
                                                "palette": { "primary": "#FFFFFF", "accent": "#00FF66" } } },
                "captionEmphasis": { "w3": { "anchorText": "说了", "role": "hero", "color": "#FF00AA" } },
            } }),
        ),
    ];
    emphasis.speech.push(json!({
        "documentId": "doc_speech", "sourceAssetId": "a_clip",
        "body": { "schema": "baocut.speech/1", "clock": "source-asset", "timescale": 1000,
                  "words": [word("w1", "真", 10_000, 10_500), word("w2", "的", 10_500, 11_000), word("w3", "说了", 11_000, 12_000)] }
    }));
    scenes.push(emphasis);

    let mut boxed = Scene::new(
        "captions-boxed",
        video(vec![caption("cap", "doc", Some("style"), 60, &[])], vec![], json!({})),
        &[15],
    );
    boxed.documents = vec![
        caption_doc("doc", "sequence", &[(0.0, 1.0, "Boxed 字幕 line")], "original"),
        style_doc(
            "style",
            json!({
                "schema": "baocut.boxed-caption-style/1",
                "canvas": { "width": 320, "height": 180 },
                "box": { "x": 0, "y": -60, "width": 240, "height": 40 },
                "style": { "fontSize": 24, "color": "#00FF00", "verticalAlign": "top", "backgroundColor": "#0000FF", "textPadding": 8 },
            }),
        ),
    ];
    scenes.push(boxed);

    // 定位框样式的左右对齐：各行在折行宽度里对齐，贴框的左边与右边（两行，看得出每一行各自对齐）。
    for (name, side) in [("captions-boxed-left", "left"), ("captions-boxed-right", "right")] {
        let mut aligned = Scene::new(
            name,
            video(vec![caption("cap", "doc", Some("style"), 60, &[])], vec![], json!({})),
            &[15],
        );
        aligned.documents = vec![
            caption_doc("doc", "sequence", &[(0.0, 1.0, "Boxed 字幕 line that wraps")], "original"),
            style_doc(
                "style",
                json!({
                    "schema": "baocut.boxed-caption-style/1",
                    "canvas": { "width": 320, "height": 180 },
                    "box": { "x": 0, "y": 40, "width": 200, "height": 60 },
                    "style": { "fontSize": 20, "color": "#FFFF00", "verticalAlign": "center", "textAlign": side,
                               "backgroundColor": "#0000FF", "textPadding": 6 },
                }),
            ),
        ];
        scenes.push(aligned);
    }

    // 定位框样式的逐字显现：三个一样长的词各占一秒，起点、念到第一个、刚念到第二个、念到第三个各取一帧。
    let mut reveal = Scene::new(
        "captions-boxed-reveal",
        video(vec![caption("cap", "doc", Some("style"), 90, &[])], vec![], json!({})),
        &[0, 15, 31, 75],
    );
    reveal.documents = vec![
        caption_doc("doc", "sequence", &[(0.0, 3.0, "AA BB CC")], "original"),
        style_doc(
            "style",
            json!({
                "schema": "baocut.boxed-caption-style/18",
                "canvas": { "width": 320, "height": 180 },
                "box": { "x": 0, "y": 0, "width": 300, "height": 60 },
                "style": { "fontSize": 24, "color": "#00FF00", "verticalAlign": "center", "backgroundColor": "#0000FF",
                           "textPadding": 8, "animationPresetId": "reveal" },
            }),
        ),
    ];
    scenes.push(reveal);

    // —— 输出缩放与不铺背景 ——
    let mut scaled = pip(
        "output-scaled-transparent",
        json!({ "place": { "x": 70, "y": 40, "w": 50, "rot": 15 }, "fx": { "shadow": { "offsetX": 20, "offsetY": 20, "blur": 10, "color": "#000000", "opacity": 0.6 } } }),
        &[],
    );
    scaled.shots = vec![
        Shot {
            width: 2 * W,
            height: 2 * H,
            ..shot(15)
        },
        Shot {
            width: 96,
            height: 54,
            ..shot(15)
        },
        Shot {
            transparent: true,
            ..shot(15)
        },
    ];
    scenes.push(scaled);
    let mut envelope = visualizer_audio();
    envelope.name = "visualizer-audio-envelope";
    for item in &mut envelope.video.sequences.values_mut().next().unwrap().items {
        if let video_model::TimelineItem::Visualizer(viz) = item {
            viz.visualizer.style = "audio_envelope".into();
            viz.visualizer.main_color = Some("#7FE0CF".into());
            viz.visualizer.secondary_color = Some("#54616B".into());
        }
    }
    scenes.push(envelope);
    scenes
}

/// 声波听这条序列的混音：两段声音（一段淡入、一段压低音量）在不同的轨上叠着放，素材频谱各自随源时间变。
fn visualizer_audio() -> Scene {
    let track = |id: &str, order: i64, kind: &str| {
        json!({ "id": id, "order": order, "kind": kind, "locked": false, "visible": true, "muted": false,
                "solo": { "enabled": false, "group": if kind == "audio" { "audio" } else { "visual" } } })
    };
    let sound = |id: &str, track: &str, asset: &str, from: i64, seconds: i64, mix: Value| {
        json!({
            "id": id, "trackId": track, "enabled": true, "locked": false, "paintOrder": 0,
            "followPolicy": { "kind": "sequence-fixed" },
            "type": "audio", "assetRef": { "id": asset, "revision": "rev_1" }, "fromFrame": from, "subframeOffset": { "ticks": "0", "timescale": 1 },
            "playDuration": { "ticks": seconds.to_string(), "timescale": 1 },
            "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
            "mix": mix
        })
    };
    let viz = item(
        "g",
        0,
        90,
        json!({ "type": "visualizer", "place": { "w": 60 },
                "visualizer": { "style": "bars", "mainColor": "#FFFFFF", "minDb": -80, "maxDb": 40 } }),
    );
    let items = vec![
        viz,
        sound(
            "low",
            "trk_a1",
            "a_low",
            6,
            2,
            json!({ "volume": 1, "fadeIn": { "ticks": "1", "timescale": 2 } }),
        ),
        sound("high", "trk_a2", "a_high", 30, 2, json!({ "volume": 0.3 })),
    ];
    let video = video(
        items,
        vec![audio_asset("a_low"), audio_asset("a_high")],
        json!({ "tracks": [track("trk_v1", 0, "visual"), track("trk_a1", 0, "audio"), track("trk_a2", 1, "audio")] }),
    );
    let mut scene = Scene::new("visualizer-audio", video, &[12, 40, 75, 3]);
    // 低频那份随源时间渐强，高频那份一直响。
    scene.audio_spectra.push((
        "a_low@rev_1",
        spectrum_by_frame(120, |frame, bin| if bin < 96 { (100 + frame) as u8 } else { 0 }),
    ));
    scene
        .audio_spectra
        .push(("a_high@rev_1", spectrum(120, |bin| if (200..320).contains(&bin) { 210 } else { 0 })));
    scene
}

/// 同一段混音，声波只听 spk_a（`alwaysShow: false`）：spk_a 在 [0.2, 0.8) 与 [2.2, 2.8) 秒说话，spk_b 在 [1.2, 2.0)。
/// 第 30 帧（1 秒）是 spk_a 停下不到 0.5 秒，画静止的样子；第 40 帧已经隐去；第 75 帧 spk_a 又在说。
fn visualizer_speaker() -> Scene {
    let mut scene = visualizer_audio();
    scene.name = "visualizer-speaker";
    for item in scene.video.sequences.values_mut().flat_map(|s| s.items.iter_mut()) {
        if let TimelineItem::Visualizer(viz) = item {
            viz.visualizer.speaker = Some("spk_a".into());
            viz.visualizer.always_show = Some(false);
        }
    }
    scene.shots = shots(&[75, 12, 30, 40]);
    let word =
        |id: &str, start: i64, end: i64, speaker: &str| json!({ "id": id, "text": id, "start": start, "end": end, "speaker": speaker });
    scene.speech.push(json!({
        "documentId": "doc_speech",
        "body": { "schema": "baocut.speech/1", "clock": "sequence", "timescale": 1000,
                  "words": [word("w1", 200, 800, "spk_a"), word("w2", 1200, 2000, "spk_b"), word("w3", 2200, 2800, "spk_a")] }
    }));
    scene
}

/// 夹具里的转写求出各说话人的区间（与预览 WASM 的 `bc_set_speech` 同一个求法）；一份都没有时是 `None`。
fn speakers_of(video: &VideoSnapshot, speech: &[Value]) -> Option<Arc<frame_render::SpeakerActivity>> {
    if speech.is_empty() {
        return None;
    }
    let records: Vec<DocumentRecord> = speech
        .iter()
        .map(|s| DocumentRecord {
            id: s["documentId"].as_str().unwrap().into(),
            kind: "speech".into(),
            name: String::new(),
            language: None,
            source_asset_id: s["sourceAssetId"].as_str().map(Into::into),
            source_document_id: None,
            current_revision: String::new(),
            revisions: Default::default(),
            extensions: Default::default(),
        })
        .collect();
    let pairs: Vec<_> = records.iter().zip(speech).map(|(record, s)| (record, &s["body"])).collect();
    Some(Arc::new(speaker_activity(VideoView::from(video), "seq", &pairs).unwrap()))
}

/// 按导出的路子画一个场景的每一帧：每个场景一个渲染器（与预览一样跨帧复用缓存），帧时刻是 `帧号/30` 的有理数。
fn render_scene(scene: &Value) -> Vec<Value> {
    let video: VideoSnapshot = serde_json::from_value(scene["video"].clone()).unwrap();
    let mut documents: Vec<FrozenDocument> = serde_json::from_value(scene["documents"].clone()).unwrap();
    // 导出的计划把字幕的词所在的转写冻结在 `documents` 里；预览经 `bc_set_speech` 送同一份。
    for speech in scene.get("speech").and_then(Value::as_array).into_iter().flatten() {
        documents.push(
            serde_json::from_value(json!({
                "documentId": speech["documentId"], "kind": "speech", "schema": speech["body"]["schema"],
                "sourceAssetId": speech.get("sourceAssetId"), "body": speech["body"],
            }))
            .unwrap(),
        );
    }
    let mut media = FixtureMedia::default();
    for picture in scene["pictures"].as_array().unwrap() {
        let (w, h) = (
            picture["width"].as_u64().unwrap() as u32,
            picture["height"].as_u64().unwrap() as u32,
        );
        let bands: Vec<[u8; 4]> = serde_json::from_value(picture["bands"].clone()).unwrap();
        let pixmap = premultiplied(w, h, bands_rgba(w, h, &bands)).unwrap();
        media.pictures.insert(picture["itemId"].as_str().unwrap().into(), Arc::new(pixmap));
    }
    for asset in scene["assets"].as_array().unwrap() {
        let bytes = match asset["hex"].as_str() {
            Some(hex) => unhex(hex),
            None => asset["text"].as_str().unwrap().as_bytes().to_vec(),
        };
        media.assets.insert(asset["key"].as_str().unwrap().into(), bytes);
    }
    for spectrum in scene["spectra"].as_array().unwrap() {
        media.spectra.insert(
            spectrum["itemId"].as_str().unwrap().into(),
            unhex(spectrum["hex"].as_str().unwrap()),
        );
    }
    for spectrum in scene["audioSpectra"].as_array().unwrap() {
        media
            .audio_spectra
            .insert(spectrum["key"].as_str().unwrap().into(), unhex(spectrum["hex"].as_str().unwrap()));
    }
    let mut renderer: Option<FrameRenderer> = None;
    let speech: Vec<Value> = scene.get("speech").and_then(Value::as_array).cloned().unwrap_or_default();
    let speakers = speakers_of(&video, &speech);
    let view = VideoView::from(&video);
    scene["shots"]
        .as_array()
        .unwrap()
        .iter()
        .map(|shot| {
            let (width, height) = (shot["width"].as_u64().unwrap() as u32, shot["height"].as_u64().unwrap() as u32);
            let (captions, transparent) = (shot["captions"].as_bool().unwrap(), shot["transparent"].as_bool().unwrap());
            let renderer = renderer.get_or_insert_with(|| {
                FrameRenderer::new(
                    RenderOptions {
                        width,
                        height,
                        skip_unsupported: true,
                        captions,
                    },
                    Documents::new(documents.clone()),
                    fonts(),
                )
                .unwrap()
            });
            renderer.resize(width, height).unwrap();
            renderer.set_captions(captions);
            renderer.set_transparent(transparent);
            renderer.set_speakers(speakers.clone());
            renderer.clear_reports();
            let t = Ratio::new(i128::from(shot["frame"].as_i64().unwrap()), 30).unwrap();
            let plan = plan_frame(view, "seq", t).unwrap();
            let frame = renderer.render(view, &plan, t.to_f64(), &mut media).unwrap();
            let associated = shot.get("associatedRgba").and_then(Value::as_bool).unwrap_or(false);
            let bytes = if transparent && !associated {
                demultiplied(frame)
            } else {
                frame.to_vec()
            };
            let mut out = shot.clone();
            out["sha256"] = json!(hex(&Sha256::digest(&bytes)));
            out["warnings"] = json!(renderer.warnings());
            out["skipped"] = json!(renderer.skipped());
            out
        })
        .collect()
}

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/parity.json")
}

/// 按镜头分段取景（派生子视频的 `crops`）的样子：同一素材在镜头边界上拆成两段，右段的 `sourceIn` 接着左段，两段各带一份
/// 不同的 `crop`（左段取左半、右段取右半），铺满画布。帧取两段中间与接缝两侧。
fn two_piece_crop() -> Scene {
    Scene::new(
        "video-two-piece-crop",
        video(
            vec![
                video_item(
                    "v1",
                    "a_v",
                    0,
                    30,
                    json!({ "crop": { "left": 0, "top": 0, "right": 0.5, "bottom": 0 } }),
                ),
                video_item(
                    "v2",
                    "a_v",
                    30,
                    30,
                    json!({ "crop": { "left": 0.5, "top": 0, "right": 0, "bottom": 0 }, "timeMap": {
                        "kind": "linear", "sourceIn": { "ticks": "1", "timescale": 1 }, "rate": { "num": 1, "den": 1 }
                    } }),
                ),
            ],
            vec![video_asset("a_v", W, H)],
            json!({}),
        ),
        &[15, 29, 30, 45],
    )
}

/// 两段确实各用自己的裁剪：源画面左红右蓝，左段只看得到红，右段只看得到蓝，接缝那一帧就换。
#[test]
fn two_piece_crop_switches_at_the_seam() {
    let scene = two_piece_crop();
    let mut media = Media::default()
        .with("v1", halves(W, H, RED, BLUE))
        .with("v2", halves(W, H, RED, BLUE));
    for (frame, color) in [(15.0, RED), (29.0, RED), (30.0, BLUE), (45.0, BLUE)] {
        let pixels = render(&scene.video, at(frame), &mut media);
        for (x, y) in [(5, 5), (W / 2, H / 2), (W - 5, H - 5)] {
            near(px(&pixels, x, y), color, 2);
        }
    }
}

fn build_fixture() -> Value {
    let scenes: Vec<Value> = scenes()
        .into_iter()
        .map(|scene| {
            let mut value = json!({
                "name": scene.name,
                "video": serde_json::to_value(&scene.video).unwrap(),
                "documents": scene.documents,
                "pictures": scene.pictures.iter().map(|(item, w, h, bands)| json!({
                    "itemId": item, "width": w, "height": h, "bands": bands
                })).collect::<Vec<_>>(),
                "assets": scene.assets.iter().map(|(key, text)| json!({ "key": key, "text": text }))
                    .chain(scene.binary_assets.iter().map(|(key, bytes)| json!({ "key": key, "hex": hex(bytes) })))
                    .collect::<Vec<_>>(),
                "spectra": scene.spectra.iter().map(|(item, bytes)| json!({ "itemId": item, "hex": hex(bytes) })).collect::<Vec<_>>(),
                "audioSpectra": scene.audio_spectra.iter().map(|(key, bytes)| json!({ "key": key, "hex": hex(bytes) })).collect::<Vec<_>>(),
                "shots": scene.shots.iter().map(|s| {
                    let mut value=json!({"frame":s.frame,"width":s.width,"height":s.height,"captions":s.captions,"transparent":s.transparent});
                    if s.associated_rgba {value["associatedRgba"]=json!(true);}
                    value
                }).collect::<Vec<_>>(),
            });
            if !scene.speech.is_empty() {
                value["speech"] = json!(scene.speech);
            }
            value["shots"] = json!(render_scene(&value));
            value
        })
        .collect();
    json!({ "fps": 30, "sequenceId": "seq", "scenes": scenes })
}

#[test]
fn parity_fixture_is_current() {
    let fixture = build_fixture();
    // 每个场景都画了自己的东西：没有跳过的层，场景之间第一帧互不相同。
    let mut seen = BTreeMap::new();
    for scene in fixture["scenes"].as_array().unwrap() {
        for shot in scene["shots"].as_array().unwrap() {
            assert_eq!(shot["skipped"], json!([]), "{}", scene["name"]);
        }
        // 声波拿到了频谱（或这条序列确实没有声音）：不报缺频谱的提示。
        if scene["name"].as_str().unwrap().starts_with("visualizer-") {
            for shot in scene["shots"].as_array().unwrap() {
                assert_eq!(shot["warnings"], json!([]), "{}", scene["name"]);
            }
        }
        let digest = scene["shots"][0]["sha256"].as_str().unwrap().to_string();
        if let Some(other) = seen.insert(digest, scene["name"].clone()) {
            panic!("{} 与 {} 画出了同一帧", scene["name"], other);
        }
    }
    let text = serde_json::to_string_pretty(&fixture).unwrap() + "\n";
    if std::env::var_os("BAOCUT_UPDATE_PARITY").is_some() {
        std::fs::write(fixture_path(), &text).unwrap();
        return;
    }
    let stored = std::fs::read_to_string(fixture_path()).expect("没有夹具：BAOCUT_UPDATE_PARITY=1 重写");
    let stored: Value = serde_json::from_str(&stored).unwrap();
    for (now, before) in fixture["scenes"]
        .as_array()
        .unwrap()
        .iter()
        .zip(stored["scenes"].as_array().unwrap())
    {
        assert_eq!(
            now, before,
            "场景 {} 与夹具不同：画法改了就 BAOCUT_UPDATE_PARITY=1 重写",
            now["name"]
        );
    }
    assert_eq!(fixture, stored, "场景的个数或次序与夹具不同");
}
