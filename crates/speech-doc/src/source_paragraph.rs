//! 转写段落的结构编辑。
//!
//! Para 与 Cue 一样都是 `words[]` 的派生投影。拆分在光标最近的词边界同时写入
//! `paraBreaks[next] = true` 与 `breaks[previous] = "break"`；合并只移除段首
//! paragraph pin，保留 Cue 自己的显式断行。这里不处理正文替换——宿主先在副本
//! 上应用未提交文本，再把稳定的段落下标交给本模块，整个事务仍保持原子。

use std::fmt;

use crate::cue::{derive_cues, derive_paras, split_boundary_at_char};
use crate::doc::{BreakOverride, TranscriptDoc, Word};
use crate::layout_profile::cue_params_for_doc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParagraphSplitOutcome {
    pub paragraph_id: String,
    pub break_after_word_id: String,
    pub next_paragraph_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParagraphMergeOutcome {
    pub upper_paragraph_id: String,
    pub removed_paragraph_id: String,
    pub removed_pin_word_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceParagraphError {
    ParagraphMissing,
    CannotSplit,
    StructuralBoundary,
    MissingParagraphPin,
    InvalidDocument(String),
}

impl fmt::Display for SourceParagraphError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ParagraphMissing => formatter.write_str("转写段落已不存在"),
            Self::CannotSplit => formatter.write_str("段落没有可拆分的内部词边界"),
            Self::StructuralBoundary => formatter.write_str("不能跨说话人或章节合并段落"),
            Self::MissingParagraphPin => formatter.write_str("段落边界不是可移除的 paragraph pin"),
            Self::InvalidDocument(message) => formatter.write_str(message),
        }
    }
}

fn projection(doc: &TranscriptDoc) -> (Vec<crate::cue::Cue>, Vec<crate::cue::Para>) {
    let cues = derive_cues(doc, &cue_params_for_doc(doc));
    let paras = derive_paras(doc, &cues);
    (cues, paras)
}

fn paragraph_word_indices(cues: &[crate::cue::Cue], paragraph: &crate::cue::Para) -> Vec<usize> {
    paragraph
        .cue_indices
        .iter()
        .flat_map(|&index| cues[index].word_indices.iter().copied())
        .collect()
}

fn chapter_of(doc: &TranscriptDoc, time: f64) -> usize {
    doc.chapters
        .iter()
        .position(|chapter| time >= chapter.start && time < chapter.end)
        .unwrap_or(usize::MAX)
}

/// 在派生段落的光标位置拆段。`character_offset` 按 `join_words` 的字符口径；
/// 等距时由 `split_boundary_at_char` 固定吸附到更早的词边界。
pub fn split_paragraph_at_char(
    doc: &mut TranscriptDoc,
    paragraph_index: usize,
    character_offset: usize,
) -> Result<ParagraphSplitOutcome, SourceParagraphError> {
    let (cues, paras) = projection(doc);
    let paragraph = paras
        .get(paragraph_index)
        .ok_or(SourceParagraphError::ParagraphMissing)?;
    let indices = paragraph_word_indices(&cues, paragraph);
    let words: Vec<&Word> = indices.iter().map(|&index| &doc.words[index]).collect();
    let boundary = split_boundary_at_char(&words, character_offset)
        .ok_or(SourceParagraphError::CannotSplit)?;
    let break_after_word_id = doc.words[indices[boundary]].id.clone();
    let next_word_id = doc.words[indices[boundary + 1]].id.clone();

    let mut next = doc.clone();
    next.para_breaks.insert(next_word_id.clone(), true);
    next.breaks
        .insert(break_after_word_id.clone(), BreakOverride::Break);
    next.validate().map_err(|error| {
        SourceParagraphError::InvalidDocument(format!("拆分段落后的 transcript 无效：{error:#}"))
    })?;
    *doc = next;
    Ok(ParagraphSplitOutcome {
        paragraph_id: paragraph.id.clone(),
        break_after_word_id,
        next_paragraph_id: format!("p-{next_word_id}"),
    })
}

/// 向上合并一段。只有同说话人、同章节且当前段首由显式 `paraBreaks` 钉出的
/// 边界可以移除；Cue break 故意保留。
pub fn merge_paragraph_up(
    doc: &mut TranscriptDoc,
    paragraph_index: usize,
) -> Result<ParagraphMergeOutcome, SourceParagraphError> {
    let (cues, paras) = projection(doc);
    if paragraph_index == 0 {
        return Err(SourceParagraphError::ParagraphMissing);
    }
    let current = paras
        .get(paragraph_index)
        .ok_or(SourceParagraphError::ParagraphMissing)?;
    let previous = &paras[paragraph_index - 1];
    let current_first_cue = &cues[current.cue_indices[0]];
    let previous_last_cue = &cues[*previous.cue_indices.last().expect("non-empty para")];
    if current.sp != previous.sp
        || chapter_of(doc, current_first_cue.start) != chapter_of(doc, previous_last_cue.start)
    {
        return Err(SourceParagraphError::StructuralBoundary);
    }
    let pin = doc.words[current_first_cue.word_indices[0]].id.clone();
    if !doc.para_breaks.get(&pin).copied().unwrap_or(false) {
        return Err(SourceParagraphError::MissingParagraphPin);
    }

    let mut next = doc.clone();
    next.para_breaks.remove(&pin);
    next.validate().map_err(|error| {
        SourceParagraphError::InvalidDocument(format!("合并段落后的 transcript 无效：{error:#}"))
    })?;
    *doc = next;
    Ok(ParagraphMergeOutcome {
        upper_paragraph_id: previous.id.clone(),
        removed_paragraph_id: current.id.clone(),
        removed_pin_word_id: pin,
    })
}

pub fn merge_paragraph_down(
    doc: &mut TranscriptDoc,
    paragraph_index: usize,
) -> Result<ParagraphMergeOutcome, SourceParagraphError> {
    merge_paragraph_up(doc, paragraph_index.saturating_add(1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{DocEngine, DocMedia, Speaker, Word};

    fn fixture() -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: None,
                hash: "sha256-00".to_owned(),
                duration: 10.0,
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
        doc.words = ["One", "two", "three", "four"]
            .into_iter()
            .enumerate()
            .map(|(index, text)| Word {
                id: format!("w{}", index + 1),
                t0: index as f64 * 0.5,
                t1: index as f64 * 0.5 + 0.4,
                text: text.to_owned(),
                sp: "s1".to_owned(),
                glue: false,
            })
            .collect();
        doc
    }

    #[test]
    fn split_pins_both_paragraph_and_cue_boundaries() {
        let mut doc = fixture();
        let outcome = split_paragraph_at_char(&mut doc, 0, 7).unwrap();
        assert_eq!(outcome.break_after_word_id, "w2");
        assert_eq!(outcome.next_paragraph_id, "p-w3");
        assert_eq!(doc.breaks["w2"], BreakOverride::Break);
        assert_eq!(doc.para_breaks["w3"], true);
        let (cues, paras) = projection(&doc);
        assert_eq!(cues.len(), 2);
        assert_eq!(
            paras
                .iter()
                .map(|para| para.id.as_str())
                .collect::<Vec<_>>(),
            ["p-w1", "p-w3"]
        );
    }

    #[test]
    fn merge_removes_only_the_paragraph_pin() {
        let mut doc = fixture();
        split_paragraph_at_char(&mut doc, 0, 7).unwrap();
        let outcome = merge_paragraph_up(&mut doc, 1).unwrap();
        assert_eq!(outcome.upper_paragraph_id, "p-w1");
        assert_eq!(outcome.removed_paragraph_id, "p-w3");
        assert!(!doc.para_breaks.contains_key("w3"));
        assert_eq!(doc.breaks["w2"], BreakOverride::Break);
        let (cues, paras) = projection(&doc);
        assert_eq!(cues.len(), 2, "cue pin remains");
        assert_eq!(paras.len(), 1);
    }

    #[test]
    fn structural_boundaries_and_single_word_paragraphs_refuse_atomically() {
        let mut doc = fixture();
        doc.para_breaks.insert("w2".to_owned(), true);
        doc.words[1].sp = "s2".to_owned();
        doc.speakers.insert(
            "s2".to_owned(),
            Speaker {
                name: "Other".to_owned(),
                hue: None,
            },
        );
        let before = doc.clone();
        assert_eq!(
            split_paragraph_at_char(&mut doc, 0, 1),
            Err(SourceParagraphError::CannotSplit)
        );
        assert_eq!(doc, before);
        assert_eq!(
            merge_paragraph_up(&mut doc, 1),
            Err(SourceParagraphError::StructuralBoundary)
        );
        assert_eq!(doc, before);
    }
}
