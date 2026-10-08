//! 剪辑提案的正文（视频格式规范 §6.2，文档 `kind: 'editorial-proposal'`）：一个源素材上建议剪掉的区间。
//!
//! 引擎的 `proposeCuts` 按转写检测口癖与长停顿写出它，`acceptCutSuggestions` 把接受的建议编译成剪口（`ref` 是建议的 ID）
//! 并把它们标成 `accepted`；`putDocument` 写入时用 [`editorial_proposal_body_problems`] 核对。

use editor_semantics::Ratio;
use message_ref::{Text, msg};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::Id;

pub const EDITORIAL_PROPOSAL_SCHEMA: &str = "baocut.editorial-proposal/1";
pub const EDITORIAL_PROPOSAL_KIND: &str = "editorial-proposal";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorialProposalBody {
    /// `baocut.editorial-proposal/1`。
    pub schema: String,
    /// 每秒的刻度数。
    pub timescale: u64,
    /// `source-asset`：时刻在被剪素材的时钟上。
    pub clock: String,
    /// 检测读的转写版本：转写之后改过时建议过期，不能再接受。
    pub speech_ref: ProposalSpeechRef,
    /// 按 `t0` 排序。
    pub suggestions: Vec<Suggestion>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalSpeechRef {
    pub id: Id,
    pub revision: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SuggestionKind {
    /// 口癖：`wordIds` 是被剪的词。
    Filler,
    /// 长停顿：压缩到保留的长度，`afterWordId` 是停顿之前的词。
    Pause,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SuggestionStatus {
    Pending,
    Accepted,
}

/// 一条建议：建议剪掉的源区间 `[t0, t1)`，整数刻度写成十进制字符串。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub id: Id,
    pub kind: SuggestionKind,
    pub t0: String,
    pub t1: String,
    /// 区间里的词（口癖）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub word_ids: Vec<Id>,
    /// 停顿之前的词（停顿）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_word_id: Option<Id>,
    /// 区间里的文字：口癖是这些词的原文，停顿为空。
    pub text: String,
    /// 理由：检测器写的短句，原样展示。
    pub reason: String,
    /// 补充说明，如停顿压缩前后的长度。
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub detail: String,
    /// 0–1；检测器给不出时没有。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    pub status: SuggestionStatus,
}

impl Suggestion {
    /// 建议在源素材时钟上的精确区间（秒）。刻度不是整数时为 `None`。
    pub fn range(&self, timescale: u64) -> Option<(Ratio, Ratio)> {
        let at = |ticks: &str| Ratio::new(ticks.parse::<i128>().ok()?, i128::from(timescale));
        Some((at(&self.t0)?, at(&self.t1)?))
    }
}

/// 正文与 §6.2 不合的地方（空表示合）：形状、`schema`、`clock`、`timescale`、刻度、`0 ≤ t0 < t1`、按 `t0` 排序、
/// `confidence` 在 0–1 之间、建议的 id 不重复。建议之间可以重叠。
pub fn editorial_proposal_body_problems(body: &Value) -> Vec<Text> {
    let parsed = match serde_json::from_value::<EditorialProposalBody>(body.clone()) {
        Ok(parsed) => parsed,
        Err(error) => return vec![msg!("videoModel.bodyShape", "The body has fields of the wrong shape: {error}", error = error.to_string())],
    };
    let mut problems = Vec::new();
    if parsed.schema != EDITORIAL_PROPOSAL_SCHEMA {
        problems.push(msg!("videoModel.schemaMismatch", "schema must be {schema}", schema = EDITORIAL_PROPOSAL_SCHEMA));
    }
    if parsed.clock != "source-asset" {
        problems.push(msg!("videoModel.clockSourceAsset", "clock must be source-asset"));
    }
    if parsed.timescale == 0 || parsed.timescale > editor_semantics::MAX_SAFE_INTEGER as u64 {
        problems.push(msg!("videoModel.timescaleSafeInteger", "timescale must be a positive safe integer"));
        return problems;
    }
    let mut previous: Option<Ratio> = None;
    for s in &parsed.suggestions {
        let Some((t0, t1)) = s.range(parsed.timescale) else {
            problems.push(msg!(
                "videoModel.suggestionTicksNotInteger",
                "t0 and t1 of suggestion {suggestion} must be integer ticks",
                suggestion = s.id
            ));
            continue;
        };
        if t0.is_negative() || t1 <= t0 {
            problems.push(msg!("videoModel.suggestionRangeInvalid", "Suggestion {suggestion} must satisfy 0 ≤ t0 < t1", suggestion = s.id));
        }
        if previous.is_some_and(|p| t0 < p) {
            problems.push(msg!("videoModel.suggestionOrder", "Suggestion {suggestion} is not sorted by t0", suggestion = s.id));
        }
        previous = Some(t0);
        if s.confidence.is_some_and(|c| !(0.0..=1.0).contains(&c)) {
            problems.push(msg!(
                "videoModel.suggestionConfidence",
                "confidence of suggestion {suggestion} must be between 0 and 1",
                suggestion = s.id
            ));
        }
    }
    let mut ids: Vec<&str> = parsed.suggestions.iter().map(|s| s.id.as_str()).collect();
    ids.sort_unstable();
    if ids.windows(2).any(|w| w[0] == w[1]) {
        problems.push(msg!("videoModel.suggestionIdsRepeated", "Suggestion IDs are repeated"));
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn body(suggestions: Value) -> Value {
        json!({ "schema": EDITORIAL_PROPOSAL_SCHEMA, "timescale": 1000, "clock": "source-asset",
                "speechRef": { "id": "doc_1", "revision": "1" }, "suggestions": suggestions })
    }

    #[test]
    fn body_round_trips() {
        let value = body(json!([
            { "id": "cut-fl-w1", "kind": "filler", "t0": "1000", "t1": "1400", "wordIds": ["w1"], "text": "um",
              "reason": "Filler word", "detail": "“um”", "status": "pending" },
            { "id": "cut-sl-w2", "kind": "pause", "t0": "2150", "t1": "3850", "afterWordId": "w2", "text": "",
              "reason": "Pause", "detail": "2.0s → 0.3s", "confidence": 0.5, "status": "accepted" },
        ]));
        let parsed: EditorialProposalBody = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), value);
        assert!(editorial_proposal_body_problems(&value).is_empty());
    }

    #[test]
    fn problems_name_ticks_order_confidence_and_ids() {
        let one = |id: &str, t0: &str, t1: &str| json!({ "id": id, "kind": "pause", "t0": t0, "t1": t1, "text": "", "reason": "Pause", "status": "pending" });
        assert_eq!(editorial_proposal_body_problems(&body(json!([one("a", "5", "5")]))).len(), 1);
        assert_eq!(editorial_proposal_body_problems(&body(json!([one("a", "0.5", "5")]))).len(), 1);
        assert_eq!(
            editorial_proposal_body_problems(&body(json!([one("a", "10", "20"), one("b", "0", "5")]))).len(),
            1
        );
        assert_eq!(
            editorial_proposal_body_problems(&body(json!([one("a", "0", "5"), one("a", "6", "9")]))).len(),
            1
        );
        let mut far = one("a", "0", "5");
        far["confidence"] = json!(2);
        assert_eq!(editorial_proposal_body_problems(&body(json!([far]))).len(), 1);
        // 不认识的建议类别（重复片段还没有检测器）：形状不对。
        let repeat = json!([{ "id": "a", "kind": "repeat", "t0": "0", "t1": "1", "text": "", "reason": "", "status": "pending" }]);
        assert_eq!(editorial_proposal_body_problems(&body(repeat)).len(), 1);
    }
}
