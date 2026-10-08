//! IndexTTS 2.5 文本前端：语言判定 → 字符清洗 → 文本规整 → 大小写 → 发音标注 →
//! 日语分词 → 特殊 token 大写 → 按 GPT 位置预算切段 → 带语言前缀编码。
//!
//! 顺序对照官方 `indextts/infer_v2_5.py`（index-tts 9c87c46）第 700–719 行，
//! 自动语言判定与切段对照 mlx-indextts `text_frontend_v25.py`。两处已知差异：
//! 日语官方用 MeCab 形态素分词后以空格拼接，这里按字形类别切换插空格近似
//! （汉字接平假名的送假名 / 助词不拆开，`<|…|>` 片段保持整体）；西语官方的
//! NeMo 规整在未装 NeMo 时本来就原样透传，这里同样透传。

use super::tiktoken::{RELEASED_LANGUAGES, TiktokenTokenizer, language_id};
use crate::synthesize::index_tts2::normalizer::TextNormalizer;
use crate::synthesize::index_tts2::tokenizer::{PUNCTUATION_REWRITES, rewrite_punctuation};
use anyhow::{Result, bail};
use fancy_regex::{Captures, Regex};
use std::sync::LazyLock;

/// `gpt.text_pos_embedding` 的行数（`max_text_tokens + 2`）。
pub const TEXT_POSITION_CAPACITY: usize = 602;
/// 官方 `max_text_tokens_per_segment` 缺省值。
pub const DEFAULT_MAX_SEGMENT_TOKENS: usize = 120;
/// 每段编码末尾追加的停止 id（`F.pad(toks, (0, 1), value=1)`）。
pub const STOP_TEXT_TOKEN: u32 = 1;

static PRONUNCIATION_PATTERN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<([^|>\n]+)\|([^>\n]+)>").expect("静态正则"));
static PROTECTED_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<\|SPECIAL_TOKEN_\d+\|>.*?<\|SPECIAL_TOKEN_\d+\|>").expect("静态正则"));
static SPECIAL_TOKEN_PATTERN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<\|([^|]+)\|>").expect("静态正则"));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LanguageResolution {
    pub language: &'static str,
    /// 只有拉丁字母、没有西语特征字符时判成英语，调用方应提示可能是其他拉丁语种。
    pub ambiguous: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedText {
    pub language: &'static str,
    pub language_id: usize,
    pub language_ambiguous: bool,
    pub normalized_text: String,
    pub segments: Vec<String>,
    /// 每段 `encode("<|lang|> " + 段落) + [1]`。
    pub token_ids: Vec<Vec<u32>>,
}

/// 把显式语言参数归一到公开 2.5 支持的五种语言码。
pub fn normalize_language(requested: &str) -> Result<&'static str> {
    let lowered = requested.trim().to_lowercase().replace('_', "-");
    let aliased = match lowered.as_str() {
        "chinese" | "mandarin" | "cn" | "zhen" | "zh/en" => "zh",
        "english" => "en",
        "japanese" | "jp" => "ja",
        "spanish" | "castilian" | "español" | "espanol" => "es",
        "arabic" => "ar",
        other => other.split('-').next().unwrap_or(other),
    };
    match RELEASED_LANGUAGES.iter().find(|candidate| **candidate == aliased) {
        Some(code) => Ok(*code),
        None => bail!(
            "IndexTTS 2.5 不支持语言 `{}`，可选 {}",
            requested.trim(),
            RELEASED_LANGUAGES.join(" / ")
        ),
    }
}

/// 显式语言优先（`auto` 视同未指定）；否则按字形自动判定。
pub fn resolve_language(text: &str, requested: Option<&str>) -> Result<LanguageResolution> {
    if let Some(requested) = requested.map(str::trim)
        && !requested.is_empty()
        && !requested.eq_ignore_ascii_case("auto")
    {
        return Ok(LanguageResolution {
            language: normalize_language(requested)?,
            ambiguous: false,
        });
    }
    if text.trim().is_empty() {
        bail!("文本为空，无法判定 IndexTTS 2.5 的语言");
    }
    let has = |predicate: fn(char) -> bool| text.chars().any(predicate);
    let arabic = has(is_arabic);
    let cjk = has(is_kana) || has(is_han);
    if arabic && cjk {
        bail!("文本同时含阿拉伯文与中日文字，请显式指定语言");
    }
    let (language, ambiguous) = if arabic {
        ("ar", false)
    } else if has(is_kana) {
        ("ja", false)
    } else if has(is_han) {
        ("zh", false)
    } else if has(|c| "áéíóúüñ¿¡ÁÉÍÓÚÜÑ".contains(c)) {
        ("es", false)
    } else if has(|c| c.is_ascii_alphabetic()) {
        ("en", true)
    } else {
        bail!("无法判定 IndexTTS 2.5 的语言，请从 {} 中指定", RELEASED_LANGUAGES.join(" / "));
    };
    Ok(LanguageResolution { language, ambiguous })
}

/// 官方送入前端前的 `clean_pattern`：`char_rep_map` 按字典序逐位置首个命中。
pub fn clean_characters(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut rest = text;
    'outer: while let Some(c) = rest.chars().next() {
        for (from, to) in PUNCTUATION_REWRITES {
            if let Some(after) = rest.strip_prefix(from) {
                output.push_str(to);
                rest = after;
                continue 'outer;
            }
        }
        output.push(c);
        rest = &rest[c.len_utf8()..];
    }
    output
}

/// 中英文走 2.0 同款数字规整与标点改写，`<字|读音>` 标注先换成纯字母占位符
/// 保护起来（官方 `_protect_pronunciation_annotations`），其余语言原样返回。
pub fn normalize_text(text: &str, language: &str) -> String {
    if !matches!(language, "zh" | "en") {
        return text.to_string();
    }
    let mut placeholders: Vec<(String, String)> = Vec::new();
    let protected = replace_captures(&PRONUNCIATION_PATTERN, text, |captures| {
        let key = format!("PRONPLACEHOLDER{}PRONPLACEHOLDER", placeholder_tag(placeholders.len()));
        placeholders.push((key.clone(), captures[0].to_string()));
        key
    });
    let mut normalized = rewrite_punctuation(&TextNormalizer::normalize(&protected));
    for (key, original) in &placeholders {
        normalized = normalized.replace(key, original);
    }
    normalized
}

/// `<字|读音>` → 特殊 token 包裹的大写读音；纯假名读音直接以空格隔开写回。
pub fn apply_pronunciation_annotations(text: &str) -> String {
    replace_captures(&PRONUNCIATION_PATTERN, text, |captures| {
        let pronunciation = captures[2].to_uppercase();
        if is_single_kana_script(&pronunciation) {
            return format!(" {pronunciation} ");
        }
        let marker = if captures[1].chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c)) {
            "SPECIAL_TOKEN_2"
        } else {
            "SPECIAL_TOKEN_1"
        };
        format!("<|{marker}|>{pronunciation}<|{marker}|>")
    })
}

/// 近似官方 `process_ja_text`（`g2p_ratio=0`，只分词不换读音）：保留原有空格，
/// 其余片段在字形类别切换处插空格，发音标注片段整体当作一个词。
pub fn segment_japanese(text: &str) -> String {
    // 类别为 None 的项是原文空格。
    let mut items: Vec<(Option<Script>, String)> = Vec::new();
    let mut cursor = 0;
    for found in PROTECTED_PATTERN.find_iter(text) {
        let Ok(found) = found else { break };
        push_japanese_plain(&text[cursor..found.start()], &mut items);
        items.push((Some(Script::Protected), found.as_str().to_string()));
        cursor = found.end();
    }
    push_japanese_plain(&text[cursor..], &mut items);
    let mut output = String::with_capacity(text.len() * 2);
    let mut previous_word = false;
    for (script, piece) in items {
        let word = script.is_some();
        if word && previous_word {
            output.push(' ');
        }
        output.push_str(&piece);
        previous_word = word;
    }
    output
}

/// `<|x|>` 里的名字转大写。
pub fn uppercase_special_tokens(text: &str) -> String {
    replace_captures(&SPECIAL_TOKEN_PATTERN, text, |captures| {
        format!("<|{}|>", captures[1].to_uppercase())
    })
}

/// 官方 `split_text_by_tokens`：整段不超预算就不切；否则发音标注片段保持整体，
/// 其余在标点后断开、超长片段逐字贪心切，再贪心合并回不超预算的段落。
pub fn split_text_by_tokens(text: &str, count: &dyn Fn(&str) -> usize, max_tokens: usize, prefix: &str, capacity: usize) -> Vec<String> {
    let budget = max_tokens.min(capacity.saturating_sub(2)).saturating_sub(count(prefix)).max(1);
    if count(text) <= budget {
        return vec![text.to_string()];
    }

    let mut chunks: Vec<String> = Vec::new();
    let mut cursor = 0;
    let push_plain = |piece: &str, chunks: &mut Vec<String>| {
        for part in split_after_punctuation(piece) {
            if count(part) <= budget {
                chunks.push(part.to_string());
                continue;
            }
            let mut current = String::new();
            for c in part.chars() {
                let mut candidate = current.clone();
                candidate.push(c);
                if !current.is_empty() && count(&candidate) > budget {
                    chunks.push(std::mem::take(&mut current));
                    current.push(c);
                } else {
                    current = candidate;
                }
            }
            if !current.is_empty() {
                chunks.push(current);
            }
        }
    };
    for found in PROTECTED_PATTERN.find_iter(text) {
        let Ok(found) = found else { break };
        if found.start() > cursor {
            push_plain(&text[cursor..found.start()], &mut chunks);
        }
        chunks.push(found.as_str().to_string());
        cursor = found.end();
    }
    if cursor < text.len() {
        push_plain(&text[cursor..], &mut chunks);
    }

    let mut segments = Vec::new();
    let mut current = String::new();
    for chunk in chunks {
        if !current.is_empty() && count(&format!("{current}{chunk}")) > budget {
            segments.push(std::mem::replace(&mut current, chunk));
        } else {
            current.push_str(&chunk);
        }
    }
    if !current.is_empty() {
        segments.push(current);
    }
    if segments.is_empty() { vec![text.to_string()] } else { segments }
}

/// 按官方顺序准备 GPT 输入。只含空白的段落不送去生成；全部为空时报错。
pub fn prepare(
    text: &str,
    requested_language: Option<&str>,
    tokenizer: &TiktokenTokenizer,
    max_segment_tokens: usize,
) -> Result<PreparedText> {
    let resolution = resolve_language(text, requested_language)?;
    let language = resolution.language;
    let mut prepared = normalize_text(&clean_characters(text), language);
    match language {
        "zh" | "en" | "ja" => prepared = prepared.to_lowercase(),
        "es" => prepared = prepared.to_uppercase(),
        _ => {}
    }
    prepared = apply_pronunciation_annotations(&prepared);
    if language == "ja" {
        prepared = segment_japanese(&prepared);
    }
    prepared = uppercase_special_tokens(&prepared);

    let prefix = format!("<|{language}|> ");
    let count = |segment: &str| tokenizer.token_count(segment);
    let segments: Vec<String> = split_text_by_tokens(&prepared, &count, max_segment_tokens, &prefix, TEXT_POSITION_CAPACITY)
        .into_iter()
        .filter(|segment| !segment.trim().is_empty())
        .collect();
    if segments.is_empty() {
        bail!("规整后没有可朗读的文本");
    }
    let token_ids = segments
        .iter()
        .map(|segment| {
            let mut ids = tokenizer.encode(&format!("{prefix}{segment}"));
            ids.push(STOP_TEXT_TOKEN);
            ids
        })
        .collect();
    Ok(PreparedText {
        language,
        language_id: language_id(language).expect("公开语言都在语言码表里"),
        language_ambiguous: resolution.ambiguous,
        normalized_text: prepared,
        segments,
        token_ids,
    })
}

fn replace_captures(pattern: &Regex, text: &str, mut replace: impl FnMut(&Captures) -> String) -> String {
    let mut output = String::with_capacity(text.len());
    let mut cursor = 0;
    for captures in pattern.captures_iter(text) {
        let Ok(captures) = captures else { break };
        let whole = captures.get(0).expect("第 0 组总是存在");
        output.push_str(&text[cursor..whole.start()]);
        output.push_str(&replace(&captures));
        cursor = whole.end();
    }
    output.push_str(&text[cursor..]);
    output
}

/// 官方 `_idx_to_alpha`：0→a、25→z、26→aa。
fn placeholder_tag(mut index: usize) -> String {
    let mut letters = Vec::new();
    loop {
        letters.push(char::from(b'a' + (index % 26) as u8));
        if index < 26 {
            break;
        }
        index = index / 26 - 1;
    }
    letters.iter().rev().collect()
}

/// `re.split(r'(?<=[，。！？、；：,\.!\?;:\n])')`，去掉空片段。
fn split_after_punctuation(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    for (index, c) in text.char_indices() {
        if "，。！？、；：,.!?;:\n".contains(c) {
            let end = index + c.len_utf8();
            parts.push(&text[start..end]);
            start = end;
        }
    }
    if start < text.len() {
        parts.push(&text[start..]);
    }
    parts
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Script {
    Kanji,
    Hiragana,
    Katakana,
    Alphanumeric,
    Symbol,
    Protected,
}

fn push_japanese_plain(piece: &str, items: &mut Vec<(Option<Script>, String)>) {
    for c in piece.chars() {
        if c == ' ' {
            match items.last_mut() {
                Some((None, spaces)) => spaces.push(' '),
                _ => items.push((None, " ".to_string())),
            }
            continue;
        }
        let previous = items
            .last()
            .and_then(|(script, _)| *script)
            .filter(|script| *script != Script::Protected);
        // 长音符与叠字符沿用前一个字的类别。
        let script = japanese_script(c).unwrap_or(previous.unwrap_or(Script::Symbol));
        let joins = previous.is_some_and(|previous| previous == script || (previous == Script::Kanji && script == Script::Hiragana));
        match items.last_mut() {
            Some((last, text)) if joins => {
                *last = Some(script);
                text.push(c);
            }
            _ => items.push((Some(script), c.to_string())),
        }
    }
}

fn japanese_script(c: char) -> Option<Script> {
    Some(match c {
        'ー' | 'ｰ' | '々' | 'ゝ' | 'ゞ' | 'ヽ' | 'ヾ' => return None,
        c if is_han(c) || c == '〆' || c == 'ヶ' => Script::Kanji,
        '\u{3040}'..='\u{309f}' => Script::Hiragana,
        '\u{30a0}'..='\u{30ff}' | '\u{ff66}'..='\u{ff9f}' => Script::Katakana,
        c if c.is_alphanumeric() => Script::Alphanumeric,
        _ => Script::Symbol,
    })
}

fn is_arabic(c: char) -> bool {
    matches!(c, '\u{0600}'..='\u{06ff}' | '\u{0750}'..='\u{077f}' | '\u{08a0}'..='\u{08ff}')
}

fn is_kana(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{309f}' | '\u{30a0}'..='\u{30ff}')
}

fn is_han(c: char) -> bool {
    matches!(c, '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}')
}

/// 官方 `is_kana`：整串都是平假名，或整串都是片假名。
fn is_single_kana_script(text: &str) -> bool {
    !text.is_empty()
        && (text.chars().all(|c| ('\u{3040}'..='\u{309f}').contains(&c)) || text.chars().all(|c| ('\u{30a0}'..='\u{30ff}').contains(&c)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synthesize::index_tts2::v25::tiktoken::tests::synthetic_tokenizer;

    #[test]
    fn resolves_languages() {
        let auto = |text| resolve_language(text, None).unwrap();
        assert_eq!(auto("你好世界").language, "zh");
        assert_eq!(auto("今日はいい天気").language, "ja");
        assert_eq!(auto("مرحبا").language, "ar");
        assert_eq!(auto("¿Qué tal?").language, "es");
        let english = auto("hello world");
        assert_eq!((english.language, english.ambiguous), ("en", true));
        assert!(resolve_language("مرحبا 你好", None).is_err());
        assert!(resolve_language("  ", Some("auto")).is_err());
        assert!(resolve_language("123", None).is_err());
        assert_eq!(resolve_language("hi", Some("zh-Hans")).unwrap().language, "zh");
        assert_eq!(resolve_language("hi", Some("English")).unwrap().language, "en");
        assert_eq!(resolve_language("hi", Some("es_ES")).unwrap().language, "es");
        assert!(resolve_language("hi", Some("fr")).is_err());
    }

    #[test]
    fn converts_pronunciation_annotations() {
        assert_eq!(
            apply_pronunciation_annotations("走<行|xing2>了"),
            "走<|SPECIAL_TOKEN_2|>XING2<|SPECIAL_TOKEN_2|>了"
        );
        assert_eq!(
            apply_pronunciation_annotations("<going|g ow1 . ih0 ng>"),
            "<|SPECIAL_TOKEN_1|>G OW1 . IH0 NG<|SPECIAL_TOKEN_1|>"
        );
        assert_eq!(apply_pronunciation_annotations("<今日|きょう>は"), " きょう は");
        assert_eq!(uppercase_special_tokens("<|laughter|> hi"), "<|LAUGHTER|> hi");
    }

    #[test]
    fn normalization_protects_annotations() {
        assert_eq!(placeholder_tag(0), "a");
        assert_eq!(placeholder_tag(25), "z");
        assert_eq!(placeholder_tag(26), "aa");
        assert_eq!(placeholder_tag(27), "ab");
        let normalized = normalize_text("<行|XING2>走了3步，好", "zh");
        assert!(normalized.starts_with("<行|XING2>走了"), "{normalized}");
        assert!(!normalized.contains('3'), "{normalized}");
        assert!(normalized.ends_with(",好"), "{normalized}");
        assert_eq!(normalize_text("3 años", "es"), "3 años");
        assert_eq!(clean_characters("“你好”（测试）……"), "'你好''测试'…");
    }

    #[test]
    fn segments_japanese_by_script() {
        assert_eq!(
            segment_japanese("ちょうど 探しに行こうかなって 思っていたんだ。"),
            "ちょうど 探しに 行こうかなって 思っていたんだ 。"
        );
        assert_eq!(segment_japanese("テレビを見るAI"), "テレビ を 見る AI");
        assert_eq!(segment_japanese("コーヒー"), "コーヒー");
        assert_eq!(
            segment_japanese("<|SPECIAL_TOKEN_1|>G OW1<|SPECIAL_TOKEN_1|>へ  行く"),
            "<|SPECIAL_TOKEN_1|>G OW1<|SPECIAL_TOKEN_1|> へ  行く"
        );
        assert_eq!(
            segment_japanese("東京<|SPECIAL_TOKEN_2|>XING<|SPECIAL_TOKEN_2|>です"),
            "東京 <|SPECIAL_TOKEN_2|>XING<|SPECIAL_TOKEN_2|> です"
        );
    }

    #[test]
    fn splits_within_token_budget() {
        let count = |text: &str| text.chars().count();
        // 前缀 7 个字符，预算 17 - 7 = 10。
        assert_eq!(
            split_text_by_tokens("一二三四五，六七八九十，甲乙丙", &count, 17, "<|zh|> ", 602),
            vec!["一二三四五，", "六七八九十，甲乙丙"]
        );
        assert_eq!(
            split_text_by_tokens("一二三四五六七八九十甲乙", &count, 17, "<|zh|> ", 602),
            vec!["一二三四五六七八九十", "甲乙"]
        );
        let protected = "<|SPECIAL_TOKEN_2|>XING<|SPECIAL_TOKEN_2|>";
        let segments = split_text_by_tokens(&format!("甲{protected}乙"), &count, 17, "<|zh|> ", 602);
        assert_eq!(segments, vec!["甲", protected, "乙"]);
        assert_eq!(split_text_by_tokens("短句", &count, 17, "<|zh|> ", 602), vec!["短句"]);
    }

    #[test]
    fn prepares_prefixed_segments() {
        let tokenizer = synthetic_tokenizer();
        let prepared = prepare("ABC", Some("en"), &tokenizer, DEFAULT_MAX_SEGMENT_TOKENS).unwrap();
        assert_eq!(prepared.language_id, 0);
        assert_eq!(prepared.normalized_text, "abc");
        let en = tokenizer.special_id("<|en|>").unwrap();
        assert_eq!(prepared.token_ids, vec![vec![en, 32, 257, STOP_TEXT_TOKEN]]);
        assert!(prepare("…", Some("es"), &tokenizer, 120).is_ok());
        assert!(prepare("  ", Some("zh"), &tokenizer, 120).is_err());
    }
}
