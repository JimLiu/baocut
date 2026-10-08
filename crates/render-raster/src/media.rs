//! 帧级媒体供给（opencat MediaContext::frame_rgba_at_time 的 CLI 版）：
//! 每个渲染线程持一个 MediaStore；video 顺序解码，线程内媒体时刻单调前进
//! （stride 分帧保证），回退时重开解码器。
//!
//! ## 解码后端：原生为主、ffmpeg 兜底（WP6a）
//!
//! 视频帧过去一律由 `ffmpeg … -f rawvideo -pix_fmt rgba -r <fps> -` 管道供给，
//! 每个 clip 一个子进程。现在先试 [`media_native::open_frame_stream`]
//! （macOS = AVFoundation、Windows = Media Foundation），解不了才回落到原来那条
//! ffmpeg 管道。回落是**静默且自动**的，不改变任何画面契约：
//!
//! | 情况 | 后端 |
//! | --- | --- |
//! | macOS / Windows 上的 MP4·MOV（H.264 / HEVC / ProRes…） | 原生 |
//! | 带 alpha 的 WebM（要显式点名 `libvpx-vp9`，平台解码器解不开） | ffmpeg |
//! | 平台打不开的容器 / 编码 | ffmpeg |
//! | Linux（`media_native::available()` 为 false） | ffmpeg |
//!
//! 按 `docs/design/bcf/baocut-format-spec.md` §15.1，视频帧解码像素只承诺**语义等价 +
//! 容差**（跨后端灰度 SSIM ≥ 0.95），"取哪一帧"仍是硬承诺；同一次渲染里同一个
//! 源恒定用同一个后端，所以 `drawops_are_byte_deterministic` 这类"同后端两次
//! 自比"的字节级断言照样成立。实际用了哪个后端由
//! [`MediaStore::video_backend`] 交出（§15.1「解码后端必须可观测」）。

use crate::assets::{LoadedAssets, VideoInfo};
use crate::source::{MediaTime, VisualSource};
use anyhow::{Context, Result, anyhow, bail};
use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, ChildStdout, Stdio};
use std::sync::Arc;
use tiny_skia::Pixmap;

/// ffmpeg 兜底后端的标识。原生后端的标识来自
/// [`media_native::backend`]（`avfoundation` / `media-foundation`）。
pub const FFMPEG_BACKEND: &str = "ffmpeg";

/// 随机访问模式下触发「重开解码器」的向前跳阈值（合成帧数）。
///
/// 顺序抽干一帧 1080p H.264 约 5 ms，重开一次解码器几十毫秒；30 帧（合成
/// fps = 30 时正好 1 秒）既高过普通播放的逐帧前进与预取（idx 每次 +1），
/// 也高过导出 stride（worker 数，实际远小于 30），不会把顺序推进误判成跳转。
const RANDOM_ACCESS_REOPEN_FRAMES: i64 = 30;

/// 起点落在视频流尽头之后、一帧都读不出来时，往回退着重开的步长（秒）。
/// 先试探测时长给的末帧时刻（通常一步到位，只解一帧）；容器时长按音轨算、比
/// 视频流长时再逐级退，最远退 32 s——更远就是片源本身有问题，照旧报错。
const TAIL_BACKOFF_SECONDS: [f64; 4] = [0.5, 2.0, 8.0, 32.0];

/// 当前在用的解码器。两条路径的消费方式一样：顺序要下一帧、要不到就是片尾。
enum Decoder {
    /// 平台原生顺序帧流（AVFoundation / Media Foundation）。
    Native(media_native::FrameStream),
    /// `ffmpeg … -f rawvideo -pix_fmt rgba -r <fps> -` 管道。
    Ffmpeg { child: Child, stdout: ChildStdout },
}

struct VideoReader {
    info: VideoInfo,
    fps: f64,
    /// 当前解码器从哪个媒体时刻开始（帧 0 的时刻）
    origin: f64,
    /// 下一个待读帧号（相对 origin）
    next_idx: i64,
    decoder: Option<Decoder>,
    /// 实际在用的解码后端（§15.1 可观测条款）。
    backend: &'static str,
    /// 这条片源的原生路径已被判定不可用（不支持、几何不符、或中途出错），
    /// 之后一律走 ffmpeg——一条片源不来回换后端，否则同一次渲染里的帧会来自
    /// 两个解码器，跨后端容差就成了帧间抖动。
    native_disabled: bool,
    last: Option<Arc<Pixmap>>,
    last_idx: i64,
    eof: bool,
    /// 允许「向前跳太远就重开解码器」（见 [`MediaStore::set_random_access`]）。
    random_access: bool,
    /// 关键帧吸附（见 [`MediaStore::set_keyframe_snap`]）：取帧时刻吸到它之前
    /// 最近的关键帧，跳转只付「重开 + 解一帧」的价。
    snap: bool,
    /// `last` 是吸附出来的**近似帧**时，记下它代表的媒体时刻。`None` = `last`
    /// 是精确帧。精确请求撞见 `Some` 必须从目标时刻重开，绝不能从关键帧网格
    /// 抽干过去——那条网格与合成网格错开半帧。
    approx: Option<f64>,
    /// 近似帧自己（那个关键帧）的呈现时刻：同 GOP 内再拖时判断能否复用。
    /// 常驻解码器给的近似帧不经过顺序流，`origin`/`last_idx` 说不出它在哪。
    approx_pts: Option<f64>,
}

impl VideoReader {
    fn new(info: VideoInfo, fps: f64, random_access: bool) -> Self {
        VideoReader {
            info,
            fps,
            origin: 0.0,
            next_idx: 0,
            decoder: None,
            backend: FFMPEG_BACKEND,
            native_disabled: false,
            last: None,
            last_idx: i64::MIN,
            eof: false,
            random_access,
            snap: false,
            approx: None,
            approx_pts: None,
        }
    }

    /// 这条片源值不值得先试原生路径。
    fn native_eligible(&self) -> bool {
        // `decoder` 非空 = 带 alpha 的 WebM，必须点名 `libvpx-vp9` / `libvpx`
        // （`assets::probe_alpha_decoder`）。那是 ffmpeg 独有的能力：平台解码器
        // 连 VP8/VP9 容器都打不开，更谈不上还原 `BlockAdditional` 里的 alpha。
        media_native::available() && self.info.decoder.is_none()
    }

    /// 从 `from` 重开解码器：原生优先，不成回落 ffmpeg。
    ///
    /// 手上已经是原生流时先试**原地重开**（同一份容器解析与轨道，只换
    /// reader）：随机访问每次跳转都要走这里，完整重开里的容器解析与找轨是纯
    /// 浪费。原地重开失败就丢掉它完整重开，语义不变。
    fn open(&mut self, from: f64) -> Result<()> {
        self.approx = None;
        self.approx_pts = None;
        if !self.native_disabled
            && let Some(Decoder::Native(stream)) = self.decoder.as_mut()
            && stream.reopen(from).is_ok()
        {
            self.origin = from;
            self.next_idx = 0;
            self.eof = false;
            return Ok(());
        }
        self.close();
        if !self.native_disabled && self.native_eligible() {
            match media_native::open_frame_stream(&self.info.path, from, self.fps) {
                // 几何必须与资源加载期探到的**摆正后 display 尺寸**
                // 逐像素相符：下游 `Pixmap` 按 `info.width × info.height` 构造，
                // 尺寸不符就是错帧。旋转素材的原生流与 ffmpeg autorotate 都交出
                // display 几何，不再因 `naturalW/H` 的编码口径误判为原生失败。
                Ok(stream)
                    if (stream.width(), stream.height()) == (self.info.width, self.info.height) =>
                {
                    self.decoder = Some(Decoder::Native(stream));
                    self.backend = media_native::backend();
                    self.origin = from;
                    self.next_idx = 0;
                    self.eof = false;
                    return Ok(());
                }
                _ => self.native_disabled = true,
            }
        }
        self.spawn_ffmpeg(from)
    }

    fn spawn_ffmpeg(&mut self, from: f64) -> Result<()> {
        // -ss 在 -i 前：关键帧快进 + 精确解码到点；输出重采样到合成 fps
        let mut command = crate::exec::command("ffmpeg");
        command.args(["-loglevel", "error", "-ss", &format!("{from:.6}")]);
        // 带 alpha 的 WebM 必须点名 `libvpx-vp9` / `libvpx`：ffmpeg 的原生
        // vp9/vp8 解码器会静默丢掉 alpha 平面（`assets::probe_alpha_decoder`）。
        // `-c:v` 要在 `-i` **之前**才作用于输入。
        if let Some(decoder) = &self.info.decoder {
            command.args(["-c:v", decoder]);
        }
        let mut child = command
            .arg("-i")
            .arg(&self.info.path)
            .args([
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgba",
                "-r",
                &format!("{}", self.fps),
                "-",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .context("启动 ffmpeg 视频解码失败")?;
        let stdout = child.stdout.take().context("ffmpeg 没有交出 stdout 管道")?;
        self.decoder = Some(Decoder::Ffmpeg { child, stdout });
        self.backend = FFMPEG_BACKEND;
        self.origin = from;
        self.next_idx = 0;
        self.eof = false;
        Ok(())
    }

    fn close(&mut self) {
        if let Some(Decoder::Ffmpeg { mut child, .. }) = self.decoder.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// 解码器的下一帧（straight RGBA，源尺寸）；`None` = 片源尽头。
    fn read_frame(&mut self) -> Result<Option<Vec<u8>>> {
        match self.decoder.as_mut() {
            Some(Decoder::Native(stream)) => Ok(stream.next_frame()?.map(|frame| frame.data)),
            Some(Decoder::Ffmpeg { stdout, .. }) => {
                let mut buf = vec![0u8; self.info.width as usize * self.info.height as usize * 4];
                // 管道读不满一帧就是片尾（ffmpeg 正常收工也走这条）。
                Ok(stdout.read_exact(&mut buf).ok().map(|()| buf))
            }
            None => Ok(None),
        }
    }

    /// 解码出的一帧 → 预乘 `Pixmap`，记为 `last`。
    fn store_frame(&mut self, mut bytes: Vec<u8>) -> Result<Arc<Pixmap>> {
        premultiply_in_place(&mut bytes);
        let pixmap = Pixmap::from_vec(
            bytes,
            tiny_skia::IntSize::from_wh(self.info.width, self.info.height)
                .ok_or_else(|| anyhow!("零尺寸视频"))?,
        )
        .ok_or_else(|| anyhow!("解码帧构造失败"))?;
        let pixmap = Arc::new(pixmap);
        self.last = Some(pixmap.clone());
        Ok(pixmap)
    }

    /// 关键帧吸附取帧：`mtime` 之前最近的关键帧那一张。`Ok(None)` = 这条路径
    /// 答不了（还没开过解码器、不是原生流、平台不提供关键帧表、或解码出错），
    /// 调用方走精确路径。
    fn snapped_frame(&mut self, mtime: f64) -> Result<Option<Arc<Pixmap>>> {
        let Some(Decoder::Native(stream)) = self.decoder.as_mut() else {
            return Ok(None);
        };
        if self.approx == Some(mtime) && self.last.is_some() {
            return Ok(self.last.clone());
        }
        let Some(keyframe) = stream.sync_sample_at_or_before(mtime)? else {
            return Ok(None);
        };
        // 手上那张帧落在 [关键帧, mtime] 之间就是合格的近似：拖动经过同一个
        // GOP 时不重开也不重解。近似帧自己就在关键帧上（`approx_pts`），
        // 精确帧则按它在网格上的时刻算。
        let shown = self.approx_pts.or_else(|| {
            (self.last_idx >= 0).then(|| self.origin + self.last_idx as f64 / self.fps)
        });
        if self.last.is_some()
            && let Some(shown) = shown
            && keyframe <= shown + 1e-6
            && shown <= mtime + 1e-6
        {
            self.approx = Some(mtime);
            return Ok(self.last.clone());
        }
        // 快路径：常驻关键帧解码器直接出图，顺序流原地不动（精确请求反正要
        // 从目标时刻重开）。
        if let Some((pts, frame)) = stream.keyframe_at_or_before(mtime)? {
            self.last_idx = i64::MIN;
            let pixmap = self.store_frame(frame.data)?;
            self.approx = Some(mtime);
            self.approx_pts = Some(pts);
            return Ok(Some(pixmap));
        }
        // 慢路径：重开到关键帧 + 解一帧。
        self.open(keyframe)?;
        self.last_idx = i64::MIN;
        match self.read_frame() {
            Ok(Some(bytes)) => {
                self.next_idx = 1;
                self.last_idx = 0;
                let pixmap = self.store_frame(bytes)?;
                self.approx = Some(mtime);
                self.approx_pts = Some(keyframe);
                Ok(Some(pixmap))
            }
            // 关键帧上一帧都读不出来：让精确路径按它自己的规则（含片尾冻结）
            // 从头处理。
            Ok(None) => {
                self.close();
                Ok(None)
            }
            Err(_) => {
                // 原生流中途出错：与精确路径同一条纪律，整条片源降级 ffmpeg。
                self.native_disabled = true;
                self.close();
                Ok(None)
            }
        }
    }

    /// 媒体时刻 mtime 处的帧（合成 fps 网格量化）；越过片尾冻结末帧。
    fn frame_at(&mut self, mtime: f64) -> Result<Arc<Pixmap>> {
        let mtime = mtime.max(0.0);
        if self.snap
            && let Some(pixmap) = self.snapped_frame(mtime)?
        {
            return Ok(pixmap);
        }
        if self.approx.take().is_some() {
            // 手上是拖动时的近似帧：精确请求从目标时刻重开（原地重开很便宜），
            // 不从关键帧网格上抽干过去——那会把合成网格挪开半帧。
            self.open(mtime)?;
            self.last = None;
            self.last_idx = i64::MIN;
        }
        let seeks_backward = mtime + 1e-9 < self.origin;
        // 已经读到片尾（`eof` 同时关掉了解码器）后的前进请求：同一原点上 ≥
        // `next_idx` 的帧都不存在，直接冻结末帧。不能落到下面的
        // `decoder.is_none()` 重开——那会在片尾之外开一个空解码器，播放走到头
        // 之后第二帧起就报「无帧可读」。
        if self.eof
            && !seeks_backward
            && ((mtime - self.origin) * self.fps).round() as i64 >= self.last_idx
            && let Some(pixmap) = &self.last
        {
            return Ok(pixmap.clone());
        }
        if self.decoder.is_none() || seeks_backward {
            self.open(mtime)?;
            // 帧号相对原点：原点挪了，旧的 `last_idx` 就不可比，留着会被下面的
            // loop 折回守卫当成「帧号倒退」。`last` 只在后退时作废，前进时留作
            // 读不出帧的兜底。
            self.last_idx = i64::MIN;
            if seeks_backward {
                self.last = None;
            }
        }
        let mut idx = ((mtime - self.origin) * self.fps).round() as i64;
        // loop 动画会在同一 decoder origin 内把媒体钟从片尾折回片头。只比较
        // `mtime < origin` 看不见这种后退：next_idx 已经越过目标帧，旧实现会
        // 直接把上一遍的末次帧当成新一遍的首帧。帧号倒退时从目标时刻重开，
        // 与显式 seek 的乱序采样语义一致。
        if idx < self.last_idx {
            self.open(mtime)?;
            self.last = None;
            self.last_idx = i64::MIN;
            idx = 0;
        }
        if idx == self.last_idx
            && let Some(pixmap) = &self.last
        {
            return Ok(pixmap.clone());
        }
        // 随机访问（交互式预览）：向前跳太远时重开解码器，而不是把中间帧全部
        // 解出来丢掉。拖 playhead 一次能跳过上万帧，抽干等于把整段视频解一遍。
        if self.random_access && !self.eof && idx - self.next_idx >= RANDOM_ACCESS_REOPEN_FRAMES {
            // 重开点取**合成网格上的目标时刻**而不是 mtime：`open` 之后
            // `origin = target`、`idx = 0`，取到的仍是「包含 target 的那一源
            // 帧」（AVAssetReader 的 timeRange 与 ffmpeg `-ss` 都交出与起点相交
            // 的样本），与顺序抽干落在同一帧上；网格也不发生位移，后续帧号仍以
            // 1/fps 为步长。直接用 mtime 会把网格挪到 mtime 上，跟导出的抽干
            // 路径产生半帧错位。
            let raw = self.origin + idx as f64 / self.fps;
            // 越过片尾时夹到最后一个可解码时刻：抽干路径在那里是「冻结末帧」，
            // 重开路径必须给出同一张末帧，而不是一个解不出帧的起点。算这个时刻
            // 要源帧率与片长（`VideoInfo::fps` 的注释里就是这个用途）；两者有一
            // 个探测不到，就只在**确定还在片内**时才敢重开，否则退回顺序抽干
            // ——慢，但与导出路径逐字节一致。
            let target = if self.info.fps > 0.0 && self.info.duration > 0.0 {
                Some(raw.min((self.info.duration - 1.0 / self.info.fps).max(0.0)))
            } else if raw < self.info.duration {
                Some(raw)
            } else {
                None
            };
            if let Some(target) = target {
                self.open(target)?;
                // 只作废帧号（否则 idx = 0 会撞上旧的 last_idx）；`last` 留着当
                // 兜底，万一重开后一帧都读不出来仍然冻结上一帧而不是报错。
                self.last_idx = i64::MIN;
                idx = 0;
            }
        }
        let mut latest: Option<Vec<u8>> = None;
        while !self.eof && self.next_idx <= idx {
            match self.read_frame() {
                Ok(Some(bytes)) => {
                    self.next_idx += 1;
                    latest = Some(bytes);
                }
                Ok(None) => {
                    self.eof = true; // 片源尽头：冻结最后一帧
                    self.close();
                }
                // 原生解码器中途出错：整条片源降级到 ffmpeg，从同一个 origin
                // 重开并把已经走过的帧重放掉，之后的帧全部来自 ffmpeg。
                Err(error) if matches!(self.decoder, Some(Decoder::Native(_))) => {
                    let _ = error;
                    self.native_disabled = true;
                    let origin = self.origin;
                    self.open(origin)?;
                    latest = None;
                }
                Err(error) => return Err(error),
            }
        }
        if let Some(bytes) = latest {
            self.store_frame(bytes)?;
            self.last_idx = self.next_idx - 1;
        } else if self.eof && self.next_idx == 0 {
            self.freeze_tail()?;
        }
        self.last
            .clone()
            .ok_or_else(|| anyhow!("视频 {} 在 t={mtime:.3} 无帧可读", self.info.path.display()))
    }

    /// 从 `origin` 起一帧都读不出来 = 原点落在视频流尽头之后：片段或项目比
    /// 视频流长（容器时长按音轨算、编码器补尾）时，冷启动或 seek 到最后那几十
    /// 毫秒就是这样。往回退着重开、顺序抽干到尽头，把真正的末帧冻结住（与从头
    /// 抽干走到片尾交出同一张）；手上若有跳转前留下的兜底帧，也换成它。全都
    /// 读不出来就原样返回，让调用方报错。
    fn freeze_tail(&mut self) -> Result<()> {
        let beyond = self.origin;
        let probed_end = (self.info.fps > 0.0 && self.info.duration > 0.0)
            .then(|| (self.info.duration - 1.0 / self.info.fps).max(0.0));
        let backoff = TAIL_BACKOFF_SECONDS
            .iter()
            .map(|seconds| (beyond - seconds).max(0.0));
        let mut tried = beyond;
        for from in probed_end.into_iter().chain(backoff) {
            // 只往回退：每一步都要比上一步更早，否则同一个空区间白开一次。
            if from + 1e-9 >= tried {
                continue;
            }
            tried = from;
            self.open(from)?;
            self.last_idx = i64::MIN;
            let mut latest = None;
            loop {
                match self.read_frame() {
                    Ok(Some(bytes)) => {
                        self.next_idx += 1;
                        latest = Some(bytes);
                    }
                    Ok(None) => break,
                    // 与顺序抽干同一条纪律：原生解码器中途出错，整条片源降级
                    // ffmpeg，从同一起点重来。
                    Err(_) if matches!(self.decoder, Some(Decoder::Native(_))) => {
                        self.native_disabled = true;
                        self.open(from)?;
                        latest = None;
                    }
                    Err(error) => return Err(error),
                }
            }
            self.eof = true;
            self.close();
            if let Some(bytes) = latest {
                self.store_frame(bytes)?;
                self.last_idx = self.next_idx - 1;
                return Ok(());
            }
            if from <= 0.0 {
                break;
            }
        }
        Ok(())
    }
}

/// ffmpeg 的 `-pix_fmt rgba` 是 **straight**（非预乘）RGBA，而 `tiny_skia::Pixmap`
/// 的字节约定是**预乘**。不换算就把 straight 当预乘用，合成时颜色会偏亮。
///
/// **不透明视频上这是恒等变换**（α = 255 ⇒ `c·255/255 = c`），所以在带 alpha 的
/// 视频出现之前谁也碰不到它——P7b 的动态贴纸（GIF → 带 alpha 的 WebM）
/// 是第一条会走到 α < 255 的片源。
/// 逐帧只在**真有半透明像素时**才写回，全不透明的帧只多一趟只读扫描。
fn premultiply_in_place(rgba: &mut [u8]) {
    if rgba.chunks_exact(4).all(|px| px[3] == 255) {
        return;
    }
    for px in rgba.chunks_exact_mut(4) {
        // tiny-skia 自己的 `ColorU8::premultiply`：唯一一份取整规则，
        // 与 `assets::decode_image_bytes` 走的是同一个函数。
        let premultiplied = tiny_skia::ColorU8::from_rgba(px[0], px[1], px[2], px[3]).premultiply();
        px[0] = premultiplied.red();
        px[1] = premultiplied.green();
        px[2] = premultiplied.blue();
        px[3] = premultiplied.alpha();
    }
}

/// 已光栅化的动图帧缓存（`(源 id, 帧起点毫秒, 目标像素尺寸)` → 像素）。
///
/// 动图与矢量动图**没有解码器状态**，取帧是纯函数——于是同一格被反复要到时，
/// 唯一省得下来的就是重算。会反复要的场合不少：暂停在一帧上、拖 playhead 来回
/// 经过、`loop` 贴纸转一圈回到同一格、以及同一时刻先建场景再取纹理。
///
/// 字节上限而不是条数上限：一张 1024² RGBA 是 4 MB，按条数限容在大素材上会驻留
/// 几百 MB。
struct AnimatedFrameCache {
    entries: std::sync::Mutex<std::collections::VecDeque<(AnimatedFrameKey, Arc<Pixmap>)>>,
    byte_cap: usize,
}

type AnimatedFrameKey = (String, i64, u32, u32);

/// 动图帧缓存的字节上限：32 MB（1024² 约 8 张，512² 约 32 张）。
const ANIMATED_CACHE_BYTES: usize = 32 << 20;

impl AnimatedFrameCache {
    fn new(byte_cap: usize) -> Self {
        AnimatedFrameCache {
            entries: std::sync::Mutex::new(std::collections::VecDeque::new()),
            byte_cap: byte_cap.max(1),
        }
    }

    fn get(&self, key: &AnimatedFrameKey) -> Option<Arc<Pixmap>> {
        let entries = self.entries.lock().ok()?;
        entries
            .iter()
            .find(|(candidate, _)| candidate == key)
            .map(|(_, pixmap)| pixmap.clone())
    }

    fn put(&self, key: AnimatedFrameKey, value: Arc<Pixmap>) {
        let bytes = pixmap_bytes(&value);
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        if bytes > self.byte_cap {
            return; // 单张就超预算：不缓存，也不把已有条目全挤掉
        }
        if entries.iter().any(|(candidate, _)| *candidate == key) {
            return;
        }
        entries.push_back((key, value));
        let mut total: usize = entries.iter().map(|(_, value)| pixmap_bytes(value)).sum();
        while total > self.byte_cap && entries.len() > 1 {
            match entries.pop_front() {
                Some((_, dropped)) => total -= pixmap_bytes(&dropped),
                None => break,
            }
        }
    }
}

fn pixmap_bytes(pixmap: &Pixmap) -> usize {
    pixmap.width() as usize * pixmap.height() as usize * 4
}

/// 单线程媒体供给器：image 直引 LoadedAssets，animatedImage 查已解码的帧表，
/// video 持顺序解码器。
pub struct MediaStore {
    assets: Arc<LoadedAssets>,
    fps: f64,
    readers: HashMap<String, VideoReader>,
    /// 宿主已准备的可采样画面源（例如 BCF 合成）；与真实视频共用源时间入口。
    external_video: HashMap<String, Box<dyn crate::raster::FrameMedia + Send>>,
    random_access: bool,
    keyframe_snap: bool,
    animated_cache: AnimatedFrameCache,
    image_cache: AnimatedFrameCache,
    video_cache: AnimatedFrameCache,
    /// 动画 SVG 的天然尺寸备忘（解一次就记住；见 [`MediaStore::vector_natural_size`]）。
    svg_natural: std::sync::Mutex<HashMap<String, (u32, u32)>>,
}

/// 宿主提供的合成画面源。元数据供布局使用，像素仍按明确的源时间请求。
pub struct ExternalVideoSource {
    pub info: VideoInfo,
    pub frames: Box<dyn crate::raster::FrameMedia + Send>,
    pub warning: Option<String>,
}

/// 缓存键里的目标尺寸位：`None`（自然尺寸）与任何显式尺寸都必须能区分开，
/// 而 `(0, 0)` 不是任何合法的目标尺寸，正好当"没指定"。
fn target_key(target: Option<(u32, u32)>) -> (u32, u32) {
    target.unwrap_or((0, 0))
}

impl MediaStore {
    pub fn new(assets: Arc<LoadedAssets>, fps: f64) -> Self {
        MediaStore {
            assets,
            fps,
            readers: HashMap::new(),
            external_video: HashMap::new(),
            random_access: false,
            keyframe_snap: false,
            animated_cache: AnimatedFrameCache::new(ANIMATED_CACHE_BYTES),
            image_cache: AnimatedFrameCache::new(64 << 20),
            video_cache: AnimatedFrameCache::new(64 << 20),
            svg_natural: std::sync::Mutex::new(HashMap::new()),
        }
    }

    /// 打开**随机访问**模式：向前跳超过 [`RANDOM_ACCESS_REOPEN_FRAMES`] 帧时
    /// 重开解码器，而不是逐帧抽干中间帧。
    ///
    /// 默认关闭，导出（`render_video_cancellable`）的行为一字不改——它按 stride
    /// 顺序推进，抽干本来就是它的正常工作方式。只有交互式预览会一次跳过成千
    /// 上万帧（拖 playhead、打开项目定位），那里抽干等于把整段视频解一遍。
    ///
    /// 两条路径取的是**同一源帧**：重开点落在合成网格上（见 `frame_at`），所以
    /// `docs/design/bcf/baocut-format-spec.md` §15.1 的「取哪一帧」硬承诺不受影响。
    pub fn set_random_access(&mut self, enabled: bool) {
        self.random_access = enabled;
        for reader in self.readers.values_mut() {
            reader.random_access = enabled;
        }
    }

    /// 打开**关键帧吸附**模式：取帧时刻吸到它之前最近的关键帧，只解那一帧。
    ///
    /// 给交互式预览**拖动中**用：精确取帧每次跳转都要「从关键帧解到目标」，
    /// 1080p H.264 一个 GOP 上百帧时那是几十毫秒，拖 playhead 时肉眼可见地
    /// 跟不上手。吸附之后每次跳转只付重开 + 解一帧的价，画面与目标时刻最多差
    /// 一个 GOP——老 AppKit 客户端拖动时（`AVPlayer` 的关键帧容差 seek）就是
    /// 这个体验。松手后关掉它，下一次取帧回到精确路径，并且**不会**从近似帧
    /// 抽干过去（网格错半帧），而是从目标时刻重开。
    ///
    /// 只有原生流（AVFoundation）答得出关键帧表；ffmpeg 兜底与其它平台上这
    /// 个开关是 no-op，行为与精确路径相同。默认关闭，导出一字不改。
    pub fn set_keyframe_snap(&mut self, enabled: bool) {
        self.keyframe_snap = enabled;
        for reader in self.readers.values_mut() {
            reader.snap = enabled;
        }
    }

    pub fn has_image(&self, id: &str) -> bool {
        self.assets.images.contains_key(id) || self.assets.bounded_images.contains_key(id)
    }

    pub fn with_image_cache_limit(mut self, bytes: usize) -> Self {
        self.image_cache = AnimatedFrameCache::new(bytes.clamp(1, 64 << 20));
        self
    }
    pub fn image_cache_resident_bytes(&self) -> usize {
        self.image_cache
            .entries
            .lock()
            .map(|entries| entries.iter().map(|(_, p)| pixmap_bytes(p)).sum())
            .unwrap_or(0)
    }
    pub fn image_frame(&self, id: &str) -> Result<Arc<Pixmap>> {
        if let Some(image) = self.assets.images.get(id) {
            return Ok(image.clone());
        }
        let path = self
            .assets
            .bounded_images
            .get(id)
            .ok_or_else(|| anyhow!("图像资源 {id} 未加载"))?;
        self.assets.validate_media_file(path)?;
        let key = (id.to_owned(), -1, 0, 0);
        if let Some(hit) = self.image_cache.get(&key) {
            return Ok(hit);
        }
        let bytes = std::fs::read(path)?;
        let label = match image::guess_format(&bytes)? {
            image::ImageFormat::Png => "tile.png",
            image::ImageFormat::Jpeg => "tile.jpg",
            image::ImageFormat::WebP => "tile.webp",
            image::ImageFormat::Gif => "tile.gif",
            _ => bail!("BCF bounded image 的格式不受支持：{id}"),
        };
        let image = crate::assets::decode_image(label, &bytes)?;
        self.assets.validate_media_file(path)?;
        if let Some(meta) = self.assets.inputs.media.get(id)
            && (image.width() as f64 != meta.width || image.height() as f64 != meta.height)
        {
            bail!("BCF bounded image 的尺寸在准备后改变：{id}");
        }
        let image = Arc::new(image);
        self.image_cache.put(key, image.clone());
        Ok(image)
    }

    pub fn image(&self, id: &str) -> Option<Arc<Pixmap>> {
        self.assets.images.get(id).cloned()
    }

    /// 这个 source 是不是按**视频**加载的。host 用它决定媒体时刻怎么算——
    /// 同一个 `kind: "sticker"` 元素，静态资产恒取 -1，动态资产要按
    /// `sticker.loop` 逐帧取（P7b）。判据留在这里而不是让 host 自己猜扩展名。
    pub fn has_video(&self, id: &str) -> bool {
        self.assets.videos.contains_key(id)
    }

    /// 这个 source 是不是预解码的 GIF / APNG / animated WebP。
    ///
    /// Timeline 的 `SourceKind::Image` 历史上同时接收静态图和动图扩展名，host
    /// 必须按容器字节区分两者；元素层不能再拿 `kind == image` 推断它恒定不变。
    pub fn has_animated(&self, id: &str) -> bool {
        self.assets.animated.contains_key(id)
            || self.assets.animated_svgs.contains_key(id)
            || self.assets.lotties.contains_key(id)
            || self.assets.programs.contains_key(id)
    }

    /// 这个 source 是不是 Lottie（Timeline 0.7 `sources[].kind: "lottie"`）。
    /// 与动图同一条取帧路径（[`MediaStore::animated_frame`]），只是像素由
    /// `Lottie::sample` 按素材原尺寸即时光栅。
    pub fn has_lottie(&self, id: &str) -> bool {
        self.assets.lotties.contains_key(id)
    }

    /// 动图一轮的时长。Timeline image/B-roll 用它把本地时钟折回帧表；BCF
    /// `animatedImage` 自己的 loop/segment 语义仍在 core 录制期处理。
    pub fn animated_duration(&self, id: &str) -> Option<f64> {
        self.assets
            .animated
            .get(id)
            .map(|source| source.metadata().duration())
            .or_else(|| {
                self.assets
                    .animated_svgs
                    .get(id)
                    .map(|source| source.duration())
            })
            .or_else(|| {
                self.assets
                    .lotties
                    .get(id)
                    .map(|source| source.metadata().duration())
            })
            .or_else(|| self.assets.programs.get(id).map(|source| source.duration()))
    }

    pub fn is_time_varying(&self, id: &str) -> bool {
        self.has_video(id) || self.has_animated(id)
    }

    pub fn media_duration(&self, id: &str) -> Option<f64> {
        self.video_duration(id)
            .or_else(|| self.animated_duration(id))
    }

    /// 视频源的时长（秒）。动态贴纸的 `loop` 取模需要它。
    pub fn video_duration(&self, id: &str) -> Option<f64> {
        self.assets.videos.get(id).map(|info| info.duration)
    }

    /// 视频源上**最后一个可解码的时刻**（`duration - 1/fps`，下夹到 0）。
    ///
    /// `ffmpeg -ss` 到最后一帧之后一帧都读不出来（硬错误，不是冻结末帧），
    /// 所以想"停在末帧"的调用方必须夹到这里。源帧率探测不到时退回
    /// `duration`——那时夹取无效，但也没有更好的估计。
    pub fn video_last_frame_time(&self, id: &str) -> Option<f64> {
        if let Some(svg) = self.assets.animated_svgs.get(id) {
            return Some(((svg.duration() * 30.0).ceil() - 1.0).max(0.0) / 30.0);
        }
        if let Some(lottie) = self.assets.lotties.get(id) {
            // 帧表是 N+1 项起点表：末帧的起点就是最后一个可采样时刻。
            let starts = lottie.frame_starts_ms();
            let last = starts.len().checked_sub(2).map_or(0, |index| starts[index]);
            return Some(last as f64 / 1000.0);
        }
        if let Some(program) = self.assets.programs.get(id) {
            let starts = program.frame_starts_ms();
            let last = starts.len().checked_sub(2).map_or(0, |index| starts[index]);
            return Some(last as f64 / 1000.0);
        }
        self.assets.videos.get(id).map(|info| {
            if info.fps > 0.0 {
                (info.duration - 1.0 / info.fps).max(0.0)
            } else {
                info.duration
            }
        })
    }

    /// 动图：`sample(sourceTime)` 一次查表。与 video 不同，这里没有解码器状态，
    /// 也就没有"回退要重开管道"这回事——乱序采样与顺序采样同价。
    pub fn animated_frame(&self, id: &str, mtime_ms: i64) -> Option<Result<Arc<Pixmap>>> {
        self.animated_frame_for_target(id, mtime_ms, None)
    }

    /// **矢量动图**（Lottie / SMIL 动画 SVG）的自然尺寸；位图动图与视频返回
    /// `None`。
    ///
    /// 调用方用它先量几何、再决定要多大一张纹理（见
    /// [`Self::animated_frame_for_target`]）。位图动图不在其列：它们的帧尺寸就是
    /// 源数据本身，"换个尺寸取"只会多一次重采样，缩放交给 GPU 更划算。
    pub fn vector_natural_size(&self, id: &str) -> Option<(u32, u32)> {
        if let Some(lottie) = self.assets.lotties.get(id) {
            let meta = lottie.metadata();
            return Some((meta.width.max(1), meta.height.max(1)));
        }
        if let Some(program) = self.assets.programs.get(id) {
            return Some((program.width().max(1), program.height().max(1)));
        }
        let svg = self.assets.animated_svgs.get(id)?;
        if let Some(size) = self.svg_natural.lock().ok()?.get(id) {
            return Some(*size);
        }
        // 动画 SVG 的天然尺寸只有解出来才知道；解一帧、把尺寸记下来，之后不再解。
        let frame = svg.sample(0.0);
        let pixmap = crate::assets::decode_image("frame.svg", frame.as_bytes()).ok()?;
        let size = (pixmap.width().max(1), pixmap.height().max(1));
        if let Ok(mut natural) = self.svg_natural.lock() {
            natural.insert(id.to_owned(), size);
        }
        Some(size)
    }

    /// 动图取帧，矢量源按 `target` 给的**目标像素尺寸**光栅。
    ///
    /// `target = None` ＝ 按自然尺寸（既有行为）。位图动图一律忽略 `target`。
    /// 目标尺寸进缓存键：同一格在两种尺寸下是两张图，不能互相顶替。
    pub fn animated_frame_for_target(
        &self,
        id: &str,
        mtime_ms: i64,
        target: Option<(u32, u32)>,
    ) -> Option<Result<Arc<Pixmap>>> {
        let (target_width, target_height) = target_key(target);
        if let Some(svg) = self.assets.animated_svgs.get(id) {
            let key = (id.to_owned(), mtime_ms, target_width, target_height);
            if let Some(hit) = self.animated_cache.get(&key) {
                return Some(Ok(hit));
            }
            let frame = svg.sample(mtime_ms as f64 / 1000.0);
            let decoded = match target {
                // 等比：长边落到目标长边，短边跟着走（与 `decode_svg_at_long_edge`
                // 同一条取整规则）。
                Some((width, height)) => {
                    crate::assets::decode_svg_at_long_edge(frame.as_bytes(), width.max(height))
                }
                None => crate::assets::decode_image("frame.svg", frame.as_bytes()),
            };
            return Some(decoded.map(|pixmap| {
                let pixmap = Arc::new(pixmap);
                self.animated_cache.put(key, pixmap.clone());
                pixmap
            }));
        }
        if let Some(lottie) = self.assets.lotties.get(id) {
            let time = MediaTime::from_millis(mtime_ms);
            let meta = lottie.metadata();
            // 键取**帧起点**而不是请求时刻：同一格内的任意时刻画出来逐字节相同
            // （`Lottie::sample_scaled` 只读 `frame_at`），按请求时刻建键等于让
            // 缓存永不命中。
            let start_ms = meta.frame_start(time).millis();
            let key = (id.to_owned(), start_ms, target_width, target_height);
            if let Some(hit) = self.animated_cache.get(&key) {
                return Some(Ok(hit));
            }
            let (width, height) = target.unwrap_or((meta.width, meta.height));
            return Some(lottie.sample_scaled(time, width, height).map(|frame| {
                self.animated_cache.put(key, frame.pixmap.clone());
                frame.pixmap
            }));
        }
        if let Some(program) = self.assets.programs.get(id) {
            // 同 Lottie：键取帧起点，同一帧窗口里的时刻共用一张图。
            let start_ms = program.frame_start_ms(mtime_ms);
            let key = (id.to_owned(), start_ms, target_width, target_height);
            if let Some(hit) = self.animated_cache.get(&key) {
                return Some(Ok(hit));
            }
            return Some(program.render(start_ms, target).map(|pixmap| {
                let pixmap = Arc::new(pixmap);
                self.animated_cache.put(key, pixmap.clone());
                pixmap
            }));
        }
        let src = self.assets.animated.get(id)?;
        let time = MediaTime::from_millis(mtime_ms);
        let start_ms = src.metadata().frame_start(time).millis();
        let key = (id.to_owned(), start_ms, 0, 0);
        if let Some(hit) = self.animated_cache.get(&key) {
            return Some(Ok(hit));
        }
        Some(src.sample(time).map(|frame| {
            self.animated_cache.put(key, frame.pixmap.clone());
            frame.pixmap
        }))
    }

    pub fn video_frame(&mut self, id: &str, mtime: f64) -> Result<Arc<Pixmap>> {
        if !mtime.is_finite() {
            bail!("media-time-invalid: 非有限源时间");
        }
        if let Some(source) = self.external_video.get_mut(id) {
            return source.frame(id, (mtime.max(0.0) * 1000.0).round() as i64);
        }
        // Only validate a source when this frame actually needs it. Inactive
        // videos and the document's audio catalog are not polled every frame.
        if let Some(info) = self.assets.videos.get(id) {
            self.assets.validate_media_file(&info.path)?;
        }
        let cache_key = (id.to_owned(), mtime.max(0.0).to_bits() as i64, 0, 0);
        if !self.keyframe_snap
            && let Some(hit) = self.video_cache.get(&cache_key)
        {
            return Ok(hit);
        }
        if !self.readers.contains_key(id) {
            let info = self
                .assets
                .videos
                .get(id)
                .ok_or_else(|| anyhow!("视频资源 \"{id}\" 未加载"))?
                .clone();
            let mut reader = VideoReader::new(info, self.fps, self.random_access);
            reader.snap = self.keyframe_snap;
            self.readers.insert(id.to_string(), reader);
        }
        let reader = self.readers.get_mut(id).expect("reader");
        let was_disabled = reader.native_disabled;
        let frame = reader.frame_at(mtime)?;
        if reader.native_disabled != was_disabled
            && let Ok(mut cache) = self.video_cache.entries.lock()
        {
            cache.clear();
        }
        if let Some(info) = self.assets.videos.get(id) {
            self.assets.validate_media_file(&info.path)?;
        }
        if !self.keyframe_snap {
            self.video_cache.put(cache_key, frame.clone());
        }
        Ok(frame)
    }

    /// 这个视频源实际在用的解码后端（`avfoundation` / `media-foundation` /
    /// [`FFMPEG_BACKEND`]）。`None` = 还没为它开过解码器。
    ///
    /// §15.1 的「解码后端必须可观测」：原生与 ffmpeg 的像素只承诺语义等价 +
    /// 容差，任何跨路径对拍或诊断都必须能说出自己量的是哪一侧。
    pub fn video_backend(&self, id: &str) -> Option<&'static str> {
        if self.external_video.contains_key(id) {
            return Some("composition");
        }
        self.readers.get(id).map(|reader| reader.backend)
    }

    /// 注入准备好的画面源。替换时释放旧解码器；具体编译与依赖读取留在宿主。
    pub fn insert_video_source(
        &mut self,
        id: String,
        source: Box<dyn crate::raster::FrameMedia + Send>,
    ) {
        self.readers.remove(&id);
        self.external_video.insert(id, source);
    }
}

impl Drop for VideoReader {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::premultiply_in_place;

    /// 不透明帧是恒等变换——存量视频的像素一个字节都不变。
    #[test]
    fn an_opaque_frame_passes_through_untouched() {
        let mut rgba = vec![10, 200, 30, 255, 0, 0, 0, 255, 255, 255, 255, 255];
        let before = rgba.clone();
        premultiply_in_place(&mut rgba);
        assert_eq!(rgba, before);
    }

    /// 带 alpha 的帧按 tiny-skia 的取整规则预乘：α = 0 全清零，
    /// α = 128 约等于半亮，α = 255 原样。
    #[test]
    fn a_frame_with_alpha_is_premultiplied() {
        let mut rgba = vec![
            255, 255, 255, 0, // 全透明 → 全零
            255, 255, 255, 128, // 半透明白
            200, 100, 50, 255, // 不透明原样
        ];
        premultiply_in_place(&mut rgba);
        assert_eq!(&rgba[0..4], &[0, 0, 0, 0]);
        assert_eq!(rgba[7], 128);
        for channel in &rgba[4..7] {
            assert!(*channel <= 128 && *channel >= 126, "{channel}");
        }
        assert_eq!(&rgba[8..12], &[200, 100, 50, 255]);
    }

    /// 幂等：预乘过的字节再走一遍不会二次变暗（α = 255 与 α = 0 都是不动点，
    /// 中间值只在取整误差内）——这条挡住"某天有人在两处都调一次"。
    #[test]
    fn premultiplying_a_fully_transparent_or_opaque_frame_is_idempotent() {
        let mut rgba = vec![9, 9, 9, 0, 7, 7, 7, 255];
        premultiply_in_place(&mut rgba);
        let once = rgba.clone();
        premultiply_in_place(&mut rgba);
        assert_eq!(rgba, once);
    }
}
