//! 解码：ffmpeg 子进程把画面解成原始 RGBA 帧，经管道读出（`-f rawvideo -pix_fmt rgba`）。
//!
//! 每个视频实例一条顺序的解码流：导出的源时刻单调向前，流也只向前读，不逐帧重新定位。帧的时刻来自 `showinfo`
//! 滤镜（stderr），与 stdout 上的帧一一对应；`-copyts` 保留素材自己的时间戳，减去素材的 PTS 原点就是源时刻。
//! 取帧的规则与预览的媒体元素一致：取时间戳不晚于目标时刻的最后一帧（目标在第一帧之前时取第一帧，读到末尾之后停在最后一帧）。
//! 倒退或向前跳得很远时重开解码流，从目标前的关键帧开始。ffmpeg 按旋转元数据自动转正。
//! 每条流有一个读帧线程，把管道里的帧读在取帧前面（有界的几帧），取帧时 ffmpeg 已经解好的帧不用再等管道。
//!
//! ## 原生解码优先
//!
//! 调用方可以用 [`VideoDecoder::with_native`] 挂一个平台原生的顺序帧源（[`FrameFeed`]，比如 AVFoundation 的
//! asset reader）。挂上之后每条解码流先走原生帧源，取帧规则、倒退 / 远跳重开、读帧线程与缓冲回收都和 ffmpeg 流一样；
//! 原生帧源的时间戳必须与 ffmpeg `-copyts` 同一条时间线（素材自己的 PTS，含 PTS 原点）。
//! 原生打不开、读到一半失败、或一帧都交不出时，这个解码器**就此改走 ffmpeg**（从同一时刻接着解），
//! 回落原因记在 [`VideoDecoder::fallback`]；回落引起的重开不计入 [`VideoDecoder::restarts`]。
//! 本 crate 不依赖任何平台库：原生帧源由调用方构造。

use std::io::{BufRead, BufReader, ErrorKind, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::mpsc::{Receiver, Sender, SyncSender, channel, sync_channel};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use crate::{MediaError, Picture, Tools, tail};

/// 帧时间戳与目标时刻的容差（秒）：精确的源时刻换成浮点之后与帧的时间戳可能差在末位。
const EPSILON: f64 = 1e-4;
/// 目标比下一帧还晚这么多秒时，重新定位比一路解过去快。
const JUMP_SECONDS: f64 = 5.0;
/// 重开时从目标之前这么多秒的位置找关键帧。
const SEEK_MARGIN: f64 = 0.05;
/// 读帧线程最多读在前面这么多帧（每帧一个缓冲，1080p 的 RGBA 一帧 8.3 MB）。
const READ_AHEAD: usize = 2;

struct Timed {
    seconds: f64,
    picture: Picture,
}

/// 读帧线程交出来的：一帧（像素与素材时间线上的原始时间戳）、流读完了、或读失败。
enum Chunk {
    Frame(Vec<u8>, f64),
    End,
    Failed(String),
    /// 原生帧源失败（原因代码、说明）：解码器据此回落 ffmpeg。
    NativeFailed(&'static str, String),
}

/// 平台原生的顺序帧源：按呈现顺序交出 RGBA 帧。
///
/// 每帧写进 `data`（长度必须恰为 `width * height * 4`，紧密排布、top-down、alpha 不透明），返回该帧在素材时间线上的
/// 时间戳（秒，与 ffmpeg `-copyts` 一致，**不**减 PTS 原点）；读完返回 `None`，失败返回说明。
/// 帧源只在读帧线程里构造与使用，不要求 `Send`。
pub trait FrameFeed {
    fn next_into(&mut self, data: &mut Vec<u8>) -> Result<Option<f64>, String>;
}

/// 打开原生帧源：`(素材路径, 起点（素材时间线上的秒）, 输出宽, 输出高)`。第一帧应当覆盖起点。
pub type FeedOpener = Arc<dyn Fn(&Path, f64, u32, u32) -> Result<Box<dyn FrameFeed>, String> + Send + Sync>;

/// 挂到 [`VideoDecoder`] 上的原生解码：后端名（诊断用，如 `avfoundation`）与帧源的打开方式。
#[derive(Clone)]
pub struct NativeDecode {
    pub backend: &'static str,
    pub open: FeedOpener,
}

/// 原生解码回落 ffmpeg 的记录。`reason` 是英文代码：`open-failed`、`read-failed`、`no-frames`。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecodeFallback {
    pub reason: &'static str,
    pub message: String,
}

struct Stream {
    /// ffmpeg 解码进程；原生帧源没有子进程。
    child: Option<Child>,
    /// 读帧线程读在前面的帧（有界）。
    frames: Option<Receiver<Chunk>>,
    /// 用过的帧缓冲送回读帧线程。
    recycle: Sender<Vec<u8>>,
    log: Arc<Mutex<String>>,
    /// 读 stderr（`showinfo` 的时间戳与日志）的线程。
    reader: Option<JoinHandle<()>>,
    /// 读 stdout 帧的线程。
    puller: Option<JoinHandle<()>>,
}

impl Stream {
    fn stop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        // 读帧线程可能卡在队列满的发送上：先丢掉接收端，再等它。
        drop(self.frames.take());
        if let Some(puller) = self.puller.take() {
            let _ = puller.join();
        }
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

/// 读帧线程：从 ffmpeg 的 stdout 一帧一帧读满，配上 stderr 线程给的时间戳，读在合成前面最多 [`READ_AHEAD`] 帧。
fn pull_frames(mut stdout: ChildStdout, times: Receiver<f64>, spares: Receiver<Vec<u8>>, frames: SyncSender<Chunk>, len: usize) {
    loop {
        let mut data = spares.try_recv().unwrap_or_default();
        data.resize(len, 0);
        let chunk = match stdout.read_exact(&mut data) {
            Ok(()) => match times.recv() {
                Ok(pts) => Chunk::Frame(data, pts),
                Err(_) => Chunk::Failed("解码的帧没有时间戳".into()),
            },
            Err(e) if e.kind() == ErrorKind::UnexpectedEof => Chunk::End,
            Err(e) => Chunk::Failed(format!("读解码输出失败：{e}")),
        };
        let last = !matches!(chunk, Chunk::Frame(..));
        if frames.send(chunk).is_err() || last {
            break;
        }
    }
}

/// 原生读帧线程：在线程里打开帧源（帧源不必 `Send`），一帧一帧读在合成前面，规则同 [`pull_frames`]。
/// 打不开、读失败、尺寸不符或一帧都没有，都以 [`Chunk::NativeFailed`] 交回，由解码器回落 ffmpeg。
fn pull_native(native: NativeDecode, path: PathBuf, from: f64, size: (u32, u32), spares: Receiver<Vec<u8>>, frames: SyncSender<Chunk>) {
    let mut feed = match (native.open)(&path, from, size.0, size.1) {
        Ok(feed) => feed,
        Err(message) => {
            let _ = frames.send(Chunk::NativeFailed("open-failed", message));
            return;
        }
    };
    let len = Picture::byte_len(size.0, size.1);
    let mut delivered = 0_u64;
    loop {
        let mut data = spares.try_recv().unwrap_or_default();
        let chunk = match feed.next_into(&mut data) {
            Ok(Some(pts)) if data.len() == len => {
                delivered += 1;
                Chunk::Frame(data, pts)
            }
            Ok(Some(_)) => Chunk::NativeFailed("read-failed", format!("原生解码交出的帧是 {} 字节，应为 {len}", data.len())),
            Ok(None) if delivered == 0 => Chunk::NativeFailed("no-frames", format!("原生解码从 {from:.3} 秒起一帧都没有")),
            Ok(None) => Chunk::End,
            Err(message) => Chunk::NativeFailed("read-failed", message),
        };
        let last = !matches!(chunk, Chunk::Frame(..));
        if frames.send(chunk).is_err() || last {
            break;
        }
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        self.stop();
    }
}

/// 一个视频实例的顺序解码流。
pub struct VideoDecoder {
    tools: Tools,
    path: PathBuf,
    origin: f64,
    width: u32,
    height: u32,
    stream: Option<Stream>,
    current: Option<Timed>,
    next: Option<Timed>,
    /// 没有解码流时留着的一个帧缓冲，下一条流先用它。
    spare: Vec<u8>,
    ended: bool,
    /// 启动过解码流：之后再启动（倒退、远跳、关掉之后再用到）都算重开。
    started: bool,
    restarts: u32,
    /// 当前帧的代号：每换上一帧加一，重开之后接着数，不回头。
    generation: u64,
    /// 挂着的原生解码；回落 ffmpeg 之后清空，不再尝试。
    native: Option<NativeDecode>,
    /// 原生回落的记录（只记第一次）。
    fallback: Option<DecodeFallback>,
    /// 当前流从哪个源时刻起解（回落时没有当前帧就从这里接着解）。
    from: f64,
}

impl VideoDecoder {
    /// `origin` 是素材的 PTS 原点（秒），源时刻 0 对应它；画面缩放到 `width`×`height` 输出。第一次取帧时才启动 ffmpeg。
    pub fn new(tools: &Tools, path: &Path, origin: f64, width: u32, height: u32) -> VideoDecoder {
        VideoDecoder {
            tools: tools.clone(),
            path: path.to_path_buf(),
            origin,
            width,
            height,
            stream: None,
            current: None,
            next: None,
            spare: Vec::new(),
            ended: false,
            started: false,
            restarts: 0,
            generation: 0,
            native: None,
            fallback: None,
            from: 0.0,
        }
    }

    /// 先走原生帧源，失败再回落 ffmpeg（见模块文档）。要在第一次取帧之前挂上。
    pub fn with_native(mut self, native: NativeDecode) -> VideoDecoder {
        self.native = Some(native);
        self
    }

    /// 顺序导出里只有素材闲置后又用到、倒退或远跳时才不是 0。
    /// 顺序导出里应当是 0。原生回落 ffmpeg 引起的重开不算。
    pub fn restarts(&self) -> u32 {
        self.restarts
    }

    /// 正在用（或将要用）的解码后端：原生后端名，或 `ffmpeg`。
    pub fn backend(&self) -> &'static str {
        self.native.as_ref().map_or("ffmpeg", |native| native.backend)
    }

    /// 原生解码回落 ffmpeg 的记录；没有挂原生或没回落时为 `None`。
    pub fn fallback(&self) -> Option<&DecodeFallback> {
        self.fallback.as_ref()
    }

    /// 源时刻 `seconds` 的画面。
    pub fn frame_at(&mut self, seconds: f64) -> Result<&Picture, MediaError> {
        self.advance(seconds)?;
        Ok(&self.current.as_ref().expect("advance 成功就有当前帧").picture)
    }

    /// 走到源时刻 `seconds` 的画面（规则同 [`frame_at`](Self::frame_at)），返回当前帧的代号：与上一次相同说明还是同一帧。
    pub fn advance(&mut self, seconds: f64) -> Result<u64, MediaError> {
        let target = seconds + EPSILON;
        let behind = self.current.as_ref().is_some_and(|c| target < c.seconds);
        let far = self.next.as_ref().is_some_and(|n| seconds - n.seconds > JUMP_SECONDS);
        if self.stream.is_none() && !self.ended || behind || far {
            if self.started {
                self.restarts += 1;
            }
            self.start(seconds)?;
        }
        loop {
            if self.next.is_none() && !self.ended {
                self.next = self.read()?;
                if self.next.is_none() {
                    self.ended = true;
                    if let Some(mut stream) = self.stream.take() {
                        stream.stop();
                    }
                }
            }
            match &self.next {
                Some(next) if next.seconds <= target || self.current.is_none() => {
                    let next = self.next.take().expect("上面看过");
                    self.generation += 1;
                    if let Some(old) = self.current.replace(next) {
                        self.recycle(old.picture.data);
                    }
                }
                _ => break,
            }
        }
        match &self.current {
            Some(_) => Ok(self.generation),
            None => Err(MediaError::new(
                "EXPORT_DECODE_FAILED",
                format!("{} 里解不出画面", self.path.display()),
            )),
        }
    }

    /// 把当前帧的像素换出来，留下 `spare`（长度不限，之后回收给读帧线程）：调用方拿走像素，不再复制一遍。
    /// 换出之后当前帧的像素不再有效，直到 [`advance`](Self::advance) 换上新的一帧（代号变了）；
    /// 同一帧不要再用 [`frame_at`](Self::frame_at) 读。没有当前帧时为 `None`。
    pub fn swap_current(&mut self, spare: Vec<u8>) -> Option<Picture> {
        let current = self.current.as_mut()?;
        let data = std::mem::replace(&mut current.picture.data, spare);
        Some(Picture {
            width: current.picture.width,
            height: current.picture.height,
            data,
        })
    }

    /// 停下解码进程，留着最后一帧之外的状态都丢掉。
    pub fn close(&mut self) {
        if let Some(mut stream) = self.stream.take() {
            stream.stop();
        }
        self.current = None;
        self.next = None;
        self.ended = false;
    }

    fn start(&mut self, seconds: f64) -> Result<(), MediaError> {
        if let Some(mut stream) = self.stream.take() {
            stream.stop();
        }
        if let Some(old) = self.current.take() {
            self.spare = old.picture.data;
        }
        self.next = None;
        self.ended = false;
        self.started = true;
        self.open_stream(seconds)
    }

    /// 从源时刻 `seconds` 开一条解码流（有原生就走原生），不动当前帧。
    fn open_stream(&mut self, seconds: f64) -> Result<(), MediaError> {
        if let Some(mut stream) = self.stream.take() {
            stream.stop();
        }
        self.from = seconds;
        let (frames, pulled) = sync_channel(READ_AHEAD);
        let (recycle, spares) = channel();
        let spare = std::mem::take(&mut self.spare);
        if !spare.is_empty() {
            let _ = recycle.send(spare);
        }
        if let Some(native) = self.native.clone() {
            // 原生帧源与 ffmpeg `-copyts` 同一条时间线：起点要加上 PTS 原点。原生 reader 交出的第一帧就覆盖起点，
            // 不必像 ffmpeg 那样往前留余量找关键帧。
            let from = (self.origin + seconds).max(0.0);
            let path = self.path.clone();
            let size = (self.width, self.height);
            let puller = std::thread::spawn(move || pull_native(native, path, from, size, spares, frames));
            self.stream = Some(Stream {
                child: None,
                frames: Some(pulled),
                recycle,
                log: Arc::new(Mutex::new(String::new())),
                reader: None,
                puller: Some(puller),
            });
            return Ok(());
        }
        let seek = seconds - SEEK_MARGIN;
        let mut command = Command::new(&self.tools.ffmpeg);
        command.args(["-hide_banner", "-nostdin", "-nostats", "-loglevel", "info"]);
        if seek > 0.0 {
            command.args(["-noaccurate_seek", "-ss", &format!("{seek:.6}")]);
        }
        command
            .arg("-copyts")
            .arg("-i")
            .arg(&self.path)
            .args(["-map", "0:v:0", "-an", "-sn", "-dn", "-vf"])
            .arg(format!("showinfo,scale={}:{}:flags=bicubic,format=rgba", self.width, self.height))
            .args(["-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|e| MediaError::spawn(&self.tools.ffmpeg, e))?;
        let stdout = child.stdout.take().expect("管道");
        let stderr = child.stderr.take().expect("管道");
        let (sender, times) = channel();
        let log = Arc::new(Mutex::new(String::new()));
        let sink = Arc::clone(&log);
        let reader = std::thread::spawn(move || {
            let mut last = f64::NAN;
            for line in BufReader::new(stderr).lines() {
                let Ok(line) = line else { break };
                if line.contains("Parsed_showinfo") && line.contains(" n:") {
                    let time = pts_time(&line).unwrap_or(last);
                    last = time;
                    if sender.send(time).is_err() {
                        break;
                    }
                } else if !line.contains("Parsed_showinfo") {
                    let mut log = sink.lock().expect("锁");
                    if log.len() < 64 * 1024 {
                        log.push_str(&line);
                        log.push('\n');
                    }
                }
            }
        });
        let len = Picture::byte_len(self.width, self.height);
        let puller = std::thread::spawn(move || pull_frames(stdout, times, spares, frames, len));
        self.stream = Some(Stream {
            child: Some(child),
            frames: Some(pulled),
            recycle,
            log,
            reader: Some(reader),
            puller: Some(puller),
        });
        Ok(())
    }

    /// 用过的帧缓冲：有解码流时送回读帧线程，否则留一个给下一条流。
    fn recycle(&mut self, data: Vec<u8>) {
        match &self.stream {
            Some(stream) => {
                let _ = stream.recycle.send(data);
            }
            None => self.spare = data,
        }
    }

    /// 原生帧源失败：记下原因、摘掉原生，从当前帧（没有就从这条流的起点）起改开 ffmpeg 流。当前帧留着，
    /// 之后读到的帧照常按"不晚于目标的最后一帧"替换它。不计入重开次数。
    fn fall_back(&mut self, reason: &'static str, message: String) -> Result<(), MediaError> {
        let Some(native) = self.native.take() else {
            return Err(MediaError::new("EXPORT_DECODE_FAILED", message));
        };
        if self.fallback.is_none() {
            self.fallback = Some(DecodeFallback {
                reason,
                message: format!("{}: {message}", native.backend),
            });
        }
        let resume = self.current.as_ref().map_or(self.from, |current| current.seconds.max(0.0));
        self.open_stream(resume)
    }

    /// 读下一帧（读帧线程读好了就不等）；流结束时为 `None`。进程失败、一帧都没有时报错。
    fn read(&mut self) -> Result<Option<Timed>, MediaError> {
        let Some(stream) = self.stream.as_mut() else {
            return Ok(None);
        };
        let chunk = stream.frames.as_ref().and_then(|frames| frames.recv().ok()).unwrap_or(Chunk::End);
        let (data, pts) = match chunk {
            Chunk::Frame(data, pts) => (data, pts),
            Chunk::End => {
                let status = stream.child.as_mut().and_then(|child| child.wait().ok());
                if let Some(puller) = stream.puller.take() {
                    let _ = puller.join();
                }
                if let Some(reader) = stream.reader.take() {
                    let _ = reader.join();
                }
                let failed = status.is_some_and(|s| !s.success());
                if failed && self.current.is_none() {
                    let log = stream.log.lock().expect("锁").clone();
                    return Err(MediaError::new(
                        "EXPORT_DECODE_FAILED",
                        format!("解码 {} 失败：{}", self.path.display(), tail(&log, 3)),
                    ));
                }
                return Ok(None);
            }
            Chunk::Failed(message) => return Err(MediaError::new("EXPORT_DECODE_FAILED", message)),
            Chunk::NativeFailed(reason, message) => {
                self.fall_back(reason, message)?;
                return self.read();
            }
        };
        let seconds = if pts.is_finite() {
            pts - self.origin
        } else {
            self.current.as_ref().map_or(0.0, |c| c.seconds)
        };
        Ok(Some(Timed {
            seconds,
            picture: Picture {
                width: self.width,
                height: self.height,
                data,
            },
        }))
    }
}

fn pts_time(line: &str) -> Option<f64> {
    let rest = &line[line.find("pts_time:")? + "pts_time:".len()..];
    rest.split_whitespace().next()?.parse().ok()
}

/// 图片（或视频的第一帧）解成一帧，缩放到 `width`×`height`。GIF 与动图只取第一帧。
pub fn decode_still(tools: &Tools, path: &Path, width: u32, height: u32) -> Result<Picture, MediaError> {
    let output = Command::new(&tools.ffmpeg)
        .args(["-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-i"])
        .arg(path)
        .args(["-map", "0:v:0", "-frames:v", "1", "-vf"])
        .arg(format!("scale={width}:{height}:flags=bicubic,format=rgba"))
        .args(["-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| MediaError::spawn(&tools.ffmpeg, e))?;
    let expected = Picture::byte_len(width, height);
    if !output.status.success() || output.stdout.len() < expected {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(MediaError::new(
            "EXPORT_DECODE_FAILED",
            format!("解码 {} 失败：{}", path.display(), tail(&stderr, 3)),
        ));
    }
    let mut data = output.stdout;
    data.truncate(expected);
    Ok(Picture { width, height, data })
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};

    use super::{FeedOpener, FrameFeed, NativeDecode, VideoDecoder, pts_time};
    use crate::Tools;

    /// 假的原生帧源：10 fps、`count` 帧，素材时间线从 `origin` 起；每帧的像素填帧号；第 `fail_at` 帧报错。
    struct Fake {
        next: u32,
        count: u32,
        origin: f64,
        fail_at: Option<u32>,
        len: usize,
    }

    impl FrameFeed for Fake {
        fn next_into(&mut self, data: &mut Vec<u8>) -> Result<Option<f64>, String> {
            if Some(self.next) == self.fail_at {
                return Err("坏帧".into());
            }
            if self.next >= self.count {
                return Ok(None);
            }
            data.clear();
            data.resize(self.len, self.next as u8);
            let pts = self.origin + f64::from(self.next) / 10.0;
            self.next += 1;
            Ok(Some(pts))
        }
    }

    /// 打开记录（素材时间线上的起点）与帧源工厂。`fail_open` 时打不开。
    fn fake(origin: f64, fail_open: bool, fail_at: Option<u32>) -> (NativeDecode, Arc<Mutex<Vec<f64>>>) {
        let opens = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&opens);
        let open: FeedOpener = Arc::new(move |_: &Path, from: f64, width: u32, height: u32| {
            seen.lock().unwrap().push(from);
            if fail_open {
                return Err("不支持的编码".to_string());
            }
            let first = ((from - origin) * 10.0 + 1e-6).floor().max(0.0) as u32;
            Ok(Box::new(Fake {
                next: first,
                count: 30,
                origin,
                fail_at,
                len: width as usize * height as usize * 4,
            }) as Box<dyn FrameFeed>)
        });
        (NativeDecode { backend: "fake", open }, opens)
    }

    /// 不存在的 ffmpeg：回落之后一启动就失败，测试不依赖本机 ffmpeg。
    fn no_ffmpeg() -> Tools {
        Tools {
            ffmpeg: PathBuf::from("/nonexistent/ffmpeg"),
            ffprobe: PathBuf::from("/nonexistent/ffprobe"),
        }
    }

    #[test]
    fn native_frames_follow_the_same_pick_and_restart_rules() {
        let (native, opens) = fake(10.0, false, None);
        let mut decoder = VideoDecoder::new(&no_ffmpeg(), Path::new("a.mp4"), 10.0, 4, 2).with_native(native);
        assert_eq!(decoder.backend(), "fake");
        // 0.25 秒：不晚于它的最后一帧是第 2 帧（0.2）。
        assert_eq!(decoder.frame_at(0.25).unwrap().data[0], 2);
        let first = decoder.advance(0.25).unwrap();
        assert_eq!(decoder.advance(0.29).unwrap(), first, "同一帧代号不变");
        assert_eq!(decoder.frame_at(1.0).unwrap().data[0], 10);
        assert_eq!(decoder.restarts(), 0);
        // 倒退：重开，计一次；起点按素材时间线（加 PTS 原点）。
        assert_eq!(decoder.frame_at(0.5).unwrap().data[0], 5);
        assert_eq!(decoder.restarts(), 1);
        assert_eq!(*opens.lock().unwrap(), vec![10.25, 10.5]);
        // 读完之后停在最后一帧。
        assert_eq!(decoder.frame_at(4.0).unwrap().data[0], 29);
        assert!(decoder.fallback().is_none());
    }

    #[test]
    fn an_unopenable_native_source_falls_back_to_ffmpeg_without_counting_a_restart() {
        let (native, _) = fake(0.0, true, None);
        let mut decoder = VideoDecoder::new(&no_ffmpeg(), Path::new("a.mkv"), 0.0, 4, 2).with_native(native);
        // 回落之后启动 ffmpeg：这里没有 ffmpeg，报的是启动失败。
        let error = decoder.frame_at(0.0).unwrap_err();
        assert_ne!(error.code, "EXPORT_DECODE_FAILED", "{error:?}");
        let fallback = decoder.fallback().expect("记下回落");
        assert_eq!(fallback.reason, "open-failed");
        assert!(fallback.message.contains("不支持的编码"), "{}", fallback.message);
        assert_eq!(decoder.backend(), "ffmpeg");
        assert_eq!(decoder.restarts(), 0);
    }

    #[test]
    fn a_native_read_failure_mid_stream_falls_back_and_keeps_the_current_frame() {
        let (native, _) = fake(0.0, false, Some(5));
        let mut decoder = VideoDecoder::new(&no_ffmpeg(), Path::new("a.mp4"), 0.0, 4, 2).with_native(native);
        assert_eq!(decoder.frame_at(0.3).unwrap().data[0], 3);
        assert!(decoder.frame_at(1.0).is_err());
        let fallback = decoder.fallback().expect("记下回落");
        assert_eq!(fallback.reason, "read-failed");
        assert_eq!(decoder.restarts(), 0);
    }

    #[test]
    fn a_native_source_without_frames_falls_back() {
        let (native, _) = fake(0.0, false, None);
        let mut decoder = VideoDecoder::new(&no_ffmpeg(), Path::new("a.mp4"), 0.0, 4, 2).with_native(native);
        // 起点在 30 帧之后：原生一帧都交不出。
        assert!(decoder.frame_at(5.0).is_err());
        assert_eq!(decoder.fallback().map(|f| f.reason), Some("no-frames"));
    }

    #[test]
    fn reads_pts_time_from_showinfo() {
        let line = "[Parsed_showinfo_0 @ 0x6000] n:   3 pts:   1536 pts_time:0.1       duration:    512 duration_time:0.0333333";
        assert_eq!(pts_time(line), Some(0.1));
        assert_eq!(pts_time("[Parsed_showinfo_0 @ 0x1] n: 0 pts: NOPTS pts_time:NOPTS"), None);
    }
}
