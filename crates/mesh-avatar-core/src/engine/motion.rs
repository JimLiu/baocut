//! Idle, gaze, blinking, reactions, speech and spring-smoothed parameters.
use super::{
    kana::{kana_to_moras, sample_moras, Mora, Vowel},
    lip_sync::{LipMotionOptions, LipSyncSettings, ResolvedLipSync},
    motions::{data, find_motion, motions, sample_track},
    random::{RandomSource, SeededRandom},
    rig::{sstep, Parameters, PARAMS},
};
use crate::rig::{Point, Rig};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Auto,
    Mouse,
    Manual,
}
struct Blink {
    t: f64,
    start: f64,
    double: bool,
}
struct Gaze {
    x: f64,
    y: f64,
    next: f64,
}
struct Tap {
    next: f64,
    until: f64,
}
pub struct Playback {
    pub id: String,
    pub t: f64,
}
struct Kana {
    moras: Vec<Mora>,
    t: f64,
    looping: bool,
    duration: f64,
}
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct SpeakOptions {
    pub speed: Option<f64>,
    #[serde(rename = "loop")]
    pub looping: bool,
}
#[derive(Debug, Serialize)]
pub struct LipSyncState {
    pub active: bool,
    pub open: f64,
    pub form: f64,
}

pub struct Motion {
    pub mode: Mode,
    pub parameters: Parameters,
    pub manual: Parameters,
    pub expr: String,
    pub t: f64,
    pub pointer: Option<Point>,
    pub face_center: Point,
    pub lip_open: Option<f64>,
    pub lip_form: f64,
    pub speaking: bool,
    pub voice: f64,
    pub talk_gain: f64,
    pub play: Option<Playback>,
    pub auto_motion: bool,
    pub auto_idle: bool,
    pub lip_sync: ResolvedLipSync,
    pub motion_events: Vec<Option<String>>,
    cur: Parameters,
    vel: Parameters,
    expr_mix: BTreeMap<String, f64>,
    blink: Blink,
    gaze: Gaze,
    tap: Tap,
    mouth: f64,
    vowel: Vowel,
    vowel_form: f64,
    lip_motion: LipMotionOptions,
    syllable_armed: bool,
    voice_peak: f64,
    voice_trough: f64,
    kana: Option<Kana>,
    lip_hold: Option<Vowel>,
    emotion_until: f64,
    next_auto: f64,
    next_idle: f64,
    last_auto: Option<String>,
    breath_phase: f64,
    breath_period: f64,
    talk_nod: f64,
    rng: Box<dyn RandomSource>,
    planted: bool,
    arm_rig: Option<ArmMotion>,
    arm_follow: f64,
    arm_velocity: f64,
}

struct ArmMotion {
    swing: f64,
    inward: f64,
    body_roll: f64,
    leg_tilt: f64,
}

/// Held five-second transfer with a quintic transition, matching the JS motion.
pub fn weight_transfer(t: f64) -> f64 {
    let duration = 0.9;
    let phase = (t + duration / 2.0) % 5.0;
    let start = if phase < 2.5 { -0.7 } else { 0.7 };
    let local = phase % 2.5;
    if local >= duration {
        return -start;
    }
    let u = local / duration;
    let s = u * u * u * (10.0 + u * (-15.0 + 6.0 * u));
    start + (-start - start) * s
}

fn noise(t: f64, seed: f64) -> f64 {
    let i = t.floor();
    let f = t - i;
    let h = |n: f64| {
        let x = ((n + seed * 57.3) * 127.1).sin() * 43758.5453;
        x - x.floor()
    };
    let u = f * f * (3.0 - 2.0 * f);
    (h(i) * (1.0 - u) + h(i + 1.0) * u) * 2.0 - 1.0
}
fn fbm(t: f64, s: f64) -> f64 {
    noise(t, s) * 0.7 + noise(t * 2.3, s + 9.0) * 0.3
}
fn face_track(id: &str) -> bool {
    matches!(
        id,
        "eyeOpen"
            | "eyeOpenL"
            | "eyeSmileL"
            | "eyeSmile"
            | "mouthOpen"
            | "mouthForm"
            | "blush"
            | "browY"
            | "browAngle"
    )
}

pub(crate) fn expression_target(expr: &str) -> BTreeMap<String, f64> {
    let e = &data()
        .expressions
        .get(expr)
        .unwrap_or(&data().expressions["normal"])
        .p;
    let get = |key: &str, default: f64| {
        e.get(key)
            .and_then(serde_json::Value::as_f64)
            .unwrap_or(default)
    };
    let eye = get("eyeOpen", 1.0);
    let smile = get("eyeSmile", 0.0);
    let glance = e.get("glance").and_then(serde_json::Value::as_array);
    BTreeMap::from([
        ("eyeOpen".into(), eye),
        ("eyeOpenL".into(), get("eyeOpenL", eye)),
        ("eyeSmile".into(), smile),
        ("eyeSmileL".into(), get("eyeSmileL", smile)),
        ("mouthOpen".into(), get("mouthOpen", 0.0)),
        ("mouthForm".into(), get("mouthForm", 0.0)),
        ("blush".into(), get("blush", 0.0)),
        ("browY".into(), get("browY", 0.0)),
        ("browAngle".into(), get("browAngle", 0.0)),
        (
            "gx".into(),
            glance
                .and_then(|v| v.first())
                .and_then(serde_json::Value::as_f64)
                .unwrap_or(0.0),
        ),
        (
            "gy".into(),
            glance
                .and_then(|v| v.get(1))
                .and_then(serde_json::Value::as_f64)
                .unwrap_or(0.0),
        ),
    ])
}

impl Motion {
    /// Default to seed zero; all randomness can be supplied by the caller.
    pub fn new(gaze_center: Point) -> Self {
        Self::with_rng(gaze_center, Box::new(SeededRandom::new(0)))
    }
    pub fn with_rng(face_center: Point, rng: Box<dyn RandomSource>) -> Self {
        let p = Parameters::default();
        let mut vel = p.clone();
        for param in PARAMS {
            vel.set(param.id, 0.0);
        }
        let lip_sync = ResolvedLipSync::default();
        Self {
            mode: Mode::Auto,
            parameters: p.clone(),
            manual: p.clone(),
            cur: p,
            vel,
            expr: "normal".into(),
            expr_mix: BTreeMap::new(),
            t: 0.0,
            blink: Blink {
                t: 0.0,
                start: 1.5,
                double: false,
            },
            gaze: Gaze {
                x: 0.0,
                y: 0.0,
                next: 0.0,
            },
            tap: Tap {
                next: 4.0,
                until: -1.0,
            },
            pointer: None,
            face_center,
            lip_open: None,
            lip_form: 0.0,
            speaking: false,
            voice: 0.0,
            mouth: 0.0,
            vowel: Vowel::A,
            vowel_form: 0.0,
            lip_sync,
            lip_motion: lip_sync.motion_options(),
            syllable_armed: true,
            voice_peak: 0.0,
            voice_trough: 0.0,
            kana: None,
            lip_hold: None,
            emotion_until: 0.0,
            talk_gain: 1.0,
            play: None,
            auto_motion: true,
            next_auto: 14.0,
            auto_idle: true,
            next_idle: 3.0,
            last_auto: None,
            motion_events: vec![],
            breath_phase: 0.0,
            breath_period: 3.8,
            talk_nod: 0.0,
            rng,
            planted: false,
            arm_rig: None,
            arm_follow: 0.0,
            arm_velocity: 0.0,
        }
    }
    /// Enable optional body motion while preserving the caller's random sequence.
    pub fn configure_rig(&mut self, rig: &Rig) {
        self.planted = rig.legs.is_some();
        self.arm_rig = rig.arms.as_ref().map(|arms| ArmMotion {
            swing: arms.swing * std::f64::consts::PI / 180.0,
            inward: arms.inward,
            body_roll: rig.body.max_roll,
            leg_tilt: rig
                .legs
                .as_ref()
                .map_or(0.0, |legs| legs.tilt * (1.0 - legs.spine)),
        });
        self.arm_follow = 0.0;
        self.arm_velocity = 0.0;
    }
    pub fn set_expression(&mut self, name: &str) {
        self.expr = if data().expressions.contains_key(name) {
            name
        } else {
            "normal"
        }
        .into();
    }
    pub fn set_voice_level(&mut self, v: f64) {
        self.voice = if v.is_nan() { 0.0 } else { v.clamp(0.0, 1.0) };
    }
    pub fn set_lip_sync(&mut self, settings: &LipSyncSettings) -> Result<()> {
        self.lip_sync = settings.resolve(self.lip_sync)?;
        self.lip_motion = self.lip_sync.motion_options();
        Ok(())
    }
    pub fn set_speaking(&mut self, on: bool) {
        if on == self.speaking {
            return;
        }
        self.speaking = on;
        if !on {
            self.emotion_until = self.t + 1.2;
            self.voice = 0.0;
        }
    }
    pub fn set_emotion(&mut self, tag: &str, play_motion: bool) {
        let (expr, motion) = match tag {
            "happy" => ("happyTalk", Some("nod")),
            "sad" => ("sadTalk", Some("sigh")),
            "angry" => ("angryTalk", Some("no")),
            "surprised" => ("surprisedTalk", Some("surprise")),
            "relaxed" => ("relaxedTalk", Some("sway")),
            _ => ("normal", None),
        };
        self.expr = expr.into();
        self.emotion_until = f64::INFINITY;
        if play_motion {
            if let Some(id) = motion {
                self.play_motion(id);
            }
        }
    }
    pub fn speak_kana(&mut self, text: &str, options: SpeakOptions) {
        self.lip_hold = None;
        let mora = options.speed.map_or(0.14, |speed| {
            1.0 / (if speed == 0.0 || speed.is_nan() {
                7.0
            } else {
                speed
            })
            .clamp(4.0, 12.0)
        });
        let moras = kana_to_moras(text, mora);
        let duration = moras.iter().map(|m| m.dur).sum();
        self.kana = if moras.is_empty() {
            None
        } else {
            Some(Kana {
                moras,
                t: 0.0,
                looping: options.looping,
                duration,
            })
        };
    }
    pub fn hold_mouth(&mut self, vowel: Option<Vowel>) {
        self.kana = None;
        self.lip_hold = vowel;
    }
    pub fn stop_lip_sync(&mut self) {
        self.kana = None;
        self.lip_hold = None;
        self.lip_open = None;
        self.mouth = 0.0;
    }
    pub fn lip_sync_state(&self) -> LipSyncState {
        LipSyncState {
            active: self.kana.is_some() || self.lip_hold.is_some(),
            open: self.parameters.mouth_open,
            form: self.parameters.mouth_form,
        }
    }
    pub fn play_motion(&mut self, id: &str) {
        if find_motion(id).is_none() {
            return;
        }
        self.last_auto = Some(id.into());
        self.play = Some(Playback {
            id: id.into(),
            t: 0.0,
        });
        self.motion_events.push(Some(id.into()));
    }
    fn play_random(&mut self, idle: bool) {
        let pool: Vec<_> = motions()
            .iter()
            .filter(|m| {
                m.idle == idle
                    && (idle || m.id != "surprise")
                    && Some(m.id.as_str()) != self.last_auto.as_deref()
            })
            .collect();
        let index = (self.rng.next_f64() * pool.len() as f64).floor() as usize;
        if let Some(m) = pool.get(index) {
            self.play_motion(&m.id);
        }
    }
    fn speech_mouth(&mut self, dt: f64) -> Option<Point> {
        if self.kana.is_some() || self.lip_hold.is_some() {
            let m = if let Some(v) = self.lip_hold {
                Some(v.target())
            } else {
                let kana = self.kana.as_mut().unwrap();
                kana.t += dt;
                if kana.looping {
                    kana.t %= kana.duration;
                }
                sample_moras(&kana.moras, kana.t, self.lip_sync.granularity)
            };
            let Some(m) = m else {
                self.kana = None;
                return if self.mouth > 0.01 {
                    self.mouth *= if self.lip_sync.close_speed == 0.5 {
                        0.6
                    } else {
                        (-dt * self.lip_motion.kana_release).exp()
                    };
                    Some([self.mouth, self.vowel_form])
                } else {
                    None
                };
            };
            let target = if self.lip_motion.openness == 1.0 {
                m.open
            } else {
                (m.open * self.lip_motion.openness).min(1.0)
            };
            let k = 1.0
                - (-dt
                    * if target > self.mouth {
                        30.0
                    } else {
                        self.lip_motion.kana_release
                    })
                .exp();
            self.mouth += (target - self.mouth) * k;
            if let Some(form) = m.form {
                self.vowel_form = form;
            }
            return Some([self.mouth, self.vowel_form]);
        }
        let v = if self.speaking { self.voice } else { 0.0 };
        let relax = 1.0 - (-dt * self.lip_motion.relax).exp();
        self.voice_peak = if v > self.voice_peak {
            v
        } else {
            self.voice_peak + (v - self.voice_peak) * relax
        };
        self.voice_trough = if v < self.voice_trough {
            v
        } else {
            self.voice_trough + (v - self.voice_trough) * relax
        };
        let peak = self.voice_peak.max(0.05);
        if v < peak * self.lip_motion.arm {
            self.syllable_armed = true;
        } else if self.syllable_armed && v > peak * self.lip_motion.trigger && v > 0.1 {
            self.syllable_armed = false;
            let r = self.rng.next_f64();
            self.vowel = if r < 0.4 {
                Vowel::A
            } else if r < 0.58 {
                Vowel::O
            } else if r < 0.74 {
                Vowel::E
            } else if r < 0.88 {
                Vowel::I
            } else {
                Vowel::U
            };
        }
        let range = self.voice_peak - self.voice_trough;
        let rise = if range < peak * self.lip_motion.range {
            1.0
        } else {
            ((v - self.voice_trough) / range).max(0.0)
        };
        let shape = self.vowel.target();
        let level = (v.powf(0.7) * 1.15).min(1.0) * rise.powf(self.lip_motion.rise_power);
        let base_target = if self.speaking {
            level.min(0.95) * (0.45 + 0.55 * shape.open / 0.9)
        } else {
            0.0
        };
        let target = if self.lip_motion.openness == 1.0 {
            base_target
        } else {
            (base_target * self.lip_motion.openness).min(1.0)
        };
        let k = 1.0
            - (-dt
                * if target > self.mouth {
                    40.0
                } else {
                    self.lip_motion.audio_release
                })
            .exp();
        self.mouth += (target - self.mouth) * k;
        if self.speaking {
            self.vowel_form = shape.form.unwrap();
        }
        if self.speaking || self.mouth > 0.01 {
            Some([self.mouth, self.vowel_form])
        } else {
            None
        }
    }
    fn breath_value(&mut self, dt: f64) -> f64 {
        self.breath_phase += dt / self.breath_period;
        if self.breath_phase >= 1.0 {
            self.breath_phase -= 1.0;
            self.breath_period = 3.2 + self.rng.next_f64() * 1.4;
        }
        let x = self.breath_phase;
        if x < 0.4 {
            sstep(0.0, 0.4, x)
        } else if x < 0.88 {
            1.0 - sstep(0.4, 0.88, x)
        } else {
            0.0
        }
    }
    fn blink_value(&mut self, dt: f64) -> f64 {
        let b = &mut self.blink;
        b.t += dt;
        if b.t < b.start {
            return 1.0;
        }
        let x = (b.t - b.start) / 0.17;
        if x >= 1.0 {
            if b.double {
                b.double = false;
                b.start = b.t + 0.07;
            } else {
                b.start = b.t + 1.8 + self.rng.next_f64() * 4.2;
                b.double = self.rng.next_f64() < 0.18;
            }
            return 1.0;
        }
        if x < 0.45 {
            1.0 - x / 0.45
        } else {
            (x - 0.45) / 0.55
        }
    }
    pub fn update(&mut self, dt: f64) -> Parameters {
        self.t += dt;
        let t = self.t;
        let mut target = Parameters::default();
        match self.mode {
            Mode::Manual => target = self.manual.clone(),
            Mode::Auto => {
                target.angle_x = fbm(t * 0.18, 1.0) * 10.0 + self.gaze.x * 11.0;
                target.angle_y = fbm(t * 0.15, 2.0) * 6.0 - 1.0 + self.gaze.y * 7.0;
                target.angle_z = fbm(t * 0.12, 3.0) * 10.0;
                let body_gain = if self.planted { 0.35 } else { 1.0 };
                target.body_angle_x = fbm(t * 0.1, 4.0) * 5.0 * body_gain;
                target.body_angle_z = fbm(t * 0.09, 5.0) * 4.0 * body_gain;
                target.weight_shift = if self.planted {
                    weight_transfer(t)
                } else {
                    0.7 * (t * std::f64::consts::PI * 2.0 / 5.0).sin()
                };
                target.arm_angle = fbm(t * 0.14, 6.0) * 5.0;
                target.hand_angle = fbm(t * 0.21, 7.0) * 5.0;
                if t > self.gaze.next {
                    let r = self.rng.next_f64();
                    self.gaze.x = if r < 0.45 {
                        0.0
                    } else {
                        (self.rng.next_f64() * 2.0 - 1.0) * 0.8
                    };
                    self.gaze.y = if r < 0.45 {
                        0.0
                    } else {
                        (self.rng.next_f64() * 2.0 - 1.0) * 0.5
                    };
                    self.gaze.next = t + 0.8 + self.rng.next_f64() * 2.5;
                }
                target.gaze_x = self.gaze.x + target.angle_x / 60.0;
                target.gaze_y = self.gaze.y + target.angle_y / 60.0;
                if t > self.tap.next {
                    self.tap.until = t + 1.1;
                    self.tap.next = t + 5.0 + self.rng.next_f64() * 6.0;
                }
                if self.speaking {
                    self.next_idle = self.next_idle.max(t + 2.5);
                    self.next_auto = self.next_auto.max(t + 6.0);
                    let g = self.talk_gain;
                    self.talk_nod += (self.voice * 7.0 * g - self.talk_nod) * (dt * 6.0).min(1.0);
                    target.angle_y -= self.talk_nod;
                    target.angle_x += fbm(t * 0.6, 11.0) * 5.0 * g;
                    target.angle_z += fbm(t * 0.5, 12.0) * 4.0 * g;
                }
                if !self.speaking && t > self.emotion_until {
                    self.expr = "normal".into();
                    self.emotion_until = f64::INFINITY;
                }
                if !self.speaking {
                    if self.play.is_none() && self.auto_motion && t > self.next_auto {
                        self.play_random(false);
                        self.next_auto = t + 15.0 + self.rng.next_f64() * 10.0;
                        self.next_idle = self.next_idle.max(t + 5.0);
                    } else if self.play.is_none() && self.auto_idle && t > self.next_idle {
                        self.play_random(true);
                        self.next_idle = t + 5.0 + self.rng.next_f64() * 5.0;
                    }
                }
            }
            Mode::Mouse => {
                if let Some(pointer) = self.pointer {
                    let dx = (pointer[0] - self.face_center[0]) / 500.0;
                    let dy = (pointer[1] - self.face_center[1]) / 500.0;
                    target.angle_x = (dx * 30.0).clamp(-30.0, 30.0);
                    target.angle_y = (-dy * 30.0).clamp(-30.0, 30.0);
                    target.angle_z = (-dx * dy * 25.0).clamp(-12.0, 12.0);
                    target.body_angle_x = (dx * 10.0).clamp(-10.0, 10.0) * 0.6;
                    target.gaze_x = (dx * 1.4).clamp(-1.0, 1.0);
                    target.gaze_y = (-dy * 1.4).clamp(-1.0, 1.0);
                    target.hand_angle = (dx * 4.0).clamp(-5.0, 5.0);
                }
            }
        }
        if self.mode != Mode::Manual {
            target.breath = self.breath_value(dt);
            if t < self.tap.until {
                target.finger_tap = ((self.tap.until - t) * std::f64::consts::PI * 3.6)
                    .sin()
                    .max(0.0)
                    .powi(2);
            }
        }
        let mut tracks = None;
        let mut mw = 0.0;
        let mut idle = false;
        if let Some(play) = &mut self.play {
            let def = find_motion(&play.id).unwrap();
            play.t += dt;
            if play.t >= def.dur {
                self.play = None;
                self.motion_events.push(None);
            } else {
                idle = def.idle;
                let m: BTreeMap<_, _> = def
                    .tracks
                    .iter()
                    .map(|(id, keys)| (id.clone(), sample_track(keys, play.t)))
                    .collect();
                mw = sstep(0.0, 0.15, play.t) * (1.0 - sstep(def.dur - 0.25, def.dur, play.t));
                for (id, &v) in &m {
                    let current = target.get(id).unwrap_or(0.0);
                    if data().additive.contains(id) {
                        target.set(id, current + v);
                    } else if id == "breath" {
                        target.set(id, current + (v - current) * mw);
                    } else if !face_track(id) {
                        target.set(id, current.max(v.max(0.0)));
                    }
                }
                tracks = Some(m);
            }
        }
        if self.mode != Mode::Manual {
            target.angle_y += target.breath * 1.6;
        }
        if let Some(arms) = self.arm_rig.as_ref().filter(|_| self.mode != Mode::Manual) {
            let tilt =
                -target.body_angle_z / 10.0 * arms.body_roll + arms.leg_tilt * target.weight_shift;
            let time = dt.clamp(0.0, 0.05);
            let count = (time * 240.0).ceil() as usize;
            for _ in 0..count {
                let h = time / count as f64;
                self.arm_velocity +=
                    (100.0 * (-tilt * 0.65 - self.arm_follow) - 18.0 * self.arm_velocity) * h;
                self.arm_follow += self.arm_velocity * h;
            }
            for (sign, swing, bend) in [
                (1.0, "armSwingL", "elbowBendL"),
                (-1.0, "armSwingR", "elbowBendR"),
            ] {
                let relative = sign * self.arm_follow;
                let limit = arms.swing * if relative < 0.0 { arms.inward } else { 1.0 };
                let value = if limit > 0.0 { relative / limit } else { 0.0 };
                target.set(
                    swing,
                    (value + (target.breath - 0.5) * 0.06).clamp(-1.0, 1.0),
                );
                target.set(bend, target.breath * 0.025);
            }
        }
        let expr_target = expression_target(&self.expr);
        let k = 1.0 - (-dt * 9.0).exp();
        for (key, value) in expr_target {
            let mix = self.expr_mix.entry(key).or_insert(value);
            *mix += (value - *mix) * k;
        }
        let mut out = Parameters::default();
        for param in PARAMS {
            let id = param.id;
            let value = target.get(id).unwrap();
            if self.mode == Mode::Manual && tracks.is_none() {
                out.set(id, value);
                self.cur.set(id, value);
                self.vel.set(id, 0.0);
                continue;
            }
            let (mut stiff, mut zeta) = match id {
                "gazeX" | "gazeY" => (260.0_f64, 0.9),
                "angleX" | "angleY" => (55.0, 0.72),
                "angleZ" => (45.0, 0.75),
                "bodyAngleX" | "weightShift" => (14.0, 0.9),
                "bodyAngleZ" => (12.0, 0.9),
                "armAngle" => (20.0, 0.85),
                "handAngle" => (30.0, 0.8),
                _ => (120.0, 0.95),
            };
            if tracks.is_some() && (id.starts_with("angle") || id.starts_with("body")) {
                if idle {
                    stiff *= 1.8;
                    zeta = 0.8;
                } else if id.starts_with("angle") {
                    stiff *= 4.5;
                    zeta = 0.75;
                }
            }
            let damp = 2.0 * stiff.sqrt() * zeta;
            let mut velocity = self.vel.get(id).unwrap();
            let mut current = self.cur.get(id).unwrap();
            velocity += (stiff * (value - current) - damp * velocity) * dt;
            current += velocity * dt;
            self.vel.set(id, velocity);
            self.cur.set(id, current);
            out.set(id, current);
        }
        let mut blink = 1.0;
        if self.mode != Mode::Manual {
            blink = self.blink_value(dt);
            let x = &self.expr_mix;
            out.eye_r_open = x["eyeOpen"] * blink;
            out.eye_l_open = x["eyeOpenL"] * blink;
            out.eye_smile = x["eyeSmile"];
            out.eye_smile_l = Some(x["eyeSmileL"]);
            out.mouth_open = x["mouthOpen"];
            out.mouth_form = x["mouthForm"];
            out.blush = x["blush"];
            out.brow_y = x["browY"]
                + if out.angle_y > 0.0 {
                    out.angle_y / 60.0
                } else {
                    0.0
                }
                - (1.0 - blink) * 0.18;
            out.brow_angle = x["browAngle"];
            out.gaze_x = (out.gaze_x + x["gx"]).clamp(-1.0, 1.0);
            out.gaze_y = (out.gaze_y + x["gy"]).clamp(-1.0, 1.0);
        } else {
            out.eye_smile_l = Some(out.eye_smile);
        }
        if let Some(m) = tracks {
            let mut mix = |key: &str, v: f64| {
                let current = out.get(key).unwrap();
                out.set(key, current + (v - current) * mw);
            };
            if let Some(&v) = m.get("eyeOpen") {
                mix("eyeROpen", v.clamp(0.0, 1.3) * blink);
                if !m.contains_key("eyeOpenL") {
                    mix("eyeLOpen", v.clamp(0.0, 1.3) * blink);
                }
            }
            if let Some(&v) = m.get("eyeOpenL") {
                mix("eyeLOpen", v.clamp(0.0, 1.3) * blink);
            }
            if let Some(&v) = m.get("eyeSmile") {
                mix("eyeSmile", v);
                if !m.contains_key("eyeSmileL") {
                    mix("eyeSmileL", v);
                }
            }
            if let Some(&v) = m.get("eyeSmileL") {
                mix("eyeSmileL", v);
            }
            for id in ["mouthOpen", "mouthForm", "blush", "browY", "browAngle"] {
                if let Some(&v) = m.get(id) {
                    mix(
                        id,
                        if matches!(id, "mouthOpen" | "blush") {
                            v.max(0.0)
                        } else {
                            v
                        },
                    );
                }
            }
        }
        if let Some(sm) = self.speech_mouth(dt) {
            self.lip_open = Some(sm[0]);
            self.lip_form = sm[1];
        } else if self.lip_open.is_some() && !self.speaking && self.kana.is_none() {
            self.lip_open = None;
        }
        if let Some(open) = self.lip_open {
            out.mouth_open = (out.mouth_open * 0.3).max(open);
            out.mouth_form = self.lip_form.clamp(-1.0, 1.0);
        }
        self.parameters = out.clone();
        out
    }
}
