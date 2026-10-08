//! rebind：把改好的文本落回词区间，LCS 匹配上的词原样保留 id/t0/t1，
//! 新 token 在空隙内按字符权重插值（对拍 voice-ink `TranscriptRebinding` +
//! `SubAlign.rebindCorrected`）。
//!
//! 这是增量体系的根基：小范围润色只换被动过的词的 id，从而分段（id 键）
//! 不过期、翻译（组文本指纹）只有被碰的组过期。

use crate::atomize::{
    atomize_words_like, correction_timing_weight, is_legacy_glued, is_script_glued, legacy_glue,
};
use crate::doc::Word;
use crate::timing::{normalize_doc_words, r2};

/// 新词 id 源。voice-ink 的 `uid()` 用墙钟毫秒 + 进程级计数（唯一的非确定
/// 因素），这里做成可注入以便测试 golden-lock。
pub trait IdSource {
    fn next_id(&mut self) -> String;
}

/// 生产实现：`w<base36 毫秒>-<n>`。
pub struct WallClockIds {
    counter: usize,
}

impl WallClockIds {
    pub fn new() -> Self {
        Self { counter: 0 }
    }
}

impl Default for WallClockIds {
    fn default() -> Self {
        Self::new()
    }
}

impl IdSource for WallClockIds {
    fn next_id(&mut self) -> String {
        self.counter += 1;
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        format!("w{}-{}", base36(ms), self.counter)
    }
}

/// 测试实现：`w0-1, w0-2, …`。
#[derive(Default)]
pub struct SeqIds {
    counter: usize,
}

impl IdSource for SeqIds {
    fn next_id(&mut self) -> String {
        self.counter += 1;
        format!("w0-{}", self.counter)
    }
}

fn base36(mut value: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_owned();
    }
    let mut output = Vec::new();
    while value > 0 {
        output.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    output.reverse();
    String::from_utf8(output).expect("ascii")
}

/// rebind 词级 LCS 表的 cell 上限（超限走全量权重均摊的退化路径）。
const REBIND_TABLE_CAP: usize = 4_000_000;

fn tokenize(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_owned).collect()
}

/// 把 `new_text`（空白分词）落回 `old_words` 区间。
///
/// `sp` 只是**兜底**说话人：新 token 一律继承 LCS 邻居的 `sp`（先前一个保留
/// 词、再后一个保留词），区间里一个词都没保留下来时才用它。
pub fn rebind(old_words: &[Word], new_text: &str, sp: &str, ids: &mut dyn IdSource) -> Vec<Word> {
    let tokens = tokenize(new_text)
        .into_iter()
        .map(|token| (token, false))
        .collect();
    rebind_tokens(old_words, tokens, false, sp, ids)
}

/// 润色/分段回写入口：统一用无损 atomize 重新分词。Latin 也必须走同一原子器，
/// 否则 `matters—the` 一类无空格强标点会被 whitespace tokenizer 熔成一个词，
/// 后续翻译对齐便无法表达 `matters— | the part` 的真实语义边界。
/// 未改字符仍通过 LCS 保持原 id 与时间。
///
/// 粒度跟着区间走（[`crate::atomize::atomize_like`]）：韩文按어절成词；0.5 之前逐音节的韩文
/// 区间（词带「贴前」标记）沿用逐音节，这样没改的音节保住 id 与时间。后一种
/// 区间写回文稿后要调 [`reglue_legacy_span`] 给新词补标记。
///
/// 说话人：句区间偶尔会跨说话人（⏹ 强制边界切不动、退化为吸附到句首；或
/// 区间开头是被模型删掉的另一方语气词）。新 token 的 `sp` 因此**不能**取
/// `span[0].sp`——那会把 S2 整句里每个被加了标点的字（"啊，""的，""吗？"）
/// 都标成 S1，在 UI 里表现为两个说话人逐字交替。改为继承 LCS 邻居。
pub fn rebind_corrected(span: &[Word], corrected: &str, ids: &mut dyn IdSource) -> Vec<Word> {
    if span.is_empty() {
        return Vec::new();
    }
    let sp = span[0].sp.clone();
    let tokens = atomize_words_like(span, corrected);
    if !tokens.is_empty() {
        // 按词切开的泰文一类区间：「贴前」标记跟着改写后的文本走（保留下来的
        // 词也取新文本里的标记），首词保持它与区间前一个词的关系。其余区间的
        // 原子都不带标记，结果与以前相同；逐音节的旧韩文区间由调用方重定。
        let adopt = !is_legacy_span(span) && span.iter().any(is_script_glued);
        let mut words = rebind_tokens(span, tokens, adopt, &sp, ids);
        if adopt && let Some(first) = words.first_mut() {
            first.glue = span[0].glue;
        }
        return words;
    }
    rebind(span, corrected, &sp, ids)
}

/// 区间是不是 0.5 之前逐音节的韩文（有词是 [`is_legacy_glued`]）。这种区间
/// 改写时新词沿用逐音节（[`rebind_corrected`]），写回后要
/// [`reglue_legacy_span`]。泰文一类按词切开的「贴前」词不算：它们的标记来自
/// 原文里没有空白，按旧规则重定会全部清掉、在词间印出空格。
pub fn is_legacy_span(span: &[Word]) -> bool {
    span.iter().any(is_legacy_glued)
}

/// 逐音节的旧区间被改写之后，按旧拼接规则重定标记：`range` 是改写结果在
/// `words` 里的位置。区间里每个词、以及区间之后直到第一个可见词为止的词，
/// 都用 [`legacy_glue`] 重新判一遍——与读旧文稿时打标记是同一条规则
/// （[`crate::doc::mark_legacy_glue`]）：可见词对它前面最近的可见词，隐藏词
/// 对紧挨着的前一个词。
///
/// 这种区间里的标记本来就是按这条规则推出来的，所以重判不丢信息，没改的
/// 词重判结果不变；显示与 0.5 之前改写同一段文本的结果逐字相同——模型或
/// 用户写的空格不会出现在这种文稿里，要拿回空格得重新转录。
///
/// 旧规则只给谚文一侧打标记，所以不含谚文的词身上的标记只可能是泰文一类
/// 按词切开时打的（[`is_script_glued`]），原样留着，不按旧规则清掉。
pub fn reglue_legacy_span(
    words: &mut [Word],
    range: std::ops::Range<usize>,
    hidden: &std::collections::BTreeMap<String, bool>,
) {
    let is_hidden = |word: &Word| hidden.get(&word.id).copied().unwrap_or(false);
    let mut index = range.start;
    while index < words.len() {
        let word_hidden = is_hidden(&words[index]);
        let against = if word_hidden {
            index.checked_sub(1)
        } else {
            (0..index).rev().find(|&before| !is_hidden(&words[before]))
        };
        if !is_script_glued(&words[index]) {
            words[index].glue =
                against.is_some_and(|before| legacy_glue(&words[before].text, &words[index].text));
        }
        if index >= range.end && !word_hidden {
            break;
        }
        index += 1;
    }
}

/// 区间里词数最多的说话人（并列取先出现者）；空区间为 `None`。
fn majority_speaker(words: &[Word]) -> Option<&str> {
    let mut counts: Vec<(&str, usize)> = Vec::new();
    for word in words {
        match counts.iter_mut().find(|(sp, _)| *sp == word.sp) {
            Some((_, count)) => *count += 1,
            None => counts.push((word.sp.as_str(), 1)),
        }
    }
    // `max_by` 并列取最后一个；反转后取到的就是原序里先出现的那个。
    counts
        .into_iter()
        .rev()
        .max_by(|left, right| left.1.cmp(&right.1))
        .map(|(sp, _)| sp)
}

/// `tokens` 是 `(文本, 贴前)`。新词的标记取 token 的；`adopt_glue` 为真时
/// 保留下来的旧词也改取对应 token 的标记，否则保持旧词自己的。
fn rebind_tokens(
    old_words: &[Word],
    tokens: Vec<(String, bool)>,
    adopt_glue: bool,
    sp: &str,
    ids: &mut dyn IdSource,
) -> Vec<Word> {
    let keep = |word: &Word, token: &(String, bool)| {
        let mut word = word.clone();
        if adopt_glue {
            word.glue = token.1;
        }
        word
    };
    let range_start = old_words.first().map_or(0.0, |word| word.t0);
    let range_end = old_words.last().map_or(range_start + 0.5, |word| word.t1);

    let mut prefix = 0;
    while prefix < old_words.len()
        && prefix < tokens.len()
        && old_words[prefix].text == tokens[prefix].0
    {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < old_words.len() - prefix
        && suffix < tokens.len() - prefix
        && old_words[old_words.len() - 1 - suffix].text == tokens[tokens.len() - 1 - suffix].0
    {
        suffix += 1;
    }
    let changed_words = &old_words[prefix..old_words.len() - suffix];
    let changed_tokens = &tokens[prefix..tokens.len() - suffix];
    let old_count = changed_words.len();
    let new_count = changed_tokens.len();

    let table_rows = old_count + 1;
    let table_columns = new_count + 1;
    if table_rows > REBIND_TABLE_CAP / table_columns {
        // 退化路径：全部 token 按权重均摊到旧区间，旧 id 一个不留；说话人取
        // 区间里词数最多的那个（并列取先出现者），而不是 span[0]。
        let sp = majority_speaker(old_words).unwrap_or(sp);
        let weights: Vec<f64> = tokens
            .iter()
            .map(|(token, _)| correction_timing_weight(token))
            .collect();
        let total: f64 = weights.iter().sum::<f64>().max(1e-9);
        let span = (0.02 * tokens.len() as f64).max(range_end - range_start);
        let mut accumulated = 0.0;
        let mut output = Vec::with_capacity(tokens.len());
        for (index, (token, glue)) in tokens.into_iter().enumerate() {
            let token_start = range_start + span * (accumulated / total);
            accumulated += weights[index];
            output.push(Word {
                id: ids.next_id(),
                t0: r2(token_start),
                t1: r2(range_start + span * (accumulated / total)),
                text: token,
                sp: sp.to_owned(),
                glue,
            });
        }
        normalize_doc_words(&mut output, range_start, range_end);
        return output;
    }

    // 词级 LCS（文本严格相等），反向填表。
    let stride = table_columns;
    let mut table = vec![0_i32; table_rows * stride];
    if old_count > 0 && new_count > 0 {
        for old_index in (0..old_count).rev() {
            for new_index in (0..new_count).rev() {
                table[old_index * stride + new_index] =
                    if changed_words[old_index].text == changed_tokens[new_index].0 {
                        table[(old_index + 1) * stride + new_index + 1] + 1
                    } else {
                        table[(old_index + 1) * stride + new_index]
                            .max(table[old_index * stride + new_index + 1])
                    };
            }
        }
    }

    let mut output: Vec<Word> = Vec::new();
    let mut pending: Vec<(String, bool)> = Vec::new();
    let mut gap_start = old_words.first().map_or(0.0, |word| word.t0);
    // 新 token 的说话人：前一个保留词 > 后一个保留词（flush 时的锚） > 兜底。
    let mut last_kept_sp: Option<String> = None;

    macro_rules! flush {
        ($gap_end:expr, $next_sp:expr) => {{
            let gap_end: f64 = $gap_end;
            let next_sp: Option<&str> = $next_sp;
            let inherited: String = last_kept_sp.as_deref().or(next_sp).unwrap_or(sp).to_owned();
            if !pending.is_empty() {
                let weights: Vec<f64> = pending
                    .iter()
                    .map(|(token, _)| correction_timing_weight(token))
                    .collect();
                let total: f64 = weights.iter().sum::<f64>().max(1e-9);
                let span = (0.02 * pending.len() as f64).max(gap_end - gap_start);
                let mut accumulated = 0.0;
                for (index, (token, glue)) in pending.drain(..).enumerate() {
                    let token_start = gap_start + span * (accumulated / total);
                    accumulated += weights[index];
                    output.push(Word {
                        id: ids.next_id(),
                        t0: r2(token_start),
                        t1: r2(gap_end
                            .max(token_start)
                            .min(gap_start + span * (accumulated / total))),
                        text: token,
                        sp: inherited.clone(),
                        glue,
                    });
                }
            }
        }};
    }

    for (word, token) in old_words[..prefix].iter().zip(&tokens) {
        output.push(keep(word, token));
        gap_start = word.t1;
        last_kept_sp = Some(word.sp.clone());
    }
    let mut old_index = 0;
    let mut new_index = 0;
    while old_index < old_count && new_index < new_count {
        if changed_words[old_index].text == changed_tokens[new_index].0 {
            flush!(
                changed_words[old_index].t0,
                Some(changed_words[old_index].sp.as_str())
            );
            output.push(keep(&changed_words[old_index], &changed_tokens[new_index]));
            gap_start = changed_words[old_index].t1;
            last_kept_sp = Some(changed_words[old_index].sp.clone());
            old_index += 1;
            new_index += 1;
        } else if table[(old_index + 1) * stride + new_index]
            >= table[old_index * stride + new_index + 1]
        {
            old_index += 1;
        } else {
            pending.push(changed_tokens[new_index].clone());
            new_index += 1;
        }
    }
    while new_index < new_count {
        pending.push(changed_tokens[new_index].clone());
        new_index += 1;
    }
    for (word, token) in old_words[old_words.len() - suffix..]
        .iter()
        .zip(&tokens[tokens.len() - suffix..])
    {
        flush!(word.t0, Some(word.sp.as_str()));
        output.push(keep(word, token));
        gap_start = word.t1;
        last_kept_sp = Some(word.sp.clone());
    }
    let final_end = old_words.last().map_or(gap_start + 0.5, |word| word.t1);
    flush!(final_end, None);
    normalize_doc_words(&mut output, range_start, range_end);
    output
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// 0.5 起的韩文文稿一个어절一个词：改写后新词也按어절，词间照常加空格。
    #[test]
    fn korean_rebind_forms_words_at_spaces() {
        let old = vec![
            word("g1.0", 0.0, 0.5, "저는"),
            word("g1.1", 0.5, 1.0, "내일"),
            word("g1.2", 1.0, 2.0, "아이폰을"),
            word("g1.3", 2.0, 2.5, "샀다."),
        ];
        let mut ids = SeqIds::default();
        let out = rebind_corrected(&old, "저는 어제 아이폰을 샀습니다.", &mut ids);
        let texts: Vec<&str> = out.iter().map(|word| word.text.as_str()).collect();
        assert_eq!(texts, ["저는", "어제", "아이폰을", "샀습니다."]);
        assert_eq!(out[0].id, "g1.0");
        assert_eq!(out[2].id, "g1.2");
        assert!(out.iter().all(|word| !word.glue));
        assert_eq!(
            crate::atomize::join_word_texts(out.iter()),
            "저는 어제 아이폰을 샀습니다."
        );
    }

    fn glued(id: &str, t0: f64, t1: f64, text: &str, glue: bool) -> Word {
        Word {
            glue,
            ..word(id, t0, t1, text)
        }
    }

    /// 泰文按词切开的区间不是旧韩文区间：改写后新词按词切、带标记，没改的词
    /// 保住 id 与时间，拼出来等于改写后的文本（不会在词间印出空格）。
    #[test]
    fn a_thai_word_span_keeps_its_glue_through_a_rewrite() {
        let text = "ลลิตาไม่ได้ยกเลิก การประชุม";
        let atoms = crate::atomize::atomize_words(text);
        assert!(atoms.len() >= 4, "{atoms:?}");
        let old: Vec<Word> = atoms
            .iter()
            .enumerate()
            .map(|(index, (atom, glue))| {
                glued(
                    &format!("g1.{index}"),
                    index as f64,
                    index as f64 + 1.0,
                    atom,
                    *glue,
                )
            })
            .collect();
        assert!(!is_legacy_span(&old));
        let mut ids = SeqIds::default();
        let same = rebind_corrected(&old, text, &mut ids);
        assert_eq!(
            same, old,
            "an unchanged sentence keeps every word as it was"
        );

        let edited = rebind_corrected(&old, "ลลิตาไม่ได้ยกเลิกการประชุมนี้", &mut ids);
        assert_eq!(
            crate::atomize::join_word_texts(edited.iter()),
            "ลลิตาไม่ได้ยกเลิกการประชุมนี้"
        );
        assert_eq!(edited[0].id, "g1.0");
        assert!(!edited[0].glue);
        assert!(edited[1..].iter().all(|word| word.glue));

        // 区间从短语中间开始：首词保持贴着区间前一个词。
        let tail = &old[1..3];
        let tail_text = crate::atomize::join_word_texts(tail.iter());
        let rebound = rebind_corrected(tail, &format!("{tail_text}นี้"), &mut ids);
        assert!(rebound[0].glue);
        assert_eq!(rebound[0].id, tail[0].id);

        // 从短语中间开始的区间原文不变：每个词原样保留（单独重切这段会换
        // 切法，见 `atomize_words_anchored`）。
        for start in 0..old.len() {
            for end in start + 1..=old.len() {
                let span = &old[start..end];
                let span_text = crate::atomize::join_word_texts(span.iter());
                assert_eq!(rebind_corrected(span, &span_text, &mut ids), span);
            }
        }

        // 旧规则重定只碰谚文词：泰文的标记留着（同一文稿里混进 0.5 的韩文
        // 词也不会被旧规则粘上，因为这种区间根本不算逐音节旧稿）。
        let mut reglued = old.clone();
        let len = reglued.len();
        reglue_legacy_span(&mut reglued, 0..len, &Default::default());
        assert_eq!(reglued, old);
        let mut mixed = old.clone();
        mixed.push(glued("k1", 9.0, 10.0, "안녕", false));
        mixed.push(glued("k2", 10.0, 11.0, "하세요", false));
        assert!(!is_legacy_span(&mixed));
    }

    /// 润色在泰文引号外加了空格（沙盒真跑的答案）：引号贴在词上，不单成一个
    /// 纯标点的词；开头没改的词保住 id；拼出来等于改写后的文本。
    #[test]
    fn a_space_added_outside_a_thai_quote_keeps_the_quote_on_a_word() {
        let source = "รหัสF-07ปรากฏข้างคำว่า“ยืนยันแล้ว”แต่ยังไม่ได้ส่งพัสดุ";
        let old: Vec<Word> = crate::atomize::atomize_words(source)
            .iter()
            .enumerate()
            .map(|(index, (atom, glue))| {
                glued(
                    &format!("g5.{index}"),
                    index as f64,
                    index as f64 + 1.0,
                    atom,
                    *glue,
                )
            })
            .collect();
        let corrected = "รหัส F-07 ปรากฏข้างคำว่า “ยืนยันแล้ว” แต่ยังไม่ได้ส่งพัสดุ";
        let mut ids = SeqIds::default();
        let out = rebind_corrected(&old, corrected, &mut ids);
        assert_eq!(crate::atomize::join_word_texts(out.iter()), corrected);
        assert!(
            out.iter()
                .all(|word| crate::atomize::atom_key(&word.text).is_some()),
            "{:?}",
            out.iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>()
        );
        assert!(out.iter().any(|word| word.text.starts_with('“')));
        assert_eq!(out[0].id, old[0].id);
        assert_eq!(out.last().unwrap().id, old.last().unwrap().id);
    }

    /// 0.5 之前逐音节的韩文区间（词带「贴前」标记）：改写沿用逐音节，没改的
    /// 音节保住 id；重定标记后读出来与旧规则拼出的文本逐字相同——模型写的
    /// 空格不进这种文稿。
    #[test]
    fn a_legacy_korean_span_is_rewritten_per_syllable_and_stays_glued() {
        let mut old = vec![
            word("g1.0", 0.0, 0.5, "저"),
            word("g1.1", 0.5, 1.0, "는"),
            word("g1.2", 1.0, 1.5, "내"),
            word("g1.3", 1.5, 2.0, "일"),
            word("g1.4", 2.0, 2.5, "iPhone"),
            word("g1.5", 2.5, 3.0, "을"),
            word("g1.6", 3.0, 3.5, "샀"),
            word("g1.7", 3.5, 4.0, "다."),
        ];
        crate::doc::mark_legacy_glue(&mut old, &Default::default());
        assert!(is_legacy_span(&old));
        assert_eq!(
            crate::atomize::join_word_texts(old.iter()),
            "저는내일 iPhone 을샀다."
        );

        let mut ids = SeqIds::default();
        let mut out = rebind_corrected(&old, "저는 어제 iPhone을 샀다.", &mut ids);
        let texts: Vec<&str> = out.iter().map(|word| word.text.as_str()).collect();
        assert_eq!(texts, ["저", "는", "어", "제", "iPhone", "을", "샀", "다."]);
        assert_eq!(out[0].id, "g1.0");
        assert_eq!(out[1].id, "g1.1");
        assert_eq!(out[4].id, "g1.4");
        let len = out.len();
        reglue_legacy_span(&mut out, 0..len, &Default::default());
        assert_eq!(
            crate::atomize::join_word_texts(out.iter()),
            "저는어제 iPhone 을샀다."
        );
    }

    /// 重定标记与读旧文稿时用同一条规则：可见词对前面最近的可见词，区间之后
    /// 一直判到第一个可见词为止；没改的词结果不变。
    #[test]
    fn reglue_follows_the_visible_neighbour_and_reaches_the_next_visible_word() {
        let hidden: std::collections::BTreeMap<String, bool> =
            [("g1.2".to_owned(), true)].into_iter().collect();
        let mut words = vec![
            word("g1.0", 0.0, 0.5, "저"),
            word("g1.1", 0.5, 1.0, "는"),
            word("g1.2", 1.0, 1.5, "um"),
            word("g1.3", 1.5, 2.0, "내"),
            word("g1.4", 2.0, 2.5, "일"),
        ];
        crate::doc::mark_legacy_glue(&mut words, &hidden);
        let before: Vec<bool> = words.iter().map(|word| word.glue).collect();
        assert_eq!(before, [false, true, false, true, true]);
        // 重判整段与只重判开头两个词，结果都与读入时相同。
        let mut all = words.clone();
        reglue_legacy_span(&mut all, 0..5, &hidden);
        assert_eq!(all, words);
        let mut head = words.clone();
        for word in &mut head {
            word.glue = false;
        }
        reglue_legacy_span(&mut head, 0..2, &hidden);
        let flags: Vec<bool> = head.iter().map(|word| word.glue).collect();
        assert_eq!(flags, [false, true, false, true, false]);
    }

    #[test]
    fn unchanged_words_keep_id_and_timing() {
        let old = vec![
            word("g1.0", 0.0, 0.4, "King"),
            word("g1.1", 0.4, 0.8, "Arthur"),
            word("g1.2", 0.8, 1.6, "Camelot,"),
            word("g1.3", 1.6, 2.0, "didn't"),
            word("g1.4", 2.0, 2.3, "he?"),
        ];
        let mut ids = SeqIds::default();
        let out = rebind(&old, "King Arthur Camelot, didn't he?", "s1", &mut ids);
        assert_eq!(out, old);
    }

    #[test]
    fn camelot_split_uses_semantic_weight_ratio() {
        // Camelot → came a lot 按 4:1:3 占据原词窗(voice-ink 测试用例)。
        let old = vec![
            word("w0", 0.0, 0.4, "King"),
            word("w1", 0.4, 0.8, "Arthur"),
            word("w2", 0.8, 1.6, "Camelot,"),
            word("w3", 1.6, 2.0, "didn't"),
            word("w4", 2.0, 2.3, "he?"),
        ];
        let mut ids = SeqIds::default();
        let out = rebind(&old, "King Arthur came a lot, didn't he?", "s1", &mut ids);
        assert_eq!(out.len(), 7);
        assert_eq!(out[0].id, "w0");
        assert_eq!(out[6].id, "w4");
        let came = &out[2];
        let a = &out[3];
        let lot = &out[4];
        assert_eq!((came.t0, came.t1), (0.8, 1.2));
        assert_eq!((a.t0, a.t1), (1.2, 1.3));
        assert_eq!((lot.t0, lot.t1), (1.3, 1.6));
        for pair in out.windows(2) {
            assert!(pair[0].t1 <= pair[1].t0 + 1e-9);
        }
    }

    #[test]
    fn empty_source_synthesizes_half_second_span() {
        let mut ids = SeqIds::default();
        let out = rebind(&[], "hello world", "s1", &mut ids);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].t0, 0.0);
        assert!((out[1].t1 - 0.5).abs() < 1e-9);
    }

    #[test]
    fn cjk_rebind_keeps_untouched_chars_and_coheres_latin() {
        let old: Vec<Word> = ["他", "用", "A", "进", "来", "做", "任", "务"]
            .iter()
            .enumerate()
            .map(|(i, t)| {
                word(
                    &format!("g1.0~{i}"),
                    i as f64 * 0.2,
                    (i + 1) as f64 * 0.2,
                    t,
                )
            })
            .collect();
        let mut ids = SeqIds::default();
        let out = rebind_corrected(&old, "他用Agent来做任务。", &mut ids);
        let joined = crate::atomize::join_word_texts(out.iter());
        assert_eq!(joined, "他用 Agent 来做任务。");
        assert!(out.iter().any(|w| w.text == "Agent"));
        // 未改字符保住原 id
        assert_eq!(out[0].id, "g1.0~0");
        assert_eq!(out[1].id, "g1.0~1");
        let lai = out.iter().find(|w| w.text == "来").unwrap();
        assert_eq!(lai.id, "g1.0~4");
    }

    #[test]
    fn latin_rebind_splits_no_space_em_dash_boundary() {
        let old = vec![
            word("g1.0", 0.0, 0.5, "matters"),
            word("g1.1", 0.5, 1.0, "the"),
            word("g1.2", 1.0, 1.5, "part"),
        ];
        let mut ids = SeqIds::default();
        let out = rebind_corrected(&old, "matters—the part", &mut ids);
        assert_eq!(
            out.iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>(),
            vec!["matters—", "the", "part"]
        );
        assert_ne!(out[0].text, "matters—the");
        assert_eq!(out[2].id, "g1.2");
    }

    fn spoken(id: &str, t0: f64, t1: f64, text: &str, sp: &str) -> Word {
        Word {
            id: id.to_owned(),
            t0,
            t1,
            text: text.to_owned(),
            sp: sp.to_owned(),
            glue: false,
        }
    }

    /// 回归锁（2026-08 双人访谈截图）：句区间开头是被模型删掉的另一方语气词
    /// "呃"（s1），正文全是 s2。加了标点的字（"啊，""的，""吗？"）是新 token，
    /// 必须继承 LCS 邻居的 s2，而不是 `span[0]` 的 s1——否则 UI 里 s1/s2 逐字交替。
    #[test]
    fn new_tokens_inherit_the_neighbouring_speaker_not_the_span_head() {
        let old = vec![
            spoken("g174.0", 719.41, 719.87, "呃", "s1"),
            spoken("g174.1", 719.87, 720.03, "很", "s2"),
            spoken("g174.2", 720.03, 720.04, "多", "s2"),
            spoken("g174.3", 720.04, 720.21, "啊", "s2"),
            spoken("g174.4", 720.21, 720.37, "打", "s2"),
            spoken("g174.5", 720.37, 721.06, "DOTA", "s2"),
            spoken("g174.6", 721.06, 721.30, "啊", "s2"),
            spoken("g174.7", 721.30, 721.39, "什", "s2"),
            spoken("g174.8", 721.39, 721.47, "么", "s2"),
            spoken("g174.9", 721.47, 721.56, "的", "s2"),
            spoken("g174.10", 721.56, 721.65, "就", "s2"),
        ];
        let mut ids = SeqIds::default();
        let out = rebind_corrected(&old, "很多啊，打DOTA什么的，就", &mut ids);
        let joined: String = out.iter().map(|word| word.text.as_str()).collect();
        assert_eq!(joined, "很多啊，打DOTA什么的，就");
        for word in &out {
            assert_eq!(word.sp, "s2", "{word:?}");
        }
        assert_eq!(out[0].id, "g174.1", "未改字保住原 id");
    }

    /// 区间开头就是新 token 且前面没有保留词 ⇒ 继承后一个保留词的说话人。
    #[test]
    fn leading_new_tokens_inherit_the_next_kept_speaker() {
        let old = vec![
            spoken("a", 0.0, 0.3, "呃", "s1"),
            spoken("b", 0.3, 0.6, "对", "s2"),
            spoken("c", 0.6, 0.9, "的", "s2"),
        ];
        let mut ids = SeqIds::default();
        let out = rebind_corrected(&old, "嗯，对的", &mut ids);
        assert_eq!(out[0].text, "嗯，");
        assert_eq!(out[0].sp, "s2");
        assert_eq!(out[1].id, "b");
    }

    /// 一个词都没保留下来时才退回 `span[0]` 的说话人（兜底）。
    #[test]
    fn fully_rewritten_span_falls_back_to_the_span_head_speaker() {
        let old = vec![
            spoken("a", 0.0, 0.3, "one", "s1"),
            spoken("b", 0.3, 0.6, "two", "s1"),
        ];
        let mut ids = SeqIds::default();
        let out = rebind_corrected(&old, "three four", &mut ids);
        assert!(out.iter().all(|word| word.sp == "s1"), "{out:?}");
    }
}
