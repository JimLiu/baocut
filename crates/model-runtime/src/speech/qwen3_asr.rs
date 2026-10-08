//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/Qwen3ASR/Configuration.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Qwen3-ASR 与 Qwen3-ForcedAligner 的后端无关部分：`config.json` 的核对、分词器文件、提示词模板的 token、音频塔的结构
//! 与模型输出的语言前缀。MLX（`backend::mlx::qwen3`）与 candle（`backend::candle`）两个后端共用这一份；各自的文本解码器
//! 配置（量化参数的类型不同）留在后端里。

use std::path::Path;

use serde_json::Value;

use super::decoding::AsrModelSize;

// 提示词模板与生成用到的特殊 token。
pub(crate) const EOS_TOKEN: i32 = 151_645;
pub(crate) const IM_START: i32 = 151_644;
pub(crate) const AUDIO_START: i32 = 151_669;
pub(crate) const AUDIO_END: i32 = 151_670;
pub(crate) const AUDIO_PAD: i32 = 151_676;
pub(crate) const ASR_TEXT: i32 = 151_704;
pub(crate) const NEWLINE: i32 = 198;
pub(crate) const SYSTEM: i32 = 8_948;
pub(crate) const USER: i32 = 872;
pub(crate) const ASSISTANT: i32 = 77_091;

/// 音频塔的结构（Qwen3-ASR 两档与强制对齐器）。
#[derive(Debug, Clone, Copy)]
pub struct AudioEncoderConfig {
    pub d_model: usize,
    pub heads: usize,
    pub ffn_dim: usize,
    pub layers: usize,
    pub output_dim: usize,
    pub transpose_pytorch_conv: bool,
}

impl AudioEncoderConfig {
    pub const SMALL: Self = Self {
        d_model: 896,
        heads: 14,
        ffn_dim: 3584,
        layers: 18,
        output_dim: 1024,
        transpose_pytorch_conv: false,
    };

    pub const LARGE: Self = Self {
        d_model: 1024,
        heads: 16,
        ffn_dim: 4096,
        layers: 24,
        output_dim: 2048,
        transpose_pytorch_conv: false,
    };

    pub const FORCED_ALIGNER: Self = Self {
        d_model: 1024,
        heads: 16,
        ffn_dim: 4096,
        layers: 24,
        output_dim: 1024,
        transpose_pytorch_conv: true,
    };

    /// 尺寸档对应的音频塔。
    pub fn for_size(size: AsrModelSize) -> Self {
        match size {
            AsrModelSize::Small => Self::SMALL,
            AsrModelSize::Large => Self::LARGE,
        }
    }
}

/// 尺寸档的文本解码器隐层宽度（两个后端的 `TextDecoderConfig::small` / `large` 与此一致）。
pub fn text_hidden_size(size: AsrModelSize) -> usize {
    match size {
        AsrModelSize::Small => 1024,
        AsrModelSize::Large => 2048,
    }
}

/// 从 `config.json` 读出、加载前要核对的形状与量化参数。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Qwen3Config {
    pub size: AsrModelSize,
    pub bits: i32,
    pub group_size: i32,
}

impl Qwen3Config {
    /// 尺寸按音频塔 d_model 与文本隐层认：0.6B 是 896 / 1024，1.7B 是 1024 / 2048，别的组合拒绝。
    /// 量化位数取 `quantization.bits`，没有量化时按浮点权重。
    pub fn parse(config: &Value) -> Result<Self, String> {
        let thinker = config.get("thinker_config").ok_or("config.json has no thinker_config")?;
        let audio_width = thinker.pointer("/audio_config/d_model").and_then(Value::as_u64);
        let text_width = thinker.pointer("/text_config/hidden_size").and_then(Value::as_u64);
        let size = [AsrModelSize::Small, AsrModelSize::Large]
            .into_iter()
            .find(|size| {
                audio_width == Some(AudioEncoderConfig::for_size(*size).d_model as u64)
                    && text_width == Some(text_hidden_size(*size) as u64)
            })
            .ok_or_else(|| format!("unsupported Qwen3-ASR size (audio d_model {audio_width:?}, text hidden_size {text_width:?})"))?;
        let quantization = config.get("quantization");
        let bits = match quantization.and_then(|value| value.get("bits")).and_then(Value::as_i64) {
            None => 16,
            Some(bits @ (4 | 8)) => bits as i32,
            Some(other) => return Err(format!("unsupported quantization: {other} bits")),
        };
        let group_size = quantization
            .and_then(|value| value.get("group_size"))
            .and_then(Value::as_i64)
            .unwrap_or(64);
        if !matches!(group_size, 32 | 64 | 128) {
            return Err(format!("unsupported quantization group size {group_size}"));
        }
        Ok(Self {
            size,
            bits,
            group_size: group_size as i32,
        })
    }
}

/// tokenizer 的三个文件。
pub struct TokenizerFiles<'a> {
    pub vocabulary: &'a Path,
    pub merges: Option<&'a Path>,
    pub config: Option<&'a Path>,
}

/// 对齐器清单里没有 `quantize_config.json` 时的量化位数（v2 认不出仓库名里的位数时也按 4）。
pub const ALIGNER_DEFAULT_BITS: i32 = 4;

/// 对齐器 `quantize_config.json` 的 `quantization.bits`；没列出这个文件（`None`）时按 [`ALIGNER_DEFAULT_BITS`]。
/// v2 认的位数（4、5、8）之外的拒绝。
pub fn aligner_quantization_bits(quantize_config: Option<&Path>) -> anyhow::Result<i32> {
    use anyhow::Context;
    let Some(path) = quantize_config else {
        return Ok(ALIGNER_DEFAULT_BITS);
    };
    let config: Value = serde_json::from_slice(&std::fs::read(path).context("读取对齐器 quantize_config.json")?)
        .context("对齐器 quantize_config.json 不是 JSON")?;
    match config.pointer("/quantization/bits").and_then(Value::as_i64) {
        None => Ok(ALIGNER_DEFAULT_BITS),
        Some(bits @ (4 | 5 | 8)) => Ok(bits as i32),
        Some(other) => anyhow::bail!("对齐器的量化位数 {other} 不受支持"),
    }
}

/// `language English<asr_text>Hello.` → (`Hello.`, `English`)。没有 `<asr_text>` 时整段是文本。
pub fn split_language_prefix(raw: &str) -> (String, Option<String>) {
    match raw.split_once("<asr_text>") {
        Some((prefix, text)) => {
            let name = prefix
                .trim()
                .strip_prefix("language")
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_owned);
            (text.trim().to_owned(), name)
        }
        None => (raw.trim().to_owned(), None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn splits_the_language_prefix() {
        assert_eq!(
            split_language_prefix("language English<asr_text> Hello. "),
            ("Hello.".into(), Some("English".into()))
        );
        assert_eq!(
            split_language_prefix("language None<asr_text>"),
            (String::new(), Some("None".into()))
        );
        assert_eq!(split_language_prefix(" plain text "), ("plain text".into(), None));
    }

    #[test]
    fn parses_the_small_and_large_configs_only() {
        let config = |audio: u64, text: u64, quantization: Value| {
            json!({
                "quantization": quantization,
                "thinker_config": { "audio_config": { "d_model": audio }, "text_config": { "hidden_size": text } }
            })
        };
        assert_eq!(
            Qwen3Config::parse(&config(896, 1024, json!({ "bits": 4, "group_size": 64 }))),
            Ok(Qwen3Config {
                size: AsrModelSize::Small,
                bits: 4,
                group_size: 64
            })
        );
        assert_eq!(
            Qwen3Config::parse(&config(896, 1024, Value::Null)),
            Ok(Qwen3Config {
                size: AsrModelSize::Small,
                bits: 16,
                group_size: 64
            })
        );
        assert_eq!(
            Qwen3Config::parse(&config(1024, 2048, json!({ "bits": 8, "group_size": 64 }))),
            Ok(Qwen3Config {
                size: AsrModelSize::Large,
                bits: 8,
                group_size: 64
            })
        );
        // 两档的宽度不能交叉组合。
        assert!(Qwen3Config::parse(&config(896, 2048, json!({ "bits": 4 }))).is_err());
        assert!(Qwen3Config::parse(&config(1024, 1024, json!({ "bits": 4 }))).is_err());
        assert!(Qwen3Config::parse(&config(896, 1024, json!({ "bits": 3 }))).is_err());
        assert!(Qwen3Config::parse(&json!({})).is_err());
    }
}
