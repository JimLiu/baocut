//! 录制在时间线上的两样东西（视频格式规范 §3.18）：登记在序列上的联动组，与视频实例对屏幕取景文档的引用。
//! 这里只管登记、成员与引用的约束；成组的时间编辑、取景的求值与渲染还没有实现（§10）。

use std::collections::BTreeSet;

use message_ref::{Text, msg};
use video_model::recording::RECORDING_KIND;
use video_model::screen_view::SCREEN_VIEW_KIND;

use crate::error::{EngineResult, ErrorBody, kinds};
use crate::ids::new_id;
use crate::model::*;
use crate::ops::{DocumentTarget, EditContext, not_applicable};
use crate::state::VideoState;

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
