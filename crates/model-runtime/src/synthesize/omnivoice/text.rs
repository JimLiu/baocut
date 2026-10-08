//! OmniVoice 文本侧的纯逻辑：语言解析、文本拼接清洗、参考文本补标点、
//! 非语言标签切分与时长（token 数）估算。全部对照官方源码逐条移植：
//! - `omnivoice/models/omnivoice.py`：`_resolve_language`、`_combine_text`、
//!   `_NONVERBAL_PATTERN`、`_estimate_target_tokens`、`_ZH_RE` 的用法；
//! - `omnivoice/utils/text.py::add_punctuation`；
//! - `omnivoice/utils/duration.py::RuleDurationEstimator`。

use super::lang_table::LANG_NAME_TO_ID;
use fancy_regex::Regex as FancyRegex;
use regex::Regex;
use std::sync::OnceLock;

/// 官方 `_ZH_RE`：`[一-鿿]`。
pub fn contains_zh(text: &str) -> bool {
    text.chars().any(is_cjk)
}

fn is_cjk(c: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&c)
}

/// 官方 `_resolve_language`：`None` / `"none"` → 语言无关；语言 id 精确命中照用；
/// 否则按小写语言名查表；都不中回退 `None`（官方同样只打警告）。
///
/// BaoCut 补一步：官方认不出时再取 BCP-47 主标签的小写（`zh-CN` → `zh`、`EN` → `en`），
/// 因为 BaoCut 各处传的是 BCP-47 标签。
pub fn resolve_language(language: Option<&str>) -> Option<String> {
    let language = language?;
    if language.to_lowercase() == "none" {
        return None;
    }
    let official = |tag: &str| -> Option<String> {
        if is_language_id(tag) {
            return Some(tag.to_string());
        }
        let key = tag.to_lowercase();
        LANG_NAME_TO_ID
            .binary_search_by(|(name, _)| name.as_bytes().cmp(key.as_bytes()))
            .ok()
            .map(|i| LANG_NAME_TO_ID[i].1.to_string())
    };
    if let Some(id) = official(language) {
        return Some(id);
    }
    let base = language.trim().split(['-', '_']).next().unwrap_or("").to_ascii_lowercase();
    if !base.is_empty() && is_language_id(&base) {
        return Some(base);
    }
    None
}

fn is_language_id(tag: &str) -> bool {
    LANG_NAME_TO_ID.iter().any(|(_, id)| *id == tag)
}

/// 官方 `_combine_text`：有参考文本时 `ref.strip() + " " + text.strip()`；去掉 CR/LF、
/// 全角括号换半角、连续空格 / 制表符合一、去掉紧挨汉字的空白。
pub fn combine_text(text: &str, ref_text: Option<&str>) -> String {
    static NEWLINES: OnceLock<Regex> = OnceLock::new();
    static SPACES: OnceLock<Regex> = OnceLock::new();
    static AROUND_CJK: OnceLock<FancyRegex> = OnceLock::new();
    let full = match ref_text.filter(|r| !r.is_empty()) {
        Some(r) => format!("{} {}", py_strip(r), py_strip(text)),
        None => py_strip(text).to_string(),
    };
    let full = NEWLINES
        .get_or_init(|| Regex::new(r"[\r\n]+").expect("regex"))
        .replace_all(&full, "");
    let full = full.replace('\u{ff08}', "(").replace('\u{ff09}', ")");
    let full = SPACES.get_or_init(|| Regex::new(r"[ \t]+").expect("regex")).replace_all(&full, " ");
    AROUND_CJK
        .get_or_init(|| FancyRegex::new(r"(?<=[\x{4e00}-\x{9fff}])\s+|\s+(?=[\x{4e00}-\x{9fff}])").expect("regex"))
        .replace_all(&full, "")
        .into_owned()
}

/// Python `str.strip()`：去掉两端 Unicode 空白。
fn py_strip(s: &str) -> &str {
    s.trim()
}

/// 官方 `END_PUNCTUATION`（`omnivoice/utils/text.py`）；官方集合里的两字符「……」永远
/// 匹配不上单个末字符，这里省去。
const END_PUNCTUATION: &[char] = &[
    '!', '"', '\'', ')', ',', '.', ':', ';', '?', ']', '}', '‘', '’', '“', '”', '…', '、', '。', '】', '！', '）', '，', '：', '；', '？',
];

/// 官方 `add_punctuation`：参考文本末尾没有标点时补「。」（含汉字）或「.」。
pub fn add_punctuation(text: &str) -> String {
    let text = text.trim();
    match text.chars().last() {
        None => String::new(),
        Some(last) if END_PUNCTUATION.contains(&last) => text.to_string(),
        Some(_) if contains_zh(text) => format!("{text}。"),
        Some(_) => format!("{text}."),
    }
}

/// 官方 `_NONVERBAL_PATTERN` 的 13 个非语言标签。
pub const NONVERBAL_TAGS: [&str; 13] = [
    "laughter",
    "sigh",
    "confirmation-en",
    "question-en",
    "question-ah",
    "question-oh",
    "question-ei",
    "question-yi",
    "surprise-ah",
    "surprise-oh",
    "surprise-wa",
    "surprise-yo",
    "dissatisfaction-hnn",
];

/// 官方 `_tokenize_with_nonverbal_tags` 的切分：非语言标签（`[laughter]` 等）单独成段，
/// 其余文本按原样成段（各段分别分词再拼接）。
pub fn split_nonverbal(text: &str) -> Vec<&str> {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    let pattern = PATTERN.get_or_init(|| Regex::new(&format!(r"\[({})\]", NONVERBAL_TAGS.join("|"))).expect("regex"));
    let mut parts = Vec::new();
    let mut last = 0;
    for m in pattern.find_iter(text) {
        if m.start() > last {
            parts.push(&text[last..m.start()]);
        }
        parts.push(m.as_str());
        last = m.end();
    }
    if last < text.len() {
        parts.push(&text[last..]);
    }
    parts
}

/// 官方 `RuleDurationEstimator` 的字符权重。
fn char_weight(c: char) -> f64 {
    const LATIN: f64 = 1.0;
    const SPACE: f64 = 0.2;
    const MARK: f64 = 0.0;
    const PUNCTUATION: f64 = 0.5;
    const DIGIT: f64 = 3.5;
    const CJK: f64 = 3.0;
    const DEFAULT: f64 = 1.0;
    let code = c as u32;
    if c.is_ascii_alphabetic() {
        return LATIN;
    }
    if code == 32 {
        return SPACE;
    }
    if code == 0x0640 {
        return MARK;
    }
    match general_category(c) {
        Category::Mark => return MARK,
        Category::PunctuationOrSymbol => return PUNCTUATION,
        Category::Separator => return SPACE,
        Category::Number => return DIGIT,
        Category::Other => {}
    }
    // bisect_left(breakpoints, code)：第一个上界 >= code 的区段。
    match SCRIPT_RANGES.iter().find(|(upper, _)| *upper >= code) {
        Some((_, weight)) => *weight,
        None if code > 0x20000 => CJK,
        None => DEFAULT,
    }
}

enum Category {
    Mark,
    PunctuationOrSymbol,
    Separator,
    Number,
    Other,
}

/// Unicode 一般类别的前缀（M / P·S / Z / N），与 Python `unicodedata.category` 同口径。
fn general_category(c: char) -> Category {
    static CLASSES: OnceLock<[Regex; 4]> = OnceLock::new();
    let classes = CLASSES.get_or_init(|| {
        [
            Regex::new(r"^\p{M}$").expect("regex"),
            Regex::new(r"^[\p{P}\p{S}]$").expect("regex"),
            Regex::new(r"^\p{Z}$").expect("regex"),
            Regex::new(r"^\p{N}$").expect("regex"),
        ]
    });
    let mut buf = [0u8; 4];
    let s = c.encode_utf8(&mut buf);
    if classes[0].is_match(s) {
        Category::Mark
    } else if classes[1].is_match(s) {
        Category::PunctuationOrSymbol
    } else if classes[2].is_match(s) {
        Category::Separator
    } else if classes[3].is_match(s) {
        Category::Number
    } else {
        Category::Other
    }
}

/// 官方 `self.ranges`：`(区段上界, 权重)`，权重已按脚本类型代入
/// （cjk 3.0 / hangul 2.5 / kana 2.2 / ethiopic 3.0 / yi 3.0 / indic 1.8 / thai_lao 1.5 /
/// khmer_myanmar 1.8 / arabic 1.5 / hebrew 1.5 / latin·cyrillic·greek·armenian·georgian·default 1.0）。
const SCRIPT_RANGES: [(u32, f64); 88] = [
    (0x02AF, 1.0), // latin
    (0x03FF, 1.0), // greek
    (0x052F, 1.0), // cyrillic
    (0x058F, 1.0), // armenian
    (0x05FF, 1.5), // hebrew
    (0x077F, 1.5), // arabic
    (0x089F, 1.5), // arabic
    (0x08FF, 1.5), // arabic
    (0x097F, 1.8), // indic
    (0x09FF, 1.8), // indic
    (0x0A7F, 1.8), // indic
    (0x0AFF, 1.8), // indic
    (0x0B7F, 1.8), // indic
    (0x0BFF, 1.8), // indic
    (0x0C7F, 1.8), // indic
    (0x0CFF, 1.8), // indic
    (0x0D7F, 1.8), // indic
    (0x0DFF, 1.8), // indic
    (0x0EFF, 1.5), // thai_lao
    (0x0FFF, 1.8), // indic
    (0x109F, 1.8), // khmer_myanmar
    (0x10FF, 1.0), // georgian
    (0x11FF, 2.5), // hangul
    (0x137F, 3.0), // ethiopic
    (0x139F, 3.0), // ethiopic
    (0x13FF, 1.0), // default
    (0x167F, 1.0), // default
    (0x169F, 1.0), // default
    (0x16FF, 1.0), // default
    (0x171F, 1.0), // default
    (0x173F, 1.0), // default
    (0x175F, 1.0), // default
    (0x177F, 1.0), // default
    (0x17FF, 1.8), // khmer_myanmar
    (0x18AF, 1.0), // default
    (0x18FF, 1.0), // default
    (0x194F, 1.8), // indic
    (0x19DF, 1.8), // indic
    (0x19FF, 1.8), // khmer_myanmar
    (0x1A1F, 1.8), // indic
    (0x1AAF, 1.8), // indic
    (0x1B7F, 1.8), // indic
    (0x1BBF, 1.8), // indic
    (0x1BFF, 1.8), // indic
    (0x1C4F, 1.8), // indic
    (0x1C7F, 1.8), // indic
    (0x1C8F, 1.0), // cyrillic
    (0x1CBF, 1.0), // georgian
    (0x1CCF, 1.8), // indic
    (0x1CFF, 1.8), // indic
    (0x1D7F, 1.0), // latin
    (0x1DBF, 1.0), // latin
    (0x1DFF, 1.0), // default
    (0x1EFF, 1.0), // latin
    (0x309F, 2.2), // kana
    (0x30FF, 2.2), // kana
    (0x312F, 3.0), // cjk
    (0x318F, 2.5), // hangul
    (0x9FFF, 3.0), // cjk
    (0xA4CF, 3.0), // yi
    (0xA4FF, 1.0), // default
    (0xA63F, 1.0), // default
    (0xA69F, 1.0), // cyrillic
    (0xA6FF, 1.0), // default
    (0xA7FF, 1.0), // latin
    (0xA82F, 1.8), // indic
    (0xA87F, 1.0), // default
    (0xA8DF, 1.8), // indic
    (0xA8FF, 1.8), // indic
    (0xA92F, 1.8), // indic
    (0xA95F, 1.8), // indic
    (0xA97F, 2.5), // hangul
    (0xA9DF, 1.8), // indic
    (0xA9FF, 1.8), // khmer_myanmar
    (0xAA5F, 1.8), // indic
    (0xAA7F, 1.8), // khmer_myanmar
    (0xAADF, 1.8), // indic
    (0xAAFF, 1.8), // indic
    (0xAB2F, 3.0), // ethiopic
    (0xAB6F, 1.0), // latin
    (0xABBF, 1.0), // default
    (0xABFF, 1.8), // indic
    (0xD7AF, 2.5), // hangul
    (0xFAFF, 3.0), // cjk
    (0xFDFF, 1.5), // arabic
    (0xFE6F, 1.0), // default
    (0xFEFF, 1.5), // arabic
    (0xFFEF, 1.0), // latin
];

/// 一段文本的总权重（官方 `calculate_total_weight`）。
pub fn total_weight(text: &str) -> f64 {
    text.chars().map(char_weight).sum()
}

/// 官方 `RuleDurationEstimator.estimate_duration`（`low_threshold=50`、`boost_strength=3`）。
/// 这里的「时长」单位与参考长度一致（调用方传的是参考音频 token 数）。
pub fn estimate_duration(target_text: &str, ref_text: &str, ref_duration: f64) -> f64 {
    const LOW_THRESHOLD: f64 = 50.0;
    const BOOST_STRENGTH: f64 = 3.0;
    if ref_duration <= 0.0 || ref_text.is_empty() {
        return 0.0;
    }
    let ref_weight = total_weight(ref_text);
    if ref_weight == 0.0 {
        return 0.0;
    }
    let speed_factor = ref_weight / ref_duration;
    let estimated = total_weight(target_text) / speed_factor;
    if estimated < LOW_THRESHOLD {
        LOW_THRESHOLD * (estimated / LOW_THRESHOLD).powf(1.0 / BOOST_STRENGTH)
    } else {
        estimated
    }
}

/// 官方 `_estimate_target_tokens`：没有参考音频或参考文本为空时以「Nice to meet you.」
/// = 25 token 为基准；`speed > 0` 且不等于 1 时按语速缩放；至少 1。
pub fn estimate_target_tokens(text: &str, ref_text: Option<&str>, num_ref_audio_tokens: Option<usize>, speed: f64) -> usize {
    let (ref_text, ref_tokens) = match (ref_text, num_ref_audio_tokens) {
        (Some(r), Some(n)) if !r.is_empty() => (r, n as f64),
        _ => ("Nice to meet you.", 25.0),
    };
    let mut est = estimate_duration(text, ref_text, ref_tokens);
    if speed > 0.0 && speed != 1.0 {
        est /= speed;
    }
    (est as usize).max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_languages_like_the_official_table() {
        assert_eq!(resolve_language(None), None);
        assert_eq!(resolve_language(Some("None")), None);
        assert_eq!(resolve_language(Some("zh")).as_deref(), Some("zh"));
        assert_eq!(resolve_language(Some("English")).as_deref(), Some("en"));
        assert_eq!(resolve_language(Some("cantonese")).as_deref(), Some("yue"));
        assert_eq!(resolve_language(Some("Ömie")).as_deref(), Some("aom"));
        // BaoCut 补的 BCP-47 主标签回退。
        assert_eq!(resolve_language(Some("zh-CN")).as_deref(), Some("zh"));
        assert_eq!(resolve_language(Some("EN")).as_deref(), Some("en"));
        assert_eq!(resolve_language(Some("klingon")), None);
        assert_eq!(LANG_NAME_TO_ID.len(), 646);
        assert!(LANG_NAME_TO_ID.windows(2).all(|w| w[0].0.as_bytes() < w[1].0.as_bytes()));
    }

    // 期望值由官方 `_combine_text` 跑出。
    #[test]
    fn combines_text_like_the_official_cleaner() {
        assert_eq!(combine_text("  你好 世界 ", None), "你好世界");
        assert_eq!(
            combine_text("Hello\r\n  world\t\tagain", Some(" Ref text ")),
            "Ref text Hello world again"
        );
        assert_eq!(combine_text("（注）a  b 中 c", None), "(注)a b中c");
        assert_eq!(combine_text("今天 天气 good", Some("大家好。")), "大家好。今天天气good");
        assert_eq!(combine_text("x", Some("")), "x");
    }

    #[test]
    fn adds_terminal_punctuation_to_reference_text() {
        assert_eq!(add_punctuation("大家好，欢迎使用宝典"), "大家好，欢迎使用宝典。");
        assert_eq!(add_punctuation(" hello "), "hello.");
        assert_eq!(add_punctuation("done!"), "done!");
        assert_eq!(add_punctuation("好」"), "好」。");
        assert_eq!(add_punctuation("  "), "");
    }

    #[test]
    fn splits_nonverbal_tags() {
        assert_eq!(
            split_nonverbal("<|text_start|>hi [laughter] there[sigh]<|text_end|>"),
            vec!["<|text_start|>hi ", "[laughter]", " there", "[sigh]", "<|text_end|>"]
        );
        assert_eq!(split_nonverbal("[unknown] x"), vec!["[unknown] x"]);
    }

    // 期望值由官方 `RuleDurationEstimator` / `_estimate_target_tokens` 跑出。
    #[test]
    fn duration_estimates_match_the_official_estimator() {
        let cases: [(&str, f64); 7] = [
            ("Hello, world.", 11.2),
            ("你好，世界！", 13.0),
            ("नमस्ते दुनिया", 12.8),
            ("Chào thế giới", 11.4),
            ("Hello 🌍! This is fun 🎉", 16.5),
            ("123 abc", 13.7),
            // 阿拉伯延长符 / 组合附加符 / 扩展 B 汉字 / 标题大小写字母。
            ("\u{0640}a\u{00e9}\u{0301} \u{20000} \u{01c5}", 4.4),
        ];
        for (text, want) in cases {
            let got = total_weight(text);
            assert!((got - want).abs() < 1e-9, "{text}: {got} != {want}");
        }
        let long_zh = "今天天气真不错，我们一起去公园散步吧。";
        let long_en = "A much longer english sentence that should clearly exceed the low threshold of fifty tokens in total.";
        assert_eq!(estimate_target_tokens("Hello, world.", None, None, 1.0), 36);
        assert_eq!(estimate_target_tokens(long_zh, None, None, 1.0), 92);
        assert_eq!(estimate_target_tokens(long_zh, None, None, 1.5), 61);
        assert_eq!(
            estimate_target_tokens("今天天气真不错。", Some("大家好，欢迎使用宝典。"), Some(60), 1.0),
            48
        );
        assert_eq!(estimate_target_tokens("", None, None, 1.0), 1);
        assert_eq!(estimate_target_tokens(long_en, None, None, 0.8), 194);
    }
}
