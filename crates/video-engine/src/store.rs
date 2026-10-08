//! VideoStore：视频目录里的 `video.db`（架构设计 §5.1）。只有持有写锁的引擎写它。
//!
//! 一笔事务的实体、版本、幂等记录、回执、撤销记录与 outbox 在同一个 SQLite 事务里提交（§5.2）。
//! 提交时用 `revision` 与 `owner_generation` 做条件更新：旧的所有者即使还活着也写不进来。

use std::path::Path;

use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde_json::Value;

use crate::error::{EngineResult, ErrorBody, msg};
use crate::model::{AssetRevision, Id, SCHEMA_VERSION, VIDEO_FORMAT};
use crate::receipt::{HistoryEntry, TransactionReceipt, VideoEvent};
use crate::state::{EntityChange, EntityKind, VideoState};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  event_seq INTEGER NOT NULL,
  owner_generation INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entities (
  video_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  parent_id TEXT,
  revision INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (video_id, entity_id)
);
CREATE TABLE IF NOT EXISTS document_versions (
  video_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (video_id, document_id, revision)
);
CREATE TABLE IF NOT EXISTS asset_versions (
  video_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  media_type TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (video_id, asset_id, revision)
);
CREATE TABLE IF NOT EXISTS bundle_versions (
  video_id TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (video_id, bundle_id, revision)
);
CREATE TABLE IF NOT EXISTS dependency_edges (
  video_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  from_revision TEXT NOT NULL,
  to_id TEXT NOT NULL,
  to_revision TEXT NOT NULL,
  kind TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  actor TEXT NOT NULL,
  label TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  event_seq INTEGER NOT NULL,
  undo_of TEXT,
  undo_depth INTEGER NOT NULL,
  base_label TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  UNIQUE (video_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS receipts (transaction_id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS undo_records (
  transaction_id TEXT PRIMARY KEY,
  changes TEXT NOT NULL,
  undone_by TEXT
);
CREATE TABLE IF NOT EXISTS outbox (
  video_id TEXT NOT NULL,
  event_seq INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (video_id, event_seq)
);
"#;

/// 改名为「视频」之前的格式标识。
const LEGACY_FORMAT: &str = "baocut.movie";
/// 旧布局升级到当前格式：表与列改名；存下的 JSON（实体、回执、事件、撤销记录）里的键与实体种类改名。
/// JSON 字符串里的引号是转义过的，带引号的键只会匹配真正的键。文档正文是用户内容，不动。
const LEGACY_UPGRADE: &str = r#"
ALTER TABLE movies RENAME TO videos;
ALTER TABLE entities RENAME COLUMN movie_id TO video_id;
ALTER TABLE document_versions RENAME COLUMN movie_id TO video_id;
ALTER TABLE asset_versions RENAME COLUMN movie_id TO video_id;
ALTER TABLE bundle_versions RENAME COLUMN movie_id TO video_id;
ALTER TABLE dependency_edges RENAME COLUMN movie_id TO video_id;
ALTER TABLE transactions RENAME COLUMN movie_id TO video_id;
ALTER TABLE outbox RENAME COLUMN movie_id TO video_id;
UPDATE entities SET kind = 'video' WHERE kind = 'movie';
UPDATE entities SET body = replace(replace(replace(body, '"movieId":', '"videoId":'), '"movieRevision":', '"videoRevision":'), '"kind":"movie"', '"kind":"video"');
UPDATE receipts SET body = replace(replace(replace(body, '"movieId":', '"videoId":'), '"movieRevision":', '"videoRevision":'), '"kind":"movie"', '"kind":"video"');
UPDATE outbox SET body = replace(replace(replace(body, '"movieId":', '"videoId":'), '"movieRevision":', '"videoRevision":'), '"kind":"movie"', '"kind":"video"');
UPDATE undo_records SET changes = replace(replace(replace(changes, '"movieId":', '"videoId":'), '"movieRevision":', '"videoRevision":'), '"kind":"movie"', '"kind":"video"');
"#;

pub struct Store {
    conn: Connection,
}

/// 视频认领所属项目的结果（架构设计 §5.1；视频格式规范 §1.3）。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "outcome")]
pub enum ProjectClaim {
    /// 库里还没有所属项目（升级前的视频、刚新建的视频）：记下传入的项目，videoId 不变。
    Adopted,
    /// 已经属于这个项目。
    Unchanged,
    /// 属于另一个项目：这是副本，或被搬到了另一个项目。换成新的 videoId，旧的记进 `previousVideoIds`。
    #[serde(rename_all = "camelCase")]
    Reassigned { previous_video_id: Id, video_id: Id },
}

/// meta 表里所属项目与曾用 videoId 的键。它们不属于视频的修订内容：写它们不产生新版本，不进撤销历史。
const META_PROJECT_ID: &str = "projectId";
const META_PREVIOUS_VIDEO_IDS: &str = "previousVideoIds";

/// 一笔事务的撤销记录：逐实体的前后状态，以及是否已被撤销。
pub struct UndoRecord {
    pub changes: Vec<EntityChange>,
    pub undone_by: Option<Id>,
    /// 0 是正向修改，1 是撤销，2 是重做……
    pub undo_depth: i64,
    /// 正向修改的标签；撤销与重做在它前面加前缀。
    pub base_label: String,
}

/// 撤销栈上的一步。
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoStep {
    pub transaction_id: Id,
    pub label: String,
}

/// 一笔事务要写入的全部内容。
pub struct CommitRecord<'a> {
    pub video_id: &'a str,
    pub base_revision: i64,
    pub generation: i64,
    pub state: &'a VideoState,
    pub changes: &'a [EntityChange],
    pub touched_sequences: &'a [Id],
    pub new_asset_versions: Vec<(Id, AssetRevision)>,
    pub new_document_versions: &'a [DocumentBody],
    pub idempotency_key: &'a str,
    pub payload_hash: &'a str,
    pub receipt: &'a TransactionReceipt,
    pub event: &'a VideoEvent,
    pub undo_of: Option<&'a str>,
    pub undo_depth: i64,
    pub base_label: &'a str,
}

/// 一个文档版本的正文，与引用它的文档头在同一个 SQLite 事务里写入。
#[derive(Clone, Debug, PartialEq)]
pub struct DocumentBody {
    pub document_id: Id,
    pub revision: String,
    pub content_hash: String,
    pub body: String,
}

fn json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("能序列化")
}

impl Store {
    fn configure(conn: &Connection) -> EngineResult<()> {
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(())
    }

    /// 新建视频的数据库。调用方已持有写锁。
    pub fn create(path: &Path, state: &VideoState, now: &str) -> EngineResult<Store> {
        let mut conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        Store::configure(&conn)?;
        let tx = conn.transaction()?;
        tx.execute_batch(SCHEMA)?;
        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('format', ?1), ('schemaVersion', ?2)",
            params![VIDEO_FORMAT, SCHEMA_VERSION.to_string()],
        )?;
        tx.execute(
            "INSERT INTO videos (id, revision, event_seq, owner_generation, created_at, updated_at) VALUES (?1, 0, 0, 0, ?2, ?2)",
            params![state.id, now],
        )?;
        for (id, row) in state.entities() {
            tx.execute(
                "INSERT INTO entities (video_id, entity_id, kind, parent_id, revision, body) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
                params![state.id, id, row.kind.as_str(), row.parent, json(&row.body)],
            )?;
        }
        tx.commit()?;
        Ok(Store { conn })
    }

    /// 便携包导入（视频格式规范 §8）：刚用 [`Store::create`] 建好的库接上包里的修订号（视频与各个序列的），
    /// 并写入文档与素材的各个版本。
    pub fn import_versions(&mut self, state: &VideoState, documents: &[DocumentBody]) -> EngineResult<()> {
        let tx = self.conn.transaction()?;
        tx.execute("UPDATE videos SET revision = ?1 WHERE id = ?2", params![state.revision, state.id])?;
        tx.execute(
            "UPDATE entities SET revision = ?1 WHERE video_id = ?2",
            params![state.revision, state.id],
        )?;
        for (id, sequence) in &state.sequences {
            tx.execute(
                "UPDATE entities SET revision = ?1 WHERE video_id = ?2 AND entity_id = ?3",
                params![sequence.revision, state.id, id],
            )?;
        }
        for asset in state.assets.values() {
            for rev in asset.revisions.values() {
                tx.execute(
                    "INSERT INTO asset_versions (video_id, asset_id, revision, content_hash, byte_length, media_type, body)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        state.id,
                        asset.id,
                        rev.revision,
                        rev.content_hash,
                        rev.byte_length as i64,
                        rev.media_type,
                        json(rev)
                    ],
                )?;
            }
        }
        for doc in documents {
            tx.execute(
                "INSERT INTO document_versions (video_id, document_id, revision, content_hash, body) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![state.id, doc.document_id, doc.revision, doc.content_hash, doc.body],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// 在旧布局的数据库文件上就地升级到当前格式（调用方持有旧锁，随后改名）。已经升级过的什么也不做。
    pub fn upgrade_legacy(path: &Path) -> EngineResult<()> {
        let mut conn = Connection::open(path)?;
        Store::configure(&conn)?;
        let format: Option<String> = conn
            .query_row("SELECT value FROM meta WHERE key = 'format'", [], |r| r.get(0))
            .optional()
            .map_err(|_| ErrorBody::unsupported_video(msg!("engine.notBaocutVideo", "Not a BaoCut video")))?;
        match format.as_deref() {
            Some(LEGACY_FORMAT) => {
                let tx = conn.transaction()?;
                tx.execute_batch(LEGACY_UPGRADE)?;
                tx.execute("UPDATE meta SET value = ?1 WHERE key = 'format'", [VIDEO_FORMAT])?;
                tx.commit()?;
            }
            Some(VIDEO_FORMAT) => {}
            _ => return Err(ErrorBody::unsupported_video(msg!("engine.notBaocutVideo", "Not a BaoCut video"))),
        }
        // 关掉最后一个连接时 SQLite 把 WAL 合并回主文件，改名时只剩一个文件。
        conn.close().map_err(|(_, e)| e)?;
        Ok(())
    }

    pub fn open(path: &Path, read_only: bool) -> EngineResult<Store> {
        if !path.is_file() {
            return Err(ErrorBody::unsupported_video(msg!("engine.noVideoDb", "The directory has no video.db")));
        }
        let conn = if read_only {
            Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?
        } else {
            let conn = Connection::open(path)?;
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "synchronous", "FULL")?;
            conn
        };
        Store::configure(&conn)?;
        let store = Store { conn };
        store.check_format()?;
        Ok(store)
    }

    fn check_format(&self) -> EngineResult<()> {
        let get = |key: &str| -> EngineResult<Option<String>> {
            Ok(self
                .conn
                .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
                .optional()?)
        };
        let format = get("format").map_err(|_| ErrorBody::unsupported_video(msg!("engine.notBaocutVideo", "Not a BaoCut video")))?;
        if format.as_deref() != Some(VIDEO_FORMAT) {
            return Err(ErrorBody::unsupported_video(msg!("engine.notBaocutVideo", "Not a BaoCut video")));
        }
        let version = get("schemaVersion")?.unwrap_or_default();
        schema_version_supported(&version)
    }

    /// 读出视频的工作态与当前的所有者代。
    pub fn load(&self) -> EngineResult<(VideoState, i64)> {
        let (id, revision, event_seq, generation): (String, i64, i64, i64) = self
            .conn
            .query_row("SELECT id, revision, event_seq, owner_generation FROM videos LIMIT 1", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .optional()?
            .ok_or_else(|| ErrorBody::unsupported_video(msg!("engine.videoRecordMissing", "The video record is missing")))?;
        let mut state = VideoState {
            id: id.clone(),
            name: String::new(),
            root_sequence_id: String::new(),
            revision,
            event_seq,
            sequences: Default::default(),
            tracks: Default::default(),
            items: Default::default(),
            assets: Default::default(),
            documents: Default::default(),
            checkpoints: Default::default(),
            protections: Default::default(),
            transitions: Default::default(),
            markers: Default::default(),
            ducking: Default::default(),
        };
        let mut stmt = self
            .conn
            .prepare("SELECT entity_id, kind, parent_id, revision, body FROM entities WHERE video_id = ?1")?;
        let rows = stmt.query_map([&id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?;
        let mut sequence_revisions = Vec::new();
        for row in rows {
            let (entity_id, kind, parent, entity_revision, body) = row?;
            let kind = EntityKind::parse(&kind).ok_or_else(|| ErrorBody::unsupported_video(msg!("engine.unknownEntityKind", "Unknown entity kind {kind}", kind)))?;
            let body: Value =
                serde_json::from_str(&body).map_err(|e| ErrorBody::unsupported_video(msg!(
                    "engine.entityCorrupt",
                    "Entity {id} is corrupt: {error}",
                    id = entity_id,
                    error = e.to_string()
                )))?;
            state.put(&entity_id, kind, parent.as_deref(), Some(body))?;
            if kind == EntityKind::Sequence {
                sequence_revisions.push((entity_id, entity_revision));
            }
        }
        for (seq_id, rev) in sequence_revisions {
            if let Some(seq) = state.sequences.get_mut(&seq_id) {
                seq.revision = rev;
            }
        }
        state.id = id;
        Ok((state, generation))
    }

    /// 一个文档存过的最大版本号，含已撤销事务写下的版本（正文留在库里，供重做与历史读取）。
    /// 新版本要从它之上编号：复用一个已存在的号，`INSERT OR IGNORE` 会留下旧正文。
    pub fn max_document_revision(&self, video_id: &str, document_id: &str) -> EngineResult<u64> {
        let mut stmt = self
            .conn
            .prepare("SELECT revision FROM document_versions WHERE video_id = ?1 AND document_id = ?2")?;
        let revisions = stmt.query_map(params![video_id, document_id], |r| r.get::<_, String>(0))?;
        let mut max = 0;
        for revision in revisions {
            if let Ok(n) = revision?.parse::<u64>() {
                max = max.max(n);
            }
        }
        Ok(max)
    }

    /// 一个文档版本的正文（JSON 文本）。
    pub fn document_body(&self, video_id: &str, document_id: &str, revision: &str) -> EngineResult<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT body FROM document_versions WHERE video_id = ?1 AND document_id = ?2 AND revision = ?3",
                params![video_id, document_id, revision],
                |r| r.get(0),
            )
            .optional()?)
    }

    /// 取得写入权时递增所有者代（ownerGeneration，架构设计 §2.3）。
    pub fn bump_generation(&mut self, video_id: &str) -> EngineResult<i64> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "UPDATE videos SET owner_generation = owner_generation + 1 WHERE id = ?1",
            [video_id],
        )?;
        let generation = tx.query_row("SELECT owner_generation FROM videos WHERE id = ?1", [video_id], |r| r.get(0))?;
        tx.commit()?;
        Ok(generation)
    }

    /// 幂等记录：同一个 key 的载荷摘要与原回执。
    pub fn find_by_key(&self, video_id: &str, key: &str) -> EngineResult<Option<(String, TransactionReceipt)>> {
        let row: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT t.payload_hash, r.body FROM transactions t JOIN receipts r ON r.transaction_id = t.transaction_id
                 WHERE t.video_id = ?1 AND t.idempotency_key = ?2",
                params![video_id, key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        row.map(|(hash, body)| {
            let receipt = serde_json::from_str(&body).map_err(|e| ErrorBody::storage(msg!("engine.receiptCorrupt", "The receipt is corrupt: {error}", error = e.to_string())))?;
            Ok((hash, receipt))
        })
        .transpose()
    }

    pub fn undo_record(&self, transaction_id: &str) -> EngineResult<Option<UndoRecord>> {
        let row: Option<(String, Option<String>, i64, String)> = self
            .conn
            .query_row(
                "SELECT u.changes, u.undone_by, t.undo_depth, t.base_label FROM undo_records u JOIN transactions t ON t.transaction_id = u.transaction_id
                 WHERE u.transaction_id = ?1",
                [transaction_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;
        row.map(|(changes, undone_by, undo_depth, base_label)| {
            let changes = serde_json::from_str(&changes).map_err(|e| ErrorBody::storage(msg!("engine.undoRecordCorrupt", "The undo record is corrupt: {error}", error = e.to_string())))?;
            Ok(UndoRecord {
                changes,
                undone_by,
                undo_depth,
                base_label,
            })
        })
        .transpose()
    }

    /// 原子提交一笔事务。条件更新失败说明版本或所有者已经变了：整笔回滚。
    pub fn commit(&mut self, record: &CommitRecord<'_>) -> EngineResult<()> {
        let tx = self.conn.transaction()?;
        let state = record.state;
        let updated = tx.execute(
            "UPDATE videos SET revision = ?1, event_seq = ?2, updated_at = ?3
             WHERE id = ?4 AND revision = ?5 AND owner_generation = ?6",
            params![
                state.revision,
                state.event_seq,
                record.receipt.committed_at,
                record.video_id,
                record.base_revision,
                record.generation
            ],
        )?;
        if updated != 1 {
            return Err(ErrorBody::writer_unavailable(msg!(
                "engine.writerMoved",
                "Write access to the video has moved, or the revision was changed elsewhere"
            )));
        }
        let rows = state.entities();
        for change in record.changes {
            match rows.get(&change.id) {
                Some(row) => {
                    tx.execute(
                        "INSERT INTO entities (video_id, entity_id, kind, parent_id, revision, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                         ON CONFLICT (video_id, entity_id) DO UPDATE SET kind = ?3, parent_id = ?4, revision = ?5, body = ?6",
                        params![
                            record.video_id,
                            change.id,
                            row.kind.as_str(),
                            row.parent,
                            state.revision,
                            json(&row.body)
                        ],
                    )?;
                }
                None => {
                    tx.execute(
                        "DELETE FROM entities WHERE video_id = ?1 AND entity_id = ?2",
                        params![record.video_id, change.id],
                    )?;
                }
            }
        }
        for seq in record.touched_sequences {
            tx.execute(
                "UPDATE entities SET revision = ?1 WHERE video_id = ?2 AND entity_id = ?3",
                params![state.revision, record.video_id, seq],
            )?;
        }
        for (asset_id, rev) in &record.new_asset_versions {
            tx.execute(
                "INSERT OR IGNORE INTO asset_versions (video_id, asset_id, revision, content_hash, byte_length, media_type, body)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    record.video_id,
                    asset_id,
                    rev.revision,
                    rev.content_hash,
                    rev.byte_length as i64,
                    rev.media_type,
                    json(rev)
                ],
            )?;
        }
        for doc in record.new_document_versions {
            tx.execute(
                "INSERT OR IGNORE INTO document_versions (video_id, document_id, revision, content_hash, body)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![record.video_id, doc.document_id, doc.revision, doc.content_hash, doc.body],
            )?;
        }
        let receipt = record.receipt;
        tx.execute(
            "INSERT INTO transactions (transaction_id, video_id, idempotency_key, payload_hash, actor, label, base_revision, revision, event_seq, undo_of, undo_depth, base_label, committed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                receipt.transaction_id,
                record.video_id,
                record.idempotency_key,
                record.payload_hash,
                json(&receipt.actor),
                receipt.label,
                record.base_revision,
                state.revision,
                state.event_seq,
                record.undo_of,
                record.undo_depth,
                record.base_label,
                receipt.committed_at
            ],
        )?;
        tx.execute(
            "INSERT INTO receipts (transaction_id, body) VALUES (?1, ?2)",
            params![receipt.transaction_id, json(receipt)],
        )?;
        tx.execute(
            "INSERT INTO undo_records (transaction_id, changes, undone_by) VALUES (?1, ?2, NULL)",
            params![receipt.transaction_id, json(&record.changes)],
        )?;
        if let Some(original) = record.undo_of {
            let marked = tx.execute(
                "UPDATE undo_records SET undone_by = ?1 WHERE transaction_id = ?2 AND undone_by IS NULL",
                params![receipt.transaction_id, original],
            )?;
            if marked != 1 {
                return Err(ErrorBody::undo_unavailable(original, msg!("engine.alreadyUndone", "This change has already been undone")));
            }
        }
        tx.execute(
            "INSERT INTO outbox (video_id, event_seq, body) VALUES (?1, ?2, ?3)",
            params![record.video_id, state.event_seq, json(record.event)],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// 某个操作者的撤销栈（命令与协议规范 §8.2「按顺序撤销」）：
    /// 撤销 = 最新的、未被撤销的正向修改或重做；重做 = 最新的正向修改之后、未被重做的撤销。
    /// 只看这个操作者自己的事务：用户的撤销不抹掉智能体的修改。
    pub fn undo_steps(&self, video_id: &str, actor: &str) -> EngineResult<(Option<UndoStep>, Option<UndoStep>)> {
        let step = |sql: &str| -> EngineResult<Option<UndoStep>> {
            Ok(self
                .conn
                .query_row(sql, params![video_id, actor], |r| {
                    Ok(UndoStep {
                        transaction_id: r.get(0)?,
                        label: r.get(1)?,
                    })
                })
                .optional()?)
        };
        let undo = step(
            "SELECT t.transaction_id, t.base_label FROM transactions t JOIN undo_records u ON u.transaction_id = t.transaction_id
             WHERE t.video_id = ?1 AND t.actor = ?2 AND t.undo_depth % 2 = 0 AND u.undone_by IS NULL AND u.changes != '[]'
             ORDER BY t.revision DESC LIMIT 1",
        )?;
        let redo = step(
            "SELECT t.transaction_id, t.base_label FROM transactions t JOIN undo_records u ON u.transaction_id = t.transaction_id
             WHERE t.video_id = ?1 AND t.actor = ?2 AND t.undo_depth % 2 = 1 AND u.undone_by IS NULL
               AND t.revision > (SELECT COALESCE(MAX(f.revision), 0) FROM transactions f JOIN undo_records fu ON fu.transaction_id = f.transaction_id
                                 WHERE f.video_id = ?1 AND f.actor = ?2 AND f.undo_depth = 0 AND fu.changes != '[]')
             ORDER BY t.revision DESC LIMIT 1",
        )?;
        Ok((undo, redo))
    }

    /// 视频的 id（`videos` 表只有一行）。
    pub fn video_id(&self) -> EngineResult<Id> {
        self.conn
            .query_row("SELECT id FROM videos LIMIT 1", [], |r| r.get(0))
            .optional()?
            .ok_or_else(|| ErrorBody::unsupported_video(msg!("engine.videoRecordMissing", "The video record is missing")))
    }

    /// 视频所属的项目；还没有认领过时为空。
    pub fn project_id(&self) -> EngineResult<Option<Id>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM meta WHERE key = ?1", [META_PROJECT_ID], |r| r.get(0))
            .optional()?)
    }

    /// 这个视频曾经用过的 videoId，旧的在前（每被当作副本换一次标识，追加一个）。
    pub fn previous_video_ids(&self) -> EngineResult<Vec<Id>> {
        let text: Option<String> = self
            .conn
            .query_row("SELECT value FROM meta WHERE key = ?1", [META_PREVIOUS_VIDEO_IDS], |r| r.get(0))
            .optional()?;
        match text {
            None => Ok(Vec::new()),
            Some(text) => serde_json::from_str(&text).map_err(|e| ErrorBody::storage(msg!(
                "engine.previousVideoIdsCorrupt",
                "previousVideoIds is corrupt: {error}",
                error = e.to_string()
            ))),
        }
    }

    /// 认领所属项目（调用方持有写锁）。没有所属项目时记下传入的；相同什么也不做；
    /// 不同时把视频换成 `new_video_id`：所有表里的 videoId、视频自身实体的 id，以及回执、事件与撤销记录里
    /// 引用它的 JSON 一起改，修订号、事件序号、所有者代与历史不变。全部在一个 SQLite 事务里，崩溃后要么全做要么没做。
    pub fn claim_project(&mut self, video_id: &str, project_id: &str, new_video_id: &str) -> EngineResult<ProjectClaim> {
        if project_id.is_empty() || project_id.chars().count() > 128 {
            return Err(ErrorBody::invalid_operation(msg!("engine.projectIdLength", "projectId must be 1–128 characters")));
        }
        let tx = self.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let current: Option<String> = tx
            .query_row("SELECT value FROM meta WHERE key = ?1", [META_PROJECT_ID], |r| r.get(0))
            .optional()?;
        let outcome = match current.as_deref() {
            None => ProjectClaim::Adopted,
            Some(existing) if existing == project_id => return Ok(ProjectClaim::Unchanged),
            Some(_) => {
                let mut previous: Vec<Id> = match tx
                    .query_row("SELECT value FROM meta WHERE key = ?1", [META_PREVIOUS_VIDEO_IDS], |r| {
                        r.get::<_, String>(0)
                    })
                    .optional()?
                {
                    None => Vec::new(),
                    Some(text) => serde_json::from_str(&text).map_err(|e| ErrorBody::storage(msg!(
                "engine.previousVideoIdsCorrupt",
                "previousVideoIds is corrupt: {error}",
                error = e.to_string()
            )))?,
                };
                previous.push(video_id.to_string());
                let quoted = |id: &str| format!("\"{id}\"");
                let (old, new) = (quoted(video_id), quoted(new_video_id));
                let renamed = tx.execute("UPDATE videos SET id = ?1 WHERE id = ?2", params![new_video_id, video_id])?;
                if renamed != 1 {
                    return Err(ErrorBody::storage(msg!("engine.videoIdMismatch", "The video record does not match videoId")));
                }
                for table in [
                    "entities",
                    "document_versions",
                    "asset_versions",
                    "bundle_versions",
                    "dependency_edges",
                    "transactions",
                    "outbox",
                ] {
                    tx.execute(
                        &format!("UPDATE {table} SET video_id = ?1 WHERE video_id = ?2"),
                        params![new_video_id, video_id],
                    )?;
                }
                // 视频自身也是一个实体，实体 id 就是 videoId；读出时 `state.id` 取自它。
                tx.execute(
                    "UPDATE entities SET entity_id = ?1 WHERE entity_id = ?2",
                    params![new_video_id, video_id],
                )?;
                tx.execute(
                    "UPDATE entities SET parent_id = ?1 WHERE parent_id = ?2",
                    params![new_video_id, video_id],
                )?;
                // 存下的 JSON 里引用 videoId 的地方（回执与事件的 `videoId`、撤销记录里视频实体的 `id`）。
                // JSON 字符串里的引号是转义过的，带引号的 id 只会匹配真正的值。文档正文是用户内容，不动。
                for (table, column) in [
                    ("entities", "body"),
                    ("receipts", "body"),
                    ("outbox", "body"),
                    ("undo_records", "changes"),
                ] {
                    tx.execute(
                        &format!("UPDATE {table} SET {column} = replace({column}, ?1, ?2) WHERE instr({column}, ?1) > 0"),
                        params![old, new],
                    )?;
                }
                tx.execute(
                    "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2",
                    params![META_PREVIOUS_VIDEO_IDS, json(&previous)],
                )?;
                ProjectClaim::Reassigned {
                    previous_video_id: video_id.to_string(),
                    video_id: new_video_id.to_string(),
                }
            }
        };
        tx.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2",
            params![META_PROJECT_ID, project_id],
        )?;
        tx.commit()?;
        Ok(outcome)
    }

    /// outbox 里 `after` 之后的事件，按序号排列（断线补发与崩溃恢复）。
    pub fn events_after(&self, video_id: &str, after: i64, limit: i64) -> EngineResult<Vec<VideoEvent>> {
        let mut stmt = self
            .conn
            .prepare("SELECT body FROM outbox WHERE video_id = ?1 AND event_seq > ?2 ORDER BY event_seq LIMIT ?3")?;
        let rows = stmt.query_map(params![video_id, after, limit], |r| r.get::<_, String>(0))?;
        rows.map(|row| serde_json::from_str(&row?).map_err(|e| ErrorBody::storage(msg!("engine.eventCorrupt", "The event is corrupt: {error}", error = e.to_string()))))
            .collect()
    }

    pub fn history(&self, video_id: &str, limit: i64) -> EngineResult<Vec<HistoryEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.transaction_id, t.idempotency_key, t.label, t.actor, t.revision, t.committed_at, t.undo_of, u.undone_by, u.changes, t.undo_depth
             FROM transactions t LEFT JOIN undo_records u ON u.transaction_id = t.transaction_id
             WHERE t.video_id = ?1 ORDER BY t.revision DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![video_id, limit], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, Option<String>>(7)?,
                r.get::<_, Option<String>>(8)?,
                r.get::<_, i64>(9)?,
            ))
        })?;
        rows.map(|row| {
            let (transaction_id, command_id, label, actor, revision, committed_at, undo_of, undone_by, changes, undo_depth) = row?;
            let has_changes = changes.is_some_and(|c| c != "[]");
            Ok(HistoryEntry {
                transaction_id,
                command_id,
                label,
                actor: serde_json::from_str(&actor).map_err(|e| ErrorBody::storage(msg!(
                    "engine.transactionCorrupt",
                    "The transaction record is corrupt: {error}",
                    error = e.to_string()
                )))?,
                video_revision: revision.to_string(),
                committed_at,
                undo_of,
                undo_available: undone_by.is_none() && has_changes,
                undone_by,
                undo_depth,
            })
        })
        .collect()
    }
}

/// 版本门（视频格式规范 §1.4）：只接受当前版本。版本 1–2 的视频用的是旧的元素模型，不为它们保留兼容，
/// 拒绝打开并说明原因，不改写；更高的版本是更新的 BaoCut 写的，同样拒绝。
pub fn schema_version_supported(version: &str) -> EngineResult<()> {
    match version.parse::<u32>() {
        Ok(v) if v == SCHEMA_VERSION => Ok(()),
        Ok(v @ 1..SCHEMA_VERSION) => Err(ErrorBody::unsupported_video(msg!(
            "engine.schemaRetired",
            "Video format version {version} is no longer supported: from version {current}, picture elements use a new element model and older videos can no longer be opened; import again from the original project",
            version = v,
            current = SCHEMA_VERSION
        ))
        .recovery(msg!("engine.schemaRetiredRecovery", "Import this video again from the original project"))
        .details(serde_json::json!({ "schemaVersion": v, "supported": [SCHEMA_VERSION], "reason": "element-model" }))),
        _ => Err(ErrorBody::unsupported_video(msg!(
            "engine.schemaTooNew",
            "Video format version {version} is not supported; open it with a newer BaoCut",
            version
        ))
            .details(serde_json::json!({ "schemaVersion": version, "supported": [SCHEMA_VERSION] }))),
    }
}
