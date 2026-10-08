use super::*;

macro_rules! unary {
    ($($name:ident:$op:ident),*) => {
        $(pub fn $name(x: impl Borrow<Array>) -> Result<Array> {
            Ok(Array(x.borrow().0.$op()?))
        })*
    };
}
unary!(exp:exp,sin:sin,square:sqr,sqrt:sqrt,tanh:tanh,erf:erf,reciprocal:recip);
pub use super::nn::sigmoid;
/// MLX `round`：`decimals` 位小数，恰在 .5 上时取偶（与 MLX / NumPy 同为银行家舍入；
/// Candle 的 `round` 是远离零，VoxCPM2 FSQ 的 `round(tanh(x)*9)/9` 要跟 MLX 对齐）。
pub fn round(x: impl Borrow<Array>, decimals: impl Into<Option<i32>>) -> Result<Array> {
    let x = &x.borrow().0;
    let mult = 10f64.powi(decimals.into().unwrap_or(0));
    let scaled = (x * mult)?;
    let nearest = scaled.round()?;
    let even = ((&scaled * 0.5)?.round()? * 2.)?;
    let tie = (&scaled - scaled.floor()?)?.eq(0.5)?;
    Ok(Array((tie.where_cond(&even, &nearest)? * (1. / mult))?))
}
pub fn matmul(a: impl Borrow<Array>, b: impl Borrow<Array>) -> Result<Array> {
    let (a, b) = pair(a.borrow(), b.borrow())?;
    Ok(Array(a.contiguous()?.broadcast_matmul(&b.contiguous()?)?))
}
pub fn maximum(a: impl Borrow<Array>, b: impl Borrow<Array>) -> Result<Array> {
    let (a, b) = pair(a.borrow(), b.borrow())?;
    Ok(Array(a.broadcast_maximum(&b)?))
}
pub fn clip<L: Into<Array>, H: Into<Array>>(x: impl Borrow<Array>, (lo, hi): (L, H)) -> Result<Array> {
    let x = x.borrow();
    let (a, b) = pair(x, &lo.into())?;
    let y = a.broadcast_maximum(&b)?;
    Ok(Array(y.broadcast_minimum(&hi.into().0.to_dtype(y.dtype())?)?))
}
pub fn logaddexp(a: impl Borrow<Array>, b: impl Borrow<Array>) -> Result<Array> {
    let (a, b) = pair(a.borrow(), b.borrow())?;
    let m = a.broadcast_maximum(&b)?;
    Ok(Array(m.broadcast_add(
        &a.broadcast_sub(&m)?.exp()?.broadcast_add(&b.broadcast_sub(&m)?.exp()?)?.log()?,
    )?))
}
pub fn which(c: impl Borrow<Array>, a: impl Borrow<Array>, b: impl Borrow<Array>) -> Result<Array> {
    let (a, b) = pair(a.borrow(), b.borrow())?;
    let dims = broadcast_shape(a.dims(), b.dims())?;
    let dims = broadcast_shape(&dims, c.borrow().0.dims())?;
    Ok(Array(
        c.borrow()
            .0
            .broadcast_as(dims.clone())?
            .where_cond(&a.broadcast_as(dims.clone())?, &b.broadcast_as(dims)?)?,
    ))
}
fn broadcast_shape(a: &[usize], b: &[usize]) -> Result<Vec<usize>> {
    let n = a.len().max(b.len());
    let mut d = vec![1; n];
    for i in 0..n {
        let x = a.len().checked_sub(i + 1).map_or(1, |j| a[j]);
        let y = b.len().checked_sub(i + 1).map_or(1, |j| b[j]);
        if x != y && x != 1 && y != 1 {
            bail!("incompatible broadcast {a:?} {b:?}")
        }
        d[n - i - 1] = if x == 1 { y } else { x };
    }
    Ok(d)
}
pub fn broadcast_to(x: impl Borrow<Array>, s: impl AsRef<[i32]>) -> Result<Array> {
    Ok(Array(x.borrow().0.broadcast_as(shape(s.as_ref(), 0)?)?))
}
pub fn expand_dims(x: impl Borrow<Array>, a: i32) -> Result<Array> {
    let x = x.borrow();
    Ok(Array(x.0.unsqueeze(axis(a, x.ndim() + 1))?))
}
pub fn concatenate_axis<T: Borrow<Array>>(xs: &[T], a: i32) -> Result<Array> {
    let a = axis(a, xs[0].borrow().ndim());
    let dtype = xs[0].borrow().0.dtype();
    let ts = xs
        .iter()
        .map(|x| x.borrow().0.to_dtype(dtype))
        .collect::<candle_core::Result<Vec<_>>>()?;
    Ok(Array(Tensor::cat(&ts, a)?))
}
pub fn stack_axis<T: Borrow<Array>>(xs: &[T], a: i32) -> Result<Array> {
    let a = axis(a, xs[0].borrow().ndim() + 1);
    let ts = xs.iter().map(|x| &x.borrow().0).collect::<Vec<_>>();
    Ok(Array(Tensor::stack(&ts, a)?))
}
pub fn split(x: impl Borrow<Array>, n: i32, a: i32) -> Result<Vec<Array>> {
    let x = x.borrow();
    Ok(x.0.chunk(n as usize, axis(a, x.ndim()))?.into_iter().map(Array).collect())
}
pub fn zeros<T: WithDType>(s: &[i32]) -> Result<Array> {
    Ok(Array(Tensor::zeros(shape(s, 0)?, T::DTYPE, &device())?))
}
pub fn zeros_dtype(s: &[i32], d: Dtype) -> Result<Array> {
    Ok(Array(Tensor::zeros(shape(s, 0)?, d.native(), &device())?))
}
pub fn zeros_like(x: impl Borrow<Array>) -> Result<Array> {
    Ok(Array(x.borrow().0.zeros_like()?))
}
/// MLX `dequantize`：仿射量化权重（U32 打包，末维按 `group_size` 分组）还原成浮点。
/// 前导维度任意（先按行展平成二维，再还原形状），用于先按 id 取行、再只反量化取出的行。
/// `biases` 为空时按 MLX 语义报错（仿射量化必须带偏置）。
pub fn dequantize<'a>(
    w: impl Borrow<Array>,
    scales: impl Borrow<Array>,
    biases: impl Into<Option<&'a Array>>,
    group_size: impl Into<Option<i32>>,
    bits: impl Into<Option<i32>>,
) -> Result<Array> {
    let (w, scales) = (w.borrow(), scales.borrow());
    let Some(biases) = biases.into() else {
        bail!("dequantize 需要 biases（仿射量化）")
    };
    let group_size = group_size.into().unwrap_or(64);
    let bits = bits.into().unwrap_or(4);
    if bits <= 0 || 32 % bits != 0 || group_size <= 0 {
        bail!("dequantize 不支持的量化参数：group {group_size} bits {bits}")
    }
    let mut out_shape = w.shape();
    let Some(last) = out_shape.last_mut() else {
        bail!("dequantize 需要至少一维")
    };
    *last *= 32 / bits;
    let cols = w.dim(-1);
    let groups = scales.dim(-1);
    let flat = super::dequantize(
        &w.reshape([-1, cols])?,
        &scales.reshape([-1, groups])?,
        &biases.reshape([-1, groups])?,
        group_size as usize,
        bits as u32,
    )?;
    flat.reshape(out_shape)
}
pub fn sum_axis(x: impl Borrow<Array>, a: i32, keep: bool) -> Result<Array> {
    let x = x.borrow();
    let a = axis(a, x.ndim());
    Ok(Array(if keep { x.0.sum_keepdim(a)? } else { x.0.sum(a)? }))
}
pub fn mean_axis(x: impl Borrow<Array>, a: i32, keep: bool) -> Result<Array> {
    let x = x.borrow();
    let a = axis(a, x.ndim());
    Ok(Array(if keep { x.0.mean_keepdim(a)? } else { x.0.mean(a)? }))
}
pub fn softmax_axis(x: impl Borrow<Array>, a: i32, _precise: impl Into<Option<bool>>) -> Result<Array> {
    let x = x.borrow();
    let dtype = x.0.dtype();
    Ok(Array(
        candle_nn::ops::softmax(&x.0.to_dtype(DType::F32)?, axis(a, x.ndim()))?.to_dtype(dtype)?,
    ))
}
pub fn arange<T, U>(start: Option<i32>, end: i32, step: Option<i32>) -> Result<Array> {
    let _ = std::marker::PhantomData::<(T, U)>;
    let start = start.unwrap_or(0);
    let step = step.unwrap_or(1);
    if step <= 0 {
        bail!("invalid arange step")
    }
    let v = (start..end).step_by(step as usize).collect::<Vec<_>>();
    Ok(Array::from_slice(&v, &[v.len() as i32]))
}
#[derive(Clone, Copy)]
pub enum PadMode {
    Constant,
    Edge,
}
pub fn pad(x: impl Borrow<Array>, pads: &[(i32, i32)], value: impl Into<Option<Array>>, mode: impl Into<Option<PadMode>>) -> Result<Array> {
    let x = x.borrow();
    let value = value.into().unwrap_or_else(|| Array::from_f32(0.));
    let mut t = x.0.clone();
    let edge = matches!(mode.into(), Some(PadMode::Edge));
    for (a, &(l, r)) in pads.iter().enumerate() {
        if l == 0 && r == 0 {
            continue;
        }
        if l < 0 || r < 0 {
            bail!("negative padding")
        }
        let mut parts = Vec::new();
        for (n, last) in [(l, false), (r, true)] {
            if n == 0 {
                continue;
            }
            let mut s = t.dims().to_vec();
            s[a] = n as usize;
            let p = if edge {
                t.narrow(a, if last { t.dim(a)? - 1 } else { 0 }, 1)?.broadcast_as(s)?
            } else {
                value.0.to_dtype(t.dtype())?.broadcast_as(s)?
            };
            if last {
                parts.push(t.clone());
                parts.push(p);
            } else {
                parts.push(p);
            }
        }
        if r == 0 {
            parts.push(t.clone());
        }
        t = Tensor::cat(&parts, a)?;
    }
    Ok(Array(t))
}
// Models use NLC / OLC. Candle/cuBLAS use NCL / OCL.
pub fn conv1d(x: impl Borrow<Array>, w: impl Borrow<Array>, stride: i32, padding: i32, dilation: i32, groups: i32) -> Result<Array> {
    let (x, w) = pair(x.borrow(), w.borrow())?;
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
pub fn conv_transpose1d(
    x: impl Borrow<Array>,
    w: impl Borrow<Array>,
    stride: i32,
    padding: i32,
    dilation: i32,
    output_padding: i32,
    groups: i32,
) -> Result<Array> {
    let (x, w) = pair(x.borrow(), w.borrow())?;
    Ok(Array(
        x.transpose(1, 2)?
            .contiguous()?
            .conv_transpose1d(
                &w.permute((2, 0, 1))?.contiguous()?,
                padding as usize,
                output_padding as usize,
                stride as usize,
                dilation as usize,
                groups as usize,
            )?
            .transpose(1, 2)?,
    ))
}
pub fn conv2d(
    x: impl Borrow<Array>,
    w: impl Borrow<Array>,
    stride: (i32, i32),
    padding: (i32, i32),
    _: Option<(i32, i32)>,
    _: Option<i32>,
) -> Result<Array> {
    if stride.0 <= 0 || stride.1 <= 0 || padding.0 < 0 || padding.1 < 0 {
        bail!("invalid conv2d stride/padding")
    }
    let (x, w) = pair(x.borrow(), w.borrow())?;
    let x = x.permute((0, 3, 1, 2))?.contiguous()?;
    let w = w.permute((0, 3, 1, 2))?.contiguous()?;
    if stride.0 == stride.1 && padding.0 == padding.1 {
        return Ok(Array(
            x.conv2d(&w, padding.0 as usize, stride.0 as usize, 1, 1)?.permute((0, 2, 3, 1))?,
        ));
    }
    // CAMPPlus downsamples frequency only. Candle's conv2d has scalar stride:
    // compute stride one, then gather the selected rows/columns on the GPU.
    let x = x
        .pad_with_zeros(2, padding.0 as usize, padding.0 as usize)?
        .pad_with_zeros(3, padding.1 as usize, padding.1 as usize)?;
    let mut y = x.conv2d(&w, 0, 1, 1, 1)?;
    for (a, step) in [(2, stride.0), (3, stride.1)] {
        if step > 1 {
            let ids = (0..y.dim(a)? as u32).step_by(step as usize).collect::<Vec<_>>();
            let ids = Tensor::from_vec(ids.clone(), ids.len(), y.device())?;
            y = y.contiguous()?.index_select(&ids, a)?;
        }
    }
    Ok(Array(y.permute((0, 2, 3, 1))?))
}

pub mod indexing {
    use super::*;
    use std::ops::{Range, RangeFrom, RangeFull, RangeTo};
    pub enum Slice {
        All,
        One(i32),
        Span(i32, Option<i32>),
        Ids(Array),
    }
    pub trait IntoSlice {
        fn slice(self) -> Slice;
    }
    impl IntoSlice for RangeFull {
        fn slice(self) -> Slice {
            Slice::All
        }
    }
    impl IntoSlice for i32 {
        fn slice(self) -> Slice {
            Slice::One(self)
        }
    }
    impl IntoSlice for Range<i32> {
        fn slice(self) -> Slice {
            Slice::Span(self.start, Some(self.end))
        }
    }
    impl IntoSlice for RangeFrom<i32> {
        fn slice(self) -> Slice {
            Slice::Span(self.start, None)
        }
    }
    impl IntoSlice for RangeTo<i32> {
        fn slice(self) -> Slice {
            Slice::Span(0, Some(self.end))
        }
    }
    impl IntoSlice for Array {
        fn slice(self) -> Slice {
            Slice::Ids(self)
        }
    }
    impl IntoSlice for &Array {
        fn slice(self) -> Slice {
            Slice::Ids(self.clone())
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
        fn index(&self, s: impl Slices) -> Array;
    }
    impl IndexOp for Array {
        fn index(&self, s: impl Slices) -> Array {
            index(self, s.slices()).expect("tensor index")
        }
    }
    fn index(x: &Array, s: Vec<Slice>) -> Result<Array> {
        let mut t = x.0.clone();
        let mut a = 0;
        for s in s {
            let n = t.dim(a)? as i32;
            match s {
                Slice::All => a += 1,
                Slice::One(i) => {
                    let i = if i < 0 { n + i } else { i };
                    t = t.narrow(a, i as usize, 1)?.squeeze(a)?;
                }
                Slice::Span(start, end) => {
                    let end = end.unwrap_or(n);
                    let start = if start < 0 { n + start } else { start };
                    let end = if end < 0 { n + end } else { end };
                    t = t.narrow(a, start as usize, (end - start) as usize)?;
                    a += 1;
                }
                Slice::Ids(ids) => {
                    let mut shape = t.dims().to_vec();
                    shape.splice(a..a + 1, ids.0.dims().iter().copied());
                    t = t
                        .contiguous()?
                        .index_select(&ids.0.flatten_all()?.to_dtype(DType::U32)?.contiguous()?, a)?
                        .reshape(shape)?;
                    a += ids.ndim();
                }
            }
        }
        Ok(Array(t))
    }
    pub trait IndexMutOp {
        fn index_mut(&mut self, s: impl Slices, v: &Array);
    }
    impl IndexMutOp for Array {
        fn index_mut(&mut self, s: impl Slices, v: &Array) {
            let mut ranges = Vec::new();
            for (a, s) in s.slices().into_iter().enumerate() {
                let n = self.0.dims()[a];
                ranges.push(match s {
                    Slice::All => 0..n,
                    Slice::Span(start, end) => start as usize..end.map_or(n, |i| i as usize),
                    _ => panic!("unsupported index update"),
                });
            }
            self.0 = self.0.slice_assign(&ranges, &v.0).expect("cache slice update");
        }
    }
    pub fn argmin_axis(x: impl Borrow<Array>, a: i32, keep: impl Into<Option<bool>>) -> Result<Array> {
        let x = x.borrow();
        let a = axis(a, x.ndim());
        Ok(Array(if keep.into().unwrap_or(false) {
            x.0.argmin_keepdim(a)?
        } else {
            x.0.argmin(a)?
        }))
    }
    pub fn argmax_axis(x: impl Borrow<Array>, a: i32, keep: impl Into<Option<bool>>) -> Result<Array> {
        let x = x.borrow();
        let a = axis(a, x.ndim());
        Ok(Array(if keep.into().unwrap_or(false) {
            x.0.argmax_keepdim(a)?
        } else {
            x.0.argmax(a)?
        }))
    }
}
