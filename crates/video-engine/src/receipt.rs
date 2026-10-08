//! 回执、事件与历史（命令与协议规范 §5、§10）。

use std::collections::BTreeMap;

use editor_semantics::TimeQuantizationReceipt;
use serde::{Deserialize, Serialize};
use message_ref::MessageRef;
use serde_json::Value;

use crate::model::{Actor, Id, VersionRef};
use crate::state::EntityKind;

/// 事务持久化成功之后才有回执。它是「这次修改确实发生了」的唯一依据。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionReceipt {
    pub transaction_id: Id,
    pub command_id: Id,
    pub status: String,
    pub video_id: Id,
    pub previous_revision: String,
    pub video_revision: String,
    pub event_seq: String,
    pub label: String,
    pub actor: Actor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_of: Option<Id>,
    pub created_ids: Vec<Id>,
    pub updated_ids: Vec<Id>,
    pub deleted_ids: Vec<Id>,
    /// 旧实例 → 由它产生的实例（拆分之后左右两段）。
    pub lineage: BTreeMap<Id, Vec<Id>>,
    /// 操作里的 `ref` 解析到的素材或文档 ID：调用方不必从快照里再找一遍。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub refs: BTreeMap<String, Id>,
    pub impact: Impact,
    pub time_resolution: Vec<TimeQuantizationReceipt>,
    /// 明确保持不变的对象：例如同一素材的其他实例（验收 T05）。
    pub preserved: Vec<Id>,
    pub undo: UndoInfo,
    pub committed_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Impact {
    pub old_duration_frames: i64,
    pub new_duration_frames: i64,
    pub translation_units_stale: Vec<Id>,
    pub dubbing_units_stale: Vec<Id>,
    pub orphaned_anchors: Vec<Id>,
    /// 这笔事务里因为两侧不再相接、实例被删或变短、handles 不够而被删掉的转场（视频格式规范 §3.9）。
    /// 它们同时出现在 `deletedIds` 里。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub removed_transitions: Vec<RemovedTransition>,
    /// 这笔事务里因为实例变短而变短的单侧转场（生效长度 min(D, ⌊L/2⌋)，视频格式规范 §3.9）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shortened_transitions: Vec<ShortenedTransition>,
    /// 这笔事务里随剪口删掉的实例：整个落在剪掉的区间里（视频格式规范 §3.16、§6.7）。它们同时出现在 `deletedIds` 里。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub removed_by_cuts: Vec<Id>,
    /// 恢复了、却在序列上找不到接缝放回去的剪口：剪口集合里已经去掉，实例没有动（§6.7）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cuts_not_relaid: Vec<Id>,
    /// 跟着的目标（`item-local`）被删掉、一起删掉的实例（视频格式规范 §3.16）。它们同时出现在 `deletedIds` 里。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub removed_with_target: Vec<Id>,
    /// 这笔事务里改了代码画面的哪一层（代码包规范 §3.4）：`replaceCodeBundle` 换的是源（代码包版本与替身），
    /// 连同前后的版本与长度；长度变短就是裁掉了尾部。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub code_edits: Vec<CodeEdit>,
    /// `deleteTrack` 删掉的空轨道。它们同时出现在 `deletedIds` 里。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub removed_tracks: Vec<Id>,
    /// `removeAssets` 删掉的素材记录，含成对一起删掉的代码包或预渲染替身。它们同时出现在 `deletedIds` 里；bytes 不在这时删除。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub removed_assets: Vec<Id>,
}

/// 代码画面的一次修改：改在哪一层，前后的代码包版本、替身与长度。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeEdit {
    pub item_id: Id,
    pub layer: CodeEditLayer,
    pub previous_bundle_ref: VersionRef,
    pub bundle_ref: VersionRef,
    #[serde(default)]
    pub previous_prerender: Option<VersionRef>,
    #[serde(default)]
    pub prerender: Option<VersionRef>,
    pub old_duration_frames: i64,
    pub new_duration_frames: i64,
}

/// 代码画面的编辑层（代码包规范 §3.4）。目前只有换源。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CodeEditLayer {
    Source,
}

/// 随实例变短的单侧转场：写入的长度与生效的长度。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortenedTransition {
    pub id: Id,
    pub duration_frames: i64,
    pub effective_frames: i64,
}

/// 编辑之后不再成立、被引擎删掉的转场。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedTransition {
    pub id: Id,
    pub reason: TransitionRemoval,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransitionRemoval {
    /// 一侧的实例被删掉了。
    ItemDeleted,
    /// 两侧不再在同一轨道上首尾相接。
    NotAdjacent,
    /// 实例变短，装不下转场的窗口。
    TooLong,
    /// 素材在实例之外剩下的部分不够转场用。
    HandlesInsufficient,
    /// 与同一实例上的另一个转场的窗口重叠（保留开始得早的那个）。
    Overlap,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoInfo {
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unavailable_reason_ref: Option<MessageRef>,
}

/// 视频事件（§10.1）：与视频变更在同一笔事务里写入 outbox，至少一次投递。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoEvent {
    pub video_id: Id,
    pub event_seq: String,
    pub video_revision: String,
    pub transaction_id: Id,
    pub changed_ids: Vec<Id>,
    pub projection: Projection,
    pub actor: Actor,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_of: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<Id>,
}

/// 客户端可以直接消费的投影变化：实体的新值与被删除的实体。序列的新版本随 `sequence` 实体给出。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    pub upserts: Vec<EntityUpsert>,
    pub removals: Vec<EntityRemoval>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityUpsert {
    pub kind: EntityKind,
    pub id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence_id: Option<Id>,
    pub value: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityRemoval {
    pub kind: EntityKind,
    pub id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence_id: Option<Id>,
}

/// 历史里的一笔事务。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub transaction_id: Id,
    pub command_id: Id,
    pub label: String,
    pub actor: Actor,
    pub video_revision: String,
    pub committed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undo_of: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undone_by: Option<Id>,
    /// 0 是正向修改，奇数是撤销，正偶数是重做。
    pub undo_depth: i64,
    pub undo_available: bool,
}
