//! 十二种单位形（设计稿 §4.4）：每个形状是一条**单位路径**，外接盒约为
//! `[-0.5, 0.5]²`（长条类到 ±0.9），画时按粒子的 `size` 缩放。
//!
//! 形状路径按内容 hash 去重进 `FrameBuilder`（`path_id`），一帧里同一形状只存
//! 一份，N 枚粒子只有 N 条 `FillPath` 的矩阵不同。与原型
//! `designs/baocut/app/model-confetti.js` 的 `SHAPE_PATHS` 逐点相同。
//!
//! 心形 / 花瓣 / 缎带轮廓改编自 `party-js/shapes`（MIT），署名见
//! `core/assets/elements/vendor/sources.json`。

use std::f64::consts::PI;

use crate::drawop::{PathData, PathSeg};
use crate::source::kernel::{
    path_seg_close, path_seg_cubic, path_seg_line, path_seg_move, rect_subpath,
};

/// 与 `bcut_timeline::CONFETTI_SHAPES` / `motion::CONFETTI_SHAPES` 同一张表。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ConfettiShape {
    Rect,
    Strip,
    Circle,
    Ellipse,
    Triangle,
    Diamond,
    Star,
    Starlet,
    Sparkle,
    Heart,
    Petal,
    Ribbon,
}

impl ConfettiShape {
    pub const ALL: [ConfettiShape; 12] = [
        Self::Rect,
        Self::Strip,
        Self::Circle,
        Self::Ellipse,
        Self::Triangle,
        Self::Diamond,
        Self::Star,
        Self::Starlet,
        Self::Sparkle,
        Self::Heart,
        Self::Petal,
        Self::Ribbon,
    ];

    pub fn parse(name: &str) -> Option<ConfettiShape> {
        Some(match name {
            "rect" => Self::Rect,
            "strip" => Self::Strip,
            "circle" => Self::Circle,
            "ellipse" => Self::Ellipse,
            "triangle" => Self::Triangle,
            "diamond" => Self::Diamond,
            "star" => Self::Star,
            "starlet" => Self::Starlet,
            "sparkle" => Self::Sparkle,
            "heart" => Self::Heart,
            "petal" => Self::Petal,
            "ribbon" => Self::Ribbon,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Rect => "rect",
            Self::Strip => "strip",
            Self::Circle => "circle",
            Self::Ellipse => "ellipse",
            Self::Triangle => "triangle",
            Self::Diamond => "diamond",
            Self::Star => "star",
            Self::Starlet => "starlet",
            Self::Sparkle => "sparkle",
            Self::Heart => "heart",
            Self::Petal => "petal",
            Self::Ribbon => "ribbon",
        }
    }
}

/// 四段三次贝塞尔逼近圆的控制臂系数。
const KAPPA: f64 = 0.552_284_749_8;

fn ellipse_subpath(out: &mut Vec<PathSeg>, rx: f64, ry: f64) {
    let kx = KAPPA * rx;
    let ky = KAPPA * ry;
    out.push(path_seg_move(rx, 0.0));
    out.push(path_seg_cubic((rx, ky), (kx, ry), (0.0, ry)));
    out.push(path_seg_cubic((-kx, ry), (-rx, ky), (-rx, 0.0)));
    out.push(path_seg_cubic((-rx, -ky), (-kx, -ry), (0.0, -ry)));
    out.push(path_seg_cubic((kx, -ry), (rx, -ky), (rx, 0.0)));
    out.push(path_seg_close());
}

fn polygon_subpath(out: &mut Vec<PathSeg>, pts: &[(f64, f64)]) {
    let mut it = pts.iter();
    if let Some(&(x, y)) = it.next() {
        out.push(path_seg_move(x, y));
    }
    for &(x, y) in it {
        out.push(path_seg_line(x, y));
    }
    out.push(path_seg_close());
}

/// `n` 角星：从正上方起，外径 `ro` 与内径 `ri` 交替。
fn star_subpath(out: &mut Vec<PathSeg>, n: usize, ro: f64, ri: f64) {
    let mut pts = Vec::with_capacity(2 * n);
    for k in 0..2 * n {
        let a = -PI / 2.0 + k as f64 * PI / n as f64;
        let r = if k % 2 == 0 { ro } else { ri };
        pts.push((r * libm::cos(a), r * libm::sin(a)));
    }
    polygon_subpath(out, &pts);
}

/// 一种形状的单位路径。
pub fn unit_path(shape: ConfettiShape) -> PathData {
    let mut out = Vec::new();
    match shape {
        ConfettiShape::Rect => rect_subpath(&mut out, -0.5, -0.3, 1.0, 0.6),
        ConfettiShape::Strip => rect_subpath(&mut out, -0.2, -0.8, 0.4, 1.6),
        ConfettiShape::Circle => ellipse_subpath(&mut out, 0.5, 0.5),
        ConfettiShape::Ellipse => ellipse_subpath(&mut out, 0.5, 0.3),
        ConfettiShape::Triangle => {
            polygon_subpath(&mut out, &[(0.0, -0.55), (0.5, 0.4), (-0.5, 0.4)])
        }
        ConfettiShape::Diamond => polygon_subpath(
            &mut out,
            &[(0.0, -0.6), (0.4, 0.0), (0.0, 0.6), (-0.4, 0.0)],
        ),
        ConfettiShape::Star => star_subpath(&mut out, 5, 0.55, 0.24),
        ConfettiShape::Starlet => star_subpath(&mut out, 4, 0.6, 0.2),
        ConfettiShape::Sparkle => star_subpath(&mut out, 4, 0.7, 0.08),
        ConfettiShape::Heart => {
            out.push(path_seg_move(0.0, 0.45));
            out.push(path_seg_cubic((-0.7, -0.05), (-0.45, -0.6), (0.0, -0.25)));
            out.push(path_seg_cubic((0.45, -0.6), (0.7, -0.05), (0.0, 0.45)));
            out.push(path_seg_close());
        }
        ConfettiShape::Petal => {
            out.push(path_seg_move(0.0, -0.6));
            out.push(path_seg_cubic((0.45, -0.3), (0.45, 0.3), (0.0, 0.6)));
            out.push(path_seg_cubic((-0.45, 0.3), (-0.45, -0.3), (0.0, -0.6)));
            out.push(path_seg_close());
        }
        ConfettiShape::Ribbon => {
            out.push(path_seg_move(-0.22, -0.9));
            out.push(path_seg_cubic((0.45, -0.5), (-0.45, 0.1), (0.22, 0.9)));
            out.push(path_seg_line(0.02, 0.9));
            out.push(path_seg_cubic((-0.62, 0.1), (0.28, -0.5), (-0.4, -0.9)));
            out.push(path_seg_close());
        }
    }
    PathData(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_shape_round_trips_and_has_a_closed_path() {
        for shape in ConfettiShape::ALL {
            assert_eq!(ConfettiShape::parse(shape.as_str()), Some(shape));
            let path = unit_path(shape);
            assert_eq!(
                path.0.first().map(|s| s.verb),
                Some(0),
                "{shape:?} 以 Move 开头"
            );
            assert_eq!(
                path.0.last().map(|s| s.verb),
                Some(4),
                "{shape:?} 以 Close 收尾"
            );
            for seg in &path.0 {
                for v in seg.pts {
                    assert!(v.abs() <= 1.0, "{shape:?} 单位路径越界 {v}");
                }
            }
        }
        assert_eq!(ConfettiShape::parse("blob"), None);
    }
}
