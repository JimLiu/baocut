//! Candle implementation of the operations used by the shared HTDemucs graph.
//! The checkpoint stores MLX channel-last convolution kernels. Only the
//! convolution boundary changes layout; activations stay on the chosen device.
//!
//! 移植自 v2 `bcut-separate` 的 `htdemucs/tensor/candle.rs`。与 v2 不同处：设备不是进程默认设备一个定死，而是由
//! candle 后端按模型包的 `device` 在加载前设定（[`use_device`]）；没设定时用 [`crate::backend::candle::default_device`]
//! （`cuda` feature、`BAOCUT_GPU`、CUDA 失败回退 CPU 都在那里）。另补了 MLX 词汇里有、v2 适配层没有的 `Array::eval`
//! 与 `load_safetensors_deferred`。

use anyhow::{Result, bail};
use candle_core::{DType, Device, Tensor, WithDType};
use std::sync::RwLock;
use std::{collections::HashMap, path::Path};

/// 本进程分离用的设备。一个 Worker 一次只加载一个模型包，加载前设定一次。
static DEVICE: RwLock<Option<Device>> = RwLock::new(None);

/// 设定之后加载与分离用的设备（candle 后端按模型包的 `device` 调用）。
pub fn use_device(device: Device) {
    *DEVICE.write().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(device);
}

fn device() -> Device {
    DEVICE
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
        .unwrap_or_else(crate::backend::candle::default_device)
}

pub fn ensure_device() -> Result<()> {
    eprintln!(
        "[model-worker] separate backend=candle device={}",
        crate::backend::candle::device_label(&device())
    );
    Ok(())
}

/// 读取 safetensors（只留 `keep` 认的键）。candle 没有惰性求值：权重读进来就在设备上，fp16 → f32 的上转换在
/// `WeightStore::take` 里逐个做、fp16 原件随即释放。
pub fn load_safetensors_deferred(files: &[&Path], keep: impl Fn(&str) -> bool) -> Result<HashMap<String, Array>> {
    let mut all = HashMap::new();
    for file in files {
        for (name, value) in Array::load_safetensors(file)? {
            if keep(&name) {
                all.insert(name, value);
            }
        }
    }
    Ok(all)
}

pub fn configure_memory_cache() -> Result<()> {
    Ok(())
}

pub struct MemoryCacheGuard;
impl MemoryCacheGuard {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn near(actual: &Array, expected: &[f32]) {
        let actual = actual.as_slice::<f32>();
        assert_eq!(actual.len(), expected.len());
        for (a, e) in actual.iter().zip(expected) {
            assert!((a - e).abs() < 1e-5, "{actual:?} != {expected:?}");
        }
    }

    #[test]
    fn asymmetric_transposed_convolution_inserts_zeros_on_frequency_axis() {
        let input = Array::from_slice(&[1f32, 2.], &[1, 2, 1, 1]);
        let kernel = Array::from_slice(&[1f32, 2., 3.], &[1, 3, 1, 1]);
        let output = ops::conv_transpose2d(&input, &kernel, (2, 1), (0, 0), (1, 1), (0, 0), 1).unwrap();
        assert_eq!(output.shape(), [1, 5, 1, 1]);
        near(&output, &[1., 2., 5., 4., 6.]);
    }

    #[test]
    fn sample_variance_reduces_channel_frequency_and_time_axes() {
        let input = Array::from_slice(&[1f32, 2., 3., 4.], &[1, 2, 2, 1]);
        near(&input.mean_axes(&[1, 2, 3], true).unwrap(), &[2.5]);
        near(&input.var_axes(&[1, 2, 3], true, 0).unwrap(), &[1.25]);
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Dtype {
    Float32,
    Float16,
    Bfloat16,
}

#[derive(Clone, Debug)]
pub struct Array(pub Tensor);

impl From<f32> for Array {
    fn from(value: f32) -> Self {
        Self::from_f32(value)
    }
}

fn axis(a: i32, rank: usize) -> usize {
    if a < 0 { (rank as i32 + a) as usize } else { a as usize }
}

fn shape(dims: &[i32], len: usize) -> Result<Vec<usize>> {
    let mut result = Vec::with_capacity(dims.len());
    let mut infer = None;
    let mut known = 1usize;
    for &dim in dims {
        if dim == -1 {
            if infer.replace(result.len()).is_some() {
                bail!("多个待推断维度")
            }
            result.push(1);
        } else if dim >= 0 {
            known *= dim as usize;
            result.push(dim as usize);
        } else {
            bail!("负维度 {dim}")
        }
    }
    if let Some(index) = infer {
        if known == 0 || !len.is_multiple_of(known) {
            bail!("无法推断张量形状")
        }
        result[index] = len / known;
    }
    Ok(result)
}

impl Array {
    pub fn from_slice<T: WithDType>(values: &[T], dims: &[i32]) -> Self {
        Self(Tensor::from_slice(values, shape(dims, values.len()).expect("tensor shape"), &device()).expect("tensor allocation"))
    }

    pub fn from_f32(value: f32) -> Self {
        Self::from_slice(&[value], &[])
    }

    pub fn load_safetensors(path: &Path) -> Result<HashMap<String, Self>> {
        Ok(candle_core::safetensors::load(path, &device())?
            .into_iter()
            .map(|(name, value)| (name, Self(value)))
            .collect())
    }

    pub fn dtype(&self) -> Dtype {
        match self.0.dtype() {
            DType::F32 => Dtype::Float32,
            DType::F16 => Dtype::Float16,
            DType::BF16 => Dtype::Bfloat16,
            dtype => panic!("HTDemucs 权重不支持 {dtype:?}"),
        }
    }

    pub fn as_dtype(&self, dtype: Dtype) -> Result<Self> {
        match dtype {
            Dtype::Float32 => Ok(Self(self.0.to_dtype(DType::F32)?)),
            Dtype::Float16 => Ok(Self(self.0.to_dtype(DType::F16)?)),
            Dtype::Bfloat16 => Ok(Self(self.0.to_dtype(DType::BF16)?)),
        }
    }

    pub fn shape(&self) -> Vec<i32> {
        self.0.dims().iter().map(|&d| d as i32).collect()
    }

    pub fn ndim(&self) -> usize {
        self.0.rank()
    }

    pub fn dim(&self, a: i32) -> i32 {
        self.0.dims()[axis(a, self.ndim())] as i32
    }

    pub fn reshape(&self, dims: &[i32]) -> Result<Self> {
        Ok(Self(self.0.reshape(shape(dims, self.0.elem_count())?)?))
    }

    pub fn transpose_axes(&self, axes: &[i32]) -> Result<Self> {
        Ok(Self(
            self.0.permute(axes.iter().map(|&a| axis(a, self.ndim())).collect::<Vec<_>>())?,
        ))
    }

    pub fn t(&self) -> Self {
        self.transpose_axes(&(0..self.ndim() as i32).rev().collect::<Vec<_>>())
            .expect("transpose")
    }

    pub fn mean_axes(&self, axes: &[i32], keep: bool) -> Result<Self> {
        let mut out = self.0.clone();
        let mut axes = axes.iter().map(|&a| axis(a, self.ndim())).collect::<Vec<_>>();
        axes.sort_unstable();
        for &a in &axes {
            out = out.mean_keepdim(a)?;
        }
        if !keep {
            for &a in axes.iter().rev() {
                out = out.squeeze(a)?;
            }
        }
        Ok(Self(out))
    }

    pub fn var_axes(&self, axes: &[i32], keep: bool, _ddof: i32) -> Result<Self> {
        let mean = self.mean_axes(axes, true)?;
        Self(self.0.broadcast_sub(&mean.0)?.sqr()?).mean_axes(axes, keep)
    }

    pub fn add(&self, rhs: impl Into<Self>) -> Result<Self> {
        Ok(Self(self.0.broadcast_add(&rhs.into().0)?))
    }
    pub fn subtract(&self, rhs: impl Into<Self>) -> Result<Self> {
        Ok(Self(self.0.broadcast_sub(&rhs.into().0)?))
    }
    pub fn multiply(&self, rhs: impl Into<Self>) -> Result<Self> {
        Ok(Self(self.0.broadcast_mul(&rhs.into().0)?))
    }
    pub fn divide(&self, rhs: impl Into<Self>) -> Result<Self> {
        Ok(Self(self.0.broadcast_div(&rhs.into().0)?))
    }
    /// MLX 的 `eval` 物化惰性图；candle 立即求值，这里什么都不做。
    pub fn eval(&self) -> Result<()> {
        Ok(())
    }

    pub fn as_slice<T: WithDType>(&self) -> Vec<T> {
        self.0.flatten_all().and_then(|t| t.to_vec1()).expect("tensor readback")
    }
}

impl From<&Array> for Array {
    fn from(value: &Array) -> Self {
        value.clone()
    }
}

pub fn gelu_same_dtype(x: &Array) -> Result<Array> {
    Ok(Array(x.0.gelu_erf()?))
}

pub mod nn {
    use super::*;
    pub fn sigmoid(x: &Array) -> Result<Array> {
        Ok(Array(candle_nn::ops::sigmoid(&x.0)?))
    }
}

pub mod transforms {
    use super::*;
    pub fn eval<'a>(_: impl IntoIterator<Item = &'a Array>) -> Result<()> {
        Ok(())
    }
}

pub mod fast {
    use super::*;
    pub fn layer_norm(x: &Array, w: Option<&Array>, b: Option<&Array>, eps: f32) -> Result<Array> {
        let mean = x.0.mean_keepdim(candle_core::D::Minus1)?;
        let centered = x.0.broadcast_sub(&mean)?;
        let variance = centered.sqr()?.mean_keepdim(candle_core::D::Minus1)?;
        let mut out = centered.broadcast_div(&(variance + eps as f64)?.sqrt()?)?;
        if let Some(w) = w {
            out = out.broadcast_mul(&w.0)?;
        }
        if let Some(b) = b {
            out = out.broadcast_add(&b.0)?;
        }
        Ok(Array(out))
    }

    pub fn scaled_dot_product_attention(
        q: &Array,
        k: &Array,
        v: &Array,
        scale: f32,
        _mask: Option<&Array>,
        _sinks: Option<&Array>,
    ) -> Result<Array> {
        Ok(Array(crate::backend::candle::layers::scaled_dot_product_attention(
            &q.0.contiguous()?,
            &k.0.contiguous()?,
            &v.0.contiguous()?,
            scale as f64,
            None,
        )?))
    }
}

pub mod ops {
    use super::*;

    pub fn sqrt(x: &Array) -> Result<Array> {
        Ok(Array(x.0.sqrt()?))
    }
    pub fn rsqrt(x: &Array) -> Result<Array> {
        Ok(Array(x.0.sqrt()?.recip()?))
    }
    pub fn matmul(x: &Array, y: &Array) -> Result<Array> {
        Ok(Array(x.0.contiguous()?.broadcast_matmul(&y.0.contiguous()?)?))
    }
    pub fn split(x: &Array, count: i32, axis: i32) -> Result<Vec<Array>> {
        let a = super::axis(axis, x.ndim());
        let len = x.0.dim(a)?;
        let part = len / count as usize;
        if part * count as usize != len {
            bail!("split 维度不能整除")
        }
        Ok((0..count as usize)
            .map(|i| x.0.narrow(a, i * part, part).map(Array))
            .collect::<candle_core::Result<Vec<_>>>()?)
    }

    pub fn pad(x: &Array, widths: &[(i32, i32)], _: Option<f32>, _: Option<()>) -> Result<Array> {
        let mut out = x.0.clone();
        for (axis, &(before, after)) in widths.iter().enumerate() {
            if before < 0 || after < 0 {
                bail!("负 padding")
            }
            if before != 0 || after != 0 {
                out = out.pad_with_zeros(axis, before as usize, after as usize)?;
            }
        }
        Ok(Array(out))
    }

    fn pair(x: &Array, w: &Array) -> Result<(Tensor, Tensor)> {
        let dtype = w.0.dtype();
        Ok((x.0.to_dtype(dtype)?, w.0.clone()))
    }

    pub fn conv1d(x: &Array, w: &Array, stride: i32, padding: i32, dilation: i32, groups: i32) -> Result<Array> {
        let (x, w) = pair(x, w)?;
        Ok(Array(
            x.transpose(1, 2)?
                .contiguous()?
                .conv1d(
                    &w.transpose(1, 2)?.contiguous()?,
                    padding as usize,
                    stride as usize,
                    dilation as usize,
                    groups as usize,
                )?
                .transpose(1, 2)?,
        ))
    }

    pub fn conv2d(x: &Array, w: &Array, stride: (i32, i32), padding: (i32, i32), _: (i32, i32), _: i32) -> Result<Array> {
        let (x, w) = pair(x, w)?;
        let mut x = x.permute((0, 3, 1, 2))?.contiguous()?;
        let w = w.permute((0, 3, 1, 2))?.contiguous()?;
        if stride.0 != stride.1 || padding.0 != padding.1 {
            x = x
                .pad_with_zeros(2, padding.0 as usize, padding.0 as usize)?
                .pad_with_zeros(3, padding.1 as usize, padding.1 as usize)?;
            let mut y = x.conv2d(&w, 0, 1, 1, 1)?;
            for (axis, step) in [(2, stride.0), (3, stride.1)] {
                if step > 1 {
                    let ids = (0..y.dim(axis)? as u32).step_by(step as usize).collect::<Vec<_>>();
                    let ids = Tensor::from_vec(ids.clone(), ids.len(), y.device())?;
                    y = y.contiguous()?.index_select(&ids, axis)?;
                }
            }
            Ok(Array(y.permute((0, 2, 3, 1))?))
        } else {
            Ok(Array(
                x.conv2d(&w, padding.0 as usize, stride.0 as usize, 1, 1)?.permute((0, 2, 3, 1))?,
            ))
        }
    }

    pub fn conv_transpose1d(x: &Array, w: &Array, stride: i32, padding: i32, dilation: i32, output_padding: i32, _: i32) -> Result<Array> {
        let (x, w) = pair(x, w)?;
        Ok(Array(
            x.transpose(1, 2)?
                .contiguous()?
                .conv_transpose1d(
                    &w.permute((2, 0, 1))?.contiguous()?,
                    padding as usize,
                    output_padding as usize,
                    stride as usize,
                    dilation as usize,
                    1,
                )?
                .transpose(1, 2)?,
        ))
    }

    pub fn conv_transpose2d(
        x: &Array,
        w: &Array,
        stride: (i32, i32),
        padding: (i32, i32),
        dilation: (i32, i32),
        output_padding: (i32, i32),
        groups: i32,
    ) -> Result<Array> {
        if padding != (0, 0) || dilation != (1, 1) || output_padding != (0, 0) || groups != 1 {
            bail!("HTDemucs 转置卷积只支持无 padding/dilation/groups")
        }
        let (x, w) = pair(x, w)?;
        let mut x = x.permute((0, 3, 1, 2))?.contiguous()?;
        let w = w.permute((3, 0, 1, 2))?.contiguous()?;
        // Candle exposes a scalar 2D stride. Insert zeros separately on each
        // axis, then use unit-stride transposed convolution. The tensor stays
        // on CUDA and has the same output shape as MLX's (stride_h, stride_w).
        for (axis, step) in [(2, stride.0), (3, stride.1)] {
            if step > 1 {
                let old = x.dim(axis)?;
                x = x.unsqueeze(axis + 1)?.pad_with_zeros(axis + 1, 0, step as usize - 1)?;
                let mut dims = x.dims().to_vec();
                dims[axis] *= dims.remove(axis + 1);
                x = x.reshape(dims)?.narrow(axis, 0, (old - 1) * step as usize + 1)?;
            }
        }
        Ok(Array(x.conv_transpose2d(&w, 0, 0, 1, 1)?.permute((0, 2, 3, 1))?))
    }

    pub mod indexing {
        use super::*;
        use std::ops::{Range, RangeFull};

        pub enum Slice {
            All,
            Span(i32, i32),
        }
        pub trait IntoSlice {
            fn slice(self) -> Slice;
        }
        impl IntoSlice for RangeFull {
            fn slice(self) -> Slice {
                Slice::All
            }
        }
        impl IntoSlice for Range<i32> {
            fn slice(self) -> Slice {
                Slice::Span(self.start, self.end)
            }
        }
        pub trait Slices {
            fn slices(self) -> Vec<Slice>;
        }
        impl<T: IntoSlice> Slices for T {
            fn slices(self) -> Vec<Slice> {
                vec![self.slice()]
            }
        }
        macro_rules! tuple {
            ($($t:ident),*) => {
                impl<$($t: IntoSlice),*> Slices for ($($t,)*) {
                    #[allow(non_snake_case)]
                    fn slices(self) -> Vec<Slice> {
                        let ($($t,)*) = self;
                        vec![$($t.slice()),*]
                    }
                }
            };
        }
        tuple!(A, B);
        tuple!(A, B, C);
        tuple!(A, B, C, D);
        pub trait IndexOp {
            fn index(&self, slices: impl Slices) -> Array;
        }
        impl IndexOp for Array {
            fn index(&self, slices: impl Slices) -> Array {
                let mut out = self.0.clone();
                for (axis, slice) in slices.slices().into_iter().enumerate() {
                    if let Slice::Span(start, end) = slice {
                        out = out.narrow(axis, start as usize, (end - start) as usize).expect("tensor slice");
                    }
                }
                Array(out)
            }
        }
    }
}
