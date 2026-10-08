//! Qwen-Image-2.1（`mlx-community/Qwen-Image-2.1-MLX-4bit`），移植自 v2 `bcut-image-local::qwen`。
//!
//! 三段模型顺序运行、绝不同时驻留：文本编码器 → 释放 → DiT → 释放 → VAE。文本编码器与 DiT 的层权重逐层流式读入
//! （预读下一层、用完即丢），常驻的只有相邻两层。缓存上限按阶段设定、出门还原（`engine::CacheLimit`）。
//!
//! 纯逻辑（尺寸规则、提示词模板与分词、调度器、RoPE 表）全平台编译；MLX 的模型图只在 `backend-mlx` + macOS Apple Silicon
//! 上编译，candle 的（[`candle`]，CPU 与 CUDA）随 `backend-candle` 编译。两条路读同一个模型包仓库。

/// `BCUT_IMAGE_TIMING=1` 时把每段耗时、每步耗时与内存快照打到 stderr（开发自检用；Worker 缺省不开，stdout 是协议通道）。
#[allow(unused_macros)]
macro_rules! trace {
    ($($arg:tt)*) => {
        if $crate::image::qwen_image::timing() {
            eprintln!($($arg)*);
        }
    };
}

#[cfg(feature = "backend-candle")]
pub mod candle;
pub mod prompt;
pub mod rope;
pub mod scheduler;

#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
mod dit;
#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
mod engine;
#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
mod text_encoder;
#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
mod vae;
#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
mod weights;

#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
pub use engine::QwenImage;

use crate::bundle::FAMILY_QWEN_IMAGE;
use crate::protocol::ErrorBody;

/// 请求没给步数时的去噪步数（v2 同值）。
pub const DEFAULT_STEPS: u32 = 20;
/// 宽高都必须是它的整数倍（VAE 下采样 8 × DiT patch 2，再留一档给 2×2 打包）。
pub const SIZE_MULTIPLE: u32 = 32;
/// 长边上限（v2 能力表 `max_edge`）。
pub const MAX_EDGE: u32 = 1536;
/// 长短边之比的上限（v2 能力表 `max_ratio`）。
pub const MAX_RATIO: u32 = 3;

#[doc(hidden)]
pub fn timing() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("BCUT_IMAGE_TIMING").is_some_and(|v| v == "1"))
}

/// 这只模型能不能出这个尺寸。不碰设备。
pub fn check_size(width: u32, height: u32) -> Result<(), ErrorBody> {
    let fail = |rule: &str| Err(super::unsupported_size(FAMILY_QWEN_IMAGE, width, height, rule));
    if width == 0 || height == 0 || !width.is_multiple_of(SIZE_MULTIPLE) || !height.is_multiple_of(SIZE_MULTIPLE) {
        return fail("multiple-of-32");
    }
    if width.max(height) > MAX_EDGE {
        return fail("max-edge-1536");
    }
    if width.max(height) > width.min(height) * MAX_RATIO {
        return fail("max-ratio-3");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::codes;

    #[test]
    fn sizes_follow_the_multiple_edge_and_ratio_rules() {
        for (w, h) in [
            (1024, 1024),
            (1024, 576),
            (576, 1024),
            (1024, 768),
            (768, 1024),
            (1024, 448),
            (256, 256),
            (1536, 512),
        ] {
            assert!(check_size(w, h).is_ok(), "{w}x{h}");
        }
        for (w, h, rule) in [
            (500, 512, "multiple-of-32"),
            (0, 512, "multiple-of-32"),
            (1568, 1024, "max-edge-1536"),
            (1536, 480, "max-ratio-3"),
        ] {
            let error = check_size(w, h).unwrap_err();
            assert_eq!(error.code, codes::MODEL_UNSUPPORTED);
            let details = error.details.unwrap();
            assert_eq!(details["reason"], "unsupported-size");
            assert_eq!(details["rule"], rule, "{w}x{h}");
        }
    }
}
