//! 改名为「视频」之前的目录布局（`movie.db`、`movie.lock`、`baocut.movie`）在打开时就地升级一次。

#![allow(clippy::result_large_err)]

use std::fs;
use std::path::{Path, PathBuf};

use editor_semantics::Rate;
use serde_json::json;
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

fn tx(video: &Video, command_id: &str, operation: serde_json::Value) -> VideoTransaction {
    VideoTransaction {
        command_id: command_id.into(),
        expected_revision: video.revision(),
        label: None,
        operations: vec![operation],
        actor: user(),
        task_id: None,
    }
}

/// 把当前布局的目录倒回旧布局：与升级相反的表、列、JSON 键与格式标识，再把文件改回旧名。
fn downgrade(dir: &Path) {
    let conn = rusqlite::Connection::open(dir.join("video.db")).unwrap();
    let back = |column: &str| {
        format!(
            "replace(replace(replace({column}, '\"videoId\":', '\"movieId\":'), '\"videoRevision\":', '\"movieRevision\":'), '\"kind\":\"video\"', '\"kind\":\"movie\"')"
        )
    };
    let mut sql = String::from("ALTER TABLE videos RENAME TO movies;\n");
    for table in [
        "entities",
        "document_versions",
        "asset_versions",
        "bundle_versions",
        "dependency_edges",
        "transactions",
        "outbox",
    ] {
        sql += &format!("ALTER TABLE {table} RENAME COLUMN video_id TO movie_id;\n");
    }
    sql += "UPDATE entities SET kind = 'movie' WHERE kind = 'video';\n";
    sql += &format!("UPDATE entities SET body = {};\n", back("body"));
    sql += &format!("UPDATE receipts SET body = {};\n", back("body"));
    sql += &format!("UPDATE outbox SET body = {};\n", back("body"));
    sql += &format!("UPDATE undo_records SET changes = {};\n", back("changes"));
    sql += "UPDATE meta SET value = 'baocut.movie' WHERE key = 'format';\n";
    conn.execute_batch(&sql).unwrap();
    let legacy: i64 = conn
        .query_row("SELECT count(*) FROM outbox WHERE body LIKE '%\"movieId\":%'", [], |r| r.get(0))
        .unwrap();
    assert!(legacy > 0, "倒回之后事件里是旧的键");
    conn.close().unwrap();
    fs::rename(dir.join("video.db"), dir.join("movie.db")).unwrap();
    fs::rename(dir.join("video.lock"), dir.join("movie.lock")).unwrap();
}

#[test]
fn a_movie_db_directory_is_upgraded_in_place_on_open() {
    let dir = tempfile::tempdir().unwrap();
    let options = CreateOptions {
        name: "旧视频".into(),
        fps: Rate { num: 30, den: 1 },
        width: 1920,
        height: 1080,
    };
    let mut video = Video::create(dir.path(), &options, &ffprobe()).unwrap();
    video
        .apply(&tx(&video, "cmd_rename", json!({ "type": "renameVideo", "name": "改过名" })))
        .unwrap();
    video
        .apply(&tx(&video, "cmd_ckpt", json!({ "type": "createCheckpoint", "name": "定稿前" })))
        .unwrap();
    let snapshot = video.snapshot();
    let history = video.history(10).unwrap();
    let events = video.events_after(0, 10).unwrap();
    let receipt = video.find_receipt("cmd_rename").unwrap().unwrap();
    drop(video);
    downgrade(dir.path());

    let mut video = Video::open(dir.path(), OpenMode::Write, &ffprobe()).unwrap();
    for name in ["movie.db", "movie.db-wal", "movie.db-shm", "movie.lock"] {
        assert!(!dir.path().join(name).exists(), "{name} 已改名");
    }
    assert!(dir.path().join("video.db").is_file() && dir.path().join("video.lock").is_file());
    assert_eq!(video.snapshot(), snapshot);
    assert_eq!(video.snapshot().format, "baocut.video");
    assert_eq!(video.history(10).unwrap(), history);
    assert_eq!(video.events_after(0, 10).unwrap(), events);
    assert_eq!(video.find_receipt("cmd_rename").unwrap(), Some(receipt));

    // 撤销记录里的实体种类也升级了：撤销两步，名字回到原来的。
    for step in ["cmd_undo_1", "cmd_undo_2"] {
        let request = UndoRequest {
            command_id: step.into(),
            target: UndoTarget::Undo,
            expected_revision: None,
            actor: user(),
        };
        video.undo(&request).unwrap();
    }
    assert_eq!(video.snapshot().name, "旧视频");
    assert!(video.snapshot().checkpoints.is_empty());
    drop(video);

    // 已经升级过的目录照常打开。
    assert_eq!(
        Video::open(dir.path(), OpenMode::ReadOnly, &ffprobe()).unwrap().snapshot().name,
        "旧视频"
    );
}
