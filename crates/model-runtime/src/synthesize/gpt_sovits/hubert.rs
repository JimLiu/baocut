//! chinese-hubert-base（HF `HubertModel`，`feat_extract_norm="group"`，post-norm 编码器），
//! 只输出 `last_hidden_state`。
//!
//! 官方推理（`inference_webui.py` / `TTS_infer_pack/TTS.py`）直接调用
//! `cnhubert_model.model(wav16k)`，绕过了 `Wav2Vec2FeatureExtractor`，所以输入
//! 波形**不做**零均值单位方差归一化。

use super::layers::{Conv1d, LayerNorm, Linear, act};
use super::weights::WeightMap;
use crate::synthesize::tensor::ops::indexing::IndexOp;
use crate::synthesize::tensor::{Array, Dtype, fast};
use anyhow::{Result, ensure};

const HIDDEN: i32 = 768;
const HEADS: i32 = 12;
const HEAD_DIM: i32 = 64;
const LAYERS: usize = 12;
const LAYER_NORM_EPS: f32 = 1e-5;
const CONV_CHANNELS: i32 = 512;
const CONV_KERNELS: [i32; 7] = [10, 3, 3, 3, 3, 2, 2];
const CONV_STRIDES: [i32; 7] = [5, 2, 2, 2, 2, 2, 2];
const POS_CONV_KERNEL: i32 = 128;
const POS_CONV_GROUPS: i32 = 16;

struct EncoderLayer {
    q_proj: Linear,
    k_proj: Linear,
    v_proj: Linear,
    out_proj: Linear,
    layer_norm: LayerNorm,
    intermediate: Linear,
    output: Linear,
    final_layer_norm: LayerNorm,
}

impl EncoderLayer {
    fn load(w: &mut WeightMap, prefix: &str) -> Result<Self> {
        Ok(Self {
            q_proj: Linear::load(w, &format!("{prefix}.attention.q_proj"))?,
            k_proj: Linear::load(w, &format!("{prefix}.attention.k_proj"))?,
            v_proj: Linear::load(w, &format!("{prefix}.attention.v_proj"))?,
            out_proj: Linear::load(w, &format!("{prefix}.attention.out_proj"))?,
            layer_norm: LayerNorm::load(w, &format!("{prefix}.layer_norm"), LAYER_NORM_EPS)?,
            intermediate: Linear::load(w, &format!("{prefix}.feed_forward.intermediate_dense"))?,
            output: Linear::load(w, &format!("{prefix}.feed_forward.output_dense"))?,
            final_layer_norm: LayerNorm::load(w, &format!("{prefix}.final_layer_norm"), LAYER_NORM_EPS)?,
        })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        let (b, t) = (x.dim(0), x.dim(1));
        let heads =
            |proj: &Linear| -> Result<Array> { Ok(proj.forward(x)?.reshape(&[b, t, HEADS, HEAD_DIM])?.transpose_axes(&[0, 2, 1, 3])?) };
        let (q, k, v) = (heads(&self.q_proj)?, heads(&self.k_proj)?, heads(&self.v_proj)?);
        let scale = 1.0 / (HEAD_DIM as f32).sqrt();
        let attn = fast::scaled_dot_product_attention(&q, &k, &v, scale, None, None)?
            .transpose_axes(&[0, 2, 1, 3])?
            .reshape(&[b, t, HIDDEN])?;
        let x = self.layer_norm.forward(&(x + self.out_proj.forward(&attn)?))?;
        let ff = self.output.forward(&act::gelu(&self.intermediate.forward(&x)?)?)?;
        self.final_layer_norm.forward(&(&x + ff))
    }
}

pub struct Hubert {
    convs: Vec<Conv1d>,
    group_norm_weight: Array,
    group_norm_bias: Array,
    projection_norm: LayerNorm,
    projection: Linear,
    pos_conv: Conv1d,
    encoder_norm: LayerNorm,
    layers: Vec<EncoderLayer>,
}

impl Hubert {
    pub fn load(mut w: WeightMap) -> Result<Self> {
        let convs = CONV_KERNELS
            .iter()
            .zip(CONV_STRIDES)
            .enumerate()
            .map(|(i, (_, stride))| Ok(Conv1d::load(&mut w, &format!("feature_extractor.conv_layers.{i}.conv"))?.with_stride(stride)))
            .collect::<Result<Vec<_>>>()?;
        let group_norm_weight = w.take_f32("feature_extractor.conv_layers.0.layer_norm.weight")?;
        let group_norm_bias = w.take_f32("feature_extractor.conv_layers.0.layer_norm.bias")?;
        let projection_norm = LayerNorm::load(&mut w, "feature_projection.layer_norm", LAYER_NORM_EPS)?;
        let projection = Linear::load(&mut w, "feature_projection.projection")?;

        // `weight_norm(conv, name="weight", dim=2)`：范数在第 0、1 维上求。
        let g = w.take_f32("encoder.pos_conv_embed.conv.weight_g")?;
        let v = w.take_f32("encoder.pos_conv_embed.conv.weight_v")?;
        let norm = v.square()?.sum_axis(0, true)?.sum_axis(1, true)?.sqrt()?;
        let weight = &v * (g / (norm + 1e-12f32));
        let bias = w.take_optional_f32("encoder.pos_conv_embed.conv.bias")?;
        let pos_conv = Conv1d::from_torch(weight, bias)?
            .with_padding(POS_CONV_KERNEL / 2)
            .with_groups(POS_CONV_GROUPS);
        let encoder_norm = LayerNorm::load(&mut w, "encoder.layer_norm", LAYER_NORM_EPS)?;
        let layers = (0..LAYERS)
            .map(|i| EncoderLayer::load(&mut w, &format!("encoder.layers.{i}")))
            .collect::<Result<Vec<_>>>()?;
        Ok(Self {
            convs,
            group_norm_weight,
            group_norm_bias,
            projection_norm,
            projection,
            pos_conv,
            encoder_norm,
            layers,
        })
    }

    /// 16 kHz 单声道波形 → `last_hidden_state` `[1, T, 768]`（约 50 Hz）。
    pub fn forward(&self, samples: &[f32]) -> Result<Array> {
        ensure!(samples.len() >= 400, "HuBERT 输入太短（{} 个样本）", samples.len());
        let mut x = Array::from_slice(samples, &[1, samples.len() as i32, 1]);
        for (i, conv) in self.convs.iter().enumerate() {
            x = conv.forward_nlc(&x)?;
            if i == 0 {
                // GroupNorm(512 组 / 512 通道)：每个通道在时间维上单独归一化。
                let mean = x.mean_axis(1, true)?;
                let var = x.var_axis(1, true, 0)?;
                x = (&x - mean) / (var + LAYER_NORM_EPS).sqrt()? * &self.group_norm_weight + &self.group_norm_bias;
            }
            x = act::gelu(&x)?;
        }
        debug_assert_eq!(x.dim(2), CONV_CHANNELS);
        let x = self.projection.forward(&self.projection_norm.forward(&x)?)?;

        let frames = x.dim(1);
        // 偶数卷积核：`HubertSamePadLayer` 去掉最后一帧。
        let pos = self.pos_conv.forward_nlc(&x)?.index((.., ..frames, ..));
        let mut x = self.encoder_norm.forward(&(&x + act::gelu(&pos)?))?;
        for layer in &self.layers {
            x = layer.forward(&x)?;
        }
        Ok(x.as_dtype(Dtype::Float32)?)
    }
}
