//! Hanging-arm weights and bone transforms, following engine/arms.js.
use super::rig::{rotate, Parameters};
use crate::rig::{Arms, Body, Point};
use serde::{Deserialize, Serialize};

fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a).max(1e-6)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
fn finite(v: f64) -> f64 {
    if v.is_finite() {
        v
    } else {
        0.0
    }
}
fn turn(p: Point, origin: Point, angle: f64) -> Point {
    rotate(p, origin, angle.cos(), angle.sin())
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ArmWeights {
    pub arm: f64,
    pub forearm: f64,
}
#[derive(Debug, Clone, Copy, Serialize)]
pub struct ArmFrame {
    pub shoulder: Point,
    pub elbow: Point,
    pub swing: f64,
    pub bend: f64,
}

pub fn weights(arms: &Arms, body: &Body, x: f64, y: f64) -> [ArmWeights; 2] {
    std::array::from_fn(|i| {
        let b = if i == 0 { &arms.left } else { &arms.right };
        let upper = (b.elbow[1] - b.shoulder[1]).max(1.0);
        let lower = (b.wrist[1] - b.elbow[1]).max(1.0);
        let band = (upper.min(lower).min(body.chest.ry) * 0.2).max(1.0);
        let mut j = 0;
        while j < b.split.len() - 2 && y > b.split[j + 1][1] {
            j += 1;
        }
        let (a, c) = (b.split[j], b.split[j + 1]);
        let t = ((y - a[1]) / (c[1] - a[1]).max(1e-6)).clamp(0.0, 1.0);
        let boundary = a[0] + (c[0] - a[0]) * t;
        let outside = if i == 0 { boundary - x } else { x - boundary };
        let hard = if outside >= 0.0 { 1.0 } else { 0.0 };
        let soft = smooth(-band, band, outside);
        let gap = smooth(b.split[0][1] - band, b.split[0][1], y);
        let membership = soft + (hard - soft) * gap;
        let end = b.split.last().unwrap()[1];
        ArmWeights {
            arm: membership
                * smooth(b.shoulder[1], b.shoulder[1] + upper * 0.55, y)
                * (1.0 - smooth(end, end + band, y)),
            forearm: smooth(b.elbow[1] - band, b.elbow[1] + band, y),
        }
    })
}
pub fn frame(arms: &Arms, p: &Parameters, move_point: impl Fn(Point) -> Point) -> [ArmFrame; 2] {
    let swing = arms.swing.clamp(0.0, 10.0) * std::f64::consts::PI / 180.0;
    let bend = arms.bend.clamp(0.0, 12.0) * std::f64::consts::PI / 180.0;
    let inward = arms.inward.clamp(0.0, 1.0);
    std::array::from_fn(|i| {
        let (b, sign, value, flex) = if i == 0 {
            (&arms.left, 1.0, p.arm_swing_l, p.elbow_bend_l)
        } else {
            (&arms.right, -1.0, p.arm_swing_r, p.elbow_bend_r)
        };
        let value = finite(value).clamp(-1.0, 1.0);
        ArmFrame {
            shoulder: move_point(b.shoulder),
            elbow: move_point(b.elbow),
            swing: sign * swing * value * if value < 0.0 { inward } else { 1.0 },
            bend: -sign * bend * finite(flex).clamp(0.0, 1.0),
        }
    })
}
pub fn apply(p: &mut Point, weights: &[ArmWeights; 2], frame: &[ArmFrame; 2]) {
    let original = *p;
    for (b, w) in frame.iter().zip(weights) {
        if w.arm == 0.0 || (b.swing == 0.0 && b.bend == 0.0) {
            continue;
        }
        let upper = if b.swing != 0.0 {
            turn(original, b.shoulder, b.swing)
        } else {
            original
        };
        let elbow = if b.swing != 0.0 {
            turn(b.elbow, b.shoulder, b.swing)
        } else {
            b.elbow
        };
        let lower = if b.bend != 0.0 {
            turn(upper, elbow, b.bend)
        } else {
            upper
        };
        for axis in 0..2 {
            p[axis] +=
                (upper[axis] - original[axis] + (lower[axis] - upper[axis]) * w.forearm) * w.arm;
        }
    }
}
