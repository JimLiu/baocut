//! 整段重采样：Blackman 窗 sinc 插值，多相核表（[`PHASES`] 个相位）取最近相位。
//!
//! 给「读进来的素材采样率与工程不一致」这类离线场景用（例如总谱加载 22.05 kHz 的旁白 WAV）：
//! 整段在内存里，一次出结果；超越函数只走 `libm`，跨平台逐位一致。降采样时截止与抽头数
//! 按比例缩放，保持阻带衰减。输出第 `n` 个样本对应源时间 `n / to` 秒（零相位），两端越界按零。
//!
//! `bcut-render` 的流式解码器另有一份按块推进的实现（走 std 浮点，已有 golden 绑定它的末位），
//! 两者口径相同、实现各自独立，互不替换。

use crate::stereo::Stereo;

/// 基准单侧抽头数（升采样；降采样按比例放大）。
const BASE_HALF: usize = 24;
/// 截止频率相对新奈奎斯特的比例（留一点过渡带）。
const ROLLOFF: f64 = 0.94;
/// 核表相位数。
pub const PHASES: usize = 256;

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-12 {
        1.0
    } else {
        let p = core::f64::consts::PI * x;
        libm::sin(p) / p
    }
}

fn blackman(x: f64) -> f64 {
    // x ∈ [-1, 1]，两端为 0。
    if x.abs() >= 1.0 {
        return 0.0;
    }
    let u = core::f64::consts::PI * (x + 1.0);
    0.42 - 0.5 * libm::cos(u) + 0.08 * libm::cos(2.0 * u)
}

struct Kernel {
    half: usize,
    step: f64,
    taps: Vec<f64>,
}

impl Kernel {
    fn new(from: f64, to: f64) -> Self {
        let step = from / to;
        let scale = step.max(1.0);
        let half = libm::ceil(BASE_HALF as f64 * scale) as usize;
        let cutoff = ROLLOFF * 0.5 / scale;
        let len = 2 * half + 1;
        let mut taps = vec![0.0f64; PHASES * len];
        for p in 0..PHASES {
            let frac = p as f64 / PHASES as f64;
            let row = &mut taps[p * len..(p + 1) * len];
            let mut sum = 0.0;
            for (k, t) in row.iter_mut().enumerate() {
                let d = k as f64 - half as f64 - frac;
                *t = 2.0 * cutoff * sinc(2.0 * cutoff * d) * blackman(d / (half as f64 + 1.0));
                sum += *t;
            }
            for t in row.iter_mut() {
                *t /= sum;
            }
        }
        Self { half, step, taps }
    }

    fn run(&self, x: &[f32], out_len: usize) -> Vec<f32> {
        let len = 2 * self.half + 1;
        (0..out_len)
            .map(|n| {
                let c = n as f64 * self.step;
                let fl = libm::floor(c);
                let phase = (((c - fl) * PHASES as f64) as usize).min(PHASES - 1);
                let row = &self.taps[phase * len..(phase + 1) * len];
                let first = fl as i64 - self.half as i64;
                let mut acc = 0.0f64;
                for (k, w) in row.iter().enumerate() {
                    let i = first + k as i64;
                    if i >= 0 && (i as usize) < x.len() {
                        acc += x[i as usize] as f64 * w;
                    }
                }
                acc as f32
            })
            .collect()
    }
}

/// 输出长度：`round(len · to / from)`。
pub fn output_len(len: usize, from: f64, to: f64) -> usize {
    let n = libm::round(len as f64 * to / from);
    if n > 0.0 { n as usize } else { 0 }
}

/// 单声道 `from` Hz → `to` Hz。两者相同（差 < 0.5 Hz）时原样拷贝。
pub fn resample(x: &[f32], from: f64, to: f64) -> Vec<f32> {
    if (from - to).abs() < 0.5 || x.is_empty() {
        return x.to_vec();
    }
    Kernel::new(from, to).run(x, output_len(x.len(), from, to))
}

/// 立体声 `from` Hz → `to` Hz（两声道共用一组核，没有声道间相位差）。
pub fn resample_stereo(x: &Stereo, from: f64, to: f64) -> Stereo {
    if (from - to).abs() < 0.5 || x.l.is_empty() {
        return x.clone();
    }
    let k = Kernel::new(from, to);
    let n = output_len(x.l.len(), from, to);
    Stereo {
        l: k.run(&x.l, n),
        r: k.run(&x.r, n),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::TAU;

    fn tone(f: f64, sr: f64, secs: f64) -> Vec<f32> {
        (0..(sr * secs) as usize)
            .map(|i| (libm::sin(TAU * f * i as f64 / sr) * 0.5) as f32)
            .collect()
    }

    fn rms(x: &[f32]) -> f64 {
        (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt()
    }

    #[test]
    fn identity_and_lengths() {
        let x = tone(440.0, 48_000.0, 0.1);
        assert_eq!(resample(&x, 48_000.0, 48_000.0), x);
        assert_eq!(output_len(22_050, 22_050.0, 48_000.0), 48_000);
        assert_eq!(
            resample(&tone(440.0, 22_050.0, 1.0), 22_050.0, 48_000.0).len(),
            48_000
        );
        assert_eq!(
            resample(&tone(440.0, 48_000.0, 1.0), 48_000.0, 16_000.0).len(),
            16_000
        );
    }

    #[test]
    fn passband_tone_keeps_level_and_phase() {
        // 1 kHz @ 22.05 kHz → 48 kHz：中段应与直接在 48 kHz 生成的同一正弦几乎一致。
        let up = resample(&tone(1000.0, 22_050.0, 1.0), 22_050.0, 48_000.0);
        let want = tone(1000.0, 48_000.0, 1.0);
        let mid = 4_800..43_200;
        let err: f64 = up[mid.clone()]
            .iter()
            .zip(&want[mid.clone()])
            .map(|(a, b)| ((*a - *b) as f64).abs())
            .fold(0.0, f64::max);
        assert!(err < 2e-3, "max err {err}");
        assert!((rms(&up[mid]) / (0.5 / 2f64.sqrt()) - 1.0).abs() < 1e-3);
    }

    #[test]
    fn downsampling_rejects_above_new_nyquist() {
        // 20 kHz @ 48 kHz → 16 kHz：新奈奎斯特 8 kHz 之上，应被压到 −60 dB 以下。
        let down = resample(&tone(20_000.0, 48_000.0, 1.0), 48_000.0, 16_000.0);
        let r = rms(&down[1_600..14_400]) / (0.5 / 2f64.sqrt());
        assert!(20.0 * r.log10() < -60.0, "leak {}", 20.0 * r.log10());
    }

    #[test]
    fn stereo_matches_mono_per_channel_and_is_deterministic() {
        let l = tone(300.0, 44_100.0, 0.2);
        let r = tone(700.0, 44_100.0, 0.2);
        let s = resample_stereo(
            &Stereo {
                l: l.clone(),
                r: r.clone(),
            },
            44_100.0,
            48_000.0,
        );
        assert_eq!(s.l, resample(&l, 44_100.0, 48_000.0));
        assert_eq!(s.r, resample(&r, 44_100.0, 48_000.0));
        assert_eq!(s, resample_stereo(&Stereo { l, r }, 44_100.0, 48_000.0));
    }
}
