//! 编码：原始 RGBA 帧写进 ffmpeg 的标准输入，按 bt709 转成 yuv420p 编码，混好的声音文件一并封装。
//!
//! 声音补静音、截到画面的长度（帧数 ÷ 帧率），两条流等长。取消时杀掉编码器（不让它收尾写出半个文件）并删掉输出。
//! [`QueuedEncoder`] 把写管道挪到单独的线程，合成不等编码器读完一帧。写线程独占的输出是一个 [`FrameSink`]：
//! ffmpeg 的 [`Encoder`]，或调用方在写线程里打开的平台原生写入器（[`QueuedEncoder::spawn`]）。

use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, SyncSender, channel, sync_channel};
use std::thread::JoinHandle;

use crate::{MediaError, Tools, tail};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VideoCodec {
    H264,
    Hevc,
    Vp9,
}

impl VideoCodec {
    pub fn parse(name: &str) -> Option<VideoCodec> {
        match name {
            "h264" => Some(VideoCodec::H264),
            "hevc" => Some(VideoCodec::Hevc),
            "vp9" => Some(VideoCodec::Vp9),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            VideoCodec::H264 => "h264",
            VideoCodec::Hevc => "hevc",
            VideoCodec::Vp9 => "vp9",
        }
    }

    /// 用的 ffmpeg 编码器。只用软件编码器：结果可复现，参数（CRF）在各平台含义相同。
    pub fn encoder(self) -> &'static str {
        match self {
            VideoCodec::H264 => "libx264",
            VideoCodec::Hevc => "libx265",
            VideoCodec::Vp9 => "libvpx-vp9",
        }
    }

    /// 不给码率也不给 CRF 时的 CRF。
    pub fn default_crf(self) -> u32 {
        match self {
            VideoCodec::H264 => 20,
            VideoCodec::Hevc => 23,
            VideoCodec::Vp9 => 32,
        }
    }

    /// CRF 的取值上限（下限是 0）。
    pub fn max_crf(self) -> u32 {
        match self {
            VideoCodec::H264 | VideoCodec::Hevc => 51,
            VideoCodec::Vp9 => 63,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Container {
    Mp4,
    Webm,
}

impl Container {
    pub fn parse(name: &str) -> Option<Container> {
        match name {
            "mp4" => Some(Container::Mp4),
            "webm" => Some(Container::Webm),
            _ => None,
        }
    }

    /// 封装能放的视频编码。
    pub fn accepts(self, codec: VideoCodec) -> bool {
        match self {
            Container::Mp4 => matches!(codec, VideoCodec::H264 | VideoCodec::Hevc),
            Container::Webm => codec == VideoCodec::Vp9,
        }
    }

    pub fn default_codec(self) -> VideoCodec {
        match self {
            Container::Mp4 => VideoCodec::H264,
            Container::Webm => VideoCodec::Vp9,
        }
    }

    /// 声音的编码器：MP4 用 AAC，WebM 用 Opus。
    pub fn audio_encoder(self) -> &'static str {
        match self {
            Container::Mp4 => "aac",
            Container::Webm => "libopus",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Quality {
    Crf(u32),
    BitrateKbps(u32),
}

#[derive(Clone, Debug)]
pub struct AudioTrack {
    pub path: PathBuf,
    pub bitrate_kbps: u32,
}

#[derive(Clone, Debug)]
pub struct EncodeSettings {
    pub width: u32,
    pub height: u32,
    pub fps_num: i64,
    pub fps_den: i64,
    pub codec: VideoCodec,
    pub container: Container,
    pub quality: Quality,
    pub audio: Option<AudioTrack>,
    /// 画面的长度（帧数 ÷ 帧率，秒）：声音补齐或截到这个长度。
    pub duration_seconds: f64,
}

impl EncodeSettings {
    /// ffmpeg 的参数（不含可执行文件）。
    pub fn arguments(&self, output: &Path) -> Vec<String> {
        let mut args: Vec<String> = ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y"]
            .map(String::from)
            .to_vec();
        args.extend([
            "-f".into(),
            "rawvideo".into(),
            "-pix_fmt".into(),
            "rgba".into(),
            "-s".into(),
            format!("{}x{}", self.width, self.height),
            "-framerate".into(),
            format!("{}/{}", self.fps_num, self.fps_den),
            "-i".into(),
            "pipe:0".into(),
        ]);
        if let Some(audio) = &self.audio {
            args.push("-i".into());
            args.push(audio.path.to_string_lossy().into_owned());
        }
        args.extend(["-map", "0:v:0"].map(String::from));
        if self.audio.is_some() {
            args.extend(["-map", "1:a:0"].map(String::from));
        }
        args.extend(
            [
                "-vf",
                "scale=out_color_matrix=bt709:out_range=tv:flags=bicubic,format=yuv420p",
                "-c:v",
                self.codec.encoder(),
            ]
            .map(String::from),
        );
        match self.codec {
            VideoCodec::H264 => args.extend(["-preset", "medium", "-profile:v", "high"].map(String::from)),
            VideoCodec::Hevc => args.extend(["-preset", "medium", "-tag:v", "hvc1", "-x265-params", "log-level=error"].map(String::from)),
            VideoCodec::Vp9 => args.extend(["-deadline", "good", "-cpu-used", "2", "-row-mt", "1"].map(String::from)),
        }
        match self.quality {
            Quality::Crf(crf) => {
                args.extend(["-crf".to_string(), crf.to_string()]);
                if self.codec == VideoCodec::Vp9 {
                    args.extend(["-b:v", "0"].map(String::from));
                }
            }
            Quality::BitrateKbps(kbps) => args.extend(["-b:v".to_string(), format!("{kbps}k")]),
        }
        args.extend(
            [
                "-colorspace",
                "bt709",
                "-color_primaries",
                "bt709",
                "-color_trc",
                "bt709",
                "-color_range",
                "tv",
            ]
            .map(String::from),
        );
        if let Some(audio) = &self.audio {
            let duration = format!("{:.6}", self.duration_seconds);
            args.extend([
                "-c:a".to_string(),
                self.container.audio_encoder().to_string(),
                "-b:a".to_string(),
                format!("{}k", audio.bitrate_kbps),
                "-af".to_string(),
                format!("apad=whole_dur={duration},atrim=end={duration}"),
            ]);
        }
        if self.container == Container::Mp4 {
            args.extend(["-movflags", "+faststart"].map(String::from));
        }
        args.push(output.to_string_lossy().into_owned());
        args
    }
}

/// 一个正在编码的输出。
pub struct Encoder {
    child: Child,
    stdin: Option<ChildStdin>,
    log: Option<JoinHandle<String>>,
    output: PathBuf,
    frame_bytes: usize,
}

impl Encoder {
    pub fn start(tools: &Tools, settings: &EncodeSettings, output: &Path) -> Result<Encoder, MediaError> {
        let mut child = Command::new(&tools.ffmpeg)
            .args(settings.arguments(output))
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| MediaError::spawn(&tools.ffmpeg, e))?;
        let stdin = child.stdin.take();
        let mut stderr = child.stderr.take().expect("管道");
        let log = std::thread::spawn(move || {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            text
        });
        Ok(Encoder {
            child,
            stdin,
            log: Some(log),
            output: output.to_path_buf(),
            frame_bytes: settings.width as usize * settings.height as usize * 4,
        })
    }

    /// 写一帧（RGBA，`width`×`height`）。
    pub fn write(&mut self, rgba: &[u8]) -> Result<(), MediaError> {
        if rgba.len() != self.frame_bytes {
            return Err(MediaError::new("EXPORT_ENCODE_FAILED", "帧的大小与输出尺寸不符"));
        }
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| MediaError::new("EXPORT_ENCODE_FAILED", "编码器已关闭"))?;
        match stdin.write_all(rgba) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == ErrorKind::BrokenPipe => {
                self.stdin = None;
                let _ = self.child.wait();
                Err(MediaError::new(
                    "EXPORT_ENCODE_FAILED",
                    format!("编码器提前退出：{}", self.log_tail()),
                ))
            }
            Err(e) => Err(MediaError::new("EXPORT_ENCODE_FAILED", format!("写编码器失败：{e}"))),
        }
    }

    /// 写完了：关掉输入，等编码器收尾。
    pub fn finish(mut self) -> Result<(), MediaError> {
        drop(self.stdin.take());
        let status = self
            .child
            .wait()
            .map_err(|e| MediaError::new("EXPORT_ENCODE_FAILED", format!("等编码器失败：{e}")))?;
        if !status.success() {
            let message = format!("编码失败：{}", self.log_tail());
            let _ = std::fs::remove_file(&self.output);
            return Err(MediaError::new("EXPORT_ENCODE_FAILED", message));
        }
        Ok(())
    }

    /// 放弃：杀掉编码器，删掉输出。
    pub fn abort(mut self) {
        drop(self.stdin.take());
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_file(&self.output);
    }

    fn log_tail(&mut self) -> String {
        let text = self.log.take().and_then(|h| h.join().ok()).unwrap_or_default();
        tail(&text, 4)
    }
}

/// [`QueuedEncoder`] 写线程独占的编码输出：ffmpeg 的 [`Encoder`]，或调用方给的原生写入器。
///
/// 约定同 [`Encoder`]：`write` 收一整帧 RGBA；`finish` 收尾，失败时不留半个文件；`abort` 停下并删掉输出。
pub trait FrameSink {
    fn write(&mut self, rgba: &[u8]) -> Result<(), MediaError>;
    fn finish(self: Box<Self>) -> Result<(), MediaError>;
    fn abort(self: Box<Self>);
}

impl FrameSink for Encoder {
    fn write(&mut self, rgba: &[u8]) -> Result<(), MediaError> {
        Encoder::write(self, rgba)
    }

    fn finish(self: Box<Self>) -> Result<(), MediaError> {
        Encoder::finish(*self)
    }

    fn abort(self: Box<Self>) {
        Encoder::abort(*self)
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        if self.stdin.is_some() {
            drop(self.stdin.take());
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

/// 在单独的线程里写编码器：合成线程把整帧交进有界队列就去画下一帧，不等管道。
///
/// 帧缓冲是一个固定的池（队列深度加一个），用过的经回收通道送回来，逐帧不分配。池里的缓冲一开始铺满 `fill`
/// （一个 RGBA 像素），之后原样回收、保留上一次写进去的内容：只写画面那一块的调用方（黑边），黑边只铺一次。
///
/// 写线程独占 [`Encoder`]：要过 [`finish`](Self::finish) 时写完队列再收尾，否则（[`abort`](Self::abort) 或直接丢掉）
/// 不再写排着的帧，杀掉编码器、删掉输出。编码器中途失败时写线程放弃并退出，合成线程下一次取缓冲或交帧就失败，
/// 拿到的是写线程的错误。
pub struct QueuedEncoder {
    frames: Option<SyncSender<Vec<u8>>>,
    empty: Receiver<Vec<u8>>,
    finishing: Arc<AtomicBool>,
    aborting: Arc<AtomicBool>,
    writer: Option<JoinHandle<Result<(), MediaError>>>,
    frame_bytes: usize,
}

impl QueuedEncoder {
    /// `depth` 是排队等着写的帧数（至少 1）。
    pub fn new(encoder: Encoder, depth: usize, fill: [u8; 4]) -> QueuedEncoder {
        let frame_bytes = encoder.frame_bytes;
        let opened = QueuedEncoder::spawn(frame_bytes, depth, fill, move || Ok(Box::new(encoder) as Box<dyn FrameSink>));
        match opened {
            Ok(queued) => queued,
            Err(_) => unreachable!("现成的编码器不会打开失败"),
        }
    }

    /// 在写线程里打开编码输出（`open`），打开成功才返回；打开失败原样返回错误，调用方可以换一种输出再来。
    /// 输出在写线程里构造并只在那里用，不要求 `Send`（平台写入器常常不是）。`frame_bytes` 是一帧 RGBA 的字节数。
    pub fn spawn<F>(frame_bytes: usize, depth: usize, fill: [u8; 4], open: F) -> Result<QueuedEncoder, MediaError>
    where
        F: FnOnce() -> Result<Box<dyn FrameSink>, MediaError> + Send + 'static,
    {
        let depth = depth.max(1);
        let (frames, queued) = sync_channel::<Vec<u8>>(depth);
        let (recycle, empty) = channel::<Vec<u8>>();
        let finishing = Arc::new(AtomicBool::new(false));
        let aborting = Arc::new(AtomicBool::new(false));
        let (finish, abort) = (Arc::clone(&finishing), Arc::clone(&aborting));
        let (opened, open_result) = channel::<Result<(), MediaError>>();
        let refill = recycle.clone();
        let writer = std::thread::spawn(move || {
            let mut encoder = match open() {
                Ok(sink) => {
                    let _ = opened.send(Ok(()));
                    sink
                }
                Err(e) => {
                    let _ = opened.send(Err(e));
                    return Ok(());
                }
            };
            for frame in queued {
                if abort.load(Ordering::SeqCst) {
                    break;
                }
                if let Err(e) = encoder.write(&frame) {
                    encoder.abort();
                    return Err(e);
                }
                // 合成线程不再取缓冲（放弃中）时送不回去，丢掉即可。
                let _ = recycle.send(frame);
            }
            if finish.load(Ordering::SeqCst) && !abort.load(Ordering::SeqCst) {
                encoder.finish()
            } else {
                encoder.abort();
                Ok(())
            }
        });
        let failed = match open_result.recv() {
            Ok(Ok(())) => None,
            Ok(Err(e)) => Some(e),
            Err(_) => Some(MediaError::new("EXPORT_ENCODE_FAILED", "写编码器的线程崩溃了")),
        };
        if let Some(e) = failed {
            let _ = writer.join();
            return Err(e);
        }
        for _ in 0..=depth {
            let _ = refill.send(fill.repeat(frame_bytes / 4));
        }
        Ok(QueuedEncoder {
            frames: Some(frames),
            empty,
            finishing,
            aborting,
            writer: Some(writer),
            frame_bytes,
        })
    }

    /// 取一个帧缓冲（长度是一帧，内容是上一次用它时留下的）。缓冲都在队列里时等写线程写完一帧。
    pub fn buffer(&mut self) -> Result<Vec<u8>, MediaError> {
        if self.writer.is_none() {
            return Err(MediaError::new("EXPORT_ENCODE_FAILED", "编码器已关闭"));
        }
        match self.empty.recv() {
            Ok(buffer) => Ok(buffer),
            Err(_) => Err(self.writer_error()),
        }
    }

    /// 把画好的一帧交给写线程；队列满时等。
    pub fn submit(&mut self, frame: Vec<u8>) -> Result<(), MediaError> {
        if frame.len() != self.frame_bytes {
            return Err(MediaError::new("EXPORT_ENCODE_FAILED", "帧的大小与输出尺寸不符"));
        }
        let sent = self.frames.as_ref().is_some_and(|frames| frames.send(frame).is_ok());
        if sent { Ok(()) } else { Err(self.writer_error()) }
    }

    /// 写完了：等队列里的帧写完、编码器收尾。
    pub fn finish(mut self) -> Result<(), MediaError> {
        self.finishing.store(true, Ordering::SeqCst);
        drop(self.frames.take());
        self.join()
    }

    /// 放弃：排着的帧不写了，杀掉编码器、删掉输出。返回时编码器已经停了、输出已经删了。
    pub fn abort(mut self) {
        self.stop();
    }

    fn stop(&mut self) {
        self.aborting.store(true, Ordering::SeqCst);
        drop(self.frames.take());
        let _ = self.join();
    }

    fn join(&mut self) -> Result<(), MediaError> {
        match self.writer.take() {
            Some(writer) => writer
                .join()
                .unwrap_or_else(|_| Err(MediaError::new("EXPORT_ENCODE_FAILED", "写编码器的线程崩溃了"))),
            None => Err(MediaError::new("EXPORT_ENCODE_FAILED", "编码器已关闭")),
        }
    }

    /// 写线程已经退出（编码器失败）：等它结束，拿它的错误。
    fn writer_error(&mut self) -> MediaError {
        drop(self.frames.take());
        match self.join() {
            Err(e) => e,
            Ok(()) => MediaError::new("EXPORT_ENCODE_FAILED", "编码器已关闭"),
        }
    }
}

impl Drop for QueuedEncoder {
    fn drop(&mut self) {
        if self.writer.is_some() {
            self.stop();
        }
    }
}
