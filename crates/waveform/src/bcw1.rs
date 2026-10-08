//! BCW1（BaoCut Waveform v1）：时间轴 UI 的峰值包络。
//!
//! 布局（小端）：`"BCW1"` ‖ `u32 binsPerSecond` ‖ `u32 binCount` ‖ `binCount × u8`。
//! 字节值 = 峰值除以 0.98 分位后钳到 0..1 再乘 255。**格式与解码无关**：
//! 采样率、声道合并与峰值收集都在 host 侧完成，本模块只收一串峰值。
//!
//! 自 `core/crates/bcut-kernel/src/services/waveform.rs` 迁入，字节布局与分位数实现逐位不变
//! ——Swift 的 `BCWaveform.swift` 与既有缓存文件都依赖它。

use anyhow::{Result, bail};

pub const FORMAT: &str = "BCW1";
/// 每秒 bin 数。BCS1 的 `analysis_rate` 与之对齐。
pub const BINS_PER_SECOND: u32 = 50;
pub const HEADER_LEN: usize = 12;
/// 归一化分位。峰值除以它再钳制，避免个别爆音把整条包络压平。
const NORMALIZE_QUANTILE: f64 = 0.98;
/// 分位下限。全静音素材不能除以 0。
const NORMALIZE_FLOOR: f32 = 1e-4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bcw1Info {
    pub bins_per_second: u32,
    pub bin_count: u32,
}

/// 峰值序列 → BCW1 字节。
pub fn encode(peaks: &[f32]) -> Result<Vec<u8>> {
    if peaks.is_empty() {
        bail!("媒体没有音频轨");
    }
    let Ok(bin_count) = u32::try_from(peaks.len()) else {
        bail!("波形 bin 数超过 BCW1 上限");
    };
    let mut sorted = peaks.to_vec();
    sorted.sort_by(f32::total_cmp);
    let percentile =
        sorted[((sorted.len() - 1) as f64 * NORMALIZE_QUANTILE) as usize].max(NORMALIZE_FLOOR);
    let mut bytes = Vec::with_capacity(HEADER_LEN + peaks.len());
    bytes.extend_from_slice(FORMAT.as_bytes());
    bytes.extend_from_slice(&BINS_PER_SECOND.to_le_bytes());
    bytes.extend_from_slice(&bin_count.to_le_bytes());
    bytes.extend(
        peaks
            .iter()
            .map(|peak| ((peak / percentile).clamp(0.0, 1.0) * 255.0).round() as u8),
    );
    Ok(bytes)
}

/// BCW1 字节 → header 视图。payload 长度与 `binCount` 必须一致。
pub fn parse(bytes: &[u8]) -> Result<Bcw1Info> {
    if bytes.len() < HEADER_LEN || &bytes[..4] != FORMAT.as_bytes() {
        bail!("波形不是 BCW1 格式");
    }
    let bins_per_second = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    let bin_count = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
    if bins_per_second == 0 {
        bail!("BCW1 binsPerSecond 必须大于 0");
    }
    if bin_count == 0 {
        bail!("BCW1 binCount 必须大于 0");
    }
    if usize::try_from(bin_count).ok() != Some(bytes.len() - HEADER_LEN) {
        bail!("BCW1 binCount 与 payload 长度不一致");
    }
    Ok(Bcw1Info {
        bins_per_second,
        bin_count,
    })
}

/// 已校验 BCW1 的 payload 切片（每个 bin 一字节）。
pub fn bins(bytes: &[u8]) -> Result<&[u8]> {
    parse(bytes)?;
    Ok(&bytes[HEADER_LEN..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_and_percentile_are_stable() {
        let bytes = encode(&[0.0, 0.25, 0.5, 1.0]).unwrap();
        assert_eq!(&bytes[..4], b"BCW1");
        assert_eq!(parse(&bytes).unwrap().bins_per_second, 50);
        assert_eq!(parse(&bytes).unwrap().bin_count, 4);
        // 与 Web 端原实现一致：索引 floor((n - 1) * 0.98)，此处 q = 0.5。
        assert_eq!(&bytes[12..], &[0, 128, 255, 255]);
        assert_eq!(bins(&bytes).unwrap(), &[0, 128, 255, 255]);
    }

    #[test]
    fn silence_does_not_divide_by_zero() {
        let bytes = encode(&[0.0, 0.0, 0.0]).unwrap();
        assert_eq!(&bytes[HEADER_LEN..], &[0, 0, 0]);
    }

    #[test]
    fn parse_rejects_truncated_and_mismatched_payloads() {
        assert!(encode(&[]).is_err());
        assert!(parse(b"BCW1").is_err());
        assert!(parse(b"NOPE\x32\0\0\0\x01\0\0\0\xff").is_err());
        let mut bytes = encode(&[0.5, 0.5]).unwrap();
        bytes.push(0);
        assert!(parse(&bytes).is_err());
        let mut zero_bins = encode(&[0.5]).unwrap();
        zero_bins[8..12].copy_from_slice(&0u32.to_le_bytes());
        assert!(parse(&zero_bins).is_err());
        let mut zero_rate = encode(&[0.5]).unwrap();
        zero_rate[4..8].copy_from_slice(&0u32.to_le_bytes());
        assert!(parse(&zero_rate).is_err());
    }
}
