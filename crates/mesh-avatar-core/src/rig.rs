//! Typed rig data. Unknown JSON fields are ignored for forward compatibility.

use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};

mod cloth;
pub use cloth::{Cloth, ClothTuning, ClothTuningUpdate};

pub type Point = [f64; 2];
pub type Band = [f64; 2];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ellipse {
    pub cx: f64,
    pub cy: f64,
    pub rx: f64,
    pub ry: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Eye {
    pub opening: Vec<Point>,
    pub roi: Vec<Point>,
    pub x0: f64,
    pub x1: f64,
    pub top: [f64; 24],
    pub bot: [f64; 24],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Strand {
    pub name: String,
    pub nodes: Vec<Point>,
    pub sigma: f64,
    pub k: f64,
    pub max: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Accessory {
    pub name: String,
    pub pivot: Point,
    pub tip: Point,
    pub split: f64,
    pub r#box: [i64; 4],
    pub color: AccessoryColor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessoryColor {
    pub redness: f64,
    pub min_red: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hand {
    pub outline: Vec<Point>,
    pub jaw: Vec<Point>,
    pub jaw_range: Band,
    pub background: Vec<Point>,
    pub elbow: Point,
    pub wrist: Point,
    pub knuckle: Point,
    pub contact: Point,
    pub forearm_share: f64,
    pub arm_band: Band,
    pub wrist_band: Band,
    pub hand_band: Band,
    pub finger_x_band: Band,
    pub finger_y_band: Band,
    pub pin_band: Band,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Head {
    #[serde(flatten)]
    pub ellipse: Ellipse,
    pub shift_x: f64,
    pub shift_y: f64,
    pub pivot_x: f64,
    pub pivot_y: f64,
    pub max_roll: f64,
    pub weight_band: Band,
    pub turn_band: Band,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Body {
    pub pivot_x: f64,
    pub pivot_y: f64,
    pub max_roll: f64,
    pub breath_band: Band,
    pub roll_band: Band,
    pub chest: Ellipse,
    pub shoulders: Vec<Ellipse>,
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub hip: Option<Hip>,
}

fn optional_field<'de, D, T>(deserializer: D) -> std::result::Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hip {
    pub shift: f64,
    pub band: Band,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Leg {
    pub hip: Point,
    pub knee: Point,
    pub ankle: Point,
}

fn default_spine() -> f64 {
    0.7
}
fn default_bob() -> f64 {
    2.0
}
fn default_swing() -> f64 {
    4.0
}
fn default_bend() -> f64 {
    6.0
}
fn default_inward() -> f64 {
    0.4
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Legs {
    #[serde(default = "default_spine")]
    pub spine: f64,
    #[serde(default = "default_bob")]
    pub bob: f64,
    #[serde(default)]
    pub twist: f64,
    pub pelvis: Point,
    pub shift: f64,
    pub tilt: f64,
    pub bend: f64,
    pub band: Band,
    pub left: Leg,
    pub right: Leg,
    pub split: Vec<Point>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Arm {
    pub shoulder: Point,
    pub elbow: Point,
    pub wrist: Point,
    pub split: Vec<Point>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Arms {
    pub left: Arm,
    pub right: Arm,
    #[serde(default = "default_swing")]
    pub swing: f64,
    #[serde(default = "default_bend")]
    pub bend: f64,
    #[serde(default = "default_inward")]
    pub inward: f64,
}

pub(crate) fn split_x(line: &[Point], y: f64) -> f64 {
    let mut i = 0;
    while i < line.len() - 2 && y > line[i + 1][1] {
        i += 1;
    }
    let (a, b) = (line[i], line[i + 1]);
    let t = ((y - a[1]) / (b[1] - a[1])).clamp(0.0, 1.0);
    a[0] + (b[0] - a[0]) * t
}

fn split_line(line: &[Point]) -> Result<()> {
    ensure!(
        line.len() >= 2
            && line.iter().flatten().all(|v| v.is_finite())
            && line.windows(2).all(|p| p[0][1] < p[1][1]),
        "split needs at least two finite points with increasing y"
    );
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BandedEllipse {
    #[serde(flatten)]
    pub ellipse: Ellipse,
    pub band: Band,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Face {
    pub nose: Ellipse,
    pub mouth: Ellipse,
    pub eye_a: Ellipse,
    pub eye_b: Ellipse,
    pub ear_l: Ellipse,
    pub ear_r: Ellipse,
    pub brow: BandedEllipse,
    pub jaw: BandedEllipse,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Buns {
    pub bun_l: Option<Ellipse>,
    pub bun_r: Option<Ellipse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MouthArea {
    #[serde(flatten)]
    pub ellipse: Ellipse,
    pub angle: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mouth {
    pub cx: f64,
    pub cy: f64,
    pub angle: f64,
    pub half_len: f64,
    pub bow: f64,
    pub area: MouthArea,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FineGrid {
    pub x0: i64,
    pub x1: i64,
    pub y0: i64,
    pub y1: i64,
    pub cell: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mesh {
    pub base_cell: u32,
    pub fine: FineGrid,
    pub hand_cell: u32,
    pub tassel_cell: u32,
    pub eye_ball_cell: u32,
    pub eye_cell: u32,
    pub sprite_cell: u32,
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub cloth_cell: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub pad_top: f64,
    pub pad_side: f64,
    pub gaze_center: Option<Point>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rig {
    pub version: u32,
    pub image: ImageSize,
    pub head: Head,
    pub body: Body,
    pub face: Face,
    pub buns: Option<Buns>,
    pub eyes: [Eye; 2],
    pub mouth: Mouth,
    pub cheeks: [Point; 2],
    #[serde(default)]
    pub strands: Vec<Strand>,
    #[serde(default)]
    pub accessories: Vec<Accessory>,
    pub hand: Option<Hand>,
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub legs: Option<Legs>,
    #[serde(
        default,
        deserialize_with = "optional_field",
        skip_serializing_if = "Option::is_none"
    )]
    pub arms: Option<Arms>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cloth: Vec<Cloth>,
    pub mesh: Mesh,
    pub view: View,
}

fn ellipse(e: &Ellipse) -> Result<()> {
    ensure!(e.rx > 0.0 && e.ry > 0.0, "ellipse radii must be positive");
    Ok(())
}

fn band(b: Band) -> Result<()> {
    ensure!(b[0] < b[1], "band start must be less than end");
    Ok(())
}

impl Rig {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let rig: Self = serde_json::from_slice(bytes).context("rig.json: invalid rig JSON")?;
        rig.validate().context("rig.json: invalid rig")?;
        Ok(rig)
    }

    pub fn validate(&self) -> Result<()> {
        ensure!(self.version == 1, "only rig version 1 is supported");
        ensure!(
            self.image.width > 0 && self.image.height > 0,
            "image dimensions must be positive"
        );
        ellipse(&self.head.ellipse)?;
        band(self.head.weight_band)?;
        band(self.head.turn_band)?;
        band(self.body.breath_band)?;
        band(self.body.roll_band)?;
        if let Some(hip) = &self.body.hip {
            ensure!(
                hip.shift.is_finite() && hip.band.iter().all(|v| v.is_finite()),
                "body.hip must be finite"
            );
            band(hip.band)?;
        }
        if let Some(legs) = &self.legs {
            ensure!(
                [legs.shift, legs.tilt, legs.bend, legs.bob]
                    .iter()
                    .all(|v| v.is_finite() && *v >= 0.0),
                "legs amounts must be finite and nonnegative"
            );
            ensure!(
                (0.0..=1.0).contains(&legs.spine) && (0.0..=15.0).contains(&legs.twist),
                "invalid legs spine or twist"
            );
            ensure!(
                legs.pelvis.iter().chain(&legs.band).all(|v| v.is_finite()),
                "legs coordinates must be finite"
            );
            band(legs.band)?;
            split_line(&legs.split).context("legs.split")?;
            for leg in [&legs.left, &legs.right] {
                ensure!(
                    leg.hip
                        .iter()
                        .chain(&leg.knee)
                        .chain(&leg.ankle)
                        .all(|v| v.is_finite()),
                    "leg joints must be finite"
                );
                ensure!(
                    legs.band[0] < leg.hip[1]
                        && leg.hip[1] < leg.knee[1]
                        && leg.knee[1] < leg.ankle[1],
                    "legs require band start < hip y < knee y < ankle y"
                );
            }
        }
        if let Some(arms) = &self.arms {
            ensure!(
                (0.0..=10.0).contains(&arms.swing)
                    && (0.0..=12.0).contains(&arms.bend)
                    && (0.0..=1.0).contains(&arms.inward),
                "invalid arms swing, bend or inward"
            );
            for (i, arm) in [&arms.left, &arms.right].into_iter().enumerate() {
                ensure!(
                    arm.shoulder[1] < arm.elbow[1] && arm.elbow[1] < arm.wrist[1],
                    "arms require shoulder y < elbow y < wrist y"
                );
                split_line(&arm.split).context("arms.split")?;
                ensure!(
                    [&arm.shoulder, &arm.elbow, &arm.wrist]
                        .into_iter()
                        .chain(arm.split.iter())
                        .all(|p| p.iter().all(|v| v.is_finite())
                            && p[0] >= 0.0
                            && p[1] >= 0.0
                            && p[0] < self.image.width as f64
                            && p[1] < self.image.height as f64),
                    "arm points must stay inside the image"
                );
                ensure!(
                    [arm.elbow, arm.wrist].iter().all(|p| if i == 0 {
                        split_x(&arm.split, p[1]) > p[0]
                    } else {
                        split_x(&arm.split, p[1]) < p[0]
                    }),
                    "arm split must lie on the body side of elbow and wrist"
                );
            }
        }
        let f = &self.face;
        for e in [
            &self.body.chest,
            &f.nose,
            &f.mouth,
            &f.eye_a,
            &f.eye_b,
            &f.ear_l,
            &f.ear_r,
            &f.brow.ellipse,
            &f.jaw.ellipse,
            &self.mouth.area.ellipse,
        ]
        .into_iter()
        .chain(self.body.shoulders.iter())
        {
            ellipse(e)?;
        }
        band(f.brow.band)?;
        band(f.jaw.band)?;
        if let Some(buns) = &self.buns {
            for e in [&buns.bun_l, &buns.bun_r].into_iter().flatten() {
                ellipse(e)?;
            }
        }
        for (i, eye) in self.eyes.iter().enumerate() {
            ensure!(
                eye.opening.len() >= 3 && eye.roi.len() >= 3,
                "eyes[{i}]: polygons need at least three points"
            );
            ensure!(eye.x0 < eye.x1, "eyes[{i}]: x1 must exceed x0");
            ensure!(
                eye.top.iter().zip(eye.bot).all(|(&a, b)| a <= b),
                "eyes[{i}]: top must not exceed bottom curve"
            );
        }
        ensure!(self.mouth.half_len > 0.0, "mouth.halfLen must be positive");
        for s in &self.strands {
            ensure!(!s.name.trim().is_empty(), "strand name must not be empty");
            ensure!(
                s.nodes.len() >= 2 && s.nodes.windows(2).all(|p| p[0] != p[1]),
                "strand needs distinct consecutive nodes"
            );
            ensure!(
                s.sigma > 0.0 && s.k > 0.0 && s.max > 0.0,
                "strand sigma/k/max must be positive"
            );
        }
        for a in &self.accessories {
            ensure!(
                !a.name.trim().is_empty(),
                "accessory name must not be empty"
            );
            ensure!(
                a.split > 0.0 && a.split < 1.0,
                "accessory split must be between zero and one"
            );
            ensure!(a.pivot != a.tip, "accessory tip must differ from pivot");
            let [x0, y0, x1, y1] = a.r#box;
            ensure!(
                x0 >= 0
                    && y0 >= 0
                    && x0 < x1
                    && y0 < y1
                    && x1 <= self.image.width as i64
                    && y1 <= self.image.height as i64,
                "accessory rectangle must stay inside image"
            );
            ensure!(
                (0.0..=1.0).contains(&a.color.redness),
                "accessory redness must be between zero and one"
            );
        }
        if let Some(h) = &self.hand {
            ensure!(
                h.outline.len() >= 3 && h.background.len() >= 3 && h.jaw.len() >= 2,
                "invalid hand polygons or jaw"
            );
            ensure!(
                (0.0..=1.0).contains(&h.forearm_share),
                "hand forearmShare must be between zero and one"
            );
            for b in [
                h.jaw_range,
                h.arm_band,
                h.wrist_band,
                h.hand_band,
                h.finger_x_band,
                h.finger_y_band,
                h.pin_band,
            ] {
                band(b)?;
            }
        }
        let m = &self.mesh;
        ensure!(
            m.cloth_cell.is_none_or(|n| n > 0),
            "mesh.clothCell must be positive"
        );
        let mut names = std::collections::BTreeSet::new();
        for c in &self.cloth {
            c.validate()?;
            ensure!(!names.contains(&c.name), "cloth names must be unique");
            ensure!(
                c.parent.as_ref().is_none_or(|p| names.contains(p)),
                "cloth parent must name an earlier entry"
            );
            names.insert(c.name.clone());
        }
        ensure!(
            [
                m.base_cell,
                m.fine.cell,
                m.hand_cell,
                m.tassel_cell,
                m.eye_ball_cell,
                m.eye_cell,
                m.sprite_cell
            ]
            .iter()
            .all(|&n| n > 0),
            "mesh cells must be positive"
        );
        ensure!(
            m.fine.x0 < m.fine.x1 && m.fine.y0 < m.fine.y1,
            "fine rectangle must have positive area"
        );
        ensure!(
            self.view.pad_top > -1.0 && self.view.pad_top < 1.0 && self.view.pad_side > -0.5,
            "view margins must leave a positive viewport"
        );
        Ok(())
    }
}
