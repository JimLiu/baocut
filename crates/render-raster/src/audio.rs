//! 音频混音（规范 §8.4）：clip 解码为 f32 PCM，
//! 音量包络在 Rust 侧逐样施加（sample_frames 纯函数 ⇒ 混音确定性），
//! 多 clip 叠加 → f32le 主混音 → 编码期作为第二输入合流进 MP4。
//!
//! ## 解码后端：常速走 Symphonia、变速留给 ffmpeg（WP6a）
//!
//! - **常速 clip（`rate == 1`）**：[`decode`] 用 Symphonia 解码 + 多相 sinc 重
//!   采样到 48 kHz 立体声，纯 Rust、不起子进程。解不了（容器/编码不支持、
//!   3 声道以上要下混矩阵）就回落 ffmpeg。
//! - **变速 clip（`rate != 1`）**：仍然是 `ffmpeg -filter:a atempo`。保音高时间
//!   拉伸没有可放心接入的纯 Rust 实现：调研过的候选里，`wsola`（唯一纯 Rust 且
//!   质量对得上 atempo 的）只有一个 0.1.0 版本、上游是个人仓库且 crate 包里没
//!   带 LICENSE 文件（crate 元数据写 MIT、仓库写 Apache-2.0）；`signalsmith-
//!   stretch` 质量与性能都更好但是 C++ FFI，会给每个平台的构建加上 C++ 编译器
//!   与 libclang 依赖（Windows CI 的 locked build 首当其冲）；`timestretch` 在
//!   0.25x 上实测半数输出是静音；`rubato` 是采样率转换、根本不保音高。**变速素材
//!   在 BCF 里是少数**，为它引入这些代价不划算，留 ffmpeg 是明确的取舍而不是遗漏。
//!
//! 每个 clip 实际用了哪个后端由 [`mix_audio_reported`] 交出
//! （`docs/design/bcf/baocut-format-spec.md` §15.1「解码后端必须可观测」）。

mod chain;
mod decode;
mod streamed;
pub use chain::MasterMeasure;
pub use streamed::{FileAudioMix, mix_audio_file};

use crate::assets::LoadedAssets;
use anyhow::{Context, Result, anyhow, bail};
use scene_primitives::resolve::Ir;
use scene_primitives::sample::sample_frames;

pub const SAMPLE_RATE: u32 = 48_000;
pub const CHANNELS: usize = 2;

/// 纯 Rust 解码后端标识。
pub const SYMPHONIA_BACKEND: &str = "symphonia";
/// ffmpeg 兜底解码后端标识（与 [`crate::media::FFMPEG_BACKEND`] 同名）。
pub const FFMPEG_BACKEND: &str = "ffmpeg";

/// 一个 audio clip 的解码记录。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClipDecodeRecord {
    pub clip_id: String,
    /// [`SYMPHONIA_BACKEND`] 或 [`FFMPEG_BACKEND`]。
    pub backend: &'static str,
}

/// 一次全片混音的产物。
pub struct AudioMix {
    /// f32le 交错立体声字节。
    pub pcm: Vec<u8>,
    /// 逐 clip 的解码后端（顺序与 `ir.audio_clips` 一致，跳过零时长与静音轨的 clip）。
    pub clips: Vec<ClipDecodeRecord>,
    /// 文档写了 `audio.master` 时的母带实测。
    pub master: Option<MasterMeasure>,
}

/// 这份 IR 要不要走混音链（§4 `audio`、§8.4 淡入淡出 / 声像）。不要时走旧路径，
/// 输出与没有这些字段之前逐位相同。`muted` 的 clip 两条路径都直接跳过。
fn needs_chain(ir: &Ir) -> bool {
    ir.audio.is_some() || ir.audio_clips.iter().any(|c| !c.muted && !c.is_plain())
}

/// 对一段已经混好的整片 PCM（48 kHz 交错立体声 f32）做母带：响度归一与真峰值限幅交替三轮，
/// 再按真峰值静态兜底。`bcut export --loudness / --true-peak` 用它。
pub fn master_interleaved(
    pcm: &[f32],
    target: scene_primitives::audio_mix::MasterTarget,
) -> Result<(Vec<f32>, MasterMeasure)> {
    let frames = (pcm.len() / CHANNELS) as u64;
    let clip = scene_primitives::resolve::AudioClip {
        id: "master".into(),
        asset_id: String::new(),
        start: 0.0,
        end: frames as f64 / SAMPLE_RATE as f64,
        media_start: 0.0,
        rate: 1.0,
        media_duration: 0.0,
        base_volume: 1.0,
        volume: Vec::new(),
        track: None,
        fade_in: 0.0,
        fade_out: 0.0,
        fade_span: (0.0, 0.0),
        pan: 0.0,
        bus: scene_primitives::audio_mix::MAIN_BUS.into(),
        muted: false,
    };
    let clips = [chain::ChainClip {
        clip: &clip,
        pcm: chain::ClipPcm::Mem(pcm.to_vec()),
        frames,
        start: 0,
        audible: true,
    }];
    let mut out = Vec::with_capacity(pcm.len());
    let report = chain::run(
        frames,
        &clips,
        &scene_primitives::audio_mix::DocAudio::default(),
        Some(target),
        false,
        chain::WINDOW,
        &mut |x| {
            out.extend_from_slice(x);
            Ok(())
        },
        &mut || Ok(()),
    )?;
    let measure = report.master.context("母带没有产出实测")?;
    Ok((out, measure))
}

/// 纯 Rust 解码 `path` 的第一条音轨在 `[start, start + duration)` 上的样本，
/// 交出 48 kHz 交错立体声 f32（[`SAMPLE_RATE`] / [`CHANNELS`]）。
///
/// 语义对齐 `ffmpeg -ss <start> -t <duration> -i <src> -f f32le -ac 2 -ar 48000 -`。
/// `Err` 一律代表「这条片源纯 Rust 路径解不了」（容器/编码不支持、3 声道以上要
/// 下混矩阵），调用方据此回落 ffmpeg——**不保音高变速仍然没有纯 Rust 实现**，
/// 变速素材不要送进来。
///
/// 除本模块的混音外，`apps/cli` 的时间轴装配（`services/timeline_media`）也用它
/// 铺主轨与音频元素：两条链路都要「48 kHz 立体声 f32 窗口」，不该各写一份。
pub fn decode_stereo_48k(path: &std::path::Path, start: f64, duration: f64) -> Result<Vec<f32>> {
    decode::decode_stereo_48k(path, start, duration)
}

/// 纯 Rust 解码 `path` 的整条第一音轨，交出 48 kHz 单声道 f32：各声道取平均，单声道源原样。声波的频谱（BCS1）
/// 从它算。`Err` 时调用方回落 ffmpeg。
pub fn decode_mono_48k(path: &std::path::Path) -> Result<Vec<f32>> {
    decode::decode_mono_48k(path)
}

/// 全片混音 → f32le 交错立体声字节。无 audio clip 时返回 None。
pub fn mix_audio(ir: &Ir, assets: &LoadedAssets) -> Result<Option<Vec<u8>>> {
    Ok(mix_audio_reported(ir, assets)?.map(|mix| mix.pcm))
}

/// 同 [`mix_audio`]，另带逐 clip 的解码后端记录。
pub fn mix_audio_reported(ir: &Ir, assets: &LoadedAssets) -> Result<Option<AudioMix>> {
    if ir.audio_clips.is_empty() {
        return Ok(None);
    }
    let sr = SAMPLE_RATE as f64;
    let total_frames = (ir.total * sr).round() as usize;
    let chained = needs_chain(ir);
    let mut master = vec![0f32; if chained { 0 } else { total_frames * CHANNELS }];
    let mut records = Vec::with_capacity(ir.audio_clips.len());
    let mut decoded = Vec::new();

    for clip in &ir.audio_clips {
        if clip.muted {
            continue;
        }
        // withAudio 展开的 clip 引用 video 资产：音轨直接取自视频文件（§6.5）
        let path = assets
            .audios
            .get(&clip.asset_id)
            .or_else(|| assets.videos.get(&clip.asset_id).map(|v| &v.path))
            .ok_or_else(|| anyhow!("音频资源 \"{}\" 未加载", clip.asset_id))?;
        let dur = (clip.end - clip.start).max(0.0);
        if dur <= 0.0 {
            continue;
        }
        let rate = if clip.rate > 0.0 { clip.rate } else { 1.0 };
        // 源侧需要 dur × rate 秒素材（atempo 之后回到 dur 秒）
        let source_seconds = dur * rate;
        let constant_rate = (rate - 1.0).abs() <= 1e-9;
        let (samples, backend) = match constant_rate
            .then(|| decode::decode_stereo_48k(path, clip.media_start, source_seconds))
        {
            Some(Ok(samples)) => (samples, SYMPHONIA_BACKEND),
            // 纯 Rust 解不了（或本来就是变速 clip）：回落 ffmpeg。
            _ => (
                decode_with_ffmpeg(&clip.id, path, clip.media_start, source_seconds, rate)?,
                FFMPEG_BACKEND,
            ),
        };
        records.push(ClipDecodeRecord {
            clip_id: clip.id.clone(),
            backend,
        });
        let clip_frames = samples.len() / CHANNELS;
        let start_frame = (clip.start * sr).round() as usize;
        if chained {
            decoded.push(chain::ChainClip {
                clip,
                frames: clip_frames as u64,
                pcm: chain::ClipPcm::Mem(samples),
                start: start_frame as u64,
                audible: true,
            });
            continue;
        }

        // 音量包络：64 帧（≈1.3ms）一个块采样，块内恒定
        const BLOCK: usize = 64;
        let mut i = 0usize;
        while i < clip_frames {
            let gi = start_frame + i;
            if gi >= total_frames {
                break;
            }
            let t = clip.start + i as f64 / sr;
            let vol = if clip.volume.is_empty() {
                clip.base_volume
            } else {
                sample_frames(&clip.volume, t)
                    .as_f64()
                    .unwrap_or(clip.base_volume)
            } as f32;
            let n = BLOCK.min(clip_frames - i).min(total_frames - gi);
            for k in 0..n * CHANNELS {
                master[gi * CHANNELS + k] += samples[i * CHANNELS + k] * vol;
            }
            i += n;
        }
    }

    if chained {
        let doc = ir.audio.clone().unwrap_or_default();
        let mut bytes = Vec::with_capacity(total_frames * CHANNELS * 4);
        let report = chain::run(
            total_frames as u64,
            &decoded,
            &doc,
            doc.master,
            false,
            chain::WINDOW,
            &mut |x| {
                for s in x {
                    bytes.extend_from_slice(&s.to_le_bytes());
                }
                Ok(())
            },
            &mut || Ok(()),
        )?;
        return Ok(Some(AudioMix {
            pcm: bytes,
            clips: records,
            master: report.master,
        }));
    }
    let mut bytes = Vec::with_capacity(master.len() * 4);
    for s in &master {
        bytes.extend_from_slice(&s.clamp(-1.0, 1.0).to_le_bytes());
    }
    Ok(Some(AudioMix {
        pcm: bytes,
        clips: records,
        master: None,
    }))
}

/// ffmpeg 兜底解码：`-ss`/`-t` 截窗，变速时叠 `atempo`，输出 48 kHz 立体声 f32。
fn decode_with_ffmpeg(
    clip_id: &str,
    path: &std::path::Path,
    media_start: f64,
    source_seconds: f64,
    rate: f64,
) -> Result<Vec<f32>> {
    let out = ffmpeg_decode_command(path, media_start, source_seconds, rate)
        .output()
        .context("启动 ffmpeg 音频解码失败")?;
    if !out.status.success() {
        bail!(
            "audio clip \"{clip_id}\" 解码失败: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Ok(out
        .stdout
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect())
}

fn ffmpeg_decode_command(
    path: &std::path::Path,
    media_start: f64,
    source_seconds: f64,
    rate: f64,
) -> std::process::Command {
    let mut cmd = crate::exec::command("ffmpeg");
    cmd.args([
        "-loglevel",
        "error",
        "-ss",
        &format!("{media_start:.6}"),
        "-t",
        &format!("{source_seconds:.6}"),
    ])
    .arg("-i")
    .arg(path);
    if (rate - 1.0).abs() > 1e-9 {
        cmd.args(["-filter:a", &atempo_chain(rate)]);
    }
    cmd.args(["-f", "f32le", "-ac", "2", "-ar", "48000", "-"]);
    cmd
}

/// ffmpeg atempo 滤镜单级仅接受 [0.5, 100]；低于 0.5 的倍速用级联表达。
fn atempo_chain(rate: f64) -> String {
    let mut stages: Vec<String> = Vec::new();
    let mut r = rate;
    while r < 0.5 {
        stages.push("atempo=0.5".into());
        r /= 0.5;
    }
    stages.push(format!("atempo={r:.6}"));
    stages.join(",")
}
