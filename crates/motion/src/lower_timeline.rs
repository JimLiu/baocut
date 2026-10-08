//! Timeline 0.1 动画槽 → `MotionProgram`（设计 §5.7）。
//!
//! 这里的每一个表达式形状都必须与 `bcut-timeline/src/motion.rs` 的旧实现逐位一致，
//! `core/fixtures/motion/` 的阶段 0 golden 是硬门。关键取舍见计划 §2.1–§2.10，
//! 逐条在下面的注释里标了出处。

use std::ops::Range;

use crate::composite::{CompositeMode, PoseBuffer, PostOp};
use crate::curve::{CurveSpec, EaseId, sample_curve};
use crate::interpolate::{InterpolatorSpec, mix};
use crate::loop_kernel::{ChannelKey, LoopKernel, channel_ordinal, sample_keyframes};
use crate::preset_registry::{
    LoopRecipe, Slot, SlotKeyframe, SlotRecipe, timeline_enter, timeline_exit, timeline_loop,
};
use crate::program::{
    Fill, LoopKernelRef, MotionProgram, MotionSegment, PartPlan, PresetRef, PropertyTrack,
    SegmentKind, TargetId, TimeBase,
};
use crate::relative_value::LengthBasis;
use crate::text_parts::{
    CASCADE_SPREAD_CAP, PART_DURATION_FLOOR, PartUnit, split_animation_parts, stagger_order,
};
use crate::value::{MotionValue, PropertyId};

/// `AnimationSlot` 的借用视图。`bcut-motion` 因此不依赖 `bcut-timeline::schema`
/// （依赖方向 `bcut-timeline → bcut-motion`，ADR-M01）。
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SlotInput<'a> {
    pub preset: &'a str,
    pub preset_version: Option<u32>,
    pub dur: Option<f64>,
    pub delay: Option<f64>,
    pub intensity: Option<f64>,
    pub ease: Option<&'a str>,
    pub stagger: Option<f64>,
    pub stagger_from: Option<&'a str>,
    pub period: Option<f64>,
    pub phase: Option<f64>,
    pub seed: Option<u64>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AnimationInput<'a> {
    pub enter: Option<SlotInput<'a>>,
    pub exit: Option<SlotInput<'a>>,
    pub r#loop: Option<SlotInput<'a>>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Window {
    pub start: f64,
    pub end: Option<f64>,
    pub project_end: f64,
}

/// 元素自身尺寸，单位是**画布短边的倍数**（与 pose 的 `dx`/`dy` 同一坐标系）。
/// 配方 `basis` 为 `selfWidth` / `selfHeight` 时（元素动画：x:1 = 一个元素宽），
/// lowering 用它把位移换算成短边比例；调用方不给（`None`）时按 1 短边近似
/// （2026-09-08 起 `bcut-timeline::resolve_animation_pose` 仍走这条近似，见台账）。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ElementExtent {
    pub width: f64,
    pub height: f64,
}

fn translate_factor(basis: LengthBasis, extent: Option<ElementExtent>) -> f64 {
    match basis {
        LengthBasis::SelfWidth => extent.map_or(1.0, |e| e.width),
        LengthBasis::SelfHeight => extent.map_or(1.0, |e| e.height),
        _ => 1.0,
    }
}

/// 通道 identity 表（`AnimationPose::IDENTITY`）。`reveal` 不在里面：它是 optional 轨。
const POSE_CHANNELS: &[(&str, f64)] = &[
    ("opacity", 1.0),
    ("dx", 0.0),
    ("dy", 0.0),
    ("scaleX", 1.0),
    ("scaleY", 1.0),
    ("rotation", 0.0),
    ("blur", 0.0),
];

const REVEAL_IDENTITY: f64 = 1.0;

/// `motion.rs:408-410`。
pub fn slot_duration(slot: &SlotInput<'_>, recipe: &SlotRecipe) -> f64 {
    slot.dur.unwrap_or(recipe.duration).max(0.0)
}

/// `motion.rs:412-442`。四个容易丢的细节：
/// 1. 显式 `exit.preset == "none"` 阻断推导，返回 `None`；
/// 2. 显式 exit 的 preset 在 **exit 表**里没有配方（`drop`/`pop`/`blurIn`/
///    `typewriter`/`riseWords`/`bounce`）时同样是 `None`——完全没有退场；
/// 3. 推导出的 `dur` 取 **enter 的有效时长** × 0.75，不是 enter 配方的缺省时长；
/// 4. `delay: Some(0.0)`、`ease: None`（用户的入场 ease 被有意丢弃），
///    `stagger`/`staggerFrom`/`period`/`phase` 全为 `None`，
///    `intensity`/`seed`/`presetVersion` 继承。
pub fn effective_exit<'a>(
    animation: &AnimationInput<'a>,
) -> Option<(SlotInput<'a>, &'static SlotRecipe)> {
    if let Some(slot) = animation.exit {
        if slot.preset == "none" {
            return None;
        }
        return timeline_exit(slot.preset).map(|recipe| (slot, recipe));
    }
    let enter = animation.enter?;
    if enter.preset == "none" {
        return None;
    }
    let enter_recipe = timeline_enter(enter.preset)?;
    let mirror = enter_recipe.mirror.as_deref()?;
    let recipe = timeline_exit(mirror)?;
    Some((
        SlotInput {
            preset: mirror,
            preset_version: enter.preset_version,
            dur: Some(slot_duration(&enter, enter_recipe) * 0.75),
            delay: Some(0.0),
            intensity: enter.intensity,
            ease: None,
            stagger: None,
            stagger_from: None,
            period: None,
            phase: None,
            seed: enter.seed,
        },
        recipe,
    ))
}

/// 一个 enter/exit 槽编译出来的逐通道 tween。段布局（`MotionProgram`）与文字
/// 级联（逐 part 进度）共用它，两条路径因此不可能算出不同的 double。
#[derive(Clone, Debug, PartialEq)]
pub struct SlotTween {
    pub atoms: Vec<TweenAtom>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TweenAtom {
    pub property: PropertyId,
    pub identity: f64,
    pub from: MotionValue,
    pub to: MotionValue,
    pub curve: CurveSpec,
    pub post: PostOp,
    pub optional: bool,
    /// 多关键帧链（2026-09-08）。非空时 `from`/`to`/`curve` 只是首尾摘要，
    /// 求值按相邻关键帧逐段 tween（段缓动 = 段末帧 curve）；冻结配方此表恒空。
    pub keys: Vec<ChannelKey>,
}

impl TweenAtom {
    fn value_at(&self, progress: f64) -> MotionValue {
        if !self.keys.is_empty() {
            let raw = sample_keyframes(&self.keys, progress.clamp(0.0, 1.0));
            return MotionValue::Scalar(self.post.apply(raw));
        }
        let eased = sample_curve(&self.curve, progress);
        let raw = mix(&self.from, &self.to, eased, InterpolatorSpec::Linear);
        match raw.as_f64() {
            Some(n) => raw.with_scalar(self.post.apply(n)),
            None => raw,
        }
    }
}

impl SlotTween {
    /// 直接把某个进度的整套 pose 写进 `out`（文字级联逐 part 用）。
    pub fn write_into(&self, out: &mut PoseBuffer, progress: f64) {
        for atom in &self.atoms {
            out.write(
                &atom.property,
                atom.value_at(progress),
                CompositeMode::Replace,
                0,
                PostOp::for_property(atom.property.as_str()),
            );
        }
    }
}

/// `motion.rs:783-841`。
///
/// - `intensity <= 0.0` 返回 `None` = **整套 IDENTITY**，包括 `reveal: None`
///   （计划 §2.3）：逐通道展开会让 `wipe` 得到 `reveal = Some(1.0)`，
///   那是可观测的差异（CLI 的 reveal pass 与 GPUI 的 `is_identity` 分支）。
/// - 曲线按通道分配：`opacity → opacity_curve`、`blur`/`reveal → safe_curve`、
///   其余 → `curve`（计划 §2.7）。
pub fn compile_slot_tween(
    slot: &SlotInput<'_>,
    recipe: &SlotRecipe,
    entering: bool,
) -> Option<SlotTween> {
    compile_slot_tween_with(slot, recipe, entering, None)
}

/// [`compile_slot_tween`] 加元素尺寸：只影响 `basis` 为 `selfWidth`/`selfHeight`
/// 的配方（冻结目录全是 `canvasShortEdge`，结果逐位不变）。
pub fn compile_slot_tween_with(
    slot: &SlotInput<'_>,
    recipe: &SlotRecipe,
    entering: bool,
    extent: Option<ElementExtent>,
) -> Option<SlotTween> {
    let intensity = slot.intensity.unwrap_or(1.0).clamp(0.0, 2.0);
    if intensity <= 0.0 {
        return None;
    }
    if !recipe.keyframes.is_empty() {
        return Some(compile_keyframe_tween(
            slot, recipe, entering, intensity, extent,
        ));
    }
    let curve = slot
        .ease
        .map(CurveSpec::from_name)
        .unwrap_or_else(|| recipe.curve.clone());
    let safe_curve = if crate::curve::curve_overshoots(&curve) {
        CurveSpec::Named(if entering {
            EaseId::EaseOutCubic
        } else {
            EaseId::EaseInCubic
        })
    } else {
        curve.clone()
    };
    // 注意 `unwrap_or(curve)`：配方没有 opacityCurve 时回落到**用户覆盖过的**曲线。
    let opacity_curve = recipe
        .opacity_curve
        .clone()
        .unwrap_or_else(|| curve.clone());
    let opacity_curve = if crate::curve::curve_overshoots(&opacity_curve) {
        safe_curve.clone()
    } else {
        opacity_curve
    };

    // 配方没声明的通道，`far == identity`，采样结果恒等于 base，因此不发轨。
    // 唯一例外是 NaN intensity：旧实现会让**每个**通道变成 NaN
    // （`identity + 0.0 * NaN`），保留这个分支才是逐位一致。
    let emit_all = !intensity.is_finite();
    let mut atoms = Vec::new();
    for (channel, identity) in POSE_CHANNELS {
        let declared = recipe.from.get(channel);
        if declared.is_none() && !emit_all {
            continue;
        }
        let channel_curve = match *channel {
            "opacity" => opacity_curve.clone(),
            "blur" => safe_curve.clone(),
            _ => curve.clone(),
        };
        // far = identity + (from - identity) * intensity（`motion.rs:817`）
        let far = identity + (declared.unwrap_or(*identity) - identity) * intensity;
        let (from, to) = if entering {
            (far, *identity)
        } else {
            (*identity, far)
        };
        atoms.push(TweenAtom {
            property: PropertyId::parse(channel),
            identity: *identity,
            from: MotionValue::Scalar(from),
            to: MotionValue::Scalar(to),
            curve: channel_curve,
            post: PostOp::for_property(channel),
            optional: false,
            keys: Vec::new(),
        });
    }
    if let Some(declared) = recipe.from.reveal {
        let far = REVEAL_IDENTITY + (declared - REVEAL_IDENTITY) * intensity;
        let (from, to) = if entering {
            (far, REVEAL_IDENTITY)
        } else {
            (REVEAL_IDENTITY, far)
        };
        atoms.push(TweenAtom {
            property: PropertyId::known("reveal"),
            identity: REVEAL_IDENTITY,
            from: MotionValue::Scalar(from),
            to: MotionValue::Scalar(to),
            curve: safe_curve,
            post: PostOp::None,
            optional: true,
            keys: Vec::new(),
        });
    }
    Some(SlotTween { atoms })
}

/// 多关键帧配方（元素动画）的编译：
///
/// - 每通道一条 [`TweenAtom`]，`keys[i].value = identity + (v_i − identity)·intensity`，
///   关键帧没写的通道取 identity；`dx`/`dy` 先按配方 `basis` 换算成短边比例。
/// - `keys[i].curve` 是**到达第 i 帧**那一段的缓动。
///   用户 `ease` 覆盖时整条链都用它；`opacity`/`blur`/`reveal` 遇到过冲曲线降级
///   （与两点式同一条规则）。
/// - 关键帧按配方自己的槽方向书写。`entering` 与 `recipe.slot` 不一致（镜像回落）
///   时把链倒过来：`at' = 1 − at`，段缓动随段走。
/// - NaN intensity 与两点式一样让每个通道都发轨（`identity + 0·NaN`）。
fn compile_keyframe_tween(
    slot: &SlotInput<'_>,
    recipe: &SlotRecipe,
    entering: bool,
    intensity: f64,
    extent: Option<ElementExtent>,
) -> SlotTween {
    let user_curve = slot.ease.map(CurveSpec::from_name);
    let safe = CurveSpec::Named(if entering {
        EaseId::EaseOutCubic
    } else {
        EaseId::EaseInCubic
    });
    let emit_all = !intensity.is_finite();
    let forward = entering == (recipe.slot == Slot::Enter);
    let frames: Vec<&SlotKeyframe> = if forward {
        recipe.keyframes.iter().collect()
    } else {
        recipe.keyframes.iter().rev().collect()
    };
    let curve_for = |index: usize, channel: &str| -> CurveSpec {
        // 正向：段 [k_{i-1}, k_i] 用 k_i.curve；反向后第 m 帧对应原第 n−m 帧，
        // 段 [r_{m-1}, r_m] 是原 [k_{n−m}, k_{n−m+1}]，缓动是 k_{n−m+1}.curve。
        let curve = match user_curve.as_ref() {
            Some(curve) => curve.clone(),
            None if index == 0 => CurveSpec::from_name("linear"),
            None if forward => frames[index].curve.clone(),
            None => frames[index - 1].curve.clone(),
        };
        if matches!(channel, "opacity" | "blur" | "reveal")
            && crate::curve::curve_overshoots(&curve)
        {
            safe.clone()
        } else {
            curve
        }
    };
    let at_of = |index: usize| -> f64 {
        if forward {
            frames[index].at
        } else {
            1.0 - frames[index].at
        }
    };
    let build = |channel: &str, identity: f64, factor: f64| -> Vec<ChannelKey> {
        frames
            .iter()
            .enumerate()
            .map(|(index, frame)| {
                let declared = frame.channels.get(channel).unwrap_or(identity);
                let value = identity + (declared * factor - identity * factor) * intensity;
                ChannelKey {
                    at: at_of(index),
                    value,
                    curve: curve_for(index, channel),
                }
            })
            .collect()
    };
    let declares = |channel: &str| frames.iter().any(|f| f.channels.get(channel).is_some());

    let mut atoms = Vec::new();
    for (channel, identity) in POSE_CHANNELS {
        if !declares(channel) && !emit_all {
            continue;
        }
        let factor = match *channel {
            "dx" => translate_factor(recipe.basis.dx, extent),
            "dy" => translate_factor(recipe.basis.dy, extent),
            _ => 1.0,
        };
        let keys = build(channel, *identity, factor);
        atoms.push(TweenAtom {
            property: PropertyId::parse(channel),
            identity: *identity,
            from: MotionValue::Scalar(keys[0].value),
            to: MotionValue::Scalar(keys[keys.len() - 1].value),
            curve: keys[keys.len() - 1].curve.clone(),
            post: PostOp::for_property(channel),
            optional: false,
            keys,
        });
    }
    if declares("reveal") {
        let keys = build("reveal", REVEAL_IDENTITY, 1.0);
        atoms.push(TweenAtom {
            property: PropertyId::known("reveal"),
            identity: REVEAL_IDENTITY,
            from: MotionValue::Scalar(keys[0].value),
            to: MotionValue::Scalar(keys[keys.len() - 1].value),
            curve: keys[keys.len() - 1].curve.clone(),
            post: PostOp::None,
            optional: true,
            keys,
        });
    }
    SlotTween { atoms }
}

/// `motion.rs:893-976` 的编译期部分。返回逐通道内核；空 = 该刻恒等。
fn compile_loop_kernels(
    slot: &SlotInput<'_>,
    recipe: &LoopRecipe,
    extent: Option<ElementExtent>,
) -> Vec<(PropertyId, LoopKernel)> {
    let period = slot.period.unwrap_or(recipe.period);
    if period <= 0.0 {
        return Vec::new();
    }
    let intensity = slot.intensity.unwrap_or(1.0).clamp(0.0, 2.0);
    let seed = slot.seed.unwrap_or(recipe.default_seed);
    let phase_offset = slot.phase.unwrap_or(0.0);
    let emit_all = !intensity.is_finite();
    let mut kernels = Vec::new();
    if !recipe.keyframes.is_empty() {
        // 关键帧循环：逐通道把关键帧折算成 `identity + (v − identity)·intensity`，
        // 不走波形、没有 seed/包络（周期内精确插值，关键帧处逐位等于声明值）。
        for (channel, identity) in POSE_CHANNELS {
            let Some(ordinal) = channel_ordinal(channel) else {
                continue;
            };
            let declared = recipe
                .keyframes
                .iter()
                .any(|frame| frame.channels.get(channel).is_some());
            if !declared && !emit_all {
                continue;
            }
            let factor = match *channel {
                "dx" => translate_factor(recipe.basis.dx, extent),
                "dy" => translate_factor(recipe.basis.dy, extent),
                _ => 1.0,
            };
            let keyframes = recipe
                .keyframes
                .iter()
                .map(|frame| {
                    let value = frame.channels.get(channel).unwrap_or(*identity);
                    ChannelKey {
                        at: frame.at,
                        value: identity + (value * factor - identity * factor) * intensity,
                        curve: frame.curve.clone(),
                    }
                })
                .collect();
            kernels.push((
                PropertyId::parse(channel),
                LoopKernel {
                    wave: recipe.wave,
                    wave_samples: recipe.wave_samples,
                    noise: None,
                    amplitude: 0.0,
                    channel_ordinal: ordinal,
                    channel_seed_stride: 0,
                    seed,
                    period,
                    phase_offset,
                    envelope: crate::loop_kernel::EnvelopeSpec::NONE,
                    identity: *identity,
                    post: PostOp::for_property(channel),
                    keyframes,
                },
            ));
        }
        return kernels;
    }
    for (channel, identity) in POSE_CHANNELS {
        let Some(ordinal) = channel_ordinal(channel) else {
            continue; // blur 不参与循环（`motion.rs:958`）
        };
        let declared = recipe.amplitudes.get(channel);
        if declared.is_none() && !emit_all {
            continue;
        }
        // amp * intensity 先乘，与 `motion.rs:952-957` 的左结合顺序一致。
        let amplitude = declared.unwrap_or(0.0) * intensity;
        kernels.push((
            PropertyId::parse(channel),
            LoopKernel {
                wave: recipe.wave,
                wave_samples: recipe.wave_samples,
                noise: recipe.noise,
                amplitude,
                channel_ordinal: ordinal,
                channel_seed_stride: recipe.channel_seed_stride,
                seed,
                period,
                phase_offset,
                envelope: recipe.envelope,
                identity: *identity,
                post: PostOp::for_property(channel),
                keyframes: Vec::new(),
            },
        ));
    }
    kernels
}

#[derive(Clone, Debug, PartialEq)]
pub struct TimelineProgram {
    pub lifetime: f64,
    /// `TimeBase::ElementLocal`：窗口全部相对 `start`（计划 §2.1）。
    pub program: MotionProgram,
}

struct TrackBuilder {
    tracks: Vec<PropertyTrack>,
}

impl TrackBuilder {
    fn new() -> Self {
        Self { tracks: Vec::new() }
    }

    fn push(
        &mut self,
        property: &PropertyId,
        identity: f64,
        post: PostOp,
        optional: bool,
        segment: MotionSegment,
    ) {
        if let Some(track) = self
            .tracks
            .iter_mut()
            .find(|track| &track.property == property)
        {
            track.segments.push(segment);
            return;
        }
        self.tracks.push(PropertyTrack {
            target: TargetId::SELF,
            property: property.clone(),
            // Timeline 0.1 每属性恰好一条 Replace 轨（ADR-M08 冻结）：enter / loop /
            // exit 三段推进同一条轨且时间互斥，`effective_exit` 的镜像也不例外。
            composite: CompositeMode::Replace,
            order: 0,
            base: MotionValue::Scalar(identity),
            post,
            optional,
            segments: vec![segment],
        });
    }
}

fn tween_segment(atom: &TweenAtom, t0: f64, t1: f64, before: Fill, after: Fill) -> MotionSegment {
    MotionSegment {
        t0,
        t1,
        fill_before: before,
        fill_after: after,
        composite: CompositeMode::Replace,
        order: 0,
        kind: SegmentKind::Tween {
            from: atom.from.clone(),
            to: atom.to.clone(),
            curve: atom.curve.clone(),
            interpolator: InterpolatorSpec::Linear,
        },
    }
}

/// 一个 atom 在 `[t0, t1]` 上的段列表：两点式恰好一段（逐位等于 [`tween_segment`]）；
/// 关键帧链按 `at` 切成首尾相接的子窗口，每段 `[t0 + at_i·dur, t0 + at_{i+1}·dur]`
/// 用第 i+1 帧的缓动。填充：首段继承槽的 `before`、末段继承 `after`，中段 Off/Off
/// （相邻段共享端点，`[t0, t1)` 语义下不重叠）。零长段跳过，填充顺延。
fn chain_segments(
    atom: &TweenAtom,
    t0: f64,
    t1: f64,
    before: Fill,
    after: Fill,
) -> Vec<MotionSegment> {
    if atom.keys.len() < 2 {
        return vec![tween_segment(atom, t0, t1, before, after)];
    }
    let duration = t1 - t0;
    let mut segments: Vec<MotionSegment> = Vec::with_capacity(atom.keys.len() - 1);
    for pair in atom.keys.windows(2) {
        let (from, to) = (&pair[0], &pair[1]);
        let begin = t0 + from.at * duration;
        let end = t0 + to.at * duration;
        if end <= begin && atom.keys.len() > 2 {
            continue;
        }
        segments.push(MotionSegment {
            t0: begin,
            t1: end,
            fill_before: Fill::Off,
            fill_after: Fill::Off,
            composite: CompositeMode::Replace,
            order: 0,
            kind: SegmentKind::Tween {
                from: MotionValue::Scalar(from.value),
                to: MotionValue::Scalar(to.value),
                curve: to.curve.clone(),
                interpolator: InterpolatorSpec::Linear,
            },
        });
    }
    if segments.is_empty() {
        return vec![tween_segment(atom, t0, t1, before, after)];
    }
    segments[0].fill_before = before;
    let last = segments.len() - 1;
    segments[last].fill_after = after;
    segments
}

/// `motion.rs:500-567` 的编译期部分。`None` = lifetime 非法 → 调用方返回 IDENTITY。
pub fn lower_timeline_animation(
    animation: &AnimationInput<'_>,
    win: Window,
) -> Option<TimelineProgram> {
    lower_timeline_animation_with(animation, win, None)
}

/// [`lower_timeline_animation`] 加元素尺寸（见 [`ElementExtent`]）。冻结目录的
/// 配方不读 `extent`，两条入口对它们逐位一致。
pub fn lower_timeline_animation_with(
    animation: &AnimationInput<'_>,
    win: Window,
    extent: Option<ElementExtent>,
) -> Option<TimelineProgram> {
    let end = win.end.unwrap_or(win.project_end);
    let lifetime = end - win.start;
    if !lifetime.is_finite() || lifetime <= 0.0 {
        return None;
    }
    let half = lifetime * 0.5;

    let enter_window = animation.enter.and_then(|slot| {
        if slot.preset == "none" {
            return None;
        }
        let recipe = timeline_enter(slot.preset)?;
        let duration = slot_duration(&slot, recipe).min(half);
        let delay = slot
            .delay
            .unwrap_or(0.0)
            .max(0.0)
            .min((half - duration).max(0.0));
        Some((delay, delay + duration, slot, recipe))
    });
    let exit = effective_exit(animation);
    let exit_window = exit.as_ref().map(|(slot, recipe)| {
        let duration = slot_duration(slot, recipe).min(half);
        let delay = slot
            .delay
            .unwrap_or(0.0)
            .max(0.0)
            .min((half - duration).max(0.0));
        (lifetime - delay - duration, lifetime - delay)
    });
    let idle_begin = enter_window.map_or(0.0, |(_, finish, _, _)| finish);
    let idle_end = exit_window.map_or(lifetime, |(begin, _)| begin);

    let mut builder = TrackBuilder::new();
    let mut program = MotionProgram::new(TimeBase::ElementLocal);

    // ① 入场：`[begin, finish)`，左侧 Hold（`local < begin` 时进度夹到 0），
    //    右侧 Off（`local >= finish` 交给 loop / exit / identity）。
    if let Some((begin, finish, slot, recipe)) = enter_window {
        program.sources.push(PresetRef {
            id: format!("timeline.enter.{}", recipe.id),
            version: recipe.version,
            manifest_hash: recipe.manifest_hash,
        });
        if let Some(tween) = compile_slot_tween_with(&slot, recipe, true, extent) {
            for atom in &tween.atoms {
                for segment in chain_segments(atom, begin, finish, Fill::Hold, Fill::Off) {
                    builder.push(
                        &atom.property,
                        atom.identity,
                        atom.post,
                        atom.optional,
                        segment,
                    );
                }
            }
        }
    }

    // ② idle 循环：`[idle_begin, idle_end]`。右端点只在**没有退场**时由 fill_after
    //    覆盖——退场缺席时 `idle_end == lifetime`，而 `local == lifetime` 仍走循环
    //    分支（`motion.rs:566`）。有退场时必须是 Off：退场配方可能不驱动某条通道
    //    （`fade` 只动 opacity），那条通道上循环段就是最后一段，Hold 会把循环值
    //    一直拖到元素末尾。
    if let Some(slot) = animation.r#loop.filter(|slot| slot.preset != "none")
        && idle_end > idle_begin
        && let Some(recipe) = timeline_loop(slot.preset)
    {
        program.sources.push(PresetRef {
            id: format!("timeline.loop.{}", recipe.id),
            version: recipe.version,
            manifest_hash: recipe.manifest_hash,
        });
        for (property, kernel) in compile_loop_kernels(&slot, recipe, extent) {
            let identity = kernel.identity;
            let post = kernel.post;
            let index = program.loop_kernels.len();
            program.loop_kernels.push(kernel);
            builder.push(
                &property,
                identity,
                post,
                false,
                MotionSegment {
                    t0: idle_begin,
                    t1: idle_end,
                    fill_before: Fill::Off,
                    fill_after: if exit_window.is_some() {
                        Fill::Off
                    } else {
                        Fill::Hold
                    },
                    composite: CompositeMode::Replace,
                    order: 0,
                    kind: SegmentKind::Loop(LoopKernelRef(index)),
                },
            );
        }
    }

    // ③ 退场：`[begin, finish]`，右侧 Hold（`local > finish` 时进度夹到 1）。
    if let (Some((slot, recipe)), Some((begin, finish))) = (exit.as_ref(), exit_window) {
        program.sources.push(PresetRef {
            id: format!("timeline.exit.{}", recipe.id),
            version: recipe.version,
            manifest_hash: recipe.manifest_hash,
        });
        if let Some(tween) = compile_slot_tween_with(slot, recipe, false, extent) {
            for atom in &tween.atoms {
                for segment in chain_segments(atom, begin, finish, Fill::Off, Fill::Hold) {
                    builder.push(
                        &atom.property,
                        atom.identity,
                        atom.post,
                        atom.optional,
                        segment,
                    );
                }
            }
        }
    }

    program.property_tracks = builder.tracks;
    Some(TimelineProgram { lifetime, program })
}

/// 文字级联的 lowering 结果。三个出口与 `motion.rs:574-678` 的三条回落一一对应。
#[derive(Clone, Debug, PartialEq)]
pub enum TextLowering {
    /// 回落到 `resolve_animation_pose`（整容器）。
    Container,
    /// 回落到 `AnimationPose::IDENTITY`。
    Identity,
    Cascade(TextCascade),
}

#[derive(Clone, Debug, PartialEq)]
pub struct TextCascade {
    pub unit: PartUnit,
    pub ranges: Vec<Range<usize>>,
    pub lifetime: f64,
    /// 级联结束时刻（元素局部时间）；`local >= finish` 时回落到容器。
    pub finish: f64,
    pub plan: PartPlan,
    /// `None` = `intensity <= 0`，逐 part 恒等。
    pub tween: Option<SlotTween>,
}

/// `motion.rs:574-678` 的编译期部分。
pub fn lower_timeline_text(
    animation: &AnimationInput<'_>,
    win: Window,
    display_text: &str,
) -> TextLowering {
    let Some(slot) = animation.enter else {
        return TextLowering::Container;
    };
    let Some(plan) = crate::text_parts::stagger_plan(slot.preset) else {
        return TextLowering::Container;
    };
    let ranges = split_animation_parts(display_text, plan.unit);
    if ranges.len() <= 1 {
        return TextLowering::Container;
    }
    let end = win.end.unwrap_or(win.project_end);
    let lifetime = end - win.start;
    let Some(recipe) = timeline_enter(slot.preset) else {
        return TextLowering::Identity;
    };
    if !lifetime.is_finite() || lifetime <= 0.0 {
        return TextLowering::Identity;
    }
    let duration = slot_duration(&slot, recipe).min(lifetime * 0.5);
    let delay = slot
        .delay
        .unwrap_or(0.0)
        .max(0.0)
        .min((lifetime * 0.5 - duration).max(0.0));
    let finish = delay + duration;
    let count = ranges.len();
    // `0.5`（级联总跨度上限）与 `0.01`（part 时长下限）是内核策略常量，
    // 每个级联配方共用；只有 `partDur`/`stagger`/`unit` 是配方数据（计划 §2.10）。
    let part_duration = plan
        .part_dur
        .max(PART_DURATION_FLOOR)
        .min(duration.max(0.0));
    let room = (duration - part_duration).max(0.0);
    let stagger = slot
        .stagger
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(plan.stagger);
    let spread = ((count - 1) as f64 * stagger)
        .min(CASCADE_SPREAD_CAP)
        .min(room);
    let step = spread / (count - 1) as f64;
    let orders = (0..count)
        .map(|index| stagger_order(index, count, slot.stagger_from))
        .collect();
    TextLowering::Cascade(TextCascade {
        unit: plan.unit,
        ranges,
        lifetime,
        finish,
        plan: PartPlan {
            unit: plan.unit,
            count,
            delay,
            part_duration,
            step,
            orders,
        },
        tween: compile_slot_tween(&slot, recipe, true),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::program::TargetId;
    use crate::sample::{quantize_time, sample};

    fn slot(preset: &str) -> SlotInput<'_> {
        SlotInput {
            preset,
            preset_version: Some(1),
            ..SlotInput::default()
        }
    }

    fn pose(animation: &AnimationInput<'_>, win: Window, time: f64, fps: f64) -> PoseBuffer {
        let mut buf = PoseBuffer::identity();
        let Some(lowered) = lower_timeline_animation(animation, win) else {
            return buf;
        };
        let local = (quantize_time(time, fps) - win.start).clamp(0.0, lowered.lifetime);
        sample(&lowered.program, TargetId::SELF, local, &mut buf);
        buf
    }

    /// ADR-M08 冻结守卫：Timeline 0.1 的全部配方组合都必须落成
    /// **每属性恰好一条 `Replace` 轨**。新 family 的 add / multiply 不得渗进这里，
    /// 否则「旧项目像素不变」立刻失守。
    #[test]
    fn every_timeline_program_stays_single_replace_per_property() {
        let enters = crate::preset_registry::ids(crate::preset_registry::Domain::TimelineEnter);
        let exits = crate::preset_registry::ids(crate::preset_registry::Domain::TimelineExit);
        let loops = crate::preset_registry::ids(crate::preset_registry::Domain::TimelineLoop);
        let win = Window {
            start: 0.0,
            end: Some(6.0),
            project_end: 6.0,
        };
        for enter in &enters {
            for exit in exits.iter().map(Some).chain(std::iter::once(None)) {
                for lp in loops.iter().map(Some).chain(std::iter::once(None)) {
                    let animation = AnimationInput {
                        enter: Some(slot(enter)),
                        exit: exit.map(|id| slot(id)),
                        r#loop: lp.map(|id| slot(id)),
                    };
                    let Some(lowered) = lower_timeline_animation(&animation, win) else {
                        continue;
                    };
                    let mut seen: Vec<&str> = Vec::new();
                    for track in &lowered.program.property_tracks {
                        assert_eq!(
                            track.composite,
                            CompositeMode::Replace,
                            "{enter}/{exit:?}/{lp:?} {}",
                            track.property
                        );
                        assert_eq!(track.order, 0, "{}", track.property);
                        track.assert_segments_agree();
                        assert!(
                            !seen.contains(&track.property.as_str()),
                            "{enter}/{exit:?}/{lp:?}: {} 出现了第二条轨",
                            track.property
                        );
                        seen.push(track.property.as_str());
                    }
                    assert!(
                        lowered.program.replace_overlaps().is_empty(),
                        "{enter}/{exit:?}/{lp:?}: 段在时间上交叠了"
                    );
                }
            }
        }
    }

    #[test]
    fn enter_and_exit_windows_never_overlap() {
        // 计划 §2.4 的性质测试：确定性伪随机遍历。
        let mut state = 0x2545_F491_4F6C_DD1Du64;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 11) as f64 / (1u64 << 53) as f64
        };
        for _ in 0..2000 {
            let lifetime = 0.01 + next() * 10.0;
            let half = lifetime * 0.5;
            let enter_dur = (next() * 3.0).min(half);
            let enter_delay = (next() * 3.0).max(0.0).min((half - enter_dur).max(0.0));
            let exit_dur = (next() * 3.0).min(half);
            let exit_delay = (next() * 3.0).max(0.0).min((half - exit_dur).max(0.0));
            let finish = enter_delay + enter_dur;
            let begin = lifetime - exit_delay - exit_dur;
            assert!(finish <= half + 1e-12, "{finish} > {half}");
            assert!(begin >= half - 1e-12, "{begin} < {half}");
            assert!(finish <= begin + 1e-12, "{finish} > {begin}");
        }
    }

    #[test]
    fn zero_intensity_returns_the_whole_identity_pose_including_reveal() {
        let mut enter = slot("wipe");
        enter.intensity = Some(0.0);
        let animation = AnimationInput {
            enter: Some(enter),
            exit: Some(slot("none")),
            r#loop: None,
        };
        let win = Window {
            start: 0.0,
            end: Some(2.0),
            project_end: 2.0,
        };
        let buf = pose(&animation, win, 0.1, 60.0);
        assert_eq!(buf.scalar("reveal"), None);
        assert_eq!(buf.scalar_or("opacity", 1.0), 1.0);
    }

    #[test]
    fn wipe_at_full_intensity_drives_reveal_only_during_the_entrance() {
        let animation = AnimationInput {
            enter: Some(slot("wipe")),
            exit: Some(slot("none")),
            r#loop: None,
        };
        let win = Window {
            start: 0.0,
            end: Some(4.0),
            project_end: 4.0,
        };
        assert_eq!(pose(&animation, win, 0.0, 60.0).scalar("reveal"), Some(0.0));
        // 入场结束后 reveal 必须重新缺席（`sample_loop` 分支不产出 reveal）。
        assert_eq!(pose(&animation, win, 2.0, 60.0).scalar("reveal"), None);
    }

    #[test]
    fn mirrored_exit_takes_three_quarters_of_the_effective_enter_duration() {
        let mut enter = slot("rise");
        enter.dur = Some(0.8);
        let animation = AnimationInput {
            enter: Some(enter),
            exit: None,
            r#loop: None,
        };
        let (exit, recipe) = effective_exit(&animation).unwrap();
        assert_eq!(exit.preset, "sink");
        assert_eq!(exit.dur, Some(0.8 * 0.75));
        assert_eq!(exit.delay, Some(0.0));
        assert_eq!(exit.ease, None);
        assert_eq!(recipe.id, "sink");
    }

    #[test]
    fn explicit_none_exit_blocks_derivation_and_missing_recipes_yield_no_exit() {
        let blocked = AnimationInput {
            enter: Some(slot("rise")),
            exit: Some(slot("none")),
            r#loop: None,
        };
        assert!(effective_exit(&blocked).is_none());
        for preset in ["pop", "blurIn", "typewriter", "riseWords", "bounce"] {
            let animation = AnimationInput {
                enter: Some(slot("rise")),
                exit: Some(slot(preset)),
                r#loop: None,
            };
            assert!(effective_exit(&animation).is_none(), "{preset}");
        }
    }

    #[test]
    fn overshooting_user_ease_degrades_only_constrained_channels() {
        let mut enter = slot("rise");
        enter.ease = Some("easeOutBack");
        let tween = compile_slot_tween(&enter, timeline_enter("rise").unwrap(), true).unwrap();
        let mut buf = PoseBuffer::identity();
        tween.write_into(&mut buf, 0.5);
        assert!((buf.scalar_or("opacity", 1.0) - 0.875).abs() < 1e-12);
        assert!(buf.scalar_or("dy", 0.0).abs() < 0.003);
    }

    #[test]
    fn pop_keeps_its_own_opacity_curve_under_an_overshooting_user_ease() {
        let mut enter = slot("pop");
        enter.ease = Some("easeOutBack");
        let tween = compile_slot_tween(&enter, timeline_enter("pop").unwrap(), true).unwrap();
        let opacity = tween
            .atoms
            .iter()
            .find(|atom| atom.property.as_str() == "opacity")
            .unwrap();
        assert_eq!(opacity.curve, CurveSpec::Named(EaseId::EaseOutExpo));
    }

    #[test]
    fn the_exit_wins_when_the_two_windows_touch_at_half() {
        let animation = AnimationInput {
            enter: Some(slot("slideL")),
            exit: Some(slot("slideR")),
            r#loop: None,
        };
        let win = Window {
            start: 0.0,
            end: Some(0.2),
            project_end: 0.2,
        };
        let mid = pose(&animation, win, 0.1, 60.0);
        assert!(mid.scalar_or("opacity", 1.0) > 0.99);
        let end = pose(&animation, win, 0.2, 60.0);
        assert_eq!(end.scalar_or("opacity", 1.0), 0.0);
    }

    #[test]
    fn loop_starts_at_identity_and_is_seek_safe() {
        let animation = AnimationInput {
            enter: None,
            exit: Some(slot("none")),
            r#loop: Some(slot("jitter")),
        };
        let win = Window {
            start: 0.0,
            end: Some(4.0),
            project_end: 4.0,
        };
        let at_start = pose(&animation, win, 0.0, 60.0);
        assert_eq!(at_start.scalar_or("dx", 0.0), 0.0);
        assert_eq!(at_start.scalar_or("dy", 0.0), 0.0);
        let first = pose(&animation, win, 1.234, 60.0);
        let second = pose(&animation, win, 1.234, 60.0);
        assert_eq!(first, second);
        assert!(first.scalar_or("dx", 0.0) != first.scalar_or("dy", 0.0));
    }

    /// 回归：`fade` 退场只驱动 opacity，因此 `float` 的 dy 轨上循环段是最后一段。
    /// 它的右端点必须是 Off，否则循环值会被一路 Hold 到元素末尾。
    #[test]
    fn a_loop_channel_the_exit_does_not_drive_stops_at_the_idle_end() {
        let animation = AnimationInput {
            enter: Some(slot("fade")),
            exit: Some(slot("fade")),
            r#loop: Some(slot("float")),
        };
        let win = Window {
            start: 1.0,
            end: Some(5.0),
            project_end: 10.0,
        };
        // lifetime 4 / half 2：入场 [0, 0.4]、idle [0.4, 3.7]、退场 [3.7, 4.0]
        assert!(pose(&animation, win, 4.6, 30.0).scalar_or("dy", 0.0) != 0.0);
        for t in [4.7, 4.8, 4.9, 5.0] {
            assert_eq!(
                pose(&animation, win, t, 30.0).scalar_or("dy", 0.0),
                0.0,
                "t={t}"
            );
        }
    }

    /// 反过来：没有退场时 `local == lifetime` 仍然落在循环里。
    #[test]
    fn without_an_exit_the_loop_still_covers_the_last_instant() {
        let animation = AnimationInput {
            enter: None,
            exit: Some(slot("none")),
            r#loop: Some(slot("float")),
        };
        let win = Window {
            start: 0.0,
            end: Some(3.0),
            project_end: 3.0,
        };
        // period 2.4：idle_local = 3.0 → phase 1.25 → rem_euclid 0.25 → 正峰
        assert!(pose(&animation, win, 3.0, 30.0).scalar_or("dy", 0.0) > 0.0);
    }

    #[test]
    fn text_cascade_gates_match_the_old_fallback_order() {
        let win = Window {
            start: 0.0,
            end: Some(6.0),
            project_end: 12.0,
        };
        let no_enter = AnimationInput::default();
        assert_eq!(
            lower_timeline_text(&no_enter, win, "abcde"),
            TextLowering::Container
        );
        let not_cascading = AnimationInput {
            enter: Some(slot("fade")),
            ..AnimationInput::default()
        };
        assert_eq!(
            lower_timeline_text(&not_cascading, win, "abcde"),
            TextLowering::Container
        );
        let single_part = AnimationInput {
            enter: Some(slot("typewriter")),
            ..AnimationInput::default()
        };
        assert_eq!(
            lower_timeline_text(&single_part, win, "a"),
            TextLowering::Container
        );
        let bad_window = Window {
            start: 0.0,
            end: Some(0.0),
            project_end: 0.0,
        };
        assert_eq!(
            lower_timeline_text(&single_part, bad_window, "abcde"),
            TextLowering::Identity
        );
    }

    #[test]
    fn typewriter_parts_match_the_voiceink_five_part_golden() {
        let win = Window {
            start: 0.0,
            end: Some(6.0),
            project_end: 12.0,
        };
        let animation = AnimationInput {
            enter: Some(slot("typewriter")),
            ..AnimationInput::default()
        };
        let TextLowering::Cascade(cascade) = lower_timeline_text(&animation, win, "abcde") else {
            panic!("expected cascade");
        };
        let local = quantize_time(0.05, 60.0);
        let tween = cascade.tween.as_ref().unwrap();
        let opacity: Vec<f64> = (0..cascade.plan.count)
            .map(|index| {
                let mut buf = PoseBuffer::identity();
                tween.write_into(&mut buf, cascade.plan.progress(index, local));
                buf.scalar_or("opacity", 1.0)
            })
            .collect();
        assert!((opacity[0] - 1.0).abs() < 1e-12);
        assert!((opacity[1] - 0.208_333_333_333_333_45).abs() < 1e-12);
        assert_eq!(&opacity[2..], &[0.0, 0.0, 0.0]);
    }

    // ---- 2026-09-08 元素动画目录：多关键帧形态 ----

    fn scalar(buf: &PoseBuffer, prop: &str) -> f64 {
        buf.get(prop)
            .and_then(|value| value.as_f64())
            .unwrap_or_else(|| panic!("{prop} 没有值"))
    }

    fn enter_only(preset: &str) -> AnimationInput<'_> {
        AnimationInput {
            enter: Some(SlotInput {
                preset,
                preset_version: Some(1),
                dur: Some(1.0),
                ..SlotInput::default()
            }),
            exit: Some(slot("none")),
            r#loop: None,
        }
    }

    const WIN: Window = Window {
        start: 0.0,
        end: Some(10.0),
        project_end: 10.0,
    };

    /// `pop`：`scale 0 → 1.2@0.7 → 0.95@0.8 → 1@1`，关键帧处逐位等于声明值，
    /// 段内按段末帧缓动（sinInOut）。
    #[test]
    fn keyframe_enter_hits_declared_values_at_key_times() {
        let anim = enter_only("elPop");
        assert_eq!(scalar(&pose(&anim, WIN, 0.7, 1000.0), "scaleX"), 1.2);
        assert_eq!(scalar(&pose(&anim, WIN, 0.8, 1000.0), "scaleY"), 0.95);
        assert_eq!(scalar(&pose(&anim, WIN, 0.0, 1000.0), "scaleX"), 0.0);
        assert_eq!(scalar(&pose(&anim, WIN, 1.0, 1000.0), "scaleX"), 1.0);
        // 0.35 是首段（0→0.7，sinInOut）中点：eased = 0.5，值 = 0.6。
        let mid = scalar(&pose(&anim, WIN, 0.35, 1000.0), "scaleX");
        assert!((mid - 0.6).abs() < 1e-12, "{mid}");

        let anim = enter_only("elSlideBounceL");
        assert_eq!(scalar(&pose(&anim, WIN, 0.8, 1000.0), "dx"), -0.05);
        assert_eq!(scalar(&pose(&anim, WIN, 0.95, 1000.0), "dx"), 0.00675);
        assert_eq!(scalar(&pose(&anim, WIN, 0.0, 1000.0), "dx"), 1.0);

        let anim = enter_only("elBounce");
        assert_eq!(scalar(&pose(&anim, WIN, 0.8, 1000.0), "dy"), -0.05);
        assert_eq!(scalar(&pose(&anim, WIN, 0.01, 1000.0), "opacity"), 1.0);
        assert_eq!(scalar(&pose(&anim, WIN, 0.0, 1000.0), "opacity"), 0.0);
    }

    /// `selfWidth` 基准：给了元素尺寸时 `dx` 按元素宽换算；没给时按 1 短边近似。
    #[test]
    fn element_extent_scales_self_relative_translate() {
        let anim = enter_only("elSlideL");
        let extent = ElementExtent {
            width: 0.4,
            height: 0.25,
        };
        let lowered = lower_timeline_animation_with(&anim, WIN, Some(extent)).unwrap();
        let mut buf = PoseBuffer::identity();
        sample(&lowered.program, TargetId::SELF, 0.0, &mut buf);
        assert_eq!(scalar(&buf, "dx"), 0.4);
        let lowered = lower_timeline_animation_with(&anim, WIN, None).unwrap();
        let mut buf = PoseBuffer::identity();
        sample(&lowered.program, TargetId::SELF, 0.0, &mut buf);
        assert_eq!(scalar(&buf, "dx"), 1.0);
        // 冻结配方不读 extent：slideL 的 dx 是 canvasShortEdge。
        let frozen = enter_only("slideL");
        let a = lower_timeline_animation_with(&frozen, WIN, Some(extent)).unwrap();
        let b = lower_timeline_animation(&frozen, WIN).unwrap();
        assert_eq!(a, b);
    }

    /// intensity 只缩放对 identity 的偏离：elPop@0.7 在 0.5 强度下是 1.1。
    #[test]
    fn keyframe_intensity_scales_deviation_from_identity() {
        let mut anim = enter_only("elPop");
        anim.enter.as_mut().unwrap().intensity = Some(0.5);
        assert_eq!(scalar(&pose(&anim, WIN, 0.7, 1000.0), "scaleX"), 1.1);
    }

    /// 关键帧配方的段布局：首段 Hold-before、末段继承槽的 after、中段 Off/Off、
    /// 相邻段共享端点。
    #[test]
    fn keyframe_chain_segments_are_contiguous_with_slot_fills() {
        let anim = enter_only("elPop");
        let lowered = lower_timeline_animation(&anim, WIN).unwrap();
        let track = lowered
            .program
            .property_tracks
            .iter()
            .find(|t| t.property.as_str() == "scaleX")
            .unwrap();
        let bounds: Vec<(f64, f64)> = track.segments.iter().map(|s| (s.t0, s.t1)).collect();
        assert_eq!(bounds, vec![(0.0, 0.7), (0.7, 0.8), (0.8, 1.0)]);
        assert_eq!(track.segments[0].fill_before, Fill::Hold);
        assert_eq!(track.segments[0].fill_after, Fill::Off);
        assert_eq!(track.segments[1].fill_before, Fill::Off);
        assert_eq!(track.segments[2].fill_after, Fill::Off);
    }

    /// 镜像回落：enter 配方倒放成退场时链反转（`at' = 1 − at`）。
    #[test]
    fn keyframe_recipe_reverses_when_used_against_its_slot() {
        let recipe = timeline_enter("elPop").unwrap();
        let tween = compile_slot_tween(&slot("elPop"), recipe, false).unwrap();
        let atom = tween
            .atoms
            .iter()
            .find(|a| a.property.as_str() == "scaleX")
            .unwrap();
        let ats: Vec<f64> = atom.keys.iter().map(|k| k.at).collect();
        for (got, want) in ats.iter().zip([0.0, 0.2, 0.3, 1.0]) {
            assert!((got - want).abs() < 1e-12, "{ats:?}");
        }
        assert_eq!(atom.value_at(ats[2]).as_f64(), Some(1.2));
        assert_eq!(atom.value_at(1.0).as_f64(), Some(0.0));
    }

    /// 关键帧循环：周期内精确插值，关键帧处逐位等于声明值，`intensity` 缩放偏离。
    #[test]
    fn keyframe_loop_is_exact_at_key_phases() {
        let anim = AnimationInput {
            enter: Some(slot("none")),
            exit: Some(slot("none")),
            r#loop: Some(SlotInput {
                preset: "elHeartbeat",
                preset_version: Some(1),
                period: Some(2.0),
                ..SlotInput::default()
            }),
        };
        assert_eq!(scalar(&pose(&anim, WIN, 1.6, 1000.0), "scaleX"), 1.2);
        assert_eq!(scalar(&pose(&anim, WIN, 0.4, 1000.0), "scaleY"), 0.8);
        assert_eq!(scalar(&pose(&anim, WIN, 2.0 + 1.8, 1000.0), "scaleX"), 1.1);
        assert_eq!(scalar(&pose(&anim, WIN, 0.0, 1000.0), "scaleX"), 1.0);
        let mut half = anim;
        half.r#loop.as_mut().unwrap().intensity = Some(0.5);
        assert_eq!(scalar(&pose(&half, WIN, 1.6, 1000.0), "scaleX"), 1.1);

        let spin = AnimationInput {
            enter: Some(slot("none")),
            exit: Some(slot("none")),
            r#loop: Some(slot("elSpin")),
        };
        assert_eq!(scalar(&pose(&spin, WIN, 1.0, 1000.0), "rotation"), 180.0);
    }

    /// 元素目录的每一行都能编译，enter 都有同名 exit 镜像，且 `surface` 正确。
    #[test]
    fn element_catalogue_rows_are_keyframed_and_mirrored() {
        use crate::preset_registry::{Domain, RecipeSurface, ids, timeline_loop};
        for id in ids(Domain::TimelineEnter)
            .into_iter()
            .filter(|id| id.starts_with("el"))
        {
            let recipe = timeline_enter(id).unwrap();
            assert_eq!(recipe.surface, RecipeSurface::Element, "{id}");
            assert!(!recipe.keyframes.is_empty(), "{id}");
            assert!(recipe.from.get("opacity").is_none(), "{id}: from 必须为空");
            assert_eq!(recipe.mirror.as_deref(), Some(id), "{id}");
            let exit = timeline_exit(id).unwrap_or_else(|| panic!("{id} 缺同名退场"));
            assert_eq!(exit.surface, RecipeSurface::Element);
            assert_eq!(recipe.basis.dx, LengthBasis::SelfWidth);
            assert_eq!(recipe.basis.dy, LengthBasis::SelfHeight);
            assert!(compile_slot_tween(&slot(id), recipe, true).is_some());
            assert!(compile_slot_tween(&slot(id), exit, false).is_some());
        }
        for id in ids(Domain::TimelineLoop)
            .into_iter()
            .filter(|id| id.starts_with("el"))
        {
            let recipe = timeline_loop(id).unwrap();
            assert_eq!(recipe.surface, RecipeSurface::Element, "{id}");
            assert!(!recipe.keyframes.is_empty(), "{id}");
            assert!(
                !compile_loop_kernels(&slot(id), recipe, None).is_empty(),
                "{id}"
            );
        }
        assert_eq!(
            timeline_enter("elWipeL").unwrap().edge.as_deref(),
            Some("right")
        );
        assert_eq!(
            timeline_exit("elWipeL").unwrap().edge.as_deref(),
            Some("left")
        );
        assert_eq!(timeline_enter("fade").unwrap().surface, RecipeSurface::Any);
    }
}
