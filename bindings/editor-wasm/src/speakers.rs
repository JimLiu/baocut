//! 已有转写的「识别说话人」（架构设计 §6.6）：把声纹区分投影到词上的结果做成提案，用户确认后再应用。
//!
//! - [`speaker_proposal`]：转写正文 + 各语言译文 + 每个词投影到的声纹聚类（Model Worker 的 `baocut.speakers/v1`）→
//!   提案：哪些词换说话人、每位说话人的句数与试听片段、有几条译文会按新边界重切。聚类按重叠时长一对一复用已有的
//!   说话人（保留它的 ID 与名字，库里的音色绑定与配音的说话人绑定因此不断），复用不上的新建 `spk-<n>`、名字
//!   「说话人 n」。规则从旧版本的 `speakers reidentify` 原样移植；没有说话人的词（保留的 `""`）不参与复用。
//! - [`apply_speakers`]：正文 + 译文 + 提案的换人表 + 说话人表（用户在确认页改过的名字）→ 写回的正文与有变化的译文。
//!   应用由字幕与翻译核心的 `apply_speaker_proposal` 完成：新的说话人边界切开句子时，已有译文按目标语的自然缝重切，
//!   不重新翻译。
//!
//! 两个都是纯函数；提案是应用的一次试算（同一个函数），所以确认页的数字就是应用后的数字。

use std::collections::{BTreeMap, BTreeSet, HashMap};

use editor_semantics::MediaTime;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use speech_doc::TranscriptDoc;
use speech_doc::doc::Speaker;
use speech_doc::speaker_apply::{SpeakerApplyReport, apply_speaker_proposal};
use speech_doc_bridge::sentences::source_sentences;
use speech_doc_bridge::{MediaFacts, V3Documents, WriteBase, from_transcript_doc, to_transcript_doc};
use video_model::speech::SpeechBody;
use video_model::translation::TranslationBody;

use crate::{EntryError, invalid_input};

/// 没有说话人的词用的保留 ID（视频格式规范 §5.2）。
const NO_SPEAKER: &str = "";
/// 每位说话人给几段试听。
const CLIPS_PER_SPEAKER: usize = 3;
/// 试听片段优先选不短于这个时长的句子（秒）。
const CLIP_MIN_SECONDS: f64 = 1.5;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProposalInput {
    speech: SpeechBody,
    #[serde(default)]
    translations: Vec<TranslationBody>,
    /// 与 `speech.words` 一一对应：这个词投影到的声纹聚类，拿不到证据的词为 null。
    labels: Vec<Option<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplyInput {
    speech: SpeechBody,
    #[serde(default)]
    translations: Vec<TranslationBody>,
    /// 换说话人的词：词 ID → 说话人 ID。
    word_speakers: BTreeMap<String, String>,
    /// 提案里的说话人与名字（确认页改过的名字在这里）；没列出的已有说话人保持原样。
    speakers: Vec<SpeakerName>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeakerName {
    id: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProposalOutput {
    /// 换说话人的词：词 ID → 说话人 ID（只列有变化的）。
    word_speakers: BTreeMap<String, String>,
    /// 应用后的说话人，按在正文里第一次出现的次序。
    speakers: Vec<ProposedSpeaker>,
    /// 换了说话人的词数；0 表示提案与现状相同。
    relabeled: usize,
    /// 会按新边界重切的译文条数（各语言相加）。
    translations_split: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProposedSpeaker {
    id: String,
    name: String,
    /// 正文里原来没有的说话人。
    is_new: bool,
    words: usize,
    /// 这位说话人的词的总时长（秒）。
    seconds: f64,
    sentences: usize,
    clips: Vec<Clip>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Clip {
    sentence_id: String,
    /// 正文 `timescale` 下的刻度。
    start: i64,
    end: i64,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApplyOutput {
    speech: Value,
    /// 与输入的译文一一对应：有变化的是整份新正文，没变的为 null。
    translations: Vec<Option<Value>>,
    relabeled: usize,
    translations_split: usize,
    sentences_split: usize,
    /// 写回时 v3 格式装不下而丢掉的内容（正常应为空）。
    dropped: Vec<String>,
}

fn invalid_speech(message: impl Into<String>) -> EntryError {
    EntryError {
        code: "INVALID_SPEECH",
        message: message.into(),
    }
}

fn invalid_proposal(message: impl Into<String>) -> EntryError {
    EntryError {
        code: "INVALID_PROPOSAL",
        message: message.into(),
    }
}

/// 句子与说话人只看词；素材的事实用占位，时长取末词的终点（核心的校验要求词不越出时长）。
pub(crate) fn media_for(body: &SpeechBody) -> MediaFacts {
    let timescale = body.timescale.unwrap_or(1_000_000);
    let end = body.words.iter().filter_map(|word| word.end).max().unwrap_or(0);
    MediaFacts {
        asset_id: None,
        path: None,
        content_hash: String::new(),
        duration: MediaTime {
            ticks: end.max(0).to_string(),
            timescale,
        },
        sample_rate: None,
    }
}

/// 同一份转写可以有几份同语言的译文（每次翻译新建一份），字幕与翻译核心按语言分表：进核心前把语言换成按次序的键，
/// 写回后换回来。
fn keyed(translations: &[TranslationBody]) -> Vec<TranslationBody> {
    translations
        .iter()
        .enumerate()
        .map(|(index, body)| TranslationBody {
            language: format!("t{index}"),
            ..body.clone()
        })
        .collect()
}

fn load(speech: &SpeechBody, translations: &[TranslationBody]) -> Result<TranscriptDoc, EntryError> {
    let media = media_for(speech);
    to_transcript_doc(&V3Documents {
        media: &media,
        language: None,
        speech,
        translations,
    })
    .map_err(|error| invalid_speech(error.message))
}

/// 聚类 → 说话人：按重叠时长从大到小一对一复用已有说话人，复用不上的新建。
fn map_clusters(doc: &TranscriptDoc, labels: &[Option<String>]) -> (BTreeMap<String, String>, BTreeMap<String, Speaker>) {
    let mut overlap: BTreeMap<(&str, &str), f64> = BTreeMap::new();
    for (word, label) in doc.words.iter().zip(labels) {
        if let Some(cluster) = label
            && word.sp != NO_SPEAKER
        {
            *overlap.entry((cluster.as_str(), word.sp.as_str())).or_default() += (word.t1 - word.t0).max(0.01);
        }
    }
    let mut candidates = overlap
        .into_iter()
        .map(|((cluster, speaker), seconds)| (seconds, cluster, speaker))
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.0.total_cmp(&left.0).then(left.1.cmp(right.1)).then(left.2.cmp(right.2)));
    let mut cluster_to_speaker = BTreeMap::new();
    let mut claimed = BTreeSet::new();
    for (_, cluster, speaker) in candidates {
        if cluster_to_speaker.contains_key(cluster) || claimed.contains(speaker) {
            continue;
        }
        cluster_to_speaker.insert(cluster.to_owned(), speaker.to_owned());
        claimed.insert(speaker);
    }

    // 新说话人按聚类第一次出现的次序编号，接在已有的 `spk-<n>` 后面。
    let mut new_speakers = BTreeMap::new();
    let mut next_number = doc
        .speakers
        .keys()
        .filter_map(|id| id.strip_prefix("spk-")?.parse::<usize>().ok())
        .max()
        .unwrap_or(0)
        + 1;
    let names = doc.speakers.values().map(|speaker| speaker.name.clone()).collect::<BTreeSet<_>>();
    let mut seen = BTreeSet::new();
    for cluster in labels.iter().flatten() {
        if !seen.insert(cluster.as_str()) || cluster_to_speaker.contains_key(cluster) {
            continue;
        }
        // ID 与名字都不与已有的撞（旧项目导入的说话人可能叫「说话人 1」而 ID 不是 `spk-1`）。
        while doc.speakers.contains_key(&format!("spk-{next_number}")) || names.contains(&format!("说话人 {next_number}")) {
            next_number += 1;
        }
        let id = format!("spk-{next_number}");
        new_speakers.insert(
            id.clone(),
            Speaker {
                name: format!("说话人 {next_number}"),
                hue: None,
            },
        );
        cluster_to_speaker.insert(cluster.clone(), id);
        next_number += 1;
    }
    (cluster_to_speaker, new_speakers)
}

/// 应用一次（提案的试算与真正的应用共用）。返回应用后的文稿与核心的报告。
fn run_apply(
    doc: &TranscriptDoc,
    word_speakers: &BTreeMap<String, String>,
    speakers: &BTreeMap<String, Speaker>,
) -> Result<(TranscriptDoc, SpeakerApplyReport), EntryError> {
    let mut next = doc.clone();
    let report = apply_speaker_proposal(&mut next, word_speakers, speakers, &[]).map_err(|error| invalid_proposal(error.to_string()))?;
    Ok((next, report))
}

/// 各语言被切开的原译文条数：切开的句子里，这种语言原来有译文的。
fn split_count(before: &TranscriptDoc, report: &SpeakerApplyReport) -> usize {
    before
        .trans
        .values()
        .map(|table| {
            report
                .sentences_split
                .iter()
                .filter(|id| table.get(*id).is_some_and(|text| !text.trim().is_empty()))
                .count()
        })
        .sum()
}

fn write_back(
    doc: &TranscriptDoc,
    speech: &SpeechBody,
    translations: &[TranslationBody],
) -> Result<speech_doc_bridge::V3Write, EntryError> {
    from_transcript_doc(
        doc,
        &WriteBase {
            speech: Some(speech),
            translations,
            source_basis: None,
        },
    )
    .map_err(|error| invalid_speech(error.message))
}

/// 提案（JSON）。正文读不懂是 `INVALID_SPEECH`；`labels` 与词数不符是 `INVALID_PROPOSAL`。
pub fn speaker_proposal(input: &[u8]) -> Result<String, EntryError> {
    let input: ProposalInput = serde_json::from_slice(input).map_err(invalid_input)?;
    if input.labels.len() != input.speech.words.len() {
        return Err(invalid_proposal(format!(
            "labels 有 {} 个，正文有 {} 个词",
            input.labels.len(),
            input.speech.words.len()
        )));
    }
    let translations = keyed(&input.translations);
    let doc = load(&input.speech, &translations)?;
    let (cluster_to_speaker, new_speakers) = map_clusters(&doc, &input.labels);
    let word_speakers = doc
        .words
        .iter()
        .zip(&input.labels)
        .filter_map(|(word, label)| {
            let speaker = cluster_to_speaker.get(label.as_ref()?)?;
            (speaker != &word.sp).then(|| (word.id.clone(), speaker.clone()))
        })
        .collect::<BTreeMap<_, _>>();
    let (after, report) = run_apply(&doc, &word_speakers, &new_speakers)?;
    let translations_split = split_count(&doc, &report);
    let written = write_back(&after, &input.speech, &translations)?;

    let timescale = written.speech.timescale.unwrap_or(1_000_000) as f64;
    let sentences = source_sentences(&written.speech).map_err(|error| invalid_speech(error.message))?;
    let mut by_speaker: HashMap<&str, Vec<&speech_doc_bridge::sentences::SourceSentence>> = HashMap::new();
    for sentence in &sentences.sentences {
        by_speaker
            .entry(sentence.speaker.as_deref().unwrap_or(NO_SPEAKER))
            .or_default()
            .push(sentence);
    }
    let mut order = Vec::<&str>::new();
    let mut stats: HashMap<&str, (usize, f64)> = HashMap::new();
    for word in &after.words {
        if word.sp == NO_SPEAKER {
            continue;
        }
        if !stats.contains_key(word.sp.as_str()) {
            order.push(word.sp.as_str());
        }
        let entry = stats.entry(word.sp.as_str()).or_default();
        entry.0 += 1;
        entry.1 += (word.t1 - word.t0).max(0.0);
    }
    let speakers = order
        .into_iter()
        .map(|id| {
            let (words, seconds) = stats[id];
            let own = by_speaker.get(id).map(Vec::as_slice).unwrap_or_default();
            ProposedSpeaker {
                id: id.to_owned(),
                name: after.speakers.get(id).map(|speaker| speaker.name.clone()).unwrap_or_default(),
                is_new: !doc.speakers.contains_key(id),
                words,
                seconds: (seconds * 1000.0).round() / 1000.0,
                sentences: own.len(),
                clips: pick_clips(own, timescale),
            }
        })
        .collect();
    let output = ProposalOutput {
        word_speakers,
        speakers,
        relabeled: report.relabeled,
        translations_split,
    };
    Ok(serde_json::to_string(&output).expect("提案总能序列化"))
}

/// 试听片段：这位说话人的句子里均匀取几句，优先不太短的。
fn pick_clips(sentences: &[&speech_doc_bridge::sentences::SourceSentence], timescale: f64) -> Vec<Clip> {
    let long = sentences
        .iter()
        .copied()
        .filter(|sentence| (sentence.end - sentence.start) as f64 / timescale >= CLIP_MIN_SECONDS)
        .collect::<Vec<_>>();
    let pool = if long.len() >= CLIPS_PER_SPEAKER.min(sentences.len()) && !long.is_empty() {
        long
    } else {
        sentences.to_vec()
    };
    let count = pool.len().min(CLIPS_PER_SPEAKER);
    let mut picked = Vec::new();
    for slot in 0..count {
        let index = if count == 1 { 0 } else { slot * (pool.len() - 1) / (count - 1) };
        if picked.last() != Some(&index) {
            picked.push(index);
        }
    }
    picked
        .into_iter()
        .map(|index| {
            let sentence = pool[index];
            Clip {
                sentence_id: sentence.id.clone(),
                start: sentence.start,
                end: sentence.end,
                text: sentence.text.clone(),
            }
        })
        .collect()
}

/// 应用（JSON）。换人表引用不认识的说话人、或说话人 ID 为空是 `INVALID_PROPOSAL`。
pub fn apply_speakers(input: &[u8]) -> Result<String, EntryError> {
    let input: ApplyInput = serde_json::from_slice(input).map_err(invalid_input)?;
    let keyed_translations = keyed(&input.translations);
    let doc = load(&input.speech, &keyed_translations)?;
    let mut speakers = BTreeMap::new();
    for speaker in &input.speakers {
        if speaker.id == NO_SPEAKER {
            return Err(invalid_proposal("说话人的 ID 不能是空字符串"));
        }
        let hue = doc.speakers.get(&speaker.id).and_then(|old| old.hue);
        speakers.insert(
            speaker.id.clone(),
            Speaker {
                name: speaker.name.trim().to_owned(),
                hue,
            },
        );
    }
    let (after, report) = run_apply(&doc, &input.word_speakers, &speakers)?;
    let translations_split = split_count(&doc, &report);
    let written = write_back(&after, &input.speech, &keyed_translations)?;
    if !written.removed_languages.is_empty() || written.translations.len() != input.translations.len() {
        return Err(invalid_proposal(format!(
            "应用后少了译文：{}",
            written.removed_languages.join("、")
        )));
    }
    let mut translations = Vec::new();
    for (before, after) in input.translations.iter().zip(&written.translations) {
        let after = TranslationBody {
            language: before.language.clone(),
            ..after.clone()
        };
        let before = serde_json::to_value(before).expect("译文总能序列化");
        let after = serde_json::to_value(&after).expect("译文总能序列化");
        translations.push((before != after).then_some(after));
    }
    let output = ApplyOutput {
        speech: serde_json::to_value(&written.speech).expect("正文总能序列化"),
        translations,
        relabeled: report.relabeled,
        translations_split,
        sentences_split: report.sentences_split.len(),
        dropped: written.report.dropped,
    };
    Ok(serde_json::to_string(&output).expect("结果总能序列化"))
}
