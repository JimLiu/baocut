//! IndexTTS 2.5 多语言 tiktoken 分词器。
//!
//! 对照官方 `indextts/utils/tokenizer.py`（index-tts 9c87c46）与 mlx-indextts
//! `tokenizer_v25.py`：58 836 个 base64 字节 rank 之后依次排 1 673 个特殊 token，
//! 预切分正则与 tiktoken `_byte_pair_merge` 保持一致；编码时全部特殊 token 都
//! 允许出现在文本里（`allowed_special="all"`）。

use anyhow::{Context, Result, anyhow, bail};
use fancy_regex::Regex;
use std::collections::HashMap;
use std::path::Path;

/// 官方语言码表，下标即 `lang_embedding` 行号（106 个，嵌入表多留 1 行）。
pub const LANGUAGE_CODES: [&str; 106] = [
    "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv", "it", "id", "hi", "fi", "vi", "he", "uk",
    "el", "ms", "cs", "ro", "da", "hu", "ta", "no", "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn",
    "sr", "az", "sl", "kn", "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw", "gl", "mr", "pa", "si", "km", "sn",
    "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my",
    "bo", "tl", "mg", "as", "tt", "haw", "ln", "ha", "ba", "jw", "su", "yue", "minnan", "wuyu", "dialect", "zh/en", "en/zh", "common",
];

/// 公开 2.5 权重支持的语言（`config.yaml` 的 `supported_languages`）。
pub const RELEASED_LANGUAGES: [&str; 5] = ["zh", "en", "ja", "es", "ar"];

/// 特殊 token 只登记前 99 个语言码（官方 `num_languages=99`）。
const SPECIAL_LANGUAGE_COUNT: usize = 99;
const AUDIO_EVENTS: [&str; 11] = [
    "ASR",
    "AED",
    "SER",
    "Speech",
    "/Speech",
    "BGM",
    "/BGM",
    "Laughter",
    "/Laughter",
    "Applause",
    "/Applause",
];
const EMOTIONS: [&str; 4] = ["HAPPY", "SAD", "ANGRY", "NEUTRAL"];
const TASK_TOKENS: [&str; 6] = ["translate", "transcribe", "startoflm", "startofprev", "nospeech", "notimestamps"];
const TTS_VOCAL_TOKENS: [&str; 7] = ["TTS/B", "TTS/O", "TTS/Q", "TTS/A", "TTS/CO", "TTS/CL", "TTS/H"];
const PATTERN: &str = r"'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+";

/// 语言码在 `lang_embedding` 里的行号。
pub fn language_id(code: &str) -> Option<usize> {
    LANGUAGE_CODES.iter().position(|candidate| *candidate == code)
}

/// 官方特殊 token 顺序；第 i 个的 id 是 `rank 数 + i`。
pub fn special_token_strings() -> Vec<String> {
    let mut tokens = vec!["<|endoftext|>".to_string(), "<|startoftranscript|>".to_string()];
    tokens.extend(LANGUAGE_CODES[..SPECIAL_LANGUAGE_COUNT].iter().map(|code| format!("<|{code}|>")));
    tokens.extend(AUDIO_EVENTS.iter().map(|event| format!("<|{event}|>")));
    tokens.extend(EMOTIONS.iter().map(|emotion| format!("<|{emotion}|>")));
    tokens.extend(TASK_TOKENS.iter().map(|task| format!("<|{task}|>")));
    tokens.extend((1..=30).map(|index| format!("<|SPECIAL_TOKEN_{index}|>")));
    tokens.extend(TTS_VOCAL_TOKENS.iter().map(|token| format!("<|{token}|>")));
    tokens.extend((1..=13).map(|index| format!("<|TTS/SP{index:02}|>")));
    tokens.extend((0..1501).map(|index| format!("<|{:.2}|>", f64::from(index) * 0.02)));
    tokens
}

pub struct TiktokenTokenizer {
    ranks: HashMap<Vec<u8>, u32>,
    decoder: Vec<Vec<u8>>,
    special_ids: HashMap<String, u32>,
    special_tokens: Vec<String>,
    pattern: Regex,
}

impl TiktokenTokenizer {
    pub fn load(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path).with_context(|| format!("无法读取 IndexTTS 2.5 词表 {}", path.display()))?;
        Self::parse(&text).with_context(|| format!("解析 IndexTTS 2.5 词表 {} 失败", path.display()))
    }

    /// 解析 `.tiktoken` 文本：每行 `base64(bytes) rank`，rank 必须连续覆盖 0..n。
    pub fn parse(text: &str) -> Result<Self> {
        let mut entries: Vec<Option<Vec<u8>>> = Vec::new();
        for (line_no, line) in text.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let mut parts = line.split_whitespace();
            let (Some(token), Some(rank), None) = (parts.next(), parts.next(), parts.next()) else {
                bail!("第 {} 行不是 `base64 rank` 形式", line_no + 1);
            };
            let rank: usize = rank.parse().with_context(|| format!("第 {} 行的 rank 不是整数", line_no + 1))?;
            let bytes = decode_base64(token).with_context(|| format!("第 {} 行的 base64 无效", line_no + 1))?;
            if rank >= entries.len() {
                entries.resize(rank + 1, None);
            }
            if entries[rank].replace(bytes).is_some() {
                bail!("rank {rank} 重复出现");
            }
        }
        let pieces = entries
            .into_iter()
            .enumerate()
            .map(|(rank, entry)| entry.ok_or_else(|| anyhow!("词表缺少 rank {rank}")))
            .collect::<Result<Vec<_>>>()?;
        Self::from_pieces(pieces)
    }

    /// 由按 rank 排好的字节 piece 构造；要求 256 个单字节都在表里，保证任意文本可编码。
    pub fn from_pieces(pieces: Vec<Vec<u8>>) -> Result<Self> {
        let mut ranks = HashMap::with_capacity(pieces.len());
        for (rank, piece) in pieces.iter().enumerate() {
            // 官方 `*_char_del.tiktoken` 把删掉的字写成 `=`（空字节）占位保住 rank 连续；
            // tiktoken 合并永远产出不了空 piece，这一行只在解码时对应空串。
            if piece.is_empty() {
                continue;
            }
            if ranks.insert(piece.clone(), rank as u32).is_some() {
                bail!("词表含重复 piece（rank {rank}）");
            }
        }
        for byte in 0..=u8::MAX {
            if !ranks.contains_key(&[byte][..]) {
                bail!("词表缺少单字节 0x{byte:02X}");
            }
        }
        let special_tokens = special_token_strings();
        let base = pieces.len() as u32;
        let special_ids = special_tokens
            .iter()
            .enumerate()
            .map(|(index, token)| (token.clone(), base + index as u32))
            .collect();
        Ok(Self {
            ranks,
            decoder: pieces,
            special_ids,
            special_tokens,
            pattern: Regex::new(PATTERN).expect("静态预切分正则应能编译"),
        })
    }

    /// rank 数 + 特殊 token 数（公开 2.5 为 60 509）。
    pub fn vocab_size(&self) -> usize {
        self.decoder.len() + self.special_tokens.len()
    }

    pub fn special_id(&self, token: &str) -> Option<u32> {
        self.special_ids.get(token).copied()
    }

    /// `encode(text, allowed_special="all")`。
    pub fn encode(&self, text: &str) -> Vec<u32> {
        let mut out = Vec::new();
        let mut start = 0;
        let mut search = 0;
        // 特殊 token 都是 `<|X|>` 且 X 不含 `|`，所以每个 `<|` 只可能对应到下一个 `|>`。
        while let Some(relative) = text[search..].find("<|") {
            let open = search + relative;
            if let Some(close) = text[open + 2..].find("|>") {
                let end = open + 2 + close + 2;
                if let Some(id) = self.special_ids.get(&text[open..end]) {
                    self.encode_ordinary(&text[start..open], &mut out);
                    out.push(*id);
                    start = end;
                    search = end;
                    continue;
                }
            }
            search = open + 1;
        }
        self.encode_ordinary(&text[start..], &mut out);
        out
    }

    pub fn token_count(&self, text: &str) -> usize {
        self.encode(text).len()
    }

    pub fn decode(&self, ids: &[u32]) -> String {
        let base = self.decoder.len();
        let mut bytes = Vec::new();
        for &id in ids {
            let id = id as usize;
            if let Some(piece) = self.decoder.get(id) {
                bytes.extend_from_slice(piece);
            } else if let Some(special) = self.special_tokens.get(id - base) {
                bytes.extend_from_slice(special.as_bytes());
            }
        }
        String::from_utf8_lossy(&bytes).into_owned()
    }

    fn encode_ordinary(&self, text: &str, out: &mut Vec<u32>) {
        let mut cursor = 0;
        for found in self.pattern.find_iter(text) {
            let Ok(found) = found else { break };
            if found.start() > cursor {
                self.encode_piece(text[cursor..found.start()].as_bytes(), out);
            }
            self.encode_piece(found.as_str().as_bytes(), out);
            cursor = found.end();
        }
        if cursor < text.len() {
            self.encode_piece(text[cursor..].as_bytes(), out);
        }
    }

    fn encode_piece(&self, piece: &[u8], out: &mut Vec<u32>) {
        if piece.is_empty() {
            return;
        }
        if let Some(rank) = self.ranks.get(piece) {
            out.push(*rank);
            return;
        }
        let boundaries = byte_pair_merge(&self.ranks, piece);
        for window in boundaries.windows(2) {
            // 构造时已保证单字节都在表里，合并出的片段必然有 rank。
            out.push(self.ranks[&piece[window[0].0..window[1].0]]);
        }
    }
}

/// tiktoken `_byte_pair_merge`：反复合并 rank 最小的相邻片段，返回片段起点。
fn byte_pair_merge(ranks: &HashMap<Vec<u8>, u32>, piece: &[u8]) -> Vec<(usize, u32)> {
    let rank_of = |range: &[u8]| ranks.get(range).copied().unwrap_or(u32::MAX);
    let mut parts = Vec::with_capacity(piece.len() + 1);
    let mut min_rank = (u32::MAX, usize::MAX);
    for index in 0..piece.len() - 1 {
        let rank = rank_of(&piece[index..index + 2]);
        if rank < min_rank.0 {
            min_rank = (rank, index);
        }
        parts.push((index, rank));
    }
    parts.push((piece.len() - 1, u32::MAX));
    parts.push((piece.len(), u32::MAX));

    let pair_rank = |parts: &[(usize, u32)], index: usize| {
        if index + 3 < parts.len() {
            rank_of(&piece[parts[index].0..parts[index + 3].0])
        } else {
            u32::MAX
        }
    };
    while min_rank.0 != u32::MAX {
        let index = min_rank.1;
        if index > 0 {
            parts[index - 1].1 = pair_rank(&parts, index - 1);
        }
        parts[index].1 = pair_rank(&parts, index);
        parts.remove(index + 1);
        min_rank = (u32::MAX, usize::MAX);
        for (position, &(_, rank)) in parts[..parts.len() - 1].iter().enumerate() {
            if rank < min_rank.0 {
                min_rank = (rank, position);
            }
        }
    }
    parts
}

fn decode_base64(input: &str) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for &byte in input.as_bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            other => bail!("非法 base64 字符 {:?}", other as char),
        };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Ok(out)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn encode_base64(bytes: &[u8]) -> String {
        const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let value = chunk
                .iter()
                .enumerate()
                .fold(0u32, |acc, (index, byte)| acc | (u32::from(*byte) << (16 - 8 * index)));
            for index in 0..4 {
                if index <= chunk.len() {
                    out.push(ALPHABET[((value >> (18 - 6 * index)) & 63) as usize] as char);
                } else {
                    out.push('=');
                }
            }
        }
        out
    }

    /// 256 个单字节加上 `ab`、`abc` 两条合并的合成词表。
    pub(crate) fn synthetic_tokenizer() -> TiktokenTokenizer {
        let mut pieces: Vec<Vec<u8>> = (0..=u8::MAX).map(|byte| vec![byte]).collect();
        pieces.push(b"ab".to_vec());
        pieces.push(b"abc".to_vec());
        let text = pieces
            .iter()
            .enumerate()
            .map(|(rank, piece)| format!("{} {rank}", encode_base64(piece)))
            .collect::<Vec<_>>()
            .join("\n");
        TiktokenTokenizer::parse(&text).unwrap()
    }

    #[test]
    fn decodes_base64() {
        assert_eq!(decode_base64("SGVsbG8=").unwrap(), b"Hello");
        assert_eq!(decode_base64("YQ==").unwrap(), b"a");
        assert_eq!(decode_base64(&encode_base64("你好".as_bytes())).unwrap(), "你好".as_bytes());
        assert!(decode_base64("a*b").is_err());
    }

    #[test]
    fn special_tokens_follow_official_order() {
        let tokens = special_token_strings();
        assert_eq!(tokens.len(), 1673);
        assert_eq!(tokens[3], "<|zh|>");
        assert_eq!(tokens[2 + 98], "<|su|>");
        assert_eq!(tokens[2 + 99], "<|ASR|>");
        assert_eq!(tokens[122], "<|SPECIAL_TOKEN_1|>");
        assert_eq!(tokens[171], "<|TTS/SP13|>");
        assert_eq!(tokens[172], "<|0.00|>");
        assert_eq!(tokens[173], "<|0.02|>");
        assert_eq!(tokens[1672], "<|30.00|>");
        assert_eq!(language_id("zh"), Some(1));
        assert_eq!(language_id("es"), Some(3));
        assert_eq!(language_id("ja"), Some(7));
        assert_eq!(language_id("ar"), Some(13));
    }

    #[test]
    fn byte_pair_merges_and_specials() {
        let tokenizer = synthetic_tokenizer();
        assert_eq!(tokenizer.vocab_size(), 258 + 1673);
        assert_eq!(tokenizer.encode("abc"), vec![257]);
        assert_eq!(tokenizer.encode(" abc"), vec![32, 257]);
        assert_eq!(tokenizer.encode("abd"), vec![256, u32::from(b'd')]);
        let zh = tokenizer.special_id("<|zh|>").unwrap();
        assert_eq!(zh, 258 + 3);
        assert_eq!(tokenizer.encode("<|zh|> abc"), vec![zh, 32, 257]);
        // 不是特殊 token 的 `<|…|>` 按普通字节编码。
        assert_eq!(tokenizer.token_count("<|xx|>"), 6);
        let ids = tokenizer.encode("<|<|SPECIAL_TOKEN_2|>行<|SPECIAL_TOKEN_2|>");
        assert_eq!(tokenizer.decode(&ids), "<|<|SPECIAL_TOKEN_2|>行<|SPECIAL_TOKEN_2|>");
        assert_eq!(ids.iter().filter(|id| **id == 258 + 123).count(), 2);
    }

    #[test]
    fn empty_placeholder_rank_keeps_ids_but_never_encodes() {
        let mut lines: Vec<String> = (0..=u8::MAX).map(|byte| format!("{} {byte}", encode_base64(&[byte]))).collect();
        lines.push("= 256".to_string());
        lines.push(format!("{} 257", encode_base64(b"ab")));
        let tokenizer = TiktokenTokenizer::parse(&lines.join("\n")).unwrap();
        assert_eq!(tokenizer.vocab_size(), 258 + 1673);
        assert_eq!(tokenizer.encode("ab"), vec![257]);
        assert_eq!(tokenizer.decode(&[256, 257]), "ab");
    }

    #[test]
    fn rejects_incomplete_vocab() {
        assert!(TiktokenTokenizer::parse("YQ== 1\n").is_err());
        assert!(TiktokenTokenizer::from_pieces(vec![b"a".to_vec()]).is_err());
    }
}
