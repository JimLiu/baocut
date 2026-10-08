//! 动态：10 ms 块 RMS、单极点起落跟随、块序列插回采样、说话活跃度（连续 0..1）、
//! activity 闪避、glue 压缩。与参考工程 `block_rms` / `follow` / `to_samples` / `activity` 同口径。

use crate::math::{db_to_gain, gain_to_db};
use crate::stereo::Stereo;

/// 块长（秒）。
pub const BLOCK_SECONDS: f64 = 0.01;
/// activity 的下限（dBFS）：跟随电平在它以下算“没在说话”。
pub const ACTIVITY_FLOOR_DB: f64 = -48.0;
/// activity 从 0 升到 1 跨的 dB 数。
pub const ACTIVITY_RANGE_DB: f64 = 14.0;

fn block_len(sr: f64) -> usize {
    libm::round(BLOCK_SECONDS * sr).max(1.0) as usize
}

/// 多声道的块 RMS：先逐采样取各声道均方，再按块求 RMS；不满一块的尾巴丢弃（与参考同）。
pub fn block_rms(chans: &[&[f32]], sr: f64) -> Vec<f64> {
    let blk = block_len(sr);
    let n = chans.iter().map(|c| c.len()).min().unwrap_or(0);
    let k = chans.len().max(1) as f64;
    (0..n / blk)
        .map(|b| {
            let mut acc = 0.0f64;
            for i in b * blk..(b + 1) * blk {
                acc += chans
                    .iter()
                    .map(|c| (c[i] as f64) * (c[i] as f64))
                    .sum::<f64>()
                    / k;
            }
            libm::sqrt(acc / blk as f64 + 1e-12)
        })
        .collect()
}

/// 块序列上的单极点起落跟随（`att` / `rel` 秒）：上升用 attack 系数、下降用 release 系数。
pub fn follow(v: &[f64], att: f64, rel: f64) -> Vec<f64> {
    let a = libm::exp(-BLOCK_SECONDS / att);
    let r = libm::exp(-BLOCK_SECONDS / rel);
    let mut s = 0.0f64;
    v.iter()
        .map(|x| {
            s = if *x > s {
                a * s + (1.0 - a) * x
            } else {
                r * s + (1.0 - r) * x
            };
            s
        })
        .collect()
}

/// 块序列 → 逐采样（块中心线性插值，两端保持）。
pub fn blocks_to_samples(g: &[f64], n: usize, sr: f64) -> Vec<f32> {
    if g.is_empty() {
        return vec![0.0; n];
    }
    (0..n).map(|i| block_value_at(g, i, sr) as f32).collect()
}

/// [`blocks_to_samples`] 的单点版：第 `i` 个采样处的值（`g` 非空）。按窗口流式处理整片时用它，
/// 不必把逐采样曲线整条摊开。
pub fn block_value_at(g: &[f64], i: usize, sr: f64) -> f64 {
    let blk = block_len(sr) as f64;
    let pos = (i as f64 - blk / 2.0) / blk;
    if pos <= 0.0 {
        return g[0];
    }
    let j = pos as usize;
    if j + 1 >= g.len() {
        return g[g.len() - 1];
    }
    let u = pos - j as f64;
    g[j] + (g[j + 1] - g[j]) * u
}

/// 块 RMS → 活跃度块序列：按 `att` / `rel` 跟随，dB 值从 `floor_db` 到 `floor_db + range_db`
/// 线性映射并夹到 [0, 1]。
pub fn activity_blocks(rms: &[f64], att: f64, rel: f64, floor_db: f64, range_db: f64) -> Vec<f64> {
    follow(rms, att, rel)
        .into_iter()
        .map(|v| (gain_to_db(v + 1e-9) - floor_db) / range_db)
        .map(|v| v.clamp(0.0, 1.0))
        .collect()
}

/// 连续的“有人在说话”0..1：干声跟随电平（20 ms 起 / 350 ms 落）的 dB 值
/// 从 `floor_db` 到 `floor_db + range_db` 线性映射并夹到 [0, 1]。长度 `n`。
pub fn activity(chans: &[&[f32]], n: usize, sr: f64, floor_db: f64, range_db: f64) -> Vec<f32> {
    let e = activity_blocks(&block_rms(chans, sr), 0.02, 0.35, floor_db, range_db);
    blocks_to_samples(&e, n, sr)
}

/// 闪避增益：`db(−depth_db · activity)`；`depth_db` 可逐采样（风暴里闪得更深）。
pub fn duck_gain(activity: &[f32], depth_db: &[f32]) -> Vec<f32> {
    assert_eq!(activity.len(), depth_db.len(), "duck curves length");
    activity
        .iter()
        .zip(depth_db)
        .map(|(a, d)| db_to_gain(-(*d as f64) * *a as f64) as f32)
        .collect()
}

/// glue 压缩的参数。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Glue {
    pub threshold_db: f64,
    pub ratio: f64,
    pub attack: f64,
    pub release: f64,
}

impl Default for Glue {
    /// −20 dBFS 以上 2:1，30 ms / 250 ms（参考工程母带）。
    fn default() -> Self {
        Self {
            threshold_db: -20.0,
            ratio: 2.0,
            attack: 0.03,
            release: 0.25,
        }
    }
}

/// glue 压缩的逐采样增益（线性）：跟随电平超出门限的部分按 `1 − 1/ratio` 压下。
pub fn glue_gain(chans: &[&[f32]], n: usize, sr: f64, glue: Glue) -> Vec<f32> {
    let slope = 1.0 - 1.0 / glue.ratio.max(1.0);
    let gr: Vec<f64> = follow(&block_rms(chans, sr), glue.attack, glue.release)
        .into_iter()
        .map(|v| (-(gain_to_db(v + 1e-9) - glue.threshold_db) * slope).min(0.0))
        .collect();
    blocks_to_samples(&gr, n, sr)
        .into_iter()
        .map(|d| db_to_gain(d as f64) as f32)
        .collect()
}

/// 对立体声就地做 glue 压缩。
pub fn glue_stereo(x: &mut Stereo, sr: f64, glue: Glue) {
    let g = glue_gain(&x.channels(), x.len(), sr, glue);
    x.apply_gain(&g);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::TAU;

    const SR: f64 = 48_000.0;

    fn tone(n: usize, amp: f64) -> Vec<f32> {
        (0..n)
            .map(|i| (amp * libm::sin(TAU * 440.0 * i as f64 / SR)) as f32)
            .collect()
    }

    #[test]
    fn follower_rises_fast_and_falls_slow() {
        let mut v = vec![1.0; 100];
        v.extend(vec![0.0; 100]);
        let f = follow(&v, 0.02, 0.35);
        assert!(f[10] > 0.95);
        assert!(f[110] > 0.7);
        assert!(f[199] < 0.1);
    }

    #[test]
    fn activity_is_zero_in_silence_and_one_on_speech_level() {
        let mut x = vec![0.0f32; 48_000];
        x.extend(tone(48_000, 0.1));
        let a = activity(&[&x], x.len(), SR, ACTIVITY_FLOOR_DB, ACTIVITY_RANGE_DB);
        assert_eq!(a[24_000], 0.0);
        assert!((a[90_000] - 1.0).abs() < 1e-6);
        let d = duck_gain(&a, &vec![12.0; a.len()]);
        assert!((gain_to_db(d[90_000] as f64) + 12.0).abs() < 1e-3);
        assert_eq!(d[100], 1.0);
    }

    #[test]
    fn glue_compresses_above_threshold_by_ratio() {
        // 正弦峰值 0.5 → RMS ≈ −9 dBFS，超门限 11 dB，2:1 应压 5.5 dB。
        let x = tone(96_000, 0.5);
        let g = glue_gain(&[&x], x.len(), SR, Glue::default());
        let gr = gain_to_db(g[80_000] as f64);
        let expect = -(gain_to_db(0.5 / core::f64::consts::SQRT_2) + 20.0) * 0.5;
        assert!((gr - expect).abs() < 0.1, "{gr} vs {expect}");
        let quiet = tone(96_000, 0.01);
        let gq = glue_gain(&[&quiet], quiet.len(), SR, Glue::default());
        assert!(gq.iter().all(|v| *v == 1.0));
        assert_eq!(g, glue_gain(&[&x], x.len(), SR, Glue::default()));
    }
}
