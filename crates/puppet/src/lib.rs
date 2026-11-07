//! 分层角色（puppet）：BaoCut 的一种素材，一张角色拆成 20 多张整块分层（后发、身体、光头的脸、眼白、眼珠、
//! 几帧嘴、表情补丁、侧发、刘海、眉毛……），按一组参数（转头、点头、眨眼、视线、张嘴、元音、笑……）每帧
//! 形变网格再画出来。格式见 `docs/spec/puppet-format-spec.md`。
//!
//! 实现移植自 LivLiv Player（<https://github.com/livliv-dev/player>，Apache-2.0）的 `src/runtime/puppet.ts`：
//! 网格格子、头部椭球的转动、头发与身体的权重场、两段弹簧、身体滞后与呼吸、下巴随嘴帧下移、眼睛压扁与眼珠裁切、
//! 嘴帧的滞回、表情与眉毛的绘制顺序。改动：用 CPU 三角形光栅代替 WebGL2（像素中心、左上规则、三线性
//! mipmap、预乘混合与 GL 一致）；眼珠的模板与软遮罩合成一张屏幕空间的覆盖图；随机的部分（眨眼、扫视、
//! 头的游移）不在渲染器里，由动作轨给出，没有动作轨时用固定种子的待机动作；物理按固定 1/120 秒步长从条目
//! 开头重放，任意时刻 seek 结果都一样；链条（`rig.chains` 与层的 `bones`）照 LivLiv 的绳子模拟移植，状态
//! 按 f32 取整；不读 v4 的 keyforms（转头的实测修正，忽略）。

mod draw;
mod idle;
mod mesh;
pub mod model;
mod package;
mod player;
mod raster;
mod rig;
pub mod track;

use std::fmt;

pub use model::Model;
pub use package::{Package, Texture};
pub use player::Player;
pub use rig::{Params, Puppet};
pub use track::Track;

/// 读角色包、动作轨出错时的种类；`code()` 是给宿主（导出、预览的跳过提示）用的稳定代码。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorKind {
    /// 不是 zip，或者 zip 坏了、用了不支持的特性（加密、zip64）。
    NotZip,
    /// 内容不合格式：model.json 缺字段、数值越界、贴图路径不对。
    Invalid,
    /// 格式版本比这个实现新。
    Unsupported,
    /// 超过尺寸上限（层数、贴图像素、文件大小）。
    TooLarge,
    /// model.json 引用的贴图不在包里。
    MissingFile,
    /// 贴图不是能解码的 PNG / WebP。
    Image,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub kind: ErrorKind,
    pub message: String,
}

impl Error {
    pub(crate) fn new(kind: ErrorKind, message: impl Into<String>) -> Error {
        Error {
            kind,
            message: message.into(),
        }
    }
    pub(crate) fn invalid(message: impl Into<String>) -> Error {
        Error::new(ErrorKind::Invalid, message)
    }
    pub(crate) fn unsupported(message: impl Into<String>) -> Error {
        Error::new(ErrorKind::Unsupported, message)
    }
    pub(crate) fn too_large(message: impl Into<String>) -> Error {
        Error::new(ErrorKind::TooLarge, message)
    }
    pub fn code(&self) -> &'static str {
        match self.kind {
            ErrorKind::NotZip => "puppet-not-zip",
            ErrorKind::Invalid => "puppet-invalid",
            ErrorKind::Unsupported => "puppet-unsupported",
            ErrorKind::TooLarge => "puppet-too-large",
            ErrorKind::MissingFile => "puppet-missing-file",
            ErrorKind::Image => "puppet-image",
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({})", self.message, self.code())
    }
}

impl std::error::Error for Error {}

/// smoothstep：`a` 到 `b` 之间从 0 平滑到 1（`a > b` 时反过来），与 LivLiv 的 `smooth` 相同。
#[inline]
pub(crate) fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
