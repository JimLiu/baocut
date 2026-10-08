//! 转场的设置、删除与编辑之后的存续（视频格式规范 §3.9）。
//!
//! 规则只有一套，三处共用：`setTransition` 不成立就拒绝；一笔事务的全部操作执行完之后，不再成立的转场被删掉并在回执里报告；
//! 撤销之后会有不成立的转场时按撤销冲突拒绝。handles 不够时不缩短两侧转场；单侧转场随实例变短（生效长度
//! min(D, ⌊L/2⌋)），不删除，回执里列出。种类与单侧的时长区间取 v2 的 `timeline::video_transitions`。

use std::collections::BTreeMap;

use editor_semantics::{FrameAlignment, GridContext, Rate, TimeMap, TimelineTimeInput, frame_time, frames_at, map_time};
use serde_json::{Map, Value, json};
use timeline::video_transitions::{DURATION_DEFAULT, DURATION_RANGE};

use crate::error::{EngineResult, ErrorBody, Retryability, kinds, msg};
use crate::ids::new_id;
use crate::model::*;
use crate::ops::{EditContext, ensure_editable, item_in, require_sequence};
use crate::receipt::{RemovedTransition, ShortenedTransition, TransitionRemoval};
use crate::state::{Placed, VideoState};

/// 两侧转场最长 10 秒（按序列帧率换算）。
const MAX_TRANSITION_SECONDS: i64 = 10;

pub(crate) struct TransitionInput<'a> {
    pub sequence_id: Option<&'a str>,
    pub left_item_id: Option<&'a str>,
    pub right_item_id: Option<&'a str>,
    pub kind: &'a str,
    pub params: Option<&'a Map<String, Value>>,
    /// 单侧转场可以不给，取 v2 的缺省 0.5 秒；两侧转场必须给。
    pub duration: Option<&'a TimelineTimeInput>,
    pub alignment: Option<FrameAlignment>,
    pub easing: Option<Easing>,
    pub placement: Option<TransitionPlacement>,
    pub audio_crossfade: Option<bool>,
}

/// 设置一个转场。一条边（实例的开头或结尾）上只有一个转场：同一对实例上已有的就地替换（保留 ID），
/// 占着同一条边的其他转场被删掉。
pub(crate) fn set_transition(state: &mut VideoState, input: TransitionInput<'_>, ctx: &mut EditContext<'_>) -> EngineResult<()> {
    let (sequence_id, fps, seq_revision) = require_sequence(state, input.sequence_id)?;
    let sequence_id = sequence_id.to_string();
    if input.left_item_id.is_none() && input.right_item_id.is_none() {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.transitionNoSide",
            "A transition needs leftItemId or rightItemId"
        )));
    }
    if input.left_item_id.is_some() && input.left_item_id == input.right_item_id {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.transitionSameItem",
            "Both sides of a transition cannot be the same clip"
        )));
    }
    for id in input.left_item_id.iter().chain(&input.right_item_id) {
        let placed = item_in(state, &sequence_id, id)?;
        if !transitionable(&placed.value) {
            return Err(ErrorBody::invalid_operation(msg!(
                "engine.transitionNotPicture",
                "Clip {item} is not a picture clip, so it cannot have a transition",
                item = id
            )).entities([*id]));
        }
        ensure_editable(state, &placed.value)?;
    }
    let empty = Map::new();
    let kind = match TransitionKind::parse(input.kind, input.params.unwrap_or(&empty)) {
        Some(Ok(kind)) => kind,
        Some(Err(message)) => return Err(ErrorBody::invalid_operation(message)),
        None => {
            return Err(ErrorBody::invalid_operation(msg!(
                "engine.transitionUnknown",
                "Unknown transition {kind}: available are {available}",
                kind = input.kind,
                available = [SINGLE_SIDED_KINDS, TWO_SIDED_ONLY_KINDS].concat().join(", ")
            ))
            .details(json!({ "kind": input.kind })));
        }
    };
    let two_sided = input.left_item_id.is_some() && input.right_item_id.is_some();
    if !two_sided && kind.two_sided_only() {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.transitionTwoSidedOnly",
            "{kind} is only for two-sided transitions",
            kind = kind.name()
        )).details(json!({ "kind": kind.name() })));
    }
    let placement = input.placement.unwrap_or_default();
    if !two_sided && placement != TransitionPlacement::Center {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.transitionSingleSidedPlacement",
            "A single-sided transition is always inside the clip, so it has no placement"
        )));
    }
    let audio_crossfade = input.audio_crossfade.unwrap_or(false);
    if !two_sided && audio_crossfade {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.transitionSingleSidedCrossfade",
            "A single-sided transition has no sound on the other side to crossfade; use setAudioMix for sound fades"
        )));
    }

    let grid = GridContext {
        sequence_id: &sequence_id,
        sequence_revision: &seq_revision,
        fps,
    };
    let duration_frames = match (input.duration, input.alignment) {
        (Some(duration), Some(alignment)) => {
            let q = editor_semantics::quantize_input(duration, &grid, alignment, "duration")?;
            if q.frame <= 0 {
                return Err(ErrorBody::new(
                    "TIME_RANGE_COLLAPSED",
                    msg!("engine.transitionOneFrame", "A transition must be at least one frame"),
                    Retryability::AfterUserAction,
                )
                .recovery(msg!("engine.transitionOneFrameRecovery", "Make the transition longer")));
            }
            let (min, max) = if two_sided {
                (1, nearest_frames(MAX_TRANSITION_SECONDS as f64, fps))
            } else {
                let (lo, hi) = DURATION_RANGE;
                (nearest_frames(lo, fps).max(1), nearest_frames(hi, fps).max(1))
            };
            if q.frame < min || q.frame > max {
                let message = if two_sided {
                    msg!(
                        "engine.transitionDurationTwoSided",
                        "The transition length is out of range: a two-sided transition is 1 frame to {max} seconds",
                        max = MAX_TRANSITION_SECONDS
                    )
                } else {
                    msg!(
                        "engine.transitionDurationSingleSided",
                        "The transition length is out of range: a single-sided transition is {lo}–{hi} seconds",
                        lo = DURATION_RANGE.0,
                        hi = DURATION_RANGE.1
                    )
                };
                return Err(ErrorBody::invalid_operation(message)
                    .details(json!({ "durationFrames": q.frame, "minFrames": min, "maxFrames": max })));
            }
            ctx.time_resolution.push(q.receipt);
            q.frame
        }
        (Some(_), None) => return Err(ErrorBody::invalid_operation(msg!("engine.durationNeedsAlignment", "duration needs an alignment"))),
        (None, _) if two_sided => return Err(ErrorBody::invalid_operation(msg!(
            "engine.transitionNeedsDuration",
            "A two-sided transition needs a duration"
        ))),
        (None, _) => nearest_frames(DURATION_DEFAULT, fps).max(1),
    };

    let left = input.left_item_id.map(str::to_string);
    let right = input.right_item_id.map(str::to_string);
    // 同一对实例上已有的转场保留 ID；占着同一条边的其他转场删掉。
    let mut keep_id = None;
    let mut replaced = Vec::new();
    for (id, placed) in &state.transitions {
        let t = &placed.value;
        if t.left_item_id == left && t.right_item_id == right {
            keep_id = Some(id.clone());
        } else if (left.is_some() && t.left_item_id == left) || (right.is_some() && t.right_item_id == right) {
            replaced.push(id.clone());
        }
    }
    for id in replaced {
        state.transitions.remove(&id);
    }
    let transition = Transition {
        id: keep_id.unwrap_or_else(|| new_id("tr")),
        left_item_id: left,
        right_item_id: right,
        kind,
        duration_frames,
        easing: input.easing.unwrap_or_default(),
        placement,
        audio_crossfade,
    };
    if let Err((_, err)) = check_transition(state, &sequence_id, &transition, fps) {
        return Err(err);
    }
    if let Some(other) = overlapping(state, &transition)? {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.transitionOverlap",
            "Overlaps another transition on the same clip"
        ))
            .entities([transition.id.clone(), other.clone()])
            .details(json!({ "conflictsWith": other })));
    }
    state.transitions.insert(
        transition.id.clone(),
        Placed {
            sequence_id,
            value: transition,
        },
    );
    Ok(())
}

pub(crate) fn remove_transition(state: &mut VideoState, sequence_id: Option<&str>, transition_id: &str) -> EngineResult<()> {
    let placed = state
        .transitions
        .get(transition_id)
        .ok_or_else(|| ErrorBody::not_found(kinds::transition(), transition_id))?;
    if let Some(seq) = sequence_id
        && placed.sequence_id != seq
    {
        return Err(ErrorBody::time_domain_mismatch(msg!(
            "engine.transitionNotInSequence",
            "Transition {transition} does not belong to sequence {sequence}",
            transition = transition_id,
            sequence = seq
        )).entities([transition_id]));
    }
    for id in placed.value.item_ids() {
        if let Some(item) = state.items.get(id) {
            ensure_editable(state, &item.value)?;
        }
    }
    state.transitions.remove(transition_id);
    Ok(())
}

/// 拆分之后，原实例的出场转场跟着右半段（它现在拥有原来的结尾）；入场转场留在左半段。
pub(crate) fn follow_split(state: &mut VideoState, item_id: &str, right_id: &str) {
    for placed in state.transitions.values_mut() {
        if placed.value.left_item_id.as_deref() == Some(item_id) {
            placed.value.left_item_id = Some(right_id.to_string());
        }
    }
}

/// 合并之后：靠后那件的出场（及它在左侧的两侧转场）归留下的那件。两件之间的转场与靠后那件的入场随它删掉，
/// 由 [`reconcile_transitions`] 报告。
pub(crate) fn follow_join(state: &mut VideoState, early_id: &str, late_id: &str) {
    for placed in state.transitions.values_mut() {
        if placed.value.left_item_id.as_deref() == Some(late_id) {
            placed.value.left_item_id = Some(early_id.to_string());
        }
    }
}

/// 一笔事务里转场的变化：删掉的与变短的。
#[derive(Debug, Default)]
pub struct TransitionChanges {
    pub removed: Vec<RemovedTransition>,
    pub shortened: Vec<ShortenedTransition>,
}

/// 一笔事务的操作全部执行之后：删掉不再成立的转场，返回删了哪些、为什么；再列出这笔事务里变短的单侧转场
/// （生效长度小于写入长度，且与事务之前不同）。
pub fn reconcile_transitions(before: &VideoState, state: &mut VideoState) -> EngineResult<TransitionChanges> {
    let removed = invalid_transitions(state)?;
    for r in &removed {
        state.transitions.remove(&r.id);
    }
    let effective = |s: &VideoState, t: &Transition| {
        let span = |id: &Option<Id>| id.as_ref().and_then(|id| s.items.get(id)).and_then(|p| p.value.span());
        t.effective_frames(span(&t.left_item_id), span(&t.right_item_id))
    };
    let mut shortened = Vec::new();
    for (id, placed) in &state.transitions {
        let t = &placed.value;
        if !t.is_single_sided() {
            continue;
        }
        let now = effective(state, t);
        if now >= t.duration_frames {
            continue;
        }
        let was = before
            .transitions
            .get(id)
            .map(|p| (p.value.duration_frames, effective(before, &p.value)));
        if was != Some((t.duration_frames, now)) {
            shortened.push(ShortenedTransition {
                id: id.clone(),
                duration_frames: t.duration_frames,
                effective_frames: now,
            });
        }
    }
    Ok(TransitionChanges { removed, shortened })
}

/// 秒数取最近的帧。
fn nearest_frames(seconds: f64, fps: Rate) -> i64 {
    (seconds * fps.ratio().to_f64()).round() as i64
}

/// 不成立的转场，按 ID 排序。先逐个检查；剩下的按窗口开始帧（相同时按 ID）依次保留，
/// 与已保留的、共用一个实例的转场窗口重叠的删掉——开始得早的留下。
pub fn invalid_transitions(state: &VideoState) -> EngineResult<Vec<RemovedTransition>> {
    let mut removed: BTreeMap<Id, TransitionRemoval> = BTreeMap::new();
    let mut candidates = Vec::new();
    for (id, placed) in &state.transitions {
        let fps = state.sequence(&placed.sequence_id)?.header.fps;
        match check_transition(state, &placed.sequence_id, &placed.value, fps) {
            Err((reason, _)) => {
                removed.insert(id.clone(), reason);
            }
            Ok(()) => {
                if let Some((start, end)) = window_of(state, &placed.value) {
                    candidates.push((start, id, end, &placed.value));
                }
            }
        }
    }
    candidates.sort_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)));
    let mut kept: Vec<(i64, i64, &Transition)> = Vec::new();
    for (start, id, end, t) in candidates {
        let clash = kept
            .iter()
            .any(|(s, e, k)| *s < end && start < *e && k.item_ids().any(|i| t.item_ids().any(|j| i == j)));
        if clash {
            removed.insert(id.clone(), TransitionRemoval::Overlap);
        } else {
            kept.push((start, end, t));
        }
    }
    Ok(removed.into_iter().map(|(id, reason)| RemovedTransition { id, reason }).collect())
}

fn transitionable(item: &TimelineItem) -> bool {
    !matches!(item, TimelineItem::Audio(_) | TimelineItem::Caption(_))
}

fn window_of(state: &VideoState, t: &Transition) -> Option<(i64, i64)> {
    let span = |id: &Option<Id>| id.as_ref().and_then(|id| state.items.get(id)).and_then(|p| p.value.span());
    t.window(span(&t.left_item_id), span(&t.right_item_id))
}

/// 同一实例上与 `t` 的窗口重叠的另一个转场。
fn overlapping<'s>(state: &'s VideoState, t: &Transition) -> EngineResult<Option<&'s Id>> {
    let Some((start, end)) = window_of(state, t) else {
        return Ok(None);
    };
    for (id, placed) in &state.transitions {
        if *id == t.id || !placed.value.item_ids().any(|i| t.item_ids().any(|j| i == j)) {
            continue;
        }
        if let Some((s, e)) = window_of(state, &placed.value)
            && s < end
            && start < e
        {
            return Ok(Some(id));
        }
    }
    Ok(None)
}

/// 一个转场是否成立：实例都在、都是画面片段；两侧在同一轨道上首尾相接；窗口在两侧实例的合并区间之内
/// （单边在实例之内）；两侧的 handles 够用。不成立时给出原因与对应的错误。
fn check_transition(state: &VideoState, sequence_id: &str, t: &Transition, fps: Rate) -> Result<(), (TransitionRemoval, ErrorBody)> {
    let fail = |reason, err: ErrorBody| Err((reason, err.entities([t.id.clone()])));
    let mut items = Vec::new();
    for id in t.item_ids() {
        match state.items.get(id) {
            Some(p) if p.sequence_id == sequence_id && transitionable(&p.value) => items.push(&p.value),
            _ => return fail(TransitionRemoval::ItemDeleted, ErrorBody::not_found(kinds::item(), id)),
        }
    }
    let left = t.left_item_id.as_ref().and_then(|id| state.items.get(id)).map(|p| &p.value);
    let right = t.right_item_id.as_ref().and_then(|id| state.items.get(id)).map(|p| &p.value);
    let left_span = left.and_then(TimelineItem::span);
    let right_span = right.and_then(TimelineItem::span);
    if let (Some(l), Some(r), Some(ls), Some(rs)) = (left, right, left_span, right_span)
        && (l.base().track_id != r.base().track_id || ls.end_frame() != rs.from_frame)
    {
        return fail(
            TransitionRemoval::NotAdjacent,
            ErrorBody::invalid_operation(msg!(
                "engine.transitionNotAdjacent",
                "The clips on both sides must touch end to start on the same track"
            )).entities([l.base().id.clone(), r.base().id.clone()]),
        );
    }
    let Some((start, end)) = t.window(left_span, right_span) else {
        return fail(TransitionRemoval::ItemDeleted, ErrorBody::invalid_operation(msg!(
                "engine.transitionNoItems",
                "Neither side of the transition has a clip"
            )));
    };
    let lo = left_span.or(right_span).map_or(0, |s| s.from_frame);
    let hi = right_span.or(left_span).map_or(0, |s| s.end_frame());
    if start < lo || end > hi {
        return fail(
            TransitionRemoval::TooLong,
            ErrorBody::invalid_operation(msg!("engine.transitionTooLong", "The transition is longer than the clip"))
                .details(json!({ "windowFrames": [start, end], "itemFrames": [lo, hi], "durationFrames": t.duration_frames })),
        );
    }
    // 两侧转场：左侧要在自己的结尾之后再画到窗口结束，右侧要在自己的开头之前从窗口开始画。
    if let (Some(l), Some(ls), Some(r), Some(rs)) = (left, left_span, right, right_span) {
        let tail_needed = (end - ls.end_frame()).max(0);
        let head_needed = (rs.from_frame - start).max(0);
        for (item, needed, edge) in [(l, tail_needed, "tail"), (r, head_needed, "head")] {
            if needed == 0 {
                continue;
            }
            let available = handle_frames(state, item, fps, edge == "head").map_err(|e| (TransitionRemoval::HandlesInsufficient, e))?;
            if let Some(available) = available
                && available < needed
            {
                let id = item.base().id.clone();
                return fail(
                    TransitionRemoval::HandlesInsufficient,
                    ErrorBody::new(
                        "TRANSITION_HANDLES_INSUFFICIENT",
                        if edge == "head" {
                            msg!(
                                "engine.handlesBeforeStart",
                                "The asset of clip {item} does not have enough before its start for the transition",
                                item = id
                            )
                        } else {
                            msg!(
                                "engine.handlesAfterEnd",
                                "The asset of clip {item} does not have enough after its end for the transition",
                                item = id
                            )
                        },
                        Retryability::AfterUserAction,
                    )
                    .entities([id.clone()])
                    .details(json!({ "itemId": id, "edge": edge, "neededFrames": needed, "availableFrames": available }))
                    .recovery(msg!(
                        "engine.handlesRecovery",
                        "Shorten the transition, change its placement, or trim the clip first to leave room; transitions are not shortened automatically"
                    )),
                );
            }
        }
    }
    Ok(())
}

/// 实例在开头之前（`head`）或结尾之后能多画多少帧。`None` 表示不受限：图片、文字、图形、定格，
/// 不知道长度的素材，以及没有预渲染替身的合成的结尾。
fn handle_frames(state: &VideoState, item: &TimelineItem, fps: Rate, head: bool) -> EngineResult<Option<i64>> {
    let (map, source) = match item {
        TimelineItem::Video(v) => (&v.time_map, Some(&v.asset_ref)),
        TimelineItem::Composition(c) => (&c.time_map, c.prerender.as_ref()),
        _ => return Ok(None),
    };
    let TimeMap::Linear { rate, .. } = map else {
        return Ok(None);
    };
    let span = item.span().expect("画面片段都在帧网格上");
    let overflow = || ErrorBody::time(editor_semantics::TimeError::Overflow { field: "handles".into() });
    let start = frame_time(span.from_frame as i128, fps).ok_or_else(overflow)?;
    let end = frame_time(span.end_frame() as i128, fps).ok_or_else(overflow)?;
    // 源上还剩的时长，换回序列时间（除以速度），再换成整帧（向下取整）。
    let spare = if head {
        map_time(map, start, start)?
    } else {
        let duration = match source {
            Some(r) => match state
                .assets
                .get(&r.id)
                .and_then(|a| a.revisions.get(&r.revision))
                .and_then(|v| v.duration.as_ref())
            {
                Some(d) => d.to_ratio("duration")?,
                None => return Ok(None),
            },
            None => return Ok(None),
        };
        duration.checked_sub(map_time(map, start, end)?).ok_or_else(overflow)?
    };
    let sequence_time = spare.checked_div(rate.ratio()).ok_or_else(overflow)?;
    let frames = frames_at(sequence_time, fps).ok_or_else(overflow)?.floor();
    Ok(Some(frames.max(0) as i64))
}
