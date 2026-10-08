//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/WhisperASR/WhisperGenerationConfig.swift / Sources/WhisperASR/WhisperByteLevelTokenizer.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Whisper 解码的纯逻辑：分词器（byte-level BPE 的解码与提示编码）、`generation_config.json` 里的特殊 token 与
//! 语言表、识别提示 → 前缀 token 的规则、贪心解码的抑制规则与重复词保护。
//!
//! 与推理框架无关：MLX 版 Whisper（`backend::mlx::whisper`）用它决定解码前缀、每步哪些 token 不能出、
//! 何时停。规则与 BaoCut 早先 Swift 版 `WhisperCoreMLRuntime` 及 v2 `bcut-speech` 的 Whisper 逐项一致。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail};
use serde_json::Value;

use crate::speech::tokenizer::Qwen3Tokenizer;

/// 一个解码窗的采样数：16 kHz 下 30 秒。更长的音频按它切成独立的窗。
pub const WINDOW_SAMPLES: usize = 480_000;
/// 每个窗「提示 + 任务前缀 + 生成」共用的 token 预算（large-v3 的 `n_text_ctx` 是 448，这里沿用 WhisperKit
/// 导出的 224，与早先 Core ML 版同一口径）。
pub const DECODER_TOKEN_BUDGET: usize = 224;
/// 同一个词连续出现超过这么多次就停：贪心解码陷进复读时及早收手。
const MAX_REPEATED_WORD_RUN: usize = 2;
/// initial prompt 最多占 token 预算的一半：预算就是这一段音频「提示 + 生成」的全部，提示写满了就没地方生成了。
/// 超出的从**前面**截，留最靠近音频的那一截——与 whisper.cpp 的 `max_prompt_ctx` 同一取舍。
const PROMPT_BUDGET_SHARE: usize = 2;

/// `generation_config.json` 里解码要用的特殊 token 与语言表。
#[derive(Debug)]
pub struct GenerationConfig {
    pub(crate) start_of_transcript: i32,
    pub(crate) end_token: i32,
    pub(crate) english_token: i32,
    pub(crate) transcribe_token: i32,
    pub(crate) no_timestamps: i32,
    pub(crate) special_token_begin: i32,
    pub(crate) begin_suppress_tokens: HashSet<i32>,
    pub(crate) suppress_tokens: HashSet<i32>,
    pub(crate) language_tokens_by_code: HashMap<String, i32>,
    pub(crate) language_codes_by_token: HashMap<i32, String>,
    pub(crate) language_token_set: HashSet<i32>,
}

impl GenerationConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let raw: Value = serde_json::from_slice(&fs::read(path).with_context(|| format!("读取 {}", path.display()))?)
            .context("解析 Whisper generation_config.json")?;
        Self::from_json(&raw)
    }

    pub fn from_json(raw: &Value) -> Result<Self> {
        let object = raw.as_object().context("Whisper generation_config.json 顶层应为对象")?;
        let mut languages = HashMap::new();
        if let Some(entries) = object.get("lang_to_id").and_then(Value::as_object) {
            for (token, id) in entries {
                if let Some(id) = id.as_i64() {
                    languages.insert(token.trim_start_matches("<|").trim_end_matches("|>").to_lowercase(), id as i32);
                }
            }
        }
        let inverse = languages
            .iter()
            .map(|(code, token)| (*token, code.clone()))
            .collect::<HashMap<_, _>>();
        let end_token = json_i32(object.get("eos_token_id")).unwrap_or(50_257);
        let transcribe = object
            .get("task_to_id")
            .and_then(Value::as_object)
            .and_then(|tasks| tasks.get("transcribe"))
            .and_then(Value::as_i64)
            .map(|value| value as i32)
            .unwrap_or(50_360);
        let begin_suppress_tokens =
            json_i32_array(object.get("begin_suppress_tokens")).unwrap_or_else(|| [220, end_token].into_iter().collect());
        Ok(Self {
            start_of_transcript: json_i32(object.get("decoder_start_token_id")).unwrap_or(50_258),
            end_token,
            english_token: languages.get("en").copied().unwrap_or(50_259),
            transcribe_token: transcribe,
            no_timestamps: json_i32(object.get("no_timestamps_token_id")).unwrap_or(50_364),
            special_token_begin: end_token,
            begin_suppress_tokens,
            // 与 Swift/WhisperKit greedy 默认一致：忽略导出的宽泛 suppress_tokens。
            suppress_tokens: HashSet::new(),
            language_token_set: languages.values().copied().collect(),
            language_tokens_by_code: languages,
            language_codes_by_token: inverse,
        })
    }

    pub fn start_of_transcript(&self) -> i32 {
        self.start_of_transcript
    }

    pub fn end_token(&self) -> i32 {
        self.end_token
    }

    pub fn english_token(&self) -> i32 {
        self.english_token
    }

    pub fn no_timestamps(&self) -> i32 {
        self.no_timestamps
    }

    pub fn special_token_begin(&self) -> i32 {
        self.special_token_begin
    }

    /// 语言检测时只在这些 token 里取最大。
    pub fn is_language_token(&self, token: i32) -> bool {
        self.language_token_set.contains(&token)
    }

    /// 语言提示（`zh`、`zh-Hant`、`EN`）→ 语言 token；认不出返回 `None`，交给语言检测。
    pub fn language_token(&self, hint: &str) -> Option<i32> {
        let code = hint
            .trim()
            .to_lowercase()
            .split_once('-')
            .map(|(head, _)| head.to_owned())
            .unwrap_or_else(|| hint.trim().to_lowercase());
        self.language_tokens_by_code.get(&code).copied()
    }

    pub fn language_code(&self, token: i32) -> Option<String> {
        self.language_codes_by_token.get(&token).cloned()
    }

    /// 解码任务前缀：`<|startoftranscript|><|lang|><|transcribe|>`。**不是** initial prompt——那一段在它前面，
    /// 见 [`prompt_tokens`]；`<|notimestamps|>` 在它后面，作为第一步解码的输入。
    pub fn task_tokens(&self, language_token: i32) -> [i32; 3] {
        [self.start_of_transcript, language_token, self.transcribe_token]
    }

    /// 贪心解码的这一步要不要跳过 `token`：`<|endoftext|>` 只在第一个 token 且被 begin_suppress 时跳过；其余特殊
    /// token（时间戳、语言、任务）一律不出；第一个 token 不出 begin_suppress 里的（空格），suppress 里的总是不出。
    pub fn should_suppress(&self, token: i32, generated_count: usize) -> bool {
        if token == self.end_token {
            return generated_count == 0 && self.begin_suppress_tokens.contains(&token);
        }
        if token >= self.special_token_begin {
            return true;
        }
        (generated_count == 0 && self.begin_suppress_tokens.contains(&token)) || self.suppress_tokens.contains(&token)
    }
}

/// Whisper 的 `tokenizer.json`（`openai/whisper-large-v3`）：解码 token、给识别提示编码。
#[derive(Debug)]
pub struct WhisperTokenizer {
    pub(crate) id_to_token: HashMap<i32, String>,
    pub(crate) special_ids: HashSet<i32>,
    pub(crate) byte_decoder: HashMap<char, u8>,
    /// 识别提示的开头标记。旧导出的 `tokenizer.json` 里可能没有，`None` 就等于这份权重没有提示通道。
    pub(crate) start_of_prev: Option<i32>,
    /// 编码方向：Whisper 与 Qwen3 同是 GPT-2 byte-level BPE，借共享的那只做编码，不在这里再实现一遍 merge 循环
    /// （解码仍用上面的 `id_to_token`，因为特殊 token 的处置两边不同）。
    pub(crate) encoder: Qwen3Tokenizer,
}

impl WhisperTokenizer {
    pub fn load(path: &Path) -> Result<Self> {
        let raw: Value = serde_json::from_slice(&fs::read(path).with_context(|| format!("读取 {}", path.display()))?)
            .context("解析 Whisper tokenizer.json")?;
        let mut id_to_token = HashMap::new();
        if let Some(vocabulary) = raw.get("model").and_then(|model| model.get("vocab")).and_then(Value::as_object) {
            for (token, id) in vocabulary {
                if let Some(id) = id.as_i64() {
                    id_to_token.insert(id as i32, token.clone());
                }
            }
        }
        let mut special_ids = HashSet::new();
        if let Some(added) = raw.get("added_tokens").and_then(Value::as_array) {
            for token in added {
                let Some(id) = token.get("id").and_then(Value::as_i64) else {
                    continue;
                };
                if let Some(content) = token.get("content").and_then(Value::as_str) {
                    id_to_token.insert(id as i32, content.to_owned());
                }
                if token.get("special").and_then(Value::as_bool) == Some(true) {
                    special_ids.insert(id as i32);
                }
            }
        }
        if id_to_token.is_empty() {
            bail!("Whisper tokenizer.json 未包含 model.vocab");
        }
        // `model.merges` 既可能是 ["a b", …]（旧格式），也可能是 [["a","b"], …]。
        let merges = raw
            .get("model")
            .and_then(|model| model.get("merges"))
            .and_then(Value::as_array)
            .map(|rows| rows.iter().filter_map(merge_pair).collect::<Vec<_>>())
            .unwrap_or_default();
        let start_of_prev = id_to_token
            .iter()
            .find(|(_, token)| token.as_str() == "<|startofprev|>")
            .map(|(id, _)| *id);
        let encoder = Qwen3Tokenizer::from_vocab_and_merges(
            id_to_token.iter().map(|(id, token)| (token.clone(), *id)).collect::<Vec<_>>(),
            merges,
        );
        Ok(Self {
            id_to_token,
            special_ids,
            byte_decoder: make_byte_decoder(),
            start_of_prev,
            encoder,
        })
    }

    /// 只给识别提示用：一段普通文本 → token。特殊 token 不参与（`<|…|>` 的字面量在 byte-level BPE 下会被拆成
    /// 普通片段，拿不到特殊 id，这正是想要的）。
    pub fn encode(&self, text: &str) -> Vec<i32> {
        self.encoder.encode(text)
    }

    pub fn decode(&self, ids: &[i32]) -> String {
        let mut bytes = Vec::with_capacity(ids.len() * 4);
        for id in ids {
            let Some(token) = self.id_to_token.get(id) else {
                continue;
            };
            if self.special_ids.contains(id) || token.is_empty() {
                continue;
            }
            for character in token.chars() {
                if let Some(byte) = self.byte_decoder.get(&character) {
                    bytes.push(*byte);
                } else {
                    let mut encoded = [0; 4];
                    bytes.extend_from_slice(character.encode_utf8(&mut encoded).as_bytes());
                }
            }
        }
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

/// 识别提示 → 解码器前缀里提示那一段（`<|startofprev|>` + 普通文本 token）。Whisper 的 initial prompt 是
/// `<|startofprev|>` 加一段**普通文本** token；缺这只特殊 token（旧导出）就等于没有通道，如实返回空而不是把文本当
/// 转录前缀塞进去（那会被模型当成已经识别出的内容抄出来）。
///
/// `token_budget` 是每个窗「提示 + 生成」共用的 token 预算；提示最多占一半，再让出任务前缀与第一步输入
/// （`<|notimestamps|>`）的位置。超出的从前面截：截尾会把话说到一半，截头只丢最早的几条术语。
pub fn prompt_tokens(tokenizer: &WhisperTokenizer, generation: &GenerationConfig, prompt: Option<&str>, token_budget: usize) -> Vec<i32> {
    let Some(text) = prompt.map(str::trim).filter(|text| !text.is_empty()) else {
        return Vec::new();
    };
    let Some(start_of_prev) = tokenizer.start_of_prev else {
        eprintln!("whisper: 词表缺 <|startofprev|>，识别提示已忽略");
        return Vec::new();
    };
    let mut tokens = tokenizer.encode(text);
    let task_prefix = generation.task_tokens(generation.english_token).len();
    let budget = (token_budget / PROMPT_BUDGET_SHARE).saturating_sub(task_prefix + 1);
    if tokens.len() > budget {
        tokens.drain(..tokens.len() - budget);
    }
    if tokens.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(tokens.len() + 1);
    out.push(start_of_prev);
    out.extend(tokens);
    out
}

/// 在 `logits` 里取不被 `should_skip` 跳过、且不是 NaN 的最大值的下标。
pub fn argmax_where(logits: &[f32], should_skip: impl Fn(usize) -> bool) -> Option<i32> {
    let mut best = None;
    let mut best_value = f32::NEG_INFINITY;
    for (token, value) in logits.iter().copied().enumerate() {
        if should_skip(token) {
            continue;
        }
        if !value.is_nan() && value > best_value {
            best_value = value;
            best = Some(token as i32);
        }
    }
    best
}

/// 贪心解码陷进复读的保护：最后一个词连续出现超过 [`MAX_REPEATED_WORD_RUN`] 次就停。
pub fn should_stop_for_repeated_words(tokenizer: &WhisperTokenizer, tokens: &[i32]) -> bool {
    if tokens.len() <= MAX_REPEATED_WORD_RUN {
        return false;
    }
    let words = normalized_words(&tokenizer.decode(tokens));
    let Some(last) = words.last() else {
        return false;
    };
    words.iter().rev().take_while(|word| *word == last).count() > MAX_REPEATED_WORD_RUN
}

fn normalized_words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect()
}

/// tokenizers 的 `model.merges` 一条：`"a b"` 或 `["a", "b"]`。
fn merge_pair(row: &Value) -> Option<(String, String)> {
    if let Some(text) = row.as_str() {
        let (first, second) = text.split_once(' ')?;
        return Some((first.to_owned(), second.to_owned()));
    }
    let pair = row.as_array()?;
    Some((pair.first()?.as_str()?.to_owned(), pair.get(1)?.as_str()?.to_owned()))
}

/// GPT-2 byte-level BPE 的「可见字符 → 字节」表。
fn make_byte_decoder() -> HashMap<char, u8> {
    let mut bytes = (33_u16..=126).chain(161..=172).chain(174..=255).collect::<Vec<_>>();
    let mut characters = bytes.clone();
    let mut next = 0_u16;
    for byte in 0_u16..=255 {
        if !bytes.contains(&byte) {
            bytes.push(byte);
            characters.push(256 + next);
            next += 1;
        }
    }
    bytes
        .into_iter()
        .zip(characters)
        .filter_map(|(byte, scalar)| char::from_u32(scalar as u32).map(|c| (c, byte as u8)))
        .collect()
}

fn json_i32(value: Option<&Value>) -> Option<i32> {
    value.and_then(Value::as_i64).map(|number| number as i32)
}

fn json_i32_array(value: Option<&Value>) -> Option<HashSet<i32>> {
    value?
        .as_array()
        .map(|values| values.iter().filter_map(|value| json_i32(Some(value))).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_decoder_round_trips_all_bytes() {
        let decoder = make_byte_decoder();
        assert_eq!(decoder.len(), 256);
        let mut values = decoder.values().copied().collect::<Vec<_>>();
        values.sort_unstable();
        assert_eq!(values, (0..=255).collect::<Vec<_>>());
    }

    /// 只填解码需要的那几格；编码器与 `<|startofprev|>` 各测各的。
    fn decode_only_tokenizer(id_to_token: HashMap<i32, String>) -> WhisperTokenizer {
        WhisperTokenizer {
            id_to_token,
            special_ids: HashSet::new(),
            byte_decoder: make_byte_decoder(),
            start_of_prev: None,
            encoder: Qwen3Tokenizer::default(),
        }
    }

    fn generation_config() -> GenerationConfig {
        GenerationConfig::from_json(&serde_json::json!({
            "decoder_start_token_id": 50_258,
            "eos_token_id": 50_257,
            "no_timestamps_token_id": 50_364,
            "begin_suppress_tokens": [220, 50_257],
            "suppress_tokens": [1, 2, 7],
            "lang_to_id": { "<|en|>": 50_259, "<|zh|>": 50_260 },
            "task_to_id": { "transcribe": 50_360, "translate": 50_359 },
        }))
        .unwrap()
    }

    #[test]
    fn repeated_word_guard_stops_third_consecutive_word() {
        let tokenizer = decode_only_tokenizer([(1, "Ġtest".to_owned())].into_iter().collect());
        assert!(!should_stop_for_repeated_words(&tokenizer, &[1, 1]));
        assert!(should_stop_for_repeated_words(&tokenizer, &[1, 1, 1]));
    }

    #[test]
    fn a_merge_row_reads_both_export_shapes() {
        assert_eq!(merge_pair(&serde_json::json!("Ġth e")), Some(("Ġth".to_owned(), "e".to_owned())));
        assert_eq!(
            merge_pair(&serde_json::json!(["Ġth", "e"])),
            Some(("Ġth".to_owned(), "e".to_owned()))
        );
        assert_eq!(merge_pair(&serde_json::json!("Ġthe")), None);
    }

    #[test]
    fn a_prompt_becomes_startofprev_plus_bpe_tokens() {
        // 迷你词表：单字节 token + 一条 merge，足够看出「编码走的是 BPE，提示前面挂 `<|startofprev|>`」。
        let vocab = vec![("a".to_owned(), 10), ("b".to_owned(), 11), ("ab".to_owned(), 12)];
        let merges = vec![("a".to_owned(), "b".to_owned())];
        let tokenizer = WhisperTokenizer {
            id_to_token: HashMap::new(),
            special_ids: HashSet::new(),
            byte_decoder: make_byte_decoder(),
            start_of_prev: Some(50_362),
            encoder: Qwen3Tokenizer::from_vocab_and_merges(vocab, merges),
        };
        assert_eq!(tokenizer.encode("ab"), vec![12]);
        let generation = generation_config();
        assert_eq!(
            prompt_tokens(&tokenizer, &generation, Some(" ab "), DECODER_TOKEN_BUDGET),
            vec![50_362, 12]
        );
        assert!(prompt_tokens(&tokenizer, &generation, Some("  "), DECODER_TOKEN_BUDGET).is_empty());
        assert!(prompt_tokens(&tokenizer, &generation, None, DECODER_TOKEN_BUDGET).is_empty());
        // 预算 224：提示最多 224 / 2 − 4 = 108 个普通 token，从前面截。
        let long = "ab".repeat(200);
        let tokens = prompt_tokens(&tokenizer, &generation, Some(&long), DECODER_TOKEN_BUDGET);
        assert_eq!(tokens.len(), 1 + 108);
        // 没有 `<|startofprev|>` 就没有提示通道。
        let without = decode_only_tokenizer(HashMap::new());
        assert!(prompt_tokens(&without, &generation, Some("ab"), DECODER_TOKEN_BUDGET).is_empty());
    }

    #[test]
    fn language_hint_accepts_bcp47_region() {
        let generation = generation_config();
        assert_eq!(generation.language_token("zh-Hant"), Some(50_260));
        assert_eq!(generation.language_token(" EN "), Some(50_259));
        assert_eq!(generation.language_token("xx"), None);
        assert_eq!(generation.language_code(50_260).as_deref(), Some("zh"));
        assert_eq!(generation.task_tokens(50_260), [50_258, 50_260, 50_360]);
        assert!(generation.is_language_token(50_259));
        assert!(!generation.is_language_token(50_258));
    }

    #[test]
    fn suppression_matches_the_greedy_defaults() {
        let generation = generation_config();
        // 导出的 suppress_tokens 被有意忽略。
        assert!(!generation.should_suppress(7, 1));
        // 第一个 token 不能是空格，也不能直接结束；之后可以。
        assert!(generation.should_suppress(220, 0));
        assert!(!generation.should_suppress(220, 1));
        assert!(generation.should_suppress(50_257, 0));
        assert!(!generation.should_suppress(50_257, 1));
        // 其余特殊 token（语言、任务、时间戳）一律不出。
        for token in [50_258, 50_259, 50_360, 50_364, 50_365] {
            assert!(generation.should_suppress(token, 3), "{token}");
        }
    }

    #[test]
    fn argmax_skips_suppressed_and_nan() {
        assert_eq!(argmax_where(&[0.1, f32::NAN, 0.3, 0.9], |token| token == 3), Some(2));
        assert_eq!(argmax_where(&[0.1], |_| true), None);
    }
}
