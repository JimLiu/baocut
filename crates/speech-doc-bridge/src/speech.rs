//! 转写正文 ↔ `TranscriptDoc` 的词、说话人、章节、换行与分段、阶段指纹（视频格式规范 §5.2）。

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde_json::{Map, Value, json};
use speech_doc::doc::{AlignedStage as DocAlignedStage, BreakOverride, Chapter, DocEngine, DocMedia, Speaker, Stages, TranscriptDoc, Word};
use video_model::speech::{
    AlignedStage, BreakPin, SPEECH_SCHEMA, SpeechBody, SpeechChapter, SpeechSpeaker, SpeechStages, SpeechWord, TimingQuality,
};

use crate::time::{FRESH_TIMESCALE, check_timescale, media_time_seconds, seconds_to_ticks, ticks_to_seconds};
use crate::{BridgeError, MediaFacts, WriteReport};

/// 没有说话人的词在 `TranscriptDoc` 里归到这个保留的说话人：`TranscriptDoc` 要求每个词都有说话人。
const NO_SPEAKER: &str = "";
/// 转写文档头没有语言时 `TranscriptDoc.lang` 用的标签。
const UNDETERMINED: &str = "und";

fn timescale_of(body: &SpeechBody) -> Result<i64, BridgeError> {
    let timescale = body.timescale.unwrap_or(FRESH_TIMESCALE);
    check_timescale(timescale)?;
    Ok(timescale)
}

pub(crate) fn to_doc(media: &MediaFacts, language: Option<&str>, body: &SpeechBody) -> Result<TranscriptDoc, BridgeError> {
    if body.schema != SPEECH_SCHEMA {
        return Err(BridgeError::new(format!(
            "转写正文的 schema 是 {}，只认 {SPEECH_SCHEMA}",
            body.schema
        )));
    }
    let timescale = timescale_of(body)?;
    let doc_media = DocMedia {
        id: media.asset_id.clone(),
        path: media.path.clone(),
        hash: media.content_hash.clone(),
        duration: media_time_seconds(&media.duration)?,
        sample_rate: media.sample_rate,
    };
    let mut doc = TranscriptDoc::new(doc_media, language.unwrap_or(UNDETERMINED), engine_of(body));
    doc.created_at = body.created_at.clone().flatten();

    let mut speakers = BTreeMap::new();
    for speaker in body.speakers.iter().flatten() {
        if speaker.id == NO_SPEAKER {
            return Err(BridgeError::new("说话人的 ID 不能是空字符串"));
        }
        let value = Speaker {
            name: speaker.name.clone(),
            hue: speaker.hue.flatten(),
        };
        if speakers.insert(speaker.id.clone(), value).is_some() {
            return Err(BridgeError::new(format!("说话人 {} 重复", speaker.id)));
        }
    }
    for word in &body.words {
        let (Some(start), Some(end)) = (word.start, word.end) else {
            return Err(BridgeError::new(format!("词 {} 没有源时间", word.id)));
        };
        if word.speaker.as_deref() == Some(NO_SPEAKER) {
            return Err(BridgeError::new(format!("词 {} 的说话人是空字符串", word.id)));
        }
        doc.words.push(Word {
            id: word.id.clone(),
            t0: ticks_to_seconds(start, timescale)?,
            t1: ticks_to_seconds(end, timescale)?,
            text: word.text.clone(),
            sp: word.speaker.clone().unwrap_or_default(),
            glue: word.glue == Some(true),
        });
        if word.hidden == Some(true) {
            doc.hidden.insert(word.id.clone(), true);
        }
    }
    if doc.words.iter().any(|word| word.sp == NO_SPEAKER) {
        speakers.entry(NO_SPEAKER.to_owned()).or_insert(Speaker {
            name: String::new(),
            hue: None,
        });
    }
    doc.speakers = speakers;
    for chapter in body.chapters.iter().flatten() {
        doc.chapters.push(Chapter {
            id: chapter.id.clone(),
            title: chapter.title.clone(),
            start: ticks_to_seconds(chapter.start, timescale)?,
            end: ticks_to_seconds(chapter.end, timescale)?,
        });
    }
    doc.breaks = pins_to_doc(body.user_breaks.as_ref());
    doc.auto_breaks = body
        .auto_breaks
        .iter()
        .flatten()
        .map(|(profile, pins)| (profile.clone(), pins_to_doc(Some(pins))))
        .collect();
    doc.layout_profile = body.layout_profile_id.clone();
    doc.para_breaks = body.paragraph_breaks.iter().flatten().map(|id| (id.clone(), true)).collect();
    if let Some(stages) = &body.stages {
        doc.stages = Stages {
            asr: stages.asr.clone(),
            asr_layout: stages.asr_layout.clone(),
            polish: stages.polish.clone(),
            segment: stages.segment.clone(),
            chapters: stages.chapters.clone(),
            aligned: stages.aligned.as_ref().map(|aligned| DocAlignedStage {
                mode: aligned.mode.clone(),
                coverage: aligned.coverage,
                low_confidence: aligned.low_confidence.clone().unwrap_or_default(),
            }),
        };
    }
    Ok(doc)
}

/// 正文的 `engine` 是开放的对象。`TranscriptDoc` 只要名字、版本与「词时间是不是真实对齐的」：名字取 `name`，
/// 没有时取 `provider`；`alignedWords` 没写时看有没有 `estimated` / `missing` 的词。
fn engine_of(body: &SpeechBody) -> DocEngine {
    let object = body.engine.as_ref().and_then(Value::as_object);
    let text = |key: &str| object.and_then(|o| o.get(key)).and_then(Value::as_str);
    let aligned_words = object
        .and_then(|o| o.get("alignedWords"))
        .and_then(Value::as_bool)
        .unwrap_or_else(|| {
            !body
                .words
                .iter()
                .any(|word| matches!(word.timing_quality, Some(TimingQuality::Estimated | TimingQuality::Missing)))
        });
    DocEngine {
        name: text("name").or_else(|| text("provider")).unwrap_or("unknown").to_owned(),
        version: text("version").map(str::to_owned),
        aligned_words,
    }
}

fn pins_to_doc(pins: Option<&BTreeMap<String, BreakPin>>) -> BTreeMap<String, BreakOverride> {
    pins.into_iter()
        .flatten()
        .map(|(id, pin)| {
            let value = match pin {
                BreakPin::Break => BreakOverride::Break,
                BreakPin::NoBreak => BreakOverride::Nobreak,
            };
            (id.clone(), value)
        })
        .collect()
}

fn pins_from_doc(pins: &BTreeMap<String, BreakOverride>) -> BTreeMap<String, BreakPin> {
    pins.iter()
        .map(|(id, pin)| {
            let value = match pin {
                BreakOverride::Break => BreakPin::Break,
                BreakOverride::Nobreak => BreakPin::NoBreak,
            };
            (id.clone(), value)
        })
        .collect()
}

/// 空集合写不写：有底稿时跟底稿（底稿有这个字段就写），没有底稿时按 `fresh`。
fn keep_empty<T>(value: T, empty: bool, base_had: Option<bool>, fresh: bool) -> Option<T> {
    (!empty || base_had.unwrap_or(fresh)).then_some(value)
}

/// 布尔标记：为真时写 `true`；为假时底稿明写了 `false` 就照写，否则不写。
fn keep_flag(value: bool, prior: Option<bool>) -> Option<bool> {
    if value {
        Some(true)
    } else if prior == Some(false) {
        Some(false)
    } else {
        None
    }
}

/// 秒 → 刻度。底稿的刻度换回秒正好等于这个值时沿用底稿的刻度，否则按 §2.10 的规则取整并记进报告。
fn keep_or_round(seconds: f64, prior: Option<i64>, timescale: i64, report: &mut WriteReport) -> Result<i64, BridgeError> {
    if let Some(prior) = prior
        && ticks_to_seconds(prior, timescale).ok() == Some(seconds)
    {
        return Ok(prior);
    }
    let rounded = seconds_to_ticks(seconds, timescale)?;
    if !rounded.exact {
        report.rounded_times += 1;
        let error = (seconds - rounded.ticks as f64 / timescale as f64).abs();
        report.max_rounding_error_seconds = report.max_rounding_error_seconds.max(error);
    }
    Ok(rounded.ticks)
}

pub(crate) fn from_doc(
    doc: &TranscriptDoc,
    base: Option<&SpeechBody>,
    report: &mut WriteReport,
) -> Result<(Option<String>, SpeechBody), BridgeError> {
    let timescale = match base {
        Some(base) => timescale_of(base)?,
        None => FRESH_TIMESCALE,
    };

    let base_words: HashMap<&str, &SpeechWord> = base
        .map(|b| b.words.iter().map(|w| (w.id.as_str(), w)).collect())
        .unwrap_or_default();
    let mut words = Vec::with_capacity(doc.words.len());
    for word in &doc.words {
        let prior = base_words.get(word.id.as_str()).copied();
        let start = keep_or_round(word.t0, prior.and_then(|p| p.start), timescale, report)?;
        let end = keep_or_round(word.t1, prior.and_then(|p| p.end), timescale, report)?;
        let retimed = prior.is_none_or(|p| p.start != Some(start) || p.end != Some(end));
        let mut out = prior.cloned().unwrap_or_else(|| SpeechWord {
            id: word.id.clone(),
            start: None,
            end: None,
            text: String::new(),
            speaker: None,
            hidden: None,
            timing_quality: None,
            glue: None,
            extra: Map::new(),
        });
        out.start = Some(start);
        out.end = Some(end);
        out.text = word.text.clone();
        out.speaker = (word.sp != NO_SPEAKER).then(|| word.sp.clone());
        out.hidden = keep_flag(doc.hidden.get(&word.id).copied().unwrap_or(false), prior.and_then(|p| p.hidden));
        out.glue = keep_flag(word.glue, prior.and_then(|p| p.glue));
        // 时间没变的词沿用底稿的时间质量；新词或改了时间的词按引擎说的「词时间是不是真实对齐的」标。
        if retimed {
            out.timing_quality = (!doc.engine.aligned_words).then_some(TimingQuality::Estimated);
        }
        words.push(out);
    }
    let word_ids: HashSet<&str> = doc.words.iter().map(|w| w.id.as_str()).collect();
    for (id, hidden) in &doc.hidden {
        if !hidden {
            report.dropped.push(format!("hidden 里词 {id} 的 false"));
        } else if !word_ids.contains(id.as_str()) {
            report.dropped.push(format!("隐藏的词 {id} 已经不在词表里"));
        }
    }

    let mut speakers = Vec::new();
    let mut placed = BTreeSet::new();
    for prior in base.and_then(|b| b.speakers.as_ref()).into_iter().flatten() {
        if let Some(speaker) = doc.speakers.get(&prior.id) {
            speakers.push(speaker_from(&prior.id, speaker, Some(prior)));
            placed.insert(prior.id.as_str());
        }
    }
    for (id, speaker) in &doc.speakers {
        if id == NO_SPEAKER {
            if !speaker.name.is_empty() || speaker.hue.is_some() {
                report.dropped.push("没有说话人的词（保留的说话人 \"\"）的名字与色相".to_owned());
            }
        } else if !placed.contains(id.as_str()) {
            speakers.push(speaker_from(id, speaker, None));
        }
    }

    let base_chapters: HashMap<&str, &SpeechChapter> = base
        .and_then(|b| b.chapters.as_ref())
        .map(|list| list.iter().map(|c| (c.id.as_str(), c)).collect())
        .unwrap_or_default();
    let mut chapters = Vec::with_capacity(doc.chapters.len());
    for chapter in &doc.chapters {
        let prior = base_chapters.get(chapter.id.as_str()).copied();
        chapters.push(SpeechChapter {
            id: chapter.id.clone(),
            title: chapter.title.clone(),
            start: keep_or_round(chapter.start, prior.map(|p| p.start), timescale, report)?,
            end: keep_or_round(chapter.end, prior.map(|p| p.end), timescale, report)?,
            extra: prior.map(|p| p.extra.clone()).unwrap_or_default(),
        });
    }

    let paragraph_set: BTreeSet<&str> = doc.para_breaks.iter().filter(|(_, on)| **on).map(|(id, _)| id.as_str()).collect();
    for (id, on) in &doc.para_breaks {
        if !on {
            report.dropped.push(format!("paraBreaks 里词 {id} 的 false"));
        }
    }
    let prior_paragraphs = base.and_then(|b| b.paragraph_breaks.as_ref());
    let paragraph_breaks = match prior_paragraphs {
        Some(prior) if prior.len() == paragraph_set.len() && prior.iter().map(String::as_str).collect::<BTreeSet<_>>() == paragraph_set => {
            prior.clone()
        }
        _ => {
            // 按词序排，已经不在词表里的词排在最后。
            let position: HashMap<&str, usize> = doc.words.iter().enumerate().map(|(i, w)| (w.id.as_str(), i)).collect();
            let mut list: Vec<&str> = paragraph_set.iter().copied().collect();
            list.sort_by_key(|id| (position.get(id).copied().unwrap_or(usize::MAX), *id));
            list.into_iter().map(str::to_owned).collect()
        }
    };

    let base_had = |field: fn(&SpeechBody) -> bool| base.map(field);
    let user_breaks = pins_from_doc(&doc.breaks);
    let auto_breaks: BTreeMap<String, BTreeMap<String, BreakPin>> = doc
        .auto_breaks
        .iter()
        .map(|(profile, pins)| (profile.clone(), pins_from_doc(pins)))
        .collect();
    let stages = stages_from(&doc.stages, base.and_then(|b| b.stages.as_ref()));

    // 存下来的句子只在词的 ID、顺序、隐藏与分段都没变时沿用；变了就清成 null，由派生规则重新得出。
    let structure = |list: &[SpeechWord]| list.iter().map(|w| (w.id.clone(), w.hidden == Some(true))).collect::<Vec<_>>();
    let sentences = match base {
        None => Some(None),
        Some(b) => {
            let same_paragraphs = b.paragraph_breaks.iter().flatten().map(String::as_str).collect::<BTreeSet<_>>() == paragraph_set;
            if structure(&b.words) == structure(&words) && same_paragraphs {
                b.sentences.clone()
            } else {
                b.sentences.as_ref().map(|_| None)
            }
        }
    };

    let created_at = match &doc.created_at {
        Some(at) => Some(Some(at.clone())),
        None => match base {
            Some(b) if b.created_at.is_none() => None,
            _ => Some(None),
        },
    };
    let engine = match base {
        Some(b) if engine_of(b) == doc.engine => b.engine.clone(),
        _ => Some(engine_json(&doc.engine)),
    };
    if doc.read_only_note {
        report.dropped.push("readOnlyNote".to_owned());
    }

    let body = SpeechBody {
        schema: SPEECH_SCHEMA.to_owned(),
        clock: match base {
            Some(b) => b.clock.clone(),
            None => Some("source-asset".to_owned()),
        },
        timescale: match base {
            Some(b) => b.timescale,
            None => Some(FRESH_TIMESCALE),
        },
        engine,
        created_at,
        speakers: keep_empty(speakers.clone(), speakers.is_empty(), base_had(|b| b.speakers.is_some()), true),
        words,
        sentences,
        chapters: keep_empty(chapters.clone(), chapters.is_empty(), base_had(|b| b.chapters.is_some()), true),
        user_breaks: keep_empty(
            user_breaks.clone(),
            user_breaks.is_empty(),
            base_had(|b| b.user_breaks.is_some()),
            false,
        ),
        auto_breaks: keep_empty(
            auto_breaks.clone(),
            auto_breaks.is_empty(),
            base_had(|b| b.auto_breaks.is_some()),
            false,
        ),
        layout_profile_id: doc.layout_profile.clone(),
        paragraph_breaks: keep_empty(
            paragraph_breaks.clone(),
            paragraph_breaks.is_empty(),
            base_had(|b| b.paragraph_breaks.is_some()),
            false,
        ),
        stages: keep_empty(stages, doc.stages.is_empty(), base_had(|b| b.stages.is_some()), false),
        extra: base.map(|b| b.extra.clone()).unwrap_or_default(),
    };
    let language = (doc.lang != UNDETERMINED).then(|| doc.lang.clone());
    Ok((language, body))
}

fn speaker_from(id: &str, speaker: &Speaker, prior: Option<&SpeechSpeaker>) -> SpeechSpeaker {
    SpeechSpeaker {
        id: id.to_owned(),
        name: speaker.name.clone(),
        // 底稿明写了 `hue: null` 而色相仍然没有时照写 null。
        hue: match (speaker.hue, prior.map(|p| p.hue)) {
            (Some(hue), _) => Some(Some(hue)),
            (None, Some(Some(None))) => Some(None),
            (None, _) => None,
        },
        extra: prior.map(|p| p.extra.clone()).unwrap_or_default(),
    }
}

fn engine_json(engine: &DocEngine) -> Value {
    let mut object = json!({ "name": engine.name, "alignedWords": engine.aligned_words });
    if let Some(version) = &engine.version {
        object["version"] = json!(version);
    }
    object
}

fn stages_from(stages: &Stages, prior: Option<&SpeechStages>) -> SpeechStages {
    let prior_aligned = prior.and_then(|p| p.aligned.as_ref());
    SpeechStages {
        asr: stages.asr.clone(),
        asr_layout: stages.asr_layout.clone(),
        polish: stages.polish.clone(),
        segment: stages.segment.clone(),
        chapters: stages.chapters.clone(),
        aligned: stages.aligned.as_ref().map(|aligned| AlignedStage {
            mode: aligned.mode.clone(),
            coverage: aligned.coverage,
            low_confidence: keep_empty(
                aligned.low_confidence.clone(),
                aligned.low_confidence.is_empty(),
                prior_aligned.map(|p| p.low_confidence.is_some()),
                false,
            ),
            extra: prior_aligned.map(|p| p.extra.clone()).unwrap_or_default(),
        }),
        extra: prior.map(|p| p.extra.clone()).unwrap_or_default(),
    }
}
