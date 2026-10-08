//! 合成要读的文档：字幕文档、字幕样式文档与字幕的词所在的转写文档的冻结正文（引擎 `exports.plan` 的 `documents`，
//! 预览由界面送进来）。

use std::collections::HashMap;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::Value;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenDocument {
    pub document_id: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
    /// 字幕行的种类：`original` 或 `translation`（派生自译文的字幕）。
    #[serde(default)]
    pub line_kind: Option<String>,
    /// 文档头的 `sourceDocumentId`：字幕的句子用 `words` 指向这份文档里的词。
    #[serde(default)]
    pub source_document_id: Option<String>,
    /// 文档头的 `sourceAssetId`：转写描述的素材（投有效词流用）。
    #[serde(default)]
    pub source_asset_id: Option<String>,
    /// 文档不在了时为 `null`。
    #[serde(default)]
    pub body: Value,
}

/// 按 ID 查的文档。正文共享：预览换文档时不再整份复制转写。
#[derive(Clone, Debug, Default)]
pub struct Documents {
    by_id: HashMap<String, Arc<FrozenDocument>>,
}

impl Documents {
    pub fn new(documents: Vec<FrozenDocument>) -> Documents {
        Documents::shared(documents.into_iter().map(Arc::new))
    }

    /// 共享正文的文档；同一个 ID 出现两次时后一份为准。
    pub fn shared(documents: impl IntoIterator<Item = Arc<FrozenDocument>>) -> Documents {
        Documents {
            by_id: documents.into_iter().map(|d| (d.document_id.clone(), d)).collect(),
        }
    }

    pub fn get(&self, id: &str) -> Option<&FrozenDocument> {
        self.by_id.get(id).map(Arc::as_ref).filter(|d| !d.body.is_null())
    }
}
