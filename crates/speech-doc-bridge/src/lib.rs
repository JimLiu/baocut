//! v2 的 `TranscriptDoc`（`speech-doc` 原样移植的文稿模型）与 v3 的转写、译文文档之间的无损映射
//! （视频格式规范 §5.2、§5.3；架构设计 §7.9）。
//!
//! - [`to_transcript_doc`]：v3 的转写正文 + 各语言的译文正文 + 素材的事实 → `TranscriptDoc`，交给字幕与翻译核心计算；
//! - [`from_transcript_doc`]：算完的 `TranscriptDoc` + 写入前的 v3 正文（底稿）→ 新的 v3 正文；
//! - [`sentences::source_sentences`]：转写正文 → 核心规则下的句子与原文指纹（翻译、核对与界面共用）。
//!
//! 两个方向都是纯函数，不读写存储。底稿里有、`TranscriptDoc` 装不下的东西（不认识的字段、v3 才有的标记）
//! 按 ID 从底稿带回去；所以写回时总是传入读出时的那份正文。

pub mod sentences;
mod speech;
pub mod time;
mod translation;

use std::fmt;

use editor_semantics::MediaTime;
use speech_doc::TranscriptDoc;
use video_model::Id;
use video_model::speech::SpeechBody;
use video_model::translation::{SourceBasis, TranslationBody};

/// 转写所属素材的事实（视频格式规范 §4.1），由调用方从 `AssetRecord` 取。
#[derive(Clone, Debug, PartialEq)]
pub struct MediaFacts {
    /// 转写文档头的 `sourceAssetId`。
    pub asset_id: Option<Id>,
    /// 素材的本机路径（`storage.locator.path`），没有时省略。
    pub path: Option<String>,
    pub content_hash: String,
    pub duration: MediaTime,
    pub sample_rate: Option<u32>,
}

/// 读出的 v3 文档：一份转写与它的各语言译文。
#[derive(Clone, Copy, Debug)]
pub struct V3Documents<'a> {
    pub media: &'a MediaFacts,
    /// 转写文档头的 `language`。
    pub language: Option<&'a str>,
    pub speech: &'a SpeechBody,
    pub translations: &'a [TranslationBody],
}

/// 写回时的底稿：读出时的那几份正文。没有底稿的转写或译文按新文档写。
#[derive(Clone, Copy, Debug, Default)]
pub struct WriteBase<'a> {
    pub speech: Option<&'a SpeechBody>,
    pub translations: &'a [TranslationBody],
    /// 新语言的译文用的 `sourceBasis`；已有译文沿用它自己的。
    pub source_basis: Option<&'a SourceBasis>,
}

/// 写回的结果。是否保存、保存成哪些文档版本由调用方决定。
#[derive(Clone, Debug, PartialEq)]
pub struct V3Write {
    /// 转写文档头的 `language`；`und` 写成没有。
    pub language: Option<String>,
    pub speech: SpeechBody,
    /// 按底稿的顺序，新语言排在后面。
    pub translations: Vec<TranslationBody>,
    /// 底稿里有、`TranscriptDoc` 里已经没有的译文语言。删不删那份文档由调用方决定。
    pub removed_languages: Vec<String>,
    pub report: WriteReport,
}

/// 写回时发生的取整与丢弃。
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WriteReport {
    /// 换成刻度时发生取整的时间个数（§2.10）。
    pub rounded_times: usize,
    /// 取整造成的最大偏差（秒）。
    pub max_rounding_error_seconds: f64,
    /// v3 的格式装不下、被丢掉的内容，一条一句。
    pub dropped: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BridgeError {
    pub message: String,
}

impl BridgeError {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self { message: message.into() }
    }
}

impl fmt::Display for BridgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for BridgeError {}

/// v3 → `TranscriptDoc`。
pub fn to_transcript_doc(docs: &V3Documents<'_>) -> Result<TranscriptDoc, BridgeError> {
    let mut doc = speech::to_doc(docs.media, docs.language, docs.speech)?;
    translation::to_doc(&mut doc, docs.translations)?;
    Ok(doc)
}

/// `TranscriptDoc` → v3。`doc.media` 不写回：素材的事实归 `AssetRecord`。
pub fn from_transcript_doc(doc: &TranscriptDoc, base: &WriteBase<'_>) -> Result<V3Write, BridgeError> {
    let mut report = WriteReport::default();
    let (language, speech) = speech::from_doc(doc, base.speech, &mut report)?;
    let (translations, removed_languages) = translation::from_doc(doc, base)?;
    Ok(V3Write {
        language,
        speech,
        translations,
        removed_languages,
        report,
    })
}
