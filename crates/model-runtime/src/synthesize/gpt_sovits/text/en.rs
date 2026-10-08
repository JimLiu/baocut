//! GPT-SoVITS v2 英文 G2P：`text/english.py` 的 `en_G2p`、`g2p` 与 `clean_text(..., "en")`。
//!
//! 上游组件：nltk 3.10.3 `TweetTokenizer` 与 `averaged_perceptron_tagger_eng`、wordsegment 1.3.1、
//! g2p_en 2.1.0 GRU 编解码器。管线里的输入只来自 [`en_norm::text_normalize`]，字符集是 ASCII
//! 字母、空格与 `'.,?!-`；分词器只移植在这个字母表上可达的规则。

use std::sync::LazyLock;

use regex::Regex;

use super::data::{CMUDICT, EN_TAGGER, G2P_GRU, GRU_HIDDEN, HOMOGRAPHS, NAMEDICT, WORDSEGMENT};
use super::en_norm;
use super::error::PyError;
use super::pychar;
use super::symbols::symbol_id;

// ---------------------------------------------------------------- TweetTokenizer

/// `TweetTokenizer.PHONE_WORD_RE` 在规范化字母表上可达的分支，交替顺序与上游一致：
/// 裸域名、带撇号/连字符的词、数字、普通词、省略号、其余非空白字符。
/// URL 协议、电话、表情、HTML、箭头、@/#、邮箱与 emoji 分支都需要该字母表之外的字符。
static WORD_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"[A-Za-z0-9]+(?:[.\-][A-Za-z0-9]+){0,126}\.[A-Za-z]{2,13}\b",
        r"|[A-Za-z](?:[A-Za-z]|['\-_])+[A-Za-z]",
        r"|[+\-]?[0-9]+[,/.:\-][0-9]+[+\-]?",
        r"|[A-Za-z0-9_]+",
        r"|\.(?:\s*\.)+",
        r"|\S",
    ))
    .expect("WORD_RE")
});

/// `HANG_RE.sub(r"\1\1\1", text)`：同一个非字母数字字符连续 4 次以上截成 3 次。
fn shorten_runs(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        let mut run = 1;
        while chars.next_if_eq(&c).is_some() {
            run += 1;
        }
        let keep = if run >= 4 && !c.is_alphanumeric() { 3 } else { run };
        out.extend(std::iter::repeat_n(c, keep));
    }
    out
}

/// `TweetTokenizer().tokenize(text)`。
pub fn tokenize(text: &str) -> Vec<String> {
    WORD_RE.find_iter(&shorten_runs(text)).map(|m| m.as_str().to_owned()).collect()
}

// ---------------------------------------------------------------- 感知机词性标注

const TAG_START: [&str; 2] = ["-START-", "-START2-"];
const TAG_END: [&str; 2] = ["-END-", "-END2-"];

/// 末尾至多 `n` 个字符（Python `s[-n:]`）。
fn last_chars(s: &str, n: usize) -> &str {
    match s.char_indices().rev().nth(n - 1) {
        Some((i, _)) => &s[i..],
        None => s,
    }
}

/// `PerceptronTagger.normalize`。
fn tag_normalize(word: &str) -> String {
    let first = word.chars().next();
    if word.contains('-') && first != Some('-') {
        return "!HYPHEN".to_owned();
    }
    if first.is_some() && word.chars().all(pychar::is_digit) && word.chars().count() == 4 {
        return "!YEAR".to_owned();
    }
    if first.is_some_and(pychar::is_digit) {
        return "!DIGITS".to_owned();
    }
    word.to_lowercase()
}

/// `nltk.pos_tag(tokens)` 的标签序列。
pub fn pos_tag(tokens: &[String]) -> Vec<String> {
    let tagger = &*EN_TAGGER;
    let mut context: Vec<String> = TAG_START.iter().map(|s| (*s).to_owned()).collect();
    context.extend(tokens.iter().map(|w| tag_normalize(w)));
    context.extend(TAG_END.iter().map(|s| (*s).to_owned()));

    let (mut prev, mut prev2) = (TAG_START[0].to_owned(), TAG_START[1].to_owned());
    let mut scores = vec![0.0f64; tagger.classes.len()];
    let mut tags = Vec::with_capacity(tokens.len());
    for (i, word) in tokens.iter().enumerate() {
        let tag = match tagger.tagdict(word) {
            Some(tag) => tag.to_owned(),
            None => {
                let i = i + TAG_START.len();
                let first = word.chars().next().map(String::from).unwrap_or_default();
                // 顺序即上游 `_get_features` 的插入顺序，决定浮点累加顺序
                let features = [
                    "bias".to_owned(),
                    format!("i suffix {}", last_chars(word, 3)),
                    format!("i pref1 {first}"),
                    format!("i-1 tag {prev}"),
                    format!("i-2 tag {prev2}"),
                    format!("i tag+i-2 tag {prev} {prev2}"),
                    format!("i word {}", context[i]),
                    format!("i-1 tag+i word {prev} {}", context[i]),
                    format!("i-1 word {}", context[i - 1]),
                    format!("i-1 suffix {}", last_chars(&context[i - 1], 3)),
                    format!("i-2 word {}", context[i - 2]),
                    format!("i+1 word {}", context[i + 1]),
                    format!("i+1 suffix {}", last_chars(&context[i + 1], 3)),
                    format!("i+2 word {}", context[i + 2]),
                ];
                scores.fill(0.0);
                for feature in &features {
                    for &(class, weight) in tagger.weights(feature).unwrap_or_default() {
                        scores[class as usize] += weight;
                    }
                }
                // max(classes, key=(score, label))
                let mut best = 0;
                for class in 1..scores.len() {
                    if scores[class] > scores[best] || (scores[class] == scores[best] && tagger.classes[class] > tagger.classes[best]) {
                        best = class;
                    }
                }
                tagger.classes[best].clone()
            }
        };
        prev2 = std::mem::replace(&mut prev, tag.clone());
        tags.push(tag);
    }
    tags
}

// ---------------------------------------------------------------- wordsegment

const WS_TOTAL: f64 = 1_024_908_267_229.0;
const WS_LIMIT: usize = 24;
const WS_CHUNK: usize = 250;
/// Python `float(10 ** n)`（正确舍入），`n <= WS_LIMIT`。
const POW10: [f64; WS_LIMIT + 1] = [
    1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22, 1e23,
    1e24,
];

/// `Segmenter.score(word, previous)`，`previous` 非空。
fn ws_score(word: &str, previous: &str) -> f64 {
    let freq = &*WORDSEGMENT;
    if let Some(bigram) = freq.bigram(&format!("{previous} {word}"))
        && let Some(unigram) = freq.unigram(previous)
    {
        return bigram as f64 / WS_TOTAL / (unigram as f64 / WS_TOTAL);
    }
    match freq.unigram(word) {
        Some(count) => count as f64 / WS_TOTAL,
        None => 10.0 / (WS_TOTAL * POW10[word.len()]),
    }
}

/// `isegment` 内的 `search(text)`（ASCII 小写字母数字）：状态为（位置, 前一词长度），
/// 长度 0 表示 `"<s>"`。上游 `max` 比较 `(score, words)`，分数相同时首词更长者字符串更大。
fn ws_search(text: &str) -> Vec<String> {
    let n = text.len();
    let width = WS_LIMIT + 1;
    // best[pos * width + k] = (text[pos..] 的最高分, 首词长度)，前一词为 text[pos - k..pos]
    let mut best = vec![(0.0f64, 0usize); (n + 1) * width];
    for pos in (0..n).rev() {
        let prevs = if pos == 0 { 0..=0 } else { 1..=pos.min(WS_LIMIT) };
        for k in prevs {
            let previous = if k == 0 { "<s>" } else { &text[pos - k..pos] };
            let mut top = (f64::NEG_INFINITY, 0);
            for j in 1..=(n - pos).min(WS_LIMIT) {
                let score = ws_score(&text[pos..pos + j], previous).log10() + best[(pos + j) * width + j].0;
                if score >= top.0 {
                    top = (score, j);
                }
            }
            best[pos * width + k] = top;
        }
    }
    let mut words = Vec::new();
    let (mut pos, mut k) = (0, 0);
    while pos < n {
        let len = best[pos * width + k].1;
        words.push(text[pos..pos + len].to_owned());
        pos += len;
        k = len;
    }
    words
}

/// `wordsegment.segment(text)`。
pub fn segment(text: &str) -> Vec<String> {
    let clean: String = text
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        .collect();
    let mut words = Vec::new();
    let mut prefix = String::new();
    for chunk in clean.as_bytes().chunks(WS_CHUNK) {
        let chunk = std::str::from_utf8(chunk).expect("clean 文本是 ASCII");
        let mut chunk_words = ws_search(&(prefix + chunk));
        let tail = chunk_words.len().saturating_sub(5);
        prefix = chunk_words[tail..].concat();
        chunk_words.truncate(tail);
        words.append(&mut chunk_words);
    }
    words.extend(ws_search(&prefix));
    words
}

// ---------------------------------------------------------------- g2p_en GRU

const PHONEMES: [&str; 74] = [
    "<pad>", "<unk>", "<s>", "</s>", "AA0", "AA1", "AA2", "AE0", "AE1", "AE2", "AH0", "AH1", "AH2", "AO0", "AO1", "AO2", "AW0", "AW1",
    "AW2", "AY0", "AY1", "AY2", "B", "CH", "D", "DH", "EH0", "EH1", "EH2", "ER0", "ER1", "ER2", "EY0", "EY1", "EY2", "F", "G", "HH", "IH0",
    "IH1", "IH2", "IY0", "IY1", "IY2", "JH", "K", "L", "M", "N", "NG", "OW0", "OW1", "OW2", "OY0", "OY1", "OY2", "P", "R", "S", "SH", "T",
    "TH", "UH0", "UH1", "UH2", "UW", "UW0", "UW1", "UW2", "V", "W", "Y", "Z", "ZH",
];
const GRAPHEME_UNK: usize = 1;
const GRAPHEME_EOS: usize = 2;
const PHONEME_BOS: usize = 2;
const PHONEME_EOS: usize = 3;
const MAX_DECODE: usize = 20;

/// `x @ w.T + b`（float32，逐行顺序累加）。
fn affine(x: &[f32], w: &[f32], b: &[f32], out: &mut Vec<f32>) {
    out.clear();
    out.extend(
        w.chunks_exact(x.len())
            .zip(b)
            .map(|(row, bias)| row.iter().zip(x).fold(0.0f32, |acc, (a, c)| acc + a * c) + bias),
    );
}

fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

struct GruCell<'a> {
    w_ih: &'a [f32],
    w_hh: &'a [f32],
    b_ih: &'a [f32],
    b_hh: &'a [f32],
}

impl GruCell<'_> {
    /// `G2p.grucell`：原地更新 `h`；`ih` / `hh` 是复用的缓冲。
    fn step(&self, x: &[f32], h: &mut [f32], ih: &mut Vec<f32>, hh: &mut Vec<f32>) {
        affine(x, self.w_ih, self.b_ih, ih);
        affine(h, self.w_hh, self.b_hh, hh);
        let d = h.len();
        for t in 0..d {
            let r = sigmoid(ih[t] + hh[t]);
            let z = sigmoid(ih[d + t] + hh[d + t]);
            let n = (ih[2 * d + t] + r * hh[2 * d + t]).tanh();
            h[t] = (1.0 - z) * n + z * h[t];
        }
    }
}

/// `G2p.predict(word)`：GRU 编码字母序列、贪心解码至多 20 个音素。
pub fn predict(word: &str) -> Vec<&'static str> {
    let gru = &*G2P_GRU;
    let d = GRU_HIDDEN;
    let row = |table: &'static [f32], id: usize| &table[id * d..(id + 1) * d];
    let encoder = GruCell {
        w_ih: &gru.enc_w_ih,
        w_hh: &gru.enc_w_hh,
        b_ih: &gru.enc_b_ih,
        b_hh: &gru.enc_b_hh,
    };
    let decoder = GruCell {
        w_ih: &gru.dec_w_ih,
        w_hh: &gru.dec_w_hh,
        b_ih: &gru.dec_b_ih,
        b_hh: &gru.dec_b_hh,
    };
    let (mut ih, mut hh, mut logits) = (Vec::new(), Vec::new(), Vec::new());
    let mut h = vec![0.0f32; d];
    let graphemes = word
        .chars()
        .map(|c| {
            if c.is_ascii_lowercase() {
                c as usize - 'a' as usize + 3
            } else {
                GRAPHEME_UNK
            }
        })
        .chain([GRAPHEME_EOS]);
    for id in graphemes {
        encoder.step(row(&gru.enc_emb, id), &mut h, &mut ih, &mut hh);
    }
    let mut phones = Vec::new();
    let mut prev = PHONEME_BOS;
    for _ in 0..MAX_DECODE {
        decoder.step(row(&gru.dec_emb, prev), &mut h, &mut ih, &mut hh);
        affine(&h, &gru.fc_w, &gru.fc_b, &mut logits);
        // numpy argmax：取第一个最大值
        let mut pred = 0;
        for (i, &v) in logits.iter().enumerate() {
            if v > logits[pred] {
                pred = i;
            }
        }
        if pred == PHONEME_EOS {
            break;
        }
        phones.push(PHONEMES[pred]);
        prev = pred;
    }
    phones
}

// ---------------------------------------------------------------- en_G2p

fn cmu(word: &str) -> Result<Vec<String>, PyError> {
    CMUDICT.get(word).cloned().ok_or(PyError::Key)
}

/// `str.istitle()`（不含标题大小写字母 Lt）。
fn is_title(s: &str) -> bool {
    let (mut cased, mut prev_cased) = (false, false);
    for c in s.chars() {
        if c.is_uppercase() {
            if prev_cased {
                return false;
            }
            (prev_cased, cased) = (true, true);
        } else if c.is_lowercase() {
            if !prev_cased {
                return false;
            }
            (prev_cased, cased) = (true, true);
        } else {
            prev_cased = false;
        }
    }
    cased
}

/// `en_G2p.qryword(o_word)`。
fn qryword(o_word: &str) -> Result<Vec<String>, PyError> {
    let word = o_word.to_lowercase();
    let len = word.chars().count();
    if len > 1
        && let Some(phones) = CMUDICT.get(&word)
    {
        return Ok(phones.clone());
    }
    if is_title(o_word)
        && let Some(phones) = NAMEDICT.get(&word)
    {
        return Ok(phones.clone());
    }
    // 词典外的短词逐字母读
    if len <= 3 {
        let mut phones = Vec::new();
        for c in word.chars() {
            if c == 'a' {
                phones.push("EY1".to_owned());
            } else if !c.is_alphabetic() {
                phones.push(c.to_string());
            } else {
                phones.extend(cmu(c.encode_utf8(&mut [0; 4]))?);
            }
        }
        return Ok(phones);
    }
    // 所有格 ^[a-z]+'s$
    if let Some(stem) = word.strip_suffix("'s")
        && !stem.is_empty()
        && stem.bytes().all(|b| b.is_ascii_lowercase())
    {
        let mut phones = qryword(stem)?;
        let suffix: &[&str] = match phones.last().ok_or(PyError::Index)?.as_str() {
            "P" | "T" | "K" | "F" | "TH" | "HH" => &["S"],
            "S" | "Z" | "SH" | "ZH" | "CH" | "JH" => &["AH0", "Z"],
            _ => &["Z"],
        };
        phones.extend(suffix.iter().map(|s| (*s).to_owned()));
        return Ok(phones);
    }
    // 复合词拆开递归，拆不开交给 GRU
    let comps = segment(&word);
    if comps.len() == 1 {
        return Ok(predict(&word).into_iter().map(str::to_owned).collect());
    }
    let mut phones = Vec::new();
    for comp in &comps {
        phones.extend(qryword(comp)?);
    }
    Ok(phones)
}

/// `en_G2p.__call__(text)`：词间以 `" "` 分隔的音素序列。
pub fn g2p_call(text: &str) -> Result<Vec<String>, PyError> {
    let tokens = tokenize(text);
    let tags = pos_tag(&tokens);
    let mut prons = Vec::new();
    for (o_word, pos) in tokens.iter().zip(&tags) {
        let word = o_word.to_lowercase();
        let pron = if !word.bytes().any(|b| b.is_ascii_lowercase()) {
            vec![word]
        } else if word.chars().count() == 1 {
            if o_word == "A" { vec!["EY1".to_owned()] } else { cmu(&word)? }
        } else if let Some(homograph) = HOMOGRAPHS.get(&word) {
            let pos1 = homograph.pos1.as_str();
            if pos.starts_with(pos1) || (pos.len() < pos1.len() && pos1.starts_with(pos.as_str())) {
                homograph.pron1.clone()
            } else {
                homograph.pron2.clone()
            }
        } else {
            qryword(o_word)?
        };
        prons.extend(pron);
        prons.push(" ".to_owned());
    }
    prons.pop();
    Ok(prons)
}

/// `english.g2p(text)`：去掉分隔与特殊记号，`<unk>` 记作 `UNK`，符号表外的丢弃（`'` 改 `-`）。
pub fn g2p(text: &str) -> Result<Vec<String>, PyError> {
    let mut phones = Vec::new();
    for ph in g2p_call(text)? {
        match ph.as_str() {
            " " | "<pad>" | "UW" | "</s>" | "<s>" => {}
            "<unk>" => phones.push("UNK".to_owned()),
            "'" => phones.push("-".to_owned()),
            _ if symbol_id(&ph).is_some() => phones.push(ph),
            _ => {}
        }
    }
    Ok(phones)
}

/// `clean_text(text, "en", "v2")`：返回 (音素, 规范化文本)。
pub fn clean_text(text: &str) -> Result<(Vec<String>, String), PyError> {
    let norm = en_norm::text_normalize(text)?;
    let mut phones = g2p(&norm)?;
    if phones.len() < 4 {
        phones.insert(0, ",".to_owned());
    }
    for ph in &mut phones {
        if symbol_id(ph).is_none() {
            *ph = "UNK".to_owned();
        }
    }
    Ok((phones, norm))
}
