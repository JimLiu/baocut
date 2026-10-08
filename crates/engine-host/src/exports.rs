//! `exports.plan`：导出启动时的冻结（架构设计 §9.11）。在一次请求里读当前的视频快照、要用的文档正文与素材位置，
//! 求出声音的区间计划或文字的时间线投影（`render-graph`，与预览同一个实现）。引擎宿主按顺序处理请求，
//! 所以这一份结果对应同一个视频版本；之后的编辑不影响已经冻结的导出。

use std::collections::{BTreeMap, BTreeSet};

use editor_semantics::Ratio;
use message_ref::{Text, msg};
use render_graph::VideoView;
use render_graph::audio_plan::{plan_audio_with_speech, speaker_activity, speech_activity};
use render_graph::text_plan::plan_text;
use render_graph::video_plan::{output_geometry, plan_video};
use serde::Deserialize;
use serde_json::{Value, json};
use video_engine::error::kinds;
use video_engine::model::{AssetStorage, DocumentRecord, Id, TimelineItem};
use video_engine::video::DocumentContent;
use video_engine::{ErrorBody, Retryability, Video};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanParams {
    pub video_id: Id,
    /// `audio`：声音的区间计划；`text`：文档的时间线投影；`video`：成片要冻结的序列、素材与文档，以及每段的画面概览与声音计划。
    kind: String,
    #[serde(default)]
    sequence_id: Option<Id>,
    /// 序列时间的秒数 `[start, end)`，每段各出一份计划（`parts`，同一个视频版本）；空时是整条序列。
    #[serde(default)]
    ranges: Vec<RangeParams>,
    /// `text` 用：第一份是主文档，第二份（可选）是双语合并的另一种语言。
    #[serde(default)]
    document_ids: Vec<Id>,
    /// `text` 用：只经这些实例投影。
    #[serde(default)]
    scope_item_ids: Vec<Id>,
    /// `audio` 与 `video` 用：只这一次的声音计划里停用或取消静音哪些实例（例如只要原声、只要一组配音，架构设计 §9.13）。
    /// `video` 的画面计划与冻结的序列（`document`）不受影响；视频不变。
    #[serde(default)]
    audio_items: Option<AudioItemSelection>,
    /// `video` 用：要的输出宽高（像素，都可以不给）。计划的 `output` 是定下的输出尺寸与画面在其中的位置
    /// （`render_graph::video_plan::output_geometry`）。
    #[serde(default)]
    output: Option<OutputParams>,
    /// `video` 用：不冻结素材（`assets` 为空，不看文件在不在、变没变）。清点字体（`fonts.usage`）只排文字与字幕，
    /// 用不到素材；缺素材的视频照样清点。
    #[serde(default)]
    skip_assets: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OutputParams {
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
}

/// 声音计划里改用的实例：`disable` 当作停用（不发声，也不触发闪避），`unmute` 当作没有静音（音频实例的 `mix.muted`、
/// 视频实例的内嵌音频）。哪些实例由调用方按视频里的标记决定；序列里没有的 ID 忽略。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AudioItemSelection {
    #[serde(default)]
    disable: Vec<Id>,
    #[serde(default)]
    unmute: Vec<Id>,
}

/// 在快照的这条序列上套用实例的选择（只影响这一次计划）。
fn select_audio_items(items: &mut [TimelineItem], selection: &AudioItemSelection) {
    for item in items {
        let id = item.base().id.clone();
        if selection.unmute.contains(&id) {
            match item {
                TimelineItem::Audio(a) => a.mix.muted = false,
                TimelineItem::Video(v) => v.embedded_audio.enabled = true,
                _ => {}
            }
        }
        if selection.disable.contains(&id) {
            item.base_mut().enabled = false;
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RangeParams {
    start: f64,
    end: f64,
}

const MAX_RANGES: usize = 64;
const SPEECH_SCHEMA: &str = "baocut.speech/1";

/// 译文正文（视频格式规范 §5.3）：`/2` 是规范的格式，翻译流程写它；`/1` 是旧项目导入的格式，只读兼容。
/// 两者都没有时间，不能当主文档投影，只随主文档带上正文，由导出按句子 ID 配。
fn is_translation(schema: &str) -> bool {
    matches!(schema, "baocut.translation/1" | "baocut.translation/2")
}

/// 源时钟可以来自文档的来源链（格式规范 §4.6），包括字幕 → 译文 → 转写。
fn source_asset(documents: &BTreeMap<Id, DocumentRecord>, id: &str) -> Option<Id> {
    let mut current = id;
    let mut visited = BTreeSet::new();
    while visited.insert(current) {
        let document = documents.get(current)?;
        if let Some(asset) = &document.source_asset_id {
            return Some(asset.clone());
        }
        current = document.source_document_id.as_deref()?;
    }
    None
}

fn invalid(code: &str, message: impl Into<Text>) -> ErrorBody {
    ErrorBody::new(code, message, Retryability::Never)
}

/// 秒 → 微秒精度的有理数（与交互预览的入口相同的取整）。
fn seconds(value: f64, field: &str) -> Result<Ratio, ErrorBody> {
    if !value.is_finite() || value < 0.0 {
        return Err(invalid(
            "EXPORT_RANGE_EMPTY",
            msg!("engineHost.secondsInvalid", "{field} must be a finite number of seconds, at least 0", field),
        ));
    }
    Ratio::new((value * 1_000_000.0).round() as i128, 1_000_000)
        .ok_or_else(|| invalid(
                "TIME_ARITHMETIC_OVERFLOW",
                msg!("engineHost.secondsOverflow", "{field} is out of range", field),
            ))
}

fn plan_error(error: render_graph::PlanError) -> ErrorBody {
    invalid(&error.code, error.message)
}

pub fn plan(video: &Video, value: PlanParams) -> Result<Value, ErrorBody> {
    let snapshot = video.snapshot();
    let sequence_id = value.sequence_id.clone().unwrap_or_else(|| snapshot.root_sequence_id.clone());
    // 声音计划用的序列：套用了实例的选择的副本（只影响这一次的声音，画面与冻结的序列照原样）。
    let audio_sequences = match &value.audio_items {
        Some(_) if value.kind != "audio" && value.kind != "video" => {
            return Err(invalid(
                "INVALID_PARAMS",
                msg!("engineHost.audioItemsKind", "audioItems is only for audio and video plans"),
            ));
        }
        Some(selection) => {
            let mut sequences = snapshot.sequences.clone();
            if let Some(sequence) = sequences.get_mut(&sequence_id) {
                select_audio_items(&mut sequence.items, selection);
            }
            Some(sequences)
        }
        None => None,
    };
    if value.skip_assets && value.kind != "video" {
        return Err(invalid(
            "INVALID_PARAMS",
            msg!("engineHost.skipAssetsKind", "skipAssets is only for video plans"),
        ));
    }
    if let Some(output) = &value.output {
        if value.kind != "video" {
            return Err(invalid(
                "INVALID_PARAMS",
                msg!("engineHost.outputKind", "output is only for video plans"),
            ));
        }
        if output.width == Some(0) || output.height == Some(0) {
            return Err(invalid(
                "INVALID_PARAMS",
                msg!("engineHost.outputSize", "The output width and height must be positive integers"),
            ));
        }
    }
    let sequence = snapshot
        .sequences
        .get(&sequence_id)
        .ok_or_else(|| ErrorBody::not_found(kinds::sequence(), &sequence_id))?;
    if value.ranges.len() > MAX_RANGES {
        return Err(invalid(
            "INVALID_PARAMS",
            msg!("engineHost.tooManyRanges", "At most {max} ranges at a time", max = MAX_RANGES),
        ));
    }
    let mut ranges: Vec<Option<(Ratio, Ratio)>> = Vec::new();
    for r in &value.ranges {
        ranges.push(Some((seconds(r.start, "range.start")?, seconds(r.end, "range.end")?)));
    }
    if ranges.is_empty() {
        ranges.push(None);
    }
    let view = VideoView::from(&snapshot);
    let audio_view = match &audio_sequences {
        Some(sequences) => VideoView {
            sequences,
            assets: &snapshot.assets,
        },
        None => view,
    };
    let mut result = json!({
        "videoId": snapshot.id,
        "videoName": snapshot.name,
        "videoRevision": snapshot.revision,
        "sequenceId": sequence.id,
        "sequenceRevision": sequence.revision,
        "fps": sequence.header.fps,
        "canvas": { "width": sequence.header.canvas.width, "height": sequence.header.canvas.height },
    });
    // 按文稿触发的闪避（视频格式规范 §3.9）：触发区间是整条序列上的有效词流，各段范围共用。
    let transcripts = match value.kind.as_str() {
        "audio" | "video" => speech_documents(video, &snapshot)?,
        _ => Vec::new(),
    };
    let transcript_pairs: Vec<_> = transcripts.iter().map(|c| (&c.document, &c.body)).collect();
    let speech = if transcript_pairs.is_empty() {
        Vec::new()
    } else {
        speech_activity(view, &sequence_id, &transcript_pairs).map_err(plan_error)?
    };
    match value.kind.as_str() {
        "audio" => {
            let mut parts = Vec::new();
            let mut assets = Vec::new();
            let mut seen: Vec<(String, String)> = Vec::new();
            for range in ranges {
                let plan = plan_audio_with_speech(audio_view, &sequence_id, range, &speech).map_err(plan_error)?;
                for segment in &plan.segments {
                    let key = (segment.asset.id.clone(), segment.asset.revision.clone());
                    if seen.contains(&key) {
                        continue;
                    }
                    assets.push(asset_entry(video, &snapshot, &key.0, &key.1)?);
                    seen.push(key);
                }
                parts.push(json!({ "audio": plan }));
            }
            result["parts"] = Value::Array(parts);
            result["assets"] = Value::Array(assets);
        }
        "text" => {
            let Some(primary) = value.document_ids.first() else {
                return Err(invalid(
                    "INVALID_PARAMS",
                    msg!("engineHost.textPlanNoDocument", "A text plan needs at least one document"),
                ));
            };
            if value.document_ids.len() > 2 {
                return Err(invalid(
                    "INVALID_PARAMS",
                    msg!(
                        "engineHost.textPlanTooManyDocuments",
                        "A text plan takes at most two documents (the main one and the other one of a bilingual merge)"
                    ),
                ));
            }
            let mut contents = Vec::new();
            let mut documents = Vec::new();
            for document_id in &value.document_ids {
                let mut content = video.document(document_id, None)?;
                content.document.source_asset_id = source_asset(&snapshot.documents, document_id);
                let schema = content.body.get("schema").and_then(Value::as_str).unwrap_or_default().to_string();
                documents.push(json!({
                    "documentId": content.document.id,
                    "kind": content.document.kind,
                    "name": content.document.name,
                    "language": content.document.language,
                    "revision": content.revision,
                    "sourceAssetId": content.document.source_asset_id,
                    "sourceDocumentId": content.document.source_document_id,
                    "schema": schema,
                    // 译文没有时间：原样带上，由导出按句子 ID 配到主文档的句子上。转写也带上正文：句子的成员与说话人的名字
                    // （时间一律用 `parts` 里的投影，不用正文里的源时间）。
                    "body": if is_translation(&schema) || schema == SPEECH_SCHEMA { content.body.clone() } else { Value::Null },
                }));
                contents.push((schema, content));
            }
            let mut parts = Vec::new();
            for range in ranges {
                let mut plans = Vec::new();
                for (schema, content) in &contents {
                    if is_translation(schema) && &content.document.id != primary {
                        plans.push(Value::Null);
                        continue;
                    }
                    let plan = plan_text(view, &sequence_id, &content.document, &content.body, &value.scope_item_ids, range)
                        .map_err(plan_error)?;
                    plans.push(serde_json::to_value(&plan).expect("能序列化"));
                }
                parts.push(json!({ "plans": plans }));
            }
            result["documents"] = Value::Array(documents);
            result["parts"] = Value::Array(parts);
            // ASS 用：显示主文档的第一个字幕实例的样式文档。
            let style_id = sequence.items.iter().find_map(|item| match item {
                TimelineItem::Caption(c) if &c.document_id == primary => c.style_document_id.clone(),
                _ => None,
            });
            result["style"] = match style_id {
                Some(id) => match video.document(&id, None) {
                    Ok(style) => json!({ "documentId": id, "revision": style.revision, "body": style.body }),
                    Err(_) => Value::Null,
                },
                None => Value::Null,
            };
        }
        "video" => {
            let mut parts = Vec::new();
            let mut refs: Vec<(String, String)> = Vec::new();
            let mut document_ids: Vec<Id> = Vec::new();
            for range in ranges {
                let picture = plan_video(view, &sequence_id, range).map_err(plan_error)?;
                let audio = plan_audio_with_speech(audio_view, &sequence_id, range, &speech).map_err(plan_error)?;
                let used = picture.assets.iter().chain(audio.segments.iter().map(|s| &s.asset));
                for asset in used {
                    let key = (asset.id.clone(), asset.revision.clone());
                    if !refs.contains(&key) {
                        refs.push(key);
                    }
                }
                for id in &picture.documents {
                    if !document_ids.contains(id) {
                        document_ids.push(id.clone());
                    }
                }
                parts.push(json!({ "video": picture, "audio": audio }));
            }
            // 声波听的是整条序列的声音（格式规范 §3.7），声音段可以在导出范围之外：这些素材也冻结，导出时算它们的频谱。
            if sequence.items.iter().any(|item| matches!(item, TimelineItem::Visualizer(_))) {
                let whole = render_graph::audio_plan::plan_audio(view, &sequence_id, None).map_err(plan_error)?;
                for segment in &whole.segments {
                    let key = (segment.asset.id.clone(), segment.asset.revision.clone());
                    if !refs.contains(&key) {
                        refs.push(key);
                    }
                }
            }
            let mut assets = Vec::new();
            if !value.skip_assets {
                for (id, revision) in &refs {
                    assets.push(asset_entry(video, &snapshot, id, revision)?);
                }
            }
            // 逐帧求计划要的那部分视频（`PlanDocument`）：这条序列与它引用的素材记录。
            let mut records = serde_json::Map::new();
            for item in &sequence.items {
                for asset in item.asset_refs() {
                    if let Some(record) = snapshot.assets.get(&asset.id) {
                        records.insert(asset.id.clone(), serde_json::to_value(record).expect("能序列化"));
                    }
                }
            }
            result["document"] = json!({
                "rootSequenceId": sequence_id,
                "sequences": { sequence_id.clone(): sequence },
                "assets": records,
            });
            // 字幕的词所在的转写（字幕文档头的 `sourceDocumentId` 指向的 `speech` 文档）一起冻结，逐词动画与强调按它推进。
            let transcripts_used: Vec<Id> = document_ids
                .iter()
                .filter_map(|id| snapshot.documents.get(id)?.source_document_id.clone())
                .filter(|parent| snapshot.documents.get(parent).is_some_and(|record| record.kind == "speech"))
                .collect();
            for id in transcripts_used {
                if !document_ids.contains(&id) {
                    document_ids.push(id);
                }
            }
            result["documents"] = Value::Array(document_ids.iter().map(|id| caption_document(video, &snapshot, id)).collect());
            result["assets"] = Value::Array(assets);
            result["parts"] = Value::Array(parts);
            let (width, height) = value.output.as_ref().map_or((None, None), |o| (o.width, o.height));
            let canvas = &sequence.header.canvas;
            result["output"] = serde_json::to_value(output_geometry(canvas.width, canvas.height, width, height)).expect("能序列化");
            // 写了 `speaker` 的声波（格式规范 §3.7）：各说话人在整条序列上说话的区间，与预览同一个求法。视频里没有转写时不给，
            // 导出按没有转写画（静音并报提示）。
            let speaker_visualizer = sequence.items.iter().any(|item| match item {
                TimelineItem::Visualizer(v) => v.visualizer.speaker.as_deref().is_some_and(|s| !s.is_empty()),
                _ => false,
            });
            if speaker_visualizer && !transcript_pairs.is_empty() {
                let speakers = speaker_activity(view, &sequence_id, &transcript_pairs).map_err(plan_error)?;
                result["speakers"] = serde_json::to_value(speakers).expect("能序列化");
            }
        }
        other => return Err(invalid(
                "INVALID_PARAMS",
                msg!("engineHost.planKindUnknown", "Unknown plan kind {kind}", kind = other),
            )),
    }
    Ok(result)
}

/// 视频里每份转写文档（`kind: speech`）的当前正文：投到序列上就是有效词流（闪避的触发区间、声波的说话人）。
fn speech_documents(video: &Video, snapshot: &video_engine::model::VideoSnapshot) -> Result<Vec<DocumentContent>, ErrorBody> {
    let mut contents = Vec::new();
    for (id, record) in &snapshot.documents {
        if record.kind == "speech" {
            contents.push(video.document(id, None)?);
        }
    }
    Ok(contents)
}

/// 字幕要读的文档（字幕文档、样式文档或字幕的词所在的转写）的冻结正文。`lineKind` 是字幕行的种类：派生自译文的字幕
/// 是译文行，其余是原文行（与预览的判断相同）。文档头的 `sourceDocumentId`、`sourceAssetId` 照抄（字幕取词用）。
/// 文档不在了时正文为 `null`，由导出的预检报出来。
fn caption_document(video: &Video, snapshot: &video_engine::model::VideoSnapshot, id: &Id) -> Value {
    let record = snapshot.documents.get(id);
    let parent_kind = record
        .and_then(|r| r.source_document_id.as_ref())
        .and_then(|parent| snapshot.documents.get(parent))
        .map(|parent| parent.kind.as_str());
    let content = video.document(id, None).ok();
    json!({
        "documentId": id,
        "kind": record.map(|r| r.kind.clone()),
        "revision": content.as_ref().map(|c| c.revision.clone()),
        "schema": content.as_ref().and_then(|c| c.body.get("schema")).and_then(Value::as_str),
        "lineKind": if parent_kind == Some("translation") { "translation" } else { "original" },
        "sourceDocumentId": record.and_then(|r| r.source_document_id.clone()),
        "sourceAssetId": source_asset(&snapshot.documents, id),
        "body": content.map(|c| c.body),
    })
}

/// 一个素材版本的冻结信息：位置、存储方式与指纹。文件不在或大小变了时按引擎的 `ASSET_MISSING` 报。
fn asset_entry(video: &Video, snapshot: &video_engine::model::VideoSnapshot, asset_id: &str, revision: &str) -> Result<Value, ErrorBody> {
    let resolved = video.resolve_asset(asset_id, Some(revision))?;
    let record = snapshot
        .assets
        .get(asset_id)
        .and_then(|asset| asset.revisions.get(revision))
        .ok_or_else(|| ErrorBody::asset_missing(
            asset_id,
            msg!("engine.assetRevisionMissing", "The asset has no revision {revision}", revision),
        ))?;
    let modified_at = match &record.storage {
        AssetStorage::Linked { locator, .. } => locator.modified_at.clone(),
        AssetStorage::Managed => None,
    };
    Ok(json!({
        "assetId": asset_id,
        "revision": revision,
        "name": resolved.name,
        "path": resolved.path,
        "storage": resolved.storage,
        "mediaType": record.media_type,
        "contentHash": record.content_hash,
        "byteLength": record.byte_length,
        "modifiedAt": modified_at,
        "audio": record.audio,
        "video": record.video,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_clock_follows_document_ancestry_and_stops_at_direct_assets() {
        let record = |id: &str, parent: Option<&str>, asset: Option<&str>| {
            serde_json::from_value(json!({ "id": id, "kind": "caption", "name": id,
                "sourceDocumentId": parent, "sourceAssetId": asset, "currentRevision": "1", "revisions": {} }))
            .unwrap()
        };
        let mut documents = BTreeMap::from([
            ("speech".into(), record("speech", None, Some("media"))),
            ("translation".into(), record("translation", Some("speech"), None)),
            ("caption".into(), record("caption", Some("translation"), None)),
        ]);
        assert_eq!(source_asset(&documents, "caption"), Some("media".into()));
        documents.insert("caption".into(), record("caption", Some("translation"), Some("override")));
        assert_eq!(source_asset(&documents, "caption"), Some("override".into()));
        documents.insert("caption".into(), record("caption", Some("missing"), None));
        assert_eq!(source_asset(&documents, "caption"), None);
        documents.insert("caption".into(), record("caption", Some("translation"), None));
        documents.insert("speech".into(), record("speech", Some("caption"), None));
        assert_eq!(source_asset(&documents, "caption"), None);
    }

    #[test]
    fn both_translation_schemas_ride_along_with_the_primary() {
        assert!(is_translation("baocut.translation/1"));
        assert!(is_translation("baocut.translation/2"));
        assert!(!is_translation("baocut.translation/3"));
        assert!(!is_translation(SPEECH_SCHEMA));
    }
}
