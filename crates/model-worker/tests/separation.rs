//! 端到端：真实的 HTDemucs-FT 模型包，`worker.hello` → `model.load` → `job.run`（`separate`）→ 结果。需要本机装好的模型，
//! 默认忽略：
//!
//! ```sh
//! BAOCUT_TEST_MODELS_DIR="$HOME/Library/Application Support/BaoCut/models" \
//!   cargo test -p model-worker --test separation -- --ignored --test-threads=1 --nocapture
//! ```
//!
//! 输入在测试里现做：16 kHz 的英文语音夹具升到 48 kHz，叠一条合成低音，写成立体声 WAV。模型目录只读。

mod support;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use model_runtime::separate::resample::resample;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use support::{WorkerProcess, fixture, model_files, result};

const LOAD_TIMEOUT: Duration = Duration::from_secs(600);
const JOB_TIMEOUT: Duration = Duration::from_secs(900);
const QUICK: Duration = Duration::from_secs(10);
const REPO: &str = "aufklarer/HTDemucs-FT-MLX";
const RATE: u32 = 48_000;

fn models_root() -> PathBuf {
    PathBuf::from(std::env::var("BAOCUT_TEST_MODELS_DIR").expect("set BAOCUT_TEST_MODELS_DIR to the models root"))
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

/// 语音（升到 48 kHz）与低音（82 Hz + 二次谐波），以及二者之和写成的立体声 WAV。
fn make_input(dir: &Path) -> (PathBuf, Vec<f32>, Vec<f32>) {
    let mut reader = hound::WavReader::open(fixture("test-sample.wav")).unwrap();
    let spec = reader.spec();
    assert_eq!((spec.sample_rate, spec.channels), (16_000, 1));
    let speech16: Vec<f32> = reader.samples::<i16>().map(|s| f32::from(s.unwrap()) / 32_768.0).collect();
    let speech = resample(&speech16, 16_000, RATE);
    let tone: Vec<f32> = (0..speech.len())
        .map(|i| {
            let t = i as f32 / RATE as f32;
            0.15 * (std::f32::consts::TAU * 82.41 * t).sin() + 0.08 * (std::f32::consts::TAU * 164.82 * t).sin()
        })
        .collect();
    let path = dir.join("mix.wav");
    let spec = hound::WavSpec {
        channels: 2,
        sample_rate: RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&path, spec).unwrap();
    for (s, t) in speech.iter().zip(&tone) {
        let v = ((s + t).clamp(-1.0, 1.0) * 32_767.0).round() as i16;
        writer.write_sample(v).unwrap();
        writer.write_sample(v).unwrap();
    }
    writer.finalize().unwrap();
    (path, speech, tone)
}

/// 读 16-bit PCM 立体声 WAV，混成单声道。
fn read_stereo(path: &Path) -> (u32, Vec<f32>) {
    let mut reader = hound::WavReader::open(path).unwrap();
    let spec = reader.spec();
    assert_eq!((spec.channels, spec.bits_per_sample), (2, 16));
    let samples: Vec<f32> = reader.samples::<i16>().map(|s| f32::from(s.unwrap()) / 32_768.0).collect();
    (spec.sample_rate, samples.chunks_exact(2).map(|f| (f[0] + f[1]) / 2.0).collect())
}

fn correlation(a: &[f32], b: &[f32]) -> f64 {
    let n = a.len().min(b.len());
    let mean = |x: &[f32]| x[..n].iter().map(|v| f64::from(*v)).sum::<f64>() / n as f64;
    let (ma, mb) = (mean(a), mean(b));
    let (mut cov, mut va, mut vb) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let (x, y) = (f64::from(a[i]) - ma, f64::from(b[i]) - mb);
        cov += x * y;
        va += x * x;
        vb += y * y;
    }
    cov / (va.sqrt() * vb.sqrt()).max(1e-12)
}

fn run_params(job_id: &str, input: &Path, staging: &Path) -> Value {
    let bytes = std::fs::read(input).unwrap();
    json!({
        "jobId": job_id,
        "runGeneration": 1,
        "capability": "separate",
        "input": { "file": input.to_string_lossy(), "contentHash": format!("sha256:{}", sha256_hex(&bytes)), "track": 0 },
        "options": { "sampleRate": RATE },
        "staging": staging.to_string_lossy(),
        "outputContract": "baocut.stems-wav/v1",
    })
}

#[test]
#[ignore = "needs installed models (BAOCUT_TEST_MODELS_DIR)"]
fn htdemucs_splits_speech_from_a_bass_line_and_cancels() {
    let mut worker = WorkerProcess::spawn();
    let (_, hello) = worker.call("worker.hello", json!({ "contractVersion": 1 }), QUICK);
    let hello = result(&hello);
    assert_eq!(hello["separateFamilies"], json!(["htdemucs-ft"]), "{hello}");
    assert!(hello["capabilities"].as_array().unwrap().iter().any(|c| c == "separate"));
    let bundle = json!({
        "bundleId": "htdemucs-ft@mlx",
        "backend": "mlx",
        "device": "metal",
        "components": { "separator": model_files(&models_root(), REPO, "htdemucs-ft") },
        "threads": 4,
        "memoryBudgetBytes": null,
    });
    let started = Instant::now();
    let (events, response) = worker.call("model.load", json!({ "bundle": bundle }), LOAD_TIMEOUT);
    let loaded = result(&response);
    assert_eq!(loaded["loaded"], true);
    assert!(
        events
            .iter()
            .any(|e| e["event"] == "model.phase" && e["params"]["phase"] == "loading-weights")
    );
    eprintln!(
        "[htdemucs] model.load {:.1}s (residentBytes {})",
        started.elapsed().as_secs_f64(),
        loaded["residentBytes"]
    );

    let dir = tempfile::tempdir().unwrap();
    let (input, speech, tone) = make_input(dir.path());
    let staging = dir.path().join("staging");
    std::fs::create_dir(&staging).unwrap();
    let started = Instant::now();
    let (events, response) = worker.call("job.run", run_params("job-sep", &input, &staging), JOB_TIMEOUT);
    let outcome = result(&response).clone();
    assert_eq!(outcome["outcome"], "completed", "{response}");
    let phases: Vec<&str> = events
        .iter()
        .filter(|e| e["event"] == "job.phase")
        .map(|e| e["params"]["phase"].as_str().unwrap())
        .collect();
    assert_eq!(phases, ["decoding", "separating", "encoding"]);
    let progress: Vec<(u64, u64)> = events
        .iter()
        .filter(|e| e["event"] == "job.progress")
        .map(|e| {
            assert_eq!(e["params"]["unit"], "steps");
            (e["params"]["done"].as_u64().unwrap(), e["params"]["total"].as_u64().unwrap())
        })
        .collect();
    let &(done, total) = progress.last().unwrap();
    assert_eq!(done, total, "{progress:?}");
    assert_eq!(total % 4, 0, "steps are windows × 4 sub-models: {progress:?}");

    let input_seconds = speech.len() as f64 / f64::from(RATE);
    let audio = &outcome["audio"];
    assert_eq!(audio["sampleRate"], RATE);
    assert_eq!(audio["channels"], 2);
    assert!((audio["durationSec"].as_f64().unwrap() - input_seconds).abs() < 0.02, "{audio}");
    let mut mono = Vec::new();
    for (name, file) in [
        ("vocals", &outcome["stems"]["vocals"]),
        ("background", &outcome["stems"]["background"]),
    ] {
        let path = PathBuf::from(file["path"].as_str().unwrap());
        assert_eq!(path, staging.join(format!("{name}.wav")));
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(file["byteLength"], bytes.len() as u64);
        assert_eq!(file["sha256"], sha256_hex(&bytes));
        let (rate, samples) = read_stereo(&path);
        assert_eq!(rate, RATE);
        assert_eq!(samples.len(), speech.len(), "{name}");
        mono.push(samples);
    }
    let vs = correlation(&mono[0], &speech);
    let vt = correlation(&mono[0], &tone);
    let bt = correlation(&mono[1], &tone);
    let bs = correlation(&mono[1], &speech);
    eprintln!(
        "[htdemucs] {input_seconds:.2}s separated in {:.1}s, stats {}; corr vocals~speech {vs:.3}, vocals~bass {vt:.3}, background~bass {bt:.3}, background~speech {bs:.3}",
        started.elapsed().as_secs_f64(),
        outcome["stats"]
    );
    assert!(vs > 0.95, "vocals follow the speech: {vs:.3}");
    assert!(bt > 0.95, "background follows the bass line: {bt:.3}");
    assert!(vt.abs() < 0.1, "no bass in the vocals: {vt:.3}");
    assert!(bs.abs() < 0.1, "no speech in the background: {bs:.3}");

    // 取消：第一个窗口的进度之后取消，结果是 cancelled、不写输出，Worker 回到 ready。
    let staging = dir.path().join("staging-cancel");
    std::fs::create_dir(&staging).unwrap();
    let run_id = worker.send("job.run", run_params("job-cancel", &input, &staging));
    loop {
        let message = worker.next(JOB_TIMEOUT);
        assert_ne!(message["id"], run_id, "the job finished before it could be cancelled: {message}");
        if message["event"] == "job.phase" && message["params"]["phase"] == "separating" {
            break;
        }
    }
    let cancel_id = worker.send("job.cancel", json!({ "jobId": "job-cancel" }));
    let response = loop {
        let message = worker.next(JOB_TIMEOUT);
        if message["id"] == cancel_id {
            assert_eq!(result(&message)["acknowledged"], true);
        } else if message["id"] == run_id {
            break message;
        }
    };
    let cancelled = result(&response);
    assert_eq!(cancelled["outcome"], "cancelled", "{response}");
    assert_eq!(cancelled["stems"], Value::Null);
    assert!(!staging.join("vocals.wav").exists());
    let (_, status) = worker.call("worker.status", json!({}), QUICK);
    assert_eq!(result(&status)["state"], "ready");
}
