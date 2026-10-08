//! `videos.readContent`：Space 内容索引（架构设计 §5.11）用的只读查询。已经打开的视频用打开的那一份；
//! 没有打开的以只读方式打开，不取写锁，读完就放下。
//!
//! 返回视频快照（素材、序列、标记），以及文字类文档（转写、字幕、译文）的当前正文；转写与字幕另带在根序列上的
//! 时间线投影（与导出、预览同一个 `plan_text`），投影不出来时带原因，由 Runtime 退回到源时间。

use render_graph::VideoView;
use render_graph::text_plan::plan_text;
use serde_json::{Value, json};
use video_engine::Video;

const SPEECH_SCHEMA: &str = "baocut.speech/1";
const CAPTION_SCHEMA: &str = "baocut.caption/1";
/// 译文：`/2` 是现行格式，`/1` 是旧项目导入的只读兼容（视频格式规范 §5.3）。
const TRANSLATION_SCHEMAS: [&str; 2] = ["baocut.translation/2", "baocut.translation/1"];
const TEXT_KINDS: [&str; 3] = ["speech", "caption", "translation"];

pub fn read(video: &Video) -> Value {
    let snapshot = video.snapshot();
    let view = VideoView::from(&snapshot);
    let root = snapshot.root_sequence_id.clone();
    let mut documents = Vec::new();
    for (id, record) in &snapshot.documents {
        if !TEXT_KINDS.contains(&record.kind.as_str()) {
            continue;
        }
        let content = match video.document(id, None) {
            Ok(content) => content,
            Err(error) => {
                let mut entry = json!({ "documentId": id, "kind": record.kind, "error": error.message });
                if let Some(error_ref) = error.message_ref {
                    entry["errorRef"] = json!(error_ref);
                }
                documents.push(entry);
                continue;
            }
        };
        let schema = content.body.get("schema").and_then(Value::as_str).unwrap_or_default().to_string();
        let text = schema == SPEECH_SCHEMA || schema == CAPTION_SCHEMA || TRANSLATION_SCHEMAS.contains(&schema.as_str());
        let mut entry = json!({
            "documentId": id,
            "kind": record.kind,
            "name": record.name,
            "language": record.language,
            "revision": content.revision,
            "schema": schema,
            "sourceAssetId": record.source_asset_id,
            "sourceDocumentId": record.source_document_id,
            "body": if text { content.body.clone() } else { Value::Null },
            "plan": Value::Null,
        });
        if schema == SPEECH_SCHEMA || schema == CAPTION_SCHEMA {
            match plan_text(view, &root, &content.document, &content.body, &[], None) {
                Ok(plan) => entry["plan"] = serde_json::to_value(&plan).expect("能序列化"),
                Err(error) => entry["planError"] = json!({ "code": error.code, "message": error.message }),
            }
        }
        documents.push(entry);
    }
    json!({
        "videoId": snapshot.id,
        "name": snapshot.name,
        "revision": snapshot.revision,
        "snapshot": snapshot,
        "documents": documents,
    })
}
