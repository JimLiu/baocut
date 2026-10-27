//! Model Worker 的 stdio 协议（协议规范 §1–§3、§7）：请求参数、响应、事件与错误。
//!
//! 参数一律 `camelCase` 且拒绝未知字段；形状不合就是 `INVALID_PARAMS`。

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::bundle::ModelBundle;

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
    /// `embed.run` 的一条文本超过模型的最大输入长度（`details.index` 指出哪一条）。不可重试：同一条文本再跑还是超长。
    pub const INPUT_TOO_LONG: &str = "INPUT_TOO_LONG";
    /// 组装好的结果没过写出前的自检（`details.problems`）。不可重试：同一输入再跑还是同样的结果；也不是崩溃。
    pub const OUTPUT_INVALID: &str = "OUTPUT_INVALID";
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
    /// 转写检查点文件的绝对路径（§2.5.1、架构设计 §6.6）：自分段识别（MOSS）读回其中有效的工作接着做，做完一份追加一条。
    /// 其他模型与 `align` 不用它。省略时不用检查点。
    #[serde(default)]
    pub checkpoint: Option<String>,
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

/// `job.run` 的 `capability` 字段：决定参数按 [`JobRunParams`]、[`SeparateRunParams`]、[`DiarizeRunParams`] 还是
/// [`ImageRunParams`] 解析。
pub fn run_capability(params: &Value) -> Option<&str> {
    params.get("capability").and_then(Value::as_str)
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

/// `job.run`（`capability: "image"`）的参数。输入图（可选）在 `options.images` 里，按绝对路径给出。
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
    /// 输入图，按请求的顺序；空是文生图。`ref` 时第一张是底图、其余是参考图，`img2img` 时恰好一张底图。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ImageInput>,
    /// 输入图的用法；有输入图时必须给，没有时不给。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_mode: Option<ImageMode>,
    /// `img2img` 的改动幅度（0–1，越小越像原图）；只在 `img2img` 时给。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strength: Option<f64>,
}

/// 一张输入图：本机绝对路径（PNG、JPEG 或 WebP，按文件头认）。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageInput {
    pub file: String,
}

/// 输入图的用法：`ref` 按提示词改图（底图加参考图），`img2img` 以底图为起点按 `strength` 重画。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum ImageMode {
    #[serde(rename = "ref")]
    Ref,
    #[serde(rename = "img2img")]
    Img2img,
}

impl ImageRunParams {
    /// 形状之外的检查（都是 `INVALID_PARAMS`）：能力与合同、绝对路径、非空提示词、正的宽高与步数，输入图与用法、强度
    /// 的搭配。模型自己的尺寸规则（Qwen-Image 要 32 的倍数）与输入图张数由引擎在开跑前检查。
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
        let options = &self.options;
        if options.images.iter().any(|input| !std::path::Path::new(&input.file).is_absolute()) {
            return Err(ErrorBody::invalid_params("options.images[].file must be absolute paths"));
        }
        match (options.images.is_empty(), options.image_mode) {
            (true, Some(_)) => return Err(ErrorBody::invalid_params("options.imageMode needs options.images")),
            (false, None) => return Err(ErrorBody::invalid_params("options.images needs options.imageMode")),
            _ => {}
        }
        match (options.image_mode, options.strength) {
            (Some(ImageMode::Img2img), Some(strength)) => {
                if !(0.0..=1.0).contains(&strength) {
                    return Err(ErrorBody::invalid_params("options.strength must be within 0..1"));
                }
                if options.images.len() != 1 {
                    return Err(ErrorBody::invalid_params("img2img takes exactly one image per run"));
                }
            }
            (Some(ImageMode::Img2img), None) => {
                return Err(ErrorBody::invalid_params("img2img needs options.strength"));
            }
            (_, Some(_)) => return Err(ErrorBody::invalid_params("options.strength is only for img2img")),
            (_, None) => {}
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

    #[test]
    fn not_wired_is_a_structured_unsupported_error() {
        let error = transcription_not_wired(Some("moss-transcribe-diarize"));
        assert_eq!(error.code, codes::MODEL_UNSUPPORTED);
        assert!(!error.retryable);
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
        assert_eq!(invalid(&|v| v["capability"] = json!("image")), codes::INVALID_PARAMS);
        assert_eq!(invalid(&|v| v["outputContract"] = json!(OUTPUT_CONTRACT)), codes::INVALID_PARAMS);
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
        assert!(!ErrorBody::new(codes::OUTPUT_INVALID, "x").retryable);
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
            invalid(&|p| p.output_contract = STEMS_OUTPUT_CONTRACT.into()),
            codes::INVALID_PARAMS
        );
        assert_eq!(invalid(&|p| p.capability = Capability::Separate), codes::INVALID_PARAMS);

        // 没有 seed、多出字段：形状错误。
        let mut missing_seed = value.clone();
        missing_seed["options"].as_object_mut().unwrap().remove("seed");
        assert!(serde_json::from_value::<ImageRunParams>(missing_seed).is_err());
        let mut extra = value.clone();
        extra["options"]["negativePrompt"] = json!("blurry");
        assert!(serde_json::from_value::<ImageRunParams>(extra).is_err());

        // 输入图：改图与以图为底重画。
        let mut edit = value.clone();
        edit["options"]["images"] = json!([{ "file": "/tmp/staging/a.png" }, { "file": "/tmp/b.jpg" }]);
        edit["options"]["imageMode"] = json!("ref");
        let parsed: ImageRunParams = serde_json::from_value(edit.clone()).unwrap();
        assert_eq!(parsed.options.image_mode, Some(ImageMode::Ref));
        assert_eq!(parsed.options.images.len(), 2);
        parsed.validate().unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), edit);
        let mut img2img = value;
        img2img["options"]["images"] = json!([{ "file": "/tmp/a.webp" }]);
        img2img["options"]["imageMode"] = json!("img2img");
        img2img["options"]["strength"] = json!(0.6);
        let parsed: ImageRunParams = serde_json::from_value(img2img.clone()).unwrap();
        parsed.validate().unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), img2img);
        let invalid = |edit: &dyn Fn(&mut ImageOptions)| {
            let mut params = parsed.clone();
            edit(&mut params.options);
            params.validate().unwrap_err().code
        };
        assert_eq!(invalid(&|o| o.strength = None), codes::INVALID_PARAMS);
        assert_eq!(invalid(&|o| o.strength = Some(1.5)), codes::INVALID_PARAMS);
        assert_eq!(invalid(&|o| o.image_mode = None), codes::INVALID_PARAMS);
        assert_eq!(invalid(&|o| o.image_mode = Some(ImageMode::Ref)), codes::INVALID_PARAMS);
        assert_eq!(invalid(&|o| o.images[0].file = "a.png".into()), codes::INVALID_PARAMS);
        assert_eq!(invalid(&|o| o.images.push(o.images[0].clone())), codes::INVALID_PARAMS);
        assert_eq!(
            invalid(&|o| {
                o.images.clear();
                o.strength = None;
            }),
            codes::INVALID_PARAMS
        );
        let mut unknown_mode = img2img;
        unknown_mode["options"]["imageMode"] = json!("inpaint");
        assert!(serde_json::from_value::<ImageRunParams>(unknown_mode).is_err());
    }
}
