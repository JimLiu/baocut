//! `timeline.json` 的格式版本常量。
//!
//! v2 放在 `bcut-protocol/src/version.rs` 的 `versions` 模块里；本 crate 只用到这两个，
//! 原值照搬到这里。`schema` 仍以原来的公共名字（`TIMELINE_VERSION` / `TIMELINE_VERSIONS`）
//! 导出它们。

/// Timeline（`timeline.json`）：读 0.1–0.12，写 0.12（0.9 白板节拍跟旁白：`pace` / `strict` / `end` / `label` / 词锚点；
/// 0.10 音频元素 `bcfClip`：动画项目旁白导入为轨时认领的 BCF 音频 clip；0.11 素材 `origin`（`"ai"`）与出处侧车
/// `provenance`：图像生成的结果登记成普通 `Source`；0.12 元素 `keyframes` / `duck`，`bg` 与
/// `main.background` 接受 `#RRGGBB`）。
pub const TIMELINE_CURRENT: &str = "0.12";
pub const TIMELINE_SUPPORTED: &[&str] = &[
    "0.1",
    "0.2",
    "0.3",
    "0.4",
    "0.5",
    "0.6",
    "0.7",
    "0.8",
    "0.9",
    "0.10",
    "0.11",
    TIMELINE_CURRENT,
];
