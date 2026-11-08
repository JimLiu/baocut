//! mesh-avatar 角色：mesh-avatar-studio 的 `.mavatar` 包（zip 根上有 `avatar.json`，条目不压缩）。网格形变、头发与
//! 布料的物理、眨眼与嘴的贴图（sprite）由内置的 `mesh-avatar-core` 做；它自己的待机与口型关掉，参数全部来自动作轨与
//! 待机动作（[`crate::Player`]），和分层角色一样。画法是上游 wgpu 着色器（`mesh-avatar-wgpu/src/avatar.wgsl`）的逐像素
//! 移植，用同一个 CPU 光栅画：脸（画出来的嘴与腮红）、眼珠（被眼睑裁、随视线移）、半闭的眼（眼珠随视线、眼睑不动）
//! 与普通贴图。格式规范 §2.5。

use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::io::Cursor;
use std::sync::{Arc, Mutex};

use mesh_avatar_core::engine::expression::OVERLAY_EXPRESSIONS;
use mesh_avatar_core::engine::random::SeededRandom;
use mesh_avatar_core::format::AvatarPackage;
use mesh_avatar_core::{Avatar, AvatarOptions, DrawLayer, FaceUniforms, Frame as MeshFrame};

use crate::model::{CANVAS_MAX, CANVAS_MIN};
use crate::package::{MAX_TEXELS, Texture};
use crate::raster::{self, Frame, Paint, View};
use crate::{Error, ErrorKind, Params, draw};

/// 表情的权重到这么多才换成它（mesh-avatar 一次只显示一张表情，自己缓动过去）。
const EXPRESSION_AT: f64 = 0.5;

/// 读好的 mesh-avatar 角色包：建好网格、还没走过的角色（新角色从它复制）与预乘、带 mip 的贴图。
pub struct MeshPackage {
    template: Mutex<Avatar>,
    textures: Arc<HashMap<String, Arc<Texture>>>,
    canvas: [u32; 2],
    cut: bool,
}

impl fmt::Debug for MeshPackage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MeshPackage").field("canvas", &self.canvas).field("cut", &self.cut).finish_non_exhaustive()
    }
}

impl MeshPackage {
    /// 从 `.mavatar` 的字节读角色包（按 mesh-avatar-core 的规则：条目不压缩、至多 200 个、每个不超过 64 MB）。
    pub fn from_zip(bytes: &[u8]) -> Result<MeshPackage, Error> {
        let package = AvatarPackage::from_archive(Cursor::new(bytes)).map_err(error)?;
        let canvas = [package.rig.image.width, package.rig.image.height];
        if canvas.iter().any(|&v| !(CANVAS_MIN..=CANVAS_MAX).contains(&v)) {
            return Err(Error::invalid(format!(
                "the image is {}x{}; each side must be {CANVAS_MIN}-{CANVAS_MAX} pixels",
                canvas[0], canvas[1]
            )));
        }
        let texels: u64 = package.textures.values().map(|t| u64::from(t.width) * u64::from(t.height)).sum();
        if texels > MAX_TEXELS {
            return Err(Error::too_large(format!("the textures hold more than {MAX_TEXELS} pixels")));
        }
        let mut avatar =
            Avatar::with_rng(package, AvatarOptions::default(), Box::new(SeededRandom::new(0))).map_err(error)?;
        // 参数全由播放器给：关掉角色自己的待机、小动作与口型
        avatar.set_auto_idle(false);
        avatar.set_auto_motion(false);
        avatar.stop_lip_sync();
        let textures = avatar
            .textures()
            .iter()
            .map(|(k, t)| (k.clone(), Arc::new(Texture::from_rgba(t.width, t.height, t.rgba.clone()))))
            .collect();
        let cut = cut_at_bottom(avatar.package());
        Ok(MeshPackage {
            template: Mutex::new(avatar),
            textures: Arc::new(textures),
            canvas,
            cut,
        })
    }

    pub fn canvas(&self) -> [u32; 2] {
        self.canvas
    }
}

/// 底图最下面不透明的一行贴着图片底边（4 像素以内）：半身角色，`moveY` 往上时不露出切口（格式规范 §3）。
fn cut_at_bottom(pkg: &AvatarPackage) -> bool {
    let [iw, ih] = [pkg.rig.image.width, pkg.rig.image.height];
    let name = if pkg.rig.cloth.is_empty() { "base.png" } else { "base_cloth.png" };
    let rect = pkg.layers.layers.get("base").copied().unwrap_or([0, 0, iw, ih]);
    let Some(t) = pkg.textures.get(name) else {
        return true;
    };
    let (w, h) = (t.width as usize, t.height as usize);
    let Some(row) = (0..h).rev().find(|&y| (0..w).any(|x| t.rgba[(y * w + x) * 4 + 3] > 0)) else {
        return false;
    };
    let bottom = f64::from(rect[1]) + (row + 1) as f64 * f64::from(rect[3]) / h as f64;
    bottom >= f64::from(ih) - 4.0
}

/// mesh-avatar-core 的错误（anyhow，只有文字）按文字归到格式规范 §6 的代码。
fn error(e: impl fmt::Display) -> Error {
    let message = format!("{e:#}");
    let kind = if message.contains("exceeds") {
        ErrorKind::TooLarge
    } else if message.contains("missing file") {
        ErrorKind::MissingFile
    } else if message.contains("unsupported") || message.contains("expected stored compression") {
        ErrorKind::Unsupported
    } else if message.contains("PNG") {
        ErrorKind::Image
    } else if message.contains("ZIP") {
        ErrorKind::NotZip
    } else {
        ErrorKind::Invalid
    };
    Error::new(kind, message)
}

/// 一个条目上的 mesh-avatar 角色。
pub struct MeshPuppet {
    avatar: Avatar,
    initial: Avatar,
    textures: Arc<HashMap<String, Arc<Texture>>>,
    canvas: [u32; 2],
    cut: bool,
    params: Params,
    /// 按当前一步形变好的层；还没形变过时没有。
    frame: Option<MeshFrame>,
    /// 各层三角形的外边（[`raster::boundary_edges`]），按层名与三角形缓存（同名的层、换了三角形的层各留一份）。
    edges: EdgeCache,
    /// 与 `frame` 的层一一对应的外边；网格不合法的层是 `None`，不画。
    frame_edges: Vec<Option<Arc<[u8]>>>,
}

/// [`MeshPuppet`] 跨步的全部状态。
#[derive(Clone)]
pub(crate) struct MeshState {
    avatar: Avatar,
    params: Params,
}

impl MeshPuppet {
    pub fn new(pkg: &MeshPackage) -> MeshPuppet {
        let avatar = pkg.template.lock().unwrap_or_else(|e| e.into_inner()).clone();
        MeshPuppet {
            initial: avatar.clone(),
            avatar,
            textures: pkg.textures.clone(),
            canvas: pkg.canvas,
            cut: pkg.cut,
            params: Params::default(),
            frame: None,
            edges: HashMap::new(),
            frame_edges: Vec::new(),
        }
    }

    pub fn canvas(&self) -> [u32; 2] {
        self.canvas
    }

    pub fn params(&self) -> &Params {
        &self.params
    }

    pub(crate) fn reset(&mut self) {
        self.avatar = self.initial.clone();
        self.params = Params::default();
        self.frame = None;
        self.frame_edges.clear();
    }

    pub(crate) fn save(&self) -> MeshState {
        MeshState {
            avatar: self.avatar.clone(),
            params: self.params,
        }
    }

    pub(crate) fn load(&mut self, s: &MeshState) {
        self.avatar = s.avatar.clone();
        self.params = s.params;
        self.frame = None;
        self.frame_edges.clear();
    }

    /// 这一步的参数与表情（动作轨里的表情 id 与权重）。权重最大、到 [`EXPRESSION_AT`] 的那张 mesh-avatar 认得的表情
    /// 显示出来，否则是中性；笑同时由 `smile` 参数驱动眼睛的笑。
    pub(crate) fn set_inputs(&mut self, p: Params, expressions: &[(&str, f64)]) {
        self.params = p;
        let values = [
            ("angleX", p.angle_x),
            ("angleY", p.angle_y),
            ("angleZ", p.angle_z),
            ("bodyAngleX", p.body_x),
            ("bodyAngleZ", p.body_z),
            ("breath", p.breath),
            ("eyeLOpen", p.eye_l_open),
            ("eyeROpen", p.eye_r_open),
            ("eyeSmile", p.smile),
            ("gazeX", p.eye_ball_x),
            ("gazeY", p.eye_ball_y),
            ("browY", (p.brow_ly + p.brow_ry) / 2.0),
            ("browAngle", 0.0),
            ("mouthOpen", p.mouth_open),
            // 元音的方向相反：分层角色 +1 是扁（i、e），mesh-avatar 的 mouthForm −1 是 i、+1 是 o
            ("mouthForm", -p.vowel),
            ("blush", 0.0),
            ("armAngle", 0.0),
            ("handAngle", 0.0),
            ("fingerTap", 0.0),
            ("weightShift", 0.0),
            ("armSwingL", 0.0),
            ("elbowBendL", 0.0),
            ("armSwingR", 0.0),
            ("elbowBendR", 0.0),
        ];
        self.avatar.set_parameters(values.iter().map(|&(k, v)| (k.to_string(), v)).collect::<BTreeMap<_, _>>());
        let shown = expressions
            .iter()
            .filter(|(id, w)| *w >= EXPRESSION_AT && *id != "neutral" && OVERLAY_EXPRESSIONS.iter().any(|(n, _)| n == id))
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .map_or("neutral", |e| e.0);
        self.avatar.set_expression(shown);
    }

    /// 走 `dt` 秒（动作、物理、布料、嘴与眼的贴图）；`mesh` 时再按当前一步形变网格，供 [`MeshPuppet::render_shifted`]。
    pub(crate) fn update(&mut self, dt: f64, mesh: bool) {
        if dt > 0.0 {
            self.avatar.step(dt);
        }
        if mesh {
            let frame = self.avatar.frame();
            let edges = frame.layers.iter().map(|l| mesh_ok(l).then(|| edges_of(&mut self.edges, l))).collect();
            self.frame_edges = edges;
            self.frame = Some(frame);
        }
    }

    /// 同 [`crate::Puppet::shift`]。
    pub(crate) fn shift(&self, w: u32, h: u32, frame_bottom: f64) -> [f64; 2] {
        draw::shift(self.canvas, self.cut, &self.params, w, h, frame_bottom)
    }

    /// 同 [`crate::Puppet::render_shifted`]：按 mesh-avatar-core 给出的层序画。
    pub(crate) fn render_shifted(&self, w: u32, h: u32, shift: [f64; 2], out: &mut [u8]) {
        let Some(f) = &self.frame else {
            assert_eq!(out.len(), w as usize * h as usize * 4, "render buffer has the wrong size");
            out.fill(0);
            return;
        };
        let edges: Vec<Option<&[u8]>> = self.frame_edges.iter().map(Option::as_deref).collect();
        draw_frame(&self.textures, self.canvas, f, &edges, w, h, shift, out);
    }
}

/// 层名 → 这个名字见过的三角形与它们的外边。
type EdgeCache = HashMap<String, Vec<(Vec<u32>, Arc<[u8]>)>>;

/// 一个名字最多缓存几份三角形（嘴、眼的贴图换帧时三角形会变）。
const EDGE_VARIANTS: usize = 8;

/// 一层三角形的外边：缓存里有同样的三角形就用缓存的。
fn edges_of(cache: &mut EdgeCache, l: &DrawLayer) -> Arc<[u8]> {
    if let Some((_, e)) = cache.get(&l.name).and_then(|v| v.iter().find(|(tri, _)| *tri == l.indices)) {
        return e.clone();
    }
    let e: Arc<[u8]> = raster::boundary_edges(&l.indices).into();
    let entries = cache.entry(l.name.clone()).or_default();
    if entries.len() >= EDGE_VARIANTS {
        entries.remove(0);
    }
    entries.push((l.indices.clone(), e.clone()));
    e
}

/// 层的网格合法：顶点、贴图坐标成对且等长，下标不越界。不合法的层不画。
fn mesh_ok(l: &DrawLayer) -> bool {
    let n = l.positions.len() / 2;
    l.positions.len() == l.uvs.len()
        && l.positions.len().is_multiple_of(2)
        && l.indices.len().is_multiple_of(3)
        && l.indices.iter().all(|&i| (i as usize) < n)
}

/// 把 mesh-avatar-core 形变好的一帧画进 `w`×`h` 的预乘 RGBA8 缓冲（先清成透明）；`edges` 与层一一对应。
#[allow(clippy::too_many_arguments)]
fn draw_frame(
    textures: &HashMap<String, Arc<Texture>>,
    canvas: [u32; 2],
    f: &MeshFrame,
    edges: &[Option<&[u8]>],
    w: u32,
    h: u32,
    shift: [f64; 2],
    out: &mut [u8],
) {
    let (s, ox, oy) = draw::fit(canvas, w, h);
    let (w, h) = (w as usize, h as usize);
    assert_eq!(out.len(), w * h * 4, "render buffer has the wrong size");
    out.fill(0);
    let view = View {
        s,
        ox: ox + shift[0],
        oy: oy + shift[1],
    };
    let mut frame = Frame { w, h, px: out };
    let shader = Shader::new(&f.uniforms);
    for (l, edges) in f.layers.iter().zip(edges) {
        if l.indices.is_empty() || l.alpha <= 0.0 || !l.alpha.is_finite() {
            continue;
        }
        let (Some(tex), Some(edges)) = (textures.get(&l.texture), edges) else {
            continue;
        };
        let kind = Kind::of(l);
        let rect = l.rect.map(|v| v as f32);
        let shade = |u: f64, v: f64, sample: &dyn Fn(f64, f64) -> [f32; 4]| shader.shade(kind, rect, u, v, sample);
        let paint = Paint {
            tex,
            alpha: l.alpha.min(1.0) as f32,
            mask: None,
            shade: if matches!(kind, Kind::Plain) { None } else { Some(&shade) },
        };
        raster::draw(&mut frame, view, &l.positions, &l.uvs, &l.indices, edges, &paint);
    }
}

/// 用 CPU 光栅画 mesh-avatar-core 的一帧（和上游 wgpu 渲染器对拍用）：角色按画布等比缩放、居中。
#[doc(hidden)]
pub fn render_frame(pkg: &MeshPackage, f: &MeshFrame, w: u32, h: u32, out: &mut [u8]) {
    let edges: Vec<Option<Vec<u8>>> =
        f.layers.iter().map(|l| mesh_ok(l).then(|| raster::boundary_edges(&l.indices))).collect();
    let edges: Vec<Option<&[u8]>> = edges.iter().map(Option::as_deref).collect();
    draw_frame(&pkg.textures, pkg.canvas, f, &edges, w, h, [0.0; 2], out);
}

/// 一层按哪种画法画（`mesh-avatar-wgpu` 的 `Uniforms::new` 里的 `flags.x`）。
#[derive(Clone, Copy, Debug)]
enum Kind {
    Plain,
    Face,
    Ball(usize),
    HalfEye(usize),
}

impl Kind {
    fn of(l: &DrawLayer) -> Kind {
        match l.texture.as_str() {
            "sprites/eyes_half_0.png" => Kind::HalfEye(0),
            "sprites/eyes_half_1.png" => Kind::HalfEye(1),
            _ => match l.eye_ball {
                Some(e) => Kind::Ball(e.min(1)),
                None if l.face => Kind::Face,
                None => Kind::Plain,
            },
        }
    }
}

#[inline]
fn mix(a: f32, b: f32, t: f32) -> f32 {
    a * (1.0 - t) + b * t
}

#[inline]
fn mix3(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
}

#[inline]
fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// `avatar.wgsl` 的片元着色器，颜色是 0–1 的预乘值。一帧里不变的量（嘴的方向、眼睛中线的高度）先算好。
struct Shader<'a> {
    u: &'a FaceUniforms,
    /// 嘴的方向与法向。
    d: [f32; 2],
    n: [f32; 2],
    /// 每只眼睛中线处下眼线与上眼线的距离。
    height: [f32; 2],
}

impl<'a> Shader<'a> {
    fn new(u: &'a FaceUniforms) -> Shader<'a> {
        let d = [u.mouth[2].cos(), u.mouth[2].sin()];
        let mut s = Shader {
            u,
            d,
            n: [-d[1], d[0]],
            height: [0.0; 2],
        };
        s.height = [0, 1].map(|e| s.curve(e, false, 0.5) - s.curve(e, true, 0.5));
        s
    }

    /// 像素中心的贴图坐标 (u, v) 处这一层的颜色（0–255 的预乘值）。
    fn shade(&self, kind: Kind, rect: [f32; 4], u: f64, v: f64, sample: &dyn Fn(f64, f64) -> [f32; 4]) -> [f32; 4] {
        let uv = [u as f32, v as f32];
        let p = [rect[0] + uv[0] * rect[2], rect[1] + uv[1] * rect[3]];
        let tex = |q: [f32; 2]| sample(f64::from(q[0]), f64::from(q[1])).map(|c| c / 255.0);
        let tex_at = |q: [f32; 2]| tex([(q[0] - rect[0]) / rect[2], (q[1] - rect[1]) / rect[3]]);
        let c = match kind {
            Kind::Face => self.blush(p, self.painted_mouth(p, tex_at(p))),
            Kind::Ball(e) => self.eye_ball(e, p, &tex_at),
            Kind::HalfEye(e) => tex(self.half_eye_uv(e, p, uv, rect)),
            Kind::Plain => tex(uv),
        };
        c.map(|v| v * 255.0)
    }

    fn eye(&self, e: usize) -> [f32; 4] {
        let s = &self.u.eyes[e * 4..e * 4 + 4];
        [s[0], s[1], s[2], s[3]]
    }

    fn curve(&self, e: usize, top: bool, value: f32) -> f32 {
        let f = value.clamp(0.0, 1.0) * 23.0;
        let i = (f.floor() as usize).min(22);
        let t = f - i as f32;
        let c = if top { &self.u.eye_top[e] } else { &self.u.eye_bot[e] };
        mix(c[i], c[i + 1], t)
    }

    fn eye_lids_raw(&self, e: usize, input: f32) -> [f32; 2] {
        let value = input.clamp(0.0, 1.0);
        let state = self.eye(e);
        let top = self.curve(e, true, value);
        let bot = self.curve(e, false, value);
        let b = 1.0 - state[0];
        let hump = 4.0 * value * (1.0 - value);
        let arc = mix(self.u.eye_top[e][0], self.u.eye_top[e][23], value) - 0.3 * self.height[e] * hump;
        let closed = top.max(bot + 1.0 + (arc - bot - 1.0) * state[1]);
        [(closed - top) * b.max(-0.07), if b > 0.0 { (closed - bot) * b * state[1] } else { 0.0 }]
    }

    fn eye_lids(&self, e: usize, value: f32, top: f32, bot: f32) -> [f32; 2] {
        let b = self.u.eye_box[e];
        let du = 5.0 / (b[1] - b[0]);
        let raw = self.eye_lids_raw(e, value);
        let taps = [
            (self.eye_lids_raw(e, value - 2.0 * du), 1.0),
            (self.eye_lids_raw(e, value - du), 2.0),
            (raw, 3.0),
            (self.eye_lids_raw(e, value + du), 2.0),
            (self.eye_lids_raw(e, value + 2.0 * du), 1.0),
        ];
        let d = [0, 1].map(|k| taps.iter().map(|(t, w)| t[k] * w).sum::<f32>() / 9.0);
        [top + d[0].max(raw[0]), bot + d[1].min(raw[1])]
    }

    /// 半闭的眼睛：画好的眼睑不动，中间的眼珠跟着视线挪（返回改过的贴图坐标）。
    fn half_eye_uv(&self, e: usize, p: [f32; 2], uv: [f32; 2], rect: [f32; 4]) -> [f32; 2] {
        let state = self.eye(e);
        let gaze = [state[2], state[3]];
        let b = self.u.eye_box[e];
        let span = b[1] - b[0];
        let value = (p[0] - b[0]) / span;
        if (gaze[0] == 0.0 && gaze[1] == 0.0) || value <= 0.0 || value >= 1.0 {
            return uv;
        }
        let top = self.curve(e, true, value);
        let height = self.curve(e, false, value) - top;
        if height < 2.0 {
            return uv;
        }
        let v = (p[1] - top) / height;
        let w = smoothstep(0.18, 0.34, v) * (1.0 - smoothstep(0.70, 0.85, v)) * smoothstep(0.0, 0.23, value.min(1.0 - value));
        if w == 0.0 {
            return uv;
        }
        let x = p[0] - (gaze[0] * 0.8).clamp(-0.08 * span, 0.08 * span) * w;
        let source_u = (x - b[0]) / span;
        let dy = (gaze[1] / height).clamp(-0.05, 0.05) * w;
        let y = mix(self.curve(e, true, source_u), self.curve(e, false, source_u), v - dy);
        [(x - rect[0]) / rect[2], (y - rect[1]) / rect[3]]
    }

    /// 眼珠：随视线移（越靠眼眶中间移得越多），被合拢的上下眼睑裁掉。
    fn eye_ball(&self, e: usize, p: [f32; 2], tex_at: &dyn Fn([f32; 2]) -> [f32; 4]) -> [f32; 4] {
        let b = self.u.eye_box[e];
        let state = self.eye(e);
        let value = ((p[0] - b[0]) / (b[1] - b[0])).clamp(0.0, 1.0);
        let top = self.curve(e, true, value);
        let bot = self.curve(e, false, value);
        let lids = self.eye_lids(e, value, top, bot);
        let v = ((p[1] - top) / (bot - top).max(1.0)).clamp(0.0, 1.0);
        let w = (4.0 * value * (1.0 - value)).sqrt() * (4.0 * v * (1.0 - v)).sqrt();
        let c = tex_at([p[0] - state[2] * w, p[1] - state[3] * w]);
        let k = smoothstep(lids[0] - 1.0, lids[0] + 0.5, p[1]) * (1.0 - smoothstep(lids[1] - 0.9, lids[1] + 0.6, p[1]));
        c.map(|v| v * k)
    }

    /// 没有嘴的贴图盖着时画出来的嘴：张开的口腔、舌头、上齿与唇边。
    fn painted_mouth(&self, p: [f32; 2], base: [f32; 4]) -> [f32; 4] {
        let u = self.u;
        let open = u.mouth_state[0];
        if open < 0.01 {
            return base;
        }
        let r = [p[0] - u.mouth[0], p[1] - u.mouth[1]];
        let s = (r[0] * self.d[0] + r[1] * self.d[1]) / u.mouth[3];
        let t = r[0] * self.n[0] + r[1] * self.n[1];
        let form = u.mouth_state[1];
        let wf = mix(0.78, 0.46, (form * 0.5 + 0.5).clamp(0.0, 1.0));
        let k = 1.0 - (s / wf) * (s / wf);
        if k <= 0.0 {
            return base;
        }
        let line = u.mouth_state[2] * (1.0 - s * s);
        let hk = k.powf(mix(0.55, 0.85, form.clamp(0.0, 1.0)));
        let height = mix(20.0, 26.0, form.clamp(0.0, 1.0));
        let up = line - 0.6 - open * 2.5 * hk;
        let lo = line + open * height * hk;
        let cov = smoothstep(-0.7, 0.7, t - up) * smoothstep(-0.7, 0.7, lo - t);
        if cov <= 0.0 {
            return base;
        }
        let tv = ((t - up) / (lo - up).max(1.0)).clamp(0.0, 1.0);
        let side = s.abs() / wf;
        let mut col = mix3([0.24, 0.05, 0.08], [0.48, 0.15, 0.19], tv);
        let tongue = smoothstep(0.5, 0.78, tv) * (1.0 - smoothstep(0.45, 0.8, side));
        col = mix3(col, [0.86, 0.44, 0.47], tongue * 0.9);
        let teeth = (1.0 - smoothstep(0.12, 0.22, tv)) * smoothstep(0.25, 0.45, open) * (1.0 - smoothstep(0.55, 0.85, side));
        col = mix3(col, [0.99, 0.96, 0.94], teeth);
        let rim = 1.0 - smoothstep(0.6, 1.8, lo - t);
        col = mix3(col, [0.36, 0.09, 0.11], rim * 0.85);
        let rgb = mix3([base[0], base[1], base[2]], col, cov);
        [rgb[0], rgb[1], rgb[2], 1.0]
    }

    /// 两颊的腮红：两团高斯，按 `blush` 参数把颜色往粉里压。
    fn blush(&self, p: [f32; 2], c: [f32; 4]) -> [f32; 4] {
        let u = self.u;
        if u.cheek <= 0.0 {
            return c;
        }
        let a = [(p[0] - u.cheeks[0]) / 48.0, (p[1] - u.cheeks[1]) / 22.0];
        let b = [(p[0] - u.cheeks[2]) / 40.0, (p[1] - u.cheeks[3]) / 20.0];
        let blush = (-(a[0] * a[0] + a[1] * a[1])).exp() + (-(b[0] * b[0] + b[1] * b[1])).exp();
        let k = (blush * u.cheek * 0.55).clamp(0.0, 1.0) * c[3];
        [mix(c[0], c[0], k), mix(c[1], c[1] * 0.62, k), mix(c[2], c[2] * 0.64, k), c[3]]
    }
}
