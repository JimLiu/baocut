//! `confetti_frame`：配方 + 用户覆盖 + 时刻 → DrawOp。
//!
//! 签名与 [`crate::source::progress::progress_frame`] 同形（`&mut FrameBuilder` +
//! 返回 op 条数），host 的分派因此长得一样。一帧的指令流是：
//!
//! ```text
//! ClipPath(元素盒)  FillPath × N（每粒一条，路径按形状去重）  PopClip
//! ```
//!
//! 空帧（没有活着的粒子，或 `t < 0`）**一条 op 都不压**，返回 0——
//! host 据此不生成空的 `SceneNode::Vectors`。
//!
//! 像素量口径与 progress 相同：配方里的 `speedPx` / `gravityPx` / `sizePx` 等
//! 是 540 短边下的值，`× pixel_scale` 折到当前画布；系数由 host 算好传进来
//! （参考短边的真相住在 `bcut_timeline::REFERENCE_SHORT_EDGE`）。

use motion::preset_registry::{CatalogueRecipe, Recipe};

use crate::drawop::{Color4, DrawOp, FrameBuilder, Mat6, PathData};
use crate::source::kernel::rect_subpath;

use super::kernel::{self, Emit, EmitMode, Emitter, Motion, Overrides, Pulse};
use super::shapes::{ConfettiShape, unit_path};

pub use crate::source::kernel::DrawBox as ConfettiBox;

/// 用户侧的发射覆盖：`ConfettiProps.emit` 的镜像，`None` = 用配方缺省。
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct ConfettiEmitOverride {
    pub mode: Option<EmitMode>,
    pub rate: Option<f64>,
    pub count: Option<u64>,
    pub interval: Option<f64>,
    pub settle: bool,
}

/// 绘制参数：**已经解析好的**色板 / 形状表 + 倍率 + 折算系数。
///
/// `colors` / `shapes` 已由 host 决定是用户表还是配方表（都非空）；
/// `opacity` 已乘进元素自身的 opacity。
#[derive(Debug, Clone, PartialEq)]
pub struct ConfettiParams {
    pub seed: u64,
    pub colors: Vec<Color4>,
    pub shapes: Vec<ConfettiShape>,
    pub size: f64,
    pub speed: f64,
    pub gravity: f64,
    pub drift: f64,
    pub spin: f64,
    /// 绝对风力（px/s²，540 短边），加在配方 `windPx` 上。
    pub wind: f64,
    pub opacity: f64,
    pub emit: ConfettiEmitOverride,
    /// 元素盒百分比；`Some` 时替换配方的整组发射器。
    pub origin: Option<(f64, f64)>,
    pub angle: Option<f64>,
    pub spread: Option<f64>,
    /// `canvas_short_edge / bcut_timeline::REFERENCE_SHORT_EDGE`。
    pub pixel_scale: f64,
}

impl Default for ConfettiParams {
    fn default() -> Self {
        Self {
            seed: 0,
            colors: Vec::new(),
            shapes: Vec::new(),
            size: 1.0,
            speed: 1.0,
            gravity: 1.0,
            drift: 1.0,
            spin: 1.0,
            wind: 0.0,
            opacity: 1.0,
            emit: ConfettiEmitOverride::default(),
            origin: None,
            angle: None,
            spread: None,
            pixel_scale: 1.0,
        }
    }
}

fn pair(recipe: &Recipe, key: &str) -> Option<[f64; 2]> {
    let arr = recipe.array(key)?;
    Some([arr.first()?.as_f64()?, arr.get(1)?.as_f64()?])
}

/// 配方参数包 → 强类型 [`Motion`]。解析期已保证必填项在场且合法，这里的
/// `unwrap_or` 只是让 `Option` 消失，不是第二份缺省表。
pub fn motion_of(recipe: &Recipe) -> Motion {
    let emit_obj = recipe.object("emit");
    let text = |key: &str| emit_obj.and_then(|o| o.get(key)).and_then(|v| v.as_str());
    let num = |key: &str| emit_obj.and_then(|o| o.get(key)).and_then(|v| v.as_f64());
    let emit = Emit {
        mode: if text("mode") == Some("burst") {
            EmitMode::Burst
        } else {
            EmitMode::Continuous
        },
        rate: num("rate").unwrap_or(1.0).max(1.0),
        count: num("count").unwrap_or(1.0).max(1.0) as u64,
        interval: num("interval").unwrap_or(0.0).max(0.0),
        settle: false,
    };
    let emitters = recipe
        .array("emitters")
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    let o = v.as_object()?;
                    let f = |k: &str| o.get(k).and_then(|v| v.as_f64());
                    Some(Emitter {
                        x: f("x")?,
                        y: f("y")?,
                        spread_x: f("spreadX").unwrap_or(0.0),
                        spread_y: f("spreadY").unwrap_or(0.0),
                        angle: f("angle"),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let pulse = recipe.object("pulse").and_then(|o| {
        let f = |k: &str| o.get(k).and_then(|v| v.as_f64());
        Some(Pulse {
            min: f("min")?,
            max: f("max")?,
            hz: f("hz")?,
        })
    });
    Motion {
        emit,
        emitters,
        angle: recipe.number("angle").unwrap_or(90.0),
        spread: recipe.number("spread").unwrap_or(0.0),
        speed_px: pair(recipe, "speedPx").unwrap_or([0.0, 0.0]),
        drag_x: recipe.number("dragX").unwrap_or(0.0),
        drag_y: recipe.number("dragY").unwrap_or(0.0),
        gravity_px: recipe.number("gravityPx").unwrap_or(0.0),
        wind_px: recipe.number("windPx").unwrap_or(0.0),
        drift_px: recipe.number("driftPx").unwrap_or(0.0),
        drift_hz: recipe.number("driftHz").unwrap_or(0.0),
        size_px: pair(recipe, "sizePx").unwrap_or([1.0, 1.0]),
        size_ramp: recipe.flag("sizeRamp").unwrap_or(false),
        spin_dps: pair(recipe, "spinDps").unwrap_or([0.0, 0.0]),
        flip_hz: pair(recipe, "flipHz").unwrap_or([0.0, 0.0]),
        pulse,
        life_sec: recipe.number("lifeSec").unwrap_or(1.0).max(0.01),
        fade_in: recipe.number("fadeIn").unwrap_or(0.0),
        fade_out: recipe.number("fadeOut").unwrap_or(0.0),
        max_alive: recipe.integer("maxAlive").unwrap_or(600) as usize,
    }
}

/// 用户覆盖合并到配方发射缺省上。
pub fn effective_emit(motion: &Motion, over: &ConfettiEmitOverride) -> Emit {
    Emit {
        mode: over.mode.unwrap_or(motion.emit.mode),
        rate: over
            .rate
            .map(|r| r.round().max(1.0))
            .unwrap_or(motion.emit.rate),
        count: over.count.map(|c| c.max(1)).unwrap_or(motion.emit.count),
        interval: over
            .interval
            .map(|i| i.max(0.0))
            .unwrap_or(motion.emit.interval),
        settle: over.settle,
    }
}

/// `first` 后接 `second`：与 `bcut-timeline-render::scene::post_concat_mat6`
/// 同一条公式（本 crate 不依赖那边，故此处复述）。
pub fn post_concat(first: Mat6, second: Mat6) -> Mat6 {
    let [a, b, c, d, tx, ty] = first;
    let [e, f, g, h, ux, uy] = second;
    [
        e * a + g * b,
        f * a + h * b,
        e * c + g * d,
        f * c + h * d,
        e * tx + g * ty + ux,
        f * tx + h * ty + uy,
    ]
}

/// 一帧 confetti 的**粒子表**（元素盒内坐标，左上原点）——闭式核唯一的入口。
///
/// [`confetti_frame`] 用它出指令流；缩略图与目录格这类「只要坐标不要像素」的
/// 读者（`bcut-wasm` 的 `confettiSample`）也用它，两条路径因此不可能画出不同
/// 的一帧。样式没登记、色板或形状表为空、时刻非有限时返回空表。
///
/// * `time`：元素本地时刻（`t − element.start`，秒）。
/// * `duration`：元素时长（`emit.settle` 用；开放式片尾传 `None`）。
/// * `box_size`：元素盒的宽高（画布像素）。
pub fn confetti_particles(
    recipe: &CatalogueRecipe,
    params: &ConfettiParams,
    time: f64,
    duration: Option<f64>,
    box_size: (f64, f64),
) -> Vec<kernel::Particle> {
    let Some(body) = recipe.confetti() else {
        return Vec::new();
    };
    if params.colors.is_empty() || params.shapes.is_empty() || !time.is_finite() {
        return Vec::new();
    }
    let motion = motion_of(&body.recipe);
    let emit = effective_emit(&motion, &params.emit);
    let over = Overrides {
        seed: params.seed,
        size: params.size,
        speed: params.speed,
        gravity: params.gravity,
        drift: params.drift,
        spin: params.spin,
        wind: params.wind,
        opacity: params.opacity,
        origin: params.origin,
        angle: params.angle,
        spread: params.spread,
        shape_count: params.shapes.len(),
        color_count: params.colors.len(),
    };
    kernel::sample(
        &motion,
        &over,
        &emit,
        time,
        box_size,
        params.pixel_scale,
        duration,
    )
}

/// 一帧 confetti → 指令流；返回**新压入的 DrawOp 条数**（空帧 0）。
///
/// * `time`：元素本地时刻（`t − element.start`，秒）。
/// * `duration`：元素时长（`emit.settle` 用；开放式片尾传 `None`）。
/// * `bbox`：元素盒（画布像素）；`tf`：元素的仿射（旋转 / 姿态）。
pub fn confetti_frame(
    builder: &mut FrameBuilder,
    recipe: &CatalogueRecipe,
    params: &ConfettiParams,
    time: f64,
    duration: Option<f64>,
    bbox: ConfettiBox,
    tf: Mat6,
) -> usize {
    let particles = confetti_particles(recipe, params, time, duration, (bbox.w, bbox.h));
    if particles.is_empty() {
        return 0;
    }

    let mut clip = Vec::with_capacity(5);
    rect_subpath(&mut clip, bbox.x, bbox.y, bbox.w, bbox.h);
    let clip = builder.path_id(PathData(clip));
    builder.push(DrawOp::ClipPath { path: clip, tf });
    let mut count = 1;

    let mut shape_ids: Vec<Option<u32>> = vec![None; params.shapes.len()];
    for p in &particles {
        let shape_id = match shape_ids[p.shape] {
            Some(id) => id,
            None => {
                let id = builder.path_id(unit_path(params.shapes[p.shape]));
                shape_ids[p.shape] = Some(id);
                id
            }
        };
        let (sin, cos) = p.rot_deg.to_radians().sin_cos();
        let local: Mat6 = [
            (cos * p.size) as f32,
            (sin * p.size) as f32,
            (-sin * p.size * p.sy) as f32,
            (cos * p.size * p.sy) as f32,
            (bbox.x + p.x) as f32,
            (bbox.y + p.y) as f32,
        ];
        let base = params.colors[p.color];
        let color: Color4 = [base[0], base[1], base[2], base[3] * p.alpha as f32];
        builder.push(DrawOp::FillPath {
            path: shape_id,
            color,
            tf: post_concat(local, tf),
        });
        count += 1;
    }
    builder.push(DrawOp::PopClip);
    count + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn post_concat_matches_identity_and_translation() {
        let id: Mat6 = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        let m: Mat6 = [2.0, 0.5, -0.5, 2.0, 10.0, 20.0];
        assert_eq!(post_concat(m, id), m);
        assert_eq!(post_concat(id, m), m);
        let t: Mat6 = [1.0, 0.0, 0.0, 1.0, 3.0, 4.0];
        assert_eq!(post_concat(m, t), [2.0, 0.5, -0.5, 2.0, 13.0, 24.0]);
    }
}
