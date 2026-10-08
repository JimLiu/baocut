//! 声调变调：复刻上游 `text/tone_sandhi.py` 的 `ToneSandhi`（源自 PaddleSpeech）。
//!
//! 韵母形如 `ian4`，末位是声调；「改 N 声」即替换末位字符。

use super::jieba;
use super::pinyin;
use super::pychar;
use super::words::{self, MUST_NEURAL_TONE_WORDS, MUST_NOT_NEURAL_TONE_WORDS};

/// `(词, 词性)` 序列。
pub type Seg = Vec<(String, String)>;

const PUNC: &str = "：，；。？！“”‘’':,;.?!";

fn char_len(s: &str) -> usize {
    s.chars().count()
}

fn set_tone(finals: &mut [String], index: usize, tone: char) {
    if let Some(final_) = finals.get_mut(index) {
        final_.pop();
        final_.push(tone);
    }
}

fn set_last_tone(finals: &mut [String], tone: char) {
    if let Some(index) = finals.len().checked_sub(1) {
        set_tone(finals, index, tone);
    }
}

fn tone_is(final_: Option<&String>, tone: char) -> bool {
    final_.is_some_and(|f| f.ends_with(tone))
}

fn all_tone_three(finals: &[String]) -> bool {
    finals.iter().all(|f| f.ends_with('3'))
}

/// `word in must_neural_tone_words or word[-2:] in must_neural_tone_words`
fn is_must_neural(word: &str) -> bool {
    let chars: Vec<char> = word.chars().collect();
    let tail: String = chars[chars.len().saturating_sub(2)..].iter().collect();
    words::contains(MUST_NEURAL_TONE_WORDS, word) || words::contains(MUST_NEURAL_TONE_WORDS, &tail)
}

fn is_reduplication(word: &str) -> bool {
    let chars: Vec<char> = word.chars().collect();
    chars.len() == 2 && chars[0] == chars[1]
}

fn merge_bu(seg: Seg) -> Seg {
    let mut out = Vec::new();
    let mut last = String::new();
    for (word, pos) in seg {
        let word = if last == "不" { format!("不{word}") } else { word };
        if word != "不" {
            out.push((word.clone(), pos));
        }
        last = word;
    }
    if last == "不" {
        out.push(("不".to_owned(), "d".to_owned()));
    }
    out
}

fn merge_yi(seg: Seg) -> Seg {
    let mut first: Seg = Vec::new();
    let mut i = 0;
    while i < seg.len() {
        let (word, pos) = &seg[i];
        if i >= 1 && word == "一" && i + 1 < seg.len() {
            let last = first.last().unwrap_or(&seg[i - 1]).clone();
            if last.0 == seg[i + 1].0 && last.1 == "v" && seg[i + 1].1 == "v" {
                let Some(slot) = first.last_mut() else {
                    // 上游在这里抛 IndexError 并被吞掉，seg 原样返回
                    return seg;
                };
                *slot = (format!("{}一{}", last.0, seg[i + 1].0), last.1);
                i += 2;
                continue;
            }
        }
        first.push((word.clone(), pos.clone()));
        i += 1;
    }
    let mut out: Seg = Vec::new();
    for (word, pos) in first {
        match out.last_mut() {
            Some(last) if last.0 == "一" => last.0.push_str(&word),
            _ => out.push((word, pos)),
        }
    }
    out
}

fn merge_reduplication(seg: Seg) -> Seg {
    let mut out: Seg = Vec::new();
    for (word, pos) in seg {
        match out.last_mut() {
            Some(last) if last.0 == word => last.0.push_str(&word),
            _ => out.push((word, pos)),
        }
    }
    out
}

/// `_merge_continuous_three_tones`（`edge_only=false`）与 `_merge_continuous_three_tones_2`（`true`）。
fn merge_three_tones(seg: Seg, edge_only: bool) -> Seg {
    let finals: Vec<Vec<String>> = seg.iter().map(|(word, _)| pinyin::lazy(word).1).collect();
    let mut merge_last = vec![false; seg.len()];
    let mut out: Seg = Vec::new();
    for i in 0..seg.len() {
        let three = i >= 1
            && !merge_last[i - 1]
            && if edge_only {
                tone_is(finals[i - 1].last(), '3') && tone_is(finals[i].first(), '3')
            } else {
                all_tone_three(&finals[i - 1]) && all_tone_three(&finals[i])
            };
        if three && !is_reduplication(&seg[i - 1].0) && char_len(&seg[i - 1].0) + char_len(&seg[i].0) <= 3 {
            if let Some(last) = out.last_mut() {
                last.0.push_str(&seg[i].0);
            }
            merge_last[i] = true;
        } else {
            out.push(seg[i].clone());
        }
    }
    out
}

fn merge_er(seg: Seg) -> Seg {
    let mut out: Seg = Vec::new();
    for i in 0..seg.len() {
        if i >= 1 && seg[i].0 == "儿" && seg[i - 1].0 != "#" {
            if let Some(last) = out.last_mut() {
                last.0.push_str("儿");
            }
        } else {
            out.push(seg[i].clone());
        }
    }
    out
}

/// `pre_merge_for_modify`
pub fn pre_merge_for_modify(seg: Seg) -> Seg {
    let seg = merge_bu(seg);
    let seg = merge_yi(seg);
    let seg = merge_reduplication(seg);
    let seg = merge_three_tones(seg, false);
    let seg = merge_three_tones(seg, true);
    merge_er(seg)
}

/// `_split_word`：搜索模式分词里最短的子词放在它所在的一侧，另一侧是剩余部分。
fn split_word(word: &str) -> [String; 2] {
    let tokens = jieba::cut_for_search(word);
    let first = tokens.iter().map(String::as_str).min_by_key(|w| char_len(w)).unwrap_or(word);
    if word.starts_with(first) {
        [first.to_owned(), word[first.len()..].to_owned()]
    } else {
        let chars: Vec<char> = word.chars().collect();
        let keep = chars.len().saturating_sub(char_len(first));
        [chars[..keep].iter().collect(), first.to_owned()]
    }
}

fn split_finals(finals: &[String], at: usize) -> [Vec<String>; 2] {
    let at = at.min(finals.len());
    [finals[..at].to_vec(), finals[at..].to_vec()]
}

fn bu_sandhi(word: &[char], finals: &mut [String]) {
    if word.len() == 3 && word[1] == '不' {
        set_tone(finals, 1, '5');
    } else {
        for i in 0..word.len() {
            if word[i] == '不' && i + 1 < word.len() && tone_is(finals.get(i + 1), '4') {
                set_tone(finals, i, '2');
            }
        }
    }
}

fn yi_sandhi(word: &[char], finals: &mut [String]) {
    if word.contains(&'一') && word.iter().filter(|&&c| c != '一').all(|&c| pychar::is_numeric(c)) {
    } else if word.len() == 3 && word[1] == '一' && word[0] == word[2] {
        set_tone(finals, 1, '5');
    } else if word.starts_with(&['第', '一']) {
        set_tone(finals, 1, '1');
    } else {
        for i in 0..word.len() {
            if word[i] == '一' && i + 1 < word.len() {
                if tone_is(finals.get(i + 1), '4') {
                    set_tone(finals, i, '2');
                } else if !PUNC.contains(word[i + 1]) {
                    set_tone(finals, i, '4');
                }
            }
        }
    }
}

fn neural_sandhi(word: &str, chars: &[char], pos: &str, finals: &mut Vec<String>) {
    let n = chars.len();
    let must_not = words::contains(MUST_NOT_NEURAL_TONE_WORDS, word);
    let pos_head = pos.chars().next();
    for j in 1..n {
        if chars[j] == chars[j - 1] && pos_head.is_some_and(|p| "nva".contains(p)) && !must_not {
            set_tone(finals, j, '5');
        }
    }
    let ge_idx = chars.iter().position(|&c| c == '个');
    let last = chars.last().copied().unwrap_or('\0');
    if n >= 1 && "吧呢哈啊呐噻嘛吖嗨呐哦哒额滴哩哟喽啰耶喔诶".contains(last) {
        set_last_tone(finals, '5');
    } else if n >= 1 && "的地得".contains(last) {
        set_last_tone(finals, '5');
    } else if n == 1 && "了着过".contains(last) && matches!(pos, "ul" | "uz" | "ug") {
        set_last_tone(finals, '5');
    } else if n > 1 && "们子".contains(last) && matches!(pos, "r" | "n") && !must_not {
        set_last_tone(finals, '5');
    } else if n > 1 && "上下里".contains(last) && matches!(pos, "s" | "l" | "f") {
        set_last_tone(finals, '5');
    } else if n > 1 && "来去".contains(last) && "上下进出回过起开".contains(chars[n - 2]) {
        set_last_tone(finals, '5');
    } else if ge_idx.is_some_and(|g| g >= 1 && (pychar::is_numeric(chars[g - 1]) || "几有两半多各整每做是".contains(chars[g - 1])))
        || word == "个"
    {
        set_tone(finals, ge_idx.unwrap_or(0), '5');
    } else if is_must_neural(word) {
        set_last_tone(finals, '5');
    }

    let parts = split_word(word);
    let mut finals_list = split_finals(finals, char_len(&parts[0]));
    for (part, sub) in parts.iter().zip(finals_list.iter_mut()) {
        if is_must_neural(part) {
            set_last_tone(sub, '5');
        }
    }
    *finals = finals_list.concat();
}

fn three_sandhi(word: &str, n: usize, finals: &mut Vec<String>) {
    if n == 2 && all_tone_three(finals) {
        set_tone(finals, 0, '2');
    } else if n == 3 {
        let parts = split_word(word);
        let head = char_len(&parts[0]);
        if all_tone_three(finals) {
            if head == 2 {
                set_tone(finals, 0, '2');
                set_tone(finals, 1, '2');
            } else if head == 1 {
                set_tone(finals, 1, '2');
            }
        } else {
            let mut finals_list = split_finals(finals, head);
            for i in 0..2 {
                if all_tone_three(&finals_list[i]) && finals_list[i].len() == 2 {
                    set_tone(&mut finals_list[i], 0, '2');
                } else if i == 1
                    && !all_tone_three(&finals_list[1])
                    && tone_is(finals_list[1].first(), '3')
                    && tone_is(finals_list[0].last(), '3')
                {
                    set_last_tone(&mut finals_list[0], '2');
                }
            }
            *finals = finals_list.concat();
        }
    } else if n == 4 {
        let mut finals_list = split_finals(finals, 2);
        for sub in &mut finals_list {
            if !sub.is_empty() && all_tone_three(sub) {
                set_tone(sub, 0, '2');
            }
        }
        *finals = finals_list.concat();
    }
}

/// `modified_tone`
pub fn modified_tone(word: &str, pos: &str, mut finals: Vec<String>) -> Vec<String> {
    let chars: Vec<char> = word.chars().collect();
    bu_sandhi(&chars, &mut finals);
    yi_sandhi(&chars, &mut finals);
    neural_sandhi(word, &chars, pos, &mut finals);
    three_sandhi(word, chars.len(), &mut finals);
    finals
}
