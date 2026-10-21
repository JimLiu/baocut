//! 视频引擎的验收测试：事务、幂等、写锁、撤销与编辑语义。
//! 需要媒体的测试用 ffmpeg 现场生成素材；没有 ffmpeg 时跳过并打印原因。

#![allow(clippy::result_large_err)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use editor_semantics::Rate;
use serde_json::{Value, json};
use tempfile::TempDir;
use video_engine::model::{Actor, ActorKind, Background, Fit, TimelineItem, VisualMode};
use video_engine::video::payload_hash;
use video_engine::{CreateOptions, ErrorBody, OpenMode, UndoRequest, UndoTarget, Video, VideoTransaction};

fn ffprobe() -> PathBuf {
    PathBuf::from(std::env::var("BAOCUT_FFPROBE").unwrap_or_else(|_| "ffprobe".into()))
}

struct Fixtures {
    _dir: TempDir,
    video_file: PathBuf,
    audio: PathBuf,
}

/// 2 秒 30 fps 的视频（带声音）与 1.5 秒的 wav。
fn fixtures() -> Option<&'static Fixtures> {
    static FIXTURES: OnceLock<Option<Fixtures>> = OnceLock::new();
    FIXTURES
        .get_or_init(|| {
            let dir = tempfile::tempdir().ok()?;
            let video = dir.path().join("clip.mp4");
            let audio = dir.path().join("tone.wav");
            let ok = |args: &[&str]| {
                Command::new("ffmpeg")
                    .args(args)
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            };
            let video_ok = ok(&[
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=320x180:rate=30:duration=2",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=2",
                "-c:v",
                "mpeg4",
                "-c:a",
                "aac",
                "-shortest",
                video.to_str()?,
            ]);
            let audio_ok = ok(&[
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1.5",
                "-c:a",
                "pcm_s16le",
                audio.to_str()?,
            ]);
            if !(video_ok && audio_ok) {
                eprintln!("跳过：没有可用的 ffmpeg 生成测试素材");
                return None;
            }
            Some(Fixtures {
                _dir: dir,
                video_file: video,
                audio,
            })
        })
        .as_ref()
}

fn user() -> Actor {
    Actor {
        kind: ActorKind::User,
        id: "user_local".into(),
    }
}

fn agent() -> Actor {
    Actor {
        kind: ActorKind::Agent,
        id: "agent_codex".into(),
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

fn tx(video: &Video, command_id: &str, operations: Vec<Value>) -> VideoTransaction {
    VideoTransaction {
        command_id: command_id.into(),
        expected_revision: video.revision(),
        label: None,
        label_ref: None,
        operations,
        actor: user(),
        task_id: None,
    }
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

fn item_ids(video: &Video) -> Vec<String> {
    let snapshot = video.snapshot();
    snapshot.sequences[&snapshot.root_sequence_id]
        .items
        .iter()
        .map(|i| i.base().id.clone())
        .collect()
}

fn span_of(video: &Video, id: &str) -> (i64, i64) {
    let span = video.state().items[id].value.span().expect("音频没有帧区间");
    (span.from_frame, span.duration_frames)
}

fn err_code(result: Result<impl std::fmt::Debug, ErrorBody>) -> String {
    result.expect_err("应当失败").code
}

/// 导入视频并在 V1 上依次放 `count` 个实例（每个 60 帧）。
fn import_video(video: &mut Video, fixtures: &Fixtures, count: usize) -> Vec<String> {
    let mut ops = vec![json!({ "type": "importAsset", "path": fixtures.video_file, "ref": "clip" })];
    for _ in 0..count {
        ops.push(json!({ "type": "addItem", "sequenceId": seq(video), "asset": { "ref": "clip" }, "alignment": "nearest-frame" }));
    }
    let committed = video.apply(&tx(video, "cmd_import", ops)).expect("导入并添加");
    assert!(committed.event.is_some());
    item_ids(video)
}

#[test]
fn created_video_reopens_with_the_same_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let snapshot = video.snapshot();
    assert_eq!(snapshot.revision, "0");
    assert_eq!(snapshot.sequences.len(), 1);
    assert_eq!(snapshot.sequences[&snapshot.root_sequence_id].tracks.len(), 2);

    video
        .apply(&tx(
            &video,
            "cmd_rename",
            vec![json!({ "type": "renameVideo", "name": "新的名字" })],
        ))
        .unwrap();
    video
        .apply(&tx(
            &video,
            "cmd_track",
            vec![json!({ "type": "addTrack", "sequenceId": seq(&video), "kind": "visual" })],
        ))
        .unwrap();
    let before = video.snapshot();
    drop(video);

    let reopened = Video::open(dir.path(), OpenMode::Write, &ffprobe()).unwrap();
    assert_eq!(reopened.snapshot(), before);
    assert_eq!(before.name, "新的名字");
    assert_eq!(before.revision, "2");
    assert_eq!(reopened.event_seq(), 2);
}

#[test]
fn video_brief_is_stored_on_the_video_survives_reopen_and_undoes() {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    assert_eq!(video.snapshot().brief, None);
    assert!(
        !serde_json::to_value(video.snapshot())
            .unwrap()
            .as_object()
            .unwrap()
            .contains_key("brief")
    );

    let written = video
        .apply(&tx(
            &video,
            "cmd_brief",
            vec![
                json!({ "type": "setVideoBrief", "brief": { "markdown": "  **一期访谈**\n\n- [要点](?t=26)  ", "language": " zh-Hans " } }),
            ],
        ))
        .unwrap();
    assert_eq!(ref_json(&written.receipt.label_ref), json!({ "key": "engine.labelSetVideoBrief" }));
    let brief = video.snapshot().brief.expect("写进了速览");
    assert_eq!(brief.markdown, "**一期访谈**\n\n- [要点](?t=26)");
    assert_eq!(brief.language.as_deref(), Some("zh-Hans"));
    assert_eq!(
        serde_json::to_value(video.snapshot()).unwrap()["brief"],
        json!({ "markdown": "**一期访谈**\n\n- [要点](?t=26)", "language": "zh-Hans" })
    );

    // 空的、过长的与多余的字段整笔拒绝，速览不变。
    for bad in [
        json!({ "type": "setVideoBrief", "brief": { "markdown": "   " } }),
        json!({ "type": "setVideoBrief", "brief": { "markdown": "字".repeat(20_001) } }),
        json!({ "type": "setVideoBrief", "brief": { "markdown": "x", "title": "y" } }),
    ] {
        assert!(video.apply(&tx(&video, "cmd_bad_brief", vec![bad])).is_err());
    }
    assert!(
        video
            .apply(&tx(
                &video,
                "cmd_long_brief",
                vec![json!({ "type": "setVideoBrief", "brief": { "markdown": "字".repeat(20_000) } })]
            ))
            .is_ok()
    );

    let before = video.snapshot();
    drop(video);
    let mut reopened = Video::open(dir.path(), OpenMode::Write, &ffprobe()).unwrap();
    assert_eq!(reopened.snapshot(), before);

    // 清掉，再撤销清掉：回到上一份。
    let cleared = reopened
        .apply(&tx(&reopened, "cmd_clear", vec![json!({ "type": "setVideoBrief", "brief": null })]))
        .unwrap();
    assert_eq!(reopened.snapshot().brief, None);
    reopened
        .undo(&UndoRequest {
            command_id: "cmd_undo_clear".into(),
            target: UndoTarget::Transaction(cleared.receipt.transaction_id.clone()),
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
    assert_eq!(reopened.snapshot().brief, before.brief);
    assert_eq!(reopened.snapshot().name, before.name);
}

#[test]
fn default_root_sequence_name_carries_a_message_ref_until_renamed() {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let s = seq(&video);
    let header = |video: &Video| video.snapshot().sequences[&s].header.clone();
    // 缺省名存英文与引用，界面按读者的语言显示（视频格式规范 §3.2）。
    let created = header(&video);
    assert_eq!(created.name, "Main sequence");
    assert_eq!(created.name_ref.as_ref().map(|r| r.key.as_str()), Some("engine.mainSequence"));

    // 只改画布不动名字：仍是缺省名。
    video
        .apply(&tx(
            &video,
            "cmd_background",
            vec![json!({ "type": "updateSequence", "sequenceId": s, "background": "#112233" })],
        ))
        .unwrap();
    assert_eq!(header(&video).name_ref, created.name_ref);

    // 改名：用户起的名字原样显示，引用去掉，交换形式里没有 nameRef；重开后也一样。
    let renamed = video
        .apply(&tx(
            &video,
            "cmd_sequence_name",
            vec![json!({ "type": "updateSequence", "sequenceId": s, "name": "Vertical cut" })],
        ))
        .unwrap();
    assert_eq!((header(&video).name, header(&video).name_ref), ("Vertical cut".to_string(), None));
    assert!(
        serde_json::to_value(&video.snapshot().sequences[&s])
            .unwrap()
            .get("nameRef")
            .is_none()
    );
    drop(video);
    let mut reopened = Video::open(dir.path(), OpenMode::Write, &ffprobe()).unwrap();
    assert_eq!(header(&reopened).name_ref, None);

    // 撤销改名：缺省名与引用一起回来。
    reopened
        .undo(&UndoRequest {
            command_id: "cmd_undo_name".into(),
            target: UndoTarget::Transaction(renamed.receipt.transaction_id.clone()),
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
    assert_eq!(
        (header(&reopened).name, header(&reopened).name_ref),
        (created.name, created.name_ref)
    );
}

#[test]
fn sequence_header_without_name_ref_round_trips_unchanged() {
    // 有 nameRef 之前写下的序列：读入时没有引用，引擎也不补，写回与原样一致（撤销按原样比对）。
    let stored = json!({
        "name": "主序列",
        "fps": { "num": 30, "den": 1 },
        "canvas": { "width": 1920, "height": 1080, "workingSpace": "srgb", "background": "#000000" },
        "durationPolicy": { "kind": "derived" },
        "animationBindings": [],
    });
    let header: video_engine::model::SequenceHeader = serde_json::from_value(stored.clone()).unwrap();
    assert_eq!(header.name_ref, None);
    assert_eq!(serde_json::to_value(&header).unwrap(), stored);
}

fn ref_json(message_ref: &impl serde::Serialize) -> Value {
    serde_json::to_value(message_ref).unwrap()
}

#[test]
fn default_labels_are_english_with_a_message_ref_and_caller_labels_stay_as_given() {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());

    // 引擎起的修改名：英文与引用，界面按读者的语言重新生成（命令与协议规范 §3.1）。
    let renamed = video
        .apply(&tx(&video, "cmd_rename", vec![json!({ "type": "renameVideo", "name": "一" })]))
        .unwrap();
    assert_eq!(renamed.receipt.label, "Rename video");
    assert_eq!(ref_json(&renamed.receipt.label_ref), json!({ "key": "engine.labelRenameVideo" }));
    let event = renamed.event.unwrap();
    assert_eq!(
        (event.label.as_str(), &event.label_ref),
        ("Rename video", &renamed.receipt.label_ref)
    );

    // 几种修改：主修改名作为嵌套参数，次数按全部操作算。
    let mixed = video
        .apply(&tx(
            &video,
            "cmd_mixed",
            vec![
                json!({ "type": "renameVideo", "name": "二" }),
                json!({ "type": "addTrack", "sequenceId": seq(&video), "kind": "audio" }),
            ],
        ))
        .unwrap();
    assert_eq!(mixed.receipt.label, "Rename video and more (2 changes)");
    assert_eq!(
        ref_json(&mixed.receipt.label_ref),
        json!({
            "key": "engine.labelMoreChanges",
            "params": { "main": { "key": "engine.labelRenameVideo", "text": "Rename video" }, "count": 2 }
        })
    );

    // 调用方给的修改名原样保存（去掉首尾空白）；没给引用就没有引用。
    let mut named = tx(&video, "cmd_named", vec![json!({ "type": "renameVideo", "name": "三" })]);
    named.label = Some("  整理标题  ".into());
    let named = video.apply(&named).unwrap();
    assert_eq!((named.receipt.label.as_str(), &named.receipt.label_ref), ("整理标题", &None));
    assert!(serde_json::to_value(&named.receipt).unwrap().get("labelRef").is_none());

    // 历史与补发的事件带着同样的引用。
    let history = video.history(10).unwrap();
    assert_eq!(history[0].label_ref, None);
    assert_eq!(history[1].label_ref, mixed.receipt.label_ref);
    let events = video.events_after(0, 10).unwrap();
    assert_eq!(events[0].label_ref, renamed.receipt.label_ref);

    // 「导入并添加」算一次添加。
    if let Some(fixtures) = fixtures() {
        let ops = vec![
            json!({ "type": "importAsset", "path": fixtures.video_file, "ref": "clip" }),
            json!({ "type": "addItem", "sequenceId": seq(&video), "asset": { "ref": "clip" }, "alignment": "nearest-frame" }),
            json!({ "type": "addItem", "sequenceId": seq(&video), "asset": { "ref": "clip" }, "alignment": "nearest-frame" }),
        ];
        let added = video.apply(&tx(&video, "cmd_import_add", ops)).unwrap();
        assert_eq!(added.receipt.label, "Add clip");
        assert_eq!(ref_json(&added.receipt.label_ref), json!({ "key": "engine.labelAddClip" }));
    }
}

#[test]
fn undo_and_redo_labels_wrap_the_original_label() {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let step = |video: &mut Video, id: &str, target: UndoTarget| {
        video
            .undo(&UndoRequest {
                command_id: id.into(),
                target,
                expected_revision: None,
                actor: user(),
            })
            .unwrap()
    };
    let rename_ref = json!({ "key": "engine.labelRenameVideo", "text": "Rename video" });

    video
        .apply(&tx(&video, "cmd_rename", vec![json!({ "type": "renameVideo", "name": "一" })]))
        .unwrap();
    let undone = step(&mut video, "cmd_undo", UndoTarget::Undo);
    assert_eq!(undone.receipt.label, "Undo: Rename video");
    assert_eq!(
        ref_json(&undone.receipt.label_ref),
        json!({ "key": "engine.labelUndo", "params": { "label": rename_ref } })
    );
    // 撤销栈上的一步用正向修改名，引用跟着走。
    let redo = video.undo_state(&user()).unwrap().redo.unwrap();
    assert_eq!(
        (redo.label.as_str(), ref_json(&redo.label_ref)),
        ("Rename video", json!({ "key": "engine.labelRenameVideo" }))
    );
    let redone = step(&mut video, "cmd_redo", UndoTarget::Redo);
    assert_eq!(redone.receipt.label, "Redo: Rename video");
    assert_eq!(
        ref_json(&redone.receipt.label_ref),
        json!({ "key": "engine.labelRedo", "params": { "label": rename_ref } })
    );

    // 调用方给的修改名没有引用时作为字符串参数原样显示。
    let mut named = tx(&video, "cmd_named", vec![json!({ "type": "renameVideo", "name": "二" })]);
    named.label = Some("整理标题".into());
    video.apply(&named).unwrap();
    let undone_named = step(&mut video, "cmd_undo_named", UndoTarget::Undo);
    assert_eq!(undone_named.receipt.label, "Undo: 整理标题");
    assert_eq!(
        ref_json(&undone_named.receipt.label_ref),
        json!({ "key": "engine.labelUndo", "params": { "label": "整理标题" } })
    );

    // 重新打开之后，历史与撤销栈的引用还在。
    drop(video);
    let reopened = Video::open(dir.path(), OpenMode::Write, &ffprobe()).unwrap();
    let history = reopened.history(10).unwrap();
    assert_eq!(history[0].label_ref, undone_named.receipt.label_ref);
    assert_eq!(history[2].label_ref, redone.receipt.label_ref);
    let undo = reopened.undo_state(&user()).unwrap().undo.unwrap();
    assert_eq!(
        (undo.label.as_str(), ref_json(&undo.label_ref)),
        ("Rename video", json!({ "key": "engine.labelRenameVideo" }))
    );
}

#[test]
fn caller_labels_keep_the_ref_they_came_with() {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let caller_ref = json!({ "key": "editLabel.moveClips", "params": { "count": 2 } });

    // 调用方给的修改名带着引用：文字与引用原样存下，引擎不认这个键（命令与协议规范 §3.1）。
    let mut named = tx(&video, "cmd_named", vec![json!({ "type": "renameVideo", "name": "一" })]);
    named.label = Some(" Move 2 clips ".into());
    named.label_ref = serde_json::from_value(caller_ref.clone()).unwrap();
    let applied = video.apply(&named).unwrap();
    assert_eq!(
        (applied.receipt.label.as_str(), ref_json(&applied.receipt.label_ref)),
        ("Move 2 clips", caller_ref.clone())
    );
    assert_eq!(applied.event.unwrap().label_ref, applied.receipt.label_ref);
    let undo = video.undo_state(&user()).unwrap().undo.unwrap();
    assert_eq!(ref_json(&undo.label_ref), caller_ref);

    // 撤销把它作为嵌套参数，连同当时的文字（读者认不出这个键时用）。
    let undone = video
        .undo(&UndoRequest {
            command_id: "cmd_undo".into(),
            target: UndoTarget::Undo,
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
    assert_eq!(undone.receipt.label, "Undo: Move 2 clips");
    assert_eq!(
        ref_json(&undone.receipt.label_ref),
        json!({
            "key": "engine.labelUndo",
            "params": { "label": { "key": "editLabel.moveClips", "params": { "count": 2 }, "text": "Move 2 clips" } }
        })
    );

    // 只有引用、没有文字：不算调用方给了名字，引擎照常起名。
    let mut ref_only = tx(&video, "cmd_ref_only", vec![json!({ "type": "renameVideo", "name": "二" })]);
    ref_only.label = Some("  ".into());
    ref_only.label_ref = serde_json::from_value(caller_ref.clone()).unwrap();
    let ref_only = video.apply(&ref_only).unwrap();
    assert_eq!(
        (ref_only.receipt.label.as_str(), ref_json(&ref_only.receipt.label_ref)),
        ("Rename video", json!({ "key": "engine.labelRenameVideo" }))
    );

    // 重新打开之后，历史里还是调用方的引用。
    drop(video);
    let reopened = Video::open(dir.path(), OpenMode::ReadOnly, &ffprobe()).unwrap();
    let history = reopened.history(10).unwrap();
    assert_eq!(ref_json(&history[2].label_ref), caller_ref);
    assert_eq!(history[1].label_ref, undone.receipt.label_ref);
}

#[test]
fn transactions_without_label_ref_columns_read_as_stored_text() {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    video
        .apply(&tx(&video, "cmd_rename", vec![json!({ "type": "renameVideo", "name": "一" })]))
        .unwrap();
    drop(video);
    // 加上引用列之前的库：没有这两列，修改名是当时写下的中文。
    {
        let conn = rusqlite::Connection::open(dir.path().join("video.db")).unwrap();
        conn.execute_batch(
            "ALTER TABLE transactions DROP COLUMN label_ref;
             ALTER TABLE transactions DROP COLUMN base_label_ref;
             UPDATE transactions SET label = '重命名视频', base_label = '重命名视频';",
        )
        .unwrap();
    }

    // 只读打开不改库：照存下的文字读，没有引用。
    let read_only = Video::open(dir.path(), OpenMode::ReadOnly, &ffprobe()).unwrap();
    let history = read_only.history(10).unwrap();
    assert_eq!((history[0].label.as_str(), &history[0].label_ref), ("重命名视频", &None));
    let undo = read_only.undo_state(&user()).unwrap().undo.unwrap();
    assert_eq!((undo.label.as_str(), &undo.label_ref), ("重命名视频", &None));
    drop(read_only);

    // 可写打开时补上两列；撤销旧修改，旧名字作为字符串参数。
    let mut video = Video::open(dir.path(), OpenMode::Write, &ffprobe()).unwrap();
    let undone = video
        .undo(&UndoRequest {
            command_id: "cmd_undo".into(),
            target: UndoTarget::Undo,
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
    assert_eq!(undone.receipt.label, "Undo: 重命名视频");
    assert_eq!(
        serde_json::to_value(&undone.receipt.label_ref).unwrap(),
        json!({ "key": "engine.labelUndo", "params": { "label": "重命名视频" } })
    );
    let history = video.history(10).unwrap();
    assert_eq!(history[0].label_ref, undone.receipt.label_ref);
    assert_eq!(history[1].label_ref, None);
}

#[test]
fn c03_second_writer_is_rejected_and_read_only_cannot_write() {
    let dir = tempfile::tempdir().unwrap();
    let video = new_video(dir.path());

    let second = Video::open(dir.path(), OpenMode::Write, &ffprobe());
    let err = second.err().expect("第二个写入者被拒绝");
    assert_eq!(err.code, "VIDEO_LOCKED");
    assert_eq!(err.details["holder"]["pid"], json!(std::process::id()));

    let mut reader = Video::open(dir.path(), OpenMode::ReadOnly, &ffprobe()).unwrap();
    assert_eq!(reader.snapshot(), video.snapshot());
    let rename = tx(&reader, "cmd_ro", vec![json!({ "type": "renameVideo", "name": "x" })]);
    assert_eq!(err_code(reader.apply(&rename)), "VIDEO_READ_ONLY");

    // 释放之后可以重新取得写锁，所有者代递增。
    drop(video);
    Video::open(dir.path(), OpenMode::Write, &ffprobe()).expect("锁已释放");
}

/// 别的线程正在起子进程时关掉视频，马上就能重新取得写锁：子进程起来时复制走的锁文件描述符不拖住锁。
#[cfg(unix)]
#[test]
fn closing_releases_the_lock_while_other_threads_spawn_children() {
    let dir = tempfile::tempdir().unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let spawners: Vec<_> = (0..4)
        .map(|_| {
            let stop = stop.clone();
            std::thread::spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    let _ = Command::new("true").status();
                }
            })
        })
        .collect();

    let mut video = Some(new_video(dir.path()));
    let mut failure = None;
    for round in 0..200 {
        drop(video.take());
        match Video::open(dir.path(), OpenMode::Write, &ffprobe()) {
            Ok(reopened) => video = Some(reopened),
            Err(err) => {
                failure = Some((round, err));
                break;
            }
        }
    }
    stop.store(true, Ordering::Relaxed);
    for spawner in spawners {
        spawner.join().unwrap();
    }
    assert!(failure.is_none(), "关掉之后重新打开被拒：{failure:?}");
}

#[test]
fn stale_owner_cannot_commit_after_the_lock_moves() {
    let dir = tempfile::tempdir().unwrap();
    let video = new_video(dir.path());
    drop(video);
    let mut first = Video::open(dir.path(), OpenMode::Write, &ffprobe()).unwrap();
    // 模拟锁被另一方合法取得（例如旧宿主被判定失联之后）：直接递增所有者代。
    {
        let conn = rusqlite::Connection::open(dir.path().join("video.db")).unwrap();
        conn.execute("UPDATE videos SET owner_generation = owner_generation + 1", [])
            .unwrap();
    }
    let rename = tx(&first, "cmd_stale", vec![json!({ "type": "renameVideo", "name": "旧主人" })]);
    assert_eq!(err_code(first.apply(&rename)), "PROJECT_WRITER_UNAVAILABLE");
    assert_eq!(first.revision(), "0", "失败的提交不改变工作态");
}

#[test]
fn t06_a03_retry_returns_the_same_receipt_without_duplicating() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let ops = vec![
        json!({ "type": "importAsset", "path": fixtures.video_file, "ref": "clip" }),
        json!({ "type": "addItem", "sequenceId": seq(&video), "asset": { "ref": "clip" }, "alignment": "nearest-frame" }),
    ];
    let request = tx(&video, "cmd_retry", ops);
    let first = video.apply(&request).unwrap();
    let again = video.apply(&request).unwrap();
    assert_eq!(again.receipt, first.receipt);
    assert!(again.event.is_none(), "重放不产生新事件");
    assert_eq!(item_ids(&video).len(), 1);
    assert_eq!(video.state().assets.len(), 1);
    assert_eq!(video.revision(), "1");
}

#[test]
fn c05_same_key_with_another_payload_is_rejected_and_outbox_survives() {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let request = tx(&video, "cmd_c05", vec![json!({ "type": "renameVideo", "name": "第一版" })]);
    let committed = video.apply(&request).unwrap();
    let event = committed.event.unwrap();

    let mut changed = request.clone();
    changed.operations = vec![json!({ "type": "renameVideo", "name": "第二版" })];
    assert_eq!(err_code(video.apply(&changed)), "IDEMPOTENCY_CONFLICT");
    assert_eq!(video.state().name, "第一版");

    // 广播丢失：从持久的 outbox 补发同一个事件，序号与内容不变。
    drop(video);
    let reopened = Video::open(dir.path(), OpenMode::Write, &ffprobe()).unwrap();
    let events = reopened.events_after(0, 100).unwrap();
    assert_eq!(events, vec![event]);
    assert!(reopened.events_after(1, 100).unwrap().is_empty());
}

#[test]
fn c01_receipt_is_found_by_command_id_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let committed = video
        .apply(&tx(&video, "cmd_c01", vec![json!({ "type": "renameVideo", "name": "崩溃前" })]))
        .unwrap();
    drop(video);
    let reopened = Video::open(dir.path(), OpenMode::Write, &ffprobe()).unwrap();
    assert_eq!(reopened.find_receipt("cmd_c01").unwrap(), Some(committed.receipt));
    assert_eq!(reopened.find_receipt("cmd_unknown").unwrap(), None);
}

#[test]
fn t07_stale_revision_is_an_explicit_conflict() {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let stale = tx(&video, "cmd_agent", vec![json!({ "type": "renameVideo", "name": "智能体的标题" })]);
    video
        .apply(&tx(
            &video,
            "cmd_user",
            vec![json!({ "type": "renameVideo", "name": "用户的标题" })],
        ))
        .unwrap();
    let err = video.apply(&stale).expect_err("旧版本上的修改被拒绝");
    assert_eq!(err.code, "PROJECT_REVISION_CONFLICT");
    assert_eq!(video.state().name, "用户的标题");
}

#[test]
fn failed_operation_leaves_the_video_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let ops = vec![
        json!({ "type": "renameVideo", "name": "不应生效" }),
        json!({ "type": "deleteItems", "sequenceId": seq(&video), "itemIds": ["item_missing"] }),
    ];
    let err = video.apply(&tx(&video, "cmd_atomic", ops)).expect_err("第二个操作失败");
    assert_eq!(err.code, "ENTITY_NOT_FOUND");
    assert_eq!(err.details["operationIndex"], json!(1));
    assert_eq!(video.state().name, "测试视频");
    assert_eq!(video.revision(), "0");
    assert_eq!(video.find_receipt("cmd_atomic").unwrap(), None);
}

#[test]
fn unknown_fields_and_missing_sequence_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let bad = vec![json!({ "type": "renameVideo", "name": "x", "patch": {} })];
    assert_eq!(err_code(video.apply(&tx(&video, "cmd_bad", bad))), "INVALID_OPERATION");
    // TM04：帧输入没有序列时不猜帧率。
    let no_seq =
        vec![json!({ "type": "moveItem", "itemId": "item_x", "at": { "unit": "frames", "value": 3 }, "alignment": "exact-frame" })];
    assert_eq!(err_code(video.apply(&tx(&video, "cmd_noseq", no_seq))), "TIME_DOMAIN_MISMATCH");
    let float = vec![
        json!({ "type": "moveItem", "sequenceId": seq(&video), "itemId": "item_x", "at": { "unit": "seconds", "value": 1.5 }, "alignment": "exact-frame" }),
    ];
    assert_eq!(err_code(video.apply(&tx(&video, "cmd_float", float))), "INVALID_TIME_VALUE");
}

#[test]
fn tm01_seconds_and_frames_resolve_to_the_same_frame() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let ids = import_video(&mut video, fixtures, 1);
    let s = seq(&video);
    let by_seconds = video
        .apply(&tx(&video, "cmd_sec", vec![json!({ "type": "moveItem", "sequenceId": s, "itemId": ids[0], "at": { "unit": "seconds", "value": "12.5" }, "alignment": "exact-frame" })]))
        .unwrap();
    assert_eq!(span_of(&video, &ids[0]).0, 375);
    let receipt = &by_seconds.receipt.time_resolution[0];
    assert_eq!(receipt.actual_frame, 375);
    let by_frames = video
        .apply(&tx(&video, "cmd_frame", vec![json!({ "type": "moveItem", "sequenceId": s, "itemId": ids[0], "at": { "unit": "frames", "value": 375 }, "alignment": "exact-frame" })]))
        .unwrap();
    assert_eq!(by_frames.receipt.time_resolution[0].actual_time, receipt.actual_time);
    // 位置相同：第二笔事务没有改变任何实体。
    assert!(by_frames.receipt.updated_ids.is_empty());
    assert!(!by_frames.receipt.undo.available);
}

#[test]
fn t05_editing_one_instance_preserves_the_others() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let ids = import_video(&mut video, fixtures, 3);
    assert_eq!(ids.len(), 3);
    assert_eq!(video.state().assets.len(), 1, "三个实例共用一份素材");
    assert_eq!(
        (span_of(&video, &ids[0]), span_of(&video, &ids[1]), span_of(&video, &ids[2])),
        ((0, 60), (60, 60), (120, 60))
    );
    let before_first = video.state().items[&ids[0]].clone();
    let before_third = video.state().items[&ids[2]].clone();

    let trim = vec![
        json!({ "type": "trimItem", "sequenceId": seq(&video), "itemId": ids[1], "edge": "end", "at": { "unit": "frames", "value": 90 }, "alignment": "exact-frame" }),
    ];
    let committed = video.apply(&tx(&video, "cmd_t05", trim)).unwrap();
    assert_eq!(committed.receipt.updated_ids, vec![ids[1].clone()]);
    assert_eq!(committed.receipt.preserved, {
        let mut p = vec![ids[0].clone(), ids[2].clone()];
        p.sort();
        p
    });
    assert_eq!(video.state().items[&ids[0]], before_first);
    assert_eq!(video.state().items[&ids[2]], before_third);
    assert_eq!(span_of(&video, &ids[1]), (60, 30));
    assert_eq!(committed.receipt.impact.new_duration_frames, 180);
}

#[test]
fn split_keeps_the_left_id_and_maps_the_right_source_exactly() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let ids = import_video(&mut video, fixtures, 1);
    let split = vec![
        json!({ "type": "splitItem", "sequenceId": seq(&video), "itemId": ids[0], "at": { "unit": "seconds", "value": "0.5" }, "alignment": "exact-frame" }),
    ];
    let committed = video.apply(&tx(&video, "cmd_split", split)).unwrap();
    let right = committed.receipt.created_ids[0].clone();
    assert_eq!(committed.receipt.lineage[&ids[0]], vec![ids[0].clone(), right.clone()]);
    assert_eq!((span_of(&video, &ids[0]), span_of(&video, &right)), ((0, 15), (15, 45)));
    let TimelineItem::Video(r) = &video.state().items[&right].value else {
        panic!()
    };
    let editor_semantics::TimeMap::Linear { source_in, .. } = &r.time_map else {
        panic!()
    };
    assert_eq!((source_in.ticks.as_str(), source_in.timescale), ("1", 2));
    assert_eq!(r.base.lineage.as_ref().unwrap().origin_item_id, ids[0]);

    // 撤销拆分：右段删除，左段恢复原长。
    let undone = video
        .undo(&UndoRequest {
            command_id: "cmd_undo_split".into(),
            target: UndoTarget::Transaction(committed.receipt.transaction_id.clone()),
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
    assert_eq!(undone.receipt.deleted_ids, vec![right]);
    assert_eq!(item_ids(&video), ids);
    assert_eq!(span_of(&video, &ids[0]), (0, 60));
}

#[test]
fn caption_scope_follows_split_and_delete() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let ids = import_video(&mut video, fixtures, 1);
    let s = seq(&video);
    let setup = vec![
        json!({ "type": "addTrack", "sequenceId": s, "kind": "subtitle", "ref": "subs" }),
        json!({ "type": "putDocument", "ref": "cues", "kind": "caption", "body": { "schema": "baocut.caption/1", "clock": "source-asset", "cues": [] } }),
        json!({ "type": "insertItems", "sequenceId": s, "items": [
            { "type": "caption", "trackRef": "subs", "span": { "fromFrame": 0, "durationFrames": 60 }, "documentRef": "cues", "scopeItemIds": [ids[0]] },
        ] }),
    ];
    video.apply(&tx(&video, "cmd_caption", setup)).unwrap();
    let caption = item_ids(&video).into_iter().find(|id| id != &ids[0]).unwrap();
    let scope = |video: &Video| -> Vec<String> {
        let TimelineItem::Caption(c) = &video.state().items[&caption].value else {
            panic!()
        };
        c.scope_item_ids.clone()
    };

    // 拆分：右半边紧跟原实例进入作用实例，拆分点之后的字幕照样经它投影。
    let split = vec![
        json!({ "type": "splitItem", "sequenceId": s, "itemId": ids[0], "at": { "unit": "frames", "value": 30 }, "alignment": "exact-frame" }),
    ];
    let committed = video.apply(&tx(&video, "cmd_split", split)).unwrap();
    let right = committed.receipt.created_ids[0].clone();
    assert_eq!(scope(&video), vec![ids[0].clone(), right.clone()]);
    assert!(committed.receipt.updated_ids.contains(&caption));

    // 删掉一半：从作用实例里拿掉；删掉最后一个时保留原样（拿空等于换成序列时钟）。
    video
        .apply(&tx(
            &video,
            "cmd_delete_right",
            vec![json!({ "type": "deleteItems", "itemIds": [right] })],
        ))
        .unwrap();
    assert_eq!(scope(&video), vec![ids[0].clone()]);
    video
        .apply(&tx(
            &video,
            "cmd_delete_left",
            vec![json!({ "type": "deleteItems", "itemIds": [ids[0]] })],
        ))
        .unwrap();
    assert_eq!(scope(&video), vec![ids[0].clone()]);

    // 撤销拆分之前的几步都撤掉：作用实例回到拆分前。
    for command in ["cmd_undo_left", "cmd_undo_right"] {
        video
            .undo(&UndoRequest {
                command_id: command.into(),
                target: UndoTarget::Undo,
                expected_revision: None,
                actor: user(),
            })
            .unwrap();
    }
    assert_eq!(scope(&video), vec![ids[0].clone(), right.clone()]);
    video
        .undo(&UndoRequest {
            command_id: "cmd_undo_split".into(),
            target: UndoTarget::Transaction(committed.receipt.transaction_id.clone()),
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
    assert_eq!(scope(&video), vec![ids[0].clone()]);
}

/// 实例在 JSON 里的 `timeMap.sourceIn`（秒）。
fn source_in_seconds(video: &Video, id: &str) -> f64 {
    let value = serde_json::to_value(&video.state().items[id].value).unwrap();
    let source_in = &value["timeMap"]["sourceIn"];
    let ticks: f64 = source_in["ticks"].as_str().unwrap().parse().unwrap();
    ticks / source_in["timescale"].as_f64().unwrap()
}

/// 音频实例的起点与长度（秒）。
fn audio_range(video: &Video, id: &str) -> (f64, f64) {
    let TimelineItem::Audio(audio) = &video.state().items[id].value else {
        panic!("不是音频")
    };
    let offset = audio.subframe_offset.to_ratio("t").unwrap().to_f64();
    (
        audio.from_frame as f64 / 30.0 + offset,
        audio.play_duration.to_ratio("t").unwrap().to_f64(),
    )
}

#[test]
fn remove_range_ripples_the_declared_tracks_and_captions_follow() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    // V1：A [0, 60)、B [60, 120)；A1：音频 0.25–1.75 秒；V2：文字 [0, 120)；字幕 [0, 120) 经 A、B 投影。
    let ids = import_video(&mut video, fixtures, 2);
    let (a, b) = (ids[0].clone(), ids[1].clone());
    let s = seq(&video);
    let setup = vec![
        json!({ "type": "importAsset", "path": fixtures.audio, "ref": "tone" }),
        json!({ "type": "addItem", "sequenceId": s, "asset": { "ref": "tone" }, "at": { "unit": "seconds", "value": "0.25" }, "alignment": "exact-frame" }),
        json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "ref": "v2" }),
        json!({ "type": "addTrack", "sequenceId": s, "kind": "subtitle", "ref": "subs" }),
        json!({ "type": "putDocument", "ref": "cues", "kind": "caption", "body": { "schema": "baocut.caption/1", "clock": "source-asset", "cues": [] } }),
        json!({ "type": "insertItems", "sequenceId": s, "items": [
            { "type": "text", "trackRef": "v2", "span": { "fromFrame": 0, "durationFrames": 120 },
              "place": { "x": 50, "y": 50, "w": 40 }, "text": "标题", "style": {} },
            { "type": "caption", "trackRef": "subs", "span": { "fromFrame": 0, "durationFrames": 120 }, "documentRef": "cues", "scopeItemIds": [a, b] },
        ] }),
    ];
    video.apply(&tx(&video, "cmd_setup", setup)).unwrap();
    let find = |video: &Video, kind: &str| -> String {
        video
            .state()
            .items
            .values()
            .find(|p| serde_json::to_value(&p.value).unwrap()["type"] == kind)
            .map(|p| p.value.base().id.clone())
            .unwrap()
    };
    let (tone, text, caption) = (find(&video, "audio"), find(&video, "text"), find(&video, "caption"));
    let subs = video.state().items[&caption].value.base().track_id.clone();
    let declared = json!([track(&video, "V1"), track(&video, "A1"), subs]);

    // 删掉 [20, 40) 帧：A 拆开、删掉中间、右段前移；B 前移；音频同样拆开前移；字幕缩短，作用实例加上 A 的右段；文字不动。
    let cut = vec![
        json!({ "type": "removeRange", "sequenceId": s, "from": { "unit": "frames", "value": 20 },
        "to": { "unit": "frames", "value": 40 }, "trackIds": declared, "alignment": "exact-frame" }),
    ];
    let committed = video.apply(&tx(&video, "cmd_cut", cut)).unwrap();
    let created = committed.receipt.created_ids.clone();
    assert_eq!(created.len(), 2);
    let right = created
        .iter()
        .find(|id| video.state().items[*id].value.span().is_some())
        .unwrap()
        .clone();
    let tone_right = created.iter().find(|id| **id != right).unwrap().clone();
    assert_eq!(span_of(&video, &a), (0, 20));
    assert_eq!(span_of(&video, &right), (20, 20));
    assert!((source_in_seconds(&video, &right) - 40.0 / 30.0).abs() < 1e-9);
    assert_eq!(span_of(&video, &b), (40, 60));
    let (start, length) = audio_range(&video, &tone);
    assert!((start - 0.25).abs() < 1e-9 && (start + length - 20.0 / 30.0).abs() < 1e-9);
    let (start, length) = audio_range(&video, &tone_right);
    assert!((start - 20.0 / 30.0).abs() < 1e-9 && (start + length - (1.75 - 20.0 / 30.0)).abs() < 1e-9);
    assert!((source_in_seconds(&video, &tone_right) - (40.0 / 30.0 - 0.25)).abs() < 1e-9);
    assert_eq!(span_of(&video, &caption), (0, 100));
    assert_eq!(span_of(&video, &text), (0, 120));
    let TimelineItem::Caption(c) = &video.state().items[&caption].value else {
        panic!()
    };
    assert_eq!(c.scope_item_ids, vec![a.clone(), right.clone(), b.clone()]);

    // 整个落在区间里的删掉：[20, 40) 现在正好是 A 的右段。
    let again = vec![
        json!({ "type": "removeRange", "sequenceId": s, "from": { "unit": "frames", "value": 20 },
        "to": { "unit": "frames", "value": 40 }, "trackIds": [track(&video, "V1")], "alignment": "exact-frame" }),
    ];
    video.apply(&tx(&video, "cmd_cut_again", again)).unwrap();
    assert!(!video.state().items.contains_key(&right));
    assert_eq!(span_of(&video, &b), (20, 60));

    // 声明的轨道锁着：整笔拒绝。区间不足一帧、没声明轨道：拒绝。
    video
        .apply(&tx(
            &video,
            "cmd_lock",
            vec![json!({ "type": "updateTrack", "sequenceId": s, "trackId": track(&video, "V2"), "locked": true })],
        ))
        .unwrap();
    let locked = vec![
        json!({ "type": "removeRange", "sequenceId": s, "from": { "unit": "frames", "value": 0 },
        "to": { "unit": "frames", "value": 10 }, "trackIds": [track(&video, "V1"), track(&video, "V2")], "alignment": "exact-frame" }),
    ];
    assert_eq!(err_code(video.apply(&tx(&video, "cmd_locked", locked))), "TARGET_LOCKED");
    let empty = vec![
        json!({ "type": "removeRange", "sequenceId": s, "from": { "unit": "frames", "value": 10 },
        "to": { "unit": "frames", "value": 10 }, "trackIds": [track(&video, "V1")], "alignment": "exact-frame" }),
    ];
    assert_eq!(err_code(video.apply(&tx(&video, "cmd_empty", empty))), "TIME_RANGE_COLLAPSED");
    let none = vec![
        json!({ "type": "removeRange", "sequenceId": s, "from": { "unit": "frames", "value": 0 },
        "to": { "unit": "frames", "value": 10 }, "trackIds": [], "alignment": "exact-frame" }),
    ];
    assert_eq!(err_code(video.apply(&tx(&video, "cmd_none", none))), "INVALID_OPERATION");

    // 撤销第一次剪切（选择性撤销，之后的步骤先撤）：回到剪切前。
    for command in ["cmd_undo_lock", "cmd_undo_again", "cmd_undo_cut"] {
        video
            .undo(&UndoRequest {
                command_id: command.into(),
                target: UndoTarget::Undo,
                expected_revision: None,
                actor: user(),
            })
            .unwrap();
    }
    assert_eq!(span_of(&video, &a), (0, 60));
    assert_eq!(span_of(&video, &b), (60, 60));
    assert_eq!(span_of(&video, &caption), (0, 120));
    let TimelineItem::Caption(c) = &video.state().items[&caption].value else {
        panic!()
    };
    assert_eq!(c.scope_item_ids, vec![a, b]);
}

#[test]
fn insert_range_splits_straddlers_and_shifts_the_declared_tracks() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    // V1：A [0, 60)、B [60, 120)；A1：音频 0.25–1.75 秒；V2：文字 [0, 120)。
    let ids = import_video(&mut video, fixtures, 2);
    let (a, b) = (ids[0].clone(), ids[1].clone());
    let s = seq(&video);
    let setup = vec![
        json!({ "type": "importAsset", "path": fixtures.audio, "ref": "tone" }),
        json!({ "type": "addItem", "sequenceId": s, "asset": { "ref": "tone" }, "at": { "unit": "seconds", "value": "0.25" }, "alignment": "exact-frame" }),
        json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "ref": "v2" }),
        json!({ "type": "insertItems", "sequenceId": s, "items": [
            { "type": "text", "trackRef": "v2", "span": { "fromFrame": 0, "durationFrames": 120 },
              "place": { "x": 50, "y": 50, "w": 40 }, "text": "标题", "style": {} },
        ] }),
    ];
    video.apply(&tx(&video, "cmd_setup", setup)).unwrap();
    let find = |video: &Video, kind: &str| -> String {
        video
            .state()
            .items
            .values()
            .find(|p| serde_json::to_value(&p.value).unwrap()["type"] == kind)
            .map(|p| p.value.base().id.clone())
            .unwrap()
    };
    let (tone, text) = (find(&video, "audio"), find(&video, "text"));
    let declared = json!([track(&video, "V1"), track(&video, "A1")]);

    // 在第 20 帧插入 15 帧（缺省 split）：A 拆开、右段后移；B 后移；音频同样拆开后移；没声明的 V2 不动。
    let insert = vec![
        json!({ "type": "insertRange", "sequenceId": s, "at": { "unit": "frames", "value": 20 },
        "duration": { "unit": "frames", "value": 15 }, "trackIds": declared, "alignment": "exact-frame" }),
    ];
    let committed = video.apply(&tx(&video, "cmd_insert", insert)).unwrap();
    assert_eq!(committed.receipt.label, "Insert time");
    let created = committed.receipt.created_ids.clone();
    assert_eq!(created.len(), 2);
    let right = created
        .iter()
        .find(|id| video.state().items[*id].value.span().is_some())
        .unwrap()
        .clone();
    let tone_right = created.iter().find(|id| **id != right).unwrap().clone();
    assert_eq!(span_of(&video, &a), (0, 20));
    assert_eq!(span_of(&video, &right), (35, 40));
    assert!((source_in_seconds(&video, &right) - 20.0 / 30.0).abs() < 1e-9);
    assert_eq!(span_of(&video, &b), (75, 60));
    let (start, length) = audio_range(&video, &tone);
    assert!((start - 0.25).abs() < 1e-9 && (start + length - 20.0 / 30.0).abs() < 1e-9);
    let (start, length) = audio_range(&video, &tone_right);
    assert!((start - 35.0 / 30.0).abs() < 1e-9 && (length - (1.75 - 20.0 / 30.0)).abs() < 1e-9);
    assert!((source_in_seconds(&video, &tone_right) - (20.0 / 30.0 - 0.25)).abs() < 1e-9);
    assert_eq!(span_of(&video, &text), (0, 120));

    // 音频按精确时间后移：子帧起点保留。
    let audio_only = vec![
        json!({ "type": "insertRange", "sequenceId": s, "at": { "unit": "frames", "value": 0 },
        "duration": { "unit": "frames", "value": 3 }, "trackIds": [track(&video, "A1")], "alignment": "exact-frame" }),
    ];
    video.apply(&tx(&video, "cmd_insert_audio", audio_only)).unwrap();
    let (start, _) = audio_range(&video, &tone);
    assert!((start - (0.25 + 3.0 / 30.0)).abs() < 1e-9);

    // 声明的轨道锁着：整笔拒绝。不足一帧、没声明轨道：拒绝。
    video
        .apply(&tx(
            &video,
            "cmd_lock",
            vec![json!({ "type": "updateTrack", "sequenceId": s, "trackId": track(&video, "V2"), "locked": true })],
        ))
        .unwrap();
    let locked = vec![
        json!({ "type": "insertRange", "sequenceId": s, "at": { "unit": "frames", "value": 0 },
        "duration": { "unit": "frames", "value": 10 }, "trackIds": [track(&video, "V1"), track(&video, "V2")], "alignment": "exact-frame" }),
    ];
    assert_eq!(err_code(video.apply(&tx(&video, "cmd_locked", locked))), "TARGET_LOCKED");
    let empty = vec![
        json!({ "type": "insertRange", "sequenceId": s, "at": { "unit": "frames", "value": 10 },
        "duration": { "unit": "seconds", "value": "0.01" }, "trackIds": [track(&video, "V1")], "alignment": "nearest-frame" }),
    ];
    assert_eq!(err_code(video.apply(&tx(&video, "cmd_empty", empty))), "TIME_RANGE_COLLAPSED");
    let none = vec![
        json!({ "type": "insertRange", "sequenceId": s, "at": { "unit": "frames", "value": 0 },
        "duration": { "unit": "frames", "value": 10 }, "trackIds": [], "alignment": "exact-frame" }),
    ];
    assert_eq!(err_code(video.apply(&tx(&video, "cmd_none", none))), "INVALID_OPERATION");

    // 撤销回到插入前。
    for command in ["cmd_undo_lock", "cmd_undo_audio", "cmd_undo_insert"] {
        video
            .undo(&UndoRequest {
                command_id: command.into(),
                target: UndoTarget::Undo,
                expected_revision: None,
                actor: user(),
            })
            .unwrap();
    }
    assert_eq!(span_of(&video, &a), (0, 60));
    assert_eq!(span_of(&video, &b), (60, 60));
    assert!(!video.state().items.contains_key(&right) && !video.state().items.contains_key(&tone_right));
}

#[test]
fn insert_range_stay_keeps_straddlers_and_drops_transitions_that_no_longer_touch() {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let s = seq(&video);
    let text = |track: &str, from: i64, frames: i64, label: &str| {
        json!({ "type": "text", "trackRef": track, "span": { "fromFrame": from, "durationFrames": frames },
                "place": { "x": 50, "y": 50, "w": 40 }, "text": label, "style": {} })
    };
    let mut tail = text("v3", 20, 10, "片尾条");
    tail["untilSequenceEnd"] = json!(true);
    let setup = vec![
        json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "ref": "v1" }),
        json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "ref": "v2" }),
        json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "ref": "v3" }),
        json!({ "type": "insertItems", "sequenceId": s, "items": [
            text("v1", 0, 60, "一"), text("v1", 60, 60, "二"), text("v2", 0, 300, "铺底"), tail,
        ] }),
    ];
    video.apply(&tx(&video, "cmd_setup", setup)).unwrap();
    let by_label = |video: &Video, label: &str| -> String {
        video
            .state()
            .items
            .values()
            .find(|p| serde_json::to_value(&p.value).unwrap()["text"] == label)
            .map(|p| p.value.base().id.clone())
            .unwrap()
    };
    let (one, two, bed, tail) = (
        by_label(&video, "一"),
        by_label(&video, "二"),
        by_label(&video, "铺底"),
        by_label(&video, "片尾条"),
    );
    let tracks: Vec<String> = [&one, &bed, &tail]
        .iter()
        .map(|id| video.state().items[*id].value.base().track_id.clone())
        .collect();
    let set = video
        .apply(&tx(
            &video,
            "cmd_tr",
            vec![
                json!({ "type": "setTransition", "sequenceId": s, "leftItemId": one, "rightItemId": two, "kind": "dissolve",
                         "duration": { "unit": "frames", "value": 10 }, "alignment": "exact-frame" }),
            ],
        ))
        .unwrap();
    let transition = set.receipt.created_ids[0].clone();

    // 在第 60 帧插入 30 帧、跨着的不动：一号停在原处，二号后移，二者不再相接，转场随之删掉；铺底与到序列末尾的都不动。
    let insert = vec![
        json!({ "type": "insertRange", "sequenceId": s, "at": { "unit": "frames", "value": 60 },
        "duration": { "unit": "frames", "value": 30 }, "trackIds": tracks, "alignment": "exact-frame", "straddle": "stay" }),
    ];
    let committed = video.apply(&tx(&video, "cmd_insert", insert)).unwrap();
    assert!(committed.receipt.created_ids.is_empty());
    assert_eq!(span_of(&video, &one), (0, 60));
    assert_eq!(span_of(&video, &two), (90, 60));
    assert_eq!(span_of(&video, &bed), (0, 300));
    assert_eq!(span_of(&video, &tail).0, 20);
    let impact = serde_json::to_value(&committed.receipt.impact).unwrap();
    assert_eq!(
        impact["removedTransitions"],
        json!([{ "id": transition, "reason": "not-adjacent" }])
    );

    // 缺省 split：铺底在第 30 帧拆开、右段后移；到序列末尾的实例跨着也不拆。
    let split = vec![
        json!({ "type": "insertRange", "sequenceId": s, "at": { "unit": "frames", "value": 30 },
        "duration": { "unit": "frames", "value": 10 }, "trackIds": [tracks[1], tracks[2]], "alignment": "exact-frame" }),
    ];
    let committed = video.apply(&tx(&video, "cmd_split", split)).unwrap();
    assert_eq!(committed.receipt.created_ids.len(), 1);
    let bed_right = committed.receipt.created_ids[0].clone();
    assert_eq!(span_of(&video, &bed), (0, 30));
    assert_eq!(span_of(&video, &bed_right), (40, 270));
    assert_eq!(span_of(&video, &tail).0, 20);
    assert_eq!(span_of(&video, &one), (0, 60));
}

#[test]
fn trimming_past_the_source_is_rejected() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let ids = import_video(&mut video, fixtures, 1);
    let trim = vec![
        json!({ "type": "trimItem", "sequenceId": seq(&video), "itemId": ids[0], "edge": "end", "at": { "unit": "frames", "value": 61 }, "alignment": "exact-frame" }),
    ];
    assert_eq!(err_code(video.apply(&tx(&video, "cmd_trim", trim))), "SOURCE_TIME_OUT_OF_RANGE");
    let collapse = vec![
        json!({ "type": "trimItem", "sequenceId": seq(&video), "itemId": ids[0], "edge": "start", "at": { "unit": "frames", "value": 60 }, "alignment": "exact-frame" }),
    ];
    assert_eq!(err_code(video.apply(&tx(&video, "cmd_collapse", collapse))), "TIME_RANGE_COLLAPSED");
    // 从头裁掉 10 帧：sourceIn 前移 1/3 秒。
    let start = vec![
        json!({ "type": "trimItem", "sequenceId": seq(&video), "itemId": ids[0], "edge": "start", "at": { "unit": "frames", "value": 10 }, "alignment": "exact-frame" }),
    ];
    video.apply(&tx(&video, "cmd_start", start)).unwrap();
    let TimelineItem::Video(v) = &video.state().items[&ids[0]].value else {
        panic!()
    };
    let editor_semantics::TimeMap::Linear { source_in, .. } = &v.time_map else {
        panic!()
    };
    assert_eq!((source_in.ticks.as_str(), source_in.timescale), ("1", 3));
    assert_eq!(span_of(&video, &ids[0]), (10, 50));
}

#[test]
fn overlaps_are_rejected_but_a_swap_in_one_transaction_works() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let ids = import_video(&mut video, fixtures, 2);
    let s = seq(&video);
    let onto = vec![
        json!({ "type": "moveItem", "sequenceId": s, "itemId": ids[1], "at": { "unit": "frames", "value": 30 }, "alignment": "exact-frame" }),
    ];
    assert_eq!(err_code(video.apply(&tx(&video, "cmd_overlap", onto))), "TIMELINE_OVERLAP");
    let swap = vec![json!({ "type": "moveItems", "sequenceId": s, "alignment": "exact-frame", "moves": [
        { "itemId": ids[0], "at": { "unit": "frames", "value": 60 } },
        { "itemId": ids[1], "at": { "unit": "frames", "value": 0 } },
    ] })];
    video.apply(&tx(&video, "cmd_swap", swap)).unwrap();
    assert_eq!(item_ids(&video), vec![ids[1].clone(), ids[0].clone()]);
}

#[test]
fn locked_tracks_refuse_edits() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let ids = import_video(&mut video, fixtures, 1);
    let v1 = track(&video, "V1");
    video
        .apply(&tx(
            &video,
            "cmd_lock",
            vec![json!({ "type": "updateTrack", "trackId": v1, "locked": true })],
        ))
        .unwrap();
    let del = vec![json!({ "type": "deleteItems", "sequenceId": seq(&video), "itemIds": [ids[0]] })];
    let err = video.apply(&tx(&video, "cmd_del", del)).expect_err("锁定的轨道");
    assert_eq!(err.code, "TARGET_LOCKED");
    assert_eq!(err.entity_ids, vec![v1]);
}

#[test]
fn audio_keeps_subframe_precision() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let ops = vec![
        json!({ "type": "importAsset", "path": fixtures.audio, "ref": "tone" }),
        json!({ "type": "addItem", "sequenceId": seq(&video), "asset": { "ref": "tone" }, "at": { "unit": "seconds", "value": "1.01" }, "alignment": "nearest-frame" }),
    ];
    let committed = video.apply(&tx(&video, "cmd_audio", ops)).unwrap();
    assert!(committed.receipt.time_resolution.is_empty(), "音频不量化");
    let id = &item_ids(&video)[0];
    let TimelineItem::Audio(a) = &video.state().items[id].value else {
        panic!("应是音频")
    };
    assert_eq!(a.from_frame, 30);
    assert_eq!((a.subframe_offset.ticks.as_str(), a.subframe_offset.timescale), ("1", 100));
    assert_eq!((a.play_duration.ticks.as_str(), a.play_duration.timescale), ("3", 2));
    assert_eq!(a.base.track_id, track(&video, "A1"));
}

#[test]
fn reimporting_the_same_bytes_reuses_the_asset() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let first = video
        .apply(&tx(
            &video,
            "cmd_first",
            vec![json!({ "type": "importAsset", "path": fixtures.video_file, "storage": "managed" })],
        ))
        .unwrap();
    let asset_id = first.receipt.created_ids[0].clone();
    let again = video
        .apply(&tx(
            &video,
            "cmd_again",
            vec![json!({ "type": "importAsset", "path": fixtures.video_file, "storage": "managed" })],
        ))
        .unwrap();
    assert_eq!(video.state().assets.len(), 1);
    assert_eq!(again.receipt.preserved, vec![asset_id.clone()]);
    // 不指定存放方式（链接）导入同样的 bytes 也复用原素材。
    let linked = video
        .apply(&tx(
            &video,
            "cmd_linked",
            vec![json!({ "type": "importAsset", "path": fixtures.video_file })],
        ))
        .unwrap();
    assert_eq!(linked.receipt.preserved, vec![asset_id.clone()]);
    assert_eq!(video.state().assets.len(), 1);
    let blob = video.blob_path(&asset_id, None).unwrap();
    assert!(blob.starts_with(dir.path().join("blobs")));
    assert_eq!(
        std::fs::read_dir(dir.path().join("blobs/.staging")).unwrap().count(),
        0,
        "staging 清空"
    );
}

#[test]
fn rebaking_the_same_bytes_from_another_bundle_adds_a_revision() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let baked = |bundle: &str| {
        json!({
            "type": "importAsset",
            "path": fixtures.video_file,
            "storage": "managed",
            "provenance": { "origin": "composition-bake", "source": { "sourceBundleRef": { "id": bundle, "revision": "1" } } },
        })
    };
    let first = video.apply(&tx(&video, "cmd_bake_a", vec![baked("bundle_a")])).unwrap();
    let asset_id = first.receipt.created_ids[0].clone();
    let baked_from = |video: &Video, revision: &str| {
        video.state().assets[&asset_id].revisions[revision].provenance.source.as_ref().unwrap()["sourceBundleRef"]["id"].clone()
    };

    // 另一个代码包烘出了相同的 bytes：同一个素材加一个版本，记下新的出处；旧版本原样留着。
    let again = video.apply(&tx(&video, "cmd_bake_b", vec![baked("bundle_b")])).unwrap();
    assert!(again.receipt.preserved.is_empty());
    assert_eq!(video.state().assets.len(), 1);
    let asset = &video.state().assets[&asset_id];
    assert_eq!(asset.current_revision, "2");
    assert_eq!(asset.revisions["1"].content_hash, asset.revisions["2"].content_hash);
    assert_eq!(baked_from(&video, "1"), json!("bundle_a"));
    assert_eq!(baked_from(&video, "2"), json!("bundle_b"));

    // 同一个代码包再烘一次、或普通导入相同的 bytes：照旧复用，不加版本。
    for (command, op) in [
        ("cmd_bake_b_again", baked("bundle_b")),
        ("cmd_plain", json!({ "type": "importAsset", "path": fixtures.video_file, "storage": "managed" })),
    ] {
        let reused = video.apply(&tx(&video, command, vec![op])).unwrap();
        assert_eq!(reused.receipt.preserved, vec![asset_id.clone()]);
        assert_eq!(video.state().assets[&asset_id].current_revision, "2");
    }
}

#[test]
fn t08_undo_does_not_erase_later_additions_and_redo_works() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let ids = import_video(&mut video, fixtures, 1);
    let asset = video.state().assets.keys().next().unwrap().clone();
    let s = seq(&video);

    // 用户移动片段；之后智能体又加了一个片段。
    let moved = video
        .apply(&tx(&video, "cmd_move", vec![json!({ "type": "moveItem", "sequenceId": s, "itemId": ids[0], "at": { "unit": "frames", "value": 100 }, "alignment": "exact-frame" })]))
        .unwrap();
    let mut by_agent = tx(
        &video,
        "cmd_agent_add",
        vec![
            json!({ "type": "addItem", "sequenceId": s, "asset": { "assetId": asset }, "at": { "unit": "frames", "value": 200 }, "alignment": "exact-frame" }),
        ],
    );
    by_agent.actor = agent();
    let added = video.apply(&by_agent).unwrap().receipt.created_ids[0].clone();

    // 撤销用户的移动：只补偿那一笔，智能体的片段保留。
    let undo = UndoRequest {
        command_id: "cmd_undo_move".into(),
        target: UndoTarget::Transaction(moved.receipt.transaction_id.clone()),
        expected_revision: None,
        actor: user(),
    };
    let undone = video.undo(&undo).unwrap();
    assert_eq!(undone.receipt.undo_of.as_deref(), Some(moved.receipt.transaction_id.as_str()));
    assert_eq!(span_of(&video, &ids[0]).0, 0, "回到原位");
    assert!(video.state().items.contains_key(&added), "智能体的片段还在");
    assert_eq!(
        err_code(video.undo(&UndoRequest {
            command_id: "cmd_undo_twice".into(),
            ..undo.clone()
        })),
        "UNDO_UNAVAILABLE"
    );

    // 同一个撤销请求重试：返回原回执。
    assert_eq!(video.undo(&undo).unwrap().receipt, undone.receipt);

    // 重做 = 撤销那次撤销。
    let redo = UndoRequest {
        command_id: "cmd_redo".into(),
        target: UndoTarget::Transaction(undone.receipt.transaction_id.clone()),
        expected_revision: None,
        actor: user(),
    };
    video.undo(&redo).unwrap();
    assert_eq!(span_of(&video, &ids[0]).0, 100);

    let history = video.history(10).unwrap();
    assert_eq!(history[0].label, "Redo: Move clips");
    assert_eq!(history[0].undo_depth, 2);
    assert!(history.iter().any(|h| h.actor == agent()));
}

#[test]
fn undo_conflicts_when_the_target_changed_afterwards() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let ids = import_video(&mut video, fixtures, 1);
    let s = seq(&video);
    let first = video
        .apply(&tx(&video, "cmd_m1", vec![json!({ "type": "moveItem", "sequenceId": s, "itemId": ids[0], "at": { "unit": "frames", "value": 30 }, "alignment": "exact-frame" })]))
        .unwrap();
    video
        .apply(&tx(&video, "cmd_m2", vec![json!({ "type": "moveItem", "sequenceId": s, "itemId": ids[0], "at": { "unit": "frames", "value": 90 }, "alignment": "exact-frame" })]))
        .unwrap();
    let err = video
        .undo(&UndoRequest {
            command_id: "cmd_u".into(),
            target: UndoTarget::Transaction(first.receipt.transaction_id),
            expected_revision: None,
            actor: user(),
        })
        .expect_err("之后又被移动过");
    assert_eq!(err.code, "UNDO_CONFLICT");
    assert_eq!(err.entity_ids, vec![ids[0].clone()]);
    assert_eq!(span_of(&video, &ids[0]).0, 90);
}

#[test]
fn undoing_an_import_is_refused_while_a_later_item_uses_the_asset() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let imported = video
        .apply(&tx(
            &video,
            "cmd_imp",
            vec![json!({ "type": "importAsset", "path": fixtures.video_file })],
        ))
        .unwrap();
    let asset = imported.receipt.created_ids[0].clone();
    video
        .apply(&tx(
            &video,
            "cmd_add",
            vec![json!({ "type": "addItem", "sequenceId": seq(&video), "asset": { "assetId": asset }, "alignment": "nearest-frame" })],
        ))
        .unwrap();
    let err = video
        .undo(&UndoRequest {
            command_id: "cmd_u".into(),
            target: UndoTarget::Transaction(imported.receipt.transaction_id),
            expected_revision: None,
            actor: user(),
        })
        .expect_err("片段还在用这个素材");
    assert_eq!(err.code, "UNDO_CONFLICT");
}

#[test]
fn payload_hash_ignores_key_order() {
    let a = json!({ "operations": [{ "type": "renameVideo", "name": "x" }], "baseVideoRevision": "3" });
    let b = json!({ "baseVideoRevision": "3", "operations": [{ "name": "x", "type": "renameVideo" }] });
    assert_eq!(payload_hash(&a), payload_hash(&b));
    let c = json!({ "baseVideoRevision": "3", "operations": [{ "name": "y", "type": "renameVideo" }] });
    assert_ne!(payload_hash(&a), payload_hash(&c));
}

#[test]
fn read_only_open_works_after_the_writer_closed() {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    video
        .apply(&tx(
            &video,
            "cmd_ro_after",
            vec![json!({ "type": "renameVideo", "name": "关闭之后" })],
        ))
        .unwrap();
    let snapshot = video.snapshot();
    drop(video);
    let reader = Video::open(dir.path(), OpenMode::ReadOnly, &ffprobe()).unwrap();
    assert_eq!(reader.snapshot(), snapshot);
    // 只读打开不占写锁。
    Video::open(dir.path(), OpenMode::Write, &ffprobe()).expect("写锁可用");
}

#[test]
fn undo_stack_follows_the_actor_and_clears_redo_after_a_new_edit() {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let step = |video: &mut Video, cmd: &str, target: UndoTarget| {
        video.undo(&UndoRequest {
            command_id: cmd.into(),
            target,
            expected_revision: None,
            actor: user(),
        })
    };
    for (i, name) in ["一", "二", "三"].iter().enumerate() {
        video
            .apply(&tx(
                &video,
                &format!("cmd_name_{i}"),
                vec![json!({ "type": "renameVideo", "name": name })],
            ))
            .unwrap();
    }
    // 智能体的修改不进入用户的撤销栈。
    let mut by_agent = tx(
        &video,
        "cmd_agent_track",
        vec![json!({ "type": "addTrack", "sequenceId": seq(&video), "kind": "audio" })],
    );
    by_agent.actor = agent();
    video.apply(&by_agent).unwrap();
    assert_eq!(video.undo_state(&user()).unwrap().undo.unwrap().label, "Rename video");
    assert!(video.undo_state(&user()).unwrap().redo.is_none());

    step(&mut video, "u1", UndoTarget::Undo).unwrap();
    step(&mut video, "u2", UndoTarget::Undo).unwrap();
    assert_eq!(video.state().name, "一");
    assert_eq!(video.state().tracks.len(), 3, "智能体的轨道保留");
    step(&mut video, "r1", UndoTarget::Redo).unwrap();
    assert_eq!(video.state().name, "二");
    step(&mut video, "r2", UndoTarget::Redo).unwrap();
    assert_eq!(video.state().name, "三");
    assert!(video.undo_state(&user()).unwrap().redo.is_none());
    assert_eq!(err_code(step(&mut video, "r3", UndoTarget::Redo)), "UNDO_UNAVAILABLE");

    // 撤销之后又有新的修改：重做栈清空。
    step(&mut video, "u3", UndoTarget::Undo).unwrap();
    assert!(video.undo_state(&user()).unwrap().redo.is_some());
    video
        .apply(&tx(&video, "cmd_new", vec![json!({ "type": "renameVideo", "name": "四" })]))
        .unwrap();
    assert!(video.undo_state(&user()).unwrap().redo.is_none());
    // 重试同一个方向撤销：取回原回执，不再撤销一步。
    let first = step(&mut video, "u4", UndoTarget::Undo).unwrap();
    let again = step(&mut video, "u4", UndoTarget::Undo).unwrap();
    assert_eq!(first.receipt, again.receipt);
    assert_eq!(video.state().name, "二");
}

#[test]
fn undo_that_would_overlap_a_later_item_is_an_undo_conflict() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let ids = import_video(&mut video, fixtures, 1);
    let asset = video.state().assets.keys().next().unwrap().clone();
    let s = seq(&video);
    let moved = video
        .apply(&tx(&video, "cmd_move", vec![json!({ "type": "moveItem", "sequenceId": s, "itemId": ids[0], "at": { "unit": "frames", "value": 100 }, "alignment": "exact-frame" })]))
        .unwrap();
    let mut by_agent = tx(
        &video,
        "cmd_agent",
        vec![
            json!({ "type": "addItem", "sequenceId": s, "asset": { "assetId": asset }, "at": { "unit": "frames", "value": 0 }, "alignment": "exact-frame" }),
        ],
    );
    by_agent.actor = agent();
    let added = video.apply(&by_agent).unwrap().receipt.created_ids[0].clone();
    let err = video
        .undo(&UndoRequest {
            command_id: "cmd_u".into(),
            target: UndoTarget::Transaction(moved.receipt.transaction_id),
            expected_revision: None,
            actor: user(),
        })
        .expect_err("恢复的位置被占用");
    assert_eq!(err.code, "UNDO_CONFLICT");
    assert!(err.entity_ids.contains(&added));
}

#[test]
fn speed_changes_keep_the_source_range_and_refuse_to_push_neighbours() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let ids = import_video(&mut video, fixtures, 2);
    let s = seq(&video);
    let speed =
        |id: &str, num: i64, den: i64| json!({ "type": "setSpeed", "sequenceId": s, "itemId": id, "rate": { "num": num, "den": den } });

    // 2 秒的素材以 2 倍速播放：长度减半，源区间不变。
    video.apply(&tx(&video, "cmd_fast", vec![speed(&ids[0], 2, 1)])).unwrap();
    assert_eq!(span_of(&video, &ids[0]), (0, 30));
    let TimelineItem::Video(v) = &video.state().items[&ids[0]].value else {
        panic!("应是视频")
    };
    assert_eq!(
        v.time_map,
        editor_semantics::TimeMap::Linear {
            source_in: editor_semantics::MediaTime::zero(),
            rate: Rate { num: 2, den: 1 }
        }
    );

    // 放慢到 0.5 倍会盖住后面的实例：拒绝，不推开别人。
    assert_eq!(
        err_code(video.apply(&tx(&video, "cmd_slow", vec![speed(&ids[0], 1, 2)]))),
        "TIMELINE_OVERLAP"
    );
    assert_eq!(
        err_code(video.apply(&tx(&video, "cmd_range", vec![speed(&ids[0], 1, 20)]))),
        "INVALID_OPERATION"
    );
    // 3/2 倍：60 帧的源区间放 40 帧。
    video.apply(&tx(&video, "cmd_mid", vec![speed(&ids[0], 3, 2)])).unwrap();
    assert_eq!(span_of(&video, &ids[0]), (0, 40));

    // 音频的长度保持精确，不落到帧上。
    let ops = vec![
        json!({ "type": "importAsset", "path": fixtures.audio, "ref": "tone" }),
        json!({ "type": "addItem", "sequenceId": s, "asset": { "ref": "tone" }, "at": { "unit": "frames", "value": 0 }, "alignment": "exact-frame" }),
    ];
    let audio = video
        .apply(&tx(&video, "cmd_audio", ops))
        .unwrap()
        .receipt
        .created_ids
        .last()
        .unwrap()
        .clone();
    video.apply(&tx(&video, "cmd_audio_fast", vec![speed(&audio, 2, 1)])).unwrap();
    let TimelineItem::Audio(a) = &video.state().items[&audio].value else {
        panic!("应是音频")
    };
    assert_eq!((a.play_duration.ticks.as_str(), a.play_duration.timescale), ("3", 4));
}

#[test]
fn audio_mix_and_picture_fit_follow_the_item_kind() {
    let Some(fixtures) = fixtures() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(dir.path());
    let id = import_video(&mut video, fixtures, 1)[0].clone();
    let s = seq(&video);
    let ops = vec![
        json!({ "type": "setAudioMix", "itemId": id, "muted": true, "volume": 0.5, "fadeIn": "0.5", "fadeOut": "0" }),
        json!({ "type": "setStyle", "sequenceId": s, "itemId": id, "mode": "pip", "fit": "cover", "bg": "blur", "opacity": 0.8 }),
    ];
    let committed = video.apply(&tx(&video, "cmd_mix", ops)).unwrap();
    assert_eq!(committed.receipt.label, "Adjust audio and more (2 changes)");
    let TimelineItem::Video(v) = &video.state().items[&id].value else {
        panic!("应是视频")
    };
    let fade_in = v.embedded_audio.fade_in.as_ref().map(|t| (t.ticks.as_str(), t.timescale));
    assert_eq!(
        (v.embedded_audio.enabled, v.embedded_audio.volume, fade_in),
        (false, 0.5, Some(("1", 2)))
    );
    assert_eq!(
        (v.media.mode, v.media.fit, v.media.bg, v.place.opacity),
        (Some(VisualMode::Pip), Some(Fit::Cover), Some(Background::Blur), Some(0.8))
    );

    // 淡入淡出之和超过片段长度（2 秒）、音量超出 v2 的 [0, 4]、写错的秒数：都拒绝。
    for (n, op) in [
        json!({ "type": "setAudioMix", "itemId": id, "fadeIn": "1.5", "fadeOut": "0.6" }),
        json!({ "type": "setAudioMix", "itemId": id, "volume": 5 }),
        json!({ "type": "setAudioMix", "itemId": id, "gainDb": -6 }),
        json!({ "type": "setAudioMix", "itemId": id }),
    ]
    .into_iter()
    .enumerate()
    {
        assert_eq!(
            err_code(video.apply(&tx(&video, &format!("cmd_bad_{n}"), vec![op]))),
            "INVALID_OPERATION"
        );
    }
    let bad_seconds = json!({ "type": "setAudioMix", "itemId": id, "fadeIn": "1e3" });
    assert!(video.apply(&tx(&video, "cmd_bad_seconds", vec![bad_seconds])).is_err());

    // 去掉留边、恢复声音。
    let ops = vec![
        json!({ "type": "setStyle", "itemId": id, "bg": null }),
        json!({ "type": "setAudioMix", "itemId": id, "muted": false, "fadeIn": "0" }),
    ];
    video.apply(&tx(&video, "cmd_reset", ops)).unwrap();
    let TimelineItem::Video(v) = &video.state().items[&id].value else {
        panic!("应是视频")
    };
    assert_eq!(
        (v.media.bg, v.embedded_audio.enabled, v.embedded_audio.fade_in.is_none()),
        (None, true, true)
    );
}
