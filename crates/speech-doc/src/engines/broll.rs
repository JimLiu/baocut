//! B-roll 内容建议：LLM 只看编号句子，宿主用稳定词 id 还原时间锚。

use serde::{Deserialize, Serialize};

use crate::cue::derive_cues;
use crate::doc::TranscriptDoc;
use crate::fingerprint::fingerprint;
use crate::llm::{LlmError, LlmJson, LlmRequest, MAX_RETRIES, decode, with_retry};
use crate::sentence::derive_sentences;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrollSuggestion {
    pub first_word_id: String,
    pub last_word_id: String,
    pub mode: String,
    pub query: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrollArtifact {
    pub fingerprint: String,
    pub suggestions: Vec<BrollSuggestion>,
}

#[derive(Debug, Clone)]
pub struct BrollOptions {
    pub instructions: Option<String>,
    pub max_suggestions: usize,
}

impl Default for BrollOptions {
    fn default() -> Self {
        Self {
            instructions: None,
            max_suggestions: 6,
        }
    }
}

#[derive(Deserialize)]
struct Answer {
    #[serde(default)]
    suggestions: Vec<AnswerSuggestion>,
}

#[derive(Deserialize)]
struct AnswerSuggestion {
    start: usize,
    end: usize,
    mode: String,
    query: String,
    reason: String,
}

pub fn lint_agent_answer(payload: &str, answer: &str) -> Vec<String> {
    let count = serde_json::from_str::<serde_json::Value>(payload)
        .ok()
        .and_then(|value| value["sentences"].as_array().map(Vec::len));
    let Some(count) = count else {
        return Vec::new();
    };
    let answer: Answer = match decode(answer) {
        Ok(value) => value,
        Err(error) => return vec![error.to_string()],
    };
    // 镜像引擎的单元验收（§2.5）：单条非法只丢那一条，答案照常可用；只有
    // **全部**非法（且确实给了建议）才判整份答案不可用。
    let offered = answer.suggestions.len();
    let problems: Vec<String> = answer
        .suggestions
        .into_iter()
        .filter_map(|suggestion| {
            (suggestion.start > suggestion.end
                || suggestion.end >= count
                || suggestion.end - suggestion.start + 1 > 3
                || !matches!(suggestion.mode.as_str(), "pip" | "fullscreen")
                || suggestion.query.trim().is_empty())
            .then(|| {
                format!(
                    "invalid B-roll suggestion {}..{} mode/query",
                    suggestion.start, suggestion.end
                )
            })
        })
        .collect();
    if offered > 0 && problems.len() == offered {
        return problems;
    }
    Vec::new()
}

pub fn run_broll_suggest(
    doc: &TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &BrollOptions,
    sleep: &mut dyn FnMut(f64),
) -> Result<BrollArtifact, LlmError> {
    let cues = derive_cues(doc, &crate::layout_profile::cue_params_for_doc(doc));
    let sentences = derive_sentences(doc, &cues);
    let rows = sentences
        .iter()
        .enumerate()
        .map(|(index, sentence)| serde_json::json!({"i": index, "text": sentence.source_text}))
        .collect::<Vec<_>>();
    let user = serde_json::json!({"sentences": rows}).to_string();
    let mut system = r#"Suggest sparse, useful B-roll moments for this spoken-video transcript.
Return one JSON object: {"suggestions":[{"start":integer,"end":integer,"mode":"pip|fullscreen","query":string,"reason":string}]}.
start/end are inclusive zero-based sentence indices. Never emit timestamps or media URLs. Queries must be concrete visual search phrases. Keep each suggestion within at most 3 sentences and avoid decorative B-roll that adds no information."#.to_owned();
    system.push_str(&format!(
        "\nReturn no more than {} suggestions.",
        options.max_suggestions
    ));
    if let Some(instructions) = options
        .instructions
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        system.push_str("\n\nExplicit user instructions:\n");
        system.push_str(instructions);
    }
    let mut suggestions = with_retry(MAX_RETRIES, &mut *sleep, |attempt| {
        let raw = llm.complete(&LlmRequest {
            kind: "broll",
            system: system.clone(),
            user: user.clone(),
            temperature: 0.3,
            attempt: attempt + 1,
            retry_reason: (attempt > 0)
                .then(|| "the previous suggestions used invalid sentence ranges".to_owned()),
        })?;
        let answer: Answer = decode(&raw)?;
        // 单元验收（重试策略重设计 §2.5）：非法建议**丢该条**，其余照常收下；
        // 全部非法（且模型确实给了建议）才判整份答案不可用并重试。B-roll 建议
        // 之间彼此独立，为一条越界区间重掷整份答案是纯烧 token。
        let offered = answer.suggestions.len();
        let mut dropped = 0usize;
        let accepted: Vec<BrollSuggestion> = answer
            .suggestions
            .into_iter()
            .filter_map(|suggestion| {
                let range_ok = suggestion.start <= suggestion.end
                    && suggestion.end < sentences.len()
                    && suggestion.end - suggestion.start + 1 <= 3;
                let shape_ok = matches!(suggestion.mode.as_str(), "pip" | "fullscreen")
                    && !suggestion.query.trim().is_empty();
                if !range_ok || !shape_ok {
                    dropped += 1;
                    return None;
                }
                let first = sentences[suggestion.start].word_indices[0];
                let last = *sentences[suggestion.end]
                    .word_indices
                    .last()
                    .expect("sentence has words");
                Some(BrollSuggestion {
                    first_word_id: doc.words[first].id.clone(),
                    last_word_id: doc.words[last].id.clone(),
                    mode: suggestion.mode,
                    query: suggestion.query.trim().to_owned(),
                    reason: suggestion.reason.trim().to_owned(),
                })
            })
            .collect();
        if offered > 0 && accepted.is_empty() {
            return Err(LlmError::Malformed(format!(
                "all {dropped} B-roll suggestions had an invalid sentence range or mode/query"
            )));
        }
        Ok(accepted)
    })?;
    suggestions.truncate(options.max_suggestions);
    Ok(BrollArtifact {
        fingerprint: fingerprint(&doc.words),
        suggestions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{DocEngine, DocMedia, TranscriptDoc, Word};
    use crate::llm::FakeLlm;

    #[test]
    fn broll_maps_sentence_ranges_to_word_ids() {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: None,
                hash: "h".into(),
                duration: 3.0,
                sample_rate: None,
            },
            "en",
            DocEngine {
                name: "test".into(),
                version: None,
                aligned_words: true,
            },
        );
        doc.words = vec![
            Word {
                id: "w0".into(),
                t0: 0.0,
                t1: 0.4,
                text: "Hello.".into(),
                sp: "s1".into(),
                glue: false,
            },
            Word {
                id: "w1".into(),
                t0: 1.0,
                t1: 1.4,
                text: "Mars.".into(),
                sp: "s1".into(),
                glue: false,
            },
        ];
        let mut llm = FakeLlm::ok([
            r#"{"suggestions":[{"start":0,"end":1,"mode":"fullscreen","query":"planet Mars orbit","reason":"explains topic"}]}"#,
        ]);
        let artifact =
            run_broll_suggest(&doc, &mut llm, &BrollOptions::default(), &mut |_| {}).unwrap();
        assert_eq!(artifact.suggestions[0].first_word_id, "w0");
        assert_eq!(artifact.suggestions[0].last_word_id, "w1");
    }

    /// §2.5：单条非法建议只丢那一条，其余照常接受，不重掷整份答案。
    #[test]
    fn broll_drops_invalid_suggestions_instead_of_rejecting_all() {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: None,
                hash: "h".into(),
                duration: 3.0,
                sample_rate: None,
            },
            "en",
            DocEngine {
                name: "test".into(),
                version: None,
                aligned_words: true,
            },
        );
        doc.words = vec![
            Word {
                id: "w0".into(),
                t0: 0.0,
                t1: 0.4,
                text: "Hello.".into(),
                sp: "s1".into(),
                glue: false,
            },
            Word {
                id: "w1".into(),
                t0: 1.0,
                t1: 1.4,
                text: "Mars.".into(),
                sp: "s1".into(),
                glue: false,
            },
        ];
        // 第一条越界、第二条模式非法、第三条合法。
        let mut llm = FakeLlm::ok([r#"{"suggestions":[
                {"start":0,"end":9,"mode":"pip","query":"out of range","reason":""},
                {"start":0,"end":0,"mode":"banner","query":"bad mode","reason":""},
                {"start":0,"end":1,"mode":"fullscreen","query":"planet Mars orbit","reason":"ok"}
            ]}"#]);
        let artifact =
            run_broll_suggest(&doc, &mut llm, &BrollOptions::default(), &mut |_| {}).unwrap();
        assert_eq!(llm.calls.len(), 1, "不重试整份答案");
        assert_eq!(artifact.suggestions.len(), 1);
        assert_eq!(artifact.suggestions[0].query, "planet Mars orbit");

        // 全部非法才判整份答案不可用（这里三次都坏 ⇒ 重试耗尽后上抛）。
        let mut llm = FakeLlm::ok([
            r#"{"suggestions":[{"start":0,"end":9,"mode":"pip","query":"x","reason":""}]}"#,
            r#"{"suggestions":[{"start":0,"end":9,"mode":"pip","query":"x","reason":""}]}"#,
            r#"{"suggestions":[{"start":0,"end":9,"mode":"pip","query":"x","reason":""}]}"#,
        ]);
        assert!(run_broll_suggest(&doc, &mut llm, &BrollOptions::default(), &mut |_| {}).is_err());
    }

    #[test]
    fn broll_agent_lint_mirrors_range_mode_and_query_guards() {
        let payload = serde_json::json!({
            "sentences": [
                {"i": 0, "text": "One."},
                {"i": 1, "text": "Two."},
                {"i": 2, "text": "Three."},
                {"i": 3, "text": "Four."}
            ]
        })
        .to_string();
        let answer = serde_json::json!({
            "suggestions": [
                {"start": 3, "end": 2, "mode": "pip", "query": "map", "reason": "reversed"},
                {"start": 0, "end": 4, "mode": "pip", "query": "map", "reason": "outside"},
                {"start": 0, "end": 3, "mode": "pip", "query": "map", "reason": "too long"},
                {"start": 0, "end": 0, "mode": "overlay", "query": "map", "reason": "mode"},
                {"start": 0, "end": 0, "mode": "fullscreen", "query": "  ", "reason": "query"}
            ]
        })
        .to_string();

        assert_eq!(lint_agent_answer(&payload, &answer).len(), 5);
    }

    #[test]
    fn broll_retries_invalid_suggestions_before_mapping_word_ids() {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: None,
                hash: "h".into(),
                duration: 1.0,
                sample_rate: None,
            },
            "en",
            DocEngine {
                name: "test".into(),
                version: None,
                aligned_words: true,
            },
        );
        doc.words = vec![Word {
            id: "w0".into(),
            t0: 0.0,
            t1: 0.4,
            text: "Mars.".into(),
            sp: "s1".into(),
            glue: false,
        }];
        let mut llm = FakeLlm::ok([
            r#"{"suggestions":[{"start":0,"end":0,"mode":"overlay","query":"Mars","reason":"bad mode"}]}"#,
            r#"{"suggestions":[{"start":0,"end":0,"mode":"pip","query":"Mars rover","reason":"shows subject"}]}"#,
        ]);

        let artifact =
            run_broll_suggest(&doc, &mut llm, &BrollOptions::default(), &mut |_| {}).unwrap();

        assert_eq!(artifact.suggestions[0].first_word_id, "w0");
        assert_eq!(llm.attempts, vec![1, 2]);
        assert_eq!(
            llm.calls[1].3.as_deref(),
            Some("the previous suggestions used invalid sentence ranges")
        );
    }
}
