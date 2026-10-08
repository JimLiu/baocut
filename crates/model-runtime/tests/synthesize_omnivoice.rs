//! OmniVoice 真权重合成：内置音色（克隆）念中英文各一句、受限词表的声音描述（音色设计）、
//! 目标时长；检查时长合理、不是静音，并把 WAV 写到仓库外供试听。
//!
//! BAOCUT_TEST_MODELS_DIR="$HOME/Library/Application Support/BaoCut/models" \
//!   cargo test -p model-runtime --test synthesize_omnivoice -- --ignored --test-threads=1 --nocapture
//!
//! 权重不在（没设 `BAOCUT_TEST_MODELS_DIR` 或没有 `.bcut-manifest.json`）时打印原因后跳过。
//! WAV 写到 `BAOCUT_TEST_OUTPUT_DIR`（没设时是系统临时目录下的 `baocut-tts-listen/`）。

#![cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]

use std::path::PathBuf;
use std::time::Instant;

use model_runtime::bundle::{FAMILY_OMNIVOICE, FileEntry, ModelFiles, VerifiedFiles};
use model_runtime::synthesize::{self, EngineFiles, TtsAudio, TtsEngine, TtsEngineKind, TtsRequest, VoiceSpec, wav};
use serde_json::Value;

const REPO: &str = "aufklarer/OmniVoice-MLX-int8";
const SAMPLE_RATE: u32 = 24_000;

const ZH: &str = "今天下午三点，我们在会议室讨论新版本的发布计划。";
const EN: &str = "The quick brown fox jumps over the lazy dog near the river bank.";

fn output_dir() -> PathBuf {
    let dir = std::env::var_os("BAOCUT_TEST_OUTPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("baocut-tts-listen"));
    std::fs::create_dir_all(&dir).expect("create output dir");
    dir
}

/// 从 `<models-root>/<repo>/.bcut-manifest.json` 构造并校验文件清单；权重不在时给 `None` 并打印原因。
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
    Some(
        ModelFiles {
            family: family.to_owned(),
            revision: manifest["revision"].as_str().unwrap_or_default().to_owned(),
            dir: dir.to_string_lossy().into_owned(),
            files,
        }
        .verify(component)
        .expect("verify bundle files"),
    )
}

/// 时长合理（每句 0.5–20 s）、峰值与 RMS 都不是静音。返回秒数。
fn check_and_write(audio: &TtsAudio, name: &str) -> f32 {
    assert_eq!(audio.sample_rate, SAMPLE_RATE);
    let seconds = audio.samples.len() as f32 / audio.sample_rate as f32;
    let peak = audio.samples.iter().fold(0.0_f32, |max, s| max.max(s.abs()));
    let rms = (audio.samples.iter().map(|s| s * s).sum::<f32>() / audio.samples.len().max(1) as f32).sqrt();
    let path = output_dir().join(format!("{name}.wav"));
    wav::write_wav_pcm16(&path, &audio.samples, audio.sample_rate).expect("write wav");
    println!("{name}: {seconds:.2} s, peak {peak:.3}, rms {rms:.4} → {}", path.display());
    assert!((0.5..=20.0).contains(&seconds), "{name}: {seconds:.2} s 不在 0.5–20 s 内");
    assert!(peak > 0.01, "{name}: 峰值 {peak} 像静音");
    assert!(rms > 0.003, "{name}: RMS {rms} 像静音");
    assert!(audio.samples.iter().all(|s| s.is_finite()), "{name}: 有 NaN / Inf");
    seconds
}

fn synthesize_one(engine: &mut dyn TtsEngine, request: &TtsRequest, name: &str) -> f32 {
    let started = Instant::now();
    let audio = engine.synthesize(request, &mut |_| true).expect("synthesize");
    println!("{name}: 合成 {:.2} s", started.elapsed().as_secs_f32());
    check_and_write(&audio, name)
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with aufklarer/OmniVoice-MLX-int8 installed"]
fn omnivoice_speaks_chinese_and_english_designs_a_voice_and_meets_a_target_duration() {
    let Some(model) = verified(REPO, FAMILY_OMNIVOICE, "tts") else {
        return;
    };
    let started = Instant::now();
    let mut engine = synthesize::load(
        TtsEngineKind::OmniVoice,
        EngineFiles {
            model: &model,
            codec: None,
            aux: None,
        },
    )
    .expect("load OmniVoice");
    println!("OmniVoice: 加载 {:.2} s", started.elapsed().as_secs_f32());
    assert_eq!(engine.kind(), TtsEngineKind::OmniVoice);
    assert_eq!(engine.sample_rate(), SAMPLE_RATE);

    // 默认音色 = 该语言的内置音色作参考（克隆）。
    for (lang, text) in [("zh", ZH), ("en", EN)] {
        let mut request = TtsRequest::new(text, VoiceSpec::Default);
        request.language = Some(lang.to_owned());
        request.sampling.seed = Some(7);
        synthesize_one(engine.as_mut(), &request, &format!("omnivoice-builtin-{lang}"));
    }

    // 受限词表的声音描述（音色设计，不带参考音频）：英文词条配英文正文，中文词条配中文正文。
    for (lang, text, instruct) in [("en", EN, "female, low pitch, british accent"), ("zh", ZH, "男，老年，四川话")] {
        let mut request = TtsRequest::new(text, VoiceSpec::Default);
        request.language = Some(lang.to_owned());
        request.instruct = Some(instruct.to_owned());
        request.sampling.seed = Some(7);
        synthesize_one(engine.as_mut(), &request, &format!("omnivoice-design-{lang}"));
    }

    // 目标时长：单块直接定 token 数；后处理去长静音、两侧各补 0.1 s，所以只要求接近目标。
    let target = 6.0;
    let mut request = TtsRequest::new(ZH, VoiceSpec::Default);
    request.language = Some("zh".to_owned());
    request.target_duration_seconds = Some(target);
    request.sampling.seed = Some(7);
    let seconds = synthesize_one(engine.as_mut(), &request, "omnivoice-duration-6s-zh");
    assert!((f64::from(seconds) - target).abs() <= 1.0, "目标 {target} s，实际 {seconds:.2} s");
}
