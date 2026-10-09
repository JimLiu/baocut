//! 平台原生编解码（架构设计 §9.11「画面」）：能用就用 `media-native`（macOS AVFoundation / Windows Media Foundation），
//! 用不了的那一路单独回落 ffmpeg，回落原因记进 `done` 事件的 `video.fallbacks`。
//!
//! - 解码：每个视频实例的 [`VideoDecoder`](media_core::decode::VideoDecoder) 挂上原生帧源（[`decode`]），按素材各自回落；
//!   可能带透明的素材不走原生（原生解码把 alpha 压成 255），直接用 ffmpeg。
//! - 编码：只有 H.264 + MP4、偶数宽高、混音是 48 kHz 立体声 WAV（32 位浮点或 16/24/32 位整数）时走原生写入器（[`choose_encoder`]）；
//!   HEVC、WebM/VP9、奇数尺寸、别的混音格式与原生打不开时走 ffmpeg。
//! - 环境变量 `BAOCUT_EXPORT_NATIVE=0` 关掉原生，整条导出只走 ffmpeg（排查与测试用）。
//!
//! RGBA 是导出循环里唯一的像素格式：BGRA↔RGBA 的换序留在 `media-native` 里。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use media_core::MediaError;
use media_core::decode::{FeedOpener, FrameFeed, NativeDecode};
use media_core::encode::{Container, EncodeSettings, FrameSink, Quality, VideoCodec};
use media_native::{AudioInput, Mp4Options, Mp4Writer, PcmFormat, SequentialDecoder};
use serde::Serialize;

/// 关掉原生编解码的环境变量（值为 `0` 时关）。
pub const NATIVE_ENV: &str = "BAOCUT_EXPORT_NATIVE";

/// 原生回落 ffmpeg 的一条记录（`done.video.fallbacks` 的元素）。`reason` 是英文代码。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fallback {
    /// `decoder` 或 `encoder`。
    pub scope: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    pub reason: &'static str,
    pub message: String,
}

impl Fallback {
    pub fn encoder(reason: &'static str, message: impl Into<String>) -> Fallback {
        Fallback {
            scope: "encoder",
            asset_id: None,
            reason,
            message: message.into(),
        }
    }

    pub fn decoder(asset_id: Option<&str>, reason: &'static str, message: impl Into<String>) -> Fallback {
        Fallback {
            scope: "decoder",
            asset_id: asset_id.map(str::to_string),
            reason,
            message: message.into(),
        }
    }
}

fn enabled_by(value: Option<&str>) -> bool {
    value.is_none_or(|v| v.trim() != "0")
}

/// 原生编解码有没有被环境变量关掉。
pub fn enabled() -> bool {
    enabled_by(std::env::var(NATIVE_ENV).ok().as_deref())
}

/// 原生解码整体不可用的原因（关掉了、平台没有）；可用时 `None`。
pub fn decode_unavailable() -> Option<(&'static str, String)> {
    if !enabled() {
        return Some(("native-disabled", format!("{NATIVE_ENV}=0")));
    }
    if !media_native::available() {
        return Some(("native-unavailable", "当前平台没有原生解码后端".into()));
    }
    None
}

/// 挂给视频解码器的原生帧源；原生不可用时 `None`。
pub fn decode() -> Option<NativeDecode> {
    if decode_unavailable().is_some() {
        return None;
    }
    let open: FeedOpener = Arc::new(|path: &Path, from: f64, width: u32, height: u32| {
        media_native::open_sequential_decoder(path, from, Some((width, height)))
            .map(|decoder| Box::new(Feed(decoder)) as Box<dyn FrameFeed>)
            .map_err(|e| format!("{e:#}"))
    });
    Some(NativeDecode {
        backend: media_native::backend(),
        open,
    })
}

struct Feed(SequentialDecoder);

impl FrameFeed for Feed {
    fn next_into(&mut self, data: &mut Vec<u8>) -> Result<Option<f64>, String> {
        match self.0.next_into(data) {
            Ok(frame) => Ok(frame.map(|info| info.pts_seconds)),
            Err(e) => Err(format!("{e:#}")),
        }
    }
}

/// 编码走哪条路：原生写入器（带参数），或 ffmpeg（带不走原生的原因）。
#[derive(Clone, Debug, PartialEq)]
pub enum EncoderPlan {
    Native(Mp4Options),
    Ffmpeg(Fallback),
}

/// 按输出设置选编码器。混音 WAV 还没写出来时（导出开始时的预检）按能走原生算，执行时（WAV 已在）再按实际格式定。
pub fn choose_encoder(settings: &EncodeSettings) -> EncoderPlan {
    let audio_ok = |path: &Path| match media_native::read_wav_layout(path) {
        Ok(layout) if layout.is_native_pcm() => Ok(()),
        Ok(layout) => Err(format!(
            "混音是 {} Hz、{} 声道、{} 位{}，原生写入器只收 48000 Hz 立体声、32 位浮点或 16/24/32 位整数",
            layout.sample_rate,
            layout.channels,
            layout.bits_per_sample,
            if layout.float { "浮点" } else { "整数" }
        )),
        Err(_) if !path.exists() => Ok(()),
        Err(e) => Err(format!("{e:#}")),
    };
    choose_encoder_with(settings, enabled(), media_native::encode_available(), audio_ok)
}

fn choose_encoder_with(
    settings: &EncodeSettings,
    enabled: bool,
    available: bool,
    audio_ok: impl Fn(&Path) -> Result<(), String>,
) -> EncoderPlan {
    let fallback = |reason, message: String| EncoderPlan::Ffmpeg(Fallback::encoder(reason, message));
    if !enabled {
        return fallback("native-disabled", format!("{NATIVE_ENV}=0"));
    }
    if !available {
        return fallback("native-unavailable", "当前平台没有原生编码后端".into());
    }
    if settings.codec != VideoCodec::H264 {
        return fallback("codec", format!("原生写入器只编 H.264，要的是 {}", settings.codec.name()));
    }
    if settings.container != Container::Mp4 {
        return fallback("container", "原生写入器只写 MP4".into());
    }
    if !settings.width.is_multiple_of(2) || !settings.height.is_multiple_of(2) {
        return fallback("odd-size", format!("{}×{} 不是偶数尺寸", settings.width, settings.height));
    }
    let (Ok(fps_num), Ok(fps_den)) = (u32::try_from(settings.fps_num), u32::try_from(settings.fps_den)) else {
        return fallback(
            "frame-rate",
            format!("帧率 {}/{} 超出原生写入器的范围", settings.fps_num, settings.fps_den),
        );
    };
    if fps_num == 0 || fps_den == 0 {
        return fallback("frame-rate", format!("帧率 {fps_num}/{fps_den} 不对"));
    }
    let audio = match &settings.audio {
        None => None,
        Some(track) => {
            if let Err(message) = audio_ok(&track.path) {
                return fallback("audio-format", message);
            }
            Some(AudioInput {
                path: track.path.clone(),
                format: PcmFormat::Wav,
                bitrate: track.bitrate_kbps.saturating_mul(1000),
                duration_seconds: Some(settings.duration_seconds),
            })
        }
    };
    let fps = f64::from(fps_num) / f64::from(fps_den);
    let video_bitrate = match settings.quality {
        Quality::BitrateKbps(kbps) => kbps.saturating_mul(1000),
        Quality::Crf(crf) => media_native::crf_bitrate(settings.width, settings.height, fps, crf),
    };
    EncoderPlan::Native(Mp4Options {
        width: settings.width,
        height: settings.height,
        fps_num,
        fps_den,
        video_bitrate: Some(video_bitrate),
        audio,
    })
}

/// 打开原生写入器（在编码队列的写线程里调用）。
pub fn open_sink(path: PathBuf, options: &Mp4Options) -> Result<Box<dyn FrameSink>, MediaError> {
    let writer = media_native::open_mp4_writer_with_options(&path, options)
        .map_err(|e| MediaError::new("EXPORT_ENCODE_FAILED", format!("{e:#}")))?;
    Ok(Box::new(NativeSink {
        writer: Some(writer),
        path,
    }))
}

/// 原生写入器做成编码队列的输出：失败与放弃时不留文件。
struct NativeSink {
    writer: Option<Mp4Writer>,
    path: PathBuf,
}

impl NativeSink {
    /// 删掉输出；还没建出来（`NotFound`）或删不掉都不再报错——导出已经以别的原因失败或取消了。
    fn remove_output(&self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

impl FrameSink for NativeSink {
    fn write(&mut self, rgba: &[u8]) -> Result<(), MediaError> {
        let writer = self
            .writer
            .as_mut()
            .ok_or_else(|| MediaError::new("EXPORT_ENCODE_FAILED", "编码器已关闭"))?;
        writer
            .write_frame(rgba)
            .map_err(|e| MediaError::new("EXPORT_ENCODE_FAILED", format!("原生编码失败：{e:#}")))
    }

    fn finish(mut self: Box<Self>) -> Result<(), MediaError> {
        let Some(writer) = self.writer.take() else {
            return Err(MediaError::new("EXPORT_ENCODE_FAILED", "编码器已关闭"));
        };
        writer.finish().map_err(|e| {
            self.remove_output();
            MediaError::new("EXPORT_ENCODE_FAILED", format!("原生编码收尾失败：{e:#}"))
        })
    }

    fn abort(mut self: Box<Self>) {
        // 丢掉写入器即取消写入（AVAssetWriter cancelWriting / Sink Writer 释放），再删掉写了一半的文件。
        drop(self.writer.take());
        self.remove_output();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use media_core::encode::AudioTrack;

    fn settings() -> EncodeSettings {
        EncodeSettings {
            width: 1920,
            height: 1080,
            fps_num: 30000,
            fps_den: 1001,
            codec: VideoCodec::H264,
            container: Container::Mp4,
            quality: Quality::Crf(20),
            audio: Some(AudioTrack {
                path: PathBuf::from("/tmp/mix.wav"),
                bitrate_kbps: 192,
            }),
            duration_seconds: 2.5,
        }
    }

    fn reason(plan: EncoderPlan) -> &'static str {
        match plan {
            EncoderPlan::Native(_) => "native",
            EncoderPlan::Ffmpeg(fallback) => fallback.reason,
        }
    }

    #[test]
    fn h264_mp4_with_even_size_and_native_pcm_goes_native() {
        let plan = choose_encoder_with(&settings(), true, true, |_| Ok(()));
        let EncoderPlan::Native(options) = plan else {
            panic!("应当走原生：{plan:?}")
        };
        assert_eq!(
            (options.width, options.height, options.fps_num, options.fps_den),
            (1920, 1080, 30000, 1001)
        );
        let fps = 30000.0 / 1001.0;
        assert_eq!(options.video_bitrate, Some(media_native::crf_bitrate(1920, 1080, fps, 20)));
        let audio = options.audio.expect("有声音");
        assert_eq!(
            (audio.bitrate, audio.format, audio.duration_seconds),
            (192_000, PcmFormat::Wav, Some(2.5))
        );

        let mut fixed = settings();
        fixed.quality = Quality::BitrateKbps(6000);
        fixed.audio = None;
        let EncoderPlan::Native(options) = choose_encoder_with(&fixed, true, true, |_| Ok(())) else {
            panic!("应当走原生")
        };
        assert_eq!((options.video_bitrate, options.audio), (Some(6_000_000), None));
    }

    #[test]
    fn everything_else_falls_back_to_ffmpeg_with_a_reason() {
        let ok = |_: &Path| Ok(());
        assert_eq!(reason(choose_encoder_with(&settings(), false, true, ok)), "native-disabled");
        assert_eq!(reason(choose_encoder_with(&settings(), true, false, ok)), "native-unavailable");
        let mut hevc = settings();
        hevc.codec = VideoCodec::Hevc;
        assert_eq!(reason(choose_encoder_with(&hevc, true, true, ok)), "codec");
        let mut webm = settings();
        webm.codec = VideoCodec::Vp9;
        webm.container = Container::Webm;
        assert_eq!(reason(choose_encoder_with(&webm, true, true, ok)), "codec");
        let mut odd = settings();
        odd.width = 1279;
        assert_eq!(reason(choose_encoder_with(&odd, true, true, ok)), "odd-size");
        let wrong_audio = |_: &Path| Err("44100 Hz".to_string());
        assert_eq!(reason(choose_encoder_with(&settings(), true, true, wrong_audio)), "audio-format");
        let mut silent = settings();
        silent.audio = None;
        assert_eq!(reason(choose_encoder_with(&silent, true, true, wrong_audio)), "native");
    }

    #[test]
    fn only_zero_turns_native_off() {
        assert!(enabled_by(None));
        assert!(enabled_by(Some("1")));
        assert!(enabled_by(Some("")));
        assert!(!enabled_by(Some("0")));
        assert!(!enabled_by(Some(" 0 ")));
    }

    #[test]
    fn fallbacks_serialize_with_english_keys() {
        let value = serde_json::to_value(Fallback::decoder(Some("a1"), "open-failed", "x")).unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "scope": "decoder", "assetId": "a1", "reason": "open-failed", "message": "x" })
        );
        let value = serde_json::to_value(Fallback::encoder("codec", "y")).unwrap();
        assert!(value.get("assetId").is_none());
    }

    /// 放弃与收尾失败都不留文件；放弃时文件可能还没建出来，不报错。
    #[test]
    fn an_aborted_native_sink_leaves_no_file() {
        if !media_native::encode_available() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.mp4");
        let options = Mp4Options {
            width: 64,
            height: 36,
            fps_num: 10,
            fps_den: 1,
            video_bitrate: None,
            audio: None,
        };
        let mut sink = open_sink(path.clone(), &options).unwrap();
        sink.write(&[0, 0, 0, 255].repeat(64 * 36)).unwrap();
        sink.abort();
        assert!(!path.exists());

        let mut sink = open_sink(path.clone(), &options).unwrap();
        for _ in 0..5 {
            sink.write(&[200, 60, 30, 255].repeat(64 * 36)).unwrap();
        }
        sink.finish().unwrap();
        assert!(path.exists());
    }
}
