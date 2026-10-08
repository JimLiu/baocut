//! Easing 词汇表（规范附录 A，封闭枚举），与 JS / Swift 原型逐式一致。
//!
//! 实现已迁入 [`motion::curve`]（阶段 1，设计 §10）：`bcut-core` 与
//! `bcut-timeline` 共用同一张表与同一份函数体，这里只保留兼容 re-export。
//! **不要**在本 crate 里写回本地副本。

pub use motion::curve::{EASE_NAMES, apply_ease};

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
    fn known_values() {
        assert!((apply_ease(Some("easeOutCubic"), 0.5) - 0.875).abs() < 1e-12);
        assert!((apply_ease(Some("easeInOutQuad"), 0.5) - 0.5).abs() < 1e-12);
        // easeOutBack 越过 1
        assert!(apply_ease(Some("easeOutBack"), 0.7) > 1.0);
    }

    #[test]
    fn unknown_names_still_fall_back_to_identity() {
        // GPUI / Mac kernel 回落到 easeOutCubic；core 侧保持恒等（计划 §4.5）。
        assert_eq!(apply_ease(Some("magic-spring"), 0.37), 0.37);
        assert_eq!(apply_ease(None, 0.37), 0.37);
    }
}
