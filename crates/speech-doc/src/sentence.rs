//! 句子派生（v0.3 §3，规范性算法）。
//!
//! Sentence 是翻译与对齐的单位：源句 1:1 译句。它直接从可见词序列派生，
//! 不落盘；`trans` / `transSrc` / `transAlign` 以句 id（`s-<首词id>`）为键。
//! 源 Cue 只在最后回填展示元数据，不能参与句界、翻译或对齐语义。

use std::collections::BTreeSet;

use crate::cue::{Cue, join_words};
use crate::doc::{TranscriptDoc, Word};
use crate::fingerprint::fingerprint;

/// 句内词数封顶（无标点长流的兜底启发式）。
///
/// 翻译组允许覆盖多个展示 Cue；阈值过小会把语义完整的长句硬切在介词、助词或
/// 谓语中间。80 词仍远低于单页 LLM 预算，同时能覆盖口语中的长解释句。
pub const SENTENCE_MAX_WORDS: usize = 80;
/// 无句末标点时，足以单独封句的强停顿阈值（秒）。
///
/// 0.6s 仍用于 Cue 展示断行和 LLM 软标记，但不能兼任语义句界；自然说话在
/// 词组内部常有 0.6–1.2s 的思考停顿。1.8s 对齐 pause marker 的“长停顿”档。
pub const SENTENCE_HARD_GAP_SECONDS: f64 = 1.8;

/// 句子 = 1..N 个连续可见词。翻译、脏检测与对齐的单位。
#[derive(Debug, Clone, PartialEq)]
pub struct Sentence {
    /// `"s-" + 首词 id`——首词不变则跨重派生稳定。
    pub id: String,
    pub cue_ids: Vec<String>,
    /// 指回传入的 cues 切片。
    pub cue_indices: Vec<usize>,
    /// 指回 `doc.words`（句内全部非 hidden 词）。
    pub word_indices: Vec<usize>,
    pub source_text: String,
    /// 句内词切片的内容指纹——`transSrc` 脏检测的基准。
    pub src_fingerprint: String,
}

impl Sentence {
    /// 句时间窗直接来自句内词，不继承源字幕 Cue 的展示边界。
    pub fn start(&self, doc: &TranscriptDoc) -> f64 {
        doc.words[self.word_indices[0]].t0
    }

    /// 句时间窗直接来自句内词，不继承源字幕 Cue 的展示边界。
    pub fn end(&self, doc: &TranscriptDoc) -> f64 {
        doc.words[*self.word_indices.last().expect("sentence non-empty")].t1
    }

    pub fn word_start(&self, doc: &TranscriptDoc) -> f64 {
        self.start(doc)
    }

    pub fn word_end(&self, doc: &TranscriptDoc) -> f64 {
        self.end(doc)
    }
}

/// 句派生：直接顺扫可见词。封口条件（任一满足即封）：
/// 1. 末词 `sentence_end`；2. 与下一词间 gap ≥ 1.8s；3. 说话人切换；
/// 4. 句内词数 ≥ 80；5. 下一词被 `paraBreaks` 钉住（段落边界）；
/// 6. 下一词跨章节边界。`cues` 只回填 `cue_ids/cue_indices` 展示元数据，
/// 改动源字幕 `breaks` 不得改变句 id、词区间、文本或指纹。
pub fn derive_sentences(doc: &TranscriptDoc, cues: &[Cue]) -> Vec<Sentence> {
    let chapter_of = |t: f64| -> usize {
        doc.chapters
            .iter()
            .position(|chapter| t >= chapter.start && t < chapter.end)
            .unwrap_or(usize::MAX)
    };

    let visible: Vec<usize> = (0..doc.words.len())
        .filter(|index| !doc.words[*index].id.is_empty())
        .filter(|index| {
            !doc.hidden
                .get(&doc.words[*index].id)
                .copied()
                .unwrap_or(false)
        })
        .collect();
    let mut cue_by_word = vec![None; doc.words.len()];
    for (cue_index, cue) in cues.iter().enumerate() {
        for &word_index in &cue.word_indices {
            cue_by_word[word_index] = Some(cue_index);
        }
    }

    let mut sentences = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    for (position, &word_index) in visible.iter().enumerate() {
        current.push(word_index);
        let word = &doc.words[word_index];
        let next = visible
            .get(position + 1)
            .map(|&next_index| &doc.words[next_index]);
        let close = crate::atomize::sentence_end(&word.text)
            || current.len() >= SENTENCE_MAX_WORDS
            || next.is_none_or(|next| {
                next.t0 - word.t1 >= SENTENCE_HARD_GAP_SECONDS
                    || next.sp != word.sp
                    || doc.para_breaks.get(&next.id).copied().unwrap_or(false)
                    || chapter_of(next.t0) != chapter_of(word.t0)
            });
        if close {
            let word_indices = std::mem::take(&mut current);
            let cue_indices: Vec<usize> = word_indices
                .iter()
                .filter_map(|&index| cue_by_word[index])
                .fold(Vec::new(), |mut indices, index| {
                    if indices.last() != Some(&index) {
                        indices.push(index);
                    }
                    indices
                });
            let cue_ids = cue_indices
                .iter()
                .map(|&index| cues[index].id.clone())
                .collect();
            let words: Vec<Word> = word_indices
                .iter()
                .map(|&word_index| doc.words[word_index].clone())
                .collect();
            let first_word = words.first().expect("sentence non-empty");
            sentences.push(Sentence {
                id: format!("s-{}", first_word.id),
                cue_ids,
                cue_indices,
                source_text: join_words(words.iter()),
                src_fingerprint: fingerprint(&words),
                word_indices,
            });
        }
    }
    sentences
}

/// 句级脏检测：`transSrc[lang][id]` 存在且 ≠ 当前指纹 ⇒ stale。
/// **无 stamp 不算 stale**——从未在新机制下翻过的数据不被误伤。
pub fn stale_sentences(
    doc: &TranscriptDoc,
    lang: &str,
    sentences: &[Sentence],
) -> BTreeSet<String> {
    let Some(stamps) = doc.trans_src.get(lang) else {
        return BTreeSet::new();
    };
    sentences
        .iter()
        .filter(|sentence| {
            stamps
                .get(&sentence.id)
                .is_some_and(|stamp| stamp != &sentence.src_fingerprint)
        })
        .map(|sentence| sentence.id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cue::{CueParams, derive_cues};
    use crate::doc::{Chapter, DocEngine, DocMedia, Speaker};

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
        for sp in ["s1", "s2"] {
            doc.speakers.insert(
                sp.to_owned(),
                Speaker {
                    name: sp.to_uppercase(),
                    hue: None,
                },
            );
        }
        doc.words = words;
        doc
    }

    fn w(id: &str, t0: f64, t1: f64, text: &str, sp: &str) -> Word {
        Word {
            id: id.to_owned(),
            t0,
            t1,
            text: text.to_owned(),
            sp: sp.to_owned(),
            glue: false,
        }
    }

    /// 句1 = 两 Cue（"echo," 处 pause_punct 断行 / "hotel." 句末）；
    /// 句2 = 单 Cue "Done."。
    fn two_sentence_doc() -> TranscriptDoc {
        doc_with_words(vec![
            w("g1.0", 0.0, 0.4, "alpha", "s1"),
            w("g1.1", 0.4, 0.8, "bravo", "s1"),
            w("g1.2", 0.8, 1.2, "charlie", "s1"),
            w("g1.3", 1.2, 1.6, "delta", "s1"),
            w("g1.4", 1.6, 2.0, "echo,", "s1"),
            w("g1.5", 2.0, 2.4, "foxtrot", "s1"),
            w("g1.6", 2.4, 2.8, "golf", "s1"),
            w("g1.7", 2.8, 3.2, "hotel.", "s1"),
            w("g2.0", 3.4, 3.8, "Done.", "s1"),
        ])
    }

    #[test]
    fn sentences_close_on_sentence_end_and_pack_multiple_cues() {
        let doc = two_sentence_doc();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        assert_eq!(sentences.len(), 2);
        assert_eq!(sentences[0].id, "s-g1.0");
        assert_eq!(sentences[0].cue_ids, vec!["q-g1.0", "q-g1.5"]);
        assert_eq!(
            sentences[0].source_text,
            "alpha bravo charlie delta echo, foxtrot golf hotel."
        );
        assert_eq!(sentences[1].id, "s-g2.0");
        assert!(sentences[0].src_fingerprint.starts_with("8:g1.0:g1.7:"));
    }

    #[test]
    fn sentences_distinguish_display_pauses_from_semantic_boundaries() {
        // 0.8s 会让 Cue 断行，但不应把同一个语义句拆成两个翻译组。
        let doc = doc_with_words(vec![
            w("g1.0", 0.0, 0.3, "one", "s1"),
            w("g1.1", 0.3, 0.6, "two", "s1"),
            w("g1.2", 0.6, 0.9, "three", "s1"),
            w("g1.3", 0.9, 1.2, "four", "s1"),
            w("g1.4", 1.2, 1.5, "five", "s1"),
            w("g1.5", 1.5, 1.8, "six,", "s1"),
            w("g1.6", 2.6, 2.9, "seven", "s1"),
            w("g1.7", 2.9, 3.2, "eight.", "s1"),
        ]);
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(cues.len(), 2);
        assert_eq!(derive_sentences(&doc, &cues).len(), 1);

        // 1.8s 以上的强停顿即使没有句末标点，也足以封句。
        let mut doc = doc_with_words(vec![
            w("g1.0", 0.0, 0.4, "first", "s1"),
            w("g1.1", 0.4, 0.8, "thought", "s1"),
            w("g1.2", 2.6, 3.0, "second", "s1"),
            w("g1.3", 3.0, 3.4, "thought.", "s1"),
        ]);
        doc.breaks
            .insert("g1.1".to_owned(), crate::doc::BreakOverride::Break);
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(derive_sentences(&doc, &cues).len(), 2);
    }

    #[test]
    fn source_cue_reflow_does_not_change_sentence_semantics() {
        let mut doc = two_sentence_doc();
        let baseline_cues = derive_cues(&doc, &CueParams::default());
        let baseline = derive_sentences(&doc, &baseline_cues);

        doc.breaks
            .insert("g1.2".to_owned(), crate::doc::BreakOverride::Break);
        let reflowed_cues = derive_cues(&doc, &CueParams::default());
        assert_ne!(
            baseline_cues, reflowed_cues,
            "fixture must reflow source cues"
        );
        let reflowed = derive_sentences(&doc, &reflowed_cues);

        let semantic = |sentences: &[Sentence]| {
            sentences
                .iter()
                .map(|sentence| {
                    (
                        sentence.id.clone(),
                        sentence.word_indices.clone(),
                        sentence.source_text.clone(),
                        sentence.src_fingerprint.clone(),
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(semantic(&baseline), semantic(&reflowed));
        assert_ne!(baseline[0].cue_ids, reflowed[0].cue_ids);
    }

    #[test]
    fn sentences_close_on_speaker_switch_and_word_cap() {
        let doc = doc_with_words(vec![
            w("g1.0", 0.0, 0.4, "good", "s1"),
            w("g2.0", 0.5, 0.9, "day", "s2"),
        ]);
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(derive_sentences(&doc, &cues).len(), 2);

        let words: Vec<Word> = (0..82)
            .map(|i| {
                w(
                    &format!("g1.{i}"),
                    i as f64 * 0.3,
                    i as f64 * 0.3 + 0.3,
                    "word",
                    "s1",
                )
            })
            .collect();
        let doc = doc_with_words(words);
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        assert_eq!(sentences.len(), 2);
        assert!(sentences[0].word_indices.len() >= SENTENCE_MAX_WORDS);
        assert_eq!(
            sentences
                .iter()
                .map(|sentence| sentence.word_indices.len())
                .sum::<usize>(),
            82
        );
    }

    #[test]
    fn medium_pauses_do_not_fragment_agent_definition() {
        // 来自 “What is an Agentic Harness (2)” 的真实失败形态：
        // tools→running 0.62s，accomplish→a goal 1.08s。
        let doc = doc_with_words(vec![
            w("g2.0", 0.00, 0.20, "An", "s1"),
            w("g2.1", 0.20, 0.55, "agent", "s1"),
            w("g2.2", 0.55, 0.70, "is", "s1"),
            w("g2.3", 0.70, 0.85, "an", "s1"),
            w("g2.4", 0.85, 1.10, "LLM", "s1"),
            w("g2.5", 1.10, 1.35, "with", "s1"),
            w("g2.6", 1.35, 1.60, "tools", "s1"),
            w("g2.7", 2.22, 2.45, "running", "s1"),
            w("g2.8", 2.45, 2.60, "in", "s1"),
            w("g2.9", 2.60, 2.70, "a", "s1"),
            w("g2.10", 2.70, 2.95, "loop", "s1"),
            w("g2.11", 2.95, 3.10, "to", "s1"),
            w("g2.12", 3.10, 3.50, "accomplish", "s1"),
            w("g2.13", 4.58, 4.68, "a", "s1"),
            w("g2.14", 4.68, 5.00, "goal.", "s1"),
        ]);
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(cues.len(), 3, "展示层仍应按两个中停顿拆成三个 Cue");
        let sentences = derive_sentences(&doc, &cues);
        assert_eq!(sentences.len(), 1, "翻译层必须保留完整语义句");
        assert_eq!(
            sentences[0].source_text,
            "An agent is an LLM with tools running in a loop to accomplish a goal."
        );
    }

    #[test]
    fn para_pin_and_chapter_boundary_close_sentences() {
        // 无标点、无停顿的同说话人流；仅段落钉逼出句边界。
        let mut doc = doc_with_words(vec![
            w("g1.0", 0.0, 0.4, "alpha", "s1"),
            w("g1.1", 0.4, 0.8, "bravo,", "s1"),
            w("g1.2", 0.8, 1.2, "charlie", "s1"),
            w("g1.3", 1.2, 1.6, "delta", "s1"),
        ]);
        // "bravo," 处让 Cue 断行（pause_punct 需要 min_pause_chars=20——用手工 break）。
        doc.breaks
            .insert("g1.1".to_owned(), crate::doc::BreakOverride::Break);
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(cues.len(), 2);
        assert_eq!(derive_sentences(&doc, &cues).len(), 1);

        doc.para_breaks.insert("g1.2".to_owned(), true);
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        assert_eq!(sentences.len(), 2, "段落钉必须封句");
        assert_eq!(sentences[1].id, "s-g1.2");

        doc.para_breaks.clear();
        // 章节边界正落在 Cue 2 起点（g1.2 t0=0.8）。
        doc.chapters = vec![
            Chapter {
                id: "c1".to_owned(),
                title: "A".to_owned(),
                start: 0.0,
                end: 0.8,
            },
            Chapter {
                id: "c2".to_owned(),
                title: "B".to_owned(),
                start: 0.8,
                end: 2.0,
            },
        ];
        let cues = derive_cues(&doc, &CueParams::default());
        assert_eq!(derive_sentences(&doc, &cues).len(), 2, "章节边界必须封句");
    }

    #[test]
    fn stale_requires_existing_mismatched_stamp() {
        let mut doc = two_sentence_doc();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        assert!(stale_sentences(&doc, "zh", &sentences).is_empty());
        doc.trans_src
            .entry("zh".to_owned())
            .or_default()
            .insert("s-g1.0".to_owned(), "outdated".to_owned());
        let stale = stale_sentences(&doc, "zh", &sentences);
        assert_eq!(stale.into_iter().collect::<Vec<_>>(), vec!["s-g1.0"]);
        doc.trans_src
            .get_mut("zh")
            .unwrap()
            .insert("s-g1.0".to_owned(), sentences[0].src_fingerprint.clone());
        assert!(stale_sentences(&doc, "zh", &sentences).is_empty());
    }
}
