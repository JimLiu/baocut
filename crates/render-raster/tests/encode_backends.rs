//! `media` 门内：本文件用 `video::VideoWriter` / `FfmpegWriter`（host 字节层），
//! `wasm-safe` 构建里不存在（设计 §9.1）。
#![cfg(feature = "media")]

//! 成片编码后端选择的验收（WP6b）：写出 MP4 的到底是平台原生还是 ffmpeg。
//!
//! 与 `decode_backends.rs` 对称。按 `docs/design/bcf/baocut-format-spec.md` §15.1，
//! **导出编码的字节不承诺可复现**，所以这里断言的是选择规则、产物存在性、
//! 几何、时长容差与后端标识——不做像素 golden。
//!
//! - macOS / Windows，偶数画布 → 平台原生（AVFoundation / Media Foundation）
//! - Linux（`media_native::encode_available()` 为 false）→ ffmpeg 兜底
//! - ffmpeg 兜底路径本身仍要写得出合规 MP4（原生路径接管之后它没有日常流量，
//!   更需要一条钉住它的测试）

use std::path::Path;
use std::process::{Command, Stdio};

use render_raster::video::{FfmpegWriter, VideoWriter};

const WIDTH: u32 = 160;
const HEIGHT: u32 = 96;
const FPS: f64 = 30.0;
const FRAMES: usize = 60;
const SECONDS: f64 = FRAMES as f64 / FPS;

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// 一帧渐变：亮度随帧号推进，编码器不至于把整片压成一个静止 GOP。
fn frame(index: usize) -> Vec<u8> {
    let level = (index * 3 % 200 + 40) as u8;
    let mut data = Vec::with_capacity(WIDTH as usize * HEIGHT as usize * 4);
    for _ in 0..HEIGHT {
        for x in 0..WIDTH as usize {
            let ramp = (x * 255 / WIDTH as usize) as u8;
            data.extend_from_slice(&[level, ramp, 255 - level, 255]);
        }
    }
    data
}

fn assert_playable(out: &Path) {
    assert!(out.is_file(), "产物应当存在");
    let probe = media_probe::probe(out).expect("探测产物");
    assert_eq!(probe.dimensions(), Some((WIDTH, HEIGHT)));
    let duration = probe.positive_duration().expect("产物应当有时长");
    assert!(
        (duration - SECONDS).abs() <= 0.1,
        "时长应当在 ±0.1s 内：{duration}"
    );
}

#[test]
fn the_writer_picks_the_platform_backend_when_one_exists() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("native.mp4");
    let mut writer = match VideoWriter::open(&out, WIDTH, HEIGHT, FPS, None) {
        Ok(writer) => writer,
        // 既没有原生编码器又没有 ffmpeg：按仓库礼节跳过。
        Err(_) => {
            eprintln!("跳过：本机既无原生编码器也无 ffmpeg");
            return;
        }
    };
    let backend = writer.backend();
    if media_native::encode_available() {
        assert_eq!(
            backend,
            media_native::encode_backend(),
            "有原生后端时不该回落 ffmpeg"
        );
    } else {
        assert_eq!(backend, "ffmpeg", "没有原生后端时只能是 ffmpeg");
    }
    for index in 0..FRAMES {
        writer.write_frame(&frame(index)).expect("写帧");
    }
    writer.finish().expect("收尾");
    assert_playable(&out);
}

#[test]
fn the_ffmpeg_fallback_still_writes_a_conforming_mp4() {
    if !ffmpeg_available() {
        eprintln!("跳过：本机没有 ffmpeg");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("ffmpeg.mp4");
    let mut writer = FfmpegWriter::new(&out, WIDTH, HEIGHT, FPS, None).expect("启动 ffmpeg 写入器");
    for index in 0..FRAMES {
        writer.write_frame(&frame(index)).expect("写帧");
    }
    writer.finish().expect("收尾");
    assert_playable(&out);
}

/// 后端标识的取值闭集：诊断输出与 `bcut render --json` 的 `encodeBackend`
/// 都读它，别名漂移会静默破坏客户端的判定。
#[test]
fn the_backend_label_is_one_of_the_three_known_values() {
    let backend = if media_native::encode_available() {
        media_native::encode_backend()
    } else {
        "ffmpeg"
    };
    assert!(
        matches!(backend, "avfoundation" | "media-foundation" | "ffmpeg"),
        "未知的编码后端标识：{backend}"
    );
}
