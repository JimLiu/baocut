//! 共享的源词边界判断。翻译对齐维持原判据；英文源 Cue 在其上增加不可拆短语保护。

use crate::atomize::join_word_texts;
use crate::seam::{ends_dangling, source_boundary_strength};

/// 源 Cue 的切点比跨语对齐更严格：功能词不得悬在行尾，已知固定短语不得拆开。
/// 这不是句法解析器；只约束高置信度结构，不把未知普通词对猜成名词短语。
/// 调用方只在 en / en-* 文稿启用，显式用户断点仍有更高优先级。
pub(crate) fn english_cue_boundary_issue(words: &[&str], boundary: usize) -> Option<String> {
    if boundary == 0 || boundary >= words.len() || source_boundary_strength(words, boundary) >= 3 {
        return None;
    }
    if let Some(issue) = source_boundary_issue(words, boundary) {
        return Some(issue);
    }
    let tokens: Vec<_> = words
        .iter()
        .map(|word| {
            normalized_source_lexemes(word)
                .into_iter()
                .next_back()
                .unwrap_or_default()
        })
        .collect();
    let tail = tokens[boundary - 1].as_str();
    // 这些词无句读地留在行尾时仍依赖后续成分。保留标点后的自然停顿，
    // 例如 “Yes, you can. | Next ...” 不会被本表拦截。
    const BOUND_TAILS: &[&str] = &[
        "in",
        "on",
        "at",
        "with",
        "from",
        "for",
        "into",
        "onto",
        "within",
        "without",
        "under",
        "over",
        "between",
        "through",
        "by",
        "during",
        "about",
        "as",
        "if",
        "when",
        "while",
        "because",
        "although",
        "unless",
        "until",
        "whether",
        "where",
        "which",
        "who",
        "whose",
        "whom",
        "what",
        "how",
        "why",
        "very",
        "quite",
        "rather",
        "too",
        "most",
        "not",
        "cannot",
        "can't",
        "don't",
        "doesn't",
        "didn't",
        "isn't",
        "aren't",
        "wasn't",
        "weren't",
        "won't",
        "wouldn't",
        "couldn't",
        "shouldn't",
        "mustn't",
        "hasn't",
        "haven't",
        "hadn't",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "will",
        "would",
        "can",
        "could",
        "should",
        "must",
        "might",
        "may",
        "shall",
        "i",
        "we",
        "you",
        "he",
        "she",
        "it",
        "they",
        "i'm",
        "you're",
        "we're",
        "they're",
        "it's",
        "that's",
        "there's",
        "i've",
        "you've",
        "we've",
        "they've",
    ];
    if BOUND_TAILS.contains(&tail) {
        return Some(format!(
            "bound English cue tail \"{}\"",
            words[boundary - 1]
        ));
    }
    const PHRASES: &[&[&str]] = &[
        &["sort", "of"],
        &["kind", "of"],
        &["in", "terms", "of"],
        &["as", "well", "as"],
        &["such", "as"],
        &["at", "least"],
        &["rather", "than"],
        &["even", "though"],
        &["even", "if"],
        &["national", "security"],
        &["artificial", "intelligence"],
        &["machine", "learning"],
        &["data", "center"],
        &["data", "centers"],
    ];
    for phrase in PHRASES {
        for split in 1..phrase.len() {
            if boundary >= split {
                let start = boundary - split;
                if tokens
                    .get(start..start + phrase.len())
                    .is_some_and(|part| part.iter().map(String::as_str).eq(phrase.iter().copied()))
                {
                    return Some(format!("fixed English phrase \"{}\"", phrase.join(" ")));
                }
            }
        }
    }
    None
}

/// 逗号后的高置信度从句起点；名词枚举与 like / basically 一类填充语不在此表。
pub(crate) fn english_clause_start(word: &str) -> bool {
    let token = normalized_source_lexemes(word)
        .into_iter()
        .next()
        .unwrap_or_default();
    matches!(
        token.as_str(),
        "i" | "we"
            | "you"
            | "he"
            | "she"
            | "it"
            | "they"
            | "i'm"
            | "we're"
            | "you're"
            | "they're"
            | "it's"
            | "that's"
            | "there's"
            | "but"
            | "because"
            | "although"
            | "if"
            | "when"
            | "while"
            | "unless"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cue_guards_use_both_sides_without_changing_alignment_rules() {
        for (words, boundary) in [
            (vec!["a", "national", "security", "issue"], 2),
            (vec!["the", "sort", "of", "scenario"], 2),
            (vec!["very", "dangerous"], 1),
            (vec!["if", "you", "control", "AI"], 2),
            (vec!["a", "place", "where", "we", "work"], 3),
            (vec!["we", "are", "not", "ready"], 3),
            (vec!["need", "to", "write"], 1),
        ] {
            assert!(
                english_cue_boundary_issue(&words, boundary).is_some(),
                "{words:?}"
            );
        }
        // Cue 新增的约束不改变翻译对齐的调用契约。
        assert!(source_boundary_issue(&["national", "security"], 1).is_none());
        assert!(source_boundary_issue(&["very", "dangerous"], 1).is_none());
        for (words, boundary) in [
            (vec!["AI,", "you", "know"], 1),
            (vec!["we", "can.", "Next"], 2),
            (vec!["use", "this", "when", "needed"], 2),
            (vec!["each", "other", "across", "town"], 2),
            (vec!["security", "policy"], 1),
        ] {
            assert!(
                english_cue_boundary_issue(&words, boundary).is_none(),
                "{words:?}"
            );
        }
    }
}

pub(crate) fn normalized_source_lexemes(text: &str) -> Vec<String> {
    text.to_ascii_lowercase()
        .split(|ch: char| !ch.is_alphanumeric() && ch != '\'' && ch != '-')
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
        .collect()
}

/// 无解析器条件下只拦截高置信度的源语残片。一般的无标点短语仍交给 LLM
/// 判断；冠词/所有格/常见前置修饰语悬在片尾则一定不是完整语义单位。
pub fn source_boundary_issue(words: &[&str], boundary: usize) -> Option<String> {
    if boundary == 0 || boundary >= words.len() || source_boundary_strength(words, boundary) >= 3 {
        return None;
    }
    let left = join_word_texts(words[..boundary].iter().copied());
    if ends_dangling(&left) {
        return Some(format!("dangling source tail \"{}\"", words[boundary - 1]));
    }
    let tail = normalized_source_lexemes(words[boundary - 1])
        .into_iter()
        .next_back()
        .unwrap_or_default();
    let head = normalized_source_lexemes(words[boundary])
        .into_iter()
        .next()
        .unwrap_or_default();
    let next = words
        .get(boundary + 1)
        .and_then(|word| normalized_source_lexemes(word).into_iter().next())
        .unwrap_or_default();
    // 高置信度的英语不定式补语：`need | to write prompts`
    // 会把谓词的必需补语切到下一行，不能因为此处恰有轻停顿
    // 或 seam1 就放行。只列可高信判定的支配词，避免把
    // `walk | to the store` 这类可独立的方向短语一概禁掉。
    const INFINITIVE_COMPLEMENT_HEADS: &[&str] = &[
        "afford",
        "afforded",
        "agree",
        "agreed",
        "aim",
        "aimed",
        "attempt",
        "attempted",
        "choose",
        "chose",
        "decide",
        "decided",
        "expect",
        "expected",
        "fail",
        "failed",
        "hope",
        "hoped",
        "intend",
        "intended",
        "learn",
        "learned",
        "manage",
        "managed",
        "need",
        "needed",
        "needs",
        "plan",
        "planned",
        "prefer",
        "preferred",
        "promise",
        "promised",
        "refuse",
        "refused",
        "try",
        "tried",
        "tries",
        "want",
        "wanted",
        "wants",
        "wish",
        "wished",
    ];
    if head == "to" && !next.is_empty() && INFINITIVE_COMPLEMENT_HEADS.contains(&tail.as_str()) {
        return Some(format!(
            "source infinitive complement \"{} to {}\" is split before its required complement",
            words[boundary - 1],
            words[boundary + 1]
        ));
    }
    if tail == "it" && head == "this" && next == "way" {
        return Some("fixed expression \"do it this way\" is split inside the phrase".to_owned());
    }
    const JAPANESE_BOUND_PARTICLES: &[&str] = &[
        "は",
        "が",
        "を",
        "に",
        "で",
        "と",
        "の",
        "へ",
        "も",
        "や",
        "から",
        "まで",
        "より",
        "ので",
        "のに",
        "けど",
        "けれど",
    ];
    if JAPANESE_BOUND_PARTICLES.contains(&head.as_str()) {
        return Some(format!(
            "Japanese bound particle \"{}\" would start the next segment",
            words[boundary]
        ));
    }
    const BOUND_MODIFIERS: &[&str] = &[
        "my", "your", "his", "her", "its", "our", "their", "this", "that", "these", "those",
        "each", "every", "some", "any", "no", "new", "other", "same", "first", "last", "next",
        "own", "more", "less", "many", "much", "few", "several",
    ];
    // `thought that | proposition` 一类 reporting bridge 常被目标语压缩成
    // “参与者认为，| 命题”，这是优质双语边界；不要把补语 that 误标成
    // 限定词。其他 `that | noun/clause` 仍保持风险提示。
    const REPORTING_VERBS: &[&str] = &[
        "argue", "argued", "believe", "believed", "claim", "claimed", "find", "found", "know",
        "knew", "say", "said", "show", "showed", "think", "thought",
    ];
    let previous = boundary
        .checked_sub(2)
        .and_then(|index| {
            normalized_source_lexemes(words[index])
                .into_iter()
                .next_back()
        })
        .unwrap_or_default();
    let reporting_bridge =
        tail == "that" && boundary >= 2 && REPORTING_VERBS.contains(&previous.as_str());
    // `each other | across ...` 已在完整互指短语之后收口；不要只因末词
    // `other` 同时也是常见前置修饰词，就把这条自然边界误判为悬空修饰语。
    let reciprocal_complete = tail == "other"
        && boundary >= 2
        && normalized_source_lexemes(words[boundary - 2])
            .into_iter()
            .next_back()
            .is_some_and(|token| token == "each");
    // `doing this | ...`、`reach for this | ...`：this/that/these/those 跟在
    // 及物动词或介词之后、且下一片以功能词（连词、代词、系动词、状语等
    // 无法充当名词中心语的词）开头时，它是宾语代词而非限定词，这条边界
    // 是完整的。`use this | model` 一类真限定词用法仍保持提示。
    const PRONOUN_OBJECT_HEADS: &[&str] = &[
        "do", "does", "did", "doing", "done", "for", "to", "with", "into", "at", "on", "about",
        "from", "of", "in", "by", "like", "reach", "reaches", "reached", "try", "tries", "tried",
        "use", "uses", "used", "using", "see", "sees", "saw", "seen", "watch", "watches",
        "watched", "know", "knew", "known", "get", "gets", "got", "make", "makes", "made", "take",
        "takes", "took", "say", "says", "said", "build", "builds", "built", "fix", "fixes",
        "fixed", "solve", "solves", "solved",
    ];
    const CLAUSE_STARTERS: &[&str] = &[
        "and", "but", "so", "or", "because", "if", "when", "while", "then", "instead", "again",
        "now", "also", "today", "first", "next", "later", "though", "although", "since", "as",
        "we", "you", "they", "he", "she", "it", "i", "there", "that", "who", "which", "is", "are",
        "was", "were", "will", "would", "can", "could", "should", "let", "to", "in", "at", "for",
        "with", "on", "by", "from", "of", "without",
    ];
    let pronoun_object = matches!(tail.as_str(), "this" | "that" | "these" | "those")
        && PRONOUN_OBJECT_HEADS.contains(&previous.as_str())
        && CLAUSE_STARTERS.contains(&head.as_str());
    if BOUND_MODIFIERS.contains(&tail.as_str())
        && !reporting_bridge
        && !reciprocal_complete
        && !pronoun_object
    {
        return Some(format!(
            "source modifier \"{}\" is detached from its noun phrase",
            words[boundary - 1]
        ));
    }
    const RELATION_TAILS: &[&str] = &["thanks", "because", "due", "owing"];
    RELATION_TAILS.contains(&tail.as_str()).then(|| {
        format!(
            "source relation \"{} {}\" is split before its complement",
            words[boundary - 1],
            words[boundary]
        )
    })
}
