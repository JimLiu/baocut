//! 原生 MP4 写入验收（WP6b）。
//!
//! 口径按 `docs/design/bcf/baocut-format-spec.md` §15.1 与 `apps/cli` 的 `studio_export`
//! 测试：**导出编码的字节不承诺可复现**，所以这里断言的是存在性、帧数与时长
//! 容差、尺寸、后端标识、语义化颜色谓词与音频 RMS/频率，**不做像素 golden**。
//!
//! 素材全部程序化生成（分段纯色 + 水平渐变的 RGBA 帧、正弦 PCM），不依赖
//! ffmpeg：夹具生成与判读都在本仓库自己手里，编码器不可用时按仓库礼节跳过。

use std::path::Path;

use media_native::{RgbaFrame, encode_available, encode_backend, extract_frame_rgba};

mod common;

/// 输出几何：偶数宽高（H.264 4:2:0 的硬要求）。
const WIDTH: u32 = 320;
const HEIGHT: u32 = 180;
const FPS: f64 = 30.0;
/// 三段纯色各 1 秒，顺序红 / 绿 / 蓝。
const SEGMENT_SECONDS: f64 = 1.0;
const SEGMENTS: usize = 3;
const TOTAL_FRAMES: usize = (SEGMENT_SECONDS as usize) * SEGMENTS * (FPS as usize);
const TOTAL_SECONDS: f64 = SEGMENT_SECONDS * SEGMENTS as f64;

/// 正弦音的频率与幅度。440 Hz 远离 48 kHz 的任何折叠点，AAC 往返后仍然是
/// 一根干净的谱线；0.5 的幅度不会触发编码器的削波保护。
const TONE_HZ: f64 = 440.0;
const TONE_AMPLITUDE: f32 = 0.5;

/// 第 `index` 帧的 RGBA：按段取主导色，横向压一条 0.2 → 1.0 的线性亮度斜坡。
///
/// 斜坡的作用与解码侧夹具（`common::fixture`）一致：纯色画面是压缩与相似度
/// 判定的病态输入，给结构项一点内容，颜色谓词量到的才是"这一段是不是那个颜色"。
fn frame_rgba(index: usize) -> Vec<u8> {
    let segment = (index / (FPS as usize)).min(SEGMENTS - 1);
    let base = match segment {
        0 => [235_u8, 20, 20],
        1 => [20, 235, 20],
        _ => [20, 20, 235],
    };
    let mut data = Vec::with_capacity(WIDTH as usize * HEIGHT as usize * 4);
    for _ in 0..HEIGHT {
        for x in 0..WIDTH {
            let ramp = 0.2 + 0.8 * f64::from(x) / f64::from(WIDTH);
            for channel in base {
                data.push((f64::from(channel) * ramp).round().clamp(0.0, 255.0) as u8);
            }
            data.push(255);
        }
    }
    data
}

/// 整片正弦 PCM（裸 f32le、48 kHz、立体声交织），写进临时文件。
fn write_tone_pcm(path: &Path) {
    let frames = (TOTAL_SECONDS * f64::from(media_native::AUDIO_SAMPLE_RATE)) as usize;
    let mut bytes = Vec::with_capacity(frames * 8);
    for frame in 0..frames {
        let t = frame as f64 / f64::from(media_native::AUDIO_SAMPLE_RATE);
        let value = (TONE_AMPLITUDE as f64 * (std::f64::consts::TAU * TONE_HZ * t).sin()) as f32;
        for _ in 0..media_native::AUDIO_CHANNELS {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
    std::fs::write(path, bytes).expect("写正弦 PCM");
}

/// 写一段测试 MP4；编码器不可用时返回 `None`（仓库礼节：无后端不算失败）。
fn write_fixture(out: &Path, audio: Option<&Path>) -> Option<()> {
    if !encode_available() {
        return None;
    }
    let mut writer = match media_native::open_mp4_writer(out, WIDTH, HEIGHT, FPS, audio) {
        Ok(writer) => writer,
        // 本机没有可用的 H.264 / AAC 编码器：跳过而不是判失败。
        Err(error) if format!("{error:#}").contains("unsupported") => return None,
        Err(error) => panic!("打开原生 MP4 写入器失败：{error:#}"),
    };
    assert_eq!(writer.backend(), encode_backend());
    for index in 0..TOTAL_FRAMES {
        writer.write_frame(&frame_rgba(index)).expect("写帧");
    }
    writer.finish().expect("收尾 MP4");
    Some(())
}

/// 解回整条音轨（48 kHz 交错立体声 f32）。
fn decode_audio(path: &Path) -> Vec<f32> {
    use symphonia::core::codecs::audio::AudioDecoderOptions;
    use symphonia::core::formats::probe::Hint;
    use symphonia::core::formats::{FormatOptions, TrackType};
    use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
    use symphonia::core::meta::MetadataOptions;

    let file = std::fs::File::open(path).expect("打开产物");
    let stream = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    hint.with_extension("mp4");
    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            stream,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .expect("解复用产物");
    let track = format
        .first_track_known_codec(TrackType::Audio)
        .expect("产物应当有音轨");
    let track_id = track.id;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|params| params.audio())
        .expect("音频编解码参数")
        .clone();
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .expect("AAC 解码器");
    let mut interleaved = Vec::new();
    let mut out = Vec::new();
    while let Ok(Some(packet)) = format.next_packet() {
        if packet.track_id != track_id {
            continue;
        }
        let Ok(decoded) = decoder.decode(&packet) else {
            continue;
        };
        let channels = decoded.spec().channels().count();
        assert_eq!(channels, 2, "输出音轨应当是立体声");
        decoded.copy_to_vec_interleaved(&mut interleaved);
        out.extend_from_slice(&interleaved);
    }
    out
}

/// 左声道在 `[start, end)` 秒窗口上的 RMS 与过零率推出的基频。
fn tone_metrics(samples: &[f32], start: f64, end: f64) -> (f64, f64) {
    let rate = f64::from(media_native::AUDIO_SAMPLE_RATE);
    let first = (start * rate) as usize;
    let last = ((end * rate) as usize).min(samples.len() / 2);
    assert!(last > first, "窗口内没有样本");
    let left: Vec<f64> = (first..last).map(|i| f64::from(samples[i * 2])).collect();
    let rms = (left.iter().map(|value| value * value).sum::<f64>() / left.len() as f64).sqrt();
    // 过零计数：正弦一个周期恰好两次上/下穿零，噪声在这个信噪比下不会额外穿。
    let crossings = left
        .windows(2)
        .filter(|pair| (pair[0] < 0.0) != (pair[1] < 0.0))
        .count();
    let seconds = left.len() as f64 / rate;
    (rms, crossings as f64 / 2.0 / seconds)
}

#[test]
fn the_native_writer_produces_a_probeable_mp4_with_the_requested_geometry() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("video-only.mp4");
    if write_fixture(&out, None).is_none() {
        eprintln!("跳过：当前平台没有原生 MP4 编码后端");
        return;
    }
    assert!(out.is_file(), "产物应当存在");
    assert!(std::fs::metadata(&out).unwrap().len() > 0, "产物不应为空");

    let probe = media_probe::probe(&out).expect("探测产物");
    assert_eq!(probe.dimensions(), Some((WIDTH, HEIGHT)));
    let duration = probe.positive_duration().expect("产物应当有时长");
    assert!(
        (duration - TOTAL_SECONDS).abs() <= 0.1,
        "时长应当在 ±0.1s 内：{duration}"
    );
    assert!(!probe.has_audio(), "无音频参数时不应写出音轨");
    let fps = probe.fps().expect("产物应当有帧率");
    assert!((fps - FPS).abs() <= 0.05, "帧率应当是请求的那个：{fps}");
}

#[test]
fn each_colour_segment_decodes_back_to_its_own_dominant_channel() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("segments.mp4");
    if write_fixture(&out, None).is_none() {
        eprintln!("跳过：当前平台没有原生 MP4 编码后端");
        return;
    }
    // 每段取中点，避开段边界（那里编码器的 B 帧参考可能混两段）。
    for (index, expected) in ["red", "green", "blue"].iter().enumerate() {
        let time = index as f64 * SEGMENT_SECONDS + SEGMENT_SECONDS / 2.0;
        let frame: RgbaFrame = extract_frame_rgba(&out, time, WIDTH).expect("解回单帧");
        assert_eq!(frame.width, WIDTH);
        assert_eq!(frame.height, HEIGHT);
        assert_eq!(
            common::dominant(&frame),
            *expected,
            "t={time:.2}s 的主导色应当是 {expected}"
        );
    }
}

#[test]
fn the_mixed_audio_track_survives_the_aac_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let pcm = dir.path().join("mix.f32le");
    write_tone_pcm(&pcm);
    let out = dir.path().join("with-audio.mp4");
    if write_fixture(&out, Some(&pcm)).is_none() {
        eprintln!("跳过：当前平台没有原生 MP4 编码后端");
        return;
    }
    let probe = media_probe::probe(&out).expect("探测产物");
    assert!(probe.has_audio(), "给了 PCM 就应当写出音轨");
    let duration = probe.positive_duration().expect("产物应当有时长");
    assert!(
        (duration - TOTAL_SECONDS).abs() <= 0.1,
        "带音轨的时长同样在 ±0.1s 内：{duration}"
    );

    let samples = decode_audio(&out);
    assert!(!samples.is_empty(), "音轨应当解得出样本");
    // 掐头去尾 0.3 秒：AAC 的编码器预热样本与末尾补零都在这两段里。
    let (rms, frequency) = tone_metrics(&samples, 0.3, TOTAL_SECONDS - 0.3);
    let expected_rms = f64::from(TONE_AMPLITUDE) / std::f64::consts::SQRT_2;
    assert!(
        (rms - expected_rms).abs() <= 0.05,
        "RMS 应当接近 {expected_rms:.3}，实得 {rms:.3}"
    );
    assert!(
        (frequency - TONE_HZ).abs() <= 5.0,
        "基频应当接近 {TONE_HZ} Hz，实得 {frequency:.1}"
    );
}

#[test]
fn the_encode_backend_label_matches_platform_availability() {
    if cfg!(target_os = "macos") {
        assert_eq!(encode_backend(), "avfoundation");
        assert!(encode_available());
    } else if cfg!(target_os = "windows") {
        assert_eq!(encode_backend(), "media-foundation");
        assert!(encode_available());
    } else {
        assert!(!encode_available());
        assert_eq!(encode_backend(), "none");
    }
}

/// 29.97 fps 写出来必须读回 30000/1001，而不是 30：AVAssetWriter 缺省的 600 时基会把
/// 1001/30000 的帧长取整成 20/600，下一道导出据此按 30 fps 铺网格（播客 Shorts 实测）。
#[test]
fn ntsc_frame_rates_survive_the_container_timebase() {
    if !encode_available() {
        eprintln!("跳过：当前平台没有原生 MP4 编码后端");
        return;
    }
    let dir = tempfile::tempdir().expect("临时目录");
    let out = dir.path().join("ntsc.mp4");
    let fps = 30000.0 / 1001.0;
    let mut writer = match media_native::open_mp4_writer(&out, WIDTH, HEIGHT, fps, None) {
        Ok(writer) => writer,
        Err(error) if format!("{error:#}").contains("unsupported") => return,
        Err(error) => panic!("打开原生 MP4 写入器失败：{error:#}"),
    };
    for index in 0..60 {
        writer.write_frame(&frame_rgba(index)).expect("写帧");
    }
    writer.finish().expect("收尾");
    let probe = media_probe::probe(&out).expect("探测产物");
    let read = probe.fps().expect("产物应当有帧率");
    assert!((read - fps).abs() < 1e-6, "29.97 读回成了 {read}");
}
