/*!
 * bcut-motion —— BaoCut 的共享动画内核（ADR-M01，设计 §5）。
 *
 * 纯函数、无 I/O、无时钟、无随机：manifest 经 `include_str!` 嵌入，
 * 采样是 `(program, t)` 的纯函数，随机效果一律显式播种。
 * `bcut-core`（BCF 域）与 `bcut-timeline`（产品剪辑域）都经 lowering 进来，
 * 两者不互相依赖。
 *
 * 禁止在本 crate 引入 `std::fs`、`std::time`、`rand`、网络或线程本地可变状态。
 */

#![forbid(unsafe_code)]

pub mod composite;
pub mod curve;
pub mod effect;
pub mod fingerprint;
pub mod flow;
pub mod graph;
pub mod interpolate;
pub mod loop_kernel;
pub mod lower_bcf;
pub mod lower_timeline;
pub mod preset_registry;
pub mod program;
pub mod relative_value;
pub mod rng;
pub mod sample;
pub mod text_motion;
pub mod text_parts;
pub mod value;

pub use composite::{CompositeMode, PoseBuffer, PostOp, default_mode, mix_toward_identity};
pub use curve::{
    CurveSpec, EASE_NAMES, EaseId, apply_ease, apply_ease_id, curve_overshoots, sample_curve,
    spring_normalized, spring_value,
};
pub use effect::{
    BlendMode, ColorContract, ColorSpace, Determinism, EffectDomain, EffectManifest, EffectRef,
    EffectRegistry, Precision, UniformMap, UniformValue, builtin_registry,
};
pub use fingerprint::fnv1a64;
pub use flow::{FlowParseCtx, parse_flow, parse_parts};
pub use graph::{
    CompileCtx, CompiledFlow, FlowFrame, FlowTrack, MotionGraph, MotionOp, RepeatEnd, RepeatMode,
    compile, compile_flow,
};
pub use interpolate::{InterpolatorSpec, mix};
pub use loop_kernel::{ChannelKey, LoopKernel, sample_keyframes};
pub use lower_bcf::{ChannelIr, KfIr};
pub use lower_timeline::{
    AnimationInput, ElementExtent, SlotInput, SlotTween, TextCascade, TextLowering,
    TimelineProgram, Window, compile_slot_tween, compile_slot_tween_with, effective_exit,
    lower_timeline_animation, lower_timeline_animation_with, lower_timeline_text,
};
pub use program::{
    MOTION_PROGRAM_VERSION, MotionProgram, MotionSegment, PartPlan, PresetRef, PropertyTrack,
    SegmentKind, TargetId, TimeBase,
};
pub use relative_value::{LengthBasis, LengthContext, RelativeLength};
pub use sample::{quantize_time, sample, sample_track};
pub use text_parts::{
    PartMap, PartUnit, StaggerFrom, StaggerPlan, split_animation_parts, stagger_order,
    stagger_order_from, stagger_plan,
};
pub use value::{
    ANIM_PROPS, MotionValue, PropertyId, RELATIVE_LENGTH_PROPS, ValueKind, effect_param_channel,
    is_animatable, property_kind,
};

/// 诊断词汇（设计 §5.4.2）。调用方保留自己的错误类型：`bcut-core` 用 `anyhow!`，
/// `bcut-timeline` 用 `TimelineError`，本 crate 不引入 `anyhow`。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MotionError {
    PresetUnknown(String),
    PresetParamUnknown(String),
    PresetParamMissing(String),
    PresetVersionUnknown(String),
    ManifestInvalid(String),
    /// preset `compose` 递归成环（规范 §7.4 / §16）。
    PresetComposeCycle(String),
    /// 相对长度写在了不允许的属性上（规范 §7.8）。
    RelativeNotAllowed(String),
    /// `selfWidth`/`parentWidth` 等需要静态布局的基准（规范 §7.8）。
    LayoutRequired(&'static str),
    /// `animate.flow` / `animate.parts` 的结构违规（规范 §7.5 / §7.9）。
    /// 键集与操作符都是封闭的，多一个键就是硬错误——「BCF 里没有可执行代码」
    /// 靠解析器保证而不是靠约定（ADR-M07）。
    FlowInvalid(String),
    /// 已声明但阶段 1 未实现的能力。
    Unsupported(&'static str),
}

impl std::fmt::Display for MotionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PresetUnknown(id) => write!(f, "preset-unknown: \"{id}\""),
            Self::PresetParamUnknown(id) => write!(f, "preset-param-unknown: \"{id}\""),
            Self::PresetParamMissing(id) => write!(f, "preset-param-missing: \"{id}\""),
            Self::PresetVersionUnknown(id) => write!(f, "preset-version-unknown: \"{id}\""),
            Self::ManifestInvalid(detail) => write!(f, "manifest-invalid: {detail}"),
            Self::FlowInvalid(detail) => write!(f, "motion-flow-invalid: {detail}"),
            Self::PresetComposeCycle(path) => write!(f, "preset-compose-cycle: {path}"),
            Self::RelativeNotAllowed(prop) => {
                write!(f, "relative-not-allowed: \"{prop}\"")
            }
            Self::LayoutRequired(basis) => {
                write!(f, "relative-basis-unresolved: \"{basis}\"")
            }
            Self::Unsupported(what) => write!(f, "motion-unsupported: \"{what}\""),
        }
    }
}

impl std::error::Error for MotionError {}
