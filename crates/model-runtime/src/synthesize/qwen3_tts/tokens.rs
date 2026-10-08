//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/Qwen3TTS/Configuration.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Qwen3-TTS 的固定 token id 与语言映射。纯常量，全平台编译。

/// codec 侧特殊 token。
pub const CODEC_PAD: i32 = 2148;
pub const CODEC_BOS: i32 = 2149;
pub const CODEC_EOS: i32 = 2150;
pub const CODEC_THINK: i32 = 2154;
pub const CODEC_NOTHINK: i32 = 2155;
pub const CODEC_THINK_BOS: i32 = 2156;
pub const CODEC_THINK_EOS: i32 = 2157;

/// 文本侧 TTS 特殊 token。
pub const TTS_PAD: i32 = 151_671;
pub const TTS_BOS: i32 = 151_672;
pub const TTS_EOS: i32 = 151_673;

/// 聊天模板 token。
pub const IM_START: i32 = 151_644;
pub const IM_END: i32 = 151_645;
pub const NEWLINE: i32 = 198;
pub const ASSISTANT: i32 = 77_091;
pub const USER: i32 = 872;

/// Talker 采样时压制的 codec 词表区间 `[2048, 3072)`（EOS 除外）。
pub const SUPPRESS_START: i32 = 2048;
pub const SUPPRESS_END: i32 = 3072;

/// 语言 id。
pub const LANGUAGE_ENGLISH: i32 = 2050;
pub const LANGUAGE_GERMAN: i32 = 2053;
pub const LANGUAGE_SPANISH: i32 = 2054;
pub const LANGUAGE_CHINESE: i32 = 2055;
pub const LANGUAGE_JAPANESE: i32 = 2058;
pub const LANGUAGE_FRENCH: i32 = 2061;
pub const LANGUAGE_SICHUAN_DIALECT: i32 = 2062;
pub const LANGUAGE_KOREAN: i32 = 2064;
pub const LANGUAGE_RUSSIAN: i32 = 2069;
pub const LANGUAGE_ITALIAN: i32 = 2070;
pub const LANGUAGE_PORTUGUESE: i32 = 2071;
pub const LANGUAGE_BEIJING_DIALECT: i32 = 2074;

/// 每帧 codec 对应的 24 kHz 采样数（12.5 Hz）。
pub const SAMPLES_PER_FRAME: usize = 1920;
/// 输出采样率。
pub const SAMPLE_RATE: u32 = 24_000;
/// 每帧 codebook 数（1 个 Talker + 15 个 Code Predictor）。
pub const NUM_CODEBOOKS: usize = 16;

/// 语言名（全名或 ISO 简写，大小写不敏感）→ codec 语言 id；未知返回 `None`。
pub fn language_id(language: &str) -> Option<i32> {
    match language.trim().to_ascii_lowercase().as_str() {
        "english" | "en" => Some(LANGUAGE_ENGLISH),
        "german" | "de" => Some(LANGUAGE_GERMAN),
        "chinese" | "zh" => Some(LANGUAGE_CHINESE),
        "japanese" | "ja" => Some(LANGUAGE_JAPANESE),
        "spanish" | "es" => Some(LANGUAGE_SPANISH),
        "french" | "fr" => Some(LANGUAGE_FRENCH),
        "korean" | "ko" => Some(LANGUAGE_KOREAN),
        "russian" | "ru" => Some(LANGUAGE_RUSSIAN),
        "italian" | "it" => Some(LANGUAGE_ITALIAN),
        "portuguese" | "pt" => Some(LANGUAGE_PORTUGUESE),
        "beijing_dialect" => Some(LANGUAGE_BEIJING_DIALECT),
        "sichuan_dialect" => Some(LANGUAGE_SICHUAN_DIALECT),
        _ => None,
    }
}

/// 把 `crate::synthesize::text::guess_language` / 用户输入的语言标签规范成语言表
/// 用的全名；未知标签原样返回（后续 `language_id` 会判为未知）。
pub fn normalize_language(tag: &str) -> String {
    let lower = tag.trim().to_ascii_lowercase();
    let base = lower.split(['-', '_']).next().unwrap_or("");
    let base = if lower == "beijing_dialect" || lower == "sichuan_dialect" {
        lower.as_str()
    } else {
        base
    };
    match base {
        "en" => "english",
        "de" => "german",
        "zh" | "cmn" => "chinese",
        "ja" => "japanese",
        "es" => "spanish",
        "fr" => "french",
        "ko" => "korean",
        "ru" => "russian",
        "it" => "italian",
        "pt" => "portuguese",
        _ => return lower,
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_language_names_and_codes() {
        assert_eq!(language_id("Chinese"), Some(LANGUAGE_CHINESE));
        assert_eq!(language_id("zh"), Some(LANGUAGE_CHINESE));
        assert_eq!(language_id("EN"), Some(LANGUAGE_ENGLISH));
        assert_eq!(language_id("sichuan_dialect"), Some(LANGUAGE_SICHUAN_DIALECT));
        assert_eq!(language_id("klingon"), None);
        assert_eq!(language_id("auto"), None);
    }

    #[test]
    fn normalizes_bcp47_tags() {
        assert_eq!(normalize_language("zh-CN"), "chinese");
        assert_eq!(normalize_language("en_US"), "english");
        assert_eq!(normalize_language("ja"), "japanese");
        assert_eq!(normalize_language("beijing_dialect"), "beijing_dialect");
        assert_eq!(normalize_language("Chinese"), "chinese");
        assert_eq!(normalize_language("xx"), "xx");
    }
}
