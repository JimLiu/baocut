//! WeSpeaker ResNet34-LM 的后端无关部分：fbank 前端、网络形状常量、余弦距离。移植自 v2 `bcut-speech`。
//!
//! 与 `mel.rs` 的 Whisper 前端不同，说话人嵌入用的是 Kaldi 风格 fbank：
//! 预加重 0.97、Hamming 窗、HTK mel 刻度（fmin=20Hz）、自然对数、并在时间轴上
//! 做 CMN（逐 mel bin 减均值）。CMN 不可省——缺它会让所有嵌入互相塌缩。
//!
//! 这里全是纯 CPU f32 计算：MLX 后端（`backend::mlx::wespeaker`）用它，以后接上的其他后端共用同一份实现，
//! 避免前端参数在各后端各自漂移。

use std::sync::Arc;

use anyhow::{Context, Result};
use realfft::{RealFftPlanner, RealToComplex};

use super::mel::TimeMajorMelFeatures;

/// 模型只接受 16 kHz 单声道输入。
pub const SAMPLE_RATE: u32 = 16_000;
/// 嵌入维度。
pub const EMBEDDING_DIM: usize = 256;
/// 少于 0.5 秒的音频不做嵌入——统计池化在这种长度上不稳定。
pub const MINIMUM_SAMPLES: usize = 8_000;

/// fbank 帧长（样本）。
pub const N_FFT: usize = 400;
/// fbank 帧移（样本）。
pub const HOP_LENGTH: usize = 160;
/// fbank mel 通道数。
pub const N_MELS: usize = 80;

/// 统计池化（mean‖std）的输出维度：256 通道 × 10 频率 × 2。
pub const POOLING_OUTPUT_DIM: usize = 5_120;
/// 经过三次 stride=2 后频率轴 80 → 10。
pub const POOLED_FREQUENCY: usize = 10;

const PADDED_FFT: usize = 512;
const FREQUENCY_BINS: usize = PADDED_FFT / 2 + 1;
const MEL_MINIMUM_HERTZ: f32 = 20.0;
const PRE_EMPHASIS: f32 = 0.97;
/// vDSP 的 `vDSP_fft_zrip` 输出是标准 DFT 的两倍，功率因此差 4 倍。CMN 会把
/// 这个常数完全消掉，保留它只是为了和 Swift 参考实现逐值一致。
const VDSP_POWER_SCALE: f32 = 4.0;
const LOG_FLOOR: f32 = 1e-10;

/// WeSpeaker 的 80 维 log-mel fbank 前端（CPU，f32）。
pub struct WeSpeakerFbank {
    window: Vec<f32>,
    /// `[FREQUENCY_BINS * N_MELS]`，bin 主序，便于逐帧累加。
    filterbank: Vec<f32>,
    fft: Arc<dyn RealToComplex<f32>>,
}

impl std::fmt::Debug for WeSpeakerFbank {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WeSpeakerFbank")
            .field("n_fft", &N_FFT)
            .field("hop_length", &HOP_LENGTH)
            .field("n_mels", &N_MELS)
            .finish()
    }
}

impl Default for WeSpeakerFbank {
    fn default() -> Self {
        Self::new()
    }
}

impl WeSpeakerFbank {
    pub fn new() -> Self {
        // 对称 Hamming（分母 n_fft-1），与 pyannote/wespeaker 推理管线一致；
        // 不是 Kaldi 默认的 Povey 窗。
        let window = (0..N_FFT)
            .map(|index| 0.54 - 0.46 * (2.0 * std::f32::consts::PI * index as f32 / (N_FFT - 1) as f32).cos())
            .collect();
        Self {
            window,
            filterbank: make_htk_filterbank(),
            fft: RealFftPlanner::<f32>::new().plan_fft_forward(PADDED_FFT),
        }
    }

    /// 分析窗（用于测试与诊断）。
    pub fn window(&self) -> &[f32] {
        &self.window
    }

    /// HTK/Slaney 归一化滤波器组，`[bin][mel]` 行主序。
    pub fn filterbank(&self) -> &[f32] {
        &self.filterbank
    }

    /// 给定样本数下的帧数：反射填充两侧各 `n_fft/2` 后不丢最后一帧。
    pub fn frame_count(sample_count: usize) -> usize {
        if sample_count == 0 {
            return 0;
        }
        sample_count / HOP_LENGTH + 1
    }

    /// 提取 `[T, 80]` 时间主序特征（已做 CMN）。
    pub fn extract(&self, audio: &[f32]) -> Result<TimeMajorMelFeatures> {
        if audio.is_empty() {
            return Ok(TimeMajorMelFeatures {
                data: Vec::new(),
                mel_bins: N_MELS,
                time_frames: 0,
            });
        }
        let count = audio.len();

        // 1. 预加重 y[n] = x[n] - 0.97 * x[n-1]，首样本直通（照 Swift 参考）。
        let mut emphasized = vec![0.0_f32; count];
        emphasized[0] = audio[0];
        for index in 1..count {
            emphasized[index] = audio[index] - PRE_EMPHASIS * audio[index - 1];
        }

        // 2. 两侧各 n_fft/2 的反射填充。
        let pad_length = N_FFT / 2;
        let mut padded = vec![0.0_f32; pad_length + count + pad_length];
        for (index, target) in padded[..pad_length].iter_mut().enumerate() {
            *target = emphasized[(pad_length - index).min(count - 1)];
        }
        padded[pad_length..pad_length + count].copy_from_slice(&emphasized);
        for index in 0..pad_length {
            padded[pad_length + count + index] = emphasized[count.saturating_sub(2 + index)];
        }

        // 3~5. 帧化 → 加窗 → 补零到 512 做 rFFT → 功率谱。
        let frame_count = (padded.len() - N_FFT) / HOP_LENGTH + 1;
        debug_assert_eq!(frame_count, Self::frame_count(count));
        let mut padded_frame = vec![0.0_f32; PADDED_FFT];
        let mut spectrum = self.fft.make_output_vec();
        let mut scratch = self.fft.make_scratch_vec();
        let mut mel = vec![0.0_f32; frame_count * N_MELS];

        for frame in 0..frame_count {
            let start = frame * HOP_LENGTH;
            for index in 0..N_FFT {
                padded_frame[index] = padded[start + index] * self.window[index];
            }
            padded_frame[N_FFT..].fill(0.0);
            self.fft
                .process_with_scratch(&mut padded_frame, &mut spectrum, &mut scratch)
                .context("执行 WeSpeaker 512 点 real FFT")?;

            // 6. 三角滤波器组投影。
            let output_row = &mut mel[frame * N_MELS..(frame + 1) * N_MELS];
            for (bin, value) in spectrum.iter().enumerate() {
                let power = VDSP_POWER_SCALE * (value.re * value.re + value.im * value.im);
                let filter_row = &self.filterbank[bin * N_MELS..(bin + 1) * N_MELS];
                for mel_bin in 0..N_MELS {
                    output_row[mel_bin] += power * filter_row[mel_bin];
                }
            }
        }

        // 7. 自然对数（不是 Whisper 的 log10）。
        for value in mel.iter_mut() {
            *value = value.max(LOG_FLOOR).ln();
        }

        // 8. CMN：逐 mel bin 减去时间轴均值。
        cepstral_mean_normalize(&mut mel, frame_count, N_MELS);

        Ok(TimeMajorMelFeatures {
            data: mel,
            mel_bins: N_MELS,
            time_frames: frame_count,
        })
    }
}

/// HTK mel 刻度（2595·log10(1+hz/700)）、fmin=20Hz、fmax=8000Hz 的三角滤波器组，
/// 带 Slaney 面积归一 `2/(f[m+2]-f[m])`。
fn make_htk_filterbank() -> Vec<f32> {
    let hertz_to_mel = |hertz: f32| 2_595.0 * (1.0 + hertz / 700.0).log10();
    let mel_to_hertz = |mel: f32| 700.0 * (10.0_f32.powf(mel / 2_595.0) - 1.0);

    let maximum_hertz = SAMPLE_RATE as f32 / 2.0;
    let minimum_mel = hertz_to_mel(MEL_MINIMUM_HERTZ);
    let maximum_mel = hertz_to_mel(maximum_hertz);
    let point_count = N_MELS + 2;
    let step = (maximum_mel - minimum_mel) / (point_count - 1) as f32;
    let frequencies: Vec<f32> = (0..point_count)
        .map(|index| mel_to_hertz(minimum_mel + index as f32 * step))
        .collect();
    let differences: Vec<f32> = frequencies.windows(2).map(|pair| pair[1] - pair[0]).collect();

    let mut matrix = vec![0.0_f32; FREQUENCY_BINS * N_MELS];
    for bin in 0..FREQUENCY_BINS {
        let hertz = bin as f32 * SAMPLE_RATE as f32 / PADDED_FFT as f32;
        for mel in 0..N_MELS {
            let rising = (hertz - frequencies[mel]) / differences[mel];
            let falling = (frequencies[mel + 2] - hertz) / differences[mel + 1];
            let normalization = 2.0 / (frequencies[mel + 2] - frequencies[mel]);
            matrix[bin * N_MELS + mel] = rising.min(falling).max(0.0) * normalization;
        }
    }
    matrix
}

fn cepstral_mean_normalize(features: &mut [f32], frame_count: usize, bin_count: usize) {
    if frame_count == 0 || bin_count == 0 {
        return;
    }
    let mut means = vec![0.0_f64; bin_count];
    for frame in 0..frame_count {
        let row = &features[frame * bin_count..(frame + 1) * bin_count];
        for (bin, value) in row.iter().enumerate() {
            means[bin] += f64::from(*value);
        }
    }
    let scale = frame_count as f64;
    let means: Vec<f32> = means.iter().map(|sum| (sum / scale) as f32).collect();
    for frame in 0..frame_count {
        let row = &mut features[frame * bin_count..(frame + 1) * bin_count];
        for (bin, value) in row.iter_mut().enumerate() {
            *value -= means[bin];
        }
    }
}

/// ResNet34 主干的层规划：`(层号, 输入通道, 输出通道, BasicBlock 数)`。
/// 每层第一个 block 在通道变化时 stride=2，同时下采样频率与时间轴。
pub const RESNET_PLAN: [(usize, usize, usize, usize); 4] = [(1, 32, 32, 3), (2, 32, 64, 4), (3, 64, 128, 6), (4, 128, 256, 3)];

/// 余弦距离 `1 - cos(a, b)`。长度不符、为空或范数过小时返回 2.0（最大距离）。
pub fn cosine_distance(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 2.0;
    }
    let mut dot = 0.0_f64;
    let mut left = 0.0_f64;
    let mut right = 0.0_f64;
    for (x, y) in a.iter().zip(b) {
        dot += f64::from(*x) * f64::from(*y);
        left += f64::from(*x) * f64::from(*x);
        right += f64::from(*y) * f64::from(*y);
    }
    let denominator = left.sqrt() * right.sqrt();
    if denominator <= 1e-10 {
        return 2.0;
    }
    (1.0 - dot / denominator) as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_count_matches_reflect_padded_framing() {
        assert_eq!(WeSpeakerFbank::frame_count(16_000), 101);
        assert_eq!(WeSpeakerFbank::frame_count(8_000), 51);
        assert_eq!(WeSpeakerFbank::frame_count(0), 0);
    }

    #[test]
    fn cosine_distance_handles_degenerate_inputs() {
        assert_eq!(cosine_distance(&[1.0, 0.0], &[1.0, 0.0, 0.0]), 2.0);
        assert_eq!(cosine_distance(&[], &[]), 2.0);
        assert_eq!(cosine_distance(&[0.0, 0.0], &[1.0, 0.0]), 2.0);
        assert!((cosine_distance(&[1.0, 0.0], &[1.0, 0.0])).abs() < 1e-6);
        assert!((cosine_distance(&[1.0, 0.0], &[-1.0, 0.0]) - 2.0).abs() < 1e-6);
    }

    // ---- 以下两个移植自 v2 `bcut-speech/tests/frontend.rs` ----

    fn assert_close(actual: f32, expected: f32, tolerance: f32) {
        assert!((actual - expected).abs() <= tolerance, "{actual} != {expected} ± {tolerance}");
    }

    /// 确定性伪随机测试音频（线性同余），与 golden 参考脚本逐位一致。
    fn pseudo_random_audio(count: usize) -> Vec<f32> {
        let mut state = 12_345_u32;
        (0..count)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (state >> 8) as f32 / 8_388_608.0 - 1.0
            })
            .collect()
    }

    #[test]
    fn wespeaker_fbank_matches_kaldi_reference() -> Result<()> {
        let fbank = WeSpeakerFbank::new();

        // 对称 Hamming（分母 399）：端点 0.08，中点接近 1。
        let window = fbank.window();
        assert_eq!(window.len(), 400);
        assert_close(window[0], 0.08, 1e-6);
        assert_close(window[399], 0.08, 1e-6);
        assert_close(window[199], 0.999_985_8, 1e-6);

        let audio = pseudo_random_audio(16_000);
        assert_close(audio[0], -0.959_194_66, 1e-6);

        let features = fbank.extract(&audio)?;
        // 反射填充两侧各 200 后不丢最后一帧：(16000+400-400)/160+1 = 101。
        assert_eq!(features.time_frames, 101);
        assert_eq!(features.mel_bins, 80);
        assert_eq!(features.data.len(), 101 * 80);
        assert_eq!(WeSpeakerFbank::frame_count(16_000), 101);

        // CMN 之后每个 mel bin 在时间轴上的均值必须为 0。
        for bin in 0..80 {
            let mean = (0..features.time_frames).map(|frame| features.data[frame * 80 + bin]).sum::<f32>() / features.time_frames as f32;
            assert!(mean.abs() < 1e-4, "bin {bin} 的 CMN 残余均值 {mean}");
        }

        // NumPy 独立参考实现（预加重 0.97 / Hamming / HTK mel fmin=20 / ln / CMN）。
        let times = [0_usize, 1, 5, 50, 100];
        let bins = [0_usize, 1, 7, 20, 40, 79];
        let expected = [
            3.558_4, 3.352, 1.292_831, 0.522_167, -1.033_338, -0.984_262, //
            1.155_988, 1.757_882, 0.931_735, 1.031_609, -1.717_376, 0.018_180, //
            -0.695_208, -1.849_046, 0.983_913, 0.645_739, -0.315_347, 0.304_023, //
            -0.256_786, -2.299_857, 0.990_178, -0.577_879, 0.708_347, -0.221_042, //
            1.753_836, 1.016_739, 1.177_642, -2.237_659, 0.229_697, 0.135_222,
        ];
        let mut index = 0;
        for time in times {
            for bin in bins {
                assert_close(features.data[time * 80 + bin], expected[index], 1e-3);
                index += 1;
            }
        }
        assert_eq!(index, expected.len());
        Ok(())
    }

    #[test]
    fn wespeaker_cosine_distance_is_scale_invariant() {
        let a = [0.6_f32, 0.8, 0.0];
        let scaled = [6.0_f32, 8.0, 0.0];
        assert!(cosine_distance(&a, &scaled).abs() < 1e-6);
        assert!((cosine_distance(&a, &[0.8, -0.6, 0.0]) - 1.0).abs() < 1e-6);
        assert_eq!(cosine_distance(&a, &[0.0, 0.0]), 2.0);
        assert_eq!(cosine_distance(&a, &[0.0, 0.0, 0.0]), 2.0);
    }
}
