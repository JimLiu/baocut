//! MP4 写入：BCF 渲染导出的原生编码主路径（WP6b）。
//!
//! 与本 crate 的解码侧（[`crate::extract_frame_rgba`] / [`crate::open_frame_stream`]）
//! 对称：**在不启动 ffmpeg 子进程的前提下，把像素写成 MP4**。消费方式贴合迁移前
//! `bcut-render::video::FfmpegWriter`——逐帧喂 RGBA、可选一段整片混音 PCM、
//! [`Mp4Writer::finish`] 收尾。
//!
//! | 平台 | 后端 | 视频 | 音频 |
//! | --- | --- | --- | --- |
//! | macOS | AVFoundation | `AVAssetWriter` + `AVAssetWriterInputPixelBufferAdaptor`（BGRA 像素缓冲池 → VideoToolbox H.264） | LPCM `CMSampleBuffer` → `AVAssetWriterInput` 的 AAC 输出设置 |
//! | Windows | Media Foundation | `IMFSinkWriter` + H.264 MFT（NV12 输入，奇数画布退 RGB32） | s16 PCM → AAC MFT |
//! | 其余（Linux…） | 无 | [`encode_available`] 为 `false`，`open_mp4_writer` 直接 `Err` | 同左 |
//!
//! **调用方必须自带 ffmpeg 兜底**（与解码侧同一条规矩）：本模块不发现、不启动
//! 任何外部二进制，也不承诺写得出每一种几何。原生失败就是失败，回落与否由
//! 调用方决定（`bcut-render::video::VideoWriter`）。
//!
//! ## 码率而不是 CRF
//!
//! 迁移前的 ffmpeg 配方是 `libx264 -preset medium -crf 18`，即**质量导向**：
//! 码率由内容复杂度自己长出来。VideoToolbox 与 Media Foundation 的硬件编码器
//! 没有 CRF 这类恒定质量档，只能给平均码率，所以质量目标必须翻译成一条按
//! 分辨率与帧率缩放的码率曲线（[`video_bitrate`]）。
//!
//! ## 确定性边界
//!
//! 按 `docs/design/bcf/baocut-format-spec.md` §15.1，**导出编码的字节不承诺可复现**：同一份
//! 帧序列经 x264、VideoToolbox、Media Foundation 得到的码流互不相同，同一台机器
//! 换一版系统也可能不同。验收口径是存在性 / 帧数 / 时长容差 / 尺寸 / 后端标识 /
//! 语义化颜色谓词 / 音频 RMS，不做像素 golden。合成层（`bcut-render` 的 DrawOp
//! 与 FramePlan 指纹）仍然逐字节确定，本模块只在它下游。

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use anyhow::{Context, Result, bail};

/// 混音 PCM 的固定格式，与 `bcut-render::audio::mix_audio` 的输出一致：
/// 48 kHz、立体声、交织 f32（本机字节序）。
pub const AUDIO_SAMPLE_RATE: u32 = 48_000;
/// 同上：声道数。
pub const AUDIO_CHANNELS: u32 = 2;
/// 输出 AAC 码率，与迁移前 ffmpeg 路径的 `-b:a 192k` 同值。
pub const AUDIO_BITRATE: u32 = 192_000;

/// 一个交织采样帧的字节数（f32 × 声道数）。
const PCM_FRAME_BYTES: usize = 4 * AUDIO_CHANNELS as usize;

/// 一次交接的音频长度：0.1 秒。够小，视频轨不会因为等音频而长时间被压住就绪位；
/// 够大，每帧只有个位数次系统调用。
const AUDIO_CHUNK_FRAMES: usize = AUDIO_SAMPLE_RATE as usize / 10;

/// 音频相对视频的**提前量**（秒）。MP4 写入器为保持交织，会在一条轨落后太多时
/// 压住另一条轨的就绪位；先把音频喂到视频时间点之前一截，视频轨就不会因此停顿。
pub(crate) const AUDIO_LEAD_SECONDS: f64 = 2.0;

/// 当前平台是否有原生 MP4 编码实现。
///
/// 与解码侧的 [`crate::available`] 同一套系统框架、同一个平台集合，但语义是
/// 独立的：调用方问的是"值不值得先试原生**写**路径"。
pub const fn encode_available() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows"))
}

/// 当前平台原生编码后端的标识（§15.1「后端必须可观测」）。取值与解码侧同名：
/// 两边就是同一套系统框架（`avfoundation` / `media-foundation`）。
pub const fn encode_backend() -> &'static str {
    crate::backend()
}

/// 输出码率（bit/s）：分辨率 × 帧率的线性启发式。
///
/// 取值与 `apps/cli` 的 timeline 中间文件同一条曲线
/// （`services/timeline_media.rs::intermediate_video_bitrate` 的无源封顶形态）：
/// 1080p30 基准 8 Mb/s，按像素数与帧率线性缩放，再乘 1.5 的**质量导向余量**，
/// 最后夹到 4–60 Mb/s。
///
/// 1.5 倍余量对着的是迁移前的 `-crf 18`：那是"视觉无损"档，而硬件编码器在同等
/// 码率下压不过 x264，不留余量会在高细节素材上看得出来。夹取上下限的作用是
/// 两头兜底——极小画布不至于低到出块，4K60 也不至于长成几百兆的产物。
///
/// 这里**不做源码率封顶**（`apps/cli` 的导出路径才有）：BCF 渲染的每一帧都是
/// 合成出来的，根本不存在"源码率"这个量。
pub fn video_bitrate(width: u32, height: u32, fps: f64) -> u32 {
    let scaled = 8_000_000.0
        * (f64::from(width.max(1)) * f64::from(height.max(1)) / (1920.0 * 1080.0))
        * (fps.max(1.0) / 30.0)
        * 1.5;
    scaled.round().clamp(4_000_000.0, 60_000_000.0) as u32
}

/// NTSC 系与整数系的标准帧率分数。恒定帧率的时间戳必须用分数表示，`29.97` 这种
/// 十进制近似铺 30 分钟就会漂掉一帧以上。
const STANDARD_FRAME_RATES: &[(u32, u32)] = &[
    (24000, 1001),
    (30000, 1001),
    (48000, 1001),
    (60000, 1001),
    (120000, 1001),
];

/// 帧率吸附容差：29.97 与 30 只差 0.1%，容差必须明显小于它。
const FRAME_RATE_SNAP_TOLERANCE: f64 = 0.0005;

/// 合成帧率 → 时间戳用的有理数 `(分子, 分母)`。
///
/// 整数帧率直接用 `(fps, 1)`；NTSC 系（23.976 / 29.97 / 59.94…）吸附到精确的
/// `k/1001`；其余按千分之一的时基取整。语义对齐迁移前 ffmpeg 的 `-r {fps}`：
/// 输出恒定帧率，第 `i` 帧的呈现时间是 `i × 分母 / 分子`。
pub fn frame_rate_rational(fps: f64) -> (u32, u32) {
    if !fps.is_finite() || fps <= 0.0 {
        return (30, 1);
    }
    if (fps - fps.round()).abs() <= f64::EPSILON * fps.max(1.0)
        && fps.round() <= f64::from(u32::MAX)
    {
        return (fps.round() as u32, 1);
    }
    if let Some(standard) = STANDARD_FRAME_RATES.iter().copied().find(|(num, den)| {
        let standard = f64::from(*num) / f64::from(*den);
        (fps - standard).abs() <= standard * FRAME_RATE_SNAP_TOLERANCE
    }) {
        return standard;
    }
    (((fps * 1000.0).round() as u32).max(1), 1000)
}

/// 平台 MP4 写入器。两条平台实现的消费方式一样：按序喂帧、收尾。
pub(crate) trait Mp4Sink {
    fn write_frame(&mut self, rgba: &[u8]) -> Result<()>;
    fn finish(self: Box<Self>) -> Result<()>;
}

/// 原生 MP4 写入器句柄。
///
/// 生命周期与迁移前的 `FfmpegWriter` 一致：`open_mp4_writer` → 若干次
/// [`write_frame`](Self::write_frame) → [`finish`](Self::finish)。中途 drop 会
/// 让平台写入器取消，产物文件按平台约定被清理或留下半截——调用方本来就在
/// 临时文件上渲染，不依赖这一点。
pub struct Mp4Writer {
    sink: Box<dyn Mp4Sink>,
}

impl Mp4Writer {
    /// 追加一帧：紧密排布（stride = `width * 4`）的 top-down RGBA8。
    ///
    /// 字节数必须恰为 `width * height * 4`；帧的呈现时间由**调用顺序**决定
    /// （第 `i` 次调用即第 `i` 帧），与 ffmpeg `-r` 的恒定帧率语义一致。
    pub fn write_frame(&mut self, rgba: &[u8]) -> Result<()> {
        self.sink.write_frame(rgba)
    }

    /// 收尾：喂完剩余音频、收束轨道、等待容器写完。
    pub fn finish(self) -> Result<()> {
        self.sink.finish()
    }

    /// 实际在用的编码后端（§15.1 可观测条款）。
    pub fn backend(&self) -> &'static str {
        encode_backend()
    }
}

/// 打开一个原生 MP4 写入器。
///
/// - `width` / `height`：输出画布，必须是正偶数（H.264 的 4:2:0 色度要求；
///   奇数画布判 `unsupported`，让调用方回落 ffmpeg，与迁移前行为一致）。
/// - `fps`：合成帧率，决定恒定帧率网格。
/// - `audio_pcm`：整片混音的**裸 f32le 48 kHz 立体声** PCM 文件路径（就是
///   `bcut-render::audio::mix_audio` 写出的那一份）；`None` = 无音轨。
///
/// 音频长度与视频长度的关系沿用 ffmpeg 的 `-shortest`：音频只写到视频最后一帧
/// 结束为止，视频写完之前音频先耗尽就自然收束音轨。BCF 渲染里两者本来就等长
/// （混音按 `ir.total` 铺满，帧数是 `round(ir.total × fps)`）。
pub fn open_mp4_writer(
    out: &Path,
    width: u32,
    height: u32,
    fps: f64,
    audio_pcm: Option<&Path>,
) -> Result<Mp4Writer> {
    open_mp4_writer_with_bitrate(out, width, height, fps, audio_pcm, None)
}

/// 同 [`open_mp4_writer`]，但可以指定视频码率（bit/s）。
///
/// `bitrate` 为 `None` 时用 [`video_bitrate`] 的启发式，与 [`open_mp4_writer`]
/// 完全等价。时间轴装配与智能重构图会显式给值：那里的输入是**用户
/// 的源素材**而不是合成帧，因此存在「源码率」这个量，可以在启发式档位之上再压
/// 一层上限（`services/timeline_media.rs::intermediate_video_bitrate`），免得把
/// 1 Mb/s 的素材重编成十几 Mb/s 的中间文件。
pub fn open_mp4_writer_with_bitrate(
    out: &Path,
    width: u32,
    height: u32,
    fps: f64,
    audio_pcm: Option<&Path>,
    bitrate: Option<u32>,
) -> Result<Mp4Writer> {
    if width == 0 || height == 0 {
        bail!("unsupported: MP4 输出尺寸必须为正（实得 {width}x{height}）");
    }
    if width % 2 != 0 || height % 2 != 0 {
        bail!("unsupported: H.264 输出尺寸必须为偶数（实得 {width}x{height}）");
    }
    if !fps.is_finite() || fps <= 0.0 {
        bail!("unsupported: MP4 输出帧率必须是有限正值（实得 {fps}）");
    }
    if let Some(bitrate) = bitrate
        && bitrate == 0
    {
        bail!("unsupported: MP4 输出码率必须为正（实得 {bitrate}）");
    }
    let audio = audio_pcm.map(PcmSource::open).transpose()?;
    #[cfg(target_os = "macos")]
    {
        let sink = crate::encode_macos::open(out, width, height, fps, audio, bitrate)?;
        Ok(Mp4Writer { sink })
    }
    #[cfg(target_os = "windows")]
    {
        let sink = crate::encode_windows::open(out, width, height, fps, audio, bitrate)?;
        Ok(Mp4Writer { sink })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (out, audio, bitrate);
        bail!("unsupported: 当前平台没有原生 MP4 编码后端（请安装 ffmpeg 走兜底路径）")
    }
}

/// 整片混音 PCM 的分块读取器（裸 f32le、48 kHz、立体声交织）。
///
/// 混音整段可以有几百 MB（1 小时 ≈ 1.3 GB），不能整份读进内存；平台写入器要的
/// 也是"一小块一小块地喂"，所以这里按块流式读，块号即样本帧号。
pub(crate) struct PcmSource {
    reader: BufReader<File>,
    /// 已交出的采样帧数，也就是下一块的起始帧号。
    frames: u64,
    done: bool,
}

/// 一块交织 PCM。
pub(crate) struct PcmChunk {
    /// 这一块第一个采样帧在整片中的帧号。
    pub(crate) start_frame: u64,
    /// 交织 f32 样本（长度 = 帧数 × 声道数）。
    pub(crate) samples: Vec<f32>,
}

impl PcmChunk {
    /// 这一块的采样帧数。
    pub(crate) fn frames(&self) -> usize {
        self.samples.len() / AUDIO_CHANNELS as usize
    }
}

impl PcmSource {
    fn open(path: &Path) -> Result<Self> {
        let file =
            File::open(path).with_context(|| format!("打开混音 PCM 失败：{}", path.display()))?;
        Ok(Self {
            reader: BufReader::with_capacity(1 << 16, file),
            frames: 0,
            done: false,
        })
    }

    /// 已经交出的音频秒数（= 下一块的起始时刻）。
    pub(crate) fn position_seconds(&self) -> f64 {
        self.frames as f64 / f64::from(AUDIO_SAMPLE_RATE)
    }

    /// 下一块；`None` = PCM 读完。
    ///
    /// 尾部不足一个完整采样帧的字节直接丢弃：混音一定是整帧写出的，出现半帧
    /// 只可能是文件被截断，为它多报一个错不如安静收尾（视频轨已经写完了）。
    pub(crate) fn next_chunk(&mut self) -> Result<Option<PcmChunk>> {
        if self.done {
            return Ok(None);
        }
        let mut bytes = vec![0_u8; AUDIO_CHUNK_FRAMES * PCM_FRAME_BYTES];
        let mut filled = 0_usize;
        while filled < bytes.len() {
            match self.reader.read(&mut bytes[filled..]) {
                Ok(0) => {
                    self.done = true;
                    break;
                }
                Ok(read) => filled += read,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(error) => return Err(error).context("读取混音 PCM 失败"),
            }
        }
        let frames = filled / PCM_FRAME_BYTES;
        if frames == 0 {
            self.done = true;
            return Ok(None);
        }
        let samples = bytes[..frames * PCM_FRAME_BYTES]
            .chunks_exact(4)
            .map(|value| f32::from_le_bytes([value[0], value[1], value[2], value[3]]))
            .collect();
        let start_frame = self.frames;
        self.frames += frames as u64;
        Ok(Some(PcmChunk {
            start_frame,
            samples,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn the_bitrate_curve_scales_with_pixels_and_frame_rate_inside_the_clamp() {
        // 1080p30 基准：8 Mb/s × 1.5 质量余量。
        assert_eq!(video_bitrate(1920, 1080, 30.0), 12_000_000);
        // 像素减半 → 码率减半；帧率翻倍 → 码率翻倍。
        assert_eq!(video_bitrate(1280, 720, 30.0), 5_333_333);
        assert_eq!(video_bitrate(1920, 1080, 60.0), 24_000_000);
        // 两头夹取：极小画布抬到 4 Mb/s 下限，4K60 压到 60 Mb/s 上限。
        assert_eq!(video_bitrate(320, 180, 30.0), 4_000_000);
        assert_eq!(video_bitrate(3840, 2160, 60.0), 60_000_000);
    }

    #[test]
    fn frame_rates_snap_to_exact_fractions() {
        assert_eq!(frame_rate_rational(30.0), (30, 1));
        assert_eq!(frame_rate_rational(24.0), (24, 1));
        assert_eq!(frame_rate_rational(30000.0 / 1001.0), (30000, 1001));
        assert_eq!(frame_rate_rational(24000.0 / 1001.0), (24000, 1001));
        // 非标准帧率退回千分之一时基；非法值退回 30。
        assert_eq!(frame_rate_rational(12.5), (12500, 1000));
        assert_eq!(frame_rate_rational(0.0), (30, 1));
        assert_eq!(frame_rate_rational(f64::NAN), (30, 1));
    }

    #[test]
    fn odd_or_zero_geometry_is_rejected_before_touching_the_platform() {
        let out = std::env::temp_dir().join("bcut-encode-guard.mp4");
        assert!(open_mp4_writer(&out, 0, 100, 30.0, None).is_err());
        assert!(open_mp4_writer(&out, 101, 100, 30.0, None).is_err());
        assert!(open_mp4_writer(&out, 100, 100, 0.0, None).is_err());
        assert!(!out.exists(), "守卫不该创建产物文件");
    }

    #[test]
    fn pcm_chunks_carry_their_own_frame_offset_and_stop_at_eof() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        // 1.5 块 + 半个采样帧的尾巴（尾巴应被丢弃）。
        let frames = AUDIO_CHUNK_FRAMES + AUDIO_CHUNK_FRAMES / 2;
        let mut bytes = Vec::new();
        for frame in 0..frames {
            for channel in 0..AUDIO_CHANNELS as usize {
                bytes.extend_from_slice(&((frame + channel) as f32).to_le_bytes());
            }
        }
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        file.write_all(&bytes).unwrap();
        file.flush().unwrap();

        let mut source = PcmSource::open(file.path()).unwrap();
        let first = source.next_chunk().unwrap().unwrap();
        assert_eq!(first.start_frame, 0);
        assert_eq!(first.frames(), AUDIO_CHUNK_FRAMES);
        assert_eq!(first.samples[0], 0.0);
        assert_eq!(first.samples[1], 1.0);
        let second = source.next_chunk().unwrap().unwrap();
        assert_eq!(second.start_frame, AUDIO_CHUNK_FRAMES as u64);
        assert_eq!(second.frames(), AUDIO_CHUNK_FRAMES / 2);
        assert_eq!(
            source.position_seconds(),
            frames as f64 / f64::from(AUDIO_SAMPLE_RATE)
        );
        assert!(source.next_chunk().unwrap().is_none());
    }
}
