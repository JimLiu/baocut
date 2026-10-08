//! TTS 合成前注音的内联语法 `<表面|读音>`（架构设计 §6.1「读音标注」），移植自 v2 `bcut-lang::readings`。
//!
//! 这里只放语法本身：解析、去注记、原样拼回。v2 把它放在语言目录那一层，是因为语速口径要按
//! 去注记后的表面文字数（`<行|xing2>` 不能多算五个单位）；v3 的语速口径还没移植，语法先随合成住在这里，
//! 去掉了只给线上 schema 用的 `JsonSchema` 派生。词典判定、按引擎渲染在上一层 [`super`]。
//!
//! 读音是拼音，一个注记可以盖一个字或一个词，多字读音用空格分（`<银行|yin2 hang2>`），读音数必须等于表面字数。
//! 每个音节两种写法都收，可以在同一个注记里混用（`<银行|yín hang2>`）：
//!
//! - 声调数字：ASCII 字母 + `1`–`5`（`hang2`，轻声 `5`），ü 写 `v` 或 `ü`；
//! - 带调拼音：声调标在元音上（`háng`、`lǜ`），不标调就是轻声（`le` → `le5`），ü 可以不带调（`nü` → `nv5`）。
//!   只认预组合字符（`á`、`ǘ`，以及 `ń ň ǹ ḿ`），不认组合附加符；一个音节两个调号、调号与声调数字同时出现都不合法。
//!
//! 解析时一律规范成声调数字的写法：大小写不分（统一成小写），`ü` 折成 `v`，j / q / x / y 后的 `v` 折成 `u`
//! （与 pypinyin `Style.TONE3` 同形）；所以引擎、存储与之后的流程只见到 `hang2` / `lv4` / `le5`。
//! 音节只按形状判断（去调后 1–6 个字母、含元音或是 `m n ng hm hng`），不对照拼音音节表。
//!
//! 只有表面含汉字、读音只由 ASCII 字母数字、空格、`ü` 与带调元音组成的尖括号才可能是拼音注记：
//! 读音里有声调数字或调号的，读音不合法（调号与数字并存、两个调号、不像音节、读音数不符）时整条按字面留在表面文字里，
//! 并记进 [`Annotated::malformed`]；既没有数字也没有调号的（`<了|le>`）只在整条合法时才是注记，
//! 否则（`<中文|Chinese>`）按字面保留、不报。
//! 别的尖括号（英文 ARPAbet、日文假名、不成对的 `<`）一律按字面保留、不报。

use serde::{Deserialize, Serialize};

/// 注记的来源。渲染层据此区分：Qwen3-TTS 不替换 `Phrase`（词组本来就会念对）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    /// 用户（或 Agent）在文字里手写的注记。
    User,
    /// 词组表命中定下的读音。
    Phrase,
    /// 单字按词典默认读音。
    Dict,
    /// LLM 按上下文定下的读音。
    Llm,
}

/// 一条注记：表面文字 `[start, end)`（Unicode 标量偏移）读作 `reading`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    pub start: usize,
    pub end: usize,
    /// 规范化后的读音，多字用单个空格分（`yin2 hang2`）；畸形注记是原文读音。
    pub reading: String,
    pub origin: Origin,
}

impl Reading {
    /// 逐字读音。
    pub fn syllables(&self) -> impl Iterator<Item = &str> {
        self.reading.split(' ')
    }
}

/// 一个语境多音字候选：词组表没能定下读音、要看上下文的单字。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub start: usize,
    pub end: usize,
    /// 词典默认读音。
    pub default: String,
    /// 全部读音（默认读音在前）。
    pub readings: Vec<String>,
}

/// 解析结果：去注记后的表面文字与落在它上面的注记。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotated {
    pub surface: String,
    /// 按 `start` 升序、互不重叠。
    pub readings: Vec<Reading>,
    /// 看得出是拼音注记但读音不合法的，按字面留在 `surface` 里；偏移指向其中的表面文字。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub malformed: Vec<Reading>,
    /// `annotate` 给的语境多音字候选（`parse` 不产生）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub candidates: Vec<Candidate>,
}

impl Annotated {
    /// 没有任何注记（也没有畸形注记）。
    pub fn is_plain(&self) -> bool {
        self.readings.is_empty() && self.malformed.is_empty()
    }

    /// `[start, end)` 的表面文字。
    pub fn slice(&self, start: usize, end: usize) -> String {
        self.surface.chars().skip(start).take(end.saturating_sub(start)).collect()
    }

    /// 把注记原样拼回 `<表面|读音>`（IndexTTS 2.5 直接吃这个语法）；`parse(to_text())` 与自身相等。
    pub fn to_text(&self) -> String {
        let mut out = String::with_capacity(self.surface.len() + self.readings.len() * 12);
        let mut next = self.readings.iter().peekable();
        let mut pending: Option<(&Reading, String)> = None;
        for (index, c) in self.surface.chars().enumerate() {
            if pending.is_none()
                && let Some(reading) = next.next_if(|r| r.start == index)
            {
                pending = Some((reading, String::new()));
            }
            match pending.as_mut() {
                Some((reading, buf)) => {
                    buf.push(c);
                    if index + 1 == reading.end {
                        out.push('<');
                        out.push_str(buf);
                        out.push('|');
                        out.push_str(&reading.reading);
                        out.push('>');
                        pending = None;
                    }
                }
                None => out.push(c),
            }
        }
        out
    }
}

/// 去掉注记，只留表面文字（`<行|xing2>` → `行`）。
pub fn strip(text: &str) -> String {
    if !text.contains('<') {
        return text.to_owned();
    }
    parse(text).surface
}

/// 文字里有没有合法的拼音注记。
pub fn has_readings(text: &str) -> bool {
    text.contains('<') && !parse(text).readings.is_empty()
}

/// 解析 `<表面|读音>` 注记；手写的一律记 [`Origin::User`]。
pub fn parse(text: &str) -> Annotated {
    let mut out = Annotated::default();
    if !text.contains('<') {
        out.surface = text.to_owned();
        return out;
    }
    let chars: Vec<char> = text.chars().collect();
    let mut surface_len = 0usize;
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '<'
            && let Some((bar, close)) = bracket(&chars, i)
        {
            let face = &chars[i + 1..bar];
            let raw: String = chars[bar + 1..close].iter().collect();
            if is_pinyin_attempt(face, &raw) {
                let reading = normalize(&raw, face.len());
                if reading.is_none() && !has_tone(&raw) {
                    // 不带声调的读音（`<中文|Chinese>`）不合法时不像拼音注记：字面、不报。
                    out.surface.push(chars[i]);
                    surface_len += 1;
                    i += 1;
                    continue;
                }
                match reading {
                    Some(reading) => {
                        out.readings.push(Reading {
                            start: surface_len,
                            end: surface_len + face.len(),
                            reading,
                            origin: Origin::User,
                        });
                        out.surface.extend(face);
                        surface_len += face.len();
                    }
                    None => {
                        out.malformed.push(Reading {
                            start: surface_len + 1,
                            end: surface_len + 1 + face.len(),
                            reading: raw,
                            origin: Origin::User,
                        });
                        out.surface.extend(&chars[i..=close]);
                        surface_len += close + 1 - i;
                    }
                }
                i = close + 1;
                continue;
            }
        }
        out.surface.push(chars[i]);
        surface_len += 1;
        i += 1;
    }
    out
}

/// `chars[open] == '<'` 起的 `<表面|读音>`：返回 `|` 与 `>` 的下标。两段都非空、不含 `< > | 换行`。
fn bracket(chars: &[char], open: usize) -> Option<(usize, usize)> {
    let stop = |c: char| matches!(c, '<' | '>' | '|' | '\n');
    let bar = open + 1 + chars[open + 1..].iter().position(|&c| stop(c))?;
    if chars[bar] != '|' || bar == open + 1 {
        return None;
    }
    let close = bar + 1 + chars[bar + 1..].iter().position(|&c| stop(c))?;
    if chars[close] != '>' || close == bar + 1 {
        return None;
    }
    Some((bar, close))
}

fn is_han(c: char) -> bool {
    ('\u{3400}'..='\u{9FFF}').contains(&c) || ('\u{20000}'..='\u{2FFFF}').contains(&c)
}

/// 带调字母（已转小写）→ 去调的 ASCII 字母与声调（`ü` 不带调，声调为 0）。
fn fold_marked(c: char) -> Option<(char, u8)> {
    const TABLE: [(char, [char; 4]); 8] = [
        ('a', ['ā', 'á', 'ǎ', 'à']),
        ('e', ['ē', 'é', 'ě', 'è']),
        ('i', ['ī', 'í', 'ǐ', 'ì']),
        ('o', ['ō', 'ó', 'ǒ', 'ò']),
        ('u', ['ū', 'ú', 'ǔ', 'ù']),
        ('v', ['ǖ', 'ǘ', 'ǚ', 'ǜ']),
        ('n', ['\0', 'ń', 'ň', 'ǹ']),
        ('m', ['\0', 'ḿ', '\0', '\0']),
    ];
    if c == 'ü' {
        return Some(('v', 0));
    }
    TABLE.iter().find_map(|(base, marks)| {
        let tone = marks.iter().position(|&m| m == c && m != '\0')?;
        Some((*base, tone as u8 + 1))
    })
}

/// 读音里的一个字符转小写后（拉丁大写字母只有一个小写形式）。
fn lower(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

fn is_pinyin_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == ' ' || fold_marked(lower(c)).is_some()
}

/// 读音带声调数字或调号：看得出是在写拼音注记（不合法时报 malformed）。
fn has_tone(raw: &str) -> bool {
    raw.chars()
        .any(|c| c.is_ascii_digit() || fold_marked(lower(c)).is_some_and(|(_, tone)| tone > 0))
}

fn is_pinyin_attempt(face: &[char], raw: &str) -> bool {
    face.iter().any(|&c| is_han(c)) && raw.chars().all(is_pinyin_char)
}

/// 一个音节 → `hang2` 这样的规范写法；须是 1–6 个字母、含元音（或是成音节的 `m n ng hm hng`），声调来自末尾的数字 1–5、唯一的调号或轻声。
fn normalize_syllable(raw: &str) -> Option<String> {
    let mut body = String::with_capacity(raw.len());
    let mut mark = None;
    let mut digit = None;
    for c in raw.chars() {
        if digit.is_some() {
            return None;
        }
        let c = lower(c);
        match c {
            'a'..='z' => body.push(c),
            '1'..='5' => digit = Some(c as u8 - b'0'),
            _ => {
                let (base, tone) = fold_marked(c)?;
                body.push(base);
                if tone > 0 {
                    if mark.is_some() {
                        return None;
                    }
                    mark = Some(tone);
                }
            }
        }
    }
    let tone = match (digit, mark) {
        (Some(_), Some(_)) => return None,
        (Some(tone), None) | (None, Some(tone)) => tone,
        (None, None) => 5,
    };
    let voiced = body.contains(['a', 'e', 'i', 'o', 'u', 'v']) || matches!(body.as_str(), "m" | "n" | "ng" | "hm" | "hng");
    if !(1..=6).contains(&body.len()) || !voiced {
        return None;
    }
    if matches!(body.as_bytes()[0], b'j' | b'q' | b'x' | b'y') {
        body = body.replace('v', "u");
    }
    Some(format!("{body}{tone}"))
}

/// 规范化读音；每个音节见 [`normalize_syllable`]，个数等于表面字数。
fn normalize(raw: &str, count: usize) -> Option<String> {
    let syllables = raw.split_whitespace().map(normalize_syllable).collect::<Option<Vec<_>>>()?;
    (syllables.len() == count).then(|| syllables.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(start: usize, end: usize, reading: &str) -> Reading {
        Reading {
            start,
            end,
            reading: reading.to_owned(),
            origin: Origin::User,
        }
    }

    #[test]
    fn single_character() {
        let a = parse("他在银<行|XING2>里");
        assert_eq!(a.surface, "他在银行里");
        assert_eq!(a.readings, [user(3, 4, "xing2")]);
        assert!(a.malformed.is_empty());
        assert_eq!(strip("他在银<行|XING2>里"), "他在银行里");
    }

    #[test]
    fn multi_character_and_umlaut() {
        let a = parse("<银行|yin2  hang2>门口的<绿|lü4>灯，<句|jv4>子");
        assert_eq!(a.surface, "银行门口的绿灯，句子");
        assert_eq!(a.readings, [user(0, 2, "yin2 hang2"), user(5, 6, "lv4"), user(8, 9, "ju4")]);
        assert_eq!(a.readings[0].syllables().collect::<Vec<_>>(), ["yin2", "hang2"]);
    }

    #[test]
    fn mixed_chinese_and_english() {
        let a = parse("AI 让这一<行|hang2>变了，<read|R EH1 D> it，a < b");
        assert_eq!(a.surface, "AI 让这一行变了，<read|R EH1 D> it，a < b");
        assert_eq!(a.readings, [user(6, 7, "hang2")]);
        assert!(a.malformed.is_empty(), "英文音素注记不是拼音注记，不报");
    }

    #[test]
    fn no_annotation_is_untouched() {
        let a = parse("这件事我觉得行。");
        assert_eq!(a.surface, "这件事我觉得行。");
        assert!(a.is_plain());
        assert!(!has_readings("这件事我觉得行。"));
        assert!(has_readings("觉得<行|xing2>"));
    }

    #[test]
    fn malformed_annotations_stay_literal() {
        // 缺 `|`：不是注记，按字面保留、不报。
        let a = parse("<行xing2>走");
        assert_eq!(a.surface, "<行xing2>走");
        assert!(a.is_plain());
        // 读音数不符：整条按字面保留，报进 malformed，偏移指向表面文字。
        let a = parse("去<银行|hang2>办事");
        assert_eq!(a.surface, "去<银行|hang2>办事");
        assert!(a.readings.is_empty());
        assert_eq!(a.malformed, [user(2, 4, "hang2")]);
        assert_eq!(a.slice(2, 4), "银行");
        // 声调数字多一个：读音数不符以外的畸形同样报。
        assert_eq!(parse("<行|xing22>").malformed.len(), 1);
        // 不带声调、又不合法的读音（读音数不符、超过 6 个字母）不像拼音注记：字面、不报。
        assert!(parse("<中文|Chinese>").is_plain());
        assert!(parse("<好|hello world>").is_plain());
        assert!(parse("<行|xyz>").is_plain());
        // 带声调但没有元音的音节不合法（成音节的 m / n / ng / hm / hng 除外）。
        assert_eq!(parse("<行|xyz2>").malformed.len(), 1);
        assert_eq!(parse("<呣|m2>").readings, [user(0, 1, "m2")]);
        assert_eq!(parse("<哼|hng>").readings, [user(0, 1, "hng5")]);
        // 嵌套：外层 `<` 按字面，内层照常解析。
        let a = parse("<外<行|xing2>|x>");
        assert_eq!(a.surface, "<外行|x>");
        assert_eq!(a.readings, [user(2, 3, "xing2")]);
        // 空读音、日文假名：字面。
        assert!(parse("<行|>").is_plain());
        assert!(parse("<今日|きょう>").is_plain());
    }

    #[test]
    fn tone_marks_normalize_to_digits() {
        let a = parse("<行|háng>、<银行|yín háng>、<绿|lǜ>、走<了|le>、<女|nǚ>、<驴|lǘ>、<女|nü>、<嗯|ńg>");
        assert_eq!(a.surface, "行、银行、绿、走了、女、驴、女、嗯");
        let readings: Vec<_> = a.readings.iter().map(|r| r.reading.as_str()).collect();
        assert_eq!(readings, ["hang2", "yin2 hang2", "lv4", "le5", "nv3", "lv2", "nv5", "ng2"]);
        assert!(a.malformed.is_empty());
        // j / q / x / y 后的 ü 折成 u，与数字写法同形。
        assert_eq!(parse("<句|jǜ>").readings, [user(0, 1, "ju4")]);
        assert_eq!(parse("<雨|yǔ>").readings, [user(0, 1, "yu3")]);
        // 不标调的单字：轻声。
        assert_eq!(parse("<行|xing>").readings, [user(0, 1, "xing5")]);
    }

    #[test]
    fn mixed_and_uppercase_syllables() {
        // 每个音节各自认写法，可以混用。
        assert_eq!(parse("<银行|yín hang2>").readings, [user(0, 2, "yin2 hang2")]);
        assert_eq!(parse("<银行|yin2 háng>").readings, [user(0, 2, "yin2 hang2")]);
        // 数字写法里不带数字的音节同样是轻声。
        assert_eq!(parse("<东西|dong1 xi>").readings, [user(0, 2, "dong1 xi5")]);
        // 大写一律折成小写，带调的大写字母也一样。
        assert_eq!(parse("<行|HÁNG>").readings, [user(0, 1, "hang2")]);
        assert_eq!(parse("<银行|Yín Háng>").readings, [user(0, 2, "yin2 hang2")]);
        assert_eq!(parse("<绿|LǛ>").readings, [user(0, 1, "lv4")]);
        assert_eq!(parse("<女|NÜ3>").readings, [user(0, 1, "nv3")]);
    }

    #[test]
    fn invalid_tone_marks_stay_literal() {
        for text in [
            "<行|háng2>",       // 调号与数字同时出现
            "<行|hángá>",       // 一个音节两个调号
            "<银行|yín>",       // 读音数不符
            "<行|zhuángáng>",   // 去调后超过 6 个字母
            "<银行|yín 2háng>", // 数字不在末尾
        ] {
            let a = parse(text);
            assert_eq!(a.surface, text, "{text}");
            assert!(a.readings.is_empty(), "{text}");
            assert_eq!(a.malformed.len(), 1, "{text}");
        }
        // 畸形注记记的是原文读音。
        assert_eq!(parse("<行|háng2>").malformed[0].reading, "háng2");
        // 组合附加符（`a` + U+0301）不认：不是拼音字符，字面、不报。
        assert!(parse("<行|ha\u{301}ng>").is_plain());
    }

    #[test]
    fn tone_marks_round_trip_as_digits() {
        let a = parse("他在<银行|yín háng>上班，<长|zhǎng>得高，不<行|xíng>了。");
        assert_eq!(a.to_text(), "他在<银行|yin2 hang2>上班，<长|zhang3>得高，不<行|xing2>了。");
        assert_eq!(parse(&a.to_text()), a);
    }

    #[test]
    fn to_text_round_trips() {
        let text = "他在<银行|yin2 hang2>上班，<长|zhang3>得高，不<行|xing2>。";
        let a = parse(text);
        assert_eq!(a.to_text(), text);
        assert_eq!(parse(&a.to_text()), a);
    }
}
