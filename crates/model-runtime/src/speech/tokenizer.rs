//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/AudioCommon/Tokenizer.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Qwen3 的 byte-level BPE 分词器。

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

use anyhow::{Context, Result, bail};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct BpePair {
    first: String,
    second: String,
}

/// Qwen3 使用的最小 byte-level BPE 实现（`vocab.json` + `merges.txt` + `tokenizer_config.json`
/// 的 added tokens）。
#[derive(Debug, Clone)]
pub struct Qwen3Tokenizer {
    id_to_token: HashMap<i32, String>,
    token_to_id: HashMap<String, i32>,
    merge_ranks: HashMap<BpePair, usize>,
    pub eos_token_id: i32,
    pub pad_token_id: i32,
    pub bos_token_id: i32,
}

impl Default for Qwen3Tokenizer {
    fn default() -> Self {
        Self {
            id_to_token: HashMap::new(),
            token_to_id: HashMap::new(),
            merge_ranks: HashMap::new(),
            eos_token_id: 151_643,
            pad_token_id: 151_643,
            bos_token_id: 151_644,
        }
    }
}

impl Qwen3Tokenizer {
    pub fn from_tokens(id_to_token: HashMap<i32, String>) -> Self {
        let token_to_id = id_to_token.iter().map(|(id, token)| (token.clone(), *id)).collect();
        Self {
            id_to_token,
            token_to_id,
            ..Self::default()
        }
    }

    /// 从已经在内存里的词表与 merge 表建一只（调用方自己读文件 / JSON）。
    /// merge 表按给定顺序定 rank，第一条最优先——与 `merges.txt` 的行序同义。
    ///
    /// Whisper 的词表是同一族（GPT-2 byte-level BPE），v2 的 CoreML Whisper 借这只给 initial prompt 做编码。
    pub fn from_vocab_and_merges<V, M>(vocab: V, merges: M) -> Self
    where
        V: IntoIterator<Item = (String, i32)>,
        M: IntoIterator<Item = (String, String)>,
    {
        let mut tokenizer = Self::default();
        for (token, id) in vocab {
            tokenizer.register(token, id);
        }
        for (rank, (first, second)) in merges.into_iter().enumerate() {
            tokenizer.merge_ranks.insert(BpePair { first, second }, rank);
        }
        tokenizer
    }

    /// 从模型包列出的文件加载。路径由调用方给出：不从词表路径推算同目录的其他文件。
    pub fn load(vocabulary: &Path, merges: Option<&Path>, config: Option<&Path>) -> Result<Self> {
        let data = std::fs::read(vocabulary).context("读取 vocab.json")?;
        let vocabulary: HashMap<String, i32> = serde_json::from_slice(&data).context("vocab.json 应为 {token: id} 字典")?;
        let mut tokenizer = Self::default();
        for (token, id) in vocabulary {
            tokenizer.register(token, id);
        }
        if let Some(config) = config {
            tokenizer.load_added_tokens(config)?;
        }
        if let Some(merges) = merges {
            tokenizer.load_merges(merges)?;
        }
        Ok(tokenizer)
    }

    pub fn len(&self) -> usize {
        self.id_to_token.len()
    }

    pub fn is_empty(&self) -> bool {
        self.id_to_token.is_empty()
    }

    /// 按字面量取单个 token 的 id（不经 BPE）。
    ///
    /// 供需要直接拼接特殊 token 的调用方使用（`<|im_start|>` 等聊天模板标记
    /// 走 [`Self::encode`] 会被 byte-level BPE 拆成普通片段，拿不到特殊 id）。
    pub fn token_id(&self, token: &str) -> Option<i32> {
        self.token_to_id.get(token).copied()
    }

    pub fn encode(&self, text: &str) -> Vec<i32> {
        if self.merge_ranks.is_empty() {
            return text
                .chars()
                .filter_map(|character| self.token_to_id.get(&character.to_string()).copied())
                .collect();
        }

        let mut tokens = Vec::with_capacity(text.len());
        let mut current = String::new();
        for character in text.chars() {
            if matches!(character, ' ' | '\n' | '\t') {
                if !current.is_empty() {
                    self.append_encoded_pre_token(&current, &mut tokens);
                }
                current.clear();
                current.push(character);
            } else {
                current.push(character);
            }
        }
        if !current.is_empty() {
            self.append_encoded_pre_token(&current, &mut tokens);
        }
        tokens
    }

    pub fn decode(&self, tokens: &[i32]) -> String {
        String::from_utf8_lossy(&self.decode_bytes(tokens)).trim().to_string()
    }

    /// 解码为原始字节，不做 trim 或 lossy 替换，供增量流式解码逐段拼接。
    pub fn decode_bytes(&self, tokens: &[i32]) -> Vec<u8> {
        let table = byte_to_unicode();
        let mut buffer = Vec::with_capacity(tokens.len() * 2);
        for token_id in tokens {
            let Some(token) = self.id_to_token.get(token_id) else {
                continue;
            };
            if token.starts_with("<|") && token.ends_with("|>") {
                continue;
            }
            if token.starts_with('<') && token.ends_with('>') && !token.contains('|') {
                buffer.extend_from_slice(token.as_bytes());
                continue;
            }
            for character in token.chars() {
                if let Some(byte) = table.iter().position(|mapped| *mapped == character) {
                    buffer.push(byte as u8);
                } else {
                    let mut encoded = [0; 4];
                    buffer.extend_from_slice(character.encode_utf8(&mut encoded).as_bytes());
                }
            }
        }
        buffer
    }

    fn append_encoded_pre_token(&self, text: &str, tokens: &mut Vec<i32>) {
        let encoded: String = text.as_bytes().iter().map(|byte| byte_to_unicode()[*byte as usize]).collect();
        for piece in self.byte_pair_pieces(&encoded) {
            if let Some(id) = self.token_to_id.get(&piece) {
                tokens.push(*id);
            }
        }
    }

    fn byte_pair_pieces(&self, word: &str) -> Vec<String> {
        let mut pieces: Vec<String> = word.chars().map(|character| character.to_string()).collect();
        let mut next = Vec::with_capacity(pieces.len());
        while pieces.len() > 1 {
            let mut best: Option<(BpePair, usize)> = None;
            for pair in pieces.windows(2) {
                let pair = BpePair {
                    first: pair[0].clone(),
                    second: pair[1].clone(),
                };
                if let Some(rank) = self.merge_ranks.get(&pair)
                    && best.as_ref().is_none_or(|(_, best_rank)| rank < best_rank)
                {
                    best = Some((pair, *rank));
                }
            }
            let Some((best, _)) = best else {
                break;
            };

            next.clear();
            let mut index = 0;
            while index < pieces.len() {
                if index + 1 < pieces.len() && pieces[index] == best.first && pieces[index + 1] == best.second {
                    next.push(format!("{}{}", best.first, best.second));
                    index += 2;
                } else {
                    next.push(pieces[index].clone());
                    index += 1;
                }
            }
            std::mem::swap(&mut pieces, &mut next);
        }
        pieces
    }

    fn load_added_tokens(&mut self, path: &Path) -> Result<()> {
        let value: Value = serde_json::from_slice(&std::fs::read(path)?)?;
        let Some(added) = value.get("added_tokens_decoder").and_then(Value::as_object) else {
            return Ok(());
        };
        for (raw_id, info) in added {
            let (Ok(id), Some(content)) = (raw_id.parse::<i32>(), info.get("content").and_then(Value::as_str)) else {
                continue;
            };
            self.register(content.to_string(), id);
        }
        Ok(())
    }

    fn load_merges(&mut self, path: &Path) -> Result<()> {
        let content = std::fs::read_to_string(path)?;
        let mut rank = 0;
        for line in content.lines().map(str::trim) {
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() != 2 {
                continue;
            }
            self.merge_ranks.insert(
                BpePair {
                    first: parts[0].to_string(),
                    second: parts[1].to_string(),
                },
                rank,
            );
            rank += 1;
        }
        if rank == 0 {
            bail!("merges.txt 不含有效合并规则");
        }
        Ok(())
    }

    fn register(&mut self, token: String, id: i32) {
        if let Some(replaced) = self.id_to_token.insert(id, token.clone())
            && replaced != token
        {
            self.token_to_id.remove(&replaced);
        }
        if let Some(replaced_id) = self.token_to_id.insert(token, id)
            && replaced_id != id
        {
            self.id_to_token.remove(&replaced_id);
        }
    }
}

fn byte_to_unicode() -> &'static [char; 256] {
    static TABLE: OnceLock<[char; 256]> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut output = ['\0'; 256];
        let mut used = [false; 256];
        for byte in b'!'..=b'~' {
            output[byte as usize] = char::from(byte);
            used[byte as usize] = true;
        }
        for byte in 0xA1u8..=0xAC {
            output[byte as usize] = char::from_u32(byte as u32).unwrap();
            used[byte as usize] = true;
        }
        for byte in 0xAEu8..=0xFF {
            output[byte as usize] = char::from_u32(byte as u32).unwrap();
            used[byte as usize] = true;
        }
        let mut offset = 0;
        for byte in 0..=255usize {
            if !used[byte] {
                output[byte] = char::from_u32(0x100 + offset).unwrap();
                offset += 1;
            }
        }
        output
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokenizer() -> (tempfile::TempDir, Qwen3Tokenizer) {
        let dir = tempfile::tempdir().unwrap();
        let vocab = dir.path().join("vocab.json");
        let merges = dir.path().join("merges.txt");
        let config = dir.path().join("tokenizer_config.json");
        std::fs::write(&vocab, "{\"h\": 0, \"i\": 1, \"hi\": 2, \"\u{0120}\": 3, \"\u{0120}hi\": 4}").unwrap();
        std::fs::write(&merges, "#version: 0.2\nh i\n\u{0120} hi\n").unwrap();
        std::fs::write(
            &config,
            r#"{"added_tokens_decoder": {"9": {"content": "<|im_end|>"}, "10": {"content": "<asr_text>"}}}"#,
        )
        .unwrap();
        let tokenizer = Qwen3Tokenizer::load(&vocab, Some(&merges), Some(&config)).unwrap();
        (dir, tokenizer)
    }

    #[test]
    fn encodes_with_merges_and_decodes_bytes() {
        let (_dir, tokenizer) = tokenizer();
        assert_eq!(tokenizer.encode("hi hi"), vec![2, 4]);
        assert_eq!(tokenizer.decode(&[2, 4]), "hi hi");
        // `<|...|>` 是控制 token，解码时略过；`<asr_text>` 原样保留，供调用方切分。
        assert_eq!(tokenizer.decode(&[9, 10, 2]), "<asr_text>hi");
    }

    // ---- 以下移植自 v2 `bcut-speech-core/tests/core.rs` ----

    fn tokenizer_fixture(vocabulary: serde_json::Value, merges: Option<&str>, added: Option<serde_json::Value>) -> tempfile::TempDir {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("vocab.json"), serde_json::to_vec(&vocabulary).unwrap()).unwrap();
        if let Some(merges) = merges {
            std::fs::write(directory.path().join("merges.txt"), merges).unwrap();
        }
        if let Some(added) = added {
            std::fs::write(directory.path().join("tokenizer_config.json"), serde_json::to_vec(&added).unwrap()).unwrap();
        }
        directory
    }

    /// v2 的 `load(vocab.json)` 自己去同目录找另外两个文件；v3 由调用方列出，这里按夹具里有的文件传。
    fn load_fixture(directory: &Path) -> Result<Qwen3Tokenizer> {
        let merges = directory.join("merges.txt");
        let config = directory.join("tokenizer_config.json");
        Qwen3Tokenizer::load(
            &directory.join("vocab.json"),
            merges.exists().then_some(merges.as_path()),
            config.exists().then_some(config.as_path()),
        )
    }

    #[test]
    fn tokenizer_fallback_bpe_utf8_and_added_tokens_match_reference() -> Result<()> {
        let tokenizer = Qwen3Tokenizer::from_tokens(HashMap::from([
            (1, "h".to_string()),
            (2, "i".to_string()),
            (3, "Ġ".to_string()),
            (4, "<|skip|>".to_string()),
            (5, "<asr_text>".to_string()),
        ]));
        assert_eq!(tokenizer.encode("hi?"), vec![1, 2]);
        assert_eq!(tokenizer.decode(&[4, 1, 3, 2]), "h i");
        assert_eq!(tokenizer.decode(&[5]), "<asr_text>");

        let utf8 = Qwen3Tokenizer::from_tokens(HashMap::from([(1, "ä".to_string()), (2, "¸".to_string()), (3, "Ń".to_string())]));
        assert_eq!(utf8.decode(&[1, 2, 3]), "中");

        let fixture = tokenizer_fixture(
            serde_json::json!({"a":1,"b":2,"c":3,"ab":4,"abc":5,"Ġ":6,"Ġa":7}),
            Some("#version: 0.2\r\na b\r\nab c\r\nĠ a\r\n"),
            None,
        );
        let bpe = load_fixture(fixture.path())?;
        assert_eq!(bpe.encode("abc"), vec![5]);
        assert_eq!(bpe.encode("a a"), vec![1, 7]);
        assert_eq!(bpe.decode(&[5]), "abc");

        let fixture = tokenizer_fixture(
            serde_json::json!({"o":2,"n":3}),
            None,
            Some(serde_json::json!({"added_tokens_decoder":{"2":{"content":"n"}}})),
        );
        let replaced = load_fixture(fixture.path())?;
        assert!(replaced.encode("o").is_empty());
        assert_eq!(replaced.encode("n"), vec![2]);
        assert_eq!(replaced.decode(&[3]), "");
        Ok(())
    }

    #[test]
    fn tokenizer_decode_bytes_is_split_stable_and_matches_decode() {
        let tokenizer = Qwen3Tokenizer::from_tokens(HashMap::from([
            (1, "ä".to_string()),
            (2, "¸".to_string()),
            (3, "Ń".to_string()),
            (4, "Ġ".to_string()),
            (5, "h".to_string()),
            (6, "<|skip|>".to_string()),
        ]));
        let tokens = [4, 5, 1, 2, 3, 6, 4];
        let bytes = tokenizer.decode_bytes(&tokens);
        // decode 只是 decode_bytes 的 lossy + trim 投影。
        assert_eq!(bytes, b" h\xe4\xb8\xad ".to_vec());
        assert_eq!(tokenizer.decode(&tokens), String::from_utf8_lossy(&bytes).trim());

        // 任意切点分批解码再拼接必须与一次性解码逐字节一致。
        for split in 0..=tokens.len() {
            let mut joined = tokenizer.decode_bytes(&tokens[..split]);
            joined.extend(tokenizer.decode_bytes(&tokens[split..]));
            assert_eq!(joined, bytes, "切点 {split}");
        }
    }

    #[test]
    fn from_vocab_and_merges_ranks_merges_in_order_and_exposes_literal_ids() {
        let tokenizer = Qwen3Tokenizer::from_vocab_and_merges(
            [
                ("a".to_string(), 1),
                ("b".to_string(), 2),
                ("ab".to_string(), 3),
                ("<|im_start|>".to_string(), 9),
            ],
            [("a".to_string(), "b".to_string())],
        );
        assert_eq!(tokenizer.encode("ab"), vec![3]);
        assert_eq!(tokenizer.token_id("<|im_start|>"), Some(9));
        assert_eq!(tokenizer.token_id("missing"), None);
        assert_eq!(tokenizer.len(), 4);
        assert!(!tokenizer.is_empty());
    }
}
