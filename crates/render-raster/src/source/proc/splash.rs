//! `proc:"splash"`：`at` 时刻在 `(x, y)` 溅起的一簇水珠 + 一圈扩散的水冠。
//! 一次性：`at` 之前、`at + life` 之后一条 op 都不发。多次溅落用多个实例。
use super::{circle, color, fill, stroke, unit};
use crate::drawop::FrameBuilder;
use scene_primitives::proc::Splash;
use tiny_skia::Transform;

pub(super) fn record(
    splash: &Splash,
    seed: u64,
    w: f64,
    h: f64,
    time: f64,
    tf: Transform,
    b: &mut FrameBuilder,
) {
    let age = time - splash.at;
    if !(0.0..splash.life).contains(&age) {
        return;
    }
    let k = age / splash.life;
    let (ox, oy) = (splash.x * w, splash.y * h);
    let g = splash.gravity * h;

    let mut drops = Vec::new();
    for i in 0..splash.count as u64 {
        // 方向：以正上方为轴 ±0.8 rad 的扇面。
        let a = (unit(seed, i, 1) - 0.5) * 1.6;
        let v = splash.speed * h * (0.4 + 0.6 * unit(seed, i, 2));
        let (vx, vy) = (v * libm::sin(a), -v * libm::cos(a));
        // 落回起跳线就消失：水珠不穿过水面。
        if g > 0.0 && age > -2.0 * vy / g {
            continue;
        }
        let x = ox + vx * age;
        let y = oy + vy * age + 0.5 * g * age * age;
        let r = splash.size * (0.5 + 0.5 * unit(seed, i, 3)) * (1.0 - 0.5 * k);
        circle(&mut drops, x, y, r, r);
    }
    fill(drops, color(&splash.color, 1.0 - k), tf, b);

    // 水冠：扁椭圆，前 60 % 寿命内扩开并淡出。
    let crown = (age / (splash.life * 0.6)).min(1.0);
    if crown < 1.0 {
        let ease = 1.0 - (1.0 - crown) * (1.0 - crown);
        let rx = splash.size * 2.0 + splash.speed * h * 0.35 * ease;
        let mut ring = Vec::new();
        circle(&mut ring, ox, oy, rx, rx * 0.22);
        stroke(
            ring,
            color(&splash.color, 0.8 * (1.0 - crown)),
            (splash.size * 0.6).max(0.5),
            tf,
            b,
        );
    }
}
