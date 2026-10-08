//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/IndexTTS2TTS/IndexTTS2TextNormalizer.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! 数字读法归一化：对照 speech-swift `IndexTTS2TextNormalizer.swift` 移植。
//!
//! 代替上游 WeTextProcessing（`tn.chinese` / `tn.english`）的一个紧凑实现：
//! 词表里没有数字 piece，留着的数字都会变成 `<unk>`，所以在 `char_rep_map`
//! 与 CJK 预切分之前先把基数、年份、时刻、小数、百分比、分数、金额、序数、
//! 负数、千分位与手机号读出来；其他内容原样保留。它不是上游 FST 语法的移植。

use crate::synthesize::readings::{PIECE_CLOSE, PIECE_OPEN};
use fancy_regex::Regex;
use std::sync::LazyLock;

pub struct TextNormalizer;

/// 数字规范化期间代替一个拼音片的占位字符（私用区；不是数字、拉丁字母或汉字）。
const PIECE_PLACEHOLDER: char = '\u{E002}';

impl TextNormalizer {
    /// 注音渲染出的拼音片（`PIECE_OPEN`…`PIECE_CLOSE` 包住的 `XING2`）先换成占位字符、规范化之后
    /// 再还原成两侧带空格的片（上游 `_protect_pinyin` 同款），声调数字不会被读成「二」，
    /// 片也不会与相邻拉丁字母粘成一个词。只护这对哨兵包住的片，正文里的 `A4`、`AI2.0` 照旧规范化。
    pub fn normalize(text: &str) -> String {
        if !text.contains(PIECE_OPEN) && !text.contains(PIECE_CLOSE) {
            return Self::normalize_plain(text);
        }
        let mut pieces = Vec::new();
        let mut protected = String::with_capacity(text.len());
        let mut rest = text;
        while let Some(open) = rest.find(PIECE_OPEN) {
            protected.push_str(&rest[..open]);
            let after = &rest[open + PIECE_OPEN.len_utf8()..];
            match after.find(PIECE_CLOSE) {
                Some(close) => {
                    pieces.push(&after[..close]);
                    protected.push(PIECE_PLACEHOLDER);
                    rest = &after[close + PIECE_CLOSE.len_utf8()..];
                }
                None => rest = after,
            }
        }
        protected.push_str(rest);
        protected.retain(|c| c != PIECE_CLOSE);
        let normalized = Self::normalize_plain(&protected);
        let mut pieces = pieces.into_iter();
        let mut out = String::with_capacity(normalized.len() + 8);
        for c in normalized.chars() {
            if c == PIECE_PLACEHOLDER {
                out.push(' ');
                out.push_str(pieces.next().unwrap_or_default());
                out.push(' ');
            } else {
                out.push(c);
            }
        }
        out
    }

    fn normalize_plain(text: &str) -> String {
        if !text.chars().any(is_digit) {
            return text.to_string();
        }
        let folded = fold_fullwidth_digits(text);
        if Self::uses_chinese_front_end(&folded) {
            normalize_chinese(&folded)
        } else {
            normalize_english(&folded)
        }
    }

    /// 上游 `use_chinese`：含汉字，或完全没有拉丁字母。
    pub fn uses_chinese_front_end(text: &str) -> bool {
        let has_han = text.chars().any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c));
        let has_latin = text.chars().any(is_latin_letter);
        has_han || !has_latin
    }
}

// MARK: - 中文

fn normalize_chinese(text: &str) -> String {
    let mut s = strip_thousands_separators(text);
    s = ZH_PERCENT.replace(&s, false, |g| format!("百分之{}", zh_number(&g[1])));
    s = FRACTION.replace(&s, false, |g| format!("{}分之{}", zh_cardinal(&g[2]), zh_cardinal(&g[1])));
    s = ZH_DOLLARS.replace(&s, false, |g| format!("{}美元", zh_number(&g[1])));
    s = ZH_YUAN.replace(&s, false, |g| format!("{}元", zh_number(&g[1])));
    s = CLOCK_TIME.replace(&s, false, |g| {
        let minute = g[2].as_str();
        let mut reading = format!("{}点", zh_cardinal(&g[1]));
        if minute != "00" {
            let minutes = if let Some(rest) = minute.strip_prefix('0') {
                format!("零{}", zh_digits(rest))
            } else {
                zh_cardinal(minute)
            };
            reading.push_str(&minutes);
            reading.push('分');
        }
        reading
    });
    s = ZH_YEAR.replace(&s, false, |g| format!("{}年", zh_digits(&g[1])));
    s = ZH_MOBILE_NUMBER.replace(&s, false, |g| zh_digits(&g[1]));
    s = NEGATIVE.replace(&s, false, |g| format!("负{}", zh_number(&g[1])));
    s = DECIMAL.replace(&s, false, |g| format!("{}点{}", zh_cardinal(&g[1]), zh_digits(&g[2])));
    s = INTEGER.replace(&s, false, |g| zh_integer(&g[0]));
    s
}

const ZH_NUMERALS: [&str; 10] = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const ZH_UNITS: [&str; 4] = ["", "十", "百", "千"];
const ZH_SECTIONS: [&str; 3] = ["", "万", "亿"];

fn zh_number(s: &str) -> String {
    match s.find('.') {
        Some(dot) => format!("{}点{}", zh_cardinal(&s[..dot]), zh_digits(&s[dot + 1..])),
        None => zh_integer(s),
    }
}

fn zh_integer(digits: &str) -> String {
    let count = digits.chars().count();
    if (digits.starts_with('0') && count > 1) || count > 12 {
        zh_digits(digits)
    } else {
        zh_cardinal(digits)
    }
}

fn zh_digits(digits: &str) -> String {
    digits
        .chars()
        .filter_map(|c| c.to_digit(10).map(|d| ZH_NUMERALS[d as usize]))
        .collect()
}

/// 带 万 / 亿 节的标准基数读法，零段只读一个「零」。
fn zh_cardinal(digit_string: &str) -> String {
    let all: Vec<usize> = digit_string.chars().filter_map(|c| c.to_digit(10).map(|d| d as usize)).collect();
    let first = all.iter().position(|d| *d != 0);
    let (Some(first), true) = (first, all.len() <= 12) else {
        if all.is_empty() {
            return String::new();
        }
        return if all.iter().all(|d| *d == 0) {
            "零".to_string()
        } else {
            zh_digits(digit_string)
        };
    };
    let digits = &all[first..];
    let mut result = String::new();
    let mut pending_zero = false;
    let mut section_has_value = false;
    for (index, digit) in digits.iter().enumerate() {
        let position = digits.len() - 1 - index;
        let unit = position % 4;
        let section = position / 4;
        if *digit == 0 {
            pending_zero = !result.is_empty();
        } else {
            if pending_zero {
                result.push('零');
            }
            pending_zero = false;
            section_has_value = true;
            result.push_str(ZH_NUMERALS[*digit]);
            result.push_str(ZH_UNITS[unit]);
        }
        if unit == 0 && section > 0 {
            if section_has_value {
                result.push_str(ZH_SECTIONS[section]);
                pending_zero = false;
            }
            section_has_value = false;
        }
    }
    if let Some(rest) = result.strip_prefix("一十") {
        result = format!("十{rest}");
    }
    result
}

// MARK: - 英文

fn normalize_english(text: &str) -> String {
    let mut s = strip_thousands_separators(text);
    s = EN_ORDINAL.replace(&s, true, |g| en_ordinal(&g[1]));
    s = EN_PERCENT.replace(&s, true, |g| format!("{} percent", en_number(&g[1])));
    s = EN_DOLLARS.replace(&s, true, |g| en_money(&g[1], &g[2]));
    s = CLOCK_TIME.replace(&s, true, |g| en_time(&g[1], &g[2]));
    s = NEGATIVE.replace(&s, true, |g| format!("minus {}", en_number(&g[1])));
    s = DECIMAL.replace(&s, true, |g| format!("{} point {}", en_cardinal_str(&g[1]), en_digits(&g[2])));
    s = EN_YEAR.replace(&s, true, |g| en_year(&g[1]));
    s = INTEGER.replace(&s, true, |g| en_integer(&g[0]));
    s
}

const EN_ONES: [&str; 20] = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
];
const EN_TENS: [&str; 10] = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const EN_SCALES: [&str; 5] = ["", "thousand", "million", "billion", "trillion"];

fn en_irregular_ordinal(word: &str) -> Option<&'static str> {
    Some(match word {
        "one" => "first",
        "two" => "second",
        "three" => "third",
        "five" => "fifth",
        "eight" => "eighth",
        "nine" => "ninth",
        "twelve" => "twelfth",
        _ => return None,
    })
}

fn en_number(s: &str) -> String {
    match s.find('.') {
        Some(dot) => format!("{} point {}", en_cardinal_str(&s[..dot]), en_digits(&s[dot + 1..])),
        None => en_integer(s),
    }
}

fn en_integer(digits: &str) -> String {
    let count = digits.chars().count();
    if (digits.starts_with('0') && count > 1) || count > 15 {
        en_digits(digits)
    } else {
        en_cardinal_str(digits)
    }
}

fn en_digits(digits: &str) -> String {
    digits
        .chars()
        .filter_map(|c| c.to_digit(10).map(|d| EN_ONES[d as usize]))
        .collect::<Vec<_>>()
        .join(" ")
}

fn en_cardinal_str(digit_string: &str) -> String {
    match digit_string.parse::<u64>() {
        Ok(value) => en_cardinal(value),
        Err(_) => digit_string.to_string(),
    }
}

fn en_cardinal(value: u64) -> String {
    if value < 20 {
        return EN_ONES[value as usize].to_string();
    }
    if value < 100 {
        let tens = EN_TENS[(value / 10) as usize];
        return if value % 10 == 0 {
            tens.to_string()
        } else {
            format!("{tens} {}", EN_ONES[(value % 10) as usize])
        };
    }
    if value < 1_000 {
        let hundreds = format!("{} hundred", EN_ONES[(value / 100) as usize]);
        return if value % 100 == 0 {
            hundreds
        } else {
            format!("{hundreds} {}", en_cardinal(value % 100))
        };
    }
    let mut remainder = value;
    let mut scale = 0usize;
    let mut parts: Vec<String> = Vec::new();
    while remainder > 0 && scale < EN_SCALES.len() {
        let chunk = remainder % 1_000;
        if chunk > 0 {
            let part = if scale == 0 {
                en_cardinal(chunk)
            } else {
                format!("{} {}", en_cardinal(chunk), EN_SCALES[scale])
            };
            parts.insert(0, part);
        }
        remainder /= 1_000;
        scale += 1;
    }
    parts.join(" ")
}

fn en_ordinal(digits: &str) -> String {
    let mut words: Vec<String> = en_cardinal_str(digits)
        .split(' ')
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect();
    let Some(last) = words.pop() else {
        return digits.to_string();
    };
    let ordinal = if let Some(irregular) = en_irregular_ordinal(&last) {
        irregular.to_string()
    } else if let Some(stem) = last.strip_suffix('y') {
        format!("{stem}ieth")
    } else {
        format!("{last}th")
    };
    words.push(ordinal);
    words.join(" ")
}

fn en_year(digits: &str) -> String {
    let Ok(year) = digits.parse::<u64>() else {
        return en_cardinal_str(digits);
    };
    if !(1_100..=2_099).contains(&year) {
        return en_cardinal_str(digits);
    }
    let high = year / 100;
    let low = year % 100;
    if (2_000..=2_009).contains(&year) {
        return if low == 0 {
            "two thousand".to_string()
        } else {
            format!("two thousand {}", en_cardinal(low))
        };
    }
    if low == 0 {
        return format!("{} hundred", en_cardinal(high));
    }
    if low < 10 {
        return format!("{} oh {}", en_cardinal(high), EN_ONES[low as usize]);
    }
    format!("{} {}", en_cardinal(high), en_cardinal(low))
}

fn en_money(dollars: &str, cents: &str) -> String {
    let dollar_value = dollars.parse::<u64>().unwrap_or(0);
    let cent_value = if cents.is_empty() {
        0
    } else if cents.chars().count() == 1 {
        format!("{cents}0").parse::<u64>().unwrap_or(0)
    } else {
        cents.parse::<u64>().unwrap_or(0)
    };
    let mut parts: Vec<String> = Vec::new();
    if dollar_value > 0 || cent_value == 0 {
        let unit = if dollar_value == 1 { " dollar" } else { " dollars" };
        parts.push(format!("{}{unit}", en_cardinal(dollar_value)));
    }
    if cent_value > 0 {
        let unit = if cent_value == 1 { " cent" } else { " cents" };
        parts.push(format!("{}{unit}", en_cardinal(cent_value)));
    }
    parts.join(" ")
}

fn en_time(hour: &str, minute: &str) -> String {
    let hour_words = en_cardinal_str(hour);
    let Ok(minute_value) = minute.parse::<u64>() else {
        return hour_words;
    };
    if minute_value == 0 {
        return format!("{hour_words} o'clock");
    }
    if minute_value < 10 {
        return format!("{hour_words} oh {}", EN_ONES[minute_value as usize]);
    }
    format!("{hour_words} {}", en_cardinal(minute_value))
}

// MARK: - 共享模式

struct Pattern(Regex);

impl Pattern {
    fn new(pattern: &str) -> Self {
        // 模式都是静态字面量，写错属于编程错误。
        Self(Regex::new(pattern).expect("静态正则应能编译"))
    }

    /// 把每个匹配替换成 `transform(groups)`，`groups[0]` 是整段匹配。
    /// `pad_letters` 时，替换文本紧邻拉丁字母的一侧补一个空格，让数字词保持独立。
    fn replace(&self, text: &str, pad_letters: bool, transform: impl Fn(&[String]) -> String) -> String {
        let mut result = String::with_capacity(text.len());
        let mut cursor = 0usize;
        let mut matched = false;
        for captures in self.0.captures_iter(text) {
            let Ok(captures) = captures else { break };
            let Some(whole) = captures.get(0) else {
                continue;
            };
            matched = true;
            let groups: Vec<String> = (0..captures.len())
                .map(|index| captures.get(index).map(|m| m.as_str().to_string()).unwrap_or_default())
                .collect();
            let mut replacement = transform(&groups);
            if pad_letters {
                if text[..whole.start()].chars().next_back().is_some_and(is_latin_letter) {
                    replacement.insert(0, ' ');
                }
                if text[whole.end()..].chars().next().is_some_and(is_latin_letter) {
                    replacement.push(' ');
                }
            }
            result.push_str(&text[cursor..whole.start()]);
            result.push_str(&replacement);
            cursor = whole.end();
        }
        if !matched {
            return text.to_string();
        }
        result.push_str(&text[cursor..]);
        result
    }
}

static THOUSANDS_SEPARATOR: LazyLock<Pattern> = LazyLock::new(|| Pattern::new("(?<=[0-9])[,，](?=[0-9]{3}(?![0-9]))"));
static FRACTION: LazyLock<Pattern> = LazyLock::new(|| Pattern::new("(?<![0-9])([0-9]+)/([0-9]+)(?![0-9])"));
static CLOCK_TIME: LazyLock<Pattern> = LazyLock::new(|| Pattern::new("(?<![0-9])([0-9]{1,2}):([0-9]{2})(?![0-9:])"));
static NEGATIVE: LazyLock<Pattern> = LazyLock::new(|| Pattern::new("(?<![0-9A-Za-z])-([0-9]+(?:\\.[0-9]+)?)"));
static DECIMAL: LazyLock<Pattern> = LazyLock::new(|| Pattern::new("([0-9]+)\\.([0-9]+)"));
static INTEGER: LazyLock<Pattern> = LazyLock::new(|| Pattern::new("[0-9]+"));
static ZH_PERCENT: LazyLock<Pattern> = LazyLock::new(|| Pattern::new("([0-9]+(?:\\.[0-9]+)?)\\s*[%％]"));
static ZH_DOLLARS: LazyLock<Pattern> = LazyLock::new(|| Pattern::new("[$＄]([0-9]+(?:\\.[0-9]+)?)"));
static ZH_YUAN: LazyLock<Pattern> = LazyLock::new(|| Pattern::new("[¥￥]([0-9]+(?:\\.[0-9]+)?)"));
static ZH_YEAR: LazyLock<Pattern> = LazyLock::new(|| Pattern::new("(?<![0-9])([0-9]{2,4})年"));
static ZH_MOBILE_NUMBER: LazyLock<Pattern> = LazyLock::new(|| Pattern::new("(?<![0-9])(1[3-9][0-9]{9})(?![0-9])"));
static EN_ORDINAL: LazyLock<Pattern> = LazyLock::new(|| Pattern::new("(?i)(?<![0-9])([0-9]+)(?:st|nd|rd|th)\\b"));
static EN_PERCENT: LazyLock<Pattern> = LazyLock::new(|| Pattern::new("([0-9]+(?:\\.[0-9]+)?)\\s*%"));
static EN_DOLLARS: LazyLock<Pattern> = LazyLock::new(|| Pattern::new("\\$([0-9]+)(?:\\.([0-9]{1,2}))?(?![0-9])"));
static EN_YEAR: LazyLock<Pattern> = LazyLock::new(|| Pattern::new("(?<![0-9A-Za-z])([1-9][0-9]{3})(?![0-9A-Za-z])"));

fn strip_thousands_separators(text: &str) -> String {
    THOUSANDS_SEPARATOR.replace(text, false, |_| String::new())
}

fn fold_fullwidth_digits(text: &str) -> String {
    text.chars()
        .map(|c| {
            let value = c as u32;
            if (0xFF10..=0xFF19).contains(&value) {
                char::from_u32(value - 0xFF10 + 0x30).unwrap_or(c)
            } else {
                c
            }
        })
        .collect()
}

fn is_digit(c: char) -> bool {
    c.is_ascii_digit() || (0xFF10..=0xFF19).contains(&(c as u32))
}

fn is_latin_letter(c: char) -> bool {
    c.is_ascii_alphabetic()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinyin_pieces_survive_number_normalization() {
        let open = PIECE_OPEN;
        let close = PIECE_CLOSE;
        assert_eq!(
            TextNormalizer::normalize(&format!("他才{open}XING2{close}，走了3步")),
            "他才 XING2 ，走了三步"
        );
        // 没有数字时也要去掉哨兵。
        assert_eq!(TextNormalizer::normalize(&format!("觉得{open}XING2{close}")), "觉得 XING2 ");
        // 整句只剩拼音片也走中文路径（不会被当成英文把 2 读成 two）。
        assert_eq!(TextNormalizer::normalize(&format!("{open}HANG2{close}")), " HANG2 ");
        // 没被哨兵包住的字母数字照旧规范化。
        assert_eq!(TextNormalizer::normalize("A4纸"), "A四纸");
    }

    #[test]
    fn text_without_digits_is_untouched() {
        assert_eq!(
            TextNormalizer::normalize("宝剪是一个本地视频工作流工具"),
            "宝剪是一个本地视频工作流工具"
        );
        assert_eq!(TextNormalizer::normalize("Hello, world."), "Hello, world.");
    }

    #[test]
    fn chinese_numbers() {
        assert_eq!(TextNormalizer::normalize("共有1,234个文件"), "共有一千二百三十四个文件");
        assert_eq!(TextNormalizer::normalize("上涨了12.5%"), "上涨了百分之十二点五");
        assert_eq!(TextNormalizer::normalize("2024年3月"), "二零二四年三月");
        assert_eq!(TextNormalizer::normalize("现在是8:05"), "现在是八点零五分");
        assert_eq!(TextNormalizer::normalize("现在是18:30"), "现在是十八点三十分");
        assert_eq!(TextNormalizer::normalize("现在是9:00"), "现在是九点");
        assert_eq!(TextNormalizer::normalize("3/4"), "四分之三");
        assert_eq!(TextNormalizer::normalize("售价¥99.9"), "售价九十九点九元");
        assert_eq!(TextNormalizer::normalize("售价$100"), "售价一百美元");
        assert_eq!(TextNormalizer::normalize("温度-5度"), "温度负五度");
        assert_eq!(TextNormalizer::normalize("电话13812345678"), "电话一三八一二三四五六七八");
        assert_eq!(TextNormalizer::normalize("编号007"), "编号零零七");
        assert_eq!(TextNormalizer::normalize("１０个"), "十个");
    }

    #[test]
    fn chinese_cardinal_sections() {
        assert_eq!(zh_cardinal("10"), "十");
        assert_eq!(zh_cardinal("110"), "一百一十");
        assert_eq!(zh_cardinal("1005"), "一千零五");
        assert_eq!(zh_cardinal("10500"), "一万零五百");
        assert_eq!(zh_cardinal("100000000"), "一亿");
        assert_eq!(zh_cardinal("120000305"), "一亿二千万零三百零五");
        assert_eq!(zh_cardinal("0"), "零");
        assert_eq!(zh_cardinal("000"), "零");
    }

    #[test]
    fn english_numbers() {
        assert_eq!(TextNormalizer::normalize("I have 21 cats"), "I have twenty one cats");
        assert_eq!(TextNormalizer::normalize("in 1999"), "in nineteen ninety nine");
        assert_eq!(TextNormalizer::normalize("in 2005"), "in two thousand five");
        assert_eq!(TextNormalizer::normalize("in 1900"), "in nineteen hundred");
        assert_eq!(TextNormalizer::normalize("in 1905"), "in nineteen oh five");
        assert_eq!(TextNormalizer::normalize("the 3rd time"), "the third time");
        assert_eq!(TextNormalizer::normalize("the 22nd time"), "the twenty second time");
        assert_eq!(TextNormalizer::normalize("the 20th time"), "the twentieth time");
        assert_eq!(TextNormalizer::normalize("about 50%"), "about fifty percent");
        assert_eq!(TextNormalizer::normalize("costs $1.50"), "costs one dollar fifty cents");
        assert_eq!(TextNormalizer::normalize("costs $2.5"), "costs two dollars fifty cents");
        assert_eq!(TextNormalizer::normalize("costs $0.01"), "costs one cent");
        assert_eq!(TextNormalizer::normalize("at 7:00"), "at seven o'clock");
        assert_eq!(TextNormalizer::normalize("at 7:05"), "at seven oh five");
        assert_eq!(TextNormalizer::normalize("it is -3.5 now"), "it is minus three point five now");
        assert_eq!(
            TextNormalizer::normalize("1,234,567 items"),
            "one million two hundred thirty four thousand five hundred sixty seven items"
        );
        assert_eq!(TextNormalizer::normalize("room101"), "room one hundred one");
        assert_eq!(TextNormalizer::normalize("x2y"), "x two y");
    }
}
