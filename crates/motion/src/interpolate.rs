//! 插值器（设计 §5.1）。阶段 1 只有 `Linear` 与 `Step` 真的被 lowering 用到。

use crate::value::MotionValue;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AngleMode {
    Shortest,
    Cw,
    Ccw,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColorSpace {
    Srgb,
    LinearRgb,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum InterpolatorSpec {
    Linear,
    Step,
    Angle { mode: AngleMode },
    Color { space: ColorSpace },
}

/// `Linear` 在标量上**必须**写成 `from + (to - from) * u`：
/// `sample_slot` 的 `far + (identity - far) * e` 依赖这个表达式形状逐位相等
/// （计划 §2.2）。不要"化简"成 `lerp(to, from, 1 - u)`。
pub fn mix(from: &MotionValue, to: &MotionValue, u: f64, spec: InterpolatorSpec) -> MotionValue {
    match spec {
        InterpolatorSpec::Step => step(from, to, u),
        InterpolatorSpec::Linear => match (from.as_f64(), to.as_f64()) {
            (Some(a), Some(b)) => from.with_scalar(a + (b - a) * u),
            _ => step(from, to, u),
        },
        InterpolatorSpec::Angle { mode } => match (from.as_f64(), to.as_f64()) {
            (Some(a), Some(b)) => {
                let delta = match mode {
                    AngleMode::Shortest => {
                        let raw = (b - a) % 360.0;
                        if raw > 180.0 {
                            raw - 360.0
                        } else if raw < -180.0 {
                            raw + 360.0
                        } else {
                            raw
                        }
                    }
                    AngleMode::Cw => (b - a).rem_euclid(360.0),
                    AngleMode::Ccw => (b - a).rem_euclid(360.0) - 360.0,
                };
                from.with_scalar(a + delta * u)
            }
            _ => step(from, to, u),
        },
        // 阶段 2 与 `Rgba` 一起落地（计划 §1.2）。
        InterpolatorSpec::Color { .. } => step(from, to, u),
    }
}

/// 镜像 `scene_primitives::sample::mix_value` 的阶跃分支。
fn step(from: &MotionValue, to: &MotionValue, u: f64) -> MotionValue {
    if u < 1.0 { from.clone() } else { to.clone() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linear_is_the_far_to_identity_expression() {
        let from = MotionValue::Scalar(0.4);
        let to = MotionValue::Scalar(1.0);
        for i in 0..=100 {
            let u = i as f64 / 100.0;
            let expected = 0.4 + (1.0 - 0.4) * u;
            assert_eq!(
                mix(&from, &to, u, InterpolatorSpec::Linear),
                MotionValue::Scalar(expected)
            );
        }
    }

    #[test]
    fn step_switches_only_at_one() {
        let from = MotionValue::Discrete(serde_json::json!("a"));
        let to = MotionValue::Discrete(serde_json::json!("b"));
        assert_eq!(mix(&from, &to, 0.999, InterpolatorSpec::Step), from);
        assert_eq!(mix(&from, &to, 1.0, InterpolatorSpec::Step), to);
    }
}
