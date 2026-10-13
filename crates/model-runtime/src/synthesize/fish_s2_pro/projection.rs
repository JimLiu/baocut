//! Quantized Fish projections and embeddings. MLX multiplies packed weights;
//! Candle expands at most 128 output rows, never the whole 4B parameter model.
use crate::synthesize::qwen3_tts::weights::Weights;
use crate::synthesize::tensor::ops::indexing::IndexOp;
use crate::synthesize::tensor::{Array, Dtype, ops};
use anyhow::{Result, ensure};

pub(super) struct Projection {
    weight: Array,
    quantized: Option<(Array, Array, usize, u32)>,
    bias: Option<Array>,
}
impl Projection {
    pub fn load(w: &mut Weights, p: &str, group: usize, bits: u32) -> Result<Self> {
        let weight = w.take(&format!("{p}.weight"))?;
        let quantized = if let Some(scales) = w.take_optional(&format!("{p}.scales")) {
            ensure!(group > 0 && matches!(bits, 4 | 8), "invalid Fish quantization configuration");
            Some((scales, w.take(&format!("{p}.biases"))?, group, bits))
        } else {
            ensure!(weight.dtype() != Dtype::Uint32, "packed Fish weight lacks scales");
            None
        };
        Ok(Self {
            weight,
            quantized,
            bias: w.take_optional(&format!("{p}.bias")),
        })
    }
    /// A view into the semantic/EOS prefix of the tied embedding. Keep the
    /// prompt-only text rows out of the output head without duplicating weights.
    pub fn first_rows(&self, count: i32) -> Result<Self> {
        ensure!(count > 0 && count <= self.weight.dim(0), "invalid Fish output prefix");
        Ok(Self {
            weight: self.weight.index(..count),
            quantized: self
                .quantized
                .as_ref()
                .map(|(s, b, g, bits)| (s.index(..count), b.index(..count), *g, *bits)),
            bias: self.bias.as_ref().map(|b| b.index(..count)),
        })
    }
    fn dequantize(&self, weight: &Array, scales: &Array, biases: &Array, group: usize, bits: u32) -> Result<Array> {
        #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
        {
            Ok(ops::dequantize(weight, scales, biases, group as i32, bits as i32)?)
        }
        #[cfg(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")))]
        {
            crate::synthesize::tensor::dequantize(weight, scales, biases, group, bits)
        }
    }
    pub fn embedding(&self, ids: &Array) -> Result<Array> {
        match &self.quantized {
            None => Ok(self.weight.index(ids)),
            Some((scales, biases, group, bits)) => {
                // Gather packed rows first; expanding the full token vocabulary
                // would add 1.6 GB on CPU and defeat model quantization.
                let packed = self.weight.index(ids);
                let last = packed.dim(-1);
                let scales = scales.index(ids);
                let scale_dim = scales.dim(-1);
                let biases = biases.index(ids);
                let decoded = self.dequantize(
                    &packed.reshape(&[-1, last])?,
                    &scales.reshape(&[-1, scale_dim])?,
                    &biases.reshape(&[-1, scale_dim])?,
                    *group,
                    *bits,
                )?;
                let mut shape = ids.shape().to_vec();
                shape.push(decoded.dim(-1));
                Ok(decoded.reshape(&shape)?)
            }
        }
    }
    pub fn forward(&self, x: &Array) -> Result<Array> {
        let y = match &self.quantized {
            None => ops::matmul(x, self.weight.t())?,
            Some((scales, biases, group, bits)) => {
                #[cfg(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64"))]
                {
                    ops::quantized_matmul(x, &self.weight, scales, biases, true, *group as i32, *bits as i32)?
                }
                #[cfg(not(all(feature = "backend-mlx", target_os = "macos", target_arch = "aarch64")))]
                {
                    let mut parts = Vec::new();
                    for start in (0..self.weight.dim(0)).step_by(128) {
                        let end = (start + 128).min(self.weight.dim(0));
                        let dense = self.dequantize(
                            &self.weight.index((start..end, ..)),
                            &scales.index((start..end, ..)),
                            &biases.index((start..end, ..)),
                            *group,
                            *bits,
                        )?;
                        parts.push(ops::matmul(x, dense.t())?);
                    }
                    ops::concatenate_axis(&parts, -1)?
                }
            }
        };
        Ok(match &self.bias {
            Some(b) => y.add(b)?,
            None => y,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    #[test]
    fn packed_projection_and_embedding_match_dense_math_across_tiles() {
        let _lock = crate::synthesize::tensor::host::TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        crate::synthesize::tensor::host::ensure_device().unwrap();
        for bits in [4, 8] {
            let rows = 260usize;
            let width = 64usize;
            let words = width * bits as usize / 32;
            let levels = 1usize << bits;
            let packed: Vec<u32> = (0..rows)
                .flat_map(|r| {
                    let value = (r % levels) as u32;
                    std::iter::repeat_n((0..32 / bits).fold(0, |word, i| word | (value << (i * bits))), words)
                })
                .collect();
            let mut tensors = HashMap::new();
            tensors.insert("p.weight".into(), Array::from_slice(&packed, &[rows as i32, words as i32]));
            tensors.insert("p.scales".into(), Array::from_slice(&vec![0.5f32; rows], &[rows as i32, 1]));
            tensors.insert("p.biases".into(), Array::from_slice(&vec![-2.0f32; rows], &[rows as i32, 1]));
            let projection = Projection::load(&mut Weights::from_tensors(tensors), "p", width, bits).unwrap();
            let y = projection.forward(&Array::from_slice(&[1.0f32; 64], &[1, 1, 64])).unwrap();
            y.eval().unwrap();
            for (r, value) in y.as_slice::<f32>().iter().enumerate() {
                assert!((value - 64.0 * ((r % levels) as f32 * 0.5 - 2.0)).abs() < 1e-4);
            }
            let prefix = projection.first_rows(131).unwrap();
            let selected = prefix.forward(&Array::from_slice(&[1.0f32; 64], &[1, 1, 64])).unwrap();
            selected.eval().unwrap();
            assert_eq!(&*selected.as_slice::<f32>(), &y.as_slice::<f32>()[..131]);
            assert!(projection.first_rows(261).is_err());
            let e = projection.embedding(&Array::from_slice(&[1i32, 259], &[1, 2])).unwrap();
            e.eval().unwrap();
            let values = e.as_slice::<f32>();
            assert!(values[..64].iter().all(|v| (*v + 1.5).abs() < 1e-4));
            assert!(values[64..].iter().all(|v| (*v + 0.5).abs() < 1e-4));
            assert_eq!(projection.weight.shape(), &[260, words as i32]);
        }
    }
}
