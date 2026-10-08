//! ITU-R BS.1770-4 响度：K 加权、积分响度（绝对门 −70 LUFS + 相对门 −10 LU）、
//! 短期响度（3 s 窗）、EBU Tech 3342 响度范围 LRA（−20 LU 相对门，P95 − P10）。
//!
//! 实现口径跟 libebur128：K 加权两级系数按它的解析式随采样率现算；先算 100 ms 子块的
//! 各声道均方和，400 ms 门控块 = 连续 4 个子块（75% 重叠），3 s 短期窗 = 连续 30 个子块。
//! 只支持左右等权（G = 1）的声道，环绕声道的 1.41 权重不在范围内。

use crate::math::{db_to_gain, samples};
use crate::stereo::Stereo;

/// 无声时的响度值（与 ebur128 返回 `-inf` 同义；这里用有限值，方便 JSON）。
pub const SILENCE_LUFS: f64 = -200.0;

const ABS_GATE: f64 = -70.0;

#[derive(Clone, Copy)]
struct Kw {
    b: [f64; 3],
    a: [f64; 3],
}

/// K 加权两级滤波器（高搁架 + RLB 高通），系数与 libebur128 同式。
fn k_weighting(sr: f64) -> [Kw; 2] {
    let (f0, g, q) = (1681.974450955533, 3.999843853973347, 0.7071752369554196);
    let k = libm::tan(core::f64::consts::PI * f0 / sr);
    let vh = libm::pow(10.0, g / 20.0);
    let vb = libm::pow(vh, 0.4996667741545416);
    let a0 = 1.0 + k / q + k * k;
    let shelf = Kw {
        b: [
            (vh + vb * k / q + k * k) / a0,
            2.0 * (k * k - vh) / a0,
            (vh - vb * k / q + k * k) / a0,
        ],
        a: [1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0],
    };
    let (f0, q) = (38.13547087602444, 0.5003270373238773);
    let k = libm::tan(core::f64::consts::PI * f0 / sr);
    let d = 1.0 + k / q + k * k;
    let hp = Kw {
        b: [1.0, -2.0, 1.0],
        a: [1.0, 2.0 * (k * k - 1.0) / d, (1.0 - k / q + k * k) / d],
    };
    [shelf, hp]
}

/// 各声道 K 加权后，100 ms 子块的均方之和（Σ_c mean(z_c²)）。不满一块的尾巴丢弃。
pub fn subblock_power(chans: &[&[f32]], sr: f64) -> Vec<f64> {
    let n = chans.iter().map(|c| c.len()).min().unwrap_or(0);
    let mut meter = Meter::new(chans.len(), sr);
    let trimmed: Vec<&[f32]> = chans.iter().map(|c| &c[..n]).collect();
    meter.push(&trimmed);
    meter.into_subblocks()
}

/// 流式响度计：分段喂进同一段信号，与一次性调 [`subblock_power`] 逐位相同（K 加权
/// 滤波状态跨段延续，子块求和顺序也同为「声道 0、声道 1 …」）。给放不进内存的整片母带用。
#[derive(Debug, Clone)]
pub struct Meter {
    filters: [Kw; 2],
    step: usize,
    /// 每声道：两级滤波状态、未满子块的累加、已处理的采样数。
    chans: Vec<([[f64; 2]; 2], f64, usize)>,
    sub: Vec<f64>,
}

impl std::fmt::Debug for Kw {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Kw").finish_non_exhaustive()
    }
}

impl Meter {
    pub fn new(channels: usize, sr: f64) -> Self {
        Self {
            filters: k_weighting(sr),
            step: samples(0.1, sr).max(1),
            chans: vec![([[0.0; 2]; 2], 0.0, 0); channels],
            sub: Vec::new(),
        }
    }

    /// 喂一段（各声道等长，声道数与 [`Meter::new`] 相同）。
    pub fn push(&mut self, chans: &[&[f32]]) {
        assert_eq!(chans.len(), self.chans.len(), "meter channel count");
        let step = self.step;
        for (c, (z, acc, pos)) in chans.iter().zip(self.chans.iter_mut()) {
            for v in c.iter() {
                // 两级 DF-II 转置，全程 f64。
                let mut x = *v as f64;
                for (f, s) in self.filters.iter().zip(z.iter_mut()) {
                    let y = f.b[0] * x + s[0];
                    s[0] = f.b[1] * x - f.a[1] * y + s[1];
                    s[1] = f.b[2] * x - f.a[2] * y;
                    x = y;
                }
                *acc += x * x;
                *pos += 1;
                if *pos % step == 0 {
                    let k = *pos / step - 1;
                    if self.sub.len() <= k {
                        self.sub.push(0.0);
                    }
                    self.sub[k] += *acc / step as f64;
                    *acc = 0.0;
                }
            }
        }
    }

    /// 已完成的子块（最后一个声道也喂满的部分）。
    pub fn subblocks(&self) -> &[f64] {
        let done = self
            .chans
            .iter()
            .map(|c| c.2 / self.step)
            .min()
            .unwrap_or(0);
        &self.sub[..done.min(self.sub.len())]
    }

    pub fn into_subblocks(mut self) -> Vec<f64> {
        let done = self.subblocks().len();
        self.sub.truncate(done);
        self.sub
    }

    /// 积分响度（LUFS），同 [`integrated`]。
    pub fn integrated(&self) -> f64 {
        integrated_from_subblocks(self.subblocks())
    }

    /// 一次测完，同 [`measure`]。
    pub fn measure(&self) -> Loudness {
        measure_subblocks(self.subblocks())
    }

    /// 短期响度序列，同 [`short_term`]。
    pub fn short_term(&self) -> Vec<f64> {
        windows(self.subblocks(), 30)
            .into_iter()
            .map(to_lufs)
            .collect()
    }
}

fn to_lufs(power: f64) -> f64 {
    if power <= 0.0 {
        SILENCE_LUFS
    } else {
        -0.691 + 10.0 * libm::log10(power)
    }
}

/// 连续 `w` 个子块的平均功率（滑动一个子块一步）。
fn windows(sub: &[f64], w: usize) -> Vec<f64> {
    if sub.len() < w {
        return Vec::new();
    }
    (0..=sub.len() - w)
        .map(|j| sub[j..j + w].iter().sum::<f64>() / w as f64)
        .collect()
}

/// 积分响度（LUFS）。短于 400 ms 或全静音返回 [`SILENCE_LUFS`]。
pub fn integrated(chans: &[&[f32]], sr: f64) -> f64 {
    integrated_from_subblocks(&subblock_power(chans, sr))
}

fn integrated_from_subblocks(sub: &[f64]) -> f64 {
    let blocks = windows(sub, 4);
    let abs: Vec<f64> = blocks
        .into_iter()
        .filter(|p| to_lufs(*p) > ABS_GATE)
        .collect();
    if abs.is_empty() {
        return SILENCE_LUFS;
    }
    let rel = to_lufs(abs.iter().sum::<f64>() / abs.len() as f64) - 10.0;
    let gated: Vec<f64> = abs.into_iter().filter(|p| to_lufs(*p) > rel).collect();
    if gated.is_empty() {
        return SILENCE_LUFS;
    }
    to_lufs(gated.iter().sum::<f64>() / gated.len() as f64)
}

/// 短期响度序列（3 s 窗，每 100 ms 一个值；第 j 个值对应 `[0.1·j, 0.1·j + 3)` 秒）。
pub fn short_term(chans: &[&[f32]], sr: f64) -> Vec<f64> {
    windows(&subblock_power(chans, sr), 30)
        .into_iter()
        .map(to_lufs)
        .collect()
}

/// 响度范围 LRA（LU）。
pub fn loudness_range(chans: &[&[f32]], sr: f64) -> f64 {
    lra_from_subblocks(&subblock_power(chans, sr))
}

fn lra_from_subblocks(sub: &[f64]) -> f64 {
    let st: Vec<f64> = windows(sub, 30)
        .into_iter()
        .filter(|p| to_lufs(*p) > ABS_GATE)
        .collect();
    if st.is_empty() {
        return 0.0;
    }
    let rel = to_lufs(st.iter().sum::<f64>() / st.len() as f64) - 20.0;
    let mut gated: Vec<f64> = st.into_iter().filter(|p| to_lufs(*p) > rel).collect();
    if gated.is_empty() {
        return 0.0;
    }
    gated.sort_by(f64::total_cmp);
    let last = (gated.len() - 1) as f64;
    let lo = gated[libm::round(last * 0.10) as usize];
    let hi = gated[libm::round(last * 0.95) as usize];
    to_lufs(hi) - to_lufs(lo)
}

/// 一次测完：积分响度、LRA、最大短期响度。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Loudness {
    pub integrated: f64,
    pub lra: f64,
    pub short_term_max: f64,
}

pub fn measure(chans: &[&[f32]], sr: f64) -> Loudness {
    measure_subblocks(&subblock_power(chans, sr))
}

fn measure_subblocks(sub: &[f64]) -> Loudness {
    let st_max = windows(sub, 30)
        .into_iter()
        .map(to_lufs)
        .fold(SILENCE_LUFS, f64::max);
    Loudness {
        integrated: integrated_from_subblocks(sub),
        lra: lra_from_subblocks(sub),
        short_term_max: st_max,
    }
}

/// 整体增益到目标积分响度，返回施加的增益（dB）。静音或不足 400 ms 时不动，返回 0。
pub fn normalize_to_lufs(x: &mut Stereo, sr: f64, target_lufs: f64) -> f64 {
    let now = integrated(&x.channels(), sr);
    if now <= SILENCE_LUFS {
        return 0.0;
    }
    let g = target_lufs - now;
    x.scale(db_to_gain(g));
    g
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::TAU;
    use crate::noise::colored;
    use crate::rng::Rng;

    const SR: f64 = 48_000.0;

    fn sine(n: usize, f: f64, amp_db: f64) -> Vec<f32> {
        let a = db_to_gain(amp_db);
        (0..n)
            .map(|i| (a * libm::sin(TAU * f * i as f64 / SR)) as f32)
            .collect()
    }

    #[test]
    fn ebu_3341_stereo_sine_at_minus_23() {
        let x = sine(20 * 48_000, 997.0, -23.0);
        let l = integrated(&[&x, &x], SR);
        assert!((l + 23.0).abs() < 0.1, "{l}");
    }

    #[test]
    fn ebu_3342_lra_ten_lu() {
        let mut x = sine(20 * 48_000, 1000.0, -20.0);
        x.extend(sine(20 * 48_000, 1000.0, -30.0));
        let lra = loudness_range(&[&x, &x], SR);
        assert!((lra - 10.0).abs() < 1.0, "{lra}");
    }

    #[test]
    fn relative_gate_ignores_quiet_tail() {
        let mut x = sine(10 * 48_000, 1000.0, -20.0);
        x.extend(sine(10 * 48_000, 1000.0, -60.0));
        // 不开相对门会是约 −23 LUFS；开了之后只剩交界处一两个过渡块的影响。
        let l = integrated(&[&x, &x], SR);
        assert!((l + 20.0).abs() < 0.1, "{l}");
    }

    fn dynamic_noise(seed: u64) -> Stereo {
        let n = 30 * 48_000;
        let mut rng = Rng::new(seed);
        let l = colored(n, SR, 1.0, &mut rng);
        let r = colored(n, SR, 1.5, &mut rng);
        let env: Vec<f32> = (0..n)
            .map(|i| (0.02 + 0.2 * libm::sin(i as f64 / SR * 0.7).abs()) as f32)
            .collect();
        let mut s = Stereo { l, r };
        s.apply_gain(&env);
        s
    }

    #[test]
    fn matches_libebur128_within_tolerance() {
        let s = dynamic_noise(7);
        let mine = measure(&s.channels(), SR);
        let mut m =
            ebur128::EbuR128::new(2, 48_000, ebur128::Mode::I | ebur128::Mode::LRA).unwrap();
        m.add_frames_f32(&s.interleaved()).unwrap();
        let (i, lra) = (m.loudness_global().unwrap(), m.loudness_range().unwrap());
        assert!(
            (mine.integrated - i).abs() < 0.3,
            "I {} vs {i}",
            mine.integrated
        );
        assert!((mine.lra - lra).abs() < 1.0, "LRA {} vs {lra}", mine.lra);
    }

    #[test]
    fn streaming_meter_matches_one_shot_bit_for_bit() {
        let s = dynamic_noise(5);
        let whole = subblock_power(&s.channels(), SR);
        let mut m = Meter::new(2, SR);
        // 故意用不对齐子块的段长。
        let mut a = 0;
        for len in [1usize, 4799, 12_345, 100_000].iter().cycle() {
            if a >= s.len() {
                break;
            }
            let b = (a + len).min(s.len());
            m.push(&[&s.l[a..b], &s.r[a..b]]);
            a = b;
        }
        assert_eq!(m.subblocks(), &whole[..]);
        assert_eq!(m.integrated(), integrated(&s.channels(), SR));
        assert_eq!(m.measure(), measure(&s.channels(), SR));
    }

    #[test]
    fn normalize_hits_target_and_is_deterministic() {
        let mut s = dynamic_noise(8);
        let mut t = s.clone();
        normalize_to_lufs(&mut s, SR, -16.0);
        normalize_to_lufs(&mut t, SR, -16.0);
        assert_eq!(s, t);
        let l = integrated(&s.channels(), SR);
        assert!((l + 16.0).abs() < 0.01, "{l}");
        let mut silent = Stereo::zeros(48_000);
        assert_eq!(normalize_to_lufs(&mut silent, SR, -16.0), 0.0);
    }
}
