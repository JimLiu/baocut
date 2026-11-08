//! 从 `rig.json` 里读构建要用的几何：眼睛轮廓、脸部椭圆、发束、发髻和身体。rig 本身保持
//! `serde_json::Value`，写回时只补上眼睛曲线，其余字段原样保留。

use anyhow::{Context, Result, bail, ensure};
use serde_json::Value;

pub const EYE_SAMPLES: usize = 24;

#[derive(Clone, Copy, Debug)]
pub struct Ellipse {
    pub cx: f64,
    pub cy: f64,
    pub rx: f64,
    pub ry: f64,
    pub angle: f64,
}

#[derive(Clone, Debug)]
pub struct Strand {
    pub nodes: Vec<[f64; 2]>,
    pub sigma: f64,
    pub max: f64,
}

#[derive(Clone, Debug)]
pub struct EyeShape {
    pub opening: Vec<[f64; 2]>,
    pub roi: Vec<[f64; 2]>,
}

/// 渲染器按 24 列采样的眼睛上下沿。
#[derive(Clone, Debug, PartialEq)]
pub struct EyeCurves {
    pub x0: f64,
    pub x1: f64,
    pub top: [f64; EYE_SAMPLES],
    pub bot: [f64; EYE_SAMPLES],
}

#[derive(Clone, Debug)]
pub struct RigView {
    pub width: usize,
    pub height: usize,
    pub eyes: [EyeShape; 2],
    pub head: Ellipse,
    pub brow: Ellipse,
    pub mouth_face: Ellipse,
    pub nose: Ellipse,
    pub strands: Vec<Strand>,
    pub buns: Vec<Ellipse>,
    pub chest: Ellipse,
    pub shoulders: Vec<Ellipse>,
    pub mouth_area: Option<Ellipse>,
}

fn number(value: &Value, path: &str) -> Result<f64> {
    let n = value.as_f64().with_context(|| format!("{path}: expected a number"))?;
    ensure!(n.is_finite(), "{path}: expected a finite number");
    Ok(n)
}

fn field<'a>(value: &'a Value, key: &str, path: &str) -> Result<&'a Value> {
    value.get(key).with_context(|| format!("{path}.{key}: missing"))
}

fn ellipse(value: &Value, path: &str) -> Result<Ellipse> {
    let get = |key: &str| number(field(value, key, path)?, &format!("{path}.{key}"));
    let e = Ellipse {
        cx: get("cx")?,
        cy: get("cy")?,
        rx: get("rx")?,
        ry: get("ry")?,
        angle: match value.get("angle") {
            Some(v) => number(v, &format!("{path}.angle"))?,
            None => 0.0,
        },
    };
    ensure!(e.rx > 0.0 && e.ry > 0.0, "{path}: expected a finite ellipse with positive radii");
    Ok(e)
}

fn points(value: &Value, path: &str, minimum: usize, size: (usize, usize)) -> Result<Vec<[f64; 2]>> {
    let list = value
        .as_array()
        .with_context(|| format!("{path}: expected at least {minimum} finite [x, y] points"))?;
    let mut out = Vec::with_capacity(list.len());
    for p in list {
        let pair = p.as_array().filter(|a| a.len() == 2);
        let (Some(x), Some(y)) = (pair.and_then(|a| a[0].as_f64()), pair.and_then(|a| a[1].as_f64())) else {
            bail!("{path}: expected at least {minimum} finite [x, y] points");
        };
        ensure!(
            x.is_finite() && y.is_finite(),
            "{path}: expected at least {minimum} finite [x, y] points"
        );
        ensure!(
            (0.0..=size.0 as f64).contains(&x) && (0.0..=size.1 as f64).contains(&y),
            "{path}: points must be within source.png"
        );
        out.push([x, y]);
    }
    ensure!(out.len() >= minimum, "{path}: expected at least {minimum} finite [x, y] points");
    if minimum >= 3 {
        ensure!(polygon_area(&out).abs() > 0.0, "{path}: polygon must have positive area");
    }
    Ok(out)
}

pub fn polygon_area(poly: &[[f64; 2]]) -> f64 {
    let n = poly.len();
    (0..n)
        .map(|i| {
            let (a, b) = (poly[i], poly[(i + 1) % n]);
            a[0] * b[1] - b[0] * a[1]
        })
        .sum::<f64>()
        / 2.0
}

impl RigView {
    /// 读 rig，检查构建要用的字段；手、挂件和布料这三种可选部件 Rust 构建器还不支持。
    pub fn parse(rig: &Value, width: usize, height: usize) -> Result<Self> {
        ensure!(
            rig.get("version").and_then(Value::as_f64) == Some(1.0)
                && rig.get("image").and_then(|i| i.get("width")).and_then(Value::as_u64) == Some(width as u64)
                && rig.get("image").and_then(|i| i.get("height")).and_then(Value::as_u64) == Some(height as u64),
            "rig.image must match source.png dimensions, with rig.version = 1"
        );
        for (key, label) in [("hand", "rig.hand"), ("accessories", "rig.accessories"), ("cloth", "rig.cloth")] {
            let present = match rig.get(key) {
                None | Some(Value::Null) => false,
                Some(Value::Array(items)) => !items.is_empty(),
                Some(_) => true,
            };
            if present {
                bail!(
                    "{label} is not supported by the Rust builder yet; build this avatar with mesh-avatar-studio's tools/build-layers.py"
                );
            }
        }
        let size = (width, height);
        let eyes = rig
            .get("eyes")
            .and_then(Value::as_array)
            .filter(|e| e.len() == 2)
            .context("rig.eyes must contain two eyes")?;
        let eye = |i: usize| -> Result<EyeShape> {
            Ok(EyeShape {
                opening: points(field(&eyes[i], "opening", "eyes")?, &format!("eyes[{i}].opening"), 3, size)?,
                roi: points(field(&eyes[i], "roi", "eyes")?, &format!("eyes[{i}].roi"), 3, size)?,
            })
        };
        let face = field(rig, "face", "rig")?;
        let head = field(rig, "head", "rig")?;
        let body = field(rig, "body", "rig")?;
        let mut strands = Vec::new();
        if let Some(list) = rig.get("strands").and_then(Value::as_array) {
            for (i, s) in list.iter().enumerate() {
                let path = format!("strands[{i}]");
                let strand = Strand {
                    nodes: points(field(s, "nodes", &path)?, &format!("{path}.nodes"), 2, size)?,
                    sigma: number(field(s, "sigma", &path)?, &format!("{path}.sigma"))?,
                    max: number(field(s, "max", &path)?, &format!("{path}.max"))?,
                };
                ensure!(strand.sigma > 0.0 && strand.max > 0.0, "{path}: sigma and max must be positive");
                strands.push(strand);
            }
        }
        let mut buns = Vec::new();
        if let Some(map) = rig.get("buns").and_then(Value::as_object) {
            for (name, bun) in map {
                buns.push(ellipse(bun, &format!("buns.{name}"))?);
            }
        }
        let shoulders = field(body, "shoulders", "body")?
            .as_array()
            .context("body.shoulders: expected a list")?
            .iter()
            .enumerate()
            .map(|(i, s)| ellipse(s, &format!("body.shoulders[{i}]")))
            .collect::<Result<_>>()?;
        Ok(Self {
            width,
            height,
            eyes: [eye(0)?, eye(1)?],
            head: ellipse(head, "head")?,
            brow: ellipse(field(face, "brow", "face")?, "face.brow")?,
            mouth_face: ellipse(field(face, "mouth", "face")?, "face.mouth")?,
            nose: ellipse(field(face, "nose", "face")?, "face.nose")?,
            strands,
            buns,
            chest: ellipse(field(body, "chest", "body")?, "body.chest")?,
            shoulders,
            mouth_area: rig
                .get("mouth")
                .and_then(|m| m.get("area"))
                .map(|a| ellipse(a, "mouth.area"))
                .transpose()?,
        })
    }
}

/// 竖线 `x` 与多边形交点的最小与最大 y。
fn column_span(poly: &[[f64; 2]], x: f64) -> Result<(f64, f64)> {
    let n = poly.len();
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    let mut count = 0;
    for i in 0..n {
        let ([ax, ay], [bx, by]) = (poly[i], poly[(i + 1) % n]);
        if (ax - x) * (bx - x) <= 0.0 && ax != bx {
            let y = ay + (by - ay) * (x - ax) / (bx - ax);
            lo = lo.min(y);
            hi = hi.max(y);
            count += 1;
        }
    }
    ensure!(count >= 2, "eye opening must enclose a vertical span at every sampled column");
    Ok((lo, hi))
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// 眼睛开口上下沿在 24 列上的采样；两端是眼角，上下沿在那里合拢。
pub fn eye_curves(opening: &[[f64; 2]]) -> Result<EyeCurves> {
    let x0 = opening.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min);
    let x1 = opening.iter().map(|p| p[0]).fold(f64::NEG_INFINITY, f64::max);
    let mut top = [0.0; EYE_SAMPLES];
    let mut bot = [0.0; EYE_SAMPLES];
    for i in 0..EYE_SAMPLES {
        let t = (i as f64 / (EYE_SAMPLES - 1) as f64).clamp(0.002, 0.998);
        let (a, b) = column_span(opening, x0 + (x1 - x0) * t)?;
        top[i] = round2(a);
        bot[i] = round2(b);
    }
    for k in [0, EYE_SAMPLES - 1] {
        let mid = round2((top[k] + bot[k]) / 2.0);
        top[k] = mid;
        bot[k] = mid;
    }
    Ok(EyeCurves { x0, x1, top, bot })
}

/// 把眼睛曲线写进 rig 的 `eyes[i]`；`x0`/`x1` 沿用开口点里原来的数值写法。
pub fn store_eye_curves(rig: &mut Value, curves: &[EyeCurves; 2]) -> Result<()> {
    let eyes = rig
        .get_mut("eyes")
        .and_then(Value::as_array_mut)
        .context("rig.eyes must contain two eyes")?;
    for (eye, c) in eyes.iter_mut().zip(curves) {
        let opening = eye["opening"].as_array().cloned().unwrap_or_default();
        let pick = |target: f64| {
            opening
                .iter()
                .map(|p| p[0].clone())
                .find(|v| v.as_f64() == Some(target))
                .unwrap_or_else(|| Value::from(target))
        };
        let object = eye.as_object_mut().context("rig.eyes: expected objects")?;
        object.insert("x0".into(), pick(c.x0));
        object.insert("x1".into(), pick(c.x1));
        object.insert("top".into(), c.top.to_vec().into());
        object.insert("bot".into(), c.bot.to_vec().into());
    }
    Ok(())
}

pub fn curves_json(c: &EyeCurves) -> Value {
    serde_json::json!({ "x0": c.x0, "x1": c.x1, "top": c.top.to_vec(), "bot": c.bot.to_vec() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curves_close_at_the_corners() {
        let opening = [[10.0, 20.0], [20.0, 10.0], [30.0, 20.0], [20.0, 30.0]];
        let c = eye_curves(&opening).unwrap();
        assert_eq!((c.x0, c.x1), (10.0, 30.0));
        assert_eq!(c.top[0], c.bot[0]);
        assert_eq!(c.top[23], c.bot[23]);
        assert!(c.top[12] < 12.0 && c.bot[12] > 28.0);
    }

    #[test]
    fn rejects_parts_the_port_does_not_build() {
        let rig = serde_json::json!({"version": 1, "image": {"width": 4, "height": 4}, "hand": {"outline": []}});
        let error = RigView::parse(&rig, 4, 4).unwrap_err().to_string();
        assert!(error.contains("rig.hand is not supported"), "{error}");
    }
}
