//! 评测指标（对齐块设计 §8 / M5）：SubER 字幕编辑率与对齐结构指标。
//!
//! 纯函数、零 I/O：宿主（`bcut check`、`verify.sh` 的离线评测步骤）负责读
//! 字幕/transcript 并把 [`AlignMetrics`] / [`SuberBreakdown`] 序列化输出。
//!
//! # SubER
//!
//! Wilken et al., *SubER: A Metric for Subtitle Quality*（IWSLT 2022）。本实现
//! 对拍 AppTek 参考实现 `subtitle-edit-rate` 0.4.0（`suber/metrics/suber.py` +
//! `lib_ter.py`，后者是 sacrebleu TER 的改版），逐条复刻其定义：
//!
//! - 词元：每行按空白切词，行末词后接 `<eol>`，块末词后接 `<eob>`（覆盖
//!   `<eol>`）；空行忽略。默认口径（[`suber`]）对每个词做小写并剥去 ASCII
//!   标点与 `…`，剥空则保留原词（纯标点词元仍计数）；不再做任何分词。
//! - 字级口径（[`suber_chars`]）复刻参考实现 `--language zh` 路径：小写、剥去
//!   Unicode 标点（`\p{P}`）、再按 sacrebleu `TokenizerZh` 把每个 CJK 字切成
//!   独立词元、非 CJK 部分走 13a 风格的标点切分。相对参考实现的**已知偏差**：
//!   假名与谚文也逐字切（参考实现对 ja/ko 用 MeCab 分词，Rust 侧不可用）。
//! - TER：Levenshtein（ins/del/sub 各 1）+ tercom 式贪心移位（每次取使编辑
//!   距离下降最多的移位，最长优先、位置靠前优先；移位窗口 ≤ 50、片段 ≤ 10 词、
//!   每个独立分段最多评估 1000 个候选）；对角线束宽 100 与参考实现相同。
//! - SubER 约束：只有所属块时窗重叠的词才允许匹配/替换（`(a.start < b.end)
//!   == (b.start < a.end)`，与参考实现同式）；换行词元只与换行词元对齐。
//! - 归一化：编辑数 / 参考词元数（含换行词元）× 100；参考为空时有编辑记
//!   100、无编辑记 0。参考实现在输出时四舍五入到 3 位小数，这里返回原值。
//! - 与参考实现相同，先按"两侧都无字幕"的时间点把文档切成独立分段再算，
//!   分段不改变分数但显著缩短序列；参考实现的行缓存（只影响速度）未复刻。
//! - 输入块按起始时间稳定排序（参考实现对乱序 SRT 直接报错）；不剥 `<i>` 等
//!   标签，调用方应传纯文本。
//!
//! # 对齐结构指标
//!
//! [`align_metrics`] 直接读取持久化的 [`TransAlign`] 覆盖层；对齐边不落盘，
//! 因此覆盖率以"源词/译文字符是否落在某个 `blocks[]` 块内"近似（无块 = 0）。
//! 各口径见 [`AlignMetrics`] 字段说明。

use std::collections::{BTreeSet, HashMap};
use std::sync::OnceLock;

use regex::Regex;
use serde::{Deserialize, Serialize};
use unicode_general_category::{GeneralCategory, get_general_category};

use crate::atomize::{atomize, seam_backed_by_whitespace};
use crate::cue::derive_cues;
use crate::doc::{AlignMode, Correspondence, TextBasis, TransAlign, TranscriptDoc};
use crate::engines::align::{RowDeficitStats, row_deficit_stats};
use crate::seam::{ends_clause_punct, ends_sentence_final};
use crate::sentence::derive_sentences;

// ---------------------------------------------------------------------------
// SubER
// ---------------------------------------------------------------------------

/// 行末换行词元（MuST-Cinema 记法）。
pub const END_OF_LINE_SYMBOL: &str = "<eol>";
/// 块末换行词元。
pub const END_OF_BLOCK_SYMBOL: &str = "<eob>";

const COST_INS: i64 = 1;
const COST_DEL: i64 = 1;
const COST_SUB: i64 = 1;
/// tercom 限制：单次移位片段最长词数 / 最远移位距离 / 编辑距离束宽。
const MAX_SHIFT_SIZE: usize = 10;
const MAX_SHIFT_DIST: usize = 50;
const BEAM_WIDTH: usize = 100;
/// 参考实现自加的限制：每个独立分段最多评估这么多移位候选。
const MAX_SHIFT_CANDIDATES: usize = 1000;
const INT_INFINITY: i64 = 10_000_000_000_000_000;

/// 一条字幕块：时窗 + 若干显示行。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubtitleBlock {
    pub start: f64,
    pub end: f64,
    pub lines: Vec<String>,
}

/// SubER 词元口径。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SuberTokenization {
    /// 空白切词（参考实现默认路径）。
    Words,
    /// CJK 逐字（参考实现 `--language zh` 路径，见模块文档）。
    Chars,
}

/// SubER 编辑操作分解。方向沿用参考实现的统计口径：参考 → 假设，即假设里
/// 多出来的词元记 insertion、缺失记 deletion。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuberBreakdown {
    /// SubER 百分数（未四舍五入）。
    pub score: f64,
    /// 总编辑数 = 移位 + 词/换行的插入、删除、替换。
    pub edits: usize,
    /// 参考词元总数（词 + 换行）。
    pub reference_tokens: usize,
    pub reference_words: usize,
    pub reference_breaks: usize,
    pub shifts: usize,
    pub word_insertions: usize,
    pub word_deletions: usize,
    pub word_substitutions: usize,
    pub break_insertions: usize,
    pub break_deletions: usize,
    pub break_substitutions: usize,
}

/// 词级 SubER 百分数。
pub fn suber(hyp: &[SubtitleBlock], reference: &[SubtitleBlock]) -> f64 {
    suber_breakdown(hyp, reference, SuberTokenization::Words).score
}

/// 字级 SubER 百分数（zh/ja 等 CJK 目标语）。
pub fn suber_chars(hyp: &[SubtitleBlock], reference: &[SubtitleBlock]) -> f64 {
    suber_breakdown(hyp, reference, SuberTokenization::Chars).score
}

/// SubER 分数与逐类编辑计数。
pub fn suber_breakdown(
    hyp: &[SubtitleBlock],
    reference: &[SubtitleBlock],
    tokenization: SuberTokenization,
) -> SuberBreakdown {
    let mut interner = Interner::default();
    let hyp_blocks = tokenize_blocks(hyp, tokenization, &mut interner);
    let ref_blocks = tokenize_blocks(reference, tokenization, &mut interner);
    let mut stats = SuberBreakdown::default();
    let mut total_edits = 0usize;
    let mut total_reference = 0usize;
    for (hyp_part, ref_part) in independent_parts(&hyp_blocks, &ref_blocks) {
        let hyp_tokens: Vec<Tok> = hyp_part
            .iter()
            .flat_map(|&index| hyp_blocks[index].tokens.iter().copied())
            .collect();
        let ref_tokens: Vec<Tok> = ref_part
            .iter()
            .flat_map(|&index| ref_blocks[index].tokens.iter().copied())
            .collect();
        let (edits, reference_len) = translation_edit_rate(&hyp_tokens, &ref_tokens, &mut stats);
        total_edits += edits;
        total_reference += reference_len;
    }
    stats.edits = total_edits;
    stats.reference_tokens = total_reference;
    stats.score = if total_reference > 0 {
        total_edits as f64 / total_reference as f64 * 100.0
    } else if total_edits == 0 {
        0.0
    } else {
        100.0
    };
    stats
}

/// 词元：字符串驻留后按符号 id 比较；换行词元单独标记。
#[derive(Debug, Clone, Copy, PartialEq)]
struct Tok {
    sym: u32,
    is_break: bool,
    start: f64,
    end: f64,
}

#[derive(Default)]
struct Interner {
    symbols: HashMap<String, u32>,
}

impl Interner {
    fn intern(&mut self, text: &str) -> u32 {
        if let Some(&id) = self.symbols.get(text) {
            return id;
        }
        let id = self.symbols.len() as u32;
        self.symbols.insert(text.to_owned(), id);
        id
    }
}

struct TokBlock {
    start: f64,
    end: f64,
    tokens: Vec<Tok>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LineBreak {
    None,
    EndOfLine,
    EndOfBlock,
}

/// 块 → 词元序列：切词、挂换行、规范化、（字级）再切分、换行展开成词元。
fn tokenize_blocks(
    blocks: &[SubtitleBlock],
    tokenization: SuberTokenization,
    interner: &mut Interner,
) -> Vec<TokBlock> {
    let mut sorted: Vec<&SubtitleBlock> = blocks.iter().collect();
    sorted.sort_by(|a, b| a.start.total_cmp(&b.start));
    sorted
        .into_iter()
        .map(|block| {
            let mut words: Vec<(String, LineBreak)> = Vec::new();
            for line in &block.lines {
                let line_start = words.len();
                words.extend(
                    line.split_whitespace()
                        .map(|word| (word.to_owned(), LineBreak::None)),
                );
                if words.len() > line_start {
                    words.last_mut().expect("non-empty").1 = LineBreak::EndOfLine;
                }
            }
            if let Some(last) = words.last_mut() {
                last.1 = LineBreak::EndOfBlock;
            }
            let mut tokens = Vec::with_capacity(words.len() * 2);
            for (word, line_break) in words {
                let normalized = match tokenization {
                    SuberTokenization::Words => normalize_word_ascii(&word),
                    SuberTokenization::Chars => normalize_word_unicode(&word),
                };
                let pieces = match tokenization {
                    SuberTokenization::Words => vec![normalized],
                    SuberTokenization::Chars => tokenize_zh(&normalized),
                };
                let last_index = pieces.len().saturating_sub(1);
                for (index, piece) in pieces.into_iter().enumerate() {
                    tokens.push(Tok {
                        sym: interner.intern(&piece),
                        is_break: piece == END_OF_LINE_SYMBOL || piece == END_OF_BLOCK_SYMBOL,
                        start: block.start,
                        end: block.end,
                    });
                    if index == last_index && line_break != LineBreak::None {
                        let symbol = if line_break == LineBreak::EndOfLine {
                            END_OF_LINE_SYMBOL
                        } else {
                            END_OF_BLOCK_SYMBOL
                        };
                        tokens.push(Tok {
                            sym: interner.intern(symbol),
                            is_break: true,
                            start: block.start,
                            end: block.end,
                        });
                    }
                }
            }
            TokBlock {
                start: block.start,
                end: block.end,
                tokens,
            }
        })
        .collect()
}

/// Python `string.punctuation`。
const ASCII_PUNCTUATION: &str = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

/// 默认口径的词规范化：小写、剥 ASCII 标点与 `…`；剥空则保留（小写）原词。
fn normalize_word_ascii(word: &str) -> String {
    let lowered = word.to_lowercase();
    let stripped: String = lowered
        .chars()
        .filter(|ch| !ASCII_PUNCTUATION.contains(*ch) && *ch != '…')
        .collect();
    if stripped.is_empty() {
        lowered
    } else {
        stripped
    }
}

/// 字级口径的词规范化：小写、剥 Unicode 标点（`\p{P}`）；剥空则保留原词。
fn normalize_word_unicode(word: &str) -> String {
    let lowered = word.to_lowercase();
    let stripped: String = lowered
        .chars()
        .filter(|ch| !is_unicode_punctuation(*ch))
        .collect();
    if stripped.is_empty() {
        lowered
    } else {
        stripped
    }
}

fn is_unicode_punctuation(ch: char) -> bool {
    matches!(
        get_general_category(ch),
        GeneralCategory::ConnectorPunctuation
            | GeneralCategory::DashPunctuation
            | GeneralCategory::OpenPunctuation
            | GeneralCategory::ClosePunctuation
            | GeneralCategory::InitialPunctuation
            | GeneralCategory::FinalPunctuation
            | GeneralCategory::OtherPunctuation
    )
}

/// sacrebleu `TokenizerZh` 的"中文字符"区段（含全角区、CJK 标点区等），外加
/// 本实现自扩的假名/谚文区（见模块文档偏差说明）。
///
/// sacrebleu 把两个辅助平面区段写成 `' 0'`/`'⾀0'`（Python 里是
/// `' ' + '0'` 两个字符），字符串比较后实际生效的是 U+2001–U+2A6D 与
/// U+2F81–U+2FA1，而 CJK 扩展 B / 兼容补充区并不逐字切。为与参考实现数值
/// 一致，这里保留该生效区段（覆盖通用标点、箭头、数学符号等；标点已在规范
/// 化时剥去，只影响残留符号），同时补上真正的扩展 B / 兼容补充区。
fn is_char_token(ch: char) -> bool {
    matches!(ch as u32,
        0x3400..=0x4DB5 | 0x4E00..=0x9FA5 | 0x9FA6..=0x9FBB | 0xF900..=0xFA2D
        | 0xFA30..=0xFA6A | 0xFA70..=0xFAD9
        | 0xFF00..=0xFFEF | 0x2E80..=0x2EFF | 0x3000..=0x303F | 0x31C0..=0x31EF
        | 0x2F00..=0x2FDF | 0x2FF0..=0x2FFF | 0x3100..=0x312F | 0x31A0..=0x31BF
        | 0xFE10..=0xFE1F | 0xFE30..=0xFE4F | 0x2600..=0x26FF | 0x2700..=0x27BF
        | 0x3200..=0x32FF | 0x3300..=0x33FF
        // sacrebleu 实际生效的"误写"区段（见函数文档）；U+2F81–U+2FA1 已含于
        // 上面的康熙部首区 U+2F00–U+2FDF，不再重复列出。
        | 0x2001..=0x2A6D
        // 真正的 CJK 扩展 B 与兼容补充区。
        | 0x20000..=0x2A6D6 | 0x2F800..=0x2FA1D
        // 本实现自扩：平假名/片假名/片假名音标扩展、谚文音节。
        | 0x3040..=0x30FF | 0x31F0..=0x31FF | 0xAC00..=0xD7AF)
}

/// sacrebleu `TokenizerZh`：CJK 字两侧补空格，再走 `TokenizerRegexp`
/// （13a 的语言无关部分），最后按空白切分。单个词若只得一个词元则原样保留。
fn tokenize_zh(word: &str) -> Vec<String> {
    let mut spaced = String::with_capacity(word.len() * 2);
    for ch in word.trim().chars() {
        if is_char_token(ch) {
            spaced.push(' ');
            spaced.push(ch);
            spaced.push(' ');
        } else {
            spaced.push(ch);
        }
    }
    let tokens: Vec<String> = tokenizer_regexp(&spaced)
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    if tokens.len() <= 1 {
        vec![word.to_owned()]
    } else {
        tokens
    }
}

/// sacrebleu `TokenizerRegexp`（`13a` / `zh` 的共用后处理）。
fn tokenizer_regexp(line: &str) -> String {
    static RULES: OnceLock<[(Regex, &'static str); 4]> = OnceLock::new();
    let rules = RULES.get_or_init(|| {
        [
            (
                Regex::new(r"([\{-\~\[-\` -\&\(-\+\:-\@/])").expect("valid regex"),
                " $1 ",
            ),
            (
                Regex::new(r"([^0-9])([\.,])").expect("valid regex"),
                "$1 $2 ",
            ),
            (
                Regex::new(r"([\.,])([^0-9])").expect("valid regex"),
                " $1 $2",
            ),
            (Regex::new(r"([0-9])(-)").expect("valid regex"), "$1 $2 "),
        ]
    });
    let mut text = line.to_owned();
    for (rule, replacement) in rules {
        text = rule.replace_all(&text, *replacement).into_owned();
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 参考实现 `_get_independent_parts`：沿时间轴扫描，在"假设与参考都没有字幕"
/// 的时间点切分；返回每个分段的（假设块下标, 参考块下标）。
fn independent_parts(hyp: &[TokBlock], reference: &[TokBlock]) -> Vec<(Vec<usize>, Vec<usize>)> {
    let mut parts = Vec::new();
    let mut hyp_part = Vec::new();
    let mut ref_part = Vec::new();
    let mut hyp_index = 0usize;
    let mut ref_index = 0usize;
    let mut latest = f64::NEG_INFINITY;
    while hyp_index < hyp.len() || ref_index < reference.len() {
        let take_hyp = hyp_index < hyp.len()
            && (ref_index == reference.len() || hyp[hyp_index].start < reference[ref_index].start);
        let block = if take_hyp {
            &hyp[hyp_index]
        } else {
            &reference[ref_index]
        };
        if (!hyp_part.is_empty() || !ref_part.is_empty()) && block.start >= latest {
            parts.push((std::mem::take(&mut hyp_part), std::mem::take(&mut ref_part)));
        }
        if take_hyp {
            hyp_part.push(hyp_index);
            hyp_index += 1;
        } else {
            ref_part.push(ref_index);
            ref_index += 1;
        }
        latest = latest.max(block.end);
    }
    if !hyp_part.is_empty() || !ref_part.is_empty() {
        parts.push((hyp_part, ref_part));
    }
    parts
}

/// SubER 允许对齐：换行词元只与换行词元对齐；且所属块时窗重叠（与参考实现
/// 同式，零长块在同一时刻也视为重叠）。
fn is_allowed_alignment(a: Tok, b: Tok) -> bool {
    if a.is_break != b.is_break {
        return false;
    }
    (a.start < b.end) == (b.start < a.end)
}

fn is_word_match(a: Tok, b: Tok) -> bool {
    a.sym == b.sym && is_allowed_alignment(a, b)
}

/// 编辑距离回溯操作。`HypOnly` / `RefOnly` 对应参考实现翻转后 trace 的
/// `i` / `d`（假设多出的词元 / 参考缺失的词元）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    Keep,
    Sub,
    HypOnly,
    RefOnly,
    Undef,
}

/// 单个独立分段的 TER：贪心移位直到不再降低编辑距离，返回（编辑数, 参考长度）
/// 并把逐类计数累加进 `stats`。
fn translation_edit_rate(
    hyp: &[Tok],
    reference: &[Tok],
    stats: &mut SuberBreakdown,
) -> (usize, usize) {
    if reference.is_empty() {
        let trace = vec![Op::HypOnly; hyp.len()];
        collect_stats(&trace, reference, hyp, 0, stats);
        return (hyp.len(), 0);
    }
    let mut shifts = 0usize;
    let mut checked = 0usize;
    let mut current: Vec<Tok> = hyp.to_vec();
    loop {
        let (delta, shifted) = best_shift(&current, reference, &mut checked);
        if checked >= MAX_SHIFT_CANDIDATES {
            break;
        }
        if delta <= 0 {
            break;
        }
        shifts += 1;
        current = shifted;
    }
    let (distance, trace) = edit_distance(&current, reference);
    collect_stats(&trace, reference, &current, shifts, stats);
    (shifts + distance as usize, reference.len())
}

fn collect_stats(
    trace: &[Op],
    reference: &[Tok],
    hyp: &[Tok],
    shifts: usize,
    stats: &mut SuberBreakdown,
) {
    let mut ref_pos = 0usize;
    let mut hyp_pos = 0usize;
    for &op in trace {
        match op {
            Op::HypOnly => {
                if hyp[hyp_pos].is_break {
                    stats.break_insertions += 1;
                } else {
                    stats.word_insertions += 1;
                }
                hyp_pos += 1;
            }
            _ => {
                let is_break = reference[ref_pos].is_break;
                if is_break {
                    stats.reference_breaks += 1;
                } else {
                    stats.reference_words += 1;
                }
                match op {
                    Op::RefOnly => {
                        if is_break {
                            stats.break_deletions += 1;
                        } else {
                            stats.word_deletions += 1;
                        }
                    }
                    Op::Sub => {
                        if is_break {
                            stats.break_substitutions += 1;
                        } else {
                            stats.word_substitutions += 1;
                        }
                        hyp_pos += 1;
                    }
                    _ => hyp_pos += 1,
                }
                ref_pos += 1;
            }
        }
    }
    stats.shifts += shifts;
}

/// 参考实现 `_shift`：枚举 tercom 候选移位，返回（编辑距离下降量, 移位后的假设）。
/// 无候选时下降量为 0 并原样返回。
fn best_shift(hyp: &[Tok], reference: &[Tok], checked: &mut usize) -> (i64, Vec<Tok>) {
    let (pre_score, trace) = edit_distance(hyp, reference);
    let (align, ref_err, hyp_err) = trace_to_alignment(&trace);
    let n_h = hyp.len();
    let n_r = reference.len();
    // (下降量, 长度, -start_h, -idx) 字典序最大者胜出；并列保留先出现者。
    let mut best: Option<((i64, usize, i64, i64), Vec<Tok>)> = None;

    'outer: for start_h in 0..n_h {
        for start_r in 0..n_r {
            if start_r.abs_diff(start_h) > MAX_SHIFT_DIST {
                continue;
            }
            let mut length = 0usize;
            while is_word_match(hyp[start_h + length], reference[start_r + length])
                && length < MAX_SHIFT_SIZE
            {
                length += 1;
                // 候选 (start_h, start_r, length)
                let hyp_wrong = hyp_err[start_h..start_h + length].iter().any(|&e| e);
                let ref_wrong = ref_err[start_r..start_r + length].iter().any(|&e| e);
                let aligned_inside =
                    align[start_r] >= start_h as i64 && align[start_r] < (start_h + length) as i64;
                if hyp_wrong && ref_wrong && !aligned_inside {
                    let mut prev_idx: i64 = -1;
                    for offset in -1..length as i64 {
                        let ref_pos = start_r as i64 + offset;
                        let idx = if ref_pos == -1 {
                            0
                        } else if (ref_pos as usize) < n_r {
                            align[ref_pos as usize] + 1
                        } else {
                            break;
                        };
                        if idx == prev_idx {
                            continue;
                        }
                        prev_idx = idx;
                        let shifted = perform_shift(hyp, start_h, length, idx as usize);
                        debug_assert_eq!(shifted.len(), n_h);
                        let score = pre_score - edit_distance(&shifted, reference).0;
                        *checked += 1;
                        let key = (score, length, -(start_h as i64), -idx);
                        if best.as_ref().is_none_or(|(best_key, _)| key > *best_key) {
                            best = Some((key, shifted));
                        }
                    }
                    // 参考实现只在通过过滤的候选之后检查上限。
                    if *checked >= MAX_SHIFT_CANDIDATES {
                        break 'outer;
                    }
                }
                if n_h == start_h + length || n_r == start_r + length {
                    break;
                }
            }
        }
    }
    match best {
        Some(((score, _, _, _), shifted)) => (score, shifted),
        None => (0, hyp.to_vec()),
    }
}

/// 参考实现 `_perform_shift`：把 `words[start..start+length]` 挪到 `target` 之前。
fn perform_shift(words: &[Tok], start: usize, length: usize, target: usize) -> Vec<Tok> {
    let n = words.len();
    let mut out = Vec::with_capacity(n);
    if target < start {
        out.extend_from_slice(&words[..target]);
        out.extend_from_slice(&words[start..start + length]);
        out.extend_from_slice(&words[target..start]);
        out.extend_from_slice(&words[start + length..]);
    } else if target > start + length {
        out.extend_from_slice(&words[..start]);
        out.extend_from_slice(&words[start + length..target]);
        out.extend_from_slice(&words[start..start + length]);
        out.extend_from_slice(&words[target..]);
    } else {
        let cut = (length + target).min(n);
        out.extend_from_slice(&words[..start]);
        out.extend_from_slice(&words[start + length..cut]);
        out.extend_from_slice(&words[start..start + length]);
        out.extend_from_slice(&words[cut..]);
    }
    out
}

/// trace → （参考位置 → 对齐到的假设位置, 参考错误位, 假设错误位）。
fn trace_to_alignment(trace: &[Op]) -> (Vec<i64>, Vec<bool>, Vec<bool>) {
    let mut pos_hyp: i64 = -1;
    let mut align = Vec::new();
    let mut ref_err = Vec::new();
    let mut hyp_err = Vec::new();
    for &op in trace {
        match op {
            Op::Keep => {
                pos_hyp += 1;
                align.push(pos_hyp);
                hyp_err.push(false);
                ref_err.push(false);
            }
            Op::Sub => {
                pos_hyp += 1;
                align.push(pos_hyp);
                hyp_err.push(true);
                ref_err.push(true);
            }
            Op::HypOnly => {
                pos_hyp += 1;
                hyp_err.push(true);
            }
            Op::RefOnly => {
                align.push(pos_hyp);
                ref_err.push(true);
            }
            Op::Undef => unreachable!("undefined edit operation in trace"),
        }
    }
    (align, ref_err, hyp_err)
}

/// 带束宽的 Levenshtein（参考实现 `BeamEditDistance._edit_distance`，无缓存）：
/// 行 = 假设、列 = 参考；不允许时间不重叠的词替换。返回（距离, trace）。
fn edit_distance(hyp: &[Tok], reference: &[Tok]) -> (i64, Vec<Op>) {
    let n_h = hyp.len();
    let n_r = reference.len();
    let width = n_r + 1;
    let mut cost = vec![INT_INFINITY; (n_h + 1) * width];
    let mut ops = vec![Op::Undef; (n_h + 1) * width];
    for j in 0..=n_r {
        cost[j] = j as i64 * COST_INS;
        ops[j] = Op::RefOnly;
    }
    let length_ratio = if n_h > 0 {
        n_r as f64 / n_h as f64
    } else {
        1.0
    };
    let beam_width: i64 = if (BEAM_WIDTH as f64) < length_ratio / 2.0 {
        (length_ratio / 2.0 + BEAM_WIDTH as f64).ceil() as i64
    } else {
        BEAM_WIDTH as i64
    };
    for i in 1..=n_h {
        let pseudo_diag = (i as f64 * length_ratio).floor() as i64;
        let min_j = (pseudo_diag - beam_width).max(0) as usize;
        let mut max_j = ((pseudo_diag + beam_width).max(0) as usize).min(n_r + 1);
        if i == n_h {
            max_j = n_r + 1;
        }
        for j in min_j..max_j {
            let index = i * width + j;
            if j == 0 {
                cost[index] = cost[index - width] + COST_DEL;
                ops[index] = Op::HypOnly;
                continue;
            }
            let (sub_cost, sub_op) = if is_word_match(hyp[i - 1], reference[j - 1]) {
                (0, Op::Keep)
            } else if is_allowed_alignment(hyp[i - 1], reference[j - 1]) {
                (COST_SUB, Op::Sub)
            } else {
                (INT_INFINITY, Op::Sub)
            };
            // tercom 偏好：匹配/替换 > 假设多词 > 参考多词（严格小于才更新）。
            let candidates = [
                (cost[index - width - 1] + sub_cost, sub_op),
                (cost[index - width] + COST_DEL, Op::HypOnly),
                (cost[index - 1] + COST_INS, Op::RefOnly),
            ];
            for (candidate_cost, op) in candidates {
                if cost[index] > candidate_cost {
                    cost[index] = candidate_cost;
                    ops[index] = op;
                }
            }
        }
    }
    let mut trace = Vec::with_capacity(n_h + n_r);
    let (mut i, mut j) = (n_h, n_r);
    while i > 0 || j > 0 {
        let op = match ops[i * width + j] {
            // 束外单元格理论上不会出现在回溯路径上；兜底选一个能推进的操作。
            Op::Undef => {
                if i > 0 {
                    Op::HypOnly
                } else {
                    Op::RefOnly
                }
            }
            op => op,
        };
        trace.push(op);
        match op {
            Op::Keep | Op::Sub => {
                i -= 1;
                j -= 1;
            }
            Op::RefOnly => j -= 1,
            Op::HypOnly | Op::Undef => i -= 1,
        }
    }
    trace.reverse();
    (cost[n_h * width + n_r], trace)
}

// ---------------------------------------------------------------------------
// 对齐结构指标（设计 §8）
// ---------------------------------------------------------------------------

/// 逐句对齐明细。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceAlignMetrics {
    /// 句 id（`s-<首词id>`）。
    pub id: String,
    /// 该语言下是否存在 `transAlign` 条目。
    pub aligned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<AlignMode>,
    /// 生效对应粒度（[`TransAlign::correspondence`]）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correspondence: Option<Correspondence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_basis: Option<TextBasis>,
    /// 源词数：条目 `words` 非空取其长度，否则取句内词数。
    pub source_words: usize,
    /// `concat(pieces.text)` 字符数。
    pub target_chars: usize,
    pub blocks: usize,
    pub local_reorder_blocks: usize,
    pub weak_blocks: usize,
    /// 落在某个块 `src` 区间内的源词数（无块 = 0）。
    pub covered_source_words: usize,
    /// 落在某个块 `tgt` 区间内的译文字符数（无块 = 0）。
    pub covered_target_chars: usize,
    /// 块间边界数 = `blocks - 1`（有块时）。
    pub block_boundaries: usize,
    /// 落在块内部（非块边界）的目标语候选合法缝数：片文本原子边界中原文有
    /// 空白背书、或前一原子以从句/句末标点收尾者。
    pub inner_candidate_seams: usize,
    /// 条目的 `aligner` 来源串（`TransAlign::aligner`），供评分器口径与
    /// `align-scorer-stale` 使用。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aligner: Option<String>,
    /// 该句按源 Cue 分段并吸收 ≤2 词碎段后，实际可见的源子行数。
    pub source_rows: usize,
    /// 该句当前派生出的译文 Cue 数。
    pub trans_cues: usize,
    /// 该句最长译文 Cue 的驻留秒数。
    pub max_dwell_sec: f64,
}

/// 按语言汇总的对齐结构指标（设计 §8）。所有比率的分母为 0 时记 0。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignMetrics {
    /// 目标语言键。
    pub lang: String,
    /// 当前派生的句数。
    pub sentences: usize,
    /// 有 `transAlign` 条目的句数。
    pub aligned: usize,
    /// `transAlign[lang]` 中不对应任何当前句的条目数（陈旧残留）。
    pub orphan_entries: usize,
    /// `align-coverage`（源侧）：manyToOne 条目里落在某个块内的源词占比；
    /// 无块条目按 0 覆盖计入分母。
    pub coverage_src: f64,
    /// `align-coverage`（目标侧）：manyToOne 条目里落在某个块内的译文字符占比。
    pub coverage_tgt: f64,
    /// `align-crossing-rate`：含 `local-reorder` 块的句占已对齐句的比例。
    pub crossing_rate: f64,
    /// `local-reorder` 块总数。
    pub local_reorder_blocks: usize,
    /// `align-safe-boundary-ratio`：块边界数 / (块边界数 + 块内部候选合法缝数)，
    /// 只统计有块的条目。
    pub safe_boundary_ratio: f64,
    /// `align-sentence-degrade-rate`：manyToOne 条目中 `correspondence == sentence`
    /// 的占比（持久层不区分降级原因；`independent` 单独见 `independent_rate`）。
    pub sentence_degrade_rate: f64,
    /// `align-rewrite-rate`：`textBasis == display` 的条目占已对齐句的比例。
    pub rewrite_rate: f64,
    /// `mode == independent` 的条目占已对齐句的比例。
    pub independent_rate: f64,
    /// 带 `weak` 标记的块占全部块的比例。
    pub weak_block_rate: f64,
    /// `align-row-deficit` 命中句 / 已翻译句。
    pub row_deficit_rate: f64,
    pub per_sentence: Vec<SentenceAlignMetrics>,
}

/// 计算 `lang` 的对齐结构指标：句由 [`derive_sentences`] 现场派生（源 Cue 不
/// 参与），逐句查 `doc.trans_align[lang]`。
pub fn align_metrics(doc: &TranscriptDoc, lang: &str) -> AlignMetrics {
    let source_cues = derive_cues(doc, &crate::layout_profile::cue_params_for_doc(doc));
    let sentences = derive_sentences(doc, &source_cues);
    let trans_cues = crate::split::derive_trans_cues(doc, &sentences, lang);
    let row_stats = row_deficit_stats(doc, &sentences, lang, &source_cues, &trans_cues)
        .into_iter()
        .map(|stats| (stats.sentence.clone(), stats))
        .collect::<std::collections::BTreeMap<_, _>>();
    let entries = doc.trans_align.get(lang);
    let mut per_sentence = Vec::with_capacity(sentences.len());
    let mut seen_ids = BTreeSet::new();
    for sentence in &sentences {
        seen_ids.insert(sentence.id.as_str());
        let entry = entries.and_then(|table| table.get(&sentence.id));
        per_sentence.push(sentence_align_metrics(
            &sentence.id,
            sentence.word_indices.len(),
            entry,
            row_stats.get(&sentence.id),
        ));
    }
    let orphan_entries = entries
        .map(|table| {
            table
                .keys()
                .filter(|id| !seen_ids.contains(id.as_str()))
                .count()
        })
        .unwrap_or(0);

    let ratio = |numerator: usize, denominator: usize| -> f64 {
        if denominator == 0 {
            0.0
        } else {
            numerator as f64 / denominator as f64
        }
    };
    let aligned_rows: Vec<&SentenceAlignMetrics> =
        per_sentence.iter().filter(|row| row.aligned).collect();
    let aligned = aligned_rows.len();
    let many_to_one: Vec<&SentenceAlignMetrics> = aligned_rows
        .iter()
        .copied()
        .filter(|row| row.mode == Some(AlignMode::ManyToOne))
        .collect();
    let (src_total, src_covered, tgt_total, tgt_covered) =
        many_to_one
            .iter()
            .fold((0usize, 0usize, 0usize, 0usize), |(st, sc, tt, tc), row| {
                (
                    st + row.source_words,
                    sc + row.covered_source_words,
                    tt + row.target_chars,
                    tc + row.covered_target_chars,
                )
            });
    let crossing_sentences = aligned_rows
        .iter()
        .filter(|row| row.local_reorder_blocks > 0)
        .count();
    let local_reorder_blocks: usize = aligned_rows
        .iter()
        .map(|row| row.local_reorder_blocks)
        .sum();
    let boundaries: usize = aligned_rows.iter().map(|row| row.block_boundaries).sum();
    let inner_seams: usize = aligned_rows
        .iter()
        .filter(|row| row.blocks > 0)
        .map(|row| row.inner_candidate_seams)
        .sum();
    let degraded = many_to_one
        .iter()
        .filter(|row| row.correspondence == Some(Correspondence::Sentence))
        .count();
    let rewritten = aligned_rows
        .iter()
        .filter(|row| row.text_basis == Some(TextBasis::Display))
        .count();
    let independent = aligned_rows
        .iter()
        .filter(|row| row.mode == Some(AlignMode::Independent))
        .count();
    let total_blocks: usize = aligned_rows.iter().map(|row| row.blocks).sum();
    let weak_blocks: usize = aligned_rows.iter().map(|row| row.weak_blocks).sum();
    let translated = row_stats.len();
    let row_deficits = row_stats
        .values()
        .filter(|stats| stats.reason.is_some())
        .count();
    AlignMetrics {
        lang: lang.to_owned(),
        sentences: sentences.len(),
        aligned,
        orphan_entries,
        coverage_src: ratio(src_covered, src_total),
        coverage_tgt: ratio(tgt_covered, tgt_total),
        crossing_rate: ratio(crossing_sentences, aligned),
        local_reorder_blocks,
        safe_boundary_ratio: ratio(boundaries, boundaries + inner_seams),
        sentence_degrade_rate: ratio(degraded, many_to_one.len()),
        rewrite_rate: ratio(rewritten, aligned),
        independent_rate: ratio(independent, aligned),
        weak_block_rate: ratio(weak_blocks, total_blocks),
        row_deficit_rate: ratio(row_deficits, translated),
        per_sentence,
    }
}

fn sentence_align_metrics(
    id: &str,
    sentence_words: usize,
    entry: Option<&TransAlign>,
    row_stats: Option<&RowDeficitStats>,
) -> SentenceAlignMetrics {
    let source_rows = row_stats.map_or(0, |stats| stats.source_rows);
    let trans_cues = row_stats.map_or(0, |stats| stats.trans_cues);
    let max_dwell_sec = row_stats.map_or(0.0, |stats| stats.max_dwell_sec);
    let Some(entry) = entry else {
        return SentenceAlignMetrics {
            id: id.to_owned(),
            aligned: false,
            mode: None,
            correspondence: None,
            text_basis: None,
            source_words: sentence_words,
            target_chars: 0,
            blocks: 0,
            local_reorder_blocks: 0,
            weak_blocks: 0,
            covered_source_words: 0,
            covered_target_chars: 0,
            block_boundaries: 0,
            inner_candidate_seams: 0,
            aligner: None,
            source_rows,
            trans_cues,
            max_dwell_sec,
        };
    };
    let source_words = if entry.words.is_empty() {
        sentence_words
    } else {
        entry.words.len()
    };
    let piece_lens: Vec<usize> = entry
        .pieces
        .iter()
        .map(|piece| piece.text.chars().count())
        .collect();
    let target_chars: usize = piece_lens.iter().sum();

    let mut covered_source_words = 0usize;
    let mut covered_target_chars = 0usize;
    let mut boundaries = BTreeSet::new();
    if !entry.blocks.is_empty() {
        let mut src_covered = vec![false; source_words];
        let mut tgt_covered = vec![false; target_chars];
        for block in &entry.blocks {
            let (from, to) = block.src;
            for slot in src_covered.iter_mut().take(to + 1).skip(from) {
                *slot = true;
            }
            let (start, end) = block.tgt;
            for slot in tgt_covered.iter_mut().take(end).skip(start) {
                *slot = true;
            }
        }
        covered_source_words = src_covered.iter().filter(|&&covered| covered).count();
        covered_target_chars = tgt_covered.iter().filter(|&&covered| covered).count();
        for block in &entry.blocks[..entry.blocks.len() - 1] {
            boundaries.insert(block.tgt.1);
        }
    }

    // 候选合法缝：逐片原子化，缝位置换算到 concat(pieces.text) 字符下标。
    let mut inner_candidate_seams = 0usize;
    let mut offset = 0usize;
    for (piece, &len) in entry.pieces.iter().zip(&piece_lens) {
        let atoms = atomize(&piece.text);
        let starts = atom_char_starts(&piece.text, &atoms);
        for cut in 1..atoms.len() {
            let previous = &atoms[cut - 1];
            let legal = seam_backed_by_whitespace(&piece.text, &atoms, cut)
                || ends_clause_punct(previous)
                || ends_sentence_final(previous);
            if !legal {
                continue;
            }
            let pos = offset + starts[cut];
            if !boundaries.contains(&pos) {
                inner_candidate_seams += 1;
            }
        }
        offset += len;
    }

    SentenceAlignMetrics {
        id: id.to_owned(),
        aligned: true,
        mode: Some(entry.mode),
        correspondence: Some(entry.correspondence()),
        text_basis: Some(entry.text_basis),
        source_words,
        target_chars,
        blocks: entry.blocks.len(),
        local_reorder_blocks: entry
            .blocks
            .iter()
            .filter(|block| block.flags.iter().any(|flag| flag == "local-reorder"))
            .count(),
        weak_blocks: entry
            .blocks
            .iter()
            .filter(|block| block.flags.iter().any(|flag| flag == "weak"))
            .count(),
        covered_source_words,
        covered_target_chars,
        block_boundaries: boundaries.len(),
        inner_candidate_seams,
        aligner: entry.aligner.clone(),
        source_rows,
        trans_cues,
        max_dwell_sec,
    }
}

// ---------------------------------------------------------------------------
// Golden 对拍指标（语义评分器方案 §11.3；strict / lax 两口径）
// ---------------------------------------------------------------------------

/// 一个 bead：源词下标半开区间 ↔ 目标 `chars()` 半开区间。
///
/// 与 Vecalign / Bertalign 的 bead 同义，只是这里的单位是"句内词"与"译文
/// 字符"而不是文档内的句。golden 与预测两侧都必须是**连续全覆盖且单调**的
/// 划分（[`beads_contiguous`] 可自检）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bead {
    pub src: std::ops::Range<usize>,
    pub tgt: std::ops::Range<usize>,
}

impl Bead {
    pub fn new(src: std::ops::Range<usize>, tgt: std::ops::Range<usize>) -> Self {
        Self { src, tgt }
    }

    fn is_empty(&self) -> bool {
        self.src.start >= self.src.end || self.tgt.start >= self.tgt.end
    }

    fn overlaps(&self, other: &Bead) -> bool {
        self.src.start < other.src.end
            && other.src.start < self.src.end
            && self.tgt.start < other.tgt.end
            && other.tgt.start < self.tgt.end
    }
}

/// Bead 匹配口径（设计 §11.3 / §16.2 采纳 Vecalign 的两口径）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BeadMatch {
    /// 严格：两侧区间与某个对照 bead **完全相等**才算命中。
    Strict,
    /// 宽松：与某个对照 bead 在源侧、目标侧**都有非空交集**即算命中。
    Lax,
}

/// 精确率 / 召回率 / F1 及其计数。分母为 0 时：两侧皆空记 1.0，否则记 0.0。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prf {
    pub precision: f64,
    pub recall: f64,
    pub f1: f64,
    /// 预测侧命中数（精确率分子）。
    pub matched_predicted: usize,
    /// golden 侧命中数（召回率分子）。
    pub matched_golden: usize,
    /// 参与统计的预测项数（精确率分母）。
    pub predicted: usize,
    /// 参与统计的 golden 项数（召回率分母）。
    pub golden: usize,
}

impl Prf {
    fn new(
        matched_predicted: usize,
        predicted: usize,
        matched_golden: usize,
        golden: usize,
    ) -> Self {
        let rate = |numerator: usize, denominator: usize, other: usize| -> f64 {
            if denominator > 0 {
                numerator as f64 / denominator as f64
            } else if other == 0 {
                1.0
            } else {
                0.0
            }
        };
        let precision = rate(matched_predicted, predicted, golden);
        let recall = rate(matched_golden, golden, predicted);
        let f1 = if precision + recall > 0.0 {
            2.0 * precision * recall / (precision + recall)
        } else {
            0.0
        };
        Self {
            precision,
            recall,
            f1,
            matched_predicted,
            matched_golden,
            predicted,
            golden,
        }
    }
}

/// 单侧命中数：`probe` 里有多少项按 `mode` 能在 `against` 里找到对应。
fn bead_hits(probe: &[Bead], against: &[Bead], mode: BeadMatch) -> usize {
    probe
        .iter()
        .filter(|bead| !bead.is_empty())
        .filter(|bead| match mode {
            BeadMatch::Strict => against.iter().any(|other| *bead == other),
            BeadMatch::Lax => against.iter().any(|other| bead.overlaps(other)),
        })
        .count()
}

/// Bead P/R/F1（设计 §11.3）。
///
/// - `Strict`：预测 bead 与 golden bead 两侧区间完全一致才计命中——即
///   Vecalign / Bertalign 的 strict 口径。
/// - `Lax`：只要两侧都有交集就计命中（局部切分粒度不同但对应关系正确时
///   仍得分）。
///
/// 空 bead（任一侧区间为空）两侧都不参与统计。精确率以预测为分母、召回率
/// 以 golden 为分母，各自独立判定（与参考实现相同，lax 下两者不必相等）。
pub fn bead_prf(golden: &[Bead], predicted: &[Bead], mode: BeadMatch) -> Prf {
    let predicted_total = predicted.iter().filter(|bead| !bead.is_empty()).count();
    let golden_total = golden.iter().filter(|bead| !bead.is_empty()).count();
    Prf::new(
        bead_hits(predicted, golden, mode),
        predicted_total,
        bead_hits(golden, predicted, mode),
        golden_total,
    )
}

/// Boundary F1（设计 §11.3）：边界位置集合的精确率 / 召回率 / F1。
///
/// 源侧传源词下标、目标侧传目标字符下标；重复值先去重，两端的平凡边界
/// （0 与全长）由调用方决定是否传入——[`beads_boundaries`] 默认不含它们。
pub fn boundary_f1(golden_boundaries: &[usize], predicted_boundaries: &[usize]) -> Prf {
    let golden: BTreeSet<usize> = golden_boundaries.iter().copied().collect();
    let predicted: BTreeSet<usize> = predicted_boundaries.iter().copied().collect();
    let hit = golden.intersection(&predicted).count();
    Prf::new(hit, predicted.len(), hit, golden.len())
}

/// Path EM（设计 §11.3）：整条 bead 路径逐项相等。
pub fn path_exact_match(golden: &[Bead], predicted: &[Bead]) -> bool {
    golden == predicted
}

/// bead 序列的内部边界（源侧、目标侧），不含 0 与末端。供 [`boundary_f1`]。
pub fn beads_boundaries(beads: &[Bead]) -> (Vec<usize>, Vec<usize>) {
    let src = beads
        .iter()
        .skip(1)
        .map(|bead| bead.src.start)
        .collect::<Vec<_>>();
    let tgt = beads
        .iter()
        .skip(1)
        .map(|bead| bead.tgt.start)
        .collect::<Vec<_>>();
    (src, tgt)
}

/// bead 序列是否满足"两侧连续全覆盖且单调"：从 0 起逐项衔接，末项分别到
/// `src_len` / `tgt_len`，且每项两侧非空。空序列只在两个长度都为 0 时成立。
pub fn beads_contiguous(beads: &[Bead], src_len: usize, tgt_len: usize) -> bool {
    if beads.is_empty() {
        return src_len == 0 && tgt_len == 0;
    }
    let mut src_cursor = 0usize;
    let mut tgt_cursor = 0usize;
    for bead in beads {
        if bead.src.start != src_cursor || bead.tgt.start != tgt_cursor || bead.is_empty() {
            return false;
        }
        src_cursor = bead.src.end;
        tgt_cursor = bead.tgt.end;
    }
    src_cursor == src_len && tgt_cursor == tgt_len
}

/// 原子 → 在 `text` 里的起始字符下标（[`atomize`] 对非空白字符无损）。返回
/// `atoms.len() + 1` 项，末项 = 文本字符数。
fn atom_char_starts(text: &str, atoms: &[String]) -> Vec<usize> {
    let mut want = Vec::with_capacity(atoms.len());
    let mut acc = 0usize;
    for atom in atoms {
        want.push(acc);
        acc += atom.chars().count();
    }
    let mut starts = Vec::with_capacity(atoms.len() + 1);
    let mut seen = 0usize;
    let mut next = 0usize;
    let mut total = 0usize;
    for (index, ch) in text.chars().enumerate() {
        total = index + 1;
        if ch.is_whitespace() {
            continue;
        }
        while next < want.len() && want[next] == seen {
            starts.push(index);
            next += 1;
        }
        seen += 1;
    }
    while starts.len() < atoms.len() {
        starts.push(total);
    }
    starts.push(total);
    starts
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{AlignBlock, DocEngine, DocMedia, Speaker, TransPiece, Word};
    use serde_json::Value;

    // ----- SubER -----

    fn block(start: f64, end: f64, lines: &[&str]) -> SubtitleBlock {
        SubtitleBlock {
            start,
            end,
            lines: lines.iter().map(|line| (*line).to_owned()).collect(),
        }
    }

    fn reference_en() -> Vec<SubtitleBlock> {
        vec![
            block(0.0, 2.0, &["Hello there,", "how are you?"]),
            block(2.5, 4.0, &["I am fine."]),
            block(4.5, 7.0, &["The plan we discussed", "yesterday is ready."]),
        ]
    }

    #[test]
    fn suber_identical_is_zero_and_pure_substitution_counts_words() {
        let reference = reference_en();
        assert_eq!(suber(&reference, &reference), 0.0);
        let hyp = vec![
            block(0.0, 2.0, &["Hello there,", "how are YOU?"]),
            block(2.5, 4.0, &["I am great."]),
            block(4.5, 7.0, &["The plan we discussed", "today is ready."]),
        ];
        // 20 个参考词元（15 词 + 5 换行）；`YOU?` 规范化后与 `you?` 相同，只剩 2 处替换。
        let breakdown = suber_breakdown(&hyp, &reference, SuberTokenization::Words);
        assert_eq!(breakdown.reference_tokens, 20);
        assert_eq!(breakdown.word_substitutions, 2);
        assert_eq!(breakdown.edits, 2);
        assert!((breakdown.score - 10.0).abs() < 1e-9);
    }

    #[test]
    fn suber_line_break_difference_costs_break_shifts_only() {
        let reference = reference_en();
        let hyp = vec![
            block(0.0, 2.0, &["Hello there, how", "are you?"]),
            block(2.5, 4.0, &["I am fine."]),
            block(4.5, 7.0, &["The plan we", "discussed yesterday is ready."]),
        ];
        let breakdown = suber_breakdown(&hyp, &reference, SuberTokenization::Words);
        assert_eq!(breakdown.shifts, 2);
        assert_eq!(breakdown.edits, 2);
        assert_eq!(
            breakdown.word_substitutions + breakdown.word_insertions + breakdown.word_deletions,
            0
        );
    }

    #[test]
    fn suber_time_shifted_block_without_overlap_cannot_match() {
        let reference = reference_en();
        let mut hyp = reference_en();
        hyp[1].start = 4.0;
        hyp[1].end = 4.4;
        let breakdown = suber_breakdown(&hyp, &reference, SuberTokenization::Words);
        // 中间块（3 词 + `<eob>`）在两侧各算一次：4 删除 + 4 插入。
        assert_eq!(breakdown.word_deletions + breakdown.break_deletions, 4);
        assert_eq!(breakdown.word_insertions + breakdown.break_insertions, 4);
        assert!((breakdown.score - 40.0).abs() < 1e-9);
    }

    #[test]
    fn suber_empty_inputs_follow_reference_conventions() {
        assert_eq!(suber(&[], &[]), 0.0);
        assert_eq!(suber(&[block(0.0, 1.0, &["x y"])], &[]), 100.0);
        assert_eq!(suber(&[], &reference_en()), 100.0);
    }

    #[test]
    fn suber_chars_splits_cjk_and_strips_unicode_punctuation() {
        let reference = vec![block(0.0, 2.0, &["我没去，", "因为我病了。"])];
        let hyp = vec![block(0.0, 2.0, &["我没走", "因为我病了"])];
        let breakdown = suber_breakdown(&hyp, &reference, SuberTokenization::Chars);
        // 8 个字 + 2 个换行；只有「去→走」一处替换。
        assert_eq!(breakdown.reference_tokens, 10);
        assert_eq!(breakdown.word_substitutions, 1);
        assert_eq!(breakdown.edits, 1);
        assert_eq!(
            tokenize_zh("已经ready了3.5天"),
            vec!["已", "经", "ready", "了", "3.5", "天"]
        );
        assert_eq!(tokenize_zh("价格$100"), vec!["价", "格", "$", "100"]);
    }

    /// 与 AppTek 参考实现（subtitle-edit-rate 0.4.0）逐例对拍：手工用例 +
    /// 随机用例，编辑计数逐项相等、分数误差 < 1e-6。
    ///
    /// 缺省只跑 ≤ 6 条字幕的用例（debug 构建下 tercom 位移搜索对 30 条 × 200 词的
    /// 用例要数分钟）；全量对拍见 [`suber_matches_reference_implementation_fixture_full`]
    /// （`cargo test -p bcut-flow-core --release -- --ignored`）。
    #[test]
    fn suber_matches_reference_implementation_fixture() {
        check_suber_fixture(Some(6));
    }

    #[test]
    #[ignore = "全量 102 例含大文档，debug 下耗时数分钟；--release -- --ignored 运行"]
    fn suber_matches_reference_implementation_fixture_full() {
        check_suber_fixture(None);
    }

    fn check_suber_fixture(max_blocks: Option<usize>) {
        let fixture: Value =
            serde_json::from_str(include_str!("../tests/fixtures/align/suber-cases.json")).unwrap();
        let cases = fixture["cases"].as_array().unwrap();
        assert!(cases.len() >= 36);
        let mut checked = 0usize;
        for case in cases {
            if let Some(max_blocks) = max_blocks {
                let blocks = case["hyp"]
                    .as_array()
                    .map_or(0, Vec::len)
                    .max(case["ref"].as_array().map_or(0, Vec::len));
                if blocks > max_blocks {
                    continue;
                }
            }
            checked += 1;
            let name = case["name"].as_str().unwrap();
            let hyp: Vec<SubtitleBlock> = serde_json::from_value(case["hyp"].clone()).unwrap();
            let reference: Vec<SubtitleBlock> =
                serde_json::from_value(case["ref"].clone()).unwrap();
            let tokenization = match case["tokenization"].as_str().unwrap() {
                "words" => SuberTokenization::Words,
                "chars" => SuberTokenization::Chars,
                other => panic!("unknown tokenization {other}"),
            };
            let expected: SuberBreakdown =
                serde_json::from_value(case["expected"].clone()).unwrap();
            let actual = suber_breakdown(&hyp, &reference, tokenization);
            assert!(
                (actual.score - expected.score).abs() < 1e-6,
                "{name}: score {} != {}",
                actual.score,
                expected.score
            );
            let mut actual_counts = actual.clone();
            actual_counts.score = expected.score;
            assert_eq!(actual_counts, expected, "{name}: edit counts differ");
            let plain = match tokenization {
                SuberTokenization::Words => suber(&hyp, &reference),
                SuberTokenization::Chars => suber_chars(&hyp, &reference),
            };
            assert!(
                (plain - expected.score).abs() < 1e-6,
                "{name}: wrapper score"
            );
        }
        assert!(checked >= 20, "fixture 子集过小：{checked}");
    }

    // ----- 对齐结构指标 -----

    fn word(id: &str, t0: f64, t1: f64, text: &str) -> Word {
        Word {
            id: id.to_owned(),
            t0,
            t1,
            text: text.to_owned(),
            sp: "s1".to_owned(),
            glue: false,
        }
    }

    fn doc_with_three_sentences() -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: None,
                hash: "sha256-00".to_owned(),
                duration: 100.0,
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
        // 句 1（8 词）：I didn't go because I was sick.
        // 句 2（4 词）：It is very late.
        // 句 3（3 词）：See you tomorrow.
        let texts: [&[&str]; 3] = [
            &["I", "didn't", "go", "because", "I", "was", "sick."],
            &["It", "is", "very", "late."],
            &["See", "you", "tomorrow."],
        ];
        let mut t = 0.0;
        let mut index = 0;
        for sentence in texts {
            for text in sentence {
                doc.words
                    .push(word(&format!("g1.{index}"), t, t + 0.4, text));
                t += 0.5;
                index += 1;
            }
            t += 0.5;
        }
        doc
    }

    #[test]
    fn align_metrics_reports_each_rate_on_hand_built_doc() {
        let mut doc = doc_with_three_sentences();
        let sentences = derive_sentences(&doc, &[]);
        assert_eq!(sentences.len(), 3);
        let ids: Vec<String> = sentences.iter().map(|s| s.id.clone()).collect();
        let words_of = |sentence: &crate::sentence::Sentence| -> Vec<String> {
            sentence
                .word_indices
                .iter()
                .map(|&i| doc.words[i].id.clone())
                .collect()
        };

        // 句 1：块级对应，两块，第二块 local-reorder；块 1 覆盖 0..=2、块 2 覆盖 3..=6。
        let mut entry1 = TransAlign::new(
            AlignMode::ManyToOne,
            words_of(&sentences[0]),
            vec![
                TransPiece {
                    from: Some(0),
                    to: Some(2),
                    text: "我没去，".to_owned(),
                },
                TransPiece {
                    from: Some(3),
                    to: Some(6),
                    text: "因为我病了。".to_owned(),
                },
            ],
        );
        entry1.correspondence = Some(Correspondence::Block);
        entry1.text_basis = TextBasis::Display;
        entry1.blocks = vec![
            AlignBlock {
                src: (0, 2),
                tgt: (0, 4),
                confidence: Some(0.9),
                flags: vec![],
            },
            AlignBlock {
                src: (3, 6),
                tgt: (4, 10),
                confidence: Some(0.4),
                flags: vec!["local-reorder".to_owned(), "weak".to_owned()],
            },
        ];
        // 句 2：整句对应，一块覆盖全句；译文里有一个块内候选缝（「，」后）。
        let mut entry2 = TransAlign::new(
            AlignMode::ManyToOne,
            words_of(&sentences[1]),
            vec![TransPiece {
                from: Some(0),
                to: Some(3),
                text: "已经，很晚了。".to_owned(),
            }],
        );
        entry2.correspondence = Some(Correspondence::Sentence);
        entry2.blocks = vec![AlignBlock {
            src: (0, 3),
            tgt: (0, 7),
            confidence: Some(0.2),
            flags: vec![],
        }];
        // 句 3：independent，无块。
        let entry3 = TransAlign::new(
            AlignMode::Independent,
            Vec::new(),
            vec![TransPiece {
                from: None,
                to: None,
                text: "明天见。".to_owned(),
            }],
        );
        let mut table = std::collections::BTreeMap::new();
        table.insert(ids[0].clone(), entry1);
        table.insert(ids[1].clone(), entry2);
        table.insert(ids[2].clone(), entry3);
        table.insert(
            "s-stale".to_owned(),
            TransAlign::new(AlignMode::Independent, Vec::new(), Vec::new()),
        );
        doc.trans_align.insert("zh".to_owned(), table);

        let metrics = align_metrics(&doc, "zh");
        assert_eq!(metrics.lang, "zh");
        assert_eq!(metrics.sentences, 3);
        assert_eq!(metrics.aligned, 3);
        assert_eq!(metrics.orphan_entries, 1);
        // 覆盖率只看 manyToOne：句 1 7/7 词、10/10 字符；句 2 4/4、7/7。
        assert!((metrics.coverage_src - 1.0).abs() < 1e-9);
        assert!((metrics.coverage_tgt - 1.0).abs() < 1e-9);
        assert!((metrics.crossing_rate - 1.0 / 3.0).abs() < 1e-9);
        assert_eq!(metrics.local_reorder_blocks, 1);
        // 块边界 1（句 1 位置 4）；块内候选缝 1（句 2「已经，」之后）→ 1/2。
        assert!((metrics.safe_boundary_ratio - 0.5).abs() < 1e-9);
        assert!((metrics.sentence_degrade_rate - 0.5).abs() < 1e-9);
        assert!((metrics.rewrite_rate - 1.0 / 3.0).abs() < 1e-9);
        assert!((metrics.independent_rate - 1.0 / 3.0).abs() < 1e-9);
        assert!((metrics.weak_block_rate - 1.0 / 3.0).abs() < 1e-9);

        let row1 = &metrics.per_sentence[0];
        assert_eq!(row1.blocks, 2);
        assert_eq!(row1.block_boundaries, 1);
        assert_eq!(row1.inner_candidate_seams, 0);
        assert_eq!(row1.covered_source_words, 7);
        assert_eq!(row1.covered_target_chars, 10);
        assert_eq!(row1.text_basis, Some(TextBasis::Display));
        let row2 = &metrics.per_sentence[1];
        assert_eq!(row2.correspondence, Some(Correspondence::Sentence));
        assert_eq!(row2.inner_candidate_seams, 1);
        let row3 = &metrics.per_sentence[2];
        assert_eq!(row3.mode, Some(AlignMode::Independent));
        assert_eq!(row3.blocks, 0);
        assert_eq!(row3.covered_source_words, 0);
        assert_eq!(row3.source_words, 3);

        // camelCase 序列化，供 `bcut check` 直接输出。
        let json = serde_json::to_value(&metrics).unwrap();
        assert!(json.get("coverageSrc").is_some());
        assert!(json.get("safeBoundaryRatio").is_some());
        // M8.2：两条评分器口径已随本地对齐评分器退役。
        assert!(json.get("scorerDirectRate").is_none());
        assert!(json.get("llmFallbackRate").is_none());
        // `corridorPruned` 只存在于 `--align-audit` 工件：transcript 上没有
        // 走廊剪枝数，缺字段比给 0 诚实。
        assert!(json.get("corridorPruned").is_none());
        assert_eq!(json["perSentence"][0]["localReorderBlocks"], 1);
    }

    /// M8.2 后不再产生 `semantic-span-dp/1:…` 条目，但旧项目里已有的必须
    /// 继续可读：`aligner` 原样出现在逐句行里，指标不因此报错或改写它。
    #[test]
    fn legacy_semantic_span_dp_entries_stay_readable() {
        let mut doc = doc_with_three_sentences();
        let ids: Vec<String> = derive_sentences(&doc, &[])
            .iter()
            .map(|sentence| sentence.id.clone())
            .collect();
        let mut table = std::collections::BTreeMap::new();
        for (id, aligner) in [
            (
                &ids[0],
                "semantic-span-dp/1:qwen3-embedding-0.6b@r1+qwen3-reranker-0.6b@r2#identity-v1",
            ),
            (
                &ids[1],
                "llm-chunk+anchor/1+semantic-span-dp/1:qwen3-embedding-0.6b@r1#identity-v1",
            ),
            (&ids[2], "llm-chunk+anchor/1"),
        ] {
            let mut entry = TransAlign::new(
                AlignMode::ManyToOne,
                Vec::new(),
                vec![TransPiece {
                    from: None,
                    to: None,
                    text: "译文。".to_owned(),
                }],
            );
            entry.aligner = Some(aligner.to_owned());
            table.insert(id.clone(), entry);
        }
        doc.trans_align.insert("zh".to_owned(), table);

        let metrics = align_metrics(&doc, "zh");
        assert_eq!(metrics.aligned, 3);
        assert_eq!(
            metrics.per_sentence[0].aligner.as_deref(),
            Some("semantic-span-dp/1:qwen3-embedding-0.6b@r1+qwen3-reranker-0.6b@r2#identity-v1")
        );
    }

    #[test]
    fn align_metrics_partial_coverage_and_no_alignment() {
        let mut doc = doc_with_three_sentences();
        assert_eq!(align_metrics(&doc, "zh").aligned, 0);
        let sentences = derive_sentences(&doc, &[]);
        let mut entry = TransAlign::new(
            AlignMode::ManyToOne,
            sentences[0]
                .word_indices
                .iter()
                .map(|&i| doc.words[i].id.clone())
                .collect(),
            vec![TransPiece {
                from: Some(0),
                to: Some(6),
                text: "我没去因为我病了".to_owned(),
            }],
        );
        // 块只覆盖前 3 个词、前 3 个字符。
        entry.blocks = vec![AlignBlock {
            src: (0, 2),
            tgt: (0, 3),
            confidence: None,
            flags: vec![],
        }];
        let mut table = std::collections::BTreeMap::new();
        table.insert(sentences[0].id.clone(), entry);
        doc.trans_align.insert("zh".to_owned(), table);
        let metrics = align_metrics(&doc, "zh");
        assert_eq!(metrics.aligned, 1);
        assert!((metrics.coverage_src - 3.0 / 7.0).abs() < 1e-9);
        assert!((metrics.coverage_tgt - 3.0 / 8.0).abs() < 1e-9);
        assert_eq!(metrics.safe_boundary_ratio, 0.0);
        assert_eq!(metrics.per_sentence[1].aligned, false);
    }

    // ----- Golden 对拍指标 -----

    fn bead(src: (usize, usize), tgt: (usize, usize)) -> Bead {
        Bead::new(src.0..src.1, tgt.0..tgt.1)
    }

    /// golden：三块；预测：完全一致。
    fn golden_three() -> Vec<Bead> {
        vec![
            bead((0, 2), (0, 4)),
            bead((2, 5), (4, 9)),
            bead((5, 7), (9, 13)),
        ]
    }

    #[test]
    fn bead_prf_perfect_match_scores_one() {
        let golden = golden_three();
        let strict = bead_prf(&golden, &golden, BeadMatch::Strict);
        assert_eq!(strict.precision, 1.0);
        assert_eq!(strict.recall, 1.0);
        assert_eq!(strict.f1, 1.0);
        assert_eq!(strict.predicted, 3);
        assert_eq!(strict.golden, 3);
        let lax = bead_prf(&golden, &golden, BeadMatch::Lax);
        assert_eq!(lax.f1, 1.0);
    }

    /// 预测把 golden 的中间块切成两半：strict 只认头尾两块，lax 全认。
    #[test]
    fn bead_prf_strict_and_lax_differ_on_split_block() {
        let golden = golden_three();
        let predicted = vec![
            bead((0, 2), (0, 4)),
            bead((2, 4), (4, 7)),
            bead((4, 5), (7, 9)),
            bead((5, 7), (9, 13)),
        ];
        let strict = bead_prf(&golden, &predicted, BeadMatch::Strict);
        assert_eq!(strict.matched_predicted, 2);
        assert_eq!(strict.matched_golden, 2);
        assert!((strict.precision - 0.5).abs() < 1e-9);
        assert!((strict.recall - 2.0 / 3.0).abs() < 1e-9);
        let lax = bead_prf(&golden, &predicted, BeadMatch::Lax);
        assert_eq!(lax.matched_predicted, 4);
        assert_eq!(lax.matched_golden, 3);
        assert_eq!(lax.precision, 1.0);
        assert_eq!(lax.recall, 1.0);
        assert_eq!(lax.f1, 1.0);
        assert!(lax.f1 > strict.f1);
    }

    /// 语序错位：预测块与 golden 块两侧都没有交集 ⇒ strict 与 lax 同为 0。
    #[test]
    fn bead_prf_lax_still_zero_without_overlap() {
        let golden = vec![bead((0, 2), (0, 4)), bead((2, 4), (4, 8))];
        let predicted = vec![bead((0, 2), (4, 8)), bead((2, 4), (0, 4))];
        for mode in [BeadMatch::Strict, BeadMatch::Lax] {
            let prf = bead_prf(&golden, &predicted, mode);
            assert_eq!(prf.matched_predicted, 0, "{mode:?}");
            assert_eq!(prf.f1, 0.0, "{mode:?}");
        }
    }

    /// 整句降级（单块）对多块 golden：lax 能拿到满召回但精确率仍受限。
    #[test]
    fn bead_prf_sentence_level_prediction() {
        let golden = golden_three();
        let predicted = vec![bead((0, 7), (0, 13))];
        let strict = bead_prf(&golden, &predicted, BeadMatch::Strict);
        assert_eq!(strict.f1, 0.0);
        let lax = bead_prf(&golden, &predicted, BeadMatch::Lax);
        assert_eq!(lax.precision, 1.0);
        assert_eq!(lax.recall, 1.0);
    }

    #[test]
    fn bead_prf_empty_sides() {
        let both_empty = bead_prf(&[], &[], BeadMatch::Strict);
        assert_eq!(both_empty.precision, 1.0);
        assert_eq!(both_empty.recall, 1.0);
        let no_prediction = bead_prf(&golden_three(), &[], BeadMatch::Lax);
        assert_eq!(no_prediction.precision, 0.0);
        assert_eq!(no_prediction.recall, 0.0);
    }

    #[test]
    fn boundary_f1_counts_shared_positions() {
        let prf = boundary_f1(&[2, 5], &[2, 4, 5]);
        assert_eq!(prf.golden, 2);
        assert_eq!(prf.predicted, 3);
        assert_eq!(prf.recall, 1.0);
        assert!((prf.precision - 2.0 / 3.0).abs() < 1e-9);
        assert!((prf.f1 - 0.8).abs() < 1e-9);
    }

    #[test]
    fn boundary_f1_dedups_and_handles_empty() {
        let deduped = boundary_f1(&[2, 2, 5], &[5, 2]);
        assert_eq!(deduped.golden, 2);
        assert_eq!(deduped.predicted, 2);
        assert_eq!(deduped.f1, 1.0);
        // 整句降级：预测没有内部边界。
        let none = boundary_f1(&[2, 5], &[]);
        assert_eq!(none.precision, 0.0);
        assert_eq!(none.recall, 0.0);
        assert_eq!(none.f1, 0.0);
        assert_eq!(boundary_f1(&[], &[]).f1, 1.0);
    }

    #[test]
    fn boundary_f1_uses_bead_boundaries() {
        let (src, tgt) = beads_boundaries(&golden_three());
        assert_eq!(src, vec![2, 5]);
        assert_eq!(tgt, vec![4, 9]);
        assert_eq!(boundary_f1(&src, &src).f1, 1.0);
        assert_eq!(beads_boundaries(&[]).0, Vec::<usize>::new());
    }

    #[test]
    fn path_exact_match_requires_identical_sequence() {
        let golden = golden_three();
        assert!(path_exact_match(&golden, &golden.clone()));
        let mut shifted = golden.clone();
        shifted[1] = bead((2, 4), (4, 9));
        shifted.insert(2, bead((4, 5), (9, 9)));
        assert!(!path_exact_match(&golden, &shifted));
    }

    #[test]
    fn path_exact_match_is_order_sensitive() {
        let golden = golden_three();
        let mut reversed = golden.clone();
        reversed.reverse();
        assert!(!path_exact_match(&golden, &reversed));
        assert!(path_exact_match(&[], &[]));
    }

    #[test]
    fn beads_contiguous_checks_full_coverage() {
        assert!(beads_contiguous(&golden_three(), 7, 13));
        assert!(!beads_contiguous(&golden_three(), 8, 13));
        assert!(!beads_contiguous(&golden_three(), 7, 14));
        assert!(!beads_contiguous(
            &[bead((0, 2), (0, 4)), bead((3, 5), (4, 9))],
            5,
            9
        ));
        assert!(beads_contiguous(&[], 0, 0));
        assert!(!beads_contiguous(&[], 1, 0));
    }
}
