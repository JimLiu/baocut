//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/Qwen3TTS/Configuration.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Qwen3-TTS 模型配置：从模型包的 `config.json` 解析出
//! Talker / Code Predictor 维度、量化位宽与 CustomVoice 的说话人表。
//!
//! 纯逻辑，全平台编译；权重形状仍以 safetensors 为准，这里只决定模块的
//! 构造参数。

use anyhow::{Context, Result, bail};
use serde::Deserialize;
use std::collections::BTreeMap;

/// 模型规模：0.6B（隐藏维 1024）或 1.7B（隐藏维 2048）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelSize {
    Small,
    Large,
}

/// Talker（28 层 Qwen3 主干）配置，默认值即 0.6B。
#[derive(Debug, Clone, PartialEq)]
pub struct TalkerConfig {
    pub hidden_size: usize,
    pub num_layers: usize,
    pub num_heads: usize,
    pub num_kv_heads: usize,
    pub head_dim: usize,
    pub intermediate_size: usize,
    pub rope_theta: f32,
    pub rms_norm_eps: f32,
    pub text_vocab_size: usize,
    pub text_hidden_size: usize,
    pub codec_vocab_size: usize,
    /// 0 表示 bf16 非量化；4 / 8 表示 MLX 仿射量化位宽。
    pub bits: u32,
    pub group_size: usize,
}

impl Default for TalkerConfig {
    fn default() -> Self {
        Self {
            hidden_size: 1024,
            num_layers: 28,
            num_heads: 16,
            num_kv_heads: 8,
            head_dim: 128,
            intermediate_size: 3072,
            rope_theta: 1_000_000.0,
            rms_norm_eps: 1e-6,
            text_vocab_size: 151_936,
            text_hidden_size: 2048,
            codec_vocab_size: 3072,
            bits: 8,
            group_size: 64,
        }
    }
}

impl TalkerConfig {
    /// 1.7B：隐藏维 2048、FFN 6144，其余同 0.6B。
    pub fn large() -> Self {
        Self {
            hidden_size: 2048,
            intermediate_size: 6144,
            ..Self::default()
        }
    }
}

/// Code Predictor（5 层小 transformer，15 个 lm head）配置。
#[derive(Debug, Clone, PartialEq)]
pub struct CodePredictorConfig {
    pub hidden_size: usize,
    /// 输入嵌入维（等于 Talker 隐藏维；1.7B 为 2048，需要 `small_to_mtp_projection`）。
    pub embedding_dim: usize,
    pub num_layers: usize,
    pub num_heads: usize,
    pub num_kv_heads: usize,
    pub head_dim: usize,
    pub intermediate_size: usize,
    pub rope_theta: f32,
    pub rms_norm_eps: f32,
    pub vocab_size: usize,
    pub num_code_groups: usize,
    pub bits: u32,
    pub group_size: usize,
}

impl Default for CodePredictorConfig {
    fn default() -> Self {
        Self {
            hidden_size: 1024,
            embedding_dim: 1024,
            num_layers: 5,
            num_heads: 16,
            num_kv_heads: 8,
            head_dim: 128,
            intermediate_size: 3072,
            rope_theta: 1_000_000.0,
            rms_norm_eps: 1e-6,
            vocab_size: 2048,
            num_code_groups: 16,
            bits: 8,
            group_size: 64,
        }
    }
}

impl CodePredictorConfig {
    pub fn large() -> Self {
        Self {
            embedding_dim: 2048,
            ..Self::default()
        }
    }

    /// 是否需要 embedding_dim → hidden_size 的投影。
    pub fn needs_projection(&self) -> bool {
        self.embedding_dim != self.hidden_size
    }
}

/// 官方 12 Hz 系列的三种变体（对照 `config.json` 的 `tts_model_type`）：
/// Base 走参考音频克隆，CustomVoice 走 9 个预置说话人，VoiceDesign 只吃一句
/// 声音描述。老的精简导出（aufklarer 的 Base）没有这个字段，按说话人表回退。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelVariant {
    Base,
    CustomVoice,
    VoiceDesign,
}

impl ModelVariant {
    /// 报错文案里的变体名，与官方仓库名一致。
    pub fn label(self) -> &'static str {
        match self {
            Self::Base => "Base",
            Self::CustomVoice => "CustomVoice",
            Self::VoiceDesign => "VoiceDesign",
        }
    }
}

/// CustomVoice 变体的说话人表（Base 模型没有，为 `None`）。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SpeakerConfig {
    /// 小写说话人名 → codec token id。
    pub speaker_ids: BTreeMap<String, i32>,
    /// 小写说话人名 → 方言语言名（如 `sichuan_dialect`）。
    pub speaker_dialects: BTreeMap<String, String>,
    /// config.json 里声明的语言 id 表（小写语言名 → id）。
    pub codec_language_ids: BTreeMap<String, i32>,
}

impl SpeakerConfig {
    /// 按字母序排列的说话人名。
    pub fn available_speakers(&self) -> Vec<String> {
        self.speaker_ids.keys().cloned().collect()
    }
}

/// 一个模型目录解析出的完整配置。
#[derive(Debug, Clone, PartialEq)]
pub struct Qwen3TtsConfig {
    pub model_size: ModelSize,
    pub variant: ModelVariant,
    pub talker: TalkerConfig,
    pub code_predictor: CodePredictorConfig,
    pub speaker: Option<SpeakerConfig>,
}

impl Qwen3TtsConfig {
    /// 按规模与位宽构造默认配置。
    pub fn for_size(size: ModelSize, bits: u32) -> Self {
        let mut talker = match size {
            ModelSize::Small => TalkerConfig::default(),
            ModelSize::Large => TalkerConfig::large(),
        };
        let mut code_predictor = match size {
            ModelSize::Small => CodePredictorConfig::default(),
            ModelSize::Large => CodePredictorConfig::large(),
        };
        talker.bits = bits;
        code_predictor.bits = bits;
        Self {
            model_size: size,
            variant: ModelVariant::Base,
            talker,
            code_predictor,
            speaker: None,
        }
    }

    /// 是否是量化权重（决定线性层走 `QuantizedDense` 还是 `Dense`）。
    pub fn is_quantized(&self) -> bool {
        self.talker.bits != 0
    }

    /// 解析模型目录里的 `config.json` 文本。
    pub fn parse(json: &str) -> Result<Self> {
        let raw: RawConfig = serde_json::from_str(json).context("解析 Qwen3-TTS config.json 失败")?;

        let declared = raw.model_size.as_deref().map(size_from_model_size).transpose()?;
        let by_dim = raw
            .talker_config
            .as_ref()
            .and_then(|t| t.hidden_size)
            .map(size_from_hidden)
            .transpose()?;
        if let (Some(a), Some(b)) = (declared, by_dim)
            && a != b
        {
            bail!("config.json 的 model_size 与 talker_config.hidden_size 冲突");
        }
        let Some(size) = declared.or(by_dim) else {
            bail!("config.json 缺少 model_size 或 talker_config.hidden_size");
        };

        let bits = match &raw.quantization_config {
            Some(q) => {
                if q.bits != 4 && q.bits != 8 {
                    bail!("quantization_config.bits 只支持 4 或 8，实际 {}", q.bits);
                }
                q.bits
            }
            None => 0,
        };

        let mut config = Self::for_size(size, bits);
        if let Some(group) = raw.quantization_config.as_ref().and_then(|q| q.group_size) {
            if group == 0 {
                bail!("quantization_config.group_size 必须为正");
            }
            config.talker.group_size = group;
            config.code_predictor.group_size = group;
        }

        if let Some(talker) = &raw.talker_config {
            talker.apply(&mut config.talker)?;
            if let Some(cp) = &talker.code_predictor_config {
                cp.apply(&mut config.code_predictor)?;
            }
            config.speaker = talker.speaker_config();
        }
        config.variant = match raw.tts_model_type.as_deref().map(str::trim) {
            Some("custom_voice") => ModelVariant::CustomVoice,
            Some("voice_design") => ModelVariant::VoiceDesign,
            Some("base") | Some("") | None => {
                // 精简导出没有这个字段：有说话人表就是 CustomVoice，否则按 Base。
                if config.speaker.is_some() {
                    ModelVariant::CustomVoice
                } else {
                    ModelVariant::Base
                }
            }
            Some(other) => bail!("不支持的 tts_model_type：{other}"),
        };
        Ok(config)
    }
}

fn size_from_model_size(value: &str) -> Result<ModelSize> {
    match value.trim().to_ascii_lowercase().as_str() {
        "0.6b" => Ok(ModelSize::Small),
        "1.7b" => Ok(ModelSize::Large),
        other => bail!("不支持的 model_size：{other}"),
    }
}

fn size_from_hidden(hidden: usize) -> Result<ModelSize> {
    match hidden {
        1024 => Ok(ModelSize::Small),
        2048 => Ok(ModelSize::Large),
        other => bail!("不支持的 talker_config.hidden_size：{other}"),
    }
}

#[derive(Deserialize)]
struct RawConfig {
    model_size: Option<String>,
    tts_model_type: Option<String>,
    quantization_config: Option<RawQuantization>,
    talker_config: Option<RawTalker>,
}

#[derive(Deserialize)]
struct RawQuantization {
    bits: u32,
    group_size: Option<usize>,
}

#[derive(Deserialize)]
struct RawTalker {
    hidden_size: Option<usize>,
    num_hidden_layers: Option<usize>,
    num_attention_heads: Option<usize>,
    num_key_value_heads: Option<usize>,
    head_dim: Option<usize>,
    intermediate_size: Option<usize>,
    rope_theta: Option<f64>,
    rms_norm_eps: Option<f64>,
    text_vocab_size: Option<usize>,
    text_hidden_size: Option<usize>,
    vocab_size: Option<usize>,
    code_predictor_config: Option<RawCodePredictor>,
    #[serde(default)]
    spk_id: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    spk_is_dialect: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    codec_language_id: BTreeMap<String, serde_json::Value>,
}

fn positive(name: &str, value: Option<usize>) -> Result<()> {
    if value == Some(0) {
        bail!("{name} 必须为正");
    }
    Ok(())
}

impl RawTalker {
    fn apply(&self, config: &mut TalkerConfig) -> Result<()> {
        positive("talker_config.hidden_size", self.hidden_size)?;
        positive("talker_config.num_hidden_layers", self.num_hidden_layers)?;
        positive("talker_config.num_attention_heads", self.num_attention_heads)?;
        positive("talker_config.num_key_value_heads", self.num_key_value_heads)?;
        positive("talker_config.head_dim", self.head_dim)?;
        positive("talker_config.intermediate_size", self.intermediate_size)?;
        positive("talker_config.text_vocab_size", self.text_vocab_size)?;
        positive("talker_config.text_hidden_size", self.text_hidden_size)?;
        positive("talker_config.vocab_size", self.vocab_size)?;
        if let Some(v) = self.hidden_size {
            config.hidden_size = v;
        }
        if let Some(v) = self.num_hidden_layers {
            config.num_layers = v;
        }
        if let Some(v) = self.num_attention_heads {
            config.num_heads = v;
        }
        if let Some(v) = self.num_key_value_heads {
            config.num_kv_heads = v;
        }
        if let Some(v) = self.head_dim {
            config.head_dim = v;
        }
        if let Some(v) = self.intermediate_size {
            config.intermediate_size = v;
        }
        if let Some(v) = self.rope_theta {
            config.rope_theta = v as f32;
        }
        if let Some(v) = self.rms_norm_eps {
            config.rms_norm_eps = v as f32;
        }
        if let Some(v) = self.text_vocab_size {
            config.text_vocab_size = v;
        }
        if let Some(v) = self.text_hidden_size {
            config.text_hidden_size = v;
        }
        if let Some(v) = self.vocab_size {
            config.codec_vocab_size = v;
        }
        Ok(())
    }

    /// spk_id 为空即 Base 模型，返回 `None`；
    /// `spk_is_dialect` 里只有字符串值才是方言（布尔 false 忽略）。
    fn speaker_config(&self) -> Option<SpeakerConfig> {
        let mut speaker_ids = BTreeMap::new();
        for (name, value) in &self.spk_id {
            if let Some(id) = value.as_i64() {
                speaker_ids.insert(name.to_lowercase(), id as i32);
            }
        }
        if speaker_ids.is_empty() {
            return None;
        }
        let mut speaker_dialects = BTreeMap::new();
        for (name, value) in &self.spk_is_dialect {
            if let Some(dialect) = value.as_str() {
                speaker_dialects.insert(name.to_lowercase(), dialect.to_lowercase());
            }
        }
        let mut codec_language_ids = BTreeMap::new();
        for (name, value) in &self.codec_language_id {
            if let Some(id) = value.as_i64() {
                codec_language_ids.insert(name.to_lowercase(), id as i32);
            }
        }
        Some(SpeakerConfig {
            speaker_ids,
            speaker_dialects,
            codec_language_ids,
        })
    }
}

/// `config.json` 里 CustomVoice 的说话人名（`talker_config.spk_id` 的键）。官方名单
/// （[`super::prompt::CUSTOM_VOICE_SPEAKERS`]）里有的用名单的写法、按名单次序排在前面（官方
/// 权重的键是小写）；名单外的照原文、按字母序跟在后面。大小写不同的同名键只留一个——引擎
/// 按小写建表（[`SpeakerConfig::speaker_ids`]），它们本就是同一只。没有说话人表（Base）或
/// 解析不了给 `None`。
pub fn declared_speakers(json: &str) -> Option<Vec<String>> {
    let raw: RawConfig = serde_json::from_str(json).ok()?;
    let known = &super::prompt::CUSTOM_VOICE_SPEAKERS;
    let mut names: Vec<(usize, String)> = raw
        .talker_config?
        .spk_id
        .into_iter()
        .filter(|(_, id)| id.as_i64().is_some())
        .map(|(name, _)| match known.iter().position(|k| k.eq_ignore_ascii_case(&name)) {
            Some(rank) => (rank, known[rank].to_owned()),
            None => (usize::MAX, name),
        })
        .collect();
    names.sort_by_cached_key(|(rank, name)| (*rank, name.to_lowercase(), name.clone()));
    names.dedup_by(|a, b| a.1.to_lowercase() == b.1.to_lowercase());
    (!names.is_empty()).then(|| names.into_iter().map(|(_, name)| name).collect())
}

/// 同上，读模型包清单里列出的 `config.json`；没列出或读不了给 `None`。
pub fn declared_speakers_in(model: &crate::bundle::VerifiedFiles) -> Option<Vec<String>> {
    declared_speakers(&std::fs::read_to_string(model.path("config.json")?).ok()?)
}

#[derive(Deserialize)]
struct RawCodePredictor {
    hidden_size: Option<usize>,
    num_hidden_layers: Option<usize>,
    num_attention_heads: Option<usize>,
    num_key_value_heads: Option<usize>,
    head_dim: Option<usize>,
    intermediate_size: Option<usize>,
    rope_theta: Option<f64>,
    rms_norm_eps: Option<f64>,
    vocab_size: Option<usize>,
    num_code_groups: Option<usize>,
}

impl RawCodePredictor {
    fn apply(&self, config: &mut CodePredictorConfig) -> Result<()> {
        positive("code_predictor_config.hidden_size", self.hidden_size)?;
        positive("code_predictor_config.num_hidden_layers", self.num_hidden_layers)?;
        positive("code_predictor_config.num_attention_heads", self.num_attention_heads)?;
        positive("code_predictor_config.num_key_value_heads", self.num_key_value_heads)?;
        positive("code_predictor_config.head_dim", self.head_dim)?;
        positive("code_predictor_config.intermediate_size", self.intermediate_size)?;
        positive("code_predictor_config.vocab_size", self.vocab_size)?;
        positive("code_predictor_config.num_code_groups", self.num_code_groups)?;
        if let Some(v) = self.hidden_size {
            config.hidden_size = v;
        }
        if let Some(v) = self.num_hidden_layers {
            config.num_layers = v;
        }
        if let Some(v) = self.num_attention_heads {
            config.num_heads = v;
        }
        if let Some(v) = self.num_key_value_heads {
            config.num_kv_heads = v;
        }
        if let Some(v) = self.head_dim {
            config.head_dim = v;
        }
        if let Some(v) = self.intermediate_size {
            config.intermediate_size = v;
        }
        if let Some(v) = self.rope_theta {
            config.rope_theta = v as f32;
        }
        if let Some(v) = self.rms_norm_eps {
            config.rms_norm_eps = v as f32;
        }
        if let Some(v) = self.vocab_size {
            config.vocab_size = v;
        }
        if let Some(v) = self.num_code_groups {
            config.num_code_groups = v;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_base_8bit_config() {
        let json = r#"{
            "model_size": "0.6B",
            "quantization_config": {"bits": 8, "group_size": 64},
            "talker_config": {
                "hidden_size": 1024, "num_hidden_layers": 28, "num_attention_heads": 16,
                "num_key_value_heads": 8, "head_dim": 128, "intermediate_size": 3072,
                "rope_theta": 1000000.0, "rms_norm_eps": 1e-6, "text_hidden_size": 2048,
                "spk_id": {}
            }
        }"#;
        let config = Qwen3TtsConfig::parse(json).unwrap();
        assert_eq!(config.model_size, ModelSize::Small);
        assert_eq!(config.talker.bits, 8);
        assert_eq!(config.code_predictor.bits, 8);
        assert!(config.is_quantized());
        assert!(config.speaker.is_none());
        assert_eq!(config.talker, TalkerConfig::default());
    }

    #[test]
    fn declares_variant_from_tts_model_type() {
        // 1.7B CustomVoice（mlx-community 8bit 导出）：说话人表与 0.6B 同源。
        let custom = Qwen3TtsConfig::parse(
            r#"{
            "tts_model_type": "custom_voice",
            "quantization_config": {"bits": 8, "group_size": 64},
            "talker_config": {"hidden_size": 2048, "intermediate_size": 6144,
                "spk_id": {"Vivian": 3065, "Dylan": 2878},
                "spk_is_dialect": {"dylan": "beijing_dialect"},
                "code_predictor_config": {"hidden_size": 1024}}
        }"#,
        )
        .unwrap();
        assert_eq!(custom.model_size, ModelSize::Large);
        assert_eq!(custom.variant, ModelVariant::CustomVoice);
        assert_eq!(custom.speaker.unwrap().speaker_ids["vivian"], 3065);
        assert!(custom.code_predictor.needs_projection());

        // 1.7B VoiceDesign：spk_id 是空表，只吃声音描述。
        let design = Qwen3TtsConfig::parse(
            r#"{
            "tts_model_type": "voice_design",
            "quantization_config": {"bits": 8, "group_size": 64},
            "talker_config": {"hidden_size": 2048, "intermediate_size": 6144,
                "spk_id": {}, "codec_language_id": {"chinese": 2055}}
        }"#,
        )
        .unwrap();
        assert_eq!(design.variant, ModelVariant::VoiceDesign);
        assert!(design.speaker.is_none());

        // 精简导出（aufklarer Base）没有这个字段，按说话人表回退。
        let base = Qwen3TtsConfig::parse(r#"{"model_size": "1.7B", "quantization_config": {"bits": 8, "group_size": 64}}"#).unwrap();
        assert_eq!(base.variant, ModelVariant::Base);

        assert!(Qwen3TtsConfig::parse(r#"{"model_size": "0.6B", "tts_model_type": "ictl"}"#).is_err());
    }

    /// 官方名单里的说话人用名单写法、按名单次序在前（官方权重的键是小写），名单外的照原文、
    /// 按字母序在后，大小写不同的同名键只留一个；Base（`spk_id` 为空）、非整数 id、解析不了都
    /// 不算说话人表。
    #[test]
    fn declared_speakers_use_published_names_and_order() {
        let json = r#"{"talker_config": {"spk_id": {
            "zed": 3100, "Zed": 3100, "eric": 2875, "uncle_fu": 3010, "vivian": 3065,
            "Ada": 3200, "broken": "x"
        }}}"#;
        assert_eq!(declared_speakers(json).unwrap(), ["Vivian", "Uncle_Fu", "Eric", "Ada", "Zed"]);
        assert_eq!(declared_speakers(r#"{"talker_config": {"spk_id": {}}}"#), None);
        assert_eq!(declared_speakers(r#"{"model_size": "0.6B"}"#), None);
        assert_eq!(declared_speakers("not json"), None);
        let dir = tempfile::tempdir().unwrap();
        let not_listed = crate::bundle::ModelFiles {
            family: crate::bundle::FAMILY_QWEN3_TTS.into(),
            revision: "r".into(),
            dir: dir.path().to_string_lossy().into_owned(),
            files: Vec::new(),
        }
        .verify("tts")
        .unwrap();
        assert_eq!(declared_speakers_in(&not_listed), None);
    }

    #[test]
    fn parses_custom_voice_bf16_config() {
        let json = r#"{
            "model_size": "0.6B",
            "talker_config": {
                "hidden_size": 1024,
                "codec_language_id": {"chinese": 2055, "english": 2050},
                "spk_id": {"Vivian": 3065, "eric": 2875},
                "spk_is_dialect": {"vivian": false, "eric": "sichuan_dialect"},
                "text_vocab_size": 151936, "vocab_size": 3072,
                "code_predictor_config": {"hidden_size": 1024, "num_hidden_layers": 5, "vocab_size": 2048, "num_code_groups": 16}
            }
        }"#;
        let config = Qwen3TtsConfig::parse(json).unwrap();
        assert_eq!(config.talker.bits, 0);
        assert!(!config.is_quantized());
        let speaker = config.speaker.unwrap();
        assert_eq!(speaker.speaker_ids["vivian"], 3065);
        assert_eq!(speaker.speaker_dialects.get("eric").map(String::as_str), Some("sichuan_dialect"));
        assert!(!speaker.speaker_dialects.contains_key("vivian"));
        assert_eq!(speaker.available_speakers(), vec!["eric".to_string(), "vivian".to_string()]);
        assert_eq!(speaker.codec_language_ids["chinese"], 2055);
        assert!(!config.code_predictor.needs_projection());
    }

    #[test]
    fn large_by_hidden_size_needs_projection() {
        let json = r#"{"talker_config": {"hidden_size": 2048}}"#;
        let config = Qwen3TtsConfig::parse(json).unwrap();
        assert_eq!(config.model_size, ModelSize::Large);
        assert_eq!(config.talker.intermediate_size, 6144);
        assert!(config.code_predictor.needs_projection());
    }

    #[test]
    fn rejects_conflicts_and_bad_bits() {
        assert!(Qwen3TtsConfig::parse(r#"{"model_size": "0.6B", "talker_config": {"hidden_size": 2048}}"#).is_err());
        assert!(Qwen3TtsConfig::parse(r#"{"model_size": "0.6B", "quantization_config": {"bits": 3}}"#).is_err());
        assert!(Qwen3TtsConfig::parse(r#"{"quantization_config": {"bits": 8}}"#).is_err());
        assert!(Qwen3TtsConfig::parse(r#"{"model_size": "0.6B", "talker_config": {"num_hidden_layers": 0}}"#).is_err());
    }
}
