//! 人声与伴奏分离（本地 `separate`）：HTDemucs-FT（Demucs v4 hybrid transformer）的 mlx-rs 与 candle 移植。
//!
//! 移植自 v2 的 `bcut-separate`。用途：配音前把原人声与背景声（鼓、贝斯、其他）分开，配音后只保留背景声，
//! 再叠上合成的人声。与 v2 不同的只有边界：v2 按「模型目录 + 文件名」找文件，这里经
//! [`crate::bundle::VerifiedFiles`] 按清单取（缺文件 `MODEL_NOT_INSTALLED`）；MLX 设备与缓存走
//! [`crate::backend::mlx::runtime`]，candle 的设备由 candle 后端按模型包的 `device` 设定；一次 `job.run` 的编排在 [`job`]。
//!
//! 类型与纯逻辑（[`config`]、[`segment`]、[`stft`]、[`resample`]、[`wav`]、[`types`]）全平台编译并带单测；
//! 模型图（`htdemucs`）在 `backend-mlx` + macOS Apple Silicon 上编一份 MLX 的，开了 `backend-candle` 时再编一份 candle 的
//! （全平台；CPU，开 `cuda` 时 NVIDIA GPU）。

pub mod config;
pub mod job;
pub mod resample;
pub mod segment;
pub mod stft;
pub mod types;
pub mod wav;

#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
pub mod htdemucs;

pub use config::HtDemucsConfig;
pub use types::{SeparatedStems, SeparationProgress, StereoAudio};

use crate::bundle::VerifiedFiles;
use anyhow::Result;

/// 分离进度回调；返回 `false` 请求取消。
pub type ProgressSink<'a> = &'a mut dyn FnMut(SeparationProgress) -> bool;

/// 这个构建里有没有可用的本地分离后端。
pub const fn local_separation_available() -> bool {
    cfg!(any(
        feature = "backend-candle",
        all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
    ))
}

/// 这个构建能加载的分离模型 family（`components.separator.family`）。`worker.hello` 的 `separateFamilies` 就是它。
pub fn available_families() -> Vec<&'static str> {
    if local_separation_available() {
        vec![crate::bundle::FAMILY_HTDEMUCS_FT]
    } else {
        Vec::new()
    }
}

/// 已加载的分离模型。持有权重，不是 `Send`：在哪个线程加载就在哪个线程分离。
pub trait Separator {
    /// 模型工作采样率（HTDemucs 为 44 100 Hz）。
    fn sample_rate(&self) -> u32;

    /// 把立体声混音分成四个 stem（模型采样率、同长度）。
    fn separate(&mut self, mix: &StereoAudio, progress: ProgressSink<'_>) -> Result<SeparatedStems>;
}

/// 用 MLX 加载 HTDemucs-FT（`htdemucs_ft.safetensors` + `htdemucs_ft_config.json`）。调用前不需要自己确认 Metal。
///
/// 错误里的 [`crate::protocol::ErrorBody`]（缺文件）可以 `downcast_ref` 出来原样上报；其余是加载失败。
#[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
pub fn load_separator(files: &VerifiedFiles) -> Result<Box<dyn Separator>> {
    Ok(Box::new(htdemucs::mlx::HtDemucs::load(files)?))
}

/// 没编 MLX 的构建：MLX 后端本身不可用，不会走到这里；candle 用 [`load_candle_separator`]。
#[cfg(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")))]
pub fn load_separator(files: &VerifiedFiles) -> Result<Box<dyn Separator>> {
    let _ = files;
    Err(crate::protocol::ErrorBody::new(
        crate::protocol::codes::MODEL_UNSUPPORTED,
        "local audio separation is not available in this build",
    )
    .with_details(serde_json::json!({ "capability": "separate", "reason": "not-compiled" }))
    .into())
}

/// 用 candle 在 `device` 上加载 HTDemucs-FT（与 MLX 读同一个仓库：fp16 权重加载时升成 f32，CPU 与 CUDA 都按 f32 算，
/// 同 v2）。错误的约定同 [`load_separator`]。
#[cfg(feature = "backend-candle")]
pub fn load_candle_separator(files: &VerifiedFiles, device: candle_core::Device) -> Result<Box<dyn Separator>> {
    htdemucs::candle::use_device(device);
    Ok(Box::new(htdemucs::candle::HtDemucs::load(files)?))
}
