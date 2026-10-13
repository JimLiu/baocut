//! Adapted from soniqo/speech-swift Sources/FishAudioTTS (Apache-2.0).
//! Copyright 2025 Ivan Digital; Rust/MLX/Candle changes. License and scope: mod.rs.
//! DAC/RVQ codec adapted from speech-swift FishAudioCodec.swift.
//! NTC throughout; stored PyTorch convolution weights are transposed on load.
use super::backbone::Layer;
use super::config::BlockConfig;
use crate::synthesize::qwen3_tts::layers::{LayerNorm, Linear, RmsNorm};
use crate::synthesize::qwen3_tts::weights::Weights;
use crate::synthesize::tensor::ops::indexing::IndexOp;
use crate::synthesize::tensor::{Array, Dtype, gelu_same_dtype, ops};
use anyhow::{Result, ensure};

struct Conv {
    weight: Array,
    bias: Option<Array>,
    stride: i32,
    dilation: i32,
    groups: i32,
    transpose: bool,
}
impl Conv {
    fn load(w: &mut Weights, p: &str, stride: i32, dilation: i32, groups: i32, transpose: bool) -> Result<Self> {
        let key = format!("{p}.weight");
        let weight = if w.contains(&key) {
            w.take(&key)?.as_dtype(Dtype::Float32)?
        } else {
            let (g, v) = if w.contains(&format!("{p}.weight_g")) {
                (w.take(&format!("{p}.weight_g"))?, w.take(&format!("{p}.weight_v"))?)
            } else {
                (
                    w.take(&format!("{p}.parametrizations.weight.original0"))?,
                    w.take(&format!("{p}.parametrizations.weight.original1"))?,
                )
            };
            let v = v.as_dtype(Dtype::Float32)?;
            let norm = ops::sum_axis(ops::sum_axis(v.square()?, 2, true)?, 1, true)?.sqrt()?;
            v.multiply(g.as_dtype(Dtype::Float32)?)?
                .divide(ops::maximum(norm, Array::from_f32(1e-12))?)?
        };
        let weight = weight.transpose_axes(if transpose { &[1, 2, 0] } else { &[0, 2, 1] })?;
        weight.eval()?;
        crate::synthesize::tensor::host::clear_memory_cache()?;
        let bias = w
            .take_optional(&format!("{p}.bias"))
            .map(|v| v.as_dtype(Dtype::Float32))
            .transpose()?;
        Ok(Self {
            weight,
            bias,
            stride,
            dilation,
            groups,
            transpose,
        })
    }
    fn forward(&self, x: &Array) -> Result<Array> {
        let mut y = if self.transpose {
            // Each tile includes preceding input frames whose kernels overlap
            // its output. Slice out only this tile's causal stride-sized body;
            // neither seam samples nor overlap contributions are duplicated.
            let kernel = self.weight.dim(1);
            ensure!(kernel >= self.stride, "invalid Fish transpose convolution kernel");
            let context = (kernel - 1) / self.stride;
            let mut tiles = Vec::new();
            for first in (0..x.dim(1)).step_by(256) {
                let count = (x.dim(1) - first).min(256);
                let begin = (first - context).max(0);
                let raw = ops::conv_transpose1d(&x.index((.., begin..first + count, ..)), &self.weight, self.stride, 0, 1, 0, 1)?;
                let offset = (first - begin) * self.stride;
                let tile = raw.index((.., offset..offset + count * self.stride, ..));
                tile.eval()?;
                tiles.push(tile);
            }
            ops::concatenate_axis(&tiles, 1)?
        } else {
            let left = (self.weight.dim(1) - 1) * self.dilation + 1 - self.stride;
            let right = (self.stride - x.dim(1) % self.stride) % self.stride;
            let padded = ops::pad(x, &[(0, 0), (left, right), (0, 0)], Array::from_f32(0.0), None)?;
            // Long reference recordings otherwise make an im2col workspace
            // proportional to their full duration (hundreds of MB per layer).
            // Each output tile reads its exact receptive field from the padded
            // source, so causal boundaries and dilation remain unchanged.
            let outputs = (x.dim(1) + self.stride - 1) / self.stride;
            let kernel = (self.weight.dim(1) - 1) * self.dilation + 1;
            let mut tiles = Vec::new();
            for first in (0..outputs).step_by(1024) {
                let count = (outputs - first).min(1024);
                let begin = first * self.stride;
                let end = begin + (count - 1) * self.stride + kernel;
                let tile = ops::conv1d(
                    &padded.index((.., begin..end, ..)),
                    &self.weight,
                    self.stride,
                    0,
                    self.dilation,
                    self.groups,
                )?;
                tile.eval()?;
                tiles.push(tile);
            }
            ops::concatenate_axis(&tiles, 1)?
        };
        if let Some(b) = &self.bias {
            y = y.add(b)?;
        }
        Ok(y)
    }
}
struct Snake {
    alpha: Array,
}
impl Snake {
    fn load(w: &mut Weights, p: &str) -> Result<Self> {
        Ok(Self {
            alpha: w.take(&format!("{p}.alpha"))?.as_dtype(Dtype::Float32)?.reshape(&[1, 1, -1])?,
        })
    }
    fn forward(&self, x: &Array) -> Result<Array> {
        let s = x.multiply(&self.alpha)?.sin()?;
        Ok(x.add(s.square()?.divide(self.alpha.add(Array::from_f32(1e-9))?)?)?)
    }
}
struct Residual {
    s1: Snake,
    c1: Conv,
    s2: Snake,
    c2: Conv,
}
impl Residual {
    fn load(w: &mut Weights, p: &str, d: i32) -> Result<Self> {
        Ok(Self {
            s1: Snake::load(w, &format!("{p}.0"))?,
            c1: Conv::load(w, &format!("{p}.1.conv"), 1, d, 1, false)?,
            s2: Snake::load(w, &format!("{p}.2"))?,
            c2: Conv::load(w, &format!("{p}.3.conv"), 1, 1, 1, false)?,
        })
    }
    fn forward(&self, x: &Array) -> Result<Array> {
        Ok(x.add(self.c2.forward(&self.s2.forward(&self.c1.forward(&self.s1.forward(x)?)?)?)?)?)
    }
}
struct Next {
    conv: Conv,
    norm: LayerNorm,
    p1: Linear,
    p2: Linear,
    gamma: Array,
}
impl Next {
    fn load(w: &mut Weights, p: &str) -> Result<Self> {
        Ok(Self {
            conv: Conv::load(w, &format!("{p}.dwconv.conv"), 1, 1, 1024, false)?,
            norm: LayerNorm::load(w, &format!("{p}.norm"), 1e-6)?,
            p1: Linear::load(w, &format!("{p}.pwconv1"), 0, 0)?,
            p2: Linear::load(w, &format!("{p}.pwconv2"), 0, 0)?,
            gamma: w.take(&format!("{p}.gamma"))?,
        })
    }
    fn forward(&self, x: &Array) -> Result<Array> {
        let h = self.norm.forward(&self.conv.forward(x)?)?;
        Ok(x.add(self.p2.forward(&gelu_same_dtype(&self.p1.forward(&h)?)?)?.multiply(&self.gamma)?)?)
    }
}
struct Resample {
    conv: Conv,
    next: Next,
}
impl Resample {
    fn load(w: &mut Weights, p: &str, up: bool) -> Result<Self> {
        Ok(Self {
            conv: Conv::load(w, &format!("{p}.0.conv"), 2, 1, 1, up)?,
            next: Next::load(w, &format!("{p}.1"))?,
        })
    }
    fn forward(&self, x: &Array) -> Result<Array> {
        self.next.forward(&self.conv.forward(x)?)
    }
}
struct Transformer {
    layers: Vec<Layer>,
    norm: RmsNorm,
    window: usize,
}
impl Transformer {
    fn load(w: &mut Weights, p: &str, n: usize, window: usize) -> Result<Self> {
        let dims = BlockConfig {
            dim: 1024,
            n_layer: n,
            n_head: 16,
            n_local_heads: 16,
            head_dim: 64,
            intermediate_size: 3072,
            max_seq_len: 16384,
            rope_base: 10000.0,
            norm_eps: 1e-5,
            vocab_size: 0,
            attention_qk_norm: false,
            tie_word_embeddings: false,
            num_codebooks: 0,
        };
        // Upstream DAC applies RoPE to adjacent pairs, unlike Qwen's split halves.
        let layers = (0..n)
            .map(|i| Layer::load(w, &format!("{p}.layers.{i}"), &dims, true, true, 0, 0))
            .collect::<Result<_>>()?;
        w.take_optional(&format!("{p}.freqs_cis"));
        w.take_optional(&format!("{p}.causal_mask"));
        Ok(Self {
            layers,
            norm: RmsNorm::load(w, &format!("{p}.norm"), 1e-5)?,
            window,
        })
    }
    fn forward(&self, x: &Array) -> Result<Array> {
        let t = x.dim(1) as usize;
        let mask: Vec<f32> = (0..t)
            .flat_map(|r| (0..t).map(move |c| if c <= r && r - c < self.window { 0.0 } else { -1e9 }))
            .collect();
        let mask = Array::from_slice(&mask, &[1, 1, t as i32, t as i32]);
        let mut h = x.clone();
        for layer in &self.layers {
            h = layer.forward(&h, 0, None, Some(&mask))?.0;
            h.eval()?;
        }
        Ok(self.norm.forward(&h)?)
    }
}
struct Quantizer {
    table: Array,
    input: Option<Conv>,
    output: Conv,
}
impl Quantizer {
    fn load(w: &mut Weights, p: &str, encode: bool) -> Result<Self> {
        Ok(Self {
            table: w.take(&format!("{p}.codebook.weight"))?,
            input: if encode {
                Some(Conv::load(w, &format!("{p}.in_proj"), 1, 1, 1, false)?)
            } else {
                None
            },
            output: Conv::load(w, &format!("{p}.out_proj"), 1, 1, 1, false)?,
        })
    }
    fn decode(&self, ids: &Array) -> Result<Array> {
        self.output.forward(&self.table.index(ids))
    }
    fn encode(&self, x: &Array) -> Result<(Array, Array)> {
        // DAC selects by cosine distance, using normalized projected latents
        // and codebooks. Decode still uses the original, unnormalized table.
        let normalize = |v: &Array| -> Result<Array> {
            let norm = ops::sum_axis(v.square()?, -1, true)?.sqrt()?;
            Ok(v.divide(ops::maximum(norm, Array::from_f32(1e-12))?)?)
        };
        let x = normalize(
            &self
                .input
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Fish encoder not loaded"))?
                .forward(x)?,
        )?;
        let table = normalize(&self.table)?;
        let x2 = ops::sum_axis(x.square()?, -1, true)?;
        let c2 = ops::sum_axis(table.square()?, -1, true)?.t();
        let dist = x2.add(c2)?.subtract(ops::matmul(&x, table.t())?.multiply(Array::from_f32(2.0))?)?;
        let ids = ops::indexing::argmin_axis(&dist, -1, false)?.as_dtype(Dtype::Uint32)?;
        Ok((self.decode(&ids)?, ids))
    }
}
struct EncoderBlock {
    residuals: Vec<Residual>,
    snake: Snake,
    conv: Conv,
    transformer: Option<Transformer>,
}
impl EncoderBlock {
    fn load(w: &mut Weights, p: &str, rate: i32, last: bool) -> Result<Self> {
        Ok(Self {
            residuals: [1, 3, 9]
                .into_iter()
                .enumerate()
                .map(|(i, d)| Residual::load(w, &format!("{p}.{i}.block"), d))
                .collect::<Result<_>>()?,
            snake: Snake::load(w, &format!("{p}.3"))?,
            conv: Conv::load(w, &format!("{p}.4.conv"), rate, 1, 1, false)?,
            transformer: if last {
                Some(Transformer::load(w, &format!("{p}.5"), 4, 512)?)
            } else {
                None
            },
        })
    }
    fn forward(&self, x: &Array) -> Result<Array> {
        let mut h = x.clone();
        for r in &self.residuals {
            h = r.forward(&h)?;
            h.eval()?;
        }
        h = self.conv.forward(&self.snake.forward(&h)?)?;
        if let Some(t) = &self.transformer {
            h = t.forward(&h)?;
        }
        Ok(h)
    }
}
struct DecoderBlock {
    snake: Snake,
    conv: Conv,
    residuals: Vec<Residual>,
}
impl DecoderBlock {
    fn load(w: &mut Weights, p: &str, rate: i32) -> Result<Self> {
        Ok(Self {
            snake: Snake::load(w, &format!("{p}.0"))?,
            conv: Conv::load(w, &format!("{p}.1.conv"), rate, 1, 1, true)?,
            residuals: [1, 3, 9]
                .into_iter()
                .enumerate()
                .map(|(i, d)| Residual::load(w, &format!("{p}.{}.block", i + 2), d))
                .collect::<Result<_>>()?,
        })
    }
    fn forward(&self, x: &Array) -> Result<Array> {
        let mut h = self.conv.forward(&self.snake.forward(x)?)?;
        for r in &self.residuals {
            h = r.forward(&h)?;
            h.eval()?;
        }
        Ok(h)
    }
}
pub(super) struct Codec {
    encoder_in: Option<Conv>,
    encoder_blocks: Vec<EncoderBlock>,
    encoder_snake: Option<Snake>,
    encoder_out: Option<Conv>,
    down: Vec<Resample>,
    pre: Option<Transformer>,
    quantizers: Vec<Quantizer>,
    post: Option<Transformer>,
    up: Vec<Resample>,
    decoder_in: Option<Conv>,
    decoder_blocks: Vec<DecoderBlock>,
    decoder_snake: Option<Snake>,
    decoder_out: Option<Conv>,
}
pub(super) fn keep_weight(key: &str, encode: bool) -> bool {
    if key.ends_with("causal_mask") || key.ends_with("freqs_cis") {
        return false;
    }
    let common = key.starts_with("quantizer.semantic_quantizer.") || key.starts_with("quantizer.quantizer.");
    if encode {
        common || key.starts_with("encoder.") || key.starts_with("quantizer.downsample.") || key.starts_with("quantizer.pre_module.")
    } else {
        (common && !key.contains(".in_proj."))
            || key.starts_with("decoder.")
            || key.starts_with("quantizer.upsample.")
            || key.starts_with("quantizer.post_module.")
    }
}
impl Codec {
    pub fn load(w: &mut Weights, encode: bool) -> Result<Self> {
        let codec = Self {
            encoder_in: if encode {
                Some(Conv::load(w, "encoder.block.0.conv", 1, 1, 1, false)?)
            } else {
                None
            },
            encoder_blocks: if encode {
                [2, 4, 8, 8]
                    .into_iter()
                    .enumerate()
                    .map(|(i, r)| EncoderBlock::load(w, &format!("encoder.block.{}.block", i + 1), r, i == 3))
                    .collect::<Result<_>>()?
            } else {
                Vec::new()
            },
            encoder_snake: if encode { Some(Snake::load(w, "encoder.block.5")?) } else { None },
            encoder_out: if encode {
                Some(Conv::load(w, "encoder.block.6.conv", 1, 1, 1, false)?)
            } else {
                None
            },
            down: if encode {
                (0..2)
                    .map(|i| Resample::load(w, &format!("quantizer.downsample.{i}"), false))
                    .collect::<Result<_>>()?
            } else {
                Vec::new()
            },
            pre: if encode {
                Some(Transformer::load(w, "quantizer.pre_module", 8, 128)?)
            } else {
                None
            },
            quantizers: (0..super::CODEBOOKS)
                .map(|i| {
                    Quantizer::load(
                        w,
                        &if i == 0 {
                            "quantizer.semantic_quantizer.quantizers.0".into()
                        } else {
                            format!("quantizer.quantizer.quantizers.{}", i - 1)
                        },
                        encode,
                    )
                })
                .collect::<Result<_>>()?,
            post: if !encode {
                Some(Transformer::load(w, "quantizer.post_module", 8, 128)?)
            } else {
                None
            },
            up: if !encode {
                (0..2)
                    .map(|i| Resample::load(w, &format!("quantizer.upsample.{i}"), true))
                    .collect::<Result<_>>()?
            } else {
                Vec::new()
            },
            decoder_in: if !encode {
                Some(Conv::load(w, "decoder.model.0.conv", 1, 1, 1, false)?)
            } else {
                None
            },
            decoder_blocks: if !encode {
                [8, 8, 4, 2]
                    .into_iter()
                    .enumerate()
                    .map(|(i, r)| DecoderBlock::load(w, &format!("decoder.model.{}.block", i + 1), r))
                    .collect::<Result<_>>()?
            } else {
                Vec::new()
            },
            decoder_snake: if !encode { Some(Snake::load(w, "decoder.model.5")?) } else { None },
            decoder_out: if !encode {
                Some(Conv::load(w, "decoder.model.6.conv", 1, 1, 1, false)?)
            } else {
                None
            },
        };
        ensure!(w.keys().is_empty(), "unconsumed Fish codec weights: {:?}", w.keys());
        Ok(codec)
    }
    pub fn encode(&self, samples: &[f32]) -> Result<Vec<Vec<i32>>> {
        ensure!(!samples.is_empty(), "empty Fish reference audio");
        let mut padded = samples.to_vec();
        padded.resize(samples.len().div_ceil(super::SAMPLES_PER_FRAME) * super::SAMPLES_PER_FRAME, 0.0);
        let mut h = self
            .encoder_in
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Fish codec stage not loaded"))?
            .forward(&Array::from_slice(&padded, &[1, padded.len() as i32, 1]))?;
        for block in &self.encoder_blocks {
            h = block.forward(&h)?;
            h.eval()?;
        }
        h = self
            .encoder_out
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Fish codec stage not loaded"))?
            .forward(
                &self
                    .encoder_snake
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("Fish codec stage not loaded"))?
                    .forward(&h)?,
            )?;
        for block in &self.down {
            h = block.forward(&h)?;
            h.eval()?;
        }
        h = self
            .pre
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Fish codec stage not loaded"))?
            .forward(&h)?;
        let mut codes = Vec::new();
        for q in &self.quantizers {
            let (quantized, ids) = q.encode(&h)?;
            h = h.subtract(quantized)?;
            ids.eval()?;
            codes.push(ids.as_slice::<u32>().iter().map(|&id| id as i32).collect());
        }
        Ok(codes)
    }
    pub fn decode(&self, codes: &[Vec<i32>]) -> Result<Vec<f32>> {
        ensure!(codes.len() == super::CODEBOOKS && !codes[0].is_empty(), "invalid Fish audio codes");
        let n = codes[0].len();
        let mut h = ops::zeros::<f32>(&[1, n as i32, 1024])?;
        for (q, row) in self.quantizers.iter().zip(codes) {
            ensure!(
                row.len() == n && row.iter().all(|&v| v >= 0 && v < q.table.dim(0)),
                "invalid Fish codebook value"
            );
            h = h.add(q.decode(&Array::from_slice(row, &[1, n as i32]))?)?;
            h.eval()?;
        }
        h = self
            .post
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Fish codec stage not loaded"))?
            .forward(&h)?;
        for b in &self.up {
            h = b.forward(&h)?;
            h.eval()?;
        }
        h = self
            .decoder_in
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Fish codec stage not loaded"))?
            .forward(&h)?;
        for (index, b) in self.decoder_blocks.iter().enumerate() {
            h = b.forward(&h)?;
            h.eval()?;
            super::memory::trace(&format!("decode-block-{index}"));
        }
        let wave = ops::tanh(
            self.decoder_out
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Fish codec stage not loaded"))?
                .forward(
                    &self
                        .decoder_snake
                        .as_ref()
                        .ok_or_else(|| anyhow::anyhow!("Fish codec stage not loaded"))?
                        .forward(&h)?,
                )?,
        )?
        .reshape(&[-1])?;
        wave.eval()?;
        let samples = wave.as_slice::<f32>().to_vec();
        ensure!(
            samples.len() == n * super::SAMPLES_PER_FRAME && samples.iter().all(|v| v.is_finite()),
            "invalid Fish waveform"
        );
        Ok(samples)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn codec_stage_filter_skips_large_buffers_and_the_opposite_stage() {
        assert!(!keep_weight("encoder.block.4.block.5.causal_mask", true));
        assert!(!keep_weight("quantizer.post_module.freqs_cis", false));
        assert!(keep_weight("encoder.block.0.conv.weight", true));
        assert!(!keep_weight("encoder.block.0.conv.weight", false));
        assert!(keep_weight("decoder.model.0.conv.weight", false));
        assert!(!keep_weight("decoder.model.0.conv.weight", true));
        assert!(keep_weight("quantizer.quantizer.quantizers.0.in_proj.weight", true));
        assert!(!keep_weight("quantizer.quantizer.quantizers.0.in_proj.weight", false));
    }
    #[test]
    fn dac_quantization_uses_normalized_distance_and_original_decode_vectors() {
        let _lock = crate::synthesize::tensor::host::TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        crate::synthesize::tensor::host::ensure_device().unwrap();
        let identity = || Conv {
            weight: Array::from_slice(&[1.0f32, 0.0, 0.0, 1.0], &[2, 1, 2]),
            bias: None,
            stride: 1,
            dilation: 1,
            groups: 1,
            transpose: false,
        };
        let q = Quantizer {
            table: Array::from_slice(&[8.0f32, 6.0, 1.0, 0.0], &[2, 2]),
            input: Some(identity()),
            output: identity(),
        };
        let (decoded, ids) = q.encode(&Array::from_slice(&[0.8f32, 0.6], &[1, 1, 2])).unwrap();
        ids.eval().unwrap();
        decoded.eval().unwrap();
        assert_eq!(ids.as_slice::<u32>().to_vec(), vec![0]);
        assert_eq!(decoded.as_slice::<f32>().to_vec(), vec![8.0, 6.0]);
    }
    #[test]
    fn tiled_causal_convolution_preserves_samples_across_tile_boundaries() {
        let _lock = crate::synthesize::tensor::host::TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        crate::synthesize::tensor::host::ensure_device().unwrap();
        let conv = Conv {
            weight: Array::from_slice(&[1.0f32; 3], &[1, 3, 1]),
            bias: None,
            stride: 1,
            dilation: 2,
            groups: 1,
            transpose: false,
        };
        let values: Vec<f32> = (0..2063).map(|i| i as f32).collect();
        let y = conv.forward(&Array::from_slice(&values, &[1, 2063, 1])).unwrap();
        y.eval().unwrap();
        for (i, v) in y.as_slice::<f32>().iter().enumerate() {
            let expected = values[i] + i.checked_sub(2).map_or(0.0, |j| values[j]) + i.checked_sub(4).map_or(0.0, |j| values[j]);
            assert!((v - expected).abs() < 1e-4, "sample {i}");
        }
    }
    #[test]
    fn tiled_transpose_convolution_keeps_overlap_at_every_seam() {
        let _lock = crate::synthesize::tensor::host::TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        crate::synthesize::tensor::host::ensure_device().unwrap();
        let conv = Conv {
            weight: Array::from_slice(&[1.0f32; 4], &[1, 4, 1]),
            bias: None,
            stride: 2,
            dilation: 1,
            groups: 1,
            transpose: true,
        };
        let values: Vec<f32> = (0..773).map(|i| i as f32 + 1.0).collect();
        let y = conv.forward(&Array::from_slice(&values, &[1, 773, 1])).unwrap();
        y.eval().unwrap();
        assert_eq!(y.dim(1), 1546);
        for (i, v) in y.as_slice::<f32>().iter().enumerate() {
            let frame = i / 2;
            let expected = values[frame] + frame.checked_sub(1).map_or(0.0, |j| values[j]);
            assert!((v - expected).abs() < 1e-4, "sample {i}");
        }
    }
    #[test]
    fn causal_convolution_pads_to_a_whole_stride() {
        let _lock = crate::synthesize::tensor::host::TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        crate::synthesize::tensor::host::ensure_device().unwrap();
        let conv = Conv {
            weight: Array::from_slice(&[1.0f32, 1.0, 1.0, 1.0], &[1, 4, 1]),
            bias: None,
            stride: 2,
            dilation: 1,
            groups: 1,
            transpose: false,
        };
        let y = conv.forward(&Array::from_slice(&[1.0f32, 2.0, 3.0, 4.0, 5.0], &[1, 5, 1])).unwrap();
        y.eval().unwrap();
        assert_eq!(y.as_slice::<f32>().to_vec(), vec![3.0, 10.0, 12.0]);
    }
}
