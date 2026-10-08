//! 原地替换代码画面（`replaceCodeBundle`，代码包规范 §3.3）：只换代码包版本与替身，实例的其余部分不变；
//! 长度跟新版本走，变短裁掉、变长撞上后面的实例就拒绝；参数 Schema 变了要给新参数。
//! 替身的测试用 ffmpeg 现场生成视频，没有 ffmpeg 时跳过并打印原因。

#![allow(clippy::result_large_err)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use editor_semantics::{Rate, TimeMap};
use serde_json::{Value, json};
use video_engine::model::{Actor, ActorKind, CompositionItem, CompositionSource, TimelineItem, VersionRef};
use video_engine::{CreateOptions, ErrorBody, UndoRequest, UndoTarget, Video, VideoTransaction};

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
        name: "测试视频".into(),
        fps: Rate { num: 30, den: 1 },
        width: 1920,
        height: 1080,
    };
    Video::create(dir, &options, &ffprobe()).expect("新建视频")
}

fn apply(video: &mut Video, command_id: &str, operations: Vec<Value>) -> Result<video_engine::Committed, ErrorBody> {
    let transaction = VideoTransaction {
        command_id: command_id.into(),
        expected_revision: video.revision(),
        label: None,
        operations,
        actor: user(),
        task_id: None,
    };
    video.apply(&transaction)
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

/// 一个代码包目录：内容不同就是不同的素材。清单的 intrinsic 是 30 fps 下的帧数。
fn bundle_dir(root: &Path, name: &str, frames: i64, schema: Option<&str>) -> (PathBuf, Value) {
    let dir = root.join(name);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("index.html"), format!("<html><body>{name}</body></html>")).unwrap();
    let mut manifest = json!({
        "engine": "browser", "entry": "index.html",
        "intrinsic": { "width": 1920, "height": 1080, "fps": { "num": 30, "den": 1 }, "durationFrames": frames },
    });
    if let Some(schema) = schema {
        manifest["parametersSchemaRef"] = json!(schema);
    }
    (dir, manifest)
}

/// 导入一个代码包，返回它当前版本的引用。
fn import_bundle(video: &mut Video, root: &Path, name: &str, frames: i64, schema: Option<&str>) -> Value {
    let (dir, manifest) = bundle_dir(root, name, frames, schema);
    let committed = apply(
        video,
        &format!("cmd_import_{name}"),
        vec![json!({ "type": "importAsset", "path": dir, "ref": "b", "bundle": manifest })],
    )
    .unwrap();
    let id = committed.receipt.refs["b"].clone();
    json!({ "id": id, "revision": video.state().assets[&id].current_revision })
}

fn composition(video: &Video, id: &str) -> CompositionItem {
    match &video.state().items[id].value {
        TimelineItem::Composition(c) => c.clone(),
        other => panic!("不是合成：{other:?}"),
    }
}

fn bundle_ref(c: &CompositionItem) -> &VersionRef {
    let CompositionSource::Bundle { asset_ref } = &c.source;
    asset_ref
}

/// 时间线上的一个合成：第 60 帧起，长 `frames` 帧，带参数。
fn place_composition(video: &mut Video, bundle: &Value, frames: i64, params: Value) -> String {
    let s = seq(video);
    let item = json!({
        "type": "composition", "trackId": track(video, "V1"), "span": { "fromFrame": 60, "durationFrames": frames },
        "name": "下三分之一", "place": { "x": 30, "y": 80, "w": 40, "opacity": 0.9 },
        "source": { "kind": "bundle", "assetRef": bundle },
        "parameterValues": params,
        "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 30 }, "rate": { "num": 1, "den": 1 } },
        "fx": { "blur": 2 },
    });
    let committed = apply(
        video,
        "cmd_place",
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": [item] })],
    )
    .unwrap();
    committed.receipt.created_ids[0].clone()
}

#[test]
fn replace_keeps_the_clip_and_swaps_only_the_source() {
    let root = tempfile::tempdir().unwrap();
    let mut video = new_video(&root.path().join("m"));
    let rev1 = import_bundle(&mut video, root.path(), "rev1", 120, Some("params.json"));
    let rev2 = import_bundle(&mut video, root.path(), "rev2", 60, Some("params.json"));
    let id = place_composition(&mut video, &rev1, 120, json!({ "title": "你好" }));
    apply(
        &mut video,
        "cmd_keys",
        vec![json!({ "type": "setKeyframes", "itemId": id, "property": "opacity",
                    "keyframes": [{ "localFrame": 0, "value": 0.0 }, { "localFrame": 30, "value": 1.0 }] })],
    )
    .unwrap();
    let before = composition(&video, &id);
    let bindings_before = video.snapshot().sequences[&seq(&video)].header.animation_bindings.clone();

    // 新版本短一半：没有替身时长度取清单的 intrinsic；参数 Schema 没变，旧参数原样保留。
    let committed = apply(
        &mut video,
        "cmd_replace",
        vec![json!({ "type": "replaceCodeBundle", "itemId": id, "assetRef": rev2 })],
    )
    .unwrap();
    let replaced_tx = committed.receipt.transaction_id.clone();
    assert_eq!(committed.receipt.label, "替换代码画面");
    assert_eq!(committed.receipt.updated_ids, vec![id.clone()]);
    assert!(committed.receipt.created_ids.is_empty() && committed.receipt.deleted_ids.is_empty());

    let after = composition(&video, &id);
    assert_eq!(serde_json::to_value(bundle_ref(&after)).unwrap(), rev2);
    assert_eq!(after.prerender, None);
    assert_eq!(
        (after.span.from_frame, after.span.duration_frames),
        (60, 60),
        "起点不变，变短就裁掉"
    );
    assert!(matches!(&after.time_map, TimeMap::Linear { source_in, rate } if source_in.ticks == "0" && rate.num == rate.den));
    // 其余部分不变：ID、轨道、名字、几何与不透明度、效果、参数、开关与锁、跟随、lineage。
    assert_eq!(after.base, before.base);
    assert_eq!(after.place, before.place);
    assert_eq!(after.fx, before.fx);
    assert_eq!(after.mask, before.mask);
    assert_eq!(after.audio, before.audio);
    assert_eq!(after.parameter_values, json!({ "title": "你好" }));
    // 关键帧都在新窗口之内：原样保留。
    assert_eq!(video.snapshot().sequences[&seq(&video)].header.animation_bindings, bindings_before);

    // 回执说明改的是源这一层，以及长度从 120 帧变成 60 帧。
    let impact = serde_json::to_value(&committed.receipt.impact).unwrap();
    assert_eq!(
        impact["codeEdits"],
        json!([{
            "itemId": id, "layer": "source",
            "previousBundleRef": rev1, "bundleRef": rev2,
            "previousPrerender": null, "prerender": null,
            "oldDurationFrames": 120, "newDurationFrames": 60,
        }])
    );

    // 撤销换回旧版本与旧长度。
    video
        .undo(&UndoRequest {
            command_id: "cmd_undo".into(),
            target: UndoTarget::Transaction(replaced_tx),
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
    let undone = composition(&video, &id);
    assert_eq!(serde_json::to_value(bundle_ref(&undone)).unwrap(), rev1);
    assert_eq!(undone.span.duration_frames, 120);
}

#[test]
fn a_longer_version_that_runs_into_the_next_clip_is_refused() {
    let root = tempfile::tempdir().unwrap();
    let mut video = new_video(&root.path().join("m"));
    let short = import_bundle(&mut video, root.path(), "short", 60, None);
    let long = import_bundle(&mut video, root.path(), "long", 120, None);
    let id = place_composition(&mut video, &short, 60, json!({}));
    let s = seq(&video);
    let next = json!({ "type": "text", "trackId": track(&video, "V1"), "span": { "fromFrame": 150, "durationFrames": 30 },
                       "text": "后面", "style": {} });
    let committed = apply(
        &mut video,
        "cmd_next",
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": [next] })],
    )
    .unwrap();
    let next_id = committed.receipt.created_ids[0].clone();

    let before = video.revision();
    let err = apply(
        &mut video,
        "cmd_replace_long",
        vec![json!({ "type": "replaceCodeBundle", "itemId": id, "assetRef": long })],
    )
    .unwrap_err();
    assert_eq!(err.code, "TIMELINE_OVERLAP");
    assert!(err.entity_ids.contains(&id) && err.entity_ids.contains(&next_id));
    let recovery = err.recovery.clone().unwrap();
    assert!(recovery.contains("moveItem") && recovery.contains("deleteItems"), "{recovery}");
    assert_eq!(video.revision(), before);

    // 后面的实例挪开之后就能换，长度变成 120 帧。
    apply(
        &mut video,
        "cmd_move",
        vec![json!({ "type": "moveItem", "sequenceId": s, "itemId": next_id, "at": { "unit": "frames", "value": 200 }, "alignment": "exact-frame" })],
    )
    .unwrap();
    apply(
        &mut video,
        "cmd_replace_long_again",
        vec![json!({ "type": "replaceCodeBundle", "itemId": id, "assetRef": long })],
    )
    .unwrap();
    assert_eq!(composition(&video, &id).span.duration_frames, 120);
}

#[test]
fn only_composition_clips_and_bundle_assets_are_accepted() {
    let root = tempfile::tempdir().unwrap();
    let mut video = new_video(&root.path().join("m"));
    let rev1 = import_bundle(&mut video, root.path(), "rev1", 60, None);
    let id = place_composition(&mut video, &rev1, 60, json!({}));
    let s = seq(&video);
    let text = json!({ "type": "text", "trackId": track(&video, "V1"), "span": { "fromFrame": 0, "durationFrames": 30 },
                       "text": "标题", "style": {} });
    let text_id = apply(
        &mut video,
        "cmd_text",
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": [text] })],
    )
    .unwrap()
    .receipt
    .created_ids[0]
        .clone();
    let logo = root.path().join("logo.svg");
    fs::write(&logo, "<svg xmlns=\"http://www.w3.org/2000/svg\"/>").unwrap();
    let image = apply(
        &mut video,
        "cmd_logo",
        vec![json!({ "type": "importAsset", "path": logo, "ref": "logo" })],
    )
    .unwrap()
    .receipt
    .refs["logo"]
        .clone();
    let image = json!({ "id": image, "revision": "1" });

    let before = video.revision();
    let cases = [
        // 不是合成实例。
        json!({ "type": "replaceCodeBundle", "itemId": text_id, "assetRef": rev1 }),
        // 素材不是代码包。
        json!({ "type": "replaceCodeBundle", "itemId": id, "assetRef": image }),
        // 替身不是视频。
        json!({ "type": "replaceCodeBundle", "itemId": id, "assetRef": rev1, "prerender": image }),
        // 参数不是对象。
        json!({ "type": "replaceCodeBundle", "itemId": id, "assetRef": rev1, "parameterValues": [] }),
    ];
    for (n, op) in cases.into_iter().enumerate() {
        let err = apply(&mut video, &format!("cmd_bad_{n}"), vec![op]).unwrap_err();
        assert_eq!(err.code, "INVALID_OPERATION", "第 {n} 个：{}", err.message);
    }
    // 版本不存在。
    let err = apply(
        &mut video,
        "cmd_missing",
        vec![json!({ "type": "replaceCodeBundle", "itemId": id, "assetRef": { "id": rev1["id"], "revision": "9" } })],
    )
    .unwrap_err();
    assert_eq!(err.code, "ASSET_MISSING");
    assert_eq!(video.revision(), before);

    // 锁定的片段不能换。
    apply(
        &mut video,
        "cmd_lock",
        vec![json!({ "type": "updateItem", "itemId": id, "locked": true })],
    )
    .unwrap();
    let err = apply(
        &mut video,
        "cmd_locked",
        vec![json!({ "type": "replaceCodeBundle", "itemId": id, "assetRef": rev1 })],
    )
    .unwrap_err();
    assert_eq!(err.code, "TARGET_LOCKED");
}

#[test]
fn changed_parameter_schema_needs_new_parameter_values() {
    let root = tempfile::tempdir().unwrap();
    let mut video = new_video(&root.path().join("m"));
    let rev1 = import_bundle(&mut video, root.path(), "rev1", 60, Some("params-v1.json"));
    let no_schema = import_bundle(&mut video, root.path(), "rev2", 60, None);
    let other_schema = import_bundle(&mut video, root.path(), "rev3", 60, Some("params-v2.json"));
    let id = place_composition(&mut video, &rev1, 60, json!({ "title": "你好" }));

    let before = video.revision();
    for (n, target) in [&no_schema, &other_schema].into_iter().enumerate() {
        let err = apply(
            &mut video,
            &format!("cmd_gate_{n}"),
            vec![json!({ "type": "replaceCodeBundle", "itemId": id, "assetRef": target })],
        )
        .unwrap_err();
        assert_eq!(err.code, "INVALID_OPERATION");
        assert_eq!(err.details["rule"], "parameters-incompatible");
    }
    assert_eq!(video.revision(), before);

    // 同时给出新参数就可以换。
    apply(
        &mut video,
        "cmd_with_values",
        vec![json!({ "type": "replaceCodeBundle", "itemId": id, "assetRef": other_schema, "parameterValues": { "headline": "新的" } })],
    )
    .unwrap();
    assert_eq!(composition(&video, &id).parameter_values, json!({ "headline": "新的" }));

    // 没有参数的片段不受这条限制。
    let plain = import_bundle(&mut video, root.path(), "rev4", 30, Some("params-v1.json"));
    apply(
        &mut video,
        "cmd_clear",
        vec![json!({ "type": "replaceCodeBundle", "itemId": id, "assetRef": plain, "parameterValues": {} })],
    )
    .unwrap();
    apply(
        &mut video,
        "cmd_no_values",
        vec![json!({ "type": "replaceCodeBundle", "itemId": id, "assetRef": no_schema })],
    )
    .unwrap();
}

/// 2 秒 30 fps 的视频（60 帧），当作预渲染替身。
fn prerender_clip(dir: &Path) -> Option<PathBuf> {
    let path = dir.join("prerender.mp4");
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
    Some(path)
}

#[test]
fn the_prerender_sets_the_new_length() {
    let root = tempfile::tempdir().unwrap();
    let Some(clip) = prerender_clip(root.path()) else { return };
    let mut video = new_video(&root.path().join("m"));
    let rev1 = import_bundle(&mut video, root.path(), "rev1", 120, None);
    // 清单写 120 帧，替身只有 60 帧：长度以替身为准。
    let rev2 = import_bundle(&mut video, root.path(), "rev2", 120, None);
    let id = place_composition(&mut video, &rev1, 120, json!({}));
    let prerender = apply(
        &mut video,
        "cmd_pr",
        vec![json!({ "type": "importAsset", "path": clip, "ref": "pr" })],
    )
    .unwrap()
    .receipt
    .refs["pr"]
        .clone();
    let prerender = json!({ "id": prerender, "revision": "1" });
    let committed = apply(
        &mut video,
        "cmd_replace",
        vec![json!({ "type": "replaceCodeBundle", "itemId": id, "assetRef": rev2, "prerender": prerender })],
    )
    .unwrap();
    let after = composition(&video, &id);
    assert_eq!(serde_json::to_value(after.prerender.as_ref().unwrap()).unwrap(), prerender);
    assert_eq!(after.span.duration_frames, 60);
    let impact = serde_json::to_value(&committed.receipt.impact).unwrap();
    assert_eq!(impact["codeEdits"][0]["newDurationFrames"], 60);
    assert_eq!(impact["codeEdits"][0]["prerender"], prerender);

    // `prerender: null` 去掉替身，长度回到清单的 intrinsic。
    apply(
        &mut video,
        "cmd_drop_prerender",
        vec![json!({ "type": "replaceCodeBundle", "itemId": id, "assetRef": rev2, "prerender": null })],
    )
    .unwrap();
    let after = composition(&video, &id);
    assert_eq!((after.prerender, after.span.duration_frames), (None, 120));
}
