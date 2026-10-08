//! 语音识别的纯逻辑：不做 I/O，不依赖推理框架。后端经 [`StreamingVad`] 与 [`SpeechRecognizer`]（自己切段的模型经
//! [`SegmentingRecognizer`]）接入。
//!
//! `hint`、`moss_parse`、`refine`、`speaker_cluster`、`timestamp`、`vad_binarize` 与本文件末尾的数据合同
//! 从 v2 `bcut-speech-core` 原样移植；`moss_common`（MOSS 的分块生成与重复检测）与 `moss_speakers`（跨块说话人合并）
//! 从 v2 `bcut-speech` 与 `bcut-transcribe` 原样移植（架构设计 §6.5、§14）。`pyannote_common`（Pyannote 分段的解码与
//! 声纹聚类）从 v2 `bcut-speech` 原样移植，`speaker_projection`（说话人区间 → 词）从 v2 `bcut-kernel` 原样移植（§6.6）。

pub mod align_common;
pub mod autolang;
pub mod decoding;
pub mod hint;
pub mod language;
pub mod mel;
pub mod moss_common;
pub mod moss_parse;
pub mod moss_speakers;
pub mod pyannote_common;
pub mod qwen3_asr;
pub mod refine;
pub mod segmenter;
pub mod speaker_cluster;
pub mod speaker_projection;
pub mod text_prep;
pub mod timestamp;
pub mod tokenizer;
pub mod vad_binarize;
pub mod vad_stream;
pub mod wespeaker_fbank;
pub mod whisper_decoding;
pub mod word_timing;

use serde::{Deserialize, Serialize};

pub use moss_parse::SpeakerRange;
pub use segmenter::SpeechSpan;
pub use vad_stream::{StreamingVad, VadConfig};

/// 一次识别的参数。
#[derive(Debug, Clone, Copy, Default)]
pub struct RecognitionRequest<'a> {
    /// 规范语言码（`en`、`zh`、`yue`…）；`None` 交给模型自动识别。
    pub language: Option<&'a str>,
    /// 术语与上下文提示，进模型的 system 段。
    pub context: Option<&'a str>,
}

/// 一次识别的结果。
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Recognition {
    pub text: String,
    /// 模型自己报出的语言名（Qwen3-ASR 自动识别时输出 `language English`）。
    pub language_name: Option<String>,
    /// 加了重复惩罚重试之后仍像复读。
    pub degenerate: bool,
}

/// 一段音频（16 kHz 单声道）→ 文本。
pub trait SpeechRecognizer {
    fn recognize(&mut self, audio: &[f32], request: &RecognitionRequest<'_>) -> anyhow::Result<Recognition>;
}

/// 自己切段的识别器（MOSS-Transcribe-Diarize）：整段音频（16 kHz 单声道）进，带绝对时间、可能带说话人标签的
/// 行出。不经 VAD，分块、断句由模型自己做。
pub trait SegmentingRecognizer {
    /// `language` 是断言的规范语言码；`None` 交给模型自己判断。取消时返回的错误能 `downcast_ref` 出
    /// [`SegmentingCancelled`]。
    fn transcribe(
        &mut self,
        audio: &[f32],
        language: Option<&str>,
        callbacks: &mut SegmentingCallbacks<'_>,
    ) -> anyhow::Result<SegmentedTranscription>;
}

/// 自己切段的识别器的结构化输出；`rows` 已带绝对时间（相对送入音频的起点）与说话人标签。
#[derive(Debug, Clone, Default)]
pub struct SegmentedTranscription {
    pub text: String,
    pub rows: Vec<RowIn>,
    pub speaker_ranges: Vec<SpeakerRange>,
    pub generation_tokens: usize,
    /// 转录成功但有一段没写完整之类的提示。
    pub warnings: Vec<String>,
}

/// 自己切段的识别过程的观测与中止钩子。
#[derive(Default)]
pub struct SegmentingCallbacks<'a> {
    /// (已覆盖音频秒数, 音频总秒数)，单调不减。
    pub on_progress: Option<&'a mut dyn FnMut(f64, f64)>,
    /// 流式解析出的整句（时间戳已加上块偏移，是全局时间轴）。
    pub on_segment: Option<&'a mut dyn FnMut(&LiveSegment)>,
    /// 返回 true 表示请求中止。
    pub should_cancel: Option<&'a mut dyn FnMut() -> bool>,
}

impl SegmentingCallbacks<'_> {
    pub fn none() -> Self {
        Self::default()
    }

    pub fn cancelled(&mut self) -> bool {
        self.should_cancel.as_deref_mut().is_some_and(|callback| callback())
    }
}

/// 取消时的错误载荷，调用方可用 anyhow 的 `downcast_ref` 识别。
#[derive(Debug, Clone, Copy)]
pub struct SegmentingCancelled;

impl std::fmt::Display for SegmentingCancelled {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("转录已取消")
    }
}

impl std::error::Error for SegmentingCancelled {}

// ---- 以下移植自 v2 `bcut-speech-core` 的 `types.rs` 与 `traits.rs` ----------------------------

/// 推理层返回的相对词时间（f32 秒）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AlignedWord {
    pub text: String,
    pub start: f32,
    pub end: f32,
}

/// VAD 推理层返回的相对语音区间（f32 秒）。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SpeechSegment {
    pub start: f32,
    pub end: f32,
}

impl SpeechSegment {
    pub fn duration(self) -> f32 {
        self.end - self.start
    }
}

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiveSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

pub trait ForcedAlignment {
    fn align(&mut self, audio: &[f32], text: &str, language: Option<&str>) -> anyhow::Result<Vec<AlignedWord>>;

    fn align_long(&mut self, audio: &[f32], text: &str, language: Option<&str>) -> anyhow::Result<Vec<AlignedWord>> {
        self.align(audio, text, language)
    }
}

/// 说话人嵌入（16 kHz 单声道 → L2 归一化的向量）。WeSpeaker 的 MLX 实现在 `backend::mlx::wespeaker`；按段提取嵌入、
/// 聚类（[`speaker_cluster`]）的调用方是自分段模型（MOSS）的说话人合并。
pub trait SpeakerEmbedding {
    /// 太短的输入（WeSpeaker 少于 0.5 秒）报错，由调用方先过滤。
    fn embed(&mut self, samples: &[f32]) -> anyhow::Result<Vec<f32>>;
}

/// 说话人区分（Pyannote 分段 + WeSpeaker 声纹聚类）：整段 16 kHz 单声道音频 → 全局说话人区间。MLX 与 candle 各有
/// 一份实现（`backend::mlx::pyannote`、`backend::candle::pyannote`），解码与聚类都在 [`pyannote_common`]。
/// 转录模型自己不区分说话人（Qwen3-ASR、Whisper）时，识别完成后由转录作业调用（架构设计 §6.6）。
pub trait SpeakerDiarization {
    /// 取消时返回的错误可 `downcast_ref::<pyannote_common::PyannoteCancelled>()`。
    fn diarize(
        &mut self,
        samples: &[f32],
        options: &pyannote_common::PyannoteOptions,
        callbacks: &mut pyannote_common::PyannoteCallbacks<'_>,
    ) -> anyhow::Result<Vec<pyannote_common::DiarizedSegment>>;
}

pub trait VoiceActivityDetection {
    fn input_sample_rate(&self) -> u32 {
        16_000
    }

    fn detect_speech(&mut self, audio: &[f32]) -> anyhow::Result<Vec<SpeechSegment>>;
}
