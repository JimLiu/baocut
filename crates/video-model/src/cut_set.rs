//! 剪口集合的正文（视频格式规范 §6.7，文档 `kind: 'cut-set'`）：一个源素材上被口播剪辑删掉的区间。
//!
//! 引擎的 `addCuts`、`restoreCut` 改它并按它重排实例；`putDocument` 写入时用 [`cut_set_body_problems`] 核对。

use editor_semantics::Ratio;
use message_ref::{Text, msg};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::Id;

pub const CUT_SET_SCHEMA: &str = "baocut.cut-set/1";
pub const CUT_SET_KIND: &str = "cut-set";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CutSetBody {
    /// `baocut.cut-set/1`。
    pub schema: String,
    /// 每秒的刻度数。
    pub timescale: u64,
    /// `source-asset`：时刻在被剪素材的时钟上。
    pub clock: String,
    /// 按这份剪口排布的实例：源素材在序列上的视频、音频实例。
    pub scope_item_ids: Vec<Id>,
    /// 按 `t0` 排序，互不重叠。
    pub cuts: Vec<Cut>,
}

/// 删掉的源区间 `[t0, t1)`，整数刻度写成十进制字符串。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cut {
    pub id: Id,
    pub t0: String,
    pub t1: String,
    /// 出处：剪辑提案里一条建议的 ID（§6.2）。
    #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
    pub r#ref: Option<Id>,
}

impl Cut {
    /// 剪口在源素材时钟上的精确区间（秒）。刻度不是整数时为 `None`。
    pub fn range(&self, timescale: u64) -> Option<(Ratio, Ratio)> {
        let at = |ticks: &str| Ratio::new(ticks.parse::<i128>().ok()?, i128::from(timescale));
        Some((at(&self.t0)?, at(&self.t1)?))
    }
}

/// 正文与 §6.7 不合的地方（空表示合）：形状、`schema`、`clock`、`timescale`、刻度，剪口按 `t0` 排序、互不重叠（贴边允许）、
/// `0 ≤ t0 < t1`，知道素材时长时 `t1` 不超过它。
pub fn cut_set_body_problems(body: &Value, duration: Option<Ratio>) -> Vec<Text> {
    let parsed = match serde_json::from_value::<CutSetBody>(body.clone()) {
        Ok(parsed) => parsed,
        Err(error) => return vec![msg!("videoModel.bodyShape", "The body has fields of the wrong shape: {error}", error = error.to_string())],
    };
    let mut problems = Vec::new();
    if parsed.schema != CUT_SET_SCHEMA {
        problems.push(msg!("videoModel.schemaMismatch", "schema must be {schema}", schema = CUT_SET_SCHEMA));
    }
    if parsed.clock != "source-asset" {
        problems.push(msg!("videoModel.clockSourceAsset", "clock must be source-asset"));
    }
    if parsed.timescale == 0 || parsed.timescale > editor_semantics::MAX_SAFE_INTEGER as u64 {
        problems.push(msg!("videoModel.timescaleSafeInteger", "timescale must be a positive safe integer"));
        return problems;
    }
    let mut previous: Option<Ratio> = None;
    for cut in &parsed.cuts {
        let Some((t0, t1)) = cut.range(parsed.timescale) else {
            problems.push(msg!("videoModel.cutTicksNotInteger", "t0 and t1 of cut {cut} must be integer ticks", cut = cut.id));
            continue;
        };
        if t0.is_negative() || t1 <= t0 {
            problems.push(msg!("videoModel.cutRangeInvalid", "Cut {cut} must satisfy 0 ≤ t0 < t1", cut = cut.id));
        }
        if duration.is_some_and(|d| t1 > d) {
            problems.push(msg!("videoModel.cutBeyondDuration", "Cut {cut} goes past the end of the asset", cut = cut.id));
        }
        if previous.is_some_and(|end| t0 < end) {
            problems.push(msg!(
                "videoModel.cutOrder",
                "Cut {cut} overlaps the previous one or is not sorted by t0",
                cut = cut.id
            ));
        }
        previous = Some(t1);
    }
    let mut ids: Vec<&str> = parsed.cuts.iter().map(|c| c.id.as_str()).collect();
    ids.sort_unstable();
    if ids.windows(2).any(|w| w[0] == w[1]) {
        problems.push(msg!("videoModel.cutIdsRepeated", "Cut IDs are repeated"));
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn body_round_trips() {
        let value = json!({
            "schema": CUT_SET_SCHEMA, "timescale": 48000, "clock": "source-asset", "scopeItemIds": ["v1"],
            "cuts": [{ "id": "c1", "t0": "48000", "t1": "96000", "ref": "p1" }, { "id": "c2", "t0": "144000", "t1": "150000" }]
        });
        let body: CutSetBody = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(&body).unwrap(), value);
        assert!(cut_set_body_problems(&value, Ratio::new(4, 1)).is_empty());
    }

    #[test]
    fn problems_name_order_overlap_and_duration() {
        let body =
            |cuts: Value| json!({ "schema": CUT_SET_SCHEMA, "timescale": 10, "clock": "source-asset", "scopeItemIds": [], "cuts": cuts });
        let ok = body(json!([{ "id": "a", "t0": "0", "t1": "10" }, { "id": "b", "t0": "10", "t1": "20" }]));
        assert!(cut_set_body_problems(&ok, Ratio::new(2, 1)).is_empty());
        let overlap = body(json!([{ "id": "a", "t0": "0", "t1": "15" }, { "id": "b", "t0": "10", "t1": "20" }]));
        assert_eq!(cut_set_body_problems(&overlap, None).len(), 1);
        let long = body(json!([{ "id": "a", "t0": "0", "t1": "30" }]));
        assert_eq!(cut_set_body_problems(&long, Ratio::new(2, 1)).len(), 1);
        let empty = body(json!([{ "id": "a", "t0": "5", "t1": "5" }]));
        assert_eq!(cut_set_body_problems(&empty, None).len(), 1);
        let ticks = body(json!([{ "id": "a", "t0": "0.5", "t1": "5" }]));
        assert_eq!(cut_set_body_problems(&ticks, None).len(), 1);
    }
}
