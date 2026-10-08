//! 语音合成的请求 / 结果 / 进度类型。引擎与上层（Worker 的任务编排）只经这里对话。
//!
//! 移植自 v2 `bcut-tts-core::types`，只留本地引擎用得到的部分：云端引擎、产品已不支持的引擎、合成回执、
//! 「我的声音」（音色库在 Runtime 里解析成参考音频 + 原文，引擎只见 [`VoiceSpec::Clone`]）与只给云端用的
//! 旋钮不带来。请求一族保留 v2 的 serde 形状（`kind` 标签、字段大小写），线上形状由接线时的协议决定。

use super::readings::Reading;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 本地语音合成引擎种类；随移植批次逐个接上。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TtsEngineKind {
    /// Qwen3-TTS 12 Hz（Base：克隆；CustomVoice：预置说话人 + 指令；VoiceDesign：一句描述造声）。
    Qwen3Tts,
    /// IndexTTS2（参考音频克隆 + 情感控制，22.05 kHz）。
    IndexTts2,
    /// IndexTTS 2.5（tiktoken 多语言 zh/en/ja/es/ar，参考音频克隆 + 情感控制，22.05 kHz）。
    #[serde(rename = "index-tts2.5")]
    IndexTts25,
    /// GPT-SoVITS v2（参考音频克隆，参考文本可选，32 kHz）。
    GptSovits,
    /// VoxCPM2（MiniCPM4 底座 + 局部扩散 + AudioVAE，无分词连续表示；克隆 + 风格指令，48 kHz）。
    #[serde(rename = "voxcpm2")]
    VoxCpm2,
    /// OmniVoice（Qwen3 底座的掩码离散扩散，音色描述 / 克隆 / 时长与语速控制，24 kHz）。
    #[serde(rename = "omnivoice")]
    OmniVoice,
}

impl TtsEngineKind {
    /// 全部本地引擎，按声明次序。
    pub const ALL: [TtsEngineKind; 6] = [
        Self::Qwen3Tts,
        Self::IndexTts2,
        Self::IndexTts25,
        Self::GptSovits,
        Self::VoxCpm2,
        Self::OmniVoice,
    ];

    /// [`Self::as_str`] 的反函数；认不出给 `None`。
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == value)
    }

    /// 模型包里 `tts` 组件的 family（Model Worker 协议规范 §4.1）。与 [`Self::as_str`] 不全相同（`indextts2` 对 `index-tts2`）。
    pub const fn family(self) -> &'static str {
        use crate::bundle::{FAMILY_GPT_SOVITS, FAMILY_INDEXTTS2, FAMILY_INDEXTTS25, FAMILY_OMNIVOICE, FAMILY_QWEN3_TTS, FAMILY_VOXCPM2};
        match self {
            Self::Qwen3Tts => FAMILY_QWEN3_TTS,
            Self::IndexTts2 => FAMILY_INDEXTTS2,
            Self::IndexTts25 => FAMILY_INDEXTTS25,
            Self::GptSovits => FAMILY_GPT_SOVITS,
            Self::VoxCpm2 => FAMILY_VOXCPM2,
            Self::OmniVoice => FAMILY_OMNIVOICE,
        }
    }

    /// [`Self::family`] 的反函数；不是合成主模型的 family 给 `None`。
    pub fn from_family(family: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.family() == family)
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Qwen3Tts => "qwen3-tts",
            Self::IndexTts2 => "index-tts2",
            Self::IndexTts25 => "index-tts2.5",
            Self::GptSovits => "gpt-sovits",
            Self::VoxCpm2 => "voxcpm2",
            Self::OmniVoice => "omnivoice",
        }
    }

    /// 输出口径版本：同一请求（文本 / 音色 / 采样 / 种子）在新版里出的音频可能不同时递增。
    ///
    /// - Qwen3-TTS 2：token 上限的下限 75 → 125 帧，此前被截断的段要重合成。
    /// - Qwen3-TTS 3：注音按同音代表字渲染；此前 `<字|读音>` 原样进 tokenizer。
    /// - IndexTTS2 2：注音按词表拼音片渲染、数字规范化护住拼音片。
    /// - Qwen3-TTS 4、VoxCPM2 2：多块合成的块边界去首尾静音、插固定停顿、响度对齐到第一块（`synthesize::stitch`）。
    pub const fn output_revision(self) -> u32 {
        match self {
            Self::Qwen3Tts => 4,
            Self::IndexTts2 | Self::VoxCpm2 => 2,
            Self::IndexTts25 | Self::GptSovits | Self::OmniVoice => 1,
        }
    }

    /// 这只引擎怎么吃 `<字|读音>` 注音（架构设计 §6.1：由适配器转成各模型自己的写法，不支持时如实报告）。
    /// 新增引擎必须在这里给出取值，并在 `readings::tests::DOC_TABLE` 加一行。
    pub const fn readings_support(self) -> ReadingsSupport {
        match self {
            Self::Qwen3Tts => ReadingsSupport::Homophone,
            Self::IndexTts2 => ReadingsSupport::InlinePinyin,
            Self::IndexTts25 => ReadingsSupport::Annotated,
            Self::GptSovits => ReadingsSupport::Unsupported,
            // 官方都没有读音通道（上游 README）；按表面文字送。
            Self::VoxCpm2 | Self::OmniVoice => ReadingsSupport::Unsupported,
        }
    }

    /// 引擎原生输出采样率（Hz）。
    pub const fn native_sample_rate(self) -> u32 {
        match self {
            Self::Qwen3Tts => 24_000,
            Self::IndexTts2 | Self::IndexTts25 => 22_050,
            Self::GptSovits => 32_000,
            Self::VoxCpm2 => 48_000,
            Self::OmniVoice => 24_000,
        }
    }
}

/// 一只引擎怎么吃读音（新增引擎必须在 [`TtsEngineKind::readings_support`] 给出取值）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReadingsSupport {
    /// 原样送 `<表面|读音>`：IndexTTS 2.5 的前端就吃这个语法。
    Annotated,
    /// 把字换成词表里有的大写拼音片（`XING2`）：IndexTTS2，上游「Pinyin control」。
    InlinePinyin,
    /// 换成同读音、本身不是多音字的常用字：Qwen3-TTS（官方没有读音通道；
    /// v2 真权重 + ASR 对拍胜过正文写拼音）。词组表来源的注记不换。
    Homophone,
    /// 不认读音：按表面文字送，注记全部报 `dropped`。线上名 `none`（`unsupported` 是错误
    /// kind，不拿来当能力值）。
    #[serde(rename = "none")]
    Unsupported,
}

impl ReadingsSupport {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Annotated => "annotated",
            Self::InlinePinyin => "inline-pinyin",
            Self::Homophone => "homophone",
            Self::Unsupported => "none",
        }
    }
}

/// 说什么声音。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum VoiceSpec {
    /// 引擎默认音色（CustomVoice 按语言挑说话人；只能克隆的引擎按语言挑内置音色）。
    Default,
    /// 预置说话人（Qwen3-TTS CustomVoice 的 `Vivian`、`Ryan` 等）或内置音色 id（`zh-female` 等）。
    Preset { speaker: String },
    /// 用参考音频克隆音色；`reference_text` 是参考音频的原文，Qwen3-TTS ICL
    /// 模式需要它（缺省时只用 x-vector），IndexTTS2 忽略它。
    Clone {
        reference_audio: PathBuf,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reference_text: Option<String>,
    },
}

/// 采样参数；`None` 走各引擎的推荐默认值。
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SamplingOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_k: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repetition_penalty: Option<f32>,
    /// 每个文本块最多生成的语音 token 数；`None` 按引擎默认。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<usize>,
    /// 随机种子；`None` 表示每次不同。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<u64>,
    /// 无分类器引导强度（VoxCPM2 / OmniVoice，官方默认都是 2.0）；`None` 按引擎默认。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cfg: Option<f32>,
    /// 扩散 / 迭代解码步数（VoxCPM2 默认 10，OmniVoice 默认 32）；`None` 按引擎默认。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steps: Option<usize>,
}

/// IndexTTS 官方网页的「情感权重」缺省值（`webui.py` 的 `emo_weight` 滑块）：情感参考音频
/// 的混合系数与情感向量的缩放都用它（官方 `infer(emo_alpha=…)`）。
pub const DEFAULT_EMOTION_ALPHA: f32 = 0.65;

fn default_emotion_alpha() -> f32 {
    DEFAULT_EMOTION_ALPHA
}

/// IndexTTS2 / IndexTTS 2.5 情感控制。参数语义照官方网页（`webui.py`）：
/// 情感参考音频按 `alpha` 与音色参考混合；情感向量是八个 0–1 的滑块，引擎先按官方
/// `normalize_emo_vec` 加偏置、把合计缩到 0.8 以内，再乘 `alpha`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum EmotionSpec {
    /// 从另一段参考音频取情感。
    Audio { reference_audio: PathBuf, alpha: f32 },
    /// 八维情感滑块（happy, angry, sad, afraid, disgusted, melancholic, surprised, calm），
    /// 每维 0–1；`alpha` 是情感权重，省略取 [`DEFAULT_EMOTION_ALPHA`]。
    Vector {
        weights: [f32; 8],
        #[serde(default = "default_emotion_alpha")]
        alpha: f32,
    },
}

/// 一次合成请求。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsRequest {
    pub text: String,
    /// BCP-47 风格语言码（`zh`、`en`、`ja`…）；`None` 让引擎自动判断。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    pub voice: VoiceSpec,
    /// 自然语言指令：Qwen3-TTS CustomVoice / VoxCPM2 是风格（如「用兴奋的语气」），
    /// Qwen3-TTS VoiceDesign / OmniVoice 是音色描述。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instruct: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emotion: Option<EmotionSpec>,
    /// 目标音频时长（秒）。OmniVoice 用它确定目标 token 数；翻译配音应传入时间槽长度。
    /// 其他自回归引擎当前忽略该字段。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_duration_seconds: Option<f64>,
    #[serde(default)]
    pub sampling: SamplingOptions,
    /// 语速倍率（IndexTTS 2.5 与 OmniVoice）；其余本地引擎不收。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speed: Option<f32>,
}

impl TtsRequest {
    pub fn new(text: impl Into<String>, voice: VoiceSpec) -> Self {
        Self {
            text: text.into(),
            language: None,
            voice,
            instruct: None,
            emotion: None,
            target_duration_seconds: None,
            sampling: SamplingOptions::default(),
            speed: None,
        }
    }
}

/// 合成结果：单声道 f32 PCM，范围 [-1, 1]。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TtsAudio {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    /// 请求文字里没能按注记念的读音（引擎不认、词表没有这个片、没有代表字、注记畸形），
    /// 偏移落在去注记后的表面文字上；由 [`crate::synthesize::load`] 的包装层
    /// （[`crate::synthesize::readings::Annotating`]）填写，引擎自己构造时留空。
    pub readings_dropped: Vec<Reading>,
}

impl TtsAudio {
    pub fn duration_seconds(&self) -> f64 {
        self.samples.len() as f64 / f64::from(self.sample_rate)
    }

    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }
}

/// 合成进度事件。回调返回 `false` 表示取消。
#[derive(Debug, Clone, PartialEq)]
pub enum TtsProgress {
    /// 正在加载权重或参考音频。
    Loading { stage: String },
    /// 开始第 `index` 个文本块（0 起，共 `count` 个）。
    ChunkStarted { index: usize, count: usize },
    /// 当前块已生成的语音 token 数。
    Tokens { index: usize, generated: usize },
    /// 当前块解码为波形完成，累计已生成音频秒数。
    ChunkFinished { index: usize, seconds: f64 },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 请求一族的 serde 形状沿用 v2：改 serde 属性（`kind` 标签、字段大小写、`index-tts2.5` 的改名）会先在这里红。
    #[test]
    fn request_wire_shape_is_pinned() {
        let request = TtsRequest {
            text: "你好".to_owned(),
            language: Some("zh".to_owned()),
            voice: VoiceSpec::Clone {
                reference_audio: PathBuf::from("/r.wav"),
                reference_text: Some("参考".to_owned()),
            },
            instruct: Some("calm".to_owned()),
            emotion: Some(EmotionSpec::Vector {
                weights: [0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                alpha: 0.25,
            }),
            target_duration_seconds: Some(2.5),
            sampling: SamplingOptions {
                temperature: Some(0.5),
                top_k: Some(20),
                seed: Some(7),
                ..SamplingOptions::default()
            },
            speed: None,
        };
        let wire = json!({
            "text": "你好",
            "language": "zh",
            "voice": {"kind": "clone", "reference_audio": "/r.wav", "reference_text": "参考"},
            "instruct": "calm",
            "emotion": {"kind": "vector", "weights": [0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], "alpha": 0.25},
            "targetDurationSeconds": 2.5,
            "sampling": {"temperature": 0.5, "topK": 20, "seed": 7},
        });
        assert_eq!(serde_json::to_value(&request).unwrap(), wire);
        assert_eq!(serde_json::from_value::<TtsRequest>(wire).unwrap(), request);

        let minimal = TtsRequest::new(
            "hi",
            VoiceSpec::Preset {
                speaker: "zh-female".to_owned(),
            },
        );
        assert_eq!(
            serde_json::to_value(&minimal).unwrap(),
            json!({"text": "hi", "voice": {"kind": "preset", "speaker": "zh-female"}, "sampling": {}})
        );
        assert_eq!(serde_json::to_value(VoiceSpec::Default).unwrap(), json!({"kind": "default"}));
        assert_eq!(
            serde_json::to_value(EmotionSpec::Audio {
                reference_audio: PathBuf::from("/e.wav"),
                alpha: 1.0
            })
            .unwrap(),
            json!({"kind": "audio", "reference_audio": "/e.wav", "alpha": 1.0})
        );
        let kinds = [
            (TtsEngineKind::Qwen3Tts, "qwen3-tts"),
            (TtsEngineKind::IndexTts2, "index-tts2"),
            (TtsEngineKind::IndexTts25, "index-tts2.5"),
            (TtsEngineKind::GptSovits, "gpt-sovits"),
            (TtsEngineKind::VoxCpm2, "voxcpm2"),
            (TtsEngineKind::OmniVoice, "omnivoice"),
        ];
        for (kind, wire) in kinds {
            assert_eq!(serde_json::to_value(kind).unwrap(), json!(wire));
            assert_eq!(kind.as_str(), wire);
            assert_eq!(TtsEngineKind::from_str(wire), Some(kind));
        }
        assert_eq!(TtsEngineKind::from_str("unknown-engine"), None);
        // 模型包的 family 一一对应引擎（协议规范 §4.1 的 family 列表）。
        let families = ["qwen3-tts", "indextts2", "indextts2.5", "gpt-sovits", "voxcpm2", "omnivoice"];
        for (kind, family) in TtsEngineKind::ALL.into_iter().zip(families) {
            assert_eq!(kind.family(), family);
            assert_eq!(TtsEngineKind::from_family(family), Some(kind));
        }
        assert_eq!(TtsEngineKind::from_family("qwen3-tts-tokenizer"), None);
        assert_eq!(TtsEngineKind::from_family("index-tts2"), None);
        assert_eq!(TtsEngineKind::Qwen3Tts.native_sample_rate(), 24_000);
        assert_eq!(serde_json::to_value(ReadingsSupport::Unsupported).unwrap(), json!("none"));
        assert_eq!(serde_json::to_value(ReadingsSupport::InlinePinyin).unwrap(), json!("inline-pinyin"));
        for support in [
            ReadingsSupport::Annotated,
            ReadingsSupport::InlinePinyin,
            ReadingsSupport::Homophone,
            ReadingsSupport::Unsupported,
        ] {
            assert_eq!(serde_json::to_value(support).unwrap(), json!(support.as_str()));
        }
    }
}
