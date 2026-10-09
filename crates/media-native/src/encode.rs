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
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

/// 混音 PCM 的固定格式，与 `bcut-render::audio::mix_audio` 的输出一致：
/// 48 kHz、立体声、交织 f32（本机字节序）。
pub const AUDIO_SAMPLE_RATE: u32 = 48_000;
/// 同上：声道数。
pub const AUDIO_CHANNELS: u32 = 2;
/// 输出 AAC 码率的缺省值，与迁移前 ffmpeg 路径的 `-b:a 192k` 同值（[`AudioInput::bitrate`] 可以另给）。
pub const AUDIO_BITRATE: u32 = 192_000;

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

/// 质量导向的 CRF → 原生平均码率（bit/s）：[`video_bitrate`] 的曲线按 `2^((18 − crf) / 6)` 缩放，夹到
/// 1 b/s – 60 Mb/s。
///
/// 硬件编码器没有 CRF，CRF 只能翻译成码率。锚点是曲线本身的口径：[`video_bitrate`] 对着的就是迁移前的 `-crf 18`
/// （倍数 1.0，与 `render-raster` 的 `EncodeQuality::EXPORT` 同值）；x264 的经验是 CRF 每差 6 码率约差一倍，按这个
/// 斜率外推。`render-raster` 的预览代理档（`crf 16` 配 2.5 倍）是另一套余量，不在这条曲线上。
pub fn crf_bitrate(width: u32, height: u32, fps: f64, crf: u32) -> u32 {
    let base = f64::from(video_bitrate(width, height, fps));
    let scale = 2_f64.powf((18.0 - f64::from(crf)) / 6.0);
    (base * scale).round().clamp(1.0, 60_000_000.0) as u32
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

/// 平台写入器的开法：几何、恒定帧率（有理数）、视频码率与可选的音轨。
pub(crate) struct WriterSetup {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) fps_num: u32,
    pub(crate) fps_den: u32,
    /// 视频平均码率（bit/s）。
    pub(crate) bitrate: u32,
    pub(crate) audio: Option<PcmSource>,
    /// AAC 码率（bit/s）。
    pub(crate) audio_bitrate: u32,
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
    if !fps.is_finite() || fps <= 0.0 {
        bail!("unsupported: MP4 输出帧率必须是有限正值（实得 {fps}）");
    }
    let (fps_num, fps_den) = frame_rate_rational(fps);
    open_mp4_writer_with_options(
        out,
        &Mp4Options {
            width,
            height,
            fps_num,
            fps_den,
            video_bitrate: bitrate,
            audio: audio_pcm.map(|path| AudioInput {
                path: path.to_path_buf(),
                format: PcmFormat::RawF32,
                bitrate: AUDIO_BITRATE,
                duration_seconds: None,
            }),
        },
    )
}

/// 混音 PCM 的容器。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PcmFormat {
    /// 裸 f32le、48 kHz、立体声交织（`bcut-render::audio::mix_audio` 写出的那一份）。
    RawF32,
    /// WAV（含 `WAVE_FORMAT_EXTENSIBLE`）：48 kHz 立体声，32 位浮点或 16 / 24 / 32 位整数（[`WavLayout::is_native_pcm`]）。
    Wav,
}

/// 音轨的输入：整段混音与 AAC 码率。
#[derive(Clone, Debug, PartialEq)]
pub struct AudioInput {
    pub path: PathBuf,
    pub format: PcmFormat,
    /// AAC 码率（bit/s）。
    pub bitrate: u32,
    /// 音轨的长度（秒）：给了就补静音或截到正好这么长（对齐 ffmpeg 兜底的 `apad=whole_dur,atrim=end`）；
    /// `None` = 按 `-shortest` 截到视频末尾、比视频短时到混音末尾为止。
    pub duration_seconds: Option<f64>,
}

/// [`open_mp4_writer_with_options`] 的参数。
#[derive(Clone, Debug, PartialEq)]
pub struct Mp4Options {
    /// 输出画布，必须是正偶数（H.264 4:2:0）。
    pub width: u32,
    pub height: u32,
    /// 恒定帧率的有理数（分子、分母），第 `i` 帧的呈现时间是 `i × 分母 / 分子`。调用方手里有精确帧率时直接给，
    /// 不经浮点再吸附（[`frame_rate_rational`]）。
    pub fps_num: u32,
    pub fps_den: u32,
    /// 视频平均码率（bit/s）；`None` = [`video_bitrate`] 的启发式。
    pub video_bitrate: Option<u32>,
    pub audio: Option<AudioInput>,
}

/// 同 [`open_mp4_writer`]，参数收成 [`Mp4Options`]：精确的有理帧率、视频码率、音轨的容器（裸 PCM 或 WAV）、
/// AAC 码率与音轨长度。
///
/// 写出的视频流标 BT.709（原色、传递函数与 YCbCr 矩阵），与 ffmpeg 兜底路径的 `-colorspace bt709` 同口径。
pub fn open_mp4_writer_with_options(out: &Path, options: &Mp4Options) -> Result<Mp4Writer> {
    let &Mp4Options {
        width,
        height,
        fps_num,
        fps_den,
        video_bitrate: bitrate,
        ..
    } = options;
    if width == 0 || height == 0 {
        bail!("unsupported: MP4 输出尺寸必须为正（实得 {width}x{height}）");
    }
    if width % 2 != 0 || height % 2 != 0 {
        bail!("unsupported: H.264 输出尺寸必须为偶数（实得 {width}x{height}）");
    }
    if fps_num == 0 || fps_den == 0 || i32::try_from(fps_num).is_err() {
        bail!("unsupported: MP4 输出帧率必须是正的有理数（实得 {fps_num}/{fps_den}）");
    }
    if let Some(bitrate) = bitrate
        && bitrate == 0
    {
        bail!("unsupported: MP4 输出码率必须为正（实得 {bitrate}）");
    }
    let (audio, audio_bitrate) = match &options.audio {
        None => (None, AUDIO_BITRATE),
        Some(input) => {
            if input.bitrate == 0 {
                bail!("unsupported: AAC 码率必须为正");
            }
            let mut source = match input.format {
                PcmFormat::RawF32 => PcmSource::open(&input.path)?,
                PcmFormat::Wav => PcmSource::open_wav(&input.path)?,
            };
            if let Some(seconds) = input.duration_seconds {
                if !seconds.is_finite() || seconds < 0.0 {
                    bail!("unsupported: 音轨长度必须是非负有限值（实得 {seconds}）");
                }
                source.total = Some((seconds * f64::from(AUDIO_SAMPLE_RATE)).round() as u64);
            }
            (Some(source), input.bitrate)
        }
    };
    let exact_fps = f64::from(fps_num) / f64::from(fps_den);
    let setup = WriterSetup {
        width,
        height,
        fps_num,
        fps_den,
        bitrate: bitrate.unwrap_or_else(|| video_bitrate(width, height, exact_fps)),
        audio,
        audio_bitrate,
    };
    #[cfg(target_os = "macos")]
    {
        let sink = crate::encode_macos::open(out, setup)?;
        Ok(Mp4Writer { sink })
    }
    #[cfg(target_os = "windows")]
    {
        let sink = crate::encode_windows::open(out, setup)?;
        Ok(Mp4Writer { sink })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (out, setup);
        bail!("unsupported: 当前平台没有原生 MP4 编码后端（请安装 ffmpeg 走兜底路径）")
    }
}

/// WAV 文件的格式与数据块位置（[`read_wav_layout`]）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WavLayout {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    /// IEEE 浮点（格式 3，或 `WAVE_FORMAT_EXTENSIBLE` 的子格式是 3）。
    pub float: bool,
    /// 数据块第一个字节在文件里的位置。
    pub data_offset: u64,
    /// 数据块的字节数。长度写成 0 或 `0xFFFFFFFF`（流式写出时回填不了）、或比文件长时按到文件末尾算。
    pub data_bytes: u64,
}

impl WavLayout {
    /// 是不是写入器吃得下的格式：48 kHz、立体声，样本是 32 位浮点或 16 / 24 / 32 位整数（整数读进来换成浮点）。
    pub fn is_native_pcm(&self) -> bool {
        self.sample_kind().is_some()
            && u32::from(self.channels) == AUDIO_CHANNELS
            && self.sample_rate == AUDIO_SAMPLE_RATE
    }

    fn sample_kind(&self) -> Option<SampleKind> {
        match (self.float, self.bits_per_sample) {
            (true, 32) => Some(SampleKind::F32),
            (false, 16) => Some(SampleKind::I16),
            (false, 24) => Some(SampleKind::I24),
            (false, 32) => Some(SampleKind::I32),
            _ => None,
        }
    }
}

/// 混音样本的存储格式。整数样本按 ffmpeg 的口径换成浮点（除以 2^(位数−1)）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SampleKind {
    F32,
    I16,
    I24,
    I32,
}

impl SampleKind {
    const fn bytes(self) -> usize {
        match self {
            SampleKind::I16 => 2,
            SampleKind::I24 => 3,
            SampleKind::F32 | SampleKind::I32 => 4,
        }
    }

    fn decode(self, raw: &[u8]) -> f32 {
        match self {
            SampleKind::F32 => f32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]),
            SampleKind::I16 => f32::from(i16::from_le_bytes([raw[0], raw[1]])) / 32_768.0,
            // 24 位放进 i32 的高 24 位再算术右移，符号位自然扩展。
            SampleKind::I24 => {
                (i32::from_le_bytes([0, raw[0], raw[1], raw[2]]) >> 8) as f32 / 8_388_608.0
            }
            SampleKind::I32 => {
                (f64::from(i32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]])) / 2_147_483_648.0)
                    as f32
            }
        }
    }
}

/// 读 WAV 头：格式块与数据块的位置（规则与 `export-worker` 的母带读 WAV 同一套）。不是 WAV、格式块不完整、
/// 数据块在格式块之前或没有数据块时报错；格式本身不在这里判（[`WavLayout::is_native_pcm`]）。
pub fn read_wav_layout(path: &Path) -> Result<WavLayout> {
    let mut file =
        File::open(path).with_context(|| format!("打开混音 WAV 失败：{}", path.display()))?;
    let len = file.metadata().context("读混音 WAV 失败")?.len();
    let mut head = [0_u8; 12];
    file.read_exact(&mut head).context("混音不是 WAV 文件")?;
    if &head[0..4] != b"RIFF" || &head[8..12] != b"WAVE" {
        bail!("混音不是 WAV 文件");
    }
    let mut at = 12_u64;
    let mut format: Option<(u16, u16, u32, u16)> = None;
    loop {
        let mut chunk = [0_u8; 8];
        if file.read_exact(&mut chunk).is_err() {
            bail!("混音的 WAV 没有数据块");
        }
        let size = u64::from(u32::from_le_bytes([chunk[4], chunk[5], chunk[6], chunk[7]]));
        let body = at + 8;
        match &chunk[0..4] {
            b"fmt " => {
                let mut fmt = vec![0_u8; size.min(64) as usize];
                file.read_exact(&mut fmt).context("读混音 WAV 失败")?;
                if fmt.len() < 16 {
                    bail!("混音的 WAV 格式块不完整");
                }
                let tag = u16::from_le_bytes([fmt[0], fmt[1]]);
                let channels = u16::from_le_bytes([fmt[2], fmt[3]]);
                let rate = u32::from_le_bytes([fmt[4], fmt[5], fmt[6], fmt[7]]);
                let bits = u16::from_le_bytes([fmt[14], fmt[15]]);
                // 0xFFFE（WAVE_FORMAT_EXTENSIBLE）时子格式 GUID 的前两个字节才是格式号。
                let tag = if tag == 0xFFFE && fmt.len() >= 26 {
                    u16::from_le_bytes([fmt[24], fmt[25]])
                } else {
                    tag
                };
                format = Some((tag, channels, rate, bits));
            }
            b"data" => {
                let Some((tag, channels, sample_rate, bits_per_sample)) = format else {
                    bail!("混音的 WAV 在格式块之前就是数据块");
                };
                let rest = len.saturating_sub(body);
                let data_bytes = if size == 0 || size == u64::from(u32::MAX) || size > rest {
                    rest
                } else {
                    size
                };
                return Ok(WavLayout {
                    sample_rate,
                    channels,
                    bits_per_sample,
                    float: tag == 3,
                    data_offset: body,
                    data_bytes,
                });
            }
            _ => {}
        }
        // 块按偶数字节对齐。
        at = body + size + (size & 1);
        file.seek(SeekFrom::Start(at)).context("读混音 WAV 失败")?;
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
    /// 文件里还没读的采样帧数（WAV 的数据块之后可能还有别的块）；`None` = 读到文件末尾。
    remaining: Option<u64>,
    /// 音轨的总帧数：文件不够就补静音，够了就截在这里；`None` = 文件有多少交多少。
    pub(crate) total: Option<u64>,
    /// 文件已经读完（之后只可能补静音）。
    exhausted: bool,
    /// 样本格式：裸 PCM 恒为 32 位浮点，WAV 按格式块。
    kind: SampleKind,
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
            remaining: None,
            total: None,
            exhausted: false,
            kind: SampleKind::F32,
        })
    }

    /// 一个采样帧（各声道一个样本）的字节数。
    fn frame_bytes(&self) -> usize {
        self.kind.bytes() * AUDIO_CHANNELS as usize
    }

    /// 48 kHz 立体声的 WAV（32 位浮点或 16 / 24 / 32 位整数）：从数据块起读，读到数据块末尾。
    /// 别的格式判 `unsupported`（调用方回落 ffmpeg）。
    fn open_wav(path: &Path) -> Result<Self> {
        let layout = read_wav_layout(path)?;
        let kind = layout.sample_kind();
        if !layout.is_native_pcm() {
            bail!(
                "unsupported: 混音不是 {AUDIO_SAMPLE_RATE} Hz、{AUDIO_CHANNELS} 声道的 32 位浮点或 16/24/32 位整数 WAV（{} Hz、{} 声道、{} 位{}）",
                layout.sample_rate,
                layout.channels,
                layout.bits_per_sample,
                if layout.float { "浮点" } else { "整数" }
            );
        }
        let mut source = Self::open(path)?;
        source
            .reader
            .seek(SeekFrom::Start(layout.data_offset))
            .context("定位混音 WAV 的数据块失败")?;
        source.kind = kind.expect("is_native_pcm 查过");
        source.remaining = Some(layout.data_bytes / source.frame_bytes() as u64);
        Ok(source)
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
        // 这一块最多多少帧：块长，截到总帧数。
        let mut want = AUDIO_CHUNK_FRAMES as u64;
        if let Some(total) = self.total {
            want = want.min(total.saturating_sub(self.frames));
        }
        if want == 0 || (self.exhausted && self.total.is_none()) {
            return Ok(None);
        }
        // 从文件读多少帧：不超过数据块剩下的。
        let read_frames = self.remaining.map_or(want, |remaining| want.min(remaining)) as usize;
        let frame_bytes = self.frame_bytes();
        let mut bytes = vec![0_u8; read_frames * frame_bytes];
        let mut filled = 0_usize;
        while !self.exhausted && filled < bytes.len() {
            match self.reader.read(&mut bytes[filled..]) {
                Ok(0) => self.exhausted = true,
                Ok(read) => filled += read,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(error) => return Err(error).context("读取混音 PCM 失败"),
            }
        }
        let read = filled / frame_bytes;
        if let Some(remaining) = self.remaining.as_mut() {
            *remaining -= read as u64;
            if *remaining == 0 {
                self.exhausted = true;
            }
        }
        // 文件不够长：有总帧数时补静音到这一块的长度，没有时交读到的那些。
        let frames = if self.total.is_some() {
            want as usize
        } else {
            read
        };
        if frames == 0 {
            self.exhausted = true;
            return Ok(None);
        }
        let kind = self.kind;
        let mut samples: Vec<f32> = bytes[..read * frame_bytes]
            .chunks_exact(kind.bytes())
            .map(|value| kind.decode(value))
            .collect();
        samples.resize(frames * AUDIO_CHANNELS as usize, 0.0);
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

    /// CRF 18 落在曲线原值上，每差 6 码率差一倍；上限仍是 60 Mb/s。
    #[test]
    fn crf_maps_onto_the_bitrate_curve_doubling_every_six_steps() {
        let base = video_bitrate(1920, 1080, 30.0);
        assert_eq!(crf_bitrate(1920, 1080, 30.0, 18), base);
        assert_eq!(crf_bitrate(1920, 1080, 30.0, 24), base / 2);
        assert_eq!(crf_bitrate(1920, 1080, 30.0, 12), base * 2);
        // H.264 的缺省 CRF 20：曲线的 2^(-1/3)。
        assert_eq!(
            crf_bitrate(1920, 1080, 30.0, 20),
            (f64::from(base) * 2_f64.powf(-2.0 / 6.0)).round() as u32
        );
        assert_eq!(crf_bitrate(3840, 2160, 60.0, 0), 60_000_000);
        assert!(crf_bitrate(320, 180, 30.0, 51) >= 1);
    }

    /// 按 ffmpeg 写的样子造一个 32 位浮点 WAV（可选 EXTENSIBLE、数据块前有 LIST 块、数据块后有尾块）。
    fn wav(tag: u16, rate: u32, channels: u16, data_size: u32, samples: &[f32]) -> Vec<u8> {
        let mut fmt = Vec::new();
        fmt.extend_from_slice(&tag.to_le_bytes());
        fmt.extend_from_slice(&channels.to_le_bytes());
        fmt.extend_from_slice(&rate.to_le_bytes());
        fmt.extend_from_slice(&(rate * 4 * u32::from(channels)).to_le_bytes());
        fmt.extend_from_slice(&(4 * channels).to_le_bytes());
        fmt.extend_from_slice(&32u16.to_le_bytes());
        if tag == 0xFFFE {
            fmt.extend_from_slice(&22u16.to_le_bytes());
            fmt.extend_from_slice(&32u16.to_le_bytes());
            fmt.extend_from_slice(&3u32.to_le_bytes());
            fmt.extend_from_slice(&3u16.to_le_bytes());
            fmt.extend_from_slice(&[0u8; 14]);
        }
        let mut bytes = b"RIFF\0\0\0\0WAVE".to_vec();
        bytes.extend_from_slice(b"LIST");
        bytes.extend_from_slice(&3u32.to_le_bytes());
        bytes.extend_from_slice(b"abc\0");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&(fmt.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&fmt);
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_size.to_le_bytes());
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        bytes
    }

    /// WAV 头：EXTENSIBLE、数据块长度写坏（0xFFFFFFFF）时按到文件末尾算；格式不对时写入器不接（调用方回落 ffmpeg）。
    #[test]
    fn wav_headers_locate_the_data_and_report_the_format() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mix.wav");
        std::fs::write(&path, wav(3, 48_000, 2, 80, &[0.0; 20])).unwrap();
        let layout = read_wav_layout(&path).unwrap();
        assert_eq!(
            (layout.data_offset, layout.data_bytes),
            (12 + 12 + 8 + 16 + 8, 80)
        );
        assert!(layout.is_native_pcm());
        std::fs::write(&path, wav(0xFFFE, 48_000, 2, u32::MAX, &[0.0; 20])).unwrap();
        let layout = read_wav_layout(&path).unwrap();
        assert!(layout.is_native_pcm());
        assert_eq!(layout.data_bytes, 80);
        std::fs::write(&path, wav(3, 44_100, 2, 80, &[0.0; 20])).unwrap();
        assert!(!read_wav_layout(&path).unwrap().is_native_pcm());
        assert!(PcmSource::open_wav(&path).is_err());
        std::fs::write(&path, wav(3, 48_000, 1, 80, &[0.0; 20])).unwrap();
        assert!(!read_wav_layout(&path).unwrap().is_native_pcm());
        // 32 位整数也收（读进来换成浮点）。
        std::fs::write(&path, wav(1, 48_000, 2, 80, &[0.0; 20])).unwrap();
        assert!(read_wav_layout(&path).unwrap().is_native_pcm());
        std::fs::write(&path, b"not a wav file").unwrap();
        assert!(read_wav_layout(&path).is_err());
    }

    /// WAV 的样本从数据块读起、停在数据块末尾（后面的尾块不当成声音）；给了总帧数时补静音或截到正好那么长。
    #[test]
    fn wav_pcm_is_padded_with_silence_or_cut_to_the_track_length() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mix.wav");
        let samples: Vec<f32> = (0..10).map(|i| i as f32).collect();
        let mut bytes = wav(3, 48_000, 2, 40, &samples);
        bytes.extend_from_slice(b"junk\x04\0\0\0\x7f\x7f\x7f\x7f");
        std::fs::write(&path, &bytes).unwrap();

        // 不给总帧数：只交数据块里的 5 帧。
        let mut source = PcmSource::open_wav(&path).unwrap();
        let chunk = source.next_chunk().unwrap().unwrap();
        assert_eq!(chunk.samples, samples);
        assert!(source.next_chunk().unwrap().is_none());

        // 补静音：数据块 5 帧、总长 1.5 块。
        let mut source = PcmSource::open_wav(&path).unwrap();
        let total = AUDIO_CHUNK_FRAMES as u64 * 3 / 2;
        source.total = Some(total);
        let first = source.next_chunk().unwrap().unwrap();
        assert_eq!(first.frames(), AUDIO_CHUNK_FRAMES);
        assert_eq!(first.samples[..10], samples[..]);
        assert!(first.samples[10..].iter().all(|v| *v == 0.0));
        let second = source.next_chunk().unwrap().unwrap();
        assert_eq!(second.start_frame, AUDIO_CHUNK_FRAMES as u64);
        assert_eq!(second.frames() as u64, total - AUDIO_CHUNK_FRAMES as u64);
        assert!(source.next_chunk().unwrap().is_none());
        assert_eq!(
            source.position_seconds(),
            total as f64 / f64::from(AUDIO_SAMPLE_RATE)
        );

        // 截断：总长 3 帧。
        let mut source = PcmSource::open_wav(&path).unwrap();
        source.total = Some(3);
        assert_eq!(source.next_chunk().unwrap().unwrap().samples, samples[..6]);
        assert!(source.next_chunk().unwrap().is_none());
    }

    /// 整数 WAV（Runtime 的混音是 16 位）：按 ffmpeg 的口径换成浮点（除以 2^(位数−1)），24 位符号扩展。
    #[test]
    fn integer_wav_samples_are_converted_to_float() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mix.wav");
        // 同一个 32 位浮点头，改成整数格式与位数；数据块按位数重写。
        let build = |bits: u16, data: &[u8]| {
            let mut bytes = wav(1, 48_000, 2, data.len() as u32, &[]);
            let fmt = 12 + 12 + 8;
            bytes[fmt + 14..fmt + 16].copy_from_slice(&bits.to_le_bytes());
            bytes.extend_from_slice(data);
            bytes
        };
        let s16: Vec<u8> = [0_i16, 16_384, -32_768, 32_767]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        std::fs::write(&path, build(16, &s16)).unwrap();
        let layout = read_wav_layout(&path).unwrap();
        assert_eq!((layout.bits_per_sample, layout.float), (16, false));
        assert!(layout.is_native_pcm());
        let mut source = PcmSource::open_wav(&path).unwrap();
        let chunk = source.next_chunk().unwrap().unwrap();
        assert_eq!(chunk.samples, [0.0, 0.5, -1.0, 32_767.0 / 32_768.0]);
        assert!(source.next_chunk().unwrap().is_none());

        // 24 位：0x400000 = 0.5，0x800000 = -1.0。
        let s24 = [0, 0, 0x40, 0, 0, 0x80, 0xFF, 0xFF, 0xFF, 0, 0, 0];
        std::fs::write(&path, build(24, &s24)).unwrap();
        let chunk = PcmSource::open_wav(&path)
            .unwrap()
            .next_chunk()
            .unwrap()
            .unwrap();
        assert_eq!(chunk.samples, [0.5, -1.0, -1.0 / 8_388_608.0, 0.0]);

        // 8 位不收。
        std::fs::write(&path, build(8, &[0; 4])).unwrap();
        assert!(!read_wav_layout(&path).unwrap().is_native_pcm());
        assert!(PcmSource::open_wav(&path).is_err());
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
        let options = |fps_num, fps_den| Mp4Options {
            width: 100,
            height: 100,
            fps_num,
            fps_den,
            video_bitrate: None,
            audio: None,
        };
        assert!(open_mp4_writer_with_options(&out, &options(0, 1)).is_err());
        assert!(open_mp4_writer_with_options(&out, &options(30, 0)).is_err());
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
