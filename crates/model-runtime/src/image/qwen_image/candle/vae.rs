//! Qwen-Image-2.1 VAE 的单帧解码器（移植自 v2 `bcut-image-local::candle::vae`）。发布的 MLX checkpoint 把卷积核存成
//! `[out, kh, kw, in]`，candle 要 NCHW 与 `[out, in, kh, kw]`。解码器按需读每个卷积，高分辨率的尾段按行条带处理，
//! 条带上下各留 12 行重叠（与 Metal 实现相同）。

use anyhow::{Result, bail};
use candle_core::{DType, Device, Tensor};
use serde::Deserialize;
use std::path::Path;

use super::weights::ShardedWeights;
use crate::backend::candle::layers::scaled_dot_product_attention;
use crate::image::Cancelled;

const DECODER_BASE: usize = 144;
const MULT: [usize; 5] = [1, 2, 4, 8, 8];
const TEMPORAL_DOWN: [bool; 4] = [false, true, true, true];
const TAIL_FROM: usize = 2;
const HALO: usize = 12;
const BAND_ELEMS: usize = 64 << 20;
pub const Z_DIM: usize = 64;

fn attend(q: &Tensor, k: &Tensor, v: &Tensor, channels: usize) -> Result<Tensor> {
    scaled_dot_product_attention(
        &q.contiguous()?,
        &k.contiguous()?,
        &v.contiguous()?,
        (channels as f64).sqrt().recip(),
        None,
    )
}

fn conv_nhwc(x: &Tensor, w: &Tensor, pad: usize, stride: usize) -> Result<Tensor> {
    let (_, _, _, input) = x.dims4()?;
    let (_, _, _, kernel_input) = w.dims4()?;
    if input != kernel_input {
        bail!("VAE 卷积输入通道数不匹配");
    }
    let w = w.permute((0, 3, 1, 2))?.contiguous()?;
    let nchw = x.permute((0, 3, 1, 2))?.contiguous()?;
    Ok(nchw.conv2d(&w, pad, stride, 1, 1)?.permute((0, 2, 3, 1))?.contiguous()?)
}

#[derive(Deserialize)]
struct VaeConfig {
    #[serde(rename = "_class_name")]
    class_name: String,
    decoder_base_dim: usize,
    dim_mult: Vec<usize>,
    out_channels: usize,
    scale_factor_spatial: usize,
    z_dim: usize,
    mlx_format: bool,
    latents_mean: Vec<f32>,
    latents_std: Vec<f32>,
}

pub struct Decoder {
    weights: ShardedWeights,
    mean: Tensor,
    std: Tensor,
    device: Device,
    dtype: DType,
}

impl Decoder {
    /// `files` 是 `vae/` 下按清单取出的 safetensors，`config` 是 `vae/config.json`。
    pub fn load(files: &[&Path], config: &Path, device: &Device, dtype: DType) -> Result<Self> {
        let config: VaeConfig = serde_json::from_str(&std::fs::read_to_string(config)?)?;
        if config.class_name != "AutoencoderKLQwenImage21"
            || config.decoder_base_dim != DECODER_BASE
            || config.dim_mult.as_slice() != MULT.as_slice()
            || config.out_channels != 4
            || config.scale_factor_spatial != 16
            || config.z_dim != Z_DIM
            || !config.mlx_format
        {
            bail!("vae/config.json 与 Qwen-Image-2.1 MLX 解码器不符");
        }
        if config.latents_mean.len() != Z_DIM || config.latents_std.len() != Z_DIM {
            bail!("VAE latents_mean/std 长度必须为 {Z_DIM}");
        }
        let weights = ShardedWeights::open(files)?;
        let shape = weights.metadata("post_quant_conv.weight")?.0;
        if shape.as_slice() != [Z_DIM, 1, 1, Z_DIM].as_slice() {
            bail!("VAE 权重需要 MLX NHWC 卷积布局，实际 {shape:?}");
        }
        Ok(Self {
            weights,
            mean: Tensor::from_vec(config.latents_mean, (1, 1, 1, Z_DIM), device)?,
            std: Tensor::from_vec(config.latents_std, (1, 1, 1, Z_DIM), device)?,
            device: device.clone(),
            dtype,
        })
    }

    fn conv(&self, p: &str, x: &Tensor, pad: usize, stride: usize) -> Result<Tensor> {
        let w = self.weights.load(&format!("{p}.weight"), &self.device)?.to_dtype(self.dtype)?;
        let y = conv_nhwc(&x.to_dtype(self.dtype)?, &w, pad, stride)?;
        let bias = self.weights.load(&format!("{p}.bias"), &self.device)?.to_dtype(self.dtype)?;
        Ok(y.broadcast_add(&bias)?)
    }

    fn rms(&self, p: &str, x: &Tensor) -> Result<Tensor> {
        let gamma = self.weights.load(&format!("{p}.gamma"), &self.device)?.to_dtype(self.dtype)?;
        Ok(candle_nn::ops::rms_norm(
            &x.to_dtype(self.dtype)?.contiguous()?,
            &gamma.contiguous()?,
            1e-12,
        )?)
    }

    fn resnet(&self, p: &str, x: &Tensor, out: usize) -> Result<Tensor> {
        let shortcut = if x.dim(3)? == out {
            x.clone()
        } else {
            self.conv(&format!("{p}.conv_shortcut"), x, 0, 1)?
        };
        let y = self.rms(&format!("{p}.norm1"), x)?;
        let y = self.conv(&format!("{p}.conv1"), &candle_nn::ops::silu(&y)?, 1, 1)?;
        let y = self.rms(&format!("{p}.norm2"), &y)?;
        let y = self.conv(&format!("{p}.conv2"), &candle_nn::ops::silu(&y)?, 1, 1)?;
        Ok((y + shortcut)?)
    }

    fn attention(&self, p: &str, x: &Tensor) -> Result<Tensor> {
        let (_, h, w, c) = x.dims4()?;
        let normalized = self.rms(&format!("{p}.norm"), x)?;
        let qkv = self.conv(&format!("{p}.to_qkv"), &normalized, 0, 1)?.reshape((1, h * w, 3 * c))?;
        let q = qkv.narrow(2, 0, c)?.unsqueeze(1)?;
        let k = qkv.narrow(2, c, c)?.unsqueeze(1)?;
        let v = qkv.narrow(2, 2 * c, c)?.unsqueeze(1)?;
        let o = attend(&q, &k, &v, c)?;
        let o = self.conv(&format!("{p}.proj"), &o.reshape((1, h, w, c))?, 0, 1)?;
        Ok((x + o)?)
    }

    fn upsample2x(x: &Tensor) -> Result<Tensor> {
        let (_, h, w, c) = x.dims4()?;
        Ok(x.reshape((1, h, 1, w, 1, c))?
            .broadcast_as((1, h, 2, w, 2, c))?
            .reshape((1, 2 * h, 2 * w, c))?)
    }

    /// 单帧的 DupUp3D：时间维只取最后一帧对应的通道，再把通道摊到 2×2 的空间块上。
    fn dup_up(x: &Tensor, out: usize, ft: usize) -> Result<Tensor> {
        let (_, h, w, input) = x.dims4()?;
        let repeat = out * ft * 4 / input;
        if repeat == 0 {
            bail!("VAE DupUp3D 通道比例无效");
        }
        let mut indices = Vec::with_capacity(out * 4);
        for b1 in 0..2 {
            for b2 in 0..2 {
                for o in 0..out {
                    indices.push(((o * ft * 4 + (ft - 1) * 4 + b1 * 2 + b2) / repeat) as u32);
                }
            }
        }
        let ids = Tensor::from_vec(indices, out * 4, x.device())?;
        Ok(x.contiguous()?
            .index_select(&ids, 3)?
            .reshape((1, h, w, 2, 2, out))?
            .permute((0, 1, 3, 2, 4, 5))?
            .reshape((1, 2 * h, 2 * w, out))?)
    }

    fn upblock(&self, index: usize, input: &Tensor, cancel: &dyn Fn() -> bool) -> Result<Tensor> {
        let dims = [1152, 1152, 1152, 576, 288, 144];
        let output_dim = dims[index + 1];
        let p = format!("decoder.up_blocks.{index}");
        let mut y = input.clone();
        for j in 0..3 {
            if cancel() {
                return Err(Cancelled.into());
            }
            y = self.resnet(&format!("{p}.resnets.{j}"), &y, output_dim)?;
        }
        if index < 4 {
            let ft = if TEMPORAL_DOWN.iter().rev().copied().collect::<Vec<_>>()[index] {
                2
            } else {
                1
            };
            let shortcut = Self::dup_up(input, output_dim, ft)?;
            let up = Self::upsample2x(&y)?;
            y = (self.conv(&format!("{p}.upsampler.resample.1"), &up, 1, 1)? + shortcut)?;
        }
        Ok(y)
    }

    /// 高分辨率的尾段按相互重叠的行条带重算。12 行的重叠覆盖 up_blocks 2..4 与 conv_out 的全部 3×3 卷积。
    pub fn decode(&self, latents: &Tensor, cancel: &dyn Fn() -> bool) -> Result<Tensor> {
        let (_, gh, gw, channels) = latents.dims4()?;
        if channels != Z_DIM {
            bail!("VAE latent 通道数必须为 {Z_DIM}");
        }
        let z = latents
            .to_dtype(DType::F32)?
            .broadcast_mul(&self.std)?
            .broadcast_add(&self.mean)?
            .to_dtype(self.dtype)?;
        let x = self.conv("post_quant_conv", &z, 0, 1)?;
        let x = self.conv("decoder.conv_in", &x, 1, 1)?;
        if cancel() {
            return Err(Cancelled.into());
        }
        let x = self.resnet("decoder.mid_block.resnets.0", &x, DECODER_BASE * MULT[4])?;
        let x = self.attention("decoder.mid_block.attentions.0", &x)?;
        let x = self.resnet("decoder.mid_block.resnets.1", &x, DECODER_BASE * MULT[4])?;
        let x = self.upblock(0, &x, cancel)?;
        let x = self.upblock(1, &x, cancel)?;
        let (_, h, width, _) = x.dims4()?;
        if h != gh * 4 || width != gw * 4 {
            bail!("VAE 前段尺寸不符");
        }
        let per_row = 16 * width * 288;
        let rows = (BAND_ELEMS / per_row.max(1)).saturating_sub(2 * HALO).max(HALO);
        let rows = rows.min(h);
        let mut strips = Vec::new();
        for start in (0..h).step_by(rows) {
            if cancel() {
                return Err(Cancelled.into());
            }
            let end = (start + rows).min(h);
            let a = start.saturating_sub(HALO);
            let b = (end + HALO).min(h);
            let mut y = x.narrow(1, a, b - a)?;
            for index in TAIL_FROM..5 {
                y = self.upblock(index, &y, cancel)?;
            }
            let normalized = self.rms("decoder.norm_out", &y)?;
            let y = self.conv("decoder.conv_out", &candle_nn::ops::silu(&normalized)?, 1, 1)?;
            let y = y.narrow(1, (start - a) * 4, (end - start) * 4)?;
            if y.to_dtype(DType::F32)?
                .flatten_all()?
                .to_vec1::<f32>()?
                .iter()
                .any(|value| !value.is_finite())
            {
                bail!("VAE 解码出现非有限像素值");
            }
            strips.push(y.clamp(-1.0, 1.0)?);
        }
        let out = Tensor::cat(&strips.iter().collect::<Vec<_>>(), 1)?;
        if out.dim(1)? != gh * 16 || out.dim(2)? != gw * 16 || out.dim(3)? != 4 {
            bail!("VAE 解码尺寸与请求不符");
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "cuda")]
    #[test]
    #[ignore = "requires an NVIDIA CUDA device"]
    fn cuda_attention_accepts_narrow_q_channels() {
        let device = Device::new_cuda(0).expect("CUDA device 0 is required");
        let channels = 1152;
        let qkv = Tensor::ones((1, 1024, 3 * channels), DType::BF16, &device).unwrap();
        let q = qkv.narrow(2, 0, channels).unwrap().unsqueeze(1).unwrap();
        let k = qkv.narrow(2, channels, channels).unwrap().unsqueeze(1).unwrap();
        let v = qkv.narrow(2, 2 * channels, channels).unwrap().unsqueeze(1).unwrap();
        assert!(!q.is_contiguous());
        let old = scaled_dot_product_attention(
            &q,
            &k.contiguous().unwrap(),
            &v.contiguous().unwrap(),
            (channels as f64).sqrt().recip(),
            None,
        );
        let old_error = old.expect_err("CUDA matmul must reject the original Q layout");
        assert!(
            old_error.to_string().contains("contiguous"),
            "unexpected old-layout error: {old_error}"
        );
        let output = attend(&q, &k, &v, channels).unwrap();
        assert_eq!(output.dims(), &[1, 1, 1024, channels]);
        let mean = output.to_dtype(DType::F32).unwrap().mean_all().unwrap().to_scalar::<f32>().unwrap();
        assert!((mean - 1.0).abs() < 0.02);
    }

    #[test]
    fn dup_up_matches_first_frame_channel_shuffle() {
        let x = Tensor::from_vec(vec![10.0_f32, 20.0, 30.0, 40.0], (1, 1, 1, 4), &Device::Cpu).unwrap();
        let out = Decoder::dup_up(&x, 2, 1).unwrap();
        assert_eq!(out.dims(), &[1, 2, 2, 2]);
        assert_eq!(
            out.flatten_all().unwrap().to_vec1::<f32>().unwrap(),
            vec![10.0, 30.0, 10.0, 30.0, 20.0, 40.0, 20.0, 40.0]
        );
    }

    #[test]
    fn mlx_nhwc_kernel_matches_small_convolution() {
        let x = Tensor::from_vec(vec![1.0_f32, 2.0, 3.0, 4.0], (1, 2, 2, 1), &Device::Cpu).unwrap();
        let w = Tensor::from_vec(vec![1.0_f32, 2.0, 3.0, 4.0], (1, 2, 2, 1), &Device::Cpu).unwrap();
        let y = conv_nhwc(&x, &w, 0, 1).unwrap();
        assert_eq!(y.dims(), &[1, 1, 1, 1]);
        assert_eq!(y.flatten_all().unwrap().to_vec1::<f32>().unwrap(), vec![30.0]);
    }
}
