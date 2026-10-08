//! 中文文本规范化：复刻上游 `text/zh_normalization`（源自 PaddleSpeech）的 `TextNormalizer.normalize`，
//! 含 `num.py`、`chronology.py`、`phonecode.py`、`quantifier.py`。上游已知的怪异行为照抄
//! （温度单位恒为「度」、时间段第二个「半」看的是第一个分钟）。

use std::cell::Cell;
use std::sync::LazyLock;

use fancy_regex::{Captures, Regex};

use super::data::T2S;
use super::error::PyError;
use super::words::COM_QUANTIFIERS;

const DIGITS: [&str; 10] = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const UNITS: [(usize, &str); 5] = [(8, "亿"), (4, "万"), (3, "千"), (2, "百"), (1, "十")];
const POWER: &str = "[⁰¹²³⁴⁵⁶⁷⁸⁹ˣʸⁿ]";

fn regex(pattern: &str) -> Regex {
    Regex::new(pattern).expect("zh_normalization 正则")
}

fn group<'t>(caps: &Captures<'t>, index: usize) -> &'t str {
    caps.get(index).map_or("", |m| m.as_str())
}

fn sub(re: &Regex, text: &str, replace: fn(&Captures) -> String) -> String {
    re.replace_all(text, |caps: &Captures| replace(caps)).into_owned()
}

fn sign(caps: &Captures, index: usize, word: &str) -> String {
    if group(caps, index).is_empty() {
        String::new()
    } else {
        word.to_owned()
    }
}

// ---- num.py ----

thread_local! {
    /// 替换回调的签名固定返回字符串，查表失败先记在这里，由 [`normalize`] 统一报错。
    static MISSING_DIGIT: Cell<bool> = const { Cell::new(false) };
}

/// `DIGITS[digit]`：上游的表只有 ASCII 数字，`\d` 匹配到的其他数字（如 `٣`）查表抛 KeyError。
fn digit_word(c: char, alt_one: bool) -> String {
    match c {
        '1' if alt_one => "幺".to_owned(),
        '0'..='9' => DIGITS[c as usize - '0' as usize].to_owned(),
        _ => {
            MISSING_DIGIT.set(true);
            c.to_string()
        }
    }
}

fn verbalize_digit(value: &str, alt_one: bool) -> String {
    value.chars().map(|c| digit_word(c, alt_one)).collect()
}

/// `_get_value(value_string, use_zero=True)`
fn get_value(value: &[char], out: &mut Vec<String>) {
    let zeros = value.iter().take_while(|&&c| c == '0').count();
    let stripped = &value[zeros..];
    match stripped.len() {
        0 => {}
        1 => {
            if zeros > 0 {
                out.push(DIGITS[0].to_owned());
            }
            out.push(verbalize_digit(&stripped[0].to_string(), false));
        }
        len => {
            let (power, unit) = UNITS.iter().copied().find(|(power, _)| *power < len).unwrap_or(UNITS[4]);
            let split = value.len() - power;
            get_value(&value[..split], out);
            out.push(unit.to_owned());
            get_value(&value[split..], out);
        }
    }
}

fn verbalize_cardinal(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = value.trim_start_matches('0').chars().collect();
    if chars.is_empty() {
        return DIGITS[0].to_owned();
    }
    let mut symbols = Vec::new();
    get_value(&chars, &mut symbols);
    if symbols.len() >= 2 && symbols[0] == "一" && symbols[1] == "十" {
        symbols.remove(0);
    }
    symbols.concat()
}

fn num2str(value: &str) -> String {
    let (integer, decimal) = value.split_once('.').unwrap_or((value, ""));
    let mut result = verbalize_cardinal(integer);
    let decimal = if decimal.ends_with('0') {
        format!("{}0", decimal.trim_end_matches('0'))
    } else {
        decimal.to_owned()
    };
    if !decimal.is_empty() {
        if result.is_empty() {
            result = DIGITS[0].to_owned();
        }
        result.push('点');
        result.push_str(&verbalize_digit(&decimal, false));
    }
    result
}

static RE_FRAC: LazyLock<Regex> = LazyLock::new(|| regex(r"(-?)(\d+)/(\d+)"));
fn replace_frac(caps: &Captures) -> String {
    format!("{}{}分之{}", sign(caps, 1, "负"), num2str(group(caps, 3)), num2str(group(caps, 2)))
}

static RE_PERCENTAGE: LazyLock<Regex> = LazyLock::new(|| regex(r"(-?)(\d+(\.\d+)?)%"));
fn replace_percentage(caps: &Captures) -> String {
    format!("{}百分之{}", sign(caps, 1, "负"), num2str(group(caps, 2)))
}

static RE_INTEGER: LazyLock<Regex> = LazyLock::new(|| regex(r"(-)(\d+)"));
fn replace_negative_num(caps: &Captures) -> String {
    format!("{}{}", sign(caps, 1, "负"), num2str(group(caps, 2)))
}

static RE_DEFAULT_NUM: LazyLock<Regex> = LazyLock::new(|| regex(r"\d{3}\d*"));
fn replace_default_num(caps: &Captures) -> String {
    verbalize_digit(group(caps, 0), true)
}

static RE_ASMD: LazyLock<Regex> = LazyLock::new(|| {
    let operand = format!(r"((-?)((\d+)(\.\d+)?{POWER}*)|(\.\d+{POWER}*)|([A-Za-z]{POWER}*))");
    regex(&format!(r"{operand}([+\-×÷=]){operand}"))
});
fn replace_asmd(caps: &Captures) -> String {
    let operator = match group(caps, 8) {
        "+" => "加",
        "-" => "减",
        "×" => "乘",
        "÷" => "除",
        _ => "等于",
    };
    format!("{}{operator}{}", group(caps, 1), group(caps, 9))
}

static RE_POWER: LazyLock<Regex> = LazyLock::new(|| regex(&format!("{POWER}+")));
fn replace_power(caps: &Captures) -> String {
    let power: String = group(caps, 0)
        .chars()
        .map(|c| match c {
            '⁰' => '0',
            '¹' => '1',
            '²' => '2',
            '³' => '3',
            '⁴' => '4',
            '⁵' => '5',
            '⁶' => '6',
            '⁷' => '7',
            '⁸' => '8',
            '⁹' => '9',
            'ˣ' => 'x',
            'ʸ' => 'y',
            _ => 'n',
        })
        .collect();
    format!("的{power}次方")
}

static RE_DECIMAL_NUM: LazyLock<Regex> = LazyLock::new(|| regex(r"(-?)((\d+)(\.\d+))|(\.(\d+))"));
static RE_POSITIVE_QUANTIFIERS: LazyLock<Regex> = LazyLock::new(|| regex(&format!(r"(\d+)([多余几\+])?{COM_QUANTIFIERS}")));
static RE_NUMBER: LazyLock<Regex> = LazyLock::new(|| regex(r"(-?)((\d+)(\.\d+)?)|(\.(\d+))"));

fn replace_positive_quantifier(caps: &Captures) -> String {
    let modifier = match group(caps, 2) {
        "+" => "多",
        other => other,
    };
    let number = num2str(group(caps, 1));
    let number = if number == "二" { "两".to_owned() } else { number };
    format!("{number}{modifier}{}", group(caps, 3))
}

fn replace_number(caps: &Captures) -> String {
    let pure_decimal = group(caps, 5);
    if !pure_decimal.is_empty() {
        num2str(pure_decimal)
    } else {
        format!("{}{}", sign(caps, 1, "负"), num2str(group(caps, 2)))
    }
}

static RE_RANGE: LazyLock<Regex> = LazyLock::new(|| regex(r"(?<![\d+\-×÷=])((-?)((\d+)(\.\d+)?))[-~]((-?)((\d+)(\.\d+)?))(?![\d+\-×÷=])"));
fn replace_range(caps: &Captures) -> String {
    format!(
        "{}到{}",
        sub(&RE_NUMBER, group(caps, 1), replace_number),
        sub(&RE_NUMBER, group(caps, 6), replace_number)
    )
}

static RE_TO_RANGE: LazyLock<Regex> = LazyLock::new(|| {
    let number = r"((-?)((\d+)(\.\d+)?)|(\.(\d+)))";
    let unit = "(%|°C|℃|度|摄氏度|cm2|cm²|cm3|cm³|cm|db|ds|kg|km|m2|m²|m³|m3|ml|m|mm|s)";
    regex(&format!("{number}{unit}[~]{number}{unit}"))
});
fn replace_to_range(caps: &Captures) -> String {
    group(caps, 0).replace('~', "至")
}

static RE_VERSION_NUM: LazyLock<Regex> = LazyLock::new(|| regex(r"((\d+)(\.\d+)(\.\d+)?(\.\d+)+)"));
fn replace_version_num(caps: &Captures) -> String {
    group(caps, 1)
        .chars()
        .map(|c| if c == '.' { "点".to_owned() } else { num2str(&c.to_string()) })
        .collect()
}

// ---- chronology.py ----

fn time_num2str(value: &str) -> String {
    let mut result = num2str(value.trim_start_matches('0'));
    if value.starts_with('0') {
        result.insert_str(0, DIGITS[0]);
    }
    result
}

const TIME: &str = r"([0-1]?[0-9]|2[0-3]):([0-5][0-9])(:([0-5][0-9]))?";
static RE_TIME: LazyLock<Regex> = LazyLock::new(|| regex(TIME));
static RE_TIME_RANGE: LazyLock<Regex> = LazyLock::new(|| regex(&format!("{TIME}(~|-){TIME}")));

fn time_part(result: &mut String, hour: &str, minute: &str, second: &str, half_minute: &str) {
    result.push_str(&num2str(hour));
    result.push('点');
    if !minute.trim_start_matches('0').is_empty() {
        if half_minute.parse::<u32>() == Ok(30) {
            result.push('半');
        } else {
            result.push_str(&time_num2str(minute));
            result.push('分');
        }
    }
    if !second.trim_start_matches('0').is_empty() {
        result.push_str(&time_num2str(second));
        result.push('秒');
    }
}

fn replace_time(caps: &Captures) -> String {
    let mut result = String::new();
    let minute = group(caps, 2);
    time_part(&mut result, group(caps, 1), minute, group(caps, 4), minute);
    result
}

fn replace_time_range(caps: &Captures) -> String {
    let mut result = String::new();
    let minute = group(caps, 2);
    time_part(&mut result, group(caps, 1), minute, group(caps, 4), minute);
    result.push('至');
    time_part(&mut result, group(caps, 6), group(caps, 7), group(caps, 9), minute);
    result
}

static RE_DATE: LazyLock<Regex> = LazyLock::new(|| regex(r"(\d{4}|\d{2})年((0?[1-9]|1[0-2])月)?(((0?[1-9])|((1|2)[0-9])|30|31)([日号]))?"));
fn replace_date(caps: &Captures) -> String {
    let mut result = String::new();
    let (year, month, day) = (group(caps, 1), group(caps, 3), group(caps, 5));
    if !year.is_empty() {
        result.push_str(&verbalize_digit(year, false));
        result.push('年');
    }
    if !month.is_empty() {
        result.push_str(&verbalize_cardinal(month));
        result.push('月');
    }
    if !day.is_empty() {
        result.push_str(&verbalize_cardinal(day));
        result.push_str(group(caps, 9));
    }
    result
}

static RE_DATE2: LazyLock<Regex> = LazyLock::new(|| regex(r"(\d{4})([- /.])(0[1-9]|1[012])\2(0[1-9]|[12][0-9]|3[01])"));
fn replace_date2(caps: &Captures) -> String {
    format!(
        "{}年{}月{}日",
        verbalize_digit(group(caps, 1), false),
        verbalize_cardinal(group(caps, 3)),
        verbalize_cardinal(group(caps, 4))
    )
}

// ---- phonecode.py ----

static RE_MOBILE_PHONE: LazyLock<Regex> = LazyLock::new(|| regex(r"(?<!\d)((\+?86 ?)?1([38]\d|5[0-35-9]|7[678]|9[89])\d{8})(?!\d)"));
static RE_TELEPHONE: LazyLock<Regex> = LazyLock::new(|| regex(r"(?<!\d)((0(10|2[1-3]|[3-9]\d{2})-?)?[1-9]\d{6,7})(?!\d)"));
static RE_NATIONAL_UNIFORM_NUMBER: LazyLock<Regex> = LazyLock::new(|| regex(r"(400)(-)?\d{3}(-)?\d{4}"));

fn replace_mobile(caps: &Captures) -> String {
    group(caps, 0)
        .trim_matches('+')
        .split_whitespace()
        .map(|part| verbalize_digit(part, true))
        .collect::<Vec<_>>()
        .join("，")
}

fn replace_phone(caps: &Captures) -> String {
    group(caps, 0)
        .split('-')
        .map(|part| verbalize_digit(part, true))
        .collect::<Vec<_>>()
        .join("，")
}

// ---- quantifier.py ----

static RE_TEMPERATURE: LazyLock<Regex> = LazyLock::new(|| regex(r"(-?)(\d+(\.\d+)?)(°C|℃|度|摄氏度)"));
fn replace_temperature(caps: &Captures) -> String {
    // 上游取的是 group(3)（小数部分），所以单位永远是「度」
    format!("{}{}度", sign(caps, 1, "零下"), num2str(group(caps, 2)))
}

const MEASURES: [(&str, &str); 17] = [
    ("cm2", "平方厘米"),
    ("cm²", "平方厘米"),
    ("cm3", "立方厘米"),
    ("cm³", "立方厘米"),
    ("cm", "厘米"),
    ("db", "分贝"),
    ("ds", "毫秒"),
    ("kg", "千克"),
    ("km", "千米"),
    ("m2", "平方米"),
    ("m²", "平方米"),
    ("m³", "立方米"),
    ("m3", "立方米"),
    ("ml", "毫升"),
    ("m", "米"),
    ("mm", "毫米"),
    ("s", "秒"),
];

// ---- text_normlization.py ----

fn full_to_half(c: char) -> char {
    match c {
        '\u{FF10}'..='\u{FF19}' | '\u{FF21}'..='\u{FF3A}' | '\u{FF41}'..='\u{FF5A}' => char::from_u32(c as u32 - 0xFEE0).unwrap_or(c),
        '\u{3000}' => ' ',
        _ => c,
    }
}

/// `TextNormalizer._split(text, lang="zh")`
fn split(text: &str) -> Vec<String> {
    const REMOVED: &str = "——《》【】<>{}()（）#&@“”^_|\\";
    const SPLITTERS: &str = "：、，；。？！,;?!";
    let chars: Vec<char> = text.chars().filter(|&c| c != ' ' && !REMOVED.contains(c)).collect();
    let mut joined = String::new();
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        joined.push(c);
        if SPLITTERS.contains(c) {
            if let Some(&quote) = chars.get(index + 1).filter(|&&q| q == '”' || q == '’') {
                joined.push(quote);
                index += 1;
            }
            joined.push('\n');
        }
        index += 1;
    }
    joined
        .trim()
        .split('\n')
        .filter(|sentence| !sentence.is_empty())
        .map(|sentence| sentence.trim().to_owned())
        .collect()
}

fn post_replace(sentence: &str) -> String {
    const REMOVED: &str = "——《》【】<>{}()（）#&@“”^_|\\";
    let mut out = String::with_capacity(sentence.len());
    for c in sentence.chars() {
        let replacement = match c {
            '/' => "每",
            '①' => "一",
            '②' => "二",
            '③' => "三",
            '④' => "四",
            '⑤' => "五",
            '⑥' => "六",
            '⑦' => "七",
            '⑧' => "八",
            '⑨' => "九",
            '⑩' => "十",
            'α' => "阿尔法",
            'β' => "贝塔",
            'γ' | 'Γ' => "伽玛",
            'δ' | 'Δ' => "德尔塔",
            'ε' => "艾普西龙",
            'ζ' => "捷塔",
            'η' => "依塔",
            'θ' | 'Θ' => "西塔",
            'ι' => "艾欧塔",
            'κ' => "喀帕",
            'λ' | 'Λ' => "拉姆达",
            'μ' => "缪",
            'ν' => "拗",
            'ξ' | 'Ξ' => "克西",
            'ο' => "欧米克伦",
            'π' | 'Π' => "派",
            'ρ' => "肉",
            'ς' | 'Σ' | 'σ' => "西格玛",
            'τ' => "套",
            'υ' => "宇普西龙",
            'φ' | 'Φ' => "服艾",
            'χ' => "器",
            'ψ' | 'Ψ' => "普赛",
            'ω' | 'Ω' => "欧米伽",
            '+' => "加",
            '-' => "减",
            '×' => "乘",
            '÷' => "除",
            '=' => "等",
            _ if REMOVED.contains(c) => "",
            _ => {
                out.push(c);
                continue;
            }
        };
        out.push_str(replacement);
    }
    out
}

fn normalize_sentence(sentence: &str) -> String {
    let mut s: String = sentence.chars().map(|c| full_to_half(T2S.get(&c).copied().unwrap_or(c))).collect();
    s = sub(&RE_DATE, &s, replace_date);
    s = sub(&RE_DATE2, &s, replace_date2);
    s = sub(&RE_TIME_RANGE, &s, replace_time_range);
    s = sub(&RE_TIME, &s, replace_time);
    s = sub(&RE_TO_RANGE, &s, replace_to_range);
    s = sub(&RE_TEMPERATURE, &s, replace_temperature);
    for (notation, word) in MEASURES {
        if s.contains(notation) {
            s = s.replace(notation, word);
        }
    }
    while RE_ASMD.is_match(&s).unwrap_or(false) {
        let next = sub(&RE_ASMD, &s, replace_asmd);
        if next == s {
            break;
        }
        s = next;
    }
    s = sub(&RE_POWER, &s, replace_power);
    s = sub(&RE_FRAC, &s, replace_frac);
    s = sub(&RE_PERCENTAGE, &s, replace_percentage);
    s = sub(&RE_MOBILE_PHONE, &s, replace_mobile);
    s = sub(&RE_TELEPHONE, &s, replace_phone);
    s = sub(&RE_NATIONAL_UNIFORM_NUMBER, &s, replace_phone);
    s = sub(&RE_RANGE, &s, replace_range);
    s = sub(&RE_INTEGER, &s, replace_negative_num);
    s = sub(&RE_VERSION_NUM, &s, replace_version_num);
    s = sub(&RE_DECIMAL_NUM, &s, replace_number);
    s = sub(&RE_POSITIVE_QUANTIFIERS, &s, replace_positive_quantifier);
    s = sub(&RE_DEFAULT_NUM, &s, replace_default_num);
    s = sub(&RE_NUMBER, &s, replace_number);
    post_replace(&s)
}

/// `TextNormalizer().normalize(text)`
pub fn normalize(text: &str) -> Result<Vec<String>, PyError> {
    MISSING_DIGIT.set(false);
    let sentences = split(text).iter().map(|s| normalize_sentence(s)).collect();
    if MISSING_DIGIT.replace(false) {
        Err(PyError::Key)
    } else {
        Ok(sentences)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cardinals() {
        assert_eq!(verbalize_cardinal("10"), "十");
        assert_eq!(verbalize_cardinal("10086"), "一万零八十六");
        assert_eq!(num2str("3.10"), "三点一零");
        assert_eq!(num2str(".5"), "零点五");
    }

    #[test]
    fn sentences() {
        assert_eq!(
            normalize("2024年3月5日12:30，涨了100%").unwrap(),
            ["二零二四年三月五日十二点半，", "涨了百分之一百"]
        );
        assert_eq!(normalize("٣, 0/5"), Err(PyError::Key));
    }
}
