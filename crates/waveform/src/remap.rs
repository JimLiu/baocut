//! 元素级参数的纯函数重映射：canonical dB 窗 → 元素 dB 窗、指数平滑与 gain。
//!
//! 这些参数**不进缓存**。一个项目可以有多个 visualizer 各带不同的
//! `minDb` / `maxDb` / `smoothing` / `gain`，参数进缓存就要缓存多份 STFT；
//! canonical 窗 + 本模块让一份 BCS1 服务任意参数组合。
//!
//! 平滑天然是递推的（`m̂[n] = τ·m̂[n-1] + (1-τ)·m[n]`，`m̂[-1] = 0`），而且
//! Web Audio 在**线性幅度域**推进，之后才转 dB。因此它属于 host preflight 的
//! 一次性整轨计算，不能塞进 `sample(t)`——后者会引入状态并破坏乱序采样一致性。

use crate::bcs1::{CANONICAL_MAX_DB, CANONICAL_MIN_DB};

/// canonical 字节 → dB：`-120 + byte * 160 / 255`。
pub fn canonical_db(byte: u8) -> f64 {
    let span = CANONICAL_MAX_DB - CANONICAL_MIN_DB;
    CANONICAL_MIN_DB + f64::from(byte) * span / 255.0
}

/// canonical 字节 → 线性幅度。BCS1 只量化未平滑的 dB，派生阶段先恢复幅度，
/// 才能复刻 `AnalyserNode.smoothingTimeConstant` 的递推域。
pub fn canonical_magnitude(byte: u8) -> f64 {
    10.0f64.powf(canonical_db(byte) / 20.0)
}

/// canonical 字节 → 元素 dB 窗字节（§6.2 逐字公式）。
pub fn remap(byte: u8, min_db: f64, max_db: f64) -> u8 {
    remap_value(byte, min_db, max_db).round() as u8
}

/// 同 [`remap`]，但保留未取整的 0..255 实数值。
///
/// 平滑要在**取整前**递推：先四舍五入再平滑会把 1/255 的量化误差一路累积进
/// 递推状态。取整只发生在最后一步。
pub fn remap_value(byte: u8, min_db: f64, max_db: f64) -> f64 {
    remap_decibels_value(canonical_db(byte), min_db, max_db)
}

/// 已经得到的 dB → 元素窗下未取整的 0..255 值。
fn remap_decibels_value(decibels: f64, min_db: f64, max_db: f64) -> f64 {
    let span = max_db - min_db;
    if !(span > 0.0) {
        // 退化窗（上下沿相等或倒置）没有线性映射可言：按阈值给两端值，
        // 保持对 dB 单调不减，绝不产生 NaN。
        return if decibels >= max_db.max(min_db) {
            255.0
        } else {
            0.0
        };
    }
    (255.0 * (decibels - min_db) / span).clamp(0.0, 255.0)
}

/// 线性幅度域的指数时间平滑（Web Audio `smoothingTimeConstant` 的离线等价）。
pub fn smooth(previous: f64, current: f64, tau: f64) -> f64 {
    tau * previous + (1.0 - tau) * current
}

/// 一条频域行的顺序推进器：canonical dB → 线性幅度 → 平滑 → dB 重映射 → gain。
///
/// `gain` 是 BaoCut 自有字段，来自 Mac 的 `WaveformConfig`，
/// **在重映射后、绘制前**乘上。每个 bin 各有独立的平滑状态，因此推进器持有
/// 一整行的 `previous`。
#[derive(Debug, Clone)]
pub struct Remapper {
    min_db: f64,
    max_db: f64,
    tau: f64,
    gain: f64,
    previous: Vec<f64>,
}

impl Remapper {
    /// `bins` 是每帧的行宽；`tau` 钳制到 0..1，`gain` 非有限或负数按 1.0 处理。
    pub fn new(bins: usize, min_db: f64, max_db: f64, smoothing: f64, gain: f64) -> Self {
        Self {
            min_db,
            max_db,
            tau: if smoothing.is_finite() {
                smoothing.clamp(0.0, 1.0)
            } else {
                0.0
            },
            gain: if gain.is_finite() && gain >= 0.0 {
                gain
            } else {
                1.0
            },
            previous: vec![0.0; bins],
        }
    }

    pub fn tau(&self) -> f64 {
        self.tau
    }

    pub fn gain(&self) -> f64 {
        self.gain
    }

    /// 重置递推状态到 `m̂[-1] = 0`，用于重新从帧 0 推进。
    pub fn reset(&mut self) {
        self.previous.fill(0.0);
    }

    /// 推进一帧：`row` 是 canonical 字节行，输出写进 `out`（长度必须相同）。
    ///
    /// # Panics
    /// `row` 或 `out` 的长度与构造时的 `bins` 不一致时 panic——这是调用方的
    /// 编程错误，不是数据错误。
    pub fn push_row(&mut self, row: &[u8], out: &mut [u8]) {
        assert_eq!(row.len(), self.previous.len(), "canonical 行宽不匹配");
        assert_eq!(out.len(), self.previous.len(), "输出行宽不匹配");
        for (bin, &byte) in row.iter().enumerate() {
            let magnitude = canonical_magnitude(byte);
            let smoothed = smooth(self.previous[bin], magnitude, self.tau);
            self.previous[bin] = smoothed;
            let decibels = if smoothed > 0.0 {
                20.0 * smoothed.log10()
            } else {
                f64::NEG_INFINITY
            };
            let mapped = remap_decibels_value(decibels, self.min_db, self.max_db);
            out[bin] = (mapped * self.gain).clamp(0.0, 255.0).round() as u8;
        }
    }

    /// [`Remapper::push_row`] 的分配版本。
    pub fn map_row(&mut self, row: &[u8]) -> Vec<u8> {
        let mut out = vec![0u8; row.len()];
        self.push_row(row, &mut out);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_bytes_map_back_to_the_frozen_window() {
        assert_eq!(canonical_db(0), -120.0);
        assert_eq!(canonical_db(255), 40.0);
        assert!((canonical_db(128) - (-120.0 + 128.0 * 160.0 / 255.0)).abs() < 1e-12);
        assert!((canonical_magnitude(255) - 100.0).abs() < 1e-10);
        assert!((canonical_magnitude(0) - 1e-6).abs() < 1e-18);
    }

    #[test]
    fn remap_hits_the_element_window_endpoints() {
        // 元素窗与 canonical 窗相同 → 恒等映射。
        for byte in [0u8, 1, 64, 128, 200, 255] {
            assert_eq!(remap(byte, -120.0, 40.0), byte);
        }
        // -80/+40 是新建默认：canonical byte 63.75 正好是 -80 dB，窗口下沿之下全 0。
        assert_eq!(remap(0, -80.0, 40.0), 0);
        assert_eq!(remap(63, -80.0, 40.0), 0);
        assert_eq!(remap(64, -80.0, 40.0), 0);
        assert_eq!(remap(255, -80.0, 40.0), 255);
        // canonical byte 128 ≈ -39.69 dB，在 -80/+40 窗里落到 86。
        assert_eq!(remap(128, -80.0, 40.0), 86);
        // -120/-10 是 bicubic 全 bin 类样式的覆写窗。
        assert_eq!(remap(0, -120.0, -10.0), 0);
        assert_eq!(remap(255, -120.0, -10.0), 255);
        assert_eq!(remap(200, -120.0, -10.0), 255);
    }

    #[test]
    fn remap_is_monotonic_and_clamped_for_every_window() {
        for (min_db, max_db) in [
            (-120.0, 40.0),
            (-80.0, 40.0),
            (-120.0, -10.0),
            (-30.0, -20.0),
            (-1000.0, 1000.0),
        ] {
            let mut previous = 0u8;
            for byte in 0..=255u8 {
                let value = remap(byte, min_db, max_db);
                assert!(value >= previous, "({min_db},{max_db}) 在 {byte} 处不单调");
                previous = value;
            }
        }
    }

    #[test]
    fn degenerate_windows_never_produce_nan() {
        assert_eq!(remap(0, -40.0, -40.0), 0);
        assert_eq!(remap(255, -40.0, -40.0), 255);
        // 倒置窗按阈值处理，仍然单调不减。
        let mut previous = 0u8;
        for byte in 0..=255u8 {
            let value = remap(byte, 40.0, -120.0);
            assert!(value >= previous);
            previous = value;
        }
    }

    #[test]
    fn smoothing_degenerates_at_tau_zero_and_one() {
        assert_eq!(smooth(10.0, 200.0, 0.0), 200.0);
        assert_eq!(smooth(10.0, 200.0, 1.0), 10.0);
        assert_eq!(smooth(0.0, 200.0, 0.5), 100.0);

        // τ = 0：透传重映射结果。
        let mut passthrough = Remapper::new(1, -120.0, 40.0, 0.0, 1.0);
        assert_eq!(passthrough.map_row(&[200]), vec![200]);
        assert_eq!(passthrough.map_row(&[10]), vec![10]);

        // τ = 1：y[-1] = 0 意味着永远停在 0。
        let mut frozen = Remapper::new(1, -120.0, 40.0, 1.0, 1.0);
        assert_eq!(frozen.map_row(&[255]), vec![0]);
        assert_eq!(frozen.map_row(&[255]), vec![0]);
    }

    #[test]
    fn the_recursion_starts_at_zero_and_advances_frame_by_frame() {
        let mut remapper = Remapper::new(1, -120.0, 40.0, 0.5, 1.0);
        let magnitude = canonical_magnitude(200);
        let expected =
            |linear: f64| remap_decibels_value(20.0 * linear.log10(), -120.0, 40.0).round() as u8;
        // 在线性幅度域：m0 = 0.5x，m1 = 0.75x，m2 = 0.875x。
        assert_eq!(remapper.map_row(&[200]), vec![expected(0.5 * magnitude)]);
        assert_eq!(remapper.map_row(&[200]), vec![expected(0.75 * magnitude)]);
        assert_eq!(remapper.map_row(&[200]), vec![expected(0.875 * magnitude)]);
        assert_ne!(expected(0.5 * magnitude), 100, "不能退回字节域平滑");
        remapper.reset();
        assert_eq!(remapper.map_row(&[200]), vec![expected(0.5 * magnitude)]);
    }

    #[test]
    fn gain_multiplies_after_the_remap_and_clamps() {
        let mut doubled = Remapper::new(2, -120.0, 40.0, 0.0, 2.0);
        assert_eq!(doubled.map_row(&[50, 200]), vec![100, 255]);
        let mut halved = Remapper::new(1, -120.0, 40.0, 0.0, 0.5);
        assert_eq!(halved.map_row(&[100]), vec![50]);
        // gain 不进递推状态：下一帧仍从未放大的 y 推进。
        let mut smoothed = Remapper::new(1, -120.0, 40.0, 0.5, 2.0);
        let magnitude = canonical_magnitude(100);
        let mapped = |linear: f64| remap_decibels_value(20.0 * linear.log10(), -120.0, 40.0);
        assert_eq!(
            smoothed.map_row(&[100]),
            vec![(mapped(0.5 * magnitude) * 2.0).round() as u8]
        );
        assert_eq!(
            smoothed.map_row(&[100]),
            vec![(mapped(0.75 * magnitude) * 2.0).round() as u8]
        );
        // 非法参数回落到安全缺省。
        let fallback = Remapper::new(1, -120.0, 40.0, f64::NAN, -3.0);
        assert_eq!(fallback.tau(), 0.0);
        assert_eq!(fallback.gain(), 1.0);
        assert_eq!(Remapper::new(1, -120.0, 40.0, 5.0, 1.0).tau(), 1.0);
    }

    #[test]
    #[should_panic(expected = "canonical 行宽不匹配")]
    fn row_width_mismatch_is_a_programming_error() {
        Remapper::new(4, -120.0, 40.0, 0.0, 1.0).map_row(&[1, 2, 3]);
    }
}
