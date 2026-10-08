//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/IndexTTS2TTS/IndexTTS2Tokenizer.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! IndexTTS2 `bpe.model` 的 SentencePiece Unigram 分词器。
//!
//! 对照 speech-swift `IndexTTS2Tokenizer.swift` 移植。进格子前先复刻上游
//! 文本前端（`indextts/utils/front.py`）：
//!
//! 1. `char_rep_map` 标点改写（`。`→`.`、`，`→`,`、引号括号→`'`、`:`/`;`→`,`…），
//!    词表里没有这些原始标点的 piece。
//! 2. `tokenize_by_CJK_char`：每个 CJK 字符前后加词边界，让格子在每个汉字前
//!    单独吐出 `▁`——GPT 训练时看到的形状；词表里没有 `▁` 前缀的 CJK piece。
//! 3. 非 CJK 文本大写化。
//!
//! 数字读法由 [`super::normalizer::TextNormalizer`] 在这些步骤之前处理。没有
//! piece 的字符落到 `<unk>`，连续的 `<unk>` 合并，与 SentencePiece 一致。

use super::normalizer::TextNormalizer;
use super::sentencepiece::{Piece, PieceType, SentencePieceModel};
use anyhow::{Result, bail};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    pub id: usize,
    pub piece: String,
}

pub struct Tokenizer {
    pieces: Vec<Piece>,
    token_to_id: HashMap<String, usize>,
    single_scalar_pieces: HashSet<char>,
    max_piece_scalars: usize,
    unknown_score: f32,
    /// `<unk>` piece 的 id；模型没有时为 None。
    pub unknown_token_id: Option<usize>,
    /// 词表里的拼音片（`XING2`、`LVE4`，去掉前导 `▁`）：上游「Pinyin control」合法音节的等价物
    /// （模型目录不带 `pinyin.vocab`），注音渲染只在这里有片时才把字换成拼音。
    pinyin_pieces: HashSet<String>,
}

impl Tokenizer {
    pub const MAX_INPUT_SCALARS: usize = 2048;
    /// SentencePiece 的 `kUnkPenalty`：`<unk>` 节点得分为 `minScore - 10`。
    const UNKNOWN_PENALTY: f32 = 10.0;

    pub fn load(model_path: &Path) -> Result<Self> {
        let model = SentencePieceModel::load(model_path)?;
        Self::from_pieces(model.pieces)
    }

    pub fn from_pieces(pieces: Vec<Piece>) -> Result<Self> {
        if pieces.is_empty() {
            bail!("IndexTTS2 分词器词表为空");
        }
        let mut token_to_id = HashMap::with_capacity(pieces.len());
        for (index, piece) in pieces.iter().enumerate() {
            token_to_id.entry(piece.text.clone()).or_insert(index);
        }
        let lattice: Vec<&Piece> = pieces.iter().filter(|p| !p.is_control_or_unknown()).collect();
        let single_scalar_pieces = lattice
            .iter()
            .filter_map(|piece| {
                let mut chars = piece.text.chars();
                match (chars.next(), chars.next()) {
                    (Some(c), None) => Some(c),
                    _ => None,
                }
            })
            .collect();
        let max_piece_scalars = lattice.iter().map(|piece| piece.text.chars().count()).max().unwrap_or(1).max(1);
        let unknown_score = lattice
            .iter()
            .map(|piece| piece.score)
            .fold(None, |acc: Option<f32>, s| Some(acc.map_or(s, |a| a.min(s))))
            .unwrap_or(0.0)
            - Self::UNKNOWN_PENALTY;
        let unknown_token_id = pieces.iter().position(|piece| piece.piece_type() == Some(PieceType::Unknown));
        let pinyin_pieces = lattice
            .iter()
            .map(|piece| piece.text.trim_start_matches('▁'))
            .filter(|text| is_pinyin_piece(text))
            .map(str::to_owned)
            .collect();
        Ok(Self {
            pieces,
            token_to_id,
            single_scalar_pieces,
            max_piece_scalars,
            unknown_score,
            unknown_token_id,
            pinyin_pieces,
        })
    }

    /// 词表里的拼音片集合（大写、无 `▁`）。
    pub fn pinyin_pieces(&self) -> &HashSet<String> {
        &self.pinyin_pieces
    }

    pub fn vocab_size(&self) -> usize {
        self.pieces.len()
    }

    pub fn tokenize(&self, text: &str) -> Result<Vec<Token>> {
        Ok(self
            .encode(text)?
            .into_iter()
            .map(|id| Token {
                id,
                piece: self.pieces[id].text.clone(),
            })
            .collect())
    }

    pub fn encode(&self, text: &str) -> Result<Vec<usize>> {
        let normalized = self.normalized_piece_text(text);
        if normalized.is_empty() {
            return Ok(Vec::new());
        }
        let scalars: Vec<char> = normalized.chars().collect();
        if scalars.len() > Self::MAX_INPUT_SCALARS {
            bail!("IndexTTS2 分词输入过长：最多 {} 个 Unicode 标量", Self::MAX_INPUT_SCALARS);
        }

        let n = scalars.len();
        let mut best_scores = vec![f32::NEG_INFINITY; n + 1];
        let mut back_pointer: Vec<Option<(usize, usize)>> = vec![None; n + 1];
        best_scores[0] = 0.0;
        let mut buffer = String::new();

        for start in 0..n {
            if !best_scores[start].is_finite() {
                continue;
            }
            let max_end = n.min(start + self.max_piece_scalars);
            buffer.clear();
            for end in start + 1..=max_end {
                buffer.push(scalars[end - 1]);
                let Some(&id) = self.token_to_id.get(buffer.as_str()) else {
                    continue;
                };
                if self.pieces[id].is_control_or_unknown() {
                    continue;
                }
                let score = best_scores[start] + self.pieces[id].score;
                if score > best_scores[end] || (score == best_scores[end] && Self::is_tie_break_better(id, start, back_pointer[end])) {
                    best_scores[end] = score;
                    back_pointer[end] = Some((start, id));
                }
            }
            // SentencePiece 在没有单字符 piece 覆盖的位置补一个单字符 `<unk>` 节点。
            if let Some(unknown_id) = self.unknown_token_id {
                if !self.single_scalar_pieces.contains(&scalars[start]) {
                    let score = best_scores[start] + self.unknown_score;
                    if score > best_scores[start + 1] {
                        best_scores[start + 1] = score;
                        back_pointer[start + 1] = Some((start, unknown_id));
                    }
                }
            }
        }

        if !best_scores[n].is_finite() {
            bail!("IndexTTS2 分词器无法编码文本：{text}");
        }

        let mut ids: Vec<usize> = Vec::new();
        let mut cursor = n;
        while cursor > 0 {
            let Some((start, id)) = back_pointer[cursor] else {
                break;
            };
            // 连续的 `<unk>` 折叠成一个，与 SentencePiece 一致。
            if Some(id) != self.unknown_token_id || ids.last().copied() != self.unknown_token_id {
                ids.push(id);
            }
            cursor = start;
        }
        ids.reverse();
        Ok(ids)
    }

    /// 把 piece 拼回文本，撤销逐字 CJK 空格：拉丁词之间保留空格，CJK 旁边的空格去掉。
    pub fn decode(&self, ids: &[usize]) -> String {
        let surface: String = ids
            .iter()
            .filter_map(|&id| self.pieces.get(id))
            .filter(|piece| !piece.is_control_or_unknown())
            .map(|piece| piece.text.as_str())
            .collect::<String>()
            .replace('▁', " ");
        let scalars: Vec<char> = surface.chars().collect();
        let mut output = String::new();
        for (index, &scalar) in scalars.iter().enumerate() {
            if scalar == ' ' {
                if let (Some(previous), Some(next)) = (output.chars().next_back(), scalars[index + 1..].iter().copied().find(|c| *c != ' '))
                {
                    if (is_cjk(previous) || is_cjk(next)) && !is_latin_alphanumeric(previous) && !is_latin_alphanumeric(next) {
                        continue;
                    }
                }
            }
            output.push(scalar);
        }
        output.trim().to_string()
    }

    // MARK: - 上游文本前端

    fn normalized_piece_text(&self, text: &str) -> String {
        let rewritten = rewrite_punctuation(&TextNormalizer::normalize(text));
        let spaced = separate_cjk_characters(&rewritten).to_uppercase();
        let normalized = spaced.nfkc().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
        if normalized.is_empty() {
            return String::new();
        }
        format!("▁{}", normalized.replace(' ', "▁"))
    }

    fn is_tie_break_better(candidate_id: usize, candidate_start: usize, existing: Option<(usize, usize)>) -> bool {
        match existing {
            None => true,
            Some((existing_start, existing_id)) => {
                candidate_id < existing_id || (candidate_id == existing_id && candidate_start > existing_start)
            }
        }
    }
}

/// `[A-Z]+[1-5]`：大写拼音 + 声调。
fn is_pinyin_piece(text: &str) -> bool {
    let Some((tone, body)) = text.as_bytes().split_last() else {
        return false;
    };
    (b'1'..=b'5').contains(tone) && !body.is_empty() && body.iter().all(u8::is_ascii_uppercase)
}

/// 上游 `char_rep_map`，保持原始顺序：每个位置按序尝试、首个命中生效，
/// 与上游正则的 alternation 行为一致。
pub(crate) const PUNCTUATION_REWRITES: &[(&str, &str)] = &[
    ("：", ","),
    ("；", ","),
    (";", ","),
    ("，", ","),
    ("。", "."),
    ("！", "!"),
    ("？", "?"),
    ("\n", " "),
    ("·", "-"),
    ("、", ","),
    ("...", "…"),
    (",,,", "…"),
    ("，，，", "…"),
    ("……", "…"),
    ("“", "'"),
    ("”", "'"),
    ("\"", "'"),
    ("‘", "'"),
    ("’", "'"),
    ("（", "'"),
    ("）", "'"),
    ("(", "'"),
    (")", "'"),
    ("《", "'"),
    ("》", "'"),
    ("【", "'"),
    ("】", "'"),
    ("[", "'"),
    ("]", "'"),
    ("—", "-"),
    ("～", "-"),
    ("~", "-"),
    ("「", "'"),
    ("」", "'"),
    (":", ","),
];

/// 上游 `zh_char_rep_map`：中文路径额外把 `$` 读成 `.`。
const CHINESE_EXTRA_REWRITES: &[(&str, &str)] = &[("$", ".")];

pub(crate) fn rewrite_punctuation(text: &str) -> String {
    let chinese = TextNormalizer::uses_chinese_front_end(text);
    let mut output = String::with_capacity(text.len());
    let mut rest = text;
    let extra: &[(&str, &str)] = if chinese { CHINESE_EXTRA_REWRITES } else { &[] };
    'outer: while !rest.is_empty() {
        for (from, to) in extra.iter().chain(PUNCTUATION_REWRITES.iter()) {
            if let Some(after) = rest.strip_prefix(from) {
                output.push_str(to);
                rest = after;
                continue 'outer;
            }
        }
        let c = rest.chars().next().expect("非空");
        output.push(c);
        rest = &rest[c.len_utf8()..];
    }
    output
}

/// 上游 `tokenize_by_CJK_char`：每个 CJK 字符独立成一个空白分隔的词。
fn separate_cjk_characters(text: &str) -> String {
    let mut output = String::with_capacity(text.len() * 2);
    for c in text.chars() {
        if is_cjk(c) {
            output.push(' ');
            output.push(c);
            output.push(' ');
        } else {
            output.push(c);
        }
    }
    output
}

/// 上游切分用的 CJK 区间（`CJK_RANGE_PATTERN`）。
pub fn is_cjk(c: char) -> bool {
    matches!(
        c as u32,
        0x1100..=0x11FF
            | 0x2E80..=0xA4CF
            | 0xA840..=0xD7AF
            | 0xF900..=0xFAFF
            | 0xFE30..=0xFE4F
            | 0xFF65..=0xFFDC
            | 0x20000..=0x2FFFF
    )
}

fn is_latin_alphanumeric(c: char) -> bool {
    c.is_ascii_alphanumeric()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synthesize::index_tts2::sentencepiece::test_support::encode_model;

    fn tokenizer() -> Tokenizer {
        let data = encode_model(&[
            ("<unk>", 0.0, 2),
            ("<s>", 0.0, 3),
            ("</s>", 0.0, 3),
            ("▁", -1.0, 1),
            ("▁HELLO", -2.0, 1),
            ("▁HE", -3.0, 1),
            ("LLO", -3.5, 1),
            ("H", -5.0, 1),
            ("E", -5.0, 1),
            ("L", -5.0, 1),
            ("O", -5.0, 1),
            ("宝", -4.0, 1),
            ("剪", -4.0, 1),
            (",", -1.0, 1),
            (".", -1.0, 1),
            ("'", -1.0, 1),
            ("▁.", -1.5, 1),
        ]);
        let model = SentencePieceModel::parse(&data).unwrap();
        Tokenizer::from_pieces(model.pieces).unwrap()
    }

    #[test]
    fn viterbi_prefers_best_score() {
        let t = tokenizer();
        let tokens = t.tokenize("hello").unwrap();
        let pieces: Vec<&str> = tokens.iter().map(|t| t.piece.as_str()).collect();
        assert_eq!(pieces, vec!["▁HELLO"]);
    }

    #[test]
    fn cjk_characters_get_word_boundaries_and_punctuation_is_rewritten() {
        let t = tokenizer();
        let tokens = t.tokenize("宝剪。").unwrap();
        let pieces: Vec<&str> = tokens.iter().map(|t| t.piece.as_str()).collect();
        assert_eq!(pieces, vec!["▁", "宝", "▁", "剪", "▁."]);
        assert_eq!(t.decode(&tokens.iter().map(|t| t.id).collect::<Vec<_>>()), "宝剪.");
    }

    #[test]
    fn unknown_runs_collapse() {
        let t = tokenizer();
        let ids = t.encode("hello ZZ").unwrap();
        let unk = t.unknown_token_id.unwrap();
        assert_eq!(ids.iter().filter(|&&id| id == unk).count(), 1);
        assert_eq!(ids[0], 4);
        assert_eq!(ids[1], 3);
    }

    #[test]
    fn empty_text_gives_no_tokens() {
        let t = tokenizer();
        assert!(t.encode("   ").unwrap().is_empty());
    }

    #[test]
    fn decode_keeps_latin_spacing() {
        let t = tokenizer();
        let ids = t.encode("hello hello").unwrap();
        assert_eq!(t.decode(&ids), "HELLO HELLO");
    }

    #[test]
    fn pinyin_pieces_come_from_the_vocabulary_and_missing_ones_are_dropped() {
        use crate::synthesize::readings::{parse, render_inline_pinyin};
        let data = encode_model(&[
            ("<unk>", 0.0, 2),
            ("▁", -1.0, 1),
            ("▁XING2", -2.0, 1),
            ("HANG2", -2.0, 1),
            ("A1B", -2.0, 1),
            ("X", -5.0, 1),
            ("I", -5.0, 1),
            ("N", -5.0, 1),
            ("G", -5.0, 1),
            ("2", -5.0, 1),
            ("觉", -4.0, 1),
            ("得", -4.0, 1),
            ("绿", -4.0, 1),
        ]);
        let t = Tokenizer::from_pieces(SentencePieceModel::parse(&data).unwrap().pieces).unwrap();
        let mut found: Vec<&str> = t.pinyin_pieces().iter().map(String::as_str).collect();
        found.sort();
        assert_eq!(found, ["HANG2", "XING2"]);

        let rendered = render_inline_pinyin(&parse("觉得<行|xing2><绿|lu4>"), Some(t.pinyin_pieces()));
        // 词表没有 LU4：原字照送，报 dropped。
        assert_eq!(rendered.dropped.len(), 1);
        assert_eq!(rendered.dropped[0].reading, "lu4");
        let pieces: Vec<String> = t.tokenize(&rendered.text).unwrap().into_iter().map(|token| token.piece).collect();
        assert!(pieces.contains(&"▁XING2".to_owned()), "{pieces:?}");
        assert!(pieces.contains(&"绿".to_owned()), "{pieces:?}");
        assert!(!pieces.iter().any(|p| p == "2"), "声调数字没被拆开：{pieces:?}");
    }

    #[test]
    fn punctuation_rewrite_order() {
        assert_eq!(rewrite_punctuation("a...b,,,c"), "a…b…c");
        assert_eq!(rewrite_punctuation("“你好”：（一）"), "'你好','一'");
        assert_eq!(rewrite_punctuation("价格$"), "价格.");
        assert_eq!(rewrite_punctuation("price $"), "price $");
    }
}
