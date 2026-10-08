//! 已冻结的 idle 循环内核（ADR-M08，计划 §2.9）。
//!
//! 阶段 1 **不**把 loop 降为关键帧轨：现有实现是
//! `amp * intensity * sampled_wave(...)` 再整体 `mixed_toward_identity(envelope)`，
//! 而关键帧轨会先算 `identity + a*w_i` 再插值，两者相差最后一个 ulp，破坏"逐位不变"。
//! 因此保留一个具名内核，**内核里没有任何自带数字**——振幅、周期、波形、seed、
//! 晶格、采样点数与包络常量全部来自 manifest（计划 §3.1）。
//!
//! 函数体逐式来自 `bcut-timeline/src/motion.rs:893-1033`。

use crate::composite::{PostOp, mix_toward_identity};
use crate::curve::{CurveSpec, sample_curve};

/// `jitter@1` 的晶格宽度（`motion.rs:15`），由 manifest 声明，这里只是缺省。
pub const DEFAULT_LATTICE: i64 = 8;
/// 波形重采样点数（`motion.rs:16`），同上。
pub const DEFAULT_WAVE_SAMPLES: usize = 32;
/// `jitter@1` 的缺省 seed（`motion.rs:949`）。
pub const DEFAULT_NOISE_SEED: u64 = 17;

/// 通道 → seed 序数（`motion.rs:950-957`）。`jitter` 的 dx 用 `seed+101`、dy 用 `seed+202`，
/// 由 `motion.rs:1127-1148` 的 golden 钉住。manifest 按通道名引用，序数永远是派生的。
pub const CHANNEL_ORDINALS: &[(&str, u32)] = &[
    ("opacity", 0),
    ("dx", 1),
    ("dy", 2),
    ("scaleX", 3),
    ("scaleY", 4),
    ("rotation", 5),
];

pub fn channel_ordinal(channel: &str) -> Option<u32> {
    CHANNEL_ORDINALS
        .iter()
        .find(|(name, _)| *name == channel)
        .map(|(_, ordinal)| *ordinal)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WaveKind {
    Sine,
    Dip,
    Noise,
    /// 单调爬坡：phase → phase。唯一一种在相位 1 处取 1 而不是 0 的波形，
    /// 只给 `rotation` 这类周期通道用（360° ≡ 0°，接缝仍然闭合）。
    Ramp,
    /// 设计稿 `heartBeat`：两下心跳（主拍 + 0.7 倍副拍）后静止。
    Heartbeat,
}

impl WaveKind {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "sine" => Some(Self::Sine),
            "dip" => Some(Self::Dip),
            "noise" => Some(Self::Noise),
            "ramp" => Some(Self::Ramp),
            "heartbeat" => Some(Self::Heartbeat),
            _ => None,
        }
    }
}

/// 具名噪声算法（ADR-M08）。新配方一律 splitmix64，`jitter@1` 冻结在这一支。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoiseKind {
    LatticeMurmurV1,
    /// 规范 §7.3 的 splitmix64（[`crate::rng`]）。阶段 3 起的新配方与
    /// `animate.flow` 的 `noise` op 都走这一支，缺省 seed **0**。
    Splitmix64V1,
}

impl NoiseKind {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "lattice-murmur-v1" => Some(Self::LatticeMurmurV1),
            "splitmix64-v1" => Some(Self::Splitmix64V1),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::LatticeMurmurV1 => "lattice-murmur-v1",
            Self::Splitmix64V1 => "splitmix64-v1",
        }
    }

    /// 晶格顶点值。两支都把 0 号顶点钉为 0 并按 `lattice` 取模（无缝循环）。
    pub fn vertex(self, seed: u64, index: i64, lattice: i64) -> f64 {
        match self {
            Self::LatticeMurmurV1 => noise_hash(seed, index, lattice),
            Self::Splitmix64V1 => crate::rng::splitmix64_lattice(seed, index, lattice),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NoiseSpec {
    pub kind: NoiseKind,
    pub lattice: i64,
    pub default_seed: u64,
}

/// 具名包络算法。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnvelopeKind {
    IdleRampV1,
    /// 无包络：`amount()` 恒为 1。`animate.flow` 的 `oscillate` / `noise` 用它
    /// （作者自己用 `delay` / `repeat` 控制起止，内核不再替他做 ramp）。
    None,
}

impl EnvelopeKind {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "idle-ramp-v1" => Some(Self::IdleRampV1),
            "none" => Some(Self::None),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EnvelopeSpec {
    pub kind: EnvelopeKind,
    pub ramp_cap: f64,
    pub ramp_fraction: f64,
    pub tail_threshold_sec: f64,
    pub tail_start: f64,
    pub tail_span: f64,
}

impl EnvelopeSpec {
    /// 恒等包络（`EnvelopeKind::None`）。其余字段不参与求值，写 0。
    pub const NONE: Self = Self {
        kind: EnvelopeKind::None,
        ramp_cap: 0.0,
        ramp_fraction: 0.0,
        tail_threshold_sec: 0.0,
        tail_start: 0.0,
        tail_span: 0.0,
    };

    /// 逐式来自 `motion.rs:961-973`。
    pub fn amount(&self, idle_local: f64, idle_duration: f64) -> f64 {
        if self.kind == EnvelopeKind::None {
            return 1.0;
        }
        let ramp = self.ramp_cap.min(idle_duration * self.ramp_fraction);
        let ramp_in = if ramp > 0.0 {
            (idle_local / ramp).clamp(0.0, 1.0)
        } else {
            1.0
        };
        if idle_duration <= self.tail_threshold_sec || idle_local <= idle_duration * self.tail_start
        {
            ramp_in
        } else {
            ramp_in
                * (1.0
                    - (idle_local - idle_duration * self.tail_start)
                        / (idle_duration * self.tail_span))
                    .max(0.0)
        }
    }
}

/// 单通道 idle 循环内核。所有数值都在编译期从 manifest + slot 求出。
#[derive(Clone, Debug, PartialEq)]
pub struct LoopKernel {
    pub wave: WaveKind,
    pub wave_samples: usize,
    pub noise: Option<NoiseSpec>,
    /// `amp * intensity`，与 `motion.rs:952-957` 的左结合顺序一致。
    pub amplitude: f64,
    pub channel_ordinal: u32,
    pub channel_seed_stride: u64,
    pub seed: u64,
    pub period: f64,
    pub phase_offset: f64,
    pub envelope: EnvelopeSpec,
    pub identity: f64,
    pub post: PostOp,
    /// 多关键帧循环（2026-09-08，元素 loop）。非空时不走波形：按相位落在的
    /// 段做 `sample_curve(段末帧 curve)` 插值，包络恒 1。波形配方此表恒空，
    /// 求值与指纹逐位不变。
    pub keyframes: Vec<ChannelKey>,
}

/// 关键帧链的一帧（loop 内核与 enter/exit 的 [`crate::lower_timeline::TweenAtom`]
/// 共用）：`value` 已按 `identity + (v − identity)·intensity` 折算；
/// `curve` 是**到达本帧**那一段的缓动。
#[derive(Clone, Debug, PartialEq)]
pub struct ChannelKey {
    pub at: f64,
    pub value: f64,
    pub curve: CurveSpec,
}

/// 在关键帧链上取相位 `phase ∈ [0, 1]` 的值：段 `[k_i, k_{i+1}]` 内按
/// `k_{i+1}.curve` 缓动；相位恰在关键帧上时逐位等于该帧 `value`。
pub fn sample_keyframes(keys: &[ChannelKey], phase: f64) -> f64 {
    match keys {
        [] => 0.0,
        [only] => only.value,
        _ => {
            let index = keys.partition_point(|key| key.at <= phase);
            if index == 0 {
                return keys[0].value;
            }
            if index >= keys.len() {
                return keys[keys.len() - 1].value;
            }
            let (from, to) = (&keys[index - 1], &keys[index]);
            if phase == from.at {
                return from.value;
            }
            let span = to.at - from.at;
            let progress = if span <= 0.0 {
                1.0
            } else {
                (phase - from.at) / span
            };
            let eased = sample_curve(&to.curve, progress);
            from.value + (to.value - from.value) * eased
        }
    }
}

impl LoopKernel {
    /// 逐式来自 `motion.rs:946-975` 的单通道切片。
    pub fn sample(&self, idle_local: f64, idle_duration: f64) -> f64 {
        let phase = idle_local / self.period + self.phase_offset;
        let phase = phase.rem_euclid(1.0);
        if !self.keyframes.is_empty() {
            let raw = sample_keyframes(&self.keyframes, phase);
            return self.post.apply(raw);
        }
        let seed = self
            .seed
            .wrapping_add(self.channel_ordinal as u64 * self.channel_seed_stride);
        let term = self.amplitude
            * sampled_wave(
                self.wave,
                seed,
                phase,
                self.wave_samples,
                self.noise.as_ref(),
            );
        // `motion.rs` 对 identity==0 的通道写 `amp*i*v`、对 identity==1 的通道写
        // `1.0 + amp*i*v`。两种写法在零的符号上不同，这里逐字保留。
        let raw = if self.identity == 0.0 {
            term
        } else {
            self.identity + term
        };
        let raw = self.post.apply(raw);
        let envelope = self.envelope.amount(idle_local, idle_duration);
        mix_toward_identity(raw, self.identity, envelope)
    }
}

/// 逐式来自 `motion.rs:985-991`。
pub fn wave_value(wave: WaveKind, seed: u64, phase: f64, noise: Option<&NoiseSpec>) -> f64 {
    use std::f64::consts::PI;
    match wave {
        WaveKind::Sine => libm::sin(2.0 * PI * phase),
        WaveKind::Dip => -(0.5 - 0.5 * libm::cos(2.0 * PI * phase)),
        WaveKind::Noise => {
            let lattice = noise.map_or(DEFAULT_LATTICE, |spec| spec.lattice);
            let kind = noise.map_or(NoiseKind::LatticeMurmurV1, |spec| spec.kind);
            noise_value_of(kind, seed, phase, lattice)
        }
        WaveKind::Ramp => phase.rem_euclid(1.0),
        WaveKind::Heartbeat => heartbeat_value(phase.rem_euclid(1.0)),
    }
}

/// 逐式来自设计稿 `model-textanim.js` 的 `heartBeat`：前 15% 一记主拍，
/// 20%–35% 一记 0.7 倍副拍，其余静止。
pub fn heartbeat_value(u: f64) -> f64 {
    use std::f64::consts::PI;
    if u < 0.15 {
        libm::sin(u / 0.15 * PI)
    } else if u < 0.2 {
        0.0
    } else if u < 0.35 {
        libm::sin((u - 0.2) / 0.15 * PI) * 0.7
    } else {
        0.0
    }
}

/// 周期终点（相位 1）的钉值：除 [`WaveKind::Ramp`] 取 1 外都是 0。
pub fn seam_value(wave: WaveKind) -> f64 {
    if wave == WaveKind::Ramp { 1.0 } else { 0.0 }
}

/// 逐式来自 `motion.rs:993-1007`。第 `samples` 个采样点被硬钉为
/// [`seam_value`]（ramp 为 1，其余为 0）。
pub fn sampled_wave(
    wave: WaveKind,
    seed: u64,
    phase: f64,
    samples: usize,
    noise: Option<&NoiseSpec>,
) -> f64 {
    let position = phase.rem_euclid(1.0) * samples as f64;
    let index = position.floor() as usize;
    let fraction = position - index as f64;
    let value = |sample: usize| {
        if sample == samples {
            seam_value(wave)
        } else {
            wave_value(wave, seed, sample as f64 / samples as f64, noise)
        }
    };
    let start = value(index);
    let end = value(index + 1);
    start + (end - start) * fraction
}

/// 逐式来自 `motion.rs:1009-1023`（murmur3 finalizer 风格，晶格 0 号点钉为 0）。
pub fn noise_hash(seed: u64, index: i64, lattice: i64) -> f64 {
    let index = index.rem_euclid(lattice) as u64;
    if index == 0 {
        return 0.0;
    }
    let mut hash = seed
        .wrapping_mul(0x9E37_79B1)
        .wrapping_add(index.wrapping_mul(0x85EB_CA77));
    hash ^= hash >> 33;
    hash = hash.wrapping_mul(0xFF51_AFD7_ED55_8CCD);
    hash ^= hash >> 33;
    hash = hash.wrapping_mul(0xC4CE_B9FE_1A85_EC53);
    hash ^= hash >> 33;
    (hash % 20_001) as f64 / 10_000.0 - 1.0
}

/// 逐式来自 `motion.rs:1025-1033`（`lattice-murmur-v1`）。
pub fn noise_value(seed: u64, phase: f64, lattice: i64) -> f64 {
    noise_value_of(NoiseKind::LatticeMurmurV1, seed, phase, lattice)
}

/// 具名噪声内核的平滑晶格插值。顶点算法按 `kind` 分派，插值（smoothstep）共用。
pub fn noise_value_of(kind: NoiseKind, seed: u64, phase: f64, lattice: i64) -> f64 {
    let x = phase.rem_euclid(1.0) * lattice as f64;
    let index = x.floor() as i64;
    let fraction = x - index as f64;
    let a = kind.vertex(seed, index, lattice);
    let b = kind.vertex(seed, index + 1, lattice);
    let smooth = fraction * fraction * (3.0 - 2.0 * fraction);
    a + (b - a) * smooth
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jitter_matches_voiceink_compiled_golden_samples() {
        // 与 `bcut-timeline/src/motion.rs::jitter_matches_voiceink_compiled_golden_samples`
        // 同一组数字，钉住 seed 序数 101/202 与 32 点重采样。
        let cases = [
            (
                0.05,
                0.001_059_279_375_000_000_2,
                -0.000_569_161_250_000_000_1,
            ),
            (0.125, 0.002_922_15, -0.001_570_1),
            (0.25, -0.000_762_3, 0.003_081_4),
            (
                0.31,
                -0.000_261_544_500_000_000_1,
                0.002_915_694_250_000_000_2,
            ),
        ];
        let noise = NoiseSpec {
            kind: NoiseKind::LatticeMurmurV1,
            lattice: DEFAULT_LATTICE,
            default_seed: DEFAULT_NOISE_SEED,
        };
        for (phase, expected_dx, expected_dy) in cases {
            let dx = 0.0035 * sampled_wave(WaveKind::Noise, 17 + 101, phase, 32, Some(&noise));
            let dy = 0.0035 * sampled_wave(WaveKind::Noise, 17 + 202, phase, 32, Some(&noise));
            assert!((dx - expected_dx).abs() < 1e-15, "phase={phase} dx={dx}");
            assert!((dy - expected_dy).abs() < 1e-15, "phase={phase} dy={dy}");
        }
    }

    #[test]
    fn lattice_index_zero_is_pinned() {
        assert_eq!(noise_hash(17, 0, 8), 0.0);
        assert_eq!(noise_hash(17, 8, 8), 0.0);
        assert_eq!(noise_value(17, 0.0, 8), 0.0);
    }

    #[test]
    fn envelope_ramps_in_and_out() {
        let envelope = EnvelopeSpec {
            kind: EnvelopeKind::IdleRampV1,
            ramp_cap: 0.3,
            ramp_fraction: 0.15,
            tail_threshold_sec: 6.0,
            tail_start: 0.8,
            tail_span: 0.2,
        };
        assert_eq!(envelope.amount(0.0, 4.0), 0.0);
        assert_eq!(envelope.amount(1.0, 4.0), 1.0);
        // 短 idle 没有尾部 ramp-out
        assert_eq!(envelope.amount(3.9, 4.0), 1.0);
        // 长 idle 在最后 20% ramp-out
        assert_eq!(envelope.amount(10.0, 10.0), 0.0);
        assert!(envelope.amount(9.0, 10.0) < 1.0);
    }

    #[test]
    fn the_two_noise_kernels_stay_separate_and_both_loop_seamlessly() {
        // ADR-M08：`jitter@1` 的 murmur 内核不得被 splitmix64 改写。
        let murmur = noise_value_of(NoiseKind::LatticeMurmurV1, 17, 0.37, 8);
        let split = noise_value_of(NoiseKind::Splitmix64V1, 17, 0.37, 8);
        assert_eq!(murmur, noise_value(17, 0.37, 8));
        assert_ne!(murmur, split);
        for kind in [NoiseKind::LatticeMurmurV1, NoiseKind::Splitmix64V1] {
            assert_eq!(noise_value_of(kind, 5, 0.0, 8), 0.0, "{kind:?}");
            assert_eq!(
                noise_value_of(kind, 5, 1.0, 8),
                noise_value_of(kind, 5, 0.0, 8),
                "{kind:?}"
            );
        }
    }

    #[test]
    fn the_none_envelope_is_the_identity() {
        assert_eq!(EnvelopeSpec::NONE.amount(0.0, 4.0), 1.0);
        assert_eq!(EnvelopeSpec::NONE.amount(4.0, 4.0), 1.0);
    }

    #[test]
    fn channel_ordinals_match_the_pose_channel_order() {
        assert_eq!(channel_ordinal("dx"), Some(1));
        assert_eq!(channel_ordinal("dy"), Some(2));
        assert_eq!(channel_ordinal("blur"), None);
    }
}
