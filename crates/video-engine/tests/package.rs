//! 便携包导入（视频格式规范 §8）：解开的包建成新视频，内容、修订号与文档、素材的各个版本都接上；
//! 摘要不符、版本更新、引用不全的包被拒绝，且不留下建了一半的目录。不需要 ffprobe。

#![allow(clippy::result_large_err)]

use std::fs;
use std::path::{Path, PathBuf};

use editor_semantics::Rate;
use serde_json::{Value, json};
use video_engine::model::{Actor, ActorKind, AssetStorage};
use video_engine::package::{PACKAGE_SNAPSHOT, import_package, package_asset_path, package_document_path};
use video_engine::{CreateOptions, OpenMode, Video, VideoTransaction};

fn ffprobe() -> PathBuf {
    PathBuf::from("ffprobe-不需要")
}

fn apply(video: &mut Video, command_id: &str, operations: Vec<Value>) {
    let transaction = VideoTransaction {
        command_id: command_id.into(),
        expected_revision: video.revision(),
        label: None,
        label_ref: None,
        operations,
        actor: Actor {
            kind: ActorKind::User,
            id: "user_local".into(),
        },
        task_id: None,
    };
    video.apply(&transaction).expect("提交");
}

fn place() -> Value {
    json!({ "x": 50, "y": 50, "w": 50 })
}

/// 一个有收纳的矢量图、代码包目录、两版转写、字幕与文字实例的视频。
fn source_video(root: &Path) -> Video {
    let svg = root.join("logo.svg");
    fs::write(&svg, "<svg xmlns='http://www.w3.org/2000/svg'/>").unwrap();
    let bundle = root.join("scene");
    fs::create_dir_all(bundle.join("assets")).unwrap();
    fs::write(bundle.join("index.html"), "<html></html>").unwrap();
    fs::write(bundle.join("assets/icon.svg"), "<svg/>").unwrap();
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
            json!({ "type": "importAsset", "path": bundle, "bundle": { "engine": "browser", "entry": "index.html" } }),
            json!({ "type": "putDocument", "kind": "speech", "ref": "speech", "body": { "words": [{ "id": "w1", "text": "你好" }] } }),
        ],
    );
    let speech = video.state().documents.keys().next().unwrap().clone();
    apply(
        &mut video,
        "cmd_doc2",
        vec![json!({ "type": "putDocument", "documentId": speech, "kind": "speech", "body": { "words": [] } })],
    );
    let text = json!({
        "type": "text", "trackRef": "top", "span": { "fromFrame": 0, "durationFrames": 60 }, "place": place(),
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
    video
}

/// 按 Runtime 写包的方式把视频摊成一个解开的包目录（素材都已收纳）。
fn write_package(video: &Video, out: &Path) {
    fs::create_dir_all(out).unwrap();
    let snapshot = video.snapshot();
    fs::write(out.join(PACKAGE_SNAPSHOT), serde_json::to_string(&snapshot).unwrap()).unwrap();
    for (id, record) in &snapshot.documents {
        for revision in record.revisions.keys() {
            let path = out.join(package_document_path(id, revision));
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, video.document_text(id, revision).unwrap()).unwrap();
        }
    }
    for (id, asset) in &snapshot.assets {
        for (revision, version) in &asset.revisions {
            assert!(matches!(version.storage, AssetStorage::Managed));
            let from = video.resolve_asset(id, Some(revision)).unwrap().path;
            let to = out.join(package_asset_path(&version.content_hash, &version.media_type));
            copy_any(&from, &to);
        }
    }
}

fn copy_any(from: &Path, to: &Path) {
    if from.is_dir() {
        fs::create_dir_all(to).unwrap();
        for entry in fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            copy_any(&entry.path(), &to.join(entry.file_name()));
        }
    } else {
        fs::create_dir_all(to.parent().unwrap()).unwrap();
        fs::copy(from, to).unwrap();
    }
}

/// 去掉视频自身的 ID，比较其余的内容。
fn content(video: &Video) -> Value {
    let mut value = serde_json::to_value(video.snapshot()).unwrap();
    value.as_object_mut().unwrap().remove("id");
    value
}

#[test]
fn a_package_becomes_a_new_video_with_the_same_content_and_versions() {
    let root = tempfile::tempdir().unwrap();
    let source = source_video(root.path());
    let package = root.path().join("包");
    write_package(&source, &package);

    let target = root.path().join("项目").join("导入的视频");
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    let imported = import_package(&target, &package, Some("proj_1"), &ffprobe()).expect("导入");
    assert_ne!(imported.id(), source.id(), "新视频有新的 videoId");
    assert_eq!(content(&imported), content(&source));
    assert_eq!(imported.revision(), source.revision());
    for (id, record) in &source.state().documents {
        for revision in record.revisions.keys() {
            assert_eq!(
                imported.document_text(id, revision).unwrap(),
                source.document_text(id, revision).unwrap()
            );
        }
    }
    for (id, asset) in &source.state().assets {
        let resolved = imported.resolve_asset(id, Some(&asset.current_revision)).unwrap();
        assert_eq!(resolved.storage, "managed");
        assert!(resolved.path.starts_with(&target), "素材收进了新视频的目录");
    }
    let project = imported.project_id().unwrap();
    assert_eq!(project.as_deref(), Some("proj_1"));

    // 重新打开：存储里的版本都在，下一次编辑接着包里的修订号。
    let id = imported.id().to_string();
    drop(imported);
    let mut reopened = Video::open(&target, OpenMode::Write, &ffprobe()).unwrap();
    assert_eq!(reopened.id(), id);
    assert_eq!(content(&reopened), content(&source));
    let before: i64 = reopened.revision().parse().unwrap();
    apply(
        &mut reopened,
        "cmd_after",
        vec![json!({ "type": "createCheckpoint", "name": "导入之后" })],
    );
    assert_eq!(reopened.revision(), (before + 1).to_string());
}

#[test]
fn a_tampered_or_newer_package_is_rejected_and_leaves_nothing() {
    let root = tempfile::tempdir().unwrap();
    let source = source_video(root.path());
    let package = root.path().join("包");
    write_package(&source, &package);
    let target = root.path().join("导入的视频");

    // 文档正文被改过。
    let (doc_id, record) = source.state().documents.iter().next().unwrap();
    let doc_path = package.join(package_document_path(doc_id, &record.current_revision));
    let original = fs::read_to_string(&doc_path).unwrap();
    fs::write(&doc_path, original.replace("[]", "[1]")).unwrap();
    let err = import_package(&target, &package, None, &ffprobe()).err().expect("应拒绝");
    assert_eq!(err.code, "PACKAGE_DIGEST_MISMATCH");
    assert!(!target.exists(), "失败时不留目录");
    fs::write(&doc_path, &original).unwrap();

    // 素材 bytes 被换过（长度不变）。
    let (_, asset) = source
        .state()
        .assets
        .iter()
        .find(|(_, a)| a.revisions.values().all(|r| r.media_type == "image/svg+xml"))
        .unwrap();
    let version = &asset.revisions[&asset.current_revision];
    let blob = package.join(package_asset_path(&version.content_hash, &version.media_type));
    let bytes = fs::read(&blob).unwrap();
    let mut changed = bytes.clone();
    changed[1] = b'X';
    fs::write(&blob, &changed).unwrap();
    let err = import_package(&target, &package, None, &ffprobe()).err().expect("应拒绝");
    assert_eq!(err.code, "PACKAGE_DIGEST_MISMATCH");
    assert!(!target.exists());
    fs::write(&blob, &bytes).unwrap();

    // 更新的格式版本。
    let snapshot_path = package.join(PACKAGE_SNAPSHOT);
    let text = fs::read_to_string(&snapshot_path).unwrap();
    let mut snapshot: Value = serde_json::from_str(&text).unwrap();
    snapshot["schemaVersion"] = json!(99);
    fs::write(&snapshot_path, snapshot.to_string()).unwrap();
    let err = import_package(&target, &package, None, &ffprobe()).err().expect("应拒绝");
    assert_eq!(err.code, "PACKAGE_VERSION_UNSUPPORTED");

    // 引用了包里没有的素材。
    let mut snapshot: Value = serde_json::from_str(&text).unwrap();
    let seq = snapshot["rootSequenceId"].as_str().unwrap().to_string();
    let items = snapshot["sequences"][&seq]["items"].as_array_mut().unwrap();
    let caption = items.iter_mut().find(|i| i["type"] == "caption").unwrap();
    caption["documentId"] = json!("doc_不存在");
    fs::write(&snapshot_path, snapshot.to_string()).unwrap();
    let err = import_package(&target, &package, None, &ffprobe()).err().expect("应拒绝");
    assert_eq!(err.code, "PACKAGE_INVALID");
    assert!(!target.exists());

    // 文档 ID 想借路径越出包目录。
    let mut snapshot: Value = serde_json::from_str(&text).unwrap();
    let docs = snapshot["documents"].as_object_mut().unwrap();
    let (key, mut doc) = docs.iter().next().map(|(k, v)| (k.clone(), v.clone())).unwrap();
    docs.remove(&key);
    doc["id"] = json!("../escape");
    docs.insert("../escape".into(), doc);
    let items = snapshot["sequences"][&seq]["items"].as_array_mut().unwrap();
    let caption = items.iter_mut().find(|i| i["type"] == "caption").unwrap();
    caption["documentId"] = json!("../escape");
    fs::write(&snapshot_path, snapshot.to_string()).unwrap();
    let err = import_package(&target, &package, None, &ffprobe()).err().expect("应拒绝");
    assert_eq!(err.code, "PACKAGE_INVALID");
    assert!(!target.exists());

    // 目标已经存在时什么也不做。
    fs::write(&snapshot_path, &text).unwrap();
    fs::create_dir_all(&target).unwrap();
    fs::write(target.join("别人的文件"), "x").unwrap();
    let err = import_package(&target, &package, None, &ffprobe()).err().expect("应拒绝");
    assert_eq!(err.code, "INVALID_OPERATION");
    assert!(target.join("别人的文件").exists());
}

#[test]
fn scene_resource_dependencies_survive_package_and_cannot_be_forged() {
    let root = tempfile::tempdir().unwrap();
    let source = source_video(root.path());
    let source_dir = source.dir().to_path_buf();
    drop(source);
    let mut source = Video::open(&source_dir, OpenMode::Write, Path::new("ffprobe")).unwrap();
    let png = root.path().join("badge.png");
    fs::write(&png, include_bytes!("../../caption-scene/tests/fixtures/badge.png")).unwrap();
    apply(
        &mut source,
        "cmd_image",
        vec![json!({"type":"importAsset","path":png,"storage":"managed"})],
    );
    let asset = source
        .state()
        .assets
        .values()
        .find(|a| a.revisions[&a.current_revision].media_type == "image/png")
        .unwrap();
    let asset_id = asset.id.clone();
    let revision = asset.current_revision.clone();
    let hash = asset.revisions[&revision].content_hash.clone();
    let mut style: Value = serde_json::from_str(include_str!("../../caption-scene/tests/fixtures/word-pop.json")).unwrap();
    style["scene"]["value"]["resources"] = json!([{"id":"badge","assetRef":{"id":asset_id,"revision":revision},"contentHash":hash}]);
    apply(
        &mut source,
        "cmd_style",
        vec![json!({"type":"putDocument","kind":"caption-style","body":style})],
    );
    let record = source.state().documents.values().find(|r| r.kind == "caption-style").unwrap();
    let id = record.id.clone();
    let rev = record.current_revision.clone();
    let package = root.path().join("package");
    write_package(&source, &package);
    let target = root.path().join("loaded");
    let loaded = import_package(&target, &package, None, &ffprobe()).unwrap();
    assert_eq!(loaded.state().documents[&id].revisions[&rev].asset_refs[0].id, asset_id);
    drop(loaded);
    let path = package.join(PACKAGE_SNAPSHOT);
    let mut snapshot: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    snapshot["documents"][&id]["revisions"][&rev]["assetRefs"] = json!([]);
    fs::write(&path, snapshot.to_string()).unwrap();
    assert!(import_package(&root.path().join("forged"), &package, None, &ffprobe()).is_err());
}

/// 录制清单（视频格式规范 §4.7）引用的指针轨与光标图片登记成文档版本的素材依赖，随便携包带走；清单与屏幕取景（§4.9）
/// 写入时整份核对。
#[test]
fn a_recording_manifest_carries_its_assets_and_is_checked_on_write() {
    let root = tempfile::tempdir().unwrap();
    let source = source_video(root.path());
    let source_dir = source.dir().to_path_buf();
    drop(source);
    let mut source = Video::open(&source_dir, OpenMode::Write, Path::new("ffprobe")).unwrap();
    let png = root.path().join("arrow.png");
    fs::write(&png, include_bytes!("../../caption-scene/tests/fixtures/badge.png")).unwrap();
    let pointer = root.path().join("pointer.json");
    fs::write(
        &pointer,
        r#"{"format":"baocut-pointer-track","version":1,"timescale":1000,"moves":[[0,0.5,0.5],[40,0.6,0.4]],"buttons":[[20,0,1],[90,0,0]],"cursors":[[0,"arrow"]]}"#,
    )
    .unwrap();
    apply(
        &mut source,
        "cmd_recorded",
        vec![
            json!({ "type": "importAsset", "path": png, "storage": "managed" }),
            json!({ "type": "importAsset", "path": pointer, "storage": "managed" }),
        ],
    );
    let reference = |media_type: &str| {
        let asset = source.state().assets.values().find(|a| a.revisions[&a.current_revision].media_type == media_type).unwrap();
        json!({ "id": asset.id, "revision": asset.current_revision })
    };
    let (cursor, track) = (reference("image/png"), reference("application/x-baocut-pointer-track+json"));
    let manifest = |role: &str| {
        json!({
            "schema": "baocut.recording/1", "timescale": 1000, "clock": "recording",
            "recorder": { "name": "test" }, "duration": "2000",
            "segments": [{ "id": "s0", "t0": "0", "t1": "2000" }],
            "streams": [{ "id": "s0-pointer", "role": role, "segmentId": "s0", "assetRef": track, "start": "0" }],
            "pointer": { "mode": "separate", "cursors": [{ "id": "arrow", "assetRef": cursor, "hotspot": { "x": 0.1, "y": 0.1 } }] }
        })
    };
    let refuse = |video: &mut Video, command_id: &str, operation: Value| {
        let transaction = VideoTransaction {
            command_id: command_id.into(),
            expected_revision: video.revision(),
            label: None,
            label_ref: None,
            operations: vec![operation],
            actor: Actor { kind: ActorKind::User, id: "user_local".into() },
            task_id: None,
        };
        video.apply(&transaction).expect_err("拒绝")
    };
    // 指针轨素材不能当麦克风；段没有铺满录制的也不收。
    refuse(&mut source, "cmd_wrong_kind", json!({ "type": "putDocument", "kind": "recording", "body": manifest("microphone") }));
    let mut gap = manifest("pointer");
    gap["segments"][0]["t1"] = json!("1500");
    refuse(&mut source, "cmd_gap", json!({ "type": "putDocument", "kind": "recording", "body": gap }));

    apply(
        &mut source,
        "cmd_manifest",
        vec![json!({ "type": "putDocument", "kind": "recording", "ref": "rec", "body": manifest("pointer") })],
    );
    let record = source.state().documents.values().find(|r| r.kind == "recording").unwrap();
    let (id, rev) = (record.id.clone(), record.current_revision.clone());
    let refs: Vec<&str> = record.revisions[&rev].asset_refs.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(refs, [track["id"].as_str().unwrap(), cursor["id"].as_str().unwrap()]);

    let view = |scale: f64| {
        json!({
            "schema": "baocut.screen-view/1", "timescale": 1000, "clock": "recording", "solver": 1,
            "zooms": [{ "id": "z1", "t0": "200", "t1": "1800", "scale": scale, "focus": { "kind": "pointer" }, "origin": "auto" }],
            "pointer": { "size": 1.5 }
        })
    };
    refuse(
        &mut source,
        "cmd_view_bad",
        json!({ "type": "putDocument", "kind": "screen-view", "sourceDocument": { "documentId": id }, "body": view(1.0) }),
    );
    apply(
        &mut source,
        "cmd_view",
        vec![json!({ "type": "putDocument", "kind": "screen-view", "sourceDocument": { "documentId": id }, "body": view(2.0) })],
    );
    let view_id = source.state().documents.values().find(|r| r.kind == "screen-view").unwrap().id.clone();

    // 录制时间的取景要有清单作来源；种类与正文格式要配。
    let orphan = refuse(&mut source, "cmd_view_orphan", json!({ "type": "putDocument", "kind": "screen-view", "body": view(2.0) }));
    assert!(orphan.message.contains("recording-manifest-required"), "{}", orphan.message);
    refuse(&mut source, "cmd_view_kind", json!({ "type": "putDocument", "kind": "note", "sourceDocument": { "documentId": id }, "body": view(2.0) }));
    refuse(&mut source, "cmd_manifest_kind", json!({ "type": "putDocument", "kind": "recording", "body": { "schema": "note/1" } }));
    // 清单写一次不再改：同样的正文不产生新版本，改了的不收。
    apply(&mut source, "cmd_manifest_same", vec![json!({ "type": "putDocument", "documentId": id, "kind": "recording", "body": manifest("pointer") })]);
    assert_eq!(source.state().documents[&id].current_revision, rev);
    let mut longer = manifest("pointer");
    longer["recorder"]["name"] = json!("other");
    let changed = refuse(&mut source, "cmd_manifest_changed", json!({ "type": "putDocument", "documentId": id, "kind": "recording", "body": longer }));
    assert!(changed.message.contains("cannot change"), "{}", changed.message);

    // 光标录进了画面的录制：可以跟着指针取景，不能写另画的光标。同一笔事务里刚写的清单也读得到。
    let mut baked = manifest("pointer");
    baked["pointer"] = json!({ "mode": "baked" });
    let both = |body: Value| {
        vec![
            json!({ "type": "putDocument", "kind": "recording", "ref": "baked", "body": baked }),
            json!({ "type": "putDocument", "kind": "screen-view", "sourceDocument": { "ref": "baked" }, "body": body }),
        ]
    };
    let styled = VideoTransaction {
        command_id: "cmd_baked_styled".into(),
        expected_revision: source.revision(),
        label: None,
        label_ref: None,
        operations: both(view(2.0)),
        actor: Actor { kind: ActorKind::User, id: "user_local".into() },
        task_id: None,
    };
    let styled = source.apply(&styled).expect_err("光标录进了画面，不能另画");
    assert!(styled.message.contains("pointer"), "{}", styled.message);
    let mut plain = view(2.0);
    plain.as_object_mut().unwrap().remove("pointer");
    apply(&mut source, "cmd_baked_plain", both(plain.clone()));
    // 改已有的取景文档：来源沿用记录里的，清单的鼠标模式照样核对。
    apply(
        &mut source,
        "cmd_view_patch",
        vec![json!({ "type": "patchDocument", "documentId": view_id, "changes": [{ "path": ["pointer", "size"], "value": 2.0 }] })],
    );
    let baked_view = source
        .state()
        .documents
        .values()
        .find(|r| r.kind == "screen-view" && r.id != view_id)
        .unwrap()
        .id
        .clone();
    let patched = refuse(
        &mut source,
        "cmd_baked_patch",
        json!({ "type": "patchDocument", "documentId": baked_view, "changes": [{ "path": ["pointer"], "value": { "size": 2.0 } }] }),
    );
    assert!(patched.message.contains("baocut.screen-view/1") && patched.message.contains("pointer"), "{}", patched.message);
    let rewritten = refuse(&mut source, "cmd_view_rewrite", json!({ "type": "putDocument", "documentId": baked_view, "kind": "screen-view", "body": view(2.0) }));
    assert!(rewritten.message.contains("baocut.screen-view/1") && rewritten.message.contains("pointer"), "{}", rewritten.message);
    // 不带来源重写同一份文档：来源沿用记录里的清单，正文合规就收。
    plain["zooms"][0]["scale"] = json!(3.0);
    apply(&mut source, "cmd_view_rewrite_plain", vec![json!({ "type": "putDocument", "documentId": baked_view, "kind": "screen-view", "body": plain })]);

    let package = root.path().join("package");
    write_package(&source, &package);
    let loaded = import_package(&root.path().join("loaded"), &package, None, &ffprobe()).unwrap();
    assert_eq!(loaded.state().documents[&id].revisions[&rev].asset_refs.len(), 2);
    assert!(loaded.state().documents.values().any(|r| r.kind == "screen-view"));
    drop(loaded);
    let path = package.join(PACKAGE_SNAPSHOT);
    let mut snapshot: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    snapshot["documents"][&id]["revisions"][&rev]["assetRefs"] = json!([]);
    fs::write(&path, snapshot.to_string()).unwrap();
    assert!(import_package(&root.path().join("forged"), &package, None, &ffprobe()).is_err());
}
