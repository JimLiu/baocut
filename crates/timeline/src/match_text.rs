use std::error::Error;
use std::fmt::{self, Display, Formatter};

use regex::RegexBuilder;

use crate::CutSet;
use crate::cuts::CUT_MERGE_GAP;

#[derive(Debug, Clone, PartialEq)]
pub struct MatchWord {
    pub id: String,
    pub t0: f64,
    pub t1: f64,
    pub text: String,
    /// 文稿词的「贴前」标记：与前一个词之间不写空格，不看两侧是什么字符。
    pub glue: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MatchParagraph {
    pub words: Vec<MatchWord>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchScope {
    Match,
    Paragraph,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchAction {
    Cut,
    Keep,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MatchOptions {
    pub query: String,
    pub regex: bool,
    pub whole_word: bool,
    pub case_sensitive: bool,
    pub scope: MatchScope,
    pub action: MatchAction,
    pub content_end: f64,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MatchHit {
    pub start: f64,
    pub end: f64,
    pub word_ids: Vec<String>,
    pub excerpt: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MatchCutSpan {
    pub t0: f64,
    pub t1: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MatchPlan {
    pub action: MatchAction,
    pub scope: MatchScope,
    pub query: String,
    pub reason: String,
    pub hits: Vec<MatchHit>,
    pub cut_spans: Vec<MatchCutSpan>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MatchPlanError {
    EmptyQuery,
    InvalidRegex,
    KeepNeedsMatches,
    OutsideTimeline,
}

impl Display for MatchPlanError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::EmptyQuery => "--query cannot be empty",
            Self::InvalidRegex => "--query is not a valid regular expression",
            Self::KeepNeedsMatches => {
                "--action keep found no matches — refusing to cut the whole timeline"
            }
            Self::OutsideTimeline => "the project timeline is empty",
        })
    }
}

impl Error for MatchPlanError {}

/// 汉字 / 假名与全角标点：词间不留空格的文字。谚文不在其中——韩文按空格
/// 分词（与 `bcut-flow-core` 的 `sep_len` 同一条规则；0.5 之前逐音节的韩文
/// 文稿靠词上的 `glue` 标记拼回去）。
fn is_unspaced_cjk_adjacent(ch: char) -> bool {
    matches!(ch as u32,
        0x4E00..=0x9FFF | 0x3040..=0x30FF |
        0x3000..=0x303F | 0xFF00..=0xFFEF | 0x2014 | 0x2018..=0x201D | 0x2026)
}

fn is_han_or_kana(ch: char) -> bool {
    matches!(ch as u32, 0x4E00..=0x9FFF | 0x3040..=0x30FF)
}

fn is_hangul_syllable(ch: char) -> bool {
    matches!(ch as u32, 0xAC00..=0xD7AF)
}

fn unspaced_pair(left: char, right: char) -> bool {
    (is_unspaced_cjk_adjacent(left) && is_unspaced_cjk_adjacent(right))
        || (is_hangul_syllable(left) && is_han_or_kana(right))
        || (is_han_or_kana(left) && is_hangul_syllable(right))
}

fn separator_length(previous: &str, next: &str) -> usize {
    if previous.ends_with(' ') || next.starts_with(' ') {
        return 0;
    }
    match (previous.chars().last(), next.chars().next()) {
        (Some(left), Some(right)) if unspaced_pair(left, right) => 0,
        _ => 1,
    }
}

fn joined_text(words: &[MatchWord]) -> (String, Vec<(usize, usize)>) {
    let mut text = String::new();
    let mut ranges = Vec::with_capacity(words.len());
    for word in words {
        if !text.is_empty() && !word.glue && separator_length(&text, &word.text) == 1 {
            text.push(' ');
        }
        let start = text.len();
        text.push_str(&word.text);
        ranges.push((start, text.len()));
    }
    (text, ranges)
}

fn is_word_char(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_'
}

fn has_whole_word_boundaries(text: &str, start: usize, end: usize) -> bool {
    let left = text[..start].chars().next_back();
    let right = text[end..].chars().next();
    left.is_none_or(|ch| !is_word_char(ch)) && right.is_none_or(|ch| !is_word_char(ch))
}

fn excerpt(words: &[MatchWord]) -> String {
    let (joined, _) = joined_text(words);
    if joined.chars().count() <= 60 {
        return joined;
    }
    joined.chars().take(57).collect::<String>() + "…"
}

fn merge_ranges(hits: &[MatchHit]) -> Vec<MatchCutSpan> {
    let mut ranges = hits
        .iter()
        .filter(|hit| hit.end > hit.start)
        .map(|hit| MatchCutSpan {
            t0: hit.start,
            t1: hit.end,
        })
        .collect::<Vec<_>>();
    ranges.sort_by(|left, right| left.t0.total_cmp(&right.t0));
    let mut merged = Vec::<MatchCutSpan>::with_capacity(ranges.len());
    for range in ranges {
        if let Some(previous) = merged.last_mut()
            && range.t0 - previous.t1 <= CUT_MERGE_GAP
        {
            previous.t1 = previous.t1.max(range.t1);
        } else {
            merged.push(range);
        }
    }
    merged
}

pub fn plan_text_match(
    paragraphs: &[MatchParagraph],
    cuts: &CutSet,
    options: &MatchOptions,
) -> Result<MatchPlan, MatchPlanError> {
    if options.query.trim().is_empty() {
        return Err(MatchPlanError::EmptyQuery);
    }
    if !options.content_end.is_finite() || options.content_end <= 0.0 {
        return Err(MatchPlanError::OutsideTimeline);
    }
    let pattern = if options.regex {
        options.query.clone()
    } else {
        regex::escape(&options.query)
    };
    let matcher = RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        .build()
        .map_err(|_| MatchPlanError::InvalidRegex)?;

    let mut hits = Vec::new();
    for paragraph in paragraphs {
        if paragraph.words.is_empty() {
            continue;
        }
        let (text, word_ranges) = joined_text(&paragraph.words);
        let mut paragraph_matched = false;
        for matched in matcher.find_iter(&text) {
            if matched.start() == matched.end()
                || (options.whole_word
                    && !has_whole_word_boundaries(&text, matched.start(), matched.end()))
            {
                continue;
            }
            if options.scope == MatchScope::Paragraph {
                paragraph_matched = true;
                break;
            }
            let first = word_ranges
                .iter()
                .position(|(_, end)| *end > matched.start());
            let last = word_ranges
                .iter()
                .rposition(|(start, _)| *start < matched.end());
            let (Some(first), Some(last)) = (first, last) else {
                continue;
            };
            if first > last {
                continue;
            }
            let words = &paragraph.words[first..=last];
            hits.push(MatchHit {
                start: words[0].t0,
                end: words[words.len() - 1].t1,
                word_ids: words.iter().map(|word| word.id.clone()).collect(),
                excerpt: excerpt(words),
            });
        }
        if paragraph_matched {
            let words = &paragraph.words;
            hits.push(MatchHit {
                start: words[0].t0,
                end: words[words.len() - 1].t1,
                word_ids: words.iter().map(|word| word.id.clone()).collect(),
                excerpt: excerpt(words),
            });
        }
    }

    if options.action == MatchAction::Cut && !cuts.cuts().is_empty() {
        hits.retain(|hit| !cuts.contains_cut_range(hit.start, hit.end, 0.01));
    }
    let merged = merge_ranges(&hits);
    let cut_spans = match options.action {
        MatchAction::Cut => merged,
        MatchAction::Keep => {
            if hits.is_empty() {
                return Err(MatchPlanError::KeepNeedsMatches);
            }
            let mut complement = Vec::new();
            let mut cursor: f64 = 0.0;
            for range in merged {
                let t0 = range.t0.clamp(0.0, options.content_end);
                let t1 = range.t1.clamp(0.0, options.content_end);
                if t0 - cursor >= MINIMUM_CUT_SEC {
                    complement.push(MatchCutSpan { t0: cursor, t1: t0 });
                }
                cursor = cursor.max(t1);
            }
            if options.content_end - cursor >= MINIMUM_CUT_SEC {
                complement.push(MatchCutSpan {
                    t0: cursor,
                    t1: options.content_end,
                });
            }
            complement
        }
    };
    let reason = options
        .reason
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| match options.action {
            MatchAction::Cut => format!("Match: {}", options.query),
            MatchAction::Keep => format!("Keep only: {}", options.query),
        });
    Ok(MatchPlan {
        action: options.action,
        scope: options.scope,
        query: options.query.clone(),
        reason,
        hits,
        cut_spans,
    })
}

const MINIMUM_CUT_SEC: f64 = 0.05;

#[cfg(test)]
mod tests {
    use crate::Cut;

    use super::*;

    fn sponsor_paragraph() -> Vec<MatchParagraph> {
        vec![MatchParagraph {
            words: ["thanks", "our", "sponsor", "Acme", "today"]
                .into_iter()
                .enumerate()
                .map(|(index, text)| MatchWord {
                    id: format!("w{}", index + 1),
                    t0: index as f64,
                    t1: index as f64 + 1.0,
                    text: text.to_owned(),
                    glue: false,
                })
                .collect(),
        }]
    }

    fn options(query: &str) -> MatchOptions {
        MatchOptions {
            query: query.to_owned(),
            regex: false,
            whole_word: false,
            case_sensitive: false,
            scope: MatchScope::Match,
            action: MatchAction::Cut,
            content_end: 10.0,
            reason: None,
        }
    }

    fn empty_cuts() -> CutSet {
        CutSet::empty(10.0).unwrap()
    }

    fn korean_paragraph(texts: &[(&str, bool)]) -> Vec<MatchParagraph> {
        vec![MatchParagraph {
            words: texts
                .iter()
                .enumerate()
                .map(|(index, (text, glue))| MatchWord {
                    id: format!("w{}", index + 1),
                    t0: index as f64,
                    t1: index as f64 + 1.0,
                    text: (*text).to_owned(),
                    glue: *glue,
                })
                .collect(),
        }]
    }

    /// 韩文按空格分词：带空格的查询能对上按어절存的词；0.5 之前逐音节的文稿
    /// 靠 `glue` 拼回原样（查询要照它的写法，不带空格）。
    #[test]
    fn korean_queries_match_words_joined_at_spaces() {
        let spaced = korean_paragraph(&[
            ("저는", false),
            ("내일", false),
            ("아이폰을", false),
            ("샀다.", false),
        ]);
        let hit = plan_text_match(&spaced, &empty_cuts(), &options("내일 아이폰을")).unwrap();
        assert_eq!(hit.hits[0].word_ids, ["w2", "w3"]);
        assert_eq!(hit.hits[0].excerpt, "내일 아이폰을");

        let legacy = korean_paragraph(&[("저", false), ("는", true), ("내", true), ("일", true)]);
        let hit = plan_text_match(&legacy, &empty_cuts(), &options("는내일")).unwrap();
        assert_eq!(hit.hits[0].word_ids, ["w2", "w3", "w4"]);
        // 汉字 / 假名照旧不加空格。
        let han = korean_paragraph(&[("大", false), ("家", false), ("好", false)]);
        let hit = plan_text_match(&han, &empty_cuts(), &options("大家好")).unwrap();
        assert_eq!(hit.hits[0].word_ids, ["w1", "w2", "w3"]);
    }

    // Migrated from VoiceInk CLICutMatchPlanTests against BaoCut's source-cut model.
    #[test]
    fn substring_multiword_case_and_whole_word_selection_match_voiceink() {
        let paragraphs = sponsor_paragraph();
        let substring = plan_text_match(&paragraphs, &empty_cuts(), &options("pons")).unwrap();
        assert_eq!(substring.hits[0].word_ids, ["w3"]);
        assert_eq!(substring.cut_spans, [MatchCutSpan { t0: 2.0, t1: 3.0 }]);

        let multi = plan_text_match(&paragraphs, &empty_cuts(), &options("sponsor acme")).unwrap();
        assert_eq!(multi.hits[0].word_ids, ["w3", "w4"]);
        assert_eq!(multi.hits[0].excerpt, "sponsor Acme");
        assert_eq!(
            plan_text_match(&paragraphs, &empty_cuts(), &options("SPONSOR"))
                .unwrap()
                .hits
                .len(),
            1
        );
        let mut sensitive = options("SPONSOR");
        sensitive.case_sensitive = true;
        assert!(
            plan_text_match(&paragraphs, &empty_cuts(), &sensitive)
                .unwrap()
                .hits
                .is_empty()
        );
        let mut whole = options("spon");
        whole.whole_word = true;
        assert!(
            plan_text_match(&paragraphs, &empty_cuts(), &whole)
                .unwrap()
                .hits
                .is_empty()
        );
    }

    #[test]
    fn regex_cjk_and_paragraph_scope_match_voiceink() {
        let paragraphs = sponsor_paragraph();
        let mut regex = options("sponsor|acme");
        regex.regex = true;
        let plan = plan_text_match(&paragraphs, &empty_cuts(), &regex).unwrap();
        assert_eq!(plan.hits.len(), 2);
        assert_eq!(plan.cut_spans, [MatchCutSpan { t0: 2.0, t1: 4.0 }]);

        let cjk = vec![MatchParagraph {
            words: ["我们", "的", "赞助", "商", "很好"]
                .into_iter()
                .enumerate()
                .map(|(index, text)| MatchWord {
                    id: format!("w{}", index + 1),
                    t0: index as f64,
                    t1: index as f64 + 1.0,
                    text: text.to_owned(),
                    glue: false,
                })
                .collect(),
        }];
        let plan = plan_text_match(&cjk, &empty_cuts(), &options("赞助商")).unwrap();
        assert_eq!(plan.hits[0].word_ids, ["w3", "w4"]);

        let mut paragraph = options("sponsor");
        paragraph.scope = MatchScope::Paragraph;
        let plan = plan_text_match(&paragraphs, &empty_cuts(), &paragraph).unwrap();
        assert_eq!(plan.hits[0].word_ids, ["w1", "w2", "w3", "w4", "w5"]);
        assert_eq!((plan.hits[0].start, plan.hits[0].end), (0.0, 5.0));
    }

    #[test]
    fn keep_complement_skip_provenance_inputs_and_errors_match_voiceink() {
        let paragraphs = sponsor_paragraph();
        let mut keep = options("sponsor");
        keep.action = MatchAction::Keep;
        let plan = plan_text_match(&paragraphs, &empty_cuts(), &keep).unwrap();
        assert_eq!(
            plan.cut_spans,
            [
                MatchCutSpan { t0: 0.0, t1: 2.0 },
                MatchCutSpan { t0: 3.0, t1: 10.0 }
            ]
        );
        keep.query = "nothing-here".to_owned();
        assert_eq!(
            plan_text_match(&paragraphs, &empty_cuts(), &keep),
            Err(MatchPlanError::KeepNeedsMatches)
        );

        let cuts = CutSet::new(
            10.0,
            vec![Cut {
                id: "cut-1".to_owned(),
                t0: 2.0,
                t1: 3.0,
                r#ref: None,
            }],
        )
        .unwrap();
        assert!(
            plan_text_match(&paragraphs, &cuts, &options("sponsor"))
                .unwrap()
                .hits
                .is_empty()
        );
        let mut noted = options("sponsor");
        noted.reason = Some("sponsor removal".to_owned());
        assert_eq!(
            plan_text_match(&paragraphs, &empty_cuts(), &noted)
                .unwrap()
                .reason,
            "sponsor removal"
        );

        assert_eq!(
            plan_text_match(&paragraphs, &empty_cuts(), &options("  ")),
            Err(MatchPlanError::EmptyQuery)
        );
        let mut invalid = options("([bad");
        invalid.regex = true;
        assert_eq!(
            plan_text_match(&paragraphs, &empty_cuts(), &invalid),
            Err(MatchPlanError::InvalidRegex)
        );
        let mut empty = options("x");
        empty.content_end = 0.0;
        assert_eq!(
            plan_text_match(&paragraphs, &empty_cuts(), &empty),
            Err(MatchPlanError::OutsideTimeline)
        );
    }
}
