//! Local canvases and explicit output-seconds → source-seconds maps. No host I/O.
use anyhow::{Result, bail};
use serde_json::Value;

pub fn crop(value: &Value) -> Result<[f64; 4]> {
    let Some(map) = value.as_object() else {
        bail!("schema: crop 须为 {{x,y,width,height}} 比例矩形");
    };
    if map
        .keys()
        .any(|key| !matches!(key.as_str(), "x" | "y" | "width" | "height"))
    {
        bail!("schema: crop 键无效");
    }
    let mut out = [0.0; 4];
    for (i, key) in ["x", "y", "width", "height"].iter().enumerate() {
        out[i] = value
            .get(key)
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite() && (0.0..=1.0).contains(v))
            .ok_or_else(|| anyhow::anyhow!("schema: crop.{key} 须为 0..1 比例"))?;
    }
    if out[2] <= 0.0
        || out[3] <= 0.0
        || out[0] + out[2] > 1.0 + 1e-9
        || out[1] + out[3] > 1.0 + 1e-9
    {
        bail!("schema: crop 须为源图内的正面积矩形");
    }
    Ok(out)
}

#[derive(Clone, Debug)]
pub struct TimeMap {
    pub points: Vec<(f64, f64)>,
}

impl TimeMap {
    pub fn parse(value: &Value) -> Result<Self> {
        let Some(items) = value.as_array().filter(|v| (2..=4096).contains(&v.len())) else {
            bail!("schema: timeMap 须为 2..4096 个 {{t, source}} 点");
        };
        let mut points = Vec::with_capacity(items.len());
        for item in items {
            let Some(object) = item.as_object() else {
                bail!("schema: timeMap 点须为对象");
            };
            if object
                .keys()
                .any(|key| !matches!(key.as_str(), "t" | "source"))
            {
                bail!("schema: timeMap 点只接受 t/source");
            }
            let number = |key| {
                item.get(key)
                    .and_then(Value::as_f64)
                    .filter(|v| v.is_finite() && *v >= 0.0)
            };
            let (Some(t), Some(source)) = (number("t"), number("source")) else {
                bail!("schema: timeMap 的 t/source 必须是有限非负秒数");
            };
            if points.last().is_some_and(|(previous, _)| t <= *previous) {
                bail!("schema: timeMap 的 t 必须严格递增");
            }
            points.push((t, source));
        }
        if points[0].0 != 0.0 {
            bail!("schema: timeMap 首点 t 必须为 0");
        }
        Ok(Self { points })
    }

    /// Piecewise linear; clamp outside the declared output interval.
    pub fn sample(&self, t: f64) -> f64 {
        let i = self.points.partition_point(|point| point.0 <= t);
        if i == 0 {
            return self.points[0].1;
        }
        if i == self.points.len() {
            return self.points[i - 1].1;
        }
        let (a, b) = (self.points[i - 1], self.points[i]);
        a.1 + (b.1 - a.1) * ((t - a.0) / (b.0 - a.0))
    }

    pub fn linear(duration: f64, start: f64, rate: f64) -> Self {
        Self {
            points: vec![(0.0, start), (duration, start + duration * rate)],
        }
    }

    /// Compose a map with an existing piecewise affine project clock. Reverse and
    /// hold segments are preserved; audio callers choose how to handle their slope.
    pub fn remap(&self, spans: &[TimeSpan]) -> Result<Vec<TimeSpan>> {
        let mut out = Vec::new();
        for span in spans {
            let mut cuts = vec![span.start, span.end];
            if span.from != span.to {
                for (knot, _) in &self.points {
                    let u = (knot - span.from) / (span.to - span.from);
                    if u > 0.0 && u < 1.0 {
                        cuts.push(span.start + u * (span.end - span.start));
                    }
                }
            }
            cuts.sort_by(f64::total_cmp);
            cuts.dedup();
            for pair in cuts.windows(2) {
                let at = |t| {
                    span.from + (span.to - span.from) * ((t - span.start) / (span.end - span.start))
                };
                out.push(TimeSpan {
                    start: pair[0],
                    end: pair[1],
                    from: self.sample(at(pair[0])),
                    to: self.sample(at(pair[1])),
                });
                if out.len() > 4096 {
                    bail!("schema: 嵌套 timeMap 展开超过 4096 段");
                }
            }
        }
        Ok(out)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct TimeSpan {
    pub start: f64,
    pub end: f64,
    pub from: f64,
    pub to: f64,
}

impl TimeSpan {
    pub fn audio_rate(&self) -> Result<Option<f64>> {
        if self.to <= self.from || self.end <= self.start {
            return Ok(None);
        }
        let rate = (self.to - self.from) / (self.end - self.start);
        if !rate.is_finite() || rate <= 0.0 {
            bail!("schema: timeMap 音频速率超出有限数值范围");
        }
        Ok(Some(rate))
    }
}

#[derive(Clone, Debug)]
pub struct LocalCanvas {
    pub width: f64,
    pub height: f64,
    pub duration: f64,
}

impl LocalCanvas {
    pub fn parse(value: &Value) -> Result<Self> {
        let Some(object) = value.as_object() else {
            bail!("schema: composition.canvas 必须为对象");
        };
        if object
            .keys()
            .any(|key| !matches!(key.as_str(), "width" | "height" | "duration"))
        {
            bail!("schema: canvas 只接受 width/height/duration");
        }
        let number = |key| {
            value
                .get(key)
                .and_then(Value::as_f64)
                .filter(|v| v.is_finite() && *v > 0.0)
        };
        let (Some(width), Some(height), Some(duration)) =
            (number("width"), number("height"), number("duration"))
        else {
            bail!("schema: composition.canvas 的 width/height/duration 须为有限正数");
        };
        if width.fract() != 0.0 || height.fract() != 0.0 {
            bail!("schema: composition.canvas 尺寸须为整数像素");
        }
        if width > 16384.0 || height > 16384.0 {
            bail!("schema: composition.canvas 边长不得超过 16384");
        }
        Ok(Self {
            width,
            height,
            duration,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn map_clamps_reverses_and_holds_without_history() {
        let map = TimeMap::parse(
            &json!([{"t":0,"source":2},{"t":1,"source":0},{"t":2,"source":0},{"t":3,"source":4}]),
        )
        .unwrap();
        for (t, source) in [(5.0, 4.0), (0.5, 1.0), (1.5, 0.0), (-1.0, 2.0), (2.5, 2.0)] {
            assert_eq!(map.sample(t), source);
        }
        for invalid in [
            json!([]),
            json!([{"t":1,"source":0},{"t":2,"source":1}]),
            json!([{"t":0,"source":0},{"t":0,"source":1}]),
        ] {
            assert!(TimeMap::parse(&invalid).is_err());
        }
    }
    #[test]
    fn nested_map_splits_at_crossed_knots() {
        let map =
            TimeMap::parse(&json!([{"t":0,"source":0},{"t":1,"source":3},{"t":2,"source":1}]))
                .unwrap();
        let spans = map
            .remap(&[TimeSpan {
                start: 10.0,
                end: 14.0,
                from: 2.0,
                to: 0.0,
            }])
            .unwrap();
        assert_eq!(spans.len(), 2);
        assert_eq!(
            (spans[0].start, spans[0].end, spans[0].from, spans[0].to),
            (10.0, 12.0, 1.0, 3.0)
        );
        assert_eq!((spans[1].from, spans[1].to), (3.0, 0.0));
    }
}
