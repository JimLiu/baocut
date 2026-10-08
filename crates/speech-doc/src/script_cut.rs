//! 按稿预剪（`bcut cut script`）的确定性引擎：稿与识别出来的转录做序列比对，
//! 找出录音里多说的连续词段，分成 `repeat` / `filler` / `extra` 三种原因，再把
//! 起止吸附到素材自己的静音处。规格见口播成片方案稿 §5.1。
//!
//! 本模块零 I/O：稿的读法（纯文本 / SRT / LRC / JSON）在 [`crate::script`]，
//! 音频能量由 host 读成 BCW1 峰值后以 [`SilenceMap`] 交进来，写入时间轴在
//! `bcut-workspace`。
//!
//! **与语言无关**：
//! - 词元化只看 Unicode 属性：兼容分解后再合成（NFKC）、小写，去掉标点、符号与空白；
//!   不用空格分词的文字（汉字、假名、谚文、泰文、老挝文、高棉文、缅甸文、藏文等）
//!   按字位逐个成词元，其余文字按连续的字母数字成词。撇号只去掉、不断词。
//! - 替换（识别听错、换了个说法）**永不剪**，所以比对不需要读音归一化，也不展开数字。
//! - 口癖表是按语言的数据，由调用方按转录语言传入；没有表时不产出 `filler`，这类段落归 `extra`。
//!
//! **规模**：比对不是平方算法。先剥公共前后缀，再取两侧都只出现一次的 k 元组做锚点
//! （k 依次取 8 / 4 / 2 / 1），用最长递增子序列挑出一条单调锚链，锚点之间的缝递归；
//! 缝缩到 [`GAP_CELL_CAP`] 以内才交给 [`crate::lcs::lcs_matches`] 做精确 LCS。
//! 既找不到锚点又超过上限的缝整段记为没对上（确定性；多半是拿错了稿，覆盖率会低）。
//! [`AlignStats`] 记下实际做了多少 LCS 单元，量级测试用它钉住「不是平方」。

use std::collections::HashMap;

use unicode_general_category::{GeneralCategory, get_general_category};
use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;

use crate::lcs::{AtomInterner, lcs_matches};

/// 单个缝交给精确 LCS 的单元上限（(n+1)·(m+1)）。约 2000 × 2000 词元。
pub const GAP_CELL_CAP: usize = 4_000_000;
/// 锚点 k 元组的长度，从长到短依次尝试。
const ANCHOR_WIDTHS: [usize; 4] = [8, 4, 2, 1];
/// `repeat` 判定看紧邻保留段的窗口：`2 × 段长 + REPEAT_WINDOW_SLACK` 个词元。
const REPEAT_WINDOW_SLACK: usize = 8;
/// 同一句起了几次头时，拼成 `repeat` 的每一片至少这么多个词元（一个词元的片太容易撞上）。
const REPEAT_MIN_PIECE_TOKENS: usize = 2;
/// 超过这么多词元的段不按片拼（见 [`covered_by_pieces`]）。
const REPEAT_PIECE_MAX_TOKENS: usize = 512;
/// 短于这个时长的剪口丢掉（秒）。
pub const MIN_CUT_SECONDS: f64 = 0.05;
/// 静音阈值：取包络 95 分位往下这么多分贝。
const SILENCE_BELOW_HIGH_DB: f64 = 35.0;
/// 静音阈值下限：底噪（10 分位）往上这么多分贝……
const SILENCE_ABOVE_FLOOR_DB: f64 = 6.0;
/// ……但不高过 95 分位往下这么多分贝（底噪很高的素材宁可吸附不到）。
const SILENCE_MAX_BELOW_HIGH_DB: f64 = 15.0;
/// 静音段至少连续这么多个 bin。
const SILENCE_MIN_BINS: usize = 2;

/// 保留哪一遍。`Last` 是缺省：同一句说了两遍，留后一遍。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Take {
    Last,
    First,
}

impl Take {
    pub fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "last" => Some(Self::Last),
            "first" => Some(Self::First),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Last => "last",
            Self::First => "first",
        }
    }
}

/// 候选剪口的原因。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    Repeat,
    Filler,
    Extra,
}

impl Reason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Repeat => "repeat",
            Self::Filler => "filler",
            Self::Extra => "extra",
        }
    }

    /// 写进时间轴溯源的剪口类别。
    pub fn cut_kind(self) -> &'static str {
        match self {
            Self::Repeat => "badTake",
            Self::Filler => "filler",
            Self::Extra => "offScript",
        }
    }
}

/// 录音一侧的一个转录词（调用方已去掉 `hidden` 的词）。
#[derive(Debug, Clone, PartialEq)]
pub struct RecWord {
    pub text: String,
    pub t0: f64,
    pub t1: f64,
}

/// 一段录音多出来的连续词（词下标闭区间）。
#[derive(Debug, Clone, PartialEq)]
pub struct PlanSegment {
    pub first: usize,
    pub last: usize,
    pub reason: Reason,
}

/// 比对的开销记录。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AlignStats {
    /// 交给精确 LCS 的单元总数。
    pub lcs_cells: u64,
    /// 找锚点时入表的 k 元组总数。
    pub hashed: u64,
    /// 既找不到锚点、又超过上限而整段记为没对上的缝里，稿一侧的词元数。
    pub unresolved_script_tokens: usize,
    /// 同上，录音一侧的词元数。
    pub unresolved_rec_tokens: usize,
}

/// 比对与分类的结果。
#[derive(Debug, Clone, PartialEq)]
pub struct MatchPlan {
    pub script_tokens: usize,
    pub matched: usize,
    /// 录音多出来的段，按时间顺序。
    pub segments: Vec<PlanSegment>,
    /// 整行都没念的稿行（0 起的行下标）。
    pub missing_lines: Vec<usize>,
    pub stats: AlignStats,
}

impl MatchPlan {
    /// 稿的词元里对上的比例；稿里没有词元时是 0。
    pub fn coverage(&self) -> f64 {
        if self.script_tokens == 0 {
            0.0
        } else {
            self.matched as f64 / self.script_tokens as f64
        }
    }
}

/// 不用空格分词、按字位逐个成词元的文字。
fn is_spaceless_char(ch: char) -> bool {
    matches!(ch as u32,
        0x0E00..=0x0EFF      // 泰文、老挝文
        | 0x0F00..=0x0FFF    // 藏文
        | 0x1000..=0x109F    // 缅甸文
        | 0x1100..=0x11FF    // 谚文字母
        | 0x1780..=0x17FF    // 高棉文
        | 0x19E0..=0x19FF    // 高棉符号
        | 0x2E80..=0x2FDF    // 部首
        | 0x3040..=0x30FF    // 假名
        | 0x3100..=0x312F    // 注音
        | 0x3130..=0x318F    // 谚文兼容字母
        | 0x31A0..=0x31FF    // 注音扩展、片假名音标扩展
        | 0x3400..=0x4DBF    // 汉字扩展 A
        | 0x4E00..=0x9FFF    // 汉字
        | 0xA000..=0xA4CF    // 彝文
        | 0xAC00..=0xD7AF    // 谚文音节
        | 0xF900..=0xFAFF    // 兼容汉字
        | 0x20000..=0x323AF  // 汉字扩展 B 起
    )
}

fn is_word_char(ch: char) -> bool {
    use GeneralCategory::*;
    matches!(
        get_general_category(ch),
        UppercaseLetter
            | LowercaseLetter
            | TitlecaseLetter
            | ModifierLetter
            | OtherLetter
            | DecimalNumber
            | LetterNumber
            | OtherNumber
            | NonspacingMark
            | SpacingMark
            | EnclosingMark
    )
}

/// 撇号类：去掉，但不断词（`don't` 与 `dont` 同一个词元）。
fn is_apostrophe(ch: char) -> bool {
    matches!(ch, '\'' | '\u{2019}' | '\u{02BC}' | '\u{2018}' | '\u{FF07}')
}

/// 一段文本的归一化词元（见模块文档）。
pub fn tokens(text: &str) -> Vec<String> {
    let normalized: String = text.nfkc().flat_map(char::to_lowercase).collect();
    let mut out = Vec::new();
    let mut run = String::new();
    for grapheme in normalized.graphemes(true) {
        let Some(base) = grapheme.chars().next() else {
            continue;
        };
        if is_apostrophe(base) && grapheme.chars().count() == 1 {
            continue;
        }
        if is_spaceless_char(base) {
            if !run.is_empty() {
                out.push(std::mem::take(&mut run));
            }
            out.push(grapheme.chars().filter(|&ch| is_word_char(ch)).collect());
            continue;
        }
        if is_word_char(base) {
            run.extend(grapheme.chars().filter(|&ch| is_word_char(ch)));
        } else if !run.is_empty() {
            out.push(std::mem::take(&mut run));
        }
    }
    if !run.is_empty() {
        out.push(run);
    }
    out
}

/// 口癖比较用的词键：小写并去掉首尾非字母数字（与 `cut detect` 的口癖归一化同一口径）。
pub fn filler_key(text: &str) -> String {
    text.to_lowercase()
        .trim_matches(|ch: char| !ch.is_alphanumeric())
        .to_owned()
}

/// 比对并分类。`lines` 是按稿读法切出来的行；`fillers` 是口癖短语（每条短语是若干
/// 已按 [`filler_key`] 归一的词），`None` 表示这门语言没有口癖表。
pub fn plan(
    lines: &[String],
    words: &[RecWord],
    take: Take,
    fillers: Option<&[Vec<String>]>,
) -> MatchPlan {
    let mut interner = AtomInterner::default();
    let mut script = Vec::new();
    let mut script_line = Vec::new();
    for (line_index, line) in lines.iter().enumerate() {
        for token in tokens(line) {
            script.push(interner.intern(&token));
            script_line.push(line_index);
        }
    }
    let mut rec = Vec::new();
    let mut word_tokens = Vec::with_capacity(words.len());
    for word in words {
        let start = rec.len();
        for token in tokens(&word.text) {
            rec.push(interner.intern(&token));
        }
        word_tokens.push(start..rec.len());
    }

    let mut stats = AlignStats::default();
    let mut pairs = match take {
        Take::First => align(&script, &rec, &mut stats),
        Take::Last => {
            let rev_a = script.iter().rev().copied().collect::<Vec<_>>();
            let rev_b = rec.iter().rev().copied().collect::<Vec<_>>();
            let (n, m) = (script.len(), rec.len());
            let mut pairs = align(&rev_a, &rev_b, &mut stats)
                .into_iter()
                .map(|(i, j)| (n - 1 - i, m - 1 - j))
                .collect::<Vec<_>>();
            pairs.reverse();
            pairs
        }
    };
    slide_insertions(&mut pairs, script.len(), &rec, take);

    let (script_state, rec_state) = classify_tokens(&pairs, script.len(), rec.len());
    let matched = pairs.len();

    let mut missing_lines = Vec::new();
    {
        let mut index = 0;
        while index < script.len() {
            let line = script_line[index];
            let mut all_missing = true;
            while index < script.len() && script_line[index] == line {
                all_missing &= script_state[index] == TokenState::Unmatched;
                index += 1;
            }
            if all_missing {
                missing_lines.push(line);
            }
        }
    }

    // 词的状态：任一词元对上或落在替换里就保留；全是录音多就是候选；没有词元的中性。
    #[derive(Clone, Copy, PartialEq)]
    enum WordState {
        Kept,
        Extra,
        Empty,
    }
    let word_state = word_tokens
        .iter()
        .map(|range| {
            if range.is_empty() {
                WordState::Empty
            } else if range.clone().all(|j| rec_state[j] == TokenState::Unmatched) {
                WordState::Extra
            } else {
                WordState::Kept
            }
        })
        .collect::<Vec<_>>();

    let filler_keys = fillers.map(|_| {
        words
            .iter()
            .map(|word| filler_key(&word.text))
            .collect::<Vec<_>>()
    });

    let mut segments = Vec::new();
    let mut index = 0;
    while index < words.len() {
        if word_state[index] != WordState::Extra {
            index += 1;
            continue;
        }
        let first = index;
        let mut last = index;
        let mut cursor = index + 1;
        while cursor < words.len() && word_state[cursor] != WordState::Kept {
            if word_state[cursor] == WordState::Extra {
                last = cursor;
            }
            cursor += 1;
        }
        index = last + 1;

        let filler_words = match (fillers, &filler_keys) {
            (Some(phrases), Some(keys)) => filler_cover(&keys[first..=last], phrases),
            _ => vec![false; last - first + 1],
        };
        let segment_tokens = (first..=last)
            .filter(|&word| !filler_words[word - first])
            .flat_map(|word| rec[word_tokens[word].clone()].iter().copied())
            .collect::<Vec<_>>();
        let token_start = word_tokens[first].start;
        let token_end = word_tokens[last].end;
        let reason = if !segment_tokens.is_empty()
            && is_repeat(
                &segment_tokens,
                &rec,
                &rec_state,
                token_start,
                token_end,
                take,
            ) {
            Reason::Repeat
        } else if fillers.is_some() && filler_words.iter().all(|&filler| filler) {
            Reason::Filler
        } else {
            Reason::Extra
        };
        segments.push(PlanSegment {
            first,
            last,
            reason,
        });
    }
    MatchPlan {
        script_tokens: script.len(),
        matched,
        segments,
        missing_lines,
        stats,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenState {
    Matched,
    /// 同一个缝里两侧都有没对上的词元：替换，保留。
    Replaced,
    /// 纯稿多 / 纯录音多。
    Unmatched,
}

fn classify_tokens(
    pairs: &[(usize, usize)],
    n: usize,
    m: usize,
) -> (Vec<TokenState>, Vec<TokenState>) {
    let mut script_state = vec![TokenState::Unmatched; n];
    let mut rec_state = vec![TokenState::Unmatched; m];
    let mut previous = (0usize, 0usize);
    for &(i, j) in pairs.iter().chain(std::iter::once(&(n, m))) {
        if i > previous.0 && j > previous.1 {
            script_state[previous.0..i].fill(TokenState::Replaced);
            rec_state[previous.1..j].fill(TokenState::Replaced);
        }
        if i < n && j < m {
            script_state[i] = TokenState::Matched;
            rec_state[j] = TokenState::Matched;
        }
        previous = (i + 1, j + 1);
    }
    (script_state, rec_state)
}

/// 纯录音多的缝（稿一侧为空）沿录音滑动，使同样的词保留在 `take` 指定的那一遍：
/// `Last` 往前滑（前一遍被剪），`First` 往后滑。只在相邻的匹配两侧都与缝紧邻、
/// 稿一侧连续时滑，保证滑动不会把插入并进替换。
fn slide_insertions(pairs: &mut [(usize, usize)], script_len: usize, rec: &[u32], take: Take) {
    let count = pairs.len();
    // 匹配 q 挪动后，它另一侧的缝在稿一侧必须仍是空的，否则插入会并进替换。
    let script_contiguous_left = |pairs: &[(usize, usize)], q: usize| {
        if q == 0 {
            pairs[0].0 == 0
        } else {
            pairs[q - 1].0 + 1 == pairs[q].0
        }
    };
    let script_contiguous_right = |pairs: &[(usize, usize)], q: usize| {
        if q + 1 == count {
            pairs[q].0 + 1 == script_len
        } else {
            pairs[q].0 + 1 == pairs[q + 1].0
        }
    };
    match take {
        Take::Last => {
            for p in 1..count {
                // 缝在 pairs[p-1] 与 pairs[p] 之间；稿一侧连续才是纯录音多。
                if pairs[p].0 != pairs[p - 1].0 + 1 || pairs[p].1 == pairs[p - 1].1 + 1 {
                    continue;
                }
                let mut q = p - 1; // 缝左边紧邻的匹配
                loop {
                    let gap_end = pairs[q + 1].1; // 缝的开区间右端
                    let left = pairs[q].1;
                    if rec[left] != rec[gap_end - 1] || !script_contiguous_left(pairs, q) {
                        break;
                    }
                    pairs[q].1 = gap_end - 1;
                    // 再左边一格也是紧邻的匹配才接着滑。
                    if q == 0 || pairs[q - 1].1 + 1 != left {
                        break;
                    }
                    q -= 1;
                }
            }
        }
        Take::First => {
            for p in (0..count.saturating_sub(1)).rev() {
                if pairs[p + 1].0 != pairs[p].0 + 1 || pairs[p + 1].1 == pairs[p].1 + 1 {
                    continue;
                }
                let mut q = p + 1; // 缝右边紧邻的匹配
                loop {
                    let gap_start = pairs[q - 1].1 + 1;
                    let right = pairs[q].1;
                    if rec[right] != rec[gap_start] || !script_contiguous_right(pairs, q) {
                        break;
                    }
                    pairs[q].1 = gap_start;
                    if q + 1 == count || pairs[q + 1].1 != right + 1 {
                        break;
                    }
                    q += 1;
                }
            }
        }
    }
}

/// 贪心地用口癖短语覆盖一段词，返回每个词是否被覆盖（长短语优先）。
fn filler_cover(keys: &[String], phrases: &[Vec<String>]) -> Vec<bool> {
    let mut covered = vec![false; keys.len()];
    let mut index = 0;
    while index < keys.len() {
        let best = phrases
            .iter()
            .filter(|phrase| {
                !phrase.is_empty()
                    && index + phrase.len() <= keys.len()
                    && phrase
                        .iter()
                        .zip(&keys[index..])
                        .all(|(token, key)| token == key)
            })
            .map(Vec::len)
            .max();
        match best {
            Some(length) => {
                covered[index..index + length].fill(true);
                index += length;
            }
            None => index += 1,
        }
    }
    covered
}

/// 段的词元（去掉口癖）能否由 `take` 那一侧紧邻保留段里的连续子串拼出来：整段是一个
/// 子串，或者按顺序切成若干片、每片至少 [`REPEAT_MIN_PIECE_TOKENS`] 个词元且各自是子串
/// （同一句起了几次头：「第一步读时间轴。第一步。」）。片之间夹着保留段里没有的词
/// （道歉、更正词）就不算，这类段落归 `extra`。
fn is_repeat(
    needle: &[u32],
    rec: &[u32],
    rec_state: &[TokenState],
    token_start: usize,
    token_end: usize,
    take: Take,
) -> bool {
    let window = needle.len() * 2 + REPEAT_WINDOW_SLACK;
    let haystack = match take {
        Take::Last => {
            let mut out = Vec::new();
            let mut j = token_end;
            while j < rec.len() && rec_state[j] != TokenState::Unmatched && out.len() < window {
                out.push(rec[j]);
                j += 1;
            }
            out
        }
        Take::First => {
            let mut out = Vec::new();
            let mut j = token_start;
            while j > 0 && rec_state[j - 1] != TokenState::Unmatched && out.len() < window {
                out.push(rec[j - 1]);
                j -= 1;
            }
            out.reverse();
            out
        }
    };
    contains_run(&haystack, needle) || covered_by_pieces(&haystack, needle)
}

/// `needle` 能否按顺序切成若干片，每片至少 [`REPEAT_MIN_PIECE_TOKENS`] 个词元、各自是
/// `haystack` 的连续子串。超过 [`REPEAT_PIECE_MAX_TOKENS`] 的段不切（长段多半是稿外话）。
fn covered_by_pieces(haystack: &[u32], needle: &[u32]) -> bool {
    let n = needle.len();
    if n < REPEAT_MIN_PIECE_TOKENS || n > REPEAT_PIECE_MAX_TOKENS {
        return false;
    }
    // 从 i 起、在 haystack 里出现过的最长前缀长度（出现过的串，其前缀也都出现过）。
    let longest = (0..n)
        .map(|i| {
            (0..haystack.len())
                .map(|p| {
                    needle[i..]
                        .iter()
                        .zip(&haystack[p..])
                        .take_while(|(a, b)| a == b)
                        .count()
                })
                .max()
                .unwrap_or(0)
        })
        .collect::<Vec<_>>();
    let mut reachable = vec![false; n + 1];
    reachable[n] = true;
    for i in (0..n).rev() {
        reachable[i] = (REPEAT_MIN_PIECE_TOKENS..=longest[i]).any(|length| reachable[i + length]);
    }
    reachable[0]
}

/// KMP：`needle` 是否是 `haystack` 的连续子串。
fn contains_run(haystack: &[u32], needle: &[u32]) -> bool {
    if needle.is_empty() || needle.len() > haystack.len() {
        return needle.is_empty();
    }
    let mut failure = vec![0usize; needle.len()];
    let mut k = 0;
    for i in 1..needle.len() {
        while k > 0 && needle[i] != needle[k] {
            k = failure[k - 1];
        }
        if needle[i] == needle[k] {
            k += 1;
        }
        failure[i] = k;
    }
    let mut k = 0;
    for &value in haystack {
        while k > 0 && value != needle[k] {
            k = failure[k - 1];
        }
        if value == needle[k] {
            k += 1;
            if k == needle.len() {
                return true;
            }
        }
    }
    false
}

/// 两串词元的保序匹配对（偏早：同样长的匹配里取靠前的那一遍）。
pub fn align(a: &[u32], b: &[u32], stats: &mut AlignStats) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    align_range(a, b, 0, a.len(), 0, b.len(), stats, &mut out);
    out
}

#[allow(clippy::too_many_arguments)]
fn align_range(
    a: &[u32],
    b: &[u32],
    mut a0: usize,
    mut a1: usize,
    mut b0: usize,
    mut b1: usize,
    stats: &mut AlignStats,
    out: &mut Vec<(usize, usize)>,
) {
    while a0 < a1 && b0 < b1 && a[a0] == b[b0] {
        out.push((a0, b0));
        a0 += 1;
        b0 += 1;
    }
    let mut suffix = 0;
    while a0 < a1 && b0 < b1 && a[a1 - 1] == b[b1 - 1] {
        a1 -= 1;
        b1 -= 1;
        suffix += 1;
    }
    let (n, m) = (a1 - a0, b1 - b0);
    if n > 0 && m > 0 {
        let cells = (n + 1).saturating_mul(m + 1);
        if cells <= GAP_CELL_CAP {
            stats.lcs_cells += cells as u64;
            let matches = lcs_matches(&a[a0..a1], &b[b0..b1], GAP_CELL_CAP)
                .expect("gap is within the cell cap");
            out.extend(matches.into_iter().map(|(i, j)| (a0 + i, b0 + j)));
        } else {
            let anchors = ANCHOR_WIDTHS.iter().find_map(|&width| {
                let anchors = find_anchors(a, b, a0, a1, b0, b1, width, stats);
                (!anchors.is_empty()).then_some((anchors, width))
            });
            match anchors {
                Some((anchors, width)) => {
                    let (mut pa, mut pb) = (a0, b0);
                    for (i, j) in anchors {
                        align_range(a, b, pa, i, pb, j, stats, out);
                        out.extend((0..width).map(|k| (i + k, j + k)));
                        pa = i + width;
                        pb = j + width;
                    }
                    align_range(a, b, pa, a1, pb, b1, stats, out);
                }
                None => {
                    stats.unresolved_script_tokens += n;
                    stats.unresolved_rec_tokens += m;
                }
            }
        }
    }
    out.extend((0..suffix).map(|k| (a1 + k, b1 + k)));
}

/// 在 `[a0,a1) × [b0,b1)` 里取两侧都只出现一次的 `width` 元组，按稿的位置排好后
/// 取录音位置的最长严格递增子序列，再去掉互相重叠的，得到一条单调、不重叠的锚链。
#[allow(clippy::too_many_arguments)]
fn find_anchors(
    a: &[u32],
    b: &[u32],
    a0: usize,
    a1: usize,
    b0: usize,
    b1: usize,
    width: usize,
    stats: &mut AlignStats,
) -> Vec<(usize, usize)> {
    if a1 - a0 < width || b1 - b0 < width {
        return Vec::new();
    }
    // (稿里出现次数, 稿位置, 录音里出现次数, 录音位置)
    let mut table: HashMap<&[u32], (u32, usize, u32, usize)> = HashMap::new();
    for i in a0..=a1 - width {
        let entry = table.entry(&a[i..i + width]).or_insert((0, i, 0, 0));
        entry.0 += 1;
    }
    for j in b0..=b1 - width {
        if let Some(entry) = table.get_mut(&b[j..j + width]) {
            if entry.2 == 0 {
                entry.3 = j;
            }
            entry.2 += 1;
        }
    }
    stats.hashed += ((a1 - a0 + 1 - width) + (b1 - b0 + 1 - width)) as u64;
    let mut unique = table
        .values()
        .filter(|entry| entry.0 == 1 && entry.2 == 1)
        .map(|entry| (entry.1, entry.3))
        .collect::<Vec<_>>();
    unique.sort_unstable();
    let chain = longest_increasing_by_second(&unique);
    let mut anchors = Vec::with_capacity(chain.len());
    let (mut end_a, mut end_b) = (a0, b0);
    for (i, j) in chain {
        if i >= end_a && j >= end_b {
            anchors.push((i, j));
            end_a = i + width;
            end_b = j + width;
        }
    }
    anchors
}

/// 按第一维已排序的点列，取第二维严格递增的最长子序列（O(r log r)，同长取字典序靠前的）。
fn longest_increasing_by_second(points: &[(usize, usize)]) -> Vec<(usize, usize)> {
    let mut tails: Vec<usize> = Vec::new(); // tails[k] = 长度 k+1 的链的末点下标
    let mut parent = vec![usize::MAX; points.len()];
    for (index, &(_, value)) in points.iter().enumerate() {
        let position = tails.partition_point(|&tail| points[tail].1 < value);
        if position > 0 {
            parent[index] = tails[position - 1];
        }
        if position == tails.len() {
            tails.push(index);
        } else {
            tails[position] = index;
        }
    }
    let mut chain = Vec::with_capacity(tails.len());
    let mut cursor = tails.last().copied();
    while let Some(index) = cursor {
        chain.push(points[index]);
        cursor = (parent[index] != usize::MAX).then(|| parent[index]);
    }
    chain.reverse();
    chain
}

/// 素材的静音区间（秒，按时间排序、互不相交）。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SilenceMap {
    runs: Vec<(f64, f64)>,
}

impl SilenceMap {
    /// 从每秒 `bins_per_second` 个 bin 的峰值包络（BCW1 字节）求静音区间。
    ///
    /// 阈值取这条素材自己的响度分布：95 分位往下 [`SILENCE_BELOW_HIGH_DB`]；
    /// 下限是底噪（10 分位）往上 [`SILENCE_ABOVE_FLOOR_DB`]，但下限本身不高过
    /// 95 分位往下 [`SILENCE_MAX_BELOW_HIGH_DB`]。连续至少 [`SILENCE_MIN_BINS`] 个
    /// 不高于阈值的 bin 才算静音。
    pub fn from_levels(levels: &[u8], bins_per_second: f64) -> Self {
        if levels.is_empty() || bins_per_second <= 0.0 || !bins_per_second.is_finite() {
            return Self::default();
        }
        let mut sorted = levels.to_vec();
        sorted.sort_unstable();
        let quantile = |q: f64| f64::from(sorted[((sorted.len() - 1) as f64 * q) as usize]);
        let high = quantile(0.95);
        let floor = quantile(0.10);
        let gain = |db: f64| 10f64.powf(db / 20.0);
        let lower_bound =
            (floor * gain(SILENCE_ABOVE_FLOOR_DB)).min(high * gain(-SILENCE_MAX_BELOW_HIGH_DB));
        let threshold = (high * gain(-SILENCE_BELOW_HIGH_DB))
            .max(lower_bound)
            .max(1.0);
        let mut runs = Vec::new();
        let mut start: Option<usize> = None;
        for (index, &level) in levels.iter().enumerate() {
            let silent = f64::from(level) <= threshold;
            match (silent, start) {
                (true, None) => start = Some(index),
                (false, Some(from)) => {
                    if index - from >= SILENCE_MIN_BINS {
                        runs.push((
                            from as f64 / bins_per_second,
                            index as f64 / bins_per_second,
                        ));
                    }
                    start = None;
                }
                _ => {}
            }
        }
        if let Some(from) = start
            && levels.len() - from >= SILENCE_MIN_BINS
        {
            runs.push((
                from as f64 / bins_per_second,
                levels.len() as f64 / bins_per_second,
            ));
        }
        Self { runs }
    }

    /// 直接给出静音区间（测试与别的能量来源用）。
    pub fn from_runs(mut runs: Vec<(f64, f64)>) -> Self {
        runs.retain(|(start, end)| end > start);
        runs.sort_by(|left, right| left.0.total_cmp(&right.0));
        Self { runs }
    }

    pub fn runs(&self) -> &[(f64, f64)] {
        &self.runs
    }

    /// 在 `[lo, hi]` 里找离 `target` 最近的静音，返回「静音 ∩ 窗口」的中点。
    pub fn snap(&self, lo: f64, hi: f64, target: f64) -> Option<f64> {
        if !(hi > lo) {
            return None;
        }
        let first = self.runs.partition_point(|run| run.1 <= lo);
        let mut best: Option<(f64, f64)> = None;
        for &(start, end) in &self.runs[first..] {
            if start >= hi {
                break;
            }
            let (from, to) = (start.max(lo), end.min(hi));
            if to <= from {
                continue;
            }
            let point = (from + to) / 2.0;
            let distance = (point - target).abs();
            if best.is_none_or(|(_, best_distance)| distance < best_distance) {
                best = Some((point, distance));
            }
        }
        best.map(|(point, _)| point)
    }
}

/// 落好切点的剪口（源秒，已取整到毫秒）。
#[derive(Debug, Clone, PartialEq)]
pub struct PlacedCut {
    pub segment: usize,
    pub t0: f64,
    pub t1: f64,
    /// 两端都吸附到静音。
    pub snapped: bool,
}

fn round_ms(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

/// 给每个候选段落切点：先取词边界，再在 `snap` 秒内吸附到最近的静音；吸附不到的
/// 切点落在词间空档的中点。段落前面没有词时起点取 0，后面没有词时终点取 `duration`
/// （录音开头 / 末尾整段多出来的，连同前后的空白一起剪掉）。
/// 切点不会越过相邻的保留词。短于 [`MIN_CUT_SECONDS`] 的剪口丢掉。
pub fn place_cuts(
    segments: &[PlanSegment],
    words: &[RecWord],
    duration: f64,
    silence: Option<&SilenceMap>,
    snap: f64,
) -> Vec<PlacedCut> {
    let silence = silence.filter(|_| snap > 0.0);
    let mut out = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        let head = &words[segment.first];
        let tail = &words[segment.last];
        let prev_end = segment
            .first
            .checked_sub(1)
            .map_or(0.0, |previous| words[previous].t1.min(head.t0));
        let next_start = words
            .get(segment.last + 1)
            .map_or(duration.max(tail.t1), |next| next.t0.max(tail.t1));

        let start_snap = silence.and_then(|map| {
            map.snap(
                (head.t0 - snap).max(prev_end),
                (head.t0 + snap).min(head.t1.max(head.t0)),
                head.t0,
            )
        });
        let end_snap = silence.and_then(|map| {
            map.snap(
                (tail.t1 - snap).max(tail.t0.min(tail.t1)),
                (tail.t1 + snap).min(next_start),
                tail.t1,
            )
        });
        // 前面没有词（段落在录音开头）时一直剪到 0；后面没有词时一直剪到素材末尾。
        let has_prev = segment.first > 0;
        let has_next = segment.last + 1 < words.len();
        let t0 = round_ms(start_snap.unwrap_or(if has_prev {
            (prev_end + head.t0) / 2.0
        } else {
            0.0
        }));
        let t1 = round_ms(end_snap.unwrap_or(if has_next {
            (tail.t1 + next_start) / 2.0
        } else {
            next_start
        }));
        if t1 - t0 < MIN_CUT_SECONDS {
            continue;
        }
        out.push(PlacedCut {
            segment: index,
            t0,
            t1,
            snapped: start_snap.is_some() && end_snap.is_some(),
        });
    }
    out
}

#[cfg(test)]
#[path = "script_cut_tests.rs"]
mod tests;
