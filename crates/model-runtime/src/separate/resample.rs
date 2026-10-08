//! 采样率转换（纯逻辑，全平台编译）。
//!
//! HTDemucs 只在 44.1 kHz 上工作；输入若是 48 kHz / 16 kHz 等先转到 44.1 kHz，分离后
//! 直接以 44.1 kHz 输出。实现是加 Hann 窗的 sinc 插值（每侧 `TAPS` 个抽头），
//! 降采样时截止频率取目标 Nyquist，足够配音场景使用；不是 libsamplerate 级别的精度。

const TAPS: usize = 32;

/// 把 `input` 从 `from` Hz 重采样到 `to` Hz。相同采样率原样返回。
pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() || from == 0 || to == 0 {
        return input.to_vec();
    }
    let ratio = f64::from(to) / f64::from(from);
    let out_len = ((input.len() as f64) * ratio).round().max(1.0) as usize;
    // 降采样时把 sinc 拉宽到目标 Nyquist 以抗混叠。
    let cutoff = ratio.min(1.0);
    let half_width = (TAPS as f64 / cutoff).ceil() as isize;
    let mut out = Vec::with_capacity(out_len);
    for n in 0..out_len {
        let center = n as f64 / ratio;
        let base = center.floor() as isize;
        let mut acc = 0.0f64;
        let mut norm = 0.0f64;
        for i in (base - half_width + 1)..=(base + half_width) {
            if i < 0 || i >= input.len() as isize {
                continue;
            }
            let d = center - i as f64;
            let w = hann_sinc(d * cutoff, half_width as f64);
            acc += f64::from(input[i as usize]) * w;
            norm += w;
        }
        out.push(if norm.abs() > 1e-12 { (acc / norm) as f32 } else { 0.0 });
    }
    out
}

fn hann_sinc(x: f64, half_width: f64) -> f64 {
    let sinc = if x.abs() < 1e-9 {
        1.0
    } else {
        let px = std::f64::consts::PI * x;
        px.sin() / px
    };
    // 归一化到 [-1, 1] 的位置，再套 Hann 窗。
    let t = x / half_width;
    if t.abs() >= 1.0 {
        return 0.0;
    }
    sinc * 0.5 * (1.0 + (std::f64::consts::PI * t).cos())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(len: usize, rate: u32, freq: f64) -> Vec<f32> {
        (0..len)
            .map(|i| (2.0 * std::f64::consts::PI * freq * i as f64 / f64::from(rate)).sin() as f32)
            .collect()
    }

    fn check_sine(from: u32, to: u32, freq: f64) {
        let input = sine(from as usize, from, freq); // 1 秒
        let out = resample(&input, from, to);
        assert!((out.len() as i64 - to as i64).abs() <= 1, "长度 {}", out.len());
        let expected = sine(out.len(), to, freq);
        // 忽略两端各 100 个样本的边缘效应。
        let err = out
            .iter()
            .zip(&expected)
            .skip(100)
            .take(out.len() - 200)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(err < 2e-3, "{from}->{to} @ {freq} Hz 误差 {err}");
    }

    #[test]
    fn same_rate_is_identity() {
        let x = vec![0.1, 0.2, 0.3];
        assert_eq!(resample(&x, 44_100, 44_100), x);
        assert!(resample(&[], 16_000, 44_100).is_empty());
    }

    #[test]
    fn upsample_preserves_sine() {
        check_sine(16_000, 44_100, 440.0);
        check_sine(16_000, 44_100, 3_000.0);
    }

    #[test]
    fn downsample_preserves_sine() {
        check_sine(48_000, 44_100, 1_000.0);
        check_sine(48_000, 44_100, 8_000.0);
    }

    #[test]
    fn downsample_attenuates_above_new_nyquist() {
        // 48k 下的 23 kHz 在 44.1k 里超过 Nyquist，应被明显压低而不是混叠回来。
        let input = sine(48_000, 48_000, 23_000.0);
        let out = resample(&input, 48_000, 44_100);
        let rms = (out.iter().skip(200).map(|v| v * v).sum::<f32>() / (out.len() - 200) as f32).sqrt();
        assert!(rms < 0.2, "rms {rms}");
    }
}
