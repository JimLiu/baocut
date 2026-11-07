//! 待机动作（移植自 LivLiv 的 `IdleDriver`）：呼吸、眨眼（75 ms 合上、120 ms 睁开）、眼睛先于头的扫视、头的
//! 慢游移、身体的晃。LivLiv 用 `Math.random`；这里用固定种子的伪随机数，同一个种子每次都一样。

use crate::rig::Params;

#[derive(Clone)]
pub(crate) struct Idle {
    rng: u64,
    next_blink: f64,
    blink_t: f64,
    next_saccade: f64,
    gaze: [f64; 2],
    params: Params,
}

impl Idle {
    pub fn new(seed: u64) -> Idle {
        Idle {
            rng: seed ^ 0x9e37_79b9_7f4a_7c15,
            next_blink: 2.0,
            blink_t: -1.0,
            next_saccade: 1.0,
            gaze: [0.0; 2],
            params: Params::default(),
        }
    }

    /// splitmix64，取 [0, 1)。
    fn random(&mut self) -> f64 {
        self.rng = self.rng.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.rng;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^= z >> 31;
        (z >> 11) as f64 / (1u64 << 53) as f64
    }

    /// 走到时刻 `t`（这一步长 `dt`），返回待机的参数。
    pub fn step(&mut self, t: f64, dt: f64) -> &Params {
        let p = &mut self.params;
        p.breath = 0.5 + 0.5 * (t * 2.1).sin();
        if self.blink_t < 0.0 && t > self.next_blink {
            self.blink_t = 0.0;
        }
        if self.blink_t >= 0.0 {
            self.blink_t += dt;
            let b = self.blink_t / 0.075;
            let open = if b < 1.0 {
                1.0 - b
            } else if b < 2.6 {
                (b - 1.0) / 1.6
            } else {
                1.0
            };
            p.eye_l_open = open.clamp(0.0, 1.0);
            p.eye_r_open = p.eye_l_open;
            if b >= 2.6 {
                self.blink_t = -1.0;
                let r = self.random();
                self.next_blink = t + 1.8 + r * 3.8;
            }
        }
        if t > self.next_saccade {
            let (rx, ry) = (self.random(), self.random());
            self.gaze = [(rx - 0.5) * 0.25, (ry - 0.5) * 0.2];
            let r = self.random();
            self.next_saccade = t + 0.6 + r * 1.6;
        }
        let p = &mut self.params;
        let k = (dt * 18.0).min(1.0);
        p.eye_ball_x += ((self.gaze[0] * 1.2).clamp(-1.0, 1.0) - p.eye_ball_x) * k;
        p.eye_ball_y += (self.gaze[1].clamp(-1.0, 1.0) - p.eye_ball_y) * k;
        let (tx, ty) = ((t * 0.7).sin() * 3.5, (t * 0.9).sin() * 2.0);
        p.angle_x += (tx - p.angle_x) * (dt * 3.0).min(1.0);
        p.angle_y += (ty - p.angle_y) * (dt * 3.0).min(1.0);
        p.angle_z += ((t * 0.5).sin() * 3.0 - p.angle_z) * (dt * 2.0).min(1.0);
        p.body_x += ((t * 0.33).sin() * 1.5 - p.body_x) * (dt * 2.0).min(1.0);
        p.body_z += ((t * 0.41 + 1.0).sin() * 1.2 - p.body_z) * (dt * 2.0).min(1.0);
        p.brow_ly += (0.0 - p.brow_ly) * (dt * 4.0).min(1.0);
        p.brow_ry = p.brow_ly;
        &self.params
    }
}
