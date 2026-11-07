//! 待机动作，移植自 LivLiv 播放器的 `LivelyIdle`（`attend` 风格，没有指针；见 docs/spec/puppet-format-spec.md §5）：
//! - 头和身体在平滑的值噪声上游移，经阻尼弹簧跟随（头略过冲、身体拖后），头的转动有软上限；
//! - 眼睛先动：每 0.6–2.2 秒一次小扫视，头跟着；大的视线跳动带一次眨眼；
//! - 呼吸不均匀：吸 40%、呼 48%、停一下，每轮 3.2–4.6 秒；
//! - 眨眼 75 ms 合上、120 ms 睁开，约六次里一次连眨两下，眉毛随眨眼微沉；
//! - 安静 10–20 秒后来一个小动作（瞥一眼、左右看、晃、想事情、低头看一眼），说话时不开始、正在做的 0.4 秒内淡出；
//! - 说话（配音的嘴张开）时眼睛回看镜头，一句话停下后眨一次眼（LivLiv `TalkMotion` 里交给播放器的两件事）。
//!
//! LivLiv 用 `Math.random`；这里所有随机数都来自固定种子的 splitmix64，噪声的格点值也用整数哈希，所以同一个种子
//! 在任何平台、任何 seek 顺序下都逐位相同。全部状态都在结构体里，快照克隆它就能接着走。

use crate::rig::Params;
use crate::smooth;

/// 一个小动作：每个通道是 `[秒, 值]` 关键帧，三次插值、两端放平。头和身体的通道是加在游移目标上的度数（也经弹簧），
/// 眼珠加在视线上，`eye` 乘在睁眼程度上，`brow` 加在两条眉毛上，`breath` 取代呼吸。
struct Move {
    dur: f64,
    tracks: &'static [(Ch, &'static [(f64, f64)])],
}

#[derive(Clone, Copy, PartialEq)]
enum Ch {
    AngleX,
    AngleY,
    AngleZ,
    BodyX,
    BodyZ,
    EyeBallX,
    EyeBallY,
    Eye,
    Brow,
    Breath,
}

impl Ch {
    /// 随机镜像时改符号的通道（左右方向）。
    fn mirrored(self) -> bool {
        matches!(self, Ch::AngleX | Ch::AngleZ | Ch::BodyX | Ch::BodyZ | Ch::EyeBallX)
    }
}

/// LivLiv 的五个小动作（`IDLE_MOVES`），顺序与它一致。
const MOVES: [Move; 5] = [
    // glance：眼睛先瞥向一边，头跟过去，停住，再回来
    Move {
        dur: 4.0,
        tracks: &[
            (Ch::EyeBallX, &[(0.0, 0.0), (0.15, 0.8), (2.5, 0.75), (2.8, 0.0)]),
            (Ch::EyeBallY, &[(0.0, 0.0), (0.15, 0.25), (2.5, 0.2), (2.8, 0.0)]),
            (Ch::AngleX, &[(0.0, 0.0), (0.6, 11.0), (2.5, 10.0), (3.4, 0.0)]),
            (Ch::AngleY, &[(0.0, 0.0), (0.6, 4.0), (2.5, 3.0), (3.4, 0.0)]),
            (Ch::AngleZ, &[(0.0, 0.0), (0.7, -4.0), (2.5, -3.0), (3.4, 0.0)]),
            (Ch::BodyX, &[(0.0, 0.0), (1.0, 2.0), (2.6, 1.5), (3.8, 0.0)]),
            (Ch::Brow, &[(0.0, 0.0), (0.4, 0.25), (2.5, 0.2), (3.2, 0.0)]),
            (Ch::Breath, &[(0.0, 0.1), (0.6, 0.7), (2.6, 0.6), (3.6, 0.0), (4.0, 0.15)]),
        ],
    },
    // lookAround：先看一边，再看另一边
    Move {
        dur: 5.0,
        tracks: &[
            (Ch::EyeBallX, &[(0.0, 0.0), (0.2, -0.8), (1.4, -0.75), (1.7, 0.1), (2.0, 0.8), (3.2, 0.75), (3.5, 0.0)]),
            (Ch::AngleX, &[(0.0, 0.0), (0.7, -15.0), (1.5, -14.0), (2.4, 15.0), (3.3, 14.0), (4.2, 0.0)]),
            (Ch::AngleY, &[(0.0, 0.0), (0.8, 3.0), (2.4, 3.0), (4.2, 0.0)]),
            (Ch::AngleZ, &[(0.0, 0.0), (0.8, 3.0), (1.7, 0.0), (2.5, -3.0), (4.2, 0.0)]),
            (Ch::BodyX, &[(0.0, 0.0), (1.0, -3.0), (2.7, 3.0), (4.4, 0.0)]),
            (Ch::Brow, &[(0.0, 0.0), (0.5, 0.3), (3.4, 0.25), (4.2, 0.0)]),
            (Ch::Breath, &[(0.0, 0.2), (0.6, 0.8), (3.4, 0.7), (4.4, 0.0), (5.0, 0.1)]),
        ],
    },
    // sway：身体慢慢左右晃
    Move {
        dur: 6.0,
        tracks: &[
            (Ch::BodyZ, &[(0.0, 0.0), (1.5, 3.5), (3.0, -3.5), (4.5, 3.0), (6.0, 0.0)]),
            (Ch::BodyX, &[(0.0, 0.0), (1.5, 2.0), (3.0, -2.0), (4.5, 1.5), (6.0, 0.0)]),
            (Ch::AngleZ, &[(0.0, 0.0), (1.6, -7.0), (3.1, 7.0), (4.6, -6.0), (6.0, 0.0)]),
            (Ch::AngleX, &[(0.0, 0.0), (1.6, 4.0), (3.1, -4.0), (4.6, 3.0), (6.0, 0.0)]),
            (Ch::EyeBallX, &[(0.0, 0.0), (1.6, -0.25), (3.1, 0.25), (4.6, -0.2), (6.0, 0.0)]),
            (Ch::Eye, &[(0.0, 1.0), (0.8, 0.88), (5.2, 0.88), (6.0, 1.0)]),
            (
                Ch::Breath,
                &[(0.0, 0.0), (0.75, 1.0), (1.5, 0.0), (2.25, 1.0), (3.0, 0.0), (3.75, 1.0), (4.5, 0.0), (5.25, 0.8), (6.0, 0.0)],
            ),
        ],
    },
    // think：眼睛往上往旁边，头歪一下，眉毛抬起
    Move {
        dur: 4.4,
        tracks: &[
            (Ch::EyeBallX, &[(0.0, 0.0), (0.3, -0.6), (3.4, -0.55), (3.8, 0.0)]),
            (Ch::EyeBallY, &[(0.0, 0.0), (0.3, 0.6), (3.4, 0.55), (3.8, 0.0)]),
            (Ch::AngleX, &[(0.0, 0.0), (0.8, -9.0), (3.4, -8.0), (4.2, 0.0)]),
            (Ch::AngleY, &[(0.0, 0.0), (0.8, 6.0), (3.4, 5.0), (4.2, 0.0)]),
            (Ch::AngleZ, &[(0.0, 0.0), (0.9, 6.0), (3.4, 5.0), (4.2, 0.0)]),
            (Ch::Brow, &[(0.0, 0.0), (0.6, 0.35), (3.4, 0.3), (4.2, 0.0)]),
            (Ch::Eye, &[(0.0, 1.0), (0.6, 0.92), (3.4, 0.92), (4.0, 1.0)]),
        ],
    },
    // lookDown：低头看一眼（稿子、弹幕），再看回镜头
    Move {
        dur: 2.4,
        tracks: &[
            (Ch::EyeBallY, &[(0.0, 0.0), (0.2, -0.85), (1.4, -0.8), (1.65, 0.0)]),
            (Ch::EyeBallX, &[(0.0, 0.0), (0.2, -0.1), (1.4, -0.1), (1.65, 0.0)]),
            (Ch::AngleY, &[(0.0, 0.0), (0.45, -8.0), (1.4, -7.0), (1.9, 1.0), (2.4, 0.0)]),
            (Ch::AngleZ, &[(0.0, 0.0), (0.5, 2.0), (1.5, 2.0), (2.4, 0.0)]),
            (Ch::Eye, &[(0.0, 1.0), (0.3, 0.8), (1.4, 0.8), (1.65, 1.0)]),
        ],
    },
];

/// 关键帧三次插值（Hermite，内部关键帧的斜率取左右两帧的差商，两端放平）。
fn sample(k: &[(f64, f64)], t: f64) -> f64 {
    let n = k.len() - 1;
    if t <= k[0].0 {
        return k[0].1;
    }
    if t >= k[n].0 {
        return k[n].1;
    }
    let mut i = 0;
    while t > k[i + 1].0 {
        i += 1;
    }
    let slope = |j: usize| {
        if j == 0 || j >= n {
            0.0
        } else {
            (k[j + 1].1 - k[j - 1].1) / (k[j + 1].0 - k[j - 1].0)
        }
    };
    let h = k[i + 1].0 - k[i].0;
    let u = (t - k[i].0) / h;
    let (u2, u3) = (u * u, u * u * u);
    (2.0 * u3 - 3.0 * u2 + 1.0) * k[i].1
        + (u3 - 2.0 * u2 + u) * slope(i) * h
        + (-2.0 * u3 + 3.0 * u2) * k[i + 1].1
        + (u3 - u2) * slope(i + 1) * h
}

/// 不超过 `k` 时原样，之后缓缓逼近 `cap`（永不越过）：头的转动加起来的软上限。
fn knee(v: f64, k: f64, cap: f64) -> f64 {
    let a = v.abs();
    if a <= k {
        v
    } else {
        v.signum() * (k + (cap - k) * ((a - k) / (cap - k)).tanh())
    }
}

/// splitmix64 的一步。
fn mix(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

fn unit(z: u64) -> f64 {
    (z >> 11) as f64 / (1u64 << 53) as f64
}

/// 平滑的一维值噪声，-1..1：整数点上是随机值（整数哈希，不用 sin，跨平台逐位一致），中间平滑过渡。
fn noise(t: f64, seed: u64) -> f64 {
    let i = t.floor();
    let f = t - i;
    let u = f * f * (3.0 - 2.0 * f);
    let h = |n: f64| unit(mix(seed ^ (n as i64 as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15)));
    (h(i) * (1.0 - u) + h(i + 1.0) * u) * 2.0 - 1.0
}

fn fbm(t: f64, seed: u64) -> f64 {
    noise(t, seed) * 0.7 + noise(t * 2.3, seed.wrapping_add(17)) * 0.3
}

/// 头和身体五个通道的 [刚度, 阻尼比]：眼睛先到，头略过冲地跟上，身体拖在后面。
const SPRING: [(f64, f64); 5] = [(55.0, 0.72), (55.0, 0.72), (45.0, 0.75), (14.0, 0.9), (12.0, 0.9)];

/// 视线的上限：横 0.78、竖 0.55 的椭圆（再往外虹膜会被眼睑切掉），从它的 70% 开始缓入。
const EYE_X_CAP: f64 = 0.78;
const EYE_Y_CAP: f64 = 0.55;
const EYE_KNEE: f64 = 0.7;

/// 说话程度（LivLiv `TalkMotion` 的 `act`）：嘴张过这个值算有声音。
const QUIET: f64 = 0.2;

#[derive(Clone)]
struct Playing {
    id: usize,
    t: f64,
    side: f64,
    fade: f64,
}

#[derive(Clone)]
pub(crate) struct Idle {
    rng: u64,
    seed: u64,
    next_blink: f64,
    blink_t: f64,
    blink_at: f64,
    double: bool,
    next_saccade: f64,
    jitter: [f64; 2],
    /// 视线目标的慢跟随（0.35 秒）：离它一大步的跳动带一次眨眼。
    slow: [f64; 2],
    breath_phase: f64,
    breath_period: f64,
    /// 头和身体五个弹簧的位置、速度，与缓过的目标（第一步取目标本身）。
    springs: [(f64, f64); 5],
    aim: Option<[f64; 5]>,
    playing: Option<Playing>,
    next_move: f64,
    last_move: Option<usize>,
    /// 上一步配音给的嘴张多大（LivLiv 的 `was.mouth`）：说话时不开始小动作。
    last_voice: f64,
    /// 说话程度 0..1 与距上次有声音的秒数。
    act: f64,
    quiet: f64,
    params: Params,
}

impl Idle {
    pub fn new(seed: u64) -> Idle {
        let mut idle = Idle {
            rng: seed ^ 0x9e37_79b9_7f4a_7c15,
            seed: 0,
            next_blink: 2.0,
            blink_t: -1.0,
            blink_at: -99.0,
            double: false,
            next_saccade: 1.0,
            jitter: [0.0; 2],
            slow: [0.0; 2],
            breath_phase: 0.0,
            breath_period: 3.8,
            springs: [(0.0, 0.0); 5],
            aim: None,
            playing: None,
            next_move: 6.0,
            last_move: None,
            last_voice: 0.0,
            act: 0.0,
            quiet: 10.0,
            params: Params::default(),
        };
        idle.seed = mix(idle.next_u64());
        idle
    }

    fn next_u64(&mut self) -> u64 {
        self.rng = self.rng.wrapping_add(0x9e37_79b9_7f4a_7c15);
        mix(self.rng)
    }

    /// [0, 1)。
    fn random(&mut self) -> f64 {
        unit(self.next_u64())
    }

    fn breath(&mut self, dt: f64) -> f64 {
        self.breath_phase += dt / self.breath_period;
        if self.breath_phase >= 1.0 {
            self.breath_phase -= 1.0;
            self.breath_period = 3.2 + self.random() * 1.4;
        }
        let x = self.breath_phase;
        if x < 0.4 {
            smooth(0.0, 0.4, x)
        } else if x < 0.88 {
            1.0 - smooth(0.4, 0.88, x)
        } else {
            0.0
        }
    }

    /// 走到时刻 `t`（这一步长 `dt`），返回待机的参数。`voice`：这一刻配音让嘴张多大（没有配音为 0）：说话时不开始
    /// 小动作，眼睛回看镜头，一句话停下后眨一次眼。
    pub fn step(&mut self, t: f64, dt: f64, voice: f64) -> Params {
        let dt = dt.clamp(0.0, 0.1);
        let busy = self.last_voice > 0.05;
        self.last_voice = voice;

        // 小动作：安静时隔一阵开始一个，说话时淡出（0.4 秒）
        if let Some(m) = &mut self.playing {
            m.t += dt;
            if busy {
                m.fade = (m.fade - dt / 0.4).max(0.0);
            }
            if m.t >= MOVES[m.id].dur || m.fade <= 0.0 {
                self.playing = None;
            }
        } else if busy {
            self.next_move = self.next_move.max(t + 3.0);
        } else if t > self.next_move {
            let ids: Vec<usize> = (0..MOVES.len()).filter(|&k| Some(k) != self.last_move).collect();
            let id = ids[((self.random() * ids.len() as f64) as usize).min(ids.len() - 1)];
            let side = if self.random() < 0.5 { -1.0 } else { 1.0 };
            self.playing = Some(Playing { id, t: 0.0, side, fade: 1.0 });
            self.last_move = Some(id);
            self.next_move = t + MOVES[id].dur + 10.0 + self.random() * 10.0;
        }
        let playing = self.playing.clone();
        let w = playing.as_ref().map_or(0.0, |m| {
            let d = MOVES[m.id].dur;
            m.fade * smooth(0.0, 0.15, m.t) * (1.0 - smooth(d - 0.25, d, m.t))
        });
        let mv = |ch: Ch, rest: f64| -> f64 {
            let Some(m) = &playing else { return rest };
            let Some((_, keys)) = MOVES[m.id].tracks.iter().find(|(c, _)| *c == ch) else {
                return rest;
            };
            let v = sample(keys, m.t) * if ch.mirrored() { m.side } else { 1.0 };
            rest + (v - rest) * w
        };

        // 眨眼：75 ms 合上，120 ms 睁开，约六次里一次紧接着再眨一下
        let mut open = 1.0;
        if self.blink_t < 0.0 && t > self.next_blink {
            self.blink_t = 0.0;
            self.blink_at = t;
        }
        if self.blink_t >= 0.0 {
            self.blink_t += dt;
            let b = self.blink_t / 0.075;
            open = (if b < 1.0 {
                1.0 - b
            } else if b < 2.6 {
                (b - 1.0) / 1.6
            } else {
                1.0
            })
            .clamp(0.0, 1.0);
            if b >= 2.6 {
                self.blink_t = -1.0;
                if !self.double && self.random() < 0.18 {
                    self.double = true;
                    self.next_blink = t + 0.08;
                } else {
                    self.double = false;
                    self.next_blink = t + 1.8 + self.random() * 3.8;
                }
            }
        }
        let eye = mv(Ch::Eye, 1.0).clamp(0.0, 1.0) * open;

        // 眼睛先动：扫视时一点自己的漂移，加上小动作的视线，限在椭圆里；头经弹簧跟着，只转一点
        if t > self.next_saccade {
            let (rx, ry) = (self.random(), self.random());
            self.jitter = [(rx - 0.5) * 0.2, (ry - 0.5) * 0.16];
            self.next_saccade = t + 0.6 + self.random() * 1.6;
        }
        let gaze = self.jitter;
        let (ex, ey) = (gaze[0] + mv(Ch::EyeBallX, 0.0), gaze[1] + mv(Ch::EyeBallY, 0.0));
        let e = (ex / EYE_X_CAP).hypot(ey / EYE_Y_CAP);
        let k = if e > EYE_KNEE { knee(e, EYE_KNEE, 1.0) / e } else { 1.0 };
        let (gx, gy) = (ex * k, ey * k);
        // 视线一大步跳开（离过去约 0.35 秒的位置 0.5 以上）时眨一次眼，离上次眨眼至少 1.2 秒
        if (gx - self.slow[0]).hypot(gy - self.slow[1]) > 0.5 {
            if self.blink_t < 0.0 && t - self.blink_at > 1.2 {
                self.next_blink = self.next_blink.min(t);
            }
            self.slow = [gx, gy];
        }
        let a = (dt / 0.35).min(1.0);
        self.slow[0] += (gx - self.slow[0]) * a;
        self.slow[1] += (gy - self.slow[1]) * a;

        let sd = self.seed;
        let target = [
            knee(fbm(t * 0.17, sd) * 4.0 + gaze[0] * 2.0 + mv(Ch::AngleX, 0.0), 10.0, 13.0),
            knee(fbm(t * 0.13, sd.wrapping_add(1)) * 3.0 + gaze[1] * 2.0 + mv(Ch::AngleY, 0.0), 6.0, 10.0),
            knee(fbm(t * 0.11, sd.wrapping_add(2)) * 5.0 + mv(Ch::AngleZ, 0.0), 8.0, 12.0),
            fbm(t * 0.09, sd.wrapping_add(3)) * 3.0 + mv(Ch::BodyX, 0.0),
            fbm(t * 0.08, sd.wrapping_add(4)) * 2.5 + mv(Ch::BodyZ, 0.0),
        ];
        let brow_move = mv(Ch::Brow, 0.0);
        let own_breath = self.breath(dt);
        let breath = mv(Ch::Breath, own_breath);

        let p = &mut self.params;
        p.eye_l_open = eye;
        p.eye_r_open = eye;
        let ke = (dt * 18.0).min(1.0);
        p.eye_ball_x += (gx - p.eye_ball_x) * ke;
        p.eye_ball_y += (gy - p.eye_ball_y) * ke;

        // 目标先缓 0.12 秒（扫视让目标跳一步，被一步拉动的弹簧会猛地一抖），再半隐式欧拉走弹簧
        let n = ((dt * 120.0 - 1e-9).ceil() as usize).max(1);
        let aim = self.aim.get_or_insert(target);
        let h = dt / n as f64;
        for (i, (kk, z)) in SPRING.iter().enumerate() {
            let c = 2.0 * kk.sqrt() * z;
            let s = &mut self.springs[i];
            for _ in 0..n {
                aim[i] += (target[i] - aim[i]) * (h / 0.12).min(1.0);
                s.1 += (kk * (aim[i] - s.0) - c * s.1) * h;
                s.0 += s.1 * h;
            }
        }
        p.angle_x = self.springs[0].0;
        p.angle_y = self.springs[1].0;
        p.angle_z = self.springs[2].0;
        p.body_x = self.springs[3].0;
        p.body_z = self.springs[4].0;
        p.breath = breath.clamp(0.0, 1.0);
        // 眉毛：随每次眨眼微沉，加上小动作的
        let bt = -(1.0 - open) * 0.15 + brow_move;
        p.brow_ly += (bt - p.brow_ly) * (dt * 10.0).min(1.0);
        p.brow_ry = p.brow_ly;

        // 说话：有声音后 act 很快升到 1，最后一个音节后约一秒落下；落过 0.6 而且停了 0.4 秒以上，眨一次眼
        self.quiet += dt;
        if voice > QUIET {
            self.quiet = 0.0;
        }
        let was = self.act;
        let talking = self.quiet < 0.35;
        self.act += (if talking { 1.0 } else { 0.0 } - self.act) * (dt * if talking { 6.0 } else { 1.2 }).min(1.0);
        if was > 0.6 && self.act <= 0.6 && self.quiet > 0.4 {
            self.next_blink = self.next_blink.min(t);
        }

        // 说话时眼睛回看镜头（视线留 30%）
        let mut out = self.params;
        out.eye_ball_x *= 1.0 - 0.7 * self.act;
        out.eye_ball_y *= 1.0 - 0.7 * self.act;
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TICK: f64 = 1.0 / 120.0;

    fn run(seed: u64, secs: f64, voice: impl Fn(f64) -> f64) -> Vec<Params> {
        let mut idle = Idle::new(seed);
        (0..(secs / TICK) as u64).map(|k| idle.step(k as f64 * TICK, TICK, voice(k as f64 * TICK))).collect()
    }

    #[test]
    fn the_same_seed_gives_the_same_motion() {
        let a = run(7, 40.0, |_| 0.0);
        let b = run(7, 40.0, |_| 0.0);
        let c = run(8, 40.0, |_| 0.0);
        assert!(a.iter().zip(&b).all(|(x, y)| x.angle_x.to_bits() == y.angle_x.to_bits() && x.eye_l_open == y.eye_l_open));
        assert!(a.iter().zip(&c).any(|(x, y)| (x.angle_x - y.angle_x).abs() > 0.5));
    }

    #[test]
    fn idles_within_livliv_limits() {
        let ps = run(3, 120.0, |_| 0.0);
        let max = |f: fn(&Params) -> f64| ps.iter().map(|p| f(p).abs()).fold(0.0, f64::max);
        // 头的转动有软上限（加上弹簧的一点过冲），视线在椭圆里
        assert!(max(|p| p.angle_x) < 14.0 && max(|p| p.angle_y) < 11.0 && max(|p| p.angle_z) < 13.0);
        assert!(max(|p| p.eye_ball_x) <= EYE_X_CAP + 1e-9 && max(|p| p.eye_ball_y) <= EYE_Y_CAP + 1e-9);
        // 两分钟里眨眼二十多次，至少有一个小动作把头转过 8 度
        let blinks = ps.windows(2).filter(|w| w[0].eye_l_open > 0.5 && w[1].eye_l_open <= 0.5).count();
        assert!((15..60).contains(&blinks), "{blinks} blinks");
        assert!(max(|p| p.angle_x) > 8.0);
        // 呼吸在 0..1 里起伏
        assert!(ps.iter().any(|p| p.breath > 0.9) && ps.iter().any(|p| p.breath < 0.05));
    }

    #[test]
    fn talking_holds_off_idle_moves_and_brings_the_eyes_back() {
        // 一直在说话：不会有小动作，头只在游移的范围里
        let ps = run(3, 60.0, |t| if (t * 4.0).fract() < 0.6 { 0.6 } else { 0.0 });
        assert!(ps.iter().all(|p| p.angle_x.abs() < 7.5), "an idle move played while talking");
        let quiet = run(3, 60.0, |_| 0.0);
        let mean = |v: &[Params]| v[1200..].iter().map(|p| p.eye_ball_x.abs()).sum::<f64>() / (v.len() - 1200) as f64;
        assert!(mean(&ps) < 0.5 * mean(&quiet));
    }

    #[test]
    fn a_pause_after_talking_brings_a_blink() {
        // 说 3 秒，停下：停顿后 1.5 秒内眨一次眼（不说话时这里没有眨眼）
        let mut idle = Idle::new(11);
        let mut closed_after_pause = false;
        for k in 0..(6.0 / TICK) as u64 {
            let t = k as f64 * TICK;
            let v = if t < 3.0 && (t * 4.0).fract() < 0.6 { 0.6 } else { 0.0 };
            let p = idle.step(t, TICK, v);
            if t > 3.3 && t < 4.6 && p.eye_l_open < 0.2 {
                closed_after_pause = true;
            }
        }
        assert!(closed_after_pause);
    }
}
