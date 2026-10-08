//! `blobs/` 的 GC（`Video::gc_blobs`，架构设计 §5.2、§5.5）：库里任何记录（素材的全部版本、撤销记录、当前实体）
//! 还提到的 blob 留着，没有引用的删掉；staging 里过了宽限期的删掉、新鲜的留着；不像 blob 的条目不碰。

#![allow(clippy::result_large_err)]

use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use editor_semantics::Rate;
use serde_json::{Value, json};
use video_engine::gc::STAGING_GRACE;
use video_engine::import::blob_rel_path;
use video_engine::model::{Actor, ActorKind};
use video_engine::{CreateOptions, OpenMode, UndoRequest, UndoTarget, Video, VideoTransaction};

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
        name: "GC".into(),
        fps: Rate { num: 30, den: 1 },
        width: 1920,
        height: 1080,
    };
    Video::create(dir, &options, &ffprobe()).expect("新建视频")
}

fn apply(video: &mut Video, command_id: &str, operations: Vec<Value>) -> video_engine::Committed {
    let transaction = VideoTransaction {
        command_id: command_id.into(),
        expected_revision: video.revision(),
        label: None,
        operations,
        actor: user(),
        task_id: None,
    };
    video.apply(&transaction).unwrap()
}

fn undo(video: &mut Video, command_id: &str, transaction_id: &str) {
    video
        .undo(&UndoRequest {
            command_id: command_id.into(),
            target: UndoTarget::Transaction(transaction_id.into()),
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
}

fn import_svg(video: &mut Video, root: &Path, name: &str, storage: &str) -> String {
    let path = root.join(format!("{name}.svg"));
    fs::write(
        &path,
        format!(r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><title>{name}</title></svg>"#),
    )
    .unwrap();
    let op = json!({ "type": "importAsset", "path": path, "ref": "i", "storage": storage });
    apply(video, &format!("cmd_import_{name}"), vec![op]).receipt.refs["i"].clone()
}

fn import_bundle(video: &mut Video, root: &Path, name: &str) -> String {
    let dir = root.join(name);
    fs::create_dir_all(dir.join("lib")).unwrap();
    fs::write(dir.join("index.html"), format!("<html><body>{name}</body></html>")).unwrap();
    fs::write(dir.join("lib").join("main.js"), format!("console.log('{name}')")).unwrap();
    let manifest = json!({
        "engine": "browser", "entry": "index.html",
        "intrinsic": { "width": 1920, "height": 1080, "fps": { "num": 30, "den": 1 }, "durationFrames": 60 },
    });
    let op = json!({ "type": "importAsset", "path": dir, "ref": "b", "bundle": manifest });
    apply(video, &format!("cmd_bundle_{name}"), vec![op]).receipt.refs["b"].clone()
}

/// 素材当前版本在视频目录里的 blob 路径（受管理时才在）。
fn blob_of(video: &Video, asset_id: &str) -> PathBuf {
    let asset = &video.state().assets[asset_id];
    let rev = &asset.revisions[&asset.current_revision];
    video.dir().join(blob_rel_path(&rev.content_hash, &rev.media_type))
}

fn age(path: &Path, by: Duration) {
    let past = SystemTime::now() - by;
    File::open(path).unwrap().set_modified(past).unwrap();
}

#[test]
fn referenced_blobs_survive_and_orphans_go() {
    let root = tempfile::tempdir().unwrap();
    let mut video = new_video(&root.path().join("m"));

    // 一个受管理的素材，删掉后又撤销；另一个删掉不撤销：两者的版本记录都还在，blob 都留着。
    let kept = import_svg(&mut video, root.path(), "kept", "managed");
    let removed = import_svg(&mut video, root.path(), "removed", "managed");
    let kept_blob = blob_of(&video, &kept);
    let removed_blob = blob_of(&video, &removed);
    let remove_kept = apply(
        &mut video,
        "cmd_remove_kept",
        vec![json!({ "type": "removeAssets", "assetIds": [kept] })],
    );
    undo(&mut video, "cmd_undo_remove_kept", &remove_kept.receipt.transaction_id);
    apply(
        &mut video,
        "cmd_remove_removed",
        vec![json!({ "type": "removeAssets", "assetIds": [removed] })],
    );
    assert!(!video.state().assets.contains_key(&removed));

    // 链接后收进来：版本记录写着 linked，实体里才是 managed。blob 必须留着。
    let collected = import_svg(&mut video, root.path(), "collected", "linked");
    apply(
        &mut video,
        "cmd_collect",
        vec![json!({ "type": "collectAssets", "assetIds": [collected] })],
    );
    let collected_blob = blob_of(&video, &collected);
    assert!(collected_blob.is_file());

    // 两个代码包（目录素材），删掉其中一个：都留着。
    let bundle_a = import_bundle(&mut video, root.path(), "bundle-a");
    let bundle_b = import_bundle(&mut video, root.path(), "bundle-b");
    let bundle_a_dir = blob_of(&video, &bundle_a);
    let bundle_b_dir = blob_of(&video, &bundle_b);
    apply(
        &mut video,
        "cmd_remove_bundle",
        vec![json!({ "type": "removeAssets", "assetIds": [bundle_b] })],
    );

    // 崩溃留下的孤儿：一个文件 blob、一个目录 blob。还有一个不归视频管理的文件。
    let blobs = video.dir().join("blobs");
    let orphan_file = blobs.join(format!("{}.png", "1".repeat(64)));
    fs::write(&orphan_file, b"orphan bytes").unwrap();
    let orphan_tree = blobs.join("2".repeat(64));
    fs::create_dir_all(orphan_tree.join("sub")).unwrap();
    fs::write(orphan_tree.join("index.html"), b"12345").unwrap();
    fs::write(orphan_tree.join("sub").join("a.js"), b"123").unwrap();
    let stray = blobs.join("notes.txt");
    fs::write(&stray, b"user notes").unwrap();

    // staging：过期的文件与目录（目录按最新的后代算）删掉；新鲜的、深处有新文件的目录留着。
    let staging = blobs.join(".staging");
    let old_file = staging.join("import_old");
    fs::write(&old_file, b"half written").unwrap();
    age(&old_file, Duration::from_secs(2 * 3600));
    let old_tree = staging.join("tree_old");
    fs::create_dir_all(old_tree.join("deep")).unwrap();
    fs::write(old_tree.join("deep").join("x.js"), b"x").unwrap();
    age(&old_tree.join("deep").join("x.js"), Duration::from_secs(2 * 3600));
    age(&old_tree.join("deep"), Duration::from_secs(2 * 3600));
    age(&old_tree, Duration::from_secs(2 * 3600));
    let fresh_file = staging.join("import_fresh");
    fs::write(&fresh_file, b"being written").unwrap();
    let busy_tree = staging.join("tree_busy");
    fs::create_dir_all(busy_tree.join("deep")).unwrap();
    fs::write(busy_tree.join("deep").join("y.js"), b"y").unwrap();
    age(&busy_tree, Duration::from_secs(2 * 3600));

    let report = video.gc_blobs(STAGING_GRACE).unwrap();

    for path in [&kept_blob, &removed_blob, &collected_blob] {
        assert!(path.is_file(), "仍被引用的 {} 应留着", path.display());
    }
    for path in [&bundle_a_dir, &bundle_b_dir] {
        assert!(
            path.join("lib").join("main.js").is_file(),
            "仍被引用的代码包 {} 应留着",
            path.display()
        );
    }
    assert!(!orphan_file.exists() && !orphan_tree.exists());
    assert!(stray.is_file());
    assert!(!old_file.exists() && !old_tree.exists());
    assert!(fresh_file.is_file() && busy_tree.is_dir());
    assert!(staging.is_dir(), "staging 目录本身留着");

    let removed_paths: Vec<&str> = report.removed.iter().map(|r| r.path.as_str()).collect();
    assert_eq!(
        removed_paths,
        vec![format!("blobs/{}.png", "1".repeat(64)), format!("blobs/{}", "2".repeat(64))]
    );
    let staging_paths: Vec<&str> = report.staging_removed.iter().map(|r| r.path.as_str()).collect();
    assert_eq!(staging_paths, vec!["blobs/.staging/import_old", "blobs/.staging/tree_old"]);
    assert_eq!(report.freed_bytes, 12 + 5 + 3 + 12 + 1);
    assert_eq!(report.kept, 5);
    assert_eq!(report.staging_kept, 2);
    assert_eq!(report.skipped, vec!["blobs/notes.txt".to_string()]);
    assert!(report.failed.is_empty());

    // 撤销记录引用的素材还能放回来、bytes 还在。
    let resolved = video.resolve_asset(&kept, None).unwrap();
    assert!(resolved.path.is_file());

    // 再跑一次没有可删的。
    let again = video.gc_blobs(STAGING_GRACE).unwrap();
    assert!(again.removed.is_empty() && again.staging_removed.is_empty() && again.freed_bytes == 0);
}

#[test]
fn read_only_videos_are_not_collected() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("m");
    drop(new_video(&dir));
    let orphan = dir.join("blobs").join(format!("{}.png", "3".repeat(64)));
    fs::write(&orphan, b"x").unwrap();
    let reader = Video::open(&dir, OpenMode::ReadOnly, &ffprobe()).unwrap();
    assert_eq!(reader.gc_blobs(STAGING_GRACE).unwrap_err().code, "VIDEO_READ_ONLY");
    assert!(orphan.is_file());
}

#[cfg(unix)]
#[test]
fn a_blob_that_cannot_be_removed_is_reported_not_fatal() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let video = new_video(&root.path().join("m"));
    let tree = video.dir().join("blobs").join("4".repeat(64));
    fs::create_dir_all(tree.join("locked")).unwrap();
    fs::write(tree.join("locked").join("f"), b"f").unwrap();
    fs::set_permissions(tree.join("locked"), fs::Permissions::from_mode(0o500)).unwrap();
    let orphan = video.dir().join("blobs").join(format!("{}.png", "5".repeat(64)));
    fs::write(&orphan, b"x").unwrap();

    let report = video.gc_blobs(STAGING_GRACE).unwrap();
    fs::set_permissions(tree.join("locked"), fs::Permissions::from_mode(0o700)).unwrap();

    assert!(!orphan.exists(), "别的孤儿照常删掉");
    assert_eq!(report.failed.len(), 1);
    assert_eq!(report.failed[0].path, format!("blobs/{}", "4".repeat(64)));
}
