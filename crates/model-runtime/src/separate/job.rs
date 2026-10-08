//! `job.run`（capability `separate`）的编排（Model Worker 协议规范 §2.5.4）：整段输入解成立体声 → 分离 →
//! `vocals.wav` 与 `background.wav`（`baocut.stems-wav/v1`）。
//!
//! 阶段：`decoding`（整段解进内存；WAV 保留原采样率，其他格式经 ffmpeg 解成模型的工作采样率）→ `separating`
//! （`job.progress` 的 `steps` 是「窗口 × 子模型」：开始时报 `0/n`，每跑完一个窗口报一次）→ `encoding`
//! （两路换算到 `options.sampleRate`，写 16-bit PCM 立体声 WAV）。背景声是鼓、贝斯与其他三路之和。
//! 取消：每个窗口之后看一次取消标志，回 `false` 让模型在下一个窗口前返回；之后结果是 `outcome: 'cancelled'`，不写输出。
//! 输出写不进 staging 是 `OUTPUT_WRITE_FAILED`（`details.file`），与模型本身的失败（`INFERENCE_FAILED`）分开。

use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use serde_json::json;

use super::resample::resample;
use super::types::{SeparationProgress, StereoAudio};
use super::{Separator, wav};
use crate::asr_result::sha256_hex;
use crate::audio::{self, DecodeError};
use crate::protocol::{
    BACKGROUND_OUTPUT_FILE, ErrorBody, JobOutcome, OutputFile, SeparateRunParams, SeparateRunResult, SeparateStats, SeparatedAudio,
    SeparatedFiles, VOCALS_OUTPUT_FILE, codes,
};
use crate::transcribe::JobSink;

/// 跑一个分离任务。返回的错误就是该请求的错误响应。
pub fn run(
    separator: &mut dyn Separator,
    params: &SeparateRunParams,
    cancel: &AtomicBool,
    sink: &mut dyn JobSink,
) -> Result<SeparateRunResult, ErrorBody> {
    params.validate()?;
    let staging = Path::new(&params.staging);
    if !staging.is_dir() {
        return Err(ErrorBody::invalid_params("staging must be an existing absolute directory"));
    }
    let job_id = params.job_id.as_str();
    let model_rate = separator.sample_rate();
    let mut stats = SeparateStats::default();
    let cancelled = |stats: SeparateStats| SeparateRunResult {
        outcome: JobOutcome::Cancelled,
        stems: None,
        audio: None,
        stats,
    };

    phase(sink, job_id, "decoding");
    let started = Instant::now();
    let decoded = audio::decode_stereo(Path::new(&params.input.file), params.input.track, model_rate);
    stats.decode_ms = started.elapsed().as_millis() as u64;
    let pcm = decoded.map_err(decode_error)?;
    let target_rate = params.options.sample_rate.unwrap_or(model_rate);
    let mix = StereoAudio {
        left: pcm.left,
        right: pcm.right,
        sample_rate: pcm.sample_rate,
    };
    // 输入在目标采样率上的长度：两路输出按它对齐（重采样的取整差不超过一两个样本）。
    let expected_len = ((mix.len() as f64) * f64::from(target_rate) / f64::from(mix.sample_rate)).round() as usize;
    if cancel.load(Ordering::SeqCst) {
        return Ok(cancelled(stats));
    }

    phase(sink, job_id, "separating");
    let started = Instant::now();
    let mut stopped = false;
    let separated = {
        let mut on_progress = |progress: SeparationProgress| -> bool {
            if cancel.load(Ordering::SeqCst) {
                stopped = true;
                return false;
            }
            if let SeparationProgress::Window { done, total } = progress {
                sink.event(
                    "job.progress",
                    json!({ "jobId": job_id, "phase": "separating", "done": done, "total": total, "unit": "steps" }),
                );
            }
            true
        };
        separator.separate(&mix, &mut on_progress)
    };
    stats.separation_ms = started.elapsed().as_millis() as u64;
    drop(mix);
    let stems = match separated {
        _ if stopped || cancel.load(Ordering::SeqCst) => return Ok(cancelled(stats)),
        Ok(stems) => stems,
        Err(error) => return Err(inference_failed(&error)),
    };
    if stems.vocals.is_empty() {
        return Err(ErrorBody::new(codes::INFERENCE_FAILED, "the model produced no audio").with_details(json!({ "reason": "empty-audio" })));
    }

    phase(sink, job_id, "encoding");
    let started = Instant::now();
    let background = stems.background();
    let vocals = to_rate(stems.vocals, target_rate, expected_len);
    let background = to_rate(background, target_rate, expected_len);
    let write = |name: &str, audio: &StereoAudio| {
        let bytes = wav::encode_wav_stereo_pcm16(audio).map_err(|error| write_failed(name, &error.to_string()))?;
        write_output(staging, name, &bytes).map_err(|error| write_failed(name, &error.to_string()))
    };
    let files = SeparatedFiles {
        vocals: write(VOCALS_OUTPUT_FILE, &vocals)?,
        background: write(BACKGROUND_OUTPUT_FILE, &background)?,
    };
    stats.encode_ms = started.elapsed().as_millis() as u64;
    Ok(SeparateRunResult {
        outcome: JobOutcome::Completed,
        stems: Some(files),
        audio: Some(SeparatedAudio {
            sample_rate: target_rate,
            channels: 2,
            duration_sec: vocals.duration_seconds(),
        }),
        stats,
    })
}

/// 换算到 `rate`，再补零或截到 `len`（重采样的取整让长度差一两个样本）。
fn to_rate(audio: StereoAudio, rate: u32, len: usize) -> StereoAudio {
    let fit = |channel: Vec<f32>| {
        let mut channel = if audio.sample_rate == rate {
            channel
        } else {
            resample(&channel, audio.sample_rate, rate)
        };
        channel.resize(len, 0.0);
        channel
    };
    StereoAudio {
        left: fit(audio.left),
        right: fit(audio.right),
        sample_rate: rate,
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
        // 整段解进内存的路径不看取消标志，走不到这里。
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
    eprintln!("[model-worker] separation failed: {error:#}");
    ErrorBody::new(codes::INFERENCE_FAILED, "audio separation failed").with_details(json!({ "reason": "separation-failed" }))
}

fn write_failed(name: &str, detail: &str) -> ErrorBody {
    eprintln!("[model-worker] writing {name} failed: {detail}");
    ErrorBody::new(codes::OUTPUT_WRITE_FAILED, format!("could not write {name}")).with_details(json!({ "file": name }))
}

/// 先写临时文件再重命名。路径是绝对路径（staging 是绝对路径）。
fn write_output(staging: &Path, name: &str, bytes: &[u8]) -> std::io::Result<OutputFile> {
    let path = staging.join(name);
    let temporary = staging.join(format!("{name}.tmp"));
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
    use crate::protocol::{Capability, STEMS_OUTPUT_CONTRACT, SeparateInput, SeparateOptions};
    use crate::separate::{ProgressSink, SeparatedStems};
    use anyhow::bail;
    use serde_json::Value;

    /// 假模型：44.1 kHz；人声 = 混音的一半，鼓 / 贝斯 / 其他各取剩下的三分之一。`windows` 个窗口 × 4 个子模型。
    struct FakeSeparator {
        windows: usize,
        fail: bool,
        cancel_after: Option<(usize, &'static AtomicBool)>,
    }

    impl Separator for FakeSeparator {
        fn sample_rate(&self) -> u32 {
            44_100
        }

        fn separate(&mut self, mix: &StereoAudio, progress: ProgressSink<'_>) -> anyhow::Result<SeparatedStems> {
            if self.fail {
                bail!("权重坏了：/secret/path/htdemucs_ft.safetensors");
            }
            let mix = StereoAudio {
                left: resample(&mix.left, mix.sample_rate, 44_100),
                right: resample(&mix.right, mix.sample_rate, 44_100),
                sample_rate: 44_100,
            };
            let total = self.windows * 4;
            if !progress(SeparationProgress::Window { done: 0, total }) {
                bail!("已取消");
            }
            for done in 1..=total {
                if let Some((after, flag)) = self.cancel_after
                    && done > after
                {
                    flag.store(true, Ordering::SeqCst);
                }
                if !progress(SeparationProgress::Window { done, total }) {
                    bail!("已取消");
                }
            }
            let scale = |audio: &StereoAudio, k: f32| StereoAudio {
                left: audio.left.iter().map(|v| v * k).collect(),
                right: audio.right.iter().map(|v| v * k).collect(),
                sample_rate: audio.sample_rate,
            };
            Ok(SeparatedStems {
                vocals: scale(&mix, 0.5),
                drums: scale(&mix, 0.5 / 3.0),
                bass: scale(&mix, 0.5 / 3.0),
                other: scale(&mix, 0.5 / 3.0),
            })
        }
    }

    fn fake() -> FakeSeparator {
        FakeSeparator {
            windows: 2,
            fail: false,
            cancel_after: None,
        }
    }

    #[derive(Default)]
    struct Events(Vec<(String, Value)>);

    impl JobSink for Events {
        fn event(&mut self, name: &str, params: Value) {
            self.0.push((name.to_owned(), params));
        }
    }

    impl Events {
        fn phases(&self) -> Vec<&str> {
            self.0
                .iter()
                .filter(|(name, _)| name == "job.phase")
                .map(|(_, params)| params["phase"].as_str().unwrap())
                .collect()
        }
    }

    /// 48 kHz 立体声 0.5 秒：左 0.4、右 -0.2 的直流。
    fn input_wav(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("input.wav");
        let audio = StereoAudio {
            left: vec![0.4; 24_000],
            right: vec![-0.2; 24_000],
            sample_rate: 48_000,
        };
        wav::write_wav_stereo_pcm16(&path, &audio).unwrap();
        path
    }

    fn params(file: &Path, staging: &Path, sample_rate: Option<u32>) -> SeparateRunParams {
        SeparateRunParams {
            job_id: "job_s".into(),
            run_generation: 1,
            capability: Capability::Separate,
            input: SeparateInput {
                file: file.to_string_lossy().into_owned(),
                content_hash: "sha256:ab".into(),
                track: 0,
            },
            options: SeparateOptions { sample_rate },
            staging: staging.to_string_lossy().into_owned(),
            output_contract: STEMS_OUTPUT_CONTRACT.into(),
        }
    }

    #[test]
    fn writes_vocals_and_background_at_the_requested_rate() {
        let dir = tempfile::tempdir().unwrap();
        let input = input_wav(dir.path());
        let mut events = Events::default();
        let cancel = AtomicBool::new(false);
        let result = run(&mut fake(), &params(&input, dir.path(), Some(48_000)), &cancel, &mut events).unwrap();
        assert_eq!(result.outcome, JobOutcome::Completed);
        assert_eq!(events.phases(), ["decoding", "separating", "encoding"]);
        let progress: Vec<(u64, u64)> = events
            .0
            .iter()
            .filter(|(name, _)| name == "job.progress")
            .map(|(_, p)| {
                assert_eq!((p["phase"].as_str(), p["unit"].as_str()), (Some("separating"), Some("steps")));
                (p["done"].as_u64().unwrap(), p["total"].as_u64().unwrap())
            })
            .collect();
        assert_eq!(progress.first(), Some(&(0, 8)));
        assert_eq!(progress.last(), Some(&(8, 8)));

        let audio = result.audio.unwrap();
        assert_eq!((audio.sample_rate, audio.channels), (48_000, 2));
        assert!((audio.duration_sec - 0.5).abs() < 1e-9, "{}", audio.duration_sec);
        let stems = result.stems.unwrap();
        for file in [&stems.vocals, &stems.background] {
            let bytes = std::fs::read(&file.path).unwrap();
            assert_eq!(file.byte_length, bytes.len() as u64);
            assert_eq!(file.sha256, sha256_hex(&bytes));
            let decoded = wav::decode_wav(&bytes).unwrap();
            assert_eq!(decoded.sample_rate, 48_000);
            assert_eq!(decoded.len(), 24_000);
            // 远离边缘处是直流：人声与背景各占一半。
            let (left, right) = (decoded.left[12_000], decoded.right[12_000]);
            assert!((left - 0.2).abs() < 0.01 && (right + 0.1).abs() < 0.01, "{left} {right}");
        }
        assert!(stems.vocals.path.ends_with(VOCALS_OUTPUT_FILE));
        assert!(stems.background.path.ends_with(BACKGROUND_OUTPUT_FILE));
        assert!(!dir.path().join("vocals.wav.tmp").exists());
    }

    #[test]
    fn defaults_to_the_model_rate() {
        let dir = tempfile::tempdir().unwrap();
        let input = input_wav(dir.path());
        let result = run(
            &mut fake(),
            &params(&input, dir.path(), None),
            &AtomicBool::new(false),
            &mut Events::default(),
        )
        .unwrap();
        let audio = result.audio.unwrap();
        assert_eq!(audio.sample_rate, 44_100);
        assert!((audio.duration_sec - 0.5).abs() < 1e-4);
    }

    #[test]
    fn cancel_between_windows_writes_nothing() {
        static CANCEL: AtomicBool = AtomicBool::new(false);
        let dir = tempfile::tempdir().unwrap();
        let input = input_wav(dir.path());
        let mut separator = FakeSeparator {
            cancel_after: Some((3, &CANCEL)),
            ..fake()
        };
        let result = run(
            &mut separator,
            &params(&input, dir.path(), Some(48_000)),
            &CANCEL,
            &mut Events::default(),
        )
        .unwrap();
        assert_eq!(result.outcome, JobOutcome::Cancelled);
        assert!(result.stems.is_none() && result.audio.is_none());
        assert!(!dir.path().join(VOCALS_OUTPUT_FILE).exists());
        assert!(!dir.path().join(BACKGROUND_OUTPUT_FILE).exists());
    }

    #[test]
    fn errors_map_to_protocol_codes() {
        let dir = tempfile::tempdir().unwrap();
        let input = input_wav(dir.path());
        let cancel = AtomicBool::new(false);
        let failing = run(
            &mut FakeSeparator { fail: true, ..fake() },
            &params(&input, dir.path(), None),
            &cancel,
            &mut Events::default(),
        )
        .unwrap_err();
        assert_eq!(failing.code, codes::INFERENCE_FAILED);
        assert!(!failing.message.contains("/secret"), "{}", failing.message);

        let missing = run(
            &mut fake(),
            &params(&dir.path().join("missing.wav"), dir.path(), None),
            &cancel,
            &mut Events::default(),
        )
        .unwrap_err();
        assert_eq!(missing.code, codes::INPUT_UNREADABLE);

        let no_staging = run(
            &mut fake(),
            &params(&input, &dir.path().join("nope"), None),
            &cancel,
            &mut Events::default(),
        )
        .unwrap_err();
        assert_eq!(no_staging.code, codes::INVALID_PARAMS);

        // 输出写不进 staging（这里用占住临时文件名的目录模拟）：不是模型的失败，不报 `INFERENCE_FAILED`。
        let staging = dir.path().join("blocked");
        std::fs::create_dir_all(staging.join(format!("{VOCALS_OUTPUT_FILE}.tmp"))).unwrap();
        let unwritable = run(&mut fake(), &params(&input, &staging, None), &cancel, &mut Events::default()).unwrap_err();
        assert_eq!(unwritable.code, codes::OUTPUT_WRITE_FAILED);
        assert!(unwritable.retryable);
        assert_eq!(unwritable.details, Some(json!({ "file": VOCALS_OUTPUT_FILE })));
        assert!(!unwritable.message.contains(&*staging.to_string_lossy()), "{}", unwritable.message);
    }
}
