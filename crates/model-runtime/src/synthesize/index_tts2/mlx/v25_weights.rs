//! IndexTTS 2.5（`mlx-community/IndexTTS-2.5-fp16`）检查点的键名与张量布局重映射。
//!
//! 该检查点由 MLX 转换器导出：卷积是 MLX 布局 `[O, K, I]`、GPT-2 块是 `nn.Linear`
//! `[out, in]`、weight-norm 已预融合，部分模块也改了名。这里把它就地改写成 2.0
//! 加载器（`gpt.rs` / `s2mel.rs` / `semantic_codec.rs`）期望的 PyTorch 布局与键名，
//! 让 2.5 复用同一套模型图。官方 2.5 的 Conformer / Perceiver / S2Mel 与 2.0 是同一批类，
//! 差别只在检查点格式。

use super::weights::WeightMap;
use crate::synthesize::tensor::{Array, ops};
use anyhow::{Result, bail, ensure};

/// 情感 Conformer 位置编码长度（2.0 检查点里存的 `pe` 是 `[1, 5000, 512]`）。
const CONFORMER_PE_LEN: usize = 5000;
const EMO_ENCODER: &str = "emo_conditioning_encoder";
const EMO_PERCEIVER: &str = "emo_perceiver_encoder";

/// GPT：GPT-2 块 Linear `[out, in]` → Conv1D `[in, out]`；情感 Conformer 卷积回 torch 布局；
/// Perceiver 拆开的 k/v 合并回 `to_kv`；补上检查点省略的正弦位置编码。
pub fn remap_gpt(w: &mut WeightMap) -> Result<()> {
    let conv_key = format!("{EMO_ENCODER}.embed.conv.weight");
    if !w.contains(&conv_key) {
        bail!("不是 IndexTTS 2.5 MLX 检查点：缺少 {conv_key}");
    }
    w.map_arrays(|key, array| {
        if is_gpt2_block_weight(key) {
            return Ok(array.swap_axes(0, 1)?);
        }
        if key == conv_key && array.ndim() == 4 {
            // MLX `[O, H, W, I]` → torch `[O, I, H, W]`。
            return Ok(array.transpose_axes(&[0, 3, 1, 2])?);
        }
        if key.starts_with(EMO_ENCODER) && key.contains(".conv_module.") && key.ends_with(".weight") && array.ndim() == 3 {
            return Ok(array.transpose_axes(&[0, 2, 1])?);
        }
        Ok(array)
    })?;
    for part in ["weight", "bias"] {
        w.rename(
            &format!("{EMO_ENCODER}.embed.conv.{part}"),
            format!("{EMO_ENCODER}.embed.conv.0.{part}"),
        );
        w.rename(
            &format!("{EMO_ENCODER}.embed.out.{part}"),
            format!("{EMO_ENCODER}.embed.out.0.{part}"),
        );
    }
    let pe_key = format!("{EMO_ENCODER}.embed.pos_enc.pe");
    if !w.contains(&pe_key) {
        let norm_key = format!("{EMO_ENCODER}.after_norm.weight");
        let Some(dim) = w.get(&norm_key).map(|a| a.dim(0) as usize) else {
            bail!("IndexTTS 2.5 GPT 缺少 {norm_key}");
        };
        let pe = sinusoidal_position_encoding(CONFORMER_PE_LEN, dim);
        w.insert(pe_key, Array::from_slice(&pe, &[1, CONFORMER_PE_LEN as i32, dim as i32]));
    }
    remap_perceiver(w, EMO_PERCEIVER)
}

/// S2Mel：卷积回 torch 布局，改回 2.0 键名并加 `net.` 前缀。
pub fn remap_s2mel(w: &mut WeightMap) -> Result<()> {
    if w.keys().iter().any(|k| k.starts_with("net.")) {
        bail!("不是 IndexTTS 2.5 MLX S2Mel 检查点：键已带 net. 前缀");
    }
    transpose_conv1d_weights(w)?;
    w.rename_all(|key| Some(s2mel_key(key)));
    Ok(())
}

/// 语义码本：只有卷积布局不同，键名与 2.0 相同（weight-norm 已预融合）。
pub fn remap_codec(w: &mut WeightMap) -> Result<()> {
    if w.contains("quantizer.quantizers.0.in_project.weight_v") {
        bail!("不是 IndexTTS 2.5 MLX 语义码本检查点：仍是 weight-norm 布局");
    }
    transpose_conv1d_weights(w)
}

fn transpose_conv1d_weights(w: &mut WeightMap) -> Result<()> {
    w.map_arrays(|key, array| {
        if key.ends_with(".weight") && array.ndim() == 3 {
            Ok(array.transpose_axes(&[0, 2, 1])?)
        } else {
            Ok(array)
        }
    })
}

fn is_gpt2_block_weight(key: &str) -> bool {
    key.starts_with("gpt.h.")
        && [
            ".attn.c_attn.weight",
            ".attn.c_proj.weight",
            ".mlp.c_fc.weight",
            ".mlp.c_proj.weight",
        ]
        .iter()
        .any(|suffix| key.ends_with(suffix))
}

/// `layers.{i}.0.linear_{q,k,v,out}` → `to_q` / `to_kv`（k 在前）/ `to_out`；
/// `layers.{i}.1.w_{1,2}` → `layers.{i}.1.{0,2}`；`norm.weight` → `norm.gamma`。
fn remap_perceiver(w: &mut WeightMap, prefix: &str) -> Result<()> {
    w.rename(&format!("{prefix}.norm.weight"), format!("{prefix}.norm.gamma"));
    let mut layer = 0;
    loop {
        let attn = format!("{prefix}.layers.{layer}.0");
        let k_key = format!("{attn}.linear_k.weight");
        if !w.contains(&k_key) {
            break;
        }
        let k = w.take(&k_key)?;
        let v = w.take(&format!("{attn}.linear_v.weight"))?;
        w.insert(format!("{attn}.to_kv.weight"), ops::concatenate_axis(&[&k, &v], 0)?);
        w.rename(&format!("{attn}.linear_q.weight"), format!("{attn}.to_q.weight"));
        w.rename(&format!("{attn}.linear_out.weight"), format!("{attn}.to_out.weight"));
        let ff = format!("{prefix}.layers.{layer}.1");
        for part in ["weight", "bias"] {
            w.rename(&format!("{ff}.w_1.{part}"), format!("{ff}.0.{part}"));
            w.rename(&format!("{ff}.w_2.{part}"), format!("{ff}.2.{part}"));
        }
        layer += 1;
    }
    ensure!(layer > 0, "IndexTTS 2.5 GPT 缺少 {prefix} 的 Perceiver 层");
    Ok(())
}

/// 2.5 S2Mel 键名 → 2.0 键名（含 `net.` 前缀）。
fn s2mel_key(key: &str) -> String {
    let mut k = key.to_string();
    for embedder in ["t_embedder", "t_embedder2"] {
        k = k
            .replace(&format!(".{embedder}.linear1."), &format!(".{embedder}.mlp.0."))
            .replace(&format!(".{embedder}.linear2."), &format!(".{embedder}.mlp.2."));
    }
    k = k.replace(".adaLN_modulation.layers.", ".adaLN_modulation.");
    if let Some(rest) = k.strip_prefix("gpt_layer.layers.") {
        k = format!("gpt_layer.{rest}");
    }
    if k.contains(".wavenet.") && !k.contains(".conv.conv.") {
        for part in ["weight", "bias"] {
            if let Some(head) = k.strip_suffix(&format!(".conv.{part}")) {
                k = format!("{head}.conv.conv.{part}");
                break;
            }
        }
    }
    format!("net.{k}")
}

/// ESPnet / WeNet `PositionalEncoding`：`pe[p, 2i] = sin(p·d_i)`、`pe[p, 2i+1] = cos(p·d_i)`，
/// `d_i = exp(2i · −ln(10000)/dim)`。角度按 torch 的 f32 算，行主序 `[len, dim]`。
fn sinusoidal_position_encoding(len: usize, dim: usize) -> Vec<f32> {
    let scale = -(10000f32.ln() / dim as f32);
    let div: Vec<f32> = (0..dim).step_by(2).map(|i| (i as f32 * scale).exp()).collect();
    let mut pe = vec![0.0f32; len * dim];
    for (pos, row) in pe.chunks_exact_mut(dim).enumerate() {
        for (j, d) in div.iter().enumerate() {
            let angle = (pos as f32 * d) as f64;
            row[2 * j] = angle.sin() as f32;
            if 2 * j + 1 < dim {
                row[2 * j + 1] = angle.cos() as f32;
            }
        }
    }
    pe
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn position_encoding_matches_formula() {
        let dim = 8;
        let pe = sinusoidal_position_encoding(3, dim);
        assert_eq!(pe.len(), 24);
        assert_eq!(&pe[..dim], &[0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0]);
        let row1 = &pe[dim..2 * dim];
        assert!((row1[0] - 1f32.sin()).abs() < 1e-6);
        assert!((row1[1] - 1f32.cos()).abs() < 1e-6);
        let d3 = (6.0f32 * -(10000f32.ln() / dim as f32)).exp();
        assert!((row1[6] - d3.sin()).abs() < 1e-6);
        assert!((row1[7] - d3.cos()).abs() < 1e-6);
    }

    #[test]
    fn s2mel_keys_map_to_v2_names() {
        let cases = [
            (
                "cfm.estimator.t_embedder.linear1.weight",
                "net.cfm.estimator.t_embedder.mlp.0.weight",
            ),
            ("cfm.estimator.t_embedder2.linear2.bias", "net.cfm.estimator.t_embedder2.mlp.2.bias"),
            (
                "cfm.estimator.final_layer.adaLN_modulation.layers.1.weight",
                "net.cfm.estimator.final_layer.adaLN_modulation.1.weight",
            ),
            ("gpt_layer.layers.2.bias", "net.gpt_layer.2.bias"),
            (
                "cfm.estimator.wavenet.in_layers.7.conv.weight",
                "net.cfm.estimator.wavenet.in_layers.7.conv.conv.weight",
            ),
            (
                "cfm.estimator.wavenet.cond_layer.conv.bias",
                "net.cfm.estimator.wavenet.cond_layer.conv.conv.bias",
            ),
            ("length_regulator.model.3.weight", "net.length_regulator.model.3.weight"),
            (
                "cfm.estimator.final_layer.linear.weight",
                "net.cfm.estimator.final_layer.linear.weight",
            ),
        ];
        for (from, to) in cases {
            assert_eq!(s2mel_key(from), to, "{from}");
        }
    }

    #[test]
    fn only_gpt2_block_projections_are_transposed() {
        assert!(is_gpt2_block_weight("gpt.h.0.attn.c_attn.weight"));
        assert!(is_gpt2_block_weight("gpt.h.23.mlp.c_proj.weight"));
        assert!(!is_gpt2_block_weight("gpt.h.0.attn.c_attn.bias"));
        assert!(!is_gpt2_block_weight("gpt.h.0.ln_1.weight"));
        assert!(!is_gpt2_block_weight("mel_head.weight"));
    }

    #[test]
    fn perceiver_split_projections_are_fused_key_first() {
        let p = "emo_perceiver_encoder";
        let mut w = WeightMap::from_arrays(
            "test",
            [
                (
                    format!("{p}.layers.0.0.linear_q.weight"),
                    Array::from_slice(&[9.0f32, 9.0], &[1, 2]),
                ),
                (
                    format!("{p}.layers.0.0.linear_k.weight"),
                    Array::from_slice(&[1.0f32, 2.0], &[1, 2]),
                ),
                (
                    format!("{p}.layers.0.0.linear_v.weight"),
                    Array::from_slice(&[3.0f32, 4.0], &[1, 2]),
                ),
                (
                    format!("{p}.layers.0.0.linear_out.weight"),
                    Array::from_slice(&[5.0f32, 6.0], &[2, 1]),
                ),
                (format!("{p}.layers.0.1.w_1.bias"), Array::from_slice(&[0.5f32], &[1])),
                (format!("{p}.norm.weight"), Array::from_slice(&[1.0f32, 1.0], &[2])),
            ],
        );
        remap_perceiver(&mut w, p).unwrap();
        let kv = w.take(&format!("{p}.layers.0.0.to_kv.weight")).unwrap();
        kv.eval().unwrap();
        assert_eq!(kv.shape(), &[2, 2]);
        assert_eq!(kv.as_slice::<f32>(), &[1.0, 2.0, 3.0, 4.0]);
        assert!(w.contains(&format!("{p}.layers.0.0.to_q.weight")));
        assert!(w.contains(&format!("{p}.layers.0.0.to_out.weight")));
        assert!(w.contains(&format!("{p}.layers.0.1.0.bias")));
        assert!(w.contains(&format!("{p}.norm.gamma")));
        assert!(!w.contains(&format!("{p}.layers.0.0.linear_k.weight")));
    }
}
