//! 成片导出的画面概览：范围里出现的层、转场的另一侧、转场与要冻结的素材与文档。

use std::path::PathBuf;

use editor_semantics::Ratio;
use render_graph::VideoView;
use render_graph::video_plan::{OutputGeometry, PictureRect, output_geometry, plan_video};
use video_model::VideoSnapshot;

fn fixture() -> VideoSnapshot {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/video.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("读夹具")).expect("夹具是完整的视频快照")
}

fn size(geometry: OutputGeometry) -> (u32, u32, bool) {
    (geometry.width, geometry.height, geometry.adjusted)
}

fn rect(x: u32, y: u32, width: u32, height: u32) -> PictureRect {
    PictureRect { x, y, width, height }
}

#[test]
fn output_size_follows_the_canvas_ratio_when_one_side_or_none_is_given() {
    // 只给高（与之前的规则相同）：宽按画布比例，都取偶数，调过时标出来；画面铺满。
    assert_eq!(size(output_geometry(1920, 1080, None, None)), (1920, 1080, false));
    assert_eq!(size(output_geometry(1920, 1080, None, Some(720))), (1280, 720, false));
    let odd = output_geometry(1920, 1080, None, Some(101));
    assert_eq!((odd.height, odd.adjusted), (102, true));
    // 1080×1350（4:5）缩到 500 高：400 宽，整除；缩到 334：267.2 → 268。
    assert_eq!(size(output_geometry(1080, 1350, None, Some(500))), (400, 500, false));
    assert_eq!(size(output_geometry(1080, 1350, None, Some(334))), (268, 334, true));
    // 画布本身是奇数：取偶数，算调过。
    assert_eq!(size(output_geometry(321, 181, None, None)), (322, 182, true));
    // 只给宽：高按画布比例。
    assert_eq!(size(output_geometry(1920, 1080, Some(1280), None)), (1280, 720, false));
    // 267 → 268 宽，高 335 → 336。
    assert_eq!(size(output_geometry(1080, 1350, Some(267), None)), (268, 336, true));
    for geometry in [
        output_geometry(1920, 1080, None, Some(720)),
        output_geometry(1080, 1350, Some(267), None),
    ] {
        assert_eq!(geometry.picture, rect(0, 0, geometry.width, geometry.height));
    }
}

#[test]
fn output_size_with_both_sides_fits_the_canvas_inside_black_bars() {
    // 竖屏画布导出成横屏：左右黑边，画面 1080 高、607.5 → 608 宽，居中。
    let pillar = output_geometry(1080, 1920, Some(1920), Some(1080));
    assert_eq!(size(pillar), (1920, 1080, false));
    assert_eq!(pillar.picture, rect(656, 0, 608, 1080));
    // 横屏画布导出成方形：上下黑边。
    let letter = output_geometry(320, 180, Some(320), Some(320));
    assert_eq!(size(letter), (320, 320, false));
    assert_eq!(letter.picture, rect(0, 70, 320, 180));
    // 比例相同：画面铺满，没有黑边。
    let same = output_geometry(1920, 1080, Some(1280), Some(720));
    assert_eq!(same.picture, rect(0, 0, 1280, 720));
    // 奇数的宽高取偶数并标出来；放不满的一边就近取偶数，不越过输出。
    let odd = output_geometry(1920, 1080, Some(1001), Some(1001));
    assert_eq!(size(odd), (1002, 1002, true));
    assert_eq!(odd.picture, rect(0, 219, 1002, 564));
    // 各种比例：画面的宽高是偶数、在输出里、居中，并且有一边铺满。
    for (cw, ch) in [(1920, 1080), (1080, 1920), (1080, 1350), (999, 1001), (4000, 30)] {
        for (w, h) in [(1280, 720), (720, 1280), (1080, 1080), (2, 2), (642, 360)] {
            let g = output_geometry(cw, ch, Some(w), Some(h));
            let p = g.picture;
            assert!(
                p.width.is_multiple_of(2) && p.height.is_multiple_of(2) && p.width >= 2 && p.height >= 2,
                "{cw}×{ch} → {w}×{h}: {p:?}"
            );
            assert!(p.x + p.width <= g.width && p.y + p.height <= g.height, "{p:?}");
            assert_eq!((p.x * 2 + p.width, p.y * 2 + p.height), (g.width, g.height), "{p:?}");
            assert!(p.width == g.width || p.height == g.height, "{p:?}");
        }
    }
}

fn seconds(num: i128, den: i128) -> Ratio {
    Ratio::new(num, den).expect("有理数")
}

#[test]
fn range_lists_layers_partners_transitions_and_assets() {
    let video = fixture();
    // [2, 3.5) 秒是第 60 到 104 帧：交叉叠化的窗口（75..105）在里面，两侧都要冻结；竖屏片段在第 60 帧之前结束。
    let plan = plan_video(VideoView::from(&video), "seq_main", Some((seconds(2, 1), seconds(7, 2)))).expect("概览");
    let ids: Vec<&str> = plan.layers.iter().map(|l| l.item_id.as_str()).collect();
    assert_eq!(ids, ["item_land_a", "item_land_b", "item_logo"]);
    assert!(plan.layers.iter().all(|l| l.transition.is_none()));
    let transitions: Vec<&str> = plan.transitions.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(transitions, ["tr_land"]);
    let assets: Vec<&str> = plan.assets.iter().map(|a| a.id.as_str()).collect();
    assert_eq!(assets, ["asset_land", "asset_logo"]);
    assert!(plan.documents.is_empty());
    assert_eq!(plan.range.start_seconds, 2.0);
    assert_eq!(plan.range.end_seconds, 3.5);
}

#[test]
fn lottie_stickers_freeze_the_asset_named_in_their_parameters() {
    // 把 logo 图片换成引用 Lottie 素材的素材贴纸：层是生成器、不带素材，导出仍要冻结它（帧光栅从字节读）。
    let mut json: serde_json::Value = serde_json::to_value(fixture()).expect("夹具能序列化");
    let mut lottie = json["assets"]["asset_logo"].clone();
    lottie["id"] = "asset_lottie".into();
    lottie["kind"] = "lottie".into();
    lottie["revisions"]["rev_1"]["mediaType"] = "application/json".into();
    json["assets"]["asset_lottie"] = lottie;
    let items = json["sequences"]["seq_main"]["items"].as_array_mut().expect("实例");
    let logo = items.iter_mut().find(|item| item["id"] == "item_logo").expect("logo");
    logo["type"] = "sticker".into();
    logo["assetRef"] = serde_json::json!({ "id": "asset_lottie", "revision": "rev_1" });
    logo["sticker"] = serde_json::json!({ "source": "asset", "loop": "once" });
    logo.as_object_mut().expect("对象").remove("fit");
    let video: VideoSnapshot = serde_json::from_value(json).expect("改过的夹具仍是完整的快照");
    let plan = plan_video(VideoView::from(&video), "seq_main", Some((seconds(2, 1), seconds(7, 2)))).expect("概览");
    let logo = plan.layers.iter().find(|l| l.item_id == "item_logo").expect("贴纸层");
    assert!(logo.asset.is_none(), "Lottie 贴纸是生成器层");
    let assets: Vec<&str> = plan.assets.iter().map(|a| a.id.as_str()).collect();
    assert_eq!(assets, ["asset_land", "asset_lottie"]);
}

#[test]
fn whole_sequence_lists_unsupported_transitions_and_caption_documents() {
    let video = fixture();
    let plan = plan_video(VideoView::from(&video), "seq_main", None).expect("概览");
    let ids: Vec<&str> = plan.layers.iter().map(|l| l.item_id.as_str()).collect();
    // 停用的实例与隐藏轨道上的实例不出现；字幕、文字、图形、生成器与代码包都在。
    assert!(!ids.contains(&"item_disabled") && !ids.contains(&"item_hidden"));
    for id in ["item_title", "item_badge", "item_meter", "item_bundle", "item_caption", "item_note"] {
        assert!(ids.contains(&id), "{id} 在概览里");
    }
    let spin = plan.transitions.iter().find(|t| t.id == "tr_talk_out").expect("出场转场");
    assert_eq!(spin.unsupported.as_deref(), Some("unknown-kind"));
    assert_eq!(plan.documents, ["doc_caption", "doc_caption_style", "doc_note"]);
}

#[test]
fn empty_range_is_rejected() {
    let video = fixture();
    let error = plan_video(VideoView::from(&video), "seq_main", Some((seconds(500, 1), seconds(600, 1)))).expect_err("范围在序列之外");
    assert_eq!(error.code, "EXPORT_RANGE_EMPTY");
}
