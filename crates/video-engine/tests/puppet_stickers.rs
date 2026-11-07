//! 角色贴纸（视频格式规范 §3.7）：角色包与动作轨在同一次修改里导入并插入（`assetImportRef` + `motionImportRef`），
//! 拆分与裁掉开头时 `motionIn` 跟着内容走，合并是拆分的逆操作；动作轨只能挂在角色贴纸上，且必须是动作轨素材。
//! 角色用 [`puppet::testing`] 的合成角色，不需要 ffmpeg。

#![allow(clippy::result_large_err)]

use std::fs;
use std::path::{Path, PathBuf};

use editor_semantics::Rate;
use serde_json::{Value, json};
use video_engine::model::{Actor, ActorKind};
use video_engine::{Committed, CreateOptions, ErrorBody, Video, VideoTransaction};

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
        name: "角色".into(),
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

fn item(video: &Video, id: &str) -> Value {
    serde_json::to_value(&video.state().items[id].value).unwrap()
}

fn frames(n: i64) -> Value {
    json!({ "unit": "frames", "value": n })
}

struct Fixture {
    video: Video,
    _dir: tempfile::TempDir,
    root: PathBuf,
    host: String,
}

/// V1 上一个 [0, 90) 的角色贴纸，挂着 3 秒的动作轨。
fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    let mut video = new_video(&root.join("v"));
    fs::write(root.join("host.bcpuppet"), puppet::testing::package_zip()).unwrap();
    fs::write(root.join("talk.json"), puppet::testing::talking_track(3.0)).unwrap();
    let sticker = json!({
        "type": "sticker", "trackId": track(&video, "V1"), "span": { "fromFrame": 0, "durationFrames": 90 },
        "place": {}, "sticker": { "source": "asset" }, "assetImportRef": "host", "motionImportRef": "talk",
    });
    let s = seq(&video);
    let committed = apply(
        &mut video,
        "cmd_place",
        vec![
            json!({ "type": "importAsset", "path": root.join("host.bcpuppet"), "ref": "host", "storage": "managed" }),
            json!({ "type": "importAsset", "path": root.join("talk.json"), "ref": "talk", "storage": "managed" }),
            json!({ "type": "insertItems", "sequenceId": s, "items": [sticker] }),
        ],
    )
    .unwrap();
    let host = committed
        .receipt
        .created_ids
        .iter()
        .find(|id| video.state().items.contains_key(*id))
        .unwrap()
        .clone();
    Fixture {
        video,
        _dir: dir,
        root,
        host,
    }
}

#[test]
fn a_character_sticker_points_at_its_package_and_motion_track() {
    let f = fixture();
    let host = item(&f.video, &f.host);
    let assets = &f.video.state().assets;
    let package = &assets[host["assetRef"]["id"].as_str().unwrap()];
    let motion = &assets[host["motionRef"]["id"].as_str().unwrap()];
    assert_eq!(serde_json::to_value(package.kind).unwrap(), "puppet");
    assert_eq!(serde_json::to_value(motion.kind).unwrap(), "other");
    assert_eq!(
        motion.revisions[&motion.current_revision].media_type,
        "application/x-baocut-puppet-track+json"
    );
    assert!(host.get("motionIn").is_none());
}

#[test]
fn split_and_trim_move_the_clock_and_join_undoes_split() {
    let mut f = fixture();
    let s = seq(&f.video);
    let split = apply(
        &mut f.video,
        "cmd_split",
        vec![json!({ "type": "splitItem", "sequenceId": s, "itemId": f.host, "at": frames(45), "alignment": "exact-frame" })],
    )
    .unwrap();
    let right = split.receipt.created_ids.iter().find(|id| **id != f.host).unwrap().clone();
    // 后一段从角色时钟的 1.5 秒开始；前一段不变
    assert_eq!(item(&f.video, &right)["motionIn"], json!({ "ticks": "3", "timescale": 2 }));
    assert!(item(&f.video, &f.host).get("motionIn").is_none());

    apply(
        &mut f.video,
        "cmd_join",
        vec![json!({ "type": "joinItems", "sequenceId": s, "itemIds": [f.host, right] })],
    )
    .unwrap();
    let joined = item(&f.video, &f.host);
    assert_eq!(joined["span"]["durationFrames"], 90);
    assert!(joined.get("motionIn").is_none());

    // 裁掉开头 15 帧：时钟往后 0.5 秒；再往左拉长 30 帧：时钟到 -0.5 秒（开头早于动作轨）
    apply(
        &mut f.video,
        "cmd_trim",
        vec![
            json!({ "type": "trimItem", "sequenceId": s, "itemId": f.host, "edge": "start", "at": frames(15), "alignment": "exact-frame" }),
        ],
    )
    .unwrap();
    assert_eq!(item(&f.video, &f.host)["motionIn"], json!({ "ticks": "1", "timescale": 2 }));
    apply(
        &mut f.video,
        "cmd_move",
        vec![json!({ "type": "moveItem", "sequenceId": s, "itemId": f.host, "at": frames(60), "alignment": "exact-frame" })],
    )
    .unwrap();
    apply(
        &mut f.video,
        "cmd_extend",
        vec![
            json!({ "type": "trimItem", "sequenceId": s, "itemId": f.host, "edge": "start", "at": frames(30), "alignment": "exact-frame" }),
        ],
    )
    .unwrap();
    assert_eq!(item(&f.video, &f.host)["motionIn"], json!({ "ticks": "-1", "timescale": 2 }));
}

#[test]
fn a_motion_track_only_goes_on_a_character_with_a_motion_asset() {
    let mut f = fixture();
    let s = seq(&f.video);
    let motion = item(&f.video, &f.host)["motionRef"].clone();
    let package = item(&f.video, &f.host)["assetRef"].clone();
    fs::write(
        f.root.join("still.svg"),
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>"#,
    )
    .unwrap();
    let still = apply(
        &mut f.video,
        "cmd_still",
        vec![json!({ "type": "importAsset", "path": f.root.join("still.svg"), "ref": "still", "storage": "managed" })],
    )
    .unwrap()
    .receipt
    .refs["still"]
        .clone();
    let still = json!({ "id": still, "revision": f.video.state().assets[&still].current_revision });
    let v1 = track(&f.video, "V1");
    let sticker = |asset: &Value, motion: &Value| {
        json!({
            "type": "sticker", "trackId": v1, "span": { "fromFrame": 100, "durationFrames": 30 },
            "place": {}, "sticker": { "source": "asset" }, "assetRef": asset, "motionRef": motion,
        })
    };
    // 图片贴纸不能挂动作轨；角色的动作轨不能是图片
    for (asset, motion, key) in [
        (&still, &motion, "engine.stickerMotionOnlyPuppet"),
        (&package, &still, "engine.stickerMotionKind"),
    ] {
        let refused = apply(
            &mut f.video,
            "cmd_bad",
            vec![json!({ "type": "insertItems", "sequenceId": s, "items": [sticker(asset, motion)] })],
        )
        .unwrap_err();
        assert_eq!(refused.code, "INVALID_OPERATION", "{refused:?}");
        assert_eq!(refused.message_ref.as_ref().map(|m| m.key.as_str()), Some(key), "{refused:?}");
    }
}

#[test]
fn a_new_dub_swaps_only_the_motion_track() {
    let mut f = fixture();
    let s = seq(&f.video);
    let before = item(&f.video, &f.host);
    fs::write(f.root.join("dub2.json"), puppet::testing::talking_track(2.0)).unwrap();
    let committed = apply(
        &mut f.video,
        "cmd_dub",
        vec![
            json!({ "type": "importAsset", "path": f.root.join("dub2.json"), "ref": "dub2", "storage": "managed" }),
            json!({ "type": "replaceItemAsset", "sequenceId": s, "itemId": f.host, "assetImportRef": "dub2" }),
        ],
    )
    .unwrap();
    let after = item(&f.video, &f.host);
    assert_eq!(after["assetRef"], before["assetRef"]);
    assert_ne!(after["motionRef"], before["motionRef"]);
    let swaps = serde_json::to_value(&committed.receipt.impact).unwrap()["assetSwaps"].clone();
    assert_eq!(swaps[0]["previousAssetRef"], before["motionRef"]);
    assert_eq!(swaps[0]["assetRef"], after["motionRef"]);
}
