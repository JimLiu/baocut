//! 素材的存放方式、文档与图文实例：链接与收纳、代码包目录、文档版本、按精确字段写入实例。
//! 需要探测的测试用手写的 wav；没有 ffprobe 时跳过并打印原因。

#![allow(clippy::result_large_err)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use editor_semantics::Rate;
use serde_json::{Value, json};
use video_engine::model::{Actor, ActorKind, AssetKind, AssetStorage, TimelineItem};
use video_engine::{CreateOptions, ErrorBody, OpenMode, UndoRequest, UndoTarget, Video, VideoTransaction};

fn ffprobe() -> PathBuf {
    PathBuf::from(std::env::var("BAOCUT_FFPROBE").unwrap_or_else(|_| "ffprobe".into()))
}

fn has_ffprobe() -> bool {
    let ok = Command::new(ffprobe()).arg("-version").output().is_ok_and(|o| o.status.success());
    if !ok {
        eprintln!("跳过：没有可用的 ffprobe");
    }
    ok
}

/// 8 kHz 单声道 16 位的静音 wav。
fn write_wav(path: &Path, seconds: u32) {
    let samples = 8000 * seconds;
    let data_len = samples * 2;
    let mut bytes = Vec::new();
    bytes.extend(b"RIFF");
    bytes.extend((36 + data_len).to_le_bytes());
    bytes.extend(b"WAVEfmt ");
    bytes.extend(16u32.to_le_bytes());
    bytes.extend(1u16.to_le_bytes());
    bytes.extend(1u16.to_le_bytes());
    bytes.extend(8000u32.to_le_bytes());
    bytes.extend(16000u32.to_le_bytes());
    bytes.extend(2u16.to_le_bytes());
    bytes.extend(16u16.to_le_bytes());
    bytes.extend(b"data");
    bytes.extend(data_len.to_le_bytes());
    bytes.resize(bytes.len() + data_len as usize, 0);
    fs::write(path, bytes).unwrap();
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

fn tx(video: &Video, command_id: &str, operations: Vec<Value>) -> VideoTransaction {
    VideoTransaction {
        command_id: command_id.into(),
        expected_revision: video.revision(),
        label: None,
        operations,
        actor: user(),
        task_id: None,
    }
}

fn apply(video: &mut Video, command_id: &str, operations: Vec<Value>) -> Result<video_engine::Committed, ErrorBody> {
    let transaction = tx(video, command_id, operations);
    video.apply(&transaction)
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

fn only_asset(video: &Video) -> String {
    video.state().assets.keys().next().unwrap().clone()
}

/// 元素模型的位置（百分比）：居中，宽占画布一半。
fn place() -> Value {
    json!({ "x": 50, "y": 50, "w": 50 })
}

#[test]
fn a_linked_asset_stays_where_it_is_and_can_be_collected_later() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("外部").join("logo.svg");
    fs::create_dir_all(source.parent().unwrap()).unwrap();
    fs::write(&source, "<svg xmlns='http://www.w3.org/2000/svg'/>").unwrap();
    let dir = root.path().join("视频");
    let mut video = new_video(&dir);

    let provenance = json!({ "origin": "user-import", "source": { "url": "https://example.com/logo" } });
    apply(
        &mut video,
        "cmd_link",
        vec![json!({ "type": "importAsset", "path": source, "storage": "linked", "provenance": provenance })],
    )
    .unwrap();
    let asset_id = only_asset(&video);
    let asset = video.state().assets[&asset_id].clone();
    let revision = &asset.revisions[&asset.current_revision];
    let AssetStorage::Linked { locator, frozen } = &revision.storage else {
        panic!("应是链接素材")
    };
    // 文件在项目目录里（没有项目标记时是视频目录的父目录）：记相对视频目录的路径。
    assert_eq!(locator.path, "../外部/logo.svg");
    assert!(!frozen && locator.modified_at.is_some());
    assert_eq!(revision.provenance.source, Some(json!({ "url": "https://example.com/logo" })));
    assert_eq!(
        fs::read_dir(dir.join("blobs")).unwrap().count(),
        1,
        "blobs 里只有 .staging：没有复制"
    );

    let resolved = video.resolve_asset(&asset_id, None).unwrap();
    assert_eq!((resolved.path.as_path(), resolved.storage), (source.as_path(), "linked"));

    // 文件换了内容（长度变了）：不拿别的 bytes 顶替。
    fs::write(&source, "<svg/>").unwrap();
    let changed = video.resolve_asset(&asset_id, None).unwrap_err();
    assert_eq!(
        (changed.code.as_str(), &changed.details["reason"]),
        ("ASSET_MISSING", &json!("changed"))
    );
    let refused = apply(
        &mut video,
        "cmd_collect_bad",
        vec![json!({ "type": "collectAssets", "assetIds": [asset_id] })],
    );
    assert_eq!(refused.unwrap_err().code, "ASSET_MISSING");
    fs::write(&source, "<svg xmlns='http://www.w3.org/2000/svg'/>").unwrap();

    // 收纳：复制进 blobs/，素材版本不变。
    let before = (asset.current_revision.clone(), revision.content_hash.clone());
    let collected = apply(
        &mut video,
        "cmd_collect",
        vec![json!({ "type": "collectAssets", "assetIds": [asset_id] })],
    )
    .unwrap();
    let asset = &video.state().assets[&asset_id];
    let revision = &asset.revisions[&asset.current_revision];
    assert_eq!(revision.storage, AssetStorage::Managed);
    assert_eq!((asset.current_revision.clone(), revision.content_hash.clone()), before);
    let resolved = video.resolve_asset(&asset_id, None).unwrap();
    assert!(resolved.path.starts_with(dir.join("blobs")) && resolved.storage == "managed");
    fs::remove_file(&source).unwrap();
    assert!(video.resolve_asset(&asset_id, None).is_ok(), "原文件删掉也不影响");

    // 撤销收纳：回到链接；原文件不在了，如实报告缺失。
    video
        .undo(&UndoRequest {
            command_id: "cmd_undo".into(),
            target: UndoTarget::Transaction(collected.receipt.transaction_id),
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
    let missing = video.resolve_asset(&asset_id, None).unwrap_err();
    assert_eq!(missing.details["reason"], json!("missing"));
}

/// `blobs/` 里除了 `.staging` 之外的条目：复制进来的 bytes。
fn collected_blobs(dir: &Path) -> Vec<String> {
    fs::read_dir(dir.join("blobs"))
        .map(|entries| {
            entries
                .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .filter(|name| name != ".staging")
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn a_file_is_linked_by_default_and_copied_only_when_asked() {
    let root = tempfile::tempdir().unwrap();
    let logo = root.path().join("logo.svg");
    fs::write(&logo, "<svg xmlns='http://www.w3.org/2000/svg'/>").unwrap();
    let data = root.path().join("data.json");
    fs::write(&data, r#"{"v":1}"#).unwrap();
    let dir = root.path().join("m");
    let mut video = new_video(&dir);

    // 不指定存放方式：留在原处，blobs/ 下没有新 bytes。
    let linked = apply(
        &mut video,
        "cmd_default",
        vec![json!({ "type": "importAsset", "path": logo, "ref": "logo" })],
    )
    .unwrap();
    let logo_id = linked.receipt.refs["logo"].clone();
    let asset = &video.state().assets[&logo_id];
    let AssetStorage::Linked { locator, frozen } = &asset.revisions[&asset.current_revision].storage else {
        panic!("默认应是链接素材")
    };
    assert_eq!((locator.path.as_str(), *frozen), ("../logo.svg", false));
    assert!(collected_blobs(&dir).is_empty(), "默认导入不复制 bytes");
    assert_eq!(video.resolve_asset(&logo_id, None).unwrap().storage, "linked");

    // 显式 managed：复制进 blobs/，原文件删掉也不影响。
    let managed = apply(
        &mut video,
        "cmd_managed",
        vec![json!({ "type": "importAsset", "path": data, "storage": "managed", "ref": "data" })],
    )
    .unwrap();
    let data_id = managed.receipt.refs["data"].clone();
    let asset = &video.state().assets[&data_id];
    assert_eq!(asset.revisions[&asset.current_revision].storage, AssetStorage::Managed);
    assert_eq!(collected_blobs(&dir).len(), 1);
    fs::remove_file(&data).unwrap();
    let resolved = video.resolve_asset(&data_id, None).unwrap();
    assert!(resolved.path.starts_with(dir.join("blobs")) && resolved.storage == "managed");
}

#[test]
fn a_directory_is_collected_by_default() {
    let root = tempfile::tempdir().unwrap();
    let bundle = root.path().join("scene");
    fs::create_dir_all(&bundle).unwrap();
    fs::write(bundle.join("index.html"), "<html></html>").unwrap();
    let dir = root.path().join("m");
    let mut video = new_video(&dir);

    // 相对路径的目录按默认要收进来，而收进来要绝对路径：拒绝，并提示可以显式链接。
    let relative = apply(
        &mut video,
        "cmd_relative",
        vec![json!({ "type": "importAsset", "path": "../scene" })],
    );
    assert_eq!(relative.unwrap_err().code, "INVALID_OPERATION");
    assert!(collected_blobs(&dir).is_empty());

    // 代码包没有原文件可以指向：不指定时收进视频。
    apply(&mut video, "cmd_bundle", vec![json!({ "type": "importAsset", "path": bundle })]).unwrap();
    let asset_id = only_asset(&video);
    let asset = &video.state().assets[&asset_id];
    let revision = &asset.revisions[&asset.current_revision];
    assert_eq!((asset.kind, &revision.storage), (AssetKind::Bundle, &AssetStorage::Managed));
    let hex = revision.content_hash.strip_prefix("sha256:").unwrap();
    assert!(dir.join("blobs").join(hex).join("index.html").is_file());

    // 显式链接的目录可以给相对路径。
    let other = root.path().join("other");
    fs::create_dir_all(&other).unwrap();
    fs::write(other.join("index.html"), "<html>2</html>").unwrap();
    let linked = apply(
        &mut video,
        "cmd_link",
        vec![json!({ "type": "importAsset", "path": "../other", "storage": "linked", "ref": "other" })],
    )
    .unwrap();
    let other_id = &linked.receipt.refs["other"];
    let asset = &video.state().assets[other_id];
    assert!(matches!(
        asset.revisions[&asset.current_revision].storage,
        AssetStorage::Linked { .. }
    ));
}

#[test]
fn a_video_opens_even_when_a_linked_asset_is_missing() {
    let root = tempfile::tempdir().unwrap();
    let away = root.path().join("away.json");
    fs::write(&away, r#"{"v":"away"}"#).unwrap();
    let kept = root.path().join("kept.json");
    fs::write(&kept, r#"{"v":"kept"}"#).unwrap();
    let dir = root.path().join("m");
    let mut video = new_video(&dir);
    let committed = apply(
        &mut video,
        "cmd_import",
        vec![
            json!({ "type": "importAsset", "path": away, "ref": "away" }),
            json!({ "type": "importAsset", "path": kept, "storage": "managed", "ref": "kept" }),
        ],
    )
    .unwrap();
    let (away_id, kept_id) = (committed.receipt.refs["away"].clone(), committed.receipt.refs["kept"].clone());
    let before = video.snapshot();
    drop(video);

    // 链接的文件不见了：视频照常打开，快照不变；这个素材标为缺失，别的素材不受影响，视频照样能编辑。
    fs::remove_file(&away).unwrap();
    let mut video = Video::open(&dir, OpenMode::Write, &ffprobe()).expect("缺了链接素材也能打开");
    assert_eq!(video.snapshot(), before);
    let missing = video.resolve_asset(&away_id, None).unwrap_err();
    assert_eq!(
        (missing.code.as_str(), &missing.details["reason"]),
        ("ASSET_MISSING", &json!("missing"))
    );
    assert_eq!(missing.details["path"], json!("../away.json"));
    assert_eq!(video.resolve_asset(&kept_id, None).unwrap().storage, "managed");
    // 缺失的素材不必等到取用时才知道：状态里列出它，收进视频的不在其中。
    let status = video.missing_assets();
    assert_eq!(status.len(), 1);
    assert_eq!(
        (status[0].asset_id.as_str(), status[0].reason.as_str(), status[0].path.as_deref()),
        (away_id.as_str(), "missing", Some("../away.json"))
    );
    apply(&mut video, "cmd_rename", vec![json!({ "type": "renameVideo", "name": "照常编辑" })]).unwrap();
}

#[test]
fn relinking_requires_the_same_bytes() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("a.json");
    fs::write(&source, r#"{"v":1}"#).unwrap();
    let mut video = new_video(&root.path().join("m"));
    apply(
        &mut video,
        "cmd_link",
        vec![json!({ "type": "importAsset", "path": source, "storage": "linked" })],
    )
    .unwrap();
    let asset_id = only_asset(&video);

    let moved = root.path().join("moved.json");
    fs::rename(&source, &moved).unwrap();
    assert_eq!(video.resolve_asset(&asset_id, None).unwrap_err().code, "ASSET_MISSING");
    let other = root.path().join("other.json");
    fs::write(&other, r#"{"v":2}"#).unwrap();
    let wrong = apply(
        &mut video,
        "cmd_wrong",
        vec![json!({ "type": "relinkAsset", "assetId": asset_id, "path": other })],
    );
    assert_eq!(wrong.unwrap_err().code, "INVALID_OPERATION");

    apply(
        &mut video,
        "cmd_relink",
        vec![json!({ "type": "relinkAsset", "assetId": asset_id, "path": moved })],
    )
    .unwrap();
    assert_eq!(video.resolve_asset(&asset_id, None).unwrap().path, moved);
    assert_eq!(video.state().assets[&asset_id].current_revision, "1", "换位置不是新版本");
}

#[test]
fn a_path_relative_to_the_video_survives_moving_the_project() {
    let root = tempfile::tempdir().unwrap();
    let project = root.path().join("项目");
    fs::create_dir_all(project.join("media")).unwrap();
    fs::write(project.join("media/data.json"), "{}").unwrap();
    let mut video = new_video(&project.join("片子"));
    // 显式复制进视频必须给绝对路径；相对路径只用于链接。
    let managed = apply(
        &mut video,
        "cmd_managed",
        vec![json!({ "type": "importAsset", "path": "../media/data.json", "storage": "managed" })],
    );
    assert_eq!(managed.unwrap_err().code, "INVALID_OPERATION");
    // 不指定存放方式：文件默认链接，相对路径走链接，定位原样记下。
    apply(
        &mut video,
        "cmd_link",
        vec![json!({ "type": "importAsset", "path": "../media/data.json" })],
    )
    .unwrap();
    let asset_id = only_asset(&video);
    let asset = &video.state().assets[&asset_id];
    let AssetStorage::Linked { locator, .. } = &asset.revisions[&asset.current_revision].storage else {
        panic!("默认应是链接素材")
    };
    assert_eq!(locator.path, "../media/data.json");
    drop(video);

    let moved = root.path().join("搬走的项目");
    fs::rename(&project, &moved).unwrap();
    let video = Video::open(&moved.join("片子"), OpenMode::Write, &ffprobe()).unwrap();
    let resolved = video.resolve_asset(&asset_id, None).unwrap();
    assert_eq!(
        fs::canonicalize(resolved.path).unwrap(),
        fs::canonicalize(moved.join("media/data.json")).unwrap()
    );
}

/// 给目录写上项目标记，让它成为项目目录（引擎只看标记在不在）。
fn mark_project(dir: &Path) {
    fs::create_dir_all(dir.join(".bcut")).unwrap();
    fs::write(dir.join(".bcut/project.json"), r#"{"format":"baocut.project"}"#).unwrap();
}

fn linked_path(video: &Video, asset_id: &str) -> String {
    let asset = &video.state().assets[asset_id];
    match &asset.revisions[&asset.current_revision].storage {
        AssetStorage::Linked { locator, .. } => locator.path.clone(),
        AssetStorage::Managed => panic!("应是链接素材"),
    }
}

#[test]
fn files_in_the_project_are_linked_relative_and_survive_moving_the_whole_project() {
    let root = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let project = root.path().join("项目");
    mark_project(&project);
    fs::create_dir_all(project.join("素材")).unwrap();
    fs::write(project.join("素材/a.json"), r#"{"v":"a"}"#).unwrap();
    let outside = elsewhere.path().join("b.json");
    fs::write(&outside, r#"{"v":"b"}"#).unwrap();
    // 视频在项目的子目录里：项目目录是父目录链上带标记的那一层，不是视频目录的父目录。
    let video_dir = project.join("视频").join("片子");
    let mut video = new_video(&video_dir);
    let committed = apply(
        &mut video,
        "cmd_import",
        vec![
            json!({ "type": "importAsset", "path": project.join("素材/./a.json"), "ref": "a" }),
            json!({ "type": "importAsset", "path": outside, "ref": "b" }),
        ],
    )
    .unwrap();
    let (a, b) = (committed.receipt.refs["a"].clone(), committed.receipt.refs["b"].clone());
    assert_eq!(linked_path(&video, &a), "../../素材/a.json");
    assert_eq!(linked_path(&video, &b), outside.to_string_lossy(), "项目外的文件记绝对路径");
    drop(video);

    // 整个项目目录搬走并改名：项目内的链接照样解析，项目外的绝对路径不受影响。
    let moved = root.path().join("搬走的项目");
    fs::rename(&project, &moved).unwrap();
    let video = Video::open(&moved.join("视频").join("片子"), OpenMode::Write, &ffprobe()).unwrap();
    assert_eq!(video.resolve_asset(&a, None).unwrap().path, moved.join("素材/a.json"));
    assert_eq!(video.resolve_asset(&b, None).unwrap().path, outside);
    assert!(video.missing_assets().is_empty());
}

#[test]
fn a_file_given_through_another_spelling_of_the_project_is_still_relative() {
    let root = tempfile::tempdir().unwrap();
    // 视频按真实路径打开（Runtime 就是这样），文件按另一种写法给出（macOS 的临时目录在 /var → /private/var 之下）。
    let real_root = fs::canonicalize(root.path()).unwrap();
    fs::write(root.path().join("c.json"), "{}").unwrap();
    let mut video = new_video(&real_root.join("m"));
    let committed = apply(
        &mut video,
        "cmd_import",
        vec![json!({ "type": "importAsset", "path": root.path().join("c.json"), "ref": "c" })],
    )
    .unwrap();
    assert_eq!(linked_path(&video, &committed.receipt.refs["c"]), "../c.json");
}

#[test]
fn a_relative_locator_that_leaves_the_project_is_refused() {
    let root = tempfile::tempdir().unwrap();
    let project = root.path().join("项目");
    mark_project(&project);
    fs::write(project.join("a.json"), r#"{"v":"a"}"#).unwrap();
    let mut video = new_video(&project.join("sub").join("片子"));
    apply(
        &mut video,
        "cmd_import",
        vec![json!({ "type": "importAsset", "path": project.join("a.json") })],
    )
    .unwrap();
    let asset_id = only_asset(&video);
    assert_eq!(linked_path(&video, &asset_id), "../../a.json");
    drop(video);

    // 只把视频目录拿到别处（没有项目标记，项目目录退为视频目录的父目录）：`../../a.json` 落到项目之外，
    // 即使那里恰好有一个同样内容的文件也不读。视频照常打开，状态里报告这个素材。
    let away = root.path().join("别处").join("x").join("y");
    fs::create_dir_all(&away).unwrap();
    fs::rename(project.join("sub").join("片子"), away.join("片子")).unwrap();
    fs::write(root.path().join("别处/x/a.json"), r#"{"v":"a"}"#).unwrap();
    let mut video = Video::open(&away.join("片子"), OpenMode::Write, &ffprobe()).expect("照常打开");
    let refused = video.resolve_asset(&asset_id, None).unwrap_err();
    assert_eq!(
        (refused.code.as_str(), &refused.details["reason"]),
        ("ASSET_MISSING", &json!("outside-project"))
    );
    let status = video.missing_assets();
    assert_eq!(
        status.iter().map(|m| (m.asset_id.as_str(), m.reason.as_str())).collect::<Vec<_>>(),
        vec![(asset_id.as_str(), "outside-project")]
    );
    // 收进视频同样不读项目外的文件。
    let collect = apply(
        &mut video,
        "cmd_collect",
        vec![json!({ "type": "collectAssets", "assetIds": [asset_id] })],
    );
    assert_eq!(collect.unwrap_err().details["reason"], json!("outside-project"));
    assert!(collected_blobs(&away.join("片子")).is_empty());

    // 显式重新链接到项目外的那个文件：记成绝对路径，可以解析（绝对路径的链接素材由媒体通道按类型把关）。
    apply(
        &mut video,
        "cmd_relink",
        vec![json!({ "type": "relinkAsset", "assetId": asset_id, "path": "../../a.json" })],
    )
    .unwrap();
    let absolute = root.path().join("别处/x/a.json");
    assert_eq!(linked_path(&video, &asset_id), absolute.to_string_lossy());
    assert_eq!(video.resolve_asset(&asset_id, None).unwrap().path, absolute);
    assert!(video.missing_assets().is_empty());
}

#[test]
fn relinking_normalizes_the_locator_like_importing() {
    let root = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let project = root.path().join("项目");
    mark_project(&project);
    let outside = elsewhere.path().join("d.json");
    fs::write(&outside, r#"{"v":"d"}"#).unwrap();
    let mut video = new_video(&project.join("片子"));
    apply(&mut video, "cmd_import", vec![json!({ "type": "importAsset", "path": outside })]).unwrap();
    let asset_id = only_asset(&video);
    assert_eq!(linked_path(&video, &asset_id), outside.to_string_lossy());

    // 文件挪进了项目：给绝对路径重新链接，记成相对视频目录的路径。
    fs::create_dir_all(project.join("media")).unwrap();
    let inside = project.join("media/d.json");
    fs::rename(&outside, &inside).unwrap();
    assert_eq!(video.missing_assets()[0].reason, "missing");
    apply(
        &mut video,
        "cmd_relink",
        vec![json!({ "type": "relinkAsset", "assetId": asset_id, "path": inside })],
    )
    .unwrap();
    assert_eq!(linked_path(&video, &asset_id), "../media/d.json");
    // 绕路的相对写法同样规范化。
    apply(
        &mut video,
        "cmd_relink_again",
        vec![json!({ "type": "relinkAsset", "assetId": asset_id, "path": "./../片子/../media/./d.json" })],
    )
    .unwrap();
    assert_eq!(linked_path(&video, &asset_id), "../media/d.json");
    let asset = &video.state().assets[&asset_id];
    let AssetStorage::Linked { locator, .. } = &asset.revisions[&asset.current_revision].storage else {
        panic!("应是链接素材")
    };
    assert!(locator.modified_at.is_some());
    assert_eq!(video.resolve_asset(&asset_id, None).unwrap().path, inside);
    assert_eq!(asset.current_revision, "1", "换位置不是新版本");
}

#[test]
fn a_directory_becomes_a_bundle_asset_used_by_a_composition_item() {
    let root = tempfile::tempdir().unwrap();
    let bundle = root.path().join("scene");
    fs::create_dir_all(bundle.join("assets")).unwrap();
    fs::write(bundle.join("index.html"), "<html></html>").unwrap();
    fs::write(bundle.join("assets/icon.svg"), "<svg/>").unwrap();
    fs::write(bundle.join("notes.txt"), "不属于代码包").unwrap();
    fs::write(bundle.join(".DS_Store"), "x").unwrap();
    let dir = root.path().join("m");
    let mut video = new_video(&dir);
    let s = seq(&video);
    let manifest = json!({ "engine": "browser", "entry": "index.html" });
    apply(
        &mut video,
        "cmd_bundle",
        vec![json!({ "type": "importAsset", "path": bundle, "storage": "linked", "ref": "scene",
                    "include": ["index.html", "assets"], "bundle": manifest })],
    )
    .unwrap();
    let asset_id = only_asset(&video);
    let asset = &video.state().assets[&asset_id];
    let revision = asset.revisions[&asset.current_revision].clone();
    assert_eq!(asset.kind, AssetKind::Bundle);
    assert_eq!(revision.tree.as_ref().unwrap().file_count, 2, "只收 include 里的文件，跳过隐藏文件");
    assert_eq!(revision.bundle, Some(manifest));
    assert_eq!(revision.byte_length, 13 + 6);

    let item = json!({
        "type": "composition", "trackId": track(&video, "V1"), "span": { "fromFrame": 0, "durationFrames": 90 },
        "place": place(),
        "source": { "kind": "bundle", "assetRef": { "id": asset_id, "revision": "1" } },
        "parameterValues": { "title": "你好" },
        "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
    });
    apply(
        &mut video,
        "cmd_item",
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": [item] })],
    )
    .unwrap();
    // 内置合成已去掉：进度条是独立的 progress 实例，不需要代码包。
    let progress = json!({
        "type": "progress", "trackId": track(&video, "V1"), "span": { "fromFrame": 90, "durationFrames": 30 },
        "place": { "y": 95, "w": 100 }, "progress": { "style": "bar" },
    });
    apply(
        &mut video,
        "cmd_progress",
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": [progress] })],
    )
    .unwrap();
    assert_eq!(video.state().items.len(), 2);

    // 目录内容不变时收纳成功，按内容地址放进 blobs/<sha256>/。
    apply(
        &mut video,
        "cmd_collect",
        vec![json!({ "type": "collectAssets", "assetIds": [asset_id] })],
    )
    .unwrap();
    let resolved = video.resolve_asset(&asset_id, None).unwrap();
    assert!(resolved.path.starts_with(dir.join("blobs")) && resolved.path.join("assets/icon.svg").is_file());
    assert!(!resolved.path.join("notes.txt").exists());
}

#[test]
fn documents_are_versioned_and_their_bodies_stay_out_of_the_snapshot() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("m");
    let mut video = new_video(&dir);
    let body = json!({ "timescale": 1000, "words": [{ "id": "w1", "text": "你好", "start": 0, "end": 400 }] });
    let created = apply(
        &mut video,
        "cmd_doc",
        vec![
            json!({ "type": "putDocument", "kind": "speech", "name": "转写", "language": "zh", "ref": "speech",
                    "body": body, "summary": { "wordCount": 1 } }),
            json!({ "type": "putDocument", "kind": "translation", "language": "en", "sourceDocument": { "ref": "speech" },
                    "body": { "units": [] } }),
        ],
    )
    .unwrap();
    assert_eq!(created.receipt.created_ids.len(), 2);
    assert_eq!(created.receipt.refs.len(), 1, "回执带回 ref 对应的 ID");
    let snapshot = serde_json::to_value(video.snapshot()).unwrap();
    let speech_id = created.receipt.refs["speech"].clone();
    assert_eq!(video.state().documents[&speech_id].kind, "speech");
    assert_eq!(
        snapshot["documents"][&speech_id]["revisions"]["1"]["summary"],
        json!({ "wordCount": 1 })
    );
    assert!(!snapshot.to_string().contains("你好"), "正文不进快照");
    let translation = video.state().documents.values().find(|d| d.kind == "translation").unwrap();
    assert_eq!(translation.source_document_id.as_deref(), Some(speech_id.as_str()));
    assert_eq!(video.document(&speech_id, None).unwrap().body, body);

    // 内容没变不产生新版本；改了才有版本 2，旧版本仍然读得到。
    let same = json!({ "type": "putDocument", "documentId": speech_id, "kind": "speech", "body": body });
    let unchanged = apply(&mut video, "cmd_same", vec![same]).unwrap();
    assert!(unchanged.receipt.updated_ids.is_empty());
    let fixed = json!({ "timescale": 1000, "words": [{ "id": "w1", "text": "您好", "start": 0, "end": 400 }] });
    let update = json!({ "type": "putDocument", "documentId": speech_id, "kind": "speech", "body": fixed });
    let updated = apply(&mut video, "cmd_fix", vec![update]).unwrap();
    assert_eq!(video.state().documents[&speech_id].current_revision, "2");
    assert_eq!(video.document(&speech_id, Some("1")).unwrap().body, body);
    assert_eq!(video.document(&speech_id, None).unwrap().body, fixed);
    let wrong_kind = json!({ "type": "putDocument", "documentId": speech_id, "kind": "caption", "body": {} });
    assert_eq!(
        apply(&mut video, "cmd_kind", vec![wrong_kind]).unwrap_err().code,
        "INVALID_OPERATION"
    );

    // 撤销改字：当前版本回到 1。重新打开之后文档仍在。
    video
        .undo(&UndoRequest {
            command_id: "cmd_undo".into(),
            target: UndoTarget::Transaction(updated.receipt.transaction_id),
            expected_revision: None,
            actor: user(),
        })
        .unwrap();
    assert_eq!(video.document(&speech_id, None).unwrap().body, body);

    // 撤销后再改：撤销掉的版本 2 正文还在库里，新版本编成 3，不复用 2（否则读出来是撤销前的旧正文）。
    let again = json!({ "timescale": 1000, "words": [{ "id": "w1", "text": "大家好", "start": 0, "end": 400 }] });
    let redo_edit = json!({ "type": "putDocument", "documentId": speech_id, "kind": "speech", "body": again });
    apply(&mut video, "cmd_again", vec![redo_edit]).unwrap();
    assert_eq!(video.state().documents[&speech_id].current_revision, "3");
    assert_eq!(video.document(&speech_id, None).unwrap().body, again);
    drop(video);
    let reopened = Video::open(&dir, OpenMode::Write, &ffprobe()).unwrap();
    assert_eq!(reopened.state().documents.len(), 2);
    assert_eq!(reopened.document(&speech_id, None).unwrap().body, again);
    assert_eq!(reopened.document(&speech_id, Some("1")).unwrap().body, body);
}

#[test]
fn speech_and_translation_bodies_check_the_added_fields() {
    let root = tempfile::tempdir().unwrap();
    let mut video = new_video(&root.path().join("m"));
    let speech = json!({
        "schema": "baocut.speech/1", "clock": "source-asset", "timescale": 1000, "engine": null,
        "speakers": [], "sentences": null, "chapters": [],
        "words": [{ "id": "w1", "text": "你", "start": 0, "end": 200 }, { "id": "w2", "text": "好", "start": 200, "end": 400, "glue": true }],
        "userBreaks": { "w2": "no-break", "gone": "break" }, "autoBreaks": { "default": { "w2": "break" } },
        "layoutProfileId": "default", "paragraphBreaks": ["w1"], "stages": { "asr": "2:w1:w2:abc" }
    });
    apply(
        &mut video,
        "cmd_ok",
        vec![json!({ "type": "putDocument", "kind": "speech", "body": speech })],
    )
    .unwrap();

    let mut bad = speech.clone();
    bad["userBreaks"] = json!({ "w2": "nobreak" });
    let err = apply(
        &mut video,
        "cmd_bad",
        vec![json!({ "type": "putDocument", "kind": "speech", "body": bad })],
    )
    .unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");

    let translation = |split: Value| {
        json!({
            "schema": "baocut.translation/2", "language": "en",
            "sourceBasis": { "speechRef": { "id": "d", "revision": "1" }, "sequenceId": "q", "scopeLineage": [], "editViewHash": "sha256:0" },
            "units": [{ "id": "t-s-w1", "sourceSentenceId": "s-w1", "sourceFingerprint": "", "naturalText": "Hello", "status": "draft",
                        "alignment": { "basis": "natural", "correspondence": "sentence", "blocks": [], "sourceWordIds": ["w1", "w2"],
                                       "textHash": "sha256:0", "split": split } }]
        })
    };
    let ok = translation(json!({ "mode": "independent", "wordAnchored": false, "pieces": [{ "text": "Hello" }] }));
    apply(
        &mut video,
        "cmd_t_ok",
        vec![json!({ "type": "putDocument", "kind": "translation", "body": ok })],
    )
    .unwrap();
    let bad = translation(json!({ "mode": "manyToOne", "wordAnchored": false, "pieces": [{ "text": "Hello" }] }));
    let err = apply(
        &mut video,
        "cmd_t_bad",
        vec![json!({ "type": "putDocument", "kind": "translation", "body": bad })],
    )
    .unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");

    // 不认得的 schema 与没有 schema 的正文照旧不校验。
    let loose = json!({ "schema": "baocut.speech/9", "userBreaks": 3 });
    apply(
        &mut video,
        "cmd_loose",
        vec![json!({ "type": "putDocument", "kind": "speech", "body": loose })],
    )
    .unwrap();
}

#[test]
fn text_shape_and_caption_items_are_stored_and_edited_on_the_frame_grid() {
    let root = tempfile::tempdir().unwrap();
    let mut video = new_video(&root.path().join("m"));
    let s = seq(&video);
    let v1 = track(&video, "V1");
    apply(
        &mut video,
        "cmd_setup",
        vec![
            json!({ "type": "addTrack", "sequenceId": s, "kind": "subtitle" }),
            json!({ "type": "putDocument", "kind": "caption", "body": { "cues": [] } }),
        ],
    )
    .unwrap();
    let subtitle = track(&video, "S1");
    let doc = video.state().documents.keys().next().unwrap().clone();
    let text = json!({
        "type": "text", "trackId": v1, "span": { "fromFrame": 0, "durationFrames": 60 }, "place": place(),
        "text": "标题", "style": { "fontFamily": "PingFang SC", "fontSize": 64, "color": "#FFFFFF" },
        "role": "screentext", "extensions": { "baocut.import": { "sourceId": "el-5" } },
    });
    let shape = json!({
        "type": "shape", "trackId": v1, "span": { "fromFrame": 60, "durationFrames": 30 }, "place": { "x": 50, "y": 50, "w": 50, "opacity": 0.5 },
        "shape": { "shape": "ellipse", "fill": "#FFD646" },
    });
    let caption = json!({ "type": "caption", "trackId": subtitle, "span": { "fromFrame": 0, "durationFrames": 90 }, "documentId": doc });
    apply(
        &mut video,
        "cmd_items",
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": [text, shape, caption] })],
    )
    .unwrap();
    let items: Vec<&TimelineItem> = video.state().items.values().map(|i| &i.value).collect();
    let text_item = items.iter().find(|i| matches!(i, TimelineItem::Text(_))).unwrap();
    assert_eq!(text_item.base().role.as_deref(), Some("screentext"));
    assert_eq!(text_item.base().extensions["baocut.import"], json!({ "sourceId": "el-5" }));
    let text_id = text_item.base().id.clone();

    // 写入的实例与原生实例一样可以拆分与裁切。
    apply(
        &mut video,
        "cmd_split",
        vec![json!({ "type": "splitItem", "sequenceId": s, "itemId": text_id, "at": { "unit": "frames", "value": 20 }, "alignment": "exact-frame" })],
    )
    .unwrap();
    assert_eq!(video.state().items[&text_id].value.span().unwrap().duration_frames, 20);
    assert_eq!(video.state().items.len(), 4);

    // 不认识的字段、不存在的文档、错的轨道、重叠、自带 ID、与种类不搭配的 role（v2 的 overlay 只给图片、视频、贴纸）都拒绝，视频不变。
    let before = video.revision();
    let cases = [
        json!({ "type": "text", "trackId": v1, "span": { "fromFrame": 200, "durationFrames": 10 }, "place": place(),
                "text": "x", "style": {}, "glow": true }),
        json!({ "type": "caption", "trackId": subtitle, "span": { "fromFrame": 200, "durationFrames": 10 }, "documentId": "doc_none" }),
        json!({ "type": "caption", "trackId": v1, "span": { "fromFrame": 200, "durationFrames": 10 }, "documentId": doc }),
        json!({ "type": "shape", "trackId": v1, "span": { "fromFrame": 70, "durationFrames": 10 }, "place": place(),
                "shape": { "shape": "rect" } }),
        json!({ "type": "shape", "id": "item_mine", "trackId": v1, "span": { "fromFrame": 300, "durationFrames": 10 },
                "place": place(), "shape": { "shape": "rect" } }),
        json!({ "type": "text", "trackId": v1, "span": { "fromFrame": 400, "durationFrames": 10 }, "place": place(),
                "text": "x", "role": "overlay" }),
    ];
    let codes: Vec<String> = cases
        .into_iter()
        .enumerate()
        .map(|(n, item)| {
            let op = json!({ "type": "insertItems", "sequenceId": s, "items": [item] });
            apply(&mut video, &format!("cmd_bad_{n}"), vec![op]).unwrap_err().code
        })
        .collect();
    assert_eq!(
        codes,
        [
            "INVALID_OPERATION",
            "ENTITY_NOT_FOUND",
            "INVALID_OPERATION",
            "TIMELINE_OVERLAP",
            "INVALID_OPERATION",
            "INVALID_OPERATION"
        ]
    );
    assert_eq!(video.revision(), before);
}

#[test]
fn inserted_media_items_keep_exact_source_ranges_and_mix_settings() {
    if !has_ffprobe() {
        return;
    }
    let root = tempfile::tempdir().unwrap();
    let wav = root.path().join("vo.wav");
    write_wav(&wav, 2);
    let mut video = new_video(&root.path().join("m"));
    let s = seq(&video);
    apply(
        &mut video,
        "cmd_link",
        vec![json!({ "type": "importAsset", "path": wav, "storage": "linked" })],
    )
    .unwrap();
    let asset_id = only_asset(&video);
    let a1 = track(&video, "A1");
    let audio = |from: i64, source_in: &str, length: &str| {
        json!({
            "type": "audio", "trackId": a1, "assetRef": { "id": asset_id, "revision": "1" },
            "fromFrame": from, "subframeOffset": { "ticks": "1", "timescale": 100 },
            "playDuration": { "ticks": length, "timescale": 1000 },
            "timeMap": { "kind": "linear", "sourceIn": { "ticks": source_in, "timescale": 1000 }, "rate": { "num": 1, "den": 1 } },
            "mix": { "volume": 0.25, "fadeIn": { "ticks": "3", "timescale": 10 },
                     "envelope": [{ "at": { "ticks": "0", "timescale": 1 }, "volume": 0.15 }] },
            "role": "sfx",
        })
    };
    let ok = json!({ "type": "insertItems", "sequenceId": s, "items": [audio(30, "500", "1200")] });
    apply(&mut video, "cmd_audio", vec![ok]).unwrap();
    let TimelineItem::Audio(item) = &video.state().items.values().next().unwrap().value else {
        panic!("应是音频")
    };
    assert_eq!(
        (item.mix.volume, item.mix.envelope.len(), item.mix.fade_in.is_some()),
        (0.25, 1, true)
    );
    assert_eq!(video.snapshot().sequences[&s].items.len(), 1);

    // 预渲染替身必须是视频素材：音频不行。
    let bundle = root.path().join("scene");
    fs::create_dir_all(&bundle).unwrap();
    fs::write(bundle.join("index.html"), "<html></html>").unwrap();
    let imported = apply(
        &mut video,
        "cmd_bundle",
        vec![json!({ "type": "importAsset", "path": bundle, "ref": "scene", "bundle": { "engine": "browser", "entry": "index.html" } })],
    )
    .unwrap();
    let bundle_id = imported.receipt.refs["scene"].clone();
    let composition = json!({
        "type": "composition", "trackId": track(&video, "V1"), "span": { "fromFrame": 0, "durationFrames": 30 },
        "place": place(), "source": { "kind": "bundle", "assetRef": { "id": bundle_id, "revision": "1" } },
        "parameterValues": {}, "prerender": { "id": asset_id, "revision": "1" }, "audio": { "enabled": true, "volume": 1.0 },
        "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
    });
    let not_video = json!({ "type": "insertItems", "sequenceId": s, "items": [composition] });
    assert_eq!(
        apply(&mut video, "cmd_prerender", vec![not_video]).unwrap_err().code,
        "INVALID_OPERATION"
    );

    // 源区间超出素材（2 秒）：不默默截断。
    let past_end = json!({ "type": "insertItems", "sequenceId": s, "items": [audio(120, "1500", "1200")] });
    assert_eq!(
        apply(&mut video, "cmd_past", vec![past_end]).unwrap_err().code,
        "SOURCE_TIME_OUT_OF_RANGE"
    );
}

/// 音画联动组（规范 §3.7「声音」）：组里的音频实例是合成声音单独放的一份，合成自己的声音必须关着；插入、打开声音、
/// 把音频放进组都核对，不在组里的音频不受影响。
#[test]
fn a_composition_linked_with_audio_items_keeps_its_own_sound_off() {
    if !has_ffprobe() {
        return;
    }
    let root = tempfile::tempdir().unwrap();
    let wav = root.path().join("vo.wav");
    write_wav(&wav, 2);
    let bundle = root.path().join("scene");
    fs::create_dir_all(&bundle).unwrap();
    fs::write(bundle.join("index.html"), "<html></html>").unwrap();
    let mut video = new_video(&root.path().join("m"));
    let s = seq(&video);
    let imported = apply(
        &mut video,
        "cmd_assets",
        vec![
            json!({ "type": "importAsset", "path": wav, "storage": "linked", "ref": "vo" }),
            json!({ "type": "importAsset", "path": bundle, "ref": "scene", "bundle": { "engine": "browser", "entry": "index.html" } }),
        ],
    )
    .unwrap();
    let (vo, scene) = (imported.receipt.refs["vo"].clone(), imported.receipt.refs["scene"].clone());
    let (v1, a1) = (track(&video, "V1"), track(&video, "A1"));
    let composition = |sounding: bool| {
        json!({
            "type": "composition", "trackId": v1, "span": { "fromFrame": 0, "durationFrames": 60 },
            "place": place(), "source": { "kind": "bundle", "assetRef": { "id": scene, "revision": "1" } },
            "parameterValues": {}, "audio": { "enabled": sounding, "volume": 1.0 }, "linkGroupId": "narration",
            "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
        })
    };
    let audio = |from: i64, group: Option<&str>| {
        let mut item = json!({
            "type": "audio", "trackId": a1, "assetRef": { "id": vo, "revision": "1" },
            "fromFrame": from, "subframeOffset": { "ticks": "0", "timescale": 1 }, "playDuration": { "ticks": "1", "timescale": 2 },
            "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
            "mix": { "volume": 1.0 }, "role": "dub",
        });
        if let Some(group) = group {
            item["linkGroupId"] = json!(group);
        }
        item
    };
    let insert = |items: Vec<Value>| json!({ "type": "insertItems", "sequenceId": s, "items": items });

    // 合成出声、组里又放了配音：两处同时出声，整笔拒绝。
    let refused = apply(
        &mut video,
        "cmd_both",
        vec![insert(vec![composition(true), audio(0, Some("narration"))])],
    )
    .unwrap_err();
    assert_eq!(refused.code, "INVALID_OPERATION");
    assert!(refused.message.contains("narration"), "{}", refused.message);
    assert!(video.state().items.is_empty());

    // 合成的声音关着：组里的配音照常写入，联动组原样保存。
    apply(
        &mut video,
        "cmd_linked",
        vec![insert(vec![
            composition(false),
            audio(0, Some("narration")),
            audio(30, Some("narration")),
        ])],
    )
    .unwrap();
    let id_of = |video: &Video, kind: &str| -> Vec<String> {
        video
            .state()
            .items
            .values()
            .filter(|p| {
                matches!(
                    (&p.value, kind),
                    (TimelineItem::Composition(_), "composition") | (TimelineItem::Audio(_), "audio")
                )
            })
            .map(|p| p.value.base().id.clone())
            .collect()
    };
    let composition_id = id_of(&video, "composition").remove(0);
    for placed in video.state().items.values() {
        assert_eq!(placed.value.base().link_group_id.as_deref(), Some("narration"));
    }

    // 把合成的声音打开：拒绝，点名这个合成。
    let unmute = json!({ "type": "setAudioMix", "sequenceId": s, "itemId": composition_id, "muted": false });
    let refused = apply(&mut video, "cmd_unmute", vec![unmute]).unwrap_err();
    assert_eq!(
        (refused.code.as_str(), refused.entity_ids.clone()),
        ("INVALID_OPERATION", vec![composition_id.clone()])
    );

    // 不在组里的音频（音乐、音效）不受影响；别的组也不受影响。
    apply(
        &mut video,
        "cmd_free",
        vec![insert(vec![audio(60, None), audio(90, Some("other"))])],
    )
    .unwrap();
    assert_eq!(id_of(&video, "audio").len(), 4);
}

#[test]
fn new_tracks_and_documents_are_referenced_within_one_transaction() {
    let root = tempfile::tempdir().unwrap();
    let mut video = new_video(&root.path().join("m"));
    let s = seq(&video);
    let body = json!({ "schema": "baocut.caption/1", "clock": "sequence", "timescale": 1000, "cues": [] });
    let caption = json!({ "type": "caption", "trackRef": "subs", "documentRef": "cues", "span": { "fromFrame": 0, "durationFrames": 90 } });
    let text = json!({
        "type": "text", "trackRef": "top", "span": { "fromFrame": 0, "durationFrames": 60 }, "place": place(),
        "text": "标题", "style": {},
    });
    let committed = apply(
        &mut video,
        "cmd_refs",
        vec![
            json!({ "type": "addTrack", "sequenceId": s, "kind": "subtitle", "ref": "subs" }),
            json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "name": "文字", "ref": "top" }),
            json!({ "type": "putDocument", "kind": "caption", "ref": "cues", "body": body }),
            json!({ "type": "insertItems", "sequenceId": s, "items": [caption, text] }),
        ],
    )
    .unwrap();
    let refs = &committed.receipt.refs;
    let items: Vec<&TimelineItem> = video.state().items.values().map(|i| &i.value).collect();
    let TimelineItem::Caption(c) = items.iter().find(|i| matches!(i, TimelineItem::Caption(_))).unwrap() else {
        panic!()
    };
    assert_eq!(c.base.track_id, refs["subs"]);
    assert_eq!(c.document_id, refs["cues"]);
    let text_item = items.iter().find(|i| matches!(i, TimelineItem::Text(_))).unwrap();
    assert_eq!(text_item.base().track_id, refs["top"]);
    assert_eq!(video.state().tracks[&refs["top"]].value.name.as_deref(), Some("文字"));

    // 没有这个 ref、ID 与 ref 一起给、同一笔修改里重名，都拒绝。
    let unknown = json!({ "type": "text", "trackRef": "nope", "span": { "fromFrame": 0, "durationFrames": 30 }, "place": place(),
        "text": "x", "style": {} });
    let err = apply(
        &mut video,
        "cmd_unknown",
        vec![json!({ "type": "insertItems", "sequenceId": s, "items": [unknown] })],
    )
    .unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");
    let both = json!({ "type": "text", "trackRef": "v", "trackId": refs["top"], "span": { "fromFrame": 60, "durationFrames": 30 },
        "place": place(), "text": "x", "style": {} });
    let err = apply(
        &mut video,
        "cmd_both",
        vec![
            json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "ref": "v" }),
            json!({ "type": "insertItems", "sequenceId": s, "items": [both] }),
        ],
    )
    .unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");
    let err = apply(
        &mut video,
        "cmd_twice",
        vec![
            json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "ref": "v" }),
            json!({ "type": "addTrack", "sequenceId": s, "kind": "visual", "ref": "v" }),
        ],
    )
    .unwrap_err();
    assert_eq!(err.code, "INVALID_OPERATION");
}

#[test]
fn imported_assets_and_new_tracks_are_referenced_by_audio_items_and_ducking_in_one_transaction() {
    if !has_ffprobe() {
        return;
    }
    let root = tempfile::tempdir().unwrap();
    let wav = root.path().join("dub.wav");
    write_wav(&wav, 1);
    let mut video = new_video(&root.path().join("m"));
    let s = seq(&video);
    let a1 = track(&video, "A1");
    let audio = |track_ref: &str, import_ref: &str| {
        json!({
            "type": "audio", "trackRef": track_ref, "assetImportRef": import_ref,
            "fromFrame": 15, "subframeOffset": { "ticks": "1", "timescale": 100 },
            "playDuration": { "ticks": "8000", "timescale": 8000 },
            "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
            "mix": { "volume": 1.0 }, "role": "dub", "extensions": { "baocut.dub": { "groupId": "g1" } },
        })
    };
    let committed = apply(
        &mut video,
        "cmd_dub",
        vec![
            json!({ "type": "importAsset", "path": wav, "storage": "managed", "ref": "u1" }),
            json!({ "type": "addTrack", "sequenceId": s, "kind": "audio", "name": "配音", "ref": "dub" }),
            json!({ "type": "insertItems", "sequenceId": s, "items": [audio("dub", "u1")] }),
            json!({ "type": "setDucking", "sequenceId": s, "trigger": { "kind": "items", "trackRefs": ["dub"] }, "target": { "trackIds": [a1] } }),
        ],
    )
    .unwrap();
    let refs = &committed.receipt.refs;
    let TimelineItem::Audio(item) = &video.state().items.values().next().unwrap().value else {
        panic!("应是音频")
    };
    assert_eq!(item.base.track_id, refs["dub"]);
    assert_eq!(item.asset_ref.id, refs["u1"]);
    assert_eq!(item.asset_ref.revision, video.state().assets[&refs["u1"]].current_revision);
    assert_eq!(item.base.role.as_deref(), Some("dub"));
    let rule = &video.state().ducking.values().next().unwrap().value;
    assert_eq!(rule.trigger.group().unwrap().track_ids, vec![refs["dub"].clone()]);
    assert_eq!(rule.target.track_ids, vec![a1.clone()]);

    // 没有这个导入、assetRef 与 assetImportRef 一起给、没有这个轨道的 ref：都拒绝，视频不变。
    let mut both = audio("dub", "u1");
    both["assetRef"] = json!({ "id": refs["u1"], "revision": "1" });
    let before = video.revision();
    for (id, operations) in [
        (
            "cmd_no_import",
            vec![
                json!({ "type": "addTrack", "sequenceId": s, "kind": "audio", "ref": "dub" }),
                json!({ "type": "insertItems", "sequenceId": s, "items": [audio("dub", "nope")] }),
            ],
        ),
        (
            "cmd_both_refs",
            vec![
                json!({ "type": "importAsset", "path": wav, "storage": "managed", "ref": "u1" }),
                json!({ "type": "addTrack", "sequenceId": s, "kind": "audio", "ref": "dub" }),
                json!({ "type": "insertItems", "sequenceId": s, "items": [both.clone()] }),
            ],
        ),
        (
            "cmd_no_track_ref",
            vec![
                json!({ "type": "setDucking", "sequenceId": s, "trigger": { "kind": "items", "trackRefs": ["nope"] }, "target": { "trackIds": [a1] } }),
            ],
        ),
    ] {
        assert_eq!(apply(&mut video, id, operations).unwrap_err().code, "INVALID_OPERATION", "{id}");
    }
    assert_eq!(video.revision(), before);
}
