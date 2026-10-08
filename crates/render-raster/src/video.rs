//! MP4 合成：帧级并行渲染（确定性 ⇒ 任意帧独立），平台原生编码为主、ffmpeg 兜底。
//! DrawOp 指纹做静止帧缓存（opencat 场景快照的合成期形态）：
//! 指纹相同的帧直接复用已光栅化的 RGBA，dead-air 段零光栅化成本。
//!
//! ## 编码后端：原生为主、ffmpeg 兜底（WP6b）
//!
//! 成片过去一律由 `ffmpeg -f rawvideo … -c:v libx264 -crf 18` 管道编码。现在先试
//! [`media_native::open_mp4_writer`]（macOS = AVFoundation/VideoToolbox、
//! Windows = Media Foundation），开不了才回落到原来那条 ffmpeg 管道。回落是
//! **静默且自动**的：
//!
//! | 情况 | 后端 |
//! | --- | --- |
//! | macOS / Windows，偶数画布 | 原生 |
//! | 奇数画布（H.264 的 4:2:0 要求偶数；ffmpeg 那条路同样编不出来，回落只是把报错留给它） | ffmpeg |
//! | 本机没有可用的 H.264 / AAC 编码器 | ffmpeg |
//! | Linux（[`media_native::encode_available`] 为 false） | ffmpeg |
//!
//! 与解码侧（`media.rs`）的差别在于**质量目标的表达方式**：ffmpeg 那条路是
//! `-crf 18`（质量导向，码率由内容长出来），硬件编码器没有 CRF，只能给平均码率，
//! 所以质量目标翻译成一条按分辨率与帧率缩放的码率曲线
//! （`media_native::video_bitrate`）。按 `docs/design/bcf/baocut-format-spec.md` §15.1，
//! **导出编码的字节本来就不承诺可复现**，两条路径的产物只需语义等价。实际用了
//! 哪个后端由 [`RenderStats::encode_backend`] 交出。

use crate::assets::LoadedAssets;
use crate::fonts::TextEngine;
use crate::media::MediaStore;
use crate::plan::{CpuExecutor, FramePlanner, SurfaceCache, execute_plan_with_fingerprints};
use crate::renderer::FrameRenderer;
use anyhow::{Context, Result, bail};
use scene_primitives::resolve::Ir;
use std::collections::BinaryHeap;
use std::collections::VecDeque;
use std::io::Write;
use std::path::Path;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, mpsc};

/// ffmpeg 兜底后端的标识。原生后端的标识来自
/// [`media_native::encode_backend`]（`avfoundation` / `media-foundation`）。
/// 与解码侧的 [`crate::media::FFMPEG_BACKEND`] 同名同值：同一个 ffmpeg。
pub const FFMPEG_BACKEND: &str = crate::media::FFMPEG_BACKEND;

/// 两条编码后端各自的质量目标。[`VideoWriter::open`] 用 [`Self::EXPORT`]。
///
/// 两边口径不同（见模块说明）：原生编码器只能给平均码率，ffmpeg 兜底是 CRF。
/// 需要更高保真的调用方（BCF 预览代理，导出还可能再编一次）两边各自上调。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EncodeQuality {
    /// 原生平均码率相对 `media_native::video_bitrate` 曲线的倍数；乘出来仍夹在
    /// 曲线自己的 60 Mb/s 上限之内。
    pub bitrate_scale: f64,
    /// ffmpeg（libx264）兜底的 `-crf`。
    pub crf: u8,
}

impl EncodeQuality {
    /// 成片导出：码率曲线原值、`-crf 18`。
    pub const EXPORT: Self = Self {
        bitrate_scale: 1.0,
        crf: 18,
    };

    /// 交给原生写入器的码率；`None` = 曲线原值（与 [`VideoWriter::open`] 逐字相同）。
    pub fn native_bitrate(&self, width: u32, height: u32, fps: f64) -> Option<u32> {
        (self.bitrate_scale != 1.0).then(|| {
            let base = f64::from(media_native::video_bitrate(width, height, fps));
            (base * self.bitrate_scale).round().clamp(1.0, 60_000_000.0) as u32
        })
    }
}

/// 成片写入器：平台原生优先，开不了才回落 ffmpeg 管道。
///
/// 两条路径的消费方式一样（逐帧喂 RGBA、`finish` 收尾），差别只在字节层。
pub enum VideoWriter {
    /// 平台原生 MP4 写入（AVFoundation / Media Foundation）。
    Native(media_native::Mp4Writer),
    /// `ffmpeg -f rawvideo … -c:v libx264 -crf 18` 管道。
    Ffmpeg(FfmpegWriter),
}

impl VideoWriter {
    /// 打开写入器。原生路径失败（不支持的几何、没有编码器、非 macOS/Windows）
    /// 时静默回落 ffmpeg，与解码侧 `MediaStore` 的回落同一条规矩。
    pub fn open(
        out: &Path,
        width: u32,
        height: u32,
        fps: f64,
        audio_pcm: Option<&Path>,
    ) -> Result<Self> {
        Self::open_with_quality(out, width, height, fps, audio_pcm, EncodeQuality::EXPORT)
    }

    /// 同 [`Self::open`]，按 `quality` 定两条后端各自的质量目标。
    pub fn open_with_quality(
        out: &Path,
        width: u32,
        height: u32,
        fps: f64,
        audio_pcm: Option<&Path>,
        quality: EncodeQuality,
    ) -> Result<Self> {
        if media_native::encode_available()
            && let Ok(writer) = media_native::open_mp4_writer_with_bitrate(
                out,
                width,
                height,
                fps,
                audio_pcm,
                quality.native_bitrate(width, height, fps),
            )
        {
            return Ok(VideoWriter::Native(writer));
        }
        FfmpegWriter::with_crf(out, width, height, fps, audio_pcm, quality.crf)
            .map(VideoWriter::Ffmpeg)
    }

    /// 实际在用的编码后端（§15.1 可观测条款）。
    pub fn backend(&self) -> &'static str {
        match self {
            VideoWriter::Native(writer) => writer.backend(),
            VideoWriter::Ffmpeg(_) => FFMPEG_BACKEND,
        }
    }

    pub fn write_frame(&mut self, rgba: &[u8]) -> Result<()> {
        match self {
            VideoWriter::Native(writer) => writer.write_frame(rgba),
            VideoWriter::Ffmpeg(writer) => writer.write_frame(rgba),
        }
    }

    pub fn finish(self) -> Result<()> {
        match self {
            VideoWriter::Native(writer) => writer.finish(),
            VideoWriter::Ffmpeg(writer) => writer.finish(),
        }
    }
}

pub struct FfmpegWriter {
    child: Child,
    stdin: Option<ChildStdin>,
}

impl FfmpegWriter {
    pub fn new(
        out: &Path,
        width: u32,
        height: u32,
        fps: f64,
        audio_pcm: Option<&Path>,
    ) -> Result<Self> {
        Self::with_crf(
            out,
            width,
            height,
            fps,
            audio_pcm,
            EncodeQuality::EXPORT.crf,
        )
    }

    pub fn with_crf(
        out: &Path,
        width: u32,
        height: u32,
        fps: f64,
        audio_pcm: Option<&Path>,
        crf: u8,
    ) -> Result<Self> {
        let crf = crf.to_string();
        let mut cmd = crate::exec::command("ffmpeg");
        cmd.args([
            "-y",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-s",
            &format!("{width}x{height}"),
            "-r",
            &format!("{fps}"),
            "-i",
            "-",
        ]);
        if let Some(pcm) = audio_pcm {
            cmd.args(["-f", "f32le", "-ar", "48000", "-ac", "2"])
                .arg("-i")
                .arg(pcm);
            cmd.args([
                "-map",
                "0:v",
                "-map",
                "1:a",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-shortest",
            ]);
        } else {
            cmd.arg("-an");
        }
        cmd.args([
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            &crf,
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
        ])
        .arg(out)
        .stdin(Stdio::piped());
        let mut child = cmd
            .spawn()
            .context("启动 ffmpeg 失败（需要安装 ffmpeg：PATH 或 Homebrew 等标准位置）")?;
        let stdin = child.stdin.take();
        Ok(FfmpegWriter { child, stdin })
    }

    pub fn write_frame(&mut self, rgba: &[u8]) -> Result<()> {
        self.stdin.as_mut().expect("ffmpeg stdin").write_all(rgba)?;
        Ok(())
    }

    pub fn finish(mut self) -> Result<()> {
        drop(self.stdin.take());
        let status = self.child.wait()?;
        if !status.success() {
            bail!("ffmpeg 退出码 {status}");
        }
        Ok(())
    }
}

struct OrderedFrame(usize, Arc<Vec<u8>>, u64);

impl PartialEq for OrderedFrame {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}
impl Eq for OrderedFrame {}
impl PartialOrd for OrderedFrame {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for OrderedFrame {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        other.0.cmp(&self.0) // 小顶堆
    }
}

/// 跨 worker 共享的「输出 surface 指纹 → RGBA」缓存（小 LRU；静止段跨线程
/// 也能命中）。这是 [`crate::plan::SurfaceCache`] 的**特例**：只缓存输出
/// surface，而且直接存已经 `take()` 出来的 RGBA——命中时零拷贝送进编码器，
/// 换成 `Pixmap` 每命中一帧就要多一次 8.3MB（1080p）memcpy。
///
/// 帧数 + 字节双上限（设计 §6.6 / §12）：4K 一帧 33MB，只按帧数限容会驻留
/// 数百 MB。
struct FrameCache {
    entries: Mutex<VecDeque<(u64, Arc<Vec<u8>>)>>,
    cap: usize,
    byte_cap: usize,
    hits: AtomicUsize,
}

impl FrameCache {
    fn new(cap: usize, byte_cap: usize) -> Self {
        FrameCache {
            entries: Mutex::new(VecDeque::new()),
            cap: cap.max(1),
            byte_cap: byte_cap.max(1),
            hits: AtomicUsize::new(0),
        }
    }
    fn get(&self, key: u64) -> Option<Arc<Vec<u8>>> {
        let q = self.entries.lock().unwrap();
        let hit = q.iter().find(|(k, _)| *k == key).map(|(_, v)| v.clone());
        if hit.is_some() {
            self.hits.fetch_add(1, Ordering::Relaxed);
        }
        hit
    }
    fn put(&self, key: u64, val: Arc<Vec<u8>>) {
        let mut q = self.entries.lock().unwrap();
        if q.iter().any(|(k, _)| *k == key) {
            return;
        }
        if val.len() > self.byte_cap {
            return;
        }
        q.push_back((key, val));
        let mut total: usize = q.iter().map(|(_, v)| v.len()).sum();
        while q.len() > self.cap || (total > self.byte_cap && q.len() > 1) {
            match q.pop_front() {
                Some((_, dropped)) => total -= dropped.len(),
                None => break,
            }
        }
    }
}

/// 帧缓存的字节上限（128MB：1080p 约 15 帧，4K 约 3 帧）。
const FRAME_CACHE_BYTES: usize = 128 << 20;

pub struct RenderStats {
    pub total_frames: usize,
    /// 指纹命中而免于光栅化的帧数（静止段）
    pub reused_frames: usize,
    /// FramePlan 中间 surface 的复用次数（无 effect 的文档恒为 0：计划折叠成
    /// 单个 Draw pass，根本不存在中间 surface）
    pub reused_surfaces: usize,
    /// 逐帧指纹（帧号序；渲染清单 §15 用）。**取值是 FramePlan 输出 surface
    /// 的内容指纹**，不再是 DrawOp 原语指纹——见 `plan::frame_plan` 的三层指纹。
    pub fingerprints: Vec<u64>,
    /// 实际写出成片的编码后端（§15.1「后端必须可观测」）：`avfoundation` /
    /// `media-foundation` / `ffmpeg`。
    pub encode_backend: &'static str,
}

fn write_mixed_audio_temp(bytes: &[u8]) -> Result<tempfile::NamedTempFile> {
    // tempfile follows the platform temp root (TMPDIR on Unix, GetTempPath on
    // Windows) and removes the raw mix on drop, including error paths.
    let mut file = tempfile::Builder::new()
        .prefix("bcut-mix-")
        .suffix(".f32le")
        .tempfile()
        .context("创建系统临时混音文件")?;
    file.write_all(bytes).context("写系统临时混音文件")?;
    file.as_file_mut().flush().context("刷新系统临时混音文件")?;
    Ok(file)
}

/// 并行渲染全片 → MP4。每 worker 一个 TextEngine（字体系统非 Sync）+ MediaStore。
pub fn render_video(
    ir: &Ir,
    renderer: &FrameRenderer,
    assets: Arc<LoadedAssets>,
    out: &Path,
    jobs: usize,
    progress: impl Fn(usize, usize),
) -> Result<RenderStats> {
    render_video_cancellable(ir, renderer, assets, out, jobs, |done, total| {
        progress(done, total);
        true
    })
}

/// 与 [`render_video`] 相同，但进度回调可在安全帧边界请求取消。
/// 返回 `false` 后收束写入器（原生路径把已写入的帧封成容器、ffmpeg 路径关 stdin
/// 并等待子进程退出——两边都会留下一个"截到取消点"的合法 MP4），并返回带
/// `cancelled:` 前缀的错误；调用方负责删除或保留输出临时文件。
pub fn render_video_cancellable(
    ir: &Ir,
    renderer: &FrameRenderer,
    assets: Arc<LoadedAssets>,
    out: &Path,
    jobs: usize,
    progress: impl FnMut(usize, usize) -> bool,
) -> Result<RenderStats> {
    render_video_with_motion_blur(ir, renderer, assets, out, jobs, 1, progress)
}

/// 与 [`render_video_cancellable`] 相同，外加运动模糊子帧数（`bcut render --motion-blur`，
/// 口径见 [`crate::motion_blur`]）。`motion_blur = 1` 时与前者逐字节、逐指纹相同。
pub fn render_video_with_motion_blur(
    ir: &Ir,
    renderer: &FrameRenderer,
    assets: Arc<LoadedAssets>,
    out: &Path,
    jobs: usize,
    motion_blur: u32,
    mut progress: impl FnMut(usize, usize) -> bool,
) -> Result<RenderStats> {
    crate::motion_blur::validate(motion_blur)?;
    let total_frames = (ir.total * ir.fps).round() as usize;
    let jobs = jobs.max(1).min(total_frames.max(1));

    // 音频混音（有 audio clip 时在系统临时目录生成 PCM 编码输入）：裸 f32le、
    // 48 kHz、立体声交织，两条编码路径读的是同一份格式。
    // 不得把可重建的原始音频写进项目输出目录。
    let audio_pcm = match crate::audio::mix_audio(ir, &assets)? {
        Some(bytes) => Some(write_mixed_audio_temp(&bytes)?),
        None => None,
    };

    let mut writer = VideoWriter::open(
        out,
        renderer.width,
        renderer.height,
        ir.fps,
        audio_pcm.as_ref().map(|file| file.path()),
    )?;
    let encode_backend = writer.backend();
    let cache = FrameCache::new(4, FRAME_CACHE_BYTES);
    // 中间 surface 缓存（转场两侧、效果链）。无 effect 的文档不会产生条目。
    let surfaces = SurfaceCache::with_frame_cap(8);
    // Preflight 在逐帧之前跑完（设计 §6.5）：能力、尺寸、效果版本都在这里定案。
    let planner = FramePlanner::cpu(ir)?;

    // 有界通道限制内存（1080p RGBA ≈ 8.3MB/帧）
    let (tx, rx) = mpsc::sync_channel::<OrderedFrame>(jobs * 2);

    let mut fingerprints = vec![0u64; total_frames];
    let result = std::thread::scope(|scope| -> Result<()> {
        for worker in 0..jobs {
            let tx = tx.clone();
            let assets = assets.clone();
            let cache = &cache;
            let surfaces = &surfaces;
            let planner = &planner;
            scope.spawn(move || {
                let mut engine = TextEngine::for_document(&assets.fonts);
                let mut media = MediaStore::new(assets.clone(), ir.fps);
                let mut executor = CpuExecutor::new(planner.capabilities().clone());
                let mut f = worker;
                while f < total_frames {
                    let t = f as f64 / ir.fps;
                    if motion_blur > 1 {
                        let Some((rgba, fp)) = blurred_frame(
                            planner,
                            renderer,
                            ir,
                            &mut engine,
                            &mut media,
                            &mut executor,
                            surfaces,
                            cache,
                            t,
                            motion_blur,
                        ) else {
                            return; // 主线程按帧数缺口报错
                        };
                        if tx.send(OrderedFrame(f, rgba, fp)).is_err() {
                            return;
                        }
                        f += jobs;
                        continue;
                    }
                    let plan = planner.plan(renderer, ir, &mut engine, t);
                    // 帧指纹与执行器的中间 surface 缓存键出自同一张表：算一次
                    // 交给执行器复用，非折叠计划才不会每帧编码两遍指令流。
                    let Ok((fp, fingerprints)) = plan.frame_fingerprints() else {
                        return; // 主线程按帧数缺口报错
                    };
                    let rgba: Arc<Vec<u8>> = match cache.get(fp) {
                        Some(hit) => hit,
                        None => {
                            let pixmap = match execute_plan_with_fingerprints(
                                &plan,
                                &mut executor,
                                &mut media,
                                Some(surfaces),
                                &fingerprints,
                            ) {
                                Ok(p) => p,
                                Err(_) => return, // 主线程按帧数缺口报错
                            };
                            let data = Arc::new(pixmap.take());
                            cache.put(fp, data.clone());
                            data
                        }
                    };
                    if tx.send(OrderedFrame(f, rgba, fp)).is_err() {
                        return; // 写端已关闭
                    }
                    f += jobs;
                }
            });
        }
        drop(tx);

        // 按帧号重排序后顺序写入编码器
        let mut heap: BinaryHeap<OrderedFrame> = BinaryHeap::new();
        let mut next = 0usize;
        for frame in rx {
            heap.push(frame);
            while let Some(top) = heap.peek() {
                if top.0 != next {
                    break;
                }
                let OrderedFrame(idx, data, fp) = heap.pop().unwrap();
                fingerprints[idx] = fp;
                writer.write_frame(&data)?;
                next += 1;
                if next % 120 == 0 || next == total_frames {
                    if !progress(next, total_frames) {
                        bail!("cancelled: render 已在帧边界取消");
                    }
                }
            }
        }
        if next != total_frames {
            bail!("渲染中断：{next}/{total_frames} 帧");
        }
        Ok(())
    });

    let finish = writer.finish();
    result?;
    finish?;
    Ok(RenderStats {
        total_frames,
        reused_frames: cache.hits.load(Ordering::Relaxed),
        reused_surfaces: surfaces.hits(),
        fingerprints,
        encode_backend,
    })
}

/// 一帧运动模糊：子帧逐个走计划与执行器（中间 surface 缓存照用），平均后按合成指纹进帧缓存。
/// 相邻子帧指纹相同就只画一次、按次数计权——静止段不付 N 倍。
#[allow(clippy::too_many_arguments)]
fn blurred_frame(
    planner: &FramePlanner,
    renderer: &FrameRenderer,
    ir: &Ir,
    engine: &mut TextEngine,
    media: &mut MediaStore,
    executor: &mut CpuExecutor,
    surfaces: &SurfaceCache,
    cache: &FrameCache,
    t: f64,
    samples: u32,
) -> Option<(Arc<Vec<u8>>, u64)> {
    use crate::motion_blur::{Accumulator, composite_fingerprint, subframe_times};
    let plans: Vec<_> = subframe_times(t, ir.fps, samples)
        .into_iter()
        .map(|sub| {
            let plan = planner.plan(renderer, ir, engine, sub);
            let table = plan.frame_fingerprints().ok()?;
            Some((plan, table))
        })
        .collect::<Option<_>>()?;
    let fps: Vec<u64> = plans.iter().map(|(_, (fp, _))| *fp).collect();
    let key = composite_fingerprint(samples, &fps);
    if let Some(hit) = cache.get(key) {
        return Some((hit, key));
    }
    let mut acc = Accumulator::new((renderer.width * renderer.height * 4) as usize);
    let mut index = 0;
    while index < plans.len() {
        let (plan, (fp, table)) = &plans[index];
        let run = plans[index..]
            .iter()
            .take_while(|(_, (other, _))| other == fp)
            .count();
        let pixmap =
            execute_plan_with_fingerprints(plan, executor, media, Some(surfaces), table).ok()?;
        acc.add(pixmap.data(), run as u32);
        index += run;
    }
    let data = Arc::new(acc.finish());
    cache.put(key, data.clone());
    Some((data, key))
}

#[cfg(test)]
mod tests {
    use super::write_mixed_audio_temp;

    #[test]
    fn mixed_audio_uses_platform_temp_and_is_removed_on_drop() {
        let path;
        {
            let file = write_mixed_audio_temp(&[0, 0, 0, 0]).unwrap();
            path = file.path().to_path_buf();
            assert!(path.starts_with(std::env::temp_dir()));
            assert_eq!(std::fs::read(&path).unwrap(), [0, 0, 0, 0]);
        }
        assert!(!path.exists());
    }

    #[test]
    fn encode_quality_scales_the_native_curve_within_its_ceiling() {
        use super::EncodeQuality;
        assert_eq!(EncodeQuality::EXPORT.native_bitrate(1920, 1080, 30.0), None);
        let proxy = EncodeQuality {
            bitrate_scale: 2.5,
            crf: 16,
        };
        let base = media_native::video_bitrate(1920, 1080, 30.0);
        assert_eq!(
            proxy.native_bitrate(1920, 1080, 30.0),
            Some((f64::from(base) * 2.5).round() as u32)
        );
        assert_eq!(proxy.native_bitrate(3840, 2160, 30.0), Some(60_000_000));
    }
}
