//! 可选兜底：一次 `ffprobe` 调用拿齐纯 Rust 路径解不了的容器（AVI / TS / FLV /
//! HEIC…）的同一组字段。
//!
//! **二进制路径由调用方给**：本模块只负责执行传进来的那一个可执行文件，不做
//! 任何 PATH 搜索（见 crate 顶部说明）。

use std::path::Path;
use std::process::Command;

use anyhow::{Result, anyhow, bail};
use serde_json::Value;

use crate::{
    AudioInfo, MediaKind, MediaProbe, VideoInfo, display_dimensions_for_rotation, is_image_path,
};

/// Windows 下避免为子进程弹出控制台窗口。
fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// 用指定的 `ffprobe` 可执行文件探测。
pub fn probe_with_ffprobe(path: &Path, ffprobe: &Path) -> Result<MediaProbe> {
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,bit_rate,sample_rate,channels:stream_tags=alpha_mode:stream_side_data=rotation",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(std::process::Stdio::null());
    hide_console(&mut command);
    let output = command
        .output()
        .map_err(|error| anyhow!("启动 {} 失败：{error}", ffprobe.display()))?;
    if !output.status.success() {
        bail!(
            "ffprobe 无法读取 {}：{}",
            path.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let value: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| anyhow!("解析 ffprobe 输出：{error}"))?;
    let streams = value
        .get("streams")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let image = is_image_path(path);
    let video_stream = streams
        .iter()
        .find(|stream| stream["codec_type"] == "video");
    let audio_stream = streams
        .iter()
        .find(|stream| stream["codec_type"] == "audio");

    let video = video_stream.and_then(|stream| {
        let width = stream.get("width").and_then(Value::as_u64)?;
        let height = stream.get("height").and_then(Value::as_u64)?;
        let rotation = stream
            .get("side_data_list")
            .and_then(Value::as_array)
            .and_then(|items| {
                items.iter().find_map(|item| {
                    item.get("rotation").and_then(|value| {
                        value
                            .as_f64()
                            .or_else(|| value.as_str().and_then(|raw| raw.parse().ok()))
                    })
                })
            })
            .unwrap_or(0.0);
        let (display_width, display_height) =
            display_dimensions_for_rotation(width as u32, height as u32, rotation);
        Some(VideoInfo {
            width: width as u32,
            height: height as u32,
            display_width,
            display_height,
            bitrate: stream
                .get("bit_rate")
                .and_then(Value::as_str)
                .and_then(|raw| raw.parse::<f64>().ok())
                .filter(|rate| rate.is_finite() && *rate > 0.0),
            fps: stream
                .get("r_frame_rate")
                .and_then(Value::as_str)
                .and_then(parse_frame_rate),
            codec: stream
                .get("codec_name")
                .and_then(Value::as_str)
                .map(str::to_owned),
            alpha: stream.pointer("/tags/alpha_mode").and_then(Value::as_str) == Some("1"),
        })
    });
    let audio = audio_stream.map(|stream| AudioInfo {
        codec: stream
            .get("codec_name")
            .and_then(Value::as_str)
            .map(str::to_owned),
        sample_rate: stream
            .get("sample_rate")
            .and_then(Value::as_str)
            .and_then(|raw| raw.parse().ok()),
        channels: stream
            .get("channels")
            .and_then(Value::as_u64)
            .map(|value| value as u16),
    });

    let kind = if image {
        MediaKind::Image
    } else if video.is_some() {
        MediaKind::Video
    } else if audio.is_some() {
        MediaKind::Audio
    } else {
        bail!("{} 没有视频或音频流", path.display());
    };
    let duration = if image {
        None
    } else {
        value
            .pointer("/format/duration")
            .and_then(Value::as_str)
            .and_then(|raw| raw.parse::<f64>().ok())
            .filter(|value| value.is_finite() && *value > 0.0)
    };
    Ok(MediaProbe {
        kind,
        duration_seconds: duration,
        video,
        audio,
    })
}

/// `"30000/1001"` / `"30"` → f64；0 或非法 → `None`。
fn parse_frame_rate(raw: &str) -> Option<f64> {
    let fps = match raw.split_once('/') {
        Some((numerator, denominator)) => {
            let (numerator, denominator) = (
                numerator.parse::<f64>().ok()?,
                denominator.parse::<f64>().ok()?,
            );
            if denominator == 0.0 {
                return None;
            }
            numerator / denominator
        }
        None => raw.parse::<f64>().ok()?,
    };
    (fps > 0.0 && fps.is_finite()).then_some(fps)
}
