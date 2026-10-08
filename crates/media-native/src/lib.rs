/*!
 * bcut-media-native —— 平台原生媒体解码原语。
 *
 * 一句话职责：**在不启动 ffmpeg 子进程的前提下，从本地视频里取得 CPU 像素或
 * 平台 GPU surface**。与 `bcut-media-probe`（"这个文件是什么"）互补：那边回答
 * 元数据，这边回答帧。
 *
 * ## 三种取像素的方式
 *
 * - [`extract_frame_rgba`]（WP5a）：给定时间点解**一帧**、缩放到目标宽度、交出
 *   RGBA8。服务的是缩略图 / filmstrip / 取景帧这类"一次一帧、随机时间点"的
 *   需求——原本每一格都要 fork 一个 `ffmpeg -ss ... -frames:v 1`。
 * - [`open_frame_stream`]（WP6a）：给定起点与合成帧率的**顺序帧流**，服务 BCF
 *   渲染管线的逐帧供片——原本每个 clip 一条 `ffmpeg … -f rawvideo` 管道。
 * - Windows 上的 `open_dxgi_frame_server`（统一渲染 R4）：`IMFMediaEngine` 在
 *   frame-server 模式把播放帧直接写进三槽 D3D11 BGRA 纹理池，并随帧交出 NT
 *   共享句柄与共享 fence 值。实时路径不生成 CPU 像素副本。
 *
 * 三者不共用一个"通用解码器"抽象：取舍完全不同（顺序解码不能每帧重新 seek，
 * 随机取帧不能建一次 reader 从头读，实时播放不能把 GPU surface 降成 CPU 字节），
 * 平台层各自用系统给对应场景准备的接口。
 *
 * ## 反方向：写像素
 *
 * [`open_mp4_writer`]（WP6b）是同一条规矩的镜像——**在不启动 ffmpeg 子进程的
 * 前提下，把逐帧 RGBA + 整段混音 PCM 写成 H.264/AAC 的 MP4**。契约、后端表与
 * 码率策略见 [`Mp4Writer`] 与 [`video_bitrate`]。
 *
 * ## 后端
 *
 * | 平台 | 后端 | 单帧 | 顺序流 | 实时 GPU 播放帧 | MP4 写入 |
 * | --- | --- | --- | --- | --- | --- |
 * | macOS | AVFoundation | `AVAssetImageGenerator`（容差为零的精确取帧）+ CoreGraphics 位图上下文转 RGBA | `AVAssetReader` + `AVAssetReaderTrackOutput`（32BGRA） | App 播放层持有 `CVPixelBuffer` / IOSurface | `AVAssetWriter` + 像素缓冲适配器（VideoToolbox H.264 + AAC） |
 * | Windows | Media Foundation | `IMFSourceReader` + `MFVideoFormat_RGB32`，seek 后按时间戳推进到目标帧 | 同一个 source reader，seek 后一路 `ReadSample` | `IMFMediaEngine` frame-server → 三槽共享 D3D11 BGRA 纹理 + shared fence | `IMFSinkWriter` + H.264 MFT（NV12 输入）+ AAC MFT |
 * | 其余（Linux…） | 无 | [`available`] 返回 `false`，返回 `Err` | 同左 | 无 | [`encode_available`] 返回 `false`，同左 |
 *
 * **调用方必须自带 ffmpeg 兜底**：本 crate 不发现、不启动任何外部二进制（那是
 * `bcut-exec` 的职责），也不承诺解得开每一种容器。原生失败就是失败，回落与否
 * 由调用方决定。
 *
 * ## 确定性边界
 *
 * 解码出来的像素属于平台解码器：同一份 H.264 码流在 VideoToolbox、Media
 * Foundation 与 ffmpeg swscale 上，YUV→RGB 的矩阵实现、色度上采样与舍入并不
 * 相同。按 `docs/design/bcf/baocut-format-spec.md` §15.1，视频帧解码像素只承诺**语义等价
 * + 容差**（跨后端灰度 SSIM ≥ 0.95），"取哪一帧"仍是硬承诺。缩略图不是 golden。
 */

use std::path::Path;

use anyhow::Result;

mod encode;
mod frames;
mod scale;

#[cfg(target_os = "macos")]
mod encode_macos;
#[cfg(target_os = "windows")]
mod encode_windows;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod playback_windows;
#[cfg(target_os = "windows")]
mod windows;

pub use encode::{
    AUDIO_BITRATE, AUDIO_CHANNELS, AUDIO_SAMPLE_RATE, Mp4Writer, encode_available, encode_backend,
    frame_rate_rational, open_mp4_writer, open_mp4_writer_with_bitrate, video_bitrate,
};
pub use frames::{FrameStream, open_frame_stream, prewarm_frame_stream};
#[cfg(target_os = "windows")]
pub use playback_windows::{
    DxgiAdapterLuid, DxgiFrameServer, DxgiPlaybackState, DxgiVideoFrame, open_dxgi_frame_server,
};
pub use scale::{resize_rgba, rotate_rgba, scaled_height};

/// 一帧解码结果：紧密排布（stride = `width * 4`）的 top-down RGBA8。
///
/// alpha 恒为 255：视频帧没有透明度，而下游（`image` 编 JPEG、tiny-skia 合成）
/// 都假定画布不透明，让平台解码器的"未定义 alpha 字节"漏下去只会变成黑图。
#[derive(Clone, PartialEq, Eq)]
pub struct RgbaFrame {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl std::fmt::Debug for RgbaFrame {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RgbaFrame")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("bytes", &self.data.len())
            .finish()
    }
}

impl RgbaFrame {
    /// 从紧密排布的 RGBA8 字节构造；长度不符时报错而不是留一个半截帧。
    pub fn new(width: u32, height: u32, data: Vec<u8>) -> Result<Self> {
        let expected = width as usize * height as usize * 4;
        if width == 0 || height == 0 || data.len() != expected {
            anyhow::bail!(
                "RGBA 帧尺寸与字节数不符：{width}x{height} 需要 {expected} 字节，实得 {}",
                data.len()
            );
        }
        Ok(Self {
            width,
            height,
            data,
        })
    }

    /// `(x, y)` 处的 RGBA；越界返回 `None`。测试与像素判定用。
    pub fn pixel(&self, x: u32, y: u32) -> Option<[u8; 4]> {
        if x >= self.width || y >= self.height {
            return None;
        }
        let offset = (y as usize * self.width as usize + x as usize) * 4;
        Some([
            self.data[offset],
            self.data[offset + 1],
            self.data[offset + 2],
            self.data[offset + 3],
        ])
    }
}

/// 当前平台是否有原生解码实现（单帧抽取与顺序帧流同进同出）。
///
/// `true` 不代表任意文件都解得开（编码 / 容器仍可能不受支持），只代表"值得先试
/// 原生路径"。调用方据此决定要不要在原生失败时打 ffmpeg 兜底的日志。
pub const fn available() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows"))
}

/// 当前平台原生后端的标识。按 §15.1「解码后端必须可观测」用于诊断输出。
pub const fn backend() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "avfoundation"
    }
    #[cfg(target_os = "windows")]
    {
        // 与 `native_video/platform.rs` 等处的导出后端标识同名（WP5b 统一取值
        // 表）：仓库里 Windows 编码侧一律写 `"media-foundation"`（带连字符），
        // 这里之前独自写的是 `"mediafoundation"`——没有任何契约信封读过这个
        // 值（只进内部错误文案），改名不破坏兼容性。
        "media-foundation"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "none"
    }
}

/// 在 `time_seconds` 处解一帧，缩放到 `target_width`（高度按源显示宽高比、
/// 偶数对齐），返回 RGBA8。
///
/// 语义对齐迁移前的 `ffmpeg -ss <t> -i <src> -frames:v 1 -vf scale=<w>:-2`：
///
/// - **取哪一帧**：覆盖 `t` 的那一帧（`t` 落在某帧的呈现区间内即取该帧），不是
///   "`t` 之后的第一个关键帧"。macOS 由 `requestedTimeTolerance*` 置零保证，
///   Windows 由 seek 后按时间戳逐帧推进保证。
/// - **旋转**：按容器的旋转元数据摆正到显示方向（ffmpeg CLI 的 autorotate 默认
///   开启，两条路径因此一致）。注意这与 `bcut-media-probe` 的 `naturalW/H`
///   **不同口径**：那边是不含旋转的编码尺寸。
/// - **尺寸**：宽恰为 `target_width`，高由显示宽高比推出并偶数对齐
///   （[`scaled_height`]）。源比目标小时同样放大，不像平台 API 的
///   `maximumSize` 那样只缩不放。
///
/// 尺寸只依赖 `(源显示尺寸, target_width)`，与 `t` 无关：同一个文件的每一格
/// filmstrip 因此必然同尺寸，拼图不需要再对齐。
pub fn extract_frame_rgba(path: &Path, time_seconds: f64, target_width: u32) -> Result<RgbaFrame> {
    if target_width == 0 {
        anyhow::bail!("target_width 必须 > 0");
    }
    let time = if time_seconds.is_finite() {
        time_seconds.max(0.0)
    } else {
        anyhow::bail!("time_seconds 必须是有限值，实得 {time_seconds}");
    };
    #[cfg(target_os = "macos")]
    {
        macos::extract_frame_rgba(path, time, target_width)
    }
    #[cfg(target_os = "windows")]
    {
        windows::extract_frame_rgba(path, time, target_width)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (path, time, target_width);
        anyhow::bail!("unsupported: 当前平台没有原生单帧抽取后端（请安装 ffmpeg 走兜底路径）")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_reject_a_byte_count_that_does_not_match_the_geometry() {
        assert!(RgbaFrame::new(2, 2, vec![0; 16]).is_ok());
        assert!(RgbaFrame::new(2, 2, vec![0; 15]).is_err());
        assert!(RgbaFrame::new(0, 2, Vec::new()).is_err());
    }

    #[test]
    fn pixels_are_addressed_row_major_and_bounds_checked() {
        let frame = RgbaFrame::new(2, 1, vec![1, 2, 3, 255, 4, 5, 6, 255]).unwrap();
        assert_eq!(frame.pixel(0, 0), Some([1, 2, 3, 255]));
        assert_eq!(frame.pixel(1, 0), Some([4, 5, 6, 255]));
        assert_eq!(frame.pixel(2, 0), None);
        assert_eq!(frame.pixel(0, 1), None);
    }

    #[test]
    fn the_backend_label_matches_platform_availability() {
        assert_eq!(available(), backend() != "none");
    }

    #[test]
    fn non_finite_times_and_zero_widths_are_rejected_before_touching_the_platform() {
        let path = Path::new("/nonexistent.mp4");
        assert!(extract_frame_rgba(path, 0.0, 0).is_err());
        assert!(extract_frame_rgba(path, f64::NAN, 168).is_err());
        assert!(extract_frame_rgba(path, f64::INFINITY, 168).is_err());
    }
}
