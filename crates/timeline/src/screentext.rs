use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use unicode_general_category::{GeneralCategory, get_general_category};

use crate::schema::{Element, ElementKind, ElementRole, Place, TimeValue, TimelineError};

pub const SCREENTEXT_QUEUE_VERSION: u32 = 2;
pub const DEFAULT_DISPLAY_DURATION: f64 = 3.0;
pub const DEFAULT_SOURCE_FALLBACK: f64 = 3.0;
pub const ANCHOR_EVIDENCE_TICK: f64 = 0.01;
pub const TIME_EPSILON: f64 = 0.005;
pub const SCAN_SAME_TEXT_RATIO: f64 = 0.8;
pub const SCAN_SAME_CENTER_PERCENT: f64 = 12.0;
pub const SCAN_MAX_SAMPLE_GAP: usize = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenTextBBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenTextColors {
    pub fg: String,
    pub bg: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenTextSpan {
    pub start: f64,
    pub end: f64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenTextLine {
    pub text: String,
    pub bbox: ScreenTextBBox,
    pub conf: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenTextBlock {
    pub block_id: String,
    pub text: String,
    pub bbox: ScreenTextBBox,
    pub rot: f64,
    pub est_font_size: f64,
    pub conf: f64,
    #[serde(default)]
    pub lines: Vec<ScreenTextLine>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colors: Option<ScreenTextColors>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span: Option<ScreenTextSpan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trans: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trans_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub el_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ScreenTextBlockState {
    Skipped,
    Pending,
    Translated,
    Applied,
}

impl ScreenTextBlock {
    pub fn state(&self) -> ScreenTextBlockState {
        if self.skip == Some(true) {
            return ScreenTextBlockState::Skipped;
        }
        if self
            .trans
            .as_deref()
            .is_none_or(|text| text.trim().is_empty())
        {
            return ScreenTextBlockState::Pending;
        }
        if self.el_id.is_some() {
            ScreenTextBlockState::Applied
        } else {
            ScreenTextBlockState::Translated
        }
    }

    pub fn is_applicable(&self) -> bool {
        matches!(
            self.state(),
            ScreenTextBlockState::Translated | ScreenTextBlockState::Applied
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenTextQueueFrame {
    pub t: f64,
    pub png: String,
    pub width: u32,
    pub height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ocr_at: Option<String>,
    #[serde(default)]
    pub blocks: Vec<ScreenTextBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenTextQueue {
    #[serde(default = "queue_version")]
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_lang: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_langs: Option<Vec<String>>,
    #[serde(default)]
    pub frames: Vec<ScreenTextQueueFrame>,
}

const fn queue_version() -> u32 {
    SCREENTEXT_QUEUE_VERSION
}

impl Default for ScreenTextQueue {
    fn default() -> Self {
        Self {
            version: SCREENTEXT_QUEUE_VERSION,
            target_lang: None,
            source_langs: None,
            frames: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenTextTotals {
    pub frames: usize,
    pub blocks: usize,
    pub pending: usize,
    pub translated: usize,
    pub skipped: usize,
    pub applied: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScreenTextPage {
    pub page: usize,
    pub page_size: usize,
    pub total_pages: usize,
    pub frames: Vec<ScreenTextQueueFrame>,
}

pub fn screen_text_time_key(time: f64) -> f64 {
    (time * 100.0).round() / 100.0
}

impl ScreenTextQueue {
    pub fn validate(&self) -> Result<(), TimelineError> {
        if self.version != SCREENTEXT_QUEUE_VERSION {
            return Err(TimelineError::UnsupportedVersion(format!(
                "screentext {}",
                self.version
            )));
        }
        let mut previous: Option<f64> = None;
        for frame in &self.frames {
            if !frame.t.is_finite()
                || frame.t < 0.0
                || previous.is_some_and(|previous| frame.t - previous < TIME_EPSILON)
            {
                return Err(TimelineError::Invalid(
                    "screentext frames 须按有限非负且不重复的 t 排序".to_owned(),
                ));
            }
            previous = Some(frame.t);
            let mut ids = BTreeSet::new();
            for block in &frame.blocks {
                if block.block_id.is_empty() || !ids.insert(block.block_id.clone()) {
                    return Err(TimelineError::Invalid(format!(
                        "screentext frame {} 的 blockId 为空或重复",
                        frame.t
                    )));
                }
                validate_geometry(block)?;
            }
        }
        Ok(())
    }

    pub fn frame_index(&self, time: f64) -> Option<usize> {
        let key = screen_text_time_key(time);
        self.frames
            .iter()
            .position(|frame| (frame.t - key).abs() < TIME_EPSILON)
    }

    pub fn totals(&self) -> ScreenTextTotals {
        let mut totals = ScreenTextTotals {
            frames: self.frames.len(),
            ..ScreenTextTotals::default()
        };
        for block in self.frames.iter().flat_map(|frame| &frame.blocks) {
            totals.blocks += 1;
            match block.state() {
                ScreenTextBlockState::Skipped => totals.skipped += 1,
                ScreenTextBlockState::Pending => totals.pending += 1,
                ScreenTextBlockState::Translated => totals.translated += 1,
                ScreenTextBlockState::Applied => totals.applied += 1,
            }
        }
        totals
    }

    pub fn page(&self, page: usize, page_size: usize, pending_only: bool) -> ScreenTextPage {
        let pool = self
            .frames
            .iter()
            .filter(|frame| {
                !pending_only
                    || frame
                        .blocks
                        .iter()
                        .any(|block| block.state() == ScreenTextBlockState::Pending)
            })
            .cloned()
            .collect::<Vec<_>>();
        let page_size = page_size.max(1);
        let total_pages = (pool.len().div_ceil(page_size)).max(1);
        let start = page.saturating_sub(1) * page_size;
        let frames = pool
            .get(start..pool.len().min(start + page_size))
            .unwrap_or_default()
            .to_vec();
        ScreenTextPage {
            page,
            page_size,
            total_pages,
            frames,
        }
    }

    pub fn upsert(&mut self, mut frame: ScreenTextQueueFrame) -> bool {
        frame.t = screen_text_time_key(frame.t);
        if let Some(index) = self.frame_index(frame.t) {
            carry_over(&mut frame.blocks, &self.frames[index].blocks);
            self.frames[index] = frame;
            true
        } else {
            self.frames.push(frame);
            self.frames
                .sort_by(|left, right| left.t.total_cmp(&right.t));
            false
        }
    }

    pub fn merge(&mut self, mut frame: ScreenTextQueueFrame) -> bool {
        frame.t = screen_text_time_key(frame.t);
        if let Some(index) = self.frame_index(frame.t) {
            let mut taken = self.frames[index]
                .blocks
                .iter()
                .map(|block| block.block_id.clone())
                .collect::<BTreeSet<_>>();
            for mut block in frame.blocks {
                if taken.contains(&block.block_id) {
                    block.block_id = free_block_id(&taken);
                }
                taken.insert(block.block_id.clone());
                self.frames[index].blocks.push(block);
            }
            true
        } else {
            self.frames.push(frame);
            self.frames
                .sort_by(|left, right| left.t.total_cmp(&right.t));
            false
        }
    }
}

/// Lowercase 后移除 Unicode 空白、标点和符号；与 VoiceInk
/// `ScreenTextSimilarity.normalize` 的字符域一致。
pub fn normalize_screen_text(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .filter(|character| {
            !character.is_whitespace()
                && !matches!(
                    get_general_category(*character),
                    GeneralCategory::ConnectorPunctuation
                        | GeneralCategory::DashPunctuation
                        | GeneralCategory::OpenPunctuation
                        | GeneralCategory::ClosePunctuation
                        | GeneralCategory::InitialPunctuation
                        | GeneralCategory::FinalPunctuation
                        | GeneralCategory::OtherPunctuation
                        | GeneralCategory::MathSymbol
                        | GeneralCategory::CurrencySymbol
                        | GeneralCategory::ModifierSymbol
                        | GeneralCategory::OtherSymbol
                )
        })
        .collect()
}

/// 字符 bigram Sørensen–Dice + containment；对应 VoiceInk
/// `ScreenTextSimilarity.ratio`，适用于无空格的 CJK 与渐显的部分 OCR。
pub fn screen_text_similarity(left: &str, right: &str) -> f64 {
    let left = normalize_screen_text(left);
    let right = normalize_screen_text(right);
    if left.is_empty() || right.is_empty() {
        return if left == right { 1.0 } else { 0.0 };
    }
    if left == right {
        return 1.0;
    }
    let left_chars = left.chars().collect::<Vec<_>>();
    let right_chars = right.chars().collect::<Vec<_>>();
    let containment = if left_chars.len() <= right_chars.len() && right.contains(&left) {
        left_chars.len() as f64 / right_chars.len() as f64
    } else if right_chars.len() < left_chars.len() && left.contains(&right) {
        right_chars.len() as f64 / left_chars.len() as f64
    } else {
        0.0
    };
    if left_chars.len() < 2 || right_chars.len() < 2 {
        return containment;
    }
    let mut counts = BTreeMap::<(char, char), usize>::new();
    for pair in left_chars.windows(2) {
        *counts.entry((pair[0], pair[1])).or_default() += 1;
    }
    let mut overlap = 0usize;
    for pair in right_chars.windows(2) {
        if let Some(count) = counts.get_mut(&(pair[0], pair[1]))
            && *count > 0
        {
            *count -= 1;
            overlap += 1;
        }
    }
    let total = left_chars.len() - 1 + right_chars.len() - 1;
    containment.max(2.0 * overlap as f64 / total as f64)
}

pub fn same_screen_text_block(left: &ScreenTextBlock, right: &ScreenTextBlock) -> bool {
    (left.bbox.x - right.bbox.x).abs() <= SCAN_SAME_CENTER_PERCENT
        && (left.bbox.y - right.bbox.y).abs() <= SCAN_SAME_CENTER_PERCENT
        && screen_text_similarity(&left.text, &right.text) >= SCAN_SAME_TEXT_RATIO
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ScreenTextScanEdge {
    Start,
    End,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenTextScanBoundary {
    pub out_frame: usize,
    pub out_block: usize,
    pub edge: ScreenTextScanEdge,
    pub lower: f64,
    pub upper: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScreenTextScanFoldResult {
    pub frames: Vec<ScreenTextQueueFrame>,
    pub boundaries: Vec<ScreenTextScanBoundary>,
}

#[derive(Debug, Clone)]
struct TrackedScreenText {
    block: ScreenTextBlock,
    first_sample: usize,
    last_sample: usize,
    out_frame: usize,
    out_block: usize,
}

/// VoiceInk `ScreenTextScanFold.foldResult` 的纯 Rust 对等物。
pub fn fold_screen_text_scan(
    samples: &[ScreenTextQueueFrame],
    existing: &[ScreenTextQueueFrame],
    start: f64,
    end: f64,
) -> ScreenTextScanFoldResult {
    let existing_blocks = existing
        .iter()
        .flat_map(|frame| &frame.blocks)
        .collect::<Vec<_>>();
    let mut tracked = Vec::<TrackedScreenText>::new();
    let mut output = Vec::<ScreenTextQueueFrame>::new();
    for (sample_index, sample) in samples.iter().enumerate() {
        let mut fresh = Vec::new();
        for block in &sample.blocks {
            if let Some(index) = tracked.iter().rposition(|tracked| {
                sample_index - tracked.last_sample <= SCAN_MAX_SAMPLE_GAP + 1
                    && same_screen_text_block(&tracked.block, block)
            }) {
                tracked[index].last_sample = sample_index;
                continue;
            }
            if existing_blocks
                .iter()
                .any(|existing| same_screen_text_block(existing, block))
            {
                continue;
            }
            tracked.push(TrackedScreenText {
                block: block.clone(),
                first_sample: sample_index,
                last_sample: sample_index,
                out_frame: output.len(),
                out_block: fresh.len(),
            });
            fresh.push(block.clone());
        }
        if !fresh.is_empty() {
            let mut frame = sample.clone();
            frame.blocks = fresh;
            output.push(frame);
        }
    }
    let mut boundaries = Vec::new();
    for tracked in tracked {
        let from = if tracked.first_sample == 0 {
            start
        } else {
            (samples[tracked.first_sample - 1].t + samples[tracked.first_sample].t) / 2.0
        };
        let to = if tracked.last_sample >= samples.len().saturating_sub(1) {
            end
        } else {
            (samples[tracked.last_sample].t + samples[tracked.last_sample + 1].t) / 2.0
        };
        output[tracked.out_frame].blocks[tracked.out_block].span = Some(ScreenTextSpan {
            start: round(from.max(0.0), 2),
            end: round(to.max(from.max(0.0)), 2),
            source: "scan".to_owned(),
        });
        if tracked.first_sample > 0 {
            boundaries.push(ScreenTextScanBoundary {
                out_frame: tracked.out_frame,
                out_block: tracked.out_block,
                edge: ScreenTextScanEdge::Start,
                lower: samples[tracked.first_sample - 1].t,
                upper: samples[tracked.first_sample].t,
            });
        }
        if tracked.last_sample < samples.len().saturating_sub(1) {
            boundaries.push(ScreenTextScanBoundary {
                out_frame: tracked.out_frame,
                out_block: tracked.out_block,
                edge: ScreenTextScanEdge::End,
                lower: samples[tracked.last_sample].t,
                upper: samples[tracked.last_sample + 1].t,
            });
        }
    }
    ScreenTextScanFoldResult {
        frames: output,
        boundaries,
    }
}

fn free_block_id(taken: &BTreeSet<String>) -> String {
    let mut number = taken.len() + 1;
    loop {
        let id = format!("b{number}");
        if !taken.contains(&id) {
            return id;
        }
        number += 1;
    }
}

fn normalize_text(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn carry_over(fresh: &mut [ScreenTextBlock], old: &[ScreenTextBlock]) {
    let mut used = BTreeSet::new();
    for block in fresh {
        let key = normalize_text(&block.text);
        let candidate = old
            .iter()
            .enumerate()
            .find(|(index, candidate)| {
                !used.contains(index)
                    && candidate.block_id == block.block_id
                    && normalize_text(&candidate.text) == key
            })
            .or_else(|| {
                old.iter().enumerate().find(|(index, candidate)| {
                    !used.contains(index) && normalize_text(&candidate.text) == key
                })
            });
        if let Some((index, previous)) = candidate {
            used.insert(index);
            block.skip = previous.skip;
            block.trans = previous.trans.clone();
            block.trans_at = previous.trans_at.clone();
            block.model = previous.model.clone();
            block.el_id = previous.el_id.clone();
        }
    }
}

fn validate_geometry(block: &ScreenTextBlock) -> Result<(), TimelineError> {
    let values = [
        block.bbox.x,
        block.bbox.y,
        block.bbox.w,
        block.rot,
        block.est_font_size,
        block.conf,
    ];
    if values.iter().any(|value| !value.is_finite())
        || !(0.0..=100.0).contains(&block.bbox.x)
        || !(0.0..=100.0).contains(&block.bbox.y)
        || !(0.0..=100.0).contains(&block.bbox.w)
        || !(0.0..=1.0).contains(&block.conf)
        || !(1.0..=540.0).contains(&block.est_font_size)
        || block
            .align
            .as_deref()
            .is_some_and(|align| !matches!(align, "left" | "center" | "right"))
    {
        return Err(TimelineError::Invalid(format!(
            "screentext block {} 几何/置信度非法",
            block.block_id
        )));
    }
    if let Some(span) = &block.span
        && (!span.start.is_finite()
            || !span.end.is_finite()
            || span.start < 0.0
            || span.end <= span.start
            || !matches!(
                span.source.as_str(),
                "detected" | "scan" | "scan-refined" | "manual" | "fallback"
            ))
    {
        return Err(TimelineError::Invalid(format!(
            "screentext block {} span 非法",
            block.block_id
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenTextTranslationFile {
    pub items: Vec<ScreenTextTranslationItem>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub target_lang: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenTextTranslationItem {
    pub t: f64,
    pub block_id: String,
    #[serde(default)]
    pub trans: Option<String>,
    #[serde(default)]
    pub skip: Option<bool>,
    #[serde(default)]
    pub src: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenTextTranslationResult {
    pub updated: usize,
    pub skipped: usize,
    pub corrected: usize,
}

pub fn apply_translations(
    queue: &mut ScreenTextQueue,
    file: &ScreenTextTranslationFile,
    at: &str,
) -> Result<ScreenTextTranslationResult, TimelineError> {
    if file.items.is_empty() {
        return Err(TimelineError::Invalid(
            "translation items 不能为空".to_owned(),
        ));
    }
    if file
        .target_lang
        .as_deref()
        .is_some_and(|lang| lang.trim().is_empty())
    {
        return Err(TimelineError::Invalid("targetLang 不能为空".to_owned()));
    }
    // Validate every key and change before mutating: the batch is atomic.
    let mut locations = Vec::new();
    for (index, item) in file.items.iter().enumerate() {
        if !item.t.is_finite() || item.t < 0.0 || item.block_id.is_empty() {
            return Err(TimelineError::Invalid(format!(
                "translation item {index} key 非法"
            )));
        }
        if item.trans.is_none() && item.skip.is_none() && item.src.is_none() {
            return Err(TimelineError::Invalid(format!(
                "translation item {index} 没有修改"
            )));
        }
        for value in [&item.trans, &item.src].into_iter().flatten() {
            if value.trim().is_empty() {
                return Err(TimelineError::Invalid(format!(
                    "translation item {index} 文本为空"
                )));
            }
        }
        let frame_index = queue.frame_index(item.t).ok_or_else(|| {
            TimelineError::Unmapped(format!("screentext frame {}", screen_text_time_key(item.t)))
        })?;
        let block_index = queue.frames[frame_index]
            .blocks
            .iter()
            .position(|block| block.block_id == item.block_id)
            .ok_or_else(|| {
                TimelineError::Unmapped(format!(
                    "screentext block {}:{}",
                    screen_text_time_key(item.t),
                    item.block_id
                ))
            })?;
        let block = &queue.frames[frame_index].blocks[block_index];
        let still_skipped = item.skip.unwrap_or(block.skip == Some(true));
        if item.trans.is_some() && still_skipped {
            return Err(TimelineError::Invalid(format!(
                "已 skip block {}:{} 须同批 skip:false 才能翻译",
                item.t, item.block_id
            )));
        }
        locations.push((frame_index, block_index));
    }
    let mut result = ScreenTextTranslationResult::default();
    for (item, (frame_index, block_index)) in file.items.iter().zip(locations) {
        let block = &mut queue.frames[frame_index].blocks[block_index];
        if let Some(src) = &item.src {
            block.text = src.clone();
            result.corrected += 1;
        }
        if let Some(skip) = item.skip {
            block.skip = Some(skip);
            if skip {
                result.skipped += 1;
            }
        }
        if let Some(trans) = &item.trans {
            block.trans = Some(trans.clone());
            block.trans_at = Some(at.to_owned());
            block.model = file.model.clone();
            block.el_id = None;
            result.updated += 1;
        }
    }
    if let Some(lang) = &file.target_lang {
        queue.target_lang = Some(lang.clone());
    }
    Ok(result)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ScreenTextTiming {
    Automatic,
    Seconds(f64),
    Source,
}

impl ScreenTextTiming {
    pub fn parse(raw: Option<&str>) -> Result<Self, TimelineError> {
        let Some(raw) = raw else {
            return Ok(Self::Automatic);
        };
        if raw.trim().eq_ignore_ascii_case("source") {
            return Ok(Self::Source);
        }
        let value = raw
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite() && *value > 0.0)
            .ok_or_else(|| TimelineError::Invalid("duration 须为正秒数或 source".to_owned()))?;
        Ok(Self::Seconds(value))
    }

    fn duration(self) -> Option<f64> {
        match self {
            Self::Seconds(value) => Some(value),
            _ => None,
        }
    }
}

fn round(value: f64, places: i32) -> f64 {
    let power = 10_f64.powi(places);
    (value * power).round() / power
}

pub fn resolve_screen_text_span(
    span: Option<&ScreenTextSpan>,
    frame_time: f64,
    content_end: f64,
    fallback_duration: f64,
) -> ScreenTextSpan {
    let content_end = if content_end.is_finite() && content_end > 0.0 {
        content_end
    } else {
        f64::MAX
    };
    if let Some(span) = span {
        let start = span.start.clamp(0.0, content_end);
        return ScreenTextSpan {
            start: round(start, 2),
            end: round(span.end.clamp(start, content_end), 2),
            source: span.source.clone(),
        };
    }
    let half = fallback_duration.max(0.0) / 2.0;
    ScreenTextSpan {
        start: round((frame_time - half).max(0.0).min(content_end), 2),
        end: round((frame_time + half).min(content_end), 2),
        source: "fallback".to_owned(),
    }
}

pub fn screen_text_display_span(
    source: &ScreenTextSpan,
    frame_time: f64,
    timing: ScreenTextTiming,
    content_end: f64,
) -> ScreenTextSpan {
    let mut bounds = source.clone();
    bounds.start = bounds.start.min(frame_time);
    if frame_time >= bounds.end && frame_time < content_end {
        bounds.end = content_end.min(frame_time + ANCHOR_EVIDENCE_TICK);
    }
    if timing == ScreenTextTiming::Source
        || (timing == ScreenTextTiming::Automatic && source.source == "manual")
    {
        return bounds;
    }
    let requested = timing.duration().unwrap_or(DEFAULT_DISPLAY_DURATION);
    let duration = (bounds.end - bounds.start).max(0.0).min(requested.max(0.0));
    let latest_start = (bounds.end - duration).max(bounds.start);
    let start = (frame_time - duration / 2.0).clamp(bounds.start, latest_start);
    ScreenTextSpan {
        start: round(start, 2),
        end: round((start + duration).min(bounds.end), 2),
        source: source.source.clone(),
    }
}

fn natural_alignment(text: &str) -> &'static str {
    let (mut rtl, mut ltr) = (0, 0);
    for character in text.chars().map(|character| character as u32) {
        match character {
            0x0590..=0x08ff | 0xfb1d..=0xfdff | 0xfe70..=0xfeff => rtl += 1,
            0x0041..=0x005a
            | 0x0061..=0x007a
            | 0x00c0..=0x058f
            | 0x0900..=0x1fff
            | 0x2c00..=0xd7ff => ltr += 1,
            _ => {}
        }
    }
    if rtl > ltr { "right" } else { "left" }
}

pub fn default_screen_text_style(block: &ScreenTextBlock) -> Value {
    json!({
        "backgroundColor": "rgba(0,0,0,0.65)",
        "backgroundPadding": 10,
        "backgroundStyle": "wrap",
        "borderRadius": 15,
        "fontColor": "#ffffff",
        "fontFamily": {"type": "default", "fontFamily": "Montserrat"},
        "fontSize": round(block.est_font_size.max(8.0), 1),
        "fontStyle": "normal",
        "fontWeight": "bold",
        "italic": false,
        "underline": false,
        "lineHeight": 1.2,
        "letterSpacing": 0,
        "textAlign": block.align.as_deref().unwrap_or_else(|| natural_alignment(block.trans.as_deref().unwrap_or(&block.text))),
        "textTransform": "none",
        "dropShadow": {"blur": 0, "distance": 0, "rotation": 45, "color": "#000000"},
        "textOutline": {"color": "#000000", "width": 15, "on": true},
        "bgOn": true,
    })
}

fn screen_text_style(block: &ScreenTextBlock, base: Option<Value>) -> Value {
    let mut style = base.unwrap_or_else(|| default_screen_text_style(block));
    if let Some(style) = style.as_object_mut() {
        style.insert(
            "fontSize".to_owned(),
            json!(round(block.est_font_size.max(8.0), 1)),
        );
        style.insert(
            "textAlign".to_owned(),
            json!(block.align.as_deref().unwrap_or_else(|| natural_alignment(
                block.trans.as_deref().unwrap_or(&block.text)
            ))),
        );
    }
    style
}

fn element_timing(element: &Element) -> Option<(f64, f64)> {
    match (&element.start, &element.end) {
        (Some(TimeValue::Seconds(start)), Some(TimeValue::Seconds(end))) => Some((*start, *end)),
        _ => None,
    }
}

fn same_timing(element: &Element, span: &ScreenTextSpan) -> bool {
    element_timing(element).is_some_and(|(start, end)| {
        (start - span.start).abs() < TIME_EPSILON && (end - span.end).abs() < TIME_EPSILON
    })
}

/// VoiceInk `ScreenTextElementBuilder.shouldPreserveExistingTiming` 的纯 Rust 对等物。
/// 默认重应用保留人工/requested 时间或已偏离上次 auto 基线的时间；显式
/// `--duration` 始终覆盖。
pub fn should_preserve_screen_text_timing(
    existing: &Element,
    source_span: &ScreenTextSpan,
    generated_span: &ScreenTextSpan,
    timing: ScreenTextTiming,
) -> bool {
    if timing != ScreenTextTiming::Automatic {
        return false;
    }
    let ai = existing.ai.as_ref();
    match ai.and_then(|value| value["displayTiming"].as_str()) {
        Some("manual" | "requested") => true,
        Some("auto") => {
            let baseline = ai.and_then(|value| {
                Some((
                    value["appliedStart"].as_f64()?,
                    value["appliedEnd"].as_f64()?,
                ))
            });
            match (element_timing(existing), baseline) {
                (Some((start, end)), Some((applied_start, applied_end))) => {
                    (start - applied_start).abs() >= TIME_EPSILON
                        || (end - applied_end).abs() >= TIME_EPSILON
                }
                _ => !same_timing(existing, generated_span),
            }
        }
        _ => !same_timing(existing, source_span) && !same_timing(existing, generated_span),
    }
}

pub fn build_screen_text_element(
    block: &ScreenTextBlock,
    frame_time: f64,
    id: String,
    target_lang: Option<&str>,
    content_end: f64,
    timing: ScreenTextTiming,
    style: Option<Value>,
    style_preset_id: Option<String>,
) -> Element {
    let fallback = DEFAULT_SOURCE_FALLBACK.max(timing.duration().unwrap_or(0.0));
    let source_span =
        resolve_screen_text_span(block.span.as_ref(), frame_time, content_end, fallback);
    let display = screen_text_display_span(&source_span, frame_time, timing, content_end);
    let display_timing = match timing {
        ScreenTextTiming::Automatic if source_span.source == "manual" => "manual",
        ScreenTextTiming::Automatic => "auto",
        _ => "requested",
    };
    let mut provenance = BTreeMap::from([
        ("op".to_owned(), json!("screentext")),
        ("srcText".to_owned(), json!(block.text)),
        ("frameT".to_owned(), json!(screen_text_time_key(frame_time))),
        ("blockId".to_owned(), json!(block.block_id)),
        ("conf".to_owned(), json!(block.conf)),
        ("displayTiming".to_owned(), json!(display_timing)),
        ("appliedStart".to_owned(), json!(display.start)),
        ("appliedEnd".to_owned(), json!(display.end)),
    ]);
    if let Some(lang) = target_lang {
        provenance.insert("targetLang".to_owned(), json!(lang));
    }
    if let Some(model) = &block.model {
        provenance.insert("model".to_owned(), json!(model));
    }
    Element {
        id,
        kind: ElementKind::Text,
        name: None,
        role: Some(ElementRole::Screentext),
        start: Some(TimeValue::Seconds(display.start)),
        end: Some(TimeValue::Seconds(display.end)),
        place: Some(Place {
            x: Some(round(block.bbox.x, 2)),
            y: Some(round(block.bbox.y, 2)),
            w: Some(block.bbox.w),
            rot: Some(block.rot),
            ..Place::default()
        }),
        // 缺席 = center = 这条链路一直以来的行为。`place.y` 来自识别出的 bbox
        // 中心，重应用时和 place 一起从新的 bbox 重新推导，所以这里不落值。
        vertical_align: None,
        src_id: None,
        src_start: None,
        rate: None,
        muted: None,
        volume: None,
        audio_fade_in: None,
        audio_fade_out: None,
        bcf_clip: None,
        mode: None,
        fit: None,
        bg: None,
        text: Some(block.trans.clone().unwrap_or_else(|| block.text.clone())),
        style: Some(screen_text_style(block, style)),
        style_preset_id,
        tile: None,
        mask: None,
        fx: None,
        animate: None,
        transitions: None,
        keyframes: None,
        duck: None,
        source: None,
        html: None,
        ai: Some(Value::Object(provenance.into_iter().collect())),
        counter: None,
        shape: None,
        sticker: None,
        visualizer: None,
        progress: None,
        draw: None,
        placeholder: None,
        confetti: None,
        whiteboard: None,
        hidden: false,
    }
}

pub fn screentext_element_key(element: &Element) -> Option<(f64, &str)> {
    let ai = element.ai.as_ref()?;
    if ai["op"].as_str()? != "screentext" {
        return None;
    }
    Some((ai["frameT"].as_f64()?, ai["blockId"].as_str()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(id: &str, text: &str, translation: Option<&str>) -> ScreenTextBlock {
        ScreenTextBlock {
            block_id: id.to_owned(),
            text: text.to_owned(),
            bbox: ScreenTextBBox {
                x: 33.333,
                y: 71.666,
                w: 62.0,
            },
            rot: 4.5,
            est_font_size: 41.0,
            conf: 0.93,
            lines: Vec::new(),
            colors: None,
            span: Some(ScreenTextSpan {
                start: 11.9,
                end: 16.4,
                source: "detected".to_owned(),
            }),
            align: None,
            skip: None,
            trans: translation.map(str::to_owned),
            trans_at: None,
            model: None,
            el_id: None,
        }
    }

    #[test]
    fn queue_key_paging_and_atomic_translation_match_voiceink() {
        let mut queue = ScreenTextQueue {
            target_lang: Some("zh-Hans".to_owned()),
            frames: vec![ScreenTextQueueFrame {
                t: 12.5,
                png: "screentext/t00012.50.png".to_owned(),
                width: 1600,
                height: 900,
                ocr_at: None,
                blocks: vec![block("b1", "Accelerating discovery", None)],
            }],
            ..ScreenTextQueue::default()
        };
        assert_eq!(queue.frame_index(12.499), Some(0));
        let file = ScreenTextTranslationFile {
            items: vec![ScreenTextTranslationItem {
                t: 12.499,
                block_id: "b1".to_owned(),
                trans: Some("加速发现".to_owned()),
                skip: None,
                src: None,
            }],
            model: Some("test-model".to_owned()),
            target_lang: None,
        };
        let result = apply_translations(&mut queue, &file, "1970-01-01T00:00:01Z").unwrap();
        assert_eq!(result.updated, 1);
        assert_eq!(
            queue.frames[0].blocks[0].state(),
            ScreenTextBlockState::Translated
        );
        assert_eq!(queue.totals().translated, 1);
    }

    #[test]
    fn element_geometry_window_style_and_provenance_match_voiceink() {
        let value = build_screen_text_element(
            &block("b1", "Accelerating discovery", Some("加速发现")),
            12.5,
            "el-1".to_owned(),
            Some("zh-Hans"),
            100.0,
            ScreenTextTiming::Automatic,
            None,
            None,
        );
        assert_eq!(value.text.as_deref(), Some("加速发现"));
        assert_eq!(value.start, Some(TimeValue::Seconds(11.9)));
        assert_eq!(value.end, Some(TimeValue::Seconds(14.9)));
        assert_eq!(value.place.as_ref().unwrap().x, Some(33.33));
        assert_eq!(value.place.as_ref().unwrap().y, Some(71.67));
        assert_eq!(value.style.as_ref().unwrap()["fontSize"], 41.0);
        assert_eq!(value.ai.as_ref().unwrap()["frameT"], 12.5);
        assert_eq!(value.ai.as_ref().unwrap()["blockId"], "b1");
    }

    #[test]
    fn manual_source_and_requested_windows_follow_voiceink_policy() {
        let source = ScreenTextSpan {
            start: 10.0,
            end: 20.0,
            source: "detected".to_owned(),
        };
        assert_eq!(
            screen_text_display_span(&source, 15.0, ScreenTextTiming::Seconds(2.5), 100.0),
            ScreenTextSpan {
                start: 13.75,
                end: 16.25,
                source: "detected".to_owned(),
            }
        );
        assert_eq!(
            screen_text_display_span(&source, 15.0, ScreenTextTiming::Source, 100.0),
            source
        );
    }

    #[test]
    fn translation_target_validation_is_atomic() {
        let mut queue = ScreenTextQueue {
            frames: vec![ScreenTextQueueFrame {
                t: 12.5,
                png: "screentext/t00012.50.png".to_owned(),
                width: 1600,
                height: 900,
                ocr_at: None,
                blocks: vec![block("b1", "Accelerating discovery", None)],
            }],
            ..ScreenTextQueue::default()
        };
        let before = queue.clone();
        let file = ScreenTextTranslationFile {
            items: vec![ScreenTextTranslationItem {
                t: 12.5,
                block_id: "b1".to_owned(),
                trans: Some("加速发现".to_owned()),
                skip: None,
                src: None,
            }],
            model: None,
            target_lang: Some("  ".to_owned()),
        };
        assert!(apply_translations(&mut queue, &file, "now").is_err());
        assert_eq!(queue, before);
    }

    #[test]
    fn skip_preserves_translation_and_rejects_same_batch_contradiction() {
        let mut queue = ScreenTextQueue {
            frames: vec![scan_frame(12.5, vec![block("b1", "Logo", Some("旧译文"))])],
            ..ScreenTextQueue::default()
        };
        let skip = ScreenTextTranslationFile {
            items: vec![ScreenTextTranslationItem {
                t: 12.5,
                block_id: "b1".to_owned(),
                trans: None,
                skip: Some(true),
                src: None,
            }],
            model: None,
            target_lang: None,
        };
        apply_translations(&mut queue, &skip, "now").unwrap();
        assert_eq!(queue.frames[0].blocks[0].trans.as_deref(), Some("旧译文"));
        let contradictory = ScreenTextTranslationFile {
            items: vec![ScreenTextTranslationItem {
                t: 12.5,
                block_id: "b1".to_owned(),
                trans: Some("新译文".to_owned()),
                skip: Some(true),
                src: None,
            }],
            model: None,
            target_lang: None,
        };
        assert!(apply_translations(&mut queue, &contradictory, "now").is_err());
        let unskip = ScreenTextTranslationFile {
            items: vec![ScreenTextTranslationItem {
                t: 12.5,
                block_id: "b1".to_owned(),
                trans: Some("新译文".to_owned()),
                skip: Some(false),
                src: None,
            }],
            model: None,
            target_lang: None,
        };
        apply_translations(&mut queue, &unskip, "later").unwrap();
        assert_eq!(queue.frames[0].blocks[0].trans.as_deref(), Some("新译文"));
        assert_eq!(queue.frames[0].blocks[0].skip, Some(false));
    }

    #[test]
    fn default_reapply_preserves_human_timing_and_migrates_legacy_full_span() {
        let source = ScreenTextSpan {
            start: 10.0,
            end: 20.0,
            source: "detected".to_owned(),
        };
        let generated = ScreenTextSpan {
            start: 13.5,
            end: 16.5,
            source: "detected".to_owned(),
        };
        let mut existing = build_screen_text_element(
            &block("b1", "Title", Some("标题")),
            15.0,
            "el-1".to_owned(),
            Some("zh-Hans"),
            100.0,
            ScreenTextTiming::Automatic,
            None,
            None,
        );
        existing.start = Some(TimeValue::Seconds(10.0));
        existing.end = Some(TimeValue::Seconds(20.0));
        existing.ai = None;
        assert!(!should_preserve_screen_text_timing(
            &existing,
            &source,
            &generated,
            ScreenTextTiming::Automatic
        ));
        existing.start = Some(TimeValue::Seconds(12.0));
        existing.end = Some(TimeValue::Seconds(14.0));
        assert!(should_preserve_screen_text_timing(
            &existing,
            &source,
            &generated,
            ScreenTextTiming::Automatic
        ));
        existing.ai = Some(json!({
            "displayTiming": "auto",
            "appliedStart": 13.5,
            "appliedEnd": 16.5,
        }));
        existing.start = Some(TimeValue::Seconds(13.5));
        existing.end = Some(TimeValue::Seconds(16.5));
        assert!(!should_preserve_screen_text_timing(
            &existing,
            &source,
            &generated,
            ScreenTextTiming::Automatic
        ));
        existing.end = Some(TimeValue::Seconds(16.0));
        assert!(should_preserve_screen_text_timing(
            &existing,
            &source,
            &generated,
            ScreenTextTiming::Automatic
        ));
        existing.ai = Some(json!({"displayTiming": "requested"}));
        assert!(should_preserve_screen_text_timing(
            &existing,
            &source,
            &generated,
            ScreenTextTiming::Automatic
        ));
        assert!(!should_preserve_screen_text_timing(
            &existing,
            &source,
            &generated,
            ScreenTextTiming::Seconds(1.0)
        ));
    }

    fn scan_frame(time: f64, blocks: Vec<ScreenTextBlock>) -> ScreenTextQueueFrame {
        ScreenTextQueueFrame {
            t: time,
            png: format!("screentext/t{time:08.2}.png"),
            width: 1600,
            height: 900,
            ocr_at: None,
            blocks,
        }
    }

    fn placed_block(id: &str, text: &str, x: f64, y: f64) -> ScreenTextBlock {
        let mut value = block(id, text, None);
        value.bbox.x = x;
        value.bbox.y = y;
        value.span = None;
        value
    }

    #[test]
    fn screen_text_similarity_is_script_agnostic_and_noise_tolerant() {
        assert_eq!(screen_text_similarity("Hello, world!", "hello world"), 1.0);
        assert!(screen_text_similarity("加速科学发现", "加速科学發现") >= 0.6);
        assert!(screen_text_similarity("AlphaGo", "AlphaGo — mastering games") > 0.2);
        assert!(screen_text_similarity("Accelerating discovery", "Q3 Roadmap") < 0.8);
    }

    #[test]
    fn scan_fold_keeps_one_caption_and_derives_grid_spans() {
        let samples = vec![
            scan_frame(0.0, vec![placed_block("b1", "Intro", 50.0, 20.0)]),
            scan_frame(5.0, vec![placed_block("b1", "Middle title", 50.0, 20.0)]),
            scan_frame(10.0, vec![placed_block("b1", "Middle title", 50.0, 20.0)]),
            scan_frame(15.0, vec![placed_block("b1", "Outro", 50.0, 20.0)]),
        ];
        let result = fold_screen_text_scan(&samples, &[], 0.0, 20.0);
        let rows = result
            .frames
            .iter()
            .flat_map(|frame| &frame.blocks)
            .collect::<Vec<_>>();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].span.as_ref().unwrap().start, 0.0);
        assert_eq!(rows[0].span.as_ref().unwrap().end, 2.5);
        assert_eq!(rows[1].span.as_ref().unwrap().start, 2.5);
        assert_eq!(rows[1].span.as_ref().unwrap().end, 12.5);
        assert_eq!(rows[2].span.as_ref().unwrap().start, 12.5);
        assert_eq!(rows[2].span.as_ref().unwrap().end, 20.0);
        assert_eq!(result.boundaries.len(), 4);
        assert_eq!(result.boundaries[0].edge, ScreenTextScanEdge::End);
        assert_eq!(
            (result.boundaries[0].lower, result.boundaries[0].upper),
            (0.0, 5.0)
        );
    }

    #[test]
    fn scan_fold_tolerates_one_flicker_but_splits_real_reappearance() {
        let caption = placed_block("b1", "Same words here", 50.0, 20.0);
        let flicker = vec![
            scan_frame(0.0, vec![caption.clone()]),
            scan_frame(5.0, Vec::new()),
            scan_frame(10.0, vec![caption.clone()]),
        ];
        assert_eq!(
            fold_screen_text_scan(&flicker, &[], 0.0, 15.0).frames.len(),
            1
        );
        let reappearance = vec![
            scan_frame(0.0, vec![caption.clone()]),
            scan_frame(5.0, Vec::new()),
            scan_frame(10.0, Vec::new()),
            scan_frame(15.0, Vec::new()),
            scan_frame(20.0, vec![caption]),
        ];
        assert_eq!(
            fold_screen_text_scan(&reappearance, &[], 0.0, 25.0)
                .frames
                .iter()
                .map(|frame| frame.t)
                .collect::<Vec<_>>(),
            vec![0.0, 20.0]
        );
    }

    #[test]
    fn scan_fold_requires_nearby_geometry_and_skips_existing_blocks() {
        let same_top = placed_block("b1", "Chapter One", 50.0, 15.0);
        let same_bottom = placed_block("b2", "Chapter One", 50.0, 80.0);
        let folded = fold_screen_text_scan(
            &[scan_frame(0.0, vec![same_top.clone(), same_bottom])],
            &[],
            0.0,
            10.0,
        );
        assert_eq!(folded.frames[0].blocks.len(), 2);

        let samples = vec![
            scan_frame(0.0, vec![same_top.clone()]),
            scan_frame(
                5.0,
                vec![
                    same_top.clone(),
                    placed_block("b2", "Something new", 50.0, 50.0),
                ],
            ),
        ];
        let existing = vec![scan_frame(0.0, vec![same_top])];
        let folded = fold_screen_text_scan(&samples, &existing, 0.0, 10.0);
        assert_eq!(folded.frames.len(), 1);
        assert_eq!(folded.frames[0].t, 5.0);
        assert_eq!(folded.frames[0].blocks[0].text, "Something new");
    }
}
