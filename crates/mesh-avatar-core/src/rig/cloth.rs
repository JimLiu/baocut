use super::{optional_field, Point};
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ClothTuning {
    pub response_gain: f64,
    pub tier_gain: f64,
    pub high_mode_damping: f64,
    pub swing: f64,
    pub stiffness: f64,
    pub damping: f64,
    pub follow: f64,
    pub cohesion: f64,
    pub wind: f64,
    pub max: f64,
}
impl Default for ClothTuning {
    fn default() -> Self {
        Self {
            response_gain: 1.0,
            tier_gain: 1.0,
            high_mode_damping: 1.0,
            swing: 1.0,
            stiffness: 1.0,
            damping: 1.0,
            follow: 0.85,
            cohesion: 3.0,
            wind: 0.05,
            max: 20.0,
        }
    }
}
impl ClothTuning {
    pub fn validate(&self) -> Result<()> {
        ensure!([self.response_gain, self.tier_gain, self.high_mode_damping, self.swing,
            self.stiffness, self.damping, self.max].iter().all(|v| v.is_finite() && *v > 0.0),
            "cloth responseGain/tierGain/highModeDamping/swing/stiffness/damping/max must be positive and finite");
        ensure!(
            (0.0..=1.0).contains(&self.follow),
            "cloth follow must be between zero and one"
        );
        ensure!(
            self.wind.is_finite() && self.wind >= 0.0,
            "cloth wind must be finite and nonnegative"
        );
        ensure!(
            (0.0..=8.0).contains(&self.cohesion) && self.cohesion.fract() == 0.0,
            "cloth cohesion must be an integer from zero to eight"
        );
        Ok(())
    }
    pub fn updated(&self, update: &ClothTuningUpdate) -> Self {
        let mut out = self.clone();
        macro_rules! set { ($($field:ident),*) => { $(if let Some(v) = update.$field { out.$field = v; })* }; }
        set!(
            response_gain,
            tier_gain,
            high_mode_damping,
            swing,
            stiffness,
            damping,
            follow,
            cohesion,
            wind,
            max
        );
        out
    }
}

/// Partial live override. Missing values preserve the garment's current tuning.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "std::collections::BTreeMap<String, f64>"
)]
pub struct ClothTuningUpdate {
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub response_gain: Option<f64>,
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub tier_gain: Option<f64>,
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub high_mode_damping: Option<f64>,
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub swing: Option<f64>,
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub stiffness: Option<f64>,
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub damping: Option<f64>,
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub follow: Option<f64>,
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub cohesion: Option<f64>,
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub wind: Option<f64>,
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub max: Option<f64>,
}

impl TryFrom<std::collections::BTreeMap<String, f64>> for ClothTuningUpdate {
    type Error = String;
    fn try_from(
        values: std::collections::BTreeMap<String, f64>,
    ) -> std::result::Result<Self, Self::Error> {
        let mut out = Self::default();
        for (key, value) in values {
            let field = match key.as_str() {
                "responseGain" => &mut out.response_gain,
                "tierGain" => &mut out.tier_gain,
                "highModeDamping" => &mut out.high_mode_damping,
                "swing" => &mut out.swing,
                "stiffness" => &mut out.stiffness,
                "damping" => &mut out.damping,
                "follow" => &mut out.follow,
                "cohesion" => &mut out.cohesion,
                "wind" => &mut out.wind,
                "max" => &mut out.max,
                _ => return Err(format!("unknown cloth tuning: {key}")),
            };
            *field = Some(value);
        }
        Ok(out)
    }
}

fn columns() -> usize {
    8
}
fn rows() -> usize {
    5
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cloth {
    pub name: String,
    pub outline: Vec<Point>,
    pub waist: Vec<Point>,
    pub hem: Vec<Point>,
    #[serde(default = "columns")]
    pub columns: usize,
    #[serde(default = "rows")]
    pub rows: usize,
    #[serde(default)]
    pub behind: bool,
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub parent: Option<String>,
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub scale: Option<f64>,
    #[serde(default)]
    pub seams: Vec<Vec<Point>>,
    #[serde(default)]
    pub tiers: Vec<Vec<Point>>,
    #[serde(flatten)]
    pub tuning: ClothTuning,
}
impl Cloth {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            !self.name.is_empty()
                && self
                    .name
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-'),
            "cloth name must be layer-safe"
        );
        ensure!(
            self.outline.len() >= 3 && self.waist.len() >= 2 && self.hem.len() >= 2,
            "invalid cloth outline/waist/hem"
        );
        ensure!(
            self.columns >= 2 && self.rows >= 2,
            "cloth columns and rows must be at least two"
        );
        ensure!(
            self.seams.len() != 1 && self.seams.len() <= 64 && self.tiers.len() <= 8,
            "invalid cloth seams/tiers count"
        );
        ensure!(
            self.seams.iter().chain(&self.tiers).all(|l| l.len() >= 2),
            "cloth lines require at least two points"
        );
        ensure!(
            [&self.outline, &self.waist, &self.hem]
                .into_iter()
                .chain(self.seams.iter())
                .chain(self.tiers.iter())
                .flatten()
                .flatten()
                .all(|v| v.is_finite()),
            "cloth coordinates must be finite"
        );
        ensure!(
            self.scale.is_none_or(|v| v.is_finite() && v > 0.0),
            "cloth scale must be positive"
        );
        self.tuning.validate()?;
        if !self.seams.is_empty() || !self.tiers.is_empty() {
            ensure!(
                self.seams
                    .iter()
                    .all(|s| s.windows(2).all(|p| p[1][1] > p[0][1])),
                "cloth seams y must increase"
            );
        }
        crate::engine::cloth_grid::cloth_grid(self)?;
        Ok(())
    }
}
