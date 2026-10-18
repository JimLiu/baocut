//! 版本记录（视频格式规范 §9.3–§9.6）：最新快照加上最近的版本，每个版本是一份 unified diff，开头列出这一版的操作。
//!
//! - 每次写快照时判断并入当前版本还是开新版本（安静满 5 分钟、当前版本满 30 分钟、当前版本是终结的、新回合）。
//! - 打开着的版本（最新一版）旁边有 `<序号>.base`：这一版开始时的快照。它的 diff 每次都从起点重算，崩溃后也能重算；
//!   起点文件先于快照文件写下，开新版本以它落盘为准。只有最新一版有起点文件。
//! - 回滚只用 diff：从最新快照逐版反向应用，每一步要求精确匹配并核对摘要，对不上就报告断点，不拼半成品。
//! - `video.db` 仍是唯一的权威。快照与版本都由持有写锁的引擎从已提交的状态生成；簿记（写到哪个修订号、
//!   每个文件的摘要、下一个序号）记在库的 meta 里，不产生修订。

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::{EngineResult, ErrorBody, MessageRef, Retryability, Text, kinds, msg};
use crate::ids::{now_rfc3339, unix_millis_from_rfc3339};
use crate::line_diff::{FilePatch, apply_files, diff_files, format_patches, parse_patches};
use crate::model::*;
use crate::state::VideoState;
use crate::store::{DocumentBody, Store};
use crate::task_guard::TaskProtection;
use crate::video::{CommitInput, Committed, DB_FILE, LOCK_FILE, OpenMode, Video, VideoTransaction, acquire_lock, payload_hash};
use crate::workspace::{self, SNAPSHOT_DIR, SnapshotFiles, VIDEO_FILE};

/// 版本文件所在的目录（相对快照目录）。
pub const HISTORY_DIR: &str = "history";
/// 缺省保留的未命名版本数（设置 `versions.keep`）。
pub const DEFAULT_KEEP: usize = 10;
/// 一部视频的版本文件总大小上限：超过时从最旧的未命名版本删起，降到上限的 90%。
pub const SIZE_CAP: u64 = 64 * 1024 * 1024;
/// 安静多久之后开新版本。
const QUIET_MS: i64 = 5 * 60 * 1000;
/// 一个版本最长持续多久。
const MAX_SPAN_MS: i64 = 30 * 60 * 1000;
/// 动作清单最多列多少行，其余折叠为一个计数。
const MAX_ACTION_GROUPS: usize = 50;

const META_REVISION: &str = "snapshotRevision";
const META_FILES: &str = "snapshotFiles";
const META_PENDING: &str = "snapshotPending";
const META_DIGEST: &str = "snapshotDigest";
const META_NEXT: &str = "versionsNext";

/// 版本的种类：普通一段工作，或单独成版的保存、回到版本、外部导入、重建。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VersionKind {
    Segment,
    Save,
    Restore,
    External,
    Rebuild,
}

impl VersionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            VersionKind::Segment => "segment",
            VersionKind::Save => "save",
            VersionKind::Restore => "restore",
            VersionKind::External => "external",
            VersionKind::Rebuild => "rebuild",
        }
    }

    fn parse(text: &str) -> Option<VersionKind> {
        Some(match text {
            "segment" => VersionKind::Segment,
            "save" => VersionKind::Save,
            "restore" => VersionKind::Restore,
            "external" => VersionKind::External,
            "rebuild" => VersionKind::Rebuild,
            _ => return None,
        })
    }
}

/// 调用方要求的切分点。`turn`：按回合切分时，智能体新回合的第一次写。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Boundary {
    Turn,
}

/// 动作清单的一行：同一操作者、同一标签的事务合在一起计数。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionGroup {
    pub actor: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label_ref: Option<MessageRef>,
    pub count: u64,
}

/// 这一版里改过视频的会话。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationRef {
    pub id: Id,
    pub title: String,
}

/// 一个改动文件在这一版之前与之后的摘要；不存在的一侧为空。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

/// 版本文件的头部。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionHeader {
    pub version: u64,
    pub kind: VersionKind,
    pub started_at: String,
    pub updated_at: String,
    /// 这一版覆盖的修订号：开始时快照的修订号与结束时的。
    pub from_revision: Revision,
    pub to_revision: Revision,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary_ref: Option<MessageRef>,
    pub actions: Vec<ActionGroup>,
    /// 超出清单的事务数。
    #[serde(default, skip_serializing_if = "is_zero")]
    pub actions_omitted: u64,
    pub conversations: Vec<ConversationRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint_id: Option<Id>,
    pub files: Vec<FileChange>,
}

fn is_zero(n: &u64) -> bool {
    *n == 0
}

/// 版本列表里的一项。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    #[serde(flatten)]
    pub header: VersionHeader,
    /// 版本文件的大小（字节）。
    pub bytes: u64,
    /// 是不是打开着的最新一版（之后的改动可能并进来）。
    pub open: bool,
}

/// 一部视频的版本列表，新的在前。读不出头部的版本文件列在 `unreadable`。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionList {
    pub versions: Vec<VersionEntry>,
    pub unreadable: Vec<u64>,
}

/// 一个版本的头部与 diff 文本。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionText {
    pub header: VersionHeader,
    pub diff: String,
}

/// 写快照的请求（`videos.writeSnapshot`）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRequest {
    #[serde(default)]
    pub boundary: Option<Boundary>,
    #[serde(default)]
    pub conversations: Vec<ConversationRef>,
    /// 保留的未命名版本数；不给时用 [`DEFAULT_KEEP`]。
    #[serde(default)]
    pub keep: Option<usize>,
}

/// 一次写快照的结果。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotWrite {
    pub revision: Revision,
    /// 这次改动所在的版本；只写了基线（还没有版本）时为空。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<u64>,
    /// 这次开了一个新版本。
    pub opened: bool,
    /// 写了或删了的快照文件（相对快照目录）。
    pub written: Vec<String>,
    /// 按保留规则清理掉的版本。
    pub pruned: Vec<u64>,
}

/// 快照与库的关系（`videos.snapshotStatus`，视频格式规范 §9.7）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SnapshotState {
    /// 快照等于库里的状态。
    Synced,
    /// 库领先，快照几秒内会写。
    Pending,
    /// 快照被外部改过（与上次写下的不同），不会被覆盖。
    Conflict,
    /// 还没有快照。
    Missing,
    /// 只有快照、没有 `video.db`：可以重建。
    Rebuild,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotStatus {
    pub state: SnapshotState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<Revision>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_revision: Option<Revision>,
    /// 被外部改过的快照文件。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changed_paths: Vec<String>,
    pub versions: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<u64>,
}

/// 回到一个版本。`before` 为真时回到这个版本开始之前。
#[derive(Clone, Debug, PartialEq)]
pub struct RestoreRequest {
    pub command_id: Id,
    pub version: u64,
    pub before: bool,
    pub actor: Actor,
    pub keep: Option<usize>,
    /// 智能体任务的保护范围：回到版本同样不能触碰它（同 `edits.apply`）。
    pub protections: Vec<TaskProtection>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    /// 目标与当前状态相同时没有事务。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub committed: Option<Committed>,
    /// 这次回到版本产生的 `restore` 版本。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<u64>,
}

/// 把当前状态存成一个具名版本。
#[derive(Clone, Debug, PartialEq)]
pub struct SaveRequest {
    pub command_id: Id,
    pub name: String,
    pub note: Option<String>,
    pub actor: Actor,
    pub keep: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub committed: Committed,
    pub version: u64,
    pub checkpoint_id: Id,
}

/// 删掉一个保存的版本（只能删保存的版本）。
#[derive(Clone, Debug, PartialEq)]
pub struct DeleteRequest {
    pub command_id: Id,
    pub version: u64,
    pub actor: Actor,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    /// 删掉版本对应的检查点的事务；检查点已经不在时为空。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub committed: Option<Committed>,
}

fn version_not_found(version: u64) -> ErrorBody {
    ErrorBody::new(
        "VERSION_NOT_FOUND",
        msg!("engine.versionNotFound", "Version {version} does not exist", version),
        Retryability::AfterRefresh,
    )
    .details(json!({ "version": version }))
}

fn chain_broken(version: u64) -> ErrorBody {
    ErrorBody::new(
        "VERSION_CHAIN_BROKEN",
        msg!(
            "engine.versionChainBroken",
            "The version history does not match at version {version}; versions before it cannot be restored",
            version
        ),
        Retryability::Never,
    )
    .details(json!({ "brokenAt": version }))
}

fn snapshot_conflict(paths: Vec<String>) -> ErrorBody {
    ErrorBody::new(
        "SNAPSHOT_CONFLICT",
        msg!(
            "engine.snapshotConflict",
            "The snapshot of this video was changed outside BaoCut, so it is not overwritten"
        ),
        Retryability::AfterUserAction,
    )
    .details(json!({ "paths": paths }))
}

fn corrupt_meta(key: &str, error: impl ToString) -> ErrorBody {
    ErrorBody::storage(msg!(
        "engine.snapshotMetaCorrupt",
        "The snapshot record {key} in the video is corrupt: {error}",
        key,
        error = error.to_string()
    ))
}

// ---------------------------------------------------------------------------
// 头部

fn escape(text: &str) -> String {
    text.replace('\\', "\\\\").replace('\n', "\\n").replace('\r', "\\r")
}

fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

fn format_header(header: &VersionHeader) -> String {
    let mut out = String::new();
    let mut line = |key: &str, value: &str| {
        out.push_str(key);
        out.push_str(": ");
        out.push_str(value);
        out.push('\n');
    };
    let json_ref = |r: &MessageRef| serde_json::to_string(r).expect("引用总能序列化");
    line("BaoCut-Version", &header.version.to_string());
    line("Kind", header.kind.as_str());
    line("Started-At", &header.started_at);
    line("Updated-At", &header.updated_at);
    line("Revisions", &format!("{}..{}", header.from_revision, header.to_revision));
    line("Summary", &escape(&header.summary));
    if let Some(r) = &header.summary_ref {
        line("Summary-Ref", &json_ref(r));
    }
    for action in &header.actions {
        line(
            "Action",
            &format!("{} | {} | {}", escape(&action.actor), escape(&action.label), action.count),
        );
        if let Some(r) = &action.label_ref {
            line("Action-Ref", &json_ref(r));
        }
    }
    if header.actions_omitted > 0 {
        line("Actions-Omitted", &header.actions_omitted.to_string());
    }
    for conversation in &header.conversations {
        line(
            "Conversation",
            &format!("{} | {}", escape(&conversation.id), escape(&conversation.title)),
        );
    }
    if let Some(name) = &header.name {
        line("Name", &escape(name));
    }
    if let Some(note) = &header.note {
        line("Note", &escape(note));
    }
    if let Some(checkpoint) = &header.checkpoint_id {
        line("Checkpoint", checkpoint);
    }
    for file in &header.files {
        let side = |h: &Option<String>| h.clone().unwrap_or_else(|| "-".into());
        line("File", &format!("{} {} {}", file.path, side(&file.before), side(&file.after)));
    }
    out
}

/// 版本文件的全文：头部、一个空行、diff。
fn format_version(header: &VersionHeader, patches: &[FilePatch]) -> String {
    format!("{}\n{}", format_header(header), format_patches(patches))
}

/// 读出版本文件：头部与 diff 文本。头部的键不认识的跳过。
fn parse_version(text: &str) -> Option<(VersionHeader, String)> {
    let (head, diff) = match text.find("\n\n") {
        Some(at) => (&text[..at + 1], &text[at + 2..]),
        None => (text, ""),
    };
    let mut header = VersionHeader {
        version: 0,
        kind: VersionKind::Segment,
        started_at: String::new(),
        updated_at: String::new(),
        from_revision: String::new(),
        to_revision: String::new(),
        summary: String::new(),
        summary_ref: None,
        actions: Vec::new(),
        actions_omitted: 0,
        conversations: Vec::new(),
        name: None,
        note: None,
        checkpoint_id: None,
        files: Vec::new(),
    };
    let mut seen_version = false;
    for line in head.lines() {
        let (key, value) = line.split_once(": ")?;
        match key {
            "BaoCut-Version" => {
                header.version = value.parse().ok()?;
                seen_version = true;
            }
            "Kind" => header.kind = VersionKind::parse(value)?,
            "Started-At" => header.started_at = value.to_string(),
            "Updated-At" => header.updated_at = value.to_string(),
            "Revisions" => {
                let (from, to) = value.split_once("..")?;
                header.from_revision = from.to_string();
                header.to_revision = to.to_string();
            }
            "Summary" => header.summary = unescape(value),
            "Summary-Ref" => header.summary_ref = serde_json::from_str(value).ok(),
            "Action" => {
                let (actor, rest) = value.split_once(" | ")?;
                let (label, count) = rest.rsplit_once(" | ")?;
                header.actions.push(ActionGroup {
                    actor: unescape(actor),
                    label: unescape(label),
                    label_ref: None,
                    count: count.parse().ok()?,
                });
            }
            "Action-Ref" => {
                if let Some(last) = header.actions.last_mut() {
                    last.label_ref = serde_json::from_str(value).ok();
                }
            }
            "Actions-Omitted" => header.actions_omitted = value.parse().ok()?,
            "Conversation" => {
                let (id, title) = value.split_once(" | ").unwrap_or((value, ""));
                header.conversations.push(ConversationRef {
                    id: unescape(id),
                    title: unescape(title),
                });
            }
            "Name" => header.name = Some(unescape(value)),
            "Note" => header.note = Some(unescape(value)),
            "Checkpoint" => header.checkpoint_id = Some(value.to_string()),
            "File" => {
                let mut parts = value.split(' ');
                let (path, before, after) = (parts.next()?, parts.next()?, parts.next()?);
                let side = |h: &str| (h != "-").then(|| h.to_string());
                header.files.push(FileChange {
                    path: path.to_string(),
                    before: side(before),
                    after: side(after),
                });
            }
            _ => {}
        }
    }
    seen_version.then_some((header, diff.to_string()))
}

/// 一组 diff 对应的 `File` 行。
fn file_changes(patches: &[FilePatch], old: &SnapshotFiles, new: &SnapshotFiles) -> Vec<FileChange> {
    let hash = |files: &SnapshotFiles, path: &str| files.get(path).map(|t| crate::video::sha256_text(t));
    patches
        .iter()
        .map(|p| FileChange {
            path: p.path.clone(),
            before: hash(old, &p.path),
            after: hash(new, &p.path),
        })
        .collect()
}

/// 动作清单：按出现顺序合并同一操作者、同一标签的事务，超过上限的计入 `omitted`。
fn group_actions(groups: &mut Vec<ActionGroup>, omitted: &mut u64, items: impl IntoIterator<Item = ActionGroup>) {
    for item in items {
        if let Some(existing) = groups
            .iter_mut()
            .find(|g| g.actor == item.actor && g.label == item.label && g.label_ref == item.label_ref)
        {
            existing.count += item.count;
        } else if groups.len() < MAX_ACTION_GROUPS {
            groups.push(item);
        } else {
            *omitted += item.count;
        }
    }
}

/// 普通版本的摘要：由动作清单拼出，不调用模型。
fn summarize(actions: &[ActionGroup], omitted: u64) -> Text {
    let total: u64 = actions.iter().map(|a| a.count).sum::<u64>() + omitted;
    let label = |a: &ActionGroup| Text {
        text: a.label.clone(),
        message_ref: a.label_ref.clone(),
    };
    match actions {
        [] => msg!("engine.labelEdit", "Edit"),
        [only] if omitted == 0 && only.count == 1 => label(only),
        [only] if omitted == 0 => msg!(
            "engine.versionSummaryRepeated",
            "{label} ({count} changes)",
            label = label(only),
            count = total
        ),
        _ => {
            let main = actions
                .iter()
                .fold(&actions[0], |best, a| if a.count > best.count { a } else { best });
            msg!(
                "engine.labelMoreChanges",
                "{main} and more ({count} changes)",
                main = label(main),
                count = total
            )
        }
    }
}

fn set_summary(header: &mut VersionHeader, summary: Text) {
    header.summary = summary.text;
    header.summary_ref = summary.message_ref;
}

/// 普通版本按动作清单重拼摘要。
fn resummarize(header: &mut VersionHeader) {
    let summary = summarize(&header.actions, header.actions_omitted);
    set_summary(header, summary);
}

/// 合并会话列表：保持先后，同一个会话取最新的标题。
fn merge_conversations(into: &mut Vec<ConversationRef>, more: &[ConversationRef]) {
    for conversation in more {
        match into.iter_mut().find(|c| c.id == conversation.id) {
            Some(existing) => existing.title = conversation.title.clone(),
            None => into.push(conversation.clone()),
        }
    }
}

// ---------------------------------------------------------------------------
// 版本文件

fn seq_name(seq: u64) -> String {
    format!("{seq:06}")
}

/// 读进来的一个版本。
struct Loaded {
    seq: u64,
    header: VersionHeader,
    patches: Vec<FilePatch>,
    bytes: u64,
    /// 最新一版的起点快照。
    base: Option<SnapshotFiles>,
}

impl Loaded {
    /// 这一版结束时的快照：起点加 diff。没有起点文件或对不上时为空。
    fn end(&self) -> Option<SnapshotFiles> {
        apply_files(&self.patches, self.base.as_ref()?, false).ok()
    }
}

#[derive(Serialize, Deserialize)]
struct BaseFile {
    files: SnapshotFiles,
}

/// `history/` 里的版本文件：序号 → (有无 diff 文件, 有无起点文件)。
fn scan(history: &Path) -> EngineResult<BTreeMap<u64, (bool, bool)>> {
    let mut found: BTreeMap<u64, (bool, bool)> = BTreeMap::new();
    if !history.is_dir() {
        return Ok(found);
    }
    for entry in fs::read_dir(history)? {
        let name = entry?.file_name().to_string_lossy().into_owned();
        let Some((stem, ext)) = name.split_once('.') else { continue };
        let Ok(seq) = stem.parse::<u64>() else { continue };
        if stem.len() < 6 || !stem.bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        let slot = found.entry(seq).or_default();
        match ext {
            "patch" => slot.0 = true,
            "base" => slot.1 = true,
            _ => {}
        }
    }
    found.retain(|_, (patch, base)| *patch || *base);
    Ok(found)
}

struct History {
    dir: PathBuf,
    /// 读得出的版本，按序号排列。
    versions: Vec<Loaded>,
    unreadable: Vec<u64>,
}

impl History {
    fn patch_path(&self, seq: u64) -> PathBuf {
        self.dir.join(format!("{}.patch", seq_name(seq)))
    }

    fn base_path(&self, seq: u64) -> PathBuf {
        self.dir.join(format!("{}.base", seq_name(seq)))
    }

    /// 读出全部版本。`repair` 为真时（持有写锁）删掉不属于最新一版的起点文件：它们是崩溃留下的。
    fn load(dir: PathBuf, repair: bool) -> EngineResult<History> {
        let found = scan(&dir)?;
        let top_patch = found.iter().rev().find(|(_, (patch, _))| *patch).map(|(seq, _)| *seq);
        let mut history = History {
            dir,
            versions: Vec::new(),
            unreadable: Vec::new(),
        };
        for (seq, (patch, base)) in found {
            if base && Some(seq) != top_patch {
                if repair {
                    let _ = fs::remove_file(history.base_path(seq));
                }
                if !patch {
                    continue;
                }
            }
            let path = history.patch_path(seq);
            let Ok(text) = fs::read_to_string(&path) else {
                history.unreadable.push(seq);
                continue;
            };
            let Some((header, diff)) = parse_version(&text).filter(|(h, _)| h.version == seq) else {
                history.unreadable.push(seq);
                continue;
            };
            let Ok(patches) = parse_patches(&diff) else {
                history.unreadable.push(seq);
                continue;
            };
            let base = if base && Some(seq) == top_patch {
                fs::read_to_string(history.base_path(seq))
                    .ok()
                    .and_then(|t| serde_json::from_str::<BaseFile>(&t).ok())
                    .map(|b| b.files)
            } else {
                None
            };
            history.versions.push(Loaded {
                seq,
                header,
                patches,
                bytes: text.len() as u64,
                base,
            });
        }
        Ok(history)
    }

    fn top(&self) -> Option<&Loaded> {
        self.versions.last()
    }

    fn highest_seq(&self) -> u64 {
        let readable = self.versions.last().map_or(0, |v| v.seq);
        readable.max(self.unreadable.iter().copied().max().unwrap_or(0))
    }

    fn write_patch(&self, header: &VersionHeader, patches: &[FilePatch]) -> EngineResult<()> {
        workspace::write_atomic(&self.patch_path(header.version), &format_version(header, patches))
    }

    fn write_base(&self, seq: u64, files: &SnapshotFiles) -> EngineResult<()> {
        let text = serde_json::to_string(&BaseFile { files: files.clone() }).expect("起点总能序列化");
        workspace::write_atomic(&self.base_path(seq), &text)
    }

    fn remove(&self, path: &Path) -> EngineResult<()> {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}

/// 从当前快照往回逐版反向应用得到的各版本的快照。
struct Chain {
    /// 每个版本结束时的快照。
    ends: BTreeMap<u64, SnapshotFiles>,
    /// 每个反向应用过的版本开始时的快照。
    starts: BTreeMap<u64, SnapshotFiles>,
    /// 往回走到这一版时对不上（或是读不出的版本文件）：它及更早的状态都得不到。
    broken_at: Option<u64>,
}

fn hashes_match(files: &SnapshotFiles, changes: &[FileChange], after: bool) -> bool {
    changes.iter().all(|c| {
        let expected = if after { &c.after } else { &c.before };
        files.get(&c.path).map(|t| crate::video::sha256_text(t)) == *expected
    })
}

/// 从 `current` 开始，按序号从新到旧逐版反向应用，直到 `lowest`（含）；比 `lowest` 旧的一版只记下它结束时的快照。
/// 每一步核对 `File` 行的摘要，要求精确匹配。
fn reconstruct(current: &SnapshotFiles, versions: &[Loaded], unreadable: &[u64], lowest: u64) -> Chain {
    let mut chain = Chain {
        ends: BTreeMap::new(),
        starts: BTreeMap::new(),
        broken_at: None,
    };
    let mut state = current.clone();
    for (index, version) in versions.iter().enumerate().rev() {
        if !hashes_match(&state, &version.header.files, true) {
            chain.broken_at = Some(version.seq);
            return chain;
        }
        chain.ends.insert(version.seq, state.clone());
        if version.seq < lowest {
            return chain;
        }
        match apply_files(&version.patches, &state, true) {
            Ok(before) if hashes_match(&before, &version.header.files, false) => state = before,
            _ => {
                chain.broken_at = Some(version.seq);
                return chain;
            }
        }
        chain.starts.insert(version.seq, state.clone());
        // 与更旧的读得出的版本之间夹着读不出的版本文件：链断在那个文件上。
        let previous = index.checked_sub(1).map(|i| versions[i].seq).unwrap_or(0);
        if let Some(gap) = unreadable.iter().filter(|u| **u > previous && **u < version.seq).max() {
            chain.broken_at = Some(*gap);
            return chain;
        }
    }
    chain
}

/// 版本文件与快照里提到的全部内容摘要（GC 的引用，架构设计 §5.5）：保留的版本能回到的状态引用的素材不被清理。
pub(crate) fn collect_snapshot_hashes(video_dir: &Path, out: &mut HashSet<String>) -> EngineResult<()> {
    let root = video_dir.join(SNAPSHOT_DIR);
    for (_, text) in workspace::read_files(&root).unwrap_or_default() {
        crate::gc::collect_hashes(&text, out);
    }
    let history = root.join(HISTORY_DIR);
    if history.is_dir() {
        for entry in fs::read_dir(&history)? {
            let path = entry?.path();
            if path.extension().is_some_and(|e| e == "patch" || e == "base")
                && let Ok(text) = fs::read_to_string(&path)
            {
                crate::gc::collect_hashes(&text, out);
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 簿记

/// 库的 meta 里关于快照的簿记。
struct Meta {
    revision: Option<i64>,
    files: Option<BTreeMap<String, String>>,
    pending: Option<BTreeMap<String, String>>,
    next: Option<u64>,
}

impl Meta {
    fn load(store: &Store) -> EngineResult<Meta> {
        let map = |key: &str| -> EngineResult<Option<BTreeMap<String, String>>> {
            store
                .meta(key)?
                .map(|text| serde_json::from_str(&text).map_err(|e| corrupt_meta(key, e)))
                .transpose()
        };
        let number = |key: &str| -> EngineResult<Option<i64>> {
            store
                .meta(key)?
                .map(|text| text.parse::<i64>().map_err(|e| corrupt_meta(key, e)))
                .transpose()
        };
        Ok(Meta {
            revision: number(META_REVISION)?,
            files: map(META_FILES)?,
            pending: map(META_PENDING)?,
            next: number(META_NEXT)?.map(|n| n.max(0) as u64),
        })
    }

    /// 磁盘上与上次写下（或正要写下）的都不同的文件：被外部改过。没写过快照而磁盘上已有文件，也算。
    fn changed_paths(&self, disk: &SnapshotFiles) -> Vec<String> {
        disk.iter()
            .filter(|(path, text)| {
                let hash = crate::video::sha256_text(text);
                let known = |m: &Option<BTreeMap<String, String>>| m.as_ref().and_then(|m| m.get(*path)) == Some(&hash);
                !known(&self.files) && !known(&self.pending)
            })
            .map(|(path, _)| path.clone())
            .collect()
    }
}

/// 一次写快照要做什么。
struct WriteSpec {
    kind: VersionKind,
    boundary: bool,
    conversations: Vec<ConversationRef>,
    keep: usize,
    name: Option<String>,
    note: Option<String>,
    checkpoint_id: Option<Id>,
    summary: Option<Text>,
}

impl WriteSpec {
    fn segment(request: &SnapshotRequest) -> WriteSpec {
        WriteSpec {
            kind: VersionKind::Segment,
            boundary: request.boundary.is_some(),
            conversations: request.conversations.clone(),
            keep: request.keep.unwrap_or(DEFAULT_KEEP),
            name: None,
            note: None,
            checkpoint_id: None,
            summary: None,
        }
    }

    fn flush(keep: Option<usize>) -> WriteSpec {
        WriteSpec::segment(&SnapshotRequest {
            keep,
            ..SnapshotRequest::default()
        })
    }
}

fn within_window(header: &VersionHeader, now: &str) -> bool {
    let (Some(now), Some(started), Some(updated)) = (
        unix_millis_from_rfc3339(now),
        unix_millis_from_rfc3339(&header.started_at),
        unix_millis_from_rfc3339(&header.updated_at),
    ) else {
        return false;
    };
    now - updated <= QUIET_MS && now - started <= MAX_SPAN_MS
}

/// 删掉若干版本之后，紧接着它们的版本的头部：起点取最早被删的那一版，动作与会话合在一起。
fn merge_headers(removed: &[&VersionHeader], next: &VersionHeader) -> VersionHeader {
    let mut merged = next.clone();
    if let Some(first) = removed.first() {
        merged.started_at = first.started_at.clone();
        merged.from_revision = first.from_revision.clone();
    }
    let mut actions = Vec::new();
    let mut omitted = 0;
    let mut conversations = Vec::new();
    for header in removed.iter().copied().chain(std::iter::once(next)) {
        group_actions(&mut actions, &mut omitted, header.actions.iter().cloned());
        omitted += header.actions_omitted;
        merge_conversations(&mut conversations, &header.conversations);
    }
    merged.actions = actions;
    merged.actions_omitted = omitted;
    merged.conversations = conversations;
    if merged.kind == VersionKind::Segment {
        resummarize(&mut merged);
    }
    merged
}

// ---------------------------------------------------------------------------
// 只读查询（不取锁）

/// 一部视频的版本列表，新的在前。
pub fn list_versions(video_dir: &Path) -> EngineResult<VersionList> {
    let history = History::load(video_dir.join(SNAPSHOT_DIR).join(HISTORY_DIR), false)?;
    let top = history.top().map(|v| v.seq);
    let mut versions: Vec<VersionEntry> = history
        .versions
        .into_iter()
        .map(|v| VersionEntry {
            open: Some(v.seq) == top && v.base.is_some() && v.header.kind == VersionKind::Segment,
            header: v.header,
            bytes: v.bytes,
        })
        .collect();
    versions.reverse();
    let mut unreadable = history.unreadable;
    unreadable.reverse();
    Ok(VersionList { versions, unreadable })
}

/// 一个版本的头部与 diff 文本。
pub fn read_version(video_dir: &Path, version: u64) -> EngineResult<VersionText> {
    let path = video_dir
        .join(SNAPSHOT_DIR)
        .join(HISTORY_DIR)
        .join(format!("{}.patch", seq_name(version)));
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(version_not_found(version)),
        Err(e) => return Err(e.into()),
    };
    let (header, diff) = parse_version(&text)
        .filter(|(h, _)| h.version == version)
        .ok_or_else(|| chain_broken(version))?;
    Ok(VersionText { header, diff })
}

/// 快照与库的关系（视频格式规范 §9.7）。只读，不取锁。
pub fn snapshot_status(video_dir: &Path) -> EngineResult<SnapshotStatus> {
    let root = video_dir.join(SNAPSHOT_DIR);
    let disk = workspace::read_files(&root)?;
    let history = History::load(root.join(HISTORY_DIR), false)?;
    let count = history.versions.len();
    let latest_version = history.top().map(|v| v.seq);
    let mut status = SnapshotStatus {
        state: SnapshotState::Missing,
        revision: None,
        snapshot_revision: None,
        changed_paths: Vec::new(),
        versions: count,
        latest_version,
    };
    let db = video_dir.join(DB_FILE);
    if !db.is_file() {
        if disk.contains_key(VIDEO_FILE) {
            status.state = SnapshotState::Rebuild;
            return Ok(status);
        }
        return Err(ErrorBody::not_found(kinds::video(), &video_dir.display().to_string()));
    }
    let store = Store::open(&db, true)?;
    let (state, _) = store.load()?;
    let meta = Meta::load(&store)?;
    status.revision = Some(state.revision.to_string());
    status.snapshot_revision = meta.revision.map(|r| r.to_string());
    let changed = meta.changed_paths(&disk);
    status.state = if !changed.is_empty() {
        status.changed_paths = changed;
        SnapshotState::Conflict
    } else if meta.files.is_none() || !disk.contains_key(VIDEO_FILE) {
        SnapshotState::Missing
    } else if meta.pending.is_some() || meta.revision.is_none_or(|r| r < state.revision) {
        SnapshotState::Pending
    } else {
        SnapshotState::Synced
    };
    Ok(status)
}

// ---------------------------------------------------------------------------
// 写

impl Video {
    fn snapshot_root(&self) -> PathBuf {
        self.dir.join(SNAPSHOT_DIR)
    }

    fn current_files(&self) -> EngineResult<SnapshotFiles> {
        let mut bodies = BTreeMap::new();
        for (id, record) in &self.state.documents {
            bodies.insert(id.clone(), self.document_text(id, &record.current_revision)?);
        }
        workspace::project(&self.state, &bodies, workspace::home_dir().as_deref())
    }

    /// 修订号在 `(from, to]` 里的事务组成的动作清单。
    fn actions_between(&self, from: i64, to: i64) -> EngineResult<(Vec<ActionGroup>, u64)> {
        let mut groups = Vec::new();
        let mut omitted = 0;
        let rows = self.store.transactions_between(&self.state.id, from, to)?;
        group_actions(
            &mut groups,
            &mut omitted,
            rows.into_iter().map(|(actor, label, label_ref)| ActionGroup {
                actor: actor.id,
                label,
                label_ref,
                count: 1,
            }),
        );
        Ok((groups, omitted))
    }

    fn save_meta(&mut self, files: &BTreeMap<String, String>) -> EngineResult<()> {
        let revision = self.state.revision.to_string();
        let files_json = serde_json::to_string(files).expect("摘要表总能序列化");
        let digest = workspace::digest(files);
        self.store.set_meta(&[
            (META_REVISION, Some(&revision)),
            (META_FILES, Some(&files_json)),
            (META_DIGEST, Some(&digest)),
            (META_PENDING, None),
        ])
    }

    /// 写快照（视频格式规范 §9.2）：只重写变了的文件，并按版本的边界并入当前版本或开新版本，开新版本后按保留规则清理。
    /// 磁盘上的快照被外部改过时不写，报 `SNAPSHOT_CONFLICT`。
    pub fn write_snapshot(&mut self, request: &SnapshotRequest) -> EngineResult<SnapshotWrite> {
        self.write_snapshot_at(request, &now_rfc3339())
    }

    /// 同 [`Video::write_snapshot`]，时间由调用方给（测试版本的边界）。
    pub fn write_snapshot_at(&mut self, request: &SnapshotRequest, now: &str) -> EngineResult<SnapshotWrite> {
        self.write_with(WriteSpec::segment(request), now)
    }

    fn write_with(&mut self, spec: WriteSpec, now: &str) -> EngineResult<SnapshotWrite> {
        self.ensure_writable()?;
        let root = self.snapshot_root();
        let next = self.current_files()?;
        let meta = Meta::load(&self.store)?;
        let disk = workspace::read_files(&root)?;
        let changed = meta.changed_paths(&disk);
        if !changed.is_empty() {
            return Err(snapshot_conflict(changed));
        }
        let history = History::load(root.join(HISTORY_DIR), true)?;
        let revision = self.state.revision;
        let next_hashes = workspace::hashes(&next);
        let disk_hashes = workspace::hashes(&disk);
        let consistent = meta.pending.is_none() && meta.files.as_ref() == Some(&disk_hashes);
        let unchanged = consistent && disk_hashes == next_hashes;
        let top = history.top();
        let mergeable = top.filter(|t| {
            spec.kind == VersionKind::Segment
                && !spec.boundary
                && t.header.kind == VersionKind::Segment
                && t.base.is_some()
                && within_window(&t.header, now)
        });
        let mut result = SnapshotWrite {
            revision: revision.to_string(),
            version: None,
            opened: false,
            written: Vec::new(),
            pruned: Vec::new(),
        };

        // 内容没变：不写文件、不开版本；当前版本还开着时把这段修订记进它的动作清单。
        if unchanged && spec.kind == VersionKind::Segment {
            if let Some(top) = mergeable
                && top.header.to_revision != revision.to_string()
            {
                let header = self.extended_header(&top.header, &spec, now)?;
                history.write_patch(&header, &top.patches)?;
                result.version = Some(top.seq);
            }
            self.save_meta(&next_hashes)?;
            return Ok(result);
        }

        let pending = serde_json::to_string(&next_hashes).expect("摘要表总能序列化");
        // 还没有版本：第一次写只写基线；重建后没有版本记录时同样只写基线。
        if top.is_none() && (!consistent || spec.kind == VersionKind::Rebuild) {
            self.store.set_meta(&[(META_PENDING, Some(&pending))])?;
            result.written = workspace::write_files(&root, &next, &disk)?;
            self.save_meta(&next_hashes)?;
            return Ok(result);
        }

        if let Some(top) = mergeable {
            // 并入当前版本：diff 从它的起点重算。
            let header = self.extended_header(&top.header, &spec, now)?;
            let base = top.base.as_ref().expect("可并入的版本有起点");
            self.store.set_meta(&[(META_PENDING, Some(&pending))])?;
            result.written = workspace::write_files(&root, &next, &disk)?;
            let patches = diff_files(base, &next);
            let header = VersionHeader {
                files: file_changes(&patches, base, &next),
                ..header
            };
            history.write_patch(&header, &patches)?;
            self.save_meta(&next_hashes)?;
            result.version = Some(top.seq);
            return Ok(result);
        }

        // 开新版本：起点是上一版结束时的快照（起点加 diff），没有时取磁盘上的。
        let start = top.and_then(Loaded::end).unwrap_or_else(|| disk.clone());
        if spec.kind == VersionKind::Segment && workspace::hashes(&start) == next_hashes {
            // 上一次写在记完簿记之前中断：版本已经写下，补完簿记即可。
            self.store.set_meta(&[(META_PENDING, Some(&pending))])?;
            result.written = workspace::write_files(&root, &next, &disk)?;
            self.save_meta(&next_hashes)?;
            return Ok(result);
        }
        let seq = (history.highest_seq() + 1).max(meta.next.unwrap_or(1));
        let from = meta.revision.unwrap_or(revision).min(revision);
        let (actions, omitted) = self.actions_between(from, revision)?;
        let mut header = VersionHeader {
            version: seq,
            kind: spec.kind,
            started_at: now.to_string(),
            updated_at: now.to_string(),
            from_revision: from.to_string(),
            to_revision: revision.to_string(),
            summary: String::new(),
            summary_ref: None,
            actions,
            actions_omitted: omitted,
            conversations: Vec::new(),
            name: spec.name.clone(),
            note: spec.note.clone(),
            checkpoint_id: spec.checkpoint_id.clone(),
            files: Vec::new(),
        };
        merge_conversations(&mut header.conversations, &spec.conversations);
        let summary = match (&spec.summary, spec.kind) {
            (Some(summary), _) => summary.clone(),
            (None, VersionKind::Save) => Text::plain(spec.name.clone().unwrap_or_default()),
            (None, VersionKind::Rebuild) => msg!("engine.versionSummaryRebuild", "Rebuilt from the snapshot"),
            (None, _) => summarize(&header.actions, header.actions_omitted),
        };
        set_summary(&mut header, summary);
        // 起点文件先落盘：它在，这一版就开了。
        history.write_base(seq, &start)?;
        let next_seq = (seq + 1).to_string();
        self.store
            .set_meta(&[(META_PENDING, Some(&pending)), (META_NEXT, Some(&next_seq))])?;
        result.written = workspace::write_files(&root, &next, &disk)?;
        let patches = diff_files(&start, &next);
        header.files = file_changes(&patches, &start, &next);
        history.write_patch(&header, &patches)?;
        if let Some(top) = top
            && top.base.is_some()
        {
            history.remove(&history.base_path(top.seq))?;
        }
        self.save_meta(&next_hashes)?;
        result.version = Some(seq);
        result.opened = true;
        result.pruned = prune(&root, &next, spec.keep)?;
        Ok(result)
    }

    /// 当前版本延续到现在：更新时间、修订号范围、动作清单与会话。
    fn extended_header(&self, header: &VersionHeader, spec: &WriteSpec, now: &str) -> EngineResult<VersionHeader> {
        let mut header = header.clone();
        let from = header.from_revision.parse::<i64>().unwrap_or(self.state.revision);
        let (actions, omitted) = self.actions_between(from, self.state.revision)?;
        header.updated_at = now.to_string();
        header.to_revision = self.state.revision.to_string();
        header.actions = actions;
        header.actions_omitted = omitted;
        merge_conversations(&mut header.conversations, &spec.conversations);
        resummarize(&mut header);
        Ok(header)
    }

    /// 回到一个版本（视频格式规范 §9.5）：先写一次快照，再从最新快照逐版反向应用到目标，作为一笔可撤销的事务应用，
    /// 并产生一个 `restore` 版本。检查点与保护不随版本走，保持现状。
    pub fn restore_version(&mut self, request: &RestoreRequest) -> EngineResult<RestoreResult> {
        self.ensure_writable()?;
        let hash = payload_hash(&json!({ "kind": "restoreVersion", "version": request.version, "before": request.before }));
        if let Some(replayed) = self.replay(&request.command_id, &hash)? {
            return Ok(RestoreResult {
                committed: Some(replayed),
                version: None,
            });
        }
        let now = now_rfc3339();
        self.write_with(WriteSpec::flush(request.keep), &now)?;
        let root = self.snapshot_root();
        let history = History::load(root.join(HISTORY_DIR), true)?;
        if !history.versions.iter().any(|v| v.seq == request.version) {
            return Err(if history.unreadable.contains(&request.version) {
                chain_broken(request.version)
            } else {
                version_not_found(request.version)
            });
        }
        let current = workspace::read_files(&root)?;
        let lowest = if request.before { request.version } else { request.version + 1 };
        let chain = reconstruct(&current, &history.versions, &history.unreadable, lowest);
        let target = if request.before {
            chain.starts.get(&request.version)
        } else {
            chain.ends.get(&request.version)
        };
        let Some(target) = target else {
            return Err(chain_broken(chain.broken_at.unwrap_or(request.version)));
        };
        let parsed = workspace::parse(target, workspace::home_dir().as_deref())?;
        let (next, documents) = self.restored_state(parsed)?;
        workspace::validate(&next)?;
        if VideoState::diff(&self.state, &next).is_empty() {
            return Ok(RestoreResult {
                committed: None,
                version: None,
            });
        }
        let version = request.version;
        let label = if request.before {
            msg!("engine.labelRestoreBeforeVersion", "Restore to before version {version}", version)
        } else {
            msg!("engine.labelRestoreVersion", "Restore version {version}", version)
        };
        let committed = self.commit(
            next,
            CommitInput::direct(request.command_id.clone(), hash, label.clone(), request.actor.clone(), documents)
                .with_protections(&request.protections),
        )?;
        let spec = WriteSpec {
            kind: VersionKind::Restore,
            summary: Some(label),
            ..WriteSpec::flush(request.keep)
        };
        let written = self.write_with(spec, &now)?;
        Ok(RestoreResult {
            committed: Some(committed),
            version: written.version,
        })
    }

    /// 还原出的快照 → 下一个状态：内容实体换成目标的，检查点与保护保持现状。文档版本能复用库里的就复用，
    /// 库里没有的连正文一起写入；同一版本号在库里是别的内容时换一个新号。
    fn restored_state(&self, parsed: workspace::ParsedSnapshot) -> EngineResult<(VideoState, Vec<DocumentBody>)> {
        let target = parsed.state;
        let mut next = self.state.clone();
        next.name = target.name;
        next.brief = target.brief;
        next.root_sequence_id = target.root_sequence_id;
        next.sequences = target
            .sequences
            .into_iter()
            .map(|(id, mut seq)| {
                seq.revision = self.state.sequences.get(&id).map_or(self.state.revision, |s| s.revision);
                (id, seq)
            })
            .collect();
        next.tracks = target.tracks;
        next.items = target.items;
        next.transitions = target.transitions;
        next.markers = target.markers;
        next.ducking = target.ducking;
        next.assets = target.assets;
        let mut bodies: BTreeMap<Id, DocumentBody> = parsed.documents.into_iter().map(|d| (d.document_id.clone(), d)).collect();
        let mut documents = Vec::new();
        next.documents = BTreeMap::new();
        for (id, mut record) in target.documents {
            let mut body = bodies.remove(&id).expect("每个文档都有正文");
            let mut version = record.revisions.remove(&record.current_revision).expect("文档头有当前版本");
            match self.store.document_version_hash(&self.state.id, &id, &version.revision)? {
                Some(hash) if hash == version.content_hash => {}
                None => documents.push(body),
                Some(_) => {
                    let known = self
                        .state
                        .documents
                        .get(&id)
                        .map_or(0, |d| d.revisions.keys().filter_map(|r| r.parse::<u64>().ok()).max().unwrap_or(0));
                    let fresh = (self.store.max_document_revision(&self.state.id, &id)?.max(known) + 1).to_string();
                    version.revision = fresh.clone();
                    body.revision = fresh;
                    documents.push(body);
                }
            }
            record.current_revision = version.revision.clone();
            if let Some(existing) = self.state.documents.get(&id) {
                record.revisions = existing.revisions.clone();
            }
            record.revisions.insert(version.revision.clone(), version);
            next.documents.insert(id, record);
        }
        Ok((next, documents))
    }

    /// 把当前状态存成一个具名版本（视频格式规范 §9.6）：先写快照，再建一个检查点，最后写一个钉住的 `save` 版本。
    /// 同一个 commandId 重试时返回已有的版本。
    pub fn save_version(&mut self, request: &SaveRequest) -> EngineResult<SaveResult> {
        self.ensure_writable()?;
        if let Some((_, receipt)) = self.store.find_by_key(&self.state.id, &request.command_id)? {
            let checkpoint_id = receipt
                .created_ids
                .iter()
                .find(|id| id.starts_with("ckpt_"))
                .cloned()
                .unwrap_or_default();
            let version = list_versions(&self.dir)?
                .versions
                .into_iter()
                .find(|v| v.header.checkpoint_id.as_deref() == Some(checkpoint_id.as_str()))
                .map(|v| v.header.version)
                .ok_or_else(|| ErrorBody::idempotency_conflict(&request.command_id))?;
            return Ok(SaveResult {
                committed: Committed { receipt, event: None },
                version,
                checkpoint_id,
            });
        }
        let now = now_rfc3339();
        self.write_with(WriteSpec::flush(request.keep), &now)?;
        let label = msg!("engine.labelSaveVersion", "Save version");
        let mut op = json!({ "type": "createCheckpoint", "name": request.name });
        if let Some(note) = &request.note {
            op["note"] = json!(note);
        }
        let committed = self.apply(&VideoTransaction {
            command_id: request.command_id.clone(),
            expected_revision: self.revision(),
            label: Some(label.text),
            label_ref: label.message_ref,
            operations: vec![op],
            actor: request.actor.clone(),
            task_id: None,
        })?;
        let checkpoint_id = committed
            .receipt
            .created_ids
            .iter()
            .find(|id| self.state.checkpoints.contains_key(*id))
            .cloned()
            .expect("建检查点的事务有新的检查点");
        let name = self.state.checkpoints[&checkpoint_id].name.clone();
        let spec = WriteSpec {
            kind: VersionKind::Save,
            name: Some(name),
            note: request.note.clone(),
            checkpoint_id: Some(checkpoint_id.clone()),
            ..WriteSpec::flush(request.keep)
        };
        let written = self.write_with(spec, &now)?;
        Ok(SaveResult {
            committed,
            version: written.version.expect("保存的版本总会写下"),
            checkpoint_id,
        })
    }

    /// 删掉一个保存的版本：两侧的 diff 合并（视频格式规范 §9.4），并删掉它的检查点。
    pub fn delete_version(&mut self, request: &DeleteRequest) -> EngineResult<DeleteResult> {
        self.ensure_writable()?;
        let hash = payload_hash(&json!({ "kind": "deleteVersion", "version": request.version }));
        if let Some(replayed) = self.replay(&request.command_id, &hash)? {
            return Ok(DeleteResult { committed: Some(replayed) });
        }
        self.write_with(WriteSpec::flush(None), &now_rfc3339())?;
        let root = self.snapshot_root();
        let history = History::load(root.join(HISTORY_DIR), true)?;
        let Some(index) = history.versions.iter().position(|v| v.seq == request.version) else {
            return Err(version_not_found(request.version));
        };
        let target = &history.versions[index];
        if target.header.kind != VersionKind::Save {
            return Err(
                ErrorBody::invalid_operation(msg!("engine.versionNotSaved", "Only saved versions can be deleted"))
                    .details(json!({ "version": request.version })),
            );
        }
        let checkpoint_id = target.header.checkpoint_id.clone();
        if index + 1 == history.versions.len() {
            // 最新一版：变回普通版本，之后的改动可以并进来。
            let mut header = target.header.clone();
            header.kind = VersionKind::Segment;
            header.name = None;
            header.note = None;
            header.checkpoint_id = None;
            resummarize(&mut header);
            history.write_patch(&header, &target.patches)?;
        } else {
            let current = workspace::read_files(&root)?;
            let removed = remove_versions(&history, &current, &BTreeSet::from([request.version]))?;
            if removed.is_empty() {
                let chain = reconstruct(&current, &history.versions, &history.unreadable, 0);
                return Err(chain_broken(chain.broken_at.unwrap_or(request.version)));
            }
        }
        let Some(checkpoint_id) = checkpoint_id.filter(|id| self.state.checkpoints.contains_key(id)) else {
            return Ok(DeleteResult { committed: None });
        };
        let mut next = self.state.clone();
        next.checkpoints.remove(&checkpoint_id);
        let label = msg!("engine.labelDeleteSavedVersion", "Delete saved version");
        let committed = self.commit(
            next,
            CommitInput::direct(request.command_id.clone(), hash, label, request.actor.clone(), Vec::new()),
        )?;
        Ok(DeleteResult {
            committed: Some(committed),
        })
    }

    /// 只有快照、没有 `video.db` 的目录：就地重建视频（视频格式规范 §9.7）。保留快照里的 videoId，修订号从 1 开始，
    /// 文档按当前版本导入；目录里还有版本记录时追加一个 `rebuild` 版本，更早的版本照常可以回到。
    pub fn rebuild_from_snapshot(dir: &Path, ffprobe: &Path, keep: Option<usize>) -> EngineResult<Video> {
        if dir.join(DB_FILE).exists() || dir.join("movie.db").exists() {
            return Err(
                ErrorBody::invalid_operation(msg!("engine.videoExists", "This directory already has a video"))
                    .details(json!({ "path": dir })),
            );
        }
        let root = dir.join(SNAPSHOT_DIR);
        let files = workspace::read_files(&root)?;
        if !files.contains_key(VIDEO_FILE) {
            return Err(ErrorBody::not_found(kinds::video(), &dir.display().to_string()));
        }
        let parsed = workspace::parse(&files, workspace::home_dir().as_deref())?;
        let mut state = parsed.state;
        state.revision = 1;
        for sequence in state.sequences.values_mut() {
            sequence.revision = 1;
        }
        workspace::validate(&state)?;
        fs::create_dir_all(dir.join("blobs").join(".staging"))?;
        let lock = acquire_lock(&dir.join(LOCK_FILE))?;
        let db = dir.join(DB_FILE);
        if db.exists() {
            return Err(
                ErrorBody::invalid_operation(msg!("engine.videoExists", "This directory already has a video"))
                    .details(json!({ "path": dir })),
            );
        }
        let created = (|| -> EngineResult<()> {
            let mut store = Store::create(&db, &state, &now_rfc3339())?;
            store.import_versions(&state, &parsed.documents)?;
            let hashes = workspace::hashes(&files);
            let files_json = serde_json::to_string(&hashes).expect("摘要表总能序列化");
            let digest = workspace::digest(&hashes);
            store.set_meta(&[
                (META_REVISION, Some("1")),
                (META_FILES, Some(&files_json)),
                (META_DIGEST, Some(&digest)),
            ])?;
            Ok(())
        })();
        if let Err(error) = created {
            for suffix in ["", "-wal", "-shm", "-journal"] {
                let _ = fs::remove_file(dir.join(format!("{DB_FILE}{suffix}")));
            }
            return Err(error);
        }
        drop(lock);
        let mut video = Video::open(dir, OpenMode::Write, ffprobe)?;
        let spec = WriteSpec {
            kind: VersionKind::Rebuild,
            ..WriteSpec::flush(keep)
        };
        video.write_with(spec, &now_rfc3339())?;
        Ok(video)
    }
}

/// 按保留规则清理：保留最近 `keep` 个未命名版本（含最新一版）与全部保存的版本，总大小超过上限时再从最旧的未命名版本删起。
/// 最新一版总是留着。
fn prune(root: &Path, current: &SnapshotFiles, keep: usize) -> EngineResult<Vec<u64>> {
    let history = History::load(root.join(HISTORY_DIR), false)?;
    let Some(top) = history.top().map(|v| v.seq) else {
        return Ok(Vec::new());
    };
    let candidates: Vec<&Loaded> = history
        .versions
        .iter()
        .filter(|v| v.seq != top && v.header.kind != VersionKind::Save)
        .collect();
    let unnamed = history.versions.iter().filter(|v| v.header.kind != VersionKind::Save).count();
    let excess = unnamed.saturating_sub(keep.max(1)).min(candidates.len());
    let mut remove: BTreeSet<u64> = candidates.iter().take(excess).map(|v| v.seq).collect();
    let mut total: u64 = history.versions.iter().filter(|v| !remove.contains(&v.seq)).map(|v| v.bytes).sum();
    if total > SIZE_CAP {
        for version in &candidates {
            if total <= SIZE_CAP / 10 * 9 {
                break;
            }
            if remove.insert(version.seq) {
                total -= version.bytes;
            }
        }
    }
    if remove.is_empty() {
        return Ok(Vec::new());
    }
    remove_versions(&history, current, &remove)
}

/// 删掉一组版本。最旧的一段直接删文件；中间的，紧接着的那一版的 diff 改为从被删的一段之前直接算到它自己。
/// 版本链对不上时，需要合并的那些留着不删。
fn remove_versions(history: &History, current: &SnapshotFiles, remove: &BTreeSet<u64>) -> EngineResult<Vec<u64>> {
    let mut removed = Vec::new();
    let versions = &history.versions;
    let needs_chain = versions
        .iter()
        .position(|v| !remove.contains(&v.seq))
        .is_some_and(|first_kept| versions[first_kept..].iter().any(|v| remove.contains(&v.seq)));
    let chain = needs_chain.then(|| reconstruct(current, versions, &history.unreadable, 0));
    let mut index = 0;
    while index < versions.len() {
        if !remove.contains(&versions[index].seq) {
            index += 1;
            continue;
        }
        let run_end = versions[index..]
            .iter()
            .position(|v| !remove.contains(&v.seq))
            .map_or(versions.len(), |p| index + p);
        let run = &versions[index..run_end];
        if index == 0 {
            // 最旧的一段：没有更早的版本依赖它们。
            for version in run {
                history.remove(&history.patch_path(version.seq))?;
                removed.push(version.seq);
            }
        } else if let (Some(next), Some(chain)) = (versions.get(run_end), &chain) {
            let previous = &versions[index - 1];
            if let (Some(start), Some(end)) = (chain.ends.get(&previous.seq), chain.ends.get(&next.seq)) {
                let headers: Vec<&VersionHeader> = run.iter().map(|v| &v.header).collect();
                let mut header = merge_headers(&headers, &next.header);
                let patches = diff_files(start, end);
                header.files = file_changes(&patches, start, end);
                if next.base.is_some() {
                    history.write_base(next.seq, start)?;
                }
                history.write_patch(&header, &patches)?;
                for version in run {
                    history.remove(&history.patch_path(version.seq))?;
                    removed.push(version.seq);
                }
            }
        }
        index = run_end;
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header() -> VersionHeader {
        VersionHeader {
            version: 12,
            kind: VersionKind::Segment,
            started_at: "2026-10-17T09:41:07.000Z".into(),
            updated_at: "2026-10-17T10:02:55.000Z".into(),
            from_revision: "40".into(),
            to_revision: "57".into(),
            summary: "Trim clip and more (14 changes)".into(),
            summary_ref: Some(MessageRef::new("engine.labelMoreChanges").param("count", json!(14))),
            actions: vec![
                ActionGroup {
                    actor: "agent_claude".into(),
                    label: "Cut | pauses\nnow".into(),
                    label_ref: None,
                    count: 3,
                },
                ActionGroup {
                    actor: "user_local".into(),
                    label: "Trim clip".into(),
                    label_ref: Some(MessageRef::new("engine.labelTrimClip")),
                    count: 11,
                },
            ],
            actions_omitted: 2,
            conversations: vec![ConversationRef {
                id: "conv_8f2".into(),
                title: "发布会 \\ 粗剪".into(),
            }],
            name: Some("Before review".into()),
            note: Some("line one\r\nline two".into()),
            checkpoint_id: Some("ckpt_1".into()),
            files: vec![
                FileChange {
                    path: "video.json".into(),
                    before: Some("sha256:a".into()),
                    after: Some("sha256:b".into()),
                },
                FileChange {
                    path: "documents/doc_1.json".into(),
                    before: None,
                    after: Some("sha256:c".into()),
                },
            ],
        }
    }

    #[test]
    fn headers_round_trip_with_escapes() {
        let header = header();
        let text = format_version(&header, &[]);
        assert!(text.contains("Action: agent_claude | Cut | pauses\\nnow | 3\n"));
        assert!(text.contains("File: documents/doc_1.json - sha256:c\n"));
        assert!(text.ends_with("\n\n"));
        let (parsed, diff) = parse_version(&text).unwrap();
        assert_eq!(parsed, header);
        assert_eq!(diff, "");
    }

    #[test]
    fn actions_fold_after_the_limit() {
        let mut groups = Vec::new();
        let mut omitted = 0;
        let items = (0..60).map(|i| ActionGroup {
            actor: "user_local".into(),
            label: format!("Edit {i}"),
            label_ref: None,
            count: 1,
        });
        group_actions(&mut groups, &mut omitted, items);
        assert_eq!((groups.len(), omitted), (MAX_ACTION_GROUPS, 10));
        assert_eq!(summarize(&groups, omitted).text, "Edit 0 and more (60 changes)");
        assert_eq!(summarize(&groups[..1], 0).text, "Edit 0");
        let mut repeated = groups[..1].to_vec();
        repeated[0].count = 4;
        assert_eq!(summarize(&repeated, 0).text, "Edit 0 (4 changes)");
    }

    #[test]
    fn the_window_closes_after_quiet_or_span() {
        let mut header = header();
        header.started_at = "2026-10-17T10:00:00.000Z".into();
        header.updated_at = "2026-10-17T10:20:00.000Z".into();
        assert!(within_window(&header, "2026-10-17T10:24:59.000Z"));
        assert!(!within_window(&header, "2026-10-17T10:25:01.000Z"), "安静超过 5 分钟");
        header.updated_at = "2026-10-17T10:29:00.000Z".into();
        assert!(!within_window(&header, "2026-10-17T10:30:01.000Z"), "超过 30 分钟");
    }
}
