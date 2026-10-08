//! 解码：ffmpeg 子进程把画面解成原始 RGBA 帧，经管道读出（`-f rawvideo -pix_fmt rgba`）。
//!
//! 每个视频实例一条顺序的解码流：导出的源时刻单调向前，流也只向前读，不逐帧重新定位。帧的时刻来自 `showinfo`
//! 滤镜（stderr），与 stdout 上的帧一一对应；`-copyts` 保留素材自己的时间戳，减去素材的 PTS 原点就是源时刻。
//! 取帧的规则与预览的媒体元素一致：取时间戳不晚于目标时刻的最后一帧（目标在第一帧之前时取第一帧，读到末尾之后停在最后一帧）。
//! 倒退或向前跳得很远时重开解码流，从目标前的关键帧开始。ffmpeg 按旋转元数据自动转正。
//! 每条流有一个读帧线程，把管道里的帧读在取帧前面（有界的几帧），取帧时 ffmpeg 已经解好的帧不用再等管道。

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

/// 读帧线程交出来的：一帧（像素与 `showinfo` 的原始时间戳）、流读完了、或读失败。
enum Chunk {
    Frame(Vec<u8>, f64),
    End,
    Failed(String),
}

struct Stream {
    child: Child,
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
        let _ = self.child.kill();
        let _ = self.child.wait();
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
        }
    }

    /// 顺序导出里只有素材闲置后又用到、倒退或远跳时才不是 0。
    /// 顺序导出里应当是 0。
    pub fn restarts(&self) -> u32 {
        self.restarts
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
        let (frames, pulled) = sync_channel(READ_AHEAD);
        let (recycle, spares) = channel();
        let spare = std::mem::take(&mut self.spare);
        if !spare.is_empty() {
            let _ = recycle.send(spare);
        }
        let len = Picture::byte_len(self.width, self.height);
        let puller = std::thread::spawn(move || pull_frames(stdout, times, spares, frames, len));
        self.stream = Some(Stream {
            child,
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

    /// 读下一帧（读帧线程读好了就不等）；流结束时为 `None`。进程失败、一帧都没有时报错。
    fn read(&mut self) -> Result<Option<Timed>, MediaError> {
        let Some(stream) = self.stream.as_mut() else {
            return Ok(None);
        };
        let chunk = stream.frames.as_ref().and_then(|frames| frames.recv().ok()).unwrap_or(Chunk::End);
        let (data, pts) = match chunk {
            Chunk::Frame(data, pts) => (data, pts),
            Chunk::End => {
                let status = stream.child.wait().ok();
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
    use super::pts_time;

    #[test]
    fn reads_pts_time_from_showinfo() {
        let line = "[Parsed_showinfo_0 @ 0x6000] n:   3 pts:   1536 pts_time:0.1       duration:    512 duration_time:0.0333333";
        assert_eq!(pts_time(line), Some(0.1));
        assert_eq!(pts_time("[Parsed_showinfo_0 @ 0x1] n: 0 pts: NOPTS pts_time:NOPTS"), None);
    }
}
