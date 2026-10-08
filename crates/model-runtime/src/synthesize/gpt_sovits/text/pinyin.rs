//! 复刻 pypinyin 0.55 的 `lazy_pinyin(word, neutral_tone_with_five=True, style=INITIALS / FINALS_TONE3)`：
//! 汉字段做 mmseg 最长词组匹配，词组取整词读音，其余逐字取默认读音；非汉字段原样作为一项输出。

use super::data::{HAN_HI, NO_PINYIN, PINYIN};

fn is_hans(c: char) -> bool {
    ('\u{4E00}'..='\u{9FFF}').contains(&c)
}

fn phrase_index(word: &str) -> Result<usize, usize> {
    PINYIN.phrases.binary_search_by(|(phrase, _)| phrase.as_str().cmp(word))
}

fn is_prefix(word: &str) -> bool {
    let phrases = &PINYIN.phrases;
    let index = phrases.partition_point(|(phrase, _)| phrase.as_str() < word);
    index < phrases.len() && phrases[index].0.starts_with(word)
}

/// pypinyin `mmseg.Seg.cut`（前缀树逐字延长，失配时切出最近一次完整词组）。
fn mmseg(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut remain = text;
    'outer: while !remain.is_empty() {
        let mut last = 0;
        for (index, c) in remain.char_indices() {
            let end = index + c.len_utf8();
            let word = &remain[..end];
            if is_prefix(word) {
                if phrase_index(word).is_ok() {
                    last = end;
                }
            } else {
                let cut = if last > 0 {
                    last
                } else {
                    remain.chars().next().map_or(0, char::len_utf8)
                };
                out.push(&remain[..cut]);
                remain = &remain[cut..];
                continue 'outer;
            }
        }
        if last > 0 {
            out.push(&remain[..last]);
            remain = &remain[last..];
        } else {
            out.extend(remain.char_indices().map(|(i, c)| &remain[i..i + c.len_utf8()]));
            break;
        }
    }
    out
}

fn char_syllable(c: char) -> u16 {
    let code = c as u32;
    if (super::data::HAN_LO..=HAN_HI).contains(&code) {
        PINYIN.chars[(code - super::data::HAN_LO) as usize]
    } else {
        NO_PINYIN
    }
}

/// pypinyin `simpleseg._seg`：按「是否汉字」切成连续段。
fn hans_runs(word: &str) -> Vec<(&str, bool)> {
    let mut runs = Vec::new();
    let mut start = 0;
    let mut current = None;
    for (index, c) in word.char_indices() {
        let hans = is_hans(c);
        if let Some(previous) = current.filter(|&previous| previous != hans) {
            runs.push((&word[start..index], previous));
            start = index;
        }
        current = Some(hans);
    }
    if let Some(hans) = current {
        runs.push((&word[start..], hans));
    }
    runs
}

/// 返回 `(initials, finals)`，两者等长。
pub fn lazy(word: &str) -> (Vec<String>, Vec<String>) {
    let mut initials = Vec::new();
    let mut finals = Vec::new();
    let mut push = |initial: &str, final_: &str| {
        initials.push(initial.to_owned());
        finals.push(final_.to_owned());
    };
    for (run, hans) in hans_runs(word) {
        if !hans {
            push(run, run);
            continue;
        }
        for piece in mmseg(run) {
            let phrase_ids = phrase_index(piece).ok().and_then(|i| PINYIN.phrases[i].1.as_ref());
            for (offset, c) in piece.chars().enumerate() {
                let id = match phrase_ids {
                    Some(ids) => ids[offset],
                    None => char_syllable(c),
                };
                if id == NO_PINYIN {
                    let text = c.to_string();
                    push(&text, &text);
                } else {
                    let (initial, final_) = &PINYIN.syllables[id as usize];
                    push(initial, final_);
                }
            }
        }
    }
    (initials, finals)
}

/// 注音（`crate::synthesize::readings::annotate`）用：一段纯汉字的 mmseg 切分，与 [`lazy`] 同一种切法。
/// 多字词组带整词读音的音节 id；表里只存整词读音与逐字默认读音不同的词组，其余给 `None`。
pub(crate) fn segments(run: &str) -> Vec<(&str, Option<&'static [u16]>)> {
    let tables: &'static super::data::PinyinTables = &PINYIN;
    mmseg(run)
        .into_iter()
        .map(|piece| {
            let ids = phrase_index(piece).ok().and_then(|i| tables.phrases[i].1.as_deref());
            (piece, ids)
        })
        .collect()
}

/// 单字默认读音的音节 id；没有读音给 `None`。
pub(crate) fn default_syllable(c: char) -> Option<u16> {
    let id = char_syllable(c);
    (id != NO_PINYIN).then_some(id)
}

/// 音节 id → pypinyin `Style.TONE3` 写法（`hang2`、`lv4`、`ju4`、`yuan2`；轻声 `5`）。
/// 表里存的是 strict 声母 / 韵母，这里按拼写规则拼回（与 `zh.rs::syllable_phones` 同一套规则，
/// 另加 j / q / x 后 ü 写 u）。
pub(crate) fn tone3(id: u16) -> String {
    let (initial, final_) = &PINYIN.syllables[id as usize];
    let Some(tone) = final_.chars().last().filter(char::is_ascii_digit) else {
        return format!("{initial}{final_}");
    };
    let bare = &final_[..final_.len() - 1];
    let body = if !initial.is_empty() {
        let bare = match bare {
            "uei" => "ui",
            "iou" => "iu",
            "uen" => "un",
            other => other,
        };
        match (initial.as_str(), bare.strip_prefix('v')) {
            ("j" | "q" | "x", Some(rest)) => format!("{initial}u{rest}"),
            _ => format!("{initial}{bare}"),
        }
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
    format!("{body}{tone}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phrase_reading_and_non_hans_runs() {
        let (initials, finals) = lazy("银行,行走");
        assert_eq!(initials, ["", "h", ",", "x", "z"]);
        assert_eq!(finals, ["in2", "ang2", ",", "ing2", "ou3"]);
    }
}
