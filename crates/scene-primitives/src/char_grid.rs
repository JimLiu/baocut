//! Bounded character-cell scenes. Sampling is a pure function of local seconds.
use crate::Rgba;
use anyhow::{Result, anyhow, bail};
use serde_json::Value;
use unicode_segmentation::UnicodeSegmentation;

pub const MAX_CELLS: usize = 65_536;

#[derive(Clone, Debug)]
pub struct CharGrid {
    pub cols: usize,
    pub rows: usize,
    pub cell_width: f64,
    pub cell_height: f64,
    pub layers: Vec<Layer>,
    /// Retain the authored data for the read-only stage projection.
    pub source: Value,
}
#[derive(Clone, Debug)]
pub struct Layer {
    pub color: Rgba,
    pub ops: Vec<Op>,
}
#[derive(Clone, Debug)]
pub struct Op {
    pub start: f64,
    pub end: Option<f64>,
    pub kind: OpKind,
}
#[derive(Clone, Debug)]
pub enum OpKind {
    Text {
        x: i32,
        y: i32,
        glyphs: Vec<String>,
        cps: Option<f64>,
        caret: Option<String>,
    },
    Cells {
        cells: Vec<(i32, i32, String)>,
        duration: f64,
    },
    Bar {
        x: i32,
        y: i32,
        width: usize,
        values: Vec<(f64, f64)>,
        filled: String,
        empty: String,
    },
}

fn number(v: &Value, key: &str, default: Option<f64>) -> Result<f64> {
    let n = v
        .get(key)
        .and_then(Value::as_f64)
        .or_else(|| if v.get(key).is_none() { default } else { None });
    n.filter(|n| n.is_finite())
        .ok_or_else(|| anyhow!("schema: charGrid.{key} 须为有限数值"))
}
fn int(v: &Value, key: &str, default: Option<f64>, min: i32, max: i32) -> Result<i32> {
    let n = number(v, key, default)?;
    if n.fract() != 0.0 || n < min as f64 || n > max as f64 {
        bail!("schema: charGrid.{key} 须为 {min}..{max} 的整数");
    }
    Ok(n as i32)
}
fn glyphs(text: &str, budget: &mut usize) -> Result<Vec<String>> {
    if text.len() > 1_048_576 || text.chars().any(|c| c.is_control() && c != '\n') {
        bail!("schema: charGrid 文本含控制字符或过长");
    }
    let out: Vec<_> = text.graphemes(true).map(str::to_owned).collect();
    *budget += out.len();
    if *budget > MAX_CELLS {
        bail!("schema: charGrid 字符数据超过 {MAX_CELLS} 个 grapheme");
    }
    Ok(out)
}
fn symbol(v: &Value, key: &str, default: &str) -> Result<String> {
    let s = match v.get(key) {
        None => default,
        Some(v) => v
            .as_str()
            .ok_or_else(|| anyhow!("schema: charGrid.{key} 须为字符"))?,
    };
    if s.graphemes(true).count() != 1 || s.chars().any(char::is_control) {
        bail!("schema: charGrid.{key} 须为单个 grapheme");
    }
    Ok(s.to_owned())
}

impl CharGrid {
    pub fn parse(v: &Value) -> Result<Self> {
        let object = v
            .as_object()
            .ok_or_else(|| anyhow!("schema: charGrid 须为对象"))?;
        if object.keys().any(|key| {
            ![
                "type",
                "id",
                "style",
                "animate",
                "effects",
                "backdropEffects",
                "cadence",
                "cols",
                "rows",
                "cellWidth",
                "cellHeight",
                "layers",
                "_origin",
                "follow",
                "sizeScale",
                "echo",
            ]
            .contains(&key.as_str())
        }) {
            bail!("schema: charGrid 含未知字段；字体写在 style.font，叠放内容用外层 group");
        }
        let cols = int(v, "cols", None, 1, 256)? as usize;
        let rows = int(v, "rows", None, 1, 256)? as usize;
        let cell_width = number(v, "cellWidth", Some(10.0))?;
        let cell_height = number(v, "cellHeight", Some(20.0))?;
        if !(1.0..=256.0).contains(&cell_width) || !(1.0..=256.0).contains(&cell_height) {
            bail!("schema: charGrid 单元尺寸须在 1..256 px");
        }
        let raw = v
            .get("layers")
            .and_then(Value::as_array)
            .filter(|a| !a.is_empty() && a.len() <= 8)
            .ok_or_else(|| anyhow!("schema: charGrid.layers 须为 1..8 层"))?;
        if cols * rows * raw.len() > MAX_CELLS {
            bail!("schema: charGrid 总格子数超过 {MAX_CELLS}");
        }
        let (mut layers, mut budget, mut op_count) = (Vec::new(), 0, 0);
        let mut ids = std::collections::HashSet::new();
        for layer in raw {
            if layer.as_object().is_some_and(|object| {
                object
                    .keys()
                    .any(|key| !["id", "color", "ops"].contains(&key.as_str()))
            }) {
                bail!("schema: charGrid layer 含未知字段");
            }
            let id = layer
                .get("id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| anyhow!("schema: charGrid layer 缺少 id"))?;
            if !ids.insert(id) {
                bail!("schema: charGrid layer id 重复");
            }
            let color = Rgba::parse_value(layer.get("color"))
                .ok_or_else(|| anyhow!("schema: charGrid layer 缺少有效 color"))?;
            let items = layer
                .get("ops")
                .and_then(Value::as_array)
                .ok_or_else(|| anyhow!("schema: charGrid layer.ops 须为数组"))?;
            op_count += items.len();
            if op_count > 2048 {
                bail!("schema: charGrid ops 超过 2048 条");
            }
            let mut ops = Vec::new();
            for item in items {
                let x = int(item, "x", Some(0.0), -256, 256)?;
                let y = int(item, "y", Some(0.0), -256, 256)?;
                let start = number(item, "start", Some(0.0))?;
                let end = item
                    .get("end")
                    .map(|_| number(item, "end", None))
                    .transpose()?;
                if start < 0.0 || end.is_some_and(|end| end <= start) {
                    bail!("schema: charGrid op 须满足 0 ≤ start < end");
                }
                let name = item.get("op").and_then(Value::as_str).unwrap_or("");
                let allowed: &[&str] = match name {
                    "text" => &["text", "cps", "caret"],
                    "sprite" => &["lines", "dur"],
                    "box" => &["width", "height", "dur"],
                    "bar" => &["width", "value", "filled", "empty"],
                    _ => bail!("schema: 未知 charGrid op {name}"),
                };
                if item.as_object().is_some_and(|object| {
                    object.keys().any(|k| {
                        !["id", "op", "x", "y", "start", "end"].contains(&k.as_str())
                            && !allowed.contains(&k.as_str())
                    })
                }) {
                    bail!("schema: charGrid {name} 含未知字段");
                }
                let kind = match name {
                    "text" => {
                        let text = item
                            .get("text")
                            .and_then(Value::as_str)
                            .ok_or_else(|| anyhow!("schema: charGrid text 缺少 text"))?;
                        let cps = item
                            .get("cps")
                            .map(|_| number(item, "cps", None))
                            .transpose()?;
                        if cps.is_some_and(|c| !(0.0..=10000.0).contains(&c) || c == 0.0) {
                            bail!("schema: cps 须在 (0,10000]");
                        }
                        OpKind::Text {
                            x,
                            y,
                            glyphs: glyphs(text, &mut budget)?,
                            cps,
                            caret: item
                                .get("caret")
                                .map(|_| symbol(item, "caret", "▌"))
                                .transpose()?,
                        }
                    }
                    "sprite" | "box" => {
                        let duration = number(item, "dur", Some(0.0))?;
                        if duration < 0.0 {
                            bail!("schema: charGrid dur 须非负");
                        }
                        let mut cells = Vec::new();
                        if name == "sprite" {
                            let lines = item
                                .get("lines")
                                .and_then(Value::as_array)
                                .filter(|a| a.len() <= 256)
                                .ok_or_else(|| {
                                    anyhow!("schema: sprite.lines 须为最多 256 行的数组")
                                })?;
                            for (dy, line) in lines.iter().enumerate() {
                                let line = line.as_str().filter(|s| !s.contains('\n')).ok_or_else(
                                    || anyhow!("schema: sprite 每行须为无换行字符串"),
                                )?;
                                let chars = glyphs(line, &mut budget)?;
                                if chars.len() > 256 {
                                    bail!("schema: sprite 行超过 256 格");
                                }
                                cells.extend(
                                    chars
                                        .into_iter()
                                        .enumerate()
                                        .map(|(dx, g)| (x + dx as i32, y + dy as i32, g)),
                                );
                            }
                        } else {
                            let w = int(item, "width", None, 2, 256)?;
                            let h = int(item, "height", None, 2, 256)?;
                            for dx in 0..w {
                                cells.push((
                                    x + dx,
                                    y,
                                    if dx == 0 {
                                        "┌"
                                    } else if dx == w - 1 {
                                        "┐"
                                    } else {
                                        "─"
                                    }
                                    .into(),
                                ));
                            }
                            for dy in 1..h {
                                cells.push((
                                    x + w - 1,
                                    y + dy,
                                    if dy == h - 1 { "┘" } else { "│" }.into(),
                                ));
                            }
                            for dx in (0..w - 1).rev() {
                                cells.push((
                                    x + dx,
                                    y + h - 1,
                                    if dx == 0 { "└" } else { "─" }.into(),
                                ));
                            }
                            for dy in (1..h - 1).rev() {
                                cells.push((x, y + dy, "│".into()));
                            }
                        }
                        if name == "box" {
                            budget += cells.len();
                        }
                        if budget > MAX_CELLS {
                            bail!("schema: charGrid 格子数据超过 {MAX_CELLS}");
                        }
                        OpKind::Cells { cells, duration }
                    }
                    "bar" => {
                        let width = int(item, "width", None, 1, 256)? as usize;
                        budget += width;
                        if budget > MAX_CELLS {
                            bail!("schema: charGrid 格子数据超过 {MAX_CELLS}");
                        }
                        let value = item
                            .get("value")
                            .ok_or_else(|| anyhow!("schema: bar 缺少 value"))?;
                        let mut values = Vec::new();
                        if let Some(n) = value.as_f64() {
                            values.push((0.0, n));
                        } else if let Some(frames) =
                            value.as_array().filter(|a| !a.is_empty() && a.len() <= 512)
                        {
                            for frame in frames {
                                values.push((number(frame, "t", None)?, number(frame, "v", None)?));
                            }
                        } else {
                            bail!("schema: bar.value 须为数值或最多 512 个 {{t,v}} 帧");
                        }
                        if values.iter().any(|(t, v)| {
                            !t.is_finite() || *t < 0.0 || !v.is_finite() || !(0.0..=1.0).contains(v)
                        }) || values.windows(2).any(|p| p[0].0 >= p[1].0)
                        {
                            bail!("schema: bar 的 t 须递增、v 在 0..1");
                        }
                        OpKind::Bar {
                            x,
                            y,
                            width,
                            values,
                            filled: symbol(item, "filled", "█")?,
                            empty: symbol(item, "empty", "░")?,
                        }
                    }
                    _ => unreachable!(),
                };
                ops.push(Op { start, end, kind });
            }
            layers.push(Layer { color, ops });
        }
        let mut source = serde_json::Map::new();
        for key in ["cols", "rows", "cellWidth", "cellHeight", "layers"] {
            if let Some(value) = v.get(key) {
                source.insert(key.into(), value.clone());
            }
        }
        Ok(Self {
            cols,
            rows,
            cell_width,
            cell_height,
            layers,
            source: Value::Object(source),
        })
    }

    /// Later operations replace cells within a layer; transparent layers remain ordered.
    pub fn sample_layer<'a>(&'a self, layer: &'a Layer, t: f64) -> Vec<Option<&'a str>> {
        let mut cells = vec![None; self.cols * self.rows];
        let mut put = |x: i32, y: i32, g: &'a str| {
            if x >= 0 && y >= 0 && (x as usize) < self.cols && (y as usize) < self.rows {
                cells[y as usize * self.cols + x as usize] = Some(g);
            }
        };
        for op in &layer.ops {
            if t < op.start || op.end.is_some_and(|end| t >= end) {
                continue;
            }
            let elapsed = t - op.start;
            match &op.kind {
                OpKind::Text {
                    x,
                    y,
                    glyphs,
                    cps,
                    caret,
                } => {
                    let count = cps.map_or(glyphs.len(), |c| {
                        ((elapsed * c + 1e-9).floor() as usize).min(glyphs.len())
                    });
                    let (mut cx, mut cy) = (*x, *y);
                    for g in &glyphs[..count] {
                        if g == "\n" {
                            cx = *x;
                            cy += 1;
                        } else {
                            put(cx, cy, g);
                            cx += 1;
                        }
                    }
                    if let Some(caret) = caret
                        && (elapsed * 2.0).floor() as u64 % 2 == 0
                    {
                        put(cx, cy, caret);
                    }
                }
                OpKind::Cells { cells, duration } => {
                    let n = if *duration == 0.0 {
                        cells.len()
                    } else {
                        ((elapsed / duration).clamp(0.0, 1.0) * cells.len() as f64 + 1e-9).floor()
                            as usize
                    };
                    for (x, y, g) in cells.iter().take(n) {
                        put(*x, *y, g);
                    }
                }
                OpKind::Bar {
                    x,
                    y,
                    width,
                    values,
                    filled,
                    empty,
                } => {
                    let i = values.partition_point(|(t, _)| *t <= elapsed);
                    let value = if i == 0 {
                        values[0].1
                    } else if i == values.len() {
                        values[i - 1].1
                    } else {
                        let (a, b) = (values[i - 1], values[i]);
                        a.1 + (b.1 - a.1) * (elapsed - a.0) / (b.0 - a.0)
                    };
                    let n = (value * (*width as f64) + 1e-9).floor() as usize;
                    for col in 0..*width {
                        put(*x + col as i32, *y, if col < n { filled } else { empty });
                    }
                }
            }
        }
        cells
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn typing_border_and_bar_are_pure_cell_operations() {
        let g = CharGrid::parse(
            &json!({"cols":12,"rows":5,"layers":[{"id":"base","color":"#fff","ops":[
                {"op":"box","width":12,"height":5,"dur":1},
                {"op":"text","x":1,"y":1,"text":"A👩‍💻é","start":1,"cps":2},
                {"op":"bar","x":1,"y":3,"width":8,"value":[{"t":0,"v":0},{"t":2,"v":1}]}
            ]}]}),
        )
        .unwrap();
        let cells = g.sample_layer(&g.layers[0], 2.0);
        assert_eq!(cells[13], Some("A"));
        assert_eq!(cells[14], Some("👩‍💻"));
        assert_eq!(cells[15], None);
        assert_eq!(cells[37], Some("█"));
        assert_eq!(cells[44], Some("█"));
        g.sample_layer(&g.layers[0], 0.2);
        assert_eq!(cells, g.sample_layer(&g.layers[0], 2.0));
    }
    #[test]
    fn bounds_and_unknown_operations_fail_closed() {
        for v in [
            json!({"cols":257,"rows":1,"layers":[]}),
            json!({"cols":10,"rows":10,"layers":[{"id":"l","color":"#fff","ops":[{"op":"execute"}]}]}),
        ] {
            assert!(CharGrid::parse(&v).is_err());
        }
    }
}
