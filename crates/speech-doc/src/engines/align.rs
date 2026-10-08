//! 阶段五：展示切分与字幕对齐（§9 / v0.3 §5）——把句级译文切成展示片，
//! 落 `transAlign` 覆盖层。译句真相（`trans`）由 translate 引擎负责，本引擎
//! 只写切法。
//!
//! 三种策略（v0.3 §5，项目级默认 manyToOne，句级可覆盖）：
//! - `independent`：目标语切分器（`split::split_independent`），零 LLM；
//! - `manyToOne`：所有超出单行容量的长句进入 LLM。缺省载体是块对齐边
//!   （[`AlignCarrier::Edges`]，对齐块设计 §4/§6）：translate 融合草稿或
//!   dedicated `align-edges/1` 只给出"译文语义块 → 源词序号"，块合并、安全
//!   边界、双语 DP 全在 [`crate::align_block`]；某块超 hard 时经
//!   `align-rewrite/1` 单调化改写写入 `transDisplay`；再不行整句对应；
//!   dedicated 失败共享一次全局修复，仍失败先试纯锚点块对齐，最后降级目标语
//!   切 + 词锚定。审阅/修复载体 [`AlignCarrier::Table`]（`align-table/1`）
//!   保留原两列切分表协议（连续全覆盖 + 确定性对账 + 双语长度计划 + 缝 lint）；
//! - `oneToOne`：旧版源 Cue 对齐模式，只读兼容，不再生成。
//!
//! 增量语义：已有同 mode 有效条目的句跳过；`force` 重切。不需要条目的句
//! （≤ fit 且 ≤ hard 的短译句）清掉既有条目。

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

pub use crate::align_block::AlignDensity;
use crate::source_boundary::normalized_source_lexemes;
pub use crate::source_boundary::source_boundary_issue;

use crate::align_block::{
    ANCHOR_ALIGNER_TAG, AlignCtx, AlignEdge, AnchorAligner, AnchorWord, BilingualPlanInput,
    PlanOutcome, TermPair, WordAligner, merge_edges, plan_sentence, plan_sentence_rows,
    purge_stale_display, sentence_level_entry, trans_text_fingerprint,
};
use crate::atomize::{JoinWord, join_word_texts, normalize_chars, word_count};
use crate::autocorrect::{
    Options as AutocorrectOptions, format_translation_map, format_translation_with_options,
};
use crate::cue::{Cue, derive_cues};
use crate::doc::{
    AlignMode, Correspondence, TextBasis, TransAlign, TransDisplay, TransPiece, TranscriptDoc, Word,
};
use crate::engines::markers;
use crate::filepipe::{
    AlignChunk, AlignEdgesInput, AlignEdgesSentenceInput, AlignParsed, AlignSentenceInput,
    AlignTableInput, PageAttempt, ProblemCode, ProblemScope, chunk_char_ranges, chunks_to_edges,
    parse_align_edges, parse_align_edges_input, parse_align_table, parse_align_table_input,
    render_align_edges, render_align_table,
};
use crate::layout_profile::LayoutProfile;
use crate::llm::{LlmError, LlmJson, LlmRequest};
use crate::seam::{
    SeamLintClass, SeamLintKind, cjk_midword_boundary, ends_dangling, free_seam,
    is_objective_blocking, lint_pieces, reanchor_texts, repair_flash_pieces_with_ranges,
    repair_lint_pieces, source_boundary_strength,
};
use crate::sentence::{Sentence, derive_sentences};
use crate::split::{
    TransCue, TransParams, align_entry_valid_for_lang, exceeds_one_line_fit, primary_subtag,
    reordered_rewrite_exceeds, split_independent_for_lang_protected, target_cps_chars,
    target_required_seconds,
};

/// LLM 块对齐 + 确定性锚点合并后的来源标识（写入 `TransAlign.aligner`）。
pub const LLM_CHUNK_ALIGNER_TAG: &str = "llm-chunk+anchor/1";
/// translate 融合**行分区**草稿直落条目的来源标识：模型给的显示行边界被冻结
/// 成块边界（块与片一一对应），源词区间与时间分配仍由确定性核算出。
pub const LLM_ROWS_ALIGNER_TAG: &str = "llm-rows+anchor/1";
/// translate 行文本载体（`lines/1`）草稿直落条目的来源标识：块由首尾源词
/// 引用联合定位成源区间证据，再与确定性锚点一起进块核。
pub const LLM_LINES_ALIGNER_TAG: &str = "llm-lines+anchor/1";
/// 行文本草稿的切点都放行、某块仍超 hard、在块内按 lint 干净的目标缝再切
/// 一刀落成的条目（[`crate::align_block::plan_sentence_splitting_over_hard`]）：
/// 被切的块内源时间按比例，其余块仍是模型证据。单独成一个标识，统计时不与
/// 全证据条目混在一起。
pub const LLM_LINES_SPLIT_ALIGNER_TAG: &str = "llm-lines+split/1";
/// 表格载体（`align-table/1`）条目的来源标识。
pub const TABLE_ALIGNER_TAG: &str = "llm-table/1";
/// 单调化显示改写写入 `transDisplay.basis` 的标识。
pub const MONOTONIC_REWRITE_BASIS: &str = "monotonic-rewrite";
/// 表格载体 `data-reordered` 改写写入 `transDisplay.basis` 的标识。
pub const TABLE_REORDER_BASIS: &str = "table-reorder";

/// 所有首轮批次共享的修复调用预算。失败句聚合后只重发一次，仍不合格则使用
/// 已验证的确定性草稿，避免单个顽固句拖出无界调用链。
const GLOBAL_REPAIR_CALLS: usize = 1;
/// Agent/provider 对齐页的句数硬上限。源文词数无法表达逐句语义切分成本：
/// fCHe 基准只有 1567 源文词，却在一页中承载 55 个 HTML 分组并让单 worker
/// 工作 8 分钟以上。40 句上限让这类短词数/高句数页面自然拆成两页并行，
/// 同时保留足够的跨句语境。
const ALIGN_MAX_ITEMS_PER_PAGE: usize = 40;
/// 对齐载体的估算复杂度预算。不同于 `page_budget` 的源文词数，它近似 HTML
/// 输入体积、目标语切分量、术语/锚点约束和建议片数；两者取更严格的页数。
/// 预算只决定页形，不参与验收语义。
const ALIGN_PAGE_COMPLEXITY_BUDGET: usize = 16_000;
/// 片间宽度均衡容差（阅读单位）：超出且最宽片仍有内部小句缝时回炉重切。
const BALANCE_SPREAD: usize = 8;
/// 译文整句上屏的停留时长护栏（秒）。译句一行放得下时不再因为源语长就强制
/// 拆分（多对一是默认形态：几条短源短语共享一条译文）；只有整句时窗长到
/// 单条字幕会"钉"在屏幕上时才入队请 LLM 切分。
pub(crate) const LONG_DWELL_SECONDS: f64 = 7.0;
/// 一条译文行覆盖多条源字幕时，达到该驻留时长即视为黏结。
pub const ROW_DEFICIT_DWELL_SECONDS: f64 = 5.0;
/// 整句对应至少覆盖这么多源行时，即使未达到驻留阈值也进入复核。
pub const ROW_DEFICIT_SENTENCE_SOURCE_ROWS: usize = 3;
/// 源 Cue 段"碎渣"合并阈值（词）：短于它的段并入邻段后才算作一条用户可见的
/// 源行。[`source_cue_runs`] + [`merge_short_runs`] 的唯一调用口径，三个产品
/// 表面的 `mergeShortRuns` 镜像必须用同一个数。
pub const ROW_RUN_MERGE_MIN_WORDS: usize = 3;
/// 片级时间预算 advisory 的触发缺口（秒）：某片所需阅读时长超出其源语音
/// 时窗这么多、且相邻片有等量富余时，提示移界。
const TIME_DEFICIT_SECONDS: f64 = 1.0;
/// 双语成对审阅中，一条源语跨度超过这一时长、且对应目标片自身已有完整
/// 小句/并列动作缝时，要求沿目标语自然缝再拆。源语长本身仍不制造目标切点。
pub(crate) const PAIRED_SOURCE_MAX_SECONDS: f64 = 4.0;
/// 双语成对审阅的源行硬上限（秒）。软档要求目标片自身已有自然缝；硬档针对
/// 的是"源行长到读不完、而目标片一条缝都没有"的形态——那类行必须退而求其次
/// 在次优边界切开。
pub(crate) const PAIRED_SOURCE_HARD_SECONDS: f64 = 6.0;
/// 硬档只在目标片本身还有足够阅读体量时触发：目标片短于这个阅读单位数时，
/// 再切只会产出闪现碎行，宁可让源行长。
const PAIRED_TARGET_MIN_UNITS: usize = 10;
/// 硬档要求源行至少这么多词，才存在"次优边界"可言；3 词以内的源行没有
/// 可用切点。
const PAIRED_MIN_SOURCE_WORDS: usize = 4;
/// 退化配对行：源区间词数下限。低于这个词数、又挂着足够宽的译文片时，逐字
/// 高亮会停在一两个源词上而字幕整行推进（R2 基准 `s-g29.0` 的 `have` 1 词挂
/// 9u 中文）。
///
/// 刻意**不**复用 `PAIRED_MIN_SOURCE_WORDS = 4`：那是 `source_ceiling_issues`
/// 的**抑制**阈值（源行再宽也不报），且已以 `paired_min_words` 出现在契约文本
/// 里；这里是**拒绝**阈值。两个数字含义相反，不得合并。
const DEGENERATE_MIN_SOURCE_WORDS: usize = 3;
/// 退化配对行：目标片宽度下限。窄译文片配少量源词是正常的多对一形态。
const DEGENERATE_TARGET_MIN_UNITS: usize = 8;
/// 碎片配对行：源侧词数上限。只挂到这么多（含）源词的片，才可能是"碎渣"。
///
/// 与上面两个阈值同样**不得**合并：`PAIRED_MIN_SOURCE_WORDS` 是源行**过宽**
/// 通道的抑制阈值，`DEGENERATE_MIN_SOURCE_WORDS` 是"窄源配宽译"的拒绝阈值，
/// 这里是源行**过窄**通道的触发阈值。三者分属三个象限。
const FRAGMENT_MAX_SOURCE_WORDS: usize = 2;
/// 碎片配对行：整句规模门槛。整句源词数不足 `片数 × 该值` 时不报——句子本身
/// 就没有足够的词让每片都达到最小宽度，再报只会把不可满足的要求打回 worker。
/// 与 `degenerate_paired_row` 用同一条算术豁免。
const FRAGMENT_MIN_SENTENCE_WORDS: usize = 3;

/// 连续相同源 Cue 归属形成一段；找不到 Cue 的词并入前一段，保持单调降级。
pub fn source_cue_runs(
    words: &[&Word],
    cue_id_by_word: &BTreeMap<String, String>,
) -> Vec<std::ops::Range<usize>> {
    source_cue_runs_by(words.iter().map(|word| word.id.as_str()), |id| {
        cue_id_by_word.get(id).map(String::as_str)
    })
}

/// [`source_cue_runs`] 的同一条规则，只认词 id 与一个归属查询。手上只有 id、
/// 或归属表是借用索引的调用方（编辑器的整稿派生）走这里，不必为每句造一批词、
/// 也不必把整张词表的 id 拷进一棵有序树。
pub fn source_cue_runs_by<'a, K: PartialEq>(
    word_ids: impl IntoIterator<Item = &'a str>,
    cue_of: impl Fn(&str) -> Option<K>,
) -> Vec<std::ops::Range<usize>> {
    source_cue_runs_by_keys(word_ids.into_iter().map(cue_of))
}

/// [`source_cue_runs`] 的同一条规则，直接吃逐词的源 Cue 归属（`None` = 找不到
/// Cue，并入前一段）。双语 DP 只拿得到句内词序，走这里。
pub fn source_cue_runs_by_keys<K: PartialEq>(
    keys: impl IntoIterator<Item = Option<K>>,
) -> Vec<std::ops::Range<usize>> {
    let mut runs: Vec<std::ops::Range<usize>> = Vec::new();
    let mut run_cue: Option<K> = None;
    for (index, cue) in keys.into_iter().enumerate() {
        if runs.is_empty() {
            runs.push(index..index + 1);
            run_cue = cue;
        } else if cue.is_none() || cue == run_cue {
            let start = runs.last().expect("non-empty").start;
            *runs.last_mut().expect("non-empty") = start..index + 1;
        } else {
            runs.push(index..index + 1);
            run_cue = cue;
        }
    }
    runs
}

/// 吸收短于 `min_words` 的孤儿源 Cue 段。首段向后、尾段向前、中段并入
/// 更短邻段（平局向前）；合并后原位复查，因此会级联合并。
pub fn merge_short_runs(
    mut runs: Vec<std::ops::Range<usize>>,
    min_words: usize,
) -> Vec<std::ops::Range<usize>> {
    if runs.len() <= 1 {
        return runs;
    }
    let mut index = 0;
    while runs.len() > 1 && index < runs.len() {
        if runs[index].len() >= min_words {
            index += 1;
            continue;
        }
        let target = if index == 0 {
            1
        } else if index + 1 == runs.len() || runs[index - 1].len() <= runs[index + 1].len() {
            index - 1
        } else {
            index + 1
        };
        let keep = index.min(target);
        let drop = index.max(target);
        runs[keep] = runs[keep].start..runs[drop].end;
        runs.remove(drop);
        index = keep;
    }
    runs
}

/// 句内词序闭区间 `[from, to]` 覆盖的用户可见源行数：与 [`row_deficit_stats`]
/// 逐 cue 计 `covered_rows` 同一口径（区间内重新成段、再吸收碎段）。`keys`
/// 是句内每个词的源 Cue 归属；区间越界返回 0。
pub fn covered_source_rows<K: PartialEq>(keys: &[Option<K>], from: usize, to: usize) -> usize {
    if from > to {
        return 0;
    }
    let Some(slice) = keys.get(from..=to) else {
        return 0;
    };
    merge_short_runs(
        source_cue_runs_by_keys(slice.iter().map(Option::as_ref)),
        ROW_RUN_MERGE_MIN_WORDS,
    )
    .len()
}

/// `align-row-deficit` 的驻留谓词：一条译文行驻留 ≥
/// [`ROW_DEFICIT_DWELL_SECONDS`] 且覆盖 ≥2 条源行。check 的判据与对齐引擎的
/// 行规划 / paired 验收共用这一处，不各自复制阈值。
pub fn row_dwell_deficit(dwell_sec: f64, covered_rows: usize) -> bool {
    dwell_sec >= ROW_DEFICIT_DWELL_SECONDS && covered_rows >= 2
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RowDeficitReason {
    Dwell,
    SentenceLevel,
}

/// 每句的源/译行驻留统计；`reason == Some` 即命中 `align-row-deficit`。
#[derive(Debug, Clone, PartialEq)]
pub struct RowDeficitStats {
    pub sentence: String,
    pub source_rows: usize,
    pub trans_cues: usize,
    pub max_dwell_sec: f64,
    pub target_units: usize,
    pub reason: Option<RowDeficitReason>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowDeficitIssue {
    pub sentence: String,
    pub key: String,
    pub source_rows: usize,
    pub trans_cues: usize,
    pub max_dwell_sec: f64,
    pub target_units: usize,
    pub reason: RowDeficitReason,
}

fn source_rows_for_indices(
    doc: &TranscriptDoc,
    indices: &[usize],
    cue_ids_by_index: &BTreeMap<usize, String>,
) -> usize {
    let words = indices
        .iter()
        .map(|&index| &doc.words[index])
        .collect::<Vec<_>>();
    let by_id = indices
        .iter()
        .filter_map(|&index| {
            cue_ids_by_index
                .get(&index)
                .map(|cue| (doc.words[index].id.clone(), cue.clone()))
        })
        .collect::<BTreeMap<_, _>>();
    merge_short_runs(source_cue_runs(&words, &by_id), ROW_RUN_MERGE_MIN_WORDS).len()
}

/// 计算全部已翻译句的源/译行驻留统计。源行段规则与三产品表面的
/// `mergeShortRuns` 镜像逐条一致；阈值只在本模块存在。
pub fn row_deficit_stats(
    doc: &TranscriptDoc,
    sentences: &[Sentence],
    lang: &str,
    source_cues: &[Cue],
    trans_cues: &[TransCue],
) -> Vec<RowDeficitStats> {
    let cue_ids_by_index = source_cues
        .iter()
        .flat_map(|cue| {
            cue.word_indices
                .iter()
                .copied()
                .map(|word_index| (word_index, cue.id.clone()))
        })
        .collect::<BTreeMap<_, _>>();
    let alignments = doc.trans_align.get(lang);
    sentences
        .iter()
        .filter(|sentence| {
            // 与 `align_sentences` 同口径：空/纯空白译文在对齐侧是显式跳过的
            // （"empty translation — skipped"），判据也不能把它算成已翻译句，
            // 否则会对一句根本没有译文的句子报黏结。
            doc.trans
                .get(lang)
                .and_then(|table| table.get(&sentence.id))
                .is_some_and(|text| !text.trim().is_empty())
        })
        .map(|sentence| {
            let sentence_cues = trans_cues
                .iter()
                .filter(|cue| cue.sentence_id == sentence.id)
                .collect::<Vec<_>>();
            let source_rows =
                source_rows_for_indices(doc, &sentence.word_indices, &cue_ids_by_index);
            let trans_count = sentence_cues.len();
            let stale = sentence_cues.iter().any(|cue| cue.fallback);
            let entry = alignments
                .and_then(|table| table.get(&sentence.id))
                .filter(|entry| align_entry_valid_for_lang(doc, sentence, lang, entry));
            let independent = entry.is_some_and(|entry| entry.mode == AlignMode::Independent);
            let sentence_level = entry.is_some_and(|entry| {
                entry.mode == AlignMode::ManyToOne
                    && entry.correspondence() == Correspondence::Sentence
            });
            let mut max_dwell_sec = 0.0_f64;
            let mut target_units = 0usize;
            let mut dwell_deficit = false;
            for cue in &sentence_cues {
                let dwell = (cue.end - cue.start).max(0.0);
                if dwell >= max_dwell_sec {
                    max_dwell_sec = dwell;
                    target_units = crate::split::piece_display_units(&cue.text, lang);
                }
                let covered_rows = if independent {
                    0
                } else if let Some((from, to)) = cue.word_span {
                    sentence
                        .word_indices
                        .get(from..=to)
                        .map(|indices| source_rows_for_indices(doc, indices, &cue_ids_by_index))
                        .unwrap_or(0)
                } else {
                    source_rows
                };
                dwell_deficit |= row_dwell_deficit(dwell, covered_rows);
            }
            let deficit_shape = source_rows >= 2 && trans_count < source_rows;
            let reason = if stale || independent || !deficit_shape {
                None
            } else if dwell_deficit {
                Some(RowDeficitReason::Dwell)
            } else if sentence_level && source_rows >= ROW_DEFICIT_SENTENCE_SOURCE_ROWS {
                Some(RowDeficitReason::SentenceLevel)
            } else {
                None
            };
            RowDeficitStats {
                sentence: sentence.id.clone(),
                source_rows,
                trans_cues: trans_count,
                max_dwell_sec,
                target_units,
                reason,
            }
        })
        .collect()
}

/// `align-row-deficit` 的唯一谓词入口。
pub fn row_deficit_issues(
    doc: &TranscriptDoc,
    sentences: &[Sentence],
    lang: &str,
    source_cues: &[Cue],
    trans_cues: &[TransCue],
) -> Vec<RowDeficitIssue> {
    row_deficit_stats(doc, sentences, lang, source_cues, trans_cues)
        .into_iter()
        .filter_map(|stats| {
            let reason = stats.reason?;
            Some(RowDeficitIssue {
                key: stats.sentence.clone(),
                sentence: stats.sentence,
                source_rows: stats.source_rows,
                trans_cues: stats.trans_cues,
                max_dwell_sec: stats.max_dwell_sec,
                target_units: stats.target_units,
                reason,
            })
        })
        .collect()
}

/// paired 结果的纯算术最小片数：既不超过用户实际看到的源行数，也不要求
/// 一条短译文被切成不可读碎片；入选句至少尝试两片。
pub fn paired_min_piece_count(source_rows: usize, target_units: usize) -> usize {
    source_rows.min(2usize.max(target_units.div_ceil(crate::align_block::ROW_MIN_UNITS)))
}

/// 一个 paired 候选句的片数要求，连同算出它的两个度量一起留着——被拒时要能
/// 回答「这句是切不动，还是压根没那么多字可切」。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PairedRequirement {
    pub source_rows: usize,
    pub target_units: usize,
    pub required: usize,
}

impl PairedRequirement {
    fn new(source_rows: usize, target_units: usize) -> Self {
        Self {
            source_rows,
            target_units,
            required: paired_min_piece_count(source_rows, target_units),
        }
    }

    fn rejection(
        &self,
        sentence: &str,
        reason: &'static str,
        delivered: usize,
    ) -> RowRepairRejection {
        let units_per_row = if self.source_rows == 0 {
            0.0
        } else {
            (self.target_units as f64 / self.source_rows as f64 * 100.0).round() / 100.0
        };
        RowRepairRejection {
            sentence: sentence.to_owned(),
            reason,
            source_rows: self.source_rows,
            target_units: self.target_units,
            required: self.required,
            delivered,
            units_per_row,
        }
    }
}

/// 一句译文行的驻留形态，按 `align-row-deficit` 同一谓词算出。paired 验收
/// 用它比较「新切法」与「原状」：消除黏结即接受；仍黏结但严格更好也接受。
#[derive(Debug, Clone, Copy, PartialEq)]
struct DwellShape {
    /// 命中 `align-row-deficit`（片数少于源行数，且有黏结行）。
    deficit: bool,
    /// 黏结行条数。
    offending: usize,
    /// 黏结行里最长的驻留（秒）；无黏结行时 0。
    worst_dwell: f64,
    /// 黏结行里覆盖最多的源行数；无黏结行时 0。
    worst_rows: usize,
}

impl DwellShape {
    /// `pieces` 是句内词序闭区间（相对 `anchor_indices`）；`sentence_level` =
    /// 整句对应条目（源行 ≥3 时即使驻留不足也算黏结，与 check 同口径）。
    fn of(
        doc: &TranscriptDoc,
        anchor_indices: &[usize],
        keys: &[Option<String>],
        pieces: &[(usize, usize)],
        sentence_level: bool,
    ) -> Self {
        let source_rows = match anchor_indices.len() {
            0 => 0,
            n => covered_source_rows(keys, 0, n - 1),
        };
        let mut shape = Self {
            deficit: false,
            offending: 0,
            worst_dwell: 0.0,
            worst_rows: 0,
        };
        for &(from, to) in pieces {
            let (Some(&first), Some(&last)) = (anchor_indices.get(from), anchor_indices.get(to))
            else {
                continue;
            };
            let dwell = (doc.words[last].t1 - doc.words[first].t0).max(0.0);
            let rows = covered_source_rows(keys, from, to);
            let offending = row_dwell_deficit(dwell, rows)
                || (sentence_level && rows >= ROW_DEFICIT_SENTENCE_SOURCE_ROWS);
            if offending {
                shape.offending += 1;
                shape.worst_dwell = shape.worst_dwell.max(dwell);
                shape.worst_rows = shape.worst_rows.max(rows);
            }
        }
        shape.deficit = source_rows >= 2 && pieces.len() < source_rows && shape.offending > 0;
        if !shape.deficit {
            shape.offending = 0;
            shape.worst_dwell = 0.0;
            shape.worst_rows = 0;
        }
        shape
    }

    fn of_entry(
        doc: &TranscriptDoc,
        anchor_indices: &[usize],
        keys: &[Option<String>],
        entry: &TransAlign,
    ) -> Self {
        let whole = [(0, anchor_indices.len().saturating_sub(1))];
        if entry.mode != AlignMode::ManyToOne {
            return Self::of(doc, anchor_indices, keys, &whole, false);
        }
        let pieces: Vec<(usize, usize)> = entry
            .pieces
            .iter()
            .filter_map(|piece| Some((piece.from?, piece.to?)))
            .collect();
        Self::of(
            doc,
            anchor_indices,
            keys,
            &pieces,
            entry.correspondence() == Correspondence::Sentence,
        )
    }

    /// 每一项都不比 `before` 差。
    fn not_worse_than(&self, before: &Self) -> bool {
        self.offending <= before.offending
            && self.worst_rows <= before.worst_rows
            && self.worst_dwell <= before.worst_dwell + 1e-6
    }

    /// 不比 `before` 差，且黏结行更少 / 驻留更短 / 覆盖源行更少至少一项严格
    /// 改善。
    fn strictly_better_than(&self, before: &Self) -> bool {
        self.not_worse_than(before)
            && (self.offending < before.offending
                || self.worst_rows < before.worst_rows
                || self.worst_dwell < before.worst_dwell - 1e-6)
    }
}

/// paired 候选句在本轮开始时的驻留基线。
struct PairedBaseline {
    anchor_indices: Vec<usize>,
    source_cue_keys: Vec<Option<String>>,
    before: DwellShape,
    /// 原条目缺失或已失效（例如译文已改）：保留原状只会留下一条整句兜底
    /// cue，所以新结果只要不更差就接受。
    stale: bool,
    /// 原条目的 `aligner`（有效条目才记）。paired 是「请模型重切」：修复调用
    /// 没拿到可用答案时落下的模型缺席切法（`deterministic/1` 等宽切、`anchor/1`
    /// 纯锚点）不得顶掉模型给过的对齐，见 [`model_backed_aligner`]。
    previous_aligner: Option<String>,
}

/// `aligner` 标签是否出自模型答案（`llm-*`）。`deterministic/1`、`anchor/1`
/// 与没有标签的旧条目都算模型缺席。
fn model_backed_aligner(aligner: Option<&str>) -> bool {
    aligner.is_some_and(|tag| tag.starts_with("llm-"))
}

fn paired_prompt_instructions(
    base: Option<&str>,
    requirements: &BTreeMap<String, PairedRequirement>,
) -> Option<String> {
    if requirements.is_empty() {
        return base.map(str::to_owned);
    }
    let mut parts = base
        .filter(|text| !text.trim().is_empty())
        .map(|text| vec![text.trim().to_owned()])
        .unwrap_or_default();
    let rows = requirements
        .iter()
        .map(|(id, requirement)| format!("{id}: aim for about {} blocks", requirement.required))
        .collect::<Vec<_>>()
        .join("; ");
    // 载体是块对齐边（`align-edges/1`）：模型标的是**块**，显示行数由确定性
    // DP 决定，模型控制不了。因此这里只能对块粒度提要求——"至少 N 条目标行"
    // 是模型照做不了的指令。
    parts.push(format!(
        "Paired row repair applies ONLY to these sentences ({rows}). For each of them, annotate MORE and FINER alignment blocks: walk the adjacent source ranges in order and give each one its own block whenever the translation has a matching stretch, instead of collapsing the whole sentence into a single block. Short blocks are fine — the engine decides the final row count and merges anything that would read too fast. The block counts above are guidance, not a quota: the result is accepted once no translation row would stay on screen for {dwell} seconds or more while spanning two or more source rows. Keep the translation text exactly as it is: never rewrite, retranslate, reorder or drop any of it; you are only marking where the existing translation lines up with the source.",
        dwell = ROW_DEFICIT_DWELL_SECONDS,
    ));
    Some(parts.join("\n\n"))
}

/// 在片文本内部找一个两侧都不产生闪片的小句缝，返回缝左侧收尾片段作提示。
fn internal_clause_seam(text: &str, lang: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    for (index, ch) in chars.iter().enumerate() {
        // 顿号通常连接一个不可拆的并列结构（“说服、取胜”）；不能仅为
        // 数字均衡把它当作可安全重切的证据。破折号（——）是合法小句缝：
        // G1 验证中 "完全属于你——这意味着…" 因缺它漏过 fit 一轮到位。
        if !matches!(ch, '，' | '；' | '：' | '—' | ',' | ';' | ':') {
            continue;
        }
        // 连续破折号（——）取最后一个 — 之后作缝，不切在两个破折号中间。
        if *ch == '—' && chars.get(index + 1) == Some(&'—') {
            continue;
        }
        let left: String = chars[..=index].iter().collect();
        let right: String = chars[index + 1..].iter().collect();
        if crate::split::piece_display_units(&left, lang) >= 4
            && crate::split::piece_display_units(&right, lang) >= 4
        {
            let tail_start = index.saturating_sub(5);
            return Some(chars[tail_start..=index].iter().collect());
        }
    }
    None
}

#[derive(Debug, Clone)]
pub struct AlignOptions {
    /// 目标语言（`doc.trans` / `doc.transAlign` 的键）。
    pub lang: String,
    pub mode: AlignMode,
    /// 阈值覆盖；`None` 按目标语言派生（[`TransParams::for_lang`]）。
    pub params: Option<TransParams>,
    /// `Some` 时只处理指定句（`--align-only --sentences …`）。
    pub sentences: Option<BTreeSet<String>>,
    /// 用户定向重切（`--sentences` 显式点名）。保留为审计工件的运行模式；
    /// 首轮与定点修复现在共用同一三重约束分页算法和预算。
    pub targeted: bool,
    /// 已有有效条目也重切。
    pub force: bool,
    /// 显式用户指令，附加在 align 契约末尾。定向 refine 的关键通道：check
    /// 只描述"哪些句"，这里描述"为什么/怎么切"（G3 基线实测该通道缺失时
    /// worker 会原样保留语病切分）。
    pub instructions: Option<String>,
    /// 可逐字上屏且不得从中间切开的 glossary target。
    pub protected_terms: Vec<String>,
    /// 双语 glossary 语义锚。当 source/target 在本句各唯一命中时，
    /// 它们必须落在同一个配对片；这与 protected_terms 的“不能切词内”
    /// 是两个独立不变量。
    pub bilingual_anchors: Vec<BilingualAnchor>,
    /// 执行侧并发槽数（agent worker 数 / provider 泳道数）。保留给宿主规划
    /// worker；分页看源文词数、句数与确定性载体复杂度，不随槽数改变。
    pub worker_slots: Option<usize>,
    /// 页预算的源文词数维度（口径见 [`word_count`]）：首轮、`--sentences`
    /// 定点修复与全局修复轮共用；引擎同时施加 40 项硬上限与确定性复杂度预算，
    /// 但不按 worker 槽位改变页形。宿主按执行器取
    /// [`crate::paging::PageExecutor::align_words`]。
    pub page_budget: usize,
    /// 本次引擎调用可消费的全局修复轮数。普通 translate/align 使用 1；auto
    /// 收尾 refine 使用 0，因为主对齐已经拥有全阶段唯一的修复预算，不能让每
    /// 个 `align-only` 子调用重新获得一轮。
    pub repair_calls: usize,
    /// manyToOne 的 LLM 载体（缺省块对齐边）。
    pub carrier: AlignCarrier,
    /// 展示行密度；缺省 `Auto` 完全保持既有多对一行为。
    pub density: AlignDensity,
    /// `density == Paired` 时，仅对这些句应用 paired；为空表示作用于本轮
    /// 全部定向句。供 `refine-align` 在混合热点批次中只修黏结句。
    pub density_sentences: BTreeSet<String>,
}

impl Default for AlignOptions {
    /// `lang` 与 `mode` 没有有意义的缺省——调用方必须显式给。其余字段就是
    /// 今天的生产缺省，因此 `..AlignOptions::default()` 可以安全地补齐新增字段。
    fn default() -> Self {
        Self {
            lang: String::new(),
            mode: AlignMode::ManyToOne,
            params: None,
            sentences: None,
            targeted: false,
            force: false,
            instructions: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            worker_slots: None,
            page_budget: crate::paging::budgets::ALIGN_PROVIDER_WORDS,
            repair_calls: GLOBAL_REPAIR_CALLS,
            carrier: AlignCarrier::default(),
            density: AlignDensity::Auto,
            density_sentences: BTreeSet::new(),
        }
    }
}

impl AlignOptions {
    fn density_for(&self, sentence_id: &str) -> AlignDensity {
        if self.density == AlignDensity::Paired
            && (self.density_sentences.is_empty() || self.density_sentences.contains(sentence_id))
        {
            AlignDensity::Paired
        } else {
            AlignDensity::Auto
        }
    }
}

/// manyToOne 的 LLM 对齐载体（对齐块设计 §6）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AlignCarrier {
    /// 块对齐边：`align-edges/1` + `align-rewrite/1`（缺省）。
    #[default]
    Edges,
    /// 两列切分表 `align-table/1`：审阅与定向修复载体。
    Table,
}

impl AlignCarrier {
    /// CLI 值（`edges` / `table`）。
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "edges" | "edge" | "align-edges" => Some(Self::Edges),
            "table" | "align-table" => Some(Self::Table),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Edges => "edges",
            Self::Table => "table",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BilingualAnchor {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AlignOutcome {
    /// 本次写入 `transAlign` 的句数。
    pub aligned_sentences: usize,
    /// 其中未消耗任何 align LLM 调用就落库的句数：translate 融合草稿直接验收。
    pub prealigned_sentences: usize,
    /// 无需条目或已有有效条目而跳过的句数。
    pub skipped_sentences: usize,
    /// manyToOne 全局修复预算耗尽后按目标语确定性切分 + 源词比例锚定兜底的句数。
    pub fallback_sentences: usize,
    /// 已弃用的兼容字段；长句统一经过批量 LLM，因此恒为 0。
    pub local_sentences: usize,
    /// 经单调化显示改写（`transDisplay`，`text_basis: display`）落库的句数。
    pub rewritten_sentences: usize,
    /// 降级为整句对应（`correspondence: sentence`）的句数。
    pub sentence_level_sentences: usize,
    /// rows 直通路径上被确定性后处理合并掉的显示行数（见
    /// [`crate::align_block::merge_short_rows`] 的判据）。模型实测基本按源侧
    /// 分组一对一切行，这个数就是引擎替它收口的量。
    pub rows_merged: usize,
    /// paired 二次校正记账。
    pub row_repair: RowRepairOutcome,
    /// advisory 违例，不阻塞。
    pub violations: Vec<String>,
}

impl Default for AlignOutcome {
    fn default() -> Self {
        Self {
            aligned_sentences: 0,
            prealigned_sentences: 0,
            skipped_sentences: 0,
            fallback_sentences: 0,
            local_sentences: 0,
            rewritten_sentences: 0,
            sentence_level_sentences: 0,
            rows_merged: 0,
            row_repair: RowRepairOutcome::default(),
            violations: Vec::new(),
        }
    }
}

/// 单轮 `--json` 里最多逐句展开多少个被拒句。定向轮的句集由调用方给定，
/// 可以很长；JSONL 一行不能随句数无界增长，超出的只记条数。
pub const ROW_REPAIR_REJECTION_DETAILS: usize = 40;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowRepairOutcome {
    pub candidates: usize,
    pub repaired: usize,
    pub rejected: usize,
    pub capped: usize,
    /// 被拒句的逐句明细，最多 [`ROW_REPAIR_REJECTION_DETAILS`] 条。只有计数时
    /// 「38 候选 → 38 拒 → 0 修」无从判断是验收式过严还是这批句在目标语下本就
    /// 切不出那么多片；把算出下限的两个度量一并写下来才能事后定责。
    pub rejections: Vec<RowRepairRejection>,
    /// 因上限被省略的被拒句数（`rejections` 之外的部分）。
    pub rejections_truncated: usize,
}

/// 一条 paired 补行轮的拒绝明细。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowRepairRejection {
    pub sentence: String,
    /// 闭集：`no-write`（本轮没产出写入）| `rewritten-basis`（结果基于改写后的
    /// `transDisplay`）| `model-free`（修复调用没拿到可用答案，预算尾巴的模型
    /// 缺席切法要顶掉的是模型给过的对齐）| `not-improved`（新切法仍命中
    /// `align-row-deficit` 的驻留谓词，且没有比原状严格更好）。
    pub reason: &'static str,
    /// 该句当前占用的源字幕行数。
    pub source_rows: usize,
    /// 译文的显示单位数（中日韩按全角计）。
    pub target_units: usize,
    /// 契约提示里建议的片数，见 [`paired_min_piece_count`]。只是指导语：验收
    /// 看驻留谓词，不看片数。
    pub required: usize,
    /// 本轮实际交付的片数；没有产出写入时是 0。
    pub delivered: usize,
    /// `targetUnits / sourceRows`，两位小数。明显低于
    /// [`crate::align_block::ROW_MIN_UNITS`] 时说明译文根本没有足够字数铺满源行，
    /// 这类句无论提示怎么写都修不出行来。
    pub units_per_row: f64,
}

/// 一条 `transAlign` 写入记在哪些计数器上。写入与记账必须成对发生
/// （[`push_write`] 是唯一入口），否则丢弃写入时无法知道该退哪个计数器——
/// 早期版本无条件 `aligned_sentences -= rejected`，会偷走别的句的计数。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WriteCredit {
    /// 常规落库：只记 `aligned_sentences`。
    Aligned,
    /// 融合草稿直落：`aligned_sentences` + `prealigned_sentences`。
    Prealigned,
    /// 单调化显示改写：`aligned_sentences` + `rewritten_sentences`。
    Rewritten,
    /// 降级整句对应：`aligned_sentences` + `sentence_level_sentences`。
    SentenceLevel,
    /// 修复预算耗尽后的确定性兜底：只记 `fallback_sentences`。
    Fallback,
}

impl WriteCredit {
    fn apply(self, outcome: &mut AlignOutcome) {
        match self {
            Self::Aligned => outcome.aligned_sentences += 1,
            Self::Prealigned => {
                outcome.aligned_sentences += 1;
                outcome.prealigned_sentences += 1;
            }
            Self::Rewritten => {
                outcome.aligned_sentences += 1;
                outcome.rewritten_sentences += 1;
            }
            Self::SentenceLevel => {
                outcome.aligned_sentences += 1;
                outcome.sentence_level_sentences += 1;
            }
            Self::Fallback => outcome.fallback_sentences += 1,
        }
    }

    /// 丢弃一条写入时退回它自己加过的计数。`saturating_sub` 只是防御：
    /// 每条 revert 都对应一次 [`WriteCredit::apply`]，计数器不会为负。
    fn revert(self, outcome: &mut AlignOutcome) {
        match self {
            Self::Aligned => {
                outcome.aligned_sentences = outcome.aligned_sentences.saturating_sub(1)
            }
            Self::Prealigned => {
                outcome.aligned_sentences = outcome.aligned_sentences.saturating_sub(1);
                outcome.prealigned_sentences = outcome.prealigned_sentences.saturating_sub(1);
            }
            Self::Rewritten => {
                outcome.aligned_sentences = outcome.aligned_sentences.saturating_sub(1);
                outcome.rewritten_sentences = outcome.rewritten_sentences.saturating_sub(1);
            }
            Self::SentenceLevel => {
                outcome.aligned_sentences = outcome.aligned_sentences.saturating_sub(1);
                outcome.sentence_level_sentences =
                    outcome.sentence_level_sentences.saturating_sub(1);
            }
            Self::Fallback => {
                outcome.fallback_sentences = outcome.fallback_sentences.saturating_sub(1)
            }
        }
    }
}

/// 本轮为某句产出的一条 `transAlign` 写入。同一句可能被写多次（后写覆盖
/// 先写，与 `table.insert` 的语义一致）。
#[derive(Debug, Clone)]
struct AlignWrite {
    id: String,
    entry: TransAlign,
    credit: WriteCredit,
}

/// 写入 + 记账的唯一入口。
fn push_write(
    writes: &mut Vec<AlignWrite>,
    outcome: &mut AlignOutcome,
    id: String,
    entry: TransAlign,
    credit: WriteCredit,
) {
    credit.apply(outcome);
    writes.push(AlignWrite { id, entry, credit });
}

struct Pending<'a> {
    sentence: &'a Sentence,
    /// Source word indices participating in this delivery sentence. Normally
    /// this is the complete sentence; a final-timeline route may supply an
    /// ordered visible-word subset after cuts.
    anchor_indices: Vec<usize>,
    /// 句内源词原子；文件载体直接从时间戳导出停顿提示。
    words: Vec<PendingWord>,
    translation: String,
    /// 当前已接受的 manyToOne 切分（refine / force 重切时非空）。作为载荷
    /// draft 的基准，避免重算的确定性草稿把已修好的句子退回坏切分。
    existing: Option<ExistingAlign>,
    /// 融合草稿的目标片已通过目标侧验收、但源锚失败时保留下来。后续
    /// dedicated align 只能重选源切点，不得改动这些片边界或文本。
    frozen_target: Option<Vec<String>>,
    protected_terms: Vec<String>,
    bilingual_anchors: Vec<BilingualAnchor>,
    /// 与 `anchor_indices` 逐位对应的源 Cue 归属（Cue id）。双语 DP 用它按
    /// `align-row-deficit` 同一驻留谓词判断一片是否会黏结；空 = 不知道，
    /// 谓词关闭（单元测试直接构造的 Pending）。
    source_cue_keys: Vec<Option<String>>,
}

/// 已接受切分的载荷种子：片文本 + 句内词序区间。
struct ExistingAlign {
    texts: Vec<String>,
    ranges: Vec<(usize, usize)>,
}

struct PendingWord {
    text: String,
    /// 文稿里的「贴前」标记：拼源文时与前一个词之间不加空格。
    glue: bool,
    // 文件载体从时间戳重新导出停顿提示；这个缓存档位只供单元测试里的源文
    // 渲染与边界诊断使用，不参与分页，也不进任何载体。
    #[cfg_attr(not(test), allow(dead_code))]
    pause_before: u8,
    /// 语音起止（秒）：片级时间预算（草稿秒数、时长 advisory）依赖它。
    t0: f64,
    t1: f64,
}

/// 一句锚定词的「贴前」标记；都没有时给空表。
fn source_glue(words: &[PendingWord]) -> Vec<bool> {
    if words.iter().any(|word| word.glue) {
        words.iter().map(|word| word.glue).collect()
    } else {
        Vec::new()
    }
}

impl JoinWord for PendingWord {
    fn join_text(&self) -> &str {
        &self.text
    }
    fn glued(&self) -> bool {
        self.glue
    }
}

/// translate 调用顺带产出的块对齐草稿（对齐块设计 §6.1）：译文语义块 →
/// 源词序号（0-based，与 `TransAlign.words` 同下标）。引擎把它展开成对齐边
/// 后走与 dedicated `align-edges` 完全相同的确定性块合并 / 双语 DP；任何
/// 失败只让该句回落 dedicated 调用。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FusionDraft {
    pub chunks: Vec<AlignChunk>,
    /// 草稿构成合格的**行分区**（每块序号连续递增、块间首尾相接、覆盖
    /// `1..N`）：引擎可以直接把它当显示行落库，跳过 align 调用。
    pub rows: bool,
    /// 行边界全部落在载体给出的确定性分组边界上。不满足**不影响接受**，
    /// 只用于计数观测（分组只是提示，不是硬契约）。
    pub on_groups: bool,
    /// 行文本载体（`lines/1`）的草稿：块用首尾源词引用标出对应，由引擎
    /// [`crate::filepipe::lines::evidence_with_pieces`] 联合定位。`Some` 时
    /// `chunks` 为空、`rows` 为假。
    pub lines: Option<crate::filepipe::TranslateLinesDraft>,
}

pub type FusionDrafts = BTreeMap<String, FusionDraft>;

/// 一个确定性源侧分组：句内 0-based 词序号闭区间 + 相对句首的时间窗。
///
/// 时间用**分秒**（0.1 秒）存放而不是 `f64`：载体属性只渲染一位小数，整数
/// 表示让渲染、解析与结构相等三者完全同源。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FusionGroup {
    pub from: usize,
    pub to: usize,
    /// 组起点相对句首的偏移，单位 0.1 秒。
    pub t0_ds: u32,
    /// 组终点相对句首的偏移，单位 0.1 秒。
    pub t1_ds: u32,
}

/// 翻译载体的一句融合提示。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FusionLineInfo {
    /// 句内锚定词，顺序即序号（一词一序号，与 `TransAlign.words` 同口径）。
    pub source_words: Vec<String>,
    /// 与 `source_words` 同下标的「贴前」标记；空 = 都没有。
    pub source_glue: Vec<bool>,
    pub needs_split: bool,
    /// 确定性源侧分组（rows 模式才渲染）。空表示不带分组提示。
    pub groups: Vec<FusionGroup>,
}

/// 分组再切的时长上限（秒）。
const FUSION_GROUP_MAX_SECONDS: f64 = 5.0;
/// 分组再切的词数上限。
const FUSION_GROUP_MAX_WORDS: usize = 14;
/// 小组并入相邻组的门槛（词数）。
const FUSION_GROUP_MIN_WORDS: usize = 3;
/// 小组并入相邻组的门槛（秒）。
const FUSION_GROUP_MIN_SECONDS: f64 = 0.8;
/// 分组切点的最小词间静音（秒）。
const FUSION_GROUP_GAP_SEC: f64 = 0.35;

/// 词尾从句标点：切在该词之后是一个自然的源侧分组缝。
fn ends_group_punctuation(text: &str) -> bool {
    matches!(
        text.trim_end().chars().last(),
        Some(',' | ';' | ':' | '—' | '–' | '，' | '；' | '：' | '、' | '…')
    )
}

/// 确定性源侧分组（rows 模式的载体提示）。零 LLM、零随机：
///
/// - 种子边界优先复用**源侧已有的行切分**（`seeds` 即句内源字幕 Cue 的起始
///   词序，由 [`crate::cue::derive_cues`] 从 `breaks`/`autoBreaks` 派生）；
/// - 再补两条本地规则：前一词以从句标点收尾、或词间静音 ≥
///   [`FUSION_GROUP_GAP_SEC`]；
/// - 小组（< [`FUSION_GROUP_MIN_WORDS`] 词且 < [`FUSION_GROUP_MIN_SECONDS`] 秒）
///   并入相邻组；
/// - 大组（> [`FUSION_GROUP_MAX_SECONDS`] 秒或 > [`FUSION_GROUP_MAX_WORDS`] 词）
///   在最大内部停顿处递归再切（两侧各留 ≥ 2 词）。
fn fusion_groups(words: &[PendingWord], seeds: &BTreeSet<usize>) -> Vec<FusionGroup> {
    if words.is_empty() {
        return Vec::new();
    }
    let mut starts: Vec<usize> = vec![0];
    for index in 1..words.len() {
        let seeded = seeds.contains(&index);
        let punctuated = ends_group_punctuation(&words[index - 1].text);
        let paused = words[index].t0 - words[index - 1].t1 >= FUSION_GROUP_GAP_SEC;
        if seeded || punctuated || paused {
            starts.push(index);
        }
    }
    let mut spans: Vec<(usize, usize)> = Vec::with_capacity(starts.len());
    for (position, &start) in starts.iter().enumerate() {
        let end = starts.get(position + 1).copied().unwrap_or(words.len()) - 1;
        spans.push((start, end));
    }

    // 小组并入：优先并入左邻，句首组并入右邻。合并只会减少组数，必然收敛。
    let small = |span: &(usize, usize)| -> bool {
        let count = span.1 - span.0 + 1;
        let seconds = words[span.1].t1 - words[span.0].t0;
        count < FUSION_GROUP_MIN_WORDS && seconds < FUSION_GROUP_MIN_SECONDS
    };
    while spans.len() > 1 {
        let Some(index) = spans.iter().position(small) else {
            break;
        };
        if index > 0 {
            spans[index - 1].1 = spans[index].1;
            spans.remove(index);
        } else {
            spans[1].0 = spans[0].0;
            spans.remove(0);
        }
    }

    // 大组再切：在最大内部停顿处切开，两侧各留 ≥ 2 词。
    let mut queue = spans;
    let mut out: Vec<(usize, usize)> = Vec::with_capacity(queue.len());
    while !queue.is_empty() {
        let span = queue.remove(0);
        let count = span.1 - span.0 + 1;
        let seconds = words[span.1].t1 - words[span.0].t0;
        let oversized = seconds > FUSION_GROUP_MAX_SECONDS || count > FUSION_GROUP_MAX_WORDS;
        let cut = (oversized && count >= 4)
            .then(|| {
                (span.0 + 2..=span.1 - 1)
                    .map(|index| (words[index].t0 - words[index - 1].t1, index))
                    .max_by(|a, b| a.0.total_cmp(&b.0).then(b.1.cmp(&a.1)))
                    .map(|(_, index)| index)
            })
            .flatten();
        match cut {
            Some(index) => {
                queue.insert(0, (index, span.1));
                queue.insert(0, (span.0, index - 1));
            }
            None => out.push(span),
        }
    }

    let origin = words[0].t0;
    let deciseconds = |value: f64| -> u32 { ((value - origin).max(0.0) * 10.0).round() as u32 };
    out.into_iter()
        .map(|(from, to)| FusionGroup {
            from,
            to,
            t0_ds: deciseconds(words[from].t0),
            t1_ds: deciseconds(words[to].t1),
        })
        .collect()
}

/// 为 translate `file-v1` 载体构造融合提示：序号词表、"源侧已需拆分"判据，
/// 以及（`with_groups` 时）确定性源侧分组。
pub fn fusion_line_info(
    doc: &TranscriptDoc,
    cues: &[crate::cue::Cue],
    sentence: &Sentence,
    with_groups: bool,
) -> FusionLineInfo {
    let words = sentence
        .word_indices
        .iter()
        .map(|&index| PendingWord {
            text: doc.words[index].text.clone(),
            glue: doc.words[index].glue,
            pause_before: 0,
            t0: doc.words[index].t0,
            t1: doc.words[index].t1,
        })
        .collect::<Vec<_>>();
    let (source_fit, _) = source_piece_budgets(&doc.lang);
    // 源侧行边界：句内每个源字幕 Cue 的首词在句内的序号。
    let seeds: BTreeSet<usize> = if with_groups {
        let position: BTreeMap<usize, usize> = sentence
            .word_indices
            .iter()
            .enumerate()
            .map(|(ordinal, &index)| (index, ordinal))
            .collect();
        sentence
            .cue_indices
            .iter()
            .filter_map(|&cue| cues.get(cue))
            .filter_map(|cue| cue.word_indices.first())
            .filter_map(|index| position.get(index).copied())
            .filter(|&ordinal| ordinal > 0)
            .collect()
    } else {
        BTreeSet::new()
    };
    FusionLineInfo {
        source_words: words.iter().map(|word| word.text.clone()).collect(),
        source_glue: source_glue(&words),
        needs_split: source_length_units(&words, &doc.lang) > source_fit
            || words_dwell_seconds(&words) > LONG_DWELL_SECONDS,
        groups: if with_groups {
            fusion_groups(&words, &seeds)
        } else {
            Vec::new()
        },
    }
}

/// 句（或其可见词子集）的语音停留时长：末词止 − 首词起。
fn words_dwell_seconds(words: &[PendingWord]) -> f64 {
    match (words.first(), words.last()) {
        (Some(first), Some(last)) => (last.t1 - first.t0).max(0.0),
        _ => 0.0,
    }
}

fn words_dwell_seconds_for_indices(doc: &TranscriptDoc, indices: &[usize]) -> f64 {
    match (indices.first(), indices.last()) {
        (Some(&first), Some(&last)) => (doc.words[last].t1 - doc.words[first].t0).max(0.0),
        _ => 0.0,
    }
}

/// 词间停顿档位：≥1.2s → 3，≥0.6s → 2，≥0.25s → 1，否则 0。
fn pause_tier(gap: f64) -> u8 {
    if gap >= 1.2 {
        3
    } else if gap >= 0.6 {
        2
    } else if gap >= 0.25 {
        1
    } else {
        0
    }
}

/// 展示切分与对齐。确定性模式零 LLM；manyToOne 走批量 pieces 协议。
pub fn run_align(
    doc: &mut TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &AlignOptions,
    sleep: &mut dyn FnMut(f64),
) -> Result<AlignOutcome, LlmError> {
    run_align_with_projection(
        doc,
        llm,
        options,
        None,
        &FusionDrafts::new(),
        &mut |_| {},
        sleep,
    )
}

/// 批级尝试（`ai/align/<lang>/vNNN/`，§4/§11）。`page_id` 是批号
/// （`b001`…；修复轮为 `r001`…）。
pub type AlignBatchAttempt<'a> = PageAttempt<'a>;

/// 同 [`run_align`]，另把批级尝试递给宿主落盘（`ai/align/<lang>/vNNN/`，§4/§11）。
pub fn run_align_with_artifacts(
    doc: &mut TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &AlignOptions,
    on_attempt: &mut dyn FnMut(&AlignBatchAttempt<'_>),
    sleep: &mut dyn FnMut(f64),
) -> Result<AlignOutcome, LlmError> {
    run_align_with_projection(
        doc,
        llm,
        options,
        None,
        &FusionDrafts::new(),
        on_attempt,
        sleep,
    )
}

/// 同 [`run_align_with_artifacts`]，但先按完全相同的验收核尝试 translate
/// 顺带给出的融合草稿；通过的句子不生成 dedicated align 调用。
pub fn run_align_with_drafts_and_artifacts(
    doc: &mut TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &AlignOptions,
    drafts: &FusionDrafts,
    on_attempt: &mut dyn FnMut(&AlignBatchAttempt<'_>),
    sleep: &mut dyn FnMut(f64),
) -> Result<AlignOutcome, LlmError> {
    run_align_with_projection(doc, llm, options, None, drafts, on_attempt, sleep)
}

/// Align translations against the ordered word subset visible in the final
/// timeline. Keys absent from `visible_words` retain normal whole-sentence
/// behavior. The persisted sentence id remains source-owned while
/// `TransAlign.words` snapshots the exact delivery anchors.
pub fn run_align_projected(
    doc: &mut TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &AlignOptions,
    visible_words: &BTreeMap<String, Vec<String>>,
    sleep: &mut dyn FnMut(f64),
) -> Result<AlignOutcome, LlmError> {
    run_align_with_projection(
        doc,
        llm,
        options,
        Some(visible_words),
        &FusionDrafts::new(),
        &mut |_| {},
        sleep,
    )
}

fn run_align_with_projection(
    doc: &mut TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &AlignOptions,
    visible_words: Option<&BTreeMap<String, Vec<String>>>,
    drafts: &FusionDrafts,
    on_attempt: &mut dyn FnMut(&AlignBatchAttempt<'_>),
    _sleep: &mut dyn FnMut(f64),
) -> Result<AlignOutcome, LlmError> {
    // translate 正常路径已在逐页落盘时格式化。align-only 也可能读取旧的、
    // 未格式化译文，因此在派生 pieces 前补同一个幂等 hook；这保证最终整句
    // 与对齐片共享完全相同的字符流。
    if let Some(table) = doc.trans.get_mut(&options.lang) {
        format_translation_map(
            table,
            &options.lang,
            options.sentences.as_ref(),
            &options.protected_terms,
        );
    }
    let cue_params = crate::layout_profile::cue_params_for_doc(doc);
    let cues = derive_cues(doc, &cue_params);
    let sentences = derive_sentences(doc, &cues);
    let cue_ids_by_index = cues
        .iter()
        .flat_map(|cue| {
            cue.word_indices
                .iter()
                .copied()
                .map(|word_index| (word_index, cue.id.clone()))
        })
        .collect::<BTreeMap<_, _>>();
    let params = options
        .params
        .unwrap_or_else(|| TransParams::for_lang(&options.lang));

    let mut outcome = AlignOutcome::default();
    let mut paired_requirements: BTreeMap<String, PairedRequirement> = BTreeMap::new();
    let mut paired_baselines: BTreeMap<String, PairedBaseline> = BTreeMap::new();

    // display-stale：`trans` 已变的句先删掉过期的 `transDisplay` 与其 display
    // 基准条目（对齐块设计 §5），再进入常规增量判定。
    purge_stale_display(doc, &options.lang, &sentences);

    // 孤儿清理：条目的句 id 已不在当前派生中 ⇒ 移除（译句真相 trans 保留，
    // 由 check 报孤儿；切法没有宿主可言，留着只会误导展示端）。
    let valid_ids: BTreeSet<&str> = sentences.iter().map(|s| s.id.as_str()).collect();
    if let Some(table) = doc.trans_align.get_mut(&options.lang) {
        table.retain(|id, _| valid_ids.contains(id.as_str()));
    }

    let mut pending: Vec<Pending> = Vec::new();
    let mut writes: Vec<AlignWrite> = Vec::new();
    // 显示改写回写：句 id → `transDisplay`（自然译句 `trans` 不动；条目以
    // `text_basis: display` 声明基准，与对齐条目同批原子落库）。
    let mut display_writes: Vec<(String, TransDisplay)> = Vec::new();
    let mut removals: Vec<String> = Vec::new();

    for sentence in &sentences {
        if let Some(filter) = &options.sentences
            && !filter.contains(&sentence.id)
        {
            continue;
        }
        let Some(translation) = doc
            .trans
            .get(&options.lang)
            .and_then(|table| table.get(&sentence.id))
            .map(|text| text.trim().to_owned())
        else {
            continue; // 未翻译句不对齐。
        };
        if translation.is_empty() {
            outcome
                .violations
                .push(format!("{}: empty translation — skipped", sentence.id));
            continue;
        }
        let anchor_indices = match visible_words.and_then(|rows| rows.get(&sentence.id)) {
            Some(ids) => projected_word_indices(doc, sentence, ids)?,
            None => sentence.word_indices.clone(),
        };
        let projected = anchor_indices != sentence.word_indices;
        let anchor_ids = anchor_indices
            .iter()
            .map(|&index| doc.words[index].id.clone())
            .collect::<Vec<_>>();
        let density = options.density_for(&sentence.id);
        if density == AlignDensity::Paired {
            let source_rows = source_rows_for_indices(doc, &anchor_indices, &cue_ids_by_index);
            let target_units = crate::split::piece_display_units(&translation, &options.lang);
            paired_requirements.insert(
                sentence.id.clone(),
                PairedRequirement::new(source_rows, target_units),
            );
            let source_cue_keys: Vec<Option<String>> = anchor_indices
                .iter()
                .map(|index| cue_ids_by_index.get(index).cloned())
                .collect();
            let previous = doc
                .trans_align
                .get(&options.lang)
                .and_then(|table| table.get(&sentence.id))
                .filter(|entry| {
                    align_entry_valid_for_lang(doc, sentence, &options.lang, entry)
                        && alignment_anchors_match(entry, &anchor_ids, projected)
                });
            let before = match previous {
                Some(entry) => DwellShape::of_entry(doc, &anchor_indices, &source_cue_keys, entry),
                None => DwellShape::of(
                    doc,
                    &anchor_indices,
                    &source_cue_keys,
                    &[(0, anchor_indices.len().saturating_sub(1))],
                    false,
                ),
            };
            // 原状是「失效」而不是「本来就不需要条目」：有条目但已失效，或没有
            // 条目而整句放不进一行（展示端只能落一条 align-stale 兜底 cue）。
            let had_entry = doc
                .trans_align
                .get(&options.lang)
                .is_some_and(|table| table.contains_key(&sentence.id));
            let stale = previous.is_none()
                && (had_entry
                    || exceeds_one_line_fit(&translation, &options.lang, params.fit)
                    || target_units > params.hard);
            paired_baselines.insert(
                sentence.id.clone(),
                PairedBaseline {
                    anchor_indices: anchor_indices.clone(),
                    source_cue_keys,
                    before,
                    stale,
                    previous_aligner: previous.and_then(|entry| entry.aligner.clone()),
                },
            );
            outcome.row_repair.candidates += 1;
        }

        // 该句在当前 mode 下是否根本不需要条目。
        // BaoCut 的两阶段模型：Phase 1 永远整句翻译；Phase 2 处理超过
        // 一行 fit 或 hard 的译句。多对一是默认形态：译文一行放得下时，
        // 几条短源短语共享这一条译文即可，不因源语长就强制拆分译文。
        // 唯一的例外是时间护栏——整句时窗超过 LONG_DWELL_SECONDS 时单条
        // 字幕会"钉"在屏幕上，仍入队请 LLM 切分。
        // fit 是视觉单行触发，hard 是交付硬上限；hard 仍必须显式校验，
        // 确保参数覆盖时也不会跳过超限句。
        // 第二个例外是源侧护栏——整句上屏本身就是一条配对行，源行超过配对
        // 硬上限时双语行读不完，即便译文一行放得下也必须入队请 LLM 沿目标语
        // 自然缝切分。判据与 `bcut check` 的 align-source-ceiling 共用同一
        // 谓词，不在此处复制阈值。
        let dwell = words_dwell_seconds_for_indices(doc, &anchor_indices);
        let source_ceiling = {
            let anchor_words = anchor_indices
                .iter()
                .map(|&index| &doc.words[index])
                .collect::<Vec<_>>();
            whole_sentence_source_ceiling_issue(
                &anchor_words,
                &translation,
                &doc.lang,
                &options.lang,
            )
        };
        let no_entry_needed = density != AlignDensity::Paired
            && !exceeds_one_line_fit(&translation, &options.lang, params.fit)
            && crate::split::piece_display_units(&translation, &options.lang) <= params.hard
            && dwell <= LONG_DWELL_SECONDS
            && source_ceiling.is_none();
        if no_entry_needed {
            if projected {
                let (mode, words, from, to) = match options.mode {
                    AlignMode::ManyToOne => (
                        AlignMode::ManyToOne,
                        anchor_ids,
                        Some(0),
                        Some(anchor_indices.len() - 1),
                    ),
                    AlignMode::Independent => (AlignMode::Independent, anchor_ids, None, None),
                    AlignMode::OneToOne => {
                        return Err(LlmError::Malformed(
                            "oneToOne is a legacy source-Cue mode; use manyToOne or independent so translation cues derive only from sentences"
                                .to_owned(),
                        ));
                    }
                };
                push_write(
                    &mut writes,
                    &mut outcome,
                    sentence.id.clone(),
                    TransAlign::new(
                        mode,
                        words,
                        vec![TransPiece {
                            from,
                            to,
                            text: translation,
                        }],
                    ),
                    WriteCredit::Aligned,
                );
            } else {
                removals.push(sentence.id.clone());
                outcome.skipped_sentences += 1;
            }
            continue;
        }

        // 已有同 mode 有效条目：非 force 跳过。
        if !options.force
            && let Some(entry) = doc
                .trans_align
                .get(&options.lang)
                .and_then(|table| table.get(&sentence.id))
            && entry.mode == options.mode
            && align_entry_valid_for_lang(doc, sentence, &options.lang, entry)
            && alignment_anchors_match(entry, &anchor_ids, projected)
        {
            outcome.skipped_sentences += 1;
            continue;
        }

        match options.mode {
            AlignMode::OneToOne => {
                return Err(LlmError::Malformed(
                    "oneToOne is a legacy source-Cue mode; use manyToOne or independent so translation cues derive only from sentences"
                        .to_owned(),
                ));
            }
            AlignMode::Independent => {
                let pieces = split_independent_for_lang_protected(
                    &translation,
                    &params,
                    anchor_indices.len(),
                    &options.lang,
                    &options.protected_terms,
                );
                if pieces.len() <= 1 {
                    if projected {
                        push_write(
                            &mut writes,
                            &mut outcome,
                            sentence.id.clone(),
                            TransAlign::new(
                                AlignMode::Independent,
                                anchor_ids,
                                vec![TransPiece {
                                    from: None,
                                    to: None,
                                    text: translation,
                                }],
                            ),
                            WriteCredit::Aligned,
                        );
                    } else {
                        // 切分器判定整句保留（无安全缝的 soft..hard 区间等）。
                        removals.push(sentence.id.clone());
                        outcome.skipped_sentences += 1;
                    }
                    continue;
                }
                push_write(
                    &mut writes,
                    &mut outcome,
                    sentence.id.clone(),
                    TransAlign::new(
                        AlignMode::Independent,
                        if projected { anchor_ids } else { Vec::new() },
                        pieces
                            .into_iter()
                            .map(|text| TransPiece {
                                from: None,
                                to: None,
                                text,
                            })
                            .collect(),
                    ),
                    WriteCredit::Aligned,
                );
            }
            AlignMode::ManyToOne => {
                // 短句已在 no_entry_needed 分支结束；所有需要展示拆分的长句
                // 必须进入下面的批量 LLM，不再用本地比例锚定冒充语义对齐。
                let words: Vec<PendingWord> = sentence
                    .word_indices
                    .iter()
                    .filter(|index| anchor_indices.contains(index))
                    .enumerate()
                    .map(|(ordinal, &index)| PendingWord {
                        text: doc.words[index].text.clone(),
                        glue: doc.words[index].glue,
                        pause_before: if ordinal == 0 {
                            0
                        } else {
                            let prev = anchor_indices[ordinal - 1];
                            pause_tier(doc.words[index].t0 - doc.words[prev].t1)
                        },
                        t0: doc.words[index].t0,
                        t1: doc.words[index].t1,
                    })
                    .collect();
                // force 重切（refine 路径）时把当前有效切分作为载荷 draft 的
                // 基准；片区间是句内词序数。
                let existing = doc
                    .trans_align
                    .get(&options.lang)
                    .and_then(|table| table.get(&sentence.id))
                    .filter(|entry| {
                        entry.mode == AlignMode::ManyToOne
                            && entry.text_basis == TextBasis::Trans
                            && align_entry_valid_for_lang(doc, sentence, &options.lang, entry)
                    })
                    .and_then(|entry| {
                        if !alignment_anchors_match(entry, &anchor_ids, projected) {
                            return None;
                        }
                        let mut ranges = Vec::with_capacity(entry.pieces.len());
                        let mut texts = Vec::with_capacity(entry.pieces.len());
                        for piece in &entry.pieces {
                            let (Some(from), Some(to)) = (piece.from, piece.to) else {
                                return None;
                            };
                            ranges.push((from, to));
                            texts.push(piece.text.clone());
                        }
                        Some(ExistingAlign { texts, ranges })
                    });
                let protected_terms = options
                    .protected_terms
                    .iter()
                    .filter(|term| {
                        translation.contains(term.as_str())
                            && target_cps_chars(term, &options.lang) <= params.fit
                    })
                    .cloned()
                    .collect();
                let word_refs = words
                    .iter()
                    .map(|word: &PendingWord| word.text.as_str())
                    .collect::<Vec<_>>();
                let bilingual_anchors = options
                    .bilingual_anchors
                    .iter()
                    .filter(|anchor| {
                        !anchor.source.trim().is_empty()
                            && !anchor.target.trim().is_empty()
                            && !source_anchor_matches(&word_refs, &anchor.source).is_empty()
                            && translation.contains(&anchor.target)
                    })
                    .cloned()
                    .collect();
                let source_cue_keys = anchor_indices
                    .iter()
                    .map(|index| cue_ids_by_index.get(index).cloned())
                    .collect();
                pending.push(Pending {
                    sentence,
                    anchor_indices,
                    words,
                    translation,
                    existing,
                    frozen_target: None,
                    protected_terms,
                    bilingual_anchors,
                    source_cue_keys,
                });
            }
        }
    }

    let mut execution_options = options.clone();
    execution_options.instructions =
        paired_prompt_instructions(options.instructions.as_deref(), &paired_requirements);
    // 只有 paired 轮才有"被本轮上限截掉、留给下一轮"的概念；auto 轮
    // `density_sentences` 不参与逐句判定，capped 必须恒为 0。
    outcome.row_repair.capped = if options.density == AlignDensity::Paired {
        options
            .density_sentences
            .len()
            .saturating_sub(outcome.row_repair.candidates)
    } else {
        0
    };

    // 融合草稿（载体无关）：translate 顺带标注的块对齐边先走确定性块核。
    let verdicts = accept_fused_drafts(
        doc,
        &execution_options,
        &params,
        pending,
        drafts,
        &mut writes,
        &mut outcome,
    );
    let mut remaining = Vec::new();
    let mut rewrites = Vec::new();
    for verdict in verdicts {
        match verdict {
            FusedVerdict::Pending(item) => remaining.push(item),
            FusedVerdict::NeedsRewrite(item, hint) => rewrites.push((item, hint)),
        }
    }

    match options.carrier {
        AlignCarrier::Edges => {
            run_edges_carrier(
                doc,
                llm,
                &execution_options,
                &params,
                remaining,
                rewrites,
                LLM_CHUNK_ALIGNER_TAG,
                on_attempt,
                &mut writes,
                &mut display_writes,
                &mut outcome,
            )?;
        }
        AlignCarrier::Table => {
            // 表格载体自带 reorder/crossing 政策：需要改写的句一并进表格轮。
            let pending: Vec<Pending> = remaining
                .into_iter()
                .chain(rewrites.into_iter().map(|(item, _)| item))
                .collect();
            run_table_carrier(
                doc,
                llm,
                &execution_options,
                &params,
                pending,
                &paired_requirements,
                on_attempt,
                &mut writes,
                &mut display_writes,
                &mut outcome,
            )?;
        }
    }

    // Paired 是展示层重切，不允许借机写 `transDisplay`；结果按 `align-row-deficit`
    // 的驻留谓词验收（见下方逐句判定）。被拒时丢弃本轮写入，保留原条目/原状。
    //
    // 判定按**每句最后一条写入**：同一句可能被写多次（改写轮之后又被兜底轮
    // 覆盖），而落库时 `table.insert` 是后写覆盖先写，验收必须用同一口径。
    let mut paired_last_write: BTreeMap<&str, usize> = BTreeMap::new();
    for (index, write) in writes.iter().enumerate() {
        if paired_requirements.contains_key(&write.id) {
            paired_last_write.insert(write.id.as_str(), index);
        }
    }
    // 每个被拒句的实际形态（没产出写入 / 改写基准 / 未改善），以及「部分修复
    // 已接受」的提示；violation 文案必须写实。
    let mut rejection_reasons: Vec<(String, String)> = Vec::new();
    let mut rejections: Vec<RowRepairRejection> = Vec::new();
    let mut paired_accepted: BTreeSet<String> = BTreeSet::new();
    let mut kept_write_indices: BTreeSet<usize> = BTreeSet::new();
    for (id, requirement) in &paired_requirements {
        let Some(&index) = paired_last_write.get(id.as_str()) else {
            rejections.push(requirement.rejection(id, "no-write", 0));
            rejection_reasons.push((
                id.clone(),
                "paired row repair produced no alignment this round (the sentence was skipped or its LLM call did not yield an acceptable result); kept the previous alignment".to_owned(),
            ));
            continue;
        };
        let entry = &writes[index].entry;
        if entry.text_basis != TextBasis::Trans {
            rejections.push(requirement.rejection(id, "rewritten-basis", entry.pieces.len()));
            rejection_reasons.push((
                id.clone(),
                "paired row repair rejected — the result is based on rewritten `transDisplay` text instead of the natural `trans` text; kept the previous alignment".to_owned(),
            ));
            continue;
        }
        // 验收按 `align-row-deficit` 的驻留谓词，不按片数：片数下限只是契约里
        // 的指导语（「aim for N」）。消除黏结即接受；仍黏结但严格更好（黏结行
        // 更少 / 驻留更短 / 覆盖源行更少）也接受，并保留一条告警；原条目已失效
        // 时不比兜底整句更差即可接受。
        let baseline = &paired_baselines[id];
        // 修复调用没拿到可用答案时，预算尾巴落下的是模型缺席切法（等宽切 /
        // 纯锚点）。它清掉黏结行只是因为切得更碎，不是更对的对应；原条目是
        // 模型给的就保留原状，与「本轮没产出写入」同一待遇（现场：stanford
        // 一批 `align-edge-ordinal` 拒收把同批 4 句 `llm-lines` 对齐换成了
        // `deterministic/1` / `anchor/1`，其中一句驻留只从 6.8s 缩到 6.5s）。
        if !baseline.stale
            && model_backed_aligner(baseline.previous_aligner.as_deref())
            && !model_backed_aligner(entry.aligner.as_deref())
        {
            rejections.push(requirement.rejection(id, "model-free", entry.pieces.len()));
            rejection_reasons.push((
                id.clone(),
                format!(
                    "paired row repair rejected — the repair call did not yield an acceptable answer and the model-free `{}` split would replace the `{}` alignment; kept the previous alignment",
                    entry.aligner.as_deref().unwrap_or("-"),
                    baseline.previous_aligner.as_deref().unwrap_or("-"),
                ),
            ));
            continue;
        }
        let after = DwellShape::of_entry(
            doc,
            &baseline.anchor_indices,
            &baseline.source_cue_keys,
            entry,
        );
        let before = baseline.before;
        if after.deficit {
            let improved = after.strictly_better_than(&before)
                || (baseline.stale && after.not_worse_than(&before));
            if !improved {
                rejections.push(requirement.rejection(id, "not-improved", entry.pieces.len()));
                rejection_reasons.push((
                    id.clone(),
                    format!(
                        "paired row repair rejected — the new alignment ({} piece(s)) still has {} stuck row(s) (longest {:.1}s over {} source rows) and is not better than before ({} stuck row(s), longest {:.1}s over {} source rows); kept the previous alignment",
                        entry.pieces.len(),
                        after.offending,
                        after.worst_dwell,
                        after.worst_rows,
                        before.offending,
                        before.worst_dwell,
                        before.worst_rows,
                    ),
                ));
                continue;
            }
            rejection_reasons.push((
                id.clone(),
                format!(
                    "paired row repair accepted a partial fix — {} stuck row(s) remain (longest {:.1}s over {} source rows; before: {} stuck row(s), longest {:.1}s over {} source rows); align-row-deficit still applies",
                    after.offending,
                    after.worst_dwell,
                    after.worst_rows,
                    before.offending,
                    before.worst_dwell,
                    before.worst_rows,
                ),
            ));
        }
        paired_accepted.insert(id.clone());
        kept_write_indices.insert(index);
    }
    drop(paired_last_write);

    display_writes.retain(|(id, _)| !paired_requirements.contains_key(id));
    removals.retain(|id| !paired_requirements.contains_key(id));
    // 丢弃一条写入时，**只**退回它自己加过的计数器（见 [`WriteCredit`]）；
    // 被拒句可能走的是 fallback 或压根没写入，无条件扣 `aligned_sentences`
    // 会偷走别的句的计数。
    let mut write_index = 0usize;
    writes.retain(|write| {
        let index = write_index;
        write_index += 1;
        if !paired_requirements.contains_key(&write.id) || kept_write_indices.contains(&index) {
            return true;
        }
        write.credit.revert(&mut outcome);
        false
    });
    outcome.row_repair.repaired = paired_accepted.len();
    outcome.row_repair.rejected = outcome
        .row_repair
        .candidates
        .saturating_sub(outcome.row_repair.repaired);
    outcome.row_repair.rejections_truncated = rejections
        .len()
        .saturating_sub(ROW_REPAIR_REJECTION_DETAILS);
    rejections.truncate(ROW_REPAIR_REJECTION_DETAILS);
    outcome.row_repair.rejections = rejections;
    for (id, reason) in rejection_reasons {
        outcome.violations.push(format!("{id}: {reason}"));
    }

    // 显示改写先于对齐条目落库：`text_basis: display` 的条目以它为基准文本，
    // 两者同批更新才能维持「片拼接 == 基准译文」不变量；`trans` 不动。
    if !display_writes.is_empty() {
        let table = doc.trans_display.entry(options.lang.clone()).or_default();
        for (id, display) in display_writes {
            table.insert(id, display);
        }
    }
    // paired 接受的新条目一律以 `trans` 为基准（验收器已保证）。该句若还留着
    // 上一轮的 `transDisplay` 条目，它就成了没有任何条目引用的孤儿，还会让
    // 下游按显示文本而不是自然译文渲染——随新条目一并清掉。
    if !paired_accepted.is_empty()
        && let Some(table) = doc.trans_display.get_mut(&options.lang)
    {
        for id in &paired_accepted {
            table.remove(id);
        }
        if table.is_empty() {
            doc.trans_display.remove(&options.lang);
        }
    }
    let table = doc.trans_align.entry(options.lang.clone()).or_default();
    for id in removals {
        table.remove(&id);
    }
    for write in writes {
        table.insert(write.id, write.entry);
    }
    if table.is_empty() {
        doc.trans_align.remove(&options.lang);
    }
    Ok(outcome)
}

// ---- 块对齐边载体（对齐块设计 §4 / §6） -----------------------------------

/// 融合草稿的逐句裁决。
enum FusedVerdict<'a> {
    /// 无草稿、草稿无证据或只够整句对应：进 dedicated 轮。
    Pending(Pending<'a>),
    /// 草稿对齐后某块超 hard：进单调化改写轮（表格载体则进表格轮）。带
    /// `data-over-hard` 提示文案。
    NeedsRewrite(Pending<'a>, String),
}

/// translate 融合草稿逐句走确定性块核（对齐块设计 §4.5）：`Aligned` 直接
/// 落库（不消耗任何 align 调用）；`NeedsRewrite` 进改写轮；融合草稿的
/// `SentenceLevel` **不**直接接受——它只是"草稿证据不足"，交给 dedicated 轮
/// 再拿一次块标注。
fn accept_fused_drafts<'a>(
    doc: &TranscriptDoc,
    options: &AlignOptions,
    params: &TransParams,
    pending: Vec<Pending<'a>>,
    drafts: &FusionDrafts,
    writes: &mut Vec<AlignWrite>,
    outcome: &mut AlignOutcome,
) -> Vec<FusedVerdict<'a>> {
    let mut verdicts = Vec::with_capacity(pending.len());
    for item in pending {
        let Some(draft) = drafts
            .get(&item.sentence.id)
            .filter(|draft| !draft.chunks.is_empty() || draft.lines.is_some())
        else {
            verdicts.push(FusedVerdict::Pending(item));
            continue;
        };
        // 行文本载体的草稿：块的源区间由首尾引用联合定位（分片边界优先），
        // 目标切点只取证据允许的那些，再与锚点边一起进块核。证据不足即整句
        // 进 dedicated 轮；某块超 hard 进改写轮——与 HTML 块草稿同一裁决。
        if let Some(lines) = &draft.lines {
            let source_words: Vec<&str> =
                item.words.iter().map(|word| word.text.as_str()).collect();
            if lines
                .source_words
                .iter()
                .map(String::as_str)
                .ne(source_words.iter().copied())
            {
                // 载体看到的词表与本轮的锚定词（最终时间线裁剪后的可见子集）
                // 不同：引用无从定位，按无草稿处理。
                outcome.violations.push(format!(
                    "{}: lines draft dropped — its {} source words differ from the {} anchoring words; dedicated align",
                    item.sentence.id,
                    lines.source_words.len(),
                    source_words.len()
                ));
                verdicts.push(FusedVerdict::Pending(item));
                continue;
            }
            let input = plan_input(
                doc,
                options,
                &item,
                params,
                &item.translation,
                &options.lang,
                TextBasis::Trans,
                LLM_LINES_ALIGNER_TAG,
            );
            // 词表已核对与 `item.words` 逐词相同；传带「贴前」标记的那份。
            let evidence = crate::filepipe::lines::evidence_with_pieces(
                &lines.record,
                &item.words,
                &align_ctx(&item, &doc.lang, &options.lang),
                &lines.pieces,
            );
            if evidence.text != item.translation {
                outcome.violations.push(format!(
                    "{}: lines draft dropped — its chunk text no longer matches the committed translation; dedicated align",
                    item.sentence.id
                ));
                verdicts.push(FusedVerdict::Pending(item));
                continue;
            }
            let candidates = crate::align_block::target_cut_candidates(
                &input.target,
                &input.lang,
                &input.params,
                &input.protected_terms,
            );
            let allowed: Vec<usize> = candidates
                .iter()
                .map(|candidate| candidate.pos)
                .filter(|position| evidence.cuts.contains(position))
                .collect();
            let strict =
                crate::align_block::plan_sentence_at_cuts(&evidence.edges, &input, &allowed);
            // 模型自己的切点提示：lint 否掉的块边界、抄进译文的片标。
            let hints = crate::filepipe::lines::cut_hints(&lines.record);
            let hinted = crate::align_block::hinted_cut_candidates(
                &input.target,
                &input.lang,
                &input.params,
                &input.protected_terms,
                &hints,
            );
            // 切点都放行、某块仍超 hard：先在块内按目标缝再切一刀（干净的有依托
            // 缝与干净的提示 > 带悬垂尾的提示 > 被 lint 拒了的提示 > 逐字；其余
            // 模型切点原样保留，块内源断点在按比例的落点附近吸附到源侧断点），
            // 落成 `llm-lines+split/1`；一刀不够、没有候选或切完仍不安全（语序
            // 交叉）才进改写轮。模型给了提示就进梯子（提示本身被 lint 拒了也进，
            // 干净缝照样可用，只是不用没放行的缝：被拒的提示与逐字缝）；既没有
            // 切点放行、模型也没给提示的句子没有可保留的证据，仍按原路走。
            let strict = match strict {
                PlanOutcome::NeedsRewrite { .. } if !allowed.is_empty() || !hints.is_empty() => {
                    match crate::align_block::plan_sentence_splitting_over_hard(
                        &evidence.edges,
                        &input,
                        &allowed,
                        &candidates,
                        &hinted,
                    ) {
                        (PlanOutcome::Aligned(mut entry), extra) if !extra.is_empty() => {
                            entry.aligner = Some(LLM_LINES_SPLIT_ALIGNER_TAG.to_owned());
                            push_write(
                                writes,
                                outcome,
                                item.sentence.id.clone(),
                                entry,
                                WriteCredit::Prealigned,
                            );
                            outcome.violations.push(format!(
                                "{}: accepted from the translate lines draft with {} over-hard block(s) split in place at {} ({} of {} chunks located, {} evidence cut(s) kept, {} cut hint(s); the source break inside a split block snaps to the nearest source punctuation, pause or legal seam around the proportional point)",
                                item.sentence.id,
                                extra.len(),
                                crate::align_block::describe_split_cuts(&extra),
                                evidence.located,
                                evidence.chunks,
                                allowed.len(),
                                hints.len()
                            ));
                            continue;
                        }
                        (other, _) => other,
                    }
                }
                other => other,
            };
            match strict {
                PlanOutcome::Aligned(entry) => {
                    push_write(
                        writes,
                        outcome,
                        item.sentence.id.clone(),
                        entry,
                        WriteCredit::Prealigned,
                    );
                    outcome.violations.push(format!(
                        "{}: accepted from the translate lines draft ({} of {} chunks located{})",
                        item.sentence.id,
                        evidence.located,
                        evidence.chunks,
                        if evidence.overlapping > 0 {
                            format!(
                                ", {} overlapping quote hull pair(s) kept as crossing evidence",
                                evidence.overlapping
                            )
                        } else {
                            String::new()
                        }
                    ));
                }
                PlanOutcome::NeedsRewrite {
                    over_hard_block,
                    units,
                    blocks,
                } => {
                    outcome.violations.push(format!(
                        "{}: lines draft leaves a {units}-unit block over hard {} ({} of {} chunks located, {} evidence cut(s)); rewrite turn",
                        item.sentence.id,
                        params.hard,
                        evidence.located,
                        evidence.chunks,
                        allowed.len()
                    ));
                    let hint = over_hard_hint(&blocks, over_hard_block, units, params);
                    verdicts.push(FusedVerdict::NeedsRewrite(item, hint));
                }
                PlanOutcome::SentenceLevel(_) => {
                    outcome.violations.push(format!(
                        "{}: lines draft gave no usable block evidence ({} of {} chunks located, {} evidence cut(s), issues {:?}); dedicated align",
                        item.sentence.id,
                        evidence.located,
                        evidence.chunks,
                        allowed.len(),
                        evidence.issues
                    ));
                    verdicts.push(FusedVerdict::Pending(item));
                }
            }
            continue;
        }
        // 行分区草稿：模型已按源词顺序给出显示行，行边界直接冻结成块边界，
        // 不再派 align-edges / align-rewrite。任何一步不成立就落回常规路径。
        if draft.rows {
            let input = plan_input(
                doc,
                options,
                &item,
                params,
                &item.translation,
                &options.lang,
                TextBasis::Trans,
                LLM_ROWS_ALIGNER_TAG,
            );
            let edges = merge_edges(vec![
                anchor_edges(&item, &doc.lang, &options.lang, &item.translation),
                chunks_to_edges(&draft.chunks, &item.translation),
            ]);
            let plan = chunk_char_ranges(&draft.chunks, &item.translation)
                .and_then(|ranges| plan_sentence_rows(&edges, &ranges, &input));
            if let Some(plan) = plan {
                push_write(
                    writes,
                    outcome,
                    item.sentence.id.clone(),
                    plan.entry,
                    WriteCredit::Prealigned,
                );
                outcome.rows_merged += plan.merged_rows;
                outcome.violations.push(format!(
                    "{}: accepted from the translate fused display-row draft{}",
                    item.sentence.id,
                    if plan.merged_rows > 0 {
                        format!(" ({} short row(s) merged)", plan.merged_rows)
                    } else {
                        String::new()
                    }
                ));
                continue;
            }
        }
        let input = plan_input(
            doc,
            options,
            &item,
            params,
            &item.translation,
            &options.lang,
            TextBasis::Trans,
            LLM_CHUNK_ALIGNER_TAG,
        );
        let edges = merge_edges(vec![
            anchor_edges(&item, &doc.lang, &options.lang, &item.translation),
            chunks_to_edges(&draft.chunks, &item.translation),
        ]);
        match plan_sentence(&edges, &input) {
            PlanOutcome::Aligned(entry) => {
                push_write(
                    writes,
                    outcome,
                    item.sentence.id.clone(),
                    entry,
                    WriteCredit::Prealigned,
                );
                outcome.violations.push(format!(
                    "{}: accepted from the translate fused block-alignment draft",
                    item.sentence.id
                ));
            }
            PlanOutcome::NeedsRewrite {
                over_hard_block,
                units,
                blocks,
            } => {
                let hint = over_hard_hint(&blocks, over_hard_block, units, params);
                verdicts.push(FusedVerdict::NeedsRewrite(item, hint));
            }
            PlanOutcome::SentenceLevel(_) => verdicts.push(FusedVerdict::Pending(item)),
        }
    }
    verdicts
}

/// `data-over-hard` 提示：只带相对预算（块序、源词序号区间、阅读单位），不带秒数。
fn over_hard_hint(
    blocks: &[crate::doc::AlignBlock],
    over_hard_block: usize,
    units: usize,
    params: &TransParams,
) -> String {
    let (from, to) = blocks
        .get(over_hard_block)
        .map(|block| block.src)
        .unwrap_or((0, 0));
    format!(
        "chunk {} (words {}-{}): {} units > hard {}",
        over_hard_block + 1,
        from + 1,
        to + 1,
        units,
        params.hard
    )
}

/// 一句的双语 DP 输入：句内锚定词、目标文本、阈值、锁定术语与缺省
/// [`LayoutProfile`] 的时长界。
fn plan_input(
    doc: &TranscriptDoc,
    options: &AlignOptions,
    item: &Pending,
    params: &TransParams,
    target: &str,
    target_lang: &str,
    text_basis: TextBasis,
    aligner: &str,
) -> BilingualPlanInput {
    let words = anchor_words(doc, item);
    let profile = LayoutProfile::default_profile();
    let mut input = BilingualPlanInput::new(words, target, &doc.lang, target_lang);
    input.params = *params;
    input.protected_terms = item.protected_terms.clone();
    input.min_duration_sec = profile.min_duration_sec;
    input.max_duration_sec = profile.max_duration_sec;
    input.text_basis = text_basis;
    input.aligner = aligner.to_owned();
    input.density = options.density_for(&item.sentence.id);
    input.source_cue_keys = item.source_cue_keys.clone();
    input
}

/// 句内锚定词（id + 文本 + 时间）：双语 DP 与本地语义评分器共用同一份口径。
fn anchor_words(doc: &TranscriptDoc, item: &Pending) -> Vec<AnchorWord> {
    item.anchor_indices
        .iter()
        .map(|&index| AnchorWord {
            id: doc.words[index].id.clone(),
            text: doc.words[index].text.clone(),
            t0: doc.words[index].t0,
            t1: doc.words[index].t1,
            glue: doc.words[index].glue,
        })
        .collect()
}

fn align_ctx(item: &Pending, source_lang: &str, target_lang: &str) -> AlignCtx {
    AlignCtx {
        source_lang: source_lang.to_owned(),
        lang: target_lang.to_owned(),
        protected_terms: item
            .bilingual_anchors
            .iter()
            .map(|anchor| TermPair {
                source: anchor.source.clone(),
                target: anchor.target.clone(),
            })
            .collect(),
    }
}

/// 确定性锚点边（数字/URL/原样 Latin/双语术语）。
fn anchor_edges(
    item: &Pending,
    source_lang: &str,
    target_lang: &str,
    target: &str,
) -> Vec<AlignEdge> {
    let refs: Vec<&str> = item.words.iter().map(|word| word.text.as_str()).collect();
    AnchorAligner.align(&refs, target, &align_ctx(item, source_lang, target_lang))
}

/// 当前落库的自然译句指纹（`transDisplay.transFingerprint`）。
fn trans_fingerprint_for(doc: &TranscriptDoc, lang: &str, id: &str, fallback: &str) -> String {
    let text = doc
        .trans
        .get(lang)
        .and_then(|table| table.get(id))
        .map(String::as_str)
        .unwrap_or(fallback);
    trans_text_fingerprint(text)
}

/// 一批 `Pending` → `align-edges/1` / `align-rewrite/1` 表输入。
fn edges_input(
    batch: &[(&Pending, Option<&str>)],
    params: &TransParams,
    target_lang: &str,
    rewrite: bool,
) -> AlignEdgesInput {
    AlignEdgesInput {
        lang: target_lang.to_owned(),
        params: *params,
        rewrite,
        sentences: batch
            .iter()
            .map(|(item, hint)| AlignEdgesSentenceInput {
                id: item.sentence.id.clone(),
                source_words: item.words.iter().map(|word| word.text.clone()).collect(),
                translation: item.translation.clone(),
                over_hard: hint.map(str::to_owned),
            })
            .collect(),
    }
}

/// 按首轮同一套三重约束（词数 / 句数 / 复杂度）切页。
fn edges_batches<'b, 'a>(
    items: &[(&'b Pending<'a>, Option<&'b str>)],
    params: &TransParams,
    source_lang: &str,
    target_lang: &str,
    page_budget: usize,
) -> Vec<Vec<(&'b Pending<'a>, Option<&'b str>)>> {
    let refs: Vec<&Pending> = items.iter().map(|(item, _)| *item).collect();
    let mut batches = Vec::new();
    let mut cursor = 0usize;
    for size in align_page_sizes(&refs, params, source_lang, target_lang, page_budget) {
        batches.push(items[cursor..cursor + size].to_vec());
        cursor += size;
    }
    batches
}

/// `align-edges/1` 契约（对齐块设计 §6.1）。模型只标注块归属，不切源、不切
/// 译、不解决交叉。
fn align_edges_system_prompt(
    params: &TransParams,
    instructions: Option<&str>,
    protected_terms: &[String],
) -> String {
    let mut prompt = format!(
        r#"You are an expert bilingual subtitle aligner. The input is ONE HTML table. Each `<tbody data-sid="…">` is one sentence with a single row: the `td.src` cell holds the spoken source words, each prefixed with its 1-based ordinal like `[1]I [2]didn't [3]go`; the `td.tgt` cell holds the complete natural translation.

Your ONLY job is to annotate which source words each part of the translation renders. You do not cut subtitles, you do not decide row boundaries, and you never rewrite the translation — deterministic code merges your chunks into monotonic alignment blocks and cuts the rows afterwards.

Output protocol — return the SAME table and nothing else (no markdown fences, no prose, no `<style>`, no commentary):
- Keep `<table>` and every `<tbody>` in the input order, keep every `data-sid` byte for byte, emit every sentence exactly once, and leave `td.src` untouched. Do not invent ids.
- Rewrite ONLY the contents of `td.tgt`: replace the plain translation with a sequence of `<span data-src="…">chunk</span>` elements. The span texts concatenated MUST reproduce the translation EXACTLY — never add, drop, reorder, translate, or normalize any character; punctuation stays with the chunk it ends. Text left outside a span counts as an unattributed chunk.
- Chunk the translation into the SMALLEST natural semantic chunks — a clause, a phrase, a term; never below a word, never inside a name, number, or protected term. Chunks follow the translation's own order; you never move or merge chunks to imitate the source order.
- `data-src` lists the ordinals of the source words that chunk translates: whitespace or comma separated, ranges allowed (`4-7`, `1 2 3`, `1-3,9`), any order, non-contiguous ok. Use `data-src=""` for particles, connectives, or additions with no source word. Every ordinal may appear at most once in a sentence; leaving a function word unassigned is fine. Crossings are expected — record them faithfully through the ordinals, do not hide them.
- Numbers, dates, names, URLs, and glossary terms MUST sit in the chunk whose `data-src` contains their source ordinal.
- Prefer finer chunks: two short chunks with clear ordinals beat one large chunk. Row width guidance for the eventual subtitle: fit {fit}, soft {soft}, hard {hard} display units — chunks smaller than that give the cutter room to work.

Before emitting the table, silently verify: every sentence present, every `td.tgt` fully covered by spans whose concatenation is byte-identical to the input translation, no ordinal used twice, no ordinal beyond the source word count."#,
        fit = params.fit,
        soft = params.soft,
        hard = params.hard,
    );
    if !protected_terms.is_empty() {
        prompt.push_str(&format!(
            "\n\nProtected target terms — each is an indivisible unit; never let a chunk boundary fall inside one of these literal strings: {}",
            protected_terms.join(" · ")
        ));
    }
    if let Some(instructions) = instructions.filter(|text| !text.is_empty()) {
        prompt.push_str(&format!(
            "\n\nExplicit reviewer instructions for THIS batch (highest priority within the output protocol): {instructions}"
        ));
    }
    prompt
}

/// `align-rewrite/1` 契约（对齐块设计 §6.3）：单调化显示改写 + 块标注一次给出。
fn align_rewrite_system_prompt(
    params: &TransParams,
    instructions: Option<&str>,
    protected_terms: &[String],
) -> String {
    let mut prompt = format!(
        r#"You are an expert bilingual subtitle rewriter. The input is ONE HTML table. Each `<tbody data-sid="…">` is one sentence: the `td.src` cell holds the spoken source words, each prefixed with its 1-based ordinal like `[1]I [2]didn't [3]go`; the `td.tgt` cell holds the natural translation; `data-over-hard` names the aligned chunk (with its source ordinal range and reading-unit width) that cannot fit into one subtitle row because the translation's clause order crosses the source order.

Task: rewrite the translation so that its clause order follows the SOURCE clause order and every chunk fits the hard budget of {hard} display units (aim for ≤{fit}, {soft} or less reads best). Keep every fact, negation, number, name, date, URL, and locked term; keep the register; only reorder clauses and adjust connectives, particles, and punctuation as the new order requires. Never compress, expand, summarize, or retranslate — a rewrite whose length drifts beyond about 25% is rejected, and so is one that drops a number or a term. If the sentence genuinely cannot be reordered naturally, return the translation unchanged and annotate it anyway.

Output protocol — return the SAME table and nothing else (no markdown fences, no prose, no `<style>`, no commentary):
- Keep `<table>` and every `<tbody>` in the input order, keep every `data-sid` byte for byte, emit every sentence exactly once, and leave `td.src` untouched.
- Replace the contents of `td.tgt` with the REWRITTEN sentence, already annotated as a sequence of `<span data-src="…">chunk</span>` elements whose texts concatenate to the whole rewritten sentence (nothing outside spans). Chunk it into the smallest natural semantic chunks; `data-src` lists the 1-based source ordinals each chunk renders (whitespace or comma separated, ranges like `4-7` allowed, `data-src=""` for a chunk with no source word). Every ordinal at most once per sentence. Numbers, names, and terms sit in the chunk of their source ordinal.

Before emitting the table, silently verify: every sentence present, the rewritten sentence complete and natural, chunk order following the source order, no ordinal used twice or beyond the source word count."#,
        fit = params.fit,
        soft = params.soft,
        hard = params.hard,
    );
    if !protected_terms.is_empty() {
        prompt.push_str(&format!(
            "\n\nProtected target terms — each must appear verbatim in the rewrite and never be split by a chunk boundary: {}",
            protected_terms.join(" · ")
        ));
    }
    if let Some(instructions) = instructions.filter(|text| !text.is_empty()) {
        prompt.push_str(&format!(
            "\n\nExplicit reviewer instructions for THIS batch (highest priority within the output protocol): {instructions}"
        ));
    }
    prompt
}

fn edges_request(
    table: &AlignEdgesInput,
    params: &TransParams,
    instructions: Option<&str>,
    protected_terms: &[String],
    retry_reason: Option<String>,
) -> LlmRequest {
    let (kind, system) = if table.rewrite {
        (
            "align-rewrite",
            align_rewrite_system_prompt(params, instructions, protected_terms),
        )
    } else {
        (
            "align-edges",
            align_edges_system_prompt(params, instructions, protected_terms),
        )
    };
    LlmRequest {
        kind,
        system,
        user: render_align_edges(table),
        temperature: 0.1,
        attempt: if retry_reason.is_some() { 2 } else { 1 },
        retry_reason,
    }
}

/// 一句块标注 → 决策树落地（对齐块设计 §4.5）。`Aligned` / `SentenceLevel`
/// 直接落库；`NeedsRewrite` 交回调用方（改写轮），返回 `data-over-hard` 提示。
#[allow(clippy::too_many_arguments)]
fn settle_edges_plan(
    doc: &TranscriptDoc,
    options: &AlignOptions,
    params: &TransParams,
    item: &Pending,
    chunks: &[AlignChunk],
    llm_aligner: &str,
    writes: &mut Vec<AlignWrite>,
    outcome: &mut AlignOutcome,
) -> Option<String> {
    let id = item.sentence.id.as_str();
    let input = plan_input(
        doc,
        options,
        item,
        params,
        &item.translation,
        &options.lang,
        TextBasis::Trans,
        llm_aligner,
    );
    let edges = merge_edges(vec![
        anchor_edges(item, &doc.lang, &options.lang, &item.translation),
        chunks_to_edges(chunks, &item.translation),
    ]);
    match plan_sentence(&edges, &input) {
        PlanOutcome::Aligned(entry) => {
            push_write(writes, outcome, id.to_owned(), entry, WriteCredit::Aligned);
            None
        }
        PlanOutcome::NeedsRewrite {
            over_hard_block,
            units,
            blocks,
        } => Some(over_hard_hint(&blocks, over_hard_block, units, params)),
        PlanOutcome::SentenceLevel(entry) => {
            write_sentence_level(
                doc,
                item,
                &options.lang,
                params,
                entry,
                "block evidence too weak or no block-safe cut",
                writes,
                outcome,
            );
            None
        }
    }
}

/// 降级路径的 hard 护栏：整句一片的文本超过 hard 时不许原样落库（那会是一条
/// 放不下的单行）。先用 `align-overfit` 给出 seamLeft / seamRight 的同一个缝
/// 切分器（[`crate::seam::preferred_target_split`]）切两片，两片都 ≤ hard 才用；
/// 否则走确定性目标切分（[`fallback_word_entry`] 同一套）。源时间按片长比例
/// 分配。返回 `None` = 文本本来就 ≤ hard，不需要切。
fn split_over_hard_degrade(
    doc: &TranscriptDoc,
    item: &Pending,
    text: &str,
    lang: &str,
    params: &TransParams,
) -> Option<TransAlign> {
    if crate::split::piece_display_units(text, lang) <= params.hard {
        return None;
    }
    let seam = crate::seam::preferred_target_split(text, lang, params.soft, Some(params.hard))
        .filter(|split| {
            crate::split::piece_display_units(&split.left, lang) <= params.hard
                && crate::split::piece_display_units(&split.right, lang) <= params.hard
        });
    let mut entry = match seam {
        Some(split) => word_entry_from_texts(
            doc,
            item,
            vec![split.left.trim().to_owned(), split.right.trim().to_owned()],
            lang,
        ),
        None => fallback_word_entry(doc, item, text, lang, params),
    };
    entry.aligner = Some("deterministic/1".to_owned());
    Some(entry)
}

#[allow(clippy::too_many_arguments)]
fn write_sentence_level(
    doc: &TranscriptDoc,
    item: &Pending,
    lang: &str,
    params: &TransParams,
    entry: TransAlign,
    reason: &str,
    writes: &mut Vec<AlignWrite>,
    outcome: &mut AlignOutcome,
) {
    let id = item.sentence.id.as_str();
    let whole = entry
        .pieces
        .first()
        .map(|piece| piece.text.clone())
        .unwrap_or_default();
    if entry.text_basis == TextBasis::Trans
        && let Some(split) = split_over_hard_degrade(doc, item, &whole, lang, params)
    {
        push_write(writes, outcome, id.to_owned(), split, WriteCredit::Fallback);
        outcome.violations.push(format!(
            "{id}: sentence-level correspondence — {reason}; the whole translation exceeds hard, so it was cut at a deterministic target seam with proportional source timing instead"
        ));
        return;
    }
    push_write(
        writes,
        outcome,
        id.to_owned(),
        entry,
        WriteCredit::SentenceLevel,
    );
    outcome
        .violations
        .push(format!("{id}: sentence-level correspondence — {reason}"));
}

/// 一次 `align-edges/1` 批调用的验收：字符串级问题句 / 缺句 / 无标注句进
/// `failed`（附原因），其余逐句走块核；工件无论结论都落。
#[allow(clippy::too_many_arguments)]
fn edges_attempt<'b, 'a>(
    doc: &TranscriptDoc,
    options: &AlignOptions,
    params: &TransParams,
    batch: &[(&'b Pending<'a>, Option<&'b str>)],
    table: &AlignEdgesInput,
    payload: &str,
    raw: &str,
    page_id: &str,
    attempt_index: u32,
    llm_aligner: &str,
    on_attempt: &mut dyn FnMut(&AlignBatchAttempt<'_>),
    writes: &mut Vec<AlignWrite>,
    outcome: &mut AlignOutcome,
    rewrite_hints: &mut Vec<(&'b Pending<'a>, String)>,
    failed: &mut Vec<&'b Pending<'a>>,
    reasons: &mut Vec<String>,
) {
    let parsed = parse_align_edges(table, Some(payload), raw);
    let mut blocked: BTreeSet<String> = BTreeSet::new();
    for problem in &parsed.diagnostics.problems {
        match &problem.scope {
            ProblemScope::Sentence { id } => {
                blocked.insert(id.clone());
                reasons.push(format!("{id}: [{}] {}", problem.code, problem.detail));
            }
            _ => reasons.push(format!("[{}] {}", problem.code, problem.detail)),
        }
    }
    let mut batch_failed = false;
    for (item, _) in batch {
        let id = item.sentence.id.as_str();
        if blocked.contains(id) {
            failed.push(item);
            batch_failed = true;
            continue;
        }
        let Some(group) = parsed.group(id) else {
            failed.push(item);
            batch_failed = true;
            if !reasons.iter().any(|reason| problem_mentions_id(reason, id)) {
                reasons.push(format!("{id}: missing from the answer"));
            }
            continue;
        };
        if group.chunks.is_empty() {
            failed.push(item);
            batch_failed = true;
            reasons.push(format!(
                "{id}: td.tgt carries no <span data-src> chunk annotation — wrap the whole translation in spans"
            ));
            continue;
        }
        if let Some(hint) = settle_edges_plan(
            doc,
            options,
            params,
            item,
            &group.chunks,
            llm_aligner,
            writes,
            outcome,
        ) {
            rewrite_hints.push((item, hint));
        }
    }
    on_attempt(&PageAttempt {
        page_id,
        attempt: attempt_index,
        input: payload,
        output: raw,
        problems: &parsed.diagnostics.problems,
        accepted: !batch_failed,
    });
}

/// 单调化改写的验收（对齐块设计 §6.3）：目标 AutoCorrect → 锁定术语与双语锚
/// 目标必须仍在 → 硬锚（数字/URL/原样 Latin/术语）不得丢失 → 在改写文本上
/// 重新跑 edges → blocks → DP，只有 `Aligned` 才算通过。改写文本与入库译文
/// 完全相同（模型只把块切细了）时不产出 `transDisplay`：没有改写就不记改写。
fn accept_rewrite(
    doc: &TranscriptDoc,
    options: &AlignOptions,
    params: &TransParams,
    item: &Pending,
    rewritten: &str,
    chunks: &[AlignChunk],
    llm_aligner: &str,
) -> Result<(Option<TransDisplay>, TransAlign), String> {
    let text = format_translation_with_options(
        rewritten,
        &options.lang,
        &item.protected_terms,
        AutocorrectOptions::default(),
    );
    let text = text.trim().to_owned();
    if text.is_empty() {
        return Err("rewrite is empty".to_owned());
    }
    if let Some(term) = item
        .protected_terms
        .iter()
        .find(|term| !text.contains(term.as_str()))
    {
        return Err(format!("rewrite dropped protected term \"{term}\""));
    }
    if let Some(anchor) = item
        .bilingual_anchors
        .iter()
        .find(|anchor| !text.contains(anchor.target.as_str()))
    {
        return Err(format!(
            "rewrite dropped glossary target \"{}\"",
            anchor.target
        ));
    }
    let hard_src = |target: &str| -> BTreeSet<usize> {
        anchor_edges(item, &doc.lang, &options.lang, target)
            .into_iter()
            .filter(|edge| edge.hard)
            .map(|edge| edge.src)
            .collect()
    };
    let before = hard_src(&item.translation);
    let after = hard_src(&text);
    if let Some(&index) = before.difference(&after).next() {
        return Err(format!(
            "rewrite lost the anchor \"{}\" (source word {})",
            item.words
                .get(index)
                .map(|word| word.text.as_str())
                .unwrap_or("?"),
            index + 1
        ));
    }
    let unchanged = text == item.translation;
    let input = plan_input(
        doc,
        options,
        item,
        params,
        &text,
        &options.lang,
        if unchanged {
            TextBasis::Trans
        } else {
            TextBasis::Display
        },
        llm_aligner,
    );
    let edges = merge_edges(vec![
        anchor_edges(item, &doc.lang, &options.lang, &text),
        chunks_to_edges(chunks, &text),
    ]);
    match plan_sentence(&edges, &input) {
        PlanOutcome::Aligned(entry) if unchanged => Ok((None, entry)),
        PlanOutcome::Aligned(entry) => Ok((
            Some(TransDisplay {
                text,
                basis: MONOTONIC_REWRITE_BASIS.to_owned(),
                trans_fingerprint: trans_fingerprint_for(
                    doc,
                    &options.lang,
                    &item.sentence.id,
                    &item.translation,
                ),
            }),
            entry,
        )),
        PlanOutcome::NeedsRewrite { units, .. } => Err(format!(
            "rewrite still leaves a {units}-unit chunk over hard {}",
            params.hard
        )),
        PlanOutcome::SentenceLevel(_) => Err("rewrite carries no usable block evidence".to_owned()),
    }
}

/// 块对齐边载体主流程：dedicated `align-edges/1` 首轮 → 一次全局修复 →
/// 改写轮（`align-rewrite/1`，无修复）→ 纯锚点块对齐 → 确定性兜底。
#[allow(clippy::too_many_arguments)]
fn run_edges_carrier<'a>(
    doc: &TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &AlignOptions,
    params: &TransParams,
    pending: Vec<Pending<'a>>,
    fused_rewrites: Vec<(Pending<'a>, String)>,
    llm_aligner: &str,
    on_attempt: &mut dyn FnMut(&AlignBatchAttempt<'_>),
    writes: &mut Vec<AlignWrite>,
    display_writes: &mut Vec<(String, TransDisplay)>,
    outcome: &mut AlignOutcome,
) -> Result<(), LlmError> {
    let lang = options.lang.as_str();
    let page_budget = options.page_budget.max(1);
    let protected_terms = {
        let mut terms: Vec<String> = pending
            .iter()
            .chain(fused_rewrites.iter().map(|(item, _)| item))
            .flat_map(|item| item.protected_terms.iter().cloned())
            .collect();
        terms.sort();
        terms.dedup();
        terms
    };

    // 改写队列：融合草稿判定的 + dedicated 轮判定的。
    let mut rewrite_hints: Vec<(&Pending, String)> = fused_rewrites
        .iter()
        .map(|(item, hint)| (item, hint.clone()))
        .collect();
    let mut failed: Vec<&Pending> = Vec::new();
    let mut repair_reasons: Vec<String> = Vec::new();

    if !pending.is_empty() {
        let items: Vec<(&Pending, Option<&str>)> =
            pending.iter().map(|item| (item, None)).collect();
        let batches = edges_batches(&items, params, &doc.lang, lang, page_budget);
        let tables: Vec<AlignEdgesInput> = batches
            .iter()
            .map(|batch| edges_input(batch, params, lang, false))
            .collect();
        let requests: Vec<LlmRequest> = tables
            .iter()
            .map(|table| {
                edges_request(
                    table,
                    params,
                    options.instructions.as_deref(),
                    &protected_terms,
                    None,
                )
            })
            .collect();
        let results = llm.complete_batch(&requests);
        debug_assert_eq!(results.len(), batches.len());
        for (index, (batch, result)) in batches.iter().zip(results).enumerate() {
            match result {
                Ok(raw) => edges_attempt(
                    doc,
                    options,
                    params,
                    batch,
                    &tables[index],
                    &requests[index].user,
                    &raw,
                    &format!("b{:03}", index + 1),
                    1,
                    llm_aligner,
                    on_attempt,
                    writes,
                    outcome,
                    &mut rewrite_hints,
                    &mut failed,
                    &mut repair_reasons,
                ),
                Err(error) if error.is_retryable() => {
                    failed.extend(batch.iter().map(|(item, _)| *item));
                    repair_reasons.push(error.to_string());
                }
                Err(error) => return Err(error),
            }
        }
    }

    for _ in 0..options.repair_calls.min(GLOBAL_REPAIR_CALLS) {
        if failed.is_empty() {
            break;
        }
        let repair_batch = std::mem::take(&mut failed);
        let items: Vec<(&Pending, Option<&str>)> =
            repair_batch.iter().map(|item| (*item, None)).collect();
        let batches = edges_batches(&items, params, &doc.lang, lang, page_budget);
        let tables: Vec<AlignEdgesInput> = batches
            .iter()
            .map(|batch| edges_input(batch, params, lang, false))
            .collect();
        let round_ids: Vec<&str> = repair_batch
            .iter()
            .map(|item| item.sentence.id.as_str())
            .collect();
        let requests: Vec<LlmRequest> = batches
            .iter()
            .enumerate()
            .map(|(index, batch)| {
                let batch_ids: BTreeSet<&str> = batch
                    .iter()
                    .map(|(item, _)| item.sentence.id.as_str())
                    .collect();
                let mut batch_problems: Vec<String> = Vec::new();
                let mut omitted = 0usize;
                for problem in &repair_reasons {
                    if batch_ids.iter().any(|id| problem_mentions_id(problem, id)) {
                        batch_problems.push(problem.clone());
                    } else if round_ids.iter().any(|id| problem_mentions_id(problem, id)) {
                        omitted += 1;
                    } else {
                        batch_problems.push(problem.clone());
                    }
                }
                let mut reason = format!(
                    "Previous answer was rejected for the sentences below. Return the same table with ONLY td.tgt rewritten as <span data-src> chunks whose concatenation equals the translation exactly, ordinals within 1..word count and each used at most once.\nProblems:\n{}",
                    batch_problems
                        .iter()
                        .map(|problem| format!("- {problem}"))
                        .collect::<Vec<_>>()
                        .join("\n")
                );
                if omitted > 0 {
                    reason.push_str(&format!(
                        "\n({omitted} more problem(s) belong to sentences handled by parallel repair calls)"
                    ));
                }
                edges_request(
                    &tables[index],
                    params,
                    options.instructions.as_deref(),
                    &protected_terms,
                    Some(reason),
                )
            })
            .collect();
        let results = llm.complete_batch(&requests);
        debug_assert_eq!(results.len(), batches.len());
        let mut next_reasons: Vec<String> = Vec::new();
        for (index, (batch, result)) in batches.iter().zip(results).enumerate() {
            match result {
                Ok(raw) => edges_attempt(
                    doc,
                    options,
                    params,
                    batch,
                    &tables[index],
                    &requests[index].user,
                    &raw,
                    &format!("r{:03}", index + 1),
                    2,
                    llm_aligner,
                    on_attempt,
                    writes,
                    outcome,
                    &mut rewrite_hints,
                    &mut failed,
                    &mut next_reasons,
                ),
                Err(error) if error.is_retryable() => {
                    failed.extend(batch.iter().map(|(item, _)| *item));
                    next_reasons.push(error.to_string());
                }
                Err(error) => return Err(error),
            }
        }
        repair_reasons = next_reasons;
    }

    // 改写轮：一次批调用，无修复；未通过一律整句对应（自然译句）。
    if !rewrite_hints.is_empty() {
        let items: Vec<(&Pending, Option<&str>)> = rewrite_hints
            .iter()
            .map(|(item, hint)| (*item, Some(hint.as_str())))
            .collect();
        let batches = edges_batches(&items, params, &doc.lang, lang, page_budget);
        let tables: Vec<AlignEdgesInput> = batches
            .iter()
            .map(|batch| edges_input(batch, params, lang, true))
            .collect();
        let requests: Vec<LlmRequest> = tables
            .iter()
            .map(|table| {
                edges_request(
                    table,
                    params,
                    options.instructions.as_deref(),
                    &protected_terms,
                    None,
                )
            })
            .collect();
        let results = llm.complete_batch(&requests);
        debug_assert_eq!(results.len(), batches.len());
        for (index, (batch, result)) in batches.iter().zip(results).enumerate() {
            let raw = match result {
                Ok(raw) => raw,
                Err(error) if error.is_retryable() => {
                    for (item, _) in batch {
                        let input = plan_input(
                            doc,
                            options,
                            item,
                            params,
                            &item.translation,
                            lang,
                            TextBasis::Trans,
                            llm_aligner,
                        );
                        write_sentence_level(
                            doc,
                            item,
                            lang,
                            params,
                            sentence_level_entry(&input, None),
                            &format!("rewrite call failed ({error})"),
                            writes,
                            outcome,
                        );
                    }
                    continue;
                }
                Err(error) => return Err(error),
            };
            let parsed = parse_align_edges(&tables[index], Some(&requests[index].user), &raw);
            let mut blocked: BTreeMap<String, String> = BTreeMap::new();
            for problem in &parsed.diagnostics.problems {
                if let ProblemScope::Sentence { id } = &problem.scope {
                    blocked
                        .entry(id.clone())
                        .or_insert_with(|| format!("[{}] {}", problem.code, problem.detail));
                }
            }
            let mut batch_accepted = true;
            for (item, _) in batch {
                let id = item.sentence.id.as_str();
                let verdict = match (blocked.get(id), parsed.group(id)) {
                    (Some(problem), _) => Err(problem.clone()),
                    (None, None) => Err("missing from the rewrite answer".to_owned()),
                    (None, Some(group)) if group.chunks.is_empty() => {
                        Err("rewrite carries no <span data-src> chunk annotation".to_owned())
                    }
                    (None, Some(group)) => accept_rewrite(
                        doc,
                        options,
                        params,
                        item,
                        &group.text,
                        &group.chunks,
                        llm_aligner,
                    ),
                };
                match verdict {
                    Ok((Some(display), entry)) => {
                        display_writes.push((id.to_owned(), display));
                        push_write(
                            writes,
                            outcome,
                            id.to_owned(),
                            entry,
                            WriteCredit::Rewritten,
                        );
                        outcome.violations.push(format!(
                            "{id}: display text rewritten into source clause order (transDisplay, {MONOTONIC_REWRITE_BASIS}) — verify no meaning shifted"
                        ));
                    }
                    Ok((None, entry)) => {
                        // 文本一字未改，只是块切细到能进 DP：按常规对齐入库，
                        // 不写 transDisplay，也不让用户去核对不存在的改写。
                        push_write(writes, outcome, id.to_owned(), entry, WriteCredit::Aligned);
                        outcome.violations.push(format!(
                            "{id}: rewrite turn kept the text unchanged; accepted from its finer chunks"
                        ));
                    }
                    Err(reason) => {
                        batch_accepted = false;
                        let input = plan_input(
                            doc,
                            options,
                            item,
                            params,
                            &item.translation,
                            lang,
                            TextBasis::Trans,
                            llm_aligner,
                        );
                        write_sentence_level(
                            doc,
                            item,
                            lang,
                            params,
                            sentence_level_entry(&input, None),
                            &format!("monotonic rewrite rejected: {reason}"),
                            writes,
                            outcome,
                        );
                    }
                }
            }
            on_attempt(&PageAttempt {
                page_id: &format!("w{:03}", index + 1),
                attempt: 1,
                input: &requests[index].user,
                output: &raw,
                problems: &parsed.diagnostics.problems,
                accepted: batch_accepted,
            });
        }
    }

    // 修复预算耗尽：先试纯锚点块对齐，再落确定性目标语切分。
    if !failed.is_empty() {
        let detail = repair_reasons.join("; ");
        for item in failed {
            let id = item.sentence.id.as_str();
            let input = plan_input(
                doc,
                options,
                item,
                params,
                &item.translation,
                lang,
                TextBasis::Trans,
                ANCHOR_ALIGNER_TAG,
            );
            let edges = anchor_edges(item, &doc.lang, lang, &item.translation);
            if let PlanOutcome::Aligned(entry) = plan_sentence(&edges, &input) {
                push_write(writes, outcome, id.to_owned(), entry, WriteCredit::Aligned);
                outcome.violations.push(format!(
                    "{id}: aligned from deterministic anchors only after the global repair budget — {detail}"
                ));
                continue;
            }
            push_write(
                writes,
                outcome,
                id.to_owned(),
                fallback_word_entry(doc, item, &item.translation, lang, params),
                WriteCredit::Fallback,
            );
            outcome.violations.push(format!(
                "{id}: fell back to deterministic target split after the global repair budget — {detail}"
            ));
        }
    }
    Ok(())
}

// ---- 表格载体（`align-table/1`，审阅/修复） ---------------------------------

/// Put the same paired constraint into both the payload and final acceptance.
/// Previously the prompt could demand 8 rows while the table advertised max=4.
fn prepare_table_constraints(
    table: &mut AlignTableInput,
    paired: &BTreeMap<String, PairedRequirement>,
) -> Result<(), LlmError> {
    for sentence in &mut table.sentences {
        if let Some(requirement) = paired.get(&sentence.id) {
            sentence.suggested_pieces.0 = sentence.suggested_pieces.0.max(requirement.required);
            sentence.suggested_pieces.1 =
                sentence.suggested_pieces.1.max(sentence.suggested_pieces.0);
            sentence.no_rewrite = true;
        }
    }
    crate::filepipe::align_table::validate_input_constraints(table).map_err(LlmError::Terminal)
}

/// 两列切分表载体主流程：首轮批调用 → 一次全局修复 → 救回答案 / 确定性兜底。
#[allow(clippy::too_many_arguments)]
fn run_table_carrier<'a>(
    doc: &TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &AlignOptions,
    params: &TransParams,
    pending: Vec<Pending<'a>>,
    paired_requirements: &BTreeMap<String, PairedRequirement>,
    on_attempt: &mut dyn FnMut(&AlignBatchAttempt<'_>),
    writes: &mut Vec<AlignWrite>,
    display_writes: &mut Vec<(String, TransDisplay)>,
    outcome: &mut AlignOutcome,
) -> Result<(), LlmError> {
    let params = *params;
    // manyToOne：所有首轮批次一次性经 `complete_batch` 挂出（agent 执行器
    // 会同时落盘全部请求，供多个 worker 并行认领）；失败句跨批聚合后共享
    // 一次修复调用，避免"每批重试 × 二分"的乘法放大。
    // 任务级术语并集：见 `task_protected_terms` —— 契约文件按 (kind, attempt)
    // 共享，system prompt 必须与批次组成无关。
    let protected_terms = task_protected_terms(&pending);
    // paired 补行轮的候选句：这一轮的全部工作就是重选源文切点，改写译文帮不上忙。
    // 不写进载体的话，`data-reordered="true"` 就是一条校验认账、验收不认的岔路：
    // 校验按重排的宽阈值放行，而 paired 验收只按原始 `trans` 度量数行，于是整批
    // 答案在提交后被逐句拒掉（实测 38 个候选 → 38 拒 → 0 修）。
    let no_rewrite: BTreeSet<String> = pending
        .iter()
        .filter(|item| options.density_for(&item.sentence.id) == AlignDensity::Paired)
        .map(|item| item.sentence.id.clone())
        .collect();
    let mut batches: Vec<Vec<&Pending>> = Vec::new();
    let mut cursor = 0_usize;
    let page_budget = options.page_budget.max(1);
    let pending_refs = pending.iter().collect::<Vec<_>>();
    for size in align_page_sizes(
        &pending_refs,
        &params,
        &doc.lang,
        &options.lang,
        page_budget,
    ) {
        batches.push(pending_refs[cursor..cursor + size].to_vec());
        cursor += size;
    }
    // file-v1：渲染输入必须保留下来——`parse_align_table` 拿它做对账基准与
    // §16 体积护栏基准，工件也要落这一份「实际发出去的文本」。
    let mut declared_unsplittable: BTreeSet<String> = BTreeSet::new();
    let mut file_tables: Vec<AlignTableInput> = batches
        .iter()
        .map(|batch| {
            align_table_input(
                batch,
                &params,
                &doc.lang,
                &options.lang,
                &BTreeSet::new(),
                &no_rewrite,
            )
        })
        .collect();
    for table in &mut file_tables {
        prepare_table_constraints(table, paired_requirements)?;
    }
    let requests: Vec<LlmRequest> = batches
        .iter()
        .enumerate()
        .map(|(index, _batch)| {
            align_request_file(
                &file_tables[index],
                &params,
                &doc.lang,
                options.instructions.as_deref(),
                &protected_terms,
                None,
            )
        })
        .collect();
    let mut failed: Vec<&Pending> = Vec::new();
    let mut repair_reasons: Vec<String> = Vec::new();
    // 跨批、跨轮聚合的"结构完好但没过验收"答案。后一轮同 id 覆盖前一轮
    //（`extend` 语义 + 批与句的遍历顺序都是确定的），落库前才被消费。
    let mut salvage: std::collections::BTreeMap<String, AcceptedPieces> =
        std::collections::BTreeMap::new();
    let results = llm.complete_batch(&requests);
    debug_assert_eq!(results.len(), batches.len());
    for (index, (batch, result)) in batches.iter().zip(results).enumerate() {
        let attempt = match result {
            Ok(raw) => align_attempt_from_file(
                batch,
                &params,
                &doc.lang,
                &options.lang,
                &file_tables[index],
                &requests[index].user,
                &raw,
                &format!("b{:03}", index + 1),
                1,
                &mut declared_unsplittable,
                on_attempt,
            ),
            Err(error) => Err(error),
        };
        match attempt {
            Ok(attempt) => {
                let (accepted, salvaged, failed_keys, problems) = attempt.into_parts(batch);
                salvage.extend(salvaged);
                accept_resolved(
                    doc,
                    &options.lang,
                    batch,
                    &accepted,
                    writes,
                    display_writes,
                    outcome,
                );
                if !failed_keys.is_empty() {
                    failed.extend(
                        batch
                            .iter()
                            .copied()
                            .filter(|item| failed_keys.contains(&item.sentence.id)),
                    );
                    repair_reasons.extend(problems);
                }
            }
            Err(error) if error.is_retryable() => {
                failed.extend(batch.iter().copied());
                repair_reasons.push(error.to_string());
            }
            Err(error) => return Err(error),
        }
    }

    for _ in 0..options.repair_calls.min(GLOBAL_REPAIR_CALLS) {
        if failed.is_empty() {
            break;
        }
        let repair_batch = std::mem::take(&mut failed);
        // 修复轮按首轮同一套口径切批。`GLOBAL_REPAIR_CALLS` 限的是"重发几轮"
        // 而不是"一轮几个调用"：跨批聚合避免的是"每批重试 × 二分"的乘法
        // 放大；失败集合仍按同一套词数、句数和复杂度约束切成并行调用，轮数
        // 与最终的确定性草稿兜底都不变。
        let mut repair_batches: Vec<Vec<&Pending>> = Vec::new();
        let mut repair_cursor = 0_usize;
        for size in align_page_sizes(
            &repair_batch,
            &params,
            &doc.lang,
            &options.lang,
            page_budget,
        ) {
            repair_batches.push(repair_batch[repair_cursor..repair_cursor + size].to_vec());
            repair_cursor += size;
        }
        let carried_unsplittable = declared_unsplittable.clone();
        let mut repair_tables: Vec<AlignTableInput> = repair_batches
            .iter()
            .map(|batch| {
                align_table_input(
                    batch,
                    &params,
                    &doc.lang,
                    &options.lang,
                    &carried_unsplittable,
                    &no_rewrite,
                )
            })
            .collect();
        for table in &mut repair_tables {
            prepare_table_constraints(table, paired_requirements)?;
        }
        // problems 是本轮全体失败句的聚合清单，而每个修复调用的载体只含
        // 自己批次的句子。逐批过滤：只带本载体句子的问题 + 不指名句子的
        // 全局问题，其余按条数在 retryReason 里注明由并行修复调用处理。
        let round_ids: Vec<&str> = repair_batch
            .iter()
            .map(|item| item.sentence.id.as_str())
            .collect();
        let repair_requests: Vec<LlmRequest> = repair_batches
            .iter()
            .enumerate()
            .map(|(index, batch)| {
                let batch_ids: BTreeSet<&str> =
                    batch.iter().map(|item| item.sentence.id.as_str()).collect();
                let mut batch_problems: Vec<String> = Vec::new();
                let mut omitted = 0usize;
                for problem in &repair_reasons {
                    if batch_ids.iter().any(|id| problem_mentions_id(problem, id)) {
                        batch_problems.push(problem.clone());
                    } else if round_ids.iter().any(|id| problem_mentions_id(problem, id)) {
                        omitted += 1;
                    } else {
                        batch_problems.push(problem.clone());
                    }
                }
                let reason = repair_reason_file(
                    batch,
                    &params,
                    &doc.lang,
                    &options.lang,
                    &batch_problems,
                    omitted,
                );
                align_request_file(
                    &repair_tables[index],
                    &params,
                    &doc.lang,
                    options.instructions.as_deref(),
                    &protected_terms,
                    Some(reason),
                )
            })
            .collect();
        let repair_results = llm.complete_batch(&repair_requests);
        debug_assert_eq!(repair_results.len(), repair_batches.len());
        let mut next_reasons: Vec<String> = Vec::new();
        for (index, (batch, result)) in repair_batches.iter().zip(repair_results).enumerate() {
            let attempt = match result {
                Ok(raw) => align_attempt_from_file(
                    batch,
                    &params,
                    &doc.lang,
                    &options.lang,
                    &repair_tables[index],
                    &repair_requests[index].user,
                    &raw,
                    &format!("r{:03}", index + 1),
                    2,
                    &mut declared_unsplittable,
                    on_attempt,
                ),
                Err(error) => Err(error),
            };
            match attempt {
                Ok(attempt) => {
                    let (accepted, salvaged, failed_keys, problems) = attempt.into_parts(batch);
                    salvage.extend(salvaged);
                    accept_resolved(
                        doc,
                        &options.lang,
                        batch,
                        &accepted,
                        writes,
                        display_writes,
                        outcome,
                    );
                    if !failed_keys.is_empty() {
                        failed.extend(
                            batch
                                .iter()
                                .copied()
                                .filter(|item| failed_keys.contains(&item.sentence.id)),
                        );
                        next_reasons.extend(problems);
                    }
                }
                Err(error) if error.is_retryable() => {
                    failed.extend(batch.iter().copied());
                    next_reasons.push(error.to_string());
                }
                Err(error) => return Err(error),
            }
        }
        repair_reasons = next_reasons;
    }

    if !failed.is_empty() {
        let detail = repair_reasons.join("; ");
        for item in failed {
            // 修复预算耗尽。落 `fallback_word_entry` 的纯长度确定性切分之前
            // 先看有没有救回的 worker 答案——那是模型自己产出的、结构完好的
            // 切分，比 `reanchor_texts` 的等宽切严格更优（现场：兜底切分与
            // 载荷里的 draftTarget 逐字节相同，等于这一整轮 LLM 白跑）。
            if let Some(pieces) = salvage.remove(&item.sentence.id) {
                if let Some(text) = &pieces.revised_target {
                    display_writes.push((
                        item.sentence.id.clone(),
                        table_reorder_display(doc, &options.lang, item, text),
                    ));
                }
                push_write(
                    writes,
                    outcome,
                    item.sentence.id.clone(),
                    many_to_one_entry(doc, item, &pieces),
                    WriteCredit::Aligned,
                );
                note_declared_crossing(item, &pieces, outcome);
                for advisory in &pieces.advisories {
                    outcome
                        .violations
                        .push(format!("{}: {advisory}", item.sentence.id));
                }
                continue;
            }
            push_write(
                writes,
                outcome,
                item.sentence.id.clone(),
                fallback_word_entry(doc, item, &item.translation, &options.lang, &params),
                WriteCredit::Fallback,
            );
            outcome.violations.push(format!(
                "{}: fell back to deterministic target split after the global repair budget — {detail}",
                item.sentence.id
            ));
        }
    }

    Ok(())
}

/// 表格载体 `data-reordered` 改写 → `transDisplay`（自然译句 `trans` 不动）。
fn table_reorder_display(
    doc: &TranscriptDoc,
    lang: &str,
    item: &Pending,
    text: &str,
) -> TransDisplay {
    TransDisplay {
        text: text.to_owned(),
        basis: TABLE_REORDER_BASIS.to_owned(),
        trans_fingerprint: trans_fingerprint_for(doc, lang, &item.sentence.id, &item.translation),
    }
}

fn projected_word_indices(
    doc: &TranscriptDoc,
    sentence: &Sentence,
    ids: &[String],
) -> Result<Vec<usize>, LlmError> {
    if ids.is_empty() {
        return Err(LlmError::Malformed(format!(
            "{} has an empty visible-word projection",
            sentence.id
        )));
    }
    let mut output = Vec::with_capacity(ids.len());
    let mut cursor = 0_usize;
    for id in ids {
        let Some(offset) = sentence.word_indices[cursor..]
            .iter()
            .position(|&index| doc.words[index].id == *id)
        else {
            return Err(LlmError::Malformed(format!(
                "{} visible words are not an ordered subset of its source sentence",
                sentence.id
            )));
        };
        cursor += offset;
        output.push(sentence.word_indices[cursor]);
        cursor += 1;
    }
    Ok(output)
}

fn alignment_anchors_match(entry: &TransAlign, anchor_ids: &[String], projected: bool) -> bool {
    match entry.mode {
        AlignMode::ManyToOne => entry.words == anchor_ids,
        AlignMode::Independent => {
            if projected {
                entry.words == anchor_ids
            } else {
                entry.words.is_empty()
            }
        }
        AlignMode::OneToOne => false,
    }
}

/// manyToOne 的最后兜底：目标语先确定性切分，缝 lint 修复后再按片长比例
/// 锚到连续源词。不复用源 Cue 边界，避免兜底重新制造“一 Cue 一片”的错位。
fn fallback_word_entry(
    doc: &TranscriptDoc,
    item: &Pending,
    translation: &str,
    lang: &str,
    params: &TransParams,
) -> TransAlign {
    let texts = split_independent_for_lang_protected(
        translation,
        params,
        usize::MAX,
        lang,
        &item.protected_terms,
    );
    let texts = repair_lint_pieces(texts, lang, params);
    word_entry_from_texts(doc, item, texts, lang)
}

/// 目标片已定，按片长比例锚到连续源词（片多于源词时落 independent）。
fn word_entry_from_texts(
    doc: &TranscriptDoc,
    item: &Pending,
    texts: Vec<String>,
    lang: &str,
) -> TransAlign {
    if texts.len() > item.anchor_indices.len() {
        return TransAlign::new(
            AlignMode::Independent,
            (item.anchor_indices != item.sentence.word_indices)
                .then(|| {
                    item.anchor_indices
                        .iter()
                        .map(|&index| doc.words[index].id.clone())
                        .collect()
                })
                .unwrap_or_default(),
            texts
                .into_iter()
                .map(|text| TransPiece {
                    from: None,
                    to: None,
                    text,
                })
                .collect(),
        );
    }
    let word_texts: Vec<&str> = item
        .anchor_indices
        .iter()
        .map(|&index| doc.words[index].text.as_str())
        .collect();
    let pieces = reanchor_texts(texts, &word_texts, lang);
    let mut entry = TransAlign::new(
        AlignMode::ManyToOne,
        item.anchor_indices
            .iter()
            .map(|&index| doc.words[index].id.clone())
            .collect(),
        pieces,
    );
    entry.aligner = Some("deterministic/1".to_owned());
    entry
}

fn many_to_one_entry(doc: &TranscriptDoc, item: &Pending, pieces: &AcceptedPieces) -> TransAlign {
    if matches!(&pieces.anchor, AcceptedAnchor::Independent) {
        let mut entry = TransAlign::new(
            AlignMode::Independent,
            (item.anchor_indices != item.sentence.word_indices)
                .then(|| {
                    item.anchor_indices
                        .iter()
                        .map(|&index| doc.words[index].id.clone())
                        .collect()
                })
                .unwrap_or_default(),
            pieces
                .texts
                .iter()
                .map(|text| TransPiece {
                    from: None,
                    to: None,
                    text: text.trim().to_owned(),
                })
                .collect(),
        );
        entry.text_basis = if pieces.revised_target.is_some() {
            TextBasis::Display
        } else {
            TextBasis::Trans
        };
        return entry;
    }
    let AcceptedAnchor::WordRanges(ranges) = &pieces.anchor else {
        unreachable!("independent alignment returned above")
    };
    let words: Vec<String> = item
        .anchor_indices
        .iter()
        .map(|&index| doc.words[index].id.clone())
        .collect();
    // 模型自报的语序交叉（`data-crossing`）按 best-effort 接受：保留 worker 给
    // 的行切分与源切点，照常落块级条目。早先这里落整句对应（一块一片），
    // paired 补行轮因此把一份 4 行答案压成一片而被拒，屏幕上只剩旧条目失效后
    // 超 hard 的整句兜底行；按对齐块设计
    // §4.5 修订，交叉只让逐行对应「近似」，不再让整句降级。条目不写旧只读
    // 字段 `crossing`。
    let mut entry = TransAlign::new(
        AlignMode::ManyToOne,
        words,
        pieces
            .texts
            .iter()
            .zip(ranges)
            .map(|(text, &(from, to))| TransPiece {
                from: Some(from),
                to: Some(to),
                text: text.trim().to_owned(),
            })
            .collect(),
    );
    // `data-reordered` 改写只进 `transDisplay`，条目以 display 为基准。
    entry.text_basis = if pieces.revised_target.is_some() {
        TextBasis::Display
    } else {
        TextBasis::Trans
    };
    entry.aligner = Some(TABLE_ALIGNER_TAG.to_owned());
    entry
}

/// 自报交叉的句按 best-effort 落了逐行条目：留一条可见说明，行级对应只是近似。
fn note_declared_crossing(item: &Pending, pieces: &AcceptedPieces, outcome: &mut AlignOutcome) {
    if pieces.crossing && pieces.texts.len() > 1 {
        outcome.violations.push(format!(
            "{}: declared word-order crossing — kept the worker's {} rows and source cuts best-effort; row-level correspondence is approximate",
            item.sentence.id,
            pieces.texts.len()
        ));
    }
}

fn accept_resolved(
    doc: &TranscriptDoc,
    lang: &str,
    batch: &[&Pending],
    accepted: &std::collections::BTreeMap<String, AcceptedPieces>,
    writes: &mut Vec<AlignWrite>,
    display_writes: &mut Vec<(String, TransDisplay)>,
    outcome: &mut AlignOutcome,
) {
    for item in batch {
        let Some(pieces) = accepted.get(&item.sentence.id) else {
            continue;
        };
        if let Some(text) = &pieces.revised_target {
            display_writes.push((
                item.sentence.id.clone(),
                table_reorder_display(doc, lang, item, text),
            ));
        }
        push_write(
            writes,
            outcome,
            item.sentence.id.clone(),
            many_to_one_entry(doc, item, pieces),
            WriteCredit::Aligned,
        );
        note_declared_crossing(item, pieces, outcome);
        for advisory in &pieces.advisories {
            outcome
                .violations
                .push(format!("{}: {advisory}", item.sentence.id));
        }
    }
}

#[derive(Debug, Clone)]
struct AcceptedPieces {
    texts: Vec<String>,
    anchor: AcceptedAnchor,
    /// 模型自报的语序交叉；仅 ManyToOne 词锚条目落库。
    crossing: bool,
    /// 重排验收后的完整译句（已格式化）：非 None 时回写句级译文真相。
    revised_target: Option<String>,
    advisories: Vec<String>,
}

#[derive(Debug, Clone)]
enum AcceptedAnchor {
    WordRanges(Vec<(usize, usize)>),
    /// 目标片多于源词时不再伪造逐片双语对应；展示时间在整句时窗内按长度分配。
    Independent,
}

enum BatchAttempt {
    Accepted(std::collections::BTreeMap<String, AcceptedPieces>),
    Partial {
        accepted: std::collections::BTreeMap<String, AcceptedPieces>,
        /// 没通过验收、但结构上完好到足以比确定性兜底切分更优的答案。
        /// 不直接落库（还要给修复轮一次机会），只在修复预算耗尽时顶替
        /// `fallback_word_entry`。
        salvaged: std::collections::BTreeMap<String, AcceptedPieces>,
        failed_keys: Vec<String>,
        /// 逐条保留（不预先 join）：修复轮要把**每一条**失败原样复述给
        /// worker，join 成一行后既无法逐句归因，也读不出"还有几条要一起改"。
        problems: Vec<String>,
    },
    AllFailed {
        salvaged: std::collections::BTreeMap<String, AcceptedPieces>,
        problems: Vec<String>,
    },
}

impl BatchAttempt {
    fn into_parts(
        self,
        batch: &[&Pending],
    ) -> (
        std::collections::BTreeMap<String, AcceptedPieces>,
        std::collections::BTreeMap<String, AcceptedPieces>,
        Vec<String>,
        Vec<String>,
    ) {
        match self {
            Self::Accepted(accepted) => (
                accepted,
                std::collections::BTreeMap::new(),
                Vec::new(),
                Vec::new(),
            ),
            Self::Partial {
                accepted,
                salvaged,
                failed_keys,
                problems,
            } => (accepted, salvaged, failed_keys, problems),
            Self::AllFailed { salvaged, problems } => (
                std::collections::BTreeMap::new(),
                salvaged,
                batch.iter().map(|item| item.sentence.id.clone()).collect(),
                problems,
            ),
        }
    }
}

/// 一条 problem 文案是否指名了句 `id`。
///
/// 失败文案没有统一结构（`"{id}: …"`、`"Alignment missing sentence: {id}"`、
/// 传输错误串……），只能按子串匹配；句 id 含点号且互为前缀（`s-g6.1` 是
/// `s-g6.18` 的前缀），命中处的后一个字符必须不是字母数字或点号才算词边界。
fn problem_mentions_id(problem: &str, id: &str) -> bool {
    let mut start = 0usize;
    while let Some(pos) = problem[start..].find(id) {
        let hit = start + pos;
        let end = hit + id.len();
        let boundary_after = problem[end..]
            .chars()
            .next()
            .is_none_or(|c| !c.is_ascii_alphanumeric() && c != '.');
        let boundary_before = problem[..hit]
            .chars()
            .next_back()
            .is_none_or(|c| !c.is_ascii_alphanumeric() && c != '-' && c != '.');
        if boundary_after && boundary_before {
            return true;
        }
        start = end;
    }
    false
}

/// 修复轮 retryReason。两件事必须同时带上，否则 worker 只会盯着最后一条
/// 失败改，改完撞上别的判据再来一轮（而全局只有 [`GLOBAL_REPAIR_CALLS`]
/// 轮）：上一轮的逐条校验失败（不在本表的问题按条数注明，避免 worker 对着
/// 找不到的句子空转），以及预算与建议片数的复述——修复轮载荷是重新渲染的
/// 表格，约束复述用 `data-budget` 的口径（每行阈值 + 建议片数）。
fn repair_reason_file(
    batch: &[&Pending],
    params: &TransParams,
    source_lang: &str,
    target_lang: &str,
    problems: &[String],
    omitted_problems: usize,
) -> String {
    let mut reason = format!(
        "Repair only the remaining {} sentences. The table below is freshly rendered; re-segment each group from scratch.",
        batch.len()
    );
    if !problems.is_empty() {
        reason.push_str(
            "\nEvery validation problem from the previous round — fix all of them, not only the last one:",
        );
        for problem in problems {
            reason.push_str("\n- ");
            reason.push_str(problem);
        }
    }
    if omitted_problems > 0 {
        reason.push_str(&format!(
            "\n({omitted_problems} further problem(s) from the previous round concern sentences repaired in parallel calls and are not in this table.)"
        ));
    }
    reason.push_str(&format!(
        "\nConstraints restated for these sentences (unchanged from the first round and still binding; budgets fit={} soft={} hard={}):",
        params.fit, params.soft, params.hard
    ));
    for item in batch {
        let plan = length_plan(item, params, source_lang, target_lang);
        reason.push_str(&format!(
            "\n- {}: rows min={} max={} recommended={}",
            item.sentence.id,
            plan.piece_count.min,
            plan.piece_count.max,
            plan.piece_count.recommended
        ));
    }
    reason
}

/// 任务级受保护术语并集。system prompt（= agent 模式落盘的
/// `contracts/align*.md`）必须对同一任务的所有批次、所有轮次逐字节一致：
/// 契约文件按 `(kind, attempt)` 共享一份，逐批派生术语会让后写的批次覆盖
/// 先写批次的清单（worker 读到的契约缺自己批次的术语），修复轮的失败句
/// 子集还会让 `align-2.md` 整节丢失。术语对不含它的句子是无害的 no-op，
/// 全集换稳定性划算。
fn task_protected_terms(pending: &[Pending]) -> Vec<String> {
    let mut protected_terms = pending
        .iter()
        .flat_map(|item| item.protected_terms.iter().cloned())
        .collect::<Vec<_>>();
    protected_terms.sort();
    protected_terms.dedup();
    protected_terms
}

// ---- file-v1 载体（HTML 表格，设计 §8） -----------------------------------

/// 文件契约载体里的源文标记串。
///
/// 停顿档位按 [`crate::engines::markers::pause_marks`]（0.6 / 1.0 / 1.8 秒），
/// 与 polish / translate 载体同一套阈值。align.rs 私有的 [`pause_tier`]
/// （1.2 / 0.6 / 0.25）服务确定性草稿与边界提示，**不得**跨进文件载体——
/// 两套阈值混用会让同一段音频在不同阶段的文档里显示不同的停顿提示。
fn file_source_marked(words: &[PendingWord]) -> String {
    let mut out = String::new();
    for (index, word) in words.iter().enumerate() {
        if index > 0 {
            let marks = markers::pause_marks(word.t0 - words[index - 1].t1);
            if !marks.is_empty() {
                out.push(' ');
                out.push_str(&marks);
                out.push(' ');
            } else if needs_space_between(
                words[index - 1].text.chars().next_back(),
                word.text.chars().next(),
            ) {
                out.push(' ');
            }
        }
        out.push_str(&word.text);
    }
    out
}

/// 一批 `Pending` → align 表渲染输入（§8.2）。
///
/// 建议片数取 [`length_plan`] 的 `min..max`。
/// 秒数、word id、源 Cue 边界与绝对时间戳一律不进载体。
/// `unsplittable` 是**回带**字段：首轮 worker 自述「这句没有合法切点」时，
/// 修复轮要把这个自述带回去复核，而不是当作没说过（§8.2）。首轮传空集。
fn align_table_input(
    batch: &[&Pending],
    params: &TransParams,
    source_lang: &str,
    target_lang: &str,
    unsplittable: &BTreeSet<String>,
    no_rewrite: &BTreeSet<String>,
) -> AlignTableInput {
    let sentences = batch
        .iter()
        .map(|item| {
            let plan = length_plan(item, params, source_lang, target_lang);
            AlignSentenceInput {
                id: item.sentence.id.clone(),
                source: file_source_marked(&item.words),
                translation: item.translation.clone(),
                max_lines: 2,
                suggested_pieces: item
                    .frozen_target
                    .as_ref()
                    .filter(|pieces| !pieces.is_empty())
                    .map(|pieces| (pieces.len(), pieces.len()))
                    .unwrap_or((plan.piece_count.min, plan.piece_count.max)),
                unsplittable: unsplittable.contains(&item.sentence.id),
                no_rewrite: no_rewrite.contains(&item.sentence.id),
                frozen_target: item.frozen_target.clone().unwrap_or_default(),
            }
        })
        .collect();
    AlignTableInput {
        lang: target_lang.to_owned(),
        params: params.clone(),
        source_lang: source_lang.to_owned(),
        context_before: Vec::new(),
        sentences,
        context_after: Vec::new(),
    }
}

/// 文件契约的一次批调用请求（首轮与修复共用）。
fn align_request_file(
    table: &AlignTableInput,
    params: &TransParams,
    source_lang: &str,
    instructions: Option<&str>,
    protected_terms: &[String],
    retry_reason: Option<String>,
) -> LlmRequest {
    LlmRequest {
        kind: "align",
        system: align_system_prompt_file(params, source_lang, instructions, protected_terms),
        user: render_align_table(table),
        temperature: 0.1,
        attempt: if retry_reason.is_some() { 2 } else { 1 },
        retry_reason,
    }
}

/// 表格响应 → 批结果，并把这次尝试报给宿主（`ai/align/<lang>/vNNN`）。
///
/// 三步严格分层：`parse_align_table` 只做字符串/结构级判据（**唯一**一份，
/// 提交期 lint 走的是同一个函数），[`file_answers_from_parsed`] 把行片映射成
/// 句内词区间，[`accept_answers`] 是与 json-v0 共用的唯一验收核心。
#[allow(clippy::too_many_arguments)]
fn align_attempt_from_file(
    batch: &[&Pending],
    params: &TransParams,
    source_lang: &str,
    target_lang: &str,
    table: &AlignTableInput,
    payload: &str,
    raw: &str,
    page_id: &str,
    attempt_index: u32,
    unsplittable: &mut BTreeSet<String>,
    on_attempt: &mut dyn FnMut(&AlignBatchAttempt<'_>),
) -> Result<BatchAttempt, LlmError> {
    let parsed = parse_align_table(table, Some(payload), raw);
    // worker 的 data-unsplittable 自述回带给修复轮复核（§8.2）。
    unsplittable.extend(
        parsed
            .groups
            .iter()
            .filter(|group| group.unsplittable)
            .map(|group| group.id.clone()),
    );
    let (answers, pre_failures) = file_answers_from_parsed(batch, &parsed);
    let verdict = accept_answers(
        batch,
        params,
        source_lang,
        target_lang,
        answers,
        pre_failures,
    );
    let attempt = verdict.map(|(accepted, salvaged, failures)| {
        let failed_keys: Vec<String> = batch
            .iter()
            .filter(|item| !accepted.contains_key(&item.sentence.id))
            .map(|item| item.sentence.id.clone())
            .collect();
        if failed_keys.is_empty() {
            BatchAttempt::Accepted(accepted)
        } else if accepted.is_empty() {
            BatchAttempt::AllFailed {
                salvaged,
                problems: failures,
            }
        } else {
            BatchAttempt::Partial {
                accepted,
                salvaged,
                failed_keys,
                problems: failures,
            }
        }
    });
    // 无论验收结论如何都要出工件：审计与「这一轮到底发了什么」的取证价值
    // 恰恰在失败时最高。
    on_attempt(&PageAttempt {
        page_id,
        attempt: attempt_index,
        input: payload,
        output: raw,
        problems: &parsed.diagnostics.problems,
        accepted: matches!(attempt, Ok(BatchAttempt::Accepted(_))),
    });
    attempt
}

/// 句级 Problem 是否应当挡住这一句进入验收核心。
///
/// [`crate::filepipe::align_table`] 的字符串级 lint 同时报两类码：
/// **结构性不可用**（源文被改、译文为空、id 缺失/重复、拼接漂移……），这类
/// 答案没法当作有效切分读，必须挡在验收之外；以及**质量问题**
/// （[`ProblemCode::AlignOverHard`]、[`ProblemCode::AlignIllegalSeam`]）——
/// 这两码在 json-v0 里从来不是拒收理由：超 hard 的片走
/// `build_recut_candidate` → `enforce_target_hard_limit` → `repair_over_fit_pieces`
/// 确定性重切，坏接缝走 Recut/KeepWhole/Salvage 三档。若 file-v1 把它们
/// 也挡下，等于新载体比 json-v0 更严，还会白烧掉唯一一轮
/// [`GLOBAL_REPAIR_CALLS`] 并跌到只按长度切的兜底。故此处只挡结构码，
/// 质量码降级成 advisory 随答案进入同一份验收核心。
fn problem_blocks_acceptance(code: ProblemCode) -> bool {
    !matches!(
        code,
        ProblemCode::AlignOverHard | ProblemCode::AlignIllegalSeam
    )
}

/// 解析结果 → 载体无关的答案 IR + 逐句失败明细。
///
/// 结构性不可用的句子（[`problem_blocks_acceptance`]）直接判失败、不进验收：
/// 它们已经被 `parse_align_table` 判过一次，再送进 [`accept_answers`] 只会得到
/// 第二条描述同一件事的失败文案。质量码则降级成该句的 advisory，交给验收核心
/// 的 Recut/KeepWhole/Salvage 三档处理，与 json-v0 同口径。
fn file_answers_from_parsed(
    batch: &[&Pending],
    parsed: &AlignParsed,
) -> (Vec<SentenceAnswer>, Vec<String>) {
    let mut failures: Vec<String> = Vec::new();
    let mut blocked: BTreeSet<String> = BTreeSet::new();
    let mut quality: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for problem in &parsed.diagnostics.problems {
        match &problem.scope {
            crate::filepipe::ProblemScope::Sentence { id }
                if !problem_blocks_acceptance(problem.code) =>
            {
                quality
                    .entry(id.clone())
                    .or_default()
                    .push(format!("[{}] {}", problem.code, problem.detail));
            }
            crate::filepipe::ProblemScope::Sentence { id } => {
                blocked.insert(id.clone());
                failures.push(format!("{id}: [{}] {}", problem.code, problem.detail));
            }
            _ => failures.push(format!("[{}] {}", problem.code, problem.detail)),
        }
    }
    let inputs: std::collections::BTreeMap<&str, &&Pending> = batch
        .iter()
        .map(|item| (item.sentence.id.as_str(), item))
        .collect();
    let mut answers = Vec::with_capacity(parsed.groups.len());
    for group in &parsed.groups {
        if blocked.contains(&group.id) {
            continue;
        }
        let Some(input) = inputs.get(group.id.as_str()) else {
            continue;
        };
        let sources: Vec<String> = group
            .rows
            .iter()
            .map(|row| row.source.clone())
            .collect::<Vec<_>>();
        let (ranges, mut advisories) = match file_source_ranges(&group.id, &sources, &input.words) {
            Ok(mapped) => mapped,
            Err(detail) => {
                failures.push(detail);
                continue;
            }
        };
        if let Some(notes) = quality.get(&group.id) {
            advisories.extend(notes.iter().cloned());
        }
        if group.unsplittable {
            advisories.push(
                "worker marked the source as having no legal cut (data-unsplittable) — any over-ceiling row stays whole and `bcut check` reports it as translation-unsplittable"
                    .to_owned(),
            );
        }
        answers.push(SentenceAnswer {
            key: group.id.clone(),
            ranges,
            target_segments: group.rows.iter().map(|row| row.target.clone()).collect(),
            reordered: group.reordered,
            crossing: group.crossing,
            unsplittable: group.unsplittable,
            advisories,
        });
    }
    (answers, failures)
}

/// 表格源列 → 句内词序区间。
///
/// 先试逐字匹配（[`source_segments_to_ranges`]）；失败
/// 再退到归一化前缀吸附。[`normalize_chars`] 会抹掉标点、空白与 ⏸ 停顿标记
/// （`⏸` 的 Unicode 类目是 `OtherSymbol`，落在 `is_punctuation_or_symbol`
/// 里），所以模型顺手补写的标点不会让整句白白判失败，也不需要额外
/// `strip_markers`。切点吸到最近的词边界并留 advisory；段文本一律由词真相
/// 重建（`AnswerSource::Ranges` 分支），模型重抄的字符串永远不当锚。
fn file_source_ranges(
    key: &str,
    segments: &[String],
    words: &[PendingWord],
) -> Result<(Vec<(usize, usize)>, Vec<String>), String> {
    if let Ok(ranges) = source_segments_to_ranges(key, segments, words) {
        return Ok((ranges, Vec::new()));
    }
    if words.is_empty() {
        return Err(format!("{key}: source has no words"));
    }
    if segments.is_empty() {
        return Err(format!("{key}: no rows to map onto the source words"));
    }
    if segments.len() > words.len() {
        return Err(format!(
            "{key}: {} rows cannot map onto {} source words — merge the short rows",
            segments.len(),
            words.len()
        ));
    }
    // 词边界 i 处的归一化字符累计长度（bounds[0] == 0，bounds[n] == 总长）。
    let mut bounds = Vec::with_capacity(words.len() + 1);
    let mut total = 0usize;
    bounds.push(0usize);
    for word in words {
        total += normalize_chars(&word.text).chars().count();
        bounds.push(total);
    }
    if total == 0 {
        return Err(format!(
            "{key}: source words normalize to an empty string — cannot map rows onto them"
        ));
    }
    let mut ranges = Vec::with_capacity(segments.len());
    let mut cursor = 0usize;
    let mut consumed = 0usize;
    let mut snapped = 0usize;
    for (index, segment) in segments.iter().enumerate() {
        let seg_len = normalize_chars(segment).chars().count();
        if seg_len == 0 {
            return Err(format!(
                "{key}: row {} has an empty source cell — every row must map to at least one source word",
                index + 1
            ));
        }
        let end_word = if index + 1 == segments.len() {
            words.len()
        } else {
            // 后面还有 `remaining` 行，每行至少要留一个词。
            let remaining = segments.len() - index - 1;
            nearest_word_boundary(
                &bounds,
                consumed + seg_len,
                cursor + 1,
                words.len() - remaining,
            )
        };
        if bounds[end_word] != consumed + seg_len {
            snapped += 1;
        }
        ranges.push((cursor, end_word - 1));
        cursor = end_word;
        consumed = bounds[end_word];
    }
    let advisories = if snapped > 0 {
        vec![format!(
            "{snapped} source cut(s) were snapped to the nearest word boundary — the src cells did not reproduce the source words verbatim"
        )]
    } else {
        Vec::new()
    };
    Ok((ranges, advisories))
}

/// 在 `[low, high]` 这段词边界下标里，取累计长度最接近 `target` 的一个。
/// 并列时取靠前的，保证映射是确定性的。
fn nearest_word_boundary(bounds: &[usize], target: usize, low: usize, high: usize) -> usize {
    let mut best = low;
    let mut best_delta = bounds[low].abs_diff(target);
    for candidate in (low + 1)..=high {
        let delta = bounds[candidate].abs_diff(target);
        if delta < best_delta {
            best = candidate;
            best_delta = delta;
        }
    }
    best
}

// ---- 请求构造 -------------------------------------------------------------

/// align 契约（`file-v1`）：载体是 HTML 表格，输入没有任何草稿。
///
/// 切分证据是「把源文剪进 src 单元格」，没有 `useDraft` / `sourceBreaks`
/// 之类的协议字段可以引用。判据侧不存在第二份：所有拒收标准都由
/// `parse_align_table` + [`accept_answers`] 这一条链执行。
fn align_system_prompt_file(
    params: &TransParams,
    source_lang: &str,
    instructions: Option<&str>,
    protected_terms: &[String],
) -> String {
    let (source_fit, _) = source_piece_budgets(source_lang);
    let mut prompt = format!(
        r#"You are an expert bilingual subtitle segmenter. The input is ONE HTML table. Each `<tbody data-sid="…">` is one sentence with a single row: the `td.src` cell holds the exact spoken source, the `td.tgt` cell holds its complete translation. "⏸" marks an audio pause ("⏸⏸" longer, "⏸⏸⏸" longest); ⏸ marks are not words. `data-budget` restates the per-row width budget and the suggested piece count; `data-max-lines` is the display-row cap. `<tbody class="ctx">` groups carry no `data-sid` — they are read-only neighbouring context, never edit or emit them.

Work each sentence in two strictly ordered phases. First decide the target-language display pieces from the complete natural translation alone: readability, target-language syntax, protected terms, and the fit/hard limits determine these pieces. Freeze their text and boundaries. Only then split the source cell so that each target piece sits next to the consecutive source words expressing it. Never move, add, or remove a target cut merely to follow source timing, source wording, or an original subtitle cue. Exception: when a group carries `data-target-frozen`, that JSON array already contains target pieces validated during translation. Emit those exact pieces, one per row and in order; change only the source row boundaries. `data-reordered="true"` is forbidden for a frozen group, while `data-crossing="true"` remains available for genuine residual word-order crossing. A group carrying `data-no-rewrite="true"` is a re-cut round: its translation is already accepted, so `data-reordered="true"` is likewise forbidden there — keep every target character as given and only choose different cut points (use `data-crossing="true"` if the mapping genuinely crosses).

Original subtitle cue ids and cue boundaries are deliberately absent from the input. They are not evidence and must never be reconstructed or followed. The ⏸ pause marks are mapping aids only; they may choose where the source is cut after the target pieces are frozen, but must not decide the target pieces. If a faithful monotonic mapping is difficult, use the reorder/crossing policy below instead of distorting the target-language segmentation.

Output protocol — return the SAME table and nothing else (no markdown fences, no prose, no `<style>`, no commentary):
- Keep `<table>` and every `<tbody>` in the input order, keep every `data-sid` byte for byte, and emit every sentence exactly once. Do not invent ids.
- Replace each sentence's single row with ONE `<tr>` per display piece, in reading order: `<tr><td class="src">…</td><td class="tgt">…</td></tr>`. The first row of a group may keep the id `<th>`; set its `rowspan` to the number of rows (it is a redundancy check only).
- CRITICAL cell-role invariant: every output `td.src` must be a consecutive slice copied from the input `td.src`. Never translate, paraphrase, summarize, or copy any `td.tgt` text into `td.src`. If the source is English and the target is Chinese, every output `td.src` remains English. When a fine-grained mapping is uncertain, keep a larger consecutive source slice instead of inventing source text.
- The src cells of a group, concatenated, must reproduce that group's source EXACTLY (⏸ marks and punctuation may be dropped, nothing else may change): the source column is read-only, you only choose where to cut it.
- The tgt cells of a group, concatenated, must reproduce that group's translation EXACTLY — never normalize dashes or quotes, change punctuation, add, drop, translate, or reorder any character. The ONLY exception is a declared reorder (`data-reordered="true"`, below).
- Both columns therefore always have the same number of rows, and every sentence gets at least two rows unless its source genuinely has no legal cut.
- `data-reordered="true"` on the `<tbody>` declares that you rewrote the translation into the source clause order; `data-crossing="true"` declares residual crossing. They are mutually exclusive — never set both. `data-unsplittable="true"` declares that the source really has no legal cut, in which case emit the single whole row.
- Many-to-one is the DEFAULT shape: several consecutive short source phrases sharing ONE target piece is normal and good. Never add a target cut merely to mirror source rhythm, pauses, wording, or historical cue boundaries — cut the target only where its own length or readability requires it.

Length policy (this round is the only segmentation round — do not leave fixable long rows behind):
- Ceiling {hard}: every target piece should come in at ≤ {hard} display characters. An over-{hard} piece is NOT sent back for another attempt — the pipeline deterministically re-splits it at length-based cuts that ignore meaning. Add the cut yourself at the least-bad source boundary instead; a mismatched row is acceptable, a mechanical re-split reads worse. Only when that deterministic re-split would itself break bilingual anchoring does the pipeline keep the piece whole, and the leftover over-{hard} piece is then reported as an alignment defect — never treat that as a licence to leave a cuttable piece over the ceiling.
- Aim every target piece at ≤ {fit} display characters; {soft} or less reads best. {fit} is a hard constraint, not a preference: a piece wider than {fit} that has a FREE seam MUST be cut there now. A seam is free only when all four hold — both sides land at ≤ {fit}, neither side becomes a flash fragment, the seam breaks none of the Boundary-quality bans below, and the seam is backed by punctuation (，；：——、) or by whitespace that really exists in the target text. A space that only appears where CJK meets Latin is NOT a seam: never "担心 | AI 会抢走…". A piece with no free seam may stay in the {fit}..{hard} band — keep it whole rather than trading an over-wide row for a dangling tail. If you leave a free seam uncut, the pipeline cuts it there deterministically.
- The suggested piece count in `data-budget` is advice: you may exceed it when the target genuinely needs it, and you must not pad a balanced sentence to reach it.
- Display characters are measured with each CJK character counting 1, Latin letters and digits about half, whitespace and the trailing punctuation of a piece free.
- Keep pieces reasonably even: avoid a tiny fragment (≤3 target characters) beside a wide one, and avoid one-word source rows unless genuinely standalone. A target piece of {degenerate_units} display characters or more must map to at least {degenerate_words} source words — word-level highlighting otherwise stalls on one word while the row moves on. When the sentence has too few source words for that, let the neighbouring short phrases share one piece instead of slicing the source into crumbs. The source side also has a FLOOR, not just the ceiling below: in a sentence of two or more rows, no row may map to {fragment_words} or fewer source words whose combined width is under {fragment_units} source characters (same source-side counting as {source_fit}). Such a crumb — "So,", "and then", "I mean," — must be merged into the neighbouring row that continues its clause: forward into the following row when the crumb is a leading connective, adverbial or conditional opener, backward into the preceding row when it is a trailing tail; move the target cut together with it rather than leaving a target piece stranded on two words. As with the rule above, this floor is waived when the sentence simply has too few source words to give every row that much.
- Time budget: a viewer must be able to read each target piece within roughly the speech span of its source row. A wordy target piece over a couple of source words is unreadable — move the cut so that piece spans more source words, or let the short phrases share one row with a neighbour.
- Paired-row balance: source length alone never creates a target cut, with one exception below. When one source row exceeds its single-line budget ({source_fit} source characters, whitespace free — this budget is counted on the source side, not in target display units) AND its target piece already contains a complete target-language clause or parallel-action seam, use that target-natural seam so the bilingual row stays scannable. A Chinese 、 may be used only between complete parallel actions under this condition — both pieces must carry their own action verb ("更新技能、 | 检出分支"); never split a mere noun list for symmetry. This 、 cut is checked conservatively: the two source rows around it together must exceed {source_fit} source characters and both target pieces must contain a verb the checker recognizes as an action. If the answer is still reported for ending on the list separator 、, merge those two pieces instead of resubmitting the same cut.
- Paired-row ceiling (the exception): a source row wider than {source_hard} source characters is unreadable next to its target row and MUST be cut once, even when the target has no seam — unless the target piece is under {paired_target_min} target display characters or spans fewer than {paired_min_words} source words, in which case leave it alone. Choose the least-bad target boundary in this order: an existing clause seam; the end of a leading adverbial, conditional or prepositional phrase; before a connective (但/而且/所以/因为/以及) or between subject and predicate; any other word boundary that breaks none of the Boundary-quality bans. You MAY insert a target comma at the cut — punctuation is free, wording is not. Every resulting target piece must still be ≥4 display characters; if no boundary satisfies both that floor and the Boundary-quality bans, keep the row whole rather than producing a bad Chinese piece. One cut is enough: do not chase the source row down to {source_fit}, and never trade a readable target for a narrow source row.

Boundary quality (judgment, in priority order, only AFTER target pieces are frozen):
- Map target piece k to the closest consecutive source-word range expressing the same idea; prefer a natural monotonic mapping, not word-level symmetry. Source boundaries cannot revise the already-fixed target pieces.
- When target order crosses source order, first look for cuts that still keep rows aligned (the closest monotonic mapping often exists). If none exists, PREFER repairing the order: rewrite the target sentence so its clauses follow the source clause order, set `data-reordered="true"`, and put the rewritten sentence into the tgt cells. Adjust only what the new order requires (connectives, particles, punctuation); keep every meaning element, negation, number, name, term, and the register; never compress, expand, or re-translate — a reordered target whose length drifts beyond ~25% is rejected. Only when even reordering cannot produce a natural sentence: set `data-crossing="true"`, cut the TARGET at its own natural seams, and choose best-effort monotonic source cuts whose speech spans are roughly proportional to the paired target widths, so each row's display time matches its reading load; rows may then express different sub-ideas.
- Never cut inside a word or fixed expression, between a verb and its object, inside a name/number/product term, after a dangling connective, before a bound particle, or between an incomplete classifier/determiner and its head noun. In Chinese that means never "我们有一个 | 想改变的系统", "类似 | 于…", "…拆分给 | 各自…", "…转移到了 | …", or "…生成的 | 工作流"; such a row is rejected. Never cut inside a pair of quotes or brackets either — a piece must not end on an unclosed “ ‘ 「 《 （ 【 ( or [ and the next piece must not open with its orphaned closer; never "…包含名为“ | PluginDataJSON”的清单", keep the whole quoted or bracketed span in one piece unless the span itself reaches the hard ceiling (at or above it, splitting inside becomes unavoidable). Keep parallel constructions together (哪些…、哪些没有; both … and …). Prefer ；/。 seams over ，; treat 、 as a list separator except for the paired-row complete-action rule above, and never separate a unit/measure word from its number (never "1000 | 美元"). A Chinese piece that ends without punctuation must not end on a form that still requires what follows. The test is morphological, not a fixed word list: a 把/将 disposal phrase with no predicate yet, a transitive verb plus a directional or resultative complement (到/掉/出/成) with no object, an unclosed locative frame (在/从/对… plus 上/里/中/下/内/间), a pivotal 让/使/叫 phrase with no second predicate, a light verb missing its object, a copula 是 missing its complement — plus the particle 得, an adverb (如何/只是/同时/预先), the modal 可以, a quantifier still awaiting its head noun (一系列/一块), and a light verb plus 了 (采用了/内置了/提供了). Never "剩余的 35% 得 | 支撑每个活跃请求的…" or "输出质量在数学上 | 与…完全相同"; move that cut one or two words later, or keep the piece whole. Words that merely end in one of these characters (心得, 以上, 即将, 把握) are fine. Never cut before the coordinators 和/及/与/或 (including 或者/或是) either — never "它们是 KV 缓存 | 和 PagedAttention"; coordinated items stay in one piece, and a coordinator may open a piece only when the previous piece ends on punctuation. The mirror image is banned too: never cut after the second coordinated item and strand its head noun in the next piece (never "Key 和 Value | 矩阵").
- Keep every core predicate, negation, number, name, and main object in the row whose source words express it.

Before emitting the table, silently verify the output protocol, then improve seams and balance without unnecessary rows."#,
        fit = params.fit,
        soft = params.soft,
        hard = params.hard,
        source_fit = source_fit,
        source_hard = source_piece_hard(source_fit),
        paired_target_min = PAIRED_TARGET_MIN_UNITS,
        paired_min_words = PAIRED_MIN_SOURCE_WORDS,
        degenerate_units = DEGENERATE_TARGET_MIN_UNITS,
        degenerate_words = DEGENERATE_MIN_SOURCE_WORDS,
        fragment_words = FRAGMENT_MAX_SOURCE_WORDS,
        fragment_units = source_fragment_floor(source_fit),
    );
    if !protected_terms.is_empty() {
        prompt.push_str(&format!(
            "\n\nProtected target terms — each is an indivisible display atom. Never let a target row boundary fall inside one of these literal strings: {}",
            protected_terms.join(" · ")
        ));
    }
    if let Some(instructions) = instructions.filter(|text| !text.is_empty()) {
        prompt.push_str(&format!(
            "\n\nExplicit reviewer instructions for THIS batch (highest priority within the output protocol): {instructions}"
        ));
    }
    prompt
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PieceCountPlanJson {
    min: usize,
    max: usize,
    recommended: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SideLengthPlanJson {
    lang: String,
    unit: &'static str,
    total: usize,
    preferred_per_piece: [usize; 2],
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LengthPlanJson {
    piece_count: PieceCountPlanJson,
    source: SideLengthPlanJson,
    target: SideLengthPlanJson,
    target_display_units: usize,
    target_hard_display_units: usize,
}

/// 所有语言统一按字符度量长度；zh 是阅读单位（CJK=1、两个半角≈1，即
/// 半角格宽 ÷ 2），其余语言按非空白字符计。词数/어절数口径已废弃——
/// 词数低估视觉宽度（13 个长英文词可以宽过 100 半角格），是长片漏网的
/// 直接原因。切分原子性不受度量影响：切点协议仍是词边界（bN）。
fn length_unit_name(lang: &str) -> &'static str {
    if matches!(primary_subtag(lang).as_str(), "zh" | "ja" | "th") {
        "readingCharacter"
    } else {
        "character"
    }
}

fn text_length_units(text: &str, lang: &str) -> usize {
    target_cps_chars(text, lang)
}

fn source_length_units(words: &[PendingWord], lang: &str) -> usize {
    let joined = join_word_texts(words.iter());
    target_cps_chars(&joined, lang)
}

/// 源语侧"超过单行"触发阈值与建议片宽（与目标语同口径的字符单位）。只用于
/// 长句判定（fusion needs_split）与载荷建议，不参与片数下限——片数由译文
/// 阅读需求驱动（多对一默认形态）。42 与源 Cue 派生的单行上限一致。
pub(crate) fn source_piece_budgets(lang: &str) -> (usize, usize) {
    match primary_subtag(lang).as_str() {
        "zh" | "ja" | "th" => (16, 14),
        "ko" => (18, 15),
        _ => (42, 32),
    }
}

fn source_word_units(words: &[PendingWord], lang: &str) -> Vec<usize> {
    words
        .iter()
        .map(|word| target_cps_chars(&word.text, lang))
        .collect()
}

fn source_range_seconds(ends_sec: &[f64], from: usize, to: usize) -> f64 {
    let Some(&end) = ends_sec.get(to) else {
        return 0.0;
    };
    let start = from
        .checked_sub(1)
        .and_then(|index| ends_sec.get(index))
        .copied()
        .unwrap_or(0.0);
    (end - start).max(0.0)
}

fn source_range_is_dense(
    units: &[usize],
    ends_sec: &[f64],
    source_fit: usize,
    from: usize,
    to: usize,
) -> bool {
    if from > to || to >= units.len() {
        return false;
    }
    units[from..=to].iter().sum::<usize>() > source_fit
        || source_range_seconds(ends_sec, from, to) > PAIRED_SOURCE_MAX_SECONDS
}

/// 顿号两侧必须各自带有高置信动作谓词，才可能视为可独立展示的并列动作。
/// 这层词法护栏刻意保守：宁可把不确定结构继续当普通列表，也不能把
/// `GitLab、CircleCI`、`控制器、执行器` 一类名词枚举误切开。
fn contains_parallel_action(text: &str) -> bool {
    const ACTION_MARKERS: &[&str] = &[
        "关闭",
        "更新",
        "检出",
        "找出",
        "清理",
        "运行",
        "安装",
        "审阅",
        "创建",
        "切换",
        "检查",
        "获取",
        "生成",
        "打开",
        "保存",
        "添加",
        "删除",
        "修复",
        "发布",
        "部署",
        "编译",
        "测试",
        "处理",
        "设置",
        "使用",
        "发送",
        "返回",
        "纳入",
        "跟踪",
        "记录",
        "调用",
        "读取",
        "提交",
        "推送",
        "改代码",
        "改技能",
    ];
    ACTION_MARKERS.iter().any(|marker| text.contains(marker))
}

fn contains_cjk_clause_predicate(text: &str) -> bool {
    const PREDICATE_MARKERS: &[&str] = &[
        "有",
        "是",
        "会",
        "能",
        "要",
        "需",
        "可以",
        "能够",
        "应该",
        "属于",
        "意味着",
        "变得",
        "完成",
        "适用",
        "包含",
        "支持",
        "保持",
        "需要",
        "知道",
        "认为",
        "发现",
        "希望",
        "想要",
    ];
    contains_parallel_action(text) || PREDICATE_MARKERS.iter().any(|marker| text.contains(marker))
}

/// 配对密度护栏比一般的 fit 切分更保守：中文逗号左侧必须带有高置信谓词，
/// 避免把「实际操作中，| 因为…」这类状语前置片误当成完整小句。冒号、
/// 分号和破折号仍是自足的强语义缝。
fn paired_clause_seam(text: &str, lang: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    for (index, ch) in chars.iter().enumerate() {
        if !matches!(ch, '，' | '；' | '：' | '—' | ',' | ';' | ':') {
            continue;
        }
        if *ch == '—' && chars.get(index + 1) == Some(&'—') {
            continue;
        }
        let left: String = chars[..=index].iter().collect();
        let right: String = chars[index + 1..].iter().collect();
        if crate::split::piece_display_units(&left, lang) < 4
            || crate::split::piece_display_units(&right, lang) < 4
        {
            continue;
        }
        if primary_subtag(lang) == "zh"
            && matches!(ch, '，' | ',')
            && !contains_cjk_clause_predicate(&left)
        {
            continue;
        }
        let tail_start = index.saturating_sub(5);
        return Some(chars[tail_start..=index].iter().collect());
    }
    None
}

/// 双语配对模式允许使用的目标语自然缝。普通小句标点沿用既有规则；顿号只在
/// 两侧都是可独立阅读的完整并列动作时作为候选，最终仍由源跨度护栏决定是否
/// 真的保留该切点。
fn paired_balance_seam(text: &str, lang: &str) -> Option<String> {
    if let Some(seam) = paired_clause_seam(text, lang) {
        return Some(seam);
    }
    let chars: Vec<char> = text.chars().collect();
    for (index, ch) in chars.iter().enumerate() {
        if *ch != '、' || index + 1 >= chars.len() {
            continue;
        }
        let left: String = chars[..=index].iter().collect();
        let right: String = chars[index + 1..].iter().collect();
        if crate::split::piece_display_units(&left, lang) >= 4
            && crate::split::piece_display_units(&right, lang) >= 4
            && contains_parallel_action(&left)
            && contains_parallel_action(&right)
        {
            return Some(
                left.chars()
                    .rev()
                    .take(6)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect(),
            );
        }
    }
    None
}

fn allowed_balanced_list_seams(
    texts: &[String],
    ranges: &[(usize, usize)],
    source_units: &[usize],
    source_ends_sec: &[f64],
    source_fit: usize,
) -> BTreeSet<usize> {
    let mut allowed = BTreeSet::new();
    for index in 0..texts.len().saturating_sub(1) {
        if !is_parallel_action_list_seam(&texts[index], &texts[index + 1])
            || index + 1 >= ranges.len()
        {
            continue;
        }
        let from = ranges[index].0;
        let to = ranges[index + 1].1;
        if source_range_is_dense(source_units, source_ends_sec, source_fit, from, to) {
            allowed.insert(index);
        }
    }
    allowed
}

/// 「并列动作顿号缝」的词法半边：左片以 `、` 收尾，且两片都带高置信动作词。
/// 源跨度那半边由各调用方按手里的口径（词区间 / 源行文本）补上。
fn is_parallel_action_list_seam(left: &str, right: &str) -> bool {
    left.trim_end().ends_with('、')
        && contains_parallel_action(left)
        && contains_parallel_action(right)
}

/// align-table 载体（file-v1）的同一豁免：载荷不带词时间，只有每行源文，
/// 因此源跨度只取宽度半边——相邻两行源文合计（去停顿标记、空白不计）超过
/// 源语单行预算 `source_fit`。与 [`allowed_balanced_list_seams`] 共用词法与
/// 阈值，返回的是左片下标（与 `SeamLintIssue::piece_index` 同基）。
pub(crate) fn allowed_list_seam_indices_for_source_rows(
    targets: &[&str],
    sources: &[&str],
    source_lang: &str,
) -> BTreeSet<usize> {
    let (source_fit, _) = source_piece_budgets(source_lang);
    let width = |text: &str| text_length_units(&markers::strip_markers(text), source_lang);
    (0..targets.len().saturating_sub(1))
        .filter(|&index| index + 1 < sources.len())
        .filter(|&index| is_parallel_action_list_seam(targets[index], targets[index + 1]))
        .filter(|&index| width(sources[index]) + width(sources[index + 1]) > source_fit)
        .collect()
}

/// 已落库 manyToOne 条目中可以保留的“并列动作顿号缝”。`bcut check` 与
/// provider/Agent 验收共用同一动作词法和源跨度条件；普通名词列表返回空集。
pub fn allowed_list_seam_indices_for_ranges(
    texts: &[String],
    ranges: &[(usize, usize)],
    source_word_units: &[usize],
    source_word_ends_sec: &[f64],
    source_lang: &str,
) -> BTreeSet<usize> {
    let (source_fit, _) = source_piece_budgets(source_lang);
    allowed_balanced_list_seams(
        texts,
        ranges,
        source_word_units,
        source_word_ends_sec,
        source_fit,
    )
}

/// 源行硬上限（阅读单位）：单行预算的 1.5 倍。软档（`source_fit`）之上还留
/// 半行余量，是为了不把"略微超行但目标无缝"的正常多对一形态也拖进重切。
fn source_piece_hard(source_fit: usize) -> usize {
    source_fit * 3 / 2
}

/// 超出硬上限的源行诊断结果。`index` 是目标片下标，其余字段供 CLI 出具
/// 可读理由，不参与判定。
#[derive(Debug, Clone, PartialEq)]
pub struct SourceCeilingIssue {
    pub index: usize,
    pub units: usize,
    pub seconds: f64,
    pub target_units: usize,
    pub words: usize,
}

fn source_ceiling_issues(
    texts: &[String],
    ranges: &[(usize, usize)],
    source_units: &[usize],
    source_ends_sec: &[f64],
    source_fit: usize,
    target_lang: &str,
) -> Vec<SourceCeilingIssue> {
    let hard = source_piece_hard(source_fit);
    texts
        .iter()
        .zip(ranges)
        .enumerate()
        .filter_map(|(index, (text, &(from, to)))| {
            if from > to || to >= source_units.len() {
                return None;
            }
            let words = to - from + 1;
            if words < PAIRED_MIN_SOURCE_WORDS {
                return None;
            }
            let target_units = target_cps_chars(text, target_lang);
            if target_units < PAIRED_TARGET_MIN_UNITS {
                return None;
            }
            let units = source_units[from..=to].iter().sum::<usize>();
            let seconds = source_range_seconds(source_ends_sec, from, to);
            (units > hard || seconds > PAIRED_SOURCE_HARD_SECONDS).then_some(SourceCeilingIssue {
                index,
                units,
                seconds,
                target_units,
                words,
            })
        })
        .collect()
}

/// 源行宽度下限（阅读单位）：单行预算的四分之一。en 42→10、zh/ja/th 16→4、
/// ko 18→4。与 [`source_piece_hard`] 同样从 `source_piece_budgets` 派生，不
/// 另立口径。
fn source_fragment_floor(source_fit: usize) -> usize {
    source_fit / 4
}

/// 源行过窄（碎片配对行）的诊断结果。`index` 是目标片下标，其余字段供 CLI
/// 出具可读理由，不参与判定。
#[derive(Debug, Clone, PartialEq)]
pub struct SourceFragmentIssue {
    pub index: usize,
    pub units: usize,
    pub words: usize,
    pub target_units: usize,
}

/// 碎片配对行：某片只挂到 ≤ [`FRAGMENT_MAX_SOURCE_WORDS`] 个源词，且这些词的
/// 显示宽度不足 [`source_fragment_floor`]。补的是 `source_ceiling_issues` 的
/// **双豁免盲区**——那里 `words < PAIRED_MIN_SOURCE_WORDS` 或
/// `target_units < PAIRED_TARGET_MIN_UNITS` 直接返回 None，源侧只有上限没有
/// 下限，于是 "of a" / "then." / "and the" 一类碎渣永远无人认领。
///
/// 三道豁免（收窄而非删除既有豁免；短句仍不报）：
/// 1. 单片句不报：整句只有一片时，那片就是整句，谈不上碎片；
/// 2. 整句源词数不足 `片数 × FRAGMENT_MIN_SENTENCE_WORDS` 时不报（同
///    `degenerate_paired_row` 的算术豁免）；
/// 3. 目标片宽度 ≥ [`DEGENERATE_TARGET_MIN_UNITS`] 时不报——那是
///    `degenerate_paired_row` 的辖区（宽译文配窄源直接拒绝，且它对 ≥2 词区间
///    有一条经过审计的 40% 宽度豁免）。两条通道不得在同一片上重叠发声，否则
///    等于悄悄推翻那条豁免。
fn source_fragment_issues(
    texts: &[String],
    ranges: &[(usize, usize)],
    source_units: &[usize],
    source_fit: usize,
    target_lang: &str,
) -> Vec<SourceFragmentIssue> {
    if texts.len() != ranges.len() || texts.len() < 2 {
        return Vec::new();
    }
    if source_units.len() < ranges.len() * FRAGMENT_MIN_SENTENCE_WORDS {
        return Vec::new();
    }
    let floor = source_fragment_floor(source_fit);
    texts
        .iter()
        .zip(ranges)
        .enumerate()
        .filter_map(|(index, (text, &(from, to)))| {
            if from > to || to >= source_units.len() {
                return None;
            }
            let words = to - from + 1;
            if words > FRAGMENT_MAX_SOURCE_WORDS {
                return None;
            }
            let target_units = target_cps_chars(text, target_lang);
            if target_units >= DEGENERATE_TARGET_MIN_UNITS {
                return None;
            }
            let units = source_units[from..=to].iter().sum::<usize>();
            (units < floor).then_some(SourceFragmentIssue {
                index,
                units,
                words,
                target_units,
            })
        })
        .collect()
}

/// 最坏配对源行的原始几何：`(最大源行阅读单位, 最大源行时窗秒)`。
///
/// 刻意**不**套 `source_ceiling_issues` 的资格过滤（`PAIRED_MIN_SOURCE_WORDS`
/// / `PAIRED_TARGET_MIN_UNITS`）：这是护栏比较用的 incumbent 基线，取值越宽
/// 松越不容易误拒，方向上永远偏放行。
fn worst_source_row(
    ranges: &[(usize, usize)],
    source_units: &[usize],
    source_ends_sec: &[f64],
) -> (usize, f64) {
    ranges
        .iter()
        .filter(|&&(from, to)| from <= to && to < source_units.len())
        .fold((0usize, 0.0f64), |(units, seconds), &(from, to)| {
            (
                units.max(source_units[from..=to].iter().sum::<usize>()),
                seconds.max(source_range_seconds(source_ends_sec, from, to)),
            )
        })
}

/// 时窗比较容差：源词结束时刻按 0.1s 取整，浮点相等不能用裸 `>`。
const SOURCE_SECONDS_EPS: f64 = 1e-6;

/// 非回退护栏：定向修复轮交回的答案，不得把「越过配对源行上限」的最坏行做得
/// 比 incumbent 草稿更差。
///
/// 现场（Jeff Dean 项目 t-msr6a4xn / s-g123.0）：worker 为了凑
/// `pieceCount.min` 在句首加了最省事的一刀，最坏源行从草稿的 70 单位 /5.6s
/// 恶化到 110 单位 /8.6s，而引擎验收与 submit lint 都没有任何 incumbent 比较，
/// 这次净倒退就这么静默落库了。
///
/// 三条克制，保证只治倒退、不治「保持原样」：
/// 1. 只看答案里**仍然越档**的行；答案完全不越档时护栏结构性不触发（这保住
///    了 `source_ceiling_blocks_the_draft_but_never_rejects_the_answer` 之外
///    的所有普通答案）。
/// 2. 只在 incumbent 自身已越档的维度上生效：草稿在该维度是干净的，说明这轮
///    根本不是为该维度派出的定向修，没有据此拒绝的授权。
/// 3. 严格大于才拒；等宽（含 `sourceBreaks` 与草稿完全相同的空转答案）与改善
///    一律放行——空转是 `refine-align` 的续轮职责，不是验收门的。
fn source_ceiling_regression(
    issues: &[SourceCeilingIssue],
    draft_worst_units: usize,
    draft_worst_seconds: f64,
    source_fit: usize,
    piece_total: usize,
) -> Option<String> {
    let hard = source_piece_hard(source_fit);
    let units_eligible = draft_worst_units > hard;
    let seconds_eligible = draft_worst_seconds > PAIRED_SOURCE_HARD_SECONDS;
    if !units_eligible && !seconds_eligible {
        return None;
    }
    issues.iter().find_map(|issue| {
        let worse_units = units_eligible && issue.units > draft_worst_units;
        let worse_seconds =
            seconds_eligible && issue.seconds > draft_worst_seconds + SOURCE_SECONDS_EPS;
        (worse_units || worse_seconds).then(|| {
            format!(
                "piece {}/{piece_total} maps to a source row of {} display units / {:.1}s, worse than the incoming draft's worst row ({draft_worst_units} units / {draft_worst_seconds:.1}s) and still past the paired-row ceiling ({hard} units / {PAIRED_SOURCE_HARD_SECONDS:.1}s) — a targeted repair must hold or improve that worst row: cut the widest row instead of adding a cheap cut elsewhere, or keep the draft's boundaries",
                issue.index + 1,
                issue.units,
                issue.seconds
            )
        })
    })
}

/// 退化配对行：某条目标片宽度 ≥ [`DEGENERATE_TARGET_MIN_UNITS`] 却只配到
/// 少于 [`DEGENERATE_MIN_SOURCE_WORDS`] 个源词。返回首条违规行的
/// `(1 基片号, 源词数, 目标宽度)`。
///
/// 两道豁免，避免把不可满足的要求反复打回 worker：
/// 1. 整句源词数不足以让每片都拿到词数下限时不报（frozen 句片数已冻结，
///    再拒也只能落到 `fallback_word_entry` 的等比锚定）；
/// 2. 源区间有 ≥2 个词且自身显示宽度已达目标片的 40%（长标识符/长单词），说明
///    配对行在视觉上并不失衡——这是审计给出的两条判据里的第二条。宽度豁免不
///    覆盖单词区间：高亮按词推进，一个词无论多宽都只有一步。
pub fn degenerate_paired_row(
    texts: &[String],
    ranges: &[(usize, usize)],
    source_units: &[usize],
    target_lang: &str,
) -> Option<(usize, usize, usize)> {
    if texts.len() != ranges.len() || texts.len() < 2 {
        return None;
    }
    if source_units.len() < ranges.len() * DEGENERATE_MIN_SOURCE_WORDS {
        return None;
    }
    texts
        .iter()
        .zip(ranges)
        .enumerate()
        .find_map(|(index, (text, &(from, to)))| {
            if from > to || to >= source_units.len() {
                return None;
            }
            let words = to - from + 1;
            if words >= DEGENERATE_MIN_SOURCE_WORDS {
                return None;
            }
            let target_units = target_cps_chars(text, target_lang);
            if target_units < DEGENERATE_TARGET_MIN_UNITS {
                return None;
            }
            // 宽度豁免只适用于 ≥2 词的区间：逐字高亮按词推进，单词区间无论
            // 渲染多宽都只有一步，正是审计描述的观感断裂。
            let units = source_units[from..=to].iter().sum::<usize>();
            (words < 2 || units * 5 < target_units * 2).then_some((index + 1, words, target_units))
        })
}

/// 已落库 manyToOne 条目的源行硬上限诊断；`bcut check` 与草稿门共用，避免
/// CLI 复制阈值。硬档只做"报出并驱动定向重对齐"，不参与引擎验收拒绝——
/// 见 `evaluate_candidate` 处的说明。
pub fn source_ceiling_issues_for_ranges(
    texts: &[String],
    ranges: &[(usize, usize)],
    source_word_units: &[usize],
    source_word_ends_sec: &[f64],
    source_lang: &str,
    target_lang: &str,
) -> Vec<SourceCeilingIssue> {
    let (source_fit, _) = source_piece_budgets(source_lang);
    source_ceiling_issues(
        texts,
        ranges,
        source_word_units,
        source_word_ends_sec,
        source_fit,
        target_lang,
    )
}

/// 已落库 manyToOne 条目的源行宽度下限诊断；`bcut check` 与草稿门共用，避免
/// CLI 复制阈值。与硬上限同进同退：只"报出并驱动定向重对齐"，不参与引擎验收
/// 拒绝——见 `evaluate_candidate` 处的说明。
///
/// 整句上屏的降级路径**不**调用本函数：整句只有一片，按定义豁免。
pub fn source_fragment_issues_for_ranges(
    texts: &[String],
    ranges: &[(usize, usize)],
    source_word_units: &[usize],
    source_lang: &str,
    target_lang: &str,
) -> Vec<SourceFragmentIssue> {
    let (source_fit, _) = source_piece_budgets(source_lang);
    source_fragment_issues(texts, ranges, source_word_units, source_fit, target_lang)
}

/// 整句上屏形态的源行硬上限诊断。整句上屏本身就是一条“配对行”（源=整句词
/// 区间、目标=整句译文），必须服从与 manyToOne 单片完全相同的硬上限，因此
/// 直接复用 `source_ceiling_issues`：把整句当作唯一目标片、把整个词区间当作
/// 唯一源跨度。align 引擎的 `no_entry_needed` 门与 `bcut check` 的降级路径共
/// 用本函数，任何一侧都不得复制阈值。
///
/// 源侧 units 用与 `bcut check` 完全一致的口径逐词计算，`ends_sec` 相对首词
/// `t0` 归零并保留厘秒精度。
pub fn whole_sentence_source_ceiling_issue(
    source_words: &[&Word],
    translation: &str,
    source_lang: &str,
    target_lang: &str,
) -> Option<SourceCeilingIssue> {
    let first = source_words.first()?;
    let source_units = source_words
        .iter()
        .map(|word| target_cps_chars(&word.text, source_lang))
        .collect::<Vec<_>>();
    let source_ends_sec = source_words
        .iter()
        .map(|word| ((word.t1 - first.t0) * 10.0).round() / 10.0)
        .collect::<Vec<_>>();
    source_ceiling_issues_for_ranges(
        &[translation.to_owned()],
        &[(0, source_words.len() - 1)],
        &source_units,
        &source_ends_sec,
        source_lang,
        target_lang,
    )
    .into_iter()
    .next()
}

fn paired_density_issue(
    texts: &[String],
    ranges: &[(usize, usize)],
    source_units: &[usize],
    source_ends_sec: &[f64],
    source_fit: usize,
    target_lang: &str,
) -> Option<(usize, String)> {
    texts
        .iter()
        .zip(ranges)
        .enumerate()
        .find_map(|(index, (text, &(from, to)))| {
            if !source_range_is_dense(source_units, source_ends_sec, source_fit, from, to) {
                return None;
            }
            paired_balance_seam(text, target_lang).map(|seam| (index, seam))
        })
}

/// 已落库 manyToOne 条目的双语配对密度诊断；`bcut check` 与引擎验收共用，
/// 避免 CLI 复制阈值或目标缝算法。返回首个需要定向重对齐的目标片及缝提示。
pub fn paired_density_issue_for_ranges(
    texts: &[String],
    ranges: &[(usize, usize)],
    source_word_units: &[usize],
    source_word_ends_sec: &[f64],
    source_lang: &str,
    target_lang: &str,
) -> Option<(usize, String)> {
    let (source_fit, _) = source_piece_budgets(source_lang);
    paired_density_issue(
        texts,
        ranges,
        source_word_units,
        source_word_ends_sec,
        source_fit,
        target_lang,
    )
}

fn preferred_piece_units(total: usize, pieces: usize) -> [usize; 2] {
    let pieces = pieces.max(1);
    // 目标均值上下各留 25%：这是给语义切点腾挪的建议区间，不是硬切线。
    let min = (total.saturating_mul(3) / pieces.saturating_mul(4)).max(1);
    let max = total
        .saturating_mul(5)
        .div_ceil(pieces.saturating_mul(4))
        .max(min);
    [min, max]
}

fn length_plan(
    item: &Pending,
    params: &TransParams,
    source_lang: &str,
    target_lang: &str,
) -> LengthPlanJson {
    let target_display_units = target_cps_chars(&item.translation, target_lang);
    let source_piece_capacity = item.words.len().max(1);
    let source_total = source_length_units(&item.words, source_lang);
    // 片数完全由译文阅读需求驱动（多对一默认形态）：源语长度不再抬高
    // min/recommended，否则源长译短的句子会把紧凑译文剁成闪现碎行。
    // min..max 延续 fit..soft 的可行范围；recommended 用四舍五入而非一律
    // ceil，避免 57/14 这类接近 4 片的句子被机械推成 5 片。
    let target_min = target_display_units.div_ceil(params.fit.max(1)).max(1);
    let target_max = target_display_units
        .div_ceil(params.soft.max(1))
        .max(target_min);
    // 校验对每个入队长句都要求 ≥2 片（时长护栏入队的紧凑译句
    // target_min 会算出 1），载荷不得宣称 min=1 让 worker 与契约打架。
    let min = target_min.min(source_piece_capacity).max(2);
    let max = target_max.max(min).min(source_piece_capacity).max(min);
    let target_recommended = (target_display_units + params.soft.max(1) / 2) / params.soft.max(1);
    let recommended = target_recommended.clamp(min, max);
    let target_total = text_length_units(&item.translation, target_lang);
    LengthPlanJson {
        piece_count: PieceCountPlanJson {
            min,
            max,
            recommended,
        },
        source: SideLengthPlanJson {
            lang: source_lang.to_owned(),
            unit: length_unit_name(source_lang),
            total: source_total,
            preferred_per_piece: preferred_piece_units(source_total, recommended),
        },
        target: SideLengthPlanJson {
            lang: target_lang.to_owned(),
            unit: length_unit_name(target_lang),
            total: target_total,
            preferred_per_piece: preferred_piece_units(target_total, recommended),
        },
        target_display_units,
        target_hard_display_units: params.hard,
    }
}

/// 单测辅助：把源词渲染成带停顿标记的整句文本（CJK 词间不加空格）。
#[cfg(test)]
fn render_source(words: &[PendingWord]) -> String {
    let mut out = String::new();
    for (index, word) in words.iter().enumerate() {
        if index > 0 {
            if word.pause_before > 0 {
                out.push(' ');
                for _ in 0..word.pause_before {
                    out.push('⏸');
                }
                out.push(' ');
            } else if needs_space_between(
                words[index - 1].text.chars().next_back(),
                word.text.chars().next(),
            ) {
                out.push(' ');
            }
        }
        out.push_str(&word.text);
    }
    out
}

fn needs_space_between(left: Option<char>, right: Option<char>) -> bool {
    let cjk = |ch: char| {
        matches!(ch,
            '\u{4E00}'..='\u{9FFF}' | '\u{3040}'..='\u{30FF}' | '\u{AC00}'..='\u{D7AF}'
                | '\u{3000}'..='\u{303F}' | '\u{FF00}'..='\u{FFEF}')
    };
    !(left.is_some_and(cjk) && right.is_some_and(cjk))
}

struct DraftMarked {
    // 下列三个字段保留给草稿验收回归测试观测；运行时护栏只需要后面的最坏
    // 源行几何，不再把草稿本身序列化为分页成本投影。
    #[allow(dead_code)]
    widths: Vec<usize>,
    #[allow(dead_code)]
    ready: bool,
    /// `ready == false` 的逐条原因，供草稿验收回归测试精确定位失败缝。
    #[allow(dead_code)]
    blockers: Vec<String>,
    /// 最坏配对源行的原始几何（阅读单位）。护栏的 incumbent 基线，
    /// 与 `worst_source_seconds` 一起作为提交期非回退基线。
    worst_source_units: usize,
    /// 最坏配对源行的时窗（秒），必须用硬档同款的
    /// `source_range_seconds` 口径。
    worst_source_seconds: f64,
}

fn source_boundary_issue_is_blocking(reason: &str) -> bool {
    reason.starts_with("source infinitive complement ")
}

/// 接受前修复超 fit 片（纯文本侧，independent 行无源区间可同步）：片超一行
/// 且存在自由缝时按该缝切开。无自由缝的片保持整片——它们归
/// translation-unsplittable 通道，强切只会制造悬垂尾。
fn repair_over_fit_pieces(texts: Vec<String>, lang: &str, params: &TransParams) -> Vec<String> {
    let mut repaired = Vec::with_capacity(texts.len() + 1);
    for text in texts {
        match free_seam_for_over_fit(&text, lang, params) {
            Some((left, right)) => {
                repaired.push(left);
                repaired.push(right);
            }
            None => repaired.push(text),
        }
    }
    repaired
}

/// 接受前修复超 fit 片（配对行，文本 + 源区间同步）：与闪现碎片修复同规——
/// 这类机械修复不该消耗全局唯一的修复调用（`GLOBAL_REPAIR_CALLS=1`，抢的
/// 是别的句子的机会），而 `free_seam` 已经把切点连同两侧文本一起算好了。
/// 源区间切不干净（只有一个词、或找不到非风险词界）时保持整片，退回
/// advisory —— 那种情况真正要动的是源侧映射，不是译文切分。
fn repair_over_fit_pieces_with_ranges(
    pieces: Vec<(String, (usize, usize))>,
    source_words: &[&str],
    lang: &str,
    params: &TransParams,
) -> Vec<(String, (usize, usize))> {
    let mut repaired = Vec::with_capacity(pieces.len() + 1);
    for (text, (from, to)) in pieces {
        let Some((left, right)) = free_seam_for_over_fit(&text, lang, params) else {
            repaired.push((text, (from, to)));
            continue;
        };
        let Some(boundary) = clean_source_cut(source_words, from, to, &left, &right, lang) else {
            repaired.push((text, (from, to)));
            continue;
        };
        repaired.push((left, (from, boundary - 1)));
        repaired.push((right, (boundary, to)));
    }
    repaired
}

fn free_seam_for_over_fit(
    text: &str,
    lang: &str,
    params: &TransParams,
) -> Option<(String, String)> {
    exceeds_one_line_fit(text, lang, params.fit)
        .then(|| free_seam(text, lang, params))
        .flatten()
}

/// 在 `from..=to` 内挑一个与译文宽度比例最接近、且本身不是风险边界的源词界。
fn clean_source_cut(
    source_words: &[&str],
    from: usize,
    to: usize,
    left: &str,
    right: &str,
    lang: &str,
) -> Option<usize> {
    if to <= from {
        return None;
    }
    let left_units = target_cps_chars(left, lang);
    let total = left_units + target_cps_chars(right, lang);
    if total == 0 {
        return None;
    }
    let span = to - from + 1;
    let offset = ((span * left_units).div_ceil(total)).clamp(1, span - 1);
    let ideal = from + offset;
    (from + 1..=to)
        .filter(|boundary| {
            source_boundary_strength(source_words, *boundary) > 0
                && source_boundary_issue(source_words, *boundary).is_none()
        })
        .min_by_key(|boundary| (boundary.abs_diff(ideal), *boundary))
}

// CJK 词内切边界判定的唯一定义在 [`crate::seam`]（确定性 draft 门与
// `free_seam` 自由缝判据必须同源，否则两侧会对同一个缝给出相反结论）。

/// 为模型提供一份零 LLM、完整可回锚的候选。多数句只需返回 `useDraft:true`；
/// `draftReady` 拦四类问题：交付硬约束/阻塞缝/源语残片、疑似 CJK 词内切、
/// 以及"超 fit 且片内存在小句缝"（fit 一轮到位，消除 check→refine 二轮）。
/// 无缝的超 fit 灰带与 preferred 范围仍是审阅提示，不强迫重抄。
fn deterministic_draft(
    item: &Pending,
    params: &TransParams,
    source_lang: &str,
    target_lang: &str,
) -> DraftMarked {
    debug_assert!(!item.words.is_empty());
    let source_words_all: Vec<&str> = item.words.iter().map(|word| word.text.as_str()).collect();
    // refine / force 重切：当前已接受切分就是最好的草稿基准；重算的确定性
    // 草稿反而会把已修好的句子退回坏切分（G1 实测陷阱）。
    if let Some(existing) = &item.existing
        && existing
            .ranges
            .iter()
            .all(|&(from, to)| from <= to && to < item.words.len())
    {
        return draft_from_pieces(
            item,
            existing
                .texts
                .iter()
                .cloned()
                .zip(existing.ranges.iter().copied())
                .collect(),
            params,
            source_lang,
            target_lang,
            &source_words_all,
        );
    }
    let texts = split_independent_for_lang_protected(
        &item.translation,
        params,
        item.words.len(),
        target_lang,
        &item.protected_terms,
    );
    let texts = repair_lint_pieces(texts, target_lang, params);
    let source_words: Vec<&str> = item.words.iter().map(|word| word.text.as_str()).collect();
    let pieces = reanchor_texts(texts, &source_words, target_lang);
    let last = item.words.len() - 1;
    let anchored: Vec<(String, (usize, usize))> = pieces
        .into_iter()
        .map(|piece| {
            let from = piece.from.unwrap_or(0).min(last);
            let to = piece.to.unwrap_or(last).min(last).max(from);
            (piece.text, (from, to))
        })
        .collect();
    draft_from_pieces(
        item,
        anchored,
        params,
        source_lang,
        target_lang,
        &source_words_all,
    )
}

/// 片列表（文本 + 句内词序区间）→ 标记串草稿与 ready 判定。
fn draft_from_pieces(
    item: &Pending,
    pieces: Vec<(String, (usize, usize))>,
    params: &TransParams,
    source_lang: &str,
    target_lang: &str,
    source_words: &[&str],
) -> DraftMarked {
    let widths: Vec<usize> = pieces
        .iter()
        .map(|(text, _)| crate::split::piece_display_units(text, target_lang))
        .collect();
    // ready 各分量的失败原因逐条收集：p850 二轮复测实测 worker 面对无原因
    // 的 draftReady=false 只能整句显式重抄（5 句原样重交即通过）；给出
    // blocker 让模型只修被点名的缝。
    let mut blockers: Vec<String> = Vec::new();
    for (index, width) in widths.iter().enumerate() {
        if *width > params.hard {
            blockers.push(format!(
                "piece {}/{} is {width} chars, over the {} hard ceiling",
                index + 1,
                widths.len(),
                params.hard
            ));
        }
    }
    if pieces.len() < 2 {
        blockers.push("draft has a single piece — the sentence needs at least two".to_owned());
    }
    let plan = length_plan(item, params, source_lang, target_lang);
    if pieces.len() < plan.piece_count.min && widths.iter().any(|width| *width >= params.fit) {
        blockers.push(format!(
            "draft has {} pieces, below pieceCount.min={} while a piece is at/above fit {} — add a target-natural cut",
            pieces.len(), plan.piece_count.min, params.fit
        ));
    }
    // 单源词片检查按词位而非字符：字符口径下 >1 恒真，会放跑
    // “一个词孤悬一片”的草稿（除非该词自身足够宽、可独立成片）。
    for (index, (_, (from, to))) in pieces.iter().enumerate() {
        if to - from + 1 < 2 && source_length_units(&item.words[*from..=*to], source_lang) < 4 {
            blockers.push(format!(
                "piece {}/{} strands a single narrow source word",
                index + 1,
                pieces.len()
            ));
        }
    }
    let refs: Vec<&str> = pieces.iter().map(|(text, _)| text.as_str()).collect();
    for (index, (_, (_, to))) in pieces
        .iter()
        .take(pieces.len().saturating_sub(1))
        .enumerate()
    {
        if let Some(reason) = source_boundary_issue(source_words, to + 1) {
            blockers.push(format!(
                "source boundary after piece {}/{} is risky ({reason})",
                index + 1,
                pieces.len()
            ));
        }
    }
    let piece_texts: Vec<String> = refs.iter().map(|text| (*text).to_owned()).collect();
    if let Some(reason) = bilingual_anchor_issue_for_ranges(
        source_words,
        &piece_texts,
        &pieces.iter().map(|(_, range)| *range).collect::<Vec<_>>(),
        &item.bilingual_anchors,
    ) {
        blockers.push(reason);
    }
    // 疑似 CJK 词内切：相邻片缝两侧都是表意字符且无标点。
    for (index, pair) in refs.windows(2).enumerate() {
        if cjk_midword_boundary(pair[0], pair[1]) {
            blockers.push(format!(
                "boundary between pieces {}/{total} and {}/{total} may cut inside a CJK word",
                index + 1,
                index + 2,
                total = refs.len()
            ));
        }
    }
    // fit 一轮到位：超 fit 且片内有**自由缝**（切开后两侧都不再超 fit、都不
    // 是闪现碎片、且不触发任何客观阻塞缝 lint）⇒ 本轮就修，不留给 refine。
    // 必须用与 check 相同的视觉单行口径（exceeds_one_line_fit）：投影把
    // 隐藏的逗号/句号换成空格，含句中逗号、恰好 fit 字的片视觉上仍超一行；
    // 若这里按 target_cps_chars 判定，此类片会在 align/check 之间永远打转
    //（G1 基线的 "无解残留" 实为该度量错位）。
    // 判据用 free_seam 而非 internal_clause_seam：后者只问"有没有小句缝"，
    // 会对"切了照样超 fit"或"切开就悬垂"的片提要求，worker 怎么答都被拒；
    // 无自由缝的超 fit 片保持现状，归 translation-unsplittable 通道。
    for (index, text) in refs.iter().enumerate() {
        if !exceeds_one_line_fit(text, target_lang, params.fit) {
            continue;
        }
        if let Some((left, right)) = free_seam(text, target_lang, params) {
            blockers.push(format!(
                "piece {}/{} exceeds one display line and has a free seam — cut it into \"{left}\" | \"{right}\"",
                index + 1,
                refs.len()
            ));
        }
    }
    blockers.extend(
        lint_pieces(&refs, target_lang, params)
            .into_iter()
            .filter(|issue| issue.kind == SeamLintKind::Blocking)
            .map(|issue| issue.message),
    );
    let source_units = source_word_units(&item.words, source_lang);
    let source_ends_sec = source_word_ends_sec(&item.words);
    let (source_fit, _) = source_piece_budgets(source_lang);
    let ranges = pieces.iter().map(|(_, range)| *range).collect::<Vec<_>>();
    let target_texts = pieces
        .iter()
        .map(|(text, _)| text.clone())
        .collect::<Vec<_>>();
    if let Some((index, seam)) = paired_density_issue(
        &target_texts,
        &ranges,
        &source_units,
        &source_ends_sec,
        source_fit,
        target_lang,
    ) {
        blockers.push(format!(
            "piece {}/{} maps to an over-dense source row and contains a complete target-language seam near \"{}\" — split there for paired bilingual readability",
            index + 1,
            target_texts.len(),
            seam
        ));
    }
    // 硬档：源行超出单行预算 1.5 倍（或 6s）且目标片自身无缝。这里只否掉
    // useDraft、把片号交给模型，不进引擎验收拒绝——模型若判定无合法切点，
    // 保持整行是契约允许的答案，拒绝它只会换来确定性回退（更差）。
    for issue in source_ceiling_issues(
        &target_texts,
        &ranges,
        &source_units,
        &source_ends_sec,
        source_fit,
        target_lang,
    ) {
        blockers.push(format!(
            "piece {}/{} maps to a source row of {} display units / {:.1}s, past the paired-row ceiling ({} units / {:.1}s) — cut it once at the least-bad target boundary, or keep it whole if no legal boundary exists",
            issue.index + 1,
            target_texts.len(),
            issue.units,
            issue.seconds,
            source_piece_hard(source_fit),
            PAIRED_SOURCE_HARD_SECONDS
        ));
    }
    // 下限：源行窄到只剩一两个词的碎渣。与硬上限同一形态（只否 useDraft、
    // 点名片号，不进引擎验收拒绝），补的是 source_ceiling_issues 双豁免留下
    // 的盲区。与上面"单源词片"那条 blocker 互补而非重复：那条只管 1 词且
    // <4 单位（不看译文宽度），这条管 ≤2 词且译文自身也短的碎片。
    for issue in source_fragment_issues(
        &target_texts,
        &ranges,
        &source_units,
        source_fit,
        target_lang,
    ) {
        blockers.push(format!(
            "piece {}/{} maps to only {} source word(s) / {} display units, under the paired-row floor ({} units) — merge this crumb into the neighbouring piece that continues its clause instead of slicing the source",
            issue.index + 1,
            target_texts.len(),
            issue.words,
            issue.units,
            source_fragment_floor(source_fit)
        ));
    }
    let (worst_source_units, worst_source_seconds) =
        worst_source_row(&ranges, &source_units, &source_ends_sec);
    DraftMarked {
        widths,
        ready: blockers.is_empty(),
        blockers,
        worst_source_units,
        worst_source_seconds,
    }
}

/// 每个源词结束时刻（相对句首累计秒，0.1s 取整）。无时间戳（全零）时返回
/// 空表，序列化省略。
fn source_word_ends_sec(words: &[PendingWord]) -> Vec<f64> {
    let start = words.first().map(|word| word.t0).unwrap_or_default();
    let ends: Vec<f64> = words
        .iter()
        .map(|word| ((word.t1 - start) * 10.0).round() / 10.0)
        .collect();
    if ends.iter().all(|end| *end <= 0.0) {
        return Vec::new();
    }
    ends
}

/// 对齐分页的源文词数维度。Transcript 的一个 `Word` 仍可能包含 CJK 连写或
/// 多个 Latin token，因此逐项复用 [`word_count`]，而不是把 `words.len()`
/// 当成跨语言等价量。
fn align_item_word_count(item: &Pending) -> usize {
    item.words
        .iter()
        .map(|word| word_count(&word.text).max(1))
        .sum()
}

/// 一句对齐请求的近似工作量。固定 HTML/推理开销保证“许多短句”不会伪装成
/// 一条便宜长句；源/目标正文、建议片数、受保护术语和双语锚点再按实际字符
/// 叠加。该值只用于连续页均衡，确定且与 worker 数无关。
fn align_item_complexity_cost(
    item: &Pending,
    params: &TransParams,
    source_lang: &str,
    target_lang: &str,
) -> usize {
    let plan = length_plan(item, params, source_lang, target_lang);
    let text = file_source_marked(&item.words).chars().count() + item.translation.chars().count();
    let constraints = item
        .protected_terms
        .iter()
        .map(|term| term.chars().count().saturating_add(24))
        .chain(item.bilingual_anchors.iter().map(|anchor| {
            anchor
                .source
                .chars()
                .count()
                .saturating_add(anchor.target.chars().count())
                .saturating_add(48)
        }))
        .sum::<usize>();
    192_usize
        .saturating_add(text)
        .saturating_add(plan.piece_count.recommended.saturating_mul(96))
        .saturating_add(constraints)
}

/// 对齐分页同时受源文词数、句数和载体复杂度约束。页数取三者最大值，再用
/// 复杂度成本最小化最重连续页；因此增加 worker 只消费已经存在的页，不会让
/// 同一输入随机器并发槽变化而产生不同分页。
fn align_page_sizes(
    items: &[&Pending<'_>],
    params: &TransParams,
    source_lang: &str,
    target_lang: &str,
    word_budget: usize,
) -> Vec<usize> {
    if items.is_empty() {
        return Vec::new();
    }
    let word_total = items
        .iter()
        .map(|item| align_item_word_count(item))
        .fold(0_usize, usize::saturating_add);
    let costs = items
        .iter()
        .map(|item| align_item_complexity_cost(item, params, source_lang, target_lang))
        .collect::<Vec<_>>();
    let complexity_total = costs.iter().copied().fold(0_usize, usize::saturating_add);
    let pages = crate::paging::page_count_for_total(word_total, word_budget.max(1))
        .max(items.len().div_ceil(ALIGN_MAX_ITEMS_PER_PAGE))
        .max(complexity_total.div_ceil(ALIGN_PAGE_COMPLEXITY_BUDGET))
        .clamp(1, items.len());
    crate::paging::balanced_page_sizes_for_count(&costs, pages, ALIGN_MAX_ITEMS_PER_PAGE)
}

// ---- 响应校验 -------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
struct PieceJson {
    from: i64,
    to: i64,
    text: String,
}

fn source_segments_from_ranges(ranges: &[(usize, usize)], words: &[PendingWord]) -> Vec<String> {
    ranges
        .iter()
        .map(|&(from, to)| join_word_texts(words[from..=to].iter()))
        .collect()
}

enum HardLimitEnforcement {
    WordRanges {
        source_segments: Vec<String>,
        ranges: Vec<(usize, usize)>,
        target_segments: Vec<String>,
    },
    Independent {
        target_segments: Vec<String>,
    },
}

/// LLM 负责首轮语义拆分；若它仍留下超 hard 目标片，就在同一次响应内继续按
/// 目标语自然缝确定性拆分，并尽量按长度重新锚定全部源词。目标片多于源词、
/// 或比例锚定会切进源语绑定短语时改用独立展示，不伪造逐片双语对应。这样
/// hard 始终是绝对交付上限，同时语序交叉和极短源文都不会额外消耗一次
/// LLM 修复调用。
fn enforce_target_hard_limit(
    target_segments: &[String],
    input: &Pending,
    params: &TransParams,
    target_lang: &str,
) -> Result<Option<HardLimitEnforcement>, String> {
    if target_segments
        .iter()
        .all(|text| crate::split::piece_display_units(text, target_lang) <= params.hard)
    {
        return Ok(None);
    }

    let mut refined = Vec::new();
    for text in target_segments {
        if crate::split::piece_display_units(&text, target_lang) <= params.hard {
            refined.push(text.clone());
            continue;
        }
        refined.extend(split_independent_for_lang_protected(
            &text,
            params,
            usize::MAX,
            target_lang,
            &input.protected_terms,
        ));
    }
    if refined.is_empty()
        || refined
            .iter()
            .any(|text| crate::split::piece_display_units(text, target_lang) > params.hard)
    {
        return Err(format!(
            "{}: target cannot be represented under the absolute hard ceiling {}",
            input.sentence.id, params.hard
        ));
    }

    if refined.len() > input.words.len() {
        return Ok(Some(HardLimitEnforcement::Independent {
            target_segments: refined,
        }));
    }

    let source_words: Vec<&str> = input.words.iter().map(|word| word.text.as_str()).collect();
    let anchored = reanchor_texts(refined.clone(), &source_words, target_lang);
    debug_assert_eq!(anchored.len(), refined.len());
    let ranges: Vec<(usize, usize)> = anchored
        .iter()
        .map(|piece| {
            (
                piece.from.expect("reanchored piece has from"),
                piece.to.expect("reanchored piece has to"),
            )
        })
        .collect();
    let source_segments = source_segments_from_ranges(&ranges, &input.words);
    let unsafe_source_seam = ranges
        .iter()
        .take(ranges.len().saturating_sub(1))
        .enumerate()
        .any(|(index, &(_, to))| {
            source_boundary_issue(&source_words, to + 1).is_some()
                || ends_dangling(&source_segments[index])
        });
    if unsafe_source_seam {
        return Ok(Some(HardLimitEnforcement::Independent {
            target_segments: refined,
        }));
    }
    Ok(Some(HardLimitEnforcement::WordRanges {
        source_segments,
        ranges,
        target_segments: refined,
    }))
}

/// 标记串 → 段列表：按 `|`/`｜` 切分并 trim；段内 ⏸ 剥除（旧 json 形状答案
/// 的测试薄壳专用）。
#[cfg(test)]
fn split_marked(text: &str) -> Vec<String> {
    text.split(['|', '｜'])
        .map(|seg| seg.replace('⏸', " ").trim().to_owned())
        .collect()
}

/// 锚点词同段校验：源/译文里都出现的拉丁/数字 token（产品名、缩写、数字、
/// 标识符），两侧的段号集合必须有交集——完全不相交说明切点切进了语序交叉区，
/// 锚定必然错位（TeachFX/ELD 实测样本）。
///
/// 口径两处放宽（R2 基准 §4.4：`s-g33.0` 的 `KV`、`s-g96.0` 的 `AI`、`s-g3.0`
/// 里重复出现的 `token` 三处交叉都被旧口径漏过）：
/// 1. token 不再要求含拉丁字母，纯数字（`2048`、`999`）同样是锚点；
/// 2. 不再要求两侧各只出现一次，改判「段号集合是否不相交」，重复出现的 token
///    也能命中。
///
/// 仍是 advisory 口径：命中只进 advisories，不阻塞、不改写模型自报的
/// `crossing`（`crossing` 会反过来关掉 [`bilingual_anchor_issue_for_ranges`]
/// 的阻塞校验，自动置位会永久压掉真正的术语错位拒绝）。
fn anchor_token_colocation(
    key: &str,
    source_segments: &[String],
    target_segments: &[String],
) -> Result<(), String> {
    // `.`/`-`/`_` 是 token 的**内部**字符：切在它们上会把 `0.8`、`v0.3` 打成
    // `0`/`8`，再被 `len >= 2` 滤干净——配置类内容里这类数值恰恰是最可靠的
    // 锚点。首尾的连字符/句点仍剥掉（`--speculative-model` → `speculative-model`，
    // 句末 `tokens.` → `tokens`）。
    fn tokens(text: &str) -> Vec<String> {
        text.split(|ch: char| !(ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_')))
            .map(|tok| tok.trim_matches(['.', '-', '_']))
            .filter(|tok| tok.len() >= 2 && tok.chars().any(|ch| ch.is_ascii_alphanumeric()))
            .map(|tok| tok.to_ascii_lowercase())
            .collect()
    }
    use std::collections::BTreeMap;
    let mut src_seen: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (index, segment) in source_segments.iter().enumerate() {
        for tok in tokens(segment) {
            src_seen.entry(tok).or_default().push(index);
        }
    }
    let mut tgt_seen: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (index, segment) in target_segments.iter().enumerate() {
        for tok in tokens(segment) {
            tgt_seen.entry(tok).or_default().push(index);
        }
    }
    // BTreeMap 保证遍历顺序确定：同一句多处命中时报告的 token 稳定。
    for (tok, src_at) in &src_seen {
        let Some(tgt_at) = tgt_seen.get(tok) else {
            continue;
        };
        if src_at.iter().any(|at| tgt_at.contains(at)) {
            continue;
        }
        return Err(format!(
            "{key}: anchor \"{tok}\" sits in target segment {} but its source word is in segment {} — the cut crosses a reordered region; move the cut or merge so the anchor travels with its source",
            tgt_at[0] + 1,
            src_at[0] + 1
        ));
    }
    Ok(())
}

/// [`anchor_token_colocation`] 的词区间入口：供 `bcut check` 在已落库的
/// `transAlign` 上复算同一判据（引擎侧是 advisory，落库后仍值得可见）。
/// `crossing=true` 的句由调用方跳过。
pub fn anchor_colocation_issue_for_ranges<W: JoinWord>(
    source_words: &[W],
    target_segments: &[String],
    ranges: &[(usize, usize)],
) -> Option<String> {
    if target_segments.len() != ranges.len() || target_segments.len() < 2 {
        return None;
    }
    if ranges
        .iter()
        .any(|&(from, to)| from > to || to >= source_words.len())
    {
        return None;
    }
    let source_segments = ranges
        .iter()
        .map(|&(from, to)| join_word_texts(&source_words[from..=to]))
        .collect::<Vec<_>>();
    anchor_token_colocation("", &source_segments, target_segments)
        .err()
        .map(|detail| detail.trim_start_matches(": ").to_owned())
}

fn source_anchor_matches(words: &[&str], phrase: &str) -> Vec<(usize, usize)> {
    let phrase_tokens = normalized_source_lexemes(phrase);
    if phrase_tokens.is_empty() {
        return Vec::new();
    }
    let flattened = words
        .iter()
        .enumerate()
        .flat_map(|(word_index, word)| {
            normalized_source_lexemes(word)
                .into_iter()
                .map(move |token| (word_index, token))
        })
        .collect::<Vec<_>>();
    if phrase_tokens.len() > flattened.len() {
        return Vec::new();
    }
    flattened
        .windows(phrase_tokens.len())
        .filter_map(|window| {
            if window
                .iter()
                .map(|(_, token)| token)
                .eq(phrase_tokens.iter())
            {
                Some((window[0].0, window[window.len() - 1].0))
            } else {
                None
            }
        })
        .collect()
}

struct AnchorBinding<'a> {
    anchor: &'a BilingualAnchor,
    source_span: (usize, usize),
    target_piece: usize,
}

/// 收集源词组与目标字面串在整句各唯一命中的锚绑定，并做源区间重叠
/// 消歧：字面唯一不等于语义唯一——"skills" 唯一命中的可能是
/// "Agent Skills" 里的 "Skills"，真正对应的 "skill" 在句中别处
///（skills-video s-g72.16 实测误报形状）。重叠时长词组胜出，短词组
/// 弃权；等长且约束不同的重叠双双弃权，交给 LLM 语义审阅。
fn unique_anchor_bindings<'a>(
    source_words: &[&str],
    target_segments: &[String],
    anchors: &'a [BilingualAnchor],
) -> Vec<AnchorBinding<'a>> {
    let mut bindings: Vec<AnchorBinding<'a>> = Vec::new();
    for anchor in anchors {
        let source_matches = source_anchor_matches(source_words, &anchor.source);
        if source_matches.len() != 1 {
            continue;
        }
        let target_matches = target_segments
            .iter()
            .enumerate()
            .flat_map(|(index, text)| text.match_indices(&anchor.target).map(move |_| index))
            .collect::<Vec<_>>();
        if target_matches.len() != 1 {
            continue;
        }
        let source_span = source_matches[0];
        let target_piece = target_matches[0];
        // 完全等价的绑定（同区间同目标片）只是重复条目，保留一份即可。
        if bindings.iter().any(|existing| {
            existing.source_span == source_span && existing.target_piece == target_piece
        }) {
            continue;
        }
        bindings.push(AnchorBinding {
            anchor,
            source_span,
            target_piece,
        });
    }
    let mut keep = vec![true; bindings.len()];
    for first in 0..bindings.len() {
        for second in first + 1..bindings.len() {
            let a = bindings[first].source_span;
            let b = bindings[second].source_span;
            if a.0 <= b.1 && b.0 <= a.1 {
                let a_len = a.1 - a.0;
                let b_len = b.1 - b.0;
                if a_len > b_len {
                    keep[second] = false;
                } else if b_len > a_len {
                    keep[first] = false;
                } else {
                    keep[first] = false;
                    keep[second] = false;
                }
            }
        }
    }
    let mut kept = keep.into_iter();
    bindings.retain(|_| kept.next().unwrap());
    bindings
}

/// 显式双语 glossary 锚同段校验。只在源词组与目标字面串在
/// 整句各唯一命中时才下结论；多次出现或源区间重叠时无法确定
/// 对应关系，交给 LLM 语义审阅，避免确定性 lint 误报。
pub fn bilingual_anchor_issue_for_ranges(
    source_words: &[&str],
    target_segments: &[String],
    ranges: &[(usize, usize)],
    anchors: &[BilingualAnchor],
) -> Option<String> {
    if target_segments.len() != ranges.len() || target_segments.len() < 2 {
        return None;
    }
    for binding in unique_anchor_bindings(source_words, target_segments, anchors) {
        let (source_from, source_to) = binding.source_span;
        let source_piece = ranges
            .iter()
            .position(|&(from, to)| from <= source_from && source_to <= to);
        let Some(source_piece) = source_piece else {
            return Some(format!(
                "source glossary anchor \"{}\" is split across source segments — keep the complete source term in one paired row",
                binding.anchor.source
            ));
        };
        if source_piece != binding.target_piece {
            return Some(format!(
                "bilingual anchor \"{}\" ↔ \"{}\" is mispaired: target segment {} maps to source segment {} — move the source boundary so both terms share one row",
                binding.anchor.source,
                binding.anchor.target,
                binding.target_piece + 1,
                source_piece + 1,
            ));
        }
    }
    None
}

/// 源段落回锚词区间：忽略空白逐字符匹配，段边界必须恰好落在词边界。
fn source_segments_to_ranges(
    key: &str,
    segments: &[String],
    words: &[PendingWord],
) -> Result<Vec<(usize, usize)>, String> {
    let mut ranges = Vec::with_capacity(segments.len());
    let mut word_idx = 0usize;
    for (seg_index, segment) in segments.iter().enumerate() {
        let seg_chars: Vec<char> = segment.chars().filter(|ch| !ch.is_whitespace()).collect();
        let start = word_idx;
        let mut pos = 0usize;
        while pos < seg_chars.len() {
            if word_idx >= words.len() {
                return Err(format!(
                    "{key}: source segment {seg_index} continues past the last source word — copy the source verbatim and only insert separators"
                ));
            }
            let word_chars: Vec<char> = words[word_idx]
                .text
                .chars()
                .filter(|ch| !ch.is_whitespace())
                .collect();
            if pos + word_chars.len() > seg_chars.len()
                || seg_chars[pos..pos + word_chars.len()] != word_chars[..]
            {
                return Err(format!(
                    "{key}: source segment {seg_index} does not match the source words verbatim around \"{}\" — copy the source exactly and cut only between words",
                    words[word_idx].text
                ));
            }
            pos += word_chars.len();
            word_idx += 1;
        }
        if word_idx == start {
            return Err(format!("{key}: source segment {seg_index} is empty"));
        }
        ranges.push((start, word_idx - 1));
    }
    if word_idx != words.len() {
        return Err(format!(
            "{key}: source segments cover {word_idx} of {} source words — include every word exactly once",
            words.len()
        ));
    }
    Ok(ranges)
}

/// 源语侧的形状检查。冠词/修饰语悬空与连接词悬垂是客观坏缝，必须进入
/// 全局 repair；长度失衡可能来自自然语序交叉或译文压缩，仍只记 advisory。
fn validate_source_shape(
    key: &str,
    source_segments: &[String],
    ranges: &[(usize, usize)],
    words: &[PendingWord],
    source_lang: &str,
    plan: &LengthPlanJson,
) -> Result<Vec<String>, String> {
    let mut advisories = Vec::new();
    let mut blocking = Vec::new();
    let word_refs: Vec<&str> = words.iter().map(|word| word.text.as_str()).collect();
    for (index, &(_, to)) in ranges
        .iter()
        .take(ranges.len().saturating_sub(1))
        .enumerate()
    {
        let boundary = to + 1;
        // risky 与小句缝同界时放行：缝上的 bound-phrase 检测多为误报，且
        // 提交期 lint 同规放行——引擎再拒会把答案推进聚合 repair 批。
        if let Some(reason) = source_boundary_issue(&word_refs, boundary)
            && (source_boundary_issue_is_blocking(&reason)
                || source_boundary_strength(&word_refs, boundary) == 0)
        {
            blocking.push(format!(
                "source boundary {} is not a complete phrase ({reason}) — keep the bound noun phrase together and move the paired target cut",
                index + 1
            ));
        } else if ends_dangling(&source_segments[index]) {
            blocking.push(format!(
                "source segment {} ends on a dangling connective or function word — move the boundary after its phrase",
                index + 1
            ));
        }
    }
    if !blocking.is_empty() {
        return Err(format!("{key}: {}", blocking.join("; ")));
    }
    if ranges.len() <= 1 {
        return Ok(advisories);
    }
    let units: Vec<usize> = ranges
        .iter()
        .map(|&(from, to)| source_length_units(&words[from..=to], source_lang))
        .collect();
    let max_units = *units.iter().max().expect("non-empty source units");
    let min_units = *units.iter().min().expect("non-empty source units");
    let widest = units
        .iter()
        .position(|units| *units == max_units)
        .expect("non-empty source units");
    let average = plan.source.total.div_ceil(ranges.len().max(1)).max(1);
    let allowed_spread = average.saturating_mul(3).div_ceil(4).max(4);
    if max_units.saturating_sub(min_units) <= allowed_spread {
        return Ok(advisories);
    }
    let (from, to) = ranges[widest];
    let internal = ((from + 1)..=to).find(|&boundary| {
        source_boundary_strength(&word_refs, boundary) >= 2
            && source_boundary_issue(&word_refs, boundary).is_none()
    });
    if let Some(boundary) = internal {
        let shape = units
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("/");
        advisories.push(format!(
            "source {unit} counts {shape} are uneven; segment {} has a possible seam before \"{}\", but it may reflect target reordering or compressed translation — review against the suggested {:?} range",
            widest + 1,
            words[boundary].text,
            plan.source.preferred_per_piece,
            unit = plan.source.unit,
        ));
    }
    Ok(advisories)
}

/// 一份待验收的对齐答案（源分段 / 源词区间 / 目标片）。同一句可能有两份：
/// 引擎重切后的版本，和 worker 原样提交的版本。
#[derive(Clone)]
struct CandidateAnswer {
    source_segments: Vec<String>,
    ranges: Vec<(usize, usize)>,
    target_segments: Vec<String>,
    independent: bool,
    forced_hard_split: bool,
}

impl CandidateAnswer {
    /// 重切是否真的改动了答案。没改动就没有"引擎自己造成的失败"可言，
    /// 不必重复验一遍同一份内容。
    fn differs_from(&self, other: &Self) -> bool {
        self.independent != other.independent
            || self.target_segments != other.target_segments
            || self.ranges != other.ranges
    }
}

/// 验收宽严档位。三档只在两件事上不同：是否容忍超 hard 片、源行形状问题是否
/// 阻塞。其余判据（拼接一致、区间覆盖、保护术语、客观缝语病、退化配对行、
/// 锚点交叉、密度）三档一致——放宽这些会让 submit lint 与引擎验收脱钩。
#[derive(Clone, Copy, PartialEq, Eq)]
enum AcceptanceMode {
    /// 引擎重切后的常规验收：超 hard 片必须已被消除。
    Recut,
    /// 重切被放弃、改验 worker 原始答案：允许保留超 hard 片（over_hard 时
    /// 豁免 `< 2 段`，与提交期 lint 同判）。
    KeepWhole,
    /// 兜底救回：与 `KeepWhole` 同宽松，且源行形状问题降级为 advisory——
    /// 它要比的对手是 `fallback_word_entry` 的纯长度确定性切分，那条路
    /// 本来就不过任何源形状检查，过了 submit lint 的 worker 答案严格更优。
    Salvage,
}

impl AcceptanceMode {
    fn allows_over_hard(self) -> bool {
        !matches!(self, Self::Recut)
    }

    fn source_shape_blocks(self) -> bool {
        !matches!(self, Self::Salvage)
    }
}

/// 候选 A：对 worker 答案依次施加 hard 上限强制、闪现碎片修复、超 fit 修复。
fn build_recut_candidate(
    input: &Pending,
    params: &TransParams,
    target_lang: &str,
    mut source_segments: Vec<String>,
    mut ranges: Vec<(usize, usize)>,
    mut target_segments: Vec<String>,
) -> Result<CandidateAnswer, String> {
    let mut independent = false;
    let forced_hard_split =
        match enforce_target_hard_limit(&target_segments, input, params, target_lang)? {
            Some(HardLimitEnforcement::WordRanges {
                source_segments: refined_source,
                ranges: refined_ranges,
                target_segments: refined_target,
            }) => {
                source_segments = refined_source;
                ranges = refined_ranges;
                target_segments = refined_target;
                true
            }
            Some(HardLimitEnforcement::Independent {
                target_segments: refined_target,
            }) => {
                target_segments = refined_target;
                independent = true;
                true
            }
            None => false,
        };
    // 接受前修复闪现碎片：worker 交回的 ≤3 字片若可安全并入邻片，直接
    // 确定性合并（文本+源区间同步），与草稿侧 repair_lint_pieces 同规。
    // 拒绝回炉对这类机械修复是浪费一轮；无法安全合并的仍走 advisory。
    if !independent && target_segments.len() == ranges.len() {
        let repaired = repair_flash_pieces_with_ranges(
            target_segments
                .iter()
                .cloned()
                .zip(ranges.iter().copied())
                .collect(),
            target_lang,
            params,
        );
        if repaired.len() != target_segments.len() {
            ranges = repaired.iter().map(|(_, range)| *range).collect();
            target_segments = repaired.into_iter().map(|(text, _)| text).collect();
            source_segments = source_segments_from_ranges(&ranges, &input.words);
        }
    }
    // 接受前修复超 fit 片：超一行且有自由缝的片按该缝切开。与闪现修复
    // 同理由——切点、两侧文本都是确定的，回炉一轮既慢又抢别句的修复
    // 名额。
    if independent {
        target_segments = repair_over_fit_pieces(target_segments, target_lang, params);
    } else if target_segments.len() == ranges.len() {
        let source_refs: Vec<&str> = input.words.iter().map(|word| word.text.as_str()).collect();
        let repaired = repair_over_fit_pieces_with_ranges(
            target_segments
                .iter()
                .cloned()
                .zip(ranges.iter().copied())
                .collect(),
            &source_refs,
            target_lang,
            params,
        );
        if repaired.len() != target_segments.len() {
            ranges = repaired.iter().map(|(_, range)| *range).collect();
            target_segments = repaired.into_iter().map(|(text, _)| text).collect();
            source_segments = source_segments_from_ranges(&ranges, &input.words);
        }
    }
    Ok(CandidateAnswer {
        source_segments,
        ranges,
        target_segments,
        independent,
        forced_hard_split,
    })
}

/// 单个候选答案的全部验收判据。抽出来是为了能对同一句评估两次（引擎重切版 /
/// worker 原版），失败原因不串味。
#[allow(clippy::too_many_arguments)]
fn evaluate_candidate(
    key: &str,
    candidate: &CandidateAnswer,
    input: &Pending,
    params: &TransParams,
    source_lang: &str,
    target_lang: &str,
    reference_translation: &str,
    declared_crossing: bool,
    mode: AcceptanceMode,
    // incumbent 草稿的最坏配对源行 `(单位, 秒)`，由调用方一次性从
    // `deterministic_draft` 取出（与载荷 `draftWorstSource*` 同源同值）。
    draft_worst_source: (usize, f64),
) -> Result<(Vec<String>, AcceptedAnchor), LlmError> {
    let CandidateAnswer {
        source_segments,
        ranges,
        target_segments,
        independent,
        forced_hard_split,
    } = candidate;
    let (independent, forced_hard_split) = (*independent, *forced_hard_split);
    let over_hard = target_segments
        .iter()
        .any(|text| crate::split::piece_display_units(text, target_lang) > params.hard);
    let keep_over_hard = mode.allows_over_hard() && over_hard;
    // 与提交期 lint 同判：留有超 hard 片时 `<2 段` 不是错误
    //（该片要么被续拆、要么在 KeepWhole 下整片保留），只有全部片 ≤ hard
    // 才要求 ≥2 段。`Recut` 档下 `keep_over_hard` 为假，等价于旧行为。
    if target_segments.len() < 2 && !keep_over_hard {
        return Err(LlmError::Malformed(format!(
            "{key}: every requested long sentence must be split into at least two paired segments"
        )));
    }
    let plan = length_plan(input, params, source_lang, target_lang);
    // 含超 hard 片的答案豁免 pieceCount.min（`all(<= hard)` 条件即
    // `!over_hard`），与 submit lint 的 `!over_hard` 门同判。
    if target_segments.len() < plan.piece_count.min
        && target_segments
            .iter()
            .all(|text| crate::split::piece_display_units(text, target_lang) <= params.hard)
        && target_segments
            .iter()
            .any(|text| crate::split::piece_display_units(text, target_lang) >= params.fit)
    {
        return Err(LlmError::Malformed(format!(
            "{key}: {} target pieces are below pieceCount.min={} while a piece reaches fit {} — add a target-natural cut",
            target_segments.len(),
            plan.piece_count.min,
            params.fit
        )));
    }
    let source_units = source_word_units(&input.words, source_lang);
    let source_ends_sec = source_word_ends_sec(&input.words);
    let (source_fit, _) = source_piece_budgets(source_lang);
    let allowed_list_seams = allowed_balanced_list_seams(
        target_segments,
        ranges,
        &source_units,
        &source_ends_sec,
        source_fit,
    );
    // 注意：源行硬上限（`source_ceiling_issues`）刻意**不**在此拒绝，
    // 与提交期 lint 保持同判（两处同进同退是 submit-lint 与
    // 引擎验收不打架的前提）。理由：契约允许模型在无合法切点时保持整
    // 行；在此拒绝会吃掉全局共享的唯一修复调用（GLOBAL_REPAIR_CALLS=1，
    // 抢的是别的句子的修复机会），最终落到 `fallback_word_entry` 的
    // 确定性长度切分（reanchor_texts，不看语义），比模型答案更差。硬档
    // 由草稿门（draftBlockers）+ `bcut check` → `refine-align` 定向轮承担。
    if !independent
        && !forced_hard_split
        && let Some((index, seam)) = paired_density_issue(
            target_segments,
            ranges,
            &source_units,
            &source_ends_sec,
            source_fit,
            target_lang,
        )
    {
        return Err(LlmError::Malformed(format!(
            "{key}: source span paired with target piece {}/{} is over-dense and the target has a complete seam near \"{}\" — split there for paired bilingual readability",
            index + 1,
            target_segments.len(),
            seam
        )));
    }
    // 硬档本身仍不拒（见上），但**净倒退**要拒：定向修复轮把最坏越档源行做得
    // 更差时放行，等于让 refine-align 反向工作。顺序刻意排在密度检查之后，
    // 密度这类既有判据继续优先出具理由。`Salvage` 豁免（`source_shape_blocks`
    // 同款）：那一档只与 `fallback_word_entry` 的纯长度切分竞争，在此拒绝只会
    // 扩大确定性兜底的暴露面。
    if mode.source_shape_blocks()
        && let Some(detail) = source_ceiling_regression(
            &source_ceiling_issues(
                target_segments,
                ranges,
                &source_units,
                &source_ends_sec,
                source_fit,
                target_lang,
            ),
            draft_worst_source.0,
            draft_worst_source.1,
            source_fit,
            target_segments.len(),
        )
    {
        return Err(LlmError::Malformed(format!("{key}: {detail}")));
    }
    if independent {
        return validate_target_texts_with_allowed_list_seams(
            key,
            target_segments,
            reference_translation,
            target_lang,
            params,
            &input.protected_terms,
            &BTreeSet::new(),
            keep_over_hard,
        )
        .map(|mut advisories| {
            advisories.push(format!(
                "target pieces were deterministically split to enforce the absolute hard ceiling {}; there were fewer source words than target pieces, so display timing is independent and semantic row correspondence is intentionally omitted",
                params.hard
            ));
            (advisories, AcceptedAnchor::Independent)
        });
    }
    // 退化配对行：宽译文片只挂到一两个源词，逐字高亮会与字幕推进脱节。
    // 与提交期 lint 同判（submit lint 与引擎验收必须同进同退）。
    if let Some((piece, words, units)) =
        degenerate_paired_row(target_segments, ranges, &source_units, target_lang)
    {
        return Err(LlmError::Malformed(format!(
            "{key}: piece {piece} maps {units} display characters onto only {words} source word(s) — give it at least {DEGENERATE_MIN_SOURCE_WORDS} source words, or let the neighbouring short phrases share one piece"
        )));
    }
    // 模型已自报 crossing 时，锚点词同段检查必然告警（切点就在交叉
    // 区），不再重复输出。
    if !declared_crossing {
        let source_refs = input
            .words
            .iter()
            .map(|word| word.text.as_str())
            .collect::<Vec<_>>();
        if let Some(reason) = bilingual_anchor_issue_for_ranges(
            &source_refs,
            target_segments,
            ranges,
            &input.bilingual_anchors,
        ) {
            return Err(LlmError::Malformed(format!("{key}: {reason}")));
        }
    }
    let anchor_advisory = if declared_crossing {
        None
    } else {
        anchor_token_colocation(key, source_segments, target_segments)
            .err()
            .map(|detail| {
                detail
                    .strip_prefix(&format!("{key}: "))
                    .unwrap_or(&detail)
                    .to_owned()
            })
    };
    let mut source_advisories = match validate_source_shape(
        key,
        source_segments,
        ranges,
        &input.words,
        source_lang,
        &plan,
    ) {
        Ok(advisories) => advisories,
        Err(detail) if mode.source_shape_blocks() => return Err(LlmError::Malformed(detail)),
        Err(detail) => vec![detail],
    };
    source_advisories.extend(anchor_advisory);
    if forced_hard_split {
        source_advisories.push(format!(
            "target pieces were deterministically split to enforce the absolute hard ceiling {}; source ranges were reanchored by length because semantic correspondence is secondary to delivery length",
            params.hard
        ));
    }
    let time_advisories = time_budget_advisories(input, target_segments, ranges, target_lang);
    let pieces: Vec<PieceJson> = target_segments
        .iter()
        .zip(ranges)
        .map(|(text, &(from, to))| PieceJson {
            from: from as i64,
            to: to as i64,
            text: text.clone(),
        })
        .collect();
    validate_pieces_protected_with_allowed_list_seams(
        key,
        &pieces,
        input.words.len(),
        reference_translation,
        target_lang,
        params,
        &input.protected_terms,
        &allowed_list_seams,
        keep_over_hard,
    )
    .map(|mut advisories| {
        advisories.extend(source_advisories);
        advisories.extend(time_advisories);
        (advisories, AcceptedAnchor::WordRanges(ranges.clone()))
    })
}

/// 一批的验收产物：`(accepted, salvaged, failed_keys)`。`salvaged` 是"译文片
/// 合法但源侧映射不达标"的答案，只在修复预算耗尽后顶替确定性兜底切分。
type BatchVerdict = (
    std::collections::BTreeMap<String, AcceptedPieces>,
    std::collections::BTreeMap<String, AcceptedPieces>,
    Vec<String>,
);

/// 载体无关的单句答案中间表示。
///
/// 双校验合一的落点（文件契约设计 §2）：[`file_answers_from_parsed`] 解出
/// 答案后，**只有一份** [`accept_answers`] 做验收，验收判据不存在第二份
/// 可以漂移的副本。
struct SentenceAnswer {
    key: String,
    /// 句内词序区间：表格行的源列经容错吸附得出。
    ranges: Vec<(usize, usize)>,
    /// 目标片。
    target_segments: Vec<String>,
    reordered: bool,
    crossing: bool,
    /// worker 自述「源文没有合法切点」（`data-unsplittable`）：此时超 hard 片
    /// 整片保留是契约兑现，不再回炉定向补切。
    unsplittable: bool,
    /// 解码阶段已经产生的 advisory（词边界吸附告警等）。
    advisories: Vec<String>,
}

/// **唯一**的验收核心。`pre_failures` 是解码阶段已经产生的逐句失败
/// （结构级诊断），与验收失败合并成同一份 problems。
fn accept_answers(
    batch: &[&Pending],
    params: &TransParams,
    source_lang: &str,
    target_lang: &str,
    answers: Vec<SentenceAnswer>,
    pre_failures: Vec<String>,
) -> Result<BatchVerdict, LlmError> {
    let inputs: std::collections::BTreeMap<&str, &&Pending> = batch
        .iter()
        .map(|item| (item.sentence.id.as_str(), item))
        .collect();
    let mut accepted = std::collections::BTreeMap::new();
    let mut salvaged = std::collections::BTreeMap::new();
    let mut failures = pre_failures;
    for answer in answers {
        let SentenceAnswer {
            key,
            ranges,
            target_segments: answer_targets,
            reordered,
            crossing: declared_crossing,
            unsplittable,
            advisories: decode_advisories,
        } = answer;
        let Some(input) = inputs.get(key.as_str()) else {
            // 解码器已保证键在批内；防御性跳过而不是伪造失败。
            continue;
        };
        // 源列的可信部分只是「切在哪」，段文本由词真相重建，绝不拿模型
        // 重抄的字符串当锚。
        let source_segments = source_segments_from_ranges(&ranges, &input.words);
        let mut target_segments = answer_targets;
        if target_segments.len() != source_segments.len() {
            failures.push(format!(
                "{key}: source has {} segments but target has {} — separators must pair up",
                source_segments.len(),
                target_segments.len()
            ));
            continue;
        }
        if let Some(frozen) = input.frozen_target.as_ref() {
            if reordered {
                failures.push(format!(
                    "{key}: data-target-frozen forbids reordered=true — keep the validated target pieces exactly and change only source boundaries"
                ));
                continue;
            }
            if target_segments != *frozen {
                failures.push(format!(
                    "{key}: target pieces must equal data-target-frozen exactly — change only source boundaries"
                ));
                continue;
            }
        }
        // 重排验收：worker 自身具备语言能力，允许它在不改变语义的前提下重排
        // 译句小句顺序来消除交叉。逐字对账对重排失效，改用两道确定性护栏——
        // 逐片过目标语格式化（与 trans 同一字符流口径），以及长度带宽（重排
        // 只调语序和必要的连接词/助词，阅读单位不该有大漂移；漂移过大按改写
        // 拒收，防止顺手压缩/丢内容）。通过后回写句级译文真相。
        let revised_target = if reordered {
            target_segments = target_segments
                .iter()
                .map(|segment| {
                    format_translation_with_options(
                        segment,
                        target_lang,
                        &input.protected_terms,
                        AutocorrectOptions::default(),
                    )
                })
                .collect();
            let new_text = join_word_texts(target_segments.iter().map(String::as_str));
            let old_units = target_cps_chars(&input.translation, target_lang);
            let new_units = target_cps_chars(&new_text, target_lang);
            // 与 `filepipe::align_table::check_rows` 共用同一份护栏算术
            //（设计 §2「校验只有一份」——这条护栏曾是三份逐字复制）。
            if reordered_rewrite_exceeds(old_units, new_units) {
                failures.push(format!(
                    "{key}: reordered target rewrites too much ({old_units} → {new_units} reading units) — reorder clauses without adding, dropping, or compressing content, or use crossing instead"
                ));
                continue;
            }
            Some(new_text)
        } else {
            None
        };
        let reference_translation = revised_target
            .clone()
            .unwrap_or_else(|| input.translation.clone());
        // 两个候选：A = 引擎重切（hard 上限强制 → 闪现修复 → 超 fit 修复），
        // B = worker 原始答案。重切是引擎单方面的改写，它自己引入的锚点/缝/
        // 密度失败不该记在 worker 头上（现场：worker 交 3 片、引擎重切成 4 片
        // 后按"segment 4 锚点错位"回炉，问题描述指向 worker 根本没提交过的
        // 片）。A 不过验收且重切确实改动过答案时改验 B；B 过则整片保留超 hard
        // 片——这正是契约里"没有合法切点就保持整行"的引擎侧兑现，该片随后由
        // `bcut check` 的 translation-unsplittable / align-source-ceiling 通道
        // 暴露，而不是烧掉全局唯一的修复调用再落一个更差的机械切分。
        // incumbent 基线只算一次并直接复用 `deterministic_draft`，因此引擎侧
        // 与提交期 lint 拿到的是同一个数，不存在两套独立计算漂移的空间。
        let draft_worst_source = {
            let draft = deterministic_draft(input, params, source_lang, target_lang);
            (draft.worst_source_units, draft.worst_source_seconds)
        };
        let recut = build_recut_candidate(
            input,
            params,
            target_lang,
            source_segments.clone(),
            ranges.clone(),
            target_segments.clone(),
        );
        let original = CandidateAnswer {
            source_segments,
            ranges,
            target_segments,
            independent: false,
            forced_hard_split: false,
        };
        let recut_changed = match &recut {
            Ok(candidate) => candidate.differs_from(&original),
            Err(_) => true,
        };
        let mut outcome: Option<(CandidateAnswer, Vec<String>, AcceptedAnchor)> = None;
        let mut failure_detail: Option<String> = None;
        let mut via_keep_whole = false;
        match recut {
            Ok(candidate) => match evaluate_candidate(
                &key,
                &candidate,
                input,
                params,
                source_lang,
                target_lang,
                &reference_translation,
                declared_crossing,
                AcceptanceMode::Recut,
                draft_worst_source,
            ) {
                Ok((advisories, anchor)) => outcome = Some((candidate, advisories, anchor)),
                Err(LlmError::Malformed(detail)) => failure_detail = Some(detail),
                Err(error) => return Err(error),
            },
            Err(detail) => failure_detail = Some(detail),
        }
        if outcome.is_none()
            && recut_changed
            && let Ok((mut advisories, anchor)) = evaluate_candidate(
                &key,
                &original,
                input,
                params,
                source_lang,
                target_lang,
                &reference_translation,
                declared_crossing,
                AcceptanceMode::KeepWhole,
                draft_worst_source,
            )
        {
            advisories.push(format!(
                "the deterministic re-split under the absolute hard ceiling {} was abandoned because it broke paired readability; the submitted segmentation was kept as-is and any over-ceiling piece stays whole — `bcut check` reports it as an alignment defect",
                params.hard
            ));
            outcome = Some((original.clone(), advisories, anchor));
            failure_detail = None;
            via_keep_whole = true;
        }
        let Some((candidate, mut advisories, anchor)) = outcome else {
            // 两个候选都没过验收：再用最宽松的 `Salvage` 档试一次，过了就
            // 存进 `salvaged`，留给修复预算耗尽后的兜底顶替
            // `fallback_word_entry` 的纯长度切分。重排答案不救——救回意味着
            // 跳过 `trans` 回写路径的一致性前提，宁可走确定性兜底。
            if revised_target.is_none()
                && let Ok((mut salvage_advisories, salvage_anchor)) = evaluate_candidate(
                    &key,
                    &original,
                    input,
                    params,
                    source_lang,
                    target_lang,
                    &reference_translation,
                    declared_crossing,
                    AcceptanceMode::Salvage,
                    draft_worst_source,
                )
            {
                salvage_advisories.extend(decode_advisories.iter().cloned());
                salvage_advisories.push(
                    "kept the submitted segmentation instead of the deterministic target split: it failed acceptance but is structurally sound and strictly better than a length-only re-split — `bcut check` reports the remaining defect"
                        .to_owned(),
                );
                let salvage_crossing =
                    declared_crossing && matches!(salvage_anchor, AcceptedAnchor::WordRanges(_));
                salvaged.insert(
                    key.clone(),
                    AcceptedPieces {
                        texts: original.target_segments,
                        anchor: salvage_anchor,
                        crossing: salvage_crossing,
                        revised_target: None,
                        advisories: salvage_advisories,
                    },
                );
            }
            failures.push(
                failure_detail
                    .unwrap_or_else(|| format!("{key}: alignment answer failed validation")),
            );
            continue;
        };
        let crossing = declared_crossing && matches!(anchor, AcceptedAnchor::WordRanges(_));
        // 解码阶段的 advisory（file-v1 的词边界吸附、data-unsplittable 自述）
        // 与验收 advisory 同一个通道，最终都落进 `AlignOutcome.violations`。
        advisories.extend(decode_advisories);
        // KeepWhole 收下的答案若仍带超 hard 片：这不是引擎自己造成的缺陷，
        // 而是 worker 交的片本来就超限、引擎又找不到合法重切。按"先接受、
        // 再定向补"的口径，不当场落库，而是存进 `salvaged`（修复预算耗尽时
        // 原样顶上，结果不比直接接受更差）并只把**这一句**连同定向说明送进
        // 修复轮，让 worker 自己挪切点。worker 已自述 data-unsplittable 或
        // 重排回写的答案不再回炉——前者是契约兑现，后者救回意味着跳过
        // `trans` 回写一致性前提。
        if via_keep_whole && revised_target.is_none() && !unsplittable {
            let over_hard: Vec<(usize, usize)> = candidate
                .target_segments
                .iter()
                .enumerate()
                .filter_map(|(index, text)| {
                    let units = crate::split::piece_display_units(text, target_lang);
                    (units > params.hard).then_some((index + 1, units))
                })
                .collect();
            if let Some(&(segment, units)) = over_hard.first() {
                advisories.push(
                    "kept as salvage: the over-ceiling piece was sent back once for a targeted re-segmentation; this answer lands unchanged only if the repair round does not do better"
                        .to_owned(),
                );
                salvaged.insert(
                    key.clone(),
                    AcceptedPieces {
                        texts: candidate.target_segments,
                        anchor,
                        crossing,
                        revised_target: None,
                        advisories,
                    },
                );
                failures.push(format!(
                    "{key}: target segment {segment} is {units} display units — over the absolute hard ceiling {} and the engine found no legal re-split; move a boundary so every target segment stays within {} display units, or declare data-unsplittable=\"true\" if the source truly has no legal cut ({} more over-ceiling segment(s) in this answer)",
                    params.hard,
                    params.hard,
                    over_hard.len() - 1
                ));
                continue;
            }
        }
        if revised_target.is_some() {
            advisories.push(
                "target reordered to follow the source clause order — verify no meaning shifted"
                    .to_owned(),
            );
        }
        accepted.insert(
            key,
            AcceptedPieces {
                texts: candidate.target_segments,
                anchor,
                crossing,
                revised_target,
                advisories,
            },
        );
    }
    for item in batch {
        if !accepted.contains_key(&item.sentence.id)
            && !failures
                .iter()
                .any(|detail| detail.contains(&item.sentence.id))
        {
            failures.push(format!("Alignment missing sentence: {}", item.sentence.id));
        }
    }
    Ok((accepted, salvaged, failures))
}

/// 确定性校验（§9.2 + v0.3 hard 上限）：只有覆盖、空片、区间和 hard ceiling
/// 等结构不变量会触发重试；缝质量与均衡问题返回 advisory，避免为主观样式
/// 偏好额外调用 LLM。
///
/// `allow_over_hard`：只有在引擎放弃自己的重切、改验 worker 原始答案时才为
/// true——此时"超 hard 必须再切"已被证明会切出更差的结果，契约允许保持整片，
/// 该片改由 `bcut check` 的超档通道暴露。常规路径恒为 false。
#[allow(clippy::too_many_arguments)]
fn validate_target_texts_with_allowed_list_seams(
    key: &str,
    texts: &[String],
    translation: &str,
    lang: &str,
    params: &TransParams,
    protected_terms: &[String],
    allowed_list_seams: &BTreeSet<usize>,
    allow_over_hard: bool,
) -> Result<Vec<String>, LlmError> {
    if texts.is_empty() {
        return Err(LlmError::Malformed(format!(
            "{key}: pieces must not be empty"
        )));
    }
    for (index, text) in texts.iter().enumerate() {
        // piece 序号 1 基（与 seam lint / validate_source_shape 同基）。
        let ordinal = index + 1;
        let total = texts.len();
        if text.trim().is_empty() {
            return Err(LlmError::Malformed(format!(
                "{key}: piece {ordinal}/{total} has empty text"
            )));
        }
        let chars = crate::split::piece_display_units(text, lang);
        if chars > params.hard && !allow_over_hard {
            return Err(LlmError::Malformed(format!(
                "{key}: piece {ordinal}/{total} has {chars} characters, over the absolute hard ceiling {} — cut it further",
                params.hard
            )));
        }
    }
    let concatenated: String = texts.iter().map(String::as_str).collect();
    if normalize_chars(&concatenated) != normalize_chars(translation) {
        return Err(LlmError::Malformed(format!(
            "{key}: concatenated piece texts do not equal the full translation"
        )));
    }
    if let Some(term) = split_protected_term(texts, protected_terms) {
        return Err(LlmError::Malformed(format!(
            "{key}: target boundary splits protected glossary term \"{term}\" — keep it in one piece"
        )));
    }
    let text_refs: Vec<&str> = texts.iter().map(String::as_str).collect();
    let lint = lint_pieces(&text_refs, lang, params);
    // 悬垂尾/粘着首是客观语病（「拆分给 |」「类似 | 于…」），G3 基线实测
    // 会被弱 worker 稳定产出并落库——升级为回炉，problems 带具体片文本。
    // 闪现/aim-band/均衡仍只提示：长度取舍经常没有客观唯一解。
    let allowed_balanced_list = |issue: &&crate::seam::SeamLintIssue| {
        issue.class == SeamLintClass::ListSeparator
            && allowed_list_seams.contains(&issue.piece_index)
    };
    if let Some(issue) = lint
        .iter()
        .find(|issue| is_objective_blocking(issue) && !allowed_balanced_list(issue))
    {
        return Err(LlmError::Malformed(format!(
            "{key}: {} (piece text: \"{}\") — move the boundary so the bound phrase stays whole",
            issue.message, texts[issue.piece_index]
        )));
    }
    let mut advisories: Vec<String> = lint
        .iter()
        .filter(|issue| !allowed_balanced_list(issue))
        .map(|issue| issue.message.clone())
        .collect();
    if text_refs.len() > 1 {
        let widths: Vec<usize> = text_refs
            .iter()
            .map(|text| crate::split::piece_display_units(text, lang))
            .collect();
        let max_w = *widths.iter().max().expect("non-empty pieces");
        let min_w = *widths.iter().min().expect("non-empty pieces");
        if max_w.saturating_sub(min_w) > BALANCE_SPREAD {
            let widest = widths
                .iter()
                .position(|width| *width == max_w)
                .expect("non-empty pieces");
            if let Some(seam) = internal_clause_seam(text_refs[widest], lang) {
                let shape = widths
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("/");
                advisories.push(format!(
                    "{key}: piece widths {shape} are uneven — consider cutting piece {widest} after \"{seam}\" (or moving a boundary) when semantics allow"
                ));
            }
        }
    }
    Ok(advisories)
}

/// 片级时间预算 advisory（非阻塞）：展示排程可在句内挪时间（smoothing），
/// 因此不按片语音时窗硬卡；只在两类可行动信号上提示——整句阅读需求超过
/// 整句时窗（唯有减片/压缩译文可解，片数越多 1s 展示下限叠加越多），以及
/// 某片缺口大到相邻片的富余能填（移界即可解，"短源配长译"的典型形态）。
fn time_budget_advisories(
    item: &Pending,
    texts: &[String],
    ranges: &[(usize, usize)],
    target_lang: &str,
) -> Vec<String> {
    let mut advisories = Vec::new();
    if texts.len() != ranges.len() || texts.len() < 2 {
        return advisories;
    }
    let required: Vec<f64> = texts
        .iter()
        .map(|text| target_required_seconds(text, target_lang))
        .collect();
    let spans: Vec<f64> = ranges
        .iter()
        .map(|&(from, to)| words_dwell_seconds(&item.words[from..=to]))
        .collect();
    let available = words_dwell_seconds(&item.words);
    if available <= f64::EPSILON {
        return advisories; // 无可用时间信息（如合成词表）不做时间判断。
    }
    let total_required: f64 = required.iter().sum();
    if total_required > available + 0.25 {
        advisories.push(format!(
            "pieces need {total_required:.1}s of reading time but the sentence speech lasts {available:.1}s — fewer pieces (each has a ~1s display floor) or a tighter translation would fit better"
        ));
        return advisories; // 全局超载时逐片提示只是噪声。
    }
    for index in 0..required.len() {
        let deficit = required[index] - spans[index];
        if deficit <= TIME_DEFICIT_SECONDS {
            continue;
        }
        let previous_surplus = index
            .checked_sub(1)
            .map(|prev| spans[prev] - required[prev])
            .unwrap_or(0.0);
        let next_surplus = (index + 1 < required.len())
            .then(|| spans[index + 1] - required[index + 1])
            .unwrap_or(0.0);
        if previous_surplus.max(next_surplus) >= deficit {
            let side = if next_surplus > previous_surplus {
                "next"
            } else {
                "previous"
            };
            advisories.push(format!(
                "piece {}/{} (\"{}\") needs {:.1}s to read but its speech span is {:.1}s — move the cut to give it words from the {side} piece",
                index + 1,
                required.len(),
                texts[index],
                required[index],
                spans[index],
            ));
        }
    }
    advisories
}

#[cfg(test)]
fn validate_pieces(
    key: &str,
    pieces: &[PieceJson],
    word_count: usize,
    translation: &str,
    lang: &str,
    params: &TransParams,
) -> Result<Vec<String>, LlmError> {
    validate_pieces_protected(key, pieces, word_count, translation, lang, params, &[])
}

#[cfg(test)]
fn validate_pieces_protected(
    key: &str,
    pieces: &[PieceJson],
    word_count: usize,
    translation: &str,
    lang: &str,
    params: &TransParams,
    protected_terms: &[String],
) -> Result<Vec<String>, LlmError> {
    validate_pieces_protected_with_allowed_list_seams(
        key,
        pieces,
        word_count,
        translation,
        lang,
        params,
        protected_terms,
        &BTreeSet::new(),
        false,
    )
}

#[allow(clippy::too_many_arguments)]
fn validate_pieces_protected_with_allowed_list_seams(
    key: &str,
    pieces: &[PieceJson],
    word_count: usize,
    translation: &str,
    lang: &str,
    params: &TransParams,
    protected_terms: &[String],
    allowed_list_seams: &BTreeSet<usize>,
    allow_over_hard: bool,
) -> Result<Vec<String>, LlmError> {
    if pieces.is_empty() {
        return Err(LlmError::Malformed(format!(
            "{key}: pieces must not be empty"
        )));
    }
    let mut expected_from = 0_i64;
    for (index, piece) in pieces.iter().enumerate() {
        let ordinal = index + 1;
        let total = pieces.len();
        if piece.from != expected_from {
            return Err(LlmError::Malformed(format!(
                "{key}: piece ranges must be contiguous from 0 — piece {ordinal}/{total} starts at {}, expected {expected_from}",
                piece.from
            )));
        }
        if piece.to < piece.from || piece.to >= word_count as i64 {
            return Err(LlmError::Malformed(format!(
                "{key}: piece {ordinal}/{total} range {}..{} is invalid for {word_count} words",
                piece.from, piece.to
            )));
        }
        expected_from = piece.to + 1;
    }
    if expected_from != word_count as i64 {
        return Err(LlmError::Malformed(format!(
            "{key}: piece ranges cover words 0..{expected_from} but the sentence has {word_count} words"
        )));
    }
    let texts: Vec<String> = pieces.iter().map(|piece| piece.text.clone()).collect();
    validate_target_texts_with_allowed_list_seams(
        key,
        &texts,
        translation,
        lang,
        params,
        protected_terms,
        allowed_list_seams,
        allow_over_hard,
    )
}

fn split_protected_term(texts: &[String], protected_terms: &[String]) -> Option<String> {
    if texts.len() < 2 || protected_terms.is_empty() {
        return None;
    }
    let joined = texts.concat();
    let boundaries = texts
        .iter()
        .take(texts.len() - 1)
        .scan(0usize, |cursor, text| {
            *cursor += text.len();
            Some(*cursor)
        })
        .collect::<Vec<_>>();
    protected_terms.iter().find_map(|term| {
        joined.match_indices(term).find_map(|(start, matched)| {
            let end = start + matched.len();
            boundaries
                .iter()
                .any(|boundary| start < *boundary && *boundary < end)
                .then(|| term.clone())
        })
    })
}

// ---- agent submit lint ----------------------------------------------------

/// file-v1 align 应答的提交期语义 lint（§10.3）。
///
/// 与引擎 provider 路径**共用同一份**字符串级校验：两边都只调
/// [`parse_align_table`]，判据（id 对账、截断、源文漂移、拼接不变式、
/// hard 上限、客观坏缝、reordered ±25% 改写幅度）全在 filepipe 里，
/// 这里只把诊断格式化成人读文本。设计 §2「校验只有一份」在 file-v1 上
/// 由此结构性成立——不存在第二份可以漂移的副本。
///
/// 需要 `words[]` 真相的判据（源词区间映射、配对密度、退化/碎片行、双语锚、
/// 源行非回退）留在引擎闭包里：提交进程没有 `TranscriptDoc`，复算不可能，
/// 抄一份近似值只会制造第二套标准。
///
/// 载荷读不出（旧任务目录、别的 kind）⇒ 返回空：不挡引擎能收的答案。
pub fn lint_agent_answer_file(payload: &str, answer: &str) -> Vec<String> {
    let Some(table) = parse_align_table_input(payload) else {
        return Vec::new();
    };
    let parsed = parse_align_table(&table, Some(payload), answer);
    format_lint_problems(&parsed.diagnostics.problems)
}

/// `align-edges/1` 提交期 lint：与引擎共用 [`parse_align_edges`] 这一份字符串
/// 级校验（序号合法性、跨块重复、span 拼接不变式、截断/缺句）。需要
/// `words[]` 真相的块合并与 DP 留在引擎。载荷读不出 ⇒ 返回空（不挡）。
pub fn lint_agent_answer_edges(payload: &str, answer: &str) -> Vec<String> {
    let Some(table) = parse_align_edges_input(payload) else {
        return Vec::new();
    };
    let parsed = parse_align_edges(&table, Some(payload), answer);
    format_lint_problems(&parsed.diagnostics.problems)
}

/// `align-rewrite/1` 提交期 lint：同一解析器（表的 `data-bcut-format` 决定
/// rewrite 模式，附带幅度护栏与硬锚保留检查）。
pub fn lint_agent_answer_rewrite(payload: &str, answer: &str) -> Vec<String> {
    lint_agent_answer_edges(payload, answer)
}

fn format_lint_problems(problems: &[crate::filepipe::Problem]) -> Vec<String> {
    problems
        .iter()
        .map(|problem| match &problem.scope {
            ProblemScope::Sentence { id } => {
                format!("[{}] {id}: {}", problem.code, problem.detail)
            }
            _ => format!("[{}] {}", problem.code, problem.detail),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cue::CueParams;
    use crate::split::align_entry_valid;

    #[test]
    fn paired_budget_survives_the_payload_roundtrip_and_conflicts_fail_early() {
        let mut table = AlignTableInput {
            lang: "zh".into(),
            params: TransParams::for_lang("zh"),
            source_lang: String::new(),
            context_before: vec![],
            context_after: vec![],
            sentences: vec![AlignSentenceInput::new(
                "s1",
                "one two three four",
                "第一部分第二部分",
            )],
        };
        let requirements = BTreeMap::from([(
            "s1".into(),
            PairedRequirement {
                source_rows: 8,
                target_units: 48,
                required: 8,
            },
        )]);
        prepare_table_constraints(&mut table, &requirements).unwrap();
        let decoded =
            crate::filepipe::align_table::parse_align_table_input(&render_align_table(&table))
                .unwrap();
        assert_eq!(decoded.sentences[0].suggested_pieces, (8, 8));
        assert!(decoded.sentences[0].no_rewrite);
        table.sentences[0].frozen_target = vec!["第一部分".into(), "第二部分".into()];
        assert!(matches!(
            prepare_table_constraints(&mut table, &requirements),
            Err(LlmError::Terminal(_))
        ));
    }

    #[test]
    fn problem_mentions_id_requires_token_boundaries() {
        assert!(problem_mentions_id(
            "s-g6.18: piece 2/3 is over hard",
            "s-g6.18"
        ));
        assert!(problem_mentions_id(
            "Alignment missing sentence: s-g61.11",
            "s-g61.11"
        ));
        // 互为前缀的 id 不得误命中。
        assert!(!problem_mentions_id(
            "s-g6.18: piece 2/3 is over hard",
            "s-g6.1"
        ));
        assert!(!problem_mentions_id("s-g61.11: must be split", "s-g61.1"));
        assert!(!problem_mentions_id(
            "the answer carries no sentences",
            "s-g6.18"
        ));
    }

    /// 契约文件按 `(kind, attempt)` 共享一份：system prompt 必须只由任务级
    /// 输入决定，首轮与修复轮逐字节一致，受保护术语节不随批次组成消失。
    #[test]
    fn align_file_contract_is_stable_across_rounds() {
        let params = TransParams::for_lang("zh-Hans");
        let table = AlignTableInput {
            lang: "zh-Hans".to_owned(),
            params: params.clone(),
            source_lang: "en".to_owned(),
            context_before: Vec::new(),
            sentences: vec![AlignSentenceInput {
                id: "s-1".to_owned(),
                source: "hello world again".to_owned(),
                translation: "你好，世界，再一次。".to_owned(),
                max_lines: 2,
                suggested_pieces: (2, 3),
                unsplittable: false,
                frozen_target: Vec::new(),
                no_rewrite: false,
            }],
            context_after: Vec::new(),
        };
        let terms = vec!["PagedAttention".to_owned()];
        let first = align_request_file(&table, &params, "en", None, &terms, None);
        let repair = align_request_file(
            &table,
            &params,
            "en",
            None,
            &terms,
            Some("Repair only the remaining 1 sentences.".to_owned()),
        );
        assert!(first.system.contains("Protected target terms"));
        assert!(first.system.contains("PagedAttention"));
        assert_eq!(first.system, repair.system);
    }

    #[test]
    fn repair_reason_notes_problems_omitted_from_this_carrier() {
        let params = TransParams::for_lang("zh-Hans");
        let reason = repair_reason_file(
            &[],
            &params,
            "en",
            "zh-Hans",
            &["s-1: piece 1/2 ends on a dangling connective".to_owned()],
            2,
        );
        assert!(reason.contains("s-1: piece 1/2"));
        assert!(reason.contains(
            "(2 further problem(s) from the previous round concern sentences repaired in parallel calls and are not in this table.)"
        ));
    }
    use crate::doc::{BreakOverride, DocEngine, DocMedia, Speaker, Word};
    use crate::engines::translate::{TranslateOptions, run_translate};
    use crate::llm::FakeLlm;
    use crate::split::derive_trans_cues;

    fn doc_with_words(words: Vec<Word>) -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: None,
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
        doc.speakers.insert(
            "s1".to_owned(),
            Speaker {
                name: "S1".to_owned(),
                hue: None,
            },
        );
        doc.words = words;
        doc
    }

    fn w(id: &str, t0: f64, t1: f64, text: &str) -> Word {
        Word {
            id: id.to_owned(),
            t0,
            t1,
            text: text.to_owned(),
            sp: "s1".to_owned(),
            glue: false,
        }
    }

    fn row_repair_doc() -> TranscriptDoc {
        let mut doc = doc_with_words(
            (0..9)
                .map(|index| {
                    w(
                        &format!("g1.{index}"),
                        index as f64,
                        index as f64 + 1.0,
                        if index == 8 { "nine." } else { "word" },
                    )
                })
                .collect(),
        );
        doc.breaks.insert("g1.2".to_owned(), BreakOverride::Break);
        doc.breaks.insert("g1.5".to_owned(), BreakOverride::Break);
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert("s-g1.0".to_owned(), "短译文".to_owned());
        doc
    }

    fn row_repair_inputs(doc: &TranscriptDoc) -> (Vec<Cue>, Vec<Sentence>, Vec<TransCue>) {
        let cues = derive_cues(doc, &crate::layout_profile::cue_params_for_doc(doc));
        let sentences = derive_sentences(doc, &cues);
        let trans = derive_trans_cues(doc, &sentences, "zh");
        (cues, sentences, trans)
    }

    #[test]
    fn source_run_merge_matches_product_mirrors() {
        let ranges = |lengths: &[usize]| {
            let mut cursor = 0usize;
            lengths
                .iter()
                .map(|length| {
                    let range = cursor..cursor + length;
                    cursor += length;
                    range
                })
                .collect::<Vec<_>>()
        };
        let lengths = |runs: Vec<std::ops::Range<usize>>| {
            runs.into_iter().map(|run| run.len()).collect::<Vec<_>>()
        };
        assert_eq!(lengths(merge_short_runs(ranges(&[2, 5]), 3)), [7]);
        assert_eq!(lengths(merge_short_runs(ranges(&[5, 2]), 3)), [7]);
        assert_eq!(lengths(merge_short_runs(ranges(&[1, 4, 3]), 3)), [5, 3]);
        assert_eq!(lengths(merge_short_runs(ranges(&[5, 1, 3]), 3)), [5, 4]);
        assert_eq!(lengths(merge_short_runs(ranges(&[3, 1, 5]), 3)), [4, 5]);
        assert_eq!(lengths(merge_short_runs(ranges(&[3, 1, 3]), 3)), [4, 3]);
        assert_eq!(lengths(merge_short_runs(ranges(&[1, 1, 1, 4]), 3)), [3, 4]);
        assert_eq!(lengths(merge_short_runs(ranges(&[2, 2, 2]), 3)), [6]);
    }

    #[test]
    fn row_deficit_f1_missing_entry_is_reported_by_dwell() {
        let doc = row_repair_doc();
        let (cues, sentences, trans) = row_repair_inputs(&doc);
        let issues = row_deficit_issues(&doc, &sentences, "zh", &cues, &trans);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].source_rows, 3);
        assert_eq!(issues[0].trans_cues, 1);
        assert_eq!(issues[0].reason, RowDeficitReason::Dwell);
    }

    #[test]
    fn row_deficit_f2_sentence_level_is_reported_with_three_source_rows() {
        let mut doc = row_repair_doc();
        // Keep the whole row below the dwell threshold so the sentence-level arm is exercised.
        for (index, word) in doc.words.iter_mut().enumerate() {
            word.t0 = index as f64 * 0.4;
            word.t1 = word.t0 + 0.4;
        }
        let ids = doc.words.iter().map(|word| word.id.clone()).collect();
        let mut entry = TransAlign::new(
            AlignMode::ManyToOne,
            ids,
            vec![TransPiece {
                from: Some(0),
                to: Some(8),
                text: "短译文".to_owned(),
            }],
        );
        entry.correspondence = Some(Correspondence::Sentence);
        doc.trans_align
            .entry("zh".to_owned())
            .or_default()
            .insert("s-g1.0".to_owned(), entry);
        let (cues, sentences, trans) = row_repair_inputs(&doc);
        let issues = row_deficit_issues(&doc, &sentences, "zh", &cues, &trans);
        assert_eq!(issues[0].reason, RowDeficitReason::SentenceLevel);
    }

    #[test]
    fn row_deficit_f3_sparse_valid_pieces_are_reported() {
        let mut doc = row_repair_doc();
        let ids = doc.words.iter().map(|word| word.id.clone()).collect();
        doc.trans_align.entry("zh".to_owned()).or_default().insert(
            "s-g1.0".to_owned(),
            TransAlign::new(
                AlignMode::ManyToOne,
                ids,
                vec![
                    TransPiece {
                        from: Some(0),
                        to: Some(5),
                        text: "短".to_owned(),
                    },
                    TransPiece {
                        from: Some(6),
                        to: Some(8),
                        text: "译文".to_owned(),
                    },
                ],
            ),
        );
        let (cues, sentences, trans) = row_repair_inputs(&doc);
        let issues = row_deficit_issues(&doc, &sentences, "zh", &cues, &trans);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].trans_cues, 2);
    }

    #[test]
    fn row_deficit_f4_stale_fallback_is_exclusive() {
        let mut doc = row_repair_doc();
        doc.trans.get_mut("zh").unwrap().insert(
            "s-g1.0".to_owned(),
            "这是一条明显超过单行容量并且必须重新对齐的长译文。".to_owned(),
        );
        let ids = doc.words.iter().map(|word| word.id.clone()).collect();
        doc.trans_align.entry("zh".to_owned()).or_default().insert(
            "s-g1.0".to_owned(),
            TransAlign::new(
                AlignMode::ManyToOne,
                ids,
                vec![TransPiece {
                    from: Some(0),
                    to: Some(7),
                    text: "失效".to_owned(),
                }],
            ),
        );
        let (cues, sentences, trans) = row_repair_inputs(&doc);
        assert!(trans.iter().any(|cue| cue.fallback));
        assert!(row_deficit_issues(&doc, &sentences, "zh", &cues, &trans).is_empty());
    }

    #[test]
    fn row_deficit_f5_independent_without_anchors_is_not_reported() {
        let mut doc = row_repair_doc();
        doc.trans_align.entry("zh".to_owned()).or_default().insert(
            "s-g1.0".to_owned(),
            TransAlign::new(
                AlignMode::Independent,
                Vec::new(),
                vec![
                    TransPiece {
                        from: None,
                        to: None,
                        text: "短".to_owned(),
                    },
                    TransPiece {
                        from: None,
                        to: None,
                        text: "译文".to_owned(),
                    },
                ],
            ),
        );
        let (cues, sentences, trans) = row_repair_inputs(&doc);
        assert!(row_deficit_issues(&doc, &sentences, "zh", &cues, &trans).is_empty());
    }

    #[test]
    fn legal_many_to_one_below_dwell_threshold_is_not_reported() {
        let mut doc = row_repair_doc();
        for (index, word) in doc.words.iter_mut().enumerate() {
            word.t0 = index as f64 * 0.35;
            word.t1 = word.t0 + 0.35;
        }
        let (cues, sentences, trans) = row_repair_inputs(&doc);
        assert!(row_deficit_issues(&doc, &sentences, "zh", &cues, &trans).is_empty());
    }

    #[test]
    fn paired_minimum_clamps_short_translation_to_two_pieces() {
        assert_eq!(paired_min_piece_count(3, 6), 2);
        assert_eq!(paired_min_piece_count(3, 20), 3);
    }

    #[test]
    fn row_deficit_skips_sentences_whose_translation_is_blank() {
        for text in ["", "   ", "\n\t "] {
            let mut doc = row_repair_doc();
            doc.trans
                .get_mut("zh")
                .expect("zh")
                .insert("s-g1.0".to_owned(), text.to_owned());
            let (cues, sentences, trans) = row_repair_inputs(&doc);
            // 判据与 align 侧的 "empty translation — skipped" 同口径：空译文
            // 既不产出统计行，也不可能报黏结。
            assert!(row_deficit_stats(&doc, &sentences, "zh", &cues, &trans).is_empty());
            assert!(row_deficit_issues(&doc, &sentences, "zh", &cues, &trans).is_empty());
        }
    }

    /// 混合轮的 `rowRepair` 四计数 + 计数器回退口径。
    ///
    /// 每次调用只返回空表 ⇒ 全部句走确定性兜底（`fallback_sentences`），
    /// 因此"被拒句该退哪个计数器"这件事必须逐句判定：早期版本无条件
    /// `aligned_sentences -= rejected`，会在 `aligned_sentences == 0` 时把
    /// 别的句的计数扣成不一致。
    struct EmptyTableLlm {
        calls: usize,
    }

    impl LlmJson for EmptyTableLlm {
        fn complete(&mut self, _request: &LlmRequest) -> Result<String, LlmError> {
            self.calls += 1;
            Ok("<table>\n</table>\n".to_owned())
        }
    }

    fn short_translation_doc() -> TranscriptDoc {
        let mut doc = two_sentence_doc();
        let table = doc.trans.entry("zh".to_owned()).or_default();
        // 句1：2 条源行（`echo,` 处断行）+ 短译文 ⇒ 最小片数 2，兜底只给 1 片
        // ⇒ 被拒。句2：单源行 ⇒ 最小片数 1 ⇒ 接受。
        table.insert("s-g1.0".to_owned(), "短译文。".to_owned());
        table.insert("s-g2.0".to_owned(), "完成。".to_owned());
        doc
    }

    fn paired_counter_options(density_sentences: &[&str]) -> AlignOptions {
        let mut options = opts(AlignMode::ManyToOne);
        options.density = AlignDensity::Paired;
        options.density_sentences = density_sentences
            .iter()
            .map(|id| (*id).to_owned())
            .collect();
        options.sentences = Some(
            density_sentences
                .iter()
                .map(|id| (*id).to_owned())
                .collect(),
        );
        options.repair_calls = 0;
        options
    }

    /// [`short_translation_doc`] 的慢速版：句1 的 8 个词拉长到 6.4s，整句一片
    /// 会命中 `align-row-deficit` 的驻留谓词（≥5s 且覆盖 2 条源行）。
    fn slow_short_translation_doc() -> TranscriptDoc {
        let mut doc = short_translation_doc();
        for word in &mut doc.words {
            word.t0 *= 2.0;
            word.t1 *= 2.0;
        }
        doc
    }

    #[test]
    fn row_repair_counts_candidates_repaired_rejected_and_capped_in_one_round() {
        let mut doc = slow_short_translation_doc();
        // 第三个 key 在本轮的 `sentences` 之外也不存在于文档 ⇒ 记 capped。
        let mut options = paired_counter_options(&["s-g1.0", "s-g2.0"]);
        options.density_sentences.insert("s-g9.9".to_owned());
        let mut llm = EmptyTableLlm { calls: 0 };
        let outcome = run_align(&mut doc, &mut llm, &options, &mut |_| {}).unwrap();

        assert_eq!(outcome.row_repair.candidates, 2);
        assert_eq!(outcome.row_repair.repaired, 1);
        assert_eq!(outcome.row_repair.rejected, 1);
        assert_eq!(outcome.row_repair.capped, 1);
        // 被拒句退的是它自己加过的 `fallback_sentences`，不是别人的
        // `aligned_sentences`。
        assert_eq!(outcome.aligned_sentences, 0);
        assert_eq!(outcome.fallback_sentences, 1);
        // 被拒句保留原状（本来就没有条目）；接受句落库。
        assert_eq!(
            doc.trans_align["zh"].keys().collect::<Vec<_>>(),
            vec!["s-g2.0"]
        );
        assert!(
            outcome.violations.iter().any(|line| line
                .starts_with("s-g1.0: paired row repair rejected")
                && line.contains("stuck row(s)")),
            "{:?}",
            outcome.violations
        );
        // 逐句明细：光看「1 候选 → 1 拒」判断不了是验收式过严还是这句本就没那么
        // 多字可切，度量必须跟着拒绝一起出来。
        assert_eq!(outcome.row_repair.rejections_truncated, 0);
        assert_eq!(outcome.row_repair.rejections.len(), 1);
        let rejection = &outcome.row_repair.rejections[0];
        assert_eq!(rejection.sentence, "s-g1.0");
        assert_eq!(rejection.reason, "not-improved");
        assert_eq!(rejection.source_rows, 2);
        assert_eq!(rejection.required, 2);
        assert_eq!(rejection.delivered, 1);
        assert!(rejection.target_units > 0, "{rejection:?}");
        assert_eq!(
            rejection.units_per_row,
            (rejection.target_units as f64 / 2.0 * 100.0).round() / 100.0
        );
    }

    #[test]
    fn row_repair_counters_are_all_zero_on_an_auto_round() {
        let mut doc = short_translation_doc();
        let mut options = opts(AlignMode::ManyToOne);
        // auto 轮即使携带了黏结 key（refine 的旧行为），capped 也必须恒为 0。
        options.density_sentences = ["s-g1.0", "s-g2.0", "s-g9.9"]
            .into_iter()
            .map(str::to_owned)
            .collect();
        options.repair_calls = 0;
        let mut llm = EmptyTableLlm { calls: 0 };
        let outcome = run_align(&mut doc, &mut llm, &options, &mut |_| {}).unwrap();
        assert_eq!(outcome.row_repair, RowRepairOutcome::default());
        assert_eq!(outcome.row_repair.capped, 0);
        // 两句短译文在 auto 下都不需要条目。
        assert_eq!(llm.calls, 0);
    }

    /// paired 接受后，该句上一轮留下的 `transDisplay` 条目必须一并清掉：
    /// 新条目以 `trans` 为基准，旧显示文本会变成没人引用的孤儿。
    #[test]
    fn accepted_paired_repair_clears_the_stale_trans_display_entry() {
        let mut doc = short_translation_doc();
        doc.trans_display
            .entry("zh".to_owned())
            .or_default()
            .insert(
                "s-g2.0".to_owned(),
                TransDisplay {
                    text: "旧的显示改写。".to_owned(),
                    basis: MONOTONIC_REWRITE_BASIS.to_owned(),
                    trans_fingerprint: String::new(),
                },
            );
        let options = paired_counter_options(&["s-g2.0"]);
        let mut llm = EmptyTableLlm { calls: 0 };
        let outcome = run_align(&mut doc, &mut llm, &options, &mut |_| {}).unwrap();
        assert_eq!(outcome.row_repair.repaired, 1);
        assert!(
            doc.trans_display.get("zh").is_none(),
            "{:?}",
            doc.trans_display
        );
    }

    /// 句1 = 两 Cue（q-g1.0 / q-g1.5）；句2 = 单 Cue（q-g2.0）。
    fn two_sentence_doc() -> TranscriptDoc {
        doc_with_words(vec![
            w("g1.0", 0.0, 0.4, "alpha"),
            w("g1.1", 0.4, 0.8, "bravo"),
            w("g1.2", 0.8, 1.2, "charlie"),
            w("g1.3", 1.2, 1.6, "delta"),
            w("g1.4", 1.6, 2.0, "echo,"),
            w("g1.5", 2.0, 2.4, "foxtrot"),
            w("g1.6", 2.4, 2.8, "golf"),
            w("g1.7", 2.8, 3.2, "hotel."),
            w("g2.0", 3.4, 3.8, "Done."),
        ])
    }

    fn with_translations(mut doc: TranscriptDoc) -> TranscriptDoc {
        let table = doc.trans.entry("zh".to_owned()).or_default();
        table.insert(
            "s-g1.0".to_owned(),
            "第一段译文需要自然对应，第二段译文负责完整收尾。".to_owned(),
        );
        table.insert("s-g2.0".to_owned(), "完成。".to_owned());
        doc
    }

    fn talk_alignment_doc(sentence_count: usize) -> TranscriptDoc {
        let mut words = Vec::new();
        for sentence in 0..sentence_count {
            let base = sentence as f64 * 10.0;
            for (word, text) in [
                "This", "source", "sentence", "contains", "enough", "spoken", "words", "to",
                "become", "one", "complete", "semantic", "subtitle", "unit", "for", "testing.",
            ]
            .into_iter()
            .enumerate()
            {
                let mut token = w(
                    &format!("g{sentence}.{word}"),
                    base + word as f64 * 0.4,
                    base + (word + 1) as f64 * 0.4,
                    text,
                );
                if sentence % 2 == 1 {
                    token.sp = "s2".to_owned();
                }
                words.push(token);
            }
        }
        let mut doc = doc_with_words(words);
        doc.speakers.insert(
            "s2".to_owned(),
            Speaker {
                name: "S2".to_owned(),
                hue: None,
            },
        );
        let cues = derive_cues(&doc, &CueParams::default());
        let derived = derive_sentences(&doc, &cues);
        assert_eq!(derived.len(), sentence_count);
        let table = doc.trans.entry("zh".to_owned()).or_default();
        for sentence in &derived {
            table.insert(
                sentence.id.clone(),
                "这是一条需要自然切分的字幕，后半部分也保持完整。".to_owned(),
            );
        }
        doc
    }

    fn opts(mode: AlignMode) -> AlignOptions {
        AlignOptions {
            lang: "zh".to_owned(),
            mode,
            params: None,
            sentences: None,
            targeted: false,
            force: false,
            instructions: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            worker_slots: None,
            page_budget: crate::paging::budgets::ALIGN_PROVIDER_WORDS,
            repair_calls: GLOBAL_REPAIR_CALLS,
            // 既有表格协议测试沿用审阅载体；块对齐边测试用 [`opts_edges`]。
            carrier: AlignCarrier::Table,
            ..AlignOptions::default()
        }
    }

    fn opts_edges(mode: AlignMode) -> AlignOptions {
        AlignOptions {
            carrier: AlignCarrier::Edges,
            ..opts(mode)
        }
    }

    /// 测试侧薄壳：把旧 json 形状的答案脚本翻成载体无关的
    /// [`SentenceAnswer`]，再进唯一的 [`accept_answers`] 验收核。
    fn validate_batch_partial(
        batch: &[&Pending],
        params: &TransParams,
        source_lang: &str,
        target_lang: &str,
        raw: &str,
    ) -> Result<BatchVerdict, LlmError> {
        let value: serde_json::Value =
            serde_json::from_str(raw).map_err(|error| LlmError::Malformed(error.to_string()))?;
        let inputs: std::collections::BTreeMap<&str, &&Pending> = batch
            .iter()
            .map(|item| (item.sentence.id.as_str(), item))
            .collect();
        let mut answers = Vec::new();
        for sentence in value["sentences"].as_array().into_iter().flatten() {
            let key = sentence["key"]
                .as_str()
                .expect("test answer key")
                .to_owned();
            let input = inputs
                .get(key.as_str())
                .unwrap_or_else(|| panic!("unknown test key {key}"));
            let reordered = sentence["reordered"].as_bool().unwrap_or(false);
            let crossing = sentence["crossing"].as_bool().unwrap_or(false) && !reordered;
            let breaks: Vec<&str> = sentence["sourceBreaks"]
                .as_array()
                .expect("test answers use sourceBreaks")
                .iter()
                .map(|id| id.as_str().expect("break id"))
                .collect();
            let ranges = test_breaks_to_ranges(&breaks, input.words.len());
            answers.push(SentenceAnswer {
                key,
                ranges,
                target_segments: split_marked(sentence["target"].as_str().unwrap_or_default()),
                reordered,
                crossing,
                unsplittable: sentence["unsplittable"].as_bool().unwrap_or(false),
                advisories: Vec::new(),
            });
        }
        accept_answers(batch, params, source_lang, target_lang, answers, Vec::new())
    }

    fn test_breaks_to_ranges(breaks: &[&str], word_count: usize) -> Vec<(usize, usize)> {
        let mut ranges = Vec::with_capacity(breaks.len() + 1);
        let mut from = 0usize;
        for id in breaks {
            let boundary: usize = id.strip_prefix('b').expect("bN id").parse().expect("bN id");
            assert!(
                boundary > from && boundary < word_count,
                "bad test break {id}"
            );
            ranges.push((from, boundary - 1));
            from = boundary;
        }
        ranges.push((from, word_count - 1));
        ranges
    }

    /// 与 [`good_align_table`] 完全相同的静态版本，供 `FakeLlm::ok` 使用。
    const GOOD_ALIGN_RESPONSE: &str = "<table>\n  <tbody data-sid=\"s-g1.0\">\n    <tr><td class=\"src\">alpha bravo charlie delta echo,</td><td class=\"tgt\">第一段译文需要自然对应，</td></tr>\n    <tr><td class=\"src\">foxtrot golf hotel.</td><td class=\"tgt\">第二段译文负责完整收尾。</td></tr>\n  </tbody>\n</table>\n";

    struct DraftReviewLlm {
        calls: usize,
        fail_first: bool,
        request_item_counts: Vec<usize>,
    }

    impl LlmJson for DraftReviewLlm {
        fn complete(&mut self, request: &LlmRequest) -> Result<String, LlmError> {
            let call = self.calls;
            self.calls += 1;
            if self.fail_first && call == 0 {
                return Ok("<table>\n</table>\n".to_owned());
            }
            let input = parse_align_table_input(&request.user).expect("align table input");
            self.request_item_counts.push(input.sentences.len());
            let groups: Vec<String> = input
                .sentences
                .iter()
                .map(|sentence| {
                    tgroup(
                        &sentence.id,
                        "",
                        &[
                            (
                                "This source sentence contains enough spoken words",
                                "这是一条需要自然切分的字幕，",
                            ),
                            (
                                "to become one complete semantic subtitle unit for testing.",
                                "后半部分也保持完整。",
                            ),
                        ],
                    )
                })
                .collect();
            Ok(ttable(&groups))
        }
    }

    #[test]
    fn single_cue_sentence_needs_no_entry_and_no_llm() {
        let mut doc = with_translations(two_sentence_doc());
        let mut llm = FakeLlm::ok([GOOD_ALIGN_RESPONSE]);
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        // 句2 单 Cue 零条目；句1 走 LLM。
        assert_eq!(llm.calls.len(), 1);
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(outcome.skipped_sentences, 1);
        assert!(!doc.trans_align["zh"].contains_key("s-g2.0"));
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(entry.mode, AlignMode::ManyToOne);
        assert!(entry.cues.is_empty());
        assert_eq!(entry.pieces.len(), 2);
        assert_eq!(entry.pieces[0].text, "第一段译文需要自然对应，");
        assert_eq!(entry.pieces[1].from, Some(5));
        assert_eq!(entry.words.first().map(String::as_str), Some("g1.0"));
        assert_eq!(entry.words.last().map(String::as_str), Some("g1.7"));

        let (kind, system, user, _) = &llm.calls[0];
        assert_eq!(kind, "align");
        assert!(system.contains("expert bilingual subtitle segmenter"));
        assert!(system.contains('⏸'));
        assert!(!user.contains("s-g2.0"));

        // 幂等：再跑零调用零改动。
        let mut llm = FakeLlm::ok(std::iter::empty::<&'static str>());
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        assert!(llm.calls.is_empty());
        assert_eq!(outcome.aligned_sentences, 0);
        assert_eq!(outcome.skipped_sentences, 2);
    }

    /// 源行超长但译文一行放得下：整句上屏也是一条配对行，必须入队请 LLM
    /// 切分；同 doc 里源行合规的句仍然零条目跳过（反向断言，防止误报泛滥）。
    fn one_line_translation_doc() -> TranscriptDoc {
        let long = [
            "Everyone",
            "working",
            "alongside",
            "the",
            "platform",
            "engineering",
            "group",
            "always",
            "retains",
            "their",
            "entirely",
            "separate",
            "working",
            "context.",
        ];
        let short = ["Nothing", "else", "really", "happens", "right", "here."];
        let mut words = Vec::new();
        for (index, text) in long.iter().enumerate() {
            words.push(w(
                &format!("g1.{index}"),
                index as f64 * 0.3,
                (index + 1) as f64 * 0.3,
                text,
            ));
        }
        for (index, text) in short.iter().enumerate() {
            words.push(w(
                &format!("g2.{index}"),
                6.0 + index as f64 * 0.3,
                6.0 + (index + 1) as f64 * 0.3,
                text,
            ));
        }
        let mut doc = doc_with_words(words);
        let table = doc.trans.entry("zh".to_owned()).or_default();
        // 两句译文都 ≤ fit(16) 且 ≥ PAIRED_TARGET_MIN_UNITS(10)，硬档的目标侧
        // 前置过滤对两句同样放行，差别只在源行宽度。
        table.insert("s-g1.0".to_owned(), "他们保留上下文，互不干扰。".to_owned());
        table.insert("s-g2.0".to_owned(), "这里不会再发生别的事。".to_owned());
        doc
    }

    #[test]
    fn overlong_source_row_enters_the_llm_even_when_the_translation_fits_one_line() {
        let mut doc = one_line_translation_doc();
        let mut llm = file_llm([ttable(&[tgroup(
            "s-g1.0",
            "",
            &[
                (
                    "Everyone working alongside the platform engineering group",
                    "他们保留上下文，",
                ),
                (
                    "always retains their entirely separate working context.",
                    "互不干扰。",
                ),
            ],
        )])]);
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();

        // 源行 100 阅读单位 > source_piece_hard(42)=63 ⇒ 不再被 no_entry_needed
        // 跳过，必须出现在 LLM 载荷里。
        assert_eq!(llm.calls.len(), 1, "{:?}", llm.calls);
        let user = &llm.calls[0].2;
        assert!(user.contains("data-sid=\"s-g1.0\""), "{user}");
        // 反向：源行合规的短句仍然零条目、走 skipped 分支。
        assert!(!user.contains("s-g2.0"), "{user}");
        assert!(!doc.trans_align["zh"].contains_key("s-g2.0"));
        assert_eq!(outcome.skipped_sentences, 1);
    }

    #[test]
    fn whole_sentence_ceiling_predicate_ignores_compliant_source_rows() {
        let doc = one_line_translation_doc();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let issue_for = |sentence: &Sentence| {
            let words = sentence
                .word_indices
                .iter()
                .map(|&index| &doc.words[index])
                .collect::<Vec<_>>();
            whole_sentence_source_ceiling_issue(
                &words,
                &doc.trans["zh"][&sentence.id],
                &doc.lang,
                "zh",
            )
        };
        let long = issue_for(&sentences[0]).expect("超长源行必须命中硬档");
        assert_eq!(long.index, 0);
        assert_eq!(long.words, 14);
        assert!(long.units > 63, "{long:?}");
        assert!(
            issue_for(&sentences[1]).is_none(),
            "源行合规的句不得产生硬档诊断"
        );
    }

    #[test]
    fn align_only_formats_existing_translation_before_deriving_pieces() {
        let mut doc = two_sentence_doc();
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert("s-g1.0".to_owned(), "在Claude Code中使用,很好.".to_owned());
        let mut options = opts(AlignMode::ManyToOne);
        options.sentences = Some(BTreeSet::from(["s-g1.0".to_owned()]));
        let mut llm = FakeLlm::ok(std::iter::empty::<&'static str>());

        let outcome = run_align(&mut doc, &mut llm, &options, &mut |_| {}).unwrap();

        assert!(llm.calls.is_empty());
        assert_eq!(outcome.skipped_sentences, 1);
        assert_eq!(doc.trans["zh"]["s-g1.0"], "在 Claude Code 中使用，很好。");
        assert!(!doc.trans_align.contains_key("zh"));
    }

    #[test]
    fn draft_ready_treats_soft_length_plan_as_advisory() {
        let source = "Maybe use an AI tool, or become AI-native.";
        let source_words: Vec<&str> = source.split_whitespace().collect();
        let sentence = Sentence {
            id: "s-soft-plan".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source.to_owned(),
            src_fingerprint: "test".to_owned(),
        };
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words: source_words
                .iter()
                .map(|text| PendingWord {
                    text: (*text).to_owned(),
                    pause_before: 0,
                    t0: 0.0,
                    t1: 0.0,
                    glue: false,
                })
                .collect(),
            translation: format!("{}，{}。", "甲".repeat(17), "乙".repeat(13)),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let params = TransParams::for_lang("zh");
        let draft = deterministic_draft(&pending, &params, "en", "zh");

        assert!(draft.widths.len() >= 2, "{:?}", draft.widths);
        assert!(draft.widths.iter().all(|width| *width <= params.hard));
        assert!(
            draft.widths.iter().any(|width| *width > params.fit),
            "the fixture must exercise a soft-only length miss: {:?}",
            draft.widths
        );
        assert!(
            draft.ready,
            "soft length guidance must not force a rewrite: {:?}",
            draft.blockers
        );
    }

    #[test]
    fn time_budget_advisories_flag_dense_rows_and_movable_boundaries() {
        let source =
            "becomes useful because it emphasizes there is still engineering happening now";
        let source_words: Vec<&str> = source.split_whitespace().collect();
        let sentence = Sentence {
            id: "s-time".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source.to_owned(),
            src_fingerprint: "test".to_owned(),
        };
        // 前 2 词 0.8s 内说完（短源片），其余词铺满约 4.5s。
        let timed_words = |scale: f64| -> Vec<PendingWord> {
            source_words
                .iter()
                .enumerate()
                .map(|(index, text)| {
                    let (t0, t1) = if index < 2 {
                        (index as f64 * 0.4, (index + 1) as f64 * 0.4)
                    } else {
                        (
                            0.8 + (index - 2) as f64 * 0.5,
                            0.8 + (index - 1) as f64 * 0.5,
                        )
                    };
                    PendingWord {
                        text: (*text).to_owned(),
                        pause_before: 0,
                        t0: t0 * scale,
                        t1: t1 * scale,
                        glue: false,
                    }
                })
                .collect()
        };
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words: timed_words(1.0),
            translation: String::new(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let texts = vec![
            "这个说法之所以真的非常之有用而且重要，".to_owned(),
            "是因为它强调了工程仍然存在。".to_owned(),
        ];
        let ranges = vec![(0usize, 1usize), (2usize, source_words.len() - 1)];

        // 图二形态：短源片配长译片，相邻片有富余 ⇒ 提示移界。
        let advisories = time_budget_advisories(&pending, &texts, &ranges, "zh");
        assert_eq!(advisories.len(), 1, "{advisories:?}");
        assert!(advisories[0].contains("move the cut"), "{advisories:?}");
        assert!(advisories[0].contains("next"), "{advisories:?}");

        // 整句过密（时窗压到 1/4）：只报句级"减片/压缩"提示，不再逐片刷屏。
        let dense = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words: timed_words(0.25),
            translation: String::new(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let advisories = time_budget_advisories(&dense, &texts, &ranges, "zh");
        assert_eq!(advisories.len(), 1, "{advisories:?}");
        assert!(advisories[0].contains("fewer pieces"), "{advisories:?}");

        // 无时间信息（全零）不做时间判断。
        let untimed = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words: source_words
                .iter()
                .map(|text| PendingWord {
                    text: (*text).to_owned(),
                    pause_before: 0,
                    t0: 0.0,
                    t1: 0.0,
                    glue: false,
                })
                .collect(),
            translation: String::new(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        assert!(time_budget_advisories(&untimed, &texts, &ranges, "zh").is_empty());
    }

    #[test]
    fn draft_ready_rejects_cjk_midword_and_seam_bearing_overfit_pieces() {
        // 词内切：缝两侧都是表意字符且无标点。
        assert!(cjk_midword_boundary(
            "而在于欧拉如何把这个问题简",
            "化成了简单概念。"
        ));
        assert!(!cjk_midword_boundary(
            "采用新的编程工具，",
            "或被告知转型。"
        ));
        assert!(!cjk_midword_boundary(
            "可以把 Claude Code",
            "为我之前的研究"
        ));

        // fit 一轮到位：超 fit 且片内有小句缝 ⇒ ready=false；由 LLM 本轮修。
        let source_words: Vec<&str> =
            "Euler agreed but the key point is not that this was impossible at all here"
                .split_whitespace()
                .collect();
        let sentence = Sentence {
            id: "s-fit-seam".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source_words.join(" "),
            src_fingerprint: "test".to_owned(),
        };
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words: source_words
                .iter()
                .map(|text| PendingWord {
                    text: (*text).to_owned(),
                    pause_before: 0,
                    t0: 0.0,
                    t1: 0.0,
                    glue: false,
                })
                .collect(),
            translation: "欧拉也认同这一点，但关键不仅在于这不可能，而在于问题的简化方式。"
                .to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let params = TransParams::for_lang("zh");
        let pieces = vec![
            (
                "欧拉也认同这一点，但关键不仅在于这不可能，".to_owned(),
                (0usize, 10usize),
            ),
            ("而在于问题的简化方式。".to_owned(), (11usize, 14usize)),
        ];
        let words_ref: Vec<&str> = source_words.clone();
        let draft = draft_from_pieces(&pending, pieces, &params, "en", "zh", &words_ref);
        assert!(draft.widths[0] > params.fit, "{:?}", draft.widths);
        assert!(
            !draft.ready,
            "an over-fit piece with an internal clause seam must force revision"
        );

        // 度量口径：恰好 fit 个阅读字符但含句中逗号的片，投影后逗号变空格、
        // 视觉超一行——必须与 check 同口径判为可修（G1 "无解残留" 根因）。
        let visual_pieces = vec![
            (
                "也许你可以从这里出发，试着这样过桥，".to_owned(),
                (0usize, 10usize),
            ),
            ("而在于问题的简化方式。".to_owned(), (11usize, 14usize)),
        ];
        let draft = draft_from_pieces(&pending, visual_pieces, &params, "en", "zh", &words_ref);
        assert_eq!(
            draft.widths[0], params.fit,
            "fixture must sit exactly at fit"
        );
        assert!(
            !draft.ready,
            "a visually over-fit piece with an internal seam must force revision"
        );
    }

    #[test]
    fn draft_ready_rejects_single_source_unit_fragments() {
        let source_words = ["out,", "release,", "other."];
        let sentence = Sentence {
            id: "s-single-unit".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source_words.join(" "),
            src_fingerprint: "test".to_owned(),
        };
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words: source_words
                .iter()
                .map(|text| PendingWord {
                    text: (*text).to_owned(),
                    pause_before: 0,
                    t0: 0.0,
                    t1: 0.0,
                    glue: false,
                })
                .collect(),
            translation: "这是一段需要分成多个自然展示片并且不能留下孤立源词的中文译文。"
                .to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let draft = deterministic_draft(&pending, &TransParams::for_lang("zh"), "en", "zh");

        // 3 个源词切 ≥2 片必然出现单词源行，ready 必须拦下。
        assert!(!draft.ready);
        // 不 ready 必须带逐条原因，且进载荷 draftBlockers（p850 二轮复测：
        // 无原因时 worker 只能整句显式重抄）。此 fixture 实际触发的分量是
        // 词内切（单源词片因锚定回退未触发），断言只要求原因非空。
        assert!(!draft.blockers.is_empty());
    }

    #[test]
    fn talk_length_alignment_keeps_a_bounded_call_budget() {
        let sentence_count = 127usize;
        let mut doc = talk_alignment_doc(sentence_count);
        let mut llm = DraftReviewLlm {
            calls: 0,
            fail_first: true,
            request_item_counts: Vec::new(),
        };
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        // 该 fixture 总源文远低于词预算，但 127 条复杂对齐项按 40 条/页与
        // 复杂度预算稳定拆成 5 个首轮页；只有失败的首个页进入唯一修复轮。
        assert_eq!(llm.calls, 6);
        assert_eq!(outcome.aligned_sentences, sentence_count);
        assert_eq!(outcome.fallback_sentences, 0);
        assert_eq!(doc.trans_align["zh"].len(), sentence_count);
    }

    #[test]
    fn global_repair_round_uses_the_same_word_budget() {
        let sentence_count = 127usize;
        let mut doc = talk_alignment_doc(sentence_count);
        let mut llm = DraftReviewLlm {
            calls: 0,
            fail_first: true,
            request_item_counts: Vec::new(),
        };
        run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        // request_item_counts 不记首个（被 fail_first 提前返回的）批次；其余
        // 4 个首轮页加 1 个修复页仍服从同一 40 条上限。接受页与修复页的总数
        // 恰好覆盖全体 127 句，证明失败集合没有被整篇重发。
        assert_eq!(llm.request_item_counts.len(), 5);
        assert_eq!(
            llm.request_item_counts.iter().sum::<usize>(),
            sentence_count
        );
        assert!(
            llm.request_item_counts
                .iter()
                .all(|count| *count <= ALIGN_MAX_ITEMS_PER_PAGE)
        );
    }

    #[test]
    fn zero_repair_budget_does_not_dispatch_a_hidden_second_call() {
        let mut doc = talk_alignment_doc(1);
        let mut options = opts(AlignMode::ManyToOne);
        options.repair_calls = 0;
        let mut llm = DraftReviewLlm {
            calls: 0,
            fail_first: true,
            request_item_counts: Vec::new(),
        };
        let outcome = run_align(&mut doc, &mut llm, &options, &mut |_| {}).unwrap();
        assert_eq!(llm.calls, 1);
        assert_eq!(outcome.fallback_sentences, 1);
        assert_eq!(doc.trans_align["zh"].len(), 1);
    }

    #[test]
    fn targeted_alignment_uses_the_same_word_budget() {
        let sentence_count = 9usize;
        let mut doc = talk_alignment_doc(sentence_count);
        let sentence_ids = derive_sentences(&doc, &derive_cues(&doc, &CueParams::default()))
            .into_iter()
            .map(|sentence| sentence.id)
            .collect();
        let mut options = opts(AlignMode::ManyToOne);
        options.sentences = Some(sentence_ids);
        options.targeted = true;
        let mut llm = DraftReviewLlm {
            calls: 0,
            fail_first: false,
            request_item_counts: Vec::new(),
        };

        let outcome = run_align(&mut doc, &mut llm, &options, &mut |_| {}).unwrap();

        assert_eq!(llm.calls, 1);
        assert_eq!(llm.request_item_counts, vec![sentence_count]);
        assert_eq!(outcome.aligned_sentences, sentence_count);
        assert_eq!(outcome.fallback_sentences, 0);
    }

    #[test]
    fn one_to_one_is_rejected_as_legacy_source_cue_mode() {
        let mut doc = with_translations(two_sentence_doc());
        let mut llm = FakeLlm::ok(std::iter::empty::<&'static str>());
        let error =
            run_align(&mut doc, &mut llm, &opts(AlignMode::OneToOne), &mut |_| {}).unwrap_err();
        assert!(llm.calls.is_empty());
        assert!(error.to_string().contains("legacy source-Cue"));
        assert!(doc.trans_align.is_empty());
    }

    #[test]
    fn long_dwell_sentence_uses_llm_even_when_target_fits() {
        // 译文一行放得下，但整句语音时窗 8s 超过停留护栏——单条字幕会
        // "钉"在屏幕上，仍须入队切分。（源语宽度本身不再触发拆分：多对一
        // 是默认形态。）
        let mut words = Vec::new();
        for index in 0..16 {
            words.push(w(
                &format!("g1.{index}"),
                index as f64 * 0.5,
                (index + 1) as f64 * 0.5,
                if index == 15 { "ending." } else { "word" },
            ));
        }
        let mut doc = doc_with_words(words);
        doc.trans.entry("zh".to_owned()).or_default().insert(
            "s-g1.0".to_owned(),
            "这是第一部分，也是第二部分。".to_owned(),
        );
        let response = ttable(&[tgroup(
            "s-g1.0",
            "",
            &[
                ("word word word word word word word word", "这是第一部分，"),
                (
                    "word word word word word word word ending.",
                    "也是第二部分。",
                ),
            ],
        )]);
        let mut llm = file_llm([response]);
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();

        assert_eq!(llm.calls.len(), 1);
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(outcome.local_sentences, 0);
        assert_eq!(outcome.fallback_sentences, 0);
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(entry.mode, AlignMode::ManyToOne);
        assert_eq!(entry.words.first().map(String::as_str), Some("g1.0"));
        assert_eq!(entry.words.last().map(String::as_str), Some("g1.15"));
        assert_eq!(entry.pieces.first().unwrap().from, Some(0));
        assert_eq!(entry.pieces.last().unwrap().to, Some(15));
        assert_eq!(entry.pieces.len(), 2);
        assert_eq!(entry.pieces[0].text, "这是第一部分，");
        assert_eq!(entry.pieces[1].text, "也是第二部分。");
        // 模型未自报交叉 ⇒ crossing 保持 false。
        assert!(!entry.crossing);
    }

    #[test]
    fn declared_crossing_keeps_worker_rows_best_effort() {
        let mut words = Vec::new();
        for index in 0..16 {
            words.push(w(
                &format!("g1.{index}"),
                index as f64 * 0.5,
                (index + 1) as f64 * 0.5,
                if index == 15 { "ending." } else { "word" },
            ));
        }
        let mut doc = doc_with_words(words);
        doc.trans.entry("zh".to_owned()).or_default().insert(
            "s-g1.0".to_owned(),
            "这是第一部分，也是第二部分。".to_owned(),
        );
        let response = ttable(&[tgroup(
            "s-g1.0",
            " data-crossing=\"true\"",
            &[
                ("word word word word word word word word", "这是第一部分，"),
                (
                    "word word word word word word word ending.",
                    "也是第二部分。",
                ),
            ],
        )]);
        let mut llm = file_llm([response]);
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();

        assert_eq!(outcome.aligned_sentences, 1);
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(entry.mode, AlignMode::ManyToOne);
        // 旧 `crossing` 字段只读。模型自报交叉按 best-effort 接受：保留 worker
        // 的两行与源切点，不再降级成整句一片（对齐块设计 §4.5 修订）。
        assert!(!entry.crossing, "crossing is a legacy read-only field");
        assert_ne!(entry.correspondence(), Correspondence::Sentence);
        assert_eq!(entry.aligner.as_deref(), Some(TABLE_ALIGNER_TAG));
        let texts: Vec<&str> = entry
            .pieces
            .iter()
            .map(|piece| piece.text.as_str())
            .collect();
        assert_eq!(texts, ["这是第一部分，", "也是第二部分。"]);
        assert_eq!(
            entry
                .pieces
                .iter()
                .map(|piece| (piece.from, piece.to))
                .collect::<Vec<_>>(),
            [(Some(0), Some(7)), (Some(8), Some(15))]
        );
        assert!(
            outcome
                .violations
                .iter()
                .any(|violation| violation.contains("declared word-order crossing")),
            "{:?}",
            outcome.violations
        );
        // best-effort 条目是合法的词锚条目。
        assert!(
            crate::split::align_entry_valid(
                &doc,
                &derive_sentences(&doc, &derive_cues(&doc, &CueParams::default()))[0],
                &doc.trans["zh"]["s-g1.0"],
                entry
            ),
            "best-effort crossing entry stays valid"
        );
    }

    #[test]
    fn reordered_target_is_accepted_and_written_to_trans_display() {
        // 原译文语序与源交叉（后半句前置）；worker 自身具备语言能力，直接
        // 重排译句消除交叉，验收后写 `transDisplay`，自然译句 `trans` 不动。
        let mut words = Vec::new();
        for index in 0..16 {
            words.push(w(
                &format!("g1.{index}"),
                index as f64 * 0.5,
                (index + 1) as f64 * 0.5,
                if index == 15 { "ending." } else { "word" },
            ));
        }
        let mut doc = doc_with_words(words);
        doc.trans.entry("zh".to_owned()).or_default().insert(
            "s-g1.0".to_owned(),
            "也是第二部分，这是第一部分。".to_owned(),
        );
        let response = ttable(&[tgroup(
            "s-g1.0",
            " data-reordered=\"true\"",
            &[
                ("word word word word word word word word", "这是第一部分，"),
                (
                    "word word word word word word word ending.",
                    "也是第二部分。",
                ),
            ],
        )]);
        let mut llm = file_llm([response]);
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();

        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(outcome.fallback_sentences, 0);
        // 自然译句真相不动；重排结果进 `transDisplay`（对齐块设计 §6.2）。
        assert_eq!(doc.trans["zh"]["s-g1.0"], "也是第二部分，这是第一部分。");
        let display = &doc.trans_display["zh"]["s-g1.0"];
        assert_eq!(display.text, "这是第一部分，也是第二部分。");
        assert_eq!(display.basis, TABLE_REORDER_BASIS);
        assert_eq!(
            display.trans_fingerprint,
            trans_text_fingerprint("也是第二部分，这是第一部分。")
        );
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(entry.mode, AlignMode::ManyToOne);
        assert!(!entry.crossing, "a successful reorder removes the crossing");
        assert_eq!(entry.correspondence, None);
        assert_eq!(entry.text_basis, TextBasis::Display);
        assert_eq!(entry.pieces[0].text, "这是第一部分，");
        assert_eq!(entry.pieces[1].text, "也是第二部分。");
        // 条目以 display 为基准：对 `transDisplay` 有效，对自然译句无效。
        let sentences = derive_sentences(&doc, &derive_cues(&doc, &CueParams::default()));
        assert!(align_entry_valid_for_lang(&doc, &sentences[0], "zh", entry));
        assert!(!crate::split::align_entry_valid(
            &doc,
            &sentences[0],
            &doc.trans["zh"]["s-g1.0"],
            entry
        ));
        assert_eq!(
            crate::split::basis_text(&doc, "zh", "s-g1.0", entry),
            Some("这是第一部分，也是第二部分。")
        );
        assert!(
            outcome
                .violations
                .iter()
                .any(|violation| violation.contains("reordered")),
            "reorder must surface as a review advisory: {:?}",
            outcome.violations
        );
    }

    #[test]
    fn reordered_target_guards_reject_rewrites() {
        let source = "one two three four five six seven eight nine ten";
        let source_words: Vec<&str> = source.split_whitespace().collect();
        let sentence = Sentence {
            id: "s-reorder".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source.to_owned(),
            src_fingerprint: "test".to_owned(),
        };
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words: source_words
                .iter()
                .map(|text| PendingWord {
                    text: (*text).to_owned(),
                    pause_before: 0,
                    t0: 0.0,
                    t1: 0.0,
                    glue: false,
                })
                .collect(),
            translation: "也是第二部分内容，这是第一部分的内容。".to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let params = TransParams::for_lang("zh");

        // 大幅压缩的“重排”按改写拒收。
        let drift = r#"{"sentences":[{"key":"s-reorder","sourceBreaks":["b5"],"target":"第一部分。 | 完。","reordered":true}]}"#;
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&[&pending], &params, "en", "zh", drift).unwrap();
        assert!(accepted.is_empty());
        assert!(
            failures
                .iter()
                .any(|failure| failure.contains("rewrites too much")),
            "{failures:?}"
        );
    }

    #[test]
    fn style_advisories_do_not_trigger_global_repair() {
        let mut doc = with_translations(two_sentence_doc());
        let response = ttable(&[tgroup(
            "s-g1.0",
            "",
            &[
                (
                    "alpha bravo charlie delta echo,",
                    "第一段译文需要自然对应，第二段译文",
                ),
                ("foxtrot golf hotel.", "负责完整收尾。"),
            ],
        )]);
        let mut llm = file_llm([response]);

        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();

        assert_eq!(llm.calls.len(), 1);
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(outcome.fallback_sentences, 0);
        assert!(
            outcome
                .violations
                .iter()
                .any(|item| item.contains("uneven")),
            "{:?}",
            outcome.violations
        );
    }

    #[test]
    fn independent_splits_by_target_language_without_llm() {
        let mut doc = two_sentence_doc();
        doc.trans.entry("zh".to_owned()).or_default().insert(
            "s-g1.0".to_owned(),
            "这一句的译文很长需要按目标语言自己的habits来切开展示。".to_owned(),
        );
        let mut llm = FakeLlm::ok(std::iter::empty::<&'static str>());
        let outcome = run_align(
            &mut doc,
            &mut llm,
            &opts(AlignMode::Independent),
            &mut |_| {},
        )
        .unwrap();
        assert!(llm.calls.is_empty());
        assert_eq!(outcome.aligned_sentences, 1);
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(entry.mode, AlignMode::Independent);
        assert!(entry.pieces.len() >= 2);
        assert!(entry.pieces.iter().all(|piece| piece.from.is_none()));

        // ≤ fit 的短句：清条目不切。
        doc.trans
            .get_mut("zh")
            .unwrap()
            .insert("s-g1.0".to_owned(), "短句译文。".to_owned());
        let outcome = run_align(
            &mut doc,
            &mut llm,
            &opts(AlignMode::Independent),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(outcome.aligned_sentences, 0);
        assert!(!doc.trans_align.contains_key("zh"));
    }

    #[test]
    fn mixed_product_names_within_visual_units_need_no_entry() {
        let mut doc = two_sentence_doc();
        let translation = "Claude Code、Antigravity，";
        assert!(!exceeds_one_line_fit(translation, "zh", 16));
        assert!(target_cps_chars(translation, "zh") <= 20);
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert("s-g1.0".to_owned(), translation.to_owned());
        let mut llm = FakeLlm::ok(std::iter::empty::<&'static str>());
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        assert!(llm.calls.is_empty());
        assert_eq!(outcome.aligned_sentences, 0);
        assert_eq!(outcome.skipped_sentences, 1);
        assert!(doc.trans_align.is_empty());
    }

    #[test]
    fn bad_answers_use_one_global_repair_then_fall_back() {
        let mut doc = with_translations(two_sentence_doc());
        let bad = ttable(&[tgroup(
            "s-g1.0",
            "",
            &[
                ("alpha bravo charlie delta echo,", "改写过的文本"),
                ("foxtrot golf hotel.", "第二段译文负责完整收尾。"),
            ],
        )]);
        let mut llm = file_llm([bad.clone(), bad]);
        let mut sleeps = Vec::new();
        let outcome = run_align(
            &mut doc,
            &mut llm,
            &opts(AlignMode::ManyToOne),
            &mut |seconds| sleeps.push(seconds),
        )
        .unwrap();
        assert_eq!(llm.calls.len(), 2);
        assert!(sleeps.is_empty());
        let reason = llm.calls[1].3.as_deref().unwrap();
        assert!(
            reason.contains("Every validation problem from the previous round"),
            "{reason}"
        );
        assert_eq!(outcome.aligned_sentences, 0);
        assert_eq!(outcome.fallback_sentences, 1);
        assert!(outcome.violations.iter().any(|v| v.contains("fell back")));
        // 兜底仍是目标语优先 + 源词锚定，拼接不变量保持。
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(entry.mode, AlignMode::ManyToOne);
        assert_eq!(entry.words.len(), 8);
        let concatenated: String = entry
            .pieces
            .iter()
            .map(|piece| piece.text.as_str())
            .collect();
        assert_eq!(
            normalize_chars(&concatenated),
            normalize_chars("第一段译文需要自然对应，第二段译文负责完整收尾。")
        );
    }

    #[test]
    fn partial_batch_keeps_good_sentence_and_falls_back_bad_one() {
        // 两句都超 fit，一批返回：句1 合格，句2 拼接错误 → 只兜底句2。
        let mut doc = doc_with_words(vec![
            w("a0", 0.0, 0.3, "one"),
            w("a1", 0.3, 0.6, "two"),
            w("a2", 0.6, 0.9, "three"),
            w("a3", 0.9, 1.2, "four"),
            w("a4", 1.2, 1.5, "five,"),
            w("a5", 1.5, 1.8, "six"),
            w("a6", 1.8, 2.1, "seven"),
            w("a7", 2.1, 2.4, "eight."),
            w("b0", 2.6, 2.9, "alpha"),
            w("b1", 2.9, 3.2, "bravo"),
            w("b2", 3.2, 3.5, "charlie"),
            w("b3", 3.5, 3.8, "delta"),
            w("b4", 3.8, 4.1, "echo,"),
            w("b5", 4.1, 4.4, "foxtrot"),
            w("b6", 4.4, 4.7, "golf"),
            w("b7", 4.7, 5.0, "hotel."),
        ]);
        let zh = doc.trans.entry("zh".to_owned()).or_default();
        zh.insert(
            "s-a0".to_owned(),
            "第一段译文需要自然对应，第二段译文负责完整收尾。".to_owned(),
        );
        zh.insert(
            "s-b0".to_owned(),
            "另一句也需要切分展示，否则会超过单行容量。".to_owned(),
        );
        let good = ttable(&[
            tgroup(
                "s-a0",
                "",
                &[
                    ("one two three four five,", "第一段译文需要自然对应，"),
                    ("six seven eight.", "第二段译文负责完整收尾。"),
                ],
            ),
            tgroup(
                "s-b0",
                "",
                &[
                    ("alpha bravo charlie delta", "改写过的文本"),
                    ("echo, foxtrot golf hotel.", "否则会超过单行容量。"),
                ],
            ),
        ]);
        let retry_bad = ttable(&[tgroup(
            "s-b0",
            "",
            &[
                ("alpha bravo charlie delta", "还是错的"),
                ("echo, foxtrot golf hotel.", "否则会超过单行容量。"),
            ],
        )]);
        let mut llm = file_llm([good, retry_bad]);
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        assert_eq!(llm.calls.len(), 2);
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(outcome.fallback_sentences, 1);
        assert_eq!(
            doc.trans_align["zh"]["s-a0"].pieces[0].text,
            "第一段译文需要自然对应，"
        );
        let fallback = &doc.trans_align["zh"]["s-b0"];
        let concatenated: String = fallback.pieces.iter().map(|p| p.text.as_str()).collect();
        assert_eq!(
            normalize_chars(&concatenated),
            normalize_chars("另一句也需要切分展示，否则会超过单行容量。")
        );
    }

    /// E2：兜底硬切必须吸附到窗口内的标点缝，而不是按等宽裸切。
    /// 旧实现按 per=13 裸切成「…需要展示，接着」+「是第二…」。
    #[test]
    fn oversize_hard_cut_snaps_to_a_punctuation_seam() {
        let params = TransParams::for_lang("zh");
        let text = "这是第一小句需要展示，接着是第二小句继续展示内容。";
        assert!(target_cps_chars(text, "zh") > params.hard);
        // max_pieces=1 直通 `oversize_hard_cut`（源词少于目标片时的真实入口）。
        let pieces = crate::split::split_independent_for_lang(text, &params, 1, "zh");
        assert_eq!(
            pieces,
            vec![
                "这是第一小句需要展示，".to_owned(),
                "接着是第二小句继续展示内容。".to_owned()
            ],
            "{pieces:?}"
        );
    }

    /// E2：窗口内没有缝时也不得切进 CJK 词内——只要还存在合法词边界（这里是
    /// 拉丁词两侧），就必须放宽窗口吸附过去。
    #[test]
    fn oversize_hard_cut_avoids_cjk_midword_when_a_word_boundary_exists() {
        let params = TransParams::for_lang("zh");
        let text = "这段中文完全没有标点符号里面夹着 API 这个拉丁词继续延伸下去到结尾";
        assert!(target_cps_chars(text, "zh") > params.hard);
        let pieces = crate::split::split_independent_for_lang(text, &params, 1, "zh");
        assert!(pieces.len() >= 2, "{pieces:?}");
        for pair in pieces.windows(2) {
            assert!(
                !crate::seam::cjk_midword_boundary(pair[0].trim_end(), pair[1].trim_start()),
                "cut inside a CJK word: {pair:?}"
            );
        }
    }

    /// E2 的护栏：缝吸附不得把任何一片顶过 hard——`enforce_target_hard_limit`
    /// 会把"仍有超 hard 片"直接判成不可表示并拒收整句。
    #[test]
    fn oversize_hard_cut_keeps_every_piece_under_hard() {
        let params = TransParams::for_lang("zh");
        for text in [
            "这段很长的中文需要被切成很多片才能放得下每一行都必须严格遵守二十字的交付上限否则会被引擎判成不可表示",
            "混合文本里有 tokenizer 和 scheduler 这样的英文词还有 2048 这种数字并且整体长度远远超过一行的容量",
            "这是第一小句需要展示，接着是第二小句继续展示内容，最后还有第三小句负责收尾。",
        ] {
            let pieces = crate::split::split_independent_for_lang(text, &params, 1, "zh");
            for piece in &pieces {
                assert!(
                    target_cps_chars(piece, "zh") <= params.hard,
                    "piece over hard: {piece:?} in {pieces:?}"
                );
            }
            assert_eq!(
                normalize_chars(&pieces.concat()),
                normalize_chars(text),
                "{pieces:?}"
            );
        }
    }

    fn g79_pending<'a>(sentence: &'a Sentence, words: &[&str]) -> Pending<'a> {
        Pending {
            sentence,
            anchor_indices: sentence.word_indices.clone(),
            words: words
                .iter()
                .enumerate()
                .map(|(index, text)| PendingWord {
                    text: (*text).to_owned(),
                    pause_before: 0,
                    t0: index as f64 * 0.4,
                    t1: index as f64 * 0.4 + 0.4,
                    glue: false,
                })
                .collect(),
            translation:
                "生产部署已观察到 50% 的吞吐量提升，同时还可以将 max_num_batched_tokens 设置为大于 2048。"
                    .to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: vec!["max_num_batched_tokens".to_owned()],
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        }
    }

    /// E1(a)：worker 交回的两片答案尾片超 hard，引擎自己的确定性重切把
    /// 「可以」从中间切开、撞上客观缝语病。引擎不得把这个失败记在 worker
    /// 头上——重切作废，原答案整片保留（KeepWhole）。但整片仍超 hard 是
    /// worker 交的片本来就超限：按"先接受、再定向补"的口径，首轮不当场落库，
    /// 而是存进 salvage、只把这一句连同定向说明送回修复轮；修复预算耗尽时
    /// salvage 原样顶上（结果不比直接接受更差）。worker 自述 unsplittable
    /// 则视为契约兑现，直接接受。
    #[test]
    fn engine_keeps_worker_segmentation_when_its_own_recut_breaks_acceptance() {
        let params = TransParams::for_lang("zh");
        let source_words = [
            "Production",
            "deployments",
            "have",
            "seen",
            "fifty",
            "percent",
            "throughput",
            "improvement,",
            "and",
            "you",
            "can",
            "also",
            "set",
            "max_num_batched_tokens",
            "to",
            "greater",
            "than",
            "two",
            "thousand",
            "and",
            "forty",
            "eight",
            "alongside",
            "it.",
        ];
        let sentence = Sentence {
            id: "s-g79.0".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source_words.join(" "),
            src_fingerprint: "test".to_owned(),
        };
        let pending = g79_pending(&sentence, &source_words);
        let batch = vec![&pending];
        let raw = r#"{"sentences":[{"key":"s-g79.0","sourceBreaks":["b8"],"target":"生产部署已观察到 50% 的吞吐量提升， | 同时还可以将 max_num_batched_tokens 设置为大于 2048。"}]}"#;
        let (accepted, salvaged, failures) =
            validate_batch_partial(&batch, &params, "en", "zh", raw).unwrap();
        assert!(accepted.is_empty(), "首轮不当场落库：{accepted:?}");
        assert_eq!(failures.len(), 1, "{failures:?}");
        assert!(
            failures[0].contains("s-g79.0")
                && failures[0].contains("over the absolute hard ceiling")
                && failures[0].contains("data-unsplittable"),
            "定向说明必须指名句子、说明超限片并给出出路：{}",
            failures[0]
        );
        let result = &salvaged["s-g79.0"];
        assert_eq!(result.texts.len(), 2, "{:?}", result.texts);
        assert!(
            result.texts[0].ends_with("提升，"),
            "boundary must stay at the natural comma seam: {:?}",
            result.texts
        );
        // 「可以」必须整词落在同一片里，永远不能被切开。
        assert!(
            result.texts.iter().any(|text| text.contains("可以")),
            "{:?}",
            result.texts
        );
        for pair in result.texts.windows(2) {
            assert!(
                !crate::seam::cjk_midword_boundary(pair[0].trim_end(), pair[1].trim_start()),
                "cut inside a CJK word: {pair:?}"
            );
        }
        assert!(
            result
                .advisories
                .iter()
                .any(|item| item.contains("re-split") && item.contains("abandoned")),
            "{:?}",
            result.advisories
        );
        assert!(
            result
                .advisories
                .iter()
                .any(|item| item.contains("kept as salvage")),
            "{:?}",
            result.advisories
        );

        // 同一答案自述 unsplittable ⇒ 契约兑现，直接接受，不再回炉。
        let declared = raw.replace(r#""sourceBreaks""#, r#""unsplittable":true,"sourceBreaks""#);
        let (accepted, salvaged, failures) =
            validate_batch_partial(&batch, &params, "en", "zh", &declared).unwrap();
        assert!(failures.is_empty(), "{failures:?}");
        assert!(salvaged.is_empty());
        assert_eq!(accepted["s-g79.0"].texts.len(), 2);
    }

    fn dangling_source_doc() -> TranscriptDoc {
        let mut doc = doc_with_words(vec![
            w("a0", 0.0, 0.4, "alpha"),
            w("a1", 0.4, 0.8, "bravo"),
            w("a2", 0.8, 1.2, "charlie"),
            w("a3", 1.2, 1.6, "and"),
            w("a4", 1.6, 2.0, "delta,"),
            w("a5", 2.0, 2.4, "echo"),
            w("a6", 2.4, 2.8, "foxtrot"),
            w("a7", 2.8, 3.2, "golf."),
        ]);
        doc.trans.entry("zh".to_owned()).or_default().insert(
            "s-a0".to_owned(),
            "第一段译文需要自然对应，第二段译文负责完整收尾。".to_owned(),
        );
        doc
    }

    /// E1(b)：修复预算耗尽后，结构完好的 worker 答案顶替
    /// `fallback_word_entry` 的纯长度确定性切分。这里两轮都因源侧形状（切在
    /// 悬垂连词 "and" 之后）被拒，但译文片本身完全合法。
    #[test]
    fn salvaged_worker_answer_replaces_the_deterministic_fallback() {
        let mut doc = dangling_source_doc();
        let answer = ttable(&[tgroup(
            "s-a0",
            "",
            &[
                ("alpha bravo charlie and", "第一段译文需要自然对应，"),
                ("delta, echo foxtrot golf.", "第二段译文负责完整收尾。"),
            ],
        )]);
        let mut llm = file_llm([answer.clone(), answer]);
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        assert_eq!(llm.calls.len(), 2);
        assert_eq!(outcome.fallback_sentences, 0);
        assert_eq!(outcome.aligned_sentences, 1);
        assert!(
            outcome
                .violations
                .iter()
                .any(|item| item.contains("kept the submitted segmentation")),
            "{:?}",
            outcome.violations
        );
        assert!(
            !outcome
                .violations
                .iter()
                .any(|item| item.contains("fell back")),
            "{:?}",
            outcome.violations
        );
        let entry = &doc.trans_align["zh"]["s-a0"];
        assert_eq!(entry.mode, AlignMode::ManyToOne);
        let texts: Vec<&str> = entry
            .pieces
            .iter()
            .map(|piece| piece.text.as_str())
            .collect();
        assert_eq!(
            texts,
            vec!["第一段译文需要自然对应，", "第二段译文负责完整收尾。"],
            "{texts:?}"
        );
    }

    /// E3：修复轮的 retryReason 必须复述**全部**失败（不止最后一条），外加
    /// pieceCount 约束与预算，否则 worker 只盯着一条改、下一轮再撞别的判据。
    #[test]
    fn repair_round_reason_carries_every_problem_and_the_piece_count_plan() {
        let mut doc = doc_with_words(vec![
            w("a0", 0.0, 0.3, "one"),
            w("a1", 0.3, 0.6, "two"),
            w("a2", 0.6, 0.9, "three"),
            w("a3", 0.9, 1.2, "four"),
            w("a4", 1.2, 1.5, "five,"),
            w("a5", 1.5, 1.8, "six"),
            w("a6", 1.8, 2.1, "seven"),
            w("a7", 2.1, 2.4, "eight."),
            w("b0", 2.6, 2.9, "alpha"),
            w("b1", 2.9, 3.2, "bravo"),
            w("b2", 3.2, 3.5, "charlie"),
            w("b3", 3.5, 3.8, "delta"),
            w("b4", 3.8, 4.1, "echo,"),
            w("b5", 4.1, 4.4, "foxtrot"),
            w("b6", 4.4, 4.7, "golf"),
            w("b7", 4.7, 5.0, "hotel."),
        ]);
        let zh = doc.trans.entry("zh".to_owned()).or_default();
        zh.insert(
            "s-a0".to_owned(),
            "第一段译文需要自然对应，第二段译文负责完整收尾。".to_owned(),
        );
        zh.insert(
            "s-b0".to_owned(),
            "另一句也需要切分展示，否则会超过单行容量。".to_owned(),
        );
        // 两句都改写了译文（拼接不符）。
        let bad = ttable(&[
            tgroup(
                "s-a0",
                "",
                &[
                    ("one two three four five,", "完全改写过的第一段文本，"),
                    ("six seven eight.", "第二段译文负责完整收尾。"),
                ],
            ),
            tgroup(
                "s-b0",
                "",
                &[
                    ("alpha bravo charlie delta echo,", "改写内容，"),
                    ("foxtrot golf hotel.", "否则会超过单行容量。"),
                ],
            ),
        ]);
        let mut llm = file_llm([bad.clone(), bad]);
        let _ = run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        assert_eq!(llm.calls.len(), 2);
        let reason = llm.calls[1].3.as_deref().unwrap();
        assert!(
            reason.contains("Every validation problem from the previous round"),
            "{reason}"
        );
        // 两句的失败都必须在场，不能只留最后一条。
        assert!(reason.contains("s-a0"), "{reason}");
        assert!(reason.contains("s-b0"), "{reason}");
        assert!(reason.contains("[align-content-drift]"), "{reason}");
        // pieceCount 与预算复述。
        assert!(reason.contains("rows min="), "{reason}");
        assert!(reason.contains("recommended="), "{reason}");
        assert!(reason.contains("budgets fit="), "{reason}");
    }

    #[test]
    fn over_hard_target_piece_is_force_split_without_retry() {
        let long = "超".repeat(21);
        let source_words: Vec<String> = (0..10).map(|index| format!("word{index}")).collect();
        let sentence = Sentence {
            id: "s-hard".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source_words.join(" "),
            src_fingerprint: "test".to_owned(),
        };
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words: source_words
                .iter()
                .map(|text| PendingWord {
                    text: text.clone(),
                    pause_before: 0,
                    t0: 0.0,
                    t1: 0.0,
                    glue: false,
                })
                .collect(),
            translation: format!("{long}尾。"),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let batch = vec![&pending];
        let raw = format!(
            r#"{{"sentences":[{{"key":"s-hard","sourceBreaks":["b5"],"target":"{long} | 尾。"}}]}}"#
        );
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&batch, &TransParams::for_lang("zh"), "en", "zh", &raw).unwrap();
        assert!(failures.is_empty(), "{failures:?}");
        let result = &accepted["s-hard"];
        // 强拆出的「尾。」碎片随后被 flash 修复并入邻片：3 → 2。
        assert_eq!(result.texts.len(), 2);
        assert!(
            result
                .texts
                .iter()
                .all(|text| target_cps_chars(text, "zh") <= 20),
            "{:?}",
            result.texts
        );
        assert!(
            result
                .advisories
                .iter()
                .any(|item| item.contains("deterministically split")),
            "{:?}",
            result.advisories
        );
    }

    #[test]
    fn more_target_pieces_than_source_words_stay_under_hard_without_retry() {
        let mut doc = doc_with_words(vec![w("g1.0", 0.0, 3.0, "source.")]);
        doc.media.duration = 3.0;
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        assert_eq!(sentences.len(), 1);
        let sentence_id = sentences[0].id.clone();
        let translation = "这是一段极端扩写的中文译文没有足够的英文词可以逐片对应但每个展示片仍然必须严格遵守二十字的交付上限。";

        let pending = Pending {
            sentence: &sentences[0],
            anchor_indices: sentences[0].word_indices.clone(),
            words: vec![PendingWord {
                text: "source.".to_owned(),
                pause_before: 0,
                t0: 0.0,
                t1: 0.0,
                glue: false,
            }],
            translation: translation.to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let fallback = fallback_word_entry(
            &doc,
            &pending,
            translation,
            "zh",
            &TransParams::for_lang("zh"),
        );
        assert_eq!(fallback.mode, AlignMode::Independent);
        assert!(fallback.pieces.len() > 1);
        assert!(
            fallback
                .pieces
                .iter()
                .all(|piece| target_cps_chars(&piece.text, "zh") <= 20),
            "{:?}",
            fallback.pieces
        );

        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert(sentence_id.clone(), translation.to_owned());
        let response = ttable(&[tgroup(&sentence_id, "", &[("source.", translation)])]);
        let mut llm = file_llm([response]);
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        assert_eq!(llm.calls.len(), 1);
        assert_eq!(outcome.fallback_sentences, 0);
        let entry = &doc.trans_align["zh"][&sentence_id];
        assert_eq!(entry.mode, AlignMode::Independent);
        assert!(entry.pieces.len() > doc.words.len());
        assert!(
            entry
                .pieces
                .iter()
                .all(|piece| piece.from.is_none() && piece.to.is_none())
        );
        assert!(
            entry
                .pieces
                .iter()
                .all(|piece| target_cps_chars(&piece.text, "zh") <= 20)
        );

        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        assert_eq!(stream.len(), entry.pieces.len());
        assert!(stream.iter().all(|cue| cue.word_span.is_none()));
        assert_eq!(stream.first().unwrap().start, 0.0);
        assert_eq!(stream.last().unwrap().end, 3.0);
        assert!(stream.windows(2).all(|pair| pair[0].end == pair[1].start));
    }

    #[test]
    fn reordered_cause_and_result_is_force_split_under_hard() {
        let source = "Now, it turns out they were actually 20 percent less productive and slower because of these new tools that were introduced.";
        let source_words: Vec<&str> = source.split_whitespace().collect();
        assert_eq!(source_words.len(), 21);
        let sentence = Sentence {
            id: "s-cross".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source.to_owned(),
            src_fingerprint: "test".to_owned(),
        };
        let translation =
            "结果却发现，引入这些新工具后，他们的生产力实际上降低了 20%，工作速度也更慢。";
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words: source_words
                .iter()
                .map(|text| PendingWord {
                    text: (*text).to_owned(),
                    pause_before: 0,
                    t0: 0.0,
                    t1: 0.0,
                    glue: false,
                })
                .collect(),
            translation: translation.to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let batch = vec![&pending];
        let target =
            "结果却发现， | 引入这些新工具后，他们的生产力实际上降低了 20%，工作速度也更慢。";

        let response = format!(
            r#"{{"sentences":[{{"key":"s-cross","sourceBreaks":["b4"],"target":"{target}"}}]}}"#
        );
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&batch, &TransParams::for_lang("zh"), "en", "zh", &response)
                .unwrap();
        assert!(failures.is_empty(), "{failures:?}");
        let result = &accepted["s-cross"];
        assert!(result.texts.len() >= 3, "{:?}", result.texts);
        assert!(
            matches!(result.anchor, AcceptedAnchor::Independent),
            "unsafe proportional source seams must not be persisted"
        );
        assert!(
            result
                .texts
                .iter()
                .all(|text| { target_cps_chars(text, "zh") <= TransParams::for_lang("zh").hard }),
            "{:?}",
            result.texts
        );
        let concatenated: String = result.texts.iter().map(String::as_str).collect();
        assert_eq!(normalize_chars(&concatenated), normalize_chars(translation));
    }

    #[test]
    fn validate_pieces_never_accepts_legacy_crossing_overflow() {
        let too_long = "长".repeat(21);
        let pieces = vec![
            PieceJson {
                from: 0,
                to: 0,
                text: "短".to_owned(),
            },
            PieceJson {
                from: 1,
                to: 1,
                text: too_long.clone(),
            },
        ];
        let result = validate_pieces(
            "s-cross",
            &pieces,
            2,
            &format!("短{too_long}"),
            "zh",
            &TransParams::for_lang("zh"),
        );
        assert!(
            matches!(result, Err(LlmError::Malformed(ref detail)) if detail.contains("absolute hard ceiling")),
            "{result:?}"
        );
    }

    #[test]
    fn whole_over_hard_sentence_is_force_split_even_without_source_breaks() {
        let source = "Well, this is how we've delivered high-quality software for decades.";
        let source_words: Vec<&str> = source.split_whitespace().collect();
        let sentence = Sentence {
            id: "s-whole-cross".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source.to_owned(),
            src_fingerprint: "test".to_owned(),
        };
        let translation = "几十年来，我们一直这样交付高质量软件，并且还会继续改进整个流程。";
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words: source_words
                .iter()
                .map(|text| PendingWord {
                    text: (*text).to_owned(),
                    pause_before: 0,
                    t0: 0.0,
                    t1: 0.0,
                    glue: false,
                })
                .collect(),
            translation: translation.to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let batch = vec![&pending];
        let response = format!(
            r#"{{"sentences":[{{"key":"s-whole-cross","sourceBreaks":[],"target":"{translation}"}}]}}"#
        );
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&batch, &TransParams::for_lang("zh"), "en", "zh", &response)
                .unwrap();
        assert!(failures.is_empty(), "{failures:?}");
        let result = &accepted["s-whole-cross"];
        assert!(result.texts.len() >= 2, "{:?}", result.texts);
        assert!(
            result
                .texts
                .iter()
                .all(|text| target_cps_chars(text, "zh") <= 20),
            "{:?}",
            result.texts
        );
    }

    #[test]
    fn relation_break_candidates_explain_why_thanks_to_must_stay_together() {
        let words: Vec<&str> = "developers who thought that they were faster thanks to the tools"
            .split_whitespace()
            .collect();
        assert_eq!(source_boundary_issue(&words, 4), None);
        assert!(
            source_boundary_issue(&words, 8).is_some_and(|reason| reason.contains("thanks to")),
            "{:?}",
            source_boundary_issue(&words, 8)
        );
    }

    #[test]
    fn required_infinitive_complement_is_a_blocking_source_boundary() {
        let words = "Which means when I find a need to write prompts in order to improve"
            .split_whitespace()
            .collect::<Vec<_>>();
        let reason = source_boundary_issue(&words, 7).expect("need | to must be rejected");
        assert!(reason.contains("infinitive complement"), "{reason}");
        assert!(source_boundary_issue_is_blocking(&reason), "{reason}");
    }

    #[test]
    fn fused_em_dash_atom_still_exposes_dangling_article_boundary() {
        assert!(
            source_boundary_issue(&["matters—the", "part"], 1)
                .is_some_and(|reason| reason.contains("dangling source tail")),
        );
    }

    #[test]
    fn reciprocal_phrase_may_end_before_the_next_preposition() {
        let words: Vec<&str> = "teams are waiting for each other across fragmented tools"
            .split_whitespace()
            .collect();
        assert!(
            source_boundary_issue(&words, 5).is_some(),
            "each | other must remain a risky split"
        );
        assert_eq!(
            source_boundary_issue(&words, 6),
            None,
            "each other | across closes a complete reciprocal phrase"
        );
    }

    #[test]
    fn source_boundary_keeps_do_it_this_way_together() {
        let words: Vec<&str> = "the benefit of doing it this way is clear"
            .split_whitespace()
            .collect();
        assert!(
            source_boundary_issue(&words, 5)
                .is_some_and(|reason| reason.contains("do it this way"))
        );
        assert_eq!(
            source_boundary_issue(&["We", "fixed", "it.", "This", "way", "works."], 3),
            None,
            "句末后的新句不能被固定短语规则误报"
        );
    }

    /// `doing this |`、`reach for this |`：this 是及物动词/介词的宾语代词，
    /// 不是悬空限定词；这类边界曾被 BOUND_MODIFIERS 全量误报。
    #[test]
    fn source_boundary_allows_pronoun_object_this() {
        let words: Vec<&str> = "the reason for doing this is that it scales"
            .split_whitespace()
            .collect();
        assert_eq!(
            source_boundary_issue(&words, 5),
            None,
            "及物动词宾语代词 this 不是悬空修饰语"
        );
        let words: Vec<&str> = "the tools you reach for this instead of that"
            .split_whitespace()
            .collect();
        assert_eq!(
            source_boundary_issue(&words, 6),
            None,
            "介词宾语代词 this 不是悬空修饰语"
        );
        // 真限定词用法仍必须提示：下一片以名词中心语开头。
        let words: Vec<&str> = "we are going to use this model for everything"
            .split_whitespace()
            .collect();
        assert!(
            source_boundary_issue(&words, 6)
                .is_some_and(|reason| reason.contains("detached from its noun phrase")),
            "限定词 this 后接名词仍应报悬空修饰语"
        );
    }

    #[test]
    fn render_source_marks_pauses_and_spacing() {
        let words = vec![
            PendingWord {
                text: "Hello".to_owned(),
                pause_before: 0,
                t0: 0.0,
                t1: 0.0,
                glue: false,
            },
            PendingWord {
                text: "world,".to_owned(),
                pause_before: 0,
                t0: 0.0,
                t1: 0.0,
                glue: false,
            },
            PendingWord {
                text: "again.".to_owned(),
                pause_before: 2,
                t0: 0.0,
                t1: 0.0,
                glue: false,
            },
        ];
        assert_eq!(render_source(&words), "Hello world, ⏸⏸ again.");
        let cjk = vec![
            PendingWord {
                text: "你".to_owned(),
                pause_before: 0,
                t0: 0.0,
                t1: 0.0,
                glue: false,
            },
            PendingWord {
                text: "好".to_owned(),
                pause_before: 0,
                t0: 0.0,
                t1: 0.0,
                glue: false,
            },
            PendingWord {
                text: "吗".to_owned(),
                pause_before: 3,
                t0: 0.0,
                t1: 0.0,
                glue: false,
            },
        ];
        assert_eq!(render_source(&cjk), "你好 ⏸⏸⏸ 吗");
    }

    #[test]
    fn source_segments_reanchor_ignores_pause_marks_and_rejects_midword_cuts() {
        let words: Vec<PendingWord> = ["alpha", "bravo,", "charlie", "delta."]
            .iter()
            .map(|text| PendingWord {
                text: (*text).to_owned(),
                pause_before: 0,
                t0: 0.0,
                t1: 0.0,
                glue: false,
            })
            .collect();
        let good = split_marked("alpha bravo, ⏸ | charlie delta.");
        assert_eq!(
            source_segments_to_ranges("s-x", &good, &words).unwrap(),
            vec![(0, 1), (2, 3)]
        );
        let midword = split_marked("alpha bra | vo, charlie delta.");
        assert!(
            source_segments_to_ranges("s-x", &midword, &words)
                .unwrap_err()
                .contains("verbatim")
        );
        let incomplete = split_marked("alpha bravo, | charlie");
        assert!(
            source_segments_to_ranges("s-x", &incomplete, &words)
                .unwrap_err()
                .contains("include every word")
        );
    }

    #[test]
    fn real_ai_tool_sentence_rejects_detached_bound_noun_phrase() {
        let source = "When I talk to developers, a lot of folks are worried about how AI might take their job. Maybe they've been pressured to pick up a new AI-assisted coding tool, or they're being told to become AI-native.";
        let source_words: Vec<&str> = source.split_whitespace().collect();
        assert_eq!(source_words.len(), 37);
        let sentence = Sentence {
            id: "s-g1.0".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source.to_owned(),
            src_fingerprint: "test".to_owned(),
        };
        let words = source_words
            .iter()
            .map(|text| PendingWord {
                text: (*text).to_owned(),
                pause_before: 0,
                t0: 0.0,
                t1: 0.0,
                glue: false,
            })
            .collect();
        let translation = "和开发者交流时，我发现很多人担心AI会抢走自己的工作。他们可能被要求使用新的AI辅助编程工具，或被告知要成为“AI原生”开发者。";
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words,
            translation: translation.to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let batch = vec![&pending];
        let target = "和开发者交流时， | 我发现很多人担心AI会抢走自己的工作。 | 他们可能被要求使用新的AI辅助编程工具， | 或被告知要成为“AI原生”开发者。";

        let good = format!(
            r#"{{"sentences":[{{"key":"s-g1.0","sourceBreaks":["b5","b18","b30"],"target":"{target}"}}]}}"#
        );
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&batch, &TransParams::for_lang("zh"), "en", "zh", &good)
                .unwrap();
        assert!(failures.is_empty(), "{failures:?}");
        let AcceptedAnchor::WordRanges(ranges) = &accepted["s-g1.0"].anchor else {
            panic!("expected word-anchored alignment")
        };
        assert_eq!(
            ranges
                .iter()
                .map(|(from, to)| to - from + 1)
                .collect::<Vec<_>>(),
            vec![5, 13, 12, 7]
        );

        // 旧比例锚定的欠佳切点 b27 正好落在 `a new | AI-assisted...`。
        // 这是客观坏缝，必须进入全局 repair，而不是留到 done 后再精修。
        let bad = format!(
            r#"{{"sentences":[{{"key":"s-g1.0","sourceBreaks":["b5","b18","b27"],"target":"{target}"}}]}}"#
        );
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&batch, &TransParams::for_lang("zh"), "en", "zh", &bad).unwrap();
        assert!(accepted.is_empty(), "{accepted:?}");
        assert!(
            failures
                .iter()
                .any(|failure| failure.contains("detached from its noun phrase")),
            "{failures:?}"
        );
    }

    /// P0-a 回归：超一行且有自由缝的片在接受期就地切开（文本 + 源区间同
    /// 步），不回炉。回炉要吃全局唯一的修复调用（抢的是别句的机会），而
    /// `free_seam` 已经把切点连同两侧文本一起算好了——和闪现碎片修复同理。
    #[test]
    fn over_fit_answer_piece_is_repaired_at_its_free_seam() {
        let source = "Your GPU has idle compute between memory reads, so speculative decoding gives you free tokens.";
        let source_words: Vec<&str> = source.split_whitespace().collect();
        let sentence = Sentence {
            id: "s-fit1".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source.to_owned(),
            src_fingerprint: "test".to_owned(),
        };
        let words = source_words
            .iter()
            .enumerate()
            .map(|(index, text)| PendingWord {
                text: (*text).to_owned(),
                pause_before: 0,
                t0: index as f64 * 0.5,
                t1: (index + 1) as f64 * 0.5,
                glue: false,
            })
            .collect();
        let translation = "你的 GPU 在显存读取之间会有空闲算力——所以推测解码能白送你 token。";
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words,
            translation: translation.to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let batch = vec![&pending];
        let params = TransParams::for_lang("zh");
        assert!(exceeds_one_line_fit(
            "你的 GPU 在显存读取之间会有空闲算力——",
            "zh",
            params.fit
        ));
        let answer = r#"{"sentences":[{"key":"s-fit1","sourceBreaks":["b8"],"target":"你的 GPU 在显存读取之间会有空闲算力—— | 所以推测解码能白送你 token。"}]}"#;
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&batch, &params, "en", "zh", answer).unwrap();
        assert!(failures.is_empty(), "{failures:?}");
        let entry = &accepted["s-fit1"];
        assert_eq!(
            entry.texts,
            vec![
                "你的 GPU".to_owned(),
                "在显存读取之间会有空闲算力——".to_owned(),
                "所以推测解码能白送你 token。".to_owned(),
            ]
        );
        let AcceptedAnchor::WordRanges(ranges) = &entry.anchor else {
            panic!("expected word-anchored alignment")
        };
        assert_eq!(ranges.len(), 3);
        assert_eq!(ranges[0].0, 0);
        assert_eq!(ranges[2].1, source_words.len() - 1);
        for text in &entry.texts {
            assert!(
                !exceeds_one_line_fit(text, "zh", params.fit),
                "repaired pieces must fit one line: {:?}",
                entry.texts
            );
        }
    }

    #[test]
    fn seam_backed_risky_boundary_is_accepted() {
        // 小句缝（逗号）与 risky 标注同界：缝上的 bound-phrase 检测多为
        // 误报，引擎与提交期 lint 都放行（p850 基准 3 次拒绝全是此类）。
        let source = "You can find value in that, but the rest is noise.";
        let source_words: Vec<&str> = source.split_whitespace().collect();
        let sentence = Sentence {
            id: "s-r1".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source.to_owned(),
            src_fingerprint: "test".to_owned(),
        };
        let words = source_words
            .iter()
            .enumerate()
            .map(|(index, text)| PendingWord {
                text: (*text).to_owned(),
                pause_before: 0,
                t0: index as f64 * 0.5,
                t1: (index + 1) as f64 * 0.5,
                glue: false,
            })
            .collect();
        let translation = "你能在其中找到不少价值，但其余的部分都是噪音。";
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words,
            translation: translation.to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let batch = vec![&pending];
        // b6 = after "that,"：ends_clause_punct ⇒ seam3，同时 tail "that"
        // 命中 BOUND_MODIFIERS ⇒ risky。
        let answer = r#"{"sentences":[{"key":"s-r1","sourceBreaks":["b6"],"target":"你能在其中找到不少价值， | 但其余的部分都是噪音。"}]}"#;
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&batch, &TransParams::for_lang("zh"), "en", "zh", answer)
                .unwrap();
        assert!(failures.is_empty(), "{failures:?}");
        assert!(accepted.contains_key("s-r1"));
    }

    #[test]
    fn full_rerun_splits_the_observed_55_item_workload_into_two_pages() {
        let sentence_count = 55usize;
        let mut doc = talk_alignment_doc(sentence_count);
        let sentence_ids = derive_sentences(&doc, &derive_cues(&doc, &CueParams::default()))
            .into_iter()
            .map(|sentence| sentence.id)
            .collect();
        let mut options = opts(AlignMode::ManyToOne);
        options.sentences = Some(sentence_ids);
        let mut llm = DraftReviewLlm {
            calls: 0,
            fail_first: false,
            request_item_counts: Vec::new(),
        };
        let outcome = run_align(&mut doc, &mut llm, &options, &mut |_| {}).unwrap();
        assert_eq!(llm.calls, 2);
        assert_eq!(llm.request_item_counts.len(), 2);
        assert_eq!(
            llm.request_item_counts.iter().sum::<usize>(),
            sentence_count
        );
        assert!(
            llm.request_item_counts
                .iter()
                .all(|count| *count <= ALIGN_MAX_ITEMS_PER_PAGE)
        );
        assert_eq!(outcome.aligned_sentences, sentence_count);
    }

    #[test]
    fn targeted_mode_and_worker_slots_do_not_change_paging() {
        let sentence_count = 17usize;
        let mut doc = talk_alignment_doc(sentence_count);
        let mut options = opts(AlignMode::ManyToOne);
        options.targeted = true;
        options.worker_slots = Some(6);
        let mut llm = DraftReviewLlm {
            calls: 0,
            fail_first: false,
            request_item_counts: Vec::new(),
        };
        let outcome = run_align(&mut doc, &mut llm, &options, &mut |_| {}).unwrap();
        assert_eq!(llm.calls, 1);
        assert_eq!(llm.request_item_counts, vec![sentence_count]);
        assert_eq!(outcome.aligned_sentences, sentence_count);
    }

    #[test]
    fn align_item_cost_counts_latin_words_and_cjk_characters() {
        let sentence = Sentence {
            id: "s-test".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: vec![0, 1],
            source_text: "one two 三四".to_owned(),
            src_fingerprint: "test".to_owned(),
        };
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: vec![0, 1],
            words: vec![
                PendingWord {
                    text: "one two".to_owned(),
                    pause_before: 0,
                    t0: 0.0,
                    t1: 1.0,
                    glue: false,
                },
                PendingWord {
                    text: "三四".to_owned(),
                    pause_before: 0,
                    t0: 1.0,
                    t1: 2.0,
                    glue: false,
                },
            ],
            translation: "测试译文。".to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        assert_eq!(align_item_word_count(&pending), 4);
        assert_eq!(crate::paging::PageExecutor::Agent.align_words(), 2000);
        assert_eq!(crate::paging::PageExecutor::Provider.align_words(), 2000);
    }

    #[test]
    fn pause_tier_thresholds() {
        assert_eq!(pause_tier(0.1), 0);
        assert_eq!(pause_tier(0.3), 1);
        assert_eq!(pause_tier(0.7), 2);
        assert_eq!(pause_tier(1.5), 3);
    }

    #[test]
    fn anchor_token_must_share_segment_index() {
        // 实测样本:"from TeachFX" 在中文里前置为 "TeachFX 里…",切点切进
        // 交叉区后 TeachFX 两侧段号不一致 → 必须打回。
        let src =
            split_marked("\"Pull | my latest second-grade ELA lesson from TeachFX, tell me more.");
        let tgt = split_marked("“调取 TeachFX | 里我最新的二年级 ELA 课,再多告诉我一些。");
        let err = anchor_token_colocation("s-x", &src, &tgt).unwrap_err();
        assert!(err.contains("teachfx"), "{err}");
        // 同段则通过(整段保留交叉区)。
        let src_ok =
            split_marked("\"Pull my latest second-grade ELA lesson from TeachFX, | tell me more.");
        let tgt_ok = split_marked("“调取 TeachFX 里我最新的二年级 ELA 课, | 再多告诉我一些。");
        assert!(anchor_token_colocation("s-x", &src_ok, &tgt_ok).is_ok());
    }

    /// 退化配对行（R2 基准 `s-g29.0`：`have` 1 词挂 9u 中文）。
    #[test]
    fn degenerate_paired_row_rejects_crumb_source_ranges() {
        let texts = vec![
            "但每一步都得".to_owned(),
            "对之前所有的 token".to_owned(),
            "重新计算一遍注意力。".to_owned(),
        ];
        // 源侧 12 词：前两片各 2 / 1 词，第三片吃掉其余。
        let units = vec![2; 12];
        let ranges = [(0, 1), (2, 2), (3, 11)];
        let (piece, words, target_units) =
            degenerate_paired_row(&texts, &ranges, &units, "zh-Hans").unwrap();
        assert_eq!((piece, words), (2, 1), "{target_units}");

        // 每片都拿到 ≥3 词时不报。
        let even = [(0, 2), (3, 6), (7, 11)];
        assert!(degenerate_paired_row(&texts, &even, &units, "zh-Hans").is_none());

        // 整句词数不够分配时豁免（否则要求不可满足，只会空转回炉）。
        let scarce = vec![2; 5];
        let tight = [(0, 1), (2, 2), (3, 4)];
        assert!(degenerate_paired_row(&texts, &tight, &scarce, "zh-Hans").is_none());

        // 源区间自身够宽（长标识符）且有 2 个词时不算失衡：40% 判据放行。
        let mut wide = vec![2; 12];
        wide[1] = 12;
        wide[2] = 12;
        let wide_pair = [(0, 0), (1, 2), (3, 11)];
        assert!(degenerate_paired_row(&texts, &wide_pair, &wide, "zh-Hans").is_none());

        // 但单词区间不吃宽度豁免：逐字高亮只走一步，观感断裂照旧。
        let mut lone = vec![2; 12];
        lone[2] = 24;
        let (piece, words, _) = degenerate_paired_row(&texts, &ranges, &lone, "zh-Hans").unwrap();
        assert_eq!((piece, words), (2, 1));
    }

    /// 交叉检测扩口径：纯数字 token 与重复出现的 token 都参与，判据是
    /// 「段号集合不相交」（R2 基准 §4.4 两处未检出 advisory 的模式）。
    #[test]
    fn anchor_colocation_detects_numeric_and_repeated_tokens() {
        // 纯数字锚点（旧口径要求含拉丁字母，整类漏过）。
        let src = split_marked("Set it to 2048 | and the scheduler stops thrashing.");
        let tgt = split_marked("调度器就不再抖动， | 只要把它设为 2048。");
        let err = anchor_token_colocation("s-n", &src, &tgt).unwrap_err();
        assert!(err.contains("2048"), "{err}");

        // 重复出现的 token：两侧各出现两次，但段号集合不相交。
        let repeated_src = split_marked("token by token | we store each token.");
        let repeated_tgt = split_marked("我们逐 token 存储 | 每一个 token。");
        assert!(anchor_token_colocation("s-r", &repeated_src, &repeated_tgt).is_ok());
        // 同一段内重复出现（旧口径按 len != 1 直接跳过）而译文落在另一段。
        let crossed_src = split_marked("token by token we store | it in the paged cache.");
        let crossed_tgt = split_marked("我们把它放进分页缓存里， | 逐 token 地存。");
        let err = anchor_token_colocation("s-c", &crossed_src, &crossed_tgt).unwrap_err();
        assert!(err.contains("token"), "{err}");

        // 词区间入口（check 复算）与直接调用同判据。
        let words = ["Set", "it", "to", "2048", "and", "it", "stops"];
        let targets = vec![
            "调度器就不再抖动，".to_owned(),
            "只要把它设为 2048。".to_owned(),
        ];
        let issue = anchor_colocation_issue_for_ranges(&words, &targets, &[(0, 3), (4, 6)]);
        assert!(issue.is_some_and(|reason| reason.contains("2048")));
        // 段号错位以外不报；越界区间安全返回 None。
        assert!(anchor_colocation_issue_for_ranges(&words, &targets, &[(0, 3), (4, 99)]).is_none());
    }

    /// P1-a 修法二：小数/版本号/带连字符的标识符要保住整形。
    ///
    /// 旧切分按 `[^0-9A-Za-z]+` 切，`0.8` 会被拆成 `0`/`8`，再被 `len >= 2`
    /// 滤干净——配置类内容里这类数值恰恰是最可靠的锚点，整类漏检。
    #[test]
    fn anchor_colocation_keeps_decimal_and_flag_token_shapes() {
        let src = split_marked("Set gpu_memory_utilization to 0.8 | before you serve the model.");
        let tgt = split_marked("在开始服务模型之前， | 把 gpu_memory_utilization 设为 0.8。");
        let err = anchor_token_colocation("s-d", &src, &tgt).unwrap_err();
        assert!(err.contains("0.8"), "{err}");

        // CLI flag 与版本号同理：前导连字符剥掉，标识符本身不被打碎。
        let flag_src = split_marked("Pass --speculative-model v0.3 | to the server.");
        let flag_tgt = split_marked("传给服务端， | 用 --speculative-model v0.3。");
        let err = anchor_token_colocation("s-f", &flag_src, &flag_tgt).unwrap_err();
        assert!(
            err.contains("speculative-model") || err.contains("v0.3"),
            "{err}"
        );

        // 同段命中仍然不报（句末句点不该把 token 变成另一个 token）。
        let same_src = split_marked("We set it to 0.8 | and moved on.");
        let same_tgt = split_marked("我们把它设为 0.8 | 然后继续。");
        assert!(anchor_token_colocation("s-s", &same_src, &same_tgt).is_ok());
    }

    #[test]
    fn translated_glossary_anchor_is_a_provider_and_agent_hard_gate() {
        let source = "We write prompts every day to improve agent performance.";
        let source_words = source.split_whitespace().collect::<Vec<_>>();
        let sentence = Sentence {
            id: "s-anchor".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source.to_owned(),
            src_fingerprint: "test".to_owned(),
        };
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words: source_words
                .iter()
                .enumerate()
                .map(|(index, text)| PendingWord {
                    text: (*text).to_owned(),
                    pause_before: 0,
                    t0: index as f64 * 0.3,
                    t1: (index + 1) as f64 * 0.3,
                    glue: false,
                })
                .collect(),
            translation: "我们每天编写提示词，来提升智能体性能。".to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: vec!["提示词".to_owned()],
            bilingual_anchors: vec![BilingualAnchor {
                source: "prompts".to_owned(),
                target: "提示词".to_owned(),
            }],
            source_cue_keys: Vec::new(),
        };
        let params = TransParams::for_lang("zh");
        let bad = r#"{"sentences":[{"key":"s-anchor","sourceBreaks":["b2"],"target":"我们每天编写提示词， | 来提升智能体性能。"}]}"#;
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&[&pending], &params, "en", "zh", bad).unwrap();
        assert!(accepted.is_empty());
        assert!(
            failures
                .iter()
                .any(|failure| failure.contains("bilingual anchor")),
            "{failures:?}"
        );

        let good = r#"{"sentences":[{"key":"s-anchor","sourceBreaks":["b3"],"target":"我们每天编写提示词， | 来提升智能体性能。"}]}"#;
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&[&pending], &params, "en", "zh", good).unwrap();
        assert!(failures.is_empty(), "{failures:?}");
        assert!(accepted.contains_key("s-anchor"));
    }

    #[test]
    fn length_plan_uses_character_units_and_target_driven_counts() {
        let doc = doc_with_words(
            (0..37)
                .map(|index| {
                    w(
                        &format!("g1.{index}"),
                        index as f64 * 0.2,
                        (index + 1) as f64 * 0.2,
                        if index == 36 { "ending." } else { "word" },
                    )
                })
                .collect(),
        );
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        assert_eq!(sentences.len(), 1);
        let words = sentences[0]
            .word_indices
            .iter()
            .map(|&index| PendingWord {
                text: doc.words[index].text.clone(),
                pause_before: 0,
                t0: 0.0,
                t1: 0.0,
                glue: false,
            })
            .collect();
        let item = Pending {
            sentence: &sentences[0],
            anchor_indices: sentences[0].word_indices.clone(),
            words,
            translation: "中".repeat(57),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let plan = length_plan(&item, &TransParams::for_lang("zh"), "en", "zh");
        // 片数由译文阅读需求驱动：57 阅读单位 / fit16..soft14 ⇒ 4..5 片。
        assert_eq!(plan.piece_count.min, 4);
        assert_eq!(plan.piece_count.max, 5);
        assert_eq!(plan.piece_count.recommended, 4);
        // 源侧统一字符口径：36×"word" + "ending"（交付投影剥句末标点）
        // = 150 非空白字符。
        assert_eq!(plan.source.unit, "character");
        assert_eq!(plan.source.total, 150);
        assert_eq!(plan.source.preferred_per_piece, [28, 47]);
        assert_eq!(plan.target.unit, "readingCharacter");
        assert_eq!(plan.target.total, 57);
        assert_eq!(plan.target.preferred_per_piece, [10, 18]);
        assert_eq!(length_unit_name("ja"), "readingCharacter");
        assert_eq!(length_unit_name("ko"), "character");
        assert_eq!(length_unit_name("en-US"), "character");

        // 多对一默认形态：源再长，紧凑译文也只按自身需求给最低 2 片，
        // 源侧长度不再抬高片数下限。
        let compact = Pending {
            sentence: item.sentence,
            anchor_indices: item.anchor_indices.clone(),
            words: item
                .words
                .iter()
                .map(|word| PendingWord {
                    text: word.text.clone(),
                    pause_before: word.pause_before,
                    t0: word.t0,
                    t1: word.t1,
                    glue: false,
                })
                .collect(),
            translation: "中".repeat(12),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let compact_plan = length_plan(&compact, &TransParams::for_lang("zh"), "en", "zh");
        assert_eq!(compact_plan.piece_count.min, 2);
        assert_eq!(compact_plan.piece_count.max, 2);
        assert_eq!(compact_plan.piece_count.recommended, 2);
    }

    fn pending_doc(word_count: usize) -> TranscriptDoc {
        doc_with_words(
            (0..word_count)
                .map(|index| {
                    w(
                        &format!("g1.{index}"),
                        index as f64 * 0.2,
                        (index + 1) as f64 * 0.2,
                        if index == word_count - 1 {
                            "ending."
                        } else {
                            "word"
                        },
                    )
                })
                .collect(),
        )
    }

    #[test]
    fn length_plan_never_advertises_fewer_than_two_pieces() {
        // 校验对每个入队长句都要求 ≥2 片；旧算法在“视觉超一行但阅读单位
        // ≤ fit”的句子上给出 min=1，载荷与契约硬规则打架。
        let doc = pending_doc(5);
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let words = sentences[0]
            .word_indices
            .iter()
            .map(|&index| PendingWord {
                text: doc.words[index].text.clone(),
                pause_before: 0,
                t0: 0.0,
                t1: 0.0,
                glue: false,
            })
            .collect();
        let item = Pending {
            sentence: &sentences[0],
            anchor_indices: sentences[0].word_indices.clone(),
            words,
            translation: "很短的译句。".to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let plan = length_plan(&item, &TransParams::for_lang("zh"), "en", "zh");
        assert_eq!(plan.piece_count.min, 2);
        assert!(plan.piece_count.max >= 2);
        assert!(
            (plan.piece_count.min..=plan.piece_count.max).contains(&plan.piece_count.recommended)
        );
    }

    /// 引擎拒绝规则（AI 管线设计 §10.3）：合规双段收下；单段与译文漂移拒。
    #[test]
    fn engine_rejection_rules_accept_shape_and_reject_drift() {
        let doc = pending_doc(8);
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let words = sentences[0]
            .word_indices
            .iter()
            .map(|&index| PendingWord {
                text: doc.words[index].text.clone(),
                pause_before: 0,
                t0: 0.0,
                t1: 0.0,
                glue: false,
            })
            .collect();
        let item = Pending {
            sentence: &sentences[0],
            anchor_indices: sentences[0].word_indices.clone(),
            words,
            translation: "中".repeat(12),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let params = TransParams::for_lang("zh");
        let key = sentences[0].id.as_str();

        let engine_accepts = |answer: &str| {
            let (accepted, _salvaged, failures) =
                validate_batch_partial(&[&item], &params, "en", "zh", answer).unwrap();
            failures.is_empty() && accepted.contains_key(key)
        };

        // 合规双段：lint 通过，引擎收下。
        let good = format!(
            r#"{{"sentences":[{{"key":"{key}","sourceBreaks":["b4"],"target":"{} | {}"}}]}}"#,
            "中".repeat(6),
            "中".repeat(6)
        );
        assert!(engine_accepts(&good));

        // 全部片 ≤ hard 的单段：契约硬规则“至少两段”，lint 与引擎都拒。
        let one_piece = format!(
            r#"{{"sentences":[{{"key":"{key}","sourceBreaks":[],"target":"{}"}}]}}"#,
            "中".repeat(12)
        );
        assert!(!engine_accepts(&one_piece));

        // 译文漂移：拒。
        let drifted = format!(
            r#"{{"sentences":[{{"key":"{key}","sourceBreaks":["b4"],"target":"改 | 写"}}]}}"#
        );
        assert!(!engine_accepts(&drifted));
    }

    /// 设计 §9.2 降级：LLM 留下的超 hard 目标片在同次响应内确定性续拆，
    /// 不触发修复调用。
    #[test]
    fn over_hard_pieces_are_deterministically_resplit_on_acceptance() {
        let doc = pending_doc(8);
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let words = sentences[0]
            .word_indices
            .iter()
            .map(|&index| PendingWord {
                text: doc.words[index].text.clone(),
                pause_before: 0,
                t0: 0.0,
                t1: 0.0,
                glue: false,
            })
            .collect();
        let item = Pending {
            sentence: &sentences[0],
            anchor_indices: sentences[0].word_indices.clone(),
            words,
            translation: format!("{}，{}。", "中".repeat(11), "文".repeat(11)),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let params = TransParams::for_lang("zh");
        assert!(target_cps_chars(&item.translation, "zh") > params.hard);
        let key = sentences[0].id.as_str();
        let over_hard = format!(
            r#"{{"sentences":[{{"key":"{key}","sourceBreaks":[],"target":"{}"}}]}}"#,
            item.translation
        );
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&[&item], &params, "en", "zh", &over_hard).unwrap();
        assert!(failures.is_empty(), "{failures:?}");
        let entry = accepted.get(key).expect("over-hard answer is repaired");
        assert!(entry.texts.len() >= 2);
        assert!(
            entry
                .texts
                .iter()
                .all(|text| target_cps_chars(text, "zh") <= params.hard)
        );
    }

    #[test]
    fn dedicated_align_cannot_rewrite_a_frozen_fused_target() {
        let doc = two_sentence_doc();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let sentence = &sentences[0];
        let item = Pending {
            sentence,
            anchor_indices: sentence.word_indices.clone(),
            words: sentence
                .word_indices
                .iter()
                .map(|&index| PendingWord {
                    text: doc.words[index].text.clone(),
                    pause_before: 0,
                    t0: doc.words[index].t0,
                    t1: doc.words[index].t1,
                    glue: false,
                })
                .collect(),
            translation: "第一段译文需要自然对应，第二段译文负责完整收尾。".to_owned(),
            existing: None,
            frozen_target: Some(vec![
                "第一段译文需要自然对应，".to_owned(),
                "第二段译文负责完整收尾。".to_owned(),
            ]),
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let params = TransParams::for_lang("zh");
        let changed = r#"{"sentences":[{"key":"s-g1.0","sourceBreaks":["b5"],"target":"第一段译文需要自然对应，第二段 | 译文负责完整收尾。"}]}"#;
        let (_, _, failures) =
            validate_batch_partial(&[&item], &params, "en", "zh", changed).unwrap();
        assert!(
            failures
                .iter()
                .any(|failure| failure.contains("data-target-frozen")),
            "{failures:?}"
        );

        let unchanged = r#"{"sentences":[{"key":"s-g1.0","sourceBreaks":["b5"],"target":"第一段译文需要自然对应， | 第二段译文负责完整收尾。"}]}"#;
        let (accepted, _, failures) =
            validate_batch_partial(&[&item], &params, "en", "zh", unchanged).unwrap();
        assert!(failures.is_empty(), "{failures:?}");
        assert!(accepted.contains_key("s-g1.0"));
    }

    #[test]
    fn protected_glossary_target_cannot_be_split_by_engine() {
        let doc = pending_doc(8);
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let words = sentences[0]
            .word_indices
            .iter()
            .map(|&index| PendingWord {
                text: doc.words[index].text.clone(),
                pause_before: 0,
                t0: 0.0,
                t1: 0.0,
                glue: false,
            })
            .collect();
        let item = Pending {
            sentence: &sentences[0],
            anchor_indices: sentences[0].word_indices.clone(),
            words,
            translation: "这段自然对应内容需要完整保留。".to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: vec!["自然对应".to_owned()],
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let params = TransParams::for_lang("zh");
        let key = sentences[0].id.as_str();
        let bad = format!(
            r#"{{"sentences":[{{"key":"{key}","sourceBreaks":["b4"],"target":"这段自然 | 对应内容需要完整保留。"}}]}}"#
        );

        let (accepted, _salvaged, failures) =
            validate_batch_partial(&[&item], &params, "en", "zh", &bad).unwrap();
        assert!(!accepted.contains_key(key));
        assert!(
            failures.iter().any(|failure| failure.contains("自然对应")),
            "{failures:?}"
        );
    }

    #[test]
    fn seam_lint_rejects_cut_inside_paired_delimiter() {
        // s-g4.16 回归：片尾停在未闭合的开引号上必须回炉，不能只当 advisory。
        let translation = "包含名为“PluginDataJSON”的清单。";
        let pieces = vec![
            PieceJson {
                from: 0,
                to: 3,
                text: "包含名为“".to_owned(),
            },
            PieceJson {
                from: 4,
                to: 7,
                text: "PluginDataJSON”的清单。".to_owned(),
            },
        ];
        let error = validate_pieces(
            "s-g4.16",
            &pieces,
            8,
            translation,
            "zh",
            &TransParams::for_lang("zh"),
        )
        .unwrap_err();
        let LlmError::Malformed(detail) = error else {
            panic!("expected Malformed, got {error:?}");
        };
        assert!(detail.contains("paired delimiter"), "{detail}");
        assert!(detail.contains("包含名为“"), "{detail}");

        // 引号完整落在一片里的答案必须通过。
        let good = vec![
            PieceJson {
                from: 0,
                to: 1,
                text: "包含".to_owned(),
            },
            PieceJson {
                from: 2,
                to: 7,
                text: "名为“PluginDataJSON”的清单。".to_owned(),
            },
        ];
        validate_pieces(
            "s-g4.16",
            &good,
            8,
            translation,
            "zh",
            &TransParams::for_lang("zh"),
        )
        .expect("intact quoted span must be accepted");
    }

    #[test]
    fn seam_lint_rejects_dangling_connective_with_piece_text() {
        // G3 基线教训：悬垂尾/粘着首是客观语病，advisory 会被弱 worker
        // 稳定落库——必须回炉，problems 带具体片文本。
        let pieces = vec![
            PieceJson {
                from: 0,
                to: 3,
                text: "这一段工具和".to_owned(),
            },
            PieceJson {
                from: 4,
                to: 7,
                text: "方法需要完整收尾。".to_owned(),
            },
        ];
        let error = validate_pieces(
            "s-x",
            &pieces,
            8,
            "这一段工具和方法需要完整收尾。",
            "zh",
            &TransParams::for_lang("zh"),
        )
        .unwrap_err();
        let LlmError::Malformed(detail) = error else {
            panic!("expected Malformed, got {error:?}");
        };
        assert!(detail.contains("dangling"), "{detail}");
        assert!(detail.contains("这一段工具和"), "{detail}");
    }

    #[test]
    fn worker_flash_fragment_is_merged_deterministically_with_ranges() {
        // 2 字碎片「真的」可安全并入邻片：确定性合并（3→2 片），源区间
        // 同步 union；≤2 片时不再合并（保持切分承诺）。
        let pieces = vec![
            ("真的".to_owned(), (0_usize, 1_usize)),
            ("我们的交互经常".to_owned(), (2, 4)),
            ("分散在不同工具之间。".to_owned(), (5, 7)),
        ];
        let repaired = repair_flash_pieces_with_ranges(pieces, "zh", &TransParams::for_lang("zh"));
        assert_eq!(repaired.len(), 2);
        assert_eq!(repaired[0].0, "真的我们的交互经常");
        assert_eq!(repaired[0].1, (0, 4));
        assert_eq!(repaired[1].1, (5, 7));

        let two = vec![
            ("真的".to_owned(), (0_usize, 1_usize)),
            ("我们的交互经常分散在不同工具之间。".to_owned(), (2, 7)),
        ];
        let kept = repair_flash_pieces_with_ranges(two, "zh", &TransParams::for_lang("zh"));
        assert_eq!(kept.len(), 2);
    }

    #[test]
    fn batch_partial_merges_worker_flash_fragment() {
        let source_words: Vec<String> = (0..8).map(|index| format!("word{index}")).collect();
        let sentence = Sentence {
            id: "s-flash".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source_words.join(" "),
            src_fingerprint: "test".to_owned(),
        };
        let item = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words: source_words
                .iter()
                .map(|text| PendingWord {
                    text: text.clone(),
                    pause_before: 0,
                    t0: 0.0,
                    t1: 0.0,
                    glue: false,
                })
                .collect(),
            translation: "而且我们的交互经常分散在不同工具之间。".to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let params = TransParams::for_lang("zh");
        let answer = r#"{"sentences":[{"key":"s-flash","sourceBreaks":["b2","b5"],"target":"而且 | 我们的交互经常 | 分散在不同工具之间。"}]}"#;
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&[&item], &params, "en", "zh", answer).unwrap();
        assert!(failures.is_empty(), "{failures:?}");
        let entry = accepted.get("s-flash").expect("accepted");
        assert_eq!(entry.texts.len(), 2, "{:?}", entry.texts);
        assert_eq!(entry.texts[0], "而且我们的交互经常");
        assert!(
            entry
                .advisories
                .iter()
                .all(|advisory| !advisory.contains("flash")),
            "{:?}",
            entry.advisories
        );
        let AcceptedAnchor::WordRanges(ranges) = &entry.anchor else {
            panic!("expected word ranges");
        };
        assert_eq!(ranges.len(), 2);
        assert_eq!(ranges[0], (0, 4));
    }

    #[test]
    fn seam_lint_rejects_bound_head_and_bigram_tail() {
        // 「类似 | 于…」双向命中：前片 bigram 尾 + 后片粘着首。
        let pieces = vec![
            PieceJson {
                from: 0,
                to: 3,
                text: "并行化，与前文类似".to_owned(),
            },
            PieceJson {
                from: 4,
                to: 7,
                text: "于我们的深度研究工作流；".to_owned(),
            },
        ];
        let error = validate_pieces(
            "s-y",
            &pieces,
            8,
            "并行化，与前文类似于我们的深度研究工作流；",
            "zh",
            &TransParams::for_lang("zh"),
        )
        .unwrap_err();
        assert!(matches!(error, LlmError::Malformed(_)), "{error:?}");
        // 「于是」开头是合法连词，不得误伤。
        let ok = vec![
            PieceJson {
                from: 0,
                to: 3,
                text: "我们先跑通了流程，".to_owned(),
            },
            PieceJson {
                from: 4,
                to: 7,
                text: "于是决定继续推进。".to_owned(),
            },
        ];
        validate_pieces(
            "s-z",
            &ok,
            8,
            "我们先跑通了流程，于是决定继续推进。",
            "zh",
            &TransParams::for_lang("zh"),
        )
        .expect("于是 opening is a legal connective");
    }

    #[test]
    fn balance_lint_does_not_split_parallel_items_at_list_separator() {
        // 7/16:最宽片只有顿号并列项可切；“说服、取胜”是完整并列结构，
        // 不能为了数字配平制造 `说服、|取胜`。
        let translation = "我们常常被教导，要带着说服、取胜的心态去对话，真的。";
        let pieces = vec![
            PieceJson {
                from: 0,
                to: 3,
                text: "我们常常被教导，".to_owned(),
            },
            PieceJson {
                from: 4,
                to: 19,
                text: "要带着说服、取胜的心态去对话，真的。".to_owned(),
            },
        ];
        let result = validate_pieces(
            "s-x",
            &pieces,
            20,
            translation,
            "zh",
            &TransParams::for_lang("zh"),
        );
        assert!(result.is_ok(), "{result:?}");
    }

    #[test]
    fn balance_lint_passes_when_wide_piece_has_no_internal_seam() {
        // 宽片无内部小句缝(语序交叉/整块短语)时不强拆。
        let translation = "你想想看，这相当于每天抽十五支烟对健康的损害总和。";
        let pieces = vec![
            PieceJson {
                from: 0,
                to: 1,
                text: "你想想看，".to_owned(),
            },
            PieceJson {
                from: 2,
                to: 19,
                text: "这相当于每天抽十五支烟对健康的损害总和。".to_owned(),
            },
        ];
        validate_pieces(
            "s-x",
            &pieces,
            20,
            translation,
            "zh",
            &TransParams::for_lang("zh"),
        )
        .unwrap();
    }

    #[test]
    fn claude_code_intro_keeps_bound_phrase_and_uses_word_ranges() {
        let translation =
            "我是 Claude Code 的创始工程师之一，今天很高兴和大家聊聊如何不再时刻盯着你的智能体。";
        let pieces = vec![
            PieceJson {
                from: 0,
                to: 8,
                text: "我是 Claude Code 的创始工程师之一，".to_owned(),
            },
            PieceJson {
                from: 9,
                to: 20,
                text: "今天很高兴和大家聊聊".to_owned(),
            },
            PieceJson {
                from: 21,
                to: 28,
                text: "如何不再时刻盯着你的智能体。".to_owned(),
            },
        ];
        validate_pieces(
            "s-g1.7",
            &pieces,
            29,
            translation,
            "zh",
            &TransParams::for_lang("zh"),
        )
        .unwrap();
        assert_eq!(target_cps_chars(&pieces[0].text, "zh"), 15);
        assert!(!pieces.iter().any(|piece| piece.text == "智能体。"));
    }

    #[test]
    fn transport_errors_propagate_instead_of_falling_back() {
        let mut doc = with_translations(two_sentence_doc());
        let mut llm = FakeLlm::new([Err(LlmError::Terminal("401".to_owned()))]);
        let result = run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {});
        assert!(matches!(result, Err(LlmError::Terminal(_))));
        assert!(doc.trans_align.is_empty());
    }

    #[test]
    fn sentence_filter_and_force_are_respected() {
        let mut doc = with_translations(two_sentence_doc());
        let mut llm = FakeLlm::ok(std::iter::empty::<&'static str>());
        let mut options = opts(AlignMode::ManyToOne);
        options.sentences = Some(BTreeSet::from(["s-g2.0".to_owned()]));
        let outcome = run_align(&mut doc, &mut llm, &options, &mut |_| {}).unwrap();
        assert!(llm.calls.is_empty());
        assert_eq!(outcome.aligned_sentences, 0);
        assert_eq!(outcome.skipped_sentences, 1); // 单 Cue 句

        // force：已有有效条目也重切；independent 不依赖源 Cue 或 LLM。
        let mut llm = FakeLlm::ok(std::iter::empty::<&'static str>());
        let mut options = opts(AlignMode::Independent);
        run_align(&mut doc, &mut llm, &options, &mut |_| {}).unwrap();
        options.force = true;
        let outcome = run_align(&mut doc, &mut llm, &options, &mut |_| {}).unwrap();
        assert_eq!(outcome.aligned_sentences, 1);
    }

    #[test]
    fn projected_alignment_persists_and_refreshes_visible_word_anchors() {
        let mut doc = two_sentence_doc();
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert("s-g1.0".to_owned(), "首尾。".to_owned());
        let mut visible = BTreeMap::from([(
            "s-g1.0".to_owned(),
            vec!["g1.0".to_owned(), "g1.7".to_owned()],
        )]);
        let mut options = opts(AlignMode::ManyToOne);
        options.sentences = Some(BTreeSet::from(["s-g1.0".to_owned()]));
        let mut llm = FakeLlm::ok(std::iter::empty::<&'static str>());

        let outcome =
            run_align_projected(&mut doc, &mut llm, &options, &visible, &mut |_| {}).unwrap();
        assert_eq!(outcome.aligned_sentences, 1);
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(entry.words, ["g1.0", "g1.7"]);
        assert_eq!(entry.pieces[0].from, Some(0));
        assert_eq!(entry.pieces[0].to, Some(1));

        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        assert_eq!(stream[0].word_span, Some((0, 7)));

        visible.insert(
            "s-g1.0".to_owned(),
            vec!["g1.0".to_owned(), "g1.6".to_owned(), "g1.7".to_owned()],
        );
        let outcome =
            run_align_projected(&mut doc, &mut llm, &options, &visible, &mut |_| {}).unwrap();
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(
            doc.trans_align["zh"]["s-g1.0"].words,
            ["g1.0", "g1.6", "g1.7"]
        );
        assert!(llm.calls.is_empty());
    }

    /// translate → align 全链路：句级真相落盘、切法覆盖、投影可展开、
    /// 编辑后只有该句变脏。
    #[test]
    fn translate_then_align_round_trip() {
        let mut doc = two_sentence_doc();
        let mut llm = FakeLlm::ok([
            "<article><section id=\"p-g1.0\"><p id=\"s-g1.0\">第一段译文需要自然对应，第二段译文负责完整收尾。</p><p id=\"s-g2.0\">完成。</p></section></article>",
            GOOD_ALIGN_RESPONSE,
        ]);
        let translate_options = TranslateOptions {
            source_lang: "en".to_owned(),
            lang: "zh".to_owned(),
            force: false,
            sentences: None,
            page_budget: crate::paging::budgets::TRANSLATE_PROVIDER_WORDS,
            instructions: None,
            analysis: None,
            brief: None,
            tone: None,
            autocorrect: true,
            align: None,
            align_rows: false,
            align_lines: false,
            worker_slots: None,
            provenance_stale: BTreeSet::new(),
        };
        run_translate(
            &mut doc,
            &mut llm,
            &translate_options,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(outcome.skipped_sentences, 1);

        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        assert_eq!(stream.len(), 3); // 句1 两片 + 句2 整句
        assert!(stream.iter().all(|cue| !cue.fallback));
        assert!(crate::sentence::stale_sentences(&doc, "zh", &sentences).is_empty());

        // 编辑句1 一个词 ⇒ 只句1 stale；transAlign 条目因结构快照仍同、
        // 拼接不变量仍立而继续有效（译文过期由 transSrc 把关）。
        doc.words[2].text = "charlee".to_owned();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let stale = crate::sentence::stale_sentences(&doc, "zh", &sentences);
        assert_eq!(stale.into_iter().collect::<Vec<_>>(), vec!["s-g1.0"]);
    }

    #[test]
    fn paired_density_requires_target_natural_split_and_matches_agent_lint() {
        let source = "And we'd turn the loop off, and because we had to constantly update the skill, we had to constantly check out the branch, change the skill, change the code, commit, and push.";
        let source_words = source.split_whitespace().collect::<Vec<_>>();
        let sentence = Sentence {
            id: "s-loop".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source.to_owned(),
            src_fingerprint: "test".to_owned(),
        };
        let words = source_words
            .iter()
            .enumerate()
            .map(|(index, text)| PendingWord {
                text: (*text).to_owned(),
                pause_before: 0,
                t0: index as f64 * 0.3,
                t1: (index + 1) as f64 * 0.3,
                glue: false,
            })
            .collect();
        let translation =
            "我们会关闭循环，因为得不断更新技能、检出分支、改技能、改代码、提交再推送。";
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words,
            translation: translation.to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let params = TransParams::for_lang("zh");
        let bad = r#"{"sentences":[{"key":"s-loop","sourceBreaks":["b6","b23"],"target":"我们会关闭循环， | 因为得不断更新技能、检出分支、 | 改技能、改代码、提交再推送。"}]}"#;
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&[&pending], &params, "en", "zh", bad).unwrap();
        assert!(accepted.is_empty());
        assert!(
            failures
                .iter()
                .any(|failure| failure.contains("over-dense")),
            "{failures:?}"
        );

        let good = r#"{"sentences":[{"key":"s-loop","sourceBreaks":["b6","b15","b23"],"target":"我们会关闭循环， | 因为得不断更新技能、 | 检出分支、 | 改技能、改代码、提交再推送。"}]}"#;
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&[&pending], &params, "en", "zh", good).unwrap();
        assert!(failures.is_empty(), "{failures:?}");
        assert!(accepted.contains_key("s-loop"));

        assert_eq!(
            paired_balance_seam("GitLab、CircleCI 或其他工具", "zh"),
            None,
            "普通产品名列表不能被并列动作规则误切"
        );
        assert_eq!(
            paired_balance_seam("控制器、执行器", "zh"),
            None,
            "设备名列表不能因名称含动词字样而被误切"
        );
        assert_eq!(
            paired_balance_seam("实际操作中，因为我们用的是智能体，", "zh"),
            None,
            "前置状语不能被当成完整小句"
        );
        assert!(
            paired_balance_seam("你有一个控制器，它读取测得的误差，", "zh").is_some(),
            "带谓词的完整小句仍应保留配对密度切点"
        );
    }

    /// 构造单片场景：`words` 个源词各占 `per_word_units` 单位，整行固定
    /// 跨 `span` 秒，便于把宽度档与时长档分开钉。
    fn ceiling_case(
        target: &str,
        words: usize,
        per_word_units: usize,
        span: f64,
    ) -> Vec<SourceCeilingIssue> {
        let source_units = vec![per_word_units; words];
        let step = span / words as f64;
        let ends: Vec<f64> = (1..=words).map(|index| index as f64 * step).collect();
        source_ceiling_issues(
            &[target.to_owned()],
            &[(0, words - 1)],
            &source_units,
            &ends,
            42,
            "zh",
        )
    }

    #[test]
    fn source_ceiling_fires_only_past_one_and_a_half_lines() {
        let target = "这条译文足够长可以再切一刀";
        // 无缝超宽源行（95 单位）必须报出。
        let issues = ceiling_case(target, 95, 1, 5.0);
        assert_eq!(issues.len(), 1, "{issues:?}");
        assert_eq!(issues[0].index, 0);
        assert_eq!(issues[0].units, 95);
        // 边界贴身：source_piece_hard(42) = 63，64 报、63 不报。系数被钉死。
        assert_eq!(ceiling_case(target, 64, 1, 5.0).len(), 1, "64 单位应过硬档");
        assert!(
            ceiling_case(target, 63, 1, 5.0).is_empty(),
            "63 单位恰好不过硬档"
        );
        // 时长档独立于宽度：40 单位（合规）跨 8s 仍报，跨 5s 不报。
        assert!(
            ceiling_case(target, 40, 1, 5.0).is_empty(),
            "40 单位 5.0s 不应报"
        );
        let slow = ceiling_case(target, 40, 1, 8.0);
        assert_eq!(slow.len(), 1, "40 单位 8.0s 应过时长硬档");
        // 目标片太短（9 单位）：再切只会产出碎行，不报。
        assert!(
            ceiling_case("这条译文偏短了一点", 95, 1, 5.0).is_empty(),
            "目标片 < 10 单位不应触发硬档"
        );
        // 源词数不足 4：没有可用切点，不报。
        assert!(
            ceiling_case(target, 3, 30, 5.0).is_empty(),
            "源词 < 4 不应触发硬档"
        );
    }

    #[test]
    fn source_ceiling_blocks_the_draft_but_never_rejects_the_answer() {
        let source = "Every engineer on the platform team keeps their own separate working context around all week and nobody ever ends up stepping on anyone else's ongoing work at all";
        let source_words = source.split_whitespace().collect::<Vec<_>>();
        let sentence = Sentence {
            id: "s-wide".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source.to_owned(),
            src_fingerprint: "test".to_owned(),
        };
        let words: Vec<PendingWord> = source_words
            .iter()
            .enumerate()
            .map(|(index, text)| PendingWord {
                text: (*text).to_owned(),
                pause_before: 0,
                t0: index as f64 * 0.5,
                t1: (index + 1) as f64 * 0.5,
                glue: false,
            })
            .collect();
        // 译文两片都无内部小句缝：软档（paired_density_issue）必然不命中，
        // 命中的只可能是新增硬档。
        let translation = "每个工程师整周都保留自己的独立上下文，谁也不会碰到别人正在做的工作。";
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words,
            translation: translation.to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let params = TransParams::for_lang("zh");
        // b15：源词 "week" 之后、连词 "and" 之前的自然缝。左片 15 词 ×0.5s
        // = 7.5s，越过 6.0s 硬档（宽度同样越线）。
        let cut = 15usize;
        let pieces = vec![
            (
                "每个工程师整周都保留自己的独立上下文，".to_owned(),
                (0usize, cut - 1),
            ),
            (
                "谁也不会碰到别人正在做的工作。".to_owned(),
                (cut, source_words.len() - 1),
            ),
        ];
        let draft = draft_from_pieces(&pending, pieces, &params, "en", "zh", &source_words);
        assert!(
            draft
                .blockers
                .iter()
                .any(|blocker| blocker.contains("past the paired-row ceiling")),
            "草稿门必须报出源行硬上限：{:?}",
            draft.blockers
        );
        assert!(!draft.ready);

        // 同一份切分作为模型答案提交时，引擎验收与提交期 lint 必须一致放行：
        // 契约允许"无合法切点则保持整行"，在这两处拒绝只会换来确定性回退。
        let answer = format!(
            r#"{{"sentences":[{{"key":"s-wide","sourceBreaks":["b{cut}"],"target":"每个工程师整周都保留自己的独立上下文， | 谁也不会碰到别人正在做的工作。"}}]}}"#
        );
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&[&pending], &params, "en", "zh", &answer).unwrap();
        assert!(failures.is_empty(), "引擎验收不得因硬档拒绝：{failures:?}");
        assert!(accepted.contains_key("s-wide"));
        // 事后 check 走的公开包装：同一条目仍应报出，交给 refine-align 定向修。
        let units = source_word_units(&pending.words, "en");
        let ends = source_word_ends_sec(&pending.words);
        let issues = source_ceiling_issues_for_ranges(
            &[
                "每个工程师整周都保留自己的独立上下文，".to_owned(),
                "谁也不会碰到别人正在做的工作。".to_owned(),
            ],
            &[(0, cut - 1), (cut, source_words.len() - 1)],
            &units,
            &ends,
            "en",
            "zh",
        );
        assert!(!issues.is_empty(), "check 侧公开包装必须报出同一条目");
    }

    /// 碎片钉子测试：源行**过窄**与源行过宽同进同退——草稿门报、check 公开
    /// 包装报、引擎验收与提交期 lint 一律放行。素材取自 Jeff Dean 实测形态
    /// （译文片挂在 "batch jobs" 一类两词碎渣上）。
    #[test]
    fn source_fragment_blocks_the_draft_but_never_rejects_the_answer() {
        let source = "I mean, we ended up building a completely separate scheduler";
        let source_words = source.split_whitespace().collect::<Vec<_>>();
        let sentence = Sentence {
            id: "s-crumb".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source.to_owned(),
            src_fingerprint: "test".to_owned(),
        };
        let words: Vec<PendingWord> = source_words
            .iter()
            .enumerate()
            .map(|(index, text)| PendingWord {
                text: (*text).to_owned(),
                pause_before: 0,
                t0: index as f64 * 0.5,
                t1: (index + 1) as f64 * 0.5,
                glue: false,
            })
            .collect();
        let translation = "我的意思是，我们最终单独搭了一套调度器。";
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words,
            translation: translation.to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let params = TransParams::for_lang("zh");
        // 首片只挂 "I mean," 两个源词（5 显示单位，低于 en 下限 10），
        // 且译文片自身只有 5 单位——正落在 source_ceiling_issues 的双豁免
        // 盲区里（<4 源词、<10 目标单位），硬上限通道永远看不见它。
        let cut = 2usize;
        let texts = [
            "我的意思是，".to_owned(),
            "我们最终单独搭了一套调度器。".to_owned(),
        ];
        let ranges = [(0usize, cut - 1), (cut, source_words.len() - 1)];
        let pieces = vec![(texts[0].clone(), ranges[0]), (texts[1].clone(), ranges[1])];
        let draft = draft_from_pieces(&pending, pieces, &params, "en", "zh", &source_words);
        assert!(
            draft
                .blockers
                .iter()
                .any(|blocker| blocker.contains("under the paired-row floor")),
            "草稿门必须报出源行下限：{:?}",
            draft.blockers
        );
        assert!(!draft.ready);

        // 同一份切分作为模型答案提交时，引擎验收与提交期 lint 必须一致放行：
        // 碎片与硬上限同属"报出并驱动定向重对齐"，在这两处拒绝只会烧掉唯一
        // 一次全局修复调用、换来语义盲的确定性回退。
        let answer = format!(
            r#"{{"sentences":[{{"key":"s-crumb","sourceBreaks":["b{cut}"],"target":"我的意思是， | 我们最终单独搭了一套调度器。"}}]}}"#
        );
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&[&pending], &params, "en", "zh", &answer).unwrap();
        assert!(failures.is_empty(), "引擎验收不得因碎片拒绝：{failures:?}");
        assert!(accepted.contains_key("s-crumb"));
        // 事后 check 走的公开包装：同一条目仍应报出，交给 refine-align 定向修。
        let units = source_word_units(&pending.words, "en");
        let issues = source_fragment_issues_for_ranges(&texts, &ranges, &units, "en", "zh");
        assert_eq!(issues.len(), 1, "check 侧公开包装必须报出同一条目");
        assert_eq!(issues[0].index, 0);
        assert_eq!(issues[0].words, 2);
    }

    /// 豁免只收窄、不删除：单片句、整句词数不够、源片本身够宽、以及退化
    /// 通道（宽译文配窄源）辖区内的片都不得报出。
    #[test]
    fn source_fragment_exemptions_stay_narrow_but_present() {
        let units_of = |words: &[&str]| -> Vec<usize> {
            words
                .iter()
                .map(|text| target_cps_chars(text, "en"))
                .collect()
        };
        let (source_fit, _) = source_piece_budgets("en");
        assert_eq!(source_fragment_floor(source_fit), 10);

        // 1. 单片句：那一片就是整句，谈不上碎片。
        let words = ["We", "ended", "up", "here"];
        assert!(
            source_fragment_issues(
                &["我们到此为止。".to_owned()],
                &[(0, 3)],
                &units_of(&words),
                source_fit,
                "zh",
            )
            .is_empty()
        );

        // 2. 整句源词数不足 片数×3：再报也只能落到确定性兜底。
        let short = ["So", "we", "left", "it"];
        assert!(
            source_fragment_issues(
                &["所以，".to_owned(), "我们就放着了。".to_owned()],
                &[(0, 1), (2, 3)],
                &units_of(&short),
                source_fit,
                "zh",
            )
            .is_empty(),
            "整句只有 4 词、2 片时不得报"
        );

        // 3. 源片够宽：两词但 15 单位的 "high performance." 是正常多对一。
        let wide = [
            "It",
            "was",
            "built",
            "from",
            "scratch",
            "for",
            "very",
            "high",
            "performance.",
        ];
        assert!(
            source_fragment_issues(
                &["它是为了".to_owned(), "极高性能".to_owned()],
                &[(0, 6), (7, 8)],
                &units_of(&wide),
                source_fit,
                "zh",
            )
            .is_empty(),
            "两词但显示宽度达标的源片不是碎片"
        );

        // 4. 目标片 ≥ DEGENERATE_TARGET_MIN_UNITS：那是 degenerate_paired_row
        //    的辖区（含它经过审计的 40% 宽度豁免），两条通道不得重叠发声。
        let crumb = [
            "And", "again", "thanks", "so", "much", "for", "coming", "in", "today",
        ];
        let texts = [
            "再次非常感谢你今天过来。".to_owned(),
            "非常感谢。".to_owned(),
        ];
        assert!(
            source_fragment_issues(
                &texts,
                &[(0, 1), (2, 8)],
                &units_of(&crumb),
                source_fit,
                "zh"
            )
            .is_empty(),
            "宽译文片配窄源属退化通道，碎片通道不得抢辖区"
        );
        // 同素材换成窄译文片，碎片通道就必须认领。
        let owned = ["再来一次，".to_owned(), "非常感谢你今天过来。".to_owned()];
        let issues = source_fragment_issues(
            &owned,
            &[(0, 1), (2, 8)],
            &units_of(&crumb),
            source_fit,
            "zh",
        );
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].index, 0);
    }

    /// 契约文本必须与检测阈值同源：`align_system_prompt_file` 里的源侧下限
    /// 由 `source_fragment_floor` 直接渲染，不得写死。
    #[test]
    fn align_prompt_states_source_role_and_floor() {
        let params = TransParams::for_lang("zh");
        let prompt = align_system_prompt_file(&params, "en", None, &[]);
        assert!(
            prompt.contains(
                "Never translate, paraphrase, summarize, or copy any `td.tgt` text into `td.src`"
            ),
            "{prompt}"
        );
        assert!(
            prompt.contains("The source side also has a FLOOR"),
            "{prompt}"
        );
        assert!(
            prompt.contains(
                "2 or fewer source words whose combined width is under 10 source characters"
            ),
            "{prompt}"
        );
        // zh 源用 16 的四分之一，阈值随语言预算走。
        let zh = align_system_prompt_file(&params, "zh", None, &[]);
        assert!(zh.contains("under 4 source characters"), "{zh}");
    }

    /// 与 `source_ceiling_blocks_the_draft_but_never_rejects_the_answer` 同一
    /// 素材：源行硬上限本身不拒，但把最坏越档行做得更差要拒。构造出的
    /// `Pending` 的确定性草稿就是 b15（最坏源行 78 单位 /7.5s），与该钉子测试
    /// 的载荷一致。
    fn ceiling_regression_pending() -> (Sentence, Vec<PendingWord>, &'static str) {
        let source = "Every engineer on the platform team keeps their own separate working context around all week and nobody ever ends up stepping on anyone else's ongoing work at all";
        let source_words = source.split_whitespace().collect::<Vec<_>>();
        let sentence = Sentence {
            id: "s-wide".to_owned(),
            cue_ids: Vec::new(),
            cue_indices: Vec::new(),
            word_indices: (0..source_words.len()).collect(),
            source_text: source.to_owned(),
            src_fingerprint: "test".to_owned(),
        };
        let words: Vec<PendingWord> = source_words
            .iter()
            .enumerate()
            .map(|(index, text)| PendingWord {
                text: (*text).to_owned(),
                pause_before: 0,
                t0: index as f64 * 0.5,
                t1: (index + 1) as f64 * 0.5,
                glue: false,
            })
            .collect();
        (
            sentence,
            words,
            "每个工程师整周都保留自己的独立上下文，谁也不会碰到别人正在做的工作。",
        )
    }

    /// 现场 s-g123.0 的形态：worker 在句首加一刀凑片数，把最坏配对源行从草稿的
    /// 78 单位 /7.5s 恶化到 122 单位 /13.0s。引擎验收必须拒绝。
    #[test]
    fn source_ceiling_net_regression_is_rejected_by_the_engine() {
        let (sentence, words, translation) = ceiling_regression_pending();
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words,
            translation: translation.to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let params = TransParams::for_lang("zh");
        // b2 是载荷里标注 seam1 的合法切点：拒绝理由只可能是净倒退，
        // 不会被 risky 切点或密度软档抢先。
        let answer = r#"{"sentences":[{"key":"s-wide","sourceBreaks":["b2"],"target":"每个工程师整周都保留自己的独立上下文， | 谁也不会碰到别人正在做的工作。"}]}"#;
        let (accepted, salvaged, failures) =
            validate_batch_partial(&[&pending], &params, "en", "zh", answer).unwrap();
        assert!(accepted.is_empty(), "净倒退答案不得被接受：{accepted:?}");
        assert!(
            failures
                .iter()
                .any(|failure| failure.contains("worse than the incoming draft's worst row")),
            "{failures:?}"
        );
        // Salvage 档豁免：兜底通道仍能顶替 `fallback_word_entry`，
        // 护栏不得扩大确定性回退的暴露面。
        assert!(
            salvaged.contains_key("s-wide"),
            "Salvage 档必须仍然收下该答案：{salvaged:?}"
        );
    }

    /// 护栏只治倒退，不治空转：与草稿等宽（此处 `sourceBreaks` 与草稿完全相同）
    /// 的答案必须放行。
    #[test]
    fn source_ceiling_guardrail_passes_equal_width_answers() {
        let (sentence, words, translation) = ceiling_regression_pending();
        let pending = Pending {
            sentence: &sentence,
            anchor_indices: sentence.word_indices.clone(),
            words,
            translation: translation.to_owned(),
            existing: None,
            frozen_target: None,
            protected_terms: Vec::new(),
            bilingual_anchors: Vec::new(),
            source_cue_keys: Vec::new(),
        };
        let params = TransParams::for_lang("zh");
        let same = r#"{"sentences":[{"key":"s-wide","sourceBreaks":["b15"],"target":"每个工程师整周都保留自己的独立上下文， | 谁也不会碰到别人正在做的工作。"}]}"#;
        let (accepted, _salvaged, failures) =
            validate_batch_partial(&[&pending], &params, "en", "zh", same).unwrap();
        assert!(failures.is_empty(), "等宽答案不得被护栏拒绝：{failures:?}");
        assert!(accepted.contains_key("s-wide"));
    }

    /// 判据本身的边界：只在 incumbent 已越档的维度上生效，且严格大于才拒。
    #[test]
    fn source_ceiling_regression_only_fires_on_dimensions_the_draft_already_broke() {
        let issue = |units: usize, seconds: f64| SourceCeilingIssue {
            index: 0,
            units,
            seconds,
            target_units: 20,
            words: 10,
        };
        // 草稿宽度已越档（70 > 63），答案更宽 ⇒ 拒。
        assert!(source_ceiling_regression(&[issue(110, 8.6)], 70, 5.6, 42, 3).is_some());
        // 等宽 ⇒ 放行。
        assert!(source_ceiling_regression(&[issue(70, 5.6)], 70, 5.6, 42, 3).is_none());
        // 草稿宽度干净（60 < 63）：这轮不是为宽度维度派出的，答案再宽也不拒。
        assert!(source_ceiling_regression(&[issue(120, 5.0)], 60, 5.0, 42, 3).is_none());
        // 时长维度独立：草稿 7.0s 已越 6.0s，答案 9.0s ⇒ 拒。
        assert!(source_ceiling_regression(&[issue(50, 9.0)], 50, 7.0, 42, 3).is_some());
        // 答案不越档时 `source_ceiling_issues` 为空 ⇒ 结构性不触发。
        assert!(source_ceiling_regression(&[], 70, 5.6, 42, 3).is_none());
    }

    // -----------------------------------------------------------------
    // file-v1（HTML 表格载体）端到端
    // -----------------------------------------------------------------

    /// 一个 `<tbody data-sid>` 分组；`attrs` 直接拼在开标签上。
    fn tgroup(sid: &str, attrs: &str, rows: &[(&str, &str)]) -> String {
        let mut out = format!("  <tbody data-sid=\"{sid}\"{attrs}>\n");
        for (source, target) in rows {
            out.push_str(&format!(
                "    <tr><td class=\"src\">{source}</td><td class=\"tgt\">{target}</td></tr>\n"
            ));
        }
        out.push_str("  </tbody>\n");
        out
    }

    fn ttable(groups: &[String]) -> String {
        format!("<table>\n{}</table>\n", groups.concat())
    }

    /// s-g1.0 的「好答案」：两行，源侧恰落在 echo,^foxtrot 缝上。
    fn good_align_table() -> String {
        ttable(&[tgroup(
            "s-g1.0",
            "",
            &[
                (
                    "alpha bravo charlie delta echo,",
                    "第一段译文需要自然对应，",
                ),
                ("foxtrot golf hotel.", "第二段译文负责完整收尾。"),
            ],
        )])
    }

    fn file_llm<I: IntoIterator<Item = String>>(script: I) -> FakeLlm {
        FakeLlm::new(script.into_iter().map(Ok))
    }

    /// 收集 `on_attempt` 工件的 (page_id, attempt, accepted, 问题码数)。
    #[derive(Debug, Default)]
    struct Artifacts {
        pages: Vec<(String, u32, bool, usize)>,
        inputs: Vec<String>,
        outputs: Vec<String>,
    }

    #[test]
    fn file_contract_maps_table_rows_to_source_word_ranges() {
        let mut doc = with_translations(two_sentence_doc());
        let mut llm = file_llm([good_align_table()]);
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();

        assert_eq!(llm.calls.len(), 1);
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(outcome.fallback_sentences, 0);

        // 载体是 HTML 表，不是 JSON 载荷。
        let (kind, system, user, _) = &llm.calls[0];
        assert_eq!(kind, "align");
        assert!(user.starts_with("<table data-lang=\"zh\""), "{user}");
        assert!(user.contains("data-bcut-format=\"align-table/1\""));
        assert!(user.contains("data-sid=\"s-g1.0\""));
        assert!(user.contains(
            "<td class=\"src\">alpha bravo charlie delta echo, foxtrot golf hotel.</td>"
        ));
        // 秒数、源 Cue 边界与绝对时间戳都不进载体（§8.2）；句 id 之外没有
        // 任何 word id（源列就是纯可见文本）。
        assert!(!user.contains("q-g1."), "{user}");
        assert!(!user.contains("sourceWords"), "{user}");
        assert!(!user.contains("seconds"), "{user}");
        assert!(!user.contains("\"sentences\""));
        assert!(!user.contains("sourceBreaks"));
        assert!(system.contains("return the SAME table"));
        assert!(!system.contains("sourceBreaks"));

        // 语义层与 json-v0 等价：同样的两片、同样的词区间。
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(entry.mode, AlignMode::ManyToOne);
        assert_eq!(entry.pieces.len(), 2);
        assert_eq!(entry.pieces[0].text, "第一段译文需要自然对应，");
        assert_eq!(entry.pieces[0].from, Some(0));
        assert_eq!(entry.pieces[0].to, Some(4));
        assert_eq!(entry.pieces[1].text, "第二段译文负责完整收尾。");
        assert_eq!(entry.pieces[1].from, Some(5));
        assert_eq!(entry.pieces[1].to, Some(7));
        assert_eq!(entry.words.first().map(String::as_str), Some("g1.0"));
        assert_eq!(entry.words.last().map(String::as_str), Some("g1.7"));

        // 最终不变式（§2）：拼接 == 句级译文真相，区间连续覆盖。
        let cues = derive_cues(&doc, &CueParams::default());
        let sentence = derive_sentences(&doc, &cues)
            .into_iter()
            .find(|item| item.id == "s-g1.0")
            .expect("sentence");
        assert!(align_entry_valid(
            &doc,
            &sentence,
            &doc.trans["zh"]["s-g1.0"],
            entry
        ));
    }

    #[test]
    fn file_contract_emits_one_artifact_per_batch_attempt() {
        let mut doc = with_translations(two_sentence_doc());
        let mut llm = file_llm([good_align_table()]);
        let mut artifacts = Artifacts::default();
        run_align_with_artifacts(
            &mut doc,
            &mut llm,
            &opts(AlignMode::ManyToOne),
            &mut |attempt| {
                artifacts.pages.push((
                    attempt.page_id.to_owned(),
                    attempt.attempt,
                    attempt.accepted,
                    attempt.problems.len(),
                ));
                artifacts.inputs.push(attempt.input.to_owned());
                artifacts.outputs.push(attempt.output.to_owned());
            },
            &mut |_| {},
        )
        .unwrap();

        assert_eq!(artifacts.pages, vec![("b001".to_owned(), 1, true, 0)]);
        // 工件里的 input 就是实际发出去的那一份载荷文本。
        assert_eq!(artifacts.inputs[0], llm.calls[0].2);
        assert_eq!(artifacts.outputs[0], good_align_table());
    }

    #[test]
    fn file_contract_repairs_source_drift_and_emits_a_repair_artifact() {
        let mut doc = with_translations(two_sentence_doc());
        // 源文列是只读的：改词 ⇒ source-drift ⇒ 整句不进验收，走修复轮。
        let drifted = ttable(&[tgroup(
            "s-g1.0",
            "",
            &[
                (
                    "alpha bravo charlie whiskey echo,",
                    "第一段译文需要自然对应，",
                ),
                ("foxtrot golf hotel.", "第二段译文负责完整收尾。"),
            ],
        )]);
        let mut llm = file_llm([drifted, good_align_table()]);
        let mut pages: Vec<(String, u32, bool)> = Vec::new();
        let outcome = run_align_with_artifacts(
            &mut doc,
            &mut llm,
            &opts(AlignMode::ManyToOne),
            &mut |attempt| {
                pages.push((
                    attempt.page_id.to_owned(),
                    attempt.attempt,
                    attempt.accepted,
                ));
            },
            &mut |_| {},
        )
        .unwrap();

        assert_eq!(llm.calls.len(), 2);
        assert_eq!(
            pages,
            vec![("b001".to_owned(), 1, false), ("r001".to_owned(), 2, true)]
        );
        // 修复轮的 retry_reason 用表格词汇复述问题，不提 JSON 字段。
        let reason = llm.calls[1].3.as_deref().expect("retry reason");
        assert!(reason.contains("source-drift"), "{reason}");
        assert!(reason.contains("rows min="), "{reason}");
        assert!(!reason.contains("sourceBreaks"), "{reason}");
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(outcome.fallback_sentences, 0);
        assert_eq!(doc.trans_align["zh"]["s-g1.0"].pieces.len(), 2);
    }

    #[test]
    fn file_contract_missing_group_is_rejected_before_acceptance() {
        let mut doc = with_translations(two_sentence_doc());
        let mut llm = file_llm(["<table>\n</table>\n".to_owned(), good_align_table()]);
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        assert_eq!(llm.calls.len(), 2);
        assert_eq!(outcome.aligned_sentences, 1);
    }

    #[test]
    fn file_contract_over_hard_row_is_recut_instead_of_rejected() {
        // 关键契约：over-hard 与坏接缝是**质量码**，不是拒收码。json-v0 里
        // 它们走确定性重切 / Recut-KeepWhole-Salvage 三档；file-v1 必须同口径，
        // 否则新载体比旧载体更严，还会白烧掉唯一一轮全局修复。
        let mut doc = with_translations(two_sentence_doc());
        let whole = ttable(&[tgroup(
            "s-g1.0",
            "",
            &[(
                "alpha bravo charlie delta echo, foxtrot golf hotel.",
                "第一段译文需要自然对应，第二段译文负责完整收尾。",
            )],
        )]);
        let mut llm = file_llm([whole]);
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();

        // 只有首轮那一个调用：没有触发修复轮。
        assert_eq!(llm.calls.len(), 1);
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(outcome.fallback_sentences, 0);
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert!(entry.pieces.len() >= 2, "{:?}", entry.pieces);
        let params = TransParams::for_lang("zh");
        for piece in &entry.pieces {
            assert!(
                target_cps_chars(&piece.text, "zh") <= params.hard,
                "{:?}",
                piece.text
            );
        }
    }

    #[test]
    fn file_contract_illegal_seam_is_judged_by_the_shared_acceptance_core() {
        // `problem_blocks_acceptance` 的另一半：坏接缝在载体层是**质量码**，
        // 不在 parse 层拒收；判决权归 `accept_answers` 这一份共享验收核，
        // 悬垂连词「和」的打回理由由它给出，载体层不复判。
        fn dangling_doc() -> TranscriptDoc {
            let mut doc = two_sentence_doc();
            doc.trans.entry("zh".to_owned()).or_default().insert(
                "s-g1.0".to_owned(),
                "我们砍掉了付费营销和自建的渠道团队。".to_owned(),
            );
            doc
        }
        const SEAM_VERDICT: &str = "ends on a dangling connective";

        let table = ttable(&[tgroup(
            "s-g1.0",
            "",
            &[
                ("alpha bravo charlie delta echo,", "我们砍掉了付费营销和"),
                ("foxtrot golf hotel.", "自建的渠道团队。"),
            ],
        )]);
        let mut file_llm_calls = file_llm([table.clone(), table]);
        run_align(
            &mut dangling_doc(),
            &mut file_llm_calls,
            &opts(AlignMode::ManyToOne),
            &mut |_| {},
        )
        .unwrap();

        // 修复轮理由来自共享验收核。
        assert_eq!(file_llm_calls.calls.len(), 2);
        let file_reason = file_llm_calls.calls[1].3.as_deref().expect("file reason");
        assert!(file_reason.contains(SEAM_VERDICT), "{file_reason}");
        // 载体层没有额外再报一次 align-illegal-seam。
        assert_eq!(
            file_reason.matches(SEAM_VERDICT).count(),
            1,
            "{file_reason}"
        );
        assert!(!file_reason.contains("align-illegal-seam"), "{file_reason}");
    }

    #[test]
    fn file_contract_rejects_reordered_rewrite_beyond_the_drift_guard() {
        let mut doc = with_translations(two_sentence_doc());
        // data-reordered 允许改写译文，但改写幅度受 ±max(25%, 4) 单位护栏
        // （与 `split::reordered_rewrite_exceeds` 同一份算术）约束。
        let bloated = ttable(&[tgroup(
            "s-g1.0",
            " data-reordered=\"true\"",
            &[
                (
                    "alpha bravo charlie delta echo,",
                    "第一段译文需要自然对应，",
                ),
                (
                    "foxtrot golf hotel.",
                    "第二段译文负责完整收尾，并且额外补上了一大段原文里根本不存在的解释性内容。",
                ),
            ],
        )]);
        let mut llm = file_llm([bloated, good_align_table()]);
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        assert_eq!(llm.calls.len(), 2);
        let reason = llm.calls[1].3.as_deref().expect("retry reason");
        assert!(reason.contains("align-content-drift"), "{reason}");
        assert_eq!(outcome.aligned_sentences, 1);
        // 落库的是修复轮那份未改写的译文。
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(entry.pieces[1].text, "第二段译文负责完整收尾。");
    }

    #[test]
    fn file_contract_accepts_a_declared_crossing_group() {
        let mut doc = with_translations(two_sentence_doc());
        let crossing = ttable(&[tgroup(
            "s-g1.0",
            " data-crossing=\"true\"",
            &[
                (
                    "alpha bravo charlie delta echo,",
                    "第一段译文需要自然对应，",
                ),
                ("foxtrot golf hotel.", "第二段译文负责完整收尾。"),
            ],
        )]);
        let mut llm = file_llm([crossing]);
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        assert_eq!(llm.calls.len(), 1);
        assert_eq!(outcome.aligned_sentences, 1);
        // 自报交叉 ⇒ best-effort 保留模型的两行与源切点（对齐块设计 §4.5 修订），
        // 不再降级成整句一片。
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(entry.pieces.len(), 2);
        assert_ne!(entry.correspondence(), Correspondence::Sentence);
    }

    #[test]
    fn file_contract_carries_unsplittable_back_into_the_repair_round() {
        let mut doc = with_translations(two_sentence_doc());
        // 首轮：自述 unsplittable，同时改了源文 ⇒ 判失败进修复轮。
        let declared = ttable(&[tgroup(
            "s-g1.0",
            " data-unsplittable=\"true\"",
            &[(
                "alpha bravo charlie whiskey echo, foxtrot golf hotel.",
                "第一段译文需要自然对应，第二段译文负责完整收尾。",
            )],
        )]);
        let mut llm = file_llm([declared, good_align_table()]);
        run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        assert_eq!(llm.calls.len(), 2);
        assert!(!llm.calls[0].2.contains("data-unsplittable"), "首轮不回带");
        assert!(
            llm.calls[1].2.contains("data-unsplittable=\"true\""),
            "{}",
            llm.calls[1].2
        );
    }

    #[test]
    fn file_contract_shares_the_bilingual_anchor_gate() {
        // P1 根因修复（重叠锚点消歧）与双语锚同段校验都住在唯一的验收核心里，
        // 因此 file-v1 走的是同一份判据：源侧切在锚词中间 ⇒ 拒。
        let mut doc = with_translations(two_sentence_doc());
        let mut options = opts(AlignMode::ManyToOne);
        options.bilingual_anchors = vec![
            BilingualAnchor {
                source: "delta echo,".to_owned(),
                target: "自然对应".to_owned(),
            },
            // 重叠的短锚：与上面的源区间相交且更短 ⇒ 被消歧弃权，不参与判定。
            BilingualAnchor {
                source: "echo,".to_owned(),
                target: "完整收尾".to_owned(),
            },
        ];
        let mut llm = file_llm([good_align_table()]);
        let outcome = run_align(&mut doc, &mut llm, &options, &mut |_| {}).unwrap();
        // 短锚若未被弃权，它会把 "完整收尾"（第 2 片）钉到源第 1 片上而误报
        // mispair；消歧生效后本答案干净通过，一次调用即可。
        assert_eq!(llm.calls.len(), 1);
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(doc.trans_align["zh"]["s-g1.0"].pieces.len(), 2);
    }

    #[test]
    fn file_contract_pins_the_piece_count_budget_from_the_length_plan() {
        // P2：frozen 句的片数由 `length_plan` 钉死，两种载体同源。file 载体
        // 把它写进 `data-budget`，且**不带**秒数与融合草稿。
        let mut doc = with_translations(two_sentence_doc());
        let mut llm = file_llm([good_align_table()]);
        run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        let user = &llm.calls[0].2;
        assert!(
            user.contains("data-budget=\"每行≤16字，建议2片\""),
            "{user}"
        );
        assert!(!user.contains("draft"), "{user}");
    }

    #[test]
    fn file_contract_source_column_uses_the_shared_marker_thresholds() {
        // 停顿分档必须来自 `engines::markers`（0.6/1.0/1.8），不是 align.rs
        // 内部服务于 json-v0 载荷的私有阈值。
        let mut doc = doc_with_words(vec![
            w("g1.0", 0.0, 0.4, "alpha"),
            w("g1.1", 0.4, 0.8, "bravo"),
            w("g1.2", 0.8, 1.2, "charlie"),
            w("g1.3", 1.2, 1.6, "delta"),
            w("g1.4", 1.6, 2.0, "echo,"),
            // 0.7s 停顿 ⇒ 一级；markers 的一级阈值是 0.6。
            w("g1.5", 2.7, 3.1, "foxtrot"),
            w("g1.6", 3.1, 3.5, "golf"),
            w("g1.7", 3.5, 3.9, "hotel."),
            w("g2.0", 4.1, 4.5, "Done."),
        ]);
        doc = with_translations(doc);
        let mut llm = file_llm([good_align_table()]);
        run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        let user = &llm.calls[0].2;
        assert!(user.contains("echo, ⏸ foxtrot"), "{user}");
        assert!(!user.contains("⏸⏸"), "{user}");
        // ⏸ 的 Unicode 类目是 OtherSymbol，`normalize_chars` 会抹掉它，
        // 所以模型回来的不带标记的源文段照样对得上，无需 strip_markers。
        assert_eq!(doc.trans_align["zh"]["s-g1.0"].pieces.len(), 2);
    }

    #[test]
    fn file_contract_lint_and_engine_share_one_string_level_checker() {
        // §2「校验只有一份」：提交期 lint 从载荷 HTML 反解回 AlignTableInput，
        // 再调与引擎完全相同的 `parse_align_table`。
        let mut doc = with_translations(two_sentence_doc());
        let mut llm = file_llm([good_align_table()]);
        run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        let payload = &llm.calls[0].2;
        assert!(lint_agent_answer_file(payload, &good_align_table()).is_empty());
        let drifted = ttable(&[tgroup(
            "s-g1.0",
            "",
            &[
                (
                    "alpha bravo charlie whiskey echo,",
                    "第一段译文需要自然对应，",
                ),
                ("foxtrot golf hotel.", "第二段译文负责完整收尾。"),
            ],
        )]);
        let problems = lint_agent_answer_file(payload, &drifted);
        assert!(
            problems.iter().any(|item| item.contains("source-drift")),
            "{problems:?}"
        );
        // 不是 align 表的载荷（旧任务目录/别的 kind）一律不挡。
        assert!(lint_agent_answer_file("{\"sentences\":[]}", &drifted).is_empty());
    }

    /// file-v1 端到端：translate（HTML `section>p`）→ align（HTML 表）——
    /// `trans` 真相、`transAlign` 切法与词区间、派生投影一路成立。
    #[test]
    fn file_contract_translate_then_align_end_to_end() {
        let mut doc = two_sentence_doc();
        let mut llm = FakeLlm::ok([
            "<article><section id=\"p-g1.0\"><p id=\"s-g1.0\">第一段译文需要自然对应，第二段译文负责完整收尾。</p><p id=\"s-g2.0\">完成。</p></section></article>",
            GOOD_ALIGN_RESPONSE,
        ]);
        let translate_options = TranslateOptions {
            source_lang: "en".to_owned(),
            lang: "zh".to_owned(),
            force: false,
            sentences: None,
            page_budget: crate::paging::budgets::TRANSLATE_PROVIDER_WORDS,
            instructions: None,
            analysis: None,
            brief: None,
            tone: None,
            autocorrect: true,
            align: None,
            align_rows: false,
            align_lines: false,
            worker_slots: None,
            provenance_stale: BTreeSet::new(),
        };
        run_translate(
            &mut doc,
            &mut llm,
            &translate_options,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        let outcome =
            run_align(&mut doc, &mut llm, &opts(AlignMode::ManyToOne), &mut |_| {}).unwrap();
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(outcome.skipped_sentences, 1);
        assert_eq!(outcome.fallback_sentences, 0);
        assert!(!doc.trans_align["zh"].contains_key("s-g2.0"));

        // 派生投影成立（`transAlign` 是覆盖层，Cue 由它展开）。
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        assert_eq!(stream.len(), 3);
        assert!(stream.iter().all(|cue| !cue.fallback));
        let sentence = sentences
            .iter()
            .find(|item| item.id == "s-g1.0")
            .expect("sentence");
        assert!(align_entry_valid(
            &doc,
            sentence,
            &doc.trans["zh"]["s-g1.0"],
            &doc.trans_align["zh"]["s-g1.0"]
        ));
    }

    #[test]
    fn file_contract_fused_translate_draft_skips_the_align_call() {
        let mut doc = two_sentence_doc();
        doc.words[7].t1 = 8.0;
        doc.words[8].t0 = 8.2;
        doc.words[8].t1 = 8.6;
        let mut llm = FakeLlm::ok([concat!(
            "<article><section id=\"p-g1.0\">",
            "<p id=\"s-g1.0\"><span data-src=\"1-5\">第一段译文需要自然对应，</span><span data-src=\"6-8\">第二段译文负责完整收尾。</span></p>",
            "<p id=\"s-g2.0\">完成。</p>",
            "</section></article>",
        )]);
        let translate_options = TranslateOptions {
            source_lang: "en".to_owned(),
            lang: "zh".to_owned(),
            force: false,
            sentences: None,
            page_budget: crate::paging::budgets::TRANSLATE_PROVIDER_WORDS,
            instructions: None,
            analysis: None,
            brief: None,
            tone: None,
            autocorrect: true,
            align: Some(TransParams::for_lang("zh")),
            align_rows: false,
            align_lines: false,
            worker_slots: None,
            provenance_stale: BTreeSet::new(),
        };
        let translated = run_translate(
            &mut doc,
            &mut llm,
            &translate_options,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(translated.alignment_drafts.len(), 1);
        let (_, system, user, _) = &llm.calls[0];
        assert!(system.contains("Fused block alignment"), "{system}");
        assert!(
            user.contains("data-align-words=\"[1]alpha [2]bravo"),
            "{user}"
        );
        // span 对译文透明：入库的是完整自然译句。
        assert_eq!(
            doc.trans["zh"]["s-g1.0"],
            "第一段译文需要自然对应，第二段译文负责完整收尾。"
        );

        let outcome = run_align_with_drafts_and_artifacts(
            &mut doc,
            &mut llm,
            &opts_edges(AlignMode::ManyToOne),
            &translated.alignment_drafts,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(outcome.prealigned_sentences, 1);
        assert_eq!(llm.calls.len(), 1, "融合草稿验收后不应再调用 align worker");
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(entry.pieces.len(), 2);
        assert_eq!(entry.pieces[0].to, Some(4));
        assert_eq!(entry.pieces[1].from, Some(5));
        assert_eq!(entry.correspondence, Some(Correspondence::Block));
        assert_eq!(entry.aligner.as_deref(), Some(LLM_CHUNK_ALIGNER_TAG));
        assert!(entry.blocks.len() >= 2, "{entry:#?}");
    }

    // ---- 融合行分区（`--align-fusion rows`） -------------------------------

    /// 确定性分组：源侧 Cue 行边界 + 从句标点 + ≥ 0.35s 停顿切；小组并入相邻
    /// 组；> 5s 或 > 14 词的组在最大内部停顿处再切。零 LLM、零随机。
    #[test]
    fn fusion_groups_reuse_source_rows_then_apply_local_rules() {
        // 16 词一句：index 4 以逗号收尾、index 8 前有 0.6s 停顿。
        let mut words = Vec::new();
        let mut clock = 0.0f64;
        for index in 0..16 {
            if index == 8 {
                clock += 0.6;
            }
            let text = match index {
                4 => "data,".to_owned(),
                15 => "service.".to_owned(),
                _ => format!("w{index}"),
            };
            words.push(w(&format!("g1.{index}"), clock, clock + 0.4, &text));
            clock += 0.4;
        }
        let doc = doc_with_words(words);
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let sentence = &sentences[0];

        let info = fusion_line_info(&doc, &cues, sentence, true);
        assert_eq!(info.source_words.len(), 16);
        // 分组连续、无缝、恰好覆盖整句。
        let mut expected = 0usize;
        for group in &info.groups {
            assert_eq!(group.from, expected, "{:?}", info.groups);
            assert!(group.to >= group.from);
            assert!(group.t1_ds >= group.t0_ds);
            expected = group.to + 1;
        }
        assert_eq!(expected, 16);
        // 逗号缝与停顿缝都成为组边界。
        let starts: Vec<usize> = info.groups.iter().map(|group| group.from).collect();
        assert!(starts.contains(&5), "{starts:?}");
        assert!(starts.contains(&8), "{starts:?}");
        // 第一组从句首起、时间相对句首归零。
        assert_eq!(info.groups[0].t0_ds, 0);

        // `with_groups=false`（`on` 模式）完全不算分组。
        assert!(
            fusion_line_info(&doc, &cues, sentence, false)
                .groups
                .is_empty()
        );
    }

    fn rows_translate_options() -> TranslateOptions {
        TranslateOptions {
            source_lang: "en".to_owned(),
            lang: "zh".to_owned(),
            force: false,
            sentences: None,
            page_budget: crate::paging::budgets::TRANSLATE_PROVIDER_WORDS,
            instructions: None,
            analysis: None,
            brief: None,
            tone: None,
            autocorrect: true,
            align: Some(TransParams::for_lang("zh")),
            align_rows: true,
            align_lines: false,
            worker_slots: None,
            provenance_stale: BTreeSet::new(),
        }
    }

    fn rows_doc() -> TranscriptDoc {
        let mut doc = two_sentence_doc();
        doc.words[7].t1 = 8.0;
        doc.words[8].t0 = 8.2;
        doc.words[8].t1 = 8.6;
        doc
    }

    /// rows 端到端：翻译提示挂行分区契约 + `data-align-groups`，回答给出合格
    /// 行分区 ⇒ align 一次调用都不派，条目走 `llm-rows+anchor/1`，片文本逐行
    /// 等于 span 文本。
    #[test]
    fn file_contract_fused_row_draft_skips_the_align_call() {
        let mut doc = rows_doc();
        let mut llm = FakeLlm::ok([concat!(
            "<article><section id=\"p-g1.0\">",
            "<p id=\"s-g1.0\"><span data-src=\"1-5\">第一段译文需要自然对应，</span>",
            "<span data-src=\"6-8\">第二段译文负责完整收尾。</span></p>",
            "<p id=\"s-g2.0\">完成。</p>",
            "</section></article>",
        )]);
        let translated = run_translate(
            &mut doc,
            &mut llm,
            &rows_translate_options(),
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();

        let (_, system, user, _) = &llm.calls[0];
        assert!(system.contains("Fused display rows"), "{system}");
        assert!(!system.contains("Fused block alignment"), "{system}");
        // 第二轮 A/B 的调优：偏向合并（行切太碎会把 cps>6 比例推高），读速量化。
        // zh 的 TransParams 是 fit 16 / hard 20。
        assert!(
            system.contains("AIM FOR 10 to 16 display units per row"),
            "{system}"
        );
        assert!(system.contains("under 6 display units"), "{system}");
        assert!(
            system.contains("at most 6, and the row must last at least 1s"),
            "{system}"
        );
        assert!(system.contains("NEVER above 20"), "{system}");
        assert!(user.contains("data-align-groups=\""), "{user}");
        // 载荷末尾的提醒：长文档上 system 契约会被稀释（实测 59 句只标了 3 句）。
        assert!(user.contains("Reminder: answer with"), "{user}");
        assert!(user.trim_end().ends_with("display rows."), "{user}");
        assert_eq!(translated.alignment_drafts.len(), 1);
        assert!(translated.alignment_drafts["s-g1.0"].rows);
        assert_eq!(translated.rows_off_group_sentences, 0);
        assert_eq!(
            doc.trans["zh"]["s-g1.0"],
            "第一段译文需要自然对应，第二段译文负责完整收尾。"
        );

        let outcome = run_align_with_drafts_and_artifacts(
            &mut doc,
            &mut llm,
            &opts_edges(AlignMode::ManyToOne),
            &translated.alignment_drafts,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(outcome.prealigned_sentences, 1);
        assert_eq!(llm.calls.len(), 1, "行分区验收后不应再调用 align worker");

        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(entry.aligner.as_deref(), Some(LLM_ROWS_ALIGNER_TAG));
        assert_eq!(entry.correspondence, Some(Correspondence::Block));
        assert_eq!(entry.text_basis, TextBasis::Trans);
        assert_eq!(
            entry
                .pieces
                .iter()
                .map(|piece| piece.text.as_str())
                .collect::<Vec<_>>(),
            ["第一段译文需要自然对应，", "第二段译文负责完整收尾。"]
        );
        assert_eq!(entry.pieces[0].from, Some(0));
        assert_eq!(entry.pieces[0].to, Some(4));
        assert_eq!(entry.pieces[1].from, Some(5));
        assert_eq!(entry.pieces[1].to, Some(7));
        let sentences = derive_sentences(&doc, &derive_cues(&doc, &CueParams::default()));
        let sentence = sentences.iter().find(|item| item.id == "s-g1.0").unwrap();
        assert!(crate::align_block::validate_blocks(
            entry,
            sentence.word_indices.len()
        ));
    }

    /// lines 草稿的第二块 30 字超 hard 20、切点已放行 ⇒ 不派改写轮，在块内按
    /// lint 干净的缝再切一刀落成 `llm-lines+split/1`：三片、第一片与模型切点
    /// 原样保留、align 一次调用都不派。
    #[test]
    fn file_contract_lines_draft_splits_an_over_hard_block_in_place() {
        let mut doc = rows_doc();
        let long = "第二段译文负责完整收尾这一块写得太长超过了二十个字。";
        let mut llm = FakeLlm::new([Ok(format!(
            "1 |alpha..echo,|第一段译文需要自然对应，|foxtrot..hotel.|{long}\n2 |Done.|完成。\n"
        ))]);
        let mut options = rows_translate_options();
        options.align_rows = false;
        options.align_lines = true;
        let translated =
            run_translate(&mut doc, &mut llm, &options, &mut |_| {}, &mut |_| {}).unwrap();
        assert_eq!(
            doc.trans["zh"]["s-g1.0"],
            format!("第一段译文需要自然对应，{long}")
        );
        let outcome = run_align_with_drafts_and_artifacts(
            &mut doc,
            &mut llm,
            &opts_edges(AlignMode::ManyToOne),
            &translated.alignment_drafts,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(
            llm.calls.len(),
            1,
            "块内切分不派改写轮: {:#?}",
            outcome.violations
        );
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(
            entry.aligner.as_deref(),
            Some(LLM_LINES_SPLIT_ALIGNER_TAG),
            "{:#?}",
            outcome.violations
        );
        assert_eq!(entry.pieces.len(), 3, "{entry:#?}");
        assert_eq!(entry.pieces[0].text, "第一段译文需要自然对应，");
        assert_eq!(entry.pieces[0].to, Some(4));
        assert_eq!(entry.pieces[1].from, Some(5));
        assert_eq!(
            entry
                .pieces
                .iter()
                .map(|piece| piece.text.as_str())
                .collect::<String>(),
            doc.trans["zh"]["s-g1.0"]
        );
        assert!(
            outcome.violations.iter().any(|line| line
                .contains("1 over-hard block(s) split in place at 1 character-level seam(s)")),
            "{:#?}",
            outcome.violations
        );
    }

    /// lines 端到端：翻译页是 `lines/1` 纯文本（kind `translate-lines`）、
    /// system prompt 末尾挂载体语法而不挂 HTML 融合段；回答的首尾引用被联合
    /// 定位成块证据 ⇒ align 一次调用都不派，条目走 `llm-lines+anchor/1`，片
    /// 文本逐块等于回答的块文本。
    #[test]
    fn file_contract_lines_draft_skips_the_align_call() {
        let mut doc = rows_doc();
        let mut llm = FakeLlm::ok([concat!(
            "1 |alpha..echo,|第一段译文需要自然对应，|foxtrot..hotel.|第二段译文负责完整收尾。\n",
            "2 |Done.|完成。\n",
        )]);
        let mut options = rows_translate_options();
        options.align_rows = false;
        options.align_lines = true;
        let translated =
            run_translate(&mut doc, &mut llm, &options, &mut |_| {}, &mut |_| {}).unwrap();

        let (kind, system, user, _) = &llm.calls[0];
        assert_eq!(kind, "translate-lines");
        assert!(system.contains("lines/1, mode=blocks"), "{system}");
        assert!(
            system.contains("plain-text page in the lines/1 format"),
            "{system}"
        );
        assert!(!system.contains("Fused display rows"), "{system}");
        assert!(!system.contains("<span data-src>"), "{system}");
        assert!(
            user.starts_with("! format=lines/1 mode=blocks row=16 target=zh\n"),
            "{user}"
        );
        assert!(user.contains("\n1 ≤"), "{user}");
        assert!(
            user.contains("alpha bravo charlie delta echo, foxtrot golf hotel."),
            "{user}"
        );
        assert!(!user.contains("<article"), "{user}");
        assert_eq!(translated.alignment_drafts.len(), 2);
        let draft = &translated.alignment_drafts["s-g1.0"];
        assert!(draft.chunks.is_empty() && !draft.rows);
        let lines = draft.lines.as_ref().expect("lines draft");
        assert_eq!(lines.record.text(), doc.trans["zh"]["s-g1.0"]);
        assert_eq!(lines.source_words.len(), 8);
        assert_eq!(
            doc.trans["zh"]["s-g1.0"],
            "第一段译文需要自然对应，第二段译文负责完整收尾。"
        );

        let outcome = run_align_with_drafts_and_artifacts(
            &mut doc,
            &mut llm,
            &opts_edges(AlignMode::ManyToOne),
            &translated.alignment_drafts,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(outcome.prealigned_sentences, 1);
        assert_eq!(
            llm.calls.len(),
            1,
            "行文本草稿验收后不应再调用 align worker"
        );

        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(entry.aligner.as_deref(), Some(LLM_LINES_ALIGNER_TAG));
        assert_eq!(entry.correspondence, Some(Correspondence::Block));
        assert_eq!(
            entry
                .pieces
                .iter()
                .map(|piece| piece.text.as_str())
                .collect::<Vec<_>>(),
            ["第一段译文需要自然对应，", "第二段译文负责完整收尾。"]
        );
        assert_eq!(entry.pieces[0].from, Some(0));
        assert_eq!(entry.pieces[0].to, Some(4));
        assert_eq!(entry.pieces[1].from, Some(5));
        assert_eq!(entry.pieces[1].to, Some(7));
    }

    /// lines 草稿只在载体看到的词表与本轮锚定词一致时生效；对不上（最终时间线
    /// 裁掉了词）就按无草稿处理，句子照常进 dedicated 轮。
    #[test]
    fn a_lines_draft_whose_words_do_not_match_falls_back_to_pending() {
        let mut doc = rows_doc();
        let mut llm = FakeLlm::ok([
            "1 |alpha..echo,|第一段译文需要自然对应，|foxtrot..hotel.|第二段译文负责完整收尾。\n2 |Done.|完成。\n",
        ]);
        let mut options = rows_translate_options();
        options.align_rows = false;
        options.align_lines = true;
        let translated =
            run_translate(&mut doc, &mut llm, &options, &mut |_| {}, &mut |_| {}).unwrap();
        let mut drafts = translated.alignment_drafts.clone();
        drafts
            .get_mut("s-g1.0")
            .unwrap()
            .lines
            .as_mut()
            .unwrap()
            .source_words
            .pop();

        let outcome = run_align_with_drafts_and_artifacts(
            &mut doc,
            &mut llm,
            &opts_edges(AlignMode::ManyToOne),
            &drafts,
            &mut |_| {},
            &mut |_| {},
        );
        // FakeLlm 脚本已耗尽：dedicated 轮被真的派出去了（并因此失败）。
        assert!(outcome.is_err());
        assert_eq!(llm.calls.len(), 2);
    }

    /// 合并只在句内发生：两句各自带同样的三行草稿，各自合并各自的短行，
    /// 片的源区间绝不跨句（`plan_sentence_rows` 逐句调用，句间零共享状态）。
    #[test]
    fn short_row_merging_never_crosses_a_sentence_boundary() {
        // 每句 6 词、译文 17 单位（> fit 16，因此必然入队）；行 [2/0.5s]、
        // [5/1.0s]、[10/2.0s]，首行触发合并且合并后 7 单位 / 1.5s 合法。
        let spans = [
            (0.0, 0.5),
            (0.5, 1.0),
            (1.0, 1.5),
            (1.5, 2.5),
            (2.5, 3.0),
            (3.0, 3.5),
        ];
        let mut words = Vec::new();
        for (sentence, base) in [(1usize, 0.0f64), (2, 20.0)] {
            for (index, &(t0, t1)) in spans.iter().enumerate() {
                let text = if index + 1 == spans.len() {
                    "end.".to_owned()
                } else {
                    format!("word{index}")
                };
                words.push(w(
                    &format!("g{sentence}.{index}"),
                    base + t0,
                    base + t1,
                    &text,
                ));
            }
        }
        let mut doc = doc_with_words(words);
        let rows = ["甲乙", "丙丁戊己庚", "辛壬癸子丑寅卯辰巳午"];
        let translation: String = rows.concat();
        let table = doc.trans.entry("zh".to_owned()).or_default();
        for id in ["s-g1.0", "s-g2.0"] {
            table.insert(id.to_owned(), translation.clone());
        }

        let draft = FusionDraft {
            chunks: [
                (rows[0], vec![0]),
                (rows[1], vec![1, 2]),
                (rows[2], vec![3, 4, 5]),
            ]
            .into_iter()
            .map(|(text, ordinals)| AlignChunk {
                text: text.to_owned(),
                ordinals,
            })
            .collect(),
            rows: true,
            on_groups: true,
            lines: None,
        };
        let drafts: FusionDrafts = ["s-g1.0", "s-g2.0"]
            .into_iter()
            .map(|id| (id.to_owned(), draft.clone()))
            .collect();

        let mut llm = file_llm([]);
        let outcome = run_align_with_drafts_and_artifacts(
            &mut doc,
            &mut llm,
            &opts_edges(AlignMode::ManyToOne),
            &drafts,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.calls.len(), 0, "两句都走行直通，不该派 align 调用");
        assert_eq!(outcome.prealigned_sentences, 2);
        // 两句各自的首行都被合并一次；合并计数是逐句累加的。
        assert_eq!(outcome.rows_merged, 2);

        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        assert_eq!(sentences.len(), 2);
        for sentence in &sentences {
            let entry = &doc.trans_align["zh"][&sentence.id];
            assert_eq!(entry.aligner.as_deref(), Some(LLM_ROWS_ALIGNER_TAG));
            // 三行合成两片，且片的源区间只覆盖本句的 6 个词。
            assert_eq!(
                entry
                    .pieces
                    .iter()
                    .map(|piece| piece.text.as_str())
                    .collect::<Vec<_>>(),
                ["甲乙丙丁戊己庚", "辛壬癸子丑寅卯辰巳午"],
                "{}",
                sentence.id
            );
            assert_eq!(entry.pieces[0].from, Some(0));
            assert_eq!(entry.pieces[0].to, Some(2));
            assert_eq!(entry.pieces[1].from, Some(3));
            assert_eq!(entry.pieces[1].to, Some(5));
            assert_eq!(entry.words.len(), sentence.word_indices.len());
            // 块层仍是模型给的三行对应。
            assert_eq!(entry.blocks.len(), 3);
            assert!(crate::align_block::validate_blocks(
                entry,
                sentence.word_indices.len()
            ));
        }
    }

    /// 行分区不合格（序号有缺口）⇒ 不走行直通：草稿降级成普通块草稿，仍按
    /// `on` 模式那条确定性核验收，条目落 `llm-chunk+anchor/1`。
    #[test]
    fn a_malformed_row_draft_falls_back_to_the_plain_chunk_path() {
        let mut doc = rows_doc();
        let mut llm = FakeLlm::ok([concat!(
            "<article><section id=\"p-g1.0\">",
            "<p id=\"s-g1.0\"><span data-src=\"1-4\">第一段译文需要自然对应，</span>",
            "<span data-src=\"6-8\">第二段译文负责完整收尾。</span></p>",
            "<p id=\"s-g2.0\">完成。</p>",
            "</section></article>",
        )]);
        let translated = run_translate(
            &mut doc,
            &mut llm,
            &rows_translate_options(),
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(translated.alignment_drafts.len(), 1);
        assert!(!translated.alignment_drafts["s-g1.0"].rows, "序号 5 未覆盖");

        run_align_with_drafts_and_artifacts(
            &mut doc,
            &mut llm,
            &opts_edges(AlignMode::ManyToOne),
            &translated.alignment_drafts,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(
            doc.trans_align["zh"]["s-g1.0"].aligner.as_deref(),
            Some(LLM_CHUNK_ALIGNER_TAG),
            "不合格行分区不得写行标签"
        );
    }

    /// rows 模式下模型压根没给行标注 ⇒ 没有草稿，该句照常派 `align-edges` 轮。
    #[test]
    fn a_rows_answer_without_spans_still_dispatches_the_align_call() {
        let mut doc = rows_doc();
        let mut llm = file_llm([
            concat!(
                "<article><section id=\"p-g1.0\">",
                "<p id=\"s-g1.0\">第一段译文需要自然对应，第二段译文负责完整收尾。</p>",
                "<p id=\"s-g2.0\">完成。</p>",
                "</section></article>",
            )
            .to_owned(),
            ttable(&[egroup(
                "s-g1.0",
                &[
                    ("1-5", "第一段译文需要自然对应，"),
                    ("6-8", "第二段译文负责完整收尾。"),
                ],
            )]),
        ]);
        let translated = run_translate(
            &mut doc,
            &mut llm,
            &rows_translate_options(),
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert!(translated.alignment_drafts.is_empty());

        run_align_with_drafts_and_artifacts(
            &mut doc,
            &mut llm,
            &opts_edges(AlignMode::ManyToOne),
            &translated.alignment_drafts,
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.calls.len(), 2, "没有草稿必须回落 align-edges 轮");
        assert_ne!(
            doc.trans_align["zh"]["s-g1.0"].aligner.as_deref(),
            Some(LLM_ROWS_ALIGNER_TAG)
        );
    }

    // ---- 块对齐边载体（align-edges/1 / align-rewrite/1） --------------------

    /// 两句：句 1 因果倒装（译文语序交叉，dwell > 7s 迫使入队），句 2 单调三小句
    ///（译文超 fit）。
    fn edges_doc() -> TranscriptDoc {
        let mut words = Vec::new();
        for (index, text) in ["I", "didn't", "go", "because", "I", "was", "sick."]
            .into_iter()
            .enumerate()
        {
            words.push(w(
                &format!("g1.{index}"),
                index as f64 * 1.2,
                index as f64 * 1.2 + 1.0,
                text,
            ));
        }
        for (index, text) in [
            "We", "first", "analyze", "the", "data,", "then", "train", "the", "model,", "and",
            "finally", "deploy", "the", "service.",
        ]
        .into_iter()
        .enumerate()
        {
            words.push(w(
                &format!("g2.{index}"),
                10.0 + index as f64 * 0.4,
                10.0 + index as f64 * 0.4 + 0.4,
                text,
            ));
        }
        let mut doc = doc_with_words(words);
        let table = doc.trans.entry("zh".to_owned()).or_default();
        table.insert("s-g1.0".to_owned(), "因为我病了，所以没去。".to_owned());
        table.insert(
            "s-g2.0".to_owned(),
            "我们先分析数据，然后训练模型，最后部署服务。".to_owned(),
        );
        doc
    }

    fn egroup(sid: &str, spans: &[(&str, &str)]) -> String {
        let mut out = format!(
            "  <tbody data-sid=\"{sid}\"><tr><th scope=\"rowgroup\">{sid}</th><td class=\"src\">x</td><td class=\"tgt\">"
        );
        for (src, text) in spans {
            out.push_str(&format!("<span data-src=\"{src}\">{text}</span>"));
        }
        out.push_str("</td></tr></tbody>\n");
        out
    }

    #[test]
    fn edges_carrier_dedicated_round_collapses_crossing_and_splits_monotone() {
        let mut doc = edges_doc();
        let answer = ttable(&[
            egroup(
                "s-g1.0",
                &[("4-7", "因为我病了，"), ("1 2 3", "所以没去。")],
            ),
            egroup(
                "s-g2.0",
                &[
                    ("1-5", "我们先分析数据，"),
                    ("6-9", "然后训练模型，"),
                    ("10-14", "最后部署服务。"),
                ],
            ),
        ]);
        let mut llm = file_llm([answer]);
        let mut artifacts = Artifacts::default();
        let outcome = run_align_with_artifacts(
            &mut doc,
            &mut llm,
            &opts_edges(AlignMode::ManyToOne),
            &mut |attempt| {
                artifacts.pages.push((
                    attempt.page_id.to_owned(),
                    attempt.attempt,
                    attempt.accepted,
                    attempt.problems.len(),
                ));
            },
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.calls.len(), 1, "{:?}", outcome.violations);
        let (kind, system, user, _) = &llm.calls[0];
        assert_eq!(kind, "align-edges");
        assert!(system.contains("<span data-src="), "{system}");
        assert!(
            user.contains("data-bcut-format=\"align-edges/1\""),
            "{user}"
        );
        assert!(
            user.contains("[1]I [2]didn't [3]go [4]because [5]I [6]was [7]sick."),
            "{user}"
        );
        assert_eq!(artifacts.pages, vec![("b001".to_owned(), 1, true, 0)]);
        assert_eq!(outcome.aligned_sentences, 2, "{:?}", outcome.violations);
        assert_eq!(outcome.fallback_sentences, 0);
        assert_eq!(outcome.sentence_level_sentences, 0);
        assert_eq!(outcome.rewritten_sentences, 0);

        // 交叉句：整句一块、一片，仍是块级对应（不伪造逐行对应）。
        let crossing = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(crossing.mode, AlignMode::ManyToOne);
        assert_eq!(crossing.pieces.len(), 1);
        assert_eq!(crossing.blocks.len(), 1);
        assert_eq!(crossing.correspondence, Some(Correspondence::Block));
        assert!(
            crossing.blocks[0]
                .flags
                .contains(&"local-reorder".to_owned()),
            "{crossing:#?}"
        );
        assert_eq!(crossing.aligner.as_deref(), Some(LLM_CHUNK_ALIGNER_TAG));
        assert!(!crossing.crossing);

        // 单调句：多块多片，片边界只落在块边界上。
        let monotone = &doc.trans_align["zh"]["s-g2.0"];
        assert!(monotone.pieces.len() >= 2, "{monotone:#?}");
        assert!(monotone.blocks.len() >= 3, "{monotone:#?}");
        assert_eq!(monotone.correspondence, Some(Correspondence::Block));
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        for sentence in &sentences {
            assert!(align_entry_valid_for_lang(
                &doc,
                sentence,
                "zh",
                &doc.trans_align["zh"][&sentence.id]
            ));
        }
    }

    #[test]
    fn edges_carrier_bad_answers_get_one_repair_round_then_anchor_or_fallback() {
        let mut doc = edges_doc();
        // 首轮：句 1 序号越界（[align-edge-ordinal]），句 2 未标注 span；
        // 修复轮：句 1 修好，句 2 仍缺 ⇒ 纯锚点无证据 ⇒ 确定性兜底。
        let bad = ttable(&[
            egroup("s-g1.0", &[("4-9", "因为我病了，"), ("1 2 3", "所以没去。")]),
            "  <tbody data-sid=\"s-g2.0\"><tr><td class=\"src\">x</td><td class=\"tgt\">我们先分析数据，然后训练模型，最后部署服务。</td></tr></tbody>\n".to_owned(),
        ]);
        let repaired = ttable(&[egroup(
            "s-g1.0",
            &[("4-7", "因为我病了，"), ("1 2 3", "所以没去。")],
        )]);
        let mut llm = file_llm([bad, repaired]);
        let outcome = run_align(
            &mut doc,
            &mut llm,
            &opts_edges(AlignMode::ManyToOne),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.calls.len(), 2);
        let (kind, _, user, retry) = &llm.calls[1];
        assert_eq!(kind, "align-edges");
        let retry = retry.as_deref().unwrap();
        assert!(retry.contains("align-edge-ordinal"), "{retry}");
        assert!(retry.contains("s-g2.0"), "{retry}");
        assert!(user.contains("data-sid=\"s-g1.0\""), "{user}");
        assert!(user.contains("data-sid=\"s-g2.0\""), "{user}");
        assert_eq!(outcome.aligned_sentences, 1, "{:?}", outcome.violations);
        assert_eq!(outcome.fallback_sentences, 1);
        assert_eq!(doc.trans_align["zh"]["s-g1.0"].blocks.len(), 1);
        assert!(doc.trans_align["zh"]["s-g2.0"].blocks.is_empty());
        assert!(
            outcome
                .violations
                .iter()
                .any(|violation| violation.starts_with("s-g2.0: fell back")),
            "{:?}",
            outcome.violations
        );
    }

    /// 单块超 hard 的因果倒装句（对齐块设计 §4.5 第三分支）。
    fn rewrite_doc() -> TranscriptDoc {
        let mut words = Vec::new();
        for (index, text) in [
            "I", "didn't", "go", "because", "I", "was", "sick", "and", "tired.",
        ]
        .into_iter()
        .enumerate()
        {
            words.push(w(
                &format!("g1.{index}"),
                index as f64 * 0.5,
                index as f64 * 0.5 + 0.5,
                text,
            ));
        }
        let mut doc = doc_with_words(words);
        doc.trans.entry("zh".to_owned()).or_default().insert(
            "s-g1.0".to_owned(),
            "因为我当时既生病又非常疲惫不堪，所以最终没有去成。".to_owned(),
        );
        doc
    }

    fn rewrite_llm(rewrite_answer: String) -> FakeLlm {
        let dedicated = ttable(&[egroup(
            "s-g1.0",
            &[
                ("4-9", "因为我当时既生病又非常疲惫不堪，"),
                ("1-3", "所以最终没有去成。"),
            ],
        )]);
        file_llm([dedicated, rewrite_answer])
    }

    #[test]
    fn edges_carrier_rewrite_round_writes_trans_display_with_display_basis() {
        let mut doc = rewrite_doc();
        let natural = doc.trans["zh"]["s-g1.0"].clone();
        let mut llm = rewrite_llm(ttable(&[egroup(
            "s-g1.0",
            &[
                ("1-3", "我最终没有去成，"),
                ("4-9", "因为当时既生病又非常疲惫不堪。"),
            ],
        )]));
        let mut artifacts = Artifacts::default();
        let outcome = run_align_with_artifacts(
            &mut doc,
            &mut llm,
            &opts_edges(AlignMode::ManyToOne),
            &mut |attempt| {
                artifacts.pages.push((
                    attempt.page_id.to_owned(),
                    attempt.attempt,
                    attempt.accepted,
                    0,
                ));
            },
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.calls.len(), 2, "{:?}", outcome.violations);
        let (kind, system, user, _) = &llm.calls[1];
        assert_eq!(kind, "align-rewrite");
        assert!(
            system.contains("follows the SOURCE clause order"),
            "{system}"
        );
        assert!(
            user.contains("data-bcut-format=\"align-rewrite/1\""),
            "{user}"
        );
        assert!(
            user.contains("data-over-hard=\"chunk 1 (words 1-9): "),
            "{user}"
        );
        assert!(user.contains("&gt; hard 20\""), "{user}");
        assert_eq!(
            artifacts.pages,
            vec![("b001".to_owned(), 1, true), ("w001".to_owned(), 1, true)]
                .into_iter()
                .map(|(page, attempt, accepted)| (page, attempt, accepted, 0))
                .collect::<Vec<_>>()
        );
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(outcome.rewritten_sentences, 1);
        assert_eq!(outcome.sentence_level_sentences, 0);
        // 自然译句不动；改写进 transDisplay；条目以 display 为基准。
        assert_eq!(doc.trans["zh"]["s-g1.0"], natural);
        let display = &doc.trans_display["zh"]["s-g1.0"];
        assert_eq!(
            display.text,
            "我最终没有去成，因为当时既生病又非常疲惫不堪。"
        );
        assert_eq!(display.basis, MONOTONIC_REWRITE_BASIS);
        assert_eq!(display.trans_fingerprint, trans_text_fingerprint(&natural));
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(entry.text_basis, TextBasis::Display);
        assert_eq!(entry.correspondence, Some(Correspondence::Block));
        assert_eq!(entry.pieces.len(), 2, "{entry:#?}");
        assert_eq!(entry.pieces[0].to, Some(2));
        assert_eq!(entry.pieces[1].from, Some(3));
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        assert!(align_entry_valid_for_lang(&doc, &sentences[0], "zh", entry));
        assert!(
            outcome
                .violations
                .iter()
                .any(|violation| violation.contains(MONOTONIC_REWRITE_BASIS)),
            "{:?}",
            outcome.violations
        );

        // 增量：display 基准条目有效 ⇒ 再跑一次不再调用；改译文 ⇒ display-stale
        // 连带删除，重新入队。
        let mut idle = file_llm([]);
        let again = run_align(
            &mut doc,
            &mut idle,
            &opts_edges(AlignMode::ManyToOne),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(again.skipped_sentences, 1);
        assert!(idle.calls.is_empty());
        doc.trans.get_mut("zh").unwrap().insert(
            "s-g1.0".to_owned(),
            "因为我当时既生病又非常疲惫不堪，所以最终没能成行。".to_owned(),
        );
        let mut relaunch = file_llm([ttable(&[egroup(
            "s-g1.0",
            &[
                ("4-9", "因为我当时既生病又非常疲惫不堪，"),
                ("1-3", "所以最终没能成行。"),
            ],
        )])]);
        let _ = run_align(
            &mut doc,
            &mut relaunch,
            &opts_edges(AlignMode::ManyToOne),
            &mut |_| {},
        );
        assert!(
            !relaunch.calls.is_empty(),
            "stale display must re-enter the queue"
        );
        assert!(!doc.trans_display.contains_key("zh"));
    }

    /// 改写轮交回的文本与入库译文一字不差、只是块切细到能进 DP：按常规对齐
    /// 入库，不写 transDisplay、不记改写、不让用户去核对不存在的改写。
    #[test]
    fn edges_carrier_rewrite_with_unchanged_text_is_plain_aligned() {
        let mut doc = rewrite_doc();
        let natural = "我最终没有去成，因为当时既生病又非常疲惫不堪。".to_owned();
        doc.trans
            .get_mut("zh")
            .unwrap()
            .insert("s-g1.0".to_owned(), natural.clone());
        // dedicated 轮把序号标反 ⇒ 交叉 ⇒ 整句一块超 hard ⇒ 改写轮。
        let dedicated = ttable(&[egroup(
            "s-g1.0",
            &[
                ("4-9", "我最终没有去成，"),
                ("1-3", "因为当时既生病又非常疲惫不堪。"),
            ],
        )]);
        let rewrite = ttable(&[egroup(
            "s-g1.0",
            &[
                ("1-3", "我最终没有去成，"),
                ("4-9", "因为当时既生病又非常疲惫不堪。"),
            ],
        )]);
        let mut llm = file_llm([dedicated, rewrite]);
        let outcome = run_align(
            &mut doc,
            &mut llm,
            &opts_edges(AlignMode::ManyToOne),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.calls.len(), 2, "{:?}", outcome.violations);
        assert_eq!(llm.calls[1].0, "align-rewrite");
        assert_eq!(outcome.aligned_sentences, 1);
        assert_eq!(outcome.rewritten_sentences, 0);
        assert_eq!(outcome.fallback_sentences, 0);
        assert!(!doc.trans_display.contains_key("zh"));
        assert_eq!(doc.trans["zh"]["s-g1.0"], natural);
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_eq!(entry.text_basis, TextBasis::Trans);
        assert_eq!(entry.pieces.len(), 2, "{entry:#?}");
        assert!(
            outcome
                .violations
                .iter()
                .any(|violation| violation.contains("kept the text unchanged")),
            "{:?}",
            outcome.violations
        );
        assert!(
            !outcome
                .violations
                .iter()
                .any(|violation| violation.contains("verify no meaning shifted")),
            "{:?}",
            outcome.violations
        );
    }

    #[test]
    fn edges_carrier_rejected_rewrite_degrades_without_an_over_hard_row() {
        let mut doc = rewrite_doc();
        let natural = doc.trans["zh"]["s-g1.0"].clone();
        // 改写压缩内容（24 → 8 单位）⇒ 幅度护栏拒收 ⇒ 降级。自然译句超 hard，
        // 整句一片会是一条放不下的单行 ⇒ 在确定性目标缝上切开、源时间按比例分配。
        let mut llm = rewrite_llm(ttable(&[egroup(
            "s-g1.0",
            &[("1-3", "我没去，"), ("4-9", "因为病了。")],
        )]));
        let outcome = run_align(
            &mut doc,
            &mut llm,
            &opts_edges(AlignMode::ManyToOne),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.calls.len(), 2);
        assert_eq!(outcome.aligned_sentences, 0);
        assert_eq!(outcome.rewritten_sentences, 0);
        assert_eq!(outcome.sentence_level_sentences, 0);
        assert_eq!(outcome.fallback_sentences, 1);
        assert!(!doc.trans_display.contains_key("zh"));
        assert_eq!(doc.trans["zh"]["s-g1.0"], natural);
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert_ne!(entry.correspondence(), Correspondence::Sentence);
        assert_eq!(entry.text_basis, TextBasis::Trans);
        assert!(entry.pieces.len() >= 2, "{entry:?}");
        let params = TransParams::for_lang("zh");
        for piece in &entry.pieces {
            assert!(
                crate::split::piece_display_units(&piece.text, "zh") <= params.hard,
                "{entry:?}"
            );
        }
        assert_eq!(
            entry
                .pieces
                .iter()
                .map(|piece| piece.text.as_str())
                .collect::<String>(),
            natural
        );
        assert!(
            outcome
                .violations
                .iter()
                .any(|violation| violation.contains("monotonic rewrite rejected")
                    && violation.contains("deterministic target seam")),
            "{:?}",
            outcome.violations
        );
    }

    #[test]
    fn edges_lint_shares_the_engine_string_checker() {
        // 提交期 lint 与引擎解析同一份载荷：同样的问题码、同样的句 id。
        let doc = edges_doc();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let words: Vec<String> = sentences[0]
            .word_indices
            .iter()
            .map(|&index| doc.words[index].text.clone())
            .collect();
        let table = AlignEdgesInput::new(
            "zh",
            vec![crate::filepipe::AlignEdgesSentenceInput::new(
                "s-g1.0",
                words,
                "因为我病了，所以没去。",
            )],
        );
        let payload = render_align_edges(&table);
        let drifted = ttable(&[egroup(
            "s-g1.0",
            &[("4-7", "因为我生病了，"), ("1 2 3", "所以没去。")],
        )]);
        let lint = lint_agent_answer_edges(&payload, &drifted);
        assert_eq!(lint.len(), 1, "{lint:?}");
        assert!(lint[0].starts_with("[align-edge-text] s-g1.0:"), "{lint:?}");
        let engine = parse_align_edges(&table, Some(&payload), &drifted);
        assert_eq!(engine.diagnostics.problems.len(), 1);
        assert_eq!(
            engine.diagnostics.problems[0].code,
            ProblemCode::AlignEdgeText
        );
        // 载荷不是 edges 表 ⇒ 不挡。
        assert!(lint_agent_answer_edges("<p>nope</p>", &drifted).is_empty());

        // rewrite 载荷走同一入口：格式属性决定 rewrite 模式，幅度护栏生效。
        let mut rewrite = table.clone();
        rewrite.rewrite = true;
        let payload = render_align_edges(&rewrite);
        let squeezed = ttable(&[egroup("s-g1.0", &[("1-7", "没去。")])]);
        let lint = lint_agent_answer_rewrite(&payload, &squeezed);
        assert!(
            lint.iter()
                .any(|line| line.starts_with("[align-content-drift] s-g1.0:")),
            "{lint:?}"
        );
        let natural = ttable(&[egroup(
            "s-g1.0",
            &[("1-3", "我没去，"), ("4-7", "因为我病了。")],
        )]);
        assert!(lint_agent_answer_rewrite(&payload, &natural).is_empty());
    }

    // ---- s-g9.0 回归（Sundar Pichai 项目，fr → zh-Hans，四轮对齐证据） ----

    /// 真实项目 s-g9.0 的 25 个源词（含 polish 插入的 `à`）与真实词时间；
    /// `faire` 前有自动断行，派生出 4 条用户可见源行。
    fn sg9_doc(translation: &str) -> TranscriptDoc {
        let raw: [(&str, f64, f64, &str); 25] = [
            ("g9.0", 36.32, 36.64, "Mais"),
            ("g9.1", 36.64, 36.85, "si"),
            ("g9.2", 36.85, 37.18, "vous"),
            ("g9.3", 37.18, 37.51, "êtes"),
            ("g9.4", 37.51, 37.71, "un"),
            ("g9.5", 37.71, 38.5, "scientifique,"),
            ("g9.6", 38.5, 38.83, "vous"),
            ("g9.7", 38.83, 39.16, "êtes"),
            ("g9.8", 39.16, 39.48, "prêt"),
            ("g9.9", 39.48, 39.69, "à"),
            ("g9.10", 39.69, 40.08, "faire"),
            ("g9.11", 40.08, 40.4, "face"),
            ("g9.12", 40.4, 40.61, "à"),
            ("g9.13", 40.61, 40.82, "ce"),
            ("g9.14", 40.82, 41.14, "défi"),
            ("g10.0", 41.14, 41.31, "et"),
            ("wmug0k8vt-18", 41.31, 41.32, "à"),
            ("g10.1", 41.32, 41.76, "résoudre"),
            ("g10.2", 41.76, 41.97, "les"),
            ("g10.3", 41.97, 42.45, "problèmes"),
            ("g10.4", 42.45, 42.67, "qui"),
            ("g10.5", 42.67, 43.11, "viennent"),
            ("g10.6", 43.11, 43.36, "avec"),
            ("g10.7", 43.36, 43.53, "le"),
            ("g10.8", 43.53, 43.88, "chemin."),
        ];
        let mut doc = doc_with_words(
            raw.iter()
                .map(|&(id, t0, t1, text)| w(id, t0, t1, text))
                .collect(),
        );
        doc.lang = "fr".to_owned();
        doc.breaks.insert("g9.10".to_owned(), BreakOverride::Break);
        doc.trans
            .entry("zh-Hans".to_owned())
            .or_default()
            .insert("s-g9.0".to_owned(), translation.to_owned());
        doc
    }

    const SG9_R1: &str = "但如果你是科学家，就愿迎接挑战，解决沿途难题。";

    fn sg9_stats(doc: &TranscriptDoc) -> Vec<RowDeficitStats> {
        let cues = derive_cues(doc, &crate::layout_profile::cue_params_for_doc(doc));
        let sentences = derive_sentences(doc, &cues);
        let trans = derive_trans_cues(doc, &sentences, "zh-Hans");
        row_deficit_stats(doc, &sentences, "zh-Hans", &cues, &trans)
    }

    /// 用户项目里那份 translate 融合 rows 草稿落下的两片（第二片 5.38s、跨 3
    /// 条源行 ⇒ `align-row-deficit`）。
    fn sg9_rows_entry(doc: &TranscriptDoc) -> TransAlign {
        let mut entry = TransAlign::new(
            AlignMode::ManyToOne,
            doc.words.iter().map(|word| word.id.clone()).collect(),
            vec![
                TransPiece {
                    from: Some(0),
                    to: Some(5),
                    text: "但如果你是科学家，".to_owned(),
                },
                TransPiece {
                    from: Some(6),
                    to: Some(24),
                    text: "就愿迎接挑战，解决沿途难题。".to_owned(),
                },
            ],
        );
        entry.aligner = Some("llm-rows+anchor/1".to_owned());
        entry
    }

    fn sg9_with_entry(translation: &str, entry: fn(&TranscriptDoc) -> TransAlign) -> TranscriptDoc {
        let mut doc = sg9_doc(translation);
        let entry = entry(&doc);
        doc.trans_align
            .entry("zh-Hans".to_owned())
            .or_default()
            .insert("s-g9.0".to_owned(), entry);
        doc
    }

    /// paired 收尾轮（`run_row_repair_tail` 同一组选项）。
    fn sg9_paired_options(carrier: AlignCarrier) -> AlignOptions {
        let mut options = opts(AlignMode::ManyToOne);
        options.carrier = carrier;
        options.lang = "zh-Hans".to_owned();
        options.density = AlignDensity::Paired;
        options.density_sentences = ["s-g9.0".to_owned()].into_iter().collect();
        options.sentences = Some(["s-g9.0".to_owned()].into_iter().collect());
        options.targeted = true;
        options.force = true;
        options.repair_calls = 0;
        options
    }

    /// 第 1 轮 worker 答案（c0002）：7 个语义块，尾部 16-18 / 21-25 / 19-20 交叉。
    fn sg9_c0002_answer() -> String {
        ttable(&[egroup(
            "s-g9.0",
            &[
                ("1", "但"),
                ("2-6", "如果你是科学家，"),
                ("7-10", "就愿"),
                ("11-15", "迎接挑战，"),
                ("16-18", "解决"),
                ("21-25", "沿途"),
                ("19-20", "难题。"),
            ],
        )])
    }

    fn sg9_assert_no_deficit(doc: &TranscriptDoc) {
        let stats = sg9_stats(doc);
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].reason, None, "{stats:?}");
        assert!(stats[0].trans_cues >= 3, "{stats:?}");
        assert!(
            stats[0].max_dwell_sec < ROW_DEFICIT_DWELL_SECONDS,
            "{stats:?}"
        );
        let entry = &doc.trans_align["zh-Hans"]["s-g9.0"];
        let hard = TransParams::for_lang("zh-Hans").hard;
        for piece in &entry.pieces {
            assert!(
                crate::split::piece_display_units(&piece.text, "zh-Hans") <= hard,
                "{entry:?}"
            );
        }
    }

    #[test]
    fn sg9_block_dp_cuts_a_stuck_row_at_block_boundaries() {
        use crate::align_block::{
            AlignDensity as Density, AnchorWord, BilingualPlanInput, PlanOutcome, plan_sentence,
        };
        let doc = sg9_doc(SG9_R1);
        let cues = derive_cues(&doc, &crate::layout_profile::cue_params_for_doc(&doc));
        let keys: Vec<Option<String>> = (0..doc.words.len())
            .map(|index| {
                cues.iter()
                    .find(|cue| cue.word_indices.contains(&index))
                    .map(|cue| cue.id.clone())
            })
            .collect();
        assert_eq!(covered_source_rows(&keys, 0, keys.len() - 1), 4);
        let words: Vec<AnchorWord> = doc
            .words
            .iter()
            .map(|word| AnchorWord {
                id: word.id.clone(),
                text: word.text.clone(),
                t0: word.t0,
                t1: word.t1,
                glue: false,
            })
            .collect();
        // c0002 的 7 个块（0-based 序号，与 `sg9_c0002_answer` 的 1-based 一致）。
        let chunks: Vec<AlignChunk> = [
            (0..=0, "但"),
            (1..=5, "如果你是科学家，"),
            (6..=9, "就愿"),
            (10..=14, "迎接挑战，"),
            (15..=17, "解决"),
            (20..=24, "沿途"),
            (18..=19, "难题。"),
        ]
        .into_iter()
        .map(|(ordinals, text)| AlignChunk {
            text: text.to_owned(),
            ordinals: ordinals.collect(),
        })
        .collect();
        let edges = crate::filepipe::align_edges::chunks_to_edges(&chunks, SG9_R1);
        let mut input = BilingualPlanInput::new(words, SG9_R1, "fr", "zh-Hans");
        input.density = Density::Paired;
        let pieces = |input: &BilingualPlanInput| match plan_sentence(&edges, input) {
            PlanOutcome::Aligned(entry) => entry
                .pieces
                .iter()
                .map(|piece| (piece.from.unwrap(), piece.to.unwrap()))
                .collect::<Vec<_>>(),
            other => panic!("{other:?}"),
        };
        // 不知道源行时只看宽度 fit：7 个块被 DP 压成两片，第二片 5.38s、跨 3 条
        // 源行——正是用户项目里 c0002 被拒的形态。
        let blind = pieces(&input);
        assert_eq!(blind, [(0, 5), (6, 24)]);
        input.source_cue_keys = keys.clone();
        let aware = pieces(&input);
        assert!(aware.len() >= 3, "{aware:?}");
        for &(from, to) in &aware {
            let dwell = doc.words[to].t1 - doc.words[from].t0;
            assert!(
                !row_dwell_deficit(dwell, covered_source_rows(&keys, from, to)),
                "{aware:?}"
            );
        }
    }

    #[test]
    fn sg9_paired_edges_round_repairs_the_stuck_row() {
        let mut doc = sg9_with_entry(SG9_R1, sg9_rows_entry);
        let before = sg9_stats(&doc);
        assert_eq!(
            before[0].reason,
            Some(RowDeficitReason::Dwell),
            "{before:?}"
        );
        let mut llm = file_llm([sg9_c0002_answer()]);
        let outcome = run_align(
            &mut doc,
            &mut llm,
            &sg9_paired_options(AlignCarrier::Edges),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.calls.len(), 1);
        assert_eq!(outcome.row_repair.repaired, 1, "{outcome:#?}");
        assert_eq!(outcome.row_repair.rejected, 0, "{outcome:#?}");
        let entry = &doc.trans_align["zh-Hans"]["s-g9.0"];
        assert!(entry.pieces.len() >= 3, "{entry:?}");
        sg9_assert_no_deficit(&doc);
    }

    #[test]
    fn sg9_paired_accepts_a_deficit_free_answer_below_the_hinted_count() {
        // 第 2 轮形态：3 行，少于提示的 4 块，但没有任何一行黏结 ⇒ 接受。
        let mut doc = sg9_with_entry(SG9_R1, sg9_rows_entry);
        let answer = ttable(&[tgroup(
            "s-g9.0",
            "",
            &[
                ("Mais si vous êtes un scientifique,", "但如果你是科学家，"),
                ("vous êtes prêt à faire face à ce défi", "就愿迎接挑战，"),
                (
                    "et à résoudre les problèmes qui viennent avec le chemin.",
                    "解决沿途难题。",
                ),
            ],
        )]);
        let mut llm = file_llm([answer]);
        let outcome = run_align(
            &mut doc,
            &mut llm,
            &sg9_paired_options(AlignCarrier::Table),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(outcome.row_repair.repaired, 1, "{outcome:#?}");
        assert!(outcome.row_repair.rejections.is_empty(), "{outcome:#?}");
        assert_eq!(doc.trans_align["zh-Hans"]["s-g9.0"].pieces.len(), 3);
        sg9_assert_no_deficit(&doc);
    }

    #[test]
    fn sg9_paired_accepts_a_strictly_better_partial_fix_with_a_warning() {
        // 原状：整句一片（7.56s、4 条源行）。新答案两行，第二行仍黏结但更短、
        // 覆盖更少源行 ⇒ 接受并保留告警。
        let whole = |doc: &TranscriptDoc| {
            TransAlign::new(
                AlignMode::ManyToOne,
                doc.words.iter().map(|word| word.id.clone()).collect(),
                vec![TransPiece {
                    from: Some(0),
                    to: Some(24),
                    text: SG9_R1.to_owned(),
                }],
            )
        };
        let mut doc = sg9_with_entry(SG9_R1, whole);
        let answer = ttable(&[tgroup(
            "s-g9.0",
            "",
            &[
                ("Mais si vous êtes un scientifique,", "但如果你是科学家，"),
                (
                    "vous êtes prêt à faire face à ce défi et à résoudre les problèmes qui viennent avec le chemin.",
                    "就愿迎接挑战，解决沿途难题。",
                ),
            ],
        )]);
        let mut llm = file_llm([answer]);
        let outcome = run_align(
            &mut doc,
            &mut llm,
            &sg9_paired_options(AlignCarrier::Table),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(outcome.row_repair.repaired, 1, "{outcome:#?}");
        assert!(
            outcome
                .violations
                .iter()
                .any(|line| line.starts_with("s-g9.0: paired row repair accepted a partial fix")),
            "{:?}",
            outcome.violations
        );
        assert_eq!(doc.trans_align["zh-Hans"]["s-g9.0"].pieces.len(), 2);
        assert_eq!(sg9_stats(&doc)[0].reason, Some(RowDeficitReason::Dwell));
    }

    /// 修复调用整批失败（可重试错误、预算 0）⇒ 预算尾巴只剩模型缺席的等宽切。
    /// 原条目是模型给的 ⇒ 保留原状（`model-free`），哪怕等宽切能清掉黏结行；
    /// 原条目本身就是 `deterministic/1` ⇒ 等宽切照常按驻留谓词验收。
    #[test]
    fn sg9_paired_model_free_fallback_never_replaces_a_model_backed_entry() {
        let mut doc = sg9_with_entry(SG9_R1, sg9_rows_entry);
        let previous = doc.trans_align["zh-Hans"]["s-g9.0"].clone();
        let mut llm = FakeLlm::new([Err(LlmError::Malformed("repair batch failed".into()))]);
        let outcome = run_align(
            &mut doc,
            &mut llm,
            &sg9_paired_options(AlignCarrier::Table),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(llm.calls.len(), 1);
        assert_eq!(outcome.row_repair.repaired, 0, "{outcome:#?}");
        assert_eq!(outcome.row_repair.rejected, 1, "{outcome:#?}");
        assert_eq!(outcome.row_repair.rejections[0].reason, "model-free");
        assert_eq!(outcome.fallback_sentences, 0, "{outcome:#?}");
        assert!(
            outcome.violations.iter().any(|line| {
                line.starts_with(
                    "s-g9.0: paired row repair rejected — the repair call did not yield",
                ) && line.contains(
                    "`deterministic/1` split would replace the `llm-rows+anchor/1` alignment",
                )
            }),
            "{:?}",
            outcome.violations
        );
        assert_eq!(doc.trans_align["zh-Hans"]["s-g9.0"], previous);

        // 原条目是模型缺席的等宽切：同一失败换来的新等宽切按驻留谓词验收。
        let deterministic = |doc: &TranscriptDoc| {
            let mut entry = sg9_rows_entry(doc);
            entry.aligner = Some("deterministic/1".to_owned());
            entry
        };
        let mut doc = sg9_with_entry(SG9_R1, deterministic);
        let mut llm = FakeLlm::new([Err(LlmError::Malformed("repair batch failed".into()))]);
        let outcome = run_align(
            &mut doc,
            &mut llm,
            &sg9_paired_options(AlignCarrier::Table),
            &mut |_| {},
        )
        .unwrap();
        assert!(
            outcome
                .row_repair
                .rejections
                .iter()
                .all(|rejection| rejection.reason != "model-free"),
            "{outcome:#?}"
        );
    }

    #[test]
    fn sg9_paired_rejects_an_answer_that_does_not_improve_the_stuck_row() {
        let mut doc = sg9_with_entry(SG9_R1, sg9_rows_entry);
        let previous = doc.trans_align["zh-Hans"]["s-g9.0"].clone();
        let answer = ttable(&[tgroup(
            "s-g9.0",
            "",
            &[
                ("Mais si vous êtes un scientifique,", "但如果你是科学家，"),
                (
                    "vous êtes prêt à faire face à ce défi et à résoudre les problèmes qui viennent avec le chemin.",
                    "就愿迎接挑战，解决沿途难题。",
                ),
            ],
        )]);
        let mut llm = file_llm([answer]);
        let outcome = run_align(
            &mut doc,
            &mut llm,
            &sg9_paired_options(AlignCarrier::Table),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(outcome.row_repair.repaired, 0, "{outcome:#?}");
        assert_eq!(outcome.row_repair.rejections[0].reason, "not-improved");
        assert_eq!(doc.trans_align["zh-Hans"]["s-g9.0"], previous);
    }

    #[test]
    fn sg9_round3_crossing_answer_keeps_the_four_worker_rows() {
        // 第 3 轮：译文已改（旧条目随之失效），worker 交 4 行并自报 crossing。
        // 早先整句降级成一条 28 单位的超 hard 单行；现在 best-effort 保留 4 行。
        const R3: &str = "但如果你是科学家，你就愿意直面挑战；沿途遇到问题，也愿意解决。";
        let mut doc = sg9_with_entry(R3, sg9_rows_entry);
        let answer = ttable(&[tgroup(
            "s-g9.0",
            " data-no-rewrite=\"true\" data-crossing=\"true\"",
            &[
                ("Mais si vous êtes un scientifique,", "但如果你是科学家，"),
                (
                    "vous êtes prêt à faire face à ce défi",
                    "你就愿意直面挑战；",
                ),
                ("et à résoudre les problèmes", "沿途遇到问题，"),
                ("qui viennent avec le chemin.", "也愿意解决。"),
            ],
        )]);
        let mut llm = file_llm([answer]);
        let outcome = run_align(
            &mut doc,
            &mut llm,
            &sg9_paired_options(AlignCarrier::Table),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(outcome.row_repair.repaired, 1, "{outcome:#?}");
        let entry = &doc.trans_align["zh-Hans"]["s-g9.0"];
        assert_ne!(entry.correspondence(), Correspondence::Sentence);
        let texts: Vec<&str> = entry
            .pieces
            .iter()
            .map(|piece| piece.text.as_str())
            .collect();
        assert_eq!(
            texts,
            [
                "但如果你是科学家，",
                "你就愿意直面挑战；",
                "沿途遇到问题，",
                "也愿意解决。"
            ]
        );
        sg9_assert_no_deficit(&doc);
    }
}
