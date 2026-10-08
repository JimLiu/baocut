//! 冻结的输入：Runtime 在启动这一步时写进 staging 的 JSON（命令协议规范 §4.5）。

use std::path::Path;

use editor_semantics::MediaTime;
use serde::Deserialize;
use serde_json::Value;
use video_model::speech::SpeechBody;
use video_model::{Id, VersionRef};

use crate::Failure;

pub const INPUT_SCHEMA: &str = "baocut.speech-worker.translate/1";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranslateInput {
    pub schema: String,
    pub media: Media,
    /// 转写文档头的 `language`；不知道时 null。
    pub source_language: Option<String>,
    pub speech_ref: VersionRef,
    pub sequence_id: Id,
    pub speech: SpeechBody,
    pub target_language: String,
    /// 启动时冻结的术语（调用时给的与视频里启用的，已去重）。
    #[serde(default)]
    pub glossary: Vec<GlossaryTerm>,
    /// 原样写进译文正文的 `glossaryRef`（§5.3）；没有术语表时 null。
    #[serde(default)]
    pub glossary_ref: Option<Value>,
    #[serde(default)]
    pub params: Params,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Media {
    pub asset_id: Option<Id>,
    #[serde(default)]
    pub path: Option<String>,
    pub content_hash: String,
    pub duration: MediaTime,
    #[serde(default)]
    pub sample_rate: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GlossaryTerm {
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Params {
    /// 风格提示（`translate` 的 `style`），进核心的显式用户指令。
    #[serde(default)]
    pub instructions: Option<String>,
    /// 退避时长的倍数（默认 1）；测试给 0。
    #[serde(default = "one")]
    pub backoff_scale: f64,
}

impl Default for Params {
    fn default() -> Params {
        Params {
            instructions: None,
            backoff_scale: 1.0,
        }
    }
}

fn one() -> f64 {
    1.0
}

impl TranslateInput {
    pub fn load(path: &Path) -> Result<TranslateInput, Failure> {
        let bytes = std::fs::read(path).map_err(|error| Failure::new("INPUT_UNREADABLE", format!("读不了冻结的输入：{error}")))?;
        let input: TranslateInput =
            serde_json::from_slice(&bytes).map_err(|error| Failure::new("INPUT_UNREADABLE", format!("冻结的输入不合格式：{error}")))?;
        if input.schema != INPUT_SCHEMA {
            return Err(Failure::new("INPUT_UNREADABLE", format!("冻结的输入的 schema 应为 {INPUT_SCHEMA}")));
        }
        let lang = &input.target_language;
        if lang.is_empty() || lang.len() > 35 || !lang.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-') {
            return Err(Failure::new("INPUT_UNREADABLE", format!("目标语言不是 BCP 47 标签：{lang}")));
        }
        if !(input.params.backoff_scale >= 0.0 && input.params.backoff_scale.is_finite()) {
            return Err(Failure::new("INPUT_UNREADABLE", "params.backoffScale 应为非负数"));
        }
        Ok(input)
    }
}
