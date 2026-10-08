//! 纯 Rust 后端：容器嗅探 ＋ 四条解析路径（ISO-BMFF / EBML / symphonia / 图片）。

use std::path::Path;

use anyhow::{Context, Result, anyhow, bail};

use crate::{AudioInfo, MediaKind, MediaProbe, VideoInfo, is_image_path, read_magic};

/// EBML（Matroska / WebM）的文件魔数。
const EBML_MAGIC: [u8; 4] = [0x1A, 0x45, 0xDF, 0xA3];

pub(crate) fn probe_native(path: &Path) -> Result<MediaProbe> {
    if !path.is_file() {
        bail!("媒体不存在或不是文件：{}", path.display());
    }
    if is_image_path(path) {
        return probe_image(path);
    }
    let magic = read_magic(path)?;
    if magic[..4] == EBML_MAGIC {
        return probe_matroska(path);
    }
    if &magic[4..8] == b"ftyp" {
        return probe_iso_bmff(path);
    }
    probe_symphonia(path)
}

// ── 图片 ───────────────────────────────────────────────────────────────────

fn probe_image(path: &Path) -> Result<MediaProbe> {
    use image::ImageDecoder as _;

    let reader = image::ImageReader::open(path)
        .with_context(|| format!("打开图片 {} 失败", path.display()))?
        .with_guessed_format()
        .with_context(|| format!("识别图片格式失败：{}", path.display()))?;
    let format = reader.format();
    let decoder = reader
        .into_decoder()
        .with_context(|| format!("读取图片头失败：{}", path.display()))?;
    let (width, height) = decoder.dimensions();
    let alpha = decoder.color_type().has_alpha();
    Ok(MediaProbe {
        kind: MediaKind::Image,
        duration_seconds: None,
        video: Some(VideoInfo {
            width,
            height,
            display_width: width,
            display_height: height,
            fps: None,
            bitrate: None,
            codec: format.map(|format| format!("{format:?}").to_ascii_lowercase()),
            alpha,
        }),
        audio: None,
    })
}

// ── ISO-BMFF（MP4 / MOV / M4A） ────────────────────────────────────────────

fn probe_iso_bmff(path: &Path) -> Result<MediaProbe> {
    use re_mp4::{StsdBoxContent, TrackKind};

    let file = std::fs::File::open(path)
        .map_err(|error| anyhow!("打开 {} 失败：{error}", path.display()))?;
    let size = file
        .metadata()
        .map_err(|error| anyhow!("读取 {} 元数据失败：{error}", path.display()))?
        .len();
    // `Mp4::read` 走 `Read + Seek` 并**跳过 mdat**：几 GB 的片子也只读 box 头。
    let mp4 = re_mp4::Mp4::read(std::io::BufReader::new(file), size)
        .map_err(|error| anyhow!("解析 MP4 {} 失败：{error}", path.display()))?;

    let mut video = None;
    let mut audio = None;
    for track in mp4.tracks().values() {
        match track.kind {
            Some(TrackKind::Video) if video.is_none() => {
                let stsd = &track.trak(&mp4).mdia.minf.stbl.stsd.contents;
                let coded = match stsd {
                    StsdBoxContent::Av01(bx) => Some((bx.width, bx.height)),
                    StsdBoxContent::Avc1(bx) => Some((bx.width, bx.height)),
                    StsdBoxContent::Hvc1(bx) | StsdBoxContent::Hev1(bx) => {
                        Some((bx.width, bx.height))
                    }
                    StsdBoxContent::Vp08(bx) => Some((bx.width, bx.height)),
                    StsdBoxContent::Vp09(bx) => Some((bx.width, bx.height)),
                    _ => None,
                };
                // 编码尺寸优先取 `stsd`（ffprobe 的 `stream=width,height` 就是
                // 它）；识别不了的 codec 退到 `tkhd` 的显示尺寸。
                let (width, height) = coded.unwrap_or((track.width, track.height));
                if width == 0 || height == 0 {
                    continue;
                }
                let matrix = &track.trak(&mp4).tkhd.matrix;
                let (display_width, display_height) = iso_display_dimensions(
                    u32::from(width),
                    u32::from(height),
                    [matrix.a, matrix.b, matrix.c, matrix.d],
                );
                video = Some(VideoInfo {
                    width: u32::from(width),
                    height: u32::from(height),
                    display_width,
                    display_height,
                    fps: sample_fps(track),
                    bitrate: positive(scale(track.duration, track.timescale)).and_then(
                        |duration| {
                            let bytes: f64 =
                                track.samples.iter().map(|sample| sample.size as f64).sum();
                            positive(bytes * 8.0 / duration)
                        },
                    ),
                    codec: iso_video_codec(stsd),
                    // ISO-BMFF 没有 Matroska 的 `AlphaMode` 标注。
                    alpha: false,
                });
            }
            Some(TrackKind::Audio) if audio.is_none() => {
                let stsd = &track.trak(&mp4).mdia.minf.stbl.stsd.contents;
                audio = Some(match stsd {
                    StsdBoxContent::Mp4a(bx) => AudioInfo {
                        codec: Some("aac".to_owned()),
                        sample_rate: Some(u32::from(bx.samplerate.value())),
                        channels: Some(bx.channelcount),
                    },
                    other => AudioInfo {
                        codec: unknown_fourcc(other),
                        sample_rate: None,
                        channels: None,
                    },
                });
            }
            _ => {}
        }
    }

    let mvhd = &mp4.moov.mvhd;
    let duration = positive(scale(mvhd.duration, u64::from(mvhd.timescale)))
        .or_else(|| {
            mp4.tracks()
                .values()
                .filter_map(|track| positive(scale(track.duration, track.timescale)))
                .fold(None, |acc: Option<f64>, value| {
                    Some(acc.map_or(value, |acc| acc.max(value)))
                })
        })
        // 分片 MP4 的 `mvhd.duration` 可能是 0 且样本表在 `moof` 里；这种情况
        // 交给 symphonia 再问一次（它自己会算 `num_frames`）。
        .or_else(|| symphonia_duration(path));

    if video.is_none() && audio.is_none() {
        bail!("{} 没有视频或音频轨", path.display());
    }
    let kind = if video.is_some() {
        MediaKind::Video
    } else {
        MediaKind::Audio
    };
    Ok(MediaProbe {
        kind,
        duration_seconds: duration,
        video,
        audio,
    })
}

/// ISO-BMFF `tkhd.matrix` 的 2×2 线性部分是 16.16 定点数。渲染解码后端
/// 只承诺纯 90 度倍数旋转，所以这里只需判断矩阵是否把横纵轴互换；
/// 平移项不影响输出像素尺寸。
fn iso_display_dimensions(width: u32, height: u32, [a, b, c, d]: [i32; 4]) -> (u32, u32) {
    const ONE: i64 = 1 << 16;
    const TOLERANCE: i64 = 4;
    let near = |value: i32, expected: i64| (i64::from(value) - expected).abs() <= TOLERANCE;
    let unit = |value: i32| near(value, ONE) || near(value, -ONE);
    if near(a, 0) && near(d, 0) && unit(b) && unit(c) {
        (height, width)
    } else {
        (width, height)
    }
}

fn iso_video_codec(stsd: &re_mp4::StsdBoxContent) -> Option<String> {
    use re_mp4::StsdBoxContent;

    Some(
        match stsd {
            StsdBoxContent::Av01(_) => "av1",
            StsdBoxContent::Avc1(_) => "h264",
            StsdBoxContent::Hvc1(_) | StsdBoxContent::Hev1(_) => "hevc",
            StsdBoxContent::Vp08(_) => "vp8",
            StsdBoxContent::Vp09(_) => "vp9",
            other => return unknown_fourcc(other),
        }
        .to_owned(),
    )
}

fn unknown_fourcc(stsd: &re_mp4::StsdBoxContent) -> Option<String> {
    match stsd {
        re_mp4::StsdBoxContent::Unknown(fourcc) => {
            let name = fourcc.to_string().trim().to_ascii_lowercase();
            (!name.is_empty()).then_some(name)
        }
        _ => None,
    }
}

/// 从样本表推 fps：所有样本步长一致时用 `timescale / delta`（等价 ffprobe 的
/// `r_frame_rate`），否则退到 `样本数 / 时长`（等价 `avg_frame_rate`）。
fn sample_fps(track: &re_mp4::Track) -> Option<f64> {
    if track.samples.is_empty() || track.timescale == 0 {
        return None;
    }
    let timescale = track.timescale as f64;
    let first = track.samples[0].duration;
    if first > 0
        && track
            .samples
            .iter()
            .all(|sample| sample.duration == first || sample.duration == 0)
    {
        return positive(timescale / first as f64);
    }
    let seconds = scale(track.duration, track.timescale);
    positive(track.samples.len() as f64 / seconds)
}

// ── Matroska / WebM ────────────────────────────────────────────────────────

/// 没有 `DefaultDuration` 时最多扫这么多帧来估帧率。
const MKV_FPS_SCAN_FRAMES: usize = 240;

fn probe_matroska(path: &Path) -> Result<MediaProbe> {
    use matroska_demuxer::{MatroskaFile, TrackType};

    let file = std::fs::File::open(path)
        .map_err(|error| anyhow!("打开 {} 失败：{error}", path.display()))?;
    let mut mkv = MatroskaFile::open(std::io::BufReader::new(file))
        .map_err(|error| anyhow!("解析 Matroska {} 失败：{error}", path.display()))?;

    let info = mkv.info();
    // `Info::duration` 的单位是 `TimestampScale`（纳秒/刻度）。
    let scale_ns = info.timestamp_scale().get() as f64;
    let duration = info
        .duration()
        .map(|ticks| ticks * scale_ns / 1e9)
        .and_then(positive);

    let mut video = None;
    let mut audio = None;
    let mut video_track_number = None;
    let mut video_default_duration = None;
    for track in mkv.tracks() {
        match track.track_type() {
            TrackType::Video if video.is_none() => {
                let Some(track_video) = track.video() else {
                    continue;
                };
                video_track_number = Some(track.track_number().get());
                video_default_duration = track.default_duration().map(|value| value.get());
                video = Some(VideoInfo {
                    width: track_video.pixel_width().get() as u32,
                    height: track_video.pixel_height().get() as u32,
                    display_width: track_video.pixel_width().get() as u32,
                    display_height: track_video.pixel_height().get() as u32,
                    // `DefaultDuration` 是纳秒/帧。
                    fps: video_default_duration.and_then(|ns| positive(1e9 / ns as f64)),
                    bitrate: None,
                    codec: matroska_codec(track.codec_id()),
                    // Matroska 的 `AlphaMode`（0x53C0）：非 0 = 这条轨的每个
                    // Block 带 `BlockAdditional` alpha 平面。迁移前 ffprobe 是
                    // 用 `stream_tags=alpha_mode` 读同一个值。
                    alpha: track_video.alpha_mode().is_some_and(|mode| mode != 0),
                });
            }
            TrackType::Audio if audio.is_none() => {
                audio = Some(AudioInfo {
                    codec: matroska_codec(track.codec_id()),
                    sample_rate: track
                        .audio()
                        .map(|track_audio| track_audio.sampling_frequency() as u32),
                    channels: track
                        .audio()
                        .map(|track_audio| track_audio.channels().get() as u16),
                });
            }
            _ => {}
        }
    }

    // ffmpeg 的 webm 复用器并不总写 `DefaultDuration`（`bcut sticker` 产出的
    // 贴纸就可能没有）。fps 是 `sticker.loop = "once"` 夹取末帧的依据，问不出
    // 来会让末帧解不出，所以退到"扫开头若干帧的时间戳中位数"。
    if let (Some(video), None, Some(number)) =
        (video.as_mut(), video_default_duration, video_track_number)
        && let Some(fps) = scan_matroska_fps(&mut mkv, number, scale_ns)
    {
        video.fps = Some(fps);
    }

    if video.is_none() && audio.is_none() {
        bail!("{} 没有视频或音频轨", path.display());
    }
    let kind = if video.is_some() {
        MediaKind::Video
    } else {
        MediaKind::Audio
    };
    Ok(MediaProbe {
        kind,
        duration_seconds: duration,
        video,
        audio,
    })
}

fn scan_matroska_fps<R: std::io::Read + std::io::Seek>(
    mkv: &mut matroska_demuxer::MatroskaFile<R>,
    track_number: u64,
    scale_ns: f64,
) -> Option<f64> {
    let mut frame = matroska_demuxer::Frame::default();
    let mut timestamps = Vec::new();
    while timestamps.len() < MKV_FPS_SCAN_FRAMES {
        match mkv.next_frame(&mut frame) {
            Ok(true) => {
                if frame.track == track_number {
                    timestamps.push(frame.timestamp);
                }
            }
            Ok(false) => break,
            Err(_) => break,
        }
    }
    if timestamps.len() < 2 {
        return None;
    }
    timestamps.sort_unstable();
    let mut deltas: Vec<u64> = timestamps
        .windows(2)
        .map(|pair| pair[1] - pair[0])
        .collect();
    deltas.retain(|delta| *delta > 0);
    if deltas.is_empty() {
        return None;
    }
    deltas.sort_unstable();
    let median = deltas[deltas.len() / 2] as f64 * scale_ns;
    positive(1e9 / median)
}

/// Matroska `CodecID` → ffprobe `codec_name` 口径的短名。
fn matroska_codec(codec_id: &str) -> Option<String> {
    let name = match codec_id {
        "V_VP8" => "vp8",
        "V_VP9" => "vp9",
        "V_AV1" => "av1",
        "V_MPEG4/ISO/AVC" => "h264",
        "V_MPEGH/ISO/HEVC" => "hevc",
        "V_MPEG4/ISO/ASP" | "V_MPEG4/ISO/SP" => "mpeg4",
        "V_THEORA" => "theora",
        "V_MJPEG" => "mjpeg",
        "A_OPUS" => "opus",
        "A_VORBIS" => "vorbis",
        "A_FLAC" => "flac",
        "A_AAC" => "aac",
        "A_AC3" => "ac3",
        "A_DTS" => "dts",
        "A_MPEG/L3" => "mp3",
        "A_PCM/INT/LIT" => "pcm_s16le",
        other => {
            let trimmed = other.trim();
            return (!trimmed.is_empty()).then(|| trimmed.to_ascii_lowercase());
        }
    };
    Some(name.to_owned())
}

// ── symphonia（纯音频容器，以及嗅探没认出来的杂项） ────────────────────────

fn probe_symphonia(path: &Path) -> Result<MediaProbe> {
    let format = symphonia_format(path)?;
    let audio_track = format.tracks().iter().find(|track| {
        track
            .codec_params
            .as_ref()
            .is_some_and(|params| params.audio().is_some())
    });
    // 罕见但真实存在：没有 `ftyp` 的老 QuickTime。嗅探把它送到这里，如果只看
    // 音轨就会把一份视频误判成 audio，所以视频轨也要认。
    let video_track = format.tracks().iter().find(|track| {
        track
            .codec_params
            .as_ref()
            .is_some_and(|params| params.video().is_some())
    });
    if audio_track.is_none() && video_track.is_none() {
        bail!("{} 没有可识别的音轨或视频轨", path.display());
    }

    let audio_params = audio_track
        .and_then(|track| track.codec_params.as_ref())
        .and_then(|params| params.audio());
    let audio = audio_track.map(|_| AudioInfo {
        codec: audio_params.and_then(|params| {
            symphonia::default::get_codecs()
                .get_audio_decoder(params.codec)
                .map(|decoder| decoder.codec.info.short_name.to_ascii_lowercase())
        }),
        sample_rate: audio_params.and_then(|params| params.sample_rate),
        channels: audio_params
            .and_then(|params| params.channels.as_ref())
            .map(|channels| channels.count() as u16),
    });
    let video = video_track
        .and_then(|track| track.codec_params.as_ref())
        .and_then(|params| params.video())
        .and_then(|params| {
            let (width, height) = (params.width?, params.height?);
            Some(VideoInfo {
                width: u32::from(width),
                height: u32::from(height),
                display_width: u32::from(width),
                display_height: u32::from(height),
                // symphonia 不透出帧率，也不透出 Matroska 的 `AlphaMode`
                // （EBML 层丢弃了它）——所以 MKV/WebM 走的是 matroska-demuxer。
                fps: None,
                bitrate: None,
                codec: symphonia_video_codec(params.codec),
                alpha: false,
            })
        });

    if video.is_none() && audio.is_none() {
        // 视频轨在，但连尺寸都问不出来——报失败比端出一份既没 video 也没
        // audio 的"成功"结果好：调用方会退到 ffprobe。
        bail!(
            "{} 的轨道信息不完整（问不出尺寸也没有音轨）",
            path.display()
        );
    }
    let kind = if video.is_some() {
        MediaKind::Video
    } else {
        MediaKind::Audio
    };
    let duration = format.tracks().iter().find_map(track_seconds);
    Ok(MediaProbe {
        kind,
        duration_seconds: duration,
        video,
        audio,
    })
}

/// symphonia 的 `VideoCodecId` → ffprobe `codec_name` 口径的短名。
/// （视频解码器不在注册表里，问不到 `short_name`，只能显式映射常见项。）
fn symphonia_video_codec(codec: symphonia::core::codecs::video::VideoCodecId) -> Option<String> {
    use symphonia::core::codecs::video::well_known::*;

    let name = match codec {
        CODEC_ID_H264 => "h264",
        CODEC_ID_HEVC => "hevc",
        CODEC_ID_AV1 => "av1",
        CODEC_ID_VP8 => "vp8",
        CODEC_ID_VP9 => "vp9",
        CODEC_ID_MPEG4 => "mpeg4",
        CODEC_ID_MPEG2 => "mpeg2video",
        CODEC_ID_MPEG1 => "mpeg1video",
        CODEC_ID_MJPEG => "mjpeg",
        CODEC_ID_THEORA => "theora",
        _ => return None,
    };
    Some(name.to_owned())
}

fn symphonia_format(
    path: &Path,
) -> Result<Box<dyn symphonia::core::formats::FormatReader>, anyhow::Error> {
    use symphonia::core::formats::probe::Hint;
    use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};

    let file = std::fs::File::open(path)
        .map_err(|error| anyhow!("打开 {} 失败：{error}", path.display()))?;
    let stream = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    symphonia::default::get_probe()
        .probe(
            &hint,
            stream,
            symphonia::core::formats::FormatOptions::default(),
            symphonia::core::meta::MetadataOptions::default(),
        )
        .map_err(|error| anyhow!("Symphonia 无法识别 {}：{error}", path.display()))
}

/// 0.6 把时长拆成「timebase 单位的 `duration`」与「可播放帧数 `num_frames`」，
/// 前者才是能过 `calc_duration` 的量；后者只能配采样率自己算。
fn track_seconds(track: &symphonia::core::formats::Track) -> Option<f64> {
    if let (Some(base), Some(duration)) = (track.time_base, track.duration)
        && let Some(time) = base.calc_duration(duration)
    {
        return positive(time.as_secs_f64());
    }
    let frames = track.num_frames?;
    let rate = track.codec_params.as_ref()?.audio()?.sample_rate?;
    (rate > 0)
        .then(|| frames as f64 / f64::from(rate))
        .and_then(positive)
}

fn symphonia_duration(path: &Path) -> Option<f64> {
    let format = symphonia_format(path).ok()?;
    format.tracks().iter().find_map(track_seconds)
}

// ── 小工具 ─────────────────────────────────────────────────────────────────

fn scale(ticks: u64, timescale: u64) -> f64 {
    if timescale == 0 {
        return 0.0;
    }
    ticks as f64 / timescale as f64
}

fn positive(value: f64) -> Option<f64> {
    (value.is_finite() && value > 0.0).then_some(value)
}
