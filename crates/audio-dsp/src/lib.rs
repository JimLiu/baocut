//! BaoCut 离线音频 DSP 原语：配乐 / 音效合成（`bcut-score`）与母带（后续的 `bcut-render`
//! 混音）共用的一份。
//!
//! 约定（全 crate 一致）：
//!
//! - **纯函数、无 I/O**：输入是切片，输出是新的 `Vec<f32>` 或就地改写的 `&mut`。没有隐藏状态、
//!   没有全局缓存，同一输入两次调用逐位相同。
//! - **采样率显式传参**（`sr: f64`，BaoCut 默认 48 000）。时间参数一律是秒，频率是 Hz，
//!   电平是 dB（`*_db`）或线性增益（其余）。
//! - **多声道一律分离（planar）**：立体声是 [`Stereo`]（`l` / `r` 两条等长 `Vec<f32>`），
//!   通用多声道入口收 `&[&[f32]]`（每声道一条切片）。交错（interleaved）只出现在 WAV 编码那一步
//!   （`bcut-score::wav`），DSP 内部不出现。
//! - **样本是 `f32`，内部累加与滤波器状态是 `f64`**：40 Hz 的高通、60 秒的响度积分在 `f32`
//!   里会漂。
//! - **确定性、跨平台一致**：超越函数（`sin` / `exp` / `ln` / `pow` / `tan` / `tanh`）只走
//!   [`libm`]，随机只走播种的 splitmix64（[`rng::Rng`]），FFT 是本 crate 自带的标量基 2 实现
//!   （旋转因子由 `libm` 算）。四则运算与 `sqrt` 是 IEEE 正确舍入，天然一致。不依赖
//!   `rustfft` / `realfft`：它们按 CPU 选 SIMD 路径（AVX / NEON），运算顺序随平台变，结果末位就不同；
//!   母带的响度增益又会把末位差放大到整条音频。代价是卷积慢几倍，离线渲染可以接受。
//!
//! 模块一览见各自文档：[`biquad`]（RBJ 双二阶 + Butterworth 级联）、[`tvlp`]（时变低通）、
//! [`osc`]（polyBLEP 振荡）、[`noise`]（有色噪声）、[`curve`]（关键帧与漂移曲线）、
//! [`reverb`]（合成脉冲响应 + FFT 分块卷积）、[`dynamics`]（块 RMS 跟随、activity 闪避、glue 压缩）、
//! [`loudness`]（BS.1770-4 积分响度 / LRA / 短期响度）、[`truepeak`]（4× 过采样真峰值与前瞻限幅）、
//! [`stereo`]（声像、淡入淡出、归一化）、[`resample`]（整段 sinc 重采样）、[`align`]（延迟与相位对齐）、[`master`]（母带链）。

pub mod align;
pub mod biquad;
pub mod curve;
pub mod dynamics;
pub mod fft;
pub mod loudness;
pub mod master;
pub mod math;
pub mod noise;
pub mod osc;
pub mod resample;
pub mod reverb;
pub mod rng;
pub mod stereo;
pub mod truepeak;
pub mod tvlp;

pub use rng::Rng;
pub use stereo::Stereo;

/// BaoCut 音频的缺省采样率。
pub const DEFAULT_RATE: f64 = 48_000.0;
