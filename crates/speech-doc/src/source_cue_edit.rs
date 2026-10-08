//! 原文 Cue 的结构编辑。
//!
//! Cue 是从 `words[]` 派生的；删除一条 Cue 的持久语义因此只能是删除它拥有的
//! 词原子。客户端提交 Cue id 与当前正文作 CAS，服务端在副本上重派生、删除并
//! 清理失去词锚的覆盖键，避免时间轴选中项过期时误删另一段内容。

use std::fmt;

use crate::cue::derive_cues;
use crate::doc::TranscriptDoc;
use crate::layout_profile::cue_params_for_doc;

#[derive(Debug, Clone, Copy)]
pub struct DeleteOriginalCueRequest<'a> {
    pub cue_id: &'a str,
    pub base_text: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeleteOriginalCueOutcome {
    pub cue_id: String,
    pub removed_word_ids: Vec<String>,
    pub pruned_overrides: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeleteOriginalCueError {
    InvalidCueId,
    CueMissing,
    Conflict,
    InvalidDocument(String),
}

impl fmt::Display for DeleteOriginalCueError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCueId => formatter.write_str("Cue id 必须是 q-…"),
            Self::CueMissing => formatter.write_str("原文 Cue 已不存在"),
            Self::Conflict => formatter.write_str("原文 Cue 正文基线已变化"),
            Self::InvalidDocument(message) => formatter.write_str(message),
        }
    }
}

/// 删除一条派生 Cue 拥有的全部词；失败时 `doc` 保持原样。
pub fn delete_original_cue(
    doc: &mut TranscriptDoc,
    request: DeleteOriginalCueRequest<'_>,
) -> Result<DeleteOriginalCueOutcome, DeleteOriginalCueError> {
    if !request.cue_id.starts_with("q-") {
        return Err(DeleteOriginalCueError::InvalidCueId);
    }
    let cues = derive_cues(doc, &cue_params_for_doc(doc));
    let cue = cues
        .iter()
        .find(|cue| cue.id == request.cue_id)
        .ok_or(DeleteOriginalCueError::CueMissing)?;
    if cue.text(doc) != request.base_text {
        return Err(DeleteOriginalCueError::Conflict);
    }
    let removed_word_ids: Vec<String> = cue
        .word_indices
        .iter()
        .map(|&index| doc.words[index].id.clone())
        .collect();
    let removed: std::collections::HashSet<&str> =
        removed_word_ids.iter().map(String::as_str).collect();

    let mut next = doc.clone();
    next.words
        .retain(|word| !removed.contains(word.id.as_str()));
    let pruned_overrides = next.prune_orphan_overrides();
    next.validate().map_err(|error| {
        DeleteOriginalCueError::InvalidDocument(format!(
            "删除原文 Cue 后的 transcript 无效：{error:#}"
        ))
    })?;
    *doc = next;
    Ok(DeleteOriginalCueOutcome {
        cue_id: request.cue_id.to_owned(),
        removed_word_ids,
        pruned_overrides,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{BreakOverride, DocEngine, DocMedia, Speaker, Word};

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
        doc.words = vec![
            Word {
                id: "w1".to_owned(),
                t0: 0.0,
                t1: 0.4,
                text: "First".to_owned(),
                sp: "s1".to_owned(),
                glue: false,
            },
            Word {
                id: "w2".to_owned(),
                t0: 0.4,
                t1: 0.8,
                text: "cue.".to_owned(),
                sp: "s1".to_owned(),
                glue: false,
            },
            Word {
                id: "w3".to_owned(),
                t0: 1.0,
                t1: 1.4,
                text: "Second".to_owned(),
                sp: "s1".to_owned(),
                glue: false,
            },
            Word {
                id: "w4".to_owned(),
                t0: 1.4,
                t1: 1.8,
                text: "cue.".to_owned(),
                sp: "s1".to_owned(),
                glue: false,
            },
        ];
        doc.breaks.insert("w2".to_owned(), BreakOverride::Break);
        doc.para_breaks.insert("w1".to_owned(), true);
        doc.hidden.insert("w2".to_owned(), false);
        doc
    }

    #[test]
    fn deletion_removes_exact_cue_words_and_orphaned_overrides() {
        let mut doc = fixture();
        let outcome = delete_original_cue(
            &mut doc,
            DeleteOriginalCueRequest {
                cue_id: "q-w1",
                base_text: "First cue.",
            },
        )
        .unwrap();
        assert_eq!(outcome.removed_word_ids, ["w1", "w2"]);
        assert_eq!(outcome.pruned_overrides, 3);
        assert_eq!(
            doc.words
                .iter()
                .map(|word| word.id.as_str())
                .collect::<Vec<_>>(),
            ["w3", "w4"]
        );
        assert!(doc.orphan_overrides().is_empty());
    }

    #[test]
    fn stale_text_does_not_mutate_the_document() {
        let mut doc = fixture();
        let before = doc.clone();
        assert_eq!(
            delete_original_cue(
                &mut doc,
                DeleteOriginalCueRequest {
                    cue_id: "q-w1",
                    base_text: "stale",
                },
            ),
            Err(DeleteOriginalCueError::Conflict)
        );
        assert_eq!(doc, before);
    }

    #[test]
    fn missing_and_invalid_cue_ids_are_refused() {
        let mut doc = fixture();
        assert_eq!(
            delete_original_cue(
                &mut doc,
                DeleteOriginalCueRequest {
                    cue_id: "w1",
                    base_text: "First cue.",
                },
            ),
            Err(DeleteOriginalCueError::InvalidCueId)
        );
        assert_eq!(
            delete_original_cue(
                &mut doc,
                DeleteOriginalCueRequest {
                    cue_id: "q-missing",
                    base_text: "",
                },
            ),
            Err(DeleteOriginalCueError::CueMissing)
        );
    }
}
