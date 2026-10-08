//! 字幕句子的词（视频格式规范 §3.8、§5.7）：字幕文档的句子用 `words`（`{first, last}` 或 `{wordIds}`）指向转写文档
//! （字幕文档头的 `sourceDocumentId`）里的词。交给内核的是有效词流里的这些词，逐词动画、逐词高亮与设计字幕的强调
//! （按词 ID）都按它们推进：
//!
//! - 隐藏的词不给；剪掉的词（投不到时间线上任何一处的）也不给。句子里有词因此被拿掉时，句子的文字按留下的词重新拼
//!   （`speech_doc::atomize::join_word_texts`，认词上的「贴前」标记），一个也不剩的句子不画。
//! - 词按文档时钟给时刻：字幕在源素材时钟上时是词自己的源时刻；在序列时钟上时是词投到序列上、与这一句重叠的那一处。
//! - 多字的 CJK 词按转写落盘的同一条规则逐字拆开（`speech_doc::build::atomize_timed_word`，子 ID `<词>~<k>`）。
//! - 句子没有写 `words`（较早生成的字幕）时，取时刻落在这一句里的词给时刻，句子的文字不动。
//! - 翻译字幕、没有 `sourceDocumentId` 或指向的不是转写的字幕不给词，内核按空白切分推算。

use std::collections::{HashMap, HashSet};

use render_graph::VideoView;
use render_graph::text_plan::plan_text;
use serde_json::{Value, json};
use video_model::{DocumentRecord, Id, TimelineItem};

use crate::documents::FrozenDocument;

pub const SPEECH_DOCUMENT: &str = "baocut.speech/1";

/// 转写文档里的一个词（秒，转写的时钟）。
#[derive(Clone, Debug, PartialEq)]
pub struct SpeechWord {
    pub id: String,
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub glue: bool,
    pub hidden: bool,
}

/// 读好的转写：词按文档里的次序，可以按 ID 找。
#[derive(Clone, Debug, Default)]
pub struct SpeechWords {
    pub words: Vec<SpeechWord>,
    index: HashMap<String, usize>,
    pub sequence_clock: bool,
}

impl SpeechWords {
    /// 不是 `baocut.speech/1` 时为 `None`。时间是整数刻度，`timescale` 缺省 1 000 000。
    pub fn read(body: &Value) -> Option<SpeechWords> {
        if body.get("schema").and_then(Value::as_str) != Some(SPEECH_DOCUMENT) {
            return None;
        }
        let timescale = match body.get("timescale").and_then(Value::as_f64) {
            Some(t) if t > 0.0 && t.is_finite() => t,
            _ => 1_000_000.0,
        };
        let mut words = Vec::new();
        let mut index = HashMap::new();
        for word in body.get("words")?.as_array()? {
            let (Some(id), Some(start), Some(end)) = (
                word.get("id").and_then(Value::as_str),
                word.get("start").and_then(Value::as_f64).filter(|v| v.is_finite()),
                word.get("end").and_then(Value::as_f64).filter(|v| v.is_finite()),
            ) else {
                continue;
            };
            index.entry(id.to_string()).or_insert(words.len());
            words.push(SpeechWord {
                id: id.to_string(),
                text: word.get("text").and_then(Value::as_str).unwrap_or_default().to_string(),
                start: start / timescale,
                end: (end / timescale).max(start / timescale),
                glue: word.get("glue").and_then(Value::as_bool).unwrap_or(false),
                hidden: word.get("hidden").and_then(Value::as_bool).unwrap_or(false),
            });
        }
        Some(SpeechWords {
            words,
            index,
            sequence_clock: body.get("clock").and_then(Value::as_str) == Some("sequence"),
        })
    }

    /// 句子的 `words` 指向的词（文档里的下标，按文档次序）。没写或一个也找不到时为 `None`。
    pub fn refs(&self, words: &Value) -> Option<Vec<usize>> {
        let found: Vec<usize> = if let Some(ids) = words.get("wordIds").and_then(Value::as_array) {
            ids.iter()
                .filter_map(|id| id.as_str().and_then(|id| self.index.get(id)).copied())
                .collect()
        } else {
            let at = |key: &str| words.get(key).and_then(Value::as_str).and_then(|id| self.index.get(id)).copied();
            match (at("first"), at("last")) {
                (Some(a), Some(b)) if a <= b => (a..=b).collect(),
                _ => Vec::new(),
            }
        };
        (!found.is_empty()).then_some(found)
    }
}

/// 词在剪辑之后的去留与时刻。
#[derive(Clone, Debug, PartialEq)]
pub enum Placement {
    /// 投不上序列（例如转写的素材不在时间线上）：词都留下，按转写自己的时刻。
    Unplaced,
    /// 有效词流里出现的词 ID（剪掉的、隐藏的不在里面）。
    Kept(HashSet<String>),
    /// 词投到序列上的各个区间（秒，从序列起点算）。
    OnSequence(HashMap<String, Vec<(f64, f64)>>),
}

/// 把 `speech` 投到序列上：作用实例是显示 `caption_document_id` 的字幕实例的 `scopeItemIds`（都没写时是转写描述的素材
/// 在时间线上的各个实例，与有效词流同一个求法，`render_graph::text_plan::plan_text`）。`on_sequence` 时给出词在序列上的
/// 区间，否则只给去留。
pub fn place(
    video: VideoView,
    sequence_id: &str,
    caption_document_id: &str,
    speech: &FrozenDocument,
    fallback_asset: Option<&str>,
    on_sequence: bool,
) -> Placement {
    let Some(sequence) = video.sequences.get(sequence_id) else {
        return Placement::Unplaced;
    };
    let mut scope: Vec<Id> = Vec::new();
    for item in &sequence.items {
        if let TimelineItem::Caption(caption) = item
            && caption.base.enabled
            && caption.document_id == caption_document_id
        {
            for id in &caption.scope_item_ids {
                if !scope.contains(id) {
                    scope.push(id.clone());
                }
            }
        }
    }
    let record = DocumentRecord {
        id: speech.document_id.clone(),
        kind: "speech".into(),
        name: String::new(),
        language: None,
        source_asset_id: speech.source_asset_id.clone().or_else(|| fallback_asset.map(str::to_string)),
        source_document_id: None,
        current_revision: String::new(),
        revisions: Default::default(),
        extensions: Default::default(),
    };
    let Ok(plan) = plan_text(video, sequence_id, &record, &speech.body, &scope, None) else {
        return Placement::Unplaced;
    };
    if on_sequence {
        let mut spans: HashMap<String, Vec<(f64, f64)>> = HashMap::new();
        for entry in plan.entries {
            spans.entry(entry.id).or_default().push((entry.start, entry.end));
        }
        Placement::OnSequence(spans)
    } else {
        Placement::Kept(plan.entries.into_iter().map(|entry| entry.id).collect())
    }
}

/// 交给内核的一句的词与（拿掉了词时）重新拼好的文字。
#[derive(Clone, Debug, PartialEq)]
pub struct CueWords {
    /// `{id, text, t0, t1}`，按文档次序。
    pub words: Vec<Value>,
    pub text: Option<String>,
}

/// 留在这一句里的词与它（在字幕时钟上）的起止。
type Member<'a> = (&'a SpeechWord, (f64, f64));

/// 没写 `words` 的句子按时刻取词用的索引：词在字幕时钟上可能的中点（投到序列上时是每一处的中点）排好序，一句只看
/// 中点落在它里面的那些词，不必每句把整份转写扫一遍（几千句、几万词时是上亿次查表）。一份转写、一种去留建一次。
pub struct WordTimes {
    middles: Vec<(f64, usize)>,
}

impl WordTimes {
    pub fn new(speech: &SpeechWords, placement: &Placement) -> WordTimes {
        let mut middles = Vec::with_capacity(speech.words.len());
        for (index, word) in speech.words.iter().enumerate() {
            match placement {
                Placement::OnSequence(spans) => {
                    for &(a, b) in spans.get(&word.id).map(Vec::as_slice).unwrap_or_default() {
                        middles.push(((a + b) / 2.0, index));
                    }
                }
                _ => middles.push(((word.start + word.end) / 2.0, index)),
            }
        }
        // NaN 落不进任何一句（比较总是假），不进索引。
        middles.retain(|(middle, _)| !middle.is_nan());
        middles.sort_by(|x, y| x.0.total_cmp(&y.0));
        WordTimes { middles }
    }

    /// 有一处中点落在 `[span.0, span.1)` 里的词（下标，按文档次序）：取词的候选，去留与时刻仍按 [`cue_words`] 的规则逐个判。
    fn within(&self, span: (f64, f64)) -> Vec<usize> {
        let from = self.middles.partition_point(|&(middle, _)| middle < span.0);
        let to = self.middles.partition_point(|&(middle, _)| middle < span.1).max(from);
        let mut found: Vec<usize> = self.middles[from..to].iter().map(|&(_, index)| index).collect();
        found.sort_unstable();
        found.dedup();
        found
    }
}

/// 一句（文档时钟上的 `start`–`end`，`refs` 是它的 `words` 指向的词）交给内核的词。`sequence_clock` 是字幕文档的时钟。
/// 给不出词时为 `None`（内核按空白切分推算）。
pub fn cue_words(
    speech: &SpeechWords,
    refs: Option<&[usize]>,
    span: (f64, f64),
    sequence_clock: bool,
    placement: &Placement,
) -> Option<CueWords> {
    cue_words_indexed(speech, refs, span, sequence_clock, placement, None)
}

/// 同 [`cue_words`]；没写 `words` 的句子给了 `times`（同一份转写、同一种去留建的）时只在候选词里取。
pub fn cue_words_indexed(
    speech: &SpeechWords,
    refs: Option<&[usize]>,
    span: (f64, f64),
    sequence_clock: bool,
    placement: &Placement,
    times: Option<&WordTimes>,
) -> Option<CueWords> {
    // 词的时刻换不到字幕的时钟上（序列时钟的字幕、转写投不上序列）时不给词。
    let usable = match placement {
        Placement::OnSequence(_) => sequence_clock && !speech.sequence_clock,
        _ => sequence_clock == speech.sequence_clock,
    };
    if !usable {
        return None;
    }
    // 词在字幕时钟上的时刻；不留的词为 `None`。
    let timed = |word: &SpeechWord| -> Option<(f64, f64)> {
        if word.hidden {
            return None;
        }
        match placement {
            Placement::OnSequence(spans) => {
                // 同一段源用了两次时取与这一句重叠最多的那一处。
                let spans = spans.get(&word.id)?;
                spans
                    .iter()
                    .map(|&(a, b)| (a, b, b.min(span.1) - a.max(span.0)))
                    .filter(|&(_, _, overlap)| overlap > 0.0)
                    .max_by(|x, y| x.2.total_cmp(&y.2))
                    .map(|(a, b, _)| (a, b))
            }
            Placement::Kept(kept) => {
                // 零长的词不进有效词流，它跟着这一句留下。
                (word.end <= word.start || kept.contains(&word.id)).then_some((word.start, word.end))
            }
            Placement::Unplaced => Some((word.start, word.end)),
        }
    };
    let (members, rebuild): (Vec<Member>, bool) = match refs {
        Some(refs) => {
            let kept: Vec<_> = refs
                .iter()
                .filter_map(|&i| speech.words.get(i))
                .filter_map(|word| timed(word).map(|t| (word, t)))
                .collect();
            let rebuild = kept.len() < refs.len();
            (kept, rebuild)
        }
        None => {
            let candidates: Box<dyn Iterator<Item = &SpeechWord>> = match times {
                Some(times) => Box::new(times.within(span).into_iter().filter_map(|i| speech.words.get(i))),
                None => Box::new(speech.words.iter()),
            };
            let kept: Vec<_> = candidates
                .filter_map(|word| timed(word).map(|t| (word, t)))
                .filter(|(_, (a, b))| {
                    let middle = (a + b) / 2.0;
                    middle >= span.0 && middle < span.1
                })
                .collect();
            if kept.is_empty() {
                return None;
            }
            (kept, false)
        }
    };
    let text = rebuild.then(|| speech_doc::atomize::join_word_texts(members.iter().map(|(word, _)| (word.text.as_str(), word.glue))));
    let mut words = Vec::new();
    for (word, (start, end)) in &members {
        for (id, text, t0, t1, _) in speech_doc::build::atomize_timed_word(&word.id, &word.text, *start, *end, word.glue) {
            words.push(json!({ "id": id, "text": text, "t0": t0, "t1": t1 }));
        }
    }
    Some(CueWords { words, text })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn speech(words: &[(&str, &str, f64, f64)], hidden: &[&str]) -> SpeechWords {
        SpeechWords::read(&json!({
            "schema": SPEECH_DOCUMENT, "clock": "source-asset", "timescale": 1000,
            "words": words.iter().map(|(id, text, s, e)| {
                let mut word = json!({ "id": id, "text": text, "start": (s * 1000.0) as i64, "end": (e * 1000.0) as i64 });
                if hidden.contains(id) {
                    word["hidden"] = json!(true);
                }
                word
            }).collect::<Vec<_>>(),
        }))
        .unwrap()
    }

    fn ids(words: &CueWords) -> Vec<&str> {
        words.words.iter().map(|w| w["id"].as_str().unwrap()).collect()
    }

    #[test]
    fn refs_take_ranges_or_lists() {
        let s = speech(&[("a", "x", 0.0, 1.0), ("b", "y", 1.0, 2.0), ("c", "z", 2.0, 3.0)], &[]);
        assert_eq!(s.refs(&json!({ "first": "a", "last": "c" })), Some(vec![0, 1, 2]));
        assert_eq!(s.refs(&json!({ "wordIds": ["c", "nope", "a"] })), Some(vec![2, 0]));
        assert_eq!(s.refs(&json!({ "first": "c", "last": "a" })), None);
        assert_eq!(s.refs(&Value::Null), None);
    }

    #[test]
    fn hidden_and_cut_words_drop_out_and_the_text_is_rebuilt() {
        let s = speech(
            &[
                ("w1", "真", 0.0, 0.2),
                ("w2", "的", 0.2, 0.4),
                ("w3", "别", 0.4, 0.6),
                ("w4", "再", 0.6, 0.8),
                ("w5", "Codex", 0.8, 1.2),
            ],
            &["w2"],
        );
        let refs = [0, 1, 2, 3, 4];
        let all = cue_words(&s, Some(&refs), (0.0, 1.2), false, &Placement::Unplaced).unwrap();
        assert_eq!(ids(&all), ["w1", "w3", "w4", "w5"]);
        assert_eq!(all.text.as_deref(), Some("真别再 Codex"));
        // 剪掉 w3：有效词流里没有它。
        let kept = Placement::Kept(["w1", "w4", "w5"].into_iter().map(String::from).collect());
        let cut = cue_words(&s, Some(&refs), (0.0, 1.2), false, &kept).unwrap();
        assert_eq!(ids(&cut), ["w1", "w4", "w5"]);
        assert_eq!(cut.text.as_deref(), Some("真再 Codex"));
        assert_eq!(cut.words[1]["t0"], json!(0.6));
        // 什么都没拿掉时文字不动。
        let s = speech(&[("a", "Hi", 0.0, 0.5), ("b", "there", 0.5, 1.0)], &[]);
        let same = cue_words(&s, Some(&[0, 1]), (0.0, 1.0), false, &Placement::Unplaced).unwrap();
        assert_eq!(same.text, None);
    }

    #[test]
    fn multi_character_cjk_words_split_per_character() {
        let s = speech(&[("g1", "大家好", 1.0, 1.6)], &[]);
        let words = cue_words(&s, Some(&[0]), (1.0, 1.6), false, &Placement::Unplaced).unwrap();
        assert_eq!(ids(&words), ["g1", "g1~1", "g1~2"]);
        assert_eq!(words.words[0]["t0"], json!(1.0));
        assert_eq!(words.words[2]["t1"], json!(1.6));
    }

    #[test]
    fn sequence_clock_captions_take_the_overlapping_occurrence() {
        let s = speech(&[("a", "one", 0.0, 1.0), ("b", "two", 1.0, 2.0)], &[]);
        let spans = Placement::OnSequence(HashMap::from([
            ("a".to_string(), vec![(5.0, 6.0), (10.0, 11.0)]),
            ("b".to_string(), vec![(11.0, 12.0)]),
        ]));
        let words = cue_words(&s, Some(&[0, 1]), (10.0, 12.0), true, &spans).unwrap();
        assert_eq!(words.words[0]["t0"], json!(10.0));
        assert_eq!(words.words[1]["t1"], json!(12.0));
        // 投不上序列时序列时钟的字幕不给词。
        assert_eq!(cue_words(&s, Some(&[0, 1]), (10.0, 12.0), true, &Placement::Unplaced), None);
        // 一个词也投不到这一句上：整句不画。
        let gone = cue_words(&s, Some(&[0, 1]), (20.0, 22.0), true, &spans).unwrap();
        assert!(gone.words.is_empty());
        assert_eq!(gone.text.as_deref(), Some(""));
    }

    #[test]
    fn cues_without_refs_take_the_words_inside_them() {
        let s = speech(&[("a", "one", 0.0, 1.0), ("b", "two", 1.0, 2.0), ("c", "three", 2.0, 3.0)], &[]);
        let words = cue_words(&s, None, (0.9, 2.1), false, &Placement::Unplaced).unwrap();
        assert_eq!(ids(&words), ["b"]);
        assert_eq!(words.text, None);
        assert_eq!(cue_words(&s, None, (5.0, 6.0), false, &Placement::Unplaced), None);
    }

    #[test]
    fn indexed_lookup_matches_the_full_scan() {
        let s = speech(
            &[
                ("a", "one", 0.0, 1.0),
                ("b", "two", 1.0, 2.0),
                ("c", "three", 2.0, 3.0),
                ("d", "four", 3.0, 3.0),
                ("e", "five", 3.0, 4.0),
            ],
            &["c"],
        );
        let placements = [
            (false, Placement::Unplaced),
            (
                false,
                Placement::Kept(HashSet::from(["a".to_string(), "b".to_string(), "e".to_string()])),
            ),
            (
                true,
                Placement::OnSequence(HashMap::from([
                    ("a".to_string(), vec![(10.0, 11.0), (0.0, 1.0)]),
                    ("b".to_string(), vec![(1.0, 2.0)]),
                    ("e".to_string(), vec![(2.0, 3.0), (5.0, 6.0)]),
                ])),
            ),
        ];
        for (clock, placement) in &placements {
            let times = WordTimes::new(&s, placement);
            for span in [
                (0.0, 1.0),
                (0.4, 2.6),
                (0.9, 2.1),
                (1.5, 3.5),
                (3.0, 3.0),
                (2.5, 6.0),
                (9.0, 12.0),
                (-1.0, 0.0),
            ] {
                assert_eq!(
                    cue_words_indexed(&s, None, span, *clock, placement, Some(&times)),
                    cue_words(&s, None, span, *clock, placement),
                    "{placement:?} {span:?}"
                );
            }
        }
    }
}
