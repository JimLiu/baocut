//! 参考音频重采样（窗口 sinc）。参考实现用 AVAudioConverter，这里用纯 Rust
//! 的带限插值，全平台编译；只用于克隆参考音频（几秒到几十秒），不追求
//! 实时性能。

/// 把 `samples` 从 `from_rate` 重采样到 `to_rate`（单声道）。
pub fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || samples.is_empty() || from_rate == 0 || to_rate == 0 {
        return samples.to_vec();
    }
    let from = from_rate as f64;
    let to = to_rate as f64;
    // 截止频率取两者中较低采样率的奈奎斯特（再留 2% 余量）。
    let cutoff = 0.98 * from.min(to) / 2.0;
    // 半宽 32 个「较低采样率」周期的 sinc，Hann 窗。
    let half_width_secs = 32.0 / from.min(to);
    let half_width_in = (half_width_secs * from).ceil() as isize;
    let out_len = ((samples.len() as f64) * to / from).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    let scale = 2.0 * cutoff / from;
    for n in 0..out_len {
        let t = n as f64 / to; // 输出样本时刻（秒）
        let center = t * from; // 对应输入样本坐标
        let k0 = (center.floor() as isize - half_width_in).max(0);
        let k1 = (center.floor() as isize + half_width_in + 1).min(samples.len() as isize);
        let mut acc = 0.0f64;
        for k in k0..k1 {
            let dt = (k as f64 - center) / from; // 秒
            let x = 2.0 * cutoff * dt;
            let sinc = if x.abs() < 1e-12 {
                1.0
            } else {
                (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x)
            };
            let w = 0.5 * (1.0 + (std::f64::consts::PI * dt / half_width_secs).cos());
            acc += samples[k as usize] as f64 * sinc * w;
        }
        out.push((acc * scale) as f32);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_when_rates_match() {
        let x = vec![0.1f32, 0.2, 0.3];
        assert_eq!(resample(&x, 24_000, 24_000), x);
    }

    #[test]
    fn preserves_low_frequency_sine() {
        let from = 16_000u32;
        let to = 24_000u32;
        let n = from as usize; // 1 秒
        let freq = 440.0f64;
        let x: Vec<f32> = (0..n)
            .map(|i| (2.0 * std::f64::consts::PI * freq * i as f64 / from as f64).sin() as f32)
            .collect();
        let y = resample(&x, from, to);
        assert_eq!(y.len(), to as usize);
        // 跳过边缘，比较中段与理想正弦
        let mut max_err = 0.0f32;
        for i in 2000..(to as usize - 2000) {
            let expect = (2.0 * std::f64::consts::PI * freq * i as f64 / to as f64).sin() as f32;
            max_err = max_err.max((y[i] - expect).abs());
        }
        assert!(max_err < 0.02, "max_err {max_err}");
    }

    #[test]
    fn decimates_48k_to_24k() {
        let x: Vec<f32> = (0..4800).map(|i| (i as f32 * 0.01).sin()).collect();
        let y = resample(&x, 48_000, 24_000);
        assert_eq!(y.len(), 2400);
        assert!((y[1200] - x[2400]).abs() < 0.02);
    }
}
