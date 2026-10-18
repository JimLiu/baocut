//! 视频的版本记录（视频格式规范 §9）：快照按行稳定、可从快照逐字节重建；版本的边界、合并与裁剪；
//! 回到版本、保存与删除保存的版本；版本链被改坏时报告断点；保留的版本引用的素材不被 GC。不需要 ffprobe。

#![allow(clippy::result_large_err)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use editor_semantics::Rate;
use serde_json::{Value, json};
use video_engine::ids::rfc3339_from_unix;
use video_engine::model::{Actor, ActorKind, TimelineItem};
use video_engine::versions::{
    ApplyRequest, Boundary, ConflictReason, DeleteRequest, RestoreRequest, SaveRequest, SnapshotRequest, SnapshotState, VersionKind,
    list_versions, read_version, snapshot_status,
};
use video_engine::workspace::{SNAPSHOT_DIR, SnapshotFiles, read_files};
use video_engine::{CreateOptions, OpenMode, UndoRequest, UndoTarget, Video, VideoTransaction};

fn ffprobe() -> PathBuf {
    PathBuf::from("ffprobe-不需要")
}

fn user() -> Actor {
    Actor {
        kind: ActorKind::User,
        id: "user_local".into(),
    }
}

fn apply(video: &mut Video, command_id: &str, operations: Vec<Value>) {
    let transaction = VideoTransaction {
        command_id: command_id.into(),
        expected_revision: video.revision(),
        label: None,
        label_ref: None,
        operations,
        actor: user(),
        task_id: None,
    };
    video.apply(&transaction).expect("提交");
}

/// 从一个固定时刻起第 `minutes` 分钟。
fn at(minutes: u64) -> String {
    rfc3339_from_unix(1_792_222_800 + minutes * 60, 0)
}

fn write(video: &mut Video, minutes: u64) -> video_engine::versions::SnapshotWrite {
    video.write_snapshot_at(&SnapshotRequest::default(), &at(minutes)).expect("写快照")
}

fn snapshot_dir(video: &Video) -> PathBuf {
    video.dir().join(SNAPSHOT_DIR)
}

/// 一个有矢量图素材、两版转写、字幕与文字实例的视频。返回视频与文字实例的 ID。
fn source_video(root: &Path) -> (Video, String) {
    let svg = root.join("logo.svg");
    fs::write(&svg, "<svg xmlns='http://www.w3.org/2000/svg'/>").unwrap();
    let options = CreateOptions {
        name: "原视频".into(),
        fps: Rate { num: 30, den: 1 },
        width: 1920,
        height: 1080,
    };
    let mut video = Video::create(&root.join("原视频"), &options, &ffprobe()).unwrap();
    let s = video.state().root_sequence_id.clone();
    apply(
        &mut video,
        "cmd_assets",
        vec![
            json!({ "type": "importAsset", "path": svg, "storage": "managed" }),
            json!({ "type": "putDocument", "kind": "speech", "ref": "speech", "body": { "words": [{ "id": "w1", "text": "你好" }] } }),
        ],
    );
    let speech = video.state().documents.keys().next().unwrap().clone();
    apply(
        &mut video,
        "cmd_doc2",
        vec![
            json!({ "type": "putDocument", "documentId": speech, "kind": "speech", "body": { "words": [{ "id": "w1", "text": "你好" }, { "id": "w2", "text": "世界" }] } }),
        ],
    );
    let text = json!({
        "type": "text", "trackRef": "top", "span": { "fromFrame": 0, "durationFrames": 60 }, "place": { "x": 50, "y": 50, "w": 50 },
        "text": "标题", "style": {},
    });
    let caption = json!({ "type": "caption", "trackRef": "subs", "span": { "fromFrame": 0, "durationFrames": 60 }, "documentId": speech });
    apply(
        &mut video,
        "cmd_items",
        vec![
            json!({ "type": "addTrack", "sequenceId": s, "kind": "subtitle", "ref": "subs" }),
            json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "name": "文字", "ref": "top" }),
            json!({ "type": "insertItems", "sequenceId": s, "items": [text, caption] }),
        ],
    );
    let item = video
        .state()
        .items
        .iter()
        .find(|(_, i)| matches!(i.value, TimelineItem::Text(_)))
        .map(|(id, _)| id.clone())
        .expect("文字实例");
    (video, item)
}

fn set_text(video: &mut Video, item: &str, command_id: &str, text: &str) {
    apply(video, command_id, vec![json!({ "type": "setText", "itemId": item, "text": text })]);
}

fn video_json(video: &Video) -> String {
    fs::read_to_string(snapshot_dir(video).join("video.json")).unwrap()
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// 别处改过、经 git 拉下来的快照：把关着的视频拷一份，在副本里改文字与转写、写快照，返回副本的快照文件。
fn edited_elsewhere(dir: &Path, item: &str, text: &str) -> SnapshotFiles {
    let copy = dir.with_file_name("别处的副本");
    copy_dir(dir, &copy);
    let mut other = Video::open(&copy, OpenMode::Write, &ffprobe()).unwrap();
    set_text(&mut other, item, "cmd_elsewhere_text", text);
    let speech = other.state().documents.keys().next().unwrap().clone();
    apply(
        &mut other,
        "cmd_elsewhere_doc",
        vec![
            json!({ "type": "putDocument", "documentId": speech, "kind": "speech", "body": { "words": [{ "id": "w1", "text": "别处" }] } }),
        ],
    );
    write(&mut other, 2);
    let files = read_files(&copy.join(SNAPSHOT_DIR)).unwrap();
    drop(other);
    fs::remove_dir_all(&copy).unwrap();
    files
}

/// 把快照目录换成给定的文件（`git pull` 改写了它们）。
fn replace_snapshot(dir: &Path, files: &SnapshotFiles) {
    let root = dir.join(SNAPSHOT_DIR);
    for path in read_files(&root).unwrap().keys().filter(|p| !files.contains_key(*p)) {
        fs::remove_file(root.join(path)).unwrap();
    }
    for (path, text) in files {
        fs::write(root.join(path), text).unwrap();
    }
}

fn history_actor() -> Actor {
    Actor {
        kind: ActorKind::System,
        id: "system:history".into(),
    }
}

fn import(
    video: &mut Video,
    command_id: &str,
    force: bool,
    minutes: u64,
) -> video_engine::EngineResult<video_engine::versions::ApplyResult> {
    let request = ApplyRequest {
        command_id: command_id.into(),
        actor: history_actor(),
        force,
        keep: None,
    };
    video.apply_snapshot_at(&request, &at(minutes))
}

fn text_of(video: &Video, item: &str) -> String {
    match &video.state().items[item].value {
        TimelineItem::Text(text) => text.text.clone().unwrap_or_default(),
        _ => unreachable!(),
    }
}

#[test]
fn the_first_write_is_a_baseline_and_an_edit_is_a_one_line_diff() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, item) = source_video(root.path());
    let first = write(&mut video, 0);
    assert_eq!((first.version, first.opened), (None, false), "第一次写只写基线");
    assert!(first.written.contains(&"video.json".to_string()));
    assert_eq!(first.written.len(), 2, "video.json 与一份文档");
    assert!(list_versions(video.dir()).unwrap().versions.is_empty());

    // 没有改动：不写文件、不开版本。
    let again = write(&mut video, 1);
    assert!(again.written.is_empty() && again.version.is_none());

    set_text(&mut video, &item, "cmd_t1", "新标题");
    let edit = write(&mut video, 2);
    assert_eq!((edit.version, edit.opened), (Some(1), true));
    assert_eq!(edit.written, vec!["video.json".to_string()], "文档没变，不重写");
    let version = read_version(video.dir(), 1).unwrap();
    assert_eq!(version.header.kind, VersionKind::Segment);
    let changed: Vec<&str> = version
        .diff
        .lines()
        .filter(|l| l.starts_with(['+', '-']) && !l.starts_with("+++") && !l.starts_with("---"))
        .collect();
    assert_eq!(changed.len(), 2, "只有改过的那一行：{changed:?}");
    assert!(changed[1].contains("新标题"));
    assert_eq!(version.header.actions.len(), 1);
    assert_eq!(version.header.actions[0].actor, "user_local");
    assert_eq!(version.header.files.len(), 1);

    // 写两次得到同样的字节。
    let before = video_json(&video);
    let out = write(&mut video, 3);
    assert!(out.written.is_empty());
    assert_eq!(video_json(&video), before);
}

#[test]
fn edits_merge_until_quiet_span_or_a_turn_boundary() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, item) = source_video(root.path());
    write(&mut video, 0);
    set_text(&mut video, &item, "cmd_1", "一");
    assert_eq!(write(&mut video, 1).version, Some(1));
    set_text(&mut video, &item, "cmd_2", "二");
    let merged = write(&mut video, 4);
    assert_eq!((merged.version, merged.opened), (Some(1), false), "5 分钟内并入当前版本");
    let header = read_version(video.dir(), 1).unwrap().header;
    assert_eq!(header.actions[0].count, 2);
    assert_eq!(header.summary, format!("{} (2 changes)", header.actions[0].label));

    set_text(&mut video, &item, "cmd_3", "三");
    assert_eq!(write(&mut video, 10).version, Some(2), "安静满 5 分钟开新版本");
    for (n, minute) in [
        (4, 13),
        (5, 16),
        (6, 19),
        (7, 22),
        (8, 25),
        (9, 28),
        (10, 31),
        (11, 34),
        (12, 37),
        (13, 40),
        (14, 41),
    ] {
        set_text(&mut video, &item, &format!("cmd_{n}"), &n.to_string());
        let out = write(&mut video, minute);
        let expected = if minute <= 40 { 2 } else { 3 };
        assert_eq!(out.version, Some(expected), "第 {minute} 分钟");
    }

    set_text(&mut video, &item, "cmd_turn", "回合");
    let turn = video
        .write_snapshot_at(
            &SnapshotRequest {
                boundary: Some(Boundary::Turn),
                ..SnapshotRequest::default()
            },
            &at(42),
        )
        .unwrap();
    assert_eq!((turn.version, turn.opened), (Some(4), true), "新回合开新版本");
    let list = list_versions(video.dir()).unwrap();
    assert_eq!(list.versions.iter().map(|v| v.header.version).collect::<Vec<_>>(), vec![4, 3, 2, 1]);
    assert!(list.versions[0].open && !list.versions[1].open);
    // 只有最新一版留着起点文件。
    let bases: Vec<_> = fs::read_dir(snapshot_dir(&video).join("history"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".base"))
        .collect();
    assert_eq!(bases, vec!["000004.base".to_string()]);
}

#[test]
fn restoring_a_version_is_one_undoable_transaction() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, item) = source_video(root.path());
    write(&mut video, 0);
    let baseline = video_json(&video);
    set_text(&mut video, &item, "cmd_1", "一");
    write(&mut video, 1);
    let after_one = video_json(&video);
    set_text(&mut video, &item, "cmd_2", "二");
    write(&mut video, 10);

    let restored = video
        .restore_version(&RestoreRequest {
            command_id: "cmd_restore".into(),
            version: 1,
            before: false,
            actor: user(),
            keep: None,
            protections: Vec::new(),
        })
        .unwrap();
    let committed = restored.committed.expect("有改动");
    assert_eq!(committed.receipt.label, "Restore version 1");
    assert_eq!(video_json(&video), after_one);
    let version = restored.version.expect("restore 版本");
    assert_eq!(read_version(video.dir(), version).unwrap().header.kind, VersionKind::Restore);

    // 重试同一个 commandId 不重复应用。
    let replay = video
        .restore_version(&RestoreRequest {
            command_id: "cmd_restore".into(),
            version: 1,
            before: false,
            actor: user(),
            keep: None,
            protections: Vec::new(),
        })
        .unwrap();
    assert_eq!(replay.committed.unwrap().receipt.transaction_id, committed.receipt.transaction_id);

    // 回到最旧版本之前：基线。
    video
        .restore_version(&RestoreRequest {
            command_id: "cmd_restore_before".into(),
            version: 1,
            before: true,
            actor: user(),
            keep: None,
            protections: Vec::new(),
        })
        .unwrap();
    assert_eq!(video_json(&video), baseline);

    // 撤销把它放回来。
    video
        .undo(&UndoRequest {
            command_id: "cmd_undo".into(),
            target: UndoTarget::Undo,
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
    write(&mut video, 30);
    assert_eq!(video_json(&video), after_one);

    // 回到与当前相同的状态：没有事务。
    let same = video
        .restore_version(&RestoreRequest {
            command_id: "cmd_same".into(),
            version: list_versions(video.dir()).unwrap().versions[0].header.version,
            before: false,
            actor: user(),
            keep: None,
            protections: Vec::new(),
        })
        .unwrap();
    assert!(same.committed.is_none());
}

#[test]
fn a_document_revision_comes_back_with_its_body() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, _) = source_video(root.path());
    write(&mut video, 0);
    let speech = video.state().documents.keys().next().unwrap().clone();
    let doc_path = snapshot_dir(&video).join(format!("documents/{speech}.json"));
    let original = fs::read_to_string(&doc_path).unwrap();
    apply(
        &mut video,
        "cmd_doc3",
        vec![
            json!({ "type": "putDocument", "documentId": speech, "kind": "speech", "body": { "words": [{ "id": "w9", "text": "重写" }] } }),
        ],
    );
    write(&mut video, 1);
    assert_ne!(fs::read_to_string(&doc_path).unwrap(), original);
    video
        .restore_version(&RestoreRequest {
            command_id: "cmd_r".into(),
            version: 1,
            before: true,
            actor: user(),
            keep: None,
            protections: Vec::new(),
        })
        .unwrap();
    assert_eq!(fs::read_to_string(&doc_path).unwrap(), original);
    let body = video.document(&speech, None).unwrap();
    assert_eq!(serde_json::to_value(&body).unwrap()["body"]["words"][1]["text"], "世界");
}

#[test]
fn saved_versions_are_pinned_and_deleting_one_merges_its_neighbours() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, item) = source_video(root.path());
    write(&mut video, 0);
    set_text(&mut video, &item, "cmd_1", "一");
    let save = SaveRequest {
        command_id: "cmd_save".into(),
        name: "审片前".into(),
        note: Some("给客户看\n第二行".into()),
        actor: user(),
        keep: Some(2),
    };
    let saved = video.save_version(&save).unwrap();
    let header = read_version(video.dir(), saved.version).unwrap().header;
    assert_eq!(header.kind, VersionKind::Save);
    assert_eq!(header.name.as_deref(), Some("审片前"));
    assert_eq!(header.note.as_deref(), Some("给客户看\n第二行"));
    assert_eq!(header.checkpoint_id.as_deref(), Some(saved.checkpoint_id.as_str()));
    assert!(video.state().checkpoints.contains_key(&saved.checkpoint_id));
    let retried = video.save_version(&save).unwrap();
    assert_eq!(
        (retried.version, retried.checkpoint_id.clone()),
        (saved.version, saved.checkpoint_id.clone())
    );

    // 再写几版，保存的版本不被裁掉。
    for n in 2..8u64 {
        set_text(&mut video, &item, &format!("cmd_{n}"), &n.to_string());
        video
            .write_snapshot_at(
                &SnapshotRequest {
                    keep: Some(2),
                    ..SnapshotRequest::default()
                },
                &at(n * 10),
            )
            .unwrap();
    }
    let list = list_versions(video.dir()).unwrap();
    let kinds: Vec<(u64, VersionKind)> = list.versions.iter().map(|v| (v.header.version, v.header.kind)).collect();
    assert!(kinds.contains(&(saved.version, VersionKind::Save)), "{kinds:?}");
    assert_eq!(
        list.versions.iter().filter(|v| v.header.kind == VersionKind::Segment).count(),
        2,
        "{kinds:?}"
    );

    // 保存的版本仍能回到。
    let at_save = {
        let mut probe = video
            .restore_version(&RestoreRequest {
                command_id: "cmd_probe".into(),
                version: saved.version,
                before: false,
                actor: user(),
                keep: Some(2),
                protections: Vec::new(),
            })
            .unwrap();
        probe.committed.take().expect("有改动");
        video_json(&video)
    };
    assert!(at_save.contains("\"一\""));

    // 删掉保存的版本：检查点一起删，其余版本照常能回到。
    let deleted = video
        .delete_version(&DeleteRequest {
            command_id: "cmd_delete".into(),
            version: saved.version,
            actor: user(),
        })
        .unwrap();
    assert!(deleted.committed.is_some());
    assert!(!video.state().checkpoints.contains_key(&saved.checkpoint_id));
    assert!(read_version(video.dir(), saved.version).is_err());
    let list = list_versions(video.dir()).unwrap();
    let oldest = list.versions.last().unwrap().header.version;
    video
        .restore_version(&RestoreRequest {
            command_id: "cmd_oldest".into(),
            version: oldest,
            before: true,
            actor: user(),
            keep: Some(2),
            protections: Vec::new(),
        })
        .expect("链仍连续");

    let not_saved = video.delete_version(&DeleteRequest {
        command_id: "cmd_delete2".into(),
        version: list.versions[0].header.version,
        actor: user(),
    });
    assert!(not_saved.is_err(), "只有保存的版本能删");
}

#[test]
fn pruning_keeps_the_chain_continuous() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, item) = source_video(root.path());
    write(&mut video, 0);
    let mut states = Vec::new();
    for n in 1..=6u64 {
        set_text(&mut video, &item, &format!("cmd_{n}"), &format!("第 {n} 版"));
        let out = video
            .write_snapshot_at(
                &SnapshotRequest {
                    keep: Some(3),
                    ..SnapshotRequest::default()
                },
                &at(n * 10),
            )
            .unwrap();
        assert_eq!(out.version, Some(n));
        states.push(video_json(&video));
    }
    let list = list_versions(video.dir()).unwrap();
    assert_eq!(list.versions.iter().map(|v| v.header.version).collect::<Vec<_>>(), vec![6, 5, 4]);
    for version in [4u64, 5] {
        video
            .restore_version(&RestoreRequest {
                command_id: format!("cmd_r{version}"),
                version,
                before: false,
                actor: user(),
                keep: Some(10),
                protections: Vec::new(),
            })
            .unwrap();
        assert_eq!(video_json(&video), states[version as usize - 1]);
    }
    // 序号不复用。
    assert!(list_versions(video.dir()).unwrap().versions[0].header.version > 6);
}

#[test]
fn a_tampered_version_breaks_the_chain_at_that_version() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, item) = source_video(root.path());
    write(&mut video, 0);
    for n in 1..=3u64 {
        set_text(&mut video, &item, &format!("cmd_{n}"), &format!("第 {n} 版"));
        write(&mut video, n * 10);
    }
    let path = snapshot_dir(&video).join("history/000002.patch");
    let text = fs::read_to_string(&path).unwrap();
    fs::write(&path, text.replace("第 1 版", "第 9 版")).unwrap();
    let error = video
        .restore_version(&RestoreRequest {
            command_id: "cmd_r".into(),
            version: 1,
            before: false,
            actor: user(),
            keep: None,
            protections: Vec::new(),
        })
        .unwrap_err();
    assert_eq!(error.code, "VERSION_CHAIN_BROKEN");
    assert_eq!(error.details["brokenAt"], 2);
    // 断点之后的版本照常能回到。
    video
        .restore_version(&RestoreRequest {
            command_id: "cmd_r3".into(),
            version: 3,
            before: true,
            actor: user(),
            keep: None,
            protections: Vec::new(),
        })
        .unwrap();
    assert!(video_json(&video).contains("第 2 版"));

    // 读不出的版本文件：断点就是它，紧挨在它上面的版本开始时的状态仍能回到。
    fs::write(&path, "not a version").unwrap();
    let list = list_versions(video.dir()).unwrap();
    assert_eq!(list.unreadable, vec![2]);
    let error = video
        .restore_version(&RestoreRequest {
            command_id: "cmd_r1".into(),
            version: 1,
            before: false,
            actor: user(),
            keep: None,
            protections: Vec::new(),
        })
        .unwrap_err();
    assert_eq!(error.details["brokenAt"], 2);
    video
        .restore_version(&RestoreRequest {
            command_id: "cmd_r3b".into(),
            version: 3,
            before: true,
            actor: user(),
            keep: None,
            protections: Vec::new(),
        })
        .unwrap();
}

#[test]
fn an_external_change_is_a_conflict_and_is_not_overwritten() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, item) = source_video(root.path());
    write(&mut video, 0);
    assert_eq!(snapshot_status(video.dir()).unwrap().state, SnapshotState::Synced);
    set_text(&mut video, &item, "cmd_1", "一");
    assert_eq!(snapshot_status(video.dir()).unwrap().state, SnapshotState::Pending);
    let path = snapshot_dir(&video).join("video.json");
    let edited = fs::read_to_string(&path).unwrap().replace("原视频", "手改");
    fs::write(&path, &edited).unwrap();
    let error = video.write_snapshot(&SnapshotRequest::default()).unwrap_err();
    assert_eq!(error.code, "SNAPSHOT_CONFLICT");
    assert_eq!(error.details["paths"], json!(["video.json"]));
    assert_eq!(fs::read_to_string(&path).unwrap(), edited);
    let status = snapshot_status(video.dir()).unwrap();
    assert_eq!(
        (status.state, status.conflict, status.changed_paths),
        (
            SnapshotState::Conflict,
            Some(ConflictReason::BothChanged),
            vec!["video.json".to_string()]
        )
    );

    // 被删掉的快照文件不算冲突，下一次写补回来。
    fs::remove_file(&path).unwrap();
    assert!(write(&mut video, 1).written.contains(&"video.json".to_string()));
}

#[test]
fn a_changed_snapshot_of_a_closed_video_is_imported_as_one_external_change() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, item) = source_video(root.path());
    write(&mut video, 0);
    set_text(&mut video, &item, "cmd_1", "一");
    write(&mut video, 1);
    let before = read_files(&snapshot_dir(&video)).unwrap();
    let dir = video.dir().to_path_buf();
    drop(video);
    let theirs = edited_elsewhere(&dir, &item, "别处的标题");
    replace_snapshot(&dir, &theirs);

    let status = snapshot_status(&dir).unwrap();
    assert_eq!((status.state, status.conflict), (SnapshotState::External, None));
    assert_eq!(status.changed_paths.len(), 2, "video.json 与转写");

    let mut video = Video::open(&dir, OpenMode::Write, &ffprobe()).unwrap();
    let revision: i64 = video.revision().parse().unwrap();
    let imported = import(&mut video, "cmd_import", false, 3).unwrap();
    let committed = imported.committed.expect("外部变更");
    assert_eq!(committed.receipt.label, "External change");
    assert_eq!(
        committed.receipt.label_ref.as_ref().map(|r| r.key.as_str()),
        Some("engine.labelExternalChange")
    );
    assert_eq!(committed.receipt.actor, history_actor());
    assert_eq!(video.revision(), (revision + 1).to_string(), "一笔事务");
    assert_eq!(text_of(&video, &item), "别处的标题");
    let speech = video.state().documents.keys().next().unwrap().clone();
    assert!(video.document(&speech, None).unwrap().body.to_string().contains("别处"));

    // 导入不改磁盘上的快照，随后的写与它逐字节相同。
    assert_eq!(read_files(&snapshot_dir(&video)).unwrap(), theirs);
    let version = imported.version.expect("external 版本");
    let header = read_version(&dir, version).unwrap().header;
    assert_eq!((header.kind, header.summary.as_str()), (VersionKind::External, "External change"));
    assert_eq!(snapshot_status(&dir).unwrap().state, SnapshotState::Synced);
    let again = write(&mut video, 4);
    assert!(again.written.is_empty() && again.version.is_none(), "{again:?}");
    assert!(
        import(&mut video, "cmd_import_again", false, 4).unwrap().committed.is_none(),
        "没有新的外部改动"
    );

    // 版本链不断：回到 external 版本开始之前就是导入前的快照。
    video
        .restore_version(&RestoreRequest {
            command_id: "cmd_restore_before".into(),
            version,
            before: true,
            actor: user(),
            keep: None,
            protections: Vec::new(),
        })
        .unwrap();
    assert_eq!(read_files(&snapshot_dir(&video)).unwrap(), before);
    assert_eq!(text_of(&video, &item), "一");
    video
        .undo(&UndoRequest {
            command_id: "cmd_undo_restore".into(),
            target: UndoTarget::Undo,
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
    write(&mut video, 20);
    assert_eq!(read_files(&snapshot_dir(&video)).unwrap(), theirs);

    // 撤销导入：库领先，下一次写把快照写回导入前的状态，是普通的一段。
    video
        .undo(&UndoRequest {
            command_id: "cmd_undo_import".into(),
            target: UndoTarget::Transaction(committed.receipt.transaction_id.clone()),
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
    assert_eq!(text_of(&video, &item), "一");
    assert_eq!(snapshot_status(&dir).unwrap().state, SnapshotState::Pending);
    let reverted = write(&mut video, 40);
    assert_eq!(read_files(&snapshot_dir(&video)).unwrap(), before);
    let header = read_version(&dir, reverted.version.expect("新版本")).unwrap().header;
    assert_eq!(header.kind, VersionKind::Segment);
}

/// 关着的视频的快照在别处被改了，打开后本地又改了一笔：两边都改了。
fn diverged(root: &Path) -> (Video, String, SnapshotFiles) {
    let (mut video, item) = source_video(root);
    write(&mut video, 0);
    set_text(&mut video, &item, "cmd_1", "一");
    write(&mut video, 1);
    let dir = video.dir().to_path_buf();
    drop(video);
    let theirs = edited_elsewhere(&dir, &item, "别处的标题");
    replace_snapshot(&dir, &theirs);
    let mut video = Video::open(&dir, OpenMode::Write, &ffprobe()).unwrap();
    set_text(&mut video, &item, "cmd_local", "本地");
    (video, item, theirs)
}

#[test]
fn when_both_sides_changed_nothing_is_imported_or_overwritten() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, _, theirs) = diverged(root.path());
    let status = snapshot_status(video.dir()).unwrap();
    assert_eq!(
        (status.state, status.conflict),
        (SnapshotState::Conflict, Some(ConflictReason::BothChanged))
    );
    let revision = video.revision();
    assert_eq!(import(&mut video, "cmd_import", false, 3).unwrap_err().code, "SNAPSHOT_CONFLICT");
    assert_eq!(
        video.write_snapshot(&SnapshotRequest::default()).unwrap_err().code,
        "SNAPSHOT_CONFLICT"
    );
    assert_eq!(video.revision(), revision);
    assert_eq!(read_files(&snapshot_dir(&video)).unwrap(), theirs);
}

#[test]
fn using_the_snapshot_on_disk_keeps_the_local_changes_as_a_version() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, item, theirs) = diverged(root.path());
    let imported = import(&mut video, "cmd_use_disk", true, 3).unwrap();
    let committed = imported.committed.expect("外部变更");
    assert_eq!(text_of(&video, &item), "别处的标题");
    assert_eq!(read_files(&snapshot_dir(&video)).unwrap(), theirs);
    let external = imported.version.expect("external 版本");
    let list = list_versions(video.dir()).unwrap();
    let kinds: Vec<VersionKind> = list.versions.iter().map(|v| v.header.kind).collect();
    assert_eq!(kinds[0], VersionKind::External);
    assert_eq!(kinds[1], VersionKind::Segment, "本地的改动先封存成一版");
    assert_eq!(snapshot_status(video.dir()).unwrap().state, SnapshotState::Synced);

    // 重试同一个 commandId 不重复导入。
    let replay = import(&mut video, "cmd_use_disk", true, 4).unwrap();
    assert_eq!(replay.committed.unwrap().receipt.transaction_id, committed.receipt.transaction_id);

    // 本地的改动仍可回到：external 版本开始之前。
    video
        .restore_version(&RestoreRequest {
            command_id: "cmd_restore_local".into(),
            version: external,
            before: true,
            actor: user(),
            keep: None,
            protections: Vec::new(),
        })
        .unwrap();
    assert_eq!(text_of(&video, &item), "本地");
}

/// 还没有版本（只写过基线）时不另封存：`external` 版本从库里的状态算起，回到它之前同样找回本地的改动。
#[test]
fn using_the_snapshot_on_disk_before_any_version_still_keeps_the_local_changes() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, item) = source_video(root.path());
    write(&mut video, 0);
    let dir = video.dir().to_path_buf();
    drop(video);
    let theirs = edited_elsewhere(&dir, &item, "别处的标题");
    replace_snapshot(&dir, &theirs);
    let mut video = Video::open(&dir, OpenMode::Write, &ffprobe()).unwrap();
    set_text(&mut video, &item, "cmd_local", "本地");

    let external = import(&mut video, "cmd_use_disk", true, 3).unwrap().version.expect("external 版本");
    let list = list_versions(video.dir()).unwrap();
    let kinds: Vec<VersionKind> = list.versions.iter().map(|v| v.header.kind).collect();
    assert_eq!(kinds, vec![VersionKind::External]);
    assert_eq!(read_files(&snapshot_dir(&video)).unwrap(), theirs);
    video
        .restore_version(&RestoreRequest {
            command_id: "cmd_restore_local".into(),
            version: external,
            before: true,
            actor: user(),
            keep: None,
            protections: Vec::new(),
        })
        .unwrap();
    assert_eq!(text_of(&video, &item), "本地");
}

#[test]
fn keeping_the_video_overwrites_the_snapshot_on_disk() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, item, theirs) = diverged(root.path());
    let request = SnapshotRequest {
        overwrite: true,
        ..SnapshotRequest::default()
    };
    let written = video.write_snapshot_at(&request, &at(10)).unwrap();
    assert!(written.opened && written.written.contains(&"video.json".to_string()));
    assert_ne!(read_files(&snapshot_dir(&video)).unwrap(), theirs);
    assert!(video_json(&video).contains("本地"));
    assert_eq!(snapshot_status(video.dir()).unwrap().state, SnapshotState::Synced);
    assert_eq!(text_of(&video, &item), "本地");
    // 版本链照常：回到这一版开始之前是上一次写下的。
    video
        .restore_version(&RestoreRequest {
            command_id: "cmd_restore".into(),
            version: written.version.expect("版本"),
            before: true,
            actor: user(),
            keep: None,
            protections: Vec::new(),
        })
        .unwrap();
    assert_eq!(text_of(&video, &item), "一");
}

#[test]
fn an_unreadable_snapshot_is_a_conflict_that_only_keeping_the_video_resolves() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, _) = source_video(root.path());
    write(&mut video, 0);
    let path = snapshot_dir(&video).join("video.json");
    fs::write(&path, "<<<<<<< HEAD\n{}\n").unwrap();
    let status = snapshot_status(video.dir()).unwrap();
    assert_eq!(
        (status.state, status.conflict),
        (SnapshotState::Conflict, Some(ConflictReason::Invalid))
    );
    assert_eq!(import(&mut video, "cmd_import", false, 1).unwrap_err().code, "SNAPSHOT_INVALID");
    assert_eq!(import(&mut video, "cmd_use_disk", true, 1).unwrap_err().code, "SNAPSHOT_INVALID");
    assert_eq!(
        video.write_snapshot(&SnapshotRequest::default()).unwrap_err().code,
        "SNAPSHOT_CONFLICT"
    );
    let request = SnapshotRequest {
        overwrite: true,
        ..SnapshotRequest::default()
    };
    video.write_snapshot_at(&request, &at(2)).unwrap();
    assert_eq!(snapshot_status(video.dir()).unwrap().state, SnapshotState::Synced);
}

#[test]
fn a_crlf_checkout_is_not_an_external_change() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, _) = source_video(root.path());
    write(&mut video, 0);
    let snapshot = snapshot_dir(&video);
    for path in read_files(&snapshot).unwrap().keys() {
        let text = fs::read_to_string(snapshot.join(path)).unwrap();
        fs::write(snapshot.join(path), text.replace('\n', "\r\n")).unwrap();
    }
    assert_eq!(snapshot_status(video.dir()).unwrap().state, SnapshotState::Synced);
    let written = write(&mut video, 1);
    assert!(written.written.is_empty(), "检出的文件不被改写：{written:?}");
    assert!(import(&mut video, "cmd_import", false, 1).unwrap().committed.is_none());
}

/// 别处收进来的素材，blob 不随快照过来（`blobs/` 不进 git）：导入后它是缺失的素材，视频照常可用（§4.2）。
#[test]
fn an_imported_asset_without_its_blob_is_missing() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, _) = source_video(root.path());
    write(&mut video, 0);
    let dir = video.dir().to_path_buf();
    drop(video);

    let copy = root.path().join("别处的副本");
    copy_dir(&dir, &copy);
    let svg = root.path().join("别处.svg");
    fs::write(&svg, "<svg xmlns='http://www.w3.org/2000/svg' width='2'/>").unwrap();
    let mut other = Video::open(&copy, OpenMode::Write, &ffprobe()).unwrap();
    apply(
        &mut other,
        "cmd_elsewhere_asset",
        vec![json!({ "type": "importAsset", "path": svg, "storage": "managed" })],
    );
    write(&mut other, 2);
    let files = read_files(&copy.join(SNAPSHOT_DIR)).unwrap();
    drop(other);

    replace_snapshot(&dir, &files);
    let mut video = Video::open(&dir, OpenMode::Write, &ffprobe()).unwrap();
    assert!(video.missing_assets().is_empty());
    import(&mut video, "cmd_import", false, 3).unwrap().committed.expect("导入");
    let missing = video.missing_assets();
    assert_eq!(missing.len(), 1, "{missing:?}");
    assert_eq!(missing[0].reason, "missing");
    assert_eq!(read_files(&snapshot_dir(&video)).unwrap(), files);
}

#[test]
fn a_video_is_rebuilt_from_its_snapshot_byte_for_byte() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, item) = source_video(root.path());
    write(&mut video, 0);
    set_text(&mut video, &item, "cmd_1", "一");
    write(&mut video, 1);
    let id = video.id().to_string();
    let dir = video.dir().to_path_buf();
    let files = read_files(&snapshot_dir(&video)).unwrap();
    drop(video);
    for suffix in ["", "-wal", "-shm"] {
        let _ = fs::remove_file(dir.join(format!("video.db{suffix}")));
    }
    assert_eq!(snapshot_status(&dir).unwrap().state, SnapshotState::Rebuild);

    let mut rebuilt = Video::rebuild_from_snapshot(&dir, &ffprobe(), None).expect("重建");
    assert_eq!(rebuilt.id(), id, "保留 videoId");
    assert_eq!(rebuilt.revision(), "1");
    assert_eq!(read_files(&snapshot_dir(&rebuilt)).unwrap(), files, "重建后写出的快照逐字节相同");
    let list = list_versions(&dir).unwrap();
    assert_eq!(list.versions[0].header.kind, VersionKind::Rebuild);
    assert_eq!(
        read_version(&dir, list.versions[0].header.version).unwrap().diff,
        "",
        "rebuild 版本的 diff 为空"
    );
    assert_eq!(snapshot_status(&dir).unwrap().state, SnapshotState::Synced);
    assert!(write(&mut rebuilt, 2).written.is_empty());

    // 更早的版本仍可回到。
    rebuilt
        .restore_version(&RestoreRequest {
            command_id: "cmd_r".into(),
            version: 1,
            before: true,
            actor: user(),
            keep: None,
            protections: Vec::new(),
        })
        .unwrap();
    assert!(video_json(&rebuilt).contains("标题"));
    drop(rebuilt);

    // 已有 video.db 的目录不重建。
    assert!(Video::rebuild_from_snapshot(&dir, &ffprobe(), None).is_err());
    Video::open(&dir, OpenMode::Write, &ffprobe()).unwrap();
}

#[test]
fn blobs_referenced_by_kept_versions_survive_gc() {
    let root = tempfile::tempdir().unwrap();
    let (mut video, _) = source_video(root.path());
    write(&mut video, 0);
    let asset = video.state().assets.keys().next().unwrap().clone();
    apply(&mut video, "cmd_rm", vec![json!({ "type": "removeAssets", "assetIds": [asset] })]);
    write(&mut video, 1);
    // 重建之后库里只有当前状态，不再引用被删的素材；只有版本 1 之前的快照引用它。
    let dir = video.dir().to_path_buf();
    drop(video);
    for suffix in ["", "-wal", "-shm"] {
        let _ = fs::remove_file(dir.join(format!("video.db{suffix}")));
    }
    let mut video = Video::rebuild_from_snapshot(&dir, &ffprobe(), None).unwrap();
    let blobs = |dir: &Path| {
        fs::read_dir(dir.join("blobs"))
            .unwrap()
            .filter(|e| !e.as_ref().unwrap().file_name().to_string_lossy().starts_with('.'))
            .count()
    };
    assert_eq!(blobs(&dir), 1);
    let report = video.gc_blobs(Duration::ZERO).unwrap();
    assert!(report.removed.is_empty(), "版本 1 之前的快照引用它");
    assert_eq!(blobs(&dir), 1);
    video
        .restore_version(&RestoreRequest {
            command_id: "cmd_r".into(),
            version: 1,
            before: true,
            actor: user(),
            keep: None,
            protections: Vec::new(),
        })
        .unwrap();
    assert!(video.state().assets.contains_key(&asset));
    assert!(video.resolve_asset(&asset, None).unwrap().path.exists());

    // 对照：版本记录没有了、素材也不在当前状态里时，GC 才回收它。
    video
        .undo(&UndoRequest {
            command_id: "cmd_undo".into(),
            target: UndoTarget::Undo,
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
    write(&mut video, 30);
    drop(video);
    fs::remove_dir_all(dir.join(SNAPSHOT_DIR).join("history")).unwrap();
    for suffix in ["", "-wal", "-shm"] {
        let _ = fs::remove_file(dir.join(format!("video.db{suffix}")));
    }
    let video = Video::rebuild_from_snapshot(&dir, &ffprobe(), None).unwrap();
    assert!(!video.state().assets.contains_key(&asset));
    assert_eq!(video.gc_blobs(Duration::ZERO).unwrap().removed.len(), 1);
    assert_eq!(blobs(&dir), 0);
}

/// 版本文件是标准 unified diff：在 BaoCut 之外用 `patch -R` 能逐版退回快照文本。
#[test]
fn version_files_reverse_apply_with_patch() {
    if Command::new("patch").arg("--version").output().is_err() {
        eprintln!("没有 patch，跳过");
        return;
    }
    let root = tempfile::tempdir().unwrap();
    let (mut video, item) = source_video(root.path());
    write(&mut video, 0);
    let baseline = video_json(&video);
    set_text(&mut video, &item, "cmd_1", "一");
    write(&mut video, 1);
    let copy = root.path().join("copy");
    fs::create_dir_all(&copy).unwrap();
    fs::write(copy.join("video.json"), video_json(&video)).unwrap();
    let patch = snapshot_dir(&video).join("history/000001.patch");
    let status = Command::new("patch")
        .args(["-R", "-p1", "-s", "-i"])
        .arg(&patch)
        .current_dir(&copy)
        .status()
        .unwrap();
    assert!(status.success());
    assert_eq!(fs::read_to_string(copy.join("video.json")).unwrap(), baseline);
}
