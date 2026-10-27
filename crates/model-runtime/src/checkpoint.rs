//! 本机识别的转写检查点（架构设计 §6.6「取消与续跑」，Model Worker 协议规范 §2.5.1、§5）。
//!
//! Runtime 按任务的输入 hash 给出一个文件（`job.run` 的 `checkpoint`），Worker 每做完一份工作就追加一行；Worker 崩溃或
//! Runtime 重启之后，同一份输入的下一次尝试读回有效的前缀，已经做完的不再做。文件是 append-only 的 JSONL，首行是
//! `header`：格式版本与有效性的键（[`key`]：Worker 版本与构建、模型包与各组件的版本、输入、参数、影响结果的环境旋钮、
//! 解码出来的音频的摘要）。与这一次算出的不符就整份作废，重写成只有头的文件。之后的记录按跑法（[`Mode`]）分两套，一份文件
//! 只有一套（模型包在键里，一个模型包总是同一种跑法）：
//!
//! 自己切段的模型（MOSS）：
//!
//! 1. `chunk`：识别收下的一个初始分块（[`ChunkProgress`]），序号从 0 连续。
//! 2. `transcribed`：识别完成，全部的行、说话人区间与提示。之后不再读 `chunk`。
//! 3. `speakers`（要说话人且有说话人区间时）：跨块合并之后的行、区间与合并的结局。
//! 4. `aligned`：长行的强制对齐，一行一条（行号在识别或合并之后的行里、不重复）；`words` 为 null 表示对齐器没给出词。
//!    对齐器报错的行不记，续跑时再试一次，所以行号不一定递增。
//!
//! 流水线模型（Qwen3-ASR、Whisper）：
//!
//! 1. `vad`：VAD 切出的语音区间（补边之前），只有一条，在其余流水线记录之前。
//! 2. `recognized`：一个识别段的识别结果（段号是区间的下标，严格递增；样本窗为空的段不识别，没有记录）。
//! 3. `span-aligned`：对齐器给一个已识别段的词（相对识别区间起点的秒），每段至多一条。对齐器报错的段不记，续跑时再试一次，
//!    所以它可以出现在之后的段、甚至 `diarized` 之后。
//! 4. `diarized`：说话人区分给出的区间（相对解码起点的秒），只有一条。它只取决于音频与说话人区分的模型，与识别无关。
//!
//! 读到撕裂的末行（崩溃时常见）、乱序、重复、阶段跳跃或另一种跑法的记录就停在那里，之后的截掉。同一时间只有一个 Worker
//! 写一份检查点：打开时取得独占的文件锁，别的 Worker 正拿着它（同一份输入同时用两个模型包识别、Runtime 被杀之后旧的 Worker
//! 还没退出）就这次不用。检查点只省时间，从不决定结果：读写出错只在 stderr 记一句，这次不再写，任务照常进行。

use std::collections::BTreeMap;
use std::fs::{File, OpenOptions, TryLockError};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::WORKER_VERSION;
use crate::bundle::{VerifiedBundle, VerifiedFiles};
use crate::gpu_env;
use crate::protocol::{JobRunParams, LanguageRequest, TranscribeOptions};
use crate::speech::moss_parse::MossGenerationPlan;
use crate::speech::moss_speakers::{self, SpeakerMerge};
use crate::speech::pyannote_common::DiarizedSegment;
use crate::speech::segmenter::SpeechSpan;
use crate::speech::{AlignedWord, ChunkProgress, Recognition, RowIn, SpeakerRange};

/// 检查点的格式版本；格式变了就换一个，旧文件按键不符整份作废。流水线的记录是在这一版上加的：它们与自分段的记录不相交，
/// 加之前的 Worker 构建与之后的不同，读不到对方的文件（键不符）。
pub const SCHEMA: &str = "baocut.transcribe-checkpoint/1";

/// 有效性的键：下面这些都相同时，检查点里做完的工作与这一次要做的逐值相同（`sha256` 小写十六进制）。
///
/// - Worker：版本与可执行文件的大小、修改时间（同一版本号的开发构建换了代码也作废；VAD 的阈值、补边这些编进代码的常量
///   随之覆盖）；
/// - 模型包：ID、后端、设备、线程数与各组件的 family / revision；
/// - 输入：内容 hash、音轨、范围，以及解码出来的样本数与样本的 sha256（ffmpeg 换了版本解出不同的音频也作废）；
/// - 参数：能力、语言、`diarize`、`hint`、`timescale`；
/// - 影响结果的环境旋钮：是否关了 GPU（`BAOCUT_GPU`）、candle 的计算精度（`BAOCUT_CANDLE_DTYPE`）、MOSS 的量化位数、
///   分块时长与跨块说话人合并的阈值。
///
/// 不含 `jobId` 与 `runGeneration`：重试换了任务（`pipelines.retry`）或尝试，检查点照样有效。
pub fn key(params: &JobRunParams, options: &TranscribeOptions, bundle: &VerifiedBundle, samples: &[f32]) -> String {
    let component = |files: Option<&VerifiedFiles>| files.map(|files| json!({ "family": files.family, "revision": files.revision }));
    let language = match &options.language {
        LanguageRequest::Assert { tag } => json!({ "mode": "assert", "tag": tag }),
        LanguageRequest::Prefer { tag } => json!({ "mode": "prefer", "tag": tag }),
    };
    let range = params
        .input
        .range
        .map(|range| json!({ "start": range.start, "end": range.end, "timescale": range.timescale }));
    let material = json!({
        "schema": SCHEMA,
        "worker": { "version": WORKER_VERSION, "build": build_fingerprint() },
        "bundle": {
            "bundleId": bundle.bundle_id,
            "backend": bundle.backend,
            "device": bundle.device,
            "threads": bundle.threads,
            "asr": component(bundle.asr.as_ref()),
            "vad": component(bundle.vad.as_ref()),
            "aligner": component(bundle.aligner.as_ref()),
            "speaker": component(bundle.speaker.as_ref()),
            "segmentation": component(bundle.segmentation.as_ref()),
        },
        "input": {
            "contentHash": params.input.content_hash,
            "track": params.input.track,
            "range": range,
            "samples": samples.len(),
            "audioSha256": audio_digest(samples),
        },
        "options": {
            "capability": "transcribe",
            "language": language,
            "diarize": options.diarize,
            "hint": options.hint,
            "timescale": options.timescale,
        },
        "knobs": {
            "gpuDisabled": gpu_env::gpu_disabled_by_env(),
            // `backend::candle::weights::COMPUTE_DTYPE_ENV`（只在 candle 构建里）。
            "candleDtype": std::env::var("BAOCUT_CANDLE_DTYPE").ok(),
            "mossQuant": std::env::var("BCUT_MOSS_QUANT").or_else(|_| std::env::var("BAOCUT_MOSS_QUANT")).ok(),
            "mossChunkSeconds": MossGenerationPlan::chunk_duration_from_env(std::env::var("BCUT_MOSS_CHUNK_SECONDS").ok().as_deref()),
            "speakerMergeThreshold": moss_speakers::speaker_merge_threshold(),
        },
    });
    hex(&Sha256::digest(material.to_string().as_bytes()))
}

/// 检查点为哪种跑法记录：决定读回时认哪一套记录。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// 自己切段的模型（MOSS）：`chunk`、`transcribed`、`speakers`、`aligned`。
    SelfSegmenting,
    /// 流水线模型（VAD → 逐段识别、对齐 → 说话人区分）：`vad`、`recognized`、`span-aligned`、`diarized`。
    Pipeline,
}

/// 解码出来的音频（小端 f32）的 sha256。
fn audio_digest(samples: &[f32]) -> String {
    let mut hasher = Sha256::new();
    let mut buffer = Vec::with_capacity(64 * 1024 * 4);
    for block in samples.chunks(64 * 1024) {
        buffer.clear();
        buffer.extend(block.iter().flat_map(|sample| sample.to_le_bytes()));
        hasher.update(&buffer);
    }
    hex(&hasher.finalize())
}

/// 正在运行的 Worker 可执行文件的大小与修改时间；拿不到时为 null（只靠版本号）。
fn build_fingerprint() -> Value {
    let Ok(metadata) = std::env::current_exe().and_then(std::fs::metadata) else {
        return Value::Null;
    };
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_nanos().to_string());
    json!({ "bytes": metadata.len(), "modified": modified })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// 对齐器给一行或一段的词（相对行起点或识别区间起点的秒）。f32 存成 f64（精确），读回来再换回 f32，逐位不变。
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WordRecord {
    text: String,
    start: f64,
    end: f64,
}

fn word_records(words: &[AlignedWord]) -> Vec<WordRecord> {
    words
        .iter()
        .map(|word| WordRecord {
            text: word.text.clone(),
            start: f64::from(word.start),
            end: f64::from(word.end),
        })
        .collect()
}

fn aligned_words(records: Vec<WordRecord>) -> Vec<AlignedWord> {
    records
        .into_iter()
        .map(|word| AlignedWord {
            text: word.text,
            start: word.start as f32,
            end: word.end as f32,
        })
        .collect()
}

/// VAD 切出的一个语音区间（相对解码起点的秒，补边之前）。
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
struct SpanRecord {
    start: f64,
    end: f64,
}

/// 说话人区分给出的一个区间（相对解码起点的秒）。
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
struct RangeRecord {
    start: f64,
    end: f64,
    speaker: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum Record {
    #[serde(rename_all = "camelCase")]
    Header {
        schema: String,
        key: String,
        worker_version: String,
        bundle_id: String,
        content_hash: String,
    },
    Chunk(ChunkProgress),
    #[serde(rename_all = "camelCase")]
    Transcribed {
        rows: Vec<RowIn>,
        speaker_ranges: Vec<SpeakerRange>,
        warnings: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    Speakers {
        rows: Vec<RowIn>,
        speaker_ranges: Vec<SpeakerRange>,
        merge: SpeakerMerge,
    },
    Aligned {
        row: usize,
        words: Option<Vec<WordRecord>>,
    },
    Vad {
        spans: Vec<SpanRecord>,
    },
    #[serde(rename_all = "camelCase")]
    Recognized {
        span: usize,
        text: String,
        language_name: Option<String>,
        degenerate: bool,
    },
    SpanAligned {
        span: usize,
        words: Vec<WordRecord>,
    },
    Diarized {
        ranges: Vec<RangeRecord>,
    },
}

impl Record {
    /// 记录属于哪种跑法；头两种都有。
    fn mode(&self) -> Option<Mode> {
        match self {
            Self::Header { .. } => None,
            Self::Chunk(_) | Self::Transcribed { .. } | Self::Speakers { .. } | Self::Aligned { .. } => Some(Mode::SelfSegmenting),
            Self::Vad { .. } | Self::Recognized { .. } | Self::SpanAligned { .. } | Self::Diarized { .. } => Some(Mode::Pipeline),
        }
    }
}

/// 识别完成时的结果（`transcribed` 记录）。
#[derive(Debug, Clone, PartialEq)]
pub struct Transcribed {
    pub rows: Vec<RowIn>,
    pub speaker_ranges: Vec<SpeakerRange>,
    pub warnings: Vec<String>,
}

/// 跨块说话人合并之后的状态（`speakers` 记录）。
#[derive(Debug, Clone, PartialEq)]
pub struct MergedSpeakers {
    pub rows: Vec<RowIn>,
    pub speaker_ranges: Vec<SpeakerRange>,
    pub merge: SpeakerMerge,
}

/// 从检查点读回来、可以直接用的工作。
#[derive(Debug, Default)]
pub struct Restored {
    /// 识别还没有完成时，已经收下的初始分块。
    pub chunks: Vec<ChunkProgress>,
    pub transcribed: Option<Transcribed>,
    pub speakers: Option<MergedSpeakers>,
    /// 行号 → 对齐器给这一行的词；`None` 是这一行对不出来。
    pub aligned: BTreeMap<usize, Option<Vec<AlignedWord>>>,
    /// 流水线：VAD 切出的语音区间（补边之前）。
    pub spans: Option<Vec<SpeechSpan>>,
    /// 流水线：识别段的段号（区间的下标）→ 识别器给这一段的结果。
    pub recognized: BTreeMap<usize, Recognition>,
    /// 流水线：段号 → 对齐器给这一段的词（相对识别区间起点的秒）。
    pub span_aligned: BTreeMap<usize, Vec<AlignedWord>>,
    /// 流水线：说话人区分给出的区间。
    pub diarized: Option<Vec<DiarizedSegment>>,
}

impl Restored {
    pub fn is_empty(&self) -> bool {
        self.chunks.is_empty() && self.transcribed.is_none() && self.spans.is_none() && self.diarized.is_none()
    }
}

/// 读到哪一阶段（只能往后走）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Stage {
    Chunks,
    Transcribed,
    Speakers,
    Aligned,
}

/// 打开的检查点文件：持有独占锁，只在末尾追加；写出错之后不再写（同时放开锁）。
pub struct Checkpoint {
    path: PathBuf,
    file: Option<File>,
    mode: Mode,
    /// 头这一行之后的位置：分块记录从这里开始。
    after_header: u64,
    /// `transcribed` 这一行之后的位置；还没有时为 `None`。
    after_transcribed: Option<u64>,
    /// 下一条 `chunk` 记录应有的序号。
    next_chunk: usize,
    /// 文件里已经有 `aligned` 记录（`speakers` 要重做时截掉它们）。
    has_aligned: bool,
    /// 流水线：文件里最后一条 `recognized` 的段号（之后的只能更大）。
    last_recognized: Option<usize>,
}

impl Checkpoint {
    /// 打开 `path`：头与 `key` 相符时按 `mode` 读回有效的前缀并截掉之后的部分，否则整份重写成只有头的文件。打不开、
    /// 写不进去或别的 Worker 正拿着它时返回 `None`，这次不用检查点。
    pub fn open(path: &Path, key: &str, mode: Mode, params: &JobRunParams, bundle: &VerifiedBundle) -> Option<(Self, Restored)> {
        match Self::try_open(path, key, mode, params, bundle) {
            Ok(opened) => Some(opened),
            Err(error) => {
                eprintln!("[model-worker] cannot use the transcription checkpoint: {error}");
                None
            }
        }
    }

    fn try_open(path: &Path, key: &str, mode: Mode, params: &JobRunParams, bundle: &VerifiedBundle) -> std::io::Result<(Self, Restored)> {
        // 读写都走这一个句柄：Windows 的文件锁是强制的，别的句柄读不了锁住的文件；也不用追加模式，Windows 上追加模式的
        // 句柄截不短文件（`set_len` 要写数据的权限）。写之前定位到末尾（`write`）。
        let mut file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(path)?;
        match file.try_lock() {
            Ok(()) => {}
            Err(TryLockError::WouldBlock) => return Err(std::io::Error::other("another worker is using it")),
            Err(TryLockError::Error(error)) => return Err(error),
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        let mut checkpoint = Self {
            path: path.to_owned(),
            file: Some(file),
            mode,
            after_header: 0,
            after_transcribed: None,
            next_chunk: 0,
            has_aligned: false,
            last_recognized: None,
        };
        let (restored, valid) = match checkpoint.read(&bytes, key) {
            Some(read) => read,
            None => {
                if !bytes.is_empty() {
                    eprintln!(
                        "[model-worker] the transcription checkpoint is for other inputs, parameters, models or worker; starting over"
                    );
                }
                checkpoint.truncate(0)?;
                let header = Record::Header {
                    schema: SCHEMA.into(),
                    key: key.into(),
                    worker_version: WORKER_VERSION.into(),
                    bundle_id: bundle.bundle_id.clone(),
                    content_hash: params.input.content_hash.clone(),
                };
                checkpoint.after_header = checkpoint.write(&header)?;
                return Ok((checkpoint, Restored::default()));
            }
        };
        if valid < bytes.len() as u64 {
            eprintln!("[model-worker] the transcription checkpoint ends with an incomplete or out-of-order record; dropping it");
            checkpoint.truncate(valid)?;
        }
        Ok((checkpoint, restored))
    }

    /// 读回有效的前缀；头不符（或没有头）时返回 `None`。返回读回的工作与有效前缀的长度。
    fn read(&mut self, bytes: &[u8], key: &str) -> Option<(Restored, u64)> {
        let mut restored = Restored::default();
        let mut stage = Stage::Chunks;
        let mut offset = 0_usize;
        // 识别或合并之后的行数：`aligned` 的行号在它之内。
        let mut rows_count = 0;
        let mut header = false;
        while let Some(length) = bytes[offset..].iter().position(|byte| *byte == b'\n') {
            let end = offset + length + 1;
            let Ok(record) = serde_json::from_slice::<Record>(&bytes[offset..end - 1]) else {
                break;
            };
            let foreign = record.mode().is_some_and(|mode| mode != self.mode);
            let accepted = match record {
                Record::Header { schema, key: found, .. } if !header => {
                    if schema != SCHEMA || found != key {
                        return None;
                    }
                    header = true;
                    self.after_header = end as u64;
                    true
                }
                _ if !header => return None,
                Record::Header { .. } => false,
                // 另一种跑法的记录：不该出现在这一份里。
                _ if foreign => false,
                Record::Chunk(chunk) => {
                    let accepted = stage == Stage::Chunks && chunk.index == restored.chunks.len();
                    if accepted {
                        restored.chunks.push(chunk);
                    }
                    accepted
                }
                Record::Transcribed {
                    rows,
                    speaker_ranges,
                    warnings,
                } => {
                    let accepted = stage == Stage::Chunks;
                    if accepted {
                        stage = Stage::Transcribed;
                        rows_count = rows.len();
                        restored.chunks.clear();
                        restored.transcribed = Some(Transcribed {
                            rows,
                            speaker_ranges,
                            warnings,
                        });
                        self.after_transcribed = Some(end as u64);
                    }
                    accepted
                }
                Record::Speakers {
                    rows,
                    speaker_ranges,
                    merge,
                } => {
                    let accepted = stage == Stage::Transcribed;
                    if accepted {
                        stage = Stage::Speakers;
                        rows_count = rows.len();
                        restored.speakers = Some(MergedSpeakers {
                            rows,
                            speaker_ranges,
                            merge,
                        });
                    }
                    accepted
                }
                Record::Aligned { row, words } => {
                    let accepted = stage >= Stage::Transcribed && row < rows_count && !restored.aligned.contains_key(&row);
                    if accepted {
                        stage = Stage::Aligned;
                        restored.aligned.insert(row, words.map(aligned_words));
                        self.has_aligned = true;
                    }
                    accepted
                }
                Record::Vad { spans } => {
                    let accepted = restored.spans.is_none();
                    if accepted {
                        let spans = spans.into_iter().map(|span| SpeechSpan {
                            start: span.start,
                            end: span.end,
                        });
                        restored.spans = Some(spans.collect());
                    }
                    accepted
                }
                Record::Recognized {
                    span,
                    text,
                    language_name,
                    degenerate,
                } => {
                    let count = restored.spans.as_ref().map_or(0, Vec::len);
                    let accepted = span < count && self.last_recognized.is_none_or(|last| span > last);
                    if accepted {
                        self.last_recognized = Some(span);
                        let recognition = Recognition {
                            text,
                            language_name,
                            degenerate,
                        };
                        restored.recognized.insert(span, recognition);
                    }
                    accepted
                }
                Record::SpanAligned { span, words } => {
                    let accepted = restored.recognized.contains_key(&span) && !restored.span_aligned.contains_key(&span);
                    if accepted {
                        restored.span_aligned.insert(span, aligned_words(words));
                    }
                    accepted
                }
                Record::Diarized { ranges } => {
                    let accepted = restored.spans.is_some() && restored.diarized.is_none();
                    if accepted {
                        let ranges = ranges.into_iter().map(|range| DiarizedSegment {
                            start: range.start,
                            end: range.end,
                            speaker: range.speaker,
                        });
                        restored.diarized = Some(ranges.collect());
                    }
                    accepted
                }
            };
            if !accepted {
                break;
            }
            offset = end;
        }
        if !header {
            return None;
        }
        self.next_chunk = restored.chunks.len();
        Some((restored, offset as u64))
    }

    /// 识别收下了一个初始分块。序号不接着上次（识别器没有用上次的分块，从头生成了）时先截掉之前的分块记录。
    pub fn chunk(&mut self, chunk: &ChunkProgress) {
        if chunk.index != self.next_chunk {
            if chunk.index != 0 {
                self.fail("a chunk arrived out of order");
                return;
            }
            if let Err(error) = self.truncate(self.after_header) {
                self.fail(&error.to_string());
                return;
            }
        }
        self.next_chunk = chunk.index + 1;
        self.append(&Record::Chunk(chunk.clone()));
    }

    /// 识别完成。
    pub fn transcribed(&mut self, rows: &[RowIn], speaker_ranges: &[SpeakerRange], warnings: &[String]) {
        let end = self.append(&Record::Transcribed {
            rows: rows.to_vec(),
            speaker_ranges: speaker_ranges.to_vec(),
            warnings: warnings.to_vec(),
        });
        self.after_transcribed = end;
    }

    /// 跨块说话人合并完成。之前的 `aligned` 记录（没有合并就对齐过的）截掉：调用方也不该再用它们。
    pub fn speakers(&mut self, rows: &[RowIn], speaker_ranges: &[SpeakerRange], merge: &SpeakerMerge) {
        if self.has_aligned {
            let Some(after_transcribed) = self.after_transcribed else {
                self.fail("speakers arrived before the transcription");
                return;
            };
            if let Err(error) = self.truncate(after_transcribed) {
                self.fail(&error.to_string());
                return;
            }
            self.has_aligned = false;
        }
        self.append(&Record::Speakers {
            rows: rows.to_vec(),
            speaker_ranges: speaker_ranges.to_vec(),
            merge: merge.clone(),
        });
    }

    /// 第 `row` 行对齐完：`words` 是对齐器给的词，`None` 是对不出来。
    pub fn aligned(&mut self, row: usize, words: Option<&[AlignedWord]>) {
        let words = words.map(word_records);
        if self.append(&Record::Aligned { row, words }).is_some() {
            self.has_aligned = true;
        }
    }

    /// 流水线：VAD 切好了段（补边之前的语音区间）。
    pub fn vad(&mut self, spans: &[SpeechSpan]) {
        let spans = spans
            .iter()
            .map(|span| SpanRecord {
                start: span.start,
                end: span.end,
            })
            .collect();
        self.append(&Record::Vad { spans });
    }

    /// 流水线：第 `span` 段识别完。段号只能比上一条大（识别按区间的顺序做，续跑时跳过已经识别过的段）。
    pub fn recognized(&mut self, span: usize, recognition: &Recognition) {
        if self.last_recognized.is_some_and(|last| span <= last) {
            self.fail("a recognized segment arrived out of order");
            return;
        }
        let record = Record::Recognized {
            span,
            text: recognition.text.clone(),
            language_name: recognition.language_name.clone(),
            degenerate: recognition.degenerate,
        };
        if self.append(&record).is_some() {
            self.last_recognized = Some(span);
        }
    }

    /// 流水线：对齐器给第 `span` 段的词（相对识别区间起点的秒；空的也记：对齐器没给出词）。
    pub fn span_aligned(&mut self, span: usize, words: &[AlignedWord]) {
        let words = word_records(words);
        self.append(&Record::SpanAligned { span, words });
    }

    /// 流水线：说话人区分给出的区间。
    pub fn diarized(&mut self, segments: &[DiarizedSegment]) {
        let ranges = segments
            .iter()
            .map(|segment| RangeRecord {
                start: segment.start,
                end: segment.end,
                speaker: segment.speaker,
            })
            .collect();
        self.append(&Record::Diarized { ranges });
    }

    /// 追加一行并落盘；返回追加之后的文件长度。出错时记一句，之后不再写。
    fn append(&mut self, record: &Record) -> Option<u64> {
        self.file.as_ref()?;
        match self.write(record) {
            Ok(end) => Some(end),
            Err(error) => {
                self.fail(&error.to_string());
                None
            }
        }
    }

    fn write(&mut self, record: &Record) -> std::io::Result<u64> {
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("the checkpoint is closed"))?;
        let mut line = serde_json::to_vec(record).map_err(std::io::Error::other)?;
        line.push(b'\n');
        file.seek(SeekFrom::End(0))?;
        file.write_all(&line)?;
        file.sync_data()?;
        file.stream_position()
    }

    fn truncate(&mut self, length: u64) -> std::io::Result<()> {
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("the checkpoint is closed"))?;
        file.set_len(length)?;
        file.sync_data()
    }

    fn fail(&mut self, detail: &str) {
        if let Some(file) = self.file.take() {
            let _ = file.unlock();
            eprintln!(
                "[model-worker] stopped writing the transcription checkpoint {}: {detail}",
                self.path.display()
            );
        }
    }
}

impl Drop for Checkpoint {
    /// 先显式解锁再关闭：锁挂在打开的文件描述上，同一进程里正在起的子进程手里的副本会让它多留一会儿（同视频目录的写锁）。
    fn drop(&mut self) {
        if let Some(file) = &self.file {
            let _ = file.unlock();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aligned_word_times_survive_the_round_trip_bit_for_bit() {
        let word = AlignedWord {
            text: "x".into(),
            start: 0.1 + f32::EPSILON,
            end: 1.0 / 3.0,
        };
        let record = Record::Aligned {
            row: 3,
            words: Some(vec![WordRecord {
                text: word.text.clone(),
                start: f64::from(word.start),
                end: f64::from(word.end),
            }]),
        };
        let Record::Aligned { words: Some(words), .. } = serde_json::from_slice(&serde_json::to_vec(&record).unwrap()).unwrap() else {
            panic!("not an aligned record");
        };
        assert_eq!((words[0].start as f32).to_bits(), word.start.to_bits());
        assert_eq!((words[0].end as f32).to_bits(), word.end.to_bits());
    }
}
