//! `replaceItemAsset`：原地换视频、图片、音频片段的素材（命令与协议规范 §4.2，视频格式规范 §4.2）。
//! 片段 ID 与其余字段不变，转场、字幕作用范围与闪避照样指着它；种类、源区间与锁照常校验。测试素材用 ffmpeg 现场生成，没有 ffmpeg 时跳过。

#![allow(clippy::result_large_err)]

use std::path::{Path, PathBuf};
use std::process::Command;

use editor_semantics::Rate;
use serde_json::{Value, json};
use video_engine::model::{Actor, ActorKind, TimelineItem};
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
        name: "换素材".into(),
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
        label_ref: None,
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

fn track(video: &Video, name: &str) -> String {
    video
        .state()
        .tracks
        .values()
        .find(|t| t.value.name.as_deref() == Some(name))
        .map(|t| t.value.id.clone())
        .unwrap()
}

fn frames(n: i64) -> Value {
    json!({ "unit": "frames", "value": n })
}

fn item_json(video: &Video, id: &str) -> Value {
    serde_json::to_value(&video.state().items[id].value).unwrap()
}

fn asset_ref(video: &Video, id: &str) -> Value {
    item_json(video, id)["assetRef"].clone()
}

/// 资产的当前版本，写成 `{ id, revision }`。
fn current(video: &Video, asset_id: &str) -> Value {
    json!({ "id": asset_id, "revision": video.state().assets[asset_id].current_revision })
}

fn transitions(video: &Video) -> Vec<video_engine::model::Transition> {
    let snapshot = video.snapshot();
    snapshot.sequences[&snapshot.root_sequence_id].transitions.clone()
}

fn replace(item: &str, target: Value) -> Value {
    let mut op = json!({ "type": "replaceItemAsset", "itemId": item });
    for (key, value) in target.as_object().unwrap() {
        op[key] = value.clone();
    }
    op
}

/// 现场生成的素材：`long` 4 秒有声视频、`other` 另一段 4 秒有声视频、`short` 2 秒无声视频、两张图片、一段 4 秒的声音。
struct Media {
    _dir: tempfile::TempDir,
    long: PathBuf,
    other: PathBuf,
    short: PathBuf,
    still: PathBuf,
    still2: PathBuf,
    tone: PathBuf,
}

fn media() -> Option<Media> {
    let dir = tempfile::tempdir().ok()?;
    let run = |args: &[&str], out: &Path| {
        Command::new("ffmpeg")
            .args(["-v", "error", "-y"])
            .args(args)
            .arg(out)
            .output()
            .is_ok_and(|o| o.status.success())
    };
    let path = |name: &str| dir.path().join(name);
    let with_sound = |src: &str, freq: u32, out: &Path| {
        run(
            &[
                "-f",
                "lavfi",
                "-i",
                &format!("{src}=size=160x90:rate=30:duration=4"),
                "-f",
                "lavfi",
                "-i",
                &format!("sine=frequency={freq}:duration=4"),
                "-c:v",
                "mpeg4",
                "-c:a",
                "aac",
                "-shortest",
            ],
            out,
        )
    };
    let picture = |src: &str, seconds: u32, out: &Path| {
        run(
            &["-f", "lavfi", "-i", &format!("{src}=size=160x90:rate=30:duration={seconds}"), "-c:v", "mpeg4"],
            out,
        )
    };
    let still = |color: &str, out: &Path| run(&["-f", "lavfi", "-i", &format!("color=c={color}:size=160x90"), "-frames:v", "1"], out);
    let ok = with_sound("testsrc", 440, &path("long.mp4"))
        && with_sound("testsrc2", 880, &path("other.mp4"))
        && picture("testsrc", 2, &path("short.mp4"))
        && still("red", &path("still.png"))
        && still("blue", &path("still2.png"))
        && run(&["-f", "lavfi", "-i", "sine=frequency=330:duration=4", "-c:a", "pcm_s16le"], &path("tone.wav"));
    if !ok {
        eprintln!("跳过：没有可用的 ffmpeg 生成测试素材");
        return None;
    }
    Some(Media {
        long: path("long.mp4"),
        other: path("other.mp4"),
        short: path("short.mp4"),
        still: path("still.png"),
        still2: path("still2.png"),
        tone: path("tone.wav"),
        _dir: dir,
    })
}

/// V1 上两段 `long`：a [0,45) 取源 [0,1.5s)，后面留 2.5 秒；b [45,165) 取满。a→b 一个从切点开始的 20 帧叠化，要 a 结尾之后 20 帧。
struct Fixture {
    video: Video,
    _dir: tempfile::TempDir,
    a: String,
    b: String,
    long: String,
}

fn fixture(media: &Media) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let mut video = new_video(&dir.path().join("m"));
    let s = seq(&video);
    let add = json!({ "type": "addItem", "sequenceId": s, "asset": { "ref": "long" }, "alignment": "nearest-frame" });
    let committed = apply(
        &mut video,
        "cmd_add",
        vec![json!({ "type": "importAsset", "path": media.long, "ref": "long" }), add.clone(), add],
    )
    .unwrap();
    let long = committed.receipt.refs["long"].clone();
    let mut ids: Vec<String> = committed
        .receipt
        .created_ids
        .iter()
        .filter(|id| video.state().items.contains_key(*id))
        .cloned()
        .collect();
    ids.sort_by_key(|id| video.state().items[id].value.span().unwrap().from_frame);
    let (a, b) = (ids[0].clone(), ids[1].clone());
    apply(
        &mut video,
        "cmd_layout",
        vec![
            json!({ "type": "trimItem", "sequenceId": s, "itemId": a, "edge": "end", "at": frames(45), "alignment": "exact-frame" }),
            json!({ "type": "moveItem", "sequenceId": s, "itemId": b, "at": frames(45), "alignment": "exact-frame" }),
            json!({ "type": "setTransition", "sequenceId": s, "leftItemId": a, "rightItemId": b, "kind": "dissolve",
                    "duration": frames(20), "alignment": "exact-frame", "placement": "start-at-cut" }),
        ],
    )
    .unwrap();
    assert_eq!(transitions(&video).len(), 1);
    Fixture {
        video,
        _dir: dir,
        a,
        b,
        long,
    }
}

#[test]
fn swap_keeps_the_clip_and_everything_that_points_at_it() {
    let Some(media) = media() else { return };
    let Fixture {
        mut video, a, b, long, ..
    } = fixture(&media);
    let s = seq(&video);
    let a1 = track(&video, "A1");
    apply(
        &mut video,
        "cmd_dress",
        vec![
            json!({ "type": "updateItem", "itemId": a, "name": "Opening" }),
            json!({ "type": "setEffects", "itemId": a, "fx": { "filterPreset": "calm1", "temperature": 0.3 } }),
            json!({ "type": "setStyle", "itemId": a, "crop": { "left": 0.1, "top": 0, "right": 0.2, "bottom": 0 } }),
            json!({ "type": "setKeyframes", "itemId": a, "property": "opacity",
                    "keyframes": [{ "localFrame": 0, "value": 0.0 }, { "localFrame": 15, "value": 1.0 }] }),
            json!({ "type": "addTrack", "sequenceId": s, "kind": "subtitle", "ref": "subs" }),
            json!({ "type": "putDocument", "ref": "cues", "kind": "caption",
                    "body": { "schema": "baocut.caption/1", "clock": "source-asset", "cues": [] } }),
            json!({ "type": "insertItems", "sequenceId": s, "items": [
                { "type": "caption", "trackRef": "subs", "span": { "fromFrame": 0, "durationFrames": 45 }, "documentRef": "cues", "scopeItemIds": [a] },
            ] }),
            json!({ "type": "setDucking", "sequenceId": s, "trigger": { "kind": "items", "trackIds": [a1] }, "target": { "itemIds": [a] } }),
        ],
    )
    .unwrap();
    let before = item_json(&video, &a);
    let bindings_before = video.snapshot().sequences[&s].header.animation_bindings.clone();
    let transitions_before = transitions(&video);
    let caption = video
        .state()
        .items
        .values()
        .find_map(|p| match &p.value {
            TimelineItem::Caption(c) => Some(c.base.id.clone()),
            _ => None,
        })
        .unwrap();
    let items_before = video.state().items.len();

    // 同一笔里导入新素材并换上：只有 assetRef 变了。
    let committed = apply(
        &mut video,
        "cmd_swap",
        vec![
            json!({ "type": "importAsset", "path": media.other, "ref": "take2" }),
            json!({ "type": "replaceItemAsset", "itemId": a, "assetImportRef": "take2" }),
        ],
    )
    .unwrap();
    let other = committed.receipt.refs["take2"].clone();
    assert_ne!(other, long, "不同内容是新的素材记录");
    assert_eq!(committed.receipt.label, "Replace clip asset");
    assert!(committed.receipt.updated_ids.contains(&a));
    assert!(!committed.receipt.deleted_ids.contains(&a));
    let impact = serde_json::to_value(&committed.receipt.impact).unwrap();
    assert_eq!(
        impact["assetSwaps"],
        json!([{ "itemId": a, "previousAssetRef": current(&video, &long), "assetRef": current(&video, &other) }])
    );
    assert!(impact.get("removedTransitions").is_none(), "新素材余量够，转场留着");

    let mut after = item_json(&video, &a);
    assert_eq!(after["assetRef"], current(&video, &other));
    after["assetRef"] = before["assetRef"].clone();
    assert_eq!(after, before, "除了素材，片段原样");
    assert_eq!(video.snapshot().sequences[&s].header.animation_bindings, bindings_before);
    assert_eq!(transitions(&video), transitions_before);
    assert_eq!(video.state().items.len(), items_before, "没有片段被删掉或新建");
    let TimelineItem::Caption(c) = &video.state().items[&caption].value else {
        panic!()
    };
    assert_eq!(c.scope_item_ids, vec![a.clone()]);
    let snapshot = serde_json::to_value(video.snapshot()).unwrap();
    assert_eq!(snapshot["sequences"][&s]["ducking"][0]["target"], json!({ "itemIds": [a] }));
    assert_eq!(asset_ref(&video, &b), current(&video, &long), "没选中的片段还用旧素材");

    // 撤销：换回旧素材，ID 不变；同一笔导入的素材记录一起撤掉。
    undo(&mut video, "cmd_undo", &committed).unwrap();
    assert_eq!(item_json(&video, &a), before);
    assert!(!video.state().assets.contains_key(&other));

    // 直接给已有素材的 assetRef 也行。
    let imported = apply(&mut video, "cmd_reimport", vec![json!({ "type": "importAsset", "path": media.other, "ref": "take2" })]).unwrap();
    let other_ref = current(&video, &imported.receipt.refs["take2"]);
    apply(&mut video, "cmd_redo", vec![replace(&a, json!({ "assetRef": other_ref.clone() }))]).unwrap();
    assert_eq!(asset_ref(&video, &a), other_ref);
}

#[test]
fn new_asset_must_cover_the_used_source_range() {
    let Some(media) = media() else { return };
    let Fixture { mut video, a, long, .. } = fixture(&media);
    let committed = apply(
        &mut video,
        "cmd_import",
        vec![
            json!({ "type": "importAsset", "path": media.short, "ref": "short" }),
            json!({ "type": "importAsset", "path": media.other, "ref": "other" }),
        ],
    )
    .unwrap();
    let (short, other) = (committed.receipt.refs["short"].clone(), committed.receipt.refs["other"].clone());
    let before = item_json(&video, &a);
    let (short_ref, other_ref) = (current(&video, &short), current(&video, &other));
    let linear = |ticks: &str| json!({ "kind": "linear", "sourceIn": { "ticks": ticks, "timescale": 1000 }, "rate": { "num": 1, "den": 1 } });

    // a 从 1 秒起取 1.5 秒，要到 2.5 秒；短素材只有 2 秒：整笔拒绝，不截短。
    let err = apply(
        &mut video,
        "cmd_late",
        vec![replace(&a, json!({ "assetRef": short_ref, "timeMap": linear("1000") }))],
    )
    .expect_err("盖不住源区间");
    assert_eq!(err.code, "SOURCE_TIME_OUT_OF_RANGE");
    assert_eq!(item_json(&video, &a), before, "失败的事务不留痕迹");

    // 定格停在新素材之外也不行。
    let hold = json!({ "kind": "hold", "sourceAt": { "ticks": "4500", "timescale": 1000 } });
    let err = apply(&mut video, "cmd_hold", vec![replace(&a, json!({ "assetRef": other_ref, "timeMap": hold }))])
        .expect_err("定格在素材之外");
    assert_eq!(err.code, "SOURCE_TIME_OUT_OF_RANGE");

    // 给 timeMap 就整个替换：从新素材 0.5 秒起放。
    apply(
        &mut video,
        "cmd_restart",
        vec![replace(&a, json!({ "assetRef": other_ref, "timeMap": linear("500") }))],
    )
    .unwrap();
    let now = item_json(&video, &a);
    assert_eq!(now["timeMap"], linear("500"));
    assert_eq!((now["span"].clone(), now["assetRef"].clone()), (before["span"].clone(), current(&video, &other)));

    // 短素材盖得住 [0,1.5s)，但 a 后面只剩 0.5 秒（15 帧），20 帧的叠化不再成立：去掉并报告。
    let committed = apply(
        &mut video,
        "cmd_short",
        vec![replace(&a, json!({ "assetRef": short_ref, "timeMap": linear("0") }))],
    )
    .unwrap();
    let impact = serde_json::to_value(&committed.receipt.impact).unwrap();
    assert_eq!(impact["removedTransitions"][0]["reason"], "handles-insufficient");
    assert!(transitions(&video).is_empty());
    assert_eq!(impact["assetSwaps"][0]["previousAssetRef"], current(&video, &other));
    assert_ne!(short, long);
}

#[test]
fn asset_kind_must_match_the_clip() {
    let Some(media) = media() else { return };
    let Fixture { mut video, a, .. } = fixture(&media);
    let s = seq(&video);
    let v1 = track(&video, "V1");
    let committed = apply(
        &mut video,
        "cmd_more",
        vec![
            json!({ "type": "importAsset", "path": media.still, "ref": "still" }),
            json!({ "type": "importAsset", "path": media.still2, "ref": "still2" }),
            json!({ "type": "importAsset", "path": media.tone, "ref": "tone" }),
            json!({ "type": "importAsset", "path": media.long, "ref": "long" }),
            json!({ "type": "addItem", "sequenceId": s, "asset": { "ref": "still" }, "at": frames(300), "alignment": "exact-frame" }),
            json!({ "type": "addItem", "sequenceId": s, "asset": { "ref": "tone" }, "at": frames(0), "alignment": "exact-frame" }),
            json!({ "type": "insertItems", "sequenceId": s, "items": [
                { "type": "text", "trackId": v1, "span": { "fromFrame": 600, "durationFrames": 30 }, "place": { "x": 50, "y": 50, "w": 40 }, "text": "t", "style": {} },
            ] }),
        ],
    )
    .unwrap();
    let refs = &committed.receipt.refs;
    let (still2, tone, long) = (refs["still2"].clone(), refs["tone"].clone(), refs["long"].clone());
    let kind_of = |video: &Video, kind: &str| {
        video
            .state()
            .items
            .values()
            .find(|p| serde_json::to_value(&p.value).unwrap()["type"] == kind)
            .map(|p| p.value.base().id.clone())
            .unwrap()
    };
    let (image, audio, text) = (kind_of(&video, "image"), kind_of(&video, "audio"), kind_of(&video, "text"));
    let [still2_ref, tone_ref, long_ref] = [&still2, &tone, &long].map(|id| current(&video, id));
    let fails = |video: &mut Video, id: &str, op: Value| apply(video, "cmd_bad", vec![op]).expect_err(id).code;

    // 视频片段不能换成声音，图片片段不能换成视频，音频片段不能换成图片。
    assert_eq!(fails(&mut video, "video←audio", replace(&a, json!({ "assetRef": tone_ref }))), "INVALID_OPERATION");
    assert_eq!(fails(&mut video, "image←video", replace(&image, json!({ "assetRef": long_ref }))), "INVALID_OPERATION");
    assert_eq!(fails(&mut video, "audio←image", replace(&audio, json!({ "assetRef": still2_ref.clone() }))), "INVALID_OPERATION");
    // 图片没有时间映射；文字不是素材片段。
    let map = json!({ "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } });
    assert_eq!(
        fails(&mut video, "image+timeMap", replace(&image, json!({ "assetRef": still2_ref, "timeMap": map }))),
        "INVALID_OPERATION"
    );
    assert_eq!(fails(&mut video, "text", replace(&text, json!({ "assetRef": still2_ref }))), "INVALID_OPERATION");
    // assetRef 与 assetImportRef 只给一个。
    assert_eq!(fails(&mut video, "neither", replace(&a, json!({}))), "INVALID_OPERATION");
    assert_eq!(
        fails(&mut video, "both", replace(&a, json!({ "assetRef": long_ref, "assetImportRef": "x" }))),
        "INVALID_OPERATION"
    );

    // 合法的：图片换图片，音频换成有声视频的声音。
    apply(
        &mut video,
        "cmd_ok",
        vec![
            replace(&image, json!({ "assetRef": still2_ref })),
            replace(&audio, json!({ "assetRef": long_ref })),
        ],
    )
    .unwrap();
    assert_eq!(asset_ref(&video, &image), current(&video, &still2));
    assert_eq!(asset_ref(&video, &audio), current(&video, &long));
}

#[test]
fn locked_clip_is_refused() {
    let Some(media) = media() else { return };
    let Fixture { mut video, a, long, .. } = fixture(&media);
    apply(&mut video, "cmd_lock", vec![json!({ "type": "updateItem", "itemId": a, "locked": true })]).unwrap();
    let err = apply(
        &mut video,
        "cmd_swap",
        vec![
            json!({ "type": "importAsset", "path": media.other, "ref": "other" }),
            json!({ "type": "replaceItemAsset", "itemId": a, "assetImportRef": "other" }),
        ],
    )
    .expect_err("锁着");
    assert_eq!(err.code, "TARGET_LOCKED");
    assert_eq!(asset_ref(&video, &a), current(&video, &long));
}

/// 编辑器「替换」的整笔（`packages/ui/src/model/asset-replace.ts`）：新素材更短时先 `trimItem` 收短终点、`moveItems` 挪同轨后面的片段，
/// 再 `replaceItemAsset` 从 0 秒起换上，`setAudioMix` 把放不下的淡入收进新长度。一笔提交，一次撤销回到原样。
#[test]
fn editor_shrink_ripple_and_swap_in_one_transaction() {
    let Some(media) = media() else { return };
    let Fixture { mut video, b, long, .. } = fixture(&media);
    let s = seq(&video);
    let v1 = item_json(&video, &b)["trackId"].clone();
    let committed = apply(
        &mut video,
        "cmd_tail",
        vec![
            json!({ "type": "addItem", "sequenceId": s, "asset": { "assetId": long }, "trackId": v1, "alignment": "nearest-frame" }),
            json!({ "type": "setAudioMix", "sequenceId": s, "itemId": b, "fadeIn": "2", "fadeOut": "1" }),
        ],
    )
    .unwrap();
    let c = committed
        .receipt
        .created_ids
        .iter()
        .find(|id| video.state().items.contains_key(*id))
        .cloned()
        .unwrap();
    let span = |video: &Video, id: &str| item_json(video, id)["span"].clone();
    assert_eq!(span(&video, &c)["fromFrame"], 165);
    let before = (item_json(&video, &b), item_json(&video, &c), transitions(&video));

    // b [45,165) 换成 2 秒的 short：终点收到 45 + 60，c 往前 60 帧，淡入 2 秒收到 1 秒（淡出 1 秒留着）。
    let committed = apply(
        &mut video,
        "cmd_replace",
        vec![
            json!({ "type": "importAsset", "path": media.short, "ref": "replacement" }),
            json!({ "type": "trimItem", "sequenceId": s, "itemId": b, "edge": "end", "at": frames(105), "alignment": "exact-frame" }),
            json!({ "type": "moveItems", "sequenceId": s, "moves": [{ "itemId": c, "offset": frames(-60) }], "alignment": "exact-frame" }),
            json!({ "type": "replaceItemAsset", "sequenceId": s, "itemId": b, "assetImportRef": "replacement",
                    "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 30 }, "rate": { "num": 1, "den": 1 } } }),
            json!({ "type": "setAudioMix", "sequenceId": s, "itemId": b, "fadeIn": "1" }),
        ],
    )
    .unwrap();
    let short = committed.receipt.refs["replacement"].clone();
    let now = item_json(&video, &b);
    assert_eq!(now["assetRef"], current(&video, &short));
    assert_eq!(now["span"], json!({ "fromFrame": 45, "durationFrames": 60 }));
    assert_eq!(span(&video, &c)["fromFrame"], 105);
    // 淡入淡出现在都是 1 秒，与原来 1 秒的淡出同一个写法。
    let (audio, one_second) = (&now["embeddedAudio"], &before.0["embeddedAudio"]["fadeOut"]);
    assert_eq!((&audio["fadeIn"], &audio["fadeOut"]), (one_second, one_second));
    // a→b 的叠化只要 a 的尾巴，照旧留着。
    assert_eq!(transitions(&video), before.2);

    undo(&mut video, "cmd_undo", &committed).unwrap();
    assert_eq!((item_json(&video, &b), item_json(&video, &c), transitions(&video)), before);
}
