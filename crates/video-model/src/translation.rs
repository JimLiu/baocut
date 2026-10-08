//! 译文文档的正文 `baocut.translation/2`（视频格式规范 §5.3）。
//!
//! 不认识的字段收进 `extra`，写回时原样带上（§1.4）。`glossaryRef` 只原样保存，这里不解释。

use message_ref::{Text, msg};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{Id, VersionRef};

pub const TRANSLATION_SCHEMA: &str = "baocut.translation/2";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationBody {
    pub schema: String,
    pub language: String,
    pub source_basis: SourceBasis,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glossary_ref: Option<Value>,
    pub units: Vec<TranslationUnit>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceBasis {
    pub speech_ref: VersionRef,
    pub sequence_id: Id,
    pub scope_lineage: Vec<Id>,
    pub edit_view_hash: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationUnit {
    pub id: Id,
    pub source_sentence_id: Id,
    /// 源句的内容指纹；空字符串表示没有记下指纹。两种写法见 §5.3。
    pub source_fingerprint: String,
    pub natural_text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_rewrite: Option<DisplayRewrite>,
    /// 必有的字段，可以是 null。
    #[serde(default)]
    pub alignment: Option<UnitAlignment>,
    pub status: UnitStatus,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnitStatus {
    Draft,
    Reviewed,
    Stale,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayRewrite {
    pub text: String,
    pub reason: String,
    pub reviewed: bool,
    /// 改写依据的自然译句的指纹；自然译句改了，改写就过期（§5.3）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub natural_fingerprint: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitAlignment {
    pub basis: AlignmentBasis,
    pub correspondence: Correspondence,
    pub blocks: Vec<AlignmentBlock>,
    pub source_word_ids: Vec<Id>,
    pub text_hash: String,
    /// 字幕上怎么把这句译文切成几片显示（§5.3）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split: Option<AlignmentSplit>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AlignmentBasis {
    Natural,
    DisplayRewrite,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Correspondence {
    Block,
    Sentence,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentBlock {
    pub id: Id,
    pub source_word_range: SourceWordRange,
    pub target_text_range: TargetTextRange,
    /// 支撑这一块两侧边界的对齐边的最小权重，0–1；没有时是未知或确定性构造。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    /// `local-reorder`（块内有交叉）、`anchor`（含硬锚）、`weak`（只有软边）等。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flags: Option<Vec<String>>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceWordRange {
    pub first_word_id: Id,
    pub last_word_id: Id,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TargetTextRange {
    pub start: u64,
    pub end: u64,
}

/// 显示切分（§5.3）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentSplit {
    pub mode: SplitMode,
    /// 为真时片的 `from`/`to` 与块的源侧下标指 `sourceWordIds`；为假时指源句现在的可见词。
    pub word_anchored: bool,
    /// 写入方明确给出的对应粒度；没有时由 `mode` 与 `wordAnchored` 推出，结果就是 `alignment.correspondence`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correspondence: Option<Correspondence>,
    /// 对齐边的来源，如 `deterministic/1`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aligner: Option<String>,
    pub pieces: Vec<SplitPiece>,
    /// 旧项目留下的、只为无损导入保存的字段，不再解释。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legacy: Option<SplitLegacy>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SplitMode {
    Independent,
    ManyToOne,
    OneToOne,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SplitPiece {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitLegacy {
    /// 旧的语序交叉标记：为真时这句只按整句对应。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crossing: Option<bool>,
    /// 旧的源字幕行快照。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cue_ids: Option<Vec<Id>>,
}

/// 只核对本规范为 `baocut.translation/2` 补充的字段（§5.3）：`displayRewrite.naturalFingerprint`、
/// `alignment.split`、对齐块的 `confidence` 与 `flags`。别的字段不在这里校验。
pub fn translation_body_problems(body: &Value) -> Vec<Text> {
    // 这些结构只用来核对形状：读得进来就对，有的字段读进来之后不再看。
    #[derive(Deserialize)]
    struct Additions {
        #[serde(default)]
        units: Option<Vec<UnitAdditions>>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    #[allow(dead_code)]
    struct UnitAdditions {
        #[serde(default)]
        display_rewrite: Option<DisplayRewriteAdditions>,
        #[serde(default)]
        alignment: Option<AlignmentAdditions>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    #[allow(dead_code)]
    struct DisplayRewriteAdditions {
        #[serde(default)]
        natural_fingerprint: Option<String>,
    }
    #[derive(Deserialize)]
    struct AlignmentAdditions {
        #[serde(default)]
        blocks: Option<Vec<BlockAdditions>>,
        #[serde(default)]
        split: Option<AlignmentSplit>,
    }
    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct BlockAdditions {
        #[serde(default)]
        confidence: Option<f64>,
        #[serde(default)]
        flags: Option<Vec<String>>,
    }
    let mut problems = Vec::new();
    let additions = match serde_json::from_value::<Additions>(body.clone()) {
        Ok(additions) => additions,
        Err(error) => return vec![msg!("videoModel.bodyShape", "The body has fields of the wrong shape: {error}", error = error.to_string())],
    };
    for (index, unit) in additions.units.unwrap_or_default().into_iter().enumerate() {
        let Some(alignment) = unit.alignment else { continue };
        for block in alignment.blocks.unwrap_or_default() {
            if block.confidence.is_some_and(|c| !(0.0..=1.0).contains(&c)) {
                problems.push(msg!(
                    "videoModel.blockConfidence",
                    "confidence of the alignment blocks in units[{index}] must be between 0 and 1",
                    index
                ));
            }
        }
        if let Some(split) = alignment.split {
            if split.pieces.is_empty() {
                problems.push(msg!("videoModel.splitPiecesEmpty", "alignment.split.pieces in units[{index}] cannot be empty", index));
            }
            if split
                .pieces
                .iter()
                .any(|p| matches!((p.from, p.to), (Some(from), Some(to)) if from > to))
            {
                problems.push(msg!(
                    "videoModel.splitPieceOrder",
                    "alignment.split.pieces in units[{index}] has a piece whose from is greater than to",
                    index
                ));
            }
        }
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn unit(alignment: Value) -> Value {
        json!({
            "schema": "baocut.translation/2",
            "language": "zh",
            "sourceBasis": { "speechRef": { "id": "d1", "revision": "r1" }, "sequenceId": "q1", "scopeLineage": [], "editViewHash": "sha256:0" },
            "units": [{
                "id": "t-s-w1", "sourceSentenceId": "s-w1", "sourceFingerprint": "", "naturalText": "你好",
                "displayRewrite": { "text": "你好", "reason": "monotonic-rewrite", "reviewed": false, "naturalFingerprint": "1:a:a:x" },
                "alignment": alignment, "status": "draft"
            }]
        })
    }

    #[test]
    fn bodies_round_trip_verbatim() {
        let split = json!({
            "basis": "display-rewrite", "correspondence": "block", "sourceWordIds": ["w1", "w2"], "textHash": "sha256:1",
            "blocks": [{ "id": "b1", "sourceWordRange": { "firstWordId": "w1", "lastWordId": "w2" },
                         "targetTextRange": { "start": 0, "end": 2 }, "confidence": 0.9, "flags": ["anchor"] }],
            "split": { "mode": "many-to-one", "wordAnchored": true, "aligner": "deterministic/1",
                       "pieces": [{ "text": "你好", "from": 0, "to": 1 }], "legacy": { "crossing": true, "cueIds": ["q-w1"] } },
            "extraField": [1]
        });
        for body in [unit(split), unit(Value::Null)] {
            let parsed: TranslationBody = serde_json::from_value(body.clone()).unwrap();
            assert_eq!(serde_json::to_value(&parsed).unwrap(), body);
            assert!(translation_body_problems(&body).is_empty());
        }
    }

    #[test]
    fn added_fields_are_checked_only_for_shape() {
        for bad in [
            json!({ "units": [{ "displayRewrite": { "naturalFingerprint": 3 } }] }),
            json!({ "units": [{ "alignment": { "blocks": [{ "confidence": 2 }] } }] }),
            json!({ "units": [{ "alignment": { "blocks": [{ "flags": "weak" }] } }] }),
            json!({ "units": [{ "alignment": { "split": { "mode": "manyToOne", "wordAnchored": false, "pieces": [{ "text": "a" }] } } }] }),
            json!({ "units": [{ "alignment": { "split": { "mode": "independent", "wordAnchored": false, "pieces": [] } } }] }),
            json!({ "units": [{ "alignment": { "split": { "mode": "independent", "wordAnchored": false, "pieces": [{ "text": "a", "from": 2, "to": 1 }] } } }] }),
        ] {
            assert!(!translation_body_problems(&bad).is_empty(), "{bad}");
        }
        // 只有已有字段、没有补充字段的正文不受影响。
        assert!(translation_body_problems(&json!({ "units": [{ "alignment": null }] })).is_empty());
    }
}
