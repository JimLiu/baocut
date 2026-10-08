//! 成片要用到的本机字体 face：范围里每个画面层排一遍字，随内核的字体里没有的族连同字重与斜体报出来；预览的渲染器
//! 记的是同一份。

mod common;

use std::sync::Arc;

use common::*;
use frame_render::{Documents, FALLBACK_FAMILY, FrozenDocument, font_census, font_usage};
use render_graph::VideoView;
use render_graph::video_plan::plan_video;
use serde_json::json;

fn caption_documents() -> Vec<FrozenDocument> {
    vec![
        serde_json::from_value(json!({
            "documentId": "doc", "kind": "caption", "schema": "baocut.caption/1", "lineKind": "original",
            "body": { "schema": "baocut.caption/1", "clock": "sequence", "timescale": 1000, "cues": [
                { "id": "c0", "start": 0, "end": 1000, "text": "AB" },
                { "id": "c1", "start": 7000, "end": 8000, "text": "CD" },
            ] }
        }))
        .unwrap(),
        serde_json::from_value(json!({
            "documentId": "style", "kind": "caption-style", "schema": "baocut.legacy-studio-style/0.1",
            "body": { "schema": "baocut.legacy-studio-style/0.1",
                      "style": { "fontSize": 60, "fontFamily": "Caption Only Sans", "anim": { "name": "None" } } }
        }))
        .unwrap(),
    ]
}

fn census_video() -> video_model::VideoSnapshot {
    let text = |id: &str, from: i64, style: serde_json::Value| {
        let mut value = item(
            id,
            1,
            30,
            json!({ "type": "text", "text": "Hello", "style": style, "place": { "x": 50, "y": 50, "w": 90 } }),
        );
        value["span"]["fromFrame"] = json!(from);
        value
    };
    let mut caption = item(
        "cap",
        0,
        300,
        json!({ "type": "caption", "documentId": "doc", "styleDocumentId": "style", "scopeItemIds": [] }),
    );
    caption["trackId"] = json!("trk_s1");
    video(
        vec![
            // 一开头就在的粗体，与很久以后才出现的细体：都要报。
            text(
                "early",
                0,
                json!({ "fontSize": 40, "fontFamily": "Nowhere Sans", "fontWeight": 700 }),
            ),
            text(
                "late",
                200,
                json!({ "fontSize": 40, "fontFamily": "Far Away Serif", "fontWeight": 300 }),
            ),
            // 随内核发布的族不报。
            text("bundled", 0, json!({ "fontSize": 40, "fontFamily": "Permanent Marker" })),
            caption,
        ],
        vec![],
        json!({}),
    )
}

#[test]
fn every_layer_in_the_range_reports_the_local_faces_it_names() {
    let video = census_video();
    let view = VideoView::from(&video);
    let overview = plan_video(view, "seq", None).unwrap();
    let frame = plan(&video, 0.0);
    let fonts: Vec<Arc<Vec<u8>>> = fonts().into_iter().map(Arc::new).collect();
    let faces = font_census(
        view,
        &frame,
        0.0,
        &overview.layers,
        Documents::new(caption_documents()),
        fonts.clone(),
        true,
    )
    .unwrap();
    assert_eq!(
        faces,
        vec![
            ("Caption Only Sans".to_string(), 400, false),
            ("Far Away Serif".to_string(), 300, false),
            ("Nowhere Sans".to_string(), 700, false),
        ]
    );
    // 不烧字幕时字幕不排。
    let faces = font_census(
        view,
        &frame,
        0.0,
        &overview.layers,
        Documents::new(caption_documents()),
        fonts,
        false,
    )
    .unwrap();
    assert!(faces.iter().all(|(family, ..)| family != "Caption Only Sans"), "{faces:?}");
}

#[test]
fn usage_lists_bundled_faces_too_and_marks_which_families_the_kernel_lacks() {
    let video = census_video();
    let view = VideoView::from(&video);
    let overview = plan_video(view, "seq", None).unwrap();
    let frame = plan(&video, 0.0);
    let fonts: Vec<Arc<Vec<u8>>> = fonts().into_iter().map(Arc::new).collect();
    let usage = font_usage(
        view,
        &frame,
        0.0,
        &overview.layers,
        Documents::new(caption_documents()),
        fonts,
        true,
    )
    .unwrap();
    assert!(
        usage.faces.contains(&("Permanent Marker".to_string(), 400, false)),
        "{:?}",
        usage.faces
    );
    assert!(usage.faces.contains(&("Nowhere Sans".to_string(), 700, false)), "{:?}", usage.faces);
    let missing: Vec<&str> = usage.missing.iter().map(String::as_str).collect();
    assert_eq!(missing, vec!["Caption Only Sans", "Far Away Serif", "Nowhere Sans"]);
    // 回退族就是随内核的 CJK 族：缺的字都由它画。
    assert_eq!(FALLBACK_FAMILY, "Noto Sans SC");
}

#[test]
fn the_preview_renderer_logs_the_same_faces_as_it_draws() {
    let video = census_video();
    let mut renderer = renderer(false, Documents::new(caption_documents()));
    render_with(&mut renderer, &video, 0.2, &mut Media::default());
    let used = renderer.used_faces();
    assert!(used.contains(&("Nowhere Sans".to_string(), 700, false)), "{used:?}");
    assert!(used.contains(&("Caption Only Sans".to_string(), 400, false)), "{used:?}");
    assert!(used.contains(&("Permanent Marker".to_string(), 400, false)), "{used:?}");
    // 后面才出现的细体，画到那一帧时记上；记录是常设的（之后的帧不排字也还在）。
    assert!(!used.iter().any(|(family, ..)| family == "Far Away Serif"));
    renderer.clear_reports();
    render_with(&mut renderer, &video, at(205.0), &mut Media::default());
    assert!(renderer.used_faces().contains(&("Far Away Serif".to_string(), 300, false)));
    renderer.clear_reports();
    render_with(&mut renderer, &video, at(206.0), &mut Media::default());
    assert!(renderer.used_faces().contains(&("Nowhere Sans".to_string(), 700, false)));
}
