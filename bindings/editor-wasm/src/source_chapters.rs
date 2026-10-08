//! 来源自带章节的解析与吸附（架构设计 §3.5、§7.9）：从链接导入的素材在 `provenance.source` 里带着平台给的章节
//! （`chapters[]`）与简介（`description`，里面常有时间戳大纲），智能体的 `chapters_adopt` 与 `videos_inspect` 用这里的
//! 同一份规则（`speech_doc::source_chapters`，从旧版本原样移植）。
//!
//! - 来源章节：显式大纲（`outline`，数组或原文）优先；否则读来源元数据，先取结构化 `chapters[]`（认 `start_time|start`、
//!   `end_time|end`、`title`），没有再从 `description` 解析时间戳大纲（至少两条）。清洗：丢空标题与非法时间、排序、同起点去重、
//!   截条数。
//! - 吸附：作者的时间戳最多精确到秒，常比真正的话题起点早几秒，把每条吸到转写最近的结构起点（段落 > 句 > cue > 词）：
//!   同一秒窗 `[t-1, t+2]`（含两端）依次找段落、句、cue 起点，同层只有一个候选是 `matched`，多个是 `ambiguous`（缺省取
//!   最近的，同距离取时间戳之后的）；没有时放宽到 `[t-4, t+6]`，只认段落与句起点、取最近的（`snapped`）；再没有时找同一秒窗里的
//!   词起点；都没有时保留原时间（`unanchored`）。
//! - 行：按时间版的确定性清洗（`resolve_rows`）出最终的章节：丢空标题、按起点排序、同起点去重、首章钳到 0、丢非严格递增，
//!   终点回填为下一章的起点，末章为 `durationSeconds`。
//!
//! 时间都是素材（源）时间的秒；投影到时间线由宿主做。没有来源章节时返回空的结果，不报错（错误码由宿主决定）。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use speech_doc::source_chapters::{
    Anchor, AnchorTier, SnapPlan, SnapStatus, SourceChapter, doc_anchors, from_metadata, normalize, parse_description, resolve_rows,
    snap_to_anchors,
};
use speech_doc_bridge::{V3Documents, to_transcript_doc};
use video_model::speech::SpeechBody;

use crate::speakers::media_for;
use crate::{EntryError, invalid_input};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceChaptersInput {
    /// 素材的转写正文；没有转写（或 `snap: false`）时省略，所有条目按原时间（`unanchored`）。
    #[serde(default)]
    speech: Option<SpeechBody>,
    /// 素材的来源元数据（`provenance.source`）。
    #[serde(default)]
    source: Option<Value>,
    /// 显式大纲，优先于 `source`：`[{ at, title }]`，或一段原文（按简介的时间戳大纲解析）。
    #[serde(default)]
    outline: Option<Outline>,
    /// 素材时长（秒）：末章的终点。
    duration_seconds: f64,
    /// 默认 true；false 时只解析、不吸附。
    #[serde(default)]
    snap: Option<bool>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Outline {
    Rows(Vec<OutlineRow>),
    Text(String),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OutlineRow {
    at: f64,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceChaptersOutput {
    source_chapters: Vec<SourceChapter>,
    entries: Vec<EntryOutput>,
    rows: Vec<RowOutput>,
    summary: SummaryOutput,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EntryOutput {
    source: SourceRef,
    status: SnapStatus,
    /// 吸附后的起点（源时间秒）；`unanchored` 时就是作者的原时间。
    at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    anchor: Option<AnchorOutput>,
    candidates: Vec<AnchorOutput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceRef {
    start: f64,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnchorOutput {
    tier: AnchorTier,
    id: String,
    time: f64,
    snippet: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RowOutput {
    title: String,
    start: f64,
    end: f64,
    status: SnapStatus,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct SummaryOutput {
    entries: usize,
    matched: usize,
    ambiguous: usize,
    snapped: usize,
    unanchored: usize,
}

fn anchor_output(anchor: &Anchor) -> AnchorOutput {
    AnchorOutput {
        tier: anchor.tier,
        id: anchor.id.clone(),
        time: anchor.time,
        snippet: anchor.snippet.clone(),
    }
}

/// 来源章节：显式大纲优先，其次来源元数据。
fn chapters_of(input: &SourceChaptersInput) -> Vec<SourceChapter> {
    match &input.outline {
        Some(Outline::Rows(rows)) => normalize(
            rows.iter()
                .map(|row| SourceChapter {
                    start: row.at,
                    end: None,
                    title: row.title.clone(),
                })
                .collect(),
        ),
        Some(Outline::Text(text)) => parse_description(text),
        None => input.source.as_ref().map(from_metadata).unwrap_or_default(),
    }
}

/// 转写的四层锚点；没有转写或不吸附时为空。
fn anchors_of(input: &SourceChaptersInput) -> Result<Vec<Anchor>, EntryError> {
    let Some(speech) = input.speech.as_ref().filter(|_| input.snap != Some(false)) else {
        return Ok(Vec::new());
    };
    // 时长取末词的终点（核心的校验要求词不越出时长）；素材时长只用于末章的终点。
    let media = media_for(speech);
    let doc = to_transcript_doc(&V3Documents {
        media: &media,
        language: None,
        speech,
        translations: &[],
    })
    .map_err(|error| EntryError {
        code: "INVALID_SPEECH",
        message: error.message,
    })?;
    Ok(doc_anchors(&doc))
}

/// 一行清洗后的章节对应哪一条：首行的起点被钳到 0，按标题取起点最早的那条；其余按（标题, 起点）对上。
fn row_status(plan: &SnapPlan, index: usize, title: &str, start: f64) -> SnapStatus {
    let mut same_title = plan.entries.iter().filter(|entry| entry.source.title.trim() == title);
    let entry = if index == 0 {
        same_title.min_by(|a, b| a.start().total_cmp(&b.start()))
    } else {
        same_title.find(|entry| entry.start() == start)
    };
    entry.map_or(SnapStatus::Unanchored, |entry| entry.status)
}

/// 来源章节的解析与吸附（JSON）。输入读不懂是 `INVALID_INPUT`；转写正文不合格式是 `INVALID_SPEECH`。
pub fn source_chapters(input: &[u8]) -> Result<String, EntryError> {
    let input: SourceChaptersInput = serde_json::from_slice(input).map_err(invalid_input)?;
    let chapters = chapters_of(&input);
    let anchors = if chapters.is_empty() { Vec::new() } else { anchors_of(&input)? };
    let plan = snap_to_anchors(&chapters, &anchors);
    let duration = if input.duration_seconds.is_finite() {
        input.duration_seconds.max(0.0)
    } else {
        0.0
    };
    let rows = resolve_rows(&plan.rows(), duration)
        .into_iter()
        .enumerate()
        .map(|(index, row)| RowOutput {
            status: row_status(&plan, index, &row.title, row.start),
            title: row.title,
            start: row.start,
            end: row.end,
        })
        .collect();
    let entries = plan
        .entries
        .iter()
        .map(|entry| EntryOutput {
            source: SourceRef {
                start: entry.source.start,
                title: entry.source.title.clone(),
            },
            status: entry.status,
            at: entry.start(),
            anchor: entry
                .pick
                .and_then(|pick| entry.candidates.get(pick))
                .map(|candidate| anchor_output(&candidate.anchor)),
            candidates: entry.candidates.iter().map(|candidate| anchor_output(&candidate.anchor)).collect(),
        })
        .collect();
    let summary = SummaryOutput {
        entries: plan.entries.len(),
        matched: plan.count(SnapStatus::Matched),
        ambiguous: plan.count(SnapStatus::Ambiguous),
        snapped: plan.count(SnapStatus::Snapped),
        unanchored: plan.count(SnapStatus::Unanchored),
    };
    let output = SourceChaptersOutput {
        source_chapters: chapters,
        entries,
        rows,
        summary,
    };
    Ok(serde_json::to_string(&output).expect("来源章节总能序列化"))
}
