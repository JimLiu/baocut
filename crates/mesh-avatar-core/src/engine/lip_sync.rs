use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LipSyncSettings {
    pub granularity: Option<f64>,
    pub openness: Option<f64>,
    pub close_speed: Option<f64>,
    pub preset: Option<String>,
}
impl LipSyncSettings {
    pub fn parse(value: &serde_json::Value) -> Result<Self> {
        ensure!(value.is_object(), "lipSync: expected an object");
        for key in ["granularity", "openness", "closeSpeed"] {
            if let Some(v) = value.get(key) {
                ensure!(
                    v.as_f64()
                        .is_some_and(|n| n.is_finite() && (0.0..=1.0).contains(&n)),
                    "lipSync.{key}: expected 0–1"
                );
            }
        }
        if let Some(v) = value.get("preset") {
            ensure!(
                v.as_str().is_some_and(|s| matches!(
                    s,
                    "calm" | "default" | "lively" | "subtle" | "big" | "custom"
                )),
                "lipSync.preset: invalid preset"
            );
        }
        Ok(serde_json::from_value(value.clone())?)
    }
    pub fn resolve(&self, base: ResolvedLipSync) -> Result<ResolvedLipSync> {
        for v in [self.granularity, self.openness, self.close_speed]
            .into_iter()
            .flatten()
        {
            ensure!(
                v.is_finite() && (0.0..=1.0).contains(&v),
                "lipSync: expected 0–1"
            );
        }
        if let Some(p) = &self.preset {
            ensure!(
                matches!(
                    p.as_str(),
                    "calm" | "default" | "lively" | "subtle" | "big" | "custom"
                ),
                "lipSync.preset: invalid preset"
            );
        }
        Ok(ResolvedLipSync {
            granularity: self.granularity.unwrap_or(base.granularity),
            openness: self.openness.unwrap_or(base.openness),
            close_speed: self.close_speed.unwrap_or(base.close_speed),
        })
    }
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedLipSync {
    pub granularity: f64,
    pub openness: f64,
    pub close_speed: f64,
}
impl Default for ResolvedLipSync {
    fn default() -> Self {
        Self {
            granularity: 0.5,
            openness: 0.5,
            close_speed: 0.5,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct LipMotionOptions {
    pub arm: f64,
    pub trigger: f64,
    pub relax: f64,
    pub range: f64,
    pub rise_power: f64,
    pub openness: f64,
    pub audio_release: f64,
    pub kana_release: f64,
}
fn centered(value: f64, low: f64, center: f64, high: f64) -> f64 {
    if value == 0.5 {
        center
    } else if value < 0.5 {
        low + (center - low) * value * 2.0
    } else {
        center + (high - center) * (value - 0.5) * 2.0
    }
}
impl ResolvedLipSync {
    pub fn motion_options(self) -> LipMotionOptions {
        let g = self.granularity;
        LipMotionOptions {
            arm: centered(g, 0.2, 0.6, 0.9),
            trigger: centered(g, 0.65, 0.8, 0.95),
            relax: centered(g, 1.5, 5.0, 12.0),
            range: centered(g, 0.7, 0.3, 0.05),
            rise_power: centered(g, 0.05, 0.3, 0.8),
            openness: centered(self.openness, 0.55, 1.0, 1.25),
            audio_release: centered(self.close_speed, 6.0, 32.0, 45.0),
            kana_release: centered(self.close_speed, 6.0, 22.0, 45.0),
        }
    }
}
