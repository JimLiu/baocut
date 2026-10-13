//! Adapted from soniqo/speech-swift Sources/FishAudioTTS (Apache-2.0).
//! Copyright 2025 Ivan Digital; Rust/MLX/Candle changes. License and scope: mod.rs.
use super::config::{BlockConfig, Config};
use super::projection::Projection as Linear;
use super::vocabulary::{COMPACT_EOS, Vocabulary};
use crate::synthesize::qwen3_tts::layers::{KvCache, RmsNorm};
use crate::synthesize::qwen3_tts::weights::Weights;
use crate::synthesize::tensor::nn::silu;
use crate::synthesize::tensor::ops::indexing::IndexOp;
use crate::synthesize::tensor::{Array, Dtype, fast, ops};
use anyhow::{Result, ensure};

pub(super) struct Layer {
    qkv: Linear,
    out: Linear,
    q_norm: Option<RmsNorm>,
    k_norm: Option<RmsNorm>,
    attention_norm: RmsNorm,
    ffn_norm: RmsNorm,
    w1: Linear,
    w2: Linear,
    w3: Linear,
    dims: BlockConfig,
    traditional: bool,
    scales: Option<(Array, Array)>,
}
impl Layer {
    pub fn load(w: &mut Weights, p: &str, dims: &BlockConfig, traditional: bool, scaled: bool, group: usize, bits: u32) -> Result<Self> {
        Ok(Self {
            qkv: Linear::load(w, &format!("{p}.attention.wqkv"), group, bits)?,
            out: Linear::load(w, &format!("{p}.attention.wo"), group, bits)?,
            q_norm: if dims.attention_qk_norm {
                Some(RmsNorm::load(w, &format!("{p}.attention.q_norm"), dims.norm_eps)?)
            } else {
                None
            },
            k_norm: if dims.attention_qk_norm {
                Some(RmsNorm::load(w, &format!("{p}.attention.k_norm"), dims.norm_eps)?)
            } else {
                None
            },
            attention_norm: RmsNorm::load(w, &format!("{p}.attention_norm"), dims.norm_eps)?,
            ffn_norm: RmsNorm::load(w, &format!("{p}.ffn_norm"), dims.norm_eps)?,
            w1: Linear::load(w, &format!("{p}.feed_forward.w1"), group, bits)?,
            w2: Linear::load(w, &format!("{p}.feed_forward.w2"), group, bits)?,
            w3: Linear::load(w, &format!("{p}.feed_forward.w3"), group, bits)?,
            dims: dims.clone(),
            traditional,
            scales: if scaled {
                Some((
                    w.take(&format!("{p}.attention_layer_scale.gamma"))?,
                    w.take(&format!("{p}.ffn_layer_scale.gamma"))?,
                ))
            } else {
                None
            },
        })
    }
    pub fn forward(&self, x: &Array, offset: i32, cache: Option<&KvCache>, mask: Option<&Array>) -> Result<(Array, KvCache)> {
        let d = &self.dims;
        let (b, t) = (x.dim(0), x.dim(1));
        let (qd, kd, hd) = (
            (d.n_head * d.head_dim) as i32,
            (d.n_local_heads * d.head_dim) as i32,
            d.head_dim as i32,
        );
        let qkv = self.qkv.forward(&self.attention_norm.forward(x)?)?;
        let mut q = qkv.index((.., .., ..qd)).reshape(&[b, t, d.n_head as i32, hd])?;
        let mut k = qkv.index((.., .., qd..qd + kd)).reshape(&[b, t, d.n_local_heads as i32, hd])?;
        let v = qkv
            .index((.., .., qd + kd..))
            .reshape(&[b, t, d.n_local_heads as i32, hd])?
            .transpose_axes(&[0, 2, 1, 3])?;
        if let Some(n) = &self.q_norm {
            q = n.forward(&q)?;
        }
        if let Some(n) = &self.k_norm {
            k = n.forward(&k)?;
        }
        q = fast::rope(
            &q.transpose_axes(&[0, 2, 1, 3])?,
            hd,
            self.traditional,
            d.rope_base,
            1.0,
            offset,
            None,
        )?;
        k = fast::rope(
            &k.transpose_axes(&[0, 2, 1, 3])?,
            hd,
            self.traditional,
            d.rope_base,
            1.0,
            offset,
            None,
        )?;
        let (k, v) = match cache {
            Some(c) => (
                ops::concatenate_axis(&[&c.keys, &k], 2)?,
                ops::concatenate_axis(&[&c.values, &v], 2)?,
            ),
            None => (k, v),
        };
        let mode = match mask {
            Some(m) => Some(fast::ScaledDotProductAttentionMask::Array(m)),
            None if t > 1 => Some(fast::ScaledDotProductAttentionMask::Causal),
            _ => None,
        };
        let attention = fast::scaled_dot_product_attention(&q, &k, &v, (d.head_dim as f32).sqrt().recip(), mode, None)?
            .transpose_axes(&[0, 2, 1, 3])?
            .reshape(&[b, t, qd])?;
        let mut attention = self.out.forward(&attention)?;
        if let Some((s, _)) = &self.scales {
            attention = attention.multiply(s)?;
        }
        let h = x.add(&attention)?;
        let n = self.ffn_norm.forward(&h)?;
        let mut ffn = self.w2.forward(&silu(self.w1.forward(&n)?)?.multiply(self.w3.forward(&n)?)?)?;
        if let Some((_, s)) = &self.scales {
            ffn = ffn.multiply(s)?;
        }
        Ok((h.add(ffn)?, KvCache { keys: k, values: v }))
    }
}

pub(super) struct State {
    pub caches: Vec<Option<KvCache>>,
    pub position: i32,
}
impl State {
    pub fn new(n: usize) -> Self {
        Self {
            caches: vec![None; n],
            position: 0,
        }
    }
}
pub(super) struct Backbone {
    embeddings: Linear,
    codebook_embeddings: Linear,
    slow_layers: Vec<Layer>,
    slow_norm: RmsNorm,
    slow_output: Option<Linear>,
    fast_embeddings: Linear,
    fast_layers: Vec<Layer>,
    fast_norm: RmsNorm,
    fast_output: Linear,
    pub config: Config,
    vocabulary: Vocabulary,
}
impl Backbone {
    pub fn load(w: &mut Weights, c: Config, vocabulary: Vocabulary) -> Result<Self> {
        let (group, bits) = c.quantization.as_ref().map_or((0, 0), |q| (q.group_size, q.bits));
        // The conversion keeps Hugging Face names; older exports use flat names.
        let mut slow = w.split_prefix("text_model.model.");
        let mut fast = w.split_prefix("audio_decoder.");
        let prefixed = !slow.keys().is_empty();
        let sw = if prefixed { &mut slow } else { &mut *w };
        let embeddings = Linear::load(sw, "embeddings", group, bits)?;
        let slow_norm = RmsNorm::load(sw, "norm", c.text_config.norm_eps)?;
        let slow_output = if c.text_config.tie_word_embeddings {
            None
        } else {
            Some(Linear::load(sw, "output", group, bits)?)
        };
        let slow_layers = (0..c.text_config.n_layer)
            .map(|i| Layer::load(sw, &format!("layers.{i}"), &c.text_config, true, false, group, bits))
            .collect::<Result<_>>()?;
        let (codebook_embeddings, fast_embeddings, fast_norm, fast_output, fast_layers) = if prefixed {
            (
                Linear::load(&mut fast, "codebook_embeddings", group, bits)?,
                Linear::load(&mut fast, "embeddings", group, bits)?,
                RmsNorm::load(&mut fast, "norm", c.audio_decoder_config.norm_eps)?,
                Linear::load(&mut fast, "output", group, bits)?,
                (0..c.audio_decoder_config.n_layer)
                    .map(|i| Layer::load(&mut fast, &format!("layers.{i}"), &c.audio_decoder_config, true, false, group, bits))
                    .collect::<Result<Vec<_>>>()?,
            )
        } else {
            (
                Linear::load(w, "codebook_embeddings", group, bits)?,
                Linear::load(w, "fast_embeddings", group, bits)?,
                RmsNorm::load(w, "fast_norm", c.audio_decoder_config.norm_eps)?,
                Linear::load(w, "fast_output", group, bits)?,
                (0..c.audio_decoder_config.n_layer)
                    .map(|i| Layer::load(w, &format!("fast_layers.{i}"), &c.audio_decoder_config, true, false, group, bits))
                    .collect::<Result<Vec<_>>>()?,
            )
        };
        ensure!(
            slow.keys().is_empty() && fast.keys().is_empty() && w.keys().is_empty(),
            "unconsumed Fish transformer weights"
        );
        Ok(Self {
            embeddings,
            codebook_embeddings,
            slow_layers,
            slow_norm,
            slow_output,
            fast_embeddings,
            fast_layers,
            fast_norm,
            fast_output,
            config: c,
            vocabulary,
        })
    }
    pub fn prefill(&self, rows: &[Vec<i32>], state: &mut State) -> Result<(Array, Array)> {
        let mut last = None;
        for start in (0..rows[0].len()).step_by(64) {
            let end = (start + 64).min(rows[0].len());
            let slice: Vec<_> = rows.iter().map(|row| row[start..end].to_vec()).collect();
            let result = self.slow(&slice, state)?;
            result.0.eval()?;
            result.1.eval()?;
            last = Some(result);
            crate::synthesize::tensor::host::clear_memory_cache()?;
        }
        last.ok_or_else(|| anyhow::anyhow!("empty Fish prefill"))
    }
    pub fn slow(&self, rows: &[Vec<i32>], state: &mut State) -> Result<(Array, Array)> {
        let n = rows[0].len() as i32;
        let ids = rows[0].iter().map(|&id| self.vocabulary.word(id)).collect::<Result<Vec<_>>>()?;
        let ids = Array::from_slice(&ids, &[1, n]);
        let text = self.embeddings.embedding(&ids)?;
        let mut sum = ops::zeros::<f32>(&[1, n, self.config.text_config.dim as i32])?.as_dtype(text.dtype())?;
        for (i, row) in rows[1..].iter().enumerate() {
            let ids = row.iter().map(|&id| Vocabulary::codebook(i, id)).collect::<Result<Vec<_>>>()?;
            sum = sum.add(self.codebook_embeddings.embedding(&Array::from_slice(&ids, &[1, n]))?)?;
        }
        let mask: Vec<f32> = rows[0]
            .iter()
            .map(|&id| {
                if (self.config.semantic_start_token_id..=self.config.semantic_end_token_id).contains(&id) {
                    1.0
                } else {
                    0.0
                }
            })
            .collect();
        let mask = Array::from_slice(&mask, &[1, n, 1]).as_dtype(text.dtype())?;
        let combined = text.add(sum.multiply(&mask)?)?;
        let scale = mask
            .multiply(Array::from_f32((super::CODEBOOKS as f32 + 1.0).sqrt().recip() - 1.0).as_dtype(text.dtype())?)?
            .add(Array::from_f32(1.0).as_dtype(text.dtype())?)?;
        let mut h = combined.multiply(scale)?;
        for (i, layer) in self.slow_layers.iter().enumerate() {
            let (next, cache) = layer.forward(&h, state.position, state.caches[i].as_ref(), None)?;
            crate::synthesize::tensor::transforms::eval([&next, &cache.keys, &cache.values])?;
            h = next;
            state.caches[i] = Some(cache);
        }
        state.position += n;
        let h = self.slow_norm.forward(&h.index((.., n - 1..n, ..)))?;
        let logits = match &self.slow_output {
            Some(out) => out.forward(&h)?,
            None => self.embeddings.first_rows(COMPACT_EOS + 1)?.forward(&h)?,
        };
        Ok((logits.as_dtype(Dtype::Float32)?, h))
    }
    pub fn fast(&self, x: &Array, state: &mut State) -> Result<Array> {
        let mut h = x.clone();
        for (i, layer) in self.fast_layers.iter().enumerate() {
            let (next, cache) = layer.forward(&h, state.position, state.caches[i].as_ref(), None)?;
            crate::synthesize::tensor::transforms::eval([&next, &cache.keys, &cache.values])?;
            h = next;
            state.caches[i] = Some(cache);
        }
        state.position += x.dim(1);
        Ok(self.fast_output.forward(&self.fast_norm.forward(&h)?)?.as_dtype(Dtype::Float32)?)
    }
    pub fn code_embedding(&self, id: i32) -> Result<Array> {
        self.fast_embeddings.embedding(&Array::from_slice(&[id], &[1, 1]))
    }
}
