//! `job.run`（capability `synthesize`）的编排（Model Worker 协议规范 §2.5.2）：冻结参数 → [`TtsRequest`] →
//! 引擎合成 → `speech.wav`（`baocut.speech-wav/v1`）。
//!
//! 阶段：`preparing-reference`（只在 `clone` 时；先把参考录音解一遍，读不出就是 `INPUT_UNREADABLE`）→
//! `synthesizing`（`job.progress` 的 `steps` 是文本块：开始时报 `0/n`，每完成一块报 `i+1/n`）→ `encoding`。
//! 取消：引擎的每个进度回调（含逐 token）都看一次取消标志，回 `false` 让引擎在下一个安全点返回；之后结果是
//! `outcome: 'cancelled'`，不写输出。
//!
//! 模型做不到的声音方式与旋钮在开跑前报 `MODEL_UNSUPPORTED`（`details.reason`），不换成别的声音、不忽略参数；
//! Runtime 在提交时已经按模型的描述拒绝过，这里是同一条规则在 Worker 一侧的兜底。引擎内部的其余失败是
//! `INFERENCE_FAILED`（细节只写 stderr，消息里不带路径）；`speech.wav` 写不进 staging 是 `OUTPUT_WRITE_FAILED`。

use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use serde_json::{Value, json};

use super::types::{SamplingOptions, TtsEngineKind, TtsProgress, TtsRequest, VoiceSpec};
use super::{TtsEngine, gpt_sovits, omnivoice, voices, wav};
use crate::asr_result::sha256_hex;
use crate::audio::{self, DecodeError};
use crate::protocol::{
    ErrorBody, JobOutcome, OutputFile, SPEECH_OUTPUT_FILE, SynthesizeRunParams, SynthesizeRunResult, SynthesizeStats, SynthesizeVoice,
    SynthesizedAudio, codes,
};
use crate::transcribe::JobSink;

/// 参考录音只为确认读得出来（与量时长）而解码；采样率与引擎无关。
const REFERENCE_PROBE_RATE: u32 = 16_000;

/// 跑一个合成任务。返回的错误就是该请求的错误响应。
pub fn run(
    engine: &mut dyn TtsEngine,
    params: &SynthesizeRunParams,
    cancel: &AtomicBool,
    sink: &mut dyn JobSink,
) -> Result<SynthesizeRunResult, ErrorBody> {
    params.validate()?;
    let staging = Path::new(&params.staging);
    if !staging.is_dir() {
        return Err(ErrorBody::invalid_params("staging must be an existing absolute directory"));
    }
    let request = request_for(engine, params)?;
    let job_id = params.job_id.as_str();
    let mut stats = SynthesizeStats::default();
    let cancelled = |stats: SynthesizeStats| SynthesizeRunResult {
        outcome: JobOutcome::Cancelled,
        output: None,
        audio: None,
        stats,
        readings_dropped: Vec::new(),
    };

    if let Some(input) = &params.input {
        phase(sink, job_id, "preparing-reference");
        let started = Instant::now();
        let seconds = probe_reference(Path::new(&input.file))?;
        check_reference_length(engine.kind(), &request, seconds)?;
        stats.reference_ms = started.elapsed().as_millis() as u64;
    }
    if cancel.load(Ordering::SeqCst) {
        return Ok(cancelled(stats));
    }

    phase(sink, job_id, "synthesizing");
    let started = Instant::now();
    let mut stopped = false;
    let mut chunks = 0usize;
    let synthesized = {
        let mut on_progress = |progress: TtsProgress| -> bool {
            if cancel.load(Ordering::SeqCst) {
                stopped = true;
                return false;
            }
            match progress {
                // 第一块开始时报 `0/n`；之后每块完成报一次（下一块的开始与上一块的完成是同一个数）。
                TtsProgress::ChunkStarted { index, count } => {
                    chunks = count;
                    if index == 0 {
                        steps(sink, job_id, 0, count);
                    }
                }
                TtsProgress::ChunkFinished { index, .. } if chunks > 0 => steps(sink, job_id, index + 1, chunks),
                _ => {}
            }
            true
        };
        engine.synthesize(&request, &mut on_progress)
    };
    stats.synthesis_ms = started.elapsed().as_millis() as u64;
    let audio = match synthesized {
        _ if stopped || cancel.load(Ordering::SeqCst) => return Ok(cancelled(stats)),
        Ok(audio) => audio,
        Err(error) => return Err(inference_failed(engine.kind(), &error)),
    };
    if audio.is_empty() || audio.sample_rate == 0 {
        return Err(ErrorBody::new(codes::INFERENCE_FAILED, "the model produced no audio")
            .with_details(json!({ "engine": engine.kind().as_str(), "reason": "empty-audio" })));
    }

    phase(sink, job_id, "encoding");
    let started = Instant::now();
    let bytes = wav::encode_wav_pcm16(&audio.samples, audio.sample_rate);
    let output = write_output(staging, &bytes).map_err(|error| {
        eprintln!("[model-worker] writing {SPEECH_OUTPUT_FILE} failed: {error}");
        ErrorBody::new(codes::OUTPUT_WRITE_FAILED, format!("could not write {SPEECH_OUTPUT_FILE}"))
            .with_details(json!({ "file": SPEECH_OUTPUT_FILE }))
    })?;
    stats.encode_ms = started.elapsed().as_millis() as u64;
    Ok(SynthesizeRunResult {
        outcome: JobOutcome::Completed,
        output: Some(output),
        audio: Some(SynthesizedAudio {
            sample_rate: audio.sample_rate,
            channels: 1,
            duration_sec: audio.duration_seconds(),
        }),
        stats,
        readings_dropped: audio.readings_dropped,
    })
}

/// 冻结参数 → 引擎请求。模型做不到的声音方式与旋钮在这里报 `MODEL_UNSUPPORTED`。
pub fn request_for(engine: &dyn TtsEngine, params: &SynthesizeRunParams) -> Result<TtsRequest, ErrorBody> {
    let kind = engine.kind();
    let options = &params.options;
    let unsupported = |reason: &str, extra: Value| {
        let mut details = json!({ "engine": kind.as_str(), "reason": reason });
        if let (Some(details), Some(extra)) = (details.as_object_mut(), extra.as_object()) {
            details.extend(extra.clone());
        }
        ErrorBody::new(
            codes::MODEL_UNSUPPORTED,
            format!("the {} engine cannot do this ({reason})", kind.as_str()),
        )
        .with_details(details)
    };
    let instructions = options.instructions.as_deref().map(str::trim).filter(|text| !text.is_empty());
    if instructions.is_some() && !accepts_instructions(kind) {
        return Err(unsupported("unsupported-option", json!({ "option": "instructions" })));
    }
    for (option, given, accepted) in [
        ("speed", options.speed.is_some(), accepts_speed(kind)),
        ("cfg", options.cfg.is_some(), accepts_diffusion_knobs(kind)),
        ("steps", options.steps.is_some(), accepts_diffusion_knobs(kind)),
    ] {
        if given && !accepted {
            return Err(unsupported("unsupported-option", json!({ "option": option })));
        }
    }
    if let Some(speed) = options.speed
        && !(speed.is_finite() && speed > 0.0)
    {
        return Err(ErrorBody::invalid_params("options.speed must be a positive number"));
    }
    if let Some(cfg) = options.cfg
        && !(cfg.is_finite() && cfg >= 0.0)
    {
        return Err(ErrorBody::invalid_params("options.cfg must be a non-negative number"));
    }
    // VoxCPM2 的引导强度必须大于 0（引擎在合成时才查，到那时就成了推理失败）；OmniVoice 的 0 是「不做引导」。
    if kind == TtsEngineKind::VoxCpm2 && options.cfg == Some(0.0) {
        return Err(ErrorBody::invalid_params("options.cfg must be positive for VoxCPM2"));
    }
    if options.steps == Some(0) {
        return Err(ErrorBody::invalid_params("options.steps must be positive"));
    }

    let (voice, instruct) = match (&options.voice, &params.input) {
        (SynthesizeVoice::Preset { id }, _) => {
            // 与 v2 同一条规矩：说话人名不分大小写（`Uncle_Fu`），内置音色 id 一律放行（CustomVoice 就近换成最像的那位）。
            if voices::unknown_preset(id, &engine.preset_speakers()) {
                return Err(unsupported("unknown-voice", json!({ "voice": id })));
            }
            (VoiceSpec::Preset { speaker: id.clone() }, instructions.map(str::to_owned))
        }
        (SynthesizeVoice::Clone { transcript }, Some(input)) => (
            VoiceSpec::Clone {
                reference_audio: PathBuf::from(&input.file),
                reference_text: transcript
                    .as_deref()
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .map(str::to_owned),
            },
            instructions.map(str::to_owned),
        ),
        (SynthesizeVoice::Clone { .. }, None) => {
            return Err(ErrorBody::invalid_params("voice mode clone needs input (the reference audio)"));
        }
        (SynthesizeVoice::Describe { description }, _) => {
            if !accepts_description(kind) {
                return Err(unsupported("unsupported-voice-mode", json!({ "voiceMode": "describe" })));
            }
            // 描述与语气说明在引擎里是同一个 `instruct`：两个都给时做不到，不替调用方合并。
            if instructions.is_some() {
                return Err(unsupported(
                    "unsupported-option",
                    json!({ "option": "instructions", "voiceMode": "describe" }),
                ));
            }
            let description = description.trim();
            if description.is_empty() {
                return Err(ErrorBody::invalid_params("options.voice.description must not be empty"));
            }
            // OmniVoice 只认封闭词表：词表外的描述在这里报参数错，不拖到合成时成为推理失败。
            if kind == TtsEngineKind::OmniVoice
                && let Err(error) = omnivoice::instruct::resolve_instruct(Some(description), has_han(&options.text))
            {
                eprintln!("[model-worker] OmniVoice description rejected: {error:#}");
                return Err(
                    ErrorBody::invalid_params("options.voice.description is outside the OmniVoice vocabulary")
                        .with_details(json!({ "engine": kind.as_str(), "reason": "description-vocabulary" })),
                );
            }
            (VoiceSpec::Default, Some(description.to_owned()))
        }
    };
    Ok(TtsRequest {
        text: options.text.clone(),
        language: options
            .language
            .as_deref()
            .map(str::trim)
            .filter(|tag| !tag.is_empty())
            .map(str::to_owned),
        voice,
        instruct,
        emotion: None,
        target_duration_seconds: None,
        sampling: SamplingOptions {
            seed: options.seed,
            cfg: options.cfg.map(|cfg| cfg as f32),
            steps: options.steps.map(|steps| steps as usize),
            ..SamplingOptions::default()
        },
        speed: options.speed.map(|speed| speed as f32),
    })
}

/// 语气说明（风格指令）：Qwen3-TTS（CustomVoice）与 VoxCPM2。
fn accepts_instructions(kind: TtsEngineKind) -> bool {
    matches!(kind, TtsEngineKind::Qwen3Tts | TtsEngineKind::VoxCpm2)
}

/// 按描述造声：Qwen3-TTS（VoiceDesign）与 OmniVoice。
fn accepts_description(kind: TtsEngineKind) -> bool {
    matches!(kind, TtsEngineKind::Qwen3Tts | TtsEngineKind::OmniVoice)
}

/// 语速倍率：OmniVoice 与 IndexTTS 2.5。
fn accepts_speed(kind: TtsEngineKind) -> bool {
    matches!(kind, TtsEngineKind::OmniVoice | TtsEngineKind::IndexTts25)
}

/// 无分类器引导强度与扩散步数：VoxCPM2 与 OmniVoice。
fn accepts_diffusion_knobs(kind: TtsEngineKind) -> bool {
    matches!(kind, TtsEngineKind::VoxCpm2 | TtsEngineKind::OmniVoice)
}

/// 合成文本含汉字（OmniVoice 据此挑中文或英文的描述词）。
fn has_han(text: &str) -> bool {
    text.chars().any(|ch| ('\u{4e00}'..='\u{9fff}').contains(&ch))
}

/// GPT-SoVITS 给了原文时只接受 3–10 秒的参考录音（官方限制）；超出时在合成之前报 `MODEL_UNSUPPORTED`。
fn check_reference_length(kind: TtsEngineKind, request: &TtsRequest, seconds: f64) -> Result<(), ErrorBody> {
    let VoiceSpec::Clone {
        reference_text: Some(_), ..
    } = &request.voice
    else {
        return Ok(());
    };
    if kind != TtsEngineKind::GptSovits {
        return Ok(());
    }
    let [min, max] = gpt_sovits::REFERENCE_SECONDS_WITH_TEXT.map(f64::from);
    if (min..=max).contains(&seconds) {
        return Ok(());
    }
    Err(ErrorBody::new(
        codes::MODEL_UNSUPPORTED,
        format!("GPT-SoVITS needs a {min}–{max} s reference when the transcript is given"),
    )
    .with_details(json!({
        "engine": kind.as_str(),
        "reason": "reference-duration",
        "seconds": (seconds * 10.0).round() / 10.0,
        "range": [min, max],
    })))
}

/// 参考录音读不出来（不存在、解不开、没有声音）是 `INPUT_UNREADABLE`。返回它的时长（秒）。
fn probe_reference(file: &Path) -> Result<f64, ErrorBody> {
    let unreadable = |detail: String| {
        eprintln!("[model-worker] the reference audio is unreadable: {detail}");
        ErrorBody::new(codes::INPUT_UNREADABLE, "the reference audio is unreadable").with_details(json!({ "input": "reference" }))
    };
    match audio::decode_mono(file, REFERENCE_PROBE_RATE) {
        Ok(samples) if samples.is_empty() => Err(unreadable("no samples".into())),
        Ok(samples) => Ok(samples.len() as f64 / f64::from(REFERENCE_PROBE_RATE)),
        Err(DecodeError::Cancelled) => Err(unreadable("cancelled".into())),
        Err(error) => Err(unreadable(error.to_string())),
    }
}

fn inference_failed(kind: TtsEngineKind, error: &anyhow::Error) -> ErrorBody {
    if let Some(body) = error.downcast_ref::<ErrorBody>() {
        return body.clone();
    }
    eprintln!("[model-worker] {} synthesis failed: {error:#}", kind.as_str());
    ErrorBody::new(codes::INFERENCE_FAILED, format!("{} synthesis failed", kind.as_str()))
        .with_details(json!({ "engine": kind.as_str(), "reason": "synthesis-failed" }))
}

/// `speech.wav`：先写临时文件再重命名。路径是绝对路径（staging 是绝对路径）。
fn write_output(staging: &Path, bytes: &[u8]) -> std::io::Result<OutputFile> {
    let path = staging.join(SPEECH_OUTPUT_FILE);
    let temporary = staging.join(format!("{SPEECH_OUTPUT_FILE}.tmp"));
    {
        let mut file = File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    std::fs::rename(&temporary, &path)?;
    Ok(OutputFile {
        path: path.to_string_lossy().into_owned(),
        sha256: sha256_hex(bytes),
        byte_length: bytes.len() as u64,
    })
}

fn phase(sink: &mut dyn JobSink, job_id: &str, phase: &str) {
    sink.event("job.phase", json!({ "jobId": job_id, "phase": phase }));
}

fn steps(sink: &mut dyn JobSink, job_id: &str, done: usize, total: usize) {
    sink.event(
        "job.progress",
        json!({ "jobId": job_id, "phase": "synthesizing", "done": done, "total": total, "unit": "steps" }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{Capability, SPEECH_OUTPUT_CONTRACT, SpeechReference, SynthesizeOptions};
    use crate::synthesize::{ProgressSink, TtsAudio};
    use anyhow::bail;

    /// 假引擎：每块生成 `tokens` 个 token，每块 0.1 秒 440 Hz；`cancel_at` 时在那一块里把取消标志置上。
    struct FakeEngine {
        kind: TtsEngineKind,
        speakers: Vec<String>,
        chunks: usize,
        fail: bool,
        cancel_at: Option<(usize, &'static AtomicBool)>,
        seen: Option<TtsRequest>,
    }

    impl FakeEngine {
        fn new(kind: TtsEngineKind) -> Self {
            Self {
                kind,
                speakers: vec!["Vivian".into(), "zh-female".into()],
                chunks: 2,
                fail: false,
                cancel_at: None,
                seen: None,
            }
        }
    }

    impl TtsEngine for FakeEngine {
        fn kind(&self) -> TtsEngineKind {
            self.kind
        }
        fn sample_rate(&self) -> u32 {
            24_000
        }
        fn preset_speakers(&self) -> Vec<String> {
            self.speakers.clone()
        }
        fn synthesize(&mut self, request: &TtsRequest, progress: ProgressSink<'_>) -> Result<TtsAudio, anyhow::Error> {
            self.seen = Some(request.clone());
            if self.fail {
                bail!("权重坏了：/secret/path/model.safetensors");
            }
            let mut samples = Vec::new();
            for index in 0..self.chunks {
                if !progress(TtsProgress::ChunkStarted { index, count: self.chunks }) {
                    bail!("合成已取消");
                }
                for generated in 1..=3 {
                    if let Some((at, flag)) = self.cancel_at
                        && at == index
                    {
                        flag.store(true, Ordering::SeqCst);
                    }
                    if !progress(TtsProgress::Tokens { index, generated }) {
                        bail!("合成已取消");
                    }
                }
                samples.extend((0..2_400).map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / 24_000.0).sin() * 0.5));
                if !progress(TtsProgress::ChunkFinished {
                    index,
                    seconds: samples.len() as f64 / 24_000.0,
                }) {
                    bail!("合成已取消");
                }
            }
            Ok(TtsAudio {
                samples,
                sample_rate: 24_000,
                readings_dropped: Vec::new(),
            })
        }
    }

    #[derive(Default)]
    struct Events(Vec<(String, Value)>);

    impl JobSink for Events {
        fn event(&mut self, name: &str, params: Value) {
            self.0.push((name.to_owned(), params));
        }
    }

    impl Events {
        fn phases(&self) -> Vec<&str> {
            self.0
                .iter()
                .filter(|(name, _)| name == "job.phase")
                .map(|(_, params)| params["phase"].as_str().unwrap())
                .collect()
        }
        fn progress(&self) -> Vec<(u64, u64)> {
            self.0
                .iter()
                .filter(|(name, _)| name == "job.progress")
                .map(|(_, params)| {
                    assert_eq!(params["unit"], "steps");
                    assert_eq!(params["phase"], "synthesizing");
                    (params["done"].as_u64().unwrap(), params["total"].as_u64().unwrap())
                })
                .collect()
        }
    }

    fn params(staging: &Path, voice: SynthesizeVoice, input: Option<SpeechReference>) -> SynthesizeRunParams {
        SynthesizeRunParams {
            job_id: "job_1".into(),
            run_generation: 1,
            capability: Capability::Synthesize,
            input,
            options: SynthesizeOptions {
                text: "你好，世界。".into(),
                language: Some("zh-CN".into()),
                voice,
                instructions: None,
                speed: None,
                cfg: None,
                steps: None,
                seed: Some(7),
            },
            staging: staging.to_string_lossy().into_owned(),
            output_contract: SPEECH_OUTPUT_CONTRACT.into(),
        }
    }

    fn preset(id: &str) -> SynthesizeVoice {
        SynthesizeVoice::Preset { id: id.into() }
    }

    #[test]
    fn writes_speech_wav_with_phases_and_step_progress() {
        let staging = tempfile::tempdir().unwrap();
        let mut engine = FakeEngine::new(TtsEngineKind::Qwen3Tts);
        let mut events = Events::default();
        let cancel = AtomicBool::new(false);
        let result = run(&mut engine, &params(staging.path(), preset("Vivian"), None), &cancel, &mut events).unwrap();

        assert_eq!(result.outcome, JobOutcome::Completed);
        assert_eq!(
            events.phases(),
            ["synthesizing", "encoding"],
            "no reference, no preparing-reference"
        );
        assert_eq!(events.progress(), [(0, 2), (1, 2), (2, 2)]);
        let output = result.output.unwrap();
        let path = staging.path().join(SPEECH_OUTPUT_FILE);
        assert_eq!(output.path, path.to_string_lossy());
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(output.byte_length, bytes.len() as u64);
        assert_eq!(output.sha256, sha256_hex(&bytes));
        assert!(!staging.path().join("speech.wav.tmp").exists());
        let (samples, rate) = wav::decode_wav_pcm16(&bytes).unwrap();
        assert_eq!((samples.len(), rate), (4_800, 24_000));
        assert_eq!(
            result.audio,
            Some(SynthesizedAudio {
                sample_rate: 24_000,
                channels: 1,
                duration_sec: 0.2
            })
        );
        let seen = engine.seen.unwrap();
        assert_eq!(seen.voice, VoiceSpec::Preset { speaker: "Vivian".into() });
        assert_eq!(seen.language.as_deref(), Some("zh-CN"));
        assert_eq!(seen.sampling.seed, Some(7));
    }

    #[test]
    fn readings_the_engine_cannot_voice_come_back_in_the_result() {
        let staging = tempfile::tempdir().unwrap();
        let mut engine = crate::synthesize::readings::Annotating::new(Box::new(FakeEngine::new(TtsEngineKind::VoxCpm2)));
        let mut job = params(staging.path(), preset("zh-female"), None);
        job.options.text = "他<行|hang2>不行。".into();
        let result = run(&mut engine, &job, &AtomicBool::new(false), &mut Events::default()).unwrap();
        assert_eq!(result.outcome, JobOutcome::Completed);
        let dropped = serde_json::to_value(&result.readings_dropped).unwrap();
        assert_eq!(dropped, json!([{ "start": 1, "end": 2, "reading": "hang2", "origin": "user" }]));

        let plain = run(
            &mut engine,
            &params(staging.path(), preset("zh-female"), None),
            &AtomicBool::new(false),
            &mut Events::default(),
        )
        .unwrap();
        assert!(plain.readings_dropped.is_empty());
    }

    #[test]
    fn clone_prepares_the_reference_first_and_unreadable_references_fail() {
        let staging = tempfile::tempdir().unwrap();
        let reference = staging.path().join("ref.wav");
        let tone: Vec<f32> = (0..16_000).map(|i| (i as f32 * 0.05).sin() * 0.3).collect();
        wav::write_wav_pcm16(&reference, &tone, 16_000).unwrap();
        let input = |file: &Path| SpeechReference {
            file: file.to_string_lossy().into_owned(),
            content_hash: "sha256:ab".into(),
            track: 0,
        };
        let voice = SynthesizeVoice::Clone {
            transcript: Some(" 参考原文 ".into()),
        };
        let mut engine = FakeEngine::new(TtsEngineKind::Qwen3Tts);
        let mut events = Events::default();
        let cancel = AtomicBool::new(false);
        let result = run(
            &mut engine,
            &params(staging.path(), voice.clone(), Some(input(&reference))),
            &cancel,
            &mut events,
        )
        .unwrap();
        assert_eq!(result.outcome, JobOutcome::Completed);
        assert_eq!(events.phases(), ["preparing-reference", "synthesizing", "encoding"]);
        assert_eq!(
            engine.seen.unwrap().voice,
            VoiceSpec::Clone {
                reference_audio: reference.clone(),
                reference_text: Some("参考原文".into())
            }
        );

        let missing = staging.path().join("missing.wav");
        let mut engine = FakeEngine::new(TtsEngineKind::Qwen3Tts);
        let error = run(
            &mut engine,
            &params(staging.path(), voice, Some(input(&missing))),
            &cancel,
            &mut Events::default(),
        )
        .unwrap_err();
        assert_eq!(error.code, codes::INPUT_UNREADABLE);
        assert!(!error.message.contains(&*staging.path().to_string_lossy()));
        assert!(engine.seen.is_none(), "the engine never runs on an unreadable reference");
    }

    #[test]
    fn cancel_stops_at_the_next_progress_callback() {
        static CANCEL: AtomicBool = AtomicBool::new(false);
        let staging = tempfile::tempdir().unwrap();
        let mut engine = FakeEngine::new(TtsEngineKind::Qwen3Tts);
        engine.cancel_at = Some((0, &CANCEL));
        let mut events = Events::default();
        let result = run(&mut engine, &params(staging.path(), preset("Vivian"), None), &CANCEL, &mut events).unwrap();
        assert_eq!(result.outcome, JobOutcome::Cancelled);
        assert_eq!(result.output, None);
        assert_eq!(result.audio, None);
        assert_eq!(events.phases(), ["synthesizing"], "no encoding after a cancel");
        assert!(!staging.path().join(SPEECH_OUTPUT_FILE).exists());

        // 开跑前就取消：不碰引擎。
        let mut engine = FakeEngine::new(TtsEngineKind::Qwen3Tts);
        let result = run(
            &mut engine,
            &params(staging.path(), preset("Vivian"), None),
            &CANCEL,
            &mut Events::default(),
        )
        .unwrap();
        assert_eq!(result.outcome, JobOutcome::Cancelled);
        assert!(engine.seen.is_none());
    }

    #[test]
    fn engine_failures_are_inference_failed_without_paths() {
        let staging = tempfile::tempdir().unwrap();
        let mut engine = FakeEngine::new(TtsEngineKind::VoxCpm2);
        engine.fail = true;
        let error = run(
            &mut engine,
            &params(staging.path(), preset("zh-female"), None),
            &AtomicBool::new(false),
            &mut Events::default(),
        )
        .unwrap_err();
        assert_eq!(error.code, codes::INFERENCE_FAILED);
        assert!(error.retryable);
        assert!(!error.message.contains("/secret"), "{}", error.message);
    }

    #[test]
    fn maps_describe_instructions_and_knobs() {
        let staging = tempfile::tempdir().unwrap();
        let engine = FakeEngine::new(TtsEngineKind::OmniVoice);
        let mut run_params = params(
            staging.path(),
            SynthesizeVoice::Describe {
                description: " female, low pitch ".into(),
            },
            None,
        );
        run_params.options.speed = Some(1.25);
        run_params.options.cfg = Some(2.5);
        run_params.options.steps = Some(16);
        let request = request_for(&engine, &run_params).unwrap();
        assert_eq!(request.voice, VoiceSpec::Default);
        assert_eq!(request.instruct.as_deref(), Some("female, low pitch"));
        assert_eq!(request.speed, Some(1.25));
        assert_eq!(request.sampling.cfg, Some(2.5));
        assert_eq!(request.sampling.steps, Some(16));

        let engine = FakeEngine::new(TtsEngineKind::VoxCpm2);
        let mut run_params = params(staging.path(), preset("zh-female"), None);
        run_params.options.instructions = Some("用兴奋的语气".into());
        let request = request_for(&engine, &run_params).unwrap();
        assert_eq!(request.instruct.as_deref(), Some("用兴奋的语气"));
    }

    #[test]
    fn what_the_model_cannot_do_is_unsupported() {
        let staging = tempfile::tempdir().unwrap();
        let reason = |kind: TtsEngineKind, edit: &dyn Fn(&mut SynthesizeRunParams)| {
            let engine = FakeEngine::new(kind);
            let mut run_params = params(staging.path(), preset("Vivian"), None);
            edit(&mut run_params);
            let error = request_for(&engine, &run_params).unwrap_err();
            assert_eq!(error.code, codes::MODEL_UNSUPPORTED, "{error:?}");
            error.details.unwrap()
        };
        let details = reason(TtsEngineKind::Qwen3Tts, &|p| p.options.voice = preset("Nobody"));
        assert_eq!(details["reason"], "unknown-voice");
        let details = reason(TtsEngineKind::Qwen3Tts, &|p| p.options.speed = Some(1.1));
        assert_eq!(
            (&details["reason"], &details["option"]),
            (&json!("unsupported-option"), &json!("speed"))
        );
        let details = reason(TtsEngineKind::Qwen3Tts, &|p| p.options.cfg = Some(2.0));
        assert_eq!(details["option"], "cfg");
        let details = reason(TtsEngineKind::OmniVoice, &|p| p.options.instructions = Some("calm".into()));
        assert_eq!(details["option"], "instructions");
        let details = reason(TtsEngineKind::VoxCpm2, &|p| {
            p.options.voice = SynthesizeVoice::Describe {
                description: "female".into(),
            }
        });
        assert_eq!(details["reason"], "unsupported-voice-mode");
        let details = reason(TtsEngineKind::Qwen3Tts, &|p| {
            p.options.voice = SynthesizeVoice::Describe {
                description: "female".into(),
            };
            p.options.instructions = Some("calm".into());
        });
        assert_eq!(details["option"], "instructions");

        // 形状对、值不对的旋钮是参数错。
        let engine = FakeEngine::new(TtsEngineKind::OmniVoice);
        let mut run_params = params(staging.path(), preset("zh-female"), None);
        run_params.options.speed = Some(0.0);
        assert_eq!(request_for(&engine, &run_params).unwrap_err().code, codes::INVALID_PARAMS);
        run_params.options.speed = None;
        run_params.options.steps = Some(0);
        assert_eq!(request_for(&engine, &run_params).unwrap_err().code, codes::INVALID_PARAMS);
    }

    #[test]
    fn preset_names_ignore_case_and_builtin_ids_reach_the_engine() {
        let staging = tempfile::tempdir().unwrap();
        let mut engine = FakeEngine::new(TtsEngineKind::Qwen3Tts);
        // CustomVoice 的说话人表来自小写键（`uncle_fu` → `Uncle_fu`），目录写的是 `Uncle_Fu`。
        engine.speakers = vec!["Vivian".into(), "Uncle_fu".into(), "Ono_anna".into()];
        for id in ["Uncle_Fu", "ono_anna", "VIVIAN", "zh-female", "ja-male"] {
            let request = request_for(&engine, &params(staging.path(), preset(id), None)).unwrap();
            assert_eq!(request.voice, VoiceSpec::Preset { speaker: id.into() }, "{id}");
        }
        let error = request_for(&engine, &params(staging.path(), preset("Uncle Fu"), None)).unwrap_err();
        assert_eq!(error.code, codes::MODEL_UNSUPPORTED);
        assert_eq!(error.details.unwrap()["reason"], "unknown-voice");
    }

    #[test]
    fn knob_values_and_descriptions_the_engine_rejects_are_invalid_params() {
        let staging = tempfile::tempdir().unwrap();
        // VoxCPM2 的引导强度要大于 0；OmniVoice 的 0 是不做引导。
        let mut run_params = params(staging.path(), preset("zh-female"), None);
        run_params.options.cfg = Some(0.0);
        let error = request_for(&FakeEngine::new(TtsEngineKind::VoxCpm2), &run_params).unwrap_err();
        assert_eq!(error.code, codes::INVALID_PARAMS);
        assert_eq!(
            request_for(&FakeEngine::new(TtsEngineKind::OmniVoice), &run_params)
                .unwrap()
                .sampling
                .cfg,
            Some(0.0)
        );

        // OmniVoice 的描述只认词表（中文文本时中英文词都认）。
        let describe = |description: &str| {
            params(
                staging.path(),
                SynthesizeVoice::Describe {
                    description: description.into(),
                },
                None,
            )
        };
        let engine = FakeEngine::new(TtsEngineKind::OmniVoice);
        assert!(request_for(&engine, &describe("女, 低音调")).is_ok());
        assert!(request_for(&engine, &describe("female, low pitch")).is_ok());
        let error = request_for(&engine, &describe("温柔的播音腔")).unwrap_err();
        assert_eq!(error.code, codes::INVALID_PARAMS);
        assert_eq!(error.details.unwrap()["reason"], "description-vocabulary");
        // 自由描述的模型不查词表。
        assert!(request_for(&FakeEngine::new(TtsEngineKind::Qwen3Tts), &describe("温柔的播音腔")).is_ok());
    }

    #[test]
    fn gpt_sovits_rejects_a_reference_outside_three_to_ten_seconds_with_a_transcript() {
        let staging = tempfile::tempdir().unwrap();
        let write = |name: &str, seconds: f32| {
            let path = staging.path().join(name);
            let tone: Vec<f32> = (0..(seconds * 16_000.0) as usize).map(|i| (i as f32 * 0.05).sin() * 0.3).collect();
            wav::write_wav_pcm16(&path, &tone, 16_000).unwrap();
            SpeechReference {
                file: path.to_string_lossy().into_owned(),
                content_hash: "sha256:ab".into(),
                track: 0,
            }
        };
        let (short, fine) = (write("short.wav", 1.5), write("fine.wav", 4.0));
        let clone = |transcript: Option<&str>| SynthesizeVoice::Clone {
            transcript: transcript.map(str::to_owned),
        };
        let attempt = |kind: TtsEngineKind, voice: SynthesizeVoice, input: &SpeechReference| {
            let mut engine = FakeEngine::new(kind);
            let result = run(
                &mut engine,
                &params(staging.path(), voice, Some(input.clone())),
                &AtomicBool::new(false),
                &mut Events::default(),
            );
            (result, engine.seen.is_some())
        };

        let (result, ran) = attempt(TtsEngineKind::GptSovits, clone(Some("参考原文")), &short);
        let error = result.unwrap_err();
        assert_eq!(error.code, codes::MODEL_UNSUPPORTED);
        let details = error.details.unwrap();
        assert_eq!(
            (&details["reason"], &details["seconds"]),
            (&json!("reference-duration"), &json!(1.5))
        );
        assert!(!ran, "the engine never runs on a reference it would reject");
        // 不给原文时不限时长；其他引擎不受这条限制。
        assert!(attempt(TtsEngineKind::GptSovits, clone(None), &short).0.is_ok());
        assert!(attempt(TtsEngineKind::GptSovits, clone(Some("参考原文")), &fine).0.is_ok());
        assert!(attempt(TtsEngineKind::VoxCpm2, clone(Some("参考原文")), &short).0.is_ok());
    }
}
