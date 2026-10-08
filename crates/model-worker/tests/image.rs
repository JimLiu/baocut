//! 端到端：真实的文生图模型包，`worker.hello` → `model.load` → `job.run`（`image`）→ `image.png`。需要本机装好的模型，
//! 默认忽略：
//!
//! ```sh
//! BAOCUT_TEST_MODELS_DIR="$HOME/Library/Application Support/BaoCut/models" \
//!   cargo test -p model-worker --test image -- --ignored --test-threads=1 --nocapture
//! ```
//!
//! 生成的 PNG 留在 `BAOCUT_TEST_OUTPUT_DIR`（不给时是系统临时目录下的 `baocut-image-e2e/`），供人眼复核。
//! 模型目录只读：测试不写、不修模型包。

mod support;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use support::{WorkerProcess, model_files, result};

const LOAD_TIMEOUT: Duration = Duration::from_secs(120);
const JOB_TIMEOUT: Duration = Duration::from_secs(900);
const QUICK: Duration = Duration::from_secs(10);
const REPO: &str = "mlx-community/Qwen-Image-2.1-MLX-4bit";

fn models_root() -> PathBuf {
    PathBuf::from(std::env::var("BAOCUT_TEST_MODELS_DIR").expect("set BAOCUT_TEST_MODELS_DIR to the models root"))
}

fn output_dir() -> PathBuf {
    let dir = std::env::var_os("BAOCUT_TEST_OUTPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("baocut-image-e2e"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn run_params(job_id: &str, staging: &Path, seed: u64) -> Value {
    json!({
        "jobId": job_id,
        "runGeneration": 1,
        "capability": "image",
        "options": { "prompt": "a red apple on a wooden table", "width": 256, "height": 256, "steps": 2, "seed": seed },
        "staging": staging.to_string_lossy(),
        "outputContract": "baocut.image-png/v1",
    })
}

fn decode_png(bytes: &[u8]) -> (u32, u32, Vec<u8>) {
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder.read_info().unwrap();
    let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut pixels).unwrap();
    assert_eq!(info.color_type, png::ColorType::Rgba);
    assert_eq!(info.bit_depth, png::BitDepth::Eight);
    pixels.truncate(info.buffer_size());
    (info.width, info.height, pixels)
}

/// 跑一张，核对事件与结果，返回 PNG 字节。
fn generate(worker: &mut WorkerProcess, job_id: &str, seed: u64) -> Vec<u8> {
    let staging = tempfile::tempdir().unwrap();
    let started = Instant::now();
    let (events, response) = worker.call("job.run", run_params(job_id, staging.path(), seed), JOB_TIMEOUT);
    let run = result(&response);
    eprintln!("[{job_id}] job.run {:.1}s, stats {}", started.elapsed().as_secs_f64(), run["stats"]);
    assert_eq!(run["outcome"], "completed", "{run}");
    assert_eq!(
        run["image"],
        json!({ "width": 256, "height": 256, "format": "png", "seed": seed, "steps": 2 })
    );
    let phases: Vec<&str> = events
        .iter()
        .filter(|e| e["event"] == "job.phase")
        .map(|e| e["params"]["phase"].as_str().unwrap())
        .collect();
    assert_eq!(phases, ["encoding-prompt", "denoising", "decoding"]);
    let progress: Vec<(u64, u64)> = events
        .iter()
        .filter(|e| e["event"] == "job.progress")
        .map(|e| {
            assert_eq!(e["params"]["unit"], "steps");
            (e["params"]["done"].as_u64().unwrap(), e["params"]["total"].as_u64().unwrap())
        })
        .collect();
    assert_eq!(progress, [(0, 2), (1, 2), (2, 2)]);
    let output = &run["output"];
    let file = Path::new(output["path"].as_str().unwrap());
    assert_eq!(file, staging.path().join("image.png"));
    let bytes = std::fs::read(file).unwrap();
    assert_eq!(output["byteLength"], bytes.len());
    let hash: String = Sha256::digest(&bytes).iter().map(|byte| format!("{byte:02x}")).collect();
    assert_eq!(output["sha256"], hash);
    bytes
}

#[test]
#[ignore = "needs the installed Qwen-Image-2.1 bundle (BAOCUT_TEST_MODELS_DIR) and Metal"]
fn qwen_image_writes_a_deterministic_png() {
    let root = models_root();
    let mut worker = WorkerProcess::spawn();
    let (_, hello) = worker.call("worker.hello", json!({ "contractVersion": 1 }), QUICK);
    let hello = result(&hello);
    assert_eq!(hello["imageFamilies"], json!(["qwen-image"]), "{hello}");
    assert!(hello["capabilities"].as_array().unwrap().iter().any(|c| c == "image"));
    let bundle = json!({
        "bundleId": "qwen-image-2.1@mlx-4bit",
        "backend": "mlx",
        "device": "metal",
        "components": { "image": model_files(&root, REPO, "qwen-image") },
        "threads": 4,
        "memoryBudgetBytes": null,
    });
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
        "model.load: residentBytes {}, warmupMs {}",
        loaded["residentBytes"], loaded["warmupMs"]
    );

    let first = generate(&mut worker, "job-image-1", 7);
    let (width, height, pixels) = decode_png(&first);
    assert_eq!((width, height), (256, 256));
    let rgb = |i: usize| &pixels[i * 4..i * 4 + 3];
    assert!((1..256 * 256).any(|i| rgb(i) != rgb(0)), "the image must not be one flat colour");
    // Qwen-Image-2.1 的 VAE 出四个通道，第四个是模型自己给的 alpha（原样写进 PNG，与旧版一致）：只报告范围。
    let alpha = pixels.chunks_exact(4).map(|px| px[3]);
    let (lo, hi) = alpha.fold((255u8, 0u8), |(lo, hi), a| (lo.min(a), hi.max(a)));
    eprintln!("alpha range {lo}..={hi}");
    std::fs::write(output_dir().join("qwen-image-256-seed7.png"), &first).unwrap();

    // 同一 seed、同一机器：同一张图（逐字节）。
    let second = generate(&mut worker, "job-image-2", 7);
    assert_eq!(first, second, "a fixed seed must reproduce the same PNG");

    let (_, status) = worker.call("worker.status", json!({}), QUICK);
    let status = result(&status);
    assert_eq!(status["state"], "ready");
    eprintln!("worker.status memory after two jobs: {}", status["memory"]);
    let (_, response) = worker.call("model.unload", json!({}), LOAD_TIMEOUT);
    assert_eq!(result(&response)["unloaded"], true);
}
