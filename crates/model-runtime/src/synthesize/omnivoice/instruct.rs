//! OmniVoice 声音设计 `instruct` 的受限词表与校验。
//!
//! 对照官方 `omnivoice/utils/voice_design.py`（词表）与
//! `omnivoice/models/omnivoice.py::_resolve_instruct`（校验与归一）：
//! - 词条用半角或全角逗号分隔，英文不分大小写；
//! - 不在词表里的词条整体报错，并用 difflib（`get_close_matches(n=1, cutoff=0.6)`）给出最接近的建议；
//! - 方言只能配中文、口音只能配英文，二者不能同时出现；
//! - 有方言 → 全部换成中文词；有口音 → 全部换成英文词；都没有时按合成文本是否含汉字决定；
//! - 同一类别（性别 / 年龄 / 音高 / 风格 / 口音 / 方言）最多一个；
//! - 输出中文用全角逗号「，」连接，英文用「, 」连接。
//!
//! 与官方的唯一差别：报错文案是中文（信息与官方一致：原词、归一后的词、建议、完整词表）。

use anyhow::{Result, bail};

/// 性别（英文 / 中文一一对应，互斥）。
pub const GENDER_EN: [&str; 2] = ["male", "female"];
pub const GENDER_ZH: [&str; 2] = ["男", "女"];
/// 年龄（互斥）。
pub const AGE_EN: [&str; 5] = ["child", "teenager", "young adult", "middle-aged", "elderly"];
pub const AGE_ZH: [&str; 5] = ["儿童", "少年", "青年", "中年", "老年"];
/// 音高（互斥）。
pub const PITCH_EN: [&str; 5] = ["very low pitch", "low pitch", "moderate pitch", "high pitch", "very high pitch"];
pub const PITCH_ZH: [&str; 5] = ["极低音调", "低音调", "中音调", "高音调", "极高音调"];
/// 风格（耳语）。
pub const STYLE_EN: [&str; 1] = ["whisper"];
pub const STYLE_ZH: [&str; 1] = ["耳语"];
/// 口音：只有英文词，用于英文语音（互斥）。
pub const ACCENT_EN: [&str; 10] = [
    "american accent",
    "british accent",
    "australian accent",
    "chinese accent",
    "canadian accent",
    "indian accent",
    "korean accent",
    "portuguese accent",
    "russian accent",
    "japanese accent",
];
/// 方言：只有中文词，用于中文语音（互斥）。
pub const DIALECT_ZH: [&str; 12] = [
    "河南话",
    "陕西话",
    "四川话",
    "贵州话",
    "云南话",
    "桂林话",
    "济南话",
    "石家庄话",
    "甘肃话",
    "宁夏话",
    "青岛话",
    "东北话",
];

/// 有中英对照的类别：`(英文, 中文)`，顺序即官方 `_INSTRUCT_CATEGORIES` 的顺序。
fn paired_categories() -> [(&'static [&'static str], &'static [&'static str]); 4] {
    [
        (&GENDER_EN, &GENDER_ZH),
        (&AGE_EN, &AGE_ZH),
        (&PITCH_EN, &PITCH_ZH),
        (&STYLE_EN, &STYLE_ZH),
    ]
}

/// 词表的一类，能力表 `instructVocabulary[]` 的一项：客户端据此出「按类挑项」的选择器，
/// 不另抄词表。`en[i]` 与 `zh[i]` 是同一个词；口音只有 `en`、方言只有 `zh`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct VocabularyCategory {
    /// `gender` / `age` / `pitch` / `style` / `accent` / `dialect`。
    pub id: &'static str,
    pub en: &'static [&'static str],
    pub zh: &'static [&'static str],
}

/// 按官方类别次序列出的全部词表（口音、方言在最后）。
pub fn vocabulary() -> [VocabularyCategory; 6] {
    [
        VocabularyCategory {
            id: "gender",
            en: &GENDER_EN,
            zh: &GENDER_ZH,
        },
        VocabularyCategory {
            id: "age",
            en: &AGE_EN,
            zh: &AGE_ZH,
        },
        VocabularyCategory {
            id: "pitch",
            en: &PITCH_EN,
            zh: &PITCH_ZH,
        },
        VocabularyCategory {
            id: "style",
            en: &STYLE_EN,
            zh: &STYLE_ZH,
        },
        VocabularyCategory {
            id: "accent",
            en: &ACCENT_EN,
            zh: &[],
        },
        VocabularyCategory {
            id: "dialect",
            en: &[],
            zh: &DIALECT_ZH,
        },
    ]
}

/// 全部合法词条（官方 `_INSTRUCT_ALL_VALID`）。
pub fn all_items() -> Vec<&'static str> {
    let mut items = Vec::new();
    for (en, zh) in paired_categories() {
        items.extend_from_slice(en);
        items.extend_from_slice(zh);
    }
    items.extend_from_slice(&ACCENT_EN);
    items.extend_from_slice(&DIALECT_ZH);
    items
}

fn has_cjk(s: &str) -> bool {
    s.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
}

/// 合法英文词条（按码位排序，与官方 `sorted(_INSTRUCT_VALID_EN)` 同序）。
pub fn valid_english() -> Vec<&'static str> {
    let mut items: Vec<_> = all_items().into_iter().filter(|s| !has_cjk(s)).collect();
    items.sort_unstable();
    items
}

/// 合法中文词条（按码位排序）。
pub fn valid_chinese() -> Vec<&'static str> {
    let mut items: Vec<_> = all_items().into_iter().filter(|s| has_cjk(s)).collect();
    items.sort_unstable();
    items
}

fn en_to_zh(item: &str) -> Option<&'static str> {
    paired_categories()
        .into_iter()
        .find_map(|(en, zh)| en.iter().position(|e| *e == item).map(|i| zh[i]))
}

fn zh_to_en(item: &str) -> Option<&'static str> {
    paired_categories()
        .into_iter()
        .find_map(|(en, zh)| zh.iter().position(|z| *z == item).map(|i| en[i]))
}

/// 互斥类别（官方 `_INSTRUCT_MUTUALLY_EXCLUSIVE`），用于冲突检查。
fn exclusive_categories() -> Vec<Vec<&'static str>> {
    let mut out: Vec<Vec<&'static str>> = paired_categories()
        .into_iter()
        .map(|(en, zh)| en.iter().chain(zh.iter()).copied().collect())
        .collect();
    out.push(ACCENT_EN.to_vec());
    out.push(DIALECT_ZH.to_vec());
    out
}

/// 官方 `_resolve_instruct`：校验并归一一条 instruct；空串 / 全空白返回 `None`。
/// `use_zh`：合成文本含汉字（`[一-鿿]`）时为真。
pub fn resolve_instruct(instruct: Option<&str>, use_zh: bool) -> Result<Option<String>> {
    let Some(raw) = instruct else {
        return Ok(None);
    };
    let instruct = raw.trim();
    if instruct.is_empty() {
        return Ok(None);
    }
    let all = all_items();
    let mut normalised: Vec<String> = Vec::new();
    let mut unknown: Vec<(String, String, Option<&str>)> = Vec::new();
    for piece in instruct.split([',', '，']) {
        let piece = piece.trim();
        if piece.is_empty() {
            continue;
        }
        let n = piece.to_lowercase();
        if all.contains(&n.as_str()) {
            normalised.push(n);
        } else {
            let suggestion = close_match(&n, &all);
            unknown.push((piece.to_string(), n, suggestion));
        }
    }
    if !unknown.is_empty() {
        let lines: Vec<String> = unknown
            .iter()
            .map(|(raw, n, sug)| match sug {
                Some(s) => format!("  '{raw}' → '{n}'（不支持；是不是想写 '{s}'？）"),
                None => format!("  '{raw}' → '{n}'（不支持）"),
            })
            .collect();
        bail!(
            "instruct 里有不支持的词条：{instruct}\n{}\n\n可用英文词条：{}\n可用中文词条：{}\n\n\
             提示：一条 instruct 只用英文或只用中文；英文用逗号加空格分隔（如 'male, indian accent'），\
             中文用全角逗号分隔（如 '男，河南话'）。",
            lines.join("\n"),
            valid_english().join(", "),
            valid_chinese().join("，"),
        );
    }

    let has_dialect = normalised.iter().any(|n| n.ends_with('话'));
    let has_accent = normalised.iter().any(|n| n.contains(" accent"));
    if has_dialect && has_accent {
        bail!("一条 instruct 里不能同时写中文方言和英文口音：方言用于中文语音，口音用于英文语音。");
    }
    let use_zh = if has_dialect {
        true
    } else if has_accent {
        false
    } else {
        use_zh
    };
    let normalised: Vec<String> = normalised
        .into_iter()
        .map(|n| {
            let mapped = if use_zh { en_to_zh(&n) } else { zh_to_en(&n) };
            mapped.map(str::to_string).unwrap_or(n)
        })
        .collect();

    let mut conflicts: Vec<String> = Vec::new();
    for category in exclusive_categories() {
        let hits: Vec<&String> = normalised.iter().filter(|n| category.contains(&n.as_str())).collect();
        if hits.len() > 1 {
            conflicts.push(hits.iter().map(|h| format!("'{h}'")).collect::<Vec<_>>().join(" 与 "));
        }
    }
    if !conflicts.is_empty() {
        bail!(
            "instruct 同一类别里写了多个词条：{}。性别、年龄、音高、风格、口音、方言每类最多一个。",
            conflicts.join("；")
        );
    }
    let separator = if normalised.iter().any(|n| has_cjk(n)) { "，" } else { ", " };
    Ok(Some(normalised.join(separator)))
}

/// `difflib.get_close_matches(word, possibilities, n=1, cutoff=0.6)`。
fn close_match<'a>(word: &str, possibilities: &[&'a str]) -> Option<&'a str> {
    let b: Vec<char> = word.chars().collect();
    let mut best: Option<(f64, &'a str)> = None;
    for &x in possibilities {
        let a: Vec<char> = x.chars().collect();
        let total = a.len() + b.len();
        if total == 0 {
            continue;
        }
        let score = 2.0 * matching_chars(&a, &b) as f64 / total as f64;
        if score < 0.6 {
            continue;
        }
        // heapq.nlargest 按 (score, x) 取最大：同分时取字符串较大者。
        let better = match best {
            None => true,
            Some((s, y)) => score > s || (score == s && x > y),
        };
        if better {
            best = Some((score, x));
        }
    }
    best.map(|(_, x)| x)
}

/// `SequenceMatcher(None, a, b).get_matching_blocks()` 的匹配字符总数（无 junk；
/// 词条都短于 200，不触发 autojunk）。
fn matching_chars(a: &[char], b: &[char]) -> usize {
    let mut total = 0;
    let mut queue = vec![(0usize, a.len(), 0usize, b.len())];
    while let Some((alo, ahi, blo, bhi)) = queue.pop() {
        let (i, j, k) = longest_match(a, b, alo, ahi, blo, bhi);
        if k > 0 {
            total += k;
            if alo < i && blo < j {
                queue.push((alo, i, blo, j));
            }
            if i + k < ahi && j + k < bhi {
                queue.push((i + k, ahi, j + k, bhi));
            }
        }
    }
    total
}

/// `SequenceMatcher.find_longest_match`：最长公共子串，平手取 a 里最靠前、再取 b 里最靠前。
fn longest_match(a: &[char], b: &[char], alo: usize, ahi: usize, blo: usize, bhi: usize) -> (usize, usize, usize) {
    let (mut besti, mut bestj, mut bestsize) = (alo, blo, 0);
    let mut prev = vec![0usize; b.len() + 1];
    for i in alo..ahi {
        let mut next = vec![0usize; b.len() + 1];
        for j in blo..bhi {
            if a[i] == b[j] {
                let k = if j > 0 { prev[j - 1] } else { 0 } + 1;
                next[j] = k;
                if k > bestsize {
                    besti = i + 1 - k;
                    bestj = j + 1 - k;
                    bestsize = k;
                }
            }
        }
        prev = next;
    }
    (besti, bestj, bestsize)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(s: &str, zh: bool) -> Option<String> {
        resolve_instruct(Some(s), zh).unwrap()
    }

    #[test]
    fn vocabulary_matches_the_official_tables() {
        assert_eq!(all_items().len(), 48);
        assert_eq!(valid_english().len(), 23);
        assert_eq!(valid_chinese().len(), 25);
        assert_eq!(valid_english()[0], "american accent");
        assert_eq!(valid_chinese()[0], "东北话");
    }

    #[test]
    fn exported_vocabulary_is_the_whole_table_and_each_pick_resolves() {
        let mut exported: Vec<&str> = vocabulary()
            .iter()
            .flat_map(|category| category.en.iter().chain(category.zh.iter()).copied())
            .collect();
        let mut all = all_items();
        exported.sort_unstable();
        all.sort_unstable();
        assert_eq!(exported, all);
        for category in vocabulary() {
            if !category.en.is_empty() && !category.zh.is_empty() {
                assert_eq!(category.en.len(), category.zh.len(), "{}", category.id);
            }
            // 每类任挑一项都能单独过校验（客户端按类挑项的前提）。
            for item in category.en.iter().chain(category.zh.iter()) {
                assert!(resolve_instruct(Some(item), false).is_ok(), "{item}");
            }
        }
    }

    // 期望值由官方 `_resolve_instruct` 跑出（python3，omnivoice 源码）。
    #[test]
    fn normalises_like_the_official_resolver() {
        assert_eq!(ok("", false), None);
        assert_eq!(ok("   ", true), None);
        assert_eq!(resolve_instruct(None, true).unwrap(), None);
        assert_eq!(
            ok("Female, Low Pitch, British Accent", true).as_deref(),
            Some("female, low pitch, british accent")
        );
        assert_eq!(ok("男，老年，四川话", false).as_deref(), Some("男，老年，四川话"));
        assert_eq!(ok("male, elderly", true).as_deref(), Some("男，老年"));
        assert_eq!(ok("女，耳语", false).as_deref(), Some("female, whisper"));
        assert_eq!(ok(",male,，whisper,", false).as_deref(), Some("male, whisper"));
        assert_eq!(ok("female, 河南话", false).as_deref(), Some("女，河南话"));
        assert_eq!(ok("女, indian accent", true).as_deref(), Some("female, indian accent"));
    }

    #[test]
    fn rejects_unknown_items_with_difflib_suggestions() {
        let err = resolve_instruct(Some("femal, low pich, robot"), false).unwrap_err().to_string();
        assert!(err.contains("'femal' → 'femal'（不支持；是不是想写 'female'？）"), "{err}");
        assert!(err.contains("'low pich' → 'low pich'（不支持；是不是想写 'low pitch'？）"), "{err}");
        assert!(err.contains("'robot' → 'robot'（不支持）"), "{err}");
        assert!(err.contains("american accent, australian accent"), "{err}");
        assert!(err.contains("东北话，中年"), "{err}");
    }

    #[test]
    fn difflib_ratio_matches_python() {
        // python3 -c "import difflib; print(difflib.get_close_matches(w, VALID, n=1, cutoff=0.6))"
        let all = all_items();
        assert_eq!(close_match("femal", &all), Some("female"));
        assert_eq!(close_match("british", &all), Some("british accent"));
        assert_eq!(close_match("old", &all), None);
        assert_eq!(close_match("四川", &all), Some("四川话"));
        assert_eq!(close_match("very hi pitch", &all), Some("very high pitch"));
        assert_eq!(close_match("whispering", &all), Some("whisper"));
    }

    #[test]
    fn rejects_dialect_with_accent_and_same_category_conflicts() {
        let err = resolve_instruct(Some("四川话, british accent"), true).unwrap_err().to_string();
        assert!(err.contains("不能同时写中文方言和英文口音"), "{err}");
        let err = resolve_instruct(Some("male, 女, child, elderly"), false).unwrap_err().to_string();
        assert!(err.contains("'male' 与 'female'"), "{err}");
        assert!(err.contains("'child' 与 'elderly'"), "{err}");
    }
}
