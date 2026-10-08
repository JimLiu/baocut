//! BaoCut 本地推理的公共库（架构设计 §6.5–§6.6，Model Worker 协议规范）。
//!
//! 与能力无关的部分：协议与消息类型（[`protocol`]）、模型包与文件校验（[`bundle`]）、父进程看护
//! （[`watchdog`]）、后端抽象（[`backend`]）、音频解码（[`audio`]）、秒到 tick 的换算（[`ticks`]）、
//! 输出合同与写出（[`asr_result`]）、推理线程的调度优先级（[`priority`]）、系统内存压力（[`pressure`]）。语音识别的纯逻辑在
//! [`speech`]，一次 `transcribe` 任务的编排在 [`transcribe`]，给已有转写区分说话人（`diarize`）在 [`diarize`]。本地语音合成（TTS 引擎与它们共用的文本、音色、
//! WAV 部分）在 [`synthesize`]。本地文生图（Qwen-Image 与 `image` 能力的任务编排）在 [`image`]。
//!
//! MLX 的模块只在 `backend-mlx` + macOS Apple Silicon 上编译；别的平台照样能编译整个 crate，
//! 只是后端报告不可用。candle 后端（`backend-candle`，可选 `cuda`）全平台都能编译；GPU 开关在 [`gpu_env`]。

pub mod asr_result;
pub mod audio;
pub mod backend;
pub mod bundle;
pub mod diarize;
pub mod gpu_env;
pub mod image;
pub mod pressure;
pub mod priority;
pub mod protocol;
pub mod separate;
pub mod speech;
pub mod synthesize;
pub mod ticks;
pub mod transcribe;
pub mod watchdog;

/// Worker 的版本：crate 版本。
pub const WORKER_VERSION: &str = env!("CARGO_PKG_VERSION");
/// `workerContractVersion`。
pub const CONTRACT_VERSION: u64 = 1;
/// 语音模型的输入采样率。
pub const SAMPLE_RATE: u32 = 16_000;
