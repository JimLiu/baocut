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
    assert_eq!(committed.receipt.label, "修改效果");
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
fn chapters_are_set_upserted_and_removed() {
    let Fixture {
        mut video, seq: s, text, ..
    } = fixture();
    let op = json!({ "type": "setChapters", "sequenceId": s, "alignment": "nearest-frame", "chapters": [
        { "at": { "unit": "seconds", "value": "0" }, "title": "开场" },
        { "at": { "unit": "seconds", "value": "1.01" }, "title": "  正文  ", "summary": "讲重点" },
    ] });
    let committed = apply(&mut video, "cmd_set", vec![op]).unwrap();
    assert_eq!(committed.receipt.label, "设置章节");
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
    assert_eq!(removed.receipt.label, "删除章节");

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
    assert_eq!(committed.receipt.label, "设置闪避");
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

/// 版本门（视频格式规范 §1.4）：只读写版本 3。版本 1、2 是元素模型之前的格式，说明原因并拒绝；更新的版本也拒绝。
#[test]
fn only_version_three_videos_open() {
    let Fixture { video, _dir, .. } = fixture();
    let dir = _dir.path().join("m");
    drop(video);
    let conn = rusqlite::Connection::open(dir.join("video.db")).unwrap();
    let version = |conn: &rusqlite::Connection| -> String {
        conn.query_row("SELECT value FROM meta WHERE key = 'schemaVersion'", [], |r| r.get(0))
            .unwrap()
    };
    assert_eq!(version(&conn), "3");
    Video::open(&dir, OpenMode::ReadOnly, &ffprobe()).unwrap();

    for old in ["1", "2"] {
        conn.execute("UPDATE meta SET value = ?1 WHERE key = 'schemaVersion'", [old])
            .unwrap();
        for mode in [OpenMode::ReadOnly, OpenMode::Write] {
            let err = Video::open(&dir, mode, &ffprobe()).err().expect("旧版本拒绝打开");
            assert_eq!(err.code, "VIDEO_UNSUPPORTED");
            assert!(err.message.contains("import again"), "{}", err.message);
            assert_eq!(err.message_ref.as_ref().map(|r| r.key.as_str()), Some("engine.schemaRetired"));
            assert_eq!(err.recovery_ref.as_ref().map(|r| r.key.as_str()), Some("engine.schemaRetiredRecovery"));
            assert_eq!(err.details["supported"], json!([3]));
        }
        assert_eq!(version(&conn), old, "拒绝时不改版本");
    }
    conn.execute("UPDATE meta SET value = '4' WHERE key = 'schemaVersion'", []).unwrap();
    let err = Video::open(&dir, OpenMode::ReadOnly, &ffprobe()).err().expect("更新的版本拒绝打开");
    assert_eq!(err.code, "VIDEO_UNSUPPORTED");
}
