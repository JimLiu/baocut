//! 子模型权重表：从 bag 的全量 safetensors 里按 `model_{i}.` 前缀切出一份，
//! 逐键取走并上转成 f32；建完模型后必须一个键都不剩（对应 Swift `verify: .all`）。

use super::tensor::{Array, Dtype};
use anyhow::{Context, Result, bail};
use std::collections::HashMap;

pub struct WeightStore {
    prefix: String,
    weights: HashMap<String, Array>,
}

impl WeightStore {
    /// 把 `all` 中以 `prefix` 开头的键全部移走（去掉前缀）。
    pub fn split(all: &mut HashMap<String, Array>, prefix: &str) -> Self {
        let keys: Vec<String> = all.keys().filter(|k| k.starts_with(prefix)).cloned().collect();
        let mut weights = HashMap::with_capacity(keys.len());
        for key in keys {
            if let Some(value) = all.remove(&key) {
                weights.insert(key[prefix.len()..].to_string(), value);
            }
        }
        Self {
            prefix: prefix.to_string(),
            weights,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.weights.is_empty()
    }

    /// 取走一个权重并转成 f32（参考实现同样把 fp16 权重上转到 float32 计算）。
    ///
    /// 逐个求值：权重在加载时就物化成 f32 常驻（每个张量一个短 command buffer），fp16 原件随即释放；
    /// 这样 `model.load` 的耗时与常驻内存是真实的，第一个窗口也不再背加载的开销。
    pub fn take(&mut self, key: &str) -> Result<Array> {
        let value = self.weights.remove(key).with_context(|| format!("缺少权重 {}{key}", self.prefix))?;
        let value = if value.dtype() == Dtype::Float32 {
            value
        } else {
            value.as_dtype(Dtype::Float32)?
        };
        value.eval()?;
        Ok(value)
    }

    /// 取走并校验形状。
    pub fn take_shape(&mut self, key: &str, expected: &[i32]) -> Result<Array> {
        let value = self.take(key)?;
        if value.shape() != expected {
            bail!("权重 {}{key} 形状 {:?} 与期望 {:?} 不符", self.prefix, value.shape(), expected);
        }
        Ok(value)
    }

    /// 建模完成后调用：仍有剩余键说明模块树与导出文件不一致。
    pub fn finish(self) -> Result<()> {
        if self.weights.is_empty() {
            return Ok(());
        }
        let mut keys: Vec<&String> = self.weights.keys().collect();
        keys.sort();
        let preview: Vec<String> = keys.iter().take(8).map(|k| k.to_string()).collect();
        bail!("{} 有 {} 个权重未被使用，例如 {:?}", self.prefix, self.weights.len(), preview);
    }
}
