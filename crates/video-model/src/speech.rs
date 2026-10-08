//! 转写文档的正文 `baocut.speech/1`（视频格式规范 §5.2）。
//!
//! 字段与 TS 写入方（转写流程、旧项目导入）写出的形状一一对应；这里不认识的字段收进 `extra`，
//! 写回时原样带上（§1.4）。可以是 `null` 的字段（`engine`、`createdAt`、`sentences`、说话人的 `hue`）
//! 区分「没有这个字段」与「值为 null」，读进来再写出去逐字相同。

use std::collections::BTreeMap;

use message_ref::{Text, msg};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

use crate::Id;

pub const SPEECH_SCHEMA: &str = "baocut.speech/1";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechBody {
    pub schema: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clock: Option<String>,
    /// 每秒的刻度数；读的时候没有就按 1 000 000（与 TS 读者相同）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timescale: Option<i64>,
    /// 识别引擎的说明，内容开放：转写流程写 Provider 与模型，旧项目导入写旧格式的引擎对象，或 null。
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "present")]
    pub engine: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "present")]
    pub created_at: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speakers: Option<Vec<SpeechSpeaker>>,
    pub words: Vec<SpeechWord>,
    /// 存下来的句子；null 表示句子按派生规则从词得出。
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "present")]
    pub sentences: Option<Option<Vec<SpeechSentence>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapters: Option<Vec<SpeechChapter>>,
    /// 用户钉的换行：词 ID → 在这个词之前断开或不断开（§5.5）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_breaks: Option<BTreeMap<Id, BreakPin>>,
    /// 自动排版钉的换行，按 LayoutProfile 的 ID 分组（§5.6）；同一个词上用户的 pin 优先。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_breaks: Option<BTreeMap<String, BTreeMap<Id, BreakPin>>>,
    /// 源字幕排版用的 LayoutProfile；没有这个字段时是 `default`（§5.6）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout_profile_id: Option<String>,
    /// 用户钉的分段：这些词开始一个新段落，也是句子的边界（§5.5）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paragraph_breaks: Option<Vec<Id>>,
    /// 各处理阶段提交时的指纹，用来判断之后有没有人工修改（§5.5）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stages: Option<SpeechStages>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechSpeaker {
    pub id: Id,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "present")]
    pub hue: Option<Option<u32>>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechWord {
    pub id: Id,
    /// 源时间，单位是正文的 `timescale`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<i64>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing_quality: Option<TimingQuality>,
    /// 这个词与前一个词之间不加空格，不论拼接规则怎么判（§5.2）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glue: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TimingQuality {
    Aligned,
    Provider,
    Estimated,
    Missing,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechSentence {
    pub id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub word_ids: Option<Vec<Id>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paragraph_start: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechChapter {
    pub id: Id,
    pub title: String,
    pub start: i64,
    pub end: i64,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BreakPin {
    Break,
    NoBreak,
}

/// 阶段指纹（§5.5）。指纹的写法由写入它的引擎决定，这里只原样保存。
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechStages {
    /// 转写完成时文本的指纹。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asr: Option<String>,
    /// 转写完成时换行、分段与隐藏的指纹。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asr_layout: Option<String>,
    /// 润色提交时文本的指纹。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub polish: Option<String>,
    /// 分段提交时词 ID 序列的指纹。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment: Option<String>,
    /// 章节提交时文本的指纹。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapters: Option<String>,
    /// 词时间来自文稿强制对齐而不是识别。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aligned: Option<AlignedStage>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignedStage {
    /// 目前只有 `script`。
    pub mode: String,
    /// 对齐到有效时长的字符占文稿字符的比例，0–1。
    pub coverage: f64,
    /// 时长塌成 0、需要复核的词。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub low_confidence: Option<Vec<Id>>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// 字段出现了就是 `Some`，值为 null 时是 `Some(None)` 或 `Some(Value::Null)`；没有这个字段时由 `default` 给 `None`。
pub(crate) fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

/// 只核对本规范为 `baocut.speech/1` 补充的字段（§5.2）：它们出现时形状必须对。别的字段不在这里校验，
/// 已有的写入方照常可以写。
pub fn speech_body_problems(body: &Value) -> Vec<Text> {
    // 这些结构只用来核对形状：读得进来就对，有的字段读进来之后不再看。
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    #[allow(dead_code)]
    struct Additions {
        #[serde(default)]
        words: Option<Vec<WordAdditions>>,
        #[serde(default)]
        user_breaks: Option<BTreeMap<Id, BreakPin>>,
        #[serde(default)]
        auto_breaks: Option<BTreeMap<String, BTreeMap<Id, BreakPin>>>,
        #[serde(default)]
        layout_profile_id: Option<String>,
        #[serde(default)]
        paragraph_breaks: Option<Vec<Id>>,
        #[serde(default)]
        stages: Option<SpeechStages>,
    }
    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct WordAdditions {
        #[serde(default)]
        glue: Option<bool>,
    }
    let mut problems = Vec::new();
    match serde_json::from_value::<Additions>(body.clone()) {
        Ok(additions) => {
            if additions.layout_profile_id.as_deref() == Some("") {
                problems.push(msg!("videoModel.layoutProfileEmpty", "layoutProfileId cannot be an empty string"));
            }
            if let Some(coverage) = additions.stages.as_ref().and_then(|s| s.aligned.as_ref()).map(|a| a.coverage)
                && !(0.0..=1.0).contains(&coverage)
            {
                problems.push(msg!("videoModel.coverageRange", "stages.aligned.coverage must be between 0 and 1"));
            }
        }
        Err(error) => problems.push(msg!("videoModel.bodyShape", "The body has fields of the wrong shape: {error}", error = error.to_string())),
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn null_and_missing_fields_round_trip_verbatim() {
        let body = json!({
            "schema": "baocut.speech/1",
            "clock": "source-asset",
            "timescale": 1_000_000,
            "engine": null,
            "createdAt": null,
            "speakers": [{ "id": "s1", "name": "A", "hue": null }, { "id": "s2", "name": "B" }],
            "words": [{ "id": "w1", "start": 0, "end": 10, "text": "hi", "speaker": "s1", "custom": 1 }],
            "sentences": null,
            "chapters": [],
            "legacy": { "breakPins": {}, "paragraphPins": [] }
        });
        let parsed: SpeechBody = serde_json::from_value(body.clone()).unwrap();
        assert_eq!(parsed.engine, Some(Value::Null));
        assert_eq!(parsed.created_at, Some(None));
        assert_eq!(parsed.sentences, Some(None));
        assert_eq!(parsed.speakers.as_ref().unwrap()[0].hue, Some(None));
        assert_eq!(parsed.speakers.as_ref().unwrap()[1].hue, None);
        assert_eq!(serde_json::to_value(&parsed).unwrap(), body);

        let minimal = json!({ "schema": "baocut.speech/1", "words": [] });
        let parsed: SpeechBody = serde_json::from_value(minimal.clone()).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), minimal);
    }

    #[test]
    fn added_fields_are_checked_only_for_shape() {
        let good = json!({
            "schema": "baocut.speech/1",
            "words": [{ "id": "w1", "text": "a", "glue": true }],
            "userBreaks": { "w1": "no-break", "gone": "break" },
            "autoBreaks": { "default": { "w1": "break" } },
            "layoutProfileId": "default",
            "paragraphBreaks": ["w1"],
            "stages": { "asr": "1:a:a:x", "aligned": { "mode": "script", "coverage": 0.9 } }
        });
        assert!(speech_body_problems(&good).is_empty());
        for bad in [
            json!({ "words": [{ "id": "w1", "glue": "yes" }] }),
            json!({ "userBreaks": { "w1": "nobreak" } }),
            json!({ "autoBreaks": { "default": ["w1"] } }),
            json!({ "paragraphBreaks": { "w1": true } }),
            json!({ "layoutProfileId": "" }),
            json!({ "stages": { "aligned": { "mode": "script", "coverage": 2 } } }),
        ] {
            assert!(!speech_body_problems(&bad).is_empty(), "{bad}");
        }
    }
}
