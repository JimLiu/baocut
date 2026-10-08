//! 长文本切块：TTS 模型一次只能稳定生成十几秒，长文本要按自然停顿切开逐块合成。
//!
//! 同时照顾中英文：句末标点
//! （。！？.!?）优先，其次分号 / 冒号 / 逗号（含全角），最后按预算硬切。
//! 长度预算按「单元」计：一个 CJK 字算一个单元，一个空格分隔的拉丁词算一个单元。

/// 默认每块最多 60 个单元（约 35 个英文词或 60 个汉字，Qwen3-TTS 约 15 秒语音）。
pub const DEFAULT_MAX_UNITS: usize = 60;
/// 少于这个数的碎片会并入相邻块。
pub const MIN_UNITS: usize = 8;

const SENTENCE_END: &[char] = &['。', '！', '？', '.', '!', '?', '…'];
const CLAUSE_END: &[char] = &['；', ';', '：', ':', '，', ',', '、'];

/// 把整段文本切成适合单次合成的块，保留原始标点。
pub fn chunk(text: &str, max_units: usize) -> Vec<String> {
    chunk_with_breaks(text, max_units).into_iter().map(|chunk| chunk.text).collect()
}

/// 一块之后是哪一级边界：拼接时据此插停顿（[`crate::synthesize::stitch`]）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChunkBreak {
    /// 块在句中断开：落在分号、逗号等分句标点上，或超长无标点时硬切。
    Clause,
    /// 块以句末标点收尾（。！？.!?…，后面可以跟右引号、右括号）。
    Sentence,
    /// 段落（换行）边界；整段文本的最后一块也记作它。
    Paragraph,
}

/// [`chunk`] 切出的一块，带上它之后的边界级别。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextChunk {
    pub text: String,
    pub after: ChunkBreak,
}

/// 与 [`chunk`] 切法完全相同，另给出每块之后的边界级别。
pub fn chunk_with_breaks(text: &str, max_units: usize) -> Vec<TextChunk> {
    let mut out = Vec::new();
    for paragraph in chunk_paragraphs(text, max_units) {
        let last = paragraph.len().saturating_sub(1);
        out.extend(paragraph.into_iter().enumerate().map(|(index, text)| {
            let after = if index == last {
                ChunkBreak::Paragraph
            } else if ends_sentence(&text) {
                ChunkBreak::Sentence
            } else {
                ChunkBreak::Clause
            };
            TextChunk { text, after }
        }));
    }
    out
}

/// 去掉末尾的右引号、右括号与空白后，最后一个字符是不是句末标点。
fn ends_sentence(text: &str) -> bool {
    text.trim_end_matches(|c: char| c.is_whitespace() || is_closing_quote(c))
        .chars()
        .last()
        .is_some_and(|c| SENTENCE_END.contains(&c))
}

/// 按段落分组的块：段落（换行）永远是块边界，每个段落各自切。
fn chunk_paragraphs(text: &str, max_units: usize) -> Vec<Vec<String>> {
    let max_units = max_units.max(MIN_UNITS);
    let normalized = text.replace("\r\n", "\n");
    let mut out = Vec::new();
    let mut chunks = Vec::new();
    for paragraph in normalized.split('\n') {
        let paragraph = paragraph.trim();
        if paragraph.is_empty() {
            continue;
        }
        let sentences = split_sentences(paragraph);
        let mut current = String::new();
        let mut current_units = 0usize;
        for sentence in sentences {
            let units = count_units(&sentence);
            if units > max_units {
                flush(&mut chunks, &mut current, &mut current_units);
                chunks.extend(split_long_sentence(&sentence, max_units));
                continue;
            }
            if current_units + units > max_units && current_units >= MIN_UNITS {
                flush(&mut chunks, &mut current, &mut current_units);
            }
            if !current.is_empty() && needs_space(&current, &sentence) {
                current.push(' ');
            }
            current.push_str(&sentence);
            current_units += units;
        }
        flush(&mut chunks, &mut current, &mut current_units);
        // 碎尾只在同一段落内并回，不跨段落。
        let paragraph_chunks = merge_tiny_tail(std::mem::take(&mut chunks));
        if !paragraph_chunks.is_empty() {
            out.push(paragraph_chunks);
        }
    }
    out
}

fn flush(chunks: &mut Vec<String>, current: &mut String, units: &mut usize) {
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        chunks.push(trimmed.to_owned());
    }
    current.clear();
    *units = 0;
}

/// 末块太短时并回前一块（避免「。好的」这类碎片单独合成出怪音）。
fn merge_tiny_tail(mut chunks: Vec<String>) -> Vec<String> {
    if chunks.len() >= 2 {
        let last_units = count_units(&chunks[chunks.len() - 1]);
        if last_units < MIN_UNITS {
            let last = chunks.pop().unwrap_or_default();
            let previous = chunks.last_mut().expect("len >= 2");
            if needs_space(previous, &last) {
                previous.push(' ');
            }
            previous.push_str(&last);
        }
    }
    chunks
}

fn needs_space(left: &str, right: &str) -> bool {
    let Some(last) = left.chars().last() else {
        return false;
    };
    let Some(first) = right.chars().next() else {
        return false;
    };
    !(is_cjk(last) || is_cjk(first) || last.is_whitespace())
}

/// 按句末标点切句，标点跟随前句。
pub fn split_sentences(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;
    while i < chars.len() {
        let c = chars[i];
        if SENTENCE_END.contains(&c) {
            // 小数点 / 缩写：`3.14`、`e.g.` 之后紧跟非空白字符不算句末。
            let mut end = i + 1;
            while end < chars.len() && (SENTENCE_END.contains(&chars[end]) || is_closing_quote(chars[end])) {
                end += 1;
            }
            let ascii_dot = c == '.';
            let followed_by_text = end < chars.len() && !chars[end].is_whitespace() && !is_cjk(chars[end]);
            // `e.g. roughly` / `Mr. smith`：句点后接小写词也不算句末。
            let followed_by_lowercase = chars[end..]
                .iter()
                .find(|ch| !ch.is_whitespace())
                .is_some_and(|ch| ch.is_ascii_lowercase());
            if ascii_dot && (followed_by_text || followed_by_lowercase) {
                i = end;
                continue;
            }
            let sentence: String = chars[start..end].iter().collect();
            let sentence = sentence.trim().to_owned();
            if !sentence.is_empty() {
                out.push(sentence);
            }
            start = end;
            i = end;
            continue;
        }
        i += 1;
    }
    if start < chars.len() {
        let tail: String = chars[start..].iter().collect();
        let tail = tail.trim().to_owned();
        if !tail.is_empty() {
            out.push(tail);
        }
    }
    out
}

fn is_closing_quote(c: char) -> bool {
    matches!(c, '"' | '\'' | '”' | '’' | '」' | '』' | ')' | '）' | '】' | ']')
}

/// 真正收住一句的标点：句号、问号、叹号。英文句点 `.` 另有缩写 / 小数的判断，不在这里。
const STRONG_END: &[char] = &['。', '｡', '．', '！', '？', '!', '?'];
const OPEN_MARKS: &[char] = &['“', '‘', '「', '『', '（', '(', '【', '[', '《', '〈'];
const CLOSE_MARKS: &[char] = &['”', '’', '」', '』', '）', ')', '】', ']', '》', '〉'];
/// 句点后面不收句的常见英文缩写（小写比）。
const ABBREVIATIONS: &[&str] = &[
    "mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "vs", "etc", "no", "inc", "ltd", "co", "mt", "fig", "approx",
];

/// 念出来是几句：说到句号、问号、叹号为止算一句，按顺序返回每一句（旁白清单「一句一条」）。
///
/// 只拿来提醒，所以宁可漏数也不多数，口径与切块用的 [`split_sentences`] 不同（那边决定合成出的
/// 音频，不动），也比对齐结果里的句子（画面锚点，另在 `；` 与 `…` 处切）严：
/// - 省略号（`…`、两个以上的点）不算句末：「嗯……好吧。」是一句；
/// - 引号、括号里的句末不算：「他问：“你去哪？”她没回答。」是一句；
/// - 英文句点后紧跟非空白（`3.14`、`U.S.`）、后接小写词、前面是单个大写字母（`J. K.`）
///   或常见缩写（`Mr.`、`etc.`）都不算；
/// - 句末后面只剩标点、空白时不另起一句。
pub fn spoken_sentences(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut cuts = Vec::new();
    let mut depth = 0usize;
    // 直双引号开合同一个字符，单独记开着没有。
    let mut straight = false;
    let mut i = 0usize;
    while i < chars.len() {
        let c = chars[i];
        if c == '"' {
            straight = !straight;
        } else if OPEN_MARKS.contains(&c) {
            depth += 1;
        } else if CLOSE_MARKS.contains(&c) {
            // `don’t` 里的 `’` 是撇号，不是右引号。
            if !(c == '’' && is_apostrophe(&chars, i)) {
                depth = depth.saturating_sub(1);
            }
        } else if STRONG_END.contains(&c) || c == '.' || c == '…' {
            let mut end = i + 1;
            while end < chars.len() && (STRONG_END.contains(&chars[end]) || matches!(chars[end], '.' | '…')) {
                end += 1;
            }
            if depth == 0 && !straight && closes_sentence(&chars, i, end) {
                cuts.push(end);
            }
            i = end;
            continue;
        }
        i += 1;
    }

    let mut out: Vec<String> = Vec::new();
    let mut pending = String::new();
    let mut start = 0usize;
    for end in cuts.into_iter().chain(std::iter::once(chars.len())) {
        let piece: String = chars[start..end].iter().collect();
        start = end;
        let piece = piece.trim();
        if piece.is_empty() {
            continue;
        }
        // 只剩标点的一段（句末后的右引号、多出来的符号）并回前一句。
        if !piece.chars().any(char::is_alphanumeric) {
            match out.last_mut() {
                Some(last) => last.push_str(piece),
                None => pending.push_str(piece),
            }
            continue;
        }
        out.push(format!("{}{piece}", std::mem::take(&mut pending)));
    }
    if !pending.is_empty() {
        out.push(pending);
    }
    out
}

fn is_apostrophe(chars: &[char], at: usize) -> bool {
    let before = at.checked_sub(1).and_then(|i| chars.get(i));
    let after = chars.get(at + 1);
    before.is_some_and(char::is_ascii_alphabetic) && after.is_some_and(char::is_ascii_alphabetic)
}

/// `chars[start..end]` 是一串连着的句末 / 省略号，它收不收住一句。
fn closes_sentence(chars: &[char], start: usize, end: usize) -> bool {
    let run = &chars[start..end];
    if run.iter().any(|c| STRONG_END.contains(c)) {
        return true;
    }
    if run.contains(&'…') || run.len() >= 2 {
        return false;
    }
    // 只剩单个英文句点。
    if chars.get(end).is_some_and(|c| !c.is_whitespace() && !is_cjk(*c)) {
        return false;
    }
    if chars[end..]
        .iter()
        .find(|c| !c.is_whitespace())
        .is_some_and(char::is_ascii_lowercase)
    {
        return false;
    }
    let word: String = chars[..start]
        .iter()
        .rev()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let initial = word.len() == 1 && word.chars().all(|c| c.is_ascii_uppercase());
    !(initial || ABBREVIATIONS.contains(&word.to_ascii_lowercase().as_str()))
}

/// 超长单句：先按分句标点，再按预算硬切。
fn split_long_sentence(sentence: &str, max_units: usize) -> Vec<String> {
    let chars: Vec<char> = sentence.chars().collect();
    let mut pieces: Vec<String> = Vec::new();
    let mut start = 0usize;
    for (i, c) in chars.iter().enumerate() {
        if CLAUSE_END.contains(c) {
            let piece: String = chars[start..=i].iter().collect();
            let piece = piece.trim().to_owned();
            if !piece.is_empty() {
                pieces.push(piece);
            }
            start = i + 1;
        }
    }
    if start < chars.len() {
        let tail: String = chars[start..].iter().collect();
        let tail = tail.trim().to_owned();
        if !tail.is_empty() {
            pieces.push(tail);
        }
    }
    // 把分句拼回不超预算的块；单个分句仍超长就按单元硬切。
    let mut out = Vec::new();
    let mut current = String::new();
    let mut units = 0usize;
    for piece in pieces {
        let piece_units = count_units(&piece);
        if piece_units > max_units {
            flush(&mut out, &mut current, &mut units);
            out.extend(hard_split(&piece, max_units));
            continue;
        }
        if units + piece_units > max_units && units > 0 {
            flush(&mut out, &mut current, &mut units);
        }
        if !current.is_empty() && needs_space(&current, &piece) {
            current.push(' ');
        }
        current.push_str(&piece);
        units += piece_units;
    }
    flush(&mut out, &mut current, &mut units);
    out
}

fn hard_split(text: &str, max_units: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut units = 0usize;
    for token in tokens(text) {
        let token_units = if token.chars().all(is_cjk) { token.chars().count() } else { 1 };
        if units + token_units > max_units && units > 0 {
            flush(&mut out, &mut current, &mut units);
        }
        if token.chars().all(is_cjk) {
            // CJK 串逐字切，保证单块不超预算。
            for ch in token.chars() {
                if units >= max_units {
                    flush(&mut out, &mut current, &mut units);
                }
                current.push(ch);
                units += 1;
            }
        } else {
            if !current.is_empty() && needs_space(&current, token) {
                current.push(' ');
            }
            current.push_str(token);
            units += 1;
        }
    }
    flush(&mut out, &mut current, &mut units);
    out
}

/// 拆成「CJK 连串」与「非 CJK 词」两类 token。
fn tokens(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    let mut cjk_run = false;
    for (idx, ch) in text.char_indices() {
        if ch.is_whitespace() {
            if let Some(s) = start.take() {
                out.push(&text[s..idx]);
            }
            continue;
        }
        let this_cjk = is_cjk(ch);
        match start {
            None => {
                start = Some(idx);
                cjk_run = this_cjk;
            }
            Some(s) if this_cjk != cjk_run => {
                out.push(&text[s..idx]);
                start = Some(idx);
                cjk_run = this_cjk;
            }
            Some(_) => {}
        }
    }
    if let Some(s) = start {
        out.push(&text[s..]);
    }
    out
}

/// 单元计数：CJK 字各算 1，空格分隔的其他词算 1。标点不计。
pub fn count_units(text: &str) -> usize {
    let mut units = 0usize;
    let mut in_word = false;
    for ch in text.chars() {
        if is_cjk(ch) {
            units += 1;
            in_word = false;
        } else if ch.is_alphanumeric() {
            if !in_word {
                units += 1;
                in_word = true;
            }
        } else {
            in_word = false;
        }
    }
    units
}

pub fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x3040..=0x30FF | // 平假名 / 片假名
        0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF | // CJK 统一表意
        0xAC00..=0xD7AF | // 谚文音节
        0x20000..=0x2FA1F
    )
}

/// 判断文本主要语言（供 Qwen3-TTS 语言 token 自动选择）；返回 `zh`/`ja`/`ko`/`en`。
pub fn guess_language(text: &str) -> &'static str {
    let mut han = 0usize;
    let mut kana = 0usize;
    let mut hangul = 0usize;
    let mut latin = 0usize;
    for c in text.chars() {
        match c as u32 {
            0x3040..=0x30FF => kana += 1,
            0xAC00..=0xD7AF => hangul += 1,
            0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF | 0x20000..=0x2FA1F => han += 1,
            _ if c.is_ascii_alphabetic() => latin += 1,
            _ => {}
        }
    }
    if kana > 0 && kana * 4 >= han {
        "ja"
    } else if hangul > 0 && hangul >= han {
        "ko"
    } else if han > 0 && han * 2 >= latin {
        "zh"
    } else {
        "en"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_text_is_one_chunk() {
        assert_eq!(chunk("你好，世界。", 60), vec!["你好，世界。"]);
        assert_eq!(chunk("  Hello world.  ", 60), vec!["Hello world."]);
        assert!(chunk("   ", 60).is_empty());
    }

    #[test]
    fn splits_chinese_on_sentence_punctuation() {
        let text = "第一句话有一些内容在这里。第二句话也有一些内容在这里！第三句话呢？第四句。";
        let chunks = chunk(text, 20);
        assert_eq!(chunks.len(), 2, "{chunks:?}");
        assert_eq!(chunks[0], "第一句话有一些内容在这里。");
        // 「第三句话呢？」还装得下；「第四句。」是碎尾，并回前一块。
        assert_eq!(chunks[1], "第二句话也有一些内容在这里！第三句话呢？第四句。");
        let sentences = split_sentences(text);
        assert_eq!(sentences.len(), 4);
        assert_eq!(sentences[2], "第三句话呢？");
    }

    #[test]
    fn english_sentences_keep_abbreviations_and_numbers() {
        let sentences = split_sentences("Pi is 3.14 e.g. roughly. Next sentence here!");
        assert_eq!(sentences, vec!["Pi is 3.14 e.g. roughly.", "Next sentence here!"]);
    }

    #[test]
    fn long_sentence_falls_back_to_clauses_then_hard_split() {
        let text = "这是一个非常长的句子，它没有句号，只有逗号，一直在说一直在说，说个不停，还在说，继续说，再说一点，最后终于结束了";
        let chunks = chunk(text, 12);
        assert!(chunks.len() >= 3, "{chunks:?}");
        for c in &chunks {
            assert!(count_units(c) <= 12 + MIN_UNITS, "{c}");
        }
        let joined: String = chunks.concat();
        assert_eq!(joined, text.replace(' ', ""));
        let no_punct = "一".repeat(40);
        let hard = chunk(&no_punct, 16);
        assert_eq!(hard.len(), 3);
        assert_eq!(hard[0].chars().count(), 16);
    }

    #[test]
    fn tiny_tail_merges_into_previous_chunk() {
        let text = "One two three four five six seven eight nine ten eleven. Ok then.";
        let chunks = chunk(text, 12);
        assert_eq!(chunks, vec![text]);
    }

    #[test]
    fn paragraphs_are_always_boundaries() {
        let chunks = chunk("一段。\n\n二段。", 60);
        assert_eq!(chunks, vec!["一段。", "二段。"]);
    }

    #[test]
    fn breaks_follow_sentence_ends_and_paragraphs() {
        let text = "第一句话说得比较长一点，凑够字数。第二句也不短，继续凑够这一块的字数。\n\
                    这一句没有句末标点却非常非常长，长到一块装不下，只好在逗号处断开，然后再接着往下说，一直说到这里才停下来，\
                    后面还跟着一句话。「引号里的一句。」\r\n最后一段。";
        let chunks = chunk_with_breaks(text, 20);
        // 切法与 `chunk` 一字不差。
        assert_eq!(
            chunks.iter().map(|c| c.text.clone()).collect::<Vec<_>>(),
            chunk(text, 20),
            "{chunks:#?}"
        );
        let breaks: Vec<ChunkBreak> = chunks.iter().map(|c| c.after).collect();
        // 段落的最后一块是 Paragraph；块以句末标点（含其后的右引号）收尾是 Sentence；在逗号处断开的是 Clause。
        for chunk in &chunks {
            let expected = if chunk.text.ends_with("凑够这一块的字数。") || chunk.text == "最后一段。" || chunk.text.ends_with("」")
            {
                ChunkBreak::Paragraph
            } else if chunk.text.ends_with('。') {
                ChunkBreak::Sentence
            } else {
                ChunkBreak::Clause
            };
            assert_eq!(chunk.after, expected, "{chunks:#?}");
        }
        assert!(
            breaks.contains(&ChunkBreak::Sentence) && breaks.contains(&ChunkBreak::Clause),
            "{chunks:#?}"
        );
        assert_eq!(breaks.iter().filter(|b| **b == ChunkBreak::Paragraph).count(), 3);
        assert!(ends_sentence("他说：“走吧。”") && ends_sentence("Done!) ") && !ends_sentence("然后，"));
        assert!(chunk_with_breaks(" \n\n ", 20).is_empty());
    }

    #[test]
    fn unit_counting_mixes_scripts() {
        assert_eq!(count_units("你好 world"), 3);
        assert_eq!(count_units("hello, world!"), 2);
        assert_eq!(count_units("日本語のテスト"), 7);
    }

    #[test]
    fn guesses_language() {
        assert_eq!(guess_language("你好世界"), "zh");
        assert_eq!(guess_language("Hello there"), "en");
        assert_eq!(guess_language("こんにちは世界"), "ja");
        assert_eq!(guess_language("안녕하세요"), "ko");
        assert_eq!(guess_language("BaoCut 是一个视频工具"), "zh");
    }

    fn spoken(text: &str) -> usize {
        spoken_sentences(text).len()
    }

    /// 2026-09-24 一次新鲜 Agent 实跑写进清单的两条：各两句，四块装了六句。
    #[test]
    fn two_sentences_in_one_entry_are_counted() {
        assert_eq!(
            spoken_sentences("看这句话：小猫趴在垫子上，因为它很暖。这里的‘它’，指的是谁？"),
            vec!["看这句话：小猫趴在垫子上，因为它很暖。", "这里的‘它’，指的是谁？"]
        );
        assert_eq!(spoken("分数越高，信息的权重越大。把这些信息加权汇总，这个词就理解了上下文。"), 2);
        assert_eq!(spoken("注意力机制，让每个词都去看看其他词。"), 1);
        assert_eq!(spoken("こんにちは。元気ですか？"), 2);
        assert_eq!(spoken("I don’t know. Maybe tomorrow!"), 2);
        assert_eq!(spoken("It costs $3. That is cheap."), 2);
    }

    #[test]
    fn ellipses_and_stacked_marks_do_not_start_a_sentence() {
        assert_eq!(spoken("嗯……好吧。"), 1);
        assert_eq!(spoken("从前有个放羊的孩子……"), 1);
        assert_eq!(spoken("真的吗？！"), 1);
        assert_eq!(spoken("Wait... what?"), 1);
        assert_eq!(spoken("Really?!"), 1);
        assert_eq!(spoken("没有句末标点"), 1);
        assert!(spoken_sentences("  ").is_empty());
    }

    #[test]
    fn quoted_and_bracketed_ends_stay_inside_the_sentence() {
        assert_eq!(spoken("他问：“你去哪？”她没回答。"), 1);
        assert_eq!(spoken("他说：“你好。”"), 1);
        assert_eq!(spoken("书名是「三体。」很好看。"), 1);
        assert_eq!(spoken("注意（见图 1。）这里。"), 1);
        assert_eq!(spoken("He said \"Stop. Now.\" and left."), 1);
        assert_eq!(spoken("“I don’t know. Maybe,” she said."), 1);
        // 句末后面只剩右引号：并回前一句，不另起。
        assert_eq!(spoken_sentences("好了。”"), vec!["好了。”"]);
        // 书名号不挡句末：两句各自收住。
        assert_eq!(spoken("这是《三体》。那是《球状闪电》。"), 2);
    }

    #[test]
    fn english_dots_in_numbers_and_abbreviations_do_not_split() {
        assert_eq!(spoken("圆周率约等于 3.14。"), 1);
        assert_eq!(spoken("我们用 Node.js 写服务。"), 1);
        assert_eq!(spoken("Pi is 3.14 e.g. roughly."), 1);
        assert_eq!(spoken("Dr. Smith arrived at 3.30 p.m. yesterday."), 1);
        assert_eq!(spoken("J. K. Rowling wrote it."), 1);
        assert_eq!(spoken("Apples, pears, etc. Also plums."), 1);
        assert_eq!(spoken("The U.S. is large."), 1);
    }

    /// 切块口径不随计句变：`…` 仍是切块的句末。
    #[test]
    fn chunking_still_splits_on_ellipsis() {
        assert_eq!(split_sentences("嗯……好吧。"), vec!["嗯……", "好吧。"]);
    }
}
