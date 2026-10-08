//! 素材的引用与清理（命令与协议规范 §4.2 `removeAssets`）。
//!
//! 一个素材「有引用」，是指下面任何一处还指向它（与 `check_references` 核对的同一张图，再加文档的来源）：
//! - 任何序列上的实例：内容本身的 `assetRef` 与合成的预渲染替身 `prerender`（[`TimelineItem::asset_refs`]）；
//! - 章节（标记）的缩略图；
//! - 文档的来源素材 `sourceAssetId`：转写、剪口集合、剪辑提案描述的录音。
//!
//! 没有引用的素材可以删掉记录（`removeAssets`）。代码包与它烘焙出的预渲染替身成对处理：替身的来源记录
//! （`provenance` 为 `composition-bake`，代码包规范 §7）里的 `sourceBundleRef` 是代码包清单的 `bundleId/revision`，
//! 与代码包素材清单的同名字段对上就是一对。

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::{EngineResult, ErrorBody, kinds, msg};
use crate::model::*;
use crate::ops::EditContext;
use crate::state::VideoState;

/// 烘焙出的预渲染替身在 `provenance.origin` 里的取值（代码包规范 §7，与 `@baocut/protocol` 的 `BAKE_PROVENANCE_ORIGIN` 相同）。
pub const BAKE_PROVENANCE_ORIGIN: &str = "composition-bake";

/// 一个没有引用的素材（`videos.unusedAssets`）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnusedAsset {
    pub asset_id: Id,
    pub name: String,
    pub kind: AssetKind,
    pub media_type: String,
    /// 当前版本的字节数。
    pub byte_length: u64,
    /// `managed`（bytes 在视频目录里）或 `linked`（文件留在原处，删掉记录不动它）。
    pub storage: String,
    /// 成对的另一半（代码包 ↔ 它的预渲染替身），同样没有引用；删掉其中一个时一起删。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paired_with: Vec<Id>,
}

/// 每个有引用的素材 → 引用它的实例、标记与文档的 ID。
pub fn asset_users(state: &VideoState) -> BTreeMap<Id, BTreeSet<Id>> {
    let mut users: BTreeMap<Id, BTreeSet<Id>> = BTreeMap::new();
    for placed in state.items.values() {
        for r in placed.value.asset_refs() {
            users.entry(r.id.clone()).or_default().insert(placed.value.base().id.clone());
        }
    }
    for placed in state.markers.values() {
        if let Some(r) = &placed.value.thumbnail {
            users.entry(r.id.clone()).or_default().insert(placed.value.id.clone());
        }
    }
    for document in state.documents.values() {
        if let Some(asset) = &document.source_asset_id {
            users.entry(asset.clone()).or_default().insert(document.id.clone());
        }
    }
    users
}

/// 代码包清单的身份 `bundleId/revision`。
fn bundle_identity(asset: &AssetRecord) -> Option<(String, String)> {
    if asset.kind != AssetKind::Bundle {
        return None;
    }
    let manifest = asset.revisions.get(&asset.current_revision)?.bundle.as_ref()?;
    identity_of(manifest.get("bundleId")?, manifest.get("revision")?)
}

/// 预渲染替身记下的来源代码包身份（烘焙记录的 `sourceBundleRef`）。
fn baked_from(asset: &AssetRecord) -> Option<(String, String)> {
    let revision = asset.revisions.get(&asset.current_revision)?;
    if revision.provenance.origin != BAKE_PROVENANCE_ORIGIN {
        return None;
    }
    let source = revision.provenance.source.as_ref()?.get("sourceBundleRef")?;
    identity_of(source.get("id")?, source.get("revision")?)
}

fn identity_of(id: &Value, revision: &Value) -> Option<(String, String)> {
    let revision = match revision {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return None,
    };
    Some((id.as_str()?.to_string(), revision))
}

/// 素材 → 成对的另一半（代码包 ↔ 预渲染替身），只看身份，不看有没有引用。
fn pairs(state: &VideoState) -> BTreeMap<Id, BTreeSet<Id>> {
    let mut bundles: BTreeMap<(String, String), Vec<&Id>> = BTreeMap::new();
    for (id, asset) in &state.assets {
        if let Some(identity) = bundle_identity(asset) {
            bundles.entry(identity).or_default().push(id);
        }
    }
    let mut out: BTreeMap<Id, BTreeSet<Id>> = BTreeMap::new();
    for (id, asset) in &state.assets {
        let Some(identity) = baked_from(asset) else { continue };
        for bundle in bundles.get(&identity).into_iter().flatten() {
            out.entry(id.clone()).or_default().insert((*bundle).clone());
            out.entry((*bundle).clone()).or_default().insert(id.clone());
        }
    }
    out
}

/// 视频里没有引用的素材，按 ID 排序。
pub fn unused_assets(state: &VideoState) -> Vec<UnusedAsset> {
    let users = asset_users(state);
    let unused: BTreeSet<&Id> = state.assets.keys().filter(|id| !users.contains_key(*id)).collect();
    let pairs = pairs(state);
    unused
        .iter()
        .map(|id| {
            let asset = &state.assets[*id];
            let current = asset.revisions.get(&asset.current_revision);
            UnusedAsset {
                asset_id: (*id).clone(),
                name: asset.name.clone(),
                kind: asset.kind,
                media_type: current.map(|r| r.media_type.clone()).unwrap_or_default(),
                byte_length: current.map_or(0, |r| r.byte_length),
                storage: match current.map(|r| &r.storage) {
                    Some(AssetStorage::Linked { .. }) => "linked".into(),
                    _ => "managed".into(),
                },
                paired_with: pairs
                    .get(*id)
                    .into_iter()
                    .flatten()
                    .filter(|other| unused.contains(other))
                    .cloned()
                    .collect(),
            }
        })
        .collect()
}

/// `removeAssets`：列出的素材都必须没有引用；成对的另一半也没有引用时一起删掉。只删记录。
pub(crate) fn remove_assets(state: &mut VideoState, asset_ids: &[Id], ctx: &mut EditContext<'_>) -> EngineResult<()> {
    if asset_ids.is_empty() {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.removeAssetsEmpty",
            "removeAssets needs at least one entry"
        )));
    }
    for id in asset_ids {
        if !state.assets.contains_key(id) {
            return Err(ErrorBody::not_found(kinds::asset(), id));
        }
    }
    let users = asset_users(state);
    let in_use: Vec<&Id> = asset_ids.iter().filter(|id| users.contains_key(*id)).collect();
    if !in_use.is_empty() {
        let used_by: BTreeMap<&Id, &BTreeSet<Id>> = in_use.iter().map(|id| (*id, &users[*id])).collect();
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.assetInUse",
            "Asset {asset} is still used by {users}; only assets nothing refers to can be removed",
            asset = in_use[0].as_str(),
            users = used_by[in_use[0]].iter().cloned().collect::<Vec<_>>().join(", ")
        ))
        .recovery(msg!(
            "engine.assetInUseRecovery",
            "Delete or replace the clips, chapter thumbnails and documents that use it first, or leave the asset in place"
        ))
        .entities(in_use.iter().map(|id| (*id).clone()))
        .details(json!({ "rule": "asset-in-use", "usedBy": used_by })));
    }
    let pairs = pairs(state);
    let mut removed: BTreeSet<Id> = asset_ids.iter().cloned().collect();
    for id in asset_ids {
        for partner in pairs.get(id).into_iter().flatten() {
            if !users.contains_key(partner) {
                removed.insert(partner.clone());
            }
        }
    }
    for id in &removed {
        state.assets.remove(id);
        if !ctx.removed_assets.contains(id) {
            ctx.removed_assets.push(id.clone());
        }
    }
    Ok(())
}
