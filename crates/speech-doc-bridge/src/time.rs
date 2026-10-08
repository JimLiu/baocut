//! 十进制浮点秒与整数刻度之间的换算（视频格式规范 §2.10）。
//!
//! - 刻度 → 秒：`ticks / timescale` 按 IEEE 754 除法取最近的 f64。两个数都不超过 2^53 − 1 时都能精确表示，
//!   结果是真实商的正确舍入。
//! - 秒 → 刻度：先取这个 f64 的最短十进制写法（能读回同一个 f64 的最少位数），把这个十进制数精确乘以
//!   `timescale`，再取整到最近的整数刻度，正好一半时远离零。这与旧项目导入器换算微秒的规则相同
//!   （`scripts/legacy-import/exact-time.ts` 的 `micros`），也就是同一份旧数据经两条路得到同一个刻度。
//!   它与 §2.13 的 pts 取整（正好一半时取偶数）、编辑吸附的取整是不同的规则，只用在这里。

use editor_semantics::{MAX_SAFE_INTEGER, MediaTime};

use crate::BridgeError;

/// 没有底稿时新写的正文用的时间基：微秒，与旧项目导入相同。
pub const FRESH_TIMESCALE: i64 = 1_000_000;

/// 一次秒 → 刻度换算的结果。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rounded {
    pub ticks: i64,
    /// 十进制值乘以时间基正好是整数，没有发生取整。
    pub exact: bool,
}

pub fn check_timescale(timescale: i64) -> Result<(), BridgeError> {
    if timescale <= 0 || timescale as i128 > MAX_SAFE_INTEGER {
        return Err(BridgeError::new(format!("timescale {timescale} 必须是正的安全整数")));
    }
    Ok(())
}

/// 刻度 → 秒。
pub fn ticks_to_seconds(ticks: i64, timescale: i64) -> Result<f64, BridgeError> {
    check_timescale(timescale)?;
    if (ticks as i128).abs() > MAX_SAFE_INTEGER {
        return Err(BridgeError::new(format!("刻度 {ticks} 超出安全整数")));
    }
    Ok(ticks as f64 / timescale as f64)
}

/// `MediaTime` → 秒，规则同 [`ticks_to_seconds`]。
pub fn media_time_seconds(value: &MediaTime) -> Result<f64, BridgeError> {
    let ticks: i64 = value
        .ticks
        .parse()
        .map_err(|_| BridgeError::new(format!("MediaTime 的 ticks 不是整数：{}", value.ticks)))?;
    ticks_to_seconds(ticks, value.timescale)
}

/// 秒 → 刻度，规则见模块文档。
pub fn seconds_to_ticks(seconds: f64, timescale: i64) -> Result<Rounded, BridgeError> {
    check_timescale(timescale)?;
    if !seconds.is_finite() {
        return Err(BridgeError::new(format!("时间 {seconds} 不是有限数")));
    }
    // 结果必须是安全整数；先粗筛，免得下面的十进制串过长。
    if seconds.abs() > (MAX_SAFE_INTEGER as f64) / timescale as f64 + 1.0 {
        return Err(BridgeError::new(format!("时间 {seconds} 秒换成刻度超出安全整数")));
    }
    // Rust 的 `Display` 给出最短的往返十进制写法，且从不用指数形式。
    let text = format!("{}", seconds.abs());
    let (whole, fraction) = text.split_once('.').unwrap_or((&text, ""));
    let digits: u128 = format!("{whole}{fraction}")
        .parse()
        .map_err(|_| BridgeError::new(format!("时间 {seconds} 的十进制写法读不出来")))?;
    // 十进制值 = digits / 10^k。|seconds| < 2^53 / timescale + 1，有效数字不超过 17 位，
    // digits · timescale < 10^17 · 2^53 ≈ 9·10^32，在 u128 之内。
    let k = fraction.len() as u32;
    let scaled = digits * timescale as u128;
    let (quotient, exact) = if k == 0 {
        (scaled, true)
    } else if k >= 38 {
        // 10^k 超出 u128；这时 scaled / 10^k < 10^33 / 10^38，取整为 0。
        (0, scaled == 0)
    } else {
        let unit = 10u128.pow(k);
        let (q, r) = (scaled / unit, scaled % unit);
        (if r * 2 >= unit { q + 1 } else { q }, r == 0)
    };
    if quotient > MAX_SAFE_INTEGER as u128 {
        return Err(BridgeError::new(format!("时间 {seconds} 秒换成刻度超出安全整数")));
    }
    let magnitude = quotient as i64;
    Ok(Rounded {
        ticks: if seconds < 0.0 { -magnitude } else { magnitude },
        exact,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 旧项目导入器 `micros()` 的逐字复刻（不含指数写法的分支）：最短十进制写法截到第 7 位小数，第 7 位 ≥ 5 进一。
    fn legacy_micros(seconds: f64) -> i64 {
        let text = format!("{}", seconds.abs());
        let (whole, fraction) = text.split_once('.').unwrap_or((&text, ""));
        let digits: String = format!("{fraction}0000000").chars().take(7).collect();
        let mut value = whole.parse::<i64>().unwrap() * 1_000_000 + digits[..6].parse::<i64>().unwrap();
        if digits.as_bytes()[6] >= b'5' {
            value += 1;
        }
        if seconds < 0.0 { -value } else { value }
    }

    #[test]
    fn matches_the_legacy_importer_on_microseconds() {
        for seconds in [
            0.0,
            0.04,
            0.73,
            1.27,
            175.496,
            390.815,
            1.2345675,
            1.2345674999,
            2.0000005,
            3.9999995,
            0.1 + 0.2,
            1e-6,
            5e-6,
            12345.678901,
            -0.0000015,
            86399.999999,
        ] {
            assert_eq!(
                seconds_to_ticks(seconds, FRESH_TIMESCALE).unwrap().ticks,
                legacy_micros(seconds),
                "{seconds}"
            );
        }
    }

    #[test]
    fn ties_round_away_from_zero_and_report_exactness() {
        assert_eq!(
            seconds_to_ticks(1.2345675, 1_000_000).unwrap(),
            Rounded {
                ticks: 1_234_568,
                exact: false
            }
        );
        assert_eq!(
            seconds_to_ticks(-1.2345675, 1_000_000).unwrap(),
            Rounded {
                ticks: -1_234_568,
                exact: false
            }
        );
        assert_eq!(seconds_to_ticks(0.25, 2).unwrap(), Rounded { ticks: 1, exact: false });
        assert_eq!(
            seconds_to_ticks(0.73, 1_000_000).unwrap(),
            Rounded {
                ticks: 730_000,
                exact: true
            }
        );
        // 0.1 + 0.2 的最短写法是 0.30000000000000004：按十进制精确乘，不是 0.3。
        assert_eq!(
            seconds_to_ticks(0.1 + 0.2, 1_000_000).unwrap(),
            Rounded {
                ticks: 300_000,
                exact: false
            }
        );
        assert_eq!(seconds_to_ticks(5e-324, 1_000_000).unwrap(), Rounded { ticks: 0, exact: false });
    }

    #[test]
    fn rejects_values_outside_the_contract() {
        assert!(seconds_to_ticks(f64::NAN, 1000).is_err());
        assert!(seconds_to_ticks(f64::INFINITY, 1000).is_err());
        assert!(seconds_to_ticks(1e10, 1_000_000).is_err());
        assert!(seconds_to_ticks(1.0, 0).is_err());
        assert!(ticks_to_seconds(1 << 53, 1).is_err());
    }

    /// 刻度 → 秒 → 刻度对任意时间基都回到原值：|ticks| < 2^51 时，相邻两个刻度的间隔大于 f64 在这个量级的
    /// 舍入误差，最短十进制写法读回的值离原刻度不到半个刻度。
    #[test]
    fn ticks_survive_the_round_trip_for_any_timescale() {
        let mut state = 0x9e37_79b9_7f4a_7c15_u64;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        for timescale in [1, 1000, 30_000, 48_000, 90_000, 1_000_000, 1_000_000_007, (1 << 53) - 1] {
            for _ in 0..20_000 {
                let ticks = (next() % (1 << 51)) as i64;
                let seconds = ticks_to_seconds(ticks, timescale).unwrap();
                let back = seconds_to_ticks(seconds, timescale).unwrap().ticks;
                assert_eq!(back, ticks, "{ticks}/{timescale}");
            }
        }
    }
}
