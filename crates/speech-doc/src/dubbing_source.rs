//! Read-only semantic translation inputs for dubbing. Subtitle display text,
//! alignment, line breaks and layout profiles never enter this projection.
use crate::{
    doc::TranscriptDoc, language_quality::translation_quality_issues, sentence::derive_sentences,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranslationSentence {
    pub id: String,
    pub source_word_ids: Vec<String>,
    pub speaker_id: String,
    pub source_text: String,
    pub source_fingerprint: String,
    pub recorded_source_fingerprint: Option<String>,
    pub translation: Option<String>,
    pub issues: Vec<String>,
}

/// Missing provenance is reported independently from stale content. It does not
/// manufacture a verified translation, or silently reject all legacy projects.
pub fn translation_sentences(doc: &TranscriptDoc, language: &str) -> Vec<TranslationSentence> {
    derive_sentences(doc, &[])
        .into_iter()
        .map(|sentence| {
            let translation = doc
                .trans
                .get(language)
                .and_then(|t| t.get(&sentence.id))
                .cloned();
            let recorded = doc
                .trans_src
                .get(language)
                .and_then(|t| t.get(&sentence.id))
                .cloned();
            let mut issues = Vec::new();
            if recorded
                .as_ref()
                .is_some_and(|s| s != &sentence.src_fingerprint)
            {
                issues.push("translation-stale".into());
            }
            if let Some(text) = translation.as_ref().filter(|t| !t.trim().is_empty()) {
                issues.extend(
                    translation_quality_issues(&sentence.source_text, language, text)
                        .into_iter()
                        .map(|issue| issue.code.as_str().to_owned()),
                );
            } else {
                issues.push("translation-missing".into());
            }
            TranslationSentence {
                id: sentence.id,
                source_word_ids: sentence
                    .word_indices
                    .iter()
                    .map(|i| doc.words[*i].id.clone())
                    .collect(),
                speaker_id: doc.words[sentence.word_indices[0]].sp.clone(),
                source_text: sentence.source_text,
                source_fingerprint: sentence.src_fingerprint,
                recorded_source_fingerprint: recorded,
                translation,
                issues,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{BreakOverride, TransDisplay};
    use serde_json::json;

    fn fixture() -> TranscriptDoc {
        TranscriptDoc::from_json(&serde_json::to_vec(&json!({"bcutTranscript":"0.4",
            "media":{"hash":"media","duration":6.0},"lang":"en","engine":{"name":"fixture","alignedWords":true},
            "speakers":{"a":{"name":"A"}},"words":[{"id":"w1","sp":"a","text":"First.","t0":0.0,"t1":1.0},
                {"id":"w2","sp":"a","text":"Second.","t0":2.0,"t1":3.0}],
            "trans":{"zh-Hans":{"s-w1":"第一句。","s-w2":"第二句。"}}})).unwrap()).unwrap()
    }
    #[test]
    fn dubbing_source_ignores_display_rewrites_and_layout() {
        let mut doc = fixture();
        let before = translation_sentences(&doc, "zh-Hans");
        doc.breaks.insert("w1".into(), BreakOverride::Break);
        doc.layout_profile = Some("different-layout".into());
        doc.trans_display
            .entry("zh-Hans".into())
            .or_default()
            .insert(
                "s-w1".into(),
                TransDisplay {
                    text: "This display rewrite is not the semantic input".into(),
                    basis: "fixture".into(),
                    trans_fingerprint: "old".into(),
                },
            );
        assert_eq!(translation_sentences(&doc, "zh-Hans"), before);
        assert_eq!(before[0].translation.as_deref(), Some("第一句。"));
        assert!(before[0].recorded_source_fingerprint.is_none());
        assert!(before.iter().all(|r| r.issues.is_empty()));
    }
    #[test]
    fn dubbing_source_keeps_missing_stale_and_legacy_evidence_distinct() {
        let mut doc = fixture();
        let rows = translation_sentences(&doc, "zh-Hans");
        doc.trans_src.insert(
            "zh-Hans".into(),
            rows.iter()
                .map(|r| (r.id.clone(), r.source_fingerprint.clone()))
                .collect(),
        );
        doc.words[0].text = "Corrected first sentence.".into();
        doc.trans.get_mut("zh-Hans").unwrap().remove("s-w2");
        let rows = translation_sentences(&doc, "zh-Hans");
        assert_eq!(rows[0].issues, vec!["translation-stale"]);
        assert_eq!(rows[1].issues, vec!["translation-missing"]);
        assert!(
            translation_sentences(&doc, "zh")
                .iter()
                .all(|r| r.issues.contains(&"translation-missing".into()))
        );
    }
    #[test]
    fn dubbing_source_uses_current_visible_words_and_reports_placeholders() {
        let mut doc = fixture();
        doc.hidden.insert("w1".into(), true);
        doc.trans
            .get_mut("zh-Hans")
            .unwrap()
            .insert("s-w2".into(), "TODO".into());
        let rows = translation_sentences(&doc, "zh-Hans");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].source_word_ids, vec!["w2"]);
        assert!(rows[0].issues.contains(&"translation-placeholder".into()));
    }
}
