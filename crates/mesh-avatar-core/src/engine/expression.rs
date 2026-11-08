use super::{motion::expression_target, rig::Parameters};
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const OVERLAY_EXPRESSIONS: &[(&str, &str)] = &[
    ("neutral", "normal"),
    ("smile", "smile"),
    ("shy", "shy"),
    ("surprise", "surprise"),
    ("halfLidded", "jito"),
    ("angry", "angryTalk"),
    ("sad", "sadTalk"),
    ("wink", "wink"),
];

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpressionMouthSettings {
    /// Resting mouth opening, 0–1. None preserves the built-in value.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mouth_open: Option<f64>,
}

/// Settings for live expressions only; neutral and unknown names are ignored.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ExpressionSettings(pub BTreeMap<String, ExpressionMouthSettings>);

fn configurable(name: &str) -> bool {
    name != "neutral" && OVERLAY_EXPRESSIONS.iter().any(|(n, _)| *n == name)
}

impl ExpressionSettings {
    pub fn parse(value: &serde_json::Value) -> Result<Self> {
        let entries = value
            .as_object()
            .ok_or_else(|| anyhow::anyhow!("expressions: expected an object"))?;
        let mut settings = Self::default();
        for (name, entry) in entries {
            if !configurable(name) {
                continue;
            }
            ensure!(entry.is_object(), "expressions.{name}: expected an object");
            let mouth_open = if let Some(value) = entry.get("mouthOpen") {
                let number = value.as_f64();
                ensure!(
                    number.is_some_and(|n| n.is_finite() && (0.0..=1.0).contains(&n)),
                    "expressions.{name}.mouthOpen: expected 0–1"
                );
                number
            } else {
                None
            };
            settings
                .0
                .insert(name.clone(), ExpressionMouthSettings { mouth_open });
        }
        Ok(settings)
    }

    /// Explicit fields override saved fields; empty entries preserve saved values.
    /// Also validate values supplied directly through the Rust API.
    pub fn merge(&self, explicit: &Self) -> Result<Self> {
        let mut merged = Self::default();
        for settings in [self, explicit] {
            for (name, entry) in &settings.0 {
                if !configurable(name) {
                    continue;
                }
                let target = merged.0.entry(name.clone()).or_default();
                if let Some(value) = entry.mouth_open {
                    ensure!(
                        value.is_finite() && (0.0..=1.0).contains(&value),
                        "expressions.{name}.mouthOpen: expected 0–1"
                    );
                    target.mouth_open = Some(value);
                }
            }
        }
        Ok(merged)
    }
}

pub fn overlay_target(name: &str) -> BTreeMap<String, f64> {
    let expr = OVERLAY_EXPRESSIONS
        .iter()
        .find(|(n, _)| *n == name)
        .map_or("normal", |(_, e)| *e);
    let mut target = expression_target(expr);
    target.insert("pitch".into(), if name == "sad" { -6.0 } else { 0.0 });
    if name == "sad" {
        target.insert("gy".into(), -0.45);
    }
    target
}
pub fn apply_overlay(p: &Parameters, m: &BTreeMap<String, f64>) -> Parameters {
    let mut out = p.clone();
    out.eye_r_open = p.eye_r_open * m["eyeOpen"];
    out.eye_l_open = p.eye_l_open * m["eyeOpenL"];
    out.eye_smile = p.eye_smile.max(m["eyeSmile"]);
    out.eye_smile_l = Some(p.eye_smile_l.unwrap_or(p.eye_smile).max(m["eyeSmileL"]));
    out.blush = p.blush.max(m["blush"]);
    out.brow_y = (p.brow_y + m["browY"]).clamp(-1.0, 1.0);
    out.brow_angle = (p.brow_angle + m["browAngle"]).clamp(-1.0, 1.0);
    out.mouth_open = p.mouth_open.max(m["mouthOpen"]);
    // While the expression's own mouth is open wider than the voice or tracking, show its mouth
    // shape too (surprise is an "o"); louder syllables keep the lip-sync vowel.
    if m["mouthOpen"] > p.mouth_open {
        out.mouth_form = m["mouthForm"];
    }
    out.gaze_x = (p.gaze_x + m["gx"]).clamp(-1.0, 1.0);
    out.gaze_y = (p.gaze_y + m["gy"]).clamp(-1.0, 1.0);
    out.angle_y = (p.angle_y + m["pitch"]).clamp(-30.0, 30.0);
    out
}
pub struct ExpressionOverlay {
    pub name: String,
    mix: BTreeMap<String, f64>,
    settings: ExpressionSettings,
}
impl Default for ExpressionOverlay {
    fn default() -> Self {
        Self {
            name: "neutral".into(),
            mix: overlay_target("neutral"),
            settings: ExpressionSettings::default(),
        }
    }
}
impl ExpressionOverlay {
    pub fn with_settings(settings: ExpressionSettings) -> Result<Self> {
        Ok(Self {
            settings: ExpressionSettings::default().merge(&settings)?,
            ..Self::default()
        })
    }
    pub fn set(&mut self, name: &str) {
        self.name = if OVERLAY_EXPRESSIONS.iter().any(|(n, _)| *n == name) {
            name
        } else {
            "neutral"
        }
        .into();
    }
    pub fn active(&self) -> bool {
        self.name != "neutral"
            || overlay_target("neutral")
                .iter()
                .any(|(key, value)| (self.mix[key] - value).abs() > 1e-3)
    }
    pub fn apply(&mut self, p: &Parameters, dt: f64) -> Parameters {
        if !self.active() {
            self.mix = overlay_target("neutral");
            return p.clone();
        }
        let mut target = overlay_target(&self.name);
        if let Some(value) = self.settings.0.get(&self.name).and_then(|s| s.mouth_open) {
            target.insert("mouthOpen".into(), value);
        }
        let k = 1.0 - (-dt.max(0.0) * 12.0).exp();
        for (key, value) in target {
            let mix = self.mix.get_mut(&key).unwrap();
            *mix += (value - *mix) * k;
        }
        apply_overlay(p, &self.mix)
    }
}
