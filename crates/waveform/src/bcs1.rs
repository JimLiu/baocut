//! BCS1（BaoCut Spectrum v1）：驱动 visualizer 元素像素的频谱缓存。
//!
//! 全部小端。header 40 字节，随后是 `frame_count` 个 640 字节定长帧：
//!
//! | 偏移 | 大小 | 字段 |
//! | --- | --- | --- |
//! | 0 | 4 | `magic` = `"BCS1"` |
//! | 4 | 2 | `version` = 1 |
//! | 6 | 2 | `flags`，bit0 = backend（0 = symphonia，1 = ffmpeg），其余保留为 0 |
//! | 8 | 4 | `analysis_rate` = 60 |
//! | 12 | 4 | `sample_rate` = 48000 |
//! | 16 | 4 | `fft_size` = 1024 |
//! | 20 | 4 | `time_bins` = 128 |
//! | 24 | 4 | `freq_bins` = 512 |
//! | 28 | 4 | `frame_count` |
//! | 32 | 8 | `content_hash` = FNV-1a64(解码 PCM ‖ DSP 参数) |
//!
//! 每帧前 128 字节是时域行（中心化到 128，语义对齐 Web Audio 的
//! `getByteTimeDomainData`：静音 ≈ 128），后 512 字节是频域行（dB 按 **canonical
//! 窗 [-120, +40]** 线性映射到 0..255）。
//!
//! canonical 窗是唯一进缓存的 dB 窗：元素级的 `minDb` / `maxDb` / `smoothing` /
//! `gain` 由 [`crate::remap`] 在 host preflight 重映射，一份缓存服务任意参数组合。

use anyhow::{Result, bail};

pub const MAGIC: &[u8; 4] = b"BCS1";
pub const VERSION: u16 = 1;
pub const HEADER_LEN: usize = 40;
/// 分析帧率（Hz）。对齐 60 fps 预览的逐帧 `AnalyserNode` 采样节奏。
pub const ANALYSIS_RATE: u32 = 60;
/// visualizer 专用解码采样率。48 kHz 让前 64 个 FFT bin 覆盖 0–3 kHz、
/// 全 512 个 bin 覆盖 0–24 kHz，与 Web Audio 参考链路一致。
pub const SAMPLE_RATE: u32 = 48_000;
/// 缓存层固定的 FFT 长度，**不随元素的 `fftSize` 变化**。
pub const FFT_SIZE: u32 = 1024;
pub const TIME_BINS: u32 = 128;
pub const FREQ_BINS: u32 = FFT_SIZE / 2;
/// 每帧字节数 = 128 + 512。
pub const FRAME_LEN: usize = (TIME_BINS + FREQ_BINS) as usize;
/// hop = `sample_rate / analysis_rate`，由分析帧率唯一确定。
pub const HOP: u32 = SAMPLE_RATE / ANALYSIS_RATE;
/// canonical dB 窗下沿。覆盖两组窗（-80/+40 与 -120/-10）的并集。
pub const CANONICAL_MIN_DB: f64 = -120.0;
/// canonical dB 窗上沿。
pub const CANONICAL_MAX_DB: f64 = 40.0;
/// `flags` 里已定义的位；其余保留位必须为 0。
const FLAG_BACKEND_FFMPEG: u16 = 1 << 0;

/// PCM 的来源解码器。跨后端**不承诺**逐位一致的 PCM，因此写进 header。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpectrumBackend {
    Symphonia,
    Ffmpeg,
}

impl SpectrumBackend {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Symphonia => "symphonia",
            Self::Ffmpeg => "ffmpeg",
        }
    }

    fn flags(self) -> u16 {
        match self {
            Self::Symphonia => 0,
            Self::Ffmpeg => FLAG_BACKEND_FFMPEG,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bcs1Header {
    pub version: u16,
    pub backend: SpectrumBackend,
    pub analysis_rate: u32,
    pub sample_rate: u32,
    pub fft_size: u32,
    pub time_bins: u32,
    pub freq_bins: u32,
    pub frame_count: u32,
    pub content_hash: u64,
}

impl Bcs1Header {
    /// 冻结参数 + 本次的 backend、帧数与内容 hash。
    pub fn new(backend: SpectrumBackend, frame_count: u32, content_hash: u64) -> Self {
        Self {
            version: VERSION,
            backend,
            analysis_rate: ANALYSIS_RATE,
            sample_rate: SAMPLE_RATE,
            fft_size: FFT_SIZE,
            time_bins: TIME_BINS,
            freq_bins: FREQ_BINS,
            frame_count,
            content_hash,
        }
    }

    /// 内容 hash 的十六进制形式；进渲染指纹时用它，避免各处各写一份格式化。
    pub fn content_hash_hex(&self) -> String {
        format!("{:016x}", self.content_hash)
    }

    /// 频谱覆盖的秒数 = `frame_count / analysis_rate`。
    pub fn duration_seconds(&self) -> f64 {
        f64::from(self.frame_count) / f64::from(self.analysis_rate)
    }

    fn write_into(&self, bytes: &mut Vec<u8>) {
        bytes.extend_from_slice(MAGIC);
        bytes.extend_from_slice(&self.version.to_le_bytes());
        bytes.extend_from_slice(&self.backend.flags().to_le_bytes());
        bytes.extend_from_slice(&self.analysis_rate.to_le_bytes());
        bytes.extend_from_slice(&self.sample_rate.to_le_bytes());
        bytes.extend_from_slice(&self.fft_size.to_le_bytes());
        bytes.extend_from_slice(&self.time_bins.to_le_bytes());
        bytes.extend_from_slice(&self.freq_bins.to_le_bytes());
        bytes.extend_from_slice(&self.frame_count.to_le_bytes());
        bytes.extend_from_slice(&self.content_hash.to_le_bytes());
    }
}

/// 已校验的 BCS1 只读视图。所有取行方法都不复制字节。
#[derive(Debug, Clone, Copy)]
pub struct Bcs1View<'a> {
    header: Bcs1Header,
    payload: &'a [u8],
}

impl<'a> Bcs1View<'a> {
    pub fn header(&self) -> Bcs1Header {
        self.header
    }

    pub fn frame_count(&self) -> usize {
        self.header.frame_count as usize
    }

    /// 第 `index` 帧的完整 640 字节；越界返回 `None`。
    pub fn frame(&self, index: usize) -> Option<&'a [u8]> {
        let start = index.checked_mul(FRAME_LEN)?;
        self.payload.get(start..start + FRAME_LEN)
    }

    /// 第 `index` 帧的时域行（128 字节，静音 ≈ 128）。
    pub fn time_row(&self, index: usize) -> Option<&'a [u8]> {
        self.frame(index).map(|frame| &frame[..TIME_BINS as usize])
    }

    /// 第 `index` 帧的频域行（512 字节，canonical dB 窗）。
    pub fn freq_row(&self, index: usize) -> Option<&'a [u8]> {
        self.frame(index).map(|frame| &frame[TIME_BINS as usize..])
    }

    /// 秒 → 帧号：向下取整并钳制到有效范围。`frame_count` 为 0 时返回 `None`。
    ///
    /// 取整规则本身住在 [`frame_index_at`]——渲染期的 `VizTrack` 手上没有 BCS1
    /// 字节，只有 `analysis_rate` 与帧数，两边必须落到同一个函数上。
    pub fn frame_index_at(&self, seconds: f64) -> Option<usize> {
        frame_index_at(self.header.analysis_rate, self.frame_count(), seconds)
    }
}

/// **秒 → 帧号的唯一真相**（设计 ADR-E04）：`floor(t × analysis_rate)`，
/// 再钳到 `0..frame_count-1`。不插值、不四舍五入。
///
/// 取整方向与 `quantize_time(t, fps) = floor(t·fps + 1e-9)/fps` 一致；插值会让
/// 「同一帧渲染两次得到同一结果」依赖浮点结合律，因此被明确否掉。
/// 非有限或非正的 `seconds` 一律落到帧 0：负时刻是调用方的越界，不是错误。
pub fn frame_index_at(analysis_rate: u32, frame_count: usize, seconds: f64) -> Option<usize> {
    if frame_count == 0 {
        return None;
    }
    if !seconds.is_finite() || seconds <= 0.0 {
        return Some(0);
    }
    let index = (seconds * f64::from(analysis_rate)).floor();
    Some((index as usize).min(frame_count - 1))
}

/// header + payload → BCS1 字节。payload 必须是 `frame_count × 640`。
pub fn encode(header: &Bcs1Header, payload: &[u8]) -> Result<Vec<u8>> {
    let expected = (header.frame_count as usize)
        .checked_mul(FRAME_LEN)
        .unwrap_or(usize::MAX);
    if payload.len() != expected {
        bail!(
            "BCS1 payload 长度 {} 与 frameCount {} 不一致（应为 {expected}）",
            payload.len(),
            header.frame_count
        );
    }
    let mut bytes = Vec::with_capacity(HEADER_LEN + payload.len());
    header.write_into(&mut bytes);
    bytes.extend_from_slice(payload);
    Ok(bytes)
}

/// BCS1 字节 → 只读视图。冻结参数逐项校验，保留位必须为 0。
pub fn parse(bytes: &[u8]) -> Result<Bcs1View<'_>> {
    if bytes.len() < HEADER_LEN || &bytes[..4] != MAGIC {
        bail!("频谱不是 BCS1 格式");
    }
    let u16_at = |offset: usize| u16::from_le_bytes(bytes[offset..offset + 2].try_into().unwrap());
    let u32_at = |offset: usize| u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
    let version = u16_at(4);
    if version != VERSION {
        bail!("BCS1 version {version} 不受支持（当前 {VERSION}）");
    }
    let flags = u16_at(6);
    if flags & !FLAG_BACKEND_FFMPEG != 0 {
        bail!("BCS1 flags 的保留位必须为 0（读到 {flags:#06x}）");
    }
    let backend = if flags & FLAG_BACKEND_FFMPEG == 0 {
        SpectrumBackend::Symphonia
    } else {
        SpectrumBackend::Ffmpeg
    };
    for (offset, expected, name) in [
        (8usize, ANALYSIS_RATE, "analysisRate"),
        (12, SAMPLE_RATE, "sampleRate"),
        (16, FFT_SIZE, "fftSize"),
        (20, TIME_BINS, "timeBins"),
        (24, FREQ_BINS, "freqBins"),
    ] {
        let actual = u32_at(offset);
        if actual != expected {
            bail!("BCS1 {name} 必须是 {expected}（读到 {actual}）");
        }
    }
    let frame_count = u32_at(28);
    if frame_count == 0 {
        bail!("BCS1 frameCount 必须大于 0");
    }
    let content_hash = u64::from_le_bytes(bytes[32..40].try_into().unwrap());
    let payload = &bytes[HEADER_LEN..];
    let expected = (frame_count as usize)
        .checked_mul(FRAME_LEN)
        .unwrap_or(usize::MAX);
    if payload.len() != expected {
        bail!(
            "BCS1 frameCount {frame_count} 与 payload 长度 {} 不一致（应为 {expected}）",
            payload.len()
        );
    }
    Ok(Bcs1View {
        header: Bcs1Header {
            version,
            backend,
            analysis_rate: ANALYSIS_RATE,
            sample_rate: SAMPLE_RATE,
            fft_size: FFT_SIZE,
            time_bins: TIME_BINS,
            freq_bins: FREQ_BINS,
            frame_count,
            content_hash,
        },
        payload,
    })
}

/// 只读 header，不校验 payload 长度——渲染指纹只要内容 hash 时用它。
pub fn parse_header(bytes: &[u8]) -> Result<Bcs1Header> {
    Ok(parse(bytes)?.header())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload(frames: usize) -> Vec<u8> {
        (0..frames * FRAME_LEN)
            .map(|index| (index % 251) as u8)
            .collect()
    }

    #[test]
    fn frozen_constants_match_the_specification() {
        assert_eq!(HEADER_LEN, 40);
        assert_eq!(ANALYSIS_RATE, 60);
        assert_eq!(SAMPLE_RATE, 48_000);
        assert_eq!(FFT_SIZE, 1024);
        assert_eq!(TIME_BINS, 128);
        assert_eq!(FREQ_BINS, 512);
        assert_eq!(FRAME_LEN, 640);
        assert_eq!(HOP, 800);
        assert_eq!(CANONICAL_MIN_DB, -120.0);
        assert_eq!(CANONICAL_MAX_DB, 40.0);
    }

    #[test]
    fn round_trip_preserves_header_and_every_frame() {
        let payload = sample_payload(3);
        let header = Bcs1Header::new(SpectrumBackend::Ffmpeg, 3, 0x0123_4567_89ab_cdef);
        let bytes = encode(&header, &payload).unwrap();
        assert_eq!(bytes.len(), HEADER_LEN + 3 * FRAME_LEN);
        assert_eq!(&bytes[..4], MAGIC);
        assert_eq!(u16::from_le_bytes(bytes[6..8].try_into().unwrap()), 1);
        let view = parse(&bytes).unwrap();
        assert_eq!(view.header(), header);
        assert_eq!(view.header().content_hash_hex(), "0123456789abcdef");
        assert_eq!(view.frame_count(), 3);
        for frame in 0..3 {
            assert_eq!(
                view.frame(frame).unwrap(),
                &payload[frame * FRAME_LEN..(frame + 1) * FRAME_LEN]
            );
            assert_eq!(view.time_row(frame).unwrap().len(), 128);
            assert_eq!(view.freq_row(frame).unwrap().len(), 512);
            assert_eq!(
                view.freq_row(frame).unwrap(),
                &view.frame(frame).unwrap()[128..]
            );
        }
        assert!(view.frame(3).is_none());
    }

    #[test]
    fn backend_flag_survives_the_round_trip() {
        for backend in [SpectrumBackend::Symphonia, SpectrumBackend::Ffmpeg] {
            let header = Bcs1Header::new(backend, 1, 7);
            let bytes = encode(&header, &sample_payload(1)).unwrap();
            assert_eq!(parse(&bytes).unwrap().header().backend, backend);
        }
        let symphonia = encode(
            &Bcs1Header::new(SpectrumBackend::Symphonia, 1, 7),
            &sample_payload(1),
        )
        .unwrap();
        assert_eq!(u16::from_le_bytes(symphonia[6..8].try_into().unwrap()), 0);
    }

    #[test]
    fn parse_rejects_every_header_boundary_violation() {
        let good = encode(
            &Bcs1Header::new(SpectrumBackend::Symphonia, 2, 42),
            &sample_payload(2),
        )
        .unwrap();
        assert!(parse(&good).is_ok());
        assert!(parse(&good[..HEADER_LEN - 1]).is_err());

        let mut magic = good.clone();
        magic[..4].copy_from_slice(b"BCW1");
        assert!(parse(&magic).is_err());

        let mut version = good.clone();
        version[4..6].copy_from_slice(&2u16.to_le_bytes());
        assert!(parse(&version).is_err());

        let mut reserved = good.clone();
        reserved[6..8].copy_from_slice(&0b10u16.to_le_bytes());
        assert!(parse(&reserved).is_err());

        for offset in [8usize, 12, 16, 20, 24] {
            let mut tampered = good.clone();
            tampered[offset..offset + 4].copy_from_slice(&9u32.to_le_bytes());
            assert!(parse(&tampered).is_err(), "offset {offset} 未被拒绝");
        }

        let mut zero_frames = good.clone();
        zero_frames[28..32].copy_from_slice(&0u32.to_le_bytes());
        assert!(parse(&zero_frames).is_err());

        let mut short = good.clone();
        short.truncate(HEADER_LEN + FRAME_LEN);
        assert!(parse(&short).is_err());

        let mut long = good.clone();
        long.push(0);
        assert!(parse(&long).is_err());
    }

    #[test]
    fn encode_rejects_payloads_that_do_not_match_frame_count() {
        let header = Bcs1Header::new(SpectrumBackend::Symphonia, 2, 0);
        assert!(encode(&header, &sample_payload(1)).is_err());
        assert!(encode(&header, &sample_payload(3)).is_err());
        assert!(encode(&header, &sample_payload(2)).is_ok());
    }

    #[test]
    fn frame_index_floors_and_clamps() {
        let bytes = encode(
            &Bcs1Header::new(SpectrumBackend::Symphonia, 5, 0),
            &sample_payload(5),
        )
        .unwrap();
        let view = parse(&bytes).unwrap();
        assert_eq!(view.header().duration_seconds(), 5.0 / 60.0);
        assert_eq!(view.frame_index_at(-1.0), Some(0));
        assert_eq!(view.frame_index_at(0.0), Some(0));
        assert_eq!(view.frame_index_at(0.016), Some(0));
        assert_eq!(view.frame_index_at(1.0 / 60.0), Some(1));
        assert_eq!(view.frame_index_at(4.0 / 60.0), Some(4));
        assert_eq!(view.frame_index_at(99.0), Some(4));
        assert_eq!(view.frame_index_at(f64::NAN), Some(0));
    }

    /// 视图上的方法只是自由函数的转发——渲染期的 `VizTrack` 走的是自由函数，
    /// 两条路必须逐个时刻给出同一个帧号（设计 ADR-E04「取整规则是契约的一部分」）。
    #[test]
    fn the_view_method_forwards_to_the_free_function() {
        let bytes = encode(
            &Bcs1Header::new(SpectrumBackend::Symphonia, 5, 0),
            &sample_payload(5),
        )
        .unwrap();
        let view = parse(&bytes).unwrap();
        for step in -5..300 {
            let seconds = f64::from(step) / 1000.0;
            assert_eq!(
                view.frame_index_at(seconds),
                frame_index_at(ANALYSIS_RATE, 5, seconds),
                "{seconds}s"
            );
        }
        assert_eq!(frame_index_at(ANALYSIS_RATE, 0, 1.0), None);
    }
}
