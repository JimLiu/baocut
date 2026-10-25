//! 文档局部编辑：正文只在引擎里读取和写版本，客户端提交变化的字段。
use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::{EngineResult, ErrorBody, kinds, msg};
use crate::ops::{EditContext, PutDocumentInput, put_document};
use crate::state::VideoState;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PathPart {
    Field(String),
    Entry(EntryId),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EntryId {
    pub id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DocumentChange {
    pub path: Vec<PathPart>,
    // A JSON null is a value, distinct from the absence of value.
    #[serde(flatten)]
    pub action: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpeakerName {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WordText {
    pub id: String,
    pub text: String,
}

fn invalid(reason: &str) -> ErrorBody {
    ErrorBody::invalid_operation(msg!("engine.documentPatchInvalid", "The document change is invalid"))
        .details(json!({ "rule": "document-change", "reason": reason }))
}

fn body_of(state: &VideoState, id: &str, ctx: &EditContext<'_>) -> EngineResult<Value> {
    state.documents.get(id).ok_or_else(|| ErrorBody::not_found(kinds::document(), id))?;
    if let Some(body) = ctx.documents.iter().rev().find(|d| d.document_id == id) {
        return serde_json::from_str(&body.body).map_err(|_| invalid("body-unreadable"));
    }
    ctx.document_bodies.get(id).cloned().ok_or_else(|| invalid("body-unavailable"))
}

fn target<'a>(mut value: &'a mut Value, path: &[PathPart]) -> EngineResult<&'a mut Value> {
    for part in path {
        value = match part {
            PathPart::Field(key) => value
                .as_object_mut()
                .and_then(|m| m.get_mut(key))
                .ok_or_else(|| invalid("path-missing"))?,
            PathPart::Entry(entry) => {
                let entries = value.as_array_mut().ok_or_else(|| invalid("selector-needs-array"))?;
                let indices: Vec<_> = entries
                    .iter()
                    .enumerate()
                    .filter(|(_, v)| v.get("id").and_then(Value::as_str) == Some(entry.id.as_str()))
                    .map(|(i, _)| i)
                    .collect();
                if indices.len() != 1 {
                    return Err(invalid("entry-id-missing-or-ambiguous").entities([entry.id.clone()]));
                }
                &mut entries[indices[0]]
            }
        };
    }
    Ok(value)
}

pub(crate) fn patch_document(
    state: &mut VideoState,
    id: &str,
    changes: &[DocumentChange],
    summary: Option<&Value>,
    ctx: &mut EditContext<'_>,
) -> EngineResult<()> {
    if changes.is_empty() {
        return Err(invalid("empty-changes"));
    }
    let original = body_of(state, id, ctx)?;
    let mut body = original.clone();
    let mut paths = BTreeSet::new();
    for change in changes {
        let Some((last, parents)) = change.path.split_last() else {
            return Err(invalid("empty-path"));
        };
        if !paths.insert(serde_json::to_string(&change.path).unwrap()) {
            return Err(invalid("duplicate-path"));
        }
        let value = change.action.get("value");
        let remove = change.action.get("remove") == Some(&Value::Bool(true));
        let move_before = change.action.get("moveBefore");
        if usize::from(value.is_some()) + usize::from(remove) + usize::from(move_before.is_some()) != 1
            || change
                .action
                .keys()
                .any(|key| !matches!(key.as_str(), "value" | "remove" | "moveBefore" | "beforeId"))
            || (change.action.contains_key("beforeId") && value.is_none())
            || (change.action.contains_key("remove") && !remove)
        {
            return Err(invalid("invalid-action"));
        }
        let parent = target(&mut body, parents)?;
        match last {
            PathPart::Field(key) => {
                // 只有数组条目的 `id` 是身份；普通对象里的 `id`（如样式的 `stylePreset.id`）是一般字段。
                if key == "id" && matches!(parents.last(), Some(PathPart::Entry(_))) {
                    return Err(invalid("identity-change"));
                }
                if move_before.is_some() || change.action.contains_key("beforeId") {
                    return Err(invalid("position-needs-id"));
                }
                let object = parent.as_object_mut().ok_or_else(|| invalid("field-needs-object"))?;
                if remove {
                    if object.remove(key).is_none() {
                        return Err(invalid("field-missing"));
                    }
                } else {
                    object.insert(key.clone(), value.unwrap().clone());
                }
            }
            PathPart::Entry(entry) => {
                let entries = parent.as_array_mut().ok_or_else(|| invalid("selector-needs-array"))?;
                let indices: Vec<_> = entries
                    .iter()
                    .enumerate()
                    .filter(|(_, v)| v.get("id").and_then(Value::as_str) == Some(entry.id.as_str()))
                    .map(|(i, _)| i)
                    .collect();
                if indices.len() > 1 {
                    return Err(invalid("entry-id-ambiguous"));
                }
                let index = indices.first().copied();
                if remove {
                    let index = index.ok_or_else(|| invalid("entry-id-missing"))?;
                    entries.remove(index);
                    continue;
                }
                let position = move_before.or_else(|| change.action.get("beforeId"));
                let before = match position {
                    None | Some(Value::Null) => None,
                    Some(Value::String(id)) if id != &entry.id => Some(id),
                    _ => return Err(invalid("invalid-position")),
                };
                let replacement = if let Some(value) = value {
                    if !value.is_object() || value.get("id").and_then(Value::as_str) != Some(entry.id.as_str()) {
                        return Err(invalid("identity-change"));
                    }
                    if index.is_none() && position.is_none() {
                        return Err(invalid("new-entry-needs-position"));
                    }
                    value.clone()
                } else {
                    entries[index.ok_or_else(|| invalid("entry-id-missing"))?].clone()
                };
                if let Some(index) = index {
                    if position.is_none() {
                        entries[index] = replacement;
                        continue;
                    }
                    entries.remove(index);
                }
                let destination = match before {
                    None => entries.len(),
                    Some(id) => {
                        let matches: Vec<_> = entries
                            .iter()
                            .enumerate()
                            .filter(|(_, v)| v.get("id").and_then(Value::as_str) == Some(id))
                            .map(|(i, _)| i)
                            .collect();
                        if matches.len() != 1 {
                            return Err(invalid("position-id-missing-or-ambiguous"));
                        }
                        matches[0]
                    }
                };
                entries.insert(destination, replacement);
            }
        }
    }
    // 与 Runtime 的全文译文写入一致：改过的自然译句同步句级摘要；块级对应保留旧摘要供失效判断。改过的自然译句不再是
    // 翻译记忆沿用的译文，去掉 `reuse`（视频格式规范 §5.3）。
    if state.documents[id].kind == "translation"
        && body.get("schema").and_then(Value::as_str) == Some(video_model::translation::TRANSLATION_SCHEMA)
        && let Some(units) = body.get_mut("units").and_then(Value::as_array_mut)
    {
        let previous: BTreeMap<_, _> = original
            .get("units")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|u| Some((u.get("id")?.as_str()?, u.get("naturalText")?.as_str()?)))
            .collect();
        for unit in units {
            let Some(text) = unit.get("naturalText").and_then(Value::as_str) else {
                continue;
            };
            if unit.get("id").and_then(Value::as_str).and_then(|id| previous.get(id)).copied() == Some(text) {
                continue;
            }
            let text = text.to_owned();
            if let Some(object) = unit.as_object_mut() {
                object.remove("reuse");
            }
            if unit.get("status").and_then(Value::as_str) == Some("stale") || text.trim().is_empty() {
                continue;
            }
            let hash = crate::video::sha256_text(&text);
            if let Some(alignment) = unit.get_mut("alignment").and_then(Value::as_object_mut) {
                let sentence_level = alignment.get("correspondence").and_then(Value::as_str) == Some("sentence")
                    && alignment.get("blocks").and_then(Value::as_array).is_some_and(Vec::is_empty)
                    && !alignment.contains_key("split");
                if sentence_level || !alignment.get("textHash").is_some_and(Value::is_string) {
                    alignment.insert("textHash".into(), json!(hash));
                }
            }
        }
    }
    let record = state.documents[id].clone();
    let previous_summary = record.revisions[&record.current_revision].summary.as_ref();
    put_document(
        state,
        PutDocumentInput {
            document_id: Some(id),
            reference: None,
            kind: &record.kind,
            name: None,
            language: None,
            source_asset: None,
            source_document: None,
            body: &body,
            summary: summary.or(previous_summary),
            extensions: &Default::default(),
        },
        ctx,
    )
}

fn speech(state: &VideoState, id: &str, ctx: &EditContext<'_>) -> EngineResult<()> {
    let body = body_of(state, id, ctx)?;
    if state.documents[id].kind != "speech" || body.get("schema").and_then(Value::as_str) != Some(video_model::speech::SPEECH_SCHEMA) {
        return Err(invalid("speech-required"));
    }
    Ok(())
}

pub(crate) fn rename_speakers(state: &mut VideoState, id: &str, speakers: &[SpeakerName], ctx: &mut EditContext<'_>) -> EngineResult<()> {
    speech(state, id, ctx)?;
    if speakers.iter().any(|s| s.name.trim().is_empty() || s.name.chars().count() > 200) {
        return Err(invalid("speaker-name-length"));
    }
    let changes = speakers
        .iter()
        .map(|s| DocumentChange {
            path: vec![
                PathPart::Field("speakers".into()),
                PathPart::Entry(EntryId { id: s.id.clone() }),
                PathPart::Field("name".into()),
            ],
            action: [("value".into(), json!(s.name.trim()))].into(),
        })
        .collect::<Vec<_>>();
    patch_document(state, id, &changes, None, ctx)
}

pub(crate) fn update_words(state: &mut VideoState, id: &str, words: &[WordText], ctx: &mut EditContext<'_>) -> EngineResult<()> {
    speech(state, id, ctx)?;
    let changes = words
        .iter()
        .map(|w| DocumentChange {
            path: vec![
                PathPart::Field("words".into()),
                PathPart::Entry(EntryId { id: w.id.clone() }),
                PathPart::Field("text".into()),
            ],
            action: [("value".into(), json!(w.text))].into(),
        })
        .collect::<Vec<_>>();
    patch_document(state, id, &changes, None, ctx)
}
