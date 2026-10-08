//! 清理：删空轨道（`deleteTrack`）与删没有引用的素材（`removeAssets`、`Video::unused_assets`）。
//! 代码包与它烘焙出的预渲染替身成对删除；还有引用的素材、还有片段的轨道都拒绝。

#![allow(clippy::result_large_err)]

use std::fs;
use std::path::{Path, PathBuf};

use editor_semantics::Rate;
use serde_json::{Value, json};
use video_engine::model::{Actor, ActorKind};
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
        name: "清理".into(),
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

fn undo(video: &mut Video, command_id: &str, transaction_id: &str) {
    video
        .undo(&UndoRequest {
            command_id: command_id.into(),
            target: UndoTarget::Transaction(transaction_id.into()),
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
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

fn order(video: &Video, id: &str) -> i64 {
    video.state().tracks[id].value.order
}

/// 一个代码包：清单带 `bundleId/revision`（预渲染替身的烘焙记录按它配对）。
fn import_bundle(video: &mut Video, root: &Path, bundle_id: &str, revision: &str) -> Value {
    let dir = root.join(format!("{bundle_id}-{revision}"));
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("index.html"), format!("<html><body>{bundle_id} {revision}</body></html>")).unwrap();
    let manifest = json!({
        "bundleId": bundle_id, "revision": revision, "engine": "browser", "entry": "index.html",
        "intrinsic": { "width": 1920, "height": 1080, "fps": { "num": 30, "den": 1 }, "durationFrames": 60 },
    });
    let committed = apply(
        video,
        &format!("cmd_bundle_{bundle_id}_{revision}"),
        vec![json!({ "type": "importAsset", "path": dir, "ref": "b", "bundle": manifest })],
    )
    .unwrap();
    let id = committed.receipt.refs["b"].clone();
    json!({ "id": id, "revision": video.state().assets[&id].current_revision })
}

/// 一个小图片素材；给了 `baked_from` 时按烘焙出的预渲染替身记来源（不用 ffmpeg 也能测配对）。
fn import_image(video: &mut Video, root: &Path, name: &str, baked_from: Option<(&str, &str)>) -> String {
    let path = root.join(format!("{name}.svg"));
    fs::write(
        &path,
        format!(r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><title>{name}</title></svg>"#),
    )
    .unwrap();
    let mut op = json!({ "type": "importAsset", "path": path, "ref": "i", "storage": "managed" });
    if let Some((bundle_id, revision)) = baked_from {
        op["provenance"] = json!({
            "origin": "composition-bake",
            "source": { "sourceBundleRef": { "id": bundle_id, "revision": revision }, "status": "current" },
        });
    }
    apply(video, &format!("cmd_image_{name}"), vec![op]).unwrap().receipt.refs["i"].clone()
}

fn place_composition(video: &mut Video, bundle: &Value) -> String {
    let s = seq(video);
    let item = json!({
        "type": "composition", "trackId": track(video, "V1"), "span": { "fromFrame": 0, "durationFrames": 60 },
        "source": { "kind": "bundle", "assetRef": bundle }, "parameterValues": {},
        "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 30 }, "rate": { "num": 1, "den": 1 } },
    });
    apply(
        video,
        "cmd_place",
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": [item] })],
    )
    .unwrap()
    .receipt
    .created_ids[0]
        .clone()
}

fn impact(committed: &video_engine::Committed) -> Value {
    serde_json::to_value(&committed.receipt.impact).unwrap()
}

#[test]
fn a_track_with_clips_is_not_deleted() {
    let root = tempfile::tempdir().unwrap();
    let mut video = new_video(&root.path().join("m"));
    let bundle = import_bundle(&mut video, root.path(), "title", "1");
    let item = place_composition(&mut video, &bundle);
    let v1 = track(&video, "V1");
    let revision = video.revision();

    let err = apply(&mut video, "cmd_delete_v1", vec![json!({ "type": "deleteTrack", "trackId": v1 })]).unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");
    assert_eq!(err.details["rule"], "track-not-empty");
    assert_eq!(err.details["itemIds"], json!([item]));
    assert_eq!(err.details["next"], json!(["deleteItems", "moveItem"]));
    assert!(err.recovery.as_deref().unwrap().contains("deleteItems"));
    assert!(err.entity_ids.contains(&v1));
    assert_eq!(video.revision(), revision, "拒绝时视频不变");

    // 同一笔里先删片段再删轨道就可以。
    let committed = apply(
        &mut video,
        "cmd_delete_both",
        vec![
            json!({ "type": "deleteItems", "itemIds": [item] }),
            json!({ "type": "deleteTrack", "trackId": v1 }),
        ],
    )
    .unwrap();
    assert!(committed.receipt.deleted_ids.contains(&v1));
    assert_eq!(impact(&committed)["removedTracks"], json!([v1]));
}

#[test]
fn deleting_an_empty_track_keeps_the_other_orders() {
    let root = tempfile::tempdir().unwrap();
    let mut video = new_video(&root.path().join("m"));
    let s = seq(&video);
    let (v1, a1) = (track(&video, "V1"), track(&video, "A1"));
    let added = apply(
        &mut video,
        "cmd_add",
        vec![
            json!({ "type": "addTrack", "kind": "visual", "name": "V2", "ref": "v2" }),
            json!({ "type": "addTrack", "kind": "visual", "name": "V3", "ref": "v3" }),
        ],
    )
    .unwrap();
    let (v2, v3) = (added.receipt.refs["v2"].clone(), added.receipt.refs["v3"].clone());
    let before: Vec<i64> = [&v1, &a1, &v2, &v3].iter().map(|id| order(&video, id)).collect();
    assert_eq!(before, vec![0, 1, 2, 3]);

    // 删中间那条：别的轨道的 order 不动（addTrack 取最大值加一、不动别人，删除也不动别人）。
    let committed = apply(
        &mut video,
        "cmd_delete_v2",
        vec![json!({ "type": "deleteTrack", "sequenceId": s, "trackId": v2 })],
    )
    .unwrap();
    assert_eq!(committed.receipt.deleted_ids, vec![v2.clone()]);
    assert!(
        committed.receipt.updated_ids.iter().all(|id| ![&v1, &a1, &v3].contains(&id)),
        "其他轨道没有改"
    );
    assert_eq!(impact(&committed)["removedTracks"], json!([v2]));
    assert!(!video.state().tracks.contains_key(&v2));
    assert_eq!([&v1, &a1, &v3].map(|id| order(&video, id)), [0, 1, 3]);

    // 再新建一条接在最上面：order 仍取最大值加一。
    let again = apply(
        &mut video,
        "cmd_add_again",
        vec![json!({ "type": "addTrack", "kind": "visual", "ref": "v4" })],
    )
    .unwrap();
    assert_eq!(order(&video, &again.receipt.refs["v4"]), 4);

    // 撤销删除：轨道连同原来的 order 回来。
    undo(&mut video, "cmd_undo_delete", &committed.receipt.transaction_id);
    assert_eq!(order(&video, &v2), 2);
}

#[test]
fn locked_or_ducked_tracks_are_not_deleted() {
    let root = tempfile::tempdir().unwrap();
    let mut video = new_video(&root.path().join("m"));
    let s = seq(&video);
    let a1 = track(&video, "A1");
    let added = apply(
        &mut video,
        "cmd_add",
        vec![json!({ "type": "addTrack", "kind": "audio", "name": "BGM", "ref": "bgm" })],
    )
    .unwrap();
    let bgm = added.receipt.refs["bgm"].clone();

    apply(
        &mut video,
        "cmd_lock",
        vec![json!({ "type": "updateTrack", "trackId": bgm, "locked": true })],
    )
    .unwrap();
    let err = apply(
        &mut video,
        "cmd_delete_locked",
        vec![json!({ "type": "deleteTrack", "trackId": bgm })],
    )
    .unwrap_err();
    assert_eq!(err.code, "TARGET_LOCKED");
    apply(
        &mut video,
        "cmd_unlock",
        vec![json!({ "type": "updateTrack", "trackId": bgm, "locked": false })],
    )
    .unwrap();

    apply(
        &mut video,
        "cmd_duck",
        vec![json!({ "type": "setDucking", "sequenceId": s, "trigger": { "kind": "items", "trackIds": [a1] }, "target": { "trackIds": [bgm] } })],
    )
    .unwrap();
    let err = apply(
        &mut video,
        "cmd_delete_ducked",
        vec![json!({ "type": "deleteTrack", "trackId": bgm })],
    )
    .unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");
    assert_eq!(err.details["rule"], "track-in-ducking");
    assert_eq!(err.details["next"], json!(["setDucking", "removeDucking"]));

    let err = apply(
        &mut video,
        "cmd_delete_other_seq",
        vec![json!({ "type": "deleteTrack", "sequenceId": "seq_x", "trackId": a1 })],
    )
    .unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");
}

#[test]
fn unused_assets_lists_what_nothing_refers_to_and_remove_assets_deletes_it() {
    let root = tempfile::tempdir().unwrap();
    let mut video = new_video(&root.path().join("m"));
    let used = import_bundle(&mut video, root.path(), "title", "1");
    let used_id = used["id"].as_str().unwrap().to_string();
    place_composition(&mut video, &used);
    let loose = import_image(&mut video, root.path(), "loose", None);
    let thumb = import_image(&mut video, root.path(), "thumb", None);
    let spoken = import_image(&mut video, root.path(), "spoken", None);
    let s = seq(&video);
    apply(
        &mut video,
        "cmd_refs",
        vec![
            json!({ "type": "upsertChapter", "sequenceId": s, "at": { "unit": "frames", "value": 0 }, "alignment": "exact-frame",
                    "title": "开场", "thumbnail": { "assetId": thumb } }),
            json!({ "type": "putDocument", "kind": "speech", "sourceAsset": { "assetId": spoken },
                    "body": { "words": [{ "id": "w1", "text": "你好" }] } }),
        ],
    )
    .unwrap();

    // 预检清单：只有谁都不指向的那个；实例、章节缩略图、文档来源都算引用。
    let unused = serde_json::to_value(video.unused_assets()).unwrap();
    assert_eq!(unused.as_array().unwrap().len(), 1, "{unused}");
    assert_eq!(unused[0]["assetId"], loose);
    assert_eq!(unused[0]["kind"], "image");
    assert_eq!(unused[0]["storage"], "managed");
    assert!(unused[0]["byteLength"].as_u64().unwrap() > 0);
    assert!(unused[0].get("pairedWith").is_none());

    // 删有引用的：拒绝，说出谁在用。
    for (id, user) in [(&used_id, "item"), (&thumb, "marker"), (&spoken, "document")] {
        let err = apply(
            &mut video,
            &format!("cmd_remove_{user}"),
            vec![json!({ "type": "removeAssets", "assetIds": [id] })],
        )
        .unwrap_err();
        assert_eq!(err.code, "INVALID_OPERATION", "{user}");
        assert_eq!(err.details["rule"], "asset-in-use", "{user}");
        assert_eq!(err.details["usedBy"][id.as_str()].as_array().unwrap().len(), 1, "{user}");
        assert!(err.entity_ids.contains(id));
    }
    let err = apply(
        &mut video,
        "cmd_remove_ghost",
        vec![json!({ "type": "removeAssets", "assetIds": ["asset_ghost"] })],
    )
    .unwrap_err();
    assert_eq!(err.code, "ENTITY_NOT_FOUND");
    let err = apply(
        &mut video,
        "cmd_remove_none",
        vec![json!({ "type": "removeAssets", "assetIds": [] })],
    )
    .unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");

    // 真删：记录没了，回执列在 deletedIds 与 impact.removedAssets；bytes 不动（撤销能放回来）。
    let blob_count = || fs::read_dir(root.path().join("m").join("blobs")).unwrap().count();
    let blobs = blob_count();
    let committed = apply(
        &mut video,
        "cmd_remove_loose",
        vec![json!({ "type": "removeAssets", "assetIds": [loose] })],
    )
    .unwrap();
    assert_eq!(committed.receipt.deleted_ids, vec![loose.clone()]);
    assert_eq!(impact(&committed)["removedAssets"], json!([loose]));
    assert!(!video.state().assets.contains_key(&loose));
    assert!(video.unused_assets().is_empty());
    assert_eq!(blob_count(), blobs);
    undo(&mut video, "cmd_undo_remove", &committed.receipt.transaction_id);
    assert!(video.state().assets.contains_key(&loose));
}

#[test]
fn a_replaced_bundle_and_its_prerender_go_together() {
    let root = tempfile::tempdir().unwrap();
    let mut video = new_video(&root.path().join("m"));
    let rev1 = import_bundle(&mut video, root.path(), "lower-third", "1");
    let rev2 = import_bundle(&mut video, root.path(), "lower-third", "2");
    let rev1_id = rev1["id"].as_str().unwrap().to_string();
    let pre1 = import_image(&mut video, root.path(), "pre1", Some(("lower-third", "1")));
    let pre2 = import_image(&mut video, root.path(), "pre2", Some(("lower-third", "2")));
    let item = place_composition(&mut video, &rev1);
    // 这里的替身是图片，挂不到实例上（替身要视频）；配对只看烘焙来源，与挂没挂上无关。

    // 换成第 2 版之后，第 1 版的代码包与替身都没有引用了，清单里互相标出另一半。
    apply(
        &mut video,
        "cmd_replace",
        vec![json!({ "type": "replaceCodeBundle", "itemId": item, "assetRef": rev2 })],
    )
    .unwrap();
    let unused = serde_json::to_value(video.unused_assets()).unwrap();
    let entry = |id: &str| unused.as_array().unwrap().iter().find(|e| e["assetId"] == id).cloned();
    assert_eq!(entry(&rev1_id).unwrap()["pairedWith"], json!([pre1]));
    assert_eq!(entry(&pre1).unwrap()["pairedWith"], json!([rev1_id]));
    // 第 2 版的替身没挂在实例上，自己没有引用；它的代码包还在用，所以不配对。
    assert!(entry(&pre2).unwrap().get("pairedWith").is_none());

    // 只列代码包：替身跟着删。
    let committed = apply(
        &mut video,
        "cmd_prune_rev1",
        vec![json!({ "type": "removeAssets", "assetIds": [rev1_id] })],
    )
    .unwrap();
    let mut removed = vec![rev1_id.clone(), pre1.clone()];
    removed.sort();
    assert_eq!(impact(&committed)["removedAssets"], json!(removed));
    let mut deleted = committed.receipt.deleted_ids.clone();
    deleted.sort();
    assert_eq!(deleted, removed);
    assert!(!video.state().assets.contains_key(&pre1));

    // 只列还在用的代码包的替身：只删替身，代码包有引用、不动。
    let committed = apply(
        &mut video,
        "cmd_prune_pre2",
        vec![json!({ "type": "removeAssets", "assetIds": [pre2] })],
    )
    .unwrap();
    assert_eq!(impact(&committed)["removedAssets"], json!([pre2]));
    assert!(video.state().assets.contains_key(rev2["id"].as_str().unwrap()));
}

/// 用 ffmpeg 现场生成一段替身视频；没有 ffmpeg 时返回 None，测试跳过。
fn prerender_clip(dir: &Path, name: &str, seconds: u32) -> Option<PathBuf> {
    let path = dir.join(format!("{name}.mp4"));
    let ok = std::process::Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-f", "lavfi", "-i"])
        .arg(format!("testsrc=size=160x90:rate=30:duration={seconds}"))
        .args(["-c:v", "mpeg4"])
        .arg(&path)
        .output()
        .is_ok_and(|o| o.status.success());
    if !ok {
        eprintln!("跳过：没有可用的 ffmpeg 生成测试素材");
        return None;
    }
    Some(path)
}

/// 导入一段从代码包某个版本烘焙出来的替身视频。
fn import_prerender(video: &mut Video, clip: &Path, bundle_id: &str, revision: &str) -> Value {
    let op = json!({
        "type": "importAsset", "path": clip, "ref": "p",
        "provenance": { "origin": "composition-bake", "source": { "sourceBundleRef": { "id": bundle_id, "revision": revision } } },
    });
    let id = apply(video, &format!("cmd_prerender_{revision}"), vec![op]).unwrap().receipt.refs["p"].clone();
    json!({ "id": id, "revision": video.state().assets[&id].current_revision })
}

#[test]
fn a_prerender_on_a_clip_counts_as_used_until_the_clip_moves_on() {
    let root = tempfile::tempdir().unwrap();
    let (Some(clip1), Some(clip2)) = (prerender_clip(root.path(), "p1", 2), prerender_clip(root.path(), "p2", 1)) else {
        return;
    };
    let mut video = new_video(&root.path().join("m"));
    let rev1 = import_bundle(&mut video, root.path(), "title", "1");
    let rev2 = import_bundle(&mut video, root.path(), "title", "2");
    let (rev1_id, rev2_id) = (rev1["id"].as_str().unwrap().to_string(), rev2["id"].as_str().unwrap().to_string());
    let pre1 = import_prerender(&mut video, &clip1, "title", "1");
    let pre2 = import_prerender(&mut video, &clip2, "title", "2");
    let (pre1_id, pre2_id) = (pre1["id"].as_str().unwrap().to_string(), pre2["id"].as_str().unwrap().to_string());
    let item = place_composition(&mut video, &rev1);
    apply(
        &mut video,
        "cmd_attach",
        vec![json!({ "type": "replaceCodeBundle", "itemId": item, "assetRef": rev1, "prerender": pre1 })],
    )
    .unwrap();
    // 第 2 版和它的替身都还没用上；第 1 版和它的替身都挂在实例上，替身也算引用。
    let listed: Vec<String> = video.unused_assets().into_iter().map(|a| a.asset_id).collect();
    let mut expected = vec![rev2_id.clone(), pre2_id.clone()];
    expected.sort();
    assert_eq!(listed, expected);
    let err = apply(
        &mut video,
        "cmd_remove_pre1",
        vec![json!({ "type": "removeAssets", "assetIds": [pre1_id] })],
    )
    .unwrap_err();
    assert_eq!(err.details["rule"], "asset-in-use");

    // 换到第 2 版之后，第 1 版的代码包与替身成对出现在清单里；只列替身，代码包一起删。
    apply(
        &mut video,
        "cmd_replace",
        vec![json!({ "type": "replaceCodeBundle", "itemId": item, "assetRef": rev2, "prerender": pre2 })],
    )
    .unwrap();
    let unused = serde_json::to_value(video.unused_assets()).unwrap();
    assert_eq!(unused.as_array().unwrap().len(), 2, "{unused}");
    let committed = apply(
        &mut video,
        "cmd_prune",
        vec![json!({ "type": "removeAssets", "assetIds": [pre1_id] })],
    )
    .unwrap();
    let mut removed = vec![rev1_id, pre1_id];
    removed.sort();
    assert_eq!(impact(&committed)["removedAssets"], json!(removed));
    assert!(video.unused_assets().is_empty());
}
