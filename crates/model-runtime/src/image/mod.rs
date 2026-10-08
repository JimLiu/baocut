//! 本地文生图：请求与结果类型、引擎 trait、PNG 编码与 `job.run`（capability `image`）的编排。
//!
//! 移植自 v2 的 `bcut-image-local`（Qwen-Image-2.1 的 MLX 与 candle 后端）与 `bcut-image::local` 里纯的一半（任务、阶段、
//! 原始像素）。与 v2 不同的只有边界：v2 按「模型目录 + 相对路径」找文件、在调用方进程里跑；这里经
//! [`crate::bundle::VerifiedFiles`] 按清单取文件（缺文件 `MODEL_NOT_INSTALLED`），跑在 Model Worker 里，
//! 结果写成 staging 里的 `image.png`（`baocut.image-png/v1`）。
//!
//! - [`qwen_image`]：Qwen-Image-2.1。调度器与 RoPE 表是纯逻辑、全平台编译；MLX 的模型图只在 `backend-mlx` + macOS
//!   Apple Silicon 上编译，candle 的随 `backend-candle` 编译（由 candle 后端加载，不经 [`load`]）。
//! - [`job`]：一次 `job.run` 的阶段、进度、取消与写出。
//! - [`png`]：RGBA → PNG。
//!
//! 引擎实例持有设备句柄，不是 `Send`：在哪个线程加载就在哪个线程生成。

pub mod job;
pub mod png;
pub mod qwen_image;

use anyhow::Result;
use serde_json::json;

use crate::bundle::{FAMILY_QWEN_IMAGE, VerifiedFiles};
use crate::protocol::{ErrorBody, codes};

/// 一次生成：提示词、像素宽高、去噪步数与随机种子（同一 seed、同一机器得到同一张图）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageRequest {
    pub prompt: String,
    pub width: u32,
    pub height: u32,
    pub steps: u32,
    pub seed: u64,
}

/// 生成的进度：编码提示词 → 去噪（`done/total` 步，开始时报 `0/total`）→ 解码。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageProgress {
    EncodingPrompt,
    Denoising { done: u32, total: u32 },
    Decoding,
}

/// 8 位 RGBA，行主序，`pixels.len() == width * height * 4`。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawImage {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

/// 引擎在步间看到取消标志后返回的错误。
#[derive(Debug)]
pub struct Cancelled;

impl std::fmt::Display for Cancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("已取消")
    }
}

impl std::error::Error for Cancelled {}

/// 一个已加载的本地文生图模型。
pub trait ImageEngine {
    /// 模型族（`components.image.family`）。
    fn family(&self) -> &'static str;

    /// 请求没给步数时用的步数。
    fn default_steps(&self) -> u32;

    /// 这只模型能不能出这个尺寸；不能是 `MODEL_UNSUPPORTED`（`details.reason: 'unsupported-size'`）。不碰设备。
    fn check_size(&self, width: u32, height: u32) -> Result<(), ErrorBody>;

    /// 生成一张。`cancel` 在步间查看，返回真时实现返回 [`Cancelled`]。
    fn generate(&mut self, request: &ImageRequest, progress: &mut dyn FnMut(ImageProgress), cancel: &dyn Fn() -> bool) -> Result<RawImage>;
}

/// 这个构建能不能加载 Qwen-Image：MLX（Apple Silicon）或 candle（任何平台）编进来了就能。
pub const fn qwen_image_available() -> bool {
    cfg!(any(
        all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"),
        feature = "backend-candle"
    ))
}

/// 本构建认识的文生图 family（`components.image.family`）。
pub const IMAGE_FAMILIES: [&str; 1] = [FAMILY_QWEN_IMAGE];

/// 这个 family 在这个构建里能不能加载。
pub fn family_available(family: &str) -> bool {
    match family {
        FAMILY_QWEN_IMAGE => qwen_image_available(),
        _ => false,
    }
}

/// 这个构建能加载的文生图 family。`worker.hello` 的 `imageFamilies` 就是它；非空时才声明 `image` 能力（协议规范 §2.1）。
pub fn available_families() -> Vec<&'static str> {
    IMAGE_FAMILIES.into_iter().filter(|family| family_available(family)).collect()
}

/// 加载一只 MLX 引擎（candle 后端另用 `qwen_image::candle::QwenImage::load`，带上设备）。调用前不需要自己确认 Metal：
/// 实现会先核对清单（缺文件是 `MODEL_NOT_INSTALLED`），再确认设备。
///
/// 错误里的 [`ErrorBody`] 可以 `downcast_ref` 出来原样上报；其余是加载失败。
pub fn load(files: &VerifiedFiles) -> Result<Box<dyn ImageEngine>> {
    if !family_available(&files.family) {
        return Err(crate::protocol::image_not_wired(Some(&files.family)).into());
    }
    load_available(files)
}

#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
fn load_available(files: &VerifiedFiles) -> Result<Box<dyn ImageEngine>> {
    Ok(Box::new(qwen_image::QwenImage::load(files)?))
}

#[cfg(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")))]
fn load_available(files: &VerifiedFiles) -> Result<Box<dyn ImageEngine>> {
    Err(crate::protocol::image_not_wired(Some(&files.family)).into())
}

/// 尺寸做不到：`MODEL_UNSUPPORTED`，带上请求的宽高与模型的规则。
pub fn unsupported_size(family: &str, width: u32, height: u32, rule: &str) -> ErrorBody {
    ErrorBody::new(
        codes::MODEL_UNSUPPORTED,
        format!("{family} cannot generate {width}x{height} ({rule})"),
    )
    .with_details(json!({ "family": family, "reason": "unsupported-size", "width": width, "height": height, "rule": rule }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bundle::{FileEntry, ModelFiles};

    #[test]
    fn only_wired_families_are_reported() {
        let families = available_families();
        if qwen_image_available() {
            assert_eq!(families, [FAMILY_QWEN_IMAGE]);
        } else {
            assert!(families.is_empty());
        }
        assert!(!family_available("stable-diffusion"));
    }

    #[test]
    fn unknown_families_are_not_wired() {
        let dir = tempfile::tempdir().unwrap();
        let files = ModelFiles {
            family: "stable-diffusion".into(),
            revision: "r".into(),
            dir: dir.path().to_string_lossy().into_owned(),
            files: Vec::<FileEntry>::new(),
        }
        .verify("image")
        .unwrap();
        let error = match load(&files) {
            Ok(_) => panic!("不该加载成功"),
            Err(error) => error.downcast_ref::<ErrorBody>().expect("ErrorBody").clone(),
        };
        assert_eq!(error.code, codes::MODEL_UNSUPPORTED);
        assert_eq!(error.details.unwrap()["reason"], "not-wired");
    }
}
