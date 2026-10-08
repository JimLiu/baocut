//! `animate.flow` / `animate.parts` 的 JSON 编码 → [`MotionGraph`]（规范 §7.5）。
//!
//! **纯 JSON 解析，不认识 TimeExpr**：`at` 与 `repeat.until` 必须在进来之前
//! 已经被调用方求值成绝对秒。`bcut-core::resolve` 负责那一步（它才有 cue 表、
//! clip 窗口与定点迭代），并顺带把规范 §7.5 的两个保留串 `"clip.start"` /
//! `"clip.end"` 映射成窗口两端——`bcut-motion` 不依赖 `bcut-core`（ADR-M01）。
//!
//! 键集是**封闭**的：每个 op 只接受下表里的键，多写一个键就是硬错误。
//! 这样「BCF 里不残留可执行代码」不是靠约定，而是靠解析器（ADR-M07）。

use serde_json::{Map, Value};

use crate::MotionError;
use crate::composite::{CompositeMode, default_mode};
use crate::curve::{CurveSpec, EaseId, StepPosition};
use crate::graph::{MotionGraph, MotionOp, RepeatEnd, RepeatMode};
use crate::interpolate::InterpolatorSpec;
use crate::loop_kernel::{DEFAULT_LATTICE, WaveKind};
use crate::program::TargetId;
use crate::text_parts::StaggerFrom;
use crate::value::PropertyId;

/// 解析上下文。
#[derive(Clone, Copy, Debug, Default)]
pub struct FlowParseCtx {
    /// `animate.parts` 的 part 数；`stagger.parts = true` 用它展开 target 表。
    pub part_count: usize,
    /// 规范 §7.3：省略 seed 时写死的默认值（0）。
    pub default_seed: u64,
}

fn invalid(detail: impl Into<String>) -> MotionError {
    MotionError::FlowInvalid(detail.into())
}

fn object<'a>(value: &'a Value, path: &str) -> Result<&'a Map<String, Value>, MotionError> {
    value
        .as_object()
        .ok_or_else(|| invalid(format!("{path} 不是对象")))
}

fn number(map: &Map<String, Value>, key: &str, path: &str) -> Result<f64, MotionError> {
    map.get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| invalid(format!("{path}.{key} 缺失或不是数字")))
}

fn optional_number(map: &Map<String, Value>, key: &str, fallback: f64) -> f64 {
    map.get(key).and_then(Value::as_f64).unwrap_or(fallback)
}

/// 每个 op 的封闭键集。`op` / `target` / `at` 是公共键。
const COMMON_KEYS: &[&str] = &["op", "target", "at"];

fn check_keys(
    map: &Map<String, Value>,
    own: &[&str],
    path: &str,
    op: &str,
) -> Result<(), MotionError> {
    for key in map.keys() {
        if COMMON_KEYS.contains(&key.as_str()) || own.contains(&key.as_str()) {
            continue;
        }
        // 缓动在 keyframes 帧里叫 `ease`，在 flow 的 op 里叫 `curve`：照帧的写法类推最常见。
        let ease_hint = if matches!(key.as_str(), "ease" | "easing") && own.contains(&"curve") {
            "；缓动键叫 curve（keyframes 的帧里才叫 ease）"
        } else {
            ""
        };
        let accepted = COMMON_KEYS
            .iter()
            .chain(own)
            .copied()
            .collect::<Vec<_>>()
            .join(" / ");
        return Err(invalid(format!(
            "{path}: \"{op}\" 不接受键 \"{key}\"{ease_hint}；可用键：{accepted}（§7.5）"
        )));
    }
    Ok(())
}

fn parse_target(map: &Map<String, Value>, path: &str) -> Result<TargetId, MotionError> {
    match map.get("target") {
        None => Ok(TargetId::SELF),
        Some(Value::String(name)) if name == "self" => Ok(TargetId::SELF),
        Some(Value::String(name)) if name.starts_with('#') => {
            // 跨元素 target 需要把编译产物分发到同一 clip 的其它节点，
            // 阶段 3 未实现（§15 已知缺口）。
            let _ = name;
            Err(MotionError::Unsupported("flow-target-cross-element"))
        }
        Some(other) => Err(invalid(format!(
            "{path}.target {other} 只能是 \"self\" 或 \"#id\""
        ))),
    }
}

fn parse_property(map: &Map<String, Value>, path: &str) -> Result<PropertyId, MotionError> {
    let prop = map
        .get("prop")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{path}.prop 缺失")))?;
    if !crate::value::is_animatable(prop) {
        return Err(invalid(format!(
            "{path}.prop \"{prop}\" 不在可动画属性 allowlist{}（§6.4）",
            crate::value::not_animatable_hint(prop)
        )));
    }
    Ok(PropertyId::parse(prop))
}

fn parse_composite(
    map: &Map<String, Value>,
    prop: &str,
    path: &str,
) -> Result<CompositeMode, MotionError> {
    match map.get("composite") {
        None => Ok(default_mode(prop)),
        Some(Value::String(name)) => match name.as_str() {
            "replace" => Ok(CompositeMode::Replace),
            "add" => Ok(CompositeMode::Add),
            "multiply" => Ok(CompositeMode::Multiply),
            other => Err(invalid(format!(
                "{path}.composite \"{other}\" 不在封闭枚举"
            ))),
        },
        Some(other) => Err(invalid(format!("{path}.composite {other} 不是字符串"))),
    }
}

/// 规范 §7.6：名称字符串或结构化对象。
pub fn parse_curve(value: Option<&Value>, path: &str) -> Result<CurveSpec, MotionError> {
    let Some(value) = value else {
        return Ok(CurveSpec::Default);
    };
    if value.is_null() {
        return Ok(CurveSpec::Default);
    }
    if let Some(name) = value.as_str() {
        return EaseId::parse(name).map(CurveSpec::Named).ok_or_else(|| {
            invalid(format!(
                "{path}.curve \"{name}\" 不在封闭 easing 枚举（附录 A）"
            ))
        });
    }
    let map = object(value, &format!("{path}.curve"))?;
    let kind = map
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{path}.curve 缺 \"type\"")))?;
    match kind {
        "cubicBezier" => Ok(CurveSpec::CubicBezier {
            x1: number(map, "x1", path)?,
            y1: number(map, "y1", path)?,
            x2: number(map, "x2", path)?,
            y2: number(map, "y2", path)?,
        }),
        "steps" => Ok(CurveSpec::Steps {
            count: number(map, "count", path)?.max(1.0) as u32,
            position: match map.get("position").and_then(Value::as_str) {
                None | Some("end") => StepPosition::End,
                Some("start") => StepPosition::Start,
                Some(other) => {
                    return Err(invalid(format!("{path}.curve.position \"{other}\" 未知")));
                }
            },
        }),
        "spring" => Ok(CurveSpec::Spring {
            response: optional_number(map, "response", 0.45),
            damping: optional_number(map, "damping", 0.82),
        }),
        other => Err(invalid(format!(
            "{path}.curve.type \"{other}\" 未知（§7.6）"
        ))),
    }
}

fn parse_interpolator(
    map: &Map<String, Value>,
    path: &str,
) -> Result<InterpolatorSpec, MotionError> {
    match map.get("interpolate") {
        None => Ok(InterpolatorSpec::Linear),
        Some(Value::String(name)) if name == "linear" => Ok(InterpolatorSpec::Linear),
        Some(Value::String(name)) if name == "step" => Ok(InterpolatorSpec::Step),
        Some(other) => Err(invalid(format!(
            "{path}.interpolate {other} 阶段 3 只支持 \"linear\" / \"step\""
        ))),
    }
}

/// `animate.flow` 的根。
pub fn parse_flow(flow: &Value, ctx: &FlowParseCtx) -> Result<MotionGraph, MotionError> {
    Ok(MotionGraph {
        root: parse_op(flow, "/animate/flow", ctx)?,
    })
}

/// `animate.parts` 的根：不是 `stagger` 时补一层 `gap = 0` 的 stagger，
/// 让「一个 op 作用于全部 part」与「逐 part 级联」走同一条编译路径（计划 §3.3.6）。
pub fn parse_parts(parts: &Value, ctx: &FlowParseCtx) -> Result<MotionGraph, MotionError> {
    let map = object(parts, "/animate/parts")?;
    if map.contains_key("target") {
        return Err(invalid(
            "/animate/parts: target 由 part 集合隐含，不得显式声明（§7.9）",
        ));
    }
    let root = parse_op(parts, "/animate/parts", ctx)?;
    // `parts: true` 的 stagger 只能在**根**上（`at` / `delay` 包装之内不算嵌套）：
    // 嵌套两层会让每个 part 再展开一次全体 part，产出 n² 份重复轨。
    if count_staggers(&root) > 1 || (count_staggers(&root) == 1 && !root_is_stagger(&root)) {
        return Err(invalid(
            "/animate/parts: parts 级联的 stagger 只能出现在根上（§7.9）",
        ));
    }
    let root = if root_is_stagger(&root) {
        root
    } else {
        MotionOp::Stagger {
            item: Box::new(root),
            gap: 0.0,
            order: StaggerFrom::Start,
            targets: part_targets(ctx.part_count),
        }
    };
    Ok(MotionGraph { root })
}

/// 剥掉 `at` / `delay` 包装后是不是 `stagger`。
fn root_is_stagger(op: &MotionOp) -> bool {
    match op {
        MotionOp::Stagger { .. } => true,
        MotionOp::At { child, .. } | MotionOp::Delay { child, .. } => root_is_stagger(child),
        _ => false,
    }
}

fn count_staggers(op: &MotionOp) -> usize {
    match op {
        MotionOp::Stagger { item, .. } => 1 + count_staggers(item),
        MotionOp::At { child, .. }
        | MotionOp::Delay { child, .. }
        | MotionOp::Repeat { child, .. } => count_staggers(child),
        MotionOp::Parallel(items) | MotionOp::Sequence(items) => {
            items.iter().map(count_staggers).sum()
        }
        _ => 0,
    }
}

fn part_targets(count: usize) -> Vec<TargetId> {
    (1..=count).map(|index| TargetId(index as u32)).collect()
}

fn parse_items(
    map: &Map<String, Value>,
    path: &str,
    ctx: &FlowParseCtx,
) -> Result<Vec<MotionOp>, MotionError> {
    let items = map
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid(format!("{path}.items 缺失或不是数组")))?;
    items
        .iter()
        .enumerate()
        .map(|(index, item)| parse_op(item, &format!("{path}/items/{index}"), ctx))
        .collect()
}

fn parse_item(
    map: &Map<String, Value>,
    path: &str,
    ctx: &FlowParseCtx,
) -> Result<MotionOp, MotionError> {
    let item = map
        .get("item")
        .ok_or_else(|| invalid(format!("{path}.item 缺失")))?;
    parse_op(item, &format!("{path}/item"), ctx)
}

fn wrap_at(map: &Map<String, Value>, path: &str, op: MotionOp) -> Result<MotionOp, MotionError> {
    match map.get("at") {
        None => Ok(op),
        Some(value) => {
            let at = value.as_f64().ok_or_else(|| {
                invalid(format!(
                    "{path}.at 必须在解析前被求值成绝对秒（TimeExpr / clip.start / clip.end 由 bcut-core 解开）"
                ))
            })?;
            Ok(MotionOp::At {
                at,
                child: Box::new(op),
            })
        }
    }
}

fn parse_op(value: &Value, path: &str, ctx: &FlowParseCtx) -> Result<MotionOp, MotionError> {
    let map = object(value, path)?;
    let op = map
        .get("op")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{path}.op 缺失")))?;
    let node = match op {
        "set" => {
            check_keys(map, &["prop", "v", "composite"], path, op)?;
            let property = parse_property(map, path)?;
            let composite = parse_composite(map, property.as_str(), path)?;
            MotionOp::Set {
                target: parse_target(map, path)?,
                value: map
                    .get("v")
                    .cloned()
                    .ok_or_else(|| invalid(format!("{path}.v 缺失")))?,
                property,
                composite,
            }
        }
        "wait" => {
            check_keys(map, &["dur"], path, op)?;
            MotionOp::Wait {
                dur: number(map, "dur", path)?,
            }
        }
        "tween" => {
            check_keys(
                map,
                &[
                    "prop",
                    "from",
                    "to",
                    "dur",
                    "curve",
                    "interpolate",
                    "composite",
                ],
                path,
                op,
            )?;
            let property = parse_property(map, path)?;
            let composite = parse_composite(map, property.as_str(), path)?;
            MotionOp::Tween {
                target: parse_target(map, path)?,
                from: map
                    .get("from")
                    .cloned()
                    .ok_or_else(|| invalid(format!("{path}.from 缺失（不支持「取当前值」）")))?,
                to: map
                    .get("to")
                    .cloned()
                    .ok_or_else(|| invalid(format!("{path}.to 缺失")))?,
                dur: number(map, "dur", path)?,
                curve: parse_curve(map.get("curve"), path)?,
                interpolator: parse_interpolator(map, path)?,
                property,
                composite,
            }
        }
        "preset" => {
            check_keys(map, &["preset", "presetVersion", "params", "dur"], path, op)?;
            MotionOp::Preset {
                target: parse_target(map, path)?,
                id: map
                    .get("preset")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid(format!("{path}.preset 缺失")))?
                    .to_owned(),
                version: map
                    .get("presetVersion")
                    .and_then(Value::as_u64)
                    .map(|v| v as u32),
                params: map
                    .get("params")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default(),
                dur: map.get("dur").and_then(Value::as_f64),
            }
        }
        "parallel" => {
            check_keys(map, &["items"], path, op)?;
            MotionOp::Parallel(parse_items(map, path, ctx)?)
        }
        "sequence" => {
            check_keys(map, &["items"], path, op)?;
            MotionOp::Sequence(parse_items(map, path, ctx)?)
        }
        "stagger" => {
            check_keys(map, &["gap", "order", "targets", "parts", "item"], path, op)?;
            let has_targets = map.contains_key("targets");
            let has_parts = map.get("parts").is_some_and(|v| v != &Value::Bool(false));
            if has_targets && has_parts {
                return Err(invalid(format!("{path}: targets 与 parts 互斥（§7.5）")));
            }
            if has_targets {
                // 跨元素 target 表同样属于阶段 3 未实现的范围。
                return Err(MotionError::Unsupported("flow-target-cross-element"));
            }
            if !has_parts {
                return Err(invalid(format!(
                    "{path}: stagger 需要 targets 或 parts: true（§7.5）"
                )));
            }
            if ctx.part_count == 0 {
                return Err(invalid(format!(
                    "{path}: parts: true 只能出现在 animate.parts 里（§7.9）"
                )));
            }
            MotionOp::Stagger {
                item: Box::new(parse_item(map, path, ctx)?),
                gap: number(map, "gap", path)?,
                order: match map.get("order").and_then(Value::as_str) {
                    None => StaggerFrom::Start,
                    Some(name) => StaggerFrom::parse(name).ok_or_else(|| {
                        invalid(format!("{path}.order \"{name}\" 不在 start|end|center"))
                    })?,
                },
                targets: part_targets(ctx.part_count),
            }
        }
        "delay" => {
            check_keys(map, &["delay", "item"], path, op)?;
            MotionOp::Delay {
                delay: number(map, "delay", path)?,
                child: Box::new(parse_item(map, path, ctx)?),
            }
        }
        "repeat" => {
            check_keys(map, &["count", "until", "mode", "item"], path, op)?;
            let end = match (map.get("count"), map.get("until")) {
                (Some(_), Some(_)) => {
                    return Err(invalid(format!("{path}: count 与 until 互斥（§7.5）")));
                }
                (Some(count), None) => RepeatEnd::Count(
                    count
                        .as_u64()
                        .ok_or_else(|| invalid(format!("{path}.count 不是非负整数")))?
                        as u32,
                ),
                (None, Some(until)) => RepeatEnd::Until(until.as_f64().ok_or_else(|| {
                    invalid(format!(
                        "{path}.until 必须在解析前被求值成绝对秒（clip.end 由 bcut-core 解开）"
                    ))
                })?),
                (None, None) => {
                    return Err(invalid(format!("{path}: 需要 count 或 until（§7.5）")));
                }
            };
            MotionOp::Repeat {
                end,
                mode: match map.get("mode").and_then(Value::as_str) {
                    None | Some("loop") => RepeatMode::Loop,
                    Some("yoyo") => RepeatMode::Yoyo,
                    Some(other) => {
                        return Err(invalid(format!("{path}.mode \"{other}\" 不在 loop|yoyo")));
                    }
                },
                child: Box::new(parse_item(map, path, ctx)?),
            }
        }
        "oscillate" => {
            check_keys(
                map,
                &[
                    "prop",
                    "amplitude",
                    "period",
                    "phase",
                    "wave",
                    "dur",
                    "composite",
                ],
                path,
                op,
            )?;
            let property = parse_property(map, path)?;
            let composite = parse_composite(map, property.as_str(), path)?;
            let wave = match map.get("wave").and_then(Value::as_str) {
                None | Some("sine") => WaveKind::Sine,
                Some("dip") => WaveKind::Dip,
                Some(other) => {
                    return Err(invalid(format!("{path}.wave \"{other}\" 不在 sine|dip")));
                }
            };
            MotionOp::Oscillate {
                target: parse_target(map, path)?,
                amplitude: amplitude(map, path)?,
                period: number(map, "period", path)?,
                phase: optional_number(map, "phase", 0.0),
                wave,
                dur: number(map, "dur", path)?,
                property,
                composite,
            }
        }
        "noise" => {
            check_keys(
                map,
                &[
                    "prop",
                    "amplitude",
                    "period",
                    "seed",
                    "channel",
                    "lattice",
                    "dur",
                    "composite",
                ],
                path,
                op,
            )?;
            let property = parse_property(map, path)?;
            let composite = parse_composite(map, property.as_str(), path)?;
            MotionOp::Noise {
                target: parse_target(map, path)?,
                amplitude: amplitude(map, path)?,
                period: number(map, "period", path)?,
                // 规范 §7.3：省略 seed ⇒ 编译期写死默认值（0），不取随机源。
                seed: map
                    .get("seed")
                    .map(|value| {
                        value
                            .as_u64()
                            .ok_or_else(|| invalid(format!("{path}.seed 不是非负整数")))
                    })
                    .transpose()?
                    .unwrap_or(ctx.default_seed),
                channel: map.get("channel").and_then(Value::as_u64).unwrap_or(0),
                lattice: map
                    .get("lattice")
                    .and_then(Value::as_i64)
                    .unwrap_or(DEFAULT_LATTICE)
                    .max(1),
                dur: number(map, "dur", path)?,
                property,
                composite,
            }
        }
        "sampled" => {
            check_keys(
                map,
                &["prop", "values", "fps", "from", "smooth", "composite"],
                path,
                op,
            )?;
            let property = parse_property(map, path)?;
            let composite = parse_composite(map, property.as_str(), path)?;
            let target = parse_target(map, path)?;
            let values = map
                .get("values")
                .and_then(Value::as_array)
                .filter(|values| !values.is_empty())
                .ok_or_else(|| invalid(format!("{path}.values 缺失或是空数组")))?
                .iter()
                .enumerate()
                .map(|(index, value)| {
                    value
                        .as_f64()
                        .filter(|number| number.is_finite())
                        .ok_or_else(|| invalid(format!("{path}.values[{index}] 不是有限数字")))
                })
                .collect::<Result<Vec<f64>, _>>()?;
            let fps = number(map, "fps", path)?;
            if !(fps > 0.0 && fps.is_finite()) {
                return Err(invalid(format!("{path}.fps 须 > 0")));
            }
            let from = optional_number(map, "from", 0.0);
            let smooth = optional_number(map, "smooth", 0.0);
            if !(from >= 0.0 && smooth >= 0.0) {
                return Err(invalid(format!("{path}.from / smooth 须 ≥ 0")));
            }
            let values = smooth_samples(&values, fps, smooth);
            sampled_op(target, property, composite, &values, fps, from, path)?
        }
        other => {
            return Err(invalid(format!(
                "{path}.op \"{other}\" 不在封闭操作符枚举（§7.5）"
            )));
        }
    };
    wrap_at(map, path, node)
}

/// `sampled` 的居中滑动平均：窗口 `round(smooth × fps)` 个采样，两端按实有的样本数收窄。
/// 窗口不到 2 个采样时原样返回。只用加除，wasm 与 native 逐位一致。
fn smooth_samples(values: &[f64], fps: f64, smooth: f64) -> Vec<f64> {
    let window = (smooth * fps).round() as usize;
    if window < 2 {
        return values.to_vec();
    }
    let left = (window - 1) / 2;
    let right = window / 2;
    (0..values.len())
        .map(|index| {
            let lo = index.saturating_sub(left);
            let hi = (index + right).min(values.len() - 1);
            let sum: f64 = values[lo..=hi].iter().sum();
            sum / (hi - lo + 1) as f64
        })
        .collect()
}

/// 采样序列在序列内秒 `at` 处的线性插值（越界夹到两端）。
fn sample_at(values: &[f64], fps: f64, at: f64) -> f64 {
    let position = at * fps;
    let last = values.len() - 1;
    if position <= 0.0 {
        return values[0];
    }
    let index = position as usize;
    if index >= last {
        return values[last];
    }
    let frac = position - index as f64;
    values[index] + (values[index + 1] - values[index]) * frac
}

/// `sampled` 解糖成既有算子（设计 §13 的变体预算不动）：一串首尾相接的线性 `tween`，
/// 断点就是采样点，所以关键帧投影与逐帧线性插值是同一个函数。`from` 是 op 起点
/// 对应的序列内秒——第一段从那里的插值起步。只有一个点可走时退成 `set`。
fn sampled_op(
    target: TargetId,
    property: PropertyId,
    composite: CompositeMode,
    values: &[f64],
    fps: f64,
    from: f64,
    path: &str,
) -> Result<MotionOp, MotionError> {
    let last = values.len() - 1;
    let span = last as f64 / fps;
    if from > span + 1e-9 {
        return Err(invalid(format!(
            "{path}.from = {from} 超出采样序列的长度 {span:.3}s"
        )));
    }
    let first = sample_at(values, fps, from);
    // 第一个严格落在 `from` 之后的采样点（贴着网格的 `from` 不再多出一段零长 tween）。
    let start = ((from * fps + 1e-9).floor() as usize + 1).min(last + 1);
    if start > last {
        return Ok(MotionOp::Set {
            target,
            property,
            value: Value::from(first),
            composite,
        });
    }
    if last + 1 - start >= crate::graph::TRACK_FRAME_CAP {
        return Err(MotionError::Unsupported("flow-track-too-many-frames"));
    }
    let mut items = Vec::with_capacity(last + 1 - start);
    let (mut prev_t, mut prev_v) = (from, first);
    for (index, value) in values.iter().enumerate().skip(start) {
        let t = index as f64 / fps;
        items.push(MotionOp::Tween {
            target,
            property: property.clone(),
            from: Value::from(prev_v),
            to: Value::from(*value),
            dur: t - prev_t,
            curve: CurveSpec::Default,
            composite,
            interpolator: InterpolatorSpec::Linear,
        });
        (prev_t, prev_v) = (t, *value);
    }
    Ok(MotionOp::Sequence(items))
}

fn amplitude(map: &Map<String, Value>, path: &str) -> Result<Value, MotionError> {
    let value = map
        .get("amplitude")
        .ok_or_else(|| invalid(format!("{path}.amplitude 缺失")))?;
    if value.as_f64().is_some()
        || crate::preset_registry::manifest::parse_length_value(value).is_some()
    {
        return Ok(value.clone());
    }
    Err(invalid(format!(
        "{path}.amplitude {value} 既不是数字也不是相对长度（§7.8）"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::{CompileCtx, compile_flow};
    use serde_json::json;

    fn ctx() -> FlowParseCtx {
        FlowParseCtx::default()
    }

    #[test]
    fn the_spec_example_parses_and_compiles() {
        // 规范 §7.5 的例子（去掉阶段 3 未实现的 targets 那一段），
        // `at` / `until` 已由调用方求值成绝对秒。
        let flow = json!({
            "op": "sequence", "at": 1.2,
            "items": [
                {"op": "parallel", "items": [
                    {"op": "tween", "prop": "opacity", "from": 0, "to": 1, "dur": 0.22,
                     "curve": "easeOutCubic", "composite": "replace"},
                    {"op": "tween", "prop": "y",
                     "from": {"value": 0.04, "basis": "canvasShortEdge"}, "to": 0, "dur": 0.4,
                     "curve": "easeOutCubic", "composite": "add"}
                ]},
                {"op": "repeat", "until": 6.0, "mode": "yoyo",
                 "item": {"op": "tween", "prop": "y", "from": -6, "to": 6, "dur": 1.2,
                          "curve": "easeInOutSine", "composite": "add"}}
            ]
        });
        let graph = parse_flow(&flow, &ctx()).unwrap();
        let compiled = compile_flow(&graph, &CompileCtx::default()).unwrap();
        assert!(!compiled.tracks.is_empty());
        // 第一帧落在 at = 1.2
        let opacity = compiled
            .tracks
            .iter()
            .find(|t| t.prop == "opacity")
            .unwrap();
        assert_eq!(opacity.frames[0].t, 1.2);
        // 相对长度原文保留（布局之后才求值）
        let y_add = compiled
            .tracks
            .iter()
            .find(|t| t.prop == "y" && t.composite == CompositeMode::Add)
            .unwrap();
        assert!(y_add.frames.iter().any(|f| f.v.get("basis").is_some()));
    }

    #[test]
    fn unknown_ops_keys_and_props_are_hard_errors() {
        for bad in [
            json!({"op": "eval", "src": "1+1"}),
            json!({"op": "tween", "prop": "opacity", "from": 0, "to": 1, "dur": 0.2,
                   "shader": "void main(){}"}),
            json!({"op": "tween", "prop": "width", "from": 0, "to": 1, "dur": 0.2}),
            json!({"op": "tween", "prop": "opacity", "to": 1, "dur": 0.2}),
            json!({"op": "repeat", "count": 2, "until": 3.0,
                   "item": {"op": "wait", "dur": 0.2}}),
            json!({"op": "repeat", "item": {"op": "wait", "dur": 0.2}}),
            json!({"op": "tween", "prop": "opacity", "from": 0, "to": 1, "dur": 0.2,
                   "curve": "easeOutBounce"}),
        ] {
            assert!(
                matches!(parse_flow(&bad, &ctx()), Err(MotionError::FlowInvalid(_))),
                "{bad} 应当是硬错误"
            );
        }
    }

    #[test]
    fn cross_element_targets_are_reported_as_unsupported() {
        let flow = json!({"op": "tween", "target": "#card", "prop": "opacity",
                          "from": 0, "to": 1, "dur": 0.2});
        assert!(matches!(
            parse_flow(&flow, &ctx()),
            Err(MotionError::Unsupported("flow-target-cross-element"))
        ));
        let flow = json!({"op": "stagger", "gap": 0.1, "targets": ["#a", "#b"],
                          "item": {"op": "wait", "dur": 0.2}});
        assert!(matches!(
            parse_flow(&flow, &ctx()),
            Err(MotionError::Unsupported("flow-target-cross-element"))
        ));
    }

    #[test]
    fn timeexpr_must_already_be_resolved() {
        let flow = json!({"op": "wait", "dur": 0.2, "at": "@intro+0.2"});
        assert!(matches!(
            parse_flow(&flow, &ctx()),
            Err(MotionError::FlowInvalid(_))
        ));
        let flow = json!({"op": "repeat", "until": "clip.end",
                          "item": {"op": "wait", "dur": 0.2}});
        assert!(matches!(
            parse_flow(&flow, &ctx()),
            Err(MotionError::FlowInvalid(_))
        ));
    }

    #[test]
    fn noise_defaults_its_seed_to_zero() {
        let flow = json!({"op": "noise", "prop": "x", "amplitude": 4, "period": 0.6, "dur": 1.0});
        let MotionOp::Noise { seed, lattice, .. } = parse_flow(&flow, &ctx()).unwrap().root else {
            panic!("expected noise");
        };
        assert_eq!(seed, 0);
        assert_eq!(lattice, DEFAULT_LATTICE);
    }

    #[test]
    fn parts_wrap_a_bare_op_in_a_zero_gap_stagger() {
        let parts = json!({"op": "preset", "preset": "motion.fadeIn"});
        let ctx = FlowParseCtx {
            part_count: 3,
            default_seed: 0,
        };
        let graph = parse_parts(&parts, &ctx).unwrap();
        let MotionOp::Stagger { gap, targets, .. } = graph.root else {
            panic!("expected stagger");
        };
        assert_eq!(gap, 0.0);
        assert_eq!(targets, vec![TargetId(1), TargetId(2), TargetId(3)]);
    }

    #[test]
    fn parts_reject_an_explicit_target() {
        let parts = json!({"op": "preset", "preset": "motion.fadeIn", "target": "self"});
        let ctx = FlowParseCtx {
            part_count: 2,
            default_seed: 0,
        };
        assert!(matches!(
            parse_parts(&parts, &ctx),
            Err(MotionError::FlowInvalid(_))
        ));
    }

    #[test]
    fn a_parts_stagger_under_an_at_wrapper_is_still_the_root() {
        let ctx = FlowParseCtx {
            part_count: 3,
            default_seed: 0,
        };
        let parts = json!({"op": "stagger", "gap": 0.05, "parts": true, "at": 2.0,
                           "item": {"op": "preset", "preset": "motion.fadeIn"}});
        let graph = parse_parts(&parts, &ctx).unwrap();
        // 外层不得再包一层 stagger（那会让每个 part 再展开一次全体 part）
        let MotionOp::At { child, .. } = &graph.root else {
            panic!("expected at wrapper, got {:?}", graph.root);
        };
        assert!(matches!(**child, MotionOp::Stagger { .. }));
    }

    #[test]
    fn nested_parts_staggers_are_rejected() {
        let ctx = FlowParseCtx {
            part_count: 3,
            default_seed: 0,
        };
        let parts = json!({"op": "sequence", "items": [
            {"op": "stagger", "gap": 0.05, "parts": true,
             "item": {"op": "preset", "preset": "motion.fadeIn"}}
        ]});
        assert!(matches!(
            parse_parts(&parts, &ctx),
            Err(MotionError::FlowInvalid(_))
        ));
    }

    #[test]
    fn stagger_with_parts_needs_the_parts_scope() {
        let flow = json!({"op": "stagger", "gap": 0.05, "parts": true,
                          "item": {"op": "preset", "preset": "motion.fadeIn"}});
        // animate.flow（part_count = 0）里写 parts: true 是错的
        assert!(matches!(
            parse_flow(&flow, &ctx()),
            Err(MotionError::FlowInvalid(_))
        ));
        let ctx = FlowParseCtx {
            part_count: 4,
            default_seed: 0,
        };
        assert!(parse_parts(&flow, &ctx).is_ok());
    }

    /// `sampled` 解糖成首尾相接的线性 tween：关键帧 = 采样点，`from` 处插值起步。
    #[test]
    fn sampled_lowers_to_linear_keyframes_on_the_sample_grid() {
        let flow = json!({"op": "sampled", "prop": "opacity", "at": 2.0,
                          "values": [0.0, 1.0, 0.5, 0.25], "fps": 10, "from": 0.05});
        let graph = parse_flow(&flow, &ctx()).unwrap();
        assert!((graph.duration() - 0.25).abs() < 1e-12);
        let compiled = compile_flow(&graph, &CompileCtx::default()).unwrap();
        let track = &compiled.tracks[0];
        assert_eq!(track.prop, "opacity");
        let frames: Vec<(f64, f64)> = track
            .frames
            .iter()
            .map(|f| (f.t, f.v.as_f64().unwrap()))
            .collect();
        let expected = [(2.0, 0.5), (2.05, 1.0), (2.15, 0.5), (2.25, 0.25)];
        assert_eq!(frames.len(), expected.len(), "{frames:?}");
        for ((t, v), (et, ev)) in frames.iter().zip(expected) {
            assert!(
                (t - et).abs() < 1e-9 && (v - ev).abs() < 1e-12,
                "{frames:?}"
            );
        }
        assert!(track.frames.iter().all(|f| f.ease.is_none()));
    }

    #[test]
    fn sampled_smooth_is_a_centered_moving_average() {
        assert_eq!(
            smooth_samples(&[0.0, 3.0, 0.0, 3.0], 10.0, 0.3),
            vec![1.5, 1.0, 2.0, 1.5]
        );
        // 窗口不到 2 个采样：原样
        assert_eq!(smooth_samples(&[1.0, 2.0], 10.0, 0.1), vec![1.0, 2.0]);
    }

    #[test]
    fn sampled_rejects_bad_input() {
        for flow in [
            json!({"op": "sampled", "prop": "opacity", "values": [], "fps": 30}),
            json!({"op": "sampled", "prop": "opacity", "values": [1, "x"], "fps": 30}),
            json!({"op": "sampled", "prop": "opacity", "values": [1, 2], "fps": 0}),
            json!({"op": "sampled", "prop": "opacity", "values": [1, 2], "fps": 10, "from": 0.5}),
            json!({"op": "sampled", "prop": "opacity", "values": [1, 2], "fps": 10, "dur": 1}),
        ] {
            assert!(
                matches!(parse_flow(&flow, &ctx()), Err(MotionError::FlowInvalid(_))),
                "{flow}"
            );
        }
        // 只剩一个点：退成 set
        let single = json!({"op": "sampled", "prop": "opacity", "values": [0.4], "fps": 30});
        assert!(matches!(
            parse_flow(&single, &ctx()).unwrap().root,
            MotionOp::Set { .. }
        ));
    }
}
