//! 混音链（规范 §4 `audio`、§8.4 的 `fadeIn` / `fadeOut` / `pan` / `bus` / `muted`）：
//! clip 增益与 `volume` 关键帧 → 淡入淡出 → 声像 → 按总线求和 → 闪避 → 总线增益 → 求和 → 母带
//! （响度归一与真峰值限幅交替三轮，最后按真峰值静态兜底）。
//!
//! 整条链按固定长度的窗口流式跑，内存与片长无关：闪避先整片扫一遍 `from` 总线的块 RMS
//! （10 ms 一块，窗口长是块长的整数倍，所以分窗与整条一次算逐位相同）；母带的响度计是
//! 跨窗延续状态的 [`Meter`]，限幅器每侧带 [`limiter_context`] 个采样的上下文——窗内结果
//! 与 `bcut-audio-dsp` 对整条信号的 `normalize_to_lufs` + `limit` 逐位相同（本文件测试对拍）。
//!
//! 文档没写 `audio`、也没有 clip 用到淡入淡出 / 声像时不进这里：`audio.rs` 的旧路径
//! 原样混音，输出与旧版逐位相同。

use super::{CHANNELS, SAMPLE_RATE};
use anyhow::{Context, Result};
use audio_dsp::dynamics::{
    ACTIVITY_FLOOR_DB, ACTIVITY_RANGE_DB, activity_blocks, block_rms, block_value_at,
};
use audio_dsp::loudness::{Meter, SILENCE_LUFS};
use audio_dsp::math::{db_to_gain, gain_to_db};
use audio_dsp::stereo::{Stereo, pan_gains};
use audio_dsp::truepeak::{
    Limiter, PEAK_CONTEXT, limiter_context, limiter_gain, oversampled_peaks,
};
use scene_primitives::audio_mix::{DocAudio, MasterTarget};
use scene_primitives::resolve::AudioClip;
use scene_primitives::sample::sample_frames;
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};

/// 窗口长（帧）：4 s，是 10 ms 块（480 帧）的整数倍。
pub(crate) const WINDOW: u64 = 4 * SAMPLE_RATE as u64;
/// 归一 + 限幅的轮数。
const PASSES: usize = 3;

/// 一条解好码的 clip PCM（48 kHz 交错立体声 f32）。
pub(crate) enum ClipPcm {
    Mem(Vec<f32>),
    File(tempfile::TempPath),
}

pub(crate) struct ChainClip<'a> {
    pub clip: &'a AudioClip,
    pub pcm: ClipPcm,
    /// PCM 帧数。
    pub frames: u64,
    /// 片内起点帧。
    pub start: u64,
    /// `false` = 只给闪避量活跃度，不进输出（时间轴另放的旁白）。
    pub audible: bool,
}

impl ChainClip<'_> {
    /// 片内帧 `[a, b)` 与本 clip 的交集，交出（交集起点，交错样本）。
    fn read(&self, a: u64, b: u64) -> Result<Option<(u64, Cow<'_, [f32]>)>> {
        let a = a.max(self.start);
        let b = b.min(self.start.saturating_add(self.frames));
        if b <= a {
            return Ok(None);
        }
        let (la, lb) = ((a - self.start) as usize, (b - self.start) as usize);
        Ok(Some((
            a,
            match &self.pcm {
                ClipPcm::Mem(v) => Cow::Borrowed(&v[la * CHANNELS..lb * CHANNELS]),
                ClipPcm::File(path) => Cow::Owned(read_f32(path, la as u64, lb as u64)?),
            },
        )))
    }
}

fn read_f32(path: &std::path::Path, a: u64, b: u64) -> Result<Vec<f32>> {
    let mut reader = File::open(path)?;
    reader.seek(SeekFrom::Start(a * 8))?;
    let mut bytes = vec![0u8; (b - a) as usize * 8];
    reader.read_exact(&mut bytes)?;
    Ok(bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect())
}

/// 母带实测。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MasterMeasure {
    /// 母带前的积分响度（LUFS）。
    pub input_lufs: f64,
    /// 母带后的积分响度（LUFS）。
    pub lufs: f64,
    /// 母带后的真峰值（dBTP）。
    pub true_peak: f64,
    /// 各轮响度归一的静态增益之和（dB）。
    pub static_gain_db: f64,
}

pub(crate) struct ChainReport {
    pub master: Option<MasterMeasure>,
}

/// 把 `clip` 在 `[begin, end)` 里的声音（增益、淡入淡出、声像）叠进 `bus`（交错立体声，长 `end − begin` 帧）。
fn add_clip(c: &ChainClip<'_>, begin: u64, end: u64, bus: &mut [f32]) -> Result<()> {
    let Some((a, samples)) = c.read(begin, end)? else {
        return Ok(());
    };
    let clip = c.clip;
    let sr = f64::from(SAMPLE_RATE);
    let (gl, gr) = if clip.pan == 0.0 {
        (1.0, 1.0)
    } else {
        pan_gains(clip.pan)
    };
    let fades = clip.fade_in > 0.0 || clip.fade_out > 0.0;
    let n = samples.len() / CHANNELS;
    let mut offset = 0usize;
    while offset < n {
        // 音量包络与旧路径同口径：64 帧一块、块首采样。
        let local = a - c.start + offset as u64;
        let block_start = local / 64 * 64;
        let vol = if clip.volume.is_empty() {
            clip.base_volume
        } else {
            sample_frames(&clip.volume, clip.start + block_start as f64 / sr)
                .as_f64()
                .unwrap_or(clip.base_volume)
        };
        let m = ((64 - local % 64) as usize).min(n - offset);
        for k in offset..offset + m {
            let fade = if fades {
                clip.fade_gain(clip.start + (local + (k - offset) as u64) as f64 / sr)
            } else {
                1.0
            };
            let g = vol * fade;
            let out = (a - begin) as usize + k;
            bus[out * 2] += samples[k * 2] * (g * gl) as f32;
            bus[out * 2 + 1] += samples[k * 2 + 1] * (g * gr) as f32;
        }
        offset += m;
    }
    Ok(())
}

/// 中间整片 PCM：内存或临时文件（交错立体声 f32）。
enum Store {
    Mem(Vec<f32>),
    File(tempfile::NamedTempFile, u64),
}

impl Store {
    fn new(streamed: bool) -> Result<Self> {
        Ok(if streamed {
            Store::File(tempfile::NamedTempFile::new()?, 0)
        } else {
            Store::Mem(Vec::new())
        })
    }

    fn append(&mut self, x: &[f32]) -> Result<()> {
        match self {
            Store::Mem(v) => v.extend_from_slice(x),
            Store::File(f, frames) => {
                let mut bytes = Vec::with_capacity(x.len() * 4);
                for s in x {
                    bytes.extend_from_slice(&s.to_le_bytes());
                }
                f.as_file_mut().write_all(&bytes)?;
                *frames += (x.len() / CHANNELS) as u64;
            }
        }
        Ok(())
    }

    fn read(&self, a: u64, b: u64) -> Result<Stereo> {
        let inter: Cow<'_, [f32]> = match self {
            Store::Mem(v) => Cow::Borrowed(&v[a as usize * 2..b as usize * 2]),
            Store::File(f, _) => Cow::Owned(read_f32(f.path(), a, b)?),
        };
        Ok(Stereo {
            l: inter.iter().step_by(2).copied().collect(),
            r: inter.iter().skip(1).step_by(2).copied().collect(),
        })
    }
}

fn interleave(s: &Stereo) -> Vec<f32> {
    let mut out = Vec::with_capacity(s.len() * 2);
    for (l, r) in s.l.iter().zip(&s.r) {
        out.push(*l);
        out.push(*r);
    }
    out
}

/// 跑整条混音链，逐窗交给 `out`（交错立体声，已夹到 [−1, 1]）。
///
/// `master` 为 `None` 时不做母带（调用方没要、或部分 clip 被时间轴另放）。
pub(crate) fn run(
    total_frames: u64,
    clips: &[ChainClip<'_>],
    doc: &DocAudio,
    master: Option<MasterTarget>,
    streamed: bool,
    window: u64,
    out: &mut dyn FnMut(&[f32]) -> Result<()>,
    checkpoint: &mut dyn FnMut() -> Result<()>,
) -> Result<ChainReport> {
    let sr = f64::from(SAMPLE_RATE);
    let windows = || {
        (0..total_frames)
            .step_by(window as usize)
            .map(move |a| (a, (a + window).min(total_frames)))
    };

    // 第 0 遍：闪避源总线的整片块 RMS → 每条规则的活跃度块序列。
    let sources: BTreeSet<&str> = doc
        .duck
        .iter()
        .map(|d| d.from.as_str())
        .filter(|from| clips.iter().any(|c| c.clip.bus == *from))
        .collect();
    let mut rms: BTreeMap<&str, Vec<f64>> = BTreeMap::new();
    if !sources.is_empty() {
        for (a, b) in windows() {
            checkpoint()?;
            for from in &sources {
                let mut bus = vec![0f32; (b - a) as usize * CHANNELS];
                for c in clips.iter().filter(|c| c.clip.bus == *from) {
                    add_clip(c, a, b, &mut bus)?;
                }
                let l: Vec<f32> = bus.iter().step_by(2).copied().collect();
                let r: Vec<f32> = bus.iter().skip(1).step_by(2).copied().collect();
                rms.entry(from)
                    .or_default()
                    .extend(block_rms(&[&l, &r], sr));
            }
        }
    }
    let activity: Vec<(&[String], f64, Vec<f64>)> = doc
        .duck
        .iter()
        .filter_map(|d| {
            let r = rms.get(d.from.as_str()).filter(|r| !r.is_empty())?;
            Some((
                d.to.as_slice(),
                d.depth_db,
                activity_blocks(r, d.attack, d.release, ACTIVITY_FLOOR_DB, ACTIVITY_RANGE_DB),
            ))
        })
        .collect();

    // 第 1 遍：逐窗按总线求和 → 闪避 → 总线增益 → 求和。
    let buses: BTreeSet<&str> = clips
        .iter()
        .filter(|c| c.audible)
        .map(|c| c.clip.bus.as_str())
        .collect();
    let mut pre = master.map(|_| Store::new(streamed)).transpose()?;
    for (a, b) in windows() {
        checkpoint()?;
        let n = (b - a) as usize;
        let mut mix = vec![0f32; n * CHANNELS];
        for bus_name in &buses {
            let mut bus = vec![0f32; n * CHANNELS];
            for c in clips
                .iter()
                .filter(|c| c.audible && c.clip.bus == *bus_name)
            {
                add_clip(c, a, b, &mut bus)?;
            }
            let gain = db_to_gain(doc.bus_gain_db(bus_name));
            let ducks: Vec<&(&[String], f64, Vec<f64>)> = activity
                .iter()
                .filter(|(to, _, _)| to.iter().any(|t| t == bus_name))
                .collect();
            for i in 0..n {
                let mut g = gain;
                for (_, depth, act) in &ducks {
                    g *= db_to_gain(-depth * block_value_at(act, a as usize + i, sr));
                }
                let g = g as f32;
                mix[i * 2] += bus[i * 2] * g;
                mix[i * 2 + 1] += bus[i * 2 + 1] * g;
            }
        }
        match pre.as_mut() {
            Some(store) => store.append(&mix)?,
            None => {
                for s in &mut mix {
                    *s = s.clamp(-1.0, 1.0);
                }
                out(&mix)?;
            }
        }
    }
    let (Some(pre), Some(target)) = (pre, master) else {
        return Ok(ChainReport { master: None });
    };
    let measure = master_store(pre, total_frames, target, streamed, window, out, checkpoint)?;
    Ok(ChainReport {
        master: Some(measure),
    })
}

/// 分窗母带：与对整条信号跑 `(normalize_to_lufs → limit) × 3 → trim_to_ceiling` 逐位相同。
fn master_store(
    mut cur: Store,
    frames: u64,
    target: MasterTarget,
    streamed: bool,
    window: u64,
    out: &mut dyn FnMut(&[f32]) -> Result<()>,
    checkpoint: &mut dyn FnMut() -> Result<()>,
) -> Result<MasterMeasure> {
    let sr = f64::from(SAMPLE_RATE);
    let lim = Limiter {
        ceiling_db: target.true_peak - 0.1,
        ..Limiter::default()
    };
    let ctx = limiter_context(sr, lim) as u64;
    let windows = || {
        (0..frames)
            .step_by(window as usize)
            .map(move |a| (a, (a + window).min(frames)))
    };
    let measure = |store: &Store, checkpoint: &mut dyn FnMut() -> Result<()>| -> Result<f64> {
        let mut meter = Meter::new(2, sr);
        for (a, b) in windows() {
            checkpoint()?;
            let s = store.read(a, b)?;
            meter.push(&s.channels());
        }
        Ok(meter.integrated())
    };
    let mut input_lufs = None;
    let mut static_gain_db = 0.0;
    for _ in 0..PASSES {
        let now = measure(&cur, checkpoint)?;
        input_lufs.get_or_insert(now);
        // 与 normalize_to_lufs 同：静音或不足 400 ms 不动。
        let gain = (now > SILENCE_LUFS).then(|| target.lufs - now);
        static_gain_db += gain.unwrap_or(0.0);
        let mut next = Store::new(streamed)?;
        for (a, b) in windows() {
            checkpoint()?;
            let (ca, cb) = (a.saturating_sub(ctx), (b + ctx).min(frames));
            let mut s = cur.read(ca, cb)?;
            if let Some(g) = gain {
                s.scale(db_to_gain(g));
            }
            let curve = limiter_gain(&s.channels(), sr, lim);
            let (lo, hi) = ((a - ca) as usize, (b - ca) as usize);
            let mut core = Stereo {
                l: s.l[lo..hi].to_vec(),
                r: s.r[lo..hi].to_vec(),
            };
            let g: Vec<f32> = curve[lo..hi].iter().map(|v| *v as f32).collect();
            core.apply_gain(&g);
            next.append(&interleave(&core))?;
        }
        cur = next;
    }
    // 静态兜底：整片真峰值（每侧带过采样上下文）。
    let mut peak = 0.0f64;
    let pc = PEAK_CONTEXT as u64;
    for (a, b) in windows() {
        checkpoint()?;
        let (ca, cb) = (a.saturating_sub(pc), (b + pc).min(frames));
        let s = cur.read(ca, cb)?;
        let (lo, hi) = ((a - ca) as usize, (b - ca) as usize);
        for ch in s.channels() {
            peak = oversampled_peaks(ch)[lo..hi]
                .iter()
                .fold(peak, |m, v| m.max(*v));
        }
    }
    let tp = gain_to_db(peak);
    let trim = (tp > target.true_peak).then(|| target.true_peak - tp - 0.001);
    let mut meter = Meter::new(2, sr);
    for (a, b) in windows() {
        checkpoint()?;
        let mut s = cur.read(a, b)?;
        if let Some(g) = trim {
            s.scale(db_to_gain(g));
        }
        meter.push(&s.channels());
        let mut x = interleave(&s);
        for v in &mut x {
            *v = v.clamp(-1.0, 1.0);
        }
        out(&x).context("写出母带后的混音")?;
    }
    Ok(MasterMeasure {
        input_lufs: input_lufs.unwrap_or(SILENCE_LUFS),
        lufs: meter.integrated(),
        true_peak: tp + trim.unwrap_or(0.0),
        static_gain_db,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use audio_dsp::loudness::normalize_to_lufs;
    use audio_dsp::truepeak::{limit, trim_to_ceiling, true_peak_db};

    fn noise(n: usize, seed: u64) -> Vec<f32> {
        let mut rng = audio_dsp::rng::Rng::new(seed);
        rng.normals(n).into_iter().map(|v| v * 0.3).collect()
    }

    #[test]
    fn windowed_master_matches_whole_signal_chain_bit_for_bit() {
        let n = 3 * 48_000 + 1234;
        let env = |i: usize| if (i / 7000) % 3 == 0 { 1.6 } else { 0.1 };
        let mut s = Stereo {
            l: noise(n, 3)
                .into_iter()
                .enumerate()
                .map(|(i, v)| v * env(i))
                .collect(),
            r: noise(n, 4),
        };
        let target = MasterTarget {
            lufs: -16.0,
            true_peak: -1.2,
        };
        let pre = interleave(&s);
        // 参考：整条信号一次算。
        let lim = Limiter {
            ceiling_db: target.true_peak - 0.1,
            ..Limiter::default()
        };
        for _ in 0..PASSES {
            normalize_to_lufs(&mut s, 48_000.0, target.lufs);
            limit(&mut s, 48_000.0, lim);
        }
        trim_to_ceiling(&mut s, target.true_peak);
        let expected: Vec<f32> = interleave(&s)
            .into_iter()
            .map(|v| v.clamp(-1.0, 1.0))
            .collect();

        for streamed in [false, true] {
            let mut store = Store::new(streamed).unwrap();
            store.append(&pre).unwrap();
            let mut got = Vec::new();
            let m = master_store(
                store,
                n as u64,
                target,
                streamed,
                4800 * 3,
                &mut |x| {
                    got.extend_from_slice(x);
                    Ok(())
                },
                &mut || Ok(()),
            )
            .unwrap();
            assert_eq!(got, expected, "streamed={streamed}");
            assert!((m.lufs - target.lufs).abs() < 0.5, "{m:?}");
            assert!(m.true_peak <= target.true_peak + 1e-6, "{m:?}");
            assert!(true_peak_db(&s.channels()) <= target.true_peak + 1e-6);
        }
    }
}
