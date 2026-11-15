//! 联动组成组的时间编辑（视频格式规范 §3.18）。夹具是一次暂停过一次的录制：第一段屏幕、摄像头（晚 1 秒开始）、
//! 麦克风，第二段屏幕与麦克风；五个实例登记成一个组。每个测试都核对不变量：组里各成员在同一序列时刻对着同一录制时刻
//! （`start + s` 相等，用精确有理数比较）。

#![allow(clippy::result_large_err)]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use editor_semantics::{Rate, Ratio, TimeMap};
use serde_json::{Value, json};
use video_engine::model::{Actor, ActorKind, TimelineItem};
use video_engine::{Committed, CreateOptions, ErrorBody, OpenMode, UndoRequest, UndoTarget, Video, VideoTransaction};

const FPS: Rate = Rate { num: 30, den: 1 };

fn ffprobe() -> PathBuf {
    PathBuf::from(std::env::var("BAOCUT_FFPROBE").unwrap_or_else(|_| "ffprobe".into()))
}

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

fn history(video: &mut Video, command_id: &str, target: UndoTarget) -> Committed {
    video
        .undo(&UndoRequest {
            command_id: command_id.into(),
            target,
            expected_revision: None,
            actor: user(),
        })
        .unwrap()
}

fn r(num: i128, den: i128) -> Ratio {
    Ratio::new(num, den).unwrap()
}

fn frames(n: i64) -> Value {
    json!({ "unit": "frames", "value": n })
}

fn seconds(s: &str) -> Value {
    json!({ "unit": "seconds", "value": s })
}

/// 用 ffmpeg 生成各路流的素材：内容各不相同，免得导入时复用成同一个素材。
fn media(dir: &Path) -> Option<[PathBuf; 5]> {
    let make = |name: &str, args: &[&str]| -> Option<PathBuf> {
        let path = dir.join(name);
        let ok = Command::new("ffmpeg")
            .args(["-v", "error", "-y"])
            .args(args)
            .arg(&path)
            .output()
            .is_ok_and(|o| o.status.success());
        ok.then_some(path)
    };
    let video = |size: &str, seconds: &str| format!("testsrc=size={size}:rate=30:duration={seconds}");
    let tone = |hz: &str, seconds: &str| format!("sine=frequency={hz}:duration={seconds}");
    let paths = [
        make("screen0.mp4", &["-f", "lavfi", "-i", &video("160x90", "6"), "-c:v", "mpeg4"]),
        make("cam0.mp4", &["-f", "lavfi", "-i", &video("64x48", "5"), "-c:v", "mpeg4"]),
        make("mic0.wav", &["-f", "lavfi", "-i", &tone("440", "6.5"), "-ar", "48000"]),
        make("screen1.mp4", &["-f", "lavfi", "-i", &video("128x72", "4"), "-c:v", "mpeg4"]),
        make("mic1.wav", &["-f", "lavfi", "-i", &tone("660", "4.5"), "-ar", "48000"]),
    ];
    if paths.iter().any(Option::is_none) {
        eprintln!("跳过：没有可用的 ffmpeg 生成测试素材");
        return None;
    }
    Some(paths.map(Option::unwrap))
}

struct Rec {
    video: Video,
    seq: String,
    v1: String,
    v2: String,
    a1: String,
    screen0: String,
    cam0: String,
    mic0: String,
    screen1: String,
    mic1: String,
    group: String,
    view: String,
    /// 素材 → 它那路流在录制时间上的 `start`（秒）。
    starts: HashMap<String, Ratio>,
    assets: [String; 5],
    dir: tempfile::TempDir,
    _media: tempfile::TempDir,
}

fn track(video: &Video, name: &str) -> String {
    video.state().tracks.values().find(|t| t.value.name.as_deref() == Some(name)).unwrap().value.id.clone()
}

fn audio_item(track: &str, asset: &str, from_frame: i64, seconds: i64) -> Value {
    json!({
        "type": "audio", "trackId": track, "assetRef": { "id": asset, "revision": "1" },
        "fromFrame": from_frame, "subframeOffset": { "ticks": "0", "timescale": 1 },
        "playDuration": { "ticks": seconds.to_string(), "timescale": 1 },
        "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
        "mix": { "volume": 1.0 },
    })
}

fn created_item(video: &Video, committed: &Committed) -> String {
    committed.receipt.created_ids.iter().find(|id| video.state().items.contains_key(*id)).unwrap().clone()
}

/// 把一次录制的五路放上时间线（屏幕 0 秒起，摄像头 1 秒起，第二段 6 秒起），写清单与屏幕取景，登记成组。
fn place(video: &mut Video, tag: &str, base: i64, assets: &[String; 5], tracks: (&str, &str, &str), manifest: &str, view: &str) -> [String; 5] {
    let seq = video.state().root_sequence_id.clone();
    let (v1, v2, a1) = tracks;
    let add = |video: &mut Video, n: &str, asset: &str, track: &str, at: i64| {
        let committed = apply(
            video,
            &format!("cmd_{tag}_{n}"),
            vec![json!({ "type": "addItem", "sequenceId": seq, "asset": { "assetId": asset }, "trackId": track, "at": frames(at), "alignment": "exact-frame" })],
        )
        .unwrap();
        created_item(video, &committed)
    };
    let screen0 = add(video, "screen0", &assets[0], v1, base);
    let cam0 = add(video, "cam0", &assets[1], v2, base + 30);
    let screen1 = add(video, "screen1", &assets[3], v1, base + 180);
    let inserted = apply(
        video,
        &format!("cmd_{tag}_mics"),
        vec![json!({ "type": "insertItems", "sequenceId": seq, "items": [audio_item(a1, &assets[2], base, 6), audio_item(a1, &assets[4], base + 180, 4)] })],
    )
    .unwrap();
    let mut mics: Vec<String> = inserted.receipt.created_ids.iter().filter(|id| video.state().items.contains_key(*id)).cloned().collect();
    mics.sort_by_key(|id| match &video.state().items[id].value {
        TimelineItem::Audio(a) => a.from_frame,
        _ => unreachable!(),
    });
    let (mic0, mic1) = (mics[0].clone(), mics[1].clone());
    let ids = [screen0, cam0, mic0, screen1, mic1];
    apply(
        video,
        &format!("cmd_{tag}_link"),
        vec![
            json!({ "type": "setStyle", "itemId": ids[0], "screenView": { "documentId": view } }),
            json!({ "type": "setStyle", "itemId": ids[3], "screenView": { "documentId": view } }),
            json!({ "type": "linkItems", "sequenceId": seq, "itemIds": ids, "kind": "recording", "recording": { "documentId": manifest } }),
        ],
    )
    .unwrap();
    ids
}

fn rec() -> Option<Rec> {
    let media_dir = tempfile::tempdir().unwrap();
    let paths = media(media_dir.path())?;
    let dir = tempfile::tempdir().unwrap();
    let options = CreateOptions {
        name: "录制".into(),
        fps: FPS,
        width: 1920,
        height: 1080,
    };
    let mut video = Video::create(&dir.path().join("m"), &options, &ffprobe()).unwrap();
    let seq = video.state().root_sequence_id.clone();
    let mut ops: Vec<Value> = paths
        .iter()
        .enumerate()
        .map(|(n, p)| json!({ "type": "importAsset", "path": p, "ref": format!("a{n}") }))
        .collect();
    ops.push(json!({ "type": "addTrack", "sequenceId": seq, "kind": "visual", "name": "V2" }));
    let imported = apply(&mut video, "cmd_import", ops).unwrap();
    let assets: [String; 5] = std::array::from_fn(|n| imported.receipt.refs[&format!("a{n}")].clone());
    let (v1, v2, a1) = (track(&video, "V1"), track(&video, "V2"), track(&video, "A1"));
    let asset_ref = |n: usize| json!({ "id": assets[n], "revision": "1" });
    let stream = |id: &str, role: &str, segment: &str, n: usize, start: &str| {
        json!({ "id": id, "role": role, "segmentId": segment, "assetRef": asset_ref(n), "start": start })
    };
    let documents = apply(
        &mut video,
        "cmd_documents",
        vec![
            json!({ "type": "putDocument", "kind": "recording", "ref": "rec", "body": {
                "schema": "baocut.recording/1", "timescale": 1000, "clock": "recording", "recorder": { "name": "test" },
                "duration": "10000", "segments": [{ "id": "s0", "t0": "0", "t1": "6000" }, { "id": "s1", "t0": "6000", "t1": "10000" }],
                "streams": [
                    stream("s0-screen", "screen", "s0", 0, "0"),
                    stream("s0-camera", "camera", "s0", 1, "1000"),
                    stream("s0-mic", "microphone", "s0", 2, "0"),
                    stream("s1-screen", "screen", "s1", 3, "6000"),
                    stream("s1-mic", "microphone", "s1", 4, "6000"),
                ],
                "pointer": { "mode": "none" } } }),
            json!({ "type": "putDocument", "kind": "screen-view", "ref": "view", "name": "view", "sourceDocument": { "ref": "rec" }, "body": {
                "schema": "baocut.screen-view/1", "timescale": 1000, "clock": "recording", "solver": 1,
                "zooms": [{ "id": "z1", "t0": "500", "t1": "2500", "scale": 2.0, "focus": { "kind": "point", "x": 0.5, "y": 0.5 }, "origin": "manual" }] } }),
        ],
    )
    .unwrap();
    let manifest = documents.receipt.refs["rec"].clone();
    let view = documents.receipt.refs["view"].clone();
    let [screen0, cam0, mic0, screen1, mic1] = place(&mut video, "p1", 0, &assets, (&v1, &v2, &a1), &manifest, &view);
    let group = group_of(&video, &screen0).unwrap();
    let starts = HashMap::from([
        (assets[0].clone(), r(0, 1)),
        (assets[1].clone(), r(1, 1)),
        (assets[2].clone(), r(0, 1)),
        (assets[3].clone(), r(6, 1)),
        (assets[4].clone(), r(6, 1)),
    ]);
    let rec = Rec {
        video,
        seq,
        v1,
        v2,
        a1,
        screen0,
        cam0,
        mic0,
        screen1,
        mic1,
        group,
        view,
        starts,
        assets,
        dir,
        _media: media_dir,
    };
    assert_eq!(in_sync(&rec.video, &rec.starts), 14, "夹具本身成组");
    Some(rec)
}

fn group_of(video: &Video, id: &str) -> Option<String> {
    video.state().items[id].value.base().link_group_id.clone()
}

fn groups(video: &Video) -> Vec<video_engine::model::LinkGroup> {
    let seq = &video.state().root_sequence_id;
    video.state().sequences[seq].header.link_groups.clone()
}

fn range(video: &Video, id: &str) -> (Ratio, Ratio) {
    video_engine::state::item_range(&video.state().items[id].value, FPS).unwrap()
}

fn time_map(video: &Video, id: &str) -> (Ratio, Ratio) {
    let map = match &video.state().items[id].value {
        TimelineItem::Video(v) => &v.time_map,
        TimelineItem::Audio(a) => &a.time_map,
        _ => unreachable!(),
    };
    let TimeMap::Linear { source_in, rate } = map else { unreachable!() };
    (source_in.to_ratio("sourceIn").unwrap(), rate.ratio())
}

fn asset_of(video: &Video, id: &str) -> String {
    video.state().items[id].value.asset_ref().unwrap().id.clone()
}

/// 实例在序列时刻 `t` 的录制时间：它那路流的 `start` 加上 `t` 处的源时间。
fn recording_time(video: &Video, id: &str, t: Ratio, starts: &HashMap<String, Ratio>) -> Ratio {
    let (a, _) = range(video, id);
    let (source_in, rate) = time_map(video, id);
    let s = source_in.checked_add(t.checked_sub(a).unwrap().checked_mul(rate).unwrap()).unwrap();
    starts[&asset_of(video, id)].checked_add(s).unwrap()
}

/// 不变量：每个登记的组里，同一序列时刻上的成员对着同一录制时刻。取样点是各成员的起点与中点。返回比较过的成员对数。
fn in_sync(video: &Video, starts: &HashMap<String, Ratio>) -> usize {
    let mut compared = 0;
    for group in groups(video) {
        let members: Vec<String> = video
            .state()
            .items
            .iter()
            .filter(|(_, p)| p.value.base().link_group_id.as_deref() == Some(group.id.as_str()))
            .map(|(id, _)| id.clone())
            .collect();
        assert!(!members.is_empty(), "组 {} 没有成员", group.id);
        let mut points = Vec::new();
        for id in &members {
            let (a, b) = range(video, id);
            points.push(a);
            points.push(a.checked_add(b).unwrap().checked_div(r(2, 1)).unwrap());
        }
        for t in points {
            let covering: Vec<&String> = members
                .iter()
                .filter(|id| {
                    let (a, b) = range(video, id);
                    a <= t && t < b
                })
                .collect();
            let times: Vec<Ratio> = covering.iter().map(|id| recording_time(video, id, t, starts)).collect();
            for (id, time) in covering.iter().zip(&times).skip(1) {
                assert_eq!(*time, times[0], "组 {} 在 {t:?} 错开：{id} 对着 {time:?}，{} 对着 {:?}", group.id, covering[0], times[0]);
                compared += 1;
            }
        }
    }
    compared
}

fn members_of(video: &Video, group: &str) -> Vec<String> {
    let mut ids: Vec<(Ratio, String)> = video
        .state()
        .items
        .iter()
        .filter(|(_, p)| p.value.base().link_group_id.as_deref() == Some(group))
        .map(|(id, p)| (video_engine::state::item_range(&p.value, FPS).unwrap().0, id.clone()))
        .collect();
    ids.sort();
    ids.into_iter().map(|(_, id)| id).collect()
}

fn set<S: AsRef<str>>(ids: &[S]) -> std::collections::BTreeSet<String> {
    ids.iter().map(|id| id.as_ref().to_string()).collect()
}

fn starts_of(video: &Video, ids: &[&String]) -> Vec<Ratio> {
    ids.iter().map(|id| range(video, id).0).collect()
}

/// 移动：全部成员移动同一段序列时间；指到音频成员时位移取整帧；同一组在一笔 moveItems 里位移要一样。
#[test]
fn moving_one_member_moves_the_whole_group() {
    let Some(mut f) = rec() else { return };
    let all = [&f.screen0, &f.cam0, &f.mic0, &f.screen1, &f.mic1];
    let before = starts_of(&f.video, &all);
    apply(&mut f.video, "cmd_move", vec![json!({ "type": "moveItem", "sequenceId": f.seq, "itemId": f.cam0, "offset": seconds("0.5"), "alignment": "exact-frame" })]).unwrap();
    let after = starts_of(&f.video, &all);
    for (b, a) in before.iter().zip(&after) {
        assert_eq!(a.checked_sub(*b).unwrap(), r(1, 2));
    }
    assert!(in_sync(&f.video, &f.starts) > 0);

    // 指到麦克风、偏移不到整帧：整组按最近的帧移（0.02 秒 = 0.6 帧 → 1 帧），麦克风仍在帧上。
    apply(&mut f.video, "cmd_move_audio", vec![json!({ "type": "moveItem", "sequenceId": f.seq, "itemId": f.mic0, "offset": seconds("0.02"), "alignment": "nearest-frame" })]).unwrap();
    assert_eq!(range(&f.video, &f.screen0).0, r(1, 2).checked_add(r(1, 30)).unwrap());
    assert_eq!(range(&f.video, &f.mic0).0, range(&f.video, &f.screen0).0);
    in_sync(&f.video, &f.starts);

    // 一笔 moveItems 里同一组位移不一样：拒绝；一样：只移一次。
    let mismatch = apply(
        &mut f.video,
        "cmd_move_mismatch",
        vec![json!({ "type": "moveItems", "sequenceId": f.seq, "alignment": "exact-frame", "moves": [
            { "itemId": f.screen0, "offset": frames(3) }, { "itemId": f.mic1, "offset": frames(4) } ] })],
    )
    .expect_err("位移不一样");
    assert_eq!(mismatch.code, "INVALID_OPERATION");
    assert_eq!(mismatch.details["rule"], "link-group");
    let start = range(&f.video, &f.screen0).0;
    apply(
        &mut f.video,
        "cmd_move_same",
        vec![json!({ "type": "moveItems", "sequenceId": f.seq, "alignment": "exact-frame", "moves": [
            { "itemId": f.screen0, "offset": frames(3) }, { "itemId": f.mic1, "offset": frames(3) } ] })],
    )
    .unwrap();
    assert_eq!(range(&f.video, &f.screen0).0, start.checked_add(r(3, 30)).unwrap());
    in_sync(&f.video, &f.starts);

    // 换轨道只换指到的那个成员。
    let committed = apply(&mut f.video, "cmd_track", vec![json!({ "type": "addTrack", "sequenceId": f.seq, "kind": "visual", "ref": "v3" })]).unwrap();
    let v3 = committed.receipt.refs["v3"].clone();
    apply(&mut f.video, "cmd_retrack", vec![json!({ "type": "moveItem", "sequenceId": f.seq, "itemId": f.cam0, "offset": frames(0), "trackId": v3, "alignment": "exact-frame" })]).unwrap();
    assert_eq!(f.video.state().items[&f.cam0].value.base().track_id, v3);
    assert_eq!(f.video.state().items[&f.screen0].value.base().track_id, f.v1);
    in_sync(&f.video, &f.starts);

    // 移到 0 之前：拒绝（摄像头还在，屏幕会落到负的位置）。
    let negative = apply(&mut f.video, "cmd_negative", vec![json!({ "type": "moveItem", "sequenceId": f.seq, "itemId": f.cam0, "at": frames(0), "alignment": "exact-frame" })]);
    assert!(negative.is_err());
}

/// 拆分：同一时刻拆开跨过它的每个成员，右边的登记成新组（同一份清单），右半记 lineage；摄像头还没开始的地方拆，摄像头整段归右边。
#[test]
fn split_puts_the_right_halves_in_a_new_group() {
    let Some(mut f) = rec() else { return };
    apply(&mut f.video, "cmd_split", vec![json!({ "type": "splitItem", "sequenceId": f.seq, "itemId": f.mic0, "at": seconds("3"), "alignment": "exact-frame" })]).unwrap();
    let after = groups(&f.video);
    assert_eq!(after.len(), 2);
    assert!(after.iter().all(|g| g.recording_id == groups(&f.video)[0].recording_id && g.recording_id.is_some()));
    let left = members_of(&f.video, &f.group);
    assert_eq!(set(&left), set(&[&f.screen0, &f.cam0, &f.mic0]));
    let right_group = after.iter().find(|g| g.id != f.group).unwrap().id.clone();
    let right = members_of(&f.video, &right_group);
    assert_eq!(right.len(), 5, "三个右半加第二段的两路");
    assert!(right.contains(&f.screen1) && right.contains(&f.mic1));
    for id in &right[..3] {
        assert_eq!(range(&f.video, id).0, r(3, 1));
        let lineage = f.video.state().items[id].value.base().lineage.clone().expect("右半记 lineage");
        assert!([&f.screen0, &f.cam0, &f.mic0].contains(&&lineage.parent_item_id.unwrap()));
    }
    for id in [&f.screen0, &f.cam0, &f.mic0] {
        assert_eq!(range(&f.video, id).1, r(3, 1));
    }
    assert!(in_sync(&f.video, &f.starts) > 0);

    // 在摄像头开始之前（0.5 秒）拆：摄像头没跨过拆分点，按它所在的一侧归到右边。
    apply(&mut f.video, "cmd_split_early", vec![json!({ "type": "splitItem", "sequenceId": f.seq, "itemId": f.screen0, "at": seconds("0.5"), "alignment": "exact-frame" })]).unwrap();
    assert_eq!(groups(&f.video).len(), 3);
    assert_eq!(set(&members_of(&f.video, &f.group)), set(&[&f.screen0, &f.mic0]));
    assert_ne!(group_of(&f.video, &f.cam0).unwrap(), f.group);
    assert_eq!(range(&f.video, &f.cam0).0, r(1, 1), "摄像头不动");
    in_sync(&f.video, &f.starts);
}

/// 修剪：各成员修剪到同一时刻；没伸到那里的不动；往外拉时和指到的成员对齐的成员一起拉，素材不够的拉到素材的头。
#[test]
fn trim_brings_every_member_to_the_same_time() {
    let Some(mut f) = rec() else { return };
    // 剪掉开头到 2 秒：屏幕、麦克风、摄像头（1 秒起）都到 2 秒；第二段不动。
    apply(&mut f.video, "cmd_trim", vec![json!({ "type": "trimItem", "sequenceId": f.seq, "itemId": f.screen0, "edge": "start", "at": seconds("2"), "alignment": "exact-frame" })]).unwrap();
    for id in [&f.screen0, &f.cam0, &f.mic0] {
        assert_eq!(range(&f.video, id).0, r(2, 1), "{id}");
    }
    assert_eq!(range(&f.video, &f.screen1).0, r(6, 1));
    in_sync(&f.video, &f.starts);
    // 剪掉第二段的结尾（8 秒）：只有第二段的两路。
    apply(&mut f.video, "cmd_trim_end", vec![json!({ "type": "trimItem", "sequenceId": f.seq, "itemId": f.mic1, "edge": "end", "at": seconds("8"), "alignment": "exact-frame" })]).unwrap();
    assert_eq!(range(&f.video, &f.screen1).1, r(8, 1));
    assert_eq!(range(&f.video, &f.mic1).1, r(8, 1));
    assert_eq!(range(&f.video, &f.screen0).1, r(6, 1));
    in_sync(&f.video, &f.starts);
    // 开头拉回 0.5 秒：屏幕与麦克风到 0.5 秒，摄像头只能回到它的第一帧（1 秒）。
    apply(&mut f.video, "cmd_trim_back", vec![json!({ "type": "trimItem", "sequenceId": f.seq, "itemId": f.mic0, "edge": "start", "at": seconds("0.5"), "alignment": "exact-frame" })]).unwrap();
    assert_eq!(range(&f.video, &f.screen0).0, r(1, 2));
    assert_eq!(range(&f.video, &f.mic0).0, r(1, 2));
    assert_eq!(range(&f.video, &f.cam0).0, r(1, 1));
    in_sync(&f.video, &f.starts);
    // 修剪到没有长度：拒绝。
    let collapsed = apply(&mut f.video, "cmd_trim_zero", vec![json!({ "type": "trimItem", "sequenceId": f.seq, "itemId": f.mic1, "edge": "end", "at": seconds("6"), "alignment": "exact-frame" })]);
    assert_eq!(collapsed.expect_err("没有长度").code, "TIME_RANGE_COLLAPSED");
}

/// 删除一段并闭合：只点明麦克风的轨道，整组一起删掉中间那段、后面前移，组在接缝处分成两组；插入一段同样整组。
#[test]
fn removing_a_range_cuts_the_whole_group_and_closes_the_gap() {
    let Some(mut f) = rec() else { return };
    apply(
        &mut f.video,
        "cmd_remove",
        vec![json!({ "type": "removeRange", "sequenceId": f.seq, "from": seconds("2"), "to": seconds("3"), "trackIds": [f.a1], "alignment": "exact-frame" })],
    )
    .unwrap();
    assert_eq!(groups(&f.video).len(), 2);
    for id in [&f.screen0, &f.cam0, &f.mic0] {
        assert_eq!(range(&f.video, id).1, r(2, 1), "{id} 删到区间起点");
    }
    assert_eq!(range(&f.video, &f.screen1).0, r(5, 1), "后面前移一秒");
    assert_eq!(range(&f.video, &f.mic1).0, r(5, 1));
    let right = groups(&f.video).into_iter().find(|g| g.id != f.group).unwrap().id;
    let pieces = members_of(&f.video, &right);
    assert_eq!(pieces.len(), 5);
    for id in &pieces[..3] {
        assert_eq!(range(&f.video, id).0, r(2, 1));
    }
    assert!(in_sync(&f.video, &f.starts) > 0);

    // 插入一段空白（4 秒处，同样只点明麦克风的轨道）：右边的组整组后移，跨过的成员拆开。
    apply(
        &mut f.video,
        "cmd_insert",
        vec![json!({ "type": "insertRange", "sequenceId": f.seq, "at": seconds("4"), "duration": seconds("1"), "trackIds": [f.a1], "alignment": "exact-frame" })],
    )
    .unwrap();
    assert_eq!(groups(&f.video).len(), 3);
    assert_eq!(range(&f.video, &f.screen1).0, r(6, 1));
    assert_eq!(range(&f.video, &f.mic1).0, r(6, 1));
    assert!(in_sync(&f.video, &f.starts) > 0);
}

/// 剪口：加在麦克风素材上的剪口整组一起剪、一起波纹；恢复剪口整组放回，两组并回一组，拆开的片段接回原来的一段。
#[test]
fn cuts_on_one_member_cut_and_restore_the_whole_group() {
    let Some(mut f) = rec() else { return };
    let mic = asset_of(&f.video, &f.mic0);
    let committed = apply(
        &mut f.video,
        "cmd_cut",
        vec![json!({ "type": "addCuts", "sequenceId": f.seq, "assetId": mic, "cuts": [{ "from": "2", "to": "3" }] })],
    )
    .unwrap();
    assert_eq!(groups(&f.video).len(), 2);
    for id in [&f.screen0, &f.cam0, &f.mic0] {
        assert_eq!(range(&f.video, id).1, r(2, 1), "{id}");
    }
    assert_eq!(range(&f.video, &f.screen1).0, r(5, 1));
    assert_eq!(f.video.state().items.len(), 8);
    assert!(in_sync(&f.video, &f.starts) > 0);

    let cut_set = f.video.state().documents.values().find(|d| d.kind == "baocut.cut-set/1" || d.source_asset_id.as_deref() == Some(mic.as_str())).unwrap().id.clone();
    let body = f.video.document(&cut_set, None).unwrap().body;
    let cut_id = body["cuts"][0]["id"].as_str().unwrap().to_string();
    apply(&mut f.video, "cmd_restore", vec![json!({ "type": "restoreCut", "sequenceId": f.seq, "assetId": mic, "cutId": cut_id })]).unwrap();
    assert_eq!(groups(&f.video).len(), 1, "两组并回一组");
    assert_eq!(f.video.state().items.len(), 5, "拆开的片段接回");
    assert_eq!(range(&f.video, &f.screen0), (r(0, 1), r(6, 1)));
    assert_eq!(range(&f.video, &f.cam0), (r(1, 1), r(6, 1)));
    assert_eq!(range(&f.video, &f.mic0), (r(0, 1), r(6, 1)));
    assert_eq!(range(&f.video, &f.screen1).0, r(6, 1));
    assert_eq!(in_sync(&f.video, &f.starts), 14);

    // 撤销恢复、撤销剪口：回到最初。
    history(&mut f.video, "cmd_undo_restore", UndoTarget::Undo);
    assert_eq!(groups(&f.video).len(), 2);
    history(&mut f.video, "cmd_undo_cut", UndoTarget::Transaction(committed.receipt.transaction_id.clone()));
    assert_eq!(groups(&f.video).len(), 1);
    assert_eq!(in_sync(&f.video, &f.starts), 14);
}

/// 变速：各成员用同一个速率，摄像头相对屏幕的位置跟着缩放，仍然对着同一录制时刻。
#[test]
fn speed_applies_one_rate_to_the_whole_group() {
    let Some(mut f) = rec() else { return };
    apply(&mut f.video, "cmd_speed", vec![json!({ "type": "setSpeed", "sequenceId": f.seq, "itemId": f.screen0, "rate": { "num": 2, "den": 1 } })]).unwrap();
    for id in [&f.screen0, &f.cam0, &f.mic0, &f.screen1, &f.mic1] {
        assert_eq!(time_map(&f.video, id).1, r(2, 1), "{id}");
    }
    assert_eq!(range(&f.video, &f.screen0), (r(0, 1), r(3, 1)));
    assert_eq!(range(&f.video, &f.cam0), (r(1, 2), r(3, 1)));
    assert_eq!(range(&f.video, &f.mic0), (r(0, 1), r(3, 1)));
    assert_eq!(range(&f.video, &f.screen1), (r(3, 1), r(5, 1)));
    assert_eq!(range(&f.video, &f.mic1), (r(3, 1), r(5, 1)));
    assert_eq!(in_sync(&f.video, &f.starts), 14);
    history(&mut f.video, "cmd_speed_undo", UndoTarget::Undo);
    assert_eq!(range(&f.video, &f.cam0), (r(1, 1), r(6, 1)));
    assert_eq!(time_map(&f.video, &f.cam0).1, r(1, 1));
    history(&mut f.video, "cmd_speed_redo", UndoTarget::Redo);
    assert_eq!(time_map(&f.video, &f.mic1).1, r(2, 1));
    in_sync(&f.video, &f.starts);
}

/// 删除：删一个成员只删它，组还在；删整组是删全部成员，登记跟着删掉。
#[test]
fn deleting_a_member_keeps_the_group_and_deleting_all_drops_it() {
    let Some(mut f) = rec() else { return };
    apply(&mut f.video, "cmd_delete_cam", vec![json!({ "type": "deleteItems", "sequenceId": f.seq, "itemIds": [f.cam0] })]).unwrap();
    assert_eq!(members_of(&f.video, &f.group).len(), 4);
    assert_eq!(range(&f.video, &f.screen0), (r(0, 1), r(6, 1)), "其余成员不动");
    apply(
        &mut f.video,
        "cmd_delete_all",
        vec![json!({ "type": "deleteItems", "sequenceId": f.seq, "itemIds": [f.screen0, f.mic0, f.screen1, f.mic1] })],
    )
    .unwrap();
    assert!(groups(&f.video).is_empty());
}

/// 复制：整组得到新的实例、新的组（同一份清单），屏幕取景文档复制成新文档；之后两组各改各的。
#[test]
fn duplicating_a_group_copies_members_and_screen_views() {
    let Some(mut f) = rec() else { return };
    let before_docs = f.video.state().documents.len();
    apply(
        &mut f.video,
        "cmd_duplicate",
        vec![json!({ "type": "duplicateLinkGroup", "sequenceId": f.seq, "groupId": f.group, "at": seconds("12"), "alignment": "exact-frame" })],
    )
    .unwrap();
    let all = groups(&f.video);
    assert_eq!(all.len(), 2);
    let copy = all.iter().find(|g| g.id != f.group).unwrap();
    assert_eq!(copy.recording_id, all.iter().find(|g| g.id == f.group).unwrap().recording_id);
    let copies = members_of(&f.video, &copy.id);
    assert_eq!(copies.len(), 5);
    assert_eq!(f.video.state().documents.len(), before_docs + 1, "取景文档复制了一份");
    let views: Vec<String> = copies
        .iter()
        .filter_map(|id| match &f.video.state().items[id].value {
            TimelineItem::Video(v) => v.screen_view.as_ref().map(|s| s.document_id.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(views.len(), 2);
    assert!(views.iter().all(|v| *v == views[0] && *v != f.view), "副本引用同一份新文档");
    assert_eq!(f.video.document(&views[0], None).unwrap().body, f.video.document(&f.view, None).unwrap().body);
    for id in &copies {
        assert!(f.video.state().items[id].value.base().lineage.is_none());
    }
    assert_eq!(range(&f.video, &copies[0]).0, r(12, 1));
    assert_eq!(in_sync(&f.video, &f.starts), 28);

    // 各改各的：拆开原件，副本不动；移动副本，原件不动。
    apply(&mut f.video, "cmd_split_original", vec![json!({ "type": "splitItem", "sequenceId": f.seq, "itemId": f.screen0, "at": seconds("3"), "alignment": "exact-frame" })]).unwrap();
    assert_eq!(members_of(&f.video, &copy.id), copies);
    apply(&mut f.video, "cmd_move_copy", vec![json!({ "type": "moveItem", "sequenceId": f.seq, "itemId": copies[0], "offset": seconds("1"), "alignment": "exact-frame" })]).unwrap();
    assert_eq!(range(&f.video, &f.screen0).0, r(0, 1));
    assert_eq!(range(&f.video, &copies[0]).0, r(13, 1));
    in_sync(&f.video, &f.starts);
}

/// 单独改一个成员的时间：拒绝；解组之后各自编辑。
#[test]
fn a_member_cannot_change_time_alone() {
    let Some(mut f) = rec() else { return };
    let refused = apply(
        &mut f.video,
        "cmd_remap",
        vec![json!({ "type": "replaceItemAsset", "sequenceId": f.seq, "itemId": f.cam0,
            "assetRef": { "id": f.assets[1], "revision": "1" },
            "timeMap": { "kind": "linear", "sourceIn": { "ticks": "1", "timescale": 2 }, "rate": { "num": 1, "den": 1 } } })],
    )
    .expect_err("换映射是单独改时间");
    assert_eq!(refused.code, "INVALID_OPERATION");
    assert_eq!(refused.details["rule"], "link-group");
    assert_eq!(refused.details["groupId"], json!(f.group));
    // 拆开再合并一个成员：合并拒绝。
    apply(&mut f.video, "cmd_split", vec![json!({ "type": "splitItem", "sequenceId": f.seq, "itemId": f.screen0, "at": seconds("3"), "alignment": "exact-frame" })]).unwrap();
    let right = members_of(&f.video, &groups(&f.video).into_iter().find(|g| g.id != f.group).unwrap().id)[0].clone();
    let joined = apply(&mut f.video, "cmd_join", vec![json!({ "type": "joinItems", "sequenceId": f.seq, "itemIds": [f.screen0, right] })]);
    assert_eq!(joined.expect_err("合并拒绝").details["rule"], "link-group");
    // 只换素材、不换映射照常。
    apply(&mut f.video, "cmd_reasset", vec![json!({ "type": "replaceItemAsset", "sequenceId": f.seq, "itemId": f.cam0, "assetRef": { "id": f.assets[1], "revision": "1" } })]).unwrap();

    // 解组之后各自修剪。
    let group = group_of(&f.video, &f.cam0).unwrap();
    apply(&mut f.video, "cmd_unlink", vec![json!({ "type": "unlinkItems", "sequenceId": f.seq, "groupId": group })]).unwrap();
    apply(&mut f.video, "cmd_trim_alone", vec![json!({ "type": "trimItem", "sequenceId": f.seq, "itemId": f.cam0, "edge": "start", "at": seconds("2"), "alignment": "exact-frame" })]).unwrap();
    assert_eq!(range(&f.video, &f.cam0).0, r(2, 1));
    assert_eq!(range(&f.video, &f.screen0).0, r(0, 1));
}

/// 同步校正：只改这一个成员的源起点，位置与长度不变；之后的拆分、变速与移动都保留这个校正。
#[test]
fn sync_correction_changes_only_one_source_start() {
    let Some(mut f) = rec() else { return };
    let (before_range, before_others) = (range(&f.video, &f.mic0), range(&f.video, &f.screen0));
    apply(&mut f.video, "cmd_sync", vec![json!({ "type": "syncLinkedItem", "sequenceId": f.seq, "itemId": f.mic0, "offset": "0.1" })]).unwrap();
    assert_eq!(range(&f.video, &f.mic0), before_range);
    assert_eq!(time_map(&f.video, &f.mic0).0, r(1, 10));
    assert_eq!(range(&f.video, &f.screen0), before_others);
    assert_eq!(time_map(&f.video, &f.screen0).0, r(0, 1));
    // 校正之后这一路对着录制时间 start + s − 0.1。
    let mut corrected = f.starts.clone();
    corrected.insert(f.assets[2].clone(), r(-1, 10));
    assert_eq!(in_sync(&f.video, &corrected), 14);

    apply(&mut f.video, "cmd_split", vec![json!({ "type": "splitItem", "sequenceId": f.seq, "itemId": f.screen0, "at": seconds("3"), "alignment": "exact-frame" })]).unwrap();
    apply(&mut f.video, "cmd_speed", vec![json!({ "type": "setSpeed", "sequenceId": f.seq, "itemId": f.screen0, "rate": { "num": 2, "den": 1 } })]).unwrap();
    apply(&mut f.video, "cmd_move", vec![json!({ "type": "moveItem", "sequenceId": f.seq, "itemId": f.screen0, "offset": seconds("1"), "alignment": "exact-frame" })]).unwrap();
    assert_eq!(time_map(&f.video, &f.mic0).0, r(1, 10));
    assert!(in_sync(&f.video, &corrected) > 0);

    // 超出素材：拒绝；不在组里：拒绝。
    let out = apply(&mut f.video, "cmd_sync_out", vec![json!({ "type": "syncLinkedItem", "sequenceId": f.seq, "itemId": f.screen0, "offset": "-0.5" })]);
    assert_eq!(out.expect_err("超出素材").code, "SOURCE_TIME_OUT_OF_RANGE");
    let unlinked = apply(&mut f.video, "cmd_add_plain", vec![json!({ "type": "addItem", "sequenceId": f.seq, "asset": { "assetId": f.assets[0] }, "trackId": f.v2, "at": seconds("40"), "alignment": "exact-frame" })]).unwrap();
    let plain = created_item(&f.video, &unlinked);
    let refused = apply(&mut f.video, "cmd_sync_plain", vec![json!({ "type": "syncLinkedItem", "sequenceId": f.seq, "itemId": plain, "offset": "0.1" })]);
    assert_eq!(refused.expect_err("不在组里").code, "INVALID_OPERATION");
}

/// 锁：任一成员或它的轨道锁着，整组的时间编辑整笔拒绝，details 指出是哪个成员。
#[test]
fn a_locked_member_refuses_the_whole_group_edit() {
    let Some(mut f) = rec() else { return };
    apply(&mut f.video, "cmd_lock", vec![json!({ "type": "updateItem", "sequenceId": f.seq, "itemId": f.cam0, "locked": true })]).unwrap();
    for (n, op) in [
        json!({ "type": "moveItem", "sequenceId": f.seq, "itemId": f.screen0, "offset": seconds("1"), "alignment": "exact-frame" }),
        json!({ "type": "splitItem", "sequenceId": f.seq, "itemId": f.mic0, "at": seconds("3"), "alignment": "exact-frame" }),
        json!({ "type": "setSpeed", "sequenceId": f.seq, "itemId": f.screen0, "rate": { "num": 2, "den": 1 } }),
        json!({ "type": "removeRange", "sequenceId": f.seq, "from": seconds("2"), "to": seconds("3"), "trackIds": [f.a1], "alignment": "exact-frame" }),
    ]
    .into_iter()
    .enumerate()
    {
        let err = apply(&mut f.video, &format!("cmd_locked_{n}"), vec![op]).expect_err("成员锁着");
        assert_eq!(err.code, "TARGET_LOCKED", "第 {n} 个");
        assert_eq!(err.details["itemId"], json!(f.cam0), "第 {n} 个");
        assert_eq!(err.details["groupId"], json!(f.group));
    }
    assert_eq!(range(&f.video, &f.screen0).0, r(0, 1), "整笔拒绝，什么都没动");
    apply(&mut f.video, "cmd_unlock", vec![json!({ "type": "updateItem", "sequenceId": f.seq, "itemId": f.cam0, "locked": false })]).unwrap();
    apply(&mut f.video, "cmd_lock_track", vec![json!({ "type": "updateTrack", "sequenceId": f.seq, "trackId": f.v2, "locked": true })]).unwrap();
    let err = apply(&mut f.video, "cmd_locked_track", vec![json!({ "type": "trimItem", "sequenceId": f.seq, "itemId": f.mic0, "edge": "start", "at": seconds("2"), "alignment": "exact-frame" })])
        .expect_err("轨道锁着");
    assert_eq!(err.code, "TARGET_LOCKED");
    assert_eq!(err.details["itemId"], json!(f.cam0));
}

/// 登记了才联动：没有登记的 `linkGroupId` 照旧，移动一个不带动另一个。
#[test]
fn unregistered_link_group_ids_do_not_move_together() {
    let Some(mut f) = rec() else { return };
    let mut first = audio_item(&f.a1, &f.assets[4], 600, 2);
    let mut second = audio_item(&f.a1, &f.assets[4], 690, 2);
    first["linkGroupId"] = json!("lg_legacy");
    second["linkGroupId"] = json!("lg_legacy");
    let inserted = apply(&mut f.video, "cmd_legacy", vec![json!({ "type": "insertItems", "sequenceId": f.seq, "items": [first, second] })]).unwrap();
    let ids: Vec<String> = inserted.receipt.created_ids.iter().filter(|id| f.video.state().items.contains_key(*id)).cloned().collect();
    let other = ids.iter().find(|id| range(&f.video, id).0 == r(23, 1)).unwrap().clone();
    let moved = ids.iter().find(|id| **id != other).unwrap().clone();
    apply(&mut f.video, "cmd_legacy_move", vec![json!({ "type": "moveItem", "sequenceId": f.seq, "itemId": moved, "offset": seconds("-1"), "alignment": "exact-frame" })]).unwrap();
    assert_eq!(range(&f.video, &moved).0, r(19, 1));
    assert_eq!(range(&f.video, &other).0, r(23, 1));
    assert_eq!(range(&f.video, &f.screen0).0, r(0, 1));
}

/// 同一次录制放上时间线两次是两个组：各自移动、拆分、修剪互不影响，各有各的不变量。
#[test]
fn the_same_recording_placed_twice_edits_independently() {
    let Some(mut f) = rec() else { return };
    let manifest = groups(&f.video)[0].recording_id.clone().unwrap();
    let second = place(&mut f.video, "p2", 600, &f.assets, (&f.v1, &f.v2, &f.a1), &manifest, &f.view);
    assert_eq!(groups(&f.video).len(), 2);
    let first_ranges: Vec<_> = [&f.screen0, &f.cam0, &f.mic0, &f.screen1, &f.mic1].iter().map(|id| range(&f.video, id)).collect();
    apply(&mut f.video, "cmd_p2_move", vec![json!({ "type": "moveItem", "sequenceId": f.seq, "itemId": second[1], "offset": seconds("2"), "alignment": "exact-frame" })]).unwrap();
    apply(&mut f.video, "cmd_p2_split", vec![json!({ "type": "splitItem", "sequenceId": f.seq, "itemId": second[0], "at": seconds("25"), "alignment": "exact-frame" })]).unwrap();
    apply(&mut f.video, "cmd_p2_trim", vec![json!({ "type": "trimItem", "sequenceId": f.seq, "itemId": second[4], "edge": "end", "at": seconds("30"), "alignment": "exact-frame" })]).unwrap();
    let after: Vec<_> = [&f.screen0, &f.cam0, &f.mic0, &f.screen1, &f.mic1].iter().map(|id| range(&f.video, id)).collect();
    assert_eq!(first_ranges, after, "第一次放的那组不动");
    assert_eq!(range(&f.video, &second[0]).0, r(22, 1));
    assert_eq!(range(&f.video, &second[1]).0, r(23, 1));
    assert_eq!(groups(&f.video).len(), 3);
    assert!(members_of(&f.video, &f.group).len() == 5);
    // 两次放的是同一批素材，不变量按组各自核对：第二组在同一序列时刻也对着同一录制时刻。
    assert!(in_sync(&f.video, &f.starts) > 14);
}

/// 各序列的实例、轨道与组登记，去掉随每次提交变化的修订号。
fn timeline(video: &Video) -> Value {
    let mut value = serde_json::to_value(video.snapshot()).unwrap()["sequences"].clone();
    for sequence in value.as_object_mut().unwrap().values_mut() {
        sequence.as_object_mut().unwrap().remove("revision");
    }
    value
}

/// 撤销、重做与重新打开：成组的编辑整笔撤销、重做，存盘再打开之后登记与不变量都在。
#[test]
fn undo_redo_and_reopen_keep_the_group_in_sync() {
    let Some(mut f) = rec() else { return };
    let split = apply(&mut f.video, "cmd_split", vec![json!({ "type": "splitItem", "sequenceId": f.seq, "itemId": f.cam0, "at": seconds("3"), "alignment": "exact-frame" })]).unwrap();
    apply(&mut f.video, "cmd_move", vec![json!({ "type": "moveItem", "sequenceId": f.seq, "itemId": f.mic1, "offset": seconds("2"), "alignment": "exact-frame" })]).unwrap();
    let state_after = timeline(&f.video);
    history(&mut f.video, "cmd_undo_move", UndoTarget::Undo);
    history(&mut f.video, "cmd_undo_split", UndoTarget::Transaction(split.receipt.transaction_id.clone()));
    assert_eq!(groups(&f.video).len(), 1);
    assert_eq!(f.video.state().items.len(), 5);
    assert_eq!(in_sync(&f.video, &f.starts), 14);
    history(&mut f.video, "cmd_redo_split", UndoTarget::Redo);
    history(&mut f.video, "cmd_redo_move", UndoTarget::Redo);
    assert_eq!(groups(&f.video).len(), 2);
    assert!(in_sync(&f.video, &f.starts) > 0);
    assert_eq!(timeline(&f.video), state_after, "重做回到同一条时间线");

    let dir = f.dir.path().join("m");
    let Rec { video, starts, .. } = f;
    drop(video);
    let reopened = Video::open(&dir, OpenMode::Write, &ffprobe()).unwrap();
    assert_eq!(groups(&reopened).len(), 2);
    assert!(in_sync(&reopened, &starts) > 0);
    assert_eq!(timeline(&reopened), state_after, "重新打开是同一条时间线");
}
