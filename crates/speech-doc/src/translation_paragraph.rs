//! 译文卡跨 Sentence 段落合并。
//!
//! 这是持久化语义：只有下句首词上的 `paraBreaks` 是唯一句界时才能移除；
//! 源 Sentence 按规范重新派生，译文按语言折回幸存的上句 id，旧 alignment
//! 覆盖层失效。客户端只提交乐观锁基线与当前可见文本，不自行重拼表。

use std::collections::BTreeSet;
use std::fmt;

use crate::atomize::sentence_end;
use crate::cue::{CueParams, derive_cues};
use crate::doc::TranscriptDoc;
use crate::sentence::{SENTENCE_HARD_GAP_SECONDS, SENTENCE_MAX_WORDS, Sentence, derive_sentences};
use crate::split::align_entry_valid_for_lang;

#[derive(Debug, Clone, Copy)]
pub struct TranslationParagraphMergeRequest<'a> {
    pub language: &'a str,
    pub upper_sentence_id: &'a str,
    pub lower_sentence_id: &'a str,
    pub upper_base: &'a str,
    pub lower_base: &'a str,
    /// 编辑器尚未单独提交的文本；与移除 paragraph pin 同一事务落地。
    pub upper_value: &'a str,
    pub lower_value: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranslationParagraphMergeOutcome {
    pub sentence_id: String,
    pub removed_paragraph_pin: String,
    pub merged_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TranslationParagraphMergeError {
    InvalidLanguage,
    SentenceMissing,
    NotAdjacent,
    MissingParagraphPin,
    SpeakerBoundary,
    SentenceEnding,
    HardGap,
    TooManyWords,
    ChapterBoundary,
    DerivedBoundary,
    UpperConflict,
    LowerConflict,
    InvalidDocument(String),
}

impl fmt::Display for TranslationParagraphMergeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InvalidLanguage => "目标语言为空",
            Self::SentenceMissing => "译文句已不存在",
            Self::NotAdjacent => "两张译文卡不是相邻 Sentence",
            Self::MissingParagraphPin => "下句不是可移除的 paragraph pin 边界",
            Self::SpeakerBoundary => "说话人切换处无法合并",
            Self::SentenceEnding => "完整句末标点处无法合并",
            Self::HardGap => "长停顿处无法合并",
            Self::TooManyWords => "合并后超过 80 个词",
            Self::ChapterBoundary => "章节边界处无法合并",
            Self::DerivedBoundary => "移除 paragraph pin 后仍无法合并为一个 Sentence",
            Self::UpperConflict => "上句译文基线已变化",
            Self::LowerConflict => "下句译文基线已变化",
            Self::InvalidDocument(message) => return formatter.write_str(message),
        };
        formatter.write_str(message)
    }
}

fn chapter_at(doc: &TranscriptDoc, time: f64) -> usize {
    doc.chapters
        .iter()
        .position(|chapter| time >= chapter.start && time < chapter.end)
        .unwrap_or(usize::MAX)
}

/// 对拍 Mac `TranslateModel.scriptOf`：跨句折叠沿用产品目标语的展示分隔，
/// CJK / Thai 不插空格，其余语言插一个空格。未知 BCP-47 主语言按 Latin 兜底。
fn join_translation_texts<'a>(language: &str, texts: impl IntoIterator<Item = &'a str>) -> String {
    let primary = language
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let separator = if matches!(primary.as_str(), "zh" | "ja" | "ko" | "th") {
        ""
    } else {
        " "
    };
    texts
        .into_iter()
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(separator)
}

fn visible_translation(doc: &TranscriptDoc, sentence: &Sentence, language: &str) -> String {
    let natural = doc
        .trans
        .get(language)
        .and_then(|table| table.get(&sentence.id))
        .cloned()
        .unwrap_or_default();
    let Some(entry) = doc
        .trans_align
        .get(language)
        .and_then(|table| table.get(&sentence.id))
        .filter(|entry| align_entry_valid_for_lang(doc, sentence, language, entry))
    else {
        return natural;
    };
    join_translation_texts(
        language,
        entry
            .pieces
            .iter()
            .map(|piece| piece.text.as_str())
            .filter(|text| !text.is_empty()),
    )
}

/// 移除跨 Sentence 的 paragraph pin，并把所有语言的旧句级真相折回上句。
///
/// 所有校验与变换先在副本完成；错误不会留下半套 `paraBreaks` / `trans` 状态。
pub fn merge_translation_paragraphs(
    doc: &mut TranscriptDoc,
    request: TranslationParagraphMergeRequest<'_>,
) -> Result<TranslationParagraphMergeOutcome, TranslationParagraphMergeError> {
    if request.language.trim().is_empty() {
        return Err(TranslationParagraphMergeError::InvalidLanguage);
    }
    let cues = derive_cues(doc, &CueParams::default());
    let sentences = derive_sentences(doc, &cues);
    let upper_index = sentences
        .iter()
        .position(|sentence| sentence.id == request.upper_sentence_id)
        .ok_or(TranslationParagraphMergeError::SentenceMissing)?;
    let lower_index = sentences
        .iter()
        .position(|sentence| sentence.id == request.lower_sentence_id)
        .ok_or(TranslationParagraphMergeError::SentenceMissing)?;
    if lower_index != upper_index + 1 {
        return Err(TranslationParagraphMergeError::NotAdjacent);
    }
    let upper = &sentences[upper_index];
    let lower = &sentences[lower_index];
    let upper_last_index = *upper
        .word_indices
        .last()
        .ok_or(TranslationParagraphMergeError::SentenceMissing)?;
    let lower_first_index = *lower
        .word_indices
        .first()
        .ok_or(TranslationParagraphMergeError::SentenceMissing)?;
    let upper_last = &doc.words[upper_last_index];
    let lower_first = &doc.words[lower_first_index];
    let lower_first_id = lower_first.id.clone();
    if !doc
        .para_breaks
        .get(&lower_first.id)
        .copied()
        .unwrap_or(false)
    {
        return Err(TranslationParagraphMergeError::MissingParagraphPin);
    }
    if upper_last.sp != lower_first.sp {
        return Err(TranslationParagraphMergeError::SpeakerBoundary);
    }
    if sentence_end(&upper_last.text) {
        return Err(TranslationParagraphMergeError::SentenceEnding);
    }
    if lower_first.t0 - upper_last.t1 >= SENTENCE_HARD_GAP_SECONDS {
        return Err(TranslationParagraphMergeError::HardGap);
    }
    if upper.word_indices.len() + lower.word_indices.len() > SENTENCE_MAX_WORDS {
        return Err(TranslationParagraphMergeError::TooManyWords);
    }
    if chapter_at(doc, upper_last.t0) != chapter_at(doc, lower_first.t0) {
        return Err(TranslationParagraphMergeError::ChapterBoundary);
    }

    let upper_current = visible_translation(doc, upper, request.language);
    if upper_current != request.upper_base {
        return Err(TranslationParagraphMergeError::UpperConflict);
    }
    let lower_current = visible_translation(doc, lower, request.language);
    if lower_current != request.lower_base {
        return Err(TranslationParagraphMergeError::LowerConflict);
    }

    let expected_words: Vec<usize> = upper
        .word_indices
        .iter()
        .chain(&lower.word_indices)
        .copied()
        .collect();
    let mut next = doc.clone();
    next.para_breaks.remove(&lower_first_id);
    let next_cues = derive_cues(&next, &CueParams::default());
    let rederived = derive_sentences(&next, &next_cues);
    if !rederived.iter().any(|sentence| {
        sentence.id == request.upper_sentence_id && sentence.word_indices == expected_words
    }) {
        return Err(TranslationParagraphMergeError::DerivedBoundary);
    }

    let languages: BTreeSet<String> = next
        .trans
        .keys()
        .chain(next.trans_align.keys())
        .chain(next.trans_src.keys())
        .cloned()
        .chain(std::iter::once(request.language.to_owned()))
        .collect();
    let selected_merged = join_translation_texts(
        request.language,
        [request.upper_value, request.lower_value]
            .into_iter()
            .filter(|text| !text.is_empty()),
    );
    for language in languages {
        let merged = if language == request.language {
            selected_merged.clone()
        } else {
            let table = next.trans.get(&language);
            join_translation_texts(
                &language,
                [
                    table.and_then(|table| table.get(request.upper_sentence_id)),
                    table.and_then(|table| table.get(request.lower_sentence_id)),
                ]
                .into_iter()
                .flatten()
                .map(String::as_str)
                .filter(|text| !text.is_empty()),
            )
        };
        let table = next.trans.entry(language.clone()).or_default();
        table.remove(request.upper_sentence_id);
        table.remove(request.lower_sentence_id);
        if !merged.is_empty() {
            table.insert(request.upper_sentence_id.to_owned(), merged);
        }
        if let Some(table) = next.trans_align.get_mut(&language) {
            table.remove(request.upper_sentence_id);
            table.remove(request.lower_sentence_id);
        }
        if let Some(table) = next.trans_src.get_mut(&language) {
            table.remove(request.lower_sentence_id);
        }
    }
    next.validate().map_err(|error| {
        TranslationParagraphMergeError::InvalidDocument(format!(
            "合并后的 transcript 无效：{error:#}"
        ))
    })?;
    *doc = next;
    Ok(TranslationParagraphMergeOutcome {
        sentence_id: request.upper_sentence_id.to_owned(),
        removed_paragraph_pin: lower_first_id,
        merged_text: selected_merged,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{
        AlignMode, Chapter, DocEngine, DocMedia, Speaker, TransAlign, TransPiece, Word,
    };

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

    fn fixture() -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: None,
                hash: "sha256-00".to_owned(),
                duration: 20.0,
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
                name: "Speaker".to_owned(),
                hue: None,
            },
        );
        doc.speakers.insert(
            "s2".to_owned(),
            Speaker {
                name: "Other".to_owned(),
                hue: None,
            },
        );
        doc.words = vec![
            word("w1", 0.0, 0.4, "One"),
            word("w2", 0.4, 0.8, "thought"),
            word("w3", 1.0, 1.4, "continues"),
            word("w4", 1.4, 1.8, "here."),
        ];
        doc.para_breaks.insert("w3".to_owned(), true);
        doc.trans.insert(
            "zh".to_owned(),
            [
                ("s-w1".to_owned(), "上半句".to_owned()),
                ("s-w3".to_owned(), "下半句".to_owned()),
            ]
            .into_iter()
            .collect(),
        );
        doc.trans.insert(
            "fr".to_owned(),
            [
                ("s-w1".to_owned(), "première".to_owned()),
                ("s-w3".to_owned(), "suite".to_owned()),
            ]
            .into_iter()
            .collect(),
        );
        for language in ["zh", "fr"] {
            let upper_text = doc.trans[language]["s-w1"].clone();
            let lower_text = doc.trans[language]["s-w3"].clone();
            let table = doc.trans_align.entry(language.to_owned()).or_default();
            table.insert(
                "s-w1".to_owned(),
                TransAlign::new(
                    AlignMode::ManyToOne,
                    vec!["w1".to_owned(), "w2".to_owned()],
                    vec![TransPiece {
                        from: Some(0),
                        to: Some(1),
                        text: upper_text,
                    }],
                ),
            );
            table.insert(
                "s-w3".to_owned(),
                TransAlign::new(
                    AlignMode::ManyToOne,
                    vec!["w3".to_owned(), "w4".to_owned()],
                    vec![TransPiece {
                        from: Some(0),
                        to: Some(1),
                        text: lower_text,
                    }],
                ),
            );
            doc.trans_src
                .entry(language.to_owned())
                .or_default()
                .extend([
                    ("s-w1".to_owned(), "upper-stamp".to_owned()),
                    ("s-w3".to_owned(), "lower-stamp".to_owned()),
                ]);
        }
        doc
    }

    fn request<'a>() -> TranslationParagraphMergeRequest<'a> {
        TranslationParagraphMergeRequest {
            language: "zh",
            upper_sentence_id: "s-w1",
            lower_sentence_id: "s-w3",
            upper_base: "上半句",
            lower_base: "下半句",
            upper_value: "上半句已编辑",
            lower_value: "下半句",
        }
    }

    #[test]
    fn merge_removes_the_pin_collapses_all_languages_and_invalidates_alignments() {
        let mut doc = fixture();
        let outcome = merge_translation_paragraphs(&mut doc, request()).unwrap();
        assert_eq!(outcome.sentence_id, "s-w1");
        assert_eq!(outcome.removed_paragraph_pin, "w3");
        assert_eq!(outcome.merged_text, "上半句已编辑下半句");
        assert!(!doc.para_breaks.contains_key("w3"));
        assert_eq!(doc.trans["zh"]["s-w1"], "上半句已编辑下半句");
        assert!(!doc.trans["zh"].contains_key("s-w3"));
        assert_eq!(doc.trans["fr"]["s-w1"], "première suite");
        assert!(!doc.trans["fr"].contains_key("s-w3"));
        for language in ["zh", "fr"] {
            assert!(!doc.trans_align[language].contains_key("s-w1"));
            assert!(!doc.trans_align[language].contains_key("s-w3"));
            assert_eq!(doc.trans_src[language]["s-w1"], "upper-stamp");
            assert!(!doc.trans_src[language].contains_key("s-w3"));
        }
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        assert_eq!(sentences.len(), 1);
        assert_eq!(sentences[0].id, "s-w1");
    }

    #[test]
    fn merge_rejects_stale_bases_without_mutating_the_document() {
        let mut doc = fixture();
        let before = doc.clone();
        let mut stale = request();
        stale.lower_base = "stale";
        assert_eq!(
            merge_translation_paragraphs(&mut doc, stale),
            Err(TranslationParagraphMergeError::LowerConflict)
        );
        assert_eq!(doc, before);
    }

    #[test]
    fn merge_refuses_every_normative_sentence_boundary() {
        let mut no_pin = fixture();
        no_pin.para_breaks.clear();
        assert_eq!(
            merge_translation_paragraphs(&mut no_pin, request()),
            Err(TranslationParagraphMergeError::SentenceMissing),
            "without the pin the two spans are already one Sentence"
        );

        let mut speaker = fixture();
        speaker.words[2].sp = "s2".to_owned();
        speaker.words[3].sp = "s2".to_owned();
        assert_eq!(
            merge_translation_paragraphs(&mut speaker, request()),
            Err(TranslationParagraphMergeError::SpeakerBoundary)
        );

        let mut punctuation = fixture();
        punctuation.words[1].text = "thought.".to_owned();
        assert_eq!(
            merge_translation_paragraphs(&mut punctuation, request()),
            Err(TranslationParagraphMergeError::SentenceEnding)
        );

        let mut gap = fixture();
        gap.words[2].t0 = gap.words[1].t1 + SENTENCE_HARD_GAP_SECONDS;
        gap.words[2].t1 = gap.words[2].t0 + 0.4;
        gap.words[3].t0 = gap.words[2].t1;
        gap.words[3].t1 = gap.words[3].t0 + 0.4;
        assert_eq!(
            merge_translation_paragraphs(&mut gap, request()),
            Err(TranslationParagraphMergeError::HardGap)
        );

        let mut chapter = fixture();
        chapter.chapters = vec![
            Chapter {
                id: "c1".to_owned(),
                title: "One".to_owned(),
                start: 0.0,
                end: 0.9,
            },
            Chapter {
                id: "c2".to_owned(),
                title: "Two".to_owned(),
                start: 0.9,
                end: 20.0,
            },
        ];
        assert_eq!(
            merge_translation_paragraphs(&mut chapter, request()),
            Err(TranslationParagraphMergeError::ChapterBoundary)
        );

        let mut long = fixture();
        long.words.clear();
        for index in 0..81 {
            long.words.push(word(
                &format!("w{}", index + 1),
                index as f64 * 0.1,
                index as f64 * 0.1 + 0.09,
                if index == 80 { "end." } else { "word" },
            ));
        }
        long.para_breaks.clear();
        long.para_breaks.insert("w41".to_owned(), true);
        long.trans.clear();
        long.trans_align.clear();
        long.trans_src.clear();
        long.trans.insert(
            "zh".to_owned(),
            [
                ("s-w1".to_owned(), "上半句".to_owned()),
                ("s-w41".to_owned(), "下半句".to_owned()),
            ]
            .into_iter()
            .collect(),
        );
        let mut long_request = request();
        long_request.lower_sentence_id = "s-w41";
        assert_eq!(
            merge_translation_paragraphs(&mut long, long_request),
            Err(TranslationParagraphMergeError::TooManyWords)
        );
    }
}
