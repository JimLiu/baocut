//! 标量小工具：dB ↔ 线性、MIDI → Hz、smoothstep、秒 → 采样数。全部走 `libm`。

/// π 的两倍。
pub const TAU: f64 = core::f64::consts::TAU;

/// dB → 线性幅度增益（`10^(db/20)`）。
pub fn db_to_gain(db: f64) -> f64 {
    libm::exp(db * (core::f64::consts::LN_10 / 20.0))
}

/// 线性幅度 → dB（`20·log10`）。`0` 与负数给 `-inf`。
pub fn gain_to_db(gain: f64) -> f64 {
    if gain > 0.0 {
        20.0 * libm::log10(gain)
    } else {
        f64::NEG_INFINITY
    }
}

/// MIDI 音符号 → 频率（A4 = 69 = 440 Hz），允许小数（弯音）。
pub fn mtof(midi: f64) -> f64 {
    440.0 * libm::exp2((midi - 69.0) / 12.0)
}

/// 秒 → 采样数（四舍五入，负数夹到 0）。
pub fn samples(seconds: f64, sr: f64) -> usize {
    let n = libm::round(seconds * sr);
    if n > 0.0 { n as usize } else { 0 }
}

/// 三次 smoothstep：`x ≤ a` 为 0，`x ≥ b` 为 1，中间 `u²(3−2u)`。`a == b` 时是阶跃。
pub fn smoothstep(a: f64, b: f64, x: f64) -> f64 {
    if b <= a {
        return if x < a { 0.0 } else { 1.0 };
    }
    let u = ((x - a) / (b - a)).clamp(0.0, 1.0);
    u * u * (3.0 - 2.0 * u)
}

/// 线性插值。
pub fn lerp(a: f64, b: f64, u: f64) -> f64 {
    a + (b - a) * u
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_round_trip_and_reference_points() {
        assert!((db_to_gain(-6.0206) - 0.5).abs() < 1e-4);
        assert!((gain_to_db(db_to_gain(-13.7)) + 13.7).abs() < 1e-12);
        assert_eq!(gain_to_db(0.0), f64::NEG_INFINITY);
    }

    #[test]
    fn mtof_reference_points() {
        assert!((mtof(69.0) - 440.0).abs() < 1e-9);
        assert!((mtof(60.0) - 261.625_565_300_6).abs() < 1e-6);
        assert!((mtof(81.0) - 880.0).abs() < 1e-9);
    }

    #[test]
    fn smoothstep_ends_and_midpoint() {
        assert_eq!(smoothstep(0.0, 1.0, -1.0), 0.0);
        assert_eq!(smoothstep(0.0, 1.0, 2.0), 1.0);
        assert!((smoothstep(0.0, 1.0, 0.5) - 0.5).abs() < 1e-12);
        assert_eq!(smoothstep(1.0, 1.0, 0.5), 0.0);
        assert_eq!(smoothstep(1.0, 1.0, 1.0), 1.0);
    }
}
