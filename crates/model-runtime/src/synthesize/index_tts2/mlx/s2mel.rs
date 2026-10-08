//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/IndexTTS2TTS/IndexTTS2S2Mel.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! S2Mel：语义 → 梅尔（对照 speech-swift `IndexTTS2S2Mel.swift` 与
//! `IndexTTS2S2MelFlow.swift`）。
//!
//! 包含长度调节器（content_in_proj → 最近邻插值 → 4×(conv k3 → GroupNorm(1) →
//! mish) → k1 输出卷积）、`gpt_layer` 三层投影，以及 CFM 估计器：DiT（隐层 512、
//! 8 头、13 层、i>6 时接 skip 栈、adaRMS 调制、传统 RoPE）→ skip_linear → WaveNet
//! （8 层门控）→ adaLN 终层 → conv2。推理为 CFG（率 0.7）欧拉步进，噪声用
//! `key(0)` 播种，提示区间每步清零。所有权重 checkpoint 带 `net.` 前缀。

use super::layers::{Conv1d, GroupNorm1, Linear, RmsNorm, act};
use super::weights::WeightMap;
use crate::synthesize::tensor::ops::indexing::IndexOp;
use crate::synthesize::tensor::{Array, Dtype, fast, ops, random};
use anyhow::{Result, ensure};

const HIDDEN: i32 = 512;
const HEADS: i32 = 8;
const HEAD_DIM: i32 = 64;
const DEPTH: usize = 13;
const WAVENET_LAYERS: usize = 8;
const RMS_EPS: f32 = 1e-5;
const FINAL_LN_EPS: f32 = 1e-6;

// ---------------------------------------------------------------------------
// 长度调节器
// ---------------------------------------------------------------------------

pub struct LengthRegulator {
    content_in_proj: Linear,
    convs: Vec<Conv1d>,
    norms: Vec<GroupNorm1>,
    output_conv: Conv1d,
}

impl LengthRegulator {
    fn load(w: &mut WeightMap) -> Result<Self> {
        let prefix = "length_regulator";
        let conv_indices = [0, 3, 6, 9];
        let norm_indices = [1, 4, 7, 10];
        let mut convs = Vec::with_capacity(4);
        let mut norms = Vec::with_capacity(4);
        for i in 0..4 {
            convs.push(Conv1d::load(w, &format!("{prefix}.model.{}", conv_indices[i]))?.with_padding(1));
            norms.push(GroupNorm1::load(w, &format!("{prefix}.model.{}", norm_indices[i]), 1e-5)?);
        }
        Ok(Self {
            content_in_proj: Linear::load(w, &format!("{prefix}.content_in_proj"))?,
            convs,
            norms,
            output_conv: Conv1d::load(w, &format!("{prefix}.model.12"))?,
        })
    }

    /// 语义提示 `[B, T, 1024]` → S2Mel 提示条件 `[B, target_length, 512]`。
    pub fn forward(&self, semantic_prompt: &Array, target_length: i32) -> Result<Array> {
        let mut h = self.content_in_proj.forward(semantic_prompt)?.swap_axes(1, 2)?; // [B, 512, T]
        h = Self::interpolate_nearest_ncl(&h, target_length)?;
        for (conv, norm) in self.convs.iter().zip(&self.norms) {
            h = conv.forward_ncl(&h)?;
            h = norm.forward_ncl(&h)?;
            h = act::mish(&h)?;
        }
        let out = self.output_conv.forward_ncl(&h)?.swap_axes(1, 2)?;
        out.eval()?;
        Ok(out)
    }

    fn interpolate_nearest_ncl(x: &Array, target_length: i32) -> Result<Array> {
        let input_length = x.dim(2);
        if target_length == input_length || target_length <= 0 || input_length <= 0 {
            return Ok(x.clone());
        }
        let scale = input_length as f32 / target_length as f32;
        let indices: Vec<i32> = (0..target_length)
            .map(|i| ((i as f32 * scale).floor() as i32).min(input_length - 1))
            .collect();
        let idx = Array::from_slice(&indices, &[target_length]);
        Ok(x.take_axis(&idx, 2)?)
    }
}

// ---------------------------------------------------------------------------
// CFM 估计器
// ---------------------------------------------------------------------------

struct TimestepEmbedder {
    freqs: Array,
    mlp0: Linear,
    mlp2: Linear,
}

impl TimestepEmbedder {
    fn load(w: &mut WeightMap, prefix: &str) -> Result<Self> {
        Ok(Self {
            freqs: w.take_f32(&format!("{prefix}.freqs"))?,
            mlp0: Linear::load(w, &format!("{prefix}.mlp.0"))?,
            mlp2: Linear::load(w, &format!("{prefix}.mlp.2"))?,
        })
    }

    /// `t: [B]` → `[B, 512]`。
    fn forward(&self, t: &Array) -> Result<Array> {
        let b = t.dim(0);
        let args = (t.as_dtype(Dtype::Float32)?.reshape(&[b, 1])? * 1000.0f32) * self.freqs.reshape(&[1, self.freqs.dim(0)])?;
        let embedding = ops::concatenate_axis(&[&args.cos()?, &args.sin()?], -1)?;
        self.mlp2.forward(&act::silu(&self.mlp0.forward(&embedding)?)?)
    }
}

struct AdaptiveRmsNorm {
    norm: RmsNorm,
    project_layer: Linear,
}

impl AdaptiveRmsNorm {
    fn load(w: &mut WeightMap, prefix: &str) -> Result<Self> {
        Ok(Self {
            norm: RmsNorm::load(w, &format!("{prefix}.norm.weight"), RMS_EPS)?,
            project_layer: Linear::load(w, &format!("{prefix}.project_layer"))?,
        })
    }

    /// `condition: [B, 1, 512]`。
    fn forward(&self, x: &Array, condition: &Array) -> Result<Array> {
        let projected = self.project_layer.forward(condition)?;
        let parts = ops::split(&projected, 2, -1)?;
        Ok(&parts[0] * self.norm.forward(x)? + &parts[1])
    }
}

struct DitLayer {
    skip_in_linear: Option<Linear>,
    attention_norm: AdaptiveRmsNorm,
    wqkv: Linear,
    wo: Linear,
    ffn_norm: AdaptiveRmsNorm,
    w1: Linear,
    w2: Linear,
    w3: Linear,
}

impl DitLayer {
    fn load(w: &mut WeightMap, prefix: &str, has_skip: bool) -> Result<Self> {
        Ok(Self {
            skip_in_linear: if has_skip {
                Some(Linear::load(w, &format!("{prefix}.skip_in_linear"))?)
            } else {
                None
            },
            attention_norm: AdaptiveRmsNorm::load(w, &format!("{prefix}.attention_norm"))?,
            wqkv: Linear::load_no_bias(w, &format!("{prefix}.attention.wqkv"))?,
            wo: Linear::load_no_bias(w, &format!("{prefix}.attention.wo"))?,
            ffn_norm: AdaptiveRmsNorm::load(w, &format!("{prefix}.ffn_norm"))?,
            w1: Linear::load_no_bias(w, &format!("{prefix}.feed_forward.w1"))?,
            w2: Linear::load_no_bias(w, &format!("{prefix}.feed_forward.w2"))?,
            w3: Linear::load_no_bias(w, &format!("{prefix}.feed_forward.w3"))?,
        })
    }

    fn forward(&self, x: &Array, condition: &Array, skip_in: Option<&Array>) -> Result<Array> {
        let mut h = x.clone();
        if let (Some(linear), Some(skip)) = (&self.skip_in_linear, skip_in) {
            h = linear.forward(&ops::concatenate_axis(&[&h, skip], -1)?)?;
        }
        h = &h + self.attention(&self.attention_norm.forward(&h, condition)?)?;
        h = &h + self.feed_forward(&self.ffn_norm.forward(&h, condition)?)?;
        Ok(h)
    }

    fn attention(&self, x: &Array) -> Result<Array> {
        let b = x.dim(0);
        let t = x.dim(1);
        let qkv = self.wqkv.forward(x)?;
        let parts = ops::split(&qkv, 3, -1)?;
        let heads = |p: &Array| -> Result<Array> { Ok(p.reshape(&[b, t, HEADS, HEAD_DIM])?.transpose_axes(&[0, 2, 1, 3])?) };
        let q = fast::rope(heads(&parts[0])?, HEAD_DIM, true, 10_000.0, 1.0, 0, None)?;
        let k = fast::rope(heads(&parts[1])?, HEAD_DIM, true, 10_000.0, 1.0, 0, None)?;
        let v = heads(&parts[2])?;
        let scale = 1.0 / (HEAD_DIM as f32).sqrt();
        let attended = fast::scaled_dot_product_attention(&q, &k, &v, scale, None, None)?;
        let merged = attended.transpose_axes(&[0, 2, 1, 3])?.reshape(&[b, t, HIDDEN])?;
        self.wo.forward(&merged)
    }

    fn feed_forward(&self, x: &Array) -> Result<Array> {
        let gate = act::silu(&self.w1.forward(x)?)?;
        self.w2.forward(&(gate * self.w3.forward(x)?))
    }
}

struct WaveNet {
    cond_layer: Conv1d,
    in_layers: Vec<Conv1d>,
    res_skip_layers: Vec<Conv1d>,
}

impl WaveNet {
    fn load(w: &mut WeightMap, prefix: &str) -> Result<Self> {
        let mut in_layers = Vec::with_capacity(WAVENET_LAYERS);
        let mut res_skip_layers = Vec::with_capacity(WAVENET_LAYERS);
        for i in 0..WAVENET_LAYERS {
            in_layers.push(Conv1d::load_weight_norm(w, &format!("{prefix}.in_layers.{i}.conv.conv"))?.with_padding(2));
            res_skip_layers.push(Conv1d::load_weight_norm(w, &format!("{prefix}.res_skip_layers.{i}.conv.conv"))?);
        }
        Ok(Self {
            cond_layer: Conv1d::load_weight_norm(w, &format!("{prefix}.cond_layer.conv.conv"))?,
            in_layers,
            res_skip_layers,
        })
    }

    /// `x: [B, 512, T]`，`t_condition: [B, 512, 1]`。
    fn forward(&self, x: &Array, t_condition: &Array) -> Result<Array> {
        let channels = HIDDEN;
        let mut h = x.clone();
        let mut out = ops::zeros_like(x)?;
        let g = self.cond_layer.forward_ncl(t_condition)?; // [B, 8192, 1]
        for i in 0..WAVENET_LAYERS {
            let x_in = self.in_layers[i].forward_ncl(&h)?;
            let lo = i as i32 * 2 * channels;
            let g_slice = g.index((.., lo..lo + 2 * channels, ..));
            let acts_in = x_in + g_slice;
            let acts = ops::tanh(&acts_in.index((.., ..channels, ..)))? * ops::sigmoid(&acts_in.index((.., channels..2 * channels, ..)))?;
            let res_skip = self.res_skip_layers[i].forward_ncl(&acts)?;
            if i + 1 < WAVENET_LAYERS {
                h = h + res_skip.index((.., ..channels, ..));
                out = out + res_skip.index((.., channels..2 * channels, ..));
            } else {
                out = out + res_skip;
            }
        }
        Ok(out)
    }
}

struct Estimator {
    t_embedder: TimestepEmbedder,
    t_embedder2: TimestepEmbedder,
    cond_projection: Linear,
    cond_x_merge_linear: Linear,
    layers: Vec<DitLayer>,
    transformer_norm: AdaptiveRmsNorm,
    skip_linear: Linear,
    conv1: Linear,
    wavenet: WaveNet,
    res_projection: Linear,
    final_ada_ln: Linear,
    final_linear: Linear,
    conv2: Conv1d,
}

impl Estimator {
    fn load(w: &mut WeightMap) -> Result<Self> {
        let p = "cfm.estimator";
        let mut layers = Vec::with_capacity(DEPTH);
        for i in 0..DEPTH {
            layers.push(DitLayer::load(w, &format!("{p}.transformer.layers.{i}"), i > DEPTH / 2)?);
        }
        Ok(Self {
            t_embedder: TimestepEmbedder::load(w, &format!("{p}.t_embedder"))?,
            t_embedder2: TimestepEmbedder::load(w, &format!("{p}.t_embedder2"))?,
            cond_projection: Linear::load(w, &format!("{p}.cond_projection"))?,
            cond_x_merge_linear: Linear::load(w, &format!("{p}.cond_x_merge_linear"))?,
            layers,
            transformer_norm: AdaptiveRmsNorm::load(w, &format!("{p}.transformer.norm"))?,
            skip_linear: Linear::load(w, &format!("{p}.skip_linear"))?,
            conv1: Linear::load(w, &format!("{p}.conv1"))?,
            wavenet: WaveNet::load(w, &format!("{p}.wavenet"))?,
            res_projection: Linear::load(w, &format!("{p}.res_projection"))?,
            final_ada_ln: Linear::load(w, &format!("{p}.final_layer.adaLN_modulation.1"))?,
            final_linear: Linear::load_weight_norm(w, &format!("{p}.final_layer.linear"))?,
            conv2: Conv1d::load(w, &format!("{p}.conv2"))?,
        })
    }

    /// `x / prompt_x: [B, 80, T]`，`t: [B]`，`style: [B, 192]`，`condition: [B, T, 512]` → 速度 `[B, 80, T]`。
    fn forward(&self, x: &Array, prompt_x: &Array, t: &Array, style: &Array, condition: &Array) -> Result<Array> {
        let batch = x.dim(0);
        let frames = x.dim(2);
        let t1 = self.t_embedder.forward(t)?; // [B, 512]
        let cond = self.cond_projection.forward(condition)?;

        let x_t = x.swap_axes(1, 2)?;
        let prompt_t = prompt_x.swap_axes(1, 2)?;
        let style_t = ops::broadcast_to(&style.expand_dims(1)?, &[batch, frames, style.dim(1)])?;
        let mut h = ops::concatenate_axis(&[&x_t, &prompt_t, &cond, &style_t], -1)?;
        h = self.cond_x_merge_linear.forward(&h)?;

        let mut x_res = self.transformer(&h, &t1.expand_dims(1)?)?;
        x_res = self.skip_linear.forward(&ops::concatenate_axis(&[&x_res, &x_t], -1)?)?;

        let y = self.conv1.forward(&x_res)?.swap_axes(1, 2)?;
        let t2 = self.t_embedder2.forward(t)?;
        let y = self.wavenet.forward(&y, &t2.expand_dims(2)?)?.swap_axes(1, 2)? + self.res_projection.forward(&x_res)?;
        let y = self.final_layer(&y, &t1)?.swap_axes(1, 2)?;
        self.conv2.forward_ncl(&y)
    }

    fn transformer(&self, x: &Array, condition: &Array) -> Result<Array> {
        let mut h = x.clone();
        let mut skip: Vec<Array> = Vec::new();
        for (i, layer) in self.layers.iter().enumerate() {
            let skip_in = if i > DEPTH / 2 { skip.pop() } else { None };
            h = layer.forward(&h, condition, skip_in.as_ref())?;
            if i < DEPTH / 2 {
                skip.push(h.clone());
            }
        }
        self.transformer_norm.forward(&h, condition)
    }

    fn final_layer(&self, x: &Array, condition: &Array) -> Result<Array> {
        let modulation = self.final_ada_ln.forward(&act::silu(condition)?)?;
        let parts = ops::split(&modulation, 2, -1)?;
        let normed = layer_norm_no_affine(x, FINAL_LN_EPS)?;
        let modulated = normed * (parts[1].expand_dims(1)? + 1.0f32) + parts[0].expand_dims(1)?;
        self.final_linear.forward(&modulated)
    }
}

fn layer_norm_no_affine(x: &Array, eps: f32) -> Result<Array> {
    let mean = x.mean_axis(-1, true)?;
    let centered = x - mean;
    let variance = (&centered * &centered).mean_axis(-1, true)?;
    Ok(centered / (variance + eps).sqrt()?)
}

// ---------------------------------------------------------------------------
// S2Mel 总装
// ---------------------------------------------------------------------------

pub struct S2Mel {
    pub length_regulator: LengthRegulator,
    gpt_layer: Vec<Linear>,
    estimator: Estimator,
    n_mels: i32,
}

impl S2Mel {
    pub fn load(mut w: WeightMap, n_mels: i32) -> Result<Self> {
        w.retain_prefix("net.");
        let gpt_layer = (0..3)
            .map(|i| Linear::load(&mut w, &format!("gpt_layer.{i}")))
            .collect::<Result<Vec<_>>>()?;
        Ok(Self {
            length_regulator: LengthRegulator::load(&mut w)?,
            gpt_layer,
            estimator: Estimator::load(&mut w)?,
            n_mels,
        })
    }

    /// GPT 潜变量 `[B, T, 1280]` → `[B, T, 1024]`。
    pub fn gpt_latent(&self, latent: &Array) -> Result<Array> {
        let mut h = latent.clone();
        for layer in &self.gpt_layer {
            h = layer.forward(&h)?;
        }
        Ok(h)
    }

    /// 流匹配推理：`condition [B, T, 512]`，`prompt_mel [B, 80, Tp]`，`style [B, 192]` → 梅尔 `[B, 80, T]`
    /// （提示区间为 0，调用方按 `Tp` 裁掉）。
    pub fn inference(
        &self,
        condition: &Array,
        prompt_mel: &Array,
        style: &Array,
        steps: usize,
        cfg_rate: f32,
        temperature: f32,
    ) -> Result<Array> {
        ensure!(steps > 0, "S2Mel 步数必须大于 0");
        let batch = condition.dim(0);
        let total_frames = condition.dim(1);
        let prompt_frames = prompt_mel.dim(2);
        ensure!(prompt_frames <= total_frames, "提示梅尔帧数超过总帧数");

        let key = random::key(0)?;
        let mut x = random::normal::<f32>(&[batch, self.n_mels, total_frames], None, None, &key)?;
        if temperature != 1.0 {
            x = x * temperature;
        }
        // 提示区间掩码：前 Tp 帧为 0，其余为 1。
        let keep = ops::pad(
            &ops::zeros::<f32>(&[1, 1, prompt_frames])?,
            &[(0, 0), (0, 0), (0, total_frames - prompt_frames)],
            Array::from_f32(1.0),
            None,
        )?;
        let prompt_x = ops::pad(
            &prompt_mel.as_dtype(Dtype::Float32)?,
            &[(0, 0), (0, 0), (0, total_frames - prompt_frames)],
            None,
            None,
        )?;
        x = x * &keep;

        let use_cfg = cfg_rate > 0.0;
        let (stacked_prompt, stacked_style, stacked_condition) = if use_cfg {
            (
                ops::concatenate_axis(&[&prompt_x, &ops::zeros_like(&prompt_x)?], 0)?,
                ops::concatenate_axis(&[style, &ops::zeros_like(style)?], 0)?,
                ops::concatenate_axis(&[condition, &ops::zeros_like(condition)?], 0)?,
            )
        } else {
            (prompt_x.clone(), style.clone(), condition.clone())
        };

        let mut t = 0.0f32;
        for step in 1..=steps {
            let next_t = step as f32 / steps as f32;
            let dt = next_t - t;
            let velocity = if use_cfg {
                let stacked_x = ops::concatenate_axis(&[&x, &x], 0)?;
                let stacked_t = Array::from_slice(&[t, t], &[2]);
                let both = self
                    .estimator
                    .forward(&stacked_x, &stacked_prompt, &stacked_t, &stacked_style, &stacked_condition)?;
                let cond = both.index((..batch, .., ..));
                let uncond = both.index((batch.., .., ..));
                cond * (1.0 + cfg_rate) - uncond * cfg_rate
            } else {
                let t_arr = Array::from_slice(&[t], &[1]);
                self.estimator
                    .forward(&x, &stacked_prompt, &t_arr, &stacked_style, &stacked_condition)?
            };
            x = (x + velocity * dt) * &keep;
            t = next_t;
            x.eval()?;
        }
        Ok(x)
    }
}
