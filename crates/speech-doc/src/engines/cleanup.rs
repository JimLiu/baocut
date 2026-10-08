//! LLM 粗剪建议：模型只看页内词序号，持久工件只保存稳定词 id。

use serde::{Deserialize, Serialize};

use crate::doc::TranscriptDoc;
use crate::fingerprint::fingerprint;
use crate::llm::{LlmError, LlmJson, LlmRequest, MAX_RETRIES, decode, with_retry};
use crate::paging::paginate_word_ranges;

const PAGE_BUDGET: usize = 6_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CleanupStrength {
    Conservative,
    Standard,
    Tight,
}

impl CleanupStrength {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "conservative" => Ok(Self::Conservative),
            "standard" => Ok(Self::Standard),
            "tight" => Ok(Self::Tight),
            other => Err(format!(
                "未知 cleanup strength {other}（可用：conservative|standard|tight）"
            )),
        }
    }
}

/// LLM 可返回的细分类别；`repeat` 只在 standard/tight 强度下采纳（conservative 静默丢弃）。
pub const LLM_CATEGORIES: [&str; 4] = ["retake", "falseStart", "filler", "repeat"];

/// 细分类别 → `ai/cuts.json` 的封闭 `kind`（silence|filler|badTake|manual|match）。
/// 设计见 docs/design/editor/bcut-talking-head-cut-design.md C8。
pub fn closed_kind(category: &str) -> &'static str {
    match category {
        "filler" => "filler",
        "pause" | "silence" => "silence",
        "manual" => "manual",
        "match" => "match",
        _ => "badTake",
    }
}

impl CleanupStrength {
    /// conservative 只保留明确的口误/填充词，不采纳「重复表达」类建议。
    pub fn accepts_category(self, category: &str) -> bool {
        !(category == "repeat" && self == Self::Conservative)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupSuggestion {
    pub first_word_id: String,
    pub last_word_id: String,
    pub category: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alternative: Option<String>,
    pub reason: String,
    pub t0: f64,
    pub t1: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupArtifact {
    pub fingerprint: String,
    pub strength: CleanupStrength,
    pub suggestions: Vec<CleanupSuggestion>,
}

#[derive(Debug, Clone)]
pub struct CleanupOptions {
    pub strength: CleanupStrength,
    pub instructions: Option<String>,
    /// 已有 source cut 的媒体时间窗；建议不得相交。
    pub existing_cuts: Vec<(f64, f64)>,
}

#[derive(Deserialize)]
struct Answer {
    #[serde(default)]
    cuts: Vec<AnswerCut>,
}

#[derive(Deserialize)]
struct AnswerCut {
    a: usize,
    b: usize,
    cat: String,
    #[serde(default)]
    alt: Option<String>,
    reason: String,
}

/// Agent submit lint：镜像无需 transcript 的确定性范围/类别护栏。
pub fn lint_agent_answer(payload: &str, answer: &str) -> Vec<String> {
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(payload) else {
        return Vec::new();
    };
    let Some(words) = payload["words"].as_array() else {
        return Vec::new();
    };
    let decoded: Answer = match decode(answer) {
        Ok(value) => value,
        Err(error) => return vec![error.to_string()],
    };
    let mut problems = Vec::new();
    for cut in decoded.cuts {
        if cut.a > cut.b || cut.b >= words.len() {
            problems.push(format!(
                "cleanup range {}..{} is outside the page",
                cut.a, cut.b
            ));
            continue;
        }
        if !LLM_CATEGORIES.contains(&cut.cat.as_str()) {
            problems.push(format!("unknown cleanup category {}", cut.cat));
        }
        if cut.cat == "filler" && cut.b - cut.a + 1 > 6 {
            problems.push("filler range exceeds 6 words".to_owned());
        }
        let speaker = words[cut.a]["speaker"].as_str();
        if words[cut.a..=cut.b]
            .iter()
            .any(|word| word["speaker"].as_str() != speaker)
        {
            problems.push("cleanup range crosses a speaker boundary".to_owned());
        }
        if words[cut.a..=cut.b]
            .iter()
            .any(|word| word["alreadyCut"].as_bool().unwrap_or(false))
        {
            problems.push("cleanup range intersects an existing cut".to_owned());
        }
    }
    problems
}

fn system_prompt(options: &CleanupOptions) -> String {
    let mut prompt = format!(
        r#"You suggest safe rough-cut removals from a spoken transcript.
Return one JSON object: {{"cuts":[{{"a":integer,"b":integer,"cat":"retake|falseStart|filler|repeat","alt":string(optional),"reason":string}}]}}.
`a` and `b` are inclusive, zero-based word indices from the supplied page. Never emit timestamps.
Categories: `retake` = the speaker restarted and the later take is the keeper (remove the earlier one); `falseStart` = an abandoned sentence fragment; `filler` = verbal filler with no meaning; `repeat` = the same idea said twice in a row without correction (remove the earlier, keep the later).
Strength is {:?}. Prefer missing a possible cut over deleting intended meaning. A cut must be self-contained, stay within one speaker, and preserve the best complete take. Fillers may contain at most 6 words. Do not suggest rows marked alreadyCut.{}"#,
        options.strength,
        if options.strength == CleanupStrength::Conservative {
            " Do not emit `repeat` cuts at this strength."
        } else {
            ""
        }
    );
    if let Some(instructions) = options
        .instructions
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        prompt.push_str("\n\nExplicit user instructions:\n");
        prompt.push_str(instructions);
    }
    prompt
}

fn overlaps(t0: f64, t1: f64, cuts: &[(f64, f64)]) -> bool {
    cuts.iter().any(|(cut0, cut1)| t0 < *cut1 && t1 > *cut0)
}

fn validate_page(
    doc: &TranscriptDoc,
    page: std::ops::Range<usize>,
    raw: &str,
    options: &CleanupOptions,
) -> Result<Vec<CleanupSuggestion>, LlmError> {
    let answer: Answer = decode(raw)?;
    let mut suggestions = Vec::new();
    for cut in answer.cuts {
        if cut.a > cut.b || cut.b >= page.len() {
            return Err(LlmError::Malformed(format!(
                "cleanup range {}..{} is outside page of {} words",
                cut.a,
                cut.b,
                page.len()
            )));
        }
        if !LLM_CATEGORIES.contains(&cut.cat.as_str()) {
            return Err(LlmError::Malformed(format!(
                "unknown cleanup category {}",
                cut.cat
            )));
        }
        // conservative 不采纳 repeat：模型偶尔仍会给出，静默丢弃而不是让整页重试。
        if !options.strength.accepts_category(&cut.cat) {
            continue;
        }
        if cut.cat == "filler" && cut.b - cut.a + 1 > 6 {
            return Err(LlmError::Malformed(
                "filler range exceeds 6 words".to_owned(),
            ));
        }
        let first = &doc.words[page.start + cut.a];
        let last = &doc.words[page.start + cut.b];
        if doc.words[page.start + cut.a..=page.start + cut.b]
            .iter()
            .any(|word| word.sp != first.sp)
        {
            return Err(LlmError::Malformed(
                "cleanup range crosses a speaker boundary".to_owned(),
            ));
        }
        if overlaps(first.t0, last.t1, &options.existing_cuts) {
            return Err(LlmError::Malformed(
                "cleanup range intersects an existing cut".to_owned(),
            ));
        }
        suggestions.push(CleanupSuggestion {
            first_word_id: first.id.clone(),
            last_word_id: last.id.clone(),
            category: cut.cat,
            alternative: cut.alt.filter(|value| !value.trim().is_empty()),
            reason: cut.reason.trim().to_owned(),
            t0: first.t0,
            t1: last.t1,
        });
    }
    Ok(suggestions)
}

pub fn run_cleanup(
    doc: &TranscriptDoc,
    llm: &mut dyn LlmJson,
    options: &CleanupOptions,
    sleep: &mut dyn FnMut(f64),
) -> Result<CleanupArtifact, LlmError> {
    let mut suggestions = Vec::new();
    for page in paginate_word_ranges(&doc.words, PAGE_BUDGET, 200) {
        let rows = doc.words[page.clone()]
            .iter()
            .enumerate()
            .map(|(index, word)| {
                serde_json::json!({
                    "i": index,
                    "text": word.text,
                    "speaker": word.sp,
                    "pauseBefore": (index > 0).then(|| word.t0 - doc.words[page.start + index - 1].t1).unwrap_or(0.0),
                    "alreadyCut": options.existing_cuts.iter().any(|(t0, t1)| word.t0 < *t1 && word.t1 > *t0),
                })
            })
            .collect::<Vec<_>>();
        let user = serde_json::json!({"words": rows}).to_string();
        let page_suggestions = with_retry(MAX_RETRIES, &mut *sleep, |attempt| {
            let raw = llm.complete(&LlmRequest {
                kind: "cleanup",
                system: system_prompt(options),
                user: user.clone(),
                temperature: 0.1,
                attempt: attempt + 1,
                retry_reason: (attempt > 0).then(|| {
                    "the previous cleanup ranges violated deterministic guards".to_owned()
                }),
            })?;
            validate_page(doc, page.clone(), &raw, options)
        })?;
        suggestions.extend(page_suggestions);
    }
    suggestions.sort_by(|left, right| left.t0.total_cmp(&right.t0));
    suggestions.dedup_by(|left, right| {
        left.first_word_id == right.first_word_id && left.last_word_id == right.last_word_id
    });
    Ok(CleanupArtifact {
        fingerprint: fingerprint(&doc.words),
        strength: options.strength,
        suggestions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{DocEngine, DocMedia, TranscriptDoc, Word};
    use crate::llm::FakeLlm;

    fn doc() -> TranscriptDoc {
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
        doc.words = (0..4)
            .map(|index| Word {
                id: format!("w{index}"),
                t0: index as f64 * 0.5,
                t1: index as f64 * 0.5 + 0.4,
                text: ["I", "um", "mean", "yes"][index].into(),
                sp: "s1".into(),
                glue: false,
            })
            .collect();
        doc
    }

    #[test]
    fn cleanup_maps_page_indices_to_word_ids_and_retries_conflicts() {
        let doc = doc();
        let mut llm = FakeLlm::ok([
            r#"{"cuts":[{"a":1,"b":2,"cat":"filler","reason":"hesitation"}]}"#,
            r#"{"cuts":[{"a":0,"b":0,"cat":"falseStart","reason":"restart"}]}"#,
        ]);
        let artifact = run_cleanup(
            &doc,
            &mut llm,
            &CleanupOptions {
                strength: CleanupStrength::Standard,
                instructions: None,
                existing_cuts: vec![(0.5, 1.5)],
            },
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(artifact.suggestions[0].first_word_id, "w0");
        assert_eq!(artifact.suggestions[0].last_word_id, "w0");
        assert_eq!(llm.calls.len(), 2);
    }

    #[test]
    fn cleanup_agent_lint_mirrors_deterministic_guards() {
        let payload = serde_json::json!({
            "words": [
                {"speaker": "s1", "alreadyCut": false},
                {"speaker": "s1", "alreadyCut": false},
                {"speaker": "s1", "alreadyCut": false},
                {"speaker": "s1", "alreadyCut": false},
                {"speaker": "s1", "alreadyCut": false},
                {"speaker": "s1", "alreadyCut": false},
                {"speaker": "s1", "alreadyCut": false},
                {"speaker": "s2", "alreadyCut": true}
            ]
        })
        .to_string();
        let answer = serde_json::json!({
            "cuts": [
                {"a": 8, "b": 8, "cat": "filler", "reason": "outside"},
                {"a": 0, "b": 0, "cat": "silence", "reason": "unknown"},
                {"a": 0, "b": 6, "cat": "filler", "reason": "too long"},
                {"a": 6, "b": 7, "cat": "retake", "reason": "unsafe"}
            ]
        })
        .to_string();

        assert_eq!(
            lint_agent_answer(&payload, &answer),
            vec![
                "cleanup range 8..8 is outside the page",
                "unknown cleanup category silence",
                "filler range exceeds 6 words",
                "cleanup range crosses a speaker boundary",
                "cleanup range intersects an existing cut",
            ]
        );
    }

    #[test]
    fn cleanup_request_carries_strength_instructions_and_structured_markers() {
        let doc = doc();
        let mut llm = FakeLlm::ok([r#"{"cuts":[]}"#]);
        run_cleanup(
            &doc,
            &mut llm,
            &CleanupOptions {
                strength: CleanupStrength::Tight,
                instructions: Some("Keep the product name verbatim.".into()),
                existing_cuts: vec![(0.5, 1.0)],
            },
            &mut |_| {},
        )
        .unwrap();

        let (_, system, user, _) = &llm.calls[0];
        assert!(system.contains("Strength is Tight"));
        assert!(system.contains("Keep the product name verbatim."));
        let payload: serde_json::Value = serde_json::from_str(user).unwrap();
        let words = payload["words"].as_array().unwrap();
        assert_eq!(words[0]["pauseBefore"], 0.0);
        assert!((words[1]["pauseBefore"].as_f64().unwrap() - 0.1).abs() < f64::EPSILON);
        assert_eq!(words[1]["alreadyCut"], true);
        assert_eq!(words[2]["alreadyCut"], false);
    }
}
