//! 经本机 ffmpeg 的解码与编码。没有 ffmpeg 时跳过（CI 与没装 ffmpeg 的机器）。

use std::path::{Path, PathBuf};
use std::process::Command;

use media_core::decode::{VideoDecoder, decode_still};
use media_core::encode::{AudioTrack, Container, EncodeSettings, Encoder, Quality, QueuedEncoder, VideoCodec};
use media_core::probe::{encoders, probe_picture};
use media_core::{Picture, Tools};
use serde_json::Value;

fn tools() -> Option<Tools> {
    let ffmpeg = std::env::var_os("BAOCUT_FFMPEG").map_or_else(|| PathBuf::from("ffmpeg"), PathBuf::from);
    let ffprobe = std::env::var_os("BAOCUT_FFPROBE").map_or_else(|| PathBuf::from("ffprobe"), PathBuf::from);
    let ok = |tool: &Path| Command::new(tool).arg("-version").output().is_ok_and(|o| o.status.success());
    if ok(&ffmpeg) && ok(&ffprobe) {
        Some(Tools { ffmpeg, ffprobe })
    } else {
        eprintln!("没有 ffmpeg / ffprobe，跳过");
        None
    }
}

fn ffmpeg(tools: &Tools, args: &[&str]) {
    let status = Command::new(&tools.ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args(args)
        .status()
        .expect("ffmpeg");
    assert!(status.success(), "ffmpeg {args:?}");
}

/// 2 秒、10 fps：第 1 秒红，之后蓝；每 5 帧一个关键帧。
fn red_then_blue(tools: &Tools, dir: &Path) -> PathBuf {
    let path = dir.join("rb.mp4");
    ffmpeg(
        tools,
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=64x36:r=10:d=2",
            "-vf",
            "geq=r='if(lt(T,1),255,0)':g=0:b='if(lt(T,1),0,255)',format=yuv420p",
            "-c:v",
            "libx264",
            "-g",
            "5",
            path.to_str().unwrap(),
        ],
    );
    path
}

fn center(picture: &Picture) -> [u8; 4] {
    let i = ((picture.height / 2 * picture.width + picture.width / 2) * 4) as usize;
    picture.data[i..i + 4].try_into().unwrap()
}

fn is_red(px: [u8; 4]) -> bool {
    px[0] > 200 && px[2] < 60
}

fn is_blue(px: [u8; 4]) -> bool {
    px[2] > 200 && px[0] < 60
}

#[test]
fn decoder_walks_forward_and_restarts_on_backward_jumps() {
    let Some(tools) = tools() else { return };
    let dir = tempfile::tempdir().unwrap();
    let path = red_then_blue(&tools, dir.path());
    let info = probe_picture(&tools, &path).unwrap().expect("有画面");
    assert_eq!((info.width, info.height), (64, 36));
    let mut decoder = VideoDecoder::new(&tools, &path, 0.0, 32, 18);
    assert!(is_red(center(decoder.frame_at(0.0).unwrap())));
    assert!(is_red(center(decoder.frame_at(0.95).unwrap())));
    // 第 10 帧的时间戳正好是 1 秒：精确的时刻取到它。
    assert!(is_blue(center(decoder.frame_at(1.0).unwrap())));
    assert!(is_blue(center(decoder.frame_at(1.55).unwrap())));
    assert_eq!(decoder.restarts(), 0);
    assert_eq!(decoder.frame_at(1.55).unwrap().width, 32);
    // 读到末尾之后停在最后一帧。
    assert!(is_blue(center(decoder.frame_at(3.0).unwrap())));
    // 倒退时重开。
    assert!(is_red(center(decoder.frame_at(0.3).unwrap())));
    assert_eq!(decoder.restarts(), 1);
    // 向前跳得很远也重开（从目标前的关键帧开始），不一路解过去。
    assert!(is_blue(center(decoder.frame_at(9.0).unwrap())));
    assert_eq!(decoder.restarts(), 2);
}

#[test]
fn still_decodes_first_frame_and_probe_reports_missing_video() {
    let Some(tools) = tools() else { return };
    let dir = tempfile::tempdir().unwrap();
    let png = dir.path().join("still.png");
    ffmpeg(
        &tools,
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=0x00ff00:s=8x4",
            "-frames:v",
            "1",
            png.to_str().unwrap(),
        ],
    );
    let picture = decode_still(&tools, &png, 8, 4).unwrap();
    assert_eq!(picture.data.len(), 8 * 4 * 4);
    let px = &picture.data[0..4];
    assert!(px[0] < 3 && px[1] > 250 && px[2] < 3 && px[3] == 255, "{px:?}");
    let wav = dir.path().join("tone.wav");
    ffmpeg(
        &tools,
        &["-f", "lavfi", "-i", "sine=frequency=440:duration=0.2", wav.to_str().unwrap()],
    );
    assert_eq!(probe_picture(&tools, &wav).unwrap(), None);
    assert!(probe_picture(&tools, &dir.path().join("missing.png")).is_err());
}

#[test]
fn encoder_muxes_frames_and_padded_audio_to_equal_length() {
    let Some(tools) = tools() else { return };
    if !encoders(&tools).unwrap().contains("libx264") {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let wav = dir.path().join("tone.wav");
    ffmpeg(
        &tools,
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=0.5",
            "-ar",
            "48000",
            wav.to_str().unwrap(),
        ],
    );
    let out = dir.path().join("out.mp4");
    let settings = EncodeSettings {
        width: 64,
        height: 36,
        fps_num: 10,
        fps_den: 1,
        codec: VideoCodec::H264,
        container: Container::Mp4,
        quality: Quality::Crf(20),
        audio: Some(AudioTrack {
            path: wav,
            bitrate_kbps: 128,
        }),
        duration_seconds: 1.0,
    };
    let mut encoder = Encoder::start(&tools, &settings, &out).unwrap();
    let frame: Vec<u8> = [0u8, 200, 0, 255].repeat(64 * 36);
    for _ in 0..10 {
        encoder.write(&frame).unwrap();
    }
    encoder.finish().unwrap();
    let probe = Command::new(&tools.ffprobe)
        .args(["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json"])
        .arg(&out)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    let streams = value["streams"].as_array().unwrap();
    let video = streams.iter().find(|s| s["codec_type"] == "video").unwrap();
    let audio = streams.iter().find(|s| s["codec_type"] == "audio").unwrap();
    assert_eq!(video["nb_read_frames"], "10");
    assert_eq!(video["pix_fmt"], "yuv420p");
    assert_eq!(video["color_space"], "bt709");
    let audio_duration: f64 = audio["duration"].as_str().unwrap().parse().unwrap();
    assert!((audio_duration - 1.0).abs() < 0.05, "声音补到画面的长度：{audio_duration}");

    // 放弃时删掉输出。
    let aborted = dir.path().join("aborted.mp4");
    let mut encoder = Encoder::start(&tools, &EncodeSettings { audio: None, ..settings }, &aborted).unwrap();
    encoder.write(&frame).unwrap();
    encoder.abort();
    assert!(!aborted.exists());
}

#[test]
fn queued_encoder_writes_every_frame_and_reports_a_dead_encoder() {
    let Some(tools) = tools() else { return };
    if !encoders(&tools).unwrap().contains("libx264") {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let settings = EncodeSettings {
        width: 64,
        height: 36,
        fps_num: 10,
        fps_den: 1,
        codec: VideoCodec::H264,
        container: Container::Mp4,
        quality: Quality::Crf(20),
        audio: None,
        duration_seconds: 1.2,
    };
    let count_frames = |path: &Path| {
        let probe = Command::new(&tools.ffprobe)
            .args(["-v", "error", "-count_frames", "-show_streams", "-of", "json"])
            .arg(path)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        value["streams"][0]["nb_read_frames"].as_str().unwrap().to_string()
    };

    // 池里的缓冲铺好了颜色、长度是一帧；交进去的帧都写进去，收尾之后文件完整。
    let out = dir.path().join("queued.mp4");
    let mut queued = QueuedEncoder::new(Encoder::start(&tools, &settings, &out).unwrap(), 2, [0, 0, 0, 255]);
    for i in 0..12u8 {
        let mut frame = queued.buffer().unwrap();
        assert_eq!(frame.len(), 64 * 36 * 4);
        if i == 0 {
            assert_eq!(&frame[..8], [0, 0, 0, 255, 0, 0, 0, 255]);
        }
        frame[..4].copy_from_slice(&[i * 20, 0, 0, 255]);
        queued.submit(frame).unwrap();
    }
    assert!(queued.submit(vec![0; 4]).is_err(), "尺寸不对的帧不收");
    queued.finish().unwrap();
    assert_eq!(count_frames(&out), "12");

    // 放弃：排着的帧不写，输出删掉。
    let aborted = dir.path().join("queued-aborted.mp4");
    let mut queued = QueuedEncoder::new(Encoder::start(&tools, &settings, &aborted).unwrap(), 2, [0; 4]);
    let frame = queued.buffer().unwrap();
    queued.submit(frame).unwrap();
    queued.abort();
    assert!(!aborted.exists());

    // 编码器死了（输出写不出来）：合成线程很快在取缓冲或交帧时拿到写线程的错误。
    let broken = dir.path().join("missing-dir").join("out.mp4");
    let mut queued = QueuedEncoder::new(Encoder::start(&tools, &settings, &broken).unwrap(), 2, [0; 4]);
    let error = (0..1000)
        .find_map(|_| queued.buffer().and_then(|frame| queued.submit(frame)).err())
        .expect("编码器失败要报出来");
    assert_eq!(error.code, "EXPORT_ENCODE_FAILED");
    queued.abort();
}
