//! 端到端：真实的「说话人区分」模型包（Pyannote 分段 + WeSpeaker）单独加载，`job.run`（`diarize`）给一份已有转写的词区分
//! 说话人（协议规范 §2.5.5）。需要本机装好的模型，默认忽略：
//!
//! ```sh
//! BAOCUT_TEST_MODELS_DIR="$HOME/Library/Application Support/BaoCut/models" \
//!   cargo test -p model-worker --test diarization -- --ignored --test-threads=1 --nocapture
//! ```
//!
//! 输入在测试里现拼：英文样本接中文样本（两个人）。词是合成的：每 1.5 秒一个 0.5 秒的词（词间停顿超过发言段的切分
//! 阈值，每个词各自成段），只核对离接缝 0.3 秒以外的词。模型目录只读。

mod support;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use support::{PYANNOTE, WESPEAKER, WorkerProcess, error_code, fixture, is_installed, model_files, result};

const LOAD_TIMEOUT: Duration = Duration::from_secs(300);
const JOB_TIMEOUT: Duration = Duration::from_secs(600);
const QUICK: Duration = Duration::from_secs(10);
const TIMESCALE: u64 = 1_000_000;

fn models_root() -> PathBuf {
    PathBuf::from(std::env::var("BAOCUT_TEST_MODELS_DIR").expect("set BAOCUT_TEST_MODELS_DIR to the models root"))
}

/// 本机装好的「说话人区分」模型包（只有 `segmentation` 与 `speaker`）；没装时 `None`。
fn diarization_bundle(models_root: &Path, backend: &str, device: &str) -> Option<Value> {
    if !is_installed(models_root, PYANNOTE) || !is_installed(models_root, WESPEAKER) {
        return None;
    }
    Some(json!({
        "bundleId": format!("speaker-diarization@{backend}"),
        "backend": backend,
        "device": device,
        "components": {
            "segmentation": model_files(models_root, PYANNOTE, "pyannote-segmentation"),
            "speaker": model_files(models_root, WESPEAKER, "wespeaker"),
        },
        "threads": 4,
        "memoryBudgetBytes": null,
    }))
}

/// 把几个 16 kHz 单声道 16 位的样本首尾相接，写进 `dir/name`；返回路径与每个样本的长度（tick）。
fn joined_fixtures(dir: &Path, name: &str, samples: &[&str]) -> (PathBuf, Vec<u64>) {
    let joined = dir.join(name);
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&joined, spec).unwrap();
    let mut lengths = Vec::new();
    for sample in samples {
        let mut reader = hound::WavReader::open(fixture(sample)).unwrap();
        lengths.push(u64::from(reader.duration()) * TIMESCALE / 16_000);
        for value in reader.samples::<i16>() {
            writer.write_sample(value.unwrap()).unwrap();
        }
    }
    writer.finalize().unwrap();
    (joined, lengths)
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

fn diarize_params(job_id: &str, file: &Path, staging: &Path, words: &[[u64; 2]]) -> Value {
    json!({
        "jobId": job_id,
        "runGeneration": 1,
        "capability": "diarize",
        "input": { "file": file.to_string_lossy(), "contentHash": "sha256:test", "track": 0 },
        "options": { "timescale": TIMESCALE, "words": words },
        "staging": staging.to_string_lossy(),
        "outputContract": "baocut.speakers/v1",
    })
}

fn diarizes_two_speakers_on(backend: &str, device: &str) {
    let root = models_root();
    let Some(bundle) = diarization_bundle(&root, backend, device) else {
        eprintln!("skipped: the speaker diarization models are not installed under {}", root.display());
        return;
    };
    let mut worker = WorkerProcess::spawn();
    let (_, hello) = worker.call("worker.hello", json!({ "contractVersion": 1 }), QUICK);
    assert!(
        result(&hello)["capabilities"].as_array().unwrap().contains(&json!("diarize")),
        "{hello}"
    );
    let started = Instant::now();
    let (events, response) = worker.call("model.load", json!({ "bundle": bundle }), LOAD_TIMEOUT);
    assert_eq!(result(&response)["loaded"], true, "{response}");
    assert!(
        events
            .iter()
            .any(|event| event["event"] == "model.phase" && event["params"]["phase"] == "loading-weights"),
        "{events:?}"
    );
    eprintln!("{backend} model.load: {:?} ({})", started.elapsed(), result(&response));

    let dir = tempfile::tempdir().unwrap();
    let (joined, lengths) = joined_fixtures(dir.path(), "two-speakers.wav", &["test-sample.wav", "chinese-sample.wav"]);
    let english_end = lengths[0];
    let total = lengths.iter().sum::<u64>();
    let words: Vec<[u64; 2]> = (0..)
        .map(|index: u64| index * 1_500_000 + 200_000)
        .take_while(|start| start + 500_000 <= total)
        .map(|start| [start, start + 500_000])
        .collect();

    let staging = tempfile::tempdir().unwrap();
    let started = Instant::now();
    let (events, response) = worker.call(
        "job.run",
        diarize_params("job-diarize", &joined, staging.path(), &words),
        JOB_TIMEOUT,
    );
    let elapsed = started.elapsed();
    let run = result(&response);
    eprintln!("{backend} diarize two-speakers.wav ({elapsed:?}): {run}");
    assert_eq!(run["outcome"], "completed");
    assert_eq!(run["speakers"], 2, "expected exactly two speakers");
    let phases: Vec<&str> = events
        .iter()
        .filter(|event| event["event"] == "job.phase")
        .map(|event| event["params"]["phase"].as_str().unwrap())
        .collect();
    assert_eq!(phases, ["decoding", "diarizing", "finalizing"]);
    assert!(
        events
            .iter()
            .any(|event| event["event"] == "job.progress" && event["params"]["phase"] == "diarizing"),
        "diarizing reports progress"
    );

    let output = &run["output"];
    let bytes = std::fs::read(output["path"].as_str().unwrap()).unwrap();
    assert_eq!(output["sha256"], sha256_hex(&bytes));
    assert_eq!(output["byteLength"], bytes.len());
    let speakers: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(speakers["schema"], "baocut.speakers/v1");
    assert_eq!(
        speakers["speakers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["id"].clone())
            .collect::<Vec<_>>(),
        [json!("spk-1"), json!("spk-2")]
    );
    assert!(speakers["provenance"]["models"]["segmentation"].is_object());
    assert!(speakers["provenance"]["models"]["speaker"].is_object());
    let labels = speakers["words"].as_array().unwrap();
    assert_eq!(labels.len(), words.len());
    let mut seen = std::collections::BTreeSet::new();
    for (word, label) in words.iter().zip(labels) {
        let [start, end] = *word;
        let expected = if end + 300_000 <= english_end {
            "spk-1"
        } else if start >= english_end + 300_000 {
            "spk-2"
        } else {
            continue;
        };
        assert_eq!(label, expected, "word {word:?} (English ends at {english_end})");
        seen.insert(expected);
    }
    assert_eq!(seen.len(), 2, "both samples have words");

    // 识别的任务交给说话人区分的模型包：模型包做不到。
    let staging = tempfile::tempdir().unwrap();
    let (_, response) = worker.call(
        "job.run",
        json!({
            "jobId": "job-transcribe",
            "runGeneration": 1,
            "capability": "transcribe",
            "input": { "file": joined.to_string_lossy(), "contentHash": "sha256:test", "track": 0 },
            "options": { "language": { "mode": "prefer", "tag": null } },
            "staging": staging.path().to_string_lossy(),
            "outputContract": "baocut.asr-result/v1",
        }),
        QUICK,
    );
    assert_eq!(error_code(&response), "MODEL_UNSUPPORTED");

    let (_, response) = worker.call("model.unload", json!({}), QUICK);
    assert_eq!(result(&response)["unloaded"], true);
}

#[test]
#[ignore = "needs the speaker diarization models installed under BAOCUT_TEST_MODELS_DIR"]
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn diarizes_two_speakers_on_mlx() {
    diarizes_two_speakers_on("mlx", "metal");
}

#[test]
#[ignore = "needs the speaker diarization models installed under BAOCUT_TEST_MODELS_DIR"]
#[cfg(feature = "backend-candle")]
fn diarizes_two_speakers_on_candle() {
    diarizes_two_speakers_on("candle", "cpu");
}
