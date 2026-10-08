//! 推理后端：设备上下文与模型加载器。
//!
//! 每个后端是一个 [`Backend`]：报告自己在本机是否可用，并把校验过的模型包加载成 [`Loaded`]（识别的
//! [`LoadedModel`]、合成的 [`LoadedSynthesis`]，或文生图的 [`LoadedImage`]）。加载出来的模型持有设备句柄（MLX 的数组不是 `Send`），
//! 只能在创建它的那个线程上使用。
//!
//! - `mlx`：Apple Silicon + Metal。`backend-mlx` feature 且目标是 macOS aarch64 时编译进来，否则报告
//!   `not-compiled`。
//! - `coreml`：Apple Silicon 上的 CoreML（Whisper 的 `.mlmodelc` 包，VAD 仍走 MLX）。`backend-coreml` feature（连带
//!   `backend-mlx`）且目标是 macOS aarch64 时编译进来，否则报告 `not-compiled`。
//! - `candle`：全平台后端（CPU，`cuda` feature 时加 NVIDIA CUDA），加载与 MLX 同一批 Qwen3-ASR、MOSS、对齐器、
//!   WeSpeaker 权重。`backend-candle` feature 时编译进来，否则报告 `not-compiled`。
//! - `ggml`：全平台的 Whisper（whisper.cpp 的单文件 GGML 权重；CPU，`whisper-ggml-cuda` 加 NVIDIA CUDA、`whisper-ggml-vulkan`
//!   加 Vulkan GPU，两个都编进来时 CUDA 优先），VAD 与
//!   可选的对齐器借 candle 的。`whisper-ggml` feature（连带 `backend-candle`）时编译进来，否则报告 `not-compiled`。
//!
//! 识别模型包按 `asr` 组件的 family 选加载器，每个 family 有自己要求的组件（[`load`]）；这个构建能加载哪些
//! family 由 [`transcribe_families`] 报给 `worker.hello`。带 `image` 组件的是文生图模型包（[`crate::image`]）。

use serde_json::json;

use crate::bundle::{
    FAMILY_HTDEMUCS_FT, FAMILY_INDEX_TTS2_AUX, FAMILY_MOSS_TRANSCRIBE_DIARIZE, FAMILY_PYANNOTE_SEGMENTATION, FAMILY_QWEN3_ALIGNER,
    FAMILY_QWEN3_ASR, FAMILY_QWEN3_TTS_CODEC, FAMILY_SILERO_VAD, FAMILY_WESPEAKER, FAMILY_WHISPER_COREML, FAMILY_WHISPER_GGML,
    FAMILY_WHISPER_MLX, FAMILY_WHISPER_TOKENIZER, VerifiedBundle, VerifiedFiles,
};
use crate::image::{self, ImageEngine};
use crate::protocol::{
    BackendStatus, ErrorBody, MemorySnapshot, codes, diarization_not_wired, image_not_wired, separation_not_wired, synthesis_not_wired,
    transcription_not_wired,
};
use crate::separate::{self, Separator};
use crate::speech::{ForcedAlignment, SegmentingRecognizer, SpeakerDiarization, SpeakerEmbedding, SpeechRecognizer, StreamingVad};
use crate::synthesize::{self, TtsEngine, TtsEngineKind};

#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
pub mod mlx;

#[cfg(all(feature = "backend-coreml", target_os = "macos", target_arch = "aarch64"))]
pub mod coreml;

#[cfg(feature = "backend-candle")]
pub mod candle;

#[cfg(feature = "whisper-ggml")]
pub mod ggml;

/// 后端不可用的原因。
pub const REASON_NOT_COMPILED: &str = "not-compiled";
pub const REASON_NO_METAL_DEVICE: &str = "no-metal-device";

/// `model.phase` 事件的阶段。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelPhase {
    LoadingWeights,
    Compiling,
    WarmingUp,
}

impl ModelPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LoadingWeights => "loading-weights",
            Self::Compiling => "compiling",
            Self::WarmingUp => "warming-up",
        }
    }
}

/// 加载阶段回调：阶段与可选的说明（组件名）。
pub type PhaseCallback<'a> = dyn FnMut(ModelPhase, Option<&str>) + 'a;

/// 转写模型的跑法。
pub enum RunMode<'a> {
    /// VAD 切段、逐段识别（Qwen3-ASR、Whisper）。同时借出两者，流水线要交替使用。
    Pipeline {
        vad: &'a mut dyn StreamingVad,
        recognizer: &'a mut dyn SpeechRecognizer,
    },
    /// 模型自己切段，整段音频一次交给它（MOSS-Transcribe-Diarize）。
    SelfSegmenting(&'a mut dyn SegmentingRecognizer),
}

/// 加载好的转写模型。只能在加载它的线程上使用。
pub trait LoadedModel {
    /// 借出这个模型的跑法；一个模型总是同一种。
    fn run_mode(&mut self) -> RunMode<'_>;

    /// 后端能报告时给出内存快照。
    fn memory(&self) -> Option<MemorySnapshot>;

    /// 预热耗时（毫秒）。
    fn warmup_ms(&self) -> u64;

    /// 常驻字节数；后端报告不了时 `None`。
    fn resident_bytes(&self) -> Option<u64>;

    /// 加载了的强制对齐器（模型包带了可选的 `aligner` 组件）。识别的第 5 步用它给词对时间，`align` 能力只靠它。
    /// 自分段模型（MOSS）在第一次调用时才加载它，加载失败时是 `None`。
    fn aligner(&mut self) -> Option<&mut dyn ForcedAlignment> {
        None
    }

    /// 模型包带了对齐器：`align` 能力与结果的 `provenance.models.aligner` 据此判断。按需加载对齐器的模型不必为此先加载它。
    fn has_aligner(&mut self) -> bool {
        self.aligner().is_some()
    }

    /// 说话人嵌入模型（`speaker` 组件）。自分段模型（MOSS）用它合并跨块的说话人，在第一次调用时才加载，加载失败时是
    /// `None`。Qwen3-ASR 与 Whisper 不经这里：它们的 `speaker` 组件随说话人区分（[`Self::diarizer`]）一起加载。
    fn speaker_embedder(&mut self) -> Option<&mut dyn SpeakerEmbedding> {
        None
    }

    /// 模型包带了说话人区分（`segmentation` 组件，架构设计 §6.6）：`diarize` 据此判断，不必为此先加载它。
    fn has_diarizer(&self) -> bool {
        false
    }

    /// 说话人区分（Pyannote 分段 + WeSpeaker 声纹聚类），给自己不区分说话人的模型（Qwen3-ASR、Whisper）用。识别完成后
    /// 第一次调用时才加载（同 v2：识别模型不卸载），加载失败时是 `None`；任务结束（[`Self::finish_job`]）放掉。
    fn diarizer(&mut self) -> Option<&mut dyn SpeakerDiarization> {
        None
    }

    /// 一个 `job.run` 结束（成功、失败或取消）时调用：按需加载的辅助模型（MOSS 的对齐器与说话人模型、说话人区分）在这里放掉。
    fn finish_job(&mut self) {}
}

/// 加载好的合成模型：一只 TTS 引擎。与 [`LoadedModel`] 一样只能在加载它的线程上使用。
pub struct LoadedSynthesis {
    pub kind: TtsEngineKind,
    pub engine: Box<dyn TtsEngine>,
    /// 加载耗时（毫秒）：合成没有单独的预热，`model.load` 的 `warmupMs` 报这个。
    pub load_ms: u64,
    /// 加载后的常驻字节数；后端报告不了时 `None`。
    pub resident_bytes: Option<u64>,
    /// 后端的内存快照（任务之后刷新 `worker.status`）。
    pub memory: fn() -> Option<MemorySnapshot>,
}

/// 加载好的分离模型（HTDemucs-FT）。与 [`LoadedModel`] 一样只能在加载它的线程上使用。
pub struct LoadedSeparation {
    pub separator: Box<dyn Separator>,
    /// 加载耗时（毫秒）：分离没有单独的预热，`model.load` 的 `warmupMs` 报这个。
    pub load_ms: u64,
    /// 加载后的常驻字节数；后端报告不了时 `None`。
    pub resident_bytes: Option<u64>,
    /// 后端的内存快照（任务之后刷新 `worker.status`）。
    pub memory: fn() -> Option<MemorySnapshot>,
}

/// 加载好的说话人区分（「说话人区分」模型包单独加载：Pyannote 分段 + WeSpeaker 声纹，给已有转写的词区分说话人，
/// 协议规范 §2.5.5）。与 [`LoadedModel`] 一样只能在加载它的线程上使用。
pub struct LoadedDiarization {
    pub diarizer: Box<dyn SpeakerDiarization>,
    /// 加载耗时（毫秒）：说话人区分没有单独的预热，`model.load` 的 `warmupMs` 报这个。
    pub load_ms: u64,
    /// 加载后的常驻字节数；后端报告不了时 `None`。
    pub resident_bytes: Option<u64>,
    /// 后端的内存快照（任务之后刷新 `worker.status`）。
    pub memory: fn() -> Option<MemorySnapshot>,
}

/// 加载好的文生图模型：一只图像引擎。与 [`LoadedModel`] 一样只能在加载它的线程上使用。
///
/// 加载只核对清单、读分词表与调度器配置；三段权重在每次生成里按阶段流式读入、用完即丢，所以加载后的常驻很小，
/// 生成时的峰值由 Runtime 按模型包的实测峰值做准入（模型 Worker 协议规范 §4.2）。
pub struct LoadedImage {
    pub engine: Box<dyn ImageEngine>,
    /// 加载耗时（毫秒）：`model.load` 的 `warmupMs` 报这个。
    pub load_ms: u64,
    /// 加载后的常驻字节数；后端报告不了时 `None`。
    pub resident_bytes: Option<u64>,
    /// 后端的内存快照（任务之后刷新 `worker.status`）。
    pub memory: fn() -> Option<MemorySnapshot>,
}

/// 一个模型包加载出来的东西：识别（VAD + ASR）、合成（TTS 引擎）、分离、文生图（图像引擎）或说话人区分。
pub enum Loaded {
    Transcription(Box<dyn LoadedModel>),
    Synthesis(LoadedSynthesis),
    Separation(LoadedSeparation),
    Image(LoadedImage),
    Diarization(LoadedDiarization),
}

impl Loaded {
    pub fn memory(&self) -> Option<MemorySnapshot> {
        match self {
            Self::Transcription(model) => model.memory(),
            Self::Synthesis(synthesis) => (synthesis.memory)(),
            Self::Separation(separation) => (separation.memory)(),
            Self::Image(image) => (image.memory)(),
            Self::Diarization(diarization) => (diarization.memory)(),
        }
    }

    pub fn resident_bytes(&self) -> Option<u64> {
        match self {
            Self::Transcription(model) => model.resident_bytes(),
            Self::Synthesis(synthesis) => synthesis.resident_bytes,
            Self::Separation(separation) => separation.resident_bytes,
            Self::Image(image) => image.resident_bytes,
            Self::Diarization(diarization) => diarization.resident_bytes,
        }
    }

    pub fn warmup_ms(&self) -> u64 {
        match self {
            Self::Transcription(model) => model.warmup_ms(),
            Self::Synthesis(synthesis) => synthesis.load_ms,
            Self::Separation(separation) => separation.load_ms,
            Self::Image(image) => image.load_ms,
            Self::Diarization(diarization) => diarization.load_ms,
        }
    }
}

/// 一个推理后端。
pub trait Backend: Sync {
    fn id(&self) -> &'static str;

    /// `worker.hello` 里的后端条目。
    fn status(&self) -> BackendStatus;

    /// 加载模型包。组件的 family 与内存预算已由 [`load`] 检查过。
    fn load(&self, bundle: &VerifiedBundle, phase: &mut PhaseCallback<'_>) -> Result<Box<dyn LoadedModel>, ErrorBody>;

    /// 加载合成的模型包（`kind` 由 `tts` 组件的 family 决定）。组件、family 与预算已由 [`load`] 检查过。
    fn load_synthesis(
        &self,
        _bundle: &VerifiedBundle,
        _kind: TtsEngineKind,
        _phase: &mut PhaseCallback<'_>,
    ) -> Result<LoadedSynthesis, ErrorBody> {
        Err(not_compiled(self.id()))
    }

    /// 加载分离的模型包（`separator` 组件）。组件、family 与预算已由 [`load`] 检查过。
    fn load_separation(&self, _bundle: &VerifiedBundle, _phase: &mut PhaseCallback<'_>) -> Result<LoadedSeparation, ErrorBody> {
        Err(not_compiled(self.id()))
    }

    /// 加载说话人区分的模型包（`segmentation` + `speaker`）。组件、family 与预算已由 [`load`] 检查过。
    fn load_diarization(&self, _bundle: &VerifiedBundle, _phase: &mut PhaseCallback<'_>) -> Result<LoadedDiarization, ErrorBody> {
        Err(not_compiled(self.id()))
    }

    /// 加载文生图的模型包。组件与 family 已由 [`load`] 检查过。
    fn load_image(&self, _bundle: &VerifiedBundle, _phase: &mut PhaseCallback<'_>) -> Result<LoadedImage, ErrorBody> {
        Err(not_compiled(self.id()))
    }
}

/// 本构建认识的全部后端。
pub fn all() -> [&'static dyn Backend; 4] {
    [mlx_backend(), coreml_backend(), candle_backend(), ggml_backend()]
}

/// 本构建认识的识别主模型 family（`components.asr.family`）。
pub const TRANSCRIBE_FAMILIES: [&str; 5] = [
    FAMILY_QWEN3_ASR,
    FAMILY_WHISPER_MLX,
    FAMILY_WHISPER_COREML,
    FAMILY_WHISPER_GGML,
    FAMILY_MOSS_TRANSCRIBE_DIARIZE,
];

/// 这个识别主模型 family 在这个构建里能不能加载。还没接上加载器的报 `false`。
pub fn transcribe_family_available(family: &str) -> bool {
    match family {
        FAMILY_QWEN3_ASR | FAMILY_MOSS_TRANSCRIBE_DIARIZE => cfg!(any(
            all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"),
            feature = "backend-candle"
        )),
        FAMILY_WHISPER_MLX => cfg!(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")),
        FAMILY_WHISPER_COREML => cfg!(all(feature = "backend-coreml", target_os = "macos", target_arch = "aarch64")),
        FAMILY_WHISPER_GGML => cfg!(feature = "whisper-ggml"),
        _ => false,
    }
}

/// 这个构建能不能加载强制对齐器（`qwen3-forced-aligner`）：`worker.hello` 据此声明 `align`。MLX 与 candle 都有它。
pub fn aligner_available() -> bool {
    cfg!(any(
        all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"),
        feature = "backend-candle"
    ))
}

/// 这个构建能不能做说话人区分（Pyannote 分段 + WeSpeaker）：`worker.hello` 据此声明 `diarize`。MLX 与 candle 都有它
/// （CoreML 的 Whisper 借 MLX 的，GGML 的 Whisper 借 candle 的）；模型包还得带上 `segmentation` 组件。
pub fn diarizer_available() -> bool {
    aligner_available()
}

/// 这个构建能加载的识别主模型 family，按 [`TRANSCRIBE_FAMILIES`] 的次序。`worker.hello` 的 `transcribeFamilies`
/// 就是它；Runtime 不把没列出的 family 交给这个 Worker（协议规范 §2.1）。
pub fn transcribe_families() -> Vec<&'static str> {
    TRANSCRIBE_FAMILIES
        .into_iter()
        .filter(|family| transcribe_family_available(family))
        .collect()
}

/// 识别模型包里一个组件的要求。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Need {
    /// 必须有，且是这个 family。
    Required(&'static str),
    /// 可以有；有就必须是这个 family。
    Optional(&'static str),
    /// 不能有。
    Rejected,
}

/// 各识别主模型 family 对其余组件的要求：`vad`、`tokenizer`、`aligner`、`speaker`、`segmentation`。
/// `segmentation`（与 `speaker` 一起来自「说话人区分」模型包）只给自己不区分说话人的模型；MOSS 自己区分说话人，不要它。
fn transcribe_needs(family: &str) -> Option<[(&'static str, Need); 5]> {
    let aligner = ("aligner", Need::Optional(FAMILY_QWEN3_ALIGNER));
    let speaker = ("speaker", Need::Optional(FAMILY_WESPEAKER));
    let segmentation = ("segmentation", Need::Optional(FAMILY_PYANNOTE_SEGMENTATION));
    match family {
        FAMILY_QWEN3_ASR => Some([
            ("vad", Need::Required(FAMILY_SILERO_VAD)),
            ("tokenizer", Need::Rejected),
            aligner,
            speaker,
            segmentation,
        ]),
        FAMILY_WHISPER_MLX | FAMILY_WHISPER_COREML => Some([
            ("vad", Need::Required(FAMILY_SILERO_VAD)),
            ("tokenizer", Need::Required(FAMILY_WHISPER_TOKENIZER)),
            aligner,
            speaker,
            segmentation,
        ]),
        // GGML 权重自带词表：带分词器是模型包写错了。
        FAMILY_WHISPER_GGML => Some([
            ("vad", Need::Required(FAMILY_SILERO_VAD)),
            ("tokenizer", Need::Rejected),
            aligner,
            speaker,
            segmentation,
        ]),
        // MOSS 自己切段、自己区分说话人：带 VAD 或说话人分段是模型包写错了。
        FAMILY_MOSS_TRANSCRIBE_DIARIZE => Some([
            ("vad", Need::Rejected),
            ("tokenizer", Need::Rejected),
            aligner,
            speaker,
            ("segmentation", Need::Rejected),
        ]),
        _ => None,
    }
}

/// 按 id 找后端。
pub fn by_id(id: &str) -> Option<&'static dyn Backend> {
    all().into_iter().find(|backend| backend.id() == id)
}

/// `worker.hello` 的 `backends`。
pub fn statuses() -> Vec<BackendStatus> {
    all().iter().map(|backend| backend.status()).collect()
}

/// 检查组件与预算，再交给对应后端加载。带 `separator` 的是分离的模型包；带 `image` 的是文生图的模型包；带 `tts` 的
/// 是合成的模型包，按它的 family 加载引擎；带 `segmentation` 而没有 `asr` 的是说话人区分的模型包；其余是识别。
///
/// 文生图不按权重总量查 `memoryBudgetBytes`：三段权重逐层流式读入、从不同时驻留，权重总量（约 10 GB）不是峰值；
/// 峰值由 Runtime 按模型包的实测值做准入。
pub fn load(bundle: &VerifiedBundle, phase: &mut PhaseCallback<'_>) -> Result<Loaded, ErrorBody> {
    let backend = by_id(&bundle.backend).ok_or_else(|| {
        ErrorBody::new(codes::MODEL_UNSUPPORTED, "unknown backend")
            .with_details(json!({ "backend": bundle.backend, "reason": "unknown-backend" }))
    })?;
    if let Some(separator) = bundle.separator.as_ref() {
        check_separation(bundle, separator)?;
        check_budget(bundle)?;
        return backend.load_separation(bundle, phase).map(Loaded::Separation);
    }
    if let Some(files) = bundle.image.as_ref() {
        check_image(bundle, files)?;
        return backend.load_image(bundle, phase).map(Loaded::Image);
    }
    if let Some(tts) = bundle.tts.as_ref() {
        let kind = synthesis_kind(bundle, tts)?;
        check_budget(bundle)?;
        return backend.load_synthesis(bundle, kind, phase).map(Loaded::Synthesis);
    }
    if bundle.asr.is_none() && bundle.segmentation.is_some() {
        check_diarization(bundle)?;
        check_budget(bundle)?;
        return backend.load_diarization(bundle, phase).map(Loaded::Diarization);
    }
    if bundle.codec.is_some() || bundle.aux.is_some() {
        return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "the bundle has no tts component")
            .with_details(json!({ "component": "tts", "reason": "missing-component" })));
    }
    let family = transcription_family(bundle)?;
    if !transcribe_family_available(family) {
        return Err(transcription_not_wired(Some(family)));
    }
    check_budget(bundle)?;
    backend.load(bundle, phase).map(Loaded::Transcription)
}

/// 识别模型包的组件检查：`asr` 的 family 认得出，其余组件合它的要求（[`transcribe_needs`]）。带了对齐器的由后端
/// 一起加载（MOSS 按需加载）；说话人模型在 MOSS 上用来合并跨块的说话人，在 Qwen3-ASR 与 Whisper 上与 `segmentation`
/// 一起做说话人区分（[`LoadedModel::diarizer`]，按需加载）。返回 `asr` 的 family。
fn transcription_family(bundle: &VerifiedBundle) -> Result<&str, ErrorBody> {
    let Some(asr) = bundle.asr.as_ref() else {
        return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "the bundle has no asr component")
            .with_details(json!({ "component": "asr", "reason": "missing-component" })));
    };
    let Some(needs) = transcribe_needs(&asr.family) else {
        return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "unsupported asr model family")
            .with_details(json!({ "component": "asr", "family": asr.family, "reason": "unknown-family" })));
    };
    for (component, need) in needs {
        let files = match component {
            "vad" => bundle.vad.as_ref(),
            "tokenizer" => bundle.tokenizer.as_ref(),
            "aligner" => bundle.aligner.as_ref(),
            "segmentation" => bundle.segmentation.as_ref(),
            _ => bundle.speaker.as_ref(),
        };
        check_component(component, files, need)?;
    }
    Ok(&asr.family)
}

/// 合成模型包的组件检查：`tts` 的 family 认得出、这个构建接上了它的引擎（没接上的是 `not-wired`，Runtime 按
/// `worker.hello` 的 `synthesizeFamilies` 本不会发来）；识别的组件不混进来；`codec` 只给 Qwen3-TTS，
/// `aux` 只给 IndexTTS 2.5（缺 `aux` 由引擎报 `MODEL_UNSUPPORTED`）。
fn synthesis_kind(bundle: &VerifiedBundle, tts: &VerifiedFiles) -> Result<TtsEngineKind, ErrorBody> {
    let Some(kind) = TtsEngineKind::from_family(&tts.family) else {
        return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "unsupported tts model family")
            .with_details(json!({ "component": "tts", "family": tts.family, "reason": "unknown-family" })));
    };
    if !synthesize::engine_available(kind) {
        return Err(synthesis_not_wired(Some(&tts.family)));
    }
    for (component, files) in [
        ("asr", &bundle.asr),
        ("vad", &bundle.vad),
        ("aligner", &bundle.aligner),
        ("speaker", &bundle.speaker),
        ("segmentation", &bundle.segmentation),
        ("tokenizer", &bundle.tokenizer),
    ] {
        if files.is_some() {
            return Err(
                ErrorBody::new(codes::MODEL_UNSUPPORTED, "a synthesis bundle cannot carry recognition components")
                    .with_details(json!({ "component": component, "reason": "unexpected-component" })),
            );
        }
    }
    if let Some(codec) = bundle.codec.as_ref()
        && (kind != TtsEngineKind::Qwen3Tts || codec.family != FAMILY_QWEN3_TTS_CODEC)
    {
        return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "unsupported codec model family")
            .with_details(json!({ "component": "codec", "family": codec.family, "reason": "unknown-family" })));
    }
    if let Some(aux) = bundle.aux.as_ref()
        && (kind != TtsEngineKind::IndexTts25 || aux.family != FAMILY_INDEX_TTS2_AUX)
    {
        return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "unsupported aux model family")
            .with_details(json!({ "component": "aux", "family": aux.family, "reason": "unknown-family" })));
    }
    Ok(kind)
}

/// 分离模型包的组件检查：`separator` 的 family 认得出、这个构建有分离的后端（没有的是 `not-wired`，Runtime 按
/// `worker.hello` 的 `separateFamilies` 本不会发来）；不带别的组件。
fn check_separation(bundle: &VerifiedBundle, separator: &VerifiedFiles) -> Result<(), ErrorBody> {
    if separator.family != FAMILY_HTDEMUCS_FT {
        return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "unsupported separator model family")
            .with_details(json!({ "component": "separator", "family": separator.family, "reason": "unknown-family" })));
    }
    if !separate::available_families().contains(&FAMILY_HTDEMUCS_FT) {
        return Err(separation_not_wired(Some(&separator.family)));
    }
    for (component, files) in [
        ("asr", &bundle.asr),
        ("vad", &bundle.vad),
        ("aligner", &bundle.aligner),
        ("speaker", &bundle.speaker),
        ("segmentation", &bundle.segmentation),
        ("tokenizer", &bundle.tokenizer),
        ("tts", &bundle.tts),
        ("codec", &bundle.codec),
        ("aux", &bundle.aux),
        ("image", &bundle.image),
    ] {
        if files.is_some() {
            return Err(
                ErrorBody::new(codes::MODEL_UNSUPPORTED, "a separation bundle cannot carry other components")
                    .with_details(json!({ "component": component, "reason": "unexpected-component" })),
            );
        }
    }
    Ok(())
}

/// 说话人区分模型包的组件检查：`segmentation` 与 `speaker` 都要有、family 认得出，这个构建有说话人区分（没有的是
/// `not-wired`，Runtime 按 `worker.hello` 的 `capabilities` 本不会发来）；不带别的组件。
fn check_diarization(bundle: &VerifiedBundle) -> Result<(), ErrorBody> {
    check_component(
        "segmentation",
        bundle.segmentation.as_ref(),
        Need::Required(FAMILY_PYANNOTE_SEGMENTATION),
    )?;
    check_component("speaker", bundle.speaker.as_ref(), Need::Required(FAMILY_WESPEAKER))?;
    if !diarizer_available() {
        return Err(diarization_not_wired());
    }
    for (component, files) in [
        ("vad", &bundle.vad),
        ("aligner", &bundle.aligner),
        ("tokenizer", &bundle.tokenizer),
        ("tts", &bundle.tts),
        ("codec", &bundle.codec),
        ("aux", &bundle.aux),
        ("separator", &bundle.separator),
        ("image", &bundle.image),
    ] {
        if files.is_some() {
            return Err(ErrorBody::new(
                codes::MODEL_UNSUPPORTED,
                "a speaker diarization bundle cannot carry other components",
            )
            .with_details(json!({ "component": component, "reason": "unexpected-component" })));
        }
    }
    Ok(())
}

/// 文生图模型包的组件检查：`image` 的 family 认得出、这个构建接上了它（没接上的是 `not-wired`，Runtime 按
/// `worker.hello` 的 `imageFamilies` 本不会发来）；别的组件都不混进来。
fn check_image(bundle: &VerifiedBundle, files: &VerifiedFiles) -> Result<(), ErrorBody> {
    if !image::IMAGE_FAMILIES.contains(&files.family.as_str()) {
        return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "unsupported image model family")
            .with_details(json!({ "component": "image", "family": files.family, "reason": "unknown-family" })));
    }
    if !image::family_available(&files.family) {
        return Err(image_not_wired(Some(&files.family)));
    }
    for (component, files) in [
        ("asr", &bundle.asr),
        ("vad", &bundle.vad),
        ("aligner", &bundle.aligner),
        ("speaker", &bundle.speaker),
        ("segmentation", &bundle.segmentation),
        ("tokenizer", &bundle.tokenizer),
        ("tts", &bundle.tts),
        ("codec", &bundle.codec),
        ("aux", &bundle.aux),
        ("separator", &bundle.separator),
    ] {
        if files.is_some() {
            return Err(
                ErrorBody::new(codes::MODEL_UNSUPPORTED, "an image bundle cannot carry other components")
                    .with_details(json!({ "component": component, "reason": "unexpected-component" })),
            );
        }
    }
    Ok(())
}

fn check_budget(bundle: &VerifiedBundle) -> Result<(), ErrorBody> {
    if let Some(budget) = bundle.memory_budget_bytes {
        let required = bundle.total_bytes();
        if required > budget {
            return Err(
                ErrorBody::new(codes::MODEL_RESOURCE, "model weights exceed the memory budget").with_details(json!({
                    "resource": "memory",
                    "requiredBytes": required,
                    "budgetBytes": budget,
                })),
            );
        }
    }
    Ok(())
}

fn check_component(component: &str, files: Option<&VerifiedFiles>, need: Need) -> Result<(), ErrorBody> {
    match (files, need) {
        (Some(_), Need::Rejected) => Err(ErrorBody::new(
            codes::MODEL_UNSUPPORTED,
            format!("this asr model family does not take a {component} component"),
        )
        .with_details(json!({ "component": component, "reason": "unexpected-component" }))),
        (Some(files), Need::Required(family) | Need::Optional(family)) if files.family != family => Err(ErrorBody::new(
            codes::MODEL_UNSUPPORTED,
            format!("unsupported {component} model family"),
        )
        .with_details(json!({ "component": component, "family": files.family, "reason": "unknown-family" }))),
        (None, Need::Required(_)) => Err(
            ErrorBody::new(codes::MODEL_UNSUPPORTED, format!("the bundle has no {component} component"))
                .with_details(json!({ "component": component, "reason": "missing-component" })),
        ),
        _ => Ok(()),
    }
}

/// `BCUT_SPEECH_TIMING=1` 时向 stderr 输出分阶段计时（benchmark/诊断用）。与推理后端无关，进程内只读一次。
///
/// 移植自 v2；MOSS、本地语音合成等批次的引擎用它决定是否打印分阶段耗时，接入前没有调用方。
pub fn speech_timing_enabled() -> bool {
    static ENABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var_os("BCUT_SPEECH_TIMING").as_deref() == Some(std::ffi::OsStr::new("1")))
}

/// 后端没编译进来时的统一错误。
pub fn not_compiled(id: &str) -> ErrorBody {
    ErrorBody::new(codes::MODEL_UNSUPPORTED, format!("backend {id} is not available in this build"))
        .with_details(json!({ "backend": id, "reason": REASON_NOT_COMPILED }))
}

#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
fn mlx_backend() -> &'static dyn Backend {
    &mlx::MlxBackend
}

#[cfg(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")))]
fn mlx_backend() -> &'static dyn Backend {
    &MlxUnavailable
}

/// 没编译 MLX（别的平台，或关掉了 `backend-mlx`）时的占位。
#[cfg(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")))]
struct MlxUnavailable;

#[cfg(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")))]
impl Backend for MlxUnavailable {
    fn id(&self) -> &'static str {
        "mlx"
    }

    fn status(&self) -> BackendStatus {
        BackendStatus {
            id: "mlx",
            available: false,
            reason: Some(REASON_NOT_COMPILED.into()),
            devices: Vec::new(),
        }
    }

    fn load(&self, _bundle: &VerifiedBundle, _phase: &mut PhaseCallback<'_>) -> Result<Box<dyn LoadedModel>, ErrorBody> {
        Err(not_compiled("mlx"))
    }
}

#[cfg(all(feature = "backend-coreml", target_os = "macos", target_arch = "aarch64"))]
fn coreml_backend() -> &'static dyn Backend {
    &coreml::CoreMlBackend
}

#[cfg(not(all(feature = "backend-coreml", target_os = "macos", target_arch = "aarch64")))]
fn coreml_backend() -> &'static dyn Backend {
    &CoreMlUnavailable
}

/// 没编译 CoreML（别的平台，或关掉了 `backend-coreml`）时的占位。
#[cfg(not(all(feature = "backend-coreml", target_os = "macos", target_arch = "aarch64")))]
struct CoreMlUnavailable;

#[cfg(not(all(feature = "backend-coreml", target_os = "macos", target_arch = "aarch64")))]
impl Backend for CoreMlUnavailable {
    fn id(&self) -> &'static str {
        "coreml"
    }

    fn status(&self) -> BackendStatus {
        BackendStatus {
            id: "coreml",
            available: false,
            reason: Some(REASON_NOT_COMPILED.into()),
            devices: Vec::new(),
        }
    }

    fn load(&self, _bundle: &VerifiedBundle, _phase: &mut PhaseCallback<'_>) -> Result<Box<dyn LoadedModel>, ErrorBody> {
        Err(not_compiled("coreml"))
    }
}

#[cfg(feature = "backend-candle")]
fn candle_backend() -> &'static dyn Backend {
    &candle::CandleBackend
}

#[cfg(not(feature = "backend-candle"))]
fn candle_backend() -> &'static dyn Backend {
    &CandleUnavailable
}

/// 没编译 candle（关掉了 `backend-candle`）时的占位。
#[cfg(not(feature = "backend-candle"))]
struct CandleUnavailable;

#[cfg(not(feature = "backend-candle"))]
impl Backend for CandleUnavailable {
    fn id(&self) -> &'static str {
        "candle"
    }

    fn status(&self) -> BackendStatus {
        BackendStatus {
            id: "candle",
            available: false,
            reason: Some(REASON_NOT_COMPILED.into()),
            devices: Vec::new(),
        }
    }

    fn load(&self, _bundle: &VerifiedBundle, _phase: &mut PhaseCallback<'_>) -> Result<Box<dyn LoadedModel>, ErrorBody> {
        Err(not_compiled("candle"))
    }
}

#[cfg(feature = "whisper-ggml")]
fn ggml_backend() -> &'static dyn Backend {
    &ggml::GgmlBackend
}

#[cfg(not(feature = "whisper-ggml"))]
fn ggml_backend() -> &'static dyn Backend {
    &GgmlUnavailable
}

/// 没编译 whisper.cpp（关掉了 `whisper-ggml`）时的占位。
#[cfg(not(feature = "whisper-ggml"))]
struct GgmlUnavailable;

#[cfg(not(feature = "whisper-ggml"))]
impl Backend for GgmlUnavailable {
    fn id(&self) -> &'static str {
        "ggml"
    }

    fn status(&self) -> BackendStatus {
        BackendStatus {
            id: "ggml",
            available: false,
            reason: Some(REASON_NOT_COMPILED.into()),
            devices: Vec::new(),
        }
    }

    fn load(&self, _bundle: &VerifiedBundle, _phase: &mut PhaseCallback<'_>) -> Result<Box<dyn LoadedModel>, ErrorBody> {
        Err(not_compiled("ggml"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_every_backend() {
        let statuses = statuses();
        assert_eq!(
            statuses.iter().map(|status| status.id).collect::<Vec<_>>(),
            ["mlx", "coreml", "candle", "ggml"]
        );
        let candle = &statuses[2];
        if cfg!(feature = "backend-candle") {
            // candle 不挑机器：编译进来就可用，CPU 总在设备列表的最后。
            assert!(candle.available);
            assert_eq!(candle.devices.last().map(String::as_str), Some("cpu"));
        } else {
            assert!(!candle.available);
            assert_eq!(candle.reason.as_deref(), Some(REASON_NOT_COMPILED));
        }
        for status in &statuses[..2] {
            if !status.available {
                assert!(matches!(
                    status.reason.as_deref(),
                    Some(REASON_NOT_COMPILED | REASON_NO_METAL_DEVICE)
                ));
            }
        }
        let ggml = &statuses[3];
        if cfg!(feature = "whisper-ggml") {
            // ggml 同样不挑机器：CPU 总在设备列表的最后（有 CUDA 或 Vulkan GPU 时排在前面）。
            assert!(ggml.available);
            assert_eq!(ggml.devices.last().map(String::as_str), Some("cpu"));
        } else {
            assert!(!ggml.available);
            assert_eq!(ggml.reason.as_deref(), Some(REASON_NOT_COMPILED));
        }
        let coreml = &statuses[1];
        if cfg!(all(feature = "backend-coreml", target_os = "macos", target_arch = "aarch64")) {
            // VAD 在 MLX 上：与 MLX 同看 Metal 设备。
            assert_eq!(coreml.available, statuses[0].available);
        } else {
            assert_eq!(coreml.reason.as_deref(), Some(REASON_NOT_COMPILED));
        }
    }

    /// 按组件名与 family 拼一个识别模型包，每个组件一个 1 字节的文件。
    fn transcription_bundle(dir: &std::path::Path, components: &[(&str, &str)]) -> VerifiedBundle {
        std::fs::write(dir.join("weights.bin"), b"1").unwrap();
        let mut map = serde_json::Map::new();
        for (component, family) in components {
            map.insert(
                (*component).into(),
                json!({
                    "family": family,
                    "revision": "r",
                    "dir": dir.to_string_lossy(),
                    "files": [{ "path": "weights.bin", "sha256": "", "byteLength": 1 }],
                }),
            );
        }
        let bundle: crate::bundle::ModelBundle = serde_json::from_value(json!({
            "bundleId": "b",
            "backend": "mlx",
            "device": "metal",
            "components": map,
            "threads": 1,
        }))
        .unwrap();
        crate::bundle::verify(&bundle).unwrap()
    }

    fn load_error(components: &[(&str, &str)]) -> serde_json::Value {
        let dir = tempfile::tempdir().unwrap();
        let bundle = transcription_bundle(dir.path(), components);
        let error = match load(&bundle, &mut |_, _| {}) {
            Ok(_) => panic!("the bundle should not load"),
            Err(error) => error,
        };
        assert_eq!(error.code, codes::MODEL_UNSUPPORTED);
        error.details.unwrap()
    }

    #[test]
    fn a_separation_bundle_carries_only_its_separator() {
        let separator = ("separator", FAMILY_HTDEMUCS_FT);
        let reason = |details: serde_json::Value| (details["component"].clone(), details["reason"].clone());
        assert_eq!(
            reason(load_error(&[("separator", "demucs-v3")])),
            (json!("separator"), json!("unknown-family"))
        );
        for other in [
            ("asr", FAMILY_QWEN3_ASR),
            ("vad", FAMILY_SILERO_VAD),
            ("tts", crate::bundle::FAMILY_QWEN3_TTS),
            ("codec", FAMILY_QWEN3_TTS_CODEC),
        ] {
            if separate::local_separation_available() {
                assert_eq!(
                    reason(load_error(&[separator, other])),
                    (json!(other.0), json!("unexpected-component"))
                );
            }
        }
        if !separate::local_separation_available() {
            assert_eq!(
                load_error(&[separator]),
                json!({ "capability": "separate", "reason": "not-wired", "family": FAMILY_HTDEMUCS_FT })
            );
        }
        // 1 字节的“权重”过了组件检查，交给后端：有 Metal 时读配置失败（缺文件），否则后端不可用。都不是成功。
        let dir = tempfile::tempdir().unwrap();
        let bundle = transcription_bundle(dir.path(), &[separator]);
        assert!(load(&bundle, &mut |_, _| {}).is_err());
    }

    #[test]
    fn a_diarization_bundle_carries_segmentation_and_speaker_only() {
        let segmentation = ("segmentation", FAMILY_PYANNOTE_SEGMENTATION);
        let speaker = ("speaker", FAMILY_WESPEAKER);
        let reason = |details: serde_json::Value| (details["component"].clone(), details["reason"].clone());
        assert_eq!(reason(load_error(&[segmentation])), (json!("speaker"), json!("missing-component")));
        assert_eq!(
            reason(load_error(&[segmentation, ("speaker", "ecapa")])),
            (json!("speaker"), json!("unknown-family"))
        );
        if diarizer_available() {
            for other in [("vad", FAMILY_SILERO_VAD), ("aligner", FAMILY_QWEN3_ALIGNER)] {
                assert_eq!(
                    reason(load_error(&[segmentation, speaker, other])),
                    (json!(other.0), json!("unexpected-component"))
                );
            }
        } else {
            assert_eq!(
                load_error(&[segmentation, speaker]),
                json!({ "capability": "diarize", "reason": "not-wired" })
            );
        }
        // 1 字节的“权重”不是 safetensors：过了组件检查也加载不起来。
        let dir = tempfile::tempdir().unwrap();
        let bundle = transcription_bundle(dir.path(), &[segmentation, speaker]);
        assert!(load(&bundle, &mut |_, _| {}).is_err());
    }

    #[test]
    fn each_asr_family_has_its_own_required_components() {
        let qwen = ("asr", FAMILY_QWEN3_ASR);
        let whisper = ("asr", FAMILY_WHISPER_MLX);
        let moss = ("asr", FAMILY_MOSS_TRANSCRIBE_DIARIZE);
        let vad = ("vad", FAMILY_SILERO_VAD);
        let tokenizer = ("tokenizer", FAMILY_WHISPER_TOKENIZER);
        let aligner = ("aligner", FAMILY_QWEN3_ALIGNER);
        let speaker = ("speaker", FAMILY_WESPEAKER);
        let segmentation = ("segmentation", FAMILY_PYANNOTE_SEGMENTATION);

        // 形状合规、加载器还没接上的 family：not-wired，点名 family。
        let not_wired = |family: &str| json!({ "capability": "transcribe", "reason": "not-wired", "family": family });
        if !transcribe_family_available(FAMILY_WHISPER_MLX) {
            assert_eq!(load_error(&[whisper, vad, tokenizer]), not_wired(FAMILY_WHISPER_MLX));
            assert_eq!(
                load_error(&[whisper, vad, tokenizer, aligner, speaker]),
                not_wired(FAMILY_WHISPER_MLX)
            );
        }
        let ggml = ("asr", FAMILY_WHISPER_GGML);
        if !transcribe_family_available(FAMILY_WHISPER_GGML) {
            assert_eq!(load_error(&[ggml, vad]), not_wired(FAMILY_WHISPER_GGML));
            assert_eq!(load_error(&[ggml, vad, aligner, speaker]), not_wired(FAMILY_WHISPER_GGML));
        }
        if !transcribe_family_available(FAMILY_MOSS_TRANSCRIBE_DIARIZE) {
            assert_eq!(load_error(&[moss]), not_wired(FAMILY_MOSS_TRANSCRIBE_DIARIZE));
            assert_eq!(load_error(&[moss, aligner, speaker]), not_wired(FAMILY_MOSS_TRANSCRIBE_DIARIZE));
        }

        // 形状不合：缺必需组件、带了不该带的组件、family 不对。
        let reason = |details: serde_json::Value| (details["component"].clone(), details["reason"].clone());
        assert_eq!(
            reason(load_error(&[whisper, vad])),
            (json!("tokenizer"), json!("missing-component"))
        );
        assert_eq!(
            reason(load_error(&[whisper, tokenizer])),
            (json!("vad"), json!("missing-component"))
        );
        // GGML 权重自带词表：不要分词器，要 VAD。
        assert_eq!(
            reason(load_error(&[ggml, vad, tokenizer])),
            (json!("tokenizer"), json!("unexpected-component"))
        );
        assert_eq!(reason(load_error(&[ggml])), (json!("vad"), json!("missing-component")));
        assert_eq!(reason(load_error(&[moss, vad])), (json!("vad"), json!("unexpected-component")));
        // MOSS 自己区分说话人：不带「说话人区分」的分段模型。别的识别模型带了，family 必须对。
        assert_eq!(
            reason(load_error(&[moss, speaker, segmentation])),
            (json!("segmentation"), json!("unexpected-component"))
        );
        assert_eq!(
            reason(load_error(&[qwen, vad, speaker, ("segmentation", FAMILY_WESPEAKER)])),
            (json!("segmentation"), json!("unknown-family"))
        );
        assert_eq!(
            reason(load_error(&[moss, tokenizer])),
            (json!("tokenizer"), json!("unexpected-component"))
        );
        assert_eq!(
            reason(load_error(&[qwen, vad, tokenizer])),
            (json!("tokenizer"), json!("unexpected-component"))
        );
        assert_eq!(reason(load_error(&[qwen])), (json!("vad"), json!("missing-component")));
        assert_eq!(reason(load_error(&[vad])), (json!("asr"), json!("missing-component")));
        assert_eq!(
            reason(load_error(&[("asr", "whisper"), vad])),
            (json!("asr"), json!("unknown-family"))
        );
        assert_eq!(
            reason(load_error(&[whisper, vad, ("tokenizer", FAMILY_QWEN3_ASR)])),
            (json!("tokenizer"), json!("unknown-family"))
        );
    }

    #[test]
    fn only_wired_families_are_reported() {
        let families = transcribe_families();
        for family in &families {
            assert!(TRANSCRIBE_FAMILIES.contains(family));
        }
        let mut expected = Vec::new();
        let qwen_and_moss = cfg!(any(
            all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"),
            feature = "backend-candle"
        ));
        if qwen_and_moss {
            expected.push(FAMILY_QWEN3_ASR);
        }
        if cfg!(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")) {
            expected.push(FAMILY_WHISPER_MLX);
        }
        if cfg!(all(feature = "backend-coreml", target_os = "macos", target_arch = "aarch64")) {
            expected.push(FAMILY_WHISPER_COREML);
        }
        if cfg!(feature = "whisper-ggml") {
            expected.push(FAMILY_WHISPER_GGML);
        }
        if qwen_and_moss {
            expected.push(FAMILY_MOSS_TRANSCRIBE_DIARIZE);
        }
        assert_eq!(aligner_available(), qwen_and_moss);
        assert_eq!(diarizer_available(), qwen_and_moss);
        assert_eq!(families, expected);
    }

    #[test]
    fn phases_use_protocol_names() {
        assert_eq!(ModelPhase::LoadingWeights.as_str(), "loading-weights");
        assert_eq!(ModelPhase::Compiling.as_str(), "compiling");
        assert_eq!(ModelPhase::WarmingUp.as_str(), "warming-up");
    }
}
