//! `regenerateAutoZooms`（视频格式规范 §4.9，屏幕录制设计 §6）：按指针轨的点击生成自动缩放，重新生成时只替换没改过的
//! 自动区间，一笔可撤销的事务。

#![allow(clippy::result_large_err)]

use std::fs;
use std::path::Path;

use editor_semantics::Rate;
use serde_json::{Value, json};
use video_engine::model::{Actor, ActorKind};
use video_engine::{Committed, CreateOptions, ErrorBody, UndoRequest, UndoTarget, Video, VideoTransaction};

fn user() -> Actor {
    Actor {
        kind: ActorKind::User,
        id: "user_local".into(),
    }
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

fn body(video: &Video, id: &str) -> Value {
    video.document(id, None).unwrap().body
}

fn spans(body: &Value) -> Vec<(String, String, String)> {
    body["zooms"]
        .as_array()
        .unwrap()
        .iter()
        .map(|z| (z["t0"].as_str().unwrap().into(), z["t1"].as_str().unwrap().into(), z["origin"].as_str().unwrap().into()))
        .collect()
}

/// 一份只有指针轨的录制（10 秒）与它的取景文档；点击在 1、2.5 与 6 秒。
fn recorded(dir: &Path, mode: &str) -> (Video, String, String) {
    let options = CreateOptions {
        name: "auto zooms".into(),
        fps: Rate { num: 30, den: 1 },
        width: 1920,
        height: 1080,
    };
    let mut video = Video::create(&dir.join("v"), &options, Path::new("ffprobe")).unwrap();
    let pointer = dir.join("pointer.json");
    fs::write(
        &pointer,
        r#"{"format":"baocut-pointer-track","version":1,"timescale":1000,"moves":[[0,0.5,0.5]],
           "buttons":[[1000,0,1],[1100,0,0],[2500,0,1],[2600,0,0],[6000,0,1],[6100,0,0],[8000,1,1]]}"#,
    )
    .unwrap();
    let imported = apply(&mut video, "cmd_import", vec![json!({ "type": "importAsset", "path": pointer, "storage": "managed", "ref": "ptr" })]).unwrap();
    let track = &imported.receipt.refs["ptr"];
    let revision = video.state().assets[track].current_revision.clone();
    let mut streams = json!([]);
    if mode != "none" {
        streams = json!([{ "id": "s0-pointer", "role": "pointer", "segmentId": "s0", "assetRef": { "id": track, "revision": revision }, "start": "0" }]);
    }
    let manifest = json!({
        "schema": "baocut.recording/1", "timescale": 1000, "clock": "recording", "recorder": { "name": "test" }, "duration": "10000",
        "segments": [{ "id": "s0", "t0": "0", "t1": "10000" }], "streams": streams, "pointer": { "mode": mode }
    });
    let view = json!({ "schema": "baocut.screen-view/1", "timescale": 1000, "clock": "recording", "solver": 1,
        "zooms": [{ "id": "keep", "t0": "5000", "t1": "6500", "scale": 3.0, "focus": { "kind": "point", "x": 0.2, "y": 0.2 }, "origin": "manual" }],
        "follow": { "safeArea": 0.4 } });
    apply(
        &mut video,
        "cmd_docs",
        vec![
            json!({ "type": "putDocument", "kind": "recording", "ref": "rec", "body": manifest }),
            json!({ "type": "putDocument", "kind": "screen-view", "ref": "view", "sourceDocument": { "ref": "rec" }, "body": view }),
        ],
    )
    .unwrap();
    let id = |kind: &str| video.state().documents.values().find(|d| d.kind == kind).unwrap().id.clone();
    let (rec, view) = (id("recording"), id("screen-view"));
    (video, rec, view)
}

#[test]
fn auto_zooms_follow_the_clicks_and_regeneration_keeps_manual_and_edited_regions() {
    let dir = tempfile::tempdir().unwrap();
    let (mut video, _, view) = recorded(dir.path(), "separate");
    let op = json!({ "type": "regenerateAutoZooms", "documentId": view });
    let first = apply(&mut video, "cmd_auto", vec![op.clone()]).unwrap();
    assert_eq!(first.receipt.label_ref.as_ref().map(|l| l.key.as_str()), Some("engine.labelRegenerateAutoZooms"));
    let generated = body(&video, &view);
    // 1 秒与 2.5 秒并成一段；6 秒那段让开手加的 [5, 6.5)；辅键不算。其余字段（follow）照旧。
    assert_eq!(
        spans(&generated),
        [
            ("700".into(), "5000".into(), "auto".into()),
            ("5000".into(), "6500".into(), "manual".into()),
            ("6500".into(), "8500".into(), "auto".into())
        ]
    );
    assert_eq!(generated["follow"], json!({ "safeArea": 0.4 }));
    assert!(generated["zooms"][0]["focus"] == json!({ "kind": "pointer" }) && generated["zooms"][0]["scale"] == json!(2.0));

    // 用户改过第一段（edited）：重新生成时它留着，第二段换成新的（ID 变了，区间相同）。
    let mut edited = generated.clone();
    edited["zooms"][0]["t1"] = json!("4000");
    edited["zooms"][0]["edited"] = json!(true);
    apply(&mut video, "cmd_edit", vec![json!({ "type": "putDocument", "documentId": view, "kind": "screen-view", "body": edited })]).unwrap();
    apply(&mut video, "cmd_auto_again", vec![op.clone()]).unwrap();
    let again = body(&video, &view);
    assert_eq!(
        spans(&again),
        [
            ("700".into(), "4000".into(), "auto".into()),
            ("4000".into(), "5000".into(), "auto".into()),
            ("5000".into(), "6500".into(), "manual".into()),
            ("6500".into(), "8500".into(), "auto".into())
        ]
    );
    assert_eq!(again["zooms"][0]["edited"], json!(true));
    // 没变的那段沿用原来的 ID；新切出来的 [4, 5) 是新的。
    assert_eq!(again["zooms"][3]["id"], generated["zooms"][2]["id"]);

    // 再生成一次没有变化：文档不出新版本。
    let last = video.state().documents[&view].current_revision.clone();
    apply(&mut video, "cmd_auto_third", vec![op]).unwrap();
    assert_eq!(video.state().documents[&view].current_revision, last);
}

#[test]
fn regeneration_is_undoable() {
    let dir = tempfile::tempdir().unwrap();
    let (mut video, _, view) = recorded(dir.path(), "separate");
    let committed = apply(&mut video, "cmd_auto", vec![json!({ "type": "regenerateAutoZooms", "documentId": view })]).unwrap();
    assert_eq!(spans(&body(&video, &view)).len(), 3);
    video
        .undo(&UndoRequest {
            command_id: "cmd_undo".into(),
            target: UndoTarget::Transaction(committed.receipt.transaction_id.clone()),
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
    assert_eq!(spans(&body(&video, &view)), [("5000".into(), "6500".into(), "manual".into())]);
}

#[test]
fn regeneration_needs_a_screen_view_with_a_pointer_track() {
    let dir = tempfile::tempdir().unwrap();
    let (mut video, rec, _) = recorded(dir.path(), "separate");
    let refused = apply(&mut video, "cmd_wrong", vec![json!({ "type": "regenerateAutoZooms", "documentId": rec })]).unwrap_err();
    assert_eq!(refused.code, "INVALID_OPERATION");
    let missing = apply(&mut video, "cmd_missing", vec![json!({ "type": "regenerateAutoZooms", "documentId": "doc_none" })]).unwrap_err();
    assert_eq!(missing.code, "ENTITY_NOT_FOUND");

    let other = tempfile::tempdir().unwrap();
    let (mut silent, _, view) = recorded(other.path(), "none");
    let refused = apply(&mut silent, "cmd_none", vec![json!({ "type": "regenerateAutoZooms", "documentId": view })]).unwrap_err();
    assert_eq!(refused.code, "INVALID_OPERATION");
    assert!(refused.message.contains("pointer track"), "{}", refused.message);
}
