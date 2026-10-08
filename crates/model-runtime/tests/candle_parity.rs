//! mlx ↔ candle 跨后端对拍（移植自 v2 `bcut-speech` 的 `candle_parity`；仅 macOS Apple Silicon，需同时启用两个后端）：
//!
//! cargo test -p model-runtime --features backend-candle --test candle_parity -- --test-threads=1
//!
//! 无权重的数值对拍（量化位序、RoPE 语义）默认运行。真模型对拍标记 `#[ignore]`，权重按
//! `<BAOCUT_TEST_MODELS_DIR>/<repo>/.bcut-manifest.json` 核对后加载，不在时打印原因后跳过：
//!
//! BAOCUT_TEST_MODELS_DIR=… cargo test --release -p model-runtime --features backend-candle --test candle_parity \
//!   -- --ignored --test-threads=1 --nocapture
//!
//! 真模型对拍要用 `--release`（同 v2 的 verify.sh）：dev 档构建的 MLX 在夹具上近乎平票的品牌名处会走到另一个 token
//! （「Bocut」；把依赖或全部 crate 改成 O2、关掉 debug-assertions 也一样），release 构建的 MLX 与两档的 candle 都是「BioCut」。

#![cfg(all(feature = "backend-mlx", feature = "backend-candle", target_os = "macos", target_arch = "aarch64"))]

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use model_runtime::audio::decode_mono;
use model_runtime::backend::candle;
use model_runtime::backend::mlx;
use model_runtime::bundle::{self, VerifiedFiles};
use model_runtime::speech::qwen3_asr::{Qwen3Config, TokenizerFiles};
use model_runtime::speech::wespeaker_fbank::{EMBEDDING_DIM, cosine_distance};
use model_runtime::speech::{ForcedAlignment, RecognitionRequest, SpeakerEmbedding, SpeechRecognizer, StreamingVad};
use serde_json::{Value, json};

/// MLX/Metal 不支持并发初始化，本文件内的 mlx 测试全部串行。
static MLX_LOCK: Mutex<()> = Mutex::new(());

const ASR_REPO: &str = "aufklarer/Qwen3-ASR-0.6B-MLX-4bit";
const VAD_REPO: &str = "aufklarer/Silero-VAD-v6.2.1-MLX";
const ALIGNER_REPO: &str = "aufklarer/Qwen3-ForcedAligner-0.6B-4bit";
const WESPEAKER_REPO: &str = "aufklarer/WeSpeaker-ResNet34-LM-MLX";
const PYANNOTE_REPO: &str = "aufklarer/Pyannote-Segmentation-MLX";
const MOSS_REPO: &str = "OpenMOSS-Team/MOSS-Transcribe-Diarize";

/// candle 的仿射反量化必须与 MLX `quantize`/`dequantize` 逐值一致——这是“复用 MLX 模型仓库”策略的根基
/// （位打包顺序 + `w = q*scale + bias`）。
#[test]
fn candle_dequantization_matches_mlx_for_4bit_and_8bit() {
    let _guard = MLX_LOCK.lock().unwrap();
    mlx::runtime::ensure_metal_device().unwrap();
    for bits in [4, 8] {
        let rows = 8;
        let columns = 128;
        let values = (0..rows * columns)
            .map(|index| ((index * 2_654_435_761_usize) % 1_000) as f32 / 250.0 - 2.0)
            .collect::<Vec<_>>();
        let weight = mlx_rs::Array::from_slice(&values, &[rows as i32, columns as i32]);
        let (quantized, scales, biases) = mlx_rs::ops::quantize(&weight, 64, bits).unwrap();
        let reference = mlx_rs::ops::dequantize(&quantized, &scales, &biases, 64, bits).unwrap();
        let reference = reference.as_dtype(mlx_rs::Dtype::Float32).unwrap().as_slice::<f32>().to_vec();

        let device = candle_core::Device::Cpu;
        let quantized_host = quantized.as_slice::<u32>().to_vec();
        let packed_columns = quantized.dim(1) as usize;
        let quantized_tensor = candle_core::Tensor::from_vec(quantized_host, (rows, packed_columns), &device).unwrap();
        let host = |array: &mlx_rs::Array| array.as_dtype(mlx_rs::Dtype::Float32).unwrap().as_slice::<f32>().to_vec();
        let scales_tensor = candle_core::Tensor::from_vec(host(&scales), (rows, columns / 64), &device).unwrap();
        let biases_tensor = candle_core::Tensor::from_vec(host(&biases), (rows, columns / 64), &device).unwrap();
        let dequantized = candle::weights::dequantize_affine(&quantized_tensor, &scales_tensor, &biases_tensor, 64, bits as usize).unwrap();
        let actual = dequantized.flatten_all().unwrap().to_vec1::<f32>().unwrap();
        assert_eq!(actual.len(), reference.len());
        for (index, (actual, reference)) in actual.iter().zip(reference.iter()).enumerate() {
            assert!(
                (actual - reference).abs() < 2e-3,
                "bits={bits} 元素 {index} 不一致：candle={actual} mlx={reference}"
            );
        }
    }
}

/// candle 侧半分裂 RoPE 必须与 mlx `fast::rope(traditional=false)` 一致（含 KV cache offset 语义）。
#[test]
fn candle_rope_matches_mlx_fast_rope() {
    let _guard = MLX_LOCK.lock().unwrap();
    mlx::runtime::ensure_metal_device().unwrap();
    let (batch, heads, sequence, head_dim) = (1_usize, 2_usize, 5_usize, 16_usize);
    let theta = 1_000_000.0_f32;
    for offset in [0_usize, 7] {
        let values = (0..batch * heads * sequence * head_dim)
            .map(|index| ((index % 37) as f32 / 37.0) - 0.5)
            .collect::<Vec<_>>();
        let mlx_input = mlx_rs::Array::from_slice(&values, &[batch as i32, heads as i32, sequence as i32, head_dim as i32]);
        let mlx_output = mlx_rs::fast::rope(&mlx_input, head_dim as i32, false, theta, 1.0, offset as i32, None).unwrap();
        let reference = mlx_output.as_dtype(mlx_rs::Dtype::Float32).unwrap().as_slice::<f32>().to_vec();

        let device = candle_core::Device::Cpu;
        let candle_input = candle_core::Tensor::from_vec(values.clone(), (batch, heads, sequence, head_dim), &device).unwrap();
        let candle_output = candle::layers::rope(&candle_input, theta, offset).unwrap();
        let actual = candle_output.flatten_all().unwrap().to_vec1::<f32>().unwrap();
        for (index, (actual, reference)) in actual.iter().zip(reference.iter()).enumerate() {
            assert!(
                (actual - reference).abs() < 1e-4,
                "offset={offset} 元素 {index} 不一致：candle={actual} mlx={reference}"
            );
        }
    }
}

/// 真模型对拍：candle 与 mlx 对同一段音频的贪心转录应一致（同权重值、同贪心解码，仅浮点求和次序不同）。
/// MLX 要是优化过的构建（见文件头）。
#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with Qwen3-ASR 0.6B installed; run with --release"]
fn candle_qwen3_transcription_matches_mlx() {
    let Some(files) = verified(ASR_REPO, "qwen3-asr", "asr") else {
        return;
    };
    let config: Value = serde_json::from_slice(&std::fs::read(files.require("config.json").unwrap()).unwrap()).unwrap();
    let config = Qwen3Config::parse(&config).unwrap();
    let weights = files.require_extension("safetensors").unwrap();
    let tokenizer = || TokenizerFiles {
        vocabulary: files.require("vocab.json").unwrap(),
        merges: files.path("merges.txt"),
        config: files.path("tokenizer_config.json"),
    };
    let audio = audio("test-sample.wav");
    let request = RecognitionRequest {
        language: Some("en"),
        context: None,
    };

    let mlx_text = {
        let _guard = MLX_LOCK.lock().unwrap();
        let mut model = mlx::qwen3::Qwen3Asr::load(config, &weights, tokenizer()).expect("加载 mlx Qwen3");
        model.recognize(&audio, &request).unwrap().text
    };
    let mut model = candle::Qwen3Asr::load(config, &weights, tokenizer(), &candle_core::Device::Cpu).expect("加载 candle Qwen3");
    let candle_text = model.recognize(&audio, &request).unwrap().text;
    assert_eq!(
        normalize(&candle_text),
        normalize(&mlx_text),
        "candle=\"{candle_text}\" mlx=\"{mlx_text}\""
    );
}

/// Silero VAD 逐块概率对拍：两个后端在同一波形上概率差应可忽略。
#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with Silero VAD installed"]
fn candle_silero_probabilities_match_mlx() {
    let Some(files) = verified(VAD_REPO, "silero-vad", "vad") else {
        return;
    };
    let weights = files.require_extension("safetensors").unwrap();
    let samples = (0..512 * 20).map(|index| (index as f32 * 0.03).sin() * 0.4).collect::<Vec<_>>();
    let mlx_probabilities = {
        let _guard = MLX_LOCK.lock().unwrap();
        let mut vad = mlx::silero::SileroVad::load(&weights).unwrap();
        vad.process_chunks(&samples).unwrap()
    };
    let mut vad = candle::SileroVad::load(&weights).unwrap();
    let candle_probabilities = vad.process_chunks(&samples).unwrap();
    assert_eq!(mlx_probabilities.len(), candle_probabilities.len());
    for (index, (mlx, candle)) in mlx_probabilities.iter().zip(candle_probabilities.iter()).enumerate() {
        assert!((mlx - candle).abs() < 0.02, "块 {index} 概率不一致：candle={candle} mlx={mlx}");
    }
}

/// 词级时间戳对拍：强制对齐器在两个后端的输出词序一致，时间戳差 ≤0.08s（一个时间戳量化步长）。
#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with the forced aligner installed"]
fn candle_aligner_timestamps_match_mlx() {
    let Some(files) = verified(ALIGNER_REPO, "qwen3-forced-aligner", "aligner") else {
        return;
    };
    let audio = audio("test-sample.wav");
    let text = "Testing one two three BaoCut is ready";

    let mlx_words = {
        let _guard = MLX_LOCK.lock().unwrap();
        let mut aligner = mlx::aligner::ForcedAligner::load(&files).unwrap();
        aligner.align(&audio, text, Some("en")).unwrap()
    };
    let mut aligner = candle::ForcedAligner::load(&files, &candle_core::Device::Cpu).unwrap();
    let candle_words = aligner.align(&audio, text, Some("en")).unwrap();
    assert_eq!(mlx_words.len(), candle_words.len());
    for (mlx, candle) in mlx_words.iter().zip(candle_words.iter()) {
        assert_eq!(mlx.text, candle.text);
        assert!(
            (mlx.start - candle.start).abs() <= 0.08 + 1e-6,
            "词 {} 起点不一致：candle={} mlx={}",
            mlx.text,
            candle.start,
            mlx.start
        );
        assert!(
            (mlx.end - candle.end).abs() <= 0.08 + 1e-6,
            "词 {} 终点不一致：candle={} mlx={}",
            mlx.text,
            candle.end,
            mlx.end
        );
    }
}

/// MOSS 转录对拍：mlx 走 bf16（quality，不做加载期量化）、candle 走 f32，权重值相同，贪心解码文本应一致；说话人
/// 分段时间允许小量浮点漂移。
#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with MOSS Transcribe Diarize installed"]
fn candle_moss_transcription_matches_mlx() {
    let Some(files) = verified(MOSS_REPO, "moss-transcribe-diarize", "asr") else {
        return;
    };
    let audio = audio("test-sample.wav");

    let mlx_result = {
        let _guard = MLX_LOCK.lock().unwrap();
        let mut model = mlx::moss::MossTranscribeDiarize::load_with_preference(&files, "quality").expect("加载 mlx MOSS");
        model.transcribe_diarized(&audio, None).unwrap()
    };
    let mut model = candle::MossTranscribeDiarize::load(&files, &candle_core::Device::Cpu).expect("加载 candle MOSS");
    let candle_result = model.transcribe_diarized(&audio, None).unwrap();

    assert_eq!(
        normalize(&candle_result.text),
        normalize(&mlx_result.text),
        "candle=\"{}\" mlx=\"{}\"",
        candle_result.text,
        mlx_result.text
    );
    assert_eq!(mlx_result.rows.len(), candle_result.rows.len());
    for (mlx, candle) in mlx_result.rows.iter().zip(candle_result.rows.iter()) {
        assert!(
            (mlx.start - candle.start).abs() <= 0.5 && (mlx.end - candle.end).abs() <= 0.5,
            "行时间不一致：candle=[{}, {}] mlx=[{}, {}]",
            candle.start,
            candle.end,
            mlx.start,
            mlx.end
        );
    }
}

/// Pyannote 分割对拍：同一批窗口喂给两个后端，**解码后的量**必须一致。
///
/// 两侧共用 `pyannote_common` 的解码（softmax → 按说话人求和 → 迟滞二值化），所以真正决定输出的是逐帧说话人概率和
/// 二值化 tracks，而不是 argmax 胜出类别。三条断言各管一层：概率（数值层）、tracks（判决层）、argmax（定位层）。只比
/// argmax 是不够的——MLX 某帧概率 0.51、candle 0.49 时 argmax 完全一致，分段边界却已经翻转。
///
/// 历史：candle 的 `Conv1d::load` permute 之后漏了 `contiguous()` 时，窗口 0 有 156/589 帧不一致（见那里的注释）。
#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with Pyannote installed"]
fn candle_pyannote_classes_match_mlx() {
    use model_runtime::speech::pyannote_common::{
        FRAMES_PER_WINDOW, LOCAL_SPEAKERS, STEP_SAMPLES, WINDOW_SAMPLES, argmax_classes, binarize_speaker_track, speaker_probabilities,
    };

    let Some(files) = verified(PYANNOTE_REPO, "pyannote-segmentation", "segmentation") else {
        return;
    };
    let audio = audio("test-sample.wav");

    // 三个窗口：开头、偏移一个滑窗步长、以及一段末尾补零窗口。
    const BATCH: usize = 3;
    let mut packed = vec![0.0_f32; BATCH * WINDOW_SAMPLES];
    let starts = [0, STEP_SAMPLES.min(audio.len()), audio.len().saturating_sub(WINDOW_SAMPLES)];
    for (index, start) in starts.into_iter().enumerate() {
        let end = (start + WINDOW_SAMPLES).min(audio.len());
        let slot = &mut packed[index * WINDOW_SAMPLES..(index + 1) * WINDOW_SAMPLES];
        slot[..end - start].copy_from_slice(&audio[start..end]);
    }

    let mlx_logits = {
        let _guard = MLX_LOCK.lock().unwrap();
        let mut model = mlx::pyannote::PyannoteDiarizer::load(&files).unwrap();
        model.frame_logits(&packed, BATCH).unwrap()
    };
    let mut candle_model = candle::PyannoteDiarizer::load(&files, &candle_core::Device::Cpu).unwrap();
    let candle_logits = candle_model.frame_logits(&packed, BATCH).unwrap();

    assert_eq!(mlx_logits.len(), BATCH);
    assert_eq!(candle_logits.len(), BATCH);
    for (window, (mlx, candle)) in mlx_logits.iter().zip(candle_logits.iter()).enumerate() {
        let mlx_probabilities = speaker_probabilities(mlx);
        let candle_probabilities = speaker_probabilities(candle);
        for local in 0..LOCAL_SPEAKERS {
            assert_eq!(mlx_probabilities[local].len(), FRAMES_PER_WINDOW);
            assert_eq!(candle_probabilities[local].len(), FRAMES_PER_WINDOW);
            // BiLSTM 的 f32 累积差让逐位相等不现实；1e-2 是能抓住权重读错级别偏差、又不会因累积误差抖动的量级。
            let worst = mlx_probabilities[local]
                .iter()
                .zip(candle_probabilities[local].iter())
                .map(|(left, right)| (left - right).abs())
                .fold(0.0_f32, f32::max);
            assert!(worst <= 1e-2, "窗口 {window} 说话人 {local} 概率最大偏差 {worst}");

            let mlx_track = binarize_speaker_track(&mlx_probabilities[local]);
            let candle_track = binarize_speaker_track(&candle_probabilities[local]);
            let mismatched = mlx_track
                .iter()
                .zip(candle_track.iter())
                .filter(|(left, right)| left != right)
                .count();
            // 概率贴着 onset/offset 时二值化可能翻转；沿用 1% 的宽容口径。
            assert!(
                mismatched * 100 <= FRAMES_PER_WINDOW,
                "窗口 {window} 说话人 {local} 有 {mismatched}/{FRAMES_PER_WINDOW} 帧活跃状态不一致"
            );
        }

        // argmax 已不参与解码，保留它只为把差异定位到网络层。
        let mismatched = argmax_classes(mlx)
            .into_iter()
            .zip(argmax_classes(candle))
            .filter(|(left, right)| left != right)
            .count();
        assert!(
            mismatched * 100 <= FRAMES_PER_WINDOW,
            "窗口 {window} 有 {mismatched}/{FRAMES_PER_WINDOW} 帧 argmax 类别不一致"
        );
    }
}

/// WeSpeaker 声纹对拍：同一段音频喂给两个后端，256 维嵌入必须逐维一致。
///
/// 统计池化前的展平顺序错了（MLX 是 NHWC 的 `[B,F',T',C]` 转置成 C·F，candle 是 NCHW 直接 reshape）时，嵌入依然是
/// 256 维、依然 L2 归一化、说话人依然可分，只是数值全错；用余弦距离 + 逐维差值才能钉住这个错误。
#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with WeSpeaker installed"]
fn candle_wespeaker_embedding_matches_mlx() {
    let Some(files) = verified(WESPEAKER_REPO, "wespeaker", "speaker") else {
        return;
    };
    for name in ["test-sample.wav", "chinese-sample.wav"] {
        let audio = audio(name);
        let mlx = {
            let _guard = MLX_LOCK.lock().unwrap();
            let mut embedder = mlx::wespeaker::WeSpeakerEmbedder::load(&files).unwrap();
            SpeakerEmbedding::embed(&mut embedder, &audio).unwrap()
        };
        let mut embedder = candle::WeSpeakerEmbedder::load(&files, &candle_core::Device::Cpu).unwrap();
        let candle = SpeakerEmbedding::embed(&mut embedder, &audio).unwrap();

        assert_eq!(mlx.len(), EMBEDDING_DIM);
        assert_eq!(candle.len(), EMBEDDING_DIM);
        let distance = cosine_distance(&mlx, &candle);
        assert!(distance < 1e-3, "{name}: 两个后端的嵌入余弦距离 {distance:.6} 过大");
        let worst = mlx
            .iter()
            .zip(&candle)
            .map(|(left, right)| (left - right).abs())
            .fold(0.0_f32, f32::max);
        assert!(worst < 5e-3, "{name}: 逐维最大差值 {worst:.6} 过大");
    }
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

fn audio(name: &str) -> Vec<f32> {
    decode_mono(&fixture(name), 16_000).expect("decode fixture")
}

/// 按 `<models-root>/<repo>/.bcut-manifest.json` 核对出一个组件的文件；权重不在时给 `None` 并打印原因。
fn verified(repo: &str, family: &str, component: &'static str) -> Option<VerifiedFiles> {
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
    let files: bundle::ModelFiles =
        serde_json::from_value(json!({ "family": family, "revision": manifest["revision"], "dir": dir.to_string_lossy(), "files": files }))
            .expect("ModelFiles");
    Some(files.verify(component).expect("verify component files"))
}

fn normalize(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .filter(|character| character.is_alphanumeric() || character.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
