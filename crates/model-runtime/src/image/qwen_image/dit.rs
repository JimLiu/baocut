//! QwenImage21Transformer2DModel（单流 DiT，32 层；线性层是 MLX 4/8-bit 量化或原精度 bf16）。
//!
//! `causal_condition=true`：文本 token 严格因果、只用 t=0 的调制；目标图 token 看见全部前缀与
//! 自身。于是文本段与采样步无关——首次前向把每层（norm + RoPE 之后的）文本 K/V 存下，之后每步
//! 只算图像 token，拼上缓存的文本 K/V 做无掩码注意力。这正是参考管线 `kv_cache` 的做法。
//! 文本段不单独跑一遍：第一步逐层先算文本、存 K/V，再算图像。
//!
//! 32 层权重（~4 GB）不常驻：每步重开惰性表，算第 i 层时预读第 i+1 层，用完即丢，常驻的只有
//! 输入输出投影与调制（~0.1 GB）和相邻两层（~0.25 GB）。权重文件在 OS 文件缓存里，内存紧时
//! 可被回收，代价是那一步改从磁盘读。
//!
//! 计算精度见 [`Precision`]：缺省按本机实测在 f16 / bf16 里选（[`Precision::probe`]）；
//! 没有原生 bf16 运算的 GPU（M2 上慢约 1.8×）用 f16、残差流存 f32 防溢出，其余用 bf16。

use super::{rope, weights};
use crate::backend::mlx::qwen3::WeightStore;
use anyhow::{Context, Result, bail};
use mlx_rs::fast::ScaledDotProductAttentionMask;
use mlx_rs::ops::indexing::IndexOp;
use mlx_rs::{Array, Dtype, fast, nn, ops};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;

const DIM: i32 = 4096;
const INTER: i32 = 12288;
const HEADS: i32 = 32;
const HEAD_DIM: i32 = 128;
const LAYERS: usize = 32;
const EPS: f32 = 1e-6;

/// DiT 的计算精度。M2 的 GPU 没有原生 bf16 运算：`--bench 4096` 实测一层 7 个线性层 4-bit
/// bf16 1169 ms、f16 661 ms，注意力 149 → 110 ms；1024² 实跑每步 44.2 → 27.2 s。
///
/// f16 只有 5 位指数（最大 65504），所以 f16 模式下残差流改存 f32，只有线性层与注意力的输入
/// 输出是 f16；bf16 模式与参考管线一致，残差也是 bf16。
#[derive(Clone, Copy, Debug)]
pub struct Precision {
    pub compute: Dtype,
    /// 流式读入的量化层先整层解量化成 `compute` 再按 dense 乘：f16 下线性层快约 12%（整步约
    /// 9%）；一层 dense f16 约 0.44 GB（4-bit 约 0.12 GB），进程峰值因此多约 0.33 GB。
    pub dequant: bool,
}

impl Precision {
    fn resid(self) -> Dtype {
        if self.compute == Dtype::Float16 {
            Dtype::Float32
        } else {
            self.compute
        }
    }

    /// 在本机量一次同形的 4-bit 矩阵乘（1024 个 token × 4096 → 4096，与分块时的一次 `to_q`
    /// 同形，随机权重），f16 与 bf16 交替各跑 5 次（另有 1 轮热身），取各自最短。约 0.2 s。
    pub fn probe() -> Result<Probe> {
        let key = mlx_rs::random::key(0)?;
        let w = mlx_rs::random::normal::<f32>(&[DIM, DIM], None, None, &key)?
            .multiply(&Array::from_f32(0.02))?
            .as_dtype(Dtype::Float16)?;
        let (q, s16, b16) = ops::quantize(&w, 64, 4)?;
        let x16 = mlx_rs::random::normal::<f32>(&[1, 1024, DIM], None, None, &key)?.as_dtype(Dtype::Float16)?;
        let bf = |a: &Array| a.as_dtype(Dtype::Bfloat16);
        let (sb, bb, xb) = (bf(&s16)?, bf(&b16)?, bf(&x16)?);
        mlx_rs::transforms::eval([&q, &s16, &b16, &x16, &sb, &bb, &xb])?;
        drop(w);
        let run = |x: &Array, s: &Array, b: &Array| -> Result<f64> {
            let t = Instant::now();
            ops::quantized_matmul(x, &q, s, b, true, 64, 4)?.eval()?;
            Ok(t.elapsed().as_secs_f64() * 1e3)
        };
        let mut p = Probe {
            f16_ms: f64::INFINITY,
            bf16_ms: f64::INFINITY,
        };
        for round in 0..6 {
            let (f, b) = (run(&x16, &s16, &b16)?, run(&xb, &sb, &bb)?);
            // 第 0 轮是热身：kernel 首次编译、GPU 升频。
            if round > 0 {
                p.f16_ms = p.f16_ms.min(f);
                p.bf16_ms = p.bf16_ms.min(b);
            }
        }
        Ok(p)
    }
}

/// bf16 的 4-bit 矩阵乘不比 f16 慢过这个倍数就选 bf16。M2 实测约 1.77×，原生 bf16 的 GPU
/// 应接近 1×；门槛留得宽，免得测量抖动让同一台机器两次选得不一样（输出会随之不同）。
const BF16_TOLERANCE: f64 = 1.3;

/// [`Precision::probe`] 的实测：同形 4-bit 矩阵乘各自的最短耗时（毫秒）。
#[derive(Clone, Copy, Debug)]
pub struct Probe {
    pub f16_ms: f64,
    pub bf16_ms: f64,
}

impl Probe {
    /// bf16 够快就用 bf16：与参考管线同精度，指数位与 f32 一样宽、不会溢出，残差流也不用另存
    /// f32；否则用 f16。
    pub fn pick(self) -> Dtype {
        if self.bf16_ms <= self.f16_ms * BF16_TOLERANCE {
            Dtype::Bfloat16
        } else {
            Dtype::Float16
        }
    }
}

/// f16 计算溢出（DiT 输出含非有限值）。调用方可以改用 bf16 重跑。
#[derive(Debug)]
pub struct Overflow;

impl std::fmt::Display for Overflow {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DiT 在 f16 下溢出（输出含非有限值）")
    }
}

impl std::error::Error for Overflow {}

/// 无 bias 的线性层。有 `.scales` 的是 MLX affine 量化，bits 与 group size 由形状反推
/// （打包列数 × 32 = 输入维 × bits，分组数 × group = 输入维），所以 4-bit 包与 8-bit 包共用；
/// 没有 `.scales` 的按原精度直接乘，不在加载时再量化。scales / biases / dense 权重加载时转成
/// 计算精度，输入在乘之前转过去。
enum Lin {
    Quant {
        w: Array,
        scales: Array,
        biases: Array,
        group: i32,
        bits: i32,
    },
    Dense(Array),
}

impl Lin {
    /// `dequant` 为真时把量化层解量化成 dense（只对流式读入的 32 层用；层外权重常驻，不值得）。
    fn load(s: &mut WeightStore, p: &str, input: i32, dtype: Dtype, dequant: bool) -> Result<Self> {
        let w = s.take(&format!("{p}.weight"))?;
        if !s.contains(&format!("{p}.scales")) {
            if w.dim(1) != input {
                bail!("{p}: 权重输入维 {} ≠ {input}", w.dim(1));
            }
            return Ok(Self::Dense(w.as_dtype(dtype)?));
        }
        let scales = s.take(&format!("{p}.scales"))?.as_dtype(dtype)?;
        let biases = s.take(&format!("{p}.biases"))?.as_dtype(dtype)?;
        let groups = scales.dim(1);
        let packed = w.dim(1) * 32;
        if groups == 0 || input % groups != 0 || packed % input != 0 {
            bail!(
                "{p}: 量化形状对不上输入维 {input}（权重 {:?}，scales {:?}）",
                w.shape(),
                scales.shape()
            );
        }
        let (group, bits) = (input / groups, packed / input);
        if dequant {
            return Ok(Self::Dense(ops::dequantize(&w, &scales, &biases, group, bits)?));
        }
        Ok(Self::Quant {
            w,
            scales,
            biases,
            group,
            bits,
        })
    }

    fn forward(&self, x: &Array) -> Result<Array> {
        Ok(match self {
            Self::Quant {
                w,
                scales,
                biases,
                group,
                bits,
            } => ops::quantized_matmul(x.as_dtype(scales.dtype())?, w, scales, biases, true, *group, *bits)?,
            Self::Dense(w) => ops::matmul(x.as_dtype(w.dtype())?, w.t())?,
        })
    }
}

/// 两种包的键名不全一样：mlx-community 4-bit 包把 diffusers 的 `nn.Sequential` 下标与
/// `timestep_embedder` 摊平了（`modulation.0`、`time_text_embed.linear_1`），ddalcu 8-bit 包
/// 保留原名（`modulation.1`、`time_text_embed.timestep_embedder.linear_1`）。取第一个存在的。
fn pick<'a>(s: &WeightStore, names: &[&'a str]) -> Result<&'a str> {
    names
        .iter()
        .copied()
        .find(|n| s.contains(&format!("{n}.weight")))
        .with_context(|| format!("DiT 缺少权重：{}", names.join(" / ")))
}

fn scalar(v: f32, like: &Array) -> Result<Array> {
    Ok(Array::from_f32(v).as_dtype(like.dtype())?)
}

/// 与 torch 的 `.to(torch.bfloat16)` 相同的就近偶数舍入。
pub fn bf16_round(v: f32) -> f32 {
    let bits = v.to_bits();
    let lsb = (bits >> 16) & 1;
    let rounded = bits.wrapping_add(0x7fff + lsb) & 0xffff_0000;
    f32::from_bits(rounded)
}

struct Block {
    to_q: Lin,
    to_k: Lin,
    to_v: Lin,
    to_out: Lin,
    norm_q: Array,
    norm_k: Array,
    gate: Lin,
    proj: Lin,
    out: Lin,
}

/// 一组调制参数，已 reshape 成 `[1,1,DIM]` 以便按 token 广播。
struct Mod {
    scale1: Array,
    gate1: Array,
    scale2: Array,
    gate2: Array,
}

pub struct Dit {
    files: Vec<PathBuf>,
    prec: Precision,
    img_in: Lin,
    t_lin1: Lin,
    t_lin2: Lin,
    modulation: Lin,
    txt_norm: Array,
    txt_in1: Lin,
    txt_in2: Lin,
    norm_out: Lin,
    proj_out: Lin,
}

/// 文本前缀的逐层 K/V（`[1,H,L,D]`，已过 norm 与 RoPE）。第一步之前 `kv` 为空、`pending`
/// 装着过完 `txt_in` 的文本 hidden；第一步逐层填满 `kv` 后 `pending` 清空。
pub struct TextCache {
    kv: Vec<(Array, Array)>,
    text_len: usize,
    pending: Option<TextPending>,
}

struct TextPending {
    x: Array,
    m: Mod,
    cos: Array,
    sin: Array,
}

/// 一步里按层取权重：惰性表只有文件头，`take` 拿出第 i 层的张量并发起异步读取。
struct BlockStream {
    lazy: HashMap<String, Array>,
    prec: Precision,
}

impl BlockStream {
    fn open(files: &[PathBuf], prec: Precision) -> Result<Self> {
        let lazy = weights::lazy(files, |k| k.starts_with("transformer_blocks.")).context("打开 DiT 层权重")?;
        Ok(Self { lazy, prec })
    }

    /// `prefetch` 为真时立刻在 CPU stream 上开始读这一层（与 GPU 上正在算的上一层重叠）。
    fn take(&mut self, i: usize, prefetch: bool) -> Result<Block> {
        let prefix = format!("transformer_blocks.{i}.");
        let keys: Vec<String> = self.lazy.keys().filter(|k| k.starts_with(&prefix)).cloned().collect();
        let part: HashMap<String, Array> = keys.into_iter().filter_map(|k| self.lazy.remove_entry(&k)).collect();
        if prefetch {
            mlx_rs::transforms::async_eval(part.values())?;
        }
        let mut s = WeightStore::from_arrays(part)?;
        let b = Block::load(&mut s, i, self.prec)?;
        let left = s.remaining();
        if !left.is_empty() {
            bail!("DiT 第 {i} 层有未使用的权重：{:?}", &left[..left.len().min(5)]);
        }
        Ok(b)
    }
}

/// 把 `[1,S,H,D]` 的相邻两维当复数，乘以 `cos + i·sin`（`[S, D/2]`）。f32 计算后回到原 dtype。
fn apply_rope(x: &Array, cos: &Array, sin: &Array) -> Result<Array> {
    let s = x.dim(1);
    let dtype = x.dtype();
    let pairs = x.as_dtype(Dtype::Float32)?.reshape(&[1, s, HEADS, HEAD_DIM / 2, 2])?;
    let x0 = pairs.index((.., .., .., .., 0));
    let x1 = pairs.index((.., .., .., .., 1));
    let cos = cos.reshape(&[1, s, 1, HEAD_DIM / 2])?;
    let sin = sin.reshape(&[1, s, 1, HEAD_DIM / 2])?;
    let y0 = x0.multiply(&cos)?.subtract(&x1.multiply(&sin)?)?;
    let y1 = x0.multiply(&sin)?.add(&x1.multiply(&cos)?)?;
    let y = ops::stack_axis(&[y0, y1], -1)?.reshape(&[1, s, HEADS, HEAD_DIM])?;
    Ok(y.as_dtype(dtype)?)
}

fn gelu_tanh_f32(x: &Array) -> Result<Array> {
    let x = x.as_dtype(Dtype::Float32)?;
    let c = Array::from_f32((2.0f32 / std::f32::consts::PI).sqrt());
    let inner = x.add(&x.multiply(&x)?.multiply(&x)?.multiply(&Array::from_f32(0.044715))?)?;
    let t = ops::tanh(&inner.multiply(&c)?)?;
    Ok(x.multiply(&Array::from_f32(0.5))?.multiply(&t.add(&Array::from_f32(1.0))?)?)
}

impl Block {
    fn load(s: &mut WeightStore, i: usize, prec: Precision) -> Result<Self> {
        let p = format!("transformer_blocks.{i}");
        let (dt, dq) = (prec.compute, prec.dequant);
        // norm 权重也转成计算精度：rms_norm 的输出按 x 与权重的公共类型，f16 × bf16 会升成 f32。
        Ok(Self {
            to_q: Lin::load(s, &format!("{p}.attn.to_q"), DIM, dt, dq)?,
            to_k: Lin::load(s, &format!("{p}.attn.to_k"), DIM, dt, dq)?,
            to_v: Lin::load(s, &format!("{p}.attn.to_v"), DIM, dt, dq)?,
            to_out: Lin::load(s, &format!("{p}.attn.to_out.0"), DIM, dt, dq)?,
            norm_q: s.take(&format!("{p}.attn.norm_q.weight"))?.as_dtype(dt)?,
            norm_k: s.take(&format!("{p}.attn.norm_k.weight"))?.as_dtype(dt)?,
            gate: Lin::load(s, &format!("{p}.img_mlp.gate_layer"), DIM, dt, dq)?,
            proj: Lin::load(s, &format!("{p}.img_mlp.proj"), DIM, dt, dq)?,
            out: Lin::load(s, &format!("{p}.img_mlp.out"), INTER, dt, dq)?,
        })
    }

    fn modulate(x: &Array, scale: &Array) -> Result<Array> {
        let n = fast::layer_norm(x, None, None, EPS)?;
        Ok(n.multiply(&scale.add(&scalar(1.0, scale)?)?)?)
    }

    /// 返回 (q, k, v)，都是 `[1,H,S,D]`，q/k 已过 per-head RMSNorm 与 RoPE。
    fn qkv(&self, xm: &Array, cos: &Array, sin: &Array) -> Result<(Array, Array, Array)> {
        let s = xm.dim(1);
        let shape = [1, s, HEADS, HEAD_DIM];
        let q = fast::rms_norm(&self.to_q.forward(xm)?.reshape(&shape)?, &self.norm_q, EPS)?;
        let k = fast::rms_norm(&self.to_k.forward(xm)?.reshape(&shape)?, &self.norm_k, EPS)?;
        let v = self.to_v.forward(xm)?.reshape(&shape)?;
        let q = apply_rope(&q, cos, sin)?;
        let k = apply_rope(&k, cos, sin)?;
        let t = [0, 2, 1, 3];
        Ok((q.transpose_axes(&t)?, k.transpose_axes(&t)?, v.transpose_axes(&t)?))
    }

    fn finish(&self, x: &Array, attn: &Array, m: &Mod) -> Result<Array> {
        let s = attn.dim(2);
        let attn = attn.transpose_axes(&[0, 2, 1, 3])?.reshape(&[1, s, DIM])?;
        let attn = self.to_out.forward(&attn)?;
        let x = x.add(&ops::tanh(&m.gate1)?.multiply(&attn)?)?;
        let xm = Self::modulate(&x, &m.scale2)?;
        let h = nn::silu(self.gate.forward(&xm)?)?.multiply(&self.proj.forward(&xm)?)?;
        let h = self.out.forward(&h)?;
        Ok(x.add(&ops::tanh(&m.gate2)?.multiply(&h)?)?)
    }
}

impl Dit {
    /// 只常驻层外的权重；32 层在这里按键核对一遍（惰性，不读文件），真正读取在每步里。
    /// `files` 是 `transformer/` 下的 safetensors 分片：32 层与层外权重都从这里取。
    pub fn load(files: &[PathBuf], prec: Precision) -> Result<Self> {
        let mut stream = BlockStream::open(files, prec)?;
        for i in 0..LAYERS {
            stream.take(i, false)?;
        }
        if let Some(k) = stream.lazy.keys().next() {
            bail!("DiT 有多余的层权重：{k}");
        }
        let files = files.to_vec();
        let s = &mut weights::resident(&files, |k| !k.starts_with("transformer_blocks.")).context("加载 DiT 层外权重")?;
        let t1 = pick(s, &["time_text_embed.linear_1", "time_text_embed.timestep_embedder.linear_1"])?;
        let t2 = pick(s, &["time_text_embed.linear_2", "time_text_embed.timestep_embedder.linear_2"])?;
        let modulation = pick(s, &["modulation.0", "modulation.1"])?;
        let dt = prec.compute;
        let me = Self {
            files,
            prec,
            img_in: Lin::load(s, "img_in", 64, dt, false)?,
            t_lin1: Lin::load(s, t1, 256, dt, false)?,
            t_lin2: Lin::load(s, t2, DIM, dt, false)?,
            modulation: Lin::load(s, modulation, DIM, dt, false)?,
            txt_norm: s.take("txt_in.text_norm.weight")?,
            txt_in1: Lin::load(s, "txt_in.in_layer", DIM, dt, false)?,
            txt_in2: Lin::load(s, "txt_in.out_layer", DIM, dt, false)?,
            norm_out: Lin::load(s, "norm_out.linear", DIM, dt, false)?,
            proj_out: Lin::load(s, "proj_out", DIM, dt, false)?,
        };
        let left = s.remaining();
        if !left.is_empty() {
            bail!("DiT 有未使用的权重：{:?}", &left[..left.len().min(5)]);
        }
        Ok(me)
    }

    /// 正弦时间嵌入 → MLP，返回 `[1, DIM]`（bf16）。`sigma` 按管线两次转 bf16 的舍入复刻。
    fn temb(&self, sigma: f64) -> Result<Array> {
        let t = bf16_round(bf16_round((sigma * 1000.0) as f32) / 1000.0);
        let half = 128usize;
        let mut emb = vec![0f32; 2 * half];
        for i in 0..half {
            let f = (-(10000f32.ln()) * i as f32 / half as f32).exp();
            let a = 1000.0 * t * f;
            emb[i] = a.cos();
            emb[half + i] = a.sin();
        }
        let x = Array::from_slice(&emb, &[1, 256]).as_dtype(Dtype::Bfloat16)?;
        let h = nn::silu(self.t_lin1.forward(&x)?)?;
        self.t_lin2.forward(&h)
    }

    fn mods(&self, temb: &Array) -> Result<Mod> {
        let m = self.modulation.forward(&nn::silu(temb)?)?;
        let part = |k: i32| -> Result<Array> { Ok(m.index((.., k * DIM..(k + 1) * DIM)).reshape(&[1, 1, DIM])?) };
        Ok(Mod {
            scale1: part(0)?,
            gate1: part(1)?,
            scale2: part(2)?,
            gate2: part(3)?,
        })
    }

    fn tables(cos: &[f32], sin: &[f32], from: usize, to: usize) -> (Array, Array) {
        let half = (HEAD_DIM / 2) as usize;
        let n = (to - from) as i32;
        (
            Array::from_slice(&cos[from * half..to * half], &[n, HEAD_DIM / 2]),
            Array::from_slice(&sin[from * half..to * half], &[n, HEAD_DIM / 2]),
        )
    }

    /// 图像 token 过一层：先逐块算 q/k/v（K/V 拼在文本前缀后面凑成整张），再逐块做注意力、
    /// to_out 与 MLP，每块求值后才进下一块。每个 token 的算子与不分块时完全相同。
    #[allow(clippy::too_many_arguments)]
    fn image_layer(
        b: &Block,
        tk: &Array,
        tv: &Array,
        x: &Array,
        m: &Mod,
        cos: &Array,
        sin: &Array,
        ranges: &[(i32, i32)],
    ) -> Result<Array> {
        let mut qs = Vec::with_capacity(ranges.len());
        let mut ks = vec![tk.clone()];
        let mut vs = vec![tv.clone()];
        for &(s, e) in ranges {
            let xm = Block::modulate(&x.index((.., s..e, ..)), &m.scale1)?;
            let (q, k, v) = b.qkv(&xm, &cos.index((s..e, ..)), &sin.index((s..e, ..)))?;
            mlx_rs::transforms::eval([&q, &k, &v])?;
            qs.push(q);
            ks.push(k);
            vs.push(v);
        }
        let k = ops::concatenate_axis(&ks, 2)?;
        let v = ops::concatenate_axis(&vs, 2)?;
        drop((ks, vs));
        let scale = (HEAD_DIM as f32).sqrt().recip();
        let mut outs = Vec::with_capacity(ranges.len());
        for (&(s, e), q) in ranges.iter().zip(qs) {
            let attn = fast::scaled_dot_product_attention(&q, &k, &v, scale, None::<ScaledDotProductAttentionMask<'_>>, None)?;
            let y = b.finish(&x.index((.., s..e, ..)), &attn, m)?;
            y.eval()?;
            outs.push(y);
        }
        if outs.len() == 1 {
            return Ok(outs.pop().unwrap());
        }
        let y = ops::concatenate_axis(&outs, 1)?;
        y.eval()?;
        Ok(y)
    }

    /// 文本前缀：`enc` 是文本编码器输出 `[1,L,4096]`。这里只过 `txt_in`，逐层部分并进第一步。
    pub fn prepare_text(&self, enc: &Array, grid_h: usize, grid_w: usize) -> Result<TextCache> {
        let text_len = enc.dim(1) as usize;
        let (cos_all, sin_all) = rope::dit_rope_tables(text_len, grid_h, grid_w);
        let (cos, sin) = Self::tables(&cos_all, &sin_all, 0, text_len);
        // ZeroCenterRMSNorm：fp32 下 `x * rsqrt(mean(x²)+eps) * (w+1)`。
        let dtype = enc.dtype();
        let w1 = self.txt_norm.as_dtype(Dtype::Float32)?.add(&Array::from_f32(1.0))?;
        let normed = fast::rms_norm(&enc.as_dtype(Dtype::Float32)?, &w1, EPS)?.as_dtype(dtype)?;
        let h = gelu_tanh_f32(&self.txt_in1.forward(&normed)?)?.as_dtype(dtype)?;
        let x = self.txt_in2.forward(&h)?.as_dtype(self.prec.resid())?;
        let m = self.mods(&self.temb(0.0)?)?;
        Ok(TextCache {
            kv: Vec::with_capacity(LAYERS),
            text_len,
            pending: Some(TextPending { x, m, cos, sin }),
        })
    }

    /// 文本 token 过一层（因果注意力、t=0 调制），返回这一层的文本 K/V。
    fn text_layer(b: &Block, p: &mut TextPending) -> Result<(Array, Array)> {
        let xm = Block::modulate(&p.x, &p.m.scale1)?;
        let (q, k, v) = b.qkv(&xm, &p.cos, &p.sin)?;
        let scale = (HEAD_DIM as f32).sqrt().recip();
        let attn = fast::scaled_dot_product_attention(&q, &k, &v, scale, Some(ScaledDotProductAttentionMask::Causal), None)?;
        p.x = b.finish(&p.x, &attn, &p.m)?;
        mlx_rs::transforms::eval([&p.x, &k, &v])?;
        Ok((k, v))
    }

    /// 一步去噪：`latents` 是 `[1, N, 64]`（任意浮点 dtype），返回速度场 `[1, N, 64]`（f32）。
    /// 每层按 `chunk` 个图像 token 分块算（K/V 仍是整张），把层内临时张量压到 1/⌈N/chunk⌉。
    /// 层权重逐层流式读入；第一步顺带把文本前缀的 K/V 填进 `cache`。
    pub fn step(&self, cache: &mut TextCache, latents: &Array, sigma: f64, grid_h: usize, grid_w: usize, chunk: usize) -> Result<Array> {
        let n = grid_h * grid_w;
        if latents.dim(1) as usize != n {
            bail!("latent token 数 {} ≠ {grid_h}×{grid_w}", latents.dim(1));
        }
        let (cos_all, sin_all) = rope::dit_rope_tables(cache.text_len, grid_h, grid_w);
        let (cos, sin) = Self::tables(&cos_all, &sin_all, cache.text_len, cache.text_len + n);
        let temb = self.temb(sigma)?;
        let m = self.mods(&temb)?;
        let mut x = self
            .img_in
            .forward(&latents.as_dtype(Dtype::Bfloat16)?)?
            .as_dtype(self.prec.resid())?;
        let n = n as i32;
        let chunk = chunk.max(1) as i32;
        let ranges: Vec<(i32, i32)> = (0..n).step_by(chunk as usize).map(|s| (s, (s + chunk).min(n))).collect();
        let mut stream = BlockStream::open(&self.files, self.prec)?;
        let mut next = Some(stream.take(0, true)?);
        for i in 0..LAYERS {
            let b = next.take().context("DiT 层权重缺失")?;
            if i + 1 < LAYERS {
                next = Some(stream.take(i + 1, true)?);
            }
            if let Some(p) = cache.pending.as_mut() {
                let kv = Self::text_layer(&b, p)?;
                cache.kv.push(kv);
            }
            let (tk, tv) = &cache.kv[i];
            x = Self::image_layer(&b, tk, tv, &x, &m, &cos, &sin, &ranges)?;
        }
        cache.pending = None;
        let s = self.norm_out.forward(&nn::silu(&temb)?)?.reshape(&[1, 1, DIM])?;
        let x = Block::modulate(&x, &s)?;
        let out = self.proj_out.forward(&x)?.as_dtype(Dtype::Float32)?;
        out.eval()?;
        if self.prec.compute == Dtype::Float16 {
            let finite = out.is_finite()?.all(None)?;
            finite.eval()?;
            if !finite.item::<bool>() {
                return Err(Overflow.into());
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::{Probe, bf16_round};
    use mlx_rs::Dtype;

    #[test]
    fn probe_picks_bf16_only_when_it_is_not_much_slower() {
        let pick = |f16_ms, bf16_ms| Probe { f16_ms, bf16_ms }.pick();
        // M2 实测（--bench 4096 的 qmm）：bf16 慢约 1.77×
        assert_eq!(pick(661.0, 1169.0), Dtype::Float16);
        assert_eq!(pick(10.0, 10.5), Dtype::Bfloat16);
        assert_eq!(pick(10.0, 9.0), Dtype::Bfloat16);
        assert_eq!(pick(10.0, 13.5), Dtype::Float16);
    }

    #[test]
    fn bf16_rounding_matches_torch() {
        assert_eq!(bf16_round(1.0), 1.0);
        // 987.6 在 bf16 下相邻可表示值是 984 与 988
        assert_eq!(bf16_round(987.6), 988.0);
        assert_eq!(bf16_round(0.1), 0.10009765625);
    }
}
