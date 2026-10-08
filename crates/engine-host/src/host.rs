//! Engine Host 的请求处理：一个进程管理多个打开的视频，每个视频持有自己的写锁。
//!
//! 同一目录在本进程里只打开一次：第二个打开者拿到同一个 videoId，而不是被自己的锁挡住（验收 A01）。
//! 打开者的引用计数由 Runtime 管理；`videos.close` 到来时才真正关闭并释放锁。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::barrier::{RunBarrier, RunRef};
use editor_semantics::Rate;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use message_ref::msg;
use video_engine::error::kinds;
use video_engine::gc::STAGING_GRACE;
use video_engine::model::{Actor, ActorKind, Id};

use video_engine::{
    CreateOptions, ErrorBody, OpenMode, ProjectClaim, Retryability, TaskProtection, UndoRequest, UndoTarget, Video, VideoEvent,
    VideoTransaction, claim_project_dir,
};

pub const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");

pub struct Host {
    ffprobe: PathBuf,
    videos: HashMap<Id, Video>,
    by_path: HashMap<PathBuf, Id>,
    barrier: RunBarrier,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateParams {
    path: String,
    name: String,
    fps: Rate,
    width: u32,
    height: u32,
    /// 所属项目（架构设计 §5.1）。不属于项目的视频不传。
    #[serde(default)]
    project_id: Option<Id>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PathParams {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenParams {
    path: String,
    /// 所属项目：库里记的项目与它不同时，视频换成新的 videoId（副本）。不传时不认领。
    #[serde(default)]
    project_id: Option<Id>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClaimParams {
    path: String,
    project_id: Id,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VideoParams {
    video_id: Id,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplyParams {
    video_id: Id,
    command_id: Id,
    expected_revision: String,
    #[serde(default)]
    label: Option<String>,
    operations: Vec<Value>,
    actor: Actor,
    #[serde(default)]
    task_id: Option<Id>,
    /// 任务与流水线的写入所属的执行（§7.4 停止屏障）；普通编辑不带。
    #[serde(default)]
    run: Option<RunRef>,
    /// 任务合同的保护范围（架构设计 §3.2）：只在带 taskId 的非用户提交上生效（智能体自己的提交，任务下的 Job 与
    /// 流程把结果应用到视频）；用户的提交、不带 taskId 的提交带了也不检查。
    #[serde(default)]
    protections: Vec<TaskProtection>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidateParams {
    video_id: Id,
    run_id: Id,
    run_generation: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UndoParams {
    video_id: Id,
    command_id: Id,
    target: UndoTarget,
    #[serde(default)]
    expected_revision: Option<String>,
    actor: Actor,
    /// 同 `ApplyParams.protections`：智能体的撤销与重做同样不能触碰任务的保护范围。
    #[serde(default)]
    protections: Vec<TaskProtection>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActorParams {
    video_id: Id,
    actor: Actor,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AfterParams {
    video_id: Id,
    after: String,
    #[serde(default)]
    limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommandParams {
    video_id: Id,
    command_id: Id,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoryParams {
    video_id: Id,
    #[serde(default)]
    limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlobParams {
    video_id: Id,
    asset_id: Id,
    #[serde(default)]
    revision: Option<String>,
}

/// 按视频目录找素材版本的 bytes（`videos.resolveAsset`）：不要求视频已经打开。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AssetAtParams {
    path: String,
    asset_id: Id,
    #[serde(default)]
    revision: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DocumentParams {
    video_id: Id,
    document_id: Id,
    #[serde(default)]
    revision: Option<String>,
}

fn params<T: DeserializeOwned>(value: Value) -> Result<T, ErrorBody> {
    serde_json::from_value(value).map_err(|e| ErrorBody::new(
            "INVALID_PARAMS",
            msg!("engineHost.paramsInvalid", "Invalid parameters: {error}", error = e.to_string()),
            Retryability::Never,
        ))
}

fn absolute(path: &str) -> Result<PathBuf, ErrorBody> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err(ErrorBody::new(
            "INVALID_PARAMS",
            msg!("engineHost.videoPathRelative", "The video path must be absolute"),
            Retryability::Never,
        ));
    }
    Ok(path)
}

fn canonical(path: &Path) -> Result<PathBuf, ErrorBody> {
    path.canonicalize()
        .map_err(|e| ErrorBody::not_found(kinds::video(), &format!("{} ({e})", path.display())))
}

fn opened(video: &Video) -> Value {
    json!({
        "videoId": video.id(),
        "path": video.dir(),
        "eventSeq": video.event_seq().to_string(),
        "snapshot": video.snapshot(),
        "projectId": video.project_id().ok().flatten(),
        "previousVideoIds": video.previous_video_ids().unwrap_or_default(),
    })
}

/// 认领的结果写进 stderr 日志：换标识是值得留痕的事。
fn log_claim(dir: &Path, claim: &ProjectClaim) {
    if let ProjectClaim::Reassigned {
        previous_video_id,
        video_id,
    } = claim
    {
        eprintln!(
            "engine-host: {} 属于另一个项目，视频 {previous_video_id} 换成 {video_id}",
            dir.display()
        );
    }
}

/// Space 目录用的概要：不取写锁。
fn summary(video: &Video) -> Value {
    let state = video.state();
    let root = state.sequences.get(&state.root_sequence_id);
    // 语义锚求不出、或摆不下的实例（视频格式规范 §3.16）：按时间线现算，读不出时不列。
    let orphaned = video.orphaned_anchors().unwrap_or_default();
    let mut summary = json!({
        "videoId": video.id(),
        "name": state.name,
        "revision": video.revision(),
        "fps": root.map(|s| s.header.fps),
        "width": root.map(|s| s.header.canvas.width),
        "height": root.map(|s| s.header.canvas.height),
        "durationFrames": state.duration_frames(&state.root_sequence_id).unwrap_or(0),
        "itemCount": state.items.len(),
        "assetCount": state.assets.len(),
        "documentCount": state.documents.len(),
    });
    if !orphaned.is_empty() {
        summary["orphanedAnchors"] = json!(orphaned);
    }
    summary
}

impl Host {
    pub fn new(ffprobe: PathBuf) -> Host {
        Host {
            ffprobe,
            videos: HashMap::new(),
            by_path: HashMap::new(),
            barrier: RunBarrier::default(),
        }
    }

    fn video(&mut self, id: &str) -> Result<&mut Video, ErrorBody> {
        self.videos
            .get_mut(id)
            .ok_or_else(|| ErrorBody::new(
                    "VIDEO_NOT_OPEN",
                    msg!("engineHost.videoNotOpen", "The video is not open"),
                    Retryability::AfterRefresh,
                ).entities([id]))
    }

    fn register(&mut self, video: Video) -> Result<Value, ErrorBody> {
        let path = canonical(video.dir())?;
        let result = opened(&video);
        self.by_path.insert(path, video.id().to_string());
        self.videos.insert(video.id().to_string(), video);
        Ok(result)
    }

    /// 处理一个请求。提交产生的事件先交给 `emit`，再返回响应：事件只从这一处发出。
    pub fn handle(&mut self, method: &str, value: Value, emit: &mut dyn FnMut(&VideoEvent)) -> Result<Value, ErrorBody> {
        match method {
            "host.hello" => Ok(json!({ "version": HOST_VERSION, "pid": std::process::id() })),
            "videos.create" => {
                let p: CreateParams = params(value)?;
                let dir = absolute(&p.path)?;
                let options = CreateOptions {
                    name: p.name,
                    fps: p.fps,
                    width: p.width,
                    height: p.height,
                };
                let mut video = Video::create(&dir, &options, &self.ffprobe)?;
                if let Some(project_id) = &p.project_id {
                    video.claim_project(project_id)?;
                }
                self.register(video)
            }
            "videos.open" => {
                let p: OpenParams = params(value)?;
                let dir = canonical(&absolute(&p.path)?)?;
                if let Some(id) = self.by_path.get(&dir)
                    && let Some(video) = self.videos.get(id)
                {
                    return Ok(opened(video));
                }
                let mut video = Video::open(&dir, OpenMode::Write, &self.ffprobe)?;
                // 先认领再查重：副本换了标识，就不会与原视频撞上。
                if let Some(project_id) = &p.project_id {
                    let claim = video.claim_project(project_id)?;
                    log_claim(&dir, &claim);
                }
                if let Some(existing) = self.videos.get(video.id()) {
                    // 同一个 videoId 出现在两个目录（被移动之后，或不属于项目、无从区分的副本）：
                    // 保留先打开的那一个，新打开的放下锁。
                    eprintln!(
                        "engine-host: {} 与已打开的 {} 是同一个视频 {}，保留已打开的",
                        dir.display(),
                        existing.dir().display(),
                        existing.id()
                    );
                    return Ok(opened(existing));
                }
                self.register(video)
            }
            "videos.claimProject" => {
                let p: ClaimParams = params(value)?;
                let dir = canonical(&absolute(&p.path)?)?;
                if let Some(id) = self.by_path.get(&dir) {
                    // 正在打开的视频打开时已经认领过：不动它。
                    return Ok(json!({ "videoId": id, "outcome": "open" }));
                }
                let (video_id, claim) = claim_project_dir(&dir, &p.project_id)?;
                log_claim(&dir, &claim);
                let mut result = serde_json::to_value(&claim).expect("能序列化");
                result["videoId"] = json!(video_id);
                Ok(result)
            }
            "videos.gcBlobs" => {
                // 视频目录 `blobs/` 的 GC（架构设计 §5.2、§5.5）：要写锁。开着的视频就地做；没开的临时取写锁，
                // 别的进程锁着时照常以 `VIDEO_LOCKED` 拒绝。还有冻结任务租约、导出或便携包导入时由 Runtime 决定不调用。
                let p: PathParams = params(value)?;
                let dir = canonical(&absolute(&p.path)?)?;
                let report = match self.by_path.get(&dir).and_then(|id| self.videos.get(id)) {
                    Some(video) => video.gc_blobs(STAGING_GRACE)?,
                    None => Video::open(&dir, OpenMode::Write, &self.ffprobe)?.gc_blobs(STAGING_GRACE)?,
                };
                if !report.removed.is_empty() || !report.staging_removed.is_empty() || !report.failed.is_empty() {
                    eprintln!(
                        "engine-host: {} 的 GC 删掉 {} 个 blob、{} 个 staging 残留，释放 {} 字节，{} 个删不掉",
                        dir.display(),
                        report.removed.len(),
                        report.staging_removed.len(),
                        report.freed_bytes,
                        report.failed.len()
                    );
                }
                Ok(serde_json::to_value(report).expect("能序列化"))
            }
            "videos.inspect" => {
                let p: PathParams = params(value)?;
                let dir = canonical(&absolute(&p.path)?)?;
                if let Some(video) = self.by_path.get(&dir).and_then(|id| self.videos.get(id)) {
                    return Ok(summary(video));
                }
                let video = Video::open(&dir, OpenMode::ReadOnly, &self.ffprobe)?;
                Ok(summary(&video))
            }
            "videos.readContent" => {
                // 内容索引（架构设计 §5.11）：与 `videos.inspect` 一样不取写锁。
                let p: PathParams = params(value)?;
                let dir = canonical(&absolute(&p.path)?)?;
                if let Some(video) = self.by_path.get(&dir).and_then(|id| self.videos.get(id)) {
                    return Ok(crate::content::read(video));
                }
                let video = Video::open(&dir, OpenMode::ReadOnly, &self.ffprobe)?;
                Ok(crate::content::read(&video))
            }
            "videos.resolveAsset" => {
                // Space 的缩略图（架构设计 §5.7）：与 `assets.blobPath` 同一个结果，但按目录找、不要求打开，不取写锁。
                let p: AssetAtParams = params(value)?;
                let dir = canonical(&absolute(&p.path)?)?;
                let resolved = match self.by_path.get(&dir).and_then(|id| self.videos.get(id)) {
                    Some(video) => video.resolve_asset(&p.asset_id, p.revision.as_deref())?,
                    None => Video::open(&dir, OpenMode::ReadOnly, &self.ffprobe)?.resolve_asset(&p.asset_id, p.revision.as_deref())?,
                };
                Ok(serde_json::to_value(resolved).expect("能序列化"))
            }
            "videos.close" => {
                let p: VideoParams = params(value)?;
                let closed = self.videos.remove(&p.video_id).is_some();
                self.by_path.retain(|_, id| *id != p.video_id);
                self.barrier.forget(&p.video_id);
                Ok(json!({ "closed": closed }))
            }
            "videos.snapshot" => {
                let p: VideoParams = params(value)?;
                let video = self.video(&p.video_id)?;
                Ok(json!({ "eventSeq": video.event_seq().to_string(), "snapshot": video.snapshot() }))
            }
            "videos.assetStatus" => {
                let p: VideoParams = params(value)?;
                let missing = self.video(&p.video_id)?.missing_assets();
                Ok(json!({ "missing": missing }))
            }
            "videos.unusedAssets" => {
                // 没有引用的素材（`removeAssets` 能删的那些）：`assets_prune` 的预检清单。只读。
                let p: VideoParams = params(value)?;
                let unused = self.video(&p.video_id)?.unused_assets();
                Ok(json!({ "unused": unused }))
            }
            "runs.invalidate" => {
                // 只给打开着的视频记：没打开的视频不会有提交到来，关闭时记录也一起清掉。
                let p: InvalidateParams = params(value)?;
                let run = RunRef {
                    run_id: p.run_id,
                    run_generation: p.run_generation,
                };
                run.generation()?;
                if !self.videos.contains_key(&p.video_id) {
                    self.barrier.forget(&p.video_id);
                    return Ok(json!({ "recorded": false }));
                }
                self.barrier.invalidate(&p.video_id, &run)?;
                Ok(json!({ "recorded": true }))
            }
            "edits.apply" => {
                let p: ApplyParams = params(value)?;
                let stopped = match &p.run {
                    Some(run) => self.barrier.stopped(&p.video_id, run)?.map(|generation| (run.clone(), generation)),
                    None => None,
                };
                let video = self.video(&p.video_id)?;
                if let Some((run, generation)) = stopped
                    // 已经提交过的命令照常重放回执：屏障只挡新的事务。
                    && video.find_receipt(&p.command_id)?.is_none()
                {
                    return Err(
                        ErrorBody::new(
                            "TASK_STOPPED",
                            msg!("engineHost.taskStopped", "This run was stopped, and the change was not committed"),
                            Retryability::Never,
                        )
                            .entities([p.video_id.clone()])
                            .details(json!({
                                "runId": run.run_id,
                                "runGeneration": run.run_generation,
                                "stoppedGeneration": generation.to_string(),
                            })),
                    );
                }
                // 任务里的写入（智能体自己的，或任务下的 Job、流程以系统身份写的）受任务保护；用户的决定不受限制。
                let guarded = p.actor.kind != ActorKind::User && p.task_id.is_some();
                let protections = if guarded { p.protections.as_slice() } else { &[] };
                let committed = video.apply_guarded(
                    &VideoTransaction {
                        command_id: p.command_id,
                        expected_revision: p.expected_revision,
                        label: p.label,
                        operations: p.operations,
                        actor: p.actor,
                        task_id: p.task_id,
                    },
                    protections,
                )?;
                if let Some(event) = &committed.event {
                    emit(event);
                }
                Ok(json!({ "receipt": committed.receipt, "replayed": committed.event.is_none() }))
            }
            "edits.undo" => {
                let p: UndoParams = params(value)?;
                let video = self.video(&p.video_id)?;
                let protections = if p.actor.kind == ActorKind::Agent {
                    p.protections.as_slice()
                } else {
                    &[]
                };
                let committed = video.undo_guarded(
                    &UndoRequest {
                        command_id: p.command_id,
                        target: p.target,
                        expected_revision: p.expected_revision,
                        actor: p.actor,
                    },
                    protections,
                )?;
                if let Some(event) = &committed.event {
                    emit(event);
                }
                Ok(json!({ "receipt": committed.receipt, "replayed": committed.event.is_none() }))
            }
            "edits.undoState" => {
                let p: ActorParams = params(value)?;
                let state = self.video(&p.video_id)?.undo_state(&p.actor)?;
                Ok(serde_json::to_value(state).expect("能序列化"))
            }
            "events.after" => {
                let p: AfterParams = params(value)?;
                let after: i64 = p
                    .after
                    .parse()
                    .map_err(|_| ErrorBody::new(
                        "INVALID_PARAMS",
                        msg!("engineHost.afterNotInteger", "after must be a decimal integer"),
                        Retryability::Never,
                    ))?;
                let events = self.video(&p.video_id)?.events_after(after, p.limit.unwrap_or(500))?;
                Ok(json!({ "events": events }))
            }
            "receipts.byCommand" => {
                let p: CommandParams = params(value)?;
                let receipt = self.video(&p.video_id)?.find_receipt(&p.command_id)?;
                Ok(json!({ "receipt": receipt }))
            }
            "history.list" => {
                let p: HistoryParams = params(value)?;
                let entries = self.video(&p.video_id)?.history(p.limit.unwrap_or(100))?;
                Ok(json!({ "entries": entries }))
            }
            "assets.blobPath" => {
                let p: BlobParams = params(value)?;
                let video = self.video(&p.video_id)?;
                let resolved = video.resolve_asset(&p.asset_id, p.revision.as_deref())?;
                Ok(serde_json::to_value(resolved).expect("能序列化"))
            }
            "documents.read" => {
                let p: DocumentParams = params(value)?;
                let content = self.video(&p.video_id)?.document(&p.document_id, p.revision.as_deref())?;
                Ok(serde_json::to_value(content).expect("能序列化"))
            }
            "exports.package" => {
                let p: VideoParams = params(value)?;
                crate::package::freeze(self.video(&p.video_id)?)
            }
            "videos.importPackage" => {
                let p: crate::package::ImportParams = params(value)?;
                let video = crate::package::import(p, &self.ffprobe)?;
                self.register(video)
            }
            // `fonts.*` 不经这里：main 把它们交给字体线程（`fonts::FontWorker`）。
            "exports.plan" => {
                let p: crate::exports::PlanParams = params(value)?;
                let video = self.video(&p.video_id)?;
                crate::exports::plan(video, p)
            }
            _ => Err(ErrorBody::new(
                "UNKNOWN_METHOD",
                msg!("engineHost.unknownMethod", "Unknown method: {method}", method),
                Retryability::Never,
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use video_engine::model::ActorKind;

    fn host() -> Host {
        Host::new(PathBuf::from("ffprobe"))
    }

    fn create(host: &mut Host, dir: &Path) -> Value {
        let params = json!({ "path": dir, "name": "测试", "fps": { "num": 30, "den": 1 }, "width": 1280, "height": 720 });
        host.handle("videos.create", params, &mut |_| {}).unwrap()
    }

    #[test]
    fn a01_opening_the_same_path_twice_returns_the_same_video() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("片子");
        let mut host = host();
        let created = create(&mut host, &dir);
        let opened = host.handle("videos.open", json!({ "path": dir }), &mut |_| {}).unwrap();
        assert_eq!(opened["videoId"], created["videoId"]);
        // 经过不同写法的同一路径。
        let dotted = root.path().join(".").join("片子");
        let again = host.handle("videos.open", json!({ "path": dotted }), &mut |_| {}).unwrap();
        assert_eq!(again["videoId"], created["videoId"]);
    }

    #[test]
    fn apply_emits_the_event_before_returning_the_receipt() {
        let root = tempfile::tempdir().unwrap();
        let mut host = host();
        let created = create(&mut host, &root.path().join("m"));
        let video_id = created["videoId"].as_str().unwrap().to_string();
        let actor = Actor {
            kind: ActorKind::User,
            id: "user_local".into(),
        };
        let params = json!({
            "videoId": video_id, "commandId": "cmd_1", "expectedRevision": "0", "actor": actor,
            "operations": [{ "type": "renameVideo", "name": "改名" }],
        });
        let mut events = Vec::new();
        let result = host.handle("edits.apply", params.clone(), &mut |e| events.push(e.clone())).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(result["receipt"]["videoRevision"], json!("1"));
        assert_eq!(result["replayed"], json!(false));
        let replay = host.handle("edits.apply", params, &mut |e| events.push(e.clone())).unwrap();
        assert_eq!(replay["replayed"], json!(true));
        assert_eq!(events.len(), 1, "重放不发事件");

        let inspect = host
            .handle("videos.inspect", json!({ "path": root.path().join("m") }), &mut |_| {})
            .unwrap();
        assert_eq!(inspect["name"], json!("改名"));
        let after = host
            .handle("events.after", json!({ "videoId": video_id, "after": "0" }), &mut |_| {})
            .unwrap();
        assert_eq!(after["events"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn a_copied_video_opened_in_another_project_gets_its_own_id() {
        let root = tempfile::tempdir().unwrap();
        let original = root.path().join("a").join("片子");
        let mut host = host();
        let params = json!({
            "path": original, "name": "测试", "fps": { "num": 30, "den": 1 }, "width": 1280, "height": 720, "projectId": "proj_a",
        });
        let created = host.handle("videos.create", params, &mut |_| {}).unwrap();
        assert_eq!(created["projectId"], json!("proj_a"));
        let id = created["videoId"].clone();
        host.handle("videos.close", json!({ "videoId": id }), &mut |_| {}).unwrap();

        let copy = root.path().join("b").join("片子");
        std::fs::create_dir_all(&copy).unwrap();
        for name in ["video.db", "video.lock"] {
            std::fs::copy(original.join(name), copy.join(name)).unwrap();
        }
        // 原视频先打开着：副本认领之后不会撞上它。
        host.handle("videos.open", json!({ "path": original, "projectId": "proj_a" }), &mut |_| {})
            .unwrap();
        let opened = host
            .handle("videos.open", json!({ "path": copy, "projectId": "proj_b" }), &mut |_| {})
            .unwrap();
        assert_ne!(opened["videoId"], id);
        assert_eq!(opened["path"], json!(copy.canonicalize().unwrap()));
        assert_eq!(opened["previousVideoIds"], json!([id]));

        // 已经打开的视频不预处理；没打开的相同项目什么也不做。
        let busy = host
            .handle("videos.claimProject", json!({ "path": copy, "projectId": "proj_c" }), &mut |_| {})
            .unwrap();
        assert_eq!(busy["outcome"], json!("open"));
        host.handle("videos.close", json!({ "videoId": opened["videoId"] }), &mut |_| {})
            .unwrap();
        let same = host
            .handle("videos.claimProject", json!({ "path": copy, "projectId": "proj_b" }), &mut |_| {})
            .unwrap();
        assert_eq!(same, json!({ "outcome": "unchanged", "videoId": opened["videoId"] }));
    }

    #[test]
    fn gc_blobs_runs_on_open_and_closed_videos_but_not_on_locked_ones() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("m");
        let mut host = host();
        let params = json!({ "path": dir, "name": "GC", "fps": { "num": 30, "den": 1 }, "width": 1280, "height": 720 });
        let created = host.handle("videos.create", params, &mut |_| {}).unwrap();
        let orphan = |n: &str| {
            let path = dir.join("blobs").join(format!("{}.png", n.repeat(64)));
            std::fs::write(&path, b"orphan").unwrap();
            path
        };

        // 开着的视频就地做。
        let first = orphan("a");
        let report = host.handle("videos.gcBlobs", json!({ "path": dir }), &mut |_| {}).unwrap();
        assert!(!first.exists());
        assert_eq!(report["removed"][0]["path"], json!(format!("blobs/{}.png", "a".repeat(64))));
        assert_eq!(report["freedBytes"], json!(6));

        // 别的进程（这里是另一个 Host）锁着时拒绝，什么都不删。
        let second = orphan("b");
        let mut other = Host::new(PathBuf::from("ffprobe"));
        let err = other.handle("videos.gcBlobs", json!({ "path": dir }), &mut |_| {}).unwrap_err();
        assert_eq!(err.code, "VIDEO_LOCKED");
        assert!(second.exists());

        // 关闭之后临时取写锁来做，做完放下。
        host.handle("videos.close", json!({ "videoId": created["videoId"] }), &mut |_| {})
            .unwrap();
        other.handle("videos.gcBlobs", json!({ "path": dir }), &mut |_| {}).unwrap();
        assert!(!second.exists());
        host.handle("videos.open", json!({ "path": dir }), &mut |_| {})
            .expect("GC 放下了锁");
        assert!(
            host.handle("videos.gcBlobs", json!({ "path": dir, "extra": 1 }), &mut |_| {})
                .is_err()
        );
    }

    #[test]
    fn close_releases_the_lock_and_unknown_input_is_rejected() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("m");
        let mut host = host();
        let created = create(&mut host, &dir);
        let mut other = Host::new(PathBuf::from("ffprobe"));
        let err = other.handle("videos.open", json!({ "path": dir }), &mut |_| {}).unwrap_err();
        assert_eq!(err.code, "VIDEO_LOCKED");
        host.handle("videos.close", json!({ "videoId": created["videoId"] }), &mut |_| {})
            .unwrap();
        other.handle("videos.open", json!({ "path": dir }), &mut |_| {}).expect("锁已释放");

        assert_eq!(
            host.handle("videos.open", json!({ "path": "relative" }), &mut |_| {})
                .unwrap_err()
                .code,
            "INVALID_PARAMS"
        );
        assert_eq!(
            host.handle("videos.snapshot", json!({ "videoId": "x", "extra": 1 }), &mut |_| {})
                .unwrap_err()
                .code,
            "INVALID_PARAMS"
        );
        assert_eq!(host.handle("nope", json!({}), &mut |_| {}).unwrap_err().code, "UNKNOWN_METHOD");
        assert_eq!(
            host.handle("videos.snapshot", json!({ "videoId": "x" }), &mut |_| {})
                .unwrap_err()
                .code,
            "VIDEO_NOT_OPEN"
        );
    }

    #[test]
    fn read_content_reads_text_documents_without_taking_the_lock() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("c");
        let mut writer = host();
        let created = create(&mut writer, &dir);
        let video_id = created["videoId"].as_str().unwrap().to_string();
        let actor = Actor {
            kind: ActorKind::User,
            id: "user_local".into(),
        };
        let speech = json!({ "schema": "baocut.speech/1", "timescale": 1000,
            "words": [{ "id": "w1", "text": "你好", "start": 0, "end": 400 }], "speakers": [] });
        let params = json!({
            "videoId": video_id, "commandId": "cmd_doc", "expectedRevision": "0", "actor": actor,
            "operations": [
                { "type": "putDocument", "kind": "speech", "name": "转写", "body": speech },
                { "type": "putDocument", "kind": "caption-style", "body": { "font": "x" } },
            ],
        });
        writer.handle("edits.apply", params, &mut |_| {}).unwrap();

        // 另一个进程（写锁在 writer 手里）照样读得到；读完不占锁。
        let mut reader = host();
        let content = reader.handle("videos.readContent", json!({ "path": dir }), &mut |_| {}).unwrap();
        assert_eq!(content["videoId"], json!(video_id));
        assert_eq!(content["revision"], json!("1"));
        let documents = content["documents"].as_array().unwrap();
        assert_eq!(documents.len(), 1, "只带文字类文档");
        assert_eq!(documents[0]["kind"], json!("speech"));
        assert_eq!(documents[0]["body"]["words"][0]["text"], json!("你好"));
        assert!(documents[0].get("plan").is_some());
        assert!(content["snapshot"]["sequences"].is_object());
        // 打开的视频用打开的那一份。
        let open = writer.handle("videos.readContent", json!({ "path": dir }), &mut |_| {}).unwrap();
        assert_eq!(open["revision"], json!("1"));
        assert_eq!(
            reader
                .handle("videos.readContent", json!({ "path": "relative" }), &mut |_| {})
                .unwrap_err()
                .code,
            "INVALID_PARAMS"
        );
    }

    /// 按目录找素材的 bytes：没打开的视频以只读方式打开（不取写锁），收纳的在视频目录的 `blobs/` 里，链接的是原文件；
    /// 结果与打开时的 `assets.blobPath` 一样。
    #[test]
    fn resolve_asset_finds_bytes_without_opening_the_video() {
        let root = tempfile::tempdir().unwrap();
        let wav = root.path().join("vo.wav");
        write_wav(&wav, 1);
        // 内容相同的文件是同一个素材：收纳的用另一段。
        let copied = root.path().join("bed.wav");
        write_wav(&copied, 2);
        let dir = root.path().join("素材");
        let mut writer = host();
        let created = create(&mut writer, &dir);
        let video_id = created["videoId"].as_str().unwrap().to_string();
        let actor = json!({ "kind": "user", "id": "user_local" });
        let params = json!({ "videoId": video_id, "commandId": "cmd_0", "expectedRevision": "0", "actor": actor,
            "operations": [
                { "type": "importAsset", "path": wav, "storage": "linked", "ref": "linked" },
                { "type": "importAsset", "path": copied, "storage": "managed", "ref": "managed" },
            ] });
        let refs = writer.handle("edits.apply", params, &mut |_| {}).unwrap()["receipt"]["refs"].clone();

        let mut reader = host();
        let mut resolve = |asset: &Value| reader.handle("videos.resolveAsset", json!({ "path": dir, "assetId": asset }), &mut |_| {});
        let linked = resolve(&refs["linked"]).unwrap();
        assert_eq!(linked["storage"], json!("linked"));
        assert_eq!(linked["path"], json!(wav.canonicalize().unwrap()));
        let managed = resolve(&refs["managed"]).unwrap();
        assert_eq!(managed["storage"], json!("managed"));
        let blob = PathBuf::from(managed["path"].as_str().unwrap());
        assert!(blob.starts_with(dir.canonicalize().unwrap().join("blobs")) && blob.is_file());
        assert_eq!(managed["mediaType"], json!("audio/wav"));
        assert_eq!(resolve(&json!("asset_none")).unwrap_err().code, "ENTITY_NOT_FOUND");
        // 打开的视频用打开的那一份，与 `assets.blobPath` 相同。
        let open = writer
            .handle(
                "videos.resolveAsset",
                json!({ "path": dir, "assetId": refs["managed"] }),
                &mut |_| {},
            )
            .unwrap();
        let by_id = writer
            .handle(
                "assets.blobPath",
                json!({ "videoId": video_id, "assetId": refs["managed"] }),
                &mut |_| {},
            )
            .unwrap();
        assert_eq!(open, by_id);
        let canonical = |v: &Value| PathBuf::from(v.as_str().unwrap()).canonicalize().unwrap();
        assert_eq!(canonical(&open["path"]), canonical(&managed["path"]));
        // 链接的原文件不在了：与打开时一样报 `ASSET_MISSING`。
        std::fs::remove_file(&wav).unwrap();
        let missing = reader
            .handle(
                "videos.resolveAsset",
                json!({ "path": dir, "assetId": refs["linked"] }),
                &mut |_| {},
            )
            .unwrap_err();
        assert_eq!(missing.code, "ASSET_MISSING");
    }

    /// 成片烧字幕时，派生自译文的字幕是译文行：译文是 `baocut.translation/1` 还是 `/2` 都一样（按父文档的种类判断，
    /// 字幕文档自带每条的文字，不再按句子去译文里找）。
    #[test]
    fn video_plan_marks_captions_derived_from_either_translation_schema_as_translation_lines() {
        let root = tempfile::tempdir().unwrap();
        let mut host = host();
        let created = create(&mut host, &root.path().join("双语"));
        let video_id = created["videoId"].as_str().unwrap().to_string();
        let snapshot = host.handle("videos.snapshot", json!({ "videoId": video_id }), &mut |_| {}).unwrap();
        let sequence_id = snapshot["snapshot"]["rootSequenceId"].clone();
        let actor = Actor {
            kind: ActorKind::User,
            id: "user_local".into(),
        };
        let speech = json!({ "schema": "baocut.speech/1", "timescale": 1000,
            "words": [{ "id": "w1", "text": "你好", "start": 0, "end": 400 }], "speakers": [] });
        let v1 = json!({ "schema": "baocut.translation/1", "units": [{ "id": "s1", "text": "Hello" }] });
        let v2 = json!({ "schema": "baocut.translation/2", "units": [{ "sourceSentenceId": "s1", "naturalText": "Hello",
            "alignment": { "sourceWordIds": ["w1"] } }] });
        let caption = |text: &str| {
            json!({ "schema": "baocut.caption/1", "clock": "sequence", "timescale": 1000,
            "cues": [{ "id": "c1", "start": 0, "end": 1000, "text": text }] })
        };
        let mut operations = vec![
            json!({ "type": "putDocument", "ref": "sp", "kind": "speech", "body": speech }),
            json!({ "type": "putDocument", "ref": "t1", "kind": "translation", "language": "en", "sourceDocument": { "ref": "sp" }, "body": v1 }),
            json!({ "type": "putDocument", "ref": "t2", "kind": "translation", "language": "en", "sourceDocument": { "ref": "sp" }, "body": v2 }),
        ];
        for (name, parent) in [("orig", "sp"), ("from1", "t1"), ("from2", "t2")] {
            operations.push(json!({ "type": "putDocument", "ref": name, "kind": "caption", "name": name,
                "sourceDocument": { "ref": parent }, "body": caption(name) }));
            operations.push(json!({ "type": "addTrack", "kind": "subtitle", "ref": format!("track-{name}") }));
            operations.push(
                json!({ "type": "insertItems", "sequenceId": sequence_id, "items": [{ "type": "caption",
                "trackRef": format!("track-{name}"), "documentRef": name, "span": { "fromFrame": 0, "durationFrames": 30 } }] }),
            );
        }
        let params = json!({ "videoId": video_id, "commandId": "cmd_cap", "expectedRevision": "0", "actor": actor,
            "operations": operations });
        host.handle("edits.apply", params, &mut |_| {}).unwrap();

        let plan = host
            .handle("exports.plan", json!({ "videoId": video_id, "kind": "video" }), &mut |_| {})
            .unwrap();
        let kinds: std::collections::BTreeMap<String, String> = plan["documents"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|d| d["kind"] == json!("caption"))
            .map(|d| {
                let text = d["body"]["cues"][0]["text"].as_str().unwrap().to_string();
                (text, d["lineKind"].as_str().unwrap().to_string())
            })
            .collect();
        assert_eq!(kinds.get("orig").map(String::as_str), Some("original"));
        assert_eq!(kinds.get("from1").map(String::as_str), Some("translation"));
        assert_eq!(kinds.get("from2").map(String::as_str), Some("translation"));
        // 原文字幕派生自转写：转写随计划冻结，字幕文档带着 `sourceDocumentId`（字幕取词）；译文不带出转写以外的文档。
        let documents = plan["documents"].as_array().unwrap();
        let orig = documents.iter().find(|d| d["body"]["cues"][0]["text"] == json!("orig")).unwrap();
        let speech_id = orig["sourceDocumentId"].as_str().unwrap();
        let speech = documents
            .iter()
            .find(|d| d["documentId"] == json!(speech_id))
            .expect("转写一起冻结");
        assert_eq!(speech["kind"], json!("speech"));
        assert_eq!(speech["body"]["words"][0]["id"], json!("w1"));
        assert_eq!(documents.iter().filter(|d| d["kind"] == json!("translation")).count(), 0);
    }

    #[test]
    fn exports_plan_rejects_empty_ranges_and_unknown_input() {
        let root = tempfile::tempdir().unwrap();
        let mut host = host();
        let created = create(&mut host, &root.path().join("e"));
        let video_id = created["videoId"].clone();
        let mut call = |params: Value| host.handle("exports.plan", params, &mut |_| {});
        // 空序列：整条范围是空的。
        let empty = call(json!({ "videoId": video_id, "kind": "audio" })).unwrap_err();
        assert_eq!(empty.code, "EXPORT_RANGE_EMPTY");
        let backwards = call(json!({ "videoId": video_id, "kind": "audio", "ranges": [{ "start": 2.0, "end": 1.0 }] })).unwrap_err();
        assert_eq!(backwards.code, "EXPORT_RANGE_EMPTY");
        assert_eq!(
            call(json!({ "videoId": video_id, "kind": "audio", "extra": 1 })).unwrap_err().code,
            "INVALID_PARAMS"
        );
        assert_eq!(
            call(json!({ "videoId": video_id, "kind": "text" })).unwrap_err().code,
            "INVALID_PARAMS"
        );
        assert_eq!(
            call(json!({ "videoId": video_id, "kind": "video" })).unwrap_err().code,
            "EXPORT_RANGE_EMPTY"
        );
        assert_eq!(
            call(json!({ "videoId": video_id, "kind": "project" })).unwrap_err().code,
            "INVALID_PARAMS"
        );
        assert_eq!(
            call(json!({ "videoId": video_id, "kind": "audio", "sequenceId": "seq_nope" }))
                .unwrap_err()
                .code,
            "ENTITY_NOT_FOUND"
        );
    }

    /// 只要原声 / 只要一组配音（架构设计 §9.13）：实例的选择只用于声音计划（音频与成片），文字计划与形状不对时拒绝。
    #[test]
    fn exports_plan_takes_an_audio_item_selection_only_for_audio_and_video() {
        let root = tempfile::tempdir().unwrap();
        let mut host = host();
        let created = create(&mut host, &root.path().join("s"));
        let video_id = created["videoId"].clone();
        let mut call = |params: Value| host.handle("exports.plan", params, &mut |_| {});
        let selection = json!({ "disable": ["item_nope"], "unmute": [] });
        // 序列里没有的 ID 忽略：空序列照常报空范围。
        assert_eq!(
            call(json!({ "videoId": video_id, "kind": "audio", "audioItems": selection }))
                .unwrap_err()
                .code,
            "EXPORT_RANGE_EMPTY"
        );
        assert_eq!(
            call(json!({ "videoId": video_id, "kind": "video", "audioItems": selection }))
                .unwrap_err()
                .code,
            "EXPORT_RANGE_EMPTY"
        );
        assert_eq!(
            call(json!({ "videoId": video_id, "kind": "text", "documentIds": ["doc_nope"], "audioItems": selection }))
                .unwrap_err()
                .code,
            "INVALID_PARAMS"
        );
        assert_eq!(
            call(json!({ "videoId": video_id, "kind": "audio", "audioItems": { "only": [] } }))
                .unwrap_err()
                .code,
            "INVALID_PARAMS"
        );
        // 输出尺寸只用于成片，宽高是正整数。
        for (kind, output) in [
            ("audio", json!({ "height": 720 })),
            ("video", json!({ "width": 0 })),
            ("video", json!({ "depth": 1 })),
        ] {
            assert_eq!(
                call(json!({ "videoId": video_id, "kind": kind, "output": output }))
                    .unwrap_err()
                    .code,
                "INVALID_PARAMS",
                "{kind} {output}"
            );
        }
    }

    /// 清点字体用的成片计划（`skipAssets`）：不冻结素材，素材文件不见了也照样给出序列与文档；导出用的计划照样报 `ASSET_MISSING`。
    #[test]
    fn a_video_plan_without_assets_ignores_missing_files() {
        let root = tempfile::tempdir().unwrap();
        let wav = root.path().join("vo.wav");
        write_wav(&wav, 2);
        let mut host = host();
        let created = create(&mut host, &root.path().join("缺素材"));
        let video_id = created["videoId"].as_str().unwrap().to_string();
        let actor = json!({ "kind": "user", "id": "user_local" });
        let params = json!({ "videoId": video_id, "commandId": "cmd_0", "expectedRevision": "0", "actor": actor,
            "operations": [{ "type": "importAsset", "path": wav, "storage": "linked", "ref": "vo" }] });
        let asset = host.handle("edits.apply", params, &mut |_| {}).unwrap()["receipt"]["refs"]["vo"].clone();
        let snapshot = host.handle("videos.snapshot", json!({ "videoId": video_id }), &mut |_| {}).unwrap()["snapshot"].clone();
        let sequence_id = snapshot["rootSequenceId"].as_str().unwrap().to_string();
        let track = snapshot["sequences"][&sequence_id]["tracks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["name"] == "A1")
            .unwrap()["id"]
            .clone();
        let item = json!({
            "type": "audio", "trackId": track, "assetRef": { "id": asset, "revision": "1" },
            "fromFrame": 0, "subframeOffset": { "ticks": "0", "timescale": 1 }, "playDuration": { "ticks": "2", "timescale": 1 },
            "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
            "mix": { "volume": 1 },
        });
        let params = json!({ "videoId": video_id, "commandId": "cmd_1", "expectedRevision": "1", "actor": actor,
            "operations": [{ "type": "insertItems", "sequenceId": sequence_id, "items": [item] }] });
        host.handle("edits.apply", params, &mut |_| {}).unwrap();
        std::fs::remove_file(&wav).unwrap();

        let mut call = |params: Value| host.handle("exports.plan", params, &mut |_| {});
        assert_eq!(
            call(json!({ "videoId": video_id, "kind": "video" })).unwrap_err().code,
            "ASSET_MISSING"
        );
        let plan = call(json!({ "videoId": video_id, "kind": "video", "skipAssets": true })).unwrap();
        assert_eq!(plan["assets"], json!([]));
        assert_eq!(plan["parts"].as_array().unwrap().len(), 1);
        assert_eq!(plan["document"]["rootSequenceId"], json!(sequence_id));
        assert_eq!(
            call(json!({ "videoId": video_id, "kind": "audio", "skipAssets": true }))
                .unwrap_err()
                .code,
            "INVALID_PARAMS"
        );
    }

    /// 成片的声音来源（架构设计 §9.13）：选择只套在声音计划上，画面计划与冻结的序列（`document`）照原样，视频本身也不变。
    #[test]
    fn a_video_plan_applies_the_audio_item_selection_to_the_sound_only() {
        let root = tempfile::tempdir().unwrap();
        let mut host = host();
        let created = create(&mut host, &root.path().join("成片"));
        let video_id = created["videoId"].as_str().unwrap().to_string();
        let snapshot = host.handle("videos.snapshot", json!({ "videoId": video_id }), &mut |_| {}).unwrap();
        let sequence_id = snapshot["snapshot"]["rootSequenceId"].as_str().unwrap().to_string();
        let actor = Actor {
            kind: ActorKind::User,
            id: "user_local".into(),
        };
        let caption = json!({ "schema": "baocut.caption/1", "clock": "sequence", "timescale": 1000,
            "cues": [{ "id": "c1", "start": 0, "end": 1000, "text": "字幕" }] });
        let operations = vec![
            json!({ "type": "putDocument", "ref": "cap", "kind": "caption", "name": "字幕", "body": caption }),
            json!({ "type": "addTrack", "kind": "subtitle", "ref": "track" }),
            json!({ "type": "insertItems", "sequenceId": sequence_id, "items": [{ "type": "caption",
                "trackRef": "track", "documentRef": "cap", "span": { "fromFrame": 0, "durationFrames": 30 } }] }),
        ];
        let params = json!({ "videoId": video_id, "commandId": "cmd_sel", "expectedRevision": "0", "actor": actor,
            "operations": operations });
        host.handle("edits.apply", params, &mut |_| {}).unwrap();
        let snapshot = host.handle("videos.snapshot", json!({ "videoId": video_id }), &mut |_| {}).unwrap();
        let item_id = snapshot["snapshot"]["sequences"][&sequence_id]["items"][0]["id"].clone();
        let revision = snapshot["snapshot"]["revision"].clone();

        // 停用的是画面上的实例：声音计划之外什么都不变（声音来源从来不改画面）。
        let selection = json!({ "disable": [item_id], "unmute": [] });
        let plan = host
            .handle(
                "exports.plan",
                json!({ "videoId": video_id, "kind": "video", "audioItems": selection }),
                &mut |_| {},
            )
            .unwrap();
        let frozen = &plan["document"]["sequences"][&sequence_id]["items"][0];
        assert_eq!(frozen["id"], item_id);
        assert_eq!(frozen["enabled"], json!(true));
        assert_eq!(
            plan["parts"][0]["video"]["documents"],
            json!([plan["documents"][0]["documentId"].clone()])
        );
        assert!(plan["parts"][0]["audio"].is_object());
        // 没给输出尺寸：画布尺寸，画面铺满；宽高都给、比例不同：画面居中，其余是黑边。
        let canvas = &plan["canvas"];
        let (cw, ch) = (canvas["width"].clone(), canvas["height"].clone());
        assert_eq!(
            plan["output"],
            json!({ "width": cw, "height": ch, "picture": { "x": 0, "y": 0, "width": cw, "height": ch }, "adjusted": false })
        );
        let boxed = host
            .handle(
                "exports.plan",
                json!({ "videoId": video_id, "kind": "video", "output": { "width": 1080, "height": 1080 } }),
                &mut |_| {},
            )
            .unwrap();
        let expected =
            render_graph::video_plan::output_geometry(cw.as_u64().unwrap() as u32, ch.as_u64().unwrap() as u32, Some(1080), Some(1080));
        assert_eq!(boxed["output"], serde_json::to_value(expected).unwrap());
        assert_eq!((expected.width, expected.height), (1080, 1080));
        let after = host.handle("videos.snapshot", json!({ "videoId": video_id }), &mut |_| {}).unwrap();
        assert_eq!(after["snapshot"]["revision"], revision);
        assert_eq!(after["snapshot"]["sequences"][&sequence_id]["items"][0]["enabled"], json!(true));
    }

    fn jobs_actor() -> Actor {
        Actor {
            kind: ActorKind::System,
            id: "system:jobs".into(),
        }
    }

    fn rename(video_id: &str, command_id: &str, revision: &str, name: &str, run: Option<Value>) -> Value {
        let mut params = json!({
            "videoId": video_id, "commandId": command_id, "expectedRevision": revision, "actor": jobs_actor(),
            "operations": [{ "type": "renameVideo", "name": name }],
        });
        if let Some(run) = run {
            params["run"] = run;
        }
        params
    }

    fn invalidate(host: &mut Host, video_id: &str, run_id: &str, generation: &str) -> Value {
        host.handle(
            "runs.invalidate",
            json!({ "videoId": video_id, "runId": run_id, "runGeneration": generation }),
            &mut |_| {},
        )
        .unwrap()
    }

    #[test]
    fn a_commit_from_an_invalidated_run_is_rejected_without_a_transaction() {
        let root = tempfile::tempdir().unwrap();
        let mut host = host();
        let created = create(&mut host, &root.path().join("m"));
        let video_id = created["videoId"].as_str().unwrap().to_string();
        assert_eq!(invalidate(&mut host, &video_id, "job_a", "1")["recorded"], json!(true));

        let mut events = Vec::new();
        let run = json!({ "runId": "job_a", "runGeneration": "1" });
        let error = host
            .handle("edits.apply", rename(&video_id, "cmd_1", "0", "被停止", Some(run)), &mut |e| {
                events.push(e.clone())
            })
            .unwrap_err();
        assert_eq!(error.code, "TASK_STOPPED");
        assert_eq!(error.retryability, Retryability::Never);
        assert_eq!(error.details["stoppedGeneration"], json!("1"));
        assert!(events.is_empty(), "被拒的提交不发事件");
        // 没有回执、没有事务。
        let receipt = host
            .handle(
                "receipts.byCommand",
                json!({ "videoId": video_id, "commandId": "cmd_1" }),
                &mut |_| {},
            )
            .unwrap();
        assert_eq!(receipt["receipt"], Value::Null);
        let inspect = host
            .handle("videos.inspect", json!({ "path": root.path().join("m") }), &mut |_| {})
            .unwrap();
        assert_eq!(inspect["name"], json!("测试"));
        let after = host
            .handle("events.after", json!({ "videoId": video_id, "after": "0" }), &mut |_| {})
            .unwrap();
        assert!(after["events"].as_array().unwrap().is_empty());
    }

    #[test]
    fn task_protections_apply_to_non_user_commits_with_a_task() {
        let root = tempfile::tempdir().unwrap();
        let mut host = host();
        let created = create(&mut host, &root.path().join("m"));
        let video_id = created["videoId"].as_str().unwrap().to_string();
        let guard =
            json!([{ "protectionId": "prot_1", "target": { "kind": "property", "entityId": video_id, "propertyPaths": ["name"] } }]);
        let with = |actor: Value, command: &str, revision: &str, task: bool| {
            let mut params = json!({
                "videoId": video_id, "commandId": command, "expectedRevision": revision, "actor": actor,
                "operations": [{ "type": "renameVideo", "name": command }], "protections": guard,
            });
            if task {
                params["taskId"] = json!("task_1");
            }
            params
        };
        let agent = json!({ "kind": "agent", "id": "agent:conv_1" });
        let jobs = json!({ "kind": "system", "id": "system:jobs" });
        let user = json!({ "kind": "user", "id": "user_local" });

        let mut events = Vec::new();
        let error = host
            .handle("edits.apply", with(agent.clone(), "cmd_agent", "0", true), &mut |e| {
                events.push(e.clone())
            })
            .unwrap_err();
        assert_eq!(error.code, "TASK_PROTECTED");
        assert_eq!(error.entity_ids, vec![video_id.clone()]);
        assert_eq!(error.details["protections"][0]["protectionId"], json!("prot_1"));
        assert!(events.is_empty(), "被拒的提交不发事件");

        // 任务下的 Job 与流程以系统身份应用结果：带着 taskId 同样受保护。
        let error = host
            .handle("edits.apply", with(jobs.clone(), "cmd_job", "0", true), &mut |e| {
                events.push(e.clone())
            })
            .unwrap_err();
        assert_eq!(error.code, "TASK_PROTECTED");
        assert_eq!(error.details["protections"][0]["protectionId"], json!("prot_1"));
        assert!(events.is_empty(), "被拒的提交不发事件");

        // 用户的修改（包括用户决定应用任务的结果）、不在任务里的智能体与系统写入不受任务保护限制。
        host.handle("edits.apply", with(user, "cmd_user", "0", true), &mut |_| {}).unwrap();
        host.handle("edits.apply", with(agent, "cmd_free", "1", false), &mut |_| {})
            .unwrap();
        host.handle("edits.apply", with(jobs, "cmd_system", "2", false), &mut |_| {})
            .unwrap();
    }

    #[test]
    fn commits_outside_the_invalidated_run_proceed() {
        let root = tempfile::tempdir().unwrap();
        let mut host = host();
        let created = create(&mut host, &root.path().join("m"));
        let video_id = created["videoId"].as_str().unwrap().to_string();
        invalidate(&mut host, &video_id, "job_a", "1");

        // 重试换代之后的同一任务、别的任务、不带 run 的普通编辑都照常提交。
        let next = json!({ "runId": "job_a", "runGeneration": "2" });
        let other = json!({ "runId": "job_b", "runGeneration": "1" });
        let r1 = host
            .handle("edits.apply", rename(&video_id, "cmd_1", "0", "一", Some(next)), &mut |_| {})
            .unwrap();
        assert_eq!(r1["receipt"]["videoRevision"], json!("1"));
        let r2 = host
            .handle("edits.apply", rename(&video_id, "cmd_2", "1", "二", Some(other)), &mut |_| {})
            .unwrap();
        assert_eq!(r2["receipt"]["videoRevision"], json!("2"));
        let user = json!({
            "videoId": video_id, "commandId": "cmd_3", "expectedRevision": "2",
            "actor": { "kind": "user", "id": "user_local" },
            "operations": [{ "type": "renameVideo", "name": "三" }],
        });
        let r3 = host.handle("edits.apply", user, &mut |_| {}).unwrap();
        assert_eq!(r3["receipt"]["videoRevision"], json!("3"));
    }

    #[test]
    fn idempotent_receipts_are_unaffected_by_the_barrier() {
        let root = tempfile::tempdir().unwrap();
        let mut host = host();
        let created = create(&mut host, &root.path().join("m"));
        let video_id = created["videoId"].as_str().unwrap().to_string();
        let run = json!({ "runId": "job_a", "runGeneration": "1" });
        let params = rename(&video_id, "cmd_1", "0", "已提交", Some(run));
        let first = host.handle("edits.apply", params.clone(), &mut |_| {}).unwrap();
        invalidate(&mut host, &video_id, "job_a", "1");

        // 提交过的命令照常重放同一份回执，按 commandId 也查得到。
        let mut events = Vec::new();
        let replay = host.handle("edits.apply", params, &mut |e| events.push(e.clone())).unwrap();
        assert_eq!(replay["replayed"], json!(true));
        assert_eq!(replay["receipt"], first["receipt"]);
        assert!(events.is_empty());
        let found = host
            .handle(
                "receipts.byCommand",
                json!({ "videoId": video_id, "commandId": "cmd_1" }),
                &mut |_| {},
            )
            .unwrap();
        assert_eq!(found["receipt"], first["receipt"]);
    }

    #[test]
    fn invalidations_are_cleared_with_the_video_and_not_kept_for_closed_videos() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("m");
        let mut host = host();
        let created = create(&mut host, &dir);
        let video_id = created["videoId"].as_str().unwrap().to_string();
        invalidate(&mut host, &video_id, "job_a", "1");
        assert_eq!(host.barrier.len(&video_id), 1);
        host.handle("videos.close", json!({ "videoId": video_id }), &mut |_| {}).unwrap();
        assert_eq!(host.barrier.len(&video_id), 0);
        assert_eq!(invalidate(&mut host, &video_id, "job_a", "1")["recorded"], json!(false));
        assert_eq!(host.barrier.len(&video_id), 0);

        let bad = host
            .handle(
                "runs.invalidate",
                json!({ "videoId": video_id, "runId": "job_a", "runGeneration": "x" }),
                &mut |_| {},
            )
            .unwrap_err();
        assert_eq!(bad.code, "INVALID_PARAMS");
    }

    fn has_ffprobe() -> bool {
        let ok = std::process::Command::new("ffprobe")
            .arg("-version")
            .output()
            .is_ok_and(|o| o.status.success());
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
        std::fs::write(path, bytes).unwrap();
    }

    /// 端到端：经 `edits.apply` 写进转写与按文稿触发的闪避，`exports.plan` 的声音计划按有效词流压低音乐，
    /// 不再报预览没有施加（预览把同一份词流交给逐帧计划）；词全被剪掉之后不压低，报 `DUCK_NO_SPEECH`。
    #[test]
    fn export_plans_duck_music_under_the_effective_word_stream() {
        if !has_ffprobe() {
            return;
        }
        let root = tempfile::tempdir().unwrap();
        let wav = root.path().join("vo.wav");
        write_wav(&wav, 4);
        // 音乐是另一个素材（长度不同，内容就不同）：转写只投到旁白上。
        let bed = root.path().join("music.wav");
        write_wav(&bed, 5);
        let mut host = host();
        let created = create(&mut host, &root.path().join("闪避"));
        let video_id = created["videoId"].as_str().unwrap().to_string();
        let actor = json!({ "kind": "user", "id": "user_local" });
        let mut revision = 0;
        let mut apply = |host: &mut Host, operations: Value| -> Value {
            let params = json!({
                "videoId": video_id, "commandId": format!("cmd_{revision}"), "expectedRevision": revision.to_string(),
                "actor": actor, "operations": operations,
            });
            let result = host.handle("edits.apply", params, &mut |_| {}).unwrap();
            revision += 1;
            result
        };
        let speech = json!({ "schema": "baocut.speech/1", "clock": "source-asset", "timescale": 1000, "speakers": [],
            "words": [{ "id": "w1", "text": "你好", "start": 0, "end": 400, "speaker": "spk_a" }, { "id": "w2", "text": "再见", "start": 2600, "end": 3000 }] });
        let first = apply(
            &mut host,
            json!([
                { "type": "importAsset", "path": wav, "storage": "linked", "ref": "vo" },
                { "type": "importAsset", "path": bed, "storage": "linked", "ref": "bed" },
                { "type": "putDocument", "kind": "speech", "name": "转写", "sourceAsset": { "ref": "vo" }, "body": speech },
                { "type": "addTrack", "kind": "audio", "name": "A2" },
            ]),
        );
        let (vo, bed) = (first["receipt"]["refs"]["vo"].clone(), first["receipt"]["refs"]["bed"].clone());
        let snapshot = host.handle("videos.snapshot", json!({ "videoId": video_id }), &mut |_| {}).unwrap()["snapshot"].clone();
        let sequence_id = snapshot["rootSequenceId"].as_str().unwrap().to_string();
        let track = |name: &str| {
            snapshot["sequences"][&sequence_id]["tracks"]
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t["name"] == name)
                .unwrap()["id"]
                .clone()
        };
        let audio = |track: Value, asset: &Value| {
            json!({
                "type": "audio", "trackId": track, "assetRef": { "id": asset, "revision": "1" },
                "fromFrame": 0, "subframeOffset": { "ticks": "0", "timescale": 1 }, "playDuration": { "ticks": "4", "timescale": 1 },
                "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
                "mix": { "volume": 1 },
            })
        };
        apply(
            &mut host,
            json!([{ "type": "insertItems", "sequenceId": sequence_id, "items": [audio(track("A1"), &vo), audio(track("A2"), &bed)] }]),
        );
        let items = host.handle("videos.snapshot", json!({ "videoId": video_id }), &mut |_| {}).unwrap()["snapshot"]["sequences"]
            [&sequence_id]["items"]
            .clone();
        let playing = |asset: &Value| items.as_array().unwrap().iter().find(|i| &i["assetRef"]["id"] == asset).unwrap()["id"].clone();
        let (voice, music) = (playing(&vo), playing(&bed));
        apply(
            &mut host,
            json!([{ "type": "setDucking", "sequenceId": sequence_id, "trigger": { "kind": "speech" },
                     "target": { "itemIds": [music] }, "depth": 12, "attack": "0.1", "release": "0.1" }]),
        );

        let plan = |host: &mut Host| {
            host.handle("exports.plan", json!({ "videoId": video_id, "kind": "audio" }), &mut |_| {})
                .unwrap()["parts"][0]["audio"]
                .clone()
        };
        let audio_plan = plan(&mut host);
        let segment = audio_plan["segments"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["itemId"] == music)
            .unwrap()
            .clone();
        let knots: Vec<(f64, f64)> = segment["ducking"]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| (k[0].as_f64().unwrap(), k[1].as_f64().unwrap()))
            .collect();
        let at = |t: f64| render_graph::audio_plan::knots_at(&knots, t);
        assert!((at(0.2) - 12.0).abs() < 1e-9);
        assert_eq!(at(1.5), 0.0);
        assert!((at(2.8) - 12.0).abs() < 1e-9);
        assert_eq!(audio_plan["notes"], json!([]));

        // 成片计划：没有写了 `speaker` 的声波时不给说话人的区间；加一个之后给（只算写了说话人的词）。
        let video_plan = |host: &mut Host| {
            host.handle("exports.plan", json!({ "videoId": video_id, "kind": "video" }), &mut |_| {})
                .unwrap()
        };
        assert!(video_plan(&mut host).get("speakers").is_none());
        let visualizer = json!({
            "type": "visualizer", "trackId": track("V1"), "span": { "fromFrame": 0, "durationFrames": 30 }, "place": {},
            "visualizer": { "style": "bars", "speaker": "spk_a" },
        });
        apply(
            &mut host,
            json!([{ "type": "insertItems", "sequenceId": sequence_id, "items": [visualizer] }]),
        );
        assert_eq!(video_plan(&mut host)["speakers"], json!({ "spk_a": [[0.0, 0.4]] }));

        // 把两个词所在的部分都剪掉（只留源 [1, 2) 秒）：有效词流为空，不压低。
        apply(
            &mut host,
            json!([{ "type": "trimItem", "sequenceId": sequence_id, "itemId": voice, "edge": "start",
                     "at": { "unit": "seconds", "value": "1" }, "alignment": "exact-frame" },
                   { "type": "trimItem", "sequenceId": sequence_id, "itemId": voice, "edge": "end",
                     "at": { "unit": "seconds", "value": "2" }, "alignment": "exact-frame" }]),
        );
        let audio_plan = plan(&mut host);
        assert!(
            audio_plan["segments"]
                .as_array()
                .unwrap()
                .iter()
                .all(|s| s.get("ducking").is_none())
        );
        assert_eq!(audio_plan["notes"], json!([{ "code": "DUCK_NO_SPEECH", "itemId": music }]));
    }

    /// 端到端：经 `edits.apply` 剪掉旁白源 [1, 2) 秒，旁白拆开、后半段前移，跟随剪口的图形一起前移；推送的事件带上剪口集合
    /// 文档与移动的实例。恢复剪口是新的事务，放回之后接回一段、图形回到原处。
    #[test]
    fn cuts_relay_the_voice_and_its_followers_through_the_host() {
        if !has_ffprobe() {
            return;
        }
        let root = tempfile::tempdir().unwrap();
        let wav = root.path().join("vo.wav");
        write_wav(&wav, 4);
        let mut host = host();
        let created = create(&mut host, &root.path().join("剪口"));
        let video_id = created["videoId"].as_str().unwrap().to_string();
        let actor = json!({ "kind": "user", "id": "user_local" });
        let mut revision = 0;
        let mut events: Vec<VideoEvent> = Vec::new();
        let mut apply = |host: &mut Host, events: &mut Vec<VideoEvent>, operations: Value| -> Value {
            let params = json!({
                "videoId": video_id, "commandId": format!("cmd_{revision}"), "expectedRevision": revision.to_string(),
                "actor": actor, "operations": operations,
            });
            let result = host.handle("edits.apply", params, &mut |e| events.push(e.clone())).unwrap();
            revision += 1;
            result
        };
        let first = apply(
            &mut host,
            &mut events,
            json!([
                { "type": "importAsset", "path": wav, "storage": "linked", "ref": "vo" },
                { "type": "addTrack", "kind": "visual", "name": "图形", "ref": "g" },
            ]),
        );
        let vo = first["receipt"]["refs"]["vo"].clone();
        let graphics = first["receipt"]["refs"]["g"].clone();
        let snapshot =
            |host: &mut Host| host.handle("videos.snapshot", json!({ "videoId": video_id }), &mut |_| {}).unwrap()["snapshot"].clone();
        let sequence_id = snapshot(&mut host)["rootSequenceId"].as_str().unwrap().to_string();
        let a1 = snapshot(&mut host)["sequences"][&sequence_id]["tracks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["name"] == "A1")
            .unwrap()["id"]
            .clone();
        let inserted = apply(
            &mut host,
            &mut events,
            json!([{ "type": "insertItems", "sequenceId": sequence_id, "items": [
                { "type": "audio", "trackId": a1, "assetRef": { "id": vo, "revision": "1" },
                  "fromFrame": 0, "subframeOffset": { "ticks": "0", "timescale": 1 }, "playDuration": { "ticks": "4", "timescale": 1 },
                  "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
                  "mix": { "volume": 1 } },
                { "type": "shape", "trackId": graphics, "span": { "fromFrame": 90, "durationFrames": 30 },
                  "shape": { "shape": "rect", "fill": "#FFD646" }, "followPolicy": { "kind": "follow-cuts" } },
            ] }]),
        );
        let ids: Vec<String> = serde_json::from_value(inserted["receipt"]["createdIds"].clone()).unwrap();
        let items = |host: &mut Host| snapshot(host)["sequences"][&sequence_id]["items"].as_array().unwrap().clone();
        let shape_id = items(&mut host).iter().find(|i| i["type"] == "shape").unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(ids.contains(&shape_id));

        events.clear();
        let cut = apply(
            &mut host,
            &mut events,
            json!([{ "type": "addCuts", "sequenceId": sequence_id, "assetId": vo, "cuts": [{ "from": "1", "to": "2", "ref": "s1" }] }]),
        );
        assert_eq!(cut["receipt"]["label"], "剪掉片段");
        assert_eq!(cut["receipt"]["impact"]["newDurationFrames"], 90);
        let after = items(&mut host);
        let voices: Vec<(Value, Value)> = after
            .iter()
            .filter(|i| i["type"] == "audio")
            .map(|i| (i["fromFrame"].clone(), i["playDuration"].clone()))
            .collect();
        assert_eq!(voices.len(), 2, "旁白在剪口处拆成两段：{after:?}");
        let shape = after.iter().find(|i| i["id"] == shape_id.as_str()).unwrap();
        assert_eq!(shape["span"], json!({ "fromFrame": 60, "durationFrames": 30 }));
        // 一笔事务推送一条事件，带上新建的剪口集合文档与移动的实例。
        assert_eq!(events.len(), 1);
        let documents = snapshot(&mut host)["documents"].clone();
        let (cut_set_id, cut_set) = documents
            .as_object()
            .unwrap()
            .iter()
            .find(|(_, v)| v["kind"] == "cut-set")
            .map(|(k, v)| (k.clone(), v.clone()))
            .unwrap();
        assert_eq!(cut_set["sourceAssetId"], vo);
        assert!(events[0].changed_ids.contains(&cut_set_id));
        assert!(events[0].changed_ids.contains(&shape_id));
        let body = host
            .handle(
                "documents.read",
                json!({ "videoId": video_id, "documentId": cut_set_id }),
                &mut |_| {},
            )
            .unwrap();
        let cut_id = body["body"]["cuts"][0]["id"].clone();
        assert_eq!(body["body"]["cuts"][0]["ref"], "s1");

        events.clear();
        let restored = apply(
            &mut host,
            &mut events,
            json!([{ "type": "restoreCut", "sequenceId": sequence_id, "assetId": vo, "cutId": cut_id }]),
        );
        assert_eq!(restored["receipt"]["label"], "恢复剪口");
        assert_eq!(restored["receipt"]["impact"]["newDurationFrames"], 120);
        let back = items(&mut host);
        assert_eq!(back.iter().filter(|i| i["type"] == "audio").count(), 1, "放回之后接回一段");
        let shape = back.iter().find(|i| i["id"] == shape_id.as_str()).unwrap();
        assert_eq!(shape["span"], json!({ "fromFrame": 90, "durationFrames": 30 }));
        assert_eq!(events.len(), 1);
        let body = host
            .handle(
                "documents.read",
                json!({ "videoId": video_id, "documentId": cut_set_id }),
                &mut |_| {},
            )
            .unwrap();
        assert_eq!(body["body"]["cuts"], json!([]));
    }

    #[test]
    fn unused_assets_lists_what_no_clip_refers_to() {
        let root = tempfile::tempdir().unwrap();
        let mut host = host();
        let created = create(&mut host, &root.path().join("m"));
        let video_id = created["videoId"].as_str().unwrap().to_string();
        let empty = host
            .handle("videos.unusedAssets", json!({ "videoId": video_id }), &mut |_| {})
            .unwrap();
        assert_eq!(empty, json!({ "unused": [] }));

        let image = root.path().join("logo.svg");
        std::fs::write(&image, r#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>"#).unwrap();
        let actor = Actor {
            kind: ActorKind::User,
            id: "user_local".into(),
        };
        let params = json!({
            "videoId": video_id, "commandId": "cmd_import", "expectedRevision": "0", "actor": actor,
            "operations": [{ "type": "importAsset", "path": image, "ref": "logo" }],
        });
        let applied = host.handle("edits.apply", params, &mut |_| {}).unwrap();
        let asset_id = applied["receipt"]["refs"]["logo"].clone();
        let listed = host
            .handle("videos.unusedAssets", json!({ "videoId": video_id }), &mut |_| {})
            .unwrap();
        assert_eq!(listed["unused"].as_array().unwrap().len(), 1);
        assert_eq!(listed["unused"][0]["assetId"], asset_id);
        assert_eq!(listed["unused"][0]["name"], json!("logo.svg"));
    }
}
