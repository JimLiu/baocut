//! 没有对齐器时的词时间：按每个词的字符数在段内按比例插值。结果的 `timingQuality` 一律是 `estimated`。

use super::text_prep::split_into_word_pairs;

/// 一个估算出来的词（f64 秒，与段同一时钟）。
#[derive(Debug, Clone, PartialEq)]
pub struct EstimatedWord {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

/// 把 `text` 切成词，按清理后的字符数把 `[start, end]` 分给它们。首词从 `start` 开始，末词在 `end` 结束，
/// 相邻词首尾相接。切不出词（全是标点）时整段文本算一个词；文本为空时没有词。
pub fn estimate(text: &str, language: Option<&str>, start: f64, end: f64) -> Vec<EstimatedWord> {
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }
    let end = end.max(start);
    let pairs = split_into_word_pairs(text, language);
    if pairs.is_empty() {
        return vec![EstimatedWord {
            text: text.to_owned(),
            start,
            end,
        }];
    }

    let weights: Vec<f64> = pairs.iter().map(|pair| pair.cleaned.chars().count().max(1) as f64).collect();
    let total: f64 = weights.iter().sum();
    let mut words = Vec::with_capacity(pairs.len());
    let mut consumed = 0.0;
    let mut cursor = start;
    for (index, (pair, weight)) in pairs.into_iter().zip(&weights).enumerate() {
        consumed += weight;
        let word_end = if index + 1 == weights.len() {
            end
        } else {
            (start + (end - start) * consumed / total).min(end)
        };
        words.push(EstimatedWord {
            text: pair.surface,
            start: cursor,
            end: word_end,
        });
        cursor = word_end;
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolates_by_character_length() {
        let words = estimate("ab abcd, ab", Some("en"), 1.0, 2.6);
        assert_eq!(
            words.iter().map(|word| word.text.as_str()).collect::<Vec<_>>(),
            ["ab", "abcd,", "ab"]
        );
        // 2 + 4 + 2 = 8 个字符，1.6 秒：每字符 0.2 秒。
        let close = |a: f64, b: f64| (a - b).abs() < 1e-9;
        assert!(close(words[0].start, 1.0) && close(words[0].end, 1.4));
        assert!(close(words[1].start, 1.4) && close(words[1].end, 2.2));
        assert_eq!((words[2].start, words[2].end), (words[1].end, 2.6));
    }

    #[test]
    fn han_text_gets_one_word_per_character() {
        let words = estimate("你好。", Some("zh"), 0.0, 1.0);
        assert_eq!(words.len(), 2);
        assert_eq!(words[1].text, "好。");
        assert_eq!(words[1].end, 1.0);
    }

    #[test]
    fn degenerate_inputs() {
        assert!(estimate("   ", None, 0.0, 1.0).is_empty());
        assert_eq!(
            estimate("?!", None, 0.5, 0.75),
            [EstimatedWord {
                text: "?!".into(),
                start: 0.5,
                end: 0.75
            }]
        );
        // 段长为零时所有词都塌在一点上，仍然单调。
        let collapsed = estimate("a b", None, 2.0, 1.0);
        assert!(collapsed.iter().all(|word| word.start == 2.0 && word.end == 2.0));
    }
}
