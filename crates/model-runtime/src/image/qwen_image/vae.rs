//! AutoencoderKLQwenImage21 的单帧（图像）特化，NHWC。
//!
//! 参考实现是 Wan 系的 3D 因果 VAE，但 2.1 已把 CausalConv3d 特化成 2D 卷积；单帧解码时所有
//! `time_conv` 都走 "Rep"/首块分支而被跳过，所以这里只剩 2D 卷积、通道 RMSNorm、单头注意力，
//! 以及残差上 / 下采样块里的 DupUp3D / AvgDown3D 捷径（首帧版本）。
//!
//! 权重在两种包里都存成 F32（4-bit 包是 MLX 布局、8-bit 包是 PyTorch 布局，加载时统一成
//! MLX 布局），逐张量转成计算精度（缺省 f16，`--vae-dtype` 可换 bf16 / f32 对照）。

use crate::backend::mlx::qwen3::WeightStore;
use anyhow::{Context, Result, bail};
use mlx_rs::ops::indexing::IndexOp;
use mlx_rs::{Array, Dtype, fast, nn, ops};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const DECODER_BASE_DIM: i32 = 144;
const DIM_MULT: [i32; 5] = [1, 2, 4, 8, 8];
const TEMPORAL_DOWN: [bool; 4] = [false, true, true, true];
const NUM_RES: usize = 2;
pub const Z_DIM: i32 = 64;

/// 卷积层。3×3 核在加载时做空间翻转，前向以 `flip=true`（真卷积）调用，结果仍是原来的互相关，
/// 但 MLX 因此不走 Winograd 而走 implicit GEMM：Winograd 每次调用都要现分配 64×C×O 的变换核
/// （1152 通道 f16 为 170 MB）、约 1.8× 输入与 1.8× 输出的变换张量和一份补零拷贝，1024² 解码
/// 峰值因此高出 0.6 GB；implicit GEMM 只分配输出，代价是 VAE 解码慢约 1.5×（整段生成里不到 1%）。
struct Conv {
    w: Array,
    b: Array,
    pad: i32,
    stride: i32,
    flip: bool,
}

impl Conv {
    fn load(s: &mut WeightStore, p: &str, pad: i32, stride: i32) -> Result<Self> {
        // 权重是 [O, kh, kw, C]。
        let mut w = s.take(&format!("{p}.weight"))?;
        let flip = w.dim(1) > 1;
        if flip {
            let k = w.dim(1);
            let rev = Array::from_slice(&(0..k).rev().collect::<Vec<i32>>(), &[k]);
            w = w.take_axis(&rev, 1)?.take_axis(&rev, 2)?;
            w.eval()?;
        }
        Ok(Self {
            w,
            b: s.take(&format!("{p}.bias"))?,
            pad,
            stride,
            flip,
        })
    }
    fn conv(&self, x: &Array, stride: i32, pad: i32) -> Result<Array> {
        Ok(ops::conv_general(
            x,
            &self.w,
            &[stride, stride][..],
            &[pad, pad][..],
            None,
            None,
            None,
            self.flip,
        )?)
    }
    fn forward(&self, x: &Array) -> Result<Array> {
        let (h, w, c) = (x.dim(1) as i64, x.dim(2) as i64, x.dim(3) as i64);
        let elems = h * w * c;
        if self.pad == 1 && self.stride == 1 && elems > BAND_ELEMS {
            return self.forward_bands(x, (elems + BAND_ELEMS - 1) / BAND_ELEMS);
        }
        Ok(self.conv(x, self.stride, self.pad)?.add(&self.b)?)
    }

    /// 高分辨率 3×3 卷积按行条带算（每条带上下各带 1 行 halo），并逐条求值，压住单次卷积
    /// 的输出与临时缓冲（缺省的尾段条带下很少触发，主要护着 `--vae-tail-rows 0`）。
    /// 补零也逐条做（只在图像上下边缘补行），不物化整张补零拷贝。
    fn forward_bands(&self, x: &Array, bands: i64) -> Result<Array> {
        let h = x.dim(1);
        let rows = ((h as i64 + bands - 1) / bands) as i32;
        let mut outs = Vec::new();
        let mut r0 = 0;
        while r0 < h {
            let r1 = (r0 + rows).min(h);
            let (u0, u1) = ((r0 - 1).max(0), (r1 + 1).min(h));
            outs.push(self.conv_rows(&x.index((.., u0..u1, .., ..)), r0, r1, u0, u1, None)?);
            r0 = r1;
        }
        Ok(ops::concatenate_axis(&outs, 1)?)
    }

    /// `slab` 是输入的 `[u0, u1)` 行，算输出的 `[r0, r1)` 行：`u0`/`u1` 被图像边缘截掉的那
    /// 一行补零，左右各补一列。`add` 是这几行要加的残差捷径。求值后返回。
    fn conv_rows(&self, slab: &Array, r0: i32, r1: i32, u0: i32, u1: i32, add: Option<Array>) -> Result<Array> {
        let widths = [(0, 0), (u0 - (r0 - 1), (r1 + 1) - u1), (1, 1), (0, 0)];
        let slab = ops::pad(slab, &widths[..], None, None)?;
        let mut y = self.conv(&slab, 1, 0)?.add(&self.b)?;
        if let Some(a) = add {
            y = y.add(&a)?;
        }
        y.eval()?;
        Ok(y)
    }

    /// `conv(upsample2x(x)) + shortcut`，大图按输出行条带算：每条只把需要的低分辨率行（含
    /// halo）上采样，整张 2× 张量、它的补零拷贝与整张捷径都不物化。`shortcut(a, b)` 给出
    /// 输出第 `[a, b)` 行的捷径（`a`、`b` 都是偶数）。
    fn forward_up2(&self, x: &Array, shortcut: impl Fn(i32, i32) -> Result<Array>) -> Result<Array> {
        let (h, w, c) = (x.dim(1), x.dim(2), x.dim(3));
        let hu = 2 * h;
        let elems = 4 * h as i64 * w as i64 * c as i64;
        if elems <= BAND_ELEMS {
            return Ok(self.forward(&upsample2x(x)?)?.add(&shortcut(0, hu)?)?);
        }
        let bands = (elems + BAND_ELEMS - 1) / BAND_ELEMS;
        let rows = (hu as u64).div_ceil(bands as u64).next_multiple_of(2) as i32;
        let mut outs = Vec::new();
        let mut r0 = 0;
        while r0 < hu {
            let r1 = (r0 + rows).min(hu);
            // 需要上采样后的 [u0, u1) 行，它们来自低分辨率的 [l0, l1) 行。
            let (u0, u1) = ((r0 - 1).max(0), (r1 + 1).min(hu));
            let (l0, l1) = (u0 / 2, (u1 + 1) / 2);
            let up = upsample2x(&x.index((.., l0..l1, .., ..)))?;
            let up = up.index((.., u0 - 2 * l0..u1 - 2 * l0, .., ..));
            outs.push(self.conv_rows(&up, r0, r1, u0, u1, Some(shortcut(r0, r1)?))?);
            r0 = r1;
        }
        Ok(ops::concatenate_axis(&outs, 1)?)
    }
}

/// 超过这个元素数（f32 约 256 MB）的 3×3 卷积输入改走条带。
const BAND_ELEMS: i64 = 64 << 20;

/// `F.normalize(x, dim=C) * sqrt(C) * gamma` 等价于通道上的 RMSNorm。
struct RmsNorm {
    gamma: Array,
}

impl RmsNorm {
    fn load(s: &mut WeightStore, p: &str) -> Result<Self> {
        Ok(Self {
            gamma: s.take(&format!("{p}.gamma"))?,
        })
    }
    fn forward(&self, x: &Array) -> Result<Array> {
        Ok(fast::rms_norm(x, &self.gamma, 1e-12)?)
    }
}

struct ResBlock {
    norm1: RmsNorm,
    conv1: Conv,
    norm2: RmsNorm,
    conv2: Conv,
    shortcut: Option<Conv>,
}

impl ResBlock {
    fn load(s: &mut WeightStore, p: &str, in_dim: i32, out_dim: i32) -> Result<Self> {
        Ok(Self {
            norm1: RmsNorm::load(s, &format!("{p}.norm1"))?,
            conv1: Conv::load(s, &format!("{p}.conv1"), 1, 1)?,
            norm2: RmsNorm::load(s, &format!("{p}.norm2"))?,
            conv2: Conv::load(s, &format!("{p}.conv2"), 1, 1)?,
            shortcut: if in_dim != out_dim {
                Some(Conv::load(s, &format!("{p}.conv_shortcut"), 0, 1)?)
            } else {
                None
            },
        })
    }
    fn forward(&self, x: &Array) -> Result<Array> {
        let h = match &self.shortcut {
            Some(c) => c.forward(x)?,
            None => x.clone(),
        };
        let y = self.conv1.forward(&nn::silu(self.norm1.forward(x)?)?)?;
        let y = self.conv2.forward(&nn::silu(self.norm2.forward(&y)?)?)?;
        Ok(y.add(&h)?)
    }
}

struct Attention {
    norm: RmsNorm,
    to_qkv: Conv,
    proj: Conv,
}

impl Attention {
    fn load(s: &mut WeightStore, p: &str) -> Result<Self> {
        Ok(Self {
            norm: RmsNorm::load(s, &format!("{p}.norm"))?,
            to_qkv: Conv::load(s, &format!("{p}.to_qkv"), 0, 1)?,
            proj: Conv::load(s, &format!("{p}.proj"), 0, 1)?,
        })
    }
    fn forward(&self, x: &Array) -> Result<Array> {
        let (h, w, c) = (x.dim(1), x.dim(2), x.dim(3));
        let qkv = self.to_qkv.forward(&self.norm.forward(x)?)?.reshape(&[1, 1, h * w, 3 * c])?;
        let parts = qkv.split(3, -1)?;
        let scale = (c as f32).sqrt().recip();
        let o = fast::scaled_dot_product_attention(
            &parts[0],
            &parts[1],
            &parts[2],
            scale,
            None::<fast::ScaledDotProductAttentionMask<'_>>,
            None,
        )?;
        let o = self.proj.forward(&o.reshape(&[1, h, w, c])?)?;
        Ok(o.add(x)?)
    }
}

struct MidBlock {
    res0: ResBlock,
    attn: Attention,
    res1: ResBlock,
}

impl MidBlock {
    fn load(s: &mut WeightStore, p: &str, dim: i32) -> Result<Self> {
        Ok(Self {
            res0: ResBlock::load(s, &format!("{p}.resnets.0"), dim, dim)?,
            attn: Attention::load(s, &format!("{p}.attentions.0"))?,
            res1: ResBlock::load(s, &format!("{p}.resnets.1"), dim, dim)?,
        })
    }
    fn forward(&self, x: &Array) -> Result<Array> {
        let x = self.res0.forward(x)?;
        let x = self.attn.forward(&x)?;
        self.res1.forward(&x)
    }
}

/// nearest 2x（整数倍时 nearest-exact 就是逐像素复制）。
fn upsample2x(x: &Array) -> Result<Array> {
    let (h, w, c) = (x.dim(1), x.dim(2), x.dim(3));
    let y = x.reshape(&[1, h, 1, w, 1, c])?;
    let y = ops::broadcast_to(&y, &[1, h, 2, w, 2, c])?;
    Ok(y.reshape(&[1, 2 * h, 2 * w, c])?)
}

/// DupUp3D 的首帧分支：通道按 `repeat_interleave` 展开，取时间相位 `ft-1`，再像素重排 2x。
/// 输出通道 `o`、子像素 `(b1,b2)` 读输入通道 `(o*ft*4 + (ft-1)*4 + b1*2 + b2) / r`。
fn dup_up(x: &Array, in_dim: i32, out_dim: i32, ft: i32) -> Result<Array> {
    let r = out_dim * ft * 4 / in_dim;
    let mut idx = Vec::with_capacity((out_dim * 4) as usize);
    for b1 in 0..2 {
        for b2 in 0..2 {
            for o in 0..out_dim {
                idx.push((o * ft * 4 + (ft - 1) * 4 + b1 * 2 + b2) / r);
            }
        }
    }
    let idx = Array::from_slice(&idx, &[out_dim * 4]);
    let (h, w) = (x.dim(1), x.dim(2));
    let g = x.take_axis(&idx, 3)?.reshape(&[1, h, w, 2, 2, out_dim])?;
    let g = g.transpose_axes(&[0, 1, 3, 2, 4, 5])?;
    Ok(g.reshape(&[1, 2 * h, 2 * w, out_dim])?)
}

struct UpBlock {
    resnets: Vec<ResBlock>,
    upsampler: Option<Conv>,
    in_dim: i32,
    out_dim: i32,
    ft: i32,
}

impl UpBlock {
    fn forward(&self, x: &Array) -> Result<Array> {
        let mut y = x.clone();
        for r in &self.resnets {
            y = r.forward(&y)?;
            y.eval()?;
        }
        if let Some(up) = &self.upsampler {
            // 捷径 DupUp3D 逐像素只看输入的对应位置，输出第 [a, b) 行来自输入第 [a/2, b/2) 行。
            let shortcut = |a: i32, b: i32| {
                let rows = x.index((.., a / 2..b / 2, .., ..));
                dup_up(&rows, self.in_dim, self.out_dim, self.ft)
            };
            y = up.forward_up2(&y, shortcut)?;
        }
        y.eval()?;
        Ok(y)
    }
}

/// 从这个 up_block 起（连同 norm_out / conv_out）按行条带解码：它之后的激活占了解码内存的
/// 大头（1024² 时单张就 0.6–1.2 GB），而它之前的通道多、分辨率低，整张算更划算。
const TAIL_FROM: usize = 2;

/// 尾段条带在 `TAIL_FROM` 输入分辨率上下各多带的行数。尾段只有逐像素的通道 RMSNorm、1×1
/// 捷径、最近邻上采样与 3×3 卷积；从输出往回数，conv_out + up_block 4 的 6 个卷积是 4× 分辨率
/// 上的 7 行，加 up_block 3 上采样卷积 1 行 → 2× 分辨率上 4 行，再加 up_block 3 的 6 个卷积与
/// up_block 2 的上采样卷积 → 11 行 → 1× 分辨率上 6 行，加 up_block 2 的 6 个卷积 = 12 行。
/// 条带边缘的零填充误差每过一个卷积往里渗 1 行，12 行 halo 把它们全部挡在裁掉的部分里。
const TAIL_HALO: i32 = 12;

/// 自动选条带行数：尾段最大的张量在 4× 分辨率、288 通道上（每个输入行对应 4 行 × 4 倍宽），
/// 让它连 halo 在内不超过 `TAIL_ELEMS`。
fn auto_tail_rows(width: i32) -> i32 {
    let per_row = 16 * width as i64 * 288;
    ((TAIL_ELEMS / per_row.max(1)) as i32 - 2 * TAIL_HALO).max(TAIL_HALO)
}

/// 尾段一条带里最大张量的元素上限。1024² 时是 8 条 × 32 行，解码 MLX 峰值 0.87 GB（86 行
/// 1.23 GB、整张 2.26 GB），已经高过 DiT 阶段（0.63 GB），所以不为省 halo 重算放大条带。
const TAIL_ELEMS: i64 = 64 << 20;

pub struct Decoder {
    post_quant_conv: Conv,
    conv_in: Conv,
    mid: MidBlock,
    ups: Vec<UpBlock>,
    norm_out: RmsNorm,
    conv_out: Conv,
    mean: Array,
    std: Array,
    dtype: Dtype,
}

#[derive(serde::Deserialize)]
struct VaeConfig {
    latents_mean: Vec<f32>,
    latents_std: Vec<f32>,
}

/// 惰性打开后逐张量转成 `dtype` 并立即求值：F32 原件一次只在内存里留一个张量。
/// `time_conv` 只在多帧时使用，单帧不读。
fn load_store(files: &[PathBuf], prefix: &'static str, dtype: Dtype) -> Result<WeightStore> {
    let lazy = super::weights::lazy(files, move |k| {
        let ours = match prefix {
            "decoder" => k.starts_with("decoder.") || k.starts_with("post_quant_conv."),
            _ => k.starts_with("encoder.") || k.starts_with("quant_conv."),
        };
        ours && !k.contains(".time_conv.")
    })
    .context("加载 VAE 权重")?;
    // mlx-community 包是 MLX 布局（卷积核 [O,kh,kw,C]、gamma [C]），ddalcu 8-bit 包保留
    // PyTorch 布局（[O,C,kh,kw]、gamma [C,1,1(,1)]）。3×3 核在 C=3/4 时两种形状可能一样，所以
    // 按这一半的 (post_)quant_conv（C→C 的 1×1 卷积，C > 1）整体判定。
    let probe = if prefix == "decoder" {
        "post_quant_conv.weight"
    } else {
        "quant_conv.weight"
    };
    let torch = match lazy.get(probe).map(|w| w.shape().to_vec()).as_deref() {
        Some(&[o, 1, 1, c]) if o == c && c > 1 => false,
        Some(&[o, c, 1, 1]) if o == c && c > 1 => true,
        other => bail!("{probe} 的形状认不出布局：{other:?}"),
    };
    let mut cast = HashMap::with_capacity(lazy.len());
    for (k, v) in lazy {
        let v = if !torch {
            v
        } else if k.ends_with(".weight") && v.ndim() == 4 {
            v.transpose_axes(&[0, 2, 3, 1])?
        } else if k.ends_with(".gamma") {
            v.flatten(None, None)?
        } else {
            v
        };
        let c = v.as_dtype(dtype)?;
        c.eval()?;
        cast.insert(k, c);
    }
    WeightStore::from_arrays(cast)
}

impl Decoder {
    /// `files` 是 `vae/` 下的 safetensors 分片，`config` 是 `vae/config.json`。
    pub fn load(files: &[PathBuf], config: &Path, dtype: Dtype) -> Result<Self> {
        let cfg: VaeConfig = serde_json::from_str(&std::fs::read_to_string(config).context("读取 vae/config.json")?)?;
        if cfg.latents_mean.len() != Z_DIM as usize || cfg.latents_std.len() != Z_DIM as usize {
            bail!("vae config 的 latents_mean/std 长度不是 {Z_DIM}");
        }
        let s = &mut load_store(files, "decoder", dtype)?;
        // dims = base * [mult[-1]] + mult[::-1] = [1152,1152,1152,576,288,144]
        let mut dims = vec![DECODER_BASE_DIM * DIM_MULT[4]];
        dims.extend(DIM_MULT.iter().rev().map(|m| DECODER_BASE_DIM * m));
        let temporal_up: Vec<bool> = TEMPORAL_DOWN.iter().rev().copied().collect();
        let mut ups = Vec::new();
        for i in 0..5 {
            let (in_dim, out_dim) = (dims[i], dims[i + 1]);
            let p = format!("decoder.up_blocks.{i}");
            let mut resnets = Vec::new();
            let mut cur = in_dim;
            for j in 0..=NUM_RES {
                resnets.push(ResBlock::load(s, &format!("{p}.resnets.{j}"), cur, out_dim)?);
                cur = out_dim;
            }
            let up = i != 4;
            ups.push(UpBlock {
                resnets,
                upsampler: if up {
                    Some(Conv::load(s, &format!("{p}.upsampler.resample.1"), 1, 1)?)
                } else {
                    None
                },
                in_dim,
                out_dim,
                ft: if up && temporal_up[i] { 2 } else { 1 },
            });
        }
        let me = Self {
            post_quant_conv: Conv::load(s, "post_quant_conv", 0, 1)?,
            conv_in: Conv::load(s, "decoder.conv_in", 1, 1)?,
            mid: MidBlock::load(s, "decoder.mid_block", dims[0])?,
            ups,
            norm_out: RmsNorm::load(s, "decoder.norm_out")?,
            conv_out: Conv::load(s, "decoder.conv_out", 1, 1)?,
            mean: Array::from_slice(&cfg.latents_mean, &[1, 1, 1, Z_DIM]),
            std: Array::from_slice(&cfg.latents_std, &[1, 1, 1, Z_DIM]),
            dtype,
        };
        let left = s.remaining();
        if !left.is_empty() {
            bail!("VAE 解码器有未使用的权重：{:?}", &left[..left.len().min(5)]);
        }
        Ok(me)
    }

    /// DiT 空间的 latent（`[1,h,w,64]`，已按 mean/std 归一化）→ `[1,H,W,4]`，范围 [-1,1]。
    /// 反归一化在 f32 下做，之后才转成 VAE 的计算精度。
    pub fn decode_normalized(self, latents: &Array, tail_rows: Option<usize>) -> Result<Array> {
        let z = latents.as_dtype(Dtype::Float32)?.multiply(&self.std)?.add(&self.mean)?;
        self.decode_raw(&z, tail_rows)
    }

    /// 编码器原始 mu（未归一化）→ 图像。前段（mid 与 up_block 0–1）算完即丢权重，尾段按
    /// `tail_rows` 行一条带（`None` 自动选，`Some(0)` 整张）。
    pub fn decode_raw(self, z: &Array, tail_rows: Option<usize>) -> Result<Array> {
        let Self {
            post_quant_conv,
            conv_in,
            mid,
            mut ups,
            norm_out,
            conv_out,
            dtype,
            ..
        } = self;
        let tail = ups.split_off(TAIL_FROM);
        let x = post_quant_conv.forward(&z.as_dtype(dtype)?)?;
        let x = conv_in.forward(&x)?;
        let mut x = mid.forward(&x)?;
        x.eval()?;
        drop((post_quant_conv, conv_in, mid));
        for (i, b) in ups.into_iter().enumerate() {
            x = b.forward(&x)?;
            trace!("[vae] up_block {i} -> {:?}", x.shape());
        }
        let h = x.dim(1);
        let rows = match tail_rows {
            None => auto_tail_rows(x.dim(2)),
            Some(0) => h,
            Some(n) => n as i32,
        };
        let bands = (h + rows - 1) / rows;
        let rows = (h + bands - 1) / bands;
        let scale = 1 << tail.iter().filter(|b| b.upsampler.is_some()).count();
        let mut outs = Vec::with_capacity(bands as usize);
        let mut r0 = 0;
        while r0 < h {
            let r1 = (r0 + rows).min(h);
            let (a, b) = ((r0 - TAIL_HALO).max(0), (r1 + TAIL_HALO).min(h));
            let mut y = x.index((.., a..b, .., ..));
            for blk in &tail {
                y = blk.forward(&y)?;
            }
            let y = conv_out.forward(&nn::silu(norm_out.forward(&y)?)?)?;
            let y = y.index((.., (r0 - a) * scale..(r1 - a) * scale, .., ..));
            // f16 上溢会以 inf/NaN 出现；clip 之前查，之后 NaN 可能被夹成边界值。
            let finite = y.is_finite()?.all(None)?;
            finite.eval()?;
            if !finite.item::<bool>() {
                bail!("VAE 解码在 {dtype:?} 下出现非有限值");
            }
            let y = ops::clip(&y, (-1.0f32, 1.0f32))?;
            y.eval()?;
            outs.push(y);
            r0 = r1;
        }
        trace!("[vae] 尾段 {} 条带 × {rows} 行（halo {TAIL_HALO}）-> {} 行", outs.len(), h * scale);
        let out = ops::concatenate_axis(&outs, 1)?;
        out.eval()?;
        Ok(out)
    }
}
