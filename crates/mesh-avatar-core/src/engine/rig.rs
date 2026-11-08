//! CPU weights and deformation, following engine/rig.js.
use super::{
    arms::{self, ArmFrame, ArmWeights},
    legs::{BodyDynamics, LegEngine, LegFrame, LegWeights},
};
use crate::rig::{Accessory, Ellipse, Eye, Point, Rig};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct ParameterDefinition {
    pub id: &'static str,
    pub label: &'static str,
    pub min: f64,
    pub max: f64,
    #[serde(rename = "def")]
    pub default: f64,
    pub group: &'static str,
}

macro_rules! parameters {
    ($($field:ident => ($id:literal, $label:literal, $min:expr, $max:expr, $default:expr, $group:literal)),* $(,)?) => {
        #[derive(Debug, Clone, Serialize, Deserialize)]
        #[serde(default)]
        pub struct Parameters {
            $(#[serde(rename = $id)] pub $field: f64,)*
            #[serde(rename = "eyeSmileL")]
            pub eye_smile_l: Option<f64>,
        }
        impl Default for Parameters {
            fn default() -> Self { Self { $($field: $default,)* eye_smile_l: None } }
        }
        impl Parameters {
            pub fn get(&self, id: &str) -> Option<f64> {
                match id { $($id => Some(self.$field),)* "eyeSmileL" => self.eye_smile_l, _ => None }
            }
            pub fn set(&mut self, id: &str, value: f64) -> bool {
                match id { $($id => self.$field = value,)* "eyeSmileL" => self.eye_smile_l = Some(value), _ => return false }
                true
            }
        }
        pub const PARAMS: &[ParameterDefinition] = &[
            $(ParameterDefinition { id: $id, label: $label, min: $min, max: $max, default: $default, group: $group },)*
        ];
    }
}

parameters! {
    angle_x => ("angleX", "Face angle X", -30.0, 30.0, 0.0, "Head and body"),
    angle_y => ("angleY", "Face angle Y", -30.0, 30.0, 0.0, "Head and body"),
    angle_z => ("angleZ", "Face roll", -30.0, 30.0, 0.0, "Head and body"),
    body_angle_x => ("bodyAngleX", "Body angle X", -10.0, 10.0, 0.0, "Head and body"),
    body_angle_z => ("bodyAngleZ", "Body roll", -10.0, 10.0, 0.0, "Head and body"),
    breath => ("breath", "Breath", 0.0, 1.0, 0.0, "Head and body"),
    eye_l_open => ("eyeLOpen", "Left eye open", 0.0, 1.25, 1.0, "Eyes and brows"),
    eye_r_open => ("eyeROpen", "Right eye open", 0.0, 1.25, 1.0, "Eyes and brows"),
    eye_smile => ("eyeSmile", "Eye smile", 0.0, 1.0, 0.0, "Eyes and brows"),
    gaze_x => ("gazeX", "Gaze X", -1.0, 1.0, 0.0, "Eyes and brows"),
    gaze_y => ("gazeY", "Gaze Y", -1.0, 1.0, 0.0, "Eyes and brows"),
    brow_y => ("browY", "Brow Y", -1.0, 1.0, 0.0, "Eyes and brows"),
    brow_angle => ("browAngle", "Brow angle", -1.0, 1.0, 0.0, "Eyes and brows"),
    mouth_open => ("mouthOpen", "Mouth open", 0.0, 1.0, 0.0, "Mouth and cheeks"),
    mouth_form => ("mouthForm", "Mouth form (i to o)", -1.0, 1.0, 0.0, "Mouth and cheeks"),
    blush => ("blush", "Blush", 0.0, 1.0, 0.0, "Mouth and cheeks"),
    arm_angle => ("armAngle", "Arm angle", -10.0, 10.0, 0.0, "Hand"),
    hand_angle => ("handAngle", "Wrist angle", -10.0, 10.0, 0.0, "Hand"),
    finger_tap => ("fingerTap", "Finger tap", 0.0, 1.0, 0.0, "Hand"),
    weight_shift => ("weightShift", "Weight shift", -1.0, 1.0, 0.0, "Legs"),
    arm_swing_l => ("armSwingL", "Arm swing L", -1.0, 1.0, 0.0, "Arms"),
    elbow_bend_l => ("elbowBendL", "Elbow bend L", 0.0, 1.0, 0.0, "Arms"),
    arm_swing_r => ("armSwingR", "Arm swing R", -1.0, 1.0, 0.0, "Arms"),
    elbow_bend_r => ("elbowBendR", "Elbow bend R", 0.0, 1.0, 0.0, "Arms"),
}

pub(crate) fn sstep(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn gaussian(x: f64, y: f64, area: Option<&Ellipse>) -> f64 {
    area.map_or(0.0, |a| {
        (-(((x - a.cx) / a.rx).powi(2) + ((y - a.cy) / a.ry).powi(2))).exp()
    })
}

pub(crate) fn rotate(p: Point, origin: Point, c: f64, s: f64) -> Point {
    let dx = p[0] - origin[0];
    let dy = p[1] - origin[1];
    [origin[0] + dx * c - dy * s, origin[1] + dx * s + dy * c]
}

fn sampled(arr: &[f64; 24], u: f64) -> f64 {
    let f = u.clamp(0.0, 1.0) * 23.0;
    let i = (f.floor() as usize).min(22);
    arr[i] + (arr[i + 1] - arr[i]) * (f - i as f64)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EyePart {
    Ball,
    Low,
    Crease,
    Lash,
}

fn eye_lids_raw(e: &Eye, u: f64, open: f64, smile: f64) -> Point {
    let u = u.clamp(0.0, 1.0);
    let top = sampled(&e.top, u);
    let bot = sampled(&e.bot, u);
    let b = 1.0 - open;
    let hump = 4.0 * u * (1.0 - u);
    let h = sampled(&e.bot, 0.5) - sampled(&e.top, 0.5);
    let arc = e.top[0] + (e.top[23] - e.top[0]) * u - 0.3 * h * hump;
    let closed = top.max(bot + 1.0 + (arc - bot - 1.0) * smile);
    [
        (closed - top) * b.max(-0.07),
        if b > 0.0 {
            (closed - bot) * b * smile
        } else {
            0.0
        },
    ]
}

pub fn eye_part_y(e: &Eye, part: EyePart, x: f64, y: f64, open: f64, smile: f64) -> f64 {
    let mut du = 0.0;
    let mut db = 0.0;
    for (k, w) in [(-2.0, 1.0), (-1.0, 2.0), (0.0, 3.0), (1.0, 2.0), (2.0, 1.0)] {
        let [a, c] = eye_lids_raw(e, (x + k * 5.0 - e.x0) / (e.x1 - e.x0), open, smile);
        du += a * w / 9.0;
        db += c * w / 9.0;
    }
    let u = ((x - e.x0) / (e.x1 - e.x0)).clamp(0.0, 1.0);
    let top = sampled(&e.top, u);
    let lid = top + du;
    match part {
        EyePart::Lash => lid - (top - y) * (1.0 - 0.3 * (1.0 - open).clamp(0.0, 1.0)),
        EyePart::Low => y + (sampled(&e.bot, u) + db - sampled(&e.bot, u)),
        EyePart::Crease => y + (lid - top) * 0.22,
        EyePart::Ball => y,
    }
}

pub fn eye_part_alpha(part: EyePart, open: f64, smile: f64) -> f64 {
    let b = (1.0 - open).clamp(0.0, 1.0);
    match part {
        EyePart::Low => 1.0 - (b * smile * 1.2).min(1.0),
        EyePart::Crease => 1.0 - 0.45 * b,
        _ => 1.0,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseWeights {
    pub head: f64,
    pub turn: f64,
    pub strands: Vec<(usize, f64, f64)>,
    pub bun_l: f64,
    pub bun_r: f64,
    pub brow: f64,
    pub jaw: f64,
    pub nose: f64,
    pub mouth: f64,
    pub eye_a: f64,
    pub eye_b: f64,
    pub ear_r: f64,
    pub ear_l: f64,
    pub chest: f64,
    pub breath: f64,
    pub shoulder: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legs: Option<LegWeights>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arms: Option<[ArmWeights; 2]>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandWeights {
    pub arm: f64,
    pub wrist: f64,
    pub hand: f64,
    pub finger: f64,
    pub pin_bottom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicsOffsets {
    pub gain: f64,
    pub bun_l: Point,
    pub bun_r: Point,
    #[serde(default)]
    pub strands: Vec<[Point; 4]>,
}

impl Default for PhysicsOffsets {
    fn default() -> Self {
        Self {
            gain: 1.0,
            bun_l: [0.0; 2],
            bun_r: [0.0; 2],
            strands: vec![],
        }
    }
}

#[derive(Debug, Clone)]
pub struct HandFrame {
    elbow: Point,
    translated_elbow: Point,
    c: f64,
    s: f64,
    pub w: Point,
    pub b: f64,
    pub k: f64,
}

impl HandFrame {
    pub fn transform(&self, point: Point) -> Point {
        let q = rotate(point, self.elbow, self.c, self.s);
        [
            q[0] + self.translated_elbow[0] - self.elbow[0],
            q[1] + self.translated_elbow[1] - self.elbow[1],
        ]
    }
}

pub struct RigEngine<'a> {
    pub rig: &'a Rig,
    legs: Option<RefCell<LegEngine<'a>>>,
    arm_cache: RefCell<Option<ArmCache>>,
}

#[derive(Clone, Copy)]
struct ArmCache {
    key: [f64; 11],
    version: u64,
    frame: [ArmFrame; 2],
}

impl<'a> RigEngine<'a> {
    pub fn new(rig: &'a Rig) -> Self {
        Self::with_body_dynamics(rig, BodyDynamics::default())
    }
    pub fn with_body_dynamics(rig: &'a Rig, dynamics: BodyDynamics) -> Self {
        Self {
            rig,
            legs: rig
                .legs
                .as_ref()
                .map(|legs| RefCell::new(LegEngine::new(legs, &rig.body, &rig.head, dynamics))),
            arm_cache: RefCell::new(None),
        }
    }
    pub fn body_dynamics(&self) -> BodyDynamics {
        self.legs
            .as_ref()
            .map_or_else(BodyDynamics::default, |legs| legs.borrow().dynamics)
    }
    pub fn step_body(&self, params: &Parameters, dt: f64) {
        if let Some(legs) = &self.legs {
            legs.borrow_mut().step(params, dt);
        }
    }
    pub fn leg_frame(&self, params: &Parameters) -> Option<LegFrame> {
        self.legs
            .as_ref()
            .map(|legs| legs.borrow_mut().frame(params))
    }
    pub fn head_weight(&self, _x: f64, y: f64) -> f64 {
        let b = self.rig.head.weight_band;
        1.0 - sstep(b[0], b[1], y)
    }
    pub fn turn_weight(&self, _x: f64, y: f64) -> f64 {
        let b = self.rig.head.turn_band;
        1.0 - sstep(b[0], b[1], y)
    }

    pub fn base_weights(&self, x: f64, y: f64, hair: f64) -> BaseWeights {
        let r = self.rig;
        let mut hits = Vec::new();
        let mut sum = 0.0;
        if hair >= 0.02 {
            for (i, s) in r.strands.iter().enumerate() {
                let mut best = f64::INFINITY;
                let mut bt = 0.0;
                let n = s.nodes.len() - 1;
                for j in 0..n {
                    let [ax, ay] = s.nodes[j];
                    let vx = s.nodes[j + 1][0] - ax;
                    let vy = s.nodes[j + 1][1] - ay;
                    let u = (((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)).clamp(0.0, 1.0);
                    let d = (x - ax - vx * u).hypot(y - ay - vy * u);
                    if d < best {
                        best = d;
                        bt = (j as f64 + u) / n as f64;
                    }
                }
                let g = (-(best / s.sigma).powi(2)).exp();
                if g < 0.02 {
                    continue;
                }
                hits.push((i, g, bt));
                sum += g;
            }
        }
        let norm = sum.max(1.0);
        for (_, weight, t) in &mut hits {
            *weight = hair * *weight / norm * sstep(0.04, 0.55, *t);
        }
        let g = |a: &Ellipse| gaussian(x, y, Some(a));
        BaseWeights {
            head: self.head_weight(x, y),
            turn: self.turn_weight(x, y),
            strands: hits,
            bun_l: gaussian(x, y, r.buns.as_ref().and_then(|b| b.bun_l.as_ref())),
            bun_r: gaussian(x, y, r.buns.as_ref().and_then(|b| b.bun_r.as_ref())),
            brow: g(&r.face.brow.ellipse)
                * (1.0 - sstep(r.face.brow.band[0], r.face.brow.band[1], y)),
            jaw: g(&r.face.jaw.ellipse) * sstep(r.face.jaw.band[0], r.face.jaw.band[1], y),
            nose: g(&r.face.nose),
            mouth: g(&r.face.mouth),
            eye_a: g(&r.face.eye_a),
            eye_b: g(&r.face.eye_b),
            ear_r: g(&r.face.ear_r),
            ear_l: g(&r.face.ear_l),
            chest: g(&r.body.chest),
            breath: 1.0 - sstep(r.body.breath_band[0], r.body.breath_band[1], y),
            shoulder: r.body.shoulders.iter().map(g).sum(),
            legs: self.legs.as_ref().map(|legs| legs.borrow().weights(x, y)),
            arms: r
                .arms
                .as_ref()
                .map(|arms| arms::weights(arms, &r.body, x, y)),
        }
    }

    pub fn apply_head(&self, p: &mut Point, w: f64, params: &Parameters, w_turn: f64) {
        let h = &self.rig.head;
        let nx = (p[0] - h.ellipse.cx) / h.ellipse.rx;
        let ny = (p[1] - h.ellipse.cy) / h.ellipse.ry;
        let t = 1.0 - nx * nx - ny * ny;
        if t > 0.0 {
            let d = sstep(0.0, 0.84, t);
            p[0] += params.angle_x / 30.0 * h.shift_x * d * w_turn;
            p[1] += -params.angle_y / 30.0 * h.shift_y * d * w_turn;
        }
        if w <= 0.0 {
            return;
        }
        let a = -params.angle_z / 30.0 * h.max_roll * w;
        *p = rotate(*p, [h.pivot_x, h.pivot_y], a.cos(), a.sin());
    }

    pub fn apply_body(
        &self,
        p: &mut Point,
        rest_y: f64,
        params: &Parameters,
        chest: f64,
        breath_w: f64,
        shoulder: f64,
    ) {
        self.apply_body_weighted(p, rest_y, params, [chest, breath_w, shoulder], None);
    }

    fn apply_body_weighted(
        &self,
        p: &mut Point,
        rest_y: f64,
        params: &Parameters,
        weights: [f64; 3],
        leg_weights: Option<&LegWeights>,
    ) {
        let [chest, breath_w, shoulder] = weights;
        let body = &self.rig.body;
        if let Some(legs) = &self.legs {
            let mut legs = legs.borrow_mut();
            let w = leg_weights
                .copied()
                .unwrap_or_else(|| legs.weights(p[0], rest_y));
            legs.apply(p, p[0], rest_y, &w, params);
        }
        let planted = *p;
        p[1] -= params.breath * (5.0 * breath_w + 4.0 * shoulder);
        p[0] += (p[0] - body.chest.cx) * 0.012 * params.breath * chest;
        if self.legs.is_none() {
            p[0] += params.body_angle_x / 10.0
                * body.hip.as_ref().map_or(7.0 + 9.0 * chest, |hip| {
                    hip.shift * (1.0 - sstep(hip.band[0], hip.band[1], rest_y))
                });
        }
        let a = -params.body_angle_z / 10.0
            * body.max_roll
            * (1.0 - sstep(body.roll_band[0], body.roll_band[1], rest_y));
        *p = rotate(*p, [body.pivot_x, body.pivot_y], a.cos(), a.sin());
        if let Some(legs) = &self.legs {
            let pin = legs.borrow().pin(rest_y);
            p[0] = planted[0] + (p[0] - planted[0]) * pin;
            p[1] = planted[1] + (p[1] - planted[1]) * pin;
        }
    }

    pub fn deform_base(
        &self,
        x: f64,
        y: f64,
        w: &BaseWeights,
        params: &Parameters,
        phys: &PhysicsOffsets,
    ) -> Point {
        let mut p = [x, y];
        if self
            .legs
            .as_ref()
            .is_some_and(|legs| legs.borrow().pin(y) == 0.0)
        {
            return p;
        }
        for &(i, wi, t) in &w.strands {
            let Some(o) = phys.strands.get(i) else {
                continue;
            };
            let f = t * 3.0;
            let k = (f.floor() as usize).min(2);
            let u = f - k as f64;
            p[0] += (o[k][0] + (o[k + 1][0] - o[k][0]) * u) * wi * phys.gain;
            p[1] += (o[k][1] + (o[k + 1][1] - o[k][1]) * u) * wi * phys.gain;
        }
        p[0] += (phys.bun_l[0] * w.bun_l + phys.bun_r[0] * w.bun_r) * phys.gain;
        p[1] += (phys.bun_l[1] * w.bun_l + phys.bun_r[1] * w.bun_r) * phys.gain;
        p[1] -= params.brow_y * 7.0 * w.brow;
        if w.brow > 0.01 {
            p[1] += (x - self.rig.face.brow.ellipse.cx) * (params.brow_angle * 0.12 * w.brow).sin();
        }
        p[1] += params.mouth_open * 3.5 * w.jaw;
        let ax = params.angle_x / 30.0;
        let ay = params.angle_y / 30.0;
        let f = &self.rig.face;
        p[0] += ax * (8.0 * w.nose + 5.0 * w.mouth) + (x - f.eye_a.cx) * 0.12 * ax * w.eye_a
            - (x - f.eye_b.cx) * 0.12 * ax * w.eye_b
            - ax * 9.0 * w.ear_r
            + ax * 4.0 * w.ear_l
            - ax * 10.0 * (w.bun_l + w.bun_r);
        p[1] -= ay * (6.0 * w.nose + 3.0 * w.mouth);
        p[1] += (y - f.eye_a.cy) * -0.06 * ay.abs() * w.eye_a
            + (y - f.eye_b.cy) * -0.06 * ay.abs() * w.eye_b;
        self.apply_head(&mut p, w.head, params, w.turn);
        self.apply_body_weighted(
            &mut p,
            y,
            params,
            [w.chest, w.breath, w.shoulder],
            w.legs.as_ref(),
        );
        if let Some((cfg, weights)) = self.rig.arms.as_ref().zip(w.arms.as_ref()) {
            if weights.iter().any(|w| w.arm > 0.0) {
                let key = [
                    params.angle_x,
                    params.angle_y,
                    params.angle_z,
                    params.body_angle_x,
                    params.body_angle_z,
                    params.breath,
                    params.arm_swing_l,
                    params.arm_swing_r,
                    params.elbow_bend_l,
                    params.elbow_bend_r,
                    params.weight_shift,
                ];
                let version = self.body_dynamics().version;
                let cached = *self.arm_cache.borrow();
                let frame =
                    if let Some(cached) = cached.filter(|c| c.key == key && c.version == version) {
                        cached.frame
                    } else {
                        let frame = arms::frame(cfg, params, |point| {
                            let a = self.base_weights(point[0], point[1], 0.0);
                            let mut q = point;
                            self.apply_head(&mut q, a.head, params, a.turn);
                            self.apply_body_weighted(
                                &mut q,
                                point[1],
                                params,
                                [a.chest, a.breath, a.shoulder],
                                a.legs.as_ref(),
                            );
                            q
                        });
                        *self.arm_cache.borrow_mut() = Some(ArmCache {
                            key,
                            version,
                            frame,
                        });
                        frame
                    };
                arms::apply(&mut p, weights, &frame);
            }
        }
        p
    }

    pub fn hand_weights(&self, x: f64, y: f64) -> HandWeights {
        let Some(h) = &self.rig.hand else {
            return HandWeights::default();
        };
        let at = |b: Point, v| sstep(b[0], b[1], v);
        HandWeights {
            arm: 1.0 - at(h.arm_band, y),
            wrist: 1.0 - at(h.wrist_band, y),
            hand: 1.0 - at(h.hand_band, y),
            finger: at(h.finger_x_band, x) * (1.0 - at(h.finger_y_band, y)),
            pin_bottom: at(h.pin_band, y),
        }
    }

    pub fn hand_frame(&self, params: &Parameters) -> HandFrame {
        let h = self.rig.hand.as_ref();
        let elbow = h.map_or([0.0; 2], |h| h.elbow);
        let wrist = h.map_or([0.0; 2], |h| h.wrist);
        let contact = h.map_or([0.0; 2], |h| h.contact);
        let mut c = contact;
        self.apply_head(
            &mut c,
            self.head_weight(contact[0], contact[1]),
            params,
            self.turn_weight(contact[0], contact[1]),
        );
        self.apply_body(&mut c, contact[1], params, 0.0, 1.0, 0.0);
        let mut e = elbow;
        self.apply_body(&mut e, elbow[1], params, 0.0, 0.0, 0.0);
        let full =
            (c[1] - e[1]).atan2(c[0] - e[0]) - (contact[1] - elbow[1]).atan2(contact[0] - elbow[0]);
        let a = full * h.map_or(0.0, |h| h.forearm_share);
        let mut frame = HandFrame {
            elbow,
            translated_elbow: e,
            c: a.cos(),
            s: a.sin(),
            w: [0.0; 2],
            b: 0.0,
            k: 1.0,
        };
        frame.w = frame.transform(wrist);
        let c1 = frame.transform(contact);
        let w = frame.w;
        frame.b = (c[1] - w[1]).atan2(c[0] - w[0]) - (c1[1] - w[1]).atan2(c1[0] - w[0]);
        frame.k = ((c[0] - w[0]).hypot(c[1] - w[1]) / (c1[0] - w[0]).hypot(c1[1] - w[1]))
            .clamp(0.97, 1.03);
        frame
    }

    pub fn deform_hand(
        &self,
        x: f64,
        y: f64,
        w: &HandWeights,
        p: &Parameters,
        frame: &HandFrame,
    ) -> Point {
        let h = self.rig.hand.as_ref();
        let a = p.finger_tap * 0.07 * w.finger;
        let mut q = rotate([x, y], h.map_or([0.0; 2], |h| h.knuckle), a.cos(), a.sin());
        let ha = -p.hand_angle / 10.0 * 0.045 * w.wrist;
        let aa = -p.arm_angle / 10.0 * 0.015 * w.arm;
        q = rotate(q, h.map_or([0.0; 2], |h| h.wrist), ha.cos(), ha.sin());
        q = rotate(q, h.map_or([0.0; 2], |h| h.elbow), aa.cos(), aa.sin());
        q = frame.transform(q);
        let bw = frame.b * w.hand;
        let kw = 1.0 + (frame.k - 1.0) * w.hand;
        q = rotate(q, frame.w, bw.cos() * kw, bw.sin() * kw);
        q[1] += (y - q[1]) * w.pin_bottom;
        q
    }

    pub fn tassel_anchor(&self, t: &Accessory, p: &Parameters, phys: &PhysicsOffsets) -> Point {
        self.deform_base(
            t.pivot[0],
            t.pivot[1],
            &self.base_weights(t.pivot[0], t.pivot[1], 1.0),
            p,
            phys,
        )
    }
}
