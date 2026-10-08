//! Candle adapter. Activations stay on the selected device; host transfers occur
//! only for sampling, audio I/O and checkpoint dequantization at load time.
use anyhow::{Result, bail};
use candle_core::{DType, Device, Tensor, WithDType};
use std::{borrow::Borrow, collections::HashMap, path::Path};

fn device() -> Device {
    crate::backend::candle::default_device()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dtype {
    Float32,
    Float16,
    Bfloat16,
    Int32,
    Uint32,
    Bool,
}
impl Dtype {
    fn native(self) -> DType {
        match self {
            Self::Float32 => DType::F32,
            Self::Float16 => DType::F16,
            Self::Bfloat16 => DType::BF16,
            Self::Int32 => DType::I64,
            Self::Uint32 => DType::U32,
            Self::Bool => DType::U8,
        }
    }
}
#[derive(Clone, Debug)]
pub struct Array(pub Tensor);
impl From<f32> for Array {
    fn from(v: f32) -> Self {
        Self::from_f32(v)
    }
}
impl From<&Array> for Array {
    fn from(v: &Array) -> Self {
        v.clone()
    }
}
pub fn dequantize(w: &Array, s: &Array, b: &Array, group: usize, bits: u32) -> Result<Array> {
    let dtype = if w.0.device().is_cuda() { s.0.dtype() } else { DType::F32 };
    Ok(Array(
        crate::backend::candle::weights::dequantize_affine(&w.0, &s.0, &b.0, group, bits as usize)?.to_dtype(dtype)?,
    ))
}
/// Keep dense weights in their checkpoint precision. CUDA half GEMMs use Tensor
/// Cores; return F32 to the IndexTTS normalization/flow graph for stability.
pub fn linear(x: &Array, w: &Array, b: Option<&Array>) -> Result<Array> {
    let dtype = w.0.dtype();
    let mut y = x.0.to_dtype(dtype)?.broadcast_matmul(&w.0.t()?)?.to_dtype(x.0.dtype())?;
    if let Some(b) = b {
        y = y.broadcast_add(&b.0.to_dtype(y.dtype())?)?;
    }
    Ok(Array(y))
}
pub trait Element: Copy {
    fn tensor(values: &[Self], shape: &[usize], device: &Device) -> candle_core::Result<Tensor>;
}
impl Element for f32 {
    fn tensor(v: &[Self], s: &[usize], d: &Device) -> candle_core::Result<Tensor> {
        Tensor::from_slice(v, s, d)
    }
}
impl Element for i32 {
    fn tensor(v: &[Self], s: &[usize], d: &Device) -> candle_core::Result<Tensor> {
        Tensor::from_vec(v.iter().map(|v| *v as i64).collect::<Vec<_>>(), s, d)
    }
}
impl Element for u32 {
    fn tensor(v: &[Self], s: &[usize], d: &Device) -> candle_core::Result<Tensor> {
        Tensor::from_slice(v, s, d)
    }
}
fn axis(a: i32, n: usize) -> usize {
    if a < 0 { (n as i32 + a) as usize } else { a as usize }
}
fn shape(s: &[i32], len: usize) -> Result<Vec<usize>> {
    let mut out = Vec::new();
    let mut infer = None;
    let mut size = 1usize;
    for &d in s {
        if d == -1 {
            if infer.is_some() {
                bail!("multiple inferred dimensions")
            }
            infer = Some(out.len());
            out.push(1);
        } else {
            if d < 0 {
                bail!("negative dimension {d}")
            }
            size *= d as usize;
            out.push(d as usize);
        }
    }
    if let Some(i) = infer {
        if size == 0 || !len.is_multiple_of(size) {
            bail!("invalid reshape")
        }
        out[i] = len / size;
    }
    Ok(out)
}
impl Array {
    pub fn from_slice<T: Element>(v: &[T], s: &[i32]) -> Self {
        Self(T::tensor(v, &shape(s, v.len()).expect("tensor shape"), &device()).expect("tensor allocation"))
    }
    pub fn from_f32(v: f32) -> Self {
        Self::from_slice(&[v], &[])
    }
    pub fn dtype(&self) -> Dtype {
        match self.0.dtype() {
            DType::F32 => Dtype::Float32,
            DType::F16 => Dtype::Float16,
            DType::BF16 => Dtype::Bfloat16,
            DType::U32 => Dtype::Uint32,
            DType::I64 => Dtype::Int32,
            DType::U8 => Dtype::Bool,
            d => panic!("unsupported dtype {d:?}"),
        }
    }
    pub fn ndim(&self) -> usize {
        self.0.rank()
    }
    pub fn dim(&self, a: i32) -> i32 {
        self.0.dims()[axis(a, self.ndim())] as i32
    }
    pub fn shape(&self) -> Vec<i32> {
        self.0.dims().iter().map(|&d| d as i32).collect()
    }
    pub fn as_dtype(&self, d: Dtype) -> Result<Self> {
        Ok(Self(self.0.to_dtype(d.native())?))
    }
    /// Move a CPU-staged checkpoint tensor to the selected inference device.
    pub fn to_default_device(&self) -> Result<Self> {
        Ok(Self(self.0.to_device(&device())?))
    }
    pub fn reshape(&self, s: impl AsRef<[i32]>) -> Result<Self> {
        Ok(Self(self.0.reshape(shape(s.as_ref(), self.0.elem_count())?)?))
    }
    pub fn transpose_axes(&self, a: &[i32]) -> Result<Self> {
        Ok(Self(self.0.permute(a.iter().map(|&a| axis(a, self.ndim())).collect::<Vec<_>>())?))
    }
    pub fn swap_axes(&self, a: i32, b: i32) -> Result<Self> {
        Ok(Self(self.0.transpose(axis(a, self.ndim()), axis(b, self.ndim()))?))
    }
    pub fn t(&self) -> Self {
        self.transpose_axes(&(0..self.ndim() as i32).rev().collect::<Vec<_>>())
            .expect("transpose")
    }
    pub fn expand_dims(&self, a: i32) -> Result<Self> {
        ops::expand_dims(self, a)
    }
    pub fn squeeze_axes(&self, a: &[i32]) -> Result<Self> {
        let mut t = self.0.clone();
        let mut a = a.iter().map(|&a| axis(a, self.ndim())).collect::<Vec<_>>();
        a.sort_unstable();
        for i in a.into_iter().rev() {
            t = t.squeeze(i)?;
        }
        Ok(Self(t))
    }
    pub fn eval(&self) -> Result<()> {
        Ok(())
    }
    pub fn as_slice<T: WithDType>(&self) -> Vec<T> {
        self.0.flatten_all().and_then(|t| t.to_vec1()).expect("tensor readback")
    }
    pub fn take_axis(&self, ids: &Self, a: i32) -> Result<Self> {
        Ok(Self(self.0.contiguous()?.index_select(
            &ids.0.flatten_all()?.to_dtype(DType::U32)?.contiguous()?,
            axis(a, self.ndim()),
        )?))
    }
    pub fn square(&self) -> Result<Self> {
        Ok(Self(self.0.sqr()?))
    }
    pub fn sqrt(&self) -> Result<Self> {
        Ok(Self(self.0.sqrt()?))
    }
    pub fn rsqrt(&self) -> Result<Self> {
        Ok(Self(self.0.sqrt()?.recip()?))
    }
    pub fn abs(&self) -> Result<Self> {
        Ok(Self(self.0.abs()?))
    }
    pub fn exp(&self) -> Result<Self> {
        Ok(Self(self.0.exp()?))
    }
    pub fn sin(&self) -> Result<Self> {
        Ok(Self(self.0.sin()?))
    }
    pub fn cos(&self) -> Result<Self> {
        Ok(Self(self.0.cos()?))
    }
    pub fn sum_axis(&self, a: i32, keep: bool) -> Result<Self> {
        ops::sum_axis(self, a, keep)
    }
    pub fn mean_axis(&self, a: i32, keep: bool) -> Result<Self> {
        ops::mean_axis(self, a, keep)
    }
    pub fn var_axis(&self, a: i32, keep: bool, ddof: impl Into<Option<i32>>) -> Result<Self> {
        let mean = self.mean_axis(a, true)?;
        let sq = self.subtract(&mean)?.square()?;
        let n = self.dim(a);
        Ok(Self(
            sq.sum_axis(a, keep)?.0.affine(1.0 / (n - ddof.into().unwrap_or(0)) as f64, 0.)?,
        ))
    }
    /// MLX `max_axis`：沿 `a` 取最大值，`keep` 缺省为不保留维度。
    pub fn max_axis(&self, a: i32, keep: impl Into<Option<bool>>) -> Result<Self> {
        let a = axis(a, self.ndim());
        Ok(Self(if keep.into().unwrap_or(false) {
            self.0.max_keepdim(a)?
        } else {
            self.0.max(a)?
        }))
    }
    pub fn logsumexp_axis(&self, a: i32, keep: bool) -> Result<Self> {
        let a = axis(a, self.ndim());
        let t = self.0.log_sum_exp(a)?;
        Ok(Self(if keep { t.unsqueeze(a)? } else { t }))
    }
    pub fn load_safetensors(path: &Path) -> Result<HashMap<String, Self>> {
        use candle_core::safetensors::Load;
        let device = device();
        let bytes = std::fs::read(path)?;
        let tensors = safetensors::SafeTensors::deserialize(&bytes)?;
        tensors
            .tensors()
            .into_iter()
            .map(|(k, view)| {
                // IndexTTS2 stores S2Mel masks as BOOL, represented by U8 on
                // Candle. Preserve all other checkpoint dtypes via its loader.
                let t = if view.dtype() == safetensors::Dtype::BOOL {
                    Tensor::from_raw_buffer(view.data(), DType::U8, view.shape(), &device)?
                } else {
                    view.load(&device)?
                };
                let t = if !device.is_cuda() && t.dtype().is_float() {
                    t.to_dtype(DType::F32)?
                } else {
                    t
                };
                Ok((k, Self(t)))
            })
            .collect()
    }
}
// MLX promotes array/scalar operations. The graph uses F32 constants with
// half weights; preserve the activation precision for scalar constants.
fn pair(a: &Array, b: &Array) -> Result<(Tensor, Tensor)> {
    let dtype = if a.0.elem_count() == 1 {
        b.0.dtype()
    } else if b.0.elem_count() == 1 {
        a.0.dtype()
    } else if a.0.dtype() == DType::F32 || b.0.dtype() == DType::F32 {
        DType::F32
    } else {
        a.0.dtype()
    };
    Ok((a.0.to_dtype(dtype)?, b.0.to_dtype(dtype)?))
}
macro_rules! binary {
    ($($name:ident:$native:ident),*) => {
        $(impl Array {
            pub fn $name(&self, b: impl Borrow<Array>) -> Result<Self> {
                let (a, b) = pair(self, b.borrow())?;
                Ok(Self(a.$native(&b)?))
            }
        })*
    };
}
binary!(add:broadcast_add,subtract:broadcast_sub,multiply:broadcast_mul,divide:broadcast_div,gt:broadcast_gt);
macro_rules! arithmetic {
    ($trait:ident,$method:ident,$op:ident) => {
        impl<T: Borrow<Array>> std::ops::$trait<T> for Array {
            type Output = Array;
            fn $method(self, b: T) -> Array {
                Array::$op(&self, b).expect("tensor operation")
            }
        }
        impl<T: Borrow<Array>> std::ops::$trait<T> for &Array {
            type Output = Array;
            fn $method(self, b: T) -> Array {
                Array::$op(&self, b).expect("tensor operation")
            }
        }
        impl std::ops::$trait<f32> for Array {
            type Output = Array;
            fn $method(self, b: f32) -> Array {
                Array::$op(&self, Array::from_f32(b)).expect("tensor scalar")
            }
        }
        impl std::ops::$trait<f32> for &Array {
            type Output = Array;
            fn $method(self, b: f32) -> Array {
                Array::$op(&self, Array::from_f32(b)).expect("tensor scalar")
            }
        }
    };
}
arithmetic!(Add, add, add);
arithmetic!(Sub, sub, subtract);
arithmetic!(Mul, mul, multiply);
arithmetic!(Div, div, divide);
impl std::ops::Neg for Array {
    type Output = Self;
    fn neg(self) -> Self {
        Self(self.0.neg().expect("neg"))
    }
}
impl std::ops::Neg for &Array {
    type Output = Array;
    fn neg(self) -> Array {
        Array(self.0.neg().expect("neg"))
    }
}

pub mod host {
    use super::*;
    pub use crate::backend::speech_timing_enabled;
    /// candle 没有 MLX 那样的分配器缓存，守卫只为与 MLX 宿主同形。
    pub struct ModelMemoryCacheGuard;
    pub fn ensure_device() -> Result<()> {
        eprintln!(
            "[model-worker] device={} backend=candle",
            crate::backend::candle::device_label(&device())
        );
        Ok(())
    }
    pub fn configure_memory_cache() -> Result<()> {
        ensure_device()
    }
    pub fn clear_memory_cache() -> Result<()> {
        Ok(())
    }
    /// 读取若干 safetensors 分片并合并成一张表；重复的张量名直接报错。
    pub fn load_safetensors(files: &[&Path]) -> Result<HashMap<String, Array>> {
        let mut out = HashMap::new();
        for path in files {
            for (k, v) in Array::load_safetensors(path)? {
                if out.insert(k.clone(), v).is_some() {
                    bail!("duplicate tensor {k}")
                }
            }
        }
        if out.is_empty() {
            bail!("no tensors in {} safetensors file(s)", files.len())
        }
        Ok(out)
    }
    /// candle 的单测与 MLX 一样串行跑：真实权重的用例峰值内存大。
    #[cfg(test)]
    pub(crate) static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
}
pub mod transforms {
    use super::*;
    pub fn eval<'a>(_: impl IntoIterator<Item = &'a Array>) -> Result<()> {
        Ok(())
    }
}
pub fn gelu_same_dtype(x: &Array) -> Result<Array> {
    Ok(Array(x.0.gelu_erf()?))
}
pub mod nn {
    use super::*;
    pub fn mish(x: impl Borrow<Array>) -> Result<Array> {
        Ok(Array(candle_nn::ops::mish(&x.borrow().0)?))
    }
    pub fn silu(x: impl Borrow<Array>) -> Result<Array> {
        Ok(Array(candle_nn::ops::silu(&x.borrow().0)?))
    }
    pub fn relu(x: impl Borrow<Array>) -> Result<Array> {
        Ok(Array(x.borrow().0.relu()?))
    }
    pub fn sigmoid(x: impl Borrow<Array>) -> Result<Array> {
        Ok(Array(candle_nn::ops::sigmoid(&x.borrow().0)?))
    }
}

pub mod random {
    use super::*;
    pub fn key(seed: u64) -> Result<u64> {
        Ok(seed)
    }
    pub fn normal<T: WithDType>(s: &[i32], mean: Option<f32>, std: Option<f32>, key: &u64) -> Result<Array> {
        let dims = shape(s, 0)?;
        let n: usize = dims.iter().product();
        let mut rng = crate::synthesize::qwen3_tts::sampling::Rng::new(*key);
        let mut values = Vec::with_capacity(n);
        while values.len() < n {
            let u = rng.next_f64().max(f64::MIN_POSITIVE);
            let v = rng.next_f64();
            let r = (-2. * u.ln()).sqrt();
            for x in [r * (std::f64::consts::TAU * v).cos(), r * (std::f64::consts::TAU * v).sin()] {
                if values.len() < n {
                    values.push(mean.unwrap_or(0.) + std.unwrap_or(1.) * x as f32);
                }
            }
        }
        Ok(Array(Tensor::from_vec(values, dims, &device())?.to_dtype(T::DTYPE)?))
    }
}

pub mod fast;
pub mod ops;

#[cfg(test)]
mod tests;
