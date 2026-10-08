//! 来源自带章节（source chapters）。
//!
//! 视频平台常把作者写好的章节随视频发布：yt-dlp 的 info JSON 有 `chapters[]`
//! （YouTube 的显式章节，或它从描述里抽出的时间戳），描述正文里也常有
//! `Timestamps:` / `OUTLINE:` 这样的时间戳大纲（`0:00 - Intro`、
//! `00:01:19 The Normal One —— 普通人`，超过一小时的条目带小时位）。本模块把这两种
//! 来源整理成 [`SourceChapter`]，并提供**不经模型**的吸附：作者的时间戳最多精确到秒，
//! 又常常比真正的话题起点早几秒，所以直采时把每条吸到 transcript 最近的结构起点
//! （段落 > 句 > cue > 词）；同一层里落在同一秒的多个候选标为 ambiguous，交给用户确认。
//!
//! 纯函数、零 I/O：宿主负责读 project.json / 侧车；CLI 侧用 [`doc_anchors`] 从
//! transcript 派生锚点，App 侧用投影派生（`bcut-editor-core::source_chapters`）。
//! 有模型时整份大纲进分章契约（`engines::chapters`），模型仍在段落投影上锚定。

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::cue::{derive_cues, derive_paras, join_words};
use crate::doc::TranscriptDoc;
use crate::sentence::derive_sentences;

/// 来源给出的一章：作者的原始时间，未吸附。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceChapter {
    /// 起点秒。
    pub start: f64,
    /// 终点秒；描述里解析出的大纲没有终点。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<f64>,
    pub title: String,
}

/// 大纲里最多保留多少条（7 小时录音也不会有更多真章节；防住把整段歌词当章节）。
const MAX_SOURCE_CHAPTERS: usize = 400;
/// 标题最多保留的字符数（进模型契约与面板都够用）。
const MAX_TITLE_CHARS: usize = 160;
/// 同一份大纲里相邻两条之间允许隔多少行（一行空行或说明行）。
const MAX_LINE_GAP: usize = 3;

// ── 时间戳与描述解析 ─────────────────────────────────────────────────────

/// `M:SS` / `MM:SS` / `MMM:SS` / `H:MM:SS` / `HH:MM:SS` → 秒；别的形状 `None`。
pub fn parse_clock(text: &str) -> Option<f64> {
    let parts: Vec<&str> = text.split(':').collect();
    if !(2..=3).contains(&parts.len())
        || parts
            .iter()
            .any(|part| part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    let seconds_part = parts[parts.len() - 1];
    if seconds_part.len() != 2 {
        return None;
    }
    let seconds: u64 = seconds_part.parse().ok()?;
    if seconds >= 60 {
        return None;
    }
    let (hours, minutes) = if parts.len() == 3 {
        if parts[0].len() > 2 || parts[1].len() != 2 {
            return None;
        }
        let minutes: u64 = parts[1].parse().ok()?;
        if minutes >= 60 {
            return None;
        }
        (parts[0].parse::<u64>().ok()?, minutes)
    } else {
        if parts[0].len() > 3 {
            return None;
        }
        (0, parts[0].parse::<u64>().ok()?)
    };
    Some((hours * 3_600 + minutes * 60 + seconds) as f64)
}

/// 秒 → `HH:MM:SS`（floor），与 `chapters-source/1` 的 `data-at` 同一口径。
pub fn clock(seconds: f64) -> String {
    let total = seconds.max(0.0).floor() as u64;
    format!(
        "{:02}:{:02}:{:02}",
        total / 3_600,
        (total % 3_600) / 60,
        total % 60
    )
}

fn is_separator(c: char) -> bool {
    c.is_whitespace()
        || matches!(
            c,
            '-' | '–' | '—' | ':' | '|' | '~' | '・' | '·' | '>' | '»'
        )
}

fn is_closing_bracket(c: char) -> bool {
    matches!(c, ')' | ']' | '}' | '】' | '）' | '〕' | '>' | '》')
}

fn is_opening_bracket(c: char) -> bool {
    matches!(c, '(' | '[' | '{' | '【' | '（' | '〔' | '<' | '《')
}

/// 标题清洗：去两端分隔符与括号、压掉控制字符、截长。
fn clean_title(text: &str) -> String {
    let trimmed = text
        .trim_matches(|c: char| is_separator(c) || is_closing_bracket(c) || is_opening_bracket(c))
        .trim();
    let mut title = String::new();
    let mut pending_space = false;
    for c in trimmed.chars() {
        if c.is_control() || c.is_whitespace() {
            pending_space = !title.is_empty();
            continue;
        }
        if pending_space {
            title.push(' ');
            pending_space = false;
        }
        title.push(c);
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        let mut clipped: String = title.chars().take(MAX_TITLE_CHARS).collect();
        clipped.push('…');
        return clipped;
    }
    title
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClockForm {
    /// `0:00 - Intro`、`[00:00] Intro`、`1. 0:00 Intro`。
    Leading,
    /// `Intro - 0:00`、`Intro (0:00)`。
    Trailing,
}

struct LineCandidate {
    line: usize,
    form: ClockForm,
    start: f64,
    title: String,
}

/// 一行里的时间戳 + 标题。行首优先；行尾形只在行首没有时间戳时才算。
fn scan_line(line: &str) -> Option<(ClockForm, f64, String)> {
    // 行首：去掉列表符号 / 括号 / 表情等一切非字母数字前缀，再去掉 `1.` / `1)` 编号。
    let body = line.trim_start_matches(|c: char| !c.is_alphanumeric());
    let body = strip_ordinal(body);
    let token_len = body
        .char_indices()
        .find(|(_, c)| !(c.is_ascii_digit() || *c == ':'))
        .map(|(index, _)| index)
        .unwrap_or(body.len());
    // `4:00: Fifth` 的冒号分隔符会粘在时间戳后面，剥掉再解析。
    let token = body[..token_len].trim_end_matches(':');
    let token_len = token.len();
    let boundary_ok = body[token_len..]
        .chars()
        .next()
        .is_none_or(|c| !c.is_alphanumeric());
    if boundary_ok && let Some(start) = parse_clock(token) {
        let title = clean_title(&body[token_len..]);
        if !title.is_empty() {
            return Some((ClockForm::Leading, start, title));
        }
        return None;
    }

    // 行尾：`标题 - 0:00` / `标题 (0:00)`。
    let trimmed = line.trim_end_matches(|c: char| !c.is_alphanumeric());
    let tail_start = trimmed
        .char_indices()
        .rev()
        .find(|(_, c)| !(c.is_ascii_digit() || *c == ':'))
        .map(|(index, c)| index + c.len_utf8())
        .unwrap_or(0);
    if tail_start == 0 {
        return None;
    }
    let token = trimmed[tail_start..].trim_start_matches(':');
    let head = &trimmed[..trimmed.len() - token.len()];
    let boundary_ok = head.chars().last().is_some_and(|c| !c.is_alphanumeric());
    if boundary_ok && let Some(start) = parse_clock(token) {
        let title = clean_title(head);
        if !title.is_empty() {
            return Some((ClockForm::Trailing, start, title));
        }
    }
    None
}

/// `1. ` / `12) ` 这样的编号前缀；时间戳自身以 `:` 紧跟数字，不会被误剥。
fn strip_ordinal(text: &str) -> &str {
    let digits = text
        .char_indices()
        .find(|(_, c)| !c.is_ascii_digit())
        .map(|(index, _)| index)
        .unwrap_or(text.len());
    if digits == 0 || digits > 3 {
        return text;
    }
    let rest = &text[digits..];
    let mut chars = rest.chars();
    match (chars.next(), chars.next()) {
        (Some('.' | ')' | '、'), Some(next)) if next.is_whitespace() => {
            rest[1 + next.len_utf8()..].trim_start()
        }
        _ => text,
    }
}

/// 从视频描述里抽时间戳大纲。
///
/// 规则：逐行找「行首时间戳 + 标题」或「标题 + 行尾时间戳」；两种形都出现时只取
/// 多数形（避免 `视频总长 45:00` 这类行混进来）；按行序切成时间不减的连续段
/// （相邻两条隔太多行也断开），取最长的一段，至少两条才算大纲。
pub fn parse_description(description: &str) -> Vec<SourceChapter> {
    let mut candidates: Vec<LineCandidate> = Vec::new();
    for (line_index, line) in description.lines().enumerate() {
        if let Some((form, start, title)) = scan_line(line) {
            candidates.push(LineCandidate {
                line: line_index,
                form,
                start,
                title,
            });
        }
    }
    let leading = candidates
        .iter()
        .filter(|c| c.form == ClockForm::Leading)
        .count();
    let trailing = candidates.len() - leading;
    let keep = if leading >= trailing {
        ClockForm::Leading
    } else {
        ClockForm::Trailing
    };
    candidates.retain(|c| c.form == keep);

    let mut runs: Vec<Vec<&LineCandidate>> = Vec::new();
    for candidate in &candidates {
        let continues = runs.last().and_then(|run| run.last()).is_some_and(|last| {
            candidate.start >= last.start && candidate.line - last.line <= MAX_LINE_GAP
        });
        if continues {
            runs.last_mut().expect("run exists").push(candidate);
        } else {
            runs.push(vec![candidate]);
        }
    }
    let Some(best) = runs.iter().max_by_key(|run| run.len()) else {
        return Vec::new();
    };
    if best.len() < 2 {
        return Vec::new();
    }
    normalize(
        best.iter()
            .map(|candidate| SourceChapter {
                start: candidate.start,
                end: None,
                title: candidate.title.clone(),
            })
            .collect(),
    )
}

/// yt-dlp info JSON（或落盘的 `sourceMetadata`）的 `chapters[]`：
/// `{start_time, end_time, title}`（yt-dlp）与 `{start, end, title}`（项目清单）都认。
pub fn from_info_json(info: &Value) -> Vec<SourceChapter> {
    let Some(items) = info.get("chapters").and_then(Value::as_array) else {
        return Vec::new();
    };
    normalize(
        items
            .iter()
            .filter_map(|item| {
                let start = item
                    .get("start_time")
                    .or_else(|| item.get("start"))
                    .and_then(Value::as_f64)?;
                let end = item
                    .get("end_time")
                    .or_else(|| item.get("end"))
                    .and_then(Value::as_f64);
                let title = clean_title(item.get("title").and_then(Value::as_str).unwrap_or(""));
                (!title.is_empty()).then_some(SourceChapter { start, end, title })
            })
            .collect(),
    )
}

/// 一份来源元数据对象（`sourceMetadata` 或 yt-dlp info）里的章节：
/// 先取结构化 `chapters[]`，没有再解析 `description`。
pub fn from_metadata(source: &Value) -> Vec<SourceChapter> {
    let chapters = from_info_json(source);
    if !chapters.is_empty() {
        return chapters;
    }
    source
        .get("description")
        .and_then(Value::as_str)
        .map(parse_description)
        .unwrap_or_default()
}

/// 排序、去掉非法时间与同起点重复、截条数。
pub fn normalize(mut chapters: Vec<SourceChapter>) -> Vec<SourceChapter> {
    chapters.retain(|chapter| chapter.start.is_finite() && chapter.start >= 0.0);
    chapters.sort_by(|a, b| a.start.total_cmp(&b.start));
    chapters.dedup_by(|next, previous| next.start == previous.start);
    for chapter in &mut chapters {
        chapter.title = clean_title(&chapter.title);
        if chapter
            .end
            .is_some_and(|end| !end.is_finite() || end <= chapter.start)
        {
            chapter.end = None;
        }
    }
    chapters.retain(|chapter| !chapter.title.is_empty());
    chapters.truncate(MAX_SOURCE_CHAPTERS);
    chapters
}

// ── 吸附 ────────────────────────────────────────────────────────────────

/// 锚点层级，高层优先：段落起点（含说话人切换）> 句起点 > cue 起点 > 词起点。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnchorTier {
    Paragraph,
    Sentence,
    Cue,
    Word,
}

/// transcript 上一个可以当章节起点的位置。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anchor {
    pub tier: AnchorTier,
    /// 起点秒（首词 t0）。
    pub time: f64,
    /// 结构 id：段 `p-…` / 句 `s-…` / cue `q-…` / 词 id。
    pub id: String,
    /// 从这里开始的几个词，给确认用。
    pub snippet: String,
}

/// 「同一秒」窗：作者时间戳精确到秒，真起点落在 `[t - NEAR_BEFORE, t + NEAR_AFTER)`。
pub const NEAR_BEFORE: f64 = 1.0;
pub const NEAR_AFTER: f64 = 2.0;
/// 放宽窗：只对段落 / 句起点开放，吃掉「作者把时间写早（晚）了几秒」。
pub const WIDE_BEFORE: f64 = 4.0;
pub const WIDE_AFTER: f64 = 6.0;
/// ambiguous 时最多摆几个候选。
const MAX_CANDIDATES: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SnapStatus {
    /// 同一秒窗里恰有一个候选。
    Matched,
    /// 同一秒窗里有多个同层候选，缺省取最近的，等用户确认。
    Ambiguous,
    /// 同一秒窗里没有，放宽到几秒内的段落 / 句起点。
    Snapped,
    /// 附近没有任何结构起点，按作者原时间写入。
    Unanchored,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub anchor: Anchor,
    /// 锚点相对来源时间的偏移秒（正 = 锚点在时间戳之后）。
    pub offset: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapEntry {
    pub source: SourceChapter,
    pub status: SnapStatus,
    /// 按时间排好的候选；`Matched` / `Snapped` 恰一个，`Unanchored` 为空。
    pub candidates: Vec<Candidate>,
    /// 选中的候选下标；`None` = 用来源原时间。
    pub pick: Option<usize>,
}

impl SnapEntry {
    /// 当前生效的起点。
    pub fn start(&self) -> f64 {
        self.pick
            .and_then(|pick| self.candidates.get(pick))
            .map_or(self.source.start, |candidate| candidate.anchor.time)
    }

    /// 当前生效的锚 id（原时间时 `None`）。
    pub fn anchor_id(&self) -> Option<&str> {
        self.pick
            .and_then(|pick| self.candidates.get(pick))
            .map(|candidate| candidate.anchor.id.as_str())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapPlan {
    pub entries: Vec<SnapEntry>,
}

impl SnapPlan {
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn count(&self, status: SnapStatus) -> usize {
        self.entries
            .iter()
            .filter(|entry| entry.status == status)
            .count()
    }

    /// 改一条的选择；`None` = 用来源原时间。越界下标忽略。
    pub fn set_pick(&mut self, entry: usize, pick: Option<usize>) {
        if let Some(item) = self.entries.get_mut(entry)
            && pick.is_none_or(|pick| pick < item.candidates.len())
        {
            item.pick = pick;
        }
    }

    /// 文档重投影后重算了计划：同一条来源、同一组候选的用户选择原样带过来。
    pub fn inherit_picks(&mut self, previous: &SnapPlan) {
        for entry in &mut self.entries {
            let Some(old) = previous
                .entries
                .iter()
                .find(|old| old.source == entry.source)
            else {
                continue;
            };
            let same_candidates = old.candidates.len() == entry.candidates.len()
                && old
                    .candidates
                    .iter()
                    .zip(&entry.candidates)
                    .all(|(a, b)| a.anchor.id == b.anchor.id);
            if same_candidates {
                entry.pick = old.pick;
            }
        }
    }

    /// `(标题, 生效起点)`，按来源顺序；交给 [`resolve_rows`] 清洗。
    pub fn rows(&self) -> Vec<(String, f64)> {
        self.entries
            .iter()
            .map(|entry| (entry.source.title.clone(), entry.start()))
            .collect()
    }
}

/// 把来源章节吸到锚点上。`anchors` 不要求有序。
pub fn snap_to_anchors(source: &[SourceChapter], anchors: &[Anchor]) -> SnapPlan {
    let mut by_tier: [Vec<&Anchor>; 4] = [Vec::new(), Vec::new(), Vec::new(), Vec::new()];
    for anchor in anchors {
        if anchor.time.is_finite() {
            by_tier[anchor.tier as usize].push(anchor);
        }
    }
    for tier in &mut by_tier {
        tier.sort_by(|a, b| a.time.total_cmp(&b.time));
    }
    let within = |tier: AnchorTier, t: f64, before: f64, after: f64| -> Vec<Candidate> {
        let list = &by_tier[tier as usize];
        let low = list.partition_point(|anchor| anchor.time < t - before);
        list[low..]
            .iter()
            .take_while(|anchor| anchor.time - t <= after)
            .map(|anchor| Candidate {
                anchor: (*anchor).clone(),
                offset: anchor.time - t,
            })
            .collect()
    };
    let entries = source
        .iter()
        .map(|chapter| {
            let t = chapter.start;
            // 同一秒窗，逐层找。
            for tier in [AnchorTier::Paragraph, AnchorTier::Sentence, AnchorTier::Cue] {
                let near = within(tier, t, NEAR_BEFORE, NEAR_AFTER);
                if !near.is_empty() {
                    return entry_from_near(chapter, near);
                }
            }
            // 放宽窗：只认段落 / 句起点，取最近的一个。
            for tier in [AnchorTier::Paragraph, AnchorTier::Sentence] {
                let wide = within(tier, t, WIDE_BEFORE, WIDE_AFTER);
                if let Some(best) = nearest(&wide) {
                    return SnapEntry {
                        source: chapter.clone(),
                        status: SnapStatus::Snapped,
                        candidates: vec![wide[best].clone()],
                        pick: Some(0),
                    };
                }
            }
            let words = within(AnchorTier::Word, t, NEAR_BEFORE, NEAR_AFTER);
            if !words.is_empty() {
                return entry_from_near(chapter, words);
            }
            SnapEntry {
                source: chapter.clone(),
                status: SnapStatus::Unanchored,
                candidates: Vec::new(),
                pick: None,
            }
        })
        .collect();
    SnapPlan { entries }
}

/// 同一秒窗里的候选：一个即命中；多个则留最近的几个（按时间排），缺省选最近。
fn entry_from_near(chapter: &SourceChapter, mut near: Vec<Candidate>) -> SnapEntry {
    if near.len() == 1 {
        return SnapEntry {
            source: chapter.clone(),
            status: SnapStatus::Matched,
            candidates: near,
            pick: Some(0),
        };
    }
    near.sort_by(|a, b| rank(a).total_cmp(&rank(b)));
    near.truncate(MAX_CANDIDATES);
    near.sort_by(|a, b| a.anchor.time.total_cmp(&b.anchor.time));
    let pick = nearest(&near);
    SnapEntry {
        source: chapter.clone(),
        status: SnapStatus::Ambiguous,
        candidates: near,
        pick,
    }
}

/// 距离序：越近越好，同距离时间戳之后的优先（作者一般把时间写在话题开始前）。
fn rank(candidate: &Candidate) -> f64 {
    candidate.offset.abs() + if candidate.offset < 0.0 { 0.01 } else { 0.0 }
}

fn nearest(candidates: &[Candidate]) -> Option<usize> {
    candidates
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| rank(a).total_cmp(&rank(b)))
        .map(|(index, _)| index)
}

/// transcript 的四层锚点（§18.5 规范派生：段落 / 句 / cue / 词起点），
/// 与 LLM 分章共用同一份段落投影。
pub fn doc_anchors(doc: &TranscriptDoc) -> Vec<Anchor> {
    let cues = derive_cues(doc, &crate::layout_profile::cue_params_for_doc(doc));
    let paras = derive_paras(doc, &cues);
    let sentences = derive_sentences(doc, &cues);
    let snippet = |first: usize| -> String {
        let words = doc.words[first..]
            .iter()
            .filter(|word| {
                !word.id.is_empty() && !doc.hidden.get(&word.id).copied().unwrap_or(false)
            })
            .take(8);
        crate::filepipe::snippet(&join_words(words))
    };
    let mut anchors = Vec::new();
    for para in &paras {
        let Some(cue) = para.cue_indices.first().map(|&index| &cues[index]) else {
            continue;
        };
        let Some(&first) = cue.word_indices.first() else {
            continue;
        };
        anchors.push(Anchor {
            tier: AnchorTier::Paragraph,
            time: cue.start,
            id: para.id.clone(),
            snippet: snippet(first),
        });
    }
    for sentence in &sentences {
        let Some(&first) = sentence.word_indices.first() else {
            continue;
        };
        anchors.push(Anchor {
            tier: AnchorTier::Sentence,
            time: doc.words[first].t0,
            id: sentence.id.clone(),
            snippet: snippet(first),
        });
    }
    for cue in &cues {
        let Some(&first) = cue.word_indices.first() else {
            continue;
        };
        anchors.push(Anchor {
            tier: AnchorTier::Cue,
            time: cue.start,
            id: cue.id.clone(),
            snippet: snippet(first),
        });
        for &index in &cue.word_indices {
            anchors.push(Anchor {
                tier: AnchorTier::Word,
                time: doc.words[index].t0,
                id: doc.words[index].id.clone(),
                snippet: snippet(index),
            });
        }
    }
    anchors
}

// ── 清洗 ────────────────────────────────────────────────────────────────

/// 清洗后的一章（时间版的七步清洗结果）。
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedRow {
    pub title: String,
    pub start: f64,
    pub end: f64,
}

/// 时间版的确定性清洗（对拍 `engines::chapters::build_plan`）：丢空标题 →
/// 按（起点, 顺序）排序 → 同起点去重 → 首章钳 0 → 丢非严格递增 → 回填
/// `end = 下一章.start`，末章 = 媒体时长。
pub fn resolve_rows(rows: &[(String, f64)], duration: f64) -> Vec<ResolvedRow> {
    let mut ordered: Vec<(usize, &str, f64)> = rows
        .iter()
        .enumerate()
        .filter(|(_, (title, start))| !title.trim().is_empty() && start.is_finite())
        .map(|(order, (title, start))| (order, title.trim(), start.max(0.0)))
        .collect();
    ordered.sort_by(|a, b| a.2.total_cmp(&b.2).then(a.0.cmp(&b.0)));
    let mut plan: Vec<ResolvedRow> = Vec::with_capacity(ordered.len());
    let mut previous_source_start: Option<f64> = None;
    for (_, title, source_start) in ordered {
        if previous_source_start == Some(source_start) {
            continue;
        }
        previous_source_start = Some(source_start);
        let start = if plan.is_empty() { 0.0 } else { source_start };
        if plan.last().is_some_and(|last| start <= last.start) {
            continue;
        }
        plan.push(ResolvedRow {
            title: title.to_owned(),
            start,
            end: duration.max(start),
        });
    }
    for index in 0..plan.len().saturating_sub(1) {
        plan[index].end = plan[index + 1].start;
    }
    plan
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{DocEngine, DocMedia, Speaker, Word};
    use serde_json::json;

    const TIMESTAMPS: &str = "Palantir FDE 101.\n\nTimestamps:\n0:00 - Introduction: what this 101 covers\n1:47 - What Palantir does, and where FDE fits\n4:31 - A day in the life\n7:05 - Hiring bar and interview loop\n9:58 - Career paths after FDE\n12:12 - Common misconceptions\n13:08 - Q&A\n\nFollow me on X.";

    const OUTLINE: &str = "OUTLINE:\n00:01:19 The Normal One —— 普通人\n00:24:03 The Builder —— 建造者\n01:02:40 The Skeptic —— 怀疑者\n03:10:00 The Wanderer —— 流浪者\n06:18:45 \"42\" —— \"42\"";

    #[test]
    fn clock_parsing_handles_minutes_and_hours() {
        assert_eq!(parse_clock("0:00"), Some(0.0));
        assert_eq!(parse_clock("1:47"), Some(107.0));
        assert_eq!(parse_clock("13:08"), Some(788.0));
        assert_eq!(parse_clock("00:01:19"), Some(79.0));
        assert_eq!(parse_clock("06:18:45"), Some(22_725.0));
        assert_eq!(parse_clock("1:02:40"), Some(3_760.0));
        assert_eq!(parse_clock("125:30"), Some(7_530.0));
        assert_eq!(parse_clock("1:7"), None);
        assert_eq!(parse_clock("1:60"), None);
        assert_eq!(parse_clock("1:2:03"), None);
        assert_eq!(parse_clock("12"), None);
        assert_eq!(parse_clock("a:00"), None);
        assert_eq!(clock(22_725.0), "06:18:45");
        assert_eq!(clock(107.9), "00:01:47");
    }

    #[test]
    fn parses_a_timestamps_block_with_dash_separators() {
        let chapters = parse_description(TIMESTAMPS);
        assert_eq!(chapters.len(), 7);
        assert_eq!(chapters[0].start, 0.0);
        assert_eq!(chapters[0].title, "Introduction: what this 101 covers");
        assert_eq!(chapters[1].start, 107.0);
        assert_eq!(chapters[1].title, "What Palantir does, and where FDE fits");
        assert_eq!(chapters[6].start, 788.0);
        assert_eq!(chapters[6].title, "Q&A");
        assert!(chapters.iter().all(|chapter| chapter.end.is_none()));
    }

    #[test]
    fn parses_an_outline_with_hours_and_keeps_bilingual_titles() {
        let chapters = parse_description(OUTLINE);
        assert_eq!(chapters.len(), 5);
        assert_eq!(chapters[0].start, 79.0);
        assert_eq!(chapters[0].title, "The Normal One —— 普通人");
        assert_eq!(chapters[2].start, 3_760.0);
        assert_eq!(chapters[4].start, 22_725.0);
        assert_eq!(chapters[4].title, "\"42\" —— \"42\"");
    }

    #[test]
    fn accepts_brackets_ordinals_and_trailing_clocks() {
        let leading =
            "[00:00] Intro\n(1:30) Topic one\n1. 2:00 Third\n• 3:15 — Fourth\n⏱ 4:00: Fifth";
        let chapters = parse_description(leading);
        assert_eq!(
            chapters
                .iter()
                .map(|c| (c.start, c.title.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (0.0, "Intro"),
                (90.0, "Topic one"),
                (120.0, "Third"),
                (195.0, "Fourth"),
                (240.0, "Fifth"),
            ]
        );

        let trailing = "Intro - 0:00\nThe middle part (2:30)\nEnding [5:00]";
        let chapters = parse_description(trailing);
        assert_eq!(
            chapters
                .iter()
                .map(|c| (c.start, c.title.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (0.0, "Intro"),
                (150.0, "The middle part"),
                (300.0, "Ending")
            ]
        );
    }

    #[test]
    fn ignores_noise_lines_and_single_timestamps() {
        assert!(parse_description("Watch until 12:34 for the reveal.").is_empty());
        assert!(parse_description("0:00 Intro").is_empty());
        assert!(parse_description("No chapters here.\nJust text.").is_empty());
        // 行首形占多数时，行尾形的「视频总长」行不混进来。
        let mixed = "0:00 Intro\n3:00 Body\n6:00 Outro\n\nVideo length: 45:00";
        let chapters = parse_description(mixed);
        assert_eq!(chapters.len(), 3);
        assert_eq!(chapters[2].title, "Outro");
        // 隔了很多行的零星时间戳不续进大纲。
        let far =
            "0:00 Intro\n3:00 Body\n6:00 Outro\n\n\n\nabout\nmore text\n\n45:00 correction note";
        assert_eq!(parse_description(far).len(), 3);
        // 时间倒退切断一段，取最长的一段。
        let broken = "Part 1: 3:00\n\n0:00 Intro\n2:00 Second\n4:00 Third";
        let chapters = parse_description(broken);
        assert_eq!(chapters.len(), 3);
        assert_eq!(chapters[0].title, "Intro");
    }

    #[test]
    fn reads_yt_dlp_chapters_and_project_metadata_shapes() {
        let info = json!({
            "chapters": [
                {"start_time": 0.0, "end_time": 107.0, "title": " Introduction "},
                {"start_time": 107.0, "end_time": 271.0, "title": "What Palantir does"},
                {"start_time": 271.0, "end_time": 300.0, "title": ""}
            ],
            "description": "0:00 ignored\n1:47 ignored"
        });
        let chapters = from_metadata(&info);
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].title, "Introduction");
        assert_eq!(chapters[0].end, Some(107.0));
        assert_eq!(chapters[1].start, 107.0);

        let manifest = json!({
            "chapters": [{"start": 5.0, "end": 10.0, "title": "B"}, {"start": 0.0, "title": "A"}],
        });
        let chapters = from_metadata(&manifest);
        assert_eq!(chapters[0].title, "A");
        assert_eq!(chapters[1].end, Some(10.0));

        let described = json!({"chapters": null, "description": TIMESTAMPS});
        assert_eq!(from_metadata(&described).len(), 7);
        assert!(from_metadata(&json!({"title": "x"})).is_empty());
    }

    fn anchor(tier: AnchorTier, time: f64, id: &str) -> Anchor {
        Anchor {
            tier,
            time,
            id: id.to_owned(),
            snippet: id.to_owned(),
        }
    }

    fn source(start: f64, title: &str) -> SourceChapter {
        SourceChapter {
            start,
            end: None,
            title: title.to_owned(),
        }
    }

    #[test]
    fn snaps_by_tier_then_distance_and_flags_same_second_ties() {
        let anchors = vec![
            anchor(AnchorTier::Paragraph, 0.2, "p-a"),
            anchor(AnchorTier::Sentence, 0.2, "s-a"),
            anchor(AnchorTier::Word, 0.2, "a"),
            anchor(AnchorTier::Word, 0.7, "b"),
            // 107：段落起点在 +1.4，句起点在 +0.1 —— 段落层优先。
            anchor(AnchorTier::Sentence, 107.1, "s-c"),
            anchor(AnchorTier::Paragraph, 108.4, "p-d"),
            // 271：同一秒里两个句起点，段落没有。
            anchor(AnchorTier::Sentence, 270.6, "s-e"),
            anchor(AnchorTier::Sentence, 271.9, "s-f"),
            anchor(AnchorTier::Cue, 270.6, "q-e"),
            // 425：同一秒窗空，段落起点在 +5 → 放宽吸附。
            anchor(AnchorTier::Paragraph, 430.0, "p-g"),
            // 598：只有词。
            anchor(AnchorTier::Word, 598.3, "h"),
            anchor(AnchorTier::Word, 598.9, "i"),
        ];
        let plan = snap_to_anchors(
            &[
                source(0.0, "Intro"),
                source(107.0, "Second"),
                source(271.0, "Third"),
                source(425.0, "Fourth"),
                source(598.0, "Fifth"),
                source(900.0, "Sixth"),
            ],
            &anchors,
        );
        let statuses: Vec<SnapStatus> = plan.entries.iter().map(|e| e.status).collect();
        assert_eq!(
            statuses,
            vec![
                SnapStatus::Matched,
                SnapStatus::Matched,
                SnapStatus::Ambiguous,
                SnapStatus::Snapped,
                SnapStatus::Ambiguous,
                SnapStatus::Unanchored,
            ]
        );
        assert_eq!(plan.entries[0].anchor_id(), Some("p-a"));
        assert_eq!(plan.entries[1].anchor_id(), Some("p-d"));
        assert_eq!(plan.entries[1].start(), 108.4);
        assert_eq!(plan.entries[2].candidates.len(), 2);
        assert_eq!(plan.entries[2].anchor_id(), Some("s-e"));
        assert_eq!(plan.entries[3].start(), 430.0);
        assert_eq!(plan.entries[4].anchor_id(), Some("h"));
        assert_eq!(plan.entries[5].start(), 900.0);
        assert_eq!(plan.count(SnapStatus::Ambiguous), 2);

        let mut plan = plan;
        plan.set_pick(2, Some(1));
        plan.set_pick(2, Some(9));
        assert_eq!(plan.entries[2].anchor_id(), Some("s-f"));
        plan.set_pick(4, None);
        assert_eq!(plan.entries[4].start(), 598.0);
        let rows = plan.rows();
        assert_eq!(rows[2], ("Third".to_owned(), 271.9));

        let mut fresh =
            snap_to_anchors(&[source(271.0, "Third"), source(900.0, "Sixth")], &anchors);
        fresh.inherit_picks(&plan);
        assert_eq!(fresh.entries[0].pick, Some(1));
    }

    #[test]
    fn resolve_rows_clamps_sorts_and_fills_ends() {
        let rows = vec![
            ("Second".to_owned(), 120.0),
            ("Intro".to_owned(), 3.0),
            ("Dup".to_owned(), 120.0),
            ("".to_owned(), 200.0),
            ("Last".to_owned(), 400.0),
        ];
        let plan = resolve_rows(&rows, 600.0);
        assert_eq!(
            plan,
            vec![
                ResolvedRow {
                    title: "Intro".to_owned(),
                    start: 0.0,
                    end: 120.0
                },
                ResolvedRow {
                    title: "Second".to_owned(),
                    start: 120.0,
                    end: 400.0
                },
                ResolvedRow {
                    title: "Last".to_owned(),
                    start: 400.0,
                    end: 600.0
                },
            ]
        );
        assert!(resolve_rows(&[], 10.0).is_empty());
    }

    fn doc_with(words: &[(&str, f64, f64, &str, &str)]) -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: Some("talk.wav".to_owned()),
                hash: "sha256-00".to_owned(),
                duration: 600.0,
                sample_rate: None,
            },
            "en",
            DocEngine {
                name: "test".to_owned(),
                version: None,
                aligned_words: true,
            },
        );
        for sp in ["s1", "s2"] {
            doc.speakers.insert(
                sp.to_owned(),
                Speaker {
                    name: sp.to_uppercase(),
                    hue: None,
                },
            );
        }
        doc.words = words
            .iter()
            .map(|(id, t0, t1, text, sp)| Word {
                id: (*id).to_owned(),
                t0: *t0,
                t1: *t1,
                text: (*text).to_owned(),
                sp: (*sp).to_owned(),
                glue: false,
            })
            .collect();
        doc
    }

    #[test]
    fn doc_anchors_cover_paragraph_sentence_cue_and_word_starts() {
        let doc = doc_with(&[
            ("g1.0", 0.0, 0.4, "Hello", "s1"),
            ("g1.1", 0.4, 0.8, "there.", "s1"),
            ("g1.2", 1.0, 1.4, "Second", "s1"),
            ("g1.3", 1.4, 1.8, "sentence.", "s1"),
            ("g2.0", 120.0, 120.4, "Bye", "s2"),
            ("g2.1", 120.4, 120.8, "now.", "s2"),
        ]);
        let anchors = doc_anchors(&doc);
        let of = |tier: AnchorTier| -> Vec<(f64, String)> {
            anchors
                .iter()
                .filter(|anchor| anchor.tier == tier)
                .map(|anchor| (anchor.time, anchor.id.clone()))
                .collect()
        };
        assert_eq!(
            of(AnchorTier::Paragraph),
            vec![(0.0, "p-g1.0".to_owned()), (120.0, "p-g2.0".to_owned())]
        );
        assert_eq!(
            of(AnchorTier::Sentence),
            vec![
                (0.0, "s-g1.0".to_owned()),
                (1.0, "s-g1.2".to_owned()),
                (120.0, "s-g2.0".to_owned())
            ]
        );
        assert!(of(AnchorTier::Cue).iter().any(|(time, _)| *time == 120.0));
        assert_eq!(of(AnchorTier::Word).len(), 6);
        let para = anchors
            .iter()
            .find(|anchor| anchor.id == "p-g2.0")
            .expect("second paragraph");
        assert_eq!(para.snippet, "Bye now.");

        let plan = snap_to_anchors(&[source(0.0, "Intro"), source(119.0, "Bye")], &anchors);
        assert_eq!(plan.entries[1].status, SnapStatus::Matched);
        assert_eq!(plan.entries[1].anchor_id(), Some("p-g2.0"));
    }
}
