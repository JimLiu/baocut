//! 两种角色包、一套播放：分层角色（`model.json` + 分层贴图，见 [`Package`]）与 mesh-avatar 角色（`.mavatar`，见
//! [`MeshPackage`]）是同一种素材，按包里的文件区分（格式规范 §2.5）。动作轨、待机、固定步长的重放与快照、平移与
//! 光栅都是同一份，只有形变和画法各走各的。

use crate::mesh_avatar::{MeshPackage, MeshPuppet, MeshState};
use crate::package::is_mesh_avatar;
use crate::rig::State;
use crate::{Error, Package, Params, Puppet};

/// 读好的角色包（两种之一）。
#[derive(Debug)]
pub enum CharacterPackage {
    Layered(Box<Package>),
    Mesh(Box<MeshPackage>),
}

impl CharacterPackage {
    /// 从 zip 字节读角色包：根上有 `avatar.json`、没有 `model.json` 的是 mesh-avatar 角色，其余按分层角色读。
    pub fn from_zip(bytes: &[u8]) -> Result<CharacterPackage, Error> {
        if is_mesh_avatar(bytes) {
            MeshPackage::from_zip(bytes).map(|p| CharacterPackage::Mesh(Box::new(p)))
        } else {
            Package::from_zip(bytes).map(CharacterPackage::from)
        }
    }

    /// 导入时检查角色包，返回画布尺寸（宽、高）。分层角色只检查不解码（[`Package::inspect`]）；mesh-avatar 角色
    /// 整个读一遍，网格建不起来的也不收。
    pub fn inspect(bytes: &[u8]) -> Result<[u32; 2], Error> {
        if is_mesh_avatar(bytes) {
            MeshPackage::from_zip(bytes).map(|p| p.canvas())
        } else {
            Package::inspect(bytes).map(|m| m.canvas)
        }
    }

    pub fn canvas(&self) -> [u32; 2] {
        match self {
            CharacterPackage::Layered(p) => p.model.canvas,
            CharacterPackage::Mesh(p) => p.canvas(),
        }
    }
}

impl From<Package> for CharacterPackage {
    fn from(p: Package) -> CharacterPackage {
        CharacterPackage::Layered(Box::new(p))
    }
}

/// 一个条目上的角色（两种之一），交给 [`crate::Player`] 播放。
pub enum Character {
    Layered(Box<Puppet>),
    Mesh(Box<MeshPuppet>),
}

/// [`Character`] 跨步的全部状态（快照）。
#[derive(Clone)]
pub(crate) enum CharacterState {
    Layered(Box<State>),
    Mesh(Box<MeshState>),
}

impl From<Puppet> for Character {
    fn from(p: Puppet) -> Character {
        Character::Layered(Box::new(p))
    }
}

impl From<MeshPuppet> for Character {
    fn from(p: MeshPuppet) -> Character {
        Character::Mesh(Box::new(p))
    }
}

impl Character {
    pub fn new(pkg: &CharacterPackage) -> Result<Character, Error> {
        match pkg {
            CharacterPackage::Layered(p) => Puppet::new(p).map(Character::from),
            CharacterPackage::Mesh(p) => Ok(MeshPuppet::new(p).into()),
        }
    }

    /// 画布尺寸（模型像素）。
    pub fn canvas(&self) -> [u32; 2] {
        match self {
            Character::Layered(p) => p.model.canvas,
            Character::Mesh(p) => p.canvas(),
        }
    }

    /// 当前一步的参数。
    pub fn params(&self) -> &Params {
        match self {
            Character::Layered(p) => &p.params,
            Character::Mesh(p) => p.params(),
        }
    }

    pub(crate) fn reset(&mut self) {
        match self {
            Character::Layered(p) => p.reset(),
            Character::Mesh(p) => p.reset(),
        }
    }

    pub(crate) fn save(&self) -> CharacterState {
        match self {
            Character::Layered(p) => CharacterState::Layered(Box::new(p.save())),
            Character::Mesh(p) => CharacterState::Mesh(Box::new(p.save())),
        }
    }

    pub(crate) fn load(&mut self, s: &CharacterState) {
        match (self, s) {
            (Character::Layered(p), CharacterState::Layered(s)) => p.load(s),
            (Character::Mesh(p), CharacterState::Mesh(s)) => p.load(s),
            _ => unreachable!("a snapshot is loaded into the character that saved it"),
        }
    }

    pub(crate) fn update(&mut self, dt: f64, mesh: bool) {
        match self {
            Character::Layered(p) => p.update(dt, mesh),
            Character::Mesh(p) => p.update(dt, mesh),
        }
    }

    /// 见 [`Puppet::render`]。
    pub fn render(&self, w: u32, h: u32, out: &mut [u8]) {
        self.render_shifted(w, h, self.shift(w, h, f64::from(h)), out);
    }

    /// 见 [`Puppet::shift`]。
    pub fn shift(&self, w: u32, h: u32, frame_bottom: f64) -> [f64; 2] {
        match self {
            Character::Layered(p) => p.shift(w, h, frame_bottom),
            Character::Mesh(p) => p.shift(w, h, frame_bottom),
        }
    }

    /// 见 [`Puppet::render_shifted`]。
    pub fn render_shifted(&self, w: u32, h: u32, shift: [f64; 2], out: &mut [u8]) {
        match self {
            Character::Layered(p) => p.render_shifted(w, h, shift, out),
            Character::Mesh(p) => p.render_shifted(w, h, shift, out),
        }
    }
}

// 宿主把读好的角色包放进 Arc 跨线程共用、把播放器交给导出线程
const _: () = {
    const fn shared<T: Send + Sync>() {}
    const fn sent<T: Send>() {}
    shared::<CharacterPackage>();
    sent::<crate::Player>();
};
