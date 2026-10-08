//! Easing 词汇表（规范附录 A，封闭枚举）与曲线规格。
//!
//! `apply_ease` / `EASE_NAMES` 的函数体逐式来自 `bcut-core/src/ease.rs`；
//! `spring_value` / `spring_normalized` / `curve_overshoots` 逐式来自
//! `bcut-timeline/src/motion.rs`。这里是它们唯一的实现处，其余 crate re-export。

use std::f64::consts::PI;

/// 规范附录 A 的封闭 easing 枚举。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum EaseId {
    Linear,
    EaseInQuad,
    EaseOutQuad,
    EaseInOutQuad,
    EaseInCubic,
    EaseOutCubic,
    EaseInOutCubic,
    EaseInQuart,
    EaseOutQuart,
    EaseInOutQuart,
    EaseInExpo,
    EaseOutExpo,
    EaseInOutExpo,
    EaseInSine,
    EaseOutSine,
    EaseInOutSine,
    EaseInBack,
    EaseOutBack,
    EaseInOutBack,
    EaseOutElastic,
}

/// 顺序即 `EaseId` 的声明顺序，也是 Timeline schema `ease` 枚举的顺序。
pub const EASE_NAMES: &[&str] = &[
    "linear",
    "easeInQuad",
    "easeOutQuad",
    "easeInOutQuad",
    "easeInCubic",
    "easeOutCubic",
    "easeInOutCubic",
    "easeInQuart",
    "easeOutQuart",
    "easeInOutQuart",
    "easeInExpo",
    "easeOutExpo",
    "easeInOutExpo",
    "easeInSine",
    "easeOutSine",
    "easeInOutSine",
    "easeInBack",
    "easeOutBack",
    "easeInOutBack",
    "easeOutElastic",
];

const EASE_IDS: &[EaseId] = &[
    EaseId::Linear,
    EaseId::EaseInQuad,
    EaseId::EaseOutQuad,
    EaseId::EaseInOutQuad,
    EaseId::EaseInCubic,
    EaseId::EaseOutCubic,
    EaseId::EaseInOutCubic,
    EaseId::EaseInQuart,
    EaseId::EaseOutQuart,
    EaseId::EaseInOutQuart,
    EaseId::EaseInExpo,
    EaseId::EaseOutExpo,
    EaseId::EaseInOutExpo,
    EaseId::EaseInSine,
    EaseId::EaseOutSine,
    EaseId::EaseInOutSine,
    EaseId::EaseInBack,
    EaseId::EaseOutBack,
    EaseId::EaseInOutBack,
    EaseId::EaseOutElastic,
];

impl EaseId {
    pub fn parse(name: &str) -> Option<Self> {
        EASE_NAMES
            .iter()
            .position(|known| *known == name)
            .map(|index| EASE_IDS[index])
    }

    pub fn name(self) -> &'static str {
        EASE_NAMES[EASE_IDS.iter().position(|id| *id == self).expect("ease id")]
    }
}

/// 逐式来自 `bcut-core/src/ease.rs::apply_ease` 的 match 分支。
pub fn apply_ease_id(id: EaseId, t: f64) -> f64 {
    match id {
        EaseId::Linear => t,
        EaseId::EaseInQuad => t * t,
        EaseId::EaseOutQuad => t * (2.0 - t),
        EaseId::EaseInOutQuad => {
            if t < 0.5 {
                2.0 * t * t
            } else {
                -1.0 + (4.0 - 2.0 * t) * t
            }
        }
        EaseId::EaseInCubic => t * t * t,
        EaseId::EaseOutCubic => {
            let u = t - 1.0;
            u * u * u + 1.0
        }
        EaseId::EaseInOutCubic => {
            if t < 0.5 {
                4.0 * t * t * t
            } else {
                (t - 1.0) * (2.0 * t - 2.0) * (2.0 * t - 2.0) + 1.0
            }
        }
        EaseId::EaseInQuart => t * t * t * t,
        EaseId::EaseOutQuart => {
            let u = t - 1.0;
            1.0 - u * u * u * u
        }
        EaseId::EaseInOutQuart => {
            if t < 0.5 {
                8.0 * t * t * t * t
            } else {
                let u = t - 1.0;
                1.0 - 8.0 * u * u * u * u
            }
        }
        EaseId::EaseInExpo => {
            if t == 0.0 {
                0.0
            } else {
                libm::exp2(10.0 * (t - 1.0))
            }
        }
        EaseId::EaseOutExpo => {
            if t == 1.0 {
                1.0
            } else {
                1.0 - libm::exp2(-10.0 * t)
            }
        }
        EaseId::EaseInOutExpo => {
            if t == 0.0 {
                0.0
            } else if t == 1.0 {
                1.0
            } else if t < 0.5 {
                0.5 * libm::exp2(20.0 * t - 10.0)
            } else {
                1.0 - 0.5 * libm::exp2(-20.0 * t + 10.0)
            }
        }
        EaseId::EaseInSine => 1.0 - libm::cos(t * PI / 2.0),
        EaseId::EaseOutSine => libm::sin(t * PI / 2.0),
        EaseId::EaseInOutSine => -(libm::cos(PI * t) - 1.0) / 2.0,
        EaseId::EaseOutBack => {
            let c = 1.70158;
            1.0 + (c + 1.0) * (t - 1.0).powi(3) + c * (t - 1.0).powi(2)
        }
        EaseId::EaseInBack => {
            let c = 1.70158;
            (c + 1.0) * t * t * t - c * t * t
        }
        EaseId::EaseInOutBack => {
            let c = 1.70158 * 1.525;
            if t < 0.5 {
                ((2.0 * t).powi(2) * ((c + 1.0) * 2.0 * t - c)) / 2.0
            } else {
                ((2.0 * t - 2.0).powi(2) * ((c + 1.0) * (t * 2.0 - 2.0) + c) + 2.0) / 2.0
            }
        }
        EaseId::EaseOutElastic => {
            let c = (2.0 * PI) / 3.0;
            if t == 0.0 {
                0.0
            } else if t == 1.0 {
                1.0
            } else {
                libm::exp2(-10.0 * t) * libm::sin((t * 10.0 - 0.75) * c) + 1.0
            }
        }
    }
}

/// 未知名字回落到恒等（与 `ease.rs` 的 `_ => t` 一致）。**不要**把这个回落改成
/// `easeOutCubic`：GPUI / Mac kernel 的回落不同，Timeline schema 校验让这个分歧
/// 对已校验文档不可达，阶段 1 改任何一侧都会移动像素（计划 §4.5）。
pub fn apply_ease(name: Option<&str>, t: f64) -> f64 {
    match EaseId::parse(name.unwrap_or("linear")) {
        Some(id) => apply_ease_id(id, t),
        None => t,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StepPosition {
    Start,
    End,
}

#[derive(Clone, Debug, PartialEq)]
pub enum CurveSpec {
    /// 未声明曲线。行为等价 `linear`，但作为 BCF `Kf.ease: None` 的无损载体存在。
    Default,
    Named(EaseId),
    /// 不在封闭枚举里的名字。必须保留原文：`curve_overshoots` 对它做子串匹配，
    /// 采样时回落到恒等（计划 §1.2）。
    Unknown(String),
    CubicBezier {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
    },
    Steps {
        count: u32,
        position: StepPosition,
    },
    Spring {
        response: f64,
        damping: f64,
    },
}

impl CurveSpec {
    pub fn from_name(name: &str) -> Self {
        match EaseId::parse(name) {
            Some(id) => Self::Named(id),
            None => Self::Unknown(name.to_owned()),
        }
    }

    /// 回到 BCF `Kf.ease`：`Default` 是 `None`，其余是原名。
    pub fn ease_name(&self) -> Option<&str> {
        match self {
            Self::Default => None,
            Self::Named(id) => Some(id.name()),
            Self::Unknown(name) => Some(name.as_str()),
            _ => None,
        }
    }
}

/// 逐式来自 `bcut-timeline/src/motion.rs::sample_curve`。
pub fn sample_curve(curve: &CurveSpec, progress: f64) -> f64 {
    match curve {
        CurveSpec::Default => apply_ease(None, progress),
        CurveSpec::Named(id) => apply_ease_id(*id, progress),
        CurveSpec::Unknown(name) => apply_ease(Some(name), progress),
        CurveSpec::Spring { response, damping } => spring_normalized(*response, *damping, progress),
        CurveSpec::CubicBezier { x1, y1, x2, y2 } => cubic_bezier(*x1, *y1, *x2, *y2, progress),
        CurveSpec::Steps { count, position } => steps(*count, *position, progress),
    }
}

/// 字幕入场姿态的**历史** cubic-bezier 求解器（`transition.caption.*@1`）。
///
/// 逐行搬自 `core/crates/bcut-kernel/src/cmd/studio_export/transition.rs::cubic_bezier`：
/// 6 次牛顿（每步把参数夹回 `[0, 1]`）+ 10 次二分，容差 `1e-6`。
///
/// **为什么不用 [`cubic_bezier`]**：那条是 8 次牛顿 + 1e-12 容差，两者在
/// `[0, 1]` 上最大差约 `2.2e-6`。乘 255 之后落在 u8 舍入边界上的概率不低，
/// 换求解器就是换字幕像素——`core/fixtures/motion/studio-export-fingerprints.json`
/// 的 180 个取值钉着它。配方因此显式声明 `solver`，而不是"反正都是贝塞尔"。
pub fn cubic_bezier_caption(x1: f64, y1: f64, x2: f64, y2: f64, progress: f64) -> f64 {
    fn coordinate(t: f64, p1: f64, p2: f64) -> f64 {
        let inverse = 1.0 - t;
        3.0 * inverse * inverse * t * p1 + 3.0 * inverse * t * t * p2 + t * t * t
    }
    fn derivative(t: f64, p1: f64, p2: f64) -> f64 {
        let inverse = 1.0 - t;
        3.0 * inverse * inverse * p1 + 6.0 * inverse * t * (p2 - p1) + 3.0 * t * t * (1.0 - p2)
    }
    let x = progress.clamp(0.0, 1.0);
    let mut parameter = x;
    for _ in 0..6 {
        let error = coordinate(parameter, x1, x2) - x;
        let slope = derivative(parameter, x1, x2);
        if error.abs() < 1e-6 || slope.abs() < 1e-6 {
            break;
        }
        parameter = (parameter - error / slope).clamp(0.0, 1.0);
    }
    let (mut low, mut high) = (0.0, 1.0);
    for _ in 0..10 {
        let value = coordinate(parameter, x1, x2);
        if (value - x).abs() < 1e-6 {
            break;
        }
        if value < x {
            low = parameter;
        } else {
            high = parameter;
        }
        parameter = (low + high) / 2.0;
    }
    coordinate(parameter, y1, y2)
}

/// 逐式来自 `bcut-timeline/src/motion.rs::curve_overshoots`（含子串匹配语义）。
pub fn curve_overshoots(curve: &CurveSpec) -> bool {
    match curve {
        CurveSpec::Default => false,
        CurveSpec::Named(id) => id.name().contains("Back") || id.name().contains("Elastic"),
        CurveSpec::Unknown(name) => name.contains("Back") || name.contains("Elastic"),
        CurveSpec::Spring { damping, .. } => *damping < 1.0,
        CurveSpec::CubicBezier { y1, y2, .. } => *y1 < 0.0 || *y1 > 1.0 || *y2 < 0.0 || *y2 > 1.0,
        CurveSpec::Steps { .. } => false,
    }
}

/// 逐式来自 `bcut-timeline/src/motion.rs::spring_value`。
pub fn spring_value(response: f64, damping: f64, time: f64) -> f64 {
    if time <= 0.0 {
        return 0.0;
    }
    let response = response.max(1e-4);
    let damping = damping.max(0.0);
    let w0 = 2.0 * PI / response;
    if damping < 1.0 - 1e-9 {
        let wd = w0 * (1.0 - damping * damping).sqrt();
        let decay = libm::exp(-damping * w0 * time);
        1.0 - decay * (libm::cos(wd * time) + damping * w0 / wd * libm::sin(wd * time))
    } else if damping <= 1.0 + 1e-9 {
        1.0 - libm::exp(-w0 * time) * (1.0 + w0 * time)
    } else {
        let s = w0 * (damping * damping - 1.0).sqrt();
        let r1 = -damping * w0 + s;
        let r2 = -damping * w0 - s;
        1.0 - (r2 * libm::exp(r1 * time) - r1 * libm::exp(r2 * time)) / (r2 - r1)
    }
}

/// 逐式来自 `bcut-timeline/src/motion.rs::spring_normalized`。
pub fn spring_normalized(response: f64, damping: f64, progress: f64) -> f64 {
    if progress <= 0.0 {
        return 0.0;
    }
    if progress >= 1.0 {
        return 1.0;
    }
    let end = spring_value(response, damping, 1.0);
    if end.abs() <= 1e-9 {
        progress
    } else {
        spring_value(response, damping, progress) / end
    }
}

/// 阶段 1 只由单测驱动；阶段 5 收编 `studio_export/transition.rs` 的 `magic-*` 曲线。
pub fn cubic_bezier(x1: f64, y1: f64, x2: f64, y2: f64, t: f64) -> f64 {
    if t <= 0.0 {
        return 0.0;
    }
    if t >= 1.0 {
        return 1.0;
    }
    let bezier = |a: f64, b: f64, u: f64| {
        let v = 1.0 - u;
        3.0 * v * v * u * a + 3.0 * v * u * u * b + u * u * u
    };
    // 牛顿迭代 + 二分兜底，固定迭代次数保证确定性。
    let mut u = t;
    for _ in 0..8 {
        let x = bezier(x1, x2, u) - t;
        if x.abs() < 1e-12 {
            break;
        }
        let v = 1.0 - u;
        let dx = 3.0 * v * v * x1 + 6.0 * v * u * (x2 - x1) + 3.0 * u * u * (1.0 - x2);
        if dx.abs() < 1e-12 {
            break;
        }
        u -= x / dx;
    }
    let mut lo = 0.0f64;
    let mut hi = 1.0f64;
    if !(0.0..=1.0).contains(&u) {
        u = t;
        for _ in 0..32 {
            u = (lo + hi) / 2.0;
            if bezier(x1, x2, u) < t {
                lo = u;
            } else {
                hi = u;
            }
        }
    }
    bezier(y1, y2, u)
}

/// 阶段 1 只由单测驱动。
pub fn steps(count: u32, position: StepPosition, t: f64) -> f64 {
    if count == 0 {
        return t;
    }
    let n = count as f64;
    let raw = match position {
        StepPosition::Start => (t * n).ceil(),
        StepPosition::End => (t * n).floor(),
    };
    (raw / n).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints() {
        for name in EASE_NAMES {
            let e0 = apply_ease(Some(name), 0.0);
            let e1 = apply_ease(Some(name), 1.0);
            assert!(e0.abs() < 1e-9, "{name}(0) = {e0}");
            assert!((e1 - 1.0).abs() < 1e-9, "{name}(1) = {e1}");
        }
    }

    #[test]
    fn ease_names_and_ids_are_a_bijection() {
        assert_eq!(EASE_NAMES.len(), EASE_IDS.len());
        for (index, name) in EASE_NAMES.iter().enumerate() {
            assert_eq!(EaseId::parse(name), Some(EASE_IDS[index]));
            assert_eq!(EASE_IDS[index].name(), *name);
        }
    }

    #[test]
    fn known_values() {
        assert!((apply_ease(Some("easeOutCubic"), 0.5) - 0.875).abs() < 1e-12);
        assert!((apply_ease(Some("easeInOutQuad"), 0.5) - 0.5).abs() < 1e-12);
        assert!(apply_ease(Some("easeOutBack"), 0.7) > 1.0);
    }

    #[test]
    fn unknown_and_missing_names_fall_back_to_identity() {
        assert_eq!(apply_ease(None, 0.37), 0.37);
        assert_eq!(apply_ease(Some("magic-spring"), 0.37), 0.37);
        assert_eq!(sample_curve(&CurveSpec::Default, 0.37), 0.37);
        assert_eq!(
            sample_curve(&CurveSpec::Unknown("magic-spring".into()), 0.37),
            0.37
        );
    }

    #[test]
    fn overshoot_detection_matches_the_substring_rule() {
        assert!(curve_overshoots(&CurveSpec::Named(EaseId::EaseOutBack)));
        assert!(curve_overshoots(&CurveSpec::Named(EaseId::EaseOutElastic)));
        assert!(!curve_overshoots(&CurveSpec::Named(EaseId::EaseOutCubic)));
        assert!(curve_overshoots(&CurveSpec::Unknown("myBackThing".into())));
        assert!(curve_overshoots(&CurveSpec::Spring {
            response: 0.5,
            damping: 0.82
        }));
        assert!(!curve_overshoots(&CurveSpec::Spring {
            response: 0.5,
            damping: 1.0
        }));
    }

    #[test]
    fn spring_endpoints_are_pinned() {
        assert_eq!(spring_normalized(0.5, 0.82, 0.0), 0.0);
        assert_eq!(spring_normalized(0.5, 0.82, 1.0), 1.0);
        assert_eq!(spring_value(0.5, 0.82, 0.0), 0.0);
    }

    #[test]
    fn cubic_bezier_and_steps_hit_their_endpoints() {
        assert_eq!(cubic_bezier(0.4, 0.0, 0.2, 1.0, 0.0), 0.0);
        assert_eq!(cubic_bezier(0.4, 0.0, 0.2, 1.0, 1.0), 1.0);
        let mid = cubic_bezier(0.25, 0.1, 0.25, 1.0, 0.5);
        assert!((0.0..=1.0).contains(&mid));
        assert_eq!(steps(4, StepPosition::End, 0.5), 0.5);
        assert_eq!(steps(4, StepPosition::End, 0.24), 0.0);
        assert_eq!(steps(4, StepPosition::Start, 0.01), 0.25);
    }
}
