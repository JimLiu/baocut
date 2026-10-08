//! 随机访问跳转（`MediaStore::set_random_access`）的取帧等价性。
//!
//! 交互式预览拖 playhead 时会一次向前跳过成千上万帧，顺序抽干等于把整段视频
//! 解一遍（实测跳到 600 s ≈ 75 s 墙钟）。开启随机访问后远跳会重开解码器，但
//! `docs/design/bcf/baocut-format-spec.md` §15.1 的「取哪一帧」是硬承诺：重开路径与抽干
//! 路径必须落在**同一源帧**上，否则预览与导出会出现半帧错位。
//!
//! 夹具用 ffmpeg 现生成，探测不到就整体跳过（仓库既有礼节）。
//!
//! `media` 门内：本文件用 `LoadedAssets` / `MediaStore`（host 字节层），
//! `wasm-safe` 构建里不存在（设计 §9.1）。
#![cfg(feature = "media")]

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;

use render_raster::{MediaStore, load_assets};
use serde_json::{Value, json};

/// 合成帧率刻意与源帧率不同：目标时刻大多落在源帧的中间，能把「重开点该取哪
/// 一帧」的边界判定真的压出来。
const PLAN_FPS: f64 = 30.0;
const SOURCE_FPS: u32 = 24;
const DURATION_SECONDS: u32 = 6;

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// `testsrc` 每帧都带可见的帧计数，逐帧像素互不相同——错一帧就一定被字节对比
/// 抓到。
fn fixture() -> Option<(tempfile::TempDir, PathBuf)> {
    if !ffmpeg_available() {
        return None;
    }
    let dir = tempfile::tempdir().ok()?;
    let assets = dir.path().join("assets");
    std::fs::create_dir_all(&assets).ok()?;
    let source = format!("testsrc=size=160x90:rate={SOURCE_FPS}:duration={DURATION_SECONDS}");
    let ok = Command::new("ffmpeg")
        .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i", &source])
        .args(["-pix_fmt", "yuv420p", "-c:v", "libx264"])
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
        "meta": { "id": "seek", "width": 160, "height": 90, "fps": PLAN_FPS },
        "scenes": [ { "id": "s", "dur": DURATION_SECONDS, "desc": "随机访问" } ],
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

fn store(dir: &Path, random_access: bool) -> MediaStore {
    let doc = video_doc();
    let assets = Arc::new(load_assets(&doc, dir).expect("load_assets"));
    let mut media = MediaStore::new(assets, PLAN_FPS);
    media.set_random_access(random_access);
    media
}

/// 从 `0.0` 起顺序推进到 `times` 里的每个时刻，交出各自的帧字节。
/// `random_access = false` 时中间帧全部被抽干，那是导出走的路径。
fn frames_after_jump(dir: &Path, random_access: bool, times: &[f64]) -> Vec<Vec<u8>> {
    let mut media = store(dir, random_access);
    media.video_frame("clip", 0.0).expect("首帧");
    times
        .iter()
        .map(|time| {
            media
                .video_frame("clip", *time)
                .expect("取帧")
                .data()
                .to_vec()
        })
        .collect()
}

/// 远跳重开与顺序抽干取到同一源帧——§15.1「取哪一帧」的硬承诺。
///
/// 时刻刻意选在合成网格上但**不在源帧边界上**（30 fps 网格 / 24 fps 源），
/// 覆盖跳转点本身与跳转之后继续顺序前进的若干帧（验证网格没有被重开挪位）。
#[test]
fn a_far_forward_jump_lands_on_the_same_frame_as_draining() {
    let Some((dir, _assets)) = fixture() else {
        return;
    };
    let step = 1.0 / PLAN_FPS;
    let mut times = vec![4.0, 4.0 + step, 4.0 + 2.0 * step, 4.0 + 3.0 * step];
    // 跳转点之后再来一次后退与远跳，确认重开后的原点没有把网格带偏。
    times.extend([1.5, 1.5 + step, 5.5, 5.5 + step]);
    // 越过片尾会把 `eof` 置位，而远跳重开是 `!eof` 门控的：这里让两条路径都
    // 先冲出片尾再回到片内继续远跳，确认 `eof` 之后重开能力没有被永久关掉。
    times.extend([f64::from(DURATION_SECONDS) + 2.0, 2.0, 5.0]);
    let drained = frames_after_jump(dir.path(), false, &times);
    let jumped = frames_after_jump(dir.path(), true, &times);
    for (index, time) in times.iter().enumerate() {
        assert_eq!(
            drained[index], jumped[index],
            "t={time:.4} 的帧在抽干路径与重开路径上不一致"
        );
    }
}

/// 越过片尾时两条路径都冻结在同一张末帧上（重开点会夹到最后一个可解码时刻）。
#[test]
fn a_jump_past_the_end_freezes_on_the_same_last_frame() {
    let Some((dir, _assets)) = fixture() else {
        return;
    };
    let times = [f64::from(DURATION_SECONDS) + 3.0];
    let drained = frames_after_jump(dir.path(), false, &times);
    let jumped = frames_after_jump(dir.path(), true, &times);
    assert_eq!(drained[0], jumped[0], "片尾冻结帧应当一致");
}

/// 播放走到头之后继续逐帧前进（片段 / 项目比视频流长几十毫秒）：每一帧都冻结
/// 在同一张末帧上，回到片内再照常解码。
///
/// 回归：EOF 关掉解码器后，下一帧会在片尾之外重开一个空解码器，再拿新原点的
/// 帧号去比旧原点的 `last_idx`，误触 loop 折回守卫把末帧清掉，第二帧起报
/// 「无帧可读」——App 的 overlay 调度器随之进入失败态，重播时画面卡死。
#[test]
fn stepping_past_the_end_keeps_the_frozen_last_frame() {
    let Some((dir, _assets)) = fixture() else {
        return;
    };
    let end = f64::from(DURATION_SECONDS);
    let step = 1.0 / PLAN_FPS;
    let last = frames_after_jump(dir.path(), false, &[end + 3.0]).remove(0);
    for random_access in [false, true] {
        let mut media = store(dir.path(), random_access);
        media.video_frame("clip", 0.0).expect("首帧");
        for tick in -4..8 {
            let time = end + f64::from(tick) * step;
            let frame = media.video_frame("clip", time).unwrap_or_else(|error| {
                panic!("random_access={random_access} t={time:.4}: {error:#}")
            });
            if tick >= 1 {
                assert_eq!(
                    frame.data(),
                    last.as_slice(),
                    "random_access={random_access} t={time:.4} 应冻结在末帧"
                );
            }
        }
        let inside = media.video_frame("clip", 1.0).expect("回到片内");
        assert_ne!(inside.data(), last.as_slice(), "回到片内不能还冻结在末帧");
    }
}

/// 冷启动第一次取帧就落在片尾之外（seek 到项目末尾）：退回去找到末帧冻结，
/// 与从头抽干走到片尾交出同一张，而不是报「无帧可读」；之后继续前进仍是它。
#[test]
fn a_first_request_past_the_end_freezes_on_the_last_frame() {
    let Some((dir, _assets)) = fixture() else {
        return;
    };
    let end = f64::from(DURATION_SECONDS);
    let last = frames_after_jump(dir.path(), false, &[end + 3.0]).remove(0);
    for random_access in [false, true] {
        let mut media = store(dir.path(), random_access);
        for time in [end + 0.05, end + 0.1, end + 2.0] {
            let frame = media.video_frame("clip", time).unwrap_or_else(|error| {
                panic!("random_access={random_access} t={time:.4}: {error:#}")
            });
            assert_eq!(
                frame.data(),
                last.as_slice(),
                "random_access={random_access} t={time:.4} 应冻结在末帧"
            );
        }
    }
}

/// 默认关闭：不显式打开时行为与改动前一字不差（导出走的就是这条）。
#[test]
fn random_access_is_off_by_default() {
    let Some((dir, _assets)) = fixture() else {
        return;
    };
    let doc = video_doc();
    let assets = Arc::new(load_assets(&doc, dir.path()).expect("load_assets"));
    let mut default_store = MediaStore::new(assets, PLAN_FPS);
    default_store.video_frame("clip", 0.0).expect("首帧");
    let default_frame = default_store.video_frame("clip", 4.0).expect("取帧");
    let drained = frames_after_jump(dir.path(), false, &[4.0]);
    assert_eq!(default_frame.data(), drained[0].as_slice());
}
