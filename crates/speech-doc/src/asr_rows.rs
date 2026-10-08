//! 转录行与词的输入契约：词化构建器（[`crate::build`]）与说话人、初始分段等
//! 模块读的 ASR 行。
//!
//! 移植自 BaoCut v2 `bcut-speech-core`：`RowIn` / `WordIn` 来自 `types.rs`，
//! `RowSegmentation` 来自 `transcript.rs`，内容原样。

use serde::{Deserialize, Serialize};

/// 应用层词时间（绝对 f64 秒）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WordIn {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// 统一转录行。没有真实词时间时 `words` 为 `None`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RowIn {
    pub start: f64,
    pub end: f64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<WordIn>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
}

impl RowIn {
    pub fn new(start: f64, end: f64, text: impl Into<String>) -> Self {
        Self {
            start,
            end,
            text: text.into(),
            words: None,
            speaker: None,
        }
    }
}

/// `ai/asr-rows.json` 中行边界的实际来源。
///
/// 这不是段落语义，只让首个生产读者判断这些 row 是否适合生成转录完成后的
/// 初始软分段。字段可选，旧审计产物保持可读。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RowSegmentation {
    Model,
    Provider,
    Host,
    Vad,
    Synthetic,
}
