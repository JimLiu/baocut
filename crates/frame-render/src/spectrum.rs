//! 声波实例的声音（格式规范 §3.7）：把素材的频谱（BCS1，按素材的源时间排）按序列的声音计划拼成这个实例在序列时间上的
//! 一条频谱，第 k 帧是序列时刻 `k / 60` 听到的声音，内核按序列时刻取样。
//!
//! - `audio: 'project'`（缺省）是这条序列混好的声音：每一刻在响的每一段声音（[`render_graph::audio_plan`]，与导出的混音
//!   同一份计划：增益、淡变、交叉淡化与闪避都算进去，按文稿触发的闪避除外）取它源时刻的那一帧，频域按功率相加、时域按
//!   振幅相加；
//! - `audio` 是一个素材 ID 时只听这个素材：每一刻取正在播它的那一段的源时刻（两段相接时取后一段），不乘增益；这一刻没有
//!   在播它就是静音；
//! - 素材频谱按素材版本算一次（导出由 Render Worker 解码素材文件，预览由界面解码后经预览 WASM 算），拼接只是查表，
//!   预览与导出用同一份代码。
//!
//! 频谱的 dB 是 BCS1 的 canonical 窗（[-120, 40]），字节 0 当作没有能量。
//!
//! 说话人与显隐（§3.7 的 `speaker`、`alwaysShow`）在派生好的轨上做（[`gate`]、[`audible_frames`]），规则见
//! [`SPEAKER_HOLD`]。

use std::collections::BTreeMap;

use render_graph::audio_plan::AudioSegment;
use render_raster::source::{VizSource, VizTrack};
use video_model::VersionRef;
use waveform::Fnv1a64;
use waveform::bcs1::{
    self, ANALYSIS_RATE, Bcs1Header, CANONICAL_MAX_DB, CANONICAL_MIN_DB, FRAME_LEN, FREQ_BINS, SpectrumBackend, TIME_BINS,
};
use waveform::remap::canonical_db;

/// 声波听哪一路声音。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Route {
    /// 这条序列混好的声音。
    Project,
    /// 只听这个素材。
    Asset(String),
}

impl Route {
    pub fn of(audio: &str) -> Route {
        if audio == "project" {
            Route::Project
        } else {
            Route::Asset(audio.to_string())
        }
    }
}

/// 素材频谱的键：`素材ID@版本`。
pub fn asset_key(asset: &VersionRef) -> String {
    format!("{}@{}", asset.id, asset.revision)
}

/// `route` 在序列时间 `[start, end)` 里要用到的声音段（序列时间从 0 起，即整条序列的声音计划）。
pub fn segments_for<'a>(segments: &'a [AudioSegment], route: &Route, start: f64, end: f64) -> Vec<&'a AudioSegment> {
    segments
        .iter()
        .filter(|s| s.end > start && s.start < end && s.end > s.start)
        .filter(|s| match route {
            Route::Project => true,
            Route::Asset(id) => s.asset.id == *id,
        })
        .collect()
}

/// 要读的素材频谱（去重，按键排）。
pub fn sources_of(segments: &[&AudioSegment]) -> Vec<VersionRef> {
    let mut seen = BTreeMap::new();
    for segment in segments {
        seen.entry(asset_key(&segment.asset)).or_insert_with(|| segment.asset.clone());
    }
    seen.into_values().collect()
}

/// 每位说话人在序列上说话的区间（秒，按开始时刻排；`render_graph::audio_plan::speaker_activity`）。
pub type SpeakerActivity = BTreeMap<String, Vec<(f64, f64)>>;

/// 说话人与 `alwaysShow: false` 的保持时间（秒）：同一位说话人的两个词相隔不超过它就当作一直在说（与按文稿触发的
/// 闪避合并触发区间的下限相同）；`alwaysShow: false` 的声波静了这么久才隐去，一出声就出现。
pub const SPEAKER_HOLD: f64 = 0.5;

/// 一位说话人的词区间并成说话的段：相隔不超过 [`SPEAKER_HOLD`] 的接起来。
pub fn speaking_spans(intervals: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let mut sorted: Vec<(f64, f64)> = intervals.iter().copied().filter(|(s, e)| e > s).collect();
    sorted.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut spans: Vec<(f64, f64)> = Vec::new();
    for (start, end) in sorted {
        match spans.last_mut() {
            Some(last) if start - last.1 <= SPEAKER_HOLD => last.1 = last.1.max(end),
            _ => spans.push((start, end)),
        }
    }
    spans
}

/// 只留说话的段里的帧（第 k 帧在序列时刻 `k / 分析帧率`，落在某段 `[start, end)` 里），其余换成静音帧
/// （[`VizTrack::silent_frame`]）。`spans` 为 `None` 时整条都是静音。
pub fn gate(track: &VizTrack, spans: Option<&[(f64, f64)]>) -> Option<VizTrack> {
    let rate = f64::from(track.analysis_rate());
    let silent = track.silent_frame();
    let frames = (0..track.frame_count())
        .map(|k| {
            let t = k as f64 / rate;
            let speaking = spans.is_some_and(|spans| spans.iter().any(|(s, e)| *s <= t && t < *e));
            match track.frame(k) {
                Some(frame) if speaking => frame.clone(),
                _ => silent.clone(),
            }
        })
        .collect();
    // 内容指纹由帧算出（来源的 hash 只是其中一项），这里没有单独的来源。
    VizTrack::assemble(track.analysis_rate(), frames, track.params(), 0).ok()
}

/// 每一帧算不算有声（`alwaysShow: false` 时只画有声的帧）：这一帧或它之前 [`SPEAKER_HOLD`] 之内有一帧的频域行
/// 不全是 0。
pub fn audible_frames(track: &VizTrack) -> Vec<bool> {
    let hold = (SPEAKER_HOLD * f64::from(track.analysis_rate())).round() as usize;
    let mut last: Option<usize> = None;
    (0..track.frame_count())
        .map(|k| {
            if track.frame(k).is_some_and(|frame| frame.freq.iter().any(|&b| b != 0)) {
                last = Some(k);
            }
            last.is_some_and(|at| k - at <= hold)
        })
        .collect()
}

/// 拼出 `route` 在序列时间 `[start, end)` 上的频谱（BCS1，第 k 帧是序列时刻 `k / 60`；`start` 之前的帧是静音）。
/// `sources` 按 [`asset_key`] 给素材频谱，必须包含 [`sources_of`] 列出的每一份；读不懂的素材频谱是错误。
pub fn compose(
    segments: &[&AudioSegment],
    route: &Route,
    start: f64,
    end: f64,
    sources: &BTreeMap<String, Vec<u8>>,
) -> Result<Vec<u8>, String> {
    let mut views = BTreeMap::new();
    for segment in segments {
        let key = asset_key(&segment.asset);
        if views.contains_key(&key) {
            continue;
        }
        let bytes = sources.get(&key).ok_or_else(|| format!("没有素材 {key} 的频谱"))?;
        let view = bcs1::parse(bytes).map_err(|e| format!("素材 {key} 的频谱读不懂：{e:#}"))?;
        views.insert(key, view);
    }
    let rate = f64::from(ANALYSIS_RATE);
    let frames = ((end.max(0.0) * rate).ceil() as usize).max(1);
    let first = ((start.max(0.0) * rate).floor() as usize).min(frames);
    let mut payload = vec![0u8; frames * FRAME_LEN];
    for frame in payload.chunks_exact_mut(FRAME_LEN) {
        frame[..TIME_BINS as usize].fill(128);
    }
    let mut power = vec![0f64; FREQ_BINS as usize];
    let mut wave = vec![0f64; TIME_BINS as usize];
    for k in first..frames {
        let t = k as f64 / rate;
        let out = &mut payload[k * FRAME_LEN..(k + 1) * FRAME_LEN];
        match route {
            Route::Asset(_) => {
                // 两段相接（或交叉淡化重叠）时取后开始的一段。
                let Some(segment) = segments
                    .iter()
                    .filter(|s| s.start <= t && t < s.end)
                    .max_by(|a, b| a.start.total_cmp(&b.start))
                else {
                    continue;
                };
                if let Some(row) = source_frame(&views[&asset_key(&segment.asset)], segment, t) {
                    out.copy_from_slice(row);
                }
            }
            Route::Project => {
                power.fill(0.0);
                wave.fill(0.0);
                let mut any = false;
                for segment in segments.iter().filter(|s| s.start <= t && t < s.end) {
                    let Some(row) = source_frame(&views[&asset_key(&segment.asset)], segment, t) else {
                        continue;
                    };
                    any = true;
                    let gain_db = segment.gain_db_at(t);
                    let amplitude = 10f64.powf(gain_db / 20.0);
                    for (acc, &byte) in wave.iter_mut().zip(&row[..TIME_BINS as usize]) {
                        *acc += (f64::from(byte) - 128.0) * amplitude;
                    }
                    for (acc, &byte) in power.iter_mut().zip(&row[TIME_BINS as usize..]) {
                        if byte > 0 {
                            *acc += 10f64.powf((canonical_db(byte) + gain_db) / 10.0);
                        }
                    }
                }
                if !any {
                    continue;
                }
                for (slot, acc) in out[..TIME_BINS as usize].iter_mut().zip(&wave) {
                    *slot = (128.0 + acc.round()).clamp(0.0, 255.0) as u8;
                }
                for (slot, &p) in out[TIME_BINS as usize..].iter_mut().zip(&power) {
                    *slot = if p > 0.0 { canonical_byte(10.0 * p.log10()) } else { 0 };
                }
            }
        }
    }
    let mut hash = Fnv1a64::new();
    hash.write(b"baocut-visualizer-compose-v1");
    hash.write(&[u8::from(*route == Route::Project)]);
    for segment in segments {
        let header = views[&asset_key(&segment.asset)].header();
        hash.write(&header.content_hash.to_le_bytes());
        for value in [
            segment.start,
            segment.end,
            segment.source_start,
            segment.source_rate,
            segment.gain_db,
        ] {
            hash.write(&value.to_le_bytes());
        }
    }
    let backend = if views.values().any(|v| v.header().backend == SpectrumBackend::Ffmpeg) {
        SpectrumBackend::Ffmpeg
    } else {
        SpectrumBackend::Symphonia
    };
    bcs1::encode(&Bcs1Header::new(backend, frames as u32, hash.finish()), &payload).map_err(|e| format!("{e:#}"))
}

/// 段在序列时刻 `t` 取素材的哪一帧（越过素材末尾时没有）。
fn source_frame<'a>(view: &bcs1::Bcs1View<'a>, segment: &AudioSegment, t: f64) -> Option<&'a [u8]> {
    let source = segment.source_start + (t - segment.start) * segment.source_rate;
    if !source.is_finite() || source < 0.0 {
        return None;
    }
    // 浮点误差不让正好落在帧边界上的时刻掉到前一帧。
    let index = (source * f64::from(view.header().analysis_rate) + 1e-6).floor() as usize;
    view.frame(index)
}

/// dB → canonical 字节（与 BCS1 的分析同一个公式）。
fn canonical_byte(decibels: f64) -> u8 {
    (255.0 * (decibels - CANONICAL_MIN_DB) / (CANONICAL_MAX_DB - CANONICAL_MIN_DB))
        .clamp(0.0, 255.0)
        .round() as u8
}

/// 素材文件 → BCS1：纯 Rust 解码成 48 kHz 单声道，解不了时用 `ffmpeg`（`-ac 1 -ar 48000`）。没有音频是错误。
#[cfg(feature = "host")]
pub fn analyze_file(path: &std::path::Path, ffmpeg: &std::path::Path) -> anyhow::Result<Vec<u8>> {
    use anyhow::Context;
    let (pcm, backend) = match render_raster::audio::decode_mono_48k(path) {
        Ok(pcm) if !pcm.is_empty() => (pcm, SpectrumBackend::Symphonia),
        _ => {
            let output = std::process::Command::new(ffmpeg)
                .args(["-v", "error", "-nostdin", "-i"])
                .arg(path)
                .args(["-vn", "-f", "f32le", "-ac", "1", "-ar", "48000", "-"])
                .stdin(std::process::Stdio::null())
                .output()
                .with_context(|| format!("启动 ffmpeg 解码 {}", path.display()))?;
            if !output.status.success() {
                anyhow::bail!(
                    "ffmpeg 解码 {} 失败：{}",
                    path.display(),
                    String::from_utf8_lossy(&output.stderr).trim()
                );
            }
            let pcm = output
                .stdout
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect();
            (pcm, SpectrumBackend::Ffmpeg)
        }
    };
    waveform::dsp::analyze(&pcm, backend).with_context(|| format!("算 {} 的频谱", path.display()))
}
