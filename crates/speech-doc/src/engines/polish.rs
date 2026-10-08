//! 润色（polish/organize 阶段，对拍 voice-ink Organize 域）。
//!
//! 契约：纯文本进（⏸/⏹ 软标记）、句子字符串出（M28 结论——放弃带词下标的
//! 稀疏映射）；atom-LCS 确定性重建词区间；相似度校验 + 单句重试 + 兜底
//! 阶梯；应用走 rebind——LCS 匹配上的词 id/t0/t1 一个都不动。
//!
//! 与 voice-ink 的刻意偏差：省略「对齐式区间恢复」层（SubAlign 锚点机制），
//! 页重试与单句重试耗尽后直接落 30 词/句末兜底切分——文本降级回原词，
//! 边界与时间轴永远有效。

use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;

use serde::{Deserialize, Serialize};

use crate::atomize::{
    atom_key, atomize_like, atomize_syllables, atomize_word_like, comparison_atoms, edit_distance,
    is_cjk_text, is_script_glued, is_unspaced_cjk_char, join_word_texts, needs_fine_comparison,
    normalize_chars, sentence_end, similarity, word_count,
};
use crate::autocorrect::{Options as AutocorrectOptions, format_with_options, source_is_cjk};
use crate::doc::{TranscriptDoc, Word};
use crate::engines::brief::{
    Analysis, format_for_prompt, instructions_block, reference_context_block,
};
use crate::engines::markers::{collapse_cjk_spaces_like, pause_marks, sanitize_corrected};
use crate::filepipe::polish_txt::{
    FENCE_BLOCK_END, FENCE_BLOCK_PREFIX, FENCE_CONTEXT_AFTER, FENCE_CONTEXT_BEFORE,
    FENCE_EDIT_BEGIN, FENCE_EDIT_END, FENCE_SENTENCE_BEGIN_PREFIX, FENCE_SENTENCE_END_PREFIX,
    MARKER_HARD_CUT, MAX_PARAGRAPH_WORDS_CJK, MAX_PARAGRAPH_WORDS_LATIN, PunctRepairItem,
    paragraph_word_limit, parse_punct_repair_page, parse_segment_repair_page,
    render_punct_repair_page, render_seam_repair_page, render_segment_repair_page,
};
use crate::filepipe::{
    PolishBudget, PolishPagePlan, PolishParsed, Problem, ProblemCode, ProblemScope,
    lint_polish_page, parse_polish_page, plan_polish_pages, render_polish_page,
};
use crate::fingerprint::{fingerprint, id_fingerprint};
use crate::lcs::{AtomInterner, LCS_CELL_CAP, lcs_matches};
use crate::llm::{LlmError, LlmJson, LlmRequest, RetryPolicy, complete_batch_retry_report, decode};
use crate::paging::budgets;
use crate::rebind::{IdSource, rebind_corrected};
use crate::sentence::SENTENCE_MAX_WORDS;
use crate::timing::word_timing_repair;

const MIN_TEXT_MATCH_RATIO: f64 = 0.7;
const SIMILARITY_THRESHOLD_LATIN: f64 = 0.7;
const SIMILARITY_THRESHOLD_CJK: f64 = 0.75;
const MAX_TAIL_GAP: usize = 10;
const MAX_FALLBACK_SENTENCE_WORDS: usize = 30;
/// 单句上限（源词跨度的字符口径，`span_chars` = Σ词面+1）。约 10% 页预算
/// (budgets::ORGANIZE=12000)；真实语料单句源跨度最长约 412 字符，留 3× 余量。
/// 超限**不拒页**：正文首轮即接受，超长句由波次后的 [`punct_repair_wave`]
/// 只补句末标点定向修复，轮次耗尽再按源时间轴确定性切句兜底。
const MAX_SENTENCE_SOURCE_CHARS: usize = 1200;
/// 单句上限（时长口径），兜住稀疏词/静音跨度。真实语料单句最长约 27s，
/// 病态样本达 2615s，两者相差两个数量级，因此取宽松值只拦病态。
const MAX_SENTENCE_SPAN_SECONDS: f64 = 300.0;
const LOW_SIMILARITY_CONTEXT_WORDS: usize = 24;
const HEAL_EPSILON: f64 = 1e-6;
/// 单页核心区原子数的**结构上限**：回贴校验（[`map_corrected_page`]）的
/// atom-LCS 表以 `源原子 × 答案原子` 计 cell、受 [`LCS_CELL_CAP`] 约束，答案
/// 允许比源长一倍，因此源侧上限取 `√cap / 2`。分页器与校验器同一把尺
/// （[`word_count`] 就是原子数），默认预算下最坏一页约 2800 原子，离这里
/// 还有一倍余量；真越线只能是分页器失配，而不是模型答错——那种页**任何
/// 答案都过不了**，为它重试是纯烧 token，因此在调 LLM 之前直接终止并把
/// 页号/原子数/上限写进错误。（1.0.9 的 12000 字符分页对中文切出 10111
/// 原子的页就是这样：整页 3 次重试全败后静默兜底 78% 的句子。）
pub fn polish_page_atom_capacity() -> usize {
    (LCS_CELL_CAP as f64).sqrt() as usize / 2
}

#[derive(Clone)]
pub struct PolishOptions {
    pub language: String,
    pub instructions: Option<String>,
    pub reference_context: Option<String>,
    pub analysis: Option<Analysis>,
    pub page_budget: usize,
    pub cue_max_chars: usize,
    /// Apply the default CJK punctuation/spacing/casing normalization.
    pub autocorrect: bool,
    /// UI-selected checks. Empty means the conservative typo+punctuation pair.
    pub enabled_checks: BTreeSet<String>,
    /// Word-index ranges to process. Empty means the full transcript.
    pub scope_ranges: Vec<Range<usize>>,
    /// 可并行认领本次请求的 worker 槽数（裁决6：分页波次对齐）。
    /// `None` 表示槽数未知或不限并发，此时不做对齐——预算永远是**上限**，
    /// 只在页数不足以填满槽位时才下调。形状与 translate/align 的同名字段一致，
    /// 直接接 `batch_worker_slots` 的返回值，不用 0 当哨兵。
    pub worker_slots: Option<usize>,
    /// 分页前先跑 speaker-repair 波次（多说话人文档才会真的发调用；定向重润
    /// 恒跳过）。见 [`crate::engines::speaker_repair`]。
    pub speaker_repair: bool,
    /// 收尾跑 speaker-names 波次：按上下文推断占位说话人的实名（定向重润
    /// 恒跳过；没有占位说话人时零调用）。见 [`crate::engines::speaker_names`]。
    pub speaker_names: bool,
}

impl Default for PolishOptions {
    fn default() -> Self {
        Self {
            language: "en".to_owned(),
            instructions: None,
            reference_context: None,
            analysis: None,
            page_budget: budgets::ORGANIZE,
            cue_max_chars: 42,
            autocorrect: true,
            enabled_checks: BTreeSet::from(["typo".to_owned(), "punct".to_owned()]),
            scope_ranges: Vec::new(),
            worker_slots: None,
            speaker_repair: true,
            speaker_names: true,
        }
    }
}

/// 句记录（落 `ai/polish.json`；review 与增量重翻的锚点）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceRecord {
    pub first_word_id: String,
    pub last_word_id: String,
    pub t0: f64,
    pub t1: f64,
    pub text: String,
    pub fallback: bool,
}

/// 逐处修改建议：应用与否都不影响时间轴。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    /// "typo" | "punct"（归一化后相等 ⇒ punct）。
    pub cat: String,
    pub find: String,
    pub replace: String,
    pub first_word_id: String,
    pub last_word_id: String,
}

#[derive(Debug, Default)]
pub struct PolishOutcome {
    pub sentences: Vec<SentenceRecord>,
    pub suggestions: Vec<Suggestion>,
    /// 段落 = 句下标分组（进 `paraBreaks` 与产物）。
    pub paragraphs: Vec<Vec<usize>>,
    /// 兜底的**页或半页**数：整页尝试（[`RetryPolicy::MAX_PAGE_ATTEMPTS`]）与
    /// 对半缩窄重试都失败后按原词兜底的单位数。对半缩窄之后一次失败只兜底半页，
    /// 所以同一场事故下这个数可能比旧实现更大、而 `fallback_sentences` 更小。
    pub fallback_pages: u32,
    /// page-fatal 之后被对半重规划、又各发了一次的**半页**数
    /// （重试策略重设计 R3「拒绝即缩窄」）。>0 说明有页整页三次没过，但缩窄后
    /// 至少一半可能救回来了。
    pub split_retry_pages: u32,
    /// `polish-retry` 波次耗尽后仍带表面级瑕疵（悬垂假句末 / 粘连 Latin 串）、
    /// 但**保留模型文本**的句数。它们不是降级：文本仍然是润色结果，只是
    /// `bcut check` 的 `polish-false-sentence-end` / `polish-surface-artifact`
    /// 警告会继续报出来。
    pub surface_artifact_sentences: u32,
    /// 退回原文的句数：相似度门两轮都没放行的单句，**加上**整页兜底页里按
    /// 标点/30 词切出的每一句（它们的 [`SentenceRecord::fallback`] 同样为
    /// `true`）。所以 `fallback_pages > 0` 时这里通常很大——1.0.9 的中文事故里
    /// 1 个兜底页对应 491 句；`bcut check` 就是按逐句 `fallback` 标记报
    /// `polish-fallback` blocker 的。
    pub fallback_sentences: u32,
    pub low_similarity_retries: u32,
    /// 文件契约路径下「⏹ 强制段落边界没能精确落在句中，退化为吸附到句首」的
    /// 次数（裁决3 的退化通道）。>0 说明有说话人切换点被挪到了最近的句首。
    pub forced_boundary_snapped: u32,
    /// 定向补分段成功拆开的段落次数：主波次接受后仍超限、经 segment-repair
    /// 逐轮拆开的段落数（同一段第一轮拆开、剩余组第二轮再拆各计一次）。
    pub repaired_paragraphs: u32,
    /// 定向补标点成功拆开的超长句次数：主波次接受后仍超过单句跨度上限
    /// （[`oversized_span`]）、经 punct-repair 逐轮只加句末标点拆开的句数
    /// （同一句第一轮拆开、剩余片第二轮再拆各计一次）。
    pub punct_repaired_sentences: u32,
    /// punct-repair 轮次耗尽后由引擎按源时间轴（说话人切换 > 既有句末 >
    /// 长停顿 > 停顿+逗号 > 长度兜底）确定性切开的超长句数。>0 说明模型
    /// 三轮都没把句子断开，切点是机器选的。
    pub punct_split_sentences: u32,
    /// 结账：定向补标点与确定性切句之后**仍**超过单句跨度上限的句数。
    /// 正常应为 0；>0 只可能是 LCS 无法把任何切点投影回 corrected。
    pub oversized_sentences: u32,
    /// segment-repair 轮次耗尽后由引擎按停顿等级确定性拆开的段落数（原段
    /// 计一次）。>0 说明模型三轮都没把这些段拆到上限以内，切点是机器按
    /// 句间停顿选的；分段照常盖戳，这些段落钉是"合法但不语义"的。
    pub fallback_paragraphs: u32,
    /// 分段退化结账：定向补分段与确定性收口之后**仍**超过单段词数上限的
    /// 多句段落数。收口保证只要段内有句缝就能拆开，所以这里正常恒为 0；
    /// >0 时本次**不盖** `stages.segment` 戳，不伪造 `segment: fresh`。
    pub degenerate_paragraphs: u32,
    /// 页缝结账（首次分段时）：硬切页缝（页界落在句中、没有任何断点）两侧
    /// 的段落被引擎无条件合并的次数。
    pub hard_cut_seams_merged: u32,
    /// 页缝结账：后一页在核心区开头留空行、显式声明「另起一段」的页缝数——
    /// 段钉直接保留，不进 seam-repair。
    pub seam_signaled_paragraphs: u32,
    /// 页缝结账：seam-repair 波次里模型判定「延续同一段」、引擎合并两侧
    /// 段落的页缝数。
    pub seam_merged_paragraphs: u32,
    /// 页缝结账：seam-repair 波次里模型判定「确是段落边界」而保留的页缝数。
    /// 波次拒收/失败的页缝同样保留段钉，但不计入这里。
    pub seam_kept_paragraphs: u32,
    /// 出口版式体检：布局铺设后的 Cue 条数 / 最长宽度 / 超单行预算条数。
    /// `over_width > 0` 即代表管线自己放出了贪心永远不会产生的超宽行。
    pub cue_layout: crate::layout::CueLayoutStats,
    /// 分页前 speaker-repair 波次的账目（跳过原因、候选/窗口/调用数、改了
    /// 说话人的词数等）。
    pub speaker_repair: crate::engines::speaker_repair::SpeakerRepairReport,
    /// 收尾 speaker-names 波次的账目（跳过原因、待命名说话人数、落盘的实名）。
    pub speaker_names: crate::engines::speaker_names::SpeakerNamesReport,
}

#[derive(Debug, Deserialize)]
struct RetryResponse {
    sentences: Vec<RetrySentence>,
}

#[derive(Debug, Deserialize)]
struct RetrySentence {
    #[serde(rename = "startWordIndex")]
    start_word_index: usize,
    #[serde(rename = "correctedText")]
    corrected_text: String,
}

/// 映射后的句子（词下标为**全局**下标，含入）。
#[derive(Debug, Clone)]
struct MappedSentence {
    start: usize,
    end: usize,
    corrected: String,
    fallback: bool,
}

/// UI 勾选项 → 提示词里的操作清单。
fn enabled_operations(checks: &BTreeSet<String>) -> Vec<&'static str> {
    let mut operations = Vec::new();
    if checks.contains("typo") {
        operations.push(
            "Fix obvious recognition errors, spelling, homophones, and mistaken word boundaries.",
        );
    }
    if checks.contains("term") {
        operations.push("Correct product, brand, person, and technical terminology when the context makes the intended term clear.");
    }
    if checks.contains("punct") {
        operations.push("Add or correct punctuation.");
    }
    if checks.contains("grammar") {
        operations.push("Fix clear agreement, article, and tense errors without changing the speaker's meaning or tone.");
    }
    if checks.contains("filler") {
        operations.push("Remove only unmistakable verbal fillers such as isolated 'um', 'uh', or 'you know'; never remove content words.");
    }
    if checks.contains("wordy") {
        operations.push("Tighten clearly redundant phrasing while preserving every fact, qualification, and the speaker's tone.");
    }
    operations
}

/// 勾选项归一化：空集等价于保守的 typo+punct。
fn effective_checks(checks: &BTreeSet<String>) -> BTreeSet<String> {
    if checks.is_empty() {
        BTreeSet::from(["typo".to_owned(), "punct".to_owned()])
    } else {
        checks.clone()
    }
}

fn numbered_operations(checks: &BTreeSet<String>) -> String {
    enabled_operations(checks)
        .iter()
        .enumerate()
        .map(|(index, value)| format!("{}. {value}", index + 1))
        .collect::<Vec<_>>()
        .join("\n")
}

fn retry_system_prompt(options: &PolishOptions) -> String {
    let mut prompt = r#"You are an expert in post-processing ASR (automatic speech recognition) transcripts.

A previous correction of each supplied sentence crossed the conservative surface-similarity threshold. That is a safety signal, NOT proof that the correction is wrong. Re-evaluate the original words and previous attempt against the supplied local and recording context.

Return a "correctedText" that ONLY fixes recognition errors (spelling, homophones, names, and mistaken word boundaries) and adds punctuation. One ASR token may legitimately become several spoken words, or several ASR tokens may become one word. If the previous attempt is a genuine correction, reproduce it exactly; never copy the original merely to raise similarity. Do NOT rephrase, reorder, summarize, add or remove spoken content, and NEVER translate — corrections stay in the same language as the original words.

"contextBefore" and "contextAfter" are read-only neighboring transcript text. Use them only to disambiguate the supplied sentence; never copy them into "correctedText".

Never reintroduce a false sentence end on a dangling connector, preposition, or incomplete lead-in (`because.`, `of.`, `当。`, `让。`, `和。`, `向。`). If the previous attempt joined that lead-in to its following clause, preserve the repaired boundary.

Never leave conflicting adjacent punctuation such as `。，`, `，。`, `，，`, `,,`, or `.,`; keep the single mark that expresses the intended boundary. In Chinese/Japanese/Korean speech, split obviously run-together spoken English phrases back into words (`purereinforcementlearning` → `pure reinforcement learning`) without translating them.

Return each sentence with its original "startWordIndex" unchanged.
Awkward spoken grammar alone is not evidence of an ASR error. Preserve it unless the supplied context supports a recognition correction; returning the original words after review is valid. Never replace pronouns or tense merely to make a short sentence sound more polished.
Respond with a single JSON object: {"sentences": [{"startWordIndex": number, "correctedText": string}]}"#
        .to_owned();
    prompt.push_str(&reference_context_block(
        options.reference_context.as_deref(),
    ));
    if let Some(analysis) = &options.analysis {
        prompt.push_str(&format!(
            "\n\n\nContent overview: {}\n\nKnown correct spellings — use them only when the local sentence actually refers to the same term:\n{}",
            analysis.summary,
            format_for_prompt(analysis)
        ));
    }
    prompt.push_str(&instructions_block(options.instructions.as_deref()));
    prompt
}

/// 术语变体替换为不透明 token——避免「把错拼改成正确术语」被相似度误判为篡改。
fn similarity_text(text: &str, analysis: Option<&Analysis>) -> String {
    let Some(analysis) = analysis else {
        return text.to_owned();
    };
    let mut patterns: Vec<(String, String)> = Vec::new();
    for (index, term) in analysis.terms.iter().enumerate() {
        let token = format!("⟦TERM{index}⟧");
        patterns.push((term.term.clone(), token.clone()));
        for variant in &term.observed_variants {
            patterns.push((variant.clone(), token.clone()));
        }
    }
    // 长优先(同长按字典序)——避免子串先被替换。
    patterns.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then(a.0.cmp(&b.0)));
    let mut output = text.to_owned();
    for (pattern, token) in patterns {
        if pattern.is_empty() {
            continue;
        }
        output = replace_case_insensitive(&output, &pattern, &token);
    }
    output
}

fn replace_case_insensitive(haystack: &str, needle: &str, replacement: &str) -> String {
    let lower_haystack = haystack.to_lowercase();
    let lower_needle = needle.to_lowercase();
    if lower_needle.is_empty() || lower_haystack.len() != haystack.len() {
        // 小写化改变字节长度的稀有脚本：退化为大小写敏感替换,避免偏移错位。
        return haystack.replace(needle, replacement);
    }
    let mut output = String::with_capacity(haystack.len());
    let mut cursor = 0;
    while let Some(found) = lower_haystack[cursor..].find(&lower_needle) {
        let start = cursor + found;
        output.push_str(&haystack[cursor..start]);
        output.push_str(replacement);
        cursor = start + lower_needle.len();
    }
    output.push_str(&haystack[cursor..]);
    output
}

/// 相似度门（阈值按 corrected 的字形选：CJK 0.75 / Latin 0.7）。
pub fn is_low_similarity(original: &str, corrected: &str, analysis: Option<&Analysis>) -> bool {
    let threshold = if is_cjk_text(corrected) {
        SIMILARITY_THRESHOLD_CJK
    } else {
        SIMILARITY_THRESHOLD_LATIN
    };
    similarity(
        &similarity_text(original, analysis),
        &similarity_text(corrected, analysis),
    ) < threshold
}

/// 单句重试的接受条件之二：重试确认了上次的修正，且改动幅度在保守界内。
///
/// 幅度用字符与词两把尺各量一次，任一把通过即接受。字符尺对长句合适，但
/// 短句上一个词的替换就能吃掉一半字符：p1222 基准里 `Thanks, Foss.` →
/// `Thanks, Vasuman.` 的字符编辑距离 6 越过了 `n/2 = 5` 的界，模型连着两轮
/// 给出同一个正确答案却被丢弃，整句退回原文并把缺陷一路带到对齐之后。词尺
/// 直接量“改了几个词”，短句上不会被长度稀释；两项都要求词数增删有限，
/// 整句改写仍然被挡在门外。
fn confirmed_local_correction(original: &str, previous: &str, retried: &str) -> bool {
    if normalize_chars(previous) != normalize_chars(retried) {
        return false;
    }
    let source: Vec<char> = normalize_chars(original).chars().collect();
    let target: Vec<char> = normalize_chars(retried).chars().collect();
    let n = source.len();
    if edit_distance(&source, &target) <= (n / 2).max(2)
        && source.len().abs_diff(target.len()) <= (n / 3).max(2)
    {
        return true;
    }
    local_word_correction(original, retried)
}

/// 裁决 json-v0 单句确认结果，同时防止旧重试路径回退 file-v1 已通过的句界修复。
fn validated_retry_correction(
    original: &str,
    previous: &str,
    retried: &str,
    analysis: Option<&Analysis>,
) -> Option<String> {
    // 表面级判据只有一份（[`has_surface_artifact`]）：冲突标点已在载体层代码
    // 归一，这里不再重复判。
    let retry_regressed_surface = has_surface_artifact(retried) && !has_surface_artifact(previous);
    if retry_regressed_surface && confirmed_local_correction(original, previous, previous) {
        return Some(previous.to_owned());
    }
    (!retried.is_empty()
        && !has_surface_artifact(retried)
        && (!is_low_similarity(original, retried, analysis)
            || confirmed_local_correction(original, previous, retried)
            || local_atom_restoration(original, retried)))
    .then(|| retried.to_owned())
}

/// 原子级局部性（重试确认路径）：原子序列（CJK 一字一原子、Latin 一词一原子，
/// 标点不计）的编辑距离不超过 `max(1, 原子数 / 3)`，且原子数增删不超过 2。
///
/// 早先按空白切词：中文整句只算 1 个"词"，`有样在` → `有 Yann LeCun 在` 一类
/// 短句里的人名还原词数差 > 1 直接出局，模型两轮给出同一个正确答案仍被丢弃，
/// 整句退回原文再进单独的 `--paragraphs` 轮。原子尺对 CJK/Latin 一视同仁。
fn local_word_correction(original: &str, retried: &str) -> bool {
    let source = atom_keys(original);
    let target = atom_keys(retried);
    if source.is_empty() || target.is_empty() {
        return false;
    }
    if source.len().abs_diff(target.len()) > 2 {
        return false;
    }
    let budget = (source.len() / 3).max(1);
    word_edit_distance(&source, &target) <= budget
}

/// 原子级局部还原（无需上一轮确认）：改动不超过 `max(1, 原子数 / 4)` 个原子，
/// 且**无净删词**（原子数不减少、最多增 2）。
///
/// 覆盖的形状是"上一轮丢词、重试把词还原"：`reputation。嗯。` 上一轮成了
/// `嗯。`，重试给回 `representation。嗯。`——前后两轮答案不同，字符相似度又
/// 被那个长英文词吃掉（<0.75），旧判据只能拒绝，把丢词的原文一路带到对齐之后。
/// 一个原子的替换、不丢内容，是最保守的可接受形状；整句改写在原子预算处
/// 被挡住。
fn local_atom_restoration(original: &str, retried: &str) -> bool {
    let source = atom_keys(original);
    let target = atom_keys(retried);
    if source.is_empty() || target.len() < source.len() || target.len() - source.len() > 2 {
        return false;
    }
    let budget = (source.len() / 4).max(1);
    word_edit_distance(&source, &target) <= budget
}

/// 原子序列的归一化键（去标点、小写；纯标点原子丢弃）。比对用的键取最细的
/// 口径（韩文逐音节）。
fn atom_keys(text: &str) -> Vec<String> {
    atomize_syllables(text)
        .iter()
        .filter_map(|atom| atom_key(atom))
        .collect()
}

fn word_edit_distance(source: &[String], target: &[String]) -> usize {
    let mut previous: Vec<usize> = (0..=target.len()).collect();
    let mut current = vec![0_usize; target.len() + 1];
    for (i, source_word) in source.iter().enumerate() {
        current[0] = i + 1;
        for (j, target_word) in target.iter().enumerate() {
            let substitute = previous[j] + usize::from(source_word != target_word);
            current[j + 1] = substitute.min(previous[j + 1] + 1).min(current[j] + 1);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[target.len()]
}

fn span_text(words: &[Word], start: usize, end: usize) -> String {
    join_word_texts(words[start..=end].iter())
}

/// atom-LCS 映射：句子字符串 → 全局词区间（0.7 门槛；每句锚定最后匹配源词）。
fn map_corrected_page(
    words: &[Word],
    range: std::ops::Range<usize>,
    paragraphs: &[Vec<String>],
) -> Result<Vec<Vec<MappedSentence>>, LlmError> {
    let mut interner = AtomInterner::default();
    let mut src_keys: Vec<u32> = Vec::new();
    let mut src_words: Vec<usize> = Vec::new();
    // 泰文一类按词建稿的区间：两侧都切到字素簇才对得上（见 comparison_atoms）；
    // 匹配仍映射回词下标，句界只落在词边界上。
    let fine = needs_fine_comparison(&words[range.clone()]);
    for index in range.clone() {
        for atom in comparison_atoms(&words[index].text, fine) {
            if let Some(key) = atom_key(&atom) {
                src_keys.push(interner.intern(&key));
                src_words.push(index);
            }
        }
    }
    let flat: Vec<&String> = paragraphs.iter().flatten().collect();
    let mut out_keys: Vec<u32> = Vec::new();
    let mut out_sentence: Vec<usize> = Vec::new();
    for (sentence_index, sentence) in flat.iter().enumerate() {
        for atom in comparison_atoms(sentence, fine) {
            if let Some(key) = atom_key(&atom) {
                out_keys.push(interner.intern(&key));
                out_sentence.push(sentence_index);
            }
        }
    }
    // 分页已按 [`polish_page_atom_capacity`] 对账，源侧不可能越线；这里仍
    // 越线只能是答案侧远长于源（整页复读多遍），是模型问题、可重试——消息
    // 带上两侧规模，让事件流能与「答案写错了」区分开。
    let matches = lcs_matches(&src_keys, &out_keys, LCS_CELL_CAP).ok_or_else(|| {
        LlmError::Malformed(format!(
            "atom-LCS table too large: {} source atoms × {} answer atoms exceed {} cells — \
             the answer is far longer than the page; reproduce the page once, without repeats",
            src_keys.len(),
            out_keys.len(),
            LCS_CELL_CAP
        ))
    })?;
    let ratio = matches.len() as f64 / src_keys.len().max(out_keys.len()).max(1) as f64;
    if ratio < MIN_TEXT_MATCH_RATIO {
        return Err(LlmError::Malformed(
            "Correction drifted too far from the source words".to_owned(),
        ));
    }
    let mut last_word: Vec<Option<usize>> = vec![None; flat.len()];
    for (si, oi) in matches {
        let sentence = out_sentence[oi];
        let word = src_words[si];
        if last_word[sentence].is_none_or(|current| word > current) {
            last_word[sentence] = Some(word);
        }
    }
    // 顺序切分:start = 上句 end+1;无匹配词的句子被跳过;末句吸收尾部。
    let mut mapped: Vec<Vec<MappedSentence>> = Vec::with_capacity(paragraphs.len());
    let mut cursor = range.start;
    let mut flat_index = 0;
    let total = flat.len();
    for paragraph in paragraphs {
        let mut group = Vec::new();
        for sentence in paragraph {
            let is_last = flat_index == total - 1;
            let end = if is_last {
                Some(range.end - 1)
            } else {
                last_word[flat_index].filter(|&word| word >= cursor)
            };
            if let Some(end) = end
                && cursor <= end
            {
                group.push(MappedSentence {
                    start: cursor,
                    end,
                    corrected: sentence.clone(),
                    fallback: false,
                });
                cursor = end + 1;
            }
            flat_index += 1;
        }
        if !group.is_empty() {
            mapped.push(group);
        }
    }
    // 尾部未匹配源词并入末句。
    if cursor < range.end
        && let Some(last) = mapped.last_mut().and_then(|group| group.last_mut())
    {
        last.end = range.end - 1;
    }
    if mapped.is_empty() {
        return Err(LlmError::Malformed(
            "LLM returned no valid sentences".to_owned(),
        ));
    }
    Ok(mapped)
}

/// 边界打磨：相邻边界在 ±10 词窗口内试探，「两侧都不变差且至少一侧变好」
/// 才接受，且不得破坏说话人一致性。
fn heal_boundaries(words: &[Word], flat: &mut [MappedSentence], analysis: Option<&Analysis>) {
    for index in 1..flat.len() {
        let (left, right) = {
            let (a, b) = flat.split_at_mut(index);
            (&mut a[index - 1], &mut b[0])
        };
        if left.corrected.is_empty() || right.corrected.is_empty() {
            continue;
        }
        let old_boundary = right.start;
        let lo = (old_boundary.saturating_sub(MAX_TAIL_GAP)).max(left.start + 1);
        let hi = (old_boundary + MAX_TAIL_GAP).min(right.end);
        let old_left = similarity(
            &similarity_text(&span_text(words, left.start, left.end), analysis),
            &similarity_text(&left.corrected, analysis),
        );
        let old_right = similarity(
            &similarity_text(&span_text(words, right.start, right.end), analysis),
            &similarity_text(&right.corrected, analysis),
        );
        let mut best: Option<(usize, f64, f64)> = None;
        for candidate in lo..=hi {
            if candidate == old_boundary {
                continue;
            }
            let moved = if candidate < old_boundary {
                candidate..old_boundary
            } else {
                old_boundary..candidate
            };
            let sp = &words[moved.start].sp;
            if words[moved.clone()].iter().any(|word| &word.sp != sp) {
                continue;
            }
            let candidate_left = similarity(
                &similarity_text(&span_text(words, left.start, candidate - 1), analysis),
                &similarity_text(&left.corrected, analysis),
            );
            let candidate_right = similarity(
                &similarity_text(&span_text(words, candidate, right.end), analysis),
                &similarity_text(&right.corrected, analysis),
            );
            let non_worse = candidate_left + HEAL_EPSILON >= old_left
                && candidate_right + HEAL_EPSILON >= old_right;
            let improves = candidate_left > old_left + HEAL_EPSILON
                || candidate_right > old_right + HEAL_EPSILON;
            if !(non_worse && improves) {
                continue;
            }
            let better = match best {
                None => true,
                Some((_, best_left, best_right)) => {
                    let key = (
                        candidate_left.min(candidate_right),
                        candidate_left + candidate_right,
                    );
                    let best_key = (best_left.min(best_right), best_left + best_right);
                    key.0 > best_key.0 + HEAL_EPSILON
                        || ((key.0 - best_key.0).abs() <= HEAL_EPSILON
                            && key.1 > best_key.1 + HEAL_EPSILON)
                }
            };
            if better {
                best = Some((candidate, candidate_left, candidate_right));
            }
        }
        if let Some((candidate, _, _)) = best {
            left.end = candidate - 1;
            right.start = candidate;
        }
    }
}

/// 兜底切分（永不失败）：句末标点或 30 词封顶，原词保留、整页一段。
fn fallback_sentences(words: &[Word], range: std::ops::Range<usize>) -> Vec<MappedSentence> {
    let mut sentences = Vec::new();
    let mut start = range.start;
    let mut count = 0;
    for index in range.clone() {
        count += 1;
        // 封顶切不落在泰文一类短语内部的词缝上（下一个词贴着这个词）：顺延到
        // 短语末尾，那里原文有空格或换行；短语长得离谱时到两倍封顶再硬切。
        // 0.5 之前逐音节的韩文词不在此列，行为与以前相同。
        let capped = count >= MAX_FALLBACK_SENTENCE_WORDS
            && (count >= 2 * MAX_FALLBACK_SENTENCE_WORDS
                || !words.get(index + 1).is_some_and(is_script_glued));
        let boundary = sentence_end(&words[index].text) || capped;
        if boundary || index == range.end - 1 {
            sentences.push(MappedSentence {
                start,
                end: index,
                corrected: String::new(),
                fallback: true,
            });
            start = index + 1;
            count = 0;
        }
    }
    sentences
}

/// 句末终止标点与右闭合符（与 `atomize::sentence_end` 的判定保持一致；
/// 具体缩写/小数规则仍由 `sentence_end` 决定）。
const RESPLIT_TERMINAL: &[char] = &['。', '．', '.', '？', '?', '！', '!', '…'];
const RESPLIT_CLOSERS: &[char] = &['”', '"', '’', '\'', '」', '』', '）', ')', ']', '》'];

/// 把一条超长 corrected 字符串按句末标点确定性重切。切点判定复用
/// `sentence_end`（缩写、小数、右引号规则一致）。没有内部句末标点时原样返回。
fn split_sentence_text(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut pieces: Vec<String> = Vec::new();
    let mut piece_start = 0usize;
    let mut index = 0usize;
    while index < chars.len() {
        if !RESPLIT_TERMINAL.contains(&chars[index]) {
            index += 1;
            continue;
        }
        // 至多跨过一个右闭合符，与 sentence_end 的 closers_skipped < 1 对齐。
        let mut cut = index + 1;
        if cut < chars.len() && RESPLIT_CLOSERS.contains(&chars[cut]) {
            cut += 1;
        }
        // 取该切点所在的完整空白分隔 token 交给 sentence_end 判定;切点必须
        // 正好落在 token 末尾,否则 "2.14" 会被从小数点切开。全角句末标点不
        // 依赖空白分词(CJK 无空格),单独放行。
        let token_start = chars[piece_start..cut]
            .iter()
            .rposition(|ch| ch.is_whitespace())
            .map_or(piece_start, |offset| piece_start + offset + 1);
        let token_end = chars[index..]
            .iter()
            .position(|ch| ch.is_whitespace())
            .map_or(chars.len(), |offset| index + offset);
        let token: String = chars[token_start..token_end].iter().collect();
        let wide_terminal = matches!(chars[index], '。' | '．' | '？' | '！');
        let rest_is_empty = chars[cut..].iter().all(|ch| ch.is_whitespace());
        if (wide_terminal || (cut == token_end && sentence_end(&token))) && !rest_is_empty {
            let piece: String = chars[piece_start..cut].iter().collect();
            let piece = piece.trim();
            if !piece.is_empty() {
                pieces.push(piece.to_owned());
            }
            piece_start = cut;
        }
        index = cut;
    }
    let tail: String = chars[piece_start..].iter().collect();
    let tail = tail.trim();
    if !tail.is_empty() {
        pieces.push(tail.to_owned());
    }
    if pieces.is_empty() {
        vec![text.to_owned()]
    } else {
        pieces
    }
}

/// 单句跨度上限（字符 + 时长双口径）。超限说明这一句吞掉了远超正常句子的
/// 源词区间——既有的 LCS 比值与相似度闸门对「整页原样回传」都是高分放行。
fn oversized_span(words: &[Word], sentence: &MappedSentence) -> Option<String> {
    let corrected_units = word_count(&sentence.corrected);
    let corrected_limit = paragraph_word_limit(&sentence.corrected);
    if corrected_units > corrected_limit {
        return Some(format!(
            "a single corrected sentence contains {corrected_units} display units (limit {corrected_limit}); add sentence-ending punctuation at semantic completions"
        ));
    }
    if is_cjk_text(&sentence.corrected)
        && corrected_units >= SENTENCE_MAX_WORDS
        && !sentence_end(&sentence.corrected)
    {
        return Some(format!(
            "a punctuation-starved CJK sentence contains {corrected_units} display units without terminal punctuation (semantic sentence cap {SENTENCE_MAX_WORDS}); add sentence-ending punctuation at complete thoughts"
        ));
    }
    let chars = span_chars(words, std::slice::from_ref(sentence));
    if chars > MAX_SENTENCE_SOURCE_CHARS {
        return Some(format!(
            "a single sentence covers {chars} source chars (limit {MAX_SENTENCE_SOURCE_CHARS})"
        ));
    }
    let seconds = words[sentence.end].t1 - words[sentence.start].t0;
    if seconds > MAX_SENTENCE_SPAN_SECONDS {
        return Some(format!(
            "a single sentence covers {seconds:.1}s of source audio (limit {MAX_SENTENCE_SPAN_SECONDS:.0}s)"
        ));
    }
    None
}

fn span_chars(words: &[Word], sentences: &[MappedSentence]) -> usize {
    sentences
        .iter()
        .map(|sentence| {
            words[sentence.start..=sentence.end]
                .iter()
                .map(|word| word.text.chars().count() + 1)
                .sum::<usize>()
        })
        .sum()
}

// ---- 文件契约（file-v1）路径 ----------------------------------------------

/// 一次页级尝试的材料，供宿主写 `ai/polish/vNNN/`（§4/§11）。形状与 translate
/// 共用 [`crate::filepipe::PageAttempt`]。
pub type PolishPageAttempt<'a> = crate::filepipe::PageAttempt<'a>;

/// 槽位波次对齐时核心区词数的下限（裁决6）。低于它就不再切细——页太小反而
/// 让模型丢失顺读语境，得不偿失。
pub const POLISH_FILE_MIN_CORE_WORDS: usize = 400;

/// 文件契约的 polish system prompt（§6.3）。
///
/// 输出是带哨兵栅栏的纯文本，分段靠空行，句子由句末标点确定性派生；可做的
/// 编辑（勾选项）、语言纪律、术语表与用户附加指令是三个注入点。
fn file_system_prompt(options: &PolishOptions) -> String {
    let checks = effective_checks(&options.enabled_checks);
    let operations = numbered_operations(&checks);
    let allows_removal = checks.contains("filler") || checks.contains("wordy");
    let coverage = if allows_removal {
        "Your output must cover the entire editable region in order and preserve all intended meaning. The only permitted omissions are unmistakable fillers or redundant words covered by the enabled checks."
    } else {
        "Your output must cover the ENTIRE editable region exactly once, in order — never drop, reorder, summarize, or add content."
    };
    let language = &options.language;
    let mut prompt = format!(
        r#"You are an expert in post-processing ASR (automatic speech recognition) transcripts.

You receive ONE page of a transcript as PLAIN TEXT delimited by sentinel fence lines:

{FENCE_CONTEXT_BEFORE}
…preceding transcript — READ-ONLY…
{FENCE_EDIT_BEGIN}
…the region you must revise…
{FENCE_EDIT_END}
…following transcript — READ-ONLY…
{FENCE_CONTEXT_AFTER}

Work by SEQUENTIAL READING REVISION: read the editable region from beginning to end and fix it as you go. This is a revision pass, never a rewrite or a summary.
Spoken grammatical awkwardness alone is not evidence of a recognition error. Unless grammar editing is enabled, preserve pronouns, tense and informal grammar; use context to correct misrecognition, not to improve the speaker's prose.

Enabled checks — perform ONLY these edits:
{operations}

Output contract — violating any of these makes the whole page unusable:
- Reproduce all four fence lines VERBATIM, each exactly once, in the order shown.
- Reproduce both read-only regions CHARACTER FOR CHARACTER — including their ⏸/⏹ markers, recognition errors, duplicated words, and awkward phrasing. They exist only to give you context; any "fix" there is discarded and gets the page rejected.
- Emit NOTHING outside the fences: no preamble, no closing remarks, no explanations.
- Never wrap the answer in a markdown code block (``` or ~~~) and never add headings, bullets, or numbering.
- Only the text between {FENCE_EDIT_BEGIN} and {FENCE_EDIT_END} may change.
- {coverage}

Line-break semantics inside the editable region:
- A SINGLE newline is a soft wrap only — no boundary meaning. Use it freely, or not at all.
- A BLANK LINE is a PARAGRAPH boundary. Insert one wherever the topic turns.
- Paragraphing is MANDATORY, not optional. Spoken-language paragraphs are short — usually 2 to 6 sentences. Any paragraph longer than {MAX_PARAGRAPH_WORDS_LATIN} words ({MAX_PARAGRAPH_WORDS_CJK} characters for Chinese/Japanese/Korean) FAILS segmentation validation and forces an extra repair round.
- An editable region of any real length therefore ALWAYS contains multiple paragraphs. Returning the whole region as one paragraph — or with no blank line at all — is a contract violation, exactly like dropping a fence line.
- Never use three or more consecutive newlines.
- PAGE SEAM: the editable region starts where the previous page ended, so its first sentence may simply continue the LAST paragraph shown in the read-only context above. If that first sentence starts a NEW paragraph (a different topic from the last paragraph of {FENCE_CONTEXT_BEFORE}), put exactly ONE blank line immediately after {FENCE_EDIT_BEGIN}, before the first sentence. If it continues that paragraph, start the text right after the fence. This leading blank line is the only place where a blank line at the very start of the region means anything; do not add one when the context region is empty.
- Sentences are derived deterministically from sentence-ending punctuation — a newline or blank line NEVER ends a sentence. Do NOT put one sentence per line and expect it to mean anything; punctuate properly instead.
- Close each complete thought with natural sentence-ending punctuation (`.?!` / `。？！`) AS YOU GO, especially in long pause-rich speech. A single derived sentence must stay far below {MAX_SENTENCE_SOURCE_CHARS} source characters or {MAX_SENTENCE_SPAN_SECONDS:.0} seconds of source audio; a page-sized run-on is accepted for its wording but is sent back for an extra punctuation-repair round, so punctuating properly the first time saves that round.
- A paragraph can split only BETWEEN sentences, so no individual sentence may itself exceed {MAX_PARAGRAPH_WORDS_LATIN} words ({MAX_PARAGRAPH_WORDS_CJK} characters for Chinese/Japanese/Korean). An over-limit sentence cannot be paragraphed until a later repair round has added punctuation to it. Extra newlines, blank lines, commas, or pause markers never substitute for real sentence-ending punctuation.
- Never end a sentence on a dangling connector, preposition, or incomplete lead-in (`because.`, `of.`, `当。`, `让。`, `和。`, `向。`). Join it to the following clause and end only after the thought is complete. A retry problem containing `dangling connector/preposition` names the exact false sentence end that must be removed.
- Never leave conflicting adjacent punctuation such as `。，`, `，。`, `，，`, `,,`, or `.,`; keep exactly one mark that expresses the intended boundary.
- In Chinese/Japanese/Korean speech, restore spaces inside obviously run-together spoken English phrases (`purereinforcementlearning` → `pure reinforcement learning`, book titles and job titles likewise). This is a mistaken word-boundary correction, not a translation; do not guess new content.

Markers in the source text:
- "⏸" / "⏸⏸" / "⏸⏸⏸" mark a short / medium / long pause. They are a soft hint only — a pause often falls mid-sentence, so split by MEANING, never solely because of a pause.
- "⏹" means the SPEAKER CHANGES right after that word. A sentence must NEVER span it, and it is ALWAYS a paragraph boundary — put a blank line there.
- A "⏹" may carry the incoming speaker's stable label, as in "⏹S2": everything after it is spoken by S2 until the next "⏹". Use the labels to follow who answers whom and which side a short "yeah" / "对" belongs to; the label is part of the marker, never a word.
- Both markers are metadata. NEVER copy "⏸", "⏹", or a speaker label such as "S2" into the EDITABLE region of your answer; inside the read-only regions keep them exactly as given.
- "{MARKER_HARD_CUT}" (outside the editable fences) means the page seam falls mid-sentence: it is NOT a paragraph boundary; keep reading across it.

Never translate, invent facts, reorder speech, or change the speaker's intended meaning. For Chinese and Japanese recognition/terminology checks, pay special attention to homophones and near-homophones.
The source language is "{language}". The text stays in the source language; words from OTHER languages appear only where the speaker actually used them (code-switching) — never as replacements for source-language words.
Follow the source script's spacing conventions: NEVER insert spaces between Chinese/Japanese/Korean characters."#
    );
    prompt.push_str(&reference_context_block(
        options.reference_context.as_deref(),
    ));
    if let Some(analysis) = &options.analysis {
        prompt.push_str(&format!(
            "\n\n\nContent overview: {}\n\nKnown correct spellings — when a similar-sounding or misspelled token refers to one of these, correct it to EXACTLY this form:\n{}",
            analysis.summary,
            format_for_prompt(analysis)
        ));
    }
    if let Some(instructions) = options.instructions.as_deref().filter(|s| !s.is_empty()) {
        prompt.push_str(&format!(
            "\n\nExtra instructions from the user: {instructions}"
        ));
    }
    prompt
}

/// `options.scope_ranges` → 有效的、夹到词流长度内、**相邻/重叠已合并**的
/// 处理区间（按起点排序）。
///
/// 合并的原因：每个 scope 独立分页（[`plan_scoped_pages`]），`--paragraphs`
/// 传入几十个连续段落（典型场景：`bcut check` 报 `polish-fallback` 后按 `fix`
/// 定向重润一整个兜底页）若不合并，就会变成几十个只有一段的小页——LLM 调用
/// 数翻几倍，且每页首尾都拿不到真实上下文。合并后连续段落按正常预算分页。
fn resolve_scopes(words: &[Word], options: &PolishOptions) -> Vec<Range<usize>> {
    if options.scope_ranges.is_empty() {
        return vec![0..words.len()];
    }
    let mut ranges: Vec<Range<usize>> = options
        .scope_ranges
        .iter()
        .filter_map(|range| {
            let start = range.start.min(words.len());
            let end = range.end.min(words.len());
            (start < end).then_some(start..end)
        })
        .collect();
    ranges.sort_by_key(|range| (range.start, range.end));
    let mut merged: Vec<Range<usize>> = Vec::with_capacity(ranges.len());
    for range in ranges {
        match merged.last_mut() {
            Some(last) if range.start <= last.end => {
                last.end = last.end.max(range.end);
            }
            _ => merged.push(range),
        }
    }
    merged
}

/// 分页器与回贴校验器的容量对账：任一页核心区原子数超过
/// [`polish_page_atom_capacity`] 即为分页器失配（见该函数注释），返回
/// 终止性错误，调用方不得为它调 LLM 或重试。
fn check_page_capacity(words: &[Word], plans: &[PolishPagePlan]) -> Result<(), LlmError> {
    let capacity = polish_page_atom_capacity();
    for plan in plans {
        let atoms: usize = words[plan.core.clone()]
            .iter()
            .map(|word| word_count(&word.text))
            .sum();
        if atoms > capacity {
            return Err(LlmError::Terminal(format!(
                "polish page {} too large: {atoms} source atoms exceed the validator capacity \
                 ({capacity}); the pager and the atom-LCS validator disagree — no answer could \
                 pass, so the page is not sent (words {}..{}). Narrow the run with --paragraphs \
                 and report this as a bug.",
                plan.id, plan.core.start, plan.core.end
            )));
        }
    }
    Ok(())
}

/// 逐 scope 分页并把页内下标平移回全局，页 id 全局连号。
fn plan_scoped_pages(
    words: &[Word],
    scopes: &[Range<usize>],
    budget: &PolishBudget,
) -> Vec<PolishPagePlan> {
    let shift = |range: &Range<usize>, delta: usize| (range.start + delta)..(range.end + delta);
    let mut plans: Vec<PolishPagePlan> = Vec::new();
    for scope in scopes {
        for plan in plan_polish_pages(&words[scope.clone()], budget) {
            plans.push(PolishPagePlan {
                id: String::new(),
                before: shift(&plan.before, scope.start),
                core: shift(&plan.core, scope.start),
                after: shift(&plan.after, scope.start),
                hard_cut_start: plan.hard_cut_start,
                hard_cut_end: plan.hard_cut_end,
                para_starts: plan
                    .para_starts
                    .iter()
                    .map(|index| index + scope.start)
                    .collect(),
            });
        }
    }
    for (index, plan) in plans.iter_mut().enumerate() {
        plan.id = format!("p{:03}", index + 1);
    }
    plans
}

/// 裁决6：分页预算是**上限**而不是目标。先按默认预算排一次；只有当页数填不满
/// worker 槽位、且总词数摊到每槽仍不低于 [`POLISH_FILE_MIN_CORE_WORDS`] 时，
/// 才把核心区预算下调到 `ceil(总核心词 / 槽数)` 重排一次，并且只在确实排出更多
/// 页时才采用重排结果。
fn plan_polish_file_pages(
    words: &[Word],
    scopes: &[Range<usize>],
    worker_slots: Option<usize>,
) -> Vec<PolishPagePlan> {
    let budget = PolishBudget::default();
    let plans = plan_scoped_pages(words, scopes, &budget);
    // 槽数未知（`None`）或不限并发（`usize::MAX`）时波次无从计算，页数就按预算
    // 走。与 translate 的同名判据同一形状，但下界取 `>1` 而不是 `>0`：translate
    // 还要拿槽数选行数档位，1 个槽有意义；这里只做「页数填不满槽位就切细」，
    // 1 个槽与没有槽一样不触发重排。
    let Some(slots) = worker_slots.filter(|slots| *slots > 1 && *slots < usize::MAX) else {
        return plans;
    };
    if plans.len() >= slots || plans.is_empty() {
        return plans;
    }
    let total: usize = scopes
        .iter()
        .flat_map(|scope| words[scope.clone()].iter())
        .map(|word| word_count(&word.text).max(1))
        .sum();
    let target = total.div_ceil(slots);
    if target < POLISH_FILE_MIN_CORE_WORDS || target >= budget.core_words {
        return plans;
    }
    let tuned = plan_scoped_pages(
        words,
        scopes,
        &PolishBudget {
            core_words: target,
            ..budget
        },
    );
    if tuned.len() > plans.len() {
        tuned
    } else {
        plans
    }
}

/// 段落文本 → 句子列表：句末标点确定性派生（§6.1）。
///
/// 刻意**不重新分块**：重新打包段落会造出既不来自空行、也不来自 ⏹ 的段落
/// 边界，违反裁决4「段落分组是空行真相」。没有句末标点的超长句在这里原样
/// 保留为一句——[`split_sentence_text`] 只认标点，对它再切一遍不会多出任何
/// 边界（曾经的 900 字符「重切」正是这样的空转）；它们交给
/// [`punct_repair_wave`] 补标点。
fn file_page_sentences(paragraphs: &[String]) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = Vec::with_capacity(paragraphs.len());
    for paragraph in paragraphs {
        let sentences: Vec<String> = split_sentence_text(paragraph)
            .into_iter()
            .map(|sentence| sanitize_corrected(&sentence))
            .filter(|sentence| !sentence.is_empty())
            .collect();
        if !sentences.is_empty() {
            out.push(sentences);
        }
    }
    out
}

/// 跳过 `target` 个非空白字符后，下一个非空白字符的字节下标。
///
/// [`atomize`] 保序且除空白外无损（atom 串接 == 文本去掉空白），因此 atom 下标
/// 可以确定性换算成字符偏移——不需要伪造一张 atom→偏移表。
fn nonspace_char_index(text: &str, target: usize) -> Option<usize> {
    let mut seen = 0usize;
    for (index, ch) in text.char_indices() {
        if ch.is_whitespace() {
            continue;
        }
        if seen == target {
            return Some(index);
        }
        seen += 1;
    }
    None
}

/// 一句 corrected 与其源词区间的 atom-LCS 对齐。
///
/// LCS 用归一化 key（[`atom_key`] 会丢掉纯标点 atom），字符偏移用原始 atom 的
/// 字符数——两把尺分开，所以 `matches` 已经换算成 (源词全局下标, `atoms`
/// 下标) 递增对，`atoms` 是 corrected 的原始 atom（含尾随标点）。
struct SentenceAlignment {
    atoms: Vec<String>,
    matches: Vec<(usize, usize)>,
}

fn sentence_alignment(words: &[Word], sentence: &MappedSentence) -> Option<SentenceAlignment> {
    let mut interner = AtomInterner::default();
    let mut src_keys: Vec<u32> = Vec::new();
    let mut src_words: Vec<usize> = Vec::new();
    // 这里的 atom 不只是比对键：切句、找分句标点都落在 atom 边界上，所以用
    // 成词的口径（韩文一个어절一个 atom，切点不会落进词里）；旧版逐音节的
    // 区间沿用逐音节，两侧才对得上。泰文一类按词切开的区间，源侧的词本身
    // 就是原子（单独送进分词模型可能被切成两段），改写侧锚定在这些词上切。
    let span = &words[sentence.start..=sentence.end];
    for index in sentence.start..=sentence.end {
        for atom in atomize_word_like(span, &words[index].text) {
            if let Some(key) = atom_key(&atom) {
                src_keys.push(interner.intern(&key));
                src_words.push(index);
            }
        }
    }
    let atoms = atomize_like(span, &sentence.corrected);
    let mut out_keys: Vec<u32> = Vec::new();
    let mut out_atom: Vec<usize> = Vec::new();
    for (position, atom) in atoms.iter().enumerate() {
        if let Some(key) = atom_key(atom) {
            out_keys.push(interner.intern(&key));
            out_atom.push(position);
        }
    }
    if src_keys.is_empty() || out_keys.is_empty() {
        return None;
    }
    let matches = lcs_matches(&src_keys, &out_keys, LCS_CELL_CAP)?
        .into_iter()
        .map(|(si, oi)| (src_words[si], out_atom[oi]))
        .collect();
    Some(SentenceAlignment { atoms, matches })
}

/// 用 atom-LCS 在 corrected 里找到「源词 `boundary` 开始」的位置并切开。
fn split_corrected_at_word(
    words: &[Word],
    sentence: &MappedSentence,
    boundary: usize,
) -> Option<(String, String)> {
    let alignment = sentence_alignment(words, sentence)?;
    let split_atom = alignment
        .matches
        .iter()
        .find(|(word, _)| *word >= boundary)
        .map(|(_, atom)| *atom)?;
    if split_atom == 0 {
        return None;
    }
    let target: usize = alignment.atoms[..split_atom]
        .iter()
        .map(|atom| atom.chars().count())
        .sum();
    let index = nonspace_char_index(&sentence.corrected, target)?;
    let left = sentence.corrected[..index].trim_end().to_owned();
    let right = sentence.corrected[index..].trim_start().to_owned();
    if left.is_empty() || right.is_empty() {
        return None;
    }
    Some((left, right))
}

/// 把一句在源词 `boundary` 处切成两句（`boundary` 是右半句的首词）。
fn split_sentence_at_word(
    words: &[Word],
    sentence: &MappedSentence,
    boundary: usize,
) -> Option<(MappedSentence, MappedSentence)> {
    if boundary <= sentence.start || boundary > sentence.end {
        return None;
    }
    // 兜底句的 corrected 为空（文本 = 原词），切区间就够。
    let (left_text, right_text) = if sentence.corrected.is_empty() {
        (String::new(), String::new())
    } else {
        split_corrected_at_word(words, sentence, boundary)?
    };
    Some((
        MappedSentence {
            start: sentence.start,
            end: boundary - 1,
            corrected: left_text,
            fallback: sentence.fallback,
        },
        MappedSentence {
            start: boundary,
            end: sentence.end,
            corrected: right_text,
            fallback: sentence.fallback,
        },
    ))
}

/// 裁决3：⏹ 硬保证落在非逐字保真路径上。
///
/// **顺序不变式**：必须在 [`heal_boundaries`] 之后调用。heal 会在 ±10 词窗口里
/// 挪句边界，先落位的强制边界会被它挪走；此后不得再 heal。
/// [`low_similarity_retry`] 只改写 `corrected`/`fallback`，从不动 `start`/`end`，
/// 所以强制边界能活过单句重试。
///
/// 对每个说话人切换词下标 W：命中句首就直接钉成段首；落在句中就先用 atom-LCS
/// 精确切句，切不动才退化为吸附到该句句首并计一次 `snapped`。
fn enforce_forced_boundaries(
    words: &[Word],
    groups: Vec<Vec<MappedSentence>>,
    forced: &[usize],
    snapped: &mut u32,
) -> Vec<Vec<MappedSentence>> {
    let mut flat: Vec<MappedSentence> = Vec::new();
    let mut starts: BTreeSet<usize> = BTreeSet::new();
    for group in groups {
        if group.is_empty() {
            continue;
        }
        starts.insert(flat.len());
        flat.extend(group);
    }
    if flat.is_empty() {
        return Vec::new();
    }
    for &boundary in forced {
        // 页首本来就是新段（页与页之间在 committed 里天然断开）。
        if boundary <= flat[0].start {
            continue;
        }
        let Some(index) = flat
            .iter()
            .position(|sentence| sentence.start <= boundary && boundary <= sentence.end)
        else {
            continue;
        };
        if flat[index].start == boundary {
            starts.insert(index);
            continue;
        }
        match split_sentence_at_word(words, &flat[index], boundary) {
            Some((left, right)) => {
                flat[index] = left;
                flat.insert(index + 1, right);
                starts = starts
                    .iter()
                    .map(|&slot| if slot > index { slot + 1 } else { slot })
                    .collect();
                starts.insert(index + 1);
            }
            None => {
                *snapped += 1;
                starts.insert(index);
            }
        }
    }
    let mut out: Vec<Vec<MappedSentence>> = Vec::new();
    for (index, sentence) in flat.into_iter().enumerate() {
        if out.is_empty() || starts.contains(&index) {
            out.push(Vec::new());
        }
        out.last_mut().expect("group just pushed").push(sentence);
    }
    out
}

fn summarize_problems(problems: &[Problem]) -> String {
    if problems.is_empty() {
        return "unspecified".to_owned();
    }
    problems
        .iter()
        .map(|problem| format!("{}: {}", problem.code, problem.detail))
        .collect::<Vec<_>>()
        .join("; ")
}

fn malformed_detail(error: &LlmError) -> String {
    match error {
        LlmError::Malformed(detail) => detail.clone(),
        other => other.to_string(),
    }
}

/// 需要**词流真相**才能算的那半边校验（另一半见 [`lint_polish_page`]）。
///
/// 返回 `None` 即整页被拒；被拒时必定往 `problems` 里补过至少一条 §10 问题，
/// 否则宿主写出的拒绝产物会是一份没有理由的空账。
///
/// 分段退化（单段超限）不在这里出现：主 polish lint 不产 ParagraphOversize，
/// 首轮即接受正文，退化段落由 [`segment_repair_wave`] 波次后定向补分段。
/// 单句超长（[`oversized_span`]）同样**不拒页**：正文先收下，超长句由
/// [`punct_repair_wave`] 只补句末标点定向修复——整页重掷只会重掷全部句子，
/// 而超长句的字词本身通常没有错。
fn validate_polish_file_page(
    words: &[Word],
    plan: &PolishPagePlan,
    parsed: &PolishParsed,
    analysis: Option<&Analysis>,
    problems: &mut Vec<Problem>,
    snapped: &mut u32,
) -> Option<Vec<Vec<MappedSentence>>> {
    if !problems.is_empty() {
        return None;
    }
    let core = plan.core.clone();
    if core.is_empty() {
        return Some(Vec::new());
    }
    let paragraphs = file_page_sentences(&parsed.paragraphs);
    if paragraphs.is_empty() {
        problems.push(Problem::page(
            ProblemCode::DocumentTruncated,
            &plan.id,
            "核心区没有可用句子",
        ));
        return None;
    }
    let mut mapped = match map_corrected_page(words, core.clone(), &paragraphs) {
        Ok(mapped) => mapped,
        Err(error) => {
            problems.push(Problem::page(
                ProblemCode::SourceDrift,
                &plan.id,
                malformed_detail(&error),
            ));
            return None;
        }
    };
    let mut flat: Vec<MappedSentence> = mapped.iter().flatten().cloned().collect();
    heal_boundaries(words, &mut flat, analysis);
    let mut cursor = 0;
    for group in &mut mapped {
        for slot in group.iter_mut() {
            *slot = flat[cursor].clone();
            cursor += 1;
        }
    }
    let mapped = enforce_forced_boundaries(words, mapped, &parsed.forced_boundaries, snapped);
    let flat: Vec<MappedSentence> = mapped.iter().flatten().cloned().collect();
    if flat.is_empty() {
        problems.push(Problem::page(
            ProblemCode::DocumentTruncated,
            &plan.id,
            "核心区没有可用句子",
        ));
        return None;
    }
    // 相似度门**不再拒页**（重试策略重设计 §2.2）：低相似度句是单元级失败，
    // 直接进 `polish-retry` 的句级补做队列（[`low_similarity_retry`]），
    // 耗尽后逐句退回原词。旧的「>30% 句未过门 ⇒ 整页 SourceDrift」会把一页
    // 两句里的一句拒成整页重掷；页级 SourceDrift 现在只剩 atom-LCS 映射失败
    // （覆盖率 < 0.7 / 无可映射句 / LCS 表过大），那才是真正的整页改写。
    Some(mapped)
}

/// 文件契约（`file-v1`）下的全量润色（§6）。
///
/// **整页并行、无 carry-over**（裁决1）：每页是一次独立的 `LlmRequest`，
/// 页之间没有串行数据依赖，靠只读上下文栅栏保住顺读语境。
///
/// 阶梯（§6.4）：整页重试 [`MAX_RETRIES`] 次 → 仍不过就整页原文兜底（计
/// `fallback_pages`）→ 全部页跑完后统一跑 [`low_similarity_retry`]（仍是
/// `polish-retry` 的单轮 JSON 契约，裁决5）→ 单句仍不过则退回原文（计
/// `fallback_sentences`）。
///
/// `paraBreaks` / `stages.segment` 由「空行 + ⏹ 强制边界」派生（裁决4），其余
/// 语义完全复用 [`apply`]：仅在 `doc.stages.segment.is_none()` 时写段落钉，仍走
/// `ensure_balanced_cue_layout`（结果进 `autoBreaks`），仍盖 `stages.polish` /
/// `stages.asr_layout`。
pub fn run_polish_file_contract(
    doc: &mut TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &PolishOptions,
    ids: &mut dyn IdSource,
    sleep: &mut dyn FnMut(f64),
    on_attempt: &mut dyn FnMut(&PolishPageAttempt<'_>),
) -> Result<PolishOutcome, LlmError> {
    let mut outcome = PolishOutcome::default();
    if doc.words.is_empty() {
        return Ok(outcome);
    }
    // 说话人归属语义修复先于分页：⏹ 在下面是硬保证（句不得跨、必分段），
    // 归属错着的碎片会被逼成独立句；这里改的只是 `words[].sp`。
    crate::engines::speaker_repair::speaker_repair_wave(
        doc,
        llm,
        options.speaker_repair,
        !options.scope_ranges.is_empty(),
        &mut outcome.speaker_repair,
        on_attempt,
    )?;
    let words = doc.words.clone();
    let scopes = resolve_scopes(&words, options);
    let plans = plan_polish_file_pages(&words, &scopes, options.worker_slots);
    if plans.is_empty() {
        return Ok(outcome);
    }
    check_page_capacity(&words, &plans)?;
    let system = file_system_prompt(options);
    let analysis = options.analysis.as_ref();
    let prepared: Vec<(PolishPagePlan, String)> = plans
        .into_iter()
        .map(|plan| {
            let rendered = render_polish_page(&words, &plan).text;
            (plan, rendered)
        })
        .collect();
    let requests: Vec<LlmRequest> = prepared
        .iter()
        .map(|(_, input)| LlmRequest {
            kind: "polish",
            system: system.clone(),
            user: input.clone(),
            temperature: 0.2,
            attempt: 1,
            retry_reason: None,
        })
        .collect();

    let mut accepted: Vec<Option<Vec<Vec<MappedSentence>>>> =
        (0..prepared.len()).map(|_| None).collect();
    let mut tries = vec![0_u32; prepared.len()];
    let mut snapped = 0_u32;
    // 页缝显式信号（§6.2）：后一页在核心区开头留空行 = 首段另起一段。
    // 首页没有上文、硬切页缝是残句续写，都不算信号。
    let mut seam_signals = vec![false; prepared.len()];
    // 分段退化只在本次润色负责产出段落钉时才值得补课：`stages.segment`
    // 已盖戳的重润不会写 `paraBreaks`，补回的空行也无处安放，直接放行。
    let enforce_paragraphs = doc.stages.segment.is_none();
    let wave = complete_batch_retry_report(
        llm,
        &requests,
        RetryPolicy::MAX_PAGE_ATTEMPTS,
        sleep,
        &mut |index, raw| {
            tries[index] += 1;
            let (plan, input) = &prepared[index];
            let parsed = parse_polish_page(&words, plan, input, raw);
            seam_signals[index] = parsed.starts_new_paragraph
                && index > 0
                && !plan.hard_cut_start
                && !plan.before.is_empty();
            let mut problems = parsed.diagnostics.problems.clone();
            let mapped = validate_polish_file_page(
                &words,
                plan,
                &parsed,
                analysis,
                &mut problems,
                &mut snapped,
            );
            debug_assert!(
                mapped.is_some() || !problems.is_empty(),
                "rejected polish page must carry at least one problem"
            );
            // 首轮即接受：映射成功即收下正文，不为分段退化烧整页重试——
            // 那只会重掷全部句子。退化段落由波次后的 segment-repair 定向补。
            let pass = mapped.is_some();
            on_attempt(&PolishPageAttempt {
                page_id: &plan.id,
                attempt: tries[index],
                input,
                output: raw,
                problems: &problems,
                accepted: pass,
            });
            match (pass, mapped) {
                (true, Some(mapped)) => Ok(mapped),
                _ => Err(LlmError::Malformed(format!(
                    "polish page {} rejected — {}",
                    plan.id,
                    summarize_problems(&problems)
                ))),
            }
        },
        &mut |_, error| error.to_string(),
        &mut |index, mapped: Vec<Vec<MappedSentence>>| {
            accepted[index] = Some(mapped);
        },
    )?;

    // R3 拒绝即缩窄：整页尝试耗尽的页先对半重规划（同一个分页器、同样的
    // 上下文预算），两半各发一次；仍失败的**半页**才走原词兜底。总调用量与
    // 旧的 3 次整页重试同量级，兜底粒度减半。
    let failed_pages: Vec<usize> = wave.failed.into_iter().map(|(index, _)| index).collect();
    let mut split_groups: BTreeMap<usize, Vec<Vec<Vec<MappedSentence>>>> = BTreeMap::new();
    if RetryPolicy::SPLIT_THEN && !failed_pages.is_empty() {
        split_polish_pages(
            &words,
            &prepared,
            &failed_pages,
            llm,
            &system,
            analysis,
            sleep,
            &mut snapped,
            &mut outcome,
            &mut split_groups,
            on_attempt,
        )?;
    }

    let mut per_page: Vec<Vec<Vec<MappedSentence>>> = Vec::with_capacity(prepared.len());
    for (index, (plan, _)) in prepared.iter().enumerate() {
        let groups = match accepted[index].take() {
            Some(groups) => groups,
            None => match split_groups.remove(&index) {
                Some(halves) => halves.into_iter().flatten().collect(),
                None => {
                    outcome.fallback_pages += 1;
                    let forced = crate::filepipe::polish_txt::forced_boundaries(&words, plan);
                    enforce_forced_boundaries(
                        &words,
                        vec![fallback_sentences(&words, plan.core.clone())],
                        &forced,
                        &mut snapped,
                    )
                }
            },
        };
        per_page.push(groups);
    }
    let plans: Vec<&PolishPagePlan> = prepared.iter().map(|(plan, _)| plan).collect();
    // 硬切页缝：页界落在句中且没有任何断点可用，两侧是同一句的两半——
    // 契约里已告诉模型「HARD-CUT 不是段落边界」，引擎同样不得在这里落段钉：
    // 无条件把后一页的首段并进前一页的末段。
    if enforce_paragraphs {
        outcome.hard_cut_seams_merged = merge_hard_cut_seams(&plans, &mut per_page);
    }
    // 逐页组 → 全局组，记录每页在 committed 里的组区间，供页缝波次寻址。
    let mut committed: Vec<Vec<MappedSentence>> = Vec::new();
    let mut page_spans: Vec<std::ops::Range<usize>> = Vec::with_capacity(per_page.len());
    for groups in per_page {
        let start = committed.len();
        committed.extend(groups);
        page_spans.push(start..committed.len());
    }
    // 页缝候选：非硬切、非说话人切换、后一页没有显式「另起一段」的页缝。
    // 分页只切起点，页缝本身不是段落证据；这些页缝在 punct-repair 定稿句子
    // 之后交给 seam-repair 波次判定，模型说延续就合并，说边界（或拒收）就保留。
    let seams: Vec<usize> = if enforce_paragraphs {
        seam_candidates(&words, &plans, &page_spans, &seam_signals, &mut outcome)
    } else {
        Vec::new()
    };

    // 定向补标点：主波次首轮接受正文后，把仍超过单句跨度上限的句子凑到
    // 一起分页发回，只要求加句末标点（punct-repair 载体）；轮次耗尽再按源
    // 时间轴确定性切句，保证出口没有超长句。必须先于单句相似度重试与
    // 补分段——补分段只能在句间插缝，超长句不先切开就无缝可插。
    punct_repair_wave(
        &words,
        &mut committed,
        llm,
        options,
        &mut outcome,
        on_attempt,
    )?;

    low_similarity_retry(&words, &mut committed, llm, options, analysis, &mut outcome)?;
    if options.autocorrect {
        autocorrect_mapped_sentences(&words, &mut committed);
    }
    // 页缝判定：把「页 k 末段尾窗 + 页 k+1 首段头窗」拼成一块发回，答案只回
    // 行号区间（seam-repair 索引载体，与 segment-repair 同款）。必须先于补
    // 分段：补分段会拆组、改变组下标，而页缝按组下标寻址。
    if enforce_paragraphs && !seams.is_empty() {
        seam_repair_wave(&words, &mut committed, seams, llm, &mut outcome, on_attempt)?;
    }
    // 定向补分段：主波次首轮接受正文后，把仍超限的段落逐块发回，只要求
    // 回行号区间（segment-repair 索引载体）；轮次耗尽后按停顿等级确定性
    // 收口。整页兜底页的单段大块、页缝合并后的大段同样在此补分段。
    if enforce_paragraphs {
        segment_repair_wave(&words, &mut committed, llm, &mut outcome, on_attempt)?;
    }
    // 分段质量结账：定向补分段与确定性收口后仍超限的段落 ⇒ 分段退化
    // （收口保证多句段落必能拆开，正常恒为 0）。若仍有，润色文本照常应用，
    // 但不盖 `stages.segment` 戳——绝不伪造 `segment: fresh`。已盖戳的重润
    // 不产出段落钉，也就没有「退化」可言，恒记 0，免得 CLI 发假告警。
    outcome.degenerate_paragraphs = if enforce_paragraphs {
        committed
            .iter()
            .filter(|group| paragraph_group_oversized(&words, group))
            .count() as u32
    } else {
        0
    };
    apply(
        doc,
        &words,
        committed,
        ids,
        options.cue_max_chars,
        &options.enabled_checks,
        outcome.degenerate_paragraphs == 0,
        &mut outcome,
    );
    // 说话人实名推断收尾：必须在 speaker-repair 之后（那一波可能把假聚簇整个
    // 吸收掉）、在正文落盘之后（润色过的文本有标点，第三方介绍好读得多）。
    // 只写 `speakers[].name`，不进指纹，不影响任何阶段戳。
    crate::engines::speaker_names::speaker_names_wave(
        doc,
        llm,
        options.speaker_names,
        !options.scope_ranges.is_empty(),
        options.reference_context.as_deref(),
        options
            .analysis
            .as_ref()
            .map(|analysis| analysis.summary.as_str()),
        options
            .analysis
            .as_ref()
            .map(|analysis| analysis.named_entities.as_slice())
            .unwrap_or_default(),
        &mut outcome.speaker_names,
        on_attempt,
    )?;
    outcome.forced_boundary_snapped = snapped;
    Ok(outcome)
}

/// 把一页的核心词区间对半重规划成若干子页（R3「拒绝即缩窄」）。
///
/// 复用同一个分页器 [`plan_polish_pages`]：核心预算取原核心区词成本的一半，
/// 因此切点仍落在句界/停顿/说话人边界上，而不是盲目的中点。只读上下文的
/// 外侧两端沿用原页（首子页的 `before`、末子页的 `after`），内侧由分页器
/// 自己给。切不出 ≥2 页（太短、或整段没有任何断点）时返回空 Vec，调用方
/// 直接走原来的整页兜底。
fn split_page_plan(words: &[Word], plan: &PolishPagePlan) -> Vec<PolishPagePlan> {
    let core = plan.core.clone();
    if core.len() < 2 {
        return Vec::new();
    }
    let cost: usize = words[core.clone()]
        .iter()
        .map(|word| word_count(&word.text).max(1))
        .sum();
    let budget = PolishBudget {
        core_words: (cost / 2).max(1),
        ..PolishBudget::default()
    };
    let sub = plan_polish_pages(&words[core.clone()], &budget);
    if sub.len() < 2 {
        return Vec::new();
    }
    let shift = |range: &Range<usize>| (range.start + core.start)..(range.end + core.start);
    let last = sub.len() - 1;
    sub.iter()
        .enumerate()
        .map(|(index, part)| PolishPagePlan {
            id: format!("{}-h{}", plan.id, index + 1),
            before: if index == 0 {
                plan.before.clone()
            } else {
                shift(&part.before)
            },
            core: shift(&part.core),
            after: if index == last {
                plan.after.clone()
            } else {
                shift(&part.after)
            },
            hard_cut_start: if index == 0 {
                plan.hard_cut_start
            } else {
                part.hard_cut_start
            },
            hard_cut_end: if index == last {
                plan.hard_cut_end
            } else {
                part.hard_cut_end
            },
            para_starts: plan.para_starts.clone(),
        })
        .collect()
}

/// 对半缩窄重试波次：每个失败页切成若干半页，全部半页**一批**发出去（各 1 次
/// 尝试），成功的半页照常落库，失败的半页只兜底自己那一半。
///
/// `split_groups[page]` 是该页按半页顺序排好的组序列；页整体切不动时不入表，
/// 调用方回落到整页兜底。
#[allow(clippy::too_many_arguments)]
fn split_polish_pages(
    words: &[Word],
    prepared: &[(PolishPagePlan, String)],
    failed_pages: &[usize],
    llm: &mut dyn LlmJson,
    system: &str,
    analysis: Option<&Analysis>,
    sleep: &mut dyn FnMut(f64),
    snapped: &mut u32,
    outcome: &mut PolishOutcome,
    split_groups: &mut BTreeMap<usize, Vec<Vec<Vec<MappedSentence>>>>,
    on_attempt: &mut dyn FnMut(&PolishPageAttempt<'_>),
) -> Result<(), LlmError> {
    // (原页下标, 半页序号, 计划, 渲染文本)
    let mut halves: Vec<(usize, usize, PolishPagePlan, String)> = Vec::new();
    for &page in failed_pages {
        let parts = split_page_plan(words, &prepared[page].0);
        if parts.is_empty() {
            continue;
        }
        for (slot, part) in parts.into_iter().enumerate() {
            let rendered = render_polish_page(words, &part).text;
            halves.push((page, slot, part, rendered));
        }
    }
    if halves.is_empty() {
        return Ok(());
    }
    outcome.split_retry_pages += halves.len() as u32;
    let requests: Vec<LlmRequest> = halves
        .iter()
        .map(|(_, _, _, input)| LlmRequest {
            kind: "polish",
            system: system.to_owned(),
            user: input.clone(),
            temperature: 0.2,
            attempt: RetryPolicy::MAX_PAGE_ATTEMPTS + 1,
            retry_reason: Some(
                "the full page failed validation twice; this request covers only half of it — \
                 reproduce every spoken word of the editable core between the fences"
                    .to_owned(),
            ),
        })
        .collect();
    let mut accepted: Vec<Option<Vec<Vec<MappedSentence>>>> =
        (0..halves.len()).map(|_| None).collect();
    complete_batch_retry_report(
        llm,
        &requests,
        1,
        sleep,
        &mut |index, raw| {
            let (_, _, plan, input) = &halves[index];
            let parsed = parse_polish_page(words, plan, input, raw);
            let mut problems = parsed.diagnostics.problems.clone();
            let mapped =
                validate_polish_file_page(words, plan, &parsed, analysis, &mut problems, snapped);
            on_attempt(&PolishPageAttempt {
                page_id: &plan.id,
                attempt: RetryPolicy::MAX_PAGE_ATTEMPTS + 1,
                input,
                output: raw,
                problems: &problems,
                accepted: mapped.is_some(),
            });
            mapped.ok_or_else(|| {
                LlmError::Malformed(format!(
                    "polish page {} rejected — {}",
                    plan.id,
                    summarize_problems(&problems)
                ))
            })
        },
        &mut |_, error| error.to_string(),
        &mut |index, mapped: Vec<Vec<MappedSentence>>| accepted[index] = Some(mapped),
    )?;

    for (index, (page, slot, plan, _)) in halves.iter().enumerate() {
        let groups = match accepted[index].take() {
            Some(groups) => groups,
            None => {
                outcome.fallback_pages += 1;
                let forced = crate::filepipe::polish_txt::forced_boundaries(words, plan);
                enforce_forced_boundaries(
                    words,
                    vec![fallback_sentences(words, plan.core.clone())],
                    &forced,
                    snapped,
                )
            }
        };
        let slots = split_groups.entry(*page).or_default();
        debug_assert_eq!(slots.len(), *slot, "半页必须按序落位");
        slots.push(groups);
    }
    Ok(())
}

/// 句子的最终口径文本：优先润色文本，兜底原词。
fn final_sentence_text(words: &[Word], sentence: &MappedSentence) -> String {
    if sentence.corrected.is_empty() {
        span_text(words, sentence.start, sentence.end)
    } else {
        sentence.corrected.clone()
    }
}

/// 段落组（最终口径文本）的词数是否超过单段上限。
/// 与 [`parse_segment_repair_page`] 同一把尺：`word_count` + 语言分档阈值。
fn paragraph_group_oversized(words: &[Word], group: &[MappedSentence]) -> bool {
    let text = group
        .iter()
        .map(|sentence| final_sentence_text(words, sentence))
        .collect::<Vec<_>>()
        .join(" ");
    word_count(&text) > paragraph_word_limit(&text)
}

/// segment-repair 的 system prompt（索引契约）。
///
/// 刻意与批次组成无关（不嵌入具体段落的语言/词数）：agent 执行器按
/// (kind, attempt) 落契约文件，同一波次里的请求必须共享同一份 system。
/// 两档阈值同时写明，模型按块头给出的口径自取。
fn segment_repair_system_prompt() -> String {
    format!(
        r#"You are fixing paragraph segmentation in a transcript that has already been copy-edited.

You receive ONE OR MORE over-long paragraphs as PLAIN TEXT. Each paragraph is a block between a header fence and an end fence, ONE SENTENCE PER LINE, every line prefixed with its 1-based line number:

{FENCE_BLOCK_PREFIX} 1 | 63 sentences | 1832 characters | at least 4 paragraphs>>>
1| first sentence…
2| second sentence…
…
63| last sentence…
{FENCE_BLOCK_END}

Split EVERY block into several paragraphs. Answer with LINE-NUMBER RANGES ONLY — do NOT copy any sentence text back:

{FENCE_BLOCK_PREFIX} 1>>>
1-14
15-30
31-47
48-63
{FENCE_BLOCK_END}

Rules:
- One range `a-b` per line, in reading order. Ranges must start at 1, be contiguous (each starts right after the previous one ends), and end at the block's last line — no gaps, no overlaps, no numbers outside the block.
- Each range is one paragraph. Break at every topic or semantic turn: a new question, a new example, a shift in time/place/subject, the end of a story or argument.
- Spoken-language paragraphs are short — usually 2 to 6 sentences.
- Every resulting paragraph must stay at or under {MAX_PARAGRAPH_WORDS_LATIN} words ({MAX_PARAGRAPH_WORDS_CJK} characters for Chinese/Japanese/Korean). The header of each block tells you its size and the MINIMUM number of paragraphs it needs; give at least that many ranges — more is fine when the topics justify it. Blocks are validated one by one; a block that still has an over-long range is sent back to you again.
- Answer for every block, in the same order, each with its own `{FENCE_BLOCK_PREFIX} k>>>` … `{FENCE_BLOCK_END}` fences, and emit NOTHING else: no sentence text, no preamble, no explanations, no code block wrapper."#
    )
}

/// 溢出容忍：模型给出的边界切出的子组超过单段上限不到这个比例时，不再烧
/// 一轮 LLM，直接由引擎按停顿等级在子组内确定性补切（584→526 这类纯容量
/// 收敛）；超过则带定向意见进下一轮，让模型按语义拆。
const SEGMENT_OVERFLOW_TOLERANCE: f64 = 0.15;

/// 句缝的停顿等级（用于确定性补切）：`sentences[i]` 与 `sentences[i+1]`
/// 之间的源音频停顿。≥1.2s → 3，≥0.6s → 2，否则 1（都是句末，至少 1）。
fn sentence_gap_rank(words: &[Word], left: &MappedSentence, right: &MappedSentence) -> u8 {
    let gap = words
        .get(right.start)
        .zip(words.get(left.end))
        .map(|(next, prev)| next.t0 - prev.t1)
        .unwrap_or(0.0);
    if gap >= 1.2 {
        3
    } else if gap >= 0.6 {
        2
    } else {
        1
    }
}

/// 把一个（仍超限的）句组按停顿等级确定性拆到单段上限以内：从头累计，某句
/// 加进来会超限时，回到当前窗口最后 40% 里停顿等级最高（并列取最靠后）的
/// 句缝切开；窗口内没有别的句缝就切在当前句前。单句本身超限只能独占一组
/// （超长句由此前的 punct-repair 处理）。返回的每组是 `group` 内的下标。
///
/// 同一把尺用于两处：模型答案里溢出不到 [`SEGMENT_OVERFLOW_TOLERANCE`] 的
/// 子组即时补切，以及 [`SEGMENT_REPAIR_MAX_ROUNDS`] 轮后仍超限段落的收口。
fn split_by_rank(words: &[Word], group: &[MappedSentence]) -> Vec<Vec<usize>> {
    let texts: Vec<String> = group
        .iter()
        .map(|sentence| final_sentence_text(words, sentence))
        .collect();
    let counts: Vec<usize> = texts.iter().map(|text| word_count(text)).collect();
    let limit = paragraph_word_limit(&texts.join(" "));
    let mut result: Vec<Vec<usize>> = Vec::new();
    let mut start = 0usize;
    let mut used = 0usize;
    for index in 0..group.len() {
        // 不变量：进入循环时 used = Σcounts[start..index] ≤ limit（单句超限的
        // 组除外，它下一轮必被独占切出）。装不下就切，切完仍装不下继续在
        // 缩小后的窗口里切，直到装下或窗口只剩当前句。
        while index > start && used + counts[index] > limit {
            let span = index - start;
            let floor = (start + 1 + (span as f64 * 0.6).floor() as usize).clamp(start + 1, index);
            let mut best = index;
            let mut best_rank = 0u8;
            for k in floor..=index {
                let rank = sentence_gap_rank(words, &group[k - 1], &group[k]);
                if rank >= best_rank {
                    best_rank = rank;
                    best = k;
                }
            }
            result.push((start..best).collect());
            start = best;
            used = counts[start..index].iter().sum();
        }
        used += counts[index];
    }
    if start < group.len() {
        result.push((start..group.len()).collect());
    }
    result
}

/// 定向补分段最多跑几轮（每轮 = 把当前仍超限的段落凑成若干载荷各发一次）。
/// 这就是"直到没有超长段落"循环的重试上限：段落被拒（区间非法/没拆）或
/// 拆开后仍明显超限的组，都只是"进下一轮"；耗尽后剩余超限段落由引擎按停顿
/// 等级确定性收口（[`split_by_rank`]），出口不再有多句超限段落。
pub const SEGMENT_REPAIR_MAX_ROUNDS: u32 = 3;

/// 定向补分段波次（`kind = "segment-repair"`，§6.4 第二阶段，索引契约）。
///
/// 主波次首轮即接受正文后，把最终接受集里仍超限的段落（含整页兜底页的
/// 单段大块、页缝合并后的大段，无论来自第几页）**凑到一起**、按主 polish 的
/// 核心区词数预算二次分页，每份载荷内每段一块（带行号句行 + 块头写词数与
/// 最少段数），逐块验收：答案只回行号区间。通过的块按区间切成多组（段落钉
/// 随组边界自然产生）；切出的组若仍超限——溢出不到
/// [`SEGMENT_OVERFLOW_TOLERANCE`] 即时按停顿等级补切，否则连同本轮被拒的段
/// 一起进入下一轮（请求带 `retry_reason` 定向指令），直到没有超长段落或达到
/// [`SEGMENT_REPAIR_MAX_ROUNDS`]；轮次耗尽后剩余超限段落确定性收口
/// （`fallback_paragraphs`）。轮内不做载体级重试——轮就是重试；可重试
/// 传输错误同样只是"本轮没拿到答案"，段保持原组进入下一轮；Terminal/
/// Cancelled 照常上抛。单句组没有可插缝，直接跳过。
fn segment_repair_wave(
    words: &[Word],
    committed: &mut Vec<Vec<MappedSentence>>,
    llm: &mut dyn LlmJson,
    outcome: &mut PolishOutcome,
    on_attempt: &mut dyn FnMut(&PolishPageAttempt<'_>),
) -> Result<(), LlmError> {
    let system = segment_repair_system_prompt();
    let budget = PolishBudget::default().core_words;
    // 上一轮对某段的定向意见，按段首句的词下标寻址（拆分后子组的段首各不
    // 相同，天然区分"被拒原封不动的段"与"拆开后仍超限的子组"）。
    let mut verdicts: BTreeMap<usize, String> = BTreeMap::new();
    let mut page_serial = 0usize;
    for round in 1..=SEGMENT_REPAIR_MAX_ROUNDS {
        // 本轮工作集：仍超限、可插缝的段落（committed 下标 + 句行 + 定向意见）。
        let mut items: Vec<(usize, Vec<String>, Option<String>)> = Vec::new();
        for (group_index, group) in committed.iter().enumerate() {
            if group.len() < 2 || !paragraph_group_oversized(words, group) {
                continue;
            }
            let lines: Vec<String> = group
                .iter()
                .map(|sentence| final_sentence_text(words, sentence))
                .collect();
            let reason = (round > 1).then(|| {
                verdicts.remove(&group[0].start).unwrap_or_else(|| {
                    let text = lines.join(" ");
                    let count = word_count(&text);
                    let limit = paragraph_word_limit(&text);
                    format!(
                        "上一轮拆分后仍有 {count} 词，超过单段上限 {limit}：请把该块至少拆成 {} 个区间",
                        count.div_ceil(limit.max(1)).max(2)
                    )
                })
            });
            items.push((group_index, lines, reason));
        }
        verdicts.clear();
        if items.is_empty() {
            break;
        }
        // 二次分页：按段落词数装入核心区预算，超长段落至少独占一页。
        let costs: Vec<usize> = items
            .iter()
            .map(|(_, lines, _)| word_count(&lines.join(" ")).max(1))
            .collect();
        let mut pages: Vec<(String, Vec<usize>, String)> = Vec::new();
        let mut cursor = 0usize;
        for size in crate::paging::balanced_page_sizes(&costs, budget) {
            let members: Vec<usize> = (cursor..cursor + size).collect();
            cursor += size;
            let paragraphs: Vec<Vec<String>> =
                members.iter().map(|&item| items[item].1.clone()).collect();
            page_serial += 1;
            pages.push((
                format!("sr{round}-{page_serial:03}"),
                members,
                render_segment_repair_page(&paragraphs),
            ));
        }
        let requests: Vec<LlmRequest> = pages
            .iter()
            .map(|(_, members, payload)| {
                let reasons: Vec<String> = members
                    .iter()
                    .enumerate()
                    .filter_map(|(position, &item)| {
                        items[item]
                            .2
                            .as_ref()
                            .map(|reason| format!("第 {} 块：{reason}", position + 1))
                    })
                    .collect();
                LlmRequest {
                    kind: "segment-repair",
                    system: system.clone(),
                    user: payload.clone(),
                    temperature: 0.2,
                    attempt: round,
                    retry_reason: (!reasons.is_empty())
                        .then(|| format!("[paragraph-oversize] {}", reasons.join("；"))),
                }
            })
            .collect();
        // 每个 item 的验收结果：Some(groups) = 该段本轮通过。
        let mut splits: Vec<Option<Vec<Vec<usize>>>> = (0..items.len()).map(|_| None).collect();
        let results = llm.complete_batch(&requests);
        debug_assert_eq!(results.len(), pages.len());
        for ((page_id, members, payload), result) in pages.iter().zip(results) {
            let raw = match result {
                Ok(raw) => raw,
                // 可重试错误 ⇒ 该页各段保持原组，进入下一轮/确定性收口。
                Err(error) if error.is_retryable() => continue,
                Err(error) => return Err(error),
            };
            let parsed = parse_segment_repair_page(payload, &raw);
            debug_assert_eq!(parsed.paragraphs.len(), members.len());
            let problems = parsed.diagnostics.problems;
            on_attempt(&PolishPageAttempt {
                page_id,
                attempt: round,
                input: payload,
                output: &raw,
                problems: &problems,
                accepted: parsed.paragraphs.iter().any(Option::is_some),
            });
            for (position, (&item, groups)) in members.iter().zip(parsed.paragraphs).enumerate() {
                if groups.is_none() {
                    // 被拒段的定向意见带进下一轮；文档级 problem（体积护栏）
                    // 没有段号，按"未拆分"处理即可。
                    let detail = problems
                        .iter()
                        .find(|problem| {
                            problem.scope == ProblemScope::Paragraph { index: position }
                        })
                        .map(|problem| format!("[{}] {}", problem.code, problem.detail))
                        .unwrap_or_else(|| {
                            "上一轮答案不可用，请按契约只回行号区间重新分段".to_owned()
                        });
                    let head = committed[items[item].0][0].start;
                    verdicts.insert(head, detail);
                }
                splits[item] = groups;
            }
        }

        // 由后往前替换，保证尚未处理的组下标不失效。溢出不到容忍度的子组
        // 即时按停顿等级补切；明显超限的子组保持原样进入下一轮（其段首词
        // 下标与原段不同，下一轮会得到"仍有 N 词"的默认意见）。
        let mut ordered: Vec<(usize, Vec<Vec<usize>>)> = items
            .iter()
            .enumerate()
            .filter_map(|(index, (group_index, _, _))| {
                splits[index].take().map(|groups| (*group_index, groups))
            })
            .collect();
        ordered.sort_by(|a, b| b.0.cmp(&a.0));
        for (group_index, groups) in ordered {
            let original = committed.remove(group_index);
            debug_assert_eq!(
                groups.iter().map(Vec::len).sum::<usize>(),
                original.len(),
                "segment repair groups must cover every sentence exactly once"
            );
            if groups.len() > 1 {
                outcome.repaired_paragraphs += 1;
            }
            let mut offset = 0usize;
            for line_indexes in groups {
                let sub: Vec<MappedSentence> = line_indexes
                    .iter()
                    .map(|&line| original[line].clone())
                    .collect();
                for piece in split_within_tolerance(words, sub) {
                    committed.insert(group_index + offset, piece);
                    offset += 1;
                }
            }
        }
    }
    // 收口：轮次耗尽（或本轮没有可发的段）后仍超限的多句段落，按停顿等级
    // 确定性拆开。出口保证没有多句超限段落。
    let mut index = 0usize;
    while index < committed.len() {
        if committed[index].len() >= 2 && paragraph_group_oversized(words, &committed[index]) {
            let original = committed.remove(index);
            let pieces = split_by_rank(words, &original);
            outcome.fallback_paragraphs += 1;
            let count = pieces.len();
            for (offset, line_indexes) in pieces.into_iter().enumerate() {
                let sub: Vec<MappedSentence> = line_indexes
                    .iter()
                    .map(|&line| original[line].clone())
                    .collect();
                committed.insert(index + offset, sub);
            }
            index += count;
        } else {
            index += 1;
        }
    }
    Ok(())
}

/// 模型答案切出的子组：不超限或溢出不到 [`SEGMENT_OVERFLOW_TOLERANCE`] 时
/// 即时收敛（超限的按停顿等级补切），否则原样返回（进入下一轮）。
fn split_within_tolerance(words: &[Word], group: Vec<MappedSentence>) -> Vec<Vec<MappedSentence>> {
    if group.len() < 2 || !paragraph_group_oversized(words, &group) {
        return vec![group];
    }
    let text = group
        .iter()
        .map(|sentence| final_sentence_text(words, sentence))
        .collect::<Vec<_>>()
        .join(" ");
    let count = word_count(&text) as f64;
    let limit = paragraph_word_limit(&text) as f64;
    if count > limit * (1.0 + SEGMENT_OVERFLOW_TOLERANCE) {
        return vec![group];
    }
    split_by_rank(words, &group)
        .into_iter()
        .map(|line_indexes| {
            line_indexes
                .iter()
                .map(|&line| group[line].clone())
                .collect()
        })
        .collect()
}

// ---- 页缝判定（seam-repair）------------------------------------------------

/// 硬切页缝无条件合并：`plans[k].hard_cut_end` 时把页 k+1 的首段并进它前面
/// 最近一个非空页的末段。返回合并次数。
///
/// 页 k+1 只有一段且随后又是硬切时会连锁：该页被并空，下一条硬切页缝仍然
/// 找到「前面最近的非空页」继续并——页缝合并只会让段落变长，不会丢句。
fn merge_hard_cut_seams(
    plans: &[&PolishPagePlan],
    per_page: &mut [Vec<Vec<MappedSentence>>],
) -> u32 {
    let mut merged = 0_u32;
    for right in 1..per_page.len() {
        if !plans[right - 1].hard_cut_end || per_page[right].is_empty() {
            continue;
        }
        let Some(left) = (0..right).rev().find(|page| !per_page[*page].is_empty()) else {
            continue;
        };
        let head = per_page[right].remove(0);
        per_page[left]
            .last_mut()
            .expect("non-empty page has a last group")
            .extend(head);
        merged += 1;
    }
    merged
}

/// 页缝候选：返回 `committed` 里「页 k+1 首组」的下标（该组与前一组之间就是
/// 页缝），升序。跳过硬切页缝（已合并）、说话人切换处（⏹ 硬保证，段钉必然
/// 成立）、后一页显式声明「另起一段」的页缝（记 `seam_signaled_paragraphs`）
/// 以及被并空的页。
fn seam_candidates(
    words: &[Word],
    plans: &[&PolishPagePlan],
    page_spans: &[std::ops::Range<usize>],
    seam_signals: &[bool],
    outcome: &mut PolishOutcome,
) -> Vec<usize> {
    let mut seams = Vec::new();
    for right in 1..plans.len() {
        let plan = plans[right];
        if plans[right - 1].hard_cut_end || page_spans[right].is_empty() {
            continue;
        }
        let start = plan.core.start;
        if start == 0 || start >= words.len() || words[start - 1].sp != words[start].sp {
            continue;
        }
        let boundary = page_spans[right].start;
        // 前一组必须存在（前面至少有一个非空页）。
        if boundary == 0 {
            continue;
        }
        if seam_signals[right] {
            outcome.seam_signaled_paragraphs += 1;
            continue;
        }
        seams.push(boundary);
    }
    seams
}

/// seam-repair 的 system prompt（索引契约；与批次组成无关，同一波次共享一份）。
fn seam_repair_system_prompt() -> String {
    format!(
        r#"You are checking paragraph boundaries at PAGE SEAMS in a transcript that has already been copy-edited and paragraphed.

The transcript was processed in pages. Where one page ends and the next begins, the text was cut mechanically, so the paragraph break at that point may or may not be real. You receive ONE OR MORE blocks as PLAIN TEXT. Each block is a window around one seam (occasionally several): the last sentences before the seam followed by the first sentences after it, ONE SENTENCE PER LINE, every line prefixed with its 1-based line number. The header names the seam: `page seam before line N` means the previous page ended with line N-1 and the next page started with line N.

{FENCE_BLOCK_PREFIX} 1 | 30 sentences | 410 characters | page seam before line 17>>>
1| …
…
30| …
{FENCE_BLOCK_END}

Answer with LINE-NUMBER RANGES ONLY — one paragraph per range, do NOT copy any sentence text back:

{FENCE_BLOCK_PREFIX} 1>>>
1-16
17-30
{FENCE_BLOCK_END}

Rules:
- Ranges must start at 1, be contiguous (each starts right after the previous one ends) and end at the block's last line — no gaps, no overlaps, no numbers outside the block.
- The window may begin and end in the middle of a paragraph; that is expected. What matters is where the paragraph boundaries fall INSIDE the window.
- If the sentence at the seam continues the thought of the sentences before it, do NOT start a range there — let one range span the seam. A single range covering the whole block (`1-30`) is a valid answer when the window is one paragraph.
- Start a range at the seam only when a new topic, question, example or story really begins there.
- A boundary elsewhere in the window is welcome when the topic actually turns there — for example when the paragraph that continues across the seam really started a few sentences before it.
- Never break just to keep paragraphs short. Paragraphs of spoken language stay under {MAX_PARAGRAPH_WORDS_LATIN} words ({MAX_PARAGRAPH_WORDS_CJK} characters for Chinese/Japanese/Korean), but a window this size is often a single paragraph.
- Answer for every block, in the same order, each with its own `{FENCE_BLOCK_PREFIX} k>>>` … `{FENCE_BLOCK_END}` fences, and emit NOTHING else: no sentence text, no preamble, no explanations, no code block wrapper."#
    )
}

/// 页缝判定最多跑几轮：第一轮发全部候选，第二轮只重发被拒的块（带
/// `retry_reason`）。耗尽后仍被拒的页缝保留段钉（与不做判定完全一致）。
pub const SEAM_REPAIR_MAX_ROUNDS: u32 = 2;

/// 页缝窗口：块只取页 k 末段**最后**约这么多词的句子与页 k+1 首段**开头**约
/// 这么多词的句子（累计到阈值的那一句含入，每侧至少 1 句）。窗口把块体积
/// 与两侧段落长度解耦：整页单段（2200 词）也只发一个 ~500 词的窗口，模型
/// 判断的是页缝局部，不必复读整页。
const SEAM_WINDOW_WORDS: usize = 250;

/// `group` 末尾累计到 [`SEAM_WINDOW_WORDS`] 需要的句数（≥1，≤ len）。
fn seam_tail_take(words: &[Word], group: &[MappedSentence]) -> usize {
    let mut acc = 0usize;
    let mut take = 0usize;
    for sentence in group.iter().rev() {
        if take > 0 && acc >= SEAM_WINDOW_WORDS {
            break;
        }
        acc += word_count(&final_sentence_text(words, sentence));
        take += 1;
    }
    take
}

/// `group` 开头累计到 [`SEAM_WINDOW_WORDS`] 需要的句数（≥1，≤ len）。
fn seam_head_take(words: &[Word], group: &[MappedSentence]) -> usize {
    let mut acc = 0usize;
    let mut take = 0usize;
    for sentence in group {
        if take > 0 && acc >= SEAM_WINDOW_WORDS {
            break;
        }
        acc += word_count(&final_sentence_text(words, sentence));
        take += 1;
    }
    take
}

/// 页缝判定波次（`kind = "seam-repair"`，索引契约）。
///
/// `seams` 是 `committed` 里页 k+1 首组的下标（升序）。波次先把 `committed`
/// 摊平成句子序列 + 段首集合（全局句下标），页缝即其中的段首；每个页缝的块
/// = 左段尾窗 + 右段头窗（[`SEAM_WINDOW_WORDS`]），头窗盖住整个右段且下一个
/// 页缝紧随其后时链成一块（块内多个页缝）。答案按区间切组，只采纳**跨缝
/// 组**的两端：含页缝行的区间从页缝行起 ⇒ 保留（`seam_kept_paragraphs`）；
/// 否则去掉页缝段首（`seam_merged_paragraphs`），并把该区间在窗口内部的起
/// 点/终点补成段首（页缝段真正的起止）。窗口边缘与不跨缝的区间一律忽略
/// （窗口是截断的，边缘边界不可信）。所有编辑都是段首集合上的集合运算，
/// 块之间互不干扰；块被拒/传输失败 ⇒ 下一轮，耗尽后保留原段钉。合并后
/// 仍超限的段落交给紧随其后的 segment-repair 按语义拆。
fn seam_repair_wave(
    words: &[Word],
    committed: &mut Vec<Vec<MappedSentence>>,
    seams: Vec<usize>,
    llm: &mut dyn LlmJson,
    outcome: &mut PolishOutcome,
    on_attempt: &mut dyn FnMut(&PolishPageAttempt<'_>),
) -> Result<(), LlmError> {
    let system = seam_repair_system_prompt();
    let budget = PolishBudget::default().core_words;
    // 摊平：flat 句子 + 段首集合；页缝 → 全局句下标。
    let mut group_starts: Vec<usize> = Vec::with_capacity(committed.len());
    let mut flat: Vec<MappedSentence> = Vec::new();
    for group in committed.iter() {
        group_starts.push(flat.len());
        flat.extend(group.iter().cloned());
    }
    let mut starts: BTreeSet<usize> = group_starts.iter().copied().collect();
    starts.insert(0);
    let mut pending: Vec<usize> = seams
        .into_iter()
        .filter(|&b| b > 0 && b < group_starts.len())
        .map(|b| group_starts[b])
        .collect();
    let mut verdicts: BTreeMap<usize, String> = BTreeMap::new();
    let mut page_serial = 0usize;
    for round in 1..=SEAM_REPAIR_MAX_ROUNDS {
        pending.sort_unstable();
        pending.dedup();
        pending.retain(|g| starts.contains(g) && *g > 0);
        if pending.is_empty() {
            break;
        }
        // 块：全局句下标 base 起的 lines，seam_offsets 为块内偏移。
        struct Block {
            base: usize,
            lines: Vec<String>,
            seam_offsets: Vec<usize>,
            reason: Option<String>,
        }
        let mut blocks: Vec<Block> = Vec::new();
        for &seam in &pending {
            let left_start = starts.range(..seam).next_back().copied().unwrap_or(0);
            let right_end = starts
                .range(seam + 1..)
                .next()
                .copied()
                .unwrap_or(flat.len());
            let head = seam_head_take(words, &flat[seam..right_end]);
            if let Some(block) = blocks.last_mut()
                && block.base + block.lines.len() == seam
            {
                // 上一块的头窗恰好盖满左段（该段就是上一页缝的右段）⇒ 链接。
                block.seam_offsets.push(block.lines.len());
                block.lines.extend(
                    flat[seam..seam + head]
                        .iter()
                        .map(|s| final_sentence_text(words, s)),
                );
                continue;
            }
            let tail = seam_tail_take(words, &flat[left_start..seam]);
            let base = seam - tail;
            let mut lines: Vec<String> = flat[base..seam]
                .iter()
                .map(|s| final_sentence_text(words, s))
                .collect();
            lines.extend(
                flat[seam..seam + head]
                    .iter()
                    .map(|s| final_sentence_text(words, s)),
            );
            blocks.push(Block {
                base,
                lines,
                seam_offsets: vec![tail],
                reason: None,
            });
        }
        // 空句行会破坏行↔句对应，整块跳过（保留段钉）。
        blocks.retain(|block| {
            block
                .lines
                .iter()
                .all(|line| line.split_whitespace().next().is_some())
        });
        if round > 1 {
            for block in &mut blocks {
                block.reason = Some(
                    verdicts
                        .remove(&flat[block.base].start)
                        .unwrap_or_else(|| "上一轮答案不可用，请按契约只回行号区间".to_owned()),
                );
            }
        }
        verdicts.clear();
        if blocks.is_empty() {
            break;
        }
        let costs: Vec<usize> = blocks
            .iter()
            .map(|block| word_count(&block.lines.join(" ")).max(1))
            .collect();
        let mut pages: Vec<(String, Vec<usize>, String)> = Vec::new();
        let mut cursor = 0usize;
        for size in crate::paging::balanced_page_sizes(&costs, budget) {
            let members: Vec<usize> = (cursor..cursor + size).collect();
            cursor += size;
            let rendered: Vec<(Vec<String>, Vec<usize>)> = members
                .iter()
                .map(|&item| {
                    (
                        blocks[item].lines.clone(),
                        blocks[item].seam_offsets.clone(),
                    )
                })
                .collect();
            page_serial += 1;
            pages.push((
                format!("sm{round}-{page_serial:03}"),
                members,
                render_seam_repair_page(&rendered),
            ));
        }
        let requests: Vec<LlmRequest> = pages
            .iter()
            .map(|(_, members, payload)| {
                let reasons: Vec<String> = members
                    .iter()
                    .enumerate()
                    .filter_map(|(position, &item)| {
                        blocks[item]
                            .reason
                            .as_ref()
                            .map(|reason| format!("第 {} 块：{reason}", position + 1))
                    })
                    .collect();
                LlmRequest {
                    kind: "seam-repair",
                    system: system.clone(),
                    user: payload.clone(),
                    temperature: 0.2,
                    attempt: round,
                    retry_reason: (!reasons.is_empty())
                        .then(|| format!("[range-invalid] {}", reasons.join("；"))),
                }
            })
            .collect();
        let mut splits: Vec<Option<Vec<Vec<usize>>>> = (0..blocks.len()).map(|_| None).collect();
        let results = llm.complete_batch(&requests);
        debug_assert_eq!(results.len(), pages.len());
        for ((page_id, members, payload), result) in pages.iter().zip(results) {
            let raw = match result {
                Ok(raw) => raw,
                Err(error) if error.is_retryable() => continue,
                Err(error) => return Err(error),
            };
            let parsed = parse_segment_repair_page(payload, &raw);
            debug_assert_eq!(parsed.paragraphs.len(), members.len());
            let problems = parsed.diagnostics.problems;
            on_attempt(&PolishPageAttempt {
                page_id,
                attempt: round,
                input: payload,
                output: &raw,
                problems: &problems,
                accepted: parsed.paragraphs.iter().any(Option::is_some),
            });
            for (position, (&item, groups)) in members.iter().zip(parsed.paragraphs).enumerate() {
                match groups {
                    // 页缝块「一个区间盖全块」是合法答案（整块延续同一段），
                    // 载体把超限的它判成 paragraph-oversize；这里只把区间非法
                    // 当作拒收，其余按「一整组」处理。
                    None => {
                        let problem = problems.iter().find(|problem| {
                            problem.scope == ProblemScope::Paragraph { index: position }
                        });
                        match problem {
                            Some(problem) if problem.code == ProblemCode::ParagraphOversize => {
                                splits[item] = Some(vec![(0..blocks[item].lines.len()).collect()]);
                            }
                            Some(problem) => {
                                verdicts.insert(
                                    flat[blocks[item].base].start,
                                    format!("[{}] {}", problem.code, problem.detail),
                                );
                            }
                            None => {
                                verdicts.insert(
                                    flat[blocks[item].base].start,
                                    "上一轮答案不可用，请按契约只回行号区间".to_owned(),
                                );
                            }
                        }
                    }
                    Some(groups) => splits[item] = Some(groups),
                }
            }
        }

        // 应用：只采纳跨缝组的两端；未通过的块的页缝进入下一轮。
        let mut next_pending: Vec<usize> = Vec::new();
        for (index, block) in blocks.iter().enumerate() {
            let Some(groups) = splits[index].take() else {
                next_pending.extend(block.seam_offsets.iter().map(|offset| block.base + offset));
                continue;
            };
            let len = block.lines.len();
            for &offset in &block.seam_offsets {
                let Some(group) = groups.iter().find(|group| group.contains(&offset)) else {
                    continue;
                };
                let (gs, ge) = (group[0], group[group.len() - 1] + 1);
                if gs == offset {
                    outcome.seam_kept_paragraphs += 1;
                    continue;
                }
                starts.remove(&(block.base + offset));
                outcome.seam_merged_paragraphs += 1;
                if gs > 0 {
                    starts.insert(block.base + gs);
                }
                if ge < len {
                    starts.insert(block.base + ge);
                }
            }
        }
        pending = next_pending;
    }
    // 回填：按段首集合重新分组。
    let mut rebuilt: Vec<Vec<MappedSentence>> = Vec::new();
    for sentence in flat.into_iter().enumerate() {
        if starts.contains(&sentence.0) || rebuilt.is_empty() {
            rebuilt.push(Vec::new());
        }
        rebuilt.last_mut().expect("pushed above").push(sentence.1);
    }
    *committed = rebuilt;
    Ok(())
}

/// agent 侧 `task submit` 对 seam-repair 答案的镜像 lint：与 segment-repair
/// 同一索引载体、同一解析器。「一个区间盖住整块」在页缝块里是合法答案
/// （整块延续同一段），因此把 `paragraph-oversize` 从 problem 里剔除。
pub fn lint_agent_answer_seam_repair(payload: &str, answer: &str) -> Vec<String> {
    parse_segment_repair_page(payload, answer)
        .diagnostics
        .problems
        .iter()
        .filter(|problem| problem.code != ProblemCode::ParagraphOversize)
        .map(|problem| format!("[{}] {}", problem.code, problem.detail))
        .collect()
}

// ---- 定向补标点（punct-repair）-------------------------------------------

/// punct-repair 的 system prompt。
///
/// 与批次组成无关（同一波次共享同一份 system，agent 执行器按 (kind, attempt)
/// 落契约文件）。重点从「纠错」切换成「只加句末标点」：非标点字符必须逐字
/// 复现，条目之间用带 id 的栅栏隔离、互不干扰。
fn punct_repair_system_prompt() -> String {
    format!(
        r#"You are adding sentence-ending punctuation to over-long run-on sentences in a transcript that has already been copy-edited.

You receive ONE OR MORE items as PLAIN TEXT. Each item is one derived "sentence" that never closes, and sits between its own pair of fence lines carrying an id:

{FENCE_SENTENCE_BEGIN_PREFIX} id=s01 min-sentences=3>>>
…the text of item s01…
{FENCE_SENTENCE_END_PREFIX} id=s01>>>

{FENCE_SENTENCE_BEGIN_PREFIX} id=s02 min-sentences=2>>>
…the text of item s02…
{FENCE_SENTENCE_END_PREFIX} id=s02>>>

Your ONLY job is to split every item into several real sentences by ADDING sentence-ending punctuation:

- Add `.` `?` `!` (Latin scripts) or `。` `？` `！` (Chinese/Japanese/Korean) at every semantic completion. Spoken sentences are short; close each complete thought.
- `min-sentences=N` is the minimum number of sentences that item must become. Items are validated one by one; an item that comes back without any new sentence end is sent back to you again.
- You may turn an existing comma into a sentence end, but never leave conflicting adjacent marks such as `。，`, `，。`, `，，`, `,,`, `..` or `.,`, and never end a sentence on a dangling connector, preposition, or incomplete lead-in (`because.`, `of.`, `当。`, `让。`, `和。`, `向。`).
- Do NOT fix typos, wording, spacing inside words, capitalization, or anything else — every character that is not punctuation must be reproduced EXACTLY, in order. An item whose non-punctuation content changes is rejected.
- Items are independent. Never move text between items, never merge, reorder, or drop items.
- "⏸" / "⏸⏸" / "⏸⏸⏸" mark a short / medium / long pause in the original audio. They are a soft hint only — a pause often falls mid-sentence, so split by MEANING. NEVER copy them into your answer.
- Reproduce every item between its own fence lines with the SAME id, in the same order, and emit NOTHING outside the fences: no preamble, no explanations, no headings, no markdown code block wrapper."#
    )
}

/// 定向补标点最多跑几轮（每轮 = 把当前仍超长的句子凑成若干载荷各发一次）。
/// 句被拒（改写/没加句末标点/切点投影不回源词）或拆开后仍有超长片，都只是
/// "进下一轮"；耗尽后剩余超长句由 [`split_oversized_sentence`] 确定性切开。
pub const PUNCT_REPAIR_MAX_ROUNDS: u32 = 3;

/// 超长句进 punct-repair 载体的正文：corrected 文本 + 按源时间轴投影回来的
/// ⏸ 停顿软提示。主 polish 页里模型本来就看得到这些标记，定向修复不该比
/// 首轮更盲；投影靠 atom-LCS（每个源词最后一个匹配 atom 之后插标记），
/// 对不齐就退回裸文本。
fn punct_repair_hinted_text(words: &[Word], sentence: &MappedSentence) -> String {
    let Some(alignment) = sentence_alignment(words, sentence) else {
        return sentence.corrected.clone();
    };
    let mut inserts: Vec<(usize, String)> = Vec::new();
    for (position, &(word, atom)) in alignment.matches.iter().enumerate() {
        if word >= sentence.end
            || alignment
                .matches
                .get(position + 1)
                .is_some_and(|(next_word, _)| *next_word == word)
        {
            continue;
        }
        let marks = pause_marks(words[word + 1].t0 - words[word].t1);
        if !marks.is_empty() {
            inserts.push((atom, marks));
        }
    }
    if inserts.is_empty() {
        return sentence.corrected.clone();
    }
    let mut prefix: Vec<usize> = Vec::with_capacity(alignment.atoms.len());
    let mut sum = 0usize;
    for atom in &alignment.atoms {
        sum += atom.chars().count();
        prefix.push(sum);
    }
    // 由后往前插入：前面的非空白计数不受后面插入的标记影响。
    let mut text = sentence.corrected.clone();
    for (atom, marks) in inserts.into_iter().rev() {
        if let Some(index) = after_nonspace_char_index(&text, prefix[atom]) {
            text.insert_str(index, &format!(" {marks} "));
        }
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 第 `count` 个非空白字符（1 起）之后的字节下标。
fn after_nonspace_char_index(text: &str, count: usize) -> Option<usize> {
    let mut seen = 0usize;
    for (index, ch) in text.char_indices() {
        if ch.is_whitespace() {
            continue;
        }
        seen += 1;
        if seen == count {
            return Some(index + ch.len_utf8());
        }
    }
    None
}

/// 把 punct-repair 接受的答案切成句、映射回原句的源词区间。
///
/// 载体层已证明非标点原子恒等且至少新增了一个句末标点；这里再要求切出的
/// 句都能各自锚到源词（`None` = 切点无法投影，句保持原样进下一轮）。
fn repunctuated_pieces(
    words: &[Word],
    sentence: &MappedSentence,
    text: &str,
    analysis: Option<&Analysis>,
) -> Option<Vec<MappedSentence>> {
    let pieces: Vec<String> = split_sentence_text(text)
        .into_iter()
        .map(|piece| sanitize_corrected(&piece))
        .filter(|piece| !piece.is_empty())
        .collect();
    if pieces.len() < 2 {
        return None;
    }
    let mapped = map_corrected_page(words, sentence.start..sentence.end + 1, &[pieces]).ok()?;
    let mut flat: Vec<MappedSentence> = mapped.into_iter().flatten().collect();
    if flat.len() < 2 {
        return None;
    }
    heal_boundaries(words, &mut flat, analysis);
    Some(flat)
}

/// 定向补标点波次（`kind = "punct-repair"`）。
///
/// 主波次首轮即接受正文后，把最终接受集里仍超过单句跨度上限
/// （[`oversized_span`]）的句子**凑到一起**、按主 polish 的核心区词数预算二次
/// 分页（有 worker 槽数时再拆到能填满槽位），每份载荷内每句一对带 id 的
/// 栅栏、逐句验收：payload 是 corrected 文本加投影回来的 ⏸ 提示，答案只允许
/// 加/改标点。通过的句按新句末标点切开并重新映射到源词；切出的片若仍超长，
/// 连同本轮被拒的句一起进入下一轮（请求带 `retry_reason` 逐句定向指令），
/// 直到没有超长句或达到 [`PUNCT_REPAIR_MAX_ROUNDS`]。轮内不做载体级重试——
/// 轮就是重试；可重试传输错误同样只是"本轮没拿到答案"；Terminal/Cancelled
/// 照常上抛。轮次耗尽仍超长的句由 [`split_oversized_sentence`] 按源时间轴
/// 确定性切开，保证出口没有超长句。
fn punct_repair_wave(
    words: &[Word],
    committed: &mut [Vec<MappedSentence>],
    llm: &mut dyn LlmJson,
    options: &PolishOptions,
    outcome: &mut PolishOutcome,
    on_attempt: &mut dyn FnMut(&PolishPageAttempt<'_>),
) -> Result<(), LlmError> {
    let system = punct_repair_system_prompt();
    let analysis = options.analysis.as_ref();
    let budget = PolishBudget::default().core_words;
    // 上一轮对某句的定向意见，按句首词下标寻址（拆开后的片首各不相同，
    // 天然区分"被拒原封不动的句"与"拆开后仍超长的片"）。
    let mut verdicts: BTreeMap<usize, String> = BTreeMap::new();
    let mut page_serial = 0usize;
    for round in 1..=PUNCT_REPAIR_MAX_ROUNDS {
        // 本轮工作集：仍超长、有 corrected 文本的句（committed 坐标 + 载体条目 + 定向意见）。
        let mut targets: Vec<(usize, usize)> = Vec::new();
        let mut items: Vec<PunctRepairItem> = Vec::new();
        let mut costs: Vec<usize> = Vec::new();
        let mut reasons: Vec<Option<String>> = Vec::new();
        for (group_index, group) in committed.iter().enumerate() {
            for (sentence_index, sentence) in group.iter().enumerate() {
                if sentence.corrected.is_empty() {
                    continue;
                }
                let Some(reason) = oversized_span(words, sentence) else {
                    continue;
                };
                let units = word_count(&sentence.corrected);
                let limit = paragraph_word_limit(&sentence.corrected);
                items.push(PunctRepairItem {
                    id: format!("s{:02}", items.len() + 1),
                    text: punct_repair_hinted_text(words, sentence),
                    min_sentences: units.div_ceil((limit / 2).max(1)).max(2),
                });
                costs.push(units.max(1));
                reasons.push((round > 1).then(|| {
                    verdicts.remove(&sentence.start).unwrap_or_else(|| {
                        format!("上一轮拆分后仍超长（{reason}）：请继续在语义完成处补句末标点")
                    })
                }));
                targets.push((group_index, sentence_index));
            }
        }
        verdicts.clear();
        if items.is_empty() {
            break;
        }
        // 二次分页：按句子单位数装入核心区预算；槽数已知且页数填不满槽位时
        // 再拆细，让并发 worker 都有活干（每页至少一句）。
        let mut sizes = crate::paging::balanced_page_sizes(&costs, budget);
        if let Some(slots) = options.worker_slots.filter(|&slots| slots > 1)
            && sizes.len() < slots
            && items.len() > sizes.len()
        {
            sizes = crate::paging::balanced_page_sizes_for_count(
                &costs,
                slots.min(items.len()),
                items.len(),
            );
        }
        let mut pages: Vec<(String, Vec<usize>, String)> = Vec::new();
        let mut cursor = 0usize;
        for size in sizes {
            let members: Vec<usize> = (cursor..cursor + size).collect();
            cursor += size;
            let batch: Vec<PunctRepairItem> =
                members.iter().map(|&item| items[item].clone()).collect();
            page_serial += 1;
            pages.push((
                format!("pr{round}-{page_serial:03}"),
                members,
                render_punct_repair_page(&batch),
            ));
        }
        let requests: Vec<LlmRequest> = pages
            .iter()
            .map(|(_, members, payload)| {
                let notes: Vec<String> = members
                    .iter()
                    .filter_map(|&item| {
                        reasons[item]
                            .as_ref()
                            .map(|reason| format!("{}: {reason}", items[item].id))
                    })
                    .collect();
                LlmRequest {
                    kind: "punct-repair",
                    system: system.clone(),
                    user: payload.clone(),
                    temperature: 0.2,
                    attempt: round,
                    retry_reason: (!notes.is_empty())
                        .then(|| format!("[sentence-oversize] {}", notes.join("；"))),
                }
            })
            .collect();
        let results = llm.complete_batch(&requests);
        debug_assert_eq!(results.len(), pages.len());
        // 每句的验收结果：Some(pieces) = 该句本轮拆开。
        let mut replacements: Vec<(usize, usize, Vec<MappedSentence>)> = Vec::new();
        for ((page_id, members, payload), result) in pages.iter().zip(results) {
            let raw = match result {
                Ok(raw) => raw,
                // 可重试错误 ⇒ 该页各句保持原样，进入下一轮/确定性兜底。
                Err(error) if error.is_retryable() => continue,
                Err(error) => return Err(error),
            };
            let parsed = parse_punct_repair_page(payload, &raw);
            debug_assert_eq!(parsed.sentences.len(), members.len());
            let mut problems = parsed.diagnostics.problems;
            let mut accepted_any = false;
            for (&item, answer) in members.iter().zip(parsed.sentences) {
                let (group_index, sentence_index) = targets[item];
                let sentence = &committed[group_index][sentence_index];
                let id = items[item].id.as_str();
                let pieces = match answer {
                    Some(text) => {
                        let pieces = repunctuated_pieces(words, sentence, &text, analysis);
                        if pieces.is_none() {
                            problems.push(Problem::sentence(
                                ProblemCode::SentenceOversize,
                                id,
                                "新加的句末标点无法投影回源词，句保持原样",
                            ));
                        }
                        pieces
                    }
                    None => None,
                };
                match pieces {
                    Some(pieces) => {
                        accepted_any = true;
                        replacements.push((group_index, sentence_index, pieces));
                    }
                    None => {
                        let detail = problems
                            .iter()
                            .find(|problem| {
                                problem.scope == ProblemScope::Sentence { id: id.to_owned() }
                            })
                            .or_else(|| {
                                problems
                                    .iter()
                                    .find(|problem| problem.scope == ProblemScope::Document)
                            })
                            .map(|problem| format!("[{}] {}", problem.code, problem.detail))
                            .unwrap_or_else(|| {
                                "上一轮答案不可用，请按契约只在语义完成处补句末标点".to_owned()
                            });
                        verdicts.insert(sentence.start, detail);
                    }
                }
            }
            on_attempt(&PolishPageAttempt {
                page_id,
                attempt: round,
                input: payload,
                output: &raw,
                problems: &problems,
                accepted: accepted_any,
            });
        }
        // 由后往前替换，保证尚未处理的句下标不失效。
        replacements.sort_by(|a, b| (b.0, b.1).cmp(&(a.0, a.1)));
        for (group_index, sentence_index, pieces) in replacements {
            outcome.punct_repaired_sentences += 1;
            committed[group_index].splice(sentence_index..=sentence_index, pieces);
        }
    }
    // 轮次耗尽：剩余超长句按源时间轴确定性切开；仍切不动的计入结账。
    for group in committed.iter_mut() {
        let mut index = 0usize;
        while index < group.len() {
            let sentence = &group[index];
            if sentence.corrected.is_empty() || oversized_span(words, sentence).is_none() {
                index += 1;
                continue;
            }
            let pieces = split_oversized_sentence(words, sentence);
            if pieces.len() > 1 {
                outcome.punct_split_sentences += 1;
            }
            outcome.oversized_sentences += pieces
                .iter()
                .filter(|piece| oversized_span(words, piece).is_some())
                .count() as u32;
            let advance = pieces.len();
            group.splice(index..=index, pieces);
            index += advance;
        }
    }
    Ok(())
}

/// 句读级停顿标点：切句候选评分里"逗号处停顿"的判据（源词或 corrected 原子
/// 尾部）。
const CLAUSE_PUNCT: &[char] = &['，', ',', '；', ';', '、', '：', ':'];

fn ends_with_clause_punct(text: &str) -> bool {
    text.trim_end()
        .chars()
        .next_back()
        .is_some_and(|ch| CLAUSE_PUNCT.contains(&ch))
}

/// 确定性切句候选的分值（越高越优先）：说话人切换 5 > 源词自带句末标点 4 >
/// 长停顿（≥1.8s）3 > 停顿 + 逗号 2 > 仅停顿或仅逗号 1 > 0（长度兜底）。
/// `clause_words` 是 corrected 里逗号类标点投影回去的源词。
fn deterministic_split_score(
    words: &[Word],
    boundary: usize,
    clause_words: &BTreeSet<usize>,
) -> u8 {
    let prev = &words[boundary - 1];
    let next = &words[boundary];
    if prev.sp != next.sp {
        return 5;
    }
    if sentence_end(&prev.text) {
        return 4;
    }
    let pause = pause_marks(next.t0 - prev.t1).chars().count();
    let clause = clause_words.contains(&(boundary - 1)) || ends_with_clause_punct(&prev.text);
    if pause >= 3 {
        3
    } else if pause >= 1 && clause {
        2
    } else if pause >= 1 || clause {
        1
    } else {
        0
    }
}

/// 让确定性切出的左半句以句末标点收口：去掉尾部逗号类标点，再按文字脚本补
/// `。`/`.`；已经是句末标点（含右闭合符）的不动。
fn close_sentence(text: &mut String) {
    let trimmed = text.trim_end();
    let mut end = trimmed.len();
    while let Some(ch) = trimmed[..end].chars().next_back() {
        if CLAUSE_PUNCT.contains(&ch) || ch.is_whitespace() {
            end -= ch.len_utf8();
        } else {
            break;
        }
    }
    text.truncate(end);
    let already_closed = text
        .chars()
        .rev()
        .find(|ch| !RESPLIT_CLOSERS.contains(ch))
        .is_some_and(|ch| RESPLIT_TERMINAL.contains(&ch));
    if !already_closed && !text.is_empty() {
        // 句号跟文字走：汉字 / 假名用 `。`，其余（含韩文）用 `.`。
        text.push(if text.chars().any(is_unspaced_cjk_char) {
            '。'
        } else {
            '.'
        });
    }
}

/// 在超长句里按源时间轴挑一个切点切一刀。
///
/// 左半句的源原子数落在 [limit/5, limit×4/5] 窗口内（同时受源字符与时长上限
/// 约束），窗口内按 [`deterministic_split_score`] 取最高分、同分取更靠后（片
/// 更少）；窗口内没有候选（稀疏词/超长时长）时退到窗口前的任意边界。切点必须
/// 能经 atom-LCS 投影进 corrected，投影不动就顺延下一候选。
fn split_once_deterministically(
    words: &[Word],
    sentence: &MappedSentence,
) -> Option<(MappedSentence, MappedSentence)> {
    let alignment = sentence_alignment(words, sentence)?;
    let mut clause_words: BTreeSet<usize> = BTreeSet::new();
    for (position, &(word, atom)) in alignment.matches.iter().enumerate() {
        let last_of_word = alignment
            .matches
            .get(position + 1)
            .is_none_or(|(next_word, _)| *next_word != word);
        if last_of_word && ends_with_clause_punct(&alignment.atoms[atom]) {
            clause_words.insert(word);
        }
    }
    let limit = paragraph_word_limit(&sentence.corrected);
    let max_units = limit * 4 / 5;
    let min_units = limit / 5;
    let mut in_window: Vec<(u8, usize)> = Vec::new();
    let mut short: Vec<(u8, usize)> = Vec::new();
    let mut units = 0usize;
    let mut chars = 0usize;
    for index in sentence.start..sentence.end {
        units += word_count(&words[index].text).max(1);
        chars += words[index].text.chars().count() + 1;
        let seconds = words[index].t1 - words[sentence.start].t0;
        if units > max_units
            || chars > MAX_SENTENCE_SOURCE_CHARS
            || seconds > MAX_SENTENCE_SPAN_SECONDS
        {
            break;
        }
        let boundary = index + 1;
        let score = deterministic_split_score(words, boundary, &clause_words);
        if units < min_units {
            short.push((score, boundary));
        } else {
            in_window.push((score, boundary));
        }
    }
    let mut candidates = if in_window.is_empty() {
        short
    } else {
        in_window
    };
    candidates.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    for (_, boundary) in candidates {
        if let Some((mut left, right)) = split_sentence_at_word(words, sentence, boundary) {
            close_sentence(&mut left.corrected);
            return Some((left, right));
        }
    }
    None
}

/// punct-repair 轮次耗尽后的确定性兜底：反复切一刀直到每片都不再超长。
/// 切不动（LCS 投影不出任何切点）时原样返回，由调用方计入 `oversized_sentences`。
fn split_oversized_sentence(words: &[Word], sentence: &MappedSentence) -> Vec<MappedSentence> {
    let mut out: Vec<MappedSentence> = Vec::new();
    let mut current = sentence.clone();
    while oversized_span(words, &current).is_some() {
        let Some((left, right)) = split_once_deterministically(words, &current) else {
            break;
        };
        out.push(left);
        current = right;
    }
    out.push(current);
    out
}

/// 文件契约（`file-v1`）的 `task submit` 镜像 lint。
///
/// 校验**只有一份**：这里直接调用引擎内部同一个 [`lint_polish_page`]。agent 侧
/// 拿不到词流，所以只能跑「字符串就够」的那半边判据；需要真相的整页 LCS 比值、
/// 逐句相似度与单句跨度上限由引擎侧 validate 兜底（见
/// [`validate_polish_file_page`]）。
pub fn lint_agent_answer_file(payload: &str, answer: &str) -> Vec<String> {
    lint_polish_page(payload, answer)
        .problems
        .iter()
        .map(|problem| match &problem.scope {
            ProblemScope::Sentence { id } => {
                format!("[{}] {id}: {}", problem.code, problem.detail)
            }
            _ => format!("[{}] {}", problem.code, problem.detail),
        })
        .collect()
}

/// segment-repair 的 `task submit` 镜像 lint。
///
/// 与引擎共用 [`parse_segment_repair_page`] 这一份实现；该载体的判据
/// **全部**是字符串级（区间从 1 起、首尾相接、覆盖到末行 + 单区间是否
/// 盖住超限整块），所以 agent 侧就是完整校验，不存在引擎侧才能补的真相门。
/// 切出的组仍超限不在此拦——引擎按溢出幅度即时补切或下一轮定向再问。
pub fn lint_agent_answer_segment_repair(payload: &str, answer: &str) -> Vec<String> {
    parse_segment_repair_page(payload, answer)
        .diagnostics
        .problems
        .iter()
        .map(|problem| format!("[{}] {}", problem.code, problem.detail))
        .collect()
}

/// punct-repair 的 `task submit` 镜像 lint。
///
/// 与引擎共用 [`parse_punct_repair_page`] 这一份实现：逐句非标点原子恒等、
/// 至少新增一个句末标点、无冲突/悬空标点，全部是字符串级判据，agent 侧就是
/// 完整校验。切出的句能否映射回源词由引擎侧兜底（映射不回去只是"该句下一轮
/// 再来"，不是提交错误）。
pub fn lint_agent_answer_punct_repair(payload: &str, answer: &str) -> Vec<String> {
    parse_punct_repair_page(payload, answer)
        .diagnostics
        .problems
        .iter()
        .map(|problem| match &problem.scope {
            ProblemScope::Sentence { id } => {
                format!("[{}] {id}: {}", problem.code, problem.detail)
            }
            _ => format!("[{}] {}", problem.code, problem.detail),
        })
        .collect()
}

/// VoiceInk 的 AutoCorrect hook 位于 polish apply 与阶段盖戳之间。这里同样在
/// 最终 rebind 前格式化，确保词文本、段落钉和 polish fingerprint 都基于最终
/// CJK 排版。LLM 降级句也会经过规则格式化，但仍保留 fallback 诊断标记。
/// 用原文排版（[`AutocorrectOptions::source`]）：韩文句里的空白就是词界，不动。
fn autocorrect_mapped_sentences(words: &[Word], paragraphs: &mut [Vec<MappedSentence>]) {
    if !source_is_cjk(words) {
        return;
    }
    for sentence in paragraphs.iter_mut().flatten() {
        let current = if sentence.corrected.is_empty() {
            span_text(words, sentence.start, sentence.end)
        } else {
            sentence.corrected.clone()
        };
        let formatted = format_with_options(&current, AutocorrectOptions::source());
        if formatted != current {
            sentence.corrected = formatted;
        }
    }
}

/// 句级补做的候选理由（`polish-retry` json-v0 每项新增的 `reason` 字段）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RetryReasonKind {
    /// 相似度门没过：改写幅度越界，可能是幻觉，也可能是正确的术语还原。
    LowSimilarity,
    /// 表面级瑕疵：悬垂假句末 / 粘连 Latin 串（冲突标点已在载体层代码归一）。
    SurfaceArtifact,
}

impl RetryReasonKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::LowSimilarity => "low-similarity",
            Self::SurfaceArtifact => "surface-artifact",
        }
    }

    /// 回灌给模型的定向指令。
    ///
    /// `surface-artifact` 会按 `text` 实际命中的判据点名，而不是甩一句「悬垂
    /// 句末 或 粘连 Latin 串」的析取——模型收到析取只能猜，实测表现是原样退回
    /// 或只把句末 `.` 改成 `...`，两轮下来零真实修复。
    fn instruction(self, text: &str) -> String {
        match self {
            Self::LowSimilarity => {
                "the previous correction crossed the conservative similarity threshold — keep every spoken word and only fix recognition errors and punctuation"
                    .to_owned()
            }
            Self::SurfaceArtifact => {
                let mut defects: Vec<&str> = Vec::new();
                if crate::seam::contains_dangling_sentence_end(text) {
                    defects.push(
                        "a sentence ends on a dangling connector/preposition — join it with the sentence that completes the clause, or restore the spoken words that finish it; changing or appending final punctuation (including \"...\") does not fix this",
                    );
                }
                if crate::seam::contains_conflicting_punctuation(text) {
                    defects.push("two conflicting punctuation marks sit next to each other");
                }
                if is_cjk_text(text) && crate::seam::contains_likely_collapsed_latin_atom(text, 20) {
                    defects
                        .push("a run-together Latin phrase needs its spoken word boundaries restored");
                }
                if defects.is_empty() {
                    "the previous correction still contains a surface defect".to_owned()
                } else {
                    format!(
                        "the previous correction still contains a surface defect: {}",
                        defects.join("; ")
                    )
                }
            }
        }
    }
}

/// 两次改写之间是否**没有实质进展**：逐字相同，或只动了句末标点。
///
/// `surface-artifact` 类的补做实测就是这两种形态（一轮 4/6 逐字相同，一轮
/// 4/5 只把句末 `.` 换成 `...`）。两者都不可能让 [`has_surface_artifact`] 转
/// 阴，再问一轮纯粹是等待，所以命中即把该句从后续轮次里摘掉。
fn retry_made_no_progress(before: &str, after: &str) -> bool {
    if before == after {
        return true;
    }
    fn strip(text: &str) -> &str {
        text.trim_end_matches(|ch: char| {
            crate::seam::is_sentence_final_punct(ch) || ch.is_whitespace()
        })
    }
    strip(before) == strip(after)
}

/// 一句是否带表面级瑕疵（与 [`crate::filepipe::lint_polish_page`] 同判据）。
///
/// 冲突相邻标点在载体层已被
/// [`crate::seam::normalize_conflicting_punctuation`] 代码归一，正常路径上不会
/// 命中这一项；保留它是为了给绕过载体层的入口（`validated_retry_correction`
/// 的直接调用）留一道守卫。
fn has_surface_artifact(text: &str) -> bool {
    crate::seam::contains_dangling_sentence_end(text)
        || crate::seam::contains_conflicting_punctuation(text)
        || (is_cjk_text(text) && crate::seam::contains_likely_collapsed_latin_atom(text, 20))
}

/// 每份 `polish-retry` 载荷最多带几句（分页只按句数，载荷本身很小）。
const POLISH_RETRY_MAX_SENTENCES: usize = 40;

/// 句级补做波次（`kind = "polish-retry"`，json-v0 契约不变，每项新增 `reason`）。
///
/// 候选 = 相似度门没过的句 ∪ 带表面级瑕疵的句（重试策略重设计 §2.2）。按
/// [`crate::paging::balanced_page_sizes`] 分成每页 ≤
/// [`POLISH_RETRY_MAX_SENTENCES`] 句、逐句验收；败句第 2 轮带 `retry_reason`
/// 再问一次（[`RetryPolicy::UNIT_ROUNDS`] 轮）。耗尽收口分两种：
///
/// - `low-similarity` → 退回原词（`fallback = true`，同旧实现，计
///   `fallback_sentences`）；
/// - `surface-artifact` → **保留模型文本**并计
///   [`PolishOutcome::surface_artifact_sentences`]。这类句的字词本身是对的，
///   退回原词只会把一个表面瑕疵换成一整句未润色文本；`bcut check` 的
///   `polish-false-sentence-end` / `polish-surface-artifact` 警告继续兜底。
///
/// 轮内不做载体级重试——轮就是重试；可重试传输错误只是「本轮没拿到答案」；
/// Terminal/Cancelled 照常上抛。
fn low_similarity_retry(
    words: &[Word],
    paragraphs: &mut [Vec<MappedSentence>],
    llm: &mut dyn LlmJson,
    options: &PolishOptions,
    analysis: Option<&Analysis>,
    outcome: &mut PolishOutcome,
) -> Result<(), LlmError> {
    let system = retry_system_prompt(options);
    // 上一轮对某句的定向意见，按句首词下标寻址。
    let mut verdicts: BTreeMap<usize, String> = BTreeMap::new();
    // 已经问过的句：轮次耗尽后按理由收口。
    let mut seen: BTreeMap<usize, RetryReasonKind> = BTreeMap::new();
    // Confirmed local corrections may remain below the surface threshold.
    // Their accepted verdict must survive both re-queueing and finalization.
    let mut confirmed = std::collections::BTreeSet::new();
    // 上一轮答案与原文没有实质差别的句：这一类再问不会有别的结果，直接收口。
    let mut no_progress: std::collections::BTreeSet<usize> = std::collections::BTreeSet::new();
    for round in 1..=RetryPolicy::UNIT_ROUNDS {
        let mut targets: Vec<(usize, RetryReasonKind)> = Vec::new();
        for sentence in paragraphs.iter().flatten() {
            if sentence.fallback || sentence.corrected.is_empty() {
                continue;
            }
            if no_progress.contains(&sentence.start) || confirmed.contains(&sentence.start) {
                continue;
            }
            let original = span_text(words, sentence.start, sentence.end);
            let reason = if is_low_similarity(&original, &sentence.corrected, analysis) {
                RetryReasonKind::LowSimilarity
            } else if has_surface_artifact(&sentence.corrected) {
                RetryReasonKind::SurfaceArtifact
            } else {
                continue;
            };
            targets.push((sentence.start, reason));
        }
        if targets.is_empty() {
            break;
        }
        for (start, reason) in &targets {
            seen.insert(*start, *reason);
        }
        if round == 1 {
            outcome.low_similarity_retries += targets.len() as u32;
        }
        let sizes = crate::paging::balanced_page_sizes(
            &vec![1usize; targets.len()],
            POLISH_RETRY_MAX_SENTENCES,
        );
        let mut cursor = 0usize;
        let mut answers: std::collections::HashMap<usize, String> =
            std::collections::HashMap::new();
        for size in sizes {
            let batch = &targets[cursor..cursor + size];
            cursor += size;
            let index: BTreeMap<usize, &MappedSentence> = paragraphs
                .iter()
                .flatten()
                .map(|sentence| (sentence.start, sentence))
                .collect();
            let payload_sentences: Vec<serde_json::Value> = batch
                .iter()
                .filter_map(|(start, reason)| {
                    let sentence = index.get(start)?;
                    let before_start = sentence.start.saturating_sub(LOW_SIMILARITY_CONTEXT_WORDS);
                    let after_end =
                        (sentence.end + 1 + LOW_SIMILARITY_CONTEXT_WORDS).min(words.len());
                    Some(serde_json::json!({
                        "startWordIndex": sentence.start,
                        "reason": reason.as_str(),
                        "originalWords": span_text(words, sentence.start, sentence.end),
                        "previousAttempt": sentence.corrected,
                        "contextBefore": if before_start < sentence.start {
                            span_text(words, before_start, sentence.start - 1)
                        } else { String::new() },
                        "contextAfter": if sentence.end + 1 < after_end {
                            span_text(words, sentence.end + 1, after_end - 1)
                        } else { String::new() },
                    }))
                })
                .collect();
            if payload_sentences.is_empty() {
                continue;
            }
            let payload = serde_json::json!({
                "language": options.language,
                "sentences": payload_sentences,
            })
            .to_string();
            let notes: Vec<String> = batch
                .iter()
                .filter_map(|(start, reason)| {
                    verdicts
                        .get(start)
                        .cloned()
                        .or_else(|| {
                            let sentence = index.get(start)?;
                            (round > 1).then(|| reason.instruction(&sentence.corrected))
                        })
                        .map(|note| format!("startWordIndex {start}: {note}"))
                })
                .collect();
            let response = llm.complete(&LlmRequest {
                kind: "polish-retry",
                system: system.clone(),
                user: payload,
                temperature: 0.2,
                attempt: round,
                retry_reason: (!notes.is_empty()).then(|| notes.join("；")),
            });
            let parsed: Option<RetryResponse> = match response {
                Ok(raw) => decode(&raw).ok(),
                Err(error @ LlmError::Terminal(_)) | Err(error @ LlmError::Cancelled) => {
                    return Err(error);
                }
                // 可重试错误 ⇒ 该页各句本轮没有答案，进下一轮/确定性收口。
                Err(_) => None,
            };
            if let Some(parsed) = parsed {
                for sentence in parsed.sentences {
                    answers.insert(sentence.start_word_index, sentence.corrected_text);
                }
            }
        }
        verdicts.clear();
        for sentence in paragraphs.iter_mut().flatten() {
            let Some(&reason) = targets
                .iter()
                .find(|(start, _)| *start == sentence.start)
                .map(|(_, reason)| reason)
                .as_ref()
            else {
                continue;
            };
            let original = span_text(words, sentence.start, sentence.end);
            match answers.get(&sentence.start) {
                Some(retried) => {
                    let retried = sanitize_corrected(retried);
                    let retried = crate::seam::normalize_conflicting_punctuation(&retried);
                    match validated_retry_correction(
                        &original,
                        &sentence.corrected,
                        &retried,
                        analysis,
                    ) {
                        Some(validated) => {
                            if !has_surface_artifact(&validated) {
                                confirmed.insert(sentence.start);
                            }
                            if retry_made_no_progress(&sentence.corrected, &validated) {
                                no_progress.insert(sentence.start);
                            }
                            sentence.corrected = validated;
                        }
                        None => {
                            if retry_made_no_progress(&sentence.corrected, &retried) {
                                no_progress.insert(sentence.start);
                            }
                            verdicts.insert(
                                sentence.start,
                                format!(
                                    "[{}] {}",
                                    reason.as_str(),
                                    reason.instruction(&sentence.corrected)
                                ),
                            );
                        }
                    }
                }
                None => {
                    verdicts.insert(
                        sentence.start,
                        format!(
                            "[{}] {}",
                            reason.as_str(),
                            reason.instruction(&sentence.corrected)
                        ),
                    );
                }
            }
        }
    }
    // 轮次耗尽的确定性收口：low-similarity 退回原词，surface-artifact 保留模型文本。
    for sentence in paragraphs.iter_mut().flatten() {
        if sentence.fallback || sentence.corrected.is_empty() {
            continue;
        }
        let Some(&reason) = seen.get(&sentence.start) else {
            continue;
        };
        let original = span_text(words, sentence.start, sentence.end);
        if !confirmed.contains(&sentence.start)
            && is_low_similarity(&original, &sentence.corrected, analysis)
        {
            sentence.corrected = String::new();
            sentence.fallback = true;
            continue;
        }
        if reason == RetryReasonKind::SurfaceArtifact && has_surface_artifact(&sentence.corrected) {
            outcome.surface_artifact_sentences += 1;
        }
    }
    Ok(())
}

fn classify_suggestion(original: &str, corrected: &str, enabled: &BTreeSet<String>) -> String {
    if normalize_chars(original) == normalize_chars(corrected) && enabled.contains("punct") {
        return "punct".to_owned();
    }
    let non_punctuation = enabled
        .iter()
        .filter(|value| value.as_str() != "punct")
        .collect::<Vec<_>>();
    if non_punctuation.len() == 1 {
        return non_punctuation[0].clone();
    }
    let original_lower = original.to_lowercase();
    let corrected_lower = corrected.to_lowercase();
    if enabled.contains("term") && original_lower == corrected_lower && original != corrected {
        return "term".to_owned();
    }
    let shortened = corrected.chars().count() < original.chars().count();
    if enabled.contains("filler")
        && shortened
        && [" um ", " uh ", " you know ", " i mean ", " 呃 ", " 额 "]
            .iter()
            .any(|needle| format!(" {original_lower} ").contains(needle))
    {
        return "filler".to_owned();
    }
    if enabled.contains("wordy") && shortened {
        return "wordy".to_owned();
    }
    if enabled.contains("grammar") {
        return "grammar".to_owned();
    }
    if enabled.contains("term") {
        return "term".to_owned();
    }
    if enabled.contains("typo") {
        return "typo".to_owned();
    }
    enabled
        .iter()
        .next()
        .cloned()
        .unwrap_or_else(|| "typo".to_owned())
}

/// 把文本重绑定替换掉的版式键迁到时间上最接近的新词。
///
/// `breaks` 钉在词后，按 t1 迁移；`paraBreaks` 钉在词前，按 t0 迁移。
/// hidden 是词本身的语义，只在新旧词时间窗重叠时迁移，避免已删除的 filler
/// 把远处另一个词误隐藏。仍找不到目标的键交给 [`TranscriptDoc::prune_orphan_overrides`]。
pub(crate) fn rebase_orphan_layout_overrides(
    doc: &mut TranscriptDoc,
    previous_words: &[Word],
) -> usize {
    let current_ids: BTreeSet<String> = doc.words.iter().map(|word| word.id.clone()).collect();
    let previous_by_id: BTreeMap<&str, &Word> = previous_words
        .iter()
        .map(|word| (word.id.as_str(), word))
        .collect();
    let nearest = |old: &Word, after: bool, require_overlap: bool| {
        doc.words
            .iter()
            .filter(|word| {
                word.sp == old.sp && (!require_overlap || (word.t0 <= old.t1 && word.t1 >= old.t0))
            })
            .min_by(|left, right| {
                let old_edge = if after { old.t1 } else { old.t0 };
                let left_edge = if after { left.t1 } else { left.t0 };
                let right_edge = if after { right.t1 } else { right.t0 };
                (left_edge - old_edge)
                    .abs()
                    .total_cmp(&(right_edge - old_edge).abs())
                    .then_with(|| left.id.cmp(&right.id))
            })
            .map(|word| word.id.clone())
    };

    let break_moves = doc
        .breaks
        .iter()
        .filter(|(id, _)| !current_ids.contains(*id))
        .filter_map(|(id, value)| {
            previous_by_id
                .get(id.as_str())
                .and_then(|old| nearest(old, true, false))
                .map(|target| (id.clone(), target, *value))
        })
        .collect::<Vec<_>>();
    let para_moves = doc
        .para_breaks
        .iter()
        .filter(|(id, _)| !current_ids.contains(*id))
        .filter_map(|(id, value)| {
            previous_by_id
                .get(id.as_str())
                .and_then(|old| nearest(old, false, false))
                .map(|target| (id.clone(), target, *value))
        })
        .collect::<Vec<_>>();
    let hidden_moves = doc
        .hidden
        .iter()
        .filter(|(id, _)| !current_ids.contains(*id))
        .filter_map(|(id, value)| {
            previous_by_id
                .get(id.as_str())
                .and_then(|old| nearest(old, false, true))
                .map(|target| (id.clone(), target, *value))
        })
        .collect::<Vec<_>>();

    let moved = break_moves.len() + para_moves.len() + hidden_moves.len();
    for (old, target, value) in break_moves {
        doc.breaks.remove(&old);
        doc.breaks.entry(target).or_insert(value);
    }
    for (old, target, value) in para_moves {
        doc.para_breaks.remove(&old);
        doc.para_breaks.entry(target).or_insert(value);
    }
    for (old, target, value) in hidden_moves {
        doc.hidden.remove(&old);
        doc.hidden.entry(target).or_insert(value);
    }
    moved
}

#[allow(clippy::too_many_arguments)]
fn apply(
    doc: &mut TranscriptDoc,
    words: &[Word],
    paragraphs: Vec<Vec<MappedSentence>>,
    ids: &mut dyn IdSource,
    cue_max_chars: usize,
    enabled_checks: &BTreeSet<String>,
    stamp_segment: bool,
    outcome: &mut PolishOutcome,
) {
    let mut new_words: Vec<Word> = Vec::with_capacity(words.len());
    // 0.5 之前逐音节的韩文区间：重绑后按旧规则重定「贴前」标记。
    let mut legacy_spans: Vec<std::ops::Range<usize>> = Vec::new();
    let mut cursor = 0;
    let mut paragraph_first_ids: Vec<String> = Vec::new();

    for group in &paragraphs {
        let mut sentence_indices = Vec::with_capacity(group.len());
        let mut first_id_of_paragraph: Option<String> = None;
        for sentence in group {
            // 覆盖间隙(被跳过的句子留下的词)原样拷贝。
            while cursor < sentence.start {
                new_words.push(words[cursor].clone());
                cursor += 1;
            }
            let span = &words[sentence.start..=sentence.end];
            let original_text = join_word_texts(span.iter());
            let new_start = new_words.len();
            if sentence.corrected.is_empty() {
                new_words.extend_from_slice(span);
            } else {
                // 建议(CJK 边界空格差异是显示层 no-op,不产建议)。
                if collapse_cjk_spaces_like(span, &sentence.corrected)
                    != collapse_cjk_spaces_like(span, &original_text)
                {
                    let cat =
                        classify_suggestion(&original_text, &sentence.corrected, enabled_checks);
                    outcome.suggestions.push(Suggestion {
                        cat: cat.to_owned(),
                        find: original_text.clone(),
                        replace: sentence.corrected.clone(),
                        first_word_id: span[0].id.clone(),
                        last_word_id: span[span.len() - 1].id.clone(),
                    });
                }
                let rebound = rebind_corrected(span, &sentence.corrected, ids);
                if rebound.is_empty() {
                    new_words.extend_from_slice(span);
                } else {
                    if crate::rebind::is_legacy_span(span) {
                        legacy_spans.push(new_start..new_start + rebound.len());
                    }
                    new_words.extend(rebound);
                }
            }
            cursor = sentence.end + 1;
            let slice = &new_words[new_start..];
            if slice.is_empty() {
                continue;
            }
            if first_id_of_paragraph.is_none() {
                first_id_of_paragraph = Some(slice[0].id.clone());
            }
            sentence_indices.push(outcome.sentences.len());
            outcome.sentences.push(SentenceRecord {
                first_word_id: slice[0].id.clone(),
                last_word_id: slice[slice.len() - 1].id.clone(),
                t0: slice[0].t0,
                t1: slice[slice.len() - 1].t1,
                text: if sentence.corrected.is_empty() {
                    original_text
                } else {
                    sentence.corrected.clone()
                },
                fallback: sentence.fallback,
            });
            if sentence.fallback {
                outcome.fallback_sentences += 1;
            }
        }
        if !sentence_indices.is_empty() {
            outcome.paragraphs.push(sentence_indices);
            paragraph_first_ids
                .push(first_id_of_paragraph.expect("non-empty paragraph has first id"));
        }
    }
    while cursor < words.len() {
        new_words.push(words[cursor].clone());
        cursor += 1;
    }
    for range in legacy_spans {
        crate::rebind::reglue_legacy_span(&mut new_words, range, &doc.hidden);
    }
    doc.words = new_words;
    // rebind 在极窄原词窗内把一个词改成多个 token 时，每 token 的厘秒保底可能
    // 把新词推过右侧健康锚点。整篇统一修复会向相邻有余量的词窗扩张，避免一次
    // 合法文本修订在最终写盘时才因 t0 回退而原子失败。
    let timing_report = word_timing_repair(&mut doc.words);
    debug_assert!(
        timing_report.unrepairable.is_empty(),
        "polish produced unrepairable word timings: {:?}",
        timing_report.unrepairable
    );
    if !timing_report.repaired.is_empty() {
        let timings: BTreeMap<&str, (f64, f64)> = doc
            .words
            .iter()
            .map(|word| (word.id.as_str(), (word.t0, word.t1)))
            .collect();
        for sentence in &mut outcome.sentences {
            if let Some((t0, _)) = timings.get(sentence.first_word_id.as_str()) {
                sentence.t0 = *t0;
            }
            if let Some((_, t1)) = timings.get(sentence.last_word_id.as_str()) {
                sentence.t1 = *t1;
            }
        }
    }
    let rebased_overrides = rebase_orphan_layout_overrides(doc, words);
    let pruned_overrides = doc.prune_orphan_overrides();
    doc.stages.polish = Some(fingerprint(&doc.words));
    // 首次分段:从润色段落分组导出段落钉(一次 LLM 调用喂两个阶段)。
    // 分段退化时（`stamp_segment=false`）好页的段落钉照常落地，但阶段戳
    // 留白——`segment` 保持待办，专用分段流程会整体重分段。
    let mut layout_touched = rebased_overrides > 0 || pruned_overrides > 0;
    if doc.stages.segment.is_none() {
        for id in paragraph_first_ids.iter().skip(1) {
            doc.para_breaks.insert(id.clone(), true);
        }
        if stamp_segment {
            doc.stages.segment = Some(id_fingerprint(&doc.words));
        }
        layout_touched = true;
    }
    // 标点定稿后铺设均衡断点布局：优化器总是运行，用户钉集是硬约束，结果只进
    // `autoBreaks[layoutProfile]`。管线自身的版式改动刷新 asrLayout 戳（只算用户
    // breaks/paraBreaks/hidden），不能算作人工编辑。§18.5 参数取文档 profile 的
    // `source`（`--layout-profile`），`--cue-line-length` 只覆盖行宽。
    let cue_params = crate::cue::CueParams {
        max_chars: cue_max_chars,
        ..crate::layout_profile::cue_params_for_doc(doc)
    };
    if crate::layout::ensure_balanced_cue_layout(doc, &cue_params) {
        layout_touched = true;
    }
    if layout_touched {
        doc.stages.asr_layout = Some(crate::layout::layout_fingerprint(doc));
    }
    outcome.cue_layout = crate::layout::cue_layout_stats(doc, &cue_params);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::asr_rows::RowIn;
    use crate::build::build_doc;
    use crate::doc::{DocEngine, DocMedia};
    use crate::rebind::SeqIds;

    /// p-fb353b44 实测：`surface-artifact` 两轮补做产出 0 个真实修复——一轮
    /// 4/6 逐字相同，一轮 4/5 只把句末 `.` 换成 `...`。两种形态都判为无进展。
    #[test]
    fn punctuation_only_and_identical_retry_answers_count_as_no_progress() {
        assert!(retry_made_no_progress("but.", "but."));
        assert!(retry_made_no_progress("but.", "but..."));
        assert!(retry_made_no_progress("就是说当。", "就是说当…"));
        assert!(retry_made_no_progress("done!", "done?"));
        assert!(retry_made_no_progress("done.", "done. "));
        // 真的改了词就不是无进展。
        assert!(!retry_made_no_progress("but.", "but we moved on."));
        assert!(!retry_made_no_progress("就是说当。", "就是说当时。"));
    }

    /// `surface-artifact` 的指令必须点名实际命中的判据，而不是甩一句析取。
    #[test]
    fn surface_artifact_instruction_names_the_defect_it_found() {
        let dangling = RetryReasonKind::SurfaceArtifact.instruction("It's a good example of.");
        assert!(dangling.contains("dangling connector"), "{dangling}");
        assert!(!dangling.contains("run-together"), "{dangling}");
        let collapsed = RetryReasonKind::SurfaceArtifact
            .instruction("反 purereinforcementlearning，至少这样。");
        assert!(collapsed.contains("run-together"), "{collapsed}");
        assert!(!collapsed.contains("dangling connector"), "{collapsed}");
    }

    fn doc(text: &str) -> TranscriptDoc {
        build_doc(
            &[RowIn::new(0.0, 10.0, text)],
            DocMedia {
                id: None,
                path: None,
                hash: "sha256-00".to_owned(),
                duration: 100.0,
                sample_rate: None,
            },
            "en",
            DocEngine {
                name: "t".to_owned(),
                version: None,
                aligned_words: false,
            },
            None,
        )
    }

    /// p1222 基准的真实回归：术语屏蔽只认字面 `Vasuman Moza` 及其变体，
    /// 重试写回的短称 `Vasuman` 不在屏蔽表里，相似度掉到 0.538 被门挡下。
    /// 模型连着两轮给出同一答案且只改了一个词，词级尺应当放行。
    #[test]
    fn retry_confirming_one_word_term_fix_survives_the_similarity_gate() {
        let analysis = Analysis {
            terms: vec![crate::engines::brief::AnalysisTerm {
                term: "Vasuman Moza".to_owned(),
                note: None,
                observed_variants: vec!["Voss".to_owned(), "Foss".to_owned(), "Paul".to_owned()],
            }],
            ..Analysis::default()
        };
        // 门本身仍然判低相似——修的是重试确认路径，不是门的阈值。
        assert!(is_low_similarity(
            "Thanks, Foss.",
            "Thanks, Vasuman.",
            Some(&analysis)
        ));
        assert!(confirmed_local_correction(
            "Thanks, Foss.",
            "Thanks, Vasuman.",
            "Thanks, Vasuman."
        ));
    }

    #[test]
    fn retry_rejects_rewrites_that_are_not_local() {
        // 整句改写：词数增删超界。
        assert!(!confirmed_local_correction(
            "Thanks, Foss.",
            "The speaker thanks the audience for coming today.",
            "The speaker thanks the audience for coming today."
        ));
        // 同词数但几乎全改。
        assert!(!confirmed_local_correction(
            "Thanks, Foss.",
            "Goodbye, everyone.",
            "Goodbye, everyone."
        ));
        // 两轮答案不一致：不构成确认。
        assert!(!confirmed_local_correction(
            "Thanks, Foss.",
            "Thanks, Voss.",
            "Thanks, Vasuman."
        ));
    }

    /// 全量 polish 基准（c0065）里模型两轮都给出正确答案却被拒的 5 句：
    /// 中文短句里的人名/术语还原按原子尺是局部改动。
    #[test]
    fn retry_accepts_confirmed_cjk_name_restorations_by_atom_locality() {
        let confirmed = [
            (
                "谁也不能这个对呃移动它啊啊，然后让让说",
                "谁也不能这个，对呃，移动它啊啊，然后 Yann LeCun 说……",
            ),
            (
                "让说我作为一个科学家的正直，对吗？",
                "Yann LeCun 说，我作为一个科学家的正直，对吗？",
            ),
            (
                "呃呃有样在这确实不难对啊",
                "呃呃，有 Yann LeCun 在，这确实不难，对啊。",
            ),
            (
                "嗯，因为在老师的心中，亚元院是一个更好的选择。",
                "嗯，因为在老师的心中，MSRA 是一个更好的选择。",
            ),
        ];
        for (original, retried) in confirmed {
            assert!(
                confirmed_local_correction(original, retried, retried),
                "{original} → {retried}"
            );
            assert_eq!(
                validated_retry_correction(original, retried, retried, None),
                Some(retried.to_owned()),
                "{original}"
            );
        }
        // 上一轮丢词、重试还原：两轮答案不同，字符相似度又被长英文词吃掉，
        // 走"原子局部且无净删词"路径。
        for (original, previous, retried) in [
            ("reputation。嗯。", "嗯。", "representation。嗯。"),
            ("INFRACTOR. 对。", "对。", "infrastructure。对。"),
        ] {
            assert!(is_low_similarity(original, retried, None), "{original}");
            assert!(!confirmed_local_correction(original, previous, retried));
            assert!(local_atom_restoration(original, retried), "{original}");
            assert_eq!(
                validated_retry_correction(original, previous, retried, None),
                Some(retried.to_owned()),
                "{original}"
            );
        }
        // 还原路径不放行丢词或整句改写。
        assert!(!local_atom_restoration("reputation。嗯。", "嗯。"));
        assert!(!local_atom_restoration(
            "呃呃有样在这确实不难对啊",
            "有他在当然容易，对吧。"
        ));
        assert!(!local_atom_restoration(
            "Thanks, Foss.",
            "Goodbye, everyone."
        ));
        assert_eq!(
            validated_retry_correction(
                "呃呃有样在这确实不难对啊",
                "有他在当然容易，对吧。",
                "有他在当然容易，对吧。",
                None
            ),
            None
        );
    }

    #[test]
    fn retry_boundary_regression_keeps_the_locally_confirmed_page_correction() {
        let original = "就是说当。你的 group 数目越多，效果越明显。";
        let previous = "就是说当你的 group 数目越多，效果越明显。";
        let retried = "就是说当。你的 group 数目越多，效果越明显。";

        assert_eq!(
            validated_retry_correction(original, previous, retried, None),
            Some(previous.to_owned())
        );

        let punctuation_previous = "所以他说，呃，继续。";
        assert_eq!(
            validated_retry_correction(
                "所以他说。，呃，继续。",
                punctuation_previous,
                "所以他说。，呃，继续。",
                None,
            ),
            Some(punctuation_previous.to_owned())
        );

        let latin_previous = "我反对 pure reinforcement learning。";
        assert_eq!(
            validated_retry_correction(
                "我反对 purereinforcementlearning。",
                latin_previous,
                "我反对 purereinforcementlearning。",
                None,
            ),
            Some(latin_previous.to_owned())
        );
    }

    /// 生成 `count` 个短词的源文本（词形唯一，便于在 payload 里定位）。
    fn numbered_words(count: usize) -> String {
        (0..count)
            .map(|index| format!("w{index:03}"))
            .collect::<Vec<_>>()
            .join(" ")
    }

    #[test]
    fn split_sentence_text_respects_abbreviations_and_decimals() {
        assert_eq!(
            split_sentence_text("Dr. Smith spoke. Then we ate. Done."),
            vec!["Dr. Smith spoke.", "Then we ate.", "Done."]
        );
        assert_eq!(
            split_sentence_text("The rate is 2.14 percent overall."),
            vec!["The rate is 2.14 percent overall."]
        );
        assert_eq!(
            split_sentence_text("你好。这是第二句。"),
            vec!["你好。", "这是第二句。"]
        );
        // 没有内部句读:原样返回,交给跨度上限处理。
        assert_eq!(
            split_sentence_text("no terminal punctuation here"),
            vec!["no terminal punctuation here"]
        );
    }

    // ---- 文件契约（file-v1）路径 --------------------------------------------

    /// 假 provider 的一步：拿到渲染出的页文本，返回一份应答。
    type PolishStep = Box<dyn Fn(&str) -> Result<String, LlmError>>;

    /// 按顺序回放的假 provider：每一步拿到渲染出的页文本，返回一份应答。
    ///
    /// 走 [`LlmJson`] 的默认 `complete_batch_with`（逐个串行），因此
    /// [`complete_batch_retry_with`] 的整轮顺序是「本轮全部待办页，按页序」。
    struct PolishFileLlm {
        steps: std::collections::VecDeque<PolishStep>,
        calls: Vec<(String, String, Option<String>)>,
    }

    impl PolishFileLlm {
        fn new(steps: Vec<PolishStep>) -> Self {
            Self {
                steps: steps.into(),
                calls: Vec::new(),
            }
        }

        fn kinds(&self) -> Vec<&str> {
            self.calls
                .iter()
                .map(|(kind, _, _)| kind.as_str())
                .collect()
        }
    }

    impl LlmJson for PolishFileLlm {
        fn complete(&mut self, request: &LlmRequest) -> Result<String, LlmError> {
            self.calls.push((
                request.kind.to_owned(),
                request.user.clone(),
                request.retry_reason.clone(),
            ));
            match self.steps.pop_front() {
                Some(step) => step(&request.user),
                None => Err(LlmError::Terminal("script exhausted".to_owned())),
            }
        }
    }

    fn echo() -> PolishStep {
        Box::new(|input: &str| Ok(input.to_owned()))
    }

    fn constant(answer: &'static str) -> PolishStep {
        Box::new(move |_: &str| Ok(answer.to_owned()))
    }

    /// 把一页渲染文本的核心区换成 `core`，其余（栅栏与只读区）逐字保留。
    fn answer_with_core(input: &str, core: &str) -> String {
        let lines: Vec<&str> = input.lines().collect();
        let begin = lines
            .iter()
            .position(|line| *line == FENCE_EDIT_BEGIN)
            .expect("edit-begin");
        let end = lines
            .iter()
            .position(|line| *line == FENCE_EDIT_END)
            .expect("edit-end");
        let mut out: Vec<String> = lines[..=begin].iter().map(|l| (*l).to_owned()).collect();
        out.extend(core.lines().map(|l| l.to_owned()));
        out.extend(lines[end..].iter().map(|l| (*l).to_owned()));
        let mut text = out.join("\n");
        text.push('\n');
        text
    }

    fn core_of(input: &str) -> String {
        let lines: Vec<&str> = input.lines().collect();
        let begin = lines
            .iter()
            .position(|line| *line == FENCE_EDIT_BEGIN)
            .expect("edit-begin");
        let end = lines
            .iter()
            .position(|line| *line == FENCE_EDIT_END)
            .expect("edit-end");
        lines[begin + 1..end].join("\n")
    }

    fn rewrite_core(rewrite: impl Fn(&str) -> String + 'static) -> PolishStep {
        Box::new(move |input: &str| Ok(answer_with_core(input, &rewrite(&core_of(input)))))
    }

    /// 把核心区按每 20 句（`long_text` 口径 200 词）切一个段落边界，词流逐字
    /// 保留。分段质量门落地后，超过单段词数上限的页会被判分段退化，回显类
    /// 长页测试必须像真模型一样交出合法分段的答案。
    fn segment_core(core: &str) -> String {
        let mut out = String::new();
        for (index, chunk) in core.split_inclusive('.').enumerate() {
            if index > 0 {
                out.push_str(if index % 20 == 0 { "\n\n" } else { " " });
            }
            out.push_str(chunk.trim_start());
        }
        out
    }

    /// 逐字回显 + 合法分段（见 [`segment_core`]）。
    fn segmented_echo() -> PolishStep {
        rewrite_core(|core| segment_core(core))
    }

    /// 主润色测试关掉前置的 speaker-repair 与收尾的 speaker-names 两个波次：
    /// 这里的假 LLM 只认 polish 载荷，多说话人夹具的紧贴切换点会被前者当候选
    /// 发出去，占位说话人名会让后者发一次实名推断调用。两波各有自己的测试
    /// （[`crate::engines::speaker_repair`] / [`crate::engines::speaker_names`]）。
    fn file_options() -> PolishOptions {
        PolishOptions {
            speaker_repair: false,
            speaker_names: false,
            ..PolishOptions::default()
        }
    }

    /// 每 10 词一个句末标点的合成词流（避免单句跨度上限误伤长页测试）。
    fn long_text(words: usize) -> String {
        let mut text = String::new();
        for index in 0..words {
            if index > 0 {
                text.push(' ');
            }
            text.push_str(&format!("word{index}"));
            if (index + 1) % 10 == 0 {
                text.push('.');
            }
        }
        text
    }

    #[test]
    fn polish_joins_the_file_contract_whitelist_but_polish_retry_does_not() {
        assert!(crate::filepipe::uses_file_contract("polish"));
        assert!(!crate::filepipe::uses_file_contract("polish-retry"));
        assert_eq!(PolishOptions::default().worker_slots, None);
    }

    #[test]
    fn terminal_error_aborts_the_run() {
        let mut doc = doc("hello world");
        let mut llm = PolishFileLlm::new(vec![Box::new(|_: &str| {
            Err(LlmError::Terminal("401".to_owned()))
        })]);
        let mut ids = SeqIds::default();
        let result = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        );
        assert!(matches!(result, Err(LlmError::Terminal(_))));
        assert!(doc.stages.polish.is_none());
    }

    #[test]
    fn cjk_polish_runs_autocorrect_before_stamping() {
        let mut doc = doc("你好,这是ios应用.");
        doc.lang = "zh".to_owned();
        let mut llm = PolishFileLlm::new(vec![echo()]);
        let mut ids = SeqIds::default();
        let mut options = file_options();
        options.language = "zh".to_owned();

        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &options,
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        let text = join_word_texts(doc.words.iter());
        assert_eq!(text, "你好，这是 iOS 应用。");
        assert_eq!(outcome.sentences[0].text, text);
        assert_eq!(doc.stages.polish, Some(fingerprint(&doc.words)));
        assert_eq!(crate::autocorrect::format(&text), text);
    }

    #[test]
    fn cjk_polish_respects_disabled_autocorrect() {
        let mut doc = doc("你好,这是ios应用.");
        doc.lang = "zh".to_owned();
        let mut llm = PolishFileLlm::new(vec![echo()]);
        let mut ids = SeqIds::default();
        let mut options = file_options();
        options.language = "zh".to_owned();
        options.autocorrect = false;

        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &options,
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        let text = join_word_texts(doc.words.iter());
        // The word mapper still emits canonical atom boundaries; disabling
        // AutoCorrect specifically preserves ASCII punctuation and casing.
        assert_eq!(text, "你好, 这是 ios 应用.");
        assert_eq!(outcome.sentences[0].text, text);
    }

    /// 韩文按空格分词，一个词里常有数字或拉丁字母。排版不得往词里塞空格，
    /// 也不得把引号两侧的词并成一个：润色前后词表逐词相同。
    #[test]
    fn korean_polish_autocorrect_keeps_words_whole() {
        let source = "오늘은 2박 3일 일정에 600원이라는 AI가 “좋아” 하고 말했어요.";
        let mut doc = doc(source);
        doc.lang = "ko".to_owned();
        let before: Vec<String> = doc.words.iter().map(|word| word.text.clone()).collect();
        assert_eq!(before.len(), source.split(' ').count());
        let mut llm = PolishFileLlm::new(vec![echo()]);
        let mut ids = SeqIds::default();
        let mut options = file_options();
        options.language = "ko".to_owned();

        run_polish_file_contract(
            &mut doc,
            &mut llm,
            &options,
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        let after: Vec<String> = doc.words.iter().map(|word| word.text.clone()).collect();
        assert_eq!(after, before);
        assert_eq!(join_word_texts(doc.words.iter()), source);
    }

    #[test]
    fn file_contract_page_round_trips_end_to_end() {
        let mut doc = doc("hello world this is a test we are done now");
        let mut llm = PolishFileLlm::new(vec![rewrite_core(|core| {
            assert!(core.contains("hello world"));
            "Hello world, this is a test.\n\nWe are done now.".to_owned()
        })]);
        let mut ids = SeqIds::default();
        let mut attempts: Vec<(String, u32, bool, usize)> = Vec::new();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |attempt| {
                attempts.push((
                    attempt.page_id.to_owned(),
                    attempt.attempt,
                    attempt.accepted,
                    attempt.problems.len(),
                ));
            },
        )
        .unwrap();
        assert_eq!(llm.kinds(), vec!["polish"]);
        assert_eq!(attempts, vec![("p001".to_owned(), 1, true, 0)]);
        assert_eq!(outcome.fallback_pages, 0);
        assert_eq!(outcome.fallback_sentences, 0);
        assert_eq!(outcome.sentences.len(), 2);
        // 空行 → 段落边界（裁决4）。
        assert_eq!(outcome.paragraphs.len(), 2);
        assert!(!outcome.suggestions.is_empty());
        assert!(doc.stages.polish.is_some());
        assert!(doc.stages.segment.is_some());
        assert_eq!(doc.para_breaks.len(), 1);
        assert!(outcome.cue_layout.cues > 0);
        doc.validate().unwrap();
    }

    #[test]
    fn broken_fences_are_rejected_then_accepted_on_retry() {
        let mut doc = doc("hello world this is a test we are done now");
        let mut llm = PolishFileLlm::new(vec![constant("Sure! Here you go: hello world."), echo()]);
        let mut ids = SeqIds::default();
        let mut attempts: Vec<(u32, bool, Vec<ProblemCode>)> = Vec::new();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |attempt| {
                attempts.push((
                    attempt.attempt,
                    attempt.accepted,
                    attempt.problems.iter().map(|p| p.code).collect(),
                ));
            },
        )
        .unwrap();
        assert_eq!(attempts.len(), 2);
        assert_eq!(attempts[0].0, 1);
        assert!(!attempts[0].1);
        assert!(attempts[0].2.contains(&ProblemCode::DocumentTruncated));
        assert_eq!(attempts[1], (2, true, Vec::new()));
        // 不变式：被拒尝试必带至少一条 §10 问题。
        assert!(
            attempts
                .iter()
                .all(|(_, accepted, problems)| *accepted || !problems.is_empty())
        );
        // 语义校验失败才注入 retry_reason。
        assert!(llm.calls[0].2.is_none());
        assert!(llm.calls[1].2.is_some());
        assert_eq!(outcome.fallback_pages, 0);
        doc.validate().unwrap();
    }

    #[test]
    /// §2.2：只读上下文区被整段改写**不再拒页**——只读区从不写回真相，本页
    /// 正文照常接受，因此不产生任何重试调用。
    fn readonly_context_drift_no_longer_rejects_the_page() {
        let mut doc = doc(&long_text(900));
        let options = PolishOptions {
            worker_slots: Some(2),
            ..file_options()
        };
        // 第二页把只读上文整段换掉（远低于 READONLY_DRIFT_MIN_SIMILARITY），
        // 核心区照常合法分段回显。
        let mut llm = PolishFileLlm::new(vec![
            segmented_echo(),
            Box::new(|input: &str| {
                let answer = answer_with_core(input, &segment_core(&core_of(input)));
                let lines: Vec<&str> = answer.lines().collect();
                let before = lines
                    .iter()
                    .position(|line| *line == FENCE_CONTEXT_BEFORE)
                    .expect("context-before");
                let begin = lines
                    .iter()
                    .position(|line| *line == FENCE_EDIT_BEGIN)
                    .expect("edit-begin");
                let mut out: Vec<String> =
                    lines[..=before].iter().map(|l| (*l).to_owned()).collect();
                out.push("totally different context sentence written by the model.".to_owned());
                out.extend(lines[begin..].iter().map(|l| (*l).to_owned()));
                let mut text = out.join("\n");
                text.push('\n');
                Ok(text)
            }),
            // 页缝判定：原样回显 ⇒ 页缝合并。
            echo(),
        ]);
        let mut ids = SeqIds::default();
        let mut codes: Vec<ProblemCode> = Vec::new();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &options,
            &mut ids,
            &mut |_| {},
            &mut |attempt| codes.extend(attempt.problems.iter().map(|p| p.code)),
        )
        .unwrap();
        assert_eq!(
            llm.calls.len(),
            3,
            "两页各一次 + 页缝判定一份载荷，没有重试"
        );
        assert_eq!(llm.calls[2].0, "seam-repair");
        assert!(!codes.contains(&ProblemCode::SourceDrift), "{codes:?}");
        assert_eq!(outcome.fallback_pages, 0);
        doc.validate().unwrap();
    }

    #[test]
    fn speaker_change_forces_a_paragraph_break_even_when_the_model_merges_both_sides() {
        let mut doc = doc("alpha bravo charlie delta echo foxtrot golf hotel");
        doc.speakers.insert(
            "s2".to_owned(),
            crate::doc::Speaker {
                name: "S2".to_owned(),
                hue: None,
            },
        );
        for word in doc.words.iter_mut().skip(4) {
            word.sp = "s2".to_owned();
        }
        assert!(
            doc.stages.segment.is_none(),
            "fixture 必须未分段，否则断言落空"
        );
        // 模型把 ⏹ 两侧并成一个段落里的一句，且改动了文字（非逐字保真路径）。
        let mut llm = PolishFileLlm::new(vec![rewrite_core(|_| {
            "Alpha bravo charlee delta echo foxtrot golf hotel.".to_owned()
        })]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(outcome.paragraphs.len(), 2, "⏹ 必须切出两个段落");
        assert_eq!(outcome.sentences.len(), 2);
        assert!(outcome.sentences[1].text.starts_with("echo"));
        assert_eq!(
            outcome.forced_boundary_snapped, 0,
            "应走精确切分而不是吸附退化"
        );
        assert_eq!(doc.para_breaks.len(), 1);
        doc.validate().unwrap();
    }

    /// 带说话人标签的软标记只属于 payload：模型抄回来也进不了 `words`。
    #[test]
    fn labelled_speaker_marker_reaches_the_payload_but_never_the_words() {
        let mut doc = doc("alpha bravo charlie delta echo foxtrot golf hotel");
        doc.speakers.insert(
            "s2".to_owned(),
            crate::doc::Speaker {
                name: "S2".to_owned(),
                hue: None,
            },
        );
        for word in doc.words.iter_mut().skip(4) {
            word.sp = "s2".to_owned();
        }
        let mut llm = PolishFileLlm::new(vec![Box::new(|input: &str| {
            assert!(
                input.contains("delta ⏹S2"),
                "payload 缺少带标签软标记: {input}"
            );
            // 模型把带标签的软标记抄进可编辑区。
            Ok(answer_with_core(
                input,
                "Alpha bravo charlie delta. ⏹S2\n\nEcho foxtrot golf hotel.",
            ))
        })]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        let text = join_word_texts(doc.words.iter());
        assert!(
            !text.contains('⏹') && !text.contains("S2"),
            "软标记或标签泄漏进词流: {text}"
        );
        assert!(
            outcome
                .sentences
                .iter()
                .all(|sentence| !sentence.text.contains("S2")),
            "标签泄漏进句记录: {:?}",
            outcome.sentences
        );
        assert_eq!(outcome.paragraphs.len(), 2, "⏹ 仍切出两个段落");
        doc.validate().unwrap();
    }

    #[test]
    fn low_similarity_sentence_triggers_the_json_retry_from_the_file_path() {
        let mut doc = doc(
            "one two three four. five six seven eight. nine ten eleven twelve. thirteen fourteen fifteen sixteen.",
        );
        let mut llm = PolishFileLlm::new(vec![
            rewrite_core(|_| {
                "one two three four. five six seven eight. nine ten eleven twelve. Completely alternative phrasing overall.".to_owned()
            }),
            constant(
                r#"{"sentences":[{"startWordIndex":12,"correctedText":"Thirteen fourteen fifteen sixteen."}]}"#,
            ),
        ]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        // 单句重试仍走 json-v0 的 polish-retry（裁决5）。
        assert_eq!(llm.kinds(), vec!["polish", "polish-retry"]);
        assert_eq!(outcome.low_similarity_retries, 1);
        assert_eq!(outcome.fallback_pages, 0);
        assert_eq!(outcome.fallback_sentences, 0);
        doc.validate().unwrap();
    }

    #[test]
    fn confirmed_short_name_correction_survives_the_whole_retry_wave() {
        let mut doc = doc("one two three four. five six seven eight. Thanks, Foss.");
        let mut llm = PolishFileLlm::new(vec![
            rewrite_core(|_| {
                "one two three four. five six seven eight. Thanks, Vasuman.".to_owned()
            }),
            constant(r#"{"sentences":[{"startWordIndex":8,"correctedText":"Thanks, Vasuman."}]}"#),
        ]);
        assert!(is_low_similarity("Thanks, Foss.", "Thanks, Vasuman.", None));
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut SeqIds::default(),
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.kinds(), vec!["polish", "polish-retry"]);
        assert_eq!(outcome.fallback_sentences, 0);
        assert!(join_word_texts(doc.words.iter()).contains("Vasuman"));
        doc.validate().unwrap();
    }

    /// §2.2 句级补做波次：低相似度句两轮都没救回来 ⇒ 退回原词；波次是有界的
    /// （[`RetryPolicy::UNIT_ROUNDS`] 轮），不再是"一次调用无重试"。
    #[test]
    fn low_similarity_wave_runs_two_rounds_before_falling_back_to_the_source() {
        let mut doc = doc(
            "one two three four. five six seven eight. nine ten eleven twelve. thirteen fourteen fifteen sixteen.",
        );
        let mut llm = PolishFileLlm::new(vec![
            rewrite_core(|_| {
                "one two three four. five six seven eight. nine ten eleven twelve. Completely alternative phrasing overall.".to_owned()
            }),
            // 两轮都交回同一个越界改写 ⇒ 两轮都不通过。
            constant(
                r#"{"sentences":[{"startWordIndex":12,"correctedText":"Yet another entirely different sentence."}]}"#,
            ),
            constant(
                r#"{"sentences":[{"startWordIndex":12,"correctedText":"Yet another entirely different sentence."}]}"#,
            ),
        ]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.kinds(), vec!["polish", "polish-retry", "polish-retry"]);
        // 第二轮带定向意见（`reason` 的 instruction）。
        assert!(
            llm.calls[2]
                .2
                .as_deref()
                .is_some_and(|reason| reason.contains("startWordIndex 12")),
            "{:?}",
            llm.calls[2].2
        );
        // 载荷逐项带 `reason`（json-v0 契约的新字段）。
        assert!(llm.calls[1].1.contains("\"reason\":\"low-similarity\""));
        assert_eq!(outcome.low_similarity_retries, 1);
        assert_eq!(outcome.fallback_sentences, 1);
        assert_eq!(outcome.surface_artifact_sentences, 0);
        doc.validate().unwrap();
    }

    /// §2.2 收口分流：`surface-artifact` 句耗尽后**保留模型文本**（字词本身
    /// 是对的，退回原词只会把一个表面瑕疵换成一整句未润色文本），只计数。
    #[test]
    fn surface_artifact_sentences_keep_the_model_text_after_the_wave() {
        let mut doc = doc("就是说当 你的 group 数目 越多 效果 越明显");
        let mut llm = PolishFileLlm::new(vec![
            // 主波次交回一个悬垂假句末：载体层只记 warning，正文照常接受。
            rewrite_core(|_| "就是说当。你的 group 数目越多效果越明显。".to_owned()),
            // 两轮补做都没修掉那个假句末。
            constant(r#"{"sentences":[]}"#),
            constant(r#"{"sentences":[]}"#),
        ]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert!(llm.calls[1].1.contains("\"reason\":\"surface-artifact\""));
        assert_eq!(outcome.fallback_pages, 0);
        assert_eq!(outcome.surface_artifact_sentences, 1);
        // 关键：模型文本被保留，没有整句退回原词。
        assert!(
            outcome.sentences.iter().all(|sentence| !sentence.fallback),
            "{:?}",
            outcome.sentences
        );
        doc.validate().unwrap();
    }

    /// R3 阶梯：整页 [`RetryPolicy::MAX_PAGE_ATTEMPTS`] 次 → 对半缩窄各 1 次 →
    /// 仍失败的**半页**才走原词兜底。总调用量与旧的 3 次整页重试同量级，兜底
    /// 粒度减半。
    #[test]
    fn page_fatal_ladder_splits_before_falling_back_to_the_source() {
        let mut doc = doc("one two three four five six seven eight nine ten");
        let garbage =
            || rewrite_core(|_| "completely unrelated words entirely different content".to_owned());
        let mut llm = PolishFileLlm::new(vec![
            garbage(),
            garbage(),
            garbage(),
            garbage(),
            garbage(),
            garbage(),
        ]);
        let mut ids = SeqIds::default();
        let before = doc.words.clone();
        let mut page_ids: Vec<String> = Vec::new();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |attempt| {
                if !attempt.accepted {
                    assert!(!attempt.problems.is_empty());
                    page_ids.push(attempt.page_id.to_owned());
                }
            },
        )
        .unwrap();
        assert_eq!(
            page_ids[..2],
            ["p001".to_owned(), "p001".to_owned()],
            "先整页两次"
        );
        assert!(
            page_ids[2..].iter().all(|id| id.starts_with("p001-h")),
            "之后只重试半页：{page_ids:?}"
        );
        assert_eq!(outcome.split_retry_pages, (page_ids.len() - 2) as u32);
        assert_eq!(outcome.fallback_pages, outcome.split_retry_pages);
        // 与 json-v0 口径一致：兜底半页的句子同样计入 fallback_sentences。
        assert!(outcome.fallback_sentences > 0);
        assert!(outcome.sentences.iter().all(|s| s.fallback));
        assert_eq!(doc.words, before, "兜底保留原词");
        assert!(doc.stages.polish.is_some());
        doc.validate().unwrap();
    }

    /// 缩窄之后至少半页救回来时，只有失败的那一半兜底。
    #[test]
    fn split_retry_saves_the_half_that_the_model_can_handle() {
        let mut doc = doc(&long_text(600));
        let garbage =
            || rewrite_core(|_| "completely unrelated words entirely different content".to_owned());
        let mut llm = PolishFileLlm::new(vec![
            garbage(),
            garbage(),
            // 第一半页正常回显，第二半页继续答非所问。
            segmented_echo(),
            garbage(),
            // 页缝判定载荷（半页拼回来之后仍是同一页，不产生页缝候选）。
            echo(),
        ]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(outcome.split_retry_pages, 2);
        assert_eq!(outcome.fallback_pages, 1, "只有失败的那半页兜底");
        assert!(
            outcome.sentences.iter().any(|s| !s.fallback),
            "救回来的那一半不是降级句"
        );
        doc.validate().unwrap();
    }

    #[test]
    fn multi_page_run_keeps_each_page_to_its_own_words() {
        let mut doc = doc(&long_text(1500));
        let options = PolishOptions {
            worker_slots: Some(3),
            ..file_options()
        };
        let before = doc.words.clone();
        let mut llm = PolishFileLlm::new(vec![
            segmented_echo(),
            segmented_echo(),
            segmented_echo(),
            // 两个页缝凑成一份 seam-repair 载荷：原样回显 ⇒ 两个页缝都合并。
            echo(),
        ]);
        let mut ids = SeqIds::default();
        let mut pages: Vec<String> = Vec::new();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &options,
            &mut ids,
            &mut |_| {},
            &mut |attempt| pages.push(attempt.page_id.to_owned()),
        )
        .unwrap();
        assert_eq!(pages, vec!["p001", "p002", "p003", "sm1-001"]);
        assert_eq!(outcome.seam_merged_paragraphs, 2);
        assert_eq!(outcome.seam_kept_paragraphs, 0);
        // 页与页之间没有串味：核心区互不包含对方的词。
        let cores: Vec<String> = llm
            .calls
            .iter()
            .filter(|(kind, _, _)| kind == "polish")
            .map(|(_, user, _)| core_of(user))
            .collect();
        assert!(cores[0].contains("word0 ") && !cores[0].contains("word1400"));
        assert!(cores[2].contains("word1400") && !cores[2].contains(" word0 "));
        assert_eq!(outcome.fallback_pages, 0);
        // 逐字回显 ⇒ 词流不变。
        assert_eq!(doc.words, before);
        doc.validate().unwrap();
    }

    #[test]
    fn worker_slots_lower_the_page_budget_until_the_wave_is_full() {
        let doc = doc(&long_text(2000));
        let scopes = vec![0..doc.words.len()];
        // 预算是上限：默认 2200 词 ⇒ 2000 词只排 1 页。
        assert_eq!(
            plan_polish_file_pages(&doc.words, &scopes, Some(1)).len(),
            1
        );
        // 槽数未知与「1 个槽」同义：都不做波次对齐。
        assert_eq!(plan_polish_file_pages(&doc.words, &scopes, None).len(), 1);
        // 不限并发（`usize::MAX`）同样退回按预算走，不会被 div_ceil 切碎。
        assert_eq!(
            plan_polish_file_pages(&doc.words, &scopes, Some(usize::MAX)).len(),
            1
        );
        // 槽位波次对齐：4 个槽 ⇒ 重排成 4 页。
        assert_eq!(
            plan_polish_file_pages(&doc.words, &scopes, Some(4)).len(),
            4
        );
        // 下限守卫：槽多到每页不足 400 词就不再切细。
        assert_eq!(
            plan_polish_file_pages(&doc.words, &scopes, Some(16)).len(),
            1
        );
    }

    /// 分页器与回贴校验器同一把尺：默认预算下最坏一页（预算 + 10% slack，
    /// 再吃满 15% 溢出）也必须远在 atom-LCS 容量之内；中文一字一原子，
    /// 一页 CJK 与一页 Latin 的原子数在这把尺下一致，不再有语言差。
    #[test]
    fn default_page_budget_stays_well_inside_the_validator_capacity() {
        let budget = PolishBudget::default();
        let worst_page = (budget.core_words + crate::paging::page_slack(budget.core_words)) as f64
            * (1.0 + budget.overflow_ratio);
        let capacity = polish_page_atom_capacity();
        assert!(capacity >= 7_000, "capacity {capacity}");
        assert!(
            (worst_page as usize) * 2 <= capacity,
            "worst page {worst_page} atoms must leave ≥2× headroom under {capacity}"
        );

        // 1.0.9 事故形状：13506 个 CJK 原子。现在按 2200 词分页 ⇒ 6 页左右，
        // 每页都在容量之内，且实际用 CJK 文本走一遍 check_page_capacity。
        let text: String = (0..13_506)
            .map(|index| {
                let ch = char::from_u32(0x4E00 + (index % 2000) as u32).unwrap();
                if index % 17 == 16 {
                    format!("{ch}。")
                } else {
                    ch.to_string()
                }
            })
            .collect();
        let doc = doc(&text);
        let plans = plan_polish_file_pages(&doc.words, &[0..doc.words.len()], None);
        assert!(plans.len() >= 5, "pages {}", plans.len());
        for plan in &plans {
            let atoms: usize = doc.words[plan.core.clone()]
                .iter()
                .map(|word| word_count(&word.text))
                .sum();
            assert!(atoms <= capacity, "{} has {atoms} atoms", plan.id);
        }
        check_page_capacity(&doc.words, &plans).unwrap();
    }

    /// 分页器失配（一页原子数超过校验器容量）在调 LLM 之前就终止，错误明确
    /// 写出页号与原子数，而不是把结构上不可能通过的页发出去重试 3 次。
    #[test]
    fn oversized_page_is_rejected_before_any_llm_call() {
        let capacity = polish_page_atom_capacity();
        let doc = doc(&long_text(capacity + 1));
        let plans = vec![PolishPagePlan {
            id: "p001".to_owned(),
            before: 0..0,
            core: 0..doc.words.len(),
            after: doc.words.len()..doc.words.len(),
            hard_cut_start: false,
            hard_cut_end: false,
            para_starts: Vec::new(),
        }];
        let error = check_page_capacity(&doc.words, &plans).unwrap_err();
        assert!(!error.is_retryable(), "{error}");
        let message = error.to_string();
        assert!(message.contains("polish page p001 too large"), "{message}");
        assert!(
            message.contains(&format!("{} source atoms", capacity + 1)),
            "{message}"
        );
        assert!(message.contains(&format!("({capacity})")), "{message}");
    }

    /// `--paragraphs` 传入的相邻/重叠段落区间合并成一个 scope 后再分页：
    /// 一个 2000 词的兜底页拆成 20 个连续段落定向重润，应当仍是 1 页而不是
    /// 20 个单段小页；不相邻的区间保持独立。
    #[test]
    fn adjacent_scope_ranges_are_coalesced_before_paging() {
        let doc = doc(&long_text(2000));
        let ranges: Vec<Range<usize>> = (0..20).rev().map(|i| i * 100..(i + 1) * 100).collect();
        let options = PolishOptions {
            scope_ranges: ranges,
            ..PolishOptions::default()
        };
        assert_eq!(resolve_scopes(&doc.words, &options), vec![0..2000]);
        let plans = plan_polish_file_pages(&doc.words, &[0..2000], None);
        assert_eq!(plans.len(), 1);

        let options = PolishOptions {
            scope_ranges: vec![500..600, 100..250, 0..100, 240..300, 5000..6000],
            ..PolishOptions::default()
        };
        assert_eq!(resolve_scopes(&doc.words, &options), vec![0..300, 500..600]);
    }

    #[test]
    fn agent_lint_and_engine_validate_agree_on_the_same_bad_answer() {
        let words = doc("hello world this is a test we are done now").words;
        let plan = plan_polish_file_pages(&words, &[0..words.len()], None)
            .pop()
            .expect("one page");
        let input = render_polish_page(&words, &plan).text;

        // 好答案：两边都放行。
        assert!(lint_agent_answer_file(&input, &input).is_empty());
        let clean = parse_polish_page(&words, &plan, &input, &input);
        assert!(clean.diagnostics.problems.is_empty());

        // 坏答案：栅栏被吃掉。
        let broken = "Sure! Here you go: hello world.";
        let agent = lint_agent_answer_file(&input, broken);
        assert_eq!(agent.len(), 1);
        assert!(agent[0].starts_with("[document-truncated]"));
        let engine = parse_polish_page(&words, &plan, &input, broken);
        assert_eq!(
            engine.diagnostics.codes(),
            vec![ProblemCode::DocumentTruncated]
        );
        // 引擎侧的作用域是页，agent 侧是文档——判据同源，只是定位粒度不同。
        assert!(matches!(
            engine.diagnostics.problems[0].scope,
            ProblemScope::Page { .. }
        ));

        // 核心区被清空：两侧同样判 §10 的空核心，而不是各判各的。
        let emptied = answer_with_core(&input, "");
        let agent_empty = lint_agent_answer_file(&input, &emptied);
        let engine_empty = parse_polish_page(&words, &plan, &input, &emptied);
        assert_eq!(agent_empty.len(), engine_empty.diagnostics.problems.len());
        assert!(!agent_empty.is_empty());
    }

    #[test]
    fn file_path_never_overwrites_an_existing_segmentation_or_manual_layout() {
        let mut doc = doc("hello world this is a test we are done now");
        // 已分段 + 已有人工版式钉。
        doc.stages.segment = Some("seg-fp".to_owned());
        let pinned = doc.words[3].id.clone();
        doc.para_breaks.insert(pinned.clone(), true);
        doc.breaks
            .insert(doc.words[5].id.clone(), crate::doc::BreakOverride::Break);
        let mut llm = PolishFileLlm::new(vec![rewrite_core(|_| {
            "Hello world, this is a test.\n\nWe are done now.".to_owned()
        })]);
        let mut ids = SeqIds::default();
        run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(doc.stages.segment.as_deref(), Some("seg-fp"));
        assert_eq!(doc.para_breaks.len(), 1);
        assert!(doc.para_breaks.contains_key(&pinned));
        // 改词替换了原 id 时，人工 break 迁到同一时间位置的新词，而不是丢失后
        // 被自动布局覆盖。
        assert_eq!(doc.breaks.len(), 1);
        let (break_id, value) = doc.breaks.iter().next().unwrap();
        assert_eq!(*value, crate::doc::BreakOverride::Break);
        assert_eq!(
            doc.words
                .iter()
                .find(|word| &word.id == break_id)
                .map(|word| word.text.as_str()),
            Some("test.")
        );
        doc.validate().unwrap();
    }

    /// 剥掉 punct-repair 载荷里的 ⏸ 提示，把每个条目正文交给 `repunct` 改写，
    /// 栅栏行与空行原样保留。
    fn punct_repair_answer(repunct: impl Fn(&str) -> String + 'static) -> PolishStep {
        Box::new(move |input: &str| {
            let out: Vec<String> = input
                .lines()
                .map(|line| {
                    let trimmed = line.trim();
                    if trimmed.starts_with(FENCE_SENTENCE_BEGIN_PREFIX)
                        || trimmed.starts_with(FENCE_SENTENCE_END_PREFIX)
                        || trimmed.is_empty()
                    {
                        line.to_owned()
                    } else {
                        repunct(&crate::engines::markers::strip_markers(line))
                    }
                })
                .collect();
            Ok(out.join("\n"))
        })
    }

    /// 每 `every` 个空白分隔词补一个句号（只加标点，词逐字保留）。
    fn period_every_words(every: usize) -> impl Fn(&str) -> String {
        move |body: &str| {
            let words: Vec<&str> = body.split_whitespace().collect();
            words
                .chunks(every)
                .map(|chunk| format!("{}.", chunk.join(" ")))
                .collect::<Vec<_>>()
                .join(" ")
        }
    }

    /// 超长单句**不再拒页**：无句读的整页回显首轮即接受（不进 fallback），
    /// 超长句转交 punct-repair 波次；模型 [`PUNCT_REPAIR_MAX_ROUNDS`] 轮都
    /// 原样复述（一个句末标点都不加）⇒ 逐轮被 SentenceOversize 拒收、第二轮
    /// 起携带逐句定向指令，轮次耗尽后由引擎按长度兜底确定性切开，出口没有
    /// 超长句。
    #[test]
    fn oversized_run_on_is_accepted_then_split_deterministically_after_punct_repair_rounds() {
        let mut doc = doc(&numbered_words(300));
        // 主页 echo（首轮接受）+ punct-repair 每轮都原样回显。
        let mut llm = PolishFileLlm::new(vec![echo(), echo(), echo(), echo()]);
        let mut ids = SeqIds::default();
        let mut attempts: Vec<(String, u32, bool, Vec<ProblemCode>)> = Vec::new();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |attempt| {
                attempts.push((
                    attempt.page_id.to_owned(),
                    attempt.attempt,
                    attempt.accepted,
                    attempt.problems.iter().map(|p| p.code).collect(),
                ));
            },
        )
        .unwrap();
        assert_eq!(
            llm.kinds(),
            vec!["polish", "punct-repair", "punct-repair", "punct-repair"],
            "主页一轮即过，超长句跑满定向补标点轮数"
        );
        assert_eq!(attempts.len(), 4);
        assert!(attempts[0].2 && attempts[0].3.is_empty(), "{attempts:?}");
        for (round, attempt) in attempts[1..].iter().enumerate() {
            assert_eq!(attempt.0, format!("pr{}-{:03}", round + 1, round + 1));
            assert_eq!(attempt.1, round as u32 + 1);
            assert!(!attempt.2 && attempt.3 == vec![ProblemCode::SentenceOversize]);
        }
        // 第二轮起携带逐句定向指令；首轮没有。
        assert!(llm.calls[1].2.is_none());
        for call in &llm.calls[2..] {
            assert!(
                call.2.as_deref().is_some_and(|reason| {
                    reason.starts_with("[sentence-oversize] s01: [sentence-oversize]")
                        && reason.contains("未新增任何句末标点")
                }),
                "{:?}",
                call.2
            );
        }
        // 载荷是带 id 栅栏的单句条目。
        assert!(
            llm.calls[1]
                .1
                .contains("<<<SENTENCE-BEGIN id=s01 min-sentences=")
        );
        assert!(llm.calls[1].1.contains("<<<SENTENCE-END id=s01>>>"));
        assert_eq!(outcome.fallback_pages, 0, "润色文本被接受，不是原文兜底");
        assert_eq!(outcome.punct_repaired_sentences, 0);
        assert_eq!(outcome.punct_split_sentences, 1);
        assert_eq!(outcome.oversized_sentences, 0);
        // 长度兜底：左片吃满 1200 源字符（240 词 × 5）并以句号收口。
        assert_eq!(outcome.sentences.len(), 2, "{:?}", outcome.sentences);
        assert!(
            outcome.sentences[0].text.ends_with("w239."),
            "{}",
            outcome.sentences[0].text
        );
        assert!(
            outcome.sentences[1].text.starts_with("w240"),
            "{}",
            outcome.sentences[1].text
        );
        assert_eq!(doc.words.len(), 300);
        doc.validate().unwrap();
    }

    /// 定向补标点主链路：主页首轮接受超长句，punct-repair 第一轮只加句号
    /// 即通过 ⇒ 句按新句末标点切开并重新映射到源词，无 retry_reason，
    /// 不再进入第二轮，也不落确定性兜底。
    #[test]
    fn punct_repair_splits_the_run_on_when_the_model_only_adds_periods() {
        let mut doc = doc(&numbered_words(300));
        let mut llm = PolishFileLlm::new(vec![echo(), punct_repair_answer(period_every_words(50))]);
        let mut ids = SeqIds::default();
        let mut attempts: Vec<(String, u32, bool, Vec<ProblemCode>)> = Vec::new();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |attempt| {
                attempts.push((
                    attempt.page_id.to_owned(),
                    attempt.attempt,
                    attempt.accepted,
                    attempt.problems.iter().map(|p| p.code).collect(),
                ));
            },
        )
        .unwrap();
        assert_eq!(llm.kinds(), vec!["polish", "punct-repair"]);
        assert_eq!(attempts.len(), 2, "{attempts:?}");
        assert!(attempts[1].2 && attempts[1].3.is_empty(), "{attempts:?}");
        assert!(llm.calls[1].2.is_none());
        assert_eq!(outcome.punct_repaired_sentences, 1);
        assert_eq!(outcome.punct_split_sentences, 0);
        assert_eq!(outcome.oversized_sentences, 0);
        assert_eq!(outcome.fallback_pages, 0);
        assert_eq!(outcome.sentences.len(), 6, "{:?}", outcome.sentences);
        for (index, sentence) in outcome.sentences.iter().enumerate() {
            assert!(sentence.text.ends_with('.'), "{}", sentence.text);
            assert!(
                sentence.text.starts_with(&format!("w{:03}", index * 50)),
                "{}",
                sentence.text
            );
            assert!(!sentence.fallback);
        }
        assert_eq!(doc.words.len(), 300);
        doc.validate().unwrap();
    }

    /// 真实事故回归：主 polish 页原样回显时，句子派生会按 80 词/字语义上限
    /// 兜底切开；旧逻辑却只把 300/500 单位或 1200 字符以上的句子送去补标点，
    /// 因而这些 80 单位句会无标点落库。现在它们必须进入 punct-repair。
    #[test]
    fn punctuation_starved_semantic_cap_enters_punct_repair() {
        let text = "字".repeat(SENTENCE_MAX_WORDS);
        let mut doc = doc(&text);
        let mut llm = PolishFileLlm::new(vec![
            echo(),
            punct_repair_answer(|body| {
                let chars: Vec<char> = body.chars().collect();
                format!(
                    "{}。{}。",
                    chars[..SENTENCE_MAX_WORDS / 2].iter().collect::<String>(),
                    chars[SENTENCE_MAX_WORDS / 2..].iter().collect::<String>()
                )
            }),
        ]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.kinds(), vec!["polish", "punct-repair"]);
        assert_eq!(outcome.punct_repaired_sentences, 1);
        assert_eq!(outcome.sentences.len(), 2, "{:?}", outcome.sentences);
        assert!(
            outcome
                .sentences
                .iter()
                .all(|sentence| sentence.text.ends_with('。'))
        );
        doc.validate().unwrap();
    }

    /// 第一轮复述被拒 ⇒ 第二轮请求带该句的定向意见，第二轮补上句号即收敛，
    /// 不跑第三轮。
    #[test]
    fn punct_repair_second_round_carries_the_verdict_and_converges() {
        let mut doc = doc(&numbered_words(300));
        let mut llm = PolishFileLlm::new(vec![
            echo(),
            echo(),
            punct_repair_answer(period_every_words(100)),
        ]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.kinds(), vec!["polish", "punct-repair", "punct-repair"]);
        assert!(
            llm.calls[2]
                .2
                .as_deref()
                .is_some_and(|reason| reason.contains("s01: [sentence-oversize]")),
            "{:?}",
            llm.calls[2].2
        );
        assert_eq!(outcome.punct_repaired_sentences, 1);
        assert_eq!(outcome.punct_split_sentences, 0);
        assert_eq!(outcome.sentences.len(), 3, "{:?}", outcome.sentences);
        doc.validate().unwrap();
    }

    /// 真实事故形状（p014 1652 字 / p042 1822 字：同一说话人、没有句号、
    /// 停顿丰富的中文长句）：载荷带按源停顿投影的 ⏸ 提示；模型三轮都不断句
    /// 时，引擎按源时间轴在长停顿处确定性切句——每片 ≤ 单句上限、以 `。`
    /// 收口、没有 `。。`/`。，`。
    #[test]
    fn cjk_pause_rich_run_on_gets_hints_and_splits_at_long_pauses() {
        let base =
            "这个模型在训练的时候没有见过这样的数据所以它的表现会差一些然后我们再看第二个问题";
        let row_text: String = base.chars().cycle().take(140).collect();
        // 12 行 × 140 字 = 1680 字，行间 2s 停顿，同一说话人。
        let rows: Vec<RowIn> = (0..12)
            .map(|index| {
                RowIn::new(
                    index as f64 * 12.0,
                    index as f64 * 12.0 + 10.0,
                    row_text.clone(),
                )
            })
            .collect();
        let mut doc = build_doc(
            &rows,
            DocMedia {
                id: None,
                path: None,
                hash: "sha256-00".to_owned(),
                duration: 200.0,
                sample_rate: None,
            },
            "zh",
            DocEngine {
                name: "t".to_owned(),
                version: None,
                aligned_words: false,
            },
            None,
        );
        assert_eq!(doc.words.len(), 1680);
        // 主页 echo + punct-repair 三轮 echo + 切句后段落仍超限的一轮 segment-repair
        // （每句一段，验证切开的句子已能被补分段插缝）。
        let mut llm = PolishFileLlm::new(vec![
            echo(),
            echo(),
            echo(),
            echo(),
            segment_repair_answer(1),
        ]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &PolishOptions {
                language: "zh".to_owned(),
                ..file_options()
            },
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(
            llm.kinds(),
            vec![
                "polish",
                "punct-repair",
                "punct-repair",
                "punct-repair",
                "segment-repair"
            ]
        );
        // 载荷正文带 11 处长停顿提示，且提示不进入答案校验（echo 被剥净后仍判无句读）。
        let payload = &llm.calls[1].1;
        assert_eq!(payload.matches("⏸⏸⏸").count(), 11, "{payload}");
        assert_eq!(outcome.punct_split_sentences, 1);
        assert_eq!(outcome.oversized_sentences, 0);
        assert_eq!(outcome.fallback_pages, 0);
        assert_eq!(outcome.degenerate_paragraphs, 0, "切开后的句子可被补分段");
        // 句子先按长停顿、再按语义句上限收口；除原句尾外的切片都以句号收口，
        // 每片不超过 CJK 单句/段落硬上限。
        assert!(outcome.sentences.len() >= 6, "{:?}", outcome.sentences);
        let last = outcome.sentences.len() - 1;
        for (index, sentence) in outcome.sentences.iter().enumerate() {
            let chars = sentence.text.chars().count();
            assert!(
                chars <= MAX_PARAGRAPH_WORDS_CJK,
                "{chars}: {}",
                sentence.text
            );
            assert_eq!(
                index == last,
                !sentence.text.ends_with('。'),
                "{}",
                sentence.text
            );
            assert!(!sentence.text.contains("。。") && !sentence.text.contains("。，"));
        }
        assert_eq!(doc.words.len(), 1680);
        doc.validate().unwrap();
    }

    /// 多句凑批：一页里两个超长句 ⇒ 第一轮凑成载荷（每句一对 id 栅栏），
    /// 有 worker 槽数时拆到两页填满槽位；每句独立验收，一句被改写不拖累另一句，
    /// 被拒的句子单独进第二轮。
    #[test]
    fn punct_repair_batches_sentences_across_pages_and_accepts_per_sentence() {
        // 600 词、中间一个句号 ⇒ 两个 300 词（1500 源字符）的超长句。
        let mut doc = doc(&numbered_words(600).replacen("w299 ", "w299. ", 1));
        let words = doc.words.len();
        let mut options = file_options();
        options.worker_slots = Some(2);
        // 主页 echo；punct-repair 两页：第一页正常补句号，第二页改写一个词；
        // 第二轮只剩被拒的那句；最后 600 词的单段照常走一轮 segment-repair。
        let mut llm = PolishFileLlm::new(vec![
            echo(),
            punct_repair_answer(period_every_words(50)),
            punct_repair_answer(|body| {
                let fixed = period_every_words(50)(body);
                fixed.replacen("w", "x", 1)
            }),
            punct_repair_answer(period_every_words(50)),
            segment_repair_answer(3),
        ]);
        let mut ids = SeqIds::default();
        let mut attempts: Vec<(String, u32, bool, Vec<ProblemCode>)> = Vec::new();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &options,
            &mut ids,
            &mut |_| {},
            &mut |attempt| {
                attempts.push((
                    attempt.page_id.to_owned(),
                    attempt.attempt,
                    attempt.accepted,
                    attempt.problems.iter().map(|p| p.code).collect(),
                ));
            },
        )
        .unwrap();
        assert_eq!(
            llm.kinds(),
            vec![
                "polish",
                "punct-repair",
                "punct-repair",
                "punct-repair",
                "segment-repair"
            ]
        );
        let ids: Vec<&str> = attempts.iter().map(|(id, ..)| id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["p001", "pr1-001", "pr1-002", "pr2-003", "sr1-001"],
            "{attempts:?}"
        );
        assert!(attempts[1].2 && attempts[1].3.is_empty(), "{attempts:?}");
        assert!(
            !attempts[2].2 && attempts[2].3 == vec![ProblemCode::SourceDrift],
            "{attempts:?}"
        );
        assert!(attempts[3].2 && attempts[3].3.is_empty(), "{attempts:?}");
        // 第一轮两页各一句；第二轮只剩被拒的第二句，且携带其定向意见。
        assert!(llm.calls[1].1.contains("id=s01") && !llm.calls[1].1.contains("id=s02"));
        assert!(llm.calls[2].1.contains("id=s02") && !llm.calls[2].1.contains("id=s01"));
        assert!(llm.calls[3].1.contains("w300") && !llm.calls[3].1.contains("w000"));
        assert!(
            llm.calls[3]
                .2
                .as_deref()
                .is_some_and(|reason| reason.contains("[source-drift]")),
            "{:?}",
            llm.calls[3].2
        );
        assert_eq!(outcome.punct_repaired_sentences, 2);
        assert_eq!(outcome.punct_split_sentences, 0);
        assert_eq!(outcome.oversized_sentences, 0);
        assert_eq!(outcome.sentences.len(), 12, "{:?}", outcome.sentences);
        assert_eq!(doc.words.len(), words);
        doc.validate().unwrap();
    }

    #[test]
    fn deterministic_split_prefers_speaker_change_then_pause_and_closes_the_left_piece() {
        let mut doc = doc(&numbered_words(300));
        // 词 120 后说话人切换、词 200 后 2s 停顿；其余均匀无停顿。
        doc.speakers.insert(
            "s2".to_owned(),
            crate::doc::Speaker {
                name: "S2".to_owned(),
                hue: None,
            },
        );
        for word in doc.words.iter_mut().skip(120) {
            word.sp = "s2".to_owned();
        }
        let shift = 2.0;
        for word in doc.words.iter_mut().skip(200) {
            word.t0 += shift;
            word.t1 += shift;
        }
        let words = doc.words.clone();
        let sentence = MappedSentence {
            start: 0,
            end: 299,
            corrected: numbered_words(300),
            fallback: false,
        };
        let pieces = split_oversized_sentence(&words, &sentence);
        // 第一刀：窗口 [60, 240] 内说话人切换（5 分）胜过 200 处的长停顿（3 分）。
        assert_eq!(pieces[0].end, 119);
        assert!(
            pieces[0].corrected.ends_with("w119."),
            "{}",
            pieces[0].corrected
        );
        assert_eq!(pieces[1].start, 120);
        assert!(
            pieces[1].corrected.starts_with("w120"),
            "{}",
            pieces[1].corrected
        );
        // 剩余 180 词 × 5 = 900 字符不再超限，不再切。
        assert_eq!(pieces.len(), 2);
        assert!(
            pieces
                .iter()
                .all(|piece| oversized_span(&words, piece).is_none())
        );

        // 停顿处的切点带上 corrected 里的逗号：去逗号补句号，不留 `,.`。
        let mut corrected = numbered_words(300);
        corrected = corrected.replacen("w199 ", "w199, ", 1);
        for word in doc.words.iter_mut().skip(120) {
            word.sp = "s1".to_owned();
        }
        let words = doc.words.clone();
        let sentence = MappedSentence {
            start: 0,
            end: 299,
            corrected,
            fallback: false,
        };
        let pieces = split_oversized_sentence(&words, &sentence);
        assert_eq!(
            pieces[0].end,
            199,
            "{:?}",
            pieces.iter().map(|p| (p.start, p.end)).collect::<Vec<_>>()
        );
        assert!(
            pieces[0].corrected.ends_with("w199."),
            "{}",
            pieces[0].corrected
        );
        assert!(!pieces[0].corrected.contains(",."));
    }

    #[test]
    fn punct_repair_hints_project_source_pauses_into_the_corrected_text() {
        let mut doc = doc("alpha bravo charlie delta echo");
        for word in doc.words.iter_mut().skip(2) {
            word.t0 += 1.0;
            word.t1 += 1.0;
        }
        let sentence = MappedSentence {
            start: 0,
            end: 4,
            corrected: "Alpha, bravo charlie delta echo".to_owned(),
            fallback: false,
        };
        assert_eq!(
            punct_repair_hinted_text(&doc.words, &sentence),
            "Alpha, bravo ⏸⏸ charlie delta echo"
        );
    }

    #[test]
    fn one_sentence_cannot_exceed_the_paragraph_capacity() {
        let doc = doc("原文");
        let sentence = MappedSentence {
            start: 0,
            end: 0,
            corrected: "字".repeat(MAX_PARAGRAPH_WORDS_CJK + 1),
            fallback: false,
        };

        let problem = oversized_span(&doc.words, &sentence).unwrap();

        assert!(
            problem.contains("corrected sentence contains 501"),
            "{problem}"
        );
        assert!(problem.contains("limit 500"), "{problem}");
    }

    #[test]
    fn rebind_in_a_tight_window_repairs_timings_and_prunes_stale_overrides() {
        let mut doc = doc("bestpaper next.");
        doc.words[0].t0 = 0.0;
        doc.words[0].t1 = 0.01;
        doc.words[1].t0 = 0.01;
        doc.words[1].t1 = 1.0;
        let replaced = doc.words[0].id.clone();
        doc.breaks
            .insert(replaced.clone(), crate::doc::BreakOverride::Break);
        doc.para_breaks.insert(replaced.clone(), true);
        let words = doc.words.clone();
        let mut ids = SeqIds::default();
        let options = file_options();
        let mut outcome = PolishOutcome::default();
        apply(
            &mut doc,
            &words,
            vec![vec![MappedSentence {
                start: 0,
                end: 1,
                corrected: "best paper next.".to_owned(),
                fallback: false,
            }]],
            &mut ids,
            options.cue_max_chars,
            &options.enabled_checks,
            true,
            &mut outcome,
        );

        doc.validate().unwrap();
        assert!(doc.orphan_overrides().is_empty());
        assert!(!doc.breaks.contains_key(&replaced));
        assert!(!doc.para_breaks.contains_key(&replaced));
        assert!(doc.words.windows(2).all(|pair| pair[1].t0 >= pair[0].t1));
        let sentence = &outcome.sentences[0];
        assert_eq!(sentence.t0, doc.words[0].t0);
        assert_eq!(sentence.t1, doc.words.last().unwrap().t1);
    }

    /// ⏹ 是硬保证：整页兜底（没有 `PolishParsed` 可取）也必须落段落边界。
    #[test]
    fn speaker_change_still_breaks_paragraphs_on_the_whole_page_fallback() {
        let mut doc = doc("alpha bravo charlie delta echo foxtrot golf hotel");
        doc.speakers.insert(
            "s2".to_owned(),
            crate::doc::Speaker {
                name: "S2".to_owned(),
                hue: None,
            },
        );
        for word in doc.words.iter_mut().skip(4) {
            word.sp = "s2".to_owned();
        }
        let garbage = || rewrite_core(|_| "totally unrelated replacement content".to_owned());
        // 整页 2 次 + 对半缩窄后每半页 1 次，全部答非所问。
        let mut llm = PolishFileLlm::new(vec![
            garbage(),
            garbage(),
            garbage(),
            garbage(),
            garbage(),
            garbage(),
        ]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert!(outcome.fallback_pages >= 1);
        assert_eq!(outcome.paragraphs.len(), 2, "兜底路径同样欠 ⏹ 的账");
        assert!(outcome.sentences[1].text.starts_with("echo"));
        assert_eq!(doc.para_breaks.len(), 1);
        assert!(doc.para_breaks.contains_key(&doc.words[4].id));
        doc.validate().unwrap();
    }

    /// 索引契约答案：对载荷里每个 `<<<BLOCK k | n sentences …>>>` 块回
    /// `<<<BLOCK k>>>` + 每 `every` 行一个区间（逐块重新计数）+ `<<<BLOCK-END>>>`。
    fn index_answer_every(every: usize) -> PolishStep {
        Box::new(move |input: &str| {
            let mut out: Vec<String> = Vec::new();
            for line in input.lines() {
                let trimmed = line.trim();
                let Some(rest) = trimmed.strip_prefix("<<<BLOCK ") else {
                    continue;
                };
                if rest.starts_with("END") {
                    continue;
                }
                let mut fields = rest.trim_end_matches(">>>").split('|');
                let index: usize = fields.next().unwrap().trim().parse().unwrap();
                let total: usize = fields
                    .next()
                    .unwrap()
                    .trim()
                    .split(' ')
                    .next()
                    .unwrap()
                    .parse()
                    .unwrap();
                out.push(format!("<<<BLOCK {index}>>>"));
                let mut start = 1usize;
                while start <= total {
                    let end = (start + every - 1).min(total);
                    out.push(format!("{start}-{end}"));
                    start = end + 1;
                }
                out.push("<<<BLOCK-END>>>".to_owned());
            }
            Ok(out.join("\n"))
        })
    }

    /// 兼容旧名：segment-repair 答案。
    fn segment_repair_answer(every: usize) -> PolishStep {
        index_answer_every(every)
    }

    /// 分段退化主链路（真实事故回归：deepseek-v4-flash 把 9 分钟转写整页
    /// 糊成一个段落还盖了 `segment: fresh`）：主页**首轮即接受**正文（不再
    /// 为分段烧整页重试），波次后 segment-repair 定向补分段；模型
    /// [`SEGMENT_REPAIR_MAX_ROUNDS`] 轮都只回一个区间 ⇒ 轮次耗尽后引擎按停顿
    /// 等级确定性收口：段落钉落地、每段 ≤ 上限、照常盖 `segment` 戳，
    /// `fallback_paragraphs` 记账。第二轮起的请求必须携带 paragraph-oversize
    /// 定向指令（含最少段数）。
    #[test]
    fn oversized_paragraphs_are_split_deterministically_after_rounds_run_out() {
        let mut doc = doc(&long_text(500));
        let before = doc.words.clone();
        // 主页 echo（首轮接受）+ segment-repair 每轮都原样回显（带行号句行、
        // 没有空行 ⇒ 单区间）。
        let mut llm = PolishFileLlm::new(vec![echo(), echo(), echo(), echo()]);
        let mut ids = SeqIds::default();
        let mut attempts: Vec<(String, u32, bool, Vec<ProblemCode>)> = Vec::new();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |attempt| {
                attempts.push((
                    attempt.page_id.to_owned(),
                    attempt.attempt,
                    attempt.accepted,
                    attempt.problems.iter().map(|p| p.code).collect(),
                ));
            },
        )
        .unwrap();
        assert_eq!(
            llm.kinds(),
            vec![
                "polish",
                "segment-repair",
                "segment-repair",
                "segment-repair"
            ],
            "主页一轮即过，退化段落跑满定向补分段轮数"
        );
        // 主页首轮接受且无问题；补分段每轮都被 ParagraphOversize 拒收。
        assert_eq!(attempts.len(), 4);
        assert!(attempts[0].2 && attempts[0].3.is_empty());
        for (round, attempt) in attempts[1..].iter().enumerate() {
            assert_eq!(attempt.0, format!("sr{}-{:03}", round + 1, round + 1));
            assert_eq!(attempt.1, round as u32 + 1);
            assert!(!attempt.2 && attempt.3.contains(&ProblemCode::ParagraphOversize));
        }
        // 载荷是带行号的块；第二轮起携带定向指令（含最少段数）；首轮没有。
        assert!(
            llm.calls[1]
                .1
                .contains("<<<BLOCK 1 | 50 sentences | 500 words | at least 2 paragraphs>>>")
        );
        assert!(llm.calls[1].1.contains("\n50| word490 word491"));
        assert!(llm.calls[1].2.is_none());
        for call in &llm.calls[2..] {
            assert!(
                call.2
                    .as_deref()
                    .is_some_and(|reason| reason.contains("paragraph-oversize")
                        && reason.contains("第 1 块")
                        && reason.contains("至少拆成 2 个区间")),
                "{:?}",
                call.2
            );
        }
        assert_eq!(outcome.fallback_pages, 0, "润色文本被接受，不是原文兜底");
        assert_eq!(outcome.repaired_paragraphs, 0);
        assert_eq!(outcome.fallback_paragraphs, 1);
        assert_eq!(outcome.degenerate_paragraphs, 0);
        assert_eq!(doc.words, before);
        assert!(doc.stages.polish.is_some());
        assert!(doc.stages.segment.is_some(), "确定性收口后照常盖戳");
        // 500 词按 300 上限收口：300 + 200 ⇒ 1 钉，落在第 300 词（第 31 句首）。
        assert_eq!(doc.para_breaks.len(), 1, "{:?}", doc.para_breaks);
        assert!(doc.para_breaks.contains_key(&doc.words[300].id));
        doc.validate().unwrap();
    }

    /// 主页首轮糊成一段照常接受，segment-repair 波次插上空行 ⇒ 段落钉落地
    /// 并照常盖 segment 戳；主页从不因分段退化被重试。
    #[test]
    fn degenerate_first_round_recovers_after_targeted_segment_repair() {
        let mut doc = doc(&long_text(500));
        // 500 词 / 每 10 词一句 = 50 句行；每 20 行一个区间 ⇒ 200/200/100 词三段。
        let mut llm = PolishFileLlm::new(vec![echo(), segment_repair_answer(20)]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.kinds(), vec!["polish", "segment-repair"]);
        assert_eq!(outcome.repaired_paragraphs, 1);
        assert_eq!(outcome.degenerate_paragraphs, 0);
        assert_eq!(outcome.fallback_pages, 0);
        // 3 段 ⇒ 2 钉。
        assert_eq!(doc.para_breaks.len(), 2);
        assert!(doc.stages.segment.is_some());
        doc.validate().unwrap();
    }

    /// 多页多段凑批 + 逐块验收 + 二次分页 + 逐轮收敛：主 polish 分两页、每页
    /// 每 50 句（500 词）糊一段 ⇒ 六段全部超限（Latin 上限 300）；第一轮把
    /// 它们凑成载荷（每份 ≤ 核心区预算），答案对每块回 100/180/220 词三个
    /// 区间，但把每份载荷的最后一块回成有缺口的区间 ⇒ 该块 `range-invalid`
    /// 第二轮重发、同载荷其余块照常落地；`stages.segment` 照常盖戳，两轮
    /// 收敛，绝不跑到第三轮。
    #[test]
    fn segment_repair_batches_paragraphs_across_pages_and_converges_over_rounds() {
        let mut doc = doc(&long_text(3000));
        let main = || {
            rewrite_core(|core| {
                let mut out = String::new();
                for (index, chunk) in core.split_inclusive('.').enumerate() {
                    if index > 0 {
                        out.push_str(if index % 50 == 0 { "\n\n" } else { " " });
                    }
                    out.push_str(chunk.trim_start());
                }
                out
            })
        };
        let round1 = || -> PolishStep {
            Box::new(|input: &str| {
                let total = input.matches("<<<BLOCK-END>>>").count();
                let mut out: Vec<String> = Vec::new();
                for index in 1..=total {
                    out.push(format!("<<<BLOCK {index}>>>"));
                    if index == total {
                        out.push("1-10".to_owned());
                        out.push("12-50".to_owned());
                    } else {
                        out.push("1-10".to_owned());
                        out.push("11-28".to_owned());
                        out.push("29-50".to_owned());
                    }
                    out.push("<<<BLOCK-END>>>".to_owned());
                }
                Ok(out.join("\n"))
            })
        };
        let mut llm = PolishFileLlm::new(vec![
            main(),
            main(),
            // 页缝判定：块 = 页 1 末段尾窗（25 句）+ 页 2 首段头窗（25 句），
            // 区间 1-25 / 26-50 ⇒ 页缝保留，组结构与判定前完全一致。
            index_answer_every(25),
            round1(),
            round1(),
            index_answer_every(10),
            index_answer_every(10),
        ]);
        let mut ids = SeqIds::default();
        let mut attempts: Vec<(String, u32, bool, Vec<ProblemCode>)> = Vec::new();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |attempt| {
                attempts.push((
                    attempt.page_id.to_owned(),
                    attempt.attempt,
                    attempt.accepted,
                    attempt.problems.iter().map(|p| p.code).collect(),
                ));
            },
        )
        .unwrap();
        assert_eq!(outcome.degenerate_paragraphs, 0, "{attempts:?}");
        assert_eq!(outcome.fallback_paragraphs, 0, "{attempts:?}");
        assert_eq!(outcome.fallback_pages, 0);
        assert_eq!(outcome.seam_kept_paragraphs, 1, "{attempts:?}");
        assert_eq!(outcome.seam_merged_paragraphs, 0);
        assert_eq!(outcome.repaired_paragraphs, 6, "{attempts:?}");
        assert!(doc.stages.segment.is_some());
        doc.validate().unwrap();

        // 页缝载荷是窗口而不是整段：50 行、页缝在第 26 行前。
        let seam_call = llm
            .calls
            .iter()
            .find(|(kind, _, _)| kind == "seam-repair")
            .expect("seam-repair call");
        assert!(
            seam_call
                .1
                .contains("<<<BLOCK 1 | 50 sentences | 500 words | page seam before line 26>>>"),
            "{}",
            seam_call.1
        );

        // 主 polish 两页；第一轮六段 3000 词凑成两份载荷（预算 2200+10%）。
        let main_pages = attempts
            .iter()
            .filter(|(id, ..)| id.starts_with('p'))
            .count();
        assert_eq!(main_pages, 2, "{attempts:?}");
        let round1_pages: Vec<_> = attempts
            .iter()
            .filter(|(id, ..)| id.starts_with("sr1-"))
            .collect();
        assert_eq!(round1_pages.len(), 2, "{attempts:?}");
        for (_, round, accepted, codes) in &round1_pages {
            assert_eq!(*round, 1);
            assert!(*accepted, "同载荷其余块接受，不因一块区间非法整页拒收");
            assert_eq!(codes, &vec![ProblemCode::RangeInvalid]);
        }
        assert!(
            attempts
                .iter()
                .any(|(id, round, ..)| id.starts_with("sr2-") && *round == 2)
        );
        assert!(
            !attempts.iter().any(|(id, ..)| id.starts_with("sr3-")),
            "两轮即收敛：{attempts:?}"
        );
        // 第二轮只带上一轮区间非法块的逐块意见。
        let round2_reasons: Vec<&str> = llm
            .calls
            .iter()
            .filter(|(kind, _, reason)| kind == "segment-repair" && reason.is_some())
            .filter_map(|(_, _, reason)| reason.as_deref())
            .collect();
        assert!(
            !round2_reasons.is_empty(),
            "{:?}",
            llm.calls.iter().map(|c| &c.2).collect::<Vec<_>>()
        );
        assert!(
            round2_reasons
                .iter()
                .all(|reason| reason.contains("range-invalid")
                    && reason.contains("第 11 行没有被任何区间覆盖")),
            "{round2_reasons:?}"
        );
        assert!(
            !round2_reasons
                .iter()
                .any(|reason| reason.contains("上一轮拆分后仍有")),
            "已通过的块不进第二轮：{round2_reasons:?}"
        );
        // 第一轮请求不带 retry_reason。
        assert!(
            llm.calls
                .iter()
                .filter(|(kind, _, _)| kind == "segment-repair")
                .take(2)
                .all(|(_, _, reason)| reason.is_none())
        );
    }

    /// 溢出容忍：模型给出的边界切出的子组超限不到 15% ⇒ 引擎按停顿等级
    /// 即时补切，不烧第二轮；超过 15% ⇒ 带"仍有 N 词"意见进第二轮由模型
    /// 按语义拆。
    #[test]
    fn slightly_oversized_subgroups_are_capped_but_big_ones_go_another_round() {
        let mut doc = doc(&long_text(1000));
        let main = || {
            rewrite_core(|core| {
                let mut out = String::new();
                for (index, chunk) in core.split_inclusive('.').enumerate() {
                    if index > 0 {
                        out.push_str(if index % 50 == 0 { "\n\n" } else { " " });
                    }
                    out.push_str(chunk.trim_start());
                }
                out
            })
        };
        // 两块各 50 句：块 1 回 1-18 / 19-50（180 / 320 词：320 ≤ 345 即时补切
        // 成 300+20）；块 2 回 1-10 / 11-50（100 / 400 词：400 > 345 进第二轮）。
        let round1 = || -> PolishStep {
            Box::new(|_: &str| {
                Ok("<<<BLOCK 1>>>\n1-18\n19-50\n<<<BLOCK-END>>>\n<<<BLOCK 2>>>\n1-10\n11-50\n<<<BLOCK-END>>>\n".to_owned())
            })
        };
        let mut llm = PolishFileLlm::new(vec![main(), round1(), index_answer_every(20)]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(
            llm.kinds(),
            vec!["polish", "segment-repair", "segment-repair"]
        );
        // 第二轮只发块 2 的 400 词子组，意见是默认的"仍有 N 词"。
        assert!(
            llm.calls[2]
                .1
                .contains("<<<BLOCK 1 | 40 sentences | 400 words | at least 2 paragraphs>>>"),
            "{}",
            llm.calls[2].1
        );
        assert!(
            !llm.calls[2].1.contains("<<<BLOCK 2 "),
            "{}",
            llm.calls[2].1
        );
        assert!(
            llm.calls[2]
                .2
                .as_deref()
                .is_some_and(|reason| reason.contains("上一轮拆分后仍有 400 词")),
            "{:?}",
            llm.calls[2].2
        );
        assert_eq!(outcome.fallback_paragraphs, 0);
        assert_eq!(outcome.degenerate_paragraphs, 0);
        // 块 1：180 / 300 / 20；块 2：100 / 200 / 200 ⇒ 6 组 ⇒ 5 钉。
        assert_eq!(doc.para_breaks.len(), 5, "{:?}", doc.para_breaks);
        assert!(doc.stages.segment.is_some());
        doc.validate().unwrap();
    }

    /// 已分段的重润：补回的空行无处安放（`paraBreaks` 不重写），不跑
    /// segment-repair 波次也不发退化告警，超长单段一轮放行。
    #[test]
    fn re_polish_with_existing_segmentation_skips_paragraph_enforcement() {
        let mut doc = doc(&long_text(500));
        doc.stages.segment = Some("seg-fp".to_owned());
        let mut llm = PolishFileLlm::new(vec![echo()]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &file_options(),
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.calls.len(), 1, "重润路径一轮放行，不跑定向补分段");
        assert_eq!(outcome.repaired_paragraphs, 0);
        assert_eq!(outcome.degenerate_paragraphs, 0);
        assert_eq!(outcome.fallback_pages, 0);
        assert_eq!(doc.stages.segment.as_deref(), Some("seg-fp"));
        doc.validate().unwrap();
    }
    // ---- 页缝（seam）----------------------------------------------------------

    /// 三页、每页 [`segment_core`] 分段（20/20/10 句）的多页基线：页缝落在
    /// 页 2 / 页 3 首段之前，两个页缝互不相邻（页 2 有 3 组）。
    fn three_page_doc() -> (TranscriptDoc, PolishOptions) {
        let doc = doc(&long_text(1500));
        let options = PolishOptions {
            worker_slots: Some(3),
            ..file_options()
        };
        (doc, options)
    }

    /// 页缝判定：块 = 页 k 末段尾窗（10 句 100 词，整段）+ 页 k+1 首段头窗
    /// （20 句 200 词，整段），模型回 1-10 / 11-20 / 21-30 ⇒ 含页缝行的区间
    /// 从页缝行起 ⇒ 两个页缝都保留；窗口内其他边界不采纳（窗口是截断的）。
    #[test]
    fn seam_repair_keeps_seams_the_model_confirms() {
        let (mut doc, options) = three_page_doc();
        let mut llm = PolishFileLlm::new(vec![
            segmented_echo(),
            segmented_echo(),
            segmented_echo(),
            index_answer_every(10),
        ]);
        let mut ids = SeqIds::default();
        let mut pages: Vec<String> = Vec::new();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &options,
            &mut ids,
            &mut |_| {},
            &mut |attempt| pages.push(attempt.page_id.to_owned()),
        )
        .unwrap();
        assert_eq!(pages, vec!["p001", "p002", "p003", "sm1-001"]);
        assert_eq!(
            llm.kinds(),
            vec!["polish", "polish", "polish", "seam-repair"]
        );
        assert_eq!(outcome.seam_kept_paragraphs, 2);
        assert_eq!(outcome.seam_merged_paragraphs, 0);
        assert_eq!(outcome.seam_signaled_paragraphs, 0);
        // 两块各 30 行、页缝在第 11 行前。
        assert!(
            llm.calls[3]
                .1
                .contains("<<<BLOCK 1 | 30 sentences | 300 words | page seam before line 11>>>"),
            "{}",
            llm.calls[3].1
        );
        assert!(
            llm.calls[3]
                .1
                .contains("<<<BLOCK 2 | 30 sentences | 300 words | page seam before line 11>>>")
        );
        // 9 组原样 ⇒ 8 钉。
        assert_eq!(doc.para_breaks.len(), 8);
        assert!(doc.stages.segment.is_some());
        doc.validate().unwrap();
    }

    /// 页缝判定被拒两轮（答案里没有任何区间）⇒ 保留原段钉，与不做判定完全
    /// 一致；第二轮请求带 `[range-invalid]` 定向意见。
    #[test]
    fn seam_repair_rejections_keep_the_forced_breaks() {
        let (mut doc, options) = three_page_doc();
        let garbage =
            || -> PolishStep { Box::new(|_: &str| Ok("I cannot decide this.".to_owned())) };
        let mut llm = PolishFileLlm::new(vec![
            segmented_echo(),
            segmented_echo(),
            segmented_echo(),
            garbage(),
            garbage(),
        ]);
        let mut ids = SeqIds::default();
        let mut attempts: Vec<(String, u32, bool)> = Vec::new();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &options,
            &mut ids,
            &mut |_| {},
            &mut |attempt| {
                attempts.push((
                    attempt.page_id.to_owned(),
                    attempt.attempt,
                    attempt.accepted,
                ))
            },
        )
        .unwrap();
        assert_eq!(
            llm.kinds(),
            vec!["polish", "polish", "polish", "seam-repair", "seam-repair"]
        );
        assert_eq!(
            &attempts[3..],
            &[
                ("sm1-001".to_owned(), 1, false),
                ("sm2-002".to_owned(), 2, false)
            ]
        );
        assert!(
            llm.calls[4]
                .2
                .as_deref()
                .is_some_and(|reason| reason.contains("range-invalid")),
            "{:?}",
            llm.calls[4].2
        );
        assert_eq!(outcome.seam_kept_paragraphs, 0);
        assert_eq!(outcome.seam_merged_paragraphs, 0);
        // 9 组原样 ⇒ 8 钉。
        assert_eq!(doc.para_breaks.len(), 8);
        doc.validate().unwrap();
    }

    /// 页缝显式信号：后一页在核心区开头留空行 ⇒ 段钉直接保留、不进
    /// seam-repair；首页的前导空行不算信号。
    #[test]
    fn leading_blank_line_signals_a_new_paragraph_and_skips_seam_repair() {
        let (mut doc, options) = three_page_doc();
        let signaled = || rewrite_core(|core| format!("\n{}", segment_core(core)));
        let mut llm = PolishFileLlm::new(vec![signaled(), signaled(), signaled()]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &options,
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.kinds(), vec!["polish", "polish", "polish"]);
        assert_eq!(outcome.seam_signaled_paragraphs, 2);
        assert_eq!(outcome.seam_kept_paragraphs, 0);
        assert_eq!(outcome.seam_merged_paragraphs, 0);
        assert_eq!(doc.para_breaks.len(), 8);
        doc.validate().unwrap();
    }

    /// 页 2 整页糊成一段（50 句 500 词）：两个页缝各自开窗——块 1 = 页 1
    /// 末段整段（10 句）+ 页 2 头窗（25 句），块 2 = 页 2 尾窗（25 句）+ 页 3
    /// 首段整段（20 句）——而不是把整页 500 词塞进块里；模型两块都回单区间
    /// ⇒ 两个页缝都合并（80 句 800 词一段），随后由 segment-repair 按语义
    /// 拆开（seam-repair 不做容量补切）。
    #[test]
    fn seams_around_a_one_paragraph_page_use_windows_not_the_whole_page() {
        let (mut doc, options) = three_page_doc();
        let mut llm = PolishFileLlm::new(vec![
            segmented_echo(),
            echo(),
            segmented_echo(),
            index_answer_every(1000),
            index_answer_every(20),
        ]);
        let mut ids = SeqIds::default();
        let mut pages: Vec<String> = Vec::new();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &options,
            &mut ids,
            &mut |_| {},
            &mut |attempt| pages.push(attempt.page_id.to_owned()),
        )
        .unwrap();
        assert_eq!(pages, vec!["p001", "p002", "p003", "sm1-001", "sr1-001"]);
        let seam_payload = &llm.calls[3].1;
        assert!(
            seam_payload
                .contains("<<<BLOCK 1 | 35 sentences | 350 words | page seam before line 11>>>"),
            "{seam_payload}"
        );
        assert!(
            seam_payload
                .contains("<<<BLOCK 2 | 45 sentences | 450 words | page seam before line 26>>>"),
            "{seam_payload}"
        );
        assert_eq!(outcome.seam_merged_paragraphs, 2);
        assert_eq!(outcome.seam_kept_paragraphs, 0);
        // 合并块 = 10 + 50 + 20 = 80 句 800 词，segment-repair 每 20 句切 ⇒ 4 组；
        // 加上页 1 剩余 2 组、页 3 剩余 2 组 ⇒ 8 组 ⇒ 7 钉。
        assert!(
            llm.calls[4]
                .1
                .contains("<<<BLOCK 1 | 80 sentences | 800 words | at least 3 paragraphs>>>"),
            "{}",
            llm.calls[4].1
        );
        assert_eq!(outcome.repaired_paragraphs, 1);
        assert_eq!(doc.para_breaks.len(), 7);
        assert_eq!(outcome.degenerate_paragraphs, 0);
        assert_eq!(outcome.fallback_paragraphs, 0);
        doc.validate().unwrap();
    }

    /// 相邻页缝链块（直接驱动波次）：组 A(20 句) B(3 句) | C(20 句 200 词) |
    /// D(20 句) E(5 句)，页缝在 C 与 D 之前。C 不超过窗口 ⇒ 头窗盖满 C，
    /// 下一个页缝紧随其后 ⇒ 链成一块（B 尾 + C 整段 + D 头窗），块头写两个
    /// 页缝位置；模型回单区间 ⇒ 两个页缝都合并：A | B+C+D | E。
    #[test]
    fn adjacent_seams_chain_when_the_middle_group_fits_the_window() {
        let doc = doc(&long_text(680));
        let sentence = |index: usize| MappedSentence {
            start: index * 10,
            end: index * 10 + 9,
            corrected: String::new(),
            fallback: false,
        };
        let group = |range: std::ops::Range<usize>| range.map(sentence).collect::<Vec<_>>();
        let mut committed = vec![
            group(0..20),
            group(20..23),
            group(23..43),
            group(43..63),
            group(63..68),
        ];
        let mut llm = PolishFileLlm::new(vec![index_answer_every(1000)]);
        let mut outcome = PolishOutcome::default();
        seam_repair_wave(
            &doc.words,
            &mut committed,
            vec![2, 3],
            &mut llm,
            &mut outcome,
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.kinds(), vec!["seam-repair"]);
        let payload = &llm.calls[0].1;
        assert!(
            payload.contains(
                "<<<BLOCK 1 | 43 sentences | 430 words | page seams before lines 4, 24>>>"
            ),
            "{payload}"
        );
        assert_eq!(payload.matches("<<<BLOCK-END>>>").count(), 1, "{payload}");
        assert_eq!(outcome.seam_merged_paragraphs, 2);
        assert_eq!(outcome.seam_kept_paragraphs, 0);
        let sizes: Vec<usize> = committed.iter().map(Vec::len).collect();
        assert_eq!(sizes, vec![20, 43, 5]);
        assert_eq!(committed[1][0].start, 200);
    }

    /// 页缝块答案把页缝段的真正起点定在页缝之前几句：含页缝行的区间从
    /// 窗口内部起 ⇒ 页缝段首去掉、区间起点补成段首（页 k 末段被拆成两段，
    /// 后一段接上页 k+1 首段）。
    #[test]
    fn seam_repair_moves_the_paragraph_start_when_the_model_says_so() {
        let (mut doc, options) = three_page_doc();
        // 块 30 行、页缝在第 11 行前：回 1-7 / 8-30 ⇒ 页缝合并、第 8 行成段首。
        let answer = || -> PolishStep {
            Box::new(|input: &str| {
                let total = input.matches("<<<BLOCK-END>>>").count();
                let mut out = String::new();
                for index in 1..=total {
                    out.push_str(&format!(
                        "<<<BLOCK {index}>>>\n1-7\n8-30\n<<<BLOCK-END>>>\n"
                    ));
                }
                Ok(out)
            })
        };
        let mut llm = PolishFileLlm::new(vec![
            segmented_echo(),
            segmented_echo(),
            segmented_echo(),
            answer(),
        ]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &options,
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(
            llm.kinds(),
            vec!["polish", "polish", "polish", "seam-repair"]
        );
        assert_eq!(outcome.seam_merged_paragraphs, 2);
        assert_eq!(outcome.seam_kept_paragraphs, 0);
        // 9 组：每个页缝去 1 段首、加 1 段首 ⇒ 仍 9 组 8 钉；页 2 首段的钉从
        // 第 50 句首（词 500）挪到第 47 句首（词 470）。
        assert_eq!(doc.para_breaks.len(), 8, "{:?}", doc.para_breaks);
        assert!(!doc.para_breaks.contains_key(&doc.words[500].id));
        assert!(doc.para_breaks.contains_key(&doc.words[470].id));
        assert!(!doc.para_breaks.contains_key(&doc.words[1000].id));
        assert!(doc.para_breaks.contains_key(&doc.words[970].id));
        doc.validate().unwrap();
    }

    /// 硬切页缝（页界落在句中、窗口与溢出区没有任何断点）：两侧段落由引擎
    /// 无条件合并，不进 seam-repair。2 槽 ⇒ 2 页 400 词，页界落在第二句
    /// 中间且窗口/溢出区无断点。
    #[test]
    fn hard_cut_seams_are_merged_without_asking_the_model() {
        // 单字母词（避开单句 1200 源字符上限）；句末落在第 200 / 470 / 740 词后，
        // 页 1（400 词）的窗口 [320,400) 与溢出区 [400,460) 里没有任何断点。
        let mut text = String::new();
        for index in 0..800 {
            if index > 0 {
                text.push(' ');
            }
            text.push((b'a' + (index % 26) as u8) as char);
            if index == 199 || index == 469 || index == 739 {
                text.push('.');
            }
        }
        let mut doc = doc(&text);
        let options = PolishOptions {
            worker_slots: Some(2),
            ..file_options()
        };
        let plans = plan_polish_file_pages(&doc.words, &[0..doc.words.len()], Some(2));
        assert_eq!(plans.len(), 2, "{plans:?}");
        assert!(plans[0].hard_cut_end, "{plans:?}");
        let mut llm = PolishFileLlm::new(vec![echo(), echo(), segment_repair_answer(1)]);
        let mut ids = SeqIds::default();
        let outcome = run_polish_file_contract(
            &mut doc,
            &mut llm,
            &options,
            &mut ids,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(
            llm.kinds(),
            vec!["polish", "polish", "segment-repair"],
            "硬切页缝不进 seam-repair"
        );
        assert_eq!(outcome.hard_cut_seams_merged, 1);
        assert_eq!(
            outcome.seam_kept_paragraphs + outcome.seam_merged_paragraphs,
            0
        );
        // 两页并成一组后由 segment-repair 逐句拆开（页 1 的残句与页 2 的残句各成一句）。
        assert_eq!(outcome.repaired_paragraphs, 1);
        assert_eq!(doc.para_breaks.len(), outcome.sentences.len() - 1);
        doc.validate().unwrap();
    }

    /// 泰文行：沙盒实跑的九行（验收夹具八句 + 一行两个短语）。
    const THAI_ROWS: [&str; 9] = [
        "ลลิตาไม่ได้ยกเลิกการประชุมแต่เลื่อนไปเป็นวันพฤหัสบดีเวลา14:30น.",
        "ถ้าอุณหภูมิลดลงต่ำกว่า5องศาให้ปิดหน้าต่างก่อนเปิดเครื่องทำความร้อน",
        "นนท์จ่ายเงิน120บาทสำหรับตั๋วสามใบแต่ราคานี้ไม่รวมอาหารเย็น",
        "หนังสือที่มาลีให้ก้องยืมเมื่อวานเป็นของพี่สาวของมาลี",
        "รหัสF-07ปรากฏข้างคำว่า“ยืนยันแล้ว”แต่ยังไม่ได้ส่งพัสดุ",
        "แม้พลอยจะออกเดินทางก่อนนัทแต่เธอก็มาถึงหลังเขาสิบนาที",
        "อย่าส่งไฟล์ให้นิดาจนกว่าผู้จัดการจะอนุมัติฉบับที่สอง",
        "เราซื้อข้าวสาร2.5กิโลกรัมและหลังอาหารเย็นยังเหลืออยู่ครึ่งหนึ่ง",
        "วันนี้อากาศดีมาก เราจะไปเที่ยวทะเลกัน",
    ];

    /// 新建的泰文文稿（按词切开、短语内带「贴前」标记）与同样几行的旧文稿
    /// （一个短语一个词）。
    fn thai_docs() -> (TranscriptDoc, Vec<Word>) {
        let rows: Vec<RowIn> = THAI_ROWS
            .iter()
            .enumerate()
            .map(|(index, text)| RowIn::new(index as f64 * 6.0, index as f64 * 6.0 + 5.0, *text))
            .collect();
        let fresh = build_doc(
            &rows,
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
        let mut legacy = Vec::new();
        for (row, text) in THAI_ROWS.iter().enumerate() {
            for (column, atom) in crate::atomize::atomize(text).into_iter().enumerate() {
                let mut word = fresh.words[0].clone();
                word.id = format!("g{}.{column}", row + 1);
                word.text = atom;
                word.glue = false;
                legacy.push(word);
            }
        }
        (fresh, legacy)
    }

    /// 沙盒实跑的回答：模型在数字、引号两边补了空格，两行并成一句。
    fn thai_answer() -> Vec<Vec<String>> {
        [
            "ลลิตาไม่ได้ยกเลิกการประชุมแต่เลื่อนไปเป็นวันพฤหัสบดีเวลา 14:30 น. ถ้าอุณหภูมิลดลงต่ำกว่า 5 องศาให้ปิดหน้าต่างก่อนเปิดเครื่องทำความร้อน",
            "นนท์จ่ายเงิน 120 บาทสำหรับตั๋วสามใบแต่ราคานี้ไม่รวมอาหารเย็น หนังสือที่มาลีให้ก้องยืมเมื่อวานเป็นของพี่สาวของมาลี",
            "รหัส F-07 ปรากฏข้างคำว่า “ยืนยันแล้ว” แต่ยังไม่ได้ส่งพัสดุ แม้พลอยจะออกเดินทางก่อนนัทแต่เธอก็มาถึงหลังเขาสิบนาที",
            "อย่าส่งไฟล์ให้นิดาจนกว่าผู้จัดการจะอนุมัติฉบับที่สอง เราซื้อข้าวสาร 2.5 กิโลกรัมและหลังอาหารเย็นยังเหลืออยู่ครึ่งหนึ่ง",
            "วันนี้อากาศดีมาก เราจะไปเที่ยวทะเลกัน",
        ]
        .iter()
        .map(|line| vec![(*line).to_owned()])
        .collect()
    }

    /// 按词建稿的泰文：答案按空白只能切到短语，文稿是一个个词，两侧切到字素簇
    /// 比对才对得上；句界仍落在词边界上（这里正是行尾）。
    #[test]
    fn a_thai_answer_maps_onto_a_word_split_transcript() {
        let (fresh, _) = thai_docs();
        let words = &fresh.words;
        let row_last: Vec<usize> = (1..=THAI_ROWS.len())
            .map(|row| {
                words
                    .iter()
                    .rposition(|word| word.id.starts_with(&format!("g{row}.")))
                    .unwrap()
            })
            .collect();
        let mapped = map_corrected_page(words, 0..words.len(), &thai_answer()).unwrap();
        let ends: Vec<usize> = mapped
            .iter()
            .flatten()
            .map(|sentence| sentence.end)
            .collect();
        assert_eq!(
            ends,
            [
                row_last[1],
                row_last[3],
                row_last[5],
                row_last[7],
                row_last[8]
            ]
        );
    }

    /// 已有的泰文文稿（一个短语一个词）不改口径：模型补了空格的短语整段对不上，
    /// 这一页仍被判漂移——本轮之前就是这样，没有修（见分词设计稿 §8）。
    #[test]
    fn a_legacy_thai_transcript_keeps_phrase_level_comparison() {
        let (_, legacy) = thai_docs();
        assert!(!needs_fine_comparison(&legacy));
        let error = map_corrected_page(&legacy, 0..legacy.len(), &thai_answer()).unwrap_err();
        assert!(error.to_string().contains("drifted"), "{error}");
    }

    /// 兜底切分的 30 词封顶不切进泰文短语：顺延到短语末尾（这里是行尾）。
    #[test]
    fn fallback_sentences_do_not_cut_inside_a_thai_phrase() {
        let (fresh, _) = thai_docs();
        let words = &fresh.words;
        let sentences = fallback_sentences(words, 0..words.len());
        assert!(sentences.len() > 1);
        for sentence in &sentences {
            assert!(
                !words.get(sentence.end + 1).is_some_and(|next| next.glue),
                "cut before glued word {:?}",
                words[sentence.end + 1].text
            );
        }
    }
}
