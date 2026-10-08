//! GPT-SoVITS 用到的基础层：线性、LayerNorm、Conv1d（NLC 布局）与激活函数。
//!
//! 移植自 v2 `bcut-tts::index_tts2::mlx::layers`（IndexTTS2 与 GPT-SoVITS 共用的那一份），只带
//! GPT-SoVITS 用到的部分、去掉 Candle 分支；与 IndexTTS2 的同名层同源，两边都移植完可以合并成一份。
//!
//! 线性权重按 safetensors 的 f16 原样驻留，前向时转成输入 dtype（与 MLX matmul 的类型提升一致）；
//! 卷积与归一化参数在加载时转 f32。

use super::weights::WeightMap;
use crate::synthesize::tensor::{Array, Dtype, fast, ops};
use anyhow::Result;

/// `y = x @ Wᵀ + b`，权重形状 `[out, in]`（PyTorch 布局）。
pub struct Linear {
    pub weight: Array,
    pub bias: Option<Array>,
}

impl Linear {
    pub fn load(weights: &mut WeightMap, prefix: &str) -> Result<Self> {
        let weight = weights.take(&format!("{prefix}.weight"))?;
        let bias = weights.take_optional_f32(&format!("{prefix}.bias"))?;
        Ok(Self { weight, bias })
    }

    pub fn load_no_bias(weights: &mut WeightMap, prefix: &str) -> Result<Self> {
        let weight = weights.take(&format!("{prefix}.weight"))?;
        Ok(Self { weight, bias: None })
    }

    pub fn forward(&self, x: &Array) -> Result<Array> {
        #[cfg(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")))]
        return crate::synthesize::tensor::linear(x, &self.weight, self.bias.as_ref());
        #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
        {
            let weight = self.weight.as_dtype(x.dtype())?;
            let mut y = ops::matmul(x, weight.t())?;
            if let Some(bias) = &self.bias {
                y = y + bias.as_dtype(x.dtype())?;
            }
            Ok(y)
        }
    }
}

/// 最后一维 LayerNorm（可选仿射）。
pub struct LayerNorm {
    pub weight: Option<Array>,
    pub bias: Option<Array>,
    pub eps: f32,
}

impl LayerNorm {
    pub fn load(weights: &mut WeightMap, prefix: &str, eps: f32) -> Result<Self> {
        Ok(Self {
            weight: Some(weights.take_f32(&format!("{prefix}.weight"))?),
            bias: weights.take_optional_f32(&format!("{prefix}.bias"))?,
            eps,
        })
    }

    pub fn forward(&self, x: &Array) -> Result<Array> {
        let x32 = x.as_dtype(Dtype::Float32)?;
        Ok(fast::layer_norm(&x32, self.weight.as_ref(), self.bias.as_ref(), self.eps)?)
    }
}

/// 1D 卷积。权重内部保存为 MLX 布局 `[Cout, K, Cin/groups]`（f32）。
pub struct Conv1d {
    pub weight: Array,
    pub bias: Option<Array>,
    pub stride: i32,
    pub padding: i32,
    pub dilation: i32,
    pub groups: i32,
}

impl Conv1d {
    /// 由 PyTorch 布局 `[Cout, Cin/groups, K]` 的权重构造。
    pub fn from_torch(weight: Array, bias: Option<Array>) -> Result<Self> {
        let weight = weight.as_dtype(Dtype::Float32)?.transpose_axes(&[0, 2, 1])?;
        Ok(Self {
            weight,
            bias,
            stride: 1,
            padding: 0,
            dilation: 1,
            groups: 1,
        })
    }

    pub fn load(weights: &mut WeightMap, prefix: &str) -> Result<Self> {
        let weight = weights.take(&format!("{prefix}.weight"))?;
        let bias = weights.take_optional_f32(&format!("{prefix}.bias"))?;
        Self::from_torch(weight, bias)
    }

    pub fn load_weight_norm(weights: &mut WeightMap, prefix: &str) -> Result<Self> {
        let weight = weights.take_weight_norm(prefix)?;
        let bias = weights.take_optional_f32(&format!("{prefix}.bias"))?;
        Self::from_torch(weight, bias)
    }

    pub fn with_stride(mut self, stride: i32) -> Self {
        self.stride = stride;
        self
    }

    pub fn with_padding(mut self, padding: i32) -> Self {
        self.padding = padding;
        self
    }

    pub fn with_dilation(mut self, dilation: i32) -> Self {
        self.dilation = dilation;
        self
    }

    pub fn with_groups(mut self, groups: i32) -> Self {
        self.groups = groups;
        self
    }

    /// 输入 `[N, L, Cin]`，输出 `[N, L', Cout]`。
    pub fn forward_nlc(&self, x: &Array) -> Result<Array> {
        let mut y = ops::conv1d(x, &self.weight, self.stride, self.padding, self.dilation, self.groups)?;
        if let Some(bias) = &self.bias {
            y = y + bias;
        }
        Ok(y)
    }
}

/// 激活函数：不用 mlx-rs `nn::*` 的 compiled 版本（每种形状都会重新编译），
/// 直接按公式展开。
pub mod act {
    use crate::synthesize::tensor::{Array, ops};
    use anyhow::Result;

    /// 精确 GELU：`x · (1 + erf(x/√2)) / 2`。
    pub fn gelu(x: &Array) -> Result<Array> {
        let erf = ops::erf(x * std::f32::consts::FRAC_1_SQRT_2)?;
        Ok(x * (erf + 1.0f32) * 0.5f32)
    }

    pub fn softplus(x: &Array) -> Result<Array> {
        Ok(ops::logaddexp(x, &Array::from_f32(0.0))?)
    }

    pub fn mish(x: &Array) -> Result<Array> {
        Ok(x * ops::tanh(softplus(x)?)?)
    }
}
