//! Bounded-memory BCF mixing for Timeline source preparation. Clip order and
//! 64-frame envelope sampling match the reference in-memory mixer exactly.
use super::*;
use std::fs::File;
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::process::Stdio;
use tempfile::NamedTempFile;

pub struct FileAudioMix {
    pub wav: NamedTempFile,
    pub clips: Vec<ClipDecodeRecord>,
    /// 文档写了 `audio.master` 且施加了时的母带实测。
    pub master: Option<super::MasterMeasure>,
    /// 混音链的提醒（如：部分 clip 由时间轴另放，整片母带没有施加）。
    pub warnings: Vec<String>,
}

/// Decode one clip at a time to temporary PCM, then mix in four-second windows.
/// Large/rate-adjusted clips use ffmpeg's streaming decoder; small normal-rate
/// clips retain the native decoder used by the reference mixer.
///
/// `exclude` lists clip ids the host plays elsewhere (narration clips claimed by
/// timeline elements); they are left out of the mix. The mix still spans the
/// whole composition, so an all-excluded document yields silence, not `None`.
///
/// Muted-track clips are skipped. Documents with `audio` or clip fades / pan
/// run through the windowed mix chain (`chain.rs`); excluded clips on a duck
/// source bus are still decoded so ducking keeps following them, but
/// `audio.master` is not applied to a partial mix (a warning says so).
pub fn mix_audio_file(
    ir: &Ir,
    assets: &LoadedAssets,
    exclude: &std::collections::BTreeSet<String>,
    mut checkpoint: impl FnMut() -> Result<()>,
) -> Result<Option<FileAudioMix>> {
    if ir.audio_clips.is_empty() {
        return Ok(None);
    }
    let frames = (ir.total * f64::from(SAMPLE_RATE)).round() as u64;
    let chained = super::needs_chain(ir);
    let duck_sources: std::collections::BTreeSet<&str> = ir
        .audio
        .iter()
        .flat_map(|a| a.duck.iter().map(|d| d.from.as_str()))
        .collect();
    let mut decoded = Vec::new();
    let mut records = Vec::new();
    for clip in &ir.audio_clips {
        checkpoint()?;
        let dur = (clip.end - clip.start).max(0.0);
        let excluded = exclude.contains(&clip.id);
        let feeds_duck = chained && duck_sources.contains(clip.bus.as_str());
        if dur <= 0.0 || clip.muted || (excluded && !feeds_duck) {
            continue;
        }
        let path = assets
            .audios
            .get(&clip.asset_id)
            .or_else(|| assets.videos.get(&clip.asset_id).map(|v| &v.path))
            .ok_or_else(|| anyhow!("音频资源 \"{}\" 未加载", clip.asset_id))?;
        let rate = if clip.rate > 0.0 { clip.rate } else { 1.0 };
        let mut pcm = NamedTempFile::new()?;
        let native = ((rate - 1.0).abs() <= 1e-9 && dur * 48000.0 * 8.0 <= (32 << 20) as f64)
            .then(|| decode_stereo_48k(path, clip.media_start, dur))
            .and_then(Result::ok);
        let backend = if let Some(samples) = native {
            let mut writer = BufWriter::new(pcm.as_file_mut());
            for sample in samples {
                writer.write_all(&sample.to_le_bytes())?;
            }
            writer.flush()?;
            SYMPHONIA_BACKEND
        } else {
            let mut child = ffmpeg_decode_command(path, clip.media_start, dur * rate, rate)
                .stdout(Stdio::from(pcm.reopen()?))
                .stderr(Stdio::null())
                .spawn()
                .context("启动流式音频解码失败")?;
            loop {
                if let Err(error) = checkpoint() {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
                if let Some(status) = child.try_wait()? {
                    if !status.success() {
                        bail!("audio clip \"{}\" 流式解码失败：{status}", clip.id);
                    }
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            FFMPEG_BACKEND
        };
        let length = pcm.as_file().metadata()?.len() / 8;
        records.push(ClipDecodeRecord {
            clip_id: clip.id.clone(),
            backend,
        });
        decoded.push((
            clip,
            pcm.into_temp_path(),
            length,
            (clip.start * 48000.0).round() as u64,
            !excluded,
        ));
    }
    let mut master = NamedTempFile::new()?;
    let mut warnings = Vec::new();
    let mut measure = None;
    if chained {
        let doc = ir.audio.clone().unwrap_or_default();
        let partial =
            decoded.iter().any(|d| !d.4) || ir.audio_clips.iter().any(|c| exclude.contains(&c.id));
        let target = doc.master.filter(|_| !partial);
        if doc.master.is_some() && partial {
            warnings.push(
                "audio-master-skipped: 部分 audio clip 由时间轴另放，audio.master 没有施加到这份局部混音；整片响度用 bcut export --loudness / --true-peak".to_string(),
            );
        }
        let clips: Vec<super::chain::ChainClip<'_>> = decoded
            .into_iter()
            .map(
                |(clip, file, length, start, audible)| super::chain::ChainClip {
                    clip,
                    pcm: super::chain::ClipPcm::File(file),
                    frames: length,
                    start,
                    audible,
                },
            )
            .collect();
        let mut writer = BufWriter::new(master.as_file_mut());
        let report = super::chain::run(
            frames,
            &clips,
            &doc,
            target,
            true,
            super::chain::WINDOW,
            &mut |x| {
                for s in x {
                    writer.write_all(&s.to_le_bytes())?;
                }
                Ok(())
            },
            &mut checkpoint,
        )?;
        writer.flush()?;
        measure = report.master;
        decoded = Vec::new();
    }
    if !chained {
        let mut writer = BufWriter::new(master.as_file_mut());
        const WINDOW: u64 = 4 * 48000;
        for begin in (0..frames).step_by(WINDOW as usize) {
            checkpoint()?;
            let end = (begin + WINDOW).min(frames);
            let mut mixed = vec![0.0f32; (end - begin) as usize * 2];
            for (clip, file, length, start, _) in &mut decoded {
                let a = begin.max(*start);
                let b = end.min(start.saturating_add(*length));
                if b <= a {
                    continue;
                }
                let mut reader = File::open(&*file)?;
                reader.seek(SeekFrom::Start((a - *start) * 8))?;
                let mut bytes = vec![0u8; (b - a) as usize * 8];
                reader.read_exact(&mut bytes)?;
                let mut offset = 0usize;
                while offset < (b - a) as usize {
                    let local = a - *start + offset as u64;
                    let block_start = local / 64 * 64;
                    let time = clip.start + block_start as f64 / 48000.0;
                    let gain = if clip.volume.is_empty() {
                        clip.base_volume
                    } else {
                        sample_frames(&clip.volume, time)
                            .as_f64()
                            .unwrap_or(clip.base_volume)
                    } as f32;
                    let n = (64 - local % 64).min(b - a - offset as u64) as usize;
                    for k in offset * 2..(offset + n) * 2 {
                        let sample =
                            f32::from_le_bytes(bytes[k * 4..k * 4 + 4].try_into().unwrap());
                        mixed[(a - begin) as usize * 2 + k] += sample * gain;
                    }
                    offset += n;
                }
            }
            for sample in mixed {
                writer.write_all(&sample.clamp(-1.0, 1.0).to_le_bytes())?;
            }
        }
        writer.flush()?;
    }
    let wav = NamedTempFile::with_suffix(".wav")?;
    let size = frames.checked_mul(8).context("BCF 音频时长溢出")?;
    if size <= u64::from(u32::MAX) - 36 {
        let mut writer = BufWriter::new(wav.as_file());
        writer.write_all(b"RIFF")?;
        writer.write_all(&(size as u32 + 36).to_le_bytes())?;
        writer.write_all(b"WAVEfmt ")?;
        writer.write_all(&16u32.to_le_bytes())?;
        writer.write_all(&3u16.to_le_bytes())?;
        writer.write_all(&2u16.to_le_bytes())?;
        writer.write_all(&48000u32.to_le_bytes())?;
        writer.write_all(&384000u32.to_le_bytes())?;
        writer.write_all(&8u16.to_le_bytes())?;
        writer.write_all(&32u16.to_le_bytes())?;
        writer.write_all(b"data")?;
        writer.write_all(&(size as u32).to_le_bytes())?;
        std::io::copy(&mut File::open(master.path())?, &mut writer)?;
        writer.flush()?;
    } else {
        // Delegate RF64 container writing to the installed media backend.
        let status = crate::exec::command("ffmpeg")
            .args([
                "-v", "error", "-y", "-f", "f32le", "-ar", "48000", "-ac", "2", "-i",
            ])
            .arg(master.path())
            .args(["-c:a", "pcm_f32le", "-rf64", "auto"])
            .arg(wav.path())
            .status()?;
        if !status.success() {
            bail!("写入 BCF RF64 音频失败：{status}");
        }
    }
    checkpoint()?;
    Ok(Some(FileAudioMix {
        wav,
        clips: records,
        master: measure,
        warnings,
    }))
}
