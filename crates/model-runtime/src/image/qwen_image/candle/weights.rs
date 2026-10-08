//! 从映射的 MLX safetensors 分片里一次只读一个张量（移植自 v2 `bcut-image-local::candle::weights`）。
//!
//! candle 普通的 `safetensors::load` 会把每个张量一次性搬到设备上；图像模型的权重比一般显卡的显存大得多，所以映射与
//! 张量搬运的生命周期刻意分开。与 v2 唯一的不同：v2 按目录扫 `*.safetensors`，这里读调用方按清单取出的文件
//! （[`crate::bundle::VerifiedFiles::require_extension_in`]）。

use anyhow::{Context, Result, anyhow, bail};
use candle_core::safetensors::Load;
use candle_core::{DType, Device, Tensor};
use memmap2::{Mmap, MmapOptions};
use safetensors::SafeTensors;
use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};

use crate::backend::candle::weights::dequantize_affine;

struct Shard {
    path: PathBuf,
    data: Mmap,
}

/// safetensors 分片一直映射在主机的虚拟内存里。只有请求的张量会拷到目标设备上；层算完后丢掉返回的张量，
/// 那份设备内存就放掉了。
pub struct ShardedWeights {
    shards: Vec<Shard>,
    index: HashMap<String, usize>,
}

impl ShardedWeights {
    /// 打开给定的分片（按路径排序后建索引）。
    pub fn open(files: &[&Path]) -> Result<Self> {
        let mut paths = files.iter().map(|path| path.to_path_buf()).collect::<Vec<_>>();
        paths.sort();
        if paths.is_empty() {
            bail!("没有 safetensors 权重");
        }
        let mut shards = Vec::with_capacity(paths.len());
        let mut index = HashMap::new();
        for path in paths {
            let file = File::open(&path).with_context(|| format!("打开 {}", path.display()))?;
            // SAFETY: 映射只读，建映射时文件一直开着，BaoCut 的代码不改模型权重。
            let data = unsafe { MmapOptions::new().map(&file) }.with_context(|| format!("映射 {}", path.display()))?;
            let tensors = SafeTensors::deserialize(&data).with_context(|| format!("解析 {}", path.display()))?;
            for key in tensors.names() {
                if index.insert(key.to_owned(), shards.len()).is_some() {
                    bail!("重复权重键：{key}");
                }
            }
            drop(tensors);
            shards.push(Shard { path, data });
        }
        Ok(Self { shards, index })
    }

    pub fn contains(&self, key: &str) -> bool {
        self.index.contains_key(key)
    }

    fn shard(&self, key: &str) -> Result<&Shard> {
        self.shards
            .get(*self.index.get(key).ok_or_else(|| anyhow!("缺少权重：{key}"))?)
            .context("权重分片索引越界")
    }

    /// 只看形状与类型，不分配设备张量。
    pub fn metadata(&self, key: &str) -> Result<(Vec<usize>, safetensors::Dtype)> {
        let shard = self.shard(key)?;
        let tensors = SafeTensors::deserialize(&shard.data)?;
        let view = tensors.tensor(key)?;
        Ok((view.shape().to_vec(), view.dtype()))
    }

    pub fn load(&self, key: &str, device: &Device) -> Result<Tensor> {
        let shard = self.shard(key)?;
        let tensors = SafeTensors::deserialize(&shard.data).with_context(|| format!("解析 {}", shard.path.display()))?;
        tensors
            .tensor(key)?
            .load(device)
            .with_context(|| format!("读取权重 {key} ({})", shard.path.display()))
    }

    /// MLX 仿射量化的矩阵是打包的 u32 加每组的 scales 与 biases。只在主机内存里反量化这一个矩阵，再把结果按 `dtype`
    /// 搬到设备上；临时分配在返回时就放掉。
    pub fn linear(&self, prefix: &str, input: usize, device: &Device, dtype: DType) -> Result<Tensor> {
        let key = format!("{prefix}.weight");
        let weight = self.load(&key, &Device::Cpu)?;
        if !self.contains(&format!("{prefix}.scales")) {
            return Ok(weight.to_dtype(dtype)?.to_device(device)?);
        }
        let scales = self.load(&format!("{prefix}.scales"), &Device::Cpu)?;
        let biases = self.load(&format!("{prefix}.biases"), &Device::Cpu)?;
        let (rows, columns) = weight.dims2()?;
        let (scale_rows, groups) = scales.dims2()?;
        if groups == 0 || rows != scale_rows || !input.is_multiple_of(groups) {
            bail!("{prefix} 的量化分组形状与输入维 {input} 不符");
        }
        let packed_bits = columns.checked_mul(32).context("量化维度溢出")?;
        if !packed_bits.is_multiple_of(input) {
            bail!("{prefix} 的打包列数与输入维 {input} 不符");
        }
        let bits = packed_bits / input;
        if !matches!(bits, 4 | 8) {
            bail!("{prefix} 的量化位宽 {bits} 不受支持");
        }
        let group = input / groups;
        let dense = dequantize_affine(&weight, &scales, &biases, group, bits)?;
        Ok(dense.to_dtype(dtype)?.to_device(device)?)
    }

    /// 词嵌入先按提示词的 token 挑行、再反量化：Qwen3-VL 的整张词表展开会在主机内存里占好几 GB，而一句提示词只用到
    /// 几十行。
    pub fn embedding_rows(&self, prefix: &str, ids: &[u32], width: usize, device: &Device, dtype: DType) -> Result<Tensor> {
        let weight = self.load(&format!("{prefix}.weight"), &Device::Cpu)?;
        let rows = weight.dim(0)?;
        if ids.iter().any(|&id| id as usize >= rows) {
            bail!("{prefix} 的 token ID 越过词表大小 {rows}");
        }
        let indices = Tensor::from_slice(ids, ids.len(), &Device::Cpu)?;
        let selected = weight.index_select(&indices, 0)?;
        drop(weight);
        if !self.contains(&format!("{prefix}.scales")) {
            if selected.dim(1)? != width {
                bail!("{prefix} 的词向量维度不符");
            }
            return Ok(selected.to_dtype(dtype)?.to_device(device)?);
        }
        let scales = self.load(&format!("{prefix}.scales"), &Device::Cpu)?.index_select(&indices, 0)?;
        let biases = self.load(&format!("{prefix}.biases"), &Device::Cpu)?.index_select(&indices, 0)?;
        let packed_bits = selected.dim(1)?.checked_mul(32).context("词嵌入维度溢出")?;
        if !packed_bits.is_multiple_of(width) {
            bail!("{prefix} 的打包词向量维度不符");
        }
        let bits = packed_bits / width;
        if !matches!(bits, 4 | 8) || scales.dim(1)? == 0 || !width.is_multiple_of(scales.dim(1)?) {
            bail!("{prefix} 的词嵌入量化配置不受支持");
        }
        let dense = dequantize_affine(&selected, &scales, &biases, width / scales.dim(1)?, bits)?;
        Ok(dense.to_dtype(dtype)?.to_device(device)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_tensor(path: &Path, key: &str, dtype: &str, shape: &[usize], body: &[u8]) {
        let mut header = format!(
            "{{\"{key}\":{{\"dtype\":\"{dtype}\",\"shape\":{shape:?},\"data_offsets\":[0,{}]}}}}",
            body.len()
        );
        while !header.len().is_multiple_of(8) {
            header.push(' ');
        }
        let mut bytes = (header.len() as u64).to_le_bytes().to_vec();
        bytes.extend_from_slice(header.as_bytes());
        bytes.extend_from_slice(body);
        std::fs::write(path, bytes).unwrap();
    }

    fn open(dir: &Path, names: &[&str]) -> Result<ShardedWeights> {
        let paths = names.iter().map(|name| dir.join(name)).collect::<Vec<_>>();
        ShardedWeights::open(&paths.iter().map(PathBuf::as_path).collect::<Vec<_>>())
    }

    #[test]
    fn reads_only_requested_tensor_from_mapped_shards() {
        let dir = tempfile::tempdir().unwrap();
        write_tensor(
            &dir.path().join("model.safetensors"),
            "test.weight",
            "F32",
            &[1, 2],
            &[0, 0, 128, 63, 0, 0, 0, 64],
        );
        let weights = open(dir.path(), &["model.safetensors"]).unwrap();
        assert!(weights.contains("test.weight"));
        assert!(!weights.contains("other.weight"));
        assert_eq!(weights.metadata("test.weight").unwrap().0, vec![1, 2]);
        assert_eq!(
            weights.load("test.weight", &Device::Cpu).unwrap().to_vec2::<f32>().unwrap(),
            vec![vec![1.0, 2.0]]
        );
    }

    #[test]
    fn expands_mlx_four_bit_affine_matrix_on_cpu() {
        let dir = tempfile::tempdir().unwrap();
        // 8 个低位在前的 4 位值（0..7），一组 8 个。
        let packed = (0..8_u32).fold(0_u32, |word, q| word | (q << (4 * q)));
        write_tensor(
            &dir.path().join("a.safetensors"),
            "layer.weight",
            "U32",
            &[1, 1],
            &packed.to_le_bytes(),
        );
        write_tensor(
            &dir.path().join("b.safetensors"),
            "layer.scales",
            "F32",
            &[1, 1],
            &0.5_f32.to_le_bytes(),
        );
        write_tensor(
            &dir.path().join("c.safetensors"),
            "layer.biases",
            "F32",
            &[1, 1],
            &1.0_f32.to_le_bytes(),
        );
        let weights = open(dir.path(), &["a.safetensors", "b.safetensors", "c.safetensors"]).unwrap();
        let dense = weights.linear("layer", 8, &Device::Cpu, DType::F32).unwrap();
        assert_eq!(
            dense.to_vec2::<f32>().unwrap(),
            vec![(0..8).map(|n| 1.0 + n as f32 * 0.5).collect::<Vec<_>>()]
        );
    }

    #[test]
    fn selects_quantized_embedding_rows_before_expansion() {
        let dir = tempfile::tempdir().unwrap();
        let words = [0x7654_3210_u32, 0x7777_7777];
        let packed = words.iter().flat_map(|word| word.to_le_bytes()).collect::<Vec<_>>();
        write_tensor(&dir.path().join("a.safetensors"), "embed.weight", "U32", &[2, 1], &packed);
        write_tensor(
            &dir.path().join("b.safetensors"),
            "embed.scales",
            "F32",
            &[2, 1],
            &[0.5_f32.to_le_bytes(), 0.5_f32.to_le_bytes()].concat(),
        );
        write_tensor(
            &dir.path().join("c.safetensors"),
            "embed.biases",
            "F32",
            &[2, 1],
            &[1.0_f32.to_le_bytes(), 1.0_f32.to_le_bytes()].concat(),
        );
        let weights = open(dir.path(), &["a.safetensors", "b.safetensors", "c.safetensors"]).unwrap();
        let selected = weights
            .embedding_rows("embed", &[1, 0, 1], 8, &Device::Cpu, DType::F32)
            .unwrap()
            .to_vec2::<f32>()
            .unwrap();
        assert_eq!(selected[0], vec![4.5; 8]);
        assert_eq!(selected[1], (0..8).map(|n| 1.0 + n as f32 * 0.5).collect::<Vec<_>>());
        assert_eq!(selected[2], selected[0]);
        assert!(weights.embedding_rows("embed", &[2], 8, &Device::Cpu, DType::F32).is_err());
    }

    #[test]
    fn rejects_duplicate_tensor_keys_across_shards() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["a.safetensors", "b.safetensors"] {
            write_tensor(&dir.path().join(name), "same.weight", "F32", &[1], &1.0_f32.to_le_bytes());
        }
        let error = open(dir.path(), &["a.safetensors", "b.safetensors"]).err().unwrap();
        assert!(error.to_string().contains("重复权重键"), "{error}");
        assert!(ShardedWeights::open(&[]).is_err());
    }
}
