//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/Qwen3TTS/Qwen3TTS.swift / Sources/Qwen3TTS/Qwen3TTS+ICL.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 提示构造的纯逻辑部分：聊天模板 token 序列、codec 前缀、说话人解析与
//! 最大 token 上限（普通与 ICL 两条路径）。
//!
//! 嵌入拼接（需要 MLX 数组）在 `talker.rs` 里做，这里只产出 token 序列与
//! 长度信息，方便无权重单测。

use super::config::SpeakerConfig;
use super::tokens::*;

/// CustomVoice 无显式 instruct 时自动补的默认指令（防止短句啰嗦）。
pub const DEFAULT_INSTRUCT: &str = "Speak naturally.";

/// `<|im_start|>assistant\n{text}<|im_end|>\n<|im_start|>assistant\n`。
pub fn text_tokens(text_ids: &[i32]) -> Vec<i32> {
    let mut tokens = Vec::with_capacity(text_ids.len() + 8);
    tokens.extend_from_slice(&[IM_START, ASSISTANT, NEWLINE]);
    tokens.extend_from_slice(text_ids);
    tokens.extend_from_slice(&[IM_END, NEWLINE, IM_START, ASSISTANT, NEWLINE]);
    tokens
}

/// `<|im_start|>user\n{instruct}<|im_end|>\n`。
pub fn instruct_tokens(instruct_ids: &[i32]) -> Vec<i32> {
    let mut tokens = Vec::with_capacity(instruct_ids.len() + 5);
    tokens.extend_from_slice(&[IM_START, USER, NEWLINE]);
    tokens.extend_from_slice(instruct_ids);
    tokens.extend_from_slice(&[IM_END, NEWLINE]);
    tokens
}

/// 角色前缀 `<|im_start|>assistant\n`（ICL 路径单独使用）。
pub fn role_tokens() -> [i32; 3] {
    [IM_START, ASSISTANT, NEWLINE]
}

/// codec 前缀：`[think, think_bos, lang, think_eos, (spk)?, pad, bos]`。
pub fn codec_prefix(language_id: i32, speaker_token: Option<i32>) -> Vec<i32> {
    let mut prefix = vec![CODEC_THINK, CODEC_THINK_BOS, language_id, CODEC_THINK_EOS];
    if let Some(spk) = speaker_token {
        prefix.push(spk);
    }
    prefix.push(CODEC_PAD);
    prefix.push(CODEC_BOS);
    prefix
}

/// ICL 路径的 codec 前缀（不含说话人 token，说话人嵌入在向量层插入）：
/// 有语言时 `[think, think_bos, lang, think_eos, pad, bos]`，说话人插在下标 4；
/// 无语言（auto）时 `[nothink, think_bos, think_eos, pad, bos]`，插在下标 3。
/// 返回 `(tokens, speaker_insert_index)`。
pub fn icl_codec_prefix(language_id: Option<i32>) -> (Vec<i32>, usize) {
    match language_id {
        Some(lang) => (vec![CODEC_THINK, CODEC_THINK_BOS, lang, CODEC_THINK_EOS, CODEC_PAD, CODEC_BOS], 4),
        None => (vec![CODEC_NOTHINK, CODEC_THINK_BOS, CODEC_THINK_EOS, CODEC_PAD, CODEC_BOS], 3),
    }
}

/// 说话人解析结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedSpeaker {
    /// 说话人 codec token；模型无说话人表或名字未知时为 `None`。
    pub token: Option<i32>,
    /// 生效语言名（方言说话人且调用方未显式指定语言时被方言覆盖）。
    pub language: String,
    /// 未找到说话人时的提示（可用于告警或报错）。
    pub warning: Option<String>,
}

/// CustomVoice 的 9 只说话人：名单是纯数据，住在 `synthesize::voices`（不加载引擎也要能列）。
pub use crate::synthesize::voices::CUSTOM_VOICE_SPEAKERS;

/// CustomVoice 的 9 只说话人里，各语言的默认那只（小写名，对照 `speaker_ids` 的键）。
/// 日语、韩语各有本语的女声，中文用 Vivian，其余拉丁语系用 Serena——与内置音色
/// 「女声优先」是同一条规矩（`crate::synthesize::voices::default_for`）。
const DEFAULT_SPEAKERS: &[(&str, &str)] = &[
    ("chinese", "vivian"),
    ("beijing_dialect", "vivian"),
    ("sichuan_dialect", "vivian"),
    ("japanese", "ono_anna"),
    ("korean", "sohee"),
    ("english", "serena"),
];

/// 内置音色 id → CustomVoice 里**就近**的那只说话人。CustomVoice 不能克隆，
/// 随包录音在它身上用不上；名字一路带过来时不报错，挑个同语言同性别的顶上。
/// 日语男声与西语两只模型里没有，只能拿英语的顶——日志里会说。
const BUILTIN_NEAR: &[(&str, &str)] = &[
    ("zh-female", "vivian"),
    ("zh-male", "uncle_fu"),
    ("en-female", "serena"),
    ("en-male", "eric"),
    ("ja-female", "ono_anna"),
    ("ja-male", "dylan"),
    ("es-female", "serena"),
    ("es-male", "ryan"),
];

/// 没指定说话人时 CustomVoice 用哪只：先按语言查表，表里没有（或模型没装这只）
/// 就落到说话人表的第一只。模型没有说话人表时给 `None`（Base 走克隆那条路）。
pub fn default_speaker(language: &str, config: Option<&SpeakerConfig>) -> Option<String> {
    let config = config?;
    let wanted = DEFAULT_SPEAKERS
        .iter()
        .find(|(lang, _)| *lang == language)
        .map(|(_, speaker)| *speaker);
    if let Some(wanted) = wanted
        && config.speaker_ids.contains_key(wanted)
    {
        return Some(wanted.to_owned());
    }
    config.available_speakers().into_iter().next()
}

/// 内置音色 id → 这只模型里就近的说话人；不是内置音色、或模型没装那只，给 `None`。
pub fn nearest_speaker(id: &str, config: &SpeakerConfig) -> Option<&'static str> {
    let id = crate::synthesize::voices::find(id)?.id;
    BUILTIN_NEAR
        .iter()
        .find(|(builtin, _)| *builtin == id)
        .map(|(_, speaker)| *speaker)
        .filter(|speaker| config.speaker_ids.contains_key(*speaker))
}

/// 小写查表；方言说话人在 `language_explicit == false`
/// 时把语言改为方言。
pub fn resolve_speaker(speaker: Option<&str>, config: Option<&SpeakerConfig>, language: &str, language_explicit: bool) -> ResolvedSpeaker {
    let Some(name) = speaker else {
        return ResolvedSpeaker {
            token: None,
            language: language.to_string(),
            warning: None,
        };
    };
    let Some(config) = config else {
        return ResolvedSpeaker {
            token: None,
            language: language.to_string(),
            warning: Some(format!("模型没有说话人表，忽略说话人 {name:?}（需要 CustomVoice 变体）")),
        };
    };
    let mut key = name.to_lowercase();
    if !config.speaker_ids.contains_key(&key)
        && let Some(near) = nearest_speaker(name, config)
    {
        eprintln!("[qwen3-tts] CustomVoice 没有内置音色 {name:?}，就近用 {near}");
        key = near.to_owned();
    }
    let Some(&token) = config.speaker_ids.get(&key) else {
        return ResolvedSpeaker {
            token: None,
            language: language.to_string(),
            warning: Some(format!("未知说话人 {name:?}，可用：{}", config.available_speakers().join(", "))),
        };
    };
    let mut effective = language.to_string();
    if !language_explicit && let Some(dialect) = config.speaker_dialects.get(&key) {
        effective = dialect.clone();
    }
    ResolvedSpeaker {
        token: Some(token),
        language: effective,
        warning: None,
    }
}

/// 上限的下限：125 帧 = 10 s。
///
/// 上限只该拦住不收尾的失控生成，不该截断念得慢的正常句子。原先的
/// 75 帧（6 s）在短句上就是实际上限：18 个字、带三处顿号的一句念慢一点就要 6 s
/// 以上，被从中间切断、只在 stderr 留一行警告（2026-09-23 语速排查实测）。
pub const MIN_TOKEN_CAP: usize = 125;

/// 普通合成的 token 上限：`min(max_tokens, max(125, 文本 token 数 × 8))`，
/// 再被生成循环的安全上限 2048 截断。每 token 8 帧（0.64 s）是正常语速的两倍多。
pub fn max_token_cap(text_token_count: usize, max_tokens: usize) -> usize {
    max_tokens.min((text_token_count * 8).max(MIN_TOKEN_CAP))
}

/// ICL 合成的 token 上限：`min(max_tokens, max(125, 目标文本 token 数 × 8))`。
pub fn icl_max_token_cap(target_token_count: usize, max_tokens: usize) -> usize {
    max_tokens.min((target_token_count * 8).max(MIN_TOKEN_CAP))
}

/// 生成循环的硬上限（对照参考实现的 2048）。
pub const SAFE_MAX_TOKENS: usize = 2048;

/// 普通路径拖尾文本的 token 下标区间 `[4, len-5)`；
/// 区间为空时只剩 `tts_eos`。
pub fn trailing_text_range(text_token_len: usize) -> Option<std::ops::Range<usize>> {
    let start = 4usize;
    let end = text_token_len.saturating_sub(5);
    (end > start).then_some(start..end)
}

/// ICL 路径的文本 / codec 对齐：返回 `(overlay_len, trailing_kind)`。
/// 文本比 codec 长：前 `codec_len` 个文本嵌入与 codec 叠加，其余作拖尾；
/// 否则文本右侧补 `tts_pad` 到 `codec_len`，拖尾只有一个 `tts_pad`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IclTrailing {
    /// 拖尾为文本嵌入 `[codec_len, text_len)`。
    TextFrom(usize),
    /// 文本不够长：补 `pad_count` 个 `tts_pad`，拖尾为单个 `tts_pad`。
    Padded { pad_count: usize },
}

pub fn icl_alignment(text_len_with_eos: usize, codec_len: usize) -> IclTrailing {
    if text_len_with_eos > codec_len {
        IclTrailing::TextFrom(codec_len)
    } else {
        IclTrailing::Padded {
            pad_count: codec_len - text_len_with_eos,
        }
    }
}

/// ICL 解码后从波形前部裁掉参考部分的采样数：
/// `cut = ref_frames * total_samples / total_frames`，仅当 `0 < cut < total_samples`。
pub fn icl_reference_cut(ref_frames: usize, total_frames: usize, total_samples: usize) -> usize {
    if total_frames == 0 {
        return 0;
    }
    let cut = ref_frames * total_samples / total_frames;
    if cut > 0 && cut < total_samples { cut } else { 0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn speaker_config() -> SpeakerConfig {
        let mut speaker_ids = BTreeMap::new();
        speaker_ids.insert("vivian".to_string(), 3065);
        speaker_ids.insert("eric".to_string(), 2875);
        speaker_ids.insert("ono_anna".to_string(), 2901);
        speaker_ids.insert("sohee".to_string(), 2902);
        let mut speaker_dialects = BTreeMap::new();
        speaker_dialects.insert("eric".to_string(), "sichuan_dialect".to_string());
        SpeakerConfig {
            speaker_ids,
            speaker_dialects,
            codec_language_ids: BTreeMap::new(),
        }
    }

    #[test]
    fn customvoice_default_speaker_follows_the_language() {
        let config = speaker_config();
        assert_eq!(default_speaker("japanese", Some(&config)).as_deref(), Some("ono_anna"));
        assert_eq!(default_speaker("korean", Some(&config)).as_deref(), Some("sohee"));
        assert_eq!(default_speaker("chinese", Some(&config)).as_deref(), Some("vivian"));
        // 表里没有 serena：落到说话人表的第一只（BTreeMap 字典序）
        assert_eq!(default_speaker("english", Some(&config)).as_deref(), Some("eric"));
        // 没有说话人表就是 Base，走克隆那条路
        assert_eq!(default_speaker("chinese", None), None);
    }

    #[test]
    fn builtin_ids_land_on_the_nearest_customvoice_speaker() {
        let config = speaker_config();
        assert_eq!(nearest_speaker("zh-female", &config), Some("vivian"));
        assert_eq!(nearest_speaker("ja-female", &config), Some("ono_anna"));
        // 就近那只这个模型里没装（uncle_fu）：不硬塞
        assert_eq!(nearest_speaker("zh-male", &config), None);
        assert_eq!(nearest_speaker("Vivian", &config), None);
        // 未知说话人若是内置音色 id，解析时就近顶上、不报错
        let resolved = resolve_speaker(Some("zh-female"), Some(&config), "chinese", true);
        assert_eq!(resolved.token, Some(3065));
        assert!(resolved.warning.is_none());
        // 既不是说话人也不是内置音色：照旧给告警
        assert!(resolve_speaker(Some("女性-温柔"), Some(&config), "chinese", true).warning.is_some());
    }

    #[test]
    fn chat_template_layout() {
        let tokens = text_tokens(&[10, 11, 12]);
        assert_eq!(
            tokens,
            vec![
                IM_START, ASSISTANT, NEWLINE, 10, 11, 12, IM_END, NEWLINE, IM_START, ASSISTANT, NEWLINE
            ]
        );
        assert_eq!(trailing_text_range(tokens.len()), Some(4..6));
        // 单 token 文本：[4, 4) 为空，只剩 tts_eos。
        assert_eq!(trailing_text_range(text_tokens(&[10]).len()), None);
        assert_eq!(instruct_tokens(&[7]), vec![IM_START, USER, NEWLINE, 7, IM_END, NEWLINE]);
    }

    #[test]
    fn codec_prefix_layout() {
        assert_eq!(
            codec_prefix(LANGUAGE_CHINESE, None),
            vec![CODEC_THINK, CODEC_THINK_BOS, 2055, CODEC_THINK_EOS, CODEC_PAD, CODEC_BOS]
        );
        assert_eq!(codec_prefix(LANGUAGE_CHINESE, Some(3065)).len(), 7);
        assert_eq!(codec_prefix(LANGUAGE_CHINESE, Some(3065))[4], 3065);
        assert_eq!(icl_codec_prefix(Some(2050)).1, 4);
        let (no_lang, at) = icl_codec_prefix(None);
        assert_eq!(no_lang[0], CODEC_NOTHINK);
        assert_eq!(no_lang.len(), 5);
        assert_eq!(at, 3);
    }

    #[test]
    fn speaker_resolution_and_dialect_override() {
        let config = speaker_config();
        let r = resolve_speaker(Some("Vivian"), Some(&config), "chinese", false);
        assert_eq!(r.token, Some(3065));
        assert_eq!(r.language, "chinese");
        let r = resolve_speaker(Some("eric"), Some(&config), "chinese", false);
        assert_eq!(r.language, "sichuan_dialect");
        let r = resolve_speaker(Some("eric"), Some(&config), "chinese", true);
        assert_eq!(r.language, "chinese");
        let r = resolve_speaker(Some("nobody"), Some(&config), "english", false);
        assert_eq!(r.token, None);
        assert!(r.warning.unwrap().contains("vivian"));
        let r = resolve_speaker(Some("vivian"), None, "english", false);
        assert_eq!(r.token, None);
        assert!(r.warning.is_some());
    }

    #[test]
    fn token_caps() {
        assert_eq!(max_token_cap(5, 4096), 125);
        // 「工具是它的双手，能搜索、点击、下单；」约 12 个 token：旧上限 75 帧把它截在 6 s。
        assert_eq!(max_token_cap(12, 4096), 125);
        assert_eq!(max_token_cap(100, 4096), 800);
        assert_eq!(max_token_cap(1000, 500), 500);
        assert_eq!(icl_max_token_cap(5, 4096), 125);
        assert_eq!(icl_max_token_cap(20, 4096), 160);
    }

    #[test]
    fn icl_alignment_and_cut() {
        assert_eq!(icl_alignment(10, 6), IclTrailing::TextFrom(6));
        assert_eq!(icl_alignment(4, 6), IclTrailing::Padded { pad_count: 2 });
        assert_eq!(icl_alignment(6, 6), IclTrailing::Padded { pad_count: 0 });
        assert_eq!(icl_reference_cut(10, 40, 40 * 1920), 10 * 1920);
        assert_eq!(icl_reference_cut(0, 40, 100), 0);
        assert_eq!(icl_reference_cut(40, 40, 100), 0);
    }

    /// 默认说话人与就近表里的名字都在对外公布的名单里（名单是小写查表的另一种写法）。
    #[test]
    fn speaker_tables_point_into_the_published_list() {
        let published: Vec<String> = CUSTOM_VOICE_SPEAKERS.iter().map(|name| name.to_lowercase()).collect();
        for (_, speaker) in DEFAULT_SPEAKERS.iter().chain(BUILTIN_NEAR) {
            assert!(published.iter().any(|name| name == speaker), "{speaker}");
        }
    }
}
