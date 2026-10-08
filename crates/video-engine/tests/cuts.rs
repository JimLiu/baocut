//! 口播剪口（视频格式规范 §6.6、§6.7、§3.16）：`addCuts` 改剪口集合并按新的保留区间重排实例，`follow-cuts` 的实例
//! 跟着移动、缩短或删掉；`restoreCut` 是新的事务，在接缝处放回。数值取 §6.6 的复算例：12 秒、30 fps，删去源 [4, 6)。

#![allow(clippy::result_large_err)]

use std::path::{Path, PathBuf};
use std::process::Command;

use editor_semantics::{Rate, TimeMap};
use serde_json::{Value, json};
use video_engine::model::{Actor, ActorKind, FollowPolicy, TimelineItem};
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
        name: "测试视频".into(),
        fps: Rate { num: 30, den: 1 },
        width: 1920,
        height: 1080,
    };
    Video::create(dir, &options, &ffprobe()).expect("新建视频")
}

fn apply(video: &mut Video, command_id: &str, operations: Vec<Value>) -> Result<Committed, ErrorBody> {
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

fn undo(video: &mut Video, command_id: &str, committed: &Committed) {
    video
        .undo(&UndoRequest {
            command_id: command_id.into(),
            target: UndoTarget::Transaction(committed.receipt.transaction_id.clone()),
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
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

/// 12 秒 30 fps 的视频，没有声音（音频实例照样可以引用它：引擎只核对素材种类）。
fn clip() -> Option<(tempfile::TempDir, PathBuf)> {
    let dir = tempfile::tempdir().ok()?;
    let path = dir.path().join("talk.mp4");
    let ok = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=160x90:rate=30:duration=12",
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

/// 序列上的帧区间 `[from, to)`。
fn frames_of(video: &Video, id: &str) -> (i64, i64) {
    let s = &video.state().root_sequence_id;
    let (a, b) = video.state().item_range(&video.state().items[id].value, s).unwrap();
    let f = |r: editor_semantics::Ratio| r.checked_mul(editor_semantics::Ratio::new(30, 1).unwrap()).unwrap();
    let (a, b) = (f(a), f(b));
    assert!(a.is_integer() && b.is_integer(), "{id} 不在帧网格上");
    (a.floor() as i64, b.floor() as i64)
}

fn source_in(video: &Video, id: &str) -> f64 {
    let map = match &video.state().items[id].value {
        TimelineItem::Video(v) => &v.time_map,
        TimelineItem::Audio(a) => &a.time_map,
        _ => panic!("{id} 没有源时钟"),
    };
    let TimeMap::Linear { source_in, .. } = map else {
        panic!("应是线性映射")
    };
    source_in.to_ratio("sourceIn").unwrap().to_f64()
}

/// 序列上播放素材的实例，按起点、轨道排。
fn asset_items(video: &Video, asset: &str) -> Vec<(String, String, (i64, i64))> {
    let mut out: Vec<(String, String, (i64, i64))> = video
        .state()
        .items
        .values()
        .filter(|p| p.value.asset_refs().any(|r| r.id == asset))
        .map(|p| {
            let id = p.value.base().id.clone();
            let range = frames_of(video, &id);
            (p.value.base().track_id.clone(), id, range)
        })
        .collect();
    out.sort_by(|a, b| a.2.cmp(&b.2).then(a.0.cmp(&b.0)));
    out
}

fn cut_set(video: &Video, asset: &str) -> Option<(String, String, Value)> {
    let doc = video
        .state()
        .documents
        .values()
        .find(|d| d.kind == "cut-set" && d.source_asset_id.as_deref() == Some(asset))?;
    let content = video.document(&doc.id, None).unwrap();
    Some((doc.id.clone(), doc.current_revision.clone(), content.body))
}

struct Setup {
    video: Video,
    asset: String,
    picture: String,
    sound: String,
    /// 片头，`sequence-fixed`：[0, 30)。
    title: String,
    /// 跨过剪口：[90, 210)。
    spanning: String,
    /// 整个落在剪口里：[130, 170)。
    inside: String,
    /// 起点落在剪口里：[150, 240)。
    pushed: String,
    /// 源 [8.2, 9.0)：[246, 270)。
    after: String,
    _media: tempfile::TempDir,
    _dir: tempfile::TempDir,
}

fn shape(track: &str, from: i64, to: i64, follow: &str) -> Value {
    json!({ "type": "shape", "trackId": track, "span": { "fromFrame": from, "durationFrames": to - from },
            "shape": { "shape": "rect", "fill": "#FFD646" }, "followPolicy": { "kind": follow } })
}

fn setup() -> Option<Setup> {
    let (media, path) = clip()?;
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(&dir.path().join("m"));
    let s = video.state().root_sequence_id.clone();
    let imported = apply(
        &mut video,
        "cmd_add",
        vec![
            json!({ "type": "importAsset", "path": path, "ref": "talk" }),
            json!({ "type": "addItem", "sequenceId": s, "asset": { "ref": "talk" }, "alignment": "nearest-frame" }),
            json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "ref": "g1" }),
            json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "ref": "g2" }),
            json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "ref": "g3" }),
        ],
    )
    .unwrap();
    let asset = imported.receipt.refs["talk"].clone();
    let (g1, g2, g3) = (
        imported.receipt.refs["g1"].clone(),
        imported.receipt.refs["g2"].clone(),
        imported.receipt.refs["g3"].clone(),
    );
    let audio = json!({
        "type": "audio", "trackId": track(&video, "A1"), "assetRef": { "id": asset, "revision": "1" },
        "fromFrame": 0, "subframeOffset": { "ticks": "0", "timescale": 1 }, "playDuration": { "ticks": "12", "timescale": 1 },
        "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
        "mix": { "volume": 1.0 },
    });
    let items = vec![
        audio,
        shape(&g1, 0, 30, "sequence-fixed"),
        shape(&g1, 90, 210, "follow-cuts"),
        shape(&g1, 246, 270, "follow-cuts"),
        shape(&g2, 130, 170, "follow-cuts"),
        shape(&g3, 150, 240, "follow-cuts"),
    ];
    let inserted = apply(
        &mut video,
        "cmd_items",
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": items })],
    )
    .unwrap();
    let at = |track: &str, from: i64| {
        inserted
            .receipt
            .created_ids
            .iter()
            .find(|id| video.state().items[*id].value.base().track_id == track && frames_of(&video, id).0 == from)
            .unwrap()
            .clone()
    };
    let picture = video
        .state()
        .items
        .values()
        .find(|p| matches!(p.value, TimelineItem::Video(_)))
        .unwrap()
        .value
        .base()
        .id
        .clone();
    let sound = at(&track(&video, "A1"), 0);
    Some(Setup {
        title: at(&g1, 0),
        spanning: at(&g1, 90),
        after: at(&g1, 246),
        inside: at(&g2, 130),
        pushed: at(&g3, 150),
        picture,
        sound,
        asset,
        video,
        _media: media,
        _dir: dir,
    })
}

fn add_cuts(video: &mut Video, command_id: &str, asset: &str, cuts: Value) -> Result<Committed, ErrorBody> {
    let s = video.state().root_sequence_id.clone();
    apply(
        video,
        command_id,
        vec![json!({ "type": "addCuts", "sequenceId": s, "assetId": asset, "cuts": cuts })],
    )
}

fn restore(video: &mut Video, command_id: &str, asset: &str, cut_id: &str) -> Result<Committed, ErrorBody> {
    let s = video.state().root_sequence_id.clone();
    apply(
        video,
        command_id,
        vec![json!({ "type": "restoreCut", "sequenceId": s, "assetId": asset, "cutId": cut_id })],
    )
}

#[test]
fn cutting_relays_the_scope_and_moves_followers() {
    let Some(mut t) = setup() else { return };
    let committed = add_cuts(
        &mut t.video,
        "cmd_cut",
        &t.asset,
        json!([{ "from": "4", "to": "6", "ref": "pause-4-6" }]),
    )
    .unwrap();
    let impact = &committed.receipt.impact;
    assert_eq!((impact.old_duration_frames, impact.new_duration_frames), (360, 300));
    assert_eq!(impact.removed_by_cuts, vec![t.inside.clone()]);
    assert!(committed.receipt.deleted_ids.contains(&t.inside));

    // 剪口集合的实例：音画都在 4 秒处拆开，右段从源 6 秒开始。
    let items = asset_items(&t.video, &t.asset);
    let ranges: Vec<(i64, i64)> = items.iter().map(|i| i.2).collect();
    assert_eq!(ranges, vec![(0, 120), (0, 120), (120, 300), (120, 300)]);
    assert_eq!(frames_of(&t.video, &t.picture), (0, 120));
    assert_eq!(frames_of(&t.video, &t.sound), (0, 120));
    for (_, id, range) in &items {
        if range.0 == 120 {
            assert_eq!(source_in(&t.video, id), 6.0);
        }
    }

    // follow-cuts：源 [8.2, 9.0) 落到 [6.2, 7.0) = 帧 [186, 210)；跨过的只缩短；起点落进去的推到剪口终点再前移。
    assert_eq!(frames_of(&t.video, &t.after), (186, 210));
    assert_eq!(frames_of(&t.video, &t.spanning), (90, 150));
    assert_eq!(frames_of(&t.video, &t.pushed), (120, 180));
    // sequence-fixed 不动。
    assert_eq!(frames_of(&t.video, &t.title), (0, 30));

    let (_, revision, body) = cut_set(&t.video, &t.asset).unwrap();
    assert_eq!(revision, "1");
    assert_eq!(body["schema"], "baocut.cut-set/1");
    assert_eq!(body["clock"], "source-asset");
    assert_eq!(body["timescale"], 1);
    assert_eq!(body["cuts"].as_array().unwrap().len(), 1);
    assert_eq!(
        (&body["cuts"][0]["t0"], &body["cuts"][0]["t1"], &body["cuts"][0]["ref"]),
        (&json!("4"), &json!("6"), &json!("pause-4-6"))
    );
    let scope: Vec<String> = serde_json::from_value(body["scopeItemIds"].clone()).unwrap();
    assert_eq!(scope.len(), 4);
    assert!(scope.iter().all(|id| t.video.state().items.contains_key(id)));

    // 新建的、按时刻放置的实例缺省 follow-cuts（有没有剪口集合都一样）。
    let s = t.video.state().root_sequence_id.clone();
    let g2 = t
        .video
        .state()
        .items
        .values()
        .find(|p| p.value.base().id == t.title)
        .unwrap()
        .value
        .base()
        .track_id
        .clone();
    let added = apply(
        &mut t.video,
        "cmd_new",
        vec![
            json!({ "type": "insertItems", "sequenceId": s, "items": [{ "type": "shape", "trackId": g2,
            "span": { "fromFrame": 270, "durationFrames": 10 }, "shape": { "shape": "rect", "fill": "#FFFFFF" } }] }),
        ],
    )
    .unwrap();
    let new_id = &added.receipt.created_ids[0];
    assert_eq!(t.video.state().items[new_id].value.base().follow_policy, FollowPolicy::FollowCuts);
}

#[test]
fn items_default_to_following_cuts_before_any_cut_exists() {
    let Some(mut t) = setup() else { return };
    let s = t.video.state().root_sequence_id.clone();
    let g2 = t.video.state().items[&t.inside].value.base().track_id.clone();
    // 还没有剪口集合：不写 followPolicy 的实例缺省 follow-cuts；显式改成 sequence-fixed 的不跟。
    let added = apply(
        &mut t.video,
        "cmd_new",
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": [
            { "type": "shape", "trackId": g2, "span": { "fromFrame": 246, "durationFrames": 24 }, "shape": { "shape": "rect", "fill": "#FFFFFF" } },
            { "type": "shape", "trackId": g2, "span": { "fromFrame": 300, "durationFrames": 30 }, "shape": { "shape": "rect", "fill": "#FFFFFF" } },
        ] })],
    )
    .unwrap();
    assert!(cut_set(&t.video, &t.asset).is_none());
    let starting = |from: i64| {
        added
            .receipt
            .created_ids
            .iter()
            .find(|id| frames_of(&t.video, id).0 == from)
            .unwrap()
            .clone()
    };
    let (follower, fixed) = (starting(246), starting(300));
    assert_eq!(
        t.video.state().items[&follower].value.base().follow_policy,
        FollowPolicy::FollowCuts
    );
    apply(
        &mut t.video,
        "cmd_fix",
        vec![json!({ "type": "updateItem", "sequenceId": s, "itemId": fixed, "followPolicy": { "kind": "sequence-fixed" } })],
    )
    .unwrap();
    assert_eq!(
        t.video.state().items[&fixed].value.base().follow_policy,
        FollowPolicy::SequenceFixed
    );

    add_cuts(&mut t.video, "cmd_cut", &t.asset, json!([{ "from": "4", "to": "6" }])).unwrap();
    assert_eq!(frames_of(&t.video, &follower), (186, 210));
    assert_eq!(frames_of(&t.video, &fixed), (300, 330));

    // 跟随策略的写法照常核对。
    let err = apply(
        &mut t.video,
        "cmd_bad",
        vec![json!({ "type": "updateItem", "sequenceId": s, "itemId": fixed, "followPolicy": { "kind": "speech-anchor" } })],
    )
    .unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");
}

#[test]
fn restoring_is_a_new_transaction_that_puts_the_range_back() {
    let Some(mut t) = setup() else { return };
    let cut = add_cuts(&mut t.video, "cmd_cut", &t.asset, json!([{ "from": "4", "to": "6" }])).unwrap();
    let (doc, _, body) = cut_set(&t.video, &t.asset).unwrap();
    let cut_id = body["cuts"][0]["id"].as_str().unwrap().to_string();

    let restored = restore(&mut t.video, "cmd_restore", &t.asset, &cut_id).unwrap();
    assert_ne!(restored.receipt.transaction_id, cut.receipt.transaction_id);
    let impact = &restored.receipt.impact;
    assert_eq!((impact.old_duration_frames, impact.new_duration_frames), (300, 360));
    assert!(impact.cuts_not_relaid.is_empty());

    // 两段接回原来的一段（留下靠前那件的 ID）。
    let ranges: Vec<(String, (i64, i64))> = asset_items(&t.video, &t.asset).into_iter().map(|i| (i.1, i.2)).collect();
    assert_eq!(ranges.len(), 2);
    assert!(ranges.contains(&(t.picture.clone(), (0, 360))));
    assert!(ranges.contains(&(t.sound.clone(), (0, 360))));
    // follow-cuts 按恢复之后的时间线：之后的后移回原处；跨过接缝的延长；起点正在接缝上的后移。
    assert_eq!(frames_of(&t.video, &t.after), (246, 270));
    assert_eq!(frames_of(&t.video, &t.spanning), (90, 210));
    assert_eq!(frames_of(&t.video, &t.pushed), (180, 240));
    // 被剪口删掉的实例不从旧快照里回来。
    assert!(!t.video.state().items.contains_key(&t.inside));

    let (same_doc, revision, body) = cut_set(&t.video, &t.asset).unwrap();
    assert_eq!((same_doc, revision.as_str()), (doc, "2"));
    assert!(body["cuts"].as_array().unwrap().is_empty());
    let scope: Vec<String> = serde_json::from_value(body["scopeItemIds"].clone()).unwrap();
    assert_eq!(scope.len(), 2);

    // 剪口已经恢复过：再恢复一次找不到。
    let err = restore(&mut t.video, "cmd_again", &t.asset, &cut_id).unwrap_err();
    assert_eq!(err.code, "ENTITY_NOT_FOUND");
}

#[test]
fn close_cuts_merge_keeping_the_earlier_id_and_exact_ticks() {
    let Some(mut t) = setup() else { return };
    add_cuts(&mut t.video, "cmd_first", &t.asset, json!([{ "from": "4", "to": "6", "ref": "a" }])).unwrap();
    let first = cut_set(&t.video, &t.asset).unwrap().2["cuts"][0]["id"].clone();
    // 间隔恰好 0.02 秒：在精确时刻上比较，并成一个。
    let merged = add_cuts(
        &mut t.video,
        "cmd_second",
        &t.asset,
        json!([{ "from": "6.02", "to": "7", "ref": "b" }]),
    )
    .unwrap();
    let (_, revision, body) = cut_set(&t.video, &t.asset).unwrap();
    assert_eq!(revision, "2");
    let cuts = body["cuts"].as_array().unwrap();
    assert_eq!(cuts.len(), 1);
    assert_eq!((&cuts[0]["id"], &cuts[0]["ref"]), (&first, &json!("a")));
    assert_eq!(
        (&cuts[0]["t0"], &cuts[0]["t1"], &body["timescale"]),
        (&json!("4"), &json!("7"), &json!(1))
    );
    // 这次只删掉新的源区间 [6, 7)：一秒。
    assert_eq!(merged.receipt.impact.new_duration_frames, 270);

    // timescale 取能精确表示全部剪口的值。
    add_cuts(&mut t.video, "cmd_third", &t.asset, json!([{ "from": "0.5", "to": "1.25" }])).unwrap();
    let body = cut_set(&t.video, &t.asset).unwrap().2;
    assert_eq!(body["timescale"], 4);
    assert_eq!((&body["cuts"][0]["t0"], &body["cuts"][0]["t1"]), (&json!("2"), &json!("5")));
    assert_eq!(
        asset_items(&t.video, &t.asset).iter().map(|i| i.2).collect::<Vec<_>>()[..2],
        [(0, 15), (0, 15)]
    );
}

#[test]
fn cuts_are_rejected_whole_and_change_nothing() {
    let Some(mut t) = setup() else { return };
    let before = t.video.revision();
    for (n, cuts) in [
        json!([{ "from": "6", "to": "4" }]),
        json!([{ "from": "4", "to": "13" }]),
        json!([{ "from": "-1", "to": "1" }]),
        json!([]),
    ]
    .into_iter()
    .enumerate()
    {
        let err = add_cuts(&mut t.video, &format!("cmd_bad_{n}"), &t.asset, cuts).unwrap_err();
        assert!(
            ["INVALID_OPERATION", "INVALID_TIME_VALUE"].contains(&err.code.as_str()),
            "第 {n} 个：{}",
            err.code
        );
    }
    // 要跟着移动的实例锁着：整笔拒绝，不跳过。
    let s = t.video.state().root_sequence_id.clone();
    apply(
        &mut t.video,
        "cmd_lock",
        vec![json!({ "type": "updateItem", "sequenceId": s, "itemId": t.after, "locked": true })],
    )
    .unwrap();
    let locked = t.video.revision();
    let err = add_cuts(&mut t.video, "cmd_locked", &t.asset, json!([{ "from": "4", "to": "6" }])).unwrap_err();
    assert_eq!(err.code, "TARGET_LOCKED");
    assert_eq!(t.video.revision(), locked);
    assert_ne!(before, locked);
    assert!(cut_set(&t.video, &t.asset).is_none());
    assert_eq!(frames_of(&t.video, &t.picture), (0, 360));

    let err = restore(&mut t.video, "cmd_no_set", &t.asset, "cut_missing").unwrap_err();
    assert_eq!(err.code, "ENTITY_NOT_FOUND");

    // putDocument 写剪口集合时同样核对：重叠的剪口拒绝。
    let body = json!({ "schema": "baocut.cut-set/1", "timescale": 1, "clock": "source-asset", "scopeItemIds": [],
                       "cuts": [{ "id": "a", "t0": "1", "t1": "3" }, { "id": "b", "t0": "2", "t1": "4" }] });
    let err = apply(
        &mut t.video,
        "cmd_put",
        vec![json!({ "type": "putDocument", "kind": "cut-set", "sourceAsset": { "assetId": t.asset }, "body": body })],
    )
    .unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");
}

#[test]
fn misaligned_sound_and_picture_are_rejected() {
    let Some(mut t) = setup() else { return };
    // 声音比画面晚半秒：同一个剪口在两条轨道上映射成部分重叠的区间。
    let s = t.video.state().root_sequence_id.clone();
    apply(
        &mut t.video,
        "cmd_trim",
        vec![json!({ "type": "trimItem", "sequenceId": s, "itemId": t.sound, "edge": "end", "at": { "unit": "frames", "value": 300 }, "alignment": "exact-frame" })],
    )
    .unwrap();
    apply(
        &mut t.video,
        "cmd_move",
        vec![json!({ "type": "moveItem", "sequenceId": s, "itemId": t.sound, "at": { "unit": "frames", "value": 15 }, "alignment": "exact-frame" })],
    )
    .unwrap();
    let err = add_cuts(&mut t.video, "cmd_cut", &t.asset, json!([{ "from": "4", "to": "6" }])).unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");
    assert_eq!(err.details["rule"], "scope-misaligned");
}

#[test]
fn undo_reverts_the_layout_and_the_next_revision_is_fresh() {
    let Some(mut t) = setup() else { return };
    add_cuts(&mut t.video, "cmd_first", &t.asset, json!([{ "from": "4", "to": "6" }])).unwrap();
    let second = add_cuts(&mut t.video, "cmd_second", &t.asset, json!([{ "from": "8", "to": "9" }])).unwrap();
    assert_eq!(second.receipt.impact.new_duration_frames, 270);
    undo(&mut t.video, "cmd_undo", &second);
    let (_, revision, body) = cut_set(&t.video, &t.asset).unwrap();
    assert_eq!(revision, "1");
    assert_eq!(body["cuts"].as_array().unwrap().len(), 1);
    assert_eq!(
        asset_items(&t.video, &t.asset).iter().map(|i| i.2).collect::<Vec<_>>(),
        vec![(0, 120), (0, 120), (120, 300), (120, 300)]
    );
    assert_eq!(frames_of(&t.video, &t.after), (186, 210));
    // 撤销掉的版本号不复用。
    add_cuts(&mut t.video, "cmd_third", &t.asset, json!([{ "from": "10", "to": "11" }])).unwrap();
    assert_eq!(cut_set(&t.video, &t.asset).unwrap().1, "3");
}

#[test]
fn restoring_at_an_item_edge_extends_it_to_the_cut_boundary() {
    let Some(mut t) = setup() else { return };
    add_cuts(
        &mut t.video,
        "cmd_cut",
        &t.asset,
        json!([{ "from": "0", "to": "2" }, { "from": "10", "to": "12" }]),
    )
    .unwrap();
    let cuts = cut_set(&t.video, &t.asset).unwrap().2["cuts"].clone();
    assert_eq!(
        asset_items(&t.video, &t.asset).iter().map(|i| i.2).collect::<Vec<_>>(),
        vec![(0, 240), (0, 240)]
    );
    assert_eq!(source_in(&t.video, &t.picture), 2.0);
    // 剪口在实例开头：放回时实例往前延长到剪口起点，之后的内容后移。
    restore(&mut t.video, "cmd_head", &t.asset, cuts[0]["id"].as_str().unwrap()).unwrap();
    assert_eq!(frames_of(&t.video, &t.picture), (0, 300));
    assert_eq!(source_in(&t.video, &t.picture), 0.0);
    // 剪口在实例末尾：往后延长到剪口终点。
    restore(&mut t.video, "cmd_tail", &t.asset, cuts[1]["id"].as_str().unwrap()).unwrap();
    assert_eq!(frames_of(&t.video, &t.picture), (0, 360));
    assert_eq!(frames_of(&t.video, &t.sound), (0, 360));
}

#[test]
fn a_cut_without_a_seam_is_restored_in_the_set_only() {
    let Some(mut t) = setup() else { return };
    add_cuts(&mut t.video, "cmd_cut", &t.asset, json!([{ "from": "4", "to": "6" }])).unwrap();
    let cut_id = cut_set(&t.video, &t.asset).unwrap().2["cuts"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let ids: Vec<String> = asset_items(&t.video, &t.asset).into_iter().map(|i| i.1).collect();
    let s = t.video.state().root_sequence_id.clone();
    apply(
        &mut t.video,
        "cmd_delete",
        vec![json!({ "type": "deleteItems", "sequenceId": s, "itemIds": ids })],
    )
    .unwrap();
    let after = frames_of(&t.video, &t.after);
    let restored = restore(&mut t.video, "cmd_restore", &t.asset, &cut_id).unwrap();
    assert_eq!(restored.receipt.impact.cuts_not_relaid, vec![cut_id]);
    assert_eq!(frames_of(&t.video, &t.after), after);
    assert!(cut_set(&t.video, &t.asset).unwrap().2["cuts"].as_array().unwrap().is_empty());
}

// ---- 章节（§3.13 的例外、§6.7）：应用与恢复剪口时跟着内容走 ----

fn set_chapters(video: &mut Video, starts: &[(&str, i64)]) {
    let s = video.state().root_sequence_id.clone();
    let chapters: Vec<Value> = starts
        .iter()
        .map(|(title, frame)| json!({ "at": { "unit": "frames", "value": frame }, "title": title }))
        .collect();
    apply(
        video,
        "cmd_chapters",
        vec![json!({ "type": "setChapters", "sequenceId": s, "alignment": "exact-frame", "chapters": chapters })],
    )
    .unwrap();
}

/// 章节的标题与开始帧，按帧排。
fn chapters(video: &Video) -> Vec<(String, i64)> {
    let mut out: Vec<(String, i64)> = video
        .state()
        .markers
        .values()
        .filter(|m| m.value.is_chapter())
        .map(|m| (m.value.label.clone(), m.value.frame))
        .collect();
    out.sort_by_key(|c| c.1);
    out
}

fn owned(chapters: &[(&str, i64)]) -> Vec<(String, i64)> {
    chapters.iter().map(|(title, frame)| (title.to_string(), *frame)).collect()
}

fn cut_ids(video: &Video, asset: &str) -> Vec<String> {
    cut_set(video, asset).unwrap().2["cuts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn chapters_follow_cuts_and_restores() {
    let Some(mut t) = setup() else { return };
    let start = [("开场", 0), ("一", 120), ("二", 150), ("三", 200), ("四", 250), ("五", 300)];
    set_chapters(&mut t.video, &start);
    // 源 [4, 6) 与 [8, 9) 落在帧 [120, 180) 与 [240, 270)：段后的章前移；「一」「二」都落到段首，留起点最晚的「二」，
    // 整章都剪掉的「一」删掉；段里的「四」回到段首。
    let cut = add_cuts(
        &mut t.video,
        "cmd_cut",
        &t.asset,
        json!([{ "from": "4", "to": "6" }, { "from": "8", "to": "9" }]),
    )
    .unwrap();
    let after_cut = owned(&[("开场", 0), ("二", 120), ("三", 140), ("四", 180), ("五", 210)]);
    assert_eq!(chapters(&t.video), after_cut);
    // 一步撤销：章节与实例一起回去。
    undo(&mut t.video, "cmd_undo", &cut);
    assert_eq!(chapters(&t.video), owned(&start));

    add_cuts(
        &mut t.video,
        "cmd_recut",
        &t.asset,
        json!([{ "from": "4", "to": "6" }, { "from": "8", "to": "9" }]),
    )
    .unwrap();
    assert_eq!(chapters(&t.video), after_cut);
    let ids = cut_ids(&t.video, &t.asset);
    // 恢复：接缝之后的章后移；正在接缝上的不动（原来在段里的「四」「二」回不到段里）。
    restore(&mut t.video, "cmd_restore_late", &t.asset, &ids[1]).unwrap();
    assert_eq!(
        chapters(&t.video),
        owned(&[("开场", 0), ("二", 120), ("三", 140), ("四", 180), ("五", 240)])
    );
    restore(&mut t.video, "cmd_restore_early", &t.asset, &ids[0]).unwrap();
    assert_eq!(
        chapters(&t.video),
        owned(&[("开场", 0), ("二", 120), ("三", 200), ("四", 240), ("五", 300)])
    );
}

#[test]
fn a_restored_opening_keeps_the_first_chapter_at_the_start() {
    let Some(mut t) = setup() else { return };
    set_chapters(&mut t.video, &[("片头", 0), ("开场", 30), ("正文", 90)]);
    add_cuts(&mut t.video, "cmd_cut", &t.asset, json!([{ "from": "0", "to": "2" }])).unwrap();
    assert_eq!(chapters(&t.video), owned(&[("开场", 0), ("正文", 30)]));
    let ids = cut_ids(&t.video, &t.asset);
    restore(&mut t.video, "cmd_restore", &t.asset, &ids[0]).unwrap();
    assert_eq!(chapters(&t.video), owned(&[("开场", 0), ("正文", 90)]));
}

#[test]
fn retiming_a_cut_moves_chapters_by_the_difference() {
    let Some(mut t) = setup() else { return };
    set_chapters(&mut t.video, &[("开场", 0), ("正文", 240)]);
    add_cuts(&mut t.video, "cmd_cut", &t.asset, json!([{ "from": "4", "to": "6" }])).unwrap();
    assert_eq!(chapters(&t.video), owned(&[("开场", 0), ("正文", 180)]));
    // 文稿里拖短剪口：一笔事务里先恢复、再剪新的范围，章只差剪短的那 30 帧。
    let id = cut_ids(&t.video, &t.asset).remove(0);
    let s = t.video.state().root_sequence_id.clone();
    apply(
        &mut t.video,
        "cmd_retime",
        vec![
            json!({ "type": "restoreCut", "sequenceId": s, "assetId": t.asset, "cutId": id }),
            json!({ "type": "addCuts", "sequenceId": s, "assetId": t.asset, "cuts": [{ "from": "4", "to": "5" }] }),
        ],
    )
    .unwrap();
    assert_eq!(chapters(&t.video), owned(&[("开场", 0), ("正文", 210)]));
}

// ---- 语义锚（§3.16 的 speech-anchor）：按与按文稿闪避相同的词投影求值，剪口之后重新摆放 ----

/// 素材的转写：毫秒刻度。w2 在剪口 [4, 6) 里，w3、w4 在剪口之后，句子 s1 是 w3–w4。返回文档与一条新的画面轨道。
fn speech(t: &mut Setup) -> (String, String) {
    let body = json!({
        "schema": "baocut.speech/1", "clock": "source-asset", "timescale": 1000, "engine": null, "speakers": [],
        "words": [
            { "id": "w1", "start": 1000, "end": 1500, "text": "one" },
            { "id": "w2", "start": 4500, "end": 5000, "text": "gone" },
            { "id": "w3", "start": 7000, "end": 7600, "text": "after" },
            { "id": "w4", "start": 8000, "end": 8400, "text": "end" },
        ],
        "sentences": [{ "id": "s1", "first": "w3", "last": "w4" }],
        "chapters": [],
    });
    let s = t.video.state().root_sequence_id.clone();
    let committed = apply(
        &mut t.video,
        "cmd_speech",
        vec![
            json!({ "type": "putDocument", "kind": "speech", "sourceAsset": { "assetId": t.asset }, "body": body }),
            json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "ref": "g4" }),
        ],
    )
    .unwrap();
    let doc = t.video.state().documents.values().find(|d| d.kind == "speech").unwrap().id.clone();
    (doc, committed.receipt.refs["g4"].clone())
}

fn word(doc: &str, word: &str, edge: &str) -> Value {
    json!({ "kind": "word", "speechRef": { "id": doc, "revision": "1" }, "wordId": word, "edge": edge })
}

fn anchored(t: &mut Setup, command_id: &str, track: &str, span: (i64, i64), policy: Value) -> Result<Committed, ErrorBody> {
    let s = t.video.state().root_sequence_id.clone();
    let item = json!({ "type": "shape", "trackId": track, "span": { "fromFrame": span.0, "durationFrames": span.1 - span.0 },
                       "shape": { "shape": "rect", "fill": "#FFFFFF" }, "followPolicy": policy });
    apply(
        &mut t.video,
        command_id,
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": [item] })],
    )
}

#[test]
fn speech_anchors_follow_the_words_through_cuts_and_restores() {
    let Some(mut t) = setup() else { return };
    let (doc, g4) = speech(&mut t);
    // 写入时就按锚点摆放：w3 是源 [7.0, 7.6) = 帧 [210, 228)；给的区间不算数。
    let created = anchored(
        &mut t,
        "cmd_anchor",
        &g4,
        (0, 10),
        json!({ "kind": "speech-anchor", "start": word(&doc, "w3", "start"), "end": word(&doc, "w3", "end") }),
    )
    .unwrap();
    let text = created.receipt.created_ids[0].clone();
    assert_eq!(frames_of(&t.video, &text), (210, 228));
    assert!(created.receipt.impact.orphaned_anchors.is_empty());

    // 剪掉源 [4, 6)：词前移 2 秒。
    let cut = add_cuts(&mut t.video, "cmd_cut", &t.asset, json!([{ "from": "4", "to": "6" }])).unwrap();
    assert_eq!(frames_of(&t.video, &text), (150, 168));
    assert!(cut.receipt.impact.orphaned_anchors.is_empty());
    assert!(t.video.orphaned_anchors().unwrap().is_empty());

    // 恢复：回到原处。
    let (_, _, body) = cut_set(&t.video, &t.asset).unwrap();
    let cut_id = body["cuts"][0]["id"].as_str().unwrap().to_string();
    let restored = restore(&mut t.video, "cmd_restore", &t.asset, &cut_id).unwrap();
    assert_eq!(frames_of(&t.video, &text), (210, 228));

    // 撤销恢复与剪口：位置跟着时间线回去。
    undo(&mut t.video, "cmd_undo_restore", &restored);
    assert_eq!(frames_of(&t.video, &text), (150, 168));
    undo(&mut t.video, "cmd_undo_cut", &cut);
    assert_eq!(frames_of(&t.video, &text), (210, 228));
}

#[test]
fn a_cut_away_word_orphans_the_item_in_place() {
    let Some(mut t) = setup() else { return };
    let (doc, g4) = speech(&mut t);
    // w2 是源 [4.5, 5.0) = 帧 [135, 150)。
    let created = anchored(
        &mut t,
        "cmd_anchor",
        &g4,
        (0, 10),
        json!({ "kind": "speech-anchor", "start": word(&doc, "w2", "start"), "end": word(&doc, "w2", "end") }),
    )
    .unwrap();
    let gone = created.receipt.created_ids[0].clone();
    assert_eq!(frames_of(&t.video, &gone), (135, 150));

    let cut = add_cuts(&mut t.video, "cmd_cut", &t.asset, json!([{ "from": "4", "to": "6" }])).unwrap();
    // 留在原来的位置，列为 orphaned：回执与现算的状态。
    assert_eq!(frames_of(&t.video, &gone), (135, 150));
    assert_eq!(cut.receipt.impact.orphaned_anchors, vec![gone.clone()]);
    let orphaned = t.video.orphaned_anchors().unwrap();
    assert_eq!(orphaned.len(), 1);
    assert_eq!(
        (orphaned[0].item_id.as_str(), orphaned[0].reason.as_str()),
        (gone.as_str(), "word-anchor-cut")
    );
    // 之后无关的编辑照常提交，实例仍列为 orphaned。
    let s = t.video.state().root_sequence_id.clone();
    let later = apply(
        &mut t.video,
        "cmd_rename",
        vec![json!({ "type": "updateItem", "sequenceId": s, "itemId": t.title, "name": "片头" })],
    )
    .unwrap();
    assert_eq!(later.receipt.impact.orphaned_anchors, vec![gone.clone()]);
    assert_eq!(frames_of(&t.video, &gone), (135, 150));
}

#[test]
fn a_word_played_twice_needs_an_occurrence() {
    let Some(mut t) = setup() else { return };
    let (doc, g4) = speech(&mut t);
    let policy = json!({ "kind": "speech-anchor", "start": word(&doc, "w3", "start"), "end": word(&doc, "w3", "end") });
    // 先写下的锚点：之后时间线上出现第二处，只列为 orphaned，不拒绝那笔编辑。
    let first = anchored(&mut t, "cmd_first", &g4, (0, 10), policy.clone())
        .unwrap()
        .receipt
        .created_ids[0]
        .clone();
    let s = t.video.state().root_sequence_id.clone();
    let v1 = track(&t.video, "V1");
    let again = apply(
        &mut t.video,
        "cmd_again",
        vec![
            json!({ "type": "addItem", "sequenceId": s, "asset": { "assetId": t.asset }, "trackId": v1,
                     "alignment": "nearest-frame" }),
        ],
    )
    .unwrap();
    let second = again.receipt.created_ids[0].clone();
    assert_eq!(frames_of(&t.video, &second), (360, 720));
    assert_eq!(again.receipt.impact.orphaned_anchors, vec![first.clone()]);
    assert_eq!(frames_of(&t.video, &first), (210, 228));

    // 这笔事务里写下的锚点有歧义：整笔拒绝。
    let err = anchored(&mut t, "cmd_ambiguous", &g4, (300, 310), policy).unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");
    assert_eq!(err.details["rule"], "word-anchor-ambiguous");

    // occurrenceId 指明第二处：摆到 360 + 210。
    let mut start = word(&doc, "w3", "start");
    start["occurrenceId"] = json!(second);
    let mut end = word(&doc, "w3", "end");
    end["occurrenceId"] = json!(second);
    let chosen = anchored(
        &mut t,
        "cmd_chosen",
        &g4,
        (300, 310),
        json!({ "kind": "speech-anchor", "start": start, "end": end }),
    )
    .unwrap();
    assert_eq!(frames_of(&t.video, &chosen.receipt.created_ids[0]), (570, 588));
}

#[test]
fn one_sided_sentence_offset_and_blocked_anchors() {
    let Some(mut t) = setup() else { return };
    let (doc, g4) = speech(&mut t);
    // 只有终点：起点不动，终点是 w3 的结尾（帧 228）。
    let end_only = anchored(
        &mut t,
        "cmd_end",
        &g4,
        (200, 220),
        json!({ "kind": "speech-anchor", "end": word(&doc, "w3", "end") }),
    )
    .unwrap()
    .receipt
    .created_ids[0]
        .clone();
    assert_eq!(frames_of(&t.video, &end_only), (200, 228));

    // 句子锚点与带偏移的词锚点（-0.5 秒）。
    let sentence = json!({ "kind": "sentence", "speechRef": { "id": doc, "revision": "1" }, "sentenceId": "s1", "edge": "end" });
    let mut early = word(&doc, "w1", "start");
    early["offset"] = json!({ "ticks": "-1", "timescale": 2 });
    let s = t.video.state().root_sequence_id.clone();
    let g5 = apply(
        &mut t.video,
        "cmd_track",
        vec![json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "ref": "g5" })],
    )
    .unwrap()
    .receipt
    .refs["g5"]
        .clone();
    let by_sentence = anchored(
        &mut t,
        "cmd_sentence",
        &g5,
        (0, 10),
        json!({ "kind": "speech-anchor", "start": early, "end": sentence }),
    )
    .unwrap()
    .receipt
    .created_ids[0]
        .clone();
    // w1 起点 1.0 − 0.5 = 0.5 秒（帧 15）；s1 的终点是 w4 的结尾 8.4 秒（帧 252）。
    assert_eq!(frames_of(&t.video, &by_sentence), (15, 252));

    // 只有起点：保持长度。
    let start_only = anchored(
        &mut t,
        "cmd_start",
        &g5,
        (300, 312),
        json!({ "kind": "speech-anchor", "start": word(&doc, "w4", "end") }),
    )
    .unwrap()
    .receipt
    .created_ids[0]
        .clone();
    assert_eq!(frames_of(&t.video, &start_only), (252, 264));

    // 摆不下：w4 是帧 [240, 252)，同一轨道上有 [245, 300) 的实例。
    let blocker = apply(
        &mut t.video,
        "cmd_blocker",
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": [shape(&g4, 245, 300, "sequence-fixed")] })],
    )
    .unwrap()
    .receipt
    .created_ids[0]
        .clone();
    let blocked = anchored(
        &mut t,
        "cmd_blocked",
        &g4,
        (320, 330),
        json!({ "kind": "speech-anchor", "start": word(&doc, "w4", "start"), "end": word(&doc, "w4", "end") }),
    )
    .unwrap();
    let id = blocked.receipt.created_ids[0].clone();
    assert_eq!(frames_of(&t.video, &id), (320, 330));
    assert_eq!(blocked.receipt.impact.orphaned_anchors, vec![id.clone()]);
    let reasons: Vec<(String, String)> = t
        .video
        .orphaned_anchors()
        .unwrap()
        .into_iter()
        .map(|o| (o.item_id, o.reason))
        .collect();
    assert_eq!(reasons, vec![(id.clone(), "anchor-blocked".to_string())]);
    // 挡住的实例删掉之后，下一笔事务把它摆回锚点上。
    apply(
        &mut t.video,
        "cmd_unblock",
        vec![json!({ "type": "deleteItems", "sequenceId": s, "itemIds": [blocker] })],
    )
    .unwrap();
    assert_eq!(frames_of(&t.video, &id), (240, 252));
    assert!(t.video.orphaned_anchors().unwrap().is_empty());
}

// ---- item-local（§3.16）：跟着目标实例移动；拆开时跟锚点所在的一段，起点修剪越过锚点时到新起点，目标删掉时一起删 ----

fn follows(video: &Video, id: &str) -> String {
    match &video.state().items[id].value.base().follow_policy {
        FollowPolicy::ItemLocal { item_id } => item_id.clone(),
        other => panic!("{id} 不是 item-local：{other:?}"),
    }
}

fn new_tracks(t: &mut Setup, names: &[&str]) -> Vec<String> {
    let s = t.video.state().root_sequence_id.clone();
    let ops = names
        .iter()
        .map(|n| json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "ref": n }))
        .collect();
    let committed = apply(&mut t.video, "cmd_tracks", ops).unwrap();
    names.iter().map(|n| committed.receipt.refs[*n].clone()).collect()
}

fn follower(t: &mut Setup, command_id: &str, track: &str, span: (i64, i64), target: &str) -> String {
    let s = t.video.state().root_sequence_id.clone();
    let item = json!({ "type": "shape", "trackId": track, "span": { "fromFrame": span.0, "durationFrames": span.1 - span.0 },
                       "shape": { "shape": "rect", "fill": "#FFFFFF" }, "followPolicy": { "kind": "item-local", "itemId": target } });
    apply(
        &mut t.video,
        command_id,
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": [item] })],
    )
    .unwrap()
    .receipt
    .created_ids[0]
        .clone()
}

#[test]
fn item_local_follows_splits_trims_moves_and_deletion_of_a_clip() {
    let Some(mut t) = setup() else { return };
    let g = new_tracks(&mut t, &["f1"]);
    // 锚点是源 5 秒（帧 150）。
    let picture = t.picture.clone();
    let f = follower(&mut t, "cmd_follower", &g[0], (150, 180), &picture);
    let s = t.video.state().root_sequence_id.clone();

    // 在帧 120 拆开：跟着锚点所在的右半，位置不变。
    let split = apply(
        &mut t.video,
        "cmd_split",
        vec![json!({ "type": "splitItem", "alignment": "nearest-frame", "sequenceId": s, "itemId": t.picture, "at": { "unit": "frames", "value": 120 } })],
    )
    .unwrap();
    let right = split.receipt.lineage[&t.picture]
        .iter()
        .find(|id| **id != t.picture)
        .unwrap()
        .clone();
    assert_eq!(frames_of(&t.video, &f), (150, 180));
    assert_eq!(follows(&t.video, &f), right);

    // 右半的起点修剪到帧 160，越过锚点：移到新起点。
    apply(
        &mut t.video,
        "cmd_trim",
        vec![json!({ "type": "trimItem", "alignment": "nearest-frame", "sequenceId": s, "itemId": right, "edge": "start", "at": { "unit": "frames", "value": 160 } })],
    )
    .unwrap();
    assert_eq!(frames_of(&t.video, &f), (160, 190));

    // 目标整体移动：跟着移动。
    apply(
        &mut t.video,
        "cmd_move",
        vec![json!({ "type": "moveItems", "alignment": "nearest-frame", "sequenceId": s, "moves": [{ "itemId": right, "offset": { "unit": "frames", "value": 30 } }] })],
    )
    .unwrap();
    assert_eq!(frames_of(&t.video, &right).0, 190);
    assert_eq!(frames_of(&t.video, &f), (190, 220));

    // 目标删掉：一起删掉并列在回执里。
    let deleted = apply(
        &mut t.video,
        "cmd_delete",
        vec![json!({ "type": "deleteItems", "sequenceId": s, "itemIds": [right] })],
    )
    .unwrap();
    assert_eq!(deleted.receipt.impact.removed_with_target, vec![f.clone()]);
    assert!(deleted.receipt.deleted_ids.contains(&f));
    assert!(!t.video.state().items.contains_key(&f));
    // 撤销：两件都回来。
    undo(&mut t.video, "cmd_undo_delete", &deleted);
    assert_eq!(frames_of(&t.video, &f), (190, 220));
}

#[test]
fn item_local_follows_its_clip_through_cuts_and_joins() {
    let Some(mut t) = setup() else { return };
    let g = new_tracks(&mut t, &["f1", "f2"]);
    // 源 6.5 秒（帧 195）在剪口之后；源 5 秒（帧 150）在剪口里。
    let picture = t.picture.clone();
    let after = follower(&mut t, "cmd_after", &g[0], (195, 205), &picture);
    let inside = follower(&mut t, "cmd_inside", &g[1], (150, 160), &picture);

    add_cuts(&mut t.video, "cmd_cut", &t.asset, json!([{ "from": "4", "to": "6" }])).unwrap();
    let right = asset_items(&t.video, &t.asset)
        .into_iter()
        .find(|(track_id, _, range)| *track_id == track(&t.video, "V1") && range.0 == 120)
        .unwrap()
        .1;
    // 源 6.5 秒在右段上是帧 135；剪掉的源 5 秒移到右段的起点。
    assert_eq!(frames_of(&t.video, &after), (135, 145));
    assert_eq!(follows(&t.video, &after), right);
    assert_eq!(frames_of(&t.video, &inside), (120, 130));
    assert_eq!(follows(&t.video, &inside), right);

    // 拆开再合并：跟着留下的那件，位置不变。
    let s = t.video.state().root_sequence_id.clone();
    let split = apply(
        &mut t.video,
        "cmd_split",
        vec![json!({ "type": "splitItem", "alignment": "nearest-frame", "sequenceId": s, "itemId": right, "at": { "unit": "frames", "value": 130 } })],
    )
    .unwrap();
    let tail = split.receipt.lineage[&right].iter().find(|id| **id != right).unwrap().clone();
    assert_eq!(follows(&t.video, &after), tail);
    apply(
        &mut t.video,
        "cmd_join",
        vec![json!({ "type": "joinItems", "sequenceId": s, "itemIds": [right, tail] })],
    )
    .unwrap();
    assert_eq!(follows(&t.video, &after), right);
    assert_eq!(frames_of(&t.video, &after), (135, 145));
}

#[test]
fn item_local_follows_a_static_item() {
    let Some(mut t) = setup() else { return };
    let g = new_tracks(&mut t, &["host", "f1", "f2"]);
    let s = t.video.state().root_sequence_id.clone();
    let host = apply(
        &mut t.video,
        "cmd_host",
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": [shape(&g[0], 30, 90, "sequence-fixed")] })],
    )
    .unwrap()
    .receipt
    .created_ids[0]
        .clone();
    let f = follower(&mut t, "cmd_f", &g[1], (60, 70), &host);
    // 跟随者在目标起点之前：保持到目标起点的距离。
    let before = follower(&mut t, "cmd_before", &g[2], (20, 25), &host);

    let split = apply(
        &mut t.video,
        "cmd_split",
        vec![json!({ "type": "splitItem", "alignment": "nearest-frame", "sequenceId": s, "itemId": host, "at": { "unit": "frames", "value": 50 } })],
    )
    .unwrap();
    let right = split.receipt.lineage[&host].iter().find(|id| **id != host).unwrap().clone();
    assert_eq!(follows(&t.video, &f), right);
    assert_eq!(follows(&t.video, &before), host);
    assert_eq!(frames_of(&t.video, &f), (60, 70));

    // 只改起点、没越过锚点：不动；越过：到新起点。
    let trim = |video: &mut Video, id: &str, at: i64, n: &str| {
        apply(
            video,
            n,
            vec![json!({ "type": "trimItem", "alignment": "nearest-frame", "sequenceId": s, "itemId": id, "edge": "start", "at": { "unit": "frames", "value": at } })],
        )
        .unwrap();
    };
    trim(&mut t.video, &right, 55, "cmd_trim_a");
    assert_eq!(frames_of(&t.video, &f), (60, 70));
    trim(&mut t.video, &right, 65, "cmd_trim_b");
    assert_eq!(frames_of(&t.video, &f), (65, 75));

    // 整体移动左半：在它起点之前的跟随者跟着移动。
    apply(
        &mut t.video,
        "cmd_move",
        vec![json!({ "type": "moveItems", "alignment": "nearest-frame", "sequenceId": s, "moves": [{ "itemId": host, "offset": { "unit": "frames", "value": -10 } }] })],
    )
    .unwrap();
    assert_eq!(frames_of(&t.video, &before), (10, 15));

    // 指向别的序列或不存在的目标：写入时拒绝。
    let s2 = t.video.state().root_sequence_id.clone();
    let err = apply(
        &mut t.video,
        "cmd_bad",
        vec![
            json!({ "type": "insertItems", "sequenceId": s2, "items": [{ "type": "shape", "trackId": g[2],
            "span": { "fromFrame": 200, "durationFrames": 5 }, "shape": { "shape": "rect", "fill": "#FFFFFF" },
            "followPolicy": { "kind": "item-local", "itemId": "item_missing" } }] }),
        ],
    )
    .unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");
}

// ---- 剪辑提案（§6.2）：proposeCuts 检测口癖与停顿写成提案，acceptCutSuggestions 编译成带 ref 的剪口 ----

/// 带口癖的转写：w2「um」是口癖 [1.4, 1.7)；w4 以句号结尾，与 w5 之间停顿 1.6 秒，压缩到 0.4 秒剪掉 [2.6, 3.8)。
fn filler_speech(t: &mut Setup) -> String {
    let body = json!({
        "schema": "baocut.speech/1", "clock": "source-asset", "timescale": 1000, "engine": null, "speakers": [],
        "words": [
            { "id": "w1", "start": 1000, "end": 1300, "text": "so" },
            { "id": "w2", "start": 1400, "end": 1700, "text": "um" },
            { "id": "w3", "start": 1800, "end": 2000, "text": "we" },
            { "id": "w4", "start": 2000, "end": 2400, "text": "start." },
            { "id": "w5", "start": 4000, "end": 4400, "text": "next" },
        ],
        "sentences": null, "chapters": [],
    });
    apply(
        &mut t.video,
        "cmd_speech",
        vec![json!({ "type": "putDocument", "kind": "speech", "sourceAsset": { "assetId": t.asset }, "body": body })],
    )
    .unwrap();
    t.video.state().documents.values().find(|d| d.kind == "speech").unwrap().id.clone()
}

fn proposal(video: &Video) -> (String, Value) {
    let doc = video.state().documents.values().find(|d| d.kind == "editorial-proposal").unwrap();
    (doc.id.clone(), video.document(&doc.id, None).unwrap().body)
}

fn statuses(body: &Value) -> Vec<(String, String)> {
    body["suggestions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| (s["id"].as_str().unwrap().to_string(), s["status"].as_str().unwrap().to_string()))
        .collect()
}

fn accept(video: &mut Video, command_id: &str, proposal: &str, ids: &[&str]) -> Result<Committed, ErrorBody> {
    let s = video.state().root_sequence_id.clone();
    apply(
        video,
        command_id,
        vec![json!({ "type": "acceptCutSuggestions", "sequenceId": s, "proposalId": proposal, "suggestionIds": ids })],
    )
}

#[test]
fn proposed_fillers_and_pauses_are_accepted_as_cuts_with_their_ids() {
    let Some(mut t) = setup() else { return };
    let speech = filler_speech(&mut t);
    let proposed = apply(
        &mut t.video,
        "cmd_propose",
        vec![json!({ "type": "proposeCuts", "assetId": t.asset })],
    )
    .unwrap();
    let (id, body) = proposal(&t.video);
    assert!(proposed.receipt.created_ids.contains(&id));
    assert_eq!(body["schema"], "baocut.editorial-proposal/1");
    assert_eq!(body["timescale"], 1000);
    assert_eq!(body["speechRef"], json!({ "id": speech, "revision": "1" }));
    let s = &body["suggestions"];
    assert_eq!(
        (
            s[0]["id"].as_str(),
            s[0]["kind"].as_str(),
            s[0]["t0"].as_str(),
            s[0]["t1"].as_str(),
            s[0]["text"].as_str()
        ),
        (Some("cut-fl-w2"), Some("filler"), Some("1400"), Some("1700"), Some("um"))
    );
    assert_eq!(s[0]["wordIds"], json!(["w2"]));
    assert_eq!(
        (
            s[1]["id"].as_str(),
            s[1]["kind"].as_str(),
            s[1]["t0"].as_str(),
            s[1]["t1"].as_str(),
            s[1]["afterWordId"].as_str()
        ),
        (Some("cut-sl-w4"), Some("pause"), Some("2600"), Some("3800"), Some("w4"))
    );
    assert_eq!(s.as_array().unwrap().len(), 2);
    // 提出建议不改时间线。
    assert!(cut_set(&t.video, &t.asset).is_none());

    // 接受停顿：剪口的 ref 是建议的 ID，区间是建议的区间；提案里标成 accepted。
    let accepted = accept(&mut t.video, "cmd_accept", &id, &["cut-sl-w4"]).unwrap();
    let (_, _, cuts) = cut_set(&t.video, &t.asset).unwrap();
    assert_eq!(cuts["cuts"].as_array().unwrap().len(), 1);
    let cut = &cuts["cuts"][0];
    assert_eq!(cut["ref"], "cut-sl-w4");
    let scale = cuts["timescale"].as_i64().unwrap() as f64;
    let at = |v: &Value| v.as_str().unwrap().parse::<f64>().unwrap() / scale;
    assert_eq!((at(&cut["t0"]), at(&cut["t1"])), (2.6, 3.8));
    assert_eq!(
        statuses(&proposal(&t.video).1),
        vec![("cut-fl-w2".into(), "pending".into()), ("cut-sl-w4".into(), "accepted".into())]
    );

    // 撤销：剪口与提案的状态一起回去。
    undo(&mut t.video, "cmd_undo_accept", &accepted);
    assert!(cut_set(&t.video, &t.asset).is_none_or(|(_, _, b)| b["cuts"].as_array().unwrap().is_empty()));
    assert_eq!(
        statuses(&proposal(&t.video).1),
        vec![("cut-fl-w2".into(), "pending".into()), ("cut-sl-w4".into(), "pending".into())]
    );

    // 再接受，然后重新提出：已经剪掉的停顿不再提出，提案还是同一份文档。
    accept(&mut t.video, "cmd_accept_again", &id, &["cut-sl-w4"]).unwrap();
    let again = apply(
        &mut t.video,
        "cmd_propose_again",
        vec![json!({ "type": "proposeCuts", "assetId": t.asset })],
    )
    .unwrap();
    assert!(again.receipt.updated_ids.contains(&id));
    assert_eq!(statuses(&proposal(&t.video).1), vec![("cut-fl-w2".into(), "pending".into())]);
}

#[test]
fn stale_unknown_and_malformed_proposals_are_rejected() {
    let Some(mut t) = setup() else { return };
    let speech = filler_speech(&mut t);
    apply(
        &mut t.video,
        "cmd_propose",
        vec![json!({ "type": "proposeCuts", "assetId": t.asset })],
    )
    .unwrap();
    let (id, body) = proposal(&t.video);

    // 不认识的建议：整笔拒绝。
    let err = accept(&mut t.video, "cmd_unknown", &id, &["cut-fl-nope"]).unwrap_err();
    assert_eq!(err.code, "ENTITY_NOT_FOUND");

    // 检测参数按旧版的规则核对。
    let err = apply(
        &mut t.video,
        "cmd_bad_detect",
        vec![json!({ "type": "proposeCuts", "assetId": t.asset, "detect": { "minPause": "0.5", "compressTo": "0.6" } })],
    )
    .unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");

    // 只检测口癖：没有停顿建议。
    apply(
        &mut t.video,
        "cmd_fillers_only",
        vec![json!({ "type": "proposeCuts", "assetId": t.asset, "detect": { "pauses": false } })],
    )
    .unwrap();
    assert_eq!(statuses(&proposal(&t.video).1), vec![("cut-fl-w2".into(), "pending".into())]);

    // 正文不合 §6.2 的提案写不进去。
    let mut bad = body.clone();
    bad["suggestions"][0]["t1"] = json!("1000");
    let err = apply(
        &mut t.video,
        "cmd_bad_body",
        vec![json!({ "type": "putDocument", "documentId": id, "kind": "editorial-proposal", "body": bad })],
    )
    .unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");

    // 转写改过之后，建议过期：拒绝接受，须重新提出。
    let mut changed = t.video.document(&speech, None).unwrap().body;
    changed["words"][0]["text"] = json!("so,");
    apply(
        &mut t.video,
        "cmd_edit_speech",
        vec![json!({ "type": "putDocument", "documentId": speech, "kind": "speech", "body": changed })],
    )
    .unwrap();
    let err = accept(&mut t.video, "cmd_stale", &id, &["cut-fl-w2"]).unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");
    assert_eq!(err.details["rule"], "proposal-stale");
    apply(
        &mut t.video,
        "cmd_repropose",
        vec![json!({ "type": "proposeCuts", "assetId": t.asset })],
    )
    .unwrap();
    accept(&mut t.video, "cmd_fresh", &id, &["cut-fl-w2"]).unwrap();
    let (_, _, cuts) = cut_set(&t.video, &t.asset).unwrap();
    assert_eq!(cuts["cuts"][0]["ref"], "cut-fl-w2");
}
