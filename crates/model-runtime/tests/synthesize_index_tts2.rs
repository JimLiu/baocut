//! IndexTTS2 与 IndexTTS 2.5 真权重合成：两只模型各用内置音色念一句中文、一句英文，再各带一次
//! 情绪预设向量（八维滑块的一维拉满 + 官方缺省情感权重）、各念一句带 `<行|hang2>` 注音的中文；2.5 另测一次
//! 语速旋钮。检查时长合理、不是静音、没有严重削波、注音没被丢，并把 WAV 写到仓库外供试听。
//!
//! BAOCUT_TEST_MODELS_DIR="$HOME/Library/Application Support/BaoCut/models" \
//!   cargo test -p model-runtime --test synthesize_index_tts2 -- --ignored --test-threads=1 --nocapture
//!
//! WAV 写到 `BAOCUT_TEST_OUTPUT_DIR`（没设时是系统临时目录下的 `baocut-tts-listen/`）。

#![cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]

use std::path::{Path, PathBuf};
use std::time::Instant;

use model_runtime::bundle::{FAMILY_INDEX_TTS2, FAMILY_INDEX_TTS2_AUX, FAMILY_INDEX_TTS25, FileEntry, ModelFiles, VerifiedFiles};
use model_runtime::synthesize::types::{DEFAULT_EMOTION_ALPHA, EmotionSpec};
use model_runtime::synthesize::{self, EngineFiles, TtsAudio, TtsEngine, TtsEngineKind, TtsRequest, VoiceSpec, wav};
use serde_json::Value;

const INDEX_TTS2_REPO: &str = "aufklarer/IndexTTS2-MLX-fp16";
const INDEX_TTS25_REPO: &str = "mlx-community/IndexTTS-2.5-fp16";

const ZH: &str = "今天下午三点，我们在会议室讨论新版本的发布计划。";
const EN: &str = "The quick brown fox jumps over the lazy dog near the river bank.";
const ZH_HAPPY: &str = "太好了，我们终于把这个版本按时发布了！";
/// 「行」在这里读 hang2；不注音时模型多半念成 xing2。
const ZH_READING: &str = "他在这一<行|hang2>做了十年，经验很丰富。";

/// 八维情感滑块的次序：happy, angry, sad, afraid, disgusted, melancholic, surprised, calm。
const HAPPY: [f32; 8] = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

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
    assert_eq!(audio.sample_rate, 22_050);
    let seconds = audio.samples.len() as f32 / audio.sample_rate as f32;
    let peak = audio.samples.iter().fold(0.0_f32, |max, s| max.max(s.abs()));
    let rms = (audio.samples.iter().map(|s| s * s).sum::<f32>() / audio.samples.len().max(1) as f32).sqrt();
    let clipped = audio.samples.iter().filter(|s| s.abs() >= 0.999).count() as f32 / audio.samples.len().max(1) as f32;
    let path = output_dir().join(format!("{name}.wav"));
    wav::write_wav_pcm16(&path, &audio.samples, audio.sample_rate).expect("write wav");
    println!(
        "{name}: {seconds:.2} s, peak {peak:.3}, rms {rms:.4}, clipped {:.3}% → {}",
        clipped * 100.0,
        path.display()
    );
    assert!((0.5..=20.0).contains(&seconds), "{name}: {seconds:.2} s 不在 0.5–20 s 内");
    assert!(peak > 0.01, "{name}: 峰值 {peak} 像静音");
    assert!(rms > 0.003, "{name}: RMS {rms} 像静音");
    assert!(clipped < 0.001, "{name}: {:.3}% 的样本削波", clipped * 100.0);
    assert!(audio.samples.iter().all(|s| s.is_finite()), "{name}: 有 NaN / Inf");
    path
}

/// 2.0 只有主模型组件；2.5 另带 `aux` 组件（整个 IndexTTS2 仓库）。
fn load(kind: TtsEngineKind) -> Box<dyn TtsEngine> {
    let (model, aux) = match kind {
        TtsEngineKind::IndexTts2 => (verified(INDEX_TTS2_REPO, FAMILY_INDEX_TTS2, "tts"), None),
        TtsEngineKind::IndexTts25 => (
            verified(INDEX_TTS25_REPO, FAMILY_INDEX_TTS25, "tts"),
            Some(verified(INDEX_TTS2_REPO, FAMILY_INDEX_TTS2_AUX, "aux")),
        ),
        other => panic!("not an IndexTTS engine: {other:?}"),
    };
    let started = Instant::now();
    let engine = synthesize::load(
        kind,
        EngineFiles {
            model: &model,
            codec: None,
            aux: aux.as_ref(),
        },
    )
    .expect("load IndexTTS");
    println!("{}: 加载 {:.2} s", kind.as_str(), started.elapsed().as_secs_f32());
    assert_eq!(engine.kind(), kind);
    assert_eq!(engine.sample_rate(), 22_050);
    assert!(engine.preset_speakers().contains(&"zh-female".to_owned()), "内置音色当预置说话人");
    engine
}

fn speak(engine: &mut dyn TtsEngine, request: &TtsRequest, name: &str) -> f32 {
    speak_audio(engine, request, name).duration_seconds() as f32
}

fn speak_audio(engine: &mut dyn TtsEngine, request: &TtsRequest, name: &str) -> TtsAudio {
    let started = Instant::now();
    let mut chunks = 0;
    let audio = engine
        .synthesize(request, &mut |progress| {
            if let synthesize::TtsProgress::ChunkFinished { .. } = progress {
                chunks += 1;
            }
            true
        })
        .expect("synthesize");
    println!("{name}: 合成 {:.2} s，{chunks} 段", started.elapsed().as_secs_f32());
    assert!(chunks >= 1);
    check_and_write(&audio, name);
    audio
}

/// 用内置音色（`Default` 按语言挑）各念一句中文、一句英文，再用中文内置音色带「开心」预设念一句。
fn synthesize_set(engine: &mut dyn TtsEngine, label: &str) {
    for (lang, text) in [("zh", ZH), ("en", EN)] {
        let mut request = TtsRequest::new(text, VoiceSpec::Default);
        request.language = Some(lang.to_owned());
        request.sampling.seed = Some(7);
        speak(engine, &request, &format!("{label}-builtin-{lang}"));
    }

    let mut request = TtsRequest::new(
        ZH_HAPPY,
        VoiceSpec::Preset {
            speaker: "zh-female".to_owned(),
        },
    );
    request.language = Some("zh".to_owned());
    request.sampling.seed = Some(7);
    request.emotion = Some(EmotionSpec::Vector {
        weights: HAPPY,
        alpha: DEFAULT_EMOTION_ALPHA,
    });
    speak(engine, &request, &format!("{label}-emotion-happy-zh"));

    // 注音：2.0 换成词表拼音片，2.5 原样吃 `<字|读音>`；两者都不该报 dropped。
    let mut request = TtsRequest::new(ZH_READING, VoiceSpec::Default);
    request.language = Some("zh".to_owned());
    request.sampling.seed = Some(7);
    let audio = speak_audio(engine, &request, &format!("{label}-reading-hang2-zh"));
    assert!(
        audio.readings_dropped.is_empty(),
        "{label}: 注音被丢了：{:?}",
        audio.readings_dropped
    );
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with the IndexTTS2 bundle installed"]
fn index_tts2_speaks_with_builtin_voices_and_an_emotion_preset() {
    let mut engine = load(TtsEngineKind::IndexTts2);
    synthesize_set(engine.as_mut(), "index-tts2");
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with the IndexTTS 2.5 bundle installed"]
fn index_tts25_speaks_with_builtin_voices_an_emotion_preset_and_a_speed_knob() {
    let mut engine = load(TtsEngineKind::IndexTts25);
    synthesize_set(engine.as_mut(), "index-tts2.5");

    // 语速只缩放长度规整的目标帧数：同一句、同一种子，1.4 倍语速明显更短。
    let mut request = TtsRequest::new(ZH, VoiceSpec::Default);
    request.language = Some("zh".to_owned());
    request.sampling.seed = Some(7);
    let normal = speak(engine.as_mut(), &request, "index-tts2.5-speed-1.0-zh");
    request.speed = Some(1.4);
    let fast = speak(engine.as_mut(), &request, "index-tts2.5-speed-1.4-zh");
    println!("语速 1.0 → {normal:.2} s，1.4 → {fast:.2} s");
    assert!(fast < normal * 0.9, "1.4 倍语速没有变短：{normal:.2} s → {fast:.2} s");

    // 越界的语速在装参考音频之前就被拒绝。
    request.speed = Some(3.0);
    assert!(engine.synthesize(&request, &mut |_| true).is_err());
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with the IndexTTS2 bundle installed"]
fn index_tts2_clones_a_file_takes_emotion_from_audio_and_cancels() {
    let mut engine = load(TtsEngineKind::IndexTts2);
    let mut request = TtsRequest::new(
        ZH,
        VoiceSpec::Clone {
            reference_audio: fixture("chinese-sample.wav"),
            reference_text: None,
        },
    );
    request.sampling.seed = Some(7);
    speak(engine.as_mut(), &request, "index-tts2-clone-zh");

    // 情感参考音频按 alpha 与音色参考混合。
    request.emotion = Some(EmotionSpec::Audio {
        reference_audio: fixture("test-sample.wav"),
        alpha: 0.5,
    });
    speak(engine.as_mut(), &request, "index-tts2-clone-emotion-audio-zh");

    // 进度回调返回 false：在下一个安全点停下并报取消。
    let error = engine
        .synthesize(
            &request,
            &mut |progress| !matches!(progress, synthesize::TtsProgress::Tokens { generated, .. } if generated >= 5),
        )
        .unwrap_err();
    assert!(error.to_string().contains("取消"), "{error}");
}
