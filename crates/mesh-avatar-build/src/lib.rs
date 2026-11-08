//! mesh-avatar 主播的制作工具：切分层、导入变体 sprite、按配音驱动口型。分层与 sprite 的算法移植自
//! mesh-avatar-studio（MIT，Yuki Shindo）的 Python 工具，运行时与渲染用同目录下的 `mesh-avatar-core`
//! 和 `mesh-avatar-wgpu`。

pub mod imgops;
pub mod layers;
pub mod rig;
pub mod sprites;
pub mod talk;
pub mod variants;
