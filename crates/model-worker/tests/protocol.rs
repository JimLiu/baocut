//! 协议层：不需要模型文件，在任何平台上都能跑。

mod support;

use std::time::{Duration, Instant};

use serde_json::{Value, json};
use support::{WorkerProcess, error_code, result};

const TIMEOUT: Duration = Duration::from_secs(10);

/// 合成主模型的全部 family（`packages/models` 的 `ModelFamily` 里 tts 那几个）。
const SYNTHESIS_FAMILIES: [&str; 6] = ["qwen3-tts", "indextts2", "indextts2.5", "gpt-sovits", "voxcpm2", "omnivoice"];

/// 识别主模型的全部 family（`packages/models` 的 `ModelFamily` 里 asr 那几个）。
const TRANSCRIPTION_FAMILIES: [&str; 5] = [
    "qwen3-asr",
    "whisper-mlx",
    "whisper-coreml",
    "whisper-ggml",
    "moss-transcribe-diarize",
];

/// 文生图的全部 family（`packages/models` 的 `ModelFamily` 里 image 那几个）。
const IMAGE_FAMILIES: [&str; 1] = ["qwen-image"];

#[test]
fn hello_reports_version_backends_and_capabilities() {
    let mut worker = WorkerProcess::spawn();
    let (events, response) = worker.call("worker.hello", json!({ "contractVersion": 1 }), TIMEOUT);
    assert!(events.is_empty());
    let hello = result(&response);
    assert_eq!(hello["contractVersion"], 1);
    assert_eq!(hello["workerVersion"], env!("CARGO_PKG_VERSION"));
    assert!(hello["pid"].as_u64().is_some_and(|pid| pid > 0));
    // 合成按 family 声明：能加载的列在 synthesizeFamilies，有一个就声明 synthesize 能力。
    let families: Vec<&str> = hello["synthesizeFamilies"]
        .as_array()
        .expect("synthesizeFamilies is always present")
        .iter()
        .map(|family| family.as_str().unwrap())
        .collect();
    assert!(families.iter().all(|family| SYNTHESIS_FAMILIES.contains(family)), "{families:?}");
    // 识别同样按 family 声明（`asr` 组件的 family）。
    let transcribe: Vec<&str> = hello["transcribeFamilies"]
        .as_array()
        .expect("transcribeFamilies is always present")
        .iter()
        .map(|family| family.as_str().unwrap())
        .collect();
    assert!(
        transcribe.iter().all(|family| TRANSCRIPTION_FAMILIES.contains(family)),
        "{transcribe:?}"
    );
    let mut expected = Vec::new();
    if !transcribe.is_empty() {
        expected.push("transcribe");
    }
    // 对齐器接在 MLX 与 candle 上：Apple Silicon 的构建与带 candle 的构建声明 `align`。
    if cfg!(any(
        all(target_os = "macos", target_arch = "aarch64", feature = "backend-mlx"),
        feature = "backend-candle"
    )) {
        expected.push("align");
        // 说话人区分（Pyannote + WeSpeaker）同样接在 MLX 与 candle 上。
        expected.push("diarize");
    }
    if !families.is_empty() {
        expected.push("synthesize");
    }
    // 分离同样按 family 声明（`separator` 组件的 family）：MLX 与 candle 的构建都接上了 HTDemucs-FT。
    let separate: Vec<&str> = hello["separateFamilies"]
        .as_array()
        .expect("separateFamilies is always present")
        .iter()
        .map(|family| family.as_str().unwrap())
        .collect();
    if cfg!(any(
        all(target_os = "macos", target_arch = "aarch64", feature = "backend-mlx"),
        feature = "backend-candle"
    )) {
        assert_eq!(separate, ["htdemucs-ft"]);
    } else {
        assert!(separate.is_empty(), "{separate:?}");
    }
    if !separate.is_empty() {
        expected.push("separate");
    }
    // 文生图同样按 family 声明（`image` 组件的 family）。
    let image: Vec<&str> = hello["imageFamilies"]
        .as_array()
        .expect("imageFamilies is always present")
        .iter()
        .map(|family| family.as_str().unwrap())
        .collect();
    assert!(image.iter().all(|family| IMAGE_FAMILIES.contains(family)), "{image:?}");
    if !image.is_empty() {
        expected.push("image");
    }
    assert_eq!(hello["capabilities"], json!(expected));
    #[cfg(all(target_os = "macos", target_arch = "aarch64", feature = "backend-mlx"))]
    {
        for family in ["qwen3-tts", "voxcpm2", "omnivoice", "gpt-sovits"] {
            assert!(families.contains(&family), "{family} is wired on Apple Silicon: {families:?}");
        }
        let mut wired = vec!["qwen3-asr", "whisper-mlx"];
        if cfg!(feature = "backend-coreml") {
            wired.push("whisper-coreml");
        }
        if cfg!(feature = "whisper-ggml") {
            wired.push("whisper-ggml");
        }
        wired.push("moss-transcribe-diarize");
        assert_eq!(transcribe, wired);
        assert_eq!(image, ["qwen-image"]);
    }
    // candle 编进来时 Qwen3-ASR、MOSS 与 Qwen-Image 在任何平台都能加载（macOS 上也报，由 Runtime 决定登不登记 candle 模型包）。
    #[cfg(feature = "backend-candle")]
    {
        let mut wired = vec!["qwen3-asr"];
        if cfg!(all(target_os = "macos", target_arch = "aarch64", feature = "backend-mlx")) {
            wired.push("whisper-mlx");
        }
        if cfg!(all(target_os = "macos", target_arch = "aarch64", feature = "backend-coreml")) {
            wired.push("whisper-coreml");
        }
        if cfg!(feature = "whisper-ggml") {
            wired.push("whisper-ggml");
        }
        wired.push("moss-transcribe-diarize");
        assert_eq!(transcribe, wired);
        assert_eq!(image, ["qwen-image"]);
    }
    let backends = hello["backends"].as_array().unwrap();
    let ids: Vec<&str> = backends.iter().map(|backend| backend["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["mlx", "coreml", "candle", "ggml"]);
    for backend in backends {
        assert!(backend["devices"].is_array());
        if backend["available"] == false {
            assert!(backend["reason"].is_string(), "unavailable backends carry a reason: {backend}");
        }
    }
    // CoreML 编进来时与 MLX 一样看 Metal（VAD 在 MLX 上）：可用时设备是 `ane`。
    if cfg!(all(target_os = "macos", target_arch = "aarch64", feature = "backend-coreml")) {
        assert_eq!(backends[1]["available"], backends[0]["available"]);
        if backends[1]["available"] == true {
            assert_eq!(backends[1]["devices"], json!(["ane"]));
        }
    } else {
        assert_eq!(backends[1]["reason"], "not-compiled");
    }
    if cfg!(feature = "backend-candle") {
        // candle 不挑机器：可用，CPU 总在设备列表最后（有 CUDA 时排在前面）。
        assert_eq!(backends[2]["available"], true);
        assert_eq!(backends[2]["devices"].as_array().unwrap().last(), Some(&json!("cpu")));
    } else {
        assert_eq!(backends[2]["reason"], "not-compiled");
    }
    if cfg!(feature = "whisper-ggml") {
        // ggml 同样不挑机器：CPU 总在最后，前面至多一个 GPU（`cuda` 或 `vulkan`）。
        assert_eq!(backends[3]["available"], true);
        let devices = backends[3]["devices"].as_array().unwrap();
        assert_eq!(devices.last(), Some(&json!("cpu")));
        assert!(devices.len() <= 2, "{devices:?}");
        assert!(
            devices
                .iter()
                .all(|device| device == "cpu" || device == "cuda" || device == "vulkan"),
            "{devices:?}"
        );
    } else {
        assert_eq!(backends[3]["reason"], "not-compiled");
    }
}

#[test]
fn contract_mismatch_is_rejected() {
    let mut worker = WorkerProcess::spawn();
    let (_, response) = worker.call("worker.hello", json!({ "contractVersion": 2 }), TIMEOUT);
    assert_eq!(error_code(&response), "CONTRACT_MISMATCH");
    assert_eq!(response["error"]["retryable"], false);
}

#[test]
fn unknown_methods_and_bad_params_are_protocol_errors() {
    let mut worker = WorkerProcess::spawn();
    let (_, response) = worker.call("worker.dance", json!({}), TIMEOUT);
    assert_eq!(error_code(&response), "UNKNOWN_METHOD");

    let (_, response) = worker.call("worker.hello", json!({ "contractVersion": "one" }), TIMEOUT);
    assert_eq!(error_code(&response), "INVALID_PARAMS");
    let (_, response) = worker.call("worker.hello", json!({ "contractVersion": 1, "extra": true }), TIMEOUT);
    assert_eq!(error_code(&response), "INVALID_PARAMS");
    let (_, response) = worker.call("job.cancel", json!({}), TIMEOUT);
    assert_eq!(error_code(&response), "INVALID_PARAMS");

    // 解析不了的行没有 id 可回：记日志、跳过，之后照常工作。
    worker.send_raw("{not json");
    let (_, response) = worker.call("worker.status", json!({}), TIMEOUT);
    assert_eq!(result(&response)["state"], "empty");
}

#[test]
fn job_run_before_load_is_a_state_error() {
    let mut worker = WorkerProcess::spawn();
    let staging = tempfile::tempdir().unwrap();
    let params = json!({
        "jobId": "job-1",
        "runGeneration": 1,
        "capability": "transcribe",
        "input": { "file": support::fixture("test-sample.wav").to_string_lossy(), "contentHash": "sha256:00", "track": 0 },
        "options": { "language": { "mode": "prefer", "tag": null }, "diarize": false, "timescale": 1_000_000 },
        "staging": staging.path().to_string_lossy(),
        "outputContract": "baocut.asr-result/v1",
    });
    let (events, response) = worker.call("job.run", params, TIMEOUT);
    assert!(events.is_empty());
    assert_eq!(error_code(&response), "WORKER_BUSY");
    assert_eq!(response["error"]["details"]["state"], "empty");

    let (_, response) = worker.call("job.cancel", json!({ "jobId": "job-1" }), TIMEOUT);
    assert_eq!(error_code(&response), "NOT_FOUND");
    let (_, response) = worker.call("model.unload", json!({}), TIMEOUT);
    assert_eq!(result(&response)["unloaded"], true);

    let (_, response) = worker.call("worker.status", json!({}), TIMEOUT);
    assert_eq!(
        result(&response),
        &json!({ "state": "empty", "bundleId": null, "job": null, "memory": null })
    );
}

#[test]
fn missing_model_files_are_not_installed() {
    let mut worker = WorkerProcess::spawn();
    let models = tempfile::tempdir().unwrap();
    std::fs::write(models.path().join("config.json"), b"{}").unwrap();
    let files = |list: &[(&str, u64)]| -> Value {
        list.iter()
            .map(|(path, size)| json!({ "path": path, "sha256": "0".repeat(64), "byteLength": size }))
            .collect()
    };
    let bundle = json!({
        "bundleId": "test@mlx",
        "backend": "mlx",
        "device": "metal",
        "components": {
            "asr": { "family": "qwen3-asr", "revision": "r1", "dir": models.path().to_string_lossy(),
                     "files": files(&[("config.json", 2), ("model.safetensors", 1024)]) },
            "vad": { "family": "silero-vad", "revision": "r1", "dir": models.path().to_string_lossy(),
                     "files": files(&[("config.json", 2)]) },
        },
        "threads": 2,
        "memoryBudgetBytes": null,
    });
    let (events, response) = worker.call("model.load", json!({ "bundle": bundle }), TIMEOUT);
    assert!(events.is_empty(), "no phases before the files are verified: {events:?}");
    assert_eq!(error_code(&response), "MODEL_NOT_INSTALLED");
    let details = &response["error"]["details"];
    assert_eq!(details["component"], "asr");
    assert_eq!(details["file"], "model.safetensors");
    assert_eq!(details["reason"], "missing");
    let message = response["error"]["message"].as_str().unwrap();
    assert!(
        !message.contains(&*models.path().to_string_lossy()),
        "messages never carry absolute paths: {message}"
    );

    // 失败的加载不留状态。
    let (_, response) = worker.call("worker.status", json!({}), TIMEOUT);
    assert_eq!(result(&response)["state"], "empty");
}

/// 合成参数照常先检查；没列在 `synthesizeFamilies` 里的 family 加载时是结构化的 `MODEL_UNSUPPORTED`（`not-wired`），
/// 列着的 family 照常核对文件（缺文件不是 `not-wired`）；失败的加载都不留状态。
#[test]
fn synthesis_is_checked_and_unlisted_families_are_not_wired() {
    let mut worker = WorkerProcess::spawn();
    let (_, response) = worker.call("worker.hello", json!({ "contractVersion": 1 }), TIMEOUT);
    let listed: Vec<String> = result(&response)["synthesizeFamilies"]
        .as_array()
        .unwrap()
        .iter()
        .map(|family| family.as_str().unwrap().to_owned())
        .collect();
    let staging = tempfile::tempdir().unwrap();
    let run = |voice: Value| {
        json!({
            "jobId": "job-tts",
            "runGeneration": 1,
            "capability": "synthesize",
            "input": null,
            "options": { "text": "hello", "language": null, "voice": voice, "instructions": null,
                         "speed": null, "cfg": null, "steps": null, "seed": null },
            "staging": staging.path().to_string_lossy(),
            "outputContract": "baocut.speech-wav/v1",
        })
    };
    // clone 没有参考录音：参数错，先于状态检查。
    let (_, response) = worker.call("job.run", run(json!({ "mode": "clone", "transcript": null })), TIMEOUT);
    assert_eq!(error_code(&response), "INVALID_PARAMS");
    let (_, response) = worker.call("job.run", run(json!({ "mode": "preset", "id": "a" })), TIMEOUT);
    assert_eq!(error_code(&response), "WORKER_BUSY");

    let models = tempfile::tempdir().unwrap();
    std::fs::write(models.path().join("model.safetensors"), b"1234").unwrap();
    let component = |family: &str| {
        json!({ "family": family, "revision": "r1", "dir": models.path().to_string_lossy(),
                "files": [{ "path": "model.safetensors", "sha256": "0".repeat(64), "byteLength": 4 }] })
    };
    let bundle = |family: &str| {
        let mut components = json!({ "tts": component(family) });
        if family == "qwen3-tts" {
            components["codec"] = component("qwen3-tts-tokenizer");
        }
        json!({ "bundle": {
            "bundleId": format!("{family}@test"),
            "backend": "mlx",
            "device": "metal",
            "components": components,
            "threads": 2,
            "memoryBudgetBytes": null,
        } })
    };
    for family in SYNTHESIS_FAMILIES {
        let (_, response) = worker.call("model.load", bundle(family), Duration::from_secs(60));
        assert!(
            response["error"].is_object(),
            "{family}: a four-byte weight file never loads: {response}"
        );
        assert_eq!(response["error"]["retryable"], false, "{family}: {response}");
        let reason = &response["error"]["details"]["reason"];
        if listed.iter().any(|listed| listed == family) {
            assert_ne!(reason, "not-wired", "{family} is listed in hello: {response}");
        } else {
            assert_eq!(error_code(&response), "MODEL_UNSUPPORTED");
            assert_eq!(
                response["error"]["details"],
                json!({ "capability": "synthesize", "reason": "not-wired", "family": family })
            );
        }
        let (_, response) = worker.call("worker.status", json!({}), TIMEOUT);
        assert_eq!(result(&response)["state"], "empty", "{family}");
    }
}

/// 分离参数照常先检查（形状 → `INVALID_PARAMS`，没有模型 → `WORKER_BUSY`）；分离的模型包只带 `separator`，
/// 缺文件是 `MODEL_NOT_INSTALLED`、带了别的组件是 `MODEL_UNSUPPORTED`，失败的加载都不留状态。
#[test]
fn separation_is_checked_before_and_at_load() {
    let mut worker = WorkerProcess::spawn();
    let (_, response) = worker.call("worker.hello", json!({ "contractVersion": 1 }), TIMEOUT);
    let wired = !result(&response)["separateFamilies"].as_array().unwrap().is_empty();
    let staging = tempfile::tempdir().unwrap();
    let run = |options: Value| {
        json!({
            "jobId": "job-sep",
            "runGeneration": 1,
            "capability": "separate",
            "input": { "file": "/media/a.mp4", "contentHash": "sha256:ab", "track": 0 },
            "options": options,
            "staging": staging.path().to_string_lossy(),
            "outputContract": "baocut.stems-wav/v1",
        })
    };
    let (_, response) = worker.call("job.run", run(json!({ "sampleRate": 1 })), TIMEOUT);
    assert_eq!(error_code(&response), "INVALID_PARAMS");
    let (_, response) = worker.call("job.run", run(json!({ "sampleRate": 48_000, "stems": 4 })), TIMEOUT);
    assert_eq!(error_code(&response), "INVALID_PARAMS");
    let (_, response) = worker.call("job.run", run(json!({ "sampleRate": 48_000 })), TIMEOUT);
    assert_eq!(error_code(&response), "WORKER_BUSY");

    let models = tempfile::tempdir().unwrap();
    std::fs::write(models.path().join("htdemucs_ft.safetensors"), b"1234").unwrap();
    let component =
        |family: &str, files: Value| json!({ "family": family, "revision": "r1", "dir": models.path().to_string_lossy(), "files": files });
    let weights = json!([{ "path": "htdemucs_ft.safetensors", "sha256": "0".repeat(64), "byteLength": 4 }]);
    // 编进来的后端：Apple Silicon 带 MLX 时用 MLX，否则带 candle 时用 candle 的 CPU；都没有时按 MLX 的模型包报 not-wired。
    let (backend, device) = if cfg!(all(target_os = "macos", target_arch = "aarch64", feature = "backend-mlx")) {
        ("mlx", "metal")
    } else if cfg!(feature = "backend-candle") {
        ("candle", "cpu")
    } else {
        ("mlx", "metal")
    };
    let bundle = |components: Value| {
        json!({ "bundle": {
            "bundleId": "htdemucs-ft@test",
            "backend": backend,
            "device": device,
            "components": components,
            "threads": 2,
            "memoryBudgetBytes": null,
        } })
    };
    // 清单里有、磁盘上没有的文件：校验阶段就是 MODEL_NOT_INSTALLED，与后端无关。
    let missing = json!([{ "path": "htdemucs_ft_config.json", "sha256": "0".repeat(64), "byteLength": 2158 }]);
    let (_, response) = worker.call(
        "model.load",
        bundle(json!({ "separator": component("htdemucs-ft", missing) })),
        Duration::from_secs(60),
    );
    assert_eq!(error_code(&response), "MODEL_NOT_INSTALLED", "{response}");

    // 带了识别的组件：分离的模型包不收。
    let (_, response) = worker.call(
        "model.load",
        bundle(json!({ "separator": component("htdemucs-ft", weights.clone()), "vad": component("silero-vad", weights.clone()) })),
        Duration::from_secs(60),
    );
    assert_eq!(error_code(&response), "MODEL_UNSUPPORTED", "{response}");
    let expected_reason = if wired { "unexpected-component" } else { "not-wired" };
    assert_eq!(response["error"]["details"]["reason"], expected_reason, "{response}");

    // 文件齐了但配置缺：后端读不到 htdemucs_ft_config.json（清单里没有它），不是 not-wired。
    let (_, response) = worker.call(
        "model.load",
        bundle(json!({ "separator": component("htdemucs-ft", weights) })),
        Duration::from_secs(60),
    );
    assert!(response["error"].is_object(), "{response}");
    if wired {
        assert_eq!(error_code(&response), "MODEL_NOT_INSTALLED", "{response}");
    }
    let (_, response) = worker.call("worker.status", json!({}), TIMEOUT);
    assert_eq!(result(&response)["state"], "empty");
}

/// 文生图参数照常先检查；列在 `imageFamilies` 里的 family 加载时照常核对文件（缺文件是 `MODEL_NOT_INSTALLED`），
/// 没列的是 `not-wired`；模型包不能混带别的组件。失败的加载都不留状态。
#[test]
fn image_is_checked_and_unlisted_families_are_not_wired() {
    let mut worker = WorkerProcess::spawn();
    let (_, response) = worker.call("worker.hello", json!({ "contractVersion": 1 }), TIMEOUT);
    let listed = result(&response)["imageFamilies"]
        .as_array()
        .unwrap()
        .iter()
        .any(|family| family == "qwen-image");
    let staging = tempfile::tempdir().unwrap();
    let run = |prompt: &str, width: u32| {
        json!({
            "jobId": "job-image",
            "runGeneration": 1,
            "capability": "image",
            "options": { "prompt": prompt, "width": width, "height": 256, "steps": null, "seed": 7 },
            "staging": staging.path().to_string_lossy(),
            "outputContract": "baocut.image-png/v1",
        })
    };
    // 空提示词与零宽：参数错，先于状态检查。
    let (_, response) = worker.call("job.run", run("", 256), TIMEOUT);
    assert_eq!(error_code(&response), "INVALID_PARAMS");
    let (_, response) = worker.call("job.run", run("a cat", 0), TIMEOUT);
    assert_eq!(error_code(&response), "INVALID_PARAMS");
    let mut wrong_contract = run("a cat", 256);
    wrong_contract["outputContract"] = json!("baocut.speech-wav/v1");
    let (_, response) = worker.call("job.run", wrong_contract, TIMEOUT);
    assert_eq!(error_code(&response), "INVALID_PARAMS");
    let (_, response) = worker.call("job.run", run("a cat", 256), TIMEOUT);
    assert_eq!(error_code(&response), "WORKER_BUSY");

    let models = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(models.path().join("processor")).unwrap();
    std::fs::write(models.path().join("processor/tokenizer.json"), b"{}").unwrap();
    let component = |family: &str| {
        json!({ "family": family, "revision": "r1", "dir": models.path().to_string_lossy(),
                "files": [{ "path": "processor/tokenizer.json", "sha256": "0".repeat(64), "byteLength": 2 }] })
    };
    // 编进来的后端（MLX 只有 Apple Silicon；candle 任何平台）各自都核对文件；都没有时按 MLX 的模型包报 not-wired。
    let mut backends: Vec<(&str, &str)> = Vec::new();
    if cfg!(all(target_os = "macos", target_arch = "aarch64", feature = "backend-mlx")) {
        backends.push(("mlx", "metal"));
    }
    if cfg!(feature = "backend-candle") {
        backends.push(("candle", "cpu"));
    }
    let (backend, device) = backends.first().copied().unwrap_or(("mlx", "metal"));
    let load_on = |components: Value, backend: &str, device: &str| {
        json!({ "bundle": {
            "bundleId": "qwen-image@test",
            "backend": backend,
            "device": device,
            "components": components,
            "threads": 2,
            "memoryBudgetBytes": 1,
        } })
    };
    let load = |components: Value| load_on(components, backend, device);
    // 认不出的 family。
    let (_, response) = worker.call("model.load", load(json!({ "image": component("stable-diffusion") })), TIMEOUT);
    assert_eq!(error_code(&response), "MODEL_UNSUPPORTED");
    assert_eq!(response["error"]["details"]["reason"], "unknown-family", "{response}");
    // 混带识别组件。
    if listed {
        let (_, response) = worker.call(
            "model.load",
            load(json!({ "image": component("qwen-image"), "vad": component("silero-vad") })),
            TIMEOUT,
        );
        assert_eq!(error_code(&response), "MODEL_UNSUPPORTED");
        assert_eq!(response["error"]["details"]["reason"], "unexpected-component", "{response}");
    }
    // 只列了分词表：缺调度器配置是 MODEL_NOT_INSTALLED（权重总量不按 memoryBudgetBytes 查，见 §4.2）；没接上是 not-wired。
    assert_eq!(listed, !backends.is_empty(), "{backends:?}");
    for (backend, device) in &backends {
        let (_, response) = worker.call(
            "model.load",
            load_on(json!({ "image": component("qwen-image") }), backend, device),
            Duration::from_secs(60),
        );
        assert_eq!(error_code(&response), "MODEL_NOT_INSTALLED", "{backend}: {response}");
    }
    if backends.is_empty() {
        let (_, response) = worker.call(
            "model.load",
            load(json!({ "image": component("qwen-image") })),
            Duration::from_secs(60),
        );
        assert!(!listed);
        assert_eq!(error_code(&response), "MODEL_UNSUPPORTED");
        assert_eq!(
            response["error"]["details"],
            json!({ "capability": "image", "reason": "not-wired", "family": "qwen-image" })
        );
    }
    let (_, response) = worker.call("worker.status", json!({}), TIMEOUT);
    assert_eq!(result(&response)["state"], "empty");
}

#[test]
fn stdin_eof_exits_promptly() {
    let mut worker = WorkerProcess::spawn();
    let _ = worker.call("worker.hello", json!({ "contractVersion": 1 }), TIMEOUT);
    worker.close_stdin();
    let status = worker.wait_exit(Duration::from_secs(2)).expect("exits within 2 s of stdin EOF");
    assert!(status.success(), "{status:?}");
}

#[test]
fn a_dead_parent_makes_the_worker_exit() {
    // 一个已经退出的进程的 PID：它不是 worker 的父进程，看护线程第一次检查就会发现。
    let mut short_lived = std::process::Command::new(if cfg!(windows) { "cmd" } else { "true" });
    if cfg!(windows) {
        short_lived.args(["/C", "exit"]);
    }
    let mut child = short_lived.spawn().unwrap();
    let dead_pid = child.id();
    child.wait().unwrap();

    let started = Instant::now();
    let mut worker = WorkerProcess::spawn_with_parent(dead_pid);
    // stdin 保持打开：退出只能来自看护。
    let status = worker.wait_exit(Duration::from_secs(6));
    if cfg!(unix) {
        let status = status.expect("exits once the parent is gone");
        assert!(status.success(), "{status:?}");
        assert!(started.elapsed() < Duration::from_secs(5), "took {:?}", started.elapsed());
    }
}

#[test]
fn oversized_lines_are_a_fatal_protocol_error() {
    let mut worker = WorkerProcess::spawn();
    let huge = format!(
        "{{\"id\":1,\"method\":\"worker.hello\",\"params\":{{\"pad\":\"{}\"}}}}",
        "x".repeat(16 * 1024 * 1024 + 16)
    );
    // worker 读满上限就退出，剩下的写入可能撞上断开的管道。
    let _ = worker.try_send_raw(&huge);
    let status = worker.wait_exit(Duration::from_secs(5)).expect("exits on an oversized line");
    assert!(!status.success());
}

/// 识别按 `asr` 的 family 选加载器：没列在 `transcribeFamilies` 里、形状合规的模型包加载时是结构化的
/// `MODEL_UNSUPPORTED`（`not-wired`）；形状不合（MOSS 带了 VAD）照常报组件。失败的加载都不留状态。
#[test]
fn unlisted_transcription_families_are_not_wired() {
    let mut worker = WorkerProcess::spawn();
    let (_, response) = worker.call("worker.hello", json!({ "contractVersion": 1 }), TIMEOUT);
    let listed = result(&response)["transcribeFamilies"].clone();
    let models = tempfile::tempdir().unwrap();
    std::fs::write(models.path().join("model.safetensors"), b"1234").unwrap();
    let component = |family: &str| {
        json!({ "family": family, "revision": "r1", "dir": models.path().to_string_lossy(),
                "files": [{ "path": "model.safetensors", "sha256": "0".repeat(64), "byteLength": 4 }] })
    };
    let load = |worker: &mut WorkerProcess, backend: &str, components: Value| {
        let bundle = json!({ "bundle": {
            "bundleId": "asr@test", "backend": backend, "device": "metal", "components": components,
            "threads": 2, "memoryBudgetBytes": null,
        } });
        let (_, response) = worker.call("model.load", bundle, TIMEOUT);
        let (_, status) = worker.call("worker.status", json!({}), TIMEOUT);
        assert_eq!(result(&status)["state"], "empty");
        assert_eq!(error_code(&response), "MODEL_UNSUPPORTED", "{response}");
        response["error"]["details"].clone()
    };
    let whisper = json!({
        "asr": component("whisper-coreml"), "vad": component("silero-vad"), "tokenizer": component("whisper-tokenizer"),
    });
    let whisper_mlx = json!({
        "asr": component("whisper-mlx"), "vad": component("silero-vad"), "tokenizer": component("whisper-tokenizer"),
    });
    let moss = json!({ "asr": component("moss-transcribe-diarize"), "speaker": component("wespeaker") });
    let ggml = json!({ "asr": component("whisper-ggml"), "vad": component("silero-vad") });
    for (family, backend, components) in [
        ("whisper-mlx", "mlx", whisper_mlx),
        ("whisper-coreml", "coreml", whisper),
        ("moss-transcribe-diarize", "mlx", moss),
        ("whisper-ggml", "ggml", ggml),
    ] {
        if listed.as_array().unwrap().iter().any(|listed| listed == family) {
            continue;
        }
        assert_eq!(
            load(&mut worker, backend, components),
            json!({ "capability": "transcribe", "reason": "not-wired", "family": family })
        );
    }
    let moss_with_vad = json!({ "asr": component("moss-transcribe-diarize"), "vad": component("silero-vad") });
    let details = load(&mut worker, "mlx", moss_with_vad);
    assert_eq!(
        (&details["component"], &details["reason"]),
        (&json!("vad"), &json!("unexpected-component"))
    );
}

/// Whisper（CoreML）的加载器按清单取文件：`.mlmodelc` 是目录，没列出就是 `MODEL_NOT_INSTALLED`，点名缺的目录；
/// 设备不是 `ane` 先被拒。都在读任何权重之前，失败的加载不留状态。
#[cfg(all(target_os = "macos", target_arch = "aarch64", feature = "backend-coreml"))]
#[test]
fn whisper_bundles_name_the_missing_model_directory() {
    let mut worker = WorkerProcess::spawn();
    let (_, response) = worker.call("worker.hello", json!({ "contractVersion": 1 }), TIMEOUT);
    if result(&response)["backends"][1]["available"] != true {
        eprintln!("skipped: no Metal device");
        return;
    }
    let models = tempfile::tempdir().unwrap();
    std::fs::write(models.path().join("model.safetensors"), b"1234").unwrap();
    std::fs::create_dir(models.path().join("AudioEncoder.mlmodelc")).unwrap();
    std::fs::write(models.path().join("AudioEncoder.mlmodelc/model.mil"), b"1234").unwrap();
    let component = |family: &str, path: &str| {
        json!({ "family": family, "revision": "r1", "dir": models.path().to_string_lossy(),
                "files": [{ "path": path, "sha256": "0".repeat(64), "byteLength": 4 }] })
    };
    let components = json!({
        "asr": component("whisper-coreml", "AudioEncoder.mlmodelc/model.mil"),
        "vad": component("silero-vad", "model.safetensors"),
        "tokenizer": component("whisper-tokenizer", "model.safetensors"),
    });
    let mut load = |device: &str| {
        let bundle = json!({ "bundle": {
            "bundleId": "whisper@test", "backend": "coreml", "device": device, "components": components,
            "threads": 2, "memoryBudgetBytes": null,
        } });
        let (_, response) = worker.call("model.load", bundle, TIMEOUT);
        let (_, status) = worker.call("worker.status", json!({}), TIMEOUT);
        assert_eq!(result(&status)["state"], "empty");
        response
    };
    let response = load("metal");
    assert_eq!(error_code(&response), "MODEL_UNSUPPORTED", "{response}");
    assert_eq!(response["error"]["details"]["reason"], "unsupported-device");
    let response = load("ane");
    assert_eq!(error_code(&response), "MODEL_NOT_INSTALLED", "{response}");
    assert_eq!(
        response["error"]["details"],
        json!({ "component": "asr", "file": "MelSpectrogram.mlmodelc/", "reason": "not-listed" })
    );
}

/// Whisper（MLX）的加载器按清单取文件：`generation_config.json` 在分词器组件里（mlx-community 的仓库没有它），没列出就是
/// `MODEL_NOT_INSTALLED`，点名组件与文件；`config.json` 的形状不是 Whisper large-v3 的是 `unsupported-config`。都在读任何
/// 权重之前，失败的加载不留状态。
#[cfg(all(target_os = "macos", target_arch = "aarch64", feature = "backend-mlx"))]
#[test]
fn whisper_mlx_bundles_name_the_missing_file() {
    let mut worker = WorkerProcess::spawn();
    let (_, response) = worker.call("worker.hello", json!({ "contractVersion": 1 }), TIMEOUT);
    if result(&response)["backends"][0]["available"] != true {
        eprintln!("skipped: no Metal device");
        return;
    }
    let models = tempfile::tempdir().unwrap();
    let config = json!({
        "n_mels": 128, "n_audio_ctx": 1500, "n_audio_state": 1280, "n_audio_head": 20, "n_audio_layer": 32,
        "n_vocab": 51866, "n_text_ctx": 448, "n_text_state": 1280, "n_text_head": 20, "n_text_layer": 4,
    });
    let file = |path: &str, bytes: &[u8]| {
        std::fs::write(models.path().join(path), bytes).unwrap();
        json!({ "path": path, "sha256": "0".repeat(64), "byteLength": bytes.len() })
    };
    let config_file = file("config.json", config.to_string().as_bytes());
    let weights = file("model.safetensors", b"1234");
    let tokenizer = file("tokenizer.json", b"{}");
    let component = |family: &str, files: Vec<&Value>| json!({ "family": family, "revision": "r1", "dir": models.path().to_string_lossy(), "files": files });
    let mut load = |asr_files: Vec<&Value>| {
        let bundle = json!({ "bundle": {
            "bundleId": "whisper@test", "backend": "mlx", "device": "metal",
            "components": {
                "asr": component("whisper-mlx", asr_files),
                "vad": component("silero-vad", vec![&weights]),
                "tokenizer": component("whisper-tokenizer", vec![&tokenizer]),
            },
            "threads": 2, "memoryBudgetBytes": null,
        } });
        let (_, response) = worker.call("model.load", bundle, TIMEOUT);
        let (_, status) = worker.call("worker.status", json!({}), TIMEOUT);
        assert_eq!(result(&status)["state"], "empty");
        response
    };
    let response = load(vec![&config_file, &weights]);
    assert_eq!(error_code(&response), "MODEL_NOT_INSTALLED", "{response}");
    assert_eq!(
        response["error"]["details"],
        json!({ "component": "tokenizer", "file": "generation_config.json", "reason": "not-listed" })
    );
    let response = load(vec![&weights]);
    assert_eq!(error_code(&response), "MODEL_NOT_INSTALLED", "{response}");
    assert_eq!(
        response["error"]["details"],
        json!({ "component": "asr", "file": "config.json", "reason": "not-listed" })
    );
    let wrong_config = file("config.json", br#"{"n_mels": 80}"#);
    let response = load(vec![&wrong_config, &weights]);
    assert_eq!(error_code(&response), "MODEL_UNSUPPORTED", "{response}");
    assert_eq!(response["error"]["details"]["reason"], "unsupported-config");
}

/// MOSS 的加载器按清单取文件：可选的对齐器与说话人模型缺文件同样是 `MODEL_NOT_INSTALLED`（不悄悄退回估计的词时间或
/// 不合并的说话人），都在读任何权重之前；失败的加载不留状态。
#[cfg(all(target_os = "macos", target_arch = "aarch64", feature = "backend-mlx"))]
#[test]
fn moss_bundles_name_the_missing_file() {
    let mut worker = WorkerProcess::spawn();
    let (_, response) = worker.call("worker.hello", json!({ "contractVersion": 1 }), TIMEOUT);
    if result(&response)["backends"][0]["available"] != true {
        eprintln!("skipped: no Metal device");
        return;
    }
    let models = tempfile::tempdir().unwrap();
    std::fs::write(models.path().join("model.safetensors"), b"1234").unwrap();
    let component = |family: &str| {
        json!({ "family": family, "revision": "r1", "dir": models.path().to_string_lossy(),
                "files": [{ "path": "model.safetensors", "sha256": "0".repeat(64), "byteLength": 4 }] })
    };
    let mut load = |components: Value| {
        let bundle = json!({ "bundle": {
            "bundleId": "moss@test", "backend": "mlx", "device": "metal", "components": components,
            "threads": 2, "memoryBudgetBytes": null,
        } });
        let (_, response) = worker.call("model.load", bundle, TIMEOUT);
        let (_, status) = worker.call("worker.status", json!({}), TIMEOUT);
        assert_eq!(result(&status)["state"], "empty");
        assert_eq!(error_code(&response), "MODEL_NOT_INSTALLED", "{response}");
        response["error"]["details"].clone()
    };
    let details = load(json!({
        "asr": component("moss-transcribe-diarize"), "aligner": component("qwen3-forced-aligner"),
        "speaker": component("wespeaker"),
    }));
    assert_eq!(
        details,
        json!({ "component": "aligner", "file": "vocab.json", "reason": "not-listed" })
    );
    let details = load(json!({ "asr": component("moss-transcribe-diarize"), "speaker": component("wespeaker") }));
    assert_eq!(
        details,
        json!({ "component": "asr", "file": "config.json", "reason": "not-listed" })
    );
}

/// Whisper（GGML）的加载器：设备只认 `cpu` 与握手报的那个 GPU（`cuda` 或 `vulkan`，至多一个）；GGML 权重自带词表，带分词器是
/// 模型包写错了；权重是 `asr` 组件里的单个 `.bin`，没列出就是 `MODEL_NOT_INSTALLED`。都在读任何权重之前，失败的加载不留状态。
#[cfg(feature = "whisper-ggml")]
#[test]
fn ggml_bundles_check_device_components_and_weights() {
    let mut worker = WorkerProcess::spawn();
    let (_, response) = worker.call("worker.hello", json!({ "contractVersion": 1 }), TIMEOUT);
    let preferred = result(&response)["backends"][3]["devices"][0].as_str().unwrap().to_owned();
    let models = tempfile::tempdir().unwrap();
    std::fs::write(models.path().join("model.safetensors"), b"1234").unwrap();
    let component = |family: &str| {
        json!({ "family": family, "revision": "r1", "dir": models.path().to_string_lossy(),
                "files": [{ "path": "model.safetensors", "sha256": "0".repeat(64), "byteLength": 4 }] })
    };
    let mut load = |device: &str, components: Value| {
        let bundle = json!({ "bundle": {
            "bundleId": "whisper@ggml", "backend": "ggml", "device": device, "components": components,
            "threads": 2, "memoryBudgetBytes": null,
        } });
        let (_, response) = worker.call("model.load", bundle, TIMEOUT);
        let (_, status) = worker.call("worker.status", json!({}), TIMEOUT);
        assert_eq!(result(&status)["state"], "empty");
        response
    };
    let bundle = json!({ "asr": component("whisper-ggml"), "vad": component("silero-vad") });

    let response = load("metal", bundle.clone());
    assert_eq!(error_code(&response), "MODEL_UNSUPPORTED", "{response}");
    assert_eq!(response["error"]["details"]["reason"], "unsupported-device");
    // 不是握手报的首选 GPU 的那一个（或两个）GPU 设备都不收。
    for gpu in ["cuda", "vulkan"].into_iter().filter(|gpu| *gpu != preferred) {
        let response = load(gpu, bundle.clone());
        assert_eq!(error_code(&response), "MODEL_UNSUPPORTED", "{response}");
        assert_eq!(response["error"]["details"]["reason"], "unsupported-device");
    }

    let with_tokenizer = json!({
        "asr": component("whisper-ggml"), "vad": component("silero-vad"), "tokenizer": component("whisper-tokenizer"),
    });
    let response = load("cpu", with_tokenizer);
    assert_eq!(error_code(&response), "MODEL_UNSUPPORTED", "{response}");
    assert_eq!(
        (&response["error"]["details"]["component"], &response["error"]["details"]["reason"]),
        (&json!("tokenizer"), &json!("unexpected-component"))
    );
    let response = load("cpu", json!({ "asr": component("whisper-ggml") }));
    assert_eq!(error_code(&response), "MODEL_UNSUPPORTED", "{response}");
    assert_eq!(
        (&response["error"]["details"]["component"], &response["error"]["details"]["reason"]),
        (&json!("vad"), &json!("missing-component"))
    );

    let response = load("cpu", bundle);
    assert_eq!(error_code(&response), "MODEL_NOT_INSTALLED", "{response}");
    assert_eq!(
        response["error"]["details"],
        json!({ "component": "asr", "file": "*.bin", "reason": "not-listed" })
    );
}

/// 说话人区分（协议规范 §2.5.5）的参数照常先检查（形状 → `INVALID_PARAMS`，没有模型 → `WORKER_BUSY`）；说话人区分的
/// 模型包只带 `segmentation` 与 `speaker`，缺 `speaker` 或带了别的组件是 `MODEL_UNSUPPORTED`，失败的加载不留状态。
#[test]
fn diarization_is_checked_before_and_at_load() {
    let mut worker = WorkerProcess::spawn();
    let (_, response) = worker.call("worker.hello", json!({ "contractVersion": 1 }), TIMEOUT);
    let wired = result(&response)["capabilities"].as_array().unwrap().contains(&json!("diarize"));
    let staging = tempfile::tempdir().unwrap();
    let run = |options: Value| {
        json!({
            "jobId": "job-spk",
            "runGeneration": 1,
            "capability": "diarize",
            "input": { "file": "/media/a.mp4", "contentHash": "sha256:ab", "track": 0 },
            "options": options,
            "staging": staging.path().to_string_lossy(),
            "outputContract": "baocut.speakers/v1",
        })
    };
    let (_, response) = worker.call("job.run", run(json!({ "words": [[500, 100]] })), TIMEOUT);
    assert_eq!(error_code(&response), "INVALID_PARAMS");
    let (_, response) = worker.call("job.run", run(json!({ "words": [], "maxSpeakers": 2 })), TIMEOUT);
    assert_eq!(error_code(&response), "INVALID_PARAMS");
    let (_, response) = worker.call("job.run", run(json!({ "timescale": 1000, "words": [[0, 100]] })), TIMEOUT);
    assert_eq!(error_code(&response), "WORKER_BUSY");

    let models = tempfile::tempdir().unwrap();
    std::fs::write(models.path().join("model.safetensors"), b"1234").unwrap();
    let weights = json!([{ "path": "model.safetensors", "sha256": "0".repeat(64), "byteLength": 4 }]);
    let component = |family: &str| json!({ "family": family, "revision": "r1", "dir": models.path().to_string_lossy(), "files": weights });
    let (backend, device) = if cfg!(all(target_os = "macos", target_arch = "aarch64", feature = "backend-mlx")) {
        ("mlx", "metal")
    } else if cfg!(feature = "backend-candle") {
        ("candle", "cpu")
    } else {
        ("mlx", "metal")
    };
    let bundle = |components: Value| {
        json!({ "bundle": {
            "bundleId": "speaker-diarization@test",
            "backend": backend,
            "device": device,
            "components": components,
            "threads": 2,
            "memoryBudgetBytes": null,
        } })
    };
    let (_, response) = worker.call(
        "model.load",
        bundle(json!({ "segmentation": component("pyannote-segmentation") })),
        Duration::from_secs(60),
    );
    assert_eq!(error_code(&response), "MODEL_UNSUPPORTED", "{response}");
    assert_eq!(response["error"]["details"]["component"], "speaker", "{response}");
    let (_, response) = worker.call(
        "model.load",
        bundle(json!({
            "segmentation": component("pyannote-segmentation"),
            "speaker": component("wespeaker"),
            "vad": component("silero-vad"),
        })),
        Duration::from_secs(60),
    );
    assert_eq!(error_code(&response), "MODEL_UNSUPPORTED", "{response}");
    let expected_reason = if wired { "unexpected-component" } else { "not-wired" };
    assert_eq!(response["error"]["details"]["reason"], expected_reason, "{response}");
    let (_, response) = worker.call("worker.status", json!({}), TIMEOUT);
    assert_eq!(result(&response)["state"], "empty");
}
