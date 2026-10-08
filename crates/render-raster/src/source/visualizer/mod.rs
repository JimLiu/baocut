//! 频谱素材源（元素方案 ADR-E04）。
//!
//! 一条 [`VizTrack`] 就是「整段音频、按某个元素的参数派生好的逐帧频谱」。它在
//! **host preflight** 里一次性算完（`bcut spectrum` 产出的 BCS1 → 元素 dB 窗 →
//! 指数平滑 → gain），渲染期只做一次数组下标查找：
//!
//! ```text
//! idx = clamp(floor(t × analysis_rate), 0, frame_count - 1)   // nearest，向下取整
//! ```
//!
//! **平滑为什么不在 `sample(t)` 里算**：`y[n] = τ·y[n-1] + (1-τ)·x[n]` 天然递推，
//! 放进采样期就等于给源装一个增量时钟——而导出是乱序的（`bcut render --t 7.5`
//! 直接跳帧、全片导出按 stride 分给多个 worker）。ADR-E04 因此把平滑钉在
//! preflight，把 `sample` 钉成纯查表，`shuffled_sampling_equals_sorted_sampling`
//! 是这条契约的可执行形式。
//!
//! **时域行与频域行的分工**（本模块的语义决定，见 [`VizTrack::derive`]）：
//! 频域行走完整的「重映射 → 平滑 → gain」链条；时域行**逐字节原样搬运**。
//! 依据是本方案一路对齐的 Web Audio 语义——`smoothingTimeConstant` 只作用于
//! `getByteFrequencyData`，`getByteTimeDomainData` 拿到的是原始波形；而 dB 窗
//! 对一条「静音 ≈ 128」的中心化波形本来就没有意义。
//!
//! ## §8 的 GPU 接口在这里冻结（本阶段只冻结，不实现）
//!
//! 设计 §8 是跨文档契约，P5 的 wgpu 后端与 P6 的 wasm 预览都按它接线：
//!
//! * §8.1 bind group：`@group(0)` 变换、`@group(1)` 逐效果标量、
//!   `@group(2) @binding(0)` 音频纹理 + `@binding(1)` sampler（linear /
//!   clamp-to-edge）；
//! * §8.2 `@group(1)` uniform **顺序冻结**：visualizer 8 项
//!   `u_time / u_mainColor / u_secondaryColor / u_canvasRes / u_dstRes /
//!   u_colourMultiplier / u_clip / u_textureSize`；
//! * §8.3 音频纹理：`R8Unorm`、`w × 2`、**row 0 = 时域、row 1 = 频域、无 flip**
//!   （GLSL 参考实现开了 `UNPACK_FLIP_Y_WEBGL`，行序与 WGSL 相反，移植时必须
//!   翻转行索引，否则得到静默的错误图像）——见 [`AUDIO_TEXTURE_ROW_TIME`] /
//!   [`AUDIO_TEXTURE_ROW_FREQ`]；
//! * §8.4 频率映射：48 kHz 的 BCS1 直接对齐 Web Audio，`binWidth == "64"`
//!   取最低 64 个 bin（0–3 kHz），`half` 覆盖 0–24 kHz——见
//!   [`VizFrame::freq_window`]。

use anyhow::{Result, bail};
use sha2::{Digest, Sha256};
use waveform::bcs1::{self, TIME_BINS};
use waveform::remap::Remapper;

use super::ContentHash;

pub mod draw;
pub(crate) mod recipes;

pub use draw::{VisualizerParams, VizBox, visualizer_frame};

/// 音频纹理的时域行行号（设计 §8.3，**无 flip**）。
pub const AUDIO_TEXTURE_ROW_TIME: u32 = 0;
/// 音频纹理的频域行行号（设计 §8.3，**无 flip**）。
pub const AUDIO_TEXTURE_ROW_FREQ: u32 = 1;
/// 音频纹理的高度。
pub const AUDIO_TEXTURE_ROWS: u32 = 2;
/// `binWidth == "64"` 的纹理宽度（设计 §8.3/§8.4）：48 kHz 分析下的
/// **最低 64 个 bin**（0–3 kHz）。
pub const FIXED_BIN_WIDTH: usize = 64;

/// 按配方的 `binWidth` 取频域行的可用段（设计 §8.4）。
pub(crate) fn freq_row(frame: &VizFrame, bin_width: motion::preset_registry::BinWidth) -> &[u8] {
    match bin_width {
        motion::preset_registry::BinWidth::Fixed64 => frame.freq_window(FIXED_BIN_WIDTH),
        motion::preset_registry::BinWidth::Half => &frame.freq,
    }
}

/// 时域行**重采样到音频纹理的宽度**（设计 §8.3 的定案，P5b 冻结）。
///
/// `VizFrame` 的两条行宽度不同（BCS1 的 128 / 512），而 §8.3 的纹理是 `w × 2`
/// ——两条行必须同宽。频域行按 `binWidth` 取窗（原样字节），时域行按
/// [`crate::source::kernel::sample_row_linear`] 的 clamp-to-edge 纹素中心规则
/// 重采样到同宽。
///
/// **CPU 绘制走同一条**：`oscilloscope-v1`（`oscilloscope` / `ring_wave`）是唯一
/// 读时域行的算法，它们的 `binWidth` 是 `"half"`，纹理宽 512 是时域行 128 的四倍。
/// 示波器折线在重采样后的行上取 `samples` 个点，与 `AudioTexture` 上传的字节逐字
/// 相同——**重采样是行语义的一部分**，不是上传期的实现细节：两侧共用本函数。
///
/// 宽度相同时逐字节恒等（`Borrowed`，不复制）。
pub(crate) fn time_row(
    frame: &VizFrame,
    bin_width: motion::preset_registry::BinWidth,
) -> std::borrow::Cow<'_, [u8]> {
    let width = freq_row(frame, bin_width).len().max(1);
    if frame.time.len() == width {
        return std::borrow::Cow::Borrowed(&frame.time);
    }
    std::borrow::Cow::Owned(
        (0..width)
            .map(|index| {
                let u = (index as f64 + 0.5) / width as f64;
                let value = crate::source::kernel::sample_row_linear(&frame.time, u);
                (value * f64::from(u8::MAX)).round().clamp(0.0, 255.0) as u8
            })
            .collect(),
    )
}

/// 派生算法的版本号，进 [`VizTrack::fingerprint`]。
///
/// 改了「哪条行走哪条链路」「取整放在哪一步」这类语义就必须 +1，否则旧产物会
/// 带着新像素复用旧指纹。
const DERIVE_VERSION: u32 = 1;

/// 一帧频谱：两条字节行。
///
/// 两条行**宽度不同**（BCS1 的 128 / 512），因为它们本来就是两种量：时域是
/// 波形采样、频域是 dB 窗内的幅度。§8.3 的 `w × 2` 纹理是 GPU 上传期的事——
/// 那一步按配方的 `binWidth` 把两条行各自取到同一个 `w`，不属于本层。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VizFrame {
    /// 时域行，中心化到 128（静音 ≈ 128），语义对齐 `getByteTimeDomainData`。
    pub time: Box<[u8]>,
    /// 频域行，已按元素的 `[minDb, maxDb]` 重映射、平滑并乘上 `gain`。
    pub freq: Box<[u8]>,
}

impl VizFrame {
    /// 频域行的**最低 `bins` 个 bin**（设计 §8.4：48 kHz 下 64 bin = 0–3 kHz）。
    ///
    /// `bins` 超过行宽时返回整行——配方要的 bin 数比缓存还多是配方的事，
    /// 采样端不该 panic。
    pub fn freq_window(&self, bins: usize) -> &[u8] {
        &self.freq[..bins.min(self.freq.len())]
    }

    /// 一帧**纯静音**：时域行中心化到 128、频域行全 0。
    ///
    /// 给 host 的「映射不到音频区段」用（`audio: "project"` 的输出时刻落在剪掉的
    /// 空隙里、或该时刻在播另一条源）。频域取 0 而不是"某个 dB 底"是因为这不是
    /// "很轻的声音"，是**根本没有声音**——柱状样式的 `max(freq, minHeight)` 会
    /// 把它画成一排小柱子，与静音段的观感一致。
    pub fn silent(time_bins: usize, freq_bins: usize) -> VizFrame {
        VizFrame {
            time: vec![TIME_DOMAIN_SILENCE; time_bins].into_boxed_slice(),
            freq: vec![0; freq_bins].into_boxed_slice(),
        }
    }
}

/// 时域行的静音基线（`getByteTimeDomainData` 的中心值）。
pub const TIME_DOMAIN_SILENCE: u8 = 128;

/// 元素级派生参数（`VisualizerProps` 的渲染侧对应物）。
///
/// 刻意不带 `Default`：缺省值住在 `bcut_timeline::schema` 的
/// `VISUALIZER_*_DEFAULT` 常量里，让本层再抄一份就会出现两套缺省。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VizParams {
    pub min_db: f64,
    pub max_db: f64,
    /// `smoothingTimeConstant` 的离线等价，钳到 0..1。
    pub smoothing: f64,
    /// BaoCut 自有字段：重映射后、绘制前相乘。
    pub gain: f64,
}

/// 频谱素材源的落地实现：整轨驻留、纯查表采样。
#[derive(Debug, Clone)]
pub struct VizTrack {
    analysis_rate: u32,
    frames: Vec<VizFrame>,
    params: VizParams,
    hash: ContentHash,
}

impl VizTrack {
    /// **ADR-E04 数据流的第 2 步**：canonical BCS1 字节 → 元素参数的整轨。
    ///
    /// 只吃字节，不碰文件系统——BCS1 的读取（缓存路径、指纹、原子写）是 host
    /// 的活（`apps/cli` 的 `services/spectrum.rs`）。
    ///
    /// 频域行经 [`Remapper`] **从帧 0 顺序推进**；时域行原样搬运（见模块文档）。
    pub fn derive(spectrum: &[u8], params: VizParams) -> Result<VizTrack> {
        let view = bcs1::parse(spectrum)?;
        let header = view.header();
        let freq_bins = header.freq_bins as usize;
        let mut remapper = Remapper::new(
            freq_bins,
            params.min_db,
            params.max_db,
            params.smoothing,
            params.gain,
        );
        let mut frames = Vec::with_capacity(view.frame_count());
        let mut row = vec![0u8; freq_bins];
        for index in 0..view.frame_count() {
            let time = view
                .time_row(index)
                .ok_or_else(|| anyhow::anyhow!("BCS1 第 {index} 帧缺少时域行"))?;
            let freq = view
                .freq_row(index)
                .ok_or_else(|| anyhow::anyhow!("BCS1 第 {index} 帧缺少频域行"))?;
            remapper.push_row(freq, &mut row);
            frames.push(VizFrame {
                time: time.to_vec().into_boxed_slice(),
                freq: row.clone().into_boxed_slice(),
            });
        }
        VizTrack::assemble(header.analysis_rate, frames, params, header.content_hash)
    }

    /// 已经派生好的帧 → 轨。给「BCS1 从别处来」的 host（P6 的 wasm 预览）留的口。
    ///
    /// `source_hash` 是上游素材的内容 hash（BCS1 的 `content_hash`），与派生参数
    /// 一起进 [`VizTrack::fingerprint`]。
    pub fn assemble(
        analysis_rate: u32,
        frames: Vec<VizFrame>,
        params: VizParams,
        source_hash: u64,
    ) -> Result<VizTrack> {
        if analysis_rate == 0 {
            bail!("VizTrack 的 analysisRate 必须大于 0");
        }
        if frames.is_empty() {
            bail!("VizTrack 至少要有一帧");
        }
        let time_bins = frames[0].time.len();
        let freq_bins = frames[0].freq.len();
        if let Some(bad) = frames
            .iter()
            .position(|frame| frame.time.len() != time_bins || frame.freq.len() != freq_bins)
        {
            bail!("VizTrack 第 {bad} 帧的行宽与首帧不一致");
        }
        let mut hasher = Sha256::new();
        hasher.update(b"bcut-viztrack");
        hasher.update(DERIVE_VERSION.to_le_bytes());
        hasher.update(source_hash.to_le_bytes());
        hasher.update(analysis_rate.to_le_bytes());
        hasher.update((frames.len() as u64).to_le_bytes());
        hasher.update((time_bins as u64).to_le_bytes());
        hasher.update((freq_bins as u64).to_le_bytes());
        // 参数进指纹：同一份 BCS1 换个 dB 窗就是另一幅画面。
        for value in [params.min_db, params.max_db, params.smoothing, params.gain] {
            hasher.update(value.to_bits().to_le_bytes());
        }
        for frame in &frames {
            hasher.update(&frame.time);
            hasher.update(&frame.freq);
        }
        let hash = ContentHash::new(hasher.finalize().into());
        Ok(VizTrack {
            analysis_rate,
            frames,
            params,
            hash,
        })
    }

    pub fn params(&self) -> VizParams {
        self.params
    }

    /// 覆盖的秒数 = `frame_count / analysis_rate`。
    pub fn duration(&self) -> f64 {
        self.frames.len() as f64 / f64::from(self.analysis_rate)
    }

    /// 时域行宽（BCS1 是 [`waveform::bcs1::TIME_BINS`] = 128）。
    pub fn time_bins(&self) -> usize {
        self.frames.first().map_or(0, |frame| frame.time.len())
    }

    /// 频域行宽（BCS1 是 `fftSize / 2` = 512）。
    pub fn freq_bins(&self) -> usize {
        self.frames.first().map_or(0, |frame| frame.freq.len())
    }

    /// 第 `index` 帧；越界返回 `None`。
    pub fn frame(&self, index: usize) -> Option<&VizFrame> {
        self.frames.get(index)
    }

    /// 与本轨行宽一致的静音帧（见 [`VizFrame::silent`]）。
    pub fn silent_frame(&self) -> VizFrame {
        VizFrame::silent(self.time_bins(), self.freq_bins())
    }
}

/// 频谱源的采样契约（ADR-E04）。
///
/// 四条义务与 [`super::VisualSource`] 逐字相同：唯一入口是**绝对时刻**的
/// `sample`、不得持有增量时钟、采样只取 `&self`、内容指纹覆盖全部字节。
/// 不同的只有「一帧是什么」——见 `source/mod.rs` 里两个 trait 分家的理由。
pub trait VizSource: Send + Sync {
    fn analysis_rate(&self) -> u32;

    fn frame_count(&self) -> usize;

    /// 秒 → 帧号（ADR-E04 的取整规则）。空轨返回 `None`。
    fn frame_index_at(&self, seconds: f64) -> Option<usize>;

    /// **唯一正式采样接口**：绝对时刻 → 该时刻的频谱帧。
    fn sample(&self, seconds: f64) -> Option<&VizFrame>;

    fn fingerprint(&self) -> ContentHash;
}

impl VizSource for VizTrack {
    fn analysis_rate(&self) -> u32 {
        self.analysis_rate
    }

    fn frame_count(&self) -> usize {
        self.frames.len()
    }

    /// 取整规则**不在这里实现**：`waveform::bcs1::frame_index_at` 是它的
    /// 唯一住址，`Bcs1View::frame_index_at` 也转发到同一处（ADR-E04
    /// 「取整规则是契约的一部分」）。
    fn frame_index_at(&self, seconds: f64) -> Option<usize> {
        bcs1::frame_index_at(self.analysis_rate, self.frames.len(), seconds)
    }

    fn sample(&self, seconds: f64) -> Option<&VizFrame> {
        self.frames.get(self.frame_index_at(seconds)?)
    }

    fn fingerprint(&self) -> ContentHash {
        self.hash
    }
}

/// BCS1 的时域行宽，给 host 组装夹具时对齐用。
pub const BCS1_TIME_BINS: usize = TIME_BINS as usize;

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> VizParams {
        VizParams {
            min_db: -120.0,
            max_db: 40.0,
            smoothing: 0.0,
            gain: 1.0,
        }
    }

    fn frame(time: u8, freq: u8) -> VizFrame {
        VizFrame {
            time: vec![time; 4].into_boxed_slice(),
            freq: vec![freq; 8].into_boxed_slice(),
        }
    }

    #[test]
    fn the_rounding_rule_floors_and_clamps() {
        let track = VizTrack::assemble(
            50,
            (0..5).map(|i| frame(i as u8, i as u8)).collect(),
            params(),
            0,
        )
        .unwrap();
        assert_eq!(track.frame_index_at(-1.0), Some(0));
        assert_eq!(track.frame_index_at(0.0), Some(0));
        assert_eq!(track.frame_index_at(0.019), Some(0));
        assert_eq!(track.frame_index_at(0.02), Some(1));
        assert_eq!(track.frame_index_at(0.0399), Some(1));
        assert_eq!(track.frame_index_at(99.0), Some(4));
        assert_eq!(track.frame_index_at(f64::NAN), Some(0));
        assert_eq!(track.duration(), 0.1);
    }

    #[test]
    fn ragged_and_empty_tracks_are_refused() {
        assert!(VizTrack::assemble(50, Vec::new(), params(), 0).is_err());
        assert!(VizTrack::assemble(0, vec![frame(1, 1)], params(), 0).is_err());
        let ragged = vec![
            frame(1, 1),
            VizFrame {
                time: vec![0; 3].into_boxed_slice(),
                freq: vec![0; 8].into_boxed_slice(),
            },
        ];
        assert!(VizTrack::assemble(50, ragged, params(), 0).is_err());
    }

    #[test]
    fn the_frequency_window_takes_the_lowest_bins() {
        let mut freq = vec![0u8; 8];
        for (index, byte) in freq.iter_mut().enumerate() {
            *byte = index as u8;
        }
        let frame = VizFrame {
            time: vec![128; 4].into_boxed_slice(),
            freq: freq.into_boxed_slice(),
        };
        assert_eq!(frame.freq_window(3), &[0, 1, 2]);
        assert_eq!(frame.freq_window(99).len(), 8);
    }

    #[test]
    fn the_texture_rows_are_frozen_without_a_flip() {
        assert_eq!(AUDIO_TEXTURE_ROW_TIME, 0);
        assert_eq!(AUDIO_TEXTURE_ROW_FREQ, 1);
        assert_eq!(AUDIO_TEXTURE_ROWS, 2);
    }
}
