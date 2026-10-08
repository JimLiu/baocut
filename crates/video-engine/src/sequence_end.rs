//! 到序列末尾（视频格式规范 §3.16）：`untilSequenceEnd` 的实例没有自己的终点，每笔编辑事务的最后按当前的时间线求出来。
//!
//! - 终点是序列里其余实例精确终点的最大值向上取整到帧（与 `derived` 的序列长度同一个算法）；`fixed` 时是固定的帧数。
//! - 同一条轨道上后面还有实例时截到它的起点，不与它重叠。
//! - 长度至少 1 帧；带线性源时钟的不超出素材。
//! - 这是求出来的值，不是对实例的编辑：实例或轨道锁着也照样更新；任务保护照常核对。

use editor_semantics::frame_time;

use crate::error::EngineResult;
use crate::model::*;
use crate::ops::overflow;
use crate::state::{VideoState, item_range};

/// 按 §3.16 重算每条序列上 `untilSequenceEnd` 实例的终点。
pub(crate) fn settle(state: &mut VideoState) -> EngineResult<()> {
    let sequence_ids: Vec<Id> = state.sequences.keys().cloned().collect();
    for sequence_id in sequence_ids {
        settle_sequence(state, &sequence_id)?;
    }
    Ok(())
}

fn settle_sequence(state: &mut VideoState, sequence_id: &str) -> EngineResult<()> {
    let header = &state.sequences[sequence_id].header;
    let fps = header.fps;
    let fixed = match header.duration_policy {
        DurationPolicy::Fixed { frames } => Some(frames),
        DurationPolicy::Derived => None,
    };
    let mut open: Vec<(i64, Id, Id)> = Vec::new();
    let mut end_frames = 0i64;
    for placed in state.items.values().filter(|p| p.sequence_id == sequence_id) {
        let base = placed.value.base();
        match placed.value.span() {
            Some(span) if base.until_sequence_end => open.push((span.from_frame, base.id.clone(), base.track_id.clone())),
            _ if fixed.is_some() => {}
            _ => {
                let (_, end) = item_range(&placed.value, fps)?;
                let frames = editor_semantics::frames_at(end, fps).ok_or_else(overflow)?;
                end_frames = end_frames.max(frames.ceil() as i64);
            }
        }
    }
    if open.is_empty() {
        return Ok(());
    }
    let end_frames = fixed.unwrap_or(end_frames);
    open.sort();
    for (from, id, track_id) in open {
        // 同一条轨道上的下一个实例：起点在这个实例的起点之后（没有重叠，所以至少晚一帧）。
        let next = state
            .items
            .values()
            .filter(|p| p.sequence_id == sequence_id && p.value.base().track_id == track_id && p.value.base().id != id)
            .filter_map(|p| p.value.span().map(|s| s.from_frame))
            .filter(|&start| start > from)
            .min();
        let mut target = end_frames.max(from + 1);
        if let Some(next) = next {
            target = target.min(next);
        }
        let current = state.items[&id].value.span().expect("只收了帧网格上的实例").end_frame();
        let mut delta = target - current;
        if delta > 0 {
            let length = frame_time(delta as i128, fps).ok_or_else(overflow)?;
            delta = crate::cuts::extension(state, &id, length, delta, fps)?.1;
        }
        if delta != 0 {
            let length = frame_time(delta.unsigned_abs() as i128, fps).ok_or_else(overflow)?;
            let signed = if delta < 0 { crate::cuts::negate(length)? } else { length };
            crate::cuts::resize_end(state, &id, signed, delta, fps)?;
        }
    }
    Ok(())
}
