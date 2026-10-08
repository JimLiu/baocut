//! candle 后端的带权重 e2e（全平台，Windows / Linux 上的验收入口；移植自 v2 `bcut-speech` 的 `e2e_candle`）：
//!
//! BAOCUT_TEST_MODELS_DIR=… cargo test -p model-runtime --no-default-features --features backend-candle \
//!   --test e2e_candle -- --ignored --test-threads=1 --nocapture
//!
//! 一律跑在 CPU 上。权重按 `<BAOCUT_TEST_MODELS_DIR>/<repo>/.bcut-manifest.json` 核对后加载，不在时打印原因后跳过。

#![cfg(feature = "backend-candle")]

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use candle_core::Device;
use model_runtime::asr_result::{self, AsrResult, TimingQuality};
use model_runtime::audio::decode_mono;
use model_runtime::backend::candle::{MossTranscribeDiarize, Qwen3Asr, SileroVad};
use model_runtime::backend::{self, Loaded};
use model_runtime::bundle::{self, ModelBundle, VerifiedFiles};
use model_runtime::protocol::{JobRunParams, MemorySnapshot};
use model_runtime::speech::qwen3_asr::{Qwen3Config, TokenizerFiles};
use model_runtime::speech::{RecognitionRequest, SpeechRecognizer, StreamingVad};
use model_runtime::transcribe::{self, JobSink};
use serde_json::{Value, json};

const ASR_REPO: &str = "aufklarer/Qwen3-ASR-0.6B-MLX-4bit";
const VAD_REPO: &str = "aufklarer/Silero-VAD-v6.2.1-MLX";
const ALIGNER_REPO: &str = "aufklarer/Qwen3-ForcedAligner-0.6B-4bit";
const MOSS_REPO: &str = "OpenMOSS-Team/MOSS-Transcribe-Diarize";

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with Qwen3-ASR 0.6B installed"]
fn candle_qwen3_transcribes_reference_fixture() {
    let Some(files) = verified(ASR_REPO, "qwen3-asr", "asr") else {
        return;
    };
    let config: Value = serde_json::from_slice(&std::fs::read(files.require("config.json").unwrap()).unwrap()).unwrap();
    let weights = files.require_extension("safetensors").unwrap();
    let tokenizer = TokenizerFiles {
        vocabulary: files.require("vocab.json").unwrap(),
        merges: files.path("merges.txt"),
        config: files.path("tokenizer_config.json"),
    };
    let mut qwen = Qwen3Asr::load(Qwen3Config::parse(&config).unwrap(), &weights, tokenizer, &Device::Cpu).unwrap();
    let request = RecognitionRequest {
        language: Some("en"),
        context: None,
    };
    let result = qwen.recognize(&audio("test-sample.wav"), &request).unwrap();
    let normalized = normalize(&result.text);
    assert!(
        normalized.contains("testing one two three"),
        "unexpected transcript: {}",
        result.text
    );
    assert!(
        normalized.contains("baocut is ready") || normalized.contains("biocut is ready") || normalized.contains("baeocut is ready"),
        "unexpected transcript: {}",
        result.text
    );
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with MOSS Transcribe Diarize installed"]
fn candle_moss_transcribes_reference_fixture() {
    let Some(files) = verified(MOSS_REPO, "moss-transcribe-diarize", "asr") else {
        return;
    };
    let mut moss = MossTranscribeDiarize::load(&files, &Device::Cpu).unwrap();
    let result = moss.transcribe_diarized(&audio("test-sample.wav"), None).unwrap();
    assert!(
        normalize(&result.text).contains("testing one two three"),
        "unexpected transcript: {}",
        result.text
    );
    assert!(!result.rows.is_empty());
    for row in &result.rows {
        assert!(row.start < row.end, "行时间非法: [{}, {}]", row.start, row.end);
    }
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with Silero VAD installed"]
fn candle_silero_probability_is_finite() {
    let Some(files) = verified(VAD_REPO, "silero-vad", "vad") else {
        return;
    };
    let mut vad = SileroVad::load(&files.require_extension("safetensors").unwrap()).unwrap();
    let probability = vad.process_chunk(&[0.0; 512]).unwrap();
    assert!(probability.is_finite() && (0.0..=1.0).contains(&probability));
}

#[derive(Default)]
struct Sink;

impl JobSink for Sink {
    fn event(&mut self, _name: &str, _params: Value) {}
    fn memory(&mut self, _snapshot: MemorySnapshot) {}
}

/// 完整流水线（Silero + Qwen3-ASR + 对齐器，candle CPU）给出合契约的 `aligned` 词时间。
#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with Qwen3-ASR 0.6B, Silero and the forced aligner installed"]
fn candle_full_pipeline_produces_contract_valid_word_timestamps() {
    let (Some(asr), Some(vad), Some(aligner)) = (
        model_files(ASR_REPO, "qwen3-asr"),
        model_files(VAD_REPO, "silero-vad"),
        model_files(ALIGNER_REPO, "qwen3-forced-aligner"),
    ) else {
        return;
    };
    let bundle: ModelBundle = serde_json::from_value(json!({
        "bundleId": "qwen3-asr-0.6b@candle",
        "backend": "candle",
        "device": "cpu",
        "components": { "asr": asr, "vad": vad, "aligner": aligner },
        "threads": 4,
        "memoryBudgetBytes": null,
    }))
    .unwrap();
    let bundle = bundle::verify(&bundle).unwrap();
    let Loaded::Transcription(mut model) = backend::load(&bundle, &mut |_, _| {}).unwrap() else {
        panic!("a transcription bundle loads as a transcription model");
    };
    assert!(model.aligner().is_some(), "the bundle's aligner is loaded");

    let staging = tempfile::tempdir().unwrap();
    let params: JobRunParams = serde_json::from_value(json!({
        "jobId": "job-e2e",
        "runGeneration": 1,
        "capability": "transcribe",
        "input": { "file": fixture("test-sample.wav").to_string_lossy(), "contentHash": "sha256:e2e", "track": 0 },
        "options": { "language": { "mode": "assert", "tag": "en" }, "diarize": false, "timescale": 1_000_000 },
        "staging": staging.path().to_string_lossy(),
        "outputContract": "baocut.asr-result/v1",
    }))
    .unwrap();
    let result = transcribe::run(model.as_mut(), &bundle, &params, &AtomicBool::new(false), &mut Sink).unwrap();
    let output = result.output.expect("a completed job has an output");
    let asr: AsrResult = serde_json::from_slice(&std::fs::read(&output.path).unwrap()).unwrap();
    asr_result::validate(&asr, Some("en")).unwrap();
    assert!(!asr.segments.is_empty());
    assert!(asr.warnings.is_empty(), "{:?}", asr.warnings);
    assert!(asr.provenance.models.aligner.is_some());
    for segment in &asr.segments {
        let words = &segment.words;
        assert!(!words.is_empty(), "the forced aligner should return words");
        assert!(words.iter().all(|word| word.timing_quality == TimingQuality::Aligned));
        assert!(words.windows(2).all(|pair| pair[0].start < pair[1].start));
        assert!(words.iter().all(|word| word.start >= segment.start && word.start < segment.end));
    }
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

fn audio(name: &str) -> Vec<f32> {
    decode_mono(&fixture(name), 16_000).expect("decode fixture")
}

/// 从 `<models-root>/<repo>/.bcut-manifest.json` 构造协议里的 `ModelFiles`；权重不在时给 `None` 并打印原因。
fn model_files(repo: &str, family: &str) -> Option<Value> {
    let Some(root) = std::env::var_os("BAOCUT_TEST_MODELS_DIR") else {
        println!("跳过：没设 BAOCUT_TEST_MODELS_DIR");
        return None;
    };
    let dir = PathBuf::from(root).join(repo);
    let Ok(bytes) = std::fs::read(dir.join(".bcut-manifest.json")) else {
        println!("跳过：{} 没有 .bcut-manifest.json（权重没装好）", dir.display());
        return None;
    };
    let manifest: Value = serde_json::from_slice(&bytes).expect("manifest JSON");
    let files: Vec<Value> = manifest["files"]
        .as_array()
        .expect("manifest files")
        .iter()
        .map(|file| json!({ "path": file["path"], "sha256": file["sha256"], "byteLength": file["size"] }))
        .collect();
    Some(json!({ "family": family, "revision": manifest["revision"], "dir": dir.to_string_lossy(), "files": files }))
}

fn verified(repo: &str, family: &str, component: &'static str) -> Option<VerifiedFiles> {
    let files: bundle::ModelFiles = serde_json::from_value(model_files(repo, family)?).expect("ModelFiles");
    Some(files.verify(component).expect("verify component files"))
}

fn normalize(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .filter(|character| character.is_alphanumeric() || character.is_whitespace())
        .collect()
}
