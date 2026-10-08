//! BCF 混音与母带声明（规范 §4 文档级 `audio`、§8.4 audio clip 的 `fadeIn` / `fadeOut` / `pan` /
//! `bus` 与 audio 轨的 `muted`）。这里只解析、只给缺省，不碰采样：混音链在 host
//! （`bcut-render` 的 `audio` 模块）。
//!
//! 混音顺序（host 必须照做）：clip 增益与关键帧 → 淡入淡出 → 声像 → 按总线求和 → 闪避
//! （`from` 总线的说话活跃度压 `to` 总线）→ 总线增益 → 求和 → 母带（响度归一与真峰值限幅交替三轮）。

use std::collections::BTreeMap;

use anyhow::{Result, anyhow, bail};
use serde_json::Value;

use crate::json::JsonExt;

/// 没写 `bus`、轨 id 也推不出总线时的总线名。
pub const MAIN_BUS: &str = "main";

/// 闪避缺省：起 20 ms、落 350 ms（与 `bcut-score` 的 `duck` 同一缺省）。
pub const DUCK_ATTACK: f64 = 0.02;
pub const DUCK_RELEASE: f64 = 0.35;
/// 母带缺省：−16 LUFS、−1.2 dBTP（与 `bcut-score` 预览母带同一缺省）。
pub const MASTER_LUFS: f64 = -16.0;
pub const MASTER_TRUE_PEAK: f64 = -1.2;

/// 按轨 id 推缺省总线：`score-<bus>` → `<bus>`；其余带 `-` 的取第一个 `-` 之前（`vo-sea` → `vo`）；
/// 不带 `-` 的、没写 id 的轨（`#<序>`）与 `withAudio` 展开的 clip → [`MAIN_BUS`]。
pub fn default_bus(track: Option<&str>) -> String {
    let Some(id) = track.filter(|id| !id.starts_with('#')) else {
        return MAIN_BUS.to_string();
    };
    if let Some(rest) = id.strip_prefix("score-").filter(|r| !r.is_empty()) {
        return rest.to_string();
    }
    match id.split_once('-') {
        Some((head, _)) if !head.is_empty() => head.to_string(),
        _ => MAIN_BUS.to_string(),
    }
}

/// 一条闪避：`from` 总线有声时按 `depth_db` 压低 `to` 里每条总线。
#[derive(Debug, Clone, PartialEq)]
pub struct Duck {
    pub from: String,
    pub to: Vec<String>,
    pub depth_db: f64,
    pub attack: f64,
    pub release: f64,
}

/// 母带目标。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MasterTarget {
    pub lufs: f64,
    pub true_peak: f64,
}

/// 文档级 `audio`。
#[derive(Debug, Clone, PartialEq, Default)]
pub struct DocAudio {
    /// 总线增益（dB）；没列的总线 0 dB。
    pub buses: BTreeMap<String, f64>,
    pub duck: Vec<Duck>,
    pub master: Option<MasterTarget>,
}

impl DocAudio {
    /// 某条总线的增益（dB）。
    pub fn bus_gain_db(&self, bus: &str) -> f64 {
        self.buses.get(bus).copied().unwrap_or(0.0)
    }

    /// 解析文档级 `audio`（缺席或 `null` 为 `None`）。
    pub fn parse(v: Option<&Value>) -> Result<Option<Self>> {
        let Some(v) = v.filter(|v| !v.is_null()) else {
            return Ok(None);
        };
        let obj = v
            .as_object()
            .ok_or_else(|| anyhow!("schema: audio 必须是对象"))?;
        for key in obj.keys() {
            if !["buses", "duck", "master"].contains(&key.as_str()) {
                bail!("schema: audio.{key} 不认识（buses / duck / master）");
            }
        }
        let num = |v: &Value, path: &str| -> Result<f64> {
            v.as_f64()
                .filter(|x| x.is_finite())
                .ok_or_else(|| anyhow!("schema: {path} 必须是有限数"))
        };
        let mut out = DocAudio::default();
        if let Some(buses) = v.get_("buses").filter(|b| !b.is_null()) {
            let buses = buses
                .as_object()
                .ok_or_else(|| anyhow!("schema: audio.buses 必须是对象"))?;
            for (name, spec) in buses {
                let g = spec
                    .get_("gainDb")
                    .ok_or_else(|| anyhow!("schema: audio.buses.{name}.gainDb 缺失"))?;
                out.buses
                    .insert(name.clone(), num(g, &format!("audio.buses.{name}.gainDb"))?);
            }
        }
        if let Some(duck) = v.get_("duck").filter(|d| !d.is_null()) {
            let duck = duck
                .as_array()
                .ok_or_else(|| anyhow!("schema: audio.duck 必须是数组"))?;
            for (k, d) in duck.iter().enumerate() {
                let path = format!("audio.duck[{k}]");
                let from = d
                    .gstr("from")
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| anyhow!("schema: {path}.from 必须是总线名"))?
                    .to_string();
                let to: Vec<String> = match d.get_("to") {
                    Some(Value::String(s)) => vec![s.clone()],
                    Some(Value::Array(a)) => a
                        .iter()
                        .map(|x| {
                            x.as_str()
                                .map(str::to_owned)
                                .ok_or_else(|| anyhow!("schema: {path}.to 必须是总线名数组"))
                        })
                        .collect::<Result<_>>()?,
                    _ => bail!("schema: {path}.to 必须是总线名数组"),
                };
                if to.is_empty() || to.contains(&from) {
                    bail!("schema: {path}.to 不能为空、也不能含 from 总线");
                }
                let depth_db = num(
                    d.get_("depthDb")
                        .ok_or_else(|| anyhow!("schema: {path}.depthDb 缺失"))?,
                    &format!("{path}.depthDb"),
                )?;
                let time = |key: &str, default: f64| -> Result<f64> {
                    match d.get_(key) {
                        None | Some(Value::Null) => Ok(default),
                        Some(x) => {
                            let t = num(x, &format!("{path}.{key}"))?;
                            if t <= 0.0 {
                                bail!("schema: {path}.{key} 必须 > 0");
                            }
                            Ok(t)
                        }
                    }
                };
                out.duck.push(Duck {
                    from,
                    to,
                    depth_db,
                    attack: time("attack", DUCK_ATTACK)?,
                    release: time("release", DUCK_RELEASE)?,
                });
            }
        }
        if let Some(m) = v.get_("master").filter(|m| !m.is_null()) {
            if !m.is_object() {
                bail!("schema: audio.master 必须是对象");
            }
            let lufs = match m.get_("lufs") {
                None | Some(Value::Null) => MASTER_LUFS,
                Some(x) => num(x, "audio.master.lufs")?,
            };
            let true_peak = match m.get_("truePeak") {
                None | Some(Value::Null) => MASTER_TRUE_PEAK,
                Some(x) => num(x, "audio.master.truePeak")?,
            };
            if !(-70.0..=0.0).contains(&lufs) || !(-20.0..=0.0).contains(&true_peak) {
                bail!("schema: audio.master 越界（lufs −70..0，truePeak −20..0）");
            }
            out.master = Some(MasterTarget { lufs, true_peak });
        }
        Ok(Some(out))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn default_bus_from_track_id() {
        assert_eq!(default_bus(Some("score-music")), "music");
        assert_eq!(default_bus(Some("vo-sea")), "vo");
        assert_eq!(default_bus(Some("vo")), MAIN_BUS);
        assert_eq!(default_bus(Some("#2")), MAIN_BUS);
        assert_eq!(default_bus(Some("score-")), "score");
        assert_eq!(default_bus(None), MAIN_BUS);
    }

    #[test]
    fn parses_buses_duck_master_with_defaults() {
        let a = DocAudio::parse(Some(&json!({
            "buses": {"music": {"gainDb": -3}},
            "duck": [{"from": "vo", "to": ["music", "amb"], "depthDb": 10}],
            "master": {"lufs": -16}
        })))
        .unwrap()
        .unwrap();
        assert_eq!(a.bus_gain_db("music"), -3.0);
        assert_eq!(a.bus_gain_db("sfx"), 0.0);
        assert_eq!(a.duck[0].attack, DUCK_ATTACK);
        assert_eq!(a.duck[0].release, DUCK_RELEASE);
        assert_eq!(
            a.master,
            Some(MasterTarget {
                lufs: -16.0,
                true_peak: MASTER_TRUE_PEAK
            })
        );
        assert_eq!(DocAudio::parse(None).unwrap(), None);
        assert_eq!(DocAudio::parse(Some(&Value::Null)).unwrap(), None);
    }

    #[test]
    fn rejects_bad_shapes() {
        for bad in [
            json!([]),
            json!({"mix": {}}),
            json!({"buses": {"a": {}}}),
            json!({"duck": [{"from": "vo", "to": [], "depthDb": 6}]}),
            json!({"duck": [{"from": "vo", "to": ["vo"], "depthDb": 6}]}),
            json!({"duck": [{"from": "vo", "to": ["m"], "depthDb": 6, "attack": 0}]}),
            json!({"master": {"lufs": 3}}),
        ] {
            assert!(DocAudio::parse(Some(&bad)).is_err(), "{bad}");
        }
    }
}
