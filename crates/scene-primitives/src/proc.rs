//! 程序化画面源 `proc`（规范 §6.2 / §6.12）：雨、溅落、夜空。
//!
//! 与 confetti 同一纪律——**没有逐帧状态**：每一帧都是 `(局部秒, seed, 参数)` 的
//! 闭式函数，任意时刻可直接跳到。本模块只做**解析与校验**（封闭键集、范围、
//! 缺省），几何与像素在 `bcut-render::source::proc`。
//!
//! 所有长度都是**元素盒的比例**（x 按盒宽、y 按盒高、半径按盒短边），同一份
//! 文档在任何画幅下画出同一构图。
use crate::Rgba;
use anyhow::{Result, anyhow, bail};
use serde_json::{Map, Value};

/// 程序化源的种类（`proc` 字段）。
pub const PROC_KINDS: &[&str] = &["rain", "splash", "sky"];

/// 单个元素内的粒子上限：挡住病态参数，不是画面预算。
pub const MAX_DROPS: usize = 6_000;
pub const MAX_STARS: usize = 4_000;

#[derive(Clone, Debug, PartialEq)]
pub struct Rain {
    /// 0..1：1080p 盒上约 `density × 1400` 条雨丝，按盒面积线性缩放。
    pub density: f64,
    /// 相对竖直的倾角（度），正值向右下落。
    pub angle: f64,
    /// 下落速度：盒高 / 秒（最近一层；远层按深度减速）。
    pub speed: f64,
    /// 雨丝长度：盒高的比例（最近一层；远层按深度缩短）。
    pub length: f64,
    /// 阵风：倾角随时间 ±`wind × 20°` 摆动（`0` = 恒定倾角）。
    pub wind: f64,
    /// 线宽（px，最近一层）。
    pub width: f64,
    pub color: Rgba,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Splash {
    /// 触发时刻（元素局部秒）。
    pub at: f64,
    /// 落点：盒宽 / 盒高的比例。
    pub x: f64,
    pub y: f64,
    pub count: usize,
    /// 重力：盒高 / 秒²。
    pub gravity: f64,
    /// 初速上限：盒高 / 秒。
    pub speed: f64,
    /// 水珠半径（px）。
    pub size: f64,
    /// 存续秒数：之后一条 op 都不画。
    pub life: f64,
    pub color: Rgba,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Moon {
    /// 圆心：盒宽 / 盒高的比例。
    pub x: f64,
    pub y: f64,
    /// 半径：盒短边的比例。
    pub r: f64,
    /// 光晕强度 0..1。
    pub glow: f64,
    pub color: Rgba,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Sky {
    /// 0..1：1080p 盒上约 `stars × 900` 颗，按盒面积线性缩放。
    pub stars: f64,
    /// 银河强度 0..1（0 = 不画）。
    pub milky_way: f64,
    /// 云的不透明度 0..1（0 = 不画）。
    pub cloud: f64,
    /// 云量 0..1：噪声场里被云覆盖的比例。
    pub cover: f64,
    /// 云的漂移：盒宽 / 秒。
    pub drift: f64,
    pub cloud_color: Rgba,
    /// 背景竖向渐变；两端都透明时不画背景。
    pub top: Rgba,
    pub bottom: Rgba,
    pub moon: Option<Moon>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ProcKind {
    Rain(Rain),
    Splash(Splash),
    Sky(Sky),
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProcSource {
    pub seed: u64,
    pub kind: ProcKind,
    /// 作者原文（`proc` / `seed` / `params`），只读舞台投影用。
    pub source: Value,
}

/// 节点允许的键（封闭）。
const NODE_KEYS: &[&str] = &[
    "type",
    "id",
    "style",
    "animate",
    "effects",
    "backdropEffects",
    "cadence",
    "proc",
    "seed",
    "params",
    "_origin",
    "follow",
    "sizeScale",
    "echo",
];

struct Params<'a> {
    kind: &'static str,
    map: &'a Map<String, Value>,
}

impl Params<'_> {
    fn number(&self, key: &str, default: f64, min: f64, max: f64) -> Result<f64> {
        let Some(raw) = self.map.get(key) else {
            return Ok(default);
        };
        let n = raw
            .as_f64()
            .filter(|n| n.is_finite())
            .ok_or_else(|| anyhow!("schema: proc.{}.{key} 须为有限数值", self.kind))?;
        if !(min..=max).contains(&n) {
            bail!(
                "schema: proc.{}.{key} 须在 {min}..{max}，实得 {n}",
                self.kind
            );
        }
        Ok(n)
    }

    fn color(&self, key: &str, default: &str) -> Result<Rgba> {
        let raw = match self.map.get(key) {
            None => default,
            Some(v) => v
                .as_str()
                .ok_or_else(|| anyhow!("schema: proc.{}.{key} 须为颜色字符串", self.kind))?,
        };
        Rgba::parse(raw)
            .ok_or_else(|| anyhow!("schema: proc.{}.{key} 不是可解析的颜色：{raw}", self.kind))
    }

    fn closed(&self, keys: &[&str]) -> Result<()> {
        if let Some(key) = self.map.keys().find(|key| !keys.contains(&key.as_str())) {
            bail!(
                "schema: proc.{} 没有参数 {key}；可用 {keys:?}（§6.12）",
                self.kind
            );
        }
        Ok(())
    }
}

impl ProcSource {
    /// 从已解引用（`$vars` / `$theme`）的节点 JSON 解析。
    pub fn parse(node: &Value) -> Result<Self> {
        let object = node
            .as_object()
            .ok_or_else(|| anyhow!("schema: proc 节点须为对象"))?;
        if let Some(key) = object.keys().find(|key| !NODE_KEYS.contains(&key.as_str())) {
            bail!("schema: proc 节点含未知字段 {key}；参数写在 params 里（§6.12）");
        }
        let name = object
            .get("proc")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("schema: proc 节点缺少 proc（{PROC_KINDS:?}）"))?;
        let kind: &'static str = PROC_KINDS
            .iter()
            .copied()
            .find(|k| *k == name)
            .ok_or_else(|| anyhow!("schema: proc \"{name}\" 不在封闭枚举 {PROC_KINDS:?}"))?;
        let seed = match object.get("seed") {
            None => 0,
            Some(v) => v
                .as_u64()
                .filter(|n| *n <= u64::from(u32::MAX))
                .ok_or_else(|| anyhow!("schema: proc.seed 须为 0..4294967295 的整数"))?,
        };
        let empty = Map::new();
        let map = match object.get("params") {
            None | Some(Value::Null) => &empty,
            Some(Value::Object(map)) => map,
            Some(other) => bail!("schema: proc.params 须为对象，实得 {other}"),
        };
        let p = Params { kind, map };
        let parsed = match kind {
            "rain" => {
                p.closed(&[
                    "density", "angle", "speed", "length", "wind", "width", "color",
                ])?;
                ProcKind::Rain(Rain {
                    density: p.number("density", 0.5, 0.0, 1.0)?,
                    angle: p.number("angle", 12.0, -60.0, 60.0)?,
                    speed: p.number("speed", 1.6, 0.05, 10.0)?,
                    length: p.number("length", 0.06, 0.0, 0.5)?,
                    wind: p.number("wind", 0.0, 0.0, 1.0)?,
                    width: p.number("width", 1.2, 0.1, 16.0)?,
                    color: p.color("color", "rgba(200,215,255,0.55)")?,
                })
            }
            "splash" => {
                p.closed(&[
                    "at", "x", "y", "count", "gravity", "speed", "size", "life", "color",
                ])?;
                let count = p.number("count", 24.0, 1.0, 400.0)?;
                if count.fract() != 0.0 {
                    bail!("schema: proc.splash.count 须为整数");
                }
                ProcKind::Splash(Splash {
                    at: p.number("at", 0.0, 0.0, 86_400.0)?,
                    x: p.number("x", 0.5, -1.0, 2.0)?,
                    y: p.number("y", 0.9, -1.0, 2.0)?,
                    count: count as usize,
                    gravity: p.number("gravity", 2.5, 0.0, 50.0)?,
                    speed: p.number("speed", 0.9, 0.0, 20.0)?,
                    size: p.number("size", 2.5, 0.2, 64.0)?,
                    life: p.number("life", 1.2, 0.05, 30.0)?,
                    color: p.color("color", "rgba(210,225,255,0.9)")?,
                })
            }
            "sky" => {
                p.closed(&[
                    "stars",
                    "milkyWay",
                    "cloud",
                    "cover",
                    "drift",
                    "cloudColor",
                    "top",
                    "bottom",
                    "moon",
                ])?;
                let moon = match map.get("moon") {
                    None | Some(Value::Null) | Some(Value::Bool(false)) => None,
                    Some(Value::Object(m)) => {
                        let mp = Params {
                            kind: "sky.moon",
                            map: m,
                        };
                        mp.closed(&["x", "y", "r", "glow", "color"])?;
                        Some(Moon {
                            x: mp.number("x", 0.75, -1.0, 2.0)?,
                            y: mp.number("y", 0.22, -1.0, 2.0)?,
                            r: mp.number("r", 0.06, 0.001, 1.0)?,
                            glow: mp.number("glow", 0.6, 0.0, 1.0)?,
                            color: mp.color("color", "#f4f1e6")?,
                        })
                    }
                    Some(other) => bail!("schema: proc.sky.moon 须为对象，实得 {other}"),
                };
                ProcKind::Sky(Sky {
                    stars: p.number("stars", 0.5, 0.0, 1.0)?,
                    milky_way: p.number("milkyWay", 0.0, 0.0, 1.0)?,
                    cloud: p.number("cloud", 0.0, 0.0, 1.0)?,
                    cover: p.number("cover", 0.4, 0.0, 1.0)?,
                    drift: p.number("drift", 0.01, -1.0, 1.0)?,
                    cloud_color: p.color("cloudColor", "#7d88a3")?,
                    top: p.color("top", "#03050c")?,
                    bottom: p.color("bottom", "#141c33")?,
                    moon,
                })
            }
            _ => unreachable!("PROC_KINDS 已穷举"),
        };
        let mut source = Map::new();
        for key in ["proc", "seed", "params"] {
            if let Some(value) = object.get(key) {
                source.insert(key.into(), value.clone());
            }
        }
        Ok(Self {
            seed,
            kind: parsed,
            source: Value::Object(source),
        })
    }

    pub fn kind_name(&self) -> &'static str {
        match self.kind {
            ProcKind::Rain(_) => "rain",
            ProcKind::Splash(_) => "splash",
            ProcKind::Sky(_) => "sky",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_fill_in_and_ranges_are_enforced() {
        let rain = ProcSource::parse(&json!({"type":"proc","proc":"rain","seed":3})).unwrap();
        let ProcKind::Rain(r) = &rain.kind else {
            panic!()
        };
        assert_eq!((rain.seed, r.density, r.angle), (3, 0.5, 12.0));

        for bad in [
            json!({"type":"proc","proc":"snow"}),
            json!({"type":"proc"}),
            json!({"type":"proc","proc":"rain","params":{"density":2}}),
            json!({"type":"proc","proc":"rain","params":{"nope":1}}),
            json!({"type":"proc","proc":"rain","density":0.3}),
            json!({"type":"proc","proc":"splash","params":{"count":2.5}}),
            json!({"type":"proc","proc":"sky","params":{"moon":{"x":0.5,"size":3}}}),
            json!({"type":"proc","proc":"sky","params":{"top":"not-a-color"}}),
            json!({"type":"proc","proc":"rain","seed":-1}),
        ] {
            assert!(ProcSource::parse(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn sky_moon_is_optional_and_parsed() {
        let sky = ProcSource::parse(&json!({"type":"proc","proc":"sky","params":{
            "stars":0.8,"milkyWay":0.5,"moon":{"x":0.3,"y":0.2,"r":0.05}
        }}))
        .unwrap();
        let ProcKind::Sky(s) = &sky.kind else {
            panic!()
        };
        let moon = s.moon.as_ref().unwrap();
        assert_eq!((moon.x, moon.y, moon.r, moon.glow), (0.3, 0.2, 0.05, 0.6));
        assert_eq!(sky.source["proc"], json!("sky"));
    }
}
