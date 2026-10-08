//! GPT-SoVITS v2（`lj1995/GPT-SoVITS` 的 `gsv-v2final-pretrained`，safetensors 转存于
//! `PJMixers-Dev/lj1995_GPT-SoVITS-safetensors`）原生移植，移植自 v2 `bcut-tts::gpt_sovits`。
//!
//! 模型图与文本前端对照上游 `RVC-Boss/GPT-SoVITS`（MIT）逐层移植，文本前端各数据的来源与许可见
//! `text/mod.rs` 与 `text/data/README.md`。
//!
//! 流水线：文本 → 前端（切句、规范化、G2P → 音素 id + `word2ph`）→ chinese-roberta
//! 第 22 层逐字特征（仅中文段，其余补零）→ T2S（24 层 AR Transformer）生成 25 Hz
//! 语义 token → SoVITS（码本解码 + 文本编码器 + flow 逆变换 + HiFi-GAN）→ 32 kHz 波形。
//! 参考音频：16 kHz → chinese-hubert-base → `ssl_proj` + VQ 得到提示语义 token；
//! 32 kHz 线性谱 → MelStyleEncoder 得到 512 维音色向量。
//!
//! 纯逻辑模块（文本前端、STFT、采样）不带 cfg 门，全平台编译并带单测；模型图与 [`GptSovits`]
//! 经 `synthesize::tensor` 门面编译：Apple Silicon 上是 MLX，其余平台开 `backend-candle` 时是 candle CPU/CUDA。

pub mod sampling;
pub mod spec;
pub mod text;

/// 给了参考文本时，官方只接受这个时长窗（秒）内的参考音频；只给参考音频不设限。
pub const REFERENCE_SECONDS_WITH_TEXT: [f32; 2] = [3.0, 10.0];

/// 调用方在进度回调里返回 `false` 后的错误信息。
pub const ABORT_MESSAGE: &str = "GPT-SoVITS 合成已被调用方取消";

#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod bert;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod engine;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod hubert;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod layers;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod sovits;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod t2s;
#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
mod weights;

#[cfg(any(
    feature = "backend-candle",
    all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")
))]
pub use engine::GptSovits;
