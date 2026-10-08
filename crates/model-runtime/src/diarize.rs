//! `job.run`（capability `diarize`）的编排（Model Worker 协议规范 §2.5.5）：给一份已有转写的词区分说话人，不重新识别。
//!
//! 阶段：`decoding`（素材的一段解成 16 kHz 单声道，进度按秒）→ `diarizing`（Pyannote 分段 + WeSpeaker 声纹聚类，
//! `job.progress` 的单位是 `steps`）→ `finalizing`（区间投影到词、编号、写 `speakers.json`）。
//!
//! 与转写里的说话人区分（架构设计 §6.6 第 7 步）同一套：聚类阈值 [`DEFAULT_MERGE_THRESHOLD`]、不限人数，区间按
//! [`project_speaker_clusters`] 投影到词（v2 `bcut speakers reidentify` 的「balanced」）；说话人按在时间上第一次出现
//! 的次序编号 `spk-1`、`spk-2`…，一个词都没分到的排在后面。取消：解码与聚类里都看取消标志；取消的结果
//! `outcome: 'cancelled'`，不写输出。

use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use serde_json::{Value, json};

use crate::asr_result::sha256_hex;
use crate::audio::{self, DecodeError, DecodeRange, DecodeRequest, PcmFile};
use crate::bundle::{VerifiedBundle, VerifiedFiles};
use crate::protocol::{
    DiarizeRunParams, DiarizeRunResult, DiarizeStats, ErrorBody, JobOutcome, OutputFile, SPEAKERS_OUTPUT_CONTRACT, SPEAKERS_OUTPUT_FILE,
    codes,
};
use crate::speech::SpeakerDiarization;
use crate::speech::SpeakerRange;
use crate::speech::pyannote_common::{DEFAULT_MERGE_THRESHOLD, PyannoteCallbacks, PyannoteCancelled, PyannoteOptions};
use crate::speech::speaker_projection::project_speaker_clusters;
use crate::ticks::{seconds_to_ticks, ticks_to_seconds};
use crate::transcribe::JobSink;
use crate::{SAMPLE_RATE, WORKER_VERSION};

/// 跑一个说话人区分任务。返回的错误就是该请求的错误响应。
pub fn run(
    diarizer: &mut dyn SpeakerDiarization,
    bundle: &VerifiedBundle,
    params: &DiarizeRunParams,
    cancel: &AtomicBool,
    sink: &mut dyn JobSink,
) -> Result<DiarizeRunResult, ErrorBody> {
    params.validate()?;
    let staging = Path::new(&params.staging);
    if !staging.is_dir() {
        return Err(ErrorBody::invalid_params("staging must be an existing absolute directory"));
    }
    let job_id = params.job_id.as_str();
    let mut stats = DiarizeStats::default();
    let cancelled = |stats: DiarizeStats| DiarizeRunResult {
        outcome: JobOutcome::Cancelled,
        output: None,
        speakers: 0,
        stats,
    };
    let (offset, length) = match params.input.range {
        None => (0.0, None),
        Some(range) => {
            let start = ticks_to_seconds(range.start, range.timescale);
            (start, Some(ticks_to_seconds(range.end, range.timescale) - start))
        }
    };

    // ---- 解码 ----
    phase(sink, job_id, "decoding");
    let started = Instant::now();
    let audio_path = staging.join(audio::AUDIO_FILE);
    let request = DecodeRequest {
        file: Path::new(&params.input.file),
        track: params.input.track,
        range: DecodeRange {
            start: offset,
            duration: length,
        },
    };
    let decoded = {
        let job = job_id.to_owned();
        audio::decode_to_file(&request, &audio_path, &|| cancel.load(Ordering::SeqCst), &mut |seconds| {
            sink.event(
                "job.progress",
                json!({ "jobId": job, "phase": "decoding", "done": seconds, "total": length, "unit": "seconds" }),
            );
        })
    };
    stats.decode_ms = started.elapsed().as_millis() as u64;
    match decoded {
        Ok(_) => {}
        Err(DecodeError::Cancelled) => return Ok(cancelled(stats)),
        Err(error) => return Err(decode_error(error)),
    }
    let pcm = PcmFile::open(&audio_path).map_err(|error| {
        eprintln!("[model-worker] cannot map decoded audio: {error}");
        ErrorBody::new(codes::DECODE_FAILED, "the decoded audio cannot be read back")
    })?;
    let samples = pcm.samples();
    if cancel.load(Ordering::SeqCst) {
        return Ok(cancelled(stats));
    }

    // ---- 说话人区分 ----
    phase(sink, job_id, "diarizing");
    let started = Instant::now();
    let segments = if samples.is_empty() {
        Ok(Vec::new())
    } else {
        let job = job_id.to_owned();
        let mut on_progress = |done: f64, total: f64| {
            sink.event(
                "job.progress",
                json!({ "jobId": job, "phase": "diarizing", "done": done, "total": total, "unit": "steps" }),
            );
        };
        let mut should_cancel = || cancel.load(Ordering::SeqCst);
        let options = PyannoteOptions {
            max_speakers: None,
            clustering_threshold: DEFAULT_MERGE_THRESHOLD.clamp(0.01, 1.99),
        };
        let mut callbacks = PyannoteCallbacks {
            on_progress: Some(&mut on_progress),
            should_cancel: Some(&mut should_cancel),
        };
        diarizer.diarize(samples, &options, &mut callbacks)
    };
    stats.diarize_ms = started.elapsed().as_millis() as u64;
    let ranges: Vec<SpeakerRange> = match segments {
        Ok(segments) => segments
            .into_iter()
            .map(|segment| SpeakerRange {
                start: segment.start,
                end: segment.end,
                cluster: segment.speaker,
                chunk: 0,
            })
            .collect(),
        Err(error) if error.downcast_ref::<PyannoteCancelled>().is_some() => return Ok(cancelled(stats)),
        Err(error) => return Err(inference_failed(&error)),
    };
    drop(pcm);
    let _ = std::fs::remove_file(&audio_path);
    if cancel.load(Ordering::SeqCst) {
        return Ok(cancelled(stats));
    }

    // ---- 投影、编号、写出 ----
    phase(sink, job_id, "finalizing");
    let timescale = params.options.timescale;
    let spans: Vec<(f64, f64)> = params
        .options
        .words
        .iter()
        .map(|[start, end]| {
            (
                ticks_to_seconds(*start, timescale) - offset,
                ticks_to_seconds(*end, timescale) - offset,
            )
        })
        .collect();
    let projected = project_speaker_clusters(&spans, &ranges);
    let order = cluster_order(&projected, &ranges);
    let id_of = |cluster: usize| {
        order
            .iter()
            .position(|known| *known == cluster)
            .map(|index| format!("spk-{}", index + 1))
    };
    let words: Vec<Option<String>> = projected.iter().map(|cluster| cluster.and_then(id_of)).collect();
    let speakers: Vec<Value> = order
        .iter()
        .enumerate()
        .map(|(index, cluster)| {
            let id = format!("spk-{}", index + 1);
            let count = words.iter().filter(|word| word.as_deref() == Some(id.as_str())).count();
            let seconds: f64 = ranges
                .iter()
                .filter(|range| range.cluster == *cluster)
                .map(|range| (range.end - range.start).max(0.0))
                .sum();
            json!({ "id": id, "words": count, "seconds": round_millis(seconds) })
        })
        .collect();
    let to_ticks = |seconds: f64| seconds_to_ticks((seconds + offset).max(0.0), timescale);
    let range_values: Vec<Value> = ranges
        .iter()
        .filter_map(|range| {
            let speaker = id_of(range.cluster)?;
            Some(json!({ "start": to_ticks(range.start), "end": to_ticks(range.end), "speaker": speaker }))
        })
        .collect();
    let document = json!({
        "schema": SPEAKERS_OUTPUT_CONTRACT,
        "clock": "source-asset",
        "timescale": timescale,
        "speakers": speakers,
        "ranges": range_values,
        "words": words,
        "provenance": {
            "provider": "local",
            "bundleId": bundle.bundle_id,
            "backend": bundle.backend,
            "device": bundle.device,
            "workerVersion": WORKER_VERSION,
            "inputHash": params.input.content_hash,
            "runGeneration": params.run_generation,
            "models": {
                "segmentation": model_ref(bundle.segmentation.as_ref()),
                "speaker": model_ref(bundle.speaker.as_ref()),
            },
            "threshold": DEFAULT_MERGE_THRESHOLD,
            "sampleRate": SAMPLE_RATE,
        },
    });
    let bytes = serde_json::to_vec(&document).map_err(|error| write_failed(&error.to_string()))?;
    let output = write_output(staging, &bytes).map_err(|error| write_failed(&error.to_string()))?;
    Ok(DiarizeRunResult {
        outcome: JobOutcome::Completed,
        output: Some(output),
        speakers: order.len(),
        stats,
    })
}

/// 簇的编号次序：按投影后第一次出现在词上的次序；一个词都没分到的簇排在后面，按最早的区间（与转写的说话人编号
/// 同一条规则）。
pub fn cluster_order(projected: &[Option<usize>], ranges: &[SpeakerRange]) -> Vec<usize> {
    let mut order: Vec<usize> = Vec::new();
    for cluster in projected.iter().flatten() {
        if !order.contains(cluster) {
            order.push(*cluster);
        }
    }
    let mut silent: Vec<(f64, usize)> = Vec::new();
    for range in ranges {
        if order.contains(&range.cluster) {
            continue;
        }
        match silent.iter_mut().find(|(_, cluster)| *cluster == range.cluster) {
            Some(entry) => entry.0 = entry.0.min(range.start),
            None => silent.push((range.start, range.cluster)),
        }
    }
    silent.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    order.extend(silent.into_iter().map(|(_, cluster)| cluster));
    order
}

fn round_millis(seconds: f64) -> f64 {
    (seconds * 1000.0).round() / 1000.0
}

fn model_ref(files: Option<&VerifiedFiles>) -> Value {
    match files {
        Some(files) => json!({ "family": files.family, "revision": files.revision }),
        None => Value::Null,
    }
}

fn decode_error(error: DecodeError) -> ErrorBody {
    match error {
        DecodeError::NoAudioTrack => {
            ErrorBody::new(codes::INPUT_UNREADABLE, "the input has no such audio track").with_details(json!({ "reason": "no-audio-track" }))
        }
        DecodeError::InputUnreadable(detail) => {
            eprintln!("[model-worker] input unreadable: {detail}");
            ErrorBody::new(codes::INPUT_UNREADABLE, "the input file cannot be read or demuxed")
        }
        // 调用方先处理了取消。
        DecodeError::Cancelled => ErrorBody::new(codes::INPUT_UNREADABLE, "the input file cannot be read or demuxed"),
        DecodeError::DecodeFailed(detail) => {
            eprintln!("[model-worker] decode failed: {detail}");
            ErrorBody::new(codes::DECODE_FAILED, "audio decoding failed")
        }
    }
}

fn inference_failed(error: &anyhow::Error) -> ErrorBody {
    if let Some(body) = error.downcast_ref::<ErrorBody>() {
        return body.clone();
    }
    eprintln!("[model-worker] speaker diarization failed: {error:#}");
    ErrorBody::new(codes::INFERENCE_FAILED, "speaker diarization failed").with_details(json!({ "reason": "diarization-failed" }))
}

fn write_failed(detail: &str) -> ErrorBody {
    eprintln!("[model-worker] writing {SPEAKERS_OUTPUT_FILE} failed: {detail}");
    ErrorBody::new(codes::OUTPUT_WRITE_FAILED, format!("could not write {SPEAKERS_OUTPUT_FILE}"))
        .with_details(json!({ "file": SPEAKERS_OUTPUT_FILE }))
}

/// 先写临时文件再重命名。路径是绝对路径（staging 是绝对路径）。
fn write_output(staging: &Path, bytes: &[u8]) -> std::io::Result<OutputFile> {
    let path = staging.join(SPEAKERS_OUTPUT_FILE);
    let temporary = staging.join(format!("{SPEAKERS_OUTPUT_FILE}.tmp"));
    {
        let mut file = File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    std::fs::rename(&temporary, &path)?;
    Ok(OutputFile {
        path: path.to_string_lossy().into_owned(),
        sha256: sha256_hex(bytes),
        byte_length: bytes.len() as u64,
    })
}

fn phase(sink: &mut dyn JobSink, job_id: &str, phase: &str) {
    sink.event("job.phase", json!({ "jobId": job_id, "phase": phase }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{Capability, DiarizeInput, DiarizeOptions};
    use crate::speech::pyannote_common::DiarizedSegment;
    use anyhow::bail;

    /// 假模型：前一半时间是簇 7，后一半是簇 3；`fail` 时报错，`cancel` 时中途要求取消。
    struct FakeDiarizer {
        fail: bool,
        cancel: Option<&'static AtomicBool>,
    }

    impl SpeakerDiarization for FakeDiarizer {
        fn diarize(
            &mut self,
            samples: &[f32],
            _options: &PyannoteOptions,
            callbacks: &mut PyannoteCallbacks<'_>,
        ) -> anyhow::Result<Vec<DiarizedSegment>> {
            if self.fail {
                bail!("权重坏了：/secret/path/segmentation.safetensors");
            }
            if let Some(progress) = callbacks.on_progress.as_mut() {
                progress(1.0, 2.0);
            }
            if let Some(flag) = self.cancel {
                flag.store(true, Ordering::SeqCst);
                if callbacks.should_cancel.as_mut().is_some_and(|cancel| cancel()) {
                    return Err(anyhow::Error::new(PyannoteCancelled));
                }
            }
            let seconds = samples.len() as f64 / f64::from(SAMPLE_RATE);
            Ok(vec![
                DiarizedSegment {
                    start: 0.0,
                    end: seconds / 2.0,
                    speaker: 7,
                },
                DiarizedSegment {
                    start: seconds / 2.0,
                    end: seconds,
                    speaker: 3,
                },
            ])
        }
    }

    #[derive(Default)]
    struct Events(Vec<(String, Value)>);

    impl JobSink for Events {
        fn event(&mut self, name: &str, params: Value) {
            self.0.push((name.to_owned(), params));
        }
    }

    fn bundle() -> VerifiedBundle {
        VerifiedBundle {
            bundle_id: "speaker-diarization@mlx".into(),
            backend: "mlx".into(),
            device: "metal".into(),
            threads: 1,
            memory_budget_bytes: None,
            asr: None,
            vad: None,
            aligner: None,
            speaker: None,
            segmentation: None,
            tokenizer: None,
            tts: None,
            codec: None,
            aux: None,
            separator: None,
            image: None,
        }
    }

    /// 4 秒 16 kHz 的正弦波 WAV。
    fn write_wav(dir: &Path) -> String {
        let rate = 16_000u32;
        let samples: Vec<i16> = (0..rate * 4)
            .map(|i| ((i as f32 * 440.0 * std::f32::consts::TAU / rate as f32).sin() * 8000.0) as i16)
            .collect();
        let mut bytes = Vec::new();
        let data_len = (samples.len() * 2) as u32;
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&rate.to_le_bytes());
        bytes.extend_from_slice(&(rate * 2).to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        let path = dir.join("input.wav");
        std::fs::write(&path, bytes).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn params(dir: &Path, words: Vec<[u64; 2]>) -> DiarizeRunParams {
        let staging = dir.join("staging");
        std::fs::create_dir_all(&staging).unwrap();
        DiarizeRunParams {
            job_id: "job-1".into(),
            run_generation: 1,
            capability: Capability::Diarize,
            input: DiarizeInput {
                file: write_wav(dir),
                content_hash: "sha256:abc".into(),
                track: 0,
                range: None,
            },
            options: DiarizeOptions { timescale: 1000, words },
            staging: staging.to_string_lossy().into_owned(),
            output_contract: SPEAKERS_OUTPUT_CONTRACT.into(),
        }
    }

    #[test]
    fn projects_ranges_onto_words_and_numbers_by_first_appearance() {
        let dir = tempfile::tempdir().unwrap();
        let params = params(dir.path(), vec![[100, 600], [700, 1500], [2200, 2800], [3000, 3900]]);
        let mut events = Events::default();
        let cancel = AtomicBool::new(false);
        let mut fake = FakeDiarizer { fail: false, cancel: None };
        let result = run(&mut fake, &bundle(), &params, &cancel, &mut events).unwrap();
        assert_eq!(result.outcome, JobOutcome::Completed);
        assert_eq!(result.speakers, 2);
        let output = result.output.unwrap();
        let bytes = std::fs::read(&output.path).unwrap();
        assert_eq!(output.sha256, sha256_hex(&bytes));
        let parsed: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(parsed["schema"], SPEAKERS_OUTPUT_CONTRACT);
        assert_eq!(parsed["words"], json!(["spk-1", "spk-1", "spk-2", "spk-2"]));
        assert_eq!(parsed["speakers"][0]["id"], "spk-1");
        assert_eq!(parsed["speakers"][0]["words"], 2);
        assert_eq!(parsed["speakers"][1]["seconds"], 2.0);
        assert_eq!(parsed["ranges"][1], json!({ "start": 2000, "end": 4000, "speaker": "spk-2" }));
        assert_eq!(parsed["provenance"]["bundleId"], "speaker-diarization@mlx");
        let phases: Vec<&str> = events
            .0
            .iter()
            .filter(|(name, _)| name == "job.phase")
            .filter_map(|(_, params)| params["phase"].as_str())
            .collect();
        assert_eq!(phases, ["decoding", "diarizing", "finalizing"]);
        assert!(
            events
                .0
                .iter()
                .any(|(name, params)| name == "job.progress" && params["unit"] == "steps")
        );
        assert!(!Path::new(&params.staging).join(audio::AUDIO_FILE).exists());
    }

    #[test]
    fn range_offsets_words_and_ranges_into_source_time() {
        let dir = tempfile::tempdir().unwrap();
        let mut params = params(dir.path(), vec![[1100, 1400], [2600, 2900]]);
        params.input.range = Some(crate::protocol::DiarizeRange {
            start: 1000,
            end: 3000,
            timescale: 1000,
        });
        let mut fake = FakeDiarizer { fail: false, cancel: None };
        let result = run(&mut fake, &bundle(), &params, &AtomicBool::new(false), &mut Events::default()).unwrap();
        let parsed: Value = serde_json::from_slice(&std::fs::read(result.output.unwrap().path).unwrap()).unwrap();
        assert_eq!(parsed["words"], json!(["spk-1", "spk-2"]));
        assert_eq!(parsed["ranges"][0], json!({ "start": 1000, "end": 2000, "speaker": "spk-1" }));
        assert_eq!(parsed["ranges"][1], json!({ "start": 2000, "end": 3000, "speaker": "spk-2" }));
    }

    #[test]
    fn model_failure_is_inference_failed_without_paths() {
        let dir = tempfile::tempdir().unwrap();
        let params = params(dir.path(), vec![[0, 500]]);
        let mut fake = FakeDiarizer { fail: true, cancel: None };
        let error = run(&mut fake, &bundle(), &params, &AtomicBool::new(false), &mut Events::default()).unwrap_err();
        assert_eq!(error.code, codes::INFERENCE_FAILED);
        assert!(!error.message.contains("/secret"));
    }

    #[test]
    fn cancel_during_clustering_writes_nothing() {
        static FLAG: AtomicBool = AtomicBool::new(false);
        let dir = tempfile::tempdir().unwrap();
        let params = params(dir.path(), vec![[0, 500]]);
        let mut fake = FakeDiarizer {
            fail: false,
            cancel: Some(&FLAG),
        };
        let result = run(&mut fake, &bundle(), &params, &FLAG, &mut Events::default()).unwrap();
        assert_eq!(result.outcome, JobOutcome::Cancelled);
        assert!(result.output.is_none());
        assert!(!Path::new(&params.staging).join(SPEAKERS_OUTPUT_FILE).exists());
    }

    #[test]
    fn rejects_bad_params() {
        let dir = tempfile::tempdir().unwrap();
        let mut bad = params(dir.path(), vec![[500, 100]]);
        let mut fake = FakeDiarizer { fail: false, cancel: None };
        let error = run(&mut fake, &bundle(), &bad, &AtomicBool::new(false), &mut Events::default()).unwrap_err();
        assert_eq!(error.code, codes::INVALID_PARAMS);
        bad.options.words = vec![[0, 100]];
        bad.output_contract = "baocut.asr-result/v1".into();
        assert_eq!(bad.validate().unwrap_err().code, codes::INVALID_PARAMS);
    }

    #[test]
    fn silent_clusters_go_last_by_earliest_range() {
        let ranges = [
            SpeakerRange {
                start: 5.0,
                end: 6.0,
                cluster: 9,
                chunk: 0,
            },
            SpeakerRange {
                start: 1.0,
                end: 2.0,
                cluster: 4,
                chunk: 0,
            },
            SpeakerRange {
                start: 0.0,
                end: 1.0,
                cluster: 2,
                chunk: 0,
            },
        ];
        assert_eq!(cluster_order(&[None, Some(9), Some(9)], &ranges), [9, 2, 4]);
    }
}
