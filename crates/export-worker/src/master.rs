//! 响度母带（架构设计 §9.13）：`export-worker master <input.json>` 把混好的整段声音（staging 里 32 位浮点的 WAV）做成
//! 目标响度，写成 staging 里的 32 位浮点裸 PCM（交错，`f32le`），再由 Runtime 交给 ffmpeg 编码。
//!
//! 链是 v2 导出母带的同一条（`bcut-render` 的 `chain::master_store`）：响度归一（BS.1770 积分响度，静音或不足 400 ms
//! 不动）→ 真峰值限幅（上限是目标真峰值 − 0.1 dB），交替三轮；最后按 4 倍过采样的真峰值静态兜底到目标真峰值以下，
//! 夹到 [−1, 1]。全程是 `audio-dsp` 的纯函数，超越函数只走 libm：同一份混音在各平台得到逐位相同的样本。
//!
//! 整段按固定长度的窗口流式处理，内存与时长无关：响度计跨窗延续状态，限幅器每侧带 [`limiter_context`] 个采样的上下文，
//! 真峰值每侧带 [`PEAK_CONTEXT`]；分窗的结果与对整段一次算逐位相同（本文件的测试对拍）。每一轮的中间结果写成 staging 里的
//! 文件，用完删掉。v2 只有 48 kHz 立体声；这里按输出的采样率与声道数算，单声道按一个声道测响度（与 ffmpeg `ebur128` 相同）。
//!
//! stdout 是 JSON 行：`progress`（已处理的采样帧数与总数，三轮的测量与处理、峰值扫描与写出都算在内），最后一行
//! `mastered`（`inputLufs`、`lufs`、`truePeak`、`staticGainDb`）、`error` 或 `cancelled`。

use std::fs::File;
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::atomic::Ordering;
use std::time::Instant;

use audio_dsp::loudness::{Meter, SILENCE_LUFS};
use audio_dsp::math::{db_to_gain, gain_to_db};
use audio_dsp::truepeak::{Limiter, PEAK_CONTEXT, limiter_context, limiter_gain, oversampled_peaks};
use serde::Deserialize;
use serde_json::json;

use crate::render::{PROGRESS_INTERVAL, watch_cancel};
use crate::{Failure, emit};

/// 归一 + 限幅的轮数。
const PASSES: usize = 3;
/// 目标积分响度与真峰值的范围（v2 `bcut export --loudness / --true-peak`）。
pub const LUFS_RANGE: (f64, f64) = (-70.0, 0.0);
pub const TRUE_PEAK_RANGE: (f64, f64) = (-20.0, 0.0);

/// 母带的目标。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Target {
    /// 积分响度（LUFS）。
    pub lufs: f64,
    /// 真峰值上限（dBTP）。
    pub true_peak: f64,
}

/// 母带实测。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Measure {
    /// 母带前的积分响度（LUFS）；测不出（静音或不足 400 ms）时是 [`SILENCE_LUFS`]。
    pub input_lufs: f64,
    /// 母带后的积分响度（LUFS）。
    pub lufs: f64,
    /// 母带后的真峰值（dBTP）。
    pub true_peak: f64,
    /// 各轮响度归一的静态增益之和（dB）。
    pub static_gain_db: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MasterInput {
    /// 混音：32 位浮点的 WAV。
    input: PathBuf,
    /// 写出的裸 PCM（`f32le`，交错）。
    output: PathBuf,
    /// 中间文件放在这里（任务的 staging）。
    staging: PathBuf,
    sample_rate: u32,
    channels: usize,
    lufs: f64,
    true_peak: f64,
}

fn invalid(message: impl Into<String>) -> Failure {
    Failure::new("INVALID_PARAMS", message)
}

fn io_failure(what: &str, error: std::io::Error) -> Failure {
    Failure::new("EXPORT_RENDER_FAILED", format!("{what}：{error}"))
}

/// 声道分开的一段样本。
struct Planes(Vec<Vec<f32>>);

impl Planes {
    fn from_interleaved(x: &[f32], channels: usize) -> Planes {
        Planes(
            (0..channels)
                .map(|c| x.iter().skip(c).step_by(channels).copied().collect())
                .collect(),
        )
    }

    fn interleaved(&self) -> Vec<f32> {
        let n = self.0.first().map_or(0, Vec::len);
        let mut out = Vec::with_capacity(n * self.0.len());
        for i in 0..n {
            for c in &self.0 {
                out.push(c[i]);
            }
        }
        out
    }

    fn refs(&self) -> Vec<&[f32]> {
        self.0.iter().map(Vec::as_slice).collect()
    }

    /// 各声道乘 `g`（与 `Stereo::scale` 同式）。
    fn scale(&mut self, g: f64) {
        for v in self.0.iter_mut().flatten() {
            *v = (*v as f64 * g) as f32;
        }
    }

    /// `[lo, hi)` 这一段乘增益曲线（与 `Stereo::apply_gain` 同式）。
    fn slice_with_gain(&self, lo: usize, hi: usize, gain: &[f64]) -> Planes {
        let g: Vec<f32> = gain[lo..hi].iter().map(|v| *v as f32).collect();
        Planes(
            self.0
                .iter()
                .map(|c| c[lo..hi].iter().zip(&g).map(|(v, g)| *v * *g).collect())
                .collect(),
        )
    }
}

/// 整段的交错样本：内存里、staging 里的裸 `f32le` 文件、或 WAV 文件的数据块。
enum Store {
    /// 内存里的整段：测试拿它与写文件的路径对拍。
    #[cfg_attr(not(test), allow(dead_code))]
    Mem(Vec<f32>),
    File {
        path: PathBuf,
        /// 数据从这个字节开始。
        offset: u64,
        writer: Option<BufWriter<File>>,
        /// 母带自己建的中间文件：用完删掉。输入的混音不归这里删。
        owned: bool,
    },
}

impl Store {
    fn file(path: PathBuf) -> Result<Store, Failure> {
        let writer = BufWriter::new(File::create(&path).map_err(|e| io_failure("建母带的中间文件失败", e))?);
        Ok(Store::File {
            path,
            offset: 0,
            writer: Some(writer),
            owned: true,
        })
    }

    fn append(&mut self, x: &[f32]) -> Result<(), Failure> {
        match self {
            Store::Mem(v) => v.extend_from_slice(x),
            Store::File { writer, .. } => {
                let writer = writer.as_mut().expect("只往没写完的中间文件里追加");
                let mut bytes = Vec::with_capacity(x.len() * 4);
                for s in x {
                    bytes.extend_from_slice(&s.to_le_bytes());
                }
                writer.write_all(&bytes).map_err(|e| io_failure("写母带的中间文件失败", e))?;
            }
        }
        Ok(())
    }

    /// 写完：之后只读。
    fn finish(&mut self) -> Result<(), Failure> {
        if let Store::File { writer, .. } = self
            && let Some(mut w) = writer.take()
        {
            w.flush().map_err(|e| io_failure("写母带的中间文件失败", e))?;
        }
        Ok(())
    }

    /// 帧 `[a, b)` 的交错样本。
    fn read(&self, a: u64, b: u64, channels: usize) -> Result<Vec<f32>, Failure> {
        let (from, to) = (a as usize * channels, b as usize * channels);
        match self {
            Store::Mem(v) => Ok(v[from..to].to_vec()),
            Store::File { path, offset, .. } => {
                let mut file = File::open(path).map_err(|e| io_failure("读母带的输入失败", e))?;
                file.seek(SeekFrom::Start(offset + from as u64 * 4))
                    .map_err(|e| io_failure("读母带的输入失败", e))?;
                let mut bytes = vec![0u8; (to - from) * 4];
                file.read_exact(&mut bytes).map_err(|e| io_failure("读母带的输入失败", e))?;
                Ok(bytes
                    .chunks_exact(4)
                    .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                    .collect())
            }
        }
    }

    fn planes(&self, a: u64, b: u64, channels: usize) -> Result<Planes, Failure> {
        Ok(Planes::from_interleaved(&self.read(a, b, channels)?, channels))
    }

    /// 删掉自己建的中间文件。
    fn discard(self) {
        if let Store::File { path, owned: true, .. } = self {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// 读 32 位浮点 WAV 的格式与数据块：返回数据块的起点与帧数。数据块的长度写成 0 或 `0xFFFFFFFF`、或比文件长时按到文件末尾算。
fn wav_data(path: &Path, sample_rate: u32, channels: usize) -> Result<(u64, u64), Failure> {
    let mut file = File::open(path).map_err(|e| io_failure("读混音失败", e))?;
    let len = file.metadata().map_err(|e| io_failure("读混音失败", e))?.len();
    let mut head = [0u8; 12];
    file.read_exact(&mut head).map_err(|e| io_failure("读混音失败", e))?;
    if &head[0..4] != b"RIFF" || &head[8..12] != b"WAVE" {
        return Err(invalid("混音不是 WAV 文件"));
    }
    let mut at = 12u64;
    let mut format_ok = false;
    loop {
        let mut chunk = [0u8; 8];
        if file.read_exact(&mut chunk).is_err() {
            return Err(invalid("混音的 WAV 没有数据块"));
        }
        let size = u64::from(u32::from_le_bytes([chunk[4], chunk[5], chunk[6], chunk[7]]));
        let body = at + 8;
        match &chunk[0..4] {
            b"fmt " => {
                let mut fmt = vec![0u8; size.min(64) as usize];
                file.read_exact(&mut fmt).map_err(|e| io_failure("读混音失败", e))?;
                if fmt.len() < 16 {
                    return Err(invalid("混音的 WAV 格式块不完整"));
                }
                let tag = u16::from_le_bytes([fmt[0], fmt[1]]);
                let chans = usize::from(u16::from_le_bytes([fmt[2], fmt[3]]));
                let rate = u32::from_le_bytes([fmt[4], fmt[5], fmt[6], fmt[7]]);
                let bits = u16::from_le_bytes([fmt[14], fmt[15]]);
                // 3 是 IEEE 浮点；0xFFFE（WAVE_FORMAT_EXTENSIBLE）时子格式 GUID 的前两个字节是 3。
                let float = tag == 3 || (tag == 0xFFFE && fmt.len() >= 26 && u16::from_le_bytes([fmt[24], fmt[25]]) == 3);
                if !float || bits != 32 || chans != channels || rate != sample_rate {
                    return Err(invalid(format!(
                        "混音不是 {sample_rate} Hz、{channels} 声道的 32 位浮点 WAV（格式 {tag}、{bits} 位、{chans} 声道、{rate} Hz）"
                    )));
                }
                format_ok = true;
            }
            b"data" => {
                if !format_ok {
                    return Err(invalid("混音的 WAV 在格式块之前就是数据块"));
                }
                let rest = len.saturating_sub(body);
                let bytes = if size == 0 || size == u64::from(u32::MAX) || size > rest {
                    rest
                } else {
                    size
                };
                return Ok((body, bytes / (4 * channels as u64)));
            }
            _ => {}
        }
        // 块按偶数字节对齐。
        at = body + size + (size & 1);
        file.seek(SeekFrom::Start(at)).map_err(|e| io_failure("读混音失败", e))?;
    }
}

/// 分窗母带：与对整段跑 `(归一 → 限幅) × 3 → 静态兜底` 逐位相同。`input` 是母带前的整段，`scratch(k)` 给第 k 轮的
/// 中间存放处，`out` 逐窗收下结果（交错，已夹到 [−1, 1]），`step(n)` 报告处理了 n 帧（取消时返回 `Err`）。
#[allow(clippy::too_many_arguments)]
fn master_store(
    input: Store,
    frames: u64,
    channels: usize,
    sr: f64,
    target: Target,
    window: u64,
    scratch: &mut dyn FnMut(usize) -> Result<Store, Failure>,
    out: &mut dyn FnMut(&[f32]) -> Result<(), Failure>,
    step: &mut dyn FnMut(u64) -> Result<(), Failure>,
) -> Result<Measure, Failure> {
    let lim = Limiter {
        ceiling_db: target.true_peak - 0.1,
        ..Limiter::default()
    };
    let ctx = limiter_context(sr, lim) as u64;
    let windows = || (0..frames).step_by(window as usize).map(move |a| (a, (a + window).min(frames)));
    let measure = |store: &Store, step: &mut dyn FnMut(u64) -> Result<(), Failure>| -> Result<f64, Failure> {
        let mut meter = Meter::new(channels, sr);
        for (a, b) in windows() {
            meter.push(&store.planes(a, b, channels)?.refs());
            step(b - a)?;
        }
        Ok(meter.integrated())
    };
    let mut cur = input;
    let mut input_lufs = None;
    let mut static_gain_db = 0.0;
    for pass in 0..PASSES {
        let now = measure(&cur, step)?;
        input_lufs.get_or_insert(now);
        // 与 normalize_to_lufs 同：静音或不足 400 ms 不动。
        let gain = (now > SILENCE_LUFS).then_some(target.lufs - now);
        static_gain_db += gain.unwrap_or(0.0);
        let mut next = scratch(pass)?;
        for (a, b) in windows() {
            let (ca, cb) = (a.saturating_sub(ctx), (b + ctx).min(frames));
            let mut s = cur.planes(ca, cb, channels)?;
            if let Some(g) = gain {
                s.scale(db_to_gain(g));
            }
            let curve = limiter_gain(&s.refs(), sr, lim);
            let core = s.slice_with_gain((a - ca) as usize, (b - ca) as usize, &curve);
            next.append(&core.interleaved())?;
            step(b - a)?;
        }
        next.finish()?;
        cur.discard();
        cur = next;
    }
    // 静态兜底：整段真峰值（每侧带过采样上下文）。
    let mut peak = 0.0f64;
    let pc = PEAK_CONTEXT as u64;
    for (a, b) in windows() {
        let (ca, cb) = (a.saturating_sub(pc), (b + pc).min(frames));
        let s = cur.planes(ca, cb, channels)?;
        let (lo, hi) = ((a - ca) as usize, (b - ca) as usize);
        for ch in s.refs() {
            peak = oversampled_peaks(ch)[lo..hi].iter().fold(peak, |m, v| m.max(*v));
        }
        step(b - a)?;
    }
    let tp = gain_to_db(peak);
    let trim = (tp > target.true_peak).then_some(target.true_peak - tp - 0.001);
    let mut meter = Meter::new(channels, sr);
    for (a, b) in windows() {
        let mut s = cur.planes(a, b, channels)?;
        if let Some(g) = trim {
            s.scale(db_to_gain(g));
        }
        meter.push(&s.refs());
        let mut x = s.interleaved();
        for v in &mut x {
            *v = v.clamp(-1.0, 1.0);
        }
        out(&x)?;
        step(b - a)?;
    }
    cur.discard();
    Ok(Measure {
        input_lufs: input_lufs.unwrap_or(SILENCE_LUFS),
        lufs: meter.integrated(),
        true_peak: tp + trim.unwrap_or(0.0),
        static_gain_db,
    })
}

/// 整段处理几遍（进度的总量 = 帧数 × 遍数）：每轮测量与处理各一遍，峰值扫描与写出各一遍。
const SWEEPS: u64 = 2 * PASSES as u64 + 2;

pub fn run(path: &Path) -> Result<ExitCode, Failure> {
    let cancel = watch_cancel();
    let text = std::fs::read_to_string(path).map_err(|e| invalid(format!("读母带输入失败：{e}")))?;
    let input: MasterInput = serde_json::from_str(&text).map_err(|e| invalid(format!("母带输入读不懂：{e}")))?;
    if !(LUFS_RANGE.0..=LUFS_RANGE.1).contains(&input.lufs) || !(TRUE_PEAK_RANGE.0..=TRUE_PEAK_RANGE.1).contains(&input.true_peak) {
        return Err(invalid(format!(
            "母带目标越界：响度 {} LUFS（−70 到 0）、真峰值 {} dBTP（−20 到 0）",
            input.lufs, input.true_peak
        )));
    }
    if !matches!(input.channels, 1 | 2) || input.sample_rate == 0 {
        return Err(invalid(format!(
            "母带只做单声道或立体声：{} 声道、{} Hz",
            input.channels, input.sample_rate
        )));
    }
    let channels = input.channels;
    let (offset, frames) = wav_data(&input.input, input.sample_rate, channels)?;
    let source = Store::File {
        path: input.input.clone(),
        offset,
        writer: None,
        owned: false,
    };
    let stem = input
        .output
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut scratch_paths: Vec<PathBuf> = Vec::new();
    let mut scratch = |pass: usize| {
        let path = input.staging.join(format!("{stem}.pass{}.f32", pass + 1));
        scratch_paths.push(path.clone());
        Store::file(path)
    };
    let mut writer = BufWriter::new(File::create(&input.output).map_err(|e| io_failure("建母带的输出失败", e))?);
    let mut out = |x: &[f32]| -> Result<(), Failure> {
        let mut bytes = Vec::with_capacity(x.len() * 4);
        for s in x {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        writer.write_all(&bytes).map_err(|e| io_failure("写母带的输出失败", e))
    };
    let total = frames * SWEEPS;
    let mut done = 0u64;
    let mut last = Instant::now();
    emit(&json!({ "event": "progress", "frame": 0, "total": total }));
    let mut step = |n: u64| -> Result<(), Failure> {
        done += n;
        if cancel.load(Ordering::SeqCst) {
            return Err(Failure::new("CANCELLED", "已取消"));
        }
        if last.elapsed() >= PROGRESS_INTERVAL {
            last = Instant::now();
            emit(&json!({ "event": "progress", "frame": done, "total": total }));
        }
        Ok(())
    };
    let target = Target {
        lufs: input.lufs,
        true_peak: input.true_peak,
    };
    let sr = f64::from(input.sample_rate);
    let window = 4 * u64::from(input.sample_rate);
    let result = master_store(source, frames, channels, sr, target, window, &mut scratch, &mut out, &mut step);
    let result = result.and_then(|m| writer.flush().map(|()| m).map_err(|e| io_failure("写母带的输出失败", e)));
    for path in &scratch_paths {
        let _ = std::fs::remove_file(path);
    }
    match result {
        Ok(m) => {
            emit(&json!({
                "event": "mastered",
                "frames": frames,
                "inputLufs": m.input_lufs,
                "lufs": m.lufs,
                "truePeak": m.true_peak,
                "staticGainDb": m.static_gain_db,
            }));
            Ok(ExitCode::SUCCESS)
        }
        Err(failure) => {
            let _ = std::fs::remove_file(&input.output);
            if failure.code == "CANCELLED" {
                emit(&json!({ "event": "cancelled", "frame": done.min(total), "total": total }));
                return Ok(ExitCode::from(3));
            }
            Err(failure)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use audio_dsp::loudness::normalize_to_lufs;
    use audio_dsp::stereo::Stereo;
    use audio_dsp::truepeak::{limit, trim_to_ceiling, true_peak_db};

    fn noise(n: usize, seed: u64) -> Vec<f32> {
        let mut rng = audio_dsp::rng::Rng::new(seed);
        rng.normals(n).into_iter().map(|v| v * 0.3).collect()
    }

    /// 跑一遍分窗母带：`streamed` 时输入与中间结果都是临时目录里的文件。
    fn run_store(pre: &[f32], channels: usize, sr: f64, target: Target, window: u64, streamed: bool) -> (Vec<f32>, Measure) {
        let dir = tempfile::tempdir().unwrap();
        let frames = (pre.len() / channels) as u64;
        let input = if streamed {
            let mut store = Store::file(dir.path().join("in.f32")).unwrap();
            store.append(pre).unwrap();
            store.finish().unwrap();
            store
        } else {
            Store::Mem(pre.to_vec())
        };
        let mut got = Vec::new();
        let mut scratch = |pass: usize| {
            if streamed {
                Store::file(dir.path().join(format!("pass{pass}.f32")))
            } else {
                Ok(Store::Mem(Vec::new()))
            }
        };
        let m = master_store(
            input,
            frames,
            channels,
            sr,
            target,
            window,
            &mut scratch,
            &mut |x| {
                got.extend_from_slice(x);
                Ok(())
            },
            &mut |_| Ok(()),
        )
        .unwrap();
        if streamed {
            // 中间文件用完就删。
            let left: Vec<_> = std::fs::read_dir(dir.path()).unwrap().collect();
            assert!(left.is_empty(), "{left:?}");
        }
        (got, m)
    }

    #[test]
    fn windowed_master_matches_whole_signal_chain_bit_for_bit() {
        let n = 3 * 48_000 + 1234;
        let env = |i: usize| if (i / 7000).is_multiple_of(3) { 1.6 } else { 0.1 };
        let mut s = Stereo {
            l: noise(n, 3).into_iter().enumerate().map(|(i, v)| v * env(i)).collect(),
            r: noise(n, 4),
        };
        let target = Target {
            lufs: -16.0,
            true_peak: -1.2,
        };
        let pre = s.interleaved();
        // 参考：v2 的整段一次算。
        let lim = Limiter {
            ceiling_db: target.true_peak - 0.1,
            ..Limiter::default()
        };
        for _ in 0..PASSES {
            normalize_to_lufs(&mut s, 48_000.0, target.lufs);
            limit(&mut s, 48_000.0, lim);
        }
        trim_to_ceiling(&mut s, target.true_peak);
        let expected: Vec<f32> = s.interleaved().into_iter().map(|v| v.clamp(-1.0, 1.0)).collect();
        // 窗口长不必是 10 ms 的整数倍：响度计逐样本延续状态。
        for (streamed, window) in [(false, 4800 * 3), (true, 4800 * 3), (true, 7777)] {
            let (got, m) = run_store(&pre, 2, 48_000.0, target, window, streamed);
            assert_eq!(got, expected, "streamed={streamed} window={window}");
            assert!((m.lufs - target.lufs).abs() < 0.5, "{m:?}");
            assert!(m.true_peak <= target.true_peak + 1e-6, "{m:?}");
            assert!(true_peak_db(&s.channels()) <= target.true_peak + 1e-6);
        }
    }

    /// v2 `export_loudness_masters_the_mix_and_refuses_the_ffmpeg_fallback` 的母带部分：两秒 440 Hz 立体声正弦，峰值 0.9，
    /// 响度远高于 −20 LUFS；母带后到目标，真峰值不过上限，再跑一遍逐位相同。
    #[test]
    fn a_loud_tone_lands_on_the_target() {
        let target = Target {
            lufs: -20.0,
            true_peak: -2.0,
        };
        let tone: Vec<f32> = (0..96_000)
            .flat_map(|i| {
                let v = (0.9 * (std::f64::consts::TAU * 440.0 * i as f64 / 48_000.0).sin()) as f32;
                [v, v]
            })
            .collect();
        let (out, m) = run_store(&tone, 2, 48_000.0, target, 4 * 48_000, true);
        assert!((m.lufs - target.lufs).abs() < 0.5, "{m:?}");
        assert!(m.true_peak <= target.true_peak + 0.05, "{m:?}");
        assert!(m.input_lufs > m.lufs);
        let (again, _) = run_store(&tone, 2, 48_000.0, target, 4 * 48_000, false);
        assert_eq!(out, again);
    }

    /// 单声道、44.1 kHz：按一个声道测响度，与整段一次算（同一组函数）逐位相同。
    #[test]
    fn mono_masters_against_its_own_whole_signal_reference() {
        let sr = 44_100.0;
        let n = 2 * 44_100 + 777;
        let mut x: Vec<f32> = noise(n, 9)
            .into_iter()
            .enumerate()
            .map(|(i, v)| if i % 9000 < 3000 { v * 2.5 } else { v * 0.05 })
            .collect();
        let target = Target {
            lufs: -18.0,
            true_peak: -1.0,
        };
        let pre = x.clone();
        let lim = Limiter {
            ceiling_db: target.true_peak - 0.1,
            ..Limiter::default()
        };
        for _ in 0..PASSES {
            let now = audio_dsp::loudness::integrated(&[&x], sr);
            if now > SILENCE_LUFS {
                let g = db_to_gain(target.lufs - now);
                for v in &mut x {
                    *v = (*v as f64 * g) as f32;
                }
            }
            let curve = limiter_gain(&[&x], sr, lim);
            for (v, g) in x.iter_mut().zip(curve) {
                *v *= g as f32;
            }
        }
        let tp = true_peak_db(&[&x]);
        if tp > target.true_peak {
            let g = db_to_gain(target.true_peak - tp - 0.001);
            for v in &mut x {
                *v = (*v as f64 * g) as f32;
            }
        }
        let expected: Vec<f32> = x.iter().map(|v| v.clamp(-1.0, 1.0)).collect();
        let (got, m) = run_store(&pre, 1, sr, target, 4 * 44_100, true);
        assert_eq!(got, expected);
        assert!((m.lufs - target.lufs).abs() < 0.5, "{m:?}");
        assert!(m.true_peak <= target.true_peak + 1e-6, "{m:?}");
    }

    /// 静音：测不出响度，不加增益，照样写出（全是 0）。
    #[test]
    fn silence_is_not_normalized() {
        let (out, m) = run_store(
            &vec![0.0; 2 * 48_000],
            2,
            48_000.0,
            Target {
                lufs: -16.0,
                true_peak: -1.2,
            },
            48_000,
            false,
        );
        assert_eq!(m.input_lufs, SILENCE_LUFS);
        assert_eq!(m.static_gain_db, 0.0);
        assert!(out.iter().all(|v| *v == 0.0));
    }

    /// 读 ffmpeg 写的浮点 WAV（含 EXTENSIBLE）：格式不符时拒绝；数据块长度写坏时按到文件末尾算。
    #[test]
    fn reads_float_wav_headers() {
        let dir = tempfile::tempdir().unwrap();
        let wav = |tag: u16, data_size: u32, samples: usize| {
            let mut fmt = Vec::new();
            fmt.extend_from_slice(&tag.to_le_bytes());
            fmt.extend_from_slice(&2u16.to_le_bytes());
            fmt.extend_from_slice(&48_000u32.to_le_bytes());
            fmt.extend_from_slice(&(48_000u32 * 8).to_le_bytes());
            fmt.extend_from_slice(&8u16.to_le_bytes());
            fmt.extend_from_slice(&32u16.to_le_bytes());
            if tag == 0xFFFE {
                fmt.extend_from_slice(&22u16.to_le_bytes());
                fmt.extend_from_slice(&32u16.to_le_bytes());
                fmt.extend_from_slice(&3u32.to_le_bytes());
                fmt.extend_from_slice(&3u16.to_le_bytes());
                fmt.extend_from_slice(&[0u8; 14]);
            }
            let mut bytes = b"RIFF\0\0\0\0WAVE".to_vec();
            bytes.extend_from_slice(b"LIST");
            bytes.extend_from_slice(&3u32.to_le_bytes());
            bytes.extend_from_slice(b"abc\0");
            bytes.extend_from_slice(b"fmt ");
            bytes.extend_from_slice(&(fmt.len() as u32).to_le_bytes());
            bytes.extend_from_slice(&fmt);
            bytes.extend_from_slice(b"data");
            bytes.extend_from_slice(&data_size.to_le_bytes());
            bytes.extend(std::iter::repeat_n(0u8, samples * 4));
            bytes
        };
        let path = dir.path().join("mix.wav");
        std::fs::write(&path, wav(3, 80, 20)).unwrap();
        let (offset, frames) = wav_data(&path, 48_000, 2).unwrap();
        assert_eq!((offset, frames), (12 + 12 + 8 + 16 + 8, 10));
        std::fs::write(&path, wav(0xFFFE, u32::MAX, 20)).unwrap();
        assert_eq!(wav_data(&path, 48_000, 2).unwrap().1, 10);
        assert!(wav_data(&path, 44_100, 2).is_err());
        assert!(wav_data(&path, 48_000, 1).is_err());
        std::fs::write(&path, wav(1, 80, 20)).unwrap();
        assert!(wav_data(&path, 48_000, 2).is_err());
    }
}
