//! GPT-SoVITS v2 真权重合成：用内置音色的随包录音与它的原文做参考，念一句带读音注记的中文、
//! 一句英文，检查时长合理、不是静音、没有严重削波，注记按「不认读音」如实报告，并把 WAV 写到仓库外供试听。
//!
//! BAOCUT_TEST_MODELS_DIR="$HOME/Library/Application Support/BaoCut/models" \
//!   cargo test -p model-runtime --test synthesize_gpt_sovits -- --ignored --test-threads=1 --nocapture
//!
//! WAV 写到 `BAOCUT_TEST_OUTPUT_DIR`（没设时是系统临时目录下的 `baocut-tts-listen/`）。

#![cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]

use std::path::PathBuf;
use std::time::Instant;

use model_runtime::bundle::{FAMILY_GPT_SOVITS, FileEntry, ModelFiles, VerifiedFiles};
use model_runtime::synthesize::readings::Origin;
use model_runtime::synthesize::{self, EngineFiles, TtsAudio, TtsEngineKind, TtsRequest, VoiceSpec, wav};
use serde_json::Value;

const REPO: &str = "PJMixers-Dev/lj1995_GPT-SoVITS-safetensors";

/// 一个读音注记：GPT-SoVITS 不认读音，送进模型的是表面文字，注记报进 `readings_dropped`。
const ZH: &str = "他在这一<行|hang2>做了十年，今天下午三点我们开会讨论新版本的发布计划。";
const EN: &str = "The quick brown fox jumps over the lazy dog near the river bank.";

fn models_root() -> PathBuf {
    PathBuf::from(std::env::var("BAOCUT_TEST_MODELS_DIR").expect("set BAOCUT_TEST_MODELS_DIR to the models root"))
}

fn output_dir() -> PathBuf {
    let dir = std::env::var_os("BAOCUT_TEST_OUTPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("baocut-tts-listen"));
    std::fs::create_dir_all(&dir).expect("create output dir");
    dir
}

/// 从 `<models-root>/<repo>/.bcut-manifest.json` 构造并校验一个组件的文件清单。
fn verified(repo: &str, family: &str, component: &'static str) -> VerifiedFiles {
    let dir = models_root().join(repo);
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(dir.join(".bcut-manifest.json")).expect("read .bcut-manifest.json")).expect("manifest JSON");
    let files = manifest["files"]
        .as_array()
        .expect("manifest files")
        .iter()
        .map(|file| FileEntry {
            path: file["path"].as_str().expect("path").to_owned(),
            sha256: file["sha256"].as_str().unwrap_or_default().to_owned(),
            byte_length: file["size"].as_u64().expect("size"),
        })
        .collect();
    ModelFiles {
        family: family.to_owned(),
        revision: manifest["revision"].as_str().unwrap_or_default().to_owned(),
        dir: dir.to_string_lossy().into_owned(),
        files,
    }
    .verify(component)
    .expect("verify bundle files")
}

/// 时长合理（每句 0.5–20 s）、峰值与 RMS 都不是静音、削波（|x| ≥ 0.999）的样本不到 0.1%。
fn check_and_write(audio: &TtsAudio, name: &str) -> PathBuf {
    assert_eq!(audio.sample_rate, 32_000);
    let seconds = audio.samples.len() as f32 / audio.sample_rate as f32;
    let peak = audio.samples.iter().fold(0.0_f32, |max, s| max.max(s.abs()));
    let rms = (audio.samples.iter().map(|s| s * s).sum::<f32>() / audio.samples.len().max(1) as f32).sqrt();
    let clipped = audio.samples.iter().filter(|s| s.abs() >= 0.999).count();
    let clipped_ratio = clipped as f32 / audio.samples.len().max(1) as f32;
    let path = output_dir().join(format!("{name}.wav"));
    wav::write_wav_pcm16(&path, &audio.samples, audio.sample_rate).expect("write wav");
    println!(
        "{name}: {seconds:.2} s, peak {peak:.3}, rms {rms:.4}, clipped {clipped} ({:.4}%) → {}",
        clipped_ratio * 100.0,
        path.display()
    );
    assert!((0.5..=20.0).contains(&seconds), "{name}: {seconds:.2} s 不在 0.5–20 s 内");
    assert!(peak > 0.01, "{name}: 峰值 {peak} 像静音");
    assert!(rms > 0.003, "{name}: RMS {rms} 像静音");
    assert!(clipped_ratio < 0.001, "{name}: {clipped} 个样本削波");
    assert!(audio.samples.iter().all(|s| s.is_finite()), "{name}: 有 NaN / Inf");
    path
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with the GPT-SoVITS v2 bundle installed"]
fn builtin_voices_speak_chinese_with_a_reading_and_english() {
    let model = verified(REPO, FAMILY_GPT_SOVITS, "tts");
    let started = Instant::now();
    let mut engine = synthesize::load(
        TtsEngineKind::GptSovits,
        EngineFiles {
            model: &model,
            codec: None,
            aux: None,
        },
    )
    .expect("load GPT-SoVITS");
    println!("加载 {:.2} s", started.elapsed().as_secs_f32());
    assert_eq!(engine.kind(), TtsEngineKind::GptSovits);
    assert_eq!(engine.sample_rate(), 32_000);
    assert!(engine.preset_speakers().contains(&"zh-female".to_owned()));

    // 内置音色：随包录音 + 原文作参考（有参考文本的克隆路径）。
    for (lang, text, speaker) in [("zh", ZH, "zh-female"), ("en", EN, "en-male")] {
        let mut request = TtsRequest::new(
            text,
            VoiceSpec::Preset {
                speaker: speaker.to_owned(),
            },
        );
        request.language = Some(lang.to_owned());
        request.sampling.seed = Some(7);
        let started = Instant::now();
        let audio = engine.synthesize(&request, &mut |_| true).expect("synthesize");
        println!(
            "{lang}: 合成 {:.2} s，未按注记念的读音 {:?}",
            started.elapsed().as_secs_f32(),
            audio.readings_dropped
        );
        check_and_write(&audio, &format!("gpt-sovits-{speaker}-{lang}"));
        if lang == "zh" {
            // 不认读音：如实报告，偏移落在去注记后的表面文字上（「他在这一行」的「行」）。
            assert_eq!(audio.readings_dropped.len(), 1, "{:?}", audio.readings_dropped);
            let dropped = &audio.readings_dropped[0];
            assert_eq!((dropped.start, dropped.end), (4, 5));
            assert_eq!(dropped.reading, "hang2");
            assert_eq!(dropped.origin, Origin::User);
        } else {
            assert!(audio.readings_dropped.is_empty());
        }
    }
}
