//! 章节（视频格式规范 §3.13）：序列上 `kind: 'chapter'` 的标记。
//!
//! 章节固定在序列帧上，不跟着实例移动、裁剪或删除；一章从它的开始帧持续到下一章的开始帧，最后一章到序列结尾。
//! 例外是剪口（§6.7）：应用与恢复剪口时章节跟着内容走（[`close_spans`]、[`open_gap`]）。
//! 章节不受轨道与实例的锁定约束。

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};

use editor_semantics::{FrameAlignment, GridContext, TimelineTimeInput};

use crate::error::{EngineResult, ErrorBody, kinds, msg};
use crate::ids::new_id;
use crate::model::*;
use crate::ops::{AssetTarget, EditContext, require_sequence, resolve_asset};
use crate::state::{Placed, VideoState};

/// 一个序列最多这么多章。
pub const MAX_CHAPTERS: usize = 1000;
const MAX_TITLE_CHARS: usize = 200;
const MAX_SUMMARY_CHARS: usize = 2000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChapterInput {
    /// 沿用已有章节的 ID；不给时新建。
    #[serde(default)]
    pub chapter_id: Option<Id>,
    pub at: TimelineTimeInput,
    pub title: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub thumbnail: Option<AssetTarget>,
}

/// 区分「没给」（`None`）与「给了 null」（`Some(None)`）。
pub(crate) fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(d).map(Some)
}

/// 整个替换序列的章节（其他标记不动）。开始帧在量化之后须严格递增。
pub(crate) fn set_chapters(
    state: &mut VideoState,
    sequence_id: &str,
    inputs: &[ChapterInput],
    alignment: FrameAlignment,
    ctx: &mut EditContext<'_>,
) -> EngineResult<()> {
    let (sequence_id, fps, seq_revision) = require_sequence(state, Some(sequence_id))?;
    let sequence_id = sequence_id.to_string();
    if inputs.len() > MAX_CHAPTERS {
        return Err(ErrorBody::invalid_operation(msg!("engine.tooManyChapters", "A sequence can have at most {max} chapters", max = MAX_CHAPTERS)));
    }
    let grid = GridContext {
        sequence_id: &sequence_id,
        sequence_revision: &seq_revision,
        fps,
    };
    let mut chapters = Vec::with_capacity(inputs.len());
    let mut previous: Option<i64> = None;
    for (n, input) in inputs.iter().enumerate() {
        let id = match &input.chapter_id {
            Some(id) => {
                existing_chapter(state, &sequence_id, id)?;
                if chapters.iter().any(|c: &Marker| c.id == *id) {
                    return Err(ErrorBody::invalid_operation(msg!("engine.chapterRepeated", "Chapter {id} appears twice", id)).entities([id.clone()]));
                }
                id.clone()
            }
            None => new_id("chap"),
        };
        let q = editor_semantics::quantize_input(&input.at, &grid, alignment, &format!("chapters[{n}].at"))?;
        if q.frame < 0 {
            return Err(ErrorBody::invalid_operation(msg!("engine.chapterBeforeStart", "A chapter cannot start before the sequence")));
        }
        if previous.is_some_and(|p| q.frame <= p) {
            return Err(
                ErrorBody::invalid_operation(msg!(
                    "engine.chapterOrder",
                    "Chapter {number} must start after the previous chapter (after frame alignment)",
                    number = n + 1
                ))
                    .details(serde_json::json!({ "chapterIndex": n, "frame": q.frame, "previousFrame": previous })),
            );
        }
        previous = Some(q.frame);
        ctx.time_resolution.push(q.receipt);
        chapters.push(Marker {
            id,
            frame: q.frame,
            duration_frames: None,
            label: clean_title(&input.title)?,
            kind: Some(MarkerKind::Chapter),
            summary: clean_summary(input.summary.as_deref())?,
            thumbnail: input.thumbnail.as_ref().map(|t| thumbnail(state, t, ctx)).transpose()?,
        });
    }
    state.markers.retain(|_, m| !(m.sequence_id == sequence_id && m.value.is_chapter()));
    for chapter in chapters {
        state.markers.insert(
            chapter.id.clone(),
            Placed {
                sequence_id: sequence_id.clone(),
                value: chapter,
            },
        );
    }
    Ok(())
}

pub(crate) struct UpsertChapter<'a> {
    pub sequence_id: &'a str,
    pub chapter_id: Option<&'a str>,
    pub at: Option<&'a TimelineTimeInput>,
    pub alignment: Option<FrameAlignment>,
    pub title: Option<&'a str>,
    pub summary: Option<Option<&'a str>>,
    pub thumbnail: Option<Option<&'a AssetTarget>>,
}

/// 新建或修改一章。新建要有 `at` 与 `title`；修改只改给出的字段，`summary`、`thumbnail` 给 null 去掉。
pub(crate) fn upsert_chapter(state: &mut VideoState, input: UpsertChapter<'_>, ctx: &mut EditContext<'_>) -> EngineResult<()> {
    let (sequence_id, fps, seq_revision) = require_sequence(state, Some(input.sequence_id))?;
    let sequence_id = sequence_id.to_string();
    let mut chapter = match input.chapter_id {
        Some(id) => existing_chapter(state, &sequence_id, id)?.clone(),
        None => {
            if input.at.is_none() || input.title.is_none() {
                return Err(ErrorBody::invalid_operation(msg!("engine.chapterNeedsAtAndTitle", "A new chapter needs at and title")));
            }
            Marker {
                id: new_id("chap"),
                frame: 0,
                duration_frames: None,
                label: String::new(),
                kind: Some(MarkerKind::Chapter),
                summary: None,
                thumbnail: None,
            }
        }
    };
    if input.chapter_id.is_some() && input.at.is_none() && input.title.is_none() && input.summary.is_none() && input.thumbnail.is_none() {
        return Err(ErrorBody::invalid_operation(msg!("engine.upsertChapterEmpty", "upsertChapter must change at least one field")));
    }
    if let Some(at) = input.at {
        let alignment = input
            .alignment
            .ok_or_else(|| ErrorBody::invalid_operation(msg!("engine.atNeedsAlignment", "alignment (the alignment policy) is required when at is given")))?;
        let grid = GridContext {
            sequence_id: &sequence_id,
            sequence_revision: &seq_revision,
            fps,
        };
        let q = editor_semantics::quantize_input(at, &grid, alignment, "at")?;
        if q.frame < 0 {
            return Err(ErrorBody::invalid_operation(msg!("engine.chapterBeforeStart", "A chapter cannot start before the sequence")));
        }
        ctx.time_resolution.push(q.receipt);
        chapter.frame = q.frame;
    }
    if let Some(title) = input.title {
        chapter.label = clean_title(title)?;
    }
    if let Some(summary) = input.summary {
        chapter.summary = clean_summary(summary)?;
    }
    if let Some(target) = input.thumbnail {
        chapter.thumbnail = target.map(|t| thumbnail(state, t, ctx)).transpose()?;
    }
    if let Some(other) = state
        .markers
        .values()
        .find(|m| m.sequence_id == sequence_id && m.value.is_chapter() && m.value.id != chapter.id && m.value.frame == chapter.frame)
    {
        return Err(ErrorBody::invalid_operation(msg!("engine.chapterFrameTaken", "There is already a chapter at this frame")).entities([other.value.id.clone()]));
    }
    let count = state
        .markers
        .values()
        .filter(|m| m.sequence_id == sequence_id && m.value.is_chapter())
        .count();
    if input.chapter_id.is_none() && count >= MAX_CHAPTERS {
        return Err(ErrorBody::invalid_operation(msg!("engine.tooManyChapters", "A sequence can have at most {max} chapters", max = MAX_CHAPTERS)));
    }
    state.markers.insert(
        chapter.id.clone(),
        Placed {
            sequence_id,
            value: chapter,
        },
    );
    Ok(())
}

pub(crate) fn remove_chapter(state: &mut VideoState, sequence_id: Option<&str>, chapter_id: &str) -> EngineResult<()> {
    let placed = state.markers.get(chapter_id).filter(|m| m.value.is_chapter());
    let placed = placed.ok_or_else(|| ErrorBody::not_found(kinds::chapter(), chapter_id))?;
    if let Some(seq) = sequence_id
        && placed.sequence_id != seq
    {
        return Err(ErrorBody::time_domain_mismatch(msg!(
            "engine.chapterNotInSequence",
            "Chapter {chapter} does not belong to sequence {sequence}",
            chapter = chapter_id,
            sequence = seq
        )).entities([chapter_id]));
    }
    state.markers.remove(chapter_id);
    Ok(())
}

fn existing_chapter<'s>(state: &'s VideoState, sequence_id: &str, id: &str) -> EngineResult<&'s Marker> {
    match state.markers.get(id) {
        Some(m) if m.value.is_chapter() && m.sequence_id == sequence_id => Ok(&m.value),
        Some(m) if m.value.is_chapter() => {
            Err(ErrorBody::time_domain_mismatch(msg!(
            "engine.chapterNotInSequence",
            "Chapter {chapter} does not belong to sequence {sequence}",
            chapter = id,
            sequence = sequence_id
        )).entities([id]))
        }
        _ => Err(ErrorBody::not_found(kinds::chapter(), id)),
    }
}

fn clean_title(title: &str) -> EngineResult<String> {
    let t = title.trim();
    if t.is_empty() || t.chars().count() > MAX_TITLE_CHARS {
        return Err(ErrorBody::invalid_operation(msg!("engine.chapterTitleLength", "A chapter title must be 1–{max} characters", max = MAX_TITLE_CHARS)));
    }
    Ok(t.to_string())
}

fn clean_summary(summary: Option<&str>) -> EngineResult<Option<String>> {
    match summary.map(str::trim) {
        None | Some("") => Ok(None),
        Some(s) if s.chars().count() > MAX_SUMMARY_CHARS => {
            Err(ErrorBody::invalid_operation(msg!("engine.chapterSummaryLength", "A chapter summary cannot exceed {max} characters", max = MAX_SUMMARY_CHARS)))
        }
        Some(s) => Ok(Some(s.to_string())),
    }
}

/// 缩略图：图片素材的当前版本。
fn thumbnail(state: &VideoState, target: &AssetTarget, ctx: &EditContext<'_>) -> EngineResult<VersionRef> {
    let asset_id = resolve_asset(target, ctx)?;
    let asset = state.assets.get(&asset_id).ok_or_else(|| ErrorBody::not_found(kinds::asset(), &asset_id))?;
    if asset.kind != AssetKind::Image {
        return Err(ErrorBody::invalid_operation(msg!("engine.chapterThumbnailNotImage", "A chapter thumbnail must be an image asset")).entities([asset_id]));
    }
    Ok(VersionRef {
        id: asset.id.clone(),
        revision: asset.current_revision.clone(),
    })
}

/// 应用剪口时序列上拿掉了几段帧（§6.7 重排）：章节跟着内容走——段后的章前移，落在段里的回到段首。几章落到同一帧时只留
/// 原来起点最晚的那一章（它的内容还在，前面几章整章都剪掉了），其余删掉。`spans` 是拿掉之前的帧区间 `[f0, f1)`，按起点排好、
/// 互不重叠。
pub(crate) fn close_spans(state: &mut VideoState, sequence_id: &str, spans: &[(i64, i64)]) {
    let shifted = |frame: i64| {
        spans.iter().rev().fold(frame, |at, &(f0, f1)| {
            if at >= f1 {
                at - (f1 - f0)
            } else if at > f0 {
                f0
            } else {
                at
            }
        })
    };
    let mut chapters: Vec<(i64, Id)> = state
        .markers
        .values()
        .filter(|m| m.sequence_id == sequence_id && m.value.is_chapter())
        .map(|m| (m.value.frame, m.value.id.clone()))
        .collect();
    chapters.sort();
    let mut landed: BTreeMap<i64, Id> = BTreeMap::new();
    for (frame, id) in chapters {
        if let Some(earlier) = landed.insert(shifted(frame), id) {
            state.markers.remove(&earlier);
        }
    }
    for (frame, id) in landed {
        if let Some(placed) = state.markers.get_mut(&id) {
            placed.value.frame = frame;
        }
    }
}

/// 恢复剪口时在序列的 `frame` 处放回 `count` 帧（§6.7 恢复的接缝）：这一帧之后的章节后移；正在这一帧上的不动——它可能是
/// 剪掉开头的那一章，也可能是剪口之后被挪到接缝上的那一章，留在原地不会让序列开头没有章。
pub(crate) fn open_gap(state: &mut VideoState, sequence_id: &str, frame: i64, count: i64) {
    for placed in state.markers.values_mut() {
        if placed.sequence_id == sequence_id && placed.value.is_chapter() && placed.value.frame > frame {
            placed.value.frame += count;
        }
    }
}
