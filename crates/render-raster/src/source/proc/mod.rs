//! 程序化画面源 `type:"proc"`（规范 §6.12）：雨、溅落、夜空。
//!
//! 与 [`super::confetti`] 同一纪律——**没有逐帧状态**。每一帧都是
//! `(局部秒 τ, seed, 参数, 元素盒)` 的闭式函数：`bcut render --t 7.5` 直接跳到
//! 第 225 帧、导出按 stride 把帧分给多个 worker，画出来的都是同一批字节。
//! 随机性只来自 [`unit`] 的整数哈希（splitmix64），超越函数只走 `libm`
//! （`tests/proc_libm_only.rs` 文本扫描把关），native 与 wasm32 逐位一致。
//!
//! 坐标系是**元素盒本地像素**（左上原点，y 向下），`tf` 把它映射到 surface；
//! 解析与缺省在 `scene_primitives::proc`，这里只把参数变成 DrawOp。
mod noise;
mod rain;
mod sky;
mod splash;

use crate::drawop::{Color4, DrawOp, FrameBuilder, PathData, PathSeg};
use crate::source::kernel::{path_seg_close, path_seg_cubic, path_seg_line, path_seg_move};
use scene_primitives::Rgba;
use scene_primitives::proc::{ProcKind, ProcSource};
use tiny_skia::Transform;

/// 把一个 proc 节点在局部秒 `time` 的画面录进 `b`。`w × h` 是元素盒。
pub fn record_proc(
    proc: &ProcSource,
    w: f64,
    h: f64,
    time: f64,
    tf: Transform,
    b: &mut FrameBuilder,
) {
    if !(w > 0.0 && h > 0.0) {
        return;
    }
    match &proc.kind {
        ProcKind::Rain(rain) => rain::record(rain, proc.seed, w, h, time, tf, b),
        ProcKind::Splash(splash) => splash::record(splash, proc.seed, w, h, time, tf, b),
        ProcKind::Sky(sky) => sky::record(sky, proc.seed, w, h, time, tf, b),
    }
}

/// splitmix64 终混：整数进、均匀 64 位出。
pub(crate) fn mix(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// `[0, 1)` 均匀数：`(seed, 编号, 用途)` 三元组各自独立。
pub(crate) fn unit(seed: u64, index: u64, salt: u64) -> f64 {
    let h = mix(seed ^ mix(index ^ salt.wrapping_mul(0xD6E8_FEB8_6659_FD93)));
    (h >> 11) as f64 / (1u64 << 53) as f64
}

pub(crate) fn mat(tf: Transform) -> [f32; 6] {
    [tf.sx, tf.ky, tf.kx, tf.sy, tf.tx, tf.ty]
}

/// 非预乘颜色，`alpha` 乘进颜色自带的 a。
pub(crate) fn color(c: &Rgba, alpha: f64) -> Color4 {
    [
        (c.r / 255.0).clamp(0.0, 1.0) as f32,
        (c.g / 255.0).clamp(0.0, 1.0) as f32,
        (c.b / 255.0).clamp(0.0, 1.0) as f32,
        (c.a * alpha).clamp(0.0, 1.0) as f32,
    ]
}

/// 四段三次贝塞尔近似的圆（κ = 0.5522847498），不经三角函数。
pub(crate) fn circle(out: &mut Vec<PathSeg>, cx: f64, cy: f64, rx: f64, ry: f64) {
    const K: f64 = 0.552_284_749_8;
    let (kx, ky) = (rx * K, ry * K);
    out.push(path_seg_move(cx + rx, cy));
    out.push(path_seg_cubic(
        (cx + rx, cy + ky),
        (cx + kx, cy + ry),
        (cx, cy + ry),
    ));
    out.push(path_seg_cubic(
        (cx - kx, cy + ry),
        (cx - rx, cy + ky),
        (cx - rx, cy),
    ));
    out.push(path_seg_cubic(
        (cx - rx, cy - ky),
        (cx - kx, cy - ry),
        (cx, cy - ry),
    ));
    out.push(path_seg_cubic(
        (cx + kx, cy - ry),
        (cx + rx, cy - ky),
        (cx + rx, cy),
    ));
    out.push(path_seg_close());
}

pub(crate) fn rect(out: &mut Vec<PathSeg>, w: f64, h: f64) {
    out.push(path_seg_move(0.0, 0.0));
    out.push(path_seg_line(w, 0.0));
    out.push(path_seg_line(w, h));
    out.push(path_seg_line(0.0, h));
    out.push(path_seg_close());
}

/// 把盒子裁出来：雨丝与云不越界。与 `PopClip` 成对，不跨 `PushLayer`。
pub(crate) fn push_box_clip(w: f64, h: f64, tf: Transform, b: &mut FrameBuilder) {
    let mut segs = Vec::new();
    rect(&mut segs, w, h);
    let path = b.path_id(PathData(segs));
    b.push(DrawOp::ClipPath { path, tf: mat(tf) });
}

pub(crate) fn fill(segs: Vec<PathSeg>, color: Color4, tf: Transform, b: &mut FrameBuilder) {
    if segs.is_empty() || color[3] <= 0.0 {
        return;
    }
    let path = b.path_id(PathData(segs));
    b.push(DrawOp::FillPath {
        path,
        color,
        tf: mat(tf),
    });
}

pub(crate) fn stroke(
    segs: Vec<PathSeg>,
    color: Color4,
    width: f64,
    tf: Transform,
    b: &mut FrameBuilder,
) {
    if segs.is_empty() || color[3] <= 0.0 || width <= 0.0 {
        return;
    }
    let path = b.path_id(PathData(segs));
    b.push(DrawOp::StrokePath {
        path,
        color,
        width: width as f32,
        tf: mat(tf),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_is_uniform_enough_and_salted() {
        let n = 20_000;
        let mean = (0..n).map(|i| unit(7, i, 1)).sum::<f64>() / n as f64;
        assert!((mean - 0.5).abs() < 0.01, "{mean}");
        assert_ne!(unit(7, 3, 1), unit(7, 3, 2));
        assert_ne!(unit(7, 3, 1), unit(8, 3, 1));
        assert!((0..n).all(|i| (0.0..1.0).contains(&unit(1, i, 9))));
    }
}
