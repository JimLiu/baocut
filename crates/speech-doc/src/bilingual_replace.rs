//! 双语 Find & Replace 的源指纹收口。
//!
//! Mac `TranslateFindReplace.trReplaceMatches` 在同一撤销事务里先改译文、再改
//! 原文；只有同一语义段落的两侧都真的变化时，才为**编辑前已有 stamp 且仍
//! 新鲜**的源句确认新指纹。这个判断不能留给 UI，也不能用文档级“全部刷新”
//! 代替，否则会把早已过期、与本次替换无关的译文洗成 fresh。
//!
//! 源文本重铺还可能改掉 Sentence 首词 id。本模块在编辑前冻结句序与起点，
//! 编辑后只在二者仍吻合时把所有语言的句键状态重挂到新 id；这与 Mac
//! `editSpan` 保留首词 id 的可见结果等价，同时不要求宿主复制句级表结构。

use std::collections::{BTreeMap, BTreeSet};

use crate::cue::{derive_cues, derive_paras};
use crate::doc::TranscriptDoc;
use crate::layout_profile::cue_params_for_doc;
use crate::sentence::derive_sentences;

#[derive(Clone, Debug, PartialEq)]
struct SourceSentence {
    id: String,
    index: usize,
    start: f64,
}

#[derive(Clone, Debug, PartialEq)]
struct SyncCandidate {
    source: SourceSentence,
    paragraph: usize,
}

/// 编辑后句键重挂与源指纹确认的结果。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BilingualReplaceFinalize {
    pub rekeyed_sentences: usize,
    pub synced_stamps: usize,
}

/// 编辑前冻结的最小计划。宿主可先执行任意数量的译文与源文 CAS；全部成功后
/// 再调用 [`finalize`](Self::finalize)，失败事务则直接丢弃本值。
#[derive(Clone, Debug, Default, PartialEq)]
pub struct BilingualReplacePlan {
    language: Option<String>,
    source_sentences: Vec<SourceSentence>,
    sync_candidates: Vec<SyncCandidate>,
    target_paragraphs: BTreeSet<usize>,
}

impl BilingualReplacePlan {
    /// `source_word_ids` 是本批真的会改写的原文词跨度；`target_sentence_ids` 是
    /// 本批真的会改写的译文 Sentence（piece ref 要由宿主先去掉 `#N`）。
    /// `language = None` 仍会保留句键重挂，但不会确认任何 stamp。
    pub fn capture(
        doc: &TranscriptDoc,
        language: Option<&str>,
        source_word_ids: &[String],
        target_sentence_ids: &[String],
    ) -> Self {
        if source_word_ids.is_empty() {
            return Self::default();
        }
        let cues = derive_cues(doc, &cue_params_for_doc(doc));
        let sentences = derive_sentences(doc, &cues);
        let paras = derive_paras(doc, &cues);
        let source_ids: BTreeSet<&str> = source_word_ids.iter().map(String::as_str).collect();
        let target_ids: BTreeSet<&str> = target_sentence_ids.iter().map(String::as_str).collect();

        // Mac `paragraphPairs` 用严格时间相交，并在一个组意外跨段时以后一个段
        // 覆盖前一个段。按段落顺序反复 insert 即得到相同归属。
        let mut paragraph_of_sentence = BTreeMap::new();
        for (paragraph_index, paragraph) in paras.iter().enumerate() {
            let Some(first) = paragraph
                .cue_indices
                .first()
                .and_then(|index| cues.get(*index))
            else {
                continue;
            };
            let Some(last) = paragraph
                .cue_indices
                .last()
                .and_then(|index| cues.get(*index))
            else {
                continue;
            };
            for (sentence_index, sentence) in sentences.iter().enumerate() {
                if sentence.start(doc) < last.end && sentence.end(doc) > first.start {
                    paragraph_of_sentence.insert(sentence_index, paragraph_index);
                }
            }
        }

        let target_paragraphs = sentences
            .iter()
            .enumerate()
            .filter(|(_, sentence)| target_ids.contains(sentence.id.as_str()))
            .filter_map(|(index, _)| paragraph_of_sentence.get(&index).copied())
            .collect::<BTreeSet<_>>();

        let language = language.map(str::to_owned);
        let mut source_sentences = Vec::new();
        let mut sync_candidates = Vec::new();
        for (index, sentence) in sentences.iter().enumerate() {
            if !sentence
                .word_indices
                .iter()
                .filter_map(|word_index| doc.words.get(*word_index))
                .any(|word| source_ids.contains(word.id.as_str()))
            {
                continue;
            }
            let source = SourceSentence {
                id: sentence.id.clone(),
                index,
                start: sentence.start(doc),
            };
            source_sentences.push(source.clone());

            let Some(language) = language.as_deref() else {
                continue;
            };
            let Some(paragraph) = paragraph_of_sentence.get(&index).copied() else {
                continue;
            };
            let translated = doc
                .trans
                .get(language)
                .and_then(|table| table.get(&sentence.id))
                .is_some_and(|text| !text.trim().is_empty());
            let fresh_stamp = doc
                .trans_src
                .get(language)
                .and_then(|table| table.get(&sentence.id))
                .is_some_and(|stamp| stamp == &sentence.src_fingerprint);
            if translated && fresh_stamp {
                sync_candidates.push(SyncCandidate { source, paragraph });
            }
        }

        Self {
            language,
            source_sentences,
            sync_candidates,
            target_paragraphs,
        }
    }

    /// 全部文本操作成功后收口。句序或起点已变化的候选一律放弃，不猜归属。
    pub fn finalize(self, doc: &mut TranscriptDoc) -> BilingualReplaceFinalize {
        if self.source_sentences.is_empty() {
            return BilingualReplaceFinalize::default();
        }
        let cues = derive_cues(doc, &cue_params_for_doc(doc));
        let sentences = derive_sentences(doc, &cues)
            .into_iter()
            .map(|sentence| {
                let start = sentence.start(doc);
                (sentence.id, sentence.src_fingerprint, start)
            })
            .collect::<Vec<_>>();
        let live_for = |source: &SourceSentence| {
            sentences
                .get(source.index)
                .filter(|(_, _, start)| (*start - source.start).abs() < 0.001)
        };

        let moves = self
            .source_sentences
            .iter()
            .filter_map(|source| {
                let live = live_for(source)?;
                (live.0 != source.id).then(|| (source.id.clone(), live.0.clone()))
            })
            .collect::<Vec<_>>();
        if !moves.is_empty() {
            rekey_nested(&mut doc.trans, &moves);
            rekey_nested(&mut doc.trans_display, &moves);
            rekey_nested(&mut doc.trans_align, &moves);
            rekey_nested(&mut doc.trans_src, &moves);
        }

        let mut synced_stamps = 0;
        if let Some(language) = self.language {
            for candidate in self.sync_candidates {
                if !self.target_paragraphs.contains(&candidate.paragraph) {
                    continue;
                }
                let Some(live) = live_for(&candidate.source) else {
                    continue;
                };
                let translated = doc
                    .trans
                    .get(&language)
                    .and_then(|table| table.get(&live.0))
                    .is_some_and(|text| !text.trim().is_empty());
                if !translated {
                    continue;
                }
                doc.trans_src
                    .entry(language.clone())
                    .or_default()
                    .insert(live.0.clone(), live.1.clone());
                synced_stamps += 1;
            }
        }

        BilingualReplaceFinalize {
            rekeyed_sentences: moves.len(),
            synced_stamps,
        }
    }
}

fn rekey_nested<T>(tables: &mut BTreeMap<String, BTreeMap<String, T>>, moves: &[(String, String)]) {
    for table in tables.values_mut() {
        // 先全部 remove、后全部 insert，避免 A→B、B→C 之类的键链吞值。
        let moved = moves
            .iter()
            .filter_map(|(old, new)| table.remove(old).map(|value| (new.clone(), value)))
            .collect::<Vec<_>>();
        for (new, value) in moved {
            table.insert(new, value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{DocEngine, DocMedia, Speaker, Word};
    use crate::sentence::stale_sentences;

    fn word(id: &str, t0: f64, text: &str) -> Word {
        Word {
            id: id.to_owned(),
            t0,
            t1: t0 + 0.4,
            text: text.to_owned(),
            sp: "s1".to_owned(),
            glue: false,
        }
    }

    fn doc() -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: None,
                hash: "sha256-00".to_owned(),
                duration: 8.0,
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
        doc.words = vec![
            word("w0", 0.0, "Hello."),
            word("w1", 0.5, "Next."),
            word("w2", 1.0, "Last."),
        ];
        let cues = derive_cues(&doc, &cue_params_for_doc(&doc));
        let sentences = derive_sentences(&doc, &cues);
        for (index, sentence) in sentences.iter().enumerate() {
            doc.trans
                .entry("zh".to_owned())
                .or_default()
                .insert(sentence.id.clone(), format!("译文{index}"));
            doc.trans_src
                .entry("zh".to_owned())
                .or_default()
                .insert(sentence.id.clone(), sentence.src_fingerprint.clone());
        }
        doc
    }

    #[test]
    fn same_paragraph_bilingual_change_rekeys_and_refreshes_only_fresh_source_sentence() {
        let mut doc = doc();
        let cues = derive_cues(&doc, &cue_params_for_doc(&doc));
        let sentences = derive_sentences(&doc, &cues);
        let old = sentences[0].id.clone();
        let plan = BilingualReplacePlan::capture(
            &doc,
            Some("zh"),
            &[doc.words[0].id.clone()],
            &[sentences[1].id.clone()],
        );

        doc.words[0].id = "fresh-0".to_owned();
        doc.words[0].text = "Greetings.".to_owned();
        let outcome = plan.finalize(&mut doc);
        assert_eq!(outcome.rekeyed_sentences, 1);
        assert_eq!(outcome.synced_stamps, 1);

        let cues = derive_cues(&doc, &cue_params_for_doc(&doc));
        let sentences = derive_sentences(&doc, &cues);
        let live = &sentences[0];
        assert_ne!(live.id, old);
        assert_eq!(doc.trans["zh"][&live.id], "译文0");
        assert!(!doc.trans["zh"].contains_key(&old));
        assert_eq!(doc.trans_src["zh"][&live.id], live.src_fingerprint);
        assert!(stale_sentences(&doc, "zh", &sentences).is_empty());
    }

    #[test]
    fn preexisting_stale_stamp_is_rekeyed_but_never_washed_fresh() {
        let mut doc = doc();
        let cues = derive_cues(&doc, &cue_params_for_doc(&doc));
        let sentences = derive_sentences(&doc, &cues);
        doc.trans_src
            .get_mut("zh")
            .unwrap()
            .insert(sentences[0].id.clone(), "already-stale".to_owned());
        let plan = BilingualReplacePlan::capture(
            &doc,
            Some("zh"),
            &[doc.words[0].id.clone()],
            &[sentences[1].id.clone()],
        );

        doc.words[0].text = "Greetings.".to_owned();
        let outcome = plan.finalize(&mut doc);
        assert_eq!(outcome.synced_stamps, 0);
        let cues = derive_cues(&doc, &cue_params_for_doc(&doc));
        let sentences = derive_sentences(&doc, &cues);
        assert!(stale_sentences(&doc, "zh", &sentences).contains(&sentences[0].id));
    }

    #[test]
    fn different_paragraph_target_does_not_acknowledge_source_change() {
        let mut doc = doc();
        doc.para_breaks.insert("w1".to_owned(), true);
        let cues = derive_cues(&doc, &cue_params_for_doc(&doc));
        let sentences = derive_sentences(&doc, &cues);
        let plan = BilingualReplacePlan::capture(
            &doc,
            Some("zh"),
            &[doc.words[0].id.clone()],
            &[sentences[1].id.clone()],
        );
        doc.words[0].text = "Greetings.".to_owned();
        let outcome = plan.finalize(&mut doc);
        assert_eq!(outcome.synced_stamps, 0);
    }
}
