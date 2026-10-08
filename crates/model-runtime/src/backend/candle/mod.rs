//! candle 跨平台推理后端（CPU 全平台，可选 CUDA），从 v2 `bcut-speech` 的 `candle_backend` 移植。
//!
//! 与 `mlx` 后端加载同一批模型仓库：MLX 仿射量化权重在加载时反量化（数值与 MLX `quantized_matmul` 所用的权重
//! 完全一致）。CPU 上统一按 f32 计算；CUDA 上沿用 checkpoint 自身的半精度（bf16/f16）。模型实现 [`crate::speech`]
//! 的 trait，识别流水线（[`crate::transcribe`]）不感知后端。
//!
//! 设备：`cuda` feature 编译进来且 `BAOCUT_GPU` 没关掉 GPU 时用 CUDA 0 号卡，初始化失败回退 CPU 并在 stderr 提示
//! 一次；否则 CPU。`worker.hello` 报 `devices`：能用 CUDA 时 `["cuda", "cpu"]`，否则 `["cpu"]`。模型包的 `device`
//! 是 `cpu` 时一律跑 CPU。Silero VAD 总在 CPU 上跑（逐 32 ms 小块，搬上 GPU 只会更慢）。

pub mod aligner;
pub mod audio_encoder;
pub mod layers;
pub mod moss;
pub mod pyannote;
pub mod qwen3;
pub mod silero;
pub mod text_decoder;
pub mod thinker_weights;
pub mod weights;
pub mod wespeaker;

use std::sync::OnceLock;
use std::time::Instant;

use anyhow::bail;
use candle_core::{Device, IndexOp, Tensor};
use serde_json::{Value, json};

use super::{Backend, LoadedDiarization, LoadedImage, LoadedModel, LoadedSeparation, LoadedSynthesis, ModelPhase, PhaseCallback, RunMode};
use crate::bundle::{FAMILY_MOSS_TRANSCRIBE_DIARIZE, FAMILY_QWEN3_ASR, VerifiedBundle, VerifiedFiles};
use crate::pressure::{self, MemoryPressure};
use crate::protocol::{BackendStatus, ErrorBody, MemorySnapshot, codes, transcription_not_wired};
use crate::speech::qwen3_asr::{Qwen3Config, TokenizerFiles};
use crate::speech::{
    ForcedAlignment, SegmentedTranscription, SegmentingCallbacks, SegmentingRecognizer, SpeakerDiarization, SpeakerEmbedding,
};
use crate::synthesize::TtsEngineKind;
pub use aligner::ForcedAligner;
pub use moss::MossTranscribeDiarize;
pub use pyannote::{DiarizerSlot, PyannoteDiarizer};
pub use qwen3::Qwen3Asr;
pub use silero::SileroVad;
pub use wespeaker::WeSpeakerEmbedder;

/// candle 认的设备名。
pub const DEVICE_CPU: &str = "cpu";
pub const DEVICE_CUDA: &str = "cuda";

/// 本进程的默认推理设备，只解析一次：开启 `cuda` feature、`BAOCUT_GPU` 没关掉 GPU、且 CUDA 初始化成功时用 CUDA 0
/// 号卡，否则 CPU。编译进了 CUDA 却初始化失败时在 stderr 提示一次，避免静默退化成 CPU 后难以定位。
pub fn default_device() -> Device {
    static DEVICE: OnceLock<Device> = OnceLock::new();
    DEVICE.get_or_init(resolve_device).clone()
}

#[cfg(feature = "cuda")]
fn resolve_device() -> Device {
    if crate::gpu_env::gpu_disabled_by_env() {
        return Device::Cpu;
    }
    match Device::new_cuda(0) {
        Ok(device) => device,
        Err(error) => {
            eprintln!("[model-worker] CUDA initialisation failed, falling back to the CPU: {error}");
            Device::Cpu
        }
    }
}

#[cfg(not(feature = "cuda"))]
fn resolve_device() -> Device {
    Device::Cpu
}

/// 设备的协议名（`cpu` / `cuda`）。
pub fn device_label(device: &Device) -> &'static str {
    if device.is_cuda() { DEVICE_CUDA } else { DEVICE_CPU }
}

/// 把底层的 CUDA 显存不足报错补上可操作的提示。
pub(crate) fn annotate_out_of_memory(error: anyhow::Error) -> anyhow::Error {
    let text = format!("{error:#}");
    if text.contains("OUT_OF_MEMORY") || text.contains("out of memory") {
        error.context("CUDA ran out of GPU memory: close other programs using the GPU and retry, or set BAOCUT_GPU=off to run on the CPU")
    } else {
        error
    }
}

/// 触发一个最小计算，验证 candle 运行时在默认设备上能算；返回设备的协议名。
pub fn compute_probe() -> anyhow::Result<&'static str> {
    let device = default_device();
    let values = Tensor::from_slice(&[1.0_f32, 2.0, 3.0, 4.0], (2, 2), &device)?;
    let output = values.matmul(&values.t()?)?;
    let item = output.i((0, 0))?.to_scalar::<f32>()?;
    if (item - 5.0).abs() > 1e-5 {
        bail!("candle compute probe returned {item}");
    }
    Ok(device_label(&device))
}

pub struct CandleBackend;

impl Backend for CandleBackend {
    fn id(&self) -> &'static str {
        "candle"
    }

    fn status(&self) -> BackendStatus {
        let devices = if default_device().is_cuda() {
            vec![DEVICE_CUDA.into(), DEVICE_CPU.into()]
        } else {
            vec![DEVICE_CPU.into()]
        };
        BackendStatus {
            id: "candle",
            available: true,
            reason: None,
            devices,
        }
    }

    fn load(&self, bundle: &VerifiedBundle, phase: &mut PhaseCallback<'_>) -> Result<Box<dyn LoadedModel>, ErrorBody> {
        let device = check_device(bundle)?;
        if let Some(asr_files) = &bundle.asr
            && asr_files.family == FAMILY_MOSS_TRANSCRIBE_DIARIZE
        {
            return load_moss(bundle, asr_files, device, phase);
        }
        let (Some(asr_files), Some(vad_files)) = (&bundle.asr, &bundle.vad) else {
            // backend::load 已经检查过；这里只为类型。
            return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "the bundle needs asr and vad components"));
        };
        if asr_files.family != FAMILY_QWEN3_ASR {
            return Err(transcription_not_wired(Some(&asr_files.family)));
        }

        // 权重之外的文件先读、先核对：配置不对时不必读几百 MB 的权重。
        let config = read_json(asr_files, "config.json")?;
        let config = Qwen3Config::parse(&config).map_err(|message| {
            eprintln!("[model-worker] {message}");
            ErrorBody::new(codes::MODEL_UNSUPPORTED, "unsupported Qwen3-ASR configuration")
                .with_details(json!({ "component": "asr", "file": "config.json", "reason": "unsupported-config" }))
        })?;
        let tokenizer = TokenizerFiles {
            vocabulary: asr_files.require("vocab.json")?,
            merges: Some(asr_files.require("merges.txt")?),
            config: asr_files.path("tokenizer_config.json"),
        };
        let asr_weights = asr_files.require_extension("safetensors")?;
        let vad_weights = vad_files.require_extension("safetensors")?;
        // 对齐器是可选组件：模型包带了才加载，缺文件同样报 MODEL_NOT_INSTALLED（不悄悄退回估计的词时间）。
        check_aligner_files(bundle)?;
        // 说话人区分同样可选：只核对文件，任务里要用时才加载。
        let diarizer = DiarizerSlot::new(bundle, &device)?;

        phase(ModelPhase::LoadingWeights, Some("vad"));
        let vad = SileroVad::load(&vad_weights).map_err(|error| load_failed("vad", &error))?;
        phase(ModelPhase::LoadingWeights, Some("asr"));
        let mut asr = Qwen3Asr::load(config, &asr_weights, tokenizer, &device).map_err(|error| load_failed("asr", &error))?;
        let aligner = match &bundle.aligner {
            Some(aligner_files) => {
                phase(ModelPhase::LoadingWeights, Some("aligner"));
                Some(ForcedAligner::load(aligner_files, &device).map_err(|error| load_failed("aligner", &error))?)
            }
            None => None,
        };

        phase(ModelPhase::WarmingUp, None);
        let started = Instant::now();
        asr.warmup().map_err(|error| load_failed("asr", &error))?;
        let warmup_ms = started.elapsed().as_millis() as u64;
        Ok(Box::new(CandleModel {
            vad,
            asr,
            aligner,
            diarizer,
            warmup_ms,
            resident_bytes: process_resident_bytes(),
        }))
    }

    /// 文生图（Qwen-Image）：引擎先核对清单与配置、读分词表与调度器配置；三段权重留到生成时按阶段读（同 MLX 后端）。
    fn load_image(&self, bundle: &VerifiedBundle, phase: &mut PhaseCallback<'_>) -> Result<LoadedImage, ErrorBody> {
        let device = check_device(bundle)?;
        let Some(files) = &bundle.image else {
            // backend::load 已经检查过；这里只为类型。
            return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "the bundle needs an image component"));
        };
        phase(ModelPhase::LoadingWeights, Some(files.family.as_str()));
        let started = Instant::now();
        let engine = crate::image::qwen_image::candle::QwenImage::load(files, device).map_err(|error| load_failed("image", &error))?;
        Ok(LoadedImage {
            engine: Box::new(engine),
            load_ms: started.elapsed().as_millis() as u64,
            resident_bytes: process_resident_bytes(),
            memory,
        })
    }

    /// 本地语音合成：引擎经 `synthesize::tensor` 门面跑在 candle 上（v2 同一份适配层），张量固定落在本进程的默认设备，
    /// 所以模型包的设备必须就是默认设备（Runtime 按 `worker.hello` 报告的首选设备下发，正常不会不同）。
    /// Apple Silicon 上同时编进 MLX 时门面是 MLX，candle 的合成模型包在这里拒绝。
    fn load_synthesis(
        &self,
        bundle: &VerifiedBundle,
        kind: TtsEngineKind,
        phase: &mut PhaseCallback<'_>,
    ) -> Result<LoadedSynthesis, ErrorBody> {
        #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
        {
            let _ = (bundle, kind, phase);
            Err(
                ErrorBody::new(codes::MODEL_UNSUPPORTED, "local synthesis runs on the mlx backend in this build")
                    .with_details(json!({ "backend": "candle", "reason": "engine-unavailable" })),
            )
        }
        #[cfg(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")))]
        {
            let device = check_device(bundle)?;
            let default = default_device();
            if device_label(&device) != device_label(&default) {
                return Err(ErrorBody::new(
                    codes::MODEL_UNSUPPORTED,
                    format!("local synthesis runs on this worker's {} device", device_label(&default)),
                )
                .with_details(json!({ "backend": "candle", "device": bundle.device, "reason": "unsupported-device" })));
            }
            let Some(model) = &bundle.tts else {
                // backend::load 已经检查过；这里只为类型。
                return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "the bundle needs a tts component"));
            };
            let files = crate::synthesize::EngineFiles {
                model,
                codec: bundle.codec.as_ref(),
                aux: bundle.aux.as_ref(),
            };
            phase(ModelPhase::LoadingWeights, Some(kind.family()));
            let started = Instant::now();
            let engine = crate::synthesize::load(kind, files).map_err(|error| load_failed("tts", &annotate_out_of_memory(error)))?;
            Ok(LoadedSynthesis {
                kind,
                engine,
                load_ms: started.elapsed().as_millis() as u64,
                resident_bytes: process_resident_bytes(),
                memory,
            })
        }
    }

    /// 说话人区分单独加载（协议规范 §2.5.5）：与 MLX 读同一批 Pyannote 分段与 WeSpeaker 权重，常驻到卸载。
    fn load_diarization(&self, bundle: &VerifiedBundle, phase: &mut PhaseCallback<'_>) -> Result<LoadedDiarization, ErrorBody> {
        let device = check_device(bundle)?;
        let (Some(segmentation), Some(speaker)) = (&bundle.segmentation, &bundle.speaker) else {
            // backend::load 已经检查过；这里只为类型。
            return Err(ErrorBody::new(
                codes::MODEL_UNSUPPORTED,
                "the bundle needs segmentation and speaker components",
            ));
        };
        segmentation.require_extension_in("", "safetensors")?;
        speaker.require_extension_in("", "safetensors")?;
        phase(ModelPhase::LoadingWeights, Some("segmentation"));
        let started = Instant::now();
        let diarizer = PyannoteDiarizer::load_with_embedding(segmentation, speaker, &device)
            .map_err(|error| load_failed("segmentation", &annotate_out_of_memory(error)))?;
        Ok(LoadedDiarization {
            diarizer: Box::new(diarizer),
            load_ms: started.elapsed().as_millis() as u64,
            resident_bytes: process_resident_bytes(),
            memory,
        })
    }

    /// 人声分离（HTDemucs-FT）：与 MLX 读同一个仓库，四个子模型的权重加载时升成 f32 常驻（CPU 与 CUDA 都是，同 v2）。
    fn load_separation(&self, bundle: &VerifiedBundle, phase: &mut PhaseCallback<'_>) -> Result<LoadedSeparation, ErrorBody> {
        let device = check_device(bundle)?;
        let Some(files) = &bundle.separator else {
            // backend::load 已经检查过；这里只为类型。
            return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "the bundle needs a separator component"));
        };
        phase(ModelPhase::LoadingWeights, Some(files.family.as_str()));
        let started = Instant::now();
        let separator = crate::separate::load_candle_separator(files, device)
            .map_err(|error| load_failed("separator", &annotate_out_of_memory(error)))?;
        Ok(LoadedSeparation {
            separator,
            load_ms: started.elapsed().as_millis() as u64,
            resident_bytes: process_resident_bytes(),
            memory,
        })
    }
}

/// MOSS 模型包：MOSS 引擎在这里加载；可选的对齐器与说话人模型只核对文件，任务里要用时才加载、任务结束放掉（同 MLX
/// 后端与 v2：三份权重不常驻在一起）。MOSS 没有预热，`warmupMs` 是 0。
fn load_moss(
    bundle: &VerifiedBundle,
    asr_files: &VerifiedFiles,
    device: Device,
    phase: &mut PhaseCallback<'_>,
) -> Result<Box<dyn LoadedModel>, ErrorBody> {
    check_aligner_files(bundle)?;
    if let Some(speaker_files) = &bundle.speaker {
        speaker_files.require_extension_in("", "safetensors")?;
    }
    phase(ModelPhase::LoadingWeights, Some("asr"));
    let engine = MossTranscribeDiarize::load(asr_files, &device).map_err(|error| load_failed("asr", &error))?;
    Ok(Box::new(CandleMossModel {
        engine: Some(engine),
        asr_files: asr_files.clone(),
        aligner_files: bundle.aligner.clone(),
        speaker_files: bundle.speaker.clone(),
        aligner: None,
        speaker: None,
        helper_failed: (false, false),
        resident_bytes: process_resident_bytes(),
        device,
    }))
}

pub(crate) fn check_aligner_files(bundle: &VerifiedBundle) -> Result<(), ErrorBody> {
    if let Some(aligner_files) = &bundle.aligner {
        aligner_files.require_extension_in("", "safetensors")?;
        aligner_files.require("vocab.json")?;
    }
    Ok(())
}

/// 模型包的设备：`cpu` 总能跑；`cuda` 要求本进程真的拿到了 CUDA 设备（`cuda` feature、`BAOCUT_GPU` 没关、初始化成功）。
fn check_device(bundle: &VerifiedBundle) -> Result<Device, ErrorBody> {
    match bundle.device.as_str() {
        DEVICE_CPU => Ok(Device::Cpu),
        DEVICE_CUDA if default_device().is_cuda() => Ok(default_device()),
        DEVICE_CUDA => Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "no CUDA device is available")
            .with_details(json!({ "backend": "candle", "device": bundle.device, "reason": "unsupported-device" }))),
        _ => Err(
            ErrorBody::new(codes::MODEL_UNSUPPORTED, "the candle backend runs on the cpu or cuda device")
                .with_details(json!({ "backend": "candle", "device": bundle.device, "reason": "unsupported-device" })),
        ),
    }
}

fn read_json(files: &VerifiedFiles, relative: &str) -> Result<Value, ErrorBody> {
    let path = files.require(relative)?;
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .ok_or_else(|| {
            ErrorBody::new(
                codes::MODEL_UNSUPPORTED,
                format!("unreadable {relative} in the {} component", files.component),
            )
            .with_details(json!({ "component": files.component, "file": relative, "reason": "unreadable" }))
        })
}

/// 权重形状不对、文件损坏之类的加载失败。细节（可能含路径）只写 stderr；按清单取文件的错误原样透传。
pub(crate) fn load_failed(component: &str, error: &anyhow::Error) -> ErrorBody {
    eprintln!("[model-worker] loading {component} failed: {error:#}");
    if let Some(body) = error.downcast_ref::<ErrorBody>() {
        return body.clone();
    }
    ErrorBody::new(codes::MODEL_UNSUPPORTED, format!("the {component} model could not be loaded"))
        .with_details(json!({ "component": component, "reason": "load-failed" }))
}

/// candle 没有 MLX 那样的分配器统计：`active` 报整个 Worker 进程此刻的常驻内存，`peak` 报进程的常驻峰值，`cache` 是 0。
/// CUDA 显存不在其中。拿不到进程内存的平台（Windows）报 `None`。
pub(crate) fn memory() -> Option<MemorySnapshot> {
    let active = process_resident_bytes()?;
    Some(MemorySnapshot {
        active,
        cache: 0,
        peak: process_peak_resident_bytes().unwrap_or(active).max(active),
    })
}

/// 进程此刻的常驻内存（字节）。
#[cfg(target_os = "macos")]
pub(crate) fn process_resident_bytes() -> Option<u64> {
    let mut info: libc::proc_taskinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_taskinfo>() as libc::c_int;
    // SAFETY: `info` 是足够大、按 C 布局的缓冲区；proc_pidinfo 只写入其中 `size` 字节。
    let written = unsafe {
        libc::proc_pidinfo(
            libc::getpid(),
            libc::PROC_PIDTASKINFO,
            0,
            (&mut info as *mut libc::proc_taskinfo).cast(),
            size,
        )
    };
    (written == size).then_some(info.pti_resident_size)
}

/// 进程此刻的常驻内存（字节）：`/proc/self/statm` 的第二列是常驻页数。
#[cfg(target_os = "linux")]
pub(crate) fn process_resident_bytes() -> Option<u64> {
    let statm = std::fs::read_to_string("/proc/self/statm").ok()?;
    let pages = statm.split_whitespace().nth(1)?.parse::<u64>().ok()?;
    // SAFETY: sysconf 只读系统常量。
    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    (page_size > 0).then(|| pages * page_size as u64)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn process_resident_bytes() -> Option<u64> {
    None
}

/// 进程的常驻峰值（字节）。`ru_maxrss` 在 macOS 上是字节，在 Linux 上是 KiB。
#[cfg(unix)]
fn process_peak_resident_bytes() -> Option<u64> {
    let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
    // SAFETY: `usage` 是按 C 布局的输出缓冲区。
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut usage) } != 0 {
        return None;
    }
    let raw = u64::try_from(usage.ru_maxrss).ok()?;
    Some(if cfg!(target_os = "macos") { raw } else { raw * 1024 })
}

#[cfg(not(unix))]
fn process_peak_resident_bytes() -> Option<u64> {
    None
}

/// 加载好的 VAD + ASR（+ 可选的对齐器、按需加载的说话人区分）。
pub struct CandleModel {
    vad: SileroVad,
    asr: Qwen3Asr,
    aligner: Option<ForcedAligner>,
    diarizer: DiarizerSlot,
    warmup_ms: u64,
    resident_bytes: Option<u64>,
}

impl LoadedModel for CandleModel {
    fn run_mode(&mut self) -> RunMode<'_> {
        RunMode::Pipeline {
            vad: &mut self.vad,
            recognizer: &mut self.asr,
        }
    }

    fn memory(&self) -> Option<MemorySnapshot> {
        memory()
    }

    fn warmup_ms(&self) -> u64 {
        self.warmup_ms
    }

    fn resident_bytes(&self) -> Option<u64> {
        self.resident_bytes
    }

    fn aligner(&mut self) -> Option<&mut dyn ForcedAlignment> {
        self.aligner.as_mut().map(|aligner| aligner as &mut dyn ForcedAlignment)
    }

    fn has_diarizer(&self) -> bool {
        self.diarizer.available()
    }

    fn diarizer(&mut self) -> Option<&mut dyn SpeakerDiarization> {
        self.diarizer.get()
    }

    fn finish_job(&mut self) {
        self.diarizer.release();
    }
}

/// 加载好的 MOSS 模型包，与 MLX 后端的 `MossModel` 同一套规则：MOSS 引擎常驻；对齐器与说话人模型按需加载，一次只留
/// 一个，任务结束放掉；装它们之前系统有内存压力时先卸掉 MOSS 引擎，下一条任务开始时重装。
pub struct CandleMossModel {
    engine: Option<MossTranscribeDiarize>,
    asr_files: VerifiedFiles,
    aligner_files: Option<VerifiedFiles>,
    speaker_files: Option<VerifiedFiles>,
    aligner: Option<ForcedAligner>,
    speaker: Option<WeSpeakerEmbedder>,
    /// 这个任务里对齐器、说话人模型加载失败过：同一任务不再重试。
    helper_failed: (bool, bool),
    resident_bytes: Option<u64>,
    device: Device,
}

impl CandleMossModel {
    fn yield_engine_under_pressure(&mut self) {
        if self.engine.is_none() {
            return;
        }
        let level = pressure::system_memory_pressure();
        if level != MemoryPressure::Normal {
            eprintln!("[model-worker] memory pressure {level:?}: unloading MOSS before loading the speaker model or aligner");
            self.engine = None;
        }
    }
}

impl SegmentingRecognizer for CandleMossModel {
    fn transcribe(
        &mut self,
        audio: &[f32],
        language: Option<&str>,
        callbacks: &mut SegmentingCallbacks<'_>,
    ) -> anyhow::Result<SegmentedTranscription> {
        if self.engine.is_none() {
            // 上一条任务在内存压力下卸掉了它。
            self.engine = Some(MossTranscribeDiarize::load(&self.asr_files, &self.device)?);
        }
        let Some(engine) = self.engine.as_mut() else {
            bail!("the MOSS engine is not loaded");
        };
        engine.transcribe(audio, language, callbacks)
    }
}

impl LoadedModel for CandleMossModel {
    fn run_mode(&mut self) -> RunMode<'_> {
        RunMode::SelfSegmenting(self)
    }

    fn memory(&self) -> Option<MemorySnapshot> {
        memory()
    }

    fn warmup_ms(&self) -> u64 {
        0
    }

    fn resident_bytes(&self) -> Option<u64> {
        self.resident_bytes
    }

    fn has_aligner(&mut self) -> bool {
        self.aligner_files.is_some()
    }

    fn aligner(&mut self) -> Option<&mut dyn ForcedAlignment> {
        if self.aligner.is_none() && !self.helper_failed.0 {
            let files = self.aligner_files.clone()?;
            self.speaker = None;
            self.yield_engine_under_pressure();
            match ForcedAligner::load(&files, &self.device) {
                Ok(aligner) => self.aligner = Some(aligner),
                Err(error) => {
                    eprintln!("[model-worker] loading the aligner failed: {error:#}");
                    self.helper_failed.0 = true;
                }
            }
        }
        self.aligner.as_mut().map(|aligner| aligner as &mut dyn ForcedAlignment)
    }

    fn speaker_embedder(&mut self) -> Option<&mut dyn SpeakerEmbedding> {
        if self.speaker.is_none() && !self.helper_failed.1 {
            let files = self.speaker_files.clone()?;
            self.aligner = None;
            self.yield_engine_under_pressure();
            match WeSpeakerEmbedder::load(&files, &self.device) {
                Ok(speaker) => self.speaker = Some(speaker),
                Err(error) => {
                    eprintln!("[model-worker] loading the speaker model failed: {error:#}");
                    self.helper_failed.1 = true;
                }
            }
        }
        self.speaker.as_mut().map(|speaker| speaker as &mut dyn SpeakerEmbedding)
    }

    fn finish_job(&mut self) {
        self.aligner = None;
        self.speaker = None;
        self.helper_failed = (false, false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_device_computes() {
        let label = compute_probe().unwrap();
        assert_eq!(label, device_label(&default_device()));
        if !cfg!(feature = "cuda") {
            assert_eq!(label, DEVICE_CPU);
        }
    }

    #[test]
    fn status_lists_the_cpu_last() {
        let status = CandleBackend.status();
        assert!(status.available);
        assert_eq!(status.devices.last().map(String::as_str), Some(DEVICE_CPU));
    }

    #[test]
    fn out_of_memory_errors_get_a_hint() {
        let annotated = annotate_out_of_memory(anyhow::anyhow!("CUDA_ERROR_OUT_OF_MEMORY"));
        assert!(format!("{annotated:#}").contains("BAOCUT_GPU=off"));
        let plain = annotate_out_of_memory(anyhow::anyhow!("shape mismatch"));
        assert_eq!(format!("{plain:#}"), "shape mismatch");
    }

    #[test]
    fn reports_process_memory_where_the_platform_allows() {
        if cfg!(any(target_os = "macos", target_os = "linux")) {
            let snapshot = memory().unwrap();
            assert!(snapshot.active > 0);
            assert!(snapshot.peak >= snapshot.active);
        }
    }
}
