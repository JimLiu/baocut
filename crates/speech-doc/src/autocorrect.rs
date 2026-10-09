//! CJK ⇄ Latin 字幕文本自动排版。
//!
//! 从 voice-ink `Pipeline/Text/AutoCorrect` 移植，规则源自
//! `huacnlee/autocorrect` v2.16.3 的纯文本核心。这里不处理 Markdown、代码或
//! LaTeX；输入始终是 transcript/translation 的普通正文。
//!
//! 与上游一致的规则包括 CJK/Latin 间距、CJ 语境中的安全全角标点、全角字母
//! 数字归一化和技术词大小写。全角字母数字在其他规则之前归一化，保证
//! `format(format(text)) == format(text)`。

use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use regex::{Captures, Regex};

use crate::atomize::is_cjk_text;
use crate::doc::Word;
use crate::split::primary_subtag;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Options {
    pub word_case: bool,
    /// 谚文是否参与「CJK ⇄ 西文」的空格规则。缺省 `true`（沿用 voice-ink 的
    /// 行为，中文 / 日文文本里夹着的谚文照旧）；韩文译文由
    /// [`format_translation_with_options`] 关掉。原文一侧取 `false`（[`Options::source`]）：韩文按
    /// 空格分词，一个词里常有数字或拉丁字母（`2박`、`600원`、`AI가`），而原文的
    /// 词表是真相——排版不得改动含谚文的文本里的空白，既不往词里塞空格，
    /// 也不把两个词并成一个。全角字母数字归一化与技术词大小写照常。
    pub hangul_spacing: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            word_case: true,
            hangul_spacing: true,
        }
    }
}

impl Options {
    /// 原文（transcript 词文本、润色后的原文句）用的排版：见
    /// [`Options::hangul_spacing`]。
    pub fn source() -> Self {
        Self {
            word_case: true,
            hangul_spacing: false,
        }
    }
}

/// 格式化普通字幕文本。该操作是幂等的。
pub fn format(text: &str) -> String {
    format_with_options(text, Options::default())
}

/// 字幕显示用的间距投影：只补 CJK ⇄ ASCII 字母数字间距，不改大小写或标点。
/// 沿用原文排版的片段边界与韩文保护；含谚文的片段、路径和 URL 原样保留。
pub fn display_spacing(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    for part in text.split_inclusive([' ', '\n', '\r']) {
        if contains_hangul(part) || path_re().is_match(part) {
            output.push_str(part);
            continue;
        }
        let mut previous = None;
        for ch in part.chars() {
            if needs_pangu_space(previous, Some(ch)) {
                output.push(' ');
            }
            output.push(ch);
            previous = Some(ch);
        }
    }
    output
}

pub fn format_with_options(text: &str, options: Options) -> String {
    if text.is_empty() {
        return String::new();
    }
    // voice-ink 的刻意偏差：halfwidth-word 是前置步骤，避免全角 ASCII
    // 到第二轮才获得 CJK/Latin 间距。
    let mut output = halfwidth_word(text);
    // 原文一侧：含谚文的片（一个韩文词）与含谚文的整段都不动空白。
    let frozen = |text: &str| !options.hangul_spacing && contains_hangul(text);
    if contains_cjk_script(&output) {
        // 按空格/换行分片并保留尾随分隔符；全角标点规则会吸收其后的空格。
        let mut result = String::with_capacity(output.len() + 8);
        let mut part = String::new();
        let mut flush = |part: &mut String, result: &mut String| {
            if frozen(part) {
                result.push_str(part);
            } else {
                result.push_str(&format_part(part));
            }
            part.clear();
        };
        for ch in output.chars() {
            part.push(ch);
            if matches!(ch, ' ' | '\n' | '\r') {
                flush(&mut part, &mut result);
            }
        }
        if !part.is_empty() {
            flush(&mut part, &mut result);
        }
        output = result;
        if !frozen(&output) {
            for strategy in no_space_fullwidth_strategies().iter() {
                output = strategy.format(&output);
            }
        }
    }
    if options.word_case {
        output = apply_word_case(&output);
    }
    output
}

/// VoiceInk 只在 CJK 目标语言的自动管线中格式化译文。
pub fn is_cjk_language(lang: &str) -> bool {
    matches!(primary_subtag(lang).as_str(), "zh" | "yue" | "ja" | "ko")
}

/// 词与词之间不留空格的 CJK 语言：中文（含粤语）与日文。韩文不在其中——
/// 它算 CJK 排版（[`is_cjk_language`]），但按空格分词。
pub fn is_unspaced_cjk_language(lang: &str) -> bool {
    matches!(primary_subtag(lang).as_str(), "zh" | "yue" | "ja")
}

/// CJK 之外、词与词之间同样不留空格的书写语言：泰、老挝、缅甸、高棉、藏
/// （含宗喀）——[`crate::atomize::spaced_script_letter`] 排除的那几段文字。
/// 这些语言里空格是短语或分句的停顿，不是词界，所以代码不能替它补空格；
/// 未列出的语言一律按「词间有空格」处理。
pub fn is_unspaced_script_language(lang: &str) -> bool {
    matches!(
        primary_subtag(lang).as_str(),
        "th" | "lo" | "my" | "km" | "bo" | "dz"
    )
}

/// 源文门：至少一半词原子含 CJK，避免一个偶发汉字把英文文档切到 CJK 路径。
pub fn source_is_cjk(words: &[Word]) -> bool {
    !words.is_empty()
        && words.iter().filter(|word| is_cjk_text(&word.text)).count() * 2 >= words.len()
}

/// 逐词排版原文词原子，返回改动的词数。调用方先过 [`source_is_cjk`] 门。
/// 词里不许有空白：排版结果带空白的词保持原样。
pub fn format_words(words: &mut [Word]) -> usize {
    let mut changed = 0;
    for word in words {
        let formatted = format_with_options(&word.text, Options::source());
        let trimmed = formatted.trim();
        if trimmed.is_empty() || trimmed == word.text || trimmed.chars().any(char::is_whitespace) {
            continue;
        }
        word.text = trimmed.to_owned();
        changed += 1;
    }
    changed
}

/// 格式化目标语译文。非 CJK 目标保持逐字不变；韩文目标不动空白
/// （[`Options::hangul_spacing`]）。
pub fn format_translation(text: &str, lang: &str) -> String {
    format_translation_with_options(text, lang, &[], Options::default())
}

/// 受保护词条逐字保持；只格式化词条之间的文本，并补足词条边缘的
/// CJK ⇄ ASCII 字母数字间距。
pub fn format_translation_with_options(
    text: &str,
    lang: &str,
    protected_terms: &[String],
    options: Options,
) -> String {
    if !is_cjk_language(lang) {
        return text.to_owned();
    }
    // 韩文译文：助词与量词直接贴在前面的拉丁词或数字上（`AI가`、`2박 3일`），
    // 空白就是词界，不过间距规则；其余归一化照常。
    let korean = primary_subtag(lang) == "ko";
    let options = Options {
        hangul_spacing: options.hangul_spacing && !korean,
        ..options
    };
    let terms: Vec<&str> = protected_terms
        .iter()
        .map(String::as_str)
        .filter(|term| !term.is_empty() && text.contains(term))
        .collect();
    if terms.is_empty() {
        let formatted = format_with_options(text, options);
        return target_policy_format(&formatted, lang);
    }

    let mut output = String::with_capacity(text.len() + 8);
    let mut cursor = 0;
    while cursor < text.len() {
        let next = terms
            .iter()
            .filter_map(|term| {
                text[cursor..]
                    .find(term)
                    .map(|offset| (cursor + offset, *term))
            })
            .min_by(|(left_start, left_term), (right_start, right_term)| {
                left_start
                    .cmp(right_start)
                    .then_with(|| right_term.chars().count().cmp(&left_term.chars().count()))
            });
        let Some((start, term)) = next else {
            let formatted = format_with_options(&text[cursor..], options);
            output.push_str(&target_policy_format(&formatted, lang));
            break;
        };
        let formatted = format_with_options(&text[cursor..start], options);
        output.push_str(&target_policy_format(&formatted, lang));
        if !korean && needs_pangu_space(output.chars().last(), term.chars().next()) {
            output.push(' ');
        }
        output.push_str(term);
        cursor = start + term.len();
        if !korean && needs_pangu_space(term.chars().last(), text[cursor..].chars().next()) {
            output.push(' ');
        }
    }
    output
}

fn simplified_chinese(lang: &str) -> bool {
    let subtags = lang
        .split(['-', '_'])
        .map(|part| part.to_ascii_lowercase())
        .collect::<Vec<_>>();
    subtags.first().is_some_and(|primary| primary == "zh")
        && !subtags.iter().any(|subtag| subtag == "hant")
}

/// 能确定性裁决的简中目标排版在落 `trans` 前收敛；代码/URL 样片由既有
/// `path_re` 保护。直引号等可能是数据的字符不在这里改写，交给 check advisory。
fn target_policy_format(text: &str, lang: &str) -> String {
    if !simplified_chinese(lang) || text.is_empty() {
        return text.to_owned();
    }
    let ellipsis = rx(r"(?:⋯|\.{3,})+");
    let noisy_marks = rx(r"[!?！？]{2,}");
    let four_digit_group =
        rx(r"(?P<prefix>(?:^|[^0-9]))(?P<lead>[0-9]),(?P<tail>[0-9]{3})(?P<suffix>(?:[^0-9]|$))");
    let mut output = String::with_capacity(text.len());
    let mut part = String::new();
    let flush = |part: &mut String, output: &mut String| {
        if part.is_empty() {
            return;
        }
        if path_re().is_match(part) {
            output.push_str(part);
        } else {
            let normalized = ellipsis.replace_all(part, "…");
            let normalized = noisy_marks.replace_all(&normalized, |caps: &Captures<'_>| {
                let raw = caps.get(0).map(|value| value.as_str()).unwrap_or_default();
                match raw.chars().last() {
                    Some('?' | '？') => "？",
                    _ => "！",
                }
            });
            let normalized = four_digit_group.replace_all(&normalized, "$prefix$lead$tail$suffix");
            output.push_str(&normalized);
        }
        part.clear();
    };
    for ch in text.chars() {
        part.push(ch);
        if ch.is_whitespace() {
            flush(&mut part, &mut output);
        }
    }
    flush(&mut part, &mut output);
    output
}

/// 原地格式化一张目标语译文表，返回实际改变的条数。
pub fn format_translation_map(
    map: &mut BTreeMap<String, String>,
    lang: &str,
    keys: Option<&BTreeSet<String>>,
    protected_terms: &[String],
) -> usize {
    if !is_cjk_language(lang) {
        return 0;
    }
    let mut changed = 0;
    for (key, text) in map.iter_mut() {
        if keys.is_some_and(|keys| !keys.contains(key)) {
            continue;
        }
        let formatted =
            format_translation_with_options(text, lang, protected_terms, Options::default());
        if formatted != *text {
            *text = formatted;
            changed += 1;
        }
    }
    changed
}

fn needs_pangu_space(left: Option<char>, right: Option<char>) -> bool {
    fn ascii_alnum(ch: char) -> bool {
        ch.is_ascii_alphanumeric()
    }
    matches!((left, right),
        (Some(left), Some(right))
            if (crate::atomize::is_cjk_char(left) && ascii_alnum(right))
                || (ascii_alnum(left) && crate::atomize::is_cjk_char(right)))
}

fn format_part(part: &str) -> String {
    if path_re().is_match(part) || !contains_cjk_script(part) {
        return part.to_owned();
    }
    let mut output = part.to_owned();
    for strategy in word_strategies().iter() {
        output = strategy.format(&output);
    }
    for strategy in bracket_strategies().iter() {
        output = strategy.format(&output);
    }
    for strategy in dash_strategies().iter() {
        output = strategy.format(&output);
    }
    fullwidth_punctuation(&output)
}

/// voice-ink 保留了 huacnlee/autocorrect 的 regexp! 文本替换行为。特别是
/// `CJK` 会展开成未分组的 alternation，`CJ` 出现在 `[]` 内时会留下字面 `|`；
/// 这些看似奇怪的优先级会影响既有输出，不能在移植时“修正”。
fn rx(pattern: &str) -> Regex {
    let pattern = pattern
        .replace(
            r"\p{CJK_N}",
            r"\p{Han}\p{Hangul}\p{Katakana}\p{Hiragana}\p{Bopomofo}",
        )
        .replace(
            r"\p{CJK}",
            r"\p{Han}|\p{Hangul}|\p{Katakana}|\p{Hiragana}|\p{Bopomofo}",
        )
        .replace(r"\p{CJ}", r"\p{Han}|\p{Katakana}|\p{Hiragana}|\p{Bopomofo}");
    Regex::new(&pattern)
        .unwrap_or_else(|error| panic!("invalid autocorrect regex {pattern:?}: {error}"))
}

struct Strategy {
    regex: Regex,
    reverse_regex: Option<Regex>,
    replacement: &'static str,
}

impl Strategy {
    fn new(one: &str, other: &str, reverse: bool, remove_space: bool) -> Self {
        let middle = if remove_space { "[ ]+" } else { "" };
        Self {
            regex: rx(&format!("({one}){middle}({other})")),
            reverse_regex: reverse.then(|| rx(&format!("({other}){middle}({one})"))),
            replacement: if remove_space { "$1$2" } else { "$1 $2" },
        }
    }

    fn format(&self, text: &str) -> String {
        let output = self.regex.replace_all(text, self.replacement).into_owned();
        self.reverse_regex.as_ref().map_or(output.clone(), |regex| {
            regex.replace_all(&output, self.replacement).into_owned()
        })
    }
}

fn path_re() -> &'static Regex {
    static VALUE: LazyLock<Regex> =
        LazyLock::new(|| rx(r"(^[a-zA-Z\d]+://)|(^/?[a-zA-Z\d\-_\.]{2,}/)"));
    &VALUE
}

fn word_strategies() -> &'static [Strategy] {
    static VALUE: LazyLock<Vec<Strategy>> = LazyLock::new(|| {
        vec![
            Strategy::new(r"\p{CJK}[^%\$\\]", r"[a-zA-Z0-9]", false, false),
            Strategy::new(r"[^%\$\\][a-zA-Z0-9]", r"\p{CJK}", false, false),
            Strategy::new(r"\p{CJK}", r"[\-+][\d]+", true, false),
            Strategy::new(r"^[a-zA-Z0-9]", r"\p{CJK}", false, false),
            Strategy::new(r"[0-9][%]", r"\p{CJK}", false, false),
            Strategy::new(r"[a-zA-Z0-9][+#]+", r"\p{CJK}", false, false),
        ]
    });
    &VALUE
}

fn bracket_strategies() -> &'static [Strategy] {
    static VALUE: LazyLock<Vec<Strategy>> = LazyLock::new(|| {
        vec![
            Strategy::new(r"\p{CJK}", r"[\[\(]", false, false),
            Strategy::new(r"[\]\)]", r"\p{CJK}", false, false),
        ]
    });
    &VALUE
}

fn dash_strategies() -> &'static [Strategy] {
    static VALUE: LazyLock<Vec<Strategy>> = LazyLock::new(|| {
        vec![
            Strategy::new(
                r"[\p{CJK_N}”’]",
                r"[\-][\p{CJK_N}\s（【「《“‘]",
                false,
                false,
            ),
            Strategy::new(
                r"[\p{CJK_N}\s）】」”’》][\-]",
                r"[\p{CJK_N}“‘]",
                false,
                false,
            ),
        ]
    });
    &VALUE
}

fn no_space_fullwidth_strategies() -> &'static [Strategy] {
    static VALUE: LazyLock<Vec<Strategy>> = LazyLock::new(|| {
        vec![
            Strategy::new(
                r"\w|\p{CJK}|`",
                r"[，。、！？：；（）「」《》【】]",
                true,
                true,
            ),
            Strategy::new(r"\w|\p{CJK}", r"[“”‘’]", true, true),
        ]
    });
    &VALUE
}

fn fullwidth_patterns() -> &'static [Regex] {
    static VALUE: LazyLock<Vec<Regex>> = LazyLock::new(|| {
        vec![
            rx(r"[\p{CJ}\w\d]+[,?]([ ]*)[\p{CJ}]+"),
            rx(r"[\p{CJ}]+[,?]([ ]*)"),
            rx(r"[\p{CJ}]+[.:!]([ ]*)[\p{CJ}]+"),
            rx(r#"[\p{CJ}]+[.:!]([ ]*)["']?$"#),
        ]
    });
    &VALUE
}

fn fullwidth_punct_re() -> &'static Regex {
    static VALUE: LazyLock<Regex> = LazyLock::new(|| rx(r"([.:!]([ ]*)|[,?]([ ]*))"));
    &VALUE
}

fn fullwidth_punctuation(part: &str) -> String {
    let mut output = part.to_owned();
    for pattern in fullwidth_patterns() {
        output = pattern
            .replace_all(&output, |captures: &Captures<'_>| {
                fullwidth_punct_re()
                    .replace_all(&captures[0], |punct: &Captures<'_>| {
                        match punct[0].trim_matches(' ') {
                            "," => "，".to_owned(),
                            "." => "。".to_owned(),
                            ":" => "：".to_owned(),
                            "!" => "！".to_owned(),
                            "?" => "？".to_owned(),
                            _ => punct[0].to_owned(),
                        }
                    })
                    .into_owned()
            })
            .into_owned();
    }
    output
}

fn half_time_re() -> &'static Regex {
    static VALUE: LazyLock<Regex> = LazyLock::new(|| rx(r"(\d)(：)(\d)"));
    &VALUE
}

fn halfwidth_word(text: &str) -> String {
    let mut changed = false;
    let mut output = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch as u32 {
            value @ (0xFF10..=0xFF19 | 0xFF21..=0xFF3A | 0xFF41..=0xFF5A) => {
                changed = true;
                output.push(char::from_u32(value - 0xFEE0).expect("fullwidth ASCII maps"));
            }
            0x3000 => {
                changed = true;
                output.push(' ');
            }
            _ => output.push(ch),
        }
    }
    if !changed {
        return text.to_owned();
    }
    half_time_re().replace_all(&output, "$1:$3").into_owned()
}

const WORD_CASE_DICT: &[&str] = &[
    "iOS",
    "iPadOS",
    "macOS",
    "watchOS",
    "tvOS",
    "visionOS",
    "iPhone",
    "iPad",
    "iMac",
    "MacBook",
    "AirPods",
    "AirDrop",
    "iCloud",
    "Xcode",
    "TestFlight",
    "App Store",
    "GitHub",
    "GitLab",
    "VS Code",
    "vscode = VS Code",
    "Wi-Fi",
    "wifi = Wi-Fi",
    "YouTube",
    "TikTok",
    "Instagram",
    "WhatsApp",
    "WeChat",
    "Telegram",
    "Netflix",
    "Spotify",
    "Reddit",
    "Wikipedia",
    "Bilibili",
    "JavaScript",
    "TypeScript",
    "Python",
    "Node.js",
    "nodejs = Node.js",
    "HTML",
    "CSS",
    "JSON",
    "YAML",
    "SQL",
    "API",
    "URL",
    "HTTP",
    "HTTPS",
    "AI",
    "AGI",
    "GPU",
    "CPU",
    "ChatGPT",
    "chatgpt = ChatGPT",
    "OpenAI",
    "DeepSeek",
    "Claude",
    "Gemini",
    "Anthropic",
    "Google",
    "Microsoft",
    "NVIDIA",
    "nvidia = NVIDIA",
    "Docker",
    "Kubernetes",
    "Linux",
    "Ubuntu",
    "Android",
    "Photoshop",
    "PowerPoint",
    "Figma",
];

struct WordCaseEntry {
    key: Vec<String>,
    replacement: Vec<char>,
}

fn word_case_entries() -> &'static [WordCaseEntry] {
    static VALUE: LazyLock<Vec<WordCaseEntry>> = LazyLock::new(|| {
        let mut entries: Vec<WordCaseEntry> = WORD_CASE_DICT
            .iter()
            .map(|raw| {
                let mut sides = raw.splitn(2, '=').map(str::trim);
                let from = sides.next().expect("word case source");
                let to = sides.next().unwrap_or(from);
                WordCaseEntry {
                    key: from
                        .chars()
                        .map(|ch| ch.to_lowercase().collect::<String>())
                        .collect(),
                    replacement: to.chars().collect(),
                }
            })
            .collect();
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.key.len()));
        entries
    });
    &VALUE
}

fn is_disallowed_neighbor(ch: Option<char>) -> bool {
    let Some(ch) = ch else {
        return false;
    };
    if ch.is_whitespace() || matches!(ch as u32, 0x4E00..=0x9FFF) {
        return false;
    }
    !"？！：，。；、「」“”‘’【】《》".contains(ch)
}

fn apply_word_case(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let folded: Vec<String> = chars
        .iter()
        .map(|ch| ch.to_lowercase().collect::<String>())
        .collect();
    let mut output = String::with_capacity(text.len());
    let mut index = 0;
    while index < chars.len() {
        let accepted = word_case_entries().iter().find(|entry| {
            index + entry.key.len() <= chars.len()
                && folded[index..index + entry.key.len()] == entry.key
                && !is_disallowed_neighbor(index.checked_sub(1).map(|i| chars[i]))
                && !is_disallowed_neighbor(chars.get(index + entry.key.len()).copied())
        });
        let Some(entry) = accepted else {
            output.push(chars[index]);
            index += 1;
            continue;
        };
        output.extend(entry.replacement.iter());
        index += entry.key.len();
    }
    output
}

fn contains_hangul(text: &str) -> bool {
    text.chars().any(|ch| {
        matches!(
            ch as u32,
            0x1100..=0x11FF | 0x3130..=0x318F | 0xA960..=0xA97F | 0xAC00..=0xD7FF
        )
    })
}

fn contains_cjk_script(text: &str) -> bool {
    text.chars().any(|ch| {
        matches!(
            ch as u32,
            0x3005..=0x3007
                | 0x3040..=0x30FF
                | 0x3100..=0x312F
                | 0x31A0..=0x31BF
                | 0x31F0..=0x31FF
                | 0x3400..=0x4DBF
                | 0x4E00..=0x9FFF
                | 0xF900..=0xFAFF
                | 0x1100..=0x11FF
                | 0x3130..=0x318F
                | 0xA960..=0xA97F
                | 0xAC00..=0xD7FF
                | 0x20000..=0x3134F
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_ink_format_vectors_are_idempotent() {
        let cases = [
            ("hello你好", "hello 你好"),
            ("测试ios应用", "测试 iOS 应用"),
            ("于3月10日开始", "于 3 月 10 日开始"),
            ("10%中文", "10% 中文"),
            ("C++中文", "C++ 中文"),
            ("你好[世界]", "你好 [世界]"),
            ("你好-世界", "你好 - 世界"),
            ("foo-世界", "foo-世界"),
            ("内容带有%s的内容", "内容带有%s的内容"),
            ("你好,这是一个句子.", "你好，这是一个句子。"),
            (
                "刚刚买了一部 iPhone,好开心!",
                "刚刚买了一部 iPhone，好开心！",
            ),
            ("\"请求参数错误.\"", "\"请求参数错误。\""),
            ("你好, 世界", "你好，世界"),
            (
                "蚂蚁集团上市后有多大的上涨空间?",
                "蚂蚁集团上市后有多大的上涨空间？",
            ),
            ("Hello世界.", "Hello 世界。"),
            ("中文;中文", "中文;中文"),
            (
                "蚂蚁集团是阿里巴巴 (BABA.N) 旗下金融科技子公司",
                "蚂蚁集团是阿里巴巴 (BABA.N) 旗下金融科技子公司",
            ),
            ("!开头不处理.", "!开头不处理。"),
            (
                "근면, 검소, 협동은 우리 겨레의 미덕이다.",
                "근면, 검소, 협동은 우리 겨레의 미덕이다.",
            ),
            ("한국어hello", "한국어 hello"),
            (
                "そんな新機能を体験してみましょう.",
                "そんな新機能を体験してみましょう。",
            ),
            ("１６：３２", "16:32"),
            ("去ＣＢＤ中心。", "去 CBD 中心。"),
            ("你好\u{3000}世界", "你好 世界"),
            ("测试 ，", "测试，"),
            (
                "详见 https://example.com/页面.html 哦",
                "详见 https://example.com/页面.html 哦",
            ),
            ("我用ios和github开发", "我用 iOS 和 GitHub 开发"),
            ("变量hello_ios不动", "变量 hello_ios 不动"),
            ("看这个https://ios.com链接", "看这个 https://ios.com 链接"),
            (
                "This is a plain English sentence.",
                "This is a plain English sentence.",
            ),
        ];

        for (input, expected) in cases {
            let actual = format(input);
            assert_eq!(actual, expected, "{input}");
            assert_eq!(format(&actual), actual, "not idempotent: {input}");
        }
    }

    #[test]
    fn options_can_disable_word_case() {
        assert_eq!(
            format_with_options(
                "测试ios应用",
                Options {
                    word_case: false,
                    ..Options::default()
                }
            ),
            "测试 ios 应用"
        );
    }

    /// 原文排版不动含谚文的文本里的空白：不往韩文词里塞空格，也不把引号
    /// 两侧的词并成一个；汉字 / 假名文本与缺省排版逐字相同。
    #[test]
    fn source_format_leaves_hangul_whitespace_alone() {
        let source = Options::source();
        for text in [
            "2박 3일 일정에 600원이라는",
            "AI가 발전하면서 iPhone을 샀어요.",
            "그가 “좋아” 하고 말했어요.",
            "서울(Seoul)에서 10%만",
            "한국어hello",
        ] {
            assert_eq!(format_with_options(text, source), text, "{text}");
        }
        // 独立成词的技术词大小写与全角字母数字归一化照常。
        assert_eq!(
            format_with_options("ios 앱을 ＡＩ가 씁니다", source),
            "iOS 앱을 AI가 씁니다"
        );
        for text in [
            "测试ios应用",
            "于3月10日开始",
            "你好,这是一个句子.",
            "Hello世界.",
        ] {
            assert_eq!(format_with_options(text, source), format(text), "{text}");
        }
        // 译文排版不变（voice-ink 的既有向量）。
        assert_eq!(format("한국어hello"), "한국어 hello");
    }

    #[test]
    fn display_spacing_reuses_source_hangul_and_path_guards() {
        for text in [
            "AI가 2박 3일 600원",
            "중국어中文AI가",
            "ᄀAI ᄂ2",
            "https://example.com/中文AI",
            "path/中文AI",
        ] {
            assert_eq!(display_spacing(text), text);
        }
        for (text, expected) in [
            ("让Claude创建Artifact", "让 Claude 创建 Artifact"),
            ("中文AI AI가", "中文 AI AI가"),
            ("AIを使う", "AI を使う"),
            ("v3版本\n用AI", "v3 版本\n用 AI"),
        ] {
            assert_eq!(display_spacing(text), expected);
            assert_eq!(display_spacing(expected), expected);
        }
        assert_eq!(display_spacing("中文ios，ＡＩ！"), "中文 ios，ＡＩ！");
    }

    /// 韩文译文：助词、量词贴着拉丁词或数字写，排版不拆开，也不动模型写下的
    /// 空格；受保护词条两侧同样不补。中文 / 日文目标不变。
    #[test]
    fn korean_translation_keeps_its_own_word_spacing() {
        for text in [
            "하지만 AI가 출시를 쉽게 만듭니다.",
            "아이디어 10개를 PM이라는 직함으로",
            "2박 3일 일정에 35%만 씁니다.",
            "서울(Seoul)에서 “좋아” 하고 말했어요.",
        ] {
            assert_eq!(format_translation(text, "ko"), text, "{text}");
            assert_eq!(format_translation(text, "ko-KR"), text, "{text}");
        }
        assert_eq!(format_translation("ＡＩ가 ios 앱을", "ko"), "AI가 iOS 앱을");
        let terms = vec!["GitHub".to_owned()];
        assert_eq!(
            format_translation_with_options("GitHub에서 코드를", "ko", &terms, Options::default()),
            "GitHub에서 코드를"
        );
        assert_eq!(
            format_translation("使用AI管理代码", "zh"),
            "使用 AI 管理代码"
        );
        assert_eq!(format_translation("AIを使う", "ja"), "AI を使う");
    }

    #[test]
    fn format_words_never_puts_whitespace_inside_a_word() {
        let word = |text: &str| Word {
            id: String::new(),
            t0: 0.0,
            t1: 0.0,
            text: text.to_owned(),
            sp: String::new(),
            glue: false,
        };
        let mut korean: Vec<Word> = ["2박", "3일", "600원이라는", "6시쯤", "ｉｏｓ"]
            .into_iter()
            .map(word)
            .collect();
        assert_eq!(format_words(&mut korean), 1);
        let texts: Vec<&str> = korean.iter().map(|word| word.text.as_str()).collect();
        assert_eq!(texts, ["2박", "3일", "600원이라는", "6시쯤", "iOS"]);

        // 词原子里混着汉字与西文时（切词没拆开的情形）同样不塞空格。
        let mut mixed: Vec<Word> = ["3月", "ｉｏｓ", "你", "好,"]
            .into_iter()
            .map(word)
            .collect();
        format_words(&mut mixed);
        let texts: Vec<&str> = mixed.iter().map(|word| word.text.as_str()).collect();
        assert_eq!(texts, ["3月", "iOS", "你", "好，"]);
    }

    #[test]
    fn protected_terms_remain_verbatim_and_receive_edge_spacing() {
        let terms = vec!["GitHub".to_owned()];
        let once =
            format_translation_with_options("使用GitHub管理代码", "zh", &terms, Options::default());
        assert_eq!(once, "使用 GitHub 管理代码");
        assert_eq!(
            format_translation_with_options(&once, "zh", &terms, Options::default()),
            once
        );

        let locked = vec!["版本...？！1,234".to_owned()];
        assert_eq!(
            format_translation_with_options(
                "使用版本...？！1,234发布...？！共1,234次",
                "zh-Hans",
                &locked,
                Options::default()
            ),
            "使用版本...？！1,234 发布…！共 1234 次"
        );
    }

    #[test]
    fn simplified_chinese_target_policy_is_deterministic_and_script_aware() {
        let input = "等等⋯...？！共1,234次，另有12,345次";
        assert_eq!(
            format_translation(input, "zh-Hans"),
            "等等…！共 1234 次，另有 12,345 次"
        );
        assert_eq!(
            format_translation(&format_translation(input, "zh"), "zh"),
            format_translation(input, "zh")
        );
        assert_eq!(format_translation(input, "zh-Hant"), format(input));
    }

    #[test]
    fn translation_map_respects_language_and_key_filter() {
        let mut map = BTreeMap::from([
            ("s-1".to_owned(), "在Claude里".to_owned()),
            ("s-2".to_owned(), "用AI写作".to_owned()),
        ]);
        let keys = BTreeSet::from(["s-2".to_owned()]);
        assert_eq!(format_translation_map(&mut map, "zh", Some(&keys), &[]), 1);
        assert_eq!(map["s-1"], "在Claude里");
        assert_eq!(map["s-2"], "用 AI 写作");
        assert_eq!(format_translation_map(&mut map, "en", None, &[]), 0);
    }
}
