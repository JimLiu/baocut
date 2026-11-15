//! 效果（`fx`）与裁剪、章节、闪避规则，以及版本门：只读写版本 3（视频格式规范 §1.4、§3.5、§3.8、§3.9、§3.13）。

#![allow(clippy::result_large_err)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use editor_semantics::Rate;
use serde_json::{Value, json};
use video_engine::model::{Actor, ActorKind, DuckingTrigger, TimelineItem};
use video_engine::{Committed, CreateOptions, ErrorBody, OpenMode, UndoRequest, UndoTarget, Video, VideoTransaction};

fn ffprobe() -> PathBuf {
    PathBuf::from(std::env::var("BAOCUT_FFPROBE").unwrap_or_else(|_| "ffprobe".into()))
}

fn user() -> Actor {
    Actor {
        kind: ActorKind::User,
        id: "user_local".into(),
    }
}

fn new_video(dir: &Path) -> Video {
    let options = CreateOptions {
        name: "格式对象".into(),
        fps: Rate { num: 30, den: 1 },
        width: 1920,
        height: 1080,
    };
    Video::create(dir, &options, &ffprobe()).expect("新建视频")
}

fn apply(video: &mut Video, command_id: &str, operations: Vec<Value>) -> Result<Committed, ErrorBody> {
    video.apply(&VideoTransaction {
        command_id: command_id.into(),
        expected_revision: video.revision(),
        label: None,
        label_ref: None,
        operations,
        actor: user(),
        task_id: None,
    })
}

fn undo(video: &mut Video, command_id: &str, committed: &Committed) -> Result<Committed, ErrorBody> {
    video.undo(&UndoRequest {
        command_id: command_id.into(),
        target: UndoTarget::Transaction(committed.receipt.transaction_id.clone()),
        expected_revision: None,
        actor: user(),
    })
}

fn code(result: Result<Committed, ErrorBody>) -> String {
    result.expect_err("应当失败").code
}

fn seq(video: &Video) -> String {
    video.state().root_sequence_id.clone()
}

fn track(video: &Video, name: &str) -> String {
    video
        .state()
        .tracks
        .values()
        .find(|t| t.value.name.as_deref() == Some(name))
        .map(|t| t.value.id.clone())
        .unwrap()
}

struct Fixture {
    video: Video,
    seq: String,
    text: String,
    counter: String,
    _dir: tempfile::TempDir,
}

/// V1 上一段文字 [0,90)，V2 上一个代码包合成 [0,90)（合成有自己的声音）。没有媒体，不需要 ffprobe。
fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let bundle = dir.path().join("scene");
    fs::create_dir_all(&bundle).unwrap();
    fs::write(bundle.join("index.html"), "<html></html>").unwrap();
    let mut video = new_video(&dir.path().join("m"));
    let s = seq(&video);
    apply(
        &mut video,
        "cmd_track",
        vec![
            json!({ "type": "addTrack", "sequenceId": s, "kind": "visual" }),
            json!({ "type": "importAsset", "path": bundle, "bundle": { "engine": "browser", "entry": "index.html" } }),
        ],
    )
    .unwrap();
    let bundle_id = video.state().assets.keys().next().unwrap().clone();
    let items = json!([
        { "type": "text", "trackId": track(&video, "V1"), "span": { "fromFrame": 0, "durationFrames": 90 }, "text": "标题", "style": {} },
        { "type": "composition", "trackId": track(&video, "V2"), "span": { "fromFrame": 0, "durationFrames": 90 },
          "source": { "kind": "bundle", "assetRef": { "id": bundle_id, "revision": "1" } }, "parameterValues": {},
          "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } } },
    ]);
    apply(
        &mut video,
        "cmd_items",
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": items })],
    )
    .unwrap();
    let find = |video: &Video, pick: fn(&TimelineItem) -> bool| {
        video
            .state()
            .items
            .values()
            .find(|i| pick(&i.value))
            .unwrap()
            .value
            .base()
            .id
            .clone()
    };
    Fixture {
        text: find(&video, |i| matches!(i, TimelineItem::Text(_))),
        counter: find(&video, |i| matches!(i, TimelineItem::Composition(_))),
        seq: s,
        video,
        _dir: dir,
    }
}

fn fx_json(video: &Video, item_id: &str) -> Value {
    serde_json::to_value(video.state().items[item_id].value.fx()).unwrap()
}

#[test]
fn set_effects_replaces_the_whole_fx_and_undoes() {
    let Fixture {
        mut video, text, counter, ..
    } = fixture();
    let fx = json!({ "brightness": 0.2, "saturation": -1.0, "blur": 6.0,
                     "shadow": { "offsetX": 4.0, "offsetY": 4.0, "blur": 8.0, "color": "#000000", "opacity": 0.5 } });
    let committed = apply(
        &mut video,
        "cmd_fx",
        vec![json!({ "type": "setEffects", "itemId": counter, "fx": fx })],
    )
    .unwrap();
    assert_eq!(committed.receipt.label, "Edit effects");
    assert_eq!(fx_json(&video, &counter), fx);

    // 整个替换：没给的字段去掉。
    apply(
        &mut video,
        "cmd_fx2",
        vec![json!({ "type": "setEffects", "itemId": counter, "fx": { "filterPreset": "calm1", "temperature": 0.3 } })],
    )
    .unwrap();
    assert_eq!(fx_json(&video, &counter), json!({ "filterPreset": "calm1", "temperature": 0.3 }));

    let before = video.revision();
    for (n, op) in [
        // 文字的描边、阴影在 style 里，不用 fx。
        json!({ "type": "setEffects", "itemId": text, "fx": { "blur": 1 } }),
        json!({ "type": "setEffects", "itemId": counter, "fx": { "brightness": 2 } }),
        json!({ "type": "setEffects", "itemId": counter, "fx": { "blur": 101 } }),
        json!({ "type": "setEffects", "itemId": counter, "fx": { "gamma": 1 } }),
        json!({ "type": "setEffects", "itemId": counter, "fx": { "filterPreset": "no-such-filter" } }),
        // 预设名没有下划线：`calm1`，不是 `calm_1`（协议的类型与它一致）。
        json!({ "type": "setEffects", "itemId": counter, "fx": { "filterPreset": "calm_1" } }),
        json!({ "type": "setEffects", "itemId": counter, "fx": { "temperature": 1.5 } }),
        json!({ "type": "setEffects", "itemId": counter, "fx": { "stroke": { "width": 101, "color": "#FFFFFF" } } }),
        json!({ "type": "setEffects", "itemId": counter, "fx": { "shadow": { "color": "red" } } }),
        json!({ "type": "setEffects", "itemId": counter, "effects": [] }),
    ]
    .into_iter()
    .enumerate()
    {
        assert_eq!(
            code(apply(&mut video, &format!("cmd_bad_{n}"), vec![op])),
            "INVALID_OPERATION",
            "第 {n} 个"
        );
    }
    assert_eq!(video.revision(), before);

    // 去掉，再撤销。空的 fx 不写出来。
    let cleared = apply(
        &mut video,
        "cmd_clear",
        vec![json!({ "type": "setEffects", "itemId": counter, "fx": null })],
    )
    .unwrap();
    assert_eq!(fx_json(&video, &counter), Value::Null);
    let snapshot = serde_json::to_value(video.snapshot()).unwrap();
    let item = snapshot["sequences"][seq(&video)]["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] == json!(counter))
        .unwrap()
        .clone();
    assert!(item.get("fx").is_none(), "没有效果时不写 fx");
    undo(&mut video, "cmd_undo", &cleared).unwrap();
    assert_eq!(fx_json(&video, &counter)["filterPreset"], "calm1");

    // 锁定的片段不能改效果。
    apply(
        &mut video,
        "cmd_lock",
        vec![json!({ "type": "updateItem", "itemId": counter, "locked": true })],
    )
    .unwrap();
    assert_eq!(
        code(apply(
            &mut video,
            "cmd_locked",
            vec![json!({ "type": "setEffects", "itemId": counter, "fx": null })]
        )),
        "TARGET_LOCKED"
    );
}

#[test]
fn insert_items_validates_fx_against_the_element_model() {
    let Fixture {
        mut video,
        seq: s,
        counter,
        ..
    } = fixture();
    let v1 = track(&video, "V1");
    let bundle = video.state().items[&counter].value.asset_ref().unwrap().clone();
    let composition = |fx: Value| {
        json!({ "type": "composition", "trackId": v1, "span": { "fromFrame": 100, "durationFrames": 30 },
                "source": { "kind": "bundle", "assetRef": bundle }, "parameterValues": {}, "fx": fx,
                "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } } })
    };
    apply(
        &mut video,
        "cmd_ok",
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": [composition(json!({ "blur": 2 }))] })],
    )
    .unwrap();
    let text =
        json!({ "type": "text", "trackId": v1, "span": { "fromFrame": 200, "durationFrames": 30 }, "text": "x", "fx": { "blur": 2 } });
    for (n, item) in [
        composition(json!({ "blur": 900 })),
        composition(json!({ "vendorGlow": 1 })),
        composition(json!({ "stroke": { "width": -1, "color": "#FFFFFF" } })),
        text,
    ]
    .into_iter()
    .enumerate()
    {
        let err = apply(
            &mut video,
            &format!("cmd_bad_{n}"),
            vec![json!({ "type": "insertItems", "sequenceId": s, "items": [item] })],
        )
        .unwrap_err();
        assert_eq!(err.code, "INVALID_OPERATION", "第 {n} 个");
    }
}

/// 2 秒 30 fps 的视频，没有声音。
fn clip() -> Option<(tempfile::TempDir, PathBuf)> {
    let dir = tempfile::tempdir().ok()?;
    let path = dir.path().join("clip.mp4");
    let ok = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=160x90:rate=30:duration=2",
            "-c:v",
            "mpeg4",
        ])
        .arg(&path)
        .output()
        .is_ok_and(|o| o.status.success());
    if !ok {
        eprintln!("跳过：没有可用的 ffmpeg 生成测试素材");
        return None;
    }
    Some((dir, path))
}

#[test]
fn crop_goes_through_set_style() {
    let Some((_media, path)) = clip() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(&dir.path().join("m"));
    let s = seq(&video);
    let committed = apply(
        &mut video,
        "cmd_add",
        vec![
            json!({ "type": "importAsset", "path": path, "ref": "clip" }),
            json!({ "type": "addItem", "sequenceId": s, "asset": { "ref": "clip" }, "alignment": "nearest-frame" }),
        ],
    )
    .unwrap();
    let id = committed
        .receipt
        .created_ids
        .iter()
        .find(|id| video.state().items.contains_key(*id))
        .unwrap()
        .clone();
    let crop_of = |video: &Video| match &video.state().items[&id].value {
        TimelineItem::Video(v) => v.crop,
        _ => unreachable!(),
    };
    let cropped = apply(
        &mut video,
        "cmd_crop",
        vec![json!({ "type": "setStyle", "itemId": id, "crop": { "left": 0.1, "top": 0, "right": 0.2, "bottom": 0.25 } })],
    )
    .unwrap();
    assert_eq!(crop_of(&video).unwrap().rect(), [0.1, 0.0, 0.8, 0.75]);
    for (n, crop) in [
        json!({ "left": 0.6, "top": 0, "right": 0.4, "bottom": 0 }),
        json!({ "left": -0.1, "top": 0, "right": 0, "bottom": 0 }),
        json!({ "left": 0.1 }),
    ]
    .into_iter()
    .enumerate()
    {
        assert_eq!(
            code(apply(
                &mut video,
                &format!("cmd_bad_{n}"),
                vec![json!({ "type": "setStyle", "itemId": id, "crop": crop })]
            )),
            "INVALID_OPERATION"
        );
    }
    apply(
        &mut video,
        "cmd_uncrop",
        vec![json!({ "type": "setStyle", "itemId": id, "crop": null })],
    )
    .unwrap();
    assert_eq!(crop_of(&video), None);
    apply(
        &mut video,
        "cmd_zero",
        vec![json!({ "type": "setStyle", "itemId": id, "crop": { "left": 0, "top": 0, "right": 0, "bottom": 0 } })],
    )
    .unwrap();
    assert_eq!(crop_of(&video), None, "四边都是 0 等于没有裁剪");
    let _ = cropped;
}

#[test]
fn panels_go_through_set_style_and_leave_with_fullscreen_cover() {
    let Some((_media, path)) = clip() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(&dir.path().join("m"));
    let s = seq(&video);
    let committed = apply(
        &mut video,
        "cmd_add",
        vec![
            json!({ "type": "importAsset", "path": path, "ref": "clip" }),
            json!({ "type": "addItem", "sequenceId": s, "asset": { "ref": "clip" }, "alignment": "nearest-frame" }),
        ],
    )
    .unwrap();
    let id = committed
        .receipt
        .created_ids
        .iter()
        .find(|id| video.state().items.contains_key(*id))
        .unwrap()
        .clone();
    let panels_of = |video: &Video| match &video.state().items[&id].value {
        TimelineItem::Video(v) => v.panels.clone(),
        _ => unreachable!(),
    };
    let rows = json!([
        { "rect": { "x": 0, "y": 0, "w": 100, "h": 50 }, "focalPoint": { "x": 0.25, "y": 0.4, "zoom": 1.4 } },
        { "rect": { "x": 0, "y": 50, "w": 100, "h": 50 }, "focalPoint": { "x": 0.75, "y": 0.4, "zoom": 1.4 } },
    ]);
    /* 新加的视频是全屏加 contain：分屏只用于 cover */
    let refused = apply(&mut video, "cmd_contain", vec![json!({ "type": "setStyle", "itemId": id, "panels": rows })]);
    assert_eq!(code(refused), "INVALID_OPERATION");
    apply(&mut video, "cmd_split", vec![json!({ "type": "setStyle", "itemId": id, "fit": "cover", "panels": rows })]).unwrap();
    let panels = panels_of(&video).unwrap();
    assert_eq!(panels.len(), 2);
    assert_eq!(panels[1].focal_point.x, 0.75);
    for (n, bad) in [
        json!([rows[0]]),
        json!([rows[0], { "rect": { "x": 0, "y": 40, "w": 100, "h": 50 }, "focalPoint": { "x": 0.5, "y": 0.5 } }]),
        json!([rows[0], { "rect": { "x": 0, "y": 50, "w": 100, "h": 60 }, "focalPoint": { "x": 0.5, "y": 0.5 } }]),
        json!([rows[0], { "rect": { "x": 0, "y": 50, "w": 100, "h": 50 }, "focalPoint": { "x": 0.5, "y": 0.5, "zoom": 6 } }]),
    ]
    .into_iter()
    .enumerate()
    {
        let result = apply(&mut video, &format!("cmd_bad_{n}"), vec![json!({ "type": "setStyle", "itemId": id, "panels": bad })]);
        assert_eq!(code(result), "INVALID_OPERATION", "第 {n} 组");
    }
    assert_eq!(panels_of(&video).unwrap().len(), 2, "改不成的不动原来的格子");
    /* 换回 contain：格子跟着去掉 */
    apply(&mut video, "cmd_fit", vec![json!({ "type": "setStyle", "itemId": id, "fit": "contain" })]).unwrap();
    assert_eq!(panels_of(&video), None);
    apply(&mut video, "cmd_again", vec![json!({ "type": "setStyle", "itemId": id, "fit": "cover", "panels": rows })]).unwrap();
    apply(&mut video, "cmd_single", vec![json!({ "type": "setStyle", "itemId": id, "panels": null })]).unwrap();
    assert_eq!(panels_of(&video), None);
}

#[test]
fn chapters_are_set_upserted_and_removed() {
    let Fixture {
        mut video, seq: s, text, ..
    } = fixture();
    let op = json!({ "type": "setChapters", "sequenceId": s, "alignment": "nearest-frame", "chapters": [
        { "at": { "unit": "seconds", "value": "0" }, "title": "开场" },
        { "at": { "unit": "seconds", "value": "1.01" }, "title": "  正文  ", "summary": "讲重点" },
    ] });
    let committed = apply(&mut video, "cmd_set", vec![op]).unwrap();
    assert_eq!(committed.receipt.label, "Set chapters");
    assert_eq!(committed.receipt.time_resolution.len(), 2);
    let chapters = |video: &Video| -> Vec<Value> {
        let snapshot = serde_json::to_value(video.snapshot()).unwrap();
        snapshot["sequences"][seq(video)]["markers"].as_array().unwrap().clone()
    };
    let list = chapters(&video);
    assert_eq!(list.len(), 2);
    assert_eq!((list[1]["frame"].as_i64(), list[1]["label"].as_str()), (Some(30), Some("正文")));
    assert_eq!(list[1]["kind"], "chapter");
    assert_eq!(list[1]["summary"], "讲重点");
    let second = list[1]["id"].as_str().unwrap().to_string();

    // 章节固定在序列时间上：移动实例不动它。
    apply(&mut video, "cmd_move", vec![json!({ "type": "moveItem", "sequenceId": s, "itemId": text, "at": { "unit": "frames", "value": 200 }, "alignment": "exact-frame" })]).unwrap();
    assert_eq!(chapters(&video)[1]["frame"], 30);

    // 修改：只改给出的字段；null 去掉简介。
    let upsert = json!({ "type": "upsertChapter", "sequenceId": s, "chapterId": second, "title": "第二章", "summary": null,
                         "at": { "unit": "frames", "value": 45 }, "alignment": "exact-frame" });
    let updated = apply(&mut video, "cmd_upsert", vec![upsert]).unwrap();
    assert_eq!(updated.receipt.updated_ids, vec![second.clone()]);
    let list = chapters(&video);
    assert_eq!(
        (list[1]["frame"].as_i64(), list[1]["label"].as_str(), list[1].get("summary")),
        (Some(45), Some("第二章"), None)
    );

    // 新建一章，排在中间。
    let created = apply(
        &mut video,
        "cmd_new",
        vec![json!({ "type": "upsertChapter", "sequenceId": s, "at": { "unit": "frames", "value": 15 }, "alignment": "exact-frame", "title": "插曲" })],
    )
    .unwrap();
    let list = chapters(&video);
    assert_eq!(
        list.iter().map(|c| c["label"].as_str().unwrap()).collect::<Vec<_>>(),
        ["开场", "插曲", "第二章"]
    );

    let before = video.revision();
    for (n, op) in [
        // 开始帧要严格递增。
        json!({ "type": "setChapters", "sequenceId": s, "alignment": "exact-frame", "chapters": [
            { "at": { "unit": "frames", "value": 10 }, "title": "a" }, { "at": { "unit": "frames", "value": 10 }, "title": "b" }] }),
        json!({ "type": "setChapters", "sequenceId": s, "alignment": "exact-frame", "chapters": [{ "at": { "unit": "frames", "value": 0 }, "title": "  " }] }),
        json!({ "type": "setChapters", "sequenceId": s, "alignment": "exact-frame", "chapters": [{ "chapterId": "chap_missing", "at": { "unit": "frames", "value": 0 }, "title": "a" }] }),
        // 同一帧已经有一章。
        json!({ "type": "upsertChapter", "sequenceId": s, "at": { "unit": "frames", "value": 45 }, "alignment": "exact-frame", "title": "撞了" }),
        // 给 at 要写 alignment；新建要有 title。
        json!({ "type": "upsertChapter", "sequenceId": s, "chapterId": second, "at": { "unit": "frames", "value": 50 } }),
        json!({ "type": "upsertChapter", "sequenceId": s, "at": { "unit": "frames", "value": 50 }, "alignment": "exact-frame" }),
        json!({ "type": "removeChapter", "chapterId": "chap_missing" }),
    ]
    .into_iter()
    .enumerate()
    {
        assert!(apply(&mut video, &format!("cmd_bad_{n}"), vec![op]).is_err(), "第 {n} 个");
    }
    assert_eq!(video.revision(), before);

    undo(&mut video, "cmd_undo_new", &created).unwrap();
    assert_eq!(chapters(&video).len(), 2);
    let removed = apply(&mut video, "cmd_rm", vec![json!({ "type": "removeChapter", "chapterId": second })]).unwrap();
    assert_eq!(removed.receipt.deleted_ids, vec![second]);
    assert_eq!(removed.receipt.label, "Delete chapter");

    // 章节不受锁定约束。
    let v1 = track(&video, "V1");
    apply(
        &mut video,
        "cmd_lock",
        vec![json!({ "type": "updateTrack", "trackId": v1, "locked": true })],
    )
    .unwrap();
    apply(
        &mut video,
        "cmd_clear",
        vec![json!({ "type": "setChapters", "sequenceId": s, "alignment": "exact-frame", "chapters": [] })],
    )
    .unwrap();
    assert!(chapters(&video).is_empty());
}

#[test]
fn ducking_rules_are_validated_and_undoable() {
    let Fixture {
        mut video,
        seq: s,
        counter,
        ..
    } = fixture();
    let a1 = track(&video, "A1");
    let committed = apply(
        &mut video,
        "cmd_duck",
        vec![json!({ "type": "setDucking", "sequenceId": s, "trigger": { "kind": "items", "trackIds": [a1] }, "target": { "itemIds": [counter] } })],
    )
    .unwrap();
    assert_eq!(committed.receipt.label, "Set ducking");
    let snapshot = serde_json::to_value(video.snapshot()).unwrap();
    let rule = snapshot["sequences"][&s]["ducking"][0].clone();
    let id = rule["id"].as_str().unwrap().to_string();
    assert_eq!(rule["depth"], 10.0);
    assert_eq!(rule["enabled"], true);
    assert_eq!(rule["trigger"], json!({ "kind": "items", "trackIds": [a1] }));
    assert_eq!(
        (rule["attack"].clone(), rule["release"].clone()),
        (json!({ "ticks": "1", "timescale": 50 }), json!({ "ticks": "7", "timescale": 20 }))
    );

    // 改成按文稿触发：有人说话时压低。
    let changed = apply(
        &mut video,
        "cmd_change",
        vec![
            json!({ "type": "setDucking", "sequenceId": s, "ruleId": id, "depth": 18, "release": "0.5", "name": "人声压音乐",
                     "trigger": { "kind": "speech" } }),
        ],
    )
    .unwrap();
    assert_eq!(changed.receipt.updated_ids, vec![id.clone()]);
    assert_eq!(video.snapshot().sequences[&s].ducking[0].trigger, DuckingTrigger::Speech);

    let before = video.revision();
    for (n, op) in [
        json!({ "type": "setDucking", "sequenceId": s, "trigger": { "kind": "items", "trackIds": [a1] } }),
        json!({ "type": "setDucking", "sequenceId": s, "trigger": { "kind": "items" }, "target": { "itemIds": [counter] } }),
        json!({ "type": "setDucking", "sequenceId": s, "trigger": { "trackIds": [a1] }, "target": { "itemIds": [counter] } }),
        json!({ "type": "setDucking", "sequenceId": s, "trigger": { "kind": "music" }, "target": { "itemIds": [counter] } }),
        json!({ "type": "setDucking", "sequenceId": s, "trigger": { "kind": "items", "trackIds": [a1] }, "target": { "trackIds": [a1] } }),
        json!({ "type": "setDucking", "sequenceId": s, "trigger": { "kind": "items", "trackIds": ["track_missing"] }, "target": { "itemIds": [counter] } }),
        json!({ "type": "setDucking", "sequenceId": s, "ruleId": id, "depth": -1 }),
        json!({ "type": "setDucking", "sequenceId": s, "ruleId": id, "depth": 61 }),
        json!({ "type": "setDucking", "sequenceId": s, "ruleId": id, "reductionDb": 10 }),
        json!({ "type": "setDucking", "sequenceId": s, "ruleId": id, "attack": "-0.1" }),
        json!({ "type": "setDucking", "sequenceId": s, "ruleId": id, "release": "6" }),
        json!({ "type": "removeDucking", "ruleId": "duck_missing" }),
    ]
    .into_iter()
    .enumerate()
    {
        assert!(apply(&mut video, &format!("cmd_bad_{n}"), vec![op]).is_err(), "第 {n} 个");
    }
    assert_eq!(video.revision(), before);

    undo(&mut video, "cmd_undo", &changed).unwrap();
    let rule = &video.snapshot().sequences[&s].ducking[0];
    assert_eq!((rule.depth, rule.trigger.group().is_some()), (10.0, true));

    // 目标在锁定的轨道上：不能改，也不能删。
    let v2 = track(&video, "V2");
    apply(
        &mut video,
        "cmd_lock",
        vec![json!({ "type": "updateTrack", "trackId": v2, "locked": true })],
    )
    .unwrap();
    assert_eq!(
        code(apply(
            &mut video,
            "cmd_rm_locked",
            vec![json!({ "type": "removeDucking", "ruleId": id })]
        )),
        "TARGET_LOCKED"
    );
    apply(
        &mut video,
        "cmd_unlock",
        vec![json!({ "type": "updateTrack", "trackId": v2, "locked": false })],
    )
    .unwrap();
    let removed = apply(&mut video, "cmd_rm", vec![json!({ "type": "removeDucking", "ruleId": id })]).unwrap();
    assert_eq!(removed.receipt.deleted_ids, vec![id]);
}

#[test]
fn ducking_groups_follow_splits_and_survive_deletions() {
    let Fixture {
        mut video,
        seq: s,
        counter,
        ..
    } = fixture();
    let a1 = track(&video, "A1");
    apply(
        &mut video,
        "cmd_duck",
        vec![json!({ "type": "setDucking", "sequenceId": s, "trigger": { "kind": "items", "trackIds": [a1] }, "target": { "itemIds": [counter] } })],
    )
    .unwrap();
    let id = video.snapshot().sequences[&s].ducking[0].id.clone();

    // 拆开被点名的实例：右半也在目标组里，紧跟在左半后面。
    let split = apply(
        &mut video,
        "cmd_split",
        vec![json!({ "type": "splitItem", "sequenceId": s, "itemId": counter, "at": { "unit": "frames", "value": 30 }, "alignment": "exact-frame" })],
    )
    .unwrap();
    let right = split.receipt.created_ids[0].clone();
    assert!(split.receipt.updated_ids.contains(&id));
    assert_eq!(
        video.snapshot().sequences[&s].ducking[0].target.item_ids,
        vec![counter.clone(), right.clone()]
    );

    // 删掉右半：规则里那一项留着（渲染时不匹配），规则的其他字段照样能改。
    apply(&mut video, "cmd_delete", vec![json!({ "type": "deleteItems", "itemIds": [right] })]).unwrap();
    apply(
        &mut video,
        "cmd_disable",
        vec![json!({ "type": "setDucking", "sequenceId": s, "ruleId": id, "enabled": false })],
    )
    .unwrap();
    assert!(!video.snapshot().sequences[&s].ducking[0].enabled);
    // 重新给出的组仍要全部存在。
    assert_eq!(
        code(apply(
            &mut video,
            "cmd_stale",
            vec![json!({ "type": "setDucking", "sequenceId": s, "ruleId": id, "target": { "itemIds": [counter, right] } })]
        )),
        "ENTITY_NOT_FOUND"
    );
}

/// 版本门（视频格式规范 §1.4）：读得开版本 3 与 4，写出去的是 4。版本 3 的视频第一次被改时升到 4，只读打开不动；
/// 版本 1、2 是元素模型之前的格式，说明原因并拒绝；更新的版本也拒绝。
#[test]
fn versions_three_and_four_open_and_writes_become_four() {
    let Fixture { video, _dir, .. } = fixture();
    let dir = _dir.path().join("m");
    drop(video);
    let conn = rusqlite::Connection::open(dir.join("video.db")).unwrap();
    let version = |conn: &rusqlite::Connection| -> String {
        conn.query_row("SELECT value FROM meta WHERE key = 'schemaVersion'", [], |r| r.get(0))
            .unwrap()
    };
    assert_eq!(version(&conn), "4");
    Video::open(&dir, OpenMode::ReadOnly, &ffprobe()).unwrap();

    // 旧版本写的视频：照常打开，只读与没有改动时版本不变，第一笔修改把它升到 4。
    conn.execute("UPDATE meta SET value = '3' WHERE key = 'schemaVersion'", []).unwrap();
    drop(Video::open(&dir, OpenMode::ReadOnly, &ffprobe()).unwrap());
    let mut old = Video::open(&dir, OpenMode::Write, &ffprobe()).unwrap();
    assert_eq!(version(&conn), "3");
    apply(&mut old, "cmd_touch_old", vec![json!({ "type": "renameVideo", "name": "改过名" })]).unwrap();
    assert_eq!(version(&conn), "4");
    drop(old);

    for retired in ["1", "2"] {
        conn.execute("UPDATE meta SET value = ?1 WHERE key = 'schemaVersion'", [retired])
            .unwrap();
        for mode in [OpenMode::ReadOnly, OpenMode::Write] {
            let err = Video::open(&dir, mode, &ffprobe()).err().expect("旧版本拒绝打开");
            assert_eq!(err.code, "VIDEO_UNSUPPORTED");
            assert!(err.message.contains("import again"), "{}", err.message);
            assert_eq!(err.message_ref.as_ref().map(|r| r.key.as_str()), Some("engine.schemaRetired"));
            assert_eq!(err.recovery_ref.as_ref().map(|r| r.key.as_str()), Some("engine.schemaRetiredRecovery"));
            assert_eq!(err.details["supported"], json!([3, 4]));
        }
        assert_eq!(version(&conn), retired, "拒绝时不改版本");
    }
    conn.execute("UPDATE meta SET value = '5' WHERE key = 'schemaVersion'", []).unwrap();
    let err = Video::open(&dir, OpenMode::ReadOnly, &ffprobe()).err().expect("更新的版本拒绝打开");
    assert_eq!(err.code, "VIDEO_UNSUPPORTED");
}

/// 录制在时间线上（视频格式规范 §3.18）：屏幕实例引用一份屏幕取景文档，各路流的实例登记成一个联动组。
#[test]
fn a_recording_sits_on_the_timeline_as_a_link_group_with_a_screen_view() {
    let Some((_media, path)) = clip() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(&dir.path().join("m"));
    let s = seq(&video);
    let png = dir.path().join("badge.png");
    fs::write(&png, include_bytes!("../../caption-scene/tests/fixtures/badge.png")).unwrap();
    let committed = apply(
        &mut video,
        "cmd_add",
        vec![
            json!({ "type": "importAsset", "path": path, "ref": "clip" }),
            json!({ "type": "importAsset", "path": png, "ref": "png" }),
            json!({ "type": "addItem", "sequenceId": s, "asset": { "ref": "clip" }, "alignment": "nearest-frame" }),
        ],
    )
    .unwrap();
    let id = committed
        .receipt
        .created_ids
        .iter()
        .find(|id| video.state().items.contains_key(*id))
        .unwrap()
        .clone();
    let TimelineItem::Video(item) = &video.state().items[&id].value else { unreachable!() };
    let screen = json!({ "id": item.asset_ref.id, "revision": item.asset_ref.revision });
    let other = video.state().assets.keys().find(|a| **a != item.asset_ref.id).unwrap().clone();

    let view = |clock: &str| json!({ "schema": "baocut.screen-view/1", "timescale": 1000, "clock": clock, "solver": 1,
        "zooms": [{ "id": "z1", "t0": "200", "t1": "1800", "scale": 2.0, "focus": { "kind": "point", "x": 0.5, "y": 0.5 }, "origin": "manual" }] });
    apply(
        &mut video,
        "cmd_documents",
        vec![
            json!({ "type": "putDocument", "kind": "recording", "ref": "rec", "body": {
                "schema": "baocut.recording/1", "timescale": 1000, "clock": "recording", "recorder": { "name": "test" },
                "duration": "2000", "segments": [{ "id": "s0", "t0": "0", "t1": "2000" }],
                "streams": [{ "id": "s0-screen", "role": "screen", "segmentId": "s0", "assetRef": screen, "start": "0" }],
                "pointer": { "mode": "none" } } }),
            json!({ "type": "putDocument", "kind": "screen-view", "name": "view", "sourceDocument": { "ref": "rec" }, "body": view("recording") }),
            json!({ "type": "putDocument", "kind": "screen-view", "name": "elsewhere", "sourceAsset": { "assetId": other }, "body": view("source-asset") }),
        ],
    )
    .unwrap();
    let doc = |video: &Video, name: &str| video.state().documents.values().find(|d| d.name == name).unwrap().id.clone();
    let (rec, good, elsewhere) = (doc(&video, "recording"), doc(&video, "view"), doc(&video, "elsewhere"));
    let item_json = |video: &Video| serde_json::to_value(&video.state().items[&id].value).unwrap();
    let groups = |video: &Video| serde_json::to_value(&video.state().sequences[&s].header).unwrap()["linkGroups"].clone();

    // 屏幕取景：文档要是给这段画面写的；不与分屏并存；能去掉。
    for (n, wrong) in [&rec, &elsewhere].into_iter().enumerate() {
        let refused = apply(&mut video, &format!("cmd_view_wrong_{n}"), vec![json!({ "type": "setStyle", "itemId": id, "screenView": { "documentId": wrong } })]);
        assert_eq!(code(refused), "INVALID_OPERATION", "第 {n} 个");
    }
    apply(&mut video, "cmd_view", vec![json!({ "type": "setStyle", "itemId": id, "screenView": { "documentId": good } })]).unwrap();
    assert_eq!(item_json(&video)["screenView"], json!({ "documentId": good }));
    let rows = json!([
        { "rect": { "x": 0, "y": 0, "w": 100, "h": 50 }, "focalPoint": { "x": 0.25, "y": 0.4, "zoom": 1.4 } },
        { "rect": { "x": 0, "y": 50, "w": 100, "h": 50 }, "focalPoint": { "x": 0.75, "y": 0.4, "zoom": 1.4 } },
    ]);
    let refused = apply(&mut video, "cmd_panels", vec![json!({ "type": "setStyle", "itemId": id, "fit": "cover", "panels": rows })]);
    assert!(refused.expect_err("分屏与取景不并存").message.contains("panels"));

    // 联动组：登记、不重复登记、撤销、解组，成员删光时登记跟着删掉。
    let refused = apply(&mut video, "cmd_link_kind", vec![json!({ "type": "linkItems", "itemIds": [id], "kind": "other" })]);
    assert_eq!(code(refused), "INVALID_OPERATION");
    let refused = apply(&mut video, "cmd_link_doc", vec![json!({ "type": "linkItems", "itemIds": [id], "kind": "recording", "recording": { "documentId": good } })]);
    assert!(refused.expect_err("清单的种类不对").message.contains("recording manifest"));
    let link = json!({ "type": "linkItems", "itemIds": [id], "kind": "recording", "recording": { "documentId": rec } });
    let linked = apply(&mut video, "cmd_link", vec![link.clone()]).unwrap();
    let group = item_json(&video)["linkGroupId"].as_str().unwrap().to_string();
    assert_eq!(groups(&video), json!([{ "id": group, "kind": "recording", "syncVersion": 1, "recordingId": rec }]));
    let refused = apply(&mut video, "cmd_link_again", vec![link.clone()]);
    assert!(refused.expect_err("已经在组里").message.contains("already belongs"));
    undo(&mut video, "cmd_link_undo", &linked).unwrap();
    assert_eq!(groups(&video), Value::Null);
    assert_eq!(item_json(&video)["linkGroupId"], Value::Null);

    apply(&mut video, "cmd_relink", vec![link.clone()]).unwrap();
    let group = item_json(&video)["linkGroupId"].as_str().unwrap().to_string();
    assert_eq!(code(apply(&mut video, "cmd_unlink_missing", vec![json!({ "type": "unlinkItems", "groupId": "lg_none" })])), "INVALID_OPERATION");
    apply(&mut video, "cmd_unlink", vec![json!({ "type": "unlinkItems", "groupId": group })]).unwrap();
    assert_eq!(groups(&video), Value::Null);
    assert_eq!(item_json(&video)["linkGroupId"], Value::Null);

    apply(&mut video, "cmd_link_last", vec![link]).unwrap();
    assert_eq!(groups(&video).as_array().map(Vec::len), Some(1));
    // 保存成快照再读回来，取景与登记都在。
    let snapshot = serde_json::to_value(video.snapshot()).unwrap();
    assert_eq!(snapshot["schemaVersion"], json!(4));
    assert_eq!(snapshot["sequences"][&s]["linkGroups"].as_array().map(Vec::len), Some(1));
    assert_eq!(snapshot["sequences"][&s]["items"][0]["screenView"], json!({ "documentId": good }));
    apply(&mut video, "cmd_delete", vec![json!({ "type": "deleteItems", "itemIds": [id] })]).unwrap();
    assert_eq!(groups(&video), Value::Null);
}
