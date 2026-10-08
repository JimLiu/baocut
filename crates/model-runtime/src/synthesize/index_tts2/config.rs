//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/IndexTTS2TTS/IndexTTS2RuntimeConfig.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! IndexTTS2 运行时配置：对照 speech-swift `IndexTTS2RuntimeConfig.swift` 移植。
//!
//! `config.yaml` 只用一个极简的缩进扁平化解析器读取（不引入 YAML 依赖），
//! 缺失字段全部回退到 IndexTTS2 v2.0 官方默认值。

use anyhow::{Context, Result, bail};
use std::collections::BTreeMap;
use std::path::Path;

/// 扁平化后的 YAML：`a.b.c` → 原始值字符串。
#[derive(Debug, Default, Clone)]
pub struct FlatYaml {
    values: BTreeMap<String, String>,
}

impl FlatYaml {
    /// 按缩进层级把 YAML 拍平；只支持 `key: value`、嵌套映射与标量短横线列表
    /// （2.5 的 `emo_num:` 换行 `- 3`，拍平成 `[3, 17, …]`），遇到无冒号行报错。
    pub fn parse(text: &str) -> Result<Self> {
        let mut values = BTreeMap::new();
        let mut lists: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut stack: Vec<(usize, String)> = Vec::new();
        for (line_no, raw) in text.lines().enumerate() {
            let line = match raw.find('#') {
                Some(pos) => &raw[..pos],
                None => raw,
            };
            if line.trim().is_empty() {
                continue;
            }
            let indent = line.len() - line.trim_start_matches(' ').len();
            let content = line.trim();
            if content == "-" || content.starts_with("- ") {
                // 列表项可以与所属键同缩进，只弹出更深的层级。
                while stack.last().is_some_and(|(depth, _)| *depth > indent) {
                    stack.pop();
                }
                if stack.is_empty() {
                    bail!("config.yaml 第 {} 行的列表项没有所属的键：{raw}", line_no + 1);
                }
                let path = stack.iter().map(|(_, key)| key.as_str()).collect::<Vec<_>>().join(".");
                lists.entry(path).or_default().push(content[1..].trim().to_string());
                continue;
            }
            let Some(colon) = content.find(':') else {
                bail!("config.yaml 第 {} 行不是 key: value 形式：{raw}", line_no + 1);
            };
            while stack.last().is_some_and(|(depth, _)| *depth >= indent) {
                stack.pop();
            }
            let key = content[..colon].trim().to_string();
            let value = content[colon + 1..].trim();
            if value.is_empty() {
                stack.push((indent, key));
            } else {
                let mut path = stack.iter().map(|(_, key)| key.as_str()).collect::<Vec<_>>();
                path.push(key.as_str());
                values.insert(path.join("."), value.to_string());
            }
        }
        for (path, items) in lists {
            values.insert(path, format!("[{}]", items.join(", ")));
        }
        Ok(Self { values })
    }

    pub fn get(&self, path: &str) -> Option<&str> {
        self.values.get(path).map(String::as_str)
    }

    /// 去掉成对引号的字符串值。
    pub fn string(&self, path: &str) -> Option<String> {
        self.get(path).map(unquote)
    }

    pub fn int(&self, path: &str) -> Result<Option<i64>> {
        match self.get(path) {
            Some(raw) => Ok(Some(
                unquote(raw)
                    .parse::<i64>()
                    .with_context(|| format!("config.yaml `{path}` 不是整数：{raw}"))?,
            )),
            None => Ok(None),
        }
    }

    pub fn int_array(&self, path: &str) -> Result<Option<Vec<i64>>> {
        match self.get(path) {
            Some(raw) => {
                let inner = raw.trim().trim_start_matches('[').trim_end_matches(']');
                let mut out = Vec::new();
                for item in inner.split(',') {
                    let item = item.trim();
                    if item.is_empty() {
                        continue;
                    }
                    out.push(
                        item.parse::<i64>()
                            .with_context(|| format!("config.yaml `{path}` 含非整数：{raw}"))?,
                    );
                }
                Ok(Some(out))
            }
            None => Ok(None),
        }
    }
}

fn unquote(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"')) || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct GptConfig {
    pub model_dim: usize,
    pub max_mel_tokens: usize,
    pub max_text_tokens: usize,
    pub heads: usize,
    pub layers: usize,
    pub number_text_tokens: usize,
    pub number_mel_codes: usize,
    pub start_mel_token: usize,
    pub stop_mel_token: usize,
    pub start_text_token: usize,
    pub stop_text_token: usize,
    pub condition_type: String,
    pub condition_num_blocks: usize,
    pub emo_condition_num_blocks: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SemanticCodecConfig {
    pub codebook_size: usize,
    pub hidden_size: usize,
    pub codebook_dim: usize,
    pub vocos_dim: usize,
    pub vocos_num_layers: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct S2MelConfig {
    pub sample_rate: u32,
    pub n_fft: usize,
    pub win_length: usize,
    pub hop_length: usize,
    pub n_mels: usize,
    pub dit_hidden_dim: usize,
    pub dit_num_heads: usize,
    pub dit_depth: usize,
    pub dit_in_channels: usize,
    pub dit_content_dim: usize,
}

/// 与 speech-swift `IndexTTS2RuntimeConfig` 对应的运行时配置。
#[derive(Debug, Clone, PartialEq)]
pub struct RuntimeConfig {
    pub dataset_sample_rate: u32,
    pub bpe_model: String,
    pub gpt: GptConfig,
    pub semantic_codec: SemanticCodecConfig,
    pub s2mel: S2MelConfig,
    pub emo_num: Vec<usize>,
    pub qwen_emo_path: String,
    pub version: String,
    /// `dataset.tokenizer_type`：2.0 缺省为 SentencePiece，2.5 为 `tiktoken`。
    pub tokenizer_type: String,
}

impl RuntimeConfig {
    /// IndexTTS2 v2.0 官方默认值（config.yaml 缺项时的回退）。
    pub fn fallback() -> Self {
        Self {
            dataset_sample_rate: 24_000,
            bpe_model: "bpe.model".to_string(),
            gpt: GptConfig {
                model_dim: 1280,
                max_mel_tokens: 1815,
                max_text_tokens: 600,
                heads: 20,
                layers: 24,
                number_text_tokens: 12_000,
                number_mel_codes: 8194,
                start_mel_token: 8192,
                stop_mel_token: 8193,
                start_text_token: 0,
                stop_text_token: 1,
                condition_type: "conformer_perceiver".to_string(),
                condition_num_blocks: 6,
                emo_condition_num_blocks: 4,
            },
            semantic_codec: SemanticCodecConfig {
                codebook_size: 8192,
                hidden_size: 1024,
                codebook_dim: 8,
                vocos_dim: 384,
                vocos_num_layers: 12,
            },
            s2mel: S2MelConfig {
                sample_rate: 22_050,
                n_fft: 1024,
                win_length: 1024,
                hop_length: 256,
                n_mels: 80,
                dit_hidden_dim: 512,
                dit_num_heads: 8,
                dit_depth: 13,
                dit_in_channels: 80,
                dit_content_dim: 512,
            },
            emo_num: vec![3, 17, 2, 8, 4, 5, 10, 24],
            qwen_emo_path: "qwen0.6bemo4-merge/".to_string(),
            version: "2.0".to_string(),
            tokenizer_type: "sentencepiece".to_string(),
        }
    }

    /// IndexTTS 2.5 权重：tiktoken 多语言词表 + CAMPPlus 音色投影 + 语言嵌入。
    pub fn is_v25(&self) -> bool {
        self.version.trim().starts_with("2.5") || self.tokenizer_type == "tiktoken"
    }

    /// 从 config.yaml 文本解析；缺项回退默认值。
    pub fn parse(text: &str) -> Result<Self> {
        let yaml = FlatYaml::parse(text)?;
        let base = Self::fallback();
        let usize_or = |path: &str, fallback: usize| -> Result<usize> {
            Ok(match yaml.int(path)? {
                Some(value) if value >= 0 => value as usize,
                Some(value) => bail!("config.yaml `{path}` 不能为负数：{value}"),
                None => fallback,
            })
        };
        let string_or = |path: &str, fallback: &str| -> String { yaml.string(path).unwrap_or_else(|| fallback.to_string()) };
        let gpt = GptConfig {
            model_dim: usize_or("gpt.model_dim", base.gpt.model_dim)?,
            max_mel_tokens: usize_or("gpt.max_mel_tokens", base.gpt.max_mel_tokens)?,
            max_text_tokens: usize_or("gpt.max_text_tokens", base.gpt.max_text_tokens)?,
            heads: usize_or("gpt.heads", base.gpt.heads)?,
            layers: usize_or("gpt.layers", base.gpt.layers)?,
            number_text_tokens: usize_or("gpt.number_text_tokens", base.gpt.number_text_tokens)?,
            number_mel_codes: usize_or("gpt.number_mel_codes", base.gpt.number_mel_codes)?,
            start_mel_token: usize_or("gpt.start_mel_token", base.gpt.start_mel_token)?,
            stop_mel_token: usize_or("gpt.stop_mel_token", base.gpt.stop_mel_token)?,
            start_text_token: usize_or("gpt.start_text_token", base.gpt.start_text_token)?,
            stop_text_token: usize_or("gpt.stop_text_token", base.gpt.stop_text_token)?,
            condition_type: string_or("gpt.condition_type", &base.gpt.condition_type),
            condition_num_blocks: usize_or("gpt.condition_module.num_blocks", base.gpt.condition_num_blocks)?,
            emo_condition_num_blocks: usize_or("gpt.emo_condition_module.num_blocks", base.gpt.emo_condition_num_blocks)?,
        };
        let codec = SemanticCodecConfig {
            codebook_size: usize_or("semantic_codec.codebook_size", base.semantic_codec.codebook_size)?,
            hidden_size: usize_or("semantic_codec.hidden_size", base.semantic_codec.hidden_size)?,
            codebook_dim: usize_or("semantic_codec.codebook_dim", base.semantic_codec.codebook_dim)?,
            vocos_dim: usize_or("semantic_codec.vocos_dim", base.semantic_codec.vocos_dim)?,
            vocos_num_layers: usize_or("semantic_codec.vocos_num_layers", base.semantic_codec.vocos_num_layers)?,
        };
        let s2mel = S2MelConfig {
            sample_rate: usize_or("s2mel.preprocess_params.sr", base.s2mel.sample_rate as usize)? as u32,
            n_fft: usize_or("s2mel.preprocess_params.spect_params.n_fft", base.s2mel.n_fft)?,
            win_length: usize_or("s2mel.preprocess_params.spect_params.win_length", base.s2mel.win_length)?,
            hop_length: usize_or("s2mel.preprocess_params.spect_params.hop_length", base.s2mel.hop_length)?,
            n_mels: usize_or("s2mel.preprocess_params.spect_params.n_mels", base.s2mel.n_mels)?,
            dit_hidden_dim: usize_or("s2mel.DiT.hidden_dim", base.s2mel.dit_hidden_dim)?,
            dit_num_heads: usize_or("s2mel.DiT.num_heads", base.s2mel.dit_num_heads)?,
            dit_depth: usize_or("s2mel.DiT.depth", base.s2mel.dit_depth)?,
            dit_in_channels: usize_or("s2mel.DiT.in_channels", base.s2mel.dit_in_channels)?,
            dit_content_dim: usize_or("s2mel.DiT.content_dim", base.s2mel.dit_content_dim)?,
        };
        let emo_num = match yaml.int_array("emo_num")? {
            Some(values) => values
                .into_iter()
                .map(|value| usize::try_from(value).map_err(|_| anyhow::anyhow!("emo_num 含负数：{value}")))
                .collect::<Result<Vec<_>>>()?,
            None => base.emo_num.clone(),
        };
        Ok(Self {
            dataset_sample_rate: usize_or("dataset.sample_rate", base.dataset_sample_rate as usize)? as u32,
            bpe_model: string_or("dataset.bpe_model", &base.bpe_model),
            gpt,
            semantic_codec: codec,
            s2mel,
            emo_num,
            qwen_emo_path: string_or("qwen_emo_path", &base.qwen_emo_path),
            version: string_or("version", &base.version),
            tokenizer_type: string_or("dataset.tokenizer_type", &base.tokenizer_type),
        })
    }

    /// 读取模型包里的 `config.yaml`；清单没列出它（`None`）时使用默认值。
    pub fn load(path: Option<&Path>) -> Result<Self> {
        let Some(path) = path else {
            return Ok(Self::fallback());
        };
        let text = std::fs::read_to_string(path).with_context(|| format!("无法读取 {}", path.display()))?;
        Self::parse(&text).with_context(|| format!("解析 {} 失败", path.display()))
    }

    /// 输出采样率 = S2Mel / BigVGAN 采样率。
    pub fn output_sample_rate(&self) -> u32 {
        self.s2mel.sample_rate
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
dataset:
    bpe_model: bpe.model
    sample_rate: 24000
    mel:
        n_mels: 100   # 注释
gpt:
    model_dim: 1280
    heads: 20
    condition_type: "conformer_perceiver"
    condition_module:
        num_blocks: 6
    emo_condition_module:
        num_blocks: 4
s2mel:
    preprocess_params:
        sr: 22050
        spect_params:
            n_fft: 1024
            fmax: "None"

    DiT:
        depth: 13
emo_matrix: feat2.pt
emo_num: [3, 17, 2, 8, 4, 5, 10, 24]
qwen_emo_path: qwen0.6bemo4-merge/
version: 2.0
"#;

    #[test]
    fn flattens_nested_yaml() {
        let yaml = FlatYaml::parse(SAMPLE).unwrap();
        assert_eq!(yaml.get("dataset.mel.n_mels"), Some("100"));
        assert_eq!(yaml.get("gpt.condition_module.num_blocks"), Some("6"));
        assert_eq!(yaml.get("s2mel.preprocess_params.spect_params.fmax"), Some("\"None\""));
        assert_eq!(yaml.string("qwen_emo_path").as_deref(), Some("qwen0.6bemo4-merge/"));
        assert_eq!(yaml.get("s2mel.DiT.depth"), Some("13"));
        assert_eq!(yaml.int_array("emo_num").unwrap(), Some(vec![3, 17, 2, 8, 4, 5, 10, 24]));
    }

    #[test]
    fn parses_runtime_config_with_fallbacks() {
        let config = RuntimeConfig::parse(SAMPLE).unwrap();
        let fallback = RuntimeConfig::fallback();
        assert_eq!(config, fallback);
        assert_eq!(config.output_sample_rate(), 22_050);
        assert_eq!(config.gpt.condition_type, "conformer_perceiver");
    }

    #[test]
    fn rejects_malformed_line() {
        assert!(FlatYaml::parse("gpt:\n    nonsense line\n").is_err());
        assert!(FlatYaml::parse("- orphan\n").is_err());
    }

    const V25_SAMPLE: &str = r#"
dataset:
  bpe_model: multilingual_zh_ja_yue_char_del.tiktoken
  tokenizer_type: tiktoken
gpt:
  number_text_tokens: 60509
s2mel:
  length_regulator:
    sampling_ratios:
    - 1
    - 1
    vector_quantize: false
emo_num:
- 3
- 17
- 2
- 8
- 4
- 5
- 10
- 24
qwen_emo_path: qwen0.6bemo4-merge/
version: 2.5
supported_languages:
- zh
- en
"#;

    #[test]
    fn parses_dash_lists_and_v25_fields() {
        let yaml = FlatYaml::parse(V25_SAMPLE).unwrap();
        assert_eq!(yaml.get("s2mel.length_regulator.sampling_ratios"), Some("[1, 1]"));
        assert_eq!(yaml.get("s2mel.length_regulator.vector_quantize"), Some("false"));
        assert_eq!(yaml.get("supported_languages"), Some("[zh, en]"));
        let config = RuntimeConfig::parse(V25_SAMPLE).unwrap();
        assert_eq!(config.emo_num, vec![3, 17, 2, 8, 4, 5, 10, 24]);
        assert_eq!(config.gpt.number_text_tokens, 60_509);
        assert_eq!(config.bpe_model, "multilingual_zh_ja_yue_char_del.tiktoken");
        assert_eq!(config.tokenizer_type, "tiktoken");
        assert_eq!(config.qwen_emo_path, "qwen0.6bemo4-merge/");
        assert!(config.is_v25());
        assert!(!RuntimeConfig::fallback().is_v25());
    }

    #[test]
    fn overrides_are_applied() {
        let config = RuntimeConfig::parse("gpt:\n    layers: 12\nversion: '3.0'\n").unwrap();
        assert_eq!(config.gpt.layers, 12);
        assert_eq!(config.version, "3.0");
        assert_eq!(config.gpt.model_dim, 1280);
    }
}
