//! 任务保护（架构设计 §3.2）：智能体在任务里的提交与撤销带上保护范围，触碰时整笔以 `TASK_PROTECTED` 拒绝、什么都不写。

#![allow(clippy::result_large_err)]

use std::path::{Path, PathBuf};

use editor_semantics::Rate;
use serde_json::{Value, json};
use video_engine::model::{Actor, ActorKind, TimelineItem};
use video_engine::{CreateOptions, ErrorBody, TaskProtection, UndoRequest, UndoTarget, Video, VideoTransaction};

fn ffprobe() -> PathBuf {
    PathBuf::from(std::env::var("BAOCUT_FFPROBE").unwrap_or_else(|_| "ffprobe".into()))
}

fn actor(kind: ActorKind) -> Actor {
    Actor {
        kind,
        id: if kind == ActorKind::Agent {
            "agent:conv_1".into()
        } else {
            "user_local".into()
        },
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

fn layout() -> Value {
    json!({ "x": 50, "y": 50, "w": 50 })
}

fn protections(value: Value) -> Vec<TaskProtection> {
    serde_json::from_value(value).expect("保护范围")
}

fn apply_as(video: &mut Video, kind: ActorKind, command_id: &str, ops: Vec<Value>, guard: &[TaskProtection]) -> Result<(), ErrorBody> {
    let tx = VideoTransaction {
        command_id: command_id.into(),
        expected_revision: video.revision(),
        label: None,
        operations: ops,
        actor: actor(kind),
        task_id: Some("task_1".into()),
    };
    video.apply_guarded(&tx, guard).map(|_| ())
}

struct Fixture {
    video: Video,
    seq: String,
    v1: String,
    v2: String,
    /// V1 上 0–60 帧的文字。
    title: String,
    /// V1 上 60–90 帧的形状。
    shape: String,
    /// V2 上 0–90 帧的文字。
    overlay: String,
    _dir: tempfile::TempDir,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(&dir.path().join("m"));
    let seq = video.state().root_sequence_id.clone();
    apply_as(
        &mut video,
        ActorKind::User,
        "cmd_tracks",
        vec![json!({ "type": "addTrack", "sequenceId": seq, "kind": "visual" })],
        &[],
    )
    .unwrap();
    let track = |video: &Video, name: &str| {
        video
            .state()
            .tracks
            .values()
            .find(|t| t.value.name.as_deref() == Some(name))
            .map(|t| t.value.id.clone())
            .unwrap()
    };
    let (v1, v2) = (track(&video, "V1"), track(&video, "V2"));
    let items = json!([
        { "type": "text", "trackId": v1, "span": { "fromFrame": 0, "durationFrames": 60 }, "place": layout(),
          "text": "标题", "style": { "fontSize": 64 } },
        { "type": "shape", "trackId": v1, "span": { "fromFrame": 60, "durationFrames": 30 }, "place": layout(),
          "shape": { "shape": "rect", "fill": "#FFD646" } },
        { "type": "text", "trackId": v2, "span": { "fromFrame": 0, "durationFrames": 90 }, "place": layout(),
          "text": "角标", "style": { "fontSize": 24 } },
    ]);
    apply_as(
        &mut video,
        ActorKind::User,
        "cmd_items",
        vec![json!({ "type": "insertItems", "sequenceId": seq, "items": items })],
        &[],
    )
    .unwrap();
    let find = |video: &Video, pick: &dyn Fn(&TimelineItem) -> bool| {
        video
            .state()
            .items
            .values()
            .find(|i| pick(&i.value))
            .map(|i| i.value.base().id.clone())
            .unwrap()
    };
    let title = find(&video, &|i| matches!(i, TimelineItem::Text(t) if t.text.as_deref() == Some("标题")));
    let overlay = find(&video, &|i| matches!(i, TimelineItem::Text(t) if t.text.as_deref() == Some("角标")));
    let shape = find(&video, &|i| matches!(i, TimelineItem::Shape(_)));
    Fixture {
        video,
        seq,
        v1,
        v2,
        title,
        shape,
        overlay,
        _dir: dir,
    }
}

fn protected_ids(error: &ErrorBody) -> Vec<String> {
    error.details["protections"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["protectionId"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn a_whole_video_protection_rejects_any_agent_change_and_writes_nothing() {
    let Fixture { mut video, title, .. } = fixture();
    let guard = protections(json!([{ "protectionId": "prot_v", "target": { "kind": "video" } }]));
    let before = video.revision();
    let error = apply_as(
        &mut video,
        ActorKind::Agent,
        "cmd_a",
        vec![json!({ "type": "setText", "itemId": title, "text": "改了" })],
        &guard,
    )
    .unwrap_err();
    assert_eq!(error.code, "TASK_PROTECTED");
    assert_eq!(error.entity_ids, vec![title.clone()]);
    assert_eq!(protected_ids(&error), vec!["prot_v"]);
    assert_eq!(video.revision(), before, "被拒的事务不写入");
    assert!(video.find_receipt("cmd_a").unwrap().is_none());
}

#[test]
fn entity_protection_only_covers_that_entity() {
    let Fixture {
        mut video, title, shape, ..
    } = fixture();
    let guard = protections(json!([{ "protectionId": "prot_e", "target": { "kind": "entity", "entityId": title } }]));
    let error = apply_as(
        &mut video,
        ActorKind::Agent,
        "cmd_a",
        vec![json!({ "type": "setText", "itemId": title, "text": "改了" })],
        &guard,
    )
    .unwrap_err();
    assert_eq!(error.code, "TASK_PROTECTED");
    apply_as(
        &mut video,
        ActorKind::Agent,
        "cmd_b",
        vec![json!({ "type": "setStyle", "itemId": shape, "opacity": 0.5 })],
        &guard,
    )
    .expect("别的实体照常修改");
    // 删除受保护的实体也算触碰。
    let error = apply_as(
        &mut video,
        ActorKind::Agent,
        "cmd_c",
        vec![json!({ "type": "deleteItems", "itemIds": [title] })],
        &guard,
    )
    .unwrap_err();
    assert_eq!(error.code, "TASK_PROTECTED");
}

#[test]
fn property_protection_compares_only_the_named_paths() {
    let Fixture { mut video, title, .. } = fixture();
    let guard = protections(json!([{
        "protectionId": "prot_p",
        "target": { "kind": "property", "entityId": title, "propertyPaths": ["text"] }
    }]));
    apply_as(
        &mut video,
        ActorKind::Agent,
        "cmd_a",
        vec![json!({ "type": "setStyle", "itemId": title, "opacity": 0.5 })],
        &guard,
    )
    .expect("没点名的属性可以改");
    let error = apply_as(
        &mut video,
        ActorKind::Agent,
        "cmd_b",
        vec![json!({ "type": "setText", "itemId": title, "text": "改了" })],
        &guard,
    )
    .unwrap_err();
    assert_eq!(error.code, "TASK_PROTECTED");
    assert_eq!(protected_ids(&error), vec!["prot_p"]);
}

#[test]
fn interval_protection_covers_items_overlapping_before_or_after_and_honours_track_ids() {
    let Fixture {
        mut video,
        seq,
        v1,
        v2,
        title,
        shape,
        overlay,
        ..
    } = fixture();
    // 0–30 帧，只看 V1：标题（0–60）相交，形状（60–90）不相交，V2 上的角标不看。
    let guard = protections(json!([{
        "protectionId": "prot_i",
        "target": { "kind": "interval", "sequenceId": seq, "span": { "fromFrame": 0, "durationFrames": 30 }, "trackIds": [v1] }
    }]));
    let error = apply_as(
        &mut video,
        ActorKind::Agent,
        "cmd_a",
        vec![json!({ "type": "setText", "itemId": title, "text": "改了" })],
        &guard,
    )
    .unwrap_err();
    assert_eq!(error.code, "TASK_PROTECTED");
    apply_as(
        &mut video,
        ActorKind::Agent,
        "cmd_b",
        vec![json!({ "type": "setStyle", "itemId": shape, "opacity": 0.5 })],
        &guard,
    )
    .expect("区间之外的实例照常修改");
    apply_as(
        &mut video,
        ActorKind::Agent,
        "cmd_c",
        vec![json!({ "type": "setText", "itemId": overlay, "text": "新角标" })],
        &guard,
    )
    .expect("别的轨道不受这项保护");
    // 修改后进入区间也算触碰：形状原来在 60–90 帧，挪到 V2 的 110 帧进入 100–130 帧的受保护区间。
    let later = protections(json!([{
        "protectionId": "prot_later",
        "target": { "kind": "interval", "sequenceId": seq, "span": { "fromFrame": 100, "durationFrames": 30 } }
    }]));
    let error = apply_as(
        &mut video,
        ActorKind::Agent,
        "cmd_d",
        vec![json!({ "type": "moveItem", "sequenceId": seq, "itemId": shape, "trackId": v2,
                     "at": { "unit": "frames", "value": 110 }, "alignment": "exact-frame" })],
        &later,
    )
    .unwrap_err();
    assert_eq!(error.code, "TASK_PROTECTED");
    assert_eq!(protected_ids(&error), vec!["prot_later"]);
}

#[test]
fn undo_by_an_agent_is_checked_too() {
    let Fixture { mut video, title, .. } = fixture();
    let tx = VideoTransaction {
        command_id: "cmd_edit".into(),
        expected_revision: video.revision(),
        label: None,
        operations: vec![json!({ "type": "setText", "itemId": title, "text": "改了" })],
        actor: actor(ActorKind::Agent),
        task_id: Some("task_1".into()),
    };
    let committed = video.apply(&tx).unwrap();
    let guard = protections(json!([{ "protectionId": "prot_e", "target": { "kind": "entity", "entityId": title } }]));
    let request = UndoRequest {
        command_id: "cmd_undo".into(),
        target: UndoTarget::Transaction(committed.receipt.transaction_id.clone()),
        expected_revision: None,
        actor: actor(ActorKind::Agent),
    };
    let error = video.undo_guarded(&request, &guard).unwrap_err();
    assert_eq!(error.code, "TASK_PROTECTED");
    video.undo_guarded(&request, &[]).expect("没有保护时照常撤销");
}
