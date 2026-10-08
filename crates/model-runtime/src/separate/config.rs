//! 部分实现改写自 speech-swift（https://github.com/soniqo/speech-swift）。
//! 上游文件：`Sources/SourceSeparation/HTDemucs/HTDemucsConfig.swift`。
//! Copyright 2025 Ivan Digital
//! SPDX-License-Identifier: Apache-2.0
//! 修改：BaoCut 将相关 Swift 实现改写为 Rust，并适配本项目的张量后端与模型包接口。
//! 原始许可全文：`crates/model-runtime/licenses/speech-swift.txt`；来源范围见根目录 `THIRD_PARTY_NOTICES.md`。
//!
//! `htdemucs_ft_config.json` 解析与网络层规划（纯逻辑，全平台编译）。
//!
//! 对照 speech-swift `HTDemucsConfig.swift`：JSON 由 speech-models 导出器生成，
//! 顶层是 bag 信息（子模型数、合并权重、采样率、窗口秒数），`arch` 是单个子模型的
//! 结构超参。这里只保留移植用到的键，未知键一律忽略。

use anyhow::{Context, Result, bail};
use serde::Deserialize;
use std::path::Path;

/// 顶层配置。
#[derive(Debug, Clone, Deserialize)]
pub struct HtDemucsConfig {
    pub model_name: String,
    #[serde(default)]
    pub dtype: String,
    /// stem 顺序，htdemucs_ft 为 `[drums, bass, other, vocals]`。
    pub sources: Vec<String>,
    pub num_models: usize,
    /// bag 合并权重 `[num_models][num_sources]`；htdemucs_ft 为单位阵（子模型 i 只出 stem i）。
    #[serde(default)]
    pub weights: Option<Vec<Vec<f32>>>,
    pub samplerate: u32,
    /// 每个推理窗口的秒数（7.8）。
    pub segment: f64,
    pub audio_channels: usize,
    pub arch: Arch,
}

/// 单个子模型的结构超参。
#[derive(Debug, Clone, Deserialize)]
pub struct Arch {
    pub channels: usize,
    pub growth: usize,
    pub nfft: usize,
    pub cac: bool,
    pub depth: usize,
    pub rewrite: bool,
    pub freq_emb: f32,
    pub emb_scale: f32,
    #[serde(default)]
    pub emb_smooth: bool,
    pub kernel_size: usize,
    pub stride: usize,
    pub time_stride: usize,
    pub context: usize,
    pub context_enc: usize,
    pub norm_starts: usize,
    #[serde(default)]
    pub norm_groups: usize,
    pub dconv_mode: u32,
    pub dconv_depth: usize,
    pub dconv_comp: usize,
    pub bottom_channels: usize,
    pub t_layers: usize,
    pub t_heads: usize,
    pub t_hidden_scale: f32,
    #[serde(default = "default_t_emb")]
    pub t_emb: String,
    pub t_max_period: f32,
    #[serde(default = "default_true")]
    pub t_layer_scale: bool,
    #[serde(default = "default_true")]
    pub t_gelu: bool,
    #[serde(default = "default_true")]
    pub t_norm_in: bool,
    #[serde(default = "default_true")]
    pub t_norm_first: bool,
    #[serde(default = "default_true")]
    pub t_norm_out: bool,
    pub t_weight_pos_embed: f32,
    #[serde(default)]
    pub t_cross_first: bool,
}

fn default_t_emb() -> String {
    "sin".to_string()
}

fn default_true() -> bool {
    true
}

/// 编码器 / 解码器每一层的形状规划，对照 `HTDemucs.swift` init 里的循环。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayerPlan {
    /// 频域分支输入 / 输出通道（cac 下输入通道 = 2 × 音频通道）。
    pub chin_z: usize,
    pub chout_z: usize,
    /// 时域分支输入 / 输出通道。
    pub chin_t: usize,
    pub chout_t: usize,
    /// 频域卷积核（沿频率轴）、步长、padding。
    pub freq_kernel: usize,
    pub freq_stride: usize,
    pub freq_pad: usize,
    /// 时域卷积核、步长、padding。
    pub time_kernel: usize,
    pub time_stride: usize,
    pub time_pad: usize,
    /// 本层输入 / 输出的频率 bin 数。
    pub freqs_in: usize,
    pub freqs_out: usize,
    /// 解码器输出通道（第 0 层是 `sources × audio_channels(×2)`）。
    pub dec_chout_z: usize,
    pub dec_chout_t: usize,
}

impl HtDemucsConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path).with_context(|| format!("无法读取 HTDemucs 配置 {}", path.display()))?;
        let config: Self = serde_json::from_str(&text).with_context(|| format!("HTDemucs 配置格式错误 {}", path.display()))?;
        config.validate()?;
        Ok(config)
    }

    pub fn hop_length(&self) -> usize {
        self.arch.nfft / 4
    }

    /// 每个窗口的样本数（7.8 s × 44 100 = 343 980）。
    pub fn training_length(&self) -> usize {
        (self.segment * f64::from(self.samplerate)) as usize
    }

    pub fn num_sources(&self) -> usize {
        self.sources.len()
    }

    /// 频域分支进入网络时的通道数。
    pub fn spec_channels(&self) -> usize {
        if self.arch.cac {
            self.audio_channels * 2
        } else {
            self.audio_channels
        }
    }

    /// 瓶颈处的通道数（`channels × growth^(depth-1)`）。
    pub fn transformer_channels(&self) -> usize {
        self.arch.channels * self.arch.growth.pow(self.arch.depth as u32 - 1)
    }

    /// CrossTransformer 的工作维度。
    pub fn transformer_dim(&self) -> usize {
        if self.arch.bottom_channels > 0 {
            self.arch.bottom_channels
        } else {
            self.transformer_channels()
        }
    }

    /// 校验本移植覆盖的结构子集（htdemucs / htdemucs_ft 的公开配置都在其中）。
    pub fn validate(&self) -> Result<()> {
        let a = &self.arch;
        if self.sources.is_empty() {
            bail!("HTDemucs 配置没有 sources");
        }
        if self.num_models == 0 {
            bail!("HTDemucs 配置 num_models 为 0");
        }
        if self.num_models != self.sources.len() {
            bail!(
                "只支持对角 bag（子模型数 {} 必须等于 stem 数 {}）",
                self.num_models,
                self.sources.len()
            );
        }
        if let Some(weights) = &self.weights {
            for (i, row) in weights.iter().enumerate() {
                if row.len() != self.sources.len() {
                    bail!("bag 权重第 {i} 行长度 {} 与 stem 数不符", row.len());
                }
                for (j, &w) in row.iter().enumerate() {
                    let expected = if i == j { 1.0 } else { 0.0 };
                    if (w - expected).abs() > 1e-6 {
                        bail!("只支持对角 bag 权重：weights[{i}][{j}] = {w}");
                    }
                }
            }
        }
        if !a.cac {
            bail!("只支持 cac=true 的 HTDemucs");
        }
        if a.nfft == 0 || !a.nfft.is_multiple_of(4) {
            bail!("nfft 必须是 4 的倍数：{}", a.nfft);
        }
        if a.norm_starts < a.depth {
            bail!(
                "只支持 norm_starts >= depth（HEnc/HDec 无 GroupNorm）：norm_starts {} depth {}",
                a.norm_starts,
                a.depth
            );
        }
        if a.t_layers > 0 {
            if a.t_emb != "sin" {
                bail!("只支持 t_emb=sin：{}", a.t_emb);
            }
            if !(a.t_norm_first && a.t_norm_out && a.t_norm_in && a.t_layer_scale && a.t_gelu) {
                bail!("只支持 norm_first / norm_out / norm_in / layer_scale / gelu 全开的 transformer");
            }
            if a.t_cross_first {
                bail!("只支持 t_cross_first=false");
            }
            if a.t_heads == 0 || !self.transformer_dim().is_multiple_of(a.t_heads) {
                bail!("transformer 维度 {} 不能被头数 {} 整除", self.transformer_dim(), a.t_heads);
            }
        }
        if self.training_length() == 0 {
            bail!("segment × samplerate 为 0");
        }
        // 规划各层时检查频率轴不会塌到 1（否则需要 empty/inject 合并层，本移植未覆盖）。
        self.layer_plan()?;
        Ok(())
    }

    /// 按 `HTDemucs.swift` init 循环推导每层形状。
    pub fn layer_plan(&self) -> Result<Vec<LayerPlan>> {
        let a = &self.arch;
        let sources = self.sources.len();
        let mut chin = self.audio_channels;
        let mut chin_z = self.spec_channels();
        let mut chout = a.channels;
        let mut chout_z = a.channels;
        let mut freqs = a.nfft / 2;
        let mut plan = Vec::with_capacity(a.depth);
        for index in 0..a.depth {
            if freqs <= 1 || freqs <= a.kernel_size {
                bail!(
                    "第 {index} 层频率 bin 数 {freqs} <= kernel_size {}，需要 empty/inject 合并层，本移植未覆盖",
                    a.kernel_size
                );
            }
            let ker = a.kernel_size;
            let stri = a.stride;
            let pad = ker / 4;
            let t_ker = a.kernel_size;
            let t_stri = a.stride;
            let t_pad = a.kernel_size / 4;
            let freqs_out = (freqs + 2 * pad - ker) / stri + 1;
            let (dec_chout_z, dec_chout_t) = if index == 0 {
                let c = self.audio_channels * sources;
                (if a.cac { c * 2 } else { c }, c)
            } else {
                (chin_z, chin)
            };
            plan.push(LayerPlan {
                chin_z,
                chout_z,
                chin_t: chin,
                chout_t: chout,
                freq_kernel: ker,
                freq_stride: stri,
                freq_pad: pad,
                time_kernel: t_ker,
                time_stride: t_stri,
                time_pad: t_pad,
                freqs_in: freqs,
                freqs_out,
                dec_chout_z,
                dec_chout_t,
            });
            chin = chout;
            chin_z = chout_z;
            chout *= a.growth;
            chout_z *= a.growth;
            freqs = freqs_out;
        }
        Ok(plan)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_json() -> &'static str {
        r#"{
          "model_name": "htdemucs_ft", "dtype": "fp16",
          "sources": ["drums", "bass", "other", "vocals"], "num_models": 4,
          "weights": [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
          "samplerate": 44100, "segment": 7.8, "audio_channels": 2,
          "arch": {
            "channels": 48, "channels_time": null, "growth": 2, "nfft": 4096,
            "wiener_iters": 0, "cac": true, "depth": 4, "rewrite": true, "multi_freqs": [],
            "freq_emb": 0.2, "emb_scale": 10, "emb_smooth": true, "kernel_size": 8, "stride": 4,
            "time_stride": 2, "context": 1, "context_enc": 0, "norm_starts": 4, "norm_groups": 4,
            "dconv_mode": 3, "dconv_depth": 2, "dconv_comp": 8, "dconv_init": 0.001,
            "bottom_channels": 512, "t_layers": 5, "t_hidden_scale": 4.0, "t_heads": 8,
            "t_dropout": 0.02, "t_layer_scale": true, "t_gelu": true, "t_emb": "sin",
            "t_max_period": 10000.0, "t_weight_pos_embed": 1.0, "t_norm_in": true,
            "t_norm_first": true, "t_norm_out": true, "t_cross_first": false, "t_lr": null
          }
        }"#
    }

    #[test]
    fn parses_reference_config() {
        let cfg: HtDemucsConfig = serde_json::from_str(sample_json()).unwrap();
        cfg.validate().unwrap();
        assert_eq!(cfg.hop_length(), 1024);
        assert_eq!(cfg.training_length(), 343_980);
        assert_eq!(cfg.spec_channels(), 4);
        assert_eq!(cfg.transformer_channels(), 384);
        assert_eq!(cfg.transformer_dim(), 512);
        assert_eq!(cfg.arch.emb_scale, 10.0);
    }

    #[test]
    fn layer_plan_matches_swift_loop() {
        let cfg: HtDemucsConfig = serde_json::from_str(sample_json()).unwrap();
        let plan = cfg.layer_plan().unwrap();
        assert_eq!(plan.len(), 4);
        let chin_z: Vec<_> = plan.iter().map(|p| p.chin_z).collect();
        let chout_z: Vec<_> = plan.iter().map(|p| p.chout_z).collect();
        let chin_t: Vec<_> = plan.iter().map(|p| p.chin_t).collect();
        let freqs: Vec<_> = plan.iter().map(|p| (p.freqs_in, p.freqs_out)).collect();
        assert_eq!(chin_z, vec![4, 48, 96, 192]);
        assert_eq!(chout_z, vec![48, 96, 192, 384]);
        assert_eq!(chin_t, vec![2, 48, 96, 192]);
        assert_eq!(freqs, vec![(2048, 512), (512, 128), (128, 32), (32, 8)]);
        assert_eq!(plan[0].dec_chout_z, 16);
        assert_eq!(plan[0].dec_chout_t, 8);
        assert_eq!(plan[1].dec_chout_z, 48);
        assert_eq!(plan[1].dec_chout_t, 48);
        assert_eq!((plan[0].freq_kernel, plan[0].freq_stride, plan[0].freq_pad), (8, 4, 2));
        assert_eq!((plan[0].time_kernel, plan[0].time_stride, plan[0].time_pad), (8, 4, 2));
    }

    #[test]
    fn rejects_non_diagonal_bag() {
        let text = sample_json().replace("[[1,0,0,0]", "[[0.5,0.5,0,0]");
        let cfg: HtDemucsConfig = serde_json::from_str(&text).unwrap();
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn rejects_shallow_norm_starts() {
        let text = sample_json().replace("\"norm_starts\": 4", "\"norm_starts\": 2");
        let cfg: HtDemucsConfig = serde_json::from_str(&text).unwrap();
        assert!(cfg.validate().is_err());
    }
}
