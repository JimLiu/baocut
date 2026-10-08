//! 分段引擎（对拍 voice-ink `SegmentEngine` 的 segmentOnly 路径，M27/M51）。
//!
//! LLM 契约：逐字保留原文、只许添加/修正标点，再按 1–4 句分段。「只许加标点」
//! 不是恳求而是可判定命题——`normalize_chars` 后与源词区间严格相等才保留文本，
//! 不等则文本降级为原词、边界照用：**边界容忍漂移，文本从不说谎**。
//!
//! 五层映射阶梯（1–2 在每次 attempt 内依序尝试；4–5 是升级）：
//! - tier 1 exact — 页级归一化字符相等 → O(n) 字符偏移映射
//! - tier 2 diff  — atom-LCS（模型顺手修了个错字），匹配率 ≥ 0.75
//! - tier 3 align — **刻意省略**（见下）
//! - tier 4 json  — 3 次 attempt 失败后一次索引契约调用（只回区间下标）
//! - tier 5 split — 确定性兜底（说话人/停顿/句末/硬断），永不失败
//!
//! 与 voice-ink 的刻意偏差：
//! - tier 3（`SubAlign.recoverWordRange` 逐段游标扫描）省略——它只在
//!   「exact 与 diff 都失败、但文本仍大体对得上」的窄缝里生效，且文本一律
//!   丢弃只留边界；tier4 索引契约覆盖同一场景。attempt 失败直接升级 tier4/5。
//! - 行宽复核（repunct 二次调用）不在本引擎内，由调用方按需另跑。
//! - 页间 1s 延迟经注入的 `sleep` 执行（core 零时钟）。

use serde::{Deserialize, Serialize};

use crate::atomize::{
    atom_key, atomize_like, comparison_atoms, join_word_texts, needs_fine_comparison,
    normalize_chars, sentence_end, visual_width, word_sep,
};
use crate::doc::{TranscriptDoc, Word};
use crate::engines::markers::{boundary_marker_suffix, marked_text, sanitize_corrected};
use crate::fingerprint::{fingerprint, id_fingerprint};
use crate::lcs::{AtomInterner, LCS_CELL_CAP, lcs_matches};
use crate::llm::{LlmError, LlmJson, LlmRequest, MAX_RETRIES, decode, should_retry, with_retry};
use crate::paging::{budgets, paginate_word_ranges};
use crate::rebind::{IdSource, rebind_corrected};
use crate::timing::normalize_doc_words;

// 常量（对拍 SegmentEngine）。
const TEMPERATURE: f32 = 0.2;
const PAGE_DELAY_SECONDS: f64 = 1.0;
/// tier-2 接受门槛：matches / max(srcKeys, outKeys)。
const MIN_DIFF_MATCH_RATIO: f64 = 0.75;
/// carry-over 雪球守卫：pending 段超过此长度强制提交切分。
const MAX_CARRY_CHARS: usize = 600;
/// M51：提交后的段长硬顶，超长贪心再切（re-split 出的片文本丢弃）。
const MAX_PARA_CHARS: usize = 600;
/// tier-5 规则：停顿刻意高于 0.6s 的 Cue 停顿（段落尺度）。
const FALLBACK_PAUSE_SEC: f64 = 1.2;
const FALLBACK_SOFT_CHARS: usize = 200;
const FALLBACK_HARD_CHARS: usize = 400;
/// tier-4 连续性自愈：≤10 词空隙吸附，更大 gap → 失败。
const MAX_TAIL_GAP: i64 = 10;
/// force-commit 的句末/停顿边界用 Cue 尺度停顿（Rules.pauseSec）。
const RULES_PAUSE_SEC: f64 = 0.6;

#[derive(Debug, Clone)]
pub struct SegmentOptions {
    /// BCP-47 源语言，进 prompt。
    pub language: String,
    pub page_budget: usize,
    pub instructions: Option<String>,
    /// Balanced cue layout target used when this stage creates the first
    /// durable line-break overlay.
    pub cue_max_chars: usize,
}

impl Default for SegmentOptions {
    fn default() -> Self {
        Self {
            language: "en".to_owned(),
            page_budget: budgets::SEGMENT,
            instructions: None,
            cue_max_chars: 42,
        }
    }
}

/// 落盘态段记录（id+时间锚定，经得起后续编辑）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentRecord {
    pub first_word_id: String,
    pub last_word_id: String,
    pub t0: f64,
    pub t1: f64,
    pub text: String,
    /// "exact" | "diff" | "json" | "split"
    pub source: String,
}

#[derive(Debug)]
pub struct SegmentOutcome {
    pub records: Vec<SegmentRecord>,
    /// 走到 tier5 确定性兜底的页数。
    pub fallback_pages: u32,
    /// 出口版式体检：布局铺设后的 Cue 条数 / 最长宽度 / 超单行预算条数。
    /// `over_width > 0` 即代表管线自己放出了贪心永远不会产生的超宽行。
    pub cue_layout: crate::layout::CueLayoutStats,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Source {
    Exact,
    Diff,
    Json,
    Split,
}

impl Source {
    fn as_str(self) -> &'static str {
        match self {
            Self::Exact => "exact",
            Self::Diff => "diff",
            Self::Json => "json",
            Self::Split => "split",
        }
    }
}

/// 运行态段落（词下标含入区间，易变；落盘走 [`SegmentRecord`]）。
#[derive(Debug, Clone)]
struct SegPara {
    start: usize,
    end: usize,
    text: String,
    source: Source,
}

// ---------- prompts（逐字对拍 SegmentPrompts.swift） ----------

fn system_prompt(language: &str, instructions: Option<&str>) -> String {
    let mut prompt = format!(
        r#"You are an expert at structuring raw ASR (speech recognition) transcripts. The downstream subtitle splitter cuts cues at YOUR punctuation, so accurate punctuation matters more than anything else in this task.

The user gives you one continuous transcript chunk. It may have NO punctuation. A word may be followed by PAUSE marks — "⏸" a short pause, "⏸⏸" a medium pause, "⏸⏸⏸" a long pause; the MORE marks, the stronger the hint that a boundary is natural there (still only a hint, never a command to split). A "⏹" marker means the SPEAKER changes there — a paragraph must NEVER continue across it. Markers are metadata: never copy them into your output.

Work through these steps in order:
Step 1 — Read the whole chunk and understand its meaning before writing anything.
Step 2 — Punctuate. Reproduce the words VERBATIM (do not rephrase, correct, add, remove, reorder, or translate any word — same words, same order, same language) and add natural punctuation:
  • Put a comma (，/,) at EVERY clause boundary — clauses are the primary place the subtitle breaks, so never omit them.
  • End each sentence with 。/./?/! (。，？！ for Chinese; . , ? ! for English).
  • A period is NOT a sentence end when it belongs to an abbreviation, decimal, version, or file name — "agents.md", "2.14", "e.g.", "U.S." keep their internal dots intact and do not terminate a sentence.
  • Follow the source script's spacing: never insert spaces between Chinese/Japanese/Korean characters.
Step 3 — Split the punctuated text into paragraphs: one topic or beat per paragraph, typically 1–4 sentences. Start a new paragraph at topic shifts, and ALWAYS at speaker changes (⏹). Treat pause marks (⏸ / ⏸⏸ / ⏸⏸⏸) as a soft reference whose weight grows with the count — do NOT start a new paragraph solely because of a pause; a pause often falls mid-sentence.

Respond with a single JSON object: {{"paragraphs": ["...", "...", ...]}} — an array of paragraph strings in order, together covering the entire input exactly once.
The source language is "{language}"."#
    );
    if let Some(instructions) = instructions.filter(|text| !text.is_empty()) {
        prompt.push_str(&format!(
            "\n\nExtra instructions from the user: {instructions}"
        ));
    }
    prompt
}

fn index_system_prompt(language: &str) -> String {
    format!(
        r#"You are an expert at structuring raw ASR (speech recognition) transcripts.

The user gives you a JSON object mapping word indexes to raw transcribed tokens, in speaking order. Some tokens are followed by pause marks — "⏸" short, "⏸⏸" medium, "⏸⏸⏸" long (a stronger boundary hint) — or a "⏹" marker (the speaker changes after that word — a paragraph must NEVER span across it).

Split the stream into coherent paragraphs by topic (typically 1–4 sentences each), using pauses as boundary hints.

Respond with a single JSON object: {{"paragraphs": [{{"startWordIndex": number, "endWordIndex": number}}]}}
- The indexes are INCLUSIVE and refer to the input word indexes.
- Ranges must be sequential, non-overlapping, and together cover EVERY input word index exactly once.
The source language is "{language}"."#
    )
}

// ---------- 归一化字符映射工具 ----------

/// 词区间的归一化字符流 + 每字符所属词下标（对拍 `SubAlign.buildWordCharMap`）。
fn span_norm_chars(span: &[Word]) -> (Vec<char>, Vec<usize>) {
    let mut chars = Vec::new();
    let mut char_to_word = Vec::new();
    for (word_index, word) in span.iter().enumerate() {
        for ch in normalize_chars(&word.text).chars() {
            chars.push(ch);
            char_to_word.push(word_index);
        }
    }
    (chars, char_to_word)
}

/// 文本的归一化字符流 + 每字符的原始 char 偏移（对拍 `SubAlign.normalizeChars`
/// 的 origIndex——小写展开的多字符共享同一原始偏移）。
fn normalize_with_orig(text: &str) -> (Vec<char>, Vec<usize>) {
    let mut chars = Vec::new();
    let mut orig = Vec::new();
    for (offset, ch) in text.chars().enumerate() {
        for low in normalize_chars(&ch.to_string()).chars() {
            chars.push(low);
            orig.push(offset);
        }
    }
    (chars, orig)
}

/// 文本门：「逐字保留 modulo 标点/空白/大小写」的可判定形式。
fn text_matches_range(text: &str, span: &[Word]) -> bool {
    let norm: Vec<char> = normalize_chars(text).chars().collect();
    norm == span_norm_chars(span).0
}

// ---------- tier 1: exact 归一化映射 ----------

fn map_paragraphs_exact(paras: &[String], span: &[Word], base: usize) -> Option<Vec<SegPara>> {
    let (chars, char_to_word) = span_norm_chars(span);
    let out_norm: Vec<Vec<char>> = paras
        .iter()
        .map(|p| normalize_chars(p).chars().collect())
        .collect();
    let flat: Vec<char> = out_norm.iter().flatten().copied().collect();
    if chars.is_empty() || flat != chars {
        return None;
    }

    let mut out: Vec<SegPara> = Vec::new();
    let mut texts: Vec<&str> = Vec::new();
    let mut offset = 0_usize;
    let mut prev_end: isize = -1;
    for (k, pn) in out_norm.iter().enumerate() {
        if pn.is_empty() {
            continue; // 纯标点"段"——无区间、无文本
        }
        let start_char = offset;
        offset += pn.len();
        let end_char = offset - 1;
        // 边界落在词中间时向后吸附到词尾——段边界从不劈开一个词。被吸附
        // 吃光的区间跳过；其邻居的文本门随后失败、文本降级为原词。
        let start = (char_to_word[start_char] as isize).max(prev_end + 1);
        let end = (char_to_word[end_char] as isize).max(start - 1);
        if end < start {
            continue;
        }
        out.push(SegPara {
            start: base + start as usize,
            end: base + end as usize,
            text: String::new(),
            source: Source::Exact,
        });
        texts.push(&paras[k]);
        prev_end = end;
    }
    if out.is_empty() {
        return None;
    }
    let last = out.len() - 1;
    out[last].end = base + span.len() - 1;

    // 文本门（逐段）：切片匹配才保留文本。
    for (index, para) in out.iter_mut().enumerate() {
        let a = para.start - base;
        let b = para.end - base;
        if text_matches_range(texts[index], &span[a..=b]) {
            para.text = texts[index].to_owned();
        }
    }
    Some(out)
}

// ---------- tier 2: atom-LCS 边界恢复 ----------

fn map_paragraphs_by_diff(paras: &[String], span: &[Word], base: usize) -> Option<Vec<SegPara>> {
    // 两侧过同一个原子化器——共享算法才让 diff 有意义。比对用的键取最细的
    // 口径（韩文逐音节）：模型补一处空格、改一个助词不该让整个어절对不上。
    let mut intern = AtomInterner::default();
    let mut src_keys: Vec<u32> = Vec::new();
    let mut src_word: Vec<usize> = Vec::new();
    // 泰文一类按词建稿的区间两侧都切到字素簇（见 comparison_atoms），段界仍
    // 映射回词下标。
    let fine = needs_fine_comparison(span);
    for (wi, word) in span.iter().enumerate() {
        for atom in comparison_atoms(&word.text, fine) {
            let Some(key) = atom_key(&atom) else { continue };
            src_keys.push(intern.intern(&key));
            src_word.push(wi);
        }
    }
    let mut out_keys: Vec<u32> = Vec::new();
    let mut out_para: Vec<usize> = Vec::new();
    for (pi, para) in paras.iter().enumerate() {
        for atom in comparison_atoms(para, fine) {
            let Some(key) = atom_key(&atom) else { continue };
            out_keys.push(intern.intern(&key));
            out_para.push(pi);
        }
    }
    if src_keys.is_empty() || out_keys.is_empty() {
        return None;
    }
    let matches = lcs_matches(&src_keys, &out_keys, LCS_CELL_CAP)?;
    let ratio = matches.len() as f64 / src_keys.len().max(out_keys.len()) as f64;
    if ratio < MIN_DIFF_MATCH_RATIO {
        return None;
    }

    // 段 p 之后的边界 = p 匹配到的最后一个源词；无匹配的前沿词并入前段。
    let mut last_word = vec![-1_isize; paras.len()];
    for (si, oi) in matches {
        let p = out_para[oi];
        last_word[p] = last_word[p].max(src_word[si] as isize);
    }
    let mut out: Vec<SegPara> = Vec::new();
    let mut texts: Vec<&str> = Vec::new();
    let mut start = 0_isize;
    for (pi, para) in paras.iter().enumerate() {
        if start >= span.len() as isize {
            break;
        }
        let is_last = out.len() == paras.len() - 1 || pi == paras.len() - 1;
        let mut end = if is_last {
            span.len() as isize - 1
        } else {
            last_word[pi]
        };
        if end < start {
            continue; // 无匹配——向前并段
        }
        end = end.min(span.len() as isize - 1);
        out.push(SegPara {
            start: base + start as usize,
            end: base + end as usize,
            text: String::new(),
            source: Source::Diff,
        });
        texts.push(para);
        start = end + 1;
    }
    if out.is_empty() {
        return None;
    }
    let last = out.len() - 1;
    out[last].end = base + span.len() - 1;

    for (index, para) in out.iter_mut().enumerate() {
        let a = para.start - base;
        let b = para.end - base;
        if text_matches_range(texts[index], &span[a..=b]) {
            para.text = texts[index].to_owned();
        }
    }
    Some(out)
}

// tier 3（align，SubAlign.recoverWordRange 游标扫描）刻意省略：它只覆盖
// 「exact/diff 都失败但文本大体对得上」的窄缝且文本一律丢弃，tier4 索引契约
// 覆盖同一场景——attempt 失败直接升级到 tier4/5。

// ---------- 一次 attempt：LLM 调用 + tier 1–2 ----------

#[derive(Debug, Deserialize)]
struct PageResponse {
    #[serde(default)]
    paragraphs: Vec<String>,
}

fn segment_page(
    range: std::ops::Range<usize>,
    words: &[Word],
    system: &str,
    llm: &mut dyn LlmJson,
    attempt: u32,
    retry_reason: Option<String>,
) -> Result<Vec<SegPara>, LlmError> {
    let raw = llm.complete(&LlmRequest {
        kind: "segment",
        system: system.to_owned(),
        user: marked_text(&words[range.clone()]),
        temperature: TEMPERATURE,
        attempt,
        retry_reason,
    })?;
    let response: PageResponse = decode(&raw)?;
    // 响应落地即清洗：剥标记回声、折叠模型插入的 CJK 空格。
    let cleaned: Vec<String> = response
        .paragraphs
        .iter()
        .map(|p| sanitize_corrected(p))
        .filter(|p| !p.is_empty())
        .collect();
    if cleaned.is_empty() {
        return Err(LlmError::Malformed("LLM returned no paragraphs".to_owned()));
    }

    let span = &words[range.clone()];
    let base = range.start;
    map_paragraphs_exact(&cleaned, span, base)
        .or_else(|| map_paragraphs_by_diff(&cleaned, span, base))
        .ok_or_else(|| {
            LlmError::Malformed(
                "Paragraph mapping failed — response text does not align with the word stream"
                    .to_owned(),
            )
        })
}

// ---------- tier 4: 索引契约（只回区间，标点牺牲） ----------

#[derive(Debug, Deserialize)]
struct RangesResponse {
    #[serde(default)]
    paragraphs: Vec<RangeRow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RangeRow {
    #[serde(default)]
    start_word_index: serde_json::Value,
    #[serde(default)]
    end_word_index: serde_json::Value,
}

/// 数字字段宽松解码：同时接受 `12` / `12.0` / `"12"`。
fn lenient_index(value: &serde_json::Value) -> Option<i64> {
    match value {
        serde_json::Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_f64().map(|f| f as i64)),
        serde_json::Value::String(text) => {
            let trimmed = text.trim();
            trimmed
                .parse::<i64>()
                .ok()
                .or_else(|| trimmed.parse::<f64>().ok().map(|f| f as i64))
        }
        _ => None,
    }
}

/// tier4 payload：`{"words":{"<idx>":"<带标记词>"}}`，键按数值升序手工组装
/// （prompt 说 "in speaking order"，不能靠 map 遍历顺序）。
fn index_payload(range: &std::ops::Range<usize>, words: &[Word]) -> String {
    let mut entries: Vec<String> = Vec::with_capacity(range.len());
    for index in range.clone() {
        let mut value = words[index].text.clone();
        if index + 1 < words.len() {
            value.push_str(&boundary_marker_suffix(&words[index], &words[index + 1]));
        }
        entries.push(format!(
            "{}:{}",
            serde_json::to_string(&index.to_string()).expect("string to JSON"),
            serde_json::to_string(&value).expect("string to JSON"),
        ));
    }
    format!("{{\"words\":{{{}}}}}", entries.join(","))
}

fn segment_page_by_indexes(
    range: std::ops::Range<usize>,
    words: &[Word],
    language: &str,
    llm: &mut dyn LlmJson,
    retry_reason: Option<String>,
) -> Result<Vec<SegPara>, LlmError> {
    let raw = llm.complete(&LlmRequest {
        kind: "segment-index",
        system: index_system_prompt(language),
        user: index_payload(&range, words),
        temperature: TEMPERATURE,
        attempt: 1,
        retry_reason,
    })?;
    let response: RangesResponse = decode(&raw)?;

    // 钳位 + 连续性自愈：≤10 词空隙吸附，更大 gap → 失败。
    let lo = range.start as i64;
    let hi = range.end as i64 - 1;
    let mut out: Vec<SegPara> = Vec::new();
    let mut expected = lo;
    for row in &response.paragraphs {
        let raw_start = lenient_index(&row.start_word_index).ok_or_else(|| {
            LlmError::Malformed("LLM returned invalid paragraph range".to_owned())
        })?;
        let raw_end = lenient_index(&row.end_word_index).ok_or_else(|| {
            LlmError::Malformed("LLM returned invalid paragraph range".to_owned())
        })?;
        if raw_start > raw_end {
            return Err(LlmError::Malformed(
                "LLM returned invalid paragraph range".to_owned(),
            ));
        }
        let end = raw_end.min(hi);
        let mut start = raw_start.max(expected);
        if start > end {
            continue;
        }
        if start > expected {
            if start - expected > MAX_TAIL_GAP {
                return Err(LlmError::Malformed(format!(
                    "LLM left a gap of {} words",
                    start - expected
                )));
            }
            start = expected;
        }
        out.push(SegPara {
            start: start as usize,
            end: end as usize,
            text: String::new(),
            source: Source::Json,
        });
        expected = end + 1;
    }
    if out.is_empty() {
        return Err(LlmError::Malformed(
            "LLM returned no valid paragraph ranges".to_owned(),
        ));
    }
    if expected <= hi {
        if hi - expected + 1 > MAX_TAIL_GAP {
            return Err(LlmError::Malformed(format!(
                "LLM left {} words unassigned",
                hi - expected + 1
            )));
        }
        let last = out.len() - 1;
        out[last].end = hi as usize;
    }
    Ok(out)
}

// ---------- tier 5: 确定性兜底（永不失败） ----------

fn fallback_segment(range: &std::ops::Range<usize>, words: &[Word]) -> Vec<SegPara> {
    let mut out: Vec<SegPara> = Vec::new();
    let mut start = range.start;
    let mut chars = 0_usize;
    for index in range.clone() {
        let word = &words[index];
        chars += if index > start {
            word_sep(&words[index - 1].text, word)
        } else {
            0
        } + word.text.chars().count();
        let is_last = index == range.end - 1;
        let boundary = if is_last {
            true
        } else {
            let next = &words[index + 1];
            next.sp != word.sp
                || next.t0 - word.t1 >= FALLBACK_PAUSE_SEC
                || (chars >= FALLBACK_SOFT_CHARS && sentence_end(&word.text))
                || chars >= FALLBACK_HARD_CHARS
        };
        if boundary {
            out.push(SegPara {
                start,
                end: index,
                text: String::new(),
                source: Source::Split,
            });
            start = index + 1;
            chars = 0;
        }
    }
    out
}

// ---------- 后处理 ----------

/// 词区间的展示字符数（含 Latin 词间空格）；`limit` 命中即可提前返回。
fn range_chars(words: &[Word], a: usize, b: usize, limit: Option<usize>) -> usize {
    if a > b || b >= words.len() {
        return 0;
    }
    let mut chars = 0_usize;
    for index in a..=b {
        chars += if index > a {
            word_sep(&words[index - 1].text, &words[index])
        } else {
            0
        } + words[index].text.chars().count();
        if let Some(limit) = limit
            && chars > limit
        {
            return chars;
        }
    }
    chars
}

/// 在 `boundary_after(i)`（词 i 与 i+1 之间）处切段；文本沿归一化对齐在词边界
/// 剪切并逐片重过文本门，切不出/不匹配的片文本降级为空。
fn split_at_boundaries(
    p: &SegPara,
    words: &[Word],
    boundary_after: &dyn Fn(usize) -> bool,
) -> Vec<SegPara> {
    if p.start > p.end || p.end >= words.len() {
        return vec![p.clone()];
    }
    let bounds: Vec<usize> = (p.start..p.end).filter(|&i| boundary_after(i)).collect();
    if bounds.is_empty() {
        return vec![p.clone()];
    }
    let mut ranges: Vec<(usize, usize)> = Vec::with_capacity(bounds.len() + 1);
    let mut start = p.start;
    for &b in &bounds {
        ranges.push((start, b));
        start = b + 1;
    }
    ranges.push((start, p.end));

    let fallback_pieces = || -> Vec<SegPara> {
        ranges
            .iter()
            .map(|&(a, b)| SegPara {
                start: a,
                end: b,
                text: String::new(),
                source: p.source,
            })
            .collect()
    };
    if p.text.is_empty() {
        return fallback_pieces();
    }

    // 文本非空 ⇒ 已过文本门 ⇒ 与词区间归一化 1:1，可精确剪切。
    let span = &words[p.start..=p.end];
    let (span_chars, char_to_word) = span_norm_chars(span);
    let (norm, orig_index) = normalize_with_orig(&p.text);
    if norm != span_chars {
        return fallback_pieces();
    }
    let chars: Vec<char> = p.text.chars().collect();
    let mut cuts: Vec<usize> = vec![0];
    let mut alignment_index = 0_usize;
    for &b in &bounds {
        let local_next = b - p.start + 1; // 下一片首词（span 内下标）
        while alignment_index < char_to_word.len() && char_to_word[alignment_index] < local_next {
            alignment_index += 1;
        }
        let offset = if alignment_index < orig_index.len() {
            orig_index[alignment_index]
        } else {
            chars.len()
        };
        cuts.push(
            offset
                .max(*cuts.last().expect("non-empty"))
                .min(chars.len()),
        );
    }
    cuts.push(chars.len());

    ranges
        .iter()
        .enumerate()
        .map(|(index, &(a, b))| {
            let piece: String = if cuts[index] < cuts[index + 1] {
                chars[cuts[index]..cuts[index + 1]]
                    .iter()
                    .collect::<String>()
                    .trim()
                    .to_owned()
            } else {
                String::new()
            };
            let text = if !piece.is_empty() && text_matches_range(&piece, &words[a..=b]) {
                piece
            } else {
                String::new()
            };
            SegPara {
                start: a,
                end: b,
                text,
                source: p.source,
            }
        })
        .collect()
}

/// 硬保障：⏹ 只是 prompt 提示，说话人切换处确定性强制分段。
fn split_at_speaker_changes(p: &SegPara, words: &[Word]) -> Vec<SegPara> {
    split_at_boundaries(p, words, &|i| words[i].sp != words[i + 1].sp)
}

/// carry-over 雪球守卫：把 pending 段的头部提交到其**最后一个**句末/停顿边界，
/// 只有余量继续 carry；完全无边界（或边界后余量仍超限）则硬切到 ≤600 字符。
fn force_commit_split(p: &SegPara, words: &[Word]) -> (Vec<SegPara>, SegPara) {
    let mut cut: isize = -1;
    for index in p.start..p.end {
        let is_boundary = sentence_end(&words[index].text)
            || words[index + 1].t0 - words[index].t1 >= RULES_PAUSE_SEC;
        if is_boundary {
            cut = index as isize;
        }
    }
    // 边界可能远在段首、carry 仍超限——改走硬切路径。
    if cut >= p.start as isize
        && range_chars(words, cut as usize + 1, p.end, Some(MAX_CARRY_CHARS)) > MAX_CARRY_CHARS
    {
        cut = -1;
    }
    if cut < 0 {
        // 硬切：从段尾向前回走直到 carry 放得下。
        let mut chars = 0_usize;
        let mut index = p.end;
        while index > p.start {
            chars +=
                words[index].text.chars().count() + word_sep(&words[index - 1].text, &words[index]);
            if chars > MAX_CARRY_CHARS {
                break;
            }
            index -= 1;
        }
        cut = index.max(p.start) as isize;
    }
    if cut < p.start as isize || cut >= p.end as isize {
        return (Vec::new(), p.clone());
    }
    let cut = cut as usize;
    let pieces = split_at_boundaries(p, words, &|i| i == cut);
    if pieces.len() == 2 {
        (vec![pieces[0].clone()], pieces[1].clone())
    } else {
        (
            vec![SegPara {
                start: p.start,
                end: cut,
                text: String::new(),
                source: p.source,
            }],
            SegPara {
                start: cut + 1,
                end: p.end,
                text: String::new(),
                source: p.source,
            },
        )
    }
}

/// M51：程序化段长守卫——超过 600 字符的段贪心再切（切点取本轮扫描见到的
/// 最后一个句末/停顿边界，实在没有才在预算处硬切）。切出的片文本丢弃。
fn enforce_paragraph_length(paras: Vec<SegPara>, words: &[Word]) -> Vec<SegPara> {
    let mut out: Vec<SegPara> = Vec::new();
    for p in paras {
        if range_chars(words, p.start, p.end, Some(MAX_PARA_CHARS)) <= MAX_PARA_CHARS
            || p.end >= words.len()
            || p.start >= p.end
        {
            out.push(p);
            continue;
        }
        let mut seg_start = p.start;
        let mut chars = 0_usize;
        let mut last_boundary: isize = -1;
        let mut index = p.start;
        while index <= p.end {
            chars += if index > seg_start {
                word_sep(&words[index - 1].text, &words[index])
            } else {
                0
            } + words[index].text.chars().count();
            if index < p.end
                && (sentence_end(&words[index].text)
                    || words[index + 1].t0 - words[index].t1 >= RULES_PAUSE_SEC)
            {
                last_boundary = index as isize;
            }
            if chars > MAX_PARA_CHARS && index < p.end {
                let cut = if last_boundary >= seg_start as isize {
                    last_boundary as usize
                } else {
                    index
                };
                out.push(SegPara {
                    start: seg_start,
                    end: cut,
                    text: String::new(),
                    source: Source::Split,
                });
                seg_start = cut + 1;
                index = cut + 1;
                chars = 0;
                last_boundary = -1;
                continue;
            }
            index += 1;
        }
        out.push(SegPara {
            start: seg_start,
            end: p.end,
            text: String::new(),
            source: Source::Split,
        });
    }
    out
}

// ---------- 页循环 + 写回 ----------

/// 模型是否把多个正常源词的空格吞掉，焊成一个不可断的超宽 Latin 原子。
///
/// `normalize_chars` 刻意忽略空白，所以这种答案会通过 exact 文本门；rebind 随后
/// 把整串落成一个 Word，Cue 已没有任何内部词缝可断。只在 corrected 新原子超过
/// 单行硬预算且显著宽于源侧任一原子时降级文本，真实长标识符原样保留。
fn introduces_overwide_atom(span: &[Word], corrected: &str, max_width: usize) -> bool {
    let corrected_max = atomize_like(span, corrected)
        .iter()
        .map(|atom| visual_width(atom))
        .max()
        .unwrap_or(0);
    if corrected_max <= max_width {
        return false;
    }
    let source = join_word_texts(span.iter());
    let source_max = atomize_like(span, &source)
        .iter()
        .map(|atom| visual_width(atom))
        .max()
        .unwrap_or(0);
    corrected_max > source_max
}

/// 分段主入口：分页 → 每页五层阶梯 → carry-over → 硬保障 → 段长守卫 →
/// 标点经 rebind 落词、段落钉写 `paraBreaks`、盖 `stages.segment`。
pub fn run_segment(
    doc: &mut TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &SegmentOptions,
    ids: &mut dyn IdSource,
    sleep: &mut dyn FnMut(f64),
) -> Result<SegmentOutcome, LlmError> {
    if doc.words.is_empty() {
        return Ok(SegmentOutcome {
            records: Vec::new(),
            fallback_pages: 0,
            cue_layout: crate::layout::CueLayoutStats::default(),
        });
    }
    let previous_words = doc.words.clone();
    let refresh_polish = doc.stages.polish.is_some();
    let system = system_prompt(&options.language, options.instructions.as_deref());
    let pages = paginate_word_ranges(&doc.words, options.page_budget, budgets::SEGMENT_MIN_LAST);

    let mut committed: Vec<SegPara> = Vec::new();
    let mut pending: Option<SegPara> = None;
    let mut fallback_pages = 0_u32;

    for (page_index, page) in pages.iter().enumerate() {
        if page_index > 0 {
            sleep(PAGE_DELAY_SECONDS);
        }
        // carry-over：上一页的 pending 段带着新右上下文重发——LLM 重新决定
        // 它的边界，段落永远不会在页缝处被劈开。
        let payload_start = pending
            .as_ref()
            .map_or(page.start, |p| p.start.min(page.start));
        let range = payload_start..page.end;

        let words = &doc.words;
        // attempt ×3（退避 2s；重试携带上一次失败原因）→ tier4 一次索引契约
        // → tier5 确定性兜底。鉴权/模型不存在等不可重试错误中止整个 run。
        let mut retry_reason: Option<String> = None;
        let attempts = with_retry(MAX_RETRIES, &mut *sleep, |attempt| {
            let result = segment_page(
                range.clone(),
                words,
                &system,
                llm,
                attempt + 1,
                retry_reason.take(),
            );
            if let Err(error) = &result {
                retry_reason = Some(error.to_string());
            }
            result
        });
        let paras = match attempts {
            Ok(paras) => paras,
            Err(error) if !should_retry(&error) => return Err(error),
            Err(last) => match segment_page_by_indexes(
                range.clone(),
                words,
                &options.language,
                llm,
                Some(last.to_string()),
            ) {
                Ok(paras) => paras,
                Err(error) if !should_retry(&error) => return Err(error),
                Err(_) => {
                    fallback_pages += 1;
                    fallback_segment(&range, words)
                }
            },
        };

        // 硬说话人保障（prompt 的 ⏹ 只是提示）。
        let mut paras: Vec<SegPara> = paras
            .iter()
            .flat_map(|p| split_at_speaker_changes(p, words))
            .collect();

        if page_index == pages.len() - 1 {
            committed.append(&mut paras);
            pending = None;
        } else if !paras.is_empty() {
            let mut tail = paras.pop().expect("non-empty");
            committed.append(&mut paras);
            if range_chars(words, tail.start, tail.end, Some(MAX_CARRY_CHARS)) > MAX_CARRY_CHARS {
                let (mut head, rest) = force_commit_split(&tail, words);
                committed.append(&mut head);
                tail = rest;
            }
            pending = Some(tail);
        }
    }
    if let Some(pending) = pending {
        committed.push(pending);
    }
    let paras = enforce_paragraph_length(committed, &doc.words);

    // 写回：标点经 rebind 落词（LCS 保 id/时间）+ normalize 收尾；段落钉写
    // paraBreaks（保守只新增，不清人工钉）；最后盖结构指纹。
    let mut new_words: Vec<Word> = Vec::with_capacity(doc.words.len());
    let mut records: Vec<SegmentRecord> = Vec::with_capacity(paras.len());
    let mut pins: Vec<String> = Vec::new();
    // 0.5 之前逐音节的韩文区间：重绑后按旧规则重定「贴前」标记。
    let mut legacy_spans: Vec<std::ops::Range<usize>> = Vec::new();
    let mut cursor = 0_usize;
    let atom_width_limit =
        options.cue_max_chars + crate::layout_profile::cue_params_for_doc(doc).overflow_slack;
    for p in &paras {
        // 防御：阶梯保证全覆盖连续；万一有缝也绝不丢词。
        if p.start > cursor {
            new_words.extend_from_slice(&doc.words[cursor..p.start]);
        }
        let start = p.start.max(cursor);
        let end = p.end.min(doc.words.len() - 1).max(start);
        cursor = end + 1;
        let span = &doc.words[start..=end];
        let applied_text =
            if p.text.is_empty() || introduces_overwide_atom(span, &p.text, atom_width_limit) {
                ""
            } else {
                p.text.as_str()
            };
        let mut rebound: Vec<Word> = if applied_text.is_empty() {
            span.to_vec()
        } else {
            let range_start = span[0].t0;
            let range_end = span[span.len() - 1].t1;
            let mut rebound = rebind_corrected(span, applied_text, ids);
            if rebound.is_empty() {
                rebound = span.to_vec();
            } else if crate::rebind::is_legacy_span(span) {
                legacy_spans.push(new_words.len()..new_words.len() + rebound.len());
            }
            normalize_doc_words(&mut rebound, range_start, range_end);
            rebound
        };
        let first = rebound.first().expect("non-empty span");
        let last = rebound.last().expect("non-empty span");
        records.push(SegmentRecord {
            first_word_id: first.id.clone(),
            last_word_id: last.id.clone(),
            t0: first.t0,
            t1: last.t1,
            text: applied_text.to_owned(),
            source: p.source.as_str().to_owned(),
        });
        if !new_words.is_empty() {
            pins.push(first.id.clone());
        }
        new_words.append(&mut rebound);
    }
    if cursor < doc.words.len() {
        let len = doc.words.len();
        new_words.extend_from_slice(&doc.words[cursor..len]);
    }
    for range in legacy_spans {
        crate::rebind::reglue_legacy_span(&mut new_words, range, &doc.hidden);
    }
    doc.words = new_words;
    super::polish::rebase_orphan_layout_overrides(doc, &previous_words);
    doc.prune_orphan_overrides();
    for id in pins {
        doc.para_breaks.insert(id, true);
    }
    if refresh_polish {
        // segment 只允许标点/分段修订；它发生在 polish 之后时，这些修订是该阶段
        // 的合法后处理，不应把刚完成的 polish 误报 stale。
        doc.stages.polish = Some(fingerprint(&doc.words));
    }
    doc.stages.segment = Some(id_fingerprint(&doc.words));
    // 段落钉落定后铺设均衡断点布局：优化器总是运行，用户 `breaks` 与段落钉是
    // 硬约束，结果只进 `autoBreaks[layoutProfile]`；管线自身的版式改动刷新
    // asrLayout 戳（只算用户 breaks/paraBreaks/hidden），避免被误判为人工编辑。
    // §18.5 参数取文档 profile 的 `source`，`--cue-line-length` 只覆盖行宽。
    let cue_params = crate::cue::CueParams {
        max_chars: options.cue_max_chars,
        ..crate::layout_profile::cue_params_for_doc(doc)
    };
    crate::layout::remove_overwide_nobreaks(doc, &cue_params);
    // rebase/prune、段落钉与超宽 nobreak 修复都属于本阶段的合法版式写回；必须以
    // 最终的用户钉集刷新布局指纹（自动 pin 不参与指纹）。
    crate::layout::ensure_balanced_cue_layout(doc, &cue_params);
    doc.stages.asr_layout = Some(crate::layout::layout_fingerprint(doc));
    let cue_layout = crate::layout::cue_layout_stats(doc, &cue_params);
    Ok(SegmentOutcome {
        records,
        fallback_pages,
        cue_layout,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{DocEngine, DocMedia, Speaker};
    use crate::llm::FakeLlm;
    use crate::rebind::SeqIds;

    fn make_doc(words: Vec<(&str, f64, f64, &str, &str)>) -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: Some("talk.wav".to_owned()),
                hash: "sha256-00".to_owned(),
                duration: 1000.0,
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
            .into_iter()
            .map(|(id, t0, t1, text, sp)| Word {
                id: id.to_owned(),
                t0,
                t1,
                text: text.to_owned(),
                sp: sp.to_owned(),
                glue: false,
            })
            .collect();
        doc
    }

    fn five_words() -> TranscriptDoc {
        make_doc(vec![
            ("g1.0", 0.0, 0.4, "hello", "s1"),
            ("g1.1", 0.4, 0.8, "world.", "s1"),
            ("g1.2", 0.8, 1.2, "how", "s1"),
            ("g1.3", 1.2, 1.6, "are", "s1"),
            ("g1.4", 1.6, 2.0, "you?", "s1"),
        ])
    }

    #[test]
    fn options_default_matches_contract() {
        let options = SegmentOptions::default();
        assert_eq!(options.language, "en");
        assert_eq!(options.page_budget, budgets::SEGMENT);
        assert!(options.instructions.is_none());
    }

    #[test]
    fn tier1_exact_keeps_word_ids_and_pins_para_breaks() {
        let mut doc = five_words();
        let original_ids: Vec<String> = doc.words.iter().map(|w| w.id.clone()).collect();
        let mut llm = FakeLlm::ok([r#"{"paragraphs":["hello world.","how are you?"]}"#]);
        let mut ids = SeqIds::default();
        let outcome = run_segment(
            &mut doc,
            &mut llm,
            &SegmentOptions::default(),
            &mut ids,
            &mut |_| {},
        )
        .unwrap();

        assert_eq!(outcome.fallback_pages, 0);
        assert_eq!(outcome.records.len(), 2);
        assert_eq!(outcome.records[0].source, "exact");
        assert_eq!(outcome.records[0].text, "hello world.");
        assert_eq!(outcome.records[1].text, "how are you?");
        // 模型只加了段落结构:词 id 一个不变。
        let ids_after: Vec<String> = doc.words.iter().map(|w| w.id.clone()).collect();
        assert_eq!(ids_after, original_ids);
        // 第二段首词钉入 paraBreaks;第一段不钉。
        assert_eq!(doc.para_breaks.get("g1.2"), Some(&true));
        assert_eq!(doc.para_breaks.len(), 1);
        assert_eq!(doc.stages.segment, Some(id_fingerprint(&doc.words)));
        assert_eq!(llm.calls.len(), 1);
        assert_eq!(llm.calls[0].0, "segment");
        // 页 payload 是带标记文本(此处无停顿/切换 → 纯文本)。
        assert_eq!(llm.calls[0].2, "hello world. how are you?");
        // prompt 逐字含契约句与语言尾行。
        assert!(
            llm.calls[0]
                .1
                .contains("The downstream subtitle splitter cuts cues at YOUR punctuation")
        );
        assert!(llm.calls[0].1.ends_with("The source language is \"en\"."));
    }

    #[test]
    fn garbage_answers_escalate_to_tier5_full_coverage() {
        // P3 验收:假 LLM 全错答案下仍产出合法的全覆盖边界。
        let mut doc = five_words();
        let garbage = r#"{"paragraphs":["completely unrelated nonsense entirely"]}"#;
        let mut llm = FakeLlm::ok([garbage, garbage, garbage, r#"{}"#]);
        let mut ids = SeqIds::default();
        let mut sleeps = Vec::new();
        let outcome = run_segment(
            &mut doc,
            &mut llm,
            &SegmentOptions::default(),
            &mut ids,
            &mut |s| sleeps.push(s),
        )
        .unwrap();

        assert_eq!(outcome.fallback_pages, 1);
        assert!(!outcome.records.is_empty());
        for record in &outcome.records {
            assert_eq!(record.source, "split");
            assert!(record.text.is_empty());
        }
        // 全覆盖:首尾闭合、区间连续。
        assert_eq!(outcome.records[0].first_word_id, "g1.0");
        assert_eq!(outcome.records.last().unwrap().last_word_id, "g1.4");
        // 3 次主契约 + 1 次 tier4 索引契约;重试携带失败原因。
        let kinds: Vec<&str> = llm.calls.iter().map(|c| c.0.as_str()).collect();
        assert_eq!(
            kinds,
            vec!["segment", "segment", "segment", "segment-index"]
        );
        assert!(llm.calls[1].3.is_some());
        assert!(llm.calls[2].3.is_some());
        assert!(llm.calls[3].3.is_some());
        // tier4 payload 是索引契约形状。
        assert!(llm.calls[3].2.starts_with("{\"words\":{\"0\":"));
        // 2 次重试退避。
        assert_eq!(sleeps, vec![2.0, 2.0]);
        // 兜底不动词。
        assert_eq!(doc.words.len(), 5);
        assert_eq!(doc.stages.segment, Some(id_fingerprint(&doc.words)));
    }

    #[test]
    fn speaker_change_is_a_hard_split_even_when_llm_merges() {
        let mut doc = make_doc(vec![
            ("g1.0", 0.0, 0.4, "hi", "s1"),
            ("g1.1", 0.4, 0.8, "there", "s1"),
            ("g2.0", 0.8, 1.2, "yes", "s2"),
            ("g2.1", 1.2, 1.6, "sir", "s2"),
        ]);
        // 模型无视 ⏹ 合并成一段。
        let mut llm = FakeLlm::ok([r#"{"paragraphs":["hi there yes sir"]}"#]);
        let mut ids = SeqIds::default();
        let outcome = run_segment(
            &mut doc,
            &mut llm,
            &SegmentOptions::default(),
            &mut ids,
            &mut |_| {},
        )
        .unwrap();

        assert_eq!(outcome.records.len(), 2);
        assert_eq!(outcome.records[0].text, "hi there");
        assert_eq!(outcome.records[1].text, "yes sir");
        assert_eq!(outcome.records[0].last_word_id, "g1.1");
        assert_eq!(outcome.records[1].first_word_id, "g2.0");
        assert_eq!(doc.para_breaks.get("g2.0"), Some(&true));
        // payload 里注入了 ⏹。
        assert!(llm.calls[0].2.contains('⏹'));
    }

    #[test]
    fn text_gate_drops_rewritten_text_but_keeps_boundary() {
        let mut doc = make_doc(vec![
            ("g1.0", 0.0, 0.4, "one", "s1"),
            ("g1.1", 0.4, 0.8, "two", "s1"),
            ("g1.2", 0.8, 1.2, "three", "s1"),
            ("g1.3", 1.2, 1.6, "four", "s1"),
            ("g1.4", 1.6, 2.0, "five", "s1"),
            ("g1.5", 2.0, 2.4, "six", "s1"),
            ("g1.6", 2.4, 2.8, "seven", "s1"),
            ("g1.7", 2.8, 3.2, "eight", "s1"),
        ]);
        doc.stages.polish = Some(fingerprint(&doc.words));
        doc.breaks
            .insert("g1.3".to_owned(), crate::doc::BreakOverride::Nobreak);
        doc.para_breaks.insert("orphan".to_owned(), true);
        // 第二段改写了一个词:tier1 失败、tier2 ratio 7/8 ≥ 0.75 过;
        // 第一段过文本门保留标点,第二段文本置空、边界照用。
        let mut llm =
            FakeLlm::ok([r#"{"paragraphs":["one two three four,","five six SEVENX eight"]}"#]);
        let mut ids = SeqIds::default();
        let outcome = run_segment(
            &mut doc,
            &mut llm,
            &SegmentOptions::default(),
            &mut ids,
            &mut |_| {},
        )
        .unwrap();

        assert_eq!(outcome.records.len(), 2);
        assert_eq!(outcome.records[0].source, "diff");
        assert_eq!(outcome.records[0].text, "one two three four,");
        assert_eq!(outcome.records[1].text, "");
        assert_eq!(outcome.records[1].first_word_id, "g1.4");
        assert_eq!(outcome.records[1].last_word_id, "g1.7");
        // 文本降级的段:词原样保留。
        let texts: Vec<&str> = doc.words[4..].iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts, vec!["five", "six", "seven", "eight"]);
        // 标点段:rebind 保住未改词的 id,"four," 换发新 id。
        assert_eq!(doc.words[0].id, "g1.0");
        assert_eq!(doc.words[3].text, "four,");
        assert_ne!(doc.words[3].id, "g1.3");
        let current_ids: std::collections::BTreeSet<&str> =
            doc.words.iter().map(|word| word.id.as_str()).collect();
        assert!(
            doc.breaks
                .keys()
                .all(|id| current_ids.contains(id.as_str()))
        );
        assert!(
            doc.para_breaks
                .keys()
                .all(|id| current_ids.contains(id.as_str()))
        );
        assert_eq!(doc.stages.polish, Some(fingerprint(&doc.words)));
        assert_eq!(
            doc.stages.asr_layout,
            Some(crate::layout::layout_fingerprint(&doc))
        );
    }

    #[test]
    fn segment_drops_space_collapsed_overwide_latin_atom_but_keeps_boundary() {
        let mut doc = make_doc(vec![
            ("g1.0", 0.0, 0.3, "what", "s1"),
            ("g1.1", 0.3, 0.6, "is", "s1"),
            ("g1.2", 0.6, 0.9, "reinforcement", "s1"),
            ("g1.3", 0.9, 1.2, "learning", "s1"),
            ("g1.4", 1.2, 1.5, "reinforcement", "s1"),
            ("g1.5", 1.5, 1.8, "learning", "s1"),
        ]);
        let original = doc.words.clone();
        let mut llm = FakeLlm::ok([
            r#"{"paragraphs":["whatisreinforcementlearningreinforcementlearning。，"]}"#,
        ]);
        let mut ids = SeqIds::default();

        let outcome = run_segment(
            &mut doc,
            &mut llm,
            &SegmentOptions::default(),
            &mut ids,
            &mut |_| {},
        )
        .unwrap();

        assert_eq!(doc.words, original, "超宽焊接文本必须降级回源词");
        assert_eq!(outcome.records.len(), 1);
        assert!(outcome.records[0].text.is_empty());
        assert_eq!(outcome.cue_layout.over_width, 0);
    }

    #[test]
    fn terminal_errors_abort_instead_of_degrading() {
        let mut doc = five_words();
        let mut llm = FakeLlm::new([Err(LlmError::Http {
            status: 401,
            message: "unauthorized".to_owned(),
        })]);
        let mut ids = SeqIds::default();
        let result = run_segment(
            &mut doc,
            &mut llm,
            &SegmentOptions::default(),
            &mut ids,
            &mut |_| {},
        );
        assert!(matches!(result, Err(LlmError::Http { status: 401, .. })));
        // 绝不拿降级结果掩盖配置问题:文档未被动过。
        assert!(doc.stages.segment.is_none());
        assert!(doc.para_breaks.is_empty());
    }

    #[test]
    fn fallback_segment_splits_on_pause_boundary() {
        let mut words: Vec<Word> = (0..6)
            .map(|i| Word {
                id: format!("g1.{i}"),
                t0: i as f64,
                t1: i as f64 + 0.5,
                text: "word".to_owned(),
                sp: "s1".to_owned(),
                glue: false,
            })
            .collect();
        // 词 2 与词 3 之间 ≥1.2s 停顿。
        for word in &mut words[3..] {
            word.t0 += 2.0;
            word.t1 += 2.0;
        }
        let paras = fallback_segment(&(0..6), &words);
        assert_eq!(paras.len(), 2);
        assert_eq!((paras[0].start, paras[0].end), (0, 2));
        assert_eq!((paras[1].start, paras[1].end), (3, 5));
    }

    #[test]
    fn tier4_healing_snaps_small_gaps_and_rejects_big_ones() {
        let words = five_words().words;
        // ≤10 词空隙吸附:{1..2}{4..4} → 3 处缺口吸进第二段。
        let mut llm = FakeLlm::ok([
            r#"{"paragraphs":[{"startWordIndex":"0","endWordIndex":1.0},{"startWordIndex":3,"endWordIndex":9}]}"#,
        ]);
        let paras = segment_page_by_indexes(0..5, &words, "en", &mut llm, None).unwrap();
        assert_eq!(paras.len(), 2);
        assert_eq!((paras[0].start, paras[0].end), (0, 1));
        assert_eq!((paras[1].start, paras[1].end), (2, 4));

        // 空响应 → Malformed。
        let mut llm = FakeLlm::ok([r#"{"paragraphs":[]}"#]);
        assert!(matches!(
            segment_page_by_indexes(0..5, &words, "en", &mut llm, None),
            Err(LlmError::Malformed(_))
        ));
    }

    /// 按词建稿的泰文：段落文本按空白只能切到短语，两侧切到字素簇才对得上，
    /// 段界落回词边界（这里是行尾）。模型在数字两边补的空格不影响。
    #[test]
    fn thai_paragraphs_map_onto_a_word_split_transcript() {
        let rows = [
            "ลลิตาไม่ได้ยกเลิกการประชุมแต่เลื่อนไปเป็นวันพฤหัสบดีเวลา14:30น.",
            "ถ้าอุณหภูมิลดลงต่ำกว่า5องศาให้ปิดหน้าต่างก่อนเปิดเครื่องทำความร้อน",
            "วันนี้อากาศดีมาก เราจะไปเที่ยวทะเลกัน",
        ];
        let doc = crate::build::build_doc(
            &rows
                .iter()
                .enumerate()
                .map(|(index, text)| {
                    crate::asr_rows::RowIn::new(index as f64 * 6.0, index as f64 * 6.0 + 5.0, *text)
                })
                .collect::<Vec<_>>(),
            DocMedia {
                id: None,
                path: None,
                hash: "sha256-00".to_owned(),
                duration: 60.0,
                sample_rate: None,
            },
            "th",
            DocEngine {
                name: "t".to_owned(),
                version: None,
                aligned_words: false,
            },
            None,
        );
        let words = &doc.words;
        assert!(words.iter().any(|word| word.glue));
        let paras = vec![
            "ลลิตาไม่ได้ยกเลิกการประชุมแต่เลื่อนไปเป็นวันพฤหัสบดีเวลา 14:30 น. ถ้าอุณหภูมิลดลงต่ำกว่า 5 องศาให้ปิดหน้าต่างก่อนเปิดเครื่องทำความร้อน".to_owned(),
            "วันนี้อากาศดีมาก เราจะไปเที่ยวทะเลกัน".to_owned(),
        ];
        let mapped = map_paragraphs_by_diff(&paras, words, 0).expect("maps");
        let second_row_last = words
            .iter()
            .rposition(|word| word.id.starts_with("g2."))
            .unwrap();
        assert_eq!(mapped.len(), 2);
        assert_eq!(mapped[0].end, second_row_last);
        assert_eq!(mapped[1].end, words.len() - 1);
    }
}
