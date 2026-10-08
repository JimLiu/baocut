//! 测试里驱动一个真实的 `model-worker` 进程：写请求、按超时读事件与响应、等它退出。

#![allow(dead_code)]

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

pub const BINARY: &str = env!("CARGO_BIN_EXE_model-worker");

pub struct WorkerProcess {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Receiver<Value>,
    next_id: u64,
}

impl WorkerProcess {
    /// 以本测试进程为父进程启动。
    pub fn spawn() -> Self {
        Self::spawn_with_parent(std::process::id())
    }

    pub fn spawn_with_parent(parent_pid: u32) -> Self {
        let mut child = Command::new(BINARY)
            .arg("--parent-pid")
            .arg(parent_pid.to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("spawn model-worker");
        let stdout = child.stdout.take().expect("stdout");
        let (sender, lines) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let value: Value = serde_json::from_str(&line).unwrap_or_else(|error| panic!("stdout is not JSON ({error}): {line}"));
                if sender.send(value).is_err() {
                    break;
                }
            }
        });
        let stdin = child.stdin.take();
        Self {
            child,
            stdin,
            lines,
            next_id: 1,
        }
    }

    pub fn send_raw(&mut self, line: &str) {
        self.try_send_raw(line).expect("write to model-worker stdin");
    }

    /// 写一行；worker 可能中途退出（管道断开），由调用方决定是否在意。
    pub fn try_send_raw(&mut self, line: &str) -> std::io::Result<()> {
        let stdin = self.stdin.as_mut().expect("stdin open");
        stdin.write_all(line.as_bytes())?;
        stdin.write_all(b"\n")?;
        stdin.flush()
    }

    /// 发一个请求，返回它的 id。
    pub fn send(&mut self, method: &str, params: Value) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        self.send_raw(&json!({ "id": id, "method": method, "params": params }).to_string());
        id
    }

    /// 下一行输出（事件或响应）。
    pub fn next(&self, timeout: Duration) -> Value {
        match self.lines.recv_timeout(timeout) {
            Ok(value) => value,
            Err(RecvTimeoutError::Timeout) => panic!("no output from model-worker within {timeout:?}"),
            Err(RecvTimeoutError::Disconnected) => panic!("model-worker closed stdout"),
        }
    }

    /// 读到 `id` 的响应为止，返回途中的事件与响应本身。
    pub fn response(&self, id: u64, timeout: Duration) -> (Vec<Value>, Value) {
        let deadline = Instant::now() + timeout;
        let mut events = Vec::new();
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let message = self.next(remaining.max(Duration::from_millis(1)));
            if message.get("id").and_then(Value::as_u64) == Some(id) {
                return (events, message);
            }
            events.push(message);
        }
    }

    /// 发请求并等响应。
    pub fn call(&mut self, method: &str, params: Value, timeout: Duration) -> (Vec<Value>, Value) {
        let id = self.send(method, params);
        self.response(id, timeout)
    }

    pub fn close_stdin(&mut self) {
        drop(self.stdin.take());
    }

    /// 等进程退出；超时返回 `None`。
    pub fn wait_exit(&mut self, timeout: Duration) -> Option<ExitStatus> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return Some(status);
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for WorkerProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub fn error_code(response: &Value) -> &str {
    response
        .pointer("/error/code")
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("expected an error response: {response}"))
}

pub fn result(response: &Value) -> &Value {
    response
        .get("result")
        .unwrap_or_else(|| panic!("expected a result response: {response}"))
}

/// 从 `<models-root>/<repo>/.bcut-manifest.json` 构造协议里的 `ModelFiles`。
pub fn model_files(models_root: &Path, repo: &str, family: &str) -> Value {
    let dir = models_root.join(repo);
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(dir.join(".bcut-manifest.json")).expect("read .bcut-manifest.json")).expect("manifest JSON");
    let files: Vec<Value> = manifest["files"]
        .as_array()
        .expect("manifest files")
        .iter()
        .map(|file| json!({ "path": file["path"], "sha256": file["sha256"], "byteLength": file["size"] }))
        .collect();
    json!({ "family": family, "revision": manifest["revision"], "dir": dir.to_string_lossy(), "files": files })
}

/// 同 [`model_files`]，只取仓库里 `subdir/` 之下的文件，组件的目录就是这个子目录（Runtime 按登记的 `subdir`
/// 交给 Worker 的就是这个形状：`argmaxinc/whisperkit-coreml` 的 large-v3 在 `openai_whisper-large-v3_947MB/` 里）。
pub fn model_files_in(models_root: &Path, repo: &str, subdir: &str, family: &str) -> Value {
    let mut files = model_files(models_root, repo, family);
    let prefix = format!("{subdir}/");
    let scoped: Vec<Value> = files["files"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|file| {
            let path = file["path"].as_str().unwrap().strip_prefix(&prefix)?;
            let mut file = file.clone();
            file["path"] = json!(path);
            Some(file)
        })
        .collect();
    files["dir"] = json!(models_root.join(repo).join(subdir).to_string_lossy());
    files["files"] = json!(scoped);
    files
}

/// Whisper（CoreML）的模型包：模型包 ID、`asr` 的仓库与仓库里的子目录（没有是 `None`）。
pub type WhisperBundle = (&'static str, &'static str, Option<&'static str>);
pub const WHISPER_LARGE_V3: WhisperBundle = (
    "whisper-large-v3@coreml",
    "argmaxinc/whisperkit-coreml",
    Some("openai_whisper-large-v3_947MB"),
);
pub const WHISPER_LARGE_V3_TURBO: WhisperBundle = ("whisper-large-v3-turbo@coreml", "aufklarer/Whisper-Large-v3-Turbo-CoreML", None);
/// Whisper 的分词器仓库，large-v3 与 turbo 共用。
pub const WHISPER_TOKENIZER_REPO: &str = "openai/whisper-large-v3";

/// 本机已安装的 Whisper（CoreML）+ Silero + 分词器模型包。可选的对齐器装了就带上（同 Runtime）。
pub fn whisper_bundle(models_root: &Path, (bundle_id, asr_repo, subdir): WhisperBundle) -> Value {
    let asr = match subdir {
        Some(subdir) => model_files_in(models_root, asr_repo, subdir, "whisper-coreml"),
        None => model_files(models_root, asr_repo, "whisper-coreml"),
    };
    let mut bundle = json!({
        "bundleId": bundle_id,
        "backend": "coreml",
        "device": "ane",
        "components": {
            "asr": asr,
            "vad": model_files(models_root, "aufklarer/Silero-VAD-v6.2.1-MLX", "silero-vad"),
            "tokenizer": model_files(models_root, WHISPER_TOKENIZER_REPO, "whisper-tokenizer"),
        },
        "threads": 4,
        "memoryBudgetBytes": null,
    });
    if is_installed(models_root, QWEN3_FORCED_ALIGNER) {
        bundle["components"]["aligner"] = model_files(models_root, QWEN3_FORCED_ALIGNER, "qwen3-forced-aligner");
    }
    bundle
}

/// Whisper（MLX）的模型包：模型包 ID 与 `asr` 的仓库（mlx-community 的 fp16 转换）。
pub type WhisperMlxBundle = (&'static str, &'static str);
pub const WHISPER_LARGE_V3_MLX: WhisperMlxBundle = ("whisper-large-v3@mlx", "mlx-community/whisper-large-v3-fp16");
pub const WHISPER_LARGE_V3_TURBO_MLX: WhisperMlxBundle = ("whisper-large-v3-turbo@mlx", "mlx-community/whisper-large-v3-turbo-fp16");

/// 本机已安装的 Whisper（MLX）+ Silero + 分词器模型包（分词器组件要带 `generation_config.json`）。可选的对齐器装了就
/// 带上（同 Runtime）。
pub fn whisper_mlx_bundle(models_root: &Path, (bundle_id, asr_repo): WhisperMlxBundle) -> Value {
    let mut bundle = json!({
        "bundleId": bundle_id,
        "backend": "mlx",
        "device": "metal",
        "components": {
            "asr": model_files(models_root, asr_repo, "whisper-mlx"),
            "vad": model_files(models_root, "aufklarer/Silero-VAD-v6.2.1-MLX", "silero-vad"),
            "tokenizer": model_files(models_root, WHISPER_TOKENIZER_REPO, "whisper-tokenizer"),
        },
        "threads": 4,
        "memoryBudgetBytes": null,
    });
    if is_installed(models_root, QWEN3_FORCED_ALIGNER) {
        bundle["components"]["aligner"] = model_files(models_root, QWEN3_FORCED_ALIGNER, "qwen3-forced-aligner");
    }
    bundle
}

/// 默认的识别模型包：模型包 ID 与 `asr` 组件的仓库。
pub const QWEN3_ASR_0_6B: (&str, &str) = ("qwen3-asr-0.6b@mlx-4bit", "aufklarer/Qwen3-ASR-0.6B-MLX-4bit");
/// 大一档的 Qwen3-ASR，与 0.6B 共用 Silero VAD。
pub const QWEN3_ASR_1_7B: (&str, &str) = ("qwen3-asr-1.7b@mlx-8bit", "aufklarer/Qwen3-ASR-1.7B-MLX-8bit");

/// 这个仓库在本机装好了（有 `.bcut-manifest.json`）。
pub fn is_installed(models_root: &Path, repo: &str) -> bool {
    models_root.join(repo).join(".bcut-manifest.json").is_file()
}

/// 识别模型包（Qwen3-ASR、Whisper）共用的可选对齐器。
pub const QWEN3_FORCED_ALIGNER: &str = "aufklarer/Qwen3-ForcedAligner-0.6B-4bit";

/// 本机已安装的 Qwen3-ASR + Silero 模型包：`(模型包 ID, asr 的仓库)`。可选的对齐器装了就带上（同 Runtime）。
pub fn qwen3_asr_bundle(models_root: &Path, (bundle_id, asr_repo): (&str, &str)) -> Value {
    let mut bundle = json!({
        "bundleId": bundle_id,
        "backend": "mlx",
        "device": "metal",
        "components": {
            "asr": model_files(models_root, asr_repo, "qwen3-asr"),
            "vad": model_files(models_root, "aufklarer/Silero-VAD-v6.2.1-MLX", "silero-vad"),
        },
        "threads": 4,
        "memoryBudgetBytes": null,
    });
    if is_installed(models_root, QWEN3_FORCED_ALIGNER) {
        bundle["components"]["aligner"] = model_files(models_root, QWEN3_FORCED_ALIGNER, "qwen3-forced-aligner");
    }
    bundle
}

/// MOSS Transcribe Diarize：模型包 ID 与 `asr` 组件的仓库。
pub const MOSS_TRANSCRIBE_DIARIZE: (&str, &str) = ("moss-transcribe-diarize@mlx-8bit", "OpenMOSS-Team/MOSS-Transcribe-Diarize");

/// MOSS 合并跨块说话人用的可选说话人模型。
pub const WESPEAKER: &str = "aufklarer/WeSpeaker-ResNet34-LM-MLX";

/// 「说话人区分」模型包的 Pyannote 分段模型（与 [`WESPEAKER`] 一起给 Qwen3-ASR、Whisper 区分说话人）。
pub const PYANNOTE: &str = "aufklarer/Pyannote-Segmentation-MLX";

/// 识别模型包带上「说话人区分」模型包的两个组件（同 Runtime：模型包装好了才带）；没装返回 `None`。
pub fn with_diarization(models_root: &Path, mut bundle: Value) -> Option<Value> {
    if !is_installed(models_root, PYANNOTE) || !is_installed(models_root, WESPEAKER) {
        return None;
    }
    bundle["components"]["segmentation"] = model_files(models_root, PYANNOTE, "pyannote-segmentation");
    bundle["components"]["speaker"] = model_files(models_root, WESPEAKER, "wespeaker");
    Some(bundle)
}

/// 本机已安装的 MOSS 模型包（没有 VAD）。可选的对齐器与说话人模型装了就带上（同 Runtime）。
pub fn moss_bundle(models_root: &Path) -> Value {
    let (bundle_id, asr_repo) = MOSS_TRANSCRIBE_DIARIZE;
    let mut bundle = json!({
        "bundleId": bundle_id,
        "backend": "mlx",
        "device": "metal",
        "components": { "asr": model_files(models_root, asr_repo, "moss-transcribe-diarize") },
        "threads": 4,
        "memoryBudgetBytes": null,
    });
    if is_installed(models_root, QWEN3_FORCED_ALIGNER) {
        bundle["components"]["aligner"] = model_files(models_root, QWEN3_FORCED_ALIGNER, "qwen3-forced-aligner");
    }
    if is_installed(models_root, WESPEAKER) {
        bundle["components"]["speaker"] = model_files(models_root, WESPEAKER, "wespeaker");
    }
    bundle
}

/// candle 后端的模型包 ID：与 MLX 的同一批仓库、同样的组件。
pub const QWEN3_ASR_0_6B_CANDLE: &str = "qwen3-asr-0.6b@candle";
pub const QWEN3_ASR_1_7B_CANDLE: &str = "qwen3-asr-1.7b@candle";
pub const MOSS_TRANSCRIBE_DIARIZE_CANDLE: &str = "moss-transcribe-diarize@candle";

/// 同一个模型包换到 candle 后端的 CPU 上跑（Runtime 在 Windows / Linux 上登记的就是这个形状）。
pub fn on_candle(mut bundle: Value, bundle_id: &str) -> Value {
    bundle["bundleId"] = json!(bundle_id);
    bundle["backend"] = json!("candle");
    bundle["device"] = json!("cpu");
    bundle
}

/// 去掉可选的对齐器：词时间退回按字符长度估计。
pub fn without_aligner(mut bundle: Value) -> Value {
    bundle["components"].as_object_mut().expect("components").remove("aligner");
    bundle
}

/// 本机已安装的默认识别模型包（Qwen3-ASR 0.6B + Silero）。
pub fn installed_bundle(models_root: &Path) -> Value {
    qwen3_asr_bundle(models_root, QWEN3_ASR_0_6B)
}

pub fn fixture(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../model-runtime/tests/fixtures")
        .join(name)
}
