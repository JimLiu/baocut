//! 相对长度（设计 §5.5）。阶段 1 只有 `CanvasWidth`/`CanvasHeight` 被 lowering 用到。

use crate::MotionError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LengthBasis {
    /// 绝对像素，不乘任何画布尺寸。
    Absolute,
    CanvasWidth,
    CanvasHeight,
    CanvasShortEdge,
    CanvasLongEdge,
    SelfWidth,
    SelfHeight,
    ParentWidth,
    ParentHeight,
}

impl LengthBasis {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "absolute" => Some(Self::Absolute),
            "canvasWidth" => Some(Self::CanvasWidth),
            "canvasHeight" => Some(Self::CanvasHeight),
            "canvasShortEdge" => Some(Self::CanvasShortEdge),
            "canvasLongEdge" => Some(Self::CanvasLongEdge),
            "selfWidth" => Some(Self::SelfWidth),
            "selfHeight" => Some(Self::SelfHeight),
            "parentWidth" => Some(Self::ParentWidth),
            "parentHeight" => Some(Self::ParentHeight),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Absolute => "absolute",
            Self::CanvasWidth => "canvasWidth",
            Self::CanvasHeight => "canvasHeight",
            Self::CanvasShortEdge => "canvasShortEdge",
            Self::CanvasLongEdge => "canvasLongEdge",
            Self::SelfWidth => "selfWidth",
            Self::SelfHeight => "selfHeight",
            Self::ParentWidth => "parentWidth",
            Self::ParentHeight => "parentHeight",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RelativeLength {
    pub value: f64,
    pub basis: LengthBasis,
    pub offset_px: f64,
}

impl RelativeLength {
    pub const fn absolute(value: f64) -> Self {
        Self {
            value,
            basis: LengthBasis::Absolute,
            offset_px: 0.0,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LengthContext {
    pub canvas: (f64, f64),
    pub self_box: Option<(f64, f64)>,
    pub parent_box: Option<(f64, f64)>,
}

impl LengthContext {
    pub fn canvas(width: f64, height: f64) -> Self {
        Self {
            canvas: (width, height),
            self_box: None,
            parent_box: None,
        }
    }
}

impl RelativeLength {
    /// `Self*`/`Parent*` 依赖静态布局：调用方必须先跑 `layout_tree` 再把布局盒
    /// 填进 `LengthContext`（设计 §5.5，`scene_primitives::resolve::build_channels_after_layout`）。
    /// 没有盒可用时报 `relative-basis-unresolved`（规范 §16）。
    pub fn resolve(&self, ctx: &LengthContext) -> Result<f64, MotionError> {
        let (w, h) = ctx.canvas;
        let layout_box =
            |value: Option<(f64, f64)>| value.ok_or(MotionError::LayoutRequired(self.basis.name()));
        let base = match self.basis {
            LengthBasis::Absolute => 1.0,
            LengthBasis::CanvasWidth => w,
            LengthBasis::CanvasHeight => h,
            LengthBasis::CanvasShortEdge => w.min(h),
            LengthBasis::CanvasLongEdge => w.max(h),
            LengthBasis::SelfWidth => layout_box(ctx.self_box)?.0,
            LengthBasis::SelfHeight => layout_box(ctx.self_box)?.1,
            LengthBasis::ParentWidth => layout_box(ctx.parent_box)?.0,
            LengthBasis::ParentHeight => layout_box(ctx.parent_box)?.1,
        };
        let scaled = self.value * base;
        // `offset_px == 0` 时不做加法：`-1.0 * w` 与 `-w` 逐位相同，但
        // `-0.0 + 0.0 == 0.0` 会丢掉零的符号，而旧实现写的是 `-canvas_h`。
        if self.offset_px == 0.0 {
            Ok(scaled)
        } else {
            Ok(scaled + self.offset_px)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canvas_bases_resolve() {
        let ctx = LengthContext::canvas(1920.0, 1080.0);
        assert_eq!(
            RelativeLength {
                value: -1.0,
                basis: LengthBasis::CanvasHeight,
                offset_px: 0.0
            }
            .resolve(&ctx)
            .unwrap(),
            -1080.0
        );
        assert_eq!(RelativeLength::absolute(0.0).resolve(&ctx).unwrap(), 0.0);
        assert_eq!(
            RelativeLength {
                value: 0.5,
                basis: LengthBasis::CanvasShortEdge,
                offset_px: 4.0
            }
            .resolve(&ctx)
            .unwrap(),
            544.0
        );
    }

    #[test]
    fn layout_dependent_bases_need_a_box() {
        let ctx = LengthContext::canvas(100.0, 100.0);
        for basis in [
            LengthBasis::SelfWidth,
            LengthBasis::SelfHeight,
            LengthBasis::ParentWidth,
            LengthBasis::ParentHeight,
        ] {
            let err = RelativeLength {
                value: 1.0,
                basis,
                offset_px: 0.0,
            }
            .resolve(&ctx)
            .unwrap_err();
            assert!(matches!(err, MotionError::LayoutRequired(_)));
            assert!(err.to_string().starts_with("relative-basis-unresolved"));
        }
    }

    #[test]
    fn layout_boxes_resolve_once_they_are_filled_in() {
        let ctx = LengthContext {
            canvas: (1920.0, 1080.0),
            self_box: Some((120.0, 60.0)),
            parent_box: Some((400.0, 200.0)),
        };
        let at = |basis, value| {
            RelativeLength {
                value,
                basis,
                offset_px: 0.0,
            }
            .resolve(&ctx)
            .unwrap()
        };
        assert_eq!(at(LengthBasis::SelfWidth, 1.0), 120.0);
        assert_eq!(at(LengthBasis::SelfHeight, 2.0), 120.0);
        assert_eq!(at(LengthBasis::ParentWidth, 0.5), 200.0);
        assert_eq!(at(LengthBasis::ParentHeight, 0.5), 100.0);
    }

    #[test]
    fn basis_names_round_trip() {
        for basis in [
            LengthBasis::Absolute,
            LengthBasis::CanvasWidth,
            LengthBasis::CanvasHeight,
            LengthBasis::CanvasShortEdge,
            LengthBasis::CanvasLongEdge,
            LengthBasis::SelfWidth,
            LengthBasis::SelfHeight,
            LengthBasis::ParentWidth,
            LengthBasis::ParentHeight,
        ] {
            assert_eq!(LengthBasis::parse(basis.name()), Some(basis));
        }
    }
}
