//! 编写/组合 AST（ADR-M02、设计 §5.2）与它的编译器。
//!
//! Timeline / BCF 的 **legacy** lowering 仍然直接构造 `MotionProgram`（段布局、
//! fill 语义与逐通道曲线必须逐位复刻现有公式，绕一圈 Graph 只会增加漂移面，
//! 见 §15 阶段 1 偏离 5）。这里是 `animate.flow` / `animate.parts` 的编译路径：
//!
//! ```text
//! MotionGraph ──compile_flow()──► Vec<FlowTrack>（每轨一串关键帧）
//!                                     │
//!                        ┌────────────┴────────────┐
//!                        ▼                         ▼
//!             to_program()（强类型段）      bcut-core 的 Channel（Kf.v 原文 JSON）
//! ```
//!
//! **关键帧是唯一中间形态**，两条投影因此逐位一致：`MotionProgram` 的段由同一串
//! 关键帧按 `lower_bcf::to_program` 的窗口规则生成，`Channel` 直接拿这串关键帧。
//! 代价是 `oscillate` / `noise` / 曲线对象都要在编译期**铺成关键帧**——正好也让
//! `sample(t)` 保持纯查表、乱序采样天然一致（设计 §11）。

use serde_json::Value;

use crate::MotionError;
use crate::composite::{CompositeMode, PostOp, default_mode};
use crate::curve::{CurveSpec, sample_curve};
use crate::interpolate::InterpolatorSpec;
use crate::loop_kernel::{DEFAULT_WAVE_SAMPLES, NoiseKind, WaveKind, sampled_wave};
use crate::preset_registry::ExpandCtx;
use crate::program::PresetRef;
use crate::program::{
    Fill, MotionProgram, MotionSegment, PropertyTrack, SegmentKind, TargetId, TimeBase,
};
use crate::text_parts::{StaggerFrom, stagger_order_from};
use crate::value::{MotionValue, PropertyId};

/// `repeat` 展开的段数上限（计划 §3.2.2）。1.2s 的 child × 512 ≈ 10 分钟，
/// 超了报错而不是静默截断。
pub const REPEAT_UNROLL_CAP: usize = 512;

/// 曲线对象（spring / cubicBezier / steps）铺成关键帧时的采样率下限。
/// 封闭枚举里的**名称**曲线不走这条路——它们在 `Kf.ease` 上是无损的。
pub const CURVE_BAKE_MIN_FPS: f64 = 60.0;

/// 单条轨的关键帧上限，挡住 `repeat` × `oscillate` 的组合爆炸。
pub const TRACK_FRAME_CAP: usize = 20_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RepeatMode {
    Loop,
    Yoyo,
}

/// `repeat` 的终点（规范 §7.5）。`Until` 是**已求值的绝对秒**——TimeExpr 与
/// `clip.start` / `clip.end` 保留串由 `bcut-core` 在交给本 crate 之前解开
/// （`bcut-motion` 不依赖 `bcut-core`，也就没有 cue 表与定点迭代）。
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum RepeatEnd {
    Count(u32),
    Until(f64),
}

/// 幅度：JSON 数字或未求值的相对长度对象（规范 §7.8）。
pub type Amplitude = Value;

/// 变体预算（设计 §13）：12 个。`At` 是阶段 3 为规范 §7.5 的 `at` 键加的
/// **绝对定位**变体（`at` 可以出现在任何 op 上，把它拆成一层包装比给 11 个变体
/// 各加一个 `Option<f64>` 字段干净）。
#[derive(Clone, Debug, PartialEq)]
pub enum MotionOp {
    Set {
        target: TargetId,
        property: PropertyId,
        value: Value,
        composite: CompositeMode,
    },
    Wait {
        dur: f64,
    },
    Tween {
        target: TargetId,
        property: PropertyId,
        from: Value,
        to: Value,
        dur: f64,
        curve: CurveSpec,
        composite: CompositeMode,
        interpolator: InterpolatorSpec,
    },
    Preset {
        target: TargetId,
        id: String,
        version: Option<u32>,
        params: serde_json::Map<String, Value>,
        /// `resolve_durations()` 归一化后一定是 `Some`。
        dur: Option<f64>,
    },
    Parallel(Vec<MotionOp>),
    Sequence(Vec<MotionOp>),
    /// `targets` 在**解析期**就展开成具体目标（part 集合或元素集合），
    /// 时长规则 `max(item_i + order_i·gap)` 因此仍是纯函数。
    Stagger {
        item: Box<MotionOp>,
        gap: f64,
        order: StaggerFrom,
        targets: Vec<TargetId>,
    },
    Delay {
        delay: f64,
        child: Box<MotionOp>,
    },
    Repeat {
        end: RepeatEnd,
        mode: RepeatMode,
        child: Box<MotionOp>,
    },
    Oscillate {
        target: TargetId,
        property: PropertyId,
        amplitude: Amplitude,
        period: f64,
        phase: f64,
        wave: WaveKind,
        dur: f64,
        composite: CompositeMode,
    },
    Noise {
        target: TargetId,
        property: PropertyId,
        amplitude: Amplitude,
        period: f64,
        seed: u64,
        /// 通道序数：`effective_seed = seed + channel × 101`，与冻结的
        /// `jitter@1` 的 `channelSeedStride` 同一套派生（x / y 用不同子种子）。
        channel: u64,
        lattice: i64,
        dur: f64,
        composite: CompositeMode,
    },
    /// 绝对定位（规范 §7.5 的 `at`）。`delay` 的位移仍然叠加在它上面，
    /// 这样 `use.stagger` 包裹整棵 flow 时绝对时间也跟着挪（规范 §10.3）。
    At {
        at: f64,
        child: Box<MotionOp>,
    },
}

impl MotionOp {
    /// 设计 §5.2 / 规范 §7.5 的规范性时长规则。
    pub fn duration(&self) -> f64 {
        match self {
            Self::Set { .. } => 0.0,
            Self::Wait { dur } | Self::Tween { dur, .. } => *dur,
            Self::Oscillate { dur, .. } | Self::Noise { dur, .. } => *dur,
            Self::Preset { dur, .. } => dur.unwrap_or(0.0),
            Self::Parallel(children) => children
                .iter()
                .map(MotionOp::duration)
                .fold(0.0f64, f64::max),
            Self::Sequence(children) => children.iter().map(MotionOp::duration).sum(),
            Self::Stagger {
                item,
                gap,
                order,
                targets,
            } => {
                let count = targets.len();
                (0..count)
                    .map(|index| {
                        item.duration() + stagger_order_from(index, count, *order) as f64 * gap
                    })
                    .fold(0.0f64, f64::max)
            }
            Self::Delay { delay, child } => delay + child.duration(),
            Self::Repeat { end, child, .. } => match end {
                RepeatEnd::Count(count) => *count as f64 * child.duration(),
                // `until` 是绝对秒；相对时长在这里无从表达，退回单次 child。
                // `compile` 用绝对起点重新算展开次数，不依赖这个值。
                RepeatEnd::Until(_) => child.duration(),
            },
            Self::At { child, .. } => child.duration(),
        }
    }

    /// 时间反转（`repeat.mode = "yoyo"` 的返程）。
    ///
    /// **只交换 `from`/`to`，不反转曲线**：反转后的曲线回不到 BCF `Kf.ease` 的
    /// 封闭枚举，会让 flow 的关键帧投影与程序采样分家（§15 阶段 3 偏离）。
    /// 规范 §7.5 举的 `easeInOutSine` 本来就对称，交换端点即精确镜像。
    pub fn reversed(&self) -> MotionOp {
        match self {
            Self::Tween {
                target,
                property,
                from,
                to,
                dur,
                curve,
                composite,
                interpolator,
            } => Self::Tween {
                target: *target,
                property: property.clone(),
                from: to.clone(),
                to: from.clone(),
                dur: *dur,
                curve: curve.clone(),
                composite: *composite,
                interpolator: *interpolator,
            },
            Self::Parallel(children) => {
                Self::Parallel(children.iter().map(MotionOp::reversed).collect())
            }
            Self::Sequence(children) => {
                Self::Sequence(children.iter().rev().map(MotionOp::reversed).collect())
            }
            Self::Delay { delay, child } => {
                Self::Sequence(vec![child.reversed(), Self::Wait { dur: *delay }])
            }
            Self::Stagger {
                item,
                gap,
                order,
                targets,
            } => Self::Stagger {
                item: Box::new(item.reversed()),
                gap: *gap,
                order: *order,
                targets: targets.clone(),
            },
            other => other.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct MotionGraph {
    pub root: MotionOp,
}

impl MotionGraph {
    pub fn duration(&self) -> f64 {
        self.root.duration()
    }
}

/// 编译上下文。`window.0` 是根节点的缺省起点（规范 §7.5：根缺省 `clip.start`）。
#[derive(Clone, Copy, Debug)]
pub struct CompileCtx {
    pub fps: f64,
    pub window: (f64, Option<f64>),
    pub project_end: f64,
    pub time_base: TimeBase,
    /// 规范 §7.3：省略 seed 时编译期写死 0。
    pub default_seed: u64,
}

impl Default for CompileCtx {
    fn default() -> Self {
        Self {
            fps: 30.0,
            window: (0.0, None),
            project_end: 0.0,
            time_base: TimeBase::Absolute,
            default_seed: 0,
        }
    }
}

impl CompileCtx {
    /// 曲线对象铺关键帧用的采样率：不低于 [`CURVE_BAKE_MIN_FPS`]。
    fn bake_fps(&self) -> f64 {
        if self.fps.is_finite() && self.fps > CURVE_BAKE_MIN_FPS {
            self.fps
        } else {
            CURVE_BAKE_MIN_FPS
        }
    }
}

// ── 编译产物 ─────────────────────────────────────────────────────────

/// 一个关键帧。`v` 是**原文 JSON**（数字或未求值的相对长度对象）。
#[derive(Clone, Debug, PartialEq)]
pub struct FlowFrame {
    pub t: f64,
    pub v: Value,
    pub ease: Option<String>,
}

/// 一条轨的关键帧串。`(target, prop, composite, order)` 是轨的身份。
#[derive(Clone, Debug, PartialEq)]
pub struct FlowTrack {
    pub target: TargetId,
    pub prop: String,
    pub composite: CompositeMode,
    pub order: u32,
    pub frames: Vec<FlowFrame>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct CompiledFlow {
    pub tracks: Vec<FlowTrack>,
    /// 展开过的配方（provenance；采样期不查）。
    pub sources: Vec<PresetRef>,
    /// 命中的 alias（供 `preset-alias-used` info lint）。
    pub aliases_used: Vec<String>,
}

impl CompiledFlow {
    /// 关键帧 → 强类型 `MotionProgram`。段布局与 `lower_bcf::to_program` 同一套
    /// 窗口规则，因此程序采样与关键帧采样逐位一致。
    pub fn to_program(&self, time_base: TimeBase) -> MotionProgram {
        let mut program = MotionProgram::new(time_base);
        for track in &self.tracks {
            let property = PropertyId::parse(&track.prop);
            let typed: Vec<MotionValue> = track
                .frames
                .iter()
                .map(|frame| MotionValue::from_json(&track.prop, &frame.v))
                .collect();
            let base = MotionValue::Scalar(crate::composite::identity_for(&track.prop));
            let mut segments = Vec::new();
            match track.frames.len() {
                0 => {}
                1 => segments.push(MotionSegment {
                    t0: track.frames[0].t,
                    t1: track.frames[0].t,
                    fill_before: Fill::Hold,
                    fill_after: Fill::Hold,
                    composite: track.composite,
                    order: track.order,
                    kind: SegmentKind::Hold {
                        value: typed[0].clone(),
                    },
                }),
                count => {
                    for index in 0..count - 1 {
                        let (a, b) = (&track.frames[index], &track.frames[index + 1]);
                        segments.push(MotionSegment {
                            t0: a.t,
                            t1: b.t,
                            fill_before: if index == 0 { Fill::Hold } else { Fill::Off },
                            fill_after: if index + 2 == count {
                                Fill::Hold
                            } else {
                                Fill::Off
                            },
                            composite: track.composite,
                            order: track.order,
                            kind: SegmentKind::Tween {
                                from: typed[index].clone(),
                                to: typed[index + 1].clone(),
                                curve: match &b.ease {
                                    Some(name) => CurveSpec::from_name(name),
                                    None => CurveSpec::Default,
                                },
                                interpolator: InterpolatorSpec::Linear,
                            },
                        });
                    }
                }
            }
            program.property_tracks.push(PropertyTrack {
                target: track.target,
                property,
                composite: track.composite,
                order: track.order,
                base,
                post: PostOp::for_property(&track.prop),
                optional: false,
                segments,
            });
        }
        program.sources = self.sources.clone();
        program
    }
}

/// `MotionGraph` → `MotionProgram`（关键帧投影见 [`compile_flow`]）。
pub fn compile(graph: &MotionGraph, ctx: &CompileCtx) -> Result<MotionProgram, MotionError> {
    Ok(compile_flow(graph, ctx)?.to_program(ctx.time_base))
}

/// `MotionGraph` → 每轨一串关键帧。
pub fn compile_flow(graph: &MotionGraph, ctx: &CompileCtx) -> Result<CompiledFlow, MotionError> {
    let mut graph = graph.clone();
    resolve_durations(&mut graph.root)?;
    let mut out = CompiledFlow::default();
    lower_op(&graph.root, ctx.window.0, 0.0, None, ctx, &mut out)?;
    for track in &mut out.tracks {
        // 稳定排序：同刻的多帧保持写入序（`repeat` 的接缝处先来的那帧带着到达曲线）。
        track
            .frames
            .sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap_or(std::cmp::Ordering::Equal));
        // `repeat` / `sequence` 的接缝会在同一时刻产出**同值**的两帧（前一程的
        // 终点 = 后一程的起点）。去重后段数就等于「几程 × 每程几段」，
        // 也让 `to_program()` 不产生零长段。真正的阶跃（同刻不同值）保留。
        track.frames.dedup_by(|later, earlier| {
            (later.t - earlier.t).abs() < f64::EPSILON && later.v == earlier.v
        });
        if track.frames.len() > TRACK_FRAME_CAP {
            return Err(MotionError::Unsupported("flow-track-too-many-frames"));
        }
    }
    out.tracks.sort_by(|a, b| {
        a.target
            .cmp(&b.target)
            .then(a.order.cmp(&b.order))
            .then(a.prop.cmp(&b.prop))
    });
    Ok(out)
}

/// 归一化 pass：把每个 `preset` op 的 `dur` 用配方的 `defaults.dur` 填实，
/// 好让 `duration()` 保持纯函数（计划 §3.2.0）。
pub fn resolve_durations(op: &mut MotionOp) -> Result<(), MotionError> {
    match op {
        MotionOp::Preset { id, dur, .. } => {
            if dur.is_none() {
                let canonical = crate::preset_registry::canonical_id(id);
                let default = crate::preset_registry::manifest(canonical)
                    .and_then(|manifest| manifest.defaults.dur)
                    .unwrap_or(DEFAULT_PRESET_DUR);
                *dur = Some(default);
            }
            Ok(())
        }
        MotionOp::Parallel(children) | MotionOp::Sequence(children) => {
            for child in children {
                resolve_durations(child)?;
            }
            Ok(())
        }
        MotionOp::Delay { child, .. }
        | MotionOp::Repeat { child, .. }
        | MotionOp::At { child, .. } => resolve_durations(child),
        MotionOp::Stagger { item, .. } => resolve_durations(item),
        _ => Ok(()),
    }
}

/// `enter` 槽的历史缺省（`resolve.rs` 的 `dur.unwrap_or(0.5)`）。
pub const DEFAULT_PRESET_DUR: f64 = 0.5;

fn push_frames(
    out: &mut CompiledFlow,
    target: TargetId,
    prop: &str,
    composite: CompositeMode,
    order: u32,
    frames: Vec<FlowFrame>,
) {
    if frames.is_empty() {
        return;
    }
    if let Some(track) = out.tracks.iter_mut().find(|track| {
        track.target == target
            && track.prop == prop
            && track.composite == composite
            && track.order == order
    }) {
        track.frames.extend(frames);
        return;
    }
    out.tracks.push(FlowTrack {
        target,
        prop: prop.to_owned(),
        composite,
        order,
        frames,
    });
}

/// `cursor` 是本 op 的起点，`shift` 是外层 `delay` 累计的位移（`at` 也要跟着挪）。
fn lower_op(
    op: &MotionOp,
    cursor: f64,
    shift: f64,
    target_override: Option<TargetId>,
    ctx: &CompileCtx,
    out: &mut CompiledFlow,
) -> Result<(), MotionError> {
    let pick = |declared: TargetId| target_override.unwrap_or(declared);
    match op {
        MotionOp::Wait { .. } => Ok(()),
        MotionOp::Set {
            target,
            property,
            value,
            composite,
        } => {
            push_frames(
                out,
                pick(*target),
                property.as_str(),
                *composite,
                0,
                vec![FlowFrame {
                    t: cursor,
                    v: value.clone(),
                    ease: None,
                }],
            );
            Ok(())
        }
        MotionOp::Tween {
            target,
            property,
            from,
            to,
            dur,
            curve,
            composite,
            ..
        } => {
            let frames = tween_frames(from, to, cursor, *dur, curve, ctx)?;
            push_frames(out, pick(*target), property.as_str(), *composite, 0, frames);
            Ok(())
        }
        MotionOp::Preset {
            target,
            id,
            version,
            params,
            dur,
        } => {
            let dur = dur.unwrap_or(DEFAULT_PRESET_DUR);
            let expanded = crate::preset_registry::expand(
                id,
                *version,
                params,
                &ExpandCtx {
                    dur,
                    default_seed: ctx.default_seed,
                },
            )?;
            for source in expanded.sources {
                if !out.sources.contains(&source) {
                    out.sources.push(source);
                }
            }
            for alias in expanded.aliases_used {
                if !out.aliases_used.contains(&alias) {
                    out.aliases_used.push(alias);
                }
            }
            for track in expanded.tracks {
                let frames = track
                    .frames
                    .into_iter()
                    .map(|frame| FlowFrame {
                        t: cursor + frame.t,
                        v: frame.v,
                        ease: frame.ease,
                    })
                    .collect();
                push_frames(
                    out,
                    pick(*target),
                    &track.prop,
                    track.composite,
                    track.order,
                    frames,
                );
            }
            Ok(())
        }
        MotionOp::Parallel(children) => {
            for child in children {
                lower_op(child, cursor, shift, target_override, ctx, out)?;
            }
            Ok(())
        }
        MotionOp::Sequence(children) => {
            let mut at = cursor;
            for child in children {
                lower_op(child, at, shift, target_override, ctx, out)?;
                at += child.duration();
            }
            Ok(())
        }
        MotionOp::Delay { delay, child } => lower_op(
            child,
            cursor + delay,
            shift + delay,
            target_override,
            ctx,
            out,
        ),
        MotionOp::At { at, child } => lower_op(child, at + shift, shift, target_override, ctx, out),
        MotionOp::Stagger {
            item,
            gap,
            order,
            targets,
        } => {
            let count = targets.len();
            for (index, target) in targets.iter().enumerate() {
                let offset = stagger_order_from(index, count, *order) as f64 * gap;
                lower_op(item, cursor + offset, shift, Some(*target), ctx, out)?;
            }
            Ok(())
        }
        MotionOp::Repeat { end, mode, child } => {
            let child_dur = child.duration();
            if !(child_dur > 0.0) {
                return Err(MotionError::Unsupported("repeat-zero-length-child"));
            }
            let count = match end {
                RepeatEnd::Count(count) => *count as usize,
                RepeatEnd::Until(until) => {
                    let span = until - cursor;
                    if span <= 0.0 {
                        0
                    } else {
                        (span / child_dur).ceil() as usize
                    }
                }
            };
            if count > REPEAT_UNROLL_CAP {
                return Err(MotionError::Unsupported("repeat-too-many"));
            }
            let reversed = child.reversed();
            for index in 0..count {
                let at = cursor + index as f64 * child_dur;
                if let RepeatEnd::Until(until) = end {
                    if at >= *until {
                        break;
                    }
                }
                let step = if *mode == RepeatMode::Yoyo && index % 2 == 1 {
                    &reversed
                } else {
                    child.as_ref()
                };
                lower_op(step, at, shift, target_override, ctx, out)?;
            }
            Ok(())
        }
        MotionOp::Oscillate {
            target,
            property,
            amplitude,
            period,
            phase,
            wave,
            dur,
            composite,
        } => {
            let frames = wave_frames(
                *wave, None, 0, amplitude, *period, *phase, cursor, *dur, ctx,
            )?;
            push_frames(out, pick(*target), property.as_str(), *composite, 0, frames);
            Ok(())
        }
        MotionOp::Noise {
            target,
            property,
            amplitude,
            period,
            seed,
            channel,
            lattice,
            dur,
            composite,
        } => {
            let spec = crate::loop_kernel::NoiseSpec {
                kind: NoiseKind::Splitmix64V1,
                lattice: *lattice,
                default_seed: 0,
            };
            let seed = seed.wrapping_add(channel.wrapping_mul(CHANNEL_SEED_STRIDE));
            let frames = wave_frames(
                WaveKind::Noise,
                Some(spec),
                seed,
                amplitude,
                *period,
                0.0,
                cursor,
                *dur,
                ctx,
            )?;
            push_frames(out, pick(*target), property.as_str(), *composite, 0, frames);
            Ok(())
        }
    }
}

/// `noise` op 的通道子种子步长，与冻结的 `jitter@1` 的 `channelSeedStride` 同值。
pub const CHANNEL_SEED_STRIDE: u64 = 101;

/// 一段 tween → 关键帧。名称曲线无损保留在 `ease` 上；曲线对象（spring /
/// cubicBezier / steps）在编译期**铺成线性关键帧**（§15 阶段 3 偏离）。
fn tween_frames(
    from: &Value,
    to: &Value,
    t0: f64,
    dur: f64,
    curve: &CurveSpec,
    ctx: &CompileCtx,
) -> Result<Vec<FlowFrame>, MotionError> {
    let ease = match curve {
        CurveSpec::Default => None,
        CurveSpec::Named(id) => Some(id.name().to_owned()),
        CurveSpec::Unknown(name) => {
            return Err(MotionError::ManifestInvalid(format!(
                "unknown easing \"{name}\""
            )));
        }
        _ => {
            // 曲线对象：按 fps 网格铺关键帧。
            let steps = ((dur * ctx.bake_fps()).ceil() as usize).clamp(1, TRACK_FRAME_CAP - 1);
            let mut frames = Vec::with_capacity(steps + 1);
            for index in 0..=steps {
                let progress = index as f64 / steps as f64;
                let eased = sample_curve(curve, progress);
                frames.push(FlowFrame {
                    t: t0 + dur * progress,
                    v: mix_flow_value(from, to, eased)?,
                    ease: None,
                });
            }
            return Ok(frames);
        }
    };
    Ok(vec![
        FlowFrame {
            t: t0,
            v: from.clone(),
            ease: None,
        },
        FlowFrame {
            t: t0 + dur,
            v: to.clone(),
            ease,
        },
    ])
}

/// `oscillate` / `noise` → 关键帧。
///
/// 波形在 [`sampled_wave`] 里本来就是 `wave_samples` 点的**分段线性**函数
/// （第 `samples` 个点被钉为 [`crate::loop_kernel::seam_value`]：ramp 是 1、其余
/// 波形是 0，与各自相位 0 处的取值接成一圈），因此把断点铺成关键帧、段间线性
/// 插值 = 内核逐位相同的值，而不是近似。
#[allow(clippy::too_many_arguments)]
fn wave_frames(
    wave: WaveKind,
    noise: Option<crate::loop_kernel::NoiseSpec>,
    seed: u64,
    amplitude: &Amplitude,
    period: f64,
    phase: f64,
    t0: f64,
    dur: f64,
    _ctx: &CompileCtx,
) -> Result<Vec<FlowFrame>, MotionError> {
    if !(period > 0.0) || !(dur > 0.0) {
        return Err(MotionError::Unsupported("oscillate-nonpositive-period"));
    }
    let samples = DEFAULT_WAVE_SAMPLES;
    let step = period / samples as f64;
    let mut breakpoints: Vec<f64> = vec![0.0];
    // 相位跨过 k/samples 的那些时刻就是分段线性的断点。
    let first = ((phase * samples as f64).ceil()) as i64;
    let mut k = first;
    loop {
        let local = (k as f64 / samples as f64 - phase) * period;
        if local >= dur {
            break;
        }
        if local > 0.0 {
            breakpoints.push(local);
        }
        k += 1;
        if breakpoints.len() > TRACK_FRAME_CAP {
            return Err(MotionError::Unsupported("flow-track-too-many-frames"));
        }
    }
    let _ = step;
    breakpoints.push(dur);
    let mut frames = Vec::with_capacity(breakpoints.len());
    for local in breakpoints {
        let value = sampled_wave(wave, seed, local / period + phase, samples, noise.as_ref());
        frames.push(FlowFrame {
            t: t0 + local,
            v: scale_amplitude(amplitude, value)?,
            ease: None,
        });
    }
    Ok(frames)
}

/// 幅度 × 波形值。数字直乘；相对长度对象按分量缩放（`value` 与 `offset` 同乘），
/// 求值仍留给布局之后的 `build_channels_after_layout`（设计 §5.5）。
pub fn scale_amplitude(amplitude: &Value, factor: f64) -> Result<Value, MotionError> {
    if let Some(n) = amplitude.as_f64() {
        return Ok(Value::from(n * factor));
    }
    let length =
        crate::preset_registry::manifest::parse_length_value(amplitude).ok_or_else(|| {
            MotionError::ManifestInvalid(format!("amplitude {amplitude} 既不是数字也不是长度"))
        })?;
    Ok(serde_json::json!({
        "value": length.value * factor,
        "basis": length.basis.name(),
        "offset": length.offset_px * factor,
    }))
}

/// 关键帧值的线性混合（曲线对象铺帧用）。
///
/// 相对长度的求值是 `px = value × basis + offset`，对 `value` / `offset` 双线性，
/// 因此两端的线性插值只在**结果仍能写成一个 `{value, basis, offset}`** 时可表示：
/// 同 basis（两个分量各自线性），或其中一端是绝对长度（它整个折进 `offset`）。
/// 两个不同的非绝对 basis 混不出单一对象——那需要两条基准的和，报错而不是猜。
fn mix_flow_value(a: &Value, b: &Value, u: f64) -> Result<Value, MotionError> {
    if let (Some(na), Some(nb)) = (a.as_f64(), b.as_f64()) {
        return Ok(Value::from(na + (nb - na) * u));
    }
    let (Some(la), Some(lb)) = (
        crate::preset_registry::manifest::parse_length_value(a),
        crate::preset_registry::manifest::parse_length_value(b),
    ) else {
        return Err(MotionError::Unsupported("curve-object-on-discrete-value"));
    };
    let length = |value: f64, basis: crate::relative_value::LengthBasis, offset: f64| {
        Ok(serde_json::json!({
            "value": value,
            "basis": basis.name(),
            "offset": offset,
        }))
    };
    use crate::relative_value::LengthBasis::Absolute;
    if la.basis == lb.basis {
        return length(
            la.value + (lb.value - la.value) * u,
            la.basis,
            la.offset_px + (lb.offset_px - la.offset_px) * u,
        );
    }
    if lb.basis == Absolute {
        return length(
            la.value * (1.0 - u),
            la.basis,
            la.offset_px * (1.0 - u) + (lb.value + lb.offset_px) * u,
        );
    }
    if la.basis == Absolute {
        return length(
            lb.value * u,
            lb.basis,
            (la.value + la.offset_px) * (1.0 - u) + lb.offset_px * u,
        );
    }
    Err(MotionError::Unsupported("curve-object-mixes-two-bases"))
}

/// 属性缺省合成模式（`composite` 缺省时用它，规范 §7.7）。
pub fn default_composite(prop: &str) -> CompositeMode {
    default_mode(prop)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::composite::PoseBuffer;
    use crate::curve::EaseId;
    use crate::loop_kernel::DEFAULT_LATTICE;
    use crate::rng::splitmix64;
    use crate::sample::sample;
    use serde_json::json;

    fn tween(dur: f64) -> MotionOp {
        MotionOp::Tween {
            target: TargetId::SELF,
            property: PropertyId::known("opacity"),
            from: json!(0.0),
            to: json!(1.0),
            dur,
            curve: CurveSpec::Named(EaseId::Linear),
            composite: CompositeMode::Replace,
            interpolator: InterpolatorSpec::Linear,
        }
    }

    fn tween_prop(prop: &'static str, from: f64, to: f64, dur: f64) -> MotionOp {
        MotionOp::Tween {
            target: TargetId::SELF,
            property: PropertyId::known(prop),
            from: json!(from),
            to: json!(to),
            dur,
            curve: CurveSpec::Named(EaseId::Linear),
            composite: CompositeMode::Replace,
            interpolator: InterpolatorSpec::Linear,
        }
    }

    #[test]
    fn parallel_is_max_and_sequence_is_sum() {
        let children = vec![tween(0.4), tween(1.2), MotionOp::Wait { dur: 0.7 }];
        assert_eq!(MotionOp::Parallel(children.clone()).duration(), 1.2);
        assert_eq!(MotionOp::Sequence(children).duration(), 0.4 + 1.2 + 0.7);
    }

    /// 设计 §11 的 property test：随机组合树上 `parallel = max`、`sequence = Σ`。
    #[test]
    fn duration_rules_hold_on_random_trees() {
        fn build(state: &mut u64, depth: usize) -> MotionOp {
            let roll = splitmix64(state) % 100;
            if depth == 0 || roll < 40 {
                let dur = (splitmix64(state) % 40) as f64 / 10.0;
                return if roll % 2 == 0 {
                    MotionOp::Wait { dur }
                } else {
                    tween(dur)
                };
            }
            let count = 1 + (splitmix64(state) % 3) as usize;
            let children: Vec<MotionOp> = (0..count).map(|_| build(state, depth - 1)).collect();
            if roll < 70 {
                MotionOp::Parallel(children)
            } else {
                MotionOp::Sequence(children)
            }
        }
        let mut state = 0xBAC0_1234_5678_9ABCu64;
        for _ in 0..200 {
            let op = build(&mut state, 3);
            match &op {
                MotionOp::Parallel(children) => assert_eq!(
                    op.duration(),
                    children
                        .iter()
                        .map(MotionOp::duration)
                        .fold(0.0f64, f64::max)
                ),
                MotionOp::Sequence(children) => {
                    let sum: f64 = children.iter().map(MotionOp::duration).sum();
                    assert_eq!(op.duration(), sum);
                }
                _ => {}
            }
        }
    }

    #[test]
    fn stagger_delay_and_repeat_duration_rules() {
        let stagger = MotionOp::Stagger {
            item: Box::new(tween(0.4)),
            gap: 0.1,
            order: StaggerFrom::Start,
            targets: vec![TargetId(1), TargetId(2), TargetId(3)],
        };
        assert!((stagger.duration() - 0.6).abs() < 1e-12);
        let delayed = MotionOp::Delay {
            delay: 0.25,
            child: Box::new(tween(0.5)),
        };
        assert_eq!(delayed.duration(), 0.75);
        assert_eq!(
            MotionOp::Repeat {
                end: RepeatEnd::Count(3),
                mode: RepeatMode::Loop,
                child: Box::new(tween(0.5)),
            }
            .duration(),
            1.5
        );
        assert_eq!(
            MotionOp::Set {
                target: TargetId::SELF,
                property: PropertyId::known("opacity"),
                value: json!(1.0),
                composite: CompositeMode::Replace,
            }
            .duration(),
            0.0
        );
    }

    /// 时长按**实际 order**取最大：`start`/`end` 是 `0..n` 的置换（最大 n-1），
    /// `center` 不是（`[2,1,0,1,2]`，最大 2）。规范 §7.5 写的
    /// `max(item_i + i·gap)` 默认 order 是置换，这里取实际值更准（实现注记）。
    #[test]
    fn stagger_duration_follows_the_actual_order_table() {
        for (order, span) in [
            (StaggerFrom::Start, 4.0),
            (StaggerFrom::End, 4.0),
            (StaggerFrom::Center, 2.0),
        ] {
            let stagger = MotionOp::Stagger {
                item: Box::new(tween(0.4)),
                gap: 0.1,
                order,
                targets: (1..=5).map(TargetId).collect(),
            };
            assert!(
                (stagger.duration() - (0.4 + span * 0.1)).abs() < 1e-12,
                "{order:?} => {}",
                stagger.duration()
            );
        }
    }

    #[test]
    fn stagger_start_times_are_monotonic_and_permuted_by_order() {
        let starts = |order: StaggerFrom| -> Vec<f64> {
            let graph = MotionGraph {
                root: MotionOp::Stagger {
                    item: Box::new(tween(0.2)),
                    gap: 0.1,
                    order,
                    targets: (1..=4).map(TargetId).collect(),
                },
            };
            let flow = compile_flow(&graph, &CompileCtx::default()).unwrap();
            let mut out = vec![0.0; 4];
            for track in &flow.tracks {
                out[track.target.0 as usize - 1] = track.frames[0].t;
            }
            out
        };
        let close = |got: Vec<f64>, want: Vec<f64>| {
            assert_eq!(got.len(), want.len());
            for (a, b) in got.iter().zip(&want) {
                assert!((a - b).abs() < 1e-12, "{got:?} != {want:?}");
            }
        };
        close(starts(StaggerFrom::Start), vec![0.0, 0.1, 0.2, 0.3]);
        let start = starts(StaggerFrom::Start);
        assert!(start.windows(2).all(|w| w[0] < w[1]), "{start:?}");
        let end = starts(StaggerFrom::End);
        assert!(end.windows(2).all(|w| w[0] > w[1]), "{end:?}");
        close(starts(StaggerFrom::Center), vec![0.1, 0.0, 0.0, 0.1]);
    }

    #[test]
    fn sequence_compiles_to_consecutive_segments() {
        let graph = MotionGraph {
            root: MotionOp::Sequence(vec![MotionOp::Wait { dur: 0.5 }, tween(1.0)]),
        };
        let program = compile(&graph, &CompileCtx::default()).unwrap();
        let track = program.track("opacity").unwrap();
        assert_eq!(track.segments.len(), 1);
        assert_eq!(track.segments[0].t0, 0.5);
        assert_eq!(track.segments[0].t1, 1.5);
        let mut buf = PoseBuffer::identity();
        sample(&program, TargetId::SELF, 1.0, &mut buf);
        assert_eq!(buf.scalar("opacity"), Some(0.5));
    }

    #[test]
    fn at_places_children_on_absolute_time_and_delay_still_shifts_them() {
        let graph = MotionGraph {
            root: MotionOp::At {
                at: 4.0,
                child: Box::new(tween(0.5)),
            },
        };
        let flow = compile_flow(&graph, &CompileCtx::default()).unwrap();
        assert_eq!(flow.tracks[0].frames[0].t, 4.0);

        let graph = MotionGraph {
            root: MotionOp::Delay {
                delay: 0.25,
                child: Box::new(MotionOp::At {
                    at: 4.0,
                    child: Box::new(tween(0.5)),
                }),
            },
        };
        let flow = compile_flow(&graph, &CompileCtx::default()).unwrap();
        assert_eq!(flow.tracks[0].frames[0].t, 4.25);
    }

    #[test]
    fn repeat_unrolls_and_is_independent_of_play_order() {
        let graph = MotionGraph {
            root: MotionOp::Repeat {
                end: RepeatEnd::Count(4),
                mode: RepeatMode::Yoyo,
                child: Box::new(tween_prop("y", -6.0, 6.0, 0.4)),
            },
        };
        let program = compile(&graph, &CompileCtx::default()).unwrap();
        let instants: Vec<f64> = (0..400).map(|i| i as f64 * 0.005).collect();
        let forward: Vec<u64> = instants
            .iter()
            .map(|t| {
                let mut buf = PoseBuffer::identity();
                sample(&program, TargetId::SELF, *t, &mut buf);
                buf.scalar_or("y", 0.0).to_bits()
            })
            .collect();
        let mut backward: Vec<u64> = instants
            .iter()
            .rev()
            .map(|t| {
                let mut buf = PoseBuffer::identity();
                sample(&program, TargetId::SELF, *t, &mut buf);
                buf.scalar_or("y", 0.0).to_bits()
            })
            .collect();
        backward.reverse();
        assert_eq!(forward, backward);
        // yoyo：第二程从 +6 回到 -6
        let track = program.track("y").unwrap();
        assert_eq!(track.segments.len(), 4);
        assert_eq!(track.segments[1].t0, 0.4);
    }

    #[test]
    fn repeat_until_stops_at_the_absolute_deadline() {
        let graph = MotionGraph {
            root: MotionOp::Repeat {
                end: RepeatEnd::Until(1.0),
                mode: RepeatMode::Loop,
                child: Box::new(tween_prop("y", 0.0, 1.0, 0.4)),
            },
        };
        let flow = compile_flow(&graph, &CompileCtx::default()).unwrap();
        // 起点 0.0 / 0.4 / 0.8 三程；1.2 那程起点已过 until
        assert_eq!(flow.tracks[0].frames.len(), 6);
        assert!(flow.tracks[0].frames.iter().all(|f| f.t <= 1.2 + 1e-12));
    }

    #[test]
    fn repeat_rejects_absurd_unroll_counts() {
        let graph = MotionGraph {
            root: MotionOp::Repeat {
                end: RepeatEnd::Count(REPEAT_UNROLL_CAP as u32 + 1),
                mode: RepeatMode::Loop,
                child: Box::new(tween(0.1)),
            },
        };
        assert!(matches!(
            compile(&graph, &CompileCtx::default()),
            Err(MotionError::Unsupported("repeat-too-many"))
        ));
    }

    #[test]
    fn oscillate_frames_reproduce_the_kernel_wave_exactly() {
        let graph = MotionGraph {
            root: MotionOp::Oscillate {
                target: TargetId::SELF,
                property: PropertyId::known("y"),
                amplitude: json!(6.0),
                period: 1.2,
                phase: 0.0,
                wave: WaveKind::Sine,
                dur: 2.4,
                composite: CompositeMode::Add,
            },
        };
        let program = compile(&graph, &CompileCtx::default()).unwrap();
        for step in 0..=240 {
            let t = step as f64 * 0.01;
            let mut buf = PoseBuffer::identity();
            sample(&program, TargetId::SELF, t, &mut buf);
            let expected = if t <= 2.4 {
                6.0 * sampled_wave(WaveKind::Sine, 0, t / 1.2, DEFAULT_WAVE_SAMPLES, None)
            } else {
                6.0 * sampled_wave(WaveKind::Sine, 0, 2.0, DEFAULT_WAVE_SAMPLES, None)
            };
            assert!(
                (buf.scalar_or("y", 0.0) - expected).abs() < 1e-12,
                "t={t} got={} want={expected}",
                buf.scalar_or("y", 0.0)
            );
        }
    }

    #[test]
    fn noise_needs_an_explicit_seed_and_the_same_seed_gives_the_same_output() {
        let noise = |seed: u64| {
            let graph = MotionGraph {
                root: MotionOp::Noise {
                    target: TargetId::SELF,
                    property: PropertyId::known("x"),
                    amplitude: json!(4.0),
                    period: 0.6,
                    seed,
                    channel: 0,
                    lattice: DEFAULT_LATTICE,
                    dur: 1.2,
                    composite: CompositeMode::Add,
                },
            };
            let flow = compile_flow(&graph, &CompileCtx::default()).unwrap();
            flow.tracks[0]
                .frames
                .iter()
                .map(|f| f.v.as_f64().unwrap().to_bits())
                .collect::<Vec<_>>()
        };
        assert_eq!(noise(0), noise(0));
        assert_ne!(noise(0), noise(42));
        // 相位 0 处噪声恒为 0（晶格 0 号顶点被钉住）⇒ add 轨从单位元起步
        assert_eq!(noise(0)[0], 0.0f64.to_bits());
    }

    /// 曲线对象 + 相对长度 → 绝对端点：混出来的仍是单一 `{value, basis, offset}`。
    #[test]
    fn baking_a_curve_object_keeps_relative_lengths_representable() {
        let graph = MotionGraph {
            root: MotionOp::Tween {
                target: TargetId::SELF,
                property: PropertyId::known("y"),
                from: json!({"value": 0.05, "basis": "canvasShortEdge"}),
                to: json!(0),
                dur: 0.5,
                curve: CurveSpec::Spring {
                    response: 0.45,
                    damping: 0.82,
                },
                composite: CompositeMode::Add,
                interpolator: InterpolatorSpec::Linear,
            },
        };
        let flow = compile_flow(&graph, &CompileCtx::default()).unwrap();
        let frames = &flow.tracks[0].frames;
        assert_eq!(frames[0].v["value"], json!(0.05));
        assert_eq!(frames[0].v["basis"], json!("canvasShortEdge"));
        assert_eq!(frames.last().unwrap().v["value"], json!(0.0));
        // 每一帧仍是一个可求值的相对长度对象
        for frame in frames {
            assert!(frame.v.get("basis").is_some(), "{:?}", frame.v);
        }
        // 两条不同的非绝对基准混不出单一对象 ⇒ 报错而不是猜
        let graph = MotionGraph {
            root: MotionOp::Tween {
                target: TargetId::SELF,
                property: PropertyId::known("y"),
                from: json!({"value": 0.05, "basis": "canvasShortEdge"}),
                to: json!({"value": 0.02, "basis": "canvasWidth"}),
                dur: 0.5,
                curve: CurveSpec::Spring {
                    response: 0.45,
                    damping: 0.82,
                },
                composite: CompositeMode::Add,
                interpolator: InterpolatorSpec::Linear,
            },
        };
        assert!(matches!(
            compile_flow(&graph, &CompileCtx::default()),
            Err(MotionError::Unsupported("curve-object-mixes-two-bases"))
        ));
    }

    #[test]
    fn amplitudes_may_be_relative_lengths() {
        let scaled =
            scale_amplitude(&json!({"value": 0.01, "basis": "canvasShortEdge"}), -0.5).unwrap();
        assert_eq!(scaled["value"], json!(-0.005));
        assert_eq!(scaled["basis"], json!("canvasShortEdge"));
    }

    #[test]
    fn curve_objects_are_baked_onto_the_fps_grid() {
        let graph = MotionGraph {
            root: MotionOp::Tween {
                target: TargetId::SELF,
                property: PropertyId::known("y"),
                from: json!(40.0),
                to: json!(0.0),
                dur: 0.5,
                curve: CurveSpec::Spring {
                    response: 0.45,
                    damping: 0.82,
                },
                composite: CompositeMode::Add,
                interpolator: InterpolatorSpec::Linear,
            },
        };
        let flow = compile_flow(&graph, &CompileCtx::default()).unwrap();
        assert_eq!(flow.tracks[0].frames.len(), 31); // 0.5s × 60fps + 1
        assert!(flow.tracks[0].frames.iter().all(|f| f.ease.is_none()));
        assert_eq!(flow.tracks[0].frames[0].v, json!(40.0));
        assert_eq!(flow.tracks[0].frames[30].v, json!(0.0));
    }

    /// 设计 §13：Graph op 变体预算。穷举 `match` 让「加一个变体」编译不过。
    #[test]
    fn motion_op_variant_budget_is_respected() {
        fn name(op: &MotionOp) -> &'static str {
            match op {
                MotionOp::Set { .. } => "set",
                MotionOp::Wait { .. } => "wait",
                MotionOp::Tween { .. } => "tween",
                MotionOp::Preset { .. } => "preset",
                MotionOp::Parallel(_) => "parallel",
                MotionOp::Sequence(_) => "sequence",
                MotionOp::Stagger { .. } => "stagger",
                MotionOp::Delay { .. } => "delay",
                MotionOp::Repeat { .. } => "repeat",
                MotionOp::Oscillate { .. } => "oscillate",
                MotionOp::Noise { .. } => "noise",
                MotionOp::At { .. } => "at",
            }
        }
        assert_eq!(name(&tween(0.1)), "tween");
    }
}
