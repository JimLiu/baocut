//! 最小单调对齐块（对齐块设计 §4.2–§4.6，纯函数、零 I/O、零 LLM）。
//!
//! 一句译文的展示切分被拆成四步确定性计算：
//!
//! 1. **对齐边**（[`AlignEdge`]）：源词序号 ↔ 译文字符区间，由 [`WordAligner`]
//!    实现叠加产出；[`AnchorAligner`] 只出数字/日期/URL/原样 Latin/锁定术语的
//!    `hard` 边，LLM 块级对齐（M3）与模型对齐器（M5）另行注入，
//!    [`merge_edges`] 负责硬边优先的合并。
//! 2. **安全边界与最小单调块**（[`safe_boundaries`] / [`minimal_monotonic_blocks`]）：
//!    只在没有任何高置信对齐边跨越的目标语合法缝上建立双语边界
//!    （`leftMax(k) < rightMin(k)`），相邻安全边界之间就是一个块；语序交叉自动
//!    落进同一块。
//! 3. **双语 DP**（[`bilingual_dp`]）：以块为原子，`pieces` = 连续块的并，同时
//!    受目标语版式、源语版式、共享时窗、两侧缝质量约束。
//! 4. **决策树**（[`plan_sentence`]）：全部块 ≤ hard 且 DP 有解 ⇒ 块级对应；
//!    某块 > hard ⇒ [`PlanOutcome::NeedsRewrite`]（单调化改写由调用方决定）；
//!    置信度不足或无解 ⇒ 整句对应（[`sentence_level_entry`]）。
//!
//! 时间分配不在本模块：`pieces.from/to` 落库后由
//! [`crate::split::derive_trans_cues`] 按词时间派生并平滑/补足，本模块不重复。
//!
//! 坐标约定：本模块内部所有目标侧位置都是**传入 `target` 文本的字符下标**
//! （`chars()` 计数，非字节）；只有写入 [`TransAlign`] 时才按
//! [`AlignBlock`] 的契约换算成 `concat(pieces.text)` 上的字符区间。

use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;

use crate::atomize::{
    atomize, clause_end_char, join_word_texts, seam_backed_by_whitespace, sentence_end,
};
use crate::doc::{
    AlignBlock, AlignMode, Correspondence, TextBasis, TransAlign, TransPiece, TranscriptDoc,
};
use crate::fingerprint::fingerprint_strings;
use crate::seam::{
    MIN_CUE_DISPLAY_SEC, SeamLintClass, SeamLintKind, cjk_midword_boundary, ends_dangling,
    ends_list_separator, is_objective_blocking, lint_pieces, source_boundary_strength,
};
use crate::sentence::Sentence;
use crate::split::{
    BLOCKING_SEAM_PENALTY, OVER_FIT_PENALTY, TransParams, exceeds_one_line_fit, primary_subtag,
    seam_penalty, target_cps_chars, target_required_seconds,
};

/// 缺省软边置信阈值 τ：低于它的软边不参与安全边界判定（设计 §4.3）。
pub const DEFAULT_EDGE_TAU: f32 = 0.5;
/// 缺省整句降级阈值 τ_s：整个方案的置信度低于它时改为整句对应（设计 §4.5）。
pub const DEFAULT_SENTENCE_TAU: f32 = 0.35;
/// 源侧断点选择时视为"停顿"的最小词间静音（秒）；与 ⏸ 停顿标记同门槛。
pub const SOURCE_PAUSE_SEC: f64 = 0.6;
/// 安全边界之间的未对齐源词达到这么多时，改按比例而不是"并入前一块"选断点：
/// 一两个未对齐词是冠词/省译，长串未对齐词是证据缺失。
const LONG_UNALIGNED_RUN: usize = 3;
/// [`AnchorAligner`] 的来源标识。
pub const ANCHOR_ALIGNER_TAG: &str = "anchor/1";

/// 一条对齐边：句内第 `src` 个锚定词 ↔ 目标文本字符区间 `tgt`。
#[derive(Debug, Clone, PartialEq)]
pub struct AlignEdge {
    pub src: usize,
    pub tgt: Range<usize>,
    /// 置信度 0..=1；`hard` 边恒按 1.0 参与判定。
    pub weight: f32,
    /// 硬锚（数字/术语/原样 Latin 等确定性证据）。
    pub hard: bool,
}

impl AlignEdge {
    pub fn hard(src: usize, tgt: Range<usize>) -> Self {
        Self {
            src,
            tgt,
            weight: 1.0,
            hard: true,
        }
    }

    pub fn soft(src: usize, tgt: Range<usize>, weight: f32) -> Self {
        Self {
            src,
            tgt,
            weight,
            hard: false,
        }
    }

    /// 是否参与安全边界判定：硬边恒参与，软边需 `weight >= tau`。
    pub fn counted(&self, tau: f32) -> bool {
        self.hard || self.weight >= tau
    }

    fn effective_weight(&self) -> f32 {
        if self.hard { 1.0 } else { self.weight }
    }
}

/// 双语锁定术语对（brief glossary / 锁定术语）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TermPair {
    pub source: String,
    pub target: String,
}

/// 对齐器上下文。
#[derive(Debug, Clone, Default)]
pub struct AlignCtx {
    /// 源语言（BCP-47）。
    pub source_lang: String,
    /// 目标语言（BCP-47）。
    pub lang: String,
    /// 锁定术语对：源词组 ↔ 目标字面串。
    pub protected_terms: Vec<TermPair>,
}

/// 对齐边来源抽象（设计 §4.2）。实现之间按置信度叠加，硬边优先。
pub trait WordAligner {
    fn align(&self, src_words: &[&str], target: &str, ctx: &AlignCtx) -> Vec<AlignEdge>;
}

/// 确定性锚点对齐器：数字（含 `2028` / `50%` / `3.5` / `1,000`）、日期、URL/邮箱、
/// 原样出现在译文里的 Latin 词、锁定术语对 ⇒ `hard` 边。
///
/// 匹配纪律镜像 `engines::align::unique_anchor_bindings`：只在源侧与目标侧
/// **各唯一命中**时才下结论；重复出现的 token 无法确定对应关系，交给上层
/// 对齐器。术语源区间重叠时长词组胜出，等长双双弃权。
#[derive(Debug, Clone, Copy, Default)]
pub struct AnchorAligner;

impl WordAligner for AnchorAligner {
    fn align(&self, src_words: &[&str], target: &str, ctx: &AlignCtx) -> Vec<AlignEdge> {
        let target_chars: Vec<char> = target.chars().collect();
        let mut edges = term_edges(src_words, target, &ctx.protected_terms);
        let target_cjk = is_cjk_target(&ctx.lang);
        // 每个源词至多产出一个 token 锚；先收集候选，再按唯一性过滤。
        let mut candidates: Vec<(usize, String)> = Vec::new();
        for (index, word) in src_words.iter().enumerate() {
            let token = anchor_token(word);
            if token.is_empty() {
                continue;
            }
            if is_numeric_anchor(&token)
                || is_url_anchor(&token)
                || is_latin_anchor(&token, target_cjk, index == 0)
            {
                candidates.push((index, token));
            }
        }
        for (index, token) in &candidates {
            if candidates
                .iter()
                .filter(|(_, other)| other == token)
                .count()
                != 1
            {
                continue;
            }
            let hits = whole_token_occurrences(&target_chars, token);
            if hits.len() != 1 {
                continue;
            }
            let start = hits[0];
            let range = start..start + token.chars().count();
            // 已被术语边覆盖的源词不再重复出边（术语边更长、更精确）。
            if edges.iter().any(|edge| edge.src == *index) {
                continue;
            }
            edges.push(AlignEdge::hard(*index, range));
        }
        edges.sort_by_key(|edge| (edge.src, edge.tgt.start, edge.tgt.end));
        edges
    }
}

fn is_cjk_target(lang: &str) -> bool {
    matches!(primary_subtag(lang).as_str(), "zh" | "ja" | "ko" | "th")
}

/// 从源词剥掉首尾非内容标点后的锚 token（`2028,` → `2028`、`(GPU)` → `GPU`、
/// `50%.` → `50%`）；内部字符原样保留（`3.5`、`1,000`、`https://a.b/c`）。
fn anchor_token(word: &str) -> String {
    let keep = |ch: char| ch.is_alphanumeric() || matches!(ch, '%' | '$' | '€' | '£' | '¥');
    word.trim()
        .trim_start_matches(|ch: char| !keep(ch))
        .trim_end_matches(|ch: char| !keep(ch))
        .to_owned()
}

fn is_numeric_anchor(token: &str) -> bool {
    token.chars().any(|ch| ch.is_ascii_digit())
        && token.chars().all(|ch| {
            ch.is_ascii_digit()
                || matches!(
                    ch,
                    '.' | ',' | '%' | ':' | '/' | '-' | '+' | '$' | '€' | '£' | '¥'
                )
        })
}

fn is_url_anchor(token: &str) -> bool {
    if token.contains("://") || token.starts_with("www.") {
        return true;
    }
    if token.contains('@') && token.contains('.') {
        return true;
    }
    let segments: Vec<&str> = token.split('.').filter(|seg| !seg.is_empty()).collect();
    segments.len() >= 2
        && segments.iter().all(|seg| {
            seg.chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '/'))
        })
        && segments.last().is_some_and(|seg| {
            (2..=6).contains(&seg.len()) && seg.chars().all(|c| c.is_ascii_alphabetic())
        })
        && segments[0].chars().any(|ch| ch.is_ascii_alphabetic())
        && segments[0].len() >= 2
}

/// 原样 Latin 片段判据。CJK 目标语里任何 Latin 词都是外来原样片段；Latin
/// 目标语只认专名形态（含数字、非首位大写、全大写、句中大写起首），避免把
/// 同形功能词（`In`/`no`）当成硬锚。
fn is_latin_anchor(token: &str, target_cjk: bool, sentence_initial: bool) -> bool {
    let chars: Vec<char> = token.chars().collect();
    if chars.len() < 2
        || !chars
            .iter()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '\''))
        || !chars.iter().any(|ch| ch.is_ascii_alphabetic())
    {
        return false;
    }
    if target_cjk {
        return true;
    }
    let has_digit = chars.iter().any(|ch| ch.is_ascii_digit());
    let inner_upper = chars[1..].iter().any(|ch| ch.is_ascii_uppercase());
    let all_upper = chars.iter().all(|ch| !ch.is_ascii_lowercase());
    let capitalized = chars[0].is_ascii_uppercase();
    has_digit || inner_upper || all_upper || (capitalized && !sentence_initial)
}

/// `token` 在目标字符流里的整词命中位置：前后不能紧邻字母数字，也不能是
/// 紧接数字的小数点/千分位（`2028` 不命中 `2028.5` 或 `12,028`）。
fn whole_token_occurrences(target: &[char], token: &str) -> Vec<usize> {
    let needle: Vec<char> = token.chars().collect();
    if needle.is_empty() || needle.len() > target.len() {
        return Vec::new();
    }
    let boundary = |at: usize, next: Option<usize>| -> bool {
        let Some(&ch) = target.get(at) else {
            return true;
        };
        if ch.is_ascii_alphanumeric() {
            return false;
        }
        !(matches!(ch, '.' | ',')
            && next
                .and_then(|index| target.get(index))
                .is_some_and(|ch| ch.is_ascii_digit()))
    };
    (0..=target.len() - needle.len())
        .filter(|&start| {
            let end = start + needle.len();
            target[start..end] == needle[..]
                && start
                    .checked_sub(1)
                    .is_none_or(|before| boundary(before, before.checked_sub(1)))
                && boundary(end, Some(end + 1))
        })
        .collect()
}

fn lexemes(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|ch: char| !ch.is_alphanumeric() && ch != '\'' && ch != '-')
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
        .collect()
}

/// 源词组在词序列上的唯一命中窗口（按规范化 lexeme 序列匹配）。
fn source_phrase_matches(words: &[&str], phrase: &str) -> Vec<(usize, usize)> {
    let phrase_tokens = lexemes(phrase);
    if phrase_tokens.is_empty() {
        return Vec::new();
    }
    let flattened: Vec<(usize, String)> = words
        .iter()
        .enumerate()
        .flat_map(|(index, word)| lexemes(word).into_iter().map(move |token| (index, token)))
        .collect();
    if phrase_tokens.len() > flattened.len() {
        return Vec::new();
    }
    flattened
        .windows(phrase_tokens.len())
        .filter(|window| window.iter().map(|(_, t)| t).eq(phrase_tokens.iter()))
        .map(|window| (window[0].0, window[window.len() - 1].0))
        .collect()
}

/// 锁定术语对 ⇒ 硬边（源窗口内每个词 → 目标字面串区间）。
fn term_edges(src_words: &[&str], target: &str, terms: &[TermPair]) -> Vec<AlignEdge> {
    struct Binding {
        span: (usize, usize),
        tgt: Range<usize>,
    }
    let mut bindings: Vec<Binding> = Vec::new();
    for term in terms {
        if term.source.trim().is_empty() || term.target.is_empty() {
            continue;
        }
        let sources = source_phrase_matches(src_words, &term.source);
        if sources.len() != 1 {
            continue;
        }
        let targets: Vec<usize> = target
            .match_indices(term.target.as_str())
            .map(|(byte, _)| target[..byte].chars().count())
            .collect();
        if targets.len() != 1 {
            continue;
        }
        let tgt = targets[0]..targets[0] + term.target.chars().count();
        if bindings
            .iter()
            .any(|existing| existing.span == sources[0] && existing.tgt == tgt)
        {
            continue;
        }
        bindings.push(Binding {
            span: sources[0],
            tgt,
        });
    }
    // 源区间重叠消歧：长词组胜出，等长双双弃权（镜像 unique_anchor_bindings）。
    let mut keep = vec![true; bindings.len()];
    for first in 0..bindings.len() {
        for second in first + 1..bindings.len() {
            let a = bindings[first].span;
            let b = bindings[second].span;
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
    bindings
        .into_iter()
        .zip(keep)
        .filter(|(_, kept)| *kept)
        .flat_map(|(binding, _)| {
            (binding.span.0..=binding.span.1)
                .map(move |src| AlignEdge::hard(src, binding.tgt.clone()))
        })
        .collect()
}

/// 多层对齐边合并：空区间丢弃；同一源词或同一目标区间上硬边胜过软边；完全
/// 相同的边只保留权重最高的一条。输出按 `(src, tgt)` 排序，结果确定。
pub fn merge_edges(layers: Vec<Vec<AlignEdge>>) -> Vec<AlignEdge> {
    let mut all: Vec<AlignEdge> = layers
        .into_iter()
        .flatten()
        .filter(|edge| edge.tgt.start < edge.tgt.end)
        .collect();
    all.sort_by(|a, b| {
        b.hard
            .cmp(&a.hard)
            .then(b.weight.total_cmp(&a.weight))
            .then(a.src.cmp(&b.src))
            .then(a.tgt.start.cmp(&b.tgt.start))
            .then(a.tgt.end.cmp(&b.tgt.end))
    });
    let mut merged: Vec<AlignEdge> = Vec::with_capacity(all.len());
    for edge in all {
        let duplicate = merged
            .iter()
            .any(|kept| kept.src == edge.src && kept.tgt == edge.tgt);
        if duplicate {
            continue;
        }
        let dominated = !edge.hard
            && merged
                .iter()
                .any(|kept| kept.hard && (kept.src == edge.src || kept.tgt == edge.tgt));
        if dominated {
            continue;
        }
        merged.push(edge);
    }
    merged.sort_by_key(|edge| (edge.src, edge.tgt.start, edge.tgt.end, !edge.hard));
    merged
}

/// 句内锚定词（[`TransAlign::words`] 的一项）：id 落库、text 供源缝判定、
/// 时间供停顿与时窗代价。
#[derive(Debug, Clone, PartialEq)]
pub struct AnchorWord {
    pub id: String,
    pub text: String,
    pub t0: f64,
    pub t1: f64,
    /// 文稿里的「贴前」标记（[`crate::doc::Word::glue`]）。
    pub glue: bool,
}

impl crate::atomize::JoinWord for AnchorWord {
    fn join_text(&self) -> &str {
        &self.text
    }
    fn glued(&self) -> bool {
        self.glue
    }
}

/// 目标语候选切点：字符位 `pos`（切在该位之前，空白归左侧）与缝罚分
/// （沿用 `split.rs` 标尺：句末 0 < 从句标点 0.3 < 词间空白 0.8 < 无缝
/// [`crate::split::NO_SEAM_PENALTY`]，CJK 词内边界/阻塞级碎片另加
/// [`BLOCKING_SEAM_PENALTY`]）。客观语病缝与锁定术语内部**不进候选**。
#[derive(Debug, Clone, PartialEq)]
pub struct CutCandidate {
    pub pos: usize,
    pub seam_cost: f64,
}

/// 模型切点提示吸附后的两堆候选（[`hinted_cut_candidates`]）：`admitted` 是
/// lint 放行的（干净或只带悬垂尾），`refused` 是被客观语病 lint 拒掉的
/// （弱尾 / 黏着首 / 残缺名词组 / 列表分隔 / 未闭合定界符）——后者只在块内
/// 切分里作 [`SplitSeam::HintedRefused`] 档、排在逐字缝前（§8.9）。锁定术语
/// 内部的提示两堆都不进。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct HintedCuts {
    pub admitted: Vec<CutCandidate>,
    pub refused: Vec<CutCandidate>,
}

/// 原子 → 在 `target` 里的起始字符下标（[`atomize`] 对非空白字符无损，逐一
/// 回填即可）。返回 `n + 1` 项，末项 = 文本字符数。
fn atom_start_positions(target: &str, atoms: &[String]) -> Vec<usize> {
    let mut starts = Vec::with_capacity(atoms.len() + 1);
    let mut want: Vec<usize> = Vec::with_capacity(atoms.len());
    let mut acc = 0usize;
    for atom in atoms {
        want.push(acc);
        acc += atom.chars().count();
    }
    let mut seen = 0usize;
    let mut next = 0usize;
    let mut total = 0usize;
    for (index, ch) in target.chars().enumerate() {
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

/// 目标语候选切点（设计 §4.3）。
pub fn target_cut_candidates(
    target: &str,
    lang: &str,
    params: &TransParams,
    protected_terms: &[String],
) -> Vec<CutCandidate> {
    let atoms = atomize(target);
    if atoms.len() < 2 {
        return Vec::new();
    }
    let starts = atom_start_positions(target, &atoms);
    let protected = protected_spans(target, lang, params, protected_terms);
    (1..atoms.len())
        .filter_map(|j| cut_verdict(target, &atoms, &starts, j, lang, params, &protected))
        .filter(|verdict| !verdict.refused && !verdict.dangling)
        .map(|verdict| verdict.candidate)
        .collect()
}

/// 模型自己给出的切点（块边界、抄进译文的片标，见 [`crate::filepipe::lines::cut_hints`]）
/// 作为块内切分的次选候选。`hints` 是目标字符下标，向后吸附到最近的原子起点
/// （中间只许空白与标点），吸不上的丢弃。客观语病里只有悬垂尾照收进
/// `admitted`——比按字硬切好，且落到 [`SplitSeam::HintedFlagged`] 档——弱尾 /
/// 黏着首 / 残缺名词组 / 列表分隔 / 未闭合定界符的提示进 `refused`
/// （§8.8 用户裁决：原先弱尾与黏着首也放行，四项目上 `align-target-seam`
/// 9 → 33；§8.9 再把被拒的提示立成一档排在逐字缝前）；锁定术语内部的提示
/// 两堆都不进。代价与 [`target_cut_candidates`] 同尺。去重、按位置排序。
pub fn hinted_cut_candidates(
    target: &str,
    lang: &str,
    params: &TransParams,
    protected_terms: &[String],
    hints: &[usize],
) -> HintedCuts {
    let atoms = atomize(target);
    if atoms.len() < 2 || hints.is_empty() {
        return HintedCuts::default();
    }
    let starts = atom_start_positions(target, &atoms);
    let protected = protected_spans(target, lang, params, protected_terms);
    let chars: Vec<char> = target.chars().collect();
    let mut out = HintedCuts::default();
    let mut seen: BTreeSet<usize> = BTreeSet::new();
    for &hint in hints {
        let Some(j) = (1..atoms.len()).find(|&j| starts[j] >= hint) else {
            continue;
        };
        let bridge_only_noise = chars[hint.min(chars.len())..starts[j].min(chars.len())]
            .iter()
            .all(|ch| ch.is_whitespace() || crate::atomize::is_punctuation_or_symbol(*ch));
        if !bridge_only_noise || !seen.insert(starts[j]) {
            continue;
        }
        if let Some(verdict) = cut_verdict(target, &atoms, &starts, j, lang, params, &protected) {
            if verdict.refused {
                out.refused.push(verdict.candidate);
            } else {
                out.admitted.push(verdict.candidate);
            }
        }
    }
    out.admitted.sort_by_key(|candidate| candidate.pos);
    out.refused.sort_by_key(|candidate| candidate.pos);
    out
}

/// 锁定术语在 `target` 上的字符区间（只锁放得进一行的术语）。
fn protected_spans(
    target: &str,
    lang: &str,
    params: &TransParams,
    protected_terms: &[String],
) -> Vec<(usize, usize)> {
    protected_terms
        .iter()
        .filter(|term| !term.is_empty() && target_cps_chars(term, lang) <= params.fit)
        .flat_map(|term| {
            target.match_indices(term.as_str()).map(|(byte, matched)| {
                let start = target[..byte].chars().count();
                (start, start + matched.chars().count())
            })
        })
        .collect()
}

/// 原子 `j` 前的缝经客观语病 lint 后的裁定：`dangling` 是只有悬垂尾这一类
/// 语病（证据候选不收、模型提示放行），`refused` 是别的客观语病（证据候选
/// 与提示都不收进放行堆）。两者都假时是干净缝；代价里词内启发式与阻断级
/// 语病都已计入 [`BLOCKING_SEAM_PENALTY`]。
struct CutVerdict {
    candidate: CutCandidate,
    dangling: bool,
    refused: bool,
}

/// 原子 `j` 前的缝：锁定术语内部不进候选（`None`），其余给出 [`CutVerdict`]。
fn cut_verdict(
    target: &str,
    atoms: &[String],
    starts: &[usize],
    j: usize,
    lang: &str,
    params: &TransParams,
    protected: &[(usize, usize)],
) -> Option<CutVerdict> {
    let pos = starts[j];
    if protected.iter().any(|(s, e)| *s < pos && pos < *e) {
        return None;
    }
    let left = join_word_texts(atoms[..j].iter().map(String::as_str));
    let right = join_word_texts(atoms[j..].iter().map(String::as_str));
    let issues = lint_pieces(&[left.as_str(), right.as_str()], lang, params);
    let dangling = issues
        .iter()
        .any(|issue| is_objective_blocking(issue) && issue.class == SeamLintClass::DanglingTail);
    let refused = issues
        .iter()
        .any(|issue| is_objective_blocking(issue) && issue.class != SeamLintClass::DanglingTail);
    let mut cost = seam_penalty(
        &atoms[j - 1],
        &atoms[j],
        seam_backed_by_whitespace(target, &atoms, j),
    );
    if cjk_midword_boundary(left.trim_end(), right.trim_start())
        || issues
            .iter()
            .any(|issue| issue.kind == SeamLintKind::Blocking)
    {
        cost += BLOCKING_SEAM_PENALTY;
    }
    Some(CutVerdict {
        candidate: CutCandidate {
            pos,
            seam_cost: cost,
        },
        dangling,
        refused,
    })
}

/// 一个目标切点上的对齐统计。
struct BoundaryStat {
    /// 切点左侧译文对齐到的最大源词序（无 ⇒ None）。
    left_max: Option<usize>,
    /// 切点右侧译文对齐到的最小源词序（无 ⇒ None）。
    right_min: Option<usize>,
    /// 有参与判定的边横跨切点。
    straddled: bool,
    /// 支撑该切点的边（达成 leftMax / rightMin 者）的最小权重。
    confidence: f32,
}

impl BoundaryStat {
    fn safe(&self) -> bool {
        if self.straddled {
            return false;
        }
        match (self.left_max, self.right_min) {
            (Some(left), Some(right)) => left < right,
            _ => true,
        }
    }
}

fn boundary_stat(edges: &[AlignEdge], k: usize, tau: f32) -> BoundaryStat {
    let mut left: Option<(usize, f32)> = None;
    let mut right: Option<(usize, f32)> = None;
    let mut straddled = false;
    for edge in edges.iter().filter(|edge| edge.counted(tau)) {
        let weight = edge.effective_weight();
        if edge.tgt.start < k && k < edge.tgt.end {
            straddled = true;
            continue;
        }
        if edge.tgt.end <= k {
            left = Some(match left {
                Some((src, w)) if edge.src == src => (src, w.min(weight)),
                Some((src, w)) if edge.src < src => (src, w),
                _ => (edge.src, weight),
            });
        }
        if edge.tgt.start >= k {
            right = Some(match right {
                Some((src, w)) if edge.src == src => (src, w.min(weight)),
                Some((src, w)) if edge.src > src => (src, w),
                _ => (edge.src, weight),
            });
        }
    }
    let confidence = left
        .map(|(_, w)| w)
        .unwrap_or(1.0)
        .min(right.map(|(_, w)| w).unwrap_or(1.0));
    BoundaryStat {
        left_max: left.map(|(src, _)| src),
        right_min: right.map(|(src, _)| src),
        straddled,
        confidence,
    }
}

/// 安全边界（设计 §4.3）：候选切点 `k` 满足 `leftMax(k) < rightMin(k)` 且没有
/// 参与判定的边横跨它。只统计 `hard` 边与 `weight >= tau` 的软边。
pub fn safe_boundaries(edges: &[AlignEdge], candidates: &[usize], tau: f32) -> Vec<usize> {
    let mut sorted: Vec<usize> = candidates.iter().copied().filter(|&k| k > 0).collect();
    sorted.sort_unstable();
    sorted.dedup();
    sorted
        .into_iter()
        .filter(|&k| boundary_stat(edges, k, tau).safe())
        .collect()
}

/// 源侧断点是否为强缝（左词带从句/句末标点）。
fn source_punct_break(words: &[AnchorWord], b: usize) -> bool {
    let left = words[b - 1].text.trim();
    sentence_end(left) || clause_end_char(left).is_some()
}

fn source_pause_break(words: &[AnchorWord], b: usize) -> bool {
    words[b].t0 - words[b - 1].t1 >= SOURCE_PAUSE_SEC
}

/// 切在这些词**之后**会把它们与所依附的后续成分拆开（冠词/助动词/否定/
/// 介词/连词/限定词）。小型英语规则集；CJK 悬垂由 [`ends_dangling`] 兜底。
const FORWARD_CLINGING_EN: &[&str] = &[
    // 冠词 / 限定词
    "a",
    "an",
    "the",
    "this",
    "that",
    "these",
    "those",
    "my",
    "your",
    "his",
    "her",
    "its",
    "our",
    "their",
    "some",
    "any",
    "no",
    "every",
    "each",
    "another",
    "such",
    // 助动词 / 系词 / 否定
    "do",
    "does",
    "did",
    "will",
    "would",
    "shall",
    "should",
    "can",
    "could",
    "may",
    "might",
    "must",
    "have",
    "has",
    "had",
    "having",
    "be",
    "been",
    "being",
    "am",
    "is",
    "are",
    "was",
    "were",
    "not",
    "don't",
    "doesn't",
    "didn't",
    "won't",
    "wouldn't",
    "can't",
    "cannot",
    "couldn't",
    "shouldn't",
    "isn't",
    "aren't",
    "wasn't",
    "weren't",
    "hasn't",
    "haven't",
    "hadn't",
    "never",
    // 介词 / 不定式
    "to",
    "of",
    "in",
    "on",
    "at",
    "for",
    "with",
    "from",
    "by",
    "about",
    "into",
    "onto",
    "as",
    "than",
    "through",
    "over",
    "under",
    "between",
    "without",
    "via",
    "per",
    "toward",
    "towards",
    // 连词 / 关系词
    "and",
    "or",
    "but",
    "because",
    "if",
    "when",
    "while",
    "that",
    "which",
    "who",
    "whom",
    "whose",
    "where",
    "so",
    "then",
    "although",
    "though",
    "unless",
    "until",
    "whether",
    "nor",
    "yet",
];

/// 切在这些词**之前**会把黏着助词切到片首（日语助词）。
const BACKWARD_CLINGING_JA: &[&str] = &[
    "は",
    "が",
    "を",
    "に",
    "で",
    "と",
    "の",
    "へ",
    "も",
    "や",
    "から",
    "まで",
    "より",
    "ので",
    "のに",
    "けど",
    "けれど",
];

/// 源侧断点 `b`（右块首词下标）是否合法。
fn source_seam_legal(words: &[AnchorWord], b: usize) -> bool {
    if b == 0 || b >= words.len() {
        return false;
    }
    let left_text = join_word_texts(words[..b].iter());
    if ends_dangling(&left_text) {
        return false;
    }
    // 从句标点封住的缝是合法的：`Generally speaking, though, | the smarter …`
    // 里 `though,` 的词元虽在前附列表里，但逗号已经把它收成一个完整的插入语，
    // 行尾停在这里没有悬垂。不封口时才按词元判前附。
    let sealed = crate::seam::ends_clause_punct(&words[b - 1].text);
    let tail = lexemes(&words[b - 1].text).pop().unwrap_or_default();
    if !sealed && FORWARD_CLINGING_EN.contains(&tail.as_str()) {
        return false;
    }
    let head = lexemes(&words[b].text)
        .into_iter()
        .next()
        .unwrap_or_default();
    !BACKWARD_CLINGING_JA.contains(&head.as_str())
}

/// 源侧缝罚分（DP 用）：句读 0 < 连词前 0.3 < 介词前 0.5 < 普通词间 0.8；
/// 非法缝（悬垂冠词/连词等）另加 [`BLOCKING_SEAM_PENALTY`]。块边界由对齐边
/// 决定、可能被迫落在坏缝上，因此是重罚而非无穷。
fn source_seam_cost(words: &[AnchorWord], b: usize) -> f64 {
    let texts: Vec<&str> = words.iter().map(|word| word.text.as_str()).collect();
    let base = match source_boundary_strength(&texts, b) {
        3 => 0.0,
        2 => 0.3,
        1 => 0.5,
        _ => 0.8,
    };
    if source_seam_legal(words, b) {
        base
    } else {
        base + BLOCKING_SEAM_PENALTY
    }
}

/// 在 `(leftMax, rightMin]`（已收窄为 `lo..=hi`）内选源侧断点（设计 §4.3）：
/// 句末/从句标点 > 停顿 > 合法普通缝 > 非法缝；标点与停顿档内取最接近
/// 比例理想位者；普通缝档默认并入前一块（取最大 `b`），未对齐词过长时改取
/// 最接近理想位的合法缝；非法缝只作最后兜底。
fn choose_source_break(
    words: &[AnchorWord],
    lo: usize,
    hi: usize,
    k: usize,
    target_len: usize,
) -> usize {
    if lo >= hi {
        return lo;
    }
    let n = words.len();
    let ideal = ((k as f64 / target_len.max(1) as f64) * n as f64).round() as usize;
    let ideal = ideal.clamp(lo, hi);
    let class = |b: usize| -> u8 {
        if source_punct_break(words, b) {
            3
        } else if source_pause_break(words, b) {
            2
        } else if source_seam_legal(words, b) {
            1
        } else {
            0
        }
    };
    let best_class = (lo..=hi).map(class).max().unwrap_or(0);
    let candidates: Vec<usize> = (lo..=hi).filter(|&b| class(b) == best_class).collect();
    let closest = |set: &[usize]| {
        set.iter()
            .copied()
            .min_by_key(|&b| (b.abs_diff(ideal), std::cmp::Reverse(b)))
            .unwrap_or(hi)
    };
    match best_class {
        3 | 2 => closest(&candidates),
        1 if hi - lo + 1 > LONG_UNALIGNED_RUN => closest(&candidates),
        1 => *candidates.last().unwrap_or(&hi),
        _ => hi,
    }
}

/// 块内是否存在交叉边（局部乱序）。
fn has_local_reorder(edges: &[AlignEdge]) -> bool {
    for (index, a) in edges.iter().enumerate() {
        for b in &edges[index + 1..] {
            if (a.src < b.src && a.tgt.start > b.tgt.start)
                || (a.src > b.src && a.tgt.start < b.tgt.start)
            {
                return true;
            }
        }
    }
    false
}

/// 最小单调对齐块（设计 §4.3）。返回块的目标区间是 **`target` 字符坐标**
/// （[`plan_entry`] 再换算到 `concat(pieces.text)`）。
///
/// - 只有参与判定（`hard` 或 `weight >= tau`）的边影响边界；
/// - 每个安全边界的源断点由 [`choose_source_break`] 在 `(leftMax, rightMin]`
///   内选出，且必须给两侧各留 ≥1 个源词，否则该边界弃用（并入相邻块）；
/// - 未被任何边覆盖的源词并入前一块，句首的并入后一块；
/// - `confidence` = 支撑块两侧边界的边权最小值，再与块内参与判定的边权取
///   最小（无边界的整句块由块内边权决定）；
/// - `flags`：`local-reorder`（块内交叉边）、`anchor`（含硬边）、`weak`（无硬边）。
pub fn minimal_monotonic_blocks(
    edges: &[AlignEdge],
    words: &[AnchorWord],
    target: &str,
    candidates: &[usize],
    tau: f32,
) -> Vec<AlignBlock> {
    let n = words.len();
    let target_len = target.chars().count();
    if n == 0 || target_len == 0 {
        return Vec::new();
    }
    let mut sorted: Vec<usize> = candidates
        .iter()
        .copied()
        .filter(|&k| k > 0 && k < target_len)
        .collect();
    sorted.sort_unstable();
    sorted.dedup();

    // (目标切点, 源断点, 边界置信度)
    let mut cuts: Vec<(usize, usize, f32)> = Vec::new();
    let mut prev_b = 0usize;
    for k in sorted {
        let stat = boundary_stat(edges, k, tau);
        if !stat.safe() {
            continue;
        }
        let lo = stat
            .left_max
            .map_or(0, |left| left + 1)
            .max(prev_b + 1)
            .max(1);
        let hi = stat.right_min.unwrap_or(n - 1).min(n - 1);
        if lo > hi {
            continue;
        }
        let b = choose_source_break(words, lo, hi, k, target_len);
        cuts.push((k, b, stat.confidence));
        prev_b = b;
    }

    let mut blocks = Vec::with_capacity(cuts.len() + 1);
    let mut src_from = 0usize;
    let mut tgt_from = 0usize;
    let mut left_conf = 1.0f32;
    for index in 0..=cuts.len() {
        let (tgt_to, next_src, right_conf) = cuts
            .get(index)
            .map(|&(k, b, conf)| (k, b, conf))
            .unwrap_or((target_len, n, 1.0));
        let src_to = next_src - 1;
        let inside: Vec<AlignEdge> = edges
            .iter()
            .filter(|edge| {
                edge.counted(tau)
                    && (src_from..=src_to).contains(&edge.src)
                    && edge.tgt.start >= tgt_from
                    && edge.tgt.end <= tgt_to
            })
            .cloned()
            .collect();
        let mut confidence = left_conf.min(right_conf);
        for edge in &inside {
            confidence = confidence.min(edge.effective_weight());
        }
        let mut flags = Vec::new();
        if has_local_reorder(&inside) {
            flags.push("local-reorder".to_owned());
        }
        if inside.iter().any(|edge| edge.hard) {
            flags.push("anchor".to_owned());
        } else {
            flags.push("weak".to_owned());
        }
        blocks.push(AlignBlock {
            src: (src_from, src_to),
            tgt: (tgt_from, tgt_to),
            confidence: Some(confidence),
            flags,
        });
        src_from = next_src;
        tgt_from = tgt_to;
        left_conf = right_conf;
    }
    blocks
}

/// 双语 DP 输入（设计 §4.4）。
#[derive(Debug, Clone, PartialEq)]
pub struct BilingualPlanInput {
    /// 句内锚定词（顺序即 `src` 序号）。
    pub words: Vec<AnchorWord>,
    /// 目标文本（`trans` 或 `transDisplay.text`，由 `text_basis` 声明）。
    pub target: String,
    /// 目标语言。
    pub lang: String,
    /// 源语言。
    pub source_lang: String,
    pub params: TransParams,
    /// 目标语锁定术语（不可从中间切开）。
    pub protected_terms: Vec<String>,
    /// 单条字幕最短展示时长（秒），缺省 1.0。
    pub min_duration_sec: f64,
    /// 单条字幕最长停留时长（秒），缺省 7.0。
    pub max_duration_sec: f64,
    /// 源侧单行阅读单位预算（缺省按源语言取 `source_piece_budgets`）。
    pub source_fit: usize,
    /// 软边参与判定的置信阈值 τ。
    pub tau: f32,
    /// 整句降级阈值 τ_s。
    pub sentence_tau: f32,
    pub text_basis: TextBasis,
    /// 写入 `TransAlign.aligner` 的来源标识。
    pub aligner: String,
    /// 显示行密度。`Paired` 只放宽“目标行太窄”的合并偏好；读速与时长
    /// 硬护栏保持不变。
    pub density: AlignDensity,
    /// 与 `words` 逐位对应的源 Cue 归属。非空（且与 `words` 等长）时，行规划
    /// 按 `align-row-deficit` 同一驻留谓词（[`crate::engines::align::row_dwell_deficit`]）
    /// 避免产出黏结行；空 = 不知道源行，谓词关闭。
    pub source_cue_keys: Vec<Option<String>>,
}

/// 译文展示行密度。缺省 `Auto` 保持既有多对一行为。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AlignDensity {
    #[default]
    Auto,
    Paired,
}

impl AlignDensity {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "auto" => Some(Self::Auto),
            "paired" => Some(Self::Paired),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Paired => "paired",
        }
    }
}

impl BilingualPlanInput {
    /// 缺省参数：`TransParams::for_lang`、1.0s / 7.0s、源侧预算按语言、τ 0.5、
    /// τ_s 0.35、`trans` 基准、[`ANCHOR_ALIGNER_TAG`]。
    pub fn new(
        words: Vec<AnchorWord>,
        target: impl Into<String>,
        source_lang: &str,
        lang: &str,
    ) -> Self {
        Self {
            words,
            target: target.into(),
            lang: lang.to_owned(),
            source_lang: source_lang.to_owned(),
            params: TransParams::for_lang(lang),
            protected_terms: Vec::new(),
            min_duration_sec: MIN_CUE_DISPLAY_SEC,
            max_duration_sec: crate::engines::align::LONG_DWELL_SECONDS,
            source_fit: crate::engines::align::source_piece_budgets(source_lang).0,
            tau: DEFAULT_EDGE_TAU,
            sentence_tau: DEFAULT_SENTENCE_TAU,
            text_basis: TextBasis::Trans,
            aligner: ANCHOR_ALIGNER_TAG.to_owned(),
            density: AlignDensity::Auto,
            source_cue_keys: Vec::new(),
        }
    }

    /// 源行信息可用（逐词归属齐全）。
    fn knows_source_rows(&self) -> bool {
        !self.words.is_empty() && self.source_cue_keys.len() == self.words.len()
    }

    /// 整句的用户可见源行数；源行信息不可用时为 0。
    fn sentence_source_rows(&self) -> usize {
        if !self.knows_source_rows() {
            return 0;
        }
        crate::engines::align::covered_source_rows(&self.source_cue_keys, 0, self.words.len() - 1)
    }

    /// 句内词序 `[from, to]` 作为一条译文行时是否命中 `align-row-deficit` 的
    /// 驻留谓词。源行信息不可用时恒为假。
    fn piece_dwell_deficit(&self, from: usize, to: usize) -> bool {
        if !self.knows_source_rows() || from > to || to >= self.words.len() {
            return false;
        }
        let dwell = (self.words[to].t1 - self.words[from].t0).max(0.0);
        crate::engines::align::row_dwell_deficit(
            dwell,
            crate::engines::align::covered_source_rows(&self.source_cue_keys, from, to),
        )
    }

    fn word_units(&self) -> Vec<usize> {
        self.words
            .iter()
            .map(|word| target_cps_chars(&word.text, &self.source_lang))
            .collect()
    }
}

/// 合并多个块时的轻罚（每多合并一块），鼓励细粒度对照。
const BLOCK_MERGE_PENALTY: f64 = 0.05;
/// 源侧区间宽度超单行预算的罚分。
const SOURCE_OVER_FIT_PENALTY: f64 = 1.0;
/// 时窗短于目标语最低阅读时长：每秒缺口罚分。
const DURATION_DEFICIT_WEIGHT: f64 = 1.0;
/// 时窗超过最长停留：每秒罚分。
const DURATION_EXCESS_WEIGHT: f64 = 0.5;

fn char_slice(chars: &[char], range: Range<usize>) -> String {
    chars[range.start.min(chars.len())..range.end.min(chars.len())]
        .iter()
        .collect()
}

/// 一片（`blocks[i..j)`）的配对代价；`None` = 违反硬约束。`left_piece_start`
/// 是 DP 为块 `i` 已选定的前驱片的首块下标（`i == 0` 时无意义），只用于顿号缝
/// 的同口径判定。
#[allow(clippy::too_many_arguments)]
fn pair_cost(
    blocks: &[AlignBlock],
    i: usize,
    j: usize,
    left_piece_start: Option<usize>,
    input: &BilingualPlanInput,
    target_chars: &[char],
    word_units: &[usize],
    seam_costs: &BTreeMap<usize, f64>,
) -> Option<f64> {
    let first = &blocks[i];
    let last = &blocks[j - 1];
    let text = char_slice(target_chars, first.tgt.0..last.tgt.1);
    let text = text.trim();
    let units = target_cps_chars(text, &input.lang);
    let params = &input.params;
    if units > params.hard {
        return None;
    }
    let soft = params.soft.max(1) as f64;
    // 目标宽度项。`Auto` 双向罚：偏离 soft 越远越贵，因此窄片在 DP 里几乎总会
    // 被合回去（zh soft=14，一条 8u 的译文切成两片各付 ((4-14)/14)² ≈ 0.51，
    // 合成一片只付 ((8-14)/14)² ≈ 0.18）。
    //
    // `Paired` 取消**窄于 soft** 方向的罚（该项取 0），因为 paired 的定义就是
    // 「允许比 soft 短的行，换取每条源行一条译文行」；窄片的真正上限交给下面
    // 的 `required`（阅读时长 / 读速）缺口罚与 `min_duration_sec` 接管——那是
    // 生理护栏，不是排版偏好。宽于 soft 的方向仍按原式罚，`units > hard` 的
    // 硬约束、超 fit 二次递增、源侧宽度/时窗、缝罚、合并罚与置信度罚全部不动。
    //
    // 这条分支是 paired 在 `--align-only` 路径（check 的 fix 串、refine、
    // 客户端定向重跑）上唯一的放宽点：那条路径走 `plan_sentence` →
    // [`bilingual_dp`] → 本函数，够不到 [`merge_short_rows`]。
    let mut cost = if input.density == AlignDensity::Paired && (units as f64) < soft {
        0.0
    } else {
        ((units as f64 - soft) / soft).powi(2)
    };
    if exceeds_one_line_fit(text, &input.lang, params.fit) {
        // 超 fit 按超出幅度二次递增：刚过 fit 仍付 [`OVER_FIT_PENALTY`]（灰带
        // 低端不改变既有取舍），顶到 hard 付三倍。平罚时「整行卡在 hard 上」
        // （1.5）永远轻于源侧一个悬垂系词的坏缝（[`BLOCKING_SEAM_PENALTY`] +
        // 0.8），DP 便宁可保留超 fit 整行；而 check 的 paired-density 恰恰要求在
        // 那个译文缝上切开，refine 重跑也只会得到同一组块。hard 是天花板不是
        // 目标：贴到天花板的行必须重于一个坏源缝。
        let span = params.hard.saturating_sub(params.fit).max(1) as f64;
        let over = (units.saturating_sub(params.fit) as f64 / span).min(1.0);
        cost += OVER_FIT_PENALTY * (1.0 + 2.0 * over * over);
    }
    // 源侧版式：区间宽度与时窗（沿用双语成对审阅的 4s / 6s 判据）。
    let (from, to) = (first.src.0, last.src.1);
    let source_width: usize = word_units[from..=to].iter().sum();
    if source_width > input.source_fit {
        cost += SOURCE_OVER_FIT_PENALTY;
    }
    let span = (input.words[to].t1 - input.words[from].t0).max(0.0);
    let soft_s = crate::engines::align::PAIRED_SOURCE_MAX_SECONDS;
    let hard_s = crate::engines::align::PAIRED_SOURCE_HARD_SECONDS;
    if span > hard_s {
        cost += 1.5 + 0.5 * (span - hard_s);
    } else if span > soft_s {
        cost += 0.5 * (span - soft_s) / (hard_s - soft_s);
    }
    // 共享时窗：短于目标语最低阅读时长 / 长于最长停留。
    let required = target_required_seconds(text, &input.lang).max(input.min_duration_sec);
    if span < required {
        cost += (required - span) * DURATION_DEFICIT_WEIGHT;
    }
    if span > input.max_duration_sec {
        cost += (span - input.max_duration_sec) * DURATION_EXCESS_WEIGHT;
    }
    cost += BLOCK_MERGE_PENALTY * (j - i - 1) as f64;
    // 左边界缝罚分（片首不计）。
    if i > 0 {
        cost += seam_costs
            .get(&first.tgt.0)
            .copied()
            .unwrap_or(BLOCKING_SEAM_PENALTY);
        // 顿号与 `seam::lint_pieces` 同口径：并列项被拆开、而左右两片合并后仍
        // 不超 hard 时，顿号不是缝（Blocking）。候选缝表算的是「左片 | 整个
        // 余下部分」，余下部分几乎总是超 hard，于是顿号被按从句标点便宜地计
        // 价；DP 在这里知道右片的真实宽度，左片取 dp 为块 i 选定的前驱片——
        // 两者之和 ≤ hard 就按阻塞缝计，否则 check 会把这一刀报成
        // align-target-seam，而重跑 align 只会得到同一组块。
        let left_start = left_piece_start.unwrap_or(i - 1);
        let prev = char_slice(target_chars, blocks[left_start].tgt.0..blocks[i - 1].tgt.1);
        if ends_list_separator(&prev)
            && target_cps_chars(prev.trim(), &input.lang) + units <= params.hard
        {
            cost += BLOCKING_SEAM_PENALTY;
        }
        cost += source_seam_cost(&input.words, first.src.0);
        let confidence = blocks[i - 1]
            .confidence
            .unwrap_or(1.0)
            .min(first.confidence.unwrap_or(1.0));
        cost += (1.0 - f64::from(confidence)).max(0.0);
    }
    Some(cost)
}

/// 双语 DP（设计 §4.4）：`dp[j] = min_i dp[i] + pairCost(blocks[i..j))`。返回
/// 各片包含的连续块下标；某个单块自身违反硬约束（目标 > hard）时无解。
/// `blocks` 的目标区间须为 `input.target` 字符坐标（[`minimal_monotonic_blocks`]
/// 的直接输出）。
///
/// 驻留谓词（源行信息可用时）：常规 DP 的方案里若有片命中
/// `align-row-deficit`（驻留 ≥5s 且覆盖 ≥2 条源行，且片数少于源行数），再跑
/// 一遍「黏结优先」的 DP——命中谓词的片加 [`ROW_DEFICIT_SPLIT_PENALTY`]，且
/// 只允许可读的新片（见 [`readable_piece`]；常规方案里原有的片不受限，保证
/// 第二遍至少有常规解可退）。第二遍的黏结片数严格更少才采用，否则保留常规
/// 方案——宽度 fit 不再是唯一判据，但切不出可读片时不硬切。
pub fn bilingual_dp(blocks: &[AlignBlock], input: &BilingualPlanInput) -> Option<Vec<Vec<usize>>> {
    let m = blocks.len();
    if m == 0 || input.words.is_empty() {
        return None;
    }
    let target_chars: Vec<char> = input.target.chars().collect();
    let word_units = input.word_units();
    let seam_costs: BTreeMap<usize, f64> = target_cut_candidates(
        &input.target,
        &input.lang,
        &input.params,
        &input.protected_terms,
    )
    .into_iter()
    .map(|candidate| (candidate.pos, candidate.seam_cost))
    .collect();
    let base = |i: usize, j: usize, left: Option<usize>| {
        pair_cost(
            blocks,
            i,
            j,
            left,
            input,
            &target_chars,
            &word_units,
            &seam_costs,
        )
    };
    let groups = run_bilingual_dp(m, &base)?;
    let source_rows = input.sentence_source_rows();
    let deficits = |groups: &[Vec<usize>]| -> usize {
        if groups.len() >= source_rows {
            return 0;
        }
        groups
            .iter()
            .filter(|group| {
                input.piece_dwell_deficit(
                    blocks[group[0]].src.0,
                    blocks[group[group.len() - 1]].src.1,
                )
            })
            .count()
    };
    let before = deficits(&groups);
    if before == 0 {
        return Some(groups);
    }
    let original: BTreeSet<(usize, usize)> = groups
        .iter()
        .map(|group| (group[0], group[group.len() - 1] + 1))
        .collect();
    let dwell_aware = |i: usize, j: usize, left: Option<usize>| {
        let cost = base(i, j, left)?;
        let (from, to) = (blocks[i].src.0, blocks[j - 1].src.1);
        if input.piece_dwell_deficit(from, to) {
            return Some(cost + ROW_DEFICIT_SPLIT_PENALTY);
        }
        if !original.contains(&(i, j)) && !readable_piece(blocks, i, j, input, &target_chars) {
            return None;
        }
        Some(cost)
    };
    match run_bilingual_dp(m, &dwell_aware) {
        Some(split) if deficits(&split) < before => Some(split),
        _ => Some(groups),
    }
}

/// 黏结优先 DP 里一片命中驻留谓词的附加罚分：大于任何一组软罚（缝罚、置信
/// 度、宽度、时窗）之和的量级，使「少一条黏结行」优先于排版偏好；硬约束
/// （超 hard）与可读性门槛不受它影响。
const ROW_DEFICIT_SPLIT_PENALTY: f64 = 10.0;

/// 黏结优先 DP 新切出的片必须可读：宽度 ≥ [`ROW_MIN_UNITS`]、时窗 ≥
/// `min_duration_sec`、读速 ≤ [`ROW_MAX_CPS`]——与 [`merge_short_rows`] 的
/// 「太小 / 太快」同一组阈值，切出来的片不会被后处理再粘回去。
fn readable_piece(
    blocks: &[AlignBlock],
    i: usize,
    j: usize,
    input: &BilingualPlanInput,
    target_chars: &[char],
) -> bool {
    let group: Vec<usize> = (i..j).collect();
    let (units, seconds) = row_metrics(blocks, &group, input, target_chars);
    units >= ROW_MIN_UNITS
        && seconds >= input.min_duration_sec
        && seconds > 0.0
        && units as f64 / seconds <= ROW_MAX_CPS
}

/// `dp[j] = min_i dp[i] + cost(i, j, 前驱片首块)`；无解返回 `None`。
fn run_bilingual_dp(
    m: usize,
    cost_of: &dyn Fn(usize, usize, Option<usize>) -> Option<f64>,
) -> Option<Vec<Vec<usize>>> {
    const INF: f64 = f64::INFINITY;
    let mut dp = vec![INF; m + 1];
    let mut back = vec![0usize; m + 1];
    dp[0] = 0.0;
    for j in 1..=m {
        for i in 0..j {
            if dp[i] == INF {
                continue;
            }
            let left_piece_start = (i > 0).then(|| back[i]);
            let Some(cost) = cost_of(i, j, left_piece_start) else {
                continue;
            };
            let candidate = dp[i] + cost;
            if candidate < dp[j] {
                dp[j] = candidate;
                back[j] = i;
            }
        }
    }
    if dp[m] == INF {
        return None;
    }
    let mut groups = Vec::new();
    let mut j = m;
    while j > 0 {
        let i = back[j];
        groups.push((i..j).collect::<Vec<usize>>());
        j = i;
    }
    groups.reverse();
    Some(groups)
}

/// 块 + DP 分组 ⇒ [`TransAlign`]（manyToOne、块级对应）。块的目标区间从
/// `target` 坐标换算到 `concat(pieces.text)` 坐标：片文本首尾空白被修剪时，
/// 只影响该片首块起点 / 末块终点。
pub fn plan_entry(
    blocks: &[AlignBlock],
    groups: &[Vec<usize>],
    input: &BilingualPlanInput,
) -> TransAlign {
    let target_chars: Vec<char> = input.target.chars().collect();
    let mut pieces = Vec::with_capacity(groups.len());
    let mut out_blocks = Vec::with_capacity(blocks.len());
    let mut concat_len = 0usize;
    for group in groups {
        let (Some(&first), Some(&last)) = (group.first(), group.last()) else {
            continue;
        };
        let g_start = blocks[first].tgt.0;
        let g_end = blocks[last].tgt.1;
        let raw = char_slice(&target_chars, g_start..g_end);
        let leading = raw.chars().take_while(|ch| ch.is_whitespace()).count();
        let text = raw.trim().to_owned();
        let text_len = text.chars().count();
        // 片文本第一个非空白字符在 target 里的位置；片首块起点夹到 0，片末块
        // 终点夹到修剪后的长度。
        let base = g_start + leading;
        for &index in group {
            let block = &blocks[index];
            let start = block.tgt.0.saturating_sub(base).min(text_len);
            let end = block.tgt.1.saturating_sub(base).min(text_len).max(start);
            out_blocks.push(AlignBlock {
                src: block.src,
                tgt: (concat_len + start, concat_len + end),
                confidence: block.confidence,
                flags: block.flags.clone(),
            });
        }
        pieces.push(TransPiece {
            from: Some(blocks[first].src.0),
            to: Some(blocks[last].src.1),
            text,
        });
        concat_len += text_len;
    }
    let mut entry = TransAlign::new(
        AlignMode::ManyToOne,
        input.words.iter().map(|word| word.id.clone()).collect(),
        pieces,
    );
    entry.correspondence = Some(Correspondence::Block);
    entry.text_basis = input.text_basis;
    entry.aligner = Some(input.aligner.clone());
    entry.blocks = out_blocks;
    entry
}

/// 整句对应条目（设计 §4.5 兜底）：一个块、一片、`correspondence: sentence`。
pub fn sentence_level_entry(input: &BilingualPlanInput, confidence: Option<f32>) -> TransAlign {
    let text = input.target.trim().to_owned();
    let text_len = text.chars().count();
    let last = input.words.len().saturating_sub(1);
    let mut entry = TransAlign::new(
        AlignMode::ManyToOne,
        input.words.iter().map(|word| word.id.clone()).collect(),
        vec![TransPiece {
            from: Some(0),
            to: Some(last),
            text,
        }],
    );
    entry.correspondence = Some(Correspondence::Sentence);
    entry.text_basis = input.text_basis;
    entry.aligner = Some(input.aligner.clone());
    entry.blocks = vec![AlignBlock {
        src: (0, last),
        tgt: (0, text_len),
        confidence,
        flags: Vec::new(),
    }];
    entry
}

/// [`plan_sentence`] 的结果。
#[derive(Debug, Clone, PartialEq)]
pub enum PlanOutcome {
    /// 块级对应方案已落成。
    Aligned(TransAlign),
    /// 某个（合并后的）块的目标文本超过 hard，放不进一条字幕：需要单调化
    /// 显示改写（设计 §6.3）；调用方改写后重新跑 edges → blocks → DP。
    NeedsRewrite {
        /// 超限块下标（`blocks` 内）。
        over_hard_block: usize,
        /// 该块的目标阅读单位数。
        units: usize,
        /// 全部块（`target` 字符坐标），供改写任务描述超限块及其源区间。
        blocks: Vec<AlignBlock>,
    },
    /// 整句对应：无对齐证据、方案置信度低于 τ_s，或 DP 无解。
    SentenceLevel(TransAlign),
}

fn block_units(block: &AlignBlock, target_chars: &[char], lang: &str) -> usize {
    let text = char_slice(target_chars, block.tgt.0..block.tgt.1);
    target_cps_chars(text.trim(), lang)
}

/// 决策树（设计 §4.5，不含 LLM 改写步骤）。
pub fn plan_sentence(edges: &[AlignEdge], input: &BilingualPlanInput) -> PlanOutcome {
    let candidates: Vec<usize> = target_cut_candidates(
        &input.target,
        &input.lang,
        &input.params,
        &input.protected_terms,
    )
    .into_iter()
    .map(|candidate| candidate.pos)
    .collect();
    plan_sentence_at_cuts(edges, input, &candidates)
}

/// Plan using an explicit, already validated candidate set. Evidence-aware
/// carriers must use this entry so missing evidence cannot recreate cuts via
/// the legacy one-sided/no-edge safety rule.
pub fn plan_sentence_at_cuts(
    edges: &[AlignEdge],
    input: &BilingualPlanInput,
    candidates: &[usize],
) -> PlanOutcome {
    let n = input.words.len();
    let target_chars: Vec<char> = input.target.chars().collect();
    let target_len = target_chars.len();
    let edges: Vec<AlignEdge> = edges
        .iter()
        .filter(|edge| edge.src < n && edge.tgt.start < edge.tgt.end && edge.tgt.end <= target_len)
        .cloned()
        .collect();
    let counted = edges.iter().filter(|edge| edge.counted(input.tau)).count();
    if n == 0 || input.target.trim().is_empty() || counted == 0 {
        return PlanOutcome::SentenceLevel(sentence_level_entry(input, None));
    }
    let blocks =
        minimal_monotonic_blocks(&edges, &input.words, &input.target, candidates, input.tau);
    if blocks.is_empty() {
        return PlanOutcome::SentenceLevel(sentence_level_entry(input, None));
    }
    let confidence = blocks
        .iter()
        .filter_map(|block| block.confidence)
        .fold(1.0f32, f32::min);
    if confidence < input.sentence_tau {
        return PlanOutcome::SentenceLevel(sentence_level_entry(input, Some(confidence)));
    }
    if let Some((index, units)) = blocks
        .iter()
        .enumerate()
        .map(|(index, block)| (index, block_units(block, &target_chars, &input.lang)))
        .filter(|&(_, units)| units > input.params.hard)
        .max_by_key(|&(index, units)| (units, std::cmp::Reverse(index)))
    {
        return PlanOutcome::NeedsRewrite {
            over_hard_block: index,
            units,
            blocks,
        };
    }
    match bilingual_dp(&blocks, input) {
        Some(groups) => PlanOutcome::Aligned(plan_entry(&blocks, &groups, input)),
        None => PlanOutcome::SentenceLevel(sentence_level_entry(input, Some(confidence))),
    }
}

/// 块内切分用的缝按来源与干净程度分档，档间先后高于 fit 与缝的代价
/// （设计 §8.7–§8.9）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum SplitSeam {
    /// 有标点或词间空白撑着、lint 干净的目标缝。
    Backed,
    /// 模型自己给的切点（块边界或抄进译文的片标，[`hinted_cut_candidates`]），
    /// 且 lint 干净、不在词内。
    Hinted,
    /// 模型给的切点，但带 lint 放行的悬垂尾或落在词内启发式判定的缝上
    /// （`bcut check` 会把前者报成 `align-target-seam`）。
    HintedFlagged,
    /// 模型给的切点，但被客观语病 lint 拒了（弱尾 / 黏着首 / 残缺名词组 /
    /// 列表分隔 / 未闭合定界符）：不算放行，只在有证据切点的梯子里顶替
    /// 逐字缝（§8.9 用户裁决——模型的切点再差也是一个词边界）。
    HintedRefused,
    /// 既无依托也无提示、只是 lint 没否掉的逐字缝（CJK 词内风险）。
    Character,
}

impl SplitSeam {
    /// 排序档：干净缝（有依托、干净的提示）一律先于带语病的提示缝，再是被拒
    /// 的提示缝，逐字缝垫底；不论 fit。
    fn rank(self) -> u8 {
        match self {
            Self::Backed | Self::Hinted => 0,
            Self::HintedFlagged => 1,
            Self::HintedRefused => 2,
            Self::Character => 3,
        }
    }

    /// 没放行的缝：只靠提示进的梯子不用（这类句原本走改写轮）。
    fn unadmitted(self) -> bool {
        matches!(self, Self::HintedRefused | Self::Character)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Backed => "backed",
            Self::Hinted => "model-hinted",
            Self::HintedFlagged => "model-hinted-flagged",
            Self::HintedRefused => "model-hinted-refused",
            Self::Character => "character-level",
        }
    }
}

/// 块内切分用掉的一个额外切点。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SplitCut {
    pub pos: usize,
    pub seam: SplitSeam,
}

/// `cuts` 按档计数的英文短语（advisory 用），如 `1 backed, 1 model-hinted seam(s)`。
pub fn describe_split_cuts(cuts: &[SplitCut]) -> String {
    let parts: Vec<String> = [
        SplitSeam::Backed,
        SplitSeam::Hinted,
        SplitSeam::HintedFlagged,
        SplitSeam::HintedRefused,
        SplitSeam::Character,
    ]
    .into_iter()
    .filter_map(|seam| {
        let count = cuts.iter().filter(|cut| cut.seam == seam).count();
        (count > 0).then(|| format!("{count} {}", seam.label()))
    })
    .collect();
    format!("{} seam(s)", parts.join(", "))
}

/// [`plan_sentence_at_cuts`] 之后的块内切分：证据载体的模型切点都放行了（或
/// 模型另给了切点提示）、某个块仍超 hard 时（模型把一块写粗了，或它的某个
/// 切点落在 lint 否掉的缝上），在**该块内部**取一个目标缝把块一分为二，其余
/// 块与模型切点原样保留。切点落在某块引用的目标区间里时，那块的两条软边按
/// 切点拆成两半（左半归块首词、右半归块末词），新切点因此不再被横跨；块内
/// 的源断点由 [`choose_source_break`] 在按比例的落点附近吸附到源侧标点 /
/// 停顿 / 合法缝，块外的证据一字不动。
///
/// 只切「一刀就够」的块：两侧都得 ≤ hard、候选不被硬锚横跨、被拆的块至少
/// 两个源词（单词块只有一条边，切开后无从判安全；拆过一次的块每一半也只剩
/// 一条边，所以需要两刀的块这里切不了）。同样合格的候选先按档
/// （[`SplitSeam`]：干净的有依托缝与干净的提示缝同档，带语病的提示缝其次，
/// 被 lint 拒的提示缝再次，逐字垫底），再挑两侧都 ≤ fit 的，再比缝的代价与
/// 离块中点的距离——档在前，否则一条两侧都放得下的词内缝会赢过一侧略超
/// fit 的标点缝（`看到什|么机会`），一条两侧都放得下、但以「的」收尾的提示
/// 缝也会赢过一侧略超 fit 的逗号缝。`cuts` 为空（没有一个证据切点放行、只靠
/// 模型提示进的梯子）时不用没放行的缝（被拒的提示、逐字）：这类句原本走改
/// 写轮，提示吸不上时拿词内缝换不来省掉的调用。需要两刀、没有候选、或切完
/// 仍不安全的块保持 `NeedsRewrite`（改写轮的事：语序交叉与重度并块）。返回
/// 方案与用掉的额外切点。
pub fn plan_sentence_splitting_over_hard(
    edges: &[AlignEdge],
    input: &BilingualPlanInput,
    cuts: &[usize],
    candidates: &[CutCandidate],
    hinted: &HintedCuts,
) -> (PlanOutcome, Vec<SplitCut>) {
    let target_chars: Vec<char> = input.target.chars().collect();
    let mut edges = edges.to_vec();
    let mut cuts = cuts.to_vec();
    let unadmitted_allowed = !cuts.is_empty();
    let mut extra = Vec::new();
    let mut tried: BTreeSet<usize> = BTreeSet::new();
    // 一个位置只算一次，取它最高的档。
    let mut tiered: BTreeMap<usize, (SplitSeam, &CutCandidate)> = BTreeMap::new();
    for candidate in candidates {
        let seam = if candidate.seam_cost < BLOCKING_SEAM_PENALTY {
            SplitSeam::Backed
        } else {
            SplitSeam::Character
        };
        tiered.insert(candidate.pos, (seam, candidate));
    }
    let hinted_tiers = hinted
        .admitted
        .iter()
        .map(|candidate| {
            let seam = if candidate.seam_cost < BLOCKING_SEAM_PENALTY {
                SplitSeam::Hinted
            } else {
                SplitSeam::HintedFlagged
            };
            (seam, candidate)
        })
        .chain(
            hinted
                .refused
                .iter()
                .map(|candidate| (SplitSeam::HintedRefused, candidate)),
        );
    for (seam, candidate) in hinted_tiers {
        tiered
            .entry(candidate.pos)
            .and_modify(|entry| {
                if entry.0 > seam {
                    *entry = (seam, candidate);
                }
            })
            .or_insert((seam, candidate));
    }
    loop {
        let (over_hard_block, units, blocks) = match plan_sentence_at_cuts(&edges, input, &cuts) {
            PlanOutcome::NeedsRewrite {
                over_hard_block,
                units,
                blocks,
            } => (over_hard_block, units, blocks),
            done => return (done, extra),
        };
        let stuck = PlanOutcome::NeedsRewrite {
            over_hard_block,
            units,
            blocks: blocks.clone(),
        };
        let (from, to) = blocks[over_hard_block].tgt;
        let mid = (from + to) / 2;
        let width = |range: Range<usize>| {
            target_cps_chars(char_slice(&target_chars, range).trim(), &input.lang)
        };
        // 候选排序：先按缝的档次，再两侧都放得进一行 fit 的优先（否则切完仍
        // 报 `align-overfit`，只是不再超 hard），其次缝的代价，最后离块中点近。
        let mut options: Vec<(SplitSeam, usize, &CutCandidate, Vec<AlignEdge>)> = tiered
            .values()
            .filter(|(seam, candidate)| {
                (unadmitted_allowed || !seam.unadmitted())
                    && from < candidate.pos
                    && candidate.pos < to
                    && !cuts.contains(&candidate.pos)
                    && tried.insert(candidate.pos)
            })
            .filter_map(|&(seam, candidate)| {
                let left = width(from..candidate.pos);
                let right = width(candidate.pos..to);
                if left > input.params.hard || right > input.params.hard {
                    return None;
                }
                let over_fit =
                    usize::from(left > input.params.fit) + usize::from(right > input.params.fit);
                let split = split_edges_at(&edges, candidate.pos)?;
                boundary_stat(&split, candidate.pos, input.tau)
                    .safe()
                    .then_some((seam, over_fit, candidate, split))
            })
            .collect();
        options.sort_by(|a, b| {
            a.0.rank()
                .cmp(&b.0.rank())
                .then_with(|| a.1.cmp(&b.1))
                .then_with(|| a.2.seam_cost.total_cmp(&b.2.seam_cost))
                .then_with(|| a.2.pos.abs_diff(mid).cmp(&b.2.pos.abs_diff(mid)))
        });
        let Some((seam, _, candidate, split)) = options.into_iter().next() else {
            return (stuck, extra);
        };
        edges = split;
        cuts.push(candidate.pos);
        extra.push(SplitCut {
            pos: candidate.pos,
            seam,
        });
    }
}

/// 把横跨目标位置 `k` 的软边一分为二：同一目标区间的一组边（一个块的首词边
/// 与末词边）拆成「块首词 ↔ 左半」「块末词 ↔ 右半」。硬锚横跨 `k`、或某组只有
/// 一条边（单词块）时不可拆，返回 `None`。
fn split_edges_at(edges: &[AlignEdge], k: usize) -> Option<Vec<AlignEdge>> {
    let straddles = |edge: &AlignEdge| edge.tgt.start < k && k < edge.tgt.end;
    if edges.iter().any(|edge| edge.hard && straddles(edge)) {
        return None;
    }
    let mut out: Vec<AlignEdge> = edges
        .iter()
        .filter(|edge| !straddles(edge))
        .cloned()
        .collect();
    let mut groups: BTreeMap<(usize, usize), Vec<&AlignEdge>> = BTreeMap::new();
    for edge in edges.iter().filter(|edge| straddles(edge)) {
        groups
            .entry((edge.tgt.start, edge.tgt.end))
            .or_default()
            .push(edge);
    }
    for ((start, end), group) in groups {
        let lo = group.iter().map(|edge| edge.src).min()?;
        let hi = group.iter().map(|edge| edge.src).max()?;
        if lo >= hi {
            return None;
        }
        let weight = group.iter().map(|edge| edge.weight).fold(1.0f32, f32::min);
        out.push(AlignEdge::soft(lo, start..k, weight));
        out.push(AlignEdge::soft(hi, k..end, weight));
    }
    Some(out)
}

/// 行分区方案（融合 rows 模式）：模型已经把译文按源词顺序切成显示行，
/// 引擎只负责**把行边界固定住**并在行内补细粒度子块。
///
/// `row_ranges` 是各行在 `input.target` 上的字符区间（[`crate::filepipe::align_edges::chunk_char_ranges`]
/// 的输出），按行序升序、互不重叠。流程：
///
/// 1. 候选切点 = 常规目标语候选 ∪ 各行起点，跑 [`minimal_monotonic_blocks`]；
/// 2. 每个行起点都必须真的成为块边界（被锚点边横跨、或源断点与锚点冲突时不会
///    成为块边界）——否则整句返回 `None`，调用方回落常规路径；
/// 3. 行内超 hard 才在该行的块子序列上跑 [`bilingual_dp`] 再切；这一步**绝不
///    跨行**（切出来的碎片只能落在原行内部），某行无解 ⇒ 整句 `None`；
/// 4. [`merge_short_rows`]：确定性后处理，把太短/太快的相邻行合并成一片。
///
/// 块粒度：行边把整行的目标区间覆盖成一条边，行**内部**的候选切点必然被它
/// 横跨（不安全），因此第 1–3 步产出的块与模型给的行一一对应——`blocks` 是
/// 行级而不是短语级。同理，超 hard 的行在行内没有任何独立证据可切，第 3 步
/// 实际总是落到 `None`（回落常规路径）而不是用比例锚定硬拗一刀。
///
/// 第 4 步只合并**片**（`groups`），不动 `blocks`：片 = 若干连续块的并本来
/// 就是 [`plan_entry`] 的常规形态，I3/I4 自动成立；块层因此仍然逐行记录模型
/// 给出的源词↔译文对应，下游双语高亮不会因为合并而变粗。
///
/// 成功时 `aligner` / `text_basis` 取自 `input`，`correspondence` 为
/// [`Correspondence::Block`]（[`plan_entry`] 负责）。
///
/// **本函数不是 `density == Paired` 的主路径。** 它只在 translate 携带融合
/// rows 草稿时可达；paired 的真实入口（`--align-only`：check 的 fix 串、
/// `refine-align`、客户端定向重跑）传空 `FusionDrafts`，走
/// [`plan_sentence`] → [`bilingual_dp`] → `pair_cost`。[`merge_short_rows`]
/// 里的 paired 分支因此只服务 rows 草稿路径；paired 的宽度放宽在 `pair_cost`。
pub fn plan_sentence_rows(
    edges: &[AlignEdge],
    row_ranges: &[Range<usize>],
    input: &BilingualPlanInput,
) -> Option<RowPlan> {
    let n = input.words.len();
    let target_chars: Vec<char> = input.target.chars().collect();
    let target_len = target_chars.len();
    if n == 0 || target_len == 0 || row_ranges.is_empty() {
        return None;
    }
    let edges: Vec<AlignEdge> = edges
        .iter()
        .filter(|edge| edge.src < n && edge.tgt.start < edge.tgt.end && edge.tgt.end <= target_len)
        .cloned()
        .collect();
    if edges.iter().filter(|edge| edge.counted(input.tau)).count() == 0 {
        return None;
    }

    // 行起点（首行除外）就是必须落在块边界上的位置；行间的空白/标点归左行。
    let mut row_starts: Vec<usize> = Vec::with_capacity(row_ranges.len());
    let mut previous_end = 0usize;
    for (index, range) in row_ranges.iter().enumerate() {
        if range.start < previous_end || range.end > target_len || range.start >= range.end {
            return None;
        }
        row_starts.push(if index == 0 { 0 } else { range.start });
        previous_end = range.end;
    }

    let mut candidates: Vec<usize> = target_cut_candidates(
        &input.target,
        &input.lang,
        &input.params,
        &input.protected_terms,
    )
    .into_iter()
    .map(|candidate| candidate.pos)
    .collect();
    candidates.extend(row_starts.iter().skip(1).copied());
    candidates.sort_unstable();
    candidates.dedup();

    let blocks =
        minimal_monotonic_blocks(&edges, &input.words, &input.target, &candidates, input.tau);
    if blocks.is_empty() {
        return None;
    }

    // 每个行起点都必须是某个块的起点；同时记下该块下标以便按行分组。
    let mut row_block_starts = Vec::with_capacity(row_starts.len());
    for &start in &row_starts {
        row_block_starts.push(blocks.iter().position(|block| block.tgt.0 == start)?);
    }
    if row_block_starts.windows(2).any(|pair| pair[0] >= pair[1]) {
        return None;
    }

    let mut groups: Vec<Vec<usize>> = Vec::with_capacity(blocks.len());
    for (row, &first) in row_block_starts.iter().enumerate() {
        let last = row_block_starts
            .get(row + 1)
            .copied()
            .unwrap_or(blocks.len());
        let text = char_slice(&target_chars, blocks[first].tgt.0..blocks[last - 1].tgt.1);
        if target_cps_chars(text.trim(), &input.lang) <= input.params.hard {
            groups.push((first..last).collect());
            continue;
        }
        // 行本身超 hard：只在这一行的块子序列上再切，行边界仍然不动。
        let inner = bilingual_dp(&blocks[first..last], input)?;
        for group in inner {
            groups.push(group.into_iter().map(|index| index + first).collect());
        }
    }
    let rows = groups.len();
    let groups = merge_short_rows(&blocks, groups, input, &target_chars);
    Some(RowPlan {
        merged_rows: rows - groups.len(),
        entry: plan_entry(&blocks, &groups, input),
    })
}

/// [`plan_sentence_rows`] 的结果：条目 + 确定性后处理合并掉的行数。
#[derive(Debug, Clone, PartialEq)]
pub struct RowPlan {
    pub entry: TransAlign,
    /// 模型给的行数 − 最终片数。`0` = 模型的切法原样采用。
    pub merged_rows: usize,
}

/// 一行"太短"的读速上限（阅读单位/秒）：超过它就是一闪而过。
const ROW_MAX_CPS: f64 = 6.0;
/// 一行"太短"的宽度下限（阅读单位）。
pub const ROW_MIN_UNITS: usize = 6;

/// 一片（连续块的并）的目标文本、阅读单位与共享时窗秒数。
fn row_metrics(
    blocks: &[AlignBlock],
    group: &[usize],
    input: &BilingualPlanInput,
    target_chars: &[char],
) -> (usize, f64) {
    let (Some(&first), Some(&last)) = (group.first(), group.last()) else {
        return (0, 0.0);
    };
    let text = char_slice(target_chars, blocks[first].tgt.0..blocks[last].tgt.1);
    let units = target_cps_chars(text.trim(), &input.lang);
    let from = blocks[first].src.0;
    let to = blocks[last].src.1;
    let seconds = (input.words[to].t1 - input.words[from].t0).max(0.0);
    (units, seconds)
}

/// 确定性行合并（rows 模式后处理）。
///
/// 模型实测基本按源侧分组一对一切行（第三轮对拍：每句 4.3 行 vs 常规融合
/// 2.3 行，cps>6 中位 10.7%），契约里的"偏向合并"措辞几乎无效。宽度、读速与
/// 时长都是可算的，因此改由引擎确定性收口，不再多花一次调用去劝模型。
///
/// 判据（对同句相邻两片 `i` / `i+1`，两侧任一片"太短"即触发）：
///
/// - **太快** = 读速 > [`ROW_MAX_CPS`]；
/// - **太小** = 时长 < `min_duration_sec`（缺省 1.0s）或宽度 < [`ROW_MIN_UNITS`]；
/// - 合并守卫**分级**：由"太快"触发的合并允许到 `params.hard`（20），只由
///   "太小"触发的仍守 `params.fit`（16）。这与 `on` 那条 DP 的取舍口径一致
///   ——[`pair_cost`] 里超 fit 只是罚分、只有超 hard 才是硬约束，读速则没有
///   便宜的补救手段。第四轮对拍里 rows 的 overFit 已压到 1–2%，而 cps>6 仍有
///   12–13%（`on` 中位 7.9%），把宽度让给读速正是缺的那一步；
/// - 两级都还要满足合并后时长 ≤ `max_duration_sec`（缺省 7s）；
/// - 一片左右都能合时，取**合并后读速更低**的一侧（平局取左，保证确定性）；
/// - 迭代到没有合法合并为止（每次合并减少一片，必然收敛）。
///
/// 超 hard 被 DP 再切出来的碎片不会被这里粘回去：两级守卫都 ≤ hard，而那些
/// 碎片正是因为合起来超 hard 才被切开的。
fn merge_short_rows(
    blocks: &[AlignBlock],
    mut groups: Vec<Vec<usize>>,
    input: &BilingualPlanInput,
    target_chars: &[char],
) -> Vec<Vec<usize>> {
    if input.words.is_empty() {
        return groups;
    }
    let metrics = |group: &[usize]| row_metrics(blocks, group, input, target_chars);
    // 太快：读速超上限，只能靠拉长时窗补救 ⇒ 合并守卫放宽到 hard。
    let too_fast = |group: &[usize]| {
        let (units, seconds) = metrics(group);
        seconds > 0.0 && units as f64 / seconds > ROW_MAX_CPS
    };
    // 太小：一闪而过的碎行 ⇒ 合并守卫仍是 fit。
    let too_small = |group: &[usize]| {
        let (units, seconds) = metrics(group);
        seconds < input.min_duration_sec
            || (input.density == AlignDensity::Auto && units < ROW_MIN_UNITS)
    };
    // 合并 `groups[index]` 与 `groups[index + 1]` 是否合法；合法时返回合并后读速。
    let joined_cps = |groups: &[Vec<usize>], index: usize| -> Option<f64> {
        let mut joined = groups[index].clone();
        joined.extend_from_slice(&groups[index + 1]);
        let (units, seconds) = metrics(&joined);
        // 守卫分级：这一对里只要有一片是"太快"，宽度就放到 hard。
        let ceiling = if too_fast(&groups[index]) || too_fast(&groups[index + 1]) {
            input.params.hard
        } else {
            input.params.fit
        };
        if units > ceiling || seconds > input.max_duration_sec {
            return None;
        }
        // 只因「宽度太窄」触发的合并不许合出一条黏结行（`align-row-deficit`
        // 驻留谓词）：窄是排版偏好，黏结是用户可见的缺陷。读速太快 / 时长太短
        // 是生理护栏，仍可合。
        let physiological =
            |group: &[usize]| too_fast(group) || metrics(group).1 < input.min_duration_sec;
        if !physiological(&groups[index])
            && !physiological(&groups[index + 1])
            && groups.len() <= input.sentence_source_rows()
            && input.piece_dwell_deficit(
                blocks[joined[0]].src.0,
                blocks[joined[joined.len() - 1]].src.1,
            )
        {
            return None;
        }
        Some(if seconds > 0.0 {
            units as f64 / seconds
        } else {
            f64::INFINITY
        })
    };
    while groups.len() > 1 {
        let mut chosen: Option<usize> = None;
        for index in 0..groups.len() {
            if !too_fast(&groups[index]) && !too_small(&groups[index]) {
                continue;
            }
            let left = (index > 0)
                .then(|| joined_cps(&groups, index - 1))
                .flatten();
            let right = (index + 1 < groups.len())
                .then(|| joined_cps(&groups, index))
                .flatten();
            chosen = match (left, right) {
                // 平局取左：合并结果与遍历顺序无关。
                (Some(left_cps), Some(right_cps)) => Some(if right_cps < left_cps {
                    index
                } else {
                    index - 1
                }),
                (Some(_), None) => Some(index - 1),
                (None, Some(_)) => Some(index),
                (None, None) => continue,
            };
            break;
        }
        let Some(index) = chosen else {
            break;
        };
        let tail = groups.remove(index + 1);
        groups[index].extend(tail);
    }
    groups
}

/// 块层不变量 I3 / I4（设计 §2、§5）。`blocks` 为空恒有效（旧条目 /
/// independent）；非空时：
///
/// - 只允许 manyToOne；`correspondence: sentence` 时恰一个块；
/// - I3：源区间按序连续覆盖 `0..anchor_count`，目标区间按序连续覆盖
///   `0..concat(pieces.text).chars().count()`，每块目标区间非空；
/// - I4：每片的 `from` 与 `text` 起始字符偏移落在**同一个**块的起点上
///   （片 = 若干连续块的并，两侧一致）。
///
/// 调用方（[`crate::split::align_entry_valid`]）已保证 pieces 连续全覆盖。
pub fn validate_blocks(entry: &TransAlign, anchor_count: usize) -> bool {
    if entry.blocks.is_empty() {
        return true;
    }
    if entry.mode != AlignMode::ManyToOne || anchor_count == 0 {
        return false;
    }
    if entry.correspondence() == Correspondence::Sentence && entry.blocks.len() != 1 {
        return false;
    }
    let concat_len: usize = entry
        .pieces
        .iter()
        .map(|piece| piece.text.chars().count())
        .sum();
    let mut expected_src = 0usize;
    let mut expected_tgt = 0usize;
    for block in &entry.blocks {
        if block.src.0 != expected_src || block.src.1 < block.src.0 {
            return false;
        }
        if block.tgt.0 != expected_tgt || block.tgt.1 <= block.tgt.0 {
            return false;
        }
        expected_src = block.src.1 + 1;
        expected_tgt = block.tgt.1;
    }
    if expected_src != anchor_count || expected_tgt != concat_len {
        return false;
    }
    let mut offset = 0usize;
    let mut previous_index: Option<usize> = None;
    for piece in &entry.pieces {
        let Some(from) = piece.from else {
            return false;
        };
        let by_src = entry.blocks.iter().position(|block| block.src.0 == from);
        let by_tgt = entry.blocks.iter().position(|block| block.tgt.0 == offset);
        match (by_src, by_tgt) {
            (Some(a), Some(b)) if a == b => {
                if previous_index.is_some_and(|prev| a <= prev) {
                    return false;
                }
                previous_index = Some(a);
            }
            _ => return false,
        }
        offset += piece.text.chars().count();
    }
    true
}

/// `transDisplay.transFingerprint` 所用的译文文本指纹。
pub fn trans_text_fingerprint(text: &str) -> String {
    fingerprint_strings([text])
}

/// display-stale（设计 §5）：`transDisplay[lang][sid].transFingerprint` 与当前
/// `trans[lang][sid]` 文本指纹不符（或 `trans` 已不存在）的句 id，按传入句序。
pub fn stale_display_sentences(
    doc: &TranscriptDoc,
    lang: &str,
    sentences: &[Sentence],
) -> Vec<String> {
    let Some(displays) = doc.trans_display.get(lang) else {
        return Vec::new();
    };
    let translations = doc.trans.get(lang);
    sentences
        .iter()
        .filter(|sentence| {
            displays.get(&sentence.id).is_some_and(|display| {
                translations
                    .and_then(|table| table.get(&sentence.id))
                    .is_none_or(|text| trans_text_fingerprint(text) != display.trans_fingerprint)
            })
        })
        .map(|sentence| sentence.id.clone())
        .collect()
}

/// 删除 display-stale 的 `transDisplay`，并连带删除该句 `text_basis == display`
/// 的 `transAlign`（回到自然译句整句上屏）。返回删除的 `transDisplay` 条数。
pub fn purge_stale_display(doc: &mut TranscriptDoc, lang: &str, sentences: &[Sentence]) -> usize {
    let stale = stale_display_sentences(doc, lang, sentences);
    if stale.is_empty() {
        return 0;
    }
    let mut removed = 0usize;
    if let Some(displays) = doc.trans_display.get_mut(lang) {
        for sid in &stale {
            if displays.remove(sid).is_some() {
                removed += 1;
            }
        }
        if displays.is_empty() {
            doc.trans_display.remove(lang);
        }
    }
    if let Some(aligns) = doc.trans_align.get_mut(lang) {
        for sid in &stale {
            if aligns
                .get(sid)
                .is_some_and(|entry| entry.text_basis == TextBasis::Display)
            {
                aligns.remove(sid);
            }
        }
        if aligns.is_empty() {
            doc.trans_align.remove(lang);
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atomize::is_cjk_char;
    use crate::cue::{CueParams, derive_cues};
    use crate::doc::{DocEngine, DocMedia, Speaker, TransDisplay, Word};
    use crate::sentence::derive_sentences;
    use crate::split::{align_entry_valid, align_entry_valid_for_lang, derive_trans_cues};

    /// 等间距 0.4s 的锚定词。
    fn words(texts: &[&str]) -> Vec<AnchorWord> {
        texts
            .iter()
            .enumerate()
            .map(|(index, text)| AnchorWord {
                id: format!("g1.{index}"),
                text: (*text).to_owned(),
                t0: index as f64 * 0.4,
                t1: index as f64 * 0.4 + 0.4,
                glue: false,
            })
            .collect()
    }

    /// `needle` 在 `haystack` 里的字符区间（首个命中）。
    fn span(haystack: &str, needle: &str) -> Range<usize> {
        let byte = haystack
            .find(needle)
            .unwrap_or_else(|| panic!("{needle} in {haystack}"));
        let start = haystack[..byte].chars().count();
        start..start + needle.chars().count()
    }

    fn soft(src: usize, target: &str, needle: &str) -> AlignEdge {
        AlignEdge::soft(src, span(target, needle), 0.8)
    }

    fn concat(entry: &TransAlign) -> String {
        entry.pieces.iter().map(|p| p.text.as_str()).collect()
    }

    fn assert_invariants(entry: &TransAlign, word_count: usize) {
        assert!(validate_blocks(entry, word_count), "I3/I4: {entry:#?}");
        let mut expected = 0usize;
        for piece in &entry.pieces {
            assert_eq!(piece.from, Some(expected), "{entry:#?}");
            expected = piece.to.unwrap() + 1;
        }
        assert_eq!(expected, word_count);
    }

    /// 块内切分：模型切点放行、第二块 30 字超 hard 20 ⇒ 在块内找一个 lint 干净
    /// 的缝再切一刀，第一块与模型切点原样保留，被切块的两条边按切点拆半后
    /// 新切点判安全；单词块与硬锚横跨的位置不可拆。
    #[test]
    fn over_hard_block_is_split_in_place_at_a_clean_target_seam() {
        let src = words(&[
            "alpha", "bravo", "charlie", "delta", "echo,", "foxtrot", "golf", "hotel.",
        ]);
        let target = "第一段译文需要自然对应，第二段译文负责完整收尾这一块写得太长超过了二十个字。";
        let first = "第一段译文需要自然对应，".chars().count();
        let total = target.chars().count();
        let edges = vec![
            AlignEdge::soft(0, 0..first, 0.8),
            AlignEdge::soft(4, 0..first, 0.8),
            AlignEdge::soft(5, first..total, 0.8),
            AlignEdge::soft(7, first..total, 0.8),
        ];
        let input = BilingualPlanInput::new(src.clone(), target, "en", "zh");
        assert!(matches!(
            plan_sentence_at_cuts(&edges, &input, &[first]),
            PlanOutcome::NeedsRewrite {
                over_hard_block: 1,
                ..
            }
        ));
        let candidates = target_cut_candidates(target, "zh", &input.params, &[]);
        let (outcome, extra) = plan_sentence_splitting_over_hard(
            &edges,
            &input,
            &[first],
            &candidates,
            &HintedCuts::default(),
        );
        let PlanOutcome::Aligned(entry) = outcome else {
            panic!("{outcome:?}");
        };
        assert_eq!(extra.len(), 1, "{extra:?}");
        assert_eq!(extra[0].seam, SplitSeam::Character, "{extra:?}");
        let k = extra[0].pos;
        assert!(first < k && k < total);
        assert!(k - first <= input.params.hard && total - k <= input.params.hard);
        assert_eq!(entry.pieces.len(), 3, "{entry:#?}");
        assert_eq!(entry.pieces[0].text, "第一段译文需要自然对应，");
        assert_eq!(entry.pieces[0].to, Some(4));
        assert_eq!(entry.pieces[1].from, Some(5));
        assert_eq!(entry.pieces[2].to, Some(7));
        assert_eq!(concat(&entry), target);
        assert_invariants(&entry, src.len());

        // 单词块只有一条边：拆不开，保持 NeedsRewrite 交给改写轮。
        let single = vec![
            AlignEdge::soft(0, 0..first, 0.8),
            AlignEdge::soft(6, 0..first, 0.8),
            AlignEdge::soft(7, first..total, 0.8),
        ];
        let (outcome, extra) = plan_sentence_splitting_over_hard(
            &single,
            &input,
            &[first],
            &candidates,
            &HintedCuts::default(),
        );
        assert!(extra.is_empty());
        assert!(
            matches!(outcome, PlanOutcome::NeedsRewrite { .. }),
            "{outcome:?}"
        );
        // 硬锚横跨的位置不可拆。
        let mut anchored = edges.clone();
        anchored.push(AlignEdge::hard(6, first + 2..total - 2));
        assert!(split_edges_at(&anchored, first + 10).is_none());
        assert!(split_edges_at(&edges, first + 10).is_some());
    }

    /// 缝的档在 fit 之前：一侧略超 fit 的标点缝赢过两侧都放得下的逐字缝
    /// （`看到什|么机会` 那类词内切）；需要两刀而只有逐字缝的块仍交给改写轮。
    #[test]
    fn a_backed_seam_outranks_a_character_seam_that_fits_both_sides() {
        let src = words(&[
            "alpha", "bravo", "charlie", "delta", "echo,", "foxtrot", "golf", "hotel.",
        ]);
        let head = "第一段译文需要自然对应，";
        let body = "我们在这个项目里面讨论过的所有细节，今天都需要重新确认一遍。";
        let target = format!("{head}{body}");
        let first = head.chars().count();
        let total = target.chars().count();
        let punct = first + "我们在这个项目里面讨论过的所有细节，".chars().count();
        let edges = vec![
            AlignEdge::soft(0, 0..first, 0.8),
            AlignEdge::soft(4, 0..first, 0.8),
            AlignEdge::soft(5, first..total, 0.8),
            AlignEdge::soft(7, first..total, 0.8),
        ];
        let input = BilingualPlanInput::new(src.clone(), &target, "en", "zh");
        assert!(punct - first > input.params.fit && punct - first <= input.params.hard);
        let candidates = target_cut_candidates(&target, "zh", &input.params, &[]);
        let both_fit = |pos: usize| {
            pos > first && pos - first <= input.params.fit && total - pos <= input.params.fit
        };
        assert!(
            candidates
                .iter()
                .any(|c| c.seam_cost >= BLOCKING_SEAM_PENALTY && both_fit(c.pos)),
            "the probe needs a character seam that fits both sides: {candidates:?}"
        );
        let (outcome, extra) = plan_sentence_splitting_over_hard(
            &edges,
            &input,
            &[first],
            &candidates,
            &HintedCuts::default(),
        );
        assert!(matches!(outcome, PlanOutcome::Aligned(_)), "{outcome:?}");
        assert_eq!(
            extra,
            vec![SplitCut {
                pos: punct,
                seam: SplitSeam::Backed
            }]
        );

        // 两刀才够、只有逐字缝：不切。
        let long =
            "这一块译文没有任何标点可以依托一直写到超过两行的长度才算把话说完整了结束为止才行的";
        let target = format!("{head}{long}");
        let total = target.chars().count();
        assert!(total - first > 2 * input.params.hard);
        let edges = vec![
            AlignEdge::soft(0, 0..first, 0.8),
            AlignEdge::soft(4, 0..first, 0.8),
            AlignEdge::soft(5, first..total, 0.8),
            AlignEdge::soft(7, first..total, 0.8),
        ];
        let input = BilingualPlanInput::new(src, &target, "en", "zh");
        let candidates = target_cut_candidates(&target, "zh", &input.params, &[]);
        let (outcome, extra) = plan_sentence_splitting_over_hard(
            &edges,
            &input,
            &[first],
            &candidates,
            &HintedCuts::default(),
        );
        assert!(extra.is_empty(), "{extra:?}");
        assert!(
            matches!(outcome, PlanOutcome::NeedsRewrite { .. }),
            "{outcome:?}"
        );
    }

    /// 只靠模型提示进梯子（证据切点一个都没放行）的块：提示吸不上就保持
    /// `NeedsRewrite`，不拿逐字缝顶（how-claude `s-g33.0` `软|件产品` 那类）；
    /// 提示吸得上则按 `Hinted` 切。
    #[test]
    fn a_hint_only_ladder_never_falls_through_to_a_character_seam() {
        let src = words(&["alpha", "bravo", "charlie", "delta", "echo", "foxtrot."]);
        let target = "这一块译文没有任何标点可以依托一直写到超过一行的长度";
        let total = target.chars().count();
        let edges = vec![
            AlignEdge::soft(0, 0..total, 0.8),
            AlignEdge::soft(5, 0..total, 0.8),
        ];
        let input = BilingualPlanInput::new(src, target, "en", "zh");
        assert!(total > input.params.hard && total <= 2 * input.params.hard);
        let candidates = target_cut_candidates(target, "zh", &input.params, &[]);
        assert!(
            candidates
                .iter()
                .any(|c| c.seam_cost >= BLOCKING_SEAM_PENALTY
                    && c.pos <= input.params.hard
                    && total - c.pos <= input.params.hard),
            "the probe needs a character seam that fits: {candidates:?}"
        );
        let (outcome, extra) = plan_sentence_splitting_over_hard(
            &edges,
            &input,
            &[],
            &candidates,
            &HintedCuts::default(),
        );
        assert!(extra.is_empty(), "{extra:?}");
        assert!(
            matches!(outcome, PlanOutcome::NeedsRewrite { .. }),
            "{outcome:?}"
        );

        let hint = "这一块译文没有任何标点可以依托".chars().count();
        let hinted = hinted_cut_candidates(target, "zh", &input.params, &[], &[hint]);
        assert_eq!(hinted.admitted.len(), 1, "{hinted:?}");
        assert!(hinted.refused.is_empty(), "{hinted:?}");
        let (outcome, extra) =
            plan_sentence_splitting_over_hard(&edges, &input, &[], &candidates, &hinted);
        assert!(matches!(outcome, PlanOutcome::Aligned(_)), "{outcome:?}");
        // 这条提示缝带 lint 放行的悬垂尾，落在 `HintedFlagged` 档：只靠提示的
        // 梯子也用它，但有干净缝时它排在后面。
        assert_eq!(
            extra,
            vec![SplitCut {
                pos: hinted.admitted[0].pos,
                seam: SplitSeam::HintedFlagged
            }]
        );
    }

    /// 被 lint 拒的模型提示（这里是「得」收尾的弱尾）自成一档：有证据切点的
    /// 梯子里它顶替逐字缝（§8.9），只靠提示进的梯子仍不用它、保持
    /// `NeedsRewrite`。
    #[test]
    fn a_refused_hint_outranks_a_character_seam_but_never_carries_a_hint_only_ladder() {
        let src = words(&[
            "alpha", "bravo", "charlie", "delta", "echo,", "foxtrot", "golf", "hotel.",
        ]);
        let target = "第一段译文需要自然对应，第二段译文负责完整收尾这一块写得太长超过了二十个字。";
        let first = "第一段译文需要自然对应，".chars().count();
        let hint = first + "第二段译文负责完整收尾这一块写得".chars().count();
        let total = target.chars().count();
        let edges = vec![
            AlignEdge::soft(0, 0..first, 0.8),
            AlignEdge::soft(4, 0..first, 0.8),
            AlignEdge::soft(5, first..total, 0.8),
            AlignEdge::soft(7, first..total, 0.8),
        ];
        let input = BilingualPlanInput::new(src, target, "en", "zh");
        let candidates = target_cut_candidates(target, "zh", &input.params, &[]);
        assert!(
            candidates.iter().all(|c| c.pos != hint),
            "the probe hint must not be a strict candidate: {candidates:?}"
        );
        let hinted = hinted_cut_candidates(target, "zh", &input.params, &[], &[hint]);
        assert!(hinted.admitted.is_empty(), "{hinted:?}");
        assert_eq!(hinted.refused.len(), 1, "{hinted:?}");
        assert_eq!(hinted.refused[0].pos, hint);

        // 有证据切点：被拒的提示赢过（此前会选中的）逐字缝。
        let (outcome, extra) =
            plan_sentence_splitting_over_hard(&edges, &input, &[first], &candidates, &hinted);
        let PlanOutcome::Aligned(entry) = outcome else {
            panic!("{outcome:?}");
        };
        assert_eq!(
            extra,
            vec![SplitCut {
                pos: hint,
                seam: SplitSeam::HintedRefused
            }]
        );
        assert_eq!(entry.pieces.len(), 3, "{entry:#?}");
        assert_eq!(entry.pieces[1].text, "第二段译文负责完整收尾这一块写得");
        assert_eq!(concat(&entry), target);

        // 只靠提示：不用被拒的提示，也不用逐字缝。
        let (outcome, extra) =
            plan_sentence_splitting_over_hard(&edges, &input, &[], &candidates, &hinted);
        assert!(extra.is_empty(), "{extra:?}");
        assert!(
            matches!(outcome, PlanOutcome::NeedsRewrite { .. }),
            "{outcome:?}"
        );
    }

    #[test]
    fn causal_inversion_collapses_into_one_local_reorder_block() {
        // (a) I didn't go because I was sick. ↔ 因为我病了，所以没去。
        let src = words(&["I", "didn't", "go", "because", "I", "was", "sick."]);
        let target = "因为我病了，所以没去。";
        let edges = vec![
            soft(0, target, "我"),
            soft(1, target, "没"),
            soft(2, target, "去"),
            soft(3, target, "因为"),
            soft(6, target, "病了"),
        ];
        let input = BilingualPlanInput::new(src.clone(), target, "en", "zh");
        let candidates: Vec<usize> = target_cut_candidates(target, "zh", &input.params, &[])
            .into_iter()
            .map(|c| c.pos)
            .collect();
        assert!(
            candidates.contains(&span(target, "所以").start),
            "{candidates:?}"
        );
        assert!(safe_boundaries(&edges, &candidates, DEFAULT_EDGE_TAU).is_empty());
        let blocks = minimal_monotonic_blocks(&edges, &src, target, &candidates, DEFAULT_EDGE_TAU);
        assert_eq!(blocks.len(), 1, "{blocks:?}");
        assert_eq!(blocks[0].src, (0, 6));
        assert_eq!(blocks[0].tgt, (0, target.chars().count()));
        assert!(blocks[0].flags.contains(&"local-reorder".to_owned()));
        assert!(blocks[0].flags.contains(&"weak".to_owned()));
        match plan_sentence(&edges, &input) {
            PlanOutcome::Aligned(entry) => {
                assert_eq!(entry.pieces.len(), 1);
                assert_eq!(entry.blocks.len(), 1);
                assert_eq!(entry.correspondence, Some(Correspondence::Block));
                assert_eq!(concat(&entry), target);
                assert_invariants(&entry, src.len());
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn relative_clause_noun_phrase_is_one_block_while_the_rest_still_splits() {
        // (b) 只有 "the plan we discussed yesterday" ↔ "我们昨天讨论的计划" 交叉。
        let src = words(&[
            "We",
            "should",
            "finalize",
            "the",
            "plan",
            "we",
            "discussed",
            "yesterday,",
            "and",
            "then",
            "notify",
            "the",
            "team.",
        ]);
        let target = "我们应该敲定我们昨天讨论的计划，然后通知团队。";
        let mut edges = vec![
            soft(0, target, "我们"),
            soft(1, target, "应该"),
            soft(2, target, "敲定"),
            soft(9, target, "然后"),
            soft(10, target, "通知"),
            soft(12, target, "团队"),
        ];
        // 名词短语内部：plan ↔ 计划、we ↔ 我们（第二个）、discussed ↔ 讨论、
        // yesterday ↔ 昨天。
        let np_start = span(target, "敲定").end;
        let second_we = np_start..np_start + 2;
        edges.push(AlignEdge::soft(5, second_we.clone(), 0.8));
        edges.push(soft(7, target, "昨天"));
        edges.push(soft(6, target, "讨论"));
        edges.push(soft(4, target, "计划"));
        let input = BilingualPlanInput::new(src.clone(), target, "en", "zh");
        let candidates: Vec<usize> = target_cut_candidates(target, "zh", &input.params, &[])
            .into_iter()
            .map(|c| c.pos)
            .collect();
        let blocks = minimal_monotonic_blocks(&edges, &src, target, &candidates, DEFAULT_EDGE_TAU);
        // 名词短语块：源 the..yesterday（3..7），目标 我们昨天讨论的计划，
        let np = blocks
            .iter()
            .find(|block| block.flags.contains(&"local-reorder".to_owned()))
            .unwrap_or_else(|| panic!("{blocks:#?}"));
        assert_eq!(np.src, (3, 7), "{blocks:#?}");
        let np_text: String = target
            .chars()
            .skip(np.tgt.0)
            .take(np.tgt.1 - np.tgt.0)
            .collect();
        assert!(np_text.starts_with("我们昨天讨论的计划"), "{np_text}");
        // 句子其余部分仍然切开：名词短语前后都还有块。
        assert!(blocks.len() >= 3, "{blocks:#?}");
        assert!(blocks.iter().any(|b| b.src.1 < 3));
        assert!(blocks.iter().any(|b| b.src.0 > 7));
        // 冠词 the 不悬在前一块末尾（源缝合法性把它并入名词短语）。
        assert!(!blocks.iter().any(|b| b.src.1 == 3), "{blocks:#?}");
        match plan_sentence(&edges, &input) {
            PlanOutcome::Aligned(entry) => {
                assert!(entry.pieces.len() >= 2, "{entry:#?}");
                assert_invariants(&entry, src.len());
                for piece in &entry.pieces {
                    assert!(target_cps_chars(&piece.text, "zh") <= input.params.hard);
                }
                assert_eq!(
                    crate::atomize::normalize_chars(&concat(&entry)),
                    crate::atomize::normalize_chars(target)
                );
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn monotone_three_clause_sentence_yields_many_blocks_and_hard_safe_pieces() {
        // (c)
        let src = words(&[
            "We", "first", "analyze", "the", "data,", "then", "train", "the", "model,", "and",
            "finally", "deploy", "the", "service.",
        ]);
        let target = "我们先分析数据，然后训练模型，最后部署服务。";
        let edges = vec![
            soft(0, target, "我们"),
            soft(1, target, "先"),
            soft(2, target, "分析"),
            soft(4, target, "数据"),
            soft(5, target, "然后"),
            soft(6, target, "训练"),
            soft(8, target, "模型"),
            soft(10, target, "最后"),
            soft(11, target, "部署"),
            soft(13, target, "服务"),
        ];
        let input = BilingualPlanInput::new(src.clone(), target, "en", "zh");
        let candidates: Vec<usize> = target_cut_candidates(target, "zh", &input.params, &[])
            .into_iter()
            .map(|c| c.pos)
            .collect();
        let blocks = minimal_monotonic_blocks(&edges, &src, target, &candidates, DEFAULT_EDGE_TAU);
        assert!(blocks.len() >= 3, "{blocks:#?}");
        // 未对齐的冠词 the 跟随其后的名词，而不是悬在块尾。
        for block in &blocks {
            let tail = src[block.src.1].text.to_ascii_lowercase();
            assert_ne!(tail, "the", "{blocks:#?}");
        }
        assert!(
            blocks
                .iter()
                .all(|b| !b.flags.contains(&"local-reorder".to_owned()))
        );
        match plan_sentence(&edges, &input) {
            PlanOutcome::Aligned(entry) => {
                assert!(entry.pieces.len() >= 2, "{entry:#?}");
                assert!(entry.blocks.len() >= 3);
                assert_invariants(&entry, src.len());
                for piece in &entry.pieces {
                    assert!(target_cps_chars(&piece.text, "zh") <= input.params.hard);
                    // 只在逗号缝上切开。
                    assert!(
                        piece.text.ends_with('，') || piece.text.ends_with('。'),
                        "{entry:#?}"
                    );
                }
                assert!(entry.pieces.iter().all(|p| p.text.chars().count() > 3));
                assert_eq!(concat(&entry), target);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn numbers_are_hard_anchors_that_travel_with_their_source_word() {
        // (d)
        let src = words(&[
            "By", "2028,", "sales", "will", "grow", "by", "50%", "or", "more.",
        ]);
        let refs: Vec<&str> = src.iter().map(|w| w.text.as_str()).collect();
        let target = "到 2028 年，销售额将增长 50% 或更多。";
        let ctx = AlignCtx {
            source_lang: "en".to_owned(),
            lang: "zh".to_owned(),
            protected_terms: Vec::new(),
        };
        let anchors = AnchorAligner.align(&refs, target, &ctx);
        assert_eq!(
            anchors,
            vec![
                AlignEdge::hard(1, span(target, "2028")),
                AlignEdge::hard(6, span(target, "50%")),
            ]
        );
        // 只用硬锚也能得到单调块，且数字与其源词同块。
        let input = BilingualPlanInput::new(src.clone(), target, "en", "zh");
        let candidates: Vec<usize> = target_cut_candidates(target, "zh", &input.params, &[])
            .into_iter()
            .map(|c| c.pos)
            .collect();
        // 数字 token 内部绝不是候选切点。
        let year = span(target, "2028");
        assert!(!candidates.iter().any(|&k| year.start < k && k < year.end));
        let blocks =
            minimal_monotonic_blocks(&anchors, &src, target, &candidates, DEFAULT_EDGE_TAU);
        for (needle, word) in [("2028", 1usize), ("50%", 6usize)] {
            let pos = span(target, needle).start;
            let block = blocks
                .iter()
                .find(|b| b.tgt.0 <= pos && pos < b.tgt.1)
                .unwrap();
            assert!(block.src.0 <= word && word <= block.src.1, "{blocks:#?}");
            assert!(block.flags.contains(&"anchor".to_owned()));
            assert_eq!(block.confidence, Some(1.0));
        }
        // 与软边合并：同源词上的软边被硬边压掉。
        let merged = merge_edges(vec![
            vec![
                AlignEdge::soft(1, 0..4, 0.7),
                AlignEdge::soft(2, span(target, "销售额"), 0.7),
            ],
            anchors.clone(),
        ]);
        assert!(merged.contains(&AlignEdge::hard(1, span(target, "2028"))));
        assert!(!merged.contains(&AlignEdge::soft(1, 0..4, 0.7)));
        assert!(merged.contains(&AlignEdge::soft(2, span(target, "销售额"), 0.7)));
        assert!(
            merged
                .windows(2)
                .all(|w| (w[0].src, w[0].tgt.start) <= (w[1].src, w[1].tgt.start))
        );
    }

    #[test]
    fn anchor_aligner_recognizes_urls_terms_and_verbatim_latin_but_needs_uniqueness() {
        let src = [
            "Open",
            "agentskills.io",
            "and",
            "run",
            "vLLM",
            "with",
            "the",
            "KV",
            "cache",
            "and",
            "the",
            "KV",
            "store.",
        ];
        let target = "打开 agentskills.io 并用 KV 缓存运行 vLLM，再用 KV 存储。";
        let ctx = AlignCtx {
            source_lang: "en".to_owned(),
            lang: "zh".to_owned(),
            protected_terms: vec![TermPair {
                source: "KV cache".to_owned(),
                target: "KV 缓存".to_owned(),
            }],
        };
        let edges = AnchorAligner.align(&src, target, &ctx);
        // 术语对 → 源窗口每词一条硬边，目标同一区间。
        let cache = span(target, "KV 缓存");
        assert!(edges.contains(&AlignEdge::hard(7, cache.clone())));
        assert!(edges.contains(&AlignEdge::hard(8, cache)));
        assert!(edges.contains(&AlignEdge::hard(1, span(target, "agentskills.io"))));
        assert!(edges.contains(&AlignEdge::hard(4, span(target, "vLLM"))));
        // KV 在源侧出现两次、目标侧两次：token 锚放弃（术语边已覆盖第一处）。
        assert!(!edges.iter().any(|e| e.src == 11));
        // Latin 目标语只认专名形态：句首 In / 小写功能词不出边。
        let ctx_en = AlignCtx {
            source_lang: "de".to_owned(),
            lang: "en".to_owned(),
            protected_terms: Vec::new(),
        };
        let edges = AnchorAligner.align(
            &["In", "OpenAI", "no", "GPT-4"],
            "In OpenAI no GPT-4",
            &ctx_en,
        );
        assert_eq!(edges.iter().map(|e| e.src).collect::<Vec<_>>(), vec![1, 3]);
        // 数字整词：`2028` 不命中 `2028.5` / `12,028`，句末 `2028.` 仍命中。
        let chars: Vec<char> = "in 2028.5 or 12,028 by 2028.".chars().collect();
        assert_eq!(whole_token_occurrences(&chars, "2028"), vec![23]);
    }

    #[test]
    fn unaligned_source_words_attach_to_previous_block_unless_the_seam_is_illegal() {
        // (e) "it" 未对齐 → 并入前一块："Read it | then sleep"。
        let src = words(&["Read", "it", "then", "sleep."]);
        let target = "读吧，然后睡觉。";
        let edges = vec![
            soft(0, target, "读"),
            soft(2, target, "然后"),
            soft(3, target, "睡觉"),
        ];
        let candidates = vec![span(target, "然后").start];
        let blocks = minimal_monotonic_blocks(&edges, &src, target, &candidates, DEFAULT_EDGE_TAU);
        assert_eq!(blocks.len(), 2, "{blocks:#?}");
        assert_eq!(blocks[0].src, (0, 1));
        assert_eq!(blocks[1].src, (2, 3));
        // 悬垂连词 and 未对齐 → 不能并入前一块，改并入后一块。
        let src = words(&["Read", "the", "book", "and", "sleep."]);
        let target = "读书，睡觉。";
        let edges = vec![
            soft(0, target, "读"),
            soft(2, target, "书"),
            soft(4, target, "睡觉"),
        ];
        let candidates = vec![span(target, "睡觉").start];
        let blocks = minimal_monotonic_blocks(&edges, &src, target, &candidates, DEFAULT_EDGE_TAU);
        assert_eq!(blocks.len(), 2, "{blocks:#?}");
        assert_eq!(blocks[0].src, (0, 2));
        assert_eq!(blocks[1].src, (3, 4));
        // 句首未对齐词并入后一块（第一块从 0 开始）。
        let src = words(&["Well,", "read", "then", "sleep."]);
        let target = "读吧，然后睡觉。";
        let edges = vec![
            soft(1, target, "读"),
            soft(2, target, "然后"),
            soft(3, target, "睡觉"),
        ];
        let candidates = vec![span(target, "然后").start];
        let blocks = minimal_monotonic_blocks(&edges, &src, target, &candidates, DEFAULT_EDGE_TAU);
        assert_eq!(blocks[0].src, (0, 1), "{blocks:#?}");
    }

    #[test]
    fn source_break_prefers_punctuation_then_pause_inside_the_interval() {
        // (leftMax, rightMin] = (1, 3]：b ∈ {2, 3}；"home," 后有标点 ⇒ b = 2。
        let src = words(&["Go", "home,", "and", "then", "sleep."]);
        let target = "回家，然后睡觉。";
        let edges = vec![
            soft(0, target, "回"),
            soft(1, target, "家"),
            soft(3, target, "然后"),
            soft(4, target, "睡觉"),
        ];
        let candidates = vec![span(target, "然后").start];
        let blocks = minimal_monotonic_blocks(&edges, &src, target, &candidates, DEFAULT_EDGE_TAU);
        assert_eq!(blocks.len(), 2, "{blocks:#?}");
        assert_eq!(blocks[0].src, (0, 1));
        // 无标点时停顿决定：在 "home" 与 "quickly" 之间留 1s 静音。
        let mut src = words(&["Go", "home", "quickly", "then", "sleep."]);
        for word in &mut src[2..] {
            word.t0 += 1.0;
            word.t1 += 1.0;
        }
        let edges = vec![
            soft(0, target, "回"),
            soft(1, target, "家"),
            soft(3, target, "然后"),
            soft(4, target, "睡觉"),
        ];
        let blocks = minimal_monotonic_blocks(&edges, &src, target, &candidates, DEFAULT_EDGE_TAU);
        assert_eq!(blocks[0].src, (0, 1), "{blocks:#?}");
        // 既无标点也无停顿：并入前一块（quickly 属前块）。
        let src = words(&["Go", "home", "quickly", "then", "sleep."]);
        let blocks = minimal_monotonic_blocks(&edges, &src, target, &candidates, DEFAULT_EDGE_TAU);
        assert_eq!(blocks[0].src, (0, 2), "{blocks:#?}");
    }

    #[test]
    fn over_hard_block_requests_a_monotonic_rewrite() {
        // (f) 整句一块且目标 > hard（20 单位）。
        let src = words(&[
            "I", "didn't", "go", "because", "I", "was", "sick", "and", "tired.",
        ]);
        let target = "因为我当时既生病又非常疲惫不堪，所以最终没有去成。";
        assert!(target_cps_chars(target, "zh") > 20);
        let edges = vec![
            soft(0, target, "我"),
            soft(3, target, "因为"),
            soft(6, target, "生病"),
            soft(8, target, "疲惫"),
            soft(1, target, "没有"),
            soft(2, target, "去"),
        ];
        let input = BilingualPlanInput::new(src.clone(), target, "en", "zh");
        match plan_sentence(&edges, &input) {
            PlanOutcome::NeedsRewrite {
                over_hard_block,
                units,
                blocks,
            } => {
                assert_eq!(over_hard_block, 0);
                assert!(units > 20);
                assert_eq!(blocks.len(), 1);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn low_confidence_or_missing_evidence_degrades_to_sentence_level() {
        // (g)
        let src = words(&["We", "ship", "today."]);
        let target = "我们今天发货。";
        let edges = vec![
            AlignEdge::soft(0, span(target, "我们"), 0.3),
            AlignEdge::soft(2, span(target, "今天"), 0.3),
            AlignEdge::soft(1, span(target, "发货"), 0.3),
        ];
        let mut input = BilingualPlanInput::new(src.clone(), target, "en", "zh");
        input.tau = 0.2;
        match plan_sentence(&edges, &input) {
            PlanOutcome::SentenceLevel(entry) => {
                assert_eq!(entry.correspondence, Some(Correspondence::Sentence));
                assert_eq!(entry.correspondence(), Correspondence::Sentence);
                assert_eq!(entry.pieces.len(), 1);
                assert_eq!(entry.pieces[0].from, Some(0));
                assert_eq!(entry.pieces[0].to, Some(2));
                assert_eq!(entry.blocks.len(), 1);
                assert_eq!(entry.blocks[0].confidence, Some(0.3));
                assert_invariants(&entry, 3);
            }
            other => panic!("{other:?}"),
        }
        // 无任何证据 ⇒ 整句对应；权重 ≥ τ_s 的同一组边 ⇒ 块级对应。
        assert!(matches!(
            plan_sentence(&[], &input),
            PlanOutcome::SentenceLevel(_)
        ));
        input.tau = DEFAULT_EDGE_TAU;
        let strong: Vec<AlignEdge> = edges
            .iter()
            .map(|e| AlignEdge::soft(e.src, e.tgt.clone(), 0.9))
            .collect();
        assert!(matches!(
            plan_sentence(&strong, &input),
            PlanOutcome::Aligned(_)
        ));
    }

    #[test]
    fn validate_blocks_rejects_piece_cuts_inside_a_block() {
        // (h)
        let mut entry = TransAlign::new(
            AlignMode::ManyToOne,
            vec!["g1.0".into(), "g1.1".into(), "g1.2".into(), "g1.3".into()],
            vec![
                TransPiece {
                    from: Some(0),
                    to: Some(1),
                    text: "甲乙，".to_owned(),
                },
                TransPiece {
                    from: Some(2),
                    to: Some(3),
                    text: "丙丁。".to_owned(),
                },
            ],
        );
        entry.correspondence = Some(Correspondence::Block);
        entry.blocks = vec![
            AlignBlock {
                src: (0, 1),
                tgt: (0, 3),
                confidence: Some(0.9),
                flags: Vec::new(),
            },
            AlignBlock {
                src: (2, 3),
                tgt: (3, 6),
                confidence: Some(0.9),
                flags: Vec::new(),
            },
        ];
        assert!(validate_blocks(&entry, 4));
        // 片切在块内部：源侧 from=1 不是块起点。
        let mut inside = entry.clone();
        inside.pieces[0].to = Some(0);
        inside.pieces[1].from = Some(1);
        assert!(!validate_blocks(&inside, 4));
        // 目标侧：片文本切点不落在块边界。
        let mut inside = entry.clone();
        inside.pieces[0].text = "甲乙".to_owned();
        inside.pieces[1].text = "，丙丁。".to_owned();
        assert!(!validate_blocks(&inside, 4));
        // 源/目标两侧对应到不同的块。
        let mut skew = entry.clone();
        skew.blocks[0].src = (0, 0);
        skew.blocks[1].src = (1, 3);
        assert!(!validate_blocks(&skew, 4));
        // I3：不连续 / 覆盖不全 / 空目标区间。
        let mut gap = entry.clone();
        gap.blocks[1].src = (3, 3);
        assert!(!validate_blocks(&gap, 4));
        let mut short = entry.clone();
        short.blocks[1].tgt = (3, 5);
        assert!(!validate_blocks(&short, 4));
        let mut empty = entry.clone();
        empty.blocks[0].tgt = (0, 0);
        empty.blocks[1].tgt = (0, 6);
        assert!(!validate_blocks(&empty, 4));
        // sentence 对应只许一个块；independent 不含块。
        let mut sentence = entry.clone();
        sentence.correspondence = Some(Correspondence::Sentence);
        assert!(!validate_blocks(&sentence, 4));
        let mut independent = entry.clone();
        independent.mode = AlignMode::Independent;
        assert!(!validate_blocks(&independent, 4));
        // 无块层恒有效（旧条目）。
        let mut legacy = entry.clone();
        legacy.blocks.clear();
        assert!(validate_blocks(&legacy, 4));
    }

    fn doc_with_sentence(texts: &[&str]) -> (TranscriptDoc, Vec<Sentence>) {
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
        doc.words = texts
            .iter()
            .enumerate()
            .map(|(index, text)| Word {
                id: format!("g1.{index}"),
                t0: index as f64 * 0.5,
                t1: index as f64 * 0.5 + 0.5,
                text: (*text).to_owned(),
                sp: "s1".to_owned(),
                glue: false,
            })
            .collect();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        (doc, sentences)
    }

    #[test]
    fn display_basis_entries_validate_and_project_against_trans_display() {
        // (i)
        let (mut doc, sentences) = doc_with_sentence(&["I", "didn't", "go", "because", "sick."]);
        let sid = sentences[0].id.clone();
        let natural = "因为我病了，所以没去。";
        let display = "我没有去，因为我生病了。";
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert(sid.clone(), natural.to_owned());
        doc.trans_display
            .entry("zh".to_owned())
            .or_default()
            .insert(
                sid.clone(),
                TransDisplay {
                    text: display.to_owned(),
                    basis: "monotonic-rewrite".to_owned(),
                    trans_fingerprint: trans_text_fingerprint(natural),
                },
            );
        let src: Vec<AnchorWord> = doc
            .words
            .iter()
            .map(|w| AnchorWord {
                id: w.id.clone(),
                text: w.text.clone(),
                t0: w.t0,
                t1: w.t1,
                glue: false,
            })
            .collect();
        let edges = vec![
            soft(0, display, "我"),
            soft(1, display, "没有"),
            soft(2, display, "去"),
            soft(3, display, "因为"),
            soft(4, display, "生病"),
        ];
        let mut input = BilingualPlanInput::new(src, display, "en", "zh");
        input.text_basis = TextBasis::Display;
        input.aligner = "llm-chunk+anchor/1".to_owned();
        // 缺省 fit=16 时整句一行放得下（DP 正确地不拆）；收窄阈值以覆盖两片路径：
        // 整句 10 单位 > hard 8，但每个块 ≤ hard，必须切成两片。
        input.params = TransParams {
            fit: 6,
            soft: 5,
            hard: 8,
        };
        let PlanOutcome::Aligned(entry) = plan_sentence(&edges, &input) else {
            panic!("expected aligned");
        };
        assert_eq!(entry.text_basis, TextBasis::Display);
        assert_eq!(entry.aligner.as_deref(), Some("llm-chunk+anchor/1"));
        assert_eq!(entry.pieces.len(), 2, "{entry:#?}");
        assert_eq!(concat(&entry), display);
        // 基准文本解析 + 校验：按 display 校验通过，按 trans 校验不通过。
        assert_eq!(
            crate::split::basis_text(&doc, "zh", &sid, &entry),
            Some(display)
        );
        assert!(align_entry_valid(&doc, &sentences[0], display, &entry));
        assert!(!align_entry_valid(&doc, &sentences[0], natural, &entry));
        doc.trans_align
            .entry("zh".to_owned())
            .or_default()
            .insert(sid.clone(), entry);
        assert!(align_entry_valid_for_lang(
            &doc,
            &sentences[0],
            "zh",
            &doc.trans_align["zh"][&sid]
        ));
        let cues = derive_trans_cues(&doc, &sentences, "zh");
        assert_eq!(cues.len(), 2, "{cues:#?}");
        assert_eq!(cues[0].text, "我没有去，");
        assert_eq!(cues[1].text, "因为我生病了。");
        assert!(cues.iter().all(|c| !c.fallback));
        assert_eq!(cues[0].word_span, Some((0, 2)));
        // 删除 transDisplay ⇒ 基准文本缺失 ⇒ 条目失效 ⇒ 自然译句整句上屏。
        doc.trans_display.clear();
        assert!(!align_entry_valid_for_lang(
            &doc,
            &sentences[0],
            "zh",
            &doc.trans_align["zh"][&sid]
        ));
        let cues = derive_trans_cues(&doc, &sentences, "zh");
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].text, natural);
    }

    #[test]
    fn sentence_level_entry_projects_as_one_whole_sentence_cue() {
        let (mut doc, sentences) = doc_with_sentence(&["We", "ship", "today."]);
        let sid = sentences[0].id.clone();
        let target = "我们今天发货。";
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert(sid.clone(), target.to_owned());
        let src: Vec<AnchorWord> = doc
            .words
            .iter()
            .map(|w| AnchorWord {
                id: w.id.clone(),
                text: w.text.clone(),
                t0: w.t0,
                t1: w.t1,
                glue: false,
            })
            .collect();
        let input = BilingualPlanInput::new(src, target, "en", "zh");
        let entry = sentence_level_entry(&input, Some(0.2));
        assert!(align_entry_valid(&doc, &sentences[0], target, &entry));
        doc.trans_align
            .entry("zh".to_owned())
            .or_default()
            .insert(sid, entry);
        let cues = derive_trans_cues(&doc, &sentences, "zh");
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].text, target);
        assert_eq!(cues[0].start, 0.0);
        assert_eq!(cues[0].end, 1.5);
        assert_eq!(cues[0].word_span, Some((0, 2)));
        // 单行放得下：不算降级。
        assert!(!cues[0].fallback);
    }

    #[test]
    fn stale_display_is_detected_and_purged_with_its_display_alignment() {
        // (j)
        let (mut doc, sentences) = doc_with_sentence(&["We", "ship", "today."]);
        let sid = sentences[0].id.clone();
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert(sid.clone(), "我们今天发货。".to_owned());
        doc.trans_display
            .entry("zh".to_owned())
            .or_default()
            .insert(
                sid.clone(),
                TransDisplay {
                    text: "今天我们发货。".to_owned(),
                    basis: "monotonic-rewrite".to_owned(),
                    trans_fingerprint: trans_text_fingerprint("我们今天发货。"),
                },
            );
        let mut entry = TransAlign::new(
            AlignMode::ManyToOne,
            doc.words.iter().map(|w| w.id.clone()).collect(),
            vec![TransPiece {
                from: Some(0),
                to: Some(2),
                text: "今天我们发货。".to_owned(),
            }],
        );
        entry.text_basis = TextBasis::Display;
        entry.correspondence = Some(Correspondence::Block);
        doc.trans_align
            .entry("zh".to_owned())
            .or_default()
            .insert(sid.clone(), entry);
        assert!(stale_display_sentences(&doc, "zh", &sentences).is_empty());
        assert_eq!(purge_stale_display(&mut doc, "zh", &sentences), 0);
        // 改整句译文 ⇒ 指纹不符 ⇒ display-stale。
        doc.trans
            .get_mut("zh")
            .unwrap()
            .insert(sid.clone(), "我们今日发货。".to_owned());
        assert_eq!(
            stale_display_sentences(&doc, "zh", &sentences),
            vec![sid.clone()]
        );
        assert!(stale_display_sentences(&doc, "ja", &sentences).is_empty());
        assert_eq!(purge_stale_display(&mut doc, "zh", &sentences), 1);
        assert!(doc.trans_display.is_empty());
        assert!(
            doc.trans_align.is_empty(),
            "display-basis alignment must go too"
        );
        // trans 基准的对齐不受 display 过期影响。
        doc.trans_display
            .entry("zh".to_owned())
            .or_default()
            .insert(
                sid.clone(),
                TransDisplay {
                    text: "x".to_owned(),
                    basis: "monotonic-rewrite".to_owned(),
                    trans_fingerprint: "stale".to_owned(),
                },
            );
        let mut trans_based = TransAlign::new(
            AlignMode::ManyToOne,
            doc.words.iter().map(|w| w.id.clone()).collect(),
            vec![TransPiece {
                from: Some(0),
                to: Some(2),
                text: "我们今日发货。".to_owned(),
            }],
        );
        trans_based.text_basis = TextBasis::Trans;
        doc.trans_align
            .entry("zh".to_owned())
            .or_default()
            .insert(sid.clone(), trans_based);
        assert_eq!(purge_stale_display(&mut doc, "zh", &sentences), 1);
        assert!(doc.trans_align["zh"].contains_key(&sid));
    }

    #[test]
    fn candidates_skip_protected_terms_and_objective_seams() {
        let params = TransParams::for_lang("zh");
        let target = "我们用 Claude Code 写字幕，稳定的流程很重要。";
        let candidates = target_cut_candidates(target, "zh", &params, &["Claude Code".to_owned()]);
        let term = span(target, "Claude Code");
        assert!(
            !candidates
                .iter()
                .any(|c| term.start < c.pos && c.pos < term.end)
        );
        // 落在锁定术语内部的模型提示两头都不进：不放行，也不算「被拒的提示」。
        let inside = term.start + "Claude ".chars().count();
        let hinted = hinted_cut_candidates(
            target,
            "zh",
            &params,
            &["Claude Code".to_owned()],
            &[inside],
        );
        assert!(
            hinted.admitted.is_empty() && hinted.refused.is_empty(),
            "{hinted:?}"
        );
        // 「的」尾是客观语病缝：不进候选。
        let de = span(target, "稳定的").end;
        assert!(!candidates.iter().any(|c| c.pos == de), "{candidates:?}");
        // 词间空白缝罚分低于 CJK 字界缝；空白归左侧，切点落在右侧首字上。
        let after_code = candidates.iter().find(|c| c.pos == term.end + 1).unwrap();
        let cjk_seam = candidates
            .iter()
            .find(|c| c.pos == span(target, "字幕").start)
            .unwrap();
        assert!(after_code.seam_cost < cjk_seam.seam_cost);
        let chars: Vec<char> = target.chars().collect();
        assert!(is_cjk_char(chars[cjk_seam.pos]));
        // 位置是原文字符坐标：切点前后字符对得上。
        assert_eq!(chars[after_code.pos], '写');
        assert_eq!(chars[after_code.pos - 1], ' ');
        // 从句标点缝最便宜。
        let comma = candidates
            .iter()
            .find(|c| c.pos == span(target, "稳定").start)
            .unwrap();
        assert!(comma.seam_cost < after_code.seam_cost);
    }

    /// 真实用例（IBM「AI 安全三难困境」s-g40.34）：源行 19 词 / 5.8 s / 78 单位，
    /// 译文 20 单位（超 fit、恰在 hard 上），块边界已经落在「是，」后，但配对的
    /// 源缝 `… two of is | we could …` 以系词收尾、按前附词元判非法。平罚的超 fit
    /// 代价（1.5）永远轻于这个坏源缝（BLOCKING + 0.8），DP 便宁可保留一条贴在
    /// hard 上的整行；check 随后报 `align-paired-density` 要求在同一个缝上切开，
    /// 而重跑 align 只会得到同样的块——所以超 fit 代价必须随宽度递增到足以压过
    /// 一个坏源缝，让这一刀在这里被采纳。
    fn dense_source_fixture() -> (Vec<AnchorWord>, &'static str, Vec<AlignBlock>) {
        let raw: [(&str, f64, f64); 19] = [
            ("And", 407.65, 408.2),
            ("then", 408.2, 408.36),
            ("ultimately,", 408.36, 408.45),
            ("the", 408.6, 408.77),
            ("other", 409.39, 409.56),
            ("thing", 409.56, 409.8),
            ("that", 409.8, 409.96),
            ("we", 409.96, 410.05),
            ("could", 410.05, 410.21),
            ("pick", 410.21, 410.38),
            ("two", 410.38, 410.62),
            ("of", 410.62, 410.78),
            ("is", 410.78, 410.95),
            ("we", 410.95, 411.11),
            ("could", 411.11, 411.2),
            ("pick", 411.2, 411.36),
            ("secure", 411.36, 412.18),
            ("and", 412.18, 412.59),
            ("speedy.", 412.59, 413.41),
        ];
        let words: Vec<AnchorWord> = raw
            .iter()
            .enumerate()
            .map(|(index, (text, t0, t1))| AnchorWord {
                id: format!("g40.{index}"),
                text: (*text).to_owned(),
                t0: *t0,
                t1: *t1,
                glue: false,
            })
            .collect();
        let target = "最后，还有一种二选法是，我们可以选安全和快速。";
        let block = |src: (usize, usize), tgt: (usize, usize)| AlignBlock {
            src,
            tgt,
            confidence: Some(0.75),
            flags: vec!["weak".to_owned()],
        };
        let blocks = vec![
            block((0, 2), (0, 3)),
            block((3, 12), (3, 12)),
            block((13, 15), (12, 17)),
            block((16, 18), (17, 23)),
        ];
        (words, target, blocks)
    }

    #[test]
    fn dense_source_row_is_split_at_the_clause_seam() {
        let (words, target, blocks) = dense_source_fixture();
        let input = BilingualPlanInput::new(words.clone(), target, "en", "zh");
        let groups = bilingual_dp(&blocks, &input).expect("feasible");
        assert!(
            groups.len() >= 2,
            "a 78-unit / 5.8 s source row paired with a 20-unit target must split: {groups:?}"
        );
        // 切点落在「是，」后的从句缝，而不是把「我们可以选」孤悬。
        let target_chars: Vec<char> = target.chars().collect();
        let first_piece_end = blocks[groups[0][groups[0].len() - 1]].tgt.1;
        assert_eq!(
            char_slice(&target_chars, 0..first_piece_end),
            "最后，还有一种二选法是，"
        );
        // 每一行的源侧都比整行窄，且不再有整行超 fit 的译文。
        for group in &groups {
            let text = char_slice(
                &target_chars,
                blocks[group[0]].tgt.0..blocks[group[group.len() - 1]].tgt.1,
            );
            assert!(
                !exceeds_one_line_fit(text.trim(), "zh", input.params.fit),
                "{text}"
            );
        }
    }

    /// 同一项目 s-g7.0：`Generally speaking, though, | the smarter models …`。
    /// `though` 在前附词元表里，但逗号已把插入语封口，行尾停在这里没有悬垂；
    /// 旧判定把这个缝当非法缝重罚，19 单位的译文整行不切。
    #[test]
    fn clause_punctuation_seals_a_source_seam_even_after_a_clinging_lexeme() {
        let raw: [(&str, f64, f64); 10] = [
            ("Generally", 64.95, 65.43),
            ("speaking,", 65.43, 66.06),
            ("though,", 66.06, 66.14),
            ("the", 66.14, 66.23),
            ("smarter", 66.31, 66.4),
            ("models", 66.4, 67.43),
            ("also", 67.43, 67.76),
            ("require", 67.76, 68.16),
            ("other", 68.94, 69.11),
            ("capabilities.", 69.11, 69.43),
        ];
        let words: Vec<AnchorWord> = raw
            .iter()
            .enumerate()
            .map(|(index, (text, t0, t1))| AnchorWord {
                id: format!("g7.{index}"),
                text: (*text).to_owned(),
                t0: *t0,
                t1: *t1,
                glue: false,
            })
            .collect();
        assert!(source_seam_legal(&words, 3), "though, | the");
        // 没有标点封口时，前附词元仍然不合法：`the | smarter`。
        assert!(!source_seam_legal(&words, 4), "the | smarter");
        let target = "不过一般来说，越聪明的模型也需要其他能力。";
        let block = |src: (usize, usize), tgt: (usize, usize)| AlignBlock {
            src,
            tgt,
            confidence: Some(0.75),
            flags: vec!["weak".to_owned()],
        };
        let blocks = vec![
            block((0, 2), (0, 7)),
            block((3, 5), (7, 13)),
            block((6, 7), (13, 16)),
            block((8, 9), (16, 21)),
        ];
        let input = BilingualPlanInput::new(words, target, "en", "zh");
        let groups = bilingual_dp(&blocks, &input).expect("feasible");
        assert_eq!(groups.len(), 2, "{groups:?}");
        assert_eq!(groups[0], vec![0]);
    }

    /// 同一项目 s-g38.25（52 词的长枚举句）：顿号缝的定价必须与
    /// `seam::lint_pieces` 同口径——并列项被拆开、左右两片合并后仍 ≤ hard 的
    /// 顿号不是缝。候选缝表按「左片 | 整个余下部分」计价时顿号总显得便宜，
    /// DP 便把 `它做的处理、` 单独切成一行，check 随即报 align-target-seam，
    /// 而重跑 align 只会得到同一组块。
    #[test]
    fn list_separator_is_not_a_seam_when_the_neighbours_fit_together() {
        let raw: [(&str, f64, f64); 52] = [
            ("Or", 379.83, 380.30),
            ("if", 380.38, 380.47),
            ("the", 380.47, 380.56),
            ("information", 380.56, 380.72),
            ("it", 380.72, 381.27),
            ("has,", 381.27, 381.44),
            ("or", 381.44, 382.15),
            ("the", 382.38, 382.39),
            ("processing", 382.54, 382.55),
            ("that", 382.55, 383.18),
            ("it's", 383.18, 383.27),
            ("doing,", 383.27, 383.51),
            ("the", 383.51, 384.15),
            ("output", 384.15, 385.42),
            ("that", 385.42, 385.51),
            ("we're", 385.51, 385.60),
            ("going", 386.21, 386.22),
            ("to", 386.30, 386.31),
            ("take,", 386.31, 386.39),
            ("and", 386.39, 386.71),
            ("the", 386.71, 386.80),
            ("decisions", 386.80, 386.81),
            ("we're", 386.88, 386.89),
            ("going", 386.97, 386.98),
            ("to", 386.98, 387.07),
            ("make,", 387.07, 387.15),
            ("and", 387.15, 387.47),
            ("the", 387.47, 387.56),
            ("actions", 387.56, 387.72),
            ("we'll", 387.72, 388.11),
            ("take", 388.11, 388.20),
            ("based", 388.20, 388.52),
            ("upon", 388.52, 388.76),
            ("that,", 388.76, 389.07),
            ("end", 389.30, 389.70),
            ("up", 389.70, 389.94),
            ("being", 389.94, 390.10),
            ("low", 390.10, 390.34),
            ("risk,", 390.34, 390.73),
            ("well,", 390.73, 391.12),
            ("then", 391.12, 391.36),
            ("it", 391.36, 391.53),
            ("doesn't", 391.53, 391.69),
            ("matter", 391.69, 391.93),
            ("if", 392.01, 392.09),
            ("the", 392.17, 392.33),
            ("AI", 392.33, 392.57),
            ("is", 392.57, 392.89),
            ("a", 392.89, 392.98),
            ("little", 392.98, 393.06),
            ("bit", 393.06, 393.23),
            ("off.", 393.23, 393.39),
        ];
        let block = |src: (usize, usize), tgt: (usize, usize)| AlignBlock {
            src,
            tgt,
            confidence: Some(0.75),
            flags: vec!["weak".to_owned()],
        };
        let blocks = vec![
            block((0, 0), (0, 3)),
            block((1, 1), (3, 5)),
            block((2, 5), (5, 12)),
            block((6, 11), (12, 18)),
            block((12, 18), (18, 27)),
            block((19, 25), (27, 35)),
            block((26, 33), (35, 47)),
            block((34, 38), (47, 56)),
            block((39, 40), (56, 58)),
            block((41, 51), (58, 72)),
        ];
        let target = "或者，如果它掌握的信息、它做的处理、我们要采用的输出、我们要做的决定，以及基于此要采取的行动，最终都是低风险的，那 AI 稍微有点偏差也无所谓。";
        let words: Vec<AnchorWord> = raw
            .iter()
            .enumerate()
            .map(|(index, (text, t0, t1))| AnchorWord {
                id: format!("g38.{index}"),
                text: (*text).to_owned(),
                t0: *t0,
                t1: *t1,
                glue: false,
            })
            .collect();
        let input = BilingualPlanInput::new(words, target, "en", "zh");
        let groups = bilingual_dp(&blocks, &input).expect("feasible");
        let target_chars: Vec<char> = target.chars().collect();
        let pieces: Vec<String> = groups
            .iter()
            .map(|group| {
                char_slice(
                    &target_chars,
                    blocks[group[0]].tgt.0..blocks[group[group.len() - 1]].tgt.1,
                )
            })
            .collect();
        for pair in pieces.windows(2) {
            let (left, right) = (pair[0].trim(), pair[1].trim());
            let merged = target_cps_chars(left, "zh") + target_cps_chars(right, "zh");
            assert!(
                !(ends_list_separator(left) && merged <= input.params.hard),
                "顿号后不该有一刀（合并后 {merged} ≤ hard）：{pieces:?}"
            );
        }
        // check 点名的那一刀（「采取的行动，」后）已经切开，20 单位的行不再出现。
        assert!(
            pieces.iter().any(|piece| piece.ends_with("采取的行动，")),
            "{pieces:?}"
        );
        for piece in &pieces {
            assert!(
                target_cps_chars(piece.trim(), "zh") < input.params.hard,
                "{piece}"
            );
        }
    }

    // ---- paired 密度在 `--align-only` 真实路径上的探针 ----------------------

    /// R1 形态（短译文 + 长源时窗）的 `--align-only` 真实路径：
    /// `plan_sentence` → [`bilingual_dp`] → `pair_cost`，**不经过**
    /// [`plan_sentence_rows`]（那条路只在 translate 携带融合 rows 草稿时可达，
    /// `--align-only` 传空草稿）。
    ///
    /// 这条 fixture 是 paired 语义的验收锚：
    /// - `Auto` 必须仍收敛成一片（零漂移）——窄片的宽度罚
    ///   `((units-soft)/soft)²` 压过源侧时窗罚；
    /// - `Paired` 必须切出 ≥2 片——窄于 soft 的宽度罚归零后，只罚"整句一片"的
    ///   源侧宽度/时窗罚成为主导项，DP 沿译文里那条从句缝切开。
    fn r1_short_translation_fixture() -> (Vec<AnchorWord>, String, Vec<AlignEdge>) {
        // 14 词 × 0.4s = 5.6s 源时窗：落在 PAIRED_SOURCE_MAX_SECONDS(4s) 与
        // PAIRED_SOURCE_HARD_SECONDS(6s) 之间的软档；整句源宽也超 en 的
        // `source_fit`(42)。两项都只罚"整句一片"，不罚切开后的两片。
        let src = words(&[
            "And", "so", "I", "made", "up", "my", "mind", "then", "I", "started", "all", "over",
            "again", "there.",
        ]);
        // 远短于 soft(14) 的译文，中间一条从句缝（`seam_penalty` 记 0.3）；
        // 两侧都长于 `seam::MIN_PIECE_CHARS`，因此缝上没有闪现碎片附加罚。
        let target = "我下定决心，重新来过。".to_owned();
        // 权重 1.0：把置信度罚清零，让这条 fixture 只在宽度项上有分歧。
        let edge = |src: usize, needle: &str| AlignEdge::soft(src, span(&target, needle), 1.0);
        let edges = vec![
            edge(2, "我"),
            edge(3, "下定"),
            edge(6, "决心"),
            edge(9, "重新"),
            edge(11, "来过"),
        ];
        (src, target, edges)
    }

    #[test]
    fn align_only_paired_splits_a_short_translation_that_auto_keeps_whole() {
        let (src, target, edges) = r1_short_translation_fixture();
        assert!(target_cps_chars(&target, "zh") < TransParams::for_lang("zh").soft);
        let auto = BilingualPlanInput::new(src.clone(), &target, "en", "zh");
        let auto_pieces = match plan_sentence(&edges, &auto) {
            PlanOutcome::Aligned(entry) => {
                assert_invariants(&entry, src.len());
                assert_eq!(concat(&entry), target);
                entry.pieces.len()
            }
            other => panic!("auto: {other:?}"),
        };
        // 零漂移：`Auto` 的代价函数没有变，这一句仍然整句一片。
        assert_eq!(auto_pieces, 1, "auto must not drift");

        let mut paired = auto;
        paired.density = AlignDensity::Paired;
        match plan_sentence(&edges, &paired) {
            PlanOutcome::Aligned(entry) => {
                assert!(
                    entry.pieces.len() >= 2,
                    "paired must re-split: {:?}",
                    entry.pieces
                );
                assert_eq!(concat(&entry), target, "paired 不得改写译文");
                assert_invariants(&entry, src.len());
            }
            other => panic!("paired: {other:?}"),
        }
    }

    /// `Paired` 只取消「窄于 soft」方向的宽度罚：`units >= soft` 时代价与
    /// `Auto` 逐字节相同，`units > hard` 仍是硬约束（`None`）。
    #[test]
    fn paired_only_waives_the_narrow_side_of_the_width_term() {
        let (src, target, edges) = r1_short_translation_fixture();
        let auto = BilingualPlanInput::new(src.clone(), &target, "en", "zh");
        let mut paired = auto.clone();
        paired.density = AlignDensity::Paired;
        let target_chars: Vec<char> = target.chars().collect();
        let candidates: Vec<usize> = target_cut_candidates(&target, "zh", &auto.params, &[])
            .into_iter()
            .map(|candidate| candidate.pos)
            .collect();
        let blocks = minimal_monotonic_blocks(&edges, &src, &target, &candidates, DEFAULT_EDGE_TAU);
        assert!(blocks.len() >= 2, "{blocks:?}");
        let word_units = auto.word_units();
        let seam_costs: BTreeMap<usize, f64> =
            target_cut_candidates(&target, &auto.lang, &auto.params, &auto.protected_terms)
                .into_iter()
                .map(|candidate| (candidate.pos, candidate.seam_cost))
                .collect();
        let whole = |input: &BilingualPlanInput| {
            pair_cost(
                &blocks,
                0,
                blocks.len(),
                None,
                input,
                &target_chars,
                &word_units,
                &seam_costs,
            )
            .expect("whole-sentence piece is feasible")
        };
        // 整句宽度 < soft(14)：paired 免掉的正是这一项，其余项逐字节相同。
        let soft = auto.params.soft as f64;
        let width = ((target_cps_chars(&target, "zh") as f64 - soft) / soft).powi(2);
        assert!(width > 0.0);
        assert!((whole(&auto) - whole(&paired) - width).abs() < 1e-9);
    }

    // ---- 行分区直通（`plan_sentence_rows`） --------------------------------

    /// 把「行文本」列表变成 `target` 上的字符区间；行文本必须按序拼成 `target`。
    fn row_ranges(rows: &[&str]) -> Vec<Range<usize>> {
        let mut cursor = 0usize;
        rows.iter()
            .map(|row| {
                let start = cursor;
                cursor += row.chars().count();
                start..cursor
            })
            .collect()
    }

    /// 每行一条软边覆盖该行全区间（模型给的行归属就长这样）。
    fn row_edges(rows: &[(&[usize], Range<usize>)]) -> Vec<AlignEdge> {
        rows.iter()
            .flat_map(|(ordinals, range)| {
                ordinals
                    .iter()
                    .map(move |&src| AlignEdge::soft(src, range.clone(), 0.8))
            })
            .collect()
    }

    /// 行边界被冻结成块边界：pieces 数 = 行数、片文本 = 行文本、
    /// `aligner` 走行标签、I3/I4 成立。
    #[test]
    fn rows_become_pieces_one_to_one_with_the_declared_source_spans() {
        let src = words(&[
            "We", "first", "analyze", "the", "data,", "then", "train", "the", "model,", "and",
            "finally", "deploy", "the", "service.",
        ]);
        let target = "我们先分析数据，然后训练模型，最后部署服务。";
        let rows = ["我们先分析数据，", "然后训练模型，", "最后部署服务。"];
        let ranges = row_ranges(&rows);
        let edges = row_edges(&[
            (&[0, 1, 2, 3, 4], ranges[0].clone()),
            (&[5, 6, 7, 8], ranges[1].clone()),
            (&[9, 10, 11, 12, 13], ranges[2].clone()),
        ]);
        let mut input = BilingualPlanInput::new(src.clone(), target, "en", "zh");
        input.aligner = "llm-rows+anchor/1".to_owned();
        let plan = plan_sentence_rows(&edges, &ranges, &input).expect("row plan");
        let entry = plan.entry;

        assert_eq!(entry.pieces.len(), rows.len());
        assert_eq!(
            entry
                .pieces
                .iter()
                .map(|piece| piece.text.as_str())
                .collect::<Vec<_>>(),
            rows
        );
        assert_eq!(entry.pieces[0].from, Some(0));
        assert_eq!(entry.pieces[0].to, Some(4));
        assert_eq!(entry.pieces[1].from, Some(5));
        assert_eq!(entry.pieces[2].to, Some(13));
        assert_eq!(entry.correspondence, Some(Correspondence::Block));
        assert_eq!(entry.text_basis, TextBasis::Trans);
        assert_eq!(entry.aligner.as_deref(), Some("llm-rows+anchor/1"));
        assert_eq!(concat(&entry), target);
        assert_invariants(&entry, src.len());
        // 行边把整行钉成一个块：块与片一一对应，块的源区间就是行声明的区间。
        assert_eq!(entry.blocks.len(), entry.pieces.len());
        assert_eq!(entry.blocks[0].src, (0, 4));
        assert_eq!(entry.blocks[1].src, (5, 8));
        assert_eq!(entry.blocks[2].src, (9, 13));
    }

    /// 单行覆盖整句（语序对不上时的退化形态）：一片、块仍可细分。
    #[test]
    fn a_single_row_covering_the_whole_sentence_yields_one_piece() {
        let src = words(&["I", "didn't", "go", "because", "I", "was", "sick."]);
        let target = "因为我病了，所以没去。";
        let ranges = row_ranges(&[target]);
        let edges = row_edges(&[(&[0, 1, 2, 3, 4, 5, 6], ranges[0].clone())]);
        let input = BilingualPlanInput::new(src.clone(), target, "en", "zh");
        let plan = plan_sentence_rows(&edges, &ranges, &input).expect("row plan");
        let entry = plan.entry;
        assert_eq!(entry.pieces.len(), 1);
        assert_eq!(concat(&entry), target);
        assert_invariants(&entry, src.len());
    }

    /// 行本身超 hard：再切只允许发生在该行内部，绝不跨行合并。行边把整行
    /// 的目标区间钉成一个块，行内没有任何独立证据可切，于是整句返回 `None`
    /// 回落常规路径——宁可多派一次 align，也不用比例锚定冒充语义边界。
    #[test]
    fn an_over_hard_row_falls_back_instead_of_merging_across_rows() {
        let src = words(&[
            "We",
            "first",
            "analyze",
            "the",
            "raw",
            "data,",
            "then",
            "train",
            "the",
            "model",
            "on",
            "it,",
            "and",
            "finally",
            "deploy",
            "the",
            "service",
            "to",
            "production.",
        ]);
        let target = "我们先分析原始数据，然后在上面训练模型，最后把服务部署到生产环境。";
        let rows = [
            "我们先分析原始数据，",
            "然后在上面训练模型，最后把服务部署到生产环境。",
        ];
        let ranges = row_ranges(&rows);
        let edges = row_edges(&[
            (&[0, 1, 2, 3, 4, 5], ranges[0].clone()),
            (&(6..19).collect::<Vec<_>>(), ranges[1].clone()),
        ]);
        let input = BilingualPlanInput::new(src.clone(), target, "en", "zh");
        assert!(
            target_cps_chars(rows[1], "zh") > input.params.hard,
            "第二行必须超 hard 才能覆盖再切分支"
        );
        assert!(plan_sentence_rows(&edges, &ranges, &input).is_none());
        // 回落后的常规路径照常给出方案（这一句本来就有 dedicated 轮兜底）。
        assert!(!matches!(
            plan_sentence(&edges, &input),
            PlanOutcome::Aligned(_)
        ));
    }

    /// 行边界与硬锚冲突（锚点横跨行缝）：不硬拗，整句返回 `None` 回落常规路径。
    #[test]
    fn a_row_boundary_straddled_by_an_anchor_falls_back() {
        let src = words(&[
            "We", "shipped", "version", "2024", "last", "week", "already.",
        ]);
        let target = "我们上周就发布了2024版本。";
        // 模型把行切在 "了" 之后——正好切进硬锚 "2024版本" 覆盖的区间。
        let rows = ["我们上周就发布了2", "024版本。"];
        let ranges = row_ranges(&rows);
        let mut edges = row_edges(&[
            (&[0, 1, 4, 5, 6], ranges[0].clone()),
            (&[2, 3], ranges[1].clone()),
        ]);
        edges.push(AlignEdge::hard(3, span(target, "2024版本")));
        let input = BilingualPlanInput::new(src.clone(), target, "en", "zh");
        assert!(plan_sentence_rows(&merge_edges(vec![edges]), &ranges, &input).is_none());
    }

    /// 自定时间的锚定词（合并判据依赖行时长，等间距 helper 不够用）。
    fn timed_words(spans: &[(f64, f64)]) -> Vec<AnchorWord> {
        spans
            .iter()
            .enumerate()
            .map(|(index, &(t0, t1))| AnchorWord {
                id: format!("g1.{index}"),
                text: format!("w{index}"),
                t0,
                t1,
                glue: false,
            })
            .collect()
    }

    /// 确定性行合并：[2 单位/0.6s] + [5/1.2s] + [9/2.5s] ⇒ 两行。
    ///
    /// 第一行 0.6s < 1.0s 触发合并，只有右邻可合（7 单位 / 1.8s，cps 3.9）；
    /// 合并后两行都不再"太短"，迭代停止。
    #[test]
    fn short_rows_are_merged_deterministically_after_the_row_split() {
        let src = timed_words(&[
            (0.0, 0.6),
            (0.6, 1.2),
            (1.2, 1.8),
            (1.8, 2.6),
            (2.6, 3.4),
            (3.4, 4.3),
        ]);
        let rows = ["甲乙", "丙丁戊己庚", "辛壬癸子丑寅卯辰巳"];
        let target: String = rows.concat();
        let ranges = row_ranges(&rows);
        let edges = row_edges(&[
            (&[0], ranges[0].clone()),
            (&[1, 2], ranges[1].clone()),
            (&[3, 4, 5], ranges[2].clone()),
        ]);
        let input = BilingualPlanInput::new(src.clone(), &target, "en", "zh");
        assert_eq!(target_cps_chars(rows[0], "zh"), 2);
        assert_eq!(target_cps_chars(rows[1], "zh"), 5);
        assert_eq!(target_cps_chars(rows[2], "zh"), 9);

        let plan = plan_sentence_rows(&edges, &ranges, &input).expect("row plan");
        assert_eq!(plan.merged_rows, 1);
        assert_eq!(
            plan.entry
                .pieces
                .iter()
                .map(|piece| piece.text.as_str())
                .collect::<Vec<_>>(),
            ["甲乙丙丁戊己庚", "辛壬癸子丑寅卯辰巳"]
        );
        assert_eq!(plan.entry.pieces[0].from, Some(0));
        assert_eq!(plan.entry.pieces[0].to, Some(2));
        assert_eq!(plan.entry.pieces[1].from, Some(3));
        // 块层不跟着变粗：仍是模型给的三行对应。
        assert_eq!(plan.entry.blocks.len(), 3);
        assert_eq!(concat(&plan.entry), target);
        assert_invariants(&plan.entry, src.len());
    }

    #[test]
    fn paired_density_keeps_narrow_rows_when_duration_and_cps_are_safe() {
        let src = timed_words(&[
            (0.0, 1.2),
            (1.2, 1.8),
            (1.8, 2.4),
            (2.4, 3.1),
            (3.1, 3.8),
            (3.8, 4.5),
        ]);
        let rows = ["甲乙", "丙丁戊己庚", "辛壬癸子丑寅卯辰巳"];
        let target: String = rows.concat();
        let ranges = row_ranges(&rows);
        let edges = row_edges(&[
            (&[0], ranges[0].clone()),
            (&[1, 2], ranges[1].clone()),
            (&[3, 4, 5], ranges[2].clone()),
        ]);
        let auto = BilingualPlanInput::new(src.clone(), &target, "en", "zh");
        let auto_plan = plan_sentence_rows(&edges, &ranges, &auto).expect("auto row plan");
        assert_eq!(auto_plan.entry.pieces.len(), 2);

        let mut paired = auto;
        paired.density = AlignDensity::Paired;
        let paired_plan = plan_sentence_rows(&edges, &ranges, &paired).expect("paired row plan");
        assert_eq!(paired_plan.merged_rows, 0);
        assert_eq!(paired_plan.entry.pieces.len(), 3);
        assert_invariants(&paired_plan.entry, src.len());
    }

    /// 合并守卫：相邻行已经接近 fit 时不合并（合并后 > fit 单位），短行原样留下。
    #[test]
    fn a_short_row_next_to_a_wide_row_is_left_alone() {
        let src = timed_words(&[(0.0, 0.6), (0.6, 1.6), (1.6, 2.6), (2.6, 3.6)]);
        let wide = "甲乙丙丁戊己庚辛壬癸子丑寅卯辰";
        let rows = ["子丑", wide];
        let target: String = rows.concat();
        assert_eq!(target_cps_chars(rows[0], "zh"), 2);
        assert_eq!(target_cps_chars(wide, "zh"), 15);
        let ranges = row_ranges(&rows);
        let edges = row_edges(&[(&[0], ranges[0].clone()), (&[1, 2, 3], ranges[1].clone())]);
        let input = BilingualPlanInput::new(src.clone(), &target, "en", "zh");
        // 2 + 15 = 17 > fit 16 ⇒ 合并非法。
        assert!(2 + target_cps_chars(wide, "zh") > input.params.fit);

        let plan = plan_sentence_rows(&edges, &ranges, &input).expect("row plan");
        assert_eq!(plan.merged_rows, 0);
        assert_eq!(plan.entry.pieces.len(), 2);
        assert_eq!(plan.entry.pieces[0].text, "子丑");
        assert_invariants(&plan.entry, src.len());
    }

    /// 守卫分级：由 **cps > 6** 触发的合并允许合并后宽度到 hard（20），
    /// 只由"太小"触发的仍守 fit（16）。这里两行各 9 单位、各 1.0s（cps 9），
    /// 合并后 18 单位 > fit 16 但 ≤ hard 20 ⇒ 合并；读速降到 9.0。
    #[test]
    fn a_too_fast_row_may_merge_up_to_hard_not_just_fit() {
        let src = timed_words(&[(0.0, 0.5), (0.5, 1.0), (1.0, 1.5), (1.5, 2.0)]);
        let rows = ["甲乙丙丁戊己庚辛壬", "癸子丑寅卯辰巳午未"];
        let target: String = rows.concat();
        assert_eq!(target_cps_chars(rows[0], "zh"), 9);
        let ranges = row_ranges(&rows);
        let edges = row_edges(&[(&[0, 1], ranges[0].clone()), (&[2, 3], ranges[1].clone())]);
        let input = BilingualPlanInput::new(src.clone(), &target, "en", "zh");
        // 两行都是 9 单位 / 1.0s = 9 cps > 6，但都不"太小"。
        assert!(9 > input.params.fit / 2);
        assert!(18 > input.params.fit && 18 <= input.params.hard);

        let plan = plan_sentence_rows(&edges, &ranges, &input).expect("row plan");
        assert_eq!(plan.merged_rows, 1);
        assert_eq!(plan.entry.pieces.len(), 1);
        assert_eq!(plan.entry.pieces[0].text, target);
        assert_invariants(&plan.entry, src.len());
    }

    /// 反面：同样宽的两行，如果读速本来就合规（各 9 单位 / 2.0s = 4.5 cps），
    /// 谁也不"太快"也不"太小" ⇒ 根本不触发合并，18 单位的宽行不会出现。
    #[test]
    fn rows_that_read_comfortably_are_never_widened_past_fit() {
        let src = timed_words(&[(0.0, 1.0), (1.0, 2.0), (2.0, 3.0), (3.0, 4.0)]);
        let rows = ["甲乙丙丁戊己庚辛壬", "癸子丑寅卯辰巳午未"];
        let target: String = rows.concat();
        let ranges = row_ranges(&rows);
        let edges = row_edges(&[(&[0, 1], ranges[0].clone()), (&[2, 3], ranges[1].clone())]);
        let input = BilingualPlanInput::new(src.clone(), &target, "en", "zh");
        let plan = plan_sentence_rows(&edges, &ranges, &input).expect("row plan");
        assert_eq!(plan.merged_rows, 0);
        assert_eq!(plan.entry.pieces.len(), 2);
        assert_invariants(&plan.entry, src.len());
    }

    /// 合并守卫之二：合并后时长超过 `max_duration_sec`（缺省 7s）也不合并。
    #[test]
    fn a_short_row_is_not_merged_past_the_dwell_ceiling() {
        let src = timed_words(&[(0.0, 0.6), (0.6, 7.0), (7.0, 8.0)]);
        let rows = ["甲乙", "丙丁戊己庚辛"];
        let target: String = rows.concat();
        let ranges = row_ranges(&rows);
        let edges = row_edges(&[(&[0], ranges[0].clone()), (&[1, 2], ranges[1].clone())]);
        let input = BilingualPlanInput::new(src.clone(), &target, "en", "zh");
        // 合并后 0.0..8.0 = 8s > 7s。
        let plan = plan_sentence_rows(&edges, &ranges, &input).expect("row plan");
        assert_eq!(plan.merged_rows, 0);
        assert_eq!(plan.entry.pieces.len(), 2);
        assert_invariants(&plan.entry, src.len());
    }

    /// 没有任何参与判定的边 ⇒ 不走行直通（证据不足）。
    #[test]
    fn rows_without_counted_edges_fall_back() {
        let src = words(&["alpha", "bravo", "charlie", "delta"]);
        let target = "甲乙丙丁。";
        let ranges = row_ranges(&["甲乙", "丙丁。"]);
        let input = BilingualPlanInput::new(src, target, "en", "zh");
        assert!(plan_sentence_rows(&[], &ranges, &input).is_none());
    }
}
