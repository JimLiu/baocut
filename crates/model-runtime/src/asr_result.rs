//! 输出合同 `baocut.asr-result/v1`（协议规范 §6）：类型、写出前的自检、`segments.jsonl` 与 `result.json`。

use std::collections::HashSet;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::protocol::OutputFile;

pub const SCHEMA: &str = "baocut.asr-result/v1";
pub const CLOCK: &str = "source-asset";
pub const SEGMENTS_FILE: &str = "segments.jsonl";
pub const RESULT_FILE: &str = "result.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Outcome {
    Transcribed,
    NoAudioTrack,
    NoSpeech,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AsrResult {
    pub schema: String,
    pub outcome: Outcome,
    pub timescale: u64,
    pub clock: String,
    pub duration: u64,
    pub language: LanguageResult,
    pub segments: Vec<Segment>,
    pub speakers: Vec<Speaker>,
    pub coverage: Vec<TickSpan>,
    pub warnings: Vec<Warning>,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LanguageSource {
    Asserted,
    Detected,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageResult {
    pub tag: Option<String>,
    pub source: LanguageSource,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub id: String,
    pub start: u64,
    pub end: u64,
    pub text: String,
    pub speaker_id: Option<String>,
    pub words: Vec<Word>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimingQuality {
    Aligned,
    Provider,
    Estimated,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub start: u64,
    pub end: u64,
    pub text: String,
    pub confidence: Option<f64>,
    pub timing_quality: TimingQuality,
    /// 词级说话人（`speakers[]` 的 id）。说话人区分（§6.6）按词投影，一段里可以换人；段的 `speakerId` 是段里说话时长
    /// 最多的那个。没有说话人区分时省略。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Speaker {
    pub id: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TickSpan {
    pub start: u64,
    pub end: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WarningCode {
    AlignmentFailed,
    TimingAdjusted,
    BackendDegraded,
    DiarizationUnavailable,
    SegmentDegenerate,
    RangeClamped,
    /// 模型没有识别提示的通道（MOSS），请求里的 `hint` 没有交给模型。
    HintIgnored,
    /// 模型有一段没写完整（MOSS 一块生成到上限或陷入重复、又切不开）：已保留识别出的部分，之后可能缺字。
    SegmentIncomplete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Warning {
    pub code: WarningCode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl Warning {
    pub fn new(code: WarningCode) -> Self {
        Self {
            code,
            segment_id: None,
            detail: None,
        }
    }

    pub fn segment(mut self, id: &str) -> Self {
        self.segment_id = Some(id.to_owned());
        self
    }

    pub fn detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelRef {
    pub family: String,
    pub revision: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelRefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asr: Option<ModelRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vad: Option<ModelRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aligner: Option<ModelRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<ModelRef>,
    /// 说话人区分用到的 Pyannote 分段模型（§6.6）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segmentation: Option<ModelRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    pub provider: String,
    pub bundle_id: Option<String>,
    pub models: ModelRefs,
    pub backend: String,
    pub device: String,
    pub worker_version: String,
    pub input_hash: String,
    pub run_generation: u64,
}

/// 词时间的单调修正（架构设计 §6.6 第 6 步）：词在段内、起止不倒挂、后一个词不早于前一个词结束。
/// 被修正的词保留原来的 `timingQuality`；`missing` 的词固定在段起点。返回是否改动过有时间的词。
pub fn fix_word_times(segment: &mut Segment) -> bool {
    let (start, end) = (segment.start, segment.end);
    let mut adjusted = false;
    let mut previous_end = start;
    for word in &mut segment.words {
        if word.timing_quality == TimingQuality::Missing {
            word.start = start;
            word.end = start;
            continue;
        }
        let fixed_start = word.start.clamp(previous_end, end);
        let fixed_end = word.end.clamp(fixed_start, end);
        if (fixed_start, fixed_end) != (word.start, word.end) {
            adjusted = true;
            word.start = fixed_start;
            word.end = fixed_end;
        }
        previous_end = word.end;
    }
    adjusted
}

/// 写出前的自检（§6 的校验规则）。`asserted` 是请求里断言的语言。
pub fn validate(result: &AsrResult, asserted: Option<&str>) -> Result<(), String> {
    if result.schema != SCHEMA {
        return Err(format!("schema 应为 {SCHEMA}"));
    }
    if result.clock != CLOCK {
        return Err(format!("clock 应为 {CLOCK}"));
    }
    if result.timescale == 0 {
        return Err("timescale 必须大于 0".into());
    }
    if result.outcome != Outcome::Transcribed && !result.segments.is_empty() {
        return Err("outcome 不是 transcribed 时 segments 必须为空".into());
    }
    for span in &result.coverage {
        if span.start > span.end || span.end > result.duration {
            return Err(format!("coverage [{}, {}] 越界", span.start, span.end));
        }
    }
    let speakers: HashSet<&str> = result.speakers.iter().map(|speaker| speaker.id.as_str()).collect();
    let mut ids = HashSet::new();
    let mut previous_end = 0;
    for segment in &result.segments {
        let id = &segment.id;
        if !ids.insert(id.as_str()) {
            return Err(format!("段 id 重复：{id}"));
        }
        if segment.start >= segment.end || segment.end > result.duration {
            return Err(format!(
                "段 {id} 的时间 [{}, {}] 不合法（duration {}）",
                segment.start, segment.end, result.duration
            ));
        }
        if segment.start < previous_end {
            return Err(format!("段 {id} 与前一段重叠或未按 start 递增"));
        }
        previous_end = segment.end;
        if segment.text.trim().is_empty() {
            return Err(format!("段 {id} 的文本为空"));
        }
        if let Some(speaker) = &segment.speaker_id
            && !speakers.contains(speaker.as_str())
        {
            return Err(format!("段 {id} 的 speakerId {speaker} 不在 speakers[] 中"));
        }
        let mut previous: Option<&Word> = None;
        for word in &segment.words {
            if word.text.trim().is_empty() {
                return Err(format!("段 {id} 有空词"));
            }
            if let Some(speaker) = &word.speaker_id
                && !speakers.contains(speaker.as_str())
            {
                return Err(format!("段 {id} 的词「{}」的 speakerId {speaker} 不在 speakers[] 中", word.text));
            }
            if word.start > word.end || word.start < segment.start || word.end > segment.end {
                return Err(format!("段 {id} 的词「{}」越出段或起止倒挂", word.text));
            }
            if let Some(previous) = previous
                && (word.start < previous.start || word.end < previous.end)
            {
                return Err(format!("段 {id} 的词时间不单调"));
            }
            match word.timing_quality {
                TimingQuality::Missing if word.start != segment.start || word.end != segment.start => {
                    return Err(format!("段 {id} 的 missing 词必须取段起点"));
                }
                TimingQuality::Aligned if result.provenance.models.aligner.is_none() => {
                    return Err(format!("段 {id} 有 aligned 的词，但没有对齐器"));
                }
                _ => {}
            }
            previous = Some(word);
        }
    }
    if let Some(tag) = &result.language.tag
        && !is_bcp47(tag)
    {
        return Err(format!("language.tag 不是合法的 BCP 47：{tag}"));
    }
    if result.language.source == LanguageSource::Asserted && result.language.tag.as_deref() != asserted {
        return Err("asserted 语言必须等于请求的断言".into());
    }
    Ok(())
}

/// BCP 47 的形状检查：主语言 2–3 或 5–8 个字母，之后每段 1–8 个字母数字。
pub fn is_bcp47(tag: &str) -> bool {
    let mut parts = tag.split('-');
    let Some(language) = parts.next() else { return false };
    let language_ok = matches!(language.len(), 2 | 3 | 5..=8) && language.chars().all(|c| c.is_ascii_alphabetic());
    language_ok && parts.all(|part| (1..=8).contains(&part.len()) && part.chars().all(|c| c.is_ascii_alphanumeric()))
}

/// `segments.jsonl`：首行是头，之后每行一个段，每行写完 flush（§5）。
pub struct SegmentsWriter {
    path: PathBuf,
    out: BufWriter<File>,
}

impl SegmentsWriter {
    pub fn create(staging: &Path, header: &SegmentsHeader<'_>) -> std::io::Result<Self> {
        let path = staging.join(SEGMENTS_FILE);
        let mut writer = Self {
            out: BufWriter::new(File::create(&path)?),
            path,
        };
        writer.line(&json!({
            "header": true,
            "jobId": header.job_id,
            "contentHash": header.content_hash,
            "bundleId": header.bundle_id,
            "workerVersion": header.worker_version,
            "timescale": header.timescale,
        }))?;
        Ok(writer)
    }

    pub fn append(&mut self, segment: &Segment) -> std::io::Result<()> {
        self.line(&serde_json::to_value(segment).map_err(std::io::Error::other)?)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn line(&mut self, value: &Value) -> std::io::Result<()> {
        serde_json::to_writer(&mut self.out, value).map_err(std::io::Error::other)?;
        self.out.write_all(b"\n")?;
        self.out.flush()
    }
}

pub struct SegmentsHeader<'a> {
    pub job_id: &'a str,
    pub content_hash: &'a str,
    pub bundle_id: &'a str,
    pub worker_version: &'a str,
    pub timescale: u64,
}

/// 一次性写出 `result.json`：先写临时文件再重命名。返回路径、bytes 的 sha256（小写十六进制）与长度。
pub fn write_result(staging: &Path, result: &AsrResult) -> std::io::Result<OutputFile> {
    let bytes = serde_json::to_vec(result).map_err(std::io::Error::other)?;
    let path = staging.join(RESULT_FILE);
    let temporary = staging.join(format!("{RESULT_FILE}.tmp"));
    {
        let mut file = File::create(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
    }
    std::fs::rename(&temporary, &path)?;
    Ok(OutputFile {
        path: path.to_string_lossy().into_owned(),
        sha256: sha256_hex(&bytes),
        byte_length: bytes.len() as u64,
    })
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(start: u64, end: u64, text: &str) -> Word {
        Word {
            start,
            end,
            text: text.into(),
            confidence: None,
            timing_quality: TimingQuality::Estimated,
            speaker_id: None,
        }
    }

    fn segment(id: &str, start: u64, end: u64, words: Vec<Word>) -> Segment {
        Segment {
            id: id.into(),
            start,
            end,
            text: "hello world".into(),
            speaker_id: None,
            words,
        }
    }

    fn result(segments: Vec<Segment>) -> AsrResult {
        AsrResult {
            schema: SCHEMA.into(),
            outcome: Outcome::Transcribed,
            timescale: 1_000,
            clock: CLOCK.into(),
            duration: 10_000,
            language: LanguageResult {
                tag: Some("en".into()),
                source: LanguageSource::Detected,
                confidence: None,
            },
            segments,
            speakers: vec![],
            coverage: vec![TickSpan { start: 0, end: 10_000 }],
            warnings: vec![],
            provenance: Provenance {
                provider: "local".into(),
                bundle_id: Some("b".into()),
                models: ModelRefs::default(),
                backend: "mlx".into(),
                device: "metal".into(),
                worker_version: "0".into(),
                input_hash: "sha256:00".into(),
                run_generation: 1,
            },
        }
    }

    #[test]
    fn a_well_formed_result_passes() {
        let ok = result(vec![
            segment("seg-0001", 0, 1_000, vec![word(0, 400, "hello"), word(400, 1_000, "world")]),
            segment("seg-0002", 1_000, 2_000, vec![]),
        ]);
        assert_eq!(validate(&ok, None), Ok(()));
    }

    #[test]
    fn segment_rules_are_enforced() {
        let overlap = result(vec![segment("seg-0001", 0, 1_000, vec![]), segment("seg-0002", 900, 2_000, vec![])]);
        assert!(validate(&overlap, None).unwrap_err().contains("重叠"));
        let empty = result(vec![segment("seg-0001", 0, 0, vec![])]);
        assert!(validate(&empty, None).is_err());
        let beyond = result(vec![segment("seg-0001", 9_000, 10_001, vec![])]);
        assert!(validate(&beyond, None).is_err());
        let duplicate = result(vec![segment("seg-0001", 0, 10, vec![]), segment("seg-0001", 10, 20, vec![])]);
        assert!(validate(&duplicate, None).unwrap_err().contains("重复"));
        let mut blank = result(vec![segment("seg-0001", 0, 10, vec![])]);
        blank.segments[0].text = "  ".into();
        assert!(validate(&blank, None).is_err());
        let mut speaker = result(vec![segment("seg-0001", 0, 10, vec![])]);
        speaker.segments[0].speaker_id = Some("spk-1".into());
        assert!(validate(&speaker, None).is_err());
        speaker.speakers.push(Speaker {
            id: "spk-1".into(),
            label: None,
        });
        assert_eq!(validate(&speaker, None), Ok(()));
        // 词级说话人同样要在 speakers[] 里。
        let mut word_speaker = result(vec![segment(
            "seg-0001",
            0,
            10,
            vec![Word {
                start: 0,
                end: 5,
                text: "hi".into(),
                confidence: None,
                timing_quality: TimingQuality::Estimated,
                speaker_id: Some("spk-2".into()),
            }],
        )]);
        assert!(validate(&word_speaker, None).unwrap_err().contains("spk-2"));
        word_speaker.speakers.push(Speaker {
            id: "spk-2".into(),
            label: None,
        });
        assert_eq!(validate(&word_speaker, None), Ok(()));
        let mut no_speech = result(vec![segment("seg-0001", 0, 10, vec![])]);
        no_speech.outcome = Outcome::NoSpeech;
        assert!(validate(&no_speech, None).is_err());
        no_speech.segments.clear();
        assert_eq!(validate(&no_speech, None), Ok(()));
    }

    #[test]
    fn word_rules_are_enforced() {
        let outside = result(vec![segment("seg-0001", 100, 1_000, vec![word(50, 400, "hello")])]);
        assert!(validate(&outside, None).is_err());
        let backwards = result(vec![segment("seg-0001", 0, 1_000, vec![word(500, 600, "a"), word(100, 200, "b")])]);
        assert!(validate(&backwards, None).unwrap_err().contains("单调"));
        let mut missing = result(vec![segment("seg-0001", 100, 1_000, vec![word(200, 200, "a")])]);
        missing.segments[0].words[0].timing_quality = TimingQuality::Missing;
        assert!(validate(&missing, None).is_err());
        missing.segments[0].words[0].start = 100;
        missing.segments[0].words[0].end = 100;
        assert_eq!(validate(&missing, None), Ok(()));
        let mut aligned = result(vec![segment("seg-0001", 0, 1_000, vec![word(0, 100, "a")])]);
        aligned.segments[0].words[0].timing_quality = TimingQuality::Aligned;
        assert!(validate(&aligned, None).unwrap_err().contains("对齐器"));
    }

    #[test]
    fn language_rules_are_enforced() {
        let mut asserted = result(vec![]);
        asserted.language = LanguageResult {
            tag: Some("en".into()),
            source: LanguageSource::Asserted,
            confidence: None,
        };
        assert_eq!(validate(&asserted, Some("en")), Ok(()));
        assert!(validate(&asserted, Some("de")).is_err());
        asserted.language.tag = Some("not a tag".into());
        assert!(validate(&asserted, Some("not a tag")).is_err());
        assert!(is_bcp47("zh-Hant-TW") && is_bcp47("fil") && is_bcp47("yue") && is_bcp47("en-US"));
        assert!(!is_bcp47("") && !is_bcp47("e") && !is_bcp47("en_US") && !is_bcp47("en-") && !is_bcp47("english language"));
    }

    #[test]
    fn word_fixup_clamps_into_the_segment_and_flags_changes() {
        let mut fine = segment("seg-0001", 100, 1_000, vec![word(100, 500, "a"), word(500, 1_000, "b")]);
        assert!(!fix_word_times(&mut fine));
        let mut messy = segment("seg-0001", 100, 1_000, vec![word(50, 600, "a"), word(400, 1_200, "b")]);
        assert!(fix_word_times(&mut messy));
        assert_eq!((messy.words[0].start, messy.words[0].end), (100, 600));
        assert_eq!((messy.words[1].start, messy.words[1].end), (600, 1_000));
        assert_eq!(messy.words[1].timing_quality, TimingQuality::Estimated);
        let mut fixed = result(vec![messy]);
        fixed.duration = 10_000;
        assert_eq!(validate(&fixed, None), Ok(()));
    }

    #[test]
    fn writers_produce_header_rows_and_a_hashed_result() {
        let dir = tempfile::tempdir().unwrap();
        let header = SegmentsHeader {
            job_id: "j",
            content_hash: "sha256:00",
            bundle_id: "b",
            worker_version: "0",
            timescale: 1_000,
        };
        let mut writer = SegmentsWriter::create(dir.path(), &header).unwrap();
        writer.append(&segment("seg-0001", 0, 10, vec![])).unwrap();
        let text = std::fs::read_to_string(dir.path().join(SEGMENTS_FILE)).unwrap();
        let lines: Vec<Value> = text.lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(lines[0]["header"], true);
        assert_eq!(lines[0]["timescale"], 1_000);
        assert_eq!(lines[1]["id"], "seg-0001");
        assert_eq!(lines[1]["speakerId"], Value::Null);

        let output = write_result(dir.path(), &result(vec![])).unwrap();
        let bytes = std::fs::read(dir.path().join(RESULT_FILE)).unwrap();
        assert_eq!(output.sha256, sha256_hex(&bytes));
        assert_eq!(output.byte_length, bytes.len() as u64);
        assert!(!dir.path().join("result.json.tmp").exists());
        let parsed: AsrResult = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(parsed.outcome, Outcome::Transcribed);
    }
}
