//! `model.json`：角色包的清单（格式见 docs/spec/puppet-format-spec.md）。字段名沿用 LivLiv model format v4
//! （Apache-2.0，`schema/livliv-model-v4.json`）的 `canvas`、`anchors`、`layers`、`rig`、`tuning`、`expressions`，
//! 格式头是我们自己的 `"format": "baocut-puppet", "version": 1`；不读 v4 的 `meta`、`files` 与 keyforms（第一版
//! 不支持，见规范）。

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::Error;

pub const FORMAT: &str = "baocut-puppet";
pub const FORMAT_VERSION: u32 = 1;

/// 画布边长的范围（像素）。
pub const CANVAS_MIN: u32 = 16;
pub const CANVAS_MAX: u32 = 8192;
/// 层数上限（与 LivLiv 的 `LIMITS.layers` 相同）。
pub const MAX_LAYERS: usize = 512;
/// 所有层的网格加起来的顶点数上限：按层框在格子上算，与贴图无关（LivLiv 的 `LIMITS.vertices`）。
pub const MAX_VERTICES: usize = 1 << 21;

#[derive(Clone, Debug, Deserialize)]
pub struct Model {
    pub format: String,
    pub version: u32,
    #[serde(default)]
    pub name: String,
    pub canvas: [u32; 2],
    #[serde(default)]
    pub profile: Option<Profile>,
    #[serde(default)]
    pub rig: Option<RigDef>,
    #[serde(default)]
    pub tuning: Option<TuningDef>,
    pub anchors: Anchors,
    #[serde(default)]
    pub expressions: Vec<Expression>,
    pub layers: Vec<LayerDef>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Profile {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub facing: Option<String>,
    #[serde(default)]
    pub glasses: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Expression {
    pub id: String,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct Ellipse {
    pub cx: f64,
    pub cy: f64,
    pub rx: f64,
    pub ry: f64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct BrowLine {
    pub x: Vec<f64>,
    pub bottom: Vec<f64>,
    pub lid: Vec<f64>,
    #[serde(default)]
    pub cap: Option<Vec<f64>>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct Jaw {
    pub top: f64,
    pub chin: f64,
    #[serde(default)]
    pub half: f64,
    #[serde(default)]
    pub open: f64,
    #[serde(default)]
    pub round: f64,
    #[serde(default)]
    pub wide: f64,
}

impl Jaw {
    /// 某个嘴帧画出来时下巴下移多少（模型像素）。
    pub fn drop_of(&self, kind: &str) -> f64 {
        match kind {
            "half" => self.half,
            "open" => self.open,
            "round" => self.round,
            "wide" => self.wide,
            _ => 0.0,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct Anchors {
    pub head: Ellipse,
    pub face: [f64; 4],
    pub neck_y: f64,
    pub top_y: f64,
    pub bottom_y: f64,
    pub hair_root_y: f64,
    #[serde(default)]
    pub collar_y: Option<f64>,
    #[serde(default)]
    pub eyes: Option<Vec<[f64; 4]>>,
    #[serde(default)]
    pub brows: Option<Vec<Option<[f64; 4]>>>,
    #[serde(default)]
    pub brow_lines: Option<Vec<Option<BrowLine>>>,
    #[serde(default)]
    pub jaw: Option<Jaw>,
    #[serde(default)]
    pub chest: Option<Ellipse>,
}

impl Anchors {
    pub fn face_width(&self) -> f64 {
        self.face[2] - self.face[0]
    }
    pub fn face_height(&self) -> f64 {
        self.face[3] - self.face[1]
    }
}

/// 层跟着什么动。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Group {
    Head,
    Body,
    HairBack,
    HairSide,
    HairFront,
    HairInner,
}

impl Group {
    pub fn is_hair(self) -> bool {
        matches!(self, Group::HairBack | Group::HairSide | Group::HairFront | Group::HairInner)
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct LayerDef {
    pub id: String,
    pub texture: String,
    #[serde(default)]
    pub frames: Option<Vec<String>>,
    #[serde(default)]
    pub visemes: Option<Vec<String>>,
    #[serde(default)]
    pub mask: Option<String>,
    #[serde(default)]
    pub talk: Option<String>,
    #[serde(default)]
    pub brow_tex: Option<String>,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub group: Group,
    #[serde(default)]
    pub depth: f64,
    #[serde(default)]
    pub role: Option<String>,
    /// 表情层属于哪个表情（v4 的 `expression`；LivLiv 的运行时叫它 `param`）。
    #[serde(default)]
    pub expression: Option<String>,
    #[serde(default)]
    pub pivot: Option<[f64; 2]>,
    #[serde(default)]
    pub clip: Option<String>,
    #[serde(default)]
    pub range: Option<[f64; 2]>,
    #[serde(default)]
    pub brows: Option<String>,
    #[serde(default)]
    pub rigid: Option<[f64; 2]>,
    #[serde(default)]
    pub blush: Option<BTreeMap<String, f64>>,
    #[serde(default)]
    pub show: Option<BTreeMap<String, f64>>,
    #[serde(default)]
    pub hide: Option<BTreeMap<String, f64>>,
    #[serde(default)]
    pub fall: Option<f64>,
    #[serde(default)]
    pub fall_end: Option<f64>,
    /// 弯折这一层的链（`rig.chains` 的 id）：有链的层不再跟头发弹簧。
    #[serde(default)]
    pub bones: Option<Vec<String>>,
}

impl LayerDef {
    pub fn role(&self) -> &str {
        self.role.as_deref().unwrap_or("")
    }
    /// 表情层的表情：缺省是 `smile`（LivLiv 的 exprAlpha 同样把没写的算作笑）。
    pub fn expression_id(&self) -> &str {
        self.expression.as_deref().unwrap_or("smile")
    }
}

/// `rig`：缺的字段取 [`Rig::default`]。
#[derive(Clone, Debug, Default, Deserialize)]
pub struct RigDef {
    pub yaw: Option<f64>,
    pub pitch: Option<f64>,
    pub roll: Option<f64>,
    pub bulge: Option<f64>,
    pub hair: Option<HairDef>,
    pub hair_limit: Option<f64>,
    pub hair_drive: Option<Vec<f64>>,
    pub wind: Option<f64>,
    pub breath: Option<f64>,
    pub brow: Option<f64>,
    pub body: Option<BodyDef>,
    pub pitch_ease: Option<f64>,
    pub bulge_shape: Option<f64>,
    pub drift: Option<[f64; 2]>,
    pub bulge_extent: Option<Vec<f64>>,
    pub neck: Option<NeckDef>,
    pub jaw: Option<f64>,
    pub chains: Option<Vec<ChainDef>>,
}

/// 自己会甩的一串点（挂饰、辫子、呆毛）：根在前，模型像素。被拉回画好的形状，被根的加速度甩动，按 `hang`
/// 保持下垂（LivLiv 的 `ChainDef`）。
#[derive(Clone, Debug, Deserialize)]
pub struct ChainDef {
    pub id: String,
    /// `head`（缺省）或 `body`。
    #[serde(default)]
    pub attach: Option<String>,
    #[serde(default)]
    pub depth: Option<f64>,
    pub points: Vec<[f64; 2]>,
    /// 根端与尖端拉回画好形状的强度（1/s²）。
    pub k: [f64; 2],
    pub damp: f64,
    pub drive: f64,
    pub hang: f64,
    pub wind: f64,
    #[serde(default)]
    pub freq: Option<f64>,
    #[serde(default)]
    pub limit: Option<f64>,
    #[serde(default)]
    pub sigma: Option<f64>,
    #[serde(default)]
    pub reach: Option<f64>,
    #[serde(default)]
    pub bias: Option<BTreeMap<String, f64>>,
}

/// 链的点数与条数上限（LivLiv 的 `LIMITS.points` / `LIMITS.chains`）。
pub const MAX_CHAINS: usize = 64;
pub const MAX_CHAIN_POINTS: usize = 256;

#[derive(Clone, Debug, Default, Deserialize)]
pub struct HairDef {
    pub front: Option<[f64; 5]>,
    pub back: Option<[f64; 5]>,
    pub side: Option<[f64; 5]>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct BodyDef {
    pub yaw: Option<f64>,
    pub roll: Option<f64>,
    pub breath: Option<f64>,
    pub bust: Option<f64>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct NeckDef {
    pub twist: f64,
    #[serde(default)]
    pub reach: Option<f64>,
}

/// 合上缺省值的 rig。
#[derive(Clone, Debug)]
pub struct Rig {
    pub yaw: f64,
    pub pitch: f64,
    pub roll: f64,
    pub bulge: f64,
    pub hair_front: [f64; 5],
    pub hair_back: [f64; 5],
    pub hair_side: Option<[f64; 5]>,
    pub hair_limit: f64,
    pub hair_drive: Option<[f64; 3]>,
    pub wind: f64,
    pub breath: f64,
    pub brow: f64,
    pub body_yaw: f64,
    pub body_roll: f64,
    pub body_breath: f64,
    pub bust: f64,
    pub pitch_ease: f64,
    pub bulge_shape: f64,
    pub drift: [f64; 2],
    pub bulge_extent: Option<Vec<f64>>,
    pub neck: Option<NeckDef>,
    pub jaw: Option<f64>,
    pub chains: Vec<ChainDef>,
}

impl Default for Rig {
    fn default() -> Self {
        Rig {
            yaw: 0.27,
            pitch: 0.22,
            roll: 0.5,
            bulge: 0.6,
            hair_front: [140.0, 11.0, 0.022, 70.0, 7.0],
            hair_back: [48.0, 5.5, 0.06, 24.0, 3.5],
            hair_side: None,
            hair_limit: 0.25,
            hair_drive: None,
            wind: 1.0,
            breath: 1.0,
            brow: 0.06,
            body_yaw: 0.35,
            body_roll: 0.3,
            body_breath: 1.0,
            bust: 0.0,
            pitch_ease: 0.25,
            bulge_shape: 1.0,
            drift: [0.12, 0.08],
            bulge_extent: None,
            neck: None,
            jaw: None,
            chains: Vec::new(),
        }
    }
}

impl Rig {
    pub fn from_def(def: Option<&RigDef>) -> Rig {
        let mut r = Rig::default();
        let Some(d) = def else { return r };
        let set = |slot: &mut f64, v: Option<f64>| {
            if let Some(v) = v.filter(|v| v.is_finite()) {
                *slot = v;
            }
        };
        set(&mut r.yaw, d.yaw);
        set(&mut r.pitch, d.pitch);
        set(&mut r.roll, d.roll);
        set(&mut r.bulge, d.bulge);
        if let Some(h) = &d.hair {
            if let Some(f) = h.front {
                r.hair_front = f;
            }
            if let Some(b) = h.back {
                r.hair_back = b;
            }
            r.hair_side = h.side;
        }
        set(&mut r.hair_limit, d.hair_limit);
        r.hair_drive = d
            .hair_drive
            .as_ref()
            .filter(|v| v.len() >= 2)
            .map(|v| [v[0], v[1], v.get(2).copied().unwrap_or(v[0])]);
        set(&mut r.wind, d.wind);
        set(&mut r.breath, d.breath);
        set(&mut r.brow, d.brow);
        if let Some(b) = &d.body {
            set(&mut r.body_yaw, b.yaw);
            set(&mut r.body_roll, b.roll);
            set(&mut r.body_breath, b.breath);
            set(&mut r.bust, b.bust);
        }
        set(&mut r.pitch_ease, d.pitch_ease);
        set(&mut r.bulge_shape, d.bulge_shape);
        if let Some(dr) = d.drift {
            r.drift = dr;
        }
        r.bulge_extent = d.bulge_extent.clone().filter(|e| (3..=5).contains(&e.len()));
        r.neck = d.neck;
        r.jaw = d.jaw;
        r.chains = d.chains.clone().unwrap_or_default();
        r
    }
}

/// `tuning`：主人调的手感，1 是缺省。`hair_front` / `hair_back` 缺时取 `hair`。
#[derive(Clone, Debug, Default, Deserialize)]
pub struct TuningDef {
    pub turn: Option<f64>,
    pub nod: Option<f64>,
    pub hair: Option<f64>,
    pub hair_front: Option<f64>,
    pub hair_back: Option<f64>,
    pub breath: Option<f64>,
    pub gaze: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct Tuning {
    pub turn: f64,
    pub nod: f64,
    pub hair_front: f64,
    pub hair_back: f64,
    pub breath: f64,
    /// 眼珠走它行程的多少，0–1。
    pub gaze: f64,
}

impl Tuning {
    pub fn from_def(def: Option<&TuningDef>) -> Tuning {
        let d = def.cloned().unwrap_or_default();
        let pick = |v: Option<f64>, or: f64| v.filter(|v| v.is_finite() && *v >= 0.0).unwrap_or(or);
        let hair = pick(d.hair, 1.0);
        let gaze = pick(d.gaze, 1.0);
        Tuning {
            turn: pick(d.turn, 1.0),
            nod: pick(d.nod, 1.0),
            hair_front: pick(d.hair_front, hair),
            hair_back: pick(d.hair_back, hair),
            breath: pick(d.breath, 1.0),
            gaze: if gaze < 1.0 { gaze } else { 1.0 },
        }
    }
}

impl Model {
    pub fn parse(json: &[u8]) -> Result<Model, Error> {
        let model: Model = serde_json::from_slice(json).map_err(|e| Error::invalid(format!("model.json is not valid: {e}")))?;
        model.validate()?;
        Ok(model)
    }

    fn validate(&self) -> Result<(), Error> {
        if self.format != FORMAT {
            return Err(Error::invalid(format!(
                "model.json format is \"{}\", expected \"{FORMAT}\"",
                self.format
            )));
        }
        if self.version != FORMAT_VERSION {
            return Err(Error::unsupported(format!(
                "model.json version {} is not supported (this reader reads {FORMAT_VERSION})",
                self.version
            )));
        }
        let [w, h] = self.canvas;
        if !(CANVAS_MIN..=CANVAS_MAX).contains(&w) || !(CANVAS_MIN..=CANVAS_MAX).contains(&h) {
            return Err(Error::invalid(format!(
                "canvas {w}x{h} is out of range ({CANVAS_MIN}-{CANVAS_MAX})"
            )));
        }
        if self.layers.is_empty() {
            return Err(Error::invalid("the model has no layers"));
        }
        if self.layers.len() > MAX_LAYERS {
            return Err(Error::too_large(format!(
                "the model has {} layers, at most {MAX_LAYERS}",
                self.layers.len()
            )));
        }
        let a = &self.anchors;
        let finite = [
            a.head.cx,
            a.head.cy,
            a.head.rx,
            a.head.ry,
            a.neck_y,
            a.top_y,
            a.bottom_y,
            a.hair_root_y,
        ]
        .iter()
        .chain(a.face.iter())
        .all(|v| v.is_finite());
        if !finite || a.head.rx <= 0.0 || a.head.ry <= 0.0 || a.face_width() <= 0.0 || a.face_height() <= 0.0 {
            return Err(Error::invalid("anchors.head / anchors.face are not a usable ellipse and box"));
        }
        let chains = self.rig.as_ref().and_then(|r| r.chains.as_ref());
        if chains.is_some_and(|c| c.len() > MAX_CHAINS) {
            return Err(Error::too_large(format!("rig.chains has more than {MAX_CHAINS} chains")));
        }
        for c in chains.into_iter().flatten() {
            let finite = c
                .points
                .iter()
                .flatten()
                .chain(c.k.iter())
                .chain([c.damp, c.drive, c.hang, c.wind].iter())
                .all(|v| v.is_finite());
            if c.points.len() < 2 || c.points.len() > MAX_CHAIN_POINTS || !finite {
                return Err(Error::invalid(format!(
                    "chain \"{}\" needs 2-{MAX_CHAIN_POINTS} finite points and finite k, damp, drive, hang, wind",
                    c.id
                )));
            }
        }
        let mut ids = std::collections::BTreeSet::new();
        let mut vertices = 0usize;
        for l in &self.layers {
            if !ids.insert(l.id.as_str()) {
                return Err(Error::invalid(format!("layer id \"{}\" appears twice", l.id)));
            }
            // 层框可以伸出画布（被画布切掉的头发、身体），但不超过一个画布远（LivLiv 同样的范围）。
            let (fw, fh) = (f64::from(w), f64::from(h));
            let in_range = [l.x, l.y, l.w, l.h, l.depth].iter().all(|v| v.is_finite())
                && l.w > 0.0
                && l.h > 0.0
                && l.x >= -fw
                && l.y >= -fh
                && l.x + l.w <= 2.0 * fw
                && l.y + l.h <= 2.0 * fh;
            if !in_range {
                return Err(Error::invalid(format!("layer \"{}\": its box is out of range", l.id)));
            }
            let cell = f64::from(lattice_cell(w, h));
            let cols = ((l.x + l.w) / cell).ceil() - (l.x / cell).floor() + 1.0;
            let rows = ((l.y + l.h) / cell).ceil() - (l.y / cell).floor() + 1.0;
            vertices += (cols * rows) as usize;
            for path in std::iter::once(&l.texture)
                .chain(l.frames.iter().flatten())
                .chain(l.mask.iter())
                .chain(l.talk.iter())
                .chain(l.brow_tex.iter())
            {
                if !texture_path_ok(path) {
                    return Err(Error::invalid(format!(
                        "layer \"{}\": \"{path}\" is not a texture path of the package",
                        l.id
                    )));
                }
            }
            if let (Some(frames), Some(visemes)) = (&l.frames, &l.visemes)
                && frames.len() != visemes.len()
            {
                return Err(Error::invalid(format!("layer \"{}\": frames and visemes differ in length", l.id)));
            }
        }
        if vertices > MAX_VERTICES {
            return Err(Error::too_large(format!(
                "the layers' meshes would have {vertices} vertices, at most {MAX_VERTICES}"
            )));
        }
        Ok(())
    }
}

/// 所有层的网格共用的格子边长（模型像素）：同一个格点在每一层上都按同样的方式移动，重叠的层不会错开。
pub fn lattice_cell(w: u32, h: u32) -> u32 {
    ((f64::from(w.max(h)) / 128.0).round() as u32).max(6)
}

/// `textures/<name>.png|webp`，不含 `..` 与子目录。
fn texture_path_ok(path: &str) -> bool {
    let Some(name) = path.strip_prefix("textures/") else { return false };
    let ext_ok = name.ends_with(".png") || name.ends_with(".webp");
    let first_ok = name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
    ext_ok && first_ok && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-')) && !name.contains("..")
}
