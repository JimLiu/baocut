//! `job.run`（capability `image`）的编排（Model Worker 协议规范 §2.5.3）：冻结参数 → [`ImageRequest`] → 引擎生成 →
//! `image.png`（`baocut.image-png/v1`）。
//!
//! 阶段：`encoding-prompt` → `denoising`（`job.progress` 的 `steps`：开始时报 `0/n`，每完成一步报一次）→ `decoding`
//! （VAE 解码与写 PNG）。取消：引擎在步间看取消标志，之后结果是 `outcome: 'cancelled'`，不写输出。
//!
//! 模型做不到的尺寸在开跑前报 `MODEL_UNSUPPORTED`（`details.reason: 'unsupported-size'`）；Runtime 在提交时已经按模型
//! 的描述拒绝过，这里是同一条规则在 Worker 一侧的兜底。引擎内部的其余失败是 `INFERENCE_FAILED`（细节只写 stderr，
//! 消息里不带路径）。

use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use serde_json::json;

use super::{Cancelled, ImageEngine, ImageProgress, ImageRequest, png};
use crate::asr_result::sha256_hex;
use crate::protocol::{
    ErrorBody, GeneratedImage, IMAGE_OUTPUT_FILE, ImageRunParams, ImageRunResult, ImageStats, JobOutcome, OutputFile, codes,
};
use crate::transcribe::JobSink;

/// 跑一个文生图任务。返回的错误就是该请求的错误响应。
pub fn run(
    engine: &mut dyn ImageEngine,
    params: &ImageRunParams,
    cancel: &AtomicBool,
    sink: &mut dyn JobSink,
) -> Result<ImageRunResult, ErrorBody> {
    params.validate()?;
    let staging = Path::new(&params.staging);
    if !staging.is_dir() {
        return Err(ErrorBody::invalid_params("staging must be an existing absolute directory"));
    }
    let options = &params.options;
    engine.check_size(options.width, options.height)?;
    let request = ImageRequest {
        prompt: options.prompt.clone(),
        width: options.width,
        height: options.height,
        steps: options.steps.unwrap_or_else(|| engine.default_steps()),
        seed: options.seed,
    };
    let job_id = params.job_id.as_str();
    let mut stats = ImageStats::default();
    let cancelled = |stats: ImageStats| ImageRunResult {
        outcome: JobOutcome::Cancelled,
        output: None,
        image: None,
        stats,
    };
    if cancel.load(Ordering::SeqCst) {
        return Ok(cancelled(stats));
    }

    let started = Instant::now();
    let generated = {
        let mut on_progress = |progress: ImageProgress| match progress {
            ImageProgress::EncodingPrompt => phase(sink, job_id, "encoding-prompt"),
            ImageProgress::Denoising { done, total } => {
                if done == 0 {
                    phase(sink, job_id, "denoising");
                }
                sink.event(
                    "job.progress",
                    json!({ "jobId": job_id, "phase": "denoising", "done": done, "total": total, "unit": "steps" }),
                );
            }
            ImageProgress::Decoding => phase(sink, job_id, "decoding"),
        };
        let stop = || cancel.load(Ordering::SeqCst);
        engine.generate(&request, &mut on_progress, &stop)
    };
    stats.generation_ms = started.elapsed().as_millis() as u64;
    let image = match generated {
        _ if cancel.load(Ordering::SeqCst) => return Ok(cancelled(stats)),
        Err(error) if error.is::<Cancelled>() => return Ok(cancelled(stats)),
        Ok(image) => image,
        Err(error) => return Err(inference_failed(engine.family(), &error)),
    };
    if (image.width, image.height) != (request.width, request.height) {
        eprintln!(
            "[model-worker] {} produced {}x{} for a {}x{} request",
            engine.family(),
            image.width,
            image.height,
            request.width,
            request.height
        );
        return Err(
            ErrorBody::new(codes::INFERENCE_FAILED, "the model produced an image of the wrong size")
                .with_details(json!({ "family": engine.family(), "reason": "size-mismatch" })),
        );
    }

    let started = Instant::now();
    let bytes = png::encode_rgba(&image).map_err(|error| inference_failed(engine.family(), &error))?;
    let output = write_output(staging, &bytes).map_err(|error| {
        eprintln!("[model-worker] writing {IMAGE_OUTPUT_FILE} failed: {error}");
        ErrorBody::new(codes::INFERENCE_FAILED, format!("could not write {IMAGE_OUTPUT_FILE}"))
            .with_details(json!({ "reason": "write-failed" }))
    })?;
    stats.encode_ms = started.elapsed().as_millis() as u64;
    Ok(ImageRunResult {
        outcome: JobOutcome::Completed,
        output: Some(output),
        image: Some(GeneratedImage {
            width: image.width,
            height: image.height,
            format: "png".into(),
            seed: request.seed,
            steps: request.steps,
        }),
        stats,
    })
}

fn inference_failed(family: &str, error: &anyhow::Error) -> ErrorBody {
    if let Some(body) = error.downcast_ref::<ErrorBody>() {
        return body.clone();
    }
    eprintln!("[model-worker] {family} image generation failed: {error:#}");
    ErrorBody::new(codes::INFERENCE_FAILED, format!("{family} image generation failed"))
        .with_details(json!({ "family": family, "reason": "generation-failed" }))
}

/// `image.png`：先写临时文件再重命名。路径是绝对路径（staging 是绝对路径）。
fn write_output(staging: &Path, bytes: &[u8]) -> std::io::Result<OutputFile> {
    let path = staging.join(IMAGE_OUTPUT_FILE);
    let temporary = staging.join(format!("{IMAGE_OUTPUT_FILE}.tmp"));
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
    use crate::image::{RawImage, unsupported_size};
    use crate::protocol::{Capability, IMAGE_OUTPUT_CONTRACT, ImageOptions};
    use anyhow::bail;
    use serde_json::Value;

    /// 假引擎：每步报一次进度，按 seed 填一张渐变；`cancel_after` 步后把取消标志置上。
    struct FakeEngine {
        fail: bool,
        wrong_size: bool,
        cancel_after: Option<(u32, &'static AtomicBool)>,
        seen: Option<ImageRequest>,
    }

    impl FakeEngine {
        fn new() -> Self {
            Self {
                fail: false,
                wrong_size: false,
                cancel_after: None,
                seen: None,
            }
        }
    }

    impl ImageEngine for FakeEngine {
        fn family(&self) -> &'static str {
            "qwen-image"
        }
        fn default_steps(&self) -> u32 {
            3
        }
        fn check_size(&self, width: u32, height: u32) -> Result<(), ErrorBody> {
            if width % 32 != 0 || height % 32 != 0 {
                return Err(unsupported_size("qwen-image", width, height, "multiple-of-32"));
            }
            Ok(())
        }
        fn generate(
            &mut self,
            request: &ImageRequest,
            progress: &mut dyn FnMut(ImageProgress),
            cancel: &dyn Fn() -> bool,
        ) -> anyhow::Result<RawImage> {
            self.seen = Some(request.clone());
            if self.fail {
                bail!("权重坏了：/secret/path/model.safetensors");
            }
            progress(ImageProgress::EncodingPrompt);
            progress(ImageProgress::Denoising {
                done: 0,
                total: request.steps,
            });
            for step in 1..=request.steps {
                if cancel() {
                    return Err(Cancelled.into());
                }
                if let Some((at, flag)) = self.cancel_after
                    && at == step
                {
                    flag.store(true, Ordering::SeqCst);
                }
                progress(ImageProgress::Denoising {
                    done: step,
                    total: request.steps,
                });
            }
            progress(ImageProgress::Decoding);
            let (width, height) = if self.wrong_size {
                (request.width / 2, request.height)
            } else {
                (request.width, request.height)
            };
            let pixels = (0..width * height)
                .flat_map(|i| [(i % 256) as u8, (request.seed % 256) as u8, 0, 255])
                .collect();
            Ok(RawImage { width, height, pixels })
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
        fn progress(&self) -> Vec<(u64, u64)> {
            self.0
                .iter()
                .filter(|(name, _)| name == "job.progress")
                .map(|(_, params)| {
                    assert_eq!(params["unit"], "steps");
                    assert_eq!(params["phase"], "denoising");
                    (params["done"].as_u64().unwrap(), params["total"].as_u64().unwrap())
                })
                .collect()
        }
    }

    fn params(staging: &Path) -> ImageRunParams {
        ImageRunParams {
            job_id: "job_1".into(),
            run_generation: 1,
            capability: Capability::Image,
            options: ImageOptions {
                prompt: "a red apple on a wooden table".into(),
                width: 64,
                height: 32,
                steps: None,
                seed: 7,
            },
            staging: staging.to_string_lossy().into_owned(),
            output_contract: IMAGE_OUTPUT_CONTRACT.into(),
        }
    }

    #[test]
    fn writes_image_png_with_phases_and_step_progress() {
        let staging = tempfile::tempdir().unwrap();
        let mut engine = FakeEngine::new();
        let mut events = Events::default();
        let result = run(&mut engine, &params(staging.path()), &AtomicBool::new(false), &mut events).unwrap();

        assert_eq!(result.outcome, JobOutcome::Completed);
        assert_eq!(events.phases(), ["encoding-prompt", "denoising", "decoding"]);
        assert_eq!(events.progress(), [(0, 3), (1, 3), (2, 3), (3, 3)]);
        let output = result.output.unwrap();
        let path = staging.path().join(IMAGE_OUTPUT_FILE);
        assert_eq!(output.path, path.to_string_lossy());
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(output.byte_length, bytes.len() as u64);
        assert_eq!(output.sha256, sha256_hex(&bytes));
        assert!(!staging.path().join("image.png.tmp").exists());
        let (width, height, pixels) = png::decode_rgba(&bytes);
        assert_eq!((width, height, pixels.len()), (64, 32, 64 * 32 * 4));
        assert_eq!(pixels[1], 7, "the seed reaches the engine");
        assert_eq!(
            result.image,
            Some(GeneratedImage {
                width: 64,
                height: 32,
                format: "png".into(),
                seed: 7,
                steps: 3
            })
        );
        let seen = engine.seen.unwrap();
        assert_eq!((seen.steps, seen.seed), (3, 7), "null steps use the model default");

        let mut explicit = params(staging.path());
        explicit.options.steps = Some(2);
        let mut engine = FakeEngine::new();
        run(&mut engine, &explicit, &AtomicBool::new(false), &mut Events::default()).unwrap();
        assert_eq!(engine.seen.unwrap().steps, 2);
    }

    #[test]
    fn sizes_the_model_cannot_do_are_unsupported_before_generating() {
        let staging = tempfile::tempdir().unwrap();
        let mut engine = FakeEngine::new();
        let mut job = params(staging.path());
        job.options.width = 500;
        let error = run(&mut engine, &job, &AtomicBool::new(false), &mut Events::default()).unwrap_err();
        assert_eq!(error.code, codes::MODEL_UNSUPPORTED);
        assert_eq!(error.details.unwrap()["reason"], "unsupported-size");
        assert!(engine.seen.is_none());
    }

    #[test]
    fn cancel_between_steps_writes_nothing() {
        static CANCEL: AtomicBool = AtomicBool::new(false);
        let staging = tempfile::tempdir().unwrap();
        let mut engine = FakeEngine::new();
        engine.cancel_after = Some((1, &CANCEL));
        let mut events = Events::default();
        let result = run(&mut engine, &params(staging.path()), &CANCEL, &mut events).unwrap();
        assert_eq!(result.outcome, JobOutcome::Cancelled);
        assert_eq!((result.output, result.image), (None, None));
        assert_eq!(events.phases(), ["encoding-prompt", "denoising"], "no decoding after a cancel");
        assert!(!staging.path().join(IMAGE_OUTPUT_FILE).exists());

        // 开跑前就取消：不碰引擎。
        let mut engine = FakeEngine::new();
        let result = run(&mut engine, &params(staging.path()), &CANCEL, &mut Events::default()).unwrap();
        assert_eq!(result.outcome, JobOutcome::Cancelled);
        assert!(engine.seen.is_none());
    }

    #[test]
    fn engine_failures_are_inference_failed_without_paths() {
        let staging = tempfile::tempdir().unwrap();
        let mut engine = FakeEngine::new();
        engine.fail = true;
        let error = run(
            &mut engine,
            &params(staging.path()),
            &AtomicBool::new(false),
            &mut Events::default(),
        )
        .unwrap_err();
        assert_eq!(error.code, codes::INFERENCE_FAILED);
        assert!(error.retryable);
        assert!(!error.message.contains("/secret"), "{}", error.message);

        let mut engine = FakeEngine::new();
        engine.wrong_size = true;
        let error = run(
            &mut engine,
            &params(staging.path()),
            &AtomicBool::new(false),
            &mut Events::default(),
        )
        .unwrap_err();
        assert_eq!(error.code, codes::INFERENCE_FAILED);
        assert_eq!(error.details.unwrap()["reason"], "size-mismatch");
        assert!(!staging.path().join(IMAGE_OUTPUT_FILE).exists());
    }
}
