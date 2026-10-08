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
