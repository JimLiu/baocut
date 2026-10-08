//! 解码：ffmpeg 子进程把画面解成原始 RGBA 帧，经管道读出（`-f rawvideo -pix_fmt rgba`）。
//!
//! 每个视频实例一条顺序的解码流：导出的源时刻单调向前，流也只向前读，不逐帧重新定位。帧的时刻来自 `showinfo`
//! 滤镜（stderr），与 stdout 上的帧一一对应；`-copyts` 保留素材自己的时间戳，减去素材的 PTS 原点就是源时刻。
//! 取帧的规则与预览的媒体元素一致：取时间戳不晚于目标时刻的最后一帧（目标在第一帧之前时取第一帧，读到末尾之后停在最后一帧）。
//! 倒退或向前跳得很远时重开解码流，从目标前的关键帧开始。ffmpeg 按旋转元数据自动转正。

use std::io::{BufRead, BufReader, ErrorKind, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::mpsc::{Receiver, channel};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use crate::{MediaError, Picture, Tools, tail};

/// 帧时间戳与目标时刻的容差（秒）：精确的源时刻换成浮点之后与帧的时间戳可能差在末位。
const EPSILON: f64 = 1e-4;
/// 目标比下一帧还晚这么多秒时，重新定位比一路解过去快。
const JUMP_SECONDS: f64 = 5.0;
/// 重开时从目标之前这么多秒的位置找关键帧。
const SEEK_MARGIN: f64 = 0.05;

struct Timed {
    seconds: f64,
    picture: Picture,
}

struct Stream {
    child: Child,
    stdout: ChildStdout,
    times: Receiver<f64>,
    log: Arc<Mutex<String>>,
    reader: Option<JoinHandle<()>>,
}

impl Stream {
    fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
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
    spare: Vec<u8>,
    ended: bool,
    restarts: u32,
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
            restarts: 0,
        }
    }

    /// 重新定位的次数（第一次启动不算）。顺序导出里应当是 0。
    pub fn restarts(&self) -> u32 {
        self.restarts
    }

    /// 源时刻 `seconds` 的画面。
    pub fn frame_at(&mut self, seconds: f64) -> Result<&Picture, MediaError> {
        let target = seconds + EPSILON;
        let behind = self.current.as_ref().is_some_and(|c| target < c.seconds);
        let far = self.next.as_ref().is_some_and(|n| seconds - n.seconds > JUMP_SECONDS);
        if self.stream.is_none() && !self.ended || behind || far {
            if self.stream.is_some() || self.ended {
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
                    if let Some(old) = self.current.replace(next) {
                        self.spare = old.picture.data;
                    }
                }
                _ => break,
            }
        }
        match &self.current {
            Some(current) => Ok(&current.picture),
            None => Err(MediaError::new(
                "EXPORT_DECODE_FAILED",
                format!("{} 里解不出画面", self.path.display()),
            )),
        }
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
        self.stream = Some(Stream {
            child,
            stdout,
            times,
            log,
            reader: Some(reader),
        });
        Ok(())
    }

    /// 读下一帧；流结束时为 `None`。进程失败、一帧都没有时报错。
    fn read(&mut self) -> Result<Option<Timed>, MediaError> {
        let Some(stream) = self.stream.as_mut() else {
            return Ok(None);
        };
        let mut data = std::mem::take(&mut self.spare);
        data.resize(Picture::byte_len(self.width, self.height), 0);
        match stream.stdout.read_exact(&mut data) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::UnexpectedEof => {
                let status = stream.child.wait().ok();
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
                self.spare = data;
                return Ok(None);
            }
            Err(e) => {
                return Err(MediaError::new("EXPORT_DECODE_FAILED", format!("读解码输出失败：{e}")));
            }
        }
        let pts = stream
            .times
            .recv()
            .map_err(|_| MediaError::new("EXPORT_DECODE_FAILED", "解码的帧没有时间戳"))?;
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
