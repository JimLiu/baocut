/*!
 * bcut-media-probe —— 全仓统一的媒体探测。
 *
 * 一句话职责：**回答"这个文件是什么、多长、多大、多少帧率、带不带 alpha"**，
 * 主路径纯 Rust，`ffprobe` 只作为解不了的容器的可选兜底。
 *
 * ## 为什么单独一个 crate
 *
 * 迁移前同一个问题在仓库里有 9 份互不相同的 `ffprobe` 子进程实现（渲染资源
 * 加载、语音时长、studio 初始化、时间轴 fps、`bcut source probe`、serve 的
 * filmstrip、导出前的音轨检查、App v2 的素材导入……），每一份的参数、解析和
 * 容错语义都略有出入，而且**全都把 ffprobe 当硬前置**。ffmpeg/ffprobe 正在从
 * 默认依赖降为可选增强，探测必须先于它可用。
 *
 * ## 后端
 *
 * | 容器 | 后端 | 拿得到 |
 * | --- | --- | --- |
 * | MP4 / MOV / M4A（ISO-BMFF） | [`re_mp4`] | 时长、编码尺寸、fps、codec、音轨 |
 * | MKV / WebM（EBML） | [`matroska_demuxer`] | 时长、尺寸、fps、codec、**alpha** |
 * | WAV / MP3 / FLAC / OGG / OPUS / CAF… | [`symphonia`] | 时长、codec、采样率、声道 |
 * | PNG / JPEG / GIF / WebP / BMP / TIFF | [`image`]（只读头部） | 尺寸 |
 * | 其余（AVI / TS / FLV / HEIC…） | 无 | —— 交给 [`probe_with_fallback`] |
 *
 * ## 二进制发现不归本 crate
 *
 * [`probe_with_fallback`] 的 `ffprobe` 路径**由调用方传入**：全仓统一经
 * `bcut_exec::find_executable("ffprobe")`（core workspace 的统一搜索目录表，
 * WP3 收敛，见 `core/crates/bcut-exec`），找不到就传 `None`。本 crate 自己绝
 * 不搜 PATH——那会让"用哪个 ffprobe"变成两套规则。
 *
 * ## 旋转与两种尺寸
 *
 * [`VideoInfo::width`] / [`VideoInfo::height`] 继续是 `naturalW/naturalH` 的既有
 * 口径：**编码尺寸、不含旋转**（见 `docs/design/cli/bcut-cli-server-reference.md`）。
 * 解码器默认会按容器旋转元数据摆正像素，因此另外交出
 * [`VideoInfo::display_width`] / [`VideoInfo::display_height`] 给帧缓冲与渲染几何使用。
 * 新字段是 additive 的，不改任何已有 `naturalW/naturalH` 输出。
 *
 * ## 音轨编辑表
 *
 * [`audio_edit_start`] 回答另一个「这个文件是什么」的问题：MP4 / M4A / MOV 音轨
 * 的 `elst` 让解码后先丢掉多少编码器前置帧。Symphonia 不应用编辑表，全仓三条
 * Symphonia 解码循环（渲染混音、语音 / 节拍 / 分离、波形）都靠它对齐 ffmpeg。
 */

use std::path::Path;

use anyhow::{Result, anyhow, bail};

mod edit_list;
mod ffprobe;
mod native;

pub use edit_list::{EditStart, audio_edit_start};
pub use ffprobe::probe_with_ffprobe;

/// 媒体的粗分类。与 `bcut source probe` 的 `kind` 字段同口径。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaKind {
    Video,
    Audio,
    Image,
}

impl MediaKind {
    /// `bcut source probe` / timeline `source.kind` 用的小写名。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Video => "video",
            Self::Audio => "audio",
            Self::Image => "image",
        }
    }
}

/// 视觉轨信息。静态图片也走这里（尺寸就是图片自身的像素尺寸）。
#[derive(Debug, Clone, PartialEq)]
pub struct VideoInfo {
    /// 编码尺寸，**不含旋转**（与迁移前的 ffprobe `stream=width,height` 同口径）。
    pub width: u32,
    pub height: u32,
    /// 解码器应用容器旋转元数据后的输出像素尺寸。
    ///
    /// 无旋转时与 `width` / `height` 相同；90° / 270° 时两者互换。
    /// 这两个字段只服务帧缓冲几何，不会替代 `naturalW/naturalH`。
    pub display_width: u32,
    pub display_height: u32,
    /// 源自身帧率；`None` = 容器里问不出来。
    ///
    /// 与 ffprobe 的 `r_frame_rate` / `avg_frame_rate` **不保证有理数级一致**，
    /// 只保证 f64 容差一致——下游全都转 f64 用。
    pub fps: Option<f64>,
    /// Average video-track bitrate in bit/s, excluding audio and container overhead.
    pub bitrate: Option<f64>,
    /// ffprobe `codec_name` 口径的小写短名（`h264` / `hevc` / `vp9` / `av1`…）。
    pub codec: Option<String>,
    /// 容器**标注**这条轨带 alpha 平面。
    ///
    /// 现实里只有 Matroska/WebM 会标（`AlphaMode`，EBML 0x53C0），对应迁移前
    /// ffprobe 的 `stream_tags=alpha_mode`。这是带 alpha 的 WebM 贴纸能不能
    /// 正确解码的唯一判据（见 `bcut_render::assets::probe_alpha_decoder`）。
    pub alpha: bool,
}

impl VideoInfo {
    /// 摆正后的解码帧尺寸。
    pub fn display_dimensions(&self) -> (u32, u32) {
        (self.display_width, self.display_height)
    }
}

/// 编码尺寸 + 象限旋转 → 摆正后的解码帧尺寸。
///
/// 容器理论上可以存任意角度，但各解码后端对非象限仿射的输出画布
/// 口径不一致；这种情况保留编码尺寸，由具体解码后端决定是否支持。
pub(crate) fn display_dimensions_for_rotation(width: u32, height: u32, degrees: f64) -> (u32, u32) {
    if !degrees.is_finite() {
        return (width, height);
    }
    let normalized = degrees.rem_euclid(360.0);
    let quadrant = (normalized / 90.0).round();
    if (normalized - quadrant * 90.0).abs() > 1.0 {
        return (width, height);
    }
    if quadrant as i64 % 2 == 0 {
        (width, height)
    } else {
        (height, width)
    }
}

/// 音轨信息。**存在即代表这个文件有音轨**（`has_audio` 就看它是不是 `Some`）。
#[derive(Debug, Clone, PartialEq)]
pub struct AudioInfo {
    /// ffprobe `codec_name` 口径的小写短名（`aac` / `mp3` / `flac` / `opus`…）。
    pub codec: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
}

/// 一次探测的全部产出。
#[derive(Debug, Clone, PartialEq)]
pub struct MediaProbe {
    pub kind: MediaKind,
    /// 容器时长（秒）。图片恒为 `None`；容器没写时长也是 `None`。
    pub duration_seconds: Option<f64>,
    pub video: Option<VideoInfo>,
    pub audio: Option<AudioInfo>,
}

impl MediaProbe {
    /// 有没有音轨。
    pub fn has_audio(&self) -> bool {
        self.audio.is_some()
    }

    /// 编码尺寸；没有视觉轨时为 `None`。
    pub fn dimensions(&self) -> Option<(u32, u32)> {
        self.video.as_ref().map(|video| (video.width, video.height))
    }

    /// 应用容器旋转元数据后的解码帧尺寸；没有视觉轨时为 `None`。
    pub fn display_dimensions(&self) -> Option<(u32, u32)> {
        self.video.as_ref().map(VideoInfo::display_dimensions)
    }

    /// 源帧率；探测不到为 `None`。
    pub fn fps(&self) -> Option<f64> {
        self.video.as_ref().and_then(|video| video.fps)
    }

    /// Prefer the video track; file size / duration is a conservative fallback
    /// for containers without a track bitrate. No full-file decode is needed.
    pub fn video_bitrate(&self, path: &Path) -> Option<f64> {
        if self.kind != MediaKind::Video {
            return None;
        }
        self.video
            .as_ref()?
            .bitrate
            .filter(|rate| rate.is_finite() && *rate > 0.0)
            .or_else(|| {
                let duration = self.positive_duration()?;
                let bytes = std::fs::metadata(path).ok()?.len();
                let rate = bytes as f64 * 8.0 / duration;
                (rate.is_finite() && rate > 0.0).then_some(rate)
            })
    }

    /// 大于 0 的有限时长，否则 `None`（迁移前各调用点都在做这层过滤）。
    pub fn positive_duration(&self) -> Option<f64> {
        self.duration_seconds
            .filter(|value| value.is_finite() && *value > 0.0)
    }
}

/// 实际出活的探测后端。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeBackend {
    /// 纯 Rust。
    Native,
    /// 兜底的 `ffprobe` 子进程。
    Ffprobe,
}

impl ProbeBackend {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::Ffprobe => "ffprobe",
        }
    }
}

/// 被当成静态图片的扩展名（小写）。
///
/// 分类**只看扩展名**，与迁移前 `bcut source probe` / App v2 素材导入的判据
/// 一致：容器里那张 PNG 在 ffprobe 眼里也是一条"视频流"，靠流类型分不出
/// "图片"和"单帧视频"。
pub const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif",
];

/// 路径扩展名是否属于静态图片。
pub fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            IMAGE_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
        })
}

/// 纯 Rust 探测。解不了的容器返回 `Err`——调用方要兜底就用
/// [`probe_with_fallback`]。
pub fn probe(path: &Path) -> Result<MediaProbe> {
    native::probe_native(path)
}

/// 纯 Rust 优先、`ffprobe` 兜底。
///
/// `ffprobe` 是**调用方给的可执行文件路径**（通常是
/// `bcut_exec::find_executable("ffprobe")` 的结果）；`None` = 这台机器上没有
/// ffprobe，此时纯 Rust 的失败就是最终失败。
pub fn probe_with_fallback(
    path: &Path,
    ffprobe: Option<&Path>,
) -> Result<(MediaProbe, ProbeBackend)> {
    let native_error = match native::probe_native(path) {
        Ok(probe) => return Ok((probe, ProbeBackend::Native)),
        Err(error) => error,
    };
    let Some(ffprobe) = ffprobe else {
        return Err(native_error.context(format!(
            "{} 无法纯 Rust 探测，且没有可用的 ffprobe 兜底",
            path.display()
        )));
    };
    match ffprobe::probe_with_ffprobe(path, ffprobe) {
        Ok(probe) => Ok((probe, ProbeBackend::Ffprobe)),
        Err(error) => Err(anyhow!(
            "{} 两条探测路径都失败：纯 Rust：{native_error:#}；ffprobe：{error:#}",
            path.display()
        )),
    }
}

/// 读文件头若干字节做容器嗅探。
pub(crate) fn read_magic(path: &Path) -> Result<[u8; 16]> {
    use std::io::Read as _;

    let mut file = std::fs::File::open(path)
        .map_err(|error| anyhow!("打开 {} 失败：{error}", path.display()))?;
    let mut magic = [0_u8; 16];
    let mut filled = 0;
    while filled < magic.len() {
        match file.read(&mut magic[filled..]) {
            Ok(0) => break,
            Ok(count) => filled += count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(error) => bail!("读取 {} 失败：{error}", path.display()),
        }
    }
    Ok(magic)
}
