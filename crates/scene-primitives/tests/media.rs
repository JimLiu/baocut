//! 资源生命周期 + 媒体节点 + audio clip 的 core 侧语义测试（无 I/O，元数据经 HostInputs 注入）。

use scene_primitives::layout::{self, TextMeasure, TextMetricsLine};
use scene_primitives::sample::sample_frames;
use scene_primitives::{AssetKind, HostInputs, Resolver, host_requirements};
use serde_json::json;

struct FakeMeasure;
impl TextMeasure for FakeMeasure {
    fn measure(&mut self, text: &str, _family: &str, size: f64, _w: u16) -> TextMetricsLine {
        TextMetricsLine {
            width: text.chars().count() as f64 * size * 0.6,
            ascent: size * 0.8,
            descent: size * 0.2,
        }
    }
}

fn doc() -> serde_json::Value {
    json!({
        "meta": { "id": "m", "width": 1920, "height": 1080, "fps": 30 },
        "scenes": [
            { "id": "a", "dur": 4, "desc": "画面 A" },
            { "id": "b", "dur": 6, "desc": "画面 B" }
        ],
        "assets": {
            "logo": { "type": "image", "src": "assets/logo.png" },
            "demo": { "type": "video", "src": "assets/demo.mp4" },
            "bgm":  { "type": "audio", "src": "assets/bgm.wav" },
            "hero": { "type": "font",  "src": "assets/Hero.ttf", "family": "Hero" }
        },
        "tracks": [
            { "id": "main", "kind": "visual", "clips": [
                { "id": "shot", "start": 0, "end": "@b.end", "element": {
                    "type": "box", "id": "root", "children": [
                        { "type": "image", "id": "im", "src": "$assets.logo",
                          "style": { "x": 10, "y": 20, "width": 200 } },
                        { "type": "video", "id": "vid", "src": "$assets.demo", "mediaStart": 1.5,
                          "style": { "x": 0, "y": 0, "width": 640, "height": 360 } }
                    ] } }
            ] },
            { "id": "sound", "kind": "audio", "clips": [
                { "id": "bgm-main", "start": 0, "end": "@b.end",
                  "src": "$assets.bgm", "mediaStart": 2.0, "volume": 0.8,
                  "animate": { "keyframes": [ { "prop": "volume", "frames": [
                      { "t": "@b-0.5", "v": 0.8 },
                      { "t": "@b+0.5", "v": 0.4, "ease": "easeInOutSine" } ] } ] } }
            ] }
        ]
    })
}

#[test]
fn requirements_cover_all_kinds() {
    let reqs = host_requirements(&doc()).unwrap();
    let kinds: Vec<AssetKind> = reqs.iter().map(|r| r.kind).collect();
    assert_eq!(reqs.len(), 4);
    // 按 id 排序：bgm, demo, hero, logo
    assert_eq!(reqs[0].id, "bgm");
    assert_eq!(
        kinds,
        vec![
            AssetKind::Audio,
            AssetKind::Video,
            AssetKind::Font,
            AssetKind::Image
        ]
    );
}

#[test]
fn media_nodes_and_audio_clip() {
    let mut r = Resolver::new(doc(), None).unwrap();
    let mut inputs = HostInputs::default();
    inputs.insert_image("logo", 400.0, 300.0);
    inputs.insert_video("demo", 1280.0, 720.0, 12.0, 24.0);
    inputs.insert_audio("bgm", 30.0);
    r.set_host_inputs(inputs);
    let mut ir = r.resolve().unwrap();

    // image：给宽 200 → 高按 400:300 比例 = 150；video 显式 640×360
    let tree = &mut ir.visual_clips[0].tree;
    layout::layout_tree(tree, 1920.0, 1080.0, &mut FakeMeasure);
    let im = &tree.children[0];
    assert_eq!(im.asset_id.as_deref(), Some("logo"));
    assert_eq!((im.frame.w, im.frame.h), (200.0, 150.0));
    let vid = &tree.children[1];
    assert_eq!(vid.asset_id.as_deref(), Some("demo"));
    assert_eq!((vid.frame.w, vid.frame.h), (640.0, 360.0));
    // media_t0 = clip.start - mediaStart = 0 - 1.5；t=3 时媒体时间应为 4.5
    assert!((3.0 - vid.media_t0 - 4.5).abs() < 1e-9);

    // audio clip：窗口 [0,10]，volume 通道 @b±0.5 = 3.5/4.5 秒
    assert_eq!(ir.audio_clips.len(), 1);
    let a = &ir.audio_clips[0];
    assert_eq!(a.asset_id, "bgm");
    assert_eq!((a.start, a.end), (0.0, 10.0));
    assert_eq!(a.media_start, 2.0);
    assert_eq!(a.base_volume, 0.8);
    assert_eq!(a.volume.len(), 2);
    assert!((a.volume[0].t - 3.5).abs() < 1e-9 && (a.volume[1].t - 4.5).abs() < 1e-9);
    let v = sample_frames(&a.volume, 4.0).as_f64().unwrap();
    assert!((v - 0.6).abs() < 1e-9, "easeInOutSine 中点 = 0.6，实得 {v}");
}

#[test]
fn video_semantics_and_with_audio_expansion() {
    let doc = json!({
        "meta": { "id": "v", "width": 1920, "height": 1080, "fps": 30 },
        "scenes": [ { "id": "a", "dur": 8, "desc": "素材" } ],
        "assets": { "demo": { "type": "video", "src": "assets/demo.mp4" } },
        "tracks": [
            { "id": "main", "kind": "visual", "clips": [
                { "id": "shot", "start": 1, "end": 7, "element": {
                    "type": "video", "id": "vid", "src": "$assets.demo",
                    "playbackRate": 2, "segment": [1, 4], "fit": "contain",
                    "withAudio": true, "volume": 0.5,
                    "style": { "width": 640, "height": 360 } } }
            ] }
        ]
    });
    let mut r = Resolver::new(doc, None).unwrap();
    let mut inputs = HostInputs::default();
    inputs.insert_video("demo", 1280.0, 720.0, 12.0, 24.0);
    r.set_host_inputs(inputs);
    let ir = r.resolve().unwrap();

    let vid = &ir.visual_clips[0].tree;
    assert_eq!(vid.playback_rate, 2.0);
    assert_eq!(vid.segment, Some((1.0, 4.0)));
    assert_eq!(vid.fit, scene_primitives::Fit::Contain);
    assert!(!vid.loop_media);
    assert!(vid.with_audio);
    // mediaStart 缺省 = segment 起点（§6.5）
    assert_eq!(vid.media_start, 1.0);
    assert_eq!(vid.media_win_start, 1.0);
    assert_eq!((vid.media_fps, vid.media_duration), (24.0, 12.0));

    // withAudio 展开：同窗口 audio 条目，rate/volume 继承
    assert_eq!(ir.audio_clips.len(), 1);
    let a = &ir.audio_clips[0];
    assert_eq!(a.asset_id, "demo");
    assert_eq!((a.start, a.end), (1.0, 7.0));
    assert_eq!(a.media_start, 1.0);
    assert_eq!(a.rate, 2.0);
    assert_eq!(a.base_volume, 0.5);
    assert!(a.volume.is_empty());
}

#[test]
fn lint_video_field_rules() {
    let doc = json!({
        "meta": { "id": "v", "width": 1920, "height": 1080, "fps": 30 },
        "scenes": [ { "id": "a", "dur": 8, "desc": "素材" } ],
        "assets": { "demo": { "type": "video", "src": "assets/demo.mp4" } },
        "tracks": [
            { "id": "main", "kind": "visual", "clips": [
                { "id": "shot", "start": 0, "end": 8, "element": {
                    "type": "video", "id": "vid", "src": "$assets.demo",
                    "playbackRate": 0, "segment": [4, 1], "fit": "zoom",
                    "loop": "yes", "volume": 2 } }
            ] }
        ]
    });
    let diags = scene_primitives::lint::lint(&doc);
    let schema_ptrs: Vec<&str> = diags
        .iter()
        .filter(|d| d.rule == "schema")
        .map(|d| d.pointer.as_str())
        .collect();
    for field in ["playbackRate", "segment", "fit", "loop", "volume"] {
        assert!(
            schema_ptrs.iter().any(|p| p.ends_with(field)),
            "缺 {field} 诊断：{schema_ptrs:?}"
        );
    }
}

#[test]
fn lint_video_window_overrun_warns_with_media_meta() {
    let doc = json!({
        "meta": { "id": "v", "width": 1920, "height": 1080, "fps": 30 },
        "scenes": [ { "id": "a", "dur": 10, "desc": "素材" } ],
        "assets": { "demo": { "type": "video", "src": "assets/demo.mp4" } },
        "tracks": [
            { "id": "main", "kind": "visual", "clips": [
                { "id": "shot", "start": 0, "end": 10, "element": {
                    "type": "video", "id": "vid", "src": "$assets.demo",
                    "mediaStart": 5 } }
            ] }
        ]
    });
    // 无元数据：不报（duration 未知）
    assert!(
        !scene_primitives::lint::lint(&doc)
            .iter()
            .any(|d| d.rule == "video-window-overrun")
    );
    // duration=12：需要 [5, 15) 超出 → warn；loop: true 后消失
    let mut inputs = HostInputs::default();
    inputs.insert_video("demo", 1280.0, 720.0, 12.0, 24.0);
    let diags = scene_primitives::lint::lint_with_inputs(&doc, Some(&inputs));
    assert!(
        diags.iter().any(|d| d.rule == "video-window-overrun"
            && d.severity == scene_primitives::lint::Severity::Warn),
        "{diags:?}"
    );
    let mut looped = doc.clone();
    looped["tracks"][0]["clips"][0]["element"]["loop"] = json!(true);
    let diags = scene_primitives::lint::lint_with_inputs(&looped, Some(&inputs));
    assert!(
        !diags.iter().any(|d| d.rule == "video-window-overrun"),
        "{diags:?}"
    );
}

#[test]
fn lint_asset_rules() {
    // 裸路径 src、未声明资源、kind 不匹配、坏 hash 全部拦为 error
    let bad = json!({
        "meta": { "id": "m", "width": 1920, "height": 1080 },
        "scenes": [ { "id": "a", "dur": 4, "desc": "d" } ],
        "assets": {
            "logo": { "type": "image", "src": "l.png", "hash": "sha256-xyz" }
        },
        "tracks": [
            { "id": "main", "kind": "visual", "clips": [
                { "id": "c1", "start": 0, "element": { "type": "box", "children": [
                    { "type": "image", "id": "i1", "src": "assets/raw.png" },
                    { "type": "video", "id": "v1", "src": "$assets.nope" },
                    { "type": "video", "id": "v2", "src": "$assets.logo" }
                ] } }
            ] },
            { "id": "au", "kind": "audio", "clips": [
                { "id": "a1", "start": 0, "src": "bgm.mp3" }
            ] }
        ]
    });
    let diags = scene_primitives::lint::lint(&bad);
    let rules: Vec<&str> = diags.iter().map(|d| d.rule).collect();
    assert!(rules.contains(&"asset-src-literal"), "{rules:?}");
    assert!(rules.contains(&"asset-unknown"), "{rules:?}");
    assert!(rules.contains(&"asset-kind-mismatch"), "{rules:?}");
    assert!(rules.contains(&"asset-hash-format"), "{rules:?}");
}
