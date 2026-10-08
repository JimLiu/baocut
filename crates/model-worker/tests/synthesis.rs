//! 端到端：真实的合成模型包，`worker.hello` → `model.load` → `job.run`（`synthesize`）→ 结果。需要本机装好的模型，默认忽略：
//!
//! ```sh
//! BAOCUT_TEST_MODELS_DIR="$HOME/Library/Application Support/BaoCut/models" \
//!   cargo test -p model-worker --test synthesis -- --ignored --test-threads=1 --nocapture
//! ```
//!
//! `candle_` 开头的几条在 candle 后端的 CPU 上跑同一批模型包（Apple Silicon 以外的平台登记的形状），要只编 candle 的构建
//! （带 MLX 的 Apple Silicon 构建里合成走 MLX，candle 的合成模型包会被拒绝）：
//!
//! ```sh
//! BAOCUT_TEST_MODELS_DIR=… cargo test -p model-worker --no-default-features --features backend-candle --test synthesis \
//!   -- --ignored --test-threads=1 --nocapture candle_
//! ```
//!
//! 合成的 WAV 留在 `BAOCUT_TEST_OUTPUT_DIR`（不给时是系统临时目录下的 `baocut-synthesis-e2e/`），供人耳复核。
//! 模型目录只读：测试不写、不修模型包。

mod support;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use support::{WorkerProcess, fixture, model_files, result};
#[cfg(all(
    feature = "backend-candle",
    not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))
))]
use support::{is_installed, on_candle};

const LOAD_TIMEOUT: Duration = Duration::from_secs(600);
/// candle 在 CPU 上比 Metal 慢一个数量级。
const JOB_TIMEOUT: Duration = Duration::from_secs(1_800);
const QUICK: Duration = Duration::from_secs(10);
const CODEC_REPO: &str = "Qwen/Qwen3-TTS-Tokenizer-12Hz";
const INDEX_TTS2_REPO: &str = "aufklarer/IndexTTS2-MLX-fp16";
/// `test-sample.wav` 念的原文。
const SAMPLE_TRANSCRIPT: &str = "Testing one two three, BaoCut is ready.";

fn models_root() -> PathBuf {
    PathBuf::from(std::env::var("BAOCUT_TEST_MODELS_DIR").expect("set BAOCUT_TEST_MODELS_DIR to the models root"))
}

fn output_dir() -> PathBuf {
    let dir = std::env::var_os("BAOCUT_TEST_OUTPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("baocut-synthesis-e2e"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn bundle(bundle_id: &str, family: &str, repo: &str) -> Value {
    let root = models_root();
    let mut components = json!({ "tts": model_files(&root, repo, family) });
    if family == "qwen3-tts" {
        components["codec"] = model_files(&root, CODEC_REPO, "qwen3-tts-tokenizer");
    }
    // IndexTTS 2.5 的辅助权重（语义编码器、声码器等）借用整个 IndexTTS2 仓库。
    if family == "indextts2.5" {
        components["aux"] = model_files(&root, INDEX_TTS2_REPO, "indextts2-aux");
    }
    json!({
        "bundleId": bundle_id,
        "backend": "mlx",
        "device": "metal",
        "components": components,
        "threads": 4,
        "memoryBudgetBytes": null,
    })
}

fn loaded_worker(bundle_id: &str, family: &str, repo: &str) -> WorkerProcess {
    loaded_worker_with(bundle(bundle_id, family, repo), family)
}

/// 起一个 Worker，确认模型包的后端可用、`synthesizeFamilies` 列出 `family`，再加载 `bundle`。
fn loaded_worker_with(bundle: Value, family: &str) -> WorkerProcess {
    let bundle_id = bundle["bundleId"].as_str().unwrap().to_owned();
    let backend = bundle["backend"].as_str().unwrap().to_owned();
    let mut worker = WorkerProcess::spawn();
    let (_, hello) = worker.call("worker.hello", json!({ "contractVersion": 1 }), QUICK);
    let hello = result(&hello);
    let status = hello["backends"]
        .as_array()
        .unwrap()
        .iter()
        .find(|status| status["id"] == backend.as_str())
        .unwrap();
    assert_eq!(status["available"], true, "the {backend} backend must be available: {hello}");
    assert!(
        hello["synthesizeFamilies"].as_array().unwrap().iter().any(|f| f == family),
        "{family} must be listed: {hello}"
    );
    assert!(hello["capabilities"].as_array().unwrap().iter().any(|c| c == "synthesize"));
    let started = Instant::now();
    let (events, response) = worker.call("model.load", json!({ "bundle": bundle }), LOAD_TIMEOUT);
    let loaded = result(&response);
    assert_eq!(loaded["loaded"], true);
    assert!(
        events
            .iter()
            .any(|e| e["event"] == "model.phase" && e["params"]["phase"] == "loading-weights"),
        "{events:?}"
    );
    eprintln!(
        "[{bundle_id}] model.load {:.1}s (residentBytes {})",
        started.elapsed().as_secs_f64(),
        loaded["residentBytes"]
    );
    let (_, status) = worker.call("worker.status", json!({}), QUICK);
    assert_eq!(result(&status)["state"], "ready");
    assert_eq!(result(&status)["bundleId"], bundle_id);
    worker
}

struct Request<'a> {
    text: &'a str,
    language: Option<&'a str>,
    voice: Value,
    input: Option<&'a Path>,
    instructions: Option<&'a str>,
    seed: Option<u64>,
}

fn run_params(job_id: &str, staging: &Path, request: &Request<'_>) -> Value {
    let input = request.input.map(|file| {
        let bytes = std::fs::read(file).unwrap();
        json!({ "file": file.to_string_lossy(), "contentHash": format!("sha256:{}", sha256_hex(&bytes)), "track": 0 })
    });
    json!({
        "jobId": job_id,
        "runGeneration": 1,
        "capability": "synthesize",
        "input": input,
        "options": {
            "text": request.text,
            "language": request.language,
            "voice": request.voice,
            "instructions": request.instructions,
            "speed": null, "cfg": null, "steps": null,
            "seed": request.seed,
        },
        "staging": staging.to_string_lossy(),
        "outputContract": "baocut.speech-wav/v1",
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

/// 读 16-bit PCM 单声道 WAV 的样本；头不对就失败。
fn read_wav(bytes: &[u8]) -> (u32, Vec<f32>) {
    assert_eq!(&bytes[0..4], b"RIFF");
    assert_eq!(&bytes[8..12], b"WAVE");
    assert_eq!(&bytes[12..16], b"fmt ");
    let u16_at = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    assert_eq!(u16_at(20), 1, "PCM");
    assert_eq!(u16_at(22), 1, "mono");
    let sample_rate = u32_at(24);
    assert_eq!(u16_at(34), 16, "16-bit");
    assert_eq!(&bytes[36..40], b"data");
    let data = u32_at(40) as usize;
    assert_eq!(44 + data, bytes.len(), "the data chunk fills the file");
    let samples = bytes[44..]
        .chunks_exact(2)
        .map(|pair| f32::from(i16::from_le_bytes([pair[0], pair[1]])) / 32_768.0)
        .collect();
    (sample_rate, samples)
}

/// 跑一次合成并校验：阶段与步数进度、`speech.wav` 的摘要与长度、WAV 头、时长与响度；WAV 复制到输出目录。
fn synthesize(worker: &mut WorkerProcess, name: &str, request: &Request<'_>, seconds: std::ops::RangeInclusive<f64>) -> Value {
    let staging = tempfile::tempdir().unwrap();
    let started = Instant::now();
    let (events, response) = worker.call("job.run", run_params(&format!("job-{name}"), staging.path(), request), JOB_TIMEOUT);
    let elapsed = started.elapsed().as_secs_f64();
    let outcome = result(&response).clone();
    assert_eq!(outcome["outcome"], "completed", "{response}");

    let phases: Vec<&str> = events
        .iter()
        .filter(|e| e["event"] == "job.phase")
        .map(|e| e["params"]["phase"].as_str().unwrap())
        .collect();
    let expected: &[&str] = if request.input.is_some() {
        &["preparing-reference", "synthesizing", "encoding"]
    } else {
        &["synthesizing", "encoding"]
    };
    assert_eq!(phases, expected);
    let progress: Vec<(u64, u64)> = events
        .iter()
        .filter(|e| e["event"] == "job.progress")
        .map(|e| {
            assert_eq!(e["params"]["unit"], "steps");
            assert_eq!(e["params"]["phase"], "synthesizing");
            (e["params"]["done"].as_u64().unwrap(), e["params"]["total"].as_u64().unwrap())
        })
        .collect();
    for event in events.iter().filter(|e| e["event"] != "model.phase") {
        assert_eq!(event["params"]["jobId"], format!("job-{name}"), "{event}");
    }
    if let Some(&(done, total)) = progress.last() {
        assert_eq!(done, total, "{progress:?}");
    }

    let output = &outcome["output"];
    let path = PathBuf::from(output["path"].as_str().unwrap());
    assert!(path.is_absolute());
    assert_eq!(path, staging.path().join("speech.wav"));
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(output["byteLength"], bytes.len() as u64);
    assert_eq!(output["sha256"].as_str().unwrap().trim_start_matches("sha256:"), sha256_hex(&bytes));
    let (sample_rate, samples) = read_wav(&bytes);
    let audio = &outcome["audio"];
    assert_eq!(audio["sampleRate"], sample_rate);
    assert_eq!(audio["channels"], 1);
    let duration = samples.len() as f64 / f64::from(sample_rate);
    assert!((audio["durationSec"].as_f64().unwrap() - duration).abs() < 0.01, "{audio}");
    let peak = samples.iter().fold(0f32, |peak, s| peak.max(s.abs()));
    let rms = (samples.iter().map(|s| f64::from(*s) * f64::from(*s)).sum::<f64>() / samples.len() as f64).sqrt();
    let kept = output_dir().join(format!("{name}.wav"));
    std::fs::write(&kept, &bytes).unwrap();
    eprintln!(
        "[{name}] {duration:.2}s @ {sample_rate} Hz, peak {peak:.3}, rms {rms:.4}, job {elapsed:.1}s, stats {}, readingsDropped {}, steps {progress:?} -> {}",
        outcome["stats"],
        outcome["readingsDropped"],
        kept.display()
    );
    assert!(seconds.contains(&duration), "{name}: {duration:.2}s is outside {seconds:?}");
    assert!(peak > 0.05, "{name}: peak {peak} is near silence");
    assert!(rms > 0.005, "{name}: rms {rms} is near silence");
    assert!(peak <= 1.0);

    let (_, status) = worker.call("worker.status", json!({}), QUICK);
    assert_eq!(result(&status)["state"], "ready");
    outcome
}

fn preset(id: &str) -> Value {
    json!({ "mode": "preset", "id": id })
}

#[test]
#[ignore = "needs installed models (BAOCUT_TEST_MODELS_DIR)"]
fn qwen3_tts_customvoice_speaks_with_a_model_speaker() {
    let mut worker = loaded_worker(
        "qwen3-tts-0.6b-customvoice@mlx-bf16",
        "qwen3-tts",
        "aufklarer/Qwen3-TTS-12Hz-0.6B-CustomVoice-MLX-bf16",
    );
    let request = Request {
        text: "你好，欢迎使用宝剪。今天我们来试一下本地语音合成。",
        language: Some("zh-CN"),
        voice: preset("Vivian"),
        input: None,
        instructions: None,
        seed: Some(7),
    };
    let outcome = synthesize(&mut worker, "qwen3-tts-customvoice-preset", &request, 1.5..=20.0);
    assert_eq!(outcome["readingsDropped"], json!([]));

    // 目录里的说话人名（`Uncle_Fu`、`Ono_Anna`）与模型的说话人表大小写不同；内置音色 id 就近换成最像的说话人。
    for (name, voice) in [
        ("qwen3-tts-customvoice-uncle-fu", "Uncle_Fu"),
        ("qwen3-tts-customvoice-ono-anna", "Ono_Anna"),
        ("qwen3-tts-customvoice-builtin-id", "zh-male"),
    ] {
        let request = Request {
            voice: preset(voice),
            ..request
        };
        synthesize(&mut worker, name, &request, 1.5..=20.0);
    }
}

#[test]
#[ignore = "needs installed models (BAOCUT_TEST_MODELS_DIR)"]
fn qwen3_tts_base_clones_a_reference_recording() {
    let mut worker = loaded_worker(
        "qwen3-tts-0.6b-base@mlx-8bit",
        "qwen3-tts",
        "aufklarer/Qwen3-TTS-12Hz-0.6B-Base-MLX-8bit",
    );
    let reference = fixture("test-sample.wav");
    let request = Request {
        text: "This voice was cloned from a short reference recording.",
        language: Some("en"),
        voice: json!({ "mode": "clone", "transcript": SAMPLE_TRANSCRIPT }),
        input: Some(&reference),
        instructions: None,
        seed: Some(7),
    };
    synthesize(&mut worker, "qwen3-tts-base-clone", &request, 1.5..=20.0);
}

#[test]
#[ignore = "needs installed models (BAOCUT_TEST_MODELS_DIR)"]
fn qwen3_tts_voicedesign_follows_a_description() {
    let mut worker = loaded_worker(
        "qwen3-tts-1.7b-voicedesign@mlx-8bit",
        "qwen3-tts",
        "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit",
    );
    let request = Request {
        text: "The weather is lovely today, so let's take a walk in the park.",
        language: Some("en"),
        voice: json!({ "mode": "describe", "description": "A calm, warm middle-aged male voice speaking slowly." }),
        input: None,
        instructions: None,
        seed: Some(7),
    };
    synthesize(&mut worker, "qwen3-tts-voicedesign-describe", &request, 1.5..=20.0);
}

#[test]
#[ignore = "needs installed models (BAOCUT_TEST_MODELS_DIR)"]
fn omnivoice_follows_a_vocabulary_description() {
    let mut worker = loaded_worker("omnivoice@mlx-int8", "omnivoice", "aufklarer/OmniVoice-MLX-int8");
    let request = Request {
        text: "Local speech synthesis runs entirely on this machine.",
        language: Some("en"),
        voice: json!({ "mode": "describe", "description": "female, low pitch" }),
        input: None,
        instructions: None,
        seed: Some(7),
    };
    synthesize(&mut worker, "omnivoice-describe", &request, 1.5..=20.0);
}

#[test]
#[ignore = "needs installed models (BAOCUT_TEST_MODELS_DIR)"]
fn voxcpm2_speaks_with_a_builtin_voice() {
    let mut worker = loaded_worker("voxcpm2@mlx-int8", "voxcpm2", "aufklarer/VoxCPM2-MLX-int8");
    let request = Request {
        text: "你好，这是宝剪的内置音色，用 VoxCPM2 在本机合成。",
        language: Some("zh-CN"),
        voice: preset("zh-female"),
        input: None,
        instructions: None,
        seed: Some(7),
    };
    synthesize(&mut worker, "voxcpm2-builtin", &request, 1.5..=20.0);
}

/// IndexTTS 2.5（主模型 + `aux` 组件）：内置音色，`<行|hang2>` 原样交给模型，不报 dropped。
#[test]
#[ignore = "needs installed models (BAOCUT_TEST_MODELS_DIR)"]
fn index_tts25_speaks_with_a_builtin_voice_and_keeps_readings() {
    let mut worker = loaded_worker("index-tts2.5@mlx-fp16", "indextts2.5", "mlx-community/IndexTTS-2.5-fp16");
    let request = Request {
        text: "你好，这是宝剪的内置音色。他在银<行|hang2>上班。",
        language: Some("zh-CN"),
        voice: preset("zh-female"),
        input: None,
        instructions: None,
        seed: Some(7),
    };
    let outcome = synthesize(&mut worker, "index-tts25-builtin", &request, 1.5..=20.0);
    assert_eq!(outcome["readingsDropped"], json!([]));
}

/// GPT-SoVITS 不认读音标注：`<行|hang2>` 按表面文字合成，并如实出现在 `readingsDropped` 里。
#[test]
#[ignore = "needs installed models (BAOCUT_TEST_MODELS_DIR)"]
fn gpt_sovits_speaks_with_a_builtin_voice_and_reports_dropped_readings() {
    let mut worker = loaded_worker("gpt-sovits-v2@mlx-fp16", "gpt-sovits", "PJMixers-Dev/lj1995_GPT-SoVITS-safetensors");
    let request = Request {
        text: "你好，这是宝剪的内置音色。他在银<行|hang2>上班。",
        language: Some("zh-CN"),
        voice: preset("zh-female"),
        input: None,
        instructions: None,
        seed: Some(7),
    };
    let outcome = synthesize(&mut worker, "gpt-sovits-builtin", &request, 1.5..=20.0);
    assert_eq!(
        outcome["readingsDropped"],
        json!([{ "start": 16, "end": 17, "reading": "hang2", "origin": "user" }])
    );
}

/// 合成中途 `job.cancel`：立即确认，`job.run` 以 `cancelled` 返回、没有输出，Worker 回到 ready，下一个任务照常完成。
#[test]
#[ignore = "needs installed models (BAOCUT_TEST_MODELS_DIR)"]
fn cancel_stops_synthesis_and_the_worker_stays_ready() {
    let mut worker = loaded_worker(
        "qwen3-tts-0.6b-customvoice@mlx-bf16",
        "qwen3-tts",
        "aufklarer/Qwen3-TTS-12Hz-0.6B-CustomVoice-MLX-bf16",
    );
    let staging = tempfile::tempdir().unwrap();
    let long = "这是一段比较长的文字，用来测试合成到一半时取消任务。".repeat(6);
    let request = Request {
        text: &long,
        language: Some("zh-CN"),
        voice: preset("Vivian"),
        input: None,
        instructions: None,
        seed: Some(7),
    };
    let run_id = worker.send("job.run", run_params("job-cancel", staging.path(), &request));
    let started = Instant::now();
    loop {
        let message = worker.next(JOB_TIMEOUT);
        assert_ne!(message["id"], run_id, "the job finished before it could be cancelled: {message}");
        if message["event"] == "job.phase" && message["params"]["phase"] == "synthesizing" {
            break;
        }
    }
    std::thread::sleep(Duration::from_millis(500));
    let cancel_id = worker.send("job.cancel", json!({ "jobId": "job-cancel" }));
    let cancelled_at = Instant::now();
    let mut acknowledged = false;
    let response = loop {
        let message = worker.next(JOB_TIMEOUT);
        if message["id"] == cancel_id {
            assert_eq!(result(&message)["acknowledged"], true);
            acknowledged = true;
        } else if message["id"] == run_id {
            break message;
        }
    };
    assert!(acknowledged, "job.cancel is acknowledged before job.run returns");
    let outcome = result(&response);
    assert_eq!(outcome["outcome"], "cancelled", "{response}");
    assert_eq!(outcome["output"], Value::Null);
    assert_eq!(outcome["audio"], Value::Null);
    assert!(!staging.path().join("speech.wav").exists());
    eprintln!(
        "[cancel] job ran {:.1}s, stopped {:.2}s after job.cancel",
        started.elapsed().as_secs_f64(),
        cancelled_at.elapsed().as_secs_f64()
    );
    let (_, status) = worker.call("worker.status", json!({}), QUICK);
    assert_eq!(result(&status)["state"], "ready");

    let short = Request {
        text: "取消之后再合成一次。",
        ..request
    };
    synthesize(&mut worker, "qwen3-tts-after-cancel", &short, 0.8..=15.0);
}

/// candle（CPU）上的 Qwen3-TTS：同一批仓库换成 `@candle` 的模型包，权重加载时换成 f32。
#[cfg(all(
    feature = "backend-candle",
    not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))
))]
fn candle_worker(bundle_id: &str, family: &str, repo: &str) -> Option<WorkerProcess> {
    if !is_installed(&models_root(), repo) {
        eprintln!("skipped: {repo} is not installed");
        return None;
    }
    let started = Instant::now();
    let mut worker = loaded_worker_with(on_candle(bundle(bundle_id, family, repo), bundle_id), family);
    let (_, status) = worker.call("worker.status", json!({}), QUICK);
    let memory = &result(&status)["memory"];
    eprintln!(
        "[{bundle_id}] loaded in {:.1}s; rss {} peak {}",
        started.elapsed().as_secs_f64(),
        memory["active"],
        memory["peak"]
    );
    Some(worker)
}

#[cfg(all(
    feature = "backend-candle",
    not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))
))]
#[test]
#[ignore = "needs installed models (BAOCUT_TEST_MODELS_DIR)"]
fn candle_qwen3_tts_base_clones_a_reference_recording() {
    let Some(mut worker) = candle_worker(
        "qwen3-tts-0.6b-base@candle",
        "qwen3-tts",
        "aufklarer/Qwen3-TTS-12Hz-0.6B-Base-MLX-8bit",
    ) else {
        return;
    };
    let reference = fixture("test-sample.wav");
    let request = Request {
        text: "This voice was cloned from a short reference recording.",
        language: Some("en"),
        voice: json!({ "mode": "clone", "transcript": SAMPLE_TRANSCRIPT }),
        input: Some(&reference),
        instructions: None,
        seed: Some(7),
    };
    synthesize(&mut worker, "candle-qwen3-tts-base-clone", &request, 1.5..=20.0);
}

#[cfg(all(
    feature = "backend-candle",
    not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))
))]
#[test]
#[ignore = "needs installed models (BAOCUT_TEST_MODELS_DIR)"]
fn candle_qwen3_tts_customvoice_speaks_with_a_model_speaker() {
    let Some(mut worker) = candle_worker(
        "qwen3-tts-0.6b-customvoice@candle",
        "qwen3-tts",
        "aufklarer/Qwen3-TTS-12Hz-0.6B-CustomVoice-MLX-bf16",
    ) else {
        return;
    };
    let request = Request {
        text: "你好，欢迎使用宝剪。今天我们来试一下本地语音合成。",
        language: Some("zh-CN"),
        voice: preset("Vivian"),
        input: None,
        instructions: None,
        seed: Some(7),
    };
    let outcome = synthesize(&mut worker, "candle-qwen3-tts-customvoice-preset", &request, 1.5..=20.0);
    assert_eq!(outcome["readingsDropped"], json!([]));
}
