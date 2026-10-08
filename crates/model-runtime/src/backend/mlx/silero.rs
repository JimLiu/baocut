//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/SpeechVAD/SileroModel.swift / Sources/SpeechVAD/SileroVAD.swift / Sources/SpeechVAD/SileroWeightLoading.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Silero VAD v6.2.1 的流式网络（MLX）。
//!
//! 转写流水线只用流式接口（[`StreamingVad`]）；整段检测（[`VoiceActivityDetection`]、`with_config`）移植自 v2，
//! 供配音的声学定时等批次使用，转写路径不经过它。

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result, bail};
use mlx_rs::module::{Module, Param};
use mlx_rs::nn::{Conv1d, relu};
use mlx_rs::ops;
use mlx_rs::ops::indexing::IndexOp;
use mlx_rs::{Array, transforms};

use super::runtime::{ModelMemoryCacheGuard, ensure_metal_device, load_safetensors};
use crate::SAMPLE_RATE;
use crate::speech::vad_binarize::binarize_with_audio_len;
use crate::speech::{SpeechSegment, StreamingVad, VadConfig, VoiceActivityDetection};

pub const CHUNK_SIZE: usize = 512;
pub const CONTEXT_SIZE: usize = 64;
const LSTM_HIDDEN: usize = 128;
const LSTM_GATES: usize = 4 * LSTM_HIDDEN;

/// Silero v6.2.1 的流式网络。
///
/// STFT/编码器卷积批量跑在 MLX/GPU 上（整块一次 eval），128 维 LSTMCell 与
/// 单神经元 decoder 在 CPU 上顺序执行——逐 32ms 块做 GPU 同步的旧实现每次
/// `try_item` 都要等 Metal 往返,175s 音频要 5000+ 次同步,占了 VAD 阶段的
/// 绝大部分时间。
pub struct SileroVad {
    stft: Conv1d,
    encoder: Vec<Conv1d>,
    lstm_wx: Array,
    lstm_bias: Array,
    /// CPU 侧 LSTM 循环权重,行主序 [4*hidden][hidden]。
    lstm_wh_host: Vec<f32>,
    decoder_weight_host: Vec<f32>,
    decoder_bias_host: f32,
    hidden: Option<[f32; LSTM_HIDDEN]>,
    cell: Option<[f32; LSTM_HIDDEN]>,
    context: [f32; CONTEXT_SIZE],
    /// 只给整段检测（[`VoiceActivityDetection`]）用；流式接口不看它。
    config: VadConfig,
    // Fields drop in declaration order: release weights before flushing their buffers.
    _memory_cache_guard: ModelMemoryCacheGuard,
}

impl SileroVad {
    /// 从列出的 safetensors 文件加载。任何一个权重没有用上都是错误：说明文件不是这个网络。
    pub fn load(files: &[&Path]) -> Result<Self> {
        ensure_metal_device()?;
        // 加载中途出错时也要清掉已读入的权重。
        let memory_cache_guard = ModelMemoryCacheGuard;
        let mut weights = load_safetensors(files)?;
        let stft = conv1d(&mut weights, "stft", 128, 0, false)?;
        let encoder = vec![
            conv1d(&mut weights, "encoder.0", 1, 1, true)?,
            conv1d(&mut weights, "encoder.1", 2, 1, true)?,
            conv1d(&mut weights, "encoder.2", 2, 1, true)?,
            conv1d(&mut weights, "encoder.3", 1, 1, true)?,
        ];
        let lstm_wx = take_any_weight(&mut weights, &["lstm.Wx", "lstm.wx"])?;
        let lstm_wh = take_any_weight(&mut weights, &["lstm.Wh", "lstm.wh"])?;
        let lstm_bias = take_weight(&mut weights, "lstm.bias")?;
        let decoder = conv1d(&mut weights, "decoder", 1, 0, true)?;
        if !weights.is_empty() {
            let mut unused = weights.keys().cloned().collect::<Vec<_>>();
            unused.sort();
            bail!("unused Silero weights: {}", unused.join(", "));
        }

        let lstm_wh_host = host_f32(&lstm_wh)?;
        if lstm_wh_host.len() != LSTM_GATES * LSTM_HIDDEN {
            bail!("unexpected Silero LSTM Wh shape: {} elements", lstm_wh_host.len());
        }
        let decoder_weight = decoder
            .weight
            .as_ref()
            .reshape(&[LSTM_HIDDEN as i32])
            .context("Silero decoder weight is not 128-dimensional")?;
        let decoder_weight_host = host_f32(&decoder_weight)?;
        let decoder_bias_host = decoder
            .bias
            .as_ref()
            .as_ref()
            .map(host_f32)
            .transpose()?
            .and_then(|bias| bias.first().copied())
            .unwrap_or(0.0);

        Ok(Self {
            stft,
            encoder,
            lstm_wx,
            lstm_bias,
            lstm_wh_host,
            decoder_weight_host,
            decoder_bias_host,
            hidden: None,
            cell: None,
            context: [0.0; CONTEXT_SIZE],
            config: VadConfig::SILERO_DEFAULT,
            _memory_cache_guard: memory_cache_guard,
        })
    }

    pub fn with_config(mut self, config: VadConfig) -> Self {
        self.config = config;
        self
    }

    /// 把 N 个完整块的 STFT+编码器+输入投影批量跑在 GPU 上,返回
    /// [N, 4*hidden] 的门输入(已含 Wx 投影与偏置)。
    fn projected_gates(&mut self, chunks: &[f32], count: usize) -> Result<Vec<f32>> {
        let window = CONTEXT_SIZE + CHUNK_SIZE + CONTEXT_SIZE;
        let mut stacked = Vec::with_capacity(count * window);
        for index in 0..count {
            let chunk = &chunks[index * CHUNK_SIZE..(index + 1) * CHUNK_SIZE];
            let mut full = [0.0_f32; CONTEXT_SIZE + CHUNK_SIZE];
            full[..CONTEXT_SIZE].copy_from_slice(&self.context);
            full[CONTEXT_SIZE..].copy_from_slice(chunk);
            self.context.copy_from_slice(&chunk[CHUNK_SIZE - CONTEXT_SIZE..]);
            stacked.extend_from_slice(&full);
            // 与参考实现一致的“镜像”尾部：full[574]、full[573]、…、full[511]。
            for offset in 0..CONTEXT_SIZE {
                stacked.push(full[full.len() - 2 - offset]);
            }
        }

        let mut x = Array::from_slice(&stacked, &[count as i32, window as i32]).expand_dims(-1)?;
        x = self.stft.forward(&x)?;
        let real = x.index((.., .., 0..129));
        let imaginary = x.index((.., .., 129..258));
        x = (&real * &real + &imaginary * &imaginary).sqrt()?;
        for convolution in &mut self.encoder {
            x = relu(convolution.forward(&x)?)?;
        }
        let projected = ops::addmm(&self.lstm_bias, &x, self.lstm_wx.t(), None, None)?
            .reshape(&[count as i32, LSTM_GATES as i32])?
            .as_dtype(mlx_rs::Dtype::Float32)?;
        transforms::eval(std::iter::once(&projected))?;
        Ok(projected.as_slice::<f32>().to_vec())
    }

    /// CPU 上执行单步 LSTMCell + decoder,返回语音概率。
    fn lstm_step(&mut self, gates_in: &[f32]) -> f32 {
        let mut gates = [0.0_f32; LSTM_GATES];
        gates.copy_from_slice(gates_in);
        if let Some(hidden) = &self.hidden {
            for (row, gate) in gates.iter_mut().enumerate() {
                let weights = &self.lstm_wh_host[row * LSTM_HIDDEN..(row + 1) * LSTM_HIDDEN];
                let mut acc = 0.0_f32;
                for (weight, state) in weights.iter().zip(hidden.iter()) {
                    acc += weight * state;
                }
                *gate += acc;
            }
        }
        let mut next_hidden = [0.0_f32; LSTM_HIDDEN];
        let mut next_cell = [0.0_f32; LSTM_HIDDEN];
        for index in 0..LSTM_HIDDEN {
            let input_gate = sigmoid(gates[index]);
            let forget_gate = sigmoid(gates[LSTM_HIDDEN + index]);
            let candidate = gates[2 * LSTM_HIDDEN + index].tanh();
            let output_gate = sigmoid(gates[3 * LSTM_HIDDEN + index]);
            let cell = match &self.cell {
                Some(previous) => forget_gate * previous[index] + input_gate * candidate,
                None => input_gate * candidate,
            };
            next_cell[index] = cell;
            next_hidden[index] = output_gate * cell.tanh();
        }
        let mut logit = self.decoder_bias_host;
        for (weight, state) in self.decoder_weight_host.iter().zip(next_hidden.iter()) {
            logit += weight * state.max(0.0);
        }
        self.hidden = Some(next_hidden);
        self.cell = Some(next_cell);
        sigmoid(logit).clamp(0.0, 1.0)
    }
}

fn sigmoid(value: f32) -> f32 {
    1.0 / (1.0 + (-value).exp())
}

fn host_f32(array: &Array) -> Result<Vec<f32>> {
    let array = array.as_dtype(mlx_rs::Dtype::Float32)?;
    array.eval()?;
    Ok(array.as_slice::<f32>().to_vec())
}

impl StreamingVad for SileroVad {
    fn chunk_size(&self) -> usize {
        CHUNK_SIZE
    }

    fn process_chunk(&mut self, samples: &[f32]) -> Result<f32> {
        if samples.len() != CHUNK_SIZE {
            bail!("a Silero chunk must be {CHUNK_SIZE} samples, got {}", samples.len());
        }
        Ok(self.process_chunks(samples)?[0])
    }

    fn process_chunks(&mut self, samples: &[f32]) -> Result<Vec<f32>> {
        if !samples.len().is_multiple_of(CHUNK_SIZE) {
            bail!(
                "Silero batch input must be a multiple of {CHUNK_SIZE} samples, got {}",
                samples.len()
            );
        }
        let count = samples.len() / CHUNK_SIZE;
        if count == 0 {
            return Ok(Vec::new());
        }
        let projected = self.projected_gates(samples, count)?;
        Ok(projected.chunks(LSTM_GATES).map(|gates| self.lstm_step(gates)).collect())
    }

    fn reset_state(&mut self) {
        self.hidden = None;
        self.cell = None;
        self.context.fill(0.0);
    }
}

impl VoiceActivityDetection for SileroVad {
    fn detect_speech(&mut self, audio: &[f32]) -> Result<Vec<SpeechSegment>> {
        self.reset_state();
        let complete = audio.len() / CHUNK_SIZE * CHUNK_SIZE;
        let mut probabilities = self.process_chunks(&audio[..complete])?;
        if complete < audio.len() {
            let mut padded = [0.0_f32; CHUNK_SIZE];
            padded[..audio.len() - complete].copy_from_slice(&audio[complete..]);
            probabilities.push(self.process_chunk(&padded)?);
        }
        if probabilities.is_empty() {
            return Ok(Vec::new());
        }
        let mut config = self.config;
        config.window_duration = probabilities.len() as f32 * CHUNK_SIZE as f32 / SAMPLE_RATE as f32;
        config.step_ratio = 1.0 / probabilities.len() as f32;
        Ok(binarize_with_audio_len(&probabilities, config, audio.len(), SAMPLE_RATE))
    }
}

fn conv1d(weights: &mut HashMap<String, Array>, prefix: &str, stride: i32, padding: i32, has_bias: bool) -> Result<Conv1d> {
    let weight = take_weight(weights, &format!("{prefix}.weight"))?;
    let bias = has_bias.then(|| take_weight(weights, &format!("{prefix}.bias"))).transpose()?;
    Ok(Conv1d {
        weight: Param::new(weight),
        bias: Param::new(bias),
        stride,
        padding,
        dilation: 1,
        groups: 1,
    })
}

fn take_weight(weights: &mut HashMap<String, Array>, key: &str) -> Result<Array> {
    if let Some(weight) = weights.remove(key) {
        return Ok(weight);
    }
    let suffix = format!(".{key}");
    let matches = weights
        .keys()
        .filter(|candidate| candidate.ends_with(&suffix))
        .cloned()
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [candidate] => Ok(weights.remove(candidate).expect("key came from map")),
        [] => bail!("missing weight: {key}"),
        _ => bail!("ambiguous weight suffix: {key}"),
    }
}

fn take_any_weight(weights: &mut HashMap<String, Array>, keys: &[&str]) -> Result<Array> {
    for key in keys {
        if let Some(weight) = weights.remove(*key) {
            return Ok(weight);
        }
    }
    bail!("missing weight (candidates: {})", keys.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_files_that_are_not_silero() {
        let _lock = super::super::runtime::MLX_TEST_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if ensure_metal_device().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.safetensors");
        let value = Array::from_slice(&[1.0_f32, 2.0], &[2]);
        Array::save_safetensors([("stft.weight", &value), ("extra.weight", &value)], None, &path).unwrap();
        assert!(SileroVad::load(&[path.as_path()]).is_err());
    }
}
