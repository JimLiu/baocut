//! 一个打开的视频：写锁、工作态与事务（架构设计 §2.3、§5.2；命令与协议规范 §3、§8）。
//!
//! 写入顺序：解析操作 → 幂等与版本检查 → 事务外准备导入 → 在副本上执行 → 校验重叠 →
//! 与工作态比较得到变更集 → 原子提交 → 替换工作态。任何一步失败，工作态与存储都不变。

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use editor_semantics::Rate;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::error::{EngineResult, ErrorBody, kinds, msg};
use crate::ids::{new_id, new_transaction_id, now_rfc3339};
use crate::import::{
    DIRECTORY_MEDIA_TYPE, PreparedAsset, blob_rel_path, hash_file, hash_tree, link_locator, locate_linked, prepare_import, publish_tree,
    publish_verified,
};
use crate::model::*;
use crate::ops::{EditContext, EditOperation, apply_operation, check_overlaps, parse_operation};
use crate::receipt::*;
use crate::state::{EntityChange, EntityKind, Placed, SequenceEntity, VideoState};
use crate::store::{CommitRecord, DocumentBody, ProjectClaim, Store, UndoRecord, UndoStep};
use crate::task_guard::TaskProtection;

pub const DB_FILE: &str = "video.db";
pub const LOCK_FILE: &str = "video.lock";
/// 改名为「视频」之前的目录布局：`movie.db`、`movie.lock`，格式标识 `baocut.movie`。打开时就地升级一次。
const LEGACY_DB_FILE: &str = "movie.db";
const LEGACY_LOCK_FILE: &str = "movie.lock";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpenMode {
    Write,
    ReadOnly,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOptions {
    pub name: String,
    pub fps: Rate,
    pub width: u32,
    pub height: u32,
}

/// 一笔编辑事务（命令与协议规范 §3.1）。操作者由 Runtime 从认证的连接构造。
#[derive(Clone, Debug, PartialEq)]
pub struct VideoTransaction {
    pub command_id: Id,
    pub expected_revision: Revision,
    pub label: Option<String>,
    pub operations: Vec<Value>,
    pub actor: Actor,
    pub task_id: Option<Id>,
}

/// 撤销的目标：指定的一笔事务，或这个操作者撤销栈上的下一步。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UndoTarget {
    Transaction(Id),
    Undo,
    Redo,
}

/// 一次撤销请求：补偿目标那笔事务。
#[derive(Clone, Debug, PartialEq)]
pub struct UndoRequest {
    pub command_id: Id,
    pub target: UndoTarget,
    pub expected_revision: Option<Revision>,
    pub actor: Actor,
}

/// 操作者当前可以撤销与重做的一步。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo: Option<UndoStep>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redo: Option<UndoStep>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Committed {
    pub receipt: TransactionReceipt,
    /// 重放的幂等请求没有新事件。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<VideoEvent>,
}

/// 一个此刻读不到的素材版本（`videos.assetStatus`）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingAsset {
    pub asset_id: Id,
    pub revision: Revision,
    /// `missing`、`changed` 或 `outside-project`。
    pub reason: String,
    /// 链接素材登记的路径；收进视频的素材没有。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<String>,
}

pub struct Video {
    dir: PathBuf,
    store: Store,
    state: VideoState,
    generation: i64,
    mode: OpenMode,
    ffprobe: PathBuf,
    // 持有期间不释放的写锁。进程退出时由内核释放。
    _lock: Option<WriteLock>,
}

/// 持有中的写锁（`flock`）。drop 时先显式解锁再关闭。
///
/// `flock` 挂在打开的文件描述上，只靠关闭的话，要等引用它的 fd 全部关掉才释放。同一进程里别的线程正在起子进程时
/// （ffprobe、ffmpeg；posix_spawn 与 fork 一样先复制整张 fd 表，到 exec 才关掉 close-on-exec 的那些），
/// 子进程手里的副本会让锁多留一会儿，紧接着重新打开就撞上自己留下的 `VIDEO_LOCKED`。显式解锁不等这些副本。
pub(crate) struct WriteLock(File);

impl Drop for WriteLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

/// 取得视频目录的写锁（`path` 是锁文件），并写入持有者信息供别的进程报告（验收 C03）。
pub(crate) fn acquire_lock(path: &Path) -> EngineResult<WriteLock> {
    let mut file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(path)?;
    match file.try_lock() {
        Ok(()) => {
            // 先包起来：写持有者信息失败提前返回时也显式解锁。
            let mut lock = WriteLock(file);
            let holder = json!({ "pid": std::process::id(), "acquiredAt": now_rfc3339() });
            lock.0.set_len(0)?;
            lock.0.seek(SeekFrom::Start(0))?;
            lock.0.write_all(holder.to_string().as_bytes())?;
            lock.0.sync_all()?;
            Ok(lock)
        }
        Err(fs::TryLockError::WouldBlock) => {
            let mut text = String::new();
            let _ = file.read_to_string(&mut text);
            let holder = serde_json::from_str::<Value>(&text).unwrap_or(Value::Null);
            Err(ErrorBody::video_locked(holder))
        }
        Err(fs::TryLockError::Error(e)) => Err(e.into()),
    }
}

/// 旧布局的目录（只有 `movie.db`）就地升级：持旧锁改写数据库，再把数据库（连同 `-wal`、`-shm`）与锁文件改名。
/// 改写看格式标识、改名看 `video.db` 在不在，两步都可重做：中途失败，下次打开接着做。
fn upgrade_legacy_dir(dir: &Path) -> EngineResult<()> {
    let legacy = dir.join(LEGACY_DB_FILE);
    if dir.join(DB_FILE).exists() || !legacy.is_file() {
        return Ok(());
    }
    let lock = acquire_lock(&dir.join(LEGACY_LOCK_FILE))?;
    Store::upgrade_legacy(&legacy)?;
    for suffix in ["-wal", "-shm", ""] {
        let from = dir.join(format!("{LEGACY_DB_FILE}{suffix}"));
        if from.exists() {
            fs::rename(&from, dir.join(format!("{DB_FILE}{suffix}")))?;
        }
    }
    drop(lock);
    fs::rename(dir.join(LEGACY_LOCK_FILE), dir.join(LOCK_FILE))?;
    Ok(())
}

/// 不打开视频地认领所属项目（Runtime 打开项目时的预处理）：取写锁、认领、立即释放，不读工作态，不递增所有者代。
/// 视频正被别处打开时返回 `VIDEO_LOCKED`，留到下次。
pub fn claim_project_dir(dir: &Path, project_id: &str) -> EngineResult<(Id, ProjectClaim)> {
    upgrade_legacy_dir(dir)?;
    let db = dir.join(DB_FILE);
    if !db.is_file() {
        return Err(ErrorBody::not_found(kinds::video(), &dir.display().to_string()));
    }
    let _lock = acquire_lock(&dir.join(LOCK_FILE))?;
    let mut store = Store::open(&db, false)?;
    let video_id = store.video_id()?;
    let claim = store.claim_project(&video_id, project_id, &new_id("video"))?;
    let current = match &claim {
        ProjectClaim::Reassigned { video_id, .. } => video_id.clone(),
        _ => video_id,
    };
    Ok((current, claim))
}

/// 递归地按键排序。不依赖 serde_json 的 Map 是否保留插入顺序（那取决于 Cargo 的 feature）。
fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let sorted: BTreeMap<&String, Value> = map.iter().map(|(k, v)| (k, canonical(v))).collect();
            Value::Object(sorted.into_iter().map(|(k, v)| (k.clone(), v)).collect())
        }
        Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
        other => other.clone(),
    }
}

/// 键有序的 JSON 文本。
pub fn canonical_json(value: &Value) -> String {
    canonical(value).to_string()
}

pub fn sha256_text(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("sha256:{hex}")
}

/// 规范化的载荷摘要：键有序的 JSON 再求 sha256。键的顺序不同的同一请求得到同一摘要（验收 T06、C05）。
pub fn payload_hash(payload: &Value) -> String {
    sha256_text(&canonical_json(payload))
}

/// 素材的一个版本此刻在哪里、能不能用。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAsset {
    pub path: PathBuf,
    pub storage: &'static str,
    pub media_type: String,
    pub byte_length: u64,
    pub name: String,
}

/// 一份文档的某个版本：文档头与正文。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentContent {
    pub document: DocumentRecord,
    pub revision: Revision,
    pub body: Value,
}

fn with_operation_index(mut err: ErrorBody, index: usize) -> ErrorBody {
    match &mut err.details {
        Value::Object(map) => {
            map.entry("operationIndex").or_insert(json!(index));
        }
        Value::Null => err.details = json!({ "operationIndex": index }),
        other => err.details = json!({ "operationIndex": index, "detail": other.clone() }),
    }
    err
}

fn operation_label(op: &EditOperation) -> &'static str {
    match op {
        EditOperation::ImportAsset { .. } => "导入素材",
        EditOperation::CollectAssets { .. } => "收纳素材",
        EditOperation::RemoveAssets { .. } => "清理素材",
        EditOperation::RelinkAsset { .. } => "重新链接素材",
        EditOperation::InsertItems { .. } => "添加片段",
        EditOperation::PutDocument { .. } => "写入文档",
        EditOperation::AddItem { .. } => "添加片段",
        EditOperation::MoveItem { .. } | EditOperation::MoveItems { .. } => "移动片段",
        EditOperation::TrimItem { .. } => "裁切片段",
        EditOperation::SplitItem { .. } => "拆分片段",
        EditOperation::JoinItems { .. } => "合并片段",
        EditOperation::AddCuts { .. } => "剪掉片段",
        EditOperation::RestoreCut { .. } => "恢复剪口",
        EditOperation::ProposeCuts { .. } => "提出剪辑建议",
        EditOperation::AcceptCutSuggestions { .. } => "接受剪辑建议",
        EditOperation::DeleteItems { .. } => "删除片段",
        EditOperation::RemoveRange { .. } => "删除一段时间",
        EditOperation::AddTrack { .. } => "新建轨道",
        EditOperation::DeleteTrack { .. } => "删除轨道",
        EditOperation::UpdateTrack { .. } => "修改轨道",
        EditOperation::UpdateItem { .. } => "修改片段",
        EditOperation::SetTransform { .. } => "调整位置与大小",
        EditOperation::SetStyle { .. } => "修改样式",
        EditOperation::SetText { .. } => "修改文字",
        EditOperation::SetProps { .. } => "修改参数",
        EditOperation::SetAnimation { .. } => "设置动画",
        EditOperation::SetKeyframes { .. } => "设置关键帧",
        EditOperation::SetTemplate { .. } => "设置模板",
        EditOperation::SetCodeParameters { .. } => "修改参数",
        EditOperation::ReplaceCodeBundle { .. } => "替换代码画面",
        EditOperation::SetAudioMix { .. } => "调整声音",
        EditOperation::SetSpeed { .. } => "变速",
        EditOperation::SetCaptionStyle { .. } => "更换字幕样式",
        EditOperation::UpdateSequence { .. } => "修改视频设置",
        EditOperation::SetTransition { .. } => "设置转场",
        EditOperation::RemoveTransition { .. } => "删除转场",
        EditOperation::SetEffects { .. } => "修改效果",
        EditOperation::SetChapters { .. } => "设置章节",
        EditOperation::UpsertChapter { .. } => "修改章节",
        EditOperation::RemoveChapter { .. } => "删除章节",
        EditOperation::SetDucking { .. } => "设置闪避",
        EditOperation::RemoveDucking { .. } => "删除闪避",
        EditOperation::CreateCheckpoint { .. } => "保存检查点",
        EditOperation::RenameVideo { .. } => "重命名视频",
    }
}

fn default_label(ops: &[EditOperation]) -> String {
    let first = ops.first().map_or("编辑", operation_label);
    // 「导入并添加」视为一次添加。
    let main = ops
        .iter()
        .find(|op| !matches!(op, EditOperation::ImportAsset { .. }))
        .map_or(first, operation_label);
    let distinct: BTreeSet<&str> = ops.iter().map(operation_label).filter(|l| *l != "导入素材").collect();
    if distinct.len() > 1 {
        format!("{main}等 {} 项修改", ops.len())
    } else {
        main.to_string()
    }
}

impl Video {
    /// 在空目录（或不存在的目录）里新建视频：一条根序列，V1 与 A1 两条轨道。
    pub fn create(dir: &Path, options: &CreateOptions, ffprobe: &Path) -> EngineResult<Video> {
        options.fps.validate("fps")?;
        if options.width == 0 || options.height == 0 || options.width > 16384 || options.height > 16384 {
            return Err(ErrorBody::invalid_operation(msg!("engine.canvasSizeRange", "The canvas size must be between 1 and 16384")));
        }
        let name = options.name.trim();
        if name.is_empty() || name.chars().count() > 200 {
            return Err(ErrorBody::invalid_operation(msg!("engine.videoNameLength", "The video name must be 1–200 characters")));
        }
        if dir.join(DB_FILE).exists() || dir.join(LEGACY_DB_FILE).exists() {
            return Err(ErrorBody::invalid_operation(msg!("engine.videoExists", "This directory already has a video")).details(json!({ "path": dir })));
        }
        fs::create_dir_all(dir.join("blobs").join(".staging"))?;
        let lock = acquire_lock(&dir.join(LOCK_FILE))?;

        let video_id = new_id("video");
        let sequence_id = new_id("seq");
        let mut state = VideoState {
            id: video_id.clone(),
            name: name.to_string(),
            root_sequence_id: sequence_id.clone(),
            revision: 0,
            event_seq: 0,
            sequences: BTreeMap::new(),
            tracks: BTreeMap::new(),
            items: BTreeMap::new(),
            assets: BTreeMap::new(),
            documents: BTreeMap::new(),
            checkpoints: BTreeMap::new(),
            protections: BTreeMap::new(),
            transitions: BTreeMap::new(),
            markers: BTreeMap::new(),
            ducking: BTreeMap::new(),
        };
        state.sequences.insert(
            sequence_id.clone(),
            SequenceEntity {
                header: SequenceHeader {
                    name: "主序列".into(),
                    fps: options.fps,
                    canvas: Canvas {
                        width: options.width,
                        height: options.height,
                        working_space: "srgb".into(),
                        background: DEFAULT_CANVAS_BACKGROUND.into(),
                    },
                    duration_policy: DurationPolicy::Derived,
                    animation_bindings: Vec::new(),
                    template: None,
                },
                revision: 0,
            },
        );
        for (order, kind, label, group) in [
            (0, TrackKind::Visual, "V1", SoloGroup::Visual),
            (1, TrackKind::Audio, "A1", SoloGroup::Audio),
        ] {
            let id = new_id("track");
            state.tracks.insert(
                id.clone(),
                Placed {
                    sequence_id: sequence_id.clone(),
                    value: Track {
                        id,
                        order,
                        kind,
                        name: Some(label.into()),
                        locked: false,
                        visible: true,
                        muted: false,
                        solo: Solo { enabled: false, group },
                    },
                },
            );
        }
        let mut store = Store::create(&dir.join(DB_FILE), &state, &now_rfc3339())?;
        let generation = store.bump_generation(&video_id)?;
        Ok(Video {
            dir: dir.to_path_buf(),
            store,
            state,
            generation,
            mode: OpenMode::Write,
            ffprobe: ffprobe.to_path_buf(),
            _lock: Some(lock),
        })
    }

    pub fn open(dir: &Path, mode: OpenMode, ffprobe: &Path) -> EngineResult<Video> {
        upgrade_legacy_dir(dir)?;
        let db = dir.join(DB_FILE);
        if !db.is_file() {
            return Err(ErrorBody::not_found(kinds::video(), &dir.display().to_string()));
        }
        let lock = match mode {
            OpenMode::Write => Some(acquire_lock(&dir.join(LOCK_FILE))?),
            OpenMode::ReadOnly => None,
        };
        let mut store = Store::open(&db, mode == OpenMode::ReadOnly)?;
        let (state, mut generation) = store.load()?;
        if mode == OpenMode::Write {
            // 取得写入权：所有者代递增，旧的写入者即使还活着，条件提交也会失败。
            generation = store.bump_generation(&state.id)?;
            fs::create_dir_all(dir.join("blobs").join(".staging"))?;
        }
        Ok(Video {
            dir: dir.to_path_buf(),
            store,
            state,
            generation,
            mode,
            ffprobe: ffprobe.to_path_buf(),
            _lock: lock,
        })
    }

    /// 认领所属项目（架构设计 §5.1）：Runtime 打开或新建项目里的视频时传入项目的 id。
    /// 属于另一个项目时换成新的 videoId（副本），内容、修订号与历史不变。只读打开时不能认领。
    pub fn claim_project(&mut self, project_id: &str) -> EngineResult<ProjectClaim> {
        if self.mode != OpenMode::Write {
            return Err(ErrorBody::invalid_operation(msg!(
                "engine.claimReadOnly",
                "A video opened read-only cannot claim a project"
            )));
        }
        let claim = self.store.claim_project(&self.state.id, project_id, &new_id("video"))?;
        if let ProjectClaim::Reassigned { video_id, .. } = &claim {
            self.state.id = video_id.clone();
        }
        Ok(claim)
    }

    /// 视频所属的项目；还没有认领过时为空。
    pub fn project_id(&self) -> EngineResult<Option<Id>> {
        self.store.project_id()
    }

    /// 这个视频曾经用过的 videoId（换标识的来历），旧的在前。
    pub fn previous_video_ids(&self) -> EngineResult<Vec<Id>> {
        self.store.previous_video_ids()
    }

    pub fn id(&self) -> &str {
        &self.state.id
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn mode(&self) -> OpenMode {
        self.mode
    }

    pub fn state(&self) -> &VideoState {
        &self.state
    }

    pub fn revision(&self) -> String {
        self.state.revision.to_string()
    }

    pub fn event_seq(&self) -> i64 {
        self.state.event_seq
    }

    pub fn snapshot(&self) -> VideoSnapshot {
        self.state.snapshot()
    }

    pub fn history(&self, limit: i64) -> EngineResult<Vec<HistoryEntry>> {
        self.store.history(&self.state.id, limit.clamp(1, 500))
    }

    pub fn events_after(&self, after: i64, limit: i64) -> EngineResult<Vec<VideoEvent>> {
        self.store.events_after(&self.state.id, after, limit.clamp(1, 1000))
    }

    pub fn undo_state(&self, actor: &Actor) -> EngineResult<UndoState> {
        let actor = serde_json::to_string(actor).expect("能序列化");
        let (undo, redo) = self.store.undo_steps(&self.state.id, &actor)?;
        Ok(UndoState { undo, redo })
    }

    /// 用 commandId 找回已提交的回执（响应在途中丢失时）。
    pub fn find_receipt(&self, command_id: &str) -> EngineResult<Option<TransactionReceipt>> {
        Ok(self.store.find_by_key(&self.state.id, command_id)?.map(|(_, receipt)| receipt))
    }

    /// 素材某个版本的 bytes 此刻的位置：受管理的在视频目录的 `blobs/` 里，链接的在它的定位上。
    /// 链接的文件不在了，或长度已经不是登记的长度，按 `ASSET_MISSING` 报告，不拿别的 bytes 顶替。
    pub fn resolve_asset(&self, asset_id: &str, revision: Option<&str>) -> EngineResult<ResolvedAsset> {
        let asset = self
            .state
            .assets
            .get(asset_id)
            .ok_or_else(|| ErrorBody::not_found(kinds::asset(), asset_id))?;
        let rev = revision.unwrap_or(&asset.current_revision);
        let record = asset
            .revisions
            .get(rev)
            .ok_or_else(|| ErrorBody::asset_missing(
                asset_id,
                msg!("engine.assetRevisionMissing", "The asset has no revision {revision}", revision = rev),
            ))?;
        let is_tree = record.media_type == DIRECTORY_MEDIA_TYPE;
        let (path, storage) = match &record.storage {
            AssetStorage::Managed => {
                let path = self.dir.join(blob_rel_path(&record.content_hash, &record.media_type));
                let present = if is_tree { path.is_dir() } else { path.is_file() };
                if !present {
                    return Err(ErrorBody::asset_missing(
                        asset_id,
                        msg!("engine.managedFileMissing", "The asset file is not in the video directory"),
                    ).details(json!({ "reason": "missing" })));
                }
                (path, "managed")
            }
            AssetStorage::Linked { locator, .. } => {
                let path = locate_linked(&self.dir, asset_id, &locator.path)?;
                let meta = fs::metadata(&path).map_err(|_| {
                    ErrorBody::asset_missing(
                        asset_id,
                        msg!("engine.linkedAssetMoved", "The linked asset is not at its original location"),
                    ).details(json!({
                        "path": locator.path, "volume": locator.volume, "reason": "missing",
                    }))
                })?;
                if !is_tree && (!meta.is_file() || meta.len() != record.byte_length) {
                    return Err(ErrorBody::asset_missing(
                        asset_id,
                        msg!("engine.linkedAssetChanged", "The linked asset is no longer the file that was linked"),
                    ).details(json!({
                        "path": locator.path, "reason": "changed", "expectedByteLength": record.byte_length, "actualByteLength": meta.len(),
                    })));
                }
                if is_tree && !meta.is_dir() {
                    return Err(ErrorBody::asset_missing(
                        asset_id,
                        msg!(
                            "engine.linkedBundleMoved",
                            "The linked code bundle directory is not at its original location"
                        ),
                    ).details(json!({
                        "path": locator.path, "volume": locator.volume, "reason": "missing",
                    })));
                }
                (path, "linked")
            }
        };
        Ok(ResolvedAsset {
            path,
            storage,
            media_type: record.media_type.clone(),
            byte_length: record.byte_length,
            name: asset.name.clone(),
        })
    }

    /// 素材某个版本的 bytes 的位置。
    pub fn blob_path(&self, asset_id: &str, revision: Option<&str>) -> EngineResult<PathBuf> {
        Ok(self.resolve_asset(asset_id, revision)?.path)
    }

    /// 此刻读不到的素材版本（命令与协议规范 §4.1 的 `videos.assetStatus`）：每个素材的当前版本，加上实例引用的版本。
    /// 原因与 `ASSET_MISSING` 的 `details.reason` 相同：`missing`（不在了）、`changed`（已经不是登记时的文件）、
    /// `outside-project`（相对路径越出了项目目录）。只看文件在不在、长度对不对，不重算摘要。
    pub fn missing_assets(&self) -> Vec<MissingAsset> {
        let mut wanted: BTreeSet<(&str, &str)> = self
            .state
            .assets
            .iter()
            .map(|(id, asset)| (id.as_str(), asset.current_revision.as_str()))
            .collect();
        for item in self.state.items.values() {
            wanted.extend(item.value.asset_refs().map(|r| (r.id.as_str(), r.revision.as_str())));
        }
        wanted
            .into_iter()
            .filter_map(|(asset_id, revision)| {
                let err = self.resolve_asset(asset_id, Some(revision)).err()?;
                let record = self.state.assets.get(asset_id).and_then(|a| a.revisions.get(revision));
                let locator = record.and_then(|r| match &r.storage {
                    AssetStorage::Linked { locator, .. } => Some(locator),
                    AssetStorage::Managed => None,
                });
                Some(MissingAsset {
                    asset_id: asset_id.to_string(),
                    revision: revision.to_string(),
                    reason: err.details["reason"].as_str().unwrap_or("missing").to_string(),
                    path: locator.map(|l| l.path.clone()),
                    volume: locator.and_then(|l| l.volume.clone()),
                })
            })
            .collect()
    }

    /// 没有任何引用的素材（`videos.unusedAssets`，命令与协议规范 §4.2 `removeAssets`）：引用的判断见 [`crate::asset_usage`]。
    pub fn unused_assets(&self) -> Vec<crate::asset_usage::UnusedAsset> {
        crate::asset_usage::unused_assets(&self.state)
    }

    /// 清理视频目录的 `blobs/`（[`crate::gc`]）：删掉库里没有任何记录提到的 blob 与过了 `staging_grace` 的 staging 残留。
    /// 只在写入模式下可用：写锁保证没有别的写入者正往 `blobs/` 发布。还有冻结任务租约、导出或便携包导入时由调用方
    /// 决定不调用。读引用集合失败时报错且什么都不删；单个条目删不掉只记进回执。
    pub fn gc_blobs(&self, staging_grace: std::time::Duration) -> EngineResult<crate::gc::BlobGcReport> {
        if self.mode != OpenMode::Write {
            return Err(ErrorBody::read_only());
        }
        let referenced = self.store.referenced_content_hashes()?;
        Ok(crate::gc::gc_blob_dir(
            &self.dir,
            &referenced,
            staging_grace,
            std::time::SystemTime::now(),
        ))
    }

    /// 一个文档版本存下的正文文本，原样不动：摘要就是按它算的（便携包按原样收进去，视频格式规范 §8）。
    pub fn document_text(&self, document_id: &str, revision: &str) -> EngineResult<String> {
        self.store
            .document_body(&self.state.id, document_id, revision)?
            .ok_or_else(|| ErrorBody::storage(msg!(
                "engine.documentRevisionNoBody",
                "Revision {revision} of document {id} has no body",
                revision,
                id = document_id
            )))
    }

    /// 读一份文档的正文。不给版本时读当前版本。
    pub fn document(&self, document_id: &str, revision: Option<&str>) -> EngineResult<DocumentContent> {
        let record = self
            .state
            .documents
            .get(document_id)
            .ok_or_else(|| ErrorBody::not_found(kinds::document(), document_id))?;
        let rev = revision.unwrap_or(&record.current_revision);
        if !record.revisions.contains_key(rev) {
            return Err(ErrorBody::not_found(kinds::document_revision(), &format!("{document_id}@{rev}")));
        }
        let text = self
            .store
            .document_body(&self.state.id, document_id, rev)?
            .ok_or_else(|| ErrorBody::storage(msg!(
                "engine.documentRevisionNoBody",
                "Revision {revision} of document {id} has no body",
                revision = rev,
                id = document_id
            )))?;
        let body = serde_json::from_str(&text).map_err(|e| ErrorBody::storage(msg!(
            "engine.documentCorrupt",
            "The document body is corrupt: {error}",
            error = e.to_string()
        )))?;
        Ok(DocumentContent {
            document: record.clone(),
            revision: rev.to_string(),
            body,
        })
    }

    /// 文档某个版本的正文；文档或版本不存在时为 `None`。
    fn document_body_if_present(&self, document_id: &str, revision: &str) -> EngineResult<Option<Value>> {
        match self.document(document_id, Some(revision)) {
            Ok(content) => Ok(Some(content.body)),
            Err(error) if error.code == "ENTITY_NOT_FOUND" => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// 现在的时间线上求不出锚点、或者不在求出的位置上的实例（视频格式规范 §3.16）。按时间线现算，不落盘。
    pub fn orphaned_anchors(&self) -> EngineResult<Vec<crate::anchors::OrphanedAnchor>> {
        let mut load = |id: &str, revision: &str| self.document_body_if_present(id, revision);
        crate::anchors::orphaned(&self.state, &mut load)
    }

    fn ensure_writable(&self) -> EngineResult<()> {
        match self.mode {
            OpenMode::Write => Ok(()),
            OpenMode::ReadOnly => Err(ErrorBody::read_only()),
        }
    }

    /// 幂等检查：同 key 同载荷返回原回执；同 key 不同载荷拒绝。
    fn replay(&self, command_id: &str, hash: &str) -> EngineResult<Option<Committed>> {
        match self.store.find_by_key(&self.state.id, command_id)? {
            Some((stored, receipt)) if stored == hash => Ok(Some(Committed { receipt, event: None })),
            Some(_) => Err(ErrorBody::idempotency_conflict(command_id)),
            None => Ok(None),
        }
    }

    fn check_revision(&self, expected: &str) -> EngineResult<()> {
        let current = self.revision();
        if expected != current {
            return Err(ErrorBody::revision_conflict(&self.state.id, expected, &current));
        }
        Ok(())
    }

    pub fn apply(&mut self, tx: &VideoTransaction) -> EngineResult<Committed> {
        self.apply_guarded(tx, &[])
    }

    /// 带任务保护的提交（架构设计 §3.2）：智能体在任务里的修改由 Runtime 带上任务合同的保护范围，
    /// 触碰时整笔以 `TASK_PROTECTED` 拒绝。同一个 commandId 的重放照常返回原回执。
    pub fn apply_guarded(&mut self, tx: &VideoTransaction, protections: &[TaskProtection]) -> EngineResult<Committed> {
        self.ensure_writable()?;
        if tx.command_id.trim().is_empty() || tx.command_id.len() > 200 {
            return Err(ErrorBody::invalid_operation(msg!("engine.commandIdInvalid", "commandId is invalid")));
        }
        if tx.operations.is_empty() || tx.operations.len() > 1000 {
            return Err(ErrorBody::invalid_operation(msg!(
                "engine.operationCount",
                "A transaction must have 1–1000 operations"
            )));
        }
        let hash = payload_hash(&json!({
            "kind": "edit",
            "baseVideoRevision": tx.expected_revision,
            "label": tx.label,
            "operations": tx.operations,
        }));
        if let Some(replayed) = self.replay(&tx.command_id, &hash)? {
            return Ok(replayed);
        }
        self.check_revision(&tx.expected_revision)?;
        let ops: Vec<EditOperation> = tx
            .operations
            .iter()
            .enumerate()
            .map(|(i, v)| parse_operation(i, v))
            .collect::<EngineResult<_>>()?;

        // 导入、收纳与重新链接在事务之外准备：复制、摘要、探测都不占用写事务（架构设计 §5.2）。
        let mut prepared: HashMap<usize, PreparedAsset> = HashMap::new();
        let mut relinked: HashMap<usize, FileLocator> = HashMap::new();
        for (index, op) in ops.iter().enumerate() {
            let outside = |e: ErrorBody| with_operation_index(e, index);
            match op {
                EditOperation::ImportAsset {
                    path, storage, include, ..
                } => {
                    // 存放方式与路径规则（不指定时文件链接、目录收进来；相对路径只用于链接）在 `prepare_import` 里定。
                    let asset = prepare_import(&self.dir, Path::new(path), &self.ffprobe, *storage, include.as_deref()).map_err(outside)?;
                    prepared.insert(index, asset);
                }
                EditOperation::CollectAssets { asset_ids } => {
                    for id in asset_ids {
                        self.collect(id).map_err(outside)?;
                    }
                }
                EditOperation::RelinkAsset { asset_id, path } => {
                    relinked.insert(index, self.relink(asset_id, path).map_err(outside)?);
                }
                _ => {}
            }
        }

        // 改已有文档时先查库里存过的最大版本：撤销掉的版本正文还在库里，新版本不能复用它的号。
        let mut document_revision_floor: HashMap<Id, u64> = HashMap::new();
        // 剪口操作要改的剪口集合：正文也在事务之外读出来（§6.7）。
        let mut cut_sets: HashMap<Id, Value> = HashMap::new();
        // 剪辑提案要读的转写与提案：同样在事务之外读出（§6.2）。找不到的留给操作本身报错。
        let mut document_bodies: HashMap<Id, Value> = HashMap::new();
        for op in &ops {
            let mut read_cut_set = |asset_id: &str| -> EngineResult<Option<Id>> {
                let id = crate::cuts::cut_set_document(&self.state, asset_id);
                if let Some(id) = &id
                    && !cut_sets.contains_key(id)
                {
                    cut_sets.insert(id.clone(), self.document(id, None)?.body);
                }
                Ok(id)
            };
            let mut written: Vec<Id> = Vec::new();
            let mut read: Vec<Id> = Vec::new();
            match op {
                EditOperation::PutDocument { document_id: Some(id), .. } => written.push(id.clone()),
                EditOperation::AddCuts { asset_id, .. } | EditOperation::RestoreCut { asset_id, .. } => {
                    written.extend(read_cut_set(asset_id)?);
                }
                EditOperation::ProposeCuts {
                    asset_id,
                    speech_document_id,
                    ..
                } => {
                    read_cut_set(asset_id)?;
                    read.extend(crate::proposals::speech_document(&self.state, asset_id, speech_document_id.as_deref()).ok());
                    written.extend(crate::proposals::proposal_document(&self.state, asset_id));
                }
                EditOperation::AcceptCutSuggestions { proposal_id, .. } => {
                    if let Some(asset_id) = self.state.documents.get(proposal_id).and_then(|d| d.source_asset_id.clone()) {
                        written.extend(read_cut_set(&asset_id)?);
                        read.push(proposal_id.clone());
                        written.push(proposal_id.clone());
                    }
                }
                _ => {}
            }
            for id in read {
                if !document_bodies.contains_key(&id) {
                    document_bodies.insert(id.clone(), self.document(&id, None)?.body);
                }
            }
            for id in written {
                if let std::collections::hash_map::Entry::Vacant(slot) = document_revision_floor.entry(id) {
                    let floor = self.store.max_document_revision(&self.state.id, slot.key())?;
                    slot.insert(floor);
                }
            }
        }

        let transaction_id = new_transaction_id();
        let now = now_rfc3339();
        let mut next = self.state.clone();
        let mut ctx = EditContext {
            transaction_id: &transaction_id,
            now: &now,
            base_revision: self.revision(),
            prepared: &prepared,
            refs: HashMap::new(),
            time_resolution: Vec::new(),
            lineage: BTreeMap::new(),
            reused_assets: Vec::new(),
            document_refs: HashMap::new(),
            track_refs: HashMap::new(),
            documents: Vec::new(),
            document_revision_floor: &document_revision_floor,
            relinked: &relinked,
            actor: &tx.actor,
            cut_sets: &cut_sets,
            document_bodies: &document_bodies,
            cut_impact: Default::default(),
            code_edits: Vec::new(),
            removed_tracks: Vec::new(),
            removed_assets: Vec::new(),
        };
        for (index, op) in ops.iter().enumerate() {
            apply_operation(&mut next, index, op, &mut ctx).map_err(|e| with_operation_index(e, index))?;
        }
        // item-local 的跟随者按目标在这笔事务里的变化补算，目标没了的一起删掉（视频格式规范 §3.16）。
        let removed_with_target = crate::item_local::settle(&self.state, &mut next, &mut ctx)?;
        // 语义锚按最终的时间线重新求值并摆放（视频格式规范 §3.16）；求不出、摆不下的列为 orphaned。
        let resolutions = {
            let written = &ctx.documents;
            let mut load = |id: &str, revision: &str| -> EngineResult<Option<Value>> {
                if let Some(d) = written.iter().rev().find(|d| d.document_id == id && d.revision == revision) {
                    return serde_json::from_str(&d.body)
                        .map(Some)
                        .map_err(|e| ErrorBody::storage(msg!(
            "engine.documentCorrupt",
            "The document body is corrupt: {error}",
            error = e.to_string()
        )));
                }
                self.document_body_if_present(id, revision)
            };
            crate::anchors::resolve(&next, &mut load)?
        };
        let orphaned_anchors = crate::anchors::apply(&self.state, &mut next, resolutions, &mut ctx)?;
        // 到序列末尾的实例按最终的时间线求终点（视频格式规范 §3.16），再核对绑定与转场。
        crate::sequence_end::settle(&mut next)?;
        // 全部操作执行完之后，不再成立的转场被删掉并在回执里报告（视频格式规范 §3.9）。
        crate::elements::prune_bindings(&mut next);
        let transition_changes = crate::transitions::reconcile_transitions(&self.state, &mut next)?;
        let label = match &tx.label {
            Some(l) if !l.trim().is_empty() => l.trim().chars().take(200).collect(),
            _ => default_label(&ops),
        };
        let time_resolution = std::mem::take(&mut ctx.time_resolution);
        let lineage = std::mem::take(&mut ctx.lineage);
        let reused = std::mem::take(&mut ctx.reused_assets);
        let documents = std::mem::take(&mut ctx.documents);
        let cut_impact = std::mem::take(&mut ctx.cut_impact);
        let code_edits = std::mem::take(&mut ctx.code_edits);
        let removed_tracks = std::mem::take(&mut ctx.removed_tracks);
        let removed_assets = std::mem::take(&mut ctx.removed_assets);
        let refs: BTreeMap<String, Id> = ctx
            .refs
            .drain()
            .chain(ctx.document_refs.drain())
            .chain(ctx.track_refs.drain())
            .collect();
        self.commit(
            next,
            CommitInput {
                transaction_id,
                command_id: tx.command_id.clone(),
                payload_hash: hash,
                base_label: label.clone(),
                undo_depth: 0,
                label,
                actor: tx.actor.clone(),
                task_id: tx.task_id.clone(),
                protections: protections.to_vec(),
                undo_of: None,
                now,
                time_resolution,
                lineage,
                extra_preserved: reused,
                documents,
                refs,
                removed_transitions: transition_changes.removed,
                shortened_transitions: transition_changes.shortened,
                cut_impact,
                orphaned_anchors,
                removed_with_target,
                code_edits,
                removed_tracks,
                removed_assets,
            },
        )
    }

    /// 把一个链接素材当前版本的 bytes 复制进 `blobs/`，并核对摘要。已经受管理的不做事。
    fn collect(&self, asset_id: &str) -> EngineResult<()> {
        let asset = self
            .state
            .assets
            .get(asset_id)
            .ok_or_else(|| ErrorBody::not_found(kinds::asset(), asset_id))?;
        let record = &asset.revisions[&asset.current_revision];
        let AssetStorage::Linked { locator, .. } = &record.storage else {
            return Ok(());
        };
        let source = locate_linked(&self.dir, asset_id, &locator.path)?;
        if record.media_type == DIRECTORY_MEDIA_TYPE {
            let include = record.tree.as_ref().and_then(|t| t.include.as_deref());
            let (hash, _, _) = hash_tree(&source, include)?;
            if hash != record.content_hash {
                return Err(ErrorBody::asset_missing(
                    asset_id,
                    msg!(
                        "engine.linkedBundleChanged",
                        "The code bundle at the original location no longer matches what was linked"
                    ),
                ));
            }
            publish_tree(&self.dir, &source, include, &record.content_hash)
        } else {
            publish_verified(&self.dir, &source, &record.media_type, &record.content_hash).map_err(|e| e.entities([asset_id]))
        }
    }

    /// 核对新位置上的内容与素材当前版本一致，返回新的定位。定位与导入时一样规范化：
    /// 在项目目录里的记相对视频目录的路径，项目外的记绝对路径（视频格式规范 §4.2）。
    fn relink(&self, asset_id: &str, path: &str) -> EngineResult<FileLocator> {
        let asset = self
            .state
            .assets
            .get(asset_id)
            .ok_or_else(|| ErrorBody::not_found(kinds::asset(), asset_id))?;
        let record = &asset.revisions[&asset.current_revision];
        if !matches!(record.storage, AssetStorage::Linked { .. }) {
            return Err(ErrorBody::invalid_operation(msg!("engine.relinkNotLinked", "Only linked assets can be relinked")).entities([asset_id]));
        }
        let (locator, resolved) = link_locator(&self.dir, Path::new(path));
        let hash = if record.media_type == DIRECTORY_MEDIA_TYPE {
            hash_tree(&resolved, record.tree.as_ref().and_then(|t| t.include.as_deref()))?.0
        } else {
            hash_file(&resolved)?.0
        };
        if hash != record.content_hash {
            // 同一路径出现新的 bytes 是新版本，不是重新链接（视频格式规范 §4.2）。
            return Err(ErrorBody::invalid_operation(msg!(
                "engine.relinkContentMismatch",
                "The content at the new location does not match the asset; replace the asset revision to change content"
            )).entities([asset_id]));
        }
        Ok(locator)
    }

    /// 撤销是补偿事务（命令与协议规范 §8.3）：目标对象必须仍是那笔事务之后的样子，
    /// 才把它们恢复成之前的样子；之后被别人改过的对象不覆盖，返回 `UNDO_CONFLICT`。
    pub fn undo(&mut self, request: &UndoRequest) -> EngineResult<Committed> {
        self.undo_guarded(request, &[])
    }

    /// 带任务保护的撤销与重做：补偿事务同样不能触碰任务的保护范围。
    pub fn undo_guarded(&mut self, request: &UndoRequest, protections: &[TaskProtection]) -> EngineResult<Committed> {
        self.ensure_writable()?;
        let hash = payload_hash(&json!({
            "kind": "undo",
            "baseVideoRevision": request.expected_revision,
            "target": request.target,
        }));
        if let Some(replayed) = self.replay(&request.command_id, &hash)? {
            return Ok(replayed);
        }
        if let Some(expected) = &request.expected_revision {
            self.check_revision(expected)?;
        }
        let target = match &request.target {
            UndoTarget::Transaction(id) => id.clone(),
            UndoTarget::Undo => {
                self.undo_state(&request.actor)?
                    .undo
                    .ok_or_else(|| ErrorBody::undo_unavailable("", msg!("engine.nothingToUndo", "There is no change to undo")))?
                    .transaction_id
            }
            UndoTarget::Redo => {
                self.undo_state(&request.actor)?
                    .redo
                    .ok_or_else(|| ErrorBody::undo_unavailable("", msg!("engine.nothingToRedo", "There is no change to redo")))?
                    .transaction_id
            }
        };
        let UndoRecord {
            changes,
            undone_by,
            undo_depth,
            base_label,
        } = self
            .store
            .undo_record(&target)?
            .ok_or_else(|| ErrorBody::undo_unavailable(&target, msg!("engine.transactionMissing", "There is no such transaction")))?;
        if let Some(by) = undone_by {
            return Err(
                ErrorBody::undo_unavailable(&target, msg!("engine.alreadyUndone", "This change has already been undone")).details(json!({ "transactionId": target, "undoneBy": by }))
            );
        }
        if changes.is_empty() {
            return Err(ErrorBody::undo_unavailable(
                &target,
                msg!("engine.transactionNoChanges", "This transaction has no changes to undo"),
            ));
        }

        let current = self.state.entities();
        let conflicts: Vec<Id> = changes
            .iter()
            .filter(|c| current.get(&c.id).map(|row| &row.body) != c.after.as_ref())
            .map(|c| c.id.clone())
            .collect();
        if !conflicts.is_empty() {
            return Err(ErrorBody::undo_conflict(
                conflicts,
                msg!("engine.undoChangedSince", "What you are undoing has been changed since"),
            ));
        }
        let mut next = self.state.clone();
        for change in &changes {
            next.put(&change.id, change.kind, change.parent.as_deref(), change.before.clone())?;
        }
        // 恢复之后与别人后来的修改冲突，同样按撤销冲突报告，调用方只需处理一种错误。
        check_references(&next).map_err(|ids| ErrorBody::undo_conflict(
                ids,
                msg!("engine.undoOrphansItems", "Undoing would leave clips added later without their assets"),
            ))?;
        let touched = VideoState::touched_sequences(&self.state, &next, &VideoState::diff(&self.state, &next));
        for seq in touched.iter().filter(|s| next.sequences.contains_key(*s)) {
            check_overlaps(&next, seq).map_err(|e| ErrorBody::undo_conflict(
                    e.entity_ids,
                    msg!("engine.undoOverlaps", "Restored clips would overlap clips added later"),
                ))?;
        }
        // 撤销不顺带删转场：恢复之后有转场不再成立（之后又加的转场依赖被撤销的修改）就按撤销冲突报告。
        let broken = crate::transitions::invalid_transitions(&next)?;
        if !broken.is_empty() {
            return Err(
                ErrorBody::undo_conflict(
                    broken.iter().map(|r| r.id.clone()).collect(),
                    msg!("engine.undoBreaksTransitions", "These transitions no longer hold after undoing"),
                )
                    .details(json!({ "removedTransitions": broken })),
            );
        }

        let depth = undo_depth + 1;
        let prefix = if depth % 2 == 1 { "撤销" } else { "重做" };
        self.commit(
            next,
            CommitInput {
                transaction_id: new_transaction_id(),
                command_id: request.command_id.clone(),
                payload_hash: hash,
                label: format!("{prefix}：{base_label}"),
                base_label,
                undo_depth: depth,
                actor: request.actor.clone(),
                task_id: None,
                protections: protections.to_vec(),
                undo_of: Some(target),
                now: now_rfc3339(),
                time_resolution: Vec::new(),
                lineage: BTreeMap::new(),
                extra_preserved: Vec::new(),
                refs: BTreeMap::new(),
                documents: Vec::new(),
                removed_transitions: Vec::new(),
                shortened_transitions: Vec::new(),
                cut_impact: Default::default(),
                orphaned_anchors: Vec::new(),
                removed_with_target: Vec::new(),
                code_edits: Vec::new(),
                removed_tracks: Vec::new(),
                removed_assets: Vec::new(),
            },
        )
    }

    fn commit(&mut self, mut next: VideoState, input: CommitInput) -> EngineResult<Committed> {
        let changes = VideoState::diff(&self.state, &next);
        crate::task_guard::check(&self.state, &next, &changes, &input.protections)?;
        let touched: Vec<Id> = VideoState::touched_sequences(&self.state, &next, &changes).into_iter().collect();
        for seq in &touched {
            if next.sequences.contains_key(seq) {
                check_overlaps(&next, seq)?;
            }
        }
        let base_revision = self.state.revision;
        next.revision = base_revision + 1;
        next.event_seq = self.state.event_seq + 1;
        for seq in &touched {
            if let Some(entity) = next.sequences.get_mut(seq) {
                entity.revision = next.revision;
            }
        }

        let root = self.state.root_sequence_id.clone();
        let old_duration = self.state.duration_frames(&root).unwrap_or(0);
        let new_duration = next.duration_frames(&next.root_sequence_id).unwrap_or(0);
        let mut created = Vec::new();
        let mut updated = Vec::new();
        let mut deleted = Vec::new();
        for change in &changes {
            match (&change.before, &change.after) {
                (None, Some(_)) => created.push(change.id.clone()),
                (Some(_), Some(_)) => updated.push(change.id.clone()),
                (Some(_), None) => deleted.push(change.id.clone()),
                (None, None) => {}
            }
        }
        let preserved = preserved_instances(&self.state, &next, &changes, input.extra_preserved);
        let new_asset_versions: Vec<(Id, AssetRevision)> = changes
            .iter()
            .filter(|c| c.kind == EntityKind::Asset && c.after.is_some())
            .filter_map(|c| next.assets.get(&c.id))
            .flat_map(|asset| asset.revisions.values().map(|r| (asset.id.clone(), r.clone())))
            .collect();

        let receipt = TransactionReceipt {
            transaction_id: input.transaction_id.clone(),
            command_id: input.command_id.clone(),
            status: "committed".into(),
            video_id: next.id.clone(),
            previous_revision: base_revision.to_string(),
            video_revision: next.revision.to_string(),
            event_seq: next.event_seq.to_string(),
            label: input.label.clone(),
            actor: input.actor.clone(),
            undo_of: input.undo_of.clone(),
            created_ids: created,
            updated_ids: updated,
            deleted_ids: deleted,
            lineage: input.lineage,
            refs: input.refs,
            impact: Impact {
                old_duration_frames: old_duration,
                new_duration_frames: new_duration,
                translation_units_stale: Vec::new(),
                dubbing_units_stale: Vec::new(),
                orphaned_anchors: input.orphaned_anchors,
                removed_transitions: input.removed_transitions,
                shortened_transitions: input.shortened_transitions,
                removed_by_cuts: input.cut_impact.removed,
                cuts_not_relaid: input.cut_impact.not_relaid,
                removed_with_target: input.removed_with_target,
                code_edits: input.code_edits,
                removed_tracks: input.removed_tracks,
                removed_assets: input.removed_assets,
            },
            time_resolution: input.time_resolution,
            preserved,
            undo: if changes.is_empty() {
                let reason = msg!("engine.undoNoChange", "This transaction did not change the video");
                UndoInfo {
                    available: false,
                    token: None,
                    unavailable_reason: Some(reason.text),
                    unavailable_reason_ref: reason.message_ref,
                }
            } else {
                UndoInfo {
                    available: true,
                    token: Some(input.transaction_id.clone()),
                    unavailable_reason: None,
                    unavailable_reason_ref: None,
                }
            },
            committed_at: input.now,
        };
        let event = VideoEvent {
            video_id: next.id.clone(),
            event_seq: next.event_seq.to_string(),
            video_revision: next.revision.to_string(),
            transaction_id: input.transaction_id,
            changed_ids: changes.iter().map(|c| c.id.clone()).collect(),
            projection: projection(&next, &changes, &touched),
            actor: input.actor,
            label: input.label,
            undo_of: input.undo_of.clone(),
            task_id: input.task_id,
        };
        self.store.commit(&CommitRecord {
            video_id: &next.id.clone(),
            base_revision,
            generation: self.generation,
            state: &next,
            changes: &changes,
            touched_sequences: &touched,
            new_asset_versions,
            new_document_versions: &input.documents,
            idempotency_key: &input.command_id,
            payload_hash: &input.payload_hash,
            receipt: &receipt,
            event: &event,
            undo_of: input.undo_of.as_deref(),
            undo_depth: input.undo_depth,
            base_label: &input.base_label,
        })?;
        self.state = next;
        Ok(Committed {
            receipt,
            event: Some(event),
        })
    }
}

struct CommitInput {
    transaction_id: Id,
    command_id: Id,
    payload_hash: String,
    label: String,
    base_label: String,
    undo_depth: i64,
    actor: Actor,
    task_id: Option<Id>,
    /// 任务保护（§3.2）：提交前对照实体变化检查；用户与系统的提交为空。
    protections: Vec<TaskProtection>,
    undo_of: Option<Id>,
    now: String,
    time_resolution: Vec<editor_semantics::TimeQuantizationReceipt>,
    lineage: BTreeMap<Id, Vec<Id>>,
    extra_preserved: Vec<Id>,
    documents: Vec<DocumentBody>,
    refs: BTreeMap<String, Id>,
    removed_transitions: Vec<RemovedTransition>,
    shortened_transitions: Vec<ShortenedTransition>,
    cut_impact: crate::cuts::CutImpact,
    /// 这笔事务之后求不出锚点、或者摆不下的实例（§3.16）。
    orphaned_anchors: Vec<Id>,
    /// 随 `item-local` 的目标删掉的实例（§3.16）。
    removed_with_target: Vec<Id>,
    /// `replaceCodeBundle` 换掉的代码画面（代码包规范 §3.4）。
    code_edits: Vec<crate::receipt::CodeEdit>,
    /// `deleteTrack` 删掉的轨道。
    removed_tracks: Vec<Id>,
    /// `removeAssets` 删掉的素材。
    removed_assets: Vec<Id>,
}

/// 每个实例引用的素材与文档必须存在。返回失去引用的实例。
fn check_references(state: &VideoState) -> Result<(), Vec<Id>> {
    let missing: Vec<Id> = state
        .items
        .values()
        .filter(|i| {
            let asset_gone = i
                .value
                .asset_refs()
                .any(|r| !state.assets.get(&r.id).is_some_and(|a| a.revisions.contains_key(&r.revision)));
            let document_gone = match &i.value {
                TimelineItem::Caption(c) => std::iter::once(&c.document_id)
                    .chain(&c.style_document_id)
                    .any(|d| !state.documents.contains_key(d)),
                _ => false,
            };
            asset_gone || document_gone
        })
        .map(|i| i.value.base().id.clone())
        // 章节的缩略图同样要在。
        .chain(
            state
                .markers
                .values()
                .filter(|m| {
                    m.value
                        .thumbnail
                        .as_ref()
                        .is_some_and(|r| !state.assets.get(&r.id).is_some_and(|a| a.revisions.contains_key(&r.revision)))
                })
                .map(|m| m.value.id.clone()),
        )
        .collect();
    if missing.is_empty() { Ok(()) } else { Err(missing) }
}

/// 与被修改的实例共用素材、但自己没有变化的实例：回执里明确说明它们保持不变（验收 T05）。
fn preserved_instances(before: &VideoState, after: &VideoState, changes: &[EntityChange], extra: Vec<Id>) -> Vec<Id> {
    let changed: BTreeSet<&str> = changes.iter().map(|c| c.id.as_str()).collect();
    let assets: BTreeSet<&str> = changes
        .iter()
        .filter(|c| c.kind == EntityKind::Item)
        .filter_map(|c| before.items.get(&c.id).or_else(|| after.items.get(&c.id)))
        .flat_map(|i| i.value.asset_refs().map(|r| r.id.as_str()))
        .collect();
    let mut preserved: BTreeSet<Id> = after
        .items
        .values()
        .filter(|i| !changed.contains(i.value.base().id.as_str()) && i.value.asset_refs().any(|r| assets.contains(r.id.as_str())))
        .map(|i| i.value.base().id.clone())
        .collect();
    preserved.extend(extra);
    preserved.into_iter().collect()
}

/// 事件里的投影变化：变化的实体给新值，删除的实体给 ID；涉及的序列给新的头与版本。
fn projection(state: &VideoState, changes: &[EntityChange], touched: &[Id]) -> Projection {
    let mut upserts = Vec::new();
    let mut removals = Vec::new();
    let mut sequences_done = BTreeSet::new();
    for change in changes {
        match &change.after {
            Some(body) => {
                let value = if change.kind == EntityKind::Sequence {
                    sequences_done.insert(change.id.clone());
                    sequence_value(state, &change.id).unwrap_or_else(|| body.clone())
                } else {
                    body.clone()
                };
                upserts.push(EntityUpsert {
                    kind: change.kind,
                    id: change.id.clone(),
                    sequence_id: change.parent.clone(),
                    value,
                });
            }
            None => removals.push(EntityRemoval {
                kind: change.kind,
                id: change.id.clone(),
                sequence_id: change.parent.clone(),
            }),
        }
    }
    for seq in touched {
        if sequences_done.contains(seq) {
            continue;
        }
        if let Some(value) = sequence_value(state, seq) {
            upserts.push(EntityUpsert {
                kind: EntityKind::Sequence,
                id: seq.clone(),
                sequence_id: None,
                value,
            });
        }
    }
    Projection { upserts, removals }
}

fn sequence_value(state: &VideoState, id: &str) -> Option<Value> {
    let seq = state.sequences.get(id)?;
    let mut value = serde_json::to_value(&seq.header).ok()?;
    if let Value::Object(map) = &mut value {
        map.insert("id".into(), json!(id));
        map.insert("revision".into(), json!(seq.revision.to_string()));
    }
    Some(value)
}
