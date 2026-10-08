//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/Qwen3ASR/Qwen3ASR.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Qwen3-ASR 的解码选项、确定性惩罚、复读检测与音频塔的分块长度。

use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq)]
pub struct Qwen3DecodingOptions {
    pub max_tokens: usize,
    pub language: Option<String>,
    pub context: Option<String>,
    pub repetition_penalty: f32,
    pub no_repeat_ngram_size: usize,
    pub temperature: f32,
    pub long_input_threshold_seconds: f64,
    pub long_input_no_repeat_ngram_size: usize,
}

impl Default for Qwen3DecodingOptions {
    fn default() -> Self {
        Self {
            max_tokens: 448,
            language: None,
            context: None,
            repetition_penalty: 1.0,
            no_repeat_ngram_size: 0,
            temperature: 0.0,
            long_input_threshold_seconds: 15.0,
            long_input_no_repeat_ngram_size: 3,
        }
    }
}

impl Qwen3DecodingOptions {
    pub fn adapted_for(&self, duration_seconds: f64) -> Self {
        if duration_seconds <= self.long_input_threshold_seconds
            || self.no_repeat_ngram_size != 0
            || self.long_input_no_repeat_ngram_size == 0
        {
            return self.clone();
        }
        let mut adapted = self.clone();
        adapted.no_repeat_ngram_size = self.long_input_no_repeat_ngram_size;
        adapted
    }

    pub fn is_greedy_fast_path(&self) -> bool {
        self.repetition_penalty == 1.0 && self.no_repeat_ngram_size == 0 && self.temperature == 0.0
    }
}

pub fn forbidden_next_tokens(generated: &[i32], ngram_size: usize) -> Vec<i32> {
    if ngram_size == 0 || generated.len() < ngram_size {
        return Vec::new();
    }
    let prefix_length = ngram_size - 1;
    let suffix_start = generated.len() - prefix_length;
    let mut forbidden = Vec::new();
    for start in 0..=generated.len() - ngram_size {
        let matches = (0..prefix_length).all(|offset| generated[start + offset] == generated[suffix_start + offset]);
        if matches {
            forbidden.push(generated[start + prefix_length]);
        }
    }
    forbidden
}

pub fn apply_deterministic_penalties(scores: &mut [f32], generated: &[i32], options: &Qwen3DecodingOptions) {
    if options.repetition_penalty > 1.0 {
        for token in generated.iter().copied().collect::<HashSet<_>>() {
            let Ok(index) = usize::try_from(token) else {
                continue;
            };
            let Some(value) = scores.get_mut(index) else {
                continue;
            };
            *value = if *value > 0.0 {
                *value / options.repetition_penalty
            } else {
                *value * options.repetition_penalty
            };
        }
    }
    for token in forbidden_next_tokens(generated, options.no_repeat_ngram_size) {
        if let Ok(index) = usize::try_from(token)
            && let Some(value) = scores.get_mut(index)
        {
            *value = f32::NEG_INFINITY;
        }
    }
}

pub const REPETITION_MAX_RUN: usize = 6;

pub fn looks_degenerate(text: &str) -> bool {
    let mut units: Vec<String> = text.split_whitespace().map(str::to_string).collect();
    if units.len() <= 2 {
        units = text
            .chars()
            .filter(|character| !character.is_whitespace())
            .map(|character| character.to_string())
            .collect();
    }
    (1..=3).any(|size| max_repeat(&units, size) >= REPETITION_MAX_RUN)
}

pub fn max_repeat(units: &[String], n: usize) -> usize {
    if n == 0 || units.len() < 2 * n {
        return 1;
    }
    let mut best = 1;
    for phase in 0..n {
        let mut run = 1;
        let mut index = phase;
        while index + 2 * n <= units.len() {
            if units[index..index + n] == units[index + n..index + 2 * n] {
                run += 1;
                best = best.max(run);
            } else {
                run = 1;
            }
            index += n;
        }
    }
    best
}

pub fn input_chunk_lengths(frame_count: usize, chunk_size: usize) -> Vec<usize> {
    if frame_count == 0 || chunk_size == 0 {
        return Vec::new();
    }
    let mut lengths = vec![chunk_size; frame_count / chunk_size];
    if !frame_count.is_multiple_of(chunk_size) {
        lengths.push(frame_count % chunk_size);
    }
    lengths
}

pub fn downsampled_length(mut input_length: usize) -> usize {
    if input_length == 0 {
        return 0;
    }
    for _ in 0..3 {
        input_length = (input_length - 1) / 2 + 1;
    }
    input_length
}

/// Qwen3-ASR 的尺寸档。0.6B 是 `Small`，1.7B 是 `Large`；结构参数见 `backend::mlx::qwen3`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AsrModelSize {
    Small,
    Large,
}

impl AsrModelSize {
    pub fn detect(model_id: &str) -> Self {
        if model_id.to_lowercase().contains("1.7b") {
            Self::Large
        } else {
            Self::Small
        }
    }

    pub fn detect_bits(model_id: &str) -> usize {
        let lower = model_id.to_lowercase();
        if lower.contains("8bit") || lower.contains("8-bit") {
            8
        } else if lower.contains("5bit") || lower.contains("5-bit") {
            5
        } else if lower.contains("4bit") || lower.contains("4-bit") {
            4
        } else if Self::detect(model_id) == Self::Large {
            8
        } else {
            4
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn degenerate_text_is_detected() {
        assert!(looks_degenerate("the the the the the the the"));
        assert!(looks_degenerate("哈哈哈哈哈哈哈"));
        assert!(!looks_degenerate("testing one two three"));
    }

    #[test]
    fn long_inputs_turn_on_ngram_blocking() {
        let options = Qwen3DecodingOptions::default();
        assert!(options.is_greedy_fast_path());
        assert_eq!(options.adapted_for(10.0).no_repeat_ngram_size, 0);
        let long = options.adapted_for(16.0);
        assert_eq!(long.no_repeat_ngram_size, 3);
        assert!(!long.is_greedy_fast_path());
        assert_eq!(forbidden_next_tokens(&[1, 2, 3, 1, 2], 3), vec![3]);
    }

    #[test]
    fn penalties_scale_seen_tokens() {
        let options = Qwen3DecodingOptions {
            repetition_penalty: 2.0,
            ..Qwen3DecodingOptions::default()
        };
        let mut scores = vec![4.0, -4.0, 1.0];
        apply_deterministic_penalties(&mut scores, &[0, 1], &options);
        assert_eq!(scores, vec![2.0, -8.0, 1.0]);
    }

    #[test]
    fn audio_tower_lengths() {
        assert_eq!(input_chunk_lengths(250, 100), vec![100, 100, 50]);
        assert_eq!(downsampled_length(100), 13);
        assert_eq!(downsampled_length(0), 0);
    }

    #[test]
    fn model_size_and_bits_are_read_from_the_model_id() {
        assert_eq!(AsrModelSize::detect("Qwen3-ASR-1.7b"), AsrModelSize::Large);
        assert_eq!(AsrModelSize::detect("Qwen3-ASR-0.6B-MLX-4bit"), AsrModelSize::Small);
        assert_eq!(AsrModelSize::detect_bits("model-5-bit"), 5);
        assert_eq!(AsrModelSize::detect_bits("model-1.7B"), 8);
        assert_eq!(AsrModelSize::detect_bits("model-0.6B"), 4);
    }

    // 移植自 v2 `bcut-speech-core/tests/core.rs` 的 `qwen_decoding_policy_chunking_and_model_detection_match_reference`，
    // 只补上面几个测试没覆盖到的边界。
    #[test]
    fn decoding_policy_boundaries_match_reference() {
        let options = Qwen3DecodingOptions::default();
        assert_eq!(options.max_tokens, 448);
        // 恰好 15 秒不算长输入。
        let mut long = options.clone();
        long.long_input_no_repeat_ngram_size = 4;
        assert_eq!(long.adapted_for(15.0).no_repeat_ngram_size, 0);
        assert_eq!(long.adapted_for(15.01).no_repeat_ngram_size, 4);
        assert_eq!(forbidden_next_tokens(&[1, 2, 3, 1, 2, 4, 1, 2], 3), vec![3, 4]);
        // 越界的 token（-1、99）直接跳过，不能 panic。
        let mut scores = vec![10.0, -4.0, 1.0];
        let penalty = Qwen3DecodingOptions {
            repetition_penalty: 2.0,
            ..Default::default()
        };
        apply_deterministic_penalties(&mut scores, &[0, 1, 99, -1], &penalty);
        assert_eq!(scores, vec![5.0, -8.0, 1.0]);
        assert!(looks_degenerate("百分比 百分比 百分比 百分比 百分比 百分比"));
        assert_eq!(input_chunk_lengths(201, 100), vec![100, 100, 1]);
        assert_eq!(downsampled_length(105), 14);
    }
}
