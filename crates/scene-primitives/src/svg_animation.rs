//! Deterministic intrinsic SVG animation. The supported SMIL subset is deliberately
//! small: linear numeric opacity and translate/rotate/scale, equal-duration infinite
//! loops, keyTimes and numeric begin offsets. Unsupported animation is an error.
//! Sampling returns static SVG, so native and browser renderers use the project clock.
use anyhow::{Context, Result, bail};
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
struct Track {
    attribute: String,
    transform: Option<String>,
    values: Vec<Vec<f64>>,
    times: Vec<f64>,
    begin: f64,
}
#[derive(Clone, Debug)]
struct Parent {
    range: std::ops::Range<usize>,
    tag: String,
    attrs: BTreeMap<String, String>,
    tracks: Vec<Track>,
}
#[derive(Clone, Debug)]
pub struct SvgAnimation {
    svg: String,
    parents: Vec<Parent>,
    removals: Vec<std::ops::Range<usize>>,
    duration: f64,
}

fn seconds(s: &str) -> Result<f64> {
    let n: f64 = s
        .strip_suffix('s')
        .unwrap_or(s)
        .parse()
        .context("SVG animation: expected seconds")?;
    if !n.is_finite() {
        bail!("SVG animation: non-finite time");
    }
    Ok(n)
}
fn opening_end(text: &str, start: usize) -> Result<usize> {
    let mut quote = None;
    for (i, b) in text.as_bytes()[start..].iter().copied().enumerate() {
        match (quote, b) {
            (Some(q), b) if q == b => quote = None,
            (None, b'\'' | b'"') => quote = Some(b),
            (None, b'>') => return Ok(start + i + 1),
            _ => {}
        }
    }
    bail!("SVG animation: unterminated parent")
}
fn escaped(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
}

impl SvgAnimation {
    pub fn parse(svg: &str) -> Result<Option<Self>> {
        if !svg.contains("animate") && !svg.contains("<set") && !svg.contains(":set") {
            return Ok(None);
        }
        let doc = roxmltree::Document::parse(svg).context("SVG animation: invalid XML")?;
        if doc.root_element().tag_name().name() != "svg"
            || doc.root_element().lookup_namespace_uri(None) != Some("http://www.w3.org/2000/svg")
        {
            bail!("SVG animation: a default SVG namespace is required");
        }
        let mut parents: BTreeMap<usize, Parent> = BTreeMap::new();
        let mut removals = Vec::new();
        let mut duration: Option<f64> = None;
        for n in doc.descendants().filter(|n| n.is_element()) {
            let tag = n.tag_name().name();
            if !matches!(
                tag,
                "animate" | "animateTransform" | "animateMotion" | "set"
            ) {
                continue;
            }
            if !matches!(tag, "animate" | "animateTransform") {
                bail!("SVG animation: unsupported {tag}");
            }
            if n.tag_name().namespace() != Some("http://www.w3.org/2000/svg") {
                bail!("SVG animation: unsupported namespace");
            }
            if n.children().any(|child| child.is_element()) {
                bail!("SVG animation: tracks cannot contain child elements");
            }
            if removals.len() >= 512 {
                bail!("SVG animation: too many tracks");
            }
            for a in n.attributes() {
                if !matches!(
                    a.name(),
                    "attributeName"
                        | "type"
                        | "values"
                        | "keyTimes"
                        | "dur"
                        | "begin"
                        | "repeatCount"
                        | "calcMode"
                ) {
                    bail!("SVG animation: unsupported attribute {}", a.name());
                }
            }
            if n.attribute("repeatCount") != Some("indefinite")
                || n.attribute("calcMode").unwrap_or("linear") != "linear"
            {
                bail!("SVG animation: only linear infinite loops are supported");
            }
            let d = seconds(
                n.attribute("dur")
                    .context("SVG animation: missing duration")?,
            )?;
            if !(0.1..=120.0).contains(&d) {
                bail!("SVG animation: duration outside 0.1..120 seconds");
            }
            if duration.is_some_and(|v| (v - d).abs() > 1e-9) {
                bail!("SVG animation: all tracks must share a cycle duration");
            }
            duration = Some(d);
            let attribute = n.attribute("attributeName").unwrap_or("");
            let transform = if tag == "animateTransform" {
                if attribute != "transform" {
                    bail!("SVG animation: expected transform attribute");
                }
                let kind = n.attribute("type").unwrap_or("");
                if !matches!(kind, "translate" | "rotate" | "scale") {
                    bail!("SVG animation: unsupported transform {kind}");
                }
                Some(kind.to_owned())
            } else {
                if attribute != "opacity" {
                    bail!("SVG animation: only opacity is supported by animate");
                }
                None
            };
            let values: Vec<Vec<f64>> = n
                .attribute("values")
                .context("SVG animation: missing values")?
                .split(';')
                .map(|v| {
                    v.split(|c: char| c.is_whitespace() || c == ',')
                        .filter(|s| !s.is_empty())
                        .map(|s| {
                            s.parse::<f64>()
                                .context("SVG animation: invalid numeric value")
                        })
                        .collect()
                })
                .collect::<Result<_>>()?;
            if !(2..=128).contains(&values.len()) {
                bail!("SVG animation: requires 2..128 values");
            }
            let dims = values[0].len();
            let valid_dims = match transform.as_deref() {
                Some("rotate") => dims == 1 || dims == 3,
                Some(_) => dims == 1 || dims == 2,
                None => dims == 1,
            };
            if !valid_dims
                || values.iter().any(|v| {
                    v.len() != dims || v.iter().any(|x| !x.is_finite() || x.abs() > 100_000.0)
                })
            {
                bail!("SVG animation: invalid value dimensions or range");
            }
            if transform.is_none() && values.iter().any(|v| !(0.0..=1.0).contains(&v[0])) {
                bail!("SVG animation: opacity outside 0..1");
            }
            let times: Vec<f64> = if let Some(raw) = n.attribute("keyTimes") {
                raw.split(';')
                    .map(|s| {
                        s.trim()
                            .parse::<f64>()
                            .context("SVG animation: invalid keyTimes")
                    })
                    .collect::<Result<_>>()?
            } else {
                (0..values.len())
                    .map(|i| i as f64 / (values.len() - 1) as f64)
                    .collect()
            };
            if times.len() != values.len()
                || times[0] != 0.0
                || *times.last().unwrap() != 1.0
                || times.windows(2).any(|p| !p[1].is_finite() || p[1] <= p[0])
            {
                bail!("SVG animation: keyTimes must increase from 0 to 1");
            }
            let begin = seconds(n.attribute("begin").unwrap_or("0s"))?;
            if begin > 0.0 {
                bail!("SVG animation: begin must be a non-positive phase offset");
            }
            let p = n
                .parent_element()
                .context("SVG animation: missing parent")?;
            if p.tag_name().name() == "svg" || p.attributes().any(|a| a.namespace().is_some()) {
                bail!("SVG animation: use an unprefixed child group as parent");
            }
            if p.tag_name().namespace() != Some("http://www.w3.org/2000/svg") {
                bail!("SVG animation: parent must be SVG");
            }
            let start = p.range().start;
            let source_tag = svg[start + 1..]
                .split(|c: char| c.is_whitespace() || c == '>')
                .next()
                .unwrap_or("");
            if source_tag != p.tag_name().name() {
                bail!("SVG animation: prefixed parent tags are unsupported");
            }
            let parent = parents.entry(start).or_insert(Parent {
                range: start..opening_end(svg, start)?,
                tag: p.tag_name().name().to_owned(),
                attrs: p
                    .attributes()
                    .map(|a| (a.name().to_owned(), a.value().to_owned()))
                    .collect(),
                tracks: Vec::new(),
            });
            if parent.tracks.iter().any(|t| t.attribute == attribute) {
                bail!("SVG animation: use nested groups for multiple transforms");
            }
            parent.tracks.push(Track {
                attribute: attribute.to_owned(),
                transform,
                values,
                times,
                begin,
            });
            removals.push(n.range());
        }
        let Some(duration) = duration else {
            return Ok(None);
        };
        Ok(Some(Self {
            svg: svg.to_owned(),
            parents: parents.into_values().collect(),
            removals,
            duration,
        }))
    }
    pub fn duration(&self) -> f64 {
        self.duration
    }
    pub fn sample(&self, seconds: f64) -> String {
        let time = if seconds.is_finite() {
            ((seconds.max(0.0).rem_euclid(self.duration) * 30.0 + 1e-7).floor()) / 30.0
        } else {
            0.0
        };
        let mut edits: Vec<_> = self
            .removals
            .iter()
            .cloned()
            .map(|r| (r, String::new()))
            .collect();
        for p in &self.parents {
            let mut attrs = p.attrs.clone();
            for t in &p.tracks {
                if time < t.begin {
                    continue;
                }
                let phase = (time - t.begin).rem_euclid(self.duration) / self.duration;
                let i = t
                    .times
                    .windows(2)
                    .position(|w| phase < w[1])
                    .unwrap_or(t.times.len() - 2);
                let f = (phase - t.times[i]) / (t.times[i + 1] - t.times[i]);
                let values = t.values[i]
                    .iter()
                    .zip(&t.values[i + 1])
                    .map(|(a, b)| format!("{:.6}", a + (b - a) * f))
                    .collect::<Vec<_>>()
                    .join(" ");
                attrs.insert(
                    t.attribute.clone(),
                    match &t.transform {
                        Some(k) => format!("{k}({values})"),
                        None => values,
                    },
                );
            }
            let open = format!(
                "<{}{}>",
                p.tag,
                attrs
                    .iter()
                    .map(|(k, v)| format!(" {k}=\"{}\"", escaped(v)))
                    .collect::<String>()
            );
            edits.push((p.range.clone(), open));
        }
        edits.sort_by_key(|(r, _)| std::cmp::Reverse(r.start));
        let mut out = self.svg.clone();
        for (range, value) in edits {
            out.replace_range(range, &value);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg"><!-- license --><g transform="translate(0 0)"><animateTransform attributeName="transform" type="translate" values="0 0;20 40;0 0" keyTimes="0;.5;1" dur="2s" repeatCount="indefinite"/><path fill="#123456" d="M0 0h10v10z"/></g><g opacity="1"><animate attributeName="opacity" values="1;.3;1" dur="2s" repeatCount="indefinite"/><circle fill="#ABCDEF" r="4"/></g></svg>"##;
    #[test]
    fn independent_tracks_loop_and_seek_without_mutating_colors() {
        let a = SvgAnimation::parse(SVG).unwrap().unwrap();
        assert_eq!(a.duration(), 2.0);
        assert_eq!(a.sample(0.5), a.sample(2.5));
        let mid = a.sample(1.0);
        assert!(mid.contains("translate(20.000000 40.000000)"));
        assert!(mid.contains("opacity=\"0.300000\""));
        assert!(!mid.contains("<animate"));
        assert!(mid.contains("#123456"));
        assert!(mid.contains("<!-- license -->"));
        assert_eq!(a.sample(0.0), a.sample(0.0));
        assert_ne!(a.sample(0.0), mid);
    }
    #[test]
    fn unsupported_animation_is_never_a_silent_static_fallback() {
        assert!(SvgAnimation::parse(&SVG.replace("translate", "skewX")).is_err());
        assert!(
            SvgAnimation::parse(&SVG.replace("repeatCount=\"indefinite\"", "repeatCount=\"2\""))
                .is_err()
        );
        assert!(SvgAnimation::parse("<svg><animateMotion/></svg>").is_err());
        let track =
            r#"<animate attributeName="opacity" values="0;1" dur="2s" repeatCount="indefinite"/>"#;
        let nested = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg"><g>{}</g></svg>"#,
            track.replace("/>", &format!(">{track}</animate>"))
        );
        assert!(SvgAnimation::parse(&nested).is_err());
        let prefixed = SVG
            .replace("<g ", "<s:g xmlns:s=\"http://www.w3.org/2000/svg\" ")
            .replace("</g>", "</s:g>");
        assert!(SvgAnimation::parse(&prefixed).is_err());
        assert!(
            SvgAnimation::parse(&SVG.replace("dur=\"2s\"", "dur=\"2s\" begin=\"1s\"")).is_err()
        );
    }
}
