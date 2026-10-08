//! `item-local` 的跟随（视频格式规范 §3.16）：实例保持它相对目标实例的位置。每笔编辑事务的最后，按事务之前与之后的
//! 时间线、拆分的 lineage 补算：
//!
//! - 锚点时刻是跟随者的起点。目标带线性的源时钟时，锚点换成目标上的源时刻，在事务之后的目标（含拆出来的几段）上找回：
//!   落在哪一段里就跟着那一段，跟随策略改指那一段；源时刻被修剪掉或剪掉时，移到它之后最近的那一段的起点（目标的新起点）；
//!   在所有段之后时按最后一段外推。跟随者在目标起点之前时，保持到目标新起点的距离。
//! - 没有源时钟的目标：整体移动时跟着移动；只改起点时跟随者不动，起点越过锚点时移到目标的新起点；拆开时跟着锚点所在的那一段。
//! - 目标被删掉（拆出来的也一段不剩）时跟随者一起删掉，列在回执的 `impact.removedWithTarget`；跟着它的再一起删。
//! - 跟随者自己在这笔事务里被移动、修剪过，或者跟随策略是这笔事务写下的，不再补算。只移动，不改长度；锁着时整笔拒绝。

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use editor_semantics::{FrameAlignment, Rate, Ratio, TimeMap, TimelineTimeInput, quantize_frame};

use crate::error::{EngineResult, ErrorBody, kinds, msg};
use crate::model::*;
use crate::ops::{EditContext, ItemMove, delete_items, move_item, overflow};
use crate::state::{VideoState, item_range};

/// 跟随的目标。
fn target_of(item: &TimelineItem) -> Option<&Id> {
    match &item.base().follow_policy {
        FollowPolicy::ItemLocal { item_id } => Some(item_id),
        _ => None,
    }
}

fn fps_of(state: &VideoState, sequence_id: &str) -> EngineResult<Rate> {
    state
        .sequences
        .get(sequence_id)
        .map(|s| s.header.fps)
        .ok_or_else(|| ErrorBody::not_found(kinds::sequence(), sequence_id))
}

/// 线性源时钟：`(sourceIn, rate)`。
fn linear(item: &TimelineItem) -> EngineResult<Option<(Ratio, Ratio)>> {
    let map = match item {
        TimelineItem::Video(v) => &v.time_map,
        TimelineItem::Audio(a) => &a.time_map,
        TimelineItem::Composition(c) => &c.time_map,
        _ => return Ok(None),
    };
    Ok(match map {
        TimeMap::Linear { source_in, rate } => Some((source_in.to_ratio("sourceIn")?, rate.ratio())),
        _ => None,
    })
}

/// 事务之后代表目标的实例：目标本身与 lineage 里由它拆出来的（逐层），只取还在的。
fn pieces(next: &VideoState, roots: &[&Id], lineage: &BTreeMap<Id, Vec<Id>>, sequence_id: &str) -> Vec<Id> {
    let mut seen: BTreeSet<Id> = BTreeSet::new();
    let mut queue: VecDeque<Id> = roots.iter().map(|id| (*id).clone()).collect();
    while let Some(id) = queue.pop_front() {
        if !seen.insert(id.clone()) {
            continue;
        }
        for child in lineage.get(&id).into_iter().flatten() {
            queue.push_back(child.clone());
        }
    }
    seen.into_iter()
        .filter(|id| next.items.get(id).is_some_and(|p| p.sequence_id == sequence_id))
        .collect()
}

/// 补算 `next` 里 `item-local` 跟随者的位置；返回随目标删掉的实例。
pub(crate) fn settle(before: &VideoState, next: &mut VideoState, ctx: &mut EditContext<'_>) -> EngineResult<Vec<Id>> {
    // 这笔事务写下的跟随策略：目标必须在同一个序列上。
    for placed in next.items.values() {
        let Some(target) = target_of(&placed.value) else { continue };
        let id = &placed.value.base().id;
        let written = before.items.get(id).map(|p| &p.value.base().follow_policy) != Some(&placed.value.base().follow_policy);
        if written && !next.items.get(target).is_some_and(|t| t.sequence_id == placed.sequence_id) {
            return Err(
                ErrorBody::invalid_operation(msg!(
                    "engine.itemLocalOtherSequence",
                    "The target {target} followed by clip {item} is not on the same sequence",
                    target,
                    item = id
                ))
                    .entities([id.clone(), target.clone()])
                    .details(serde_json::json!({ "rule": "item-local-target" })),
            );
        }
    }

    let mut pending: Vec<Id> = next
        .items
        .values()
        .filter(|p| {
            let base = p.value.base();
            let Some(old) = before.items.get(&base.id) else { return false };
            matches!(old.value.base().follow_policy, FollowPolicy::ItemLocal { .. })
                && matches!(base.follow_policy, FollowPolicy::ItemLocal { .. })
                && old.sequence_id == p.sequence_id
                && old.value.base().track_id == base.track_id
                && same_range(before, &old.value, next, &p.value, &p.sequence_id)
        })
        .map(|p| p.value.base().id.clone())
        .collect();

    let mut removed: Vec<Id> = Vec::new();
    // 先补算目标不是待补算跟随者的那些（跟随者的跟随者在它之后）；成环的不动。
    loop {
        let ready: Vec<Id> = pending
            .iter()
            .filter(|id| {
                let before_target = before.items.get(*id).and_then(|p| target_of(&p.value));
                let after_target = next.items.get(*id).and_then(|p| target_of(&p.value));
                ![before_target, after_target].into_iter().flatten().any(|t| pending.contains(t))
            })
            .cloned()
            .collect();
        if ready.is_empty() {
            break;
        }
        pending.retain(|id| !ready.contains(id));
        for id in ready {
            if follow(before, next, &id, ctx)? {
                removed.push(id);
            }
        }
    }
    Ok(removed)
}

/// 跟随者在事务前后的区间与轨道都没变。
fn same_range(before: &VideoState, old: &TimelineItem, next: &VideoState, new: &TimelineItem, sequence_id: &str) -> bool {
    let (Ok(a), Ok(b)) = (fps_of(before, sequence_id), fps_of(next, sequence_id)) else {
        return false;
    };
    matches!((item_range(old, a), item_range(new, b)), (Ok(x), Ok(y)) if x == y)
}

/// 补算一个跟随者；目标没了、跟随者被删掉时返回 true。
fn follow(before: &VideoState, next: &mut VideoState, id: &str, ctx: &mut EditContext<'_>) -> EngineResult<bool> {
    let Some(placed) = next.items.get(id) else { return Ok(false) };
    let sequence_id = placed.sequence_id.clone();
    let fps = fps_of(next, &sequence_id)?;
    let after_target = target_of(&placed.value).cloned().expect("只补算 item-local");
    let follower_before = &before.items[id].value;
    let before_target = target_of(follower_before).cloned().expect("只补算 item-local");
    let Some(target_was) = before.items.get(&before_target).filter(|p| p.sequence_id == sequence_id) else {
        return Ok(false);
    };
    let (anchor, _) = item_range(follower_before, fps_of(before, &sequence_id)?)?;
    let (s0, e0) = item_range(&target_was.value, fps_of(before, &sequence_id)?)?;

    let found = pieces(next, &[&before_target, &after_target], &ctx.lineage, &sequence_id);
    if found.is_empty() {
        delete_items(next, Some(&sequence_id), &[id.to_string()])?;
        return Ok(true);
    }
    if found == [before_target.clone()] && after_target == before_target && next.items[&before_target].value == target_was.value {
        return Ok(false);
    }
    let ranges: Vec<(Id, Ratio, Ratio)> = found
        .iter()
        .map(|p| item_range(&next.items[p].value, fps).map(|(s, e)| (p.clone(), s, e)))
        .collect::<EngineResult<_>>()?;
    let earliest = ranges.iter().min_by(|a, b| a.1.cmp(&b.1)).expect("至少一段").clone();

    let (piece, start) = if anchor < s0 {
        // 跟随者在目标起点之前：保持到目标新起点的距离。
        let offset = anchor.checked_sub(s0).ok_or_else(overflow)?;
        (earliest.0.clone(), earliest.1.checked_add(offset).ok_or_else(overflow)?)
    } else if let Some((source_in, rate)) = linear(&target_was.value)? {
        let source = source_in
            .checked_add(
                anchor
                    .checked_sub(s0)
                    .ok_or_else(overflow)?
                    .checked_mul(rate)
                    .ok_or_else(overflow)?,
            )
            .ok_or_else(overflow)?;
        by_source(next, &ranges, source)?.unwrap_or_else(|| (earliest.0.clone(), earliest.1))
    } else if ranges.len() > 1 {
        // 没有源时钟的目标拆开了：跟着锚点所在的那一段。
        let holder = ranges
            .iter()
            .find(|(_, s, e)| *s <= anchor && anchor < *e)
            .or_else(|| ranges.iter().filter(|(_, s, _)| *s <= anchor).max_by(|a, b| a.1.cmp(&b.1)))
            .unwrap_or(&earliest);
        (holder.0.clone(), anchor)
    } else {
        let (_, s1, e1) = &ranges[0];
        let moved = s1.checked_sub(s0).ok_or_else(overflow)?;
        if Some(moved) == e1.checked_sub(e0) {
            (ranges[0].0.clone(), anchor.checked_add(moved).ok_or_else(overflow)?)
        } else {
            // 只改了起点：越过锚点时移到新起点。
            (ranges[0].0.clone(), anchor.max(*s1))
        }
    };

    if piece != after_target
        && let Some(item) = next.items.get_mut(id)
    {
        item.value.base_mut().follow_policy = FollowPolicy::ItemLocal { item_id: piece };
    }
    if start != anchor {
        let frame = quantize_frame(start.max(Ratio::ZERO), fps, FrameAlignment::NearestFrame, "start").map_err(ErrorBody::time)?;
        let mv = ItemMove {
            item_id: id.to_string(),
            at: Some(TimelineTimeInput::Frames { value: frame }),
            offset: None,
            track_id: None,
        };
        move_item(next, Some(&sequence_id), &mv, FrameAlignment::NearestFrame, ctx)?;
    }
    Ok(false)
}

/// 源时刻 `source` 在事务之后的几段上的位置：落在哪段里取哪段；落在段与段之间或所有段之前时取之后最近一段的起点；
/// 在所有段之后时按最后一段外推。
fn by_source(next: &VideoState, ranges: &[(Id, Ratio, Ratio)], source: Ratio) -> EngineResult<Option<(Id, Ratio)>> {
    let mut later: Option<(Ratio, &(Id, Ratio, Ratio))> = None;
    let mut earlier: Option<(Ratio, Ratio, &(Id, Ratio, Ratio))> = None;
    for range in ranges {
        let Some((source_in, rate)) = linear(&next.items[&range.0].value)? else {
            continue;
        };
        let length = range.2.checked_sub(range.1).ok_or_else(overflow)?;
        let source_out = source_in
            .checked_add(length.checked_mul(rate).ok_or_else(overflow)?)
            .ok_or_else(overflow)?;
        let at = |s: Ratio| -> EngineResult<Ratio> {
            range
                .1
                .checked_add(
                    s.checked_sub(source_in)
                        .ok_or_else(overflow)?
                        .checked_div(rate)
                        .ok_or_else(overflow)?,
                )
                .ok_or_else(overflow)
        };
        if source_in <= source && source < source_out {
            return Ok(Some((range.0.clone(), at(source)?)));
        }
        if source_in > source && later.is_none_or(|(s, _)| source_in < s) {
            later = Some((source_in, range));
        }
        if source_in <= source && earlier.is_none_or(|(s, _, _)| source_in > s) {
            earlier = Some((source_in, at(source)?, range));
        }
    }
    Ok(match (later, earlier) {
        (Some((_, range)), _) => Some((range.0.clone(), range.1)),
        (None, Some((_, time, range))) => Some((range.0.clone(), time)),
        (None, None) => None,
    })
}
