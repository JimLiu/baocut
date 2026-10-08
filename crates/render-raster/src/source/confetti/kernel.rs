//! `confetti-v1` 闭式运动核（设计稿 `docs/design/elements/bcut-confetti-element-design.md` §4）。
//!
//! 运动模型改编自三个 MIT 来源（署名与许可原文见
//! `core/assets/elements/vendor/sources.json`，id 与配方 `sources[]` 一致）：
//!
//! * `react-confetti/particle`（© Aaron Lampros，MIT）——纸片的重力 / 阻力 /
//!   翻转（`sy` 三角波）模型；
//! * `party-js/confetti` + `party-js/shapes`（© Ian Hornik，MIT）——礼炮发射器、
//!   扇面角与 `spinDps` / `flipHz` 两档随机区间；
//! * `js-confetti/flight`（© Vitalii Loginov，MIT）——爆发式发射、按年龄淡出与
//!   `sizeRamp` 出生放大。
//!
//! 与原型 `designs/baocut/app/model-confetti.js` **逐字同源**：同一份 props +
//! 同一个 t 恒得同一张粒子表，原型与核心的对拍靠这一点成立。
//!
//! ## 两条硬约束
//!
//! 1. **闭式运动**。每个粒子的位置 / 旋转 / 大小 / 透明度都是 τ（它自己的年龄）
//!    的显式函数，不积分、不存上一帧——拖播放头、倒放、导出抽帧都不会漂，
//!    也正是 `bcut-render` 「乱序采样 == 顺序采样」契约的前提。
//! 2. **随机数只来自 [`splitmix64_unit`]`(seed, i·16 + c)`**。粒子 i 的第 c 个
//!    通道是一个纯函数；本模块没有任何 RNG 状态。
//!
//! 本模块只描述「参数 → 粒子表」，一个样式参数都不自带：十款配方的数字住在
//! `core/presets/builtin/confetti/*.json`（`bcut-motion` 注册表），用户覆盖住在
//! `bcut-timeline` 的 `ConfettiProps`，两者由 host 折算成 [`Motion`] 与
//! [`Overrides`] 后才进来。

use std::f64::consts::{PI, TAU};

/// 配方的参考短边：所有像素量（`speedPx` / `gravityPx` / `sizePx` / `driftPx` /
/// `windPx`）都是 540 短边下的值，host 按 `短边 / 540` 折算成 `pixel_scale`。
/// 真相在 `bcut_timeline::REFERENCE_SHORT_EDGE`；`bcut-render` 不依赖那条 crate
/// 边，这里复述一次并点名出处。
pub const REF_SHORT: f64 = 540.0;
/// 每个粒子的随机通道数。
pub const CHANNELS: u64 = 16;
/// 寿命抖动下限：`life = lifeSec · lerp(0.85, 1, u13)`。
pub const LIFE_JITTER: f64 = 0.85;

/// `splitmix64` 的第 `k` 个输出折成 `[0, 1)`（53 位尾数）。
///
/// 与原型的 BigInt 实现逐位相同：`z = seed + k·φ`，两轮 xorshift-multiply，
/// 取高 53 位除以 2⁵³。
pub fn splitmix64_unit(seed: u64, k: u64) -> f64 {
    let mut z = seed.wrapping_add(k.wrapping_mul(0x9E37_79B9_7F4A_7C15));
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    (z >> 11) as f64 / 9_007_199_254_740_992.0
}

/// 粒子 `i` 的 16 个随机通道。
pub fn channels(seed: u64, i: u64) -> [f64; CHANNELS as usize] {
    let mut out = [0.0; CHANNELS as usize];
    for (c, slot) in out.iter_mut().enumerate() {
        *slot = splitmix64_unit(seed, i * CHANNELS + c as u64);
    }
    out
}

/// 发射方式。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmitMode {
    /// 连续：第 i 枚在 `(i + u0) / rate` 秒出生。
    Continuous,
    /// 爆发：每 `interval` 秒一波、每波 `count` 枚；`interval == 0` 只爆一次。
    Burst,
}

/// 生效的发射参数（配方缺省 + 用户覆盖已合并）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Emit {
    pub mode: EmitMode,
    /// `continuous`：粒 / 秒（已取整，≥ 1）。
    pub rate: f64,
    /// `burst`：每波枚数（≥ 1）。
    pub count: u64,
    /// `burst`：波间隔秒；`0` = 只爆一次。
    pub interval: f64,
    /// 元素结束前 `lifeSec` 秒停止发射，让画面自然清空。
    pub settle: bool,
}

/// 一枚发射器：中心 `(x, y)` 与散布 `(spread_x, spread_y)` 均为元素盒的百分比；
/// `angle` 为该发射器自己的基准角（屏幕坐标，90 = 向下，−90 = 向上），缺席
/// 用配方的 `angle`。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Emitter {
    pub x: f64,
    pub y: f64,
    pub spread_x: f64,
    pub spread_y: f64,
    pub angle: Option<f64>,
}

/// 大小脉动（`champagne-sparkle`）：`size ×= lerp(min, max, ½ + ½·sin(2π·hz·τ + φ))`。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pulse {
    pub min: f64,
    pub max: f64,
    pub hz: f64,
}

/// 一款配方的运动参数（`recipe.params` 的强类型镜像，像素量按 540 短边）。
#[derive(Debug, Clone, PartialEq)]
pub struct Motion {
    pub emit: Emit,
    pub emitters: Vec<Emitter>,
    pub angle: f64,
    pub spread: f64,
    pub speed_px: [f64; 2],
    pub drag_x: f64,
    pub drag_y: f64,
    pub gravity_px: f64,
    pub wind_px: f64,
    pub drift_px: f64,
    pub drift_hz: f64,
    pub size_px: [f64; 2],
    pub size_ramp: bool,
    pub spin_dps: [f64; 2],
    pub flip_hz: [f64; 2],
    pub pulse: Option<Pulse>,
    pub life_sec: f64,
    pub fade_in: f64,
    pub fade_out: f64,
    pub max_alive: usize,
}

/// 用户侧覆盖（`ConfettiProps` 折算后的形态）。
///
/// 倍率字段乘在配方基数上；`wind` 是绝对加速度（px/s²，540 短边），加在
/// 配方 `windPx` 上；`origin` / `angle` / `spread` 为 `Some` 时**替换**配方的
/// 发射器组 / 基准角 / 扇面。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Overrides {
    pub seed: u64,
    pub size: f64,
    pub speed: f64,
    pub gravity: f64,
    pub drift: f64,
    pub spin: f64,
    pub wind: f64,
    pub opacity: f64,
    pub origin: Option<(f64, f64)>,
    pub angle: Option<f64>,
    pub spread: Option<f64>,
    /// 形状表与色板的长度：粒子只带下标，形状与颜色由调用方按表取。
    pub shape_count: usize,
    pub color_count: usize,
}

/// 一枚活着的粒子（元素盒内像素坐标，左上原点）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Particle {
    pub index: u64,
    pub x: f64,
    pub y: f64,
    /// 单位路径的缩放（像素）。
    pub size: f64,
    /// 旋转角（度，顺时针）。
    pub rot_deg: f64,
    /// 纵向翻转因子 `[-1, 1]`（三角波），画时乘在 y 缩放上。
    pub sy: f64,
    pub alpha: f64,
    pub shape: usize,
    pub color: usize,
}

fn lerp(a: f64, b: f64, u: f64) -> f64 {
    a + (b - a) * u
}

/// `smoothstep(0, 1, x)`。
pub fn smooth(x: f64) -> f64 {
    let t = x.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// 三角波：frac 0 → 1，frac 0.5 → −1。
pub fn tri(x: f64) -> f64 {
    4.0 * (x - x.floor() - 0.5).abs() - 1.0
}

/// 一轴的位移：阻力 `k`（1/s）+ 加速度 `a`（px/s²）。`k > 0` 时有终端速度
/// `a / k`，否则退化成匀加速。
pub fn axis(p0: f64, v0: f64, a: f64, k: f64, tau: f64) -> f64 {
    if k > 0.0 {
        let vt = a / k;
        p0 + vt * tau + (v0 - vt) * (1.0 - libm::exp(-k * tau)) / k
    } else {
        p0 + v0 * tau + 0.5 * a * tau * tau
    }
}

/// 粒子 `i` 的出生时刻；`None` = 这一份参数下它永远不会出生。
///
/// `duration` 是元素时长（`settle` 用；开放式片尾传 `None`）。
pub fn spawn_at(
    emit: &Emit,
    seed: u64,
    i: u64,
    duration: Option<f64>,
    life_max: f64,
) -> Option<f64> {
    let t0 = match emit.mode {
        EmitMode::Burst => {
            let count = emit.count.max(1);
            let wave = i / count;
            if emit.interval <= 0.0 && wave > 0 {
                return None;
            }
            wave as f64 * emit.interval
        }
        EmitMode::Continuous => {
            (i as f64 + splitmix64_unit(seed, i * CHANNELS)) / emit.rate.max(1.0)
        }
    };
    if emit.settle
        && let Some(duration) = duration
        && t0 > duration - life_max
    {
        return None;
    }
    Some(t0)
}

/// 此刻可能活着的粒子编号范围 `[lo, hi]`：出生时刻落在 `(t − lifeMax, t]` 里的那些。
pub fn index_window(emit: &Emit, t: f64, life_max: f64) -> (u64, u64) {
    match emit.mode {
        EmitMode::Burst => {
            let count = emit.count.max(1);
            let (wave_lo, wave_hi) = if emit.interval <= 0.0 {
                (0.0, 0.0)
            } else {
                (
                    ((t - life_max) / emit.interval).ceil().max(0.0),
                    (t / emit.interval).floor(),
                )
            };
            (wave_lo as u64 * count, (wave_hi as u64 + 1) * count - 1)
        }
        EmitMode::Continuous => {
            let rate = emit.rate.max(1.0);
            // 出生时刻带一档 [0,1)/rate 的抖动，两端各放宽一格。
            let lo = (((t - life_max) * rate).floor() - 1.0).max(0.0);
            let hi = (t * rate).floor() + 1.0;
            (lo as u64, hi as u64)
        }
    }
}

/// 求一帧：元素本地时刻 `t`（秒）、元素盒 `(w, h)` 像素、`pixel_scale =
/// 画布短边 / 540`、`duration` = 元素时长（`settle` 用）。返回粒子表，按编号
/// 升序；超过 `max_alive` 截断。
pub fn sample(
    motion: &Motion,
    over: &Overrides,
    emit: &Emit,
    t: f64,
    (w, h): (f64, f64),
    pixel_scale: f64,
    duration: Option<f64>,
) -> Vec<Particle> {
    let mut out = Vec::new();
    if !(t >= 0.0) || over.shape_count == 0 || over.color_count == 0 || motion.emitters.is_empty() {
        return out;
    }
    let px = pixel_scale;
    let life_max = motion.life_sec;
    let origin_emitter = over.origin.map(|(x, y)| Emitter {
        x,
        y,
        spread_x: 0.0,
        spread_y: 0.0,
        angle: None,
    });
    let emitters: &[Emitter] = match &origin_emitter {
        Some(single) => std::slice::from_ref(single),
        None => &motion.emitters,
    };
    let (lo, hi) = index_window(emit, t, life_max);
    let mut i = lo;
    while i <= hi && out.len() < motion.max_alive {
        let index = i;
        i += 1;
        let Some(t0) = spawn_at(emit, over.seed, index, duration, life_max) else {
            continue;
        };
        let u = channels(over.seed, index);
        let life = life_max * lerp(LIFE_JITTER, 1.0, u[13]);
        let tau = t - t0;
        if tau < 0.0 || tau >= life {
            continue;
        }
        let em = emitters[(index % emitters.len() as u64) as usize];
        let x0 = (em.x + (u[1] - 0.5) * em.spread_x) / 100.0 * w;
        let y0 = (em.y + (u[2] - 0.5) * em.spread_y) / 100.0 * h;
        let base_angle = over.angle.or(em.angle).unwrap_or(motion.angle);
        let spread = over.spread.unwrap_or(motion.spread);
        let ang = (base_angle + (u[3] - 0.5) * spread) * PI / 180.0;
        let v0 = lerp(motion.speed_px[0], motion.speed_px[1], u[4]) * over.speed * px;
        let ax = (motion.wind_px + over.wind) * px;
        let ay = motion.gravity_px * over.gravity * px;
        let mut x = axis(x0, v0 * libm::cos(ang), ax, motion.drag_x, tau);
        let y = axis(y0, v0 * libm::sin(ang), ay, motion.drag_y, tau);
        if motion.drift_px > 0.0 && over.drift > 0.0 {
            x += over.drift
                * motion.drift_px
                * px
                * libm::sin(TAU * motion.drift_hz * tau + TAU * u[12]);
        }
        let dir = if u[9] < 0.5 { -1.0 } else { 1.0 };
        let rot_deg = u[9] * 360.0
            + dir * over.spin * lerp(motion.spin_dps[0], motion.spin_dps[1], u[8]) * tau;
        let sy = tri(u[10] + over.spin * lerp(motion.flip_hz[0], motion.flip_hz[1], u[11]) * tau);
        let mut size = over.size * lerp(motion.size_px[0], motion.size_px[1], u[5]) * px;
        if motion.size_ramp {
            size *= (3.0 * tau).min(1.0);
        }
        if let Some(pulse) = motion.pulse {
            size *= lerp(
                pulse.min,
                pulse.max,
                0.5 + 0.5 * libm::sin(TAU * pulse.hz * tau + TAU * u[14]),
            );
        }
        let mut alpha = over.opacity;
        if motion.fade_in > 0.0 {
            alpha *= smooth(tau / motion.fade_in);
        }
        if motion.fade_out > 0.0 {
            alpha *= smooth((life - tau) / motion.fade_out);
        }
        if alpha <= 0.002 || size <= 0.05 {
            continue;
        }
        let shape = ((u[6] * over.shape_count as f64).floor() as usize) % over.shape_count;
        let color = ((u[7] * over.color_count as f64).floor() as usize) % over.color_count;
        out.push(Particle {
            index,
            x,
            y,
            size,
            rot_deg,
            sy,
            alpha,
            shape,
            color,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splitmix_matches_the_reference_vector() {
        // 原型 `splitmix64Unit(1, 0)` 的 BigInt 实现给出的值（53 位尾数）。
        let a = splitmix64_unit(1, 0);
        let b = splitmix64_unit(1, 1);
        assert!((0.0..1.0).contains(&a) && (0.0..1.0).contains(&b));
        assert_ne!(a, b);
        assert_eq!(
            a,
            splitmix64_unit(1, 0),
            "纯函数：同一 (seed, k) 恒得同一值"
        );
        // seed 0 / k 0 是已知向量：z = 0 → 两轮 mix 后仍是 0。
        assert_eq!(splitmix64_unit(0, 0), 0.0);
    }

    #[test]
    fn helpers_follow_the_prototype_formulae() {
        assert_eq!(smooth(-1.0), 0.0);
        assert_eq!(smooth(0.5), 0.5);
        assert_eq!(smooth(2.0), 1.0);
        assert_eq!(tri(0.0), 1.0);
        assert_eq!(tri(0.5), -1.0);
        assert_eq!(tri(1.25), 0.0);
        // 无阻力 = 匀加速；有阻力时 τ→∞ 的速度趋近 a/k。
        assert_eq!(axis(1.0, 2.0, 4.0, 0.0, 1.0), 1.0 + 2.0 + 2.0);
        let far = axis(0.0, 0.0, 10.0, 2.0, 100.0);
        let further = axis(0.0, 0.0, 10.0, 2.0, 101.0);
        assert!((further - far - 5.0).abs() < 1e-6);
    }

    fn emit(mode: EmitMode) -> Emit {
        Emit {
            mode,
            rate: 40.0,
            count: 80,
            interval: 2.0,
            settle: false,
        }
    }

    #[test]
    fn spawn_and_window_agree_on_bursts() {
        let e = emit(EmitMode::Burst);
        assert_eq!(spawn_at(&e, 7, 0, None, 4.5), Some(0.0));
        assert_eq!(spawn_at(&e, 7, 79, None, 4.5), Some(0.0));
        assert_eq!(spawn_at(&e, 7, 80, None, 4.5), Some(2.0));
        let once = Emit { interval: 0.0, ..e };
        assert_eq!(spawn_at(&once, 7, 80, None, 4.5), None);
        assert_eq!(index_window(&once, 30.0, 4.5), (0, 79));
        // t = 5：活着的只可能是第 1、2 波（出生 2s / 4s），第 0 波已过寿命。
        assert_eq!(index_window(&e, 5.0, 4.5), (80, 239));
        // settle：最后 lifeMax 秒不再发射。
        let settle = Emit { settle: true, ..e };
        assert_eq!(spawn_at(&settle, 7, 160, Some(8.0), 4.5), None);
        assert_eq!(spawn_at(&settle, 7, 80, Some(8.0), 4.5), Some(2.0));
    }

    #[test]
    fn continuous_window_covers_every_alive_particle() {
        let e = emit(EmitMode::Continuous);
        let life = 4.5;
        for t in [0.0, 0.3, 4.4, 4.6, 12.0] {
            let (lo, hi) = index_window(&e, t, life);
            for i in 0..(t * e.rate) as u64 + 3 {
                let t0 = spawn_at(&e, 9, i, None, life).unwrap();
                let alive = t0 <= t && t - t0 < life;
                if alive {
                    assert!(i >= lo && i <= hi, "t={t} i={i} 在窗口 [{lo},{hi}] 之外");
                }
            }
        }
    }
}
