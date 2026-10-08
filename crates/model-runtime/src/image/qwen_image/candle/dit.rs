//! Qwen-Image-2.1 单流 DiT 的 candle 流式实现（移植自 v2 `bcut-image-local::candle::dit`）。每个投影在用到时从映射的
//! MLX checkpoint 反量化；主机内存与 CUDA 显存里都不留整个模型的 dense 副本，同一时刻只留一层的矩阵。

use anyhow::{Result, anyhow, bail};
use candle_core::{DType, Device, Tensor};
use std::path::Path;
use std::{cell::RefCell, collections::HashMap};

use super::super::rope;
use super::weights::ShardedWeights;
use crate::backend::candle::layers::scaled_dot_product_attention;
use crate::image::Cancelled;

const DIM: usize = 4096;
const INTER: usize = 12288;
const HEADS: usize = 32;
const HEAD_DIM: usize = 128;
const LAYERS: usize = 32;
const EPS: f64 = 1e-6;

/// CUDA 的矩阵乘不收转置过的 q（不连续布局），先拷成连续的。
fn attend(q: &Tensor, k: &Tensor, v: &Tensor, mask: Option<&Tensor>) -> Result<Tensor> {
    scaled_dot_product_attention(
        &q.contiguous()?,
        &k.contiguous()?,
        &v.contiguous()?,
        (HEAD_DIM as f64).sqrt().recip(),
        mask,
    )
}

fn silu(x: &Tensor) -> Result<Tensor> {
    Ok(candle_nn::ops::silu(x)?)
}

fn tanh(x: &Tensor) -> Result<Tensor> {
    Ok(x.tanh()?)
}

fn norm(x: &Tensor) -> Result<Tensor> {
    let dtype = x.dtype();
    let f = x.to_dtype(DType::F32)?;
    let centered = f.broadcast_sub(&f.mean_keepdim(candle_core::D::Minus1)?)?;
    Ok(centered
        .broadcast_div(&(centered.sqr()?.mean_keepdim(candle_core::D::Minus1)? + EPS)?.sqrt()?)?
        .to_dtype(dtype)?)
}

fn rms(x: &Tensor, gamma: &Tensor) -> Result<Tensor> {
    Ok(candle_nn::ops::rms_norm(
        &x.contiguous()?,
        &gamma.to_dtype(x.dtype())?.contiguous()?,
        EPS as f32,
    )?)
}

fn modulate(x: &Tensor, scale: &Tensor) -> Result<Tensor> {
    Ok(norm(x)?.broadcast_mul(&(scale + 1.0)?)?)
}

/// 相邻两个通道是一对实部、虚部（与 MLX 实现一致），不是半分裂。
fn apply_rope(x: &Tensor, cos: &Tensor, sin: &Tensor) -> Result<Tensor> {
    let (batch, seq, heads, width) = x.dims4()?;
    if batch != 1 || heads != HEADS || width != HEAD_DIM {
        bail!("DiT RoPE 输入形状不符");
    }
    let dtype = x.dtype();
    let pairs = x.to_dtype(DType::F32)?.reshape((1, seq, heads, width / 2, 2))?;
    let a = pairs.narrow(4, 0, 1)?.squeeze(4)?;
    let b = pairs.narrow(4, 1, 1)?.squeeze(4)?;
    let c = cos.reshape((1, seq, 1, width / 2))?;
    let s = sin.reshape((1, seq, 1, width / 2))?;
    let real = (a.broadcast_mul(&c)? - b.broadcast_mul(&s)?)?;
    let imag = (a.broadcast_mul(&s)? + b.broadcast_mul(&c)?)?;
    Ok(Tensor::stack(&[&real, &imag], 4)?
        .reshape((1, seq, heads, width))?
        .to_dtype(dtype)?)
}

fn gelu_tanh_f32(x: &Tensor) -> Result<Tensor> {
    let f = x.to_dtype(DType::F32)?;
    let cubic = f.sqr()?.broadcast_mul(&f)?;
    let inner = (&f + &(cubic * 0.044715)?)?;
    let t = (inner * (2.0 / std::f64::consts::PI).sqrt())?.tanh()?;
    Ok((f.broadcast_mul(&(t + 1.0)?)? * 0.5)?)
}

#[derive(Clone)]
struct Mod {
    scale1: Tensor,
    gate1: Tensor,
    scale2: Tensor,
    gate2: Tensor,
}

struct TextPending {
    x: Tensor,
    mod_: Mod,
    cos: Tensor,
    sin: Tensor,
}

/// 文本流每层的 K、V：文本只在第一步算一遍，之后各步复用。
pub struct TextCache {
    kv: Vec<(Tensor, Tensor)>,
    text_len: usize,
    pending: Option<TextPending>,
}

pub struct Dit {
    weights: ShardedWeights,
    device: Device,
    dtype: DType,
    /// 一层的文本块与图像块都算完之前留着这层反量化出的矩阵；进下一层前清掉，CUDA 显存因此有界。
    layer_matrices: RefCell<HashMap<String, Tensor>>,
}

impl Dit {
    /// `files` 是 `transformer/` 下按清单取出的 safetensors。
    pub fn load(files: &[&Path], device: &Device, dtype: DType) -> Result<Self> {
        let weights = ShardedWeights::open(files)?;
        for i in 0..LAYERS {
            let key = format!("transformer_blocks.{i}.attn.to_q.weight");
            if !weights.contains(&key) {
                bail!("DiT 缺少第 {i} 层权重：{key}");
            }
        }
        Ok(Self {
            weights,
            device: device.clone(),
            dtype,
            layer_matrices: RefCell::new(HashMap::new()),
        })
    }

    fn pick(&self, names: &[&str]) -> Result<String> {
        names
            .iter()
            .find(|name| self.weights.contains(&format!("{name}.weight")))
            .map(|name| (*name).to_owned())
            .ok_or_else(|| anyhow!("DiT 缺少权重：{}", names.join(" / ")))
    }

    fn proj(&self, prefix: &str, x: &Tensor, input: usize) -> Result<Tensor> {
        let mut matrices = self.layer_matrices.borrow_mut();
        if !matrices.contains_key(prefix) {
            matrices.insert(prefix.to_owned(), self.weights.linear(prefix, input, &self.device, self.dtype)?);
        }
        let weight = &matrices[prefix];
        Ok(x.to_dtype(self.dtype)?.broadcast_matmul(&weight.t()?.contiguous()?)?)
    }

    fn temb(&self, sigma: f64) -> Result<Tensor> {
        let t = bf16_round(bf16_round((sigma * 1000.0) as f32) / 1000.0);
        let mut emb = vec![0.0_f32; 256];
        for i in 0..128 {
            let f = (-(10000.0_f32.ln()) * i as f32 / 128.0).exp();
            let a = 1000.0 * t * f;
            emb[i] = a.cos();
            emb[128 + i] = a.sin();
        }
        let x = Tensor::from_vec(emb, (1, 256), &self.device)?.to_dtype(self.dtype)?;
        let p1 = self.pick(&["time_text_embed.linear_1", "time_text_embed.timestep_embedder.linear_1"])?;
        let p2 = self.pick(&["time_text_embed.linear_2", "time_text_embed.timestep_embedder.linear_2"])?;
        self.proj(&p2, &silu(&self.proj(&p1, &x, 256)?)?, DIM)
    }

    fn mods(&self, temb: &Tensor) -> Result<Mod> {
        let p = self.pick(&["modulation.0", "modulation.1"])?;
        let m = self.proj(&p, &silu(temb)?, DIM)?;
        let part = |i| Ok::<_, anyhow::Error>(m.narrow(1, i * DIM, DIM)?.reshape((1, 1, DIM))?);
        Ok(Mod {
            scale1: part(0)?,
            gate1: part(1)?,
            scale2: part(2)?,
            gate2: part(3)?,
        })
    }

    fn tables(&self, cos: &[f32], sin: &[f32], from: usize, to: usize) -> Result<(Tensor, Tensor)> {
        let n = to - from;
        Ok((
            Tensor::from_slice(&cos[from * 64..to * 64], (n, 64), &self.device)?,
            Tensor::from_slice(&sin[from * 64..to * 64], (n, 64), &self.device)?,
        ))
    }

    pub fn prepare_text(&self, encoded: &Tensor, gh: usize, gw: usize) -> Result<TextCache> {
        let len = encoded.dim(1)?;
        let (all_cos, all_sin) = rope::dit_rope_tables(len, gh, gw);
        let (cos, sin) = self.tables(&all_cos, &all_sin, 0, len)?;
        let raw_norm = self.weights.load("txt_in.text_norm.weight", &self.device)?.to_dtype(DType::F32)?;
        let gamma = (raw_norm + 1.0)?;
        let normed = rms(&encoded.to_dtype(DType::F32)?, &gamma)?.to_dtype(self.dtype)?;
        let h = gelu_tanh_f32(&self.proj("txt_in.in_layer", &normed, DIM)?)?.to_dtype(self.dtype)?;
        let x = self.proj("txt_in.out_layer", &h, DIM)?.to_dtype(DType::F32)?;
        let mod_ = self.mods(&self.temb(0.0)?)?;
        Ok(TextCache {
            kv: Vec::with_capacity(LAYERS),
            text_len: len,
            pending: Some(TextPending { x, mod_, cos, sin }),
        })
    }

    fn qkv(&self, p: &str, xm: &Tensor, cos: &Tensor, sin: &Tensor) -> Result<(Tensor, Tensor, Tensor)> {
        let seq = xm.dim(1)?;
        let q = self.proj(&format!("{p}.attn.to_q"), xm, DIM)?.reshape((1, seq, HEADS, HEAD_DIM))?;
        let k = self.proj(&format!("{p}.attn.to_k"), xm, DIM)?.reshape((1, seq, HEADS, HEAD_DIM))?;
        let v = self.proj(&format!("{p}.attn.to_v"), xm, DIM)?.reshape((1, seq, HEADS, HEAD_DIM))?;
        let qw = self
            .weights
            .load(&format!("{p}.attn.norm_q.weight"), &self.device)?
            .to_dtype(self.dtype)?;
        let kw = self
            .weights
            .load(&format!("{p}.attn.norm_k.weight"), &self.device)?
            .to_dtype(self.dtype)?;
        let q = apply_rope(&rms(&q, &qw)?, cos, sin)?.transpose(1, 2)?;
        let k = apply_rope(&rms(&k, &kw)?, cos, sin)?.transpose(1, 2)?;
        Ok((q, k, v.transpose(1, 2)?))
    }

    fn finish(&self, p: &str, x: &Tensor, attn: &Tensor, m: &Mod) -> Result<Tensor> {
        let seq = attn.dim(2)?;
        let merged = attn.transpose(1, 2)?.reshape((1, seq, DIM))?;
        let a = self.proj(&format!("{p}.attn.to_out.0"), &merged, DIM)?.to_dtype(DType::F32)?;
        let g1 = tanh(&m.gate1.to_dtype(DType::F32)?)?;
        let x = x.broadcast_add(&g1.broadcast_mul(&a)?)?;
        let xm = modulate(&x, &m.scale2.to_dtype(DType::F32)?)?;
        let gate = self.proj(&format!("{p}.img_mlp.gate_layer"), &xm, DIM)?;
        let proj = self.proj(&format!("{p}.img_mlp.proj"), &xm, DIM)?;
        let h = silu(&gate)?.broadcast_mul(&proj)?;
        let h = self.proj(&format!("{p}.img_mlp.out"), &h, INTER)?.to_dtype(DType::F32)?;
        let g2 = tanh(&m.gate2.to_dtype(DType::F32)?)?;
        Ok(x.broadcast_add(&g2.broadcast_mul(&h)?)?)
    }

    fn text_layer(&self, p: &str, pending: &mut TextPending) -> Result<(Tensor, Tensor)> {
        let xm = modulate(&pending.x, &pending.mod_.scale1.to_dtype(DType::F32)?)?;
        let (q, k, v) = self.qkv(p, &xm, &pending.cos, &pending.sin)?;
        let len = q.dim(2)?;
        let mut mask = vec![0.0_f32; len * len];
        for r in 0..len {
            for c in r + 1..len {
                mask[r * len + c] = f32::NEG_INFINITY;
            }
        }
        let mask = Tensor::from_vec(mask, (1, 1, len, len), &self.device)?.to_dtype(self.dtype)?;
        let attended = attend(&q, &k, &v, Some(&mask))?;
        pending.x = self.finish(p, &pending.x, &attended, &pending.mod_)?;
        Ok((k, v))
    }

    /// 一步去噪，返回速度场。图像 token 按 `chunk` 个一块算 q 与输出；每层之前看一次 `cancel`。
    #[allow(clippy::too_many_arguments)]
    pub fn step(
        &self,
        cache: &mut TextCache,
        latents: &Tensor,
        sigma: f64,
        gh: usize,
        gw: usize,
        chunk: usize,
        cancel: &dyn Fn() -> bool,
    ) -> Result<Tensor> {
        let n = gh * gw;
        if latents.dim(1)? != n {
            bail!("DiT latent token 数不符");
        }
        let (all_cos, all_sin) = rope::dit_rope_tables(cache.text_len, gh, gw);
        let (cos, sin) = self.tables(&all_cos, &all_sin, cache.text_len, cache.text_len + n)?;
        let temb = self.temb(sigma)?;
        let mod_ = self.mods(&temb)?;
        let mut x = self.proj("img_in", &latents.to_dtype(self.dtype)?, 64)?.to_dtype(DType::F32)?;
        let chunk = chunk.max(1);
        for i in 0..LAYERS {
            if cancel() {
                return Err(Cancelled.into());
            }
            self.layer_matrices.borrow_mut().clear();
            let p = format!("transformer_blocks.{i}");
            if let Some(pending) = cache.pending.as_mut() {
                cache.kv.push(self.text_layer(&p, pending)?);
            }
            let (tk, tv) = &cache.kv[i];
            let mut q_parts = Vec::new();
            let mut k_parts = vec![tk.clone()];
            let mut v_parts = vec![tv.clone()];
            for start in (0..n).step_by(chunk) {
                let len = chunk.min(n - start);
                let xm = modulate(&x.narrow(1, start, len)?, &mod_.scale1.to_dtype(DType::F32)?)?;
                let (q, k, v) = self.qkv(&p, &xm, &cos.narrow(0, start, len)?, &sin.narrow(0, start, len)?)?;
                q_parts.push(q);
                k_parts.push(k);
                v_parts.push(v);
            }
            let k_refs = k_parts.iter().collect::<Vec<_>>();
            let v_refs = v_parts.iter().collect::<Vec<_>>();
            let k = Tensor::cat(&k_refs, 2)?.contiguous()?;
            let v = Tensor::cat(&v_refs, 2)?.contiguous()?;
            drop((k_parts, v_parts));
            let mut output = Vec::with_capacity(q_parts.len());
            for (part, q) in q_parts.into_iter().enumerate() {
                let start = part * chunk;
                let len = chunk.min(n - start);
                let attended = attend(&q, &k, &v, None)?;
                output.push(self.finish(&p, &x.narrow(1, start, len)?, &attended, &mod_)?);
            }
            x = Tensor::cat(&output.iter().collect::<Vec<_>>(), 1)?;
        }
        cache.pending = None;
        self.layer_matrices.borrow_mut().clear();
        let s = self
            .proj("norm_out.linear", &silu(&temb)?, DIM)?
            .reshape((1, 1, DIM))?
            .to_dtype(DType::F32)?;
        let output = self.proj("proj_out", &modulate(&x, &s)?, DIM)?;
        Ok(output.to_dtype(DType::F32)?)
    }
}

/// f32 舍入到 bf16 的精度（就近、偶数优先），仍以 f32 返回：时间步嵌入要与参考管线的 bf16 时间步逐值一致。
pub fn bf16_round(value: f32) -> f32 {
    let bits = value.to_bits();
    let lsb = (bits >> 16) & 1;
    f32::from_bits(bits.wrapping_add(0x7fff + lsb) & 0xffff_0000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "cuda")]
    #[test]
    #[ignore = "requires an NVIDIA CUDA device"]
    fn cuda_attention_accepts_transposed_q_heads() {
        let device = Device::new_cuda(0).expect("CUDA device 0 is required");
        let qkv = Tensor::ones((1, 25, HEADS, HEAD_DIM), DType::BF16, &device).unwrap();
        let q = qkv.transpose(1, 2).unwrap();
        assert!(!q.is_contiguous());
        let k = q.contiguous().unwrap();
        let old = scaled_dot_product_attention(&q, &k, &k, (HEAD_DIM as f64).sqrt().recip(), None);
        let old_error = old.expect_err("CUDA matmul must reject the original Q layout");
        assert!(
            old_error.to_string().contains("contiguous"),
            "unexpected old-layout error: {old_error}"
        );
        let attended = attend(&q, &k, &k, None).unwrap();
        assert_eq!(attended.dims(), &[1, HEADS, 25, HEAD_DIM]);
        let values = attended
            .to_dtype(DType::F32)
            .unwrap()
            .flatten_all()
            .unwrap()
            .to_vec1::<f32>()
            .unwrap();
        assert!(values.iter().all(|value| (value - 1.0).abs() < 0.02));
    }

    #[test]
    fn rope_rotates_adjacent_real_imaginary_channels() {
        let pairs = [1.0_f32, 2.0].repeat(HEADS * HEAD_DIM / 2);
        let x = Tensor::from_vec(pairs, (1, 1, HEADS, HEAD_DIM), &Device::Cpu).unwrap();
        let cos = Tensor::zeros((1, HEAD_DIM / 2), DType::F32, &Device::Cpu).unwrap();
        let sin = Tensor::ones((1, HEAD_DIM / 2), DType::F32, &Device::Cpu).unwrap();
        let y = apply_rope(&x, &cos, &sin).unwrap();
        let values = y.flatten_all().unwrap().to_vec1::<f32>().unwrap();
        assert!(values.chunks_exact(2).all(|pair| pair == [-2.0, 1.0]));
    }

    #[test]
    fn bf16_rounding_keeps_the_upper_half_and_rounds_to_nearest_even() {
        assert_eq!(bf16_round(1.0), 1.0);
        // 1 + 2^-8 恰在两个 bf16 之间：偶数优先，回到 1.0；再大一点就进位到 1 + 2^-7。
        assert_eq!(bf16_round(1.0 + 2f32.powi(-8)), 1.0);
        assert_eq!(bf16_round(1.0 + 2f32.powi(-8) + 2f32.powi(-12)), 1.0 + 2f32.powi(-7));
        assert_eq!(bf16_round(0.3).to_bits() & 0xffff, 0);
    }
}
