//! 转场：设置与删除、handles 规则，以及移动、裁切、拆分、删除之后的存续；单侧转场随实例变短（视频格式规范 §3.9）。
//! 文字与形状没有 handles 的限制，大部分规则用它们测；handles 用 ffmpeg 现场生成的视频测，没有 ffmpeg 时跳过。

#![allow(clippy::result_large_err)]

use std::path::{Path, PathBuf};
use std::process::Command;

use editor_semantics::Rate;
use serde_json::{Value, json};
use video_engine::model::{Actor, ActorKind, TransitionKind, TransitionPlacement};
use video_engine::{Committed, CreateOptions, ErrorBody, UndoRequest, UndoTarget, Video, VideoTransaction};

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
        name: "转场".into(),
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

fn seq(video: &Video) -> String {
    video.state().root_sequence_id.clone()
}

fn v1(video: &Video) -> String {
    video
        .state()
        .tracks
        .values()
        .find(|t| t.value.name.as_deref() == Some("V1"))
        .map(|t| t.value.id.clone())
        .unwrap()
}

fn frames(n: i64) -> Value {
    json!({ "unit": "frames", "value": n })
}

fn text(track: &str, from: i64, duration: i64, label: &str) -> Value {
    json!({ "type": "text", "trackId": track, "span": { "fromFrame": from, "durationFrames": duration },
            "place": { "x": 50, "y": 50, "w": 40 }, "text": label, "style": {} })
}

/// V1 上三段首尾相接的文字：a [0,60)、b [60,120)、c [120,180)。
fn three_texts() -> (Video, tempfile::TempDir, [String; 3]) {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(&dir.path().join("m"));
    let (s, t) = (seq(&video), v1(&video));
    let items = json!([text(&t, 0, 60, "a"), text(&t, 60, 60, "b"), text(&t, 120, 60, "c")]);
    let committed = apply(
        &mut video,
        "cmd_setup",
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": items })],
    )
    .unwrap();
    let mut ids: Vec<String> = committed.receipt.created_ids.clone();
    ids.sort_by_key(|id| video.state().items[id].value.span().unwrap().from_frame);
    (video, dir, [ids[0].clone(), ids[1].clone(), ids[2].clone()])
}

fn dissolve(s: &str, left: Option<&str>, right: Option<&str>, duration: i64) -> Value {
    let mut op =
        json!({ "type": "setTransition", "sequenceId": s, "kind": "dissolve", "duration": frames(duration), "alignment": "exact-frame" });
    if let Some(l) = left {
        op["leftItemId"] = json!(l);
    }
    if let Some(r) = right {
        op["rightItemId"] = json!(r);
    }
    op
}

fn transitions(video: &Video) -> Vec<video_engine::model::Transition> {
    let snapshot = video.snapshot();
    snapshot.sequences[&snapshot.root_sequence_id].transitions.clone()
}

fn code(result: Result<Committed, ErrorBody>) -> String {
    result.expect_err("应当失败").code
}

#[test]
fn set_transition_creates_updates_in_place_and_undoes() {
    let (mut video, _dir, [a, b, _]) = three_texts();
    let s = seq(&video);
    let committed = apply(&mut video, "cmd_tr", vec![dissolve(&s, Some(&a), Some(&b), 30)]).unwrap();
    assert_eq!(committed.receipt.label, "设置转场");
    let list = transitions(&video);
    assert_eq!(list.len(), 1);
    let tr = &list[0];
    assert_eq!(committed.receipt.created_ids, vec![tr.id.clone()]);
    assert_eq!(
        (tr.duration_frames, tr.placement, &tr.kind),
        (30, TransitionPlacement::Center, &TransitionKind::Dissolve)
    );
    assert_eq!(committed.receipt.time_resolution.len(), 1, "时长量化一次");

    // 同一对实例再设一次：就地替换，ID 不变。
    let op = json!({ "type": "setTransition", "sequenceId": s, "leftItemId": a, "rightItemId": b, "kind": "push",
                     "params": { "direction": "left" }, "duration": { "unit": "seconds", "value": "0.5" }, "alignment": "nearest-frame", "easing": "ease-in-out",
                     "placement": "end-at-cut", "audioCrossfade": true });
    let updated = apply(&mut video, "cmd_tr2", vec![op]).unwrap();
    assert_eq!(updated.receipt.updated_ids, vec![tr.id.clone()]);
    let now = &transitions(&video)[0];
    assert_eq!(now.duration_frames, 15);
    assert_eq!(now.kind.name(), "push");
    assert!(now.audio_crossfade);

    // 撤销两次回到没有转场；重做回来。
    undo(&mut video, "cmd_undo2", &updated).unwrap();
    assert_eq!(transitions(&video)[0].kind, TransitionKind::Dissolve);
    let undone = undo(&mut video, "cmd_undo1", &committed).unwrap();
    assert!(transitions(&video).is_empty());
    undo(&mut video, "cmd_redo1", &undone).unwrap();
    assert_eq!(transitions(&video).len(), 1);

    // 删除。
    let removed = apply(
        &mut video,
        "cmd_rm",
        vec![json!({ "type": "removeTransition", "transitionId": tr.id })],
    )
    .unwrap();
    assert_eq!(removed.receipt.deleted_ids, vec![tr.id.clone()]);
    assert_eq!(removed.receipt.label, "删除转场");
}

#[test]
fn one_edge_holds_one_transition() {
    let (mut video, _dir, [a, b, c]) = three_texts();
    let s = seq(&video);
    apply(&mut video, "cmd_out", vec![dissolve(&s, Some(&b), None, 10)]).unwrap();
    let first = transitions(&video)[0].id.clone();
    // b 的结尾上再设一个两侧转场：替换掉 b 的单边出场转场。
    let committed = apply(&mut video, "cmd_pair", vec![dissolve(&s, Some(&b), Some(&c), 10)]).unwrap();
    assert_eq!(committed.receipt.deleted_ids, vec![first]);
    // 入场转场与出场转场可以同时在一个实例上。
    apply(&mut video, "cmd_in", vec![dissolve(&s, Some(&a), Some(&b), 10)]).unwrap();
    assert_eq!(transitions(&video).len(), 2);
}

#[test]
fn invalid_transitions_are_rejected() {
    let (mut video, _dir, [a, b, c]) = three_texts();
    let s = seq(&video);
    let before = video.revision();
    let cases = [
        // 不相接。
        (dissolve(&s, Some(&a), Some(&c), 10), "INVALID_OPERATION"),
        // 两侧都没给。
        (dissolve(&s, None, None, 10), "INVALID_OPERATION"),
        // 太长：居中 130 帧的窗口越过 a 的开头。
        (dissolve(&s, Some(&a), Some(&b), 130), "INVALID_OPERATION"),
        // 单侧转场的长度在 v2 的 0.1–2 秒之间：30 fps 下 3–60 帧。
        (dissolve(&s, None, Some(&a), 61), "INVALID_OPERATION"),
        (dissolve(&s, None, Some(&a), 2), "INVALID_OPERATION"),
        // 不足一帧。
        (dissolve(&s, Some(&a), Some(&b), 0), "TIME_RANGE_COLLAPSED"),
        // 两侧转场最长 10 秒。
        (dissolve(&s, Some(&a), Some(&b), 301), "INVALID_OPERATION"),
        // 不认识的种类（旧的 crossfade 已改名 dissolve）。
        (
            json!({ "type": "setTransition", "sequenceId": s, "leftItemId": a, "rightItemId": b, "kind": "crossfade", "duration": frames(10), "alignment": "exact-frame" }),
            "INVALID_OPERATION",
        ),
        // 前五种没有参数。
        (
            json!({ "type": "setTransition", "sequenceId": s, "leftItemId": a, "rightItemId": b, "kind": "wipe", "params": { "direction": "left" }, "duration": frames(10), "alignment": "exact-frame" }),
            "INVALID_OPERATION",
        ),
        (
            json!({ "type": "setTransition", "sequenceId": s, "leftItemId": a, "rightItemId": b, "kind": "dip-to-color", "params": { "color": "black" }, "duration": frames(10), "alignment": "exact-frame" }),
            "INVALID_OPERATION",
        ),
        // dip-to-color、push 只用于两侧。
        (
            json!({ "type": "setTransition", "sequenceId": s, "rightItemId": a, "kind": "dip-to-color", "params": { "color": "#000000" }, "duration": frames(10), "alignment": "exact-frame" }),
            "INVALID_OPERATION",
        ),
        (
            json!({ "type": "setTransition", "sequenceId": s, "leftItemId": c, "kind": "push", "params": { "direction": "up" }, "duration": frames(10), "alignment": "exact-frame" }),
            "INVALID_OPERATION",
        ),
        // 两侧转场要给长度；给了长度要写明 alignment。
        (
            json!({ "type": "setTransition", "sequenceId": s, "leftItemId": a, "rightItemId": b, "kind": "dissolve" }),
            "INVALID_OPERATION",
        ),
        (
            json!({ "type": "setTransition", "sequenceId": s, "rightItemId": a, "kind": "dissolve", "duration": frames(10) }),
            "INVALID_OPERATION",
        ),
        (
            json!({ "type": "setTransition", "sequenceId": s, "rightItemId": a, "kind": "dissolve", "placement": "start-at-cut", "duration": frames(10), "alignment": "exact-frame" }),
            "INVALID_OPERATION",
        ),
        (
            json!({ "type": "setTransition", "sequenceId": s, "rightItemId": a, "kind": "dissolve", "audioCrossfade": true, "duration": frames(10), "alignment": "exact-frame" }),
            "INVALID_OPERATION",
        ),
        // 没写 sequenceId。
        (
            json!({ "type": "setTransition", "leftItemId": a, "rightItemId": b, "kind": "dissolve", "duration": frames(10), "alignment": "exact-frame" }),
            "INVALID_OPERATION",
        ),
        (
            json!({ "type": "removeTransition", "transitionId": "tr_missing" }),
            "ENTITY_NOT_FOUND",
        ),
    ];
    for (n, (op, expected)) in cases.into_iter().enumerate() {
        let got = code(apply(&mut video, &format!("cmd_bad_{n}"), vec![op]));
        assert_eq!(got, expected, "第 {n} 个");
    }
    assert_eq!(video.revision(), before, "失败的操作不改视频");

    // b 的入场与出场转场的窗口不能重叠：b 只有 60 帧。
    apply(&mut video, "cmd_in", vec![dissolve(&s, Some(&a), Some(&b), 60)]).unwrap();
    assert_eq!(
        code(apply(&mut video, "cmd_out", vec![dissolve(&s, Some(&b), Some(&c), 62)])),
        "INVALID_OPERATION"
    );
}

#[test]
fn locked_items_and_tracks_refuse_transitions() {
    let (mut video, _dir, [a, b, _]) = three_texts();
    let s = seq(&video);
    apply(&mut video, "cmd_tr", vec![dissolve(&s, Some(&a), Some(&b), 10)]).unwrap();
    let id = transitions(&video)[0].id.clone();
    apply(
        &mut video,
        "cmd_lock",
        vec![json!({ "type": "updateItem", "itemId": b, "locked": true })],
    )
    .unwrap();
    assert_eq!(
        code(apply(&mut video, "cmd_set", vec![dissolve(&s, Some(&a), Some(&b), 20)])),
        "TARGET_LOCKED"
    );
    assert_eq!(
        code(apply(
            &mut video,
            "cmd_rm",
            vec![json!({ "type": "removeTransition", "transitionId": id })]
        )),
        "TARGET_LOCKED"
    );
    apply(
        &mut video,
        "cmd_unlock",
        vec![json!({ "type": "updateItem", "itemId": b, "locked": false })],
    )
    .unwrap();
    let track = v1(&video);
    apply(
        &mut video,
        "cmd_lock_track",
        vec![json!({ "type": "updateTrack", "trackId": track, "locked": true })],
    )
    .unwrap();
    assert_eq!(
        code(apply(&mut video, "cmd_set2", vec![dissolve(&s, Some(&a), Some(&b), 20)])),
        "TARGET_LOCKED"
    );
}

#[test]
fn moving_trimming_and_deleting_remove_transitions_that_no_longer_hold() {
    let (mut video, _dir, [a, b, c]) = three_texts();
    let s = seq(&video);
    apply(
        &mut video,
        "cmd_tr",
        vec![
            dissolve(&s, Some(&a), Some(&b), 10),
            dissolve(&s, Some(&b), Some(&c), 10),
            dissolve(&s, None, Some(&a), 20),
        ],
    )
    .unwrap();
    let ids: Vec<(Option<String>, Option<String>, String)> = transitions(&video)
        .into_iter()
        .map(|t| (t.left_item_id, t.right_item_id, t.id))
        .collect();
    let find = |l: Option<&str>, r: Option<&str>| {
        ids.iter()
            .find(|(x, y, _)| x.as_deref() == l && y.as_deref() == r)
            .map(|t| t.2.clone())
            .unwrap()
    };
    let (ab, bc, a_in) = (find(Some(&a), Some(&b)), find(Some(&b), Some(&c)), find(None, Some(&a)));

    // 把 c 挪开：b→c 不再相接，被删掉并报告；a→b 不受影响。
    let moved = apply(
        &mut video,
        "cmd_move",
        vec![json!({ "type": "moveItem", "sequenceId": s, "itemId": c, "at": frames(300), "alignment": "exact-frame" })],
    )
    .unwrap();
    let impact = serde_json::to_value(&moved.receipt.impact).unwrap();
    assert_eq!(impact["removedTransitions"], json!([{ "id": bc, "reason": "not-adjacent" }]));
    assert!(moved.receipt.deleted_ids.contains(&bc));
    assert_eq!(transitions(&video).len(), 2);

    // 撤销移动：转场跟着回来。
    undo(&mut video, "cmd_undo_move", &moved).unwrap();
    assert_eq!(transitions(&video).len(), 3);

    // 把 a 的开头裁到 45：a 只剩 15 帧。20 帧的入场转场不删，生效长度随实例变成 ⌊15/2⌋ = 7 帧，回执里列出。
    let trimmed = apply(
        &mut video,
        "cmd_trim",
        vec![json!({ "type": "trimItem", "sequenceId": s, "itemId": a, "edge": "start", "at": frames(45), "alignment": "exact-frame" })],
    )
    .unwrap();
    let impact = serde_json::to_value(&trimmed.receipt.impact).unwrap();
    assert!(impact.get("removedTransitions").is_none());
    assert_eq!(
        impact["shortenedTransitions"],
        json!([{ "id": a_in, "durationFrames": 20, "effectiveFrames": 7 }])
    );
    assert_eq!(transitions(&video).len(), 3);

    // 删掉 b：两侧都依赖它的转场都被删掉。
    let deleted = apply(
        &mut video,
        "cmd_delete",
        vec![json!({ "type": "deleteItems", "sequenceId": s, "itemIds": [b] })],
    )
    .unwrap();
    let impact = serde_json::to_value(&deleted.receipt.impact).unwrap();
    assert_eq!(
        impact["removedTransitions"],
        json!([{ "id": std::cmp::min(&ab, &bc), "reason": "item-deleted" }, { "id": std::cmp::max(&ab, &bc), "reason": "item-deleted" }])
    );
    // 只剩 a 的入场转场（它只依赖 a）。
    let left: Vec<String> = transitions(&video).into_iter().map(|t| t.id).collect();
    assert_eq!(left, vec![a_in]);
}

#[test]
fn splitting_hands_the_out_transition_to_the_right_half() {
    let (mut video, _dir, [a, b, c]) = three_texts();
    let s = seq(&video);
    apply(
        &mut video,
        "cmd_tr",
        vec![dissolve(&s, Some(&a), Some(&b), 10), dissolve(&s, Some(&b), Some(&c), 10)],
    )
    .unwrap();
    let split = apply(
        &mut video,
        "cmd_split",
        vec![json!({ "type": "splitItem", "sequenceId": s, "itemId": b, "at": frames(90), "alignment": "exact-frame" })],
    )
    .unwrap();
    let right = split.receipt.lineage[&b][1].clone();
    let list = transitions(&video);
    assert!(
        list.iter()
            .any(|t| t.left_item_id.as_deref() == Some(a.as_str()) && t.right_item_id.as_deref() == Some(b.as_str()))
    );
    assert!(
        list.iter()
            .any(|t| t.left_item_id.as_deref() == Some(right.as_str()) && t.right_item_id.as_deref() == Some(c.as_str()))
    );
    assert!(
        serde_json::to_value(&split.receipt.impact)
            .unwrap()
            .get("removedTransitions")
            .is_none()
    );

    // 拆分点落在入场转场的窗口里（[55,65)）：左半段装不下，转场被删掉。
    let split = apply(
        &mut video,
        "cmd_split2",
        vec![json!({ "type": "splitItem", "sequenceId": s, "itemId": b, "at": frames(62), "alignment": "exact-frame" })],
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(&split.receipt.impact).unwrap()["removedTransitions"][0]["reason"],
        "too-long"
    );
}

#[test]
fn single_sided_transitions_default_to_half_a_second_and_shorten_with_their_item() {
    let (mut video, _dir, [a, _, c]) = three_texts();
    let s = seq(&video);
    // 单侧转场可以不给长度：取 v2 的缺省 0.5 秒，30 fps 下 15 帧；不量化，回执里没有时间解析。
    let committed = apply(
        &mut video,
        "cmd_in",
        vec![json!({ "type": "setTransition", "sequenceId": s, "rightItemId": a, "kind": "zoom" })],
    )
    .unwrap();
    assert!(committed.receipt.time_resolution.is_empty());
    let tr = transitions(&video)[0].clone();
    assert_eq!((tr.duration_frames, tr.kind.name()), (15, "zoom"));
    apply(&mut video, "cmd_out", vec![dissolve(&s, Some(&c), None, 60)]).unwrap();
    let out = transitions(&video)
        .into_iter()
        .find(|t| t.left_item_id.as_deref() == Some(c.as_str()))
        .unwrap();

    // 把 a 裁到 20 帧：入场转场生效 10 帧，写入的 15 帧不变。
    let trimmed = apply(
        &mut video,
        "cmd_trim",
        vec![json!({ "type": "trimItem", "sequenceId": s, "itemId": a, "edge": "end", "at": frames(20), "alignment": "exact-frame" })],
    )
    .unwrap();
    let impact = serde_json::to_value(&trimmed.receipt.impact).unwrap();
    assert_eq!(
        impact["shortenedTransitions"],
        json!([{ "id": tr.id, "durationFrames": 15, "effectiveFrames": 10 }])
    );
    assert_eq!(transitions(&video).iter().find(|t| t.id == tr.id).unwrap().duration_frames, 15);

    // 与它无关的事务不再重复报告；c 的 60 帧出场转场一直只生效 30 帧，也不报告。
    let unrelated = apply(
        &mut video,
        "cmd_rename",
        vec![json!({ "type": "updateItem", "itemId": c, "name": "结尾" })],
    )
    .unwrap();
    assert!(
        serde_json::to_value(&unrelated.receipt.impact)
            .unwrap()
            .get("shortenedTransitions")
            .is_none()
    );
    assert_eq!(out.duration_frames, 60);

    // 撤销裁切：转场回到完整长度。
    undo(&mut video, "cmd_undo", &trimmed).unwrap();
    let back = video.state().items[&a].value.span().unwrap();
    assert_eq!(back.duration_frames, 60);
}

#[test]
fn undo_that_would_break_a_later_transition_is_a_conflict() {
    let (mut video, _dir, [a, _, c]) = three_texts();
    let s = seq(&video);
    // 先把 c 挪到 a 后面紧接着（b 删掉腾出位置），再在 a→c 之间加转场；撤销挪动会让转场不成立。
    let b = video.state().items.keys().find(|id| **id != a && **id != c).unwrap().clone();
    apply(
        &mut video,
        "cmd_del",
        vec![json!({ "type": "deleteItems", "sequenceId": s, "itemIds": [b] })],
    )
    .unwrap();
    let moved = apply(
        &mut video,
        "cmd_move",
        vec![json!({ "type": "moveItem", "sequenceId": s, "itemId": c, "at": frames(60), "alignment": "exact-frame" })],
    )
    .unwrap();
    apply(&mut video, "cmd_tr", vec![dissolve(&s, Some(&a), Some(&c), 10)]).unwrap();
    let err = undo(&mut video, "cmd_undo", &moved).expect_err("撤销冲突");
    assert_eq!(err.code, "UNDO_CONFLICT");
    assert_eq!(err.entity_ids, vec![transitions(&video)[0].id.clone()]);
}

#[test]
fn transitions_survive_reopening() {
    let (mut video, dir, [a, b, _]) = three_texts();
    let s = seq(&video);
    let op = json!({ "type": "setTransition", "sequenceId": s, "leftItemId": a, "rightItemId": b, "kind": "dip-to-color",
                     "params": { "color": "#FFFFFF" }, "duration": frames(12), "alignment": "exact-frame", "placement": "start-at-cut" });
    apply(&mut video, "cmd_tr", vec![op]).unwrap();
    let before = video.snapshot();
    drop(video);
    let reopened = Video::open(&dir.path().join("m"), video_engine::OpenMode::ReadOnly, &ffprobe()).unwrap();
    assert_eq!(reopened.snapshot().sequences, before.sequences);
    let tr = &reopened.snapshot().sequences[&s].transitions[0];
    assert_eq!(serde_json::to_value(tr).unwrap()["params"], json!({ "color": "#FFFFFF" }));
}

/// 2 秒 30 fps 的视频：60 帧，没有声音。
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
fn handles_must_cover_the_window() {
    let Some((_media, path)) = clip() else { return };
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(&dir.path().join("m"));
    let s = seq(&video);
    let add = json!({ "type": "addItem", "sequenceId": s, "asset": { "ref": "clip" }, "alignment": "nearest-frame" });
    let committed = apply(
        &mut video,
        "cmd_add",
        vec![json!({ "type": "importAsset", "path": path, "ref": "clip" }), add.clone(), add],
    )
    .unwrap();
    let mut ids: Vec<String> = committed
        .receipt
        .created_ids
        .iter()
        .filter(|id| video.state().items.contains_key(*id))
        .cloned()
        .collect();
    ids.sort_by_key(|id| video.state().items[id].value.span().unwrap().from_frame);
    let (a, b) = (ids[0].clone(), ids[1].clone());

    // 两段都用满了素材：居中的转场要 a 结尾之后 5 帧，没有。
    let err = apply(&mut video, "cmd_center", vec![dissolve(&s, Some(&a), Some(&b), 10)]).expect_err("handles 不够");
    assert_eq!(err.code, "TRANSITION_HANDLES_INSUFFICIENT");
    assert_eq!(err.details["itemId"], json!(a));
    assert_eq!(
        (err.details["edge"].as_str(), err.details["neededFrames"].as_i64()),
        (Some("tail"), Some(5))
    );
    assert_eq!(err.details["availableFrames"], 0);

    // 单边转场在实例之内，不需要 handles。
    apply(&mut video, "cmd_one_sided", vec![dissolve(&s, None, Some(&a), 10)]).unwrap();

    // 把 a 的结尾裁到 50、b 挪到 50：a 留出 10 帧尾巴。从切点开始的 10 帧转场正好够，11 帧不够。
    apply(
        &mut video,
        "cmd_make_room",
        vec![
            json!({ "type": "trimItem", "sequenceId": s, "itemId": a, "edge": "end", "at": frames(50), "alignment": "exact-frame" }),
            json!({ "type": "moveItem", "sequenceId": s, "itemId": b, "at": frames(50), "alignment": "exact-frame" }),
        ],
    )
    .unwrap();
    let start_at_cut = |n: i64| {
        let mut op = dissolve(&s, Some(&a), Some(&b), n);
        op["placement"] = json!("start-at-cut");
        op
    };
    apply(&mut video, "cmd_ok", vec![start_at_cut(10)]).unwrap();
    let err = apply(&mut video, "cmd_long", vec![start_at_cut(11)]).expect_err("差一帧");
    assert_eq!(
        (err.code.as_str(), err.details["availableFrames"].as_i64()),
        ("TRANSITION_HANDLES_INSUFFICIENT", Some(10))
    );

    // 再把 a 的结尾拉回 55：尾巴只剩 5 帧，10 帧的转场不再成立，被删掉并报告。
    let committed = apply(
        &mut video,
        "cmd_trim_back",
        vec![
            json!({ "type": "moveItem", "sequenceId": s, "itemId": b, "at": frames(55), "alignment": "exact-frame" }),
            json!({ "type": "trimItem", "sequenceId": s, "itemId": a, "edge": "end", "at": frames(55), "alignment": "exact-frame" }),
        ],
    )
    .unwrap();
    let impact = serde_json::to_value(&committed.receipt.impact).unwrap();
    assert_eq!(impact["removedTransitions"][0]["reason"], "handles-insufficient");
}
