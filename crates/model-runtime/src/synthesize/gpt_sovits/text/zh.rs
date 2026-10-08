//! 中文 G2P：复刻上游 `text/chinese2.py` 关闭 G2PW 时的 pypinyin 路径，以及 `cleaner.clean_text`
//! 对中文段的特殊静音符处理。

use super::data::OPENCPOP;
use super::error::PyError;
use super::jieba;
use super::split::replace_consecutive_punctuation;
use super::tone_sandhi::{self, Seg};
use super::words::{self, MUST_ERHUA, NOT_ERHUA};
use super::{pinyin, zh_norm};

/// `text.symbols.punctuation`（含后加的 `-`）。
pub const PUNCTUATION: &[char] = &['!', '?', '…', ',', '.', '-'];

/// `replace_punctuation`
fn replace_punctuation(text: &str) -> String {
    let text = text.replace('嗯', "恩").replace('呣', "母");
    let mut out = String::with_capacity(text.len());
    let mut rest = text.as_str();
    while let Some(c) = rest.chars().next() {
        if let Some(tail) = rest.strip_prefix("...") {
            out.push('…');
            rest = tail;
            continue;
        }
        rest = &rest[c.len_utf8()..];
        let mapped = match c {
            '：' | '；' | '，' | '·' | '、' | '/' => ',',
            '。' | '\n' | '$' => '.',
            '！' => '!',
            '？' => '?',
            '—' => '-',
            '~' | '～' => '…',
            other => other,
        };
        if ('\u{4E00}'..='\u{9FA5}').contains(&mapped) || PUNCTUATION.contains(&mapped) {
            out.push(mapped);
        }
    }
    out
}

/// `text_normalize`
pub fn text_normalize(text: &str) -> Result<String, PyError> {
    let joined: String = zh_norm::normalize(text)?
        .iter()
        .map(|sentence| replace_punctuation(sentence))
        .collect();
    Ok(replace_consecutive_punctuation(&joined))
}

/// `_merge_erhua`
fn merge_erhua(finals: &mut [String], word: &str, pos: &str) {
    let chars: Vec<char> = word.chars().collect();
    if let Some(last) = finals.len().checked_sub(1) {
        if chars.get(last) == Some(&'儿') && finals[last] == "er1" {
            finals[last] = "er2".to_owned();
        }
    }
    if !words::contains(MUST_ERHUA, word) && (words::contains(NOT_ERHUA, word) || matches!(pos, "a" | "j" | "nr")) {
        return;
    }
    let n = finals.len();
    if n != chars.len() || n < 2 {
        return;
    }
    let tail: String = chars[n - 2..].iter().collect();
    if chars[n - 1] == '儿' && matches!(finals[n - 1].as_str(), "er2" | "er5") && !words::contains(NOT_ERHUA, &tail) {
        if let Some(tone) = finals[n - 2].chars().last() {
            finals[n - 1] = format!("er{tone}");
        }
    }
}

/// `re.split(r"(?<=[!?…,.-])\s*", text)` 后丢掉空白句。
fn split_after_punctuation(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();
    let mut skipping = false;
    for c in text.chars() {
        if skipping && c.is_whitespace() {
            continue;
        }
        skipping = false;
        current.push(c);
        if PUNCTUATION.contains(&c) {
            sentences.push(std::mem::take(&mut current));
            skipping = true;
        }
    }
    sentences.push(current);
    sentences.retain(|sentence| !sentence.trim().is_empty());
    sentences
}

/// 声母 + 带调韵母 → opencpop 音素；查不到时返回 `None`。
fn syllable_phones(initial: &str, final_: &str) -> Option<[String; 2]> {
    let tone = final_.chars().last().filter(|t| ('1'..='5').contains(t))?;
    let bare = &final_[..final_.len() - 1];
    let pinyin = if !initial.is_empty() {
        let bare = match bare {
            "uei" => "ui",
            "iou" => "iu",
            "uen" => "un",
            other => other,
        };
        format!("{initial}{bare}")
    } else {
        match bare {
            "ing" => "ying".to_owned(),
            "i" => "yi".to_owned(),
            "in" => "yin".to_owned(),
            "u" => "wu".to_owned(),
            _ => {
                let mut chars = bare.chars();
                match chars.next() {
                    Some('v') => format!("yu{}", chars.as_str()),
                    Some('i') => format!("y{}", chars.as_str()),
                    Some('u') => format!("w{}", chars.as_str()),
                    _ => bare.to_owned(),
                }
            }
        }
    };
    let (new_initial, new_final) = OPENCPOP.get(&pinyin)?;
    Some([new_initial.clone(), format!("{new_final}{tone}")])
}

/// `g2p(norm_text)` → `(phones, word2ph)`；`word2ph` 与 `norm_text` 逐字对应。
pub fn g2p(text: &str) -> (Vec<String>, Vec<usize>) {
    let mut phones = Vec::new();
    let mut word2ph = Vec::new();
    for sentence in split_after_punctuation(text) {
        let sentence: String = sentence.chars().filter(|c| !c.is_ascii_alphabetic()).collect();
        let seg: Seg = jieba::posseg(&sentence);
        let mut initials = Vec::new();
        let mut finals = Vec::new();
        for (word, pos) in tone_sandhi::pre_merge_for_modify(seg) {
            if pos == "eng" {
                continue;
            }
            let (sub_initials, sub_finals) = pinyin::lazy(&word);
            let mut sub_finals = tone_sandhi::modified_tone(&word, &pos, sub_finals);
            merge_erhua(&mut sub_finals, &word, &pos);
            initials.extend(sub_initials);
            finals.extend(sub_finals);
        }
        for (initial, final_) in initials.iter().zip(&finals) {
            let single = |symbol: &str| {
                let mut chars = symbol.chars();
                match (chars.next(), chars.next()) {
                    (Some(c), None) if PUNCTUATION.contains(&c) => symbol.to_owned(),
                    _ => "UNK".to_owned(),
                }
            };
            if initial == final_ {
                phones.push(single(initial));
                word2ph.push(1);
            } else if let Some(pair) = syllable_phones(initial, final_) {
                phones.extend(pair);
                word2ph.push(2);
            } else {
                phones.push("UNK".to_owned());
                word2ph.push(1);
            }
        }
    }
    (phones, word2ph)
}

/// `cleaner.clean_text(text, "zh")` → `(phones, word2ph, norm_text)`。
pub fn clean(text: &str) -> Result<(Vec<String>, Vec<usize>, String), PyError> {
    for (special, target) in [('￥', "SP2"), ('^', "SP3")] {
        if text.contains(special) {
            let norm_text = text_normalize(&text.replace(special, ","))?;
            let (phones, word2ph) = g2p(&norm_text);
            let phones = phones
                .into_iter()
                .map(|phone| if phone == "," { target.to_owned() } else { phone })
                .collect();
            return Ok((phones, word2ph, norm_text));
        }
    }
    let norm_text = text_normalize(text)?;
    let (phones, word2ph) = g2p(&norm_text);
    Ok((phones, word2ph, norm_text))
}
