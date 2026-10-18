//! 工作区快照（视频格式规范 §9）：视频当前状态的确定性文本，放在视频目录的 `.bcut-snapshot/` 里。
//!
//! - `video.json` 是实体的扁平投影：视频本身、序列头、轨道、实例、转场、标记、闪避规则按 ID 各占一行，
//!   素材记录整条保留，文档头只留当前版本，另记每个文档文件的摘要。检查点与保护不写：保存的版本在版本记录里。
//! - `documents/<id>.json` 是每个文档当前版本的正文。
//! - 两者都按 [`stable_json`] 排版：前两层展开，更深的值一行一个，键按字典序。同一状态逐字节相同。
//!
//! 快照是派生物：只有持有写锁的引擎写它（[`crate::versions`]），读回来只用于重建与回到版本。

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use editor_semantics::TIME_CONTRACT_VERSION;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::{EngineResult, ErrorBody, Retryability, Text, msg};
use crate::model::*;
use crate::state::{EntityKind, VideoState};
use crate::store::DocumentBody;
use crate::video::{canonical_json, sha256_text};

/// 视频目录里放快照与版本记录的目录。点开头：Space 扫描与文件列表跳过它。
pub const SNAPSHOT_DIR: &str = ".bcut-snapshot";
pub const SNAPSHOT_FORMAT: &str = "baocut.workspace-snapshot";
pub const SNAPSHOT_SCHEMA_VERSION: u32 = 1;
/// 快照的主文件（相对 [`SNAPSHOT_DIR`]）。
pub const VIDEO_FILE: &str = "video.json";
const DOCUMENTS_DIR: &str = "documents";

/// 一份快照的文件：相对 [`SNAPSHOT_DIR`] 的路径（`/` 分隔）→ 文本。
pub type SnapshotFiles = BTreeMap<String, String>;

/// 属于序列的实体：所属序列与实体本身。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlacedRow {
    pub sequence_id: Id,
    pub body: Value,
}

/// `video.json` 的内容。写与读用同一个类型：读回来的字段原样进实体，往返不补默认值、不丢字段。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSnapshot {
    pub format: String,
    pub schema_version: u32,
    pub video_schema_version: u32,
    pub time_contract_version: u32,
    pub video_id: Id,
    /// 视频实体：名字、根序列、速览。
    pub video: Value,
    pub sequences: BTreeMap<Id, Value>,
    pub tracks: BTreeMap<Id, PlacedRow>,
    pub items: BTreeMap<Id, PlacedRow>,
    pub transitions: BTreeMap<Id, PlacedRow>,
    pub markers: BTreeMap<Id, PlacedRow>,
    pub ducking: BTreeMap<Id, PlacedRow>,
    pub assets: BTreeMap<Id, Value>,
    /// 文档头，只留当前版本。
    pub documents: BTreeMap<Id, Value>,
    /// 每个文档文件（`documents/<id>.json`）的 sha256。读的一方据此判断快照是否完整。
    pub document_files: BTreeMap<Id, String>,
}

/// 快照读不出来或不自洽。
pub fn invalid(message: impl Into<Text>) -> ErrorBody {
    ErrorBody::new("SNAPSHOT_INVALID", message, Retryability::AfterUserAction)
}

/// 便携包的检查（引用、重叠、文档正文）报的是 `PACKAGE_INVALID`；用在快照上时换成快照的错误码。
fn as_snapshot_error(mut error: ErrorBody) -> ErrorBody {
    if error.code == "PACKAGE_INVALID" {
        error.code = "SNAPSHOT_INVALID".into();
    }
    error
}

/// 一个文档文件的路径。
pub fn document_path(document_id: &str) -> String {
    format!("{DOCUMENTS_DIR}/{document_id}.json")
}

/// 行稳定的排版：根对象与它的容器成员展开（每个成员一行，两个空格缩进），第三层起每个值压成一行紧凑 JSON。
/// 键按字典序；UTF-8，LF，以换行结尾。
pub fn stable_json(value: &Value) -> String {
    let mut out = String::new();
    write_level(&mut out, value, 0);
    out.push('\n');
    out
}

fn write_level(out: &mut String, value: &Value, depth: usize) {
    const EXPANDED: usize = 2;
    let indent = |out: &mut String, depth: usize| out.extend(std::iter::repeat_n("  ", depth));
    match value {
        Value::Object(map) if depth < EXPANDED && !map.is_empty() => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push_str("{\n");
            for (i, key) in keys.iter().enumerate() {
                indent(out, depth + 1);
                out.push_str(&Value::String((*key).clone()).to_string());
                out.push_str(": ");
                write_level(out, &map[*key], depth + 1);
                if i + 1 < keys.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            indent(out, depth);
            out.push('}');
        }
        Value::Array(items) if depth < EXPANDED && !items.is_empty() => {
            out.push_str("[\n");
            for (i, item) in items.iter().enumerate() {
                indent(out, depth + 1);
                write_level(out, item, depth + 1);
                if i + 1 < items.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            indent(out, depth);
            out.push(']');
        }
        other => out.push_str(&canonical_json(other)),
    }
}

/// 用户主目录：主目录下、项目外的链接素材在快照里写成 `~/` 开头（§9.2），换一台机器也能对上。
pub fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE");
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME");
    home.filter(|h| !h.is_empty()).map(PathBuf::from).filter(|h| h.is_absolute())
}

fn collapse_home(path: &str, home: &Path) -> Option<String> {
    let rest = Path::new(path).strip_prefix(home).ok()?;
    let parts: Vec<String> = rest.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    if parts.is_empty() || !Path::new(path).is_absolute() {
        return None;
    }
    Some(format!("~/{}", parts.join("/")))
}

fn expand_home(path: &str, home: Option<&Path>) -> Option<String> {
    let rest = path.strip_prefix("~/")?;
    let mut full = home?.to_path_buf();
    for part in rest.split('/').filter(|p| !p.is_empty()) {
        full.push(part);
    }
    Some(full.to_string_lossy().into_owned())
}

/// 改写素材记录里每个链接版本的路径。
fn map_linked_paths(asset: &mut Value, mut map: impl FnMut(&str) -> Option<String>) {
    let Some(revisions) = asset.get_mut("revisions").and_then(Value::as_object_mut) else {
        return;
    };
    for revision in revisions.values_mut() {
        let Some(storage) = revision.get_mut("storage") else { continue };
        if storage.get("mode").and_then(Value::as_str) != Some("linked") {
            continue;
        }
        if let Some(path) = storage.pointer_mut("/locator/path")
            && let Some(mapped) = path.as_str().and_then(&mut map)
        {
            *path = Value::String(mapped);
        }
    }
}

/// 文档头只留当前版本：正文也只写当前版本。
fn current_only(mut document: Value) -> Value {
    let current = document.get("currentRevision").cloned();
    if let (Some(Value::String(current)), Some(Value::Object(revisions))) = (current, document.get_mut("revisions")) {
        revisions.retain(|revision, _| *revision == current);
    }
    document
}

/// 当前状态 → 快照文件。`bodies` 是每个文档当前版本存下的正文文本。
pub fn project(state: &VideoState, bodies: &BTreeMap<Id, String>, home: Option<&Path>) -> EngineResult<SnapshotFiles> {
    let mut snapshot = WorkspaceSnapshot {
        format: SNAPSHOT_FORMAT.into(),
        schema_version: SNAPSHOT_SCHEMA_VERSION,
        video_schema_version: SCHEMA_VERSION,
        time_contract_version: TIME_CONTRACT_VERSION,
        video_id: state.id.clone(),
        video: Value::Null,
        sequences: BTreeMap::new(),
        tracks: BTreeMap::new(),
        items: BTreeMap::new(),
        transitions: BTreeMap::new(),
        markers: BTreeMap::new(),
        ducking: BTreeMap::new(),
        assets: BTreeMap::new(),
        documents: BTreeMap::new(),
        document_files: BTreeMap::new(),
    };
    let mut files = SnapshotFiles::new();
    for (id, row) in state.entities() {
        let placed = |row: crate::state::EntityRow| PlacedRow {
            sequence_id: row.parent.unwrap_or_default(),
            body: row.body,
        };
        match row.kind {
            EntityKind::Video => snapshot.video = row.body,
            EntityKind::Sequence => {
                snapshot.sequences.insert(id, row.body);
            }
            EntityKind::Track => {
                snapshot.tracks.insert(id, placed(row));
            }
            EntityKind::Item => {
                snapshot.items.insert(id, placed(row));
            }
            EntityKind::Transition => {
                snapshot.transitions.insert(id, placed(row));
            }
            EntityKind::Marker => {
                snapshot.markers.insert(id, placed(row));
            }
            EntityKind::Ducking => {
                snapshot.ducking.insert(id, placed(row));
            }
            EntityKind::Asset => {
                let mut body = row.body;
                if let Some(home) = home {
                    map_linked_paths(&mut body, |path| collapse_home(path, home));
                }
                snapshot.assets.insert(id, body);
            }
            EntityKind::Document => {
                let text = bodies.get(&id).ok_or_else(|| {
                    ErrorBody::storage(msg!(
                        "engine.documentRevisionNoBody",
                        "Revision {revision} of document {id} has no body",
                        revision = state.documents.get(&id).map(|d| d.current_revision.clone()).unwrap_or_default(),
                        id = &id
                    ))
                })?;
                let body: Value = serde_json::from_str(text).map_err(|e| {
                    ErrorBody::storage(msg!(
                        "engine.documentCorrupt",
                        "The document body is corrupt: {error}",
                        error = e.to_string()
                    ))
                })?;
                let file = stable_json(&body);
                snapshot.document_files.insert(id.clone(), sha256_text(&file));
                files.insert(document_path(&id), file);
                snapshot.documents.insert(id, current_only(row.body));
            }
            EntityKind::Checkpoint | EntityKind::Protection => {}
        }
    }
    let value = serde_json::to_value(&snapshot).expect("快照总能序列化");
    files.insert(VIDEO_FILE.into(), stable_json(&value));
    Ok(files)
}

/// 从快照文件读出的视频：工作态（修订号由调用方定）与各文档当前版本的正文。
pub struct ParsedSnapshot {
    pub state: VideoState,
    pub documents: Vec<DocumentBody>,
}

/// 读出并核对一份快照：格式与版本、文档文件的摘要、文档头登记的内容摘要。引用与时间线的规则由调用方再查一遍。
pub fn parse(files: &SnapshotFiles, home: Option<&Path>) -> EngineResult<ParsedSnapshot> {
    let text = files
        .get(VIDEO_FILE)
        .ok_or_else(|| invalid(msg!("engine.snapshotMissing", "The snapshot has no video.json")))?;
    let raw: Value = serde_json::from_str(text).map_err(|e| {
        invalid(msg!(
            "engine.snapshotNotJson",
            "The snapshot is not JSON: {error}",
            error = e.to_string()
        ))
    })?;
    if raw.get("format").and_then(Value::as_str) != Some(SNAPSHOT_FORMAT) {
        return Err(invalid(msg!(
            "engine.workspaceSnapshotFormat",
            "The snapshot is not a BaoCut workspace snapshot"
        )));
    }
    let schema = raw.get("schemaVersion").and_then(Value::as_u64).unwrap_or(0);
    let video_schema = raw.get("videoSchemaVersion").and_then(Value::as_u64).unwrap_or(0);
    let contract = raw.get("timeContractVersion").and_then(Value::as_u64).unwrap_or(0);
    if schema != u64::from(SNAPSHOT_SCHEMA_VERSION)
        || video_schema != u64::from(SCHEMA_VERSION)
        || contract != u64::from(TIME_CONTRACT_VERSION)
    {
        return Err(invalid(msg!(
            "engine.workspaceSnapshotVersion",
            "This snapshot was written in an unsupported format version; open it with a matching BaoCut"
        ))
        .details(json!({
            "schemaVersion": schema,
            "videoSchemaVersion": video_schema,
            "timeContractVersion": contract,
            "supported": { "schemaVersion": SNAPSHOT_SCHEMA_VERSION, "videoSchemaVersion": SCHEMA_VERSION, "timeContractVersion": TIME_CONTRACT_VERSION },
        })));
    }
    let snapshot: WorkspaceSnapshot = serde_json::from_value(raw).map_err(|e| {
        invalid(msg!(
            "engine.snapshotUnreadable",
            "The snapshot cannot be read: {error}",
            error = e.to_string()
        ))
    })?;

    let mut state = VideoState {
        id: snapshot.video_id.clone(),
        name: String::new(),
        brief: None,
        root_sequence_id: String::new(),
        revision: 0,
        event_seq: 0,
        sequences: BTreeMap::new(),
        tracks: BTreeMap::new(),
        items: BTreeMap::new(),
        transitions: BTreeMap::new(),
        markers: BTreeMap::new(),
        ducking: BTreeMap::new(),
        assets: BTreeMap::new(),
        documents: BTreeMap::new(),
        checkpoints: BTreeMap::new(),
        protections: BTreeMap::new(),
    };
    let put = |state: &mut VideoState, id: &str, kind: EntityKind, parent: Option<&str>, body: Value| {
        state.put(id, kind, parent, Some(body)).map_err(|e| {
            invalid(Text {
                text: e.message,
                message_ref: e.message_ref,
            })
        })
    };
    let id = snapshot.video_id.clone();
    put(&mut state, &id, EntityKind::Video, None, snapshot.video)?;
    for (id, body) in snapshot.sequences {
        put(&mut state, &id, EntityKind::Sequence, None, body)?;
    }
    for (kind, rows) in [
        (EntityKind::Track, snapshot.tracks),
        (EntityKind::Item, snapshot.items),
        (EntityKind::Transition, snapshot.transitions),
        (EntityKind::Marker, snapshot.markers),
        (EntityKind::Ducking, snapshot.ducking),
    ] {
        for (id, row) in rows {
            put(&mut state, &id, kind, Some(&row.sequence_id), row.body)?;
        }
    }
    for (id, mut body) in snapshot.assets {
        map_linked_paths(&mut body, |path| expand_home(path, home));
        put(&mut state, &id, EntityKind::Asset, None, body)?;
    }
    for (id, body) in snapshot.documents {
        put(&mut state, &id, EntityKind::Document, None, body)?;
    }

    if snapshot.document_files.keys().ne(state.documents.keys()) {
        return Err(invalid(msg!(
            "engine.snapshotDocumentList",
            "The document files listed in the snapshot do not match its documents"
        )));
    }
    let mut documents = Vec::new();
    for (id, record) in &state.documents {
        let version = match (record.revisions.len(), record.revisions.get(&record.current_revision)) {
            (1, Some(version)) => version,
            _ => {
                return Err(invalid(msg!(
                    "engine.documentRecordIncomplete",
                    "The record of document {id} is incomplete",
                    id
                )));
            }
        };
        let file = files.get(&document_path(id)).ok_or_else(|| {
            invalid(msg!(
                "engine.snapshotDocumentMissing",
                "The snapshot is missing the file of document {id}",
                id
            ))
        })?;
        if Some(&sha256_text(file)) != snapshot.document_files.get(id) {
            return Err(invalid(msg!(
                "engine.snapshotDocumentChanged",
                "The file of document {id} does not match the snapshot",
                id
            )));
        }
        let parsed: Value = serde_json::from_str(file).unwrap_or(Value::Null);
        crate::package::check_document_body(&state, id, version, &parsed).map_err(as_snapshot_error)?;
        // 库里存的是键有序的紧凑文本，内容摘要按它算（`putDocument`）。
        let body = canonical_json(&parsed);
        if sha256_text(&body) != version.content_hash || body.len() as u64 != version.byte_length {
            return Err(invalid(msg!(
                "engine.documentDigestMismatch",
                "Revision {revision} of document {id} does not match its recorded digest",
                revision = &version.revision,
                id
            )));
        }
        documents.push(DocumentBody {
            document_id: id.clone(),
            revision: version.revision.clone(),
            content_hash: version.content_hash.clone(),
            body,
        });
    }
    Ok(ParsedSnapshot { state, documents })
}

/// 提交时成立的规则（ID 唯一、引用都在、不重叠、转场成立），用快照的错误码报告。
pub fn validate(state: &VideoState) -> EngineResult<()> {
    crate::package::validate(state).map_err(as_snapshot_error)
}

/// 每个文件的 sha256。
pub fn hashes(files: &SnapshotFiles) -> BTreeMap<String, String> {
    files.iter().map(|(path, text)| (path.clone(), sha256_text(text))).collect()
}

/// 整份快照的摘要：文件按路径排序，逐个摘要再整体摘要（换行已是 LF）。
pub fn digest(hashes: &BTreeMap<String, String>) -> String {
    let joined: String = hashes.iter().map(|(path, hash)| format!("{path} {hash}\n")).collect();
    sha256_text(&joined)
}

/// 磁盘上的快照文件：`video.json` 与 `documents/*.json`。目录不存在时为空。
pub fn read_files(root: &Path) -> EngineResult<SnapshotFiles> {
    let mut files = SnapshotFiles::new();
    let main = root.join(VIDEO_FILE);
    if main.is_file() {
        files.insert(VIDEO_FILE.into(), read_text(&main)?);
    }
    let documents = root.join(DOCUMENTS_DIR);
    if documents.is_dir() {
        for entry in fs::read_dir(&documents)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with('.') && name.ends_with(".json") && entry.file_type()?.is_file() {
                files.insert(format!("{DOCUMENTS_DIR}/{name}"), read_text(&entry.path())?);
            }
        }
    }
    Ok(files)
}

fn read_text(path: &Path) -> EngineResult<String> {
    let bytes = fs::read(path)?;
    String::from_utf8(bytes)
        .map_err(|_| invalid(msg!("engine.snapshotNotUtf8", "A snapshot file is not UTF-8 text")).details(json!({ "path": path })))
}

/// 先写临时文件再改名替换（同一目录，`.<名字>.partial`）。
pub fn write_atomic(path: &Path, text: &str) -> EngineResult<()> {
    let dir = path.parent().expect("快照文件总在目录里");
    fs::create_dir_all(dir)?;
    let name = path.file_name().expect("文件名").to_string_lossy();
    let temp = dir.join(format!(".{name}.partial"));
    {
        use std::io::Write;
        let mut file = fs::File::create(&temp)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
    }
    fs::rename(&temp, path)?;
    Ok(())
}

/// 把快照文件写到磁盘：只写内容变了的，先文档、再 `video.json`，最后删掉不再有的文档文件。
pub fn write_files(root: &Path, files: &SnapshotFiles, disk: &SnapshotFiles) -> EngineResult<Vec<String>> {
    let mut written = Vec::new();
    let order = files
        .keys()
        .filter(|p| p.as_str() != VIDEO_FILE)
        .chain(files.keys().filter(|p| p.as_str() == VIDEO_FILE));
    for path in order {
        if disk.get(path) != files.get(path) {
            write_atomic(&root.join(path), &files[path])?;
            written.push(path.clone());
        }
    }
    for path in disk.keys().filter(|p| !files.contains_key(*p)) {
        match fs::remove_file(root.join(path)) {
            Ok(()) => written.push(path.clone()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_levels_are_expanded_and_keys_sorted() {
        let value = json!({ "b": { "z": { "deep": [1, 2] }, "a": 1 }, "a": [], "c": [{ "y": 1, "x": 2 }], "d": "x" });
        assert_eq!(
            stable_json(&value),
            "{\n  \"a\": [],\n  \"b\": {\n    \"a\": 1,\n    \"z\": {\"deep\":[1,2]}\n  },\n  \"c\": [\n    {\"x\":2,\"y\":1}\n  ],\n  \"d\": \"x\"\n}\n"
        );
        assert_eq!(serde_json::from_str::<Value>(&stable_json(&value)).unwrap(), value);
    }

    #[test]
    fn home_paths_are_written_with_a_tilde() {
        let home = Path::new("/Users/me");
        assert_eq!(collapse_home("/Users/me/Movies/a.mp4", home).as_deref(), Some("~/Movies/a.mp4"));
        assert_eq!(collapse_home("/Volumes/Disk/a.mp4", home), None);
        assert_eq!(collapse_home("/Users/me", home), None);
        assert_eq!(collapse_home("Movies/a.mp4", home), None);
        let expanded = expand_home("~/Movies/a.mp4", Some(home)).unwrap();
        assert_eq!(Path::new(&expanded), Path::new("/Users/me/Movies/a.mp4"));
        assert_eq!(expand_home("~/x", None), None);
    }
}
