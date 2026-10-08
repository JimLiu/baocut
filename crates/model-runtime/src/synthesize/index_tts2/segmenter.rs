//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/IndexTTS2TTS/IndexTTS2TextSegmenter.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 长文本切段：对照 speech-swift `IndexTTS2TextSegmenter.swift` 移植。
//!
//! 与上游 `TextTokenizer.split_segments` 同思路：在句末标点、逗号与连字符后
//! 切开，再把相邻片段合并回去直到装不下 `max_tokens`。每段独立生成，长文本
//! 不会超过 GPT 的文本窗口或 mel 预算。
//!
//! 一处有意差异：上游把没有标点的长片段在上限处硬切、余下的当独立一段，
//! 可能只剩一个 token（甚至孤零零的 `▁`）合成出噪声；这里改成尽量在词边界
//! 上均匀切分。

use super::tokenizer::Token;

pub struct TextSegmenter;

impl TextSegmenter {
    pub const DEFAULT_MAX_TOKENS: usize = 120;

    const SENTENCE_END_PIECES: &[&str] = &[".", "!", "?", "▁.", "▁?", "▁..."];
    const COMMA_PIECES: &[&str] = &[",", "▁,"];
    const HYPHEN_PIECES: &[&str] = &["-"];
    const APOSTROPHE_PIECES: &[&str] = &["'", "▁'"];

    pub fn split(tokens: &[Token], max_tokens: usize) -> Vec<Vec<Token>> {
        if tokens.is_empty() {
            return Vec::new();
        }
        let limit = max_tokens.max(1);

        let mut runs: Vec<Vec<Token>> = Vec::new();
        let mut current: Vec<Token> = Vec::new();
        let mut index = 0;
        while index < tokens.len() {
            let token = &tokens[index];
            current.push(token.clone());
            index += 1;

            let piece = token.piece.as_str();
            if Self::COMMA_PIECES.contains(&piece) || Self::HYPHEN_PIECES.contains(&piece) {
                runs.push(std::mem::take(&mut current));
            } else if Self::SENTENCE_END_PIECES.contains(&piece) && current.len() > 2 {
                // 句末的撇号跟着它所结束的句子走。
                if index < tokens.len() && Self::APOSTROPHE_PIECES.contains(&tokens[index].piece.as_str()) {
                    current.push(tokens[index].clone());
                    index += 1;
                }
                runs.push(std::mem::take(&mut current));
            }
        }
        if !current.is_empty() {
            runs.push(current);
        }

        let bounded: Vec<Vec<Token>> = runs.into_iter().flat_map(|run| Self::chunk_evenly(run, limit)).collect();

        let mut merged: Vec<Vec<Token>> = Vec::new();
        for run in bounded {
            match merged.last_mut() {
                Some(last) if last.len() + run.len() <= limit => last.extend(run),
                _ => merged.push(run),
            }
        }
        merged
    }

    /// 把超过 `limit` 的片段切成近似等长的块；每个切点尽量回退到最近的
    /// 词首（`▁` 前缀 piece），只要块仍不少于目标长度的一半。
    fn chunk_evenly(run: Vec<Token>, limit: usize) -> Vec<Vec<Token>> {
        if run.len() <= limit {
            return vec![run];
        }
        let chunk_count = run.len().div_ceil(limit);
        let target = run.len().div_ceil(chunk_count);

        let mut chunks = Vec::new();
        let mut start = 0;
        while start < run.len() {
            let mut end = (start + target).min(run.len());
            if end < run.len() {
                let mut boundary = end;
                while boundary > start + target / 2 && !run[boundary].piece.starts_with('▁') {
                    boundary -= 1;
                }
                if boundary > start {
                    end = boundary;
                }
            }
            chunks.push(run[start..end].to_vec());
            start = end;
        }
        chunks
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn toks(pieces: &[&str]) -> Vec<Token> {
        pieces
            .iter()
            .enumerate()
            .map(|(id, piece)| Token {
                id,
                piece: piece.to_string(),
            })
            .collect()
    }

    fn pieces(segment: &[Token]) -> Vec<&str> {
        segment.iter().map(|t| t.piece.as_str()).collect()
    }

    #[test]
    fn splits_on_sentence_end_and_merges_within_limit() {
        let tokens = toks(&["▁HELLO", "▁WORLD", ".", "▁THIS", "▁IS", "▁A", "▁TEST", "."]);
        let segments = TextSegmenter::split(&tokens, 120);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].len(), 8);

        let segments = TextSegmenter::split(&tokens, 5);
        assert_eq!(segments.len(), 2);
        assert_eq!(pieces(&segments[0]), vec!["▁HELLO", "▁WORLD", "."]);
        assert_eq!(pieces(&segments[1]), vec!["▁THIS", "▁IS", "▁A", "▁TEST", "."]);
    }

    #[test]
    fn keeps_trailing_apostrophe_with_sentence() {
        let tokens = toks(&["▁HE", "▁SAID", "▁.", "'", "▁OK", "▁THEN", ","]);
        let segments = TextSegmenter::split(&tokens, 4);
        assert_eq!(pieces(&segments[0]), vec!["▁HE", "▁SAID", "▁.", "'"]);
        assert_eq!(pieces(&segments[1]), vec!["▁OK", "▁THEN", ","]);
    }

    #[test]
    fn short_sentence_end_does_not_split() {
        let tokens = toks(&["▁A", ".", "▁B", "▁C", "▁D", "."]);
        let segments = TextSegmenter::split(&tokens, 3);
        // 「▁A .」只有 2 个 token，不在句号处切；整段 6 个再均匀切成两块。
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].len() + segments[1].len(), 6);
    }

    #[test]
    fn chunks_long_runs_at_word_boundaries() {
        let tokens = toks(&["▁AB", "C", "▁DE", "F", "▁GH", "I", "▁JK"]);
        let segments = TextSegmenter::split(&tokens, 4);
        assert_eq!(segments.len(), 2);
        assert_eq!(pieces(&segments[0]), vec!["▁AB", "C", "▁DE", "F"]);
        assert_eq!(pieces(&segments[1]), vec!["▁GH", "I", "▁JK"]);
    }

    #[test]
    fn empty_input() {
        assert!(TextSegmenter::split(&[], 120).is_empty());
    }
}
