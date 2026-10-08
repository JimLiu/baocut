//! 原生解码验收共用的夹具与判读工具（单帧抽取与顺序帧流两个测试目标共享）。
//!
//! 夹具由 ffmpeg 现生成，因此断言可以是**可判读的颜色谓词**而不是像素 golden
//! ——按 `docs/design/bcf/baocut-format-spec.md` §15.1，视频帧解码像素只承诺语义等价 +
//! 容差。探测不到 ffmpeg 就整体跳过（仓库既有礼节：无夹具不算失败）。

// 每个集成测试目标都把这个模块整份编进去，各自只用其中一部分。
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use media_native::RgbaFrame;

pub const WIDTH: u32 = 320;
pub const HEIGHT: u32 = 180;
/// 三段纯色的时长（秒），顺序为红 / 绿 / 蓝。
pub const SEGMENT: f64 = 1.0;
/// 夹具的源帧率。
pub const SOURCE_FPS: f64 = 30.0;

pub fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// 红 / 绿 / 蓝各 1 秒、30fps、每秒一个关键帧的 320x180 H.264。
///
/// 每段一秒是刻意的：段边界处取帧只要串了段，颜色谓词立刻失败——这比"时间戳
/// 差了多少毫秒"更能说明"取的是不是覆盖 t 的那一帧"。
///
/// 每段压一条**从左到右的线性亮度斜坡**（0.2 → 1.0 倍），原因有两条：
///
/// 1. **纯色画面是 SSIM 的病态输入**。窗口内方差为零时 SSIM 退化成纯亮度比，
///    而"整幅小幅偏置"恰恰是 §15.1 明说 SSIM 不该敏感、要交给逐通道偏差去看的
///    那一类差异（纯蓝的灰度只有 29，几个色阶的矩阵差异就能把亮度比压到 0.8）。
///    斜坡让结构项有内容，SSIM 才在量它该量的东西。
/// 2. **不能用硬边**。早期版本用的是左白右黑两条色块，实测把跨后端 SSIM 压到
///    0.91、逐通道最大偏差 99——根因不是解码质量（平坦区最大偏差只有 1），而是
///    4:2:0 的色度只有一半水平分辨率，AVFoundation 与 swscale 在色度上采样与
///    缩放边缘各自的插值不同，滑窗 SSIM 会把这条过渡带放大。换成连续斜坡后
///    实测 SSIM ≥ 0.976、最大偏差 ≤ 15，两条路径的差异回到色彩矩阵实现这个
///    量级——那才是 §15.1 想量的东西。
///
/// 三通道等比缩放，主导色判定不受影响（[`dominant`] 看的是通道间的相对关系）。
pub fn fixture() -> Option<(tempfile::TempDir, PathBuf)> {
    if !ffmpeg_available() {
        return None;
    }
    let dir = tempfile::tempdir().ok()?;
    let media = dir.path().join("rgb-segments.mp4");
    // 逐像素乘一条水平线性斜坡（0.2 → 1.0）。三通道同一个系数。
    let ramp = |channel: char| format!("{channel}='{channel}(X,Y)*(0.2+0.8*X/W)'");
    let gradient = format!("geq={}:{}:{}", ramp('r'), ramp('g'), ramp('b'));
    let source = |color: &str| {
        format!("color=c={color}:s={WIDTH}x{HEIGHT}:r={SOURCE_FPS}:d={SEGMENT},{gradient}")
    };
    let status = Command::new("ffmpeg")
        .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i"])
        .arg(source("red"))
        .args(["-f", "lavfi", "-i"])
        .arg(source("green"))
        .args(["-f", "lavfi", "-i"])
        .arg(source("blue"))
        .args([
            "-filter_complex",
            "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
            "-map",
            "[v]",
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "libx264",
            "-g",
            "30",
            // 显式写全色彩标签。不写时容器里是 `unknown`，ffmpeg 按分辨率猜
            // BT.601、AVFoundation 按自己的规则猜——两边猜的矩阵不同，纯色块的
            // YUV→RGB 结果能差出几十个色阶，量到的就不再是解码质量而是标签缺失。
            // 真实素材都是带标签的，夹具没有理由比它更差。
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-colorspace",
            "bt709",
            "-color_range",
            "tv",
        ])
        .arg(&media)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()?;
    (status.success() && media.is_file()).then_some((dir, media))
}

/// 迁移前的 ffmpeg 提帧配方（`-ss` 在 `-i` 前），解成裸 RGBA 供对拍。
pub fn ffmpeg_frame(media: &Path, time: f64, width: u32) -> Option<RgbaFrame> {
    let output = Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-ss",
            &format!("{time:.3}"),
        ])
        .arg("-i")
        .arg(media)
        .args(["-frames:v", "1", "-vf", &format!("scale={width}:-2")])
        .args(["-f", "rawvideo", "-pix_fmt", "rgba", "-"])
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let height = u32::try_from(output.stdout.len() / (width as usize * 4)).ok()?;
    RgbaFrame::new(width, height, output.stdout).ok()
}

/// 迁移前 `bcut-render::media::VideoReader` 的顺序解码配方：`-ss` 在 `-i` 前、
/// 输出重采样到合成 fps 的裸 RGBA 流。返回按输出顺序切好的整帧。
pub fn ffmpeg_frame_stream(media: &Path, from: f64, fps: f64) -> Option<Vec<RgbaFrame>> {
    let output = Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-ss",
            &format!("{from:.6}"),
        ])
        .arg("-i")
        .arg(media)
        .args([
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-r",
            &format!("{fps}"),
            "-",
        ])
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stride = WIDTH as usize * HEIGHT as usize * 4;
    Some(
        output
            .stdout
            .chunks_exact(stride)
            .map(|bytes| RgbaFrame::new(WIDTH, HEIGHT, bytes.to_vec()).expect("整帧"))
            .collect(),
    )
}

/// 主导色判定：三通道里谁明显最大。纯色段经 H.264 4:2:0 往返后不会是精确的
/// 255/0/0，但主导关系是稳的，跨解码器也稳。
pub fn dominant(frame: &RgbaFrame) -> &'static str {
    let mut totals = [0_u64; 3];
    for pixel in frame.data.chunks_exact(4) {
        totals[0] += u64::from(pixel[0]);
        totals[1] += u64::from(pixel[1]);
        totals[2] += u64::from(pixel[2]);
    }
    let max = totals.iter().copied().max().unwrap_or(0);
    // 主导通道必须比次高通道高出一大截，否则说明帧不是纯色（串段/混帧）。
    let second = totals.iter().copied().filter(|value| *value != max).max();
    if second.is_some_and(|second| max < second * 3 / 2) {
        return "mixed";
    }
    match totals.iter().position(|value| *value == max) {
        Some(0) => "red",
        Some(1) => "green",
        Some(2) => "blue",
        _ => "mixed",
    }
}

/// `RgbaFrame`（straight alpha，视频帧恒不透明）→ `tiny_skia::Pixmap`
/// （premultiplied）。alpha 恒为 255 时两种约定按字节相同，直接搬字节即可，
/// 不需要真的跑一遍预乘。
pub fn to_pixmap(frame: &RgbaFrame) -> tiny_skia::Pixmap {
    let size = tiny_skia::IntSize::from_wh(frame.width, frame.height).expect("非零尺寸");
    tiny_skia::Pixmap::from_vec(frame.data.clone(), size).expect("RGBA 字节数与尺寸相符")
}
