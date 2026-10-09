//! 关键帧吸附（`MediaStore::set_keyframe_snap`）的取帧语义。
//!
//! 交互式预览**拖动中**把取帧时刻吸到它之前最近的关键帧：每次跳转只付「重开 +
//! 解一帧」的价，画面与目标时刻最多差一个 GOP。松手后回到精确路径时必须拿到
//! 与从未吸附过完全相同的帧——`docs/design/bcf/baocut-format-spec.md` §15.1 的「取哪一
//! 帧」硬承诺不受拖动影响。
//!
//! 只有原生流（macOS AVFoundation）答得出关键帧表；别的后端上吸附是 no-op，
//! 本文件的等价断言依然成立（近似帧 = 精确帧）。夹具用 ffmpeg 现生成，探测
//! 不到就整体跳过（仓库既有礼节）。
#![cfg(feature = "media")]

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;

use render_raster::{MediaStore, load_assets};
use serde_json::{Value, json};

const PLAN_FPS: f64 = 30.0;
const SOURCE_FPS: u32 = 30;
const DURATION_SECONDS: u32 = 6;
/// 固定 GOP：每 30 帧（1 秒）一个关键帧，吸附落点可以事先算出来。
const GOP_FRAMES: u32 = 30;

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// `testsrc` 每帧都带可见的帧计数，逐帧像素互不相同；`-g 30 -keyint_min 30
/// -sc_threshold 0` 把关键帧钉死在整秒上。
fn fixture() -> Option<(tempfile::TempDir, PathBuf)> {
    if !ffmpeg_available() {
        return None;
    }
    let dir = tempfile::tempdir().ok()?;
    let assets = dir.path().join("assets");
    std::fs::create_dir_all(&assets).ok()?;
    let source = format!("testsrc=size=160x90:rate={SOURCE_FPS}:duration={DURATION_SECONDS}");
    let gop = GOP_FRAMES.to_string();
    let ok = Command::new("ffmpeg")
        .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i", &source])
        .args(["-pix_fmt", "yuv420p", "-c:v", "libx264"])
        .args([
            "-g",
            &gop,
            "-keyint_min",
            &gop,
            "-sc_threshold",
            "0",
            "-bf",
            "0",
        ])
        .arg(assets.join("clip.mp4"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    ok.then_some((dir, assets))
}

fn video_doc() -> Value {
    json!({
        "meta": { "id": "snap", "width": 160, "height": 90, "fps": PLAN_FPS },
        "scenes": [ { "id": "s", "dur": DURATION_SECONDS, "desc": "关键帧吸附" } ],
        "assets": { "clip": { "type": "video", "src": "assets/clip.mp4" } },
        "tracks": [
            { "id": "main", "kind": "visual", "clips": [
                { "id": "shot", "start": 0, "end": DURATION_SECONDS, "element": {
                    "type": "video", "id": "v", "src": "$assets.clip",
                    "style": { "x": 0, "y": 0, "width": 160, "height": 90 } } }
            ] }
        ]
    })
}

fn store(dir: &Path) -> MediaStore {
    store_with_decoder(dir, None)
}

fn store_with_decoder(dir: &Path, decoder: Option<&str>) -> MediaStore {
    let doc = video_doc();
    let mut assets = load_assets(&doc, dir).expect("load_assets");
    assets.videos.get_mut("clip").unwrap().decoder = decoder.map(str::to_owned);
    let mut media = MediaStore::new(Arc::new(assets), PLAN_FPS);
    media.set_random_access(true);
    media
}

fn frame(media: &mut MediaStore, time: f64) -> Vec<u8> {
    media
        .video_frame("clip", time)
        .expect("取帧")
        .data()
        .to_vec()
}

/// 精确路径从未吸附过时在 `time` 取到的帧。
fn exact_frame(dir: &Path, time: f64) -> Vec<u8> {
    let mut media = store(dir);
    frame(&mut media, time)
}

/// 吸附中的帧要么等于目标时刻的精确帧（后端答不出关键帧表），要么等于目标
/// 之前那个整秒关键帧的精确帧；松手后精确请求拿到的帧与从未吸附过一致。
#[test]
fn snapping_lands_on_the_preceding_keyframe_and_releases_exactly() {
    let Some((dir, _assets)) = fixture() else {
        return;
    };
    let native = media_native::available();
    let mut media = store(dir.path());
    frame(&mut media, 0.0);
    media.set_keyframe_snap(true);
    // 3.5 s 落在 GOP 中间：关键帧在 3.0 s。
    let snapped = frame(&mut media, 3.5);
    let expected = if native {
        exact_frame(dir.path(), 3.0)
    } else {
        exact_frame(dir.path(), 3.5)
    };
    assert_eq!(snapped, expected, "拖动中 t=3.5 应落在它之前的关键帧上");
    // 原生流在同一 GOP 内复用近似帧；ffmpeg 后端不吸附，继续精确取帧。
    let expected_next = if native {
        snapped
    } else {
        exact_frame(dir.path(), 3.8)
    };
    assert!(
        frame(&mut media, 3.8) == expected_next,
        "同一 GOP 内的后续帧应遵守后端的吸附能力"
    );
    // 松手：精确路径必须给出与从未吸附过相同的帧。
    media.set_keyframe_snap(false);
    assert_eq!(
        frame(&mut media, 3.8),
        exact_frame(dir.path(), 3.8),
        "松手后的精确帧必须与从未吸附过一致"
    );
    // 之后顺序推进（播放）也不受影响。
    let step = 1.0 / PLAN_FPS;
    assert_eq!(
        frame(&mut media, 3.8 + step),
        exact_frame(dir.path(), 3.8 + step)
    );
}

/// 吸附时向后拖同样按关键帧取，且切回精确路径后向后跳的帧也正确。
#[test]
fn snapping_backwards_and_far_forward_stays_consistent() {
    let Some((dir, _assets)) = fixture() else {
        return;
    };
    let native = media_native::available();
    let mut media = store(dir.path());
    frame(&mut media, 4.2);
    media.set_keyframe_snap(true);
    let back = frame(&mut media, 1.4);
    let expected_back = exact_frame(dir.path(), if native { 1.0 } else { 1.4 });
    assert_eq!(back, expected_back, "向后拖应落在 1.0 s 的关键帧");
    let far = frame(&mut media, 5.9);
    let expected_far = exact_frame(dir.path(), if native { 5.0 } else { 5.9 });
    assert_eq!(far, expected_far, "远跳应落在 5.0 s 的关键帧");
    media.set_keyframe_snap(false);
    assert_eq!(frame(&mut media, 2.3), exact_frame(dir.path(), 2.3));
}

/// 默认关闭：不显式打开时行为与改动前一字不差（导出走的就是这条）。
#[test]
fn keyframe_snap_is_off_by_default() {
    let Some((dir, _assets)) = fixture() else {
        return;
    };
    let mut media = store(dir.path());
    frame(&mut media, 0.0);
    assert_eq!(frame(&mut media, 3.5), exact_frame(dir.path(), 3.5));
}

/// 点名 ffmpeg 的 H.264 解码器，在有原生后端的机器上也覆盖不吸附的路径。
#[test]
fn ffmpeg_keyframe_snap_keeps_exact_frames_within_the_same_gop() {
    let Some((dir, _assets)) = fixture() else {
        return;
    };
    let exact = |time| frame(&mut store_with_decoder(dir.path(), Some("h264")), time);
    let expected_start = exact(3.5);
    let expected_next = exact(3.8);
    assert!(
        expected_start != expected_next,
        "夹具在两个时刻必须是不同画面"
    );
    let mut media = store_with_decoder(dir.path(), Some("h264"));
    frame(&mut media, 0.0);
    assert_eq!(
        media.video_backend("clip"),
        Some(render_raster::media::FFMPEG_BACKEND)
    );
    media.set_keyframe_snap(true);
    assert!(frame(&mut media, 3.5) == expected_start);
    assert!(frame(&mut media, 3.8) == expected_next);
    media.set_keyframe_snap(false);
    assert!(frame(&mut media, 3.8) == expected_next);
}
