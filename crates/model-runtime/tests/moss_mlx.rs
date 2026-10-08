//! MOSS Transcribe Diarize 的真权重测试（移植自 v2 `bcut-speech` 的 e2e）：识别完释放音频前端（Whisper 编码器与
//! 适配器）不改变输出——文字、行、说话人区间与生成的 token 数都与不释放时相同。
//!
//! BAOCUT_TEST_MODELS_DIR="$HOME/Library/Application Support/BaoCut/models" \
//!   cargo test -p model-runtime --test moss_mlx -- --ignored --test-threads=1 --nocapture
//!
//! `BCUT_MOSS_TEST_AUDIO` 可换一段对拍音频。权重不在（没设 `BAOCUT_TEST_MODELS_DIR` 或没有 `.bcut-manifest.json`）
//! 时打印原因后跳过。

#![cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]

use std::path::{Path, PathBuf};

use model_runtime::audio::decode_mono;
use model_runtime::backend::mlx::moss::{MossTranscribeDiarize, QUANTIZATION_PREFERENCE};
use model_runtime::bundle::{self, ModelBundle, VerifiedFiles};
use model_runtime::speech::SegmentingCallbacks;
use serde_json::{Value, json};

const MOSS_REPO: &str = "OpenMOSS-Team/MOSS-Transcribe-Diarize";

/// 按 `<models-root>/<repo>/.bcut-manifest.json` 核对出 `asr` 组件的文件；权重不在时给 `None` 并打印原因。
fn moss_files() -> Option<VerifiedFiles> {
    let Some(root) = std::env::var_os("BAOCUT_TEST_MODELS_DIR") else {
        println!("跳过：没设 BAOCUT_TEST_MODELS_DIR");
        return None;
    };
    let dir = PathBuf::from(root).join(MOSS_REPO);
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
    let bundle: ModelBundle = serde_json::from_value(json!({
        "bundleId": "moss-transcribe-diarize@mlx-8bit",
        "backend": "mlx",
        "device": "metal",
        "components": {
            "asr": { "family": "moss-transcribe-diarize", "revision": manifest["revision"], "dir": dir.to_string_lossy(), "files": files },
        },
        "threads": 4,
        "memoryBudgetBytes": null,
    }))
    .expect("bundle JSON");
    bundle::verify(&bundle).expect("verify bundle").asr
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with MOSS Transcribe Diarize installed"]
fn moss_audio_frontend_release_preserves_output() {
    let Some(files) = moss_files() else {
        return;
    };
    let fixture = std::env::var_os("BCUT_MOSS_TEST_AUDIO")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/test-sample.wav"));
    let audio = decode_mono(&fixture, 16_000).expect("decode fixture");

    let retained = {
        let mut moss = MossTranscribeDiarize::load_with_preference(&files, QUANTIZATION_PREFERENCE).unwrap();
        moss.transcribe_diarized_with(&audio, Some("en"), &mut SegmentingCallbacks::none())
            .unwrap()
    };
    let released = {
        let mut moss = MossTranscribeDiarize::load_with_preference(&files, QUANTIZATION_PREFERENCE).unwrap();
        moss.transcribe_diarized_with_release(&audio, Some("en"), true, &mut SegmentingCallbacks::none())
            .unwrap()
    };

    println!("{}", retained.text);
    assert_eq!(released.text, retained.text);
    assert_eq!(released.rows, retained.rows);
    assert_eq!(released.speaker_ranges, retained.speaker_ranges);
    assert_eq!(released.generation_tokens, retained.generation_tokens);
}
