//! Model Worker 的 stdio 协议（协议规范 §1–§3、§7）：请求参数、响应、事件与错误。
//!
//! 参数一律 `camelCase` 且拒绝未知字段；形状不合就是 `INVALID_PARAMS`。

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::bundle::ModelBundle;
use crate::synthesize::readings::Reading;

/// 一行超过这么多字节视为协议错误，Worker 退出（§1）。
pub const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;
/// 唯一的输出合同。
pub const OUTPUT_CONTRACT: &str = "baocut.asr-result/v1";
/// `TranscribeOptions.hint` 的上限（字符）。
pub const HINT_MAX_CHARS: usize = 1_200;
/// `TranscribeOptions.timescale` 的默认值。
pub const DEFAULT_TIMESCALE: u64 = 1_000_000;

/// 错误码（§7）。
pub mod codes {
    pub const CONTRACT_MISMATCH: &str = "CONTRACT_MISMATCH";
    pub const INVALID_PARAMS: &str = "INVALID_PARAMS";
    pub const UNKNOWN_METHOD: &str = "UNKNOWN_METHOD";
    pub const ALREADY_LOADED: &str = "ALREADY_LOADED";
    pub const WORKER_BUSY: &str = "WORKER_BUSY";
    pub const NOT_FOUND: &str = "NOT_FOUND";
    pub const MODEL_NOT_INSTALLED: &str = "MODEL_NOT_INSTALLED";
    pub const MODEL_UNSUPPORTED: &str = "MODEL_UNSUPPORTED";
    pub const MODEL_RESOURCE: &str = "MODEL_RESOURCE";
    pub const INPUT_UNREADABLE: &str = "INPUT_UNREADABLE";
    pub const DECODE_FAILED: &str = "DECODE_FAILED";
    pub const INFERENCE_FAILED: &str = "INFERENCE_FAILED";
    /// 输出文件写不进 staging（磁盘满、权限）：与模型无关，不算模型包的失败。
    pub const OUTPUT_WRITE_FAILED: &str = "OUTPUT_WRITE_FAILED";
    pub const WORKER_PANIC: &str = "WORKER_PANIC";
}

/// `ErrorBody`（§7）。`message` 不含本机绝对路径。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl ErrorBody {
    /// `retryable` 由错误码决定（§7 的表）。
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        let retryable = matches!(
            code,
            codes::DECODE_FAILED | codes::INFERENCE_FAILED | codes::OUTPUT_WRITE_FAILED | codes::WORKER_PANIC
        );
        Self {
            code: code.to_owned(),
            message: message.into(),
            retryable,
            details: None,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self::new(codes::INVALID_PARAMS, message)
    }
}

/// 让 `ErrorBody` 能经 `?` 进 `anyhow::Error`（移植来的引擎代码按文件清单取文件时用），再在后端边界原样取回。
impl std::fmt::Display for ErrorBody {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ErrorBody {}

/// 把 `params` 解析成 `T`；不合形状就是 `INVALID_PARAMS`。
pub fn parse_params<T: DeserializeOwned>(params: Value) -> Result<T, ErrorBody> {
    serde_json::from_value(params).map_err(|e| ErrorBody::invalid_params(format!("参数不合法：{e}")))
}

/// 一条推送：`{ "event", "params" }`。
pub fn event(name: &str, params: Value) -> Value {
    json!({ "event": name, "params": params })
}

// ---- 请求参数 -------------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelloParams {
    pub contract_version: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadParams {
    pub bundle: ModelBundle,
}

/// `model.unload` / `worker.status` 的空参数。
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmptyParams {}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelParams {
    pub job_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Capability {
    Transcribe,
    Align,
    /// 本地语音合成（§2.5.2）：参数是 [`SynthesizeRunParams`]，不经 [`JobRunParams`]。
    Synthesize,
    /// 人声与伴奏分离（§2.5.4）：参数是 [`SeparateRunParams`]，不经 [`JobRunParams`]。
    Separate,
    /// 本地文生图（§2.5.3）：参数是 [`ImageRunParams`]，不经 [`JobRunParams`]。
    Image,
    /// 给已有转写的词区分说话人（§2.5.5）：参数是 [`DiarizeRunParams`]，不经 [`JobRunParams`]。
    Diarize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobRunParams {
    pub job_id: String,
    pub run_generation: u64,
    pub capability: Capability,
    pub input: JobInput,
    /// 按 `capability` 再解析：`transcribe` 是 [`TranscribeOptions`]，`align` 是 [`AlignOptions`]。
    pub options: Value,
    pub staging: String,
    pub output_contract: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobInput {
    pub file: String,
    pub content_hash: String,
    #[serde(default)]
    pub track: u32,
    #[serde(default)]
    pub range: Option<TickRange>,
}

/// 素材时间上的一段 `[start, end)`，单位是 `timescale` 的 tick。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TickRange {
    pub start: u64,
    pub end: u64,
    pub timescale: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranscribeOptions {
    pub language: LanguageRequest,
    #[serde(default)]
    pub diarize: bool,
    #[serde(default)]
    pub hint: Option<String>,
    #[serde(default = "default_timescale")]
    pub timescale: u64,
}

/// `capability: 'align'` 的选项（§2.5.1）：已知文本 + 断言的语言，Worker 自己分词、对齐、分段。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlignOptions {
    /// 只接受断言（`mode: 'assert'`）。
    pub language: LanguageRequest,
    pub text: String,
    #[serde(default = "default_timescale")]
    pub timescale: u64,
}

fn default_timescale() -> u64 {
    DEFAULT_TIMESCALE
}

/// 断言：用户指定，模型不得更改；偏好：自动检测，`tag` 只在检测不出时作为结果的语言。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase", deny_unknown_fields)]
pub enum LanguageRequest {
    Assert { tag: String },
    Prefer { tag: Option<String> },
}

// ---- 响应 -----------------------------------------------------------------------------------

/// `worker.hello` 里的一个后端。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStatus {
    pub id: &'static str,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub devices: Vec<String>,
}

/// 后端报告的内存（字节）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemorySnapshot {
    pub active: u64,
    pub cache: u64,
    pub peak: u64,
}

/// staging 里写好的结果文件。`sha256` 是小写十六进制，不带 `sha256:` 前缀。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputFile {
    pub path: String,
    pub sha256: String,
    pub byte_length: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStats {
    pub decode_ms: u64,
    pub vad_ms: u64,
    pub asr_ms: u64,
    pub align_ms: u64,
    pub speech_seconds: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobOutcome {
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRunResult {
    pub outcome: JobOutcome,
    pub output: Option<OutputFile>,
    pub segments_file: Option<String>,
    pub stats: JobStats,
}

// ---- 本地语音合成（§2.5.2）-------------------------------------------------------------------

/// 合成的输出合同：staging 里的一个 PCM WAV（单声道或立体声，采样率是模型的原生采样率）。
pub const SPEECH_OUTPUT_CONTRACT: &str = "baocut.speech-wav/v1";
/// 合成结果在 staging 里的文件名。
pub const SPEECH_OUTPUT_FILE: &str = "speech.wav";

/// `job.run` 的 `capability` 字段：决定参数按 [`JobRunParams`] 还是 [`SynthesizeRunParams`] 解析。
pub fn run_capability(params: &Value) -> Option<&str> {
    params.get("capability").and_then(Value::as_str)
}

/// `job.run`（`capability: "synthesize"`）的参数。`input` 只在 `clone` 时给出（参考录音，整段、轨 0）。
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SynthesizeRunParams {
    pub job_id: String,
    pub run_generation: u64,
    pub capability: Capability,
    #[serde(default)]
    pub input: Option<SpeechReference>,
    pub options: SynthesizeOptions,
    pub staging: String,
    pub output_contract: String,
}

/// 克隆的参考录音：与 [`JobInput`] 同名的字段，不接受 `range`（参考录音整段使用）。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpeechReference {
    pub file: String,
    pub content_hash: String,
    #[serde(default)]
    pub track: u32,
}

/// 冻结的合成参数。文本原样交来，读音标注由引擎换成自己的写法；`null` 的旋钮用模型的默认值。
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SynthesizeOptions {
    pub text: String,
    /// BCP 47；`null` 时由引擎按文本判断。
    #[serde(default)]
    pub language: Option<String>,
    pub voice: SynthesizeVoice,
    #[serde(default)]
    pub instructions: Option<String>,
    #[serde(default)]
    pub speed: Option<f64>,
    #[serde(default)]
    pub cfg: Option<f64>,
    #[serde(default)]
    pub steps: Option<u32>,
    #[serde(default)]
    pub seed: Option<u64>,
}

/// 声音：`preset` 是模型的说话人；`clone` 用 `input` 的参考录音（`transcript` 是它的原文）；`describe` 是一句描述。
/// 模型做不到时报错，不换成别的声音。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "mode", rename_all = "lowercase", deny_unknown_fields)]
pub enum SynthesizeVoice {
    Preset { id: String },
    Clone { transcript: Option<String> },
    Describe { description: String },
}

impl SynthesizeRunParams {
    /// 形状之外的检查（都是 `INVALID_PARAMS`）：能力与合同、绝对路径、非空文本、参考录音只跟 `clone` 一起出现。
    pub fn validate(&self) -> Result<(), ErrorBody> {
        if self.capability != Capability::Synthesize {
            return Err(ErrorBody::invalid_params("capability must be synthesize"));
        }
        if self.output_contract != SPEECH_OUTPUT_CONTRACT {
            return Err(ErrorBody::invalid_params(format!(
                "outputContract must be {SPEECH_OUTPUT_CONTRACT}"
            )));
        }
        if !std::path::Path::new(&self.staging).is_absolute() {
            return Err(ErrorBody::invalid_params("staging must be an absolute path"));
        }
        if self.options.text.trim().is_empty() {
            return Err(ErrorBody::invalid_params("options.text must not be empty"));
        }
        match (&self.options.voice, &self.input) {
            (SynthesizeVoice::Clone { .. }, None) => Err(ErrorBody::invalid_params("voice mode clone needs input (the reference audio)")),
            (SynthesizeVoice::Clone { .. }, Some(input)) if !std::path::Path::new(&input.file).is_absolute() => {
                Err(ErrorBody::invalid_params("input.file must be an absolute path"))
            }
            (SynthesizeVoice::Preset { .. } | SynthesizeVoice::Describe { .. }, Some(_)) => {
                Err(ErrorBody::invalid_params("input is only for voice mode clone"))
            }
            _ => Ok(()),
        }
    }
}

/// 合成出的音频的事实。
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthesizedAudio {
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_sec: f64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthesizeStats {
    pub reference_ms: u64,
    pub synthesis_ms: u64,
    pub encode_ms: u64,
}

/// `job.run`（`synthesize`）的结果：`output` 是 staging 里的 [`SPEECH_OUTPUT_FILE`]。
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthesizeRunResult {
    pub outcome: JobOutcome,
    pub output: Option<OutputFile>,
    pub audio: Option<SynthesizedAudio>,
    pub stats: SynthesizeStats,
    /// 文字里没能按注记念出来的读音（引擎不认读音、注记畸形等），偏移落在去注记后的文字上；
    /// 是警告不是失败——音频照常产出，Runtime 把它如实转给调用方，不静默丢弃。取消时为空。
    #[serde(default)]
    pub readings_dropped: Vec<Reading>,
}

// ---- 人声与伴奏分离（§2.5.4）-----------------------------------------------------------------

/// 分离的输出合同：staging 里人声与背景两个 16-bit PCM 立体声 WAV，采样率是请求的 `sampleRate`，长度与输入相同。
pub const STEMS_OUTPUT_CONTRACT: &str = "baocut.stems-wav/v1";
/// 人声在 staging 里的文件名。
pub const VOCALS_OUTPUT_FILE: &str = "vocals.wav";
/// 背景声（鼓、贝斯与其他之和）在 staging 里的文件名。
pub const BACKGROUND_OUTPUT_FILE: &str = "background.wav";
/// `options.sampleRate` 的上下限（Hz）。
pub const SEPARATE_MIN_SAMPLE_RATE: u32 = 8_000;
pub const SEPARATE_MAX_SAMPLE_RATE: u32 = 192_000;

/// `job.run`（`capability: "separate"`）的参数：整段输入（不接受 `range`）。
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeparateRunParams {
    pub job_id: String,
    pub run_generation: u64,
    pub capability: Capability,
    pub input: SeparateInput,
    pub options: SeparateOptions,
    pub staging: String,
    pub output_contract: String,
}

/// 分离的输入：与 [`JobInput`] 同名的字段，不接受 `range`。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeparateInput {
    pub file: String,
    pub content_hash: String,
    #[serde(default)]
    pub track: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeparateOptions {
    /// 输出的采样率；`null` 时用模型的工作采样率（HTDemucs 为 44.1 kHz）。Runtime 传输入音轨的采样率，
    /// 让两路输出与输入同采样率（架构设计 §6.1 的输出约定）。
    #[serde(default)]
    pub sample_rate: Option<u32>,
}

impl SeparateRunParams {
    /// 形状之外的检查（都是 `INVALID_PARAMS`）：能力与合同、绝对路径、采样率范围。
    pub fn validate(&self) -> Result<(), ErrorBody> {
        if self.capability != Capability::Separate {
            return Err(ErrorBody::invalid_params("capability must be separate"));
        }
        if self.output_contract != STEMS_OUTPUT_CONTRACT {
            return Err(ErrorBody::invalid_params(format!("outputContract must be {STEMS_OUTPUT_CONTRACT}")));
        }
        if !std::path::Path::new(&self.staging).is_absolute() {
            return Err(ErrorBody::invalid_params("staging must be an absolute path"));
        }
        if !std::path::Path::new(&self.input.file).is_absolute() {
            return Err(ErrorBody::invalid_params("input.file must be an absolute path"));
        }
        if let Some(rate) = self.options.sample_rate
            && !(SEPARATE_MIN_SAMPLE_RATE..=SEPARATE_MAX_SAMPLE_RATE).contains(&rate)
        {
            return Err(ErrorBody::invalid_params(format!(
                "options.sampleRate must be within {SEPARATE_MIN_SAMPLE_RATE}..={SEPARATE_MAX_SAMPLE_RATE}"
            )));
        }
        Ok(())
    }
}

/// 两路输出的文件。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeparatedFiles {
    pub vocals: OutputFile,
    pub background: OutputFile,
}

/// 两路输出共同的音频事实。
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeparatedAudio {
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_sec: f64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeparateStats {
    pub decode_ms: u64,
    pub separation_ms: u64,
    pub encode_ms: u64,
}

/// `job.run`（`separate`）的结果：`stems` 是 staging 里的 [`VOCALS_OUTPUT_FILE`] 与 [`BACKGROUND_OUTPUT_FILE`]，取消时为 `null`。
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeparateRunResult {
    pub outcome: JobOutcome,
    pub stems: Option<SeparatedFiles>,
    pub audio: Option<SeparatedAudio>,
    pub stats: SeparateStats,
}

// ---- 已有转写的说话人区分（§2.5.5）--------------------------------------------------------------

/// 说话人区分的输出合同：staging 里的 [`SPEAKERS_OUTPUT_FILE`]（JSON），形状见协议规范 §2.5.5。
pub const SPEAKERS_OUTPUT_CONTRACT: &str = "baocut.speakers/v1";
/// 说话人区分的结果在 staging 里的文件名。
pub const SPEAKERS_OUTPUT_FILE: &str = "speakers.json";
/// `options.words` 的上限（一份转写的词数远小于它）。
pub const DIARIZE_MAX_WORDS: usize = 2_000_000;

/// `job.run`（`capability: "diarize"`）的参数：一段素材音频与落在其中的词（素材时间的 tick）。
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiarizeRunParams {
    pub job_id: String,
    pub run_generation: u64,
    pub capability: Capability,
    pub input: DiarizeInput,
    pub options: DiarizeOptions,
    pub staging: String,
    pub output_contract: String,
}

/// 说话人区分的输入：与 [`JobInput`] 同名的字段；`range` 是要解码的一段（不给时整条音轨）。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiarizeInput {
    pub file: String,
    pub content_hash: String,
    #[serde(default)]
    pub track: u32,
    #[serde(default)]
    pub range: Option<DiarizeRange>,
}

/// 与 [`TickRange`] 同形（可序列化）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiarizeRange {
    pub start: u64,
    pub end: u64,
    pub timescale: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiarizeOptions {
    /// `words` 与结果里时间的刻度。
    #[serde(default = "default_timescale")]
    pub timescale: u64,
    /// 转写的词：`[start, end]`，素材时间的 tick，按转写里的次序。结果的 `words` 与它一一对应。
    pub words: Vec<[u64; 2]>,
}

impl DiarizeRunParams {
    /// 形状之外的检查（都是 `INVALID_PARAMS`）：能力与合同、绝对路径、刻度、range 与词的起止。
    pub fn validate(&self) -> Result<(), ErrorBody> {
        if self.capability != Capability::Diarize {
            return Err(ErrorBody::invalid_params("capability must be diarize"));
        }
        if self.output_contract != SPEAKERS_OUTPUT_CONTRACT {
            return Err(ErrorBody::invalid_params(format!(
                "outputContract must be {SPEAKERS_OUTPUT_CONTRACT}"
            )));
        }
        if !std::path::Path::new(&self.staging).is_absolute() {
            return Err(ErrorBody::invalid_params("staging must be an absolute path"));
        }
        if !std::path::Path::new(&self.input.file).is_absolute() {
            return Err(ErrorBody::invalid_params("input.file must be an absolute path"));
        }
        if self.options.timescale == 0 {
            return Err(ErrorBody::invalid_params("options.timescale must be positive"));
        }
        if let Some(range) = self.input.range
            && (range.timescale == 0 || range.end <= range.start)
        {
            return Err(ErrorBody::invalid_params(
                "input.range must have a positive timescale and end > start",
            ));
        }
        if self.options.words.len() > DIARIZE_MAX_WORDS {
            return Err(ErrorBody::invalid_params(format!(
                "options.words must have at most {DIARIZE_MAX_WORDS} entries"
            )));
        }
        if let Some(index) = self.options.words.iter().position(|[start, end]| end < start) {
            return Err(ErrorBody::invalid_params(format!("options.words[{index}] ends before it starts")));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarizeStats {
    pub decode_ms: u64,
    pub diarize_ms: u64,
}

/// `job.run`（`diarize`）的结果：`output` 是 staging 里的 [`SPEAKERS_OUTPUT_FILE`]，取消时为 `null`。
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarizeRunResult {
    pub outcome: JobOutcome,
    pub output: Option<OutputFile>,
    /// 区分出的说话人数（取消时 0）。
    pub speakers: usize,
    pub stats: DiarizeStats,
}

/// 这个构建没有某个合成模型族的引擎时 `model.load` 的回答：`MODEL_UNSUPPORTED`，`details.reason` 为 `not-wired`。
pub fn synthesis_not_wired(family: Option<&str>) -> ErrorBody {
    let mut details = json!({ "capability": "synthesize", "reason": "not-wired" });
    if let Some(family) = family {
        details["family"] = json!(family);
    }
    ErrorBody::new(
        codes::MODEL_UNSUPPORTED,
        "local speech synthesis is not available in this worker yet",
    )
    .with_details(details)
}

/// 这个构建没有分离的后端时 `model.load` 的回答：`MODEL_UNSUPPORTED`，`details.reason` 为 `not-wired`。Runtime 按
/// `worker.hello` 的 `separateFamilies` 本不会发来。
pub fn separation_not_wired(family: Option<&str>) -> ErrorBody {
    let mut details = json!({ "capability": "separate", "reason": "not-wired" });
    if let Some(family) = family {
        details["family"] = json!(family);
    }
    ErrorBody::new(codes::MODEL_UNSUPPORTED, "local audio separation is not available in this worker").with_details(details)
}

/// 这个构建没有某个识别主模型族的加载器时 `model.load` 的回答：`MODEL_UNSUPPORTED`，`details.reason` 为
/// `not-wired`。Runtime 按 `worker.hello` 的 `transcribeFamilies` 本不会发来。
pub fn transcription_not_wired(family: Option<&str>) -> ErrorBody {
    let mut details = json!({ "capability": "transcribe", "reason": "not-wired" });
    if let Some(family) = family {
        details["family"] = json!(family);
    }
    ErrorBody::new(
        codes::MODEL_UNSUPPORTED,
        "this speech recognition model is not available in this worker yet",
    )
    .with_details(details)
}

// ---- 本地文生图（§2.5.3）---------------------------------------------------------------------

/// 文生图的输出合同：staging 里的一张 8 位 RGBA PNG，宽高就是请求的宽高。
pub const IMAGE_OUTPUT_CONTRACT: &str = "baocut.image-png/v1";
/// 文生图结果在 staging 里的文件名。
pub const IMAGE_OUTPUT_FILE: &str = "image.png";

/// `job.run`（`capability: "image"`）的参数。没有输入文件：提示词就是全部输入。
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageRunParams {
    pub job_id: String,
    pub run_generation: u64,
    pub capability: Capability,
    pub options: ImageOptions,
    pub staging: String,
    pub output_contract: String,
}

/// 冻结的文生图参数。`seed` 由 Runtime 在提交时定下（请求没给就随机取一个），重跑得到同一张图。
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageOptions {
    pub prompt: String,
    pub width: u32,
    pub height: u32,
    /// 去噪步数；`null` 用模型的默认值。
    #[serde(default)]
    pub steps: Option<u32>,
    pub seed: u64,
}

impl ImageRunParams {
    /// 形状之外的检查（都是 `INVALID_PARAMS`）：能力与合同、绝对路径、非空提示词、正的宽高与步数。模型自己的尺寸规则
    /// （Qwen-Image 要 32 的倍数）由引擎在开跑前检查。
    pub fn validate(&self) -> Result<(), ErrorBody> {
        if self.capability != Capability::Image {
            return Err(ErrorBody::invalid_params("capability must be image"));
        }
        if self.output_contract != IMAGE_OUTPUT_CONTRACT {
            return Err(ErrorBody::invalid_params(format!("outputContract must be {IMAGE_OUTPUT_CONTRACT}")));
        }
        if !std::path::Path::new(&self.staging).is_absolute() {
            return Err(ErrorBody::invalid_params("staging must be an absolute path"));
        }
        if self.options.prompt.trim().is_empty() {
            return Err(ErrorBody::invalid_params("options.prompt must not be empty"));
        }
        if self.options.width == 0 || self.options.height == 0 {
            return Err(ErrorBody::invalid_params("options.width and options.height must be positive"));
        }
        if self.options.steps == Some(0) {
            return Err(ErrorBody::invalid_params("options.steps must be positive"));
        }
        Ok(())
    }
}

/// 生成出的图片的事实。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImage {
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub seed: u64,
    pub steps: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageStats {
    pub generation_ms: u64,
    pub encode_ms: u64,
}

/// `job.run`（`image`）的结果：`output` 是 staging 里的 [`IMAGE_OUTPUT_FILE`]。
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageRunResult {
    pub outcome: JobOutcome,
    pub output: Option<OutputFile>,
    pub image: Option<GeneratedImage>,
    pub stats: ImageStats,
}

/// 这个构建没有说话人区分时 `model.load` 的回答：`MODEL_UNSUPPORTED`，`details.reason` 为 `not-wired`。Runtime 按
/// `worker.hello` 的 `capabilities` 本不会发来。
pub fn diarization_not_wired() -> ErrorBody {
    ErrorBody::new(
        codes::MODEL_UNSUPPORTED,
        "local speaker diarization is not available in this worker",
    )
    .with_details(json!({ "capability": "diarize", "reason": "not-wired" }))
}

/// 这个构建没有某个文生图模型族的引擎时 `model.load` 的回答：`MODEL_UNSUPPORTED`，`details.reason` 为 `not-wired`。
pub fn image_not_wired(family: Option<&str>) -> ErrorBody {
    let mut details = json!({ "capability": "image", "reason": "not-wired" });
    if let Some(family) = family {
        details["family"] = json!(family);
    }
    ErrorBody::new(codes::MODEL_UNSUPPORTED, "local image generation is not available in this worker").with_details(details)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 与 TS 侧 `SynthesizeRunParams`（packages/models/src/worker-contract.ts）逐字相同的一次请求。
    fn synthesize_params(voice: Value, input: Value) -> Value {
        json!({
            "jobId": "job_1",
            "runGeneration": 2,
            "capability": "synthesize",
            "input": input,
            "options": {
                "text": "你好，世界。",
                "language": "zh-CN",
                "voice": voice,
                "instructions": null,
                "speed": 1.1,
                "cfg": null,
                "steps": 10,
                "seed": 7,
            },
            "staging": "/tmp/staging",
            "outputContract": SPEECH_OUTPUT_CONTRACT,
        })
    }

    #[test]
    fn synthesize_params_round_trip_every_voice_mode() {
        let reference = json!({ "file": "/tmp/ref.wav", "contentHash": "sha256:ab", "track": 0 });
        for (voice, input) in [
            (json!({ "mode": "preset", "id": "Vivian" }), Value::Null),
            (json!({ "mode": "clone", "transcript": "参考录音的原文" }), reference.clone()),
            (json!({ "mode": "clone", "transcript": null }), reference.clone()),
            (json!({ "mode": "describe", "description": "female, low pitch" }), Value::Null),
        ] {
            let value = synthesize_params(voice, input);
            assert_eq!(run_capability(&value), Some("synthesize"));
            let parsed: SynthesizeRunParams = serde_json::from_value(value.clone()).unwrap();
            parsed.validate().unwrap();
            assert_eq!(serde_json::to_value(&parsed).unwrap(), value, "serializes back to the same JSON");
        }
        // 可选字段（input 与旋钮）缺省为 null。
        let minimal: SynthesizeRunParams = serde_json::from_value(json!({
            "jobId": "j", "runGeneration": 1, "capability": "synthesize",
            "options": { "text": "hi", "voice": { "mode": "preset", "id": "a" } },
            "staging": "/s", "outputContract": SPEECH_OUTPUT_CONTRACT,
        }))
        .unwrap();
        assert_eq!(minimal.input, None);
        assert_eq!(minimal.options.steps, None);
    }

    #[test]
    fn synthesize_params_reject_bad_shapes() {
        let preset = json!({ "mode": "preset", "id": "a" });
        let clone = json!({ "mode": "clone", "transcript": null });
        let mut extra = synthesize_params(preset.clone(), Value::Null);
        extra["options"]["emotion"] = json!("happy");
        assert!(serde_json::from_value::<SynthesizeRunParams>(extra).is_err(), "unknown option");
        let custom = synthesize_params(json!({ "mode": "custom", "id": "a" }), Value::Null);
        assert!(serde_json::from_value::<SynthesizeRunParams>(custom).is_err(), "unknown voice mode");
        let ranged = json!({ "file": "/r.wav", "contentHash": "sha256:ab", "track": 0, "range": { "start": 0, "end": 1, "timescale": 1 } });
        assert!(
            serde_json::from_value::<SynthesizeRunParams>(synthesize_params(clone.clone(), ranged)).is_err(),
            "no range"
        );

        let invalid = |value: Value| {
            serde_json::from_value::<SynthesizeRunParams>(value)
                .unwrap()
                .validate()
                .unwrap_err()
                .code
        };
        assert_eq!(invalid(synthesize_params(clone.clone(), Value::Null)), codes::INVALID_PARAMS);
        let reference = json!({ "file": "/r.wav", "contentHash": "sha256:ab", "track": 0 });
        assert_eq!(invalid(synthesize_params(preset.clone(), reference)), codes::INVALID_PARAMS);
        let relative = json!({ "file": "r.wav", "contentHash": "sha256:ab", "track": 0 });
        assert_eq!(invalid(synthesize_params(clone, relative)), codes::INVALID_PARAMS);
        let mut contract = synthesize_params(preset.clone(), Value::Null);
        contract["outputContract"] = json!(OUTPUT_CONTRACT);
        assert_eq!(invalid(contract), codes::INVALID_PARAMS);
        let mut empty = synthesize_params(preset.clone(), Value::Null);
        empty["options"]["text"] = json!("  ");
        assert_eq!(invalid(empty), codes::INVALID_PARAMS);
        let mut transcribe = synthesize_params(preset, Value::Null);
        transcribe["capability"] = json!("transcribe");
        assert_eq!(invalid(transcribe), codes::INVALID_PARAMS);
    }

    #[test]
    fn synthesize_result_round_trips() {
        let value = json!({
            "outcome": "completed",
            "output": { "path": SPEECH_OUTPUT_FILE, "sha256": "ab".repeat(32), "byteLength": 48_044 },
            "audio": { "sampleRate": 24_000, "channels": 1, "durationSec": 1.0 },
            "stats": { "referenceMs": 12, "synthesisMs": 900, "encodeMs": 3 },
            "readingsDropped": [{ "start": 2, "end": 3, "reading": "xing2", "origin": "user" }],
        });
        let parsed: SynthesizeRunResult = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(parsed.outcome, JobOutcome::Completed);
        assert_eq!(serde_json::to_value(&parsed).unwrap(), value);
        let cancelled = json!({
            "outcome": "cancelled", "output": null, "audio": null,
            "stats": { "referenceMs": 0, "synthesisMs": 0, "encodeMs": 0 },
            "readingsDropped": [],
        });
        let parsed: SynthesizeRunResult = serde_json::from_value(cancelled.clone()).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), cancelled);
    }

    #[test]
    fn not_wired_is_a_structured_unsupported_error() {
        let error = synthesis_not_wired(Some("qwen3-tts"));
        assert_eq!(error.code, codes::MODEL_UNSUPPORTED);
        assert!(!error.retryable);
        assert_eq!(
            error.details.unwrap(),
            json!({ "capability": "synthesize", "reason": "not-wired", "family": "qwen3-tts" })
        );
        assert_eq!(
            serde_json::from_value::<Capability>(json!("synthesize")).unwrap(),
            Capability::Synthesize
        );
        let error = transcription_not_wired(Some("moss-transcribe-diarize"));
        assert_eq!(error.code, codes::MODEL_UNSUPPORTED);
        assert_eq!(
            error.details.unwrap(),
            json!({ "capability": "transcribe", "reason": "not-wired", "family": "moss-transcribe-diarize" })
        );
    }

    #[test]
    fn language_request_is_tagged_and_closed() {
        let assert: LanguageRequest = serde_json::from_value(json!({"mode": "assert", "tag": "en"})).unwrap();
        assert_eq!(assert, LanguageRequest::Assert { tag: "en".into() });
        let prefer: LanguageRequest = serde_json::from_value(json!({"mode": "prefer", "tag": null})).unwrap();
        assert_eq!(prefer, LanguageRequest::Prefer { tag: None });
        assert!(serde_json::from_value::<LanguageRequest>(json!({"mode": "prefer", "tag": null, "x": 1})).is_err());
        assert!(serde_json::from_value::<LanguageRequest>(json!({"mode": "assert"})).is_err());
        assert!(serde_json::from_value::<LanguageRequest>(json!({"mode": "auto"})).is_err());
    }

    #[test]
    fn transcribe_options_default_timescale_and_reject_unknown_fields() {
        let options: TranscribeOptions =
            serde_json::from_value(json!({"language": {"mode": "prefer", "tag": null}, "diarize": false})).unwrap();
        assert_eq!(options.timescale, DEFAULT_TIMESCALE);
        assert!(
            serde_json::from_value::<TranscribeOptions>(json!({"language": {"mode": "prefer", "tag": null}, "diarize": false, "x": 1}))
                .is_err()
        );
    }

    /// 与 TS 侧 `SeparateRunParams`（packages/models/src/worker-contract.ts）逐字相同的一次请求。
    fn separate_params() -> Value {
        json!({
            "jobId": "job_s",
            "runGeneration": 1,
            "capability": "separate",
            "input": { "file": "/media/a.mp4", "contentHash": "sha256:ab", "track": 0 },
            "options": { "sampleRate": 48_000 },
            "staging": "/tmp/staging",
            "outputContract": STEMS_OUTPUT_CONTRACT,
        })
    }

    #[test]
    fn separate_params_round_trip_and_reject_bad_shapes() {
        let value = separate_params();
        assert_eq!(run_capability(&value), Some("separate"));
        let parsed: SeparateRunParams = serde_json::from_value(value.clone()).unwrap();
        parsed.validate().unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), value);

        let mut defaulted = separate_params();
        defaulted["options"] = json!({});
        let parsed: SeparateRunParams = serde_json::from_value(defaulted).unwrap();
        assert_eq!(parsed.options.sample_rate, None);

        let mut ranged = separate_params();
        ranged["input"]["range"] = json!({ "start": 0, "end": 1, "timescale": 1 });
        assert!(serde_json::from_value::<SeparateRunParams>(ranged).is_err(), "no range");
        let mut extra = separate_params();
        extra["options"]["stems"] = json!(["drums"]);
        assert!(serde_json::from_value::<SeparateRunParams>(extra).is_err(), "unknown option");

        let invalid = |edit: &dyn Fn(&mut Value)| {
            let mut value = separate_params();
            edit(&mut value);
            serde_json::from_value::<SeparateRunParams>(value)
                .unwrap()
                .validate()
                .unwrap_err()
                .code
        };
        assert_eq!(invalid(&|v| v["capability"] = json!("synthesize")), codes::INVALID_PARAMS);
        assert_eq!(
            invalid(&|v| v["outputContract"] = json!(SPEECH_OUTPUT_CONTRACT)),
            codes::INVALID_PARAMS
        );
        assert_eq!(invalid(&|v| v["staging"] = json!("relative")), codes::INVALID_PARAMS);
        assert_eq!(invalid(&|v| v["input"]["file"] = json!("a.mp4")), codes::INVALID_PARAMS);
        assert_eq!(invalid(&|v| v["options"]["sampleRate"] = json!(4_000)), codes::INVALID_PARAMS);
    }

    #[test]
    fn retryable_follows_the_code_table() {
        assert!(ErrorBody::new(codes::DECODE_FAILED, "x").retryable);
        assert!(ErrorBody::new(codes::WORKER_PANIC, "x").retryable);
        assert!(!ErrorBody::new(codes::MODEL_NOT_INSTALLED, "x").retryable);
        assert!(!ErrorBody::new(codes::INVALID_PARAMS, "x").retryable);
    }

    /// 与 TS 侧 `ImageRunParams`（packages/models/src/worker-contract.ts）逐字相同的一次请求。
    #[test]
    fn image_params_round_trip_and_validate() {
        let value = json!({
            "jobId": "job_1",
            "runGeneration": 2,
            "capability": "image",
            "options": { "prompt": "a red apple", "width": 1024, "height": 576, "steps": null, "seed": 4_294_967_295u64 },
            "staging": "/tmp/staging",
            "outputContract": IMAGE_OUTPUT_CONTRACT,
        });
        assert_eq!(run_capability(&value), Some("image"));
        let parsed: ImageRunParams = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(parsed.capability, Capability::Image);
        assert_eq!(
            (parsed.options.width, parsed.options.height, parsed.options.steps),
            (1024, 576, None)
        );
        assert_eq!(parsed.options.seed, 4_294_967_295);
        parsed.validate().unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), value);

        let invalid = |edit: &dyn Fn(&mut ImageRunParams)| {
            let mut params = parsed.clone();
            edit(&mut params);
            params.validate().unwrap_err().code
        };
        assert_eq!(invalid(&|p| p.options.prompt = "  ".into()), codes::INVALID_PARAMS);
        assert_eq!(invalid(&|p| p.options.width = 0), codes::INVALID_PARAMS);
        assert_eq!(invalid(&|p| p.options.steps = Some(0)), codes::INVALID_PARAMS);
        assert_eq!(invalid(&|p| p.staging = "relative".into()), codes::INVALID_PARAMS);
        assert_eq!(
            invalid(&|p| p.output_contract = SPEECH_OUTPUT_CONTRACT.into()),
            codes::INVALID_PARAMS
        );
        assert_eq!(invalid(&|p| p.capability = Capability::Synthesize), codes::INVALID_PARAMS);

        // 没有 seed、多出字段：形状错误。
        let mut missing_seed = value.clone();
        missing_seed["options"].as_object_mut().unwrap().remove("seed");
        assert!(serde_json::from_value::<ImageRunParams>(missing_seed).is_err());
        let mut extra = value;
        extra["options"]["negativePrompt"] = json!("blurry");
        assert!(serde_json::from_value::<ImageRunParams>(extra).is_err());
    }
}
