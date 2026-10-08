//! 模型包描述（协议规范 §4）与加载前的文件校验。
//!
//! Runtime 把模型包的全部文件显式交给 Worker：Worker 不扫描目录、不读清单，只读 `files` 列出的文件，
//! 加载前逐个核对存在与大小。sha256 由 Runtime 在安装与登记时校验，这里不复核。
//!
//! 从 v2 移植的引擎按「模型目录 + 相对路径」找文件（`model_dir.join(..)`、`read_dir` 过滤扩展名、子目录）。
//! 移植时把这几种写法换成 [`VerifiedFiles`] 上的同名查询，不再碰目录本身：
//!
//! | v2 写法 | 换成 |
//! |---|---|
//! | `model_dir.join("config.json")` | [`VerifiedFiles::require`]（可选文件用 [`VerifiedFiles::path`]） |
//! | `read_dir(model_dir)` 里取 `*.safetensors`（不递归） | [`VerifiedFiles::require_extension_in`]`("", "safetensors")` |
//! | `model_dir.join("qwen")` 交给子加载器 | [`VerifiedFiles::require_subdirectory`]`("qwen")` |
//! | 按组件取文件集 | [`VerifiedBundle::component`]`("aligner")` |
//! | 整个目录交给框架（CoreML 的 `X.mlmodelc`） | [`VerifiedFiles::require_directory`]`("AudioEncoder.mlmodelc")` |
//!
//! 这些查询的错误是 [`ErrorBody`]（`MODEL_NOT_INSTALLED` / `MODEL_UNSUPPORTED`），可以直接 `?` 进 `anyhow`；
//! 后端的加载失败处理会把它原样透传，而不是改报成加载失败。

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::protocol::{ErrorBody, codes};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelBundle {
    pub bundle_id: String,
    /// `mlx` | `coreml` | `candle`。用字符串接，认不出的后端是 `MODEL_UNSUPPORTED` 而不是 `INVALID_PARAMS`。
    pub backend: String,
    pub device: String,
    pub components: Components,
    pub threads: u32,
    #[serde(default)]
    pub memory_budget_bytes: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Components {
    #[serde(default)]
    pub asr: Option<ModelFiles>,
    #[serde(default)]
    pub vad: Option<ModelFiles>,
    #[serde(default)]
    pub aligner: Option<ModelFiles>,
    #[serde(default)]
    pub speaker: Option<ModelFiles>,
    /// 说话人分段（Pyannote segmentation）。与 `speaker` 一起来自「说话人区分」模型包，转录模型自己不区分说话人时
    /// 由 Runtime 附在识别的模型包上（§6.6）；只有 `speaker` 没有它不能做说话人区分。
    #[serde(default)]
    pub segmentation: Option<ModelFiles>,
    /// 识别模型取自另一个仓库的分词器文件（Whisper 的 `tokenizer.json` 等取自 `openai/whisper-large-v3`）。
    #[serde(default)]
    pub tokenizer: Option<ModelFiles>,
    /// 本地语音合成的主模型（§4.1）。带了它的模型包是合成的模型包，不需要 `asr` / `vad`。
    #[serde(default)]
    pub tts: Option<ModelFiles>,
    /// 合成用的语音编解码器（Qwen3-TTS 的 12 Hz 分词器），几个模型包共用一份。
    #[serde(default)]
    pub codec: Option<ModelFiles>,
    /// 合成的辅助权重（IndexTTS 2.5 取自 IndexTTS2 仓库的语义编码器等）。
    #[serde(default)]
    pub aux: Option<ModelFiles>,
    /// 人声与伴奏分离的模型（HTDemucs-FT）。带了它的模型包是分离的模型包，不带别的组件。
    #[serde(default)]
    pub separator: Option<ModelFiles>,
    /// 本地文生图的模型（§4.2，Qwen-Image：一个仓库里的文本编码器、DiT、VAE 与分词器）。带了它的模型包只做文生图。
    #[serde(default)]
    pub image: Option<ModelFiles>,
}

impl Components {
    /// 模型包带了合成的组件（`tts` / `codec` / `aux` 之一）。
    pub fn has_speech(&self) -> bool {
        self.tts.is_some() || self.codec.is_some() || self.aux.is_some()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelFiles {
    /// 决定加载器。用字符串接：未知的 family 返回 `MODEL_UNSUPPORTED`（§4）。
    pub family: String,
    pub revision: String,
    pub dir: String,
    pub files: Vec<FileEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileEntry {
    pub path: String,
    pub sha256: String,
    pub byte_length: u64,
}

/// Qwen3-ASR（0.6B / 1.7B，MLX 量化）：要 VAD 切段。
pub const FAMILY_QWEN3_ASR: &str = "qwen3-asr";
/// Whisper large-v3 / large-v3-turbo 的 CoreML 包（`MelSpectrogram`、`AudioEncoder`、`TextDecoder` 等 `.mlmodelc` 目录）：
/// 要 VAD 切段，分词器在 `tokenizer` 组件。
pub const FAMILY_WHISPER_COREML: &str = "whisper-coreml";
/// Whisper large-v3 / large-v3-turbo 的 MLX 权重（mlx-community 的 fp16 转换：`config.json` + safetensors）：要 VAD 切段，
/// 分词器与 `generation_config.json` 在 `tokenizer` 组件。
pub const FAMILY_WHISPER_MLX: &str = "whisper-mlx";
/// Whisper large-v3 / large-v3-turbo 的 whisper.cpp 单文件 GGML 权重（`ggml-*.bin`，词表内嵌）：要 VAD 切段，不要分词器。
pub const FAMILY_WHISPER_GGML: &str = "whisper-ggml";
/// Whisper 的分词器文件（`openai/whisper-large-v3` 仓库），large-v3 与 turbo 共用一份。
pub const FAMILY_WHISPER_TOKENIZER: &str = "whisper-tokenizer";
/// MOSS-Transcribe-Diarize（MLX）：自己切段、自带说话人标签，不要 VAD。
pub const FAMILY_MOSS_TRANSCRIBE_DIARIZE: &str = "moss-transcribe-diarize";
pub const FAMILY_SILERO_VAD: &str = "silero-vad";
pub const FAMILY_QWEN3_ALIGNER: &str = "qwen3-forced-aligner";
pub const FAMILY_WESPEAKER: &str = "wespeaker";
/// Pyannote 说话人分段（segmentation-3.0 的 PyanNet，`aufklarer/Pyannote-Segmentation-MLX` 的 safetensors）。
pub const FAMILY_PYANNOTE_SEGMENTATION: &str = "pyannote-segmentation";
/// Qwen3-TTS 12 Hz 主模型（Base / CustomVoice / VoiceDesign，0.6B / 1.7B）。
pub const FAMILY_QWEN3_TTS: &str = "qwen3-tts";
/// Qwen3-TTS 的 12 Hz 语音分词器（codec 编解码器），各尺寸与变体共用一份。
pub const FAMILY_QWEN3_TTS_CODEC: &str = "qwen3-tts-tokenizer";
/// VoxCPM2（`config.json` + `tokenizer.json` + `model.safetensors`，单组件）。
pub const FAMILY_VOXCPM2: &str = "voxcpm2";
/// OmniVoice（主模型 + 同一组件里 `audio_tokenizer/` 下的音频分词器）。
pub const FAMILY_OMNIVOICE: &str = "omnivoice";
/// IndexTTS2 主模型。
pub const FAMILY_INDEXTTS2: &str = "indextts2";
/// IndexTTS 2.5 主模型（辅助权重在 `aux` 组件，family 是 `indextts2-aux`）。
pub const FAMILY_INDEXTTS25: &str = "indextts2.5";
/// GPT-SoVITS v2（`PJMixers-Dev/lj1995_GPT-SoVITS-safetensors`）：chinese-hubert、chinese-roberta、
/// T2S 与 SoVITS 同在一个组件里。
pub const FAMILY_GPT_SOVITS: &str = "gpt-sovits";
/// IndexTTS2（`aufklarer/IndexTTS2-MLX-fp16`）：GPT、S2Mel、MaskGCT 语义码本与 `aux/` 下的 w2v-BERT、
/// CAM++、BigVGAN 同在一个组件里。
pub const FAMILY_INDEX_TTS2: &str = "indextts2";
/// IndexTTS 2.5 主模型（tiktoken 多语言 GPT、语义码本解码器、S2Mel）；辅助权重在 `aux` 组件里。
pub const FAMILY_INDEX_TTS25: &str = "indextts2.5";
/// IndexTTS 2.5 的 `aux` 组件：整个 IndexTTS2 仓库，只读其中 `aux/` 下的 w2v-BERT、CAM++、BigVGAN 与统计量。
pub const FAMILY_INDEX_TTS2_AUX: &str = "indextts2-aux";
/// HTDemucs-FT（`aufklarer/HTDemucs-FT-MLX`）：`htdemucs_ft_config.json` + `htdemucs_ft.safetensors`，四个子模型同在一个文件里。
pub const FAMILY_HTDEMUCS_FT: &str = "htdemucs-ft";
/// Qwen-Image-2.1（`mlx-community/Qwen-Image-2.1-MLX-4bit`）：`processor/`、`scheduler/`、`text_encoder/`、`transformer/`、
/// `vae/` 五个子目录同在 `image` 组件里。
pub const FAMILY_QWEN_IMAGE: &str = "qwen-image";

impl ModelFiles {
    /// 单独校验一个组件的文件（与 [`verify`] 对每个组件做的检查相同）。给 [`Components`] 还没有
    /// 字段的能力（例如合成）和测试用：调用方自己决定组件名。
    pub fn verify(&self, component: &'static str) -> Result<VerifiedFiles, ErrorBody> {
        verify_files(component, self)
    }
}

/// 一个组件校验过的文件：只有这里列出的路径可以被打开。
#[derive(Debug, Clone)]
pub struct VerifiedFiles {
    pub component: &'static str,
    pub family: String,
    pub revision: String,
    /// 组件的根目录（`ModelFiles::dir`）。只用于 [`Self::require_directory`] 把整个目录交给框架。
    root: PathBuf,
    /// 子目录视图的前缀（`qwen/`）；组件本身是空串。只用于报错时给出模型包里的完整相对路径。
    scope: String,
    files: Vec<(String, PathBuf, u64)>,
}

impl VerifiedFiles {
    /// 按相对路径取一个列出的文件。
    pub fn path(&self, relative: &str) -> Option<&Path> {
        self.files
            .iter()
            .find(|(rel, _, _)| rel == relative)
            .map(|(_, path, _)| path.as_path())
    }

    /// 取一个必需的文件；没列出就是 `MODEL_NOT_INSTALLED`。
    pub fn require(&self, relative: &str) -> Result<&Path, ErrorBody> {
        self.path(relative).ok_or_else(|| {
            ErrorBody::new(
                codes::MODEL_NOT_INSTALLED,
                format!("模型包的 {} 组件缺少文件 {}{relative}", self.component, self.scope),
            )
            .with_details(json!({ "component": self.component, "file": format!("{}{relative}", self.scope), "reason": "not-listed" }))
        })
    }

    /// 列出的、扩展名为 `extension` 的文件，按相对路径排序。
    pub fn with_extension(&self, extension: &str) -> Vec<&Path> {
        let mut matches: Vec<_> = self
            .files
            .iter()
            .filter(|(_, path, _)| path.extension().is_some_and(|ext| ext == extension))
            .collect();
        matches.sort_by(|a, b| a.0.cmp(&b.0));
        matches.into_iter().map(|(_, path, _)| path.as_path()).collect()
    }

    /// 取至少一个 `extension` 文件；一个也没有就是 `MODEL_NOT_INSTALLED`。
    pub fn require_extension(&self, extension: &str) -> Result<Vec<&Path>, ErrorBody> {
        let files = self.with_extension(extension);
        if files.is_empty() {
            return Err(ErrorBody::new(
                codes::MODEL_NOT_INSTALLED,
                format!("模型包的 {} 组件没有 .{extension} 文件", self.component),
            )
            .with_details(json!({ "component": self.component, "file": format!("{}*.{extension}", self.scope), "reason": "not-listed" })));
        }
        Ok(files)
    }

    /// 直接位于 `directory`（空串是本视图的根）之下、扩展名为 `extension` 的文件，不含更深的子目录，
    /// 按相对路径排序。对应 v2 的 `read_dir(dir)` + 扩展名过滤。
    pub fn with_extension_in(&self, directory: &str, extension: &str) -> Vec<&Path> {
        let directory = directory.trim_end_matches('/');
        let mut matches: Vec<_> = self
            .files
            .iter()
            .filter(|(rel, path, _)| {
                let parent = Path::new(rel).parent().unwrap_or(Path::new(""));
                parent == Path::new(directory) && path.extension().is_some_and(|ext| ext == extension)
            })
            .collect();
        matches.sort_by(|a, b| a.0.cmp(&b.0));
        matches.into_iter().map(|(_, path, _)| path.as_path()).collect()
    }

    /// 同 [`Self::with_extension_in`]，一个也没有就是 `MODEL_NOT_INSTALLED`。
    pub fn require_extension_in(&self, directory: &str, extension: &str) -> Result<Vec<&Path>, ErrorBody> {
        let files = self.with_extension_in(directory, extension);
        if files.is_empty() {
            let directory = directory.trim_end_matches('/');
            let pattern = if directory.is_empty() {
                format!("{}*.{extension}", self.scope)
            } else {
                format!("{}{directory}/*.{extension}", self.scope)
            };
            return Err(ErrorBody::new(
                codes::MODEL_NOT_INSTALLED,
                format!("模型包的 {} 组件没有 {pattern} 文件", self.component),
            )
            .with_details(json!({ "component": self.component, "file": pattern, "reason": "not-listed" })));
        }
        Ok(files)
    }

    /// `directory` 之下全部列出文件的视图：相对路径去掉 `directory/` 前缀，交给按目录找文件的子加载器。
    /// 一个文件也没列出时是 `None`（v2 用「子目录在不在」挑候选目录的地方，换成这个）。
    pub fn subdirectory(&self, directory: &str) -> Option<VerifiedFiles> {
        let directory = directory.trim_end_matches('/');
        if directory.is_empty() {
            return Some(self.clone());
        }
        let prefix = format!("{directory}/");
        let files: Vec<_> = self
            .files
            .iter()
            .filter_map(|(rel, path, size)| rel.strip_prefix(&prefix).map(|rest| (rest.to_owned(), path.clone(), *size)))
            .collect();
        (!files.is_empty()).then(|| VerifiedFiles {
            component: self.component,
            family: self.family.clone(),
            revision: self.revision.clone(),
            root: self.root.clone(),
            scope: format!("{}{prefix}", self.scope),
            files,
        })
    }

    /// `directory` 本身的路径，给按目录加载的框架（CoreML 把 `X.mlmodelc` 当一个整体打开）。目录下至少要列出一个文件，
    /// 否则 `None`。框架会读目录里的全部文件：清单要列全它们（大小已在 [`verify`] 时逐个核对），这里不再扫描目录。
    pub fn directory(&self, directory: &str) -> Option<PathBuf> {
        let directory = directory.trim_end_matches('/');
        if directory.is_empty() || !is_plain_relative(directory) {
            return None;
        }
        let prefix = format!("{directory}/");
        self.files
            .iter()
            .any(|(rel, _, _)| rel.starts_with(&prefix))
            .then(|| self.root.join(&self.scope).join(directory))
    }

    /// 同 [`Self::directory`]，目录下没有列出任何文件就是 `MODEL_NOT_INSTALLED`。
    pub fn require_directory(&self, directory: &str) -> Result<PathBuf, ErrorBody> {
        self.directory(directory).ok_or_else(|| {
            let directory = format!("{}{}/", self.scope, directory.trim_end_matches('/'));
            ErrorBody::new(
                codes::MODEL_NOT_INSTALLED,
                format!("模型包的 {} 组件缺少目录 {directory}", self.component),
            )
            .with_details(json!({ "component": self.component, "file": directory, "reason": "not-listed" }))
        })
    }

    /// 同 [`Self::subdirectory`]，没有列出任何文件就是 `MODEL_NOT_INSTALLED`。
    pub fn require_subdirectory(&self, directory: &str) -> Result<VerifiedFiles, ErrorBody> {
        self.subdirectory(directory).ok_or_else(|| {
            let directory = format!("{}{}/", self.scope, directory.trim_end_matches('/'));
            ErrorBody::new(
                codes::MODEL_NOT_INSTALLED,
                format!("模型包的 {} 组件缺少目录 {directory}", self.component),
            )
            .with_details(json!({ "component": self.component, "file": directory, "reason": "not-listed" }))
        })
    }

    pub fn total_bytes(&self) -> u64 {
        self.files.iter().map(|(_, _, size)| size).sum()
    }
}

/// 校验过文件的模型包。
#[derive(Debug, Clone)]
pub struct VerifiedBundle {
    pub bundle_id: String,
    pub backend: String,
    pub device: String,
    pub threads: u32,
    pub memory_budget_bytes: Option<u64>,
    pub asr: Option<VerifiedFiles>,
    pub vad: Option<VerifiedFiles>,
    pub aligner: Option<VerifiedFiles>,
    pub speaker: Option<VerifiedFiles>,
    pub segmentation: Option<VerifiedFiles>,
    pub tokenizer: Option<VerifiedFiles>,
    pub tts: Option<VerifiedFiles>,
    pub codec: Option<VerifiedFiles>,
    pub aux: Option<VerifiedFiles>,
    pub separator: Option<VerifiedFiles>,
    pub image: Option<VerifiedFiles>,
}

impl VerifiedBundle {
    /// 按组件名（`asr` / `vad` / `aligner` / `speaker` / `segmentation` / `tokenizer` / `tts` / `codec` / `aux` / `separator` / `image`）取文件集；模型包没带这个组件是 `MODEL_UNSUPPORTED`，
    /// 与 `backend::load` 对必需组件的检查同一个形状。认不出的组件名是调用方的错，同样报 `MODEL_UNSUPPORTED`。
    pub fn component(&self, name: &str) -> Result<&VerifiedFiles, ErrorBody> {
        let files = match name {
            "asr" => self.asr.as_ref(),
            "vad" => self.vad.as_ref(),
            "aligner" => self.aligner.as_ref(),
            "speaker" => self.speaker.as_ref(),
            "segmentation" => self.segmentation.as_ref(),
            "tokenizer" => self.tokenizer.as_ref(),
            "tts" => self.tts.as_ref(),
            "codec" => self.codec.as_ref(),
            "aux" => self.aux.as_ref(),
            "separator" => self.separator.as_ref(),
            "image" => self.image.as_ref(),
            _ => None,
        };
        files.ok_or_else(|| {
            ErrorBody::new(codes::MODEL_UNSUPPORTED, format!("the bundle has no {name} component"))
                .with_details(json!({ "component": name, "reason": "missing-component" }))
        })
    }

    pub fn total_bytes(&self) -> u64 {
        [
            &self.asr,
            &self.vad,
            &self.aligner,
            &self.speaker,
            &self.segmentation,
            &self.tokenizer,
            &self.tts,
            &self.codec,
            &self.aux,
            &self.separator,
            &self.image,
        ]
        .into_iter()
        .flatten()
        .map(VerifiedFiles::total_bytes)
        .sum()
    }
}

/// 逐个组件检查路径形状、存在与大小。先于后端与 family 的判断，与平台无关。
pub fn verify(bundle: &ModelBundle) -> Result<VerifiedBundle, ErrorBody> {
    let c = &bundle.components;
    Ok(VerifiedBundle {
        bundle_id: bundle.bundle_id.clone(),
        backend: bundle.backend.clone(),
        device: bundle.device.clone(),
        threads: bundle.threads,
        memory_budget_bytes: bundle.memory_budget_bytes,
        asr: c.asr.as_ref().map(|files| verify_files("asr", files)).transpose()?,
        vad: c.vad.as_ref().map(|files| verify_files("vad", files)).transpose()?,
        aligner: c.aligner.as_ref().map(|files| verify_files("aligner", files)).transpose()?,
        speaker: c.speaker.as_ref().map(|files| verify_files("speaker", files)).transpose()?,
        segmentation: c
            .segmentation
            .as_ref()
            .map(|files| verify_files("segmentation", files))
            .transpose()?,
        tokenizer: c.tokenizer.as_ref().map(|files| verify_files("tokenizer", files)).transpose()?,
        tts: c.tts.as_ref().map(|files| verify_files("tts", files)).transpose()?,
        codec: c.codec.as_ref().map(|files| verify_files("codec", files)).transpose()?,
        aux: c.aux.as_ref().map(|files| verify_files("aux", files)).transpose()?,
        separator: c.separator.as_ref().map(|files| verify_files("separator", files)).transpose()?,
        image: c.image.as_ref().map(|files| verify_files("image", files)).transpose()?,
    })
}

fn verify_files(component: &'static str, files: &ModelFiles) -> Result<VerifiedFiles, ErrorBody> {
    let dir = PathBuf::from(&files.dir);
    if !dir.is_absolute() {
        return Err(ErrorBody::invalid_params(format!("{component} 组件的 dir 必须是绝对路径")));
    }
    let mut verified = Vec::with_capacity(files.files.len());
    for entry in &files.files {
        if !is_plain_relative(&entry.path) {
            return Err(ErrorBody::invalid_params(format!(
                "{component} 组件的文件路径必须是 dir 之下的相对路径"
            )));
        }
        if verified.iter().any(|(rel, _, _): &(String, PathBuf, u64)| rel == &entry.path) {
            return Err(ErrorBody::invalid_params(format!("{component} 组件重复列出文件 {}", entry.path)));
        }
        let path = dir.join(&entry.path);
        let not_installed = |reason: &str, extra: serde_json::Value| {
            let mut details = json!({ "component": component, "file": entry.path, "reason": reason });
            if let (Some(details), Some(extra)) = (details.as_object_mut(), extra.as_object()) {
                details.extend(extra.clone());
            }
            ErrorBody::new(codes::MODEL_NOT_INSTALLED, format!("模型文件 {} 不可用（{reason}）", entry.path)).with_details(details)
        };
        let metadata = match std::fs::metadata(&path) {
            Ok(metadata) if metadata.is_file() => metadata,
            Ok(_) => return Err(not_installed("not-a-file", json!({}))),
            Err(_) => return Err(not_installed("missing", json!({}))),
        };
        if metadata.len() != entry.byte_length {
            return Err(not_installed(
                "size-mismatch",
                json!({ "expected": entry.byte_length, "actual": metadata.len() }),
            ));
        }
        verified.push((entry.path.clone(), path, entry.byte_length));
    }
    Ok(VerifiedFiles {
        component,
        family: files.family.clone(),
        revision: files.revision.clone(),
        root: dir,
        scope: String::new(),
        files: verified,
    })
}

/// 相对、非空、不含 `..` / 根 / 盘符的路径。
fn is_plain_relative(path: &str) -> bool {
    let path = Path::new(path);
    !path.as_os_str().is_empty() && path.components().all(|component| matches!(component, Component::Normal(_)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle(dir: &Path, files: Vec<(&str, u64)>) -> ModelBundle {
        ModelBundle {
            bundle_id: "b".into(),
            backend: "mlx".into(),
            device: "metal".into(),
            components: Components {
                vad: Some(ModelFiles {
                    family: FAMILY_SILERO_VAD.into(),
                    revision: "r".into(),
                    dir: dir.to_string_lossy().into_owned(),
                    files: files
                        .into_iter()
                        .map(|(path, byte_length)| FileEntry {
                            path: path.into(),
                            sha256: String::new(),
                            byte_length,
                        })
                        .collect(),
                }),
                ..Components::default()
            },
            threads: 1,
            memory_budget_bytes: None,
        }
    }

    #[test]
    fn verify_checks_presence_size_and_shape() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("model.safetensors"), b"12345").unwrap();
        let ok = verify(&bundle(dir.path(), vec![("model.safetensors", 5)])).unwrap();
        let vad = ok.vad.unwrap();
        assert_eq!(vad.require_extension("safetensors").unwrap().len(), 1);
        assert!(vad.path("config.json").is_none());
        assert_eq!(vad.require("config.json").unwrap_err().code, codes::MODEL_NOT_INSTALLED);

        let missing = verify(&bundle(dir.path(), vec![("other.safetensors", 5)])).unwrap_err();
        assert_eq!(missing.code, codes::MODEL_NOT_INSTALLED);
        assert_eq!(missing.details.unwrap()["reason"], "missing");

        let size = verify(&bundle(dir.path(), vec![("model.safetensors", 6)])).unwrap_err();
        assert_eq!(size.details.unwrap()["reason"], "size-mismatch");

        for bad in ["../x", "/etc/passwd", "", "a/../b"] {
            assert_eq!(
                verify(&bundle(dir.path(), vec![(bad, 1)])).unwrap_err().code,
                codes::INVALID_PARAMS,
                "{bad}"
            );
        }
        assert_eq!(
            verify(&bundle(Path::new("relative"), vec![])).unwrap_err().code,
            codes::INVALID_PARAMS
        );
    }

    #[test]
    fn model_files_verify_alone_like_a_bundle_component() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("model.safetensors"), b"12345").unwrap();
        let files = bundle(dir.path(), vec![("model.safetensors", 5)]).components.vad.unwrap();
        let verified = files.verify("tts").unwrap();
        assert_eq!(verified.component, "tts");
        assert_eq!(verified.family, FAMILY_SILERO_VAD);
        assert_eq!(verified.require_extension_in("", "safetensors").unwrap().len(), 1);
        let error = verified.require("config.json").unwrap_err();
        assert_eq!(error.code, codes::MODEL_NOT_INSTALLED);
        assert_eq!(error.details.unwrap()["component"], "tts");

        let wrong_size = bundle(dir.path(), vec![("model.safetensors", 6)]).components.vad.unwrap();
        let error = wrong_size.verify("codec").unwrap_err();
        assert_eq!(error.code, codes::MODEL_NOT_INSTALLED);
        assert_eq!(error.details.unwrap()["reason"], "size-mismatch");
    }

    /// 一个带子目录的组件：顶层一个 safetensors，再加 `qwen/` 子目录下的另一套文件。
    fn nested() -> (tempfile::TempDir, VerifiedBundle) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("qwen/extra")).unwrap();
        let files = [
            ("config.json", "{}"),
            ("b.safetensors", "bb"),
            ("a.safetensors", "a"),
            ("qwen/vocab.json", "{}"),
            ("qwen/model-00002.safetensors", "22"),
            ("qwen/model-00001.safetensors", "1"),
            ("qwen/extra/deep.safetensors", "d"),
        ];
        for (path, content) in files {
            std::fs::write(dir.path().join(path), content).unwrap();
        }
        let listed = files.iter().map(|(path, content)| (*path, content.len() as u64)).collect();
        let verified = verify(&bundle(dir.path(), listed)).unwrap();
        (dir, verified)
    }

    #[test]
    fn components_are_looked_up_by_name() {
        let (_dir, verified) = nested();
        assert_eq!(verified.component("vad").unwrap().family, FAMILY_SILERO_VAD);
        for missing in ["asr", "aligner", "speaker", "tokenizer", "unknown"] {
            let error = verified.component(missing).unwrap_err();
            assert_eq!(error.code, codes::MODEL_UNSUPPORTED);
            assert_eq!(error.details.unwrap()["reason"], "missing-component");
        }
    }

    #[test]
    fn extension_queries_in_one_directory_do_not_recurse() {
        let (dir, verified) = nested();
        let vad = verified.component("vad").unwrap();
        // 原有的 with_extension 跨全部列出的文件。
        assert_eq!(vad.with_extension("safetensors").len(), 5);
        assert_eq!(
            vad.with_extension_in("", "safetensors"),
            [dir.path().join("a.safetensors"), dir.path().join("b.safetensors")]
        );
        assert_eq!(
            vad.with_extension_in("qwen/", "safetensors"),
            [
                dir.path().join("qwen/model-00001.safetensors"),
                dir.path().join("qwen/model-00002.safetensors")
            ]
        );
        let error = vad.require_extension_in("qwen", "onnx").unwrap_err();
        assert_eq!(error.code, codes::MODEL_NOT_INSTALLED);
        assert_eq!(error.details.unwrap()["file"], "qwen/*.onnx");
    }

    #[test]
    fn subdirectory_views_strip_the_prefix_and_report_full_paths() {
        let (dir, verified) = nested();
        let vad = verified.component("vad").unwrap();
        let qwen = vad.require_subdirectory("qwen").unwrap();
        assert_eq!(qwen.component, "vad");
        assert_eq!(qwen.require("vocab.json").unwrap(), dir.path().join("qwen/vocab.json"));
        assert!(qwen.path("config.json").is_none(), "上一级的文件不在子目录视图里");
        assert_eq!(qwen.with_extension_in("", "safetensors").len(), 2);
        assert_eq!(qwen.total_bytes(), 2 + 2 + 1 + 1);
        // 子目录视图里缺文件，报错给出模型包里的完整相对路径。
        let error = qwen.require("tokenizer.json").unwrap_err();
        assert_eq!(error.code, codes::MODEL_NOT_INSTALLED);
        assert_eq!(error.details.unwrap()["file"], "qwen/tokenizer.json");
        let deep = qwen.require_subdirectory("extra").unwrap();
        assert_eq!(
            deep.require("deep.safetensors").unwrap(),
            dir.path().join("qwen/extra/deep.safetensors")
        );
        assert_eq!(deep.require("x").unwrap_err().details.unwrap()["file"], "qwen/extra/x");
        // 没有列出任何文件的目录：候选目录挑选靠 None，必需时报 MODEL_NOT_INSTALLED。
        assert!(vad.subdirectory("Qwen2.5-Omni-3B").is_none());
        let error = qwen.require_subdirectory("missing").unwrap_err();
        assert_eq!(error.code, codes::MODEL_NOT_INSTALLED);
        assert_eq!(error.details.unwrap()["file"], "qwen/missing/");
        // 「qwen」不能匹配到「qwen-extra/」之类同前缀的兄弟目录。
        assert!(vad.subdirectory("qwe").is_none());
    }

    #[test]
    fn directories_are_handed_over_whole() {
        let (dir, verified) = nested();
        let vad = verified.component("vad").unwrap();
        assert_eq!(vad.require_directory("qwen/").unwrap(), dir.path().join("qwen"));
        // 子目录视图里取目录，路径仍从组件根目录算起。
        let qwen = vad.require_subdirectory("qwen").unwrap();
        assert_eq!(qwen.require_directory("extra").unwrap(), dir.path().join("qwen/extra"));
        let error = qwen.require_directory("Model.mlmodelc").unwrap_err();
        assert_eq!(error.code, codes::MODEL_NOT_INSTALLED);
        assert_eq!(error.details.unwrap()["file"], "qwen/Model.mlmodelc/");
        // 同前缀的兄弟目录、文件本身、越界路径都不算目录。
        assert!(vad.directory("qwe").is_none());
        assert!(vad.directory("config.json").is_none());
        assert!(vad.directory("").is_none());
        assert!(vad.directory("../qwen").is_none());
    }

    #[test]
    fn lookup_errors_flow_through_anyhow() {
        let (dir, verified) = nested();
        let find = || -> anyhow::Result<std::path::PathBuf> {
            let files = verified.component("vad")?;
            Ok(files.require("missing.json")?.to_path_buf())
        };
        let error = find().unwrap_err();
        let body = error.downcast_ref::<ErrorBody>().expect("ErrorBody survives the anyhow conversion");
        assert_eq!(body.code, codes::MODEL_NOT_INSTALLED);
        assert!(!error.to_string().contains(&*dir.path().to_string_lossy()), "报错不含本机绝对路径");
    }

    #[test]
    fn speech_components_parse_verify_and_count() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("tts")).unwrap();
        std::fs::create_dir_all(dir.path().join("codec")).unwrap();
        std::fs::write(dir.path().join("tts/model.safetensors"), b"1234").unwrap();
        std::fs::write(dir.path().join("codec/model.safetensors"), b"12").unwrap();
        let files = |sub: &str, family: &str, size: u64| {
            json!({
                "family": family,
                "revision": "r",
                "dir": dir.path().join(sub).to_string_lossy(),
                "files": [{ "path": "model.safetensors", "sha256": "", "byteLength": size }],
            })
        };
        let bundle: ModelBundle = serde_json::from_value(json!({
            "bundleId": "qwen3-tts-0.6b-base@mlx-8bit",
            "backend": "mlx",
            "device": "metal",
            "components": { "tts": files("tts", "qwen3-tts", 4), "codec": files("codec", "qwen3-tts-tokenizer", 2) },
            "threads": 1,
        }))
        .unwrap();
        assert!(bundle.components.has_speech());
        assert!(bundle.components.asr.is_none());
        let verified = verify(&bundle).unwrap();
        assert_eq!(verified.component("tts").unwrap().family, "qwen3-tts");
        assert_eq!(verified.component("codec").unwrap().component, "codec");
        assert_eq!(
            verified.component("aux").unwrap_err().details.unwrap()["reason"],
            "missing-component"
        );
        assert_eq!(verified.total_bytes(), 6);

        // 序列化回去仍是同一个形状（Runtime 与 Worker 的合同逐字对应）。
        let round: ModelBundle = serde_json::from_value(serde_json::to_value(&bundle).unwrap()).unwrap();
        assert_eq!(round.components.codec.unwrap().family, "qwen3-tts-tokenizer");
        // 不认识的组件名仍然拒绝。
        let unknown = json!({ "tts": files("tts", "qwen3-tts", 4), "vocoder": files("codec", "x", 2) });
        assert!(serde_json::from_value::<Components>(unknown).is_err());
        // 文件大小不符：合成的组件与识别的组件同样报 MODEL_NOT_INSTALLED，点名组件。
        let mut wrong = bundle.clone();
        wrong.components.tts.as_mut().unwrap().files[0].byte_length = 5;
        let error = verify(&wrong).unwrap_err();
        assert_eq!(error.code, codes::MODEL_NOT_INSTALLED);
        assert_eq!(error.details.unwrap()["component"], "tts");
    }
}
