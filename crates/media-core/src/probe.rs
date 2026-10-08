//! 启动前的探测：素材的画面尺寸（已按旋转元数据交换宽高）与带不带透明，本机 ffmpeg 有哪些编码器。

use std::collections::BTreeSet;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;

use crate::{MediaError, Tools, tail};

/// 素材第一条视频流（图片也是一条视频流）的显示尺寸与带不带透明。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PictureInfo {
    pub width: u32,
    pub height: u32,
    /// 画面可能带透明：像素格式有 alpha 分量、认不出的格式，或容器标了 alpha（`alpha_mode`，带透明的 VP9 WebM
    /// 的像素格式写的是不带 alpha 的 `yuv420p`）。为 `false` 时解出来的 RGBA 一律不透明。
    pub alpha: bool,
}

/// 确定不带 alpha 分量的 ffmpeg 像素格式（前缀）。不在这里的（含 `yuva*`、`rgba`、`gbrap*`、`ya*`、`pal8` 与
/// 认不出的）都当作可能带透明。
const OPAQUE_PIX_FMTS: &[&str] = &[
    "yuv", "nv", "p01", "p21", "p41", "gray", "rgb24", "bgr24", "rgb48", "bgr48", "gbrp", "0rgb", "rgb0", "0bgr", "bgr0", "x2rgb10",
    "x2bgr10", "uyvy422", "yuyv422", "yvyu422", "monow", "monob", "xv30", "xv36", "y210", "y212", "vuyx",
];

/// 像素格式确定不带 alpha。
pub fn opaque_pix_fmt(name: &str) -> bool {
    !name.starts_with("yuva") && OPAQUE_PIX_FMTS.iter().any(|prefix| name.starts_with(prefix))
}

/// 探测素材的画面。没有视频流时为 `None`；ffprobe 读不了这个文件时报 `EXPORT_DECODE_FAILED`。
pub fn probe_picture(tools: &Tools, path: &Path) -> Result<Option<PictureInfo>, MediaError> {
    let output = Command::new(&tools.ffprobe)
        .args(["-v", "error", "-select_streams", "v:0", "-show_entries"])
        .arg("stream=width,height,pix_fmt:stream_tags=alpha_mode:stream_side_data=rotation")
        .args(["-of", "json"])
        .arg(path)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| MediaError::spawn(&tools.ffprobe, e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(MediaError::new(
            "EXPORT_DECODE_FAILED",
            format!("ffprobe 读不了这个文件：{}", tail(&stderr, 3)),
        ));
    }
    let value: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| MediaError::new("EXPORT_DECODE_FAILED", format!("ffprobe 的输出读不懂：{e}")))?;
    let Some(stream) = value.get("streams").and_then(Value::as_array).and_then(|s| s.first()) else {
        return Ok(None);
    };
    let dimension = |key: &str| {
        stream
            .get(key)
            .and_then(Value::as_u64)
            .and_then(|v| u32::try_from(v).ok())
            .filter(|v| *v > 0)
    };
    let (Some(width), Some(height)) = (dimension("width"), dimension("height")) else {
        return Ok(None);
    };
    let rotation = stream
        .get("side_data_list")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find_map(|side| side.get("rotation").and_then(Value::as_f64))
        .unwrap_or(0.0);
    let opaque = stream.get("pix_fmt").and_then(Value::as_str).is_some_and(opaque_pix_fmt);
    let alpha_mode = stream
        .get("tags")
        .and_then(|tags| tags.get("alpha_mode"))
        .and_then(Value::as_str)
        .is_some_and(|mode| mode.trim() == "1");
    let alpha = !opaque || alpha_mode;
    let quarter = (rotation / 90.0).round() as i64;
    Ok(Some(if quarter.rem_euclid(2) == 1 {
        PictureInfo {
            width: height,
            height: width,
            alpha,
        }
    } else {
        PictureInfo { width, height, alpha }
    }))
}

/// 本机 ffmpeg 的编码器名字（`ffmpeg -encoders` 的第二列）。
pub fn encoders(tools: &Tools) -> Result<BTreeSet<String>, MediaError> {
    let output = Command::new(&tools.ffmpeg)
        .args(["-hide_banner", "-nostdin", "-encoders"])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| MediaError::spawn(&tools.ffmpeg, e))?;
    if !output.status.success() {
        return Err(MediaError::new("EXPORT_TOOL_MISSING", "ffmpeg -encoders 失败"));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut names = BTreeSet::new();
    let mut listing = false;
    for line in text.lines() {
        // 表头之后的分隔线是 ` ------`。
        if line.trim_start().starts_with("------") {
            listing = true;
            continue;
        }
        if !listing {
            continue;
        }
        let mut fields = line.split_whitespace();
        if let (Some(_flags), Some(name)) = (fields.next(), fields.next()) {
            names.insert(name.to_string());
        }
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::opaque_pix_fmt;

    #[test]
    fn only_known_opaque_pixel_formats_skip_alpha() {
        for name in [
            "yuv420p",
            "yuvj420p",
            "yuv422p10le",
            "nv12",
            "p010le",
            "gray",
            "rgb24",
            "gbrp10le",
            "bgr0",
        ] {
            assert!(opaque_pix_fmt(name), "{name}");
        }
        for name in [
            "yuva420p",
            "yuva444p10le",
            "rgba",
            "bgra",
            "argb",
            "gbrap",
            "ya8",
            "pal8",
            "rgba64be",
            "",
            "new_fmt",
        ] {
            assert!(!opaque_pix_fmt(name), "{name}");
        }
    }
}
