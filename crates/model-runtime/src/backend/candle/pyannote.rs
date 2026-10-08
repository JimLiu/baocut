//! Pyannote PyanNet 说话人分段（跨平台 candle 后端）。移植自 v2 `bcut-speech` 的 `candle_backend/pyannote.rs`。
//!
//! v3 只改边界（同 MLX）：权重按模型包清单取（`segmentation` / `speaker` 组件的 [`VerifiedFiles`]），设备取模型包的
//! 设备；外加 [`DiarizerSlot`]，任务里第一次要用时才加载、任务结束放掉。网络、解码与聚类原样保留。

use anyhow::{Result, bail};
use candle_core::{Device, IndexOp, Tensor};

use super::weights::WeightStore;
use super::wespeaker::WeSpeakerEmbedder;
use crate::bundle::{VerifiedBundle, VerifiedFiles};
use crate::protocol::ErrorBody;
use crate::speech::SpeakerDiarization;
use crate::speech::pyannote_common::{
    DiarizedSegment, FRAMES_PER_WINDOW, PyannoteCallbacks, PyannoteOptions, WINDOW_SAMPLES, argmax_classes, diarize_with,
};

const HIDDEN_SIZE: usize = 128;
const LSTM_LAYERS: usize = 4;
const CLASS_COUNT: usize = 7;

struct InstanceNorm {
    weight: Tensor,
    bias: Tensor,
}

impl InstanceNorm {
    fn load(store: &mut WeightStore, prefix: &str) -> Result<Self> {
        Ok(Self {
            weight: store.take_f32(&format!("{prefix}.weight"))?,
            bias: store.take_f32(&format!("{prefix}.bias"))?,
        })
    }

    /// Candle convolution uses `[batch, channels, time]`; normalize time.
    fn forward(&self, input: &Tensor) -> Result<Tensor> {
        let mean = input.mean_keepdim(2)?;
        let centered = input.broadcast_sub(&mean)?;
        let variance = centered.sqr()?.mean_keepdim(2)?;
        let normalized = centered.broadcast_div(&(variance + 1e-5)?.sqrt()?)?;
        let weight = self.weight.reshape((1, self.weight.elem_count(), 1))?;
        let bias = self.bias.reshape((1, self.bias.elem_count(), 1))?;
        Ok(normalized.broadcast_mul(&weight)?.broadcast_add(&bias)?)
    }
}

struct Conv1d {
    weight: Tensor,
    bias: Option<Tensor>,
    stride: usize,
}

impl Conv1d {
    fn load(store: &mut WeightStore, prefix: &str, stride: usize) -> Result<Self> {
        // Checkpoint/MLX layout `[out, kernel, in]` → candle `[out, in, kernel]`。
        // `contiguous()` 是**正确性**要求，不是性能优化：candle 0.11 的 CPU
        // `conv1d`（`cpu_backend/mod.rs:2753`）走 im2col 路径时，如果 kernel 布局
        // 非连续，会分配 `kernel_c` 并把权重整理进去，却仍然把**原始的非连续
        // `kernel`** 传给 `matmul`，且附上一个声称连续的 layout——那份拷贝是死代码。
        // 结果就是按 `[out, kernel, in]` 的原始字节当成 `[out, in, kernel]` 用。
        // conv.0 的 `in == 1`，两种布局字节相同所以看不出来；conv.1/conv.2
        // （in=80/60、kernel=5）会被静默读错。删掉这个 `contiguous()` 会让分割网络
        // 与 MLX 出现 156/589 帧的类别分歧。
        Ok(Self {
            weight: store.take_f32(&format!("{prefix}.weight"))?.permute((0, 2, 1))?.contiguous()?,
            bias: store.take_optional_f32(&format!("{prefix}.bias"))?,
            stride,
        })
    }

    fn forward(&self, input: &Tensor) -> Result<Tensor> {
        let output = input.conv1d(&self.weight, 0, self.stride, 1, 1)?;
        match &self.bias {
            Some(bias) => Ok(output.broadcast_add(&bias.reshape((1, bias.elem_count(), 1))?)?),
            None => Ok(output),
        }
    }
}

struct SincNet {
    wav_norm: InstanceNorm,
    conv: Vec<Conv1d>,
    norm: Vec<InstanceNorm>,
}

impl SincNet {
    fn load(store: &mut WeightStore) -> Result<Self> {
        Ok(Self {
            wav_norm: InstanceNorm::load(store, "sincnet.wav_norm")?,
            conv: [10, 1, 1]
                .into_iter()
                .enumerate()
                .map(|(index, stride)| Conv1d::load(store, &format!("sincnet.conv.{index}"), stride))
                .collect::<Result<Vec<_>>>()?,
            norm: (0..3)
                .map(|index| InstanceNorm::load(store, &format!("sincnet.norm.{index}")))
                .collect::<Result<Vec<_>>>()?,
        })
    }

    fn forward(&self, input: &Tensor) -> Result<Tensor> {
        let mut hidden = self.wav_norm.forward(input)?;
        for index in 0..self.conv.len() {
            hidden = self.conv[index].forward(&hidden)?;
            if index == 0 {
                hidden = hidden.abs()?;
            }
            hidden = hidden.unfold(2, 3, 3)?.max(3)?;
            hidden = self.norm[index].forward(&hidden)?;
            hidden = leaky_relu(&hidden)?;
        }
        // `[batch, channels, frames]` → `[batch, frames, channels]`.
        Ok(hidden.transpose(1, 2)?)
    }
}

struct LstmLayer {
    /// 加载期就转置并 `contiguous`：`.t()` 产出的是非连续视图，放在 589 步的
    /// 时间步循环里等于每步重做一次布局整理。
    wx_t: Tensor,
    wh_t: Tensor,
    bias: Tensor,
}

impl LstmLayer {
    fn load(store: &mut WeightStore, prefix: &str) -> Result<Self> {
        Ok(Self {
            wx_t: store.take_f32(&format!("{prefix}.Wx"))?.t()?.contiguous()?,
            wh_t: store.take_f32(&format!("{prefix}.Wh"))?.t()?.contiguous()?,
            bias: store.take_f32(&format!("{prefix}.bias"))?,
        })
    }

    fn forward(&self, input: &Tensor) -> Result<Tensor> {
        let (batch, sequence, _) = input.dims3()?;
        let projected = input
            .broadcast_matmul(&self.wx_t)?
            .broadcast_add(&self.bias.reshape((1, 1, 4 * HIDDEN_SIZE))?)?;
        let mut hidden = Tensor::zeros((batch, HIDDEN_SIZE), input.dtype(), input.device())?;
        let mut cell = Tensor::zeros((batch, HIDDEN_SIZE), input.dtype(), input.device())?;
        let mut output = Vec::with_capacity(sequence);
        for time in 0..sequence {
            let gates = (projected.i((.., time, ..))? + hidden.matmul(&self.wh_t)?)?;
            let parts = gates.chunk(4, 1)?;
            let input_gate = candle_nn::ops::sigmoid(&parts[0])?;
            let forget_gate = candle_nn::ops::sigmoid(&parts[1])?;
            let candidate = parts[2].tanh()?;
            let output_gate = candle_nn::ops::sigmoid(&parts[3])?;
            cell = ((&forget_gate * &cell)? + (&input_gate * &candidate)?)?;
            hidden = (&output_gate * cell.tanh()?)?;
            output.push(hidden.clone());
        }
        Ok(Tensor::stack(&output, 1)?)
    }
}

struct BiLstm {
    forward: Vec<LstmLayer>,
    backward: Vec<LstmLayer>,
}

impl BiLstm {
    fn load(store: &mut WeightStore) -> Result<Self> {
        Ok(Self {
            forward: (0..LSTM_LAYERS)
                .map(|index| LstmLayer::load(store, &format!("lstm_fwd.layers.{index}")))
                .collect::<Result<Vec<_>>>()?,
            backward: (0..LSTM_LAYERS)
                .map(|index| LstmLayer::load(store, &format!("lstm_bwd.layers.{index}")))
                .collect::<Result<Vec<_>>>()?,
        })
    }

    fn forward(&self, input: &Tensor) -> Result<Tensor> {
        let mut hidden = input.clone();
        for layer in 0..LSTM_LAYERS {
            let forward = self.forward[layer].forward(&hidden)?;
            let reversed = hidden.contiguous()?.flip(&[1])?;
            let backward = self.backward[layer].forward(&reversed)?.contiguous()?.flip(&[1])?;
            hidden = Tensor::cat(&[forward, backward], 2)?;
        }
        Ok(hidden)
    }
}

struct Linear {
    weight: Tensor,
    bias: Tensor,
}

impl Linear {
    fn load(store: &mut WeightStore, prefix: &str) -> Result<Self> {
        Ok(Self {
            weight: store.take_f32(&format!("{prefix}.weight"))?,
            bias: store.take_f32(&format!("{prefix}.bias"))?,
        })
    }

    fn forward(&self, input: &Tensor) -> Result<Tensor> {
        Ok(input.broadcast_matmul(&self.weight.t()?.contiguous()?)?.broadcast_add(&self.bias)?)
    }
}

struct SegmentationNetwork {
    device: Device,
    sincnet: SincNet,
    lstm: BiLstm,
    linear: Vec<Linear>,
    classifier: Linear,
}

impl SegmentationNetwork {
    fn load(files: &VerifiedFiles, device: &Device) -> Result<Self> {
        let device = device.clone();
        let shards = files.require_extension_in("", "safetensors")?;
        let mut store = WeightStore::load(&shards, &device)?;
        let sincnet = SincNet::load(&mut store)?;
        let lstm = BiLstm::load(&mut store)?;
        let linear = (0..2)
            .map(|index| Linear::load(&mut store, &format!("linear.{index}")))
            .collect::<Result<Vec<_>>>()?;
        let classifier = Linear::load(&mut store, "classifier")?;
        let unused = store.remaining();
        if !unused.is_empty() {
            bail!("Pyannote 存在未使用权重：{}", unused.join("、"));
        }
        Ok(Self {
            device,
            sincnet,
            lstm,
            linear,
            classifier,
        })
    }

    /// 返回每个窗口的原始 powerset logits（`FRAMES_PER_WINDOW * CLASS_COUNT`，
    /// 帧在外、类在内）。**这里刻意不做 argmax**：softmax、按说话人求和、迟滞
    /// 二值化全部交给 `pyannote_common`，两个后端共用同一份解码。
    pub(crate) fn frame_logits(&self, packed: &[f32], batch_size: usize) -> Result<Vec<Vec<f32>>> {
        let input = Tensor::from_slice(packed, (batch_size, 1, WINDOW_SAMPLES), &self.device)?;
        let mut hidden = self.sincnet.forward(&input)?;
        hidden = self.lstm.forward(&hidden)?;
        for linear in &self.linear {
            hidden = leaky_relu(&linear.forward(&hidden)?)?;
        }
        let logits = self.classifier.forward(&hidden)?;
        if logits.dims() != [batch_size, FRAMES_PER_WINDOW, CLASS_COUNT] {
            bail!("Pyannote 输出形状异常：{:?}", logits.dims());
        }
        let values = logits.flatten_all()?.to_vec1::<f32>()?;
        Ok(values.chunks_exact(FRAMES_PER_WINDOW * CLASS_COUNT).map(<[f32]>::to_vec).collect())
    }
}

pub struct PyannoteDiarizer {
    network: SegmentationNetwork,
    embedder: Option<WeSpeakerEmbedder>,
}

impl PyannoteDiarizer {
    /// 只加载分割模型；没有声纹阶段，全局身份退化为 IoU 链式传递。
    pub fn load(segmentation: &VerifiedFiles, device: &Device) -> Result<Self> {
        Ok(Self {
            network: SegmentationNetwork::load(segmentation, device)?,
            embedder: None,
        })
    }

    /// 同时加载 WeSpeaker 声纹模型，启用声纹再识别（推荐路径）。
    pub fn load_with_embedding(segmentation: &VerifiedFiles, speaker: &VerifiedFiles, device: &Device) -> Result<Self> {
        Ok(Self {
            network: SegmentationNetwork::load(segmentation, device)?,
            embedder: Some(WeSpeakerEmbedder::load(speaker, device)?),
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

/// 识别的模型包里的说话人区分（`segmentation` + 可选的 `speaker`），与 MLX 后端的 `DiarizerSlot` 同一套规则：加载模型包时
/// 只核对文件，任务里第一次要用时才加载，任务结束（[`DiarizerSlot::release`]）放掉；加载失败时同一任务不再重试。
pub struct DiarizerSlot {
    segmentation: Option<VerifiedFiles>,
    speaker: Option<VerifiedFiles>,
    device: Device,
    loaded: Option<PyannoteDiarizer>,
    failed: bool,
}

impl DiarizerSlot {
    /// 按清单核对文件：缺文件是 `MODEL_NOT_INSTALLED`（不悄悄退回不区分说话人）。
    pub fn new(bundle: &VerifiedBundle, device: &Device) -> Result<Self, ErrorBody> {
        if let Some(files) = &bundle.segmentation {
            files.require_extension_in("", "safetensors")?;
            if let Some(speaker) = &bundle.speaker {
                speaker.require_extension_in("", "safetensors")?;
            }
        }
        Ok(Self {
            segmentation: bundle.segmentation.clone(),
            speaker: bundle.speaker.clone(),
            device: device.clone(),
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
                Some(speaker) => PyannoteDiarizer::load_with_embedding(segmentation, speaker, &self.device),
                None => PyannoteDiarizer::load(segmentation, &self.device),
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

    /// 放掉加载了的模型；返回这次是否真的放掉了。
    pub fn release(&mut self) -> bool {
        self.failed = false;
        self.loaded.take().is_some()
    }
}

fn leaky_relu(input: &Tensor) -> Result<Tensor> {
    Ok(input.maximum(&(input * 0.01)?)?)
}
