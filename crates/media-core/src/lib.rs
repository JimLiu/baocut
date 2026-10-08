//! 媒体读写（架构设计 §9.13、§13.1）：成片导出经 ffmpeg / ffprobe 子进程解码与编码，不链接 libav。
//!
//! - 解码：每个视频实例一条顺序的解码流（[`decode::VideoDecoder`]），原始 RGBA 帧经管道读出；按源时刻往前走，
//!   不逐帧重新定位，只有倒退或大步跳跃时才重开。图片解码一帧（[`decode::decode_still`]），GIF 取第一帧。
//! - 编码：原始 RGBA 帧写进编码器的标准输入（[`encode::Encoder`]），声音是已经混好的音频文件，一并封装。
//!
//! 工具的位置由调用方给（Runtime 按 `BAOCUT_FFMPEG` / `BAOCUT_FFPROBE` 与登录 shell 的 PATH 解析）。

pub mod decode;
pub mod encode;
pub mod probe;

use std::fmt;
use std::path::PathBuf;

/// ffmpeg 与 ffprobe 可执行文件。
#[derive(Clone, Debug)]
pub struct Tools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

/// 一帧画面：非预乘的 RGBA，逐行紧排。
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Picture {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl Picture {
    pub fn byte_len(width: u32, height: u32) -> usize {
        width as usize * height as usize * 4
    }
}

/// 媒体读写的失败。`code` 是协议里的错误码（`EXPORT_TOOL_MISSING`、`EXPORT_DECODE_FAILED`、`EXPORT_ENCODE_FAILED`……）。
#[derive(Clone, Debug, PartialEq)]
pub struct MediaError {
    pub code: &'static str,
    pub message: String,
}

impl MediaError {
    pub fn new(code: &'static str, message: impl Into<String>) -> MediaError {
        MediaError {
            code,
            message: message.into(),
        }
    }

    pub(crate) fn spawn(tool: &std::path::Path, error: std::io::Error) -> MediaError {
        if error.kind() == std::io::ErrorKind::NotFound {
            MediaError::new("EXPORT_TOOL_MISSING", format!("找不到 {}", tool.display()))
        } else {
            MediaError::new("EXPORT_TOOL_MISSING", format!("启动 {} 失败：{error}", tool.display()))
        }
    }
}

impl fmt::Display for MediaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}：{}", self.code, self.message)
    }
}

impl std::error::Error for MediaError {}

/// 子进程 stderr 的最后几行：出错时放进消息里。
pub(crate) fn tail(text: &str, lines: usize) -> String {
    let all: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}
