//! 屏幕取景的画法（格式规范 §3.18）：画面按可见区域放大、光标压在它指着的内容上，结果只看内容时间（拆分、挪动、修剪、
//! 变速之后同一内容时刻逐字节相同，随机取帧与顺序播放相同）。

mod common;

use common::*;
use frame_render::{Documents, FrozenDocument};
use serde_json::{Value, json};
use tiny_skia::Pixmap;

/// 四个象限四种颜色的源画面（与画布同大）：左上绿、右上红、左下蓝、右下白。
fn quadrants() -> Pixmap {
    let mut data = Vec::new();
    for y in 0..H {
        for x in 0..W {
            data.extend(match (x < W / 2, y < H / 2) {
                (true, true) => GREEN,
                (false, true) => RED,
                (true, false) => BLUE,
                (false, false) => WHITE,
            });
        }
    }
    frame_render::premultiplied(W, H, data).unwrap()
}

/// 4×4 的黄色光标图片（PNG）。
fn cursor_png() -> Vec<u8> {
    solid(4, 4, YELLOW).encode_png().unwrap()
}

fn manifest(mode: &str) -> Value {
    let mut pointer = json!({ "mode": mode });
    if mode == "separate" {
        pointer["cursors"] = json!([{ "id": "arrow", "assetRef": { "id": "cur", "revision": "rev_1" }, "hotspot": { "x": 0.0, "y": 0.0 } }]);
    }
    json!({
        "schema": "baocut.recording/1", "timescale": 1000, "clock": "recording", "recorder": { "name": "test" }, "duration": "10000",
        "segments": [{ "id": "s0", "t0": "0", "t1": "10000" }],
        "streams": [
            { "id": "screen", "role": "screen", "segmentId": "s0", "assetRef": { "id": "a_scr", "revision": "rev_1" }, "start": "0",
              "capture": { "kind": "display", "width": W, "height": H, "scale": 1.0 } },
            { "id": "ptr", "role": "pointer", "segmentId": "s0", "assetRef": { "id": "ptr", "revision": "rev_1" }, "start": "0" }
        ],
        "pointer": pointer
    })
}

fn documents(mode: &str, zooms: Value, extra: Value) -> Documents {
    let mut view = json!({ "schema": "baocut.screen-view/1", "timescale": 1000, "clock": "recording", "solver": 1, "zooms": zooms });
    for (k, v) in extra.as_object().unwrap() {
        view[k] = v.clone();
    }
    let doc = |id: &str, kind: &str, source: Option<&str>, body: Value| -> FrozenDocument {
        serde_json::from_value(json!({ "documentId": id, "kind": kind, "sourceDocumentId": source, "body": body })).unwrap()
    };
    Documents::new(vec![doc("rec", "recording", None, manifest(mode)), doc("view", "screen-view", Some("rec"), view)])
}

/// 指针停在 (0.1, 0.1) 直到 1 秒，1–3 秒走到 (0.9, 0.9)。
fn media(items: &[&str]) -> Media {
    let mut media = Media::default();
    for id in items {
        media = media.with(id, quadrants());
    }
    media.assets.insert(
        "ptr".into(),
        br#"{"format":"baocut-pointer-track","version":1,"timescale":1000,
           "moves":[[0,0.1,0.1],[1000,0.1,0.1],[3000,0.9,0.9]],"buttons":[[4000,0,1],[4050,0,0]],"cursors":[[0,"arrow"]]}"#
            .to_vec(),
    );
    media.assets.insert("cur".into(), cursor_png());
    media
}

fn clip(id: &str, from: i64, frames: i64, source_in_ms: i64, rate: i64) -> Value {
    video_item(
        id,
        "a_scr",
        from,
        frames,
        json!({
            "timeMap": { "kind": "linear", "sourceIn": { "ticks": source_in_ms.to_string(), "timescale": 1000 }, "rate": { "num": rate, "den": 1 } },
            "screenView": { "documentId": "view" }
        }),
    )
}

fn snapshot(items: Vec<Value>) -> video_model::VideoSnapshot {
    video(items, vec![video_asset("a_scr", W, H)], json!({}))
}

fn point_zoom(t0: u32, t1: u32, x: f64, y: f64) -> Value {
    json!([{ "id": "z", "t0": t0.to_string(), "t1": t1.to_string(), "scale": 2.0, "focus": { "kind": "point", "x": x, "y": y },
             "origin": "manual", "rampIn": "0", "rampOut": "0" }])
}

#[test]
fn a_zoom_enlarges_the_view_and_the_cursor_sits_on_what_it_points_at() {
    let video = snapshot(vec![clip("v", 0, 300, 0, 1)]);
    let mut r = renderer(false, documents("separate", point_zoom(0, 2000, 0.25, 0.25), json!({})));
    let mut m = media(&["v"]);
    // 放大 2 倍看左上象限：整个画面都是绿的。
    let zoomed = render_with(&mut r, &video, 0.5, &mut m);
    for (x, y) in [(5, 5), (80, 45), (150, 80), (60, 70)] {
        near(px(&zoomed, x, y), GREEN, 2);
    }
    // 指针在源画面的 (0.1, 0.1) = 源像素 (16, 9)；V 是左上那一块，于是它落在画面的 (32, 18)。光标是 4 像素的图片，跟着
    // 放大成 8 像素：压在 (32..40, 18..26) 上。
    near(px(&zoomed, 35, 21), YELLOW, 8);
    near(px(&zoomed, 30, 21), GREEN, 8);
    near(px(&zoomed, 35, 28), GREEN, 8);
    // 区间之外是原画面：四个象限，光标按原大小压在 (16..20, 9..13)。
    let plain = render_with(&mut r, &video, 2.5, &mut m);
    near(px(&plain, 20, 20), GREEN, 2);
    near(px(&plain, 140, 20), RED, 2);
    near(px(&plain, 20, 80), BLUE, 2);
    near(px(&plain, 140, 80), WHITE, 2);
    // 2.5 秒时指针走到 (0.7, 0.7) = (112, 63)。
    near(px(&plain, 113, 64), YELLOW, 8);
    near(px(&plain, 118, 64), WHITE, 8);
    assert!(r.skipped().is_empty());
}

#[test]
fn a_cursor_outside_the_view_and_a_baked_cursor_are_not_drawn() {
    let video = snapshot(vec![clip("v", 0, 300, 0, 1)]);
    // 看右下象限：指针 (0.1, 0.1) 在 V 外，不画；画面全白。
    let mut r = renderer(false, documents("separate", point_zoom(0, 2000, 0.75, 0.75), json!({})));
    let frame = render_with(&mut r, &video, 0.5, &mut media(&["v"]));
    assert!(inner(&frame, 2, 0).all(|p| p == WHITE), "only the white quadrant shows");
    // 光标录进了画面：照样放大，不另画光标。
    let mut baked = renderer(false, documents("baked", point_zoom(0, 2000, 0.25, 0.25), json!({})));
    let frame = render_with(&mut baked, &video, 0.5, &mut media(&["v"]));
    assert!(inner(&frame, 0, 2).all(|p| p == GREEN), "only the green quadrant shows, with no cursor");
    // 隐藏光标同样不画。
    let mut hidden = renderer(false, documents("separate", point_zoom(0, 2000, 0.25, 0.25), json!({ "pointer": { "hidden": true } })));
    let frame = render_with(&mut hidden, &video, 0.5, &mut media(&["v"]));
    assert!(inner(&frame, 0, 2).all(|p| p == GREEN));
}

/// 去掉左上 `lead`、右下 `trail` 像素宽的边之后的像素（放大时双三次取样在象限的交界处混进一点邻色）。
fn inner(frame: &[u8], lead: u32, trail: u32) -> impl Iterator<Item = [u8; 4]> + '_ {
    (lead..H - trail).flat_map(move |y| (lead..W - trail).map(move |x| px(frame, x, y)))
}

#[test]
fn a_click_ripples_around_the_pointer() {
    let video = snapshot(vec![clip("v", 0, 300, 0, 1)]);
    let docs = || documents("separate", json!([]), json!({ "pointer": { "click": { "effect": "ripple", "color": "#FF00FF" } } }));
    let with = render_with(&mut renderer(false, docs()), &video, 4.1, &mut media(&["v"]));
    let without = render_with(&mut renderer(false, documents("separate", json!([]), json!({}))), &video, 4.1, &mut media(&["v"]));
    // 4 秒按下、指针在 (0.9, 0.9) = (144, 81)：0.1 秒时提示的外圈半径约 20 × 0.44 ≈ 8.75 像素，染上了品红。
    let ring = px(&with, 144 - 9, 81);
    assert_ne!(ring, px(&without, 144 - 9, 81));
    assert!(ring[0] > 200 && ring[2] > 100 && ring[1] < 150, "{ring:?}");
    // 远处不受影响；0.4 秒之后没有了。
    assert_eq!(px(&with, 40, 20), px(&without, 40, 20));
    let later = render_with(&mut renderer(false, docs()), &video, 4.5, &mut media(&["v"]));
    let later_plain = render_with(&mut renderer(false, documents("separate", json!([]), json!({}))), &video, 4.5, &mut media(&["v"]));
    assert_eq!(later, later_plain);
}

fn follow() -> Documents {
    documents(
        "separate",
        json!([{ "id": "z", "t0": "0", "t1": "4000", "scale": 2.0, "focus": { "kind": "pointer" }, "origin": "auto" }]),
        json!({ "follow": { "smoothing": 0.5 }, "pointer": { "smoothing": 0.3 } }),
    )
}

#[test]
fn the_same_content_time_draws_the_same_frame_however_the_clip_is_edited() {
    // 内容时间 2 秒：镜头正跟着指针走，光标在动。
    let reference = render_with(&mut renderer(false, follow()), &snapshot(vec![clip("v", 0, 300, 0, 1)]), 2.0, &mut media(&["v"]));
    let cases: Vec<(&str, Vec<Value>, f64)> = vec![
        ("split", vec![clip("a", 0, 30, 0, 1), clip("b", 30, 270, 1000, 1)], 2.0),
        ("moved", vec![clip("v", 15, 300, 0, 1)], 2.5),
        ("trimmed", vec![clip("v", 0, 300, 500, 1)], 1.5),
        ("double speed", vec![clip("v", 0, 150, 0, 2)], 1.0),
    ];
    for (name, items, t) in cases {
        let ids: Vec<String> = items.iter().map(|i| i["id"].as_str().unwrap().to_string()).collect();
        let ids: Vec<&str> = ids.iter().map(String::as_str).collect();
        let frame = render_with(&mut renderer(false, follow()), &snapshot(items), t, &mut media(&ids));
        assert!(frame == reference, "{name}: the frame differs from the unedited clip");
    }
    // 与区间外的原画面不同：确实放大了。
    let plain = render_with(&mut renderer(false, follow()), &snapshot(vec![clip("v", 0, 300, 0, 1)]), 5.0, &mut media(&["v"]));
    assert!(plain != reference);
}

#[test]
fn seeking_draws_the_same_frames_as_playing_in_order() {
    let video = snapshot(vec![clip("v", 0, 300, 0, 1)]);
    let mut m = media(&["v"]);
    let mut played = renderer(false, follow());
    let forward: Vec<Vec<u8>> = (0..135).map(|f| render_with(&mut played, &video, at(f as f64), &mut m)).collect();
    for f in [120, 61, 90, 3, 45, 134, 75] {
        let mut sought = renderer(false, follow());
        assert!(render_with(&mut sought, &video, at(f as f64), &mut m) == forward[f], "frame {f}");
    }
    // 同一个渲染器倒着取也一样。
    let mut backwards = renderer(false, follow());
    for f in (0..135).rev().step_by(11) {
        assert!(render_with(&mut backwards, &video, at(f as f64), &mut m) == forward[f], "frame {f} backwards");
    }
}

#[test]
fn a_missing_pointer_track_refuses_the_export_or_draws_the_recording_as_is() {
    let video = snapshot(vec![clip("v", 0, 300, 0, 1)]);
    let mut m = media(&["v"]);
    m.assets.remove("ptr");
    let error = try_render(&mut renderer(false, documents("separate", point_zoom(0, 2000, 0.25, 0.25), json!({}))), &video, 0.5, &mut m)
        .unwrap_err();
    assert_eq!(error.code, "EXPORT_UNSUPPORTED_CONTENT");
    assert_eq!(error.items[0].reason, "screen-view-pointer-missing");
    let mut skipping = renderer(true, documents("separate", point_zoom(0, 2000, 0.25, 0.25), json!({})));
    let frame = render_with(&mut skipping, &video, 0.5, &mut m);
    near(px(&frame, 140, 20), RED, 2);
    assert_eq!(skipping.skipped()[0].reason, "screen-view-pointer-missing");
    // 指针轨到了（预览取完了）：下一帧照取景画。
    m.assets = media(&[]).assets;
    let frame = render_with(&mut skipping, &video, 0.5, &mut m);
    near(px(&frame, 140, 20), GREEN, 2);
}
