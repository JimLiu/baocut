//! Path 的绘制属性（规范 §6.2.1）：纹理填充、描边抖动、线帽 / 接头 / 虚线、
//! 填充规则，以及 `cadence` 采样域声明（规范 §7.10）。
//!
//! 这里只做**解析与校验**（封闭键集、取值域），生成几何是 host 的事
//! （`bcut-render::source::texture`）。所有长度都在**路径自身坐标系**里
//! （即 `<Svg viewBox>` 的单位），与 `strokeWidth` 同一口径，随 svg 缩放。

use crate::color::Rgba;
use anyhow::{Result, bail};
use serde_json::{Map, Value};

/// 纹理填充算法版本。改生成规则（行序、取随机数的次序、默认值）必须升版，
/// 它参与缓存键与几何摘要。
pub const TEXTURE_ALGORITHM_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Finish {
    /// 无纹理。让 `finish: "$theme.look.finish"` 可以整片切回平涂。
    Flat,
    /// 平行短线 + 颗粒。
    Ink,
    /// 稀疏细线 + 颗粒。
    Pencil,
    /// 只有颗粒。
    Grain,
    /// 正交点阵，点面积 = 覆盖率。
    Screen,
    /// 旋转点阵 + 轻微抖动。
    Riso,
    /// Translucent pigment patches, clipped to the original fill geometry.
    Wash,
    /// 油画笔触：沿 `angle` 一行行铺带鬃毛纹理的笔，底色取路径 `fill`。
    Paint,
}

impl Finish {
    pub const ALL: [&'static str; 8] = [
        "flat", "ink", "pencil", "grain", "screen", "riso", "wash", "paint",
    ];

    pub fn parse(text: &str) -> Option<Finish> {
        Some(match text {
            "flat" => Finish::Flat,
            "ink" => Finish::Ink,
            "pencil" => Finish::Pencil,
            "grain" => Finish::Grain,
            "screen" => Finish::Screen,
            "riso" => Finish::Riso,
            "wash" => Finish::Wash,
            "paint" => Finish::Paint,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Finish::Flat => "flat",
            Finish::Ink => "ink",
            Finish::Pencil => "pencil",
            Finish::Grain => "grain",
            Finish::Screen => "screen",
            Finish::Riso => "riso",
            Finish::Wash => "wash",
            Finish::Paint => "paint",
        }
    }

    pub fn is_hatch(self) -> bool {
        matches!(self, Finish::Ink | Finish::Pencil)
    }

    pub fn is_dots(self) -> bool {
        matches!(self, Finish::Screen | Finish::Riso)
    }
}

/// 覆盖率场：标量，或闭集函数（`cx / cy / r` 是路径包围盒的比例）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Density {
    Flat(f64),
    Radial {
        cx: f64,
        cy: f64,
        r: f64,
        from: f64,
        to: f64,
    },
    Linear {
        angle: f64,
        from: f64,
        to: f64,
    },
}

impl Density {
    /// `(u, v)` 是包围盒内的比例坐标。返回值夹在 `[0, 1]`。
    pub fn at(&self, u: f64, v: f64) -> f64 {
        let value = match *self {
            Density::Flat(value) => value,
            Density::Radial {
                cx,
                cy,
                r,
                from,
                to,
            } => {
                let d = ((u - cx).powi(2) + (v - cy).powi(2)).sqrt();
                let k = if r > 0.0 { (d / r).min(1.0) } else { 1.0 };
                from + (to - from) * k
            }
            Density::Linear { angle, from, to } => {
                let k = ((u - 0.5) * angle.cos() + (v - 0.5) * angle.sin() + 0.5).clamp(0.0, 1.0);
                from + (to - from) * k
            }
        };
        value.clamp(0.0, 1.0)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PathTexture {
    pub finish: Finish,
    pub color: Rgba,
    pub alpha: f64,
    /// 排线方向 / 点阵旋转（弧度）。
    pub angle: f64,
    /// 排线行距 / 点阵格距。
    pub gap: f64,
    /// 排线单段长度（只对 `ink` / `pencil`）。
    pub len: f64,
    /// 排线线宽（只对 `ink` / `pencil`）。
    pub width: f64,
    pub density: Density,
    pub jitter: f64,
    /// 颗粒数量（0 = 不要颗粒）。
    pub grain: u32,
    pub grain_color: Option<Rgba>,
    pub grain_alpha: f64,
    pub grain_size: f64,
    pub seed: u64,
    /// `paint` 的干笔程度 0..1（其它 finish 忽略）。
    pub dry: f64,
    /// `paint` 的第二种颜料（其它 finish 忽略）。
    pub load: Option<Rgba>,
}

/// 颗粒数量上限：一条路径的颗粒合成一次 fill，太多只会拖慢光栅化。
pub const GRAIN_MAX: u32 = 40_000;

const TEXTURE_KEYS: &[&str] = &[
    "finish",
    "color",
    "alpha",
    "angle",
    "gap",
    "len",
    "width",
    "density",
    "jitter",
    "grain",
    "grainColor",
    "grainAlpha",
    "grainSize",
    "seed",
    "dry",
    "load",
];
const DENSITY_KEYS_RADIAL: &[&str] = &["kind", "cx", "cy", "r", "from", "to"];
const DENSITY_KEYS_LINEAR: &[&str] = &["kind", "angle", "from", "to"];
const DENSITY_KEYS_FLAT: &[&str] = &["kind", "value"];

fn optional_color(map: &Map<String, Value>, key: &str, what: &str) -> Result<Option<Rgba>> {
    match map.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => match Rgba::parse_value(Some(value)) {
            Some(color) => Ok(Some(color)),
            None => bail!("schema: {what}.{key} 不是合法颜色：{value}"),
        },
    }
}

fn finite(map: &Map<String, Value>, key: &str, what: &str) -> Result<Option<f64>> {
    match map.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => match value.as_f64().filter(|v| v.is_finite()) {
            Some(v) => Ok(Some(v)),
            None => bail!("schema: {what}.{key} 必须是有限数值，实得 {value}"),
        },
    }
}

fn seed_of(map: &Map<String, Value>, what: &str) -> Result<u64> {
    match map.get("seed") {
        None | Some(Value::Null) => Ok(0),
        Some(value) => {
            if let Some(v) = value.as_u64() {
                return Ok(v);
            }
            match value.as_f64() {
                Some(v) if v.is_finite() && v >= 0.0 && v.fract() == 0.0 && v <= 9.007e15 => {
                    Ok(v as u64)
                }
                _ => bail!("schema: {what}.seed 必须是非负整数（≤ 2^53），实得 {value}"),
            }
        }
    }
}

fn closed_keys(map: &Map<String, Value>, allowed: &[&str], what: &str) -> Result<()> {
    for key in map.keys() {
        if !allowed.contains(&key.as_str()) {
            bail!("schema: {what} 没有键 \"{key}\"（封闭键集 {allowed:?}）");
        }
    }
    Ok(())
}

impl Density {
    fn parse(value: &Value) -> Result<Density> {
        if let Some(v) = value.as_f64() {
            if !v.is_finite() {
                bail!("schema: texture.density 必须是有限数值");
            }
            return Ok(Density::Flat(v.clamp(0.0, 1.0)));
        }
        let Some(map) = value.as_object() else {
            bail!(
                "schema: texture.density 必须是数值或 {{kind: flat|radial|linear}}，实得 {value}"
            );
        };
        let kind = map.get("kind").and_then(Value::as_str).unwrap_or("flat");
        let get = |key: &str, default: f64| -> Result<f64> {
            Ok(finite(map, key, "texture.density")?.unwrap_or(default))
        };
        Ok(match kind {
            "flat" => {
                closed_keys(map, DENSITY_KEYS_FLAT, "texture.density(flat)")?;
                Density::Flat(get("value", 0.5)?.clamp(0.0, 1.0))
            }
            "radial" => {
                closed_keys(map, DENSITY_KEYS_RADIAL, "texture.density(radial)")?;
                Density::Radial {
                    cx: get("cx", 0.5)?,
                    cy: get("cy", 0.5)?,
                    r: get("r", 0.75)?,
                    from: get("from", 0.15)?,
                    to: get("to", 0.7)?,
                }
            }
            "linear" => {
                closed_keys(map, DENSITY_KEYS_LINEAR, "texture.density(linear)")?;
                Density::Linear {
                    angle: get("angle", 0.0)?,
                    from: get("from", 0.15)?,
                    to: get("to", 0.7)?,
                }
            }
            other => bail!("schema: texture.density.kind \"{other}\" 不在 flat|radial|linear"),
        })
    }
}

impl PathTexture {
    /// `value` 必须已经过 `$theme` / `$vars` 引用解析。`null` ⇒ `None`。
    pub fn parse(value: &Value) -> Result<Option<PathTexture>> {
        if value.is_null() {
            return Ok(None);
        }
        let Some(map) = value.as_object() else {
            bail!("schema: texture 必须是对象（§6.2.1），实得 {value}");
        };
        closed_keys(map, TEXTURE_KEYS, "texture")?;
        let finish = match map.get("finish") {
            None | Some(Value::Null) => Finish::Ink,
            Some(value) => match value.as_str().and_then(Finish::parse) {
                Some(finish) => finish,
                None => bail!(
                    "schema: texture.finish {value} 不在封闭枚举 {:?}",
                    Finish::ALL
                ),
            },
        };
        let color = match map.get("color") {
            None | Some(Value::Null) => Rgba {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            },
            Some(value) => match Rgba::parse_value(Some(value)) {
                Some(color) => color,
                None => bail!("schema: texture.color 不是合法颜色：{value}"),
            },
        };
        let grain_color = match map.get("grainColor") {
            None | Some(Value::Null) => None,
            Some(value) => match Rgba::parse_value(Some(value)) {
                Some(color) => Some(color),
                None => bail!("schema: texture.grainColor 不是合法颜色：{value}"),
            },
        };
        // 各 finish 的缺省值。改这张表 = 改算法版本。
        let (angle, gap, len, width, density, jitter, alpha) = match finish {
            Finish::Pencil => (0.6, 7.0, 22.0, 0.9, 0.3, 1.5, 0.5),
            Finish::Screen => (0.0, 6.0, 0.0, 0.0, 0.4, 0.0, 0.6),
            Finish::Riso => (0.26, 6.0, 0.0, 0.0, 0.45, 0.6, 0.6),
            Finish::Wash => (0.0, 32.0, 0.0, 0.0, 0.6, 0.6, 0.22),
            Finish::Paint => (0.5, 14.0, 90.0, 22.0, 0.92, 4.0, 1.0),
            _ => (0.6, 5.0, 16.0, 1.3, 0.55, 1.5, 0.6),
        };
        let num = |key: &str, default: f64| -> Result<f64> {
            Ok(finite(map, key, "texture")?.unwrap_or(default))
        };
        let grain = num("grain", 0.0)?;
        if grain < 0.0 {
            bail!("schema: texture.grain 不能为负");
        }
        Ok(Some(PathTexture {
            finish,
            color,
            alpha: num("alpha", alpha)?.clamp(0.0, 1.0),
            angle: num("angle", angle)?,
            gap: num("gap", gap)?.max(0.5),
            len: num("len", len)?.max(1.0),
            width: num("width", width)?.max(0.0),
            density: match map.get("density") {
                None | Some(Value::Null) => Density::Flat(density),
                Some(value) => Density::parse(value)?,
            },
            jitter: num("jitter", jitter)?.max(0.0),
            grain: (grain as u32).min(GRAIN_MAX),
            grain_color,
            grain_alpha: num("grainAlpha", 0.12)?.clamp(0.0, 1.0),
            grain_size: num("grainSize", 1.8)?.max(0.1),
            seed: seed_of(map, "texture")?,
            dry: num("dry", 0.3)?.clamp(0.0, 1.0),
            load: optional_color(map, "load", "texture")?,
        }))
    }
}

/// 描边抖动：逐顶点按 `(seed, 顶点序号)` 偏移，填充不跟着动。
/// `every > 0` ⇒ 每 `every` 个绘制帧重播种一次（boil）；绘制帧率取节点所在
/// `cadence` 采样域，域外按 [`DEFAULT_DRAW_FPS`]。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PathWobble {
    pub amp: f64,
    pub seed: u64,
    pub every: u32,
}

/// 没有 `cadence` 采样域时 boil 的计帧频率。
pub const DEFAULT_DRAW_FPS: f64 = 12.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrushKind {
    Clean,
    Pencil,
    Ink,
    /// 油画笔触：渐细的鬃毛带、干笔断续、两色含色（`bcut-render::source::paint`）。
    Paint,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StrokeBrush {
    pub kind: BrushKind,
    pub seed: u64,
    pub roughness: f64,
    /// 只对 `paint`：干笔程度 0..1，缺省 0.35。
    pub dry: f64,
    /// 只对 `paint`：第二种颜料。
    pub load: Option<Rgba>,
}

impl StrokeBrush {
    pub fn parse(value: &Value) -> Result<Self> {
        let map = value
            .as_object()
            .ok_or_else(|| anyhow::anyhow!("schema: brush 须为对象"))?;
        closed_keys(map, &["kind", "seed", "roughness", "dry", "load"], "brush")?;
        let kind = match map.get("kind").and_then(Value::as_str) {
            Some("clean") => BrushKind::Clean,
            Some("pencil") => BrushKind::Pencil,
            Some("ink") => BrushKind::Ink,
            Some("paint") => BrushKind::Paint,
            _ => bail!("schema: brush.kind 须为 clean|pencil|ink|paint"),
        };
        if kind != BrushKind::Paint && (map.contains_key("dry") || map.contains_key("load")) {
            bail!("schema: brush.dry / brush.load 只对 kind: \"paint\" 生效");
        }
        // paint 的 roughness 是观感倍数（1 = 缺省），其余是复线偏移的路径单位
        let default = if kind == BrushKind::Paint { 1.0 } else { 0.7 };
        let roughness = finite(map, "roughness", "brush")?.unwrap_or(default);
        if !(0.0..=10.0).contains(&roughness) {
            bail!("schema: brush.roughness 须在 0..10");
        }
        let dry = finite(map, "dry", "brush")?.unwrap_or(0.35);
        if !(0.0..=1.0).contains(&dry) {
            bail!("schema: brush.dry 须在 0..1");
        }
        Ok(Self {
            kind,
            roughness,
            seed: seed_of(map, "brush")?,
            dry,
            load: optional_color(map, "load", "brush")?,
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub enum FollowPosition {
    Start,
    End,
    Progress(f64),
}

#[derive(Debug, Clone)]
pub struct PathFollow {
    pub source: String,
    pub position: FollowPosition,
    pub rotate: bool,
    pub offset: [f64; 2],
}

impl PathFollow {
    pub fn parse(value: &Value) -> Result<Self> {
        let map = value
            .as_object()
            .ok_or_else(|| anyhow::anyhow!("schema: follow 须为对象"))?;
        closed_keys(map, &["source", "position", "rotate", "offset"], "follow")?;
        let source = map
            .get("source")
            .and_then(Value::as_str)
            .and_then(|s| s.strip_prefix('#'))
            .filter(|s| !s.is_empty())
            .ok_or_else(|| anyhow::anyhow!("schema: follow.source 须为 #pathId"))?
            .to_owned();
        let position = match map.get("position") {
            None => FollowPosition::End,
            Some(v) => match v.as_str() {
                Some("start") => FollowPosition::Start,
                Some("end") => FollowPosition::End,
                _ => FollowPosition::Progress(
                    v.as_f64()
                        .filter(|v| v.is_finite() && (0.0..=1.0).contains(v))
                        .ok_or_else(|| {
                            anyhow::anyhow!("schema: follow.position 须为 start|end|0..1")
                        })?,
                ),
            },
        };
        let rotate = match map.get("rotate") {
            None => false,
            Some(v) => v
                .as_bool()
                .ok_or_else(|| anyhow::anyhow!("schema: follow.rotate 须为布尔"))?,
        };
        let offset = match map.get("offset") {
            None => [0.0; 2],
            Some(v) => {
                let a = v
                    .as_array()
                    .filter(|a| a.len() == 2)
                    .ok_or_else(|| anyhow::anyhow!("schema: follow.offset 须为 [x,y]"))?;
                let number = |index: usize| {
                    a[index]
                        .as_f64()
                        .filter(|n| n.is_finite())
                        .ok_or_else(|| anyhow::anyhow!("schema: follow.offset 须为有限数值"))
                };
                [number(0)?, number(1)?]
            }
        };
        Ok(Self {
            source,
            position,
            rotate,
            offset,
        })
    }
}

const WOBBLE_KEYS: &[&str] = &["amp", "seed", "every"];

impl PathWobble {
    pub fn parse(value: &Value) -> Result<Option<PathWobble>> {
        if value.is_null() {
            return Ok(None);
        }
        let Some(map) = value.as_object() else {
            bail!("schema: wobble 必须是对象（§6.2.1），实得 {value}");
        };
        closed_keys(map, WOBBLE_KEYS, "wobble")?;
        let every = finite(map, "every", "wobble")?.unwrap_or(0.0);
        if every < 0.0 || every.fract() != 0.0 {
            bail!("schema: wobble.every 必须是非负整数（绘制帧数）");
        }
        Ok(Some(PathWobble {
            amp: finite(map, "amp", "wobble")?.unwrap_or(1.8).max(0.0),
            seed: seed_of(map, "wobble")?,
            every: every as u32,
        }))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LineCap {
    Butt,
    #[default]
    Round,
    Square,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LineJoin {
    Miter,
    #[default]
    Round,
    Bevel,
}

impl LineCap {
    pub fn parse(text: &str) -> Option<LineCap> {
        Some(match text {
            "butt" => LineCap::Butt,
            "round" => LineCap::Round,
            "square" => LineCap::Square,
            _ => return None,
        })
    }
    /// `DrawOp::StrokePathPaint.cap` 的编码。
    pub fn code(self) -> u8 {
        match self {
            LineCap::Butt => 0,
            LineCap::Round => 1,
            LineCap::Square => 2,
        }
    }
}

impl LineJoin {
    pub fn parse(text: &str) -> Option<LineJoin> {
        Some(match text {
            "miter" => LineJoin::Miter,
            "round" => LineJoin::Round,
            "bevel" => LineJoin::Bevel,
            _ => return None,
        })
    }
    /// `DrawOp::StrokePathPaint.join` 的编码。
    pub fn code(self) -> u8 {
        match self {
            LineJoin::Miter => 0,
            LineJoin::Round => 1,
            LineJoin::Bevel => 2,
        }
    }
}

/// `dash`：`[画, 空, 画, 空, …]`，路径自身坐标；奇数个按 SVG 规则重复一遍。
pub fn parse_dash(value: &Value) -> Result<Vec<f64>> {
    if value.is_null() {
        return Ok(Vec::new());
    }
    let Some(items) = value.as_array() else {
        bail!("schema: dash 必须是数值数组，实得 {value}");
    };
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        match item.as_f64().filter(|v| v.is_finite() && *v >= 0.0) {
            Some(v) => out.push(v),
            None => bail!("schema: dash 的每一项必须是非负有限数值，实得 {item}"),
        }
    }
    if out.len() > 16 {
        bail!("schema: dash 最多 16 项");
    }
    if out.iter().sum::<f64>() <= 0.0 {
        return Ok(Vec::new());
    }
    if out.len() % 2 == 1 {
        let copy = out.clone();
        out.extend(copy);
    }
    Ok(out)
}

/// `cadence` 采样域声明（规范 §7.10）。
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum Cadence {
    /// 没写：沿用父域。
    #[default]
    Inherit,
    /// `"none"`：显式退出父域，走真实时间。
    Off,
    /// `{ fps }`：开一个新的绘制频率域。
    Fps(f64),
}

/// 绘制频率的取值域。上限只是防呆：高于输出帧率的 cadence 没有意义。
pub const CADENCE_FPS_RANGE: (f64, f64) = (1.0, 120.0);

impl Cadence {
    pub fn parse(value: &Value) -> Result<Cadence> {
        match value {
            Value::Null => Ok(Cadence::Inherit),
            Value::String(text) if text == "none" => Ok(Cadence::Off),
            Value::Object(map) => {
                closed_keys(map, &["fps"], "cadence")?;
                match finite(map, "fps", "cadence")? {
                    Some(fps) if fps >= CADENCE_FPS_RANGE.0 && fps <= CADENCE_FPS_RANGE.1 => {
                        Ok(Cadence::Fps(fps))
                    }
                    _ => bail!(
                        "schema: cadence.fps 必须在 [{}, {}] 内",
                        CADENCE_FPS_RANGE.0,
                        CADENCE_FPS_RANGE.1
                    ),
                }
            }
            other => bail!("schema: cadence 必须是 {{ fps }} 或 \"none\"，实得 {other}"),
        }
    }

    /// 在父域 `parent` 之下，本声明生效后的绘制频率。
    pub fn apply(self, parent: Option<f64>) -> Option<f64> {
        match self {
            Cadence::Inherit => parent,
            Cadence::Off => None,
            Cadence::Fps(fps) => Some(fps),
        }
    }
}

/// 把真实时间 `t` 量化到 `fps` 的绘制帧起点。整数帧号换算，边界加 1e-9
/// 防 `k/fps * fps` 的浮点回落。
pub fn hold(t: f64, fps: f64) -> f64 {
    ((t * fps) + 1e-9).floor() / fps
}

/// `t` 所在的绘制帧编号（boil 的重播种计数）。
pub fn draw_frame(t: f64, fps: f64) -> u64 {
    ((t * fps) + 1e-9).floor().max(0.0) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn texture_defaults_and_closed_keys() {
        let tx = PathTexture::parse(&json!({ "finish": "riso", "seed": 7 }))
            .unwrap()
            .unwrap();
        assert_eq!(tx.finish, Finish::Riso);
        assert_eq!(tx.seed, 7);
        assert_eq!(tx.density, Density::Flat(0.45));
        let err = PathTexture::parse(&json!({ "finsh": "ink" })).unwrap_err();
        assert!(err.to_string().starts_with("schema:"), "{err}");
        assert!(PathTexture::parse(&json!({ "finish": "oil" })).is_err());
        assert!(PathTexture::parse(&json!({ "seed": -1 })).is_err());
        assert!(PathTexture::parse(&Value::Null).unwrap().is_none());
    }

    #[test]
    fn paint_texture_and_brush() {
        let tx = PathTexture::parse(&json!({ "finish": "paint", "load": "#ffffff", "dry": 0.5 }))
            .unwrap()
            .unwrap();
        assert_eq!(tx.finish, Finish::Paint);
        assert_eq!(tx.alpha, 1.0);
        assert_eq!(tx.dry, 0.5);
        assert!(tx.load.is_some());
        assert!(PathTexture::parse(&json!({ "finish": "paint", "load": "nope" })).is_err());
        let brush = StrokeBrush::parse(&json!({ "kind": "paint", "load": "#ff0000" })).unwrap();
        assert_eq!(brush.kind, BrushKind::Paint);
        assert_eq!(brush.roughness, 1.0);
        assert_eq!(brush.dry, 0.35);
        assert!(brush.load.is_some());
        assert!(StrokeBrush::parse(&json!({ "kind": "ink", "dry": 0.2 })).is_err());
        assert!(StrokeBrush::parse(&json!({ "kind": "paint", "dry": 2 })).is_err());
        assert_eq!(
            StrokeBrush::parse(&json!({ "kind": "ink" }))
                .unwrap()
                .roughness,
            0.7
        );
    }

    #[test]
    fn density_fields() {
        let radial =
            Density::parse(&json!({ "kind": "radial", "from": 0.0, "to": 1.0, "r": 0.5 })).unwrap();
        assert!(radial.at(0.5, 0.5) < 1e-9);
        assert!((radial.at(1.0, 0.5) - 1.0).abs() < 1e-9);
        let linear = Density::parse(&json!({ "kind": "linear", "from": 0.2, "to": 0.8 })).unwrap();
        assert!((linear.at(0.0, 0.5) - 0.2).abs() < 1e-9);
        assert!((linear.at(1.0, 0.5) - 0.8).abs() < 1e-9);
        assert!(Density::parse(&json!({ "kind": "spiral" })).is_err());
    }

    #[test]
    fn dash_rules() {
        assert_eq!(parse_dash(&json!([4, 2])).unwrap(), vec![4.0, 2.0]);
        assert_eq!(parse_dash(&json!([3])).unwrap(), vec![3.0, 3.0]);
        assert!(parse_dash(&json!([0, 0])).unwrap().is_empty());
        assert!(parse_dash(&json!([1, -1])).is_err());
    }

    #[test]
    fn cadence_hold_is_stable_on_grid() {
        for k in 0..240u32 {
            let t = f64::from(k) / 12.0;
            assert_eq!(draw_frame(t, 12.0), u64::from(k), "k={k}");
            assert!((hold(t, 12.0) - t).abs() < 1e-9);
        }
        // 24 fps 输出下每张画保持两帧
        assert_eq!(hold(1.0 / 24.0, 12.0), 0.0);
        assert_eq!(draw_frame(3.0 / 24.0, 12.0), 1);
        assert_eq!(Cadence::parse(&json!("none")).unwrap(), Cadence::Off);
        assert_eq!(
            Cadence::parse(&json!({ "fps": 12 })).unwrap().apply(None),
            Some(12.0)
        );
        assert_eq!(Cadence::Off.apply(Some(12.0)), None);
        assert!(Cadence::parse(&json!({ "fps": 0 })).is_err());
    }
}

/// 作者层种子派生：FNV-1a 32 over UTF-8 of `keys.join("/")`。
/// `@baocut/sketch` 的 `seedOf` 是同一算法的 JS 实现，由 `bcut-compile/tests/sketch_module.rs` 对拍。
pub fn author_seed(keys: &[&str]) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in keys.join("/").bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}
