//! Pyannote 分段 + WeSpeaker 声纹聚类的带权重 e2e（移植自 v2 `bcut-speech` 的 `pyannote_e2e`）：
//!
//! BAOCUT_TEST_MODELS_DIR=… cargo test -p model-runtime --test pyannote_e2e -- --ignored --test-threads=1 --nocapture
//! BAOCUT_TEST_MODELS_DIR=… cargo test -p model-runtime --no-default-features --features backend-candle \
//!   --test pyannote_e2e -- --ignored --test-threads=1 --nocapture
//!
//! 启用了 candle 就测 candle（CPU），否则测 MLX。权重按 `<BAOCUT_TEST_MODELS_DIR>/<repo>/.bcut-manifest.json` 核对后
//! 加载，不在时打印原因后跳过。

#![cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use model_runtime::audio::decode_mono;
use model_runtime::bundle::{self, VerifiedFiles};
use model_runtime::speech::pyannote_common::{DiarizedSegment, PyannoteCallbacks, PyannoteOptions};
use serde_json::{Value, json};

const PYANNOTE_REPO: &str = "aufklarer/Pyannote-Segmentation-MLX";
const WESPEAKER_REPO: &str = "aufklarer/WeSpeaker-ResNet34-LM-MLX";

#[cfg(feature = "backend-candle")]
struct Diarizer(model_runtime::backend::candle::PyannoteDiarizer);

#[cfg(feature = "backend-candle")]
impl Diarizer {
    fn load(segmentation: &VerifiedFiles, speaker: Option<&VerifiedFiles>) -> Self {
        use model_runtime::backend::candle::PyannoteDiarizer;
        let device = candle_core::Device::Cpu;
        Self(match speaker {
            Some(speaker) => PyannoteDiarizer::load_with_embedding(segmentation, speaker, &device).unwrap(),
            None => PyannoteDiarizer::load(segmentation, &device).unwrap(),
        })
    }

    fn diarize(&mut self, audio: &[f32], options: &PyannoteOptions) -> Vec<DiarizedSegment> {
        self.0.diarize_with(audio, options, &mut PyannoteCallbacks::default()).unwrap()
    }
}

#[cfg(not(feature = "backend-candle"))]
struct Diarizer(model_runtime::backend::mlx::pyannote::PyannoteDiarizer);

#[cfg(not(feature = "backend-candle"))]
impl Diarizer {
    fn load(segmentation: &VerifiedFiles, speaker: Option<&VerifiedFiles>) -> Self {
        use model_runtime::backend::mlx::pyannote::PyannoteDiarizer;
        Self(match speaker {
            Some(speaker) => PyannoteDiarizer::load_with_embedding(segmentation, speaker).unwrap(),
            None => PyannoteDiarizer::load(segmentation).unwrap(),
        })
    }

    fn diarize(&mut self, audio: &[f32], options: &PyannoteOptions) -> Vec<DiarizedSegment> {
        self.0.diarize_with(audio, options, &mut PyannoteCallbacks::default()).unwrap()
    }
}

/// 有声纹模型就走「分割 + 声纹再识别」，否则纯 IoU。
fn load_diarizer() -> Option<Diarizer> {
    let segmentation = verified(PYANNOTE_REPO, "pyannote-segmentation", "segmentation")?;
    let speaker = verified(WESPEAKER_REPO, "wespeaker", "speaker");
    Some(Diarizer::load(&segmentation, speaker.as_ref()))
}

#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with Pyannote installed"]
fn pyannote_diarizes_reference_fixture() {
    let Some(mut diarizer) = load_diarizer() else {
        return;
    };
    let audio = audio("test-sample.wav");
    let duration = audio.len() as f64 / 16_000.0;
    let segments = diarizer.diarize(
        &audio,
        &PyannoteOptions {
            max_speakers: Some(8),
            ..PyannoteOptions::default()
        },
    );

    assert!(!segments.is_empty());
    assert!(segments.iter().all(|segment| {
        segment.start.is_finite()
            && segment.end.is_finite()
            && segment.start >= 0.0
            && segment.end > segment.start
            && segment.end <= duration + 1e-6
    }));
    // 输出按起点升序，同起点按说话人升序。
    assert!(
        segments
            .windows(2)
            .all(|pair| pair[0].start < pair[1].start || (pair[0].start == pair[1].start && pair[0].speaker <= pair[1].speaker)),
        "{segments:?}"
    );

    let speakers = segments.iter().map(|segment| segment.speaker).collect::<BTreeSet<_>>();
    // 说话人 id 必须是从 0 开始的连续区间（render_segments 会压缩空洞）。
    assert_eq!(
        speakers,
        (0..speakers.len()).collect::<BTreeSet<_>>(),
        "说话人 id 不连续：{segments:?}"
    );

    // 以下是用真实权重实测校准的数值断言，两个后端都必须满足。参考夹具是单人朗读，3.68 秒——不足一个滑窗，只能验证
    // 「单窗口不分裂」；跨窗口串联与声纹聚类由下面的 `pyannote_reidentifies_speaker_after_interruption` 用拼接音频覆盖。
    // 实测输出恰为一段 [0.000, 3.680] speaker 0，两条路径（声纹 / 纯 IoU）、两个后端（MLX / candle）结果一致。
    assert!(
        (1..=2).contains(&speakers.len()),
        "说话人数 {} 超出预期：{segments:?}",
        speakers.len()
    );
    assert!((1..=8).contains(&segments.len()), "段数 {} 超出预期：{segments:?}", segments.len());
    let voiced: f64 = segments.iter().map(|segment| segment.end - segment.start).sum();
    assert!(
        voiced > duration * 0.5 && voiced <= duration * 1.5,
        "语音总时长 {voiced:.2}s 与音频 {duration:.2}s 不匹配：{segments:?}"
    );
    // 每段都不短于最短语音门槛。
    assert!(
        segments.iter().all(|segment| segment.end - segment.start >= 0.30 - 1e-9),
        "{segments:?}"
    );
}

/// 跨窗口的声纹再识别：A 说话 → B 打断 → A 回来，A 前后必须是同一个全局 id。
///
/// 两个夹具是不同说话人（真实 WeSpeaker 实测余弦距离 0.841，远高于 0.715 阈值；同一人前后半段只有 0.381），因此拼接
/// 出来的音频是一段合法的双人对话。中间的静音把 IoU 链路彻底切断，所以只有声纹聚类能把 A 的两轮认回同一个人——纯 IoU
/// 路径会把 A 的第二轮判成新说话人。
#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with Pyannote and WeSpeaker installed"]
fn pyannote_reidentifies_speaker_after_interruption() {
    let Some(segmentation) = verified(PYANNOTE_REPO, "pyannote-segmentation", "segmentation") else {
        return;
    };
    let Some(speaker) = verified(WESPEAKER_REPO, "wespeaker", "speaker") else {
        return;
    };
    const GAP_SECONDS: f64 = 2.0;
    let speaker_a = audio("test-sample.wav");
    let speaker_b = audio("chinese-sample.wav");

    // A, B, A, B 四轮，轮间插入静音，记录每轮的真值区间。
    let mut samples = Vec::new();
    let mut turns = Vec::new();
    for (label, turn) in [('A', &speaker_a), ('B', &speaker_b), ('A', &speaker_a), ('B', &speaker_b)] {
        let start = samples.len() as f64 / 16_000.0;
        samples.extend_from_slice(turn);
        turns.push((label, start, samples.len() as f64 / 16_000.0));
        samples.resize(samples.len() + (GAP_SECONDS * 16_000.0) as usize, 0.0);
    }
    assert!(samples.len() > 16_000 * 15, "拼接音频必须跨多个滑窗");

    let mut diarizer = Diarizer::load(&segmentation, Some(&speaker));
    let segments = diarizer.diarize(
        &samples,
        &PyannoteOptions {
            max_speakers: Some(8),
            ..PyannoteOptions::default()
        },
    );

    // 每轮取重叠最多的段作为该轮的说话人。
    let dominant = |start: f64, end: f64| -> usize {
        segments
            .iter()
            .map(|segment| (segment.speaker, (end.min(segment.end) - start.max(segment.start)).max(0.0)))
            .max_by(|left, right| left.1.total_cmp(&right.1))
            .filter(|(_, overlap)| *overlap > 0.0)
            .map(|(speaker, _)| speaker)
            .unwrap_or_else(|| panic!("{start:.2}..{end:.2} 没有任何段覆盖：{segments:?}"))
    };
    let voices = turns
        .iter()
        .map(|(label, start, end)| (*label, dominant(*start, *end)))
        .collect::<Vec<_>>();

    assert_eq!(voices[0].1, voices[2].1, "A 打断后没有认回同一人：{voices:?} {segments:?}");
    assert_eq!(voices[1].1, voices[3].1, "B 的两轮不是同一人：{voices:?} {segments:?}");
    assert_ne!(voices[0].1, voices[1].1, "A 与 B 被并成同一人：{voices:?} {segments:?}");
    let speakers = segments.iter().map(|segment| segment.speaker).collect::<BTreeSet<_>>();
    assert_eq!(speakers, BTreeSet::from([0, 1]), "双人对话应当恰好识别出两个人：{segments:?}");
}

/// 人数上限必须是硬上限：不得因为 IoU 或聚类的兜底路径溢出。
#[test]
#[ignore = "needs BAOCUT_TEST_MODELS_DIR with Pyannote installed"]
fn pyannote_respects_speaker_cap() {
    let Some(mut diarizer) = load_diarizer() else {
        return;
    };
    let segments = diarizer.diarize(
        &audio("test-sample.wav"),
        &PyannoteOptions {
            max_speakers: Some(1),
            ..PyannoteOptions::default()
        },
    );
    let speakers = segments.iter().map(|segment| segment.speaker).collect::<BTreeSet<_>>();
    assert_eq!(speakers, BTreeSet::from([0]), "{segments:?}");
}

fn audio(name: &str) -> Vec<f32> {
    decode_mono(&Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name), 16_000).expect("decode fixture")
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
