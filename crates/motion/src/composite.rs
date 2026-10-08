//! 合成模式、后处理与 pose 缓冲（设计 §5.1）。

use crate::value::{MOTION_PROP_COUNT, MOTION_PROPS, MotionValue, PropertyId};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompositeMode {
    Replace,
    Add,
    Multiply,
}

/// 属性归一化。`opacity` 在写回时 `clamp(0,1)`、`blur` 在写回时 `max(0)`，
/// 与 `motion.rs:825`/`:831` 一致。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PostOp {
    None,
    ClampUnit,
    ClampMin0,
}

impl Default for PostOp {
    fn default() -> Self {
        Self::None
    }
}

impl PostOp {
    pub fn apply(self, value: f64) -> f64 {
        match self {
            Self::None => value,
            Self::ClampUnit => value.clamp(0.0, 1.0),
            Self::ClampMin0 => value.max(0.0),
        }
    }

    /// 通道 → 缺省后处理（`motion.rs::sample_slot` 的两处收敛）。
    pub fn for_property(prop: &str) -> Self {
        match prop {
            "opacity" => Self::ClampUnit,
            "blur" => Self::ClampMin0,
            _ => Self::None,
        }
    }
}

/// 属性缺省合成模式（规范 §7.7 / 设计 §5.1）。
///
/// **只用于新配方**：`timeline.*@1` / `bcf.*@1` 的 lowering 一律显式 `Replace`
/// （ADR-M08 冻结），legacy 四槽的「最后一条通道赢」因此逐位不变。
pub fn default_mode(prop: &str) -> CompositeMode {
    match prop {
        "x" | "y" | "dx" | "dy" | "rotation" | "rotationX" | "rotationY" | "skewX" | "skewY"
        | "blur" => CompositeMode::Add,
        "scale" | "scaleX" | "scaleY" | "opacity" => CompositeMode::Multiply,
        // color / backgroundColor / clipPath / pathMorph / borderRadius / pathDraw /
        // textCount / reveal / volume / cam：枚举、文本、颜色与离散值一律 replace。
        _ => CompositeMode::Replace,
    }
}

/// 合成的单位元（`base`）。`multiply` 轨的单位元是 1，`add` 轨是 0。
pub fn identity_for(prop: &str) -> f64 {
    match default_mode(prop) {
        CompositeMode::Multiply => 1.0,
        _ => 0.0,
    }
}

/// 逐式来自 `motion.rs:48-51`（`AnimationPose::mixed_toward_identity` 的单通道切片）。
pub fn mix_toward_identity(value: f64, identity: f64, amount: f64) -> f64 {
    let amount = amount.clamp(0.0, 1.0);
    identity + (value - identity) * amount
}

/// 采样输出缓冲。槽位固定，采样期不分配堆内存。
///
/// 折叠顺序是规范 §7.7 / 设计 §5.1 的固定序：
/// `base → replace（order 大者胜）→ add 求和 → multiply 求积 → 属性归一 / clamp`。
///
/// **逐位不变性**：阶段 1 的每条轨都是单 replace，折叠退化为
/// `post(replace.unwrap_or(base))`，与旧实现的 `write(post(value))` 完全相同。
#[derive(Clone, Debug, Default, PartialEq)]
struct Slot {
    /// 轨没有覆盖该刻时的落点（`PropertyTrack::base`）。
    base: Option<MotionValue>,
    /// `(值, order)`，order 大者胜；同 order 时后写者胜（声明序）。
    replace: Option<(MotionValue, u32)>,
    add: Option<f64>,
    mul: Option<f64>,
    post: PostOp,
    /// 有没有 add / multiply 参与。没有时**跳过整条折叠**，保证旧路径逐位不变。
    composed: bool,
}

impl Slot {
    fn fold(&self) -> Option<MotionValue> {
        let value = self
            .replace
            .as_ref()
            .map(|(value, _)| value.clone())
            .or_else(|| self.base.clone())?;
        if !self.composed {
            return Some(value);
        }
        // 离散 / 颜色值不参与 add / multiply（规范 §7.7：枚举、文本、布尔一律
        // replace + step）。取不到标量就原样返回。
        let Some(mut raw) = value.as_f64() else {
            return Some(value);
        };
        if let Some(add) = self.add {
            raw += add;
        }
        if let Some(mul) = self.mul {
            raw *= mul;
        }
        Some(value.with_scalar(self.post.apply(raw)))
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PoseBuffer {
    slots: [Slot; MOTION_PROP_COUNT],
}

impl PoseBuffer {
    pub fn identity() -> Self {
        Self {
            slots: std::array::from_fn(|_| Slot::default()),
        }
    }

    /// 写入一条**轨**的采样值。`post` 在折叠之后施加（规范 §7.7 第 5 步）。
    pub fn write(
        &mut self,
        prop: &PropertyId,
        value: MotionValue,
        mode: CompositeMode,
        order: u32,
        post: PostOp,
    ) {
        let Some(index) = prop.slot() else {
            return;
        };
        let slot = &mut self.slots[index];
        slot.post = post;
        match mode {
            CompositeMode::Replace => {
                let wins = match &slot.replace {
                    Some((_, seen)) => order >= *seen,
                    None => true,
                };
                if wins {
                    slot.replace = Some((value, order));
                }
            }
            CompositeMode::Add => {
                slot.composed = true;
                if let Some(raw) = value.as_f64() {
                    slot.add = Some(slot.add.unwrap_or(0.0) + raw);
                }
            }
            CompositeMode::Multiply => {
                slot.composed = true;
                if let Some(raw) = value.as_f64() {
                    slot.mul = Some(slot.mul.unwrap_or(1.0) * raw);
                }
            }
        }
    }

    /// 该轨在此刻没有输出时的落点（`PropertyTrack::base`）。
    pub fn write_base(&mut self, prop: &PropertyId, value: MotionValue) {
        let Some(index) = prop.slot() else {
            return;
        };
        if self.slots[index].base.is_none() {
            self.slots[index].base = Some(value);
        }
    }

    pub fn get(&self, prop: &str) -> Option<MotionValue> {
        let index = MOTION_PROPS.iter().position(|known| *known == prop)?;
        self.slots[index].fold()
    }

    pub fn scalar(&self, prop: &str) -> Option<f64> {
        self.get(prop).and_then(|value| value.as_f64())
    }

    /// 缺省值回落：`scalar(prop)` 缺席时返回通道 identity。
    pub fn scalar_or(&self, prop: &str, identity: f64) -> f64 {
        self.scalar(prop).unwrap_or(identity)
    }
}

impl Default for PoseBuffer {
    fn default() -> Self {
        Self::identity()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_writes_and_reads_back() {
        let mut buf = PoseBuffer::identity();
        assert_eq!(buf.scalar("opacity"), None);
        assert_eq!(buf.scalar_or("opacity", 1.0), 1.0);
        buf.write(
            &PropertyId::known("opacity"),
            MotionValue::Scalar(0.25),
            CompositeMode::Replace,
            0,
            PostOp::ClampUnit,
        );
        assert_eq!(buf.scalar("opacity"), Some(0.25));
    }

    #[test]
    fn unknown_properties_are_dropped_not_panicked() {
        let mut buf = PoseBuffer::identity();
        buf.write(
            &PropertyId::parse("notAProperty"),
            MotionValue::Scalar(1.0),
            CompositeMode::Replace,
            0,
            PostOp::None,
        );
        assert_eq!(buf.scalar("notAProperty"), None);
    }

    #[test]
    fn post_ops_match_the_sample_slot_clamps() {
        assert_eq!(PostOp::ClampUnit.apply(1.5), 1.0);
        assert_eq!(PostOp::ClampMin0.apply(-2.0), 0.0);
        assert_eq!(PostOp::for_property("opacity"), PostOp::ClampUnit);
        assert_eq!(PostOp::for_property("blur"), PostOp::ClampMin0);
        assert_eq!(PostOp::for_property("dy"), PostOp::None);
    }

    fn write(buf: &mut PoseBuffer, prop: &str, v: f64, mode: CompositeMode, order: u32) {
        buf.write(
            &PropertyId::parse(prop),
            MotionValue::Scalar(v),
            mode,
            order,
            PostOp::for_property(prop),
        );
    }

    #[test]
    fn the_highest_order_replace_wins() {
        let mut buf = PoseBuffer::identity();
        write(&mut buf, "y", 10.0, CompositeMode::Replace, 0);
        write(&mut buf, "y", 20.0, CompositeMode::Replace, 3);
        write(&mut buf, "y", 30.0, CompositeMode::Replace, 1);
        assert_eq!(buf.scalar("y"), Some(20.0));
    }

    #[test]
    fn equal_orders_fall_back_to_declaration_order() {
        let mut buf = PoseBuffer::identity();
        write(&mut buf, "y", 10.0, CompositeMode::Replace, 0);
        write(&mut buf, "y", 20.0, CompositeMode::Replace, 0);
        assert_eq!(buf.scalar("y"), Some(20.0));
    }

    #[test]
    fn base_then_replace_then_add_then_multiply_then_clamp() {
        let mut buf = PoseBuffer::identity();
        buf.write_base(&PropertyId::known("y"), MotionValue::Scalar(300.0));
        write(&mut buf, "y", -40.0, CompositeMode::Add, 0);
        write(&mut buf, "y", 6.0, CompositeMode::Add, 1);
        assert_eq!(buf.scalar("y"), Some(266.0));

        let mut buf = PoseBuffer::identity();
        buf.write_base(&PropertyId::known("scale"), MotionValue::Scalar(1.0));
        write(&mut buf, "scale", 0.8, CompositeMode::Multiply, 0);
        write(&mut buf, "scale", 1.06, CompositeMode::Multiply, 1);
        assert_eq!(buf.scalar("scale"), Some(0.8 * 1.06));

        // replace 先赢，add / multiply 再叠上去
        let mut buf = PoseBuffer::identity();
        write(&mut buf, "y", 100.0, CompositeMode::Replace, 0);
        write(&mut buf, "y", 5.0, CompositeMode::Add, 1);
        write(&mut buf, "y", 2.0, CompositeMode::Multiply, 2);
        assert_eq!(buf.scalar("y"), Some(210.0));
    }

    #[test]
    fn clamp_happens_after_composition_not_before() {
        let mut buf = PoseBuffer::identity();
        write(&mut buf, "opacity", 0.8, CompositeMode::Replace, 0);
        write(&mut buf, "opacity", 0.9, CompositeMode::Add, 1);
        // 先 clamp 会得到 1.0 + 0.9 = 1.9 再 clamp = 1.0；这里也是 1.0，
        // 但中间量 1.7 未被截断——差别在 multiply 参与时可见。
        assert_eq!(buf.scalar("opacity"), Some(1.0));

        let mut buf = PoseBuffer::identity();
        write(&mut buf, "opacity", 1.5, CompositeMode::Replace, 0);
        write(&mut buf, "opacity", 0.5, CompositeMode::Multiply, 1);
        assert_eq!(buf.scalar("opacity"), Some(0.75));
    }

    #[test]
    fn a_single_replace_track_is_untouched_by_the_fold() {
        // 阶段 0/1 的全部 golden 依赖这一条：没有 add / multiply 参与时，
        // 折叠必须**原样返回**写入值（含非标量）。
        let mut buf = PoseBuffer::identity();
        buf.write(
            &PropertyId::known("color"),
            MotionValue::Discrete(serde_json::json!("#ff0000")),
            CompositeMode::Replace,
            0,
            PostOp::None,
        );
        assert_eq!(
            buf.get("color"),
            Some(MotionValue::Discrete(serde_json::json!("#ff0000")))
        );
        let mut buf = PoseBuffer::identity();
        write(&mut buf, "opacity", 1.5, CompositeMode::Replace, 0);
        assert_eq!(buf.scalar("opacity"), Some(1.5), "单轨不做 clamp");
    }

    #[test]
    fn discrete_values_ignore_add_and_multiply() {
        let mut buf = PoseBuffer::identity();
        buf.write(
            &PropertyId::known("color"),
            MotionValue::Discrete(serde_json::json!("#ff0000")),
            CompositeMode::Replace,
            0,
            PostOp::None,
        );
        buf.write(
            &PropertyId::known("color"),
            MotionValue::Discrete(serde_json::json!("#00ff00")),
            CompositeMode::Add,
            1,
            PostOp::None,
        );
        assert_eq!(
            buf.get("color"),
            Some(MotionValue::Discrete(serde_json::json!("#ff0000")))
        );
    }

    #[test]
    fn mix_toward_identity_clamps_the_amount() {
        assert_eq!(mix_toward_identity(0.0, 1.0, 2.0), 0.0);
        assert_eq!(mix_toward_identity(0.0, 1.0, -1.0), 1.0);
        assert_eq!(mix_toward_identity(0.5, 1.0, 0.5), 0.75);
    }
}
