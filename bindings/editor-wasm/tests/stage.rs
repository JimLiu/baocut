//! 舞台的框经 WASM 入口：草稿层（缺 `span` 等字段、属性不全）也能算，素材只传引用的那一个。

use editor_wasm::stage::{place_default, stage_box, stage_place};
use serde_json::{Value, json};

fn call(f: fn(&[u8]) -> Result<String, editor_wasm::EntryError>, input: Value) -> Value {
    serde_json::from_str(&f(input.to_string().as_bytes()).unwrap()).unwrap()
}

const CANVAS: fn() -> Value = || json!({ "width": 1920, "height": 1080 });

#[test]
fn a_pip_video_takes_its_source_aspect() {
    let request = json!({
        "item": { "type": "video", "id": "v1", "mode": "pip", "place": { "x": 25, "y": 50, "w": 30 }, "assetRef": { "id": "a", "revision": "1" } },
        "asset": { "kind": "video", "video": { "displayWidth": 1080, "displayHeight": 1920, "pixelAspectRatio": { "num": 1, "den": 1 } } },
        "canvas": CANVAS(),
    });
    let b = call(stage_box, request);
    assert_eq!(
        (b["cx"].as_f64(), b["cy"].as_f64(), b["w"].as_f64()),
        (Some(480.0), Some(540.0), Some(576.0))
    );
    assert!((b["h"].as_f64().unwrap() - 1024.0).abs() < 1e-9);
    assert_eq!((b["fullscreen"].as_bool(), b["flipX"].as_bool()), (Some(false), Some(false)));
}

#[test]
fn moving_a_box_writes_only_the_changed_fields() {
    let request = json!({
        "item": { "type": "sticker", "name": "草稿", "sticker": { "templateId": "box", "fillOverrides": { "#000000": "#ffffff" }, "draft": true } },
        "canvas": CANVAS(),
        "pose": { "cx": 480, "cy": 540, "w": 192, "h": 119.04, "rotation": 370 },
    });
    assert_eq!(call(stage_place, request), json!({ "x": 25.0, "w": 10.0, "rot": 10.0 }));
}

#[test]
fn kind_defaults_and_unreadable_input() {
    assert_eq!(
        call(place_default, json!({ "type": "visualizer" })),
        json!({ "x": 50.0, "y": 85.0, "w": 100.0 })
    );
    assert_eq!(stage_box(br#"{"item":{"type":"audio"}}"#).unwrap_err().code, "INVALID_INPUT");
}
