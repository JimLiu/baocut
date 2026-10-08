//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/Qwen3ASR/TextPreprocessing.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 识别文本 → 词。空格分词的语言按空白切，中间的汉字逐字成词；日、韩、泰等无空格语言走 ICU 分词。
//! 每个词保留原样的 `surface`（含贴在后面的标点）和只留字母数字的 `cleaned`。
//!
//! 强制对齐的输入布局（[`prepare_for_alignment`]、[`alignment_input`]）移植自 v2 `bcut-speech-core`，供对齐批次接入。

use icu_segmenter::WordSegmenter;
use icu_segmenter::options::WordBreakInvariantOptions;
use unicode_general_category::{GeneralCategory, get_general_category};

use super::tokenizer::Qwen3Tokenizer;

pub const TIMESTAMP_TOKEN_ID: i32 = 151_705;

#[derive(Debug, Clone, PartialEq)]
pub struct WordPair {
    pub surface: String,
    pub cleaned: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SlottedText {
    pub token_ids: Vec<i32>,
    pub timestamp_positions: Vec<usize>,
    pub words: Vec<String>,
}

pub fn prepare_for_alignment(text: &str, tokenizer: &Qwen3Tokenizer, language: &str) -> SlottedText {
    let mut token_ids = Vec::new();
    let mut timestamp_positions = Vec::new();
    let mut words: Vec<String> = Vec::new();
    for pair in split_into_word_pairs(text, Some(language)) {
        let encoded = tokenizer.encode(&pair.cleaned);
        if encoded.is_empty() {
            if let Some(previous) = words.last_mut() {
                previous.push_str(&pair.surface);
            }
            continue;
        }
        token_ids.extend(encoded);
        // Qwen's forced-aligner processor places both slots after the word:
        // word<timestamp><timestamp>. It is not an ASR chat conversation.
        timestamp_positions.push(token_ids.len());
        token_ids.push(TIMESTAMP_TOKEN_ID);
        timestamp_positions.push(token_ids.len());
        token_ids.push(TIMESTAMP_TOKEN_ID);
        words.push(pair.surface);
    }
    SlottedText {
        token_ids,
        timestamp_positions,
        words,
    }
}

/// Exact shared input layout for the MLX and Candle forced aligners. The
/// official processor sends this directly to the model, without a chat template.
pub struct AlignmentInput {
    pub token_ids: Vec<i32>,
    pub audio_range: std::ops::Range<usize>,
    pub timestamp_positions: Vec<usize>,
}

pub fn alignment_input(slotted: &SlottedText, audio_tokens: usize) -> AlignmentInput {
    let mut token_ids = vec![151_669]; // <|audio_start|>
    let audio_start = token_ids.len();
    token_ids.extend(std::iter::repeat_n(151_676, audio_tokens)); // <|audio_pad|>
    let audio_end = token_ids.len();
    token_ids.push(151_670); // <|audio_end|>
    let offset = token_ids.len();
    token_ids.extend(&slotted.token_ids);
    AlignmentInput {
        token_ids,
        audio_range: audio_start..audio_end,
        timestamp_positions: slotted.timestamp_positions.iter().map(|p| offset + p).collect(),
    }
}

/// `language` 是规范语言码或语言名；`None` 时按字符本身判断要不要走 ICU 分词。
pub fn split_into_word_pairs(text: &str, language: Option<&str>) -> Vec<WordPair> {
    let native = match language {
        Some(language) => {
            let language = language.to_lowercase();
            [
                "ja", "ko", "th", "lo", "km", "my", "bo", "japanese", "korean", "thai", "lao", "khmer", "burmese", "myanmar", "tibetan",
            ]
            .iter()
            .any(|candidate| language == *candidate || language.contains(candidate))
        }
        None => text.chars().any(needs_dictionary_segmentation),
    };
    if native {
        native_tokenize_pairs(text)
    } else {
        tokenize_space_language_pairs(text)
    }
}

/// 假名、谚文、泰文、老挝文、高棉文、缅文、藏文。
fn needs_dictionary_segmentation(character: char) -> bool {
    matches!(
        character as u32,
        0x3040..=0x30FF | 0xAC00..=0xD7A3 | 0x1100..=0x11FF | 0x0E00..=0x0EFF | 0x1780..=0x17FF | 0x1000..=0x109F | 0x0F00..=0x0FFF
    )
}

fn native_tokenize_pairs(text: &str) -> Vec<WordPair> {
    let segmenter = WordSegmenter::new_auto(WordBreakInvariantOptions::default());
    let mut iterator = segmenter.segment_str(text);
    let mut previous_boundary = iterator.next().unwrap_or(0);
    let mut ranges = Vec::new();
    for boundary in iterator {
        // ICU4X 对日中词典分段会把规则状态标成 None；是否为词以 clean_token 判定，避免丢掉有效范围。
        if !clean_token(&text[previous_boundary..boundary]).is_empty() {
            ranges.push(previous_boundary..boundary);
        }
        previous_boundary = boundary;
    }

    let mut pairs = Vec::with_capacity(ranges.len());
    for (index, range) in ranges.iter().enumerate() {
        let cleaned = clean_token(&text[range.clone()]);
        if cleaned.is_empty() {
            continue;
        }
        let mut surface = text[range.clone()].to_string();
        let next_start = ranges.get(index + 1).map_or(text.len(), |next| next.start);
        for character in text[range.end..next_start].chars() {
            if character.is_whitespace() || is_kept_scalar(character) {
                break;
            }
            surface.push(character);
        }
        pairs.push(WordPair { surface, cleaned });
    }
    pairs
}

pub fn tokenize_space_language_pairs(text: &str) -> Vec<WordPair> {
    let mut pairs: Vec<WordPair> = Vec::new();
    for segment in text.split_whitespace() {
        let previous_count = pairs.len();
        append_space_segment(segment, &mut pairs);
        if pairs.len() == previous_count
            && let Some(previous) = pairs.last_mut()
        {
            previous.surface.push_str(segment);
        }
    }
    pairs
}

fn append_space_segment(segment: &str, pairs: &mut Vec<WordPair>) {
    if !segment.chars().any(is_han_ideograph) {
        let cleaned = clean_token(segment);
        if !cleaned.is_empty() {
            pairs.push(WordPair {
                surface: segment.to_string(),
                cleaned,
            });
        }
        return;
    }

    let pair_start = pairs.len();
    let mut non_han = String::new();
    for character in segment.chars() {
        if is_han_ideograph(character) {
            flush_non_han(&mut non_han, pairs, pair_start, true);
            let surface = if non_han.is_empty() {
                character.to_string()
            } else {
                let mut surface = std::mem::take(&mut non_han);
                surface.push(character);
                surface
            };
            pairs.push(WordPair {
                surface,
                cleaned: character.to_string(),
            });
        } else {
            non_han.push(character);
        }
    }
    flush_non_han(&mut non_han, pairs, pair_start, false);
}

fn flush_non_han(buffer: &mut String, pairs: &mut Vec<WordPair>, pair_start: usize, before_han: bool) {
    if buffer.is_empty() {
        return;
    }
    let cleaned = clean_token(buffer.as_str());
    if cleaned.is_empty() {
        if pairs.len() > pair_start {
            pairs.last_mut().unwrap().surface.push_str(buffer);
            buffer.clear();
        } else if !before_han {
            buffer.clear();
        }
        return;
    }
    pairs.push(WordPair {
        surface: std::mem::take(buffer),
        cleaned,
    });
}

pub fn clean_token(token: &str) -> String {
    token.chars().filter(|character| is_kept_scalar(*character)).collect()
}

fn is_kept_scalar(character: char) -> bool {
    if character == '\'' {
        return true;
    }
    matches!(
        get_general_category(character),
        GeneralCategory::UppercaseLetter
            | GeneralCategory::LowercaseLetter
            | GeneralCategory::TitlecaseLetter
            | GeneralCategory::ModifierLetter
            | GeneralCategory::OtherLetter
            | GeneralCategory::DecimalNumber
            | GeneralCategory::LetterNumber
            | GeneralCategory::OtherNumber
            | GeneralCategory::NonspacingMark
            | GeneralCategory::SpacingMark
            | GeneralCategory::EnclosingMark
    )
}

pub fn is_han_ideograph(character: char) -> bool {
    matches!(
        character as u32,
        0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0x20000..=0x2A6DF | 0x2A700..=0x2B73F | 0x2B740..=0x2B81F | 0x2B820..=0x2CEAF | 0xF900..=0xFAFF
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- 以下两个移植自 v2 `bcut-speech-core/tests/forced_alignment_input.rs` ----
    // v2 第二个测试末尾用 include_str! 守着两个对齐后端的调用点；v3 只有 MLX 的对齐器，守它一个。

    #[test]
    fn qwen_forced_alignment_places_both_time_slots_after_each_word() {
        let tokenizer = Qwen3Tokenizer::from_tokens([(1, "h".into()), (2, "i".into()), (3, "a".into()), (4, "l".into())].into());
        let text = prepare_for_alignment("hi all", &tokenizer, "English");
        // Official encode_timestamp: audio prefix + word<timestamp><timestamp>.
        // The first slot predicts the start of the preceding word, not the next.
        assert_eq!(text.token_ids, vec![1, 2, 151705, 151705, 3, 4, 4, 151705, 151705]);
        assert_eq!(text.timestamp_positions, vec![2, 3, 7, 8]);
        assert_eq!(text.words, vec!["hi", "all"]);
    }

    #[test]
    fn both_backends_use_audio_prefix_without_chat_and_absolute_timestamp_positions() {
        let tokenizer = Qwen3Tokenizer::from_tokens([(1, "h".into()), (2, "i".into())].into());
        let slotted = prepare_for_alignment("hi", &tokenizer, "English");
        for audio_tokens in [1, 3, 400] {
            let input = alignment_input(&slotted, audio_tokens);
            assert_eq!(input.audio_range, 1..audio_tokens + 1);
            assert_eq!(input.token_ids[0], 151669);
            assert!(input.token_ids[input.audio_range.clone()].iter().all(|id| *id == 151676));
            assert_eq!(input.token_ids[audio_tokens + 1..], [151670, 1, 2, 151705, 151705]);
            assert_eq!(input.timestamp_positions, vec![audio_tokens + 4, audio_tokens + 5]);
            assert!(!input.token_ids.contains(&151644));
            for position in input.timestamp_positions {
                assert_eq!(input.token_ids[position], 151705);
            }
        }
        // Guard the actual model caller; a shared helper test alone does not prove
        // the backend uses the correct layout at inference.
        let code = include_str!("../backend/mlx/aligner.rs");
        assert!(code.contains("alignment_input(&slotted, audio_tokens)"));
        assert!(!code.contains("IM_START"));
        assert!(!code.contains("slotted_start"));
    }

    fn surfaces(pairs: &[WordPair]) -> Vec<&str> {
        pairs.iter().map(|pair| pair.surface.as_str()).collect()
    }

    #[test]
    fn space_languages_keep_punctuation_on_the_word() {
        let pairs = split_into_word_pairs("Testing, one two three. BaoCut is ready!", Some("en"));
        assert_eq!(surfaces(&pairs), ["Testing,", "one", "two", "three.", "BaoCut", "is", "ready!"]);
        assert_eq!(pairs[0].cleaned, "Testing");
        // 孤立的标点贴到前一个词上。
        assert_eq!(surfaces(&split_into_word_pairs("yes - no", None)), ["yes-", "no"]);
    }

    #[test]
    fn han_characters_become_single_words() {
        let pairs = split_into_word_pairs("你好，世界", Some("zh"));
        assert_eq!(surfaces(&pairs), ["你", "好，", "世", "界"]);
        assert_eq!(pairs[1].cleaned, "好");
        assert_eq!(surfaces(&split_into_word_pairs("用GPU渲染", None)), ["用", "GPU", "渲", "染"]);
    }

    #[test]
    fn dictionary_languages_use_icu() {
        let pairs = split_into_word_pairs("こんにちは世界", None);
        assert!(pairs.len() >= 2, "{pairs:?}");
        assert_eq!(pairs.iter().map(|pair| pair.cleaned.as_str()).collect::<String>(), "こんにちは世界");
        assert!(split_into_word_pairs("...", Some("ja")).is_empty());
    }

    // 移植自 v2 `bcut-speech-core/tests/core.rs` 的 `text_preprocessing_preserves_surface_and_cleans_model_text`。
    #[test]
    fn clean_token_keeps_letters_marks_and_apostrophes() {
        assert_eq!(clean_token("l'été!"), "l'été");
        // 组合附加符（U+0301）是词的一部分，不能当标点删掉。
        assert_eq!(clean_token("cafe\u{301}?"), "cafe\u{301}");
        assert_eq!(clean_token("42%"), "42");
        // 扩展 B 区的汉字也算汉字；假名不算。
        assert!(is_han_ideograph('\u{20000}'));
        assert!(!is_han_ideograph('あ'));
    }
}
