//! 便携包（视频格式规范 §8）：导出时的冻结（`exports.package`）与把解开的包建成新视频（`videos.importPackage`）。
//!
//! 冻结在一次请求里读出当前的快照、每个文档版本存下的正文原文与每个素材版本此刻的位置；引擎宿主按顺序处理请求，
//! 所以它们对应同一个视频版本。文档版本与收进视频的 blob 不再改变，之后的编辑不影响已经冻结的导出。

use std::path::PathBuf;

use serde::Deserialize;
use serde_json::{Value, json};
use message_ref::msg;
use video_engine::import::{DIRECTORY_MEDIA_TYPE, tree_files};
use video_engine::model::{AssetStorage, Id};
use video_engine::package::{import_package, package_asset_path, package_document_path};
use video_engine::{ErrorBody, Retryability, Video};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportParams {
    /// 新视频的目录（绝对路径，还不存在）。
    pub path: String,
    /// 解开、校验过清单的包所在的目录（绝对路径）。
    pub package_dir: String,
    #[serde(default)]
    pub project_id: Option<Id>,
}

/// 冻结一个打开的视频，供 Runtime 写便携包。素材版本读不到时不报错，逐项带上 `missing`，由 Runtime 决定拒绝还是如实标注。
pub fn freeze(video: &Video) -> Result<Value, ErrorBody> {
    let snapshot = video.snapshot();
    let mut documents = Vec::new();
    for (id, record) in &snapshot.documents {
        for (revision, version) in &record.revisions {
            let text = video.document_text(id, revision)?;
            documents.push(json!({
                "documentId": id,
                "revision": revision,
                "contentHash": version.content_hash,
                "byteLength": text.len(),
                "packagePath": package_document_path(id, revision),
                "text": text,
            }));
        }
    }
    let mut assets = Vec::new();
    for (id, asset) in &snapshot.assets {
        for (revision, version) in &asset.revisions {
            let storage = match version.storage {
                AssetStorage::Managed => "managed",
                AssetStorage::Linked { .. } => "linked",
            };
            let mut entry = json!({
                "assetId": id,
                "revision": revision,
                "name": asset.name,
                "mediaType": version.media_type,
                "contentHash": version.content_hash,
                "byteLength": version.byte_length,
                "storage": storage,
                "packagePath": package_asset_path(&version.content_hash, &version.media_type),
            });
            match video.resolve_asset(id, Some(revision)) {
                Ok(resolved) => {
                    entry["path"] = json!(resolved.path);
                    if version.media_type == DIRECTORY_MEDIA_TYPE {
                        let include = version.tree.as_ref().and_then(|t| t.include.as_deref());
                        match tree_files(&resolved.path, include) {
                            Ok(files) => {
                                entry["files"] = files.iter().map(|(rel, path)| json!({ "rel": rel, "path": path })).collect();
                            }
                            Err(e) => entry["missing"] = json!({ "reason": "missing", "message": e.message }),
                        }
                    }
                }
                Err(e) => {
                    let reason = e.details.get("reason").and_then(Value::as_str).unwrap_or("missing");
                    entry["missing"] = json!({ "reason": reason, "message": e.message });
                }
            }
            assets.push(entry);
        }
    }
    Ok(json!({
        "videoDir": video.dir(),
        "snapshot": snapshot,
        "documents": documents,
        "assets": assets,
    }))
}

/// 把解开的包建成新视频，返回与 `videos.create` 相同的结构（由调用方登记为打开的视频）。
pub fn import(params: ImportParams, ffprobe: &std::path::Path) -> Result<Video, ErrorBody> {
    let dir = PathBuf::from(&params.path);
    let package_dir = PathBuf::from(&params.package_dir);
    if !dir.is_absolute() || !package_dir.is_absolute() {
        return Err(ErrorBody::new(
            "INVALID_PARAMS",
            msg!("engineHost.pathRelative", "Paths must be absolute"),
            Retryability::Never,
        ));
    }
    import_package(&dir, &package_dir, params.project_id.as_deref(), ffprobe)
}
