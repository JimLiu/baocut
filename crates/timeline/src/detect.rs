use serde::{Deserialize, Serialize};

use crate::CutSet;

pub const MIN_AUDIBLE_FILLER_SEC: f64 = 0.05;

#[derive(Debug, Clone, PartialEq)]
pub struct DetectWord {
    pub id: String,
    pub t0: f64,
    pub t1: f64,
    pub text: String,
    pub speaker: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChapterWindow {
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CutProposal {
    pub id: String,
    pub kind: String,
    pub t0: f64,
    pub t1: f64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub word_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_word: Option<String>,
    pub reason: String,
    pub detail: String,
}

impl CutProposal {
    pub fn removed_sec(&self) -> f64 {
        (self.t1 - self.t0).max(0.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SilenceOptions {
    pub threshold: f64,
    pub compress_to: f64,
    pub sentence_compress_to: f64,
    pub max_gap: f64,
    pub trim_chapter_starts: bool,
}

impl Default for SilenceOptions {
    fn default() -> Self {
        Self {
            threshold: 0.8,
            compress_to: 0.3,
            sentence_compress_to: 0.4,
            max_gap: 3.0,
            trim_chapter_starts: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct FillerOptions {
    pub langs: Vec<String>,
    pub custom: Vec<String>,
    pub include_soft: bool,
}

impl Default for FillerOptions {
    fn default() -> Self {
        Self {
            langs: vec!["en".to_owned(), "zh".to_owned()],
            custom: Vec::new(),
            include_soft: true,
        }
    }
}

const EN_HARD: &[&[&str]] = &[
    &["um"],
    &["umm"],
    &["uh"],
    &["uhh"],
    &["er"],
    &["erm"],
    &["hmm"],
    &["mhm"],
    &["ah"],
];
const EN_SOFT: &[&[&str]] = &[
    &["you", "know"],
    &["i", "mean"],
    &["kind", "of"],
    &["sort", "of"],
    &["like"],
    &["basically"],
    &["actually"],
    &["literally"],
    &["honestly"],
];
const ZH_HARD: &[&[&str]] = &[&["呃"], &["额"]];
const ZH_SOFT: &[&[&str]] = &[
    &["嗯"],
    &["啊"],
    &["呃呃"],
    &["那个"],
    &["这个"],
    &["就是"],
    &["然后", "呢"],
    &["对", "吧"],
    &["你", "知道", "吧"],
    &["反正"],
    &["其实"],
];

/// 按语言取口癖短语（硬口癖 + 软口癖，与 [`detect_fillers`] 同一张表），每条短语是
/// 若干已归一的词。`lang` 按主子标签比较（`en-US` → `en`）；没有这门语言的表时返回
/// `None`，调用方据此不产出口癖类（`bcut cut script` 把这类段落归 `extra`）。
pub fn filler_phrases(lang: &str) -> Option<Vec<Vec<String>>> {
    let primary = lang
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let (hard, soft) = match primary.as_str() {
        "en" => (EN_HARD, EN_SOFT),
        "zh" => (ZH_HARD, ZH_SOFT),
        _ => return None,
    };
    Some(
        hard.iter()
            .chain(soft)
            .map(|phrase| phrase.iter().map(|word| (*word).to_owned()).collect())
            .collect(),
    )
}

pub fn normalize_filler(text: &str) -> String {
    text.to_lowercase()
        .trim_matches(|ch: char| !ch.is_alphanumeric())
        .to_owned()
}

fn ends_separator(text: &str) -> bool {
    text.chars().last().is_some_and(|ch| {
        matches!(
            ch,
            ',' | '—'
                | '–'
                | ';'
                | ':'
                | '.'
                | '!'
                | '?'
                | '…'
                | '，'
                | '。'
                | '！'
                | '？'
                | '；'
                | '：'
        )
    })
}

fn ends_sentence(text: &str) -> bool {
    text.trim_end_matches(['"', '\'', '」', '』', '”'])
        .chars()
        .last()
        .is_some_and(|ch| matches!(ch, '.' | '!' | '?' | '。' | '！' | '？' | '…'))
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn chapter_of(time: f64, chapters: &[ChapterWindow]) -> Option<usize> {
    chapters
        .iter()
        .position(|chapter| time >= chapter.start && time < chapter.end)
}

pub fn detect_silences(
    words: &[DetectWord],
    chapters: &[ChapterWindow],
    options: SilenceOptions,
) -> Vec<CutProposal> {
    let mut output = Vec::new();
    for pair in words.windows(2) {
        let word = &pair[0];
        let next = &pair[1];
        let gap = round2(next.t0 - word.t1);
        if gap < options.threshold || gap > options.max_gap {
            continue;
        }
        let cross_speaker = next.speaker != word.speaker;
        let cross_chapter = chapter_of(word.t1, chapters) != chapter_of(next.t0, chapters);
        if cross_chapter && !options.trim_chapter_starts {
            continue;
        }
        let keep = if ends_sentence(&word.text) {
            options.sentence_compress_to
        } else {
            options.compress_to
        };
        let head = keep / 2.0;
        let tail = if cross_speaker {
            (keep / 2.0).max(0.15)
        } else {
            keep / 2.0
        };
        let t0 = round2(word.t1 + head);
        let t1 = round2(next.t0 - tail);
        if t1 - t0 < 0.15 {
            continue;
        }
        output.push(CutProposal {
            id: format!("cut-sl-{}", word.id),
            kind: "silence".to_owned(),
            t0,
            t1,
            word_ids: Vec::new(),
            after_word: Some(word.id.clone()),
            reason: if cross_speaker {
                "Pause between speakers".to_owned()
            } else {
                "Pause".to_owned()
            },
            detail: format!("{gap:.1}s → {keep:.1}s"),
        });
    }
    output
}

fn match_phrase<'a>(
    words: &[DetectWord],
    index: usize,
    phrases: &'a [&'a [&'a str]],
    must_isolate: bool,
) -> Option<&'a [&'a str]> {
    for phrase in phrases {
        if index + phrase.len() > words.len()
            || phrase
                .iter()
                .enumerate()
                .any(|(offset, token)| normalize_filler(&words[index + offset].text) != *token)
        {
            continue;
        }
        if must_isolate {
            let previous = index.checked_sub(1).and_then(|value| words.get(value));
            let last = &words[index + phrase.len() - 1];
            if previous.is_some_and(|word| !ends_separator(&word.text))
                && !ends_separator(&last.text)
            {
                continue;
            }
        }
        return Some(*phrase);
    }
    None
}

pub fn detect_fillers(words: &[DetectWord], options: &FillerOptions) -> Vec<CutProposal> {
    let custom = options
        .custom
        .iter()
        .map(|value| normalize_filler(value))
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let mut output = Vec::new();
    let mut index = 0;
    while index < words.len() {
        let mut phrase = None;
        for lang in &options.langs {
            let (hard, soft) = match lang.as_str() {
                "en" => (EN_HARD, EN_SOFT),
                "zh" => (ZH_HARD, ZH_SOFT),
                _ => continue,
            };
            phrase = match_phrase(words, index, hard, false).or_else(|| {
                options
                    .include_soft
                    .then(|| match_phrase(words, index, soft, true))
                    .flatten()
            });
            if phrase.is_some() {
                break;
            }
        }
        let custom_match = if phrase.is_none() {
            let word = &words[index];
            let normalized = normalize_filler(&word.text);
            let previous = index.checked_sub(1).and_then(|value| words.get(value));
            custom.contains(&normalized)
                && (previous.is_none_or(|value| ends_separator(&value.text))
                    || ends_separator(&word.text))
        } else {
            false
        };
        let length = phrase.map_or(usize::from(custom_match), <[_]>::len);
        if length == 0 {
            index += 1;
            continue;
        }
        let span = &words[index..index + length];
        output.push(CutProposal {
            id: format!("cut-fl-{}", span[0].id),
            kind: "filler".to_owned(),
            t0: span[0].t0,
            t1: span[span.len() - 1].t1,
            word_ids: span.iter().map(|word| word.id.clone()).collect(),
            after_word: None,
            reason: "Filler word".to_owned(),
            detail: format!(
                "“{}”",
                span.iter()
                    .map(|word| normalize_filler(&word.text))
                    .collect::<Vec<_>>()
                    .join(" ")
            ),
        });
        index += length;
    }
    output
}

pub fn merge_proposals(mut proposals: Vec<CutProposal>) -> Vec<CutProposal> {
    let mut bad_takes = proposals
        .iter()
        .filter(|proposal| proposal.kind == "badTake")
        .map(|proposal| (proposal.t0, proposal.t1))
        .collect::<Vec<_>>();
    bad_takes.sort_by(|left, right| left.0.total_cmp(&right.0));
    let mut maximum_ends = Vec::with_capacity(bad_takes.len());
    let mut maximum = f64::NEG_INFINITY;
    for (_, end) in &bad_takes {
        maximum = maximum.max(*end);
        maximum_ends.push(maximum);
    }
    proposals.retain(|proposal| {
        if proposal.kind != "filler" {
            return true;
        }
        let count = bad_takes.partition_point(|(start, _)| *start <= proposal.t0 + 0.01);
        count == 0 || maximum_ends[count - 1] + 0.01 < proposal.t1
    });
    proposals.sort_by(|left, right| left.t0.total_cmp(&right.t0));
    proposals
}

pub fn skip_already_cut(proposals: Vec<CutProposal>, cuts: &CutSet) -> Vec<CutProposal> {
    if cuts.cuts().is_empty() {
        return proposals;
    }
    proposals
        .into_iter()
        .filter(|proposal| !cuts.contains_cut_range(proposal.t0, proposal.t1, 0.01))
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::{Cut, CutSet};

    use super::*;

    fn words(values: &[(&str, f64, &str)]) -> Vec<DetectWord> {
        values
            .iter()
            .enumerate()
            .map(|(index, (text, t0, speaker))| DetectWord {
                id: format!("w{index}"),
                t0: *t0,
                t1: *t0 + 0.4,
                text: (*text).to_owned(),
                speaker: (*speaker).to_owned(),
            })
            .collect()
    }

    // Migrated from VoiceInk CutDetectTests; old clip partitions are expressed as CutSet.
    #[test]
    fn silence_compresses_gap_and_keeps_breathing_room() {
        let proposals = detect_silences(
            &words(&[("Hello", 0.0, "s1"), ("world", 2.4, "s1")]),
            &[],
            SilenceOptions::default(),
        );
        assert_eq!(proposals.len(), 1);
        assert_eq!((proposals[0].t0, proposals[0].t1), (0.55, 2.25));
        assert!(proposals[0].word_ids.is_empty());
    }

    #[test]
    fn silence_threshold_max_sentence_and_speaker_edges_match_voiceink() {
        assert!(
            detect_silences(
                &words(&[("a", 0.0, "s1"), ("b", 0.9, "s1"), ("c", 5.3, "s1")]),
                &[],
                SilenceOptions::default()
            )
            .is_empty()
        );
        let sentence = detect_silences(
            &words(&[("Done.", 0.0, "s1"), ("Next", 2.4, "s1")]),
            &[],
            SilenceOptions::default(),
        );
        assert_eq!((sentence[0].t0, sentence[0].t1), (0.6, 2.2));
        let speaker = detect_silences(
            &words(&[("Hey", 0.0, "s1"), ("yes", 2.4, "s2")]),
            &[],
            SilenceOptions {
                compress_to: 0.2,
                ..SilenceOptions::default()
            },
        );
        assert_eq!(speaker[0].t1, 2.25);
        assert_eq!(speaker[0].reason, "Pause between speakers");
    }

    #[test]
    fn filler_phrases_follow_the_primary_language_subtag() {
        let en = filler_phrases("en-US").unwrap();
        assert!(en.contains(&vec!["um".to_owned()]));
        assert!(en.contains(&vec!["you".to_owned(), "know".to_owned()]));
        assert!(
            filler_phrases("zh_Hans")
                .unwrap()
                .contains(&vec!["呃".to_owned()])
        );
        // 没有表的语言不给短语，调用方据此不产出口癖类。
        assert_eq!(filler_phrases("ja"), None);
        assert_eq!(filler_phrases(""), None);
    }

    #[test]
    fn hard_soft_custom_and_response_fillers_match_voiceink() {
        let input = words(&[
            ("um,", 0.0, "s1"),
            ("I", 1.0, "s1"),
            ("think", 2.0, "s1"),
            ("works", 3.0, "s1"),
            ("like", 4.0, "s1"),
            ("magic", 5.0, "s1"),
            ("feels,", 6.0, "s1"),
            ("like,", 7.0, "s1"),
            ("special", 8.0, "s1"),
            ("呃", 9.0, "s1"),
            ("好", 10.0, "s1"),
            ("额", 11.0, "s1"),
            ("嗯", 12.0, "s1"),
            ("啊", 13.0, "s1"),
        ]);
        let ids = detect_fillers(&input, &FillerOptions::default())
            .into_iter()
            .flat_map(|proposal| proposal.word_ids)
            .collect::<Vec<_>>();
        assert!(ids.contains(&"w0".to_owned()));
        assert!(!ids.contains(&"w4".to_owned()));
        assert!(ids.contains(&"w7".to_owned()));
        assert!(ids.contains(&"w9".to_owned()));
        assert!(ids.contains(&"w11".to_owned()));
        assert!(!ids.contains(&"w12".to_owned()));
        assert!(!ids.contains(&"w13".to_owned()));

        let custom = detect_fillers(
            &words(&[("okay,", 0.0, "s1"), ("so", 1.0, "s1"), ("that", 2.0, "s1")]),
            &FillerOptions {
                custom: vec!["okay".to_owned()],
                ..FillerOptions::default()
            },
        );
        assert_eq!(custom[0].word_ids, ["w0"]);
    }

    fn proposal(id: &str, kind: &str, t0: f64, t1: f64) -> CutProposal {
        CutProposal {
            id: id.to_owned(),
            kind: kind.to_owned(),
            t0,
            t1,
            word_ids: Vec::new(),
            after_word: None,
            reason: String::new(),
            detail: String::new(),
        }
    }

    #[test]
    fn bad_take_swallow_and_source_cut_skip_match_voiceink() {
        let merged = merge_proposals(vec![
            proposal("f", "filler", 2.0, 2.5),
            proposal("b", "badTake", 1.0, 4.0),
        ]);
        assert_eq!(
            merged
                .iter()
                .map(|value| value.id.as_str())
                .collect::<Vec<_>>(),
            ["b"]
        );
        let nested = merge_proposals(vec![
            proposal("f", "filler", 45.0, 90.0),
            proposal("nested", "badTake", 40.0, 50.0),
            proposal("outer", "badTake", 10.0, 100.0),
        ]);
        assert_eq!(
            nested
                .iter()
                .map(|value| value.id.as_str())
                .collect::<Vec<_>>(),
            ["outer", "nested"]
        );

        let cuts = CutSet::new(
            10.0,
            vec![Cut {
                id: "cut-1".to_owned(),
                t0: 0.0,
                t1: 5.0,
                r#ref: None,
            }],
        )
        .unwrap();
        let remaining = skip_already_cut(
            vec![
                proposal("a", "silence", 1.0, 2.0),
                proposal("b", "silence", 6.0, 7.0),
            ],
            &cuts,
        );
        assert_eq!(remaining[0].id, "b");
    }

    #[test]
    fn merge_and_skip_scale_across_large_sets() {
        let mut proposals = Vec::with_capacity(20_000);
        for index in 0..10_000 {
            let start = (index * 2) as f64;
            proposals.push(proposal(
                &format!("take-{index}"),
                "badTake",
                start,
                start + 1.0,
            ));
            proposals.push(proposal(
                &format!("filler-{index}"),
                "filler",
                start + 0.1,
                start + 0.9,
            ));
        }
        proposals.reverse();
        assert_eq!(merge_proposals(proposals).len(), 10_000);

        let cuts = (0..10_000)
            .step_by(2)
            .map(|index| Cut {
                id: format!("cut-{index}"),
                t0: index as f64,
                t1: index as f64 + 1.0,
                r#ref: None,
            })
            .collect();
        let set = CutSet::new(10_000.0, cuts).unwrap();
        let proposals = (0..25_000)
            .map(|index| {
                let clip = index % 10_000;
                proposal(
                    &format!("proposal-{index}"),
                    "silence",
                    clip as f64 + 0.1,
                    clip as f64 + 0.9,
                )
            })
            .collect();
        assert_eq!(skip_already_cut(proposals, &set).len(), 12_500);
    }
}
