//! Qwen3-TTS 真权重合成：0.6B / 1.7B Base（参考录音克隆、内置音色）与 CustomVoice（预置说话人），
//! 各念一句中文、一句英文，检查时长合理、不是静音、峰值不超过 −1 dBFS，并把 WAV 写到仓库外供试听。
//!
//! BAOCUT_TEST_MODELS_DIR="$HOME/Library/Application Support/BaoCut/models" \
//!   cargo test -p model-runtime --test synthesize_qwen3_tts -- --ignored --test-threads=1 --nocapture
//!
//! WAV 写到 `BAOCUT_TEST_OUTPUT_DIR`（没设时是系统临时目录下的 `baocut-tts-listen/`）。

#![cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]

use std::path::{Path, PathBuf};
use std::time::Instant;

use model_runtime::bundle::{FAMILY_QWEN3_TTS, FAMILY_QWEN3_TTS_CODEC, FileEntry, ModelFiles, VerifiedFiles};
use model_runtime::synthesize::{self, EngineFiles, TtsAudio, TtsEngineKind, TtsRequest, VoiceSpec, wav};
use serde_json::Value;

const BASE_REPO: &str = "aufklarer/Qwen3-TTS-12Hz-0.6B-Base-MLX-8bit";
const BASE_LARGE_REPO: &str = "aufklarer/Qwen3-TTS-12Hz-1.7B-Base-MLX-8bit";
const CUSTOM_VOICE_REPO: &str = "aufklarer/Qwen3-TTS-12Hz-0.6B-CustomVoice-MLX-bf16";
const CUSTOM_VOICE_LARGE_REPO: &str = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit";
const CODEC_REPO: &str = "Qwen/Qwen3-TTS-Tokenizer-12Hz";

const ZH: &str = "今天下午三点，我们在会议室讨论新版本的发布计划。";
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

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

/// 时长合理（每句 0.5–20 s）、峰值与 RMS 都不是静音、峰值不超过 −1 dBFS。
fn check_and_write(audio: &TtsAudio, name: &str) -> PathBuf {
    assert_eq!(audio.sample_rate, 24_000);
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
    // 峰值限到 −1 dBFS（`synthesize::loudness`）：不再有削到满幅的样本。
    assert!(
        peak <= synthesize::loudness::PEAK_CEILING + 1e-6,
        "{name}: 峰值 {peak} 超过 −1 dBFS"
    );
    assert!(clipped_ratio < 0.001, "{name}: {clipped} 个样本削波");
    assert!(audio.samples.iter().all(|s| s.is_finite()), "{name}: 有 NaN / Inf");
    path
}

fn synthesize_pair(model_repo: &str, voice: VoiceSpec, label: &str) {
    let model = verified(model_repo, FAMILY_QWEN3_TTS, "tts");
    let codec = verified(CODEC_REPO, FAMILY_QWEN3_TTS_CODEC, "codec");
    let started = Instant::now();
    let mut engine = synthesize::load(
        TtsEngineKind::Qwen3Tts,
        EngineFiles {
            model: &model,
            codec: Some(&codec),
            aux: None,
        },
    )
    .expect("load Qwen3-TTS");
    println!(
        "{label}: 加载 {:.2} s，预置说话人 {:?}",
        started.elapsed().as_secs_f32(),
        engine.preset_speakers()
    );
    assert_eq!(engine.kind(), TtsEngineKind::Qwen3Tts);
    assert_eq!(engine.sample_rate(), 24_000);

    for (lang, text) in [("zh", ZH), ("en", EN)] {
        let mut request = TtsRequest::new(text, voice.clone());
        request.language = Some(lang.to_owned());
        request.sampling.seed = Some(7);
        let started = Instant::now();
        let audio = engine.synthesize(&request, &mut |_| true).expect("synthesize");
        println!("{label}-{lang}: 合成 {:.2} s", started.elapsed().as_secs_f32());
        check_and_write(&audio, &format!("qwen3-tts-{label}-{lang}"));
    }
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with the Qwen3-TTS 0.6B Base and tokenizer bundles installed"]
fn base_clones_a_reference_recording_in_chinese_and_english() {
    // 不带参考原文：x-vector 克隆（不经 codec 编码器）。
    synthesize_pair(
        BASE_REPO,
        VoiceSpec::Clone {
            reference_audio: fixture("test-sample.wav"),
            reference_text: None,
        },
        "0.6b-base-clone",
    );
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with the Qwen3-TTS 0.6B Base and tokenizer bundles installed"]
fn base_default_voice_uses_the_builtin_recording() {
    // 内置音色在内存里解码，不落盘；`Default` 走 x-vector。Runtime 发来的内置音色是「录音文件 + 原文」，
    // 走 ICL，见 `base_builtin_voice_levels_with_and_without_the_transcript`。
    synthesize_pair(BASE_REPO, VoiceSpec::Default, "0.6b-base-builtin");
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with the Qwen3-TTS 1.7B Base 8-bit and tokenizer bundles installed"]
fn large_base_default_voice_uses_the_builtin_recording() {
    synthesize_pair(BASE_LARGE_REPO, VoiceSpec::Default, "1.7b-base-builtin");
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with the Qwen3-TTS 0.6B CustomVoice and tokenizer bundles installed"]
fn custom_voice_speaks_with_a_preset_speaker() {
    synthesize_pair(
        CUSTOM_VOICE_REPO,
        VoiceSpec::Preset {
            speaker: "Vivian".to_owned(),
        },
        "0.6b-customvoice-vivian",
    );
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with the Qwen3-TTS 1.7B CustomVoice 8-bit and tokenizer bundles installed"]
fn large_quantized_custom_voice_speaks_with_a_preset_speaker() {
    synthesize_pair(
        CUSTOM_VOICE_LARGE_REPO,
        VoiceSpec::Preset {
            speaker: "Ryan".to_owned(),
        },
        "1.7b-customvoice-ryan",
    );
}

/// 峰值、RMS 与按 400 ms 块门限后的平均电平（dBFS；不做 K 加权，只作相对比较）。
fn levels(samples: &[f32], sample_rate: u32) -> (f32, f32, f32) {
    let db = |power: f64| (10.0 * power.max(1e-12).log10()) as f32;
    let peak = samples.iter().fold(0.0_f32, |max, s| max.max(s.abs()));
    let power = |block: &[f32]| block.iter().map(|s| f64::from(*s) * f64::from(*s)).sum::<f64>() / block.len().max(1) as f64;
    let block = (sample_rate as usize * 2) / 5;
    let blocks: Vec<f64> = samples.chunks(block).filter(|b| b.len() == block).map(power).collect();
    let absolute: Vec<f64> = blocks.iter().copied().filter(|p| db(*p) > -70.0).collect();
    let mean = |values: &[f64]| values.iter().sum::<f64>() / values.len().max(1) as f64;
    let gate = db(mean(&absolute)) - 10.0;
    let gated: Vec<f64> = absolute.iter().copied().filter(|p| db(*p) > gate).collect();
    (20.0 * peak.max(1e-6).log10(), db(power(samples)), db(mean(&gated)))
}

/// 内置音色在 Base 上走 ICL（带原文）与走 x-vector（不带原文）的电平与时长对比，只打印不断言。
#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with the Qwen3-TTS 0.6B Base and tokenizer bundles installed"]
fn base_builtin_voice_levels_with_and_without_the_transcript() {
    let model = verified(BASE_REPO, FAMILY_QWEN3_TTS, "tts");
    let codec = verified(CODEC_REPO, FAMILY_QWEN3_TTS_CODEC, "codec");
    let mut engine = synthesize::load(
        TtsEngineKind::Qwen3Tts,
        EngineFiles {
            model: &model,
            codec: Some(&codec),
            aux: None,
        },
    )
    .expect("load Qwen3-TTS");
    for (id, lang, text) in [
        ("zh-female", "zh", ZH),
        ("zh-male", "zh", ZH),
        ("en-female", "en", EN),
        ("en-male", "en", EN),
    ] {
        let voice = synthesize::voices::find(id).unwrap();
        let file = output_dir().join(format!("builtin-{id}.wav"));
        std::fs::write(&file, synthesize::voices::wav(voice)).unwrap();
        let (recording, rate) = wav::read_wav_pcm16(&file).unwrap();
        let (peak, rms, gated) = levels(&recording, rate);
        println!(
            "{id} recording: {:.2} s, peak {peak:.1} dBFS, rms {rms:.1} dBFS, gated {gated:.1} dB",
            voice.seconds
        );
        for (label, transcript) in [("icl", Some(voice.text.to_owned())), ("xvector", None)] {
            let mut request = TtsRequest::new(
                text,
                VoiceSpec::Clone {
                    reference_audio: file.clone(),
                    reference_text: transcript,
                },
            );
            request.language = Some(lang.to_owned());
            request.sampling.seed = Some(7);
            let audio = engine.synthesize(&request, &mut |_| true).expect("synthesize");
            let (peak, rms, gated) = levels(&audio.samples, audio.sample_rate);
            let seconds = audio.samples.len() as f32 / audio.sample_rate as f32;
            let path = check_and_write(&audio, &format!("qwen3-tts-0.6b-base-{id}-{label}"));
            println!(
                "{id} {label}: {seconds:.2} s, peak {peak:.1} dBFS, rms {rms:.1} dBFS, gated {gated:.1} dB → {}",
                path.display()
            );
        }
    }
}

// ---- 长旁白的块接缝实验 ----
//
// 同一段长旁白按六种方式各出一份 WAV，比较段与段之间的停顿、音高与响度是否一致（复现工具，只打印不断言）：
//
// | 行 | 模型 | 调用 | 采样 |
// | a | 0.6B CustomVoice Vivian + 语气说明 | 整段一次（引擎内部切块） | 默认，seed 7 |
// | b | 同上 | 整段一次 | temperature 0.6，seed 7 |
// | c | 同上 | 按句（。！？）逐句调用 | 默认，每句同一个 seed 7 |
// | d | 同上 | 按句逐句调用 | 默认，每句不同 seed（1000 + 句序） |
// | e | 1.7B CustomVoice 8-bit Vivian + 语气说明 | 整段一次 | 默认，seed 7 |
// | f | 0.6B Base，内置音色 zh-female（录音 + 原文，ICL） | 整段一次 | 默认，seed 7 |
//
// BAOCUT_TEST_MODELS_DIR=<models-root> BAOCUT_TEST_OUTPUT_DIR=<仓库外目录> \
//   BAOCUT_TTS_EXP_SCRIPT=<台词.txt> BAOCUT_TTS_EXP_INSTRUCT=<语气说明.txt> [BAOCUT_TTS_EXP_ROWS=abcdef] \
//   cargo test -p model-runtime --test synthesize_qwen3_tts long_narration_seam_experiment -- --ignored --test-threads=1 --nocapture
//
// 每行写 `seam-exp-<行>.wav` 与 `seam-exp-<行>.segments.json`（`[{start, end, text}]`：整段调用的是引擎报的块，
// 逐句调用的是每句在拼接结果里的位置）；c、d 另写逐句的 `seam-exp-<行>-<NN>.wav`，句间插 0.3 s 静音拼成整份。

/// 逐句拼接时句间插的静音（秒）。
const SENTENCE_GAP_SECONDS: f32 = 0.3;

fn experiment_text(var: &str) -> String {
    let path = std::env::var(var).unwrap_or_else(|_| panic!("set {var} to a UTF-8 text file"));
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {path}: {error}"))
        .trim()
        .to_owned()
}

fn load_qwen3(repo: &str) -> Box<dyn synthesize::TtsEngine> {
    let model = verified(repo, FAMILY_QWEN3_TTS, "tts");
    let codec = verified(CODEC_REPO, FAMILY_QWEN3_TTS_CODEC, "codec");
    synthesize::load(
        TtsEngineKind::Qwen3Tts,
        EngineFiles {
            model: &model,
            codec: Some(&codec),
            aux: None,
        },
    )
    .expect("load Qwen3-TTS")
}

fn write_segments(name: &str, segments: &[(f64, f64, String)]) {
    let json: Vec<Value> = segments
        .iter()
        .map(|(start, end, text)| serde_json::json!({ "start": start, "end": end, "text": text }))
        .collect();
    let path = output_dir().join(format!("{name}.segments.json"));
    std::fs::write(&path, serde_json::to_vec_pretty(&json).unwrap()).expect("write segments");
}

fn report(name: &str, audio: &TtsAudio, elapsed: f32, units: usize) {
    let seconds = audio.samples.len() as f32 / audio.sample_rate as f32;
    let path = output_dir().join(format!("{name}.wav"));
    wav::write_wav_pcm16(&path, &audio.samples, audio.sample_rate).expect("write wav");
    println!(
        "{name}: {seconds:.2} s，{:.3} s/字，合成 {elapsed:.1} s（RTF {:.2}）→ {}",
        seconds / units as f32,
        elapsed / seconds,
        path.display()
    );
}

/// 整段一次：引擎自己切块；块的位置取自 `ChunkFinished.seconds`（累计秒数）。
fn whole_passage(engine: &mut Box<dyn synthesize::TtsEngine>, name: &str, request: &TtsRequest, units: usize) {
    let chunks = synthesize::text::chunk(&request.text, synthesize::text::DEFAULT_MAX_UNITS);
    let mut ends: Vec<f64> = Vec::new();
    let started = Instant::now();
    let audio = engine
        .synthesize(request, &mut |progress| {
            if let synthesize::TtsProgress::ChunkFinished { seconds, .. } = progress {
                ends.push(seconds);
            }
            true
        })
        .expect("synthesize");
    let elapsed = started.elapsed().as_secs_f32();
    assert_eq!(ends.len(), chunks.len(), "{name}: 每块报一次 ChunkFinished");
    let total = audio.samples.len() as f64 / f64::from(audio.sample_rate);
    assert!(
        (ends.last().unwrap() - total).abs() < 1e-6,
        "{name}: 最后一次 ChunkFinished 应等于总时长"
    );
    let mut start = 0.0;
    let segments: Vec<(f64, f64, String)> = ends
        .iter()
        .zip(&chunks)
        .map(|(&end, text)| {
            let segment = (start, end, text.clone());
            start = end;
            segment
        })
        .collect();
    write_segments(name, &segments);
    report(name, &audio, elapsed, units);
}

/// 按句逐句调用，句间插 [`SENTENCE_GAP_SECONDS`] 静音拼成整份。
fn per_sentence(engine: &mut Box<dyn synthesize::TtsEngine>, name: &str, base: &TtsRequest, seed: impl Fn(usize) -> u64, units: usize) {
    let sentences = synthesize::text::split_sentences(&base.text);
    let mut samples: Vec<f32> = Vec::new();
    let mut segments: Vec<(f64, f64, String)> = Vec::new();
    let mut sample_rate = 0;
    let started = Instant::now();
    for (index, sentence) in sentences.iter().enumerate() {
        let mut request = base.clone();
        request.text = sentence.clone();
        request.sampling.seed = Some(seed(index));
        let audio = engine.synthesize(&request, &mut |_| true).expect("synthesize");
        sample_rate = audio.sample_rate;
        let path = output_dir().join(format!("{name}-{:02}.wav", index + 1));
        wav::write_wav_pcm16(&path, &audio.samples, audio.sample_rate).expect("write wav");
        if index > 0 {
            samples.extend(std::iter::repeat_n(0.0, (SENTENCE_GAP_SECONDS * audio.sample_rate as f32) as usize));
        }
        let start = samples.len() as f64 / f64::from(audio.sample_rate);
        samples.extend_from_slice(&audio.samples);
        segments.push((start, samples.len() as f64 / f64::from(audio.sample_rate), sentence.clone()));
    }
    let elapsed = started.elapsed().as_secs_f32();
    write_segments(name, &segments);
    let audio = TtsAudio {
        samples,
        sample_rate,
        readings_dropped: Vec::new(),
    };
    report(name, &audio, elapsed, units);
}

#[test]
#[ignore = "experiment: needs BAOCUT_TEST_MODELS_DIR (Qwen3-TTS 0.6B CustomVoice / Base, 1.7B CustomVoice 8-bit, tokenizer) and BAOCUT_TTS_EXP_SCRIPT / BAOCUT_TTS_EXP_INSTRUCT"]
fn long_narration_seam_experiment() {
    let script = experiment_text("BAOCUT_TTS_EXP_SCRIPT");
    let instruct = experiment_text("BAOCUT_TTS_EXP_INSTRUCT");
    let rows = std::env::var("BAOCUT_TTS_EXP_ROWS").unwrap_or_else(|_| "abcdef".to_owned());
    let units = synthesize::text::count_units(&script);
    let chunks = synthesize::text::chunk(&script, synthesize::text::DEFAULT_MAX_UNITS);
    let sentences = synthesize::text::split_sentences(&script);
    println!(
        "台词 {units} 字；引擎切 {} 块（{:?} 字）；按句 {} 句",
        chunks.len(),
        chunks.iter().map(|c| synthesize::text::count_units(c)).collect::<Vec<_>>(),
        sentences.len()
    );

    let vivian = |text: &str| {
        let mut request = TtsRequest::new(
            text,
            VoiceSpec::Preset {
                speaker: "Vivian".to_owned(),
            },
        );
        request.language = Some("zh".to_owned());
        request.instruct = Some(instruct.clone());
        request.sampling.seed = Some(7);
        request
    };

    // a–d 共用 0.6B CustomVoice，加载一次；跑完释放再加载下一只。
    if rows.contains(['a', 'b', 'c', 'd']) {
        let mut engine = load_qwen3(CUSTOM_VOICE_REPO);
        if rows.contains('a') {
            whole_passage(&mut engine, "seam-exp-a", &vivian(&script), units);
        }
        if rows.contains('b') {
            let mut request = vivian(&script);
            request.sampling.temperature = Some(0.6);
            whole_passage(&mut engine, "seam-exp-b", &request, units);
        }
        if rows.contains('c') {
            per_sentence(&mut engine, "seam-exp-c", &vivian(&script), |_| 7, units);
        }
        if rows.contains('d') {
            per_sentence(&mut engine, "seam-exp-d", &vivian(&script), |index| 1000 + index as u64, units);
        }
    }
    if rows.contains('e') {
        let mut engine = load_qwen3(CUSTOM_VOICE_LARGE_REPO);
        whole_passage(&mut engine, "seam-exp-e", &vivian(&script), units);
    }
    if rows.contains('f') {
        let mut engine = load_qwen3(BASE_REPO);
        // Runtime 发来的内置音色就是「录音文件 + 原文」：Base 上走 ICL。Base 不吃语气说明。
        let voice = synthesize::voices::find("zh-female").unwrap();
        let file = output_dir().join("builtin-zh-female.wav");
        std::fs::write(&file, synthesize::voices::wav(voice)).unwrap();
        let mut request = TtsRequest::new(
            &script,
            VoiceSpec::Clone {
                reference_audio: file,
                reference_text: Some(voice.text.to_owned()),
            },
        );
        request.language = Some("zh".to_owned());
        request.sampling.seed = Some(7);
        whole_passage(&mut engine, "seam-exp-f", &request, units);
    }
}
