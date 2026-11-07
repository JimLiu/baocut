//! 动作轨：一段配音对应的逐帧参数（`"format": "baocut-puppet-track"`，见 docs/spec/puppet-format-spec.md）。
//! 换配音只换动作轨，角色包不变。帧之间线性插值；轨里没有的参数由待机动作给出。

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::rig::Params;
use crate::{Error, ErrorKind};

pub const TRACK_FORMAT: &str = "baocut-puppet-track";
pub const TRACK_VERSION: u32 = 1;
/// 动作轨 JSON 的大小上限。
pub const MAX_TRACK_JSON: usize = 64 << 20;
/// 帧率范围与时长上限（秒）。
pub const MAX_FPS: f64 = 240.0;
pub const MAX_DURATION: f64 = 6.0 * 3600.0;
/// 表情通道数上限。
pub const MAX_EXPRESSIONS: usize = 64;
/// 所有通道加起来的采样数上限。
pub const MAX_SAMPLES: usize = 32 << 20;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Raw {
    format: String,
    version: u32,
    fps: f64,
    duration: f64,
    #[serde(default)]
    params: BTreeMap<String, Vec<f64>>,
    #[serde(default)]
    expressions: BTreeMap<String, Vec<f64>>,
}

/// 读好的动作轨。
#[derive(Clone, Debug)]
pub struct Track {
    fps: f64,
    duration: f64,
    params: Vec<Option<Vec<f32>>>,
    expressions: Vec<(String, Vec<f32>)>,
}

fn invalid(m: impl Into<String>) -> Error {
    Error::new(ErrorKind::Invalid, m)
}

impl Track {
    pub fn parse(json: &[u8]) -> Result<Track, Error> {
        if json.len() > MAX_TRACK_JSON {
            return Err(Error::too_large(format!("the motion track is larger than {MAX_TRACK_JSON} bytes")));
        }
        let raw: Raw = serde_json::from_slice(json).map_err(|e| invalid(format!("the motion track is not valid: {e}")))?;
        if raw.format != TRACK_FORMAT {
            return Err(invalid(format!(
                "motion track format is \"{}\", expected \"{TRACK_FORMAT}\"",
                raw.format
            )));
        }
        if raw.version != TRACK_VERSION {
            return Err(Error::unsupported(format!(
                "motion track version {} is not supported (this reader reads {TRACK_VERSION})",
                raw.version
            )));
        }
        if !(raw.fps > 0.0 && raw.fps <= MAX_FPS) {
            return Err(invalid(format!("motion track fps {} is out of range (0-{MAX_FPS}]", raw.fps)));
        }
        if !(raw.duration > 0.0 && raw.duration <= MAX_DURATION) {
            return Err(invalid(format!(
                "motion track duration {} is out of range (0-{MAX_DURATION}]",
                raw.duration
            )));
        }
        if raw.expressions.len() > MAX_EXPRESSIONS {
            return Err(Error::too_large(format!(
                "the motion track has more than {MAX_EXPRESSIONS} expressions"
            )));
        }
        let most = (raw.duration * raw.fps).ceil() as usize + 1;
        let mut total = 0usize;
        let mut check = |name: &str, v: &[f64]| -> Result<Vec<f32>, Error> {
            if v.is_empty() || v.len() > most {
                return Err(invalid(format!(
                    "motion track channel \"{name}\" has {} samples, expected 1-{most}",
                    v.len()
                )));
            }
            total += v.len();
            if total > MAX_SAMPLES {
                return Err(Error::too_large(format!("the motion track has more than {MAX_SAMPLES} samples")));
            }
            Ok(v.iter().map(|&x| x as f32).collect())
        };
        let mut params: Vec<Option<Vec<f32>>> = vec![None; Params::NAMES.len()];
        for (name, v) in &raw.params {
            let i = Params::index(name).ok_or_else(|| invalid(format!("motion track has an unknown parameter \"{name}\"")))?;
            params[i] = Some(check(name, v)?);
        }
        let mut expressions = Vec::new();
        for (id, v) in &raw.expressions {
            if id.is_empty() || id.len() > 64 {
                return Err(invalid("a motion track expression id is empty or longer than 64 bytes"));
            }
            expressions.push((id.clone(), check(id, v)?));
        }
        Ok(Track {
            fps: raw.fps,
            duration: raw.duration,
            params,
            expressions,
        })
    }

    pub fn duration(&self) -> f64 {
        self.duration
    }

    pub fn has(&self, i: usize) -> bool {
        self.params.get(i).is_some_and(Option::is_some)
    }

    fn at(&self, v: &[f32], t: f64) -> f64 {
        let x = (t * self.fps).max(0.0);
        let n = v.len();
        let i = x.floor() as usize;
        if i + 1 >= n {
            return f64::from(v[n - 1]);
        }
        let f = x - i as f64;
        f64::from(v[i]) + (f64::from(v[i + 1]) - f64::from(v[i])) * f
    }

    /// 参数 `i` 在 `t` 秒（没有这个通道时 None）。
    pub fn param(&self, i: usize, t: f64) -> Option<f64> {
        self.params.get(i)?.as_deref().map(|v| self.at(v, t))
    }

    /// 每个表情在 `t` 秒的权重。
    pub fn expressions(&self, t: f64) -> impl Iterator<Item = (&str, f64)> {
        self.expressions.iter().map(move |(id, v)| (id.as_str(), self.at(v, t)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_between_frames() {
        let t = Track::parse(
            br#"{"format":"baocut-puppet-track","version":1,"fps":10,"duration":0.3,
                "params":{"mouthOpen":[0,1,0.5]},"expressions":{"sad":[0,0,1]}}"#,
        )
        .unwrap();
        let m = Params::index("mouthOpen").unwrap();
        assert!(t.has(m) && !t.has(0));
        assert!((t.param(m, 0.05).unwrap() - 0.5).abs() < 1e-6);
        assert!((t.param(m, 0.15).unwrap() - 0.75).abs() < 1e-6);
        assert_eq!(t.param(m, 9.0), Some(0.5));
        assert_eq!(t.expressions(0.2).collect::<Vec<_>>(), vec![("sad", 1.0)]);
    }

    #[test]
    fn rejects_bad_tracks() {
        let bad: [&[u8]; 4] = [
            br#"{"format":"x","version":1,"fps":30,"duration":1}"#,
            br#"{"format":"baocut-puppet-track","version":2,"fps":30,"duration":1}"#,
            br#"{"format":"baocut-puppet-track","version":1,"fps":30,"duration":1,"params":{"nope":[0]}}"#,
            br#"{"format":"baocut-puppet-track","version":1,"fps":10,"duration":0.1,"params":{"smile":[0,0,0,0]}}"#,
        ];
        let kinds: Vec<ErrorKind> = bad.iter().map(|b| Track::parse(b).unwrap_err().kind).collect();
        assert_eq!(
            kinds,
            vec![ErrorKind::Invalid, ErrorKind::Unsupported, ErrorKind::Invalid, ErrorKind::Invalid]
        );
    }
}
