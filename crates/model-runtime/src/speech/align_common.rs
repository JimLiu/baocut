//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/Qwen3ASR/ForcedAligner.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 强制对齐器的后端无关编排逻辑：`align_long` 的平台检测分段循环。移植自 v2 `bcut-speech`。
//!
//! 后端各自实现 `align_once`（一次非自回归前向 + 单调化），
//! 长音频（>240 s，超出 0.08 s × 5000 类的量程）的分段驱动在这里共享。

use anyhow::Result;

use super::AlignedWord;

/// 用 `align_once` 驱动长音频对齐：检测尾部“平台”（多个词挤在同一时间），
/// 保留可信前缀，对剩余音频 × 剩余词重新对齐并加偏移，最多 10 轮。
pub fn align_long_with<F>(mut align_once: F, audio: &[f32], text: &str, language: &str) -> Result<Vec<AlignedWord>>
where
    F: FnMut(&[f32], &str, &str) -> Result<Vec<AlignedWord>>,
{
    let mut all = Vec::new();
    let mut remaining_audio = audio;
    let mut remaining_text = text.to_owned();
    let mut offset = 0.0_f32;
    for _pass in 0..10 {
        if remaining_audio.is_empty() || remaining_text.is_empty() {
            break;
        }
        let duration = remaining_audio.len() as f32 / 16_000.0;
        let aligned = align_once(remaining_audio, &remaining_text, language)?;
        if aligned.is_empty() {
            break;
        }
        if duration <= 240.0 || aligned.len() < 10 {
            all.extend(offset_words(aligned, offset));
            break;
        }
        let plateau = trailing_plateau_start(&aligned, 0.1, 5);
        if plateau == aligned.len() || plateau == 0 {
            all.extend(offset_words(aligned, offset));
            break;
        }
        let split_time = aligned[plateau - 1].end;
        all.extend(offset_words(aligned[..plateau].to_vec(), offset));
        let split_sample = (split_time * 16_000.0) as usize;
        if split_sample >= remaining_audio.len() || remaining_audio.len() - split_sample < 5 * 16_000 {
            break;
        }
        remaining_audio = &remaining_audio[split_sample..];
        remaining_text = aligned[plateau..]
            .iter()
            .map(|word| word.text.as_str())
            .collect::<Vec<_>>()
            .join(if is_unspaced_language(language) { "" } else { " " });
        offset += split_time;
    }
    Ok(all)
}

pub fn trailing_plateau_start(aligned: &[AlignedWord], tolerance: f32, minimum_size: usize) -> usize {
    if aligned.len() <= minimum_size {
        return aligned.len();
    }
    let mut start = aligned.len();
    for index in (1..aligned.len()).rev() {
        if (aligned[index].start - aligned[index - 1].start).abs() < tolerance {
            start = index - 1;
        } else {
            break;
        }
    }
    if aligned.len() - start >= minimum_size {
        start
    } else {
        aligned.len()
    }
}

pub fn offset_words(words: Vec<AlignedWord>, offset: f32) -> impl Iterator<Item = AlignedWord> {
    words.into_iter().map(move |word| AlignedWord {
        text: word.text,
        start: word.start + offset,
        end: word.end + offset,
    })
}

pub fn is_unspaced_language(language: &str) -> bool {
    let language = language.to_lowercase();
    ["zh", "ja", "th", "lo", "km", "my"]
        .iter()
        .any(|code| language == *code || language.contains(code))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_only_large_trailing_plateaus() {
        let words = (0..9)
            .map(|index| AlignedWord {
                text: index.to_string(),
                start: if index < 4 { index as f32 } else { 4.0 },
                end: if index < 4 { index as f32 + 0.5 } else { 4.1 },
            })
            .collect::<Vec<_>>();
        assert_eq!(trailing_plateau_start(&words, 0.1, 5), 4);
        assert_eq!(trailing_plateau_start(&words, 0.1, 6), words.len());
    }
}
