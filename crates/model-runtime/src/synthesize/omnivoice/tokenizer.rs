//! OmniVoice 文本分词器：Qwen3 的 byte-level BPE（`tokenizer.json`）。
//!
//! 按 HF `tokenizers` 的流水线逐段实现：先切出 added token（33 个，`<|text_start|>`
//! 等，不参与归一化）→ 其余片段 NFC → 按 Qwen2 预切分正则切词（`Isolated`）→ 字节映射
//! 成 GPT-2 的可见字符 → 按 merges 次序做 BPE（每轮合并 rank 最小、同 rank 取最左的相邻对）。
//! 不带 BOS / EOS（Qwen2 的 post_processor 只是 ByteLevel）。
//!
//! 没有复用 `crate::speech::tokenizer::Qwen3Tokenizer`：它按空白预切分，与官方正则
//! 在数字、缩写、换行与标点上切法不同。

use anyhow::{Context, Result, bail, ensure};
use fancy_regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

/// `tokenizer.json` 的预切分正则（Qwen2 / Qwen3 通用）。
const PATTERN: &str = r"(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+";

pub struct Tokenizer {
    /// GPT-2 可见字符 → id（仅单字符，BPE 的初始符号）。
    char_ids: HashMap<char, u32>,
    /// `(左 id, 右 id)` → `(merge 次序, 合并后 id)`。
    merges: HashMap<(u32, u32), (u32, u32)>,
    /// added token 原文 → id，按长度从长到短排好便于最长匹配。
    added: Vec<(String, u32)>,
    pattern: Regex,
    byte_chars: [char; 256],
}

impl Tokenizer {
    pub fn load(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path).with_context(|| format!("无法读取 OmniVoice 分词表 {}", path.display()))?;
        let json: Value = serde_json::from_str(&text).with_context(|| format!("解析 OmniVoice 分词表 {} 失败", path.display()))?;
        Self::from_json(&json)
    }

    pub fn from_json(json: &Value) -> Result<Self> {
        let model = &json["model"];
        ensure!(model["type"].as_str() == Some("BPE"), "OmniVoice 分词表不是 BPE");
        let vocab = model["vocab"].as_object().context("OmniVoice 分词表缺少 model.vocab")?;
        let mut ids: HashMap<&str, u32> = HashMap::with_capacity(vocab.len());
        for (token, id) in vocab {
            let id = id.as_u64().context("OmniVoice 分词表 id 不是整数")? as u32;
            ids.insert(token.as_str(), id);
        }
        let byte_chars = bytes_to_unicode();
        let mut char_ids = HashMap::with_capacity(256);
        for c in byte_chars {
            let mut buf = [0u8; 4];
            let id = ids
                .get(&*c.encode_utf8(&mut buf))
                .with_context(|| format!("OmniVoice 分词表缺少字节符号 {c:?}"))?;
            char_ids.insert(c, *id);
        }
        let merge_list = model["merges"].as_array().context("OmniVoice 分词表缺少 model.merges")?;
        let mut merges = HashMap::with_capacity(merge_list.len());
        for (rank, merge) in merge_list.iter().enumerate() {
            let (left, right) = match merge {
                Value::Array(pair) if pair.len() == 2 => (
                    pair[0].as_str().unwrap_or_default().to_string(),
                    pair[1].as_str().unwrap_or_default().to_string(),
                ),
                Value::String(line) => match line.split_once(' ') {
                    Some((l, r)) => (l.to_string(), r.to_string()),
                    None => bail!("OmniVoice 分词表 merge 第 {rank} 条格式不对"),
                },
                _ => bail!("OmniVoice 分词表 merge 第 {rank} 条格式不对"),
            };
            let (Some(&l), Some(&r), Some(&merged)) = (
                ids.get(left.as_str()),
                ids.get(right.as_str()),
                ids.get(format!("{left}{right}").as_str()),
            ) else {
                bail!("OmniVoice 分词表 merge 第 {rank} 条引用了词表外的符号");
            };
            merges.entry((l, r)).or_insert((rank as u32, merged));
        }
        let mut added = Vec::new();
        if let Some(tokens) = json["added_tokens"].as_array() {
            for token in tokens {
                let content = token["content"].as_str().context("OmniVoice added token 缺少 content")?;
                let id = token["id"].as_u64().context("OmniVoice added token 缺少 id")?;
                added.push((content.to_string(), id as u32));
            }
        }
        added.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then(a.1.cmp(&b.1)));
        Ok(Self {
            char_ids,
            merges,
            added,
            pattern: Regex::new(PATTERN).expect("静态预切分正则应能编译"),
            byte_chars,
        })
    }

    pub fn added_id(&self, token: &str) -> Option<u32> {
        self.added.iter().find(|(content, _)| content == token).map(|(_, id)| *id)
    }

    /// `tokenizer(text).input_ids`（不加特殊 token）。
    pub fn encode(&self, text: &str) -> Vec<u32> {
        let mut out = Vec::new();
        let mut start = 0;
        let mut cursor = 0;
        while cursor < text.len() {
            let rest = &text[cursor..];
            if let Some((content, id)) = self.added.iter().find(|(c, _)| rest.starts_with(c.as_str())) {
                self.encode_normalized(&text[start..cursor], &mut out);
                out.push(*id);
                cursor += content.len();
                start = cursor;
                continue;
            }
            cursor += rest.chars().next().map_or(1, char::len_utf8);
        }
        self.encode_normalized(&text[start..], &mut out);
        out
    }

    fn encode_normalized(&self, text: &str, out: &mut Vec<u32>) {
        if text.is_empty() {
            return;
        }
        let text: String = text.nfc().collect();
        let mut cursor = 0;
        for found in self.pattern.find_iter(&text) {
            let Ok(found) = found else { break };
            if found.start() > cursor {
                self.encode_word(&text[cursor..found.start()], out);
            }
            self.encode_word(found.as_str(), out);
            cursor = found.end();
        }
        if cursor < text.len() {
            self.encode_word(&text[cursor..], out);
        }
    }

    fn encode_word(&self, word: &str, out: &mut Vec<u32>) {
        let mut symbols: Vec<u32> = word.bytes().map(|b| self.char_ids[&self.byte_chars[b as usize]]).collect();
        loop {
            let mut best: Option<(u32, usize, u32)> = None;
            for i in 0..symbols.len().saturating_sub(1) {
                if let Some(&(rank, merged)) = self.merges.get(&(symbols[i], symbols[i + 1]))
                    && best.is_none_or(|(r, _, _)| rank < r)
                {
                    best = Some((rank, i, merged));
                }
            }
            let Some((rank, _, merged)) = best else { break };
            // 同一 rank 的所有非重叠出现从左到右一起合并（与逐个合并等价）。
            let mut next = Vec::with_capacity(symbols.len());
            let mut i = 0;
            while i < symbols.len() {
                if i + 1 < symbols.len() && self.merges.get(&(symbols[i], symbols[i + 1])).is_some_and(|&(r, _)| r == rank) {
                    next.push(merged);
                    i += 2;
                } else {
                    next.push(symbols[i]);
                    i += 1;
                }
            }
            symbols = next;
        }
        out.extend(symbols);
    }
}

/// GPT-2 `bytes_to_unicode`：可打印字节映射到自身，其余依次映射到 U+0100 起。
fn bytes_to_unicode() -> [char; 256] {
    let mut table = ['\0'; 256];
    let mut extra = 0u32;
    for b in 0..=255u32 {
        let printable = (0x21..=0x7e).contains(&b) || (0xa1..=0xac).contains(&b) || (0xae..=0xff).contains(&b);
        table[b as usize] = if printable {
            char::from_u32(b).expect("latin-1")
        } else {
            let c = char::from_u32(256 + extra).expect("bmp");
            extra += 1;
            c
        };
    }
    table
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_table_matches_gpt2() {
        let table = bytes_to_unicode();
        assert_eq!(table[b'!' as usize], '!');
        assert_eq!(table[b' ' as usize], 'Ġ');
        assert_eq!(table[b'\n' as usize], 'Ċ');
        assert_eq!(table[0], 'Ā');
        // 0x7f–0xa0 与软连字符 0xad 不可打印：依次排到 U+0100 之后（GPT-2 同表）。
        assert_eq!(table[0xa0], 'ł');
        assert_eq!(table[0xad], 'Ń');
    }

    /// 期望 id 由 HF `tokenizers` 读同一份 `tokenizer.json` 跑出（`encode(add_special_tokens=False)`）；
    /// 需要真实权重：`BAOCUT_TEST_MODELS_DIR` 下的 `aufklarer/OmniVoice-MLX-int8`。
    #[test]
    #[ignore = "需要 BAOCUT_TEST_MODELS_DIR 下的 aufklarer/OmniVoice-MLX-int8"]
    fn real_tokenizer_matches_hf_tokenizers() {
        let Some(root) = std::env::var_os("BAOCUT_TEST_MODELS_DIR") else {
            println!("跳过：没设 BAOCUT_TEST_MODELS_DIR");
            return;
        };
        let path = Path::new(&root).join("aufklarer/OmniVoice-MLX-int8/tokenizer.json");
        if !path.is_file() {
            println!("跳过：没有 {}", path.display());
            return;
        }
        let tokenizer = Tokenizer::load(&path).unwrap();
        let golden: Value = serde_json::from_str(include_str!("testdata/tokenizer_golden.json")).unwrap();
        for case in golden.as_array().unwrap() {
            let text = case["text"].as_str().unwrap();
            let want: Vec<u32> = case["ids"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as u32).collect();
            assert_eq!(tokenizer.encode(text), want, "{text:?}");
        }
    }

    #[test]
    fn tiny_vocab_merges_by_rank_and_splits_added_tokens() {
        let json = serde_json::json!({
            "model": {
                "type": "BPE",
                "vocab": tiny_vocab(),
                "merges": [["a", "b"], ["ab", "c"], ["Ġ", "a"]]
            },
            "added_tokens": [
                {"id": 900, "content": "<|x|>"},
                {"id": 901, "content": "<|x|>y"}
            ]
        });
        let tokenizer = Tokenizer::from_json(&json).unwrap();
        let id = |s: &str| tiny_vocab()[s].as_u64().unwrap() as u32;
        assert_eq!(tokenizer.encode("abc"), vec![id("abc")]);
        assert_eq!(tokenizer.encode("abc a"), vec![id("abc"), id("Ġa")]);
        // added token 取最长匹配，不参与归一化与预切分。
        assert_eq!(tokenizer.encode("ab<|x|>yb<|x|>"), vec![id("ab"), 901, id("b"), 900]);
        // 数字逐个切开。
        assert_eq!(tokenizer.encode("12"), vec![id("1"), id("2")]);
    }

    fn tiny_vocab() -> serde_json::Map<String, Value> {
        let mut vocab = serde_json::Map::new();
        for (i, c) in bytes_to_unicode().iter().enumerate() {
            vocab.insert(c.to_string(), Value::from(i as u64));
        }
        for (i, s) in ["ab", "abc", "Ġa"].iter().enumerate() {
            vocab.insert(s.to_string(), Value::from(256 + i as u64));
        }
        vocab
    }
}
