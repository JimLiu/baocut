//! jieba 分词：复刻上游实际调用的 `jieba_fast`（默认词典、`HMM=True`、精确模式）。
//!
//! - [`posseg`]：`jieba_fast.posseg.lcut(text)`，chinese2 的 G2P 分词。DAG 路由后把词典外的连续单字交给
//!   「词性 HMM」重新切分；jieba-rs 的 `tag` 是先普通 HMM 切词再猜词性，结果不同（如「胡同儿里」）。
//! - [`cut_for_search`]：`jieba_fast.cut_for_search(word)`，tone_sandhi 的 `_split_word`。
//!
//! 词典与两套 HMM 表由 v2 仓库（`baocut-app`）的 `scripts/dev/gpt-sovits-text/gen_jieba.py` 从 jieba_fast 导出（jieba 词典与模型，MIT）。

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;

use super::data::{inflate, inflate_text};

const MIN_FLOAT: f64 = -3.14e100;

struct Entry {
    start: u32,
    len: u32,
    freq: u32,
    tag: u16,
}

/// `Tokenizer.FREQ`（只存非零词频的词条，前缀用排序后的二分判定）+ `POSTokenizer.word_tag_tab`。
struct Dict {
    words: String,
    entries: Vec<Entry>,
    tags: Vec<String>,
    log_total: f64,
}

impl Dict {
    fn word(&self, entry: &Entry) -> &str {
        &self.words[entry.start as usize..(entry.start + entry.len) as usize]
    }

    fn find(&self, word: &str) -> Option<&Entry> {
        self.entries
            .binary_search_by(|entry| self.word(entry).cmp(word))
            .ok()
            .map(|i| &self.entries[i])
    }

    /// `frag in FREQ`：是词条或词条的前缀（`gen_pfdict` 给前缀记 0 频）。
    fn has_prefix(&self, frag: &str) -> bool {
        let i = self.entries.partition_point(|entry| self.word(entry) < frag);
        self.entries.get(i).is_some_and(|entry| self.word(entry).starts_with(frag))
    }

    /// `FREQ.get(word)` 为真值时的词频。
    fn freq(&self, word: &str) -> Option<u32> {
        self.find(word).map(|entry| entry.freq)
    }

    /// `word_tag_tab.get(word, 'x')`。
    fn tag(&self, word: &str) -> &str {
        self.find(word).map_or("x", |entry| &self.tags[entry.tag as usize])
    }
}

static DICT: LazyLock<Dict> = LazyLock::new(|| {
    let text = inflate_text(include_bytes!("data/jieba_dict.txt.z"));
    let mut lines = text.lines();
    let total: u64 = lines.next().and_then(|line| line.parse().ok()).expect("jieba 词典缺少 total");
    let mut words = String::with_capacity(text.len());
    let mut entries = Vec::new();
    let mut tags: Vec<String> = Vec::new();
    let mut tag_ids: HashMap<String, u16> = HashMap::new();
    for line in lines.filter(|line| !line.is_empty()) {
        let mut fields = line.split('\t');
        let (Some(word), Some(freq), Some(tag)) = (fields.next(), fields.next(), fields.next()) else {
            panic!("jieba 词典行格式错误：{line}");
        };
        let tag = match tag_ids.get(tag) {
            Some(&id) => id,
            None => {
                let id = tags.len() as u16;
                tags.push(tag.to_owned());
                tag_ids.insert(tag.to_owned(), id);
                id
            }
        };
        entries.push(Entry {
            start: words.len() as u32,
            len: word.len() as u32,
            freq: freq.parse().expect("jieba 词频"),
            tag,
        });
        words.push_str(word);
    }
    let dict = Dict {
        words,
        entries,
        tags,
        log_total: (total as f64).ln(),
    };
    debug_assert!(dict.entries.windows(2).all(|pair| dict.word(&pair[0]) < dict.word(&pair[1])));
    dict
});

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl Reader<'_> {
    fn take<const N: usize>(&mut self) -> [u8; N] {
        let out = self.bytes[self.pos..self.pos + N].try_into().expect("jieba HMM 表截断");
        self.pos += N;
        out
    }

    fn u8(&mut self) -> u8 {
        self.take::<1>()[0]
    }

    fn u16(&mut self) -> u16 {
        u16::from_le_bytes(self.take())
    }

    fn u32(&mut self) -> u32 {
        u32::from_le_bytes(self.take())
    }

    fn f64(&mut self) -> f64 {
        f64::from_le_bytes(self.take())
    }

    fn emit_table(&mut self) -> Vec<(u16, f64)> {
        let count = self.u32() as usize;
        (0..count).map(|_| (self.u16(), self.f64())).collect()
    }
}

/// `emit_p[state].get(ch, MIN_FLOAT)`，表按字符排序。
fn emit(table: &[(u16, f64)], ch: char) -> f64 {
    let Ok(code) = u16::try_from(ch as u32) else {
        return MIN_FLOAT;
    };
    table.binary_search_by_key(&code, |&(c, _)| c).map_or(MIN_FLOAT, |i| table[i].1)
}

// ---------------------------------------------------------------- 词典路由

fn char_offsets(text: &str) -> Vec<usize> {
    text.char_indices().map(|(i, _)| i).chain([text.len()]).collect()
}

/// DAG 路由的两套实现：jieba_fast 的 `Tokenizer.__cut_DAG` 走 C 版 `_get_DAG_and_calc`，
/// `POSTokenizer.__cut_DAG` 走 Python 版 `get_DAG` + `calc`，平分规则不同。
#[derive(Clone, Copy, PartialEq)]
enum Calc {
    /// 元组 `max`：平分取较大终点。
    Python,
    /// 每字最多 12 个终点；初值 `INT_MIN`、严格 `>`：平分取较小终点。
    C,
}

/// 每个字起点的最佳词终点（含）。
fn route(text: &str, offsets: &[usize], calc: Calc) -> Vec<usize> {
    let dict = &*DICT;
    let n = offsets.len() - 1;
    let cap = if calc == Calc::C { 12 } else { usize::MAX };
    let dag: Vec<Vec<usize>> = (0..n)
        .map(|k| {
            let mut ends = Vec::new();
            let mut i = k;
            while i < n && ends.len() < cap {
                let frag = &text[offsets[k]..offsets[i + 1]];
                if !dict.has_prefix(frag) {
                    break;
                }
                if dict.freq(frag).is_some() {
                    ends.push(i);
                }
                i += 1;
            }
            if ends.is_empty() {
                ends.push(k);
            }
            ends
        })
        .collect();
    let mut best = vec![(0.0_f64, 0_usize); n + 1];
    for idx in (0..n).rev() {
        let mut current = match calc {
            Calc::Python => None,
            Calc::C => Some((i32::MIN as f64, 0)),
        };
        for &x in &dag[idx] {
            let freq = dict.freq(&text[offsets[idx]..offsets[x + 1]]).unwrap_or(1);
            let score = (freq as f64).ln() - dict.log_total + best[x + 1].0;
            let better = current.is_none_or(|(top, _)| match calc {
                Calc::Python => score >= top,
                Calc::C => score > top,
            });
            if better {
                current = Some((score, x));
            }
        }
        best[idx] = current.expect("DAG 至少含自身");
    }
    best[..n].iter().map(|&(_, end)| end).collect()
}

/// 按字符类切出最大连续段：`re.split("([class]+)")` 的非空块及其是否属于该类。
fn runs(text: &str, class: fn(char) -> bool) -> Vec<(&str, bool)> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut current = None;
    for (i, ch) in text.char_indices() {
        let inside = class(ch);
        if current.is_some_and(|c| c != inside) {
            out.push((&text[start..i], current.unwrap()));
            start = i;
        }
        current = Some(inside);
    }
    if let Some(inside) = current {
        out.push((&text[start..], inside));
    }
    out
}

fn is_han(ch: char) -> bool {
    ('\u{4E00}'..='\u{9FD5}').contains(&ch)
}

/// `re_han_default`（`Tokenizer.cut`）。
fn is_han_default(ch: char) -> bool {
    is_han_internal(ch) || ch == '%'
}

/// `re_han_internal`（`POSTokenizer`）。
fn is_han_internal(ch: char) -> bool {
    is_han(ch) || ch.is_ascii_alphanumeric() || matches!(ch, '+' | '#' | '&' | '.' | '_')
}

/// 非汉字块：`re.split("(\r\n|\s)")` 后空白整段、其余逐字，合起来就是「`\r\n` 成对，其余逐字」。
fn skip_pieces(block: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut iter = block.char_indices().peekable();
    while let Some((i, ch)) = iter.next() {
        if ch == '\r' && iter.peek().is_some_and(|&(_, next)| next == '\n') {
            iter.next();
            out.push(&block[i..i + 2]);
        } else {
            out.push(&block[i..i + ch.len_utf8()]);
        }
    }
    out
}

/// `re.split("(pattern)")` 的非空片段。
fn regex_pieces<'a>(re: &Regex, text: &'a str) -> Vec<&'a str> {
    let mut out = Vec::new();
    let mut last = 0;
    for found in re.find_iter(text) {
        if found.start() > last {
            out.push(&text[last..found.start()]);
        }
        out.push(found.as_str());
        last = found.end();
    }
    if last < text.len() {
        out.push(&text[last..]);
    }
    out
}

// ---------------------------------------------------------------- finalseg（Tokenizer.cut 的 HMM）

struct FinalSeg {
    start: [f64; 4],
    trans: [[f64; 4]; 4],
    emit: [Vec<(u16, f64)>; 4],
}

const B: usize = 0;
const E: usize = 1;
const M: usize = 2;
const S: usize = 3;

static FINALSEG: LazyLock<FinalSeg> = LazyLock::new(|| {
    let bytes = inflate(include_bytes!("data/jieba_finalseg.bin.z"));
    let mut reader = Reader { bytes: &bytes, pos: 0 };
    let start = [0; 4].map(|_| reader.f64());
    let trans = [0; 4].map(|_| [0; 4].map(|_| reader.f64()));
    let emit = [0; 4].map(|_| reader.emit_table());
    FinalSeg { start, trans, emit }
});

static RE_FINALSEG_SKIP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[a-zA-Z0-9]+(?:\.\d+)?%?").unwrap());

/// `finalseg.cut`。
fn finalseg_cut(text: &str, out: &mut Vec<String>) {
    for (block, han) in runs(text, is_han) {
        if han {
            finalseg_hmm(block, out);
        } else {
            out.extend(regex_pieces(&RE_FINALSEG_SKIP, block).into_iter().map(str::to_owned));
        }
    }
}

/// `finalseg.__cut`：调的是 C 版 `_viterbi`，与 `finalseg.viterbi` 的 Python 版不同——每步从 `MIN_FLOAT`
/// 起按严格 `>` 取前驱，两个前驱都不超过 `MIN_FLOAT` 时概率钉在 `MIN_FLOAT`、前驱取字母序较大者；
/// 末字 `S` 严格大于 `E` 才选 `S`。发射表外的连续生僻字因此连成一个词。
fn finalseg_hmm(text: &str, out: &mut Vec<String>) {
    // C 源码的 `PrevStatus` 次序，及两前驱都落空时的兜底
    const PREV: [[usize; 2]; 4] = [[E, S], [B, M], [M, B], [S, E]];
    const FALLBACK: [usize; 4] = [S, M, M, S];
    let model = &*FINALSEG;
    let chars: Vec<char> = text.chars().collect();
    let mut probs = vec![[0.0_f64; 4]];
    let mut back: Vec<[usize; 4]> = vec![[0; 4]];
    for y in 0..4 {
        probs[0][y] = emit(&model.emit[y], chars[0]) + model.start[y];
    }
    for &ch in &chars[1..] {
        let prev = *probs.last().unwrap();
        let mut row = [0.0; 4];
        let mut from = [0; 4];
        for y in 0..4 {
            let em = emit(&model.emit[y], ch);
            let (mut top, mut best) = (MIN_FLOAT, None);
            for &y0 in &PREV[y] {
                // 加法次序同 C：`em + V[i-1][y0] + trans`
                let score = em + prev[y0] + model.trans[y0][y];
                if score > top {
                    top = score;
                    best = Some(y0);
                }
            }
            row[y] = top;
            from[y] = best.unwrap_or(FALLBACK[y]);
        }
        probs.push(row);
        back.push(from);
    }
    let last = probs.last().unwrap();
    let mut state = if last[S] > last[E] { S } else { E };
    let mut path = vec![0; chars.len()];
    for t in (0..chars.len()).rev() {
        path[t] = state;
        state = back[t][state];
    }
    let offsets = char_offsets(text);
    let (mut begin, mut next) = (0, 0);
    for (i, &pos) in path.iter().enumerate() {
        match pos {
            B => begin = i,
            E => {
                out.push(text[offsets[begin]..offsets[i + 1]].to_owned());
                next = i + 1;
            }
            S => {
                out.push(text[offsets[i]..offsets[i + 1]].to_owned());
                next = i + 1;
            }
            _ => {}
        }
    }
    if next < chars.len() {
        out.push(text[offsets[next]..].to_owned());
    }
}

// ---------------------------------------------------------------- Tokenizer.cut / cut_for_search

/// `Tokenizer.__cut_DAG`。
fn cut_dag(text: &str, out: &mut Vec<String>) {
    let dict = &*DICT;
    let offsets = char_offsets(text);
    let route = route(text, &offsets, Calc::C);
    let n = offsets.len() - 1;
    let flush = |from: usize, to: usize, out: &mut Vec<String>| {
        let buf = &text[offsets[from]..offsets[to]];
        if to - from == 1 {
            out.push(buf.to_owned());
        } else if dict.freq(buf).is_none() {
            finalseg_cut(buf, out);
        } else {
            out.extend(buf.chars().map(String::from));
        }
    };
    let (mut x, mut buf) = (0, 0);
    while x < n {
        let y = route[x] + 1;
        if y - x != 1 {
            if buf < x {
                flush(buf, x, out);
            }
            out.push(text[offsets[x]..offsets[y]].to_owned());
            buf = y;
        }
        x = y;
    }
    if buf < n {
        flush(buf, n, out);
    }
}

/// `jieba_fast.lcut(text)`（精确模式，`HMM=True`）。
pub fn cut(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for (block, han) in runs(text, is_han_default) {
        if han {
            cut_dag(block, &mut out);
        } else {
            out.extend(skip_pieces(block).into_iter().map(str::to_owned));
        }
    }
    out
}

/// `jieba_fast.lcut_for_search(text)`。
pub fn cut_for_search(text: &str) -> Vec<String> {
    let dict = &*DICT;
    let mut out = Vec::new();
    for word in cut(text) {
        let offsets = char_offsets(&word);
        let n = offsets.len() - 1;
        for gram in [2, 3] {
            if n > gram {
                for i in 0..=n - gram {
                    let piece = &word[offsets[i]..offsets[i + gram]];
                    if dict.freq(piece).is_some() {
                        out.push(piece.to_owned());
                    }
                }
            }
        }
        out.push(word);
    }
    out
}

// ---------------------------------------------------------------- posseg

/// posseg HMM：状态按 `(位置, 词性)` 元组排序，下标序即 Python 的元组比较序。
struct PosSeg {
    states: Vec<(char, String)>,
    start: Vec<f64>,
    /// `trans_p[from].get(to, -inf)`，`n × n`。
    trans: Vec<f64>,
    /// `trans_p[from].keys()`。
    next: Vec<Vec<usize>>,
    emit: Vec<Vec<(u16, f64)>>,
    char_states: HashMap<char, Vec<usize>>,
}

static POSSEG: LazyLock<PosSeg> = LazyLock::new(|| {
    let bytes = inflate(include_bytes!("data/jieba_posseg.bin.z"));
    let mut reader = Reader { bytes: &bytes, pos: 0 };
    let n = reader.u16() as usize;
    let states: Vec<(char, String)> = (0..n)
        .map(|_| {
            let pos = reader.u8() as char;
            let len = reader.u8() as usize;
            let tag = String::from_utf8(reader.bytes[reader.pos..reader.pos + len].to_vec()).expect("posseg 词性");
            reader.pos += len;
            (pos, tag)
        })
        .collect();
    let start = (0..n).map(|_| reader.f64()).collect();
    let mut trans = vec![f64::NEG_INFINITY; n * n];
    let next = (0..n)
        .map(|from| {
            let count = reader.u16() as usize;
            (0..count)
                .map(|_| {
                    let to = reader.u8() as usize;
                    trans[from * n + to] = reader.f64();
                    to
                })
                .collect()
        })
        .collect();
    let emit = (0..n).map(|_| reader.emit_table()).collect();
    let chars = reader.u32() as usize;
    let char_states = (0..chars)
        .map(|_| {
            let ch = char::from_u32(reader.u16() as u32).expect("posseg 字符");
            let count = reader.u8() as usize;
            (ch, (0..count).map(|_| reader.u8() as usize).collect())
        })
        .collect();
    PosSeg {
        states,
        start,
        trans,
        next,
        emit,
        char_states,
    }
});

/// `posseg.viterbi.viterbi`：返回逐字状态下标。
fn posseg_viterbi(model: &PosSeg, obs: &[char]) -> Vec<usize> {
    let n = model.states.len();
    let candidates = |ch: char| -> Vec<usize> { model.char_states.get(&ch).cloned().unwrap_or_else(|| (0..n).collect()) };
    let mut probs = vec![vec![0.0_f64; n]; obs.len()];
    let mut back = vec![vec![0_usize; n]; obs.len()];
    let mut live: Vec<Vec<usize>> = Vec::with_capacity(obs.len());
    let first = candidates(obs[0]);
    for &y in &first {
        probs[0][y] = model.start[y] + emit(&model.emit[y], obs[0]);
    }
    live.push(first);
    for t in 1..obs.len() {
        let prev: Vec<usize> = live[t - 1].iter().copied().filter(|&x| !model.next[x].is_empty()).collect();
        let mut expected = vec![false; n];
        for &x in &prev {
            for &y in &model.next[x] {
                expected[y] = true;
            }
        }
        let mut states: Vec<usize> = candidates(obs[t]).into_iter().filter(|&y| expected[y]).collect();
        if states.is_empty() {
            states = (0..n).filter(|&y| expected[y]).collect();
        }
        if states.is_empty() {
            states = (0..n).collect();
        }
        states.sort_unstable();
        states.dedup();
        for &y in &states {
            let em = emit(&model.emit[y], obs[t]);
            let mut top: Option<(f64, usize)> = None;
            for &y0 in &prev {
                let score = probs[t - 1][y0] + model.trans[y0 * n + y] + em;
                if top.is_none_or(|(p, s)| score > p || (score == p && y0 > s)) {
                    top = Some((score, y0));
                }
            }
            let (score, from) = top.unwrap_or((f64::NEG_INFINITY, y));
            probs[t][y] = score;
            back[t][y] = from;
        }
        live.push(states);
    }
    let last = obs.len() - 1;
    let mut state = live[last]
        .iter()
        .copied()
        .fold(None, |top: Option<usize>, y| match top {
            Some(s) if probs[last][s] > probs[last][y] || (probs[last][s] == probs[last][y] && s > y) => Some(s),
            _ => Some(y),
        })
        .expect("viterbi 末列非空");
    let mut path = vec![0; obs.len()];
    for t in (0..obs.len()).rev() {
        path[t] = state;
        state = back[t][state];
    }
    path
}

/// `POSTokenizer.__cut`。
fn posseg_hmm(text: &str, out: &mut Vec<(String, String)>) {
    let model = &*POSSEG;
    let chars: Vec<char> = text.chars().collect();
    let path = posseg_viterbi(model, &chars);
    let offsets = char_offsets(text);
    let (mut begin, mut next) = (0, 0);
    for (i, &state) in path.iter().enumerate() {
        let (pos, tag) = &model.states[state];
        match pos {
            'B' => begin = i,
            'E' => {
                out.push((text[offsets[begin]..offsets[i + 1]].to_owned(), tag.clone()));
                next = i + 1;
            }
            'S' => {
                out.push((text[offsets[i]..offsets[i + 1]].to_owned(), tag.clone()));
                next = i + 1;
            }
            _ => {}
        }
    }
    if next < chars.len() {
        let tag = model.states[path[next]].1.clone();
        out.push((text[offsets[next]..].to_owned(), tag));
    }
}

static RE_SKIP_DETAIL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[.0-9]+|[a-zA-Z0-9]+").unwrap());

/// `POSTokenizer.__cut_detail`。
fn posseg_detail(text: &str, out: &mut Vec<(String, String)>) {
    for (block, han) in runs(text, is_han) {
        if han {
            posseg_hmm(block, out);
            continue;
        }
        for piece in regex_pieces(&RE_SKIP_DETAIL, block) {
            // 片段要么整段匹配 `[.0-9]+` / `[a-zA-Z0-9]+`，要么不含这些字符，看首字即可
            let tag = match piece.chars().next() {
                Some('.' | '0'..='9') => "m",
                Some(c) if c.is_ascii_alphanumeric() => "eng",
                _ => "x",
            };
            out.push((piece.to_owned(), tag.to_owned()));
        }
    }
}

/// `POSTokenizer.__cut_DAG`。
fn posseg_dag(text: &str, out: &mut Vec<(String, String)>) {
    let dict = &*DICT;
    let offsets = char_offsets(text);
    let route = route(text, &offsets, Calc::Python);
    let n = offsets.len() - 1;
    let tagged = |word: &str| (word.to_owned(), dict.tag(word).to_owned());
    let flush = |from: usize, to: usize, out: &mut Vec<(String, String)>| {
        let buf = &text[offsets[from]..offsets[to]];
        if to - from == 1 {
            out.push(tagged(buf));
        } else if dict.freq(buf).is_none() {
            posseg_detail(buf, out);
        } else {
            for i in from..to {
                out.push(tagged(&text[offsets[i]..offsets[i + 1]]));
            }
        }
    };
    let (mut x, mut buf) = (0, 0);
    while x < n {
        let y = route[x] + 1;
        if y - x != 1 {
            if buf < x {
                flush(buf, x, out);
            }
            out.push(tagged(&text[offsets[x]..offsets[y]]));
            buf = y;
        }
        x = y;
    }
    if buf < n {
        flush(buf, n, out);
    }
}

/// `jieba_fast.posseg.lcut(text)`（`HMM=True`），返回 `(词, 词性)`。
pub fn posseg(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for (block, han) in runs(text, is_han_internal) {
        if han {
            posseg_dag(block, &mut out);
        } else {
            // 非汉字块不含 `[.0-9a-zA-Z]`，逐字（`\r\n` 成对）都记 x
            out.extend(skip_pieces(block).into_iter().map(|piece| (piece.to_owned(), "x".to_owned())));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn joined(pairs: &[(String, String)]) -> String {
        pairs.iter().map(|(w, t)| format!("{w}/{t}")).collect::<Vec<_>>().join(" ")
    }

    #[test]
    fn posseg_recuts_unknown_singles_with_pos_hmm() {
        assert_eq!(
            joined(&posseg("小孩儿在胡同儿里玩儿,")),
            "小孩儿/n 在/p 胡同/nr 儿/n 里/f 玩儿/n ,/x"
        );
    }

    #[test]
    fn search_mode_adds_dictionary_grams() {
        assert_eq!(
            cut_for_search("中华人民共和国"),
            ["中华", "华人", "人民", "共和", "共和国", "中华人民共和国"]
        );
    }
}
