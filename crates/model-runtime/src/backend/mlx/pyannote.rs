//! Pyannote PyanNet 说话人分段（Apple Silicon / MLX）。移植自 v2 `bcut-speech` 的 `pyannote.rs`。
//!
//! v3 只改边界：权重按模型包清单取（`segmentation` 组件的 [`VerifiedFiles`]，声纹用 `speaker` 组件），不扫描目录；
//! 外加 [`DiarizerSlot`]：识别的模型包带了说话人区分时，任务里第一次要用才加载、任务结束放掉（同 v2：识别完成后才
//! 加载 Pyannote，用完即丢）。网络、解码与聚类原样保留。

use std::collections::HashMap;

use anyhow::{Context, Result, bail};
use mlx_rs::module::{Module, Param};
use mlx_rs::nn::{Conv1d, Linear, MaxPool1d};
use mlx_rs::ops::indexing::IndexOp;
use mlx_rs::{Array, ops, transforms};

use super::runtime::{self, MemoryCacheGuard, ModelMemoryCacheGuard, load_safetensors};
use super::wespeaker::WeSpeakerEmbedder;
use crate::bundle::{VerifiedBundle, VerifiedFiles};
use crate::protocol::ErrorBody;
use crate::speech::SpeakerDiarization;
use crate::speech::pyannote_common::{
    DiarizedSegment, FRAMES_PER_WINDOW, PyannoteCallbacks, PyannoteOptions, WINDOW_SAMPLES, argmax_classes, diarize_with,
};

const HIDDEN_SIZE: i32 = 128;
const LSTM_LAYERS: usize = 4;
const CLASS_COUNT: i32 = 7;

struct InstanceNorm {
    weight: Array,
    bias: Array,
}

impl InstanceNorm {
    fn load(weights: &mut HashMap<String, Array>, prefix: &str) -> Result<Self> {
        Ok(Self {
            weight: take(weights, &format!("{prefix}.weight"))?,
            bias: take(weights, &format!("{prefix}.bias"))?,
        })
    }

    fn forward(&self, input: &Array) -> Result<Array> {
        let mean = input.mean_axis(1, true)?;
        let variance = input.var_axis(1, true, None)?;
        let normalized = ops::multiply(
            ops::subtract(input, &mean)?,
            ops::rsqrt(ops::add(&variance, Array::from_f32(1e-5))?)?,
        )?;
        Ok(ops::add(ops::multiply(&normalized, &self.weight)?, &self.bias)?)
    }
}

struct SincNet {
    wav_norm: InstanceNorm,
    conv: Vec<Conv1d>,
    norm: Vec<InstanceNorm>,
    pool: MaxPool1d,
}

impl SincNet {
    fn load(weights: &mut HashMap<String, Array>) -> Result<Self> {
        let mut conv = Vec::new();
        for (index, stride) in [10, 1, 1].into_iter().enumerate() {
            conv.push(Conv1d {
                weight: Param::new(take(weights, &format!("sincnet.conv.{index}.weight"))?),
                bias: Param::new(weights.remove(&format!("sincnet.conv.{index}.bias"))),
                stride,
                padding: 0,
                dilation: 1,
                groups: 1,
            });
        }
        Ok(Self {
            wav_norm: InstanceNorm::load(weights, "sincnet.wav_norm")?,
            conv,
            norm: (0..3)
                .map(|index| InstanceNorm::load(weights, &format!("sincnet.norm.{index}")))
                .collect::<Result<Vec<_>>>()?,
            pool: MaxPool1d::new(3, 3),
        })
    }

    /// Input and output use MLX channels-last layout: `[batch, samples, 1]`
    /// to `[batch, frames, 60]`.
    fn forward(&mut self, input: &Array) -> Result<Array> {
        let mut hidden = self.wav_norm.forward(input)?;
        for index in 0..self.conv.len() {
            hidden = self.conv[index].forward(&hidden)?;
            if index == 0 {
                hidden = ops::abs(&hidden)?;
            }
            hidden = self.pool.forward(&hidden)?;
            hidden = self.norm[index].forward(&hidden)?;
            hidden = leaky_relu(&hidden)?;
        }
        Ok(hidden)
    }
}

struct LstmLayer {
    /// 预转置并求值的权重：MLX 的 `.t()` 是惰性的，放在时间步循环里会让每层每
    /// 方向重复构建 589 次转置算子节点。
    wx_t: Array,
    wh_t: Array,
    bias: Array,
}

impl LstmLayer {
    fn load(weights: &mut HashMap<String, Array>, prefix: &str) -> Result<Self> {
        let wx_t = take(weights, &format!("{prefix}.Wx"))?.t();
        let wh_t = take(weights, &format!("{prefix}.Wh"))?.t();
        transforms::eval([&wx_t, &wh_t])?;
        Ok(Self {
            wx_t,
            wh_t,
            bias: take(weights, &format!("{prefix}.bias"))?,
        })
    }

    fn forward(&self, input: &Array) -> Result<Array> {
        let batch = input.dim(0);
        let sequence = input.dim(1);
        let projected = ops::addmm(&self.bias, input, &self.wx_t, None, None)?;
        let mut hidden = Array::zeros::<f32>(&[batch, HIDDEN_SIZE])?;
        let mut cell = Array::zeros::<f32>(&[batch, HIDDEN_SIZE])?;
        let mut output = Vec::with_capacity(sequence as usize);
        for time in 0..sequence {
            let gates = ops::add(&projected.index((.., time, ..)), ops::matmul(&hidden, &self.wh_t)?)?;
            let parts = ops::split(&gates, 4, -1)?;
            let input_gate = ops::sigmoid(&parts[0])?;
            let forget_gate = ops::sigmoid(&parts[1])?;
            let candidate = ops::tanh(&parts[2])?;
            let output_gate = ops::sigmoid(&parts[3])?;
            cell = ops::add(ops::multiply(&forget_gate, &cell)?, ops::multiply(&input_gate, &candidate)?)?;
            hidden = ops::multiply(&output_gate, ops::tanh(&cell)?)?;
            output.push(hidden.clone());
        }
        Ok(ops::stack_axis(&output, 1)?)
    }
}

struct BiLstm {
    forward: Vec<LstmLayer>,
    backward: Vec<LstmLayer>,
}

impl BiLstm {
    fn load(weights: &mut HashMap<String, Array>) -> Result<Self> {
        Ok(Self {
            forward: (0..LSTM_LAYERS)
                .map(|index| LstmLayer::load(weights, &format!("lstm_fwd.layers.{index}")))
                .collect::<Result<Vec<_>>>()?,
            backward: (0..LSTM_LAYERS)
                .map(|index| LstmLayer::load(weights, &format!("lstm_bwd.layers.{index}")))
                .collect::<Result<Vec<_>>>()?,
        })
    }

    fn forward(&self, input: &Array) -> Result<Array> {
        let mut hidden = input.clone();
        for layer in 0..LSTM_LAYERS {
            let sequence = hidden.dim(1);
            let reverse_indices = (0..sequence).rev().map(|value| value as u32).collect::<Vec<_>>();
            let reverse_indices = Array::from_slice(&reverse_indices, &[sequence]);
            let forward = self.forward[layer].forward(&hidden)?;
            let reversed = hidden.take_axis(&reverse_indices, 1)?;
            let backward = self.backward[layer].forward(&reversed)?.take_axis(&reverse_indices, 1)?;
            hidden = ops::concatenate_axis(&[&forward, &backward], -1)?;
            transforms::eval([&hidden])?;
        }
        Ok(hidden)
    }
}

struct SegmentationNetwork {
    sincnet: SincNet,
    lstm: BiLstm,
    linear: Vec<Linear>,
    classifier: Linear,
    // Fields drop in declaration order: release weights before flushing their buffers.
    _memory_cache_guard: ModelMemoryCacheGuard,
}

impl SegmentationNetwork {
    fn load(files: &VerifiedFiles) -> Result<Self> {
        runtime::ensure_metal_device()?;
        let shards = files.require_extension_in("", "safetensors")?;
        // Also flush partially loaded weights on an early error.
        let memory_cache_guard = ModelMemoryCacheGuard;
        let mut weights = load_safetensors(&shards)?;
        let sincnet = SincNet::load(&mut weights)?;
        let lstm = BiLstm::load(&mut weights)?;
        let linear = (0..2)
            .map(|index| load_linear(&mut weights, &format!("linear.{index}")))
            .collect::<Result<Vec<_>>>()?;
        let classifier = load_linear(&mut weights, "classifier")?;
        if !weights.is_empty() {
            let mut unused = weights.keys().cloned().collect::<Vec<_>>();
            unused.sort();
            bail!("Pyannote 存在未使用权重：{}", unused.join("、"));
        }
        Ok(Self {
            sincnet,
            lstm,
            linear,
            classifier,
            _memory_cache_guard: memory_cache_guard,
        })
    }

    /// 返回每个窗口的原始 powerset logits（`FRAMES_PER_WINDOW * CLASS_COUNT`，
    /// 帧在外、类在内）。**这里刻意不做 argmax**：softmax、按说话人求和、迟滞
    /// 二值化全部交给 `pyannote_common`，两个后端共用同一份解码。
    pub(crate) fn frame_logits(&mut self, packed: &[f32], batch_size: usize) -> Result<Vec<Vec<f32>>> {
        let _cache_guard = MemoryCacheGuard::new();
        let batch = i32::try_from(batch_size).context("Pyannote batch 超出 i32")?;
        let samples = i32::try_from(WINDOW_SAMPLES).expect("固定窗口可装入 i32");
        let input = Array::from_slice(packed, &[batch, samples, 1]);
        let mut hidden = self.sincnet.forward(&input)?;
        hidden = self.lstm.forward(&hidden)?;
        for linear in &mut self.linear {
            hidden = leaky_relu(&linear.forward(&hidden)?)?;
        }
        let logits = self.classifier.forward(&hidden)?;
        if logits.shape() != [batch, FRAMES_PER_WINDOW as i32, CLASS_COUNT] {
            bail!("Pyannote 输出形状异常：{:?}", logits.shape());
        }
        logits.eval()?;
        Ok(logits
            .as_slice::<f32>()
            .chunks_exact(FRAMES_PER_WINDOW * CLASS_COUNT as usize)
            .map(<[f32]>::to_vec)
            .collect())
    }
}

pub struct PyannoteDiarizer {
    network: SegmentationNetwork,
    embedder: Option<WeSpeakerEmbedder>,
}

impl PyannoteDiarizer {
    /// 只加载分割模型；没有声纹阶段，全局身份退化为 IoU 链式传递。
    pub fn load(segmentation: &VerifiedFiles) -> Result<Self> {
        Ok(Self {
            network: SegmentationNetwork::load(segmentation)?,
            embedder: None,
        })
    }

    /// 同时加载 WeSpeaker 声纹模型，启用声纹再识别（推荐路径）。
    pub fn load_with_embedding(segmentation: &VerifiedFiles, speaker: &VerifiedFiles) -> Result<Self> {
        Ok(Self {
            network: SegmentationNetwork::load(segmentation)?,
            embedder: Some(WeSpeakerEmbedder::load(speaker)?),
        })
    }

    pub fn diarize_with(
        &mut self,
        samples: &[f32],
        options: &PyannoteOptions,
        callbacks: &mut PyannoteCallbacks<'_>,
    ) -> Result<Vec<DiarizedSegment>> {
        // 两个闭包分别可变借用不同字段，必须先解构 self。
        let Self { network, embedder } = self;
        let mut embed_fn;
        let embed: Option<&mut dyn FnMut(&[f32]) -> Option<Vec<f32>>> = match embedder.as_mut() {
            Some(model) => {
                embed_fn = |audio: &[f32]| model.embed(audio).ok();
                Some(&mut embed_fn)
            }
            None => None,
        };
        diarize_with(
            samples,
            options,
            callbacks,
            |packed, batch| network.frame_logits(packed, batch),
            embed,
        )
    }

    /// 跨后端对拍入口：一批窗口的原始 powerset logits（帧在外、类在内）。
    pub fn frame_logits(&mut self, packed: &[f32], batch_size: usize) -> Result<Vec<Vec<f32>>> {
        self.network.frame_logits(packed, batch_size)
    }

    /// 跨后端对拍入口：逐帧 powerset 胜出类别。**不参与实际解码**，只用于把
    /// 后端差异定位到网络层。
    pub fn class_ids(&mut self, packed: &[f32], batch_size: usize) -> Result<Vec<Vec<u8>>> {
        Ok(self
            .network
            .frame_logits(packed, batch_size)?
            .iter()
            .map(|logits| argmax_classes(logits))
            .collect())
    }
}

impl SpeakerDiarization for PyannoteDiarizer {
    fn diarize(
        &mut self,
        samples: &[f32],
        options: &PyannoteOptions,
        callbacks: &mut PyannoteCallbacks<'_>,
    ) -> Result<Vec<DiarizedSegment>> {
        self.diarize_with(samples, options, callbacks)
    }
}

/// 识别的模型包里的说话人区分（`segmentation` + 可选的 `speaker`）：加载模型包时只核对文件，任务里第一次要用时才加载，
/// 任务结束（[`DiarizerSlot::release`]）放掉。加载失败时同一任务不再重试。
pub struct DiarizerSlot {
    segmentation: Option<VerifiedFiles>,
    speaker: Option<VerifiedFiles>,
    loaded: Option<PyannoteDiarizer>,
    failed: bool,
}

impl DiarizerSlot {
    /// 按清单核对文件：缺文件是 `MODEL_NOT_INSTALLED`（不悄悄退回不区分说话人）。
    pub fn new(bundle: &VerifiedBundle) -> Result<Self, ErrorBody> {
        if let Some(files) = &bundle.segmentation {
            files.require_extension_in("", "safetensors")?;
            if let Some(speaker) = &bundle.speaker {
                speaker.require_extension_in("", "safetensors")?;
            }
        }
        Ok(Self {
            segmentation: bundle.segmentation.clone(),
            speaker: bundle.speaker.clone(),
            loaded: None,
            failed: false,
        })
    }

    pub fn available(&self) -> bool {
        self.segmentation.is_some()
    }

    pub fn get(&mut self) -> Option<&mut dyn SpeakerDiarization> {
        if self.loaded.is_none() && !self.failed {
            let segmentation = self.segmentation.as_ref()?;
            let loaded = match &self.speaker {
                Some(speaker) => PyannoteDiarizer::load_with_embedding(segmentation, speaker),
                None => PyannoteDiarizer::load(segmentation),
            };
            match loaded {
                Ok(diarizer) => self.loaded = Some(diarizer),
                Err(error) => {
                    eprintln!("[model-worker] loading the speaker diarization models failed: {error:#}");
                    self.failed = true;
                }
            }
        }
        self.loaded.as_mut().map(|diarizer| diarizer as &mut dyn SpeakerDiarization)
    }

    /// 放掉加载了的模型；返回这次是否真的放掉了（调用方据此清 MLX 缓存）。
    pub fn release(&mut self) -> bool {
        self.failed = false;
        self.loaded.take().is_some()
    }
}

fn load_linear(weights: &mut HashMap<String, Array>, prefix: &str) -> Result<Linear> {
    Ok(Linear {
        weight: Param::new(take(weights, &format!("{prefix}.weight"))?),
        bias: Param::new(Some(take(weights, &format!("{prefix}.bias"))?)),
    })
}

fn take(weights: &mut HashMap<String, Array>, key: &str) -> Result<Array> {
    weights.remove(key).with_context(|| format!("缺少 Pyannote 权重：{key}"))
}

fn leaky_relu(input: &Array) -> Result<Array> {
    Ok(ops::maximum(input, ops::multiply(input, Array::from_f32(0.01))?)?)
}
