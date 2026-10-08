//! 本文件的部分实现参考 speech-swift（https://github.com/soniqo/speech-swift）。
//! 对应上游文件：`Sources/SpeechVAD/SileroModel.swift / Sources/SpeechVAD/SileroVAD.swift / Sources/SpeechVAD/SileroWeightLoading.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 以 Rust 实现相关算法，并适配本项目的后端、模型包与转写接口；原有上游来源说明保留。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! Silero VAD v6.2.1（candle，CPU），镜像 mlx 后端 `silero.rs`。
//!
//! STFT/编码器卷积按块批量执行；128 维 LSTMCell 与单神经元 decoder 在
//! host 侧顺序执行（模型仅 1.2 MB，逐块张量往返反而更慢）。

use std::path::Path;

use anyhow::{Context, Result, bail};
use candle_core::{DType, Device, Tensor};

use super::weights::WeightStore;
use crate::SAMPLE_RATE;
use crate::speech::vad_binarize::binarize_with_audio_len;
use crate::speech::{SpeechSegment, StreamingVad, VadConfig, VoiceActivityDetection};

pub const CHUNK_SIZE: usize = 512;
pub const CONTEXT_SIZE: usize = 64;
const LSTM_HIDDEN: usize = 128;
const LSTM_GATES: usize = 4 * LSTM_HIDDEN;

struct Conv1d {
    weight: Tensor,
    bias: Option<Tensor>,
    stride: usize,
    padding: usize,
}

impl Conv1d {
    fn forward(&self, input: &Tensor) -> Result<Tensor> {
        let output = input.conv1d(&self.weight, self.padding, self.stride, 1, 1)?;
        Ok(match &self.bias {
            Some(bias) => {
                let channels = bias.dim(0)?;
                output.broadcast_add(&bias.reshape((1, channels, 1))?)?
            }
            None => output,
        })
    }
}

pub struct SileroVad {
    stft: Conv1d,
    encoder: Vec<Conv1d>,
    lstm_wx_t: Tensor,
    lstm_bias: Tensor,
    /// host 侧 LSTM 循环权重，行主序 [4*hidden][hidden]。
    lstm_wh_host: Vec<f32>,
    decoder_weight_host: Vec<f32>,
    decoder_bias_host: f32,
    hidden: Option<[f32; LSTM_HIDDEN]>,
    cell: Option<[f32; LSTM_HIDDEN]>,
    context: [f32; CONTEXT_SIZE],
    config: VadConfig,
    device: Device,
}

impl SileroVad {
    /// 从列出的 safetensors 文件加载。任何一个权重没有用上都是错误：说明文件不是这个网络。
    pub fn load(files: &[&Path]) -> Result<Self> {
        // Silero 逐块顺序推理，GPU 无收益，固定用 CPU。
        let device = Device::Cpu;
        let mut store = WeightStore::load(files, &device)?;
        let stft = conv1d(&mut store, "stft", 128, 0, false)?;
        let encoder = vec![
            conv1d(&mut store, "encoder.0", 1, 1, true)?,
            conv1d(&mut store, "encoder.1", 2, 1, true)?,
            conv1d(&mut store, "encoder.2", 2, 1, true)?,
            conv1d(&mut store, "encoder.3", 1, 1, true)?,
        ];
        let lstm_wx = take_any_weight(&mut store, &["lstm.Wx", "lstm.wx"])?;
        let lstm_wh = take_any_weight(&mut store, &["lstm.Wh", "lstm.wh"])?;
        let lstm_bias = take_weight(&mut store, "lstm.bias")?;
        let decoder = conv1d(&mut store, "decoder", 1, 0, true)?;
        let unused = store.remaining();
        if !unused.is_empty() {
            bail!("unused Silero weights: {}", unused.join(", "));
        }

        let lstm_wh_host = host_f32(&lstm_wh)?;
        if lstm_wh_host.len() != LSTM_GATES * LSTM_HIDDEN {
            bail!("unexpected Silero LSTM Wh shape: {} elements", lstm_wh_host.len());
        }
        if decoder.weight.elem_count() != LSTM_HIDDEN {
            bail!("Silero decoder weight is not 128-dimensional");
        }
        let decoder_weight_host = host_f32(&decoder.weight)?;
        let decoder_bias_host = decoder
            .bias
            .as_ref()
            .map(host_f32)
            .transpose()?
            .and_then(|bias| bias.first().copied())
            .unwrap_or(0.0);

        Ok(Self {
            stft,
            encoder,
            lstm_wx_t: lstm_wx.t()?.contiguous()?,
            lstm_bias,
            lstm_wh_host,
            decoder_weight_host,
            decoder_bias_host,
            hidden: None,
            cell: None,
            context: [0.0; CONTEXT_SIZE],
            config: VadConfig::SILERO_DEFAULT,
            device,
        })
    }

    pub fn with_config(mut self, config: VadConfig) -> Self {
        self.config = config;
        self
    }

    /// 把 N 个完整块的 STFT+编码器+输入投影批量执行，返回
    /// [N, 4*hidden] 的门输入（已含 Wx 投影与偏置）。
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

        // NCL：[count, 1, window]。
        let mut x = Tensor::from_vec(stacked, (count, 1, window), &self.device)?;
        x = self.stft.forward(&x)?;
        let real = x.narrow(1, 0, 129)?;
        let imaginary = x.narrow(1, 129, 129)?;
        x = ((&real * &real)? + (&imaginary * &imaginary)?)?.sqrt()?;
        for convolution in &self.encoder {
            x = convolution.forward(&x)?.relu()?;
        }
        // [count, 128, 1] → [count, 128] → 投影到 [count, 512]。
        let flattened = x.reshape((count, LSTM_HIDDEN))?;
        let projected = flattened
            .matmul(&self.lstm_wx_t)?
            .broadcast_add(&self.lstm_bias.reshape((1, LSTM_GATES))?)?;
        Ok(projected.flatten_all()?.to_vec1::<f32>()?)
    }

    /// host 上执行单步 LSTMCell + decoder，返回语音概率。
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

fn host_f32(tensor: &Tensor) -> Result<Vec<f32>> {
    Ok(tensor.to_dtype(DType::F32)?.flatten_all()?.to_vec1()?)
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

fn conv1d(store: &mut WeightStore, prefix: &str, stride: usize, padding: usize, has_bias: bool) -> Result<Conv1d> {
    // MLX Conv1d 布局 [out, k, in] → candle [out, in, k]。
    let weight = take_weight(store, &format!("{prefix}.weight"))?.permute((0, 2, 1))?.contiguous()?;
    let bias = has_bias.then(|| take_weight(store, &format!("{prefix}.bias"))).transpose()?;
    Ok(Conv1d {
        weight,
        bias,
        stride,
        padding,
    })
}

fn take_weight(store: &mut WeightStore, key: &str) -> Result<Tensor> {
    if let Some(weight) = store.take_optional(key) {
        return Ok(weight.to_dtype(DType::F32)?);
    }
    let suffix = format!(".{key}");
    let matches = store
        .remaining()
        .into_iter()
        .filter(|candidate| candidate.ends_with(&suffix))
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [candidate] => Ok(store.take(candidate).context("key came from remaining()")?.to_dtype(DType::F32)?),
        [] => bail!("missing weight: {key}"),
        _ => bail!("ambiguous weight suffix: {key}"),
    }
}

fn take_any_weight(store: &mut WeightStore, keys: &[&str]) -> Result<Tensor> {
    for key in keys {
        if let Some(weight) = store.take_optional(key) {
            return Ok(weight.to_dtype(DType::F32)?);
        }
    }
    bail!("missing weight (candidates: {})", keys.join(", "))
}
