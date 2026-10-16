//! 物理建模的积木：真实的物体被一次接触激励、按各自的模态振动，录下来时总隔着一个房间和一只话筒。
//! 程序化音效（[`crate::sfx`]）里拟真的配方（`click`、`keypress`、`pop`、`impact`）用它们拼。
//!
//! 为什么不用振荡器加包络：正弦扫频、滤波噪声加指数衰减是代码合成最容易被听出来的样子（没有底噪、
//! 能量集中在几条谱线上、包络过分光滑）。接触脉冲激励一组有阻尼的模态、再过小房间与话筒，起音、
//! 音色与尾巴都更接近录音。思路参考开源项目 earshot（Leon Lin，MIT 许可）的 forge；这里是按同一思路的
//! 独立实现，没有搬它的代码与参数。

use crate::biquad::{self, Biquad};
use crate::math::{TAU, db_to_gain, samples};
use crate::noise;
use crate::reverb::{IrSpec, convolve, synth_ir};
use crate::rng::Rng;
use crate::stereo::peak;

/// 一个振动模态：频率（Hz）、振幅衰减到 1/e 的时间常数（秒）与相对振幅。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Mode {
    pub freq: f64,
    pub tau: f64,
    pub amp: f64,
}

/// 接触力脉冲：半个正弦，长 `tc` 秒（两物体碰撞时的赫兹接触），峰值 1。接触越短，激励到的频率越高：
/// 能量大致到 `1.5 / tc` 为止，再往上迅速变小。短于一个采样时是单位冲激。
pub fn contact(tc: f64, sr: f64) -> Vec<f32> {
    let n = samples(tc, sr).max(1);
    (0..n)
        .map(|i| libm::sin(core::f64::consts::PI * (i as f64 + 0.5) / n as f64) as f32)
        .collect()
}

/// 推力：长 `seconds` 的 Hann 形平滑力（手指压下、整块板子被推着动），只激励得动低频模态。
pub fn push(seconds: f64, sr: f64) -> Vec<f32> {
    let n = samples(seconds, sr).max(2);
    (0..n)
        .map(|i| (0.5 - 0.5 * libm::cos(TAU * i as f64 / (n - 1) as f64)) as f32)
        .collect()
}

/// 一组模态对激励 `x` 的响应，长 `n` 个采样。每个模态是冲激响应为 `amp·e^(−t/tau)·sin(2πft)` 的二阶共振器
/// （冲激不变法），各自滤 `x` 再相加；频率不在 `(0, 0.45·sr)` 里的模态丢掉。
pub fn modal(x: &[f32], modes: &[Mode], sr: f64, n: usize) -> Vec<f32> {
    let mut out = vec![0.0_f64; n];
    for mode in modes {
        if !(mode.freq > 0.0 && mode.freq < 0.45 * sr && mode.tau > 0.0) {
            continue;
        }
        let r = libm::exp(-1.0 / (mode.tau * sr));
        let w = TAU * mode.freq / sr;
        let a1 = 2.0 * r * libm::cos(w);
        let a2 = r * r;
        let b1 = mode.amp * r * libm::sin(w);
        let (mut y1, mut y2, mut x1) = (0.0_f64, 0.0_f64, 0.0_f64);
        for (i, acc) in out.iter_mut().enumerate() {
            let y = b1 * x1 + a1 * y1 - a2 * y2;
            *acc += y;
            y2 = y1;
            y1 = y;
            x1 = x.get(i).map_or(0.0, |v| f64::from(*v));
        }
    }
    out.into_iter().map(|v| v as f32).collect()
}

/// 密集的一团模态（壳体、塑料件、木板上分辨不出单个音高的部分）：`count` 个频率在 `[lo, hi]` 里按对数均匀
/// 随机，衰减时间常数在 `[tau_lo, tau_hi]` 里按对数随机，振幅按 `tilt_db`（dB / 倍频程，以 `lo` 为 0 dB）
/// 倾斜、再乘 0.5..1 的随机。
pub fn modal_cloud(
    lo: f64,
    hi: f64,
    count: usize,
    tau_lo: f64,
    tau_hi: f64,
    tilt_db: f64,
    rng: &mut Rng,
) -> Vec<Mode> {
    let (log_lo, log_hi) = (libm::log(lo), libm::log(hi));
    let (log_tlo, log_thi) = (libm::log(tau_lo), libm::log(tau_hi));
    (0..count)
        .map(|_| {
            let freq = libm::exp(rng.uniform(log_lo, log_hi));
            let tau = libm::exp(rng.uniform(log_tlo, log_thi));
            let octaves = libm::log2(freq / lo);
            let amp = db_to_gain(tilt_db * octaves) * rng.uniform(0.5, 1.0);
            Mode { freq, tau, amp }
        })
        .collect()
}

/// 近距离话筒听到的小房间：中频 T60 为 `t60` 秒的合成短混响（2 ms 预延迟），按 `wet` 叠到干声上。
/// 单声道（取 IR 的左声道），长度不变。
pub fn small_room(x: &[f32], sr: f64, t60: f64, wet: f64, seed: u64) -> Vec<f32> {
    let ir = synth_ir(
        &IrSpec {
            pre_delay: 0.002,
            ..IrSpec::new(t60, seed)
        },
        sr,
    );
    let tail = convolve(x, &ir.l, x.len());
    x.iter()
        .zip(&tail)
        .map(|(dry, wet_sample)| (f64::from(*dry) + wet * f64::from(*wet_sample)) as f32)
        .collect()
}

/// 话筒与录音链：二阶低切 `low_cut` Hz、8 kHz 起的高搁架 `air_db`，再叠一层比信号峰值低 `floor_db`
/// （负数）的底噪：粉噪声，16 kHz 以上滚降。真实录音都有底噪，整段数字静音是合成声的一个破绽。
pub fn mic(
    x: &[f32],
    sr: f64,
    low_cut: f64,
    air_db: f64,
    floor_db: f64,
    rng: &mut Rng,
) -> Vec<f32> {
    let mut y = biquad::highpass(x, sr, low_cut, 2);
    Biquad::high_shelf(sr, 8000.0_f64.min(0.4 * sr), 0.7, air_db).process(&mut y);
    let level = peak(&y) * db_to_gain(floor_db);
    let floor = biquad::lowpass(
        &noise::colored(y.len(), sr, 1.0, rng),
        sr,
        16_000.0_f64.min(0.45 * sr),
        2,
    );
    for (sample, hiss) in y.iter_mut().zip(&floor) {
        *sample = (f64::from(*sample) + level * f64::from(*hiss)) as f32;
    }
    y
}

/// 把 `x` 缩放到峰值 1（全零时不变）。配方按峰值配比各层用。
pub fn unit_peak(mut x: Vec<f32>) -> Vec<f32> {
    let p = peak(&x);
    if p > 0.0 {
        for sample in x.iter_mut() {
            *sample = (f64::from(*sample) / p) as f32;
        }
    }
    x
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stereo::rms;

    const SR: f64 = 48_000.0;

    #[test]
    fn a_struck_mode_rings_at_its_frequency_and_decays_with_its_tau() {
        let mode = Mode {
            freq: 1000.0,
            tau: 0.01,
            amp: 1.0,
        };
        let y = modal(&[1.0], &[mode], SR, 4800);
        // 1 kHz：一个周期 48 个采样，正峰在四分之一周期附近。
        let first_peak = (0..48).max_by(|a, b| y[*a].total_cmp(&y[*b])).unwrap();
        assert!((11..=13).contains(&first_peak), "peak at {first_peak}");
        // 10 ms 后振幅约为 1/e。
        let early = rms(&y[0..480]);
        let later = rms(&y[480..960]);
        let ratio = later / early;
        assert!((ratio - libm::exp(-1.0)).abs() < 0.05, "ratio {ratio}");
    }

    #[test]
    fn a_shorter_contact_reaches_higher_frequencies() {
        let high = Mode {
            freq: 9000.0,
            tau: 0.002,
            amp: 1.0,
        };
        let low = Mode {
            freq: 200.0,
            tau: 0.01,
            amp: 1.0,
        };
        // 高频模态相对低频模态被激励得多响：接触越短，比值越大。
        let brightness = |tc: f64| {
            let force = contact(tc, SR);
            peak(&modal(&force, &[high], SR, 960)) / peak(&modal(&force, &[low], SR, 960))
        };
        assert!(brightness(0.00005) > 3.0 * brightness(0.002));
    }

    #[test]
    fn modes_out_of_range_are_skipped_and_output_is_deterministic() {
        let modes = [
            Mode {
                freq: 30_000.0,
                tau: 0.01,
                amp: 1.0,
            },
            Mode {
                freq: -5.0,
                tau: 0.01,
                amp: 1.0,
            },
        ];
        assert!(modal(&[1.0], &modes, SR, 100).iter().all(|v| *v == 0.0));
        let a = modal_cloud(2000.0, 8000.0, 12, 0.001, 0.004, -3.0, &mut Rng::new(3));
        let b = modal_cloud(2000.0, 8000.0, 12, 0.001, 0.004, -3.0, &mut Rng::new(3));
        assert_eq!(a, b);
        assert!(a.iter().all(|m| (2000.0..=8000.0).contains(&m.freq)));
    }

    #[test]
    fn mic_adds_a_noise_floor_under_silence() {
        let mut x = vec![0.0_f32; 4800];
        x[0] = 1.0;
        let y = mic(&x, SR, 30.0, 0.0, -60.0, &mut Rng::new(1));
        let tail = rms(&y[2400..]);
        assert!(tail > 0.0, "the tail must not be digital silence");
        assert!(tail < 0.01, "floor {tail} should sit far under the hit");
    }

    #[test]
    fn small_room_keeps_the_length_and_adds_energy_after_the_hit() {
        let mut x = vec![0.0_f32; 9600];
        x[0] = 1.0;
        let y = small_room(&x, SR, 0.2, 0.2, 5);
        assert_eq!(y.len(), x.len());
        assert!(rms(&y[480..]) > 0.0);
    }
}
