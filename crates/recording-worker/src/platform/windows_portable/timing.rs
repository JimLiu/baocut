//! 时刻换算。各路流统一到 QPC（`QueryPerformanceCounter`）上，日志与协议里写纳秒：
//!
//! - QPC 的计数按 `QueryPerformanceFrequency` 换成纳秒，用 u128 乘除，不溢出（频率常是 10 MHz，开机几个月也不会溢出
//!   u64 的纳秒）。
//! - 系统接口给的「QPC 的 100 纳秒单位」（Windows.Graphics.Capture 的 `SystemRelativeTime`、WASAPI
//!   `IAudioCaptureClient::GetBuffer` 的 `pu64QPCPosition`）乘 100 就是同一个时钟上的纳秒。摄像头样本的时刻另算（见
//!   `windows::camera`）。
//! - Media Foundation 样本的时刻是文件里的 100 纳秒单位，从这一段这一路第一个样本起算。
//!
//! 声音：WASAPI 回环在没有声音播放时不出包，麦克风偶尔也会丢包（`AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY`）。按样本数
//! 连续写会让文件比实际短、与画面渐渐错开，所以 [`AudioTimeline`] 按包的 QPC 时刻对齐：落后超过容差就补静音，
//! 超前（与已写的重叠）就丢掉重叠的帧。

/// QPC 计数换成纳秒。
pub fn qpc_to_ns(ticks: i64, frequency: i64) -> u64 {
    if ticks <= 0 || frequency <= 0 {
        return 0;
    }
    let ns = (ticks as u128) * 1_000_000_000 / (frequency as u128);
    u64::try_from(ns).unwrap_or(u64::MAX)
}

/// QPC 上的 100 纳秒单位换成纳秒。
pub fn hns_to_ns(hns: i64) -> u64 {
    if hns <= 0 { 0 } else { (hns as u64).saturating_mul(100) }
}

/// 纳秒换成 100 纳秒单位（向下取整）。
pub fn ns_to_hns(ns: u64) -> i64 {
    i64::try_from(ns / 100).unwrap_or(i64::MAX)
}

/// 文件里的样本时刻：从这一路这一段的第一个样本 `first` 起的 100 纳秒单位，不为负。
pub fn file_time(at: u64, first: u64) -> i64 {
    ns_to_hns(at.saturating_sub(first))
}

/// 帧数换成纳秒。
pub fn frames_to_ns(frames: u64, rate: u32) -> u64 {
    if rate == 0 {
        return 0;
    }
    u64::try_from(u128::from(frames) * 1_000_000_000 / u128::from(rate)).unwrap_or(u64::MAX)
}

/// 纳秒换成帧数（四舍五入）。
pub fn ns_to_frames(ns: u64, rate: u32) -> u64 {
    u64::try_from((u128::from(ns) * u128::from(rate) + 500_000_000) / 1_000_000_000).unwrap_or(u64::MAX)
}

/// 一个包怎样放进连续的声音：先补 `pad` 帧静音，再跳过包开头的 `skip` 帧，余下照写。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placement {
    pub pad: u64,
    pub skip: u64,
}

/// 一路声音的时间线：第一个包的时刻是起点，此后按写下的帧数推算「下一帧应在何时」。
#[derive(Debug, Clone)]
pub struct AudioTimeline {
    rate: u32,
    tolerance_ns: u64,
    origin: Option<u64>,
    written: u64,
}

/// 包的时刻与推算的时刻差在这个范围内就照写（WASAPI 的 QPC 位置有一两毫秒的抖动）。
pub const AUDIO_TOLERANCE_NS: u64 = 15_000_000;

impl AudioTimeline {
    pub fn new(rate: u32) -> Self {
        Self { rate, tolerance_ns: AUDIO_TOLERANCE_NS, origin: None, written: 0 }
    }

    /// 下一帧应在的时刻。
    pub fn next_ns(&self) -> Option<u64> {
        self.origin.map(|origin| origin + frames_to_ns(self.written, self.rate))
    }

    /// 已经写下的帧数（含补的静音）。
    pub fn written(&self) -> u64 {
        self.written
    }

    /// 一个 `frames` 帧、第一帧在 `at` 的包。
    pub fn place(&mut self, at: u64, frames: u64) -> Placement {
        let Some(next) = self.next_ns() else {
            self.origin = Some(at);
            self.written = frames;
            return Placement { pad: 0, skip: 0 };
        };
        let placement = if at > next + self.tolerance_ns {
            Placement { pad: ns_to_frames(at - next, self.rate), skip: 0 }
        } else if at + self.tolerance_ns < next {
            Placement { pad: 0, skip: ns_to_frames(next - at, self.rate).min(frames) }
        } else {
            Placement { pad: 0, skip: 0 }
        };
        self.written += placement.pad + (frames - placement.skip);
        placement
    }

    /// 没有包来的时候（回环在静音时）补静音到 `until`：返回要补的帧数。还没有起点时什么都不补。
    pub fn fill_until(&mut self, until: u64) -> u64 {
        let Some(next) = self.next_ns() else { return 0 };
        if until <= next + self.tolerance_ns {
            return 0;
        }
        let pad = ns_to_frames(until - next, self.rate);
        self.written += pad;
        pad
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qpc_converts_without_overflow() {
        assert_eq!(qpc_to_ns(10_000_000, 10_000_000), 1_000_000_000);
        assert_eq!(qpc_to_ns(3, 3_000_000), 1_000);
        // 10 MHz 下开机一年：u64 的中间乘积会溢出，u128 不会。
        let year = 10_000_000i64 * 86_400 * 365;
        assert_eq!(qpc_to_ns(year, 10_000_000), 86_400 * 365 * 1_000_000_000);
        assert_eq!(qpc_to_ns(-5, 10_000_000), 0);
        assert_eq!(qpc_to_ns(5, 0), 0);
    }

    #[test]
    fn hundred_nanosecond_units() {
        assert_eq!(hns_to_ns(12_345), 1_234_500);
        assert_eq!(hns_to_ns(-1), 0);
        assert_eq!(ns_to_hns(1_234_599), 12_345);
        assert_eq!(file_time(2_000_000_000, 1_000_000_000), 10_000_000);
        assert_eq!(file_time(1, 1_000), 0);
    }

    #[test]
    fn frames_round_trip() {
        assert_eq!(frames_to_ns(48_000, 48_000), 1_000_000_000);
        assert_eq!(ns_to_frames(1_000_000_000, 48_000), 48_000);
        assert_eq!(ns_to_frames(10_000_000, 48_000), 480);
        assert_eq!(frames_to_ns(441, 44_100), 10_000_000);
    }

    #[test]
    fn audio_timeline_pads_gaps_and_trims_overlaps() {
        let mut line = AudioTimeline::new(48_000);
        // 第一个包定起点。
        assert_eq!(line.place(1_000_000_000, 480), Placement { pad: 0, skip: 0 });
        // 紧接着的包（10 ms 后）照写；1 ms 的抖动不补不丢。
        assert_eq!(line.place(1_011_000_000, 480), Placement { pad: 0, skip: 0 });
        assert_eq!(line.next_ns(), Some(1_020_000_000));
        // 回环静音了 500 ms：补 500 ms 的静音再写。
        assert_eq!(line.place(1_520_000_000, 480), Placement { pad: 24_000, skip: 0 });
        assert_eq!(line.next_ns(), Some(1_530_000_000));
        // 时刻往回跳了 20 ms（与已写的重叠）：丢掉重叠的帧。
        assert_eq!(line.place(1_510_000_000, 1_440), Placement { pad: 0, skip: 960 });
        assert_eq!(line.next_ns(), Some(1_540_000_000));
        // 整个包都在已写的范围里：全丢。
        assert_eq!(line.place(1_400_000_000, 480), Placement { pad: 0, skip: 480 });
        assert_eq!(line.next_ns(), Some(1_540_000_000));
    }

    #[test]
    fn audio_timeline_fills_silence_up_to_now() {
        let mut line = AudioTimeline::new(48_000);
        assert_eq!(line.fill_until(5_000_000_000), 0, "no origin yet");
        line.place(1_000_000_000, 480);
        assert_eq!(line.fill_until(1_015_000_000), 0, "inside the tolerance");
        assert_eq!(line.fill_until(1_210_000_000), 9_600);
        assert_eq!(line.next_ns(), Some(1_210_000_000));
        // 补过之后包又来了，时刻在补的范围里：重叠部分丢掉，不把时间线往后推。
        assert_eq!(line.place(1_190_000_000, 1_440), Placement { pad: 0, skip: 960 });
        assert_eq!(line.written(), 480 + 9_600 + 480);
    }
}
