//! 单帧抽取的真实媒体验收。
//!
//! 夹具与判读工具在 `common`（与顺序帧流验收共用）：ffmpeg 现生成的三段单色
//! （红 / 绿 / 蓝，各压一条水平亮度斜坡），断言是可判读的颜色谓词而不是像素
//! golden——按 `docs/design/bcf/baocut-format-spec.md` §15.1，视频帧解码像素只承诺语义
//! 等价 + 容差，缩略图不是 golden。
//!
//! 跨后端对拍（原生 ↔ ffmpeg）的 SSIM 算法是 `bcut-render::imgcmp` 的共享实现
//! （8×8 滑动窗口、逐通道 RGBA、样本方差 + 4× 降采样，口径与 `bcut ssim` /
//! `bcut compare` 一致，WP5b 收敛前三处各有一份互不一致的最小实现）。只作为
//! dev-dependency 拉入，不进生产二进制。
//!
//! 探测不到 ffmpeg 就整体跳过（仓库既有礼节：无夹具不算失败）。

mod common;

use media_native::{available, extract_frame_rgba, scaled_height};
use render_raster::imgcmp;

use common::{HEIGHT, SEGMENT, WIDTH, dominant, ffmpeg_frame, fixture, to_pixmap};

#[test]
fn each_segment_yields_its_own_colour() {
    if !available() {
        return;
    }
    let Some((_dir, media)) = fixture() else {
        return;
    };
    for (time, expected) in [(0.5, "red"), (1.5, "green"), (2.5, "blue")] {
        let frame = extract_frame_rgba(&media, time, 168).expect("原生取帧");
        assert_eq!(dominant(&frame), expected, "t={time} 应取到 {expected} 段");
    }
}

/// 时间精度：段边界两侧 ±1 帧内不得串段。容差为零的精确取帧是这条断言的全部
/// 内容——退回"最近关键帧"时 1.033s 会取到 1.0s 之前的红帧（GOP = 30 帧）。
#[test]
fn frames_do_not_bleed_across_a_segment_boundary() {
    if !available() {
        return;
    }
    let Some((_dir, media)) = fixture() else {
        return;
    };
    let frame_step = 1.0 / 30.0;
    // 红段最后一帧（29/30 ≈ 0.967s）与绿段第一帧（1.0s）。
    let last_red = SEGMENT - frame_step * 0.5;
    let first_green = SEGMENT + frame_step * 0.5;
    assert_eq!(
        dominant(&extract_frame_rgba(&media, last_red, 168).expect("原生取帧")),
        "red",
        "t={last_red} 仍在红段内"
    );
    assert_eq!(
        dominant(&extract_frame_rgba(&media, first_green, 168).expect("原生取帧")),
        "green",
        "t={first_green} 已进入绿段"
    );
}

#[test]
fn frames_are_scaled_to_the_requested_width_with_an_even_height() {
    if !available() {
        return;
    }
    let Some((_dir, media)) = fixture() else {
        return;
    };
    for width in [84_u32, 168, 320, 640] {
        let frame = extract_frame_rgba(&media, 0.5, width).expect("原生取帧");
        assert_eq!(frame.width, width, "宽度必须恰为请求值");
        assert_eq!(
            frame.height,
            scaled_height(WIDTH, HEIGHT, width),
            "高度必须按源宽高比推出并偶数对齐"
        );
        assert_eq!(frame.height % 2, 0);
        assert_eq!(
            frame.data.len(),
            frame.width as usize * frame.height as usize * 4
        );
        assert!(
            frame.data.chunks_exact(4).all(|pixel| pixel[3] == 255),
            "视频帧必须交出不透明 alpha"
        );
    }
}

/// 跨解码后端对拍：同一文件同一 t，原生帧 vs ffmpeg 帧 SSIM（§15.1 的跨后端
/// 语义等价判据，诊断须带两侧后端标识）。
///
/// 判据用 [`imgcmp::Comparison::ssim_downsampled`]、门槛就是 §15.1 文字里那个
/// **0.95**。WP6a 之前这里写的是 0.90，因为当时夹具用左白右黑两条**硬边**色块
/// 来避免 SSIM 在纯色上退化，而 4:2:0 的色度只有一半水平分辨率——AVFoundation
/// 与 swscale 在那条边上的色度上采样 + 缩放插值各不相同，滑窗 SSIM 把它放大成
/// 0.91 分（同一次测量里 `flat_max_deviation` 只有 3–13，说明色彩矩阵本身很接近，
/// 掉分全在边上）。夹具改成连续亮度斜坡（`common::fixture`）后结构项照样有内容、
/// 却没有任何硬边，实测：
///
/// | t | ssim | ssim_downsampled | maxDeviation | flatMaxDeviation |
/// | --- | --- | --- | --- | --- |
/// | 0.5s（红段） | 0.9846 | 0.9847 | 15 | 13 |
/// | 1.5s（绿段） | 0.9779 | 0.9765 | 15 | 13 |
/// | 2.5s（蓝段） | 0.9827 | 0.9872 | 14 | 5 |
///
/// 剩下的差异就是两条路径 YUV→RGB 矩阵实现与缩放器的正常分歧，正是 §15.1 想量
/// 的那个量。`edge_share` 在斜坡上接近 100%（几乎每个像素的 3×3 邻域都不恒定），
/// 那是这个诊断字段对连续渐变的正常读数，不是回归信号。
#[test]
fn native_frames_match_the_ffmpeg_fallback_within_the_cross_backend_tolerance() {
    const SSIM_FLOOR: f64 = 0.95;
    if !available() {
        return;
    }
    let Some((_dir, media)) = fixture() else {
        return;
    };
    for time in [0.5_f64, 1.5, 2.5] {
        let native = extract_frame_rgba(&media, time, 168).expect("原生取帧");
        let Some(reference) = ffmpeg_frame(&media, time, 168) else {
            return;
        };
        assert_eq!(
            (native.width, native.height),
            (reference.width, reference.height),
            "两条路径的尺寸契约必须一致"
        );
        let measured = imgcmp::compare(&to_pixmap(&native), &to_pixmap(&reference))
            .expect("尺寸已在上面断言过一致");
        assert!(
            measured.ssim_downsampled >= SSIM_FLOOR,
            "t={time}s 跨后端 SSIM（4× 降采样）{:.4} 低于 {SSIM_FLOOR}（后端 {} ↔ ffmpeg，\
             全分辨率 ssim={:.4}，逐通道最大偏差 {}，平坦区最大偏差 {}）",
            measured.ssim_downsampled,
            media_native::backend(),
            measured.ssim,
            measured.max_deviation,
            measured.flat_max_deviation,
        );
        println!(
            "t={time}s ssim={:.4} ssim_downsampled={:.4} max={} flat={} edge={:.3}%",
            measured.ssim,
            measured.ssim_downsampled,
            measured.max_deviation,
            measured.flat_max_deviation,
            measured.edge_share * 100.0
        );
    }
}

#[test]
fn a_missing_file_is_an_error_not_a_panic() {
    if !available() {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    assert!(extract_frame_rgba(&dir.path().join("nope.mp4"), 0.0, 168).is_err());
}
