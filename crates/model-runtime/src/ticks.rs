//! 秒与 tick 的换算。Worker 内部一律用 f64 秒计算，只在写出结果的边界换算一次（架构设计 §6.6）。

/// 秒 → 整数 tick（四舍五入；负数按 0）。单调：`a <= b` 时结果也 `<=`。
pub fn seconds_to_ticks(seconds: f64, timescale: u64) -> u64 {
    if !seconds.is_finite() || seconds <= 0.0 {
        return 0;
    }
    (seconds * timescale as f64).round() as u64
}

/// tick → 秒。
pub fn ticks_to_seconds(ticks: u64, timescale: u64) -> f64 {
    if timescale == 0 {
        return 0.0;
    }
    ticks as f64 / timescale as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_and_rounds_at_the_boundary() {
        assert_eq!(seconds_to_ticks(1.5, 1_000_000), 1_500_000);
        assert_eq!(seconds_to_ticks(0.000_000_4, 1_000_000), 0);
        assert_eq!(seconds_to_ticks(0.000_000_6, 1_000_000), 1);
        assert_eq!(seconds_to_ticks(-3.0, 1_000_000), 0);
        assert_eq!(seconds_to_ticks(f64::NAN, 48_000), 0);
        assert_eq!(seconds_to_ticks(2.0, 48_000), 96_000);
        assert_eq!(seconds_to_ticks(1.0 / 3.0, 90_000), 30_000);
        // 素材时间一小时以上也不丢精度。
        assert_eq!(seconds_to_ticks(3_725.123_456, 1_000_000), 3_725_123_456);
    }

    #[test]
    fn round_trips_range_ticks() {
        for (ticks, timescale) in [(12_345_678_u64, 1_000_000_u64), (90_000, 90_000), (7, 1), (1_001, 30_000)] {
            assert_eq!(seconds_to_ticks(ticks_to_seconds(ticks, timescale), timescale), ticks);
        }
        assert_eq!(ticks_to_seconds(5, 0), 0.0);
    }

    #[test]
    fn rounding_is_monotone() {
        let mut previous = 0;
        for step in 0..10_000 {
            let ticks = seconds_to_ticks(step as f64 * 0.000_123_7, 1_000);
            assert!(ticks >= previous);
            previous = ticks;
        }
    }
}
