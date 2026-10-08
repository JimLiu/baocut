//! 停顿/说话人软标记（对拍 voice-ink `OrganizeEngine` 的 ⏸/⏹ 机制）。
//!
//! 标记只进 payload 副本，是元数据，禁止进入 LLM 输出；返回侧用
//! [`strip_markers`] / [`sanitize_corrected`] 清洗。
//!
//! 说话人标记有两种形态，返回侧都必须剥掉：
//!
//! - 裸 `⏹`：无说话人标签表时的历史形态，仍然被识别（兼容）；
//! - 带标签 `⏹S2`：标签来自 [`SpeakerLabels`]，指**标记右侧**开始说话的人。
//!   标签让模型看懂对话结构（谁在答谁、"嗯/对"属于哪一方），不含时间，
//!   同一说话人在全篇所有页里的标签一致。

use crate::atomize::{JoinWord, is_legacy_glued, legacy_unspaced_pair, unspaced_pair, word_sep};
use crate::doc::Word;
use crate::speaker::SpeakerLabels;

pub const PAUSE_MARKER: char = '⏸';
pub const SPEAKER_MARKER: char = '⏹';

const PAUSE_GAP_SECONDS: f64 = 0.6;
const PAUSE_MED_SECONDS: f64 = 1.0;
const PAUSE_LONG_SECONDS: f64 = 1.8;

/// gap → "⏸"/"⏸⏸"/"⏸⏸⏸"（<0.6s 为空）。
pub fn pause_marks(gap: f64) -> String {
    if gap < PAUSE_GAP_SECONDS {
        return String::new();
    }
    let count = if gap >= PAUSE_LONG_SECONDS {
        3
    } else if gap >= PAUSE_MED_SECONDS {
        2
    } else {
        1
    };
    std::iter::repeat_n(PAUSE_MARKER, count).collect()
}

/// 说话人切换标记：无标签表时是裸 `⏹`，有标签时是 `⏹S2`（标签指右侧说话人）。
pub fn speaker_marker(next_speaker: &str, labels: Option<&SpeakerLabels>) -> String {
    let mut marker = String::from(SPEAKER_MARKER);
    if let Some(label) = labels.and_then(|labels| labels.label(next_speaker)) {
        marker.push_str(label);
    }
    marker
}

/// 词后缀标记：`" ⏸⏸"` +（说话人切换时）`" ⏹"`。
pub fn boundary_marker_suffix(word: &Word, next: &Word) -> String {
    boundary_marker_suffix_labeled(word, next, None)
}

/// [`boundary_marker_suffix`] 的带标签形态：说话人切换处写 `" ⏹S2"`。
pub fn boundary_marker_suffix_labeled(
    word: &Word,
    next: &Word,
    labels: Option<&SpeakerLabels>,
) -> String {
    let mut suffix = String::new();
    let marks = pause_marks(next.t0 - word.t1);
    if !marks.is_empty() {
        suffix.push(' ');
        suffix.push_str(&marks);
    }
    if next.sp != word.sp {
        suffix.push(' ');
        suffix.push_str(&speaker_marker(&next.sp, labels));
    }
    suffix
}

/// 一段词渲染为带标记的 payload 文本（词间隔按 CJK 邻接规则）。
pub fn marked_text(words: &[Word]) -> String {
    marked_text_labeled(words, None)
}

/// [`marked_text`] 的带标签形态（说话人切换处写 `⏹S2`）。
pub fn marked_text_labeled(words: &[Word], labels: Option<&SpeakerLabels>) -> String {
    let mut output = String::new();
    for (index, word) in words.iter().enumerate() {
        if index > 0 && word_sep(&words[index - 1].text, word) == 1 {
            output.push(' ');
        }
        output.push_str(&word.text);
        if let Some(next) = words.get(index + 1) {
            output.push_str(&boundary_marker_suffix_labeled(word, next, labels));
        }
    }
    output
}

/// 剥除标记（含尾随 U+FE0F 变体选择符与 `⏹` 后的说话人标签），按标记切分再以
/// 空格重接，折叠连续空白。
///
/// 裸 `⏹` 与带标签 `⏹S2` 都被识别：标签是标记的一部分，绝不能作为正文
/// 残留在输出里（否则 `S2` 会被当成一个词进 atom-LCS 与逐字保真比对）。
pub fn strip_markers(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut cleaned = String::with_capacity(text.len());
    let mut index = 0usize;
    while index < chars.len() {
        let ch = chars[index];
        if ch == PAUSE_MARKER || ch == '\u{FE0F}' {
            cleaned.push(' ');
            index += 1;
        } else if ch == SPEAKER_MARKER {
            cleaned.push(' ');
            index += 1 + speaker_label_len(&chars[index + 1..]);
        } else {
            cleaned.push(ch);
            index += 1;
        }
    }
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `⏹` 之后紧跟的说话人标签长度（字符数），没有标签时为 0。
///
/// 容忍模型抄写时插入的空格与变体选择符（`⏹ S2`），但要求标签完整——
/// `S` + 至少一位数字，且数字后不能再接字母数字，避免吃掉正文里的 `S2nd`。
fn speaker_label_len(rest: &[char]) -> usize {
    let mut cursor = 0usize;
    while rest
        .get(cursor)
        .is_some_and(|ch| *ch == '\u{FE0F}' || *ch == ' ')
    {
        cursor += 1;
    }
    if !rest.get(cursor).is_some_and(|ch| *ch == 'S' || *ch == 's') {
        return 0;
    }
    let mut end = cursor + 1;
    while rest.get(end).is_some_and(char::is_ascii_digit) {
        end += 1;
    }
    if end == cursor + 1 || rest.get(end).is_some_and(|ch| ch.is_alphanumeric()) {
        return 0;
    }
    end
}

/// 折叠不写空格的字符之间的空格（汉字、假名、全角标点之间；口径同
/// [`crate::atomize::sep_len`] 第 1 条）。韩文的空格是词界，原样保留。
pub fn collapse_cjk_spaces(text: &str) -> String {
    collapse_spaces_between(text, unspaced_pair)
}

/// 按 `words` 的粒度折叠空格：区间里有 0.5 之前逐音节韩文的「贴前」词
/// （[`is_legacy_glued`]，词缝没有空格）时，谚文之间的空格也折掉——那样的区间
/// 里模型写回的空格落不进文稿，拿它和原文比只会把每一句都判成改过。泰文一类
/// 按词切开的「贴前」词不在此列：那里的空格是短语停顿，原样比较。否则同
/// [`collapse_cjk_spaces`]。
pub fn collapse_cjk_spaces_like<W: JoinWord>(words: &[W], text: &str) -> String {
    if words.iter().any(is_legacy_glued) {
        collapse_spaces_between(text, legacy_unspaced_pair)
    } else {
        collapse_cjk_spaces(text)
    }
}

fn collapse_spaces_between(text: &str, unspaced: fn(char, char) -> bool) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut output = String::with_capacity(text.len());
    for (index, &ch) in chars.iter().enumerate() {
        if ch == ' ' {
            let previous = chars[..index].iter().rev().find(|c| **c != ' ');
            let next = chars[index + 1..].iter().find(|c| **c != ' ');
            if let (Some(&p), Some(&n)) = (previous, next)
                && unspaced(p, n)
            {
                continue;
            }
        }
        output.push(ch);
    }
    output
}

/// LLM 返回文本的统一清洗：剥标记 + 折叠汉字 / 假名之间的空格。
pub fn sanitize_corrected(text: &str) -> String {
    collapse_cjk_spaces(&strip_markers(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(t0: f64, t1: f64, text: &str, sp: &str) -> Word {
        Word {
            id: format!("g{t0}"),
            t0,
            t1,
            text: text.to_owned(),
            sp: sp.to_owned(),
            glue: false,
        }
    }

    #[test]
    fn pause_marks_follow_thresholds() {
        assert_eq!(pause_marks(0.5), "");
        assert_eq!(pause_marks(0.6), "⏸");
        assert_eq!(pause_marks(1.0), "⏸⏸");
        assert_eq!(pause_marks(1.8), "⏸⏸⏸");
    }

    #[test]
    fn marked_text_injects_pause_and_speaker_markers() {
        let words = vec![
            word(0.0, 1.0, "hello", "s1"),
            word(2.2, 3.0, "world", "s1"),
            word(3.0, 4.0, "bye", "s2"),
        ];
        assert_eq!(marked_text(&words), "hello ⏸⏸ world ⏹ bye");
        let cjk = vec![word(0.0, 1.0, "你", "s1"), word(1.0, 2.0, "好", "s1")];
        assert_eq!(marked_text(&cjk), "你好");
    }

    #[test]
    fn marked_text_labels_the_speaker_that_starts_talking() {
        let words = vec![
            word(0.0, 1.0, "hello", "s1"),
            word(1.0, 2.0, "world", "s1"),
            word(2.0, 3.0, "bye", "s2"),
            word(3.0, 4.0, "ok", "s1"),
        ];
        let labels = SpeakerLabels::from_words(&words);
        assert_eq!(
            marked_text_labeled(&words, Some(&labels)),
            "hello world ⏹S2 bye ⏹S1 ok"
        );
        // 无标签表时仍是裸标记（segment/analysis 载体沿用）。
        assert_eq!(marked_text(&words), "hello world ⏹ bye ⏹ ok");
    }

    #[test]
    fn sanitize_strips_labeled_and_bare_speaker_markers() {
        assert_eq!(
            strip_markers("hello ⏸⏸ world ⏹S2 bye ⏹S12 ok"),
            "hello world bye ok"
        );
        // 兼容：裸标记、模型抄写时多出的空格与变体选择符。
        assert_eq!(strip_markers("a ⏹ b ⏹\u{FE0F} S3 c"), "a b c");
        // 标签必须完整，否则原样留在正文里（不吞正文）。
        assert_eq!(strip_markers("a ⏹Sure b"), "a Sure b");
        assert_eq!(strip_markers("a ⏹S2nd b"), "a S2nd b");
        assert_eq!(sanitize_corrected("你 ⏹S2 好"), "你好");
    }

    #[test]
    fn sanitize_strips_markers_and_collapses_cjk_spaces() {
        assert_eq!(strip_markers("hello ⏸⏸ world ⏹ bye"), "hello world bye");
        assert_eq!(sanitize_corrected("你 ⏸ 好，世界。"), "你好，世界。");
        assert_eq!(sanitize_corrected("用 Agent 做事"), "用 Agent 做事");
    }

    #[test]
    fn korean_spaces_are_word_boundaries_and_survive_the_cleanup() {
        assert_eq!(
            sanitize_corrected("저는 ⏸ 내일 학교에 갑니다."),
            "저는 내일 학교에 갑니다."
        );
        assert_eq!(collapse_cjk_spaces("いい 天気 ですね"), "いい天気ですね");
        // 谚文挨着汉字 / 假名照旧贴着。
        assert_eq!(collapse_cjk_spaces("大韓 민국 만세"), "大韓민국 만세");
        // 0.5 之前逐音节的区间：词缝没有空格，模型写回的空格不算改动。
        let legacy = [("저", false), ("는", true)];
        let fresh = [("저는", false)];
        assert_eq!(collapse_cjk_spaces_like(&legacy, "저는 내일"), "저는내일");
        assert_eq!(collapse_cjk_spaces_like(&fresh, "저는 내일"), "저는 내일");
    }
}
