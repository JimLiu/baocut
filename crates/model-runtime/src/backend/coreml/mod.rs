//! CoreML 后端（Apple Silicon）：Whisper large-v3 / large-v3-turbo 的 `.mlmodelc` 包。
//!
//! 识别模型在 CoreML 上跑（mel 与解码器的设备选择见 [`whisper`]），切段的 Silero VAD 与可选的强制对齐器仍是
//! MLX 的（[`super::mlx::silero`]、[`super::mlx::aligner`]），所以这个后端连带要求 `backend-mlx` 与一个 Metal
//! 设备。CoreML 的模型句柄与 MLX 的数组一样只留在加载它的线程上。

pub mod whisper;

use std::time::Instant;

use serde_json::json;

use super::mlx::{aligner::ForcedAligner, pyannote::DiarizerSlot, runtime, silero::SileroVad};
use super::{Backend, LoadedModel, ModelPhase, PhaseCallback, REASON_NO_METAL_DEVICE, RunMode};
use crate::bundle::{FAMILY_WHISPER_COREML, VerifiedBundle, VerifiedFiles};
use crate::protocol::{BackendStatus, ErrorBody, MemorySnapshot, codes, transcription_not_wired};
use crate::speech::{ForcedAlignment, SpeakerDiarization};
use whisper::{WhisperCoreMl, WhisperFiles};

/// CoreML 认的设备名：模型包登记写 `ane`（编码器与解码器优先上神经网络引擎，mel 在 CPU/GPU）。
pub const DEVICE: &str = "ane";

pub struct CoreMlBackend;

impl Backend for CoreMlBackend {
    fn id(&self) -> &'static str {
        "coreml"
    }

    /// 识别模型包都带 MLX 的 VAD：没有 Metal 设备时报告不可用，与 `mlx` 后端同一个原因。
    fn status(&self) -> BackendStatus {
        match runtime::ensure_metal_device() {
            Ok(()) => BackendStatus {
                id: "coreml",
                available: true,
                reason: None,
                devices: vec![DEVICE.into()],
            },
            Err(_) => BackendStatus {
                id: "coreml",
                available: false,
                reason: Some(REASON_NO_METAL_DEVICE.into()),
                devices: Vec::new(),
            },
        }
    }

    fn load(&self, bundle: &VerifiedBundle, phase: &mut PhaseCallback<'_>) -> Result<Box<dyn LoadedModel>, ErrorBody> {
        check_device(bundle)?;
        let (Some(asr_files), Some(vad_files), Some(tokenizer_files)) = (&bundle.asr, &bundle.vad, &bundle.tokenizer) else {
            // backend::load 已经检查过；这里只为类型。
            return Err(ErrorBody::new(
                codes::MODEL_UNSUPPORTED,
                "the bundle needs asr, vad and tokenizer components",
            ));
        };
        if asr_files.family != FAMILY_WHISPER_COREML {
            return Err(transcription_not_wired(Some(&asr_files.family)));
        }

        // 先按清单取齐文件：缺文件是 MODEL_NOT_INSTALLED，不必先加载几百 MB 的模型。
        let files = whisper_files(asr_files, tokenizer_files)?;
        let vad_weights = vad_files.require_extension("safetensors")?;
        // 对齐器是可选组件（与 MLX 的模型包共用同一只）：带了才加载，缺文件同样报 MODEL_NOT_INSTALLED。
        if let Some(aligner_files) = &bundle.aligner {
            aligner_files.require_extension_in("", "safetensors")?;
            aligner_files.require("vocab.json")?;
        }
        // 说话人区分同样可选（MLX 的 Pyannote 与 WeSpeaker）：只核对文件，任务里要用时才加载。
        let diarizer = DiarizerSlot::new(bundle)?;

        runtime::configure_memory_cache().map_err(|error| load_failed("vad", &error))?;
        phase(ModelPhase::LoadingWeights, Some("vad"));
        let vad = SileroVad::load(&vad_weights).map_err(|error| load_failed("vad", &error))?;
        phase(ModelPhase::LoadingWeights, Some("asr"));
        let asr = WhisperCoreMl::load(&files).map_err(|error| load_failed("asr", &error))?;
        let aligner = match &bundle.aligner {
            Some(aligner_files) => {
                phase(ModelPhase::LoadingWeights, Some("aligner"));
                Some(ForcedAligner::load(aligner_files).map_err(|error| load_failed("aligner", &error))?)
            }
            None => None,
        };

        phase(ModelPhase::WarmingUp, None);
        let started = Instant::now();
        asr.warmup().map_err(|error| load_failed("asr", &error))?;
        let warmup_ms = started.elapsed().as_millis() as u64;
        Ok(Box::new(CoreMlModel {
            vad,
            asr,
            aligner,
            diarizer,
            warmup_ms,
            resident_bytes: resident_bytes(),
        }))
    }
}

/// 从清单里取 Whisper 要的文件。`.mlmodelc` 是目录，整个交给 CoreML（[`VerifiedFiles::require_directory`]）；
/// context prefill 模型可有可无（v2：有就用）。
pub fn whisper_files(asr: &VerifiedFiles, tokenizer: &VerifiedFiles) -> Result<WhisperFiles, ErrorBody> {
    Ok(WhisperFiles {
        mel: asr.require_directory("MelSpectrogram.mlmodelc")?,
        encoder: asr.require_directory("AudioEncoder.mlmodelc")?,
        decoder: asr.require_directory("TextDecoder.mlmodelc")?,
        decoder_prefill: asr.directory("TextDecoderContextPrefill.mlmodelc"),
        generation_config: asr.require("generation_config.json")?.to_path_buf(),
        tokenizer: tokenizer.require("tokenizer.json")?.to_path_buf(),
    })
}

/// 设备必须是 `ane`，且本机有 Metal 设备（VAD 在 MLX 上跑）。
fn check_device(bundle: &VerifiedBundle) -> Result<(), ErrorBody> {
    if bundle.device != DEVICE {
        return Err(
            ErrorBody::new(codes::MODEL_UNSUPPORTED, "the coreml backend only runs on the ane device")
                .with_details(json!({ "backend": "coreml", "device": bundle.device, "reason": "unsupported-device" })),
        );
    }
    if runtime::ensure_metal_device().is_err() {
        return Err(ErrorBody::new(codes::MODEL_UNSUPPORTED, "no Metal device is available")
            .with_details(json!({ "backend": "coreml", "reason": REASON_NO_METAL_DEVICE })));
    }
    Ok(())
}

/// 模型文件不对、CoreML 拒绝加载之类的失败。细节（可能含路径）只写 stderr；按清单取文件的错误原样透传。
fn load_failed(component: &str, error: &anyhow::Error) -> ErrorBody {
    eprintln!("[model-worker] loading {component} failed: {error:#}");
    if let Some(body) = error.downcast_ref::<ErrorBody>() {
        return body.clone();
    }
    ErrorBody::new(codes::MODEL_UNSUPPORTED, format!("the {component} model could not be loaded"))
        .with_details(json!({ "component": component, "reason": "load-failed" }))
}

/// 进程此刻的常驻内存（字节）。CoreML 不报告模型占用，`residentBytes` 报整个 Worker 进程的 RSS。
fn resident_bytes() -> Option<u64> {
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

/// 加载好的 VAD（MLX）+ Whisper（CoreML）+ 可选的强制对齐器（MLX）+ 按需加载的说话人区分（MLX）。
pub struct CoreMlModel {
    vad: SileroVad,
    asr: WhisperCoreMl,
    aligner: Option<ForcedAligner>,
    diarizer: DiarizerSlot,
    warmup_ms: u64,
    resident_bytes: Option<u64>,
}

impl LoadedModel for CoreMlModel {
    fn run_mode(&mut self) -> RunMode<'_> {
        RunMode::Pipeline {
            vad: &mut self.vad,
            recognizer: &mut self.asr,
        }
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
        if self.diarizer.release() {
            let _ = runtime::clear_memory_cache();
        }
    }

    /// CoreML 没有 MLX 那样的活动 / 缓存 / 峰值统计；MLX 的快照只看得到 VAD 与对齐器，报出来反而误导。
    fn memory(&self) -> Option<MemorySnapshot> {
        None
    }

    fn warmup_ms(&self) -> u64 {
        self.warmup_ms
    }

    fn resident_bytes(&self) -> Option<u64> {
        self.resident_bytes
    }
}
