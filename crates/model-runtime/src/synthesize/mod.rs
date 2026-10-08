//! 语音合成（本地 TTS）：请求与结果类型、引擎 trait、各引擎实现与它们共用的部分。
//!
//! 移植自 v2 的 `bcut-tts-core`（类型、切块、WAV、内置音色元数据）与 `bcut-tts`（引擎 trait、
//! Qwen3-TTS、随包录音）。与 v2 不同的只有边界：v2 按「模型目录 + 相对路径」找文件，这里一律经
//! [`crate::bundle::VerifiedFiles`] 按清单取（缺文件 `MODEL_NOT_INSTALLED`，缺组件 `MODEL_UNSUPPORTED`，
//! 后端加载失败原样透传）；参考音频解码走 [`crate::audio::decode_mono`]。张量与设备经 `tensor` 门面：
//! Apple Silicon 上是 MLX（设备与缓存走 `crate::backend::mlx::runtime`），其余平台开 `backend-candle`
//! 时是 candle CPU/CUDA（v2 的同一份适配层）。
//!
//! 共用部分，后续引擎（IndexTTS2 / 2.5、GPT-SoVITS、VoxCPM2、OmniVoice）直接复用：
//! - [`types`]：请求 / 结果 / 进度 / 引擎种类；
//! - [`text`]：长文本切块（带块之后的边界级别）、切句、语言粗判；
//! - [`voices`]：八只内置音色（元数据、随包录音、克隆参考的解析）；
//! - [`wav`]：16-bit PCM WAV 读写；
//! - [`resample`]：带限插值重采样；
//! - [`loudness`]：合成结果的峰值上限（−1 dBFS，只缩不放）；
//! - [`stitch`]：逐块合成后的拼接（去块边界的首尾静音、按边界级别插固定停顿、响度对齐到第一块）；
//! - `qwen3_tts` 里的 `layers` / `weights` / `sampling`（`pub(crate)`）：v2 的其余引擎就是从这里取
//!   KV cache、线性层、因果卷积、权重仓与随机数的。
//!
//! 引擎实例持有权重与 KV cache，不是 `Send`：在哪个线程加载就在哪个线程合成。

pub mod gpt_sovits;
pub mod index_tts2;
pub mod job;
pub mod loudness;
pub mod omnivoice;
pub mod qwen3_tts;
pub mod readings;
pub mod resample;
pub mod stitch;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
pub mod tensor;
pub mod text;
pub mod types;
pub mod voices;
pub mod voxcpm2;
pub mod wav;

pub use types::{ReadingsSupport, SamplingOptions, TtsAudio, TtsEngineKind, TtsProgress, TtsRequest, VoiceSpec};

use crate::bundle::VerifiedFiles;
use crate::protocol::{ErrorBody, codes};
use anyhow::Result;
use serde_json::json;

/// 进度回调；返回 `false` 请求取消，引擎应在下一个安全点返回错误。
pub type ProgressSink<'a> = &'a mut dyn FnMut(TtsProgress) -> bool;

/// 一个已加载的本地 TTS 模型。实现持有全部权重与 KV cache，非 `Sync`，
/// 由上层保证同一时刻只有一个合成在跑（16 GiB Mac 上不能并行两份模型）。
pub trait TtsEngine {
    fn kind(&self) -> TtsEngineKind;

    /// 输出采样率（Hz）。
    fn sample_rate(&self) -> u32;

    /// 预置说话人列表（CustomVoice）；克隆专用模型返回空。
    fn preset_speakers(&self) -> Vec<String> {
        Vec::new()
    }

    /// 把 `<字|读音>` 注音渲染成这只引擎能吃的文字。缺省按 [`TtsEngineKind::readings_support`] 分派到
    /// 纯函数 [`readings::render`]；`Unsupported` 即「表面文字 + 注记全部 dropped」。需要模型内信息的引擎
    /// （IndexTTS2 的词表拼音片）覆盖它。改了渲染要抬 [`TtsEngineKind::output_revision`]。
    fn render_readings(&self, annotated: &readings::Annotated) -> readings::Rendered {
        readings::render(self.kind().readings_support(), annotated, None)
    }

    /// 合成整段文本。长文本由实现自行切块、逐块生成并拼接。
    fn synthesize(&mut self, request: &TtsRequest, progress: ProgressSink<'_>) -> Result<TtsAudio>;
}

/// 合成要用的已校验文件：主模型，加上引擎需要的伴随组件。
#[derive(Debug, Clone, Copy)]
pub struct EngineFiles<'a> {
    /// 主模型（Qwen3-TTS：`config.json` + `*.safetensors` + `vocab.json` / `merges.txt` / `tokenizer_config.json`；
    /// GPT-SoVITS：chinese-hubert、chinese-roberta、T2S、SoVITS 都在这一个组件里）。
    pub model: &'a VerifiedFiles,
    /// 语音分词器 / codec（Qwen3-TTS：`Qwen/Qwen3-TTS-Tokenizer-12Hz` 的 `*.safetensors`）。
    /// VoxCPM2 不需要；OmniVoice 的音频分词器在主模型组件的 `audio_tokenizer/` 下，也不用这个。
    pub codec: Option<&'a VerifiedFiles>,
    /// 辅助权重（IndexTTS 2.5：整个 IndexTTS2 仓库，只读其中 `aux/` 下的 w2v-BERT、CAM++、BigVGAN 与统计量）。
    /// 别的引擎不需要。
    pub aux: Option<&'a VerifiedFiles>,
}

/// 这个构建里有没有可用的本地 TTS 后端：Apple Silicon 的 MLX，或任一平台的 candle（CPU；开 `cuda` 时 NVIDIA GPU）。
pub const fn local_tts_available() -> bool {
    cfg!(any(
        feature = "backend-candle",
        all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
    ))
}

/// 这只引擎在这个构建里能不能加载。没移植的引擎报 `false`。
pub const fn engine_available(kind: TtsEngineKind) -> bool {
    match kind {
        TtsEngineKind::Qwen3Tts => local_tts_available(),
        TtsEngineKind::VoxCpm2 => local_tts_available(),
        TtsEngineKind::OmniVoice => local_tts_available(),
        TtsEngineKind::GptSovits => local_tts_available(),
        TtsEngineKind::IndexTts2 | TtsEngineKind::IndexTts25 => local_tts_available(),
    }
}

/// 这个构建能加载的合成主模型 family（`components.tts.family`），按 [`TtsEngineKind::ALL`] 的次序。
/// `worker.hello` 的 `synthesizeFamilies` 就是它；Runtime 不把没列出的 family 交给这个 Worker（协议规范 §2.1）。
pub fn available_families() -> Vec<&'static str> {
    TtsEngineKind::ALL
        .into_iter()
        .filter(|kind| engine_available(*kind))
        .map(TtsEngineKind::family)
        .collect()
}

/// 加载一只引擎。调用前不需要自己确认设备：实现会先调 `tensor::host::ensure_device`（MLX 是 Metal，candle 是
/// 本进程的默认设备）。
///
/// 错误里的 [`ErrorBody`]（缺文件、缺组件、引擎没有）可以 `downcast_ref` 出来原样上报；其余是加载失败。
/// 返回的引擎都套着 [`readings::Annotating`]：`<字|读音>` 注音在这一处按引擎渲染，念不了的读音写进
/// [`TtsAudio::readings_dropped`]；最外层是 [`loudness::PeakLimited`]：整段峰值高于 −1 dBFS 时等比缩到它。
pub fn load(kind: TtsEngineKind, files: EngineFiles<'_>) -> Result<Box<dyn TtsEngine>> {
    if !engine_available(kind) {
        return Err(unsupported_engine(kind).into());
    }
    let annotating = readings::Annotating::new(load_available(kind, files)?);
    Ok(Box::new(loudness::PeakLimited::new(Box::new(annotating))))
}

#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
fn load_available(kind: TtsEngineKind, files: EngineFiles<'_>) -> Result<Box<dyn TtsEngine>> {
    match kind {
        TtsEngineKind::Qwen3Tts => {
            let codec = files.codec.ok_or_else(|| missing_component("codec"))?;
            Ok(Box::new(qwen3_tts::Qwen3Tts::load(files.model, codec)?))
        }
        TtsEngineKind::VoxCpm2 => Ok(Box::new(voxcpm2::VoxCpm2::load(files.model)?)),
        TtsEngineKind::OmniVoice => Ok(Box::new(omnivoice::OmniVoice::load(files.model)?)),
        TtsEngineKind::GptSovits => Ok(Box::new(gpt_sovits::GptSovits::load(files.model)?)),
        TtsEngineKind::IndexTts2 => Ok(Box::new(index_tts2::IndexTts2::load(files.model)?)),
        TtsEngineKind::IndexTts25 => {
            let aux = files.aux.ok_or_else(|| missing_component("aux"))?;
            Ok(Box::new(index_tts2::IndexTts25::load(files.model, aux)?))
        }
    }
}

#[cfg(not(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
)))]
fn load_available(kind: TtsEngineKind, _files: EngineFiles<'_>) -> Result<Box<dyn TtsEngine>> {
    Err(unsupported_engine(kind).into())
}

fn unsupported_engine(kind: TtsEngineKind) -> ErrorBody {
    ErrorBody::new(
        codes::MODEL_UNSUPPORTED,
        format!("the {} engine is not available in this build", kind.as_str()),
    )
    .with_details(json!({ "engine": kind.as_str(), "reason": "engine-unavailable" }))
}

#[cfg_attr(
    not(any(
        feature = "backend-candle",
        all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
    )),
    allow(dead_code)
)]
fn missing_component(component: &str) -> ErrorBody {
    ErrorBody::new(codes::MODEL_UNSUPPORTED, format!("the bundle has no {component} component"))
        .with_details(json!({ "component": component, "reason": "missing-component" }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bundle::{FAMILY_QWEN3_TTS, FileEntry, ModelFiles};

    fn empty_files() -> VerifiedFiles {
        let dir = tempfile::tempdir().unwrap();
        ModelFiles {
            family: FAMILY_QWEN3_TTS.into(),
            revision: "r".into(),
            dir: dir.path().to_string_lossy().into_owned(),
            files: Vec::<FileEntry>::new(),
        }
        .verify("tts")
        .unwrap()
    }

    fn error_of(result: Result<Box<dyn TtsEngine>>) -> ErrorBody {
        match result {
            Ok(_) => panic!("不该加载成功"),
            Err(error) => error.downcast_ref::<ErrorBody>().expect("ErrorBody").clone(),
        }
    }

    #[test]
    fn engines_not_ported_yet_are_unsupported() {
        let model = empty_files();
        for kind in TtsEngineKind::ALL {
            if engine_available(kind) {
                continue;
            }
            assert!(!engine_available(kind));
            let error = error_of(load(
                kind,
                EngineFiles {
                    model: &model,
                    codec: None,
                    aux: None,
                },
            ));
            assert_eq!(error.code, codes::MODEL_UNSUPPORTED, "{kind:?}");
            assert_eq!(error.details.unwrap()["reason"], "engine-unavailable");
        }
    }

    #[cfg(any(
        feature = "backend-candle",
        all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
    ))]
    #[test]
    fn qwen3_tts_needs_its_codec_component_and_listed_files() {
        let model = empty_files();
        let error = error_of(load(
            TtsEngineKind::Qwen3Tts,
            EngineFiles {
                model: &model,
                codec: None,
                aux: None,
            },
        ));
        assert_eq!(error.code, codes::MODEL_UNSUPPORTED);
        assert_eq!(error.details.unwrap()["component"], "codec");

        // 有 codec 组件，但主模型没列 config.json：缺文件是 MODEL_NOT_INSTALLED，在碰 Metal 之前就报。
        let codec = empty_files();
        let error = error_of(load(
            TtsEngineKind::Qwen3Tts,
            EngineFiles {
                model: &model,
                codec: Some(&codec),
                aux: None,
            },
        ));
        assert_eq!(error.code, codes::MODEL_NOT_INSTALLED);
        assert_eq!(error.details.unwrap()["file"], "config.json");
    }

    /// VoxCPM2 / OmniVoice 只要主模型组件；清单没列的文件是 MODEL_NOT_INSTALLED，在碰 Metal 之前就报。
    #[cfg(any(
        feature = "backend-candle",
        all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
    ))]
    #[test]
    fn voxcpm2_and_omnivoice_need_their_listed_files() {
        use crate::bundle::{FAMILY_OMNIVOICE, FAMILY_VOXCPM2};

        fn listed(family: &str, paths: &[&str]) -> (tempfile::TempDir, VerifiedFiles) {
            let dir = tempfile::tempdir().unwrap();
            let files = paths
                .iter()
                .map(|path| {
                    let full = dir.path().join(path);
                    std::fs::create_dir_all(full.parent().unwrap()).unwrap();
                    std::fs::write(&full, b"{}").unwrap();
                    FileEntry {
                        path: (*path).to_owned(),
                        sha256: String::new(),
                        byte_length: 2,
                    }
                })
                .collect();
            let verified = ModelFiles {
                family: family.into(),
                revision: "r".into(),
                dir: dir.path().to_string_lossy().into_owned(),
                files,
            }
            .verify("tts")
            .unwrap();
            (dir, verified)
        }
        fn files(model: &VerifiedFiles) -> EngineFiles<'_> {
            EngineFiles {
                model,
                codec: None,
                aux: None,
            }
        }

        let (_dir, model) = listed(FAMILY_VOXCPM2, &["config.json", "tokenizer.json"]);
        let error = error_of(load(TtsEngineKind::VoxCpm2, files(&model)));
        assert_eq!(error.code, codes::MODEL_NOT_INSTALLED);
        assert_eq!(error.details.unwrap()["file"], "model.safetensors");

        let (_dir, model) = listed(FAMILY_OMNIVOICE, &["config.json", "tokenizer.json", "model.safetensors"]);
        let error = error_of(load(TtsEngineKind::OmniVoice, files(&model)));
        assert_eq!(error.code, codes::MODEL_NOT_INSTALLED);
        assert_eq!(error.details.unwrap()["file"], "audio_tokenizer/");

        let (_dir, model) = listed(
            FAMILY_OMNIVOICE,
            &["config.json", "tokenizer.json", "model.safetensors", "audio_tokenizer/config.json"],
        );
        let error = error_of(load(TtsEngineKind::OmniVoice, files(&model)));
        assert_eq!(error.code, codes::MODEL_NOT_INSTALLED);
        assert_eq!(error.details.unwrap()["file"], "audio_tokenizer/model.safetensors");
    }

    #[cfg(any(
        feature = "backend-candle",
        all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
    ))]
    #[test]
    fn gpt_sovits_reports_the_first_unlisted_file_before_touching_metal() {
        use crate::bundle::FAMILY_GPT_SOVITS;

        let dir = tempfile::tempdir().unwrap();
        let model = ModelFiles {
            family: FAMILY_GPT_SOVITS.into(),
            revision: "r".into(),
            dir: dir.path().to_string_lossy().into_owned(),
            files: Vec::<FileEntry>::new(),
        }
        .verify("tts")
        .unwrap();
        // GPT-SoVITS 只有一个组件：codec 给不给都不看。
        let error = error_of(load(
            TtsEngineKind::GptSovits,
            EngineFiles {
                model: &model,
                codec: None,
                aux: None,
            },
        ));
        assert_eq!(error.code, codes::MODEL_NOT_INSTALLED);
        assert_eq!(error.details.unwrap()["file"], "chinese-hubert-base/model.safetensors");
    }

    #[cfg(any(
        feature = "backend-candle",
        all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
    ))]
    #[test]
    fn index_tts_needs_its_components_and_listed_files_before_touching_metal() {
        let model = empty_files();
        let files = |aux| EngineFiles {
            model: &model,
            codec: None,
            aux,
        };
        // 2.0 只有一个组件：没列 config.yaml 用默认配置，接着缺 bpe.model。
        let error = error_of(load(TtsEngineKind::IndexTts2, files(None)));
        assert_eq!(error.code, codes::MODEL_NOT_INSTALLED);
        assert_eq!(error.details.unwrap()["file"], "bpe.model");
        // 2.5 先要 aux 组件，再要主模型的 config.yaml。
        let error = error_of(load(TtsEngineKind::IndexTts25, files(None)));
        assert_eq!(error.code, codes::MODEL_UNSUPPORTED);
        assert_eq!(error.details.unwrap()["component"], "aux");
        let aux = empty_files();
        let error = error_of(load(TtsEngineKind::IndexTts25, files(Some(&aux))));
        assert_eq!(error.code, codes::MODEL_NOT_INSTALLED);
        assert_eq!(error.details.unwrap()["file"], "config.yaml");
    }
}
