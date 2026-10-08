//! 母带链：淡入淡出 → glue 压缩 → （响度归一 → 真峰值限幅）× N → 去直流 → 静态兜底 → 测量。
//! 与参考工程 `mix()` 的母带段同序。

use crate::dynamics::{Glue, glue_stereo};
use crate::loudness::{self, normalize_to_lufs};
use crate::math::{gain_to_db, smoothstep};
use crate::stereo::{Stereo, remove_dc};
use crate::truepeak::{Limiter, limit, trim_to_ceiling, true_peak_db};

/// 淡出在结尾前多少秒到底（留一帧黑，30 fps ≈ 0.033 s）。
pub const FADE_OUT_TAIL: f64 = 0.03;

#[derive(Debug, Clone, PartialEq)]
pub struct MasterSpec {
    /// 目标积分响度（LUFS）。
    pub lufs: f64,
    /// 真峰值上限（dBTP）。限幅器瞄准 `true_peak − 0.1`，最后静态兜底到 `true_peak`。
    pub true_peak: f64,
    /// 淡入秒数（smoothstep，从 0 开始）。
    pub fade_in: f64,
    /// 淡出秒数（smoothstep，在结尾前 [`FADE_OUT_TAIL`] 秒到 0）。
    pub fade_out: f64,
    /// glue 压缩；`None` 不压。
    pub glue: Option<Glue>,
    /// 归一 + 限幅的轮数。
    pub passes: usize,
}

impl Default for MasterSpec {
    fn default() -> Self {
        Self {
            lufs: -16.0,
            true_peak: -1.2,
            fade_in: 0.0,
            fade_out: 0.0,
            glue: Some(Glue::default()),
            passes: 3,
        }
    }
}

/// 母带测量。
#[derive(Debug, Clone, PartialEq)]
pub struct MasterReport {
    pub lufs: f64,
    pub true_peak: f64,
    pub lra: f64,
    pub sample_peak: f64,
    pub short_term_max: f64,
    /// 各轮响度归一的静态增益之和（dB）；不含 glue 与限幅器的动态增益。
    pub static_gain_db: f64,
}

/// 淡入淡出增益（逐采样）。
pub fn fade_curve(n: usize, sr: f64, fade_in: f64, fade_out: f64) -> Vec<f32> {
    let dur = n as f64 / sr;
    (0..n)
        .map(|i| {
            let t = i as f64 / sr;
            let a = if fade_in > 0.0 {
                smoothstep(0.0, fade_in, t)
            } else {
                1.0
            };
            let end = dur - FADE_OUT_TAIL;
            let b = if fade_out > 0.0 {
                1.0 - smoothstep(end - fade_out, end, t)
            } else {
                1.0
            };
            (a * b) as f32
        })
        .collect()
}

/// 就地做母带，返回测量。
pub fn master(x: &mut Stereo, sr: f64, spec: &MasterSpec) -> MasterReport {
    let n = x.len();
    if spec.fade_in > 0.0 || spec.fade_out > 0.0 {
        x.apply_gain(&fade_curve(n, sr, spec.fade_in, spec.fade_out));
    }
    if let Some(g) = spec.glue {
        glue_stereo(x, sr, g);
    }
    let lim = Limiter {
        ceiling_db: spec.true_peak - 0.1,
        ..Limiter::default()
    };
    let mut static_gain_db = 0.0;
    for _ in 0..spec.passes.max(1) {
        static_gain_db += normalize_to_lufs(x, sr, spec.lufs);
        limit(x, sr, lim);
    }
    remove_dc(&mut x.l);
    remove_dc(&mut x.r);
    trim_to_ceiling(x, spec.true_peak);
    let m = loudness::measure(&x.channels(), sr);
    MasterReport {
        lufs: m.integrated,
        true_peak: true_peak_db(&x.channels()),
        lra: m.lra,
        sample_peak: gain_to_db(x.peak()),
        short_term_max: m.short_term_max,
        static_gain_db,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::noise::colored;
    use crate::rng::Rng;

    const SR: f64 = 48_000.0;

    #[test]
    fn hits_loudness_and_true_peak_targets() {
        let n = 8 * 48_000;
        let mut rng = Rng::new(21);
        let mut s = Stereo {
            l: colored(n, SR, 1.0, &mut rng),
            r: colored(n, SR, 1.0, &mut rng),
        };
        // 动态：几段很响的冲击 + 安静底。
        let env: Vec<f32> = (0..n)
            .map(|i| if (i / 24_000) % 4 == 0 { 0.9 } else { 0.05 })
            .collect();
        s.apply_gain(&env);
        let spec = MasterSpec {
            fade_in: 0.5,
            fade_out: 0.5,
            ..MasterSpec::default()
        };
        let mut t = s.clone();
        let rep = master(&mut s, SR, &spec);
        assert!((rep.lufs - spec.lufs).abs() < 0.3, "lufs {}", rep.lufs);
        assert!(
            rep.true_peak <= spec.true_peak + 1e-6,
            "tp {}",
            rep.true_peak
        );
        assert_eq!(rep, master(&mut t, SR, &spec));
        assert_eq!(s, t);
        // 外部量表复核。
        let mut m =
            ebur128::EbuR128::new(2, 48_000, ebur128::Mode::I | ebur128::Mode::TRUE_PEAK).unwrap();
        m.add_frames_f32(&s.interleaved()).unwrap();
        let i = m.loudness_global().unwrap();
        let tp = gain_to_db(m.true_peak(0).unwrap().max(m.true_peak(1).unwrap()));
        assert!((i - spec.lufs).abs() < 0.3, "ebur128 I {i}");
        assert!(tp <= spec.true_peak + 0.1, "ebur128 TP {tp}");
    }

    #[test]
    fn fade_curve_shape() {
        let f = fade_curve(48_000, SR, 0.2, 0.2);
        assert_eq!(f[0], 0.0);
        assert_eq!(f[24_000], 1.0);
        assert_eq!(*f.last().unwrap(), 0.0);
    }
}
