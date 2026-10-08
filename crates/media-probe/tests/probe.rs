//! 纯 Rust 探测的自测 ＋ 与 `ffprobe` 的对拍。
//!
//! 仓库既有素材（`tests/fixtures/`）直接断言；视频/WebM 夹具用 ffmpeg 现生成，
//! **探测不到 ffmpeg 就静默 skip**（与 `bcut-render` 的媒体管线测试同礼节）。

use std::path::{Path, PathBuf};
use std::process::Command;

use media_probe::{MediaKind, ProbeBackend, probe, probe_with_fallback};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn have(tool: &str) -> bool {
    Command::new(tool)
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

#[test]
fn video_bitrate_matches_track_bytes_instead_of_audio_and_container() {
    let Some(dir) = video_fixtures() else {
        return;
    };
    let path = dir.join("clip.mp4");
    let native = probe(&path).unwrap();
    let rate = native.video_bitrate(&path).unwrap();
    let external = media_probe::probe_with_ffprobe(&path, Path::new("ffprobe")).unwrap();
    let expected = external.video.unwrap().bitrate.unwrap();
    assert!(
        (rate - expected).abs() / expected < 0.01,
        "{rate} vs {expected}"
    );
    let total =
        std::fs::metadata(&path).unwrap().len() as f64 * 8.0 / native.positive_duration().unwrap();
    assert!(rate < total);
    let mut unavailable = native.clone();
    unavailable.video.as_mut().unwrap().bitrate = None;
    assert_eq!(unavailable.video_bitrate(&path), Some(total));
    unavailable.duration_seconds = Some(f64::NAN);
    assert_eq!(unavailable.video_bitrate(&path), None);
}

/// 生成一次性夹具目录（进程外幂等：同名文件在就复用）。
fn ff(args: &[&str]) -> bool {
    Command::new("ffmpeg")
        .args(["-y", "-loglevel", "error"])
        .args(args)
        .status()
        .is_ok_and(|status| status.success())
}

/// 夹具目录；ffmpeg 不在就返回 `None`（调用方 skip）。
fn video_fixtures() -> Option<PathBuf> {
    if !have("ffmpeg") {
        eprintln!("跳过：PATH 中没有 ffmpeg");
        return None;
    }
    let dir = std::env::temp_dir().join("bcut-media-probe-fixtures");
    std::fs::create_dir_all(&dir).ok()?;

    let mp4 = dir.join("clip.mp4");
    if !mp4.exists() {
        assert!(ff(&[
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=640x360:rate=30:duration=2",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-shortest",
            mp4.to_str()?,
        ]));
    }

    let silent = dir.join("silent.mp4");
    if !silent.exists() {
        assert!(ff(&[
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=320x240:rate=25:duration=1",
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "libx264",
            silent.to_str()?,
        ]));
    }

    let rotated = dir.join("rotated-display-matrix.mp4");
    if !rotated.exists()
        && !ff(&[
            // FFmpeg 7+ 用输入级 `-display_rotation` 写 MP4 tkhd display
            // matrix；旧版不认这个参数时只跳过旋转用例。
            "-display_rotation",
            "90",
            "-i",
            silent.to_str()?,
            "-c",
            "copy",
            rotated.to_str()?,
        ])
    {
        let _ = std::fs::remove_file(&rotated);
    }

    let alpha = dir.join("alpha.webm");
    if !alpha.exists() {
        // `yuva420p` + libvpx-vp9 ⇒ Matroska 的 `AlphaMode` 会被写上。
        // 这台机器的 ffmpeg 没编 libvpx-vp9 时生成会失败，那就跳过 alpha 用例。
        let _ = ff(&[
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=160x120:rate=24:duration=1",
            "-vf",
            "format=yuva420p,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='128'",
            "-c:v",
            "libvpx-vp9",
            "-pix_fmt",
            "yuva420p",
            alpha.to_str()?,
        ]);
    }

    let opaque = dir.join("opaque.webm");
    if !opaque.exists() {
        let _ = ff(&[
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=160x120:rate=24:duration=1",
            "-c:v",
            "libvpx-vp9",
            "-pix_fmt",
            "yuv420p",
            opaque.to_str()?,
        ]);
    }

    Some(dir)
}

#[test]
fn wav_fixture_reports_audio_only() {
    let path = fixtures().join("speech/test-sample.wav");
    let probed = probe(&path).expect("WAV 夹具必须能纯 Rust 探测");
    assert_eq!(probed.kind, MediaKind::Audio);
    assert!(probed.video.is_none());
    let audio = probed.audio.as_ref().expect("WAV 必须有音轨");
    assert_eq!(audio.sample_rate, Some(16_000));
    assert_eq!(audio.channels, Some(1));
    let duration = probed.positive_duration().expect("WAV 必须有时长");
    assert!(duration > 0.5, "{duration}");
}

#[test]
fn missing_file_is_an_error_and_has_no_ffprobe_fallback() {
    let directory = tempfile::tempdir().expect("tempdir");
    let path = directory.path().join("nope.wav");
    assert!(probe(&path).is_err());
    assert!(probe_with_fallback(&path, None).is_err());
}

#[test]
fn png_reports_image_kind_and_dimensions() {
    let directory = tempfile::tempdir().expect("tempdir");
    let path = directory.path().join("card.png");
    let buffer = image::RgbaImage::from_pixel(48, 17, image::Rgba([9, 9, 9, 255]));
    buffer.save(&path).expect("写 PNG 夹具");

    let probed = probe(&path).expect("PNG 必须能纯 Rust 探测");
    assert_eq!(probed.kind, MediaKind::Image);
    assert_eq!(probed.dimensions(), Some((48, 17)));
    assert_eq!(probed.duration_seconds, None);
    assert!(!probed.has_audio());
}

#[test]
fn mp4_reports_video_geometry_audio_and_fps() {
    let Some(dir) = video_fixtures() else { return };
    let probed = probe(&dir.join("clip.mp4")).expect("MP4 必须能纯 Rust 探测");
    assert_eq!(probed.kind, MediaKind::Video);
    assert_eq!(probed.dimensions(), Some((640, 360)));
    assert!(probed.has_audio());
    let fps = probed.fps().expect("MP4 必须能问出帧率");
    assert!((fps - 30.0).abs() < 0.01, "{fps}");
    let duration = probed.positive_duration().expect("MP4 必须有时长");
    assert!((duration - 2.0).abs() < 0.1, "{duration}");
    let video = probed.video.as_ref().expect("video");
    assert_eq!(video.codec.as_deref(), Some("h264"));
    assert!(!video.alpha);

    let silent = probe(&dir.join("silent.mp4")).expect("无音轨 MP4");
    assert!(!silent.has_audio());
    assert_eq!(silent.dimensions(), Some((320, 240)));
}

#[test]
fn rotated_mp4_keeps_encoded_dimensions_and_adds_display_dimensions() {
    let Some(dir) = video_fixtures() else { return };
    let rotated = dir.join("rotated-display-matrix.mp4");
    if !rotated.exists() {
        eprintln!("跳过：这台机器的 ffmpeg 不支持 -display_rotation 夹具");
        return;
    }
    let probed = probe(&rotated).expect("旋转 MP4 必须能纯 Rust 探测");
    assert_eq!(
        probed.dimensions(),
        Some((320, 240)),
        "naturalW/H 仍是不含旋转的编码尺寸"
    );
    assert_eq!(
        probed.display_dimensions(),
        Some((240, 320)),
        "display 尺寸应按 90° 旋转摆正"
    );
}

#[test]
fn webm_alpha_mode_is_visible_without_ffprobe() {
    let Some(dir) = video_fixtures() else { return };
    let alpha = dir.join("alpha.webm");
    if !alpha.exists() {
        eprintln!("跳过：这台机器的 ffmpeg 生成不了 libvpx-vp9 的 yuva420p WebM");
        return;
    }
    let probed = probe(&alpha).expect("WebM 必须能纯 Rust 探测");
    assert_eq!(probed.kind, MediaKind::Video);
    assert_eq!(probed.dimensions(), Some((160, 120)));
    let video = probed.video.as_ref().expect("video");
    assert_eq!(video.codec.as_deref(), Some("vp9"));
    assert!(video.alpha, "带 alpha 的 WebM 必须被认出来");
    let fps = probed.fps().expect("WebM 必须能问出帧率");
    assert!((fps - 24.0).abs() < 0.01, "{fps}");

    let opaque = dir.join("opaque.webm");
    if opaque.exists() {
        let probed = probe(&opaque).expect("不透明 WebM");
        assert!(!probed.video.expect("video").alpha);
    }
}

/// 对拍：同一份文件，native 与 ffprobe 两条路径的关键字段必须一致。
#[test]
fn native_matches_ffprobe() {
    if !have("ffprobe") {
        eprintln!("跳过：PATH 中没有 ffprobe");
        return;
    }
    let ffprobe = Path::new("ffprobe");
    let mut targets = vec![fixtures().join("speech/test-sample.wav")];
    if let Some(dir) = video_fixtures() {
        targets.push(dir.join("clip.mp4"));
        targets.push(dir.join("silent.mp4"));
        let rotated = dir.join("rotated-display-matrix.mp4");
        if rotated.exists() {
            targets.push(rotated);
        }
        for name in ["alpha.webm", "opaque.webm"] {
            let path = dir.join(name);
            if path.exists() {
                targets.push(path);
            }
        }
    }

    for target in targets {
        let native =
            probe(&target).unwrap_or_else(|error| panic!("{}: {error:#}", target.display()));
        let reference = media_probe::probe_with_ffprobe(&target, ffprobe)
            .unwrap_or_else(|error| panic!("{}: {error:#}", target.display()));
        let label = target.display();

        assert_eq!(native.kind, reference.kind, "{label} kind");
        assert_eq!(
            native.has_audio(),
            reference.has_audio(),
            "{label} hasAudio"
        );
        assert_eq!(native.dimensions(), reference.dimensions(), "{label} 尺寸");
        assert_eq!(
            native.display_dimensions(),
            reference.display_dimensions(),
            "{label} display 尺寸"
        );

        match (native.duration_seconds, reference.duration_seconds) {
            (Some(a), Some(b)) => assert!((a - b).abs() <= 0.05, "{label} 时长 {a} != {b}"),
            (a, b) => assert_eq!(a, b, "{label} 时长可用性"),
        }
        match (native.fps(), reference.fps()) {
            (Some(a), Some(b)) => assert!((a - b).abs() <= 0.01, "{label} fps {a} != {b}"),
            (None, None) => {}
            (a, b) => panic!("{label} fps 可用性 {a:?} != {b:?}"),
        }
        assert_eq!(
            native.video.as_ref().map(|video| video.alpha),
            reference.video.as_ref().map(|video| video.alpha),
            "{label} alpha"
        );
        assert_eq!(
            native.video.as_ref().and_then(|video| video.codec.clone()),
            reference
                .video
                .as_ref()
                .and_then(|video| video.codec.clone()),
            "{label} 视频 codec"
        );
    }
}

/// 纯 Rust 解不了的容器（AVI）走 ffprobe 兜底，且后端标记如实。
#[test]
fn unsupported_container_falls_back_to_ffprobe() {
    let Some(dir) = video_fixtures() else { return };
    if !have("ffprobe") {
        eprintln!("跳过：PATH 中没有 ffprobe");
        return;
    }
    let avi = dir.join("clip.avi");
    if !avi.exists()
        && !ff(&[
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=320x240:rate=25:duration=1",
            "-c:v",
            "mpeg4",
            avi.to_str().expect("路径"),
        ])
    {
        eprintln!("跳过：这台机器的 ffmpeg 生成不了 AVI 夹具");
        return;
    }
    assert!(probe(&avi).is_err(), "AVI 不在纯 Rust 覆盖范围内");
    let (probed, backend) =
        probe_with_fallback(&avi, Some(Path::new("ffprobe"))).expect("ffprobe 兜底");
    assert_eq!(backend, ProbeBackend::Ffprobe);
    assert_eq!(probed.kind, MediaKind::Video);
    assert_eq!(probed.dimensions(), Some((320, 240)));
}

#[test]
fn native_backend_is_reported_when_pure_rust_succeeds() {
    let path = fixtures().join("speech/test-sample.wav");
    let (_, backend) = probe_with_fallback(&path, Some(Path::new("ffprobe"))).expect("WAV");
    assert_eq!(backend, ProbeBackend::Native);
}
