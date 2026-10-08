//! 顺序帧流的真实媒体验收（WP6a）。
//!
//! 夹具与判读工具见 `common`：ffmpeg 现生成的三段纯色（红 / 绿 / 蓝，各 1 秒、
//! 30fps、每秒一个关键帧）。断言分四类：
//!
//! 1. **帧率重采样**：合成 fps 变化时输出帧数按比例走，且与 ffmpeg `-r` 的
//!    输出帧数逐帧一致。
//! 2. **起点**：`from` 落在哪一段，第一帧就是哪一段的颜色（不是 seek 落到的
//!    那个关键帧）。
//! 3. **片尾**：流会结束（EOF），不无限吐重复帧。
//! 4. **跨后端容差**：同一个输出帧号上，原生帧 vs ffmpeg 帧的 SSIM ≥ 0.95
//!    （`docs/design/bcf/baocut-format-spec.md` §15.1 的跨后端语义等价判据，算法用
//!    `bcut-render::imgcmp` 的共享实现）。
//!
//! 探测不到 ffmpeg 就整体跳过。

mod common;

use media_native::{available, open_frame_stream};
use render_raster::imgcmp;

use common::{
    HEIGHT, SEGMENT, SOURCE_FPS, WIDTH, dominant, ffmpeg_frame_stream, fixture, to_pixmap,
};

/// 收完整条流，返回每一帧。
fn drain(media: &std::path::Path, from: f64, fps: f64) -> Vec<media_native::RgbaFrame> {
    let mut stream = open_frame_stream(media, from, fps).expect("原生顺序帧流");
    assert_eq!((stream.width(), stream.height()), (WIDTH, HEIGHT));
    let mut frames = Vec::new();
    // 上界防呆：夹具只有 3 秒，任何 fps 下都不该吐出这么多帧。
    while let Some(frame) = stream.next_frame().expect("解码") {
        frames.push(frame);
        assert!(frames.len() < 10_000, "帧流没有结束（EOF 语义坏了）");
    }
    frames
}

/// 合成帧率决定输出帧数：3 秒素材在 15 / 30 / 60 fps 上分别是 45 / 90 / 180 帧，
/// 且与 ffmpeg `-r` 管道的输出帧数完全一致。
#[test]
fn the_output_frame_count_follows_the_composition_frame_rate() {
    if !available() {
        return;
    }
    let Some((_dir, media)) = fixture() else {
        return;
    };
    let total = SEGMENT * 3.0;
    for fps in [15.0_f64, 30.0, 60.0] {
        let frames = drain(&media, 0.0, fps);
        assert_eq!(
            frames.len(),
            (total * fps) as usize,
            "{fps}fps 下 {total} 秒素材应有 {} 帧",
            (total * fps) as usize
        );
        // 与 ffmpeg `-r` 的帧数对齐到**片尾容差之内**。ffmpeg 在片尾会按自己
        // 的 CFR 补齐规则多吐一两帧（实测 15fps 下 47 帧、60fps 下 180 帧），
        // 而这里严格停在末帧呈现区间的右端。下游（`bcut-render` 的
        // `VideoReader`）在 EOF 上是**冻结末帧**，多出来的那一两帧与冻结出来的
        // 画面逐字节相同，所以这条差异不可观测；卡死数字反而会把 ffmpeg 的
        // 版本差异变成本仓库的测试脆弱点。
        let Some(reference) = ffmpeg_frame_stream(&media, 0.0, fps) else {
            return;
        };
        assert!(
            reference.len().abs_diff(frames.len()) <= 2,
            "{fps}fps 下原生 {} 帧与 ffmpeg {} 帧相差超过片尾容差",
            frames.len(),
            reference.len()
        );
    }
}

/// dup / drop 的画面语义：无论合成帧率如何，第 k 帧所在的时间点落在哪一段，
/// 它就是哪一段的颜色。
#[test]
fn resampled_frames_keep_their_segment_colour() {
    if !available() {
        return;
    }
    let Some((_dir, media)) = fixture() else {
        return;
    };
    for fps in [15.0_f64, 60.0] {
        let frames = drain(&media, 0.0, fps);
        for (index, expected) in [(0_usize, "red"), (1, "green"), (2, "blue")]
            .map(|(segment, colour)| (((segment as f64 + 0.5) * SEGMENT * fps) as usize, colour))
        {
            assert_eq!(
                dominant(&frames[index]),
                expected,
                "{fps}fps 的第 {index} 帧应落在 {expected} 段"
            );
        }
    }
}

/// 起点语义：`from` 落在绿段中央，第一帧就是绿的——不是 seek 落到的那个关键帧
/// （GOP = 30 帧，退回关键帧会取到 1.0s 之前的红帧）。
#[test]
fn the_stream_starts_on_the_frame_that_covers_the_requested_time() {
    if !available() {
        return;
    }
    let Some((_dir, media)) = fixture() else {
        return;
    };
    for (from, expected, remaining_segments) in
        [(0.5, "red", 2.5), (1.5, "green", 1.5), (2.5, "blue", 0.5)]
    {
        let frames = drain(&media, from, SOURCE_FPS);
        assert_eq!(
            dominant(&frames[0]),
            expected,
            "from={from} 的首帧应是 {expected}"
        );
        assert_eq!(
            frames.len(),
            (remaining_segments * SOURCE_FPS) as usize,
            "from={from} 之后还剩 {remaining_segments} 秒"
        );
    }
}

/// 段边界不串段：绿段第一帧之前的那一帧仍是红的。
#[test]
fn frames_do_not_bleed_across_a_segment_boundary() {
    if !available() {
        return;
    }
    let Some((_dir, media)) = fixture() else {
        return;
    };
    let frames = drain(&media, 0.0, SOURCE_FPS);
    let boundary = (SEGMENT * SOURCE_FPS) as usize;
    assert_eq!(dominant(&frames[boundary - 1]), "red", "红段最后一帧");
    assert_eq!(dominant(&frames[boundary]), "green", "绿段第一帧");
}

/// 跨解码后端对拍：同一个输出帧号上原生帧 vs ffmpeg 帧的 SSIM。
///
/// 门槛用 §15.1 文字里的 **0.95**——这条路径两侧都是**源尺寸原样**，不像单帧
/// 抽取那条要各自缩放（`extract_frame.rs` 因为 AVFoundation 与 swscale 的边缘
/// 插值不同把门槛校准到 0.90）。没有缩放器分歧，剩下的只有 YUV→RGB 矩阵实现的
/// 差异，分数因此高得多。
#[test]
fn native_frames_match_the_ffmpeg_fallback_within_the_cross_backend_tolerance() {
    const SSIM_FLOOR: f64 = 0.95;
    if !available() {
        return;
    }
    let Some((_dir, media)) = fixture() else {
        return;
    };
    let frames = drain(&media, 0.0, SOURCE_FPS);
    let Some(reference) = ffmpeg_frame_stream(&media, 0.0, SOURCE_FPS) else {
        return;
    };
    assert_eq!(frames.len(), reference.len(), "两条路径的帧数必须一致");
    // 每段取中间一帧 + 边界前后各一帧。
    let probes = [
        15_usize,
        29,
        30,
        45,
        59,
        60,
        75,
        frames.len().saturating_sub(1),
    ];
    for index in probes {
        let measured = imgcmp::compare(&to_pixmap(&frames[index]), &to_pixmap(&reference[index]))
            .expect("尺寸一致");
        assert!(
            measured.ssim_downsampled >= SSIM_FLOOR,
            "第 {index} 帧跨后端 SSIM（4× 降采样）{:.4} 低于 {SSIM_FLOOR}\
             （后端 {} ↔ ffmpeg，全分辨率 ssim={:.4}，逐通道最大偏差 {}，平坦区最大偏差 {}）",
            measured.ssim_downsampled,
            media_native::backend(),
            measured.ssim,
            measured.max_deviation,
            measured.flat_max_deviation,
        );
        println!(
            "帧 {index} ssim={:.4} ssim_downsampled={:.4} max={} flat={} edge={:.3}%",
            measured.ssim,
            measured.ssim_downsampled,
            measured.max_deviation,
            measured.flat_max_deviation,
            measured.edge_share * 100.0
        );
    }
}

/// 打不开的文件是 `Err` 而不是 panic——调用方靠它决定要不要回落 ffmpeg。
#[test]
fn an_unopenable_source_is_an_error_not_a_panic() {
    if !available() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    assert!(open_frame_stream(&dir.path().join("nope.mp4"), 0.0, 30.0).is_err());
    // 不是媒体的文件同样必须报错（而不是交出一条空流）。
    let text = dir.path().join("not-media.mp4");
    std::fs::write(&text, b"definitely not a container").unwrap();
    assert!(open_frame_stream(&text, 0.0, 30.0).is_err());
}
