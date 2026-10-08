//! 文本编码器：Qwen3-VL 的语言模型部分（只喂文本，M-RoPE 三轴位置相同 = 普通 1D RoPE）。
//! 条件取末层 decoder 的输出（不过最终 RMSNorm），并丢掉系统提示那段前缀。
//! decoder 本体直接复用 [`crate::backend::mlx::qwen3::TextDecoder`]。
//! 提示词模板与分词在 [`super::prompt`]。v2 只给开发自检用的常驻编码器（`--check-lm` 的贪心续写）没有移植。

use super::weights;
use anyhow::{Context, Result, bail};
use mlx_rs::Array;
use mlx_rs::ops::indexing::IndexOp;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::backend::mlx::qwen3::{TextDecoder, TextDecoderConfig, WeightStore};

/// 语言模型权重的键前缀：mlx-community 4-bit 包是 `language_model.model`，ddalcu 8-bit 包
/// 保留 transformers 原名 `model.language_model`。
const PREFIXES: [&str; 2] = ["language_model.model", "model.language_model"];

fn is_lm_key(k: &str) -> bool {
    PREFIXES.iter().any(|p| k.starts_with(p) && k[p.len()..].starts_with('.'))
}

/// 从惰性表（只有文件头）认出前缀，并按第 0 层 q_proj 的形状反推 bits 与 group size：
/// 打包列数 × 32 = 4096 × bits，分组数 × group = 4096。层没量化（没有 `.scales`）时 bits 记 16，
/// 共享解码器就按原精度加载。注意共享解码器会把**没量化的 `embed_tokens`** 在加载时量化成
/// 与层相同的 bits（8-bit 包就是这样：嵌入表 bf16、层 8-bit），这里不绕开它。
fn layout(map: &HashMap<String, Array>) -> Result<(&'static str, TextDecoderConfig)> {
    let prefix = PREFIXES
        .into_iter()
        .find(|p| map.contains_key(&format!("{p}.embed_tokens.weight")))
        .context("文本编码器里找不到 embed_tokens")?;
    let mut c = TextDecoderConfig {
        hidden_size: 4096,
        layers: 36,
        heads: 32,
        kv_heads: 8,
        head_dim: 128,
        intermediate_size: 12288,
        group_size: 64,
        bits: 16,
        rope_theta: 5_000_000.0,
        rms_eps: 1e-6,
        qk_norm: true,
    };
    let q = format!("{prefix}.layers.0.self_attn.q_proj");
    let w = map.get(&format!("{q}.weight")).with_context(|| format!("缺少 {q}.weight"))?;
    if let Some(s) = map.get(&format!("{q}.scales")) {
        let input = c.hidden_size as i32;
        let (groups, packed) = (s.dim(1), w.dim(1) * 32);
        if groups == 0 || input % groups != 0 || packed % input != 0 {
            bail!(
                "{q} 的量化形状对不上 hidden {input}（权重 {:?}，scales {:?}）",
                w.shape(),
                s.shape()
            );
        }
        c.group_size = input / groups;
        c.bits = packed / input;
    }
    Ok((prefix, c))
}

/// 生成用的一次性编码：权重惰性打开，逐层流式读入（算第 i 层时预读第 i+1 层），用完即丢，
/// 常驻只有 embedding 与相邻两层。返回 `[1, L - drop_idx, 4096]` 的 bf16 条件。
pub fn encode_streaming(files: &[PathBuf], ids: &[u32], drop_idx: usize) -> Result<Array> {
    let raw = weights::lazy(files, is_lm_key).context("打开文本编码器权重")?;
    let (prefix, config) = layout(&raw)?;
    let mut store = WeightStore::from_arrays(raw)?;
    let decoder = TextDecoder::load_with_prefix(&mut store, config, prefix)?;
    let left = store.remaining();
    if !left.is_empty() {
        bail!("文本编码器有未使用的权重：{:?}", &left[..left.len().min(3)]);
    }
    let hidden = decoder.into_hidden_prenorm(&id_array(ids))?;
    let out = hidden.index((.., drop_idx as i32.., ..));
    out.eval()?;
    Ok(out)
}

fn id_array(ids: &[u32]) -> Array {
    Array::from_slice(&ids.iter().map(|&v| v as i32).collect::<Vec<_>>(), &[1, ids.len() as i32])
}
