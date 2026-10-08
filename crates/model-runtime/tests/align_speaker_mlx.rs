//! 对齐器与说话人嵌入的真权重测试（移植自 v2 `bcut-speech` 的 e2e）：对齐器卸载后不留 GPU 缓存、完整流水线
//! （Qwen3-ASR + Silero + 对齐器）给出合契约的 `aligned` 词时间、WeSpeaker 同一说话人的两段嵌入彼此接近。
//!
//! BAOCUT_TEST_MODELS_DIR="$HOME/Library/Application Support/BaoCut/models" \
//!   cargo test -p model-runtime --test align_speaker_mlx -- --ignored --test-threads=1 --nocapture
//!
//! 权重不在（没设 `BAOCUT_TEST_MODELS_DIR` 或没有 `.bcut-manifest.json`）时打印原因后跳过。

#![cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use model_runtime::asr_result::{self, AsrResult, TimingQuality};
use model_runtime::audio::decode_mono;
use model_runtime::backend::mlx::aligner::ForcedAligner;
use model_runtime::backend::mlx::runtime::{clear_memory_cache, configure_memory_cache, memory_snapshot};
use model_runtime::backend::mlx::wespeaker::{EMBEDDING_DIM, WeSpeakerEmbedder, cosine_distance};
use model_runtime::backend::{self, Loaded};
use model_runtime::bundle::{self, ModelBundle, VerifiedFiles};
use model_runtime::protocol::{JobRunParams, MemorySnapshot};
use model_runtime::speech::ForcedAlignment;
use model_runtime::transcribe::{self, JobSink};
use serde_json::{Value, json};

const ALIGNER_REPO: &str = "aufklarer/Qwen3-ForcedAligner-0.6B-4bit";
const WESPEAKER_REPO: &str = "aufklarer/WeSpeaker-ResNet34-LM-MLX";
const ASR_REPO: &str = "aufklarer/Qwen3-ASR-0.6B-MLX-4bit";
const VAD_REPO: &str = "aufklarer/Silero-VAD-v6.2.1-MLX";

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

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with the forced aligner installed; measures the GPU cache after unload"]
fn aligner_unload_releases_gpu_cache() {
    let Some(files) = verified(ALIGNER_REPO, "qwen3-forced-aligner", "aligner") else {
        return;
    };
    configure_memory_cache().unwrap();
    clear_memory_cache().unwrap();
    let baseline = memory_snapshot().0;
    let mut model = ForcedAligner::load(&files).unwrap();
    let words = model.align_long(&audio("test-sample.wav"), "Hello world", Some("en")).unwrap();
    assert!(!words.is_empty());
    let loaded = memory_snapshot();
    drop(model);
    let unloaded = memory_snapshot();
    eprintln!("aligner GPU bytes: baseline={baseline}, loaded={loaded:?}, unloaded={unloaded:?}");
    assert_eq!(unloaded.1, 0, "model weights must not stay in MLX cache");
    assert!(unloaded.0 <= baseline + 1024 * 1024, "{unloaded:?}");
}

#[derive(Default)]
struct Sink;

impl JobSink for Sink {
    fn event(&mut self, _name: &str, _params: Value) {}
    fn memory(&mut self, _snapshot: MemorySnapshot) {}
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with Qwen3-ASR 0.6B, Silero and the forced aligner installed"]
fn full_pipeline_produces_contract_valid_word_timestamps() {
    let (Some(asr), Some(vad), Some(aligner)) = (
        model_files(ASR_REPO, "qwen3-asr"),
        model_files(VAD_REPO, "silero-vad"),
        model_files(ALIGNER_REPO, "qwen3-forced-aligner"),
    ) else {
        return;
    };
    let bundle: ModelBundle = serde_json::from_value(json!({
        "bundleId": "qwen3-asr-0.6b@mlx-4bit",
        "backend": "mlx",
        "device": "metal",
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
    eprintln!("stats: {:?}", result.stats);
    for segment in &asr.segments {
        eprintln!("[{} – {}] {}", segment.start, segment.end, segment.text);
        assert!(!segment.words.is_empty(), "the forced aligner should return words");
        assert!(segment.words.iter().all(|word| word.timing_quality == TimingQuality::Aligned));
        assert!(segment.words.windows(2).all(|pair| pair[0].start < pair[1].start));
        assert!(
            segment
                .words
                .iter()
                .all(|word| word.start >= segment.start && word.start < segment.end)
        );
    }
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with the WeSpeaker model installed"]
fn wespeaker_embeds_same_speaker_segments_close_together() {
    let Some(files) = verified(WESPEAKER_REPO, "wespeaker", "speaker") else {
        return;
    };
    let audio_samples = audio("test-sample.wav");
    assert!(audio_samples.len() >= 32_000, "fixture 至少要有 2 秒");

    let midpoint = audio_samples.len() / 2;
    let first = &audio_samples[..midpoint];
    let second = &audio_samples[midpoint..];

    let mut embedder = WeSpeakerEmbedder::load(&files).unwrap();
    let first_embedding = embedder.embed(first).unwrap();
    let second_embedding = embedder.embed(second).unwrap();

    assert_eq!(first_embedding.len(), EMBEDDING_DIM);
    assert_eq!(second_embedding.len(), EMBEDDING_DIM);
    for embedding in [&first_embedding, &second_embedding] {
        let norm = embedding
            .iter()
            .map(|value| f64::from(*value) * f64::from(*value))
            .sum::<f64>()
            .sqrt();
        assert!((norm - 1.0).abs() <= 1e-3, "嵌入未 L2 归一化：{norm}");
        assert!(embedding.iter().all(|value| value.is_finite()));
    }

    // 同一段自身：完全一致，距离为 0（确定性）。
    let repeated = embedder.embed(first).unwrap();
    let self_distance = cosine_distance(&first_embedding, &repeated);
    assert!(self_distance.abs() <= 1e-5, "同段自身距离 {self_distance}");

    let speaker_distance = cosine_distance(&first_embedding, &second_embedding);

    // 另一位说话人（中文 fixture）：跨说话人距离必须远大于同说话人。
    let other_embedding = embedder.embed(&audio("chinese-sample.wav")).unwrap();
    let cross_speaker_distance = cosine_distance(&first_embedding, &other_embedding);

    // 白噪声段：与语音的距离必须显著大于同一说话人两段之间的距离。
    let mut state = 987_654_321_u32;
    let noise = (0..first.len())
        .map(|_| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            0.05 * ((state >> 8) as f32 / 8_388_608.0 - 1.0)
        })
        .collect::<Vec<f32>>();
    let noise_embedding = embedder.embed(&noise).unwrap();
    let noise_distance = cosine_distance(&first_embedding, &noise_embedding);

    eprintln!(
        "WeSpeaker: 同说话人 {speaker_distance:.4}、跨说话人 {cross_speaker_distance:.4}、\
         噪声 {noise_distance:.4}、自身 {self_distance:.6}"
    );
    // fixture 里有约 0.6 秒数字静音，会把同说话人距离抬到 0.38 左右；
    // 经 VAD 裁剪的真实语音段之间约为 0.07。
    assert!(speaker_distance < 0.4, "同一说话人两段距离过大：{speaker_distance}");
    assert!(
        cross_speaker_distance > speaker_distance + 0.3,
        "跨说话人 {cross_speaker_distance} 未显著远于同说话人 {speaker_distance}"
    );
    assert!(
        noise_distance > speaker_distance,
        "噪声 {noise_distance} 未显著远于同说话人 {speaker_distance}"
    );

    // 输入不足 0.5 秒必须拒绝，由调用方过滤。
    assert!(embedder.embed(&audio_samples[..7_999]).is_err());
}
