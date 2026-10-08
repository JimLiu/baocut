//! 阶段 1 冻结的四种专用配方形状（ADR-M08）。**不要改写这些解析路径**：
//! `timeline.*@1` / `bcf.*@1` / 转场配方已发布，像素必须逐位不变。
//! 新配方走 `manifest.rs` 的通用 manifest 形状（设计 §5.4.1）。

use serde_json::Value;

use crate::MotionError;
use crate::curve::CurveSpec;
use crate::loop_kernel::{
    EnvelopeKind, EnvelopeSpec, NoiseKind, NoiseSpec, WaveKind, channel_ordinal,
};
use crate::relative_value::{LengthBasis, RelativeLength};
use crate::text_parts::{PartUnit, StaggerPlan};

use super::json::{field, number, parse_curve, parse_length, text, version};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Slot {
    Enter,
    Exit,
    Loop,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SlotChannels {
    pub opacity: Option<f64>,
    pub dx: Option<f64>,
    pub dy: Option<f64>,
    pub scale_x: Option<f64>,
    pub scale_y: Option<f64>,
    pub rotation: Option<f64>,
    pub blur: Option<f64>,
    pub reveal: Option<f64>,
}

impl SlotChannels {
    pub fn get(&self, channel: &str) -> Option<f64> {
        match channel {
            "opacity" => self.opacity,
            "dx" => self.dx,
            "dy" => self.dy,
            "scaleX" => self.scale_x,
            "scaleY" => self.scale_y,
            "rotation" => self.rotation,
            "blur" => self.blur,
            "reveal" => self.reveal,
            _ => None,
        }
    }

    fn set(&mut self, channel: &str, value: f64) -> Result<(), MotionError> {
        match channel {
            "opacity" => self.opacity = Some(value),
            "dx" => self.dx = Some(value),
            "dy" => self.dy = Some(value),
            "scaleX" => self.scale_x = Some(value),
            "scaleY" => self.scale_y = Some(value),
            "rotation" => self.rotation = Some(value),
            "blur" => self.blur = Some(value),
            "reveal" => self.reveal = Some(value),
            other => {
                return Err(MotionError::ManifestInvalid(format!(
                    "unknown pose channel \"{other}\""
                )));
            }
        }
        Ok(())
    }
}

/// 配方面向哪类元素的目录（2026-09-08，元素动画目录）。核心求值不读它：
/// 它只决定 `enter_ids()`（文字目录）与 `element_enter_ids()`（形状/图片/
/// 视频目录）各自列出哪些行。缺省 `any` = 两张目录都列。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RecipeSurface {
    #[default]
    Any,
    Text,
    Element,
}

impl RecipeSurface {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "any" => Some(Self::Any),
            "text" => Some(Self::Text),
            "element" => Some(Self::Element),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Any => "any",
            Self::Text => "text",
            Self::Element => "element",
        }
    }
}

/// `dx` / `dy` 的长度基准（配方 `basis` 字段）。冻结目录全部是
/// `canvasShortEdge`（pose 的 dx/dy 是画布短边比例）；元素动画配方是
/// `selfWidth` / `selfHeight`（x:1 = 一个元素宽）。lowering 用
/// [`crate::lower_timeline::ElementExtent`] 把后者换算成短边比例，调用方没给
/// 元素尺寸时按 1 短边近似（见 `lower_timeline` 文档）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TranslateBasis {
    pub dx: LengthBasis,
    pub dy: LengthBasis,
}

impl Default for TranslateBasis {
    fn default() -> Self {
        Self {
            dx: LengthBasis::CanvasShortEdge,
            dy: LengthBasis::CanvasShortEdge,
        }
    }
}

/// 多关键帧配方（元素动画）的一帧：`at` 是槽时长内的 0…1，
/// `curve` 是**到达本帧**那一段的缓动（首帧的 curve 无用），
/// `channels` 没写的通道 = 本帧取 identity。
#[derive(Clone, Debug, PartialEq)]
pub struct SlotKeyframe {
    pub at: f64,
    pub curve: CurveSpec,
    pub channels: SlotChannels,
}

fn parse_keyframes(file: &str, value: &Value) -> Result<Vec<SlotKeyframe>, MotionError> {
    let list = value.as_array().ok_or_else(|| {
        MotionError::ManifestInvalid(format!("{file}: \"keyframes\" is not an array"))
    })?;
    if list.len() < 2 {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: \"keyframes\" needs at least two frames"
        )));
    }
    let mut out = Vec::with_capacity(list.len());
    for (index, frame) in list.iter().enumerate() {
        let object = frame.as_object().ok_or_else(|| {
            MotionError::ManifestInvalid(format!("{file}: keyframe {index} is not an object"))
        })?;
        let at = number(file, frame, "at")?;
        if !(0.0..=1.0).contains(&at) {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: keyframe {index} \"at\" {at} is outside 0..1"
            )));
        }
        if let Some(previous) = out.last().map(|k: &SlotKeyframe| k.at)
            && at < previous
        {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: keyframe {index} \"at\" {at} goes backwards"
            )));
        }
        let curve = match object.get("ease") {
            Some(name) => {
                let name = name.as_str().ok_or_else(|| {
                    MotionError::ManifestInvalid(format!(
                        "{file}: keyframe {index} \"ease\" is not a string"
                    ))
                })?;
                let curve = CurveSpec::from_name(name);
                if matches!(curve, CurveSpec::Unknown(_)) {
                    return Err(MotionError::ManifestInvalid(format!(
                        "{file}: keyframe {index} unknown ease \"{name}\""
                    )));
                }
                curve
            }
            None => CurveSpec::from_name("linear"),
        };
        let mut channels = SlotChannels::default();
        for (key, raw) in object {
            if key == "at" || key == "ease" {
                continue;
            }
            let n = raw.as_f64().ok_or_else(|| {
                MotionError::ManifestInvalid(format!(
                    "{file}: keyframe {index} channel \"{key}\" is not a number"
                ))
            })?;
            channels.set(key, n)?;
        }
        out.push(SlotKeyframe {
            at,
            curve,
            channels,
        });
    }
    if out[0].at != 0.0 || out[out.len() - 1].at != 1.0 {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: \"keyframes\" must start at 0 and end at 1"
        )));
    }
    Ok(out)
}

fn parse_surface(file: &str, doc: &Value) -> Result<RecipeSurface, MotionError> {
    match doc.get("surface") {
        None => Ok(RecipeSurface::Any),
        Some(value) => {
            let name = value.as_str().ok_or_else(|| {
                MotionError::ManifestInvalid(format!("{file}: \"surface\" is not a string"))
            })?;
            RecipeSurface::parse(name).ok_or_else(|| {
                MotionError::ManifestInvalid(format!("{file}: unknown surface \"{name}\""))
            })
        }
    }
}

fn parse_basis(file: &str, doc: &Value) -> Result<TranslateBasis, MotionError> {
    let Some(value) = doc.get("basis") else {
        return Ok(TranslateBasis::default());
    };
    let axis = |key: &str| -> Result<LengthBasis, MotionError> {
        match value.get(key) {
            None => Ok(LengthBasis::CanvasShortEdge),
            Some(raw) => {
                let name = raw.as_str().ok_or_else(|| {
                    MotionError::ManifestInvalid(format!("{file}: basis.{key} is not a string"))
                })?;
                match LengthBasis::parse(name) {
                    Some(
                        basis @ (LengthBasis::CanvasShortEdge
                        | LengthBasis::SelfWidth
                        | LengthBasis::SelfHeight),
                    ) => Ok(basis),
                    _ => Err(MotionError::ManifestInvalid(format!(
                        "{file}: basis.{key} \"{name}\" is not a pose translate basis"
                    ))),
                }
            }
        }
    };
    Ok(TranslateBasis {
        dx: axis("dx")?,
        dy: axis("dy")?,
    })
}

#[derive(Clone, Debug, PartialEq)]
pub struct SlotRecipe {
    pub id: String,
    pub version: u32,
    pub slot: Slot,
    pub order: usize,
    pub duration: f64,
    pub curve: CurveSpec,
    pub opacity_curve: Option<CurveSpec>,
    pub mirror: Option<String>,
    pub from: SlotChannels,
    pub parts: Option<StaggerPlan>,
    pub determinism: String,
    /// **表面目录**开关（ADR-M09），不是内核门。核心求值（`lower_timeline`）
    /// 从不读它，`bcut render` 照样画得出 `available: false` 的配方；它只回答
    /// "GPUI/Mac 的动画面板里能不能选到这一行"。`wipe` 在两个客户端上都还没有
    /// 元素包围盒可裁，所以两处目录都藏着它。
    pub available: bool,
    pub manifest_hash: u64,
    /// 多关键帧形态（2026-09-08）。非空时 `from` 可为空、`curve` 不参与插值、
    /// `parts` 必须缺席；每通道按相邻关键帧逐段 tween。
    pub keyframes: Vec<SlotKeyframe>,
    pub surface: RecipeSurface,
    pub basis: TranslateBasis,
    /// `reveal` 的扫掠边（`left` / `right` / `top` / `bottom`），槽没给 edge 时用。
    pub edge: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LoopRecipe {
    pub id: String,
    pub version: u32,
    pub order: usize,
    pub period: f64,
    pub amplitudes: SlotChannels,
    pub wave: WaveKind,
    pub wave_samples: usize,
    pub noise: Option<NoiseSpec>,
    pub channel_seed_stride: u64,
    pub default_seed: u64,
    pub envelope: EnvelopeSpec,
    pub determinism: String,
    pub available: bool,
    pub manifest_hash: u64,
    /// 多关键帧循环（2026-09-08）：`at` 是周期内 0…1，逐段插值、包络恒 1；
    /// 非空时 `amplitudes` / `wave` 不参与求值。
    pub keyframes: Vec<SlotKeyframe>,
    pub surface: RecipeSurface,
    pub basis: TranslateBasis,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BcfPreset {
    pub id: String,
    pub version: u32,
    pub order: usize,
    pub emits_params_meta: bool,
    /// `{params?, keyframes}` —— 与 `resolve.rs::BUILTIN_PRESETS` 的内层对象逐字相同。
    pub definition: Value,
    pub manifest_hash: u64,
}

/// 转场配方的**一条**属性通道（设计 §6.4）。
///
/// 两个关键帧固定落在 `t0 ± half`，只有第二帧带 ease——规范 §9 的双通道语义。
#[derive(Clone, Debug, PartialEq)]
pub struct TransitionChannel {
    pub prop: String,
    pub ease: Option<String>,
    pub from: RelativeLength,
    pub to: RelativeLength,
}

/// 一侧（out / in）的通道表。`cut` 两侧都是空表。
///
/// 阶段 1 发布的五条配方每侧只有一条通道，manifest 里写的是
/// `{"prop": …, "ease": …, "out": {"from": …, "to": …}}` 的**单通道糖**；
/// 阶段 5 的 `zoomThrough` / `whipPan` 每侧两条、`wipeLeft/Right` 两侧的
/// `prop` 还不同，因此 manifest 允许写 `{"channels": [...]}`。两种写法解析
/// 成同一个结构，`bcf.*.json` 的五份旧文件一字未改。
#[derive(Clone, Debug, PartialEq)]
pub struct TransitionRecipe {
    pub id: String,
    pub version: u32,
    pub order: usize,
    /// 单通道糖的默认 `prop`（写了 `channels` 时为 `None`）。
    pub prop: Option<String>,
    /// 通道没写 `ease` 时的默认 ease。
    pub ease: Option<String>,
    pub out: Vec<TransitionChannel>,
    pub r#in: Vec<TransitionChannel>,
    pub manifest_hash: u64,
}

impl TransitionRecipe {
    pub fn side(&self, is_out: bool) -> &[TransitionChannel] {
        if is_out { &self.out } else { &self.r#in }
    }

    /// 这条配方一个通道都不产（`cut`）。
    pub fn is_cut(&self) -> bool {
        self.out.is_empty() && self.r#in.is_empty()
    }
}

/// 字幕入场姿态配方的一条通道（`transition.caption.*@1`）。
///
/// 取值 = `factor × scaleBy × (a + b·e)`，`e` 是曲线取值。**求值顺序是契约**：
/// `magic-fade` 的 blur 原式是 `6.0 × canvasScale × (1 − e)`，先乘 canvasScale
/// 再乘括号；写成 `(6 − 6e) × canvasScale` 就是另一串浮点、另一批字幕像素。
#[derive(Clone, Debug, PartialEq)]
pub struct CaptionChannel {
    /// `opacity` / `scale` / `scaleX` / `scaleY` / `blur`。
    pub prop: String,
    pub factor: f64,
    pub a: f64,
    pub b: f64,
    /// `none`（乘 1）或 `canvasScale`（乘调用方给的画布缩放）。
    pub scale_by: String,
    pub clamp01: bool,
    pub clamp_min: Option<f64>,
}

/// 字幕入场姿态配方（阶段 5 收编的 `magic-fade` / `magic-pop` / `magic-flip`）。
///
/// 与 [`TransitionRecipe`] 不是一类东西：它不产生 BCF 通道，而是**按 clip 的
/// 显示起点给一条相位**，由 `studio_export` 的字幕合成直接消费。曲线求解器与
/// 相位量化都写进 manifest，因为两者都直接决定字幕像素。
#[derive(Clone, Debug, PartialEq)]
pub struct CaptionTransitionRecipe {
    pub id: String,
    pub version: u32,
    pub order: usize,
    /// Studio / Mac / GPUI 里那个历史 id（`magic-fade` …）。持久化写的是它。
    pub legacy_id: String,
    pub curve: CurveSpec,
    /// 曲线求解器的名字。闭集：`newton6-bisect10-1e-6`（历史实现）。
    pub solver: String,
    /// 相位量化规则。闭集：`round-both-ends` ——
    /// `((t×fps).round()/fps − (start×fps).round()/fps) / dur`。
    pub time_quantization: String,
    pub channels: Vec<CaptionChannel>,
    pub determinism: String,
    pub manifest_hash: u64,
}

impl CaptionTransitionRecipe {
    /// 相位。**两端都按 fps 取整**（`round-both-ends`）：字幕姿态跟的是帧号，
    /// 不是连续时间，否则同一帧在不同 seek 路径下会给出不同的姿态。
    pub fn phase(&self, time: f64, display_start: f64, duration: f64, fps: f64) -> f64 {
        let fps = fps.max(1.0);
        match self.time_quantization.as_str() {
            "round-both-ends" => {
                ((time * fps).round() / fps - (display_start * fps).round() / fps) / duration
            }
            _ => (time - display_start) / duration,
        }
    }

    /// 曲线取值。求解器按 manifest 的 `solver` 选——两条实现最大差 2.2e-6，
    /// 落到 u8 上就是像素差（见 [`crate::curve::cubic_bezier_caption`]）。
    pub fn eased(&self, phase: f64) -> f64 {
        let progress = phase.clamp(0.0, 1.0);
        match (&self.curve, self.solver.as_str()) {
            (CurveSpec::CubicBezier { x1, y1, x2, y2 }, "newton6-bisect10-1e-6") => {
                crate::curve::cubic_bezier_caption(*x1, *y1, *x2, *y2, progress)
            }
            _ => crate::curve::sample_curve(&self.curve, progress),
        }
    }

    /// 一条通道在给定曲线取值下的值。
    pub fn channel_value(&self, channel: &CaptionChannel, eased: f64, canvas_scale: f64) -> f64 {
        let scale = match channel.scale_by.as_str() {
            "canvasScale" => canvas_scale,
            _ => 1.0,
        };
        let mut value = channel.factor * scale * (channel.a + channel.b * eased);
        if channel.clamp01 {
            value = value.clamp(0.0, 1.0);
        }
        if let Some(min) = channel.clamp_min {
            value = value.max(min);
        }
        value
    }
}

const CAPTION_PROPS: &[&str] = &["opacity", "scale", "scaleX", "scaleY", "blur"];
const CAPTION_SOLVERS: &[&str] = &["newton6-bisect10-1e-6"];
const CAPTION_QUANTIZATIONS: &[&str] = &["round-both-ends"];
const CAPTION_SCALE_BASES: &[&str] = &["none", "canvasScale"];

pub(crate) fn parse_caption_transition(
    file: &str,
    doc: &Value,
    manifest_hash: u64,
) -> Result<CaptionTransitionRecipe, MotionError> {
    let bad = |what: String| MotionError::ManifestInvalid(format!("{file}: {what}"));
    let curve_doc = field(file, doc, "curve")?;
    let solver = text(file, curve_doc, "solver")?.to_owned();
    if !CAPTION_SOLVERS.contains(&solver.as_str()) {
        return Err(bad(format!("unknown curve solver \"{solver}\"")));
    }
    if text(file, curve_doc, "kind")? != "cubicBezier" {
        return Err(bad("caption transition curve must be cubicBezier".into()));
    }
    let curve = CurveSpec::CubicBezier {
        x1: number(file, curve_doc, "x1")?,
        y1: number(file, curve_doc, "y1")?,
        x2: number(file, curve_doc, "x2")?,
        y2: number(file, curve_doc, "y2")?,
    };
    let time_quantization = text(file, doc, "timeQuantization")?.to_owned();
    if !CAPTION_QUANTIZATIONS.contains(&time_quantization.as_str()) {
        return Err(bad(format!(
            "unknown timeQuantization \"{time_quantization}\""
        )));
    }
    let list = field(file, doc, "channels")?
        .as_array()
        .ok_or_else(|| bad("\"channels\" is not an array".into()))?;
    if list.is_empty() {
        return Err(bad("\"channels\" is empty".into()));
    }
    let mut channels = Vec::with_capacity(list.len());
    for item in list {
        let prop = text(file, item, "prop")?.to_owned();
        if !CAPTION_PROPS.contains(&prop.as_str()) {
            return Err(bad(format!("unknown caption channel \"{prop}\"")));
        }
        let scale_by = item
            .get("scaleBy")
            .and_then(Value::as_str)
            .unwrap_or("none")
            .to_owned();
        if !CAPTION_SCALE_BASES.contains(&scale_by.as_str()) {
            return Err(bad(format!("unknown scaleBy \"{scale_by}\"")));
        }
        channels.push(CaptionChannel {
            prop,
            factor: number(file, item, "factor")?,
            a: number(file, item, "a")?,
            b: number(file, item, "b")?,
            scale_by,
            clamp01: item
                .get("clamp01")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            clamp_min: item.get("clampMin").and_then(Value::as_f64),
        });
    }
    Ok(CaptionTransitionRecipe {
        id: text(file, doc, "id")?.to_owned(),
        version: version(file, doc)?,
        order: field(file, doc, "order")?.as_u64().unwrap_or(0) as usize,
        legacy_id: text(file, doc, "legacyId")?.to_owned(),
        curve,
        solver,
        time_quantization,
        channels,
        determinism: text(file, doc, "determinism")?.to_owned(),
        manifest_hash,
    })
}

pub(crate) fn parse_channels(file: &str, value: &Value) -> Result<SlotChannels, MotionError> {
    let mut channels = SlotChannels::default();
    let object = value.as_object().ok_or_else(|| {
        MotionError::ManifestInvalid(format!("{file}: channel table is not an object"))
    })?;
    for (key, raw) in object {
        let n = raw.as_f64().ok_or_else(|| {
            MotionError::ManifestInvalid(format!("{file}: channel \"{key}\" is not a number"))
        })?;
        channels.set(key, n)?;
    }
    Ok(channels)
}

pub(crate) fn parse_slot(
    file: &str,
    doc: &Value,
    slot: Slot,
    manifest_hash: u64,
) -> Result<SlotRecipe, MotionError> {
    let parts = match doc.get("parts") {
        Some(value) => {
            let unit = match text(file, value, "unit")? {
                "grapheme" => PartUnit::Char,
                "word" => PartUnit::Word,
                other => {
                    return Err(MotionError::ManifestInvalid(format!(
                        "{file}: unknown part unit \"{other}\""
                    )));
                }
            };
            Some(StaggerPlan {
                unit,
                part_dur: number(file, value, "partDur")?,
                stagger: number(file, value, "stagger")?,
            })
        }
        None => None,
    };
    let keyframes = match doc.get("keyframes") {
        Some(value) => parse_keyframes(file, value)?,
        None => Vec::new(),
    };
    if !keyframes.is_empty() && parts.is_some() {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: \"keyframes\" and \"parts\" are mutually exclusive"
        )));
    }
    let edge = match doc.get("edge") {
        None => None,
        Some(value) => {
            let name = value.as_str().ok_or_else(|| {
                MotionError::ManifestInvalid(format!("{file}: \"edge\" is not a string"))
            })?;
            if !matches!(name, "left" | "right" | "top" | "bottom") {
                return Err(MotionError::ManifestInvalid(format!(
                    "{file}: unknown reveal edge \"{name}\""
                )));
            }
            Some(name.to_owned())
        }
    };
    Ok(SlotRecipe {
        id: text(file, doc, "id")?.to_owned(),
        version: version(file, doc)?,
        slot,
        order: field(file, doc, "order")?.as_u64().unwrap_or(0) as usize,
        duration: number(file, doc, "duration")?,
        curve: parse_curve(file, field(file, doc, "curve")?)?,
        opacity_curve: match doc.get("opacityCurve") {
            Some(value) => Some(parse_curve(file, value)?),
            None => None,
        },
        mirror: doc.get("mirror").and_then(Value::as_str).map(str::to_owned),
        from: parse_channels(file, field(file, doc, "from")?)?,
        parts,
        determinism: text(file, doc, "determinism")?.to_owned(),
        available: doc
            .get("available")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        manifest_hash,
        keyframes,
        surface: parse_surface(file, doc)?,
        basis: parse_basis(file, doc)?,
        edge,
    })
}

pub(crate) fn parse_loop(
    file: &str,
    doc: &Value,
    manifest_hash: u64,
) -> Result<LoopRecipe, MotionError> {
    let keyframes = match doc.get("keyframes") {
        Some(value) => parse_keyframes(file, value)?,
        None => Vec::new(),
    };
    if !keyframes.is_empty() {
        return parse_keyframe_loop(file, doc, manifest_hash, keyframes);
    }
    let wave_doc = field(file, doc, "wave")?;
    let wave = WaveKind::parse(text(file, wave_doc, "kind")?)
        .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: unknown wave kind")))?;
    let wave_samples = field(file, wave_doc, "samples")?
        .as_u64()
        .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: bad wave.samples")))?
        as usize;
    let default_seed = field(file, doc, "defaultSeed")?
        .as_u64()
        .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: bad defaultSeed")))?;
    let noise = match wave_doc.get("noise") {
        Some(value) => {
            let kind = NoiseKind::parse(text(file, value, "kind")?).ok_or_else(|| {
                MotionError::ManifestInvalid(format!(
                    "{file}: unknown noise kernel \"{}\"",
                    text(file, value, "kind").unwrap_or_default()
                ))
            })?;
            Some(NoiseSpec {
                kind,
                lattice: field(file, value, "lattice")?.as_i64().ok_or_else(|| {
                    MotionError::ManifestInvalid(format!("{file}: bad noise.lattice"))
                })?,
                default_seed,
            })
        }
        None => None,
    };
    let envelope_doc = field(file, doc, "envelope")?;
    let envelope = EnvelopeSpec {
        kind: EnvelopeKind::parse(text(file, envelope_doc, "kind")?).ok_or_else(|| {
            MotionError::ManifestInvalid(format!("{file}: unknown envelope kernel"))
        })?,
        ramp_cap: number(file, envelope_doc, "rampCap")?,
        ramp_fraction: number(file, envelope_doc, "rampFraction")?,
        tail_threshold_sec: number(file, envelope_doc, "tailThresholdSec")?,
        tail_start: number(file, envelope_doc, "tailStart")?,
        tail_span: number(file, envelope_doc, "tailSpan")?,
    };
    let amplitudes = parse_channels(file, field(file, doc, "amplitudes")?)?;
    for channel in ["opacity", "dx", "dy", "scaleX", "scaleY", "rotation"] {
        if amplitudes.get(channel).is_some() && channel_ordinal(channel).is_none() {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: channel \"{channel}\" has no seed ordinal"
            )));
        }
    }
    if amplitudes.blur.is_some() || amplitudes.reveal.is_some() {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: loop recipes cannot drive blur/reveal"
        )));
    }
    Ok(LoopRecipe {
        id: text(file, doc, "id")?.to_owned(),
        version: version(file, doc)?,
        order: field(file, doc, "order")?.as_u64().unwrap_or(0) as usize,
        period: number(file, doc, "period")?,
        amplitudes,
        wave,
        wave_samples,
        noise,
        channel_seed_stride: field(file, doc, "channelSeedStride")?
            .as_u64()
            .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: bad seed stride")))?,
        default_seed,
        envelope,
        determinism: text(file, doc, "determinism")?.to_owned(),
        available: doc
            .get("available")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        manifest_hash,
        keyframes: Vec::new(),
        surface: parse_surface(file, doc)?,
        basis: parse_basis(file, doc)?,
    })
}

/// 多关键帧循环：没有波形、seed 与包络，`amplitudes` 可缺席（缺席 = 空表）。
/// 关键帧不得驱动 blur / reveal（与波形循环同一条禁令）。
fn parse_keyframe_loop(
    file: &str,
    doc: &Value,
    manifest_hash: u64,
    keyframes: Vec<SlotKeyframe>,
) -> Result<LoopRecipe, MotionError> {
    for frame in &keyframes {
        if frame.channels.blur.is_some() || frame.channels.reveal.is_some() {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: loop recipes cannot drive blur/reveal"
            )));
        }
    }
    let amplitudes = match doc.get("amplitudes") {
        Some(value) => parse_channels(file, value)?,
        None => SlotChannels::default(),
    };
    Ok(LoopRecipe {
        id: text(file, doc, "id")?.to_owned(),
        version: version(file, doc)?,
        order: field(file, doc, "order")?.as_u64().unwrap_or(0) as usize,
        period: number(file, doc, "period")?,
        amplitudes,
        wave: WaveKind::Sine,
        wave_samples: crate::loop_kernel::DEFAULT_WAVE_SAMPLES,
        noise: None,
        channel_seed_stride: 0,
        default_seed: 0,
        envelope: EnvelopeSpec::NONE,
        determinism: text(file, doc, "determinism")?.to_owned(),
        available: doc
            .get("available")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        manifest_hash,
        keyframes,
        surface: parse_surface(file, doc)?,
        basis: parse_basis(file, doc)?,
    })
}

pub(crate) fn parse_bcf(
    file: &str,
    doc: &Value,
    manifest_hash: u64,
) -> Result<BcfPreset, MotionError> {
    Ok(BcfPreset {
        id: text(file, doc, "id")?.to_owned(),
        version: version(file, doc)?,
        order: field(file, doc, "order")?.as_u64().unwrap_or(0) as usize,
        emits_params_meta: doc
            .get("emitsParamsMeta")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        definition: field(file, doc, "definition")?.clone(),
        manifest_hash,
    })
}

/// 一侧的通道表。接受两种写法（见 [`TransitionRecipe`]）：
/// 单通道糖 `{"from": …, "to": …}`，或 `{"channels": [{prop, ease?, from, to}]}`。
pub(crate) fn parse_side(
    file: &str,
    doc: Option<&Value>,
    default_prop: Option<&str>,
    default_ease: Option<&str>,
) -> Result<Vec<TransitionChannel>, MotionError> {
    let Some(doc) = doc.filter(|value| !value.is_null()) else {
        return Ok(Vec::new());
    };
    let one = |item: &Value, prop: Option<&str>| -> Result<TransitionChannel, MotionError> {
        let prop = item
            .get("prop")
            .and_then(Value::as_str)
            .or(prop)
            .ok_or_else(|| {
                MotionError::ManifestInvalid(format!(
                    "{file}: transition channel is missing \"prop\""
                ))
            })?
            .to_owned();
        Ok(TransitionChannel {
            prop,
            ease: item
                .get("ease")
                .and_then(Value::as_str)
                .or(default_ease)
                .map(str::to_owned),
            from: parse_length(file, field(file, item, "from")?)?,
            to: parse_length(file, field(file, item, "to")?)?,
        })
    };
    match doc.get("channels") {
        Some(list) => {
            let list = list.as_array().ok_or_else(|| {
                MotionError::ManifestInvalid(format!("{file}: \"channels\" is not an array"))
            })?;
            if list.is_empty() {
                return Err(MotionError::ManifestInvalid(format!(
                    "{file}: \"channels\" is empty; write null for \"no channel\""
                )));
            }
            list.iter().map(|item| one(item, default_prop)).collect()
        }
        None => Ok(vec![one(doc, default_prop)?]),
    }
}

pub(crate) fn parse_transition(
    file: &str,
    doc: &Value,
    manifest_hash: u64,
) -> Result<TransitionRecipe, MotionError> {
    let prop = doc.get("prop").and_then(Value::as_str);
    let ease = doc.get("ease").and_then(Value::as_str);
    Ok(TransitionRecipe {
        id: text(file, doc, "id")?.to_owned(),
        version: version(file, doc)?,
        order: field(file, doc, "order")?.as_u64().unwrap_or(0) as usize,
        prop: prop.map(str::to_owned),
        ease: ease.map(str::to_owned),
        out: parse_side(file, doc.get("out"), prop, ease)?,
        r#in: parse_side(file, doc.get("in"), prop, ease)?,
        manifest_hash,
    })
}
