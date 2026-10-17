//! `export-worker canvas-bake <input.json>`：代码包烘焙的指令路线（代码包规范 §7.2）。
//!
//! 代码包宿主录好的 Canvas 2D 指令（NDJSON，`render_raster::canvas2d`）在这里转成 DrawOp、多线程光栅，再按帧序
//! 把 RGBA 写进 ffmpeg 编成 ProRes（macOS 有 VideoToolbox 时用硬件编码，否则 `prores_ks`）。依次是：
//!
//! 1. **对拍**：`verify.samples` 里的帧与 Chromium 截的 PNG 比较，超出阈值以 `CANVAS_OPS_MISMATCH` 失败；
//! 2. **检查**：所有帧先转换一遍（不光栅），录制里有转换不了的东西以 `CANVAS_OPS_UNSUPPORTED` 失败；
//! 3. **光栅 + 编码**：没给 `output` 时到此为止（只对拍与检查）；`discard` 只光栅不编码（测光栅速度）。
//!
//! stdout 是 JSON 行：`verify`、`progress`、最后一行 `done`、`error` 或 `cancelled`。调用方把前两种失败当作回退到
//! 逐帧截图的理由。标准输入收到 `cancel` 或被关闭时取消，删掉没写完的输出。

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ExitCode, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, mpsc};
use std::time::{Duration, Instant};

use render_raster::canvas2d::{self, ConvertError, Converter, Recording};
use render_raster::imgcmp;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tiny_skia::Pixmap;

use crate::render::{PROGRESS_INTERVAL, watch_cancel};
use crate::{Failure, emit};

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum EncoderChoice {
    #[default]
    Auto,
    ProresVideotoolbox,
    ProresKs,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    /// 代码包根目录（录制里的字体与图片路径相对它）。
    root: PathBuf,
    recording: PathBuf,
    /// 输出的 `.mov`；不给时只对拍与检查。
    #[serde(default)]
    output: Option<PathBuf>,
    /// ffmpeg 可执行文件（路径或命令名）。
    #[serde(default)]
    ffmpeg: Option<PathBuf>,
    #[serde(default)]
    encoder: EncoderChoice,
    /// 光栅线程数，缺省是本机的并行度。
    #[serde(default)]
    threads: Option<usize>,
    /// 只光栅不编码（测速）。
    #[serde(default)]
    discard: bool,
    #[serde(default)]
    verify: Option<Verify>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Verify {
    samples: Vec<Sample>,
    #[serde(default)]
    thresholds: Thresholds,
    /// 写出每个样本的本侧渲染与差异图（放大 4 倍）。
    #[serde(default)]
    diff_dir: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Sample {
    frame: usize,
    png: PathBuf,
}

/// 对拍的通过线（`imgcmp` 的三个量；原始的最大偏差不参与，抗锯齿边缘总会有几个像素差得很远）。
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Thresholds {
    ssim_downsampled: f64,
    flat_max_deviation: u8,
    edge_share: f64,
}

impl Default for Thresholds {
    fn default() -> Thresholds {
        // 4× 降采样 SSIM 沿用 GPU 一致性的严格线；平坦区放宽到 4/255，容下两侧渐变抖动的差别；
        // 过渡带占比 5%（s02 实测最高 1.1%，主要是 macOS 的字形平滑）。
        Thresholds {
            ssim_downsampled: 0.98,
            flat_max_deviation: 4,
            edge_share: 0.05,
        }
    }
}

fn failure(code: &str, message: impl Into<String>, details: Value) -> Failure {
    let mut failure = Failure::new(code, message);
    failure.details = details;
    failure
}

fn convert_failure(frame: usize, error: ConvertError) -> Failure {
    match error {
        ConvertError::Unsupported(reason) => failure(
            "CANVAS_OPS_UNSUPPORTED",
            format!("frame {frame}: {reason}"),
            json!({ "frame": frame, "reason": reason }),
        ),
        ConvertError::Invalid(reason) => failure(
            "CANVAS_OPS_INVALID",
            format!("frame {frame}: invalid recording: {reason}"),
            json!({ "frame": frame, "reason": reason }),
        ),
    }
}

fn frame_json(recording: &Recording, frame: usize) -> Result<&str, Failure> {
    recording.frame(frame).ok_or_else(|| {
        failure(
            "CANVAS_OPS_INVALID",
            format!("frame {frame} is missing from the recording"),
            json!({ "frame": frame, "reason": "frame-missing" }),
        )
    })
}

/// 选编码器并给出 ffmpeg 的编码参数：`(编码器, -profile:v, 送进编码器的像素格式, 产物的像素格式)`。
struct Encoding {
    codec: &'static str,
    profile: &'static str,
    input_format: &'static str,
    /// 记进回执的像素格式（与逐帧截图路线一致，导入端按 `yuva` 前缀判定透明）。
    pixel_format: &'static str,
}

fn encoding_for(codec: EncoderChoice, alpha: bool) -> Encoding {
    let pixel_format = if alpha { "yuva444p10le" } else { "yuv422p10le" };
    match codec {
        EncoderChoice::ProresVideotoolbox => Encoding {
            codec: "prores_videotoolbox",
            profile: if alpha { "4444" } else { "hq" },
            input_format: if alpha { "ayuv64le" } else { "p210le" },
            pixel_format,
        },
        _ => Encoding {
            codec: "prores_ks",
            profile: if alpha { "4444" } else { "3" },
            input_format: pixel_format,
            pixel_format,
        },
    }
}

fn run_quiet(ffmpeg: &Path, args: &[&str]) -> Option<std::process::Output> {
    render_raster::exec::command(ffmpeg).args(args).stdin(Stdio::null()).output().ok()
}

/// VideoToolbox 只在 macOS 上有；ffmpeg 编进了它也可能开不起来（没有硬件编码器、无界面的会话），先试编一帧。
fn videotoolbox_works(ffmpeg: &Path, alpha: bool) -> bool {
    if !cfg!(target_os = "macos") {
        return false;
    }
    let encoding = encoding_for(EncoderChoice::ProresVideotoolbox, alpha);
    let args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:d=0.04",
        "-frames:v",
        "1",
        "-c:v",
        encoding.codec,
        "-profile:v",
        encoding.profile,
        "-pix_fmt",
        encoding.input_format,
        "-f",
        "null",
        "-",
    ];
    run_quiet(ffmpeg, &args).is_some_and(|out| out.status.success())
}

fn has_encoder(ffmpeg: &Path, name: &str) -> bool {
    run_quiet(ffmpeg, &["-hide_banner", "-encoders"]).is_some_and(|out| {
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .any(|line| line.split_whitespace().nth(1) == Some(name))
    })
}

fn pick_encoder(ffmpeg: &Path, wanted: EncoderChoice, alpha: bool) -> Result<Encoding, Failure> {
    let missing = |name: &str| {
        failure(
            "EXPORT_TOOL_MISSING",
            format!("the local ffmpeg has no encoder {name}"),
            json!({ "missing": [name] }),
        )
    };
    match wanted {
        EncoderChoice::ProresVideotoolbox if videotoolbox_works(ffmpeg, alpha) => {
            Ok(encoding_for(EncoderChoice::ProresVideotoolbox, alpha))
        }
        EncoderChoice::ProresVideotoolbox => Err(missing("prores_videotoolbox")),
        EncoderChoice::Auto if videotoolbox_works(ffmpeg, alpha) => Ok(encoding_for(EncoderChoice::ProresVideotoolbox, alpha)),
        _ if has_encoder(ffmpeg, "prores_ks") => Ok(encoding_for(EncoderChoice::ProresKs, alpha)),
        _ => Err(missing("prores_ks")),
    }
}

struct Ffmpeg {
    child: Child,
    stderr: Arc<Mutex<String>>,
}

const STDERR_TAIL: usize = 8 * 1024;

impl Ffmpeg {
    fn spawn(ffmpeg: &Path, encoding: &Encoding, recording: &Recording, output: &Path) -> Result<Ffmpeg, Failure> {
        let header = recording.header;
        let size = format!("{}x{}", header.width, header.height);
        let rate = format!("{}/{}", header.fps_num, header.fps_den);
        let mut child = render_raster::exec::command(ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgba",
                "-s",
            ])
            .arg(&size)
            .arg("-framerate")
            .arg(&rate)
            .args([
                "-i",
                "pipe:0",
                "-an",
                "-c:v",
                encoding.codec,
                "-profile:v",
                encoding.profile,
                "-pix_fmt",
            ])
            .arg(encoding.input_format)
            .args(["-movflags", "+faststart"])
            .arg(output)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                failure(
                    "EXPORT_TOOL_MISSING",
                    format!("cannot start ffmpeg ({}): {error}", ffmpeg.display()),
                    json!({ "missing": ["ffmpeg"] }),
                )
            })?;
        let stderr = Arc::new(Mutex::new(String::new()));
        if let Some(mut pipe) = child.stderr.take() {
            let tail = Arc::clone(&stderr);
            std::thread::spawn(move || {
                let mut buffer = [0u8; 4096];
                while let Ok(n) = pipe.read(&mut buffer) {
                    if n == 0 {
                        break;
                    }
                    let mut tail = tail.lock().unwrap_or_else(|p| p.into_inner());
                    tail.push_str(&String::from_utf8_lossy(&buffer[..n]));
                    if tail.len() > STDERR_TAIL {
                        let cut = tail.len() - STDERR_TAIL;
                        let cut = (cut..tail.len()).find(|&i| tail.is_char_boundary(i)).unwrap_or(tail.len());
                        tail.drain(..cut);
                    }
                }
            });
        }
        Ok(Ffmpeg { child, stderr })
    }

    fn failed(&self, reason: &str) -> Failure {
        let tail = self.stderr.lock().unwrap_or_else(|p| p.into_inner()).trim().to_string();
        failure(
            "CANVAS_BAKE_ENCODE_FAILED",
            format!("ffmpeg failed ({reason}): {tail}"),
            json!({ "stderr": tail }),
        )
    }

    fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn verify(input: &Verify, converter: &Converter, recording: &Recording, threads: usize) -> Result<(Value, f64), Failure> {
    let started = Instant::now();
    if let Some(dir) = &input.diff_dir {
        std::fs::create_dir_all(dir).map_err(|e| Failure::new("CANVAS_BAKE_FAILED", format!("create {}: {e}", dir.display())))?;
    }
    let next = AtomicUsize::new(0);
    let results: Mutex<Vec<Option<Result<Value, Failure>>>> = Mutex::new((0..input.samples.len()).map(|_| None).collect());
    let thresholds = input.thresholds;
    std::thread::scope(|scope| {
        for _ in 0..threads.min(input.samples.len()).max(1) {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::SeqCst);
                    let Some(sample) = input.samples.get(i) else {
                        break;
                    };
                    let result = (|| -> Result<Value, Failure> {
                        let ops = converter
                            .convert(frame_json(recording, sample.frame)?)
                            .map_err(|e| convert_failure(sample.frame, e))?;
                        let ours = converter
                            .rasterize(&ops, None)
                            .map_err(|e| Failure::new("CANVAS_BAKE_FAILED", format!("frame {}: {e:#}", sample.frame)))?;
                        let reference =
                            canvas2d::read_png(&sample.png).map_err(|e| Failure::new("CANVAS_BAKE_FAILED", format!("{e:#}")))?;
                        let cmp = imgcmp::compare(&ours, &reference)
                            .map_err(|e| Failure::new("CANVAS_BAKE_FAILED", format!("frame {}: {e:#}", sample.frame)))?;
                        let pass = cmp.ssim_downsampled >= thresholds.ssim_downsampled
                            && cmp.flat_max_deviation <= thresholds.flat_max_deviation
                            && cmp.edge_share <= thresholds.edge_share;
                        if let Some(dir) = &input.diff_dir {
                            canvas2d::write_diff(dir, &sample.frame.to_string(), &ours, &reference)
                                .map_err(|e| Failure::new("CANVAS_BAKE_FAILED", format!("{e:#}")))?;
                        }
                        Ok(json!({
                            "frame": sample.frame,
                            "ssim": cmp.ssim,
                            "ssimDownsampled": cmp.ssim_downsampled,
                            "maxDeviation": cmp.max_deviation,
                            "flatMaxDeviation": cmp.flat_max_deviation,
                            "edgeShare": cmp.edge_share,
                            "pass": pass,
                        }))
                    })();
                    results.lock().unwrap_or_else(|p| p.into_inner())[i] = Some(result);
                }
            });
        }
    });
    let mut samples = Vec::new();
    for result in results.into_inner().unwrap_or_else(|p| p.into_inner()) {
        samples.push(result.expect("every sample is visited")?);
    }
    let pass = samples.iter().all(|s| s["pass"] == json!(true));
    let seconds = started.elapsed().as_secs_f64();
    let report = json!({
        "event": "verify",
        "pass": pass,
        "seconds": seconds,
        "thresholds": {
            "ssimDownsampled": thresholds.ssim_downsampled,
            "flatMaxDeviation": thresholds.flat_max_deviation,
            "edgeShare": thresholds.edge_share,
        },
        "samples": samples,
    });
    emit(&report);
    if !pass {
        let worst = report["samples"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|s| s["pass"] == json!(false))
            .map(|s| s["frame"].clone())
            .collect::<Vec<_>>();
        return Err(failure(
            "CANVAS_OPS_MISMATCH",
            format!("sample frames {worst:?} differ from the browser beyond the thresholds"),
            json!({ "frames": worst, "samples": report["samples"] }),
        ));
    }
    Ok((report, seconds))
}

/// 所有帧先转换一遍（不光栅），提前发现转换不了的帧。
fn check(converter: &Converter, recording: &Recording, total: usize, threads: usize, cancel: &AtomicBool) -> Result<f64, Failure> {
    let started = Instant::now();
    let next = AtomicUsize::new(0);
    let first_error: Mutex<Option<(usize, Failure)>> = Mutex::new(None);
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                loop {
                    let k = next.fetch_add(1, Ordering::SeqCst);
                    if k >= total || cancel.load(Ordering::SeqCst) {
                        break;
                    }
                    let result =
                        frame_json(recording, k).and_then(|json| converter.convert(json).map(drop).map_err(|e| convert_failure(k, e)));
                    if let Err(error) = result {
                        let mut slot = first_error.lock().unwrap_or_else(|p| p.into_inner());
                        if slot.as_ref().is_none_or(|(at, _)| k < *at) {
                            *slot = Some((k, error));
                        }
                        next.store(total, Ordering::SeqCst);
                        break;
                    }
                }
            });
        }
    });
    match first_error.into_inner().unwrap_or_else(|p| p.into_inner()) {
        Some((_, error)) => Err(error),
        None => Ok(started.elapsed().as_secs_f64()),
    }
}

/// 光栅线程与写编码器的主线程之间的流控：领到的帧号不超过已写出的帧加窗口，内存里最多压着一个窗口的帧。
struct Window {
    written: Mutex<usize>,
    advanced: Condvar,
    size: usize,
}

impl Window {
    fn wait_for(&self, k: usize, cancel: &AtomicBool) {
        let mut written = self.written.lock().unwrap_or_else(|p| p.into_inner());
        while k >= *written + self.size && !cancel.load(Ordering::SeqCst) {
            written = self
                .advanced
                .wait_timeout(written, Duration::from_millis(50))
                .unwrap_or_else(|p| p.into_inner())
                .0;
        }
    }

    fn advance(&self, written: usize) {
        *self.written.lock().unwrap_or_else(|p| p.into_inner()) = written;
        self.advanced.notify_all();
    }
}

#[derive(Default)]
struct Timings {
    convert_ns: AtomicU64,
    raster_ns: AtomicU64,
}

fn nanos(d: Duration) -> u64 {
    u64::try_from(d.as_nanos()).unwrap_or(u64::MAX)
}

pub fn run(path: &Path) -> Result<ExitCode, Failure> {
    let cancel = watch_cancel();
    let started = Instant::now();
    let text = std::fs::read_to_string(path).map_err(|e| Failure::new("EXPORT_INPUT_INVALID", format!("read {}: {e}", path.display())))?;
    let input: Input =
        serde_json::from_str(&text).map_err(|e| Failure::new("EXPORT_INPUT_INVALID", format!("parse {}: {e}", path.display())))?;
    let recording = Recording::load(&input.recording).map_err(|e| Failure::new("CANVAS_OPS_INVALID", format!("{e:#}")))?;
    let converter = Converter::new(&input.root, &recording).map_err(|e| Failure::new("CANVAS_OPS_INVALID", format!("{e:#}")))?;
    let header = recording.header;
    let total = header.frames as usize;
    let threads = input
        .threads
        .unwrap_or_else(|| std::thread::available_parallelism().map_or(4, |n| n.get()))
        .max(1);
    let load_seconds = started.elapsed().as_secs_f64();

    let verified = match &input.verify {
        Some(spec) if !spec.samples.is_empty() => Some(verify(spec, &converter, &recording, threads)?),
        _ => None,
    };
    let check_seconds = check(&converter, &recording, total, threads, &cancel)?;
    if cancel.load(Ordering::SeqCst) {
        emit(&json!({ "event": "cancelled", "frame": 0, "total": total }));
        return Ok(ExitCode::from(3));
    }
    let mut stages = json!({
        "load": { "seconds": load_seconds },
        "check": { "seconds": check_seconds, "fps": total as f64 / check_seconds.max(1e-9) },
    });
    if let Some((_, seconds)) = &verified {
        stages["verify"] = json!({ "seconds": seconds, "samples": input.verify.as_ref().map_or(0, |v| v.samples.len()) });
    }
    if input.output.is_none() && !input.discard {
        emit(&json!({
            "event": "done",
            "frames": total,
            "verified": verified.is_some(),
            "stages": stages,
            "seconds": started.elapsed().as_secs_f64(),
        }));
        return Ok(ExitCode::SUCCESS);
    }

    let (encoding, mut ffmpeg) = match (&input.output, input.discard) {
        (Some(output), false) => {
            let program = input.ffmpeg.clone().unwrap_or_else(|| PathBuf::from("ffmpeg"));
            let encoding = pick_encoder(&program, input.encoder, header.alpha)?;
            if let Some(dir) = output.parent().filter(|d| !d.as_os_str().is_empty()) {
                std::fs::create_dir_all(dir).map_err(|e| Failure::new("CANVAS_BAKE_FAILED", format!("create {}: {e}", dir.display())))?;
            }
            let ffmpeg = Ffmpeg::spawn(&program, &encoding, &recording, output)?;
            (Some(encoding), Some(ffmpeg))
        }
        _ => (None, None),
    };
    let abort = |ffmpeg: &mut Option<Ffmpeg>| {
        if let Some(ffmpeg) = ffmpeg.as_mut() {
            ffmpeg.kill();
        }
        if let (Some(output), false) = (&input.output, input.discard) {
            let _ = std::fs::remove_file(output);
        }
    };

    let render_started = Instant::now();
    let timings = Timings::default();
    let window = Window {
        written: Mutex::new(0),
        advanced: Condvar::new(),
        size: threads * 2,
    };
    let next = AtomicUsize::new(0);
    let stop = AtomicBool::new(false);
    let (frames_tx, frames_rx) = mpsc::channel::<(usize, Result<(Pixmap, String), Failure>)>();
    let (recycle_tx, recycle_rx) = mpsc::channel::<Pixmap>();
    let recycle_rx = Mutex::new(recycle_rx);
    let mut hashes: Vec<String> = Vec::with_capacity(total);
    let mut write_ns = 0u64;
    let outcome: Result<(), Failure> = std::thread::scope(|scope| {
        for _ in 0..threads {
            let frames_tx = frames_tx.clone();
            let (next, stop, window, timings, recycle_rx) = (&next, &stop, &window, &timings, &recycle_rx);
            let (converter, recording, cancel) = (&converter, &recording, &cancel);
            scope.spawn(move || {
                loop {
                    let k = next.fetch_add(1, Ordering::SeqCst);
                    if k >= total {
                        break;
                    }
                    window.wait_for(k, cancel);
                    if stop.load(Ordering::SeqCst) || cancel.load(Ordering::SeqCst) {
                        break;
                    }
                    let canvas = recycle_rx.lock().unwrap_or_else(|p| p.into_inner()).try_recv().ok();
                    let result = (|| -> Result<(Pixmap, String), Failure> {
                        let t0 = Instant::now();
                        let ops = converter.convert(frame_json(recording, k)?).map_err(|e| convert_failure(k, e))?;
                        let t1 = Instant::now();
                        let mut pixmap = converter
                            .rasterize(&ops, canvas)
                            .map_err(|e| Failure::new("CANVAS_BAKE_FAILED", format!("frame {k}: {e:#}")))?;
                        if header.alpha {
                            canvas2d::demultiply(pixmap.data_mut());
                        }
                        let hash = Sha256::digest(pixmap.data()).iter().map(|b| format!("{b:02x}")).collect::<String>();
                        timings.convert_ns.fetch_add(nanos(t1 - t0), Ordering::Relaxed);
                        timings.raster_ns.fetch_add(nanos(t1.elapsed()), Ordering::Relaxed);
                        Ok((pixmap, hash))
                    })();
                    if frames_tx.send((k, result)).is_err() {
                        break;
                    }
                }
            });
        }
        drop(frames_tx);
        let mut pending: BTreeMap<usize, (Pixmap, String)> = BTreeMap::new();
        let mut written = 0usize;
        let mut reported = Instant::now() - PROGRESS_INTERVAL;
        emit(&json!({ "event": "progress", "frame": 0, "total": total }));
        let result = (|| -> Result<(), Failure> {
            while written < total {
                if cancel.load(Ordering::SeqCst) {
                    return Ok(());
                }
                let Ok((k, frame)) = frames_rx.recv_timeout(Duration::from_millis(100)) else {
                    continue;
                };
                pending.insert(k, frame?);
                while let Some((pixmap, hash)) = pending.remove(&written) {
                    if let Some(ffmpeg) = ffmpeg.as_mut() {
                        let t = Instant::now();
                        let stdin = ffmpeg.child.stdin.as_mut().expect("ffmpeg stdin is piped");
                        if let Err(error) = stdin.write_all(pixmap.data()) {
                            let status = ffmpeg.child.try_wait().ok().flatten();
                            let reason = match status {
                                Some(status) => format!("exited early: {status}"),
                                None => format!("write: {error}"),
                            };
                            return Err(ffmpeg.failed(&reason));
                        }
                        write_ns += nanos(t.elapsed());
                    }
                    hashes.push(hash);
                    let _ = recycle_tx.send(pixmap);
                    written += 1;
                    window.advance(written);
                    if reported.elapsed() >= PROGRESS_INTERVAL || written == total {
                        reported = Instant::now();
                        emit(&json!({ "event": "progress", "frame": written, "total": total }));
                    }
                }
            }
            Ok(())
        })();
        stop.store(true, Ordering::SeqCst);
        window.advance(usize::MAX / 2);
        result
    });
    if let Err(error) = outcome {
        abort(&mut ffmpeg);
        return Err(error);
    }
    if cancel.load(Ordering::SeqCst) {
        abort(&mut ffmpeg);
        emit(&json!({ "event": "cancelled", "frame": hashes.len(), "total": total }));
        return Ok(ExitCode::from(3));
    }
    let raster_wall = render_started.elapsed().as_secs_f64();
    if let Some(ffmpeg) = ffmpeg.as_mut() {
        drop(ffmpeg.child.stdin.take());
        let status = ffmpeg.child.wait().map_err(|e| ffmpeg.failed(&format!("wait: {e}")))?;
        if !status.success() {
            let failure = ffmpeg.failed(&format!("exit {status}"));
            if let Some(output) = &input.output {
                let _ = std::fs::remove_file(output);
            }
            return Err(failure);
        }
    }
    let render_seconds = render_started.elapsed().as_secs_f64();
    let convert_cpu = timings.convert_ns.load(Ordering::Relaxed) as f64 / 1e9;
    let raster_cpu = timings.raster_ns.load(Ordering::Relaxed) as f64 / 1e9;
    let write_seconds = write_ns as f64 / 1e9;
    let frames = total as f64;
    stages["convert"] = json!({ "cpuSeconds": convert_cpu, "fpsPerThread": frames / convert_cpu.max(1e-9) });
    stages["raster"] = json!({
        "cpuSeconds": raster_cpu,
        "fpsPerThread": frames / raster_cpu.max(1e-9),
        "threads": threads,
        // 光栅线程全速时的帧率上限（不含编码的反压）。
        "fpsCapacity": frames * threads as f64 / (convert_cpu + raster_cpu).max(1e-9),
    });
    stages["pipeline"] = json!({ "seconds": raster_wall, "fps": frames / raster_wall.max(1e-9) });
    if let Some(encoding) = &encoding {
        stages["encode"] = json!({
            "codec": encoding.codec,
            // 主线程阻塞在写编码器管道上的时间：占比高说明编码是瓶颈。
            "blockedSeconds": write_seconds,
            "blockedShare": write_seconds / raster_wall.max(1e-9),
            "drainSeconds": render_seconds - raster_wall,
        });
    }
    emit(&json!({
        "event": "done",
        "output": input.output.as_ref().filter(|_| !input.discard),
        "frames": total,
        "fps": { "num": header.fps_num, "den": header.fps_den },
        "alpha": header.alpha,
        "encoding": encoding.as_ref().map(|e| json!({ "codec": e.codec, "pixelFormat": e.pixel_format })),
        "frameHashes": hashes,
        "verify": verified.map(|(report, _)| report),
        "stages": stages,
        "seconds": started.elapsed().as_secs_f64(),
        "renderFps": frames / render_seconds.max(1e-9),
    }));
    Ok(ExitCode::SUCCESS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encoder_settings_keep_the_pixel_route_formats() {
        let ks = encoding_for(EncoderChoice::ProresKs, false);
        assert_eq!(
            (ks.codec, ks.profile, ks.input_format, ks.pixel_format),
            ("prores_ks", "3", "yuv422p10le", "yuv422p10le")
        );
        let ks = encoding_for(EncoderChoice::ProresKs, true);
        assert_eq!((ks.profile, ks.pixel_format), ("4444", "yuva444p10le"));
        let vt = encoding_for(EncoderChoice::ProresVideotoolbox, false);
        assert_eq!(
            (vt.codec, vt.profile, vt.pixel_format),
            ("prores_videotoolbox", "hq", "yuv422p10le")
        );
        let vt = encoding_for(EncoderChoice::ProresVideotoolbox, true);
        assert_eq!((vt.profile, vt.input_format, vt.pixel_format), ("4444", "ayuv64le", "yuva444p10le"));
    }

    #[test]
    fn input_rejects_unknown_fields_and_defaults_the_encoder() {
        let input: Input = serde_json::from_value(json!({ "root": "/b", "recording": "/r.ndjson" })).unwrap();
        assert_eq!(input.encoder, EncoderChoice::Auto);
        assert!(input.output.is_none());
        assert!(serde_json::from_value::<Input>(json!({ "root": "/b", "recording": "/r", "bogus": 1 })).is_err());
        let input: Input = serde_json::from_value(json!({ "root": "/b", "recording": "/r", "encoder": "prores_ks" })).unwrap();
        assert_eq!(input.encoder, EncoderChoice::ProresKs);
    }
}
