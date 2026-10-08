//! 便携包（视频格式规范 §8）在引擎这边的两件事：包里的素材放在哪个相对路径，以及把一个已经解开、清单校验过的包
//! 建成一个新视频。
//!
//! 包的清单与归档由 Runtime 校验（每个文件的长度与摘要、格式版本、路径不越界）。引擎不信任清单：文档正文按登记的
//! `contentHash` 重算，素材的 bytes 按登记的摘要重算，快照按提交时同样的规则检查（引用、重叠、转场），
//! 任何一项不符都拒绝，不会建出一个半个或不自洽的视频。

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use editor_semantics::TIME_CONTRACT_VERSION;
use serde_json::{Value, json};

use crate::error::{EngineResult, ErrorBody, Retryability, Text, kinds, msg};
use crate::ids::{new_id, now_rfc3339};
use crate::import::{DIRECTORY_MEDIA_TYPE, blob_extension, hash_tree, publish_tree, publish_verified};
use crate::model::*;
use crate::ops::check_overlaps;
use crate::state::{Placed, SequenceEntity, VideoState};
use crate::store::{DocumentBody, Store};
use crate::video::{DB_FILE, LOCK_FILE, OpenMode, Video, acquire_lock, sha256_text};

/// 包里的快照文件。
pub const PACKAGE_SNAPSHOT: &str = "video.snapshot.json";

/// 一个素材版本的 bytes 在包里的相对路径：文件是 `assets/<sha256>.<ext>`，目录是 `assets/<sha256>/`。
pub fn package_asset_path(content_hash: &str, media_type: &str) -> String {
    let hex = content_hash.strip_prefix("sha256:").unwrap_or(content_hash);
    if media_type == DIRECTORY_MEDIA_TYPE {
        return format!("assets/{hex}");
    }
    format!("assets/{hex}.{}", blob_extension(media_type))
}

/// 一个文档版本的正文在包里的相对路径。
pub fn package_document_path(document_id: &str, revision: &str) -> String {
    format!("documents/{document_id}/{revision}.json")
}

fn invalid(message: impl Into<Text>) -> ErrorBody {
    ErrorBody::new("PACKAGE_INVALID", message, Retryability::Never)
}

fn duplicate(id: &str) -> ErrorBody {
    invalid(msg!("engine.packageDuplicateId", "The snapshot has a duplicate entity ID {id}", id))
}

fn mismatch(message: impl Into<Text>, details: Value) -> ErrorBody {
    ErrorBody::new("PACKAGE_DIGEST_MISMATCH", message, Retryability::Never).details(details)
}

/// 用作路径一段的 ID 与版本：不能为空、不能是 `.`/`..`、不能带分隔符。
fn safe_segment(text: &str) -> bool {
    !text.is_empty()
        && text != "."
        && text != ".."
        && text.len() <= 200
        && !text.chars().any(|c| c == '/' || c == '\\' || c == '\0' || c.is_control())
}

/// 把解开的包（`package_dir`，里面有 `video.snapshot.json`、`documents/`、`assets/`）建成 `dir` 里的一个新视频。
/// 新视频有新的 videoId，内容、各个实体的 ID 与修订号沿用包里的；包里收进来的素材全部收进视频（`managed`）。
/// `dir` 必须还不存在；失败时删掉建了一半的目录。
pub fn import_package(dir: &Path, package_dir: &Path, project_id: Option<&str>, ffprobe: &Path) -> EngineResult<Video> {
    if dir.exists() {
        return Err(ErrorBody::invalid_operation(msg!("engine.targetExists", "The target directory already exists")).details(json!({ "path": dir })));
    }
    let parent = dir.parent().ok_or_else(|| ErrorBody::invalid_operation(msg!("engine.targetInvalid", "The target directory is invalid")))?;
    if !parent.is_dir() {
        return Err(ErrorBody::not_found(kinds::directory(), &parent.display().to_string()));
    }
    // 先在不碰目标目录的情况下读完、核对快照与文档：包不对时什么都不建。
    let (state, documents) = read_package(package_dir)?;
    fs::create_dir(dir)?;
    let result = (|| -> EngineResult<Video> {
        fs::create_dir_all(dir.join("blobs").join(".staging"))?;
        let lock = acquire_lock(&dir.join(LOCK_FILE))?;
        publish_assets(dir, package_dir, &state)?;
        let mut store = Store::create(&dir.join(DB_FILE), &state, &now_rfc3339())?;
        store.import_versions(&state, &documents)?;
        drop(store);
        drop(lock);
        let mut video = Video::open(dir, OpenMode::Write, ffprobe)?;
        if let Some(project_id) = project_id {
            video.claim_project(project_id)?;
        }
        Ok(video)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(dir);
    }
    result
}

/// 读出包里的快照，换成新视频的工作态，并读出、核对每个文档版本的正文。
fn read_package(package_dir: &Path) -> EngineResult<(VideoState, Vec<DocumentBody>)> {
    let text = fs::read_to_string(package_dir.join(PACKAGE_SNAPSHOT)).map_err(|e| invalid(msg!(
            "engine.packageNoSnapshot",
            "The package has no readable snapshot: {error}",
            error = e.to_string()
        )))?;
    let raw: Value = serde_json::from_str(&text).map_err(|e| invalid(msg!("engine.snapshotNotJson", "The snapshot is not JSON: {error}", error = e.to_string())))?;
    if raw.get("format").and_then(Value::as_str) != Some(VIDEO_FORMAT) {
        return Err(invalid(msg!("engine.snapshotNotVideo", "The snapshot is not a BaoCut video")));
    }
    let schema = raw.get("schemaVersion").and_then(Value::as_u64).unwrap_or(0);
    if schema != u64::from(SCHEMA_VERSION) {
        // 只接受当前版本（视频格式规范 §1.4）：更高的版本不认识，1–2 用的是旧的元素模型，不保留兼容。
        let message = if schema > u64::from(SCHEMA_VERSION) {
            msg!(
                "engine.packageSchemaTooNew",
                "Video format version {version} in the package is not supported; open it with a newer BaoCut",
                version = schema
            )
        } else {
            msg!(
                "engine.packageSchemaRetired",
                "Video format version {version} in the package is no longer supported: from version {current}, picture elements use a new element model; import again from the original project",
                version = schema,
                current = SCHEMA_VERSION
            )
        };
        return Err(ErrorBody::new("PACKAGE_VERSION_UNSUPPORTED", message, Retryability::Never)
            .details(json!({ "schemaVersion": schema, "supported": [SCHEMA_VERSION] })));
    }
    let contract = raw.get("timeContractVersion").and_then(Value::as_u64).unwrap_or(0);
    if contract != u64::from(TIME_CONTRACT_VERSION) {
        return Err(ErrorBody::new(
            "PACKAGE_VERSION_UNSUPPORTED",
            msg!(
                "engine.packageTimeContract",
                "Time contract version {version} in the package is not supported",
                version = contract
            ),
            Retryability::Never,
        )
        .details(json!({ "timeContractVersion": contract, "supported": TIME_CONTRACT_VERSION })));
    }
    let snapshot: VideoSnapshot = serde_json::from_value(raw).map_err(|e| invalid(msg!("engine.snapshotUnreadable", "The snapshot cannot be read: {error}", error = e.to_string())))?;
    let state = state_from_snapshot(snapshot)?;
    validate(&state)?;
    let mut documents = Vec::new();
    for (id, record) in &state.documents {
        for (revision, version) in &record.revisions {
            if !safe_segment(id) || !safe_segment(revision) {
                return Err(invalid(msg!(
                    "engine.documentPathUnsafe",
                    "Revision {revision} of document {id} cannot be used as a path in the package",
                    revision,
                    id
                )));
            }
            let path = package_dir.join(package_document_path(id, revision));
            let body = fs::read_to_string(&path).map_err(|e| invalid(msg!(
                    "engine.packageDocumentMissing",
                    "The package is missing revision {revision} of document {id}: {error}",
                    revision,
                    id,
                    error = e.to_string()
                )))?;
            let hash = sha256_text(&body);
            if hash != version.content_hash || body.len() as u64 != version.byte_length {
                return Err(mismatch(
                    msg!(
                        "engine.documentDigestMismatch",
                        "Revision {revision} of document {id} does not match its recorded digest",
                        revision,
                        id
                    ),
                    json!({ "documentId": id, "revision": revision, "expected": version.content_hash, "actual": hash }),
                ));
            }
            if !serde_json::from_str::<Value>(&body).is_ok_and(|v| v.is_object()) {
                return Err(invalid(msg!(
                    "engine.documentNotObject",
                    "Revision {revision} of document {id} is not a JSON object",
                    revision,
                    id
                )));
            }
            documents.push(DocumentBody {
                document_id: id.clone(),
                revision: revision.clone(),
                content_hash: version.content_hash.clone(),
                body,
            });
        }
    }
    Ok((state, documents))
}

/// 快照 → 工作态（`VideoState::snapshot` 的逆）。视频换成新的 ID，修订号沿用。
fn state_from_snapshot(snapshot: VideoSnapshot) -> EngineResult<VideoState> {
    let revision: i64 = snapshot
        .revision
        .parse()
        .ok()
        .filter(|r| *r >= 0)
        .ok_or_else(|| invalid(msg!("engine.snapshotRevisionInvalid", "The revision of the snapshot is invalid")))?;
    let mut state = VideoState {
        id: new_id("video"),
        name: snapshot.name,
        root_sequence_id: snapshot.root_sequence_id,
        revision,
        event_seq: 0,
        sequences: BTreeMap::new(),
        tracks: BTreeMap::new(),
        items: BTreeMap::new(),
        transitions: BTreeMap::new(),
        markers: BTreeMap::new(),
        ducking: BTreeMap::new(),
        assets: snapshot.assets,
        documents: snapshot.documents,
        checkpoints: snapshot.checkpoints,
        protections: snapshot.protections,
    };
    for (id, sequence) in snapshot.sequences {
        if id != sequence.id {
            return Err(invalid(msg!("engine.sequenceIdMismatch", "The ID of sequence {id} is inconsistent", id)));
        }
        let seq_revision: i64 = sequence
            .revision
            .parse()
            .ok()
            .filter(|r| (0..=revision).contains(r))
            .ok_or_else(|| invalid(msg!("engine.sequenceRevisionInvalid", "The revision of sequence {id} is invalid", id)))?;
        for track in sequence.tracks {
            let key = track.id.clone();
            let placed = Placed {
                sequence_id: id.clone(),
                value: track,
            };
            if state.tracks.insert(key.clone(), placed).is_some() {
                return Err(duplicate(&key));
            }
        }
        for item in sequence.items {
            let key = item.base().id.clone();
            let placed = Placed {
                sequence_id: id.clone(),
                value: item,
            };
            if state.items.insert(key.clone(), placed).is_some() {
                return Err(duplicate(&key));
            }
        }
        for transition in sequence.transitions {
            let key = transition.id.clone();
            let placed = Placed {
                sequence_id: id.clone(),
                value: transition,
            };
            if state.transitions.insert(key.clone(), placed).is_some() {
                return Err(duplicate(&key));
            }
        }
        for marker in sequence.markers {
            let key = marker.id.clone();
            let placed = Placed {
                sequence_id: id.clone(),
                value: marker,
            };
            if state.markers.insert(key.clone(), placed).is_some() {
                return Err(duplicate(&key));
            }
        }
        for rule in sequence.ducking {
            let key = rule.id.clone();
            let placed = Placed {
                sequence_id: id.clone(),
                value: rule,
            };
            if state.ducking.insert(key.clone(), placed).is_some() {
                return Err(duplicate(&key));
            }
        }
        state.sequences.insert(
            id,
            SequenceEntity {
                header: sequence.header,
                revision: seq_revision,
            },
        );
    }
    Ok(state)
}

/// 提交时成立的规则在导入时同样成立：ID 唯一、引用都在、同一轨道上不重叠、转场两侧成立。
fn validate(state: &VideoState) -> EngineResult<()> {
    if !state.sequences.contains_key(&state.root_sequence_id) {
        return Err(invalid(msg!("engine.rootSequenceMissing", "The root sequence of the snapshot does not exist")));
    }
    let name = state.name.trim();
    if name.is_empty() || name.chars().count() > 200 {
        return Err(invalid(msg!("engine.videoNameLength", "The video name must be 1–200 characters")));
    }
    // 实体在存储里按 ID 存在同一张表里：不同种类之间也不能重复。
    let counts = [
        state.sequences.len(),
        state.tracks.len(),
        state.items.len(),
        state.transitions.len(),
        state.markers.len(),
        state.ducking.len(),
        state.assets.len(),
        state.documents.len(),
        state.checkpoints.len(),
        state.protections.len(),
    ];
    let ids: BTreeSet<&str> = state
        .sequences
        .keys()
        .chain(state.tracks.keys())
        .chain(state.items.keys())
        .chain(state.transitions.keys())
        .chain(state.markers.keys())
        .chain(state.ducking.keys())
        .chain(state.assets.keys())
        .chain(state.documents.keys())
        .chain(state.checkpoints.keys())
        .chain(state.protections.keys())
        .map(String::as_str)
        .collect();
    let total: usize = counts.iter().sum();
    if ids.len() != total || ids.contains(state.id.as_str()) {
        return Err(invalid(msg!("engine.snapshotDuplicateIds", "The snapshot has duplicate entity IDs")));
    }
    for (id, asset) in &state.assets {
        if asset.id != *id || !asset.revisions.contains_key(&asset.current_revision) {
            return Err(invalid(msg!("engine.assetRecordIncomplete", "The record of asset {id} is incomplete", id)));
        }
        for (revision, version) in &asset.revisions {
            if version.revision != *revision || !version.content_hash.starts_with("sha256:") {
                return Err(invalid(msg!(
                    "engine.assetRevisionIncomplete",
                    "The record of revision {revision} of asset {id} is incomplete",
                    revision,
                    id
                )));
            }
        }
    }
    for (id, document) in &state.documents {
        if document.id != *id || !document.revisions.contains_key(&document.current_revision) {
            return Err(invalid(msg!("engine.documentRecordIncomplete", "The record of document {id} is incomplete", id)));
        }
    }
    for item in state.items.values() {
        let base = item.value.base();
        if state.tracks.get(&base.track_id).is_none_or(|t| t.sequence_id != item.sequence_id) {
            return Err(invalid(msg!(
                "engine.itemTrackOutside",
                "The track of clip {item} is not in its sequence",
                item = base.id
            )));
        }
        for asset_ref in item.value.asset_refs() {
            if !state
                .assets
                .get(&asset_ref.id)
                .is_some_and(|a| a.revisions.contains_key(&asset_ref.revision))
            {
                return Err(invalid(msg!(
                    "engine.itemAssetNotInPackage",
                    "Asset {asset}@{revision} used by clip {item} is not in the package",
                    asset = asset_ref.id,
                    revision = asset_ref.revision,
                    item = base.id
                )));
            }
        }
        if let TimelineItem::Caption(caption) = &item.value {
            let style = caption.style_document_id.iter();
            for doc in std::iter::once(&caption.document_id).chain(style) {
                if !state.documents.contains_key(doc) {
                    return Err(invalid(msg!(
                        "engine.captionDocumentNotInPackage",
                        "Document {doc} used by caption clip {item} is not in the package",
                        doc,
                        item = base.id
                    )));
                }
            }
        }
    }
    for sequence_id in state.sequences.keys() {
        check_overlaps(state, sequence_id)?;
    }
    let mut copy = state.clone();
    let changes = crate::transitions::reconcile_transitions(state, &mut copy)?;
    if let Some(first) = changes.removed.first() {
        return Err(invalid(msg!(
            "engine.transitionSidesInvalid",
            "The clips on either side of transition {transition} are invalid",
            transition = first.id
        )));
    }
    Ok(())
}

/// 把包里收进来的素材按内容地址发布进视频的 `blobs/`，并按登记的摘要核对。没有收进包的（链接、缺失）不动。
fn publish_assets(dir: &Path, package_dir: &Path, state: &VideoState) -> EngineResult<()> {
    for (id, asset) in &state.assets {
        for (revision, version) in &asset.revisions {
            if !matches!(version.storage, AssetStorage::Managed) {
                continue;
            }
            let rel = package_asset_path(&version.content_hash, &version.media_type);
            let source: PathBuf = package_dir.join(&rel);
            let details = || json!({ "assetId": id, "revision": revision, "path": rel });
            if version.media_type == DIRECTORY_MEDIA_TYPE {
                if !source.is_dir() {
                    return Err(invalid(msg!(
                        "engine.packageAssetMissing",
                        "The package is missing revision {revision} of asset {id}",
                        revision,
                        id
                    )).details(details()));
                }
                let include = version.tree.as_ref().and_then(|t| t.include.as_deref());
                let (hash, length, _) = hash_tree(&source, include)?;
                if hash != version.content_hash || length != version.byte_length {
                    return Err(mismatch(
                        msg!(
                            "engine.assetDigestMismatch",
                            "Revision {revision} of asset {id} does not match its recorded digest",
                            revision,
                            id
                        ),
                        details(),
                    ));
                }
                publish_tree(dir, &source, include, &version.content_hash)?;
            } else {
                let meta = fs::symlink_metadata(&source)
                    .map_err(|_| invalid(msg!(
                        "engine.packageAssetMissing",
                        "The package is missing revision {revision} of asset {id}",
                        revision,
                        id
                    )).details(details()))?;
                if !meta.is_file() || meta.len() != version.byte_length {
                    return Err(mismatch(
                        msg!(
                            "engine.assetLengthMismatch",
                            "The length of revision {revision} of asset {id} does not match its record",
                            revision,
                            id
                        ),
                        details(),
                    ));
                }
                publish_verified(dir, &source, &version.media_type, &version.content_hash)
                    .map_err(|_| mismatch(
                        msg!(
                            "engine.assetDigestMismatch",
                            "Revision {revision} of asset {id} does not match its recorded digest",
                            revision,
                            id
                        ),
                        details(),
                    ))?;
            }
        }
    }
    Ok(())
}
