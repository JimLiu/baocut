//! 运行时 IR：绝对或元素局部时间、强类型、已展开（ADR-M02、设计 §5.3）。
//!
//! MotionProgram 不落盘（debug 除外），也不残留 preset 名——provenance 只以
//! `sources` 侧车形式保留，采样期从不查它。

use crate::composite::{CompositeMode, PostOp};
use crate::curve::CurveSpec;
use crate::interpolate::InterpolatorSpec;
use crate::loop_kernel::LoopKernel;
use crate::text_parts::PartUnit;
use crate::value::{MotionValue, PropertyId};

pub const MOTION_PROGRAM_VERSION: u32 = 1;

/// 采样目标。`0` 是元素自身；文字 part 由 `PartPlan` 描述。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TargetId(pub u32);

impl TargetId {
    pub const SELF: Self = Self(0);
}

/// 时间基准。**这不是装饰**（计划 §2.1）：Timeline 的窗口全部相对 `start`，
/// `local = (quantize(t) - start).clamp(0, lifetime)` 与
/// `t - (start + begin)` 不是同一个 double，所以 Timeline lowering 必须发
/// `ElementLocal`，由调用方先做减法再 clamp；BCF 通道本来就是绝对时间。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimeBase {
    ElementLocal,
    Absolute,
}

/// 区间外的取值方式。`Hold` = 夹到该段端点求值，`Off` = 该轨在此刻无输出。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fill {
    Off,
    Hold,
}

/// `MotionProgram::loop_kernels` 的下标。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LoopKernelRef(pub usize);

#[derive(Clone, Debug, PartialEq)]
pub enum SegmentKind {
    Tween {
        from: MotionValue,
        to: MotionValue,
        curve: CurveSpec,
        interpolator: InterpolatorSpec,
    },
    Hold {
        value: MotionValue,
    },
    Loop(LoopKernelRef),
}

#[derive(Clone, Debug, PartialEq)]
pub struct MotionSegment {
    pub t0: f64,
    pub t1: f64,
    pub fill_before: Fill,
    pub fill_after: Fill,
    pub composite: CompositeMode,
    pub order: u32,
    pub kind: SegmentKind,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PropertyTrack {
    pub target: TargetId,
    pub property: PropertyId,
    /// 整轨的合成模式。**不变式：一条轨只有一种 `(composite, order)`**——同一属性
    /// 的多种合成用多条轨表达，`sample()` 按 target 遍历全部轨，天然叠加
    /// （设计 §5.1）。段上的同名字段保留（指纹已编码它们），必须与轨一致。
    pub composite: CompositeMode,
    /// replace 轨之间的覆盖序：大者胜（规范 §7.1「后声明覆盖」的显式化）。
    pub order: u32,
    /// 通道 identity（opacity/scale 为 1，dx/dy/rotation/blur 为 0）。
    pub base: MotionValue,
    pub post: PostOp,
    /// `reveal` 这类通道：没有 segment 覆盖时 pose 字段保持缺席，而不是取 base。
    pub optional: bool,
    /// 按 `t0` 升序、互不重叠（证明见计划 §2.4）。
    pub segments: Vec<MotionSegment>,
}

impl PropertyTrack {
    /// 轨与段的 `(composite, order)` 必须一致。debug 下断言，release 下以轨为准。
    pub fn assert_segments_agree(&self) {
        debug_assert!(
            self.segments
                .iter()
                .all(|segment| segment.composite == self.composite && segment.order == self.order),
            "track {} 的段与轨的 (composite, order) 不一致",
            self.property
        );
    }

    /// 该轨覆盖的时间区间（`None` = 空轨）。
    pub fn span(&self) -> Option<(f64, f64)> {
        let first = self.segments.first()?;
        let last = self.segments.last()?;
        Some((first.t0, last.t1))
    }
}

/// 同一 target / 同一属性上时间交叠的两条 `replace` 轨（规范 §7.7 / §16
/// `motion-replace-overlap`）。
#[derive(Clone, Debug, PartialEq)]
pub struct ReplaceOverlap {
    pub property: PropertyId,
    pub t0: f64,
    pub t1: f64,
    pub earlier_order: u32,
    pub later_order: u32,
}

/// 文字级联计划（计划 §2.10）。`delay`/`part_duration`/`begin_i` 分开保存，
/// 因为 `(local - delay - begin_i) / part_duration` 与
/// `(local - (delay + begin_i)) / part_duration` 不是同一个 double。
#[derive(Clone, Debug, PartialEq)]
pub struct PartPlan {
    pub unit: PartUnit,
    pub count: usize,
    pub delay: f64,
    pub part_duration: f64,
    pub step: f64,
    /// `stagger_order(i, count, stagger_from)`，长度 = `count`。
    pub orders: Vec<usize>,
}

impl PartPlan {
    /// 逐式来自 `motion.rs:657-662`。
    pub fn progress(&self, index: usize, local: f64) -> f64 {
        let begin = self.orders[index] as f64 * self.step;
        if self.part_duration > 0.0 {
            ((local - self.delay - begin) / self.part_duration).clamp(0.0, 1.0)
        } else {
            1.0
        }
    }
}

/// 配方来源。只进 `full_fingerprint()`，采样期不查。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PresetRef {
    pub id: String,
    pub version: u32,
    pub manifest_hash: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MotionProgram {
    pub version: u32,
    pub time_base: TimeBase,
    pub property_tracks: Vec<PropertyTrack>,
    pub loop_kernels: Vec<LoopKernel>,
    pub part_plan: Option<PartPlan>,
    pub sources: Vec<PresetRef>,
}

impl MotionProgram {
    pub fn new(time_base: TimeBase) -> Self {
        Self {
            version: MOTION_PROGRAM_VERSION,
            time_base,
            property_tracks: Vec::new(),
            loop_kernels: Vec::new(),
            part_plan: None,
            sources: Vec::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.property_tracks.iter().all(|t| t.segments.is_empty())
    }

    pub fn track(&self, property: &str) -> Option<&PropertyTrack> {
        self.property_tracks
            .iter()
            .find(|track| track.property.as_str() == property)
    }

    /// 时间交叠的多条 replace 轨。`bcut lint` 用它发 `motion-replace-overlap`。
    pub fn replace_overlaps(&self) -> Vec<ReplaceOverlap> {
        let mut out = Vec::new();
        for (i, a) in self.property_tracks.iter().enumerate() {
            if a.composite != CompositeMode::Replace {
                continue;
            }
            let Some((a0, a1)) = a.span() else { continue };
            for b in self.property_tracks.iter().skip(i + 1) {
                if b.composite != CompositeMode::Replace
                    || b.target != a.target
                    || b.property != a.property
                {
                    continue;
                }
                let Some((b0, b1)) = b.span() else { continue };
                let t0 = a0.max(b0);
                let t1 = a1.min(b1);
                if t1 - t0 <= 1e-9 {
                    continue;
                }
                let (earlier, later) = if a.order <= b.order {
                    (a.order, b.order)
                } else {
                    (b.order, a.order)
                };
                out.push(ReplaceOverlap {
                    property: a.property.clone(),
                    t0,
                    t1,
                    earlier_order: earlier,
                    later_order: later,
                });
            }
        }
        out
    }

    /// 把 `ElementLocal` 程序平移到绝对时间。等价性测试（Timeline ≡ BCF）用。
    pub fn rebased(&self, offset: f64) -> Self {
        let mut next = self.clone();
        next.time_base = TimeBase::Absolute;
        for track in &mut next.property_tracks {
            for segment in &mut track.segments {
                segment.t0 += offset;
                segment.t1 += offset;
            }
        }
        next
    }
}

impl Default for MotionProgram {
    fn default() -> Self {
        Self::new(TimeBase::Absolute)
    }
}
