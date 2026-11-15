//! 录制在时间线上的两样东西（视频格式规范 §3.18）：登记在序列上的联动组，与视频实例对屏幕取景文档的引用。
//! 这里管登记、成员与引用的约束，以及登记过的组成组的时间编辑（§3.18 的表）：移动、拆分、修剪、变速、同步校正与复制。
//! 删除一段并闭合与剪口在 `ops::remove_range_frames`、`ops::insert_range_frames` 与 `cuts` 里按组展开，用这里的
//! [`touched_groups`]、[`partition`]。取景的求值与渲染还没有实现（§10）。

use std::collections::{BTreeMap, BTreeSet, HashMap};

use editor_semantics::{FrameAlignment, GridContext, MediaTime, Rate, Ratio, TimeMap, TimelineTimeInput, frame_time, frames_at, quantize_exact, quantize_frame};
use message_ref::{Text, msg};
use serde_json::{Value, json};
use video_model::recording::RECORDING_KIND;
use video_model::screen_view::SCREEN_VIEW_KIND;

use crate::error::{EngineResult, ErrorBody, kinds};
use crate::ids::new_id;
use crate::model::*;
use crate::ops::{
    AssetTarget, DocumentTarget, Edge, EditContext, ItemMove, PutDocumentInput, check_time_map, ensure_track_editable, item_in, move_item,
    not_applicable, overflow, put_document, require_sequence, shift_later, split_item, trim_item,
};
use crate::state::{Placed, VideoState, item_range};

fn registered<'s>(state: &'s VideoState, sequence_id: &str, group_id: &str) -> Option<&'s LinkGroup> {
    state.sequences.get(sequence_id)?.header.link_groups.iter().find(|g| g.id == group_id)
}

/// 实例上与录制有关的约束：登记过的组只收视频与音频实例；屏幕取景的引用成立。
pub(crate) fn check_item_links(state: &VideoState, sequence_id: &str, item: &TimelineItem) -> Result<(), Text> {
    if let Some(group) = item.base().link_group_id.as_deref()
        && registered(state, sequence_id, group).is_some()
        && !matches!(item, TimelineItem::Video(_) | TimelineItem::Audio(_))
    {
        return Err(msg!("engine.linkGroupMember", "Link group {group} only takes video and audio clips", group));
    }
    match item {
        TimelineItem::Video(video) => check_screen_view(state, video),
        _ => Ok(()),
    }
}

/// 屏幕取景的引用（§3.18）：文档在、种类对，不与分屏并存，而且文档是给这段画面写的——录制时间的文档，实例的素材版本
/// 是它的清单引用的一个；素材源时钟的文档，来源素材就是实例的素材。
fn check_screen_view(state: &VideoState, video: &VideoItem) -> Result<(), Text> {
    let Some(view) = &video.screen_view else {
        return Ok(());
    };
    let document = view.document_id.as_str();
    let Some(record) = state.documents.get(document).filter(|d| d.kind == SCREEN_VIEW_KIND) else {
        return Err(msg!("engine.screenViewDocument", "Document {document} is not a screen view", document));
    };
    if video.panels.is_some() {
        return Err(msg!("engine.screenViewWithPanels", "A video split into panels cannot have a screen view"));
    }
    let manifest = record
        .source_document_id
        .as_ref()
        .and_then(|id| state.documents.get(id))
        .filter(|d| d.kind == RECORDING_KIND);
    let fits = match manifest {
        Some(manifest) => manifest
            .revisions
            .get(&manifest.current_revision)
            .is_some_and(|r| r.asset_refs.contains(&video.asset_ref)),
        None => record.source_asset_id.as_deref() == Some(video.asset_ref.id.as_str()),
    };
    if !fits {
        return Err(msg!(
            "engine.screenViewSource",
            "Screen view {document} was not written for the footage of this clip",
            document
        ));
    }
    Ok(())
}

/// `setStyle` 的 `screenView`：`null` 去掉。只有视频实例能有。
pub(crate) fn apply_screen_view(item: &mut TimelineItem, item_id: &str, view: Option<ScreenViewRef>) -> EngineResult<()> {
    let TimelineItem::Video(video) = item else {
        return Err(not_applicable(
            item_id,
            msg!("engine.screenViewNotVideo", "is not a video, so it cannot have a screen view"),
        ));
    };
    video.screen_view = view;
    Ok(())
}

/// 把同一条序列上的视频与音频实例登记成一个联动组，返回组的 ID。
pub(crate) fn link_items(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    item_ids: &[Id],
    kind: &str,
    recording: Option<&DocumentTarget>,
    ctx: &EditContext<'_>,
) -> EngineResult<Id> {
    let sequence_id = sequence_id.unwrap_or(&state.root_sequence_id).to_string();
    state.sequence(&sequence_id)?;
    if kind != LINK_GROUP_RECORDING {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.linkGroupKind",
            "The link group kind must be {kind}",
            kind = LINK_GROUP_RECORDING
        )));
    }
    let unique: BTreeSet<&Id> = item_ids.iter().collect();
    if item_ids.is_empty() || unique.len() != item_ids.len() {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.linkItemsEmpty",
            "linkItems needs at least one clip, each named once"
        )));
    }
    let recording_id = match recording {
        Some(DocumentTarget::Id { document_id }) => Some(document_id.clone()),
        Some(DocumentTarget::Ref { reference }) => Some(ctx.document_refs.get(reference).cloned().ok_or_else(|| {
            ErrorBody::invalid_operation(msg!("engine.documentRefMissing", "There is no document named {reference}", reference))
        })?),
        None => None,
    };
    if let Some(id) = &recording_id
        && !state.documents.get(id).is_some_and(|d| d.kind == RECORDING_KIND)
    {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.linkRecordingKind",
            "Document {document} is not a recording manifest",
            document = id
        ))
        .entities([id]));
    }
    let group_id = new_id("lg");
    for item_id in item_ids {
        let placed = state.items.get(item_id).ok_or_else(|| ErrorBody::not_found(kinds::item(), item_id))?;
        if placed.sequence_id != sequence_id {
            return Err(ErrorBody::time_domain_mismatch(msg!(
                "engine.itemNotInSequence",
                "Clip {item} does not belong to sequence {sequence}",
                item = item_id,
                sequence = sequence_id
            ))
            .entities([item_id]));
        }
        crate::ops::ensure_editable(state, &placed.value)?;
        if !matches!(placed.value, TimelineItem::Video(_) | TimelineItem::Audio(_)) {
            return Err(ErrorBody::invalid_operation(msg!(
                "engine.linkGroupMember",
                "Link group {group} only takes video and audio clips",
                group = group_id
            ))
            .entities([item_id]));
        }
        // 一个实例至多属于一个组；已有的音画联动组（§3.7）也不顶掉。
        if placed.value.base().link_group_id.is_some() {
            return Err(ErrorBody::invalid_operation(msg!(
                "engine.linkItemsTaken",
                "Clip {item} already belongs to a link group",
                item = item_id
            ))
            .entities([item_id]));
        }
    }
    for item_id in item_ids {
        state.items.get_mut(item_id).expect("刚检查过").value.base_mut().link_group_id = Some(group_id.clone());
    }
    let groups = &mut state.sequences.get_mut(&sequence_id).expect("刚检查过").header.link_groups;
    groups.push(LinkGroup {
        id: group_id.clone(),
        kind: kind.to_string(),
        sync_version: LINK_GROUP_SYNC_VERSION,
        recording_id,
    });
    groups.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(group_id)
}

/// 解组：删掉登记，清掉成员的 `linkGroupId`。
pub(crate) fn unlink_items(state: &mut VideoState, sequence_id: Option<&str>, group_id: &str) -> EngineResult<()> {
    let sequence_id = sequence_id.unwrap_or(&state.root_sequence_id).to_string();
    state.sequence(&sequence_id)?;
    if registered(state, &sequence_id, group_id).is_none() {
        return Err(ErrorBody::invalid_operation(msg!("engine.linkGroupMissing", "There is no link group {group}", group = group_id)));
    }
    state
        .sequences
        .get_mut(&sequence_id)
        .expect("刚检查过")
        .header
        .link_groups
        .retain(|g| g.id != group_id);
    for placed in state.items.values_mut() {
        if placed.sequence_id == sequence_id && placed.value.base().link_group_id.as_deref() == Some(group_id) {
            placed.value.base_mut().link_group_id = None;
        }
    }
    Ok(())
}

/// 事务结束时没有成员的组，登记一并删掉。
pub(crate) fn prune_link_groups(state: &mut VideoState) {
    let live: BTreeSet<(String, String)> = state
        .items
        .values()
        .filter_map(|p| Some((p.sequence_id.clone(), p.value.base().link_group_id.clone()?)))
        .collect();
    for (sequence_id, sequence) in state.sequences.iter_mut() {
        let groups = &mut sequence.header.link_groups;
        if groups.iter().any(|g| !live.contains(&(sequence_id.clone(), g.id.clone()))) {
            groups.retain(|g| live.contains(&(sequence_id.clone(), g.id.clone())));
        }
    }
}

/// 读进来的快照（保存的版本、便携包）同样要成立：登记认得、不重复，成员与取景的引用成立。
pub(crate) fn validate(state: &VideoState) -> Result<(), Text> {
    for sequence in state.sequences.values() {
        let groups = &sequence.header.link_groups;
        let ids: BTreeSet<&str> = groups.iter().map(|g| g.id.as_str()).collect();
        let known = groups.iter().all(|g| g.kind == LINK_GROUP_RECORDING && g.sync_version == LINK_GROUP_SYNC_VERSION);
        if ids.len() != groups.len() || !known {
            return Err(msg!(
                "engine.linkGroupKind",
                "The link group kind must be {kind}",
                kind = LINK_GROUP_RECORDING
            ));
        }
        if let Some(missing) = groups
            .iter()
            .filter_map(|g| g.recording_id.as_ref())
            .find(|id| !state.documents.get(*id).is_some_and(|d| d.kind == RECORDING_KIND))
        {
            return Err(msg!(
                "engine.linkRecordingKind",
                "Document {document} is not a recording manifest",
                document = missing
            ));
        }
    }
    for placed in state.items.values() {
        check_item_links(state, &placed.sequence_id, &placed.value)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------
// 成组的时间编辑（§3.18）。组里各成员在同一序列时刻对着同一录制时刻；下面每个操作都保持这一点：
// 视频成员在帧网格上，音频成员是精确时间，所以位移、拆分点与修剪点在组里有视频成员时取整帧。

/// 实例所在的、登记过的组。没有登记的 `linkGroupId` 不算（§3.7 的音画联动组照旧）。
pub(crate) fn group_of(state: &VideoState, item_id: &str) -> Option<Id> {
    let placed = state.items.get(item_id)?;
    let group = placed.value.base().link_group_id.as_deref()?;
    registered(state, &placed.sequence_id, group).map(|g| g.id.clone())
}

/// 组的成员（起点、终点、ID），按起点再按 ID 排。
pub(crate) fn members(state: &VideoState, sequence_id: &str, group_id: &str, fps: Rate) -> EngineResult<Vec<(Ratio, Ratio, Id)>> {
    let mut out = Vec::new();
    for (id, placed) in &state.items {
        if placed.sequence_id == sequence_id && placed.value.base().link_group_id.as_deref() == Some(group_id) {
            let (a, b) = item_range(&placed.value, fps)?;
            out.push((a, b, id.clone()));
        }
    }
    out.sort_by(|x, y| x.0.cmp(&y.0).then_with(|| x.2.cmp(&y.2)));
    Ok(out)
}

/// 成员或它的轨道锁着：整组的事务整笔拒绝，`details` 指出是哪个成员（§3.18）。
pub(crate) fn ensure_member_editable(state: &VideoState, group_id: &str, item_id: &str) -> EngineResult<()> {
    let item = &state.items.get(item_id).ok_or_else(|| ErrorBody::not_found(kinds::item(), item_id))?.value;
    let track_locked = state.tracks.get(&item.base().track_id).is_some_and(|t| t.value.locked);
    if item.base().locked || track_locked {
        return Err(ErrorBody::locked(
            vec![item_id.to_string()],
            msg!(
                "engine.linkGroupMemberLocked",
                "Clip {item} of link group {group} or its track is locked, so the group's time cannot change",
                item = item_id,
                group = group_id
            ),
        )
        .details(json!({ "groupId": group_id, "itemId": item_id, "trackId": item.base().track_id })));
    }
    Ok(())
}

/// 单独改一个成员的时间：拒绝（先解组，或者做同步校正）。
pub(crate) fn single_time_refused(item_id: &str, group_id: &str) -> ErrorBody {
    ErrorBody::invalid_operation(msg!(
        "engine.linkGroupSingleTime",
        "Clip {item} is in link group {group}, whose clips change time together: unlink it first, or correct its sync with syncLinkedItem",
        item = item_id,
        group = group_id
    ))
    .entities([item_id])
    .details(json!({ "rule": "link-group", "groupId": group_id }))
}

fn is_audio(state: &VideoState, item_id: &str) -> bool {
    matches!(state.items.get(item_id).map(|p| &p.value), Some(TimelineItem::Audio(_)))
}

/// 整组移动的量：组里有帧网格上的成员时以它为准量化（`preferred` 在帧网格上时就是它，否则取最早的一个视频成员），
/// 返回（帧数，精确的时长）；全是音频时按精确时间移。
#[allow(clippy::too_many_arguments)]
fn group_shift(
    state: &VideoState,
    grid: &GridContext<'_>,
    group: &[(Ratio, Ratio, Id)],
    preferred: Option<&str>,
    delta: Ratio,
    requested: TimelineTimeInput,
    alignment: FrameAlignment,
    ctx: &mut EditContext<'_>,
) -> EngineResult<(i64, Ratio)> {
    let fps = grid.fps;
    let anchor = preferred
        .filter(|id| !is_audio(state, id))
        .map(str::to_string)
        .or_else(|| group.iter().find(|(_, _, id)| !is_audio(state, id)).map(|(_, _, id)| id.clone()));
    let Some(anchor) = anchor else {
        return Ok((0, delta));
    };
    let from = state.items[&anchor].value.span().expect("视频成员在帧网格上").from_frame;
    let start = frame_time(from as i128, fps).ok_or_else(overflow)?;
    let target = start.checked_add(delta).ok_or_else(overflow)?;
    if target.is_negative() {
        return Err(negative_position(&anchor));
    }
    let q = quantize_exact(target, requested, grid, alignment, "at")?;
    ctx.time_resolution.push(q.receipt);
    let frames = q.frame - from;
    Ok((frames, frame_time(frames as i128, fps).ok_or_else(overflow)?))
}

fn negative_position(item_id: &str) -> ErrorBody {
    ErrorBody::time(editor_semantics::TimeError::Invalid {
        field: "at".into(),
        reason: msg!("engine.moveNegative", "The position after the move cannot be negative"),
    })
    .entities([item_id.to_string()])
}

/// 把整组移动（帧数，精确时长）；移完任何成员落到 0 之前都拒绝。
fn shift_group(state: &mut VideoState, group: &[(Ratio, Ratio, Id)], shift: (i64, Ratio), fps: Rate) -> EngineResult<()> {
    for (a, _, id) in group {
        let moved = if is_audio(state, id) {
            a.checked_add(shift.1).ok_or_else(overflow)?
        } else {
            a.checked_add(frame_time(shift.0 as i128, fps).ok_or_else(overflow)?).ok_or_else(overflow)?
        };
        if moved.is_negative() {
            return Err(negative_position(id));
        }
    }
    for (_, _, id) in group {
        shift_later(state, id, shift.1, shift.0, fps)?;
    }
    Ok(())
}

fn grid_of<'a>(sequence_id: &'a str, revision: &'a str, fps: Rate) -> GridContext<'a> {
    GridContext {
        sequence_id,
        sequence_revision: revision,
        fps,
    }
}

/// 组里有视频成员时把时刻量化到帧（返回帧输入与它的精确时刻），全是音频时按精确时间。
fn group_point(
    state: &VideoState,
    all: &[(Ratio, Ratio, Id)],
    at: &TimelineTimeInput,
    grid: &GridContext<'_>,
    alignment: FrameAlignment,
    ctx: &mut EditContext<'_>,
) -> EngineResult<(TimelineTimeInput, Ratio)> {
    if all.iter().any(|(_, _, id)| !is_audio(state, id)) {
        let q = editor_semantics::quantize_input(at, grid, alignment, "at")?;
        ctx.time_resolution.push(q.receipt);
        Ok((TimelineTimeInput::Frames { value: q.frame }, frame_time(q.frame as i128, grid.fps).ok_or_else(overflow)?))
    } else {
        Ok((at.clone(), at.resolve(grid.fps, "at", false)?))
    }
}

/// `moveItem` / `moveItems`：指到组里成员的移动整组移动同一段序列时间（§3.18），换轨道只换被指到的那个成员。
/// 同一组在一笔 `moveItems` 里被指到几次时位移要一样。位移都按移动之前的位置求。
pub(crate) fn move_items(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    moves: &[ItemMove],
    alignment: FrameAlignment,
    ctx: &mut EditContext<'_>,
) -> EngineResult<()> {
    if moves.iter().all(|mv| group_of(state, &mv.item_id).is_none()) {
        for mv in moves {
            move_item(state, sequence_id, mv, alignment, ctx)?;
        }
        return Ok(());
    }
    let (seq, fps, revision) = require_sequence(state, sequence_id)?;
    let seq = seq.to_string();
    let grid = grid_of(&seq, &revision, fps);
    let mut shifts: BTreeMap<Id, (i64, Ratio)> = BTreeMap::new();
    for mv in moves {
        let Some(group) = group_of(state, &mv.item_id) else { continue };
        item_in(state, &seq, &mv.item_id)?;
        let start = item_range(&state.items[&mv.item_id].value, fps)?.0;
        let (target, requested) = match (&mv.at, &mv.offset) {
            (Some(at), None) => (at.resolve(fps, "at", false)?, at.clone()),
            (None, Some(offset)) => (start.checked_add(offset.resolve(fps, "offset", true)?).ok_or_else(overflow)?, offset.clone()),
            _ => return Err(ErrorBody::invalid_operation(msg!("engine.moveNeedsTarget", "A move needs one of at or offset"))),
        };
        if target.is_negative() {
            return Err(negative_position(&mv.item_id));
        }
        let all = members(state, &seq, &group, fps)?;
        let delta = target.checked_sub(start).ok_or_else(overflow)?;
        let shift = group_shift(state, &grid, &all, Some(&mv.item_id), delta, requested, alignment, ctx)?;
        match shifts.get(&group) {
            Some(previous) if *previous != shift => {
                return Err(ErrorBody::invalid_operation(msg!(
                    "engine.linkGroupMoveMismatch",
                    "moveItems moves clips of link group {group} by different amounts",
                    group
                ))
                .entities([mv.item_id.clone()])
                .details(json!({ "rule": "link-group", "groupId": group })));
            }
            Some(_) => {}
            None => {
                shifts.insert(group, shift);
            }
        }
    }
    let mut moved: BTreeSet<Id> = BTreeSet::new();
    for mv in moves {
        let Some(group) = group_of(state, &mv.item_id) else {
            move_item(state, sequence_id, mv, alignment, ctx)?;
            continue;
        };
        if let Some(track_id) = &mv.track_id {
            retrack(state, &seq, &group, &mv.item_id, track_id)?;
        }
        if moved.insert(group.clone()) {
            let shift = shifts[&group];
            if shift != (0, Ratio::ZERO) {
                let all = members(state, &seq, &group, fps)?;
                for (_, _, id) in &all {
                    ensure_member_editable(state, &group, id)?;
                }
                shift_group(state, &all, shift, fps)?;
            }
        }
    }
    Ok(())
}

/// 把一个成员换到同类的另一条轨道上，时间不变。
fn retrack(state: &mut VideoState, sequence_id: &str, group_id: &str, item_id: &str, track_id: &str) -> EngineResult<()> {
    ensure_member_editable(state, group_id, item_id)?;
    let track = state
        .tracks
        .get(track_id)
        .filter(|t| t.sequence_id == sequence_id)
        .ok_or_else(|| ErrorBody::not_found(kinds::track(), track_id))?;
    if track.value.kind != state.items[item_id].value.track_kind() {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.moveTrackKind",
            "A clip cannot move to a track of another kind"
        ))
        .entities([track_id]));
    }
    ensure_track_editable(state, track_id)?;
    state.items.get_mut(item_id).expect("刚找到").value.base_mut().track_id = track_id.to_string();
    Ok(())
}

/// 把组在序列时刻 `t` 分成两组：起点不早于 `t` 的成员登记成一个新组（新的 ID，种类与 `recordingId` 相同）。
/// 两边都有成员时才分，返回新组的 ID。
pub(crate) fn partition(state: &mut VideoState, sequence_id: &str, group_id: &str, t: Ratio, fps: Rate) -> EngineResult<Option<Id>> {
    let Some(group) = registered(state, sequence_id, group_id).cloned() else {
        return Ok(None);
    };
    let all = members(state, sequence_id, group_id, fps)?;
    let right: Vec<&Id> = all.iter().filter(|(a, _, _)| *a >= t).map(|(_, _, id)| id).collect();
    if right.is_empty() || right.len() == all.len() {
        return Ok(None);
    }
    let new_group = new_id("lg");
    for id in right {
        state.items.get_mut(id).expect("刚列出").value.base_mut().link_group_id = Some(new_group.clone());
    }
    let groups = &mut state.sequences.get_mut(sequence_id).expect("组登记在这条序列上").header.link_groups;
    groups.push(LinkGroup {
        id: new_group.clone(),
        ..group
    });
    groups.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(Some(new_group))
}

/// 把组 `from` 的成员并进组 `into`（恢复剪口把两段接回一段时）。`from` 的登记在事务结束时随空组删掉。
pub(crate) fn merge(state: &mut VideoState, sequence_id: &str, into: &str, from: &str) {
    if into == from {
        return;
    }
    for placed in state.items.values_mut() {
        if placed.sequence_id == sequence_id && placed.value.base().link_group_id.as_deref() == Some(from) {
            placed.value.base_mut().link_group_id = Some(into.to_string());
        }
    }
}

/// `splitItem`：在同一序列时刻拆开跨过它的每个成员，右边的成员登记成一个新组（§3.18）。拆分点在组里有视频成员时取整帧。
pub(crate) fn split(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    item_id: &str,
    at: &TimelineTimeInput,
    alignment: FrameAlignment,
    ctx: &mut EditContext<'_>,
) -> EngineResult<()> {
    let Some(group) = group_of(state, item_id) else {
        return split_item(state, sequence_id, item_id, at, alignment, ctx).map(|_| ());
    };
    let (seq, fps, revision) = require_sequence(state, sequence_id)?;
    let seq = seq.to_string();
    item_in(state, &seq, item_id)?;
    let all = members(state, &seq, &group, fps)?;
    let (point, t) = group_point(state, &all, at, &grid_of(&seq, &revision, fps), alignment, ctx)?;
    for (_, _, id) in &all {
        ensure_member_editable(state, &group, id)?;
    }
    // 指到的成员先拆：拆分点不在它里面时照常报错。
    split_item(state, Some(&seq), item_id, &point, FrameAlignment::ExactFrame, ctx)?;
    for (a, b, id) in &all {
        if id != item_id && *a < t && t < *b {
            split_item(state, Some(&seq), id, &point, FrameAlignment::ExactFrame, ctx)?;
        }
    }
    partition(state, &seq, &group, t, fps)?;
    Ok(())
}

/// `trimItem`：各成员修剪到同一序列时刻（§3.18）。跨过修剪点的成员与这条边和指到的成员原来对齐的成员都修剪到那里；
/// 本来就没有伸到那里的成员不动。修剪点在组里有视频成员时取整帧。
#[allow(clippy::too_many_arguments)]
pub(crate) fn trim(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    item_id: &str,
    edge: Edge,
    at: &TimelineTimeInput,
    alignment: FrameAlignment,
    ctx: &mut EditContext<'_>,
) -> EngineResult<()> {
    let Some(group) = group_of(state, item_id) else {
        return trim_item(state, sequence_id, item_id, edge, at, alignment, ctx);
    };
    let (seq, fps, revision) = require_sequence(state, sequence_id)?;
    let seq = seq.to_string();
    item_in(state, &seq, item_id)?;
    let all = members(state, &seq, &group, fps)?;
    let (point, t) = group_point(state, &all, at, &grid_of(&seq, &revision, fps), alignment, ctx)?;
    let (na, nb) = item_range(&state.items[item_id].value, fps)?;
    let old_edge = match edge {
        Edge::Start => na,
        Edge::End => nb,
    };
    let targets: Vec<Id> = all
        .iter()
        .filter(|(a, b, id)| {
            let aligned = match edge {
                Edge::Start => *a == old_edge,
                Edge::End => *b == old_edge,
            };
            id == item_id || aligned || (*a < t && t < *b)
        })
        .map(|(_, _, id)| id.clone())
        .collect();
    for id in &targets {
        ensure_member_editable(state, &group, id)?;
    }
    for id in &targets {
        if id == item_id {
            trim_item(state, Some(&seq), id, edge, &point, FrameAlignment::ExactFrame, ctx)?;
            continue;
        }
        let Some(to) = reach(state, id, edge, &point, t, fps)? else {
            continue;
        };
        trim_item(state, Some(&seq), id, edge, &to, FrameAlignment::ExactFrame, ctx)?;
    }
    Ok(())
}

/// 往外拉时，和指到的成员一起拉的其余成员能到哪里：素材够就到修剪点，不够就到素材的头（尾），取整帧以内；一点都拉不出去时
/// `None`（不动）。往里收时就是修剪点。
fn reach(state: &VideoState, id: &str, edge: Edge, point: &TimelineTimeInput, t: Ratio, fps: Rate) -> EngineResult<Option<TimelineTimeInput>> {
    let (a, b) = item_range(&state.items[id].value, fps)?;
    let frames = |r: Ratio, alignment| -> EngineResult<TimelineTimeInput> {
        Ok(TimelineTimeInput::Frames { value: quantize_frame(r, fps, alignment, "at")? })
    };
    match edge {
        Edge::Start if t < a => {
            let Some(TimeMap::Linear { source_in, rate }) = state.items[id].value.time_map() else {
                return Ok(Some(point.clone()));
            };
            let back = source_in.to_ratio("sourceIn")?.checked_div(rate.ratio()).ok_or_else(overflow)?;
            let earliest = a.checked_sub(back).ok_or_else(overflow)?;
            if earliest <= t {
                return Ok(Some(point.clone()));
            }
            let limit = frames(earliest, FrameAlignment::CeilFrame)?;
            let at = limit.resolve(fps, "at", false)?;
            Ok((at < a).then_some(limit))
        }
        Edge::End if t > b => {
            let length = t.checked_sub(b).ok_or_else(overflow)?;
            let count = frames_at(length, fps).map(Ratio::ceil).unwrap_or_default() as i64;
            let (room, _) = crate::cuts::extension(state, id, length, count, fps)?;
            if room >= length {
                return Ok(Some(point.clone()));
            }
            let limit = frames(b.checked_add(room).ok_or_else(overflow)?, FrameAlignment::FloorFrame)?;
            let at = limit.resolve(fps, "at", false)?;
            Ok((at > b).then_some(limit))
        }
        _ => Ok(Some(point.clone())),
    }
}

/// `setSpeed`：组里各成员用同一个速率（§3.18）。指到的成员起点不动、取用的源区间不变（同单个实例的变速）；其余成员相对它的
/// 位置按速率缩放，使同一序列时刻仍对着同一录制时刻。视频成员的起点取不早于理想位置的整帧，源起点跟着补上那一点，
/// 长度向下取整到帧；音频成员是精确时间。各成员自己的源起点（含同步校正）保留。
pub(crate) fn set_speed(state: &mut VideoState, sequence_id: Option<&str>, item_id: &str, rate: Rate) -> EngineResult<()> {
    let Some(group) = group_of(state, item_id) else {
        return crate::ops::set_speed(state, sequence_id, item_id, rate);
    };
    let seq = state.items[item_id].sequence_id.clone();
    if let Some(given) = sequence_id {
        item_in(state, given, item_id)?;
    }
    let fps = state.sequence(&seq)?.header.fps;
    let all = members(state, &seq, &group, fps)?;
    for (_, _, id) in &all {
        ensure_member_editable(state, &group, id)?;
    }
    let anchor = item_range(&state.items[item_id].value, fps)?.0;
    let mut before = Vec::new();
    for (a, b, id) in &all {
        if id == item_id {
            continue;
        }
        let Some(TimeMap::Linear { source_in, rate: old }) = state.items[id].value.clone().time_map_mut().cloned() else {
            return Err(not_applicable(
                id,
                msg!("engine.speedNotLinear", "has no linear time mapping, so its speed cannot change"),
            ));
        };
        before.push((*a, *b, id.clone(), source_in.to_ratio("sourceIn")?, old.ratio()));
    }
    crate::ops::set_speed(state, Some(&seq), item_id, rate)?;
    let speed = rate.ratio();
    for (a, b, id, source_in, old) in before {
        // 理想的新起点：相对指到的成员的偏移按 旧速率 / 新速率 缩放。
        let offset = a.checked_sub(anchor).ok_or_else(overflow)?;
        let ideal = anchor
            .checked_add(offset.checked_mul(old).ok_or_else(overflow)?.checked_div(speed).ok_or_else(overflow)?)
            .ok_or_else(overflow)?;
        let source_length = b.checked_sub(a).ok_or_else(overflow)?.checked_mul(old).ok_or_else(overflow)?;
        let ideal_end = ideal
            .checked_add(source_length.checked_div(speed).ok_or_else(overflow)?)
            .ok_or_else(overflow)?;
        let mut item = state.items[&id].value.clone();
        let (start, length) = match &mut item {
            TimelineItem::Audio(audio) => {
                let start = ideal.max(Ratio::ZERO);
                let length = ideal_end.checked_sub(start).ok_or_else(overflow)?;
                let (from_frame, offset) = crate::ops::split_audio_start(start, fps)?;
                audio.from_frame = from_frame;
                audio.subframe_offset = offset;
                audio.play_duration = MediaTime::from_ratio(length.max(Ratio::ZERO), "playDuration")?;
                (start, length)
            }
            other => {
                let first = frames_at(ideal, fps).ok_or_else(overflow)?.ceil().max(0);
                let last = frames_at(ideal_end, fps).ok_or_else(overflow)?.floor().max(first);
                let span = other.span_mut().expect("视频成员在帧网格上");
                span.from_frame = i64::try_from(first).map_err(|_| overflow())?;
                span.duration_frames = i64::try_from(last - first).map_err(|_| overflow())?;
                let start = frame_time(first, fps).ok_or_else(overflow)?;
                (start, frame_time(last - first, fps).ok_or_else(overflow)?)
            }
        };
        if length <= Ratio::ZERO {
            return Err(ErrorBody::range_collapsed(&id, msg!("engine.trimToZero", "The clip has no length after trimming")));
        }
        let moved_in = source_in
            .checked_add(start.checked_sub(ideal).ok_or_else(overflow)?.checked_mul(speed).ok_or_else(overflow)?)
            .ok_or_else(overflow)?;
        let map = TimeMap::Linear {
            source_in: MediaTime::from_ratio(moved_in, "sourceIn")?,
            rate,
        };
        check_time_map(state, &id, &map, length, item.asset_ref())?;
        *item.time_map_mut().expect("视频与音频都有映射") = map;
        state.items.get_mut(&id).expect("刚读过").value = item;
    }
    Ok(())
}

/// `syncLinkedItem`：同步校正（§3.18）。只改这一个成员的源起点（加上 `offset` 秒，可为负），位置与长度不变；
/// 校正之后取用的源区间仍要在素材之内。
pub(crate) fn sync_item(state: &mut VideoState, sequence_id: Option<&str>, item_id: &str, offset: &str) -> EngineResult<()> {
    let placed = match sequence_id {
        Some(seq) => item_in(state, seq, item_id)?,
        None => state.items.get(item_id).ok_or_else(|| ErrorBody::not_found(kinds::item(), item_id))?,
    };
    let Some(group) = group_of(state, item_id) else {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.syncNotLinked",
            "Clip {item} is not in a link group, so it has no sync to correct",
            item = item_id
        ))
        .entities([item_id]));
    };
    let fps = state.sequence(&placed.sequence_id)?.header.fps;
    ensure_member_editable(state, &group, item_id)?;
    let delta = editor_semantics::parse_decimal_seconds(offset, "offset")?;
    let mut item = state.items[item_id].value.clone();
    let (start, end) = item_range(&item, fps)?;
    let Some(TimeMap::Linear { source_in, rate }) = item.time_map_mut().cloned() else {
        return Err(not_applicable(
            item_id,
            msg!("engine.syncNotLinear", "has no linear time mapping, so its sync cannot be corrected"),
        ));
    };
    let moved = source_in.to_ratio("sourceIn")?.checked_add(delta).ok_or_else(overflow)?;
    let map = TimeMap::Linear {
        source_in: MediaTime::from_ratio(moved, "sourceIn")?,
        rate,
    };
    check_time_map(state, item_id, &map, end.checked_sub(start).ok_or_else(overflow)?, item.asset_ref())?;
    *item.time_map_mut().expect("刚读过") = map;
    state.items.get_mut(item_id).expect("刚读过").value = item;
    Ok(())
}

/// 复制一组要在事务之外读出正文的文档：成员引用的屏幕取景文档与它们的录制清单（写取景文档时要核对清单的鼠标模式）。
pub fn duplicate_reads(state: &VideoState, sequence_id: &str, group_id: &str) -> Vec<Id> {
    let mut out = Vec::new();
    for placed in state.items.values() {
        if placed.sequence_id != sequence_id || placed.value.base().link_group_id.as_deref() != Some(group_id) {
            continue;
        }
        if let TimelineItem::Video(video) = &placed.value
            && let Some(view) = &video.screen_view
            && !out.contains(&view.document_id)
        {
            out.push(view.document_id.clone());
            if let Some(manifest) = state.documents.get(&view.document_id).and_then(|d| d.source_document_id.clone())
                && !out.contains(&manifest)
            {
                out.push(manifest);
            }
        }
    }
    out
}

/// `duplicateLinkGroup`：复制整组（§3.18）。成员复制成新的实例（新的 ID，不记 `lineage`：副本不是拆分出来的一段，
/// 不跟着原件进剪口集合），登记成新的组（`recordingId` 相同），整体移到最早的成员从 `at` 开始；屏幕取景文档复制成新文档，
/// 副本引用新文档；关键帧绑定一并复制。轨道不变，和已有的实例重叠时在事务最后拒绝。
pub(crate) fn duplicate(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    group_id: &str,
    at: &TimelineTimeInput,
    alignment: FrameAlignment,
    ctx: &mut EditContext<'_>,
) -> EngineResult<Id> {
    let (seq, fps, revision) = require_sequence(state, sequence_id)?;
    let seq = seq.to_string();
    let Some(group) = registered(state, &seq, group_id).cloned() else {
        return Err(ErrorBody::invalid_operation(msg!("engine.linkGroupMissing", "There is no link group {group}", group = group_id)));
    };
    let all = members(state, &seq, group_id, fps)?;
    let earliest = all.first().map(|(a, _, _)| *a).expect("登记的组至少有一个成员");
    let target = at.resolve(fps, "at", false)?;
    let delta = target.checked_sub(earliest).ok_or_else(overflow)?;
    let shift = group_shift(state, &grid_of(&seq, &revision, fps), &all, None, delta, at.clone(), alignment, ctx)?;

    // 屏幕取景文档各复制一份。
    let mut views: HashMap<Id, Id> = HashMap::new();
    for (_, _, id) in &all {
        ensure_track_editable(state, &state.items[id].value.base().track_id)?;
        let TimelineItem::Video(video) = &state.items[id].value else { continue };
        let Some(view) = &video.screen_view else { continue };
        if views.contains_key(&view.document_id) {
            continue;
        }
        let record = state
            .documents
            .get(&view.document_id)
            .ok_or_else(|| ErrorBody::not_found(kinds::document(), &view.document_id))?
            .clone();
        let body: Value = ctx.document_bodies.get(&record.id).cloned().ok_or_else(|| {
            ErrorBody::storage(msg!("engine.documentUnreadable", "Could not read the body of document {id}", id = record.id))
        })?;
        let reference = format!("linkGroupCopy:{}", record.id);
        let source_asset = record.source_asset_id.clone().map(|asset_id| AssetTarget::Id { asset_id });
        let source_document = record.source_document_id.clone().map(|document_id| DocumentTarget::Id { document_id });
        put_document(
            state,
            PutDocumentInput {
                document_id: None,
                reference: Some(&reference),
                kind: SCREEN_VIEW_KIND,
                name: Some(&record.name),
                language: record.language.as_deref(),
                source_asset: source_asset.as_ref(),
                source_document: source_document.as_ref(),
                body: &body,
                summary: None,
                extensions: &BTreeMap::new(),
            },
            ctx,
        )?;
        let copy = ctx.document_refs.remove(&reference).expect("刚写入");
        views.insert(record.id.clone(), copy);
    }

    let new_group = new_id("lg");
    let mut copies = Vec::new();
    for (a, b, id) in &all {
        let mut item = state.items[id].value.clone();
        let copy_id = new_id("item");
        let base = item.base_mut();
        base.id = copy_id.clone();
        base.lineage = None;
        base.link_group_id = Some(new_group.clone());
        if let TimelineItem::Video(video) = &mut item
            && let Some(view) = &mut video.screen_view
        {
            view.document_id = views[&view.document_id].clone();
        }
        state.items.insert(copy_id.clone(), Placed { sequence_id: seq.clone(), value: item });
        let header = &mut state.sequences.get_mut(&seq).expect("刚读过").header;
        let bindings: Vec<AnimationBinding> = header
            .animation_bindings
            .iter()
            .filter(|binding| binding.target_id == *id)
            .map(|binding| AnimationBinding {
                id: new_id("kb"),
                target_id: copy_id.clone(),
                ..binding.clone()
            })
            .collect();
        header.animation_bindings.extend(bindings);
        copies.push((*a, *b, copy_id));
    }
    shift_group(state, &copies, shift, fps)?;
    let groups = &mut state.sequences.get_mut(&seq).expect("刚读过").header.link_groups;
    groups.push(LinkGroup {
        id: new_group.clone(),
        ..group
    });
    groups.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(new_group)
}

/// 一段波纹编辑碰到的组：列出的实例里有它的成员。返回这些组与它们终点晚于 `t0`、还不在列表里的成员（任何轨道上），
/// 后者要和列表一起编辑。会动的成员都核对锁。
pub(crate) fn touched_groups(
    state: &VideoState,
    sequence_id: &str,
    listed: &[(Ratio, Ratio, Id)],
    t0: Ratio,
    fps: Rate,
) -> EngineResult<(BTreeSet<Id>, Vec<(Ratio, Ratio, Id)>)> {
    let groups: BTreeSet<Id> = listed.iter().filter_map(|(_, _, id)| group_of(state, id)).collect();
    let known: BTreeSet<&Id> = listed.iter().map(|(_, _, id)| id).collect();
    let mut extra = Vec::new();
    for group in &groups {
        for (a, b, id) in members(state, sequence_id, group, fps)? {
            if b > t0 {
                ensure_member_editable(state, group, &id)?;
                if !known.contains(&id) {
                    extra.push((a, b, id));
                }
            }
        }
    }
    Ok((groups, extra))
}

/// 波纹编辑里跨在切点上、却要原地不动的成员（`straddle: stay`、到序列末尾）：组会因此错开，整笔拒绝。
pub(crate) fn straddle_refused(state: &VideoState, item_id: &str) -> ErrorBody {
    let group = group_of(state, item_id).unwrap_or_default();
    ErrorBody::invalid_operation(msg!(
        "engine.linkGroupStraddle",
        "Clip {item} of link group {group} spans the edit point and would stay in place, so the group would fall out of sync",
        item = item_id,
        group
    ))
    .entities([item_id])
    .details(json!({ "rule": "link-group", "groupId": group }))
}
