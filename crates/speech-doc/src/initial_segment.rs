//! ASR row → 初始软段落计划。
//!
//! 计划只是一份可提升的投影：调用方可把成对边界注入文档克隆体，但不得在
//! 转录完成时写进 `transcript.json` 或提前盖 `stages.segment`。

use crate::asr_rows::{RowIn, RowSegmentation};
use serde::Serialize;

use crate::atomize::is_cjk_char;
use crate::doc::TranscriptDoc;
use crate::fingerprint::id_fingerprint;
use crate::row_mapping::{RowWordMap, row_word_maps, sorted_nonempty_rows};

pub const MIN_PARAGRAPH_SECONDS: f64 = 8.0;
pub const MIN_CJK_CHARS: usize = 24;
pub const MIN_LATIN_WORDS: usize = 12;
pub const TARGET_PARAGRAPH_SECONDS: f64 = 20.0;
pub const MAX_PARAGRAPH_SECONDS: f64 = 45.0;
pub const MAX_CJK_CHARS: usize = 240;
pub const MAX_LATIN_WORDS: usize = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BoundaryStrength {
    SentenceLongPause,
    Sentence,
    Pause,
    Clause,
    Segment,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BoundaryEvidence {
    SentenceEnd,
    LongPause,
    Pause,
    ClauseEnd,
    ModelSeam,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialBoundary {
    pub para_word_id: String,
    pub break_after_word_id: String,
    pub strength: BoundaryStrength,
    pub evidence: Vec<BoundaryEvidence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialSegmentPlan {
    pub source: RowSegmentation,
    pub input_fingerprint: String,
    pub boundaries: Vec<InitialBoundary>,
}

#[derive(Debug, Clone)]
struct Candidate {
    boundary: InitialBoundary,
    right_map_index: usize,
    paragraph_seconds: f64,
    cjk_chars: usize,
    latin_words: usize,
}

impl Candidate {
    fn meets_minimum(&self) -> bool {
        self.paragraph_seconds >= MIN_PARAGRAPH_SECONDS
            && (self.cjk_chars >= MIN_CJK_CHARS || self.latin_words >= MIN_LATIN_WORDS)
    }
}

fn terminal(text: &str) -> Option<char> {
    text.chars()
        .rev()
        .find(|character| !character.is_whitespace())
}

fn classify(gap: f64, text: &str) -> (BoundaryStrength, Vec<BoundaryEvidence>) {
    let last = terminal(text);
    let sentence = last.is_some_and(|ch| matches!(ch, '.' | '!' | '?' | '。' | '！' | '？' | '…'));
    let clause = last.is_some_and(|ch| matches!(ch, ',' | ';' | ':' | '，' | '；' | '：' | '、'));
    if sentence && gap >= 1.8 {
        return (
            BoundaryStrength::SentenceLongPause,
            vec![BoundaryEvidence::SentenceEnd, BoundaryEvidence::LongPause],
        );
    }
    if sentence {
        return (
            BoundaryStrength::Sentence,
            vec![BoundaryEvidence::SentenceEnd],
        );
    }
    if gap >= 0.6 {
        return (BoundaryStrength::Pause, vec![BoundaryEvidence::Pause]);
    }
    if clause {
        return (BoundaryStrength::Clause, vec![BoundaryEvidence::ClauseEnd]);
    }
    (BoundaryStrength::Segment, vec![BoundaryEvidence::ModelSeam])
}

fn content_counts(doc: &TranscriptDoc, first: usize, last: usize) -> (usize, usize) {
    let words = &doc.words[first..=last];
    let cjk = words
        .iter()
        .flat_map(|word| word.text.chars())
        .filter(|character| is_cjk_char(*character))
        .count();
    let latin = words
        .iter()
        .filter(|word| {
            word.text
                .chars()
                .any(|character| character.is_alphanumeric() && !is_cjk_char(character))
        })
        .count();
    (cjk, latin)
}

fn chapter_at(doc: &TranscriptDoc, time: f64) -> Option<&str> {
    doc.chapters
        .iter()
        .find(|chapter| chapter.start <= time && time < chapter.end)
        .map(|chapter| chapter.id.as_str())
}

fn candidate(
    doc: &TranscriptDoc,
    maps: &[RowWordMap],
    left_map_index: usize,
    paragraph_first_word: usize,
) -> Candidate {
    let left = maps[left_map_index];
    let right = maps[left_map_index + 1];
    let left_word = &doc.words[left.last_word_index];
    let right_word = &doc.words[right.first_word_index];
    let gap = (right_word.t0 - left_word.t1).max(0.0);
    let (strength, evidence) = classify(gap, &left_word.text);
    let (cjk_chars, latin_words) = content_counts(doc, paragraph_first_word, left.last_word_index);
    Candidate {
        boundary: InitialBoundary {
            para_word_id: right_word.id.clone(),
            break_after_word_id: left_word.id.clone(),
            strength,
            evidence,
        },
        right_map_index: left_map_index + 1,
        paragraph_seconds: (left_word.t1 - doc.words[paragraph_first_word].t0).max(0.0),
        cjk_chars,
        latin_words,
    }
}

fn best_candidate(candidates: &[Candidate], require_minimum: bool) -> Option<Candidate> {
    candidates
        .iter()
        .filter(|candidate| !require_minimum || candidate.meets_minimum())
        .min_by(|left, right| {
            left.boundary
                .strength
                .cmp(&right.boundary.strength)
                .then_with(|| {
                    (left.paragraph_seconds - TARGET_PARAGRAPH_SECONDS)
                        .abs()
                        .total_cmp(&(right.paragraph_seconds - TARGET_PARAGRAPH_SECONDS).abs())
                })
                .then_with(|| left.right_map_index.cmp(&right.right_map_index))
        })
        .cloned()
}

/// 由模型/provider row 接缝生成确定性的初始软段落计划。
pub fn derive_initial_segment_plan(
    doc: &TranscriptDoc,
    rows: &[RowIn],
    source: RowSegmentation,
) -> InitialSegmentPlan {
    let maps = row_word_maps(doc, rows);
    let sorted_rows = sorted_nonempty_rows(rows);
    let mut boundaries = Vec::new();
    if maps.len() < 2 {
        return InitialSegmentPlan {
            source,
            input_fingerprint: id_fingerprint(&doc.words),
            boundaries,
        };
    }

    let mut paragraph_map_index = 0usize;
    let mut pending = Vec::<Candidate>::new();
    let mut seam = 0usize;
    while seam + 1 < maps.len() {
        let left = maps[seam];
        let right = maps[seam + 1];
        let left_word = &doc.words[left.last_word_index];
        let right_word = &doc.words[right.first_word_index];
        let structural_boundary = left_word.sp != right_word.sp
            || chapter_at(doc, left_word.t0) != chapter_at(doc, right_word.t0);
        if structural_boundary {
            pending.clear();
            paragraph_map_index = seam + 1;
            seam += 1;
            continue;
        }

        let paragraph_first_word = maps[paragraph_map_index].first_word_index;
        let mut current = candidate(doc, &maps, seam, paragraph_first_word);
        // 行文本可能经过词化/AutoCorrect；句末证据以模型 row 原文补一次，时间和
        // 锚仍严格来自 doc。这样标点未被独立 atom 保留时不会丢强证据。
        let row_text = sorted_rows
            .get(left.row_index)
            .map(|row| row.text.as_str())
            .unwrap_or_default();
        let gap = (right_word.t0 - left_word.t1).max(0.0);
        let (strength, evidence) = classify(gap, row_text);
        if strength < current.boundary.strength {
            current.boundary.strength = strength;
            current.boundary.evidence = evidence;
        }
        pending.push(current.clone());

        let hard_limit = current.paragraph_seconds >= MAX_PARAGRAPH_SECONDS
            || current.cjk_chars >= MAX_CJK_CHARS
            || current.latin_words >= MAX_LATIN_WORDS;
        let strongest = current.meets_minimum()
            && current.boundary.strength == BoundaryStrength::SentenceLongPause;
        let target = current.paragraph_seconds >= TARGET_PARAGRAPH_SECONDS;
        let chosen = if strongest {
            Some(current)
        } else if hard_limit {
            best_candidate(&pending, true).or_else(|| best_candidate(&pending, false))
        } else if target {
            best_candidate(&pending, true)
        } else {
            None
        };

        if let Some(chosen) = chosen {
            boundaries.push(chosen.boundary);
            paragraph_map_index = chosen.right_map_index;
            pending.retain(|candidate| candidate.right_map_index > paragraph_map_index);
            // 若最佳切点落在当前接缝之前，从新段起点重算后续候选，避免沿用旧段
            // 的内容量统计。
            if paragraph_map_index <= seam {
                pending.clear();
                seam = paragraph_map_index;
                continue;
            }
        }
        seam += 1;
    }

    InitialSegmentPlan {
        source,
        input_fingerprint: id_fingerprint(&doc.words),
        boundaries,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build::{SpeakerBoundaryPolicy, build_doc_with_policy};
    use crate::cue::{derive_cues, derive_paras};
    use crate::doc::{BreakOverride, DocEngine, DocMedia};

    fn row(start: f64, text: &str) -> RowIn {
        RowIn::new(start, start + 3.0, text)
    }

    fn build(rows: &[RowIn]) -> TranscriptDoc {
        build_doc_with_policy(
            rows,
            DocMedia {
                id: None,
                path: None,
                hash: "sha256-test".to_owned(),
                duration: 120.0,
                sample_rate: Some(16_000),
            },
            "en",
            DocEngine {
                name: "moss".to_owned(),
                version: None,
                aligned_words: false,
            },
            None,
            SpeakerBoundaryPolicy::RowAuthoritative,
        )
    }

    #[test]
    fn short_model_rows_are_aggregated_instead_of_each_becoming_a_paragraph() {
        let rows = (0..12)
            .map(|index| row(index as f64 * 3.0, "alpha bravo charlie delta"))
            .collect::<Vec<_>>();
        let doc = build(&rows);
        let plan = derive_initial_segment_plan(&doc, &rows, RowSegmentation::Model);
        assert!(plan.boundaries.len() <= 2, "{plan:?}");
        assert!(!plan.boundaries.is_empty(), "20 秒目标应选普通模型接缝兜底");
    }

    #[test]
    fn a_sentence_followed_by_a_long_pause_becomes_a_strong_boundary() {
        let rows = vec![
            row(0.0, "one two three four five six"),
            row(3.0, "seven eight nine ten eleven twelve"),
            row(6.0, "thirteen fourteen fifteen sixteen seventeen eighteen."),
            row(12.0, "next paragraph starts after the pause"),
        ];
        let doc = build(&rows);
        let plan = derive_initial_segment_plan(&doc, &rows, RowSegmentation::Provider);
        assert_eq!(plan.boundaries.len(), 1, "{plan:?}");
        assert_eq!(
            plan.boundaries[0].strength,
            BoundaryStrength::SentenceLongPause
        );
        assert_eq!(plan.boundaries[0].para_word_id, "g4.0");
        assert_eq!(plan.boundaries[0].break_after_word_id, "g3.5");
    }

    #[test]
    fn speaker_changes_are_left_to_the_existing_para_rule() {
        let mut rows = vec![
            row(
                0.0,
                "one two three four five six seven eight nine ten twelve.",
            ),
            row(
                12.0,
                "new speaker has enough words for another paragraph seam.",
            ),
        ];
        rows[0].speaker = Some("A".to_owned());
        rows[1].speaker = Some("B".to_owned());
        let doc = build(&rows);
        let plan = derive_initial_segment_plan(&doc, &rows, RowSegmentation::Model);
        assert!(plan.boundaries.is_empty());
        let cues = derive_cues(&doc, &Default::default());
        assert_eq!(derive_paras(&doc, &cues).len(), 2);
    }

    #[test]
    fn injected_boundaries_use_the_required_pin_and_break_pair() {
        let rows = (0..8)
            .map(|index| row(index as f64 * 3.0, "alpha bravo charlie delta"))
            .collect::<Vec<_>>();
        let mut doc = build(&rows);
        let plan = derive_initial_segment_plan(&doc, &rows, RowSegmentation::Model);
        for boundary in &plan.boundaries {
            doc.para_breaks.insert(boundary.para_word_id.clone(), true);
            doc.breaks
                .insert(boundary.break_after_word_id.clone(), BreakOverride::Break);
        }
        let cues = derive_cues(&doc, &Default::default());
        assert_eq!(derive_paras(&doc, &cues).len(), plan.boundaries.len() + 1);
    }
}
