//! Planted two-bone legs and serial torso springs, following engine/legs.js.
use super::rig::{rotate, sstep, Parameters};
use crate::rig::{split_x, Body, Head, Leg, Legs, Point};
use serde::{Deserialize, Serialize};

type Matrix = [f64; 6];
const IDENTITY: Matrix = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
fn distance(a: Point, b: Point) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}
fn turn(p: Point, origin: Point, angle: f64) -> Point {
    rotate(p, origin, angle.cos(), angle.sin())
}
fn bone_matrix(a: Point, b: Point, target_a: Point, target_b: Point) -> Matrix {
    let length = distance(a, b);
    let target_length = distance(target_a, target_b);
    let ux = (b[0] - a[0]) / length;
    let uy = (b[1] - a[1]) / length;
    let vx = (target_b[0] - target_a[0]) / target_length;
    let vy = (target_b[1] - target_a[1]) / target_length;
    let scale = target_length / length;
    let m = [
        vx * scale * ux + vy * uy,
        vx * scale * uy - vy * ux,
        vy * scale * ux - vx * uy,
        vy * scale * uy + vx * ux,
    ];
    [
        m[0],
        m[1],
        m[2],
        m[3],
        target_a[0] - m[0] * a[0] - m[1] * a[1],
        target_a[1] - m[2] * a[0] - m[3] * a[1],
    ]
}
fn transform(p: Point, m: Matrix) -> Point {
    [
        m[0] * p[0] + m[1] * p[1] + m[4],
        m[2] * p[0] + m[3] * p[1] + m[5],
    ]
}
fn yaw_offset(x: f64, center: f64, radius: f64, angle: f64) -> f64 {
    let dx = x - center;
    let front = (1.0 - (dx / radius).powi(2)).max(0.0);
    dx * (angle.cos() - 1.0) + radius * 0.75 * front * front * angle.sin()
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct BoneWeights {
    pub leg: f64,
    pub shin: f64,
    pub pin: f64,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegWeights {
    pub right: f64,
    pub per_bone: [BoneWeights; 2],
}
#[derive(Debug, Clone, Copy, Serialize)]
pub struct BoneFrame {
    pub hip: Point,
    pub knee: Point,
    pub ankle: Point,
    pub hip3: [f64; 3],
    pub knee3: [f64; 3],
    pub ankle3: [f64; 3],
    pub upper: Matrix,
    pub lower: Matrix,
}
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Twist {
    pub pelvis: f64,
    pub shoulder: f64,
    pub head: f64,
    pub acceleration: f64,
}
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Trunk {
    pub spine: f64,
    pub chest: f64,
    pub head: f64,
    pub bob: f64,
}
#[derive(Debug, Clone, Copy, Serialize)]
pub struct LegFrame {
    pub ws: f64,
    pub bx: f64,
    pub angle: f64,
    pub shift: f64,
    pub drop: f64,
    pub bones: [BoneFrame; 2],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub twist: Option<Twist>,
    pub trunk: Trunk,
}

/// Retained between Avatar ticks; caches are rebuilt from these small spring states.
#[derive(Debug, Clone, Copy, Default)]
pub struct BodyDynamics {
    drive: [f64; 3],
    velocity: [f64; 3],
    yaw: [f64; 2],
    yaw_velocity: [f64; 2],
    yaw_acceleration: f64,
    bob: f64,
    bob_velocity: f64,
    last_weight: f64,
    pub(crate) version: u64,
}
struct Bone<'a> {
    rest: &'a Leg,
    u: f64,
    v: f64,
    depth: f64,
    lateral: f64,
    side: f64,
}
pub(crate) struct LegEngine<'a> {
    legs: &'a Legs,
    body: &'a Body,
    head: &'a Head,
    bones: [Bone<'a>; 2],
    pelvis_radius: f64,
    shoulder_radius: f64,
    pub dynamics: BodyDynamics,
    cached: Option<((f64, f64, u64), LegFrame)>,
}
impl<'a> LegEngine<'a> {
    pub fn new(legs: &'a Legs, body: &'a Body, head: &'a Head, dynamics: BodyDynamics) -> Self {
        let bones = [&legs.left, &legs.right].map(|leg| {
            let upper = distance(leg.hip, leg.knee);
            let lower = distance(leg.knee, leg.ankle);
            let depth = upper.min(lower) * 0.05;
            let dx = leg.ankle[0] - leg.hip[0];
            let dy = leg.ankle[1] - leg.hip[1];
            let cross = dx * (leg.knee[1] - leg.hip[1]) - dy * (leg.knee[0] - leg.hip[0]);
            Bone {
                rest: leg,
                u: upper.hypot(depth),
                v: lower.hypot(depth),
                depth,
                lateral: cross / dx.hypot(dy),
                side: if cross == 0.0 { 0.0 } else { cross.signum() },
            }
        });
        let pelvis_radius = bones
            .iter()
            .map(|b| (b.rest.hip[0] - legs.pelvis[0]).abs() * 1.35)
            .fold(1.0, f64::max);
        let shoulder_radius = body
            .shoulders
            .iter()
            .map(|s| (s.cx - body.chest.cx).abs() + s.rx)
            .fold(body.chest.rx, f64::max);
        let mut out = Self {
            legs,
            body,
            head,
            bones,
            pelvis_radius,
            shoulder_radius,
            dynamics,
            cached: None,
        };
        for (i, b) in out.bones.iter_mut().enumerate() {
            if b.side == 0.0 {
                b.side = if i == 0 { -1.0 } else { 1.0 };
            }
        }
        out
    }
    pub fn step(&mut self, p: &Parameters, dt: f64) {
        let ws = p.weight_shift.clamp(-1.0, 1.0);
        let time = dt.clamp(0.0, 0.05);
        let d = &mut self.dynamics;
        let previous_yaw_velocity = d.yaw_velocity[0];
        let has_twist = self.legs.twist > 0.0;
        let target_yaw = if has_twist {
            self.legs.twist * std::f64::consts::PI / 180.0
                * (0.4 * ws
                    + if time > 0.0 {
                        0.6 * ((ws - d.last_weight) / time).tanh()
                    } else {
                        0.0
                    })
                .clamp(-1.0, 1.0)
        } else {
            0.0
        };
        if time == 0.0 {
            if has_twist {
                d.yaw.fill(target_yaw);
                d.yaw_velocity.fill(0.0);
                d.yaw_acceleration = 0.0;
            }
            d.drive.fill(ws);
            d.velocity.fill(0.0);
            d.bob = 0.0;
            d.bob_velocity = 0.0;
        } else {
            let target_bob = self.legs.bob * ((ws - d.last_weight).abs() / time / 1.5).min(1.0);
            let count = (time * 240.0).ceil() as usize;
            let h = time / count as f64;
            for _ in 0..count {
                for i in 0..3 {
                    let target = if i == 0 { ws } else { d.drive[i - 1] };
                    d.velocity[i] += (24.0 * 24.0 * (target - d.drive[i])
                        - 2.0 * 0.9 * 24.0 * d.velocity[i])
                        * h;
                    d.drive[i] += d.velocity[i] * h;
                }
                if has_twist {
                    for i in 0..2 {
                        let target = if i == 0 { target_yaw } else { d.yaw[0] };
                        d.yaw_velocity[i] += (14.0 * 14.0 * (target - d.yaw[i])
                            - 2.0 * 0.95 * 14.0 * d.yaw_velocity[i])
                            * h;
                        d.yaw[i] += d.yaw_velocity[i] * h;
                    }
                }
                d.bob_velocity +=
                    (24.0 * 24.0 * (target_bob - d.bob) - 2.0 * 0.9 * 24.0 * d.bob_velocity) * h;
                d.bob += d.bob_velocity * h;
            }
        }
        if has_twist && time > 0.0 {
            d.yaw_acceleration = (d.yaw_velocity[0] - previous_yaw_velocity) / time;
        }
        d.last_weight = ws;
        d.version = d.version.wrapping_add(1);
    }
    pub fn frame(&mut self, p: &Parameters) -> LegFrame {
        let ws = p.weight_shift.clamp(-1.0, 1.0);
        let bx = p.body_angle_x.clamp(-10.0, 10.0);
        let d = self.dynamics;
        let key = (ws, bx, d.version);
        if let Some((previous, frame)) = self.cached {
            if previous == key {
                return frame;
            }
        }
        let l = self.legs;
        let angle = -l.tilt * ws;
        let shift = l.shift * ws + bx / 10.0 * self.body.hip.as_ref().map_or(l.shift, |h| h.shift);
        let has_twist = l.twist > 0.0;
        let pelvis_yaw = if has_twist {
            if d.version != 0 {
                d.yaw[0]
            } else {
                l.twist * std::f64::consts::PI / 180.0 * 0.4 * ws
            }
        } else {
            0.0
        };
        let shoulder_yaw = if has_twist {
            -(1.0 - l.spine) * if d.version != 0 { d.yaw[1] } else { pelvis_yaw }
        } else {
            0.0
        };
        let hips = self.bones.each_ref().map(|b| {
            let mut q = turn(b.rest.hip, l.pelvis, angle);
            if has_twist {
                q[0] += yaw_offset(b.rest.hip[0], l.pelvis[0], self.pelvis_radius, pelvis_yaw);
            }
            q[0] += shift;
            q
        });
        let lateral: [f64; 2] = std::array::from_fn(|i| {
            let b = &self.bones[i];
            b.lateral + b.side * l.bend * (if i == 0 { ws } else { -ws }).max(0.0).powi(2)
        });
        let scale = l.bend.powi(2)
            / self
                .bones
                .iter()
                .map(|b| b.u + b.v)
                .fold(f64::INFINITY, f64::min);
        let width = scale * (ws * ws + (bx / 10.0).powi(2));
        let mut drop = d.bob + scale * ws * ws;
        for (i, b) in self.bones.iter().enumerate() {
            let dx = hips[i][0] - b.rest.ankle[0];
            let reach = (b.u * b.u - lateral[i].powi(2)).max(0.0).sqrt()
                + (b.v * b.v - lateral[i].powi(2)).max(0.0).sqrt();
            let required = b.rest.ankle[1] - (reach * reach - dx * dx).max(0.0).sqrt() - hips[i][1];
            let x = required - drop;
            drop += (x + x.hypot(width)) / 2.0;
        }
        let bones = std::array::from_fn(|i| {
            let b = &self.bones[i];
            let rest = b.rest;
            let ankle = rest.ankle;
            if ws == 0.0 && bx == 0.0 && d.bob == 0.0 && pelvis_yaw == 0.0 {
                return BoneFrame {
                    hip: rest.hip,
                    knee: rest.knee,
                    ankle,
                    hip3: [rest.hip[0], rest.hip[1], 0.0],
                    knee3: [rest.knee[0], rest.knee[1], b.depth],
                    ankle3: [ankle[0], ankle[1], 0.0],
                    upper: IDENTITY,
                    lower: IDENTITY,
                };
            }
            let hip = [hips[i][0], hips[i][1] + drop];
            let dx = ankle[0] - hip[0];
            let dy = ankle[1] - hip[1];
            let dist = dx.hypot(dy);
            let along = (b.u * b.u - b.v * b.v + dist * dist) / (2.0 * dist);
            let height = (b.u * b.u - along * along).max(0.0).sqrt();
            let knee = [
                hip[0] + dx / dist * along - dy / dist * lateral[i],
                hip[1] + dy / dist * along + dx / dist * lateral[i],
            ];
            let depth = (height * height - lateral[i].powi(2)).max(0.0).sqrt();
            BoneFrame {
                hip,
                knee,
                ankle,
                hip3: [hip[0], hip[1], 0.0],
                knee3: [knee[0], knee[1], depth],
                ankle3: [ankle[0], ankle[1], 0.0],
                upper: bone_matrix(rest.hip, rest.knee, hip, knee),
                lower: bone_matrix(rest.knee, rest.ankle, knee, ankle),
            }
        });
        let frame = LegFrame {
            ws,
            bx,
            angle,
            shift,
            drop,
            bones,
            twist: has_twist.then_some(Twist {
                pelvis: pelvis_yaw,
                shoulder: shoulder_yaw,
                head: 0.0,
                acceleration: d.yaw_acceleration,
            }),
            trunk: Trunk {
                spine: d.drive[0],
                chest: d.drive[1],
                head: d.drive[2],
                bob: d.bob,
            },
        };
        self.cached = Some((key, frame));
        frame
    }
    pub fn weights(&self, x: f64, y: f64) -> LegWeights {
        let split = split_x(&self.legs.split, y);
        let right = if y >= self.legs.split[0][1] {
            if x >= split {
                1.0
            } else {
                0.0
            }
        } else {
            sstep(split - 4.0, split + 4.0, x)
        };
        LegWeights {
            right,
            per_bone: self.bones.each_ref().map(|b| BoneWeights {
                leg: sstep(self.legs.band[0], b.rest.hip[1], y),
                shin: sstep(b.rest.knee[1] - 45.0, b.rest.knee[1] + 45.0, y),
                pin: 1.0 - sstep(b.rest.ankle[1] - 55.0, b.rest.ankle[1], y),
            }),
        }
    }
    pub fn pin(&self, y: f64) -> f64 {
        let ankle_y = self.legs.left.ankle[1].min(self.legs.right.ankle[1]);
        1.0 - sstep(ankle_y - 55.0, ankle_y, y)
    }
    pub fn apply(&mut self, p: &mut Point, x: f64, y: f64, w: &LegWeights, params: &Parameters) {
        let f = self.frame(params);
        if f.ws == 0.0
            && f.bx == 0.0
            && f.trunk.chest == 0.0
            && f.trunk.head == 0.0
            && f.trunk.bob == 0.0
            && f.twist.is_none_or(|t| t.pelvis == 0.0 && t.shoulder == 0.0)
        {
            return;
        }
        let l = self.legs;
        let body = self.body;
        let head = self.head;
        let pivot = [l.pelvis[0] + f.shift, l.pelvis[1] + f.drop];
        let upper = 1.0 - sstep(body.chest.cy.min(l.pelvis[1] - 1.0), l.pelvis[1], y);
        let spine_blend = 1.0 - sstep(l.band[0], l.band[1], y);
        let shoulder_angle = l.tilt * (1.0 - l.spine) * f.trunk.chest;
        let chest_shift = l.shift * (1.12 * f.trunk.chest - f.ws)
            + shoulder_angle.sin() * (l.pelvis[1] - body.chest.cy).max(0.0);
        let body_point = |point| {
            let mut q = turn(point, l.pelvis, f.angle);
            q[0] += f.shift;
            q[1] += f.drop;
            let mut result = turn(q, pivot, (shoulder_angle - f.angle) * spine_blend);
            result[0] += chest_shift * upper;
            result
        };
        let mut counter = body_point(*p);
        let weight = 1.0 - sstep(head.weight_band[0], head.weight_band[1], y);
        let center = body_point([head.pivot_x, head.pivot_y]);
        let correction = -l.tilt * (1.0 - l.spine) * f.trunk.head * weight;
        counter = turn(counter, center, correction);
        counter[0] += l.shift * 1.12 * (f.trunk.head - f.trunk.chest) * weight;
        if let Some(twist) = f.twist {
            let waist_y = body.chest.cy + ((l.pelvis[1] - body.chest.cy) * 0.5).max(40.0);
            let blend = sstep(body.chest.cy, waist_y, y);
            let angle = twist.shoulder + (twist.pelvis - twist.shoulder) * blend;
            let center = body.chest.cx + (l.pelvis[0] - body.chest.cx) * blend;
            let radius = self.shoulder_radius + (self.pelvis_radius - self.shoulder_radius) * blend;
            counter[0] += yaw_offset(x, center, radius, angle)
                * sstep(head.weight_band[0], head.weight_band[1], y);
        }
        let mut delta = [0.0, 0.0];
        for i in 0..2 {
            let bw = w.per_bone[i];
            let thigh = transform(*p, f.bones[i].upper);
            let shin = transform(*p, f.bones[i].lower);
            let side = if i == 0 { 1.0 - w.right } else { w.right };
            for axis in 0..2 {
                let q = thigh[axis] + (shin[axis] - thigh[axis]) * bw.shin;
                delta[axis] += ((counter[axis] - p[axis]) * (1.0 - bw.leg)
                    + (q - p[axis]) * bw.leg)
                    * bw.pin
                    * side;
            }
        }
        p[0] += delta[0];
        p[1] += delta[1];
    }
}
