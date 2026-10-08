//! 错误合同（命令与协议规范 §11）：每个错误都有 code、实体、输入版本、可否重试与细节。

use editor_semantics::TimeError;
pub use message_ref::{MessageRef, Text, msg};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::model::{Id, VersionRef};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Retryability {
    SameCommand,
    AfterRefresh,
    AfterUserAction,
    Never,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    pub code: String,
    /// 英文说明（缺省与兜底）；界面用 `messageRef` 按自己的语言重新生成（§11.1）。
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_ref: Option<MessageRef>,
    pub entity_ids: Vec<Id>,
    pub input_revisions: Vec<VersionRef>,
    pub retryability: Retryability,
    pub details: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery_ref: Option<MessageRef>,
}

pub type EngineResult<T> = Result<T, ErrorBody>;

impl ErrorBody {
    pub fn new(code: &str, message: impl Into<Text>, retryability: Retryability) -> ErrorBody {
        let message = message.into();
        ErrorBody {
            code: code.to_string(),
            message: message.text,
            message_ref: message.message_ref,
            entity_ids: Vec::new(),
            input_revisions: Vec::new(),
            retryability,
            details: Value::Null,
            recovery: None,
            recovery_ref: None,
        }
    }

    pub fn entities(mut self, ids: impl IntoIterator<Item = impl Into<Id>>) -> ErrorBody {
        self.entity_ids.extend(ids.into_iter().map(Into::into));
        self
    }

    pub fn details(mut self, details: Value) -> ErrorBody {
        self.details = details;
        self
    }

    pub fn recovery(mut self, recovery: impl Into<Text>) -> ErrorBody {
        let recovery = recovery.into();
        self.recovery = Some(recovery.text);
        self.recovery_ref = recovery.message_ref;
        self
    }

    /// 说明连同引用，用来嵌进别的说明。
    pub fn message_text(&self) -> Text {
        Text {
            text: self.message.clone(),
            message_ref: self.message_ref.clone(),
        }
    }

    pub fn revisions(mut self, refs: Vec<VersionRef>) -> ErrorBody {
        self.input_revisions = refs;
        self
    }

    // —— 规范里定义的错误码 ——

    pub fn revision_conflict(video_id: &str, expected: &str, current: &str) -> ErrorBody {
        ErrorBody::new(
            "PROJECT_REVISION_CONFLICT",
            msg!("engine.revisionConflict", "The video has changed; this edit was based on an older version"),
            Retryability::AfterRefresh,
        )
        .entities([video_id])
        .revisions(vec![VersionRef {
            id: video_id.into(),
            revision: expected.into(),
        }])
        .details(json!({ "expectedRevision": expected, "currentRevision": current }))
        .recovery(msg!(
            "engine.revisionConflictRecovery",
            "Re-read the affected objects, rebuild the operations and submit them with a new commandId"
        ))
    }

    pub fn idempotency_conflict(command_id: &str) -> ErrorBody {
        ErrorBody::new(
            "IDEMPOTENCY_CONFLICT",
            msg!("engine.idempotencyConflict", "The same commandId was sent with different content"),
            Retryability::Never,
        )
            .details(json!({ "commandId": command_id }))
            .recovery(msg!("engine.idempotencyConflictRecovery", "Use a new commandId"))
    }

    pub fn writer_unavailable(message: impl Into<Text>) -> ErrorBody {
        ErrorBody::new("PROJECT_WRITER_UNAVAILABLE", message, Retryability::AfterUserAction).recovery(msg!(
            "engine.writerUnavailableRecovery",
            "Wait for it to recover; do not write around the engine"
        ))
    }

    pub fn time(err: TimeError) -> ErrorBody {
        let code = err.code();
        match err {
            TimeError::Invalid { field, reason } => ErrorBody::new(code, reason.clone(), Retryability::Never)
                .details(json!({ "field": field, "reason": reason.text }))
                .recovery(msg!("engine.invalidTimeRecovery", "Fix the input; it will not be guessed silently")),
            TimeError::Overflow { field } => ErrorBody::new(
                code,
                msg!("engine.timeOverflow", "{field} exceeds the limits of the time contract", field = &field),
                Retryability::Never,
            )
                .details(json!({ "field": field }))
                .recovery(msg!("engine.timeOverflowRecovery", "Use a smaller value or less precision")),
            TimeError::NotOnFrameGrid {
                requested,
                floor,
                ceil,
                nearest,
            } => ErrorBody::new(
                code,
                msg!("engine.notOnFrameGrid", "The requested time is not on a frame boundary"),
                Retryability::AfterUserAction,
            )
                .details(json!({ "requested": requested, "floorFrame": floor, "ceilFrame": ceil, "nearestFrame": nearest }))
                .recovery(msg!("engine.notOnFrameGridRecovery", "Submit again with an explicit alignment policy")),
        }
    }

    pub fn time_domain_mismatch(message: impl Into<Text>) -> ErrorBody {
        ErrorBody::new("TIME_DOMAIN_MISMATCH", message, Retryability::Never).recovery(msg!(
            "engine.timeDomainMismatchRecovery",
            "Read the owning sequence and its frame rate, then rebuild the command"
        ))
    }

    pub fn range_collapsed(item_id: &str, message: impl Into<Text>) -> ErrorBody {
        ErrorBody::new("TIME_RANGE_COLLAPSED", message, Retryability::AfterUserAction)
            .entities([item_id])
            .recovery(msg!(
                "engine.rangeCollapsedRecovery",
                "Change the range or the alignment policy; frames are not added automatically"
            ))
    }

    pub fn source_out_of_range(item_id: &str, details: Value) -> ErrorBody {
        ErrorBody::new(
            "SOURCE_TIME_OUT_OF_RANGE",
            msg!("engine.sourceOutOfRange", "Beyond the usable range of the media"),
            Retryability::AfterUserAction,
        )
            .entities([item_id])
            .details(details)
            .recovery(msg!("engine.sourceOutOfRangeRecovery", "Shorten the range; it is not truncated silently"))
    }

    pub fn asset_missing(asset_id: &str, message: impl Into<Text>) -> ErrorBody {
        ErrorBody::new("ASSET_MISSING", message, Retryability::AfterUserAction)
            .entities([asset_id])
            .recovery(msg!("engine.assetMissingRecovery", "Import or relink it again"))
    }

    // —— 本实现补全的错误码（规范 §11.6：每个都给出条件与恢复）——

    /// 操作的结构不合法、类型未知，或目标的种类不对。
    pub fn invalid_operation(message: impl Into<Text>) -> ErrorBody {
        ErrorBody::new("INVALID_OPERATION", message, Retryability::Never).recovery(msg!(
            "engine.invalidOperationRecovery",
            "Fix it according to the operation's schema and submit again"
        ))
    }

    /// 目标实体在当前版本里不存在。`kind` 用 [`kinds`] 里的名字。
    pub fn not_found(kind: Text, id: &str) -> ErrorBody {
        ErrorBody::new("ENTITY_NOT_FOUND", msg!("engine.notFound", "{kind} {id} does not exist", kind, id), Retryability::AfterRefresh)
            .entities([id])
            .recovery(msg!("engine.notFoundRecovery", "Re-read the video, then choose the target again"))
    }

    /// 目标或目标轨道被锁定（视频格式规范 §3.10）。
    pub fn locked(ids: Vec<Id>, message: impl Into<Text>) -> ErrorBody {
        ErrorBody::new("TARGET_LOCKED", message, Retryability::AfterUserAction)
            .entities(ids)
            .recovery(msg!("engine.lockedRecovery", "Unlock it explicitly first"))
    }

    /// 同一轨道上的两个实例在时间上重叠。
    pub fn overlap(ids: Vec<Id>) -> ErrorBody {
        ErrorBody::new(
            "TIMELINE_OVERLAP",
            msg!("engine.overlap", "Clips on the same track cannot overlap"),
            Retryability::AfterUserAction,
        )
            .entities(ids)
            .recovery(msg!("engine.overlapRecovery", "Choose another position or track"))
    }

    /// 撤销的对象之后又被修改过，补偿会覆盖别人的修改（命令与协议规范 §8.3）。
    pub fn undo_conflict(ids: Vec<Id>, message: impl Into<Text>) -> ErrorBody {
        ErrorBody::new("UNDO_CONFLICT", message, Retryability::AfterUserAction)
            .entities(ids)
            .recovery(msg!("engine.undoConflictRecovery", "Deal with the later edits first, or change it back by hand"))
    }

    /// 这笔事务没有可用的补偿（已经撤销过，或不存在）。
    pub fn undo_unavailable(transaction_id: &str, reason: Text) -> ErrorBody {
        ErrorBody::new("UNDO_UNAVAILABLE", reason, Retryability::Never).details(json!({ "transactionId": transaction_id }))
    }

    /// 视频的写锁由另一个进程持有（验收 C02、C03）。
    pub fn video_locked(holder: Value) -> ErrorBody {
        ErrorBody::new(
            "VIDEO_LOCKED",
            msg!("engine.videoLocked", "Another process is writing to this video"),
            Retryability::AfterUserAction,
        )
            .details(json!({ "holder": holder }))
            .recovery(msg!("engine.videoLockedRecovery", "Close the other BaoCut that has it open, or open it read-only"))
    }

    /// 以只读方式打开的视频收到了修改。
    pub fn read_only() -> ErrorBody {
        ErrorBody::new("VIDEO_READ_ONLY", msg!("engine.readOnly", "The video is open read-only"), Retryability::AfterUserAction)
            .recovery(msg!("engine.readOnlyRecovery", "Reopen it after acquiring the write lock"))
    }

    /// 视频目录不是可识别的视频，或格式版本不支持。
    pub fn unsupported_video(message: impl Into<Text>) -> ErrorBody {
        ErrorBody::new("VIDEO_UNSUPPORTED", message, Retryability::Never)
            .recovery(msg!("engine.unsupportedVideoRecovery", "Open it with a version of BaoCut that supports it"))
    }

    /// 读取媒体信息失败或没有探测工具。
    pub fn probe_failed(message: impl Into<Text>) -> ErrorBody {
        ErrorBody::new("MEDIA_PROBE_FAILED", message, Retryability::AfterUserAction).recovery(msg!(
            "engine.probeFailedRecovery",
            "Make sure the file plays and that ffprobe is installed"
        ))
    }

    /// 磁盘、数据库等存储错误。事务没有提交。
    pub fn storage(message: impl Into<Text>) -> ErrorBody {
        ErrorBody::new("STORAGE_FAILED", message, Retryability::SameCommand).recovery(msg!(
            "engine.storageRecovery",
            "Check disk space and permissions, then retry with the same commandId"
        ))
    }
}

impl From<TimeError> for ErrorBody {
    fn from(err: TimeError) -> Self {
        ErrorBody::time(err)
    }
}

impl From<rusqlite::Error> for ErrorBody {
    fn from(err: rusqlite::Error) -> Self {
        ErrorBody::storage(msg!("engine.databaseError", "Video storage error: {err}", err = err.to_string()))
    }
}

impl From<std::io::Error> for ErrorBody {
    fn from(err: std::io::Error) -> Self {
        ErrorBody::storage(msg!("engine.fileError", "File read/write error: {err}", err = err.to_string()))
    }
}

/// 错误说明里提到的实体种类（`not_found` 的 `kind`）。
pub mod kinds {
    use super::{Text, msg};

    pub fn sequence() -> Text {
        msg!("engine.kindSequence", "Sequence")
    }
    pub fn item() -> Text {
        msg!("engine.kindItem", "Clip")
    }
    pub fn track() -> Text {
        msg!("engine.kindTrack", "Track")
    }
    pub fn asset() -> Text {
        msg!("engine.kindAsset", "Asset")
    }
    pub fn asset_revision() -> Text {
        msg!("engine.kindAssetRevision", "Asset version")
    }
    pub fn document() -> Text {
        msg!("engine.kindDocument", "Document")
    }
    pub fn document_revision() -> Text {
        msg!("engine.kindDocumentRevision", "Document version")
    }
    pub fn chapter() -> Text {
        msg!("engine.kindChapter", "Chapter")
    }
    pub fn ducking_rule() -> Text {
        msg!("engine.kindDuckingRule", "Ducking rule")
    }
    pub fn cut_set() -> Text {
        msg!("engine.kindCutSet", "Cut set")
    }
    pub fn cut() -> Text {
        msg!("engine.kindCut", "Cut")
    }
    pub fn transition() -> Text {
        msg!("engine.kindTransition", "Transition")
    }
    pub fn transcript() -> Text {
        msg!("engine.kindTranscript", "Transcript")
    }
    pub fn asset_transcript() -> Text {
        msg!("engine.kindAssetTranscript", "Transcript of the asset")
    }
    pub fn checkpoint() -> Text {
        msg!("engine.kindCheckpoint", "Checkpoint")
    }
    pub fn video() -> Text {
        msg!("engine.kindVideo", "Video")
    }
    pub fn directory() -> Text {
        msg!("engine.kindDirectory", "Directory")
    }
    pub fn suggestion() -> Text {
        msg!("engine.kindSuggestion", "Suggestion")
    }
    pub fn cut_proposal() -> Text {
        msg!("engine.kindCutProposal", "Cut proposal")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_message_and_recovery_refs() {
        let err = ErrorBody::not_found(kinds::item(), "item_1");
        let value = serde_json::to_value(&err).unwrap();
        assert_eq!(value["message"], "Clip item_1 does not exist");
        assert_eq!(
            value["messageRef"],
            json!({
                "key": "engine.notFound",
                "params": {
                    "kind": { "key": "engine.kindItem", "text": "Clip" },
                    "id": "item_1",
                },
            })
        );
        assert_eq!(value["recoveryRef"]["key"], "engine.notFoundRecovery");
        assert_eq!(value["recovery"], err.recovery.clone().unwrap());
    }

    #[test]
    fn plain_text_has_no_ref() {
        let value = serde_json::to_value(ErrorBody::new("X", "plain", Retryability::Never)).unwrap();
        assert_eq!(value["message"], "plain");
        assert!(value.get("messageRef").is_none());
        assert!(value.get("recoveryRef").is_none());
    }

    #[test]
    fn time_errors_carry_refs() {
        let err = ErrorBody::time(TimeError::Overflow { field: "at".into() });
        assert_eq!(err.message_ref.unwrap().key, "engine.timeOverflow");
        assert_eq!(err.recovery_ref.unwrap().key, "engine.timeOverflowRecovery");
    }
}
