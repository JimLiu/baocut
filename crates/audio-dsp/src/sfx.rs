//! 程序化音效：一组固定配方（[`RECIPES`]）。两类：
//!
//! - **拟真**（`click`、`keypress`、`pop`、`impact`）：物理建模（[`crate::physical`]），接触脉冲激励一组有阻尼的
//!   模态，再过小房间与话筒（有底噪），听起来像录下来的真东西，UI 动作、按键、弹出与揭晓用它们；
//! - **风格化**（其余）：振荡、噪声与滤波按包络拼出来的电子声，故障风、科技感、上扬与低频轰鸣用它们。
//!
//! 与全 crate 同一约定：纯函数、播种随机、`libm` 超越函数，同一份 [`SfxSpec`] 逐位相同。输出是立体声
//! （干声双单声道，加空间时两声道的混响尾不同），峰值归一到 [`PEAK`]。
//!
//! - `pitch` 是半音（−12..12），乘到配方里的所有频率上（含滤波器截止），音色一起变高变低；
//! - `seconds` 改总长：衰减类配方按比例拉长包络，`riser` 拉长爬升；不给用配方自己的长度；
//! - `space` 是 [`crate::reverb::IrSpec::preset`] 的名字（`room` / `hall`），湿声按 [`SPACE_WET`] 叠上。

use crate::biquad::{self, Biquad};
use crate::math::samples;
use crate::noise;
use crate::osc;
use crate::physical::{self, Mode, contact, modal, modal_cloud, unit_peak};
use crate::reverb::{IrSpec, convolve_stereo, synth_ir};
use crate::rng::{Rng, derive};
use crate::stereo::{Stereo, add_into, fade, peak_normalize, remove_dc};
use crate::tvlp::tv_lowpass;

/// 配方名与缺省长度（秒）。
pub const RECIPES: &[(&str, f64)] = &[
    ("kick", 0.5),
    ("boom", 2.0),
    ("crash", 2.5),
    ("riser", 3.0),
    ("tick", 0.08),
    ("blip", 0.15),
    ("ping", 0.8),
    ("whoosh", 0.9),
    ("stamp", 0.35),
    ("glitch", 0.4),
    ("static", 1.0),
    ("click", 0.15),
    ("keypress", 0.32),
    ("pop", 0.25),
    ("impact", 2.2),
];

/// 输出峰值（线性，约 −1 dBFS）。
pub const PEAK: f64 = 0.891;
/// 空间的湿声比例。
pub const SPACE_WET: f64 = 0.35;
/// 长度上限（秒）。
pub const MAX_SECONDS: f64 = 10.0;

#[derive(Debug, Clone, PartialEq)]
pub struct SfxSpec {
    pub recipe: String,
    pub seconds: Option<f64>,
    pub pitch: f64,
    pub seed: u64,
    pub space: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SfxError {
    UnknownRecipe(String),
    UnknownSpace(String),
    InvalidParameter(String),
}

impl std::fmt::Display for SfxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownRecipe(name) => write!(f, "unknown recipe {name:?}"),
            Self::UnknownSpace(name) => write!(f, "unknown space {name:?}; use room or hall"),
            Self::InvalidParameter(message) => f.write_str(message),
        }
    }
}

/// 配方的缺省长度；没有这个配方时 `None`。
pub fn default_seconds(recipe: &str) -> Option<f64> {
    RECIPES
        .iter()
        .find(|(name, _)| *name == recipe)
        .map(|(_, seconds)| *seconds)
}

/// 合成一段音效。空间只认 `room` / `hall`（更长的厅堂对短音效没有意义）。
pub fn render(spec: &SfxSpec, sr: f64) -> Result<Stereo, SfxError> {
    let base = default_seconds(&spec.recipe)
        .ok_or_else(|| SfxError::UnknownRecipe(spec.recipe.clone()))?;
    let seconds = spec.seconds.unwrap_or(base);
    if !(seconds.is_finite() && seconds > 0.0 && seconds <= MAX_SECONDS) {
        return Err(SfxError::InvalidParameter(format!(
            "seconds must be in (0, {MAX_SECONDS}], got {seconds}"
        )));
    }
    if !(spec.pitch.is_finite() && (-12.0..=12.0).contains(&spec.pitch)) {
        return Err(SfxError::InvalidParameter(format!(
            "pitch must be between -12 and 12 semitones, got {}",
            spec.pitch
        )));
    }
    let space = match spec.space.as_deref() {
        None => None,
        Some(name @ ("room" | "hall")) => Some(IrSpec::preset(name).expect("built-in space")),
        Some(other) => return Err(SfxError::UnknownSpace(other.to_string())),
    };
    let ctx = Ctx {
        sr,
        n: samples(seconds, sr).max(1),
        stretch: seconds / base,
        ratio: libm::pow(2.0, spec.pitch / 12.0),
        rng: Rng::new(derive(spec.seed, 0x5f_78)),
    };
    let mut dry = match spec.recipe.as_str() {
        "kick" => kick(ctx),
        "boom" => boom(ctx),
        "crash" => crash(ctx),
        "riser" => riser(ctx),
        "tick" => tick(ctx),
        "blip" => blip(ctx),
        "ping" => ping(ctx),
        "whoosh" => whoosh(ctx),
        "stamp" => stamp(ctx),
        "glitch" => glitch(ctx),
        "static" => crackle(ctx),
        "click" => click(ctx),
        "keypress" => keypress(ctx),
        "pop" => pop(ctx),
        "impact" => impact(ctx),
        _ => unreachable!("checked against RECIPES"),
    };
    remove_dc(&mut dry);
    // 尾巴收干净：末 5 ms 淡出，开头不淡（起音要脆）。
    fade(&mut dry, sr, 0.0, 0.005);
    peak_normalize(&mut dry, PEAK);
    let mut out = Stereo::dual_mono(&dry);
    if let Some(ir) = space {
        let ir = synth_ir(
            &IrSpec {
                seed: derive(spec.seed, 0x52_56),
                ..ir
            },
            sr,
        );
        let tail = convolve_stereo(&out, &ir, dry.len() + ir.len());
        out.resize(tail.len());
        out.add_at(&tail, 0, SPACE_WET);
        fade(&mut out.l, sr, 0.0, 0.05);
        fade(&mut out.r, sr, 0.0, 0.05);
        let peak = out.peak();
        out.scale(PEAK / (peak + 1e-12));
    }
    Ok(out)
}

struct Ctx {
    sr: f64,
    n: usize,
    /// 实际长度与缺省长度之比：包络时间常数乘它。
    stretch: f64,
    /// 音高倍数。
    ratio: f64,
    rng: Rng,
}

impl Ctx {
    fn t(&self, i: usize) -> f64 {
        i as f64 / self.sr
    }

    /// 指数衰减包络，时间常数 `tau` 秒（随 `stretch` 拉长）。
    fn decay(&self, tau: f64) -> Vec<f64> {
        let tau = tau * self.stretch;
        (0..self.n).map(|i| libm::exp(-self.t(i) / tau)).collect()
    }

    /// 频率曲线：从 `from` 指数滑到 `to`，时间常数 `tau` 秒；已乘音高。
    fn glide(&self, from: f64, to: f64, tau: f64) -> Vec<f64> {
        let tau = tau * self.stretch;
        (0..self.n)
            .map(|i| (to + (from - to) * libm::exp(-self.t(i) / tau)) * self.ratio)
            .collect()
    }

    fn hz(&self, f: f64) -> f64 {
        (f * self.ratio).min(self.sr * 0.45)
    }
}

fn mul(x: &mut [f32], env: &[f64]) {
    for (sample, gain) in x.iter_mut().zip(env) {
        *sample = (f64::from(*sample) * gain) as f32;
    }
}

fn mix(dst: &mut [f32], src: &[f32], gain: f64) {
    for (a, b) in dst.iter_mut().zip(src) {
        *a = (f64::from(*a) + f64::from(*b) * gain) as f32;
    }
}

/// 底鼓：150 → 45 Hz 的正弦扫频加 2 ms 的高频起音。
fn kick(mut c: Ctx) -> Vec<f32> {
    let mut body = osc::sine(&c.glide(150.0, 45.0, 0.04), c.sr, 0.0);
    mul(&mut body, &c.decay(0.16));
    let mut attack = biquad::highpass(&noise::white(c.n, &mut c.rng), c.sr, c.hz(2500.0), 2);
    let short: Vec<f64> = (0..c.n).map(|i| libm::exp(-c.t(i) / 0.002)).collect();
    mul(&mut attack, &short);
    mix(&mut body, &attack, 0.35);
    body
}

/// 低频轰鸣：55 → 30 Hz 的次低音加低通褐噪声，长衰减。
fn boom(mut c: Ctx) -> Vec<f32> {
    let mut sub = osc::sine(&c.glide(55.0, 30.0, 0.3), c.sr, 0.0);
    mul(&mut sub, &c.decay(0.6));
    let mut rumble = biquad::lowpass(
        &noise::colored(c.n, c.sr, 2.0, &mut c.rng),
        c.sr,
        c.hz(220.0),
        2,
    );
    mul(&mut rumble, &c.decay(0.45));
    mix(&mut sub, &rumble, 0.6);
    sub
}

/// 镲：高通白噪声加一层带通「金属声」，长衰减。
fn crash(mut c: Ctx) -> Vec<f32> {
    let white = noise::white(c.n, &mut c.rng);
    let mut wash = biquad::highpass(&white, c.sr, c.hz(3000.0), 2);
    let shimmer = Biquad::bandpass(c.sr, c.hz(6500.0), 2.0);
    let mut ring = white.clone();
    shimmer.process(&mut ring);
    mix(&mut wash, &ring, 0.8);
    mul(&mut wash, &c.decay(0.55));
    wash
}

/// 上扬：噪声的低通截止 200 → 9000 Hz、锯齿波一个八度半往上滑，音量平方爬升，在末尾到顶。
fn riser(mut c: Ctx) -> Vec<f32> {
    let n = c.n;
    let progress: Vec<f64> = (0..n).map(|i| i as f64 / (n.max(2) - 1) as f64).collect();
    let cutoff: Vec<f32> = progress
        .iter()
        .map(|u| c.hz(200.0 * libm::pow(45.0, *u)) as f32)
        .collect();
    let mut air = tv_lowpass(&noise::colored(n, c.sr, 1.0, &mut c.rng), c.sr, &cutoff);
    let freq: Vec<f64> = progress
        .iter()
        .map(|u| 110.0 * libm::pow(2.0, 2.5 * u) * c.ratio)
        .collect();
    let tone = osc::saw(&freq, c.sr, 0.0);
    mix(&mut air, &tone, 0.25);
    let env: Vec<f64> = progress.iter().map(|u| u * u).collect();
    mul(&mut air, &env);
    air
}

/// 滴答：4 kHz 带通的噪声短促一下。
fn tick(mut c: Ctx) -> Vec<f32> {
    let mut x = biquad::resonator(&noise::white(c.n, &mut c.rng), c.sr, c.hz(4000.0), 6.0);
    mul(&mut x, &c.decay(0.006));
    x
}

/// 提示音：方波 880 → 1320 Hz 上挑，短衰减。
fn blip(c: Ctx) -> Vec<f32> {
    // 前 20 ms 从 880 滑到 1320。
    let freq: Vec<f64> = (0..c.n)
        .map(|i| (880.0 + 440.0 * (1.0 - libm::exp(-c.t(i) / 0.02))) * c.ratio)
        .collect();
    let mut x = biquad::lowpass(&osc::square(&freq, c.sr, 0.0, 0.5), c.sr, c.hz(6000.0), 2);
    mul(&mut x, &c.decay(0.04));
    x
}

/// 叮：1760 Hz 正弦加 2.76 倍的泛音（钟的第二个分音），泛音衰减更快。
fn ping(c: Ctx) -> Vec<f32> {
    let flat = |f: f64| vec![c.hz(f); c.n];
    let mut x = osc::sine(&flat(1760.0), c.sr, 0.0);
    mul(&mut x, &c.decay(0.22));
    let mut partial = osc::sine(&flat(1760.0 * 2.76), c.sr, 0.0);
    mul(&mut partial, &c.decay(0.06));
    mix(&mut x, &partial, 0.4);
    x
}

/// 呼：粉噪声的低通截止先升后降、音量钟形，再高通去闷。
fn whoosh(mut c: Ctx) -> Vec<f32> {
    let n = c.n;
    let bell: Vec<f64> = (0..n)
        .map(|i| {
            let u = i as f64 / (n.max(2) - 1) as f64;
            libm::sin(std::f64::consts::PI * u).powi(2)
        })
        .collect();
    let cutoff: Vec<f32> = bell
        .iter()
        .map(|b| c.hz(300.0 + 5200.0 * b) as f32)
        .collect();
    let air = tv_lowpass(&noise::colored(n, c.sr, 1.0, &mut c.rng), c.sr, &cutoff);
    let mut x = biquad::highpass(&air, c.sr, c.hz(150.0), 2);
    mul(&mut x, &bell);
    x
}

/// 盖章：90 → 50 Hz 的闷击加 2 kHz 以下的噪声拍击。
fn stamp(mut c: Ctx) -> Vec<f32> {
    let mut thump = osc::sine(&c.glide(90.0, 50.0, 0.03), c.sr, 0.0);
    mul(&mut thump, &c.decay(0.07));
    let mut slap = biquad::lowpass(&noise::white(c.n, &mut c.rng), c.sr, c.hz(2000.0), 2);
    mul(&mut slap, &c.decay(0.018));
    mix(&mut thump, &slap, 0.7);
    thump
}

/// 故障：每 20–50 ms 换一段，随机是方波（随机音高）、噪声或静音，段与段之间硬切。
fn glitch(mut c: Ctx) -> Vec<f32> {
    let mut out = vec![0.0_f32; c.n];
    let mut start = 0;
    while start < c.n {
        let len = samples(c.rng.uniform(0.02, 0.05) * c.stretch, c.sr)
            .max(1)
            .min(c.n - start);
        let kind = c.rng.int_range(0, 3);
        let gain = c.rng.uniform(0.4, 1.0);
        let pick = c.rng.uniform(200.0, 2400.0);
        let tone = c.hz(pick);
        let segment: Vec<f32> = match kind {
            0 => osc::square(&vec![tone; len], c.sr, 0.0, 0.5),
            1 => biquad::bandpass(
                &noise::white(len, &mut c.rng),
                c.sr,
                c.hz(800.0),
                c.hz(8000.0),
                1,
            ),
            _ => vec![0.0; len],
        };
        mix(&mut out[start..start + len], &segment, gain);
        start += len;
    }
    out
}

/// 电流噪声：1–6 kHz 的带通噪声，叠上随机的噼啪（短促的冲击）。
fn crackle(mut c: Ctx) -> Vec<f32> {
    let mut x = biquad::bandpass(
        &noise::white(c.n, &mut c.rng),
        c.sr,
        c.hz(1000.0),
        c.hz(6000.0),
        2,
    );
    for sample in x.iter_mut() {
        *sample *= 0.35;
    }
    let pops = (c.n as f64 / c.sr * 40.0) as usize;
    for _ in 0..pops {
        let at = c.rng.int_range(0, c.n as i64 - 1) as usize;
        let gain = c.rng.uniform(0.3, 1.0) as f32;
        for k in 0..samples(0.002, c.sr).min(c.n - at) {
            let sign = if k % 2 == 0 { 1.0 } else { -1.0 };
            x[at + k] += sign * gain * (1.0 - k as f32 / 96.0).max(0.0);
        }
    }
    x
}

/// 配方里的模态按音高与长度换算：频率乘音高倍数，衰减时间乘 `stretch`。
fn tuned(c: &Ctx, modes: &[Mode]) -> Vec<Mode> {
    modes
        .iter()
        .map(|m| Mode {
            freq: m.freq * c.ratio,
            tau: m.tau * c.stretch,
            amp: m.amp,
        })
        .collect()
}

/// `(频率倍数, 衰减秒, 振幅)` 的表 → 以 `base` Hz 为基的模态。
fn modes_from(base: f64, table: &[(f64, f64, f64)]) -> Vec<Mode> {
    table
        .iter()
        .map(|(ratio, tau, amp)| Mode {
            freq: base * ratio,
            tau: *tau,
            amp: *amp,
        })
        .collect()
}

/// 一次接触（`tc` 秒，音高越高越短）激励的一层模态，峰值归一到 1，长 `n`。
fn struck(c: &Ctx, tc: f64, modes: &[Mode], n: usize) -> Vec<f32> {
    unit_peak(modal(
        &contact(tc / c.ratio, c.sr),
        &tuned(c, modes),
        c.sr,
        n,
    ))
}

/// 一层按峰值配比好的声音叠到 `out` 的 `at` 秒处（超出的截掉）。
fn layer(out: &mut [f32], x: &[f32], at: usize, gain: f64) {
    add_into(out, x, at as isize, gain);
}

/// 收尾：近距离话筒在小房间里录下来（`t60` 秒，随 `stretch` 拉长；湿声 `wet`），低切 `low_cut` Hz，底噪比峰值低
/// `floor_db`。
fn recorded(c: &mut Ctx, x: &[f32], t60: f64, wet: f64, low_cut: f64, floor_db: f64) -> Vec<f32> {
    let seed = c.rng.next_u64();
    let room = physical::small_room(x, c.sr, t60 * c.stretch, wet, seed);
    physical::mic(&room, c.sr, low_cut, -1.0, floor_db, &mut c.rng)
}

/// 咔（拟真）：鼠标或触控板按一下。微动开关按下时极短的接触同时激励塑料壳的一团高频（2.5–10 kHz）与按键件
/// 自己的几个模态（1.3–1.7 kHz 起），约 75 ms 后是更轻、更亮的回弹；小房间、底噪。
fn click(mut c: Ctx) -> Vec<f32> {
    let n = c.n;
    let shell = modal_cloud(2500.0, 10_000.0, 16, 0.0004, 0.0015, -2.0, &mut c.rng);
    let base = c.rng.uniform(1300.0, 1700.0);
    let part = modes_from(
        base,
        &[
            (1.0, 0.0035, 1.0),
            (1.47, 0.0025, 0.6),
            (2.09, 0.0018, 0.45),
            (0.38, 0.006, 0.3),
        ],
    );
    let mut out = vec![0.0_f32; n];
    layer(&mut out, &struck(&c, 0.00006, &part, n), 0, 1.0);
    layer(&mut out, &struck(&c, 0.00006, &shell, n), 0, 0.6);
    // 回弹：开关弹回、按键件撞上限位，接触更短、模态略高，轻一半多。
    let at = samples(0.075 * c.stretch * c.rng.uniform(0.92, 1.08), c.sr).min(n);
    let up: Vec<Mode> = part
        .iter()
        .map(|m| Mode {
            freq: m.freq * 1.09,
            ..*m
        })
        .collect();
    layer(&mut out, &struck(&c, 0.00004, &up, n - at), at, 0.42);
    layer(&mut out, &struck(&c, 0.00004, &shell, n - at), at, 0.3);
    recorded(&mut c, &out, 0.12, 0.08, 120.0, -62.0)
}

/// 按键（拟真）：机械键盘按一下，偏「thock」的低沉手感。按到底的一瞬间极短的接触激励键帽与定位板的模态
/// （1.25–1.55 kHz 起的一组）、外壳的一团高频（6.5–12 kHz）与机壳的低频；手指的推力让整块键盘在 60–80 Hz
/// 晃一下（两个模态相拍，按下后十几毫秒最响，几十毫秒内散掉）；约 100 ms 后松开，轴弹回撞上顶部，更轻更亮。
fn keypress(mut c: Ctx) -> Vec<f32> {
    let n = c.n;
    let cap = modes_from(
        c.rng.uniform(1250.0, 1550.0),
        &[
            (1.0, 0.0028, 1.0),
            (1.36, 0.0022, 0.55),
            (1.74, 0.0018, 0.4),
            (2.21, 0.0014, 0.3),
        ],
    );
    let shell = modal_cloud(6500.0, 12_000.0, 18, 0.0003, 0.0009, -3.0, &mut c.rng);
    let case = modes_from(
        c.rng.uniform(120.0, 135.0),
        &[(1.0, 0.022, 1.0), (1.44, 0.018, 0.6), (1.88, 0.014, 0.4)],
    );
    let board = modes_from(
        c.rng.uniform(62.0, 70.0),
        &[(1.0, 0.032, 1.0), (1.22, 0.028, 0.75)],
    );
    let force = c.rng.uniform(0.85, 1.15);
    let mut out = vec![0.0_f32; n];
    let hit = 0.00012 * c.rng.uniform(0.85, 1.15);
    layer(&mut out, &struck(&c, hit, &cap, n), 0, force);
    layer(&mut out, &struck(&c, hit, &shell, n), 0, 0.5 * force);
    layer(&mut out, &struck(&c, hit, &case, n), 0, 0.3 * force);
    let shove = physical::push(0.02 * c.stretch, c.sr);
    let thock = unit_peak(modal(&shove, &tuned(&c, &board), c.sr, n));
    layer(&mut out, &thock, 0, 0.4 * force);
    // 松开：先是轴离开底座的一下轻响，几毫秒后撞上顶部。
    let top = samples(0.1 * c.stretch * c.rng.uniform(0.9, 1.1), c.sr).min(n);
    let tick = top.saturating_sub(samples(0.006 * c.stretch, c.sr));
    let spring = modal_cloud(5000.0, 11_000.0, 8, 0.0002, 0.0006, -2.0, &mut c.rng);
    layer(
        &mut out,
        &struck(&c, 0.00005, &spring, n - tick),
        tick,
        0.12,
    );
    let bright: Vec<Mode> = cap
        .iter()
        .map(|m| Mode {
            freq: m.freq * 1.08,
            ..*m
        })
        .collect();
    layer(&mut out, &struck(&c, 0.00009, &bright, n - top), top, 0.3);
    layer(&mut out, &struck(&c, 0.00009, &shell, n - top), top, 0.18);
    recorded(&mut c, &out, 0.15, 0.12, 30.0, -62.0)
}

/// 啵（拟真）：气泡或软木塞弹出。膜破的一下极短接触激励一团高频，腔体的共鸣（500–600 Hz 起）在头 25 ms 里
/// 往上滑小半个八度（气泡收缩时音高上升），再加一小股气流；小房间、底噪。
fn pop(mut c: Ctx) -> Vec<f32> {
    let n = c.n;
    let f0 = c.rng.uniform(500.0, 600.0);
    let glide_tau = 0.012 * c.stretch;
    let freq: Vec<f64> = (0..n)
        .map(|i| c.hz(f0 * (1.0 + 0.45 * (1.0 - libm::exp(-c.t(i) / glide_tau)))))
        .collect();
    let mut cavity = osc::sine(&freq, c.sr, 0.0);
    let ring: Vec<f64> = (0..n)
        .map(|i| {
            let t = c.t(i);
            (1.0 - libm::exp(-t / 0.0005)) * libm::exp(-t / (0.011 * c.stretch))
        })
        .collect();
    mul(&mut cavity, &ring);
    let mut out = unit_peak(cavity);
    let film = modal_cloud(3000.0, 12_000.0, 10, 0.0002, 0.0007, -2.0, &mut c.rng);
    layer(&mut out, &struck(&c, 0.00004, &film, n), 0, 0.45);
    let mut puff = biquad::lowpass(&noise::white(n, &mut c.rng), c.sr, c.hz(1800.0), 2);
    let burst: Vec<f64> = (0..n)
        .map(|i| libm::exp(-c.t(i) / (0.005 * c.stretch)))
        .collect();
    mul(&mut puff, &burst);
    layer(&mut out, &unit_peak(puff), 0, 0.2);
    recorded(&mut c, &out, 0.18, 0.1, 60.0, -64.0)
}

/// 重击（拟真）：揭晓、落版的一下。软槌（4 ms 的长接触）打在一面大鼓的膜上（50–60 Hz 起，圆膜的非谐泛音比），
/// 同时硬接触激励木质鼓框的一团中频模态，再加一点气流；中等房间，尾巴长（尾巴太短是合成重击的破绽）。
fn impact(mut c: Ctx) -> Vec<f32> {
    let n = c.n;
    let membrane = modes_from(
        c.rng.uniform(50.0, 60.0),
        &[
            (1.0, 0.6, 1.0),
            (1.593, 0.38, 0.55),
            (2.136, 0.28, 0.4),
            (2.295, 0.24, 0.35),
            (2.653, 0.2, 0.28),
            (2.917, 0.17, 0.22),
            (3.155, 0.14, 0.18),
        ],
    );
    let frame = modal_cloud(220.0, 3200.0, 28, 0.01, 0.06, -4.0, &mut c.rng);
    let mut out = struck(&c, 0.004, &membrane, n);
    layer(&mut out, &struck(&c, 0.0003, &frame, n), 0, 0.6);
    let mut air = biquad::lowpass(
        &noise::colored(n, c.sr, 1.0, &mut c.rng),
        c.sr,
        c.hz(2500.0),
        2,
    );
    mul(&mut air, &c.decay(0.06));
    layer(&mut out, &unit_peak(air), 0, 0.12);
    recorded(&mut c, &out, 0.9, 0.28, 25.0, -66.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stereo::rms;
    use crate::tone;

    const SR: f64 = 48_000.0;

    fn spec(recipe: &str) -> SfxSpec {
        SfxSpec {
            recipe: recipe.into(),
            seconds: None,
            pitch: 0.0,
            seed: 7,
            space: None,
        }
    }

    #[test]
    fn every_recipe_renders_at_its_length_and_peak() {
        for (name, seconds) in RECIPES {
            let out = render(&spec(name), SR).unwrap();
            assert_eq!(out.len(), samples(*seconds, SR), "{name}");
            let peak = out.peak();
            assert!((peak - PEAK).abs() < 1e-3, "{name} peak {peak}");
            assert!(out.l.iter().all(|s| s.is_finite()), "{name}");
            assert!(rms(&out.l) > 0.01, "{name} is silent");
        }
    }

    #[test]
    fn same_seed_same_samples_and_seed_changes_noise() {
        let a = render(&spec("whoosh"), SR).unwrap();
        let b = render(&spec("whoosh"), SR).unwrap();
        assert_eq!(a, b);
        let c = render(
            &SfxSpec {
                seed: 8,
                ..spec("whoosh")
            },
            SR,
        )
        .unwrap();
        assert_ne!(a, c);
    }

    #[test]
    fn kick_energy_sits_low_and_decays() {
        let out = render(&spec("kick"), SR).unwrap();
        let low = biquad::lowpass(&out.l, SR, 200.0, 4);
        assert!(rms(&low) > 0.5 * rms(&out.l));
        let quarter = out.len() / 4;
        assert!(rms(&out.l[..quarter]) > 4.0 * rms(&out.l[3 * quarter..]));
    }

    #[test]
    fn riser_grows_toward_the_end() {
        let out = render(
            &SfxSpec {
                seconds: Some(2.0),
                ..spec("riser")
            },
            SR,
        )
        .unwrap();
        assert_eq!(out.len(), 96_000);
        let tenth = out.len() / 10;
        assert!(rms(&out.l[8 * tenth..9 * tenth]) > 5.0 * rms(&out.l[tenth..2 * tenth]));
    }

    /// 2 ms 均方根在 `[a, b)` 秒里的最大值（先高通 1 kHz，只看起音的那一下）。
    fn hit_level(x: &[f32], a: f64, b: f64) -> f64 {
        let high = biquad::highpass(x, SR, 1000.0, 2);
        let win = samples(0.002, SR);
        let (a, b) = (samples(a, SR), samples(b, SR).min(high.len()));
        (a..b.saturating_sub(win))
            .step_by(24)
            .map(|i| rms(&high[i..i + win]))
            .fold(0.0, f64::max)
    }

    fn mono(recipe: &str, seed: u64) -> Vec<f32> {
        render(
            &SfxSpec {
                seed,
                ..spec(recipe)
            },
            SR,
        )
        .unwrap()
        .l
    }

    #[test]
    fn realistic_recipes_end_on_a_noise_floor_and_stay_alike_across_seeds() {
        for recipe in ["click", "keypress", "pop", "impact"] {
            let base = mono(recipe, 0);
            let tail = &base[base.len() - samples(0.01, SR)..];
            assert!(
                tail.iter().any(|s| *s != 0.0),
                "{recipe} ends in digital silence"
            );
            // 换种子是同一种声音的另一次录音（模态频率、力度、时机略变）：三分之一倍频程的音色差得不远。
            // 门限比各配方实测的种子间距离（2–8 dB）留了余量，挡住的是某个种子丢了一层或一层炸开。
            let reference = tone::profile(&base, SR);
            for seed in 1..6 {
                let distance =
                    tone::distance_db(&reference, &tone::profile(&mono(recipe, seed), SR));
                assert!(
                    distance < 10.0,
                    "{recipe} seed {seed} is {distance:.1} dB away"
                );
            }
        }
    }

    #[test]
    fn click_has_a_press_and_a_lighter_release() {
        for seed in 0..4 {
            let x = mono("click", seed);
            let press = hit_level(&x, 0.0, 0.01);
            let gap = hit_level(&x, 0.03, 0.06);
            let release = hit_level(&x, 0.06, 0.095);
            assert!(
                release > 4.0 * gap,
                "seed {seed}: release {release} vs gap {gap}"
            );
            assert!(
                release < press,
                "seed {seed}: the release is lighter than the press"
            );
        }
        // 能量在 1–4 kHz（塑料件），不是低频的「咚」。
        let x = mono("click", 0);
        assert!(tone::band_db(&x, SR, 1000.0, 4000.0) > -3.0);
        assert!(tone::band_db(&x, SR, 20.0, 150.0) < -15.0);
    }

    #[test]
    fn keypress_thock_dies_before_the_release_tops_out() {
        for seed in 0..4 {
            let x = mono("keypress", seed);
            let gap = hit_level(&x, 0.05, 0.085);
            let release = hit_level(&x, 0.085, 0.125);
            assert!(
                release > 4.0 * gap,
                "seed {seed}: release {release} vs gap {gap}"
            );
            // 低频的晃动在按下后几十毫秒里散掉，不拖成一声「嗡」。
            let low = biquad::lowpass(&x, SR, 150.0, 4);
            let early = rms(&low[..samples(0.05, SR)]);
            let late = rms(&low[samples(0.15, SR)..]);
            assert!(
                late < 0.1 * early,
                "seed {seed}: low tail {late} vs {early}"
            );
        }
        // 键帽的「嗒」要听得见：1–4 kHz 离最强的频段不太远。
        let x = mono("keypress", 0);
        assert!(tone::band_db(&x, SR, 1000.0, 4000.0) > -10.0);
    }

    #[test]
    fn pop_is_a_short_mid_ring() {
        for seed in 0..4 {
            let x = mono("pop", seed);
            assert!(tone::band_db(&x, SR, 150.0, 1000.0) > -1.5, "seed {seed}");
            let t40 = tone::t40(&x, SR).expect("the pop dies out");
            assert!(t40 < 0.12, "seed {seed}: tail {t40} s");
        }
    }

    #[test]
    fn impact_is_low_with_a_long_tail_and_an_attack_on_top() {
        let x = mono("impact", 0);
        assert!(tone::band_db(&x, SR, 20.0, 150.0) > -1.0);
        let t40 = tone::t40(&x, SR).expect("the impact dies out");
        assert!(t40 > 1.0, "tail {t40} s is too short for a reveal hit");
        let attack = &x[..samples(0.05, SR)];
        assert!(tone::band_db(attack, SR, 1000.0, 4000.0) > -30.0);
        // seconds 缩短尾巴。
        let short = render(
            &SfxSpec {
                seconds: Some(1.0),
                seed: 0,
                ..spec("impact")
            },
            SR,
        )
        .unwrap();
        let around_half = |y: &[f32]| rms(&y[samples(0.45, SR)..samples(0.55, SR)]);
        assert!(around_half(&short.l) < 0.7 * around_half(&x));
    }

    #[test]
    fn space_adds_a_tail_and_pitch_is_bounded() {
        let dry = render(&spec("ping"), SR).unwrap();
        let wet = render(
            &SfxSpec {
                space: Some("room".into()),
                ..spec("ping")
            },
            SR,
        )
        .unwrap();
        assert!(wet.len() > dry.len());
        assert_ne!(wet.l, wet.r);
        assert!(matches!(
            render(
                &SfxSpec {
                    space: Some("huge".into()),
                    ..spec("ping")
                },
                SR
            ),
            Err(SfxError::UnknownSpace(_))
        ));
        assert!(matches!(
            render(
                &SfxSpec {
                    pitch: 13.0,
                    ..spec("ping")
                },
                SR
            ),
            Err(SfxError::InvalidParameter(_))
        ));
        assert!(matches!(
            render(&spec("laser"), SR),
            Err(SfxError::UnknownRecipe(_))
        ));
    }
}
