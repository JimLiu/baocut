//! Drawn eyes, vowel shapes, expression drawings and time-based cross-fades.
use super::{
    grid::{build_grid, Grid},
    rig::{sstep, BaseWeights, Parameters, PhysicsOffsets, RigEngine},
};
use crate::{
    format::{SpriteMetadata, Texture},
    rig::Rig,
};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MouthShape {
    A,
    AHalf,
    I,
    E,
    O,
    U,
}

impl MouthShape {
    fn definition(self) -> (&'static str, f64, f64) {
        match self {
            Self::A => ("mouth_a", 0.9, 1.0),
            Self::AHalf => ("mouth_a_half", 0.55, 1.0),
            Self::I => ("mouth_i", 0.55, 1.0),
            Self::E => ("mouth_a_half", 0.65, 1.06),
            Self::O => ("mouth_o", 0.75, 1.0),
            Self::U => ("mouth_o", 0.75, 0.78),
        }
    }
}

pub fn mouth_shape(open: f64, form: f64, prev: Option<MouthShape>) -> Option<MouthShape> {
    if open < 0.16 {
        return None;
    }
    let regions = [
        (MouthShape::I, -9.0, -0.55),
        (MouthShape::E, -0.55, -0.2),
        (MouthShape::A, -0.2, 0.35),
        (MouthShape::O, 0.35, 0.75),
        (MouthShape::U, 0.75, 9.0),
    ];
    let previous = prev.map(|p| {
        if p == MouthShape::AHalf {
            MouthShape::A
        } else {
            p
        }
    });
    let vowel = regions
        .iter()
        .find(|&&(v, lo, hi)| Some(v) == previous && form >= lo - 0.07 && form < hi + 0.07)
        .or_else(|| regions.iter().find(|&&(_, lo, hi)| form >= lo && form < hi))
        .map(|&(v, _, _)| v)?;
    Some(if vowel == MouthShape::A && open < 0.6 {
        MouthShape::AHalf
    } else {
        vowel
    })
}

pub fn eye_sprite(open: f64, smile: f64, mood: Option<&str>) -> Option<&str> {
    if mood.is_some() && open >= 0.3 {
        return mood;
    }
    if open >= 0.75 {
        return None;
    }
    Some(if open < 0.3 {
        if smile >= 0.5 {
            "eyes_smile"
        } else {
            "eyes_closed"
        }
    } else {
        "eyes_half"
    })
}

pub fn eye_mood(overlay: Option<&str>, expression: Option<&str>) -> Option<&'static str> {
    let value = overlay
        .filter(|s| !s.is_empty() && *s != "neutral")
        .or(expression)?;
    match value {
        "angry" | "angryTalk" => Some("angry"),
        "sad" | "sadTalk" => Some("sad"),
        "surprise" | "surprisedTalk" => Some("surprise"),
        _ => None,
    }
}

fn shut(name: &str) -> bool {
    name.starts_with("eyes_closed") || name.starts_with("eyes_smile")
}
fn order(name: &str) -> u8 {
    if shut(name) {
        1
    } else if name.starts_with("eyes_") {
        0
    } else if matches!(name, "mouth_angry" | "mouth_sad") {
        2
    } else {
        3
    }
}
fn rank(name: &str) -> i8 {
    if name == "open" {
        -1
    } else if shut(name) {
        1
    } else {
        0
    }
}

#[derive(Debug, Clone)]
pub struct SpriteItem {
    pub name: String,
    pub mesh: Grid,
    pub visible: bool,
    pub alpha: f64,
    weights: Vec<BaseWeights>,
    inner: Vec<f64>,
}

#[derive(Clone)]
struct EyeState {
    cur: String,
    prev: String,
    t: f64,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct SpriteCoverage {
    pub eyes: [bool; 2],
    pub mouth: Option<MouthShape>,
    /// Whether a drawing shows the mouth, so the shader mouth is left out.
    #[serde(rename = "mouthDrawn")]
    pub mouth_drawn: bool,
}

pub struct Sprites {
    pub items: Vec<SpriteItem>,
    /// Whether each eye has the closed and half-closed drawings, so the layered eye stays open.
    /// A partial set leaves what is missing to the layered eye and the shader mouth.
    pub eyes_drawn: [bool; 2],
    mouths_drawn: bool,
    last_shape: Option<MouthShape>,
    eye_state: [EyeState; 2],
}

fn mouth_inner(rig: &Rig, x: f64, y: f64) -> f64 {
    let area = &rig.mouth.area;
    let e = &area.ellipse;
    let c = (-area.angle).cos();
    let s = (-area.angle).sin();
    let dx = x - e.cx;
    let dy = y - e.cy;
    let u = (dx * c - dy * s) / e.rx;
    let v = (dx * s + dy * c) / e.ry;
    1.0 - sstep(0.55, 0.95, u.hypot(v))
}

fn place(
    item: &mut SpriteItem,
    engine: &RigEngine<'_>,
    p: &Parameters,
    phys: &PhysicsOffsets,
    squash: f64,
    width: f64,
) {
    let mouth = &engine.rig.mouth;
    for (k, (r, o)) in item
        .mesh
        .rest
        .as_chunks::<2>()
        .0
        .iter()
        .zip(item.mesh.pos.as_chunks_mut::<2>().0)
        .enumerate()
    {
        let mut x = f64::from(r[0]);
        let mut y = f64::from(r[1]);
        let w = item.inner[k];
        if w > 0.0 {
            let line = mouth.cy + (x - mouth.cx) * mouth.angle.tan();
            y = line + (y - line) * (1.0 + (squash - 1.0) * w);
            let cx = mouth.area.ellipse.cx;
            x = cx + (x - cx) * (1.0 + (width - 1.0) * w);
        }
        let point = engine.deform_base(x, y, &item.weights[k], p, phys);
        *o = [point[0] as f32, point[1] as f32];
    }
}

impl Sprites {
    pub fn new(
        engine: &RigEngine<'_>,
        sheet: &SpriteMetadata,
        textures: &BTreeMap<String, Texture>,
    ) -> Result<Self> {
        let mut names: Vec<_> = sheet.layer_order.iter().map(String::as_str).collect();
        if names.is_empty() {
            names.extend(sheet.layers.keys().map(String::as_str));
        }
        names.sort_by_key(|name| order(name));
        let mut items = vec![];
        for name in names {
            let rect = sheet.layers[name].map(f64::from);
            let image = textures
                .get(&format!("sprites/{name}.png"))
                .with_context(|| format!("missing sprite texture: {name}"))?;
            let mesh = build_grid(
                rect,
                engine.rig.mesh.sprite_cell as f64,
                &image.alpha(),
                image.width as usize,
                None,
            )?;
            let weights = mesh
                .rest
                .as_chunks::<2>()
                .0
                .iter()
                .map(|p| engine.base_weights(p[0] as f64, p[1] as f64, 0.0))
                .collect();
            let inner = mesh
                .rest
                .as_chunks::<2>()
                .0
                .iter()
                .map(|p| {
                    if name.starts_with("mouth") {
                        mouth_inner(engine.rig, p[0] as f64, p[1] as f64)
                    } else {
                        0.0
                    }
                })
                .collect();
            items.push(SpriteItem {
                name: name.into(),
                mesh,
                weights,
                inner,
                visible: false,
                alpha: 1.0,
            });
        }
        let has = |name: &str| items.iter().any(|it: &SpriteItem| it.name == name);
        let eyes_drawn = std::array::from_fn(|i| {
            has(&format!("eyes_closed_{i}")) && has(&format!("eyes_half_{i}"))
        });
        let mouths_drawn = [
            MouthShape::A,
            MouthShape::AHalf,
            MouthShape::I,
            MouthShape::E,
            MouthShape::O,
            MouthShape::U,
        ]
        .into_iter()
        .any(|shape| has(shape.definition().0));
        Ok(Self {
            items,
            eyes_drawn,
            mouths_drawn,
            last_shape: None,
            eye_state: std::array::from_fn(|_| EyeState {
                cur: "open".into(),
                prev: "open".into(),
                t: 1.0,
            }),
        })
    }

    fn show(
        &mut self,
        name: &str,
        alpha: f64,
        engine: &RigEngine<'_>,
        p: &Parameters,
        phys: &PhysicsOffsets,
    ) {
        if alpha <= 0.001 {
            return;
        }
        if let Some(item) = self.items.iter_mut().find(|item| item.name == name) {
            item.visible = true;
            item.alpha = alpha;
            place(item, engine, p, phys, 1.0, 1.0);
        }
    }

    pub fn update(
        &mut self,
        engine: &RigEngine<'_>,
        p: &Parameters,
        phys: &PhysicsOffsets,
        dt: f64,
        mood: Option<&str>,
    ) -> SpriteCoverage {
        for item in &mut self.items {
            item.visible = false;
        }
        let mut covered = [false; 2];
        for (i, (open, smile)) in [
            (p.eye_r_open, p.eye_smile),
            (p.eye_l_open, p.eye_smile_l.unwrap_or(p.eye_smile)),
        ]
        .into_iter()
        .enumerate()
        {
            let drawn = mood
                .filter(|&m| {
                    matches!(m, "sad" | "surprise")
                        && self
                            .items
                            .iter()
                            .any(|it| it.name == format!("eyes_{m}_{i}"))
                })
                .map(|m| format!("eyes_{m}"));
            let has = |name: &str| self.items.iter().any(|it| it.name == format!("{name}_{i}"));
            let mut want = eye_sprite(open, smile, drawn.as_deref()).unwrap_or("open");
            if want == "eyes_smile" && !has(want) {
                want = "eyes_closed";
            }
            if want != "open" && !has(want) {
                want = "open";
            }
            let st = &mut self.eye_state[i];
            if want != st.cur {
                st.prev = st.cur.clone();
                st.cur = want.into();
                st.t = 0.0;
            }
            st.t = if dt > 0.0 {
                (st.t + dt / 0.06).min(1.0)
            } else {
                1.0
            };
            let k = sstep(0.0, 1.0, st.t);
            let cur = st.cur.clone();
            let prev = st.prev.clone();
            let t = st.t;
            covered[i] = cur != "open" && k >= 0.999;
            let mut show = |name: &str, alpha| {
                if name != "open" {
                    self.show(&format!("{name}_{i}"), alpha, engine, p, phys);
                }
            };
            if t >= 1.0 {
                show(&cur, 1.0);
            } else if rank(&cur) > rank(&prev) {
                show(&prev, 1.0);
                show(&cur, k);
            } else {
                show(&cur, 1.0);
                show(&prev, 1.0 - k);
            }
        }
        let shape = mouth_shape(p.mouth_open, p.mouth_form, self.last_shape);
        self.last_shape = shape;
        let def = shape.map(MouthShape::definition);
        let mouth = def.and_then(|(name, _, _)| self.items.iter().position(|it| it.name == name));
        if let Some(mood) = mood.filter(|&m| matches!(m, "angry" | "sad")) {
            if mouth.is_none() || p.mouth_open < 0.16 + 0.04 {
                self.show(&format!("mouth_{mood}"), 1.0, engine, p, phys);
            }
        }
        if let (Some(index), Some((_, reference, width))) = (mouth, def) {
            let item = &mut self.items[index];
            item.visible = true;
            item.alpha = sstep(0.16, 0.16 + 0.04, p.mouth_open);
            place(
                item,
                engine,
                p,
                phys,
                (p.mouth_open / reference).clamp(0.5, 1.1),
                width,
            );
        }
        SpriteCoverage {
            eyes: covered,
            mouth: shape,
            mouth_drawn: self.mouths_drawn && (def.is_none() || mouth.is_some()),
        }
    }
}
