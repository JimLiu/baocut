//! 角色的状态与每帧的形变（移植自 LivLiv `Puppet` 的 build、update、stepBody、stepPhysics、stepChains、
//! stepMouth、headXform、bodyOffset、deform）。随机的部分不在这里：参数由调用方（[`crate::Player`]）每一步给出。

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use crate::mesh::{self, Bangs, Ctx, Mesh, Nasal};
use crate::model::{ChainDef, Group, LayerDef, Model, Rig, Tuning};
use crate::package::{Package, Texture};
use crate::draw::EYE_SHUT;
use crate::{Error, ErrorKind, smooth};

/// mouthOpen 到多少换半张嘴、张开的嘴，两侧的回差，每一帧嘴至少停多久（秒）。
const MOUTH_AT: [f64; 2] = [0.12, 0.5];
const MOUTH_HYST: f64 = 0.04;
const MOUTH_HOLD: f64 = 0.055;
/// |vowel| 到多少换圆嘴 / 扁嘴，低于多少回到按响度的嘴帧。
const VOWEL_IN: f64 = 0.65;
const VOWEL_OUT: f64 = 0.35;
/// 最后一帧张嘴之后多久仍算在说话（音节之间的空隙）。
const TALK_LATCH: f64 = 0.4;
/// 头这一高度的头发从刘海的弹簧换到侧发弹簧的位置（离头中线多少个头半宽）。
const SIDE_AT: [f64; 2] = [0.5, 0.85];
/// 半闭的眼睛：眼珠的中心往眼睛合向的那一行下移多少（乘上合上的程度）。
const IRIS_DROP: f64 = 0.3;
/// 往鼻子那边看时眼珠最多变窄到多少。
const IRIS_NASAL_NARROW: f64 = 0.7;
/// 没量出下巴下移的模型：张嘴时下巴下移脸高的多少。
const PROC_JAW: f64 = 0.015;
/// 物理的固定步长。
pub const TICK: f64 = 1.0 / 120.0;

/// 驱动角色的一组参数（LivLiv 的 `Params`，名字与范围相同）。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Params {
    pub angle_x: f64,
    pub angle_y: f64,
    pub angle_z: f64,
    pub eye_l_open: f64,
    pub eye_r_open: f64,
    pub eye_ball_x: f64,
    pub eye_ball_y: f64,
    pub brow_ly: f64,
    pub brow_ry: f64,
    pub mouth_open: f64,
    pub smile: f64,
    /// 元音：-1 圆（o、u），+1 扁（i、e），0 都不是。
    pub vowel: f64,
    pub body_x: f64,
    pub body_z: f64,
    pub breath: f64,
    /// 整个角色在画布里的平移（LivLiv 的 `frame.move`）：x 向右、y 向上，单位是画布的宽、高。下沿切在画外的角色
    /// 只往下移（[`Puppet::render`]）。
    pub move_x: f64,
    pub move_y: f64,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            angle_x: 0.0,
            angle_y: 0.0,
            angle_z: 0.0,
            eye_l_open: 1.0,
            eye_r_open: 1.0,
            eye_ball_x: 0.0,
            eye_ball_y: 0.0,
            brow_ly: 0.0,
            brow_ry: 0.0,
            mouth_open: 0.0,
            smile: 0.0,
            vowel: 0.0,
            body_x: 0.0,
            body_z: 0.0,
            breath: 0.0,
            move_x: 0.0,
            move_y: 0.0,
        }
    }
}

impl Params {
    /// 参数名（动作轨里的键），顺序即 [`Params::get`] 的序号。
    pub const NAMES: [&'static str; 17] = [
        "angleX",
        "angleY",
        "angleZ",
        "eyeLOpen",
        "eyeROpen",
        "eyeBallX",
        "eyeBallY",
        "browLY",
        "browRY",
        "mouthOpen",
        "smile",
        "vowel",
        "bodyX",
        "bodyZ",
        "breath",
        "moveX",
        "moveY",
    ];
    const RANGES: [(f64, f64); 17] = [
        (-30.0, 30.0),
        (-30.0, 30.0),
        (-30.0, 30.0),
        (0.0, 1.0),
        (0.0, 1.0),
        (-1.0, 1.0),
        (-1.0, 1.0),
        (-1.0, 1.0),
        (-1.0, 1.0),
        (0.0, 1.0),
        (0.0, 1.0),
        (-1.0, 1.0),
        (-10.0, 10.0),
        (-10.0, 10.0),
        (0.0, 1.0),
        (-0.5, 0.5),
        (-0.5, 0.5),
    ];

    pub fn index(name: &str) -> Option<usize> {
        Params::NAMES.iter().position(|n| *n == name)
    }

    pub fn range(i: usize) -> (f64, f64) {
        Params::RANGES[i]
    }

    fn slot(&mut self, i: usize) -> &mut f64 {
        match i {
            0 => &mut self.angle_x,
            1 => &mut self.angle_y,
            2 => &mut self.angle_z,
            3 => &mut self.eye_l_open,
            4 => &mut self.eye_r_open,
            5 => &mut self.eye_ball_x,
            6 => &mut self.eye_ball_y,
            7 => &mut self.brow_ly,
            8 => &mut self.brow_ry,
            9 => &mut self.mouth_open,
            10 => &mut self.smile,
            11 => &mut self.vowel,
            12 => &mut self.body_x,
            13 => &mut self.body_z,
            14 => &mut self.breath,
            15 => &mut self.move_x,
            _ => &mut self.move_y,
        }
    }

    pub fn get(&self, i: usize) -> f64 {
        let mut c = *self;
        *c.slot(i)
    }

    /// 写一个参数，夹在它的范围里；不是有限数时不写。
    pub fn set(&mut self, i: usize, v: f64) {
        if v.is_finite() {
            let (lo, hi) = Params::range(i);
            *self.slot(i) = v.clamp(lo, hi);
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct Spring {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
}

#[derive(Clone, Copy, Debug, Default)]
struct Drive {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    ax: f64,
    ay: f64,
    started: bool,
}

#[derive(Clone, Copy, Debug, Default)]
struct Bust {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    px: f64,
    py: f64,
}

/// LivLiv 把链的状态存在 Float32Array 里：每次写入都舍入到 f32，这里照做，结果才一致。
#[inline]
fn f32r(v: f64) -> f64 {
    v as f32 as f64
}

/// 一条链运行时的状态（LivLiv 的 `ChainRun`）：静止关节、当前与上一步的关节、段长、弧长位置，每个关节离静止的位移
/// 与转角，根的世界位置、速度、平滑后的加速度与根坐标系的转角。
#[derive(Clone, Debug)]
pub(crate) struct ChainRun {
    pub def: ChainDef,
    pub rest: Vec<f64>,
    p: Vec<f64>,
    q: Vec<f64>,
    len: Vec<f64>,
    s: Vec<f64>,
    disp: Vec<f64>,
    beta: Vec<f64>,
    w: [f64; 2],
    v: [f64; 2],
    acc: [f64; 2],
    rho: f64,
    started: bool,
    phase: f64,
    moving: bool,
}

impl ChainRun {
    fn new(def: &ChainDef) -> ChainRun {
        let m = def.points.len();
        let rest: Vec<f64> = def.points.iter().flat_map(|p| [f32r(p[0]), f32r(p[1])]).collect();
        let mut len = vec![0.0; m];
        let mut s = vec![0.0; m];
        for j in 1..m {
            len[j] = f32r((rest[2 * j] - rest[2 * j - 2]).hypot(rest[2 * j + 1] - rest[2 * j - 1]));
            s[j] = f32r(s[j - 1] + len[j]);
        }
        let total = if s[m - 1] == 0.0 { 1.0 } else { s[m - 1] };
        for v in s.iter_mut().skip(1) {
            *v = f32r(*v / total);
        }
        // LivLiv：按码点走，取每个码点的第一个 UTF-16 单元
        let mut h: u32 = 0;
        for ch in def.id.chars() {
            let mut buf = [0u16; 2];
            h = (h * 31 + u32::from(ch.encode_utf16(&mut buf)[0])) % 997;
        }
        ChainRun {
            def: def.clone(),
            p: rest.clone(),
            q: rest.clone(),
            rest,
            len,
            s,
            disp: vec![0.0; 2 * m],
            beta: vec![0.0; m],
            w: [0.0; 2],
            v: [0.0; 2],
            acc: [0.0; 2],
            rho: 0.0,
            started: false,
            phase: f64::from(h) / 997.0 * 2.0 * std::f64::consts::PI,
            moving: false,
        }
    }

    fn reset(&mut self) {
        self.p.clone_from(&self.rest);
        self.q.clone_from(&self.rest);
        self.disp.fill(0.0);
        self.beta.fill(0.0);
        self.started = false;
        self.moving = false;
    }
}

/// 一层：定义、网格、这一帧形变后的顶点（模型像素），以及它的贴图。
pub(crate) struct Layer {
    pub def: LayerDef,
    pub mesh: Mesh,
    pub out: Vec<f32>,
    /// 表情画的眉毛（brow_tex）按刘海走时的顶点。
    pub out_b: Option<Vec<f32>>,
    /// 带遮罩的表情眼睛（`expr_eye_L` `expr_eye_R`）不往下合的顶点：它的眼白与眼珠按这一套画，由往下合的遮罩裁。
    pub out_open: Option<Vec<f32>>,
    pub tex: Arc<Texture>,
    pub frames: Vec<Arc<Texture>>,
    pub mask: Option<Arc<Texture>>,
    pub talk: Option<Arc<Texture>>,
    pub brow_tex: Option<Arc<Texture>>,
    /// 眼珠离开眼白多少（模型像素，最多 1）：0 时按眼白 alpha 0.5 一刀切，往上换成软遮罩。
    pub soft: f64,
    /// 这一帧要画（deform 只移动要画的层）。
    pub shown: bool,
}

/// 头的转动在这一帧的正弦余弦（每个顶点都一样，一帧算一次）。
#[derive(Clone, Copy, Debug)]
struct HeadPose {
    cy: f64,
    sy: f64,
    cp: f64,
    sp: f64,
    cr: f64,
    sr: f64,
}

/// 嘴的形状：按元音换的圆嘴、扁嘴。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Shape {
    None,
    Round,
    Wide,
}

/// 圆嘴、扁嘴与说话时闭嘴的帧序号（模型有的话）。
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Vis {
    pub round: Option<usize>,
    pub wide: Option<usize>,
    pub shut: Option<usize>,
}

/// 一个装好的角色：网格、权重与跨帧的物理状态。
pub struct Puppet {
    pub(crate) model: Model,
    pub(crate) rig: Rig,
    pub(crate) tuning: Tuning,
    pub(crate) layers: Vec<Layer>,
    pub(crate) by_id: HashMap<String, usize>,
    /// 这一步的参数。
    pub params: Params,
    /// smile 之外的表情的权重，按表情 id。
    pub expr: BTreeMap<String, f64>,
    /// 物理的强度（0：头发、身体弹簧不动，对比静态姿势用）。
    pub physics_scale: f64,
    springs: [[Spring; 2]; 3],
    last_head: Option<[f64; 2]>,
    drive: Drive,
    body: [f64; 2],
    bust: Bust,
    pub(crate) time: f64,
    pub(crate) smile_shown: f64,
    pub(crate) mouth_frame: usize,
    mouth_w: Vec<f64>,
    mouth_held: f64,
    mouth_amp: u8,
    mouth_shape: Shape,
    pub(crate) vis: Vis,
    pub(crate) frame_kind: Vec<String>,
    frame_jaw: Vec<f64>,
    pub(crate) talk_left: f64,
    chains: Vec<ChainRun>,
    nasal: [Option<Nasal>; 2],
}

/// 跨步的全部状态（物理、缓动、嘴、参数）：存一份就能从这一步接着走，往回 seek 不必从头重放。
#[derive(Clone)]
pub(crate) struct State {
    params: Params,
    expr: BTreeMap<String, f64>,
    springs: [[Spring; 2]; 3],
    last_head: Option<[f64; 2]>,
    drive: Drive,
    body: [f64; 2],
    bust: Bust,
    time: f64,
    smile_shown: f64,
    mouth_frame: usize,
    mouth_w: Vec<f64>,
    mouth_held: f64,
    mouth_amp: u8,
    mouth_shape: Shape,
    talk_left: f64,
    chains: Vec<ChainState>,
}

/// 一条链跨步的状态（静止关节、段长这些不变的不存）。
#[derive(Clone)]
struct ChainState {
    p: Vec<f64>,
    q: Vec<f64>,
    disp: Vec<f64>,
    beta: Vec<f64>,
    w: [f64; 2],
    v: [f64; 2],
    acc: [f64; 2],
    rho: f64,
    started: bool,
    moving: bool,
}

const FRONT: usize = 0;
const BACK: usize = 1;
const SIDE: usize = 2;

/// 眨眼时眼白这一层的一点（静止 y）：眼白上沿 `t` 以下（眼白与下睫毛）压向 `c`，以上的睫毛跟着上沿整条往下平移，
/// 同时朝它的下边变薄，合上时剩 `thin` 倍；`k` 是合上了多少（0 睁开不动，1 全压到 `c`）。`c` 是闭眼线往下半个
/// （变薄后的）睫毛厚：合上时睫毛的中线落在闭眼线上，和闭眼层的睫毛对齐。
fn lid_slide(y: f64, t: f64, thin: f64, c: f64, k: f64) -> f64 {
    if y <= t {
        t + k * (c - t) - (t - y) * (1.0 - k * (1.0 - thin))
    } else {
        c + (y - c) * (1.0 - k)
    }
}

fn side_of(role: &str) -> Option<usize> {
    if role.ends_with("_L") {
        Some(0)
    } else if role.ends_with("_R") {
        Some(1)
    } else {
        None
    }
}

impl Puppet {
    /// 由读好的角色包建网格与权重。
    pub fn new(pkg: &Package) -> Result<Puppet, Error> {
        let model = pkg.model.clone();
        let rig = Rig::from_def(model.rig.as_ref());
        let tuning = Tuning::from_def(model.tuning.as_ref());
        let chains: Vec<ChainRun> = rig.chains.iter().map(ChainRun::new).collect();
        let tex = |path: &str| -> Result<Arc<Texture>, Error> {
            pkg.textures
                .get(path)
                .cloned()
                .ok_or_else(|| Error::new(ErrorKind::MissingFile, format!("the package has no \"{path}\"")))
        };
        let mouth = model.layers.iter().find(|l| l.role() == "mouth");
        let n_frames = mouth.and_then(|m| m.frames.as_ref()).map_or(3, Vec::len);
        let frame_kind: Vec<String> = (0..n_frames)
            .map(|i| {
                mouth
                    .and_then(|m| m.visemes.as_ref())
                    .and_then(|v| v.get(i))
                    .filter(|s| !s.is_empty())
                    .cloned()
                    .unwrap_or_else(|| ["closed", "half", "open"].get(i).copied().unwrap_or("").to_string())
            })
            .collect();
        let jaw = model.anchors.jaw;
        let mut frame_jaw: Vec<f64> = frame_kind
            .iter()
            .map(|k| match jaw {
                Some(j) if k != "closed" && (k != "half" || j.open > 0.0) => j.drop_of(k),
                _ => 0.0,
            })
            .collect();
        let proc_jaw = rig.jaw.unwrap_or(PROC_JAW);
        if jaw.is_some() && proc_jaw > 0.0 && !frame_jaw.iter().any(|j| *j > 0.0) {
            let fh = model.anchors.face_height();
            frame_jaw = frame_kind
                .iter()
                .map(|k| {
                    let amt = match k.as_str() {
                        "half" => 0.45,
                        "open" => 1.0,
                        "round" => 0.7,
                        "wide" => 0.35,
                        _ => 0.0,
                    };
                    proc_jaw * fh * amt
                })
                .collect();
        }
        let mut vis = Vis::default();
        for (i, k) in frame_kind.iter().enumerate() {
            match k.as_str() {
                "round" => vis.round = Some(i),
                "wide" => vis.wide = Some(i),
                "shut" => vis.shut = Some(i),
                _ => {}
            }
        }
        let ctx = Ctx {
            model: &model,
            rig: &rig,
            jaw_moves: frame_jaw.iter().any(|j| *j > 0.0),
            brow_layer: model.layers.iter().any(|l| l.id == "brows"),
            chains: &chains,
        };
        let bangs_def = model.layers.iter().find(|l| l.group == Group::HairFront);
        let bangs_tex = bangs_def.map(|d| tex(&d.texture)).transpose()?;
        let bangs = bangs_def.zip(bangs_tex.as_deref()).map(|(def, tex)| Bangs { def, tex });
        let mut layers = Vec::with_capacity(model.layers.len());
        for l in &model.layers {
            let main = tex(&l.texture)?;
            let frames: Vec<Arc<Texture>> = l.frames.iter().flatten().map(|p| tex(p)).collect::<Result<_, _>>()?;
            let mask = l.mask.as_deref().map(tex).transpose()?;
            let talk = l.talk.as_deref().map(tex).transpose()?;
            let brow_tex = l.brow_tex.as_deref().map(tex).transpose()?;
            let over_bangs = l.id == "brows" || l.role() == "expr_brows" || l.brow_tex.is_some();
            let frame_refs: Vec<&Texture> = frames.iter().map(|t| t.as_ref()).collect();
            let m = mesh::build(
                &ctx,
                l,
                &main,
                &frame_refs,
                brow_tex.as_deref(),
                if over_bangs { bangs.as_ref() } else { None },
            );
            let n = m.rest.len();
            layers.push(Layer {
                out_b: m.fol_b.as_ref().map(|_| vec![0f32; n]),
                out_open: None,
                out: m.rest.clone(),
                mesh: m,
                def: l.clone(),
                tex: main,
                frames,
                mask,
                talk,
                brow_tex,
                soft: 0.0,
                shown: false,
            });
        }
        let by_id: HashMap<String, usize> = layers.iter().enumerate().map(|(i, l)| (l.def.id.clone(), i)).collect();
        // 每只眼珠往鼻子那边的余地：鼻子在两只眼睛中点那边（只有一只眼睛的模型不限）
        let mut nasal = [None, None];
        if let Some(eyes) = model.anchors.eyes.as_ref().filter(|e| e.len() >= 2) {
            let mid = eyes.iter().map(|b| (b[0] + b[2]) / 2.0).sum::<f64>() / eyes.len() as f64;
            for l in &layers {
                let role = l.def.role();
                let Some(side) = role.strip_prefix("iris_").and_then(|s| match s {
                    "L" => Some(0),
                    "R" => Some(1),
                    _ => None,
                }) else {
                    continue;
                };
                let parent = l.def.clip.as_ref().and_then(|c| by_id.get(c)).map(|&j| &layers[j]);
                let (Some(_), Some(p)) = (l.def.range, parent) else { continue };
                let Some(mask) = p.mask.as_deref() else { continue };
                if nasal[side].is_some() {
                    continue;
                }
                let sign = if mid > l.def.x + l.def.w / 2.0 { 1.0 } else { -1.0 };
                nasal[side] = mesh::nasal_room(&l.tex, &l.def, mask, &p.def, sign);
            }
        }
        // 有遮罩的眼白：每个顶点那一列眼白的上沿。眨眼时它以上的睫毛整条往下平移，眼珠不压扁、由合拢的眼白裁。表情
        // 自己的眼睛带遮罩时也一样（遮罩是眼白连同眼珠那一块），眼白与眼珠另按不往下合的一套顶点画
        for l in layers.iter_mut() {
            if !matches!(l.def.role(), "eye_L" | "eye_R" | "expr_eye_L" | "expr_eye_R") || l.def.pivot.is_none() {
                continue;
            }
            let own = l.def.role().starts_with("expr_eye_");
            l.mesh.lid = l.mask.as_deref().and_then(|mask| mesh::upper_lid(mask, &l.tex, &l.def, &l.mesh.rest, own));
            if l.mesh.lid.is_some() && own {
                l.out_open = Some(l.mesh.rest.clone());
            }
        }
        // 闭眼层睫毛的弧线：能用的模型眼睛几层都压向它；别的模型只有往下合的眼白和被它裁的眼珠、高光用它（睫毛滑到
        // 的地方要对上闭眼层的睫毛，压向 pivot 那一行的平线时，两头会和弯的睫毛错开）
        let fits = mesh::lid_curve_fits(&model);
        for s in ["L", "R"] {
            let lid = format!("lid_{s}");
            let Some(li) = layers.iter().position(|l| l.def.role() == lid) else {
                continue;
            };
            let Some(line) = mesh::closed_lash_line(&layers[li].tex, &layers[li].def) else {
                continue;
            };
            let eye = format!("eye_{s}");
            let cut = layers.iter().any(|l| l.def.role() == eye && l.mesh.lid.is_some());
            for l in layers.iter_mut() {
                let r = l.def.role();
                let sliding = r == eye || r == format!("iris_{s}") || r == format!("shine_{s}");
                // 表情自己的眼睛看它自己有没有量出上沿
                let own = r == format!("expr_eye_{s}") && (fits || l.mesh.lid.is_some());
                if !(sliding && (fits || cut)) && !own {
                    continue;
                }
                let n = l.mesh.len();
                l.mesh.piv_y = Some((0..n).map(|k| line.at(f64::from(l.mesh.rest[2 * k])) as f32).collect());
                l.mesh.piv_c = Some(line.at(l.def.x + l.def.w / 2.0));
            }
        }
        let mouth_w = (0..frame_kind.len()).map(|i| if i == 0 { 1.0 } else { 0.0 }).collect();
        Ok(Puppet {
            model,
            rig,
            tuning,
            layers,
            by_id,
            params: Params::default(),
            expr: BTreeMap::new(),
            physics_scale: 1.0,
            springs: [[Spring::default(); 2]; 3],
            last_head: None,
            drive: Drive::default(),
            body: [0.0; 2],
            bust: Bust::default(),
            time: 0.0,
            smile_shown: 0.0,
            mouth_frame: 0,
            mouth_w,
            mouth_held: 1.0,
            mouth_amp: 0,
            mouth_shape: Shape::None,
            vis,
            frame_kind,
            frame_jaw,
            talk_left: 0.0,
            chains,
            nasal,
        })
    }

    pub fn model(&self) -> &Model {
        &self.model
    }

    /// 回到静止：弹簧、身体、嘴、表情的缓动都从头开始。
    pub fn reset(&mut self) {
        for c in &mut self.chains {
            c.reset();
        }
        self.springs = [[Spring::default(); 2]; 3];
        self.last_head = None;
        self.drive = Drive::default();
        self.body = [0.0; 2];
        self.bust = Bust::default();
        self.time = 0.0;
        self.smile_shown = 0.0;
        self.mouth_frame = 0;
        self.mouth_amp = 0;
        self.mouth_shape = Shape::None;
        self.mouth_held = 1.0;
        for (i, w) in self.mouth_w.iter_mut().enumerate() {
            *w = if i == 0 { 1.0 } else { 0.0 };
        }
        self.talk_left = 0.0;
        self.params = Params::default();
        self.expr.clear();
    }

    pub(crate) fn save(&self) -> State {
        State {
            params: self.params,
            expr: self.expr.clone(),
            springs: self.springs,
            last_head: self.last_head,
            drive: self.drive,
            body: self.body,
            bust: self.bust,
            time: self.time,
            smile_shown: self.smile_shown,
            mouth_frame: self.mouth_frame,
            mouth_w: self.mouth_w.clone(),
            mouth_held: self.mouth_held,
            mouth_amp: self.mouth_amp,
            mouth_shape: self.mouth_shape,
            talk_left: self.talk_left,
            chains: self
                .chains
                .iter()
                .map(|c| ChainState {
                    p: c.p.clone(),
                    q: c.q.clone(),
                    disp: c.disp.clone(),
                    beta: c.beta.clone(),
                    w: c.w,
                    v: c.v,
                    acc: c.acc,
                    rho: c.rho,
                    started: c.started,
                    moving: c.moving,
                })
                .collect(),
        }
    }

    pub(crate) fn load(&mut self, s: &State) {
        self.params = s.params;
        self.expr.clone_from(&s.expr);
        self.springs = s.springs;
        self.last_head = s.last_head;
        self.drive = s.drive;
        self.body = s.body;
        self.bust = s.bust;
        self.time = s.time;
        self.smile_shown = s.smile_shown;
        self.mouth_frame = s.mouth_frame;
        self.mouth_w.clone_from(&s.mouth_w);
        self.mouth_held = s.mouth_held;
        self.mouth_amp = s.mouth_amp;
        self.mouth_shape = s.mouth_shape;
        self.talk_left = s.talk_left;
        for (c, cs) in self.chains.iter_mut().zip(&s.chains) {
            c.p.clone_from(&cs.p);
            c.q.clone_from(&cs.q);
            c.disp.clone_from(&cs.disp);
            c.beta.clone_from(&cs.beta);
            c.w = cs.w;
            c.v = cs.v;
            c.acc = cs.acc;
            c.rho = cs.rho;
            c.started = cs.started;
            c.moving = cs.moving;
        }
    }

    /// 设置表情的权重（`smile` 写进参数）。
    pub fn set_expression(&mut self, id: &str, v: f64) {
        let v = if v.is_finite() { v.clamp(0.0, 1.0) } else { 0.0 };
        if id == "smile" {
            self.params.smile = v;
        } else {
            self.expr.insert(id.to_string(), v);
        }
    }

    pub(crate) fn expr_value(&self, id: &str) -> f64 {
        if id == "smile" {
            self.smile_shown
        } else {
            self.expr.get(id).copied().unwrap_or(0.0)
        }
    }

    /// 表情补丁（或它的眉毛）画得多不透明。
    pub(crate) fn expr_alpha(&self, d: &LayerDef) -> f64 {
        smooth(0.3, 0.7, self.expr_value(d.expression_id()))
    }

    /// show / hide 表情决定的不透明度（没有时为 1）。
    pub(crate) fn mood_alpha(&self, d: &LayerDef) -> f64 {
        let sum = |m: &BTreeMap<String, f64>| m.iter().map(|(k, v)| v * self.expr_value(k)).sum::<f64>().min(1.0);
        d.show.as_ref().map_or(1.0, sum) * d.hide.as_ref().map_or(1.0, |m| 1.0 - sum(m))
    }

    pub(crate) fn blush_alpha(&self, d: &LayerDef) -> f64 {
        d.blush.iter().flatten().map(|(k, v)| v * self.expr_value(k)).sum()
    }

    fn eye_open(&self, side: Option<usize>) -> f64 {
        match side {
            Some(0) => self.params.eye_l_open,
            Some(1) => self.params.eye_r_open,
            _ => 1.0,
        }
    }

    /// 这一帧会不会画这一层（deform 跳过其余的）。
    fn shown(&self, d: &LayerDef) -> bool {
        let role = d.role();
        if matches!(role, "hole" | "edge" | "edge_wide") {
            return false;
        }
        if (d.show.is_some() || d.hide.is_some()) && self.mood_alpha(d) <= 0.01 {
            return false;
        }
        if role == "expr" || role == "expr_brows" {
            return self.expr_alpha(d) > 0.01;
        }
        if role.starts_with("expr_eye_") {
            return self.expr_alpha(d) > 0.01 && self.eye_open(side_of(role)) >= EYE_SHUT;
        }
        if role.starts_with("lid_") {
            return 1.0 - smooth(0.05, 0.35, self.eye_open(side_of(role))) > 0.01;
        }
        if role == "blush" {
            return self.blush_alpha(d) > 0.01;
        }
        true
    }

    // ------------------------------------------------------------ 姿势

    fn head_pose(&self) -> HeadPose {
        let p = &self.params;
        let r = &self.rig;
        let (tt, nd, pe) = (self.tuning.turn, self.tuning.nod, r.pitch_ease);
        // 上下点头越靠近两端越收（满幅少转 25%），小幅不变
        let py = p.angle_y / 30.0;
        let yaw = (p.angle_x / 30.0) * r.yaw * tt;
        let pitch = py * (1.0 - pe * py * py) * r.pitch * tt * nd;
        let roll = p.angle_z.to_radians_js() * r.roll * tt;
        HeadPose {
            cy: yaw.cos(),
            sy: yaw.sin(),
            cp: pitch.cos(),
            sp: pitch.sin(),
            cr: roll.cos(),
            sr: roll.sin(),
        }
    }

    fn head_xform(&self, hp: &HeadPose, x: f64, y: f64, depth: f64) -> [f64; 2] {
        let a = &self.model.anchors;
        let h = a.head;
        let u = (x - h.cx) / h.rx;
        let v = (y - h.cy) / h.ry;
        let r = &self.rig;
        let q = r.bulge_shape;
        let (bu, bv) = match r.bulge_extent.as_deref() {
            Some(e) => {
                let mut ex = e[0];
                if e.len() > 3 && v > 0.0 {
                    let t = (v / (e[2] * e.get(4).copied().unwrap_or(1.0))).min(1.0);
                    ex += (e[3] - e[0]) * t * t * (3.0 - 2.0 * t);
                }
                (u / ex, v / if v < 0.0 { e[1] } else { e[2] })
            }
            None => (u, v),
        };
        let shape = if q == 1.0 {
            1.0 - bu * bu - bv * bv
        } else {
            1.0 - (bu * bu + bv * bv).powf(q)
        };
        let bulge = r.bulge * shape.max(0.0);
        let z = bulge + depth;
        let mut u2 = u * hp.cy + z * hp.sy;
        let z2 = -u * hp.sy + z * hp.cy;
        let mut v2 = v * hp.cp - z2 * hp.sp;
        // 整个头朝转向稍微挪一点
        u2 += r.drift[0] * hp.sy;
        v2 -= r.drift[1] * hp.sp;
        let mut px = h.cx + u2 * h.rx;
        let mut py = h.cy + v2 * h.ry;
        let (nx, ny) = (h.cx, a.neck_y);
        let (dx, dy) = (px - nx, py - ny);
        px = nx + dx * hp.cr - dy * hp.sr;
        py = ny + dx * hp.sr + dy * hp.cr;
        [px, py]
    }

    /// (x, y) 处身体的刚体运动：呼吸、跟着转、侧倾；`bust` 时加上胸部的弹簧。
    fn body_offset(&self, x: f64, y: f64, bust: bool) -> [f64; 2] {
        let a = &self.model.anchors;
        let h = a.head;
        let p = &self.params;
        let t = smooth(a.bottom_y, a.neck_y, y);
        let fw = a.face_width();
        let br = p.breath * self.tuning.breath * self.rig.breath * self.rig.body_breath;
        // 呼吸：肩膀抬起，胸口稍宽
        let mut dx = (x - h.cx) * 0.01 * br * t;
        let mut dy = -br * 0.024 * h.ry * t.powf(1.3);
        // 跟着转：上身往转向滑，远的一侧收窄（看起来像转）
        let yaw = self.body[0] / 30.0;
        let bw = 1.4 * fw;
        let u = ((x - h.cx) / bw).clamp(-1.6, 1.6);
        dx += yaw * bw * 0.16 * t.powf(1.2) * (1.0 - 0.18 * u * u) + yaw * (x - h.cx) * -0.04 * js_sign(u) * t;
        // 侧倾：上身绕胯下的一点转
        let ang = self.body[1].to_radians_js() * t;
        if ang != 0.0 {
            let (px, py) = (h.cx, a.bottom_y + 0.4 * (a.bottom_y - a.neck_y));
            let (rx, ry) = (x - px, y - py);
            let (c, s) = (ang.cos(), ang.sin());
            dx += rx * (c - 1.0) - ry * s;
            dy += rx * s + ry * (c - 1.0);
        }
        if let (Some(c), true) = (a.chest, bust) {
            let ux = (x - c.cx) / c.rx;
            let uy = (y - c.cy) / c.ry;
            let d = (ux * ux + uy * uy).sqrt();
            let w = 1.0 - smooth(0.2, 1.15, d);
            if w > 0.0 {
                dy -= br * 0.012 * h.ry * w * (0.4 + self.rig.bust);
                dx += self.bust.x * w;
                dy += self.bust.y * w;
            }
        }
        [dx, dy]
    }

    /// 链的根在世界里的位置与根坐标系的转角：[x, y, rho]。
    fn chain_root(&self, hp: &HeadPose, def: &ChainDef, nb: [f64; 2]) -> [f64; 3] {
        let [rx, ry] = def.points[0];
        let a = &self.model.anchors;
        if def.attach.as_deref() == Some("body") {
            let b = self.body_offset(rx, ry, true);
            [
                rx + b[0],
                ry + b[1],
                self.body[1].to_radians_js() * smooth(a.bottom_y, a.neck_y, ry),
            ]
        } else {
            let h = self.head_xform(hp, rx, ry, def.depth.unwrap_or(0.0));
            [
                h[0] + nb[0],
                h[1] + nb[1],
                self.params.angle_z.to_radians_js() * self.rig.roll * self.tuning.turn,
            ]
        }
    }

    // ------------------------------------------------------------ 一步

    /// 往前走 `dt` 秒：表情缓动、嘴、物理；`mesh` 时再形变网格（只有要画的那一步需要）。
    pub fn update(&mut self, dt: f64, mesh: bool) {
        self.time += dt;
        self.smile_shown += (self.params.smile - self.smile_shown) * (dt * 7.0).min(1.0);
        self.step_mouth(dt);
        for i in 0..3 {
            let v = self.params.get(i);
            self.params.set(i, v);
        }
        let steps = ((dt / TICK).ceil() as usize).max(1);
        let h = dt / steps as f64;
        for _ in 0..steps {
            self.step_body(h);
            self.step_physics(h);
            self.step_chains(h);
        }
        if mesh {
            self.deform();
        }
    }

    fn step_body(&mut self, dt: f64) {
        let p = self.params;
        let tt = self.tuning.turn;
        let ty = p.body_x + p.angle_x * self.rig.body_yaw * tt;
        let tr = p.body_z + p.angle_z * self.rig.body_roll * tt;
        let k = (dt * 5.0).min(1.0);
        self.body[0] += (ty - self.body[0]) * k;
        self.body[1] += (tr - self.body[1]) * k;
        let Some(c) = self.model.anchors.chest.filter(|_| self.rig.bust > 0.0) else {
            self.bust.x = 0.0;
            self.bust.y = 0.0;
            return;
        };
        let o = self.body_offset(c.cx, c.cy, false);
        let inv = 1.0 / dt.max(1e-4);
        let ax = (o[0] - self.bust.px) * inv;
        let ay = (o[1] - self.bust.py) * inv;
        let b = &mut self.bust;
        b.px = o[0];
        b.py = o[1];
        let s = self.rig.bust * self.physics_scale;
        const K: f64 = 70.0;
        const D: f64 = 7.0;
        b.vx += (-K * b.x - D * b.vx - ax * 3.2 * s) * dt;
        b.vy += (-K * b.y - D * b.vy - ay * 4.2 * s) * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        let lim = 0.035 * self.model.anchors.head.ry * (0.5 + s);
        b.x = b.x.clamp(-lim, lim);
        b.y = b.y.clamp(-lim, lim);
    }

    fn step_mouth(&mut self, dt: f64) {
        let m = self.params.mouth_open.clamp(0.0, 1.0);
        let v = self.params.vowel.clamp(-1.0, 1.0);
        let [t1, t2] = MOUTH_AT;
        let h = MOUTH_HYST;
        self.mouth_held += dt;
        // 响度：闭、半张、张开，每次从显示的那一档走
        let mut a = self.mouth_amp;
        if a == 0 && m > t1 + h {
            a = if m > t2 + h { 2 } else { 1 };
        } else if a == 1 && (m < t1 - h || m > t2 + h) {
            a = if m < t1 - h { 0 } else { 2 };
        } else if a == 2 && m < t2 - h {
            a = if m < t1 - h { 0 } else { 1 };
        }
        // 元音：张着的嘴在提示越过 VOWEL_IN 时换圆嘴 / 扁嘴；没有这两帧的模型照旧用三帧
        let mut s = self.mouth_shape;
        let leave = match s {
            Shape::None => true,
            Shape::Round => v > -VOWEL_OUT,
            Shape::Wide => v < VOWEL_OUT,
        };
        if leave {
            s = if v < -VOWEL_IN {
                Shape::Round
            } else if v > VOWEL_IN {
                Shape::Wide
            } else {
                Shape::None
            };
        }
        let shaped = match s {
            Shape::Round => self.vis.round,
            Shape::Wide => self.vis.wide,
            Shape::None => None,
        };
        let mut want = match shaped {
            Some(i) if a > 0 => i,
            _ => usize::from(a),
        };
        // 画的就是张着嘴的图（露牙的笑）：静止时保持第 0 帧，说话时音节之间闭上
        if want == 0
            && self.talk_left > 0.0
            && let Some(shut) = self.vis.shut
        {
            want = shut;
        }
        if want >= self.mouth_w.len() {
            want = 0;
        }
        if want == self.mouth_frame {
            self.mouth_amp = a;
            self.mouth_shape = s;
        } else if self.mouth_held >= MOUTH_HOLD {
            self.mouth_frame = want;
            self.mouth_amp = a;
            self.mouth_shape = s;
            self.mouth_held = 0.0;
        }
        let f = self.mouth_frame;
        self.talk_left = if f > 0 && Some(f) != self.vis.shut {
            TALK_LATCH
        } else {
            (self.talk_left - dt).max(0.0)
        };
        let k = (dt * 28.0).min(1.0);
        for (i, w) in self.mouth_w.iter_mut().enumerate() {
            *w += (if i == f { 1.0 } else { 0.0 } - *w) * k;
        }
    }

    /// 第 `i` 帧随 mouthOpen 走到哪儿（一帧之内开口还会再动一点）。
    pub(crate) fn frame_ease(&self, i: usize, m: f64) -> f64 {
        let [t1, t2] = MOUTH_AT;
        match self.frame_kind.get(i).map(String::as_str) {
            Some("half") => smooth(t1, t2, m),
            Some("open") => smooth(t2, 1.0, m),
            _ => smooth(t1, 1.0, m),
        }
    }

    fn step_physics(&mut self, dt: f64) {
        let p = self.params;
        let a = &self.model.anchors;
        let hp = self.head_pose();
        let ht = self.head_xform(&hp, a.head.cx, a.hair_root_y, 0.0);
        let inv = 1.0 / dt.max(1e-4);
        // 第一步没有上一步：从这里起算，开头不会甩一下
        let last = self.last_head.unwrap_or(ht);
        let vx = (ht[0] - last[0]) * inv;
        let vy = (ht[1] - last[1]) * inv;
        self.last_head = Some(ht);
        let drive = self.rig.hair_drive;
        if drive.is_some() {
            // 枢轴的加速度，低通（约 40 ms），跟踪到的抖动不晃头发
            let fp = self.head_xform(&hp, a.head.cx, a.head.cy, 0.0);
            let dv = &mut self.drive;
            if !dv.started {
                *dv = Drive {
                    x: fp[0],
                    y: fp[1],
                    vx: 0.0,
                    vy: 0.0,
                    ax: 0.0,
                    ay: 0.0,
                    started: true,
                };
            }
            let ks = (dt * 25.0).min(1.0);
            let svx = dv.vx + ((fp[0] - dv.x) * inv - dv.vx) * ks;
            let svy = dv.vy + ((fp[1] - dv.y) * inv - dv.vy) * ks;
            dv.ax += ((svx - dv.vx) * inv - dv.ax) * ks;
            dv.ay += ((svy - dv.vy) * inv - dv.ay) * ks;
            dv.x = fp[0];
            dv.y = fp[1];
            dv.vx = svx;
            dv.vy = svy;
        }
        let r = &self.rig;
        let lim = a.head.ry * r.hair_limit;
        let keys: &[usize] = if r.hair_side.is_some() {
            &[FRONT, BACK, SIDE]
        } else {
            &[FRONT, BACK]
        };
        for &key in keys {
            let [k1, c1, g, k2, c2] = match key {
                FRONT => r.hair_front,
                BACK => r.hair_back,
                _ => r.hair_side.unwrap_or(r.hair_front),
            };
            let s = self.physics_scale
                * if key == BACK {
                    self.tuning.hair_back
                } else {
                    self.tuning.hair_front
                };
            let wind = if key == SIDE {
                (self.time * 1.5 + 0.7).sin() * 1.2 * s * r.wind
            } else {
                let (rate, amp) = if key == FRONT { (1.9, 0.6) } else { (1.15, 1.8) };
                (self.time * rate).sin() * amp * s * r.wind
            };
            let gravity = -p.angle_z * 0.2 * s;
            let [mut sa, mut sb] = self.springs[key];
            let mut ax = -k1 * (sa.x - wind - gravity) - c1 * sa.vx - vx * g * k1 * 0.06 * s;
            let mut ay = -k1 * sa.y - c1 * sa.vy - vy * g * k1 * 0.04 * s;
            if let Some(d) = drive {
                let m = d[key] * s;
                ax -= self.drive.ax * m;
                ay -= self.drive.ay * m;
            }
            sa.vx += ax * dt;
            sa.vy += ay * dt;
            sa.x += sa.vx * dt;
            sa.y += sa.vy * dt;
            let bx = -k2 * (sb.x - sa.x * 1.6) - c2 * sb.vx;
            let by = -k2 * (sb.y - sa.y * 1.4) - c2 * sb.vy;
            sb.vx += bx * dt;
            sb.vy += by * dt;
            sb.x += sb.vx * dt;
            sb.y += sb.vy * dt;
            for q in [&mut sa, &mut sb] {
                q.x = q.x.clamp(-lim, lim);
                q.y = q.y.clamp(-lim * 0.6, lim * 0.6);
            }
            self.springs[key] = [sa, sb];
        }
    }

    /// 每条链走一步：verlet 绳子被拉向它画出来的形状（侧倾时按 hang 反转、表情弯、风吹），被根的加速度甩，段长不变。
    fn step_chains(&mut self, dt: f64) {
        if self.chains.is_empty() || dt <= 0.0 {
            return;
        }
        let a = &self.model.anchors;
        let hp = self.head_pose();
        let nb = self.body_offset(a.head.cx, a.neck_y, true);
        let g = self.physics_scale * self.tuning.hair_back;
        let mut chains = std::mem::take(&mut self.chains);
        for c in &mut chains {
            let d = &c.def;
            let m = c.rest.len() / 2;
            let r = self.chain_root(&hp, d, nb);
            if !c.started {
                c.w = [r[0], r[1]];
                c.v = [0.0, 0.0];
                c.acc = [0.0, 0.0];
                c.started = true;
            }
            let vx = (r[0] - c.w[0]) / dt;
            let vy = (r[1] - c.w[1]) / dt;
            let ax = (vx - c.v[0]) / dt;
            let ay = (vy - c.v[1]) / dt;
            c.w = [r[0], r[1]];
            c.v = [vx, vy];
            c.rho = r[2];
            let ks = (dt * 30.0).min(1.0);
            c.acc[0] += (ax - c.acc[0]) * ks;
            c.acc[1] += (ay - c.acc[1]) * ks;
            let (cr, sr) = ((-c.rho).cos(), (-c.rho).sin());
            let lax = c.acc[0] * cr - c.acc[1] * sr;
            let lay = c.acc[0] * sr + c.acc[1] * cr;
            let bias: f64 = d.bias.iter().flatten().map(|(k, v)| v * self.expr_value(k)).sum();
            let turn = -c.rho * d.hang + bias.to_radians_js();
            let (ct, st) = (turn.cos(), turn.sin());
            let f = d.freq.unwrap_or(0.5);
            let wt = 2.0 * std::f64::consts::PI * f * self.time + c.phase;
            let wind = d.wind * g * self.rig.wind * (wt.sin() + 0.4 * (1.7 * wt + 2.0 * c.phase).sin());
            let damp = (1.0 - d.damp * dt).max(0.0);
            let (rx0, ry0) = (c.rest[0], c.rest[1]);
            for j in 1..m {
                let s = c.s[j];
                let k = d.k[0] + (d.k[1] - d.k[0]) * s;
                let tx = c.rest[2 * j] - rx0;
                let ty = c.rest[2 * j + 1] - ry0;
                let gx = rx0 + tx * ct - ty * st + wind * s;
                let gy = ry0 + tx * st + ty * ct;
                let fx = k * (gx - c.p[2 * j]) - d.drive * g * lax;
                let fy = k * (gy - c.p[2 * j + 1]) - d.drive * g * lay;
                let nx = c.p[2 * j] + (c.p[2 * j] - c.q[2 * j]) * damp + fx * dt * dt;
                let ny = c.p[2 * j + 1] + (c.p[2 * j + 1] - c.q[2 * j + 1]) * damp + fy * dt * dt;
                c.q[2 * j] = c.p[2 * j];
                c.q[2 * j + 1] = c.p[2 * j + 1];
                c.p[2 * j] = f32r(nx);
                c.p[2 * j + 1] = f32r(ny);
            }
            // 段长不变、根钉住；关节离静止不超过 limit
            let lim = d.limit.unwrap_or(f64::INFINITY);
            for j in 1..m {
                let dx = c.p[2 * j] - c.p[2 * j - 2];
                let dy = c.p[2 * j + 1] - c.p[2 * j - 1];
                let l = {
                    let l = dx.hypot(dy);
                    if l == 0.0 { 1.0 } else { l }
                };
                c.p[2 * j] = f32r(c.p[2 * j - 2] + (dx / l) * c.len[j]);
                c.p[2 * j + 1] = f32r(c.p[2 * j - 1] + (dy / l) * c.len[j]);
                let ex = c.p[2 * j] - c.rest[2 * j];
                let ey = c.p[2 * j + 1] - c.rest[2 * j + 1];
                let e = ex.hypot(ey);
                if e > lim {
                    c.p[2 * j] = f32r(c.rest[2 * j] + (ex * lim) / e);
                    c.p[2 * j + 1] = f32r(c.rest[2 * j + 1] + (ey * lim) / e);
                }
            }
            let mut mv = 0.0f64;
            for j in 0..m {
                c.disp[2 * j] = f32r(c.p[2 * j] - c.rest[2 * j]);
                c.disp[2 * j + 1] = f32r(c.p[2 * j + 1] - c.rest[2 * j + 1]);
                mv = mv.max(c.disp[2 * j].abs()).max(c.disp[2 * j + 1].abs());
            }
            c.moving = mv > 1e-3;
            // 每段转了多少，再按关节平均；根关节不转（根周围的东西不动，不会撕开）
            let al: Vec<f64> = (0..m - 1)
                .map(|k| {
                    let rx = c.rest[2 * k + 2] - c.rest[2 * k];
                    let ry = c.rest[2 * k + 3] - c.rest[2 * k + 1];
                    let cx = c.p[2 * k + 2] - c.p[2 * k];
                    let cy = c.p[2 * k + 3] - c.p[2 * k + 1];
                    (rx * cy - ry * cx).atan2(rx * cx + ry * cy)
                })
                .collect();
            c.beta[0] = 0.0;
            for j in 1..m - 1 {
                c.beta[j] = f32r(0.5 * (al[j - 1] + al[j]));
            }
            c.beta[m - 1] = f32r(al[m - 2]);
        }
        self.chains = chains;
    }

    /// 一个顶点被链弯出的偏移（世界像素）。
    fn skin_offset(&self, s: &mesh::Skin, i: usize) -> [f64; 2] {
        if s.sum[i] < 1e-4 {
            return [0.0, 0.0];
        }
        let (mut ox, mut oy) = (0.0, 0.0);
        for b in 0..s.b {
            let j = i * s.b + b;
            let c = &self.chains[s.c[j]];
            let k = s.seg[j];
            if !c.moving {
                continue;
            }
            // 根之前绳子没动；尖之后按最后一段走
            let sj = f64::from(s.t[j]);
            let t = sj.clamp(0.0, 1.0);
            let e = if sj < 0.0 { 0.0 } else { 1.0 };
            let dx = (c.disp[2 * k] + (c.disp[2 * k + 2] - c.disp[2 * k]) * t) * e;
            let dy = (c.disp[2 * k + 1] + (c.disp[2 * k + 3] - c.disp[2 * k + 1]) * t) * e;
            let be = (c.beta[k] + (c.beta[k + 1] - c.beta[k]) * t) * e;
            let (cb, sb) = (be.cos(), be.sin());
            let (ux, uy) = (f64::from(s.ux[j]), f64::from(s.uy[j]));
            let lx = dx + ux * cb - uy * sb - ux;
            let ly = dy + ux * sb + uy * cb - uy;
            let (cr, sr) = (c.rho.cos(), c.rho.sin());
            let w = f64::from(s.w[j]);
            ox += w * (lx * cr - ly * sr);
            oy += w * (lx * sr + ly * cr);
        }
        [ox, oy]
    }

    /// 眉毛最多能动多远（模型像素）再动网格就会折叠；两侧取小的。
    fn brow_limits(&self, amp: f64) -> [f64; 2] {
        let a = &self.model.anchors;
        let (mut up, mut down, mut any) = (amp, amp, false);
        for (side, b) in a.brows.iter().flatten().enumerate() {
            let line = a.brow_lines.as_ref().and_then(|v| v.get(side)).and_then(|v| v.as_ref());
            let (Some(b), Some(line)) = (b, line) else { continue };
            any = true;
            up = up.min(0.6 * mesh::brow_up(b));
            for (k, &x) in line.x.iter().enumerate() {
                let (Some(lid), Some(bot)) = (line.lid.get(k), line.bottom.get(k)) else {
                    continue;
                };
                down = down.min((0.6 * (lid - bot)) / mesh::brow_wx(b, x).max(1e-3));
            }
        }
        if any { [up, down] } else { [0.0, 0.0] }
    }

    /// 头、身体与头发弹簧把 (x, y) 处、带这些权重的点放到哪儿。
    #[allow(clippy::too_many_arguments)]
    fn place(&self, hp: &HeadPose, neck_body: [f64; 2], x: f64, y: f64, wh: f64, dep: f64, w1: f64, w2: f64, f: f64) -> [f64; 2] {
        let a = &self.model.anchors;
        // 只跟头走的点不受身体影响
        let bp = if wh < 1.0 { self.body_offset(x, y, true) } else { [0.0, 0.0] };
        let mut px = x + bp[0];
        let mut py = y + bp[1];
        if wh > 0.0 {
            let h = self.head_xform(hp, x, y, dep);
            px = px * (1.0 - wh) + (h[0] + neck_body[0]) * wh;
            py = py * (1.0 - wh) + (h[1] + neck_body[1]) * wh;
        }
        if w1 > 0.0 || w2 > 0.0 {
            let [fr, bk, sd] = &self.springs;
            if self.rig.hair_side.is_some() {
                // 侧发弹簧按离头中线多远接过头这一高度的那份（f）
                let s = smooth(SIDE_AT[0], SIDE_AT[1], (x - a.head.cx).abs() / a.head.rx);
                let (ff, fs) = (f * (1.0 - s), f * s);
                let c0x = fr[0].x * ff + sd[0].x * fs + bk[0].x * (1.0 - f);
                let c0y = fr[0].y * ff + sd[0].y * fs + bk[0].y * (1.0 - f);
                let c1x = fr[1].x * ff + sd[1].x * fs + bk[1].x * (1.0 - f);
                let c1y = fr[1].y * ff + sd[1].y * fs + bk[1].y * (1.0 - f);
                px += c0x * w1 + c1x * w2;
                py += c0y * w1 + c1y * w2;
            } else {
                let c0x = fr[0].x * f + bk[0].x * (1.0 - f);
                let c0y = fr[0].y * f + bk[0].y * (1.0 - f);
                let c1x = fr[1].x * f + bk[1].x * (1.0 - f);
                let c1y = fr[1].y * f + bk[1].y * (1.0 - f);
                px += c0x * w1 + c1x * w2;
                py += c0y * w1 + c1y * w2;
            }
        }
        [px, py]
    }

    /// 按当前参数、弹簧与身体，算每个要画的层的顶点。
    fn deform(&mut self) {
        let p = self.params;
        let a = &self.model.anchors;
        let hp = self.head_pose();
        let neck_body = self.body_offset(a.head.cx, a.neck_y, true);
        let [lift_up, lift_down] = self.brow_limits(a.head.ry * self.rig.brow);
        let lift = |v: f64| if v > 0.0 { v.min(1.0) * lift_up } else { v.max(-1.0) * lift_down };
        let brow_lift = [lift(p.brow_ly), lift(p.brow_ry)];
        // 下巴跟着显示的嘴帧（每帧画的时候下巴下移不同），随 mouthOpen 再多张一点
        let mo = p.mouth_open.clamp(0.0, 1.0);
        let mut jaw_drop = 0.0;
        for (i, &w) in self.mouth_w.iter().enumerate() {
            if w > 0.0 && self.frame_jaw[i] > 0.0 {
                let half = self.frame_kind[i] == "half";
                let ease = if half {
                    0.6 + 0.4 * self.frame_ease(i, mo)
                } else {
                    0.75 + 0.25 * self.frame_ease(i, mo)
                };
                jaw_drop += w * self.frame_jaw[i] * ease;
            }
        }
        let roll = p.angle_z.to_radians_js() * self.rig.roll * self.tuning.turn;
        let gz = self.tuning.gaze;
        // rig.neck：下巴比身体单独放的地方往旁边偏多少
        let chin_dx = if self.rig.neck.is_some() {
            let cy = a.jaw.map_or(a.neck_y, |j| j.chin);
            let h = self.head_xform(&hp, a.head.cx, cy, 0.0);
            let b = self.body_offset(a.head.cx, cy, true);
            h[0] + neck_body[0] - (a.head.cx + b[0])
        } else {
            0.0
        };
        let chained = !self.chains.is_empty();
        let time = self.time;
        let mut layers = std::mem::take(&mut self.layers);
        // 每一边：眼白量出了上沿（眼珠、高光由它裁），眼珠的中心高度（高光跟眼珠一起下移）
        let mut cut = [false; 2];
        let mut iris_mid = [None; 2];
        for l in &layers {
            let role = l.def.role();
            let Some(s) = side_of(role) else { continue };
            if role.starts_with("eye_") && l.mesh.lid.is_some() {
                cut[s] = true;
            }
            if role.starts_with("iris_") {
                iris_mid[s] = Some(l.def.y + l.def.h / 2.0);
            }
        }
        for l in &mut layers {
            l.shown = self.shown(&l.def);
            if !l.shown {
                continue;
            }
            let d = &l.def;
            let m = &l.mesh;
            let r = &m.rest;
            let n = m.len();
            let role = d.role();
            let side = side_of(role);
            let is_eye = role.starts_with("eye_") || role.starts_with("iris_") || role.starts_with("shine_") || role.starts_with("expr_eye_");
            let open = self.eye_open(side);
            let squash = 0.12 + 0.88 * open;
            let iris = role.starts_with("iris_");
            // 眼白量出了上沿：眼珠、高光不压扁，由合拢的眼白裁（眼白的上沿就是往下合的眼皮）。眼白在睁开 EYE_SHUT
            // 时正好合成一条线，接着换成闭眼层
            let lid_cut = (iris || role.starts_with("shine_")) && side.is_some_and(|s| cut[s]);
            let shut = ((1.0 - open) / (1.0 - EYE_SHUT)).clamp(0.0, 1.0);
            let (mut ix, mut iy) = (0.0, 0.0);
            if let Some(rg) = d.range
                && (iris || (chained && role.starts_with("shine_")))
            {
                // 有链的模型高光也跟着视线
                ix = p.eye_ball_x * rg[0] * gz;
                iy = -p.eye_ball_y * rg[1] * gz;
            }
            // 往鼻子那边看：过了余地内侧边停住，外侧边继续走（顶点的位移是 nx + nk * 静止 x）
            let (mut nx, mut nk) = (ix, 0.0);
            if ix != 0.0
                && let Some(nz) = side.and_then(|s| self.nasal[s])
                && ix * nz.sign > nz.room
            {
                let far = (ix * nz.sign).min(nz.room + (1.0 - IRIS_NASAL_NARROW) * nz.w);
                nk = -(far - nz.room) / nz.w;
                nx = nz.sign * nz.room - nk * nz.inner;
            }
            // 有视线行程的眼珠：随压扁下移一点，只有它眼白压向的那条线以下压扁；以上被合上的眼皮盖住
            let lid_iris = iris && d.pivot.is_some() && d.range.is_some_and(|rg| rg[0] > 0.0 || rg[1] > 0.0);
            if lid_cut && d.pivot.is_some() {
                let py = m.piv_c.unwrap_or_else(|| d.pivot.map_or(0.0, |p| p[1]));
                let mid = side.and_then(|s| iris_mid[s]).unwrap_or(d.y + d.h / 2.0);
                iy += IRIS_DROP * shut * (py - mid);
            } else if lid_iris {
                let py = m.piv_c.unwrap_or_else(|| d.pivot.map_or(0.0, |p| p[1]));
                iy += IRIS_DROP * (1.0 - squash) * (py - (d.y + d.h / 2.0));
            }
            let lid_soft = if lid_cut {
                shut * d.h / 2.0
            } else if lid_iris {
                (1.0 - squash) * d.h / 2.0
            } else {
                0.0
            };
            if iris {
                l.soft = (ix.hypot(iy) + lid_soft).min(1.0);
            } else if lid_cut {
                l.soft = lid_soft.min(1.0);
            }
            // 表情自己的眼睛带遮罩：眼白与眼珠那一套顶点不往下合，只像眼珠一样随眼皮下移一点，由往下合的遮罩裁
            let open_drop = if l.out_open.is_some() {
                let py = m.piv_c.unwrap_or_else(|| d.pivot.map_or(0.0, |p| p[1]));
                let mid = side.and_then(|s| iris_mid[s]).unwrap_or(d.y + d.h / 2.0);
                IRIS_DROP * shut * (py - mid)
            } else {
                0.0
            };
            let tw = if chained && role.starts_with("shine_") {
                twinkle(time + if side == Some(1) { 1.3 } else { 0.0 })
            } else {
                1.0
            };
            let (tcx, tcy) = (d.x + d.w / 2.0, d.y + d.h / 2.0);
            let rigid = d.rigid.map(|rg| {
                let h = self.head_xform(&hp, rg[0], rg[1], d.depth);
                (rg, h[0] + neck_body[0], h[1] + neck_body[1])
            });
            let (rc, rs) = (roll.cos(), roll.sin());
            // 形变前的一点放到画面上：这一点自己的位置，按刘海走的眉毛在这一点的位置
            let place_at = |i: usize, x: f64, mut y: f64| -> ([f64; 2], [f64; 2]) {
                if m.brow_side[i] >= 0 {
                    // 眉毛压在不透明的刘海下面时最多动 cap
                    let v = brow_lift[m.brow_side[i] as usize];
                    y -= js_sign(v) * v.abs().min(f64::from(m.brow_cap[i])) * f64::from(m.w_brow[i]);
                }
                if jaw_drop > 0.0 && m.w_jaw[i] > 0.0 {
                    y += jaw_drop * f64::from(m.w_jaw[i]);
                }
                let mut pt = if let Some((rg, gx, gy)) = rigid {
                    let (vx, vy) = (x - rg[0], y - rg[1]);
                    [gx + vx * rc - vy * rs, gy + vx * rs + vy * rc]
                } else {
                    self.place(
                        &hp,
                        neck_body,
                        x,
                        y,
                        f64::from(m.w_head[i]),
                        f64::from(m.dep[i]),
                        f64::from(m.w_phys1[i]),
                        f64::from(m.w_phys2[i]),
                        f64::from(m.w_front[i]),
                    )
                };
                if let Some(s) = &m.skin {
                    let o = self.skin_offset(s, i);
                    pt[0] += o[0];
                    pt[1] += o[1];
                }
                let (mut px, mut py) = (pt[0], pt[1]);
                if let Some(wt) = &m.w_twist
                    && wt[i] > 0.0
                {
                    px += chin_dx * f64::from(wt[i]);
                }
                if let Some(wn) = &m.w_neck
                    && wn[i] > 0.0
                {
                    // 头的侧倾绕脖子转
                    let ang = roll * f64::from(wn[i]);
                    let (c, s) = (ang.cos(), ang.sin());
                    let (cx, cy) = (a.head.cx + neck_body[0], a.neck_y + neck_body[1]);
                    let (dx, dy) = (px - cx, py - cy);
                    px = cx + dx * c - dy * s;
                    py = cy + dx * s + dy * c;
                }
                let c = m.fol.as_ref().map_or(0.0, |v| f64::from(v[i]));
                let cb = m.fol_b.as_ref().map_or(0.0, |v| f64::from(v[i]));
                if (c > 0.0 || cb > 0.0)
                    && let Some(al) = &m.alt
                {
                    // 在刘海上面：按刘海在这一点的动法走，抬的眉毛也一起
                    let k = 5 * i;
                    let (x0, y0) = (px, py);
                    let mut q = self.place(
                        &hp,
                        neck_body,
                        x,
                        y,
                        f64::from(al[k + 1]),
                        f64::from(al[k]),
                        f64::from(al[k + 2]),
                        f64::from(al[k + 3]),
                        f64::from(al[k + 4]),
                    );
                    if let Some(s) = &m.alt_skin {
                        let o = self.skin_offset(s, i);
                        q[0] += o[0];
                        q[1] += o[1];
                    }
                    px += (q[0] - x0) * c;
                    py += (q[1] - y0) * c;
                    return ([px, py], [x0 + (q[0] - x0) * cb, y0 + (q[1] - y0) * cb]);
                }
                ([px, py], [px, py])
            };
            let out = &mut l.out;
            let mut out_b = l.out_b.as_mut();
            let open_set = l.out_open.is_some();
            let mut out_open = l.out_open.as_mut();
            for i in 0..n {
                let (mut x, mut y) = (f64::from(r[2 * i]), f64::from(r[2 * i + 1]));
                if tw != 1.0 {
                    x = tcx + (x - tcx) * tw;
                    y = tcy + (y - tcy) * tw;
                }
                let mut y_open = None;
                if is_eye && let Some(pv) = d.pivot {
                    let py = m.piv_y.as_ref().map_or(pv[1], |v| f64::from(v[i]));
                    x += nx + nk * f64::from(r[2 * i]);
                    y += iy;
                    if let Some(lid) = &m.lid {
                        if open_set {
                            y_open = Some(y + open_drop);
                        }
                        y = lid_slide(y, f64::from(lid.top[i]), f64::from(lid.thin[i]), py + lid.lash, shut);
                    } else if !lid_cut && (!lid_iris || y > py) {
                        y = py + (y - py) * squash;
                    }
                }
                let (pt, b) = place_at(i, x, y);
                if let Some(ob) = out_b.as_mut() {
                    ob[2 * i] = b[0] as f32;
                    ob[2 * i + 1] = b[1] as f32;
                }
                out[2 * i] = pt[0] as f32;
                out[2 * i + 1] = pt[1] as f32;
                if let (Some(oo), Some(yo)) = (out_open.as_mut(), y_open) {
                    let (pt, _) = place_at(i, x, yo);
                    oo[2 * i] = pt[0] as f32;
                    oo[2 * i + 1] = pt[1] as f32;
                }
            }
        }
        self.layers = layers;
    }
}

/// 眼睛高光的缩放：慢慢 3% 的呼吸，大约每 5 秒一次 0.35 秒、最多 12% 的闪。
fn twinkle(t: f64) -> f64 {
    let k = (t / 5.3).floor();
    let u = t - k * 5.3 - ((k * 7919.0).rem_euclid_js(13.0)) / 13.0 * 3.5;
    let spark = if u > 0.0 && u < 0.35 {
        (u / 0.35 * std::f64::consts::PI).sin()
    } else {
        0.0
    };
    1.0 + 0.03 * (t * 2.1).sin() + 0.12 * spark
}

/// JS 的 `Math.sign`（0 是 0）。
#[inline]
fn js_sign(v: f64) -> f64 {
    if v > 0.0 {
        1.0
    } else if v < 0.0 {
        -1.0
    } else {
        0.0
    }
}

trait JsMath {
    /// `v * Math.PI / 180`，与 LivLiv 的运算顺序相同。
    fn to_radians_js(self) -> f64;
    /// JS 的 `%`（结果的符号跟被除数）。
    fn rem_euclid_js(self, m: f64) -> f64;
}

impl JsMath for f64 {
    #[inline]
    fn to_radians_js(self) -> f64 {
        (self * std::f64::consts::PI) / 180.0
    }
    #[inline]
    fn rem_euclid_js(self, m: f64) -> f64 {
        self % m
    }
}
