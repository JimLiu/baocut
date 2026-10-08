//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/VoxCPM2TTS/VoxCPM2TTS.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! `VoxCpm2` 引擎：把 MiniCPM4 底座、局部扩散与 AudioVAE 接到 `TtsEngine`。
//! 生成流程对照 speech-swift `VoxCPM2TTS.swift::generateVoxCPM2`，护栏对照官方
//! `VoxCPM2Model.generate`（`max_len = 文本 token × 6 + 10`、撞上限视为坏例重采）。
//!
//! 音色三条路：
//! - 参考音频带原文、且没有 `instruct` → 「高保真克隆」：同一段音频既作 ref 前缀
//!   （右补零）又作续写 prompt（左补零），prompt 原文拼在目标文本前，出声后裁掉
//!   续写种子对应的开头；
//! - 参考音频不带原文，或带了 `instruct` → 仅参考音频（官方「可控克隆」）：
//!   `(instruct)` 拼在目标文本前。官方 demo 在高保真模式下会清空 control，这里一致；
//! - 内置音色与 `Clone` 一样走上面两条（内置音色都带原文）。

use super::audio_vae::AudioVae;
use super::config::VoxCpm2Config;
use super::minicpm::{Dims, Fsq, LocDit, LocEnc, LongRope, MiniCpm, solve_euler};
use super::tokenizer::Tokenizer;
use super::{DEFAULT_CFG, DEFAULT_STEPS};
use crate::bundle::VerifiedFiles;
use crate::synthesize::qwen3_tts::layers::{KvCache, Linear};
use crate::synthesize::qwen3_tts::sampling::Rng;
use crate::synthesize::qwen3_tts::weights::Weights;
use crate::synthesize::tensor::host::{ModelMemoryCacheGuard, ensure_device};
use crate::synthesize::tensor::host::{clear_memory_cache, configure_memory_cache};
use crate::synthesize::tensor::nn::silu;
use crate::synthesize::tensor::ops;
use crate::synthesize::tensor::ops::indexing::IndexOp;
use crate::synthesize::tensor::transforms::eval;
use crate::synthesize::tensor::{Array, Dtype};
use crate::synthesize::types::{TtsAudio, TtsEngineKind, TtsProgress, TtsRequest};
use crate::synthesize::voices::ReferenceAudio;
use crate::synthesize::{ProgressSink, TtsEngine};
use anyhow::{Context, Result, bail, ensure};

pub const ENGINE_NAME: &str = "VoxCPM2";
pub const SAMPLE_RATE: u32 = 48_000;
const ABORT_MESSAGE: &str = "合成已取消";
/// 文本结束（`audio_start`）、参考音频起止 token。
const AUDIO_START: i32 = 101;
const REF_START: i32 = 103;
const REF_END: i32 = 104;
/// 官方 `retry_badcase_ratio_threshold`：生成 patch 数 ≥ 文本 token × 6 视为没收住。
const BADCASE_RATIO: usize = 6;
const BADCASE_RETRIES: usize = 3;
/// 官方 `generate` 的 `max_len` / `min_len` 默认。
const DEFAULT_MAX_PATCHES: usize = 4096;
const MIN_PATCHES: usize = 2;
/// 官方 `streaming_prefix_len - 1`：续写时用 prompt 末尾多少个 patch 做种子。
const CONTINUATION_PATCHES: usize = 3;

pub struct VoxCpm2 {
    config: VoxCpm2Config,
    tokenizer: Tokenizer,
    embed: Array,
    scale_emb: f32,
    base_lm: MiniCpm,
    residual_lm: MiniCpm,
    feat_encoder: LocEnc,
    dit: LocDit,
    fsq: Fsq,
    enc_to_lm: Linear,
    lm_to_dit: Linear,
    res_to_dit: Linear,
    fusion: Linear,
    stop_proj: Linear,
    stop_head: Linear,
    vae: AudioVae,
    /// 最后一个字段：权重先析构，再等 GPU 并清缓存。
    _cache_guard: ModelMemoryCacheGuard,
}

/// 编好的参考音频：`[N, patch, latent]`。
pub(crate) enum VoicePlan {
    /// 仅参考音频（可带 instruct）。
    Reference { reference: Array },
    /// 高保真克隆：ref 前缀 + 续写 prompt。
    Continuation {
        reference: Array,
        prompt: Array,
        prompt_text: String,
    },
}

/// 一次生成的采样参数。
#[derive(Clone, Copy)]
pub(crate) struct Sampling {
    pub cfg: f32,
    pub steps: usize,
    pub max_patches: usize,
}

/// 生成结果：解码后的波形与生成的 patch 数（坏例判定用）。
struct Generated {
    samples: Vec<f32>,
    patches: usize,
}

fn dims(hidden: usize, heads: usize, kv_heads: usize, head_dim: usize, layers: usize, config: &VoxCpm2Config) -> Dims {
    let lm = &config.lm_config;
    Dims {
        hidden,
        heads,
        kv_heads,
        head_dim,
        layers,
        eps: lm.rms_norm_eps,
        residual_scale: if lm.use_mup { lm.scale_depth / (layers as f32).sqrt() } else { 1.0 },
    }
}

impl VoxCpm2 {
    /// 按清单加载：`config.json`、`tokenizer.json`、`model.safetensors`。缺文件是 `MODEL_NOT_INSTALLED`，
    /// 在碰 Metal 之前就报。
    pub fn load(model: &VerifiedFiles) -> Result<Self> {
        Self::load_with_progress(model, &mut |_| true)
    }

    pub fn load_with_progress(model: &VerifiedFiles, progress: &mut dyn FnMut(TtsProgress) -> bool) -> Result<Self> {
        let config_path = model.require("config.json")?;
        let tokenizer_path = model.require("tokenizer.json")?;
        let weights_path = model.require("model.safetensors")?;
        let mut stage = |name: &str| -> Result<()> {
            if !progress(TtsProgress::Loading { stage: name.to_string() }) {
                bail!(ABORT_MESSAGE);
            }
            Ok(())
        };
        stage("config")?;
        let config = VoxCpm2Config::load(config_path)?;
        let tokenizer = Tokenizer::load(tokenizer_path)?;
        ensure_device()?;
        configure_memory_cache()?;
        // 先建守卫：后面任何一步加载失败，展开时也会等 GPU 并清掉已分配的缓存。
        let cache_guard = ModelMemoryCacheGuard;
        stage("weights")?;
        let mut weights =
            Weights::load(&[weights_path], false).with_context(|| format!("加载 {ENGINE_NAME} 权重 {}", weights_path.display()))?;
        let model = Self::from_weights(config, tokenizer, &mut weights, &mut stage)?;
        let leftover = weights.keys();
        ensure!(leftover.is_empty(), "{ENGINE_NAME} 有未使用的权重：{}", leftover.join(", "));
        drop(weights);
        // 加载期的守卫在这里析构：等 GPU 并清缓存（v2 在这里调 `clear_memory_cache`）；模型自己的守卫管卸载。
        drop(cache_guard);
        Ok(model)
    }

    pub(crate) fn from_weights(
        config: VoxCpm2Config,
        tokenizer: Tokenizer,
        weights: &mut Weights,
        stage: &mut dyn FnMut(&str) -> Result<()>,
    ) -> Result<Self> {
        let quant = config.quant();
        let lm = &config.lm_config;
        let head_dim = lm.head_dim();
        let rope = LongRope::new(head_dim, lm.rope_theta, lm.max_position_embeddings, lm.rope_scaling.as_ref());
        stage("base_lm")?;
        let base_dims = dims(
            lm.hidden_size,
            lm.num_attention_heads,
            lm.num_key_value_heads,
            head_dim,
            lm.num_hidden_layers,
            &config,
        );
        let embed = weights.take("base_lm.embed_tokens.weight")?;
        let base_lm = MiniCpm::load(weights, "base_lm", &base_dims, Some(rope.clone()), quant)?;
        let residual_dims = dims(
            lm.hidden_size,
            lm.num_attention_heads,
            lm.num_key_value_heads,
            head_dim,
            config.residual_lm_num_layers,
            &config,
        );
        let residual_rope = (!config.residual_lm_no_rope).then(|| rope.clone());
        let residual_lm = MiniCpm::load(weights, "residual_lm", &residual_dims, residual_rope, quant)?;

        stage("local")?;
        let enc = &config.encoder_config;
        let enc_head = enc.kv_channels.unwrap_or(enc.hidden_dim / enc.num_heads);
        let enc_dims = dims(
            enc.hidden_dim,
            enc.num_heads,
            lm.num_key_value_heads,
            enc_head,
            enc.num_layers,
            &config,
        );
        let local_rope = LongRope::new(enc_head, lm.rope_theta, lm.max_position_embeddings, lm.rope_scaling.as_ref());
        let feat_encoder = LocEnc::load(weights, &enc_dims, local_rope.clone(), quant)?;
        let dit_cfg = &config.dit_config.block;
        let dit_head = dit_cfg.kv_channels.unwrap_or(dit_cfg.hidden_dim / dit_cfg.num_heads);
        ensure!(!config.dit_config.mean_mode, "{ENGINE_NAME} 不支持 mean_mode 的 checkpoint");
        let dit_dims = dims(
            dit_cfg.hidden_dim,
            dit_cfg.num_heads,
            lm.num_key_value_heads,
            dit_head,
            dit_cfg.num_layers,
            &config,
        );
        let dit = LocDit::load(weights, &dit_dims, local_rope, quant)?;
        let fsq = Fsq::load(weights, config.scalar_quantization_scale, quant)?;
        let linear = |weights: &mut Weights, name: &str| Linear::load(weights, name, quant.0, quant.1);
        let enc_to_lm = linear(weights, "enc_to_lm_proj")?;
        let lm_to_dit = linear(weights, "lm_to_dit_proj")?;
        let res_to_dit = linear(weights, "res_to_dit_proj")?;
        let fusion = linear(weights, "fusion_concat_proj")?;
        let stop_proj = linear(weights, "stop_proj")?;
        let stop_head = linear(weights, "stop_head")?;

        stage("audio_vae")?;
        let mut vae_weights = weights.split_prefix("audio_vae.");
        let vae = AudioVae::load(&mut vae_weights, &config.audio_vae_config)?;
        let leftover = vae_weights.keys();
        ensure!(
            leftover.is_empty(),
            "{ENGINE_NAME} AudioVAE 有未使用的权重：{}",
            leftover.join(", ")
        );
        ensure!(
            vae.out_sample_rate == SAMPLE_RATE,
            "{ENGINE_NAME} AudioVAE 输出采样率是 {}，预期 {SAMPLE_RATE}",
            vae.out_sample_rate
        );
        let scale_emb = if lm.use_mup { lm.scale_emb } else { 1.0 };
        Ok(Self {
            config,
            tokenizer,
            embed,
            scale_emb,
            base_lm,
            residual_lm,
            feat_encoder,
            dit,
            fsq,
            enc_to_lm,
            lm_to_dit,
            res_to_dit,
            fusion,
            stop_proj,
            stop_head,
            vae,
            _cache_guard: ModelMemoryCacheGuard,
        })
    }

    fn patch(&self) -> usize {
        self.config.patch_size
    }

    /// 参考波形（`vae.sample_rate`）补零到 `patch × hop` 的整数倍后编码成 `[N, patch, latent]`。
    pub(crate) fn encode_audio(&self, samples: &[f32], pad_left: bool) -> Result<Array> {
        ensure!(!samples.is_empty(), "{ENGINE_NAME} 参考音频为空");
        let unit = self.patch() * self.vae.hop;
        let pad = (unit - samples.len() % unit) % unit;
        let mut padded = Vec::with_capacity(samples.len() + pad);
        if pad_left {
            padded.resize(pad, 0.0);
        }
        padded.extend_from_slice(samples);
        padded.resize(samples.len() + pad, 0.0);
        let input = Array::from_slice(&padded, &[1, padded.len() as i32, 1]);
        let latent = self.vae.encode(&input)?;
        let patches = (padded.len() / unit) as i32;
        let out = latent.reshape(&[patches, self.patch() as i32, self.vae.latent_dim as i32])?;
        eval([&out])?;
        Ok(out)
    }

    fn zeros_patches(&self, n: usize) -> Result<Array> {
        Ok(ops::zeros::<f32>(&[n as i32, self.patch() as i32, self.vae.latent_dim as i32])?)
    }

    /// 组装一段文本的前缀：token、音频特征、文本 / 音频掩码，并返回续写种子 patch 数。
    fn build_inputs(&self, text: &str, plan: Option<&VoicePlan>) -> Result<(Vec<i32>, Array, Vec<f32>, Vec<f32>)> {
        let text_ids = |text: &str| -> Vec<i32> {
            let mut ids = self.tokenizer.encode(text);
            ids.push(AUDIO_START);
            ids
        };
        let ref_prefix = |reference: &Array| -> Result<(Vec<i32>, Array, Vec<f32>)> {
            let n = reference.dim(0) as usize;
            let mut ids = vec![REF_START];
            ids.extend(std::iter::repeat_n(0, n));
            ids.push(REF_END);
            let feats = ops::concatenate_axis(&[&self.zeros_patches(1)?, reference, &self.zeros_patches(1)?], 0)?;
            let mut text_mask = vec![1.0];
            text_mask.extend(std::iter::repeat_n(0.0, n));
            text_mask.push(1.0);
            Ok((ids, feats, text_mask))
        };
        let (ids, feats, text_mask) = match plan {
            None => {
                let ids = text_ids(text);
                let n = ids.len();
                (ids, self.zeros_patches(n)?, vec![1.0; n])
            }
            Some(VoicePlan::Reference { reference }) => {
                let (mut ids, feats, mut text_mask) = ref_prefix(reference)?;
                let tail = text_ids(text);
                let n = tail.len();
                ids.extend(tail);
                text_mask.extend(std::iter::repeat_n(1.0, n));
                let feats = ops::concatenate_axis(&[&feats, &self.zeros_patches(n)?], 0)?;
                (ids, feats, text_mask)
            }
            Some(VoicePlan::Continuation {
                reference,
                prompt,
                prompt_text,
            }) => {
                let (mut ids, feats, mut text_mask) = ref_prefix(reference)?;
                let tail = text_ids(&format!("{prompt_text}{text}"));
                let n = tail.len();
                let prompt_len = prompt.dim(0) as usize;
                ids.extend(tail);
                ids.extend(std::iter::repeat_n(0, prompt_len));
                text_mask.extend(std::iter::repeat_n(1.0, n));
                text_mask.extend(std::iter::repeat_n(0.0, prompt_len));
                let feats = ops::concatenate_axis(&[&feats, &self.zeros_patches(n)?, prompt], 0)?;
                (ids, feats, text_mask)
            }
        };
        let audio_mask = text_mask.iter().map(|m| 1.0 - m).collect();
        Ok((ids, feats, text_mask, audio_mask))
    }

    fn noise(&self, rng: &mut Rng) -> Array {
        let dim = self.vae.latent_dim;
        let count = dim * self.patch();
        let mut values = Vec::with_capacity(count);
        while values.len() < count {
            // Box–Muller：主机侧出噪声，MLX 与 Candle 同一种子同一串。
            let u1 = rng.next_f64().max(f64::MIN_POSITIVE);
            let u2 = rng.next_f64();
            let r = (-2.0 * u1.ln()).sqrt();
            let theta = std::f64::consts::TAU * u2;
            values.push((r * theta.cos()) as f32);
            values.push((r * theta.sin()) as f32);
        }
        values.truncate(count);
        Array::from_slice(&values, &[1, dim as i32, self.patch() as i32])
    }

    fn step_lm(&self, embed: &Array, lm_cache: &[KvCache], res_cache: &[KvCache]) -> Result<(Array, Array, Vec<KvCache>, Vec<KvCache>)> {
        let (lm_out, lm_cache) = self.base_lm.forward(embed, Some(lm_cache), true)?;
        let lm_hidden = self.fsq.forward(&lm_out.index((.., -1, ..)))?;
        let hidden = lm_hidden.reshape(&[1, 1, -1])?;
        let fused = self.fusion.forward(&ops::concatenate_axis(&[&hidden, embed], -1)?)?;
        let (res_out, res_cache) = self.residual_lm.forward(&fused, Some(res_cache), true)?;
        Ok((lm_hidden, res_out.index((.., -1, ..)), lm_cache, res_cache))
    }

    /// 一段文本的一次完整生成（前缀 → 逐 patch 扩散 → VAE 解码）。
    fn generate(
        &self,
        text: &str,
        plan: Option<&VoicePlan>,
        sampling: Sampling,
        rng: &mut Rng,
        on_patch: &mut dyn FnMut(usize) -> bool,
    ) -> Result<Generated> {
        let (ids, feats, text_mask, audio_mask) = self.build_inputs(text, plan)?;
        let len = ids.len() as i32;
        let patch = self.patch() as i32;
        let latent = self.vae.latent_dim as i32;
        let feats = feats.reshape(&[1, len, patch, latent])?;
        let text_mask3 = Array::from_slice(&text_mask, &[1, len, 1]);
        let audio_mask3 = Array::from_slice(&audio_mask, &[1, len, 1]);

        let feat_embed = self.enc_to_lm.forward(&self.feat_encoder.forward(&feats)?)?;
        let ids_array = Array::from_slice(&ids, &[1, len]);
        let mut text_embed = self.embed.index(&ids_array).as_dtype(Dtype::Float32)?;
        if self.scale_emb != 1.0 {
            text_embed = text_embed.multiply(Array::from_f32(self.scale_emb))?;
        }
        let combined = text_mask3.multiply(&text_embed)?.add(&audio_mask3.multiply(&feat_embed)?)?;
        let mut prefix_cond = feats.index((.., len - 1, .., ..));

        let (enc_out, mut lm_cache) = self.base_lm.forward(&combined, None, true)?;
        let masked = self
            .fsq
            .forward(&enc_out)?
            .multiply(&audio_mask3)?
            .add(&enc_out.multiply(&text_mask3)?)?;
        let mut lm_hidden = masked.index((.., -1, ..));
        let fused = self
            .fusion
            .forward(&ops::concatenate_axis(&[&masked, &audio_mask3.multiply(&feat_embed)?], -1)?)?;
        let (res_out, mut res_cache) = self.residual_lm.forward(&fused, None, true)?;
        let mut res_hidden = res_out.index((.., -1, ..));

        // 续写：prompt 末尾几个 patch 先放进输出序列，解码后连同对应的样本一起裁掉。
        let mut sequence: Vec<Array> = Vec::new();
        if matches!(plan, Some(VoicePlan::Continuation { .. })) {
            let audio_positions: Vec<i32> = audio_mask
                .iter()
                .enumerate()
                .filter(|(_, m)| **m > 0.5)
                .map(|(i, _)| i as i32)
                .collect();
            let seed = CONTINUATION_PATCHES.min(audio_positions.len());
            for &i in &audio_positions[audio_positions.len() - seed..] {
                sequence.push(feats.index((.., i, .., ..)).reshape(&[1, patch, latent])?);
            }
        }
        let seeded = sequence.len();

        let mut patches = 0usize;
        for step in 0..sampling.max_patches {
            let mu = ops::concatenate_axis(&[&self.lm_to_dit.forward(&lm_hidden)?, &self.res_to_dit.forward(&res_hidden)?], -1)?;
            let cond = prefix_cond.transpose_axes(&[0, 2, 1])?;
            let pred = solve_euler(&self.dit, self.noise(rng), &mu, &cond, sampling.steps, sampling.cfg)?.transpose_axes(&[0, 2, 1])?;
            let curr_embed = self
                .enc_to_lm
                .forward(&self.feat_encoder.forward(&pred.reshape(&[1, 1, patch, latent])?)?)?;
            let stop_logits = self
                .stop_head
                .forward(&silu(self.stop_proj.forward(&lm_hidden)?)?)?
                .as_dtype(Dtype::Float32)?;
            eval([&pred, &curr_embed, &stop_logits])?;
            sequence.push(pred.clone());
            patches += 1;
            if !on_patch(patches) {
                bail!(ABORT_MESSAGE);
            }
            let logits: Vec<f32> = stop_logits.as_slice::<f32>().to_vec();
            if step > MIN_PATCHES && logits.len() >= 2 && logits[1] > logits[0] {
                break;
            }
            if step + 1 == sampling.max_patches {
                break;
            }
            let (next_lm, next_res, next_lm_cache, next_res_cache) = self.step_lm(&curr_embed, &lm_cache, &res_cache)?;
            lm_hidden = next_lm;
            res_hidden = next_res;
            lm_cache = next_lm_cache;
            res_cache = next_res_cache;
            prefix_cond = pred;
        }
        drop((lm_cache, res_cache));

        let all = ops::concatenate_axis(&sequence, 0)?.reshape(&[1, -1, latent])?;
        let audio = self.vae.decode(&all)?;
        eval([&audio])?;
        let mut samples: Vec<f32> = audio.as_slice::<f32>().to_vec();
        let trim = seeded * self.patch() * self.vae.decode_hop;
        samples.drain(..trim.min(samples.len()));
        Ok(Generated { samples, patches })
    }

    /// 带坏例重采的一段合成：撞上 `文本 token × 6` 视为没收住，最多再采 3 次。
    pub(crate) fn synthesize_text(
        &self,
        text: &str,
        instruct: Option<&str>,
        plan: Option<&VoicePlan>,
        sampling: Sampling,
        rng: &mut Rng,
        on_patch: &mut dyn FnMut(usize) -> bool,
    ) -> Result<Vec<f32>> {
        let text = normalize_text(text);
        let target = match instruct {
            Some(instruct) => format!("({instruct}){text}"),
            None => text,
        };
        let target_tokens = self.tokenizer.encode(&target).len().max(1);
        let limit = BADCASE_RATIO * target_tokens;
        let capped = Sampling {
            max_patches: sampling.max_patches.min(limit + 10).max(MIN_PATCHES + 2),
            ..sampling
        };
        let mut attempt = 0;
        loop {
            let generated = self.generate(&target, plan, capped, rng, on_patch)?;
            attempt += 1;
            if generated.patches < limit || attempt > BADCASE_RETRIES {
                return Ok(generated.samples);
            }
        }
    }

    pub(crate) fn plan_voice(
        &self,
        reference_audio: &ReferenceAudio,
        reference_text: Option<&str>,
        continuation: bool,
    ) -> Result<VoicePlan> {
        let samples = reference_audio
            .samples(self.vae.sample_rate)
            .with_context(|| format!("{ENGINE_NAME} 参考音频"))?;
        let reference = self.encode_audio(&samples, false)?;
        match reference_text {
            Some(text) if continuation => Ok(VoicePlan::Continuation {
                reference,
                prompt: self.encode_audio(&samples, true)?,
                prompt_text: normalize_text(text),
            }),
            _ => Ok(VoicePlan::Reference { reference }),
        }
    }
}

/// 官方 `generate` 的文本预处理：换行换空格、连续空白合一。
fn normalize_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn sampling_for(request: &TtsRequest) -> Result<Sampling> {
    let cfg = request.sampling.cfg.unwrap_or(DEFAULT_CFG);
    let steps = request.sampling.steps.unwrap_or(DEFAULT_STEPS);
    ensure!(cfg.is_finite() && cfg > 0.0, "{ENGINE_NAME} cfg 必须是正数，收到 {cfg}");
    ensure!(steps > 0, "{ENGINE_NAME} steps 必须大于 0");
    let max_patches = request.sampling.max_tokens.unwrap_or(DEFAULT_MAX_PATCHES);
    ensure!(max_patches > 0, "{ENGINE_NAME} max_tokens 必须大于 0");
    Ok(Sampling { cfg, steps, max_patches })
}

impl TtsEngine for VoxCpm2 {
    fn kind(&self) -> TtsEngineKind {
        TtsEngineKind::VoxCpm2
    }

    fn sample_rate(&self) -> u32 {
        SAMPLE_RATE
    }

    /// 模型没有说话人表；露出来的是随包的内置音色（`VoiceSpec::Preset` 的取值）。
    fn preset_speakers(&self) -> Vec<String> {
        crate::synthesize::voices::ids()
    }

    fn synthesize(&mut self, request: &TtsRequest, progress: ProgressSink<'_>) -> Result<TtsAudio> {
        let text = request.text.trim();
        ensure!(!text.is_empty(), "合成文本为空");
        let chunks = crate::synthesize::text::chunk_with_breaks(text, crate::synthesize::text::DEFAULT_MAX_UNITS);
        ensure!(!chunks.is_empty(), "合成文本切块后为空");
        let sampling = sampling_for(request)?;
        let instruct = request.instruct.as_deref().map(str::trim).filter(|s| !s.is_empty());
        let reference = crate::synthesize::voices::reference_for(request, ENGINE_NAME)?;
        if !progress(TtsProgress::Loading {
            stage: "reference".to_string(),
        }) {
            bail!(ABORT_MESSAGE);
        }
        let plan = self.plan_voice(&reference.audio, reference.text.as_deref(), instruct.is_none())?;
        let mut rng = Rng::from_optional_seed(request.sampling.seed);

        // 块与块之间的停顿与响度由拼接统一定（`synthesize::stitch`）。
        let count = chunks.len();
        let mut stitcher = crate::synthesize::stitch::Stitcher::new(SAMPLE_RATE, count);
        for (index, chunk) in chunks.iter().enumerate() {
            if !progress(TtsProgress::ChunkStarted { index, count }) {
                bail!(ABORT_MESSAGE);
            }
            let audio = self.synthesize_text(&chunk.text, instruct, Some(&plan), sampling, &mut rng, &mut |generated| {
                progress(TtsProgress::Tokens { index, generated })
            })?;
            stitcher.push(&audio, chunk.after);
            clear_memory_cache()?;
            let seconds = stitcher.seconds();
            if !progress(TtsProgress::ChunkFinished { index, seconds }) {
                bail!(ABORT_MESSAGE);
            }
        }
        Ok(TtsAudio {
            samples: stitcher.finish(),
            sample_rate: SAMPLE_RATE,
            readings_dropped: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_collapses_whitespace_and_newlines() {
        let _mlx = super::super::tests::mlx_lock();
        assert_eq!(normalize_text("  你好\n世界  a\t b "), "你好 世界 a b");
    }

    #[test]
    fn sampling_defaults_and_validation() {
        let _mlx = super::super::tests::mlx_lock();
        let mut request = TtsRequest::new("hi", crate::synthesize::types::VoiceSpec::Default);
        let s = sampling_for(&request).unwrap();
        assert_eq!((s.cfg, s.steps, s.max_patches), (2.0, 10, DEFAULT_MAX_PATCHES));
        request.sampling.cfg = Some(0.0);
        assert!(sampling_for(&request).is_err());
        request.sampling.cfg = Some(3.0);
        request.sampling.steps = Some(0);
        assert!(sampling_for(&request).is_err());
    }

    fn sampling(max_patches: usize) -> Sampling {
        Sampling {
            cfg: 2.0,
            steps: 3,
            max_patches,
        }
    }

    #[test]
    fn prefix_layout_follows_reference_and_continuation_modes() {
        let _mlx = super::super::tests::mlx_lock();
        let model = super::super::tests::tiny_model();
        // 30 个 16 kHz 样本 → 补到 patch(2)·hop(6) 的倍数 36 → 3 个 patch。
        let wave: Vec<f32> = (0..30).map(|i| (i as f32 * 0.3).sin() * 0.5).collect();
        let reference = model.encode_audio(&wave, false).unwrap();
        let prompt = model.encode_audio(&wave, true).unwrap();
        assert_eq!(reference.shape(), vec![3, 2, 3]);

        let (ids, feats, text_mask, audio_mask) = model.build_inputs("abc", None).unwrap();
        assert_eq!(ids, vec![5, 3, 4, AUDIO_START]);
        assert_eq!(feats.shape(), vec![4, 2, 3]);
        assert_eq!(text_mask, vec![1.0; 4]);
        assert_eq!(audio_mask, vec![0.0; 4]);

        let plan = VoicePlan::Reference {
            reference: reference.clone(),
        };
        let (ids, feats, text_mask, _) = model.build_inputs("abc", Some(&plan)).unwrap();
        assert_eq!(ids, vec![REF_START, 0, 0, 0, REF_END, 5, 3, 4, AUDIO_START]);
        assert_eq!(feats.shape(), vec![9, 2, 3]);
        assert_eq!(text_mask, vec![1., 0., 0., 0., 1., 1., 1., 1., 1.]);

        let plan = VoicePlan::Continuation {
            reference,
            prompt,
            prompt_text: "a".into(),
        };
        let (ids, feats, text_mask, audio_mask) = model.build_inputs("bc", Some(&plan)).unwrap();
        // 「a」+「bc」一起分词：▁a b c，再接 101 和 3 个 prompt 占位。
        assert_eq!(ids, vec![REF_START, 0, 0, 0, REF_END, 5, 3, 4, AUDIO_START, 0, 0, 0]);
        assert_eq!(feats.shape(), vec![12, 2, 3]);
        assert_eq!(text_mask, vec![1., 0., 0., 0., 1., 1., 1., 1., 1., 0., 0., 0.]);
        assert_eq!(audio_mask, vec![0., 1., 1., 1., 0., 0., 0., 0., 0., 1., 1., 1.]);
    }

    #[test]
    fn generation_is_seeded_patch_aligned_and_trims_continuation_seed() {
        let _mlx = super::super::tests::mlx_lock();
        let model = super::super::tests::tiny_model();
        let per_patch = 2 * 12;
        let run = |plan: Option<&VoicePlan>, seed: u64| {
            let mut last = 0;
            let mut rng = Rng::new(seed);
            let samples = model
                .synthesize_text("abc", None, plan, sampling(6), &mut rng, &mut |n| {
                    last = n;
                    true
                })
                .unwrap();
            (samples, last)
        };
        let (a, patches) = run(None, 7);
        assert!(patches > 0 && patches <= 6, "{patches}");
        assert_eq!(a.len(), patches * per_patch);
        assert!(a.iter().all(|s| s.is_finite()));
        let (b, _) = run(None, 7);
        assert_eq!(a, b, "同一种子两次生成应逐样本相同");

        let wave: Vec<f32> = (0..60).map(|i| (i as f32 * 0.2).sin() * 0.5).collect();
        let plan = VoicePlan::Continuation {
            reference: model.encode_audio(&wave, false).unwrap(),
            prompt: model.encode_audio(&wave, true).unwrap(),
            prompt_text: "a".into(),
        };
        // 续写种子（3 个 prompt patch）解码后被裁掉，剩下的正好是新生成的 patch。
        let (c, patches) = run(Some(&plan), 3);
        assert_eq!(c.len(), patches * per_patch);
    }

    #[test]
    fn progress_returning_false_cancels_generation() {
        let _mlx = super::super::tests::mlx_lock();
        let model = super::super::tests::tiny_model();
        let mut rng = Rng::new(1);
        let err = model
            .synthesize_text("abc", Some("开心"), None, sampling(6), &mut rng, &mut |_| false)
            .unwrap_err();
        assert!(err.to_string().contains(ABORT_MESSAGE), "{err}");
    }
}
