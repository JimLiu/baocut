//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/VoxCPM2TTS/VoxCPM2TTS.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! VoxCPM2 文本分词：`tokenizer.json` 的 Llama 式 SentencePiece-BPE（`Prepend ▁` +
//! 空格换 `▁`、无预分词、`byte_fallback`），再按官方 `mask_multichar_chinese_tokens`
//! 把「去掉 ▁ 后两个字以上且全是 CJK」的词片拆成单字 id。
//!
//! 对照 speech-swift `VoxCPM2TTS.swift::tokenize` / `expandVoxCPM2TokenizerToken`。
//! 不引 `tokenizers` crate：它在 Windows 上要 onig，且这里只需要这一条确定的路径。
//! 与 HF `tokenizers` 的差别只有一处：不识别文本里字面写出的特殊 token（`<|im_end|>` 等），
//! 合成文本不会带它们。

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result, bail};

const SPACE: char = '\u{2581}';

pub struct Tokenizer {
    vocab: HashMap<String, u32>,
    /// `(左, 右)` → (合并优先级, 合并结果 id)。
    merges: HashMap<(u32, u32), (u32, u32)>,
    /// 多字 CJK 词片 → 逐字 id。
    cjk_split: HashMap<u32, Vec<u32>>,
    byte_ids: [Option<u32>; 256],
    unk: Option<u32>,
}

impl Tokenizer {
    pub fn load(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path).with_context(|| format!("读取 VoxCPM2 分词表 {}", path.display()))?;
        let json: serde_json::Value = serde_json::from_str(&text).with_context(|| format!("解析 VoxCPM2 分词表 {}", path.display()))?;
        let model = &json["model"];
        if model["type"].as_str() != Some("BPE") {
            bail!("VoxCPM2 分词表不是 BPE：{:?}", model["type"]);
        }
        let vocab_json = model["vocab"].as_object().context("VoxCPM2 分词表缺少 model.vocab")?;
        let mut vocab = HashMap::with_capacity(vocab_json.len());
        for (token, id) in vocab_json {
            let id = id.as_u64().context("VoxCPM2 分词表 id 不是整数")?;
            vocab.insert(token.clone(), id as u32);
        }
        let mut pairs = Vec::new();
        for merge in model["merges"].as_array().context("VoxCPM2 分词表缺少 model.merges")? {
            let pair = match merge {
                serde_json::Value::String(s) => s.split_once(' ').map(|(a, b)| (a.to_string(), b.to_string())),
                serde_json::Value::Array(items) => match items.as_slice() {
                    [a, b] => Some((
                        a.as_str().unwrap_or_default().to_string(),
                        b.as_str().unwrap_or_default().to_string(),
                    )),
                    _ => None,
                },
                _ => None,
            };
            pairs.push(pair.context("VoxCPM2 分词表 merges 格式不认识")?);
        }
        let unk = model["unk_token"].as_str().and_then(|t| vocab.get(t).copied());
        Self::from_parts(vocab, pairs, unk)
    }

    pub fn from_parts(vocab: HashMap<String, u32>, merges: Vec<(String, String)>, unk: Option<u32>) -> Result<Self> {
        let mut merge_map = HashMap::with_capacity(merges.len());
        for (rank, (a, b)) in merges.iter().enumerate() {
            let (Some(&left), Some(&right)) = (vocab.get(a), vocab.get(b)) else {
                continue;
            };
            let Some(&merged) = vocab.get(&format!("{a}{b}")) else {
                continue;
            };
            merge_map.entry((left, right)).or_insert((rank as u32, merged));
        }
        let mut byte_ids = [None; 256];
        for (byte, slot) in byte_ids.iter_mut().enumerate() {
            *slot = vocab.get(&format!("<0x{byte:02X}>")).copied();
        }
        let mut cjk_split = HashMap::new();
        for (token, &id) in &vocab {
            if let Some(ids) = split_cjk(token, &vocab) {
                cjk_split.insert(id, ids);
            }
        }
        Ok(Self {
            vocab,
            merges: merge_map,
            cjk_split,
            byte_ids,
            unk,
        })
    }

    /// `tokenize` + 逐 token 转 id + 多字 CJK 拆字；不加 BOS（与官方一致）。
    pub fn encode(&self, text: &str) -> Vec<i32> {
        if text.is_empty() {
            return Vec::new();
        }
        let normalized: String = std::iter::once(SPACE)
            .chain(text.chars().map(|c| if c == ' ' { SPACE } else { c }))
            .collect();
        let mut symbols: Vec<u32> = Vec::with_capacity(normalized.len());
        let mut buf = [0u8; 4];
        for c in normalized.chars() {
            let piece = c.encode_utf8(&mut buf);
            if let Some(&id) = self.vocab.get(&*piece) {
                symbols.push(id);
            } else {
                symbols.extend(piece.bytes().filter_map(|byte| self.byte_ids[byte as usize].or(self.unk)));
            }
        }
        // 每轮合并优先级最高（rank 最小）、同级取最左的一对，直到没有可合并的相邻对。
        loop {
            let mut best: Option<(u32, usize, u32)> = None;
            for i in 0..symbols.len().saturating_sub(1) {
                if let Some(&(rank, merged)) = self.merges.get(&(symbols[i], symbols[i + 1]))
                    && best.is_none_or(|(r, _, _)| rank < r)
                {
                    best = Some((rank, i, merged));
                }
            }
            let Some((_, i, merged)) = best else { break };
            symbols[i] = merged;
            symbols.remove(i + 1);
        }
        let mut ids = Vec::with_capacity(symbols.len());
        for id in symbols {
            match self.cjk_split.get(&id) {
                Some(chars) => ids.extend(chars.iter().map(|&c| c as i32)),
                None => ids.push(id as i32),
            }
        }
        ids
    }
}

fn is_cjk(c: char) -> bool {
    matches!(
        c as u32,
        0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0xF900..=0xFAFF | 0x20000..=0x2A6DF
    )
}

/// 官方 `mask_multichar_chinese_tokens`：去掉 `▁` 后至少两个字、全部是 CJK 且每个字都在词表里。
fn split_cjk(token: &str, vocab: &HashMap<String, u32>) -> Option<Vec<u32>> {
    let clean: Vec<char> = token.chars().filter(|&c| c != SPACE).collect();
    if clean.len() < 2 || !clean.iter().all(|&c| is_cjk(c)) {
        return None;
    }
    clean.iter().map(|c| vocab.get(&c.to_string()).copied()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn toy() -> Tokenizer {
        let tokens = [
            "<unk>",
            "\u{2581}",
            "a",
            "b",
            "c",
            "ab",
            "\u{2581}ab",
            "你",
            "好",
            "你好",
            "<0xE4>",
            "<0xB8>",
            "<0x80>",
            "abc",
        ];
        let vocab = tokens.iter().enumerate().map(|(i, t)| (t.to_string(), i as u32)).collect();
        let merges = [("a", "b"), ("\u{2581}", "ab"), ("你", "好"), ("ab", "c")]
            .iter()
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect();
        Tokenizer::from_parts(vocab, merges, Some(0)).unwrap()
    }

    #[test]
    fn merges_follow_rank_then_leftmost_and_split_multichar_cjk() {
        let t = toy();
        // "ab c" → ▁ab ▁ c；"abc" 里 (▁,ab) 的优先级高于 (ab,c)。
        assert_eq!(t.encode("ab c"), vec![6, 1, 4]);
        assert_eq!(t.encode("abc"), vec![6, 4]);
        // 不在词表、也没有字节片的 x 落成 <unk>，后面的 ab 仍能与 c 合并。
        assert_eq!(t.encode("xabc"), vec![1, 0, 13]);
        // 「你好」合成一片后按官方规则拆回两个字。
        assert_eq!(t.encode("你好"), vec![1, 7, 8]);
        // 不在词表的「一」按 UTF-8 字节走 byte fallback。
        assert_eq!(t.encode("\u{4E00}"), vec![1, 10, 11, 12]);
        assert!(t.encode("").is_empty());
    }

    /// 真分词表：与 HF `tokenizers` 0.22 的 `encode(add_special_tokens=False)` 结果
    /// 再做官方拆字后的 id 对拍（样例由 `uv run --with tokenizers` 生成）。
    #[test]
    #[ignore = "需要 BAOCUT_TEST_MODELS_DIR 下的 aufklarer/VoxCPM2-MLX-int8"]
    fn real_tokenizer_matches_hf_reference_ids() {
        let Some(root) = std::env::var_os("BAOCUT_TEST_MODELS_DIR") else {
            println!("跳过：没设 BAOCUT_TEST_MODELS_DIR");
            return;
        };
        let path = Path::new(&root).join("aufklarer/VoxCPM2-MLX-int8/tokenizer.json");
        if !path.is_file() {
            println!("跳过：没有 {}", path.display());
            return;
        }
        let t = Tokenizer::load(&path).unwrap();
        let cases: [(&str, &[i32]); 8] = [
            ("你好，世界！", &[59320, 59496, 59495, 65, 59792, 59868, 67]),
            ("Hello world.", &[21045, 2809, 72]),
            (
                "(温柔的女声)今天天气真好。",
                &[
                    1426, 60020, 60917, 59350, 59694, 60068, 59347, 59856, 59534, 59534, 59754, 59704, 59495, 66,
                ],
            ),
            ("  leading and trailing  ", &[1345, 5775, 1384, 45250, 1345]),
            (
                "GPT-4o 在 2024 年发布，价格 $20/月。",
                &[
                    1527, 7809, 63, 59370, 59326, 11085, 59320, 59349, 59344, 59349, 59370, 23037, 59439, 59915, 65, 59706, 59756, 1538,
                    59349, 59344, 59359, 59436, 66,
                ],
            ),
            (
                "emoji 😀 and 𠀀 rare",
                &[2051, 24199, 59320, 70571, 1384, 59320, 1329, 1249, 1217, 1217, 8507],
            ),
            (
                "It's a test, isn't it? Yes!",
                &[1826, 59361, 59328, 1348, 2076, 59342, 5957, 59361, 59323, 1476, 74, 11468, 73],
            ),
            ("中英mixed文本abc", &[14990, 59943, 51465, 59468, 59416, 18985]),
        ];
        for (text, want) in cases {
            assert_eq!(t.encode(text), want, "{text}");
        }
    }
}
