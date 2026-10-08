//! 译文展示切分与投影（v0.3 §5–§7，规范性算法）。
//!
//! - [`TransParams`]：fit（触发）/ soft（建议）/ hard（强制）三阈值；
//! - [`split_independent`]：各自对齐——目标语自身习惯切行（零 LLM）；
//! - [`split_proportional`]：字符占比切 + 缝吸附的通用纯文本工具；
//! - [`anchor_pieces_to_words`]：independent 译片 → 句内源词区间划分
//!   （词原子仍是唯一时间来源）；
//! - [`derive_trans_cues`]：译文 Cue 流投影——export / check / studio 的
//!   统一消费面；无有效 `transAlign` 的句降级整句上屏。

use crate::atomize::{
    atomize, clause_end_char, count_cps_chars, is_cjk_char, join_word_texts, normalize_chars,
    seam_backed_by_whitespace, sentence_end, sep_len, visual_width,
};
use crate::doc::{AlignMode, Correspondence, TextBasis, TransAlign, TranscriptDoc};
use crate::seam::{SeamLintKind, cjk_midword_boundary, is_objective_blocking, lint_pieces};
use crate::sentence::Sentence;

/// BCP-47 主子标签（小写）。
pub fn primary_subtag(lang: &str) -> String {
    lang.split(['-', '_'])
        .next()
        .unwrap_or(lang)
        .to_ascii_lowercase()
}

const DELIVERY_FILE_SUFFIXES: &[&str] = &[
    "app", "ai", "avi", "bin", "c", "cc", "cn", "com", "conf", "cpp", "css", "csv", "dev", "doc",
    "docx", "edu", "gif", "go", "gov", "h", "hpp", "html", "io", "java", "jpeg", "jpg", "js",
    "json", "log", "m", "md", "mov", "mp3", "mp4", "net", "org", "pdf", "php", "plist", "png",
    "py", "rb", "rs", "sh", "sql", "svg", "swift", "toml", "ts", "txt", "uk", "us", "vtt", "wav",
    "xml", "yaml", "yml", "zip",
];

const DELIVERY_ABBREVIATIONS: &[&str] = &[
    "mr", "mrs", "ms", "dr", "prof", "st", "sr", "jr", "rev", "hon", "fr", "gen", "gov", "sen",
    "rep", "col", "lt", "sgt", "capt", "vs", "etc", "inc", "ltd", "corp", "dept", "vol", "fig",
];

fn is_delivery_ascii_token(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || "._-@/:\\~%+?=&()[]{}".contains(ch)
}

fn delivery_suffix(token: &str) -> bool {
    DELIVERY_FILE_SUFFIXES
        .iter()
        .any(|suffix| token.eq_ignore_ascii_case(suffix))
}

fn delivery_code_like(token: &str) -> bool {
    let lower = token.to_ascii_lowercase();
    if [
        "://", "@", "/", "\\", "=", "{", "}", "[", "]", "_", "::", "->",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
        || (lower.contains('(') && lower.contains(')'))
    {
        return true;
    }
    let stripped = lower.trim_matches(|ch| "\"'()[]{}<>,;:!?，。！？".contains(ch));
    let pieces: Vec<&str> = stripped
        .split('.')
        .filter(|piece| !piece.is_empty())
        .collect();
    pieces.len() >= 2 && pieces.last().is_some_and(|piece| delivery_suffix(piece))
}

fn preserve_delivery_ascii_period(chars: &[char], index: usize) -> bool {
    let previous = index.checked_sub(1).and_then(|i| chars.get(i)).copied();
    let next = chars.get(index + 1).copied();
    if previous.is_some_and(is_cjk_char) || next.is_some_and(is_cjk_char) {
        if previous.is_some_and(is_cjk_char) && next.is_some_and(|ch| ch.is_ascii_alphanumeric()) {
            let mut right = index + 1;
            while right < chars.len()
                && (chars[right].is_ascii_alphanumeric() || chars[right] == '.')
            {
                right += 1;
            }
            let token: String = chars[index + 1..right].iter().collect();
            let pieces: Vec<&str> = token
                .trim_matches('.')
                .split('.')
                .filter(|piece| !piece.is_empty())
                .collect();
            if pieces.first().is_some_and(|piece| delivery_suffix(piece))
                || pieces.last().is_some_and(|piece| delivery_suffix(piece))
            {
                return true;
            }
        }
        return false;
    }
    if previous.is_some_and(|ch| ch.is_ascii_digit()) && next.is_some_and(|ch| ch.is_ascii_digit())
    {
        return true;
    }
    if previous.is_some_and(|ch| ch.is_ascii_alphanumeric())
        && next.is_some_and(|ch| ch.is_ascii_alphanumeric())
    {
        return true;
    }

    let mut left = index;
    while left > 0 && is_delivery_ascii_token(chars[left - 1]) {
        left -= 1;
    }
    let mut right = index + 1;
    while right < chars.len() && is_delivery_ascii_token(chars[right]) {
        right += 1;
    }
    let token: String = chars[left..right].iter().collect();
    let lower = token.to_ascii_lowercase();

    if next.is_none_or(|ch| !is_delivery_ascii_token(ch)) {
        let prefix: String = chars[left..index].iter().collect();
        let prefix = prefix.to_ascii_lowercase();
        let prefix = prefix.trim_matches(|ch| "\"'()[]{}<>,;:!?，。！？".contains(ch));
        let pieces: Vec<&str> = prefix
            .split('.')
            .filter(|piece| !piece.is_empty())
            .collect();
        if pieces.len() >= 2 && pieces.last().is_some_and(|piece| delivery_suffix(piece)) {
            return false;
        }
    }
    if index == left
        && next.is_some_and(|ch| ch.is_ascii_alphanumeric())
        && (left == 0 || chars[left - 1].is_whitespace())
    {
        return true;
    }
    if delivery_code_like(&token)
        || (lower.chars().any(|ch| ch.is_ascii_digit()) && lower.contains('.'))
    {
        return true;
    }
    let pieces: Vec<&str> = lower.split('.').filter(|piece| !piece.is_empty()).collect();
    if pieces.len() >= 2
        && pieces
            .iter()
            .all(|piece| piece.len() == 1 && piece.as_bytes()[0].is_ascii_alphabetic())
    {
        return true;
    }
    if next.is_some_and(|ch| ch.is_ascii_alphanumeric())
        && pieces.len() >= 2
        && pieces.last().is_some_and(|piece| delivery_suffix(piece))
    {
        return true;
    }
    if index + 1 == right {
        let mut word_left = index;
        while word_left > 0 && chars[word_left - 1].is_ascii_alphabetic() {
            word_left -= 1;
        }
        let stem: String = chars[word_left..index].iter().collect();
        if DELIVERY_ABBREVIATIONS.contains(&stem.to_ascii_lowercase().as_str()) {
            return true;
        }
    }
    false
}

fn delivery_closing_delimiter(chars: &[char], index: usize) -> bool {
    let ch = chars[index];
    if !matches!(ch, '\'' | '"') {
        return ")]}）］｝】〕」』〉》”’".contains(ch);
    }
    let intra_word = |i: usize| {
        chars[i] == '\''
            && i > 0
            && i + 1 < chars.len()
            && chars[i - 1].is_alphabetic()
            && chars[i + 1].is_alphabetic()
    };
    if intra_word(index) {
        return false;
    }
    chars[..index]
        .iter()
        .enumerate()
        .filter(|(i, candidate)| **candidate == ch && !intra_word(*i))
        .count()
        % 2
        == 1
}

fn should_replace_delivery_punctuation(chars: &[char], index: usize) -> bool {
    let ch = chars[index];
    let comma = matches!(ch, ',' | '，');
    let period = matches!(ch, '.' | '。' | '．');
    if !comma && !period {
        return false;
    }
    let previous = index.checked_sub(1).and_then(|i| chars.get(i)).copied();
    let next = chars.get(index + 1).copied();
    if previous.is_some_and(|value| value.is_ascii_digit())
        && next.is_some_and(|value| value.is_ascii_digit())
    {
        return false;
    }
    if ch == '.' {
        let mut start = index;
        while start > 0 && chars[start - 1] == '.' {
            start -= 1;
        }
        let mut end = index + 1;
        while end < chars.len() && chars[end] == '.' {
            end += 1;
        }
        if end - start >= 3 || preserve_delivery_ascii_period(chars, index) {
            return false;
        }
    }
    true
}

/// 字幕的非破坏性交付投影（扩展 Voice Ink
/// `SubtitlePresentation.projectPunctuation` 的展示语义到所有语言）：普通逗号/
/// 句号不占字幕预算，只在两侧仍有可见内容时投影成一个半角分隔空格；数字与
/// ASCII 数据 token 内部的逗号/句号保留。
pub fn target_delivery_projection(text: &str, _lang: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut output = String::new();
    let mut pending_separator = false;
    for (index, &ch) in chars.iter().enumerate() {
        if matches!(ch, '\n' | '\r') {
            output.push(ch);
            pending_separator = false;
            continue;
        }
        if should_replace_delivery_punctuation(&chars, index) {
            while output.ends_with(|candidate: char| {
                candidate.is_whitespace() && !matches!(candidate, '\n' | '\r')
            }) {
                output.pop();
            }
            pending_separator = true;
            continue;
        }
        if ch.is_whitespace() {
            if !pending_separator {
                output.push(ch);
            }
            continue;
        }
        if pending_separator && delivery_closing_delimiter(&chars, index) {
            output.push(ch);
            continue;
        }
        if pending_separator && !output.is_empty() {
            output.push(' ');
        }
        output.push(ch);
        pending_separator = false;
    }
    output
}

/// CJK 双格语言（zh/ja/ko）：阅读单位按全角格折算，Latin 约按半字计价。
fn cjk_cell_lang(lang: &str) -> bool {
    matches!(primary_subtag(lang).as_str(), "zh" | "ja" | "ko")
}

/// 目标语 hard/CPS 阅读单位。所有语言先走交付投影；CJK 目标语（zh/ja/ko）再按
/// 两个半角格约等于一个全角字计数，因此 Latin 产品名不会被逐字母高估——契约
/// 双胞胎里"Latin letters and digits count about half"承诺的就是这一口径。
/// 其他语言按投影后的非空白字符计。
pub fn target_cps_chars(text: &str, lang: &str) -> usize {
    let projected = target_delivery_projection(text, lang);
    if cjk_cell_lang(lang) {
        let compact: String = projected.chars().filter(|ch| !ch.is_whitespace()).collect();
        visual_width(&compact).div_ceil(2)
    } else {
        count_cps_chars(&projected)
    }
}

/// 单片作为展示行的宽度口径：片尾标点（含收尾引号/括号与空白）不计。契约声明
/// "whitespace and the trailing punctuation of a segment are free"；交付投影只
/// 免普通逗号/句号，"他说："这类片尾冒号仍会被 [`target_cps_chars`] 计 1，导致
/// 闪帧阈值把 2 字片当 3 字放行。片内标点照常计数（合并后变成行内可见负担）。
pub fn piece_display_units(text: &str, lang: &str) -> usize {
    let trimmed = text.trim_end_matches(|ch: char| {
        ch.is_whitespace() || crate::atomize::is_punctuation_or_symbol(ch)
    });
    target_cps_chars(trimmed, lang)
}

/// 重排改写幅度护栏（AI 管线设计 §8.3 / 文件契约设计 §2「校验只有一份」）。
///
/// `reordered` 允许 worker 重排译句小句顺序来消除语序交叉，但只准调语序和
/// 必要的连接词/助词；阅读单位大漂移说明它顺手压缩或补写了内容，按改写拒收。
///
/// 容差取「±25% 与 ±4 单位的较大者」，但**不得超过原句的一半**：4 单位的
/// 绝对底线是给连接词/助词留的余量，短句里它会大过整句本身——8 单位以下的句
/// 子按原式恒不触发，「你好，世界」压成「好」也算合格，护栏对短句形同虚设。
/// 上限只影响 8 单位以下的句子，长句的判据逐字不变。
///
/// 这一份是**唯一实现**：align 引擎的 provider 验收、agent 提交期 lint 与
/// 文件契约表格解析三处共用。曾经是三份逐字复制的算术，设计 §2 点名要求合并。
pub fn reordered_rewrite_exceeds(old_units: usize, new_units: usize) -> bool {
    let tolerance = (old_units / 4).max(4).min(old_units.div_ceil(2));
    new_units.abs_diff(old_units) > tolerance
}

/// 目标语交付阅读速度（阅读单位/秒，bad 档）。
pub fn target_reading_cps(lang: &str) -> f64 {
    match primary_subtag(lang).as_str() {
        "zh" => 9.0,
        "ja" | "ko" => 13.0,
        "th" => 15.0,
        "ar" | "hi" => 18.0,
        _ => 21.0,
    }
}

/// 一条目标字幕的最低建议展示时长。短片至少 1 秒，其余按目标语 CPS。
pub fn target_required_seconds(text: &str, lang: &str) -> f64 {
    (target_cps_chars(text, lang) as f64 / target_reading_cps(lang)).max(1.0)
}

/// 目标语 fit 的单行判定。CJK 目标语（zh/ja/ko）按全角格测量：CJK/全角 = 2 cells，
/// Latin/半角 = 1 cell；其他语言沿用非空白字符数。
pub fn exceeds_one_line_fit(text: &str, lang: &str, fit: usize) -> bool {
    if cjk_cell_lang(lang) {
        visual_width(&target_delivery_projection(text, lang)) > fit * 2
    } else {
        count_cps_chars(text) > fit
    }
}

/// 三阈值（v0.3 §6.1，计数口径 = 非空白字符）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransParams {
    /// 触发：译句 ≤ fit 且未超 hard ⇒ 整句一行，不拆。
    pub fit: usize,
    /// 建议：拆分时的目标片长（进 LLM prompt 与切分器 DP）。
    pub soft: usize,
    /// 强制：任何片 > hard ⇒ check blocker；确定性切分器按构造不产出。
    pub hard: usize,
}

impl TransParams {
    /// 规范性缺省：CJK（zh/ja/ko）16/14/20，其余 42/30/42。
    pub fn for_lang(lang: &str) -> Self {
        match primary_subtag(lang).as_str() {
            "zh" | "ja" | "ko" => Self {
                fit: 16,
                soft: 14,
                hard: 20,
            },
            _ => Self {
                fit: 42,
                soft: 30,
                hard: 42,
            },
        }
    }

    /// 显式 fit 覆盖（`--fit`，CJK 场景导向）：soft = fit−2（下限 4），
    /// hard = max(fit, round(soft × 1.4))。
    pub fn with_fit(fit: usize) -> Self {
        let soft = fit.saturating_sub(2).max(4);
        let hard = fit.max((soft as f64 * 1.4).round() as usize);
        Self { fit, soft, hard }
    }

    /// Shorts 交付（`project.json` 的 `delivery: "shorts"`）的三阈值：`fit` 取竖屏字幕块的
    /// 一行——中日韩按全角字 [`SHORTS_LINE_EM`]，其余语言按非空白字符 [`SHORTS_LINE_CHARS`]；
    /// `soft` / `hard` 与 [`Self::for_lang`] 同一档保持相同比例（中日韩 14/16、20/16，其余
    /// 30/42、42/42），所以 [`OVER_FIT_PENALTY`] 与缝罚分阶梯的标定不变，只是整体按一行收窄。
    pub fn for_shorts(lang: &str) -> Self {
        let base = Self::for_lang(lang);
        let fit = if cjk_cell_lang(lang) {
            SHORTS_LINE_EM
        } else {
            SHORTS_LINE_CHARS
        };
        let scale = |value: usize| (value as f64 * fit as f64 / base.fit as f64).round() as usize;
        Self {
            fit,
            soft: scale(base.soft),
            hard: scale(base.hard),
        }
    }

    /// 按项目交付格式取三阈值：`shorts` 走 [`Self::for_shorts`]，缺席或其他值走
    /// [`Self::for_lang`]。
    pub fn for_delivery(lang: &str, delivery: Option<&str>) -> Self {
        match delivery.map(str::trim) {
            Some(SHORTS_DELIVERY) => Self::for_shorts(lang),
            _ => Self::for_lang(lang),
        }
    }
}

/// `project.json` 里 Shorts 交付的取值（与 `bcut_project::DELIVERIES` 同名）。
pub const SHORTS_DELIVERY: &str = "shorts";

/// Shorts 竖屏字幕块一行放得下几个全角字（em）。字幕块宽 60% 画宽、译文行字号 5.5% 画宽
/// （`bcut_editor_core::shorts::caption_width` / `CAPTION_WIDTH_PCT`；双语与仅译文两种轨集里
/// 译文行都是最大的那行），60 / 5.5 ≈ 10.9，向下取整。editor-core 的测试从那两个数重算并与
/// 这里对拍，改其一另一边会红。
pub const SHORTS_LINE_EM: usize = 10;

/// 同一行放得下几个非空白字符（中日韩以外的目标语，计数口径同 [`count_cps_chars`]）。
/// 按 Shorts 字幕的字面量（`system` 解析到内置的 Noto Sans SC，字重 800）：拉丁文句子平均每个
/// 非空白字符 0.58–0.61 em（英 / 法 / 德 / 西，词间空格摊在内），10.9 em 的一行约放 18–19 个；
/// 西里尔文 0.65 em、约 17 个。取 17，让西里尔文也落在一行里；其余文字（阿拉伯、天城、泰文等）
/// 与 [`TransParams::for_lang`] 一样同归这一档，没有按文字单独实测。
pub const SHORTS_LINE_CHARS: usize = 17;

/// 超 fit 片的目标函数罚分。审计 §7 P0-a：`piece_cost` 的「向 soft 收敛」
/// 平方项**主动偏好**一片 19u 而非两片 9.5u（0.178 < 1.089），超行是目标
/// 函数选出来的，不是缝不够用——R3 的 30 片超行里有 10 片存在自由缝。
///
/// 标定卡在缝罚分阶梯之间：> 词间空白 0.8 + 最坏长度平方项差
/// （((fit−soft)/soft)² ≈ 0.02 与 ((hard−soft)/soft)² ≈ 0.19）⇒ 只要存在
/// 能真正消掉超行的合法缝，DP 必取；实测 R3 超行 top-10 全部与
/// [`crate::seam::free_seam`] 判据一致。
pub(crate) const OVER_FIT_PENALTY: f64 = 1.5;

/// 「无缝」档罚分（缝上既无标点也无空白：CJK 字界、开标点后随 Latin）。
///
/// 必须 = 1.5 + [`OVER_FIT_PENALTY`]。这是「有缝必须是**全合法**缝才强制
/// 切分」的算术形式：一刀最多能免掉一个片的超 fit 罚分（1.2）、退回一档
/// 缝罚分（≤0.8）、再省下长度平方项（≤((hard−soft)/soft)²，CJK 档 0.19），
/// 合计 < 2.7。因此超 fit 永远买不动一刀无缝切分——纯 CJK 片内没有自由缝
/// 时保持整片交付（归 translation-unsplittable 通道），不会被治超逼成
/// [`crate::seam::cjk_midword_boundary`] 那种切完必然被 draft 门打回的切法。
pub(crate) const NO_SEAM_PENALTY: f64 = 1.5 + OVER_FIT_PENALTY;

/// 客观级语病缝罚分（必须 > [`NO_SEAM_PENALTY`]）。
///
/// DP 目标函数原本对缝质量一无所知：切分合法性全靠事后
/// [`crate::seam::repair_lint_pieces`] 合并回去，而合并必然把片重新撑宽。
/// 治超罚分一上，这条链就变成「超行 ⇄ 悬空」的跷跷板——实测会选出
/// `它会把 KV | 缓存拆分成…`（处置式悬空）、`vLLM 还提供了一个零成本的 |
/// n-gram 推测器，`（「的」悬垂）这类切法。把 [`is_objective_blocking`]
/// 直接计入目标函数后，DP 只会在**全合法自由缝**上治超，与
/// [`crate::seam::free_seam`] 判据按构造一致。
pub(crate) const BLOCKING_SEAM_PENALTY: f64 = NO_SEAM_PENALTY + 0.5;

/// 缝惩罚（低 = 更愿意在此断）：句末 0 < 子句标点 0.3 < 词间空白 0.8 <
/// 无缝档 [`NO_SEAM_PENALTY`]。原子边界天然合法：atomize 把标点串一律附着到**前**一个原子
///（开标点也不例外，`名为“` 是一个原子），并让 Latin 词与数字保持内聚。
/// 因此「开标点 + 后随 Latin」的缝要靠 [`sep_len`] 判 0 才落到 1.5 档，
/// 否则 DP 会当成廉价的词间空白缝优先在开引号后面切开。
/// `whitespace_backed`：该缝在原文里真有空白（见
/// [`seam_backed_by_whitespace`]）。CJK/Latin 交界处拼接补出的渲染空格不算
/// 缝——否则「担心 | AI 会抢走…」会被当成词间缝，治超罚分一施压就切在动词
/// 和宾语从句之间。对齐块 DP（[`crate::align_block`]）复用同一标尺。
pub(crate) fn seam_penalty(prev: &str, next: &str, whitespace_backed: bool) -> f64 {
    if sentence_end(prev) {
        0.0
    } else if clause_end_char(prev).is_some() {
        0.3
    } else if whitespace_backed && sep_len(prev, next) == 1 {
        0.8
    } else {
        NO_SEAM_PENALTY
    }
}

fn join_atoms(atoms: &[String]) -> String {
    join_word_texts(atoms.iter().map(String::as_str))
}

/// 各自对齐切分（v0.3 §5.1）：DP 选缝，每片 ≤ hard、贴近 soft、优先高等级
/// 缝；片数 ≤ `max_pieces`（每片至少要锚一个源词）。译句同时满足 ≤ fit 与
/// ≤ hard 时原样整句一片。
/// 单原子超 hard（巨型 Latin 词等）按字符位置硬切兜底。
pub fn split_independent(
    translation: &str,
    params: &TransParams,
    max_pieces: usize,
) -> Vec<String> {
    split_independent_for_lang(translation, params, max_pieces, "")
}

/// [`split_independent`] 的目标语感知版本；简中使用与 fit/hard 校验一致的
/// 交付投影预算。
pub fn split_independent_for_lang(
    translation: &str,
    params: &TransParams,
    max_pieces: usize,
    lang: &str,
) -> Vec<String> {
    split_independent_for_lang_protected(translation, params, max_pieces, lang, &[])
}

/// 目标语感知切分，并把指定目标术语视为不可从中间断开的原子。
pub fn split_independent_for_lang_protected(
    translation: &str,
    params: &TransParams,
    max_pieces: usize,
    lang: &str,
    protected_terms: &[String],
) -> Vec<String> {
    split_independent_impl(
        translation,
        params,
        max_pieces,
        lang,
        protected_terms,
        SplitMode::Deliver,
    )
}

/// 严格合法切分：只在**非客观语病**缝上切、每片必须 ≤ hard、不做字符位硬切
/// 兜底。存在这样的切分时返回各片（≥2 片）；整段本就 ≤ fit 且 ≤ hard 时返回
/// 单片；找不到返回 `None`。
///
/// 与 [`split_independent_for_lang`] 的区别在于**回答的问题不同**：交付切分
/// 必须永远给出结果（客观语病缝只是重罚，兜底还会字符位硬切），因此它的输出
/// 不能用来判断「worker 是否有合法动作」——提交期 lint 要的正是后者：拿它给
/// worker 提示切法（切法本身必须能过 `align-illegal-seam` lint），或在无解时
/// 放行而不是拒收。
pub fn legal_split_for_lang(
    translation: &str,
    params: &TransParams,
    max_pieces: usize,
    lang: &str,
) -> Option<Vec<String>> {
    let pieces = split_independent_impl(
        translation,
        params,
        max_pieces,
        lang,
        &[],
        SplitMode::LegalOnly,
    );
    (!pieces.is_empty()).then_some(pieces)
}

/// [`split_independent_impl`] 的两种口径。
#[derive(Clone, Copy, PartialEq, Eq)]
enum SplitMode {
    /// 交付：永远给出结果；客观语病缝重罚，单原子超 hard 允许并由
    /// [`oversize_hard_cut`] 字符位硬切兜底。
    Deliver,
    /// 严格合法：客观语病缝直接不可行，任何片都不得超 hard，DP 无解即返回空。
    LegalOnly,
}

fn split_independent_impl(
    translation: &str,
    params: &TransParams,
    max_pieces: usize,
    lang: &str,
    protected_terms: &[String],
    mode: SplitMode,
) -> Vec<String> {
    let atoms = atomize(translation);
    if atoms.is_empty() {
        return Vec::new();
    }
    let within_visual_fit = !exceeds_one_line_fit(translation, lang, params.fit);
    let within_hard = target_cps_chars(translation, lang) <= params.hard;
    if within_visual_fit && within_hard {
        return vec![translation.to_owned()];
    }
    if atoms.len() == 1 || max_pieces <= 1 {
        return match mode {
            SplitMode::Deliver => oversize_hard_cut(join_atoms(&atoms), params, lang),
            SplitMode::LegalOnly => Vec::new(),
        };
    }

    let n = atoms.len();
    let canonical = join_atoms(&atoms);
    let seam_positions = {
        let mut positions = vec![0usize; n + 1];
        let mut cursor = 0usize;
        for index in 0..n {
            if index > 0 {
                cursor += sep_len(&atoms[index - 1], &atoms[index]);
            }
            positions[index] = cursor;
            cursor += atoms[index].chars().count();
        }
        positions[n] = cursor;
        positions
    };
    let protected_ranges = protected_terms
        .iter()
        .filter(|term| !term.is_empty() && target_cps_chars(term, lang) <= params.fit)
        .flat_map(|term| {
            canonical.match_indices(term).map(|(start, matched)| {
                let start_chars = canonical[..start].chars().count();
                let end_chars = start_chars + matched.chars().count();
                (start_chars, end_chars)
            })
        })
        .collect::<Vec<_>>();
    let seam_protected = |atom_index: usize| {
        let position = seam_positions[atom_index];
        protected_ranges
            .iter()
            .any(|(start, end)| *start < position && position < *end)
    };
    let widths: Vec<usize> = atoms
        .iter()
        .map(|atom| target_cps_chars(atom, lang))
        .collect();
    let prefix: Vec<usize> = std::iter::once(0)
        .chain(widths.iter().scan(0, |acc, w| {
            *acc += w;
            Some(*acc)
        }))
        .collect();
    let piece_len = |j: usize, i: usize| prefix[i] - prefix[j];
    // 超 fit 判定必须用与 check/交付一致的视觉口径：`target_cps_chars` 先剥
    // 空白再量，`exceeds_one_line_fit` 连分隔空格一起量——含 Latin 的片
    // （R3 超行 top-10 的多数）在单位口径下会被整体漏判。逐 (j,i) 记忆化；
    // 超 hard 的组合本就出局，按 `piece_len` 单调性提前收敛。
    let mut over_fit = vec![false; (n + 1) * (n + 1)];
    for j in 0..n {
        for i in (j + 1)..=n {
            if piece_len(j, i) > params.hard {
                break;
            }
            over_fit[j * (n + 1) + i] =
                exceeds_one_line_fit(&join_atoms(&atoms[j..i]), lang, params.fit);
        }
    }
    // 缝合法性按「前缀 | 后缀」两片预判一次（缝质量判据都是局部尾/首形态）。
    // 严格口径另记客观语病缝：那是 `align-illegal-seam` lint 的拒收判据，
    // LegalOnly 模式下直接不可行。
    let mut objective_seam = vec![false; n + 1];
    let blocking_seam: Vec<bool> = (0..=n)
        .map(|j| {
            if j == 0 || j == n {
                return false;
            }
            let left = join_atoms(&atoms[..j]);
            let right = join_atoms(&atoms[j..]);
            let issues = lint_pieces(&[left.as_str(), right.as_str()], lang, params);
            objective_seam[j] = issues.iter().any(is_objective_blocking);
            // CJK 词内边界与客观语病同级：确定性切分器按字原子工作、没有词典，
            // 「同时还可 ‖ 以将…」这类词内切 `lint_pieces` 一条都不报（尾字
            // 「可」不在弱尾表里），却比任何弱尾都难读。不加这一条，DP 会为了
            // 躲开「…将」的弱尾罚分主动切进词里——p850 现场 s-g79.0 的
            // 「可|以」正是这么来的，`oversize_hard_cut` 根本没被调用到。
            // 用加性罚分而非硬排除：纯 CJK 长句里每条缝都是词内边界，硬排除
            // 会让整句无解。
            cjk_midword_boundary(left.trim_end(), right.trim_start())
                // 用 Blocking 全集（不只客观级）：闪现碎片同样不是可交付的一行，
                // 治超罚分不得把片逼成 `vLLM | 还提供了…` 这类 2u 头片。
                || issues
                    .iter()
                    .any(|issue| issue.kind == SeamLintKind::Blocking)
        })
        .collect();
    let soft = params.soft as f64;
    let piece_cost = |j: usize, i: usize| -> Option<f64> {
        let len = piece_len(j, i);
        if len > params.hard {
            if i - j == 1 && mode == SplitMode::Deliver {
                // 单原子超硬：允许（后段硬切兜底），重罚。
                return Some(5.0 + (len - params.hard) as f64 * 0.5);
            }
            return None;
        }
        let mut cost = ((len as f64 - soft) / soft).powi(2);
        if over_fit[j * (n + 1) + i] {
            cost += OVER_FIT_PENALTY;
        }
        Some(cost)
    };

    let max_k = max_pieces.min(n);
    const INF: f64 = f64::INFINITY;
    // dp[k][i] = 前 i 个原子切成 k 片的最小成本。
    let mut dp = vec![vec![INF; n + 1]; max_k + 1];
    let mut back = vec![vec![0usize; n + 1]; max_k + 1];
    dp[0][0] = 0.0;
    for k in 1..=max_k {
        for i in 1..=n {
            for j in (k - 1)..i {
                if j > 0 && seam_protected(j) {
                    continue;
                }
                if j > 0 && mode == SplitMode::LegalOnly && objective_seam[j] {
                    continue;
                }
                let Some(cost) = piece_cost(j, i) else {
                    continue;
                };
                if dp[k - 1][j] == INF {
                    continue;
                }
                let seam = if j > 0 {
                    seam_penalty(
                        &atoms[j - 1],
                        &atoms[j],
                        seam_backed_by_whitespace(translation, &atoms, j),
                    ) + if blocking_seam[j] {
                        BLOCKING_SEAM_PENALTY
                    } else {
                        0.0
                    }
                } else {
                    0.0
                };
                let candidate = dp[k - 1][j] + cost + seam + 0.05;
                if candidate < dp[k][i] {
                    dp[k][i] = candidate;
                    back[k][i] = j;
                }
            }
        }
    }
    let Some(best_k) = (1..=max_k)
        .filter(|&k| dp[k][n] < INF)
        .min_by(|&a, &b| dp[a][n].total_cmp(&dp[b][n]))
        .or_else(|| (mode == SplitMode::Deliver).then_some(1))
    else {
        return Vec::new();
    };

    let mut cuts = Vec::new();
    let mut i = n;
    for k in (1..=best_k).rev() {
        let j = back[k][i];
        cuts.push(j);
        i = j;
    }
    cuts.reverse(); // 首元素恒 0
    let mut pieces = Vec::with_capacity(best_k);
    for (index, &j) in cuts.iter().enumerate() {
        let end = cuts.get(index + 1).copied().unwrap_or(n);
        let piece = join_atoms(&atoms[j..end]);
        match mode {
            SplitMode::Deliver => pieces.extend(oversize_hard_cut(piece, params, lang)),
            // LegalOnly 下 `piece_cost` 已排除任何超 hard 片，无需兜底。
            SplitMode::LegalOnly => pieces.push(piece),
        }
    }
    // 硬切兜底可能撑破片数上限：从头合并到上限内（极端情形，完整性优先）。
    while pieces.len() > max_pieces && pieces.len() > 1 {
        let merged = join_word_texts([pieces[0].as_str(), pieces[1].as_str()]);
        pieces.splice(0..2, [merged]);
    }
    pieces
}

/// 超硬兜底切分的缝吸附窗口（原子数）。理想等宽切点附近这么多个原子内如果
/// 存在更强的缝，就吸附过去；窗口再大就会把片长拉得离 soft 太远，反而制造
/// 新的超行/闪现片。
const OVERSIZE_SEAM_WINDOW: usize = 3;
/// 单片超硬的兜底切分：先按原子边界切、并在理想等宽切点 ±
/// [`OVERSIZE_SEAM_WINDOW`] 个原子内吸附到最强的缝；窗口内全是 CJK 词内边界
/// 时再放宽到全部可行边界找非词内切点。只有整段不含可用原子边界（巨型 Latin
/// 词等）才退回纯字符位置硬切。
///
/// 这是 DP 无解时的最后一道兜底（`piece_cost` 把超 hard 视为不可行，含长保护
/// 术语的尾片会走到这里）。旧实现是零缝感知的纯等宽切，必然出现「可|以」这类
/// 词内切；缝感知后仍保证每片 ≤ hard——吸附只在两侧都不破顶时才采纳，且每一刀
/// 的理想位置都从**实际**上一刀重新推导，不用固定等宽网格，避免误差累积把末片
/// 顶破 hard。
fn oversize_hard_cut(text: String, params: &TransParams, lang: &str) -> Vec<String> {
    let total = target_cps_chars(&text, lang);
    if total <= params.hard {
        return vec![text];
    }
    let atoms = atomize(&text);
    if atoms.len() >= 2 {
        return oversize_seam_cut(&atoms, params, lang);
    }
    oversize_char_cut(text, params, lang)
}

/// 原子边界 + 缝吸附的超硬切分。每片 ≤ hard（除非单原子自身超 hard，此时该
/// 原子单独走字符硬切）。
fn oversize_seam_cut(atoms: &[String], params: &TransParams, lang: &str) -> Vec<String> {
    let n = atoms.len();
    // prefix[i] = 前 i 个原子的目标显示单元数（按拼接后的文本计量，与
    // `target_cps_chars` 同口径）。
    let mut prefix = vec![0usize; n + 1];
    for index in 0..n {
        prefix[index + 1] = prefix[index] + target_cps_chars(&atoms[index], lang);
    }
    let span = |from: usize, to: usize| prefix[to] - prefix[from];
    let refs: Vec<&str> = atoms.iter().map(String::as_str).collect();

    let mut pieces: Vec<String> = Vec::new();
    let mut start = 0usize;
    while start < n {
        let remaining = span(start, n);
        if remaining <= params.hard {
            pieces.push(join_atoms(&atoms[start..n]));
            break;
        }
        // 单原子自身超 hard：没有任何合法边界能救，退回字符硬切。
        if span(start, start + 1) > params.hard {
            pieces.extend(oversize_char_cut(
                join_atoms(&atoms[start..start + 1]),
                params,
                lang,
            ));
            start += 1;
            continue;
        }
        // 可行上界：左片不得超 hard。
        let mut max_cut = start + 1;
        while max_cut < n && span(start, max_cut + 1) <= params.hard {
            max_cut += 1;
        }
        // 理想切点从**剩余**长度重新推导，不用固定网格。
        let parts_left = remaining.div_ceil(params.soft).max(2);
        let ideal_len = remaining.div_ceil(parts_left);
        let ideal = (start + 1..=max_cut)
            .find(|&cut| span(start, cut) >= ideal_len)
            .unwrap_or(max_cut);

        let midword = |cut: usize| {
            crate::seam::cjk_midword_boundary(
                join_atoms(&atoms[start..cut]).trim_end(),
                join_atoms(&atoms[cut..n]).trim_start(),
            )
        };
        let score = |cut: usize| {
            let strength = crate::seam::source_boundary_strength(&refs, cut);
            let distance = ideal.abs_diff(cut);
            // 强度高优先 → 非词内切优先 → 离理想点近优先 → 靠前优先。
            (std::cmp::Reverse(strength), midword(cut), distance, cut)
        };
        let window_lo = ideal.saturating_sub(OVERSIZE_SEAM_WINDOW).max(start + 1);
        let window_hi = (ideal + OVERSIZE_SEAM_WINDOW).min(max_cut);
        let best = (window_lo..=window_hi)
            .min_by_key(|&cut| score(cut))
            .unwrap_or(ideal);
        // 窗口内既没有缝、又只能切进 CJK 词内时，放宽到全部可行边界找一个
        // 非词内切点（离理想点最近者），词内切只作最后兜底。
        let cut = if crate::seam::source_boundary_strength(&refs, best) == 0 && midword(best) {
            (start + 1..=max_cut)
                .filter(|&cut| !midword(cut))
                .min_by_key(|&cut| (ideal.abs_diff(cut), cut))
                .unwrap_or(best)
        } else {
            best
        };
        pieces.push(join_atoms(&atoms[start..cut]));
        start = cut;
    }
    pieces.retain(|piece| !piece.trim().is_empty());
    pieces
}

/// 纯字符位置硬切：按 soft 目标均分（不足 hard 则原样返回）。只在整段没有可
/// 用原子边界时使用。
fn oversize_char_cut(text: String, params: &TransParams, lang: &str) -> Vec<String> {
    let total = target_cps_chars(&text, lang);
    if total <= params.hard {
        return vec![text];
    }
    let parts = total.div_ceil(params.soft).max(2);
    let per = total.div_ceil(parts);
    let mut pieces = Vec::with_capacity(parts);
    let mut current = String::new();
    let mut cps = 0usize;
    for ch in text.chars() {
        current.push(ch);
        if !ch.is_whitespace() && target_cps_chars(&ch.to_string(), lang) > 0 {
            cps += 1;
            if cps >= per && pieces.len() + 1 < parts {
                pieces.push(std::mem::take(&mut current).trim().to_owned());
                cps = 0;
            }
        }
    }
    if !current.trim().is_empty() {
        pieces.push(current.trim().to_owned());
    }
    pieces.retain(|piece| !piece.is_empty());
    pieces
}

/// 强制一对一 / 兜底切分（v0.3 §5.3）：译文按 `weights`（各源 Cue 的源文
/// 非空白字符数）占比切段，切点吸附到 ±`snap` 非空白字符内最近的原子边界，
/// 吸附不到则按字符位置硬切。返回恰 `weights.len()` 段（可含空段——调用方
/// 负责把空段并进相邻片区间）。
pub fn split_proportional(translation: &str, weights: &[usize], snap: usize) -> Vec<String> {
    if weights.is_empty() {
        return Vec::new();
    }
    let atoms = atomize(translation);
    let canonical = join_atoms(&atoms);
    let chars: Vec<char> = canonical.chars().collect();
    // cps_prefix[i] = chars[0..i] 的非空白字符数；atom_boundary[i] = 位置 i
    // （chars[i-1] 与 chars[i] 之间）是原子边界。
    let mut cps_prefix = vec![0usize; chars.len() + 1];
    for (i, ch) in chars.iter().enumerate() {
        cps_prefix[i + 1] = cps_prefix[i] + usize::from(!ch.is_whitespace());
    }
    let mut atom_boundary = vec![false; chars.len() + 1];
    {
        let mut pos = 0usize;
        for (index, atom) in atoms.iter().enumerate() {
            if index > 0 && sep_len(&atoms[index - 1], atom) == 1 {
                pos += 1; // 分隔空格
                atom_boundary[pos] = true;
            } else if index > 0 {
                atom_boundary[pos] = true;
            }
            pos += atom.chars().count();
        }
    }
    let total_cps = *cps_prefix.last().expect("non-empty prefix");
    let total_weight: usize = weights.iter().map(|w| (*w).max(1)).sum();

    let mut cut_chars = Vec::with_capacity(weights.len() - 1);
    let mut accumulated = 0usize;
    let mut previous_char = 0usize;
    for weight in &weights[..weights.len() - 1] {
        accumulated += (*weight).max(1);
        let ideal_cps =
            ((accumulated as f64 / total_weight as f64) * total_cps as f64).round() as usize;
        // 目标 cps → 字符位置（首个达到 ideal 的位置）。
        let ideal_char = cps_prefix
            .iter()
            .position(|&c| c >= ideal_cps)
            .unwrap_or(chars.len());
        // 在 ±snap（cps 距离）内找最近原子边界。
        let mut best: Option<(usize, usize)> = None; // (距离, 位置)
        for pos in previous_char + 1..=chars.len() {
            if !atom_boundary[pos] {
                continue;
            }
            let distance = cps_prefix[pos].abs_diff(ideal_cps);
            if distance <= snap && best.is_none_or(|(d, _)| distance < d) {
                best = Some((distance, pos));
            }
        }
        let cut = best.map_or_else(
            || ideal_char.clamp(previous_char, chars.len()),
            |(_, pos)| pos,
        );
        cut_chars.push(cut);
        previous_char = cut;
    }

    let mut pieces = Vec::with_capacity(weights.len());
    let mut start = 0usize;
    for &cut in &cut_chars {
        pieces.push(
            chars[start..cut]
                .iter()
                .collect::<String>()
                .trim()
                .to_owned(),
        );
        start = cut;
    }
    pieces.push(chars[start..].iter().collect::<String>().trim().to_owned());
    pieces
}

/// independent 译片 → 句内源词区间（v0.3 §5.1 时间锚定的离散形态）：
/// 按累计字符占比给每片分配 ≥1 个源词，区间划分 `0..word_count`。
/// 调用方保证 `piece_cps.len() <= word_count`。
pub fn anchor_pieces_to_words(piece_cps: &[usize], word_count: usize) -> Vec<(usize, usize)> {
    let k = piece_cps.len();
    assert!(
        k >= 1 && k <= word_count,
        "pieces {k} must fit in {word_count} words"
    );
    let total: usize = piece_cps.iter().map(|c| (*c).max(1)).sum();
    let mut ranges = Vec::with_capacity(k);
    let mut cursor = 0usize;
    let mut accumulated = 0usize;
    for (index, cps) in piece_cps.iter().enumerate() {
        accumulated += (*cps).max(1);
        let remaining_pieces = k - index - 1;
        let ideal_end = ((accumulated as f64 / total as f64) * word_count as f64).round() as usize;
        let end = if remaining_pieces == 0 {
            word_count
        } else {
            ideal_end.clamp(cursor + 1, word_count - remaining_pieces)
        };
        ranges.push((cursor, end - 1));
        cursor = end;
    }
    ranges
}

/// `transAlign` 条目的基准文本（对齐块设计 §5）：`text_basis == trans` 取
/// `trans[lang][sid]`，`display` 取 `transDisplay[lang][sid].text`；缺失 ⇒ `None`
///（条目按 align-stale 处理）。
pub fn basis_text<'a>(
    doc: &'a TranscriptDoc,
    lang: &str,
    sentence_id: &str,
    entry: &TransAlign,
) -> Option<&'a str> {
    match entry.text_basis {
        TextBasis::Trans => doc
            .trans
            .get(lang)
            .and_then(|table| table.get(sentence_id))
            .map(String::as_str),
        TextBasis::Display => doc
            .trans_display
            .get(lang)
            .and_then(|table| table.get(sentence_id))
            .map(|display| display.text.as_str()),
    }
}

/// [`align_entry_valid`] 的语言感知入口：自动按 `text_basis` 解析基准文本。
pub fn align_entry_valid_for_lang(
    doc: &TranscriptDoc,
    sentence: &Sentence,
    lang: &str,
    entry: &TransAlign,
) -> bool {
    basis_text(doc, lang, &sentence.id, entry)
        .is_some_and(|text| align_entry_valid(doc, sentence, text, entry))
}

/// `transAlign` 条目有效性（v0.3 §4 不变量 + 0.4 块层 I3/I4）。无效 ⇒
/// align-stale，展示降级整句上屏。`translation` 必须是条目 `text_basis` 对应
/// 的基准文本（[`basis_text`]）；只有 `trans` 基准条目才可直接传自然译句。
pub fn align_entry_valid(
    doc: &TranscriptDoc,
    sentence: &Sentence,
    translation: &str,
    entry: &TransAlign,
) -> bool {
    if entry.pieces.is_empty() {
        return false;
    }
    if entry.crossing && entry.mode != AlignMode::ManyToOne {
        return false;
    }
    let concatenated: String = entry
        .pieces
        .iter()
        .map(|piece| piece.text.as_str())
        .collect();
    if normalize_chars(&concatenated) != normalize_chars(translation) {
        return false;
    }
    match entry.mode {
        AlignMode::Independent => {
            // independent 无对齐主张：不含块层，也不得宣称块级对应。
            if !entry.blocks.is_empty() || entry.correspondence == Some(Correspondence::Block) {
                return false;
            }
            ordered_anchor_ordinals(doc, sentence, &entry.words).is_some()
                && entry
                    .pieces
                    .iter()
                    .all(|piece| piece.from.is_none() && piece.to.is_none())
        }
        AlignMode::ManyToOne => {
            let Some(anchor_ordinals) = ordered_anchor_ordinals(doc, sentence, &entry.words) else {
                return false;
            };
            if entry.words.is_empty() {
                return false;
            }
            let anchor_count = anchor_ordinals.len();
            let mut expected = 0usize;
            for piece in &entry.pieces {
                let (Some(from), Some(to)) = (piece.from, piece.to) else {
                    return false;
                };
                if from != expected || to < from || to >= anchor_count {
                    return false;
                }
                expected = to + 1;
            }
            if expected != anchor_count {
                return false;
            }
            // 显式整句对应：只有一片（旧 `crossing` 条目按读取侧解释，不受限）。
            if entry.correspondence == Some(Correspondence::Sentence) && entry.pieces.len() != 1 {
                return false;
            }
            crate::align_block::validate_blocks(entry, anchor_count)
        }
        // 旧版 oneToOne 直接锚定源 Cue，违反翻译 Cue 独立派生契约。
        AlignMode::OneToOne => false,
    }
}

/// Resolve an optional delivery-word snapshot to sentence-local word ordinals.
/// Empty `words` retains the historical independent-mode meaning of the whole
/// sentence; a non-empty list may be an ordered subset after timeline cuts.
fn ordered_anchor_ordinals(
    doc: &TranscriptDoc,
    sentence: &Sentence,
    words: &[String],
) -> Option<Vec<usize>> {
    if words.is_empty() {
        return Some((0..sentence.word_indices.len()).collect());
    }
    let mut output = Vec::with_capacity(words.len());
    let mut cursor = 0_usize;
    for id in words {
        let offset = sentence.word_indices[cursor..]
            .iter()
            .position(|&index| doc.words[index].id == *id)?;
        cursor += offset;
        output.push(cursor);
        cursor += 1;
    }
    Some(output)
}

/// 译文 Cue（subtitle 投影，非持久化）。
#[derive(Debug, Clone, PartialEq)]
pub struct TransCue {
    pub sentence_id: String,
    pub text: String,
    pub start: f64,
    pub end: f64,
    /// manyToOne / independent 的句内源词下标区间；目标片多于源词时
    /// independent 按整句时窗排时，留为 `None`。
    pub word_span: Option<(usize, usize)>,
    /// true = 无有效 transAlign 的整句上屏降级。
    pub fallback: bool,
}

/// 在不改变持久化词锚和片文案的前提下，利用片间静音并轻微移动展示边界，
/// 为同一句内的译片争取最低阅读时长。若整句总时长不足以同时满足所有片，
/// 按各片所需时长的比例分摊整句时窗——短缺由所有片均担，而不是让排序
/// 靠后或碰巧配了短源片的那一行独自闪过。
fn smooth_trans_cue_times(cues: &mut [TransCue], lang: &str) {
    if cues.len() < 2 {
        return;
    }
    let sentence_start = cues[0].start;
    let sentence_end = cues.last().expect("non-empty").end;
    let available = (sentence_end - sentence_start).max(0.0);
    let mut required: Vec<f64> = cues
        .iter()
        .map(|cue| target_required_seconds(&cue.text, lang))
        .collect();
    let total_required: f64 = required.iter().sum();
    if total_required > available {
        if total_required <= f64::EPSILON {
            return;
        }
        // 比例压缩后 sum == available：下面的边界推导仍然可行，且每片
        // 拿到的时长与其阅读量成正比（pad_trans_cue_times 随后还会向句外
        // 静音借时补足绝对缺口）。
        let scale = available / total_required;
        for value in &mut required {
            *value *= scale;
        }
    }

    let preferred: Vec<f64> = cues
        .windows(2)
        .map(|pair| (pair[0].end + pair[1].start) * 0.5)
        .collect();
    let mut suffix_required = vec![0.0; cues.len() + 1];
    for index in (0..cues.len()).rev() {
        suffix_required[index] = suffix_required[index + 1] + required[index];
    }

    let mut previous = sentence_start;
    for index in 0..cues.len() - 1 {
        let earliest = previous + required[index];
        let latest = sentence_end - suffix_required[index + 1];
        // Equivalent sums can differ by one ULP depending on accumulation
        // order, briefly making `earliest` a hair greater than `latest`.
        // Manual saturation keeps that harmless precision noise from turning
        // `f64::clamp` into a process-wide panic.
        let boundary = preferred[index].max(earliest).min(latest);
        cues[index].start = previous;
        cues[index].end = boundary;
        previous = boundary;
    }
    let last = cues.last_mut().expect("non-empty");
    last.start = previous;
    last.end = sentence_end;
}

/// 用相邻字幕之间真实存在的静音（以及媒体尾部空白）补足仍偏短的目标字幕。
/// 只扩展到空白区，不覆盖相邻字幕；先借后方静音，再借前方静音。
fn pad_trans_cue_times(cues: &mut [TransCue], lang: &str, media_end: f64) {
    for index in 0..cues.len() {
        let required = target_required_seconds(&cues[index].text, lang);
        let mut missing = required - (cues[index].end - cues[index].start);
        if missing <= 1e-9 {
            continue;
        }

        let next_start = cues
            .get(index + 1)
            .map(|cue| cue.start)
            .unwrap_or_else(|| media_end.max(cues[index].end));
        let after = (next_start - cues[index].end).max(0.0);
        let extend_after = missing.min(after);
        cues[index].end += extend_after;
        missing -= extend_after;

        if missing > 1e-9 {
            let previous_end = index
                .checked_sub(1)
                .and_then(|previous| cues.get(previous))
                .map(|cue| cue.end)
                .unwrap_or(0.0);
            let before = (cues[index].start - previous_end).max(0.0);
            cues[index].start -= missing.min(before);
        }
    }
}

/// 译文 Cue 流派生：每个已翻译句展开为 1..N 条 [`TransCue`]（时序）。
/// 未翻译句不产出；无效/缺失 `transAlign` 的句产出单条整句上屏（自然译句）。
/// 有效条目的片文本按其 `text_basis` 基准（[`basis_text`]）投影；显式
/// `correspondence: sentence` 的 manyToOne 条目整句单条上屏（时窗 = 锚定词
/// 时窗，`fallback` 沿用「超出单行容量才算降级」的口径）。
pub fn derive_trans_cues(doc: &TranscriptDoc, sentences: &[Sentence], lang: &str) -> Vec<TransCue> {
    let Some(table) = doc.trans.get(lang) else {
        return Vec::new();
    };
    let align_table = doc.trans_align.get(lang);
    let mut out = Vec::new();
    for sentence in sentences {
        let mut sentence_out = Vec::new();
        let Some(translation) = table.get(&sentence.id) else {
            continue;
        };
        let entry = align_table
            .and_then(|t| t.get(&sentence.id))
            .filter(|entry| align_entry_valid_for_lang(doc, sentence, lang, entry));
        let Some(entry) = entry else {
            let fits_one_line =
                !exceeds_one_line_fit(translation, lang, TransParams::for_lang(lang).fit);
            sentence_out.push(TransCue {
                sentence_id: sentence.id.clone(),
                text: translation.clone(),
                start: sentence.word_start(doc),
                end: sentence.word_end(doc),
                word_span: None,
                // 翻译流不读取源 Cue 数量；只有超出目标单行容量且缺少有效切法
                // 才是降级。
                fallback: !fits_one_line,
            });
            out.extend(sentence_out);
            continue;
        };
        match entry.mode {
            AlignMode::ManyToOne if entry.correspondence == Some(Correspondence::Sentence) => {
                // 整句对应：源按词时间逐词高亮、译文整句静态显示，不宣称逐片对应。
                let anchor_ordinals =
                    ordered_anchor_ordinals(doc, sentence, &entry.words).expect("validated");
                let first = anchor_ordinals[0];
                let last = *anchor_ordinals.last().expect("non-empty");
                let text = basis_text(doc, lang, &sentence.id, entry)
                    .expect("validated")
                    .to_owned();
                let fits_one_line =
                    !exceeds_one_line_fit(&text, lang, TransParams::for_lang(lang).fit);
                sentence_out.push(TransCue {
                    sentence_id: sentence.id.clone(),
                    text,
                    start: doc.words[sentence.word_indices[first]].t0,
                    end: doc.words[sentence.word_indices[last]].t1,
                    word_span: Some((first, last)),
                    fallback: !fits_one_line,
                });
            }
            AlignMode::ManyToOne => {
                let anchor_ordinals =
                    ordered_anchor_ordinals(doc, sentence, &entry.words).expect("validated");
                for piece in &entry.pieces {
                    let (from, to) = (piece.from.expect("validated"), piece.to.expect("validated"));
                    let first = anchor_ordinals[from];
                    let last = anchor_ordinals[to];
                    sentence_out.push(TransCue {
                        sentence_id: sentence.id.clone(),
                        text: piece.text.clone(),
                        start: doc.words[sentence.word_indices[first]].t0,
                        end: doc.words[sentence.word_indices[last]].t1,
                        word_span: Some((first, last)),
                        fallback: false,
                    });
                }
            }
            AlignMode::Independent => {
                let anchor_ordinals =
                    ordered_anchor_ordinals(doc, sentence, &entry.words).expect("validated");
                let piece_cps: Vec<usize> = entry
                    .pieces
                    .iter()
                    .map(|piece| target_cps_chars(&piece.text, lang).max(1))
                    .collect();
                if entry.pieces.len() <= anchor_ordinals.len() {
                    let ranges = anchor_pieces_to_words(&piece_cps, anchor_ordinals.len());
                    for (piece, (first, last)) in entry.pieces.iter().zip(ranges) {
                        let first = anchor_ordinals[first];
                        let last = anchor_ordinals[last];
                        sentence_out.push(TransCue {
                            sentence_id: sentence.id.clone(),
                            text: piece.text.clone(),
                            start: doc.words[sentence.word_indices[first]].t0,
                            end: doc.words[sentence.word_indices[last]].t1,
                            word_span: Some((first, last)),
                            fallback: false,
                        });
                    }
                } else {
                    // 极短源文可能对应很长译文。目标片数多于源词时，无法为每片
                    // 分配非空连续词区间；按目标阅读单位在整句时窗内分配展示时间，
                    // 明确放弃逐片双语对应，但仍保留译文和 hard 上限。
                    let start = doc.words[sentence.word_indices[anchor_ordinals[0]]].t0;
                    let end = doc.words[sentence.word_indices[*anchor_ordinals.last().unwrap()]].t1;
                    let duration = (end - start).max(0.0);
                    let total: usize = piece_cps.iter().sum();
                    let mut elapsed = 0usize;
                    for (index, (piece, weight)) in entry.pieces.iter().zip(piece_cps).enumerate() {
                        let piece_start = start + duration * elapsed as f64 / total as f64;
                        elapsed += weight;
                        let piece_end = if index + 1 == entry.pieces.len() {
                            end
                        } else {
                            start + duration * elapsed as f64 / total as f64
                        };
                        sentence_out.push(TransCue {
                            sentence_id: sentence.id.clone(),
                            text: piece.text.clone(),
                            start: piece_start,
                            end: piece_end,
                            word_span: None,
                            fallback: false,
                        });
                    }
                }
            }
            AlignMode::OneToOne => unreachable!("legacy Cue-anchored entry is never valid"),
        }
        smooth_trans_cue_times(&mut sentence_out, lang);
        out.extend(sentence_out);
    }
    pad_trans_cue_times(&mut out, lang, doc.media.duration);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cue::{CueParams, derive_cues};
    use crate::doc::{BreakOverride, DocEngine, DocMedia, Speaker, TransPiece, Word};
    use crate::sentence::derive_sentences;

    /// 改写幅度护栏的绝对底线（±4 单位）不得大过原句的一半：否则 8 单位以下
    /// 的句子恒不触发，「你好，世界」（4 单位）压成「好」（1 单位）也算合格，
    /// 提交期 lint 与 provider 验收对短句的召回都是 0。长句判据逐字不变。
    #[test]
    fn rewrite_guard_scales_down_for_short_sentences() {
        // 短句：底线被原句一半压住。
        assert!(reordered_rewrite_exceeds(4, 1));
        assert!(!reordered_rewrite_exceeds(4, 2));
        assert!(reordered_rewrite_exceeds(2, 0));
        // 8 单位起底线恢复成 ±4，与历史口径逐字一致。
        assert!(!reordered_rewrite_exceeds(8, 4));
        assert!(reordered_rewrite_exceeds(8, 3));
        assert!(!reordered_rewrite_exceeds(24, 20));
        assert!(reordered_rewrite_exceeds(24, 17));
        // 等长重排永远放行。
        assert!(!reordered_rewrite_exceeds(4, 4));
    }

    /// 契约双胞胎声明 "Latin letters and digits count about half"，系数钉死在
    /// 全部 CJK 目标语（zh/ja/ko），不只简中——曾经 ja/ko 走非空白字符全价，
    /// 与共享契约文本矛盾。
    #[test]
    fn cjk_targets_price_latin_at_half() {
        // s-g6.18 基准句：33 个全角字 + "agentskills.io"/"Open Agent Skills"
        // 等 42 个 Latin 字符；半价口径 54 单位（54/14 ≈ 建议 4 片，与引擎
        // data-budget 输出一致），全价口径会虚高到 75。
        let text = "没错，而且虽然 agentskills.io 上定义了 Open Agent Skills 标准，但在创建 AI Agent Skills 时，这些仍然是我们需要考虑的一些问题。";
        assert_eq!(target_cps_chars(text, "zh"), 54);
        assert_eq!(target_cps_chars("KVキャッシュとPagedAttention", "ja"), 14);
        assert_eq!(target_cps_chars("KVキャッシュとPagedAttention", "zh"), 14);
        // 非 CJK 目标语仍按非空白字符计。
        assert_eq!(target_cps_chars("KV cache rocks", "en"), 12);
    }

    /// 片级展示宽度：片尾标点（含冒号/收尾引号）免费，片内标点照常。
    /// 曾经"他说:"被闪帧阈值计 3 而契约口径是 2。
    #[test]
    fn piece_display_units_free_trailing_punctuation() {
        assert_eq!(target_cps_chars("他说:", "zh"), 3);
        assert_eq!(piece_display_units("他说:", "zh"), 2);
        assert_eq!(piece_display_units("他说：", "zh"), 2);
        // 普通句号本就被交付投影免费，两个口径一致。
        assert_eq!(piece_display_units("他说。", "zh"), 2);
        // 片内标点是行内可见负担，不免。
        assert_eq!(piece_display_units("他说：好的", "zh"), 5);
        // 收尾引号 + 句读一起免。
        assert_eq!(piece_display_units("他说：好的！」", "zh"), 5);
        // 纯标点片宽度为 0（本身就是闪帧碎片）。
        assert_eq!(piece_display_units("……", "zh"), 0);
    }

    #[test]
    fn shorts_delivery_narrows_the_budget_to_one_portrait_line() {
        let zh = TransParams::for_shorts("zh-Hans");
        assert_eq!(
            zh,
            TransParams {
                fit: SHORTS_LINE_EM,
                soft: 9,
                hard: 13
            }
        );
        assert_eq!(TransParams::for_shorts("ja"), zh);
        assert_eq!(TransParams::for_shorts("ko"), zh);
        let fr = TransParams::for_shorts("fr");
        assert_eq!(fr.fit, SHORTS_LINE_CHARS);
        // 非中日韩档的缺省 hard 等于 fit，收窄后照旧。
        assert_eq!(fr.hard, fr.fit);
        // 没列出的文字与缺省表一样落在非中日韩档。
        for lang in ["ru", "ar", "hi", "th", "und"] {
            assert_eq!(TransParams::for_shorts(lang), fr, "{lang}");
        }
        // 各档都比缺省窄，soft ≤ fit ≤ hard，hard / soft 与缺省档同比（缝罚分标定不变）。
        for lang in ["zh", "fr"] {
            let (base, narrow) = (TransParams::for_lang(lang), TransParams::for_shorts(lang));
            assert!(narrow.fit < base.fit, "{lang}");
            assert!(
                narrow.soft <= narrow.fit && narrow.fit <= narrow.hard,
                "{lang}"
            );
            let ratio = |params: TransParams| params.hard as f64 / params.soft as f64;
            assert!((ratio(narrow) - ratio(base)).abs() < 0.1, "{lang}");
        }

        assert_eq!(TransParams::for_delivery("zh", Some("shorts")), zh);
        assert_eq!(TransParams::for_delivery("zh", Some(" shorts ")), zh);
        assert_eq!(
            TransParams::for_delivery("zh", None),
            TransParams::for_lang("zh")
        );
        assert_eq!(
            TransParams::for_delivery("fr", Some("reels")),
            TransParams::for_lang("fr")
        );
    }

    /// 收窄后硬上限只有 13 个全角字：没有标点的长句也要切得开，而且不把数字和量词、
    /// 拉丁串拆开（竖屏字幕的折行禁则在切分这一层同样成立）。
    #[test]
    fn shorts_budget_splits_a_long_clause_without_breaking_numbers_or_latin() {
        let params = TransParams::for_shorts("zh");
        let text = "这家公司去年一口气融资了10亿美元然后把钱全部投进了OpenAI的芯片研发";
        let pieces = split_independent_for_lang(text, &params, usize::MAX, "zh");
        assert!(pieces.len() >= 3, "{pieces:?}");
        // 交付切分会在中日韩与数字 / 拉丁之间补空格（`10 亿`），比对时去掉空白。
        let squeeze = |value: &str| value.split_whitespace().collect::<String>();
        assert_eq!(squeeze(&pieces.concat()), text);
        for piece in &pieces {
            assert!(
                piece_display_units(piece, "zh") <= params.hard,
                "{piece} > {}",
                params.hard
            );
        }
        for pair in pieces.windows(2) {
            let (left, right) = (pair[0].trim_end(), pair[1].trim_start());
            assert!(
                !(left.ends_with("10") && right.starts_with('亿')),
                "{pieces:?}"
            );
            assert!(
                !(left.ends_with("Open") || right.starts_with("AI")),
                "{pieces:?}"
            );
        }
    }

    #[test]
    fn params_defaults_and_fit_override() {
        assert_eq!(
            TransParams::for_lang("zh-CN"),
            TransParams {
                fit: 16,
                soft: 14,
                hard: 20
            }
        );
        assert_eq!(
            TransParams::for_lang("ja"),
            TransParams {
                fit: 16,
                soft: 14,
                hard: 20
            }
        );
        assert_eq!(
            TransParams::for_lang("fr"),
            TransParams {
                fit: 42,
                soft: 30,
                hard: 42
            }
        );
        assert_eq!(
            TransParams::with_fit(16),
            TransParams {
                fit: 16,
                soft: 14,
                hard: 20
            }
        );
        assert_eq!(
            TransParams::with_fit(8),
            TransParams {
                fit: 8,
                soft: 6,
                hard: 8
            }
        );
    }

    #[test]
    fn simplified_chinese_budgets_use_delivery_projection() {
        let phrase = "我是 Claude Code 的创始工程师之一，";
        assert_eq!(count_cps_chars(phrase), 21);
        assert_eq!(target_cps_chars(phrase, "zh"), 15);
        assert_eq!(
            target_delivery_projection(phrase, "zh"),
            "我是 Claude Code 的创始工程师之一"
        );
        // 混排宽度超过 16 个全角格，可在一个 target unit 内换成两行；
        // 但它没有超过 20-char hard，不能把“之一”挤到下一语义片。
        assert!(exceeds_one_line_fit(phrase, "zh", 16));
        assert!(target_cps_chars(phrase, "zh") <= TransParams::for_lang("zh").hard);
        assert_eq!(target_cps_chars("版本 1.2，发布。", "zh"), 6);
        assert_eq!(
            target_delivery_projection(
                "3.14 1,000 U.S. Dr. README.md 报告.pdf。\nNext, line.",
                "zh-CN"
            ),
            "3.14 1,000 U.S. Dr. README.md 报告.pdf\nNext line"
        );
        assert_eq!(
            target_delivery_projection("他说，\"好。\"然后。", "zh"),
            "他说 \"好\" 然后"
        );
        assert_eq!(
            target_delivery_projection("Hello, world.", "en"),
            "Hello world"
        );
        assert_eq!(target_cps_chars("Hello, world.", "en"), 10);
    }

    #[test]
    fn mixed_product_names_use_visual_reading_units() {
        let params = TransParams::for_lang("zh");
        let phrase = "Claude Code、Antigravity，";
        assert!(!exceeds_one_line_fit(phrase, "zh", params.fit));
        assert!(target_cps_chars(phrase, "zh") <= params.hard);
        let pieces = split_independent_for_lang(phrase, &params, 8, "zh");
        assert_eq!(pieces, vec![phrase]);
    }

    #[test]
    fn independent_split_prefers_punctuation_seams() {
        let params = TransParams::for_lang("zh");
        // 22 字，逗号在第 10 字后——应在逗号处断而不是均分。
        let text = "你过的就是这种生活，二〇二八年人们会过的生活。";
        let pieces = split_independent(text, &params, 10);
        assert_eq!(pieces.len(), 2);
        assert!(pieces[0].ends_with("，"), "{pieces:?}");
        assert!(count_cps_chars(&pieces[0]) <= params.hard);
        assert!(count_cps_chars(&pieces[1]) <= params.hard);
        // 拼接不变量。
        assert_eq!(normalize_chars(&pieces.concat()), normalize_chars(text));
    }

    #[test]
    fn independent_split_never_cuts_inside_paired_delimiter() {
        // s-g4.16 回归：`名为“` 与 `PluginDataJSON”` 之间曾被判为廉价的词间
        // 空白缝（0.8 档），DP 优先在开引号后切开，且 canonical 多出幻影空格。
        let trans =
            "最简单来说，一个代理插件就是一个根目录下包含名为“PluginDataJSON”的清单的文件夹。";
        let atoms = atomize(trans);
        // canonical 必须与译文逐字相等，否则 seam 偏移与 protected-term
        // 匹配整体错位，幻影空格还会随片文本落库。
        assert_eq!(join_atoms(&atoms), trans);

        let params = TransParams::for_lang("zh-Hans");
        let pieces = split_independent_for_lang(trans, &params, 6, "zh-Hans");
        assert_eq!(pieces.concat(), trans);
        for piece in &pieces {
            assert!(
                !piece.ends_with('“'),
                "piece must not end on a dangling open quote: {pieces:?}"
            );
        }
        assert!(
            pieces
                .iter()
                .any(|piece| piece.contains("“PluginDataJSON”")),
            "quoted span must stay whole: {pieces:?}"
        );

        // 同一个根因的另一面：缝不落在定界符上时，幻影空格直接留在片文本里
        // 并落库（`validate_target_texts` 用 normalize_chars 比对，看不见空白）。
        let inline = "这是一个叫《PluginDataJSON》的清单文件。";
        let pieces = split_independent_for_lang(inline, &params, 4, "zh-Hans");
        assert_eq!(pieces.concat(), inline);
    }

    /// P0-a 回归：行宽是硬约束，不是二次项里的一个软偏好。
    ///
    /// R3 质量审计的 30 片超 fit 中有一批「有自由缝却没切」——`piece_cost` 的
    /// 「贴近 soft」平方项让一片 19u 宽片（0.178）明显便宜过切成两片
    /// （≥1.089，还要付缝分），DP 于是主动选宽片。治超罚分必须压过任何一刀
    /// 能退回来的钱（缝档 ≤0.8 + 长度差 ≤0.19），否则挪刀就能把罚分洗掉。
    #[test]
    fn over_fit_piece_is_cut_when_a_free_seam_exists() {
        let params = TransParams::for_lang("zh");
        assert!(OVER_FIT_PENALTY < NO_SEAM_PENALTY);
        assert!(NO_SEAM_PENALTY < BLOCKING_SEAM_PENALTY);
        // 一刀最多退回：治超罚分 + 最贵的真缝档 + 长度平方项差额。
        assert!(OVER_FIT_PENALTY + 0.8 + 1.0 < NO_SEAM_PENALTY + BLOCKING_SEAM_PENALTY);

        for (trans, expected) in [
            (
                "这样一来，你的显存分配看起来就更像这样。",
                vec!["这样一来，", "你的显存分配看起来就更像这样。"],
            ),
            (
                "通过 --speculative-model 启用推测解码模型。",
                vec!["通过 --speculative-model", "启用推测解码模型。"],
            ),
            (
                "你的 GPU 在显存读取之间会有空闲算力——",
                vec!["你的 GPU", "在显存读取之间会有空闲算力——"],
            ),
        ] {
            assert!(exceeds_one_line_fit(trans, "zh", params.fit), "{trans}");
            assert_eq!(
                split_independent_for_lang(trans, &params, 6, "zh"),
                expected
            );
        }
    }

    /// P0-a 的另一半：无自由缝的超 fit 片保持整片。强切只会把超行换成悬垂
    /// 尾（悬空⇄超行跷跷板），这类片归 translation-unsplittable 通道，由
    /// 译文改写而不是展示切分解决。
    #[test]
    fn over_fit_piece_without_a_free_seam_stays_whole() {
        let params = TransParams::for_lang("zh");
        for trans in [
            "这样它们就不用重新计算你已经知道的东西。",
            "一个面向延迟敏感型工作负载的额外功能：",
            "从你现有的 GPU 中获得大幅提升的吞吐量。",
            // 「担心|AI」在拼接后看着像词间空格缝，原文里没有空白：不是缝。
            "我发现很多人担心AI会抢走自己的工作。",
        ] {
            assert!(exceeds_one_line_fit(trans, "zh", params.fit), "{trans}");
            let pieces = split_independent_for_lang(trans, &params, 6, "zh");
            assert_eq!(
                pieces.len(),
                1,
                "no free seam — the piece must stay whole: {pieces:?}"
            );
            assert_eq!(normalize_chars(&pieces.concat()), normalize_chars(trans));
        }
    }

    #[test]
    fn independent_split_never_cuts_inside_protected_target_term() {
        let params = TransParams {
            fit: 8,
            soft: 6,
            hard: 10,
        };
        let term = "Claude Code".to_owned();
        let pieces = split_independent_for_lang_protected(
            "现在使用 Claude Code 构建稳定的字幕工作流。",
            &params,
            8,
            "zh-Hans",
            &[term.clone()],
        );
        assert!(pieces.iter().any(|piece| piece.contains(&term)));
        assert!(
            !pieces
                .iter()
                .any(|piece| piece == "Claude" || piece == "Code")
        );
    }

    #[test]
    fn independent_split_short_text_stays_whole_and_respects_max_pieces() {
        let params = TransParams::for_lang("zh");
        assert_eq!(split_independent("十六字以内整句。", &params, 10).len(), 1);
        let long = "这一句没有任何标点但是长度远远超过了单行容量需要拆开展示";
        let pieces = split_independent(long, &params, 2);
        assert_eq!(pieces.len(), 2);
        let unlimited = split_independent(long, &params, 10);
        assert!(unlimited.iter().all(|p| count_cps_chars(p) <= params.hard));
    }

    #[test]
    fn independent_split_latin_cuts_at_word_gaps() {
        let params = TransParams::for_lang("en");
        let text = "You have to sweat the tokens as much as you sweat the pixels, \
                    and this sentence is clearly longer than one line.";
        let pieces = split_independent(text, &params, 20);
        assert!(pieces.len() >= 2);
        for piece in &pieces {
            assert!(count_cps_chars(piece) <= params.hard, "{piece}");
            assert!(!piece.starts_with(' ') && !piece.ends_with(' '));
        }
        assert_eq!(normalize_chars(&pieces.join(" ")), normalize_chars(text));
    }

    #[test]
    fn proportional_split_snaps_to_atom_boundaries() {
        // 权重均分 20 字中文 → 理想切点 10；最近词边界在标点后。
        let text = "你得像打磨像素一样，打磨每一个词元。";
        let pieces = split_proportional(text, &[10, 10], 3);
        assert_eq!(pieces.len(), 2);
        assert_eq!(normalize_chars(&pieces.concat()), normalize_chars(text));
        // Latin：切点吸附到空白，不切词。
        let latin = split_proportional("alpha bravo charlie delta", &[12, 12], 3);
        assert_eq!(latin.len(), 2);
        assert!(latin.iter().all(|p| !p.is_empty()));
        assert!(!latin[0].ends_with("char"), "{latin:?}");
    }

    #[test]
    fn proportional_split_tiny_translation_yields_empty_tail() {
        let pieces = split_proportional("短。", &[10, 10, 10], 2);
        assert_eq!(pieces.len(), 3);
        assert!(pieces.iter().any(|p| p.is_empty()));
    }

    #[test]
    fn anchor_assigns_each_piece_at_least_one_word() {
        assert_eq!(anchor_pieces_to_words(&[10, 10], 4), vec![(0, 1), (2, 3)]);
        assert_eq!(anchor_pieces_to_words(&[1, 30], 4), vec![(0, 0), (1, 3)]);
        assert_eq!(anchor_pieces_to_words(&[30, 1], 4), vec![(0, 2), (3, 3)]);
        assert_eq!(anchor_pieces_to_words(&[5], 3), vec![(0, 2)]);
        // 片数 = 词数：逐词。
        assert_eq!(
            anchor_pieces_to_words(&[8, 8, 8], 3),
            vec![(0, 0), (1, 1), (2, 2)]
        );
    }

    fn doc_two_cue_sentence() -> TranscriptDoc {
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
        let mk = |id: &str, t0: f64, t1: f64, text: &str| Word {
            id: id.to_owned(),
            t0,
            t1,
            text: text.to_owned(),
            sp: "s1".to_owned(),
            glue: false,
        };
        doc.words = vec![
            mk("g1.0", 0.0, 0.4, "alpha"),
            mk("g1.1", 0.4, 0.8, "bravo"),
            mk("g1.2", 0.8, 1.2, "charlie"),
            mk("g1.3", 1.2, 1.6, "delta"),
            mk("g1.4", 1.6, 2.0, "echo,"),
            mk("g1.5", 2.0, 2.4, "foxtrot"),
            mk("g1.6", 2.4, 2.8, "golf"),
            mk("g1.7", 2.8, 3.2, "hotel."),
        ];
        doc
    }

    #[test]
    fn trans_cues_expand_anchored_pieces_and_fall_back_whole_sentence() {
        let mut doc = doc_two_cue_sentence();
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(cues.len(), 2);
        let sentences = derive_sentences(&doc, &cues);
        assert_eq!(sentences.len(), 1);

        // 未翻译：空流。
        assert!(derive_trans_cues(&doc, &sentences, "zh").is_empty());

        // 超 fit 的有译无对齐：整句上屏降级。
        doc.trans.entry("zh".to_owned()).or_default().insert(
            "s-g1.0".to_owned(),
            "第一段译文需要自然对应，第二段译文负责完整收尾。".to_owned(),
        );
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        assert_eq!(stream.len(), 1);
        assert!(stream[0].fallback);
        assert_eq!(stream[0].start, 0.0);
        assert_eq!(stream[0].end, 3.2);

        // 旧版 Cue 锚定条目不再有效：翻译 Cue 不能继承源 Cue 边界。
        doc.trans_align.entry("zh".to_owned()).or_default().insert(
            "s-g1.0".to_owned(),
            TransAlign {
                mode: AlignMode::ManyToOne,
                crossing: false,
                correspondence: None,
                text_basis: Default::default(),
                aligner: None,
                blocks: Vec::new(),
                cues: vec!["q-g1.0".to_owned(), "q-g1.5".to_owned()],
                words: Vec::new(),
                pieces: vec![
                    TransPiece {
                        from: Some(0),
                        to: Some(0),
                        text: "第一段译文需要自然对应，".to_owned(),
                    },
                    TransPiece {
                        from: Some(1),
                        to: Some(1),
                        text: "第二段译文负责完整收尾。".to_owned(),
                    },
                ],
            },
        );
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        assert_eq!(stream.len(), 1);
        assert!(stream[0].fallback);

        // 新版 manyToOne：词锚可落在旧 Cue 内部；展示边界在可行时会围绕
        // 词锚平滑，但 word_span 仍保留精确语义映射。
        doc.trans_align.get_mut("zh").unwrap().insert(
            "s-g1.0".to_owned(),
            TransAlign {
                mode: AlignMode::ManyToOne,
                crossing: false,
                correspondence: None,
                text_basis: Default::default(),
                aligner: None,
                blocks: Vec::new(),
                // 即使旧 cues 快照错误也不影响词锚条目：校验完全不读取它。
                cues: vec!["q-obsolete".to_owned()],
                words: doc.words.iter().map(|word| word.id.clone()).collect(),
                pieces: vec![
                    TransPiece {
                        from: Some(0),
                        to: Some(3),
                        text: "第一段译文需要自然对应，".to_owned(),
                    },
                    TransPiece {
                        from: Some(4),
                        to: Some(7),
                        text: "第二段译文负责完整收尾。".to_owned(),
                    },
                ],
            },
        );
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        assert_eq!(stream[0].word_span, Some((0, 3)));
        assert_eq!(stream[0].end, 1.6);
        assert_eq!(stream[1].start, 1.6);

        // 拼接不变量破坏（句级重写）⇒ 条目失效 ⇒ 回到整句上屏。
        doc.trans.get_mut("zh").unwrap().insert(
            "s-g1.0".to_owned(),
            "完全重写过的译文已经超过单行容量而且旧切法不再有效。".to_owned(),
        );
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        assert_eq!(stream.len(), 1);
        assert!(stream[0].fallback);
    }

    #[test]
    fn trans_cues_independent_anchor_to_word_edges() {
        let mut doc = doc_two_cue_sentence();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert("s-g1.0".to_owned(), "前半句译文，后半句译文。".to_owned());
        doc.trans_align.entry("zh".to_owned()).or_default().insert(
            "s-g1.0".to_owned(),
            TransAlign {
                mode: AlignMode::Independent,
                crossing: false,
                correspondence: None,
                text_basis: Default::default(),
                aligner: None,
                blocks: Vec::new(),
                cues: vec!["q-g1.0".to_owned(), "q-g1.5".to_owned()],
                words: Vec::new(),
                pieces: vec![
                    TransPiece {
                        from: None,
                        to: None,
                        text: "前半句译文，".to_owned(),
                    },
                    TransPiece {
                        from: None,
                        to: None,
                        text: "后半句译文。".to_owned(),
                    },
                ],
            },
        );
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        assert_eq!(stream.len(), 2);
        // 边界落在源词边缘：片1 末词 t1 == 片2 首词 t0 的前一词边缘。
        assert_eq!(stream[0].start, 0.0);
        assert!(stream[0].end > 0.0 && stream[0].end < 3.2);
        assert_eq!(stream[1].end, 3.2);
        let boundary_ok = doc
            .words
            .iter()
            .any(|w| (w.t1 - stream[0].end).abs() < 1e-9);
        assert!(boundary_ok, "边界必须是某源词的 t1");
    }

    #[test]
    fn source_cue_reflow_does_not_change_translation_cues() {
        let mut doc = doc_two_cue_sentence();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let sentence = &sentences[0];
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert(sentence.id.clone(), "前半句译文，后半句译文。".to_owned());
        doc.trans_align.entry("zh".to_owned()).or_default().insert(
            sentence.id.clone(),
            TransAlign {
                mode: AlignMode::ManyToOne,
                crossing: false,
                correspondence: None,
                text_basis: Default::default(),
                aligner: None,
                blocks: Vec::new(),
                cues: Vec::new(),
                words: sentence
                    .word_indices
                    .iter()
                    .map(|&index| doc.words[index].id.clone())
                    .collect(),
                pieces: vec![
                    TransPiece {
                        from: Some(0),
                        to: Some(3),
                        text: "前半句译文，".to_owned(),
                    },
                    TransPiece {
                        from: Some(4),
                        to: Some(7),
                        text: "后半句译文。".to_owned(),
                    },
                ],
            },
        );
        let before = derive_trans_cues(&doc, &sentences, "zh");

        // 只改原文展示 Cue 的断行覆盖；Sentence 词序列与时间没有变化。
        doc.breaks.insert("g1.4".to_owned(), BreakOverride::Nobreak);
        let reflowed_cues = derive_cues(&doc, &CueParams::default());
        assert_ne!(
            reflowed_cues.iter().map(|cue| &cue.id).collect::<Vec<_>>(),
            cues.iter().map(|cue| &cue.id).collect::<Vec<_>>()
        );
        let reflowed_sentences = derive_sentences(&doc, &reflowed_cues);
        let after = derive_trans_cues(&doc, &reflowed_sentences, "zh");
        assert_eq!(after, before);
    }

    #[test]
    fn trans_cues_pad_short_final_sentence_into_media_tail() {
        let mut doc = doc_two_cue_sentence();
        doc.words.push(Word {
            id: "g2.0".to_owned(),
            t0: 4.0,
            t1: 4.4,
            text: "Done.".to_owned(),
            sp: "s1".to_owned(),
            glue: false,
        });
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        doc.trans.entry("zh".to_owned()).or_default().extend([
            ("s-g1.0".to_owned(), "第一句。".to_owned()),
            ("s-g2.0".to_owned(), "谢谢。".to_owned()),
        ]);

        let stream = derive_trans_cues(&doc, &sentences, "zh");
        let final_cue = stream.last().expect("translated final sentence");
        assert_eq!(final_cue.start, 4.0);
        assert!((final_cue.end - 5.0).abs() < 1e-9);
        assert!(
            final_cue.end - final_cue.start + 1e-9
                >= target_required_seconds(&final_cue.text, "zh")
        );
    }

    #[test]
    fn smoothing_tolerates_one_ulp_boundary_inversion() {
        let mut cues = vec![
            TransCue {
                sentence_id: "s1".to_owned(),
                text: "字".repeat(42),
                start: 2106.88,
                end: 2110.0,
                word_span: Some((0, 0)),
                fallback: false,
            },
            TransCue {
                sentence_id: "s1".to_owned(),
                text: "字".repeat(30),
                start: 2110.0,
                end: 2114.88,
                word_span: Some((1, 1)),
                fallback: false,
            },
        ];

        smooth_trans_cue_times(&mut cues, "zh");

        assert_eq!(cues[0].end, cues[1].start);
        assert!((cues[0].start - 2106.88).abs() < 1e-9);
        assert!((cues[1].end - 2114.88).abs() < 1e-9);
        assert!(cues[0].end - cues[0].start + 1e-9 >= target_required_seconds(&cues[0].text, "zh"));
        assert!(cues[1].end - cues[1].start + 1e-9 >= target_required_seconds(&cues[1].text, "zh"));
    }

    #[test]
    fn smoothing_shares_shortfall_proportionally_when_sentence_is_too_dense() {
        // 整句时窗放不下全部阅读需求时，不再保留词边缘时间（那会让碰巧配
        // 了短源片的行独自闪过），而是按需求比例分摊：4 字片 vs 36 字片的
        // 需求是 1s vs 4s，2.5s 时窗应按 0.5s / 2.0s 分配。
        let mut cues = vec![
            TransCue {
                sentence_id: "s1".to_owned(),
                text: "字".repeat(4),
                start: 10.0,
                end: 10.2,
                word_span: Some((0, 0)),
                fallback: false,
            },
            TransCue {
                sentence_id: "s1".to_owned(),
                text: "字".repeat(36),
                start: 10.2,
                end: 12.5,
                word_span: Some((1, 1)),
                fallback: false,
            },
        ];

        smooth_trans_cue_times(&mut cues, "zh");

        assert_eq!(cues[0].end, cues[1].start);
        assert!((cues[0].start - 10.0).abs() < 1e-9);
        assert!((cues[1].end - 12.5).abs() < 1e-9);
        assert!(
            (cues[0].end - cues[0].start - 0.5).abs() < 1e-6,
            "first piece got {:.3}s",
            cues[0].end - cues[0].start
        );
        assert!(
            (cues[1].end - cues[1].start - 2.0).abs() < 1e-6,
            "second piece got {:.3}s",
            cues[1].end - cues[1].start
        );
    }

    #[test]
    fn align_entry_valid_enforces_coverage_and_concat() {
        let doc = doc_two_cue_sentence();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let sentence = &sentences[0];
        let entry = |pieces: Vec<TransPiece>, mode: AlignMode| TransAlign {
            mode,
            crossing: false,
            correspondence: None,
            text_basis: Default::default(),
            aligner: None,
            blocks: Vec::new(),
            cues: vec!["q-obsolete".to_owned()],
            words: if mode == AlignMode::ManyToOne {
                doc.words.iter().map(|word| word.id.clone()).collect()
            } else {
                Vec::new()
            },
            pieces,
        };
        let p = |from: usize, to: usize, text: &str| TransPiece {
            from: Some(from),
            to: Some(to),
            text: text.to_owned(),
        };
        let translation = "甲乙丙。";
        // 合法：连续全覆盖 + 拼接相等。
        assert!(align_entry_valid(
            &doc,
            sentence,
            translation,
            &entry(vec![p(0, 3, "甲乙"), p(4, 7, "丙。")], AlignMode::ManyToOne)
        ));
        // 区间不连续 / 覆盖不全 / 拼接不等 → 无效。
        assert!(!align_entry_valid(
            &doc,
            sentence,
            translation,
            &entry(vec![p(0, 3, "甲乙"), p(3, 7, "丙。")], AlignMode::ManyToOne)
        ));
        assert!(!align_entry_valid(
            &doc,
            sentence,
            translation,
            &entry(vec![p(0, 6, "甲乙丙。")], AlignMode::ManyToOne)
        ));
        assert!(!align_entry_valid(
            &doc,
            sentence,
            translation,
            &entry(vec![p(0, 3, "改"), p(4, 7, "丙。")], AlignMode::ManyToOne)
        ));
        // 旧 Cue 快照完全忽略；旧 oneToOne Cue 锚定条目始终无效。
        let stale_cues = entry(vec![p(0, 7, "甲乙丙。")], AlignMode::ManyToOne);
        assert!(align_entry_valid(&doc, sentence, translation, &stale_cues));
        let legacy = entry(vec![p(0, 1, "甲乙丙。")], AlignMode::OneToOne);
        assert!(!align_entry_valid(&doc, sentence, translation, &legacy));
    }

    /// 0.4 块层：I3/I4 进 `align_entry_valid`；显式整句对应只许一片；
    /// independent 不含块；旧 `crossing` 多片条目仍按片投影（设计 §5「保留
    /// pieces 时间」），显式 `sentence` 条目整句单条上屏。
    #[test]
    fn align_entry_valid_enforces_block_layer_and_sentence_shape() {
        use crate::doc::{AlignBlock, Correspondence};
        let mut doc = doc_two_cue_sentence();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        let sentence = &sentences[0];
        let words: Vec<String> = doc.words.iter().map(|word| word.id.clone()).collect();
        let p = |from: usize, to: usize, text: &str| TransPiece {
            from: Some(from),
            to: Some(to),
            text: text.to_owned(),
        };
        let block = |src: (usize, usize), tgt: (usize, usize)| AlignBlock {
            src,
            tgt,
            confidence: Some(0.9),
            flags: Vec::new(),
        };
        let translation = "甲乙，丙丁。";
        let mut entry = TransAlign::new(
            AlignMode::ManyToOne,
            words.clone(),
            vec![p(0, 3, "甲乙，"), p(4, 7, "丙丁。")],
        );
        entry.correspondence = Some(Correspondence::Block);
        entry.blocks = vec![
            block((0, 1), (0, 2)),
            block((2, 3), (2, 3)),
            block((4, 7), (3, 6)),
        ];
        assert!(align_entry_valid(&doc, sentence, translation, &entry));
        // (h) 片切进块内部：源侧 from 不在块起点。
        let mut inside = entry.clone();
        inside.pieces = vec![p(0, 2, "甲乙，"), p(3, 7, "丙丁。")];
        assert!(!align_entry_valid(&doc, sentence, translation, &inside));
        // 目标侧：片文本切点不在块边界。
        let mut inside = entry.clone();
        inside.pieces = vec![p(0, 3, "甲乙"), p(4, 7, "，丙丁。")];
        assert!(!align_entry_valid(&doc, sentence, translation, &inside));
        // 块覆盖不全 / 与片总长不符。
        let mut short = entry.clone();
        short.blocks.pop();
        assert!(!align_entry_valid(&doc, sentence, translation, &short));
        // 显式整句对应：恰一片、恰一块。
        let mut sentence_level = TransAlign::new(
            AlignMode::ManyToOne,
            words.clone(),
            vec![p(0, 7, "甲乙，丙丁。")],
        );
        sentence_level.correspondence = Some(Correspondence::Sentence);
        sentence_level.blocks = vec![block((0, 7), (0, 6))];
        assert!(align_entry_valid(
            &doc,
            sentence,
            translation,
            &sentence_level
        ));
        let mut two_pieces = sentence_level.clone();
        two_pieces.pieces = vec![p(0, 3, "甲乙，"), p(4, 7, "丙丁。")];
        two_pieces.blocks.clear();
        assert!(!align_entry_valid(&doc, sentence, translation, &two_pieces));
        // independent 不得携带块层或宣称块级对应。
        let mut independent = TransAlign::new(
            AlignMode::Independent,
            Vec::new(),
            vec![
                TransPiece {
                    from: None,
                    to: None,
                    text: "甲乙，".to_owned(),
                },
                TransPiece {
                    from: None,
                    to: None,
                    text: "丙丁。".to_owned(),
                },
            ],
        );
        assert!(align_entry_valid(&doc, sentence, translation, &independent));
        independent.blocks = vec![block((0, 7), (0, 6))];
        assert!(!align_entry_valid(
            &doc,
            sentence,
            translation,
            &independent
        ));
        independent.blocks.clear();
        independent.correspondence = Some(Correspondence::Block);
        assert!(!align_entry_valid(
            &doc,
            sentence,
            translation,
            &independent
        ));

        // 投影：显式 sentence ⇒ 整句单条；旧 crossing 多片 ⇒ 仍按片。
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert(sentence.id.clone(), translation.to_owned());
        doc.trans_align
            .entry("zh".to_owned())
            .or_default()
            .insert(sentence.id.clone(), sentence_level);
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        assert_eq!(stream.len(), 1);
        assert_eq!(stream[0].text, translation);
        assert_eq!(stream[0].word_span, Some((0, 7)));
        assert!(!stream[0].fallback);
        let mut crossing = TransAlign::new(
            AlignMode::ManyToOne,
            words,
            vec![p(0, 3, "甲乙，"), p(4, 7, "丙丁。")],
        );
        crossing.crossing = true;
        assert_eq!(crossing.correspondence(), Correspondence::Sentence);
        doc.trans_align
            .get_mut("zh")
            .unwrap()
            .insert(sentence.id.clone(), crossing);
        let stream = derive_trans_cues(&doc, &sentences, "zh");
        assert_eq!(stream.len(), 2);
        assert_eq!(stream[0].word_span, Some((0, 3)));
    }

    /// E2 的 DP 侧：`blocking_seam` 把 CJK 词内边界记为客观语病。p850 现场
    /// s-g79.0 的「同时还可 ‖ 以将…」不是兜底硬切造成的——是 DP 为了躲开
    /// 「…将」的弱尾罚分主动切进词里。不加词内项时本用例复现该缺陷。
    #[test]
    fn dp_does_not_cut_inside_a_cjk_word_when_a_real_boundary_exists() {
        let params = TransParams::for_lang("zh");
        let tail = "同时还可以将 max_num_batched_tokens 设置为大于 2048。";
        for max_pieces in 2..=4 {
            let pieces = split_independent_for_lang(tail, &params, max_pieces, "zh");
            assert_eq!(
                pieces,
                vec![
                    "同时还可以将 max_num_batched_tokens".to_owned(),
                    "设置为大于 2048。".to_owned()
                ],
                "max_pieces={max_pieces}"
            );
        }
        // 整句同理：逗号缝保留，「可以」不被拆开。
        let full = "生产部署已观察到 50% 的吞吐量提升，同时还可以将 max_num_batched_tokens 设置为大于 2048。";
        let pieces = split_independent_for_lang(full, &params, 4, "zh");
        assert!(pieces[0].ends_with("提升，"), "{pieces:?}");
        for pair in pieces.windows(2) {
            assert!(
                !crate::seam::cjk_midword_boundary(pair[0].trim_end(), pair[1].trim_start()),
                "cut inside a CJK word: {pair:?}"
            );
        }
    }
}
