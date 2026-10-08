//! bodymovin 子集的解析（ADR-M11 的子集边界，见 `core/fixtures/lottie/README.md`）。
//!
//! **为什么不是 `#[derive(Deserialize)]` 一把梭**：bodymovin 是十来个导出器版本
//! 累积出来的格式，同一个键在不同 `ty` 下类型不同（`fl` 的 `r` 是填充规则整数，
//! `rc` 的 `r` 是圆角属性对象；`st` 的 `d` 是虚线数组，`sh` 的 `d` 是方向整数；
//! `bm` 有时是整数、有时是属性对象）。用一棵 `serde_json::Value` 按 `ty` 分派，
//! 比给每个变体写一套 `#[serde(untagged)]` 更短、更好报错，也更不容易在遇到
//! 没见过的导出器时**静默取到 0**。
//!
//! 解析期就是子集守门人：不支持的特性在这里变成 `lottie-unsupported-feature`
//! 硬错误或 warn 诊断，**不静默降级**。

use super::geometry::{Affine, Contour};
use super::value::{self, Animated, Ease};
use crate::drawop::MatteMode;
use crate::plan::PreflightDiagnostic;
use anyhow::{Result, bail};
use motion::effect::BlendMode;
use serde_json::Value;
use std::collections::BTreeMap;

/// 解析期的诊断收集器。warn 级进这里，fail 级直接走 `Err`。
#[derive(Debug, Default)]
pub struct Diagnostics {
    items: Vec<PreflightDiagnostic>,
}

impl Diagnostics {
    pub fn warn(&mut self, message: String) {
        let item = PreflightDiagnostic {
            rule: super::LOTTIE_RULE,
            message,
        };
        // 同一条警告只留一份：一个文档里几十个图层挂同一组表达式控制器时，
        // 逐个报会把有用的诊断淹掉。
        if !self.items.contains(&item) {
            self.items.push(item);
        }
    }

    pub fn into_inner(self) -> Vec<PreflightDiagnostic> {
        self.items
    }
}

macro_rules! unsupported {
    ($($arg:tt)*) => {
        anyhow::bail!("lottie-unsupported-feature: {}", format!($($arg)*))
    };
}

// ── 顶层文档 ───────────────────────────────────────────────────────

#[derive(Debug)]
pub struct Animation {
    pub version: String,
    /// 合成帧率
    pub fr: f64,
    pub ip: f64,
    pub op: f64,
    pub width: f64,
    pub height: f64,
    pub layers: Vec<Layer>,
    pub precomps: BTreeMap<String, Vec<Layer>>,
    pub images: BTreeMap<String, ImageAsset>,
    pub markers: Vec<Marker>,
}

#[derive(Debug, Clone)]
pub struct ImageAsset {
    pub id: String,
    pub width: f64,
    pub height: f64,
    /// 相对文档目录的路径（`u` + `p`）。内嵌资源（`e: 1`）为 `None`。
    pub path: Option<String>,
    /// 内嵌的 data URI 字节（`e: 1`）。
    pub embedded: Option<Vec<u8>>,
}

#[derive(Debug, Clone)]
pub struct Marker {
    pub name: String,
    /// 帧号
    pub time: f64,
    pub duration: f64,
}

#[derive(Debug)]
pub struct Layer {
    pub index: i64,
    pub name: String,
    pub kind: LayerKind,
    pub parent: Option<i64>,
    /// `sr`：时间伸缩
    pub stretch: f64,
    pub transform: LayerTransform,
    pub in_point: f64,
    pub out_point: f64,
    /// `st`：图层在合成时间轴上的起点
    pub start: f64,
    pub blend: BlendMode,
    /// `tt`：本图层被上方的遮罩源图层遮罩
    pub matte: Option<MatteMode>,
    /// `td`：本图层是下方图层的遮罩源
    pub is_matte_source: bool,
    pub hidden: bool,
    pub masks: Vec<Mask>,
    /// `tm`：预合成的时间重映射（秒）
    pub time_remap: Option<Animated>,
}

#[derive(Debug)]
pub enum LayerKind {
    Precomp {
        ref_id: String,
        width: f64,
        height: f64,
    },
    Solid {
        color: [f64; 3],
        width: f64,
        height: f64,
    },
    Image {
        ref_id: String,
    },
    Null,
    Shape(Vec<ShapeItem>),
}

#[derive(Debug)]
pub struct LayerTransform {
    pub anchor: Animated,
    pub position: Position,
    pub scale: Animated,
    pub rotation: Animated,
    pub opacity: Animated,
    pub skew: Animated,
    pub skew_axis: Animated,
}

#[derive(Debug)]
pub enum Position {
    Unified(Animated),
    Split { x: Animated, y: Animated },
}

impl LayerTransform {
    /// 该时刻的仿射矩阵（不含不透明度）。
    pub fn matrix(&self, frame: f64) -> Affine {
        let anchor = self.anchor.value(frame);
        let (ax, ay) = (
            anchor.first().copied().unwrap_or(0.0),
            anchor.get(1).copied().unwrap_or(0.0),
        );
        let (px, py) = match &self.position {
            Position::Unified(p) => {
                let v = p.point(frame);
                (v[0], v[1])
            }
            Position::Split { x, y } => (x.scalar(frame), y.scalar(frame)),
        };
        let scale = self.scale.value(frame);
        let (sx, sy) = (
            scale.first().copied().unwrap_or(100.0) / 100.0,
            scale.get(1).copied().unwrap_or(100.0) / 100.0,
        );
        let skew = self.skew.scalar(frame);
        let axis = self.skew_axis.scalar(frame);
        Affine::translate(-ax, -ay)
            .then(Affine::scale(sx, sy))
            .then(Affine::skew(skew, axis))
            .then(Affine::rotate(self.rotation.scalar(frame)))
            .then(Affine::translate(px, py))
    }

    pub fn alpha(&self, frame: f64) -> f64 {
        (self.opacity.scalar(frame) / 100.0).clamp(0.0, 1.0)
    }

    pub fn is_static(&self) -> bool {
        let position_static = match &self.position {
            Position::Unified(p) => p.is_static(),
            Position::Split { x, y } => x.is_static() && y.is_static(),
        };
        self.anchor.is_static()
            && position_static
            && self.scale.is_static()
            && self.rotation.is_static()
            && self.opacity.is_static()
            && self.skew.is_static()
            && self.skew_axis.is_static()
    }
}

#[derive(Debug)]
pub struct Mask {
    pub path: AnimatedShape,
    pub opacity: Animated,
    pub inverted: bool,
}

// ── 形状树 ─────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum ShapeItem {
    Group {
        items: Vec<ShapeItem>,
    },
    Path {
        path: AnimatedShape,
        reversed: bool,
    },
    Rect {
        position: Animated,
        size: Animated,
        radius: Animated,
        reversed: bool,
    },
    Ellipse {
        position: Animated,
        size: Animated,
        reversed: bool,
    },
    Star {
        position: Animated,
        points: Animated,
        rotation: Animated,
        outer_radius: Animated,
        outer_round: Animated,
        inner_radius: Animated,
        inner_round: Animated,
        is_star: bool,
    },
    Fill {
        color: Animated,
        opacity: Animated,
        even_odd: bool,
    },
    GradientFill {
        gradient: Gradient,
        opacity: Animated,
        even_odd: bool,
    },
    Stroke {
        color: Animated,
        opacity: Animated,
        style: StrokeStyle,
    },
    GradientStroke {
        gradient: Gradient,
        opacity: Animated,
        style: StrokeStyle,
    },
    Transform(ShapeTransform),
    Trim {
        start: Animated,
        end: Animated,
        offset: Animated,
        individually: bool,
    },
    RoundCorners {
        radius: Animated,
    },
    /// `mm: 1`（纯拼接）。本实现的填充本来就把组内路径拼起来当一条画，
    /// 因此它是 no-op；布尔模式在解析期就被拒了。
    MergeAppend,
}

#[derive(Debug)]
pub struct ShapeTransform {
    pub anchor: Animated,
    pub position: Animated,
    pub scale: Animated,
    pub rotation: Animated,
    pub opacity: Animated,
    pub skew: Animated,
    pub skew_axis: Animated,
}

impl ShapeTransform {
    pub fn matrix(&self, frame: f64) -> Affine {
        let anchor = self.anchor.point(frame);
        let position = self.position.point(frame);
        let scale = self.scale.value(frame);
        let (sx, sy) = (
            scale.first().copied().unwrap_or(100.0) / 100.0,
            scale.get(1).copied().unwrap_or(100.0) / 100.0,
        );
        Affine::translate(-anchor[0], -anchor[1])
            .then(Affine::scale(sx, sy))
            .then(Affine::skew(
                self.skew.scalar(frame),
                self.skew_axis.scalar(frame),
            ))
            .then(Affine::rotate(self.rotation.scalar(frame)))
            .then(Affine::translate(position[0], position[1]))
    }

    pub fn alpha(&self, frame: f64) -> f64 {
        (self.opacity.scalar(frame) / 100.0).clamp(0.0, 1.0)
    }
}

#[derive(Debug)]
pub struct StrokeStyle {
    pub width: Animated,
    /// 0=butt 1=round 2=square（DrawOp 编码）
    pub cap: u8,
    /// 0=miter 1=round 2=bevel
    pub join: u8,
    pub miter: f64,
    /// 虚线序列（dash / gap 交替）与偏移
    pub dashes: Vec<Animated>,
    pub dash_offset: Option<Animated>,
}

#[derive(Debug)]
pub struct Gradient {
    pub start: Animated,
    pub end: Animated,
    pub radial: bool,
    /// 径向渐变的高光（`h` 百分比 / `a` 角度）
    pub highlight_length: Animated,
    pub highlight_angle: Animated,
    /// 色标数
    pub stop_count: usize,
    /// 扁平色标数组：前 `stop_count * 4` 项是 (offset, r, g, b)，
    /// 之后（若有）是 (offset, alpha) 对。
    pub stops: Animated,
}

/// 形状属性（`sh` 的 `ks` 与遮罩的 `pt`）。
#[derive(Debug)]
pub enum AnimatedShape {
    Static(Contour),
    Keyframed(Vec<ShapeKeyframe>),
}

#[derive(Debug)]
pub struct ShapeKeyframe {
    pub t: f64,
    pub start: Contour,
    pub end: Option<Contour>,
    pub hold: bool,
    pub out: Ease,
    pub inn: Ease,
}

impl AnimatedShape {
    pub fn is_static(&self) -> bool {
        match self {
            AnimatedShape::Static(_) => true,
            AnimatedShape::Keyframed(frames) => frames.len() <= 1,
        }
    }

    pub fn value(&self, frame: f64) -> Contour {
        match self {
            AnimatedShape::Static(c) => c.clone(),
            AnimatedShape::Keyframed(frames) => {
                if frames.is_empty() {
                    return Contour::default();
                }
                if frame <= frames[0].t {
                    return frames[0].start.clone();
                }
                let last = &frames[frames.len() - 1];
                if frame >= last.t {
                    // 与 `value::tail_value` 同一条理由与同一套优先级：老格式
                    // 的末项是纯终止符（只有 `t`），终值在前一帧的 `e` 里
                    if !last.start.v.is_empty() {
                        return last.start.clone();
                    }
                    if let Some(end) = &last.end {
                        return end.clone();
                    }
                    for candidate in frames.iter().rev().skip(1) {
                        if let Some(end) = &candidate.end {
                            return end.clone();
                        }
                        if !candidate.start.v.is_empty() {
                            return candidate.start.clone();
                        }
                    }
                    return Contour::default();
                }
                let idx = frames
                    .partition_point(|k| k.t <= frame)
                    .saturating_sub(1)
                    .min(frames.len() - 2);
                let a = &frames[idx];
                let b = &frames[idx + 1];
                if a.hold {
                    return a.start.clone();
                }
                let end = a.end.clone().unwrap_or_else(|| b.start.clone());
                let span = b.t - a.t;
                let raw = if span > 0.0 {
                    ((frame - a.t) / span).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let x1 = a.out.x.first().copied().unwrap_or(0.0);
                let y1 = a.out.y.first().copied().unwrap_or(0.0);
                let x2 = a.inn.x.first().copied().unwrap_or(1.0);
                let y2 = a.inn.y.first().copied().unwrap_or(1.0);
                lerp_contour(&a.start, &end, value::bezier_ease(x1, y1, x2, y2, raw))
            }
        }
    }
}

/// 顶点数一致时逐点插值；不一致时保持段首形状——AE 不会导出顶点数不同的
/// 可插值形状，真遇到了宁可"卡住"也不要画出一堆错位的控制点。
fn lerp_contour(a: &Contour, b: &Contour, t: f64) -> Contour {
    if a.v.len() != b.v.len() {
        return a.clone();
    }
    let lerp = |x: &[[f64; 2]], y: &[[f64; 2]]| -> Vec<[f64; 2]> {
        x.iter()
            .zip(y.iter())
            .map(|(p, q)| [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
            .collect()
    };
    Contour {
        v: lerp(&a.v, &b.v),
        i: lerp(&a.i, &b.i),
        o: lerp(&a.o, &b.o),
        closed: a.closed,
    }
}

// ── 解析 ───────────────────────────────────────────────────────────

fn obj<'a>(value: &'a Value, path: &str) -> Result<&'a serde_json::Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("lottie-parse: {path} 不是对象"))
}

fn num(map: &serde_json::Map<String, Value>, key: &str) -> Option<f64> {
    map.get(key).and_then(Value::as_f64)
}

fn flag(map: &serde_json::Map<String, Value>, key: &str) -> bool {
    match map.get(key) {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0) != 0.0,
        _ => false,
    }
}

fn text(map: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    map.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn prop(
    path: &str,
    map: &serde_json::Map<String, Value>,
    key: &str,
    default: &[f64],
) -> Result<Animated> {
    value::parse_property_or(&format!("{path}.{key}"), map.get(key), default)
}

/// `ef` 里哪些 `ty` 是**表达式控制器**（Slider / Angle / Color / Point /
/// Checkbox / Group / Layer / Dropdown）。没有表达式时它们是死数据——
/// 忽略 + 警告，不 fail（普查 2026-08-20：语料里 13 个文件命中）。
const EXPRESSION_CONTROL_TYPES: [i64; 8] = [0, 1, 2, 3, 4, 5, 6, 7];

pub fn parse(src: &str, doc: &Value, diagnostics: &mut Diagnostics) -> Result<Animation> {
    let root = obj(doc, src)?;
    if flag(root, "ddd") {
        unsupported!("{src}：3D 合成（ddd = 1）；首版只做 2D");
    }
    let fr = num(root, "fr").unwrap_or(0.0);
    if !(fr.is_finite() && fr > 0.0) {
        bail!("lottie-parse: {src} 缺少可用的帧率 fr（实际 {fr}）");
    }
    let ip = num(root, "ip").unwrap_or(0.0);
    let op = num(root, "op").unwrap_or(ip);
    if !(op > ip) {
        bail!("lottie-parse: {src} 的时间区间非法（ip = {ip}, op = {op}）");
    }

    let mut precomps = BTreeMap::new();
    let mut images = BTreeMap::new();
    for (idx, asset) in root
        .get("assets")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .enumerate()
    {
        let path = format!("{src}.assets[{idx}]");
        let map = obj(asset, &path)?;
        let Some(id) = text(map, "id") else {
            bail!("lottie-parse: {path} 缺少 id");
        };
        if let Some(layers) = map.get("layers").and_then(Value::as_array) {
            let mut parsed = Vec::with_capacity(layers.len());
            for (li, layer) in layers.iter().enumerate() {
                parsed.push(parse_layer(
                    &format!("{path}.layers[{li}]"),
                    layer,
                    diagnostics,
                )?);
            }
            precomps.insert(id, parsed);
            continue;
        }
        let file = text(map, "p").unwrap_or_default();
        let dir = text(map, "u").unwrap_or_default();
        let embedded = if flag(map, "e") || file.starts_with("data:") {
            Some(decode_data_uri(&path, &file)?)
        } else {
            None
        };
        images.insert(
            id.clone(),
            ImageAsset {
                id,
                width: num(map, "w").unwrap_or(0.0),
                height: num(map, "h").unwrap_or(0.0),
                path: (embedded.is_none()).then(|| format!("{dir}{file}")),
                embedded,
            },
        );
    }

    let mut layers = Vec::new();
    for (idx, layer) in root
        .get("layers")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .enumerate()
    {
        layers.push(parse_layer(
            &format!("{src}.layers[{idx}]"),
            layer,
            diagnostics,
        )?);
    }

    let markers = root
        .get("markers")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|marker| {
            let map = marker.as_object()?;
            Some(Marker {
                name: text(map, "cm").unwrap_or_default(),
                time: num(map, "tm").unwrap_or(0.0),
                duration: num(map, "dr").unwrap_or(0.0),
            })
        })
        .collect();

    Ok(Animation {
        version: text(root, "v").unwrap_or_default(),
        fr,
        ip,
        op,
        width: num(root, "w").unwrap_or(0.0),
        height: num(root, "h").unwrap_or(0.0),
        layers,
        precomps,
        images,
        markers,
    })
}

fn parse_layer(path: &str, value: &Value, diagnostics: &mut Diagnostics) -> Result<Layer> {
    let map = obj(value, path)?;
    let ty = map.get("ty").and_then(Value::as_i64).unwrap_or(-1);
    let name = text(map, "nm").unwrap_or_default();
    if flag(map, "ddd") {
        unsupported!("{path}（\"{name}\"）：3D 图层（ddd = 1）；首版只做 2D");
    }
    if flag(map, "ao") {
        unsupported!("{path}（\"{name}\"）：自动定向（ao = 1）；首版不支持");
    }
    check_effects(path, &name, map, diagnostics)?;

    let kind = match ty {
        0 => LayerKind::Precomp {
            ref_id: text(map, "refId")
                .ok_or_else(|| anyhow::anyhow!("lottie-parse: {path} 是预合成图层但缺少 refId"))?,
            width: num(map, "w").unwrap_or(0.0),
            height: num(map, "h").unwrap_or(0.0),
        },
        1 => LayerKind::Solid {
            color: parse_hex_color(text(map, "sc").as_deref().unwrap_or("#000000")),
            width: num(map, "sw").unwrap_or(0.0),
            height: num(map, "sh").unwrap_or(0.0),
        },
        2 => LayerKind::Image {
            ref_id: text(map, "refId")
                .ok_or_else(|| anyhow::anyhow!("lottie-parse: {path} 是图片图层但缺少 refId"))?,
        },
        3 => LayerKind::Null,
        4 => {
            let mut items = Vec::new();
            for (idx, item) in map
                .get("shapes")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or_default()
                .iter()
                .enumerate()
            {
                if let Some(parsed) = parse_shape(&format!("{path}.shapes[{idx}]"), item)? {
                    items.push(parsed);
                }
            }
            LayerKind::Shape(items)
        }
        5 => unsupported!("{path}（\"{name}\"）：文字图层（ty = 5）；首版不做文本排版与字形回退"),
        other => unsupported!("{path}（\"{name}\"）：未知图层类型 ty = {other}"),
    };

    let ks = map
        .get("ks")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let tpath = format!("{path}.ks");
    let position = match ks.get("p").and_then(Value::as_object) {
        Some(p) if flag(p, "s") => Position::Split {
            x: value::parse_property_or(&format!("{tpath}.p.x"), p.get("x"), &[0.0])?,
            y: value::parse_property_or(&format!("{tpath}.p.y"), p.get("y"), &[0.0])?,
        },
        _ => Position::Unified(prop(&tpath, &ks, "p", &[0.0, 0.0])?),
    };
    let transform = LayerTransform {
        anchor: prop(&tpath, &ks, "a", &[0.0, 0.0])?,
        position,
        scale: prop(&tpath, &ks, "s", &[100.0, 100.0])?,
        rotation: prop(&tpath, &ks, "r", &[0.0])?,
        opacity: prop(&tpath, &ks, "o", &[100.0])?,
        skew: prop(&tpath, &ks, "sk", &[0.0])?,
        skew_axis: prop(&tpath, &ks, "sa", &[0.0])?,
    };

    let mut masks = Vec::new();
    for (idx, mask) in map
        .get("masksProperties")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .enumerate()
    {
        if let Some(parsed) = parse_mask(&format!("{path}.masksProperties[{idx}]"), mask, &name)? {
            masks.push(parsed);
        }
    }

    let matte = match map.get("tt").and_then(Value::as_i64) {
        None | Some(0) => None,
        Some(1) => Some(MatteMode::Alpha),
        Some(2) => Some(MatteMode::AlphaInverted),
        Some(3) => Some(MatteMode::Luma),
        Some(4) => Some(MatteMode::LumaInverted),
        Some(other) => unsupported!("{path}（\"{name}\"）：未知轨道遮罩类型 tt = {other}"),
    };

    Ok(Layer {
        index: map.get("ind").and_then(Value::as_i64).unwrap_or(-1),
        name,
        kind,
        parent: map.get("parent").and_then(Value::as_i64),
        stretch: num(map, "sr").filter(|v| *v != 0.0).unwrap_or(1.0),
        transform,
        in_point: num(map, "ip").unwrap_or(f64::NEG_INFINITY),
        out_point: num(map, "op").unwrap_or(f64::INFINITY),
        start: num(map, "st").unwrap_or(0.0),
        blend: parse_blend(path, map)?,
        matte,
        is_matte_source: map.get("td").and_then(Value::as_i64).unwrap_or(0) != 0,
        hidden: flag(map, "hd"),
        masks,
        time_remap: match map.get("tm") {
            Some(tm) if !tm.is_null() => Some(value::parse_property(&format!("{path}.tm"), tm)?),
            _ => None,
        },
    })
}

fn check_effects(
    path: &str,
    name: &str,
    map: &serde_json::Map<String, Value>,
    diagnostics: &mut Diagnostics,
) -> Result<()> {
    let effects = map
        .get("ef")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    if effects.is_empty() {
        return Ok(());
    }
    for effect in effects {
        let Some(entry) = effect.as_object() else {
            continue;
        };
        let ty = entry.get("ty").and_then(Value::as_i64);
        let label = text(entry, "nm").unwrap_or_default();
        match ty {
            Some(code) if EXPRESSION_CONTROL_TYPES.contains(&code) => {
                diagnostics.warn(format!(
                    "图层 \"{name}\" 的效果组「{label}」是表达式控制器（ef ty = {code}）；\
                     文档里没有表达式，它是死数据——已忽略，画面不受影响"
                ));
            }
            None => {
                diagnostics.warn(format!(
                    "图层 \"{name}\" 的效果条目「{label}」没有 ty 字段；已忽略"
                ));
            }
            Some(code) => unsupported!(
                "{path}（\"{name}\"）：光栅效果「{label}」（ef ty = {code}）；\
                 首版只做形状/渐变/遮罩，光栅效果请改用 BCF 的 effects[] 或 lottie-thorvg 逃生口"
            ),
        }
    }
    Ok(())
}

fn parse_blend(path: &str, map: &serde_json::Map<String, Value>) -> Result<BlendMode> {
    let code = match map.get("bm") {
        None | Some(Value::Null) => 0,
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::Object(inner)) => inner.get("k").and_then(Value::as_i64).unwrap_or(0),
        Some(_) => 0,
    };
    Ok(match code {
        0 => BlendMode::Normal,
        1 => BlendMode::Multiply,
        2 => BlendMode::Screen,
        3 => BlendMode::Overlay,
        4 => BlendMode::Darken,
        5 => BlendMode::Lighten,
        10 => BlendMode::Difference,
        11 => BlendMode::Exclusion,
        16 => BlendMode::Plus,
        other => unsupported!("{path}：混合模式 bm = {other} 不在 BCF 的封闭枚举里（§6.6 九种）"),
    })
}

fn parse_mask(path: &str, value: &Value, layer: &str) -> Result<Option<Mask>> {
    let map = obj(value, path)?;
    let mode = text(map, "mode").unwrap_or_else(|| "a".into());
    match mode.as_str() {
        "n" => return Ok(None),
        "a" => {}
        other => unsupported!(
            "{path}（图层 \"{layer}\"）：遮罩模式 \"{other}\"；首版只做 add（\"a\"）与 none（\"n\"）"
        ),
    }
    // 羽化需要一条模糊 pass，首版的遮罩是纯几何合成
    let feather = value::parse_property_or(&format!("{path}.x"), map.get("x"), &[0.0])?;
    if !feather.is_static() || feather.scalar(0.0) != 0.0 {
        unsupported!("{path}（图层 \"{layer}\"）：遮罩羽化（x ≠ 0）；首版不支持");
    }
    let Some(pt) = map.get("pt") else {
        return Ok(None);
    };
    Ok(Some(Mask {
        path: parse_shape_property(&format!("{path}.pt"), pt)?,
        opacity: value::parse_property_or(&format!("{path}.o"), map.get("o"), &[100.0])?,
        inverted: flag(map, "inv"),
    }))
}

/// `sh` 的 `ks` / 遮罩的 `pt`：值是 `{i, o, v, c}` 而不是数组。
pub fn parse_shape_property(path: &str, value: &Value) -> Result<AnimatedShape> {
    let Some(map) = value.as_object() else {
        bail!("lottie-parse: {path} 的形状属性不是对象");
    };
    if let Some(Value::String(expr)) = map.get("x")
        && !expr.trim().is_empty()
    {
        unsupported!("{path} 带表达式（\"x\"）；与 BCF 的确定性承诺冲突");
    }
    // 与 `value::parse_property` 同一条规则：**按结构判定，不看 `a` 标志**。
    // 形状属性的常量形态是 `{i, o, v, c}` 对象，关键帧形态是数组——判据因此
    // 更直白：`k` 是数组就是关键帧。若继续信 `a`，缺 `a` 标志的素材会走进
    // `parse_contour`，而它对数组返回**空轮廓**，形状直接从画面上消失。
    let k = map.get("k").unwrap_or(&Value::Null);
    let Some(items) = k.as_array() else {
        return Ok(AnimatedShape::Static(parse_contour(path, k)?));
    };
    let mut frames = Vec::with_capacity(items.len());
    for (idx, item) in items.iter().enumerate() {
        let Some(entry) = item.as_object() else {
            continue;
        };
        let kpath = format!("{path}.k[{idx}]");
        let start = match entry.get("s") {
            Some(Value::Array(list)) => {
                parse_contour(&kpath, list.first().unwrap_or(&Value::Null))?
            }
            Some(other) => parse_contour(&kpath, other)?,
            None => Contour::default(),
        };
        let end = match entry.get("e") {
            Some(Value::Array(list)) => {
                list.first().map(|v| parse_contour(&kpath, v)).transpose()?
            }
            Some(other) if !other.is_null() => Some(parse_contour(&kpath, other)?),
            _ => None,
        };
        frames.push(ShapeKeyframe {
            t: entry.get("t").and_then(Value::as_f64).unwrap_or(0.0),
            start,
            end,
            hold: entry.get("h").and_then(Value::as_i64).unwrap_or(0) == 1,
            out: parse_ease(entry.get("o")),
            inn: parse_ease(entry.get("i")),
        });
    }
    if frames.is_empty() {
        return Ok(AnimatedShape::Static(Contour::default()));
    }
    Ok(AnimatedShape::Keyframed(frames))
}

fn parse_ease(value: Option<&Value>) -> Ease {
    let Some(Value::Object(map)) = value else {
        return Ease::default();
    };
    let numbers = |v: Option<&Value>| -> Vec<f64> {
        match v {
            Some(Value::Number(n)) => vec![n.as_f64().unwrap_or(0.0)],
            Some(Value::Array(list)) => list.iter().filter_map(Value::as_f64).collect(),
            _ => Vec::new(),
        }
    };
    Ease {
        x: numbers(map.get("x")),
        y: numbers(map.get("y")),
    }
}

fn parse_contour(path: &str, value: &Value) -> Result<Contour> {
    let Some(map) = value.as_object() else {
        return Ok(Contour::default());
    };
    let points = |key: &str| -> Vec<[f64; 2]> {
        map.get(key)
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .map(|p| {
                        let pair = p.as_array().map(Vec::as_slice).unwrap_or_default();
                        [
                            pair.first().and_then(Value::as_f64).unwrap_or(0.0),
                            pair.get(1).and_then(Value::as_f64).unwrap_or(0.0),
                        ]
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let v = points("v");
    let mut i = points("i");
    let mut o = points("o");
    if (!i.is_empty() && i.len() != v.len()) || (!o.is_empty() && o.len() != v.len()) {
        bail!("lottie-parse: {path} 的顶点与切线数量不一致");
    }
    i.resize(v.len(), [0.0, 0.0]);
    o.resize(v.len(), [0.0, 0.0]);
    Ok(Contour {
        v,
        i,
        o,
        closed: flag(map, "c"),
    })
}

fn parse_shape(path: &str, value: &Value) -> Result<Option<ShapeItem>> {
    let map = obj(value, path)?;
    if flag(map, "hd") {
        return Ok(None);
    }
    let ty = map.get("ty").and_then(Value::as_str).unwrap_or("");
    let name = text(map, "nm").unwrap_or_default();
    let reversed = map.get("d").and_then(Value::as_i64).unwrap_or(1) == 3;
    let item = match ty {
        "gr" => {
            let mut items = Vec::new();
            for (idx, child) in map
                .get("it")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or_default()
                .iter()
                .enumerate()
            {
                if let Some(parsed) = parse_shape(&format!("{path}.it[{idx}]"), child)? {
                    items.push(parsed);
                }
            }
            ShapeItem::Group { items }
        }
        "sh" => ShapeItem::Path {
            path: parse_shape_property(
                &format!("{path}.ks"),
                map.get("ks").unwrap_or(&Value::Null),
            )?,
            reversed,
        },
        "rc" => ShapeItem::Rect {
            position: prop(path, map, "p", &[0.0, 0.0])?,
            size: prop(path, map, "s", &[0.0, 0.0])?,
            radius: prop(path, map, "r", &[0.0])?,
            reversed,
        },
        "el" => ShapeItem::Ellipse {
            position: prop(path, map, "p", &[0.0, 0.0])?,
            size: prop(path, map, "s", &[0.0, 0.0])?,
            reversed,
        },
        "sr" => ShapeItem::Star {
            position: prop(path, map, "p", &[0.0, 0.0])?,
            points: prop(path, map, "pt", &[5.0])?,
            rotation: prop(path, map, "r", &[0.0])?,
            outer_radius: prop(path, map, "or", &[0.0])?,
            outer_round: prop(path, map, "os", &[0.0])?,
            inner_radius: prop(path, map, "ir", &[0.0])?,
            inner_round: prop(path, map, "is", &[0.0])?,
            is_star: map.get("sy").and_then(Value::as_i64).unwrap_or(1) == 1,
        },
        "fl" => ShapeItem::Fill {
            color: prop(path, map, "c", &[0.0, 0.0, 0.0])?,
            opacity: prop(path, map, "o", &[100.0])?,
            even_odd: map.get("r").and_then(Value::as_i64).unwrap_or(1) == 2,
        },
        "gf" => ShapeItem::GradientFill {
            gradient: parse_gradient(path, map)?,
            opacity: prop(path, map, "o", &[100.0])?,
            even_odd: map.get("r").and_then(Value::as_i64).unwrap_or(1) == 2,
        },
        "st" => ShapeItem::Stroke {
            color: prop(path, map, "c", &[0.0, 0.0, 0.0])?,
            opacity: prop(path, map, "o", &[100.0])?,
            style: parse_stroke_style(path, map)?,
        },
        "gs" => ShapeItem::GradientStroke {
            gradient: parse_gradient(path, map)?,
            opacity: prop(path, map, "o", &[100.0])?,
            style: parse_stroke_style(path, map)?,
        },
        "tr" => ShapeItem::Transform(ShapeTransform {
            anchor: prop(path, map, "a", &[0.0, 0.0])?,
            position: prop(path, map, "p", &[0.0, 0.0])?,
            scale: prop(path, map, "s", &[100.0, 100.0])?,
            rotation: prop(path, map, "r", &[0.0])?,
            opacity: prop(path, map, "o", &[100.0])?,
            skew: prop(path, map, "sk", &[0.0])?,
            skew_axis: prop(path, map, "sa", &[0.0])?,
        }),
        "tm" => ShapeItem::Trim {
            start: prop(path, map, "s", &[0.0])?,
            end: prop(path, map, "e", &[100.0])?,
            offset: prop(path, map, "o", &[0.0])?,
            individually: map.get("m").and_then(Value::as_i64).unwrap_or(1) == 2,
        },
        "rd" => ShapeItem::RoundCorners {
            radius: prop(path, map, "r", &[0.0])?,
        },
        "mm" => match map.get("mm").and_then(Value::as_i64).unwrap_or(1) {
            1 => ShapeItem::MergeAppend,
            other => unsupported!(
                "{path}（\"{name}\"）：布尔合并路径（mm = {other}）；\
                 首版只做纯拼接 mm = 1，布尔运算需要一套路径求交/求差引擎"
            ),
        },
        "rp" => unsupported!("{path}（\"{name}\"）：重复器（rp）；首版不支持"),
        other => unsupported!("{path}（\"{name}\"）：未知形状条目 ty = \"{other}\""),
    };
    Ok(Some(item))
}

fn parse_stroke_style(path: &str, map: &serde_json::Map<String, Value>) -> Result<StrokeStyle> {
    // bodymovin: lc/lj 1=butt/miter 2=round 3=square/bevel
    let cap = match map.get("lc").and_then(Value::as_i64).unwrap_or(2) {
        1 => 0,
        3 => 2,
        _ => 1,
    };
    let join = match map.get("lj").and_then(Value::as_i64).unwrap_or(2) {
        1 => 0,
        3 => 2,
        _ => 1,
    };
    let mut dashes = Vec::new();
    let mut dash_offset = None;
    for (idx, entry) in map
        .get("d")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .enumerate()
    {
        let Some(item) = entry.as_object() else {
            continue;
        };
        let dpath = format!("{path}.d[{idx}]");
        let parsed = value::parse_property_or(&dpath, item.get("v"), &[0.0])?;
        match item.get("n").and_then(Value::as_str).unwrap_or("d") {
            "o" => dash_offset = Some(parsed),
            _ => dashes.push(parsed),
        }
    }
    Ok(StrokeStyle {
        width: prop(path, map, "w", &[1.0])?,
        cap,
        join,
        miter: num(map, "ml").unwrap_or(4.0),
        dashes,
        dash_offset,
    })
}

fn parse_gradient(path: &str, map: &serde_json::Map<String, Value>) -> Result<Gradient> {
    let g = map.get("g").and_then(Value::as_object);
    let stop_count = g
        .and_then(|g| g.get("p"))
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .max(0) as usize;
    let stops = match g.and_then(|g| g.get("k")) {
        Some(k) => value::parse_property(&format!("{path}.g.k"), k)?,
        None => Animated::constant(Vec::new()),
    };
    Ok(Gradient {
        start: prop(path, map, "s", &[0.0, 0.0])?,
        end: prop(path, map, "e", &[0.0, 0.0])?,
        radial: map.get("t").and_then(Value::as_i64).unwrap_or(1) == 2,
        highlight_length: prop(path, map, "h", &[0.0])?,
        highlight_angle: prop(path, map, "a", &[0.0])?,
        stop_count,
        stops,
    })
}

/// `#rrggbb` → 0..1 三分量。
fn parse_hex_color(text: &str) -> [f64; 3] {
    let hex = text.trim_start_matches('#');
    let byte = |i: usize| -> f64 {
        u8::from_str_radix(hex.get(i..i + 2).unwrap_or("00"), 16).unwrap_or(0) as f64 / 255.0
    };
    if hex.len() < 6 {
        return [0.0; 3];
    }
    [byte(0), byte(2), byte(4)]
}

/// `data:image/png;base64,....` → 字节。自带 base64 解码，不为一个内嵌图
/// 资源加一条依赖。不带 `;base64` 的（常见于 `data:image/svg+xml;utf8,<svg…>`）按 URL 百分号编码解。
fn decode_data_uri(path: &str, uri: &str) -> Result<Vec<u8>> {
    let Some((header, payload)) = uri.split_once(',') else {
        bail!("lottie-parse: {path} 声明为内嵌资源（e = 1），但 p 不是 data URI");
    };
    if !header
        .split(';')
        .any(|part| part.trim().eq_ignore_ascii_case("base64"))
    {
        return percent_decode(path, payload);
    }
    let mut out = Vec::with_capacity(payload.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits = 0u32;
    for ch in payload.bytes() {
        let sextet = match ch {
            b'A'..=b'Z' => u32::from(ch - b'A'),
            b'a'..=b'z' => u32::from(ch - b'a') + 26,
            b'0'..=b'9' => u32::from(ch - b'0') + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' | b'\n' | b'\r' | b' ' | b'\t' => continue,
            other => bail!("lottie-parse: {path} 的 base64 里有非法字符 0x{other:02x}"),
        };
        acc = (acc << 6) | sextet;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((acc >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

/// data URI 的百分号编码：`%XX` 换成那个字节，其余原样。
fn percent_decode(path: &str, payload: &str) -> Result<Vec<u8>> {
    let bytes = payload.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let byte = payload
                .get(at + 1..at + 3)
                .and_then(|hex| u8::from_str_radix(hex, 16).ok())
                .ok_or_else(|| {
                    anyhow::anyhow!("lottie-parse: {path} 的 data URI 里有坏的百分号编码")
                })?;
            out.push(byte);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    Ok(out)
}

/// 颜色属性求值：Lottie 用 0..1，很老的导出器用 0..255。
pub fn color_at(color: &Animated, frame: f64) -> [f64; 3] {
    let v = color.value(frame);
    let mut rgb = [
        v.first().copied().unwrap_or(0.0),
        v.get(1).copied().unwrap_or(0.0),
        v.get(2).copied().unwrap_or(0.0),
    ];
    if rgb.iter().any(|c| *c > 1.0) {
        for c in rgb.iter_mut() {
            *c /= 255.0;
        }
    }
    rgb
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn minimal(layers: Value) -> Value {
        json!({"v": "5.7.0", "fr": 30, "ip": 0, "op": 30, "w": 100, "h": 100, "layers": layers})
    }

    fn parse_ok(doc: &Value) -> (Animation, Vec<PreflightDiagnostic>) {
        let mut diagnostics = Diagnostics::default();
        let animation = parse("t", doc, &mut diagnostics).unwrap();
        (animation, diagnostics.into_inner())
    }

    fn parse_err(doc: &Value) -> String {
        let mut diagnostics = Diagnostics::default();
        parse("t", doc, &mut diagnostics).unwrap_err().to_string()
    }

    fn shape_layer(shapes: Value) -> Value {
        json!({"ty": 4, "ind": 1, "ip": 0, "op": 30, "st": 0, "ks": {}, "shapes": shapes})
    }

    #[test]
    fn a_shape_layer_parses_with_its_transform_defaults() {
        let (animation, diagnostics) = parse_ok(&minimal(json!([shape_layer(json!([]))])));
        assert!(diagnostics.is_empty());
        assert_eq!(animation.layers.len(), 1);
        let m = animation.layers[0].transform.matrix(0.0);
        assert_eq!(m, Affine::IDENTITY, "缺省变换必须是单位阵");
        assert_eq!(animation.layers[0].transform.alpha(0.0), 1.0);
    }

    #[test]
    fn text_layers_expressions_and_boolean_merges_are_refused_by_name() {
        for (doc, needle) in [
            (
                minimal(json!([{"ty": 5, "ip": 0, "op": 30, "ks": {}}])),
                "文字图层",
            ),
            (
                minimal(json!([shape_layer(json!([{"ty": "mm", "mm": 2}]))])),
                "布尔合并路径",
            ),
            (
                minimal(json!([shape_layer(json!([{"ty": "rp"}]))])),
                "重复器",
            ),
            (
                minimal(json!([{"ty": 4, "ddd": 1, "ip": 0, "op": 30, "ks": {}}])),
                "3D",
            ),
            (
                minimal(json!([{"ty": 4, "ao": 1, "ip": 0, "op": 30, "ks": {}}])),
                "自动定向",
            ),
            (
                minimal(
                    json!([{"ty": 4, "ip": 0, "op": 30, "ks": {"o": {"a": 0, "k": 100, "x": "t"}}}]),
                ),
                "表达式",
            ),
            (
                minimal(json!([{"ty": 4, "ip": 0, "op": 30, "ks": {},
                    "ef": [{"ty": 29, "nm": "Gaussian Blur"}]}])),
                "光栅效果",
            ),
            (
                minimal(json!([{"ty": 4, "ip": 0, "op": 30, "ks": {},
                    "masksProperties": [{"mode": "s", "pt": {"a": 0, "k": {}}}]}])),
                "遮罩模式",
            ),
        ] {
            let error = parse_err(&doc);
            assert!(
                error.contains("lottie-unsupported-feature") && error.contains(needle),
                "期望 {needle} 的 fail-fast，实际：{error}"
            );
        }
    }

    #[test]
    fn expression_control_groups_only_warn() {
        let (_, diagnostics) = parse_ok(&minimal(json!([{
            "ty": 4, "ind": 1, "ip": 0, "op": 30, "ks": {},
            "nm": "ctrl",
            "ef": [{"ty": 5, "nm": "控制组", "ef": [{"ty": 0, "nm": "滑块"}]}]
        }])));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].rule, super::super::LOTTIE_RULE);
        assert!(diagnostics[0].message.contains("表达式控制器"));
    }

    #[test]
    fn every_supported_blend_mode_maps_and_the_rest_fail() {
        for (code, expected) in [
            (0, BlendMode::Normal),
            (1, BlendMode::Multiply),
            (5, BlendMode::Lighten),
            (11, BlendMode::Exclusion),
            (16, BlendMode::Plus),
        ] {
            let doc = minimal(json!([{"ty": 4, "ip": 0, "op": 30, "ks": {}, "bm": code}]));
            assert_eq!(parse_ok(&doc).0.layers[0].blend, expected);
        }
        // 属性对象形态的 bm 也认
        let doc = minimal(json!([{"ty": 4, "ip": 0, "op": 30, "ks": {}, "bm": {"a": 0, "k": 5}}]));
        assert_eq!(parse_ok(&doc).0.layers[0].blend, BlendMode::Lighten);
        let doc = minimal(json!([{"ty": 4, "ip": 0, "op": 30, "ks": {}, "bm": 9}]));
        assert!(parse_err(&doc).contains("混合模式"));
    }

    #[test]
    fn a_split_position_reads_both_axes() {
        let doc = minimal(json!([{"ty": 4, "ip": 0, "op": 30, "ks": {
            "p": {"s": true, "x": {"a": 0, "k": 12}, "y": {"a": 0, "k": 34}}
        }}]));
        let m = parse_ok(&doc).0.layers[0].transform.matrix(0.0);
        assert_eq!((m.tx, m.ty), (12.0, 34.0));
    }

    #[test]
    fn a_data_uri_image_asset_decodes_inline() {
        let doc = json!({"v": "5.7.0", "fr": 30, "ip": 0, "op": 30, "w": 10, "h": 10,
            "assets": [{"id": "i", "w": 1, "h": 1, "e": 1, "p": "data:image/png;base64,QUJD"}],
            "layers": []});
        let asset = &parse_ok(&doc).0.images["i"];
        assert_eq!(asset.embedded.as_deref(), Some(b"ABC".as_slice()));
        assert!(asset.path.is_none());
    }

    #[test]
    fn an_animated_shape_interpolates_vertex_by_vertex() {
        let shape = parse_shape_property(
            "t",
            &json!({"a": 1, "k": [
                {"t": 0, "s": [{"v": [[0.0, 0.0]], "i": [[0.0, 0.0]], "o": [[0.0, 0.0]], "c": true}],
                 "o": {"x": 0.0, "y": 0.0}, "i": {"x": 1.0, "y": 1.0}},
                {"t": 10, "s": [{"v": [[10.0, 0.0]], "i": [[0.0, 0.0]], "o": [[0.0, 0.0]], "c": true}]}
            ]}),
        )
        .unwrap();
        assert!(!shape.is_static());
        assert!((shape.value(5.0).v[0][0] - 5.0).abs() < 1e-9);
        assert_eq!(shape.value(20.0).v[0][0], 10.0);
    }

    #[test]
    fn an_animated_shape_needs_no_a_flag_either() {
        let contour =
            |x: f64| json!({"v": [[x, 0.0]], "i": [[0.0, 0.0]], "o": [[0.0, 0.0]], "c": true});
        // 没有 `a`：仍按关键帧解析（信 `a` 会走进 parse_contour 得到空轮廓，
        // 形状直接从画面上消失）
        let shape = parse_shape_property(
            "t",
            &json!({"k": [
                {"t": 0, "s": [contour(0.0)],
                 "o": {"x": 0.0, "y": 0.0}, "i": {"x": 1.0, "y": 1.0}},
                {"t": 10, "s": [contour(10.0)]}
            ]}),
        )
        .unwrap();
        assert!(!shape.is_static());
        assert!((shape.value(5.0).v[0][0] - 5.0).abs() < 1e-9);
        // 老格式的纯终止符末项：终值回到前一帧的 `e`
        let legacy = parse_shape_property(
            "t",
            &json!({"a": 1, "k": [
                {"t": 0, "s": [contour(0.0)], "e": [contour(8.0)],
                 "o": {"x": 0.0, "y": 0.0}, "i": {"x": 1.0, "y": 1.0}},
                {"t": 10}
            ]}),
        )
        .unwrap();
        assert!((legacy.value(5.0).v[0][0] - 4.0).abs() < 1e-9);
        assert_eq!(
            legacy.value(99.0).v[0][0],
            8.0,
            "末端冻结在 8，而不是空轮廓"
        );
    }

    #[test]
    fn colours_accept_both_the_unit_and_the_byte_convention() {
        let unit = Animated::constant(vec![1.0, 0.5, 0.0]);
        assert_eq!(color_at(&unit, 0.0), [1.0, 0.5, 0.0]);
        let byte = Animated::constant(vec![255.0, 128.0, 0.0]);
        let rgb = color_at(&byte, 0.0);
        assert!((rgb[0] - 1.0).abs() < 1e-12 && (rgb[1] - 128.0 / 255.0).abs() < 1e-12);
    }
}
