//! 任务的保护范围（架构设计 §3.2，视频格式规范 §3.10）：只对一个任务生效的「不要改动」。
//!
//! 它属于 TaskContract，不写入视频：Runtime 在任务里的写入（智能体带 taskId 的提交，任务下的 Job 与流程应用结果）
//! 时把它随事务交给引擎，引擎在提交前对照这笔事务的实体变化检查，触碰时整笔拒绝（`TASK_PROTECTED`），什么都不写。
//! 用户与手动的修改不带它，不受限制。
//!
//! - `video`：这个视频的任何变化；
//! - `entity`：这个实体本身的创建、修改与删除（不含它的子实体：保护轨道上的内容用 `interval` 加 `trackIds`）；
//! - `property`：这个实体上的几个属性（实体 JSON 里以点分隔的路径，如 `text`、`style.fontSize`）；实体被删除算触碰；
//! - `interval`：序列上的一段帧区间，修改前或修改后与它相交的时间线实例（音频按精确的起止时刻算）；`trackIds` 给了时
//!   只看这些轨道上的实例。

use editor_semantics::{Ratio, frame_time};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::{EngineResult, ErrorBody, Retryability, msg};
use crate::model::*;
use crate::state::{EntityChange, EntityKind, VideoState, item_range};

/// 一项任务保护。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskProtection {
    pub protection_id: Id,
    pub target: ProtectionTarget,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProtectionTarget {
    Video,
    #[serde(rename_all = "camelCase")]
    Entity {
        entity_id: Id,
    },
    #[serde(rename_all = "camelCase")]
    Property {
        entity_id: Id,
        property_paths: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    Interval {
        sequence_id: Id,
        span: FrameSpan,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        track_ids: Option<Vec<Id>>,
    },
}

/// 这笔事务的变化是否触碰任务保护。触碰时返回 `TASK_PROTECTED`：`entityIds` 是被触碰的实体，
/// `details.protections` 列出被触碰的保护（`protectionId`、`target` 与触碰它的实体）。
pub fn check(before: &VideoState, after: &VideoState, changes: &[EntityChange], protections: &[TaskProtection]) -> EngineResult<()> {
    if protections.is_empty() || changes.is_empty() {
        return Ok(());
    }
    let mut touched_ids: Vec<Id> = Vec::new();
    let mut hits: Vec<Value> = Vec::new();
    for protection in protections {
        let entities = touched(before, after, changes, &protection.target);
        if entities.is_empty() {
            continue;
        }
        for id in &entities {
            if !touched_ids.contains(id) {
                touched_ids.push(id.clone());
            }
        }
        hits.push(json!({
            "protectionId": protection.protection_id,
            "target": protection.target,
            "entityIds": entities,
        }));
    }
    if hits.is_empty() {
        return Ok(());
    }
    Err(ErrorBody::new(
        "TASK_PROTECTED",
        msg!(
            "engine.taskProtected",
            "This change touches what the task contract says not to change"
        ),
        Retryability::AfterUserAction,
    )
    .entities(touched_ids)
    .details(json!({ "protections": hits }))
    .recovery(msg!(
        "engine.taskProtectedRecovery",
        "Avoid the protected objects, or ask the user to adjust the protection in the task contract"
    )))
}

fn touched(before: &VideoState, after: &VideoState, changes: &[EntityChange], target: &ProtectionTarget) -> Vec<Id> {
    match target {
        ProtectionTarget::Video => changes.iter().map(|c| c.id.clone()).collect(),
        ProtectionTarget::Entity { entity_id } => changes.iter().filter(|c| &c.id == entity_id).map(|c| c.id.clone()).collect(),
        ProtectionTarget::Property { entity_id, property_paths } => changes
            .iter()
            .filter(|c| &c.id == entity_id)
            .filter(|c| match (&c.before, &c.after) {
                (Some(b), Some(a)) => property_paths.iter().any(|p| lookup(b, p) != lookup(a, p)),
                _ => true,
            })
            .map(|c| c.id.clone())
            .collect(),
        ProtectionTarget::Interval {
            sequence_id,
            span,
            track_ids,
        } => changes
            .iter()
            .filter(|c| c.kind == EntityKind::Item)
            .filter(|c| {
                [before, after]
                    .into_iter()
                    .any(|state| item_in_interval(state, &c.id, sequence_id, span, track_ids.as_deref()))
            })
            .map(|c| c.id.clone())
            .collect(),
    }
}

/// 点分隔的属性路径（`style.fontSize`）；数组下标也用点（`keyframes.0`）。不存在时 None。
fn lookup<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let segments: Vec<String> = path.split('.').map(|s| s.replace('~', "~0").replace('/', "~1")).collect();
    value.pointer(&format!("/{}", segments.join("/")))
}

/// 这个状态里的实例在序列的这段帧区间上（相交即算）。区间换算不出来时保守地算在内。
fn item_in_interval(state: &VideoState, item_id: &str, sequence_id: &str, span: &FrameSpan, track_ids: Option<&[Id]>) -> bool {
    let Some(placed) = state.items.get(item_id) else {
        return false;
    };
    if placed.sequence_id != sequence_id {
        return false;
    }
    if let Some(tracks) = track_ids
        && !tracks.iter().any(|t| t == &placed.value.base().track_id)
    {
        return false;
    }
    let Some(sequence) = state.sequences.get(sequence_id) else {
        return true;
    };
    let fps = sequence.header.fps;
    let bounds = (|| -> Option<(Ratio, Ratio, Ratio, Ratio)> {
        let from = frame_time(span.from_frame as i128, fps)?;
        let to = frame_time(span.end_frame() as i128, fps)?;
        let (start, end) = item_range(&placed.value, fps).ok()?;
        Some((from, to, start, end))
    })();
    match bounds {
        Some((from, to, start, end)) => start < to && from < end,
        None => true,
    }
}
