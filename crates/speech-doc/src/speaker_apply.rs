//! 说话人整篇提案的确定性应用。
//!
//! `bcut speakers reidentify --review` 只生成 `wordSp` 与候选说话人表；本层把
//! 它们一次性落进 [`TranscriptDoc`]，并在新增说话人边界切开句子时按目标语
//! 自然缝重分配已有译文。I/O、项目锁、history 与提案文件生命周期由 CLI host
//! 负责。

use std::collections::{BTreeMap, BTreeSet};

use anyhow::Result;
use serde::Serialize;

use crate::atomize::{is_unspaced_cjk_char, visual_width};
use crate::cue::derive_cues;
use crate::doc::{Speaker, TranscriptDoc};
use crate::sentence::{Sentence, derive_sentences};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerApplyReport {
    pub relabeled: usize,
    pub para_pins_added: Vec<String>,
    pub sentences_split: Vec<String>,
    pub translations_split: BTreeMap<String, Vec<String>>,
}

/// 应用一次整篇说话人提案。纯改名/纯 relabel 且相邻说话人等价关系未变时，
/// 译文、对齐与结构覆盖表保持逐字段不变。
pub fn apply_speaker_proposal(
    doc: &mut TranscriptDoc,
    word_sp: &BTreeMap<String, String>,
    proposed_speakers: &BTreeMap<String, Speaker>,
    protected_terms: &[String],
) -> Result<SpeakerApplyReport> {
    let mut report = SpeakerApplyReport::default();
    let old_doc = doc.clone();
    let old_cues = derive_cues(
        &old_doc,
        &crate::layout_profile::cue_params_for_doc(&old_doc),
    );
    let old_sentences = derive_sentences(&old_doc, &old_cues);
    let mut new_speakers = old_doc
        .words
        .iter()
        .map(|word| word.sp.clone())
        .collect::<Vec<_>>();
    for (index, word) in old_doc.words.iter().enumerate() {
        if let Some(speaker) = word_sp.get(&word.id)
            && speaker != &word.sp
        {
            new_speakers[index] = speaker.clone();
            report.relabeled += 1;
        }
    }

    let boundary_changed = old_doc.words.len() > 1
        && (0..old_doc.words.len() - 1).any(|index| {
            (old_doc.words[index].sp != old_doc.words[index + 1].sp)
                != (new_speakers[index] != new_speakers[index + 1])
        });

    // v0.3 没有独立 transBreaks；若一次 merge 会吞掉已有的翻译句界，使用
    // paraBreaks 钉住同一词边界。已经完成语义分段的文档也必须保留旧段界。
    if boundary_changed {
        let sentence_by_word = sentence_index_by_word(old_doc.words.len(), &old_sentences);
        for index in 0..old_doc.words.len().saturating_sub(1) {
            if old_doc.words[index].sp == old_doc.words[index + 1].sp
                || new_speakers[index] != new_speakers[index + 1]
            {
                continue;
            }
            let translated = sentence_by_word[index]
                .into_iter()
                .chain(sentence_by_word[index + 1])
                .any(|sentence_index| {
                    let id = &old_sentences[sentence_index].id;
                    old_doc
                        .trans
                        .values()
                        .any(|table| table.get(id).is_some_and(|text| !text.trim().is_empty()))
                });
            if (old_doc.stages.segment.is_some() || translated)
                && !doc
                    .para_breaks
                    .get(&old_doc.words[index + 1].id)
                    .copied()
                    .unwrap_or(false)
            {
                let id = old_doc.words[index + 1].id.clone();
                doc.para_breaks.insert(id.clone(), true);
                report.para_pins_added.push(id);
            }
        }
    }

    for (word, speaker) in doc.words.iter_mut().zip(new_speakers) {
        word.sp = speaker;
    }
    let used = doc
        .words
        .iter()
        .map(|word| word.sp.clone())
        .collect::<BTreeSet<_>>();
    let mut installed = BTreeMap::new();
    for id in used {
        let speaker = proposed_speakers
            .get(&id)
            .or_else(|| old_doc.speakers.get(&id))
            .ok_or_else(|| anyhow::anyhow!("说话人提案引用未知 id：{id}"))?;
        installed.insert(id, speaker.clone());
    }
    doc.speakers = installed;

    if !boundary_changed {
        return Ok(report);
    }

    let new_cues = derive_cues(doc, &crate::layout_profile::cue_params_for_doc(doc));
    let new_sentences = derive_sentences(doc, &new_cues);
    let new_ranges = new_sentences.iter().map(sentence_range).collect::<Vec<_>>();
    for old_sentence in &old_sentences {
        let old_range = sentence_range(old_sentence);
        let children = new_sentences
            .iter()
            .zip(&new_ranges)
            .filter(|(_, range)| range.0 >= old_range.0 && range.1 <= old_range.1)
            .map(|(sentence, _)| sentence)
            .collect::<Vec<_>>();
        if children.len() <= 1
            || children.first().map(|child| sentence_range(child).0) != Some(old_range.0)
            || children.last().map(|child| sentence_range(child).1) != Some(old_range.1)
        {
            continue;
        }
        let weights = children
            .iter()
            .map(|sentence| visual_width(&sentence.source_text).max(1) as f64)
            .collect::<Vec<_>>();
        let languages = doc.trans.keys().cloned().collect::<Vec<_>>();
        let mut split_any = false;
        for language in languages {
            let original = doc
                .trans
                .get(&language)
                .and_then(|table| table.get(&old_sentence.id))
                .map(|text| text.trim().to_owned())
                .filter(|text| !text.is_empty());
            let Some(original) = original else {
                continue;
            };
            split_any = true;
            let pieces = split_translation_text(&original, &weights, protected_terms);
            let table = doc.trans.entry(language.clone()).or_default();
            table.remove(&old_sentence.id);
            let stamps = doc.trans_src.entry(language.clone()).or_default();
            stamps.remove(&old_sentence.id);
            doc.trans_align
                .entry(language.clone())
                .or_default()
                .remove(&old_sentence.id);
            for (child, piece) in children.iter().zip(pieces) {
                if piece.is_empty() {
                    continue;
                }
                table.insert(child.id.clone(), piece);
                stamps.insert(child.id.clone(), child.src_fingerprint.clone());
                report
                    .translations_split
                    .entry(language.clone())
                    .or_default()
                    .push(child.id.clone());
            }
        }
        if split_any {
            report.sentences_split.push(old_sentence.id.clone());
        }
    }
    doc.validate()?;
    Ok(report)
}

fn sentence_range(sentence: &Sentence) -> (usize, usize) {
    (
        sentence.word_indices[0],
        *sentence.word_indices.last().expect("sentence non-empty"),
    )
}

fn sentence_index_by_word(word_count: usize, sentences: &[Sentence]) -> Vec<Option<usize>> {
    let mut lookup = vec![None; word_count];
    for (sentence_index, sentence) in sentences.iter().enumerate() {
        for &word_index in &sentence.word_indices {
            lookup[word_index] = Some(sentence_index);
        }
    }
    lookup
}

/// 按目标长度比例选择最近的自然缝；标点优先，其次空白/CJK 边界，并保证
/// glossary 词不被切开。输出长度恒等于 `weights.len()`。
pub fn split_translation_text(
    input: &str,
    weights: &[f64],
    protected_terms: &[String],
) -> Vec<String> {
    let text = input.trim();
    if weights.is_empty() {
        return Vec::new();
    }
    if weights.len() == 1 {
        return vec![text.to_owned()];
    }
    if text.is_empty() {
        return vec![String::new(); weights.len()];
    }
    let chars = text.chars().collect::<Vec<_>>();
    let sentence_ends = ".!?。！？；;：:\n".chars().collect::<BTreeSet<_>>();
    let openers = "([{（［｛【〔「『〈《“‘".chars().collect::<BTreeSet<_>>();
    let closers = ")]}）］｝】〕」』〉》”’".chars().collect::<BTreeSet<_>>();
    let mut protected_cuts = BTreeSet::new();
    for term in protected_terms.iter().filter(|term| !term.is_empty()) {
        let needle = term.chars().collect::<Vec<_>>();
        if needle.len() >= chars.len() {
            continue;
        }
        let mut start = 0;
        while start + needle.len() <= chars.len() {
            if chars[start..start + needle.len()] == needle {
                protected_cuts.extend(start + 1..start + needle.len());
                start += needle.len();
            } else {
                start += 1;
            }
        }
    }
    let rank = |cut: usize| -> Option<usize> {
        if cut == 0 || cut >= chars.len() || protected_cuts.contains(&cut) {
            return None;
        }
        let left = chars[cut - 1];
        let right = chars[cut];
        // 汉字 / 假名之间哪里都能切；别的文字（含谚文）只在空白处切。
        let latin = |value: char| value.is_alphanumeric() && !is_unspaced_cjk_char(value);
        if openers.contains(&left) || closers.contains(&right) || (latin(left) && latin(right)) {
            return None;
        }
        if sentence_ends.contains(&left) {
            Some(0)
        } else if left.is_whitespace() || right.is_whitespace() {
            Some(1)
        } else if is_unspaced_cjk_char(left) || is_unspaced_cjk_char(right) {
            Some(2)
        } else {
            None
        }
    };

    let total = weights
        .iter()
        .map(|weight| weight.max(0.000_001))
        .sum::<f64>();
    let mut cumulative = 0.0;
    let mut previous = 0;
    let mut cuts = Vec::new();
    for weight in weights.iter().take(weights.len() - 1) {
        cumulative += weight.max(0.000_001);
        let target = (chars.len() as f64 * cumulative / total).round() as usize;
        let best = (previous + 1..chars.len())
            .filter_map(|cut| rank(cut).map(|rank| (cut, rank)))
            .min_by_key(|(cut, rank)| (cut.abs_diff(target) * 4 + rank, *cut));
        let Some((cut, _)) = best else {
            break;
        };
        cuts.push(cut);
        previous = cut;
    }
    let mut output = Vec::with_capacity(weights.len());
    let mut start = 0;
    for cut in cuts {
        output.push(
            chars[start..cut]
                .iter()
                .collect::<String>()
                .trim()
                .to_owned(),
        );
        start = cut;
    }
    output.push(chars[start..].iter().collect::<String>().trim().to_owned());
    output.resize(weights.len(), String::new());
    output.truncate(weights.len());
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cue::CueParams;
    use crate::doc::{DocEngine, DocMedia, Word};

    fn translated_doc() -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: None,
                hash: "sha256-test".to_owned(),
                duration: 4.0,
                sample_rate: None,
            },
            "zh",
            DocEngine {
                name: "test".to_owned(),
                version: None,
                aligned_words: true,
            },
        );
        for (id, name, hue) in [("s1", "Host", 222), ("s2", "Guest", 152)] {
            doc.speakers.insert(
                id.to_owned(),
                Speaker {
                    name: name.to_owned(),
                    hue: Some(hue),
                },
            );
        }
        doc.words = ["第一", "句。", "你", "好吗？"]
            .into_iter()
            .enumerate()
            .map(|(index, text)| Word {
                id: format!("w{}", index + 1),
                t0: index as f64,
                t1: index as f64 + 1.0,
                text: text.to_owned(),
                sp: "s1".to_owned(),
                glue: false,
            })
            .collect();
        let cues = derive_cues(&doc, &CueParams::default());
        let sentences = derive_sentences(&doc, &cues);
        assert_eq!(sentences.len(), 2);
        // 用一个无句末标点的 fixture 句覆盖 speaker 新边界拆译文。
        doc.words[1].text = "句，".to_owned();
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert("s-w1".to_owned(), "第一句。你好吗？".to_owned());
        doc
    }

    #[test]
    fn pure_relabel_keeps_translation_projection_untouched() {
        let mut doc = translated_doc();
        let original_trans = doc.trans.clone();
        let original_align = doc.trans_align.clone();
        let word_sp = doc
            .words
            .iter()
            .map(|word| (word.id.clone(), "s2".to_owned()))
            .collect();
        let speakers = doc.speakers.clone();
        let report = apply_speaker_proposal(&mut doc, &word_sp, &speakers, &[]).unwrap();
        assert_eq!(report.relabeled, 4);
        assert!(report.sentences_split.is_empty());
        assert_eq!(doc.trans, original_trans);
        assert_eq!(doc.trans_align, original_align);
        assert!(doc.words.iter().all(|word| word.sp == "s2"));
        assert_eq!(doc.speakers.keys().cloned().collect::<Vec<_>>(), vec!["s2"]);
    }

    #[test]
    fn new_speaker_boundary_splits_translation_without_retranslation() {
        let mut doc = translated_doc();
        let speakers = doc.speakers.clone();
        let word_sp = BTreeMap::from([
            ("w3".to_owned(), "s2".to_owned()),
            ("w4".to_owned(), "s2".to_owned()),
        ]);
        let report = apply_speaker_proposal(&mut doc, &word_sp, &speakers, &[]).unwrap();
        assert_eq!(report.sentences_split, vec!["s-w1"]);
        assert_eq!(doc.trans["zh"]["s-w1"], "第一句。");
        assert_eq!(doc.trans["zh"]["s-w3"], "你好吗？");
        assert_eq!(report.translations_split["zh"], ["s-w1", "s-w3"]);
        assert!(doc.trans_src["zh"].contains_key("s-w1"));
        assert!(doc.trans_src["zh"].contains_key("s-w3"));
    }

    #[test]
    fn translation_split_uses_natural_seams_and_keeps_terms_atomic() {
        assert_eq!(
            split_translation_text("第一句。你好吗？", &[1.0, 1.0], &[]),
            ["第一句。", "你好吗？"]
        );
        assert_eq!(
            split_translation_text("Hello there. How are you?", &[1.0, 1.0], &[]),
            ["Hello there.", "How are you?"]
        );
        let pieces = split_translation_text(
            "skill.md 很有用，请看文档。",
            &[1.0, 1.0],
            &["skill.md".to_owned()],
        );
        assert_eq!(pieces.len(), 2);
        assert!(pieces.iter().any(|piece| piece.contains("skill.md")));
        assert!(!pieces.iter().any(|piece| piece == "skill"));
    }

    /// 韩文译文只在空白处切，不切进어절。
    #[test]
    fn korean_translation_splits_at_spaces_only() {
        let text = "저는 내일 아이폰을 샀습니다";
        let pieces = split_translation_text(text, &[1.0, 1.0], &[]);
        assert_eq!(pieces.len(), 2, "{pieces:?}");
        assert_eq!(pieces.join(" "), text);
        let units: Vec<&str> = text.split(' ').collect();
        for piece in &pieces {
            for unit in piece.split(' ') {
                assert!(units.contains(&unit), "{pieces:?}");
            }
        }
    }
}
