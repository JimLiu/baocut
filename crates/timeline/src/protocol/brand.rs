//! 水印预设与 Logo 元信息的**线上形状**（`brand.json` 的 `watermarks[]` / `logos[]`）。
//!
//! v2 在 `bcut-protocol/src/brand.rs`；本 crate 只有 [`crate::template`] 的水印换算用到
//! [`Watermark`]、[`WatermarkKind`]、[`Placement`] 与 [`Logo`]，不移植 `bcut-protocol`，
//! 这四个类型连同它们的缺省值原样照搬到这里（去掉只为生成 JSON Schema 的 `JsonSchema`
//! 派生）。`BrandDocument`、字体、字幕样式预设与水印导入留在 v2。

use serde::{Deserialize, Serialize};

/// 水印预设的载体类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WatermarkKind {
    Text,
    Image,
}

/// 水印摆放：平铺整幅还是压在一角。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Placement {
    Tiled,
    Corner,
}

fn default_opacity() -> f64 {
    0.6
}

/// 一条水印预设。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Watermark {
    pub id: String,
    /// 列表里显示的名字；省略时回落到 `value`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub kind: WatermarkKind,
    /// `text` 是水印文字本身；`image` 是 `logos[].id`，也接受绝对路径。
    pub value: String,
    #[serde(default = "default_placement")]
    pub placement: Placement,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    /// UI 的「设为默认」标记。CLI 不据此隐式选预设——`--from-brand` 恒要显式 id。
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub default: bool,
}

fn default_placement() -> Placement {
    Placement::Corner
}

/// 一条 Logo 资产：字节落在 `<config_root>/brand/` 下，这里只记元信息。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Logo {
    pub id: String,
    /// 展示名，缺省取导入时的原始文件名。
    pub name: String,
    /// **相对 `<config_root>` 的**路径（形如 `brand/logo-1.png`）：整个配置目录
    /// 可以被整体搬走或同步，绝对路径会在另一台机器上失效。
    pub file: String,
    pub bytes: u64,
    /// 毫秒 epoch。
    pub added_at: u64,
    /// 最近一次被用出去的毫秒 epoch（贴纸落到时间轴、Logo 套进项目）。缺省表示
    /// 从没用过，排序时回落 `added_at`——写成 `Option` 而不是 `0`，是因为「没用过」
    /// 与「1970 年用过」不是同一件事，UI 也可能想把两者分开显示。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub used_at: Option<u64>,
}
