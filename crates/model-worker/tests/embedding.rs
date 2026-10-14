//! 端到端：真实的 EmbeddingGemma 2（LiteRT-LM）模型包，`worker.hello` → `model.load` → `embed.run`。需要本机的模型文件
//! 与 LiteRT-LM 动态库，默认忽略：
//!
//! ```sh
//! BAOCUT_TEST_EMBEDDING_MODEL=/path/to/embeddinggemma-2-text-270m.litertlm \
//! BAOCUT_TEST_LITERTLM_LIBRARY=/path/to/libCLiteRTLM_mac.dylib \
//!   cargo test -p model-worker --test embedding -- --ignored --test-threads=1 --nocapture
//! ```
//!
//! 只读模型与库；引擎缓存写到临时目录。

mod support;

use std::path::Path;
use std::time::Duration;

use serde_json::{Value, json};
use support::{WorkerProcess, error_code, result};

const LOAD_TIMEOUT: Duration = Duration::from_secs(120);
const RUN_TIMEOUT: Duration = Duration::from_secs(120);
const QUICK: Duration = Duration::from_secs(10);

fn single_file(path: &Path, family: &str) -> Value {
    let size = std::fs::metadata(path).expect("the file exists").len();
    json!({
        "family": family,
        "revision": "local",
        "dir": path.parent().unwrap().to_string_lossy(),
        "files": [{ "path": path.file_name().unwrap().to_string_lossy(), "sha256": "", "byteLength": size }],
    })
}

fn decode(vector: &Value) -> Vec<f32> {
    let text = vector.as_str().unwrap();
    let mut bytes = Vec::new();
    let value = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        _ => 63,
    };
    for chunk in text.as_bytes().chunks(4) {
        let n = chunk
            .iter()
            .enumerate()
            .filter(|(_, c)| **c != b'=')
            .fold(0u32, |n, (i, c)| n | (u32::from(value(*c)) << (18 - 6 * i)));
        let pad = chunk.iter().filter(|c| **c == b'=').count();
        bytes.extend_from_slice(&n.to_be_bytes()[1..4 - pad]);
    }
    bytes.chunks(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()
}

/// 截到 512 维再归一化（Runtime 的存储形状）。
fn truncate(vector: &[f32]) -> Vec<f32> {
    let head = &vector[..512];
    let norm = head.iter().map(|x| x * x).sum::<f32>().sqrt();
    head.iter().map(|x| x / norm).collect()
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[test]
#[ignore = "needs an EmbeddingGemma 2 .litertlm (BAOCUT_TEST_EMBEDDING_MODEL) and the LiteRT-LM library (BAOCUT_TEST_LITERTLM_LIBRARY)"]
fn embeddinggemma2_ranks_the_relevant_sentence_first() {
    let model = std::env::var("BAOCUT_TEST_EMBEDDING_MODEL").expect("set BAOCUT_TEST_EMBEDDING_MODEL");
    let library = std::env::var("BAOCUT_TEST_LITERTLM_LIBRARY").expect("set BAOCUT_TEST_LITERTLM_LIBRARY");
    let cache = tempfile::tempdir().unwrap();
    let mut worker = WorkerProcess::spawn();
    let (_, hello) = worker.call("worker.hello", json!({ "contractVersion": 1 }), QUICK);
    let hello = result(&hello);
    assert!(hello["capabilities"].as_array().unwrap().iter().any(|c| c == "embed"), "{hello}");
    assert_eq!(hello["embeddingCapabilities"]["families"], json!(["embeddinggemma2-litert"]));

    let bundle = json!({
        "bundleId": "embeddinggemma2-text@litert-lm",
        "backend": "litert-lm",
        "device": "cpu",
        "threads": 4,
        "cacheDir": cache.path().to_string_lossy(),
        "components": {
            "embedding": single_file(Path::new(&model), "embeddinggemma2-litert"),
            "litertlm-runtime": single_file(Path::new(&library), "litertlm-runtime"),
        },
    });
    let (events, loaded) = worker.call("model.load", json!({ "bundle": bundle }), LOAD_TIMEOUT);
    assert_eq!(result(&loaded)["loaded"], true, "{loaded}");
    let phases: Vec<&str> = events.iter().map(|e| e["params"]["phase"].as_str().unwrap()).collect();
    assert_eq!(phases, ["loading-weights", "compiling", "warming-up"]);

    let texts = [
        "task: search result | query: how did we choose the model",
        "title: none | text: 我们最后选了这个模型是因为它在本地跑得快",
        "title: none | text: 今天天气很好",
    ];
    let (_, response) = worker.call(
        "embed.run",
        json!({ "requestId": "e2e", "texts": texts, "outputSize": 768, "insertSpecialTokens": true }),
        RUN_TIMEOUT,
    );
    let run = result(&response);
    assert_eq!(run["dims"], 768);
    assert_eq!(run["device"], "cpu");
    let vectors: Vec<Vec<f32>> = run["vectors"].as_array().unwrap().iter().map(decode).collect();
    assert_eq!(vectors.len(), 3);
    let truncated: Vec<Vec<f32>> = vectors
        .iter()
        .map(|vector| {
            assert_eq!(vector.len(), 768);
            assert!(vector.iter().all(|x| x.is_finite()));
            assert!((dot(vector, vector).sqrt() - 1.0).abs() < 1e-3, "the engine normalizes");
            truncate(vector)
        })
        .collect();
    let relevant = dot(&truncated[0], &truncated[1]);
    let irrelevant = dot(&truncated[0], &truncated[2]);
    eprintln!("cos(query, relevant) = {relevant:.4}, cos(query, irrelevant) = {irrelevant:.4}");
    assert!(relevant > irrelevant);

    // 超长：溢出策略是 Error，报出是哪一条。
    let long = format!("title: none | text: {}", "模型 ".repeat(5000));
    let (_, response) = worker.call(
        "embed.run",
        json!({ "requestId": "long", "texts": [texts[0], long], "outputSize": 768, "insertSpecialTokens": true }),
        RUN_TIMEOUT,
    );
    assert_eq!(error_code(&response), "INPUT_TOO_LONG", "{response}");
    assert_eq!(response["error"]["details"]["index"], 1);

    // 批次结束后回到 ready。
    let (_, status) = worker.call("worker.status", json!({}), QUICK);
    assert_eq!(result(&status)["state"], "ready");
}

#[test]
fn embed_run_checks_params_before_state() {
    let mut worker = WorkerProcess::spawn();
    let (_, hello) = worker.call("worker.hello", json!({ "contractVersion": 1 }), QUICK);
    result(&hello);
    // 形状不对先报 INVALID_PARAMS（与 job.run 同一个次序）。
    let (_, bad) = worker.call(
        "embed.run",
        json!({ "requestId": "x", "texts": [], "outputSize": 768, "insertSpecialTokens": true }),
        QUICK,
    );
    assert_eq!(error_code(&bad), "INVALID_PARAMS");
    let (_, bad) = worker.call(
        "embed.run",
        json!({ "requestId": "x", "texts": ["a"], "outputSize": 300, "insertSpecialTokens": true }),
        QUICK,
    );
    assert_eq!(error_code(&bad), "INVALID_PARAMS");
    // 没加载模型包：WORKER_BUSY，带状态。
    let (_, empty) = worker.call(
        "embed.run",
        json!({ "requestId": "x", "texts": ["a"], "outputSize": 768, "insertSpecialTokens": true }),
        QUICK,
    );
    assert_eq!(error_code(&empty), "WORKER_BUSY");
    assert_eq!(empty["error"]["details"]["state"], "empty");
    // 嵌入的模型包缺 litertlm-runtime：MODEL_UNSUPPORTED，不碰任何库。
    let dir = tempfile::tempdir().unwrap();
    let model = dir.path().join("m.litertlm");
    std::fs::write(&model, b"1").unwrap();
    let bundle = json!({
        "bundleId": "b", "backend": "litert-lm", "device": "cpu", "threads": 1,
        "components": { "embedding": single_file(&model, "embeddinggemma2-litert") },
    });
    let (_, load) = worker.call("model.load", json!({ "bundle": bundle }), QUICK);
    assert_eq!(error_code(&load), "MODEL_UNSUPPORTED", "{load}");
    assert_eq!(load["error"]["details"]["component"], "litertlm-runtime");
}

/// 多模态包的图像编码器：`model.load` 带 `vision` 打开，`embed.run` 给 `images`。参考向量是 G0 评测（Python 绑定、同一个 0.18.0
/// 的 C 库、CPU、默认 140 个视觉 token、归一化）对同一张图给出的 768 维向量，存成 JSON 数组；两条路径应给出同一个向量。
///
/// ```sh
/// BAOCUT_TEST_EMBEDDING_MODEL=/path/to/embeddinggemma-2-740m.litertlm \
/// BAOCUT_TEST_LITERTLM_LIBRARY=/path/to/libCLiteRTLM_mac.dylib \
/// BAOCUT_TEST_EMBEDDING_FRAME=/path/to/frame.jpg \
/// BAOCUT_TEST_EMBEDDING_FRAME_VECTOR=/path/to/frame-vector.json \
///   cargo test -p model-worker --test embedding -- --ignored --test-threads=1 --nocapture
/// ```
#[test]
#[ignore = "needs the EmbeddingGemma 2 740M .litertlm, the LiteRT-LM library, a frame and its reference vector"]
fn embeddinggemma2_embeds_a_frame_like_the_reference() {
    let model = std::env::var("BAOCUT_TEST_EMBEDDING_MODEL").expect("set BAOCUT_TEST_EMBEDDING_MODEL");
    let library = std::env::var("BAOCUT_TEST_LITERTLM_LIBRARY").expect("set BAOCUT_TEST_LITERTLM_LIBRARY");
    let frame = std::env::var("BAOCUT_TEST_EMBEDDING_FRAME").expect("set BAOCUT_TEST_EMBEDDING_FRAME");
    let reference: Vec<f32> = serde_json::from_str(
        &std::fs::read_to_string(std::env::var("BAOCUT_TEST_EMBEDDING_FRAME_VECTOR").expect("set BAOCUT_TEST_EMBEDDING_FRAME_VECTOR"))
            .unwrap(),
    )
    .unwrap();
    let cache = tempfile::tempdir().unwrap();
    let mut worker = WorkerProcess::spawn();
    let (_, hello) = worker.call("worker.hello", json!({ "contractVersion": 1 }), QUICK);
    assert_eq!(result(&hello)["embeddingCapabilities"]["inputs"], json!(["text", "image"]));
    let bundle = json!({
        "bundleId": "embeddinggemma2-multimodal@litert-lm",
        "backend": "litert-lm",
        "device": "cpu",
        "threads": 4,
        "cacheDir": cache.path().to_string_lossy(),
        "vision": {},
        "components": {
            "embedding": single_file(Path::new(&model), "embeddinggemma2-litert"),
            "litertlm-runtime": single_file(Path::new(&library), "litertlm-runtime"),
        },
    });
    let (_, loaded) = worker.call("model.load", json!({ "bundle": bundle }), LOAD_TIMEOUT);
    assert_eq!(result(&loaded)["loaded"], true, "{loaded}");

    let started = std::time::Instant::now();
    let (_, response) = worker.call(
        "embed.run",
        json!({ "requestId": "frame", "images": [frame], "outputSize": 768, "insertSpecialTokens": true }),
        RUN_TIMEOUT,
    );
    let run = result(&response);
    let vector = decode(&run["vectors"][0]);
    assert_eq!(vector.len(), 768);
    let cosine = dot(&vector, &reference) / dot(&reference, &reference).sqrt();
    eprintln!("cos(worker, reference) = {cosine:.6}, {} ms", started.elapsed().as_millis());
    assert!(cosine >= 0.999, "the worker's frame vector drifts from the reference: {cosine}");

    // 打开图像编码器不影响文字：同一个引擎照样嵌入文本。
    let (_, response) = worker.call(
        "embed.run",
        json!({ "requestId": "text", "texts": ["task: search result | query: a slide"], "outputSize": 768, "insertSpecialTokens": true }),
        RUN_TIMEOUT,
    );
    assert_eq!(decode(&result(&response)["vectors"][0]).len(), 768);
    // 一张读不了的图：INPUT_UNREADABLE，带序号。
    let (_, response) = worker.call(
        "embed.run",
        json!({ "requestId": "bad", "images": [frame, "/nonexistent/frame.jpg"], "outputSize": 768, "insertSpecialTokens": true }),
        RUN_TIMEOUT,
    );
    assert_eq!(error_code(&response), "INPUT_UNREADABLE", "{response}");
    assert_eq!(response["error"]["details"]["index"], 1);
}
