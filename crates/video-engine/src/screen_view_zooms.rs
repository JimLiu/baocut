//! `regenerateAutoZooms`：按录制的点击重新生成屏幕取景的自动缩放（视频格式规范 §4.9，屏幕录制设计 §6），写成取景文档的
//! 新版本。生成的规则在 `video_model::screen_view_solver::auto_zooms`：只替换没改过的自动区间，手加的与改过的保留，新区间
//! 让开它们。指针轨的字节在事务之外读好（[`EditContext::pointer_tracks`]）。

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use message_ref::msg;
use serde_json::Value;
use video_model::pointer_track::PointerTrack;
use video_model::recording::{CLOCK_RECORDING, PointerMode, RecordingBody, StreamRole};
use video_model::screen_view::{SCREEN_VIEW_KIND, ScreenViewBody};
use video_model::screen_view_solver::auto_zooms;

use crate::error::{EngineResult, ErrorBody, kinds};
use crate::ids::new_id;
use crate::ops::{EditContext, PutDocumentInput, put_document};
use crate::state::VideoState;

/// 指针轨在 [`EditContext::pointer_tracks`] 里的键。
pub(crate) fn track_key(id: &str, revision: &str) -> String {
    format!("{id}@{revision}")
}

/// 这份文档在事务里的最新正文：这笔事务写过的，否则事务之前读好的。
fn latest_body(id: &str, ctx: &EditContext<'_>) -> Option<Value> {
    match ctx.documents.iter().rev().find(|d| d.document_id == id) {
        Some(written) => serde_json::from_str(&written.body).ok(),
        None => ctx.document_bodies.get(id).cloned(),
    }
}

pub(crate) fn regenerate_auto_zooms(state: &mut VideoState, document_id: &str, ctx: &mut EditContext<'_>) -> EngineResult<()> {
    let record = state
        .documents
        .get(document_id)
        .ok_or_else(|| ErrorBody::not_found(kinds::document(), document_id))?;
    if record.kind != SCREEN_VIEW_KIND {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.screenViewDocument",
            "Document {document} is not a screen view",
            document = document_id
        ))
        .entities([document_id]));
    }
    let manifest_id = record.source_document_id.clone();
    let mut value = latest_body(document_id, ctx).ok_or_else(|| {
        ErrorBody::invalid_operation(msg!("engine.screenViewUnreadable", "The screen view cannot be read")).entities([document_id])
    })?;
    let view: ScreenViewBody = serde_json::from_value(value.clone()).map_err(|_| {
        ErrorBody::invalid_operation(msg!("engine.screenViewUnreadable", "The screen view cannot be read")).entities([document_id])
    })?;
    let no_pointer = || {
        ErrorBody::invalid_operation(msg!(
            "engine.autoZoomsNoPointer",
            "Automatic zooms follow the clicks of a screen recording, and this screen view has no pointer track"
        ))
        .entities([document_id])
    };
    if view.clock != CLOCK_RECORDING {
        return Err(no_pointer());
    }
    let manifest: RecordingBody = manifest_id
        .as_deref()
        .and_then(|id| latest_body(id, ctx))
        .and_then(|body| serde_json::from_value(body).ok())
        .ok_or_else(|| {
            ErrorBody::invalid_operation(msg!(
                "engine.recordingUnreadable",
                "The recording manifest of this screen view cannot be read"
            ))
            .entities([document_id])
        })?;
    if manifest.pointer.mode == PointerMode::None {
        return Err(no_pointer());
    }
    let mut tracks: HashMap<String, Arc<PointerTrack>> = HashMap::new();
    for stream in manifest.streams.iter().filter(|s| s.role == StreamRole::Pointer) {
        let track = ctx.pointer_tracks.get(&track_key(&stream.asset_ref.id, &stream.asset_ref.revision)).ok_or_else(|| {
            ErrorBody::invalid_operation(msg!(
                "engine.recordingPointerTrackUnreadable",
                "The pointer track {asset} of the recording cannot be read",
                asset = stream.asset_ref.id.clone()
            ))
            .entities([stream.asset_ref.id.as_str()])
        })?;
        tracks.insert(stream.id.clone(), track.clone());
    }
    let zooms = auto_zooms(&manifest, &tracks, view.timescale, &view.zooms, || new_id("zoom"));
    if zooms == view.zooms {
        return Ok(());
    }
    value["zooms"] = serde_json::to_value(&zooms).expect("zoom regions serialize");
    put_document(
        state,
        PutDocumentInput {
            document_id: Some(document_id),
            reference: None,
            kind: SCREEN_VIEW_KIND,
            name: None,
            language: None,
            source_asset: None,
            source_document: None,
            body: &value,
            summary: None,
            extensions: &BTreeMap::new(),
        },
        ctx,
    )
}
